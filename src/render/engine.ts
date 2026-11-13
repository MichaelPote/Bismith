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
import { capSupersample, scaleProject, supersampleFactor } from '@/core/supersample';
import { clamp01, linearToSrgb1 } from '@/core/color';
import { onImageReady, pendingImages } from '@/core/images';
import { toSrgb8 } from './export';

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

/**
 * The hover probe's gather pass: texel 0 albedo, 1 surface (height, roughness, …), 2 emissive (material texel uM), 3 the
 * final image (texel uF), 4 the viewed mask (uM; distance 1e4 when it has none) — one 5 × 1 read instead of five.
 */
const PROBE = /* glsl */ `
uniform sampler2D tA;
uniform sampler2D tS;
uniform sampler2D tE;
uniform sampler2D tF;
uniform sampler2D tM;
uniform ivec2 uM;
uniform ivec2 uF;
uniform bool uHasF;
uniform bool uHasM;
out vec4 oColor;
void main() {
  int i = int(gl_FragCoord.x);
  vec4 none = vec4(1e4, 0.0, 0.0, 0.0);
  oColor = i == 0 ? texelFetch(tA, uM, 0) : i == 1 ? texelFetch(tS, uM, 0) : i == 2 ? texelFetch(tE, uM, 0)
         : i == 3 ? (uHasF ? texelFetch(tF, uF, 0) : none) : (uHasM ? texelFetch(tM, uM, 0) : none);
}
`;

/** What the viewport shows at one texel (Engine.probeTexel). */
export interface TexelProbe {
	albedo: Float32Array;
	/** Height, roughness, specular, metalness. */
	surface: Float32Array;
	emissive: Float32Array;
	/** The colour shown, sRGB 0..1, as the eyedropper takes it: the final image, or the albedo in Diffuse. */
	colour: [number, number, number] | null;
	/** The viewed mask's distance here (1e4 where it has none). */
	mask: number;
}

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

/** A final (post-processed) image kept for reuse (Engine.bestFinal): sRGB RGBA8 at the texture size. */
export interface KeptFinal {
	samples: number;
	width: number;
	height: number;
	pixels: Uint8ClampedArray;
}

/** How many projects' final images an engine keeps (Engine.bestFinal): an export, the viewport before it was replaced. */
const KEPT_FINALS = 4;

/**
 * What a project's final image depends on: not sample counts, export settings, supersampling or jitter — those change
 * its quality, not what it shows — so a kept render serves any of them.
 */
function imageKey(p: Project): string {
	const { maxSamples, samplesPerFrame, exportSamples, exportSupersample, supersample, jitter, ...look } = p.render;
	return JSON.stringify([
		p.width,
		p.height,
		p.tileable,
		p.heightDepth,
		p.seed,
		p.base,
		p.layers,
		p.groups?.map((g) => [g.id, g.members, g.enabled !== false, g.limit ?? null]),
		p.lighting,
		look,
		p.post
	]);
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
	/** The project `inner` was scaled from (the viewport passes the store's own, edited in place). */
	private innerOf: Project | null = null;
	private down: THREE.WebGLRenderTarget | null = null;
	/** A material map box-filtered to the texture size, for readback. */
	private mapDown: THREE.WebGLRenderTarget | null = null;
	private downMat: THREE.RawShaderMaterial | null = null;
	private probeTarget: THREE.WebGLRenderTarget | null = null;
	private probeMat: THREE.RawShaderMaterial | null = null;
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
	/** Final images worth reusing, by imageKey, oldest first (bestFinal). */
	private finals = new Map<string, KeptFinal>();
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
		// The height range arrives a frame after its evaluation (read back asynchronously): redraw the Height view and the
		// readout with it.
		this.material.onHeightStats = () => {
			this.displayDirty = true;
			this.kick();
		};
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
		const upTo = this.view.previewUpTo;
		// (The keys are taken from the project as it is, with the factor: the k× copy follows from both, so it is built —
		// a deep copy — only when one of them changed, not on every edit.)
		// Groups: their members, on/off and Limit to (planMasks reads it) change the stack.
		const mKey = JSON.stringify([
			project.width,
			project.height,
			this.ss,
			project.tileable,
			project.heightDepth,
			project.seed,
			project.base,
			project.layers,
			upTo,
			project.groups?.map((g) => [g.id, g.members, g.enabled !== false, g.limit ?? null])
		]);
		// Sample counts and export settings don't change the image: raising Max samples continues the accumulation.
		const { maxSamples, samplesPerFrame, exportSamples, exportSupersample, supersample, ...look } = project.render;
		const tKey = JSON.stringify([project.lighting, look, this.ss]);
		const pKey = JSON.stringify(project.post);
		const first = this.materialKey === '';
		if (this.ss <= 1 || this.innerOf !== project || mKey !== this.materialKey || tKey !== this.traceKey) {
			this.inner = scaleProject(project, this.ss);
			this.innerOf = project;
		}
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

	/** Whether the interactive loop is suspended (an optimiser or an off-screen render has the engine). */
	get isSuspended(): boolean {
		return this.suspended;
	}

	/**
	 * Suspend the interactive loop entirely (e.g. while an optimiser drives renderNow() synchronously).
	 * Resuming re-applies `project` (or the last one set) and restarts the loop.
	 */
	suspend(): void {
		// Whatever traces next replaces the viewport's accumulation: keep it if it's the best of its project yet.
		if (!this.suspended && this.project && this.showsFinal()) this.keep(this.project, this.tracer.samples);
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

	/**
	 * Bring material + tracer configuration up to date. `allowDraft` enables the interactive fast preview; without it
	 * (renders, exports, map reads) the result is exact: no layer runs the plain shader while its variant compiles.
	 */
	private prepare(allowDraft = false): void {
		const project = this.inner ?? this.project!;
		const draft = allowDraft && performance.now() - this.lastEdit < this.draftWindowMs;
		if (draft !== this.draft) {
			this.draft = draft;
			this.traceDirty = true;
		}
		if (!allowDraft && this.material.deferred) this.materialDirty = true;
		if (this.materialDirty) {
			const t0 = performance.now();
			this.shaderErrors.clear();
			this.material.evaluate(project, this.view.previewUpTo ?? Infinity, !allowDraft);
			this.stats.evalMs = performance.now() - t0;
			this.materialDirty = false;
			this.traceDirty = true;
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
		// (Post only for the Final view: a material channel shows none of it. What reads the final image brings it up to
		// date first — currentPost.)
		if (this.view.channel === 'final') this.currentPost();
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
		// (The same object while nothing changed: the stats go out every frame, and a new errors object re-renders
		// everything that shows them — the Outliner, eight times a second while tracing.)
		const prev = this.stats.errors;
		const same =
			Object.keys(errors).length === Object.keys(prev).length &&
			Object.entries(errors).every(([k, v]) => prev[k] === v);
		this.stats = {
			...this.stats,
			samples: this.tracer.samples,
			maxSamples: project.render.maxSamples,
			samplesPerSec: this.sampleTimes.reduce((n, [, c]) => n + c, 0),
			draft: this.draft,
			heightMin: this.material.heightStats.min / this.ss,
			heightMax: this.material.heightStats.max / this.ss,
			errors: same ? prev : errors
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
				return this.tracer.aoFor(this.inner ?? this.project!, this.material);
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

	/** Run post if the traced image changed since it last ran (before anything reads the final image). */
	private currentPost(): void {
		if (this.postDirty && this.tracer.output) this.runPost();
	}

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
		// The loop isn't running for headless renders: their errors (stats.errors) are this evaluation's.
		this.updateStats();
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
		opts: {
			samples: number;
			supersample: number;
			/** Trace exactly `samples` (a preview), not at least the project's Max samples. */
			exact?: boolean;
			signal?: AbortSignal;
			onProgress?: (f: number) => void;
			/** Render this project (a variant, FR10) in place of the one shown; the shown one is resumed after. */
			project?: Project;
		},
		read: () => T
	): Promise<T | null> {
		const shown = this.project;
		const project = opts.project ?? shown;
		if (!project || !shown) throw new Error('No project');
		const r = project.render;
		const target = opts.samples > 0 ? (opts.exact ? opts.samples : Math.max(r.maxSamples, opts.samples)) : 0;
		const supersample = capSupersample(project, Math.max(supersampleFactor(project), opts.supersample));
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
			if (target > 0 && this.view.previewUpTo === null) this.keep(project, target);
			return read();
		} finally {
			if (wasSuspended) this.setProject(shown);
			else this.resume(shown);
		}
	}

	/** The viewport shows its project's final image: the whole stack, at full quality, with samples traced. */
	private showsFinal(): boolean {
		return this.view.previewUpTo === null && !this.draft && this.tracer.samples > 0;
	}

	/** Keep the final image now on the GPU as `project`'s, when it has more samples than the one kept. */
	private keep(project: Project, samples: number): void {
		const key = imageKey(project);
		if ((this.finals.get(key)?.samples ?? 0) >= samples) return;
		const img = this.readFinal();
		this.finals.delete(key);
		this.finals.set(key, { samples, width: img.width, height: img.height, pixels: toSrgb8(img) });
		while (this.finals.size > KEPT_FINALS) this.finals.delete(this.finals.keys().next().value!);
	}

	/**
	 * The most-sampled final image of `project` (by default the one shown) that this engine has without tracing: the
	 * viewport's own when it shows that project in full, or one kept from an export or from the viewport before something
	 * else was traced. Null when it has none. Use it before rendering a preview or thumbnail.
	 */
	bestFinal(project?: Project): KeptFinal | null {
		const p = project ?? this.project;
		if (!p) return null;
		const key = imageKey(p);
		const kept = this.finals.get(key) ?? null;
		const live =
			!this.suspended && this.project && this.showsFinal() && imageKey(this.project) === key ? this.tracer.samples : 0;
		if (live <= (kept?.samples ?? 0)) return kept;
		const img = this.readFinal();
		return { samples: live, width: img.width, height: img.height, pixels: toSrgb8(img) };
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
		} else {
			this.currentPost();
			v = this.post.probe(x, y);
		}
		return v && [linearToSrgb1(clamp01(v[0])), linearToSrgb1(clamp01(v[1])), linearToSrgb1(clamp01(v[2]))];
	}

	/**
	 * Everything the viewport's readout shows at texel (x, y) of the texture (user space: y down) — the material there,
	 * the colour shown and `mask`'s distance — gathered into one small target and read back asynchronously, so hovering
	 * never stalls the GPU (a synchronous read waits for every traced frame queued). The final image is as the last post
	 * left it: in a material view it can lag the trace by a few samples. Null outside the texture or before the first
	 * evaluation.
	 */
	async probeTexel(x: number, y: number, mask: string): Promise<TexelProbe | null> {
		const p = this.project;
		const { albedo, surface, emissive } = this.material;
		if (!p || !albedo || !surface || !emissive || x < 0 || y < 0 || x >= p.width || y >= p.height) return null;
		const k = this.ss;
		const { height } = this.material.size;
		const final = this.post.output;
		const maskTex = this.material.maskTexture(mask);
		this.probeTarget ??= this.gpu.target(5, 1);
		this.probeMat ??= this.gpu.material(PROBE, {
			tA: { value: null },
			tS: { value: null },
			tE: { value: null },
			tF: { value: null },
			tM: { value: null },
			uM: { value: new THREE.Vector2() },
			uF: { value: new THREE.Vector2() },
			uHasF: { value: false },
			uHasM: { value: false }
		});
		const u = this.probeMat.uniforms;
		u.tA.value = albedo;
		u.tS.value = surface;
		u.tE.value = emissive;
		u.tF.value = final ?? albedo;
		u.tM.value = maskTex ?? albedo;
		u.uM.value.set(x * k + (k >> 1), height - 1 - (y * k + (k >> 1)));
		u.uF.value.set(x, p.height - 1 - y);
		u.uHasF.value = !!final;
		u.uHasM.value = !!maskTex;
		this.gpu.run(this.probeMat, this.probeTarget);
		const buf = new Float32Array(20);
		await this.gpu.renderer.readRenderTargetPixelsAsync(this.probeTarget, 0, 0, 5, 1, buf);
		const texel = (i: number) => buf.slice(i * 4, i * 4 + 4);
		const shown = this.view.channel === 'diffuse' ? texel(0) : final ? texel(3) : null;
		return {
			albedo: texel(0),
			surface: texel(1),
			emissive: texel(2),
			colour: shown && [
				linearToSrgb1(clamp01(shown[0])),
				linearToSrgb1(clamp01(shown[1])),
				linearToSrgb1(clamp01(shown[2]))
			],
			mask: buf[16]
		};
	}

	/**
	 * The final post-processed image where it is, on the GPU (linear, display-referred, straight alpha; the project's
	 * width × height texels, rows bottom-up), until the next render: for reading it without a round trip through the CPU
	 * (the tiling analysis). Null before the first render.
	 */
	finalTexture(): THREE.Texture | null {
		this.currentPost();
		return this.post.output;
	}

	/** Read the final post-processed image (linear, display-referred), rows top-to-bottom. */
	readFinal(): ImageData32 {
		this.currentPost();
		return this.readTopDown(this.post.output!);
	}

	/** Read the raw HDR path-traced image before post, rows top-to-bottom. */
	readRender(): ImageData32 {
		return this.readTopDown(this.traced()!);
	}

	/** Read the ambient-occlusion map (R = AO, 1 = open). */
	readAO(): ImageData32 {
		this.prepare();
		return this.readAtTextureSize(this.tracer.aoFor(this.inner ?? this.project!, this.material)!);
	}

	/** Supersampling factor of the current project (material maps are this many texels per texture pixel). */
	get supersample(): number {
		return this.ss;
	}

	/** Read a k× material map at the texture size (box-filtered on the GPU when supersampling), rows top-to-bottom. */
	private readAtTextureSize(tex: THREE.Texture): ImageData32 {
		if (this.ss > 1) {
			this.mapDown = this.downsample(tex, this.mapDown);
			tex = this.mapDown.texture;
		}
		return this.readTopDown(tex);
	}

	/** Read a texture at the texture size (the project's width × height texels), rows top-to-bottom. */
	private readTopDown(tex: THREE.Texture): ImageData32 {
		const { width, height } = this.project!;
		return { width, height, data: this.gpu.readTopDown(tex, width, height) };
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
		this.probeTarget?.dispose();
		this.probeMat?.dispose();
		this.post.dispose();
		this.display.dispose();
		this.gpu.dispose();
	}
}
