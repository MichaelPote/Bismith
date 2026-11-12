// Colour fitting (docs/features/fr8.2-colour-fit.md): match a project's colours to a target directly instead of
// leaving them to random search. Render → per-channel OKLab quantile maps from the render's colour distribution to
// the target's → push every absolute colour of the project (base colour, normal-blend gradient stops, colour
// params) through the maps → re-render; a few rounds, keeping the best by the metric. Modulators (multiply,
// overlay, screen … gradients — white means "no change" there) are left alone.
//
// Engine-agnostic: the caller supplies `render(project)` → the render in linear light (palette snap off) and a Matcher.

import { hexToRgb, oklabToSrgb, rgbToHex, srgbToOklab, type RGB } from '@/core/color';
import type { Gradient } from '@/core/params';
import type { Project } from '@/core/project';
import { getLayerDef, layerGroups, layerParamDefs } from '@/layers/registry';
import { toOklab, type LinearPremul, type MatchImage } from './image';
import type { Matcher } from './metrics';
import { quantiles } from './quantiles';

/** One colour in a project the fit may change. */
export interface ColourSlot {
	/** e.g. "base", "Stone colour › dif_grad #2". */
	label: string;
	get(): string;
	set(hex: string): void;
	/** Fit only the lightness (keep hue and chroma). */
	lightnessOnly?: boolean;
}

const NORMAL_BLENDS = new Set(['normal', undefined]);

/** The absolute colours of `p` (mutable through the slots): the base colour and enabled paint layers' colours. */
function colourSlots(p: Project): ColourSlot[] {
	const out: ColourSlot[] = [{ label: 'base', get: () => p.base.color, set: (c) => (p.base.color = c) }];
	// Relief layers' colours are discarded by the reset after the relief stack.
	for (const layer of p.layers) {
		if (!layer.enabled || layer.locked) continue;
		const def = getLayerDef(layer.type);
		if (!def) continue;
		const toggles = new Map(
			layerGroups(def)
				.filter((g) => g.toggleKey)
				.map((g) => [g.id, g.toggleKey!])
		);
		const q = layer.params;
		for (const d of layerParamDefs(layer.type)) {
			const toggle = d.group ? toggles.get(d.group) : undefined;
			if (toggle && q[toggle] !== true) continue;
			if (d.type === 'color' && typeof q[d.key] === 'string') {
				out.push({ label: `${layer.name} › ${d.key}`, get: () => String(q[d.key]), set: (c) => (q[d.key] = c) });
			} else if (
				d.type === 'gradient' &&
				d.key === 'dif_grad' &&
				NORMAL_BLENDS.has(q.dif_blend as string | undefined)
			) {
				const g = q[d.key] as Gradient;
				g.stops.forEach((s, i) =>
					out.push({ label: `${layer.name} › ${d.key} #${i + 1}`, get: () => s.color, set: (c) => (s.color = c) })
				);
			}
		}
	}
	return out;
}

/** Quantiles per channel the maps are made of. */
const Q = 256;

/** Monotone 1-D map taking the distribution with quantiles `src` onto the one with quantiles `dst` (as many). */
function quantileMap(src: Float32Array, dst: Float32Array): (v: number) => number {
	const last = src.length - 1;
	return (v) => {
		if (v <= src[0]) return dst[0] + (v - src[0]);
		if (v >= src[last]) return dst[last] + (v - src[last]);
		let lo = 0;
		let hi = last;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (src[mid] <= v) lo = mid;
			else hi = mid;
		}
		const span = src[hi] - src[lo];
		const t = span > 1e-9 ? (v - src[lo]) / span : 0.5;
		return dst[lo] + (dst[hi] - dst[lo]) * t;
	};
}

export type ColourMap = (hex: string, lightnessOnly?: boolean) => string;

function moments(v: Float32Array): [number, number] {
	let m = 0;
	for (let i = 0; i < v.length; i++) m += v[i];
	m /= v.length;
	let q = 0;
	for (let i = 0; i < v.length; i++) q += (v[i] - m) ** 2;
	return [m, Math.sqrt(q / v.length)];
}

/** Mean / spread matching of one channel, the contrast stretch clamped to 0.5–2× (keeps structure intact). */
function momentMap([ms, ss]: [number, number], [md, sd]: [number, number]): (v: number) => number {
	const k = Math.min(2, Math.max(0.5, ss > 1e-6 ? sd / ss : 1));
	return (v) => md + (v - ms) * k;
}

export type ColourFitMode = 'quantile' | 'moments';

/** A target's OKLab channels as the maps read them: quantiles and moments of L, a, b. */
interface ChannelStats {
	q: Float32Array[];
	m: [number, number][];
}

/** Per target (a fixed reference: the matcher's): its channel statistics, made once. */
const targetStats = new WeakMap<MatchImage, ChannelStats>();

function statsOf(target: MatchImage): ChannelStats {
	let s = targetStats.get(target);
	if (!s) {
		const t = toOklab(target);
		const ch = [t.L, t.A, t.B];
		targetStats.set(target, (s = { q: ch.map((v) => quantiles(v, Q, true)), m: ch.map(moments) }));
	}
	return s;
}

/**
 * Per-channel OKLab maps from `render`'s colours to `target`'s, as a hex → hex map. 'quantile' matches the whole
 * distribution (best for continuous references); 'moments' matches mean and spread only — gentler, and safe for
 * palettised references with large flat areas (a quantile map stretches their tails into blotches). Pass the render
 * at the comparison size (a score's `fit`); `target` must not change afterwards (its statistics are kept).
 */
export function colourMap(
	render: MatchImage,
	target: MatchImage,
	strength = 1,
	mode: ColourFitMode = 'quantile'
): ColourMap {
	const r = toOklab(render);
	const t = statsOf(target);
	const maps = [r.L, r.A, r.B].map((v, c) =>
		mode === 'moments' ? momentMap(moments(v), t.m[c]) : quantileMap(quantiles(v, Q, true), t.q[c])
	);
	return (hex, lightnessOnly = false) => {
		const lab = srgbToOklab(hexToRgb(hex));
		const out = lab.map((v, i) => (lightnessOnly && i > 0 ? v : v + (maps[i](v) - v) * strength)) as RGB;
		out[0] = Math.min(1, Math.max(0, out[0]));
		return rgbToHex(oklabToSrgb(out));
	};
}

/** Push every colour slot of `p` (in place) through `map`. */
export function applyColourMap(p: Project, map: ColourMap): number {
	const slots = colourSlots(p);
	for (const s of slots) s.set(map(s.get(), s.lightnessOnly));
	return slots.length;
}

/** Renders a project in linear light, premultiplied (evaluate.ts: renderLinear). */
type Render = (p: Project) => LinearPremul | Promise<LinearPremul>;

export interface ColourFitResult {
	project: Project;
	/** Metric totals before and after. */
	before: number;
	after: number;
	rounds: number;
}

/**
 * Fit the colours of `project` to the matcher's target: up to `rounds` render → map → apply rounds (stopping when a
 * round doesn't improve), returning the best project. The input is not modified.
 */
export async function fitColours(
	project: Project,
	matcher: Matcher,
	render: Render,
	opts: { rounds?: number; strength?: number; mode?: ColourFitMode | 'auto' } = {}
): Promise<ColourFitResult> {
	let best: Project = JSON.parse(JSON.stringify(project));
	// Scored at the render's own size (the windows term compares finer than the fitted image); maps use the fitted one.
	const first = matcher.scoreLinearDetailed(await render(best));
	let image = first.fit;
	const before = first.result.total;
	let bestLoss = before;
	let rounds = 0;
	// 'auto' tries both kinds of map each round and keeps whichever scores better.
	const modes: ColourFitMode[] =
		opts.mode === 'quantile' ? ['quantile'] : opts.mode === 'moments' ? ['moments'] : ['moments', 'quantile'];
	for (let i = 0; i < (opts.rounds ?? 4); i++) {
		let next: Project | null = null;
		let img: MatchImage | null = null;
		let loss = Infinity;
		for (const mode of modes) {
			const cand: Project = JSON.parse(JSON.stringify(best));
			applyColourMap(cand, colourMap(image, matcher.target, opts.strength ?? 1, mode));
			const d = matcher.scoreLinearDetailed(await render(cand));
			if (d.result.total < loss) {
				loss = d.result.total;
				next = cand;
				img = d.fit;
			}
		}
		if (!next || !img || loss >= bestLoss - 1e-5) break;
		best = next;
		bestLoss = loss;
		image = img;
		rounds++;
	}
	return { project: best, before, after: bestLoss, rounds };
}
