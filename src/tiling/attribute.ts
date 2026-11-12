// Which layer makes the repeat obvious (docs/features/fr9-tiling-workspace.md): leave one out. Each enabled layer — or
// pattern, the layers of one type sharing a seed, which are copies of one pattern — is switched off in turn and the
// project rendered again; the difference to the full render is what it contributes, through every route (its paint,
// the lighting of its height, the masks later layers read from it).
//
// Blame is concentration, not size: per term, the layer's mean contribution inside that term's hotspots minus its mean
// contribution elsewhere. A base fill or an even noise changes a lot when removed, but everywhere alike — no blame; a
// layer whose contribution piles up where the repeat draws the eye is the culprit. Both are measured at the analysis'
// work size, where its maps are.
//
//   const r = await attributeTiling(project, (p) => renderFrame(engine, p, 32, gpu))

import { hiddenByGroup, type Project } from '@/core/project';
import type { MatchImage } from '@/match/image';
import {
	TILING_TERMS,
	TilingFrame,
	analyzeTiling,
	frameLab,
	upsample,
	type TilingAnalysis,
	type TilingKernelSource,
	type TilingOptions,
	type TilingTerm
} from './analyze';

export interface LayerBlame {
	/** The layers switched off together (one, or the copies of one pattern). */
	ids: string[];
	name: string;
	type: string;
	/** The group the layers belong to, if any. */
	group?: string;
	/** Mean OKLab ΔE the layers add over the whole tile. */
	contribution: number;
	/** Per term: mean ΔE inside the term's hotspots minus outside (≤ 0: not concentrated there). */
	blame: Record<TilingTerm, number>;
	/** The tiling analysis without these layers (score and terms), when `without` was asked for. */
	without?: { score: number; terms: Record<TilingTerm, number> };
	/** Per-pixel ΔE at the frame's size (for showing what the layers add), when `maps` was asked for. */
	map?: Float32Array;
}

export interface Finding {
	term: TilingTerm;
	/** Index into `layers`. */
	layer: number;
	/** How much it matters: the term's normalised value × the layer's blame for it, relative to the largest blame. */
	weight: number;
}

export interface TilingAttribution {
	/** The full render, and its analysis. */
	frame: TilingFrame;
	analysis: TilingAnalysis;
	layers: LayerBlame[];
	/** Culprits ranked: per term, the layers with clearly positive blame, most important first. */
	findings: Finding[];
}

export interface AttributeOptions extends TilingOptions {
	/** Keep each layer's contribution map (default false). */
	maps?: boolean;
	/** Also analyse each leave-one-out render, for `LayerBlame.without` (default false: a whole analysis per layer). */
	without?: boolean;
	/** Computes the analysis' kernels (the GPU, src/tiling/gpu.ts); the CPU without. */
	gpu?: TilingKernelSource | null;
	/** Called after each leave-one-out render (done, total). */
	onProgress?: (done: number, total: number) => void;
}

/**
 * Renders a project. `lazy`: only the analysis' kernels read the frame, so a GPU frame may stay unread (renderFrame's
 * `lazy`) — it is done with before the next render.
 */
type Render = (p: Project, opts: { lazy: boolean }) => TilingFrame | MatchImage | Promise<TilingFrame | MatchImage>;

const asFrame = (r: TilingFrame | MatchImage) => (r instanceof TilingFrame ? r : TilingFrame.of(r));

/** The units to leave out: each enabled, shown layer on its own, pattern copies (same type and seed) together. */
export function blameUnits(project: Project): string[][] {
	const hidden = hiddenByGroup(project);
	const units = new Map<string, string[]>();
	for (const l of project.layers) {
		if (!l.enabled || hidden.has(l.id)) continue;
		const key = l.params.seed !== undefined ? `${l.type}\u0000${String(l.params.seed)}` : `\u0000${l.id}`;
		const u = units.get(key);
		if (u) u.push(l.id);
		else units.set(key, [l.id]);
	}
	return [...units.values()];
}

/** The project with `ids` switched off. */
export function without(project: Project, ids: string[]): Project {
	const off = new Set(ids);
	return { ...project, layers: project.layers.map((l) => (off.has(l.id) ? { ...l, enabled: false } : l)) };
}

export async function attributeTiling(
	project: Project,
	render: Render,
	opts: AttributeOptions = {}
): Promise<TilingAttribution> {
	const frame = asFrame(await render(project, { lazy: false }));
	const analysis = analyzeTiling(frame, opts, opts.gpu);
	const { width: w, height: h } = analysis.work;
	const full = analysis.lab;
	const n = w * h;

	// Per term, the hotspot weight of each pixel: the term's map relative to its peak; and the weights' sums in and out.
	const hot = TILING_TERMS.map((t) => {
		const m = analysis.work[t];
		let peak = 0;
		for (let i = 0; i < n; i++) peak = Math.max(peak, m[i]);
		const h = peak > 0 ? m.map((v) => v / peak) : new Float32Array(n);
		let wi = 0;
		let wo = 0;
		for (let i = 0; i < n; i++) {
			wi += h[i];
			wo += 1 - h[i];
		}
		return { t, h, wi, wo };
	});

	const units = blameUnits(project);
	const byId = new Map(project.layers.map((l) => [l.id, l]));
	const groupOf = new Map<string, string>();
	for (const g of project.groups ?? []) for (const id of g.members) groupOf.set(id, g.name);

	const layers: LayerBlame[] = [];
	for (let u = 0; u < units.length; u++) {
		const ids = units[u];
		const off = asFrame(await render(without(project, ids), { lazy: true }));
		if (off.width !== frame.width || off.height !== frame.height)
			throw new Error('attributeTiling: render size changed');
		const a = opts.without ? analyzeTiling(off, opts, opts.gpu) : null;
		const img = a?.lab ?? frameLab(off, w, h, opts.gpu);
		const c = new Float32Array(n);
		let total = 0;
		for (let i = 0; i < n; i++) {
			c[i] = Math.hypot(full.L[i] - img.L[i], full.A[i] - img.A[i], full.B[i] - img.B[i]);
			total += c[i];
		}
		const blame = {} as Record<TilingTerm, number>;
		for (const { t, h, wi, wo } of hot) {
			let si = 0;
			let so = 0;
			for (let i = 0; i < n; i++) {
				si += h[i] * c[i];
				so += (1 - h[i]) * c[i];
			}
			blame[t] = wi > 0 && wo > 0 ? si / wi - so / wo : 0;
		}
		const first = byId.get(ids[0])!;
		layers.push({
			ids,
			name: ids.length > 1 ? `${first.name} (+${ids.length - 1} copies)` : first.name,
			type: first.type,
			group: groupOf.get(ids[0]),
			contribution: total / n,
			blame,
			without: a ? { score: a.score, terms: a.terms } : undefined,
			map: opts.maps ? upsample(c, w, h, frame.width, frame.height) : undefined
		});
		opts.onProgress?.(u + 1, units.length);
	}

	return { frame, analysis, layers, findings: rankFindings(analysis, layers) };
}

/** Blame (ΔE) below which a layer's concentration is render noise: on the example projects, layers that barely
 *  touch the hotspots (a faint grain) measure up to ≈0.001 at 32 spp. */
const MIN_BLAME = 0.0015;

/**
 * Per term, the layers whose blame is clearly positive (at least a quarter of the term's largest, and above render
 * noise), weighted by the term's value so that a layer behind a strong unique patch outranks one behind faint tone.
 */
export function rankFindings(analysis: TilingAnalysis, layers: LayerBlame[]): Finding[] {
	const out: Finding[] = [];
	for (const term of TILING_TERMS) {
		const top = Math.max(0, ...layers.map((l) => l.blame[term]));
		if (!(top > MIN_BLAME)) continue;
		layers.forEach((l, layer) => {
			if (l.blame[term] >= Math.max(MIN_BLAME, top * 0.25))
				out.push({ term, layer, weight: (analysis.terms[term] * l.blame[term]) / top });
		});
	}
	return out.sort((a, b) => b.weight - a.weight);
}
