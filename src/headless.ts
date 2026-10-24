// window.__bismith — the API the Playwright harness (tools/harness.ts) drives. See docs/features/fr6.2.

import type { Project } from '@/core/project';
import { normalizeProject } from '@/core/serialize';
import { Engine } from '@/render/engine';
import { mapPixels, pixelsToDataURL, type MapKind } from '@/render/export';
import { capturePreview } from '@/render/preview';
import {
	Matcher,
	absDiff,
	fromRgba8,
	heatOverlay,
	toRgba8,
	type MatchImage,
	type MetricOptions,
	type MetricResult
} from '@/match/metrics';
import { Optimizer, type OptimizerOptions, type StepInfo } from '@/match/optimizer';
import { analyzeTiling, type TilingAnalysis, type TilingFrame, type TilingOptions } from '@/tiling/analyze';
import { attributeTiling, type Finding, type LayerBlame } from '@/tiling/attribute';
import { checkTilingGpu, tilingGpu } from '@/tiling/gpu';
import {
	fixTiling,
	type FixCandidate,
	type FixChange,
	type FixOptions,
	type FixResult,
	type FixTrial
} from '@/tiling/fix';
import { renderFrame, tilingEvaluator } from '@/tiling/evaluate';
import { attachTexture, makeEvaluator, renderToMatchImage } from '@/match/evaluate';
import { TextureNet, matchHistogram } from '@/match/vgg';
import { fitColours as fitColoursImpl } from '@/match/colourFit';
import { emulate as runEmulate, type EmulateOptions, type EmulateResult } from '@/match/emulate';

export interface HeadlessRenderResult {
	width: number;
	height: number;
	/** data:image/png;base64,… */
	png: string;
	samples: number;
	ms: number;
	errors: Record<string, string>;
}

/**
 * A reference image: a PNG/JPEG data URL (decoded in the page without colour management), or raw 8-bit
 * sRGB RGBA (base64 string or byte array) — the harness sends the latter, decoded exactly by pngjs.
 */
export type TargetInput = string | { width: number; height: number; rgba: string | number[] };

export interface CompareOptions extends MetricOptions {
	/** Samples per pixel for the render (default: the project's maxSamples). */
	samples?: number;
	/** Gain applied to the difference image (default 2). */
	diffGain?: number;
}

export interface HeadlessCompareResult extends MetricResult {
	/** Render, target and |difference| at the comparison size (PNG data URLs). */
	renderPng: string;
	targetPng: string;
	diffPng: string;
	samples: number;
	ms: number;
}

export interface HeadlessOptimizeOptions extends OptimizerOptions {
	/** Optimiser steps for optimize() (each evaluates `lambda` candidates). Default 30. */
	iters?: number;
	/** Samples per evaluation render (deterministic; default 16). */
	samples?: number;
	/** Samples for the final comparison render of the best project (default 64). */
	finalSamples?: number;
	/** Metric preset / weights / size options. */
	metric?: MetricOptions;
}

export interface HeadlessOptimizeStart {
	initialLoss: number;
	entries: number;
	width: number;
	height: number;
}

export interface HeadlessOptimizeResult {
	bestProject: Project;
	bestLoss: number;
	initialLoss: number;
	evaluations: number;
	history: StepInfo[];
	/** Metric breakdown + images of the best project re-rendered at finalSamples. */
	compare: HeadlessCompareResult;
}

export interface BismithHeadless {
	ready: boolean;
	engine: Engine;
	loadProject(project: unknown): Project;
	getProject(): Project | null;
	render(opts?: { samples?: number }): HeadlessRenderResult;
	renderMaps(kinds?: MapKind[]): Record<string, string>;
	/**
	 * A mask as the last render left it (FR8.23), at the render's size (supersampled), rows bottom-to-top: per texel its
	 * distance (px), random and feature flag. Null when nothing writes it.
	 */
	maskData(
		name: string
	): { width: number; height: number; distance: number[]; random: number[]; feature: number[] } | null;
	/** Render the current project and score it against a reference. */
	compare(target: TargetInput, opts?: CompareOptions): Promise<HeadlessCompareResult>;
	/** Run a whole optimisation in-page; the current project becomes the best one. */
	optimize(target: TargetInput, opts?: HeadlessOptimizeOptions): Promise<HeadlessOptimizeResult>;
	/** Step-wise optimisation (lets the harness print progress): start → step(n)… → finish. */
	optimizeStart(target: TargetInput, opts?: HeadlessOptimizeOptions): Promise<HeadlessOptimizeStart>;
	optimizeStep(steps?: number): Promise<StepInfo[]>;
	/** The best project so far (without finishing). */
	optimizeBest(): { project: Project; loss: number } | null;
	/** GPU objects alive (three.js renderer.info.memory) — for spotting leaks. */
	memoryInfo(): { textures: number; geometries: number };
	optimizeFinish(): Promise<HeadlessOptimizeResult>;
	/** WebGL renderer string (to confirm GPU vs SwiftShader). */
	rendererInfo(): string;
	/** The final image as a project preview (FR8.20; render first) — undefined before anything has rendered. */
	preview(): string | undefined;
	/**
	 * Compile generator shaders ahead of use, all at once (parallel where the browser can); returns the wall time.
	 * `cold`: salt the shaders first, so neither the browser's nor the driver's shader cache can answer.
	 */
	precompile(types: string[], opts?: { cold?: boolean }): Promise<{ ms: number; parallel: boolean }>;
	/** Automatic emulation of a reference (templates → race → optimise); the best becomes the current project. */
	emulate(target: TargetInput, opts?: EmulateOptions): Promise<HeadlessEmulateResult>;
	/**
	 * VGG texture distance of `a` to `b` (same size; `colourMatch` first matches a's colours to b's, as the metric's
	 * texture term does) — for checking the GPU network against a reference implementation.
	 */
	textureDistance(
		a: TargetInput,
		b: TargetInput,
		opts?: { wrap?: boolean; colourMatch?: boolean }
	): Promise<{ distance: number; ms: number }>;
	/** Tiling analysis of the current project and, per layer, how much it is to blame (FR9). */
	tiling(opts?: HeadlessTilingOptions): Promise<HeadlessTilingResult>;
	/**
	 * Fix the current project's tiling (FR9): reseed and nudge the blamed layers, tiling score down with the look held
	 * (Windows preset against the render before). The fixed project becomes the current one.
	 */
	tilingFix(opts?: HeadlessTilingFixOptions): Promise<HeadlessTilingFixResult>;
	/** Fit the current project's colours to a reference (FR8.2; smart materials through their colour controls). */
	fitColours(
		target: TargetInput,
		opts?: { samples?: number; rounds?: number }
	): Promise<{ before: number; after: number; rounds: number; project: Project }>;
}

export interface HeadlessTilingOptions extends TilingOptions {
	/** Samples per render (default 32; the leave-one-out renders use the same, so noise cancels). */
	samples?: number;
	/** Also return each layer's contribution map (ΔE, as a heat overlay PNG): every layer's, or the top N culprits'. */
	maps?: boolean | number;
	/** Analyse only, no leave-one-out (default false). */
	analysisOnly?: boolean;
	/** Also analyse each leave-one-out render, for the layers' `without` (default false: a whole analysis per layer). */
	without?: boolean;
	/** Analyse on the CPU (the reference implementation) instead of the GPU. */
	cpu?: boolean;
	/** Also check the GPU analysis of the render against the CPU's (`gpuCheck`). */
	checkGpu?: boolean;
}

export interface HeadlessTilingResult {
	score: number;
	raw: TilingAnalysis['raw'];
	terms: TilingAnalysis['terms'];
	/** The render and its hotspot overlay (one tile, PNG data URLs). */
	renderPng: string;
	hotspotPng: string;
	layers: (Omit<LayerBlame, 'map'> & { mapPng?: string })[];
	findings: Finding[];
	renders: number;
	ms: number;
	/** Whether the GPU analysed (else the CPU: asked for, or the GPU failed its check). */
	gpu: boolean;
	/** With `checkGpu`: the GPU kernels and analysis against the CPU's on the render, and both timed (null: no GPU). */
	gpuCheck?: (NonNullable<ReturnType<typeof checkTilingGpu>> & { gpuMs: number; cpuMs: number }) | null;
}

export interface HeadlessTilingFixOptions extends HeadlessTilingOptions, FixOptions {}

export interface HeadlessTilingFixResult {
	before: { score: number; drift: number; terms: TilingAnalysis['terms'] };
	after: { score: number; drift: number; terms: TilingAnalysis['terms'] };
	changes: FixChange[];
	trials: FixTrial[];
	driftFree: number;
	/** The culprits found before the fix (names and what they were blamed for). */
	findings: { name: string; term: string; weight: number }[];
	/** Renders and hotspot overlays before and after (one tile, PNG data URLs). */
	beforePng: string;
	afterPng: string;
	hotspotBeforePng: string;
	hotspotAfterPng: string;
	/** The fixed project (also loaded as the current one). */
	project: Project;
	evaluations: number;
	ms: number;
	/** Whether the GPU analysed. */
	gpu: boolean;
}

export interface HeadlessEmulateResult extends EmulateResult {
	renderPng: string;
	targetPng: string;
	diffPng: string;
}

declare global {
	interface Window {
		__bismith?: BismithHeadless;
	}
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Decode a reference image to a MatchImage (sRGB 0..1). */
export async function decodeTarget(t: TargetInput): Promise<MatchImage> {
	if (typeof t !== 'string') {
		const bytes = typeof t.rgba === 'string' ? base64ToBytes(t.rgba) : Uint8Array.from(t.rgba);
		return fromRgba8(bytes, t.width, t.height);
	}
	const blob = await (await fetch(t)).blob();
	const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
	const canvas = document.createElement('canvas');
	canvas.width = bmp.width;
	canvas.height = bmp.height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(bmp, 0, 0);
	const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
	bmp.close();
	return fromRgba8(data, canvas.width, canvas.height);
}

function imagePng(img: MatchImage): string {
	return pixelsToDataURL(toRgba8(img), img.width, img.height);
}

function compareResult(
	matcher: Matcher,
	render: MatchImage,
	samples: number,
	t0: number,
	diffGain = 2
): HeadlessCompareResult {
	const fitted = matcher.fit(render);
	const r = matcher.score(render);
	return {
		...r,
		renderPng: imagePng(fitted),
		targetPng: imagePng(matcher.target),
		diffPng: imagePng(absDiff(fitted, matcher.target, diffGain)),
		samples,
		ms: performance.now() - t0
	};
}

export function installHeadless(engine: Engine): BismithHeadless {
	let project: Project | null = null;
	let session: { optimizer: Optimizer; matcher: Matcher; opts: HeadlessOptimizeOptions } | null = null;

	const need = () => {
		if (!project) throw new Error('loadProject first');
		return project;
	};

	const api: BismithHeadless = {
		ready: true,
		engine,
		loadProject(p) {
			project = normalizeProject(typeof p === 'string' ? JSON.parse(p) : p);
			engine.setProject(project);
			return project;
		},
		getProject: () => project,
		render(opts = {}) {
			const p = need();
			const t0 = performance.now();
			engine.renderNow(opts.samples ?? p.render.maxSamples);
			const { width, height, pixels } = mapPixels(engine, 'final');
			return {
				width,
				height,
				png: pixelsToDataURL(pixels, width, height),
				samples: engine.tracer.samples,
				ms: performance.now() - t0,
				errors: engine.stats.errors
			};
		},
		maskData(name) {
			const tex = engine.material.maskTexture(name);
			if (!tex) return null;
			const { width, height } = engine.material.size;
			const d = engine.gpu.readTexture(tex, width, height);
			const pick = (c: number) => Array.from({ length: width * height }, (_, i) => d[i * 4 + c]);
			return { width, height, distance: pick(0), random: pick(1), feature: pick(2) };
		},

		renderMaps(kinds = ['diffuse', 'height', 'roughness', 'specular', 'ao', 'normal-gl', 'emissive', 'opacity']) {
			const out: Record<string, string> = {};
			for (const k of kinds) {
				const { width, height, pixels } = mapPixels(engine, k);
				out[k] = pixelsToDataURL(pixels, width, height);
			}
			return out;
		},

		async compare(target, opts = {}) {
			const p = need();
			const t0 = performance.now();
			const img = await decodeTarget(target);
			// Same matcher as the Match workspace: periodic comparison for tileable projects, the VGG texture term
			// whenever the preset weights it.
			const matcher = new Matcher(img, {
				wrap: p.tileable,
				window: !p.tileable,
				...opts,
				size: opts.size ?? [p.width, p.height]
			});
			await attachTexture(engine, matcher, opts.wrap ?? p.tileable);
			const samples = opts.samples ?? p.render.maxSamples;
			try {
				return compareResult(matcher, renderToMatchImage(engine, p, samples), samples, t0, opts.diffGain);
			} finally {
				matcher.dispose();
			}
		},

		async optimizeStart(target, opts = {}) {
			const p = need();
			const img = await decodeTarget(target);
			const matcher = new Matcher(img, {
				wrap: p.tileable,
				window: !p.tileable,
				...opts.metric,
				size: opts.metric?.size ?? [p.width, p.height]
			});
			await attachTexture(engine, matcher, opts.metric?.wrap ?? p.tileable);
			const samples = opts.samples ?? 16;
			const optimizer = new Optimizer(p, makeEvaluator(engine, matcher, { samples }), {
				target: matcher.target,
				...opts
			});
			session?.matcher.dispose();
			session = { optimizer, matcher, opts };
			const initialLoss = await optimizer.init();
			return { initialLoss, entries: optimizer.space.entries.length, width: matcher.width, height: matcher.height };
		},

		async optimizeStep(steps = 1) {
			if (!session) throw new Error('optimizeStart first');
			return session.optimizer.run(steps);
		},

		optimizeBest() {
			if (!session) return null;
			const b = session.optimizer.best;
			return { project: b.project, loss: b.loss };
		},

		async optimizeFinish() {
			if (!session) throw new Error('optimizeStart first');
			const { optimizer, matcher, opts } = session;
			const best = optimizer.best;
			const t0 = performance.now();
			const finalSamples = opts.finalSamples ?? 64;
			api.loadProject(best.project);
			const compare = compareResult(matcher, renderToMatchImage(engine, project!, finalSamples), finalSamples, t0);
			session = null;
			return {
				bestProject: best.project,
				bestLoss: best.loss,
				initialLoss: optimizer.initialLoss ?? best.loss,
				evaluations: optimizer.evaluations,
				history: optimizer.history,
				compare
			};
		},

		async optimize(target, opts = {}) {
			await api.optimizeStart(target, opts);
			await api.optimizeStep(opts.iters ?? 30);
			return api.optimizeFinish();
		},

		rendererInfo: () => rendererString(engine),
		preview: () => capturePreview(engine),
		memoryInfo: () => ({ ...engine.gpu.renderer.info.memory }),
		async precompile(types, opts = {}) {
			if (opts.cold) engine.setShaderSalt(`${Date.now()}-${Math.random()}`);
			const t = performance.now();
			await engine.precompile(types);
			return { ms: performance.now() - t, parallel: engine.parallelCompile };
		},

		async fitColours(target, opts = {}) {
			const p = need();
			const img = await decodeTarget(target);
			const matcher = new Matcher(img, {
				preset: 'tile',
				wrap: p.tileable,
				window: !p.tileable,
				size: [p.width, p.height]
			});
			await attachTexture(engine, matcher, p.tileable);
			// Palette snap off while fitting (a quantised render moves in steps), back as it was afterwards.
			const snap = (q: Project, on: boolean): Project => ({
				...q,
				post: q.post.map((f) => (f.type === 'palette' ? { ...f, enabled: on && f.enabled } : f))
			});
			const palOn = new Map(p.post.map((f) => [f.id, f.enabled]));
			const r = await fitColoursImpl(
				snap(p, false),
				matcher,
				(q) => renderToMatchImage(engine, q, opts.samples ?? 16),
				{ rounds: opts.rounds }
			).finally(() => matcher.dispose());
			const fitted = {
				...r.project,
				post: r.project.post.map((f) => ({ ...f, enabled: palOn.get(f.id) ?? f.enabled }))
			};
			api.loadProject(fitted);
			return { before: r.before, after: r.after, rounds: r.rounds, project: project! };
		},

		async tiling(opts = {}) {
			const p = need();
			const t0 = performance.now();
			const samples = opts.samples ?? 32;
			const gpu = opts.cpu ? null : tilingGpu(engine.gpu);
			let renders = 0;
			const render = (q: Project) => {
				renders++;
				return renderFrame(engine, q, samples, gpu);
			};
			let r: { frame: TilingFrame; analysis: TilingAnalysis; layers: LayerBlame[]; findings: Finding[] };
			if (opts.analysisOnly) {
				const frame = render(p);
				r = { frame, analysis: analyzeTiling(frame, opts, gpu), layers: [], findings: [] };
			} else
				r = await attributeTiling(p, render, { ...opts, maps: !!opts.maps, gpu }).finally(() => engine.setProject(p));
			const { frame } = r;
			const { width, height, L } = frame;
			const peak = (m: Float32Array) => m.reduce((a, v) => Math.max(a, v), 0) || 1;
			// Contribution maps of every layer, or of the top N culprits.
			const mapped =
				typeof opts.maps === 'number'
					? new Set([...new Set(r.findings.map((f) => f.layer))].slice(0, opts.maps))
					: null;
			let gpuCheck: HeadlessTilingResult['gpuCheck'];
			if (opts.checkGpu) {
				const k = tilingGpu(engine.gpu);
				const time = (f: () => unknown) => {
					const t = performance.now();
					f();
					return performance.now() - t;
				};
				const check = k && checkTilingGpu(k, frame);
				gpuCheck = check
					? {
							...check,
							gpuMs: time(() => analyzeTiling(frame, opts, k)),
							cpuMs: time(() => analyzeTiling(frame, opts))
						}
					: null;
				k?.release();
			}
			gpu?.release();
			return {
				score: r.analysis.score,
				raw: r.analysis.raw,
				terms: r.analysis.terms,
				renderPng: imagePng(frame.image),
				hotspotPng: imagePng(heatOverlay(L, r.analysis.maps.hotspot, width, height)),
				layers: r.layers.map(({ map, ...l }, i) => {
					if (!map || (mapped && !mapped.has(i))) return l;
					const k = peak(map);
					return {
						...l,
						mapPng: imagePng(
							heatOverlay(
								L,
								map.map((v) => v / k),
								width,
								height
							)
						)
					};
				}),
				findings: r.findings,
				renders,
				ms: performance.now() - t0,
				gpu: !!gpu,
				gpuCheck
			};
		},

		async tilingFix(opts = {}) {
			const p = need();
			const t0 = performance.now();
			const samples = opts.samples ?? 32;
			const gpu = opts.cpu ? null : tilingGpu(engine.gpu);
			const attribution = await attributeTiling(p, (q) => renderFrame(engine, q, samples, gpu), {
				...opts,
				maps: false,
				gpu
			});
			const { frame, analysis } = attribution;
			const ev = await tilingEvaluator(engine, frame, { samples, analysis: opts, gpu });
			let r: FixResult;
			try {
				r = await fixTiling(p, attribution, (q, bar) => ev.evaluate(q, bar), {
					...opts,
					before: { score: analysis.score, drift: 0, detail: { frame, analysis } }
				});
			} finally {
				ev.dispose();
			}
			// Before and after as the search saw them (rendered again only if it didn't keep them).
			const side = (c: FixCandidate) => {
				const f = c.detail?.frame ?? ev.render(c.project);
				const a = c.detail?.analysis ?? analyzeTiling(f, opts, gpu);
				return {
					score: { score: c.score, drift: c.drift, terms: a.terms },
					png: imagePng(f.image),
					hotspot: imagePng(heatOverlay(f.L, a.maps.hotspot, f.width, f.height))
				};
			};
			const before = side(r.before);
			const after = side(r.after);
			gpu?.release();
			api.loadProject(r.project);
			return {
				before: before.score,
				after: after.score,
				changes: r.changes,
				trials: r.trials,
				driftFree: r.driftFree,
				findings: attribution.findings.map((f) => ({
					name: attribution.layers[f.layer].name,
					term: f.term,
					weight: f.weight
				})),
				beforePng: before.png,
				afterPng: after.png,
				hotspotBeforePng: before.hotspot,
				hotspotAfterPng: after.hotspot,
				project: project!,
				evaluations: r.evaluations,
				ms: performance.now() - t0,
				gpu: !!gpu
			};
		},

		async textureDistance(a, b, opts = {}) {
			const net = await TextureNet.load(engine.gpu);
			const ia = await decodeTarget(a);
			const ib = await decodeTarget(b);
			const t0 = performance.now();
			const distance = net.compare(opts.colourMatch ? matchHistogram(ia, ib) : ia, ib, opts.wrap ?? true);
			return { distance, ms: performance.now() - t0 };
		},

		async emulate(target, opts = {}) {
			const img = await decodeTarget(target);
			const result = await runEmulate(engine, img, opts);
			api.loadProject(result.bestProject);
			const matcher = new Matcher(img, { weights: result.final.weights, size: [img.width, img.height], maxSize: 4096 });
			const render = renderToMatchImage(engine, project!, opts.finalSamples ?? 128);
			const c = compareResult(matcher, render, opts.finalSamples ?? 128, performance.now(), 2);
			return { ...result, renderPng: c.renderPng, targetPng: c.targetPng, diffPng: c.diffPng };
		}
	};
	window.__bismith = api;
	return api;
}

export function rendererString(engine: Engine): string {
	const gl = engine.gpu.gl;
	const ext = gl.getExtension('WEBGL_debug_renderer_info');
	return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

/** Minimal page for ?headless: a hidden canvas and the API (plus the job loop in worker mode). */
export function bootHeadless(root: HTMLElement): void {
	const canvas = document.createElement('canvas');
	canvas.width = 64;
	canvas.height = 64;
	root.appendChild(canvas);
	const engine = new Engine(canvas);
	// No interactive loop: nothing is displayed, and its frames would trace between API calls.
	engine.suspend();
	const api = installHeadless(engine);
	const worker = new URLSearchParams(location.search).get('worker');
	if (worker !== null) void workerLoop(api, worker);
}

/**
 * Worker mode (tools/backend.ts, windows backend): pull jobs `{ id, method, args }` from the dev server's
 * long-poll queue, run `window.__bismith[method](...args)`, post `{ id, ok, result | error }` back.
 */
async function workerLoop(api: BismithHeadless, worker: string): Promise<void> {
	const q = `?worker=${encodeURIComponent(worker)}`;
	const post = (path: string, body: unknown) =>
		fetch(`/__bismith/${path}${q}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	const forward = (level: string) => {
		const orig = console[level as 'error'];
		console[level as 'error'] = (...a: unknown[]) => {
			orig.apply(console, a);
			void post('log', { level, text: a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ') }).catch(
				() => {}
			);
		};
	};
	forward('error');
	forward('warn');
	window.addEventListener('error', (e) => void post('log', { level: 'pageerror', text: e.message }).catch(() => {}));
	await post('hello', { renderer: api.rendererInfo() });
	const methods = api as unknown as Record<string, (...a: unknown[]) => unknown>;
	for (;;) {
		let job: { id: number; method: string; args: unknown[] } | null = null;
		try {
			const res = await fetch(`/__bismith/job${q}`);
			if (res.status !== 200) continue;
			job = await res.json();
		} catch {
			await new Promise((r) => setTimeout(r, 1000));
			continue;
		}
		if (!job) continue;
		try {
			if (typeof methods[job.method] !== 'function') throw new Error(`unknown method ${job.method}`);
			const result = await methods[job.method](...job.args);
			await post('result', { id: job.id, ok: true, result: result === undefined ? null : result });
		} catch (e) {
			await post('result', { id: job.id, ok: false, error: e instanceof Error ? e.message : String(e) });
		}
	}
}
