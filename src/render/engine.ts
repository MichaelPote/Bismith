// The Engine owns the WebGL context and orchestrates the pipeline (docs/architecture.md §2):
// material stack → normals → path tracer → post stack → display. It watches project keys and only redoes
// the stages that a change invalidates.

import * as THREE from 'three';
import { SHAPE_MASK, type Project } from '@/core/project';
import { Gpu } from '@/gpu/context';
import { MaterialPipeline, shaderKey } from './materialPipeline';
import { PathTracer } from './pathtracer';
import { PostStack } from './post/stack';
import { Display, VOID_COLOR, type ChannelView, type DisplayOptions, type ViewTransform } from './display';
import { ensureBuiltins } from './builtins';
import { scaleProject, supersampleFactor } from '@/core/supersample';
import { clamp01, linearToSrgb1 } from '@/core/color';
import { onImageReady, pendingImages } from '@/core/images';

// Box filter for supersampling: average each k×k block of a k× texture (the traced image, linear HDR, or a material
// map) into one texel.
const DOWNSAMPLE = /* glsl */ `
uniform sampler2D tSrc;
uniform int uK;
out vec4 oColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * uK;
  vec4 s = vec4(0.0);
  for (int y = 0; y < uK; y++)
    for (int x = 0; x < uK; x++) s += texelFetch(tSrc, p + ivec2(x, y), 0);
  oColor = s / float(uK * uK);
}
`;

export interface EngineStats {
	samples: number;
	maxSamples: number;
	/** Wall-clock ms of the last material evaluation. */
	evalMs: number;
	/** Samples per second over the last second. */
	samplesPerSec: number;
	/** True while showing the fast interactive preview. */
	draft: boolean;
	heightMin: number;
	heightMax: number;
	errors: Record<string, string>;
}

export interface EngineView {
	channel: ChannelView;
	transform: ViewTransform;
	options: DisplayOptions;
	/** Evaluate the stack only up to this layer index (inclusive); null = all. */
	previewUpTo: number | null;
	/** The mask the Masks view shows (FR8.23). */
	mask: string;
}

export interface ImageData32 {
	width: number;
	height: number;
	/** RGBA float, rows top-to-bottom. */
	data: Float32Array;
}

/** After the next paint (or 100 ms, where a hidden page gets no frames). */
function painted(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => setTimeout(resolve, 0));
		setTimeout(resolve, 100);
	});
}

export class Engine {
	readonly gpu: Gpu;
	readonly material: MaterialPipeline;
	readonly tracer: PathTracer;
	readonly post: PostStack;
	private display: Display;
	private project: Project | null = null;
	private view: EngineView = {
		channel: 'final',
		transform: { zoom: 1, offsetX: 0, offsetY: 0 },
		options: { tile: false, grid: true, checker: true },
		previewUpTo: null,
		mask: SHAPE_MASK
	};
	private canvasSize: [number, number] = [1, 1];
	private materialKey = '';
	/** Supersampling factor and the k× project the material stack and tracer render. */
	private ss = 1;
	private inner: Project | null = null;
	private down: THREE.WebGLRenderTarget | null = null;
	/** A material map box-filtered to the texture size, for readback. */
	private mapDown: THREE.WebGLRenderTarget | null = null;
	private downMat: THREE.RawShaderMaterial | null = null;
	private traceKey = '';
	private postKey = '';
	private materialDirty = true;
	private traceDirty = true;
	private postDirty = true;
	private displayDirty = true;
	private raf = 0;
	private running = false;
	private suspended = false;
	/** Samples traced per frame over the last second: [time, count]. */
	private sampleTimes: [number, number][] = [];
	private shaderErrors = new Map<string, string>();
	/** Time of the last material / lighting edit; while recent, the tracer runs in draft quality. */
	private lastEdit = -Infinity;
	private draft = false;
	/** Draft (fast preview) settings used while the user is dragging. */
	draftWindowMs = 250;
	private currentShaderOwner = '';
	stats: EngineStats = {
		samples: 0,
		maxSamples: 0,
		evalMs: 0,
		samplesPerSec: 0,
		draft: false,
		heightMin: 0,
		heightMax: 0,
		errors: {}
	};
	onStats: ((s: EngineStats) => void) | null = null;
	/** Called after each material evaluation (e.g. to refresh thumbnails). */
	onMaterial: (() => void) | null = null;
	/** settled() callers waiting for the pending material evaluation. */
	private materialWaiters: (() => void)[] = [];
	private offImages: () => void = () => undefined;
	paused = false;

	constructor(canvas: HTMLCanvasElement) {
		ensureBuiltins();
		this.gpu = new Gpu(canvas);
		this.gpu.renderer.debug.onShaderError = (gl, _program, vs, fs) => {
			const log = (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || '');
			this.shaderErrors.set(this.currentShaderOwner || 'shader', log.trim() || 'Shader failed to compile');
			console.error('[bismith] shader error in', this.currentShaderOwner, log);
		};
		this.material = new MaterialPipeline(this.gpu);
		this.material.onBeforeLayer = (id) => {
			this.currentShaderOwner = id;
		};
		this.material.onVariantReady = () => {
			this.materialDirty = true;
			this.kick();
		};
		// An image a layer uses (core/images.ts) has decoded: evaluate again with it.
		this.offImages = onImageReady(() => {
			this.materialDirty = true;
			this.kick();
		});
		this.tracer = new PathTracer(this.gpu);
		this.post = new PostStack(this.gpu);
		this.display = new Display(this.gpu);
	}

	setProject(project: Project): void {
		this.project = project;
		// Supersampling: the material stack and the tracer see the k× project; post runs at the real size.
		this.ss = supersampleFactor(project);
		const inner = scaleProject(project, this.ss);
		this.inner = inner;
		const upTo = this.view.previewUpTo;
		// Groups: their members, on/off and Limit to (planMasks reads it) change the stack.
		const mKey = JSON.stringify([
			inner.width,
			inner.height,
			inner.tileable,
			inner.heightDepth,
			inner.seed,
			inner.base,
			inner.layers,
			upTo,
			inner.groups?.map((g) => [g.id, g.members, g.enabled !== false, g.limit ?? null])
		]);
		// Sample counts and export settings don't change the image: raising Max samples continues the accumulation.
		const { maxSamples, samplesPerFrame, exportSamples, exportSupersample, ...look } = inner.render;
		const tKey = JSON.stringify([inner.lighting, look, this.ss]);
		const pKey = JSON.stringify(project.post);
		const first = this.materialKey === '';
		if (mKey !== this.materialKey) {
			this.materialKey = mKey;
			this.materialDirty = true;
			if (!first) this.lastEdit = performance.now();
		}
		if (tKey !== this.traceKey) {
			this.traceKey = tKey;
			this.traceDirty = true;
			if (!first) this.lastEdit = performance.now();
		}
		if (pKey !== this.postKey) {
			this.postKey = pKey;
			this.postDirty = true;
		}
		this.kick();
	}

	setView(view: Partial<EngineView>): void {
		const prevUpTo = this.view.previewUpTo;
		this.view = { ...this.view, ...view };
		if (view.previewUpTo !== undefined && view.previewUpTo !== prevUpTo && this.project) {
			this.setProject(this.project);
		}
		this.displayDirty = true;
		this.kick();
	}

	resize(width: number, height: number): void {
		const w = Math.max(1, Math.round(width));
		const h = Math.max(1, Math.round(height));
		if (w === this.canvasSize[0] && h === this.canvasSize[1]) return;
		this.canvasSize = [w, h];
		this.gpu.renderer.setPixelRatio(1);
		this.gpu.renderer.setSize(w, h, false);
		this.displayDirty = true;
		this.kick();
	}

	/** Generator shaders among `keys` (shaderKey of the layers) not compiled yet (their first use would stall the page). */
	uncompiled(keys: string[]): string[] {
		return this.material.uncompiled(keys);
	}

	/** Shader compiles run off the main thread here, so precompile() leaves the page responsive. */
	get parallelCompile(): boolean {
		return this.gpu.parallelCompile;
	}

	/**
	 * Compile generator shaders ahead of their first use (see MaterialPipeline.precompile). Where the browser compiles
	 * off the main thread they go as one parallel batch. Elsewhere (Firefox) each compile blocks the page, and a batch
	 * would block for all of them at once with the progress jumping 0 → 100 % at the end: there they go one at a time
	 * with a painted frame between, so a progress bar moves. `onProgress` hears the count done and, while one is
	 * pending, the key compiling next.
	 */
	async precompile(keys: string[], onProgress?: (done: number, total: number, next?: string) => void): Promise<void> {
		if (this.parallelCompile) return this.material.precompile(keys, onProgress);
		const todo = this.uncompiled(keys);
		for (let i = 0; i < todo.length; i++) {
			onProgress?.(i, todo.length, todo[i]);
			await painted();
			await this.material.precompile([todo[i]]);
		}
		onProgress?.(todo.length, todo.length);
	}

	/** Make the next compiles cold (a fresh salt in the shaders): for measuring compile times only. */
	setShaderSalt(salt: string): void {
		this.material.setShaderSalt(salt);
	}

	/** Resolves once the pending material evaluation has run (at once if none is pending or the loop is stopped). */
	settled(): Promise<void> {
		if (!this.materialDirty || !this.running || this.suspended) return Promise.resolve();
		return new Promise((resolve) => this.materialWaiters.push(resolve));
	}

	/** Images the project's layers use, decoded, and the evaluation with them done (headless renders). */
	async imagesSettled(): Promise<void> {
		await pendingImages();
		await this.settled();
	}

	private releaseWaiters(): void {
		for (const resolve of this.materialWaiters.splice(0)) resolve();
	}

	/** Force a restart of accumulation (e.g. after the user asks to re-render). */
	restart(): void {
		this.traceDirty = true;
		this.kick();
	}

	start(): void {
		this.running = true;
		this.kick();
	}

	stop(): void {
		this.running = false;
		cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.releaseWaiters();
	}

	/**
	 * Suspend the interactive loop entirely (e.g. while an optimiser drives renderNow() synchronously).
	 * Resuming re-applies `project` (or the last one set) and restarts the loop.
	 */
	suspend(): void {
		this.suspended = true;
		cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.releaseWaiters();
	}

	resume(project?: Project): void {
		this.suspended = false;
		if (project) this.setProject(project);
		this.traceDirty = true;
		this.displayDirty = true;
		this.kick();
	}

	private kick(): void {
		if (!this.running || this.raf || this.suspended) return;
		this.raf = requestAnimationFrame(() => {
			this.raf = 0;
			const more = this.tick();
			if (more) this.kick();
		});
	}

	/** Bring material + tracer configuration up to date. `allowDraft` enables the interactive fast preview. */
	private prepare(allowDraft = false): void {
		const project = this.inner ?? this.project!;
		const draft = allowDraft && performance.now() - this.lastEdit < this.draftWindowMs;
		if (draft !== this.draft) {
			this.draft = draft;
			this.traceDirty = true;
		}
		if (this.materialDirty) {
			const t0 = performance.now();
			this.shaderErrors.clear();
			this.material.evaluate(project, this.view.previewUpTo ?? Infinity);
			this.stats.evalMs = performance.now() - t0;
			this.materialDirty = false;
			this.traceDirty = true;
			this.onMaterial?.();
			this.releaseWaiters();
		}
		if (this.traceDirty) {
			this.tracer.configure(project, this.material, {
				bounces: this.draft ? Math.min(1, project.render.bounces) : undefined,
				ss: this.ss
			});
			this.tracer.reset();
			this.traceDirty = false;
			this.postDirty = true;
		}
	}

	/** One frame of work. Returns true while there is more to do. */
	tick(): boolean {
		const project = this.project;
		if (!project) return false;
		this.prepare(true);
		const r = project.render;
		let traced = 0;
		if (!this.paused && this.tracer.samples < r.maxSamples) {
			traced = this.tracer.trace(this.draft ? 1 : Math.max(1, r.samplesPerFrame), r.maxSamples);
			if (traced > 0) this.postDirty = true;
			const now = performance.now();
			if (traced > 0) this.sampleTimes.push([now, traced]);
			while (this.sampleTimes.length && now - this.sampleTimes[0][0] > 1000) this.sampleTimes.shift();
		}
		if (this.postDirty && this.tracer.output) this.runPost();
		if (this.displayDirty) {
			this.draw();
			this.displayDirty = false;
		}
		this.updateStats();
		return this.draft || (!this.paused && this.tracer.samples < r.maxSamples);
	}

	private updateStats(): void {
		const project = this.project!;
		const errors: Record<string, string> = {};
		for (const [k, v] of this.material.errors) errors[k] = v;
		for (const [k, v] of this.post.errors) errors[k] = v;
		for (const [k, v] of this.shaderErrors) errors[k] = v;
		this.stats = {
			...this.stats,
			samples: this.tracer.samples,
			maxSamples: project.render.maxSamples,
			samplesPerSec: this.sampleTimes.reduce((n, [, c]) => n + c, 0),
			draft: this.draft,
			heightMin: this.material.heightStats.min / this.ss,
			heightMax: this.material.heightStats.max / this.ss,
			errors
		};
		this.onStats?.(this.stats);
	}

	private textureFor(channel: ChannelView): THREE.Texture | null {
		switch (channel) {
			case 'final':
				return this.post.output;
			case 'diffuse':
			case 'opacity':
				return this.material.albedo;
			case 'height':
			case 'normal':
				return this.material.normalTex;
			case 'roughness':
			case 'metal':
				return this.material.surface;
			case 'emissive':
			case 'specular':
				return this.material.emissive;
			case 'ao':
				return this.tracer.aoTexture;
			case 'masks':
				return this.material.maskTexture(this.view.mask);
		}
	}

	private draw(): void {
		const project = this.project!;
		const tex = this.textureFor(this.view.channel);
		// (The display pass writes every canvas pixel, the void round the texture included.)
		if (!tex) return this.gpu.clearCanvas(...VOID_COLOR, 1);
		const hs = this.material.heightStats;
		this.display.draw(
			tex,
			this.view.channel,
			[project.width, project.height],
			this.canvasSize,
			this.view.transform,
			this.view.options,
			[hs.min, hs.max > hs.min ? hs.max : hs.min + 1],
			this.view.channel === 'final' ? 1 : this.ss
		);
	}

	// ------------------------------------------------------------------ synchronous rendering (export, harness)

	/** Run the post stack on the traced image (its shader errors reported against 'post'). */
	private runPost(): void {
		this.currentShaderOwner = 'post';
		this.post.run(this.project!, this.traced()!);
		this.postDirty = false;
		this.displayDirty = true;
	}

	/**
	 * Start a deterministic trace (renderNow, renderExport): full quality (no draft) from the first sample, whatever the
	 * interactive loop accumulated meanwhile — otherwise the same project could score differently depending on timing.
	 * The GPU is waited for before tracing here, and the caller waits again after: with several pages rendering at once
	 * (parallel harness workers on ANGLE / D3D11), renders of one project otherwise differed in the last bits from run to
	 * run — enough to send identical optimiser runs apart; with these sync points they match exactly.
	 */
	private beginTrace(): WebGL2RenderingContext {
		this.prepare();
		const gl = this.gpu.gl;
		gl.finish();
		this.tracer.reset();
		return gl;
	}

	/** Render the current project to completion (or `samples`) synchronously and run post. */
	renderNow(samples?: number): void {
		if (!this.project) throw new Error('No project');
		const gl = this.beginTrace();
		const target = samples ?? this.project.render.maxSamples;
		while (this.tracer.samples < target) {
			this.tracer.trace(Math.min(16, target - this.tracer.samples), target);
		}
		gl.finish();
		this.runPost();
		this.kick();
	}

	/**
	 * Render the project for an export (FR8.16a) and `read` the result: `samples` from zero (never fewer than its
	 * maxSamples) at `supersample` (a project supersampled more keeps its own), with jitter on so shadow edges are
	 * antialiased.
	 * Unlike renderNow it traces in chunks with a painted frame between, so the page stays responsive and `onProgress`
	 * (0..1) can show it; `signal` cancels (null is returned). `samples` 0 traces nothing: material maps only. The interactive loop is suspended meanwhile and resumed
	 * with the user's project after.
	 */
	async renderExport<T>(
		opts: { samples: number; supersample: number; signal?: AbortSignal; onProgress?: (f: number) => void },
		read: () => T
	): Promise<T | null> {
		const project = this.project;
		if (!project) throw new Error('No project');
		const r = project.render;
		const target = opts.samples > 0 ? Math.max(r.maxSamples, opts.samples) : 0;
		const supersample = Math.max(supersampleFactor(project), Math.min(4, Math.max(1, Math.round(opts.supersample))));
		const wasSuspended = this.suspended;
		this.suspend();
		try {
			this.setProject({ ...project, render: { ...r, supersample, jitter: true } });
			await this.precompile((this.inner ?? project).layers.map(shaderKey));
			if (opts.signal?.aborted) return null;
			const gl = this.beginTrace();
			// Chunks sized to ~40 ms of GPU work, so a big texture doesn't block for long and a small one isn't held back
			// by a frame per few samples.
			let chunk = 2;
			while (this.tracer.samples < target) {
				const t0 = performance.now();
				this.tracer.trace(Math.min(chunk, target - this.tracer.samples), target);
				gl.finish();
				const ms = performance.now() - t0;
				chunk = Math.max(1, Math.min(256, Math.round(chunk * Math.min(4, 40 / Math.max(1, ms)))));
				opts.onProgress?.(this.tracer.samples / target);
				await painted();
				if (opts.signal?.aborted) return null;
			}
			if (target > 0) this.runPost();
			return read();
		} finally {
			if (wasSuspended) this.setProject(project);
			else this.resume(project);
		}
	}

	/** The traced image at the texture size: the tracer output, box-filtered down when supersampling. */
	private traced(): THREE.Texture | null {
		const src = this.tracer.output;
		if (!src || this.ss <= 1) return src;
		this.down = this.downsample(src, this.down);
		return this.down.texture;
	}

	/** Box-filter a k× texture into `target` (made, or remade, at the texture size). */
	private downsample(src: THREE.Texture, target: THREE.WebGLRenderTarget | null): THREE.WebGLRenderTarget {
		const p = this.project!;
		if (!target || target.width !== p.width || target.height !== p.height) {
			target?.dispose();
			target = this.gpu.target(p.width, p.height);
		}
		this.downMat ??= this.gpu.material(DOWNSAMPLE, { tSrc: { value: null }, uK: { value: 1 } });
		this.downMat.uniforms.tSrc.value = src;
		this.downMat.uniforms.uK.value = this.ss;
		this.gpu.run(this.downMat, target);
		return target;
	}

	/**
	 * The colour the viewport shows at texel (x, y), sRGB 0..1: the albedo in the Diffuse view, the final image in every
	 * other. Null outside the texture or before the first frame.
	 */
	pickColour(x: number, y: number): [number, number, number] | null {
		let v: Float32Array | null;
		if (this.view.channel === 'diffuse') {
			const k = this.ss;
			v = this.material.probe(x * k + (k >> 1), y * k + (k >> 1))?.albedo ?? null;
		} else v = this.post.probe(x, y);
		return v && [linearToSrgb1(clamp01(v[0])), linearToSrgb1(clamp01(v[1])), linearToSrgb1(clamp01(v[2]))];
	}

	/**
	 * The final post-processed image where it is, on the GPU (linear, display-referred, straight alpha; the project's
	 * width × height texels, rows bottom-up), until the next render: for reading it without a round trip through the CPU
	 * (the tiling analysis). Null before the first render.
	 */
	finalTexture(): THREE.Texture | null {
		return this.post.output;
	}

	/** Read the final post-processed image (linear, display-referred), rows top-to-bottom. */
	readFinal(): ImageData32 {
		const p = this.project!;
		const data = this.gpu.readTexture(this.post.output!, p.width, p.height);
		return { width: p.width, height: p.height, data: flipRows(data, p.width, p.height) };
	}

	/** Read the raw HDR path-traced image before post, rows top-to-bottom. */
	readRender(): ImageData32 {
		const p = this.project!;
		const data = this.gpu.readTexture(this.traced()!, p.width, p.height);
		return { width: p.width, height: p.height, data: flipRows(data, p.width, p.height) };
	}

	/** Read the ambient-occlusion map (R = AO, 1 = open). */
	readAO(): ImageData32 {
		this.prepare();
		return this.readAtTextureSize(this.tracer.aoTexture!);
	}

	/** Supersampling factor of the current project (material maps are this many texels per texture pixel). */
	get supersample(): number {
		return this.ss;
	}

	/** Read a k× material map at the texture size (box-filtered on the GPU when supersampling), rows top-to-bottom. */
	private readAtTextureSize(tex: THREE.Texture): ImageData32 {
		const p = this.project!;
		if (this.ss > 1) {
			this.mapDown = this.downsample(tex, this.mapDown);
			tex = this.mapDown.texture;
		}
		const data = this.gpu.readTexture(tex, p.width, p.height);
		return { width: p.width, height: p.height, data: flipRows(data, p.width, p.height) };
	}

	/** Read a material map: 0 albedo, 1 surface (h, rough, metal, sdf), 2 emissive, 3 normal (xyz, h px). */
	readMap(index: 0 | 1 | 2 | 3): ImageData32 {
		this.prepare();
		const m = this.material;
		return this.readAtTextureSize([m.albedo, m.surface, m.emissive, m.normalTex][index]!);
	}

	dispose(): void {
		this.offImages();
		this.stop();
		this.material.dispose();
		this.tracer.dispose();
		this.down?.dispose();
		this.mapDown?.dispose();
		this.downMat?.dispose();
		this.post.dispose();
		this.display.dispose();
		this.gpu.dispose();
	}
}

export function flipRows(data: Float32Array, width: number, height: number): Float32Array {
	const out = new Float32Array(data.length);
	const row = width * 4;
	for (let y = 0; y < height; y++) {
		out.set(data.subarray((height - 1 - y) * row, (height - y) * row), y * row);
	}
	return out;
}
