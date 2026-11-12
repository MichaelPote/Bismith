// Similarity metrics between a render and a reference image (docs/features/fr6.1-similarity-metrics.md).
// Pure TypeScript, no DOM.
//
// Images are MatchImage — RGBA Float32Array, rows top-down, **sRGB-encoded 0..1**, straight alpha
// (see ./image.ts; convert engine output with fromLinear() and PNG/canvas bytes with fromRgba8()).
//
// Terms (each mapped to ≈0..1 by raw/(raw + scale), so 0 = identical, 0.5 = "clearly different",
// → 1 = completely different; `raw` values are also reported):
//   colour     sliced Wasserstein-1 between the OKLab pixel distributions (fixed projection set, chroma
//              axes ×2 so hue shifts of near-neutral colours register) ≈ ΔE for a uniform shift
//   spectrum   mean |Δlog10| between luminance power spectra binned by radius (half octaves) × orientation
//              (4 sectors), after removing the overall level (frequency content + anisotropy)
//   gradients  log-magnitude histogram EMD (octaves) + magnitude-weighted orientation histogram (circular EMD)
//   contrast   Wasserstein-1 between local-std distributions of OKLab L at 1, ½, ¼ scale
//   aligned    per-pixel OKLab ΔE (+|Δα|) at 1, ½, ¼ scale — the only position-sensitive term
//   alpha      Wasserstein-1 between alpha distributions (only when either image has transparency)
//   texture    VGG-19 Gram-matrix distance after matching the render's colours to the target (vgg.ts) —
//              shift-invariant texture similarity; GPU only, counts when a TextureScorer is attached
//   windows    local texture: windows of render and reference (at up to 512 px) matched to their nearest
//              neighbours both ways (windows.ts) — fine detail counts, where the layout lands doesn't
//   motifs     the reference's small blobs (rivets, bolts, studs) matched in place at the best wrap-around shift, both
//              ways (motifs.ts); its weight scales with how laid out the reference is (0 on stone, wood, grass)
// Total = Σ wᵢ·termᵢ / Σ wᵢ over the applicable terms. Presets: 'texture' (aligned weight 0, stochastic
// textures), 'layout' (aligned weight high, for UI elements / laid-out targets), 'tile' (structure at the best
// wrap-around shift), 'windows' (global colour + local texture; the layout is free), 'tilewin' (tile + windows) and
// 'tilemotif' (tile + windows + motifs: for a laid-out reference and a start that already has its motif).

import {
	fitSize,
	heatOverlay,
	resample,
	resampleLinear,
	resampleLinearToOklab,
	toLinearPremul,
	toOklab,
	type LabPlanes,
	type LinearPremul,
	type MatchImage
} from './image';
import { powerSpectrum2d } from './fft';
import {
	MAG_BINS,
	ORI_BINS,
	addOrientation,
	boxDown,
	circularEmd,
	magBin,
	neighbours,
	norm,
	sobel,
	type Plane
} from './imageOps';
import { quantiles } from './quantiles';
import type { TextureScorer } from './vgg';
import { motifDistance, motifPlane, motifTarget, type MotifPlane, type MotifTarget } from './motifs';
import {
	compareWindows,
	windowBank,
	windowBankOfLab,
	windowMismatch,
	windowSide,
	type WindowBank,
	type WindowResult
} from './windows';

export * from './image';
export { argsortFloat32, quantiles, sortFloat32 } from './quantiles';

export type TermName =
	| 'colour'
	| 'spectrum'
	| 'gradients'
	| 'contrast'
	| 'aligned'
	| 'structure'
	| 'texture'
	| 'windows'
	| 'motifs'
	| 'alpha';
export const TERM_NAMES: TermName[] = [
	'colour',
	'spectrum',
	'gradients',
	'contrast',
	'aligned',
	'structure',
	'texture',
	'windows',
	'motifs',
	'alpha'
];

export type MetricWeights = Record<TermName, number>;
export type MetricPreset = 'texture' | 'layout' | 'tile' | 'windows' | 'tilewin' | 'tilemotif';

export const METRIC_PRESETS: Record<MetricPreset, MetricWeights> = {
	texture: {
		colour: 2,
		spectrum: 1,
		gradients: 1,
		contrast: 1,
		aligned: 0,
		structure: 0,
		texture: 2,
		windows: 0,
		motifs: 0,
		alpha: 0.5
	},
	layout: {
		colour: 1,
		spectrum: 0.25,
		gradients: 0.5,
		contrast: 0.25,
		aligned: 3,
		structure: 0,
		texture: 0,
		windows: 0,
		motifs: 0,
		alpha: 0.5
	},
	/**
	 * Tileable game textures: layout matters but the phase is arbitrary — compare at the best wrap-around shift; the
	 * VGG texture term (when available) sees the family of the pattern even when the layouts don't line up.
	 */
	tile: {
		colour: 1.25,
		spectrum: 0.5,
		gradients: 0.35,
		contrast: 0.5,
		aligned: 0,
		structure: 2,
		texture: 3,
		windows: 0,
		motifs: 0,
		alpha: 0.5
	},
	/**
	 * Local texture: windows matched both ways at up to 512 px, beside the global colour distribution and a little of
	 * the VGG term. No structure or spectrum (they see where gaps and joints fall), so a different arrangement of the
	 * same material costs about what a re-seed does and fine detail decides. The VGG term reads plank gaps at 128 px
	 * too, but at weight 1 it costs the windows nothing and keeps tone and coarse texture from drifting (FR8.19).
	 */
	windows: {
		colour: 1,
		spectrum: 0,
		gradients: 0,
		contrast: 0,
		aligned: 0,
		structure: 0,
		texture: 1,
		windows: 4,
		motifs: 0,
		alpha: 0.5
	},
	/**
	 * Tile plus the windows term: as good as Tile under Tile and Texture (16 pairs, paired), as good as Windows on the
	 * windows term — the layout of a small game texture still counts, and a big reference's fine detail gets a say.
	 */
	tilewin: {
		colour: 1.25,
		spectrum: 0.5,
		gradients: 0.35,
		contrast: 0.5,
		aligned: 0,
		structure: 2,
		texture: 3,
		windows: 3,
		motifs: 0,
		alpha: 0.5
	},
	/**
	 * Tile + windows plus the motifs term (FR8.27): the reference's rivets, bolts and studs held in place and at their
	 * strength. For a laid-out reference and a start project that can already make its motif — set it up by hand first.
	 * Not a default: where the start can't make the motif, it steers away from the blob-like stand-ins the other
	 * terms reward (benchmarked worse there).
	 */
	tilemotif: {
		colour: 1.25,
		spectrum: 0.5,
		gradients: 0.35,
		contrast: 0.5,
		aligned: 0,
		structure: 2,
		texture: 3,
		windows: 3,
		motifs: 4,
		alpha: 0.5
	}
};

export const TERM_LABELS: Record<TermName, string> = {
	colour: 'Colour distribution',
	spectrum: 'Frequency spectrum',
	gradients: 'Edges (gradients)',
	contrast: 'Local contrast',
	aligned: 'Pixel alignment',
	structure: 'Structure (best shift)',
	texture: 'Texture (VGG statistics)',
	windows: 'Local texture (windows)',
	motifs: 'Motifs (laid-out features)',
	alpha: 'Alpha'
};

/** raw value that maps to 0.5 for each term (calibrated on synthetic degradations, see metrics.test.ts). */
export const TERM_SCALES: Record<TermName, number> = {
	colour: 0.06, // ΔE (OKLab); a uniform shift of 0.06 ≈ a clearly visible tint/brightness change
	spectrum: 0.4, // mean |Δlog10 power| per band after removing the overall level (decades)
	gradients: 0.25, // mix of magnitude EMD (octaves) and orientation EMD (scaled to comparable units)
	contrast: 0.012, // L units of local std
	aligned: 0.06, // mean per-pixel ΔE
	structure: 0.6, // mean |Δz| of normalised lightness at the best circular shift (≈0 identical, ≈1.1 unrelated)
	texture: 0.15, // mean relative Gram distance (right family untuned ≈ 0.14, wrong family ≈ 0.27, tuned ≈ 0.1)
	windows: 1, // unused: the raw value is already 0..1 (mean nearest-neighbour distance) and is reported as it is
	motifs: 1, // unused: the raw value is already 0..1 (mean blob cost) and is reported as it is
	alpha: 0.1 // alpha units
};

export interface MetricOptions {
	/** Preset weights (default 'texture'); `weights` entries override individual terms. */
	preset?: MetricPreset;
	weights?: Partial<MetricWeights>;
	/** Comparison size (default: the target's size). Both images are resampled to it. */
	size?: [number, number];
	/** Cap on the comparison size's long side (default 128) to bound cost. */
	maxSize?: number;
	/** Treat images as periodic (tileable) for neighbourhood ops (gradients, local contrast). Default false. */
	wrap?: boolean;
	/** Apply a Hann window before the FFT (for non-tileable references). Default false. */
	window?: boolean;
	/** Background (sRGB) that semi-transparent pixels are composited over for the colour terms. */
	background?: [number, number, number];
	/** Windows term: cap on the long side it compares at (default 512) — finer than the other terms' `maxSize`. */
	windowMaxSize?: number;
	/** Windows term: window side as a fraction of the short side (default ⅛; rounded to a power of two, 16…128 px). */
	windowFraction?: number;
	/**
	 * Compute only the descriptors of the terms that weigh (default false): the others read 0. For callers that use only
	 * the total (the tiling fix's drift); the weights must stay as they were at construction.
	 */
	weightedOnly?: boolean;
}

export interface MetricResult {
	/** Weighted total, ≈0..1 (0 = identical). */
	total: number;
	/** Per-term normalised values (≈0..1). */
	terms: Record<TermName, number>;
	/** Per-term raw values (natural units, see TERM_SCALES). */
	raw: Record<TermName, number>;
	/** Weights actually used (alpha is 0 when neither image has transparency). */
	weights: MetricWeights;
	width: number;
	height: number;
}

export function resolveWeights(opts: Pick<MetricOptions, 'preset' | 'weights'> = {}): MetricWeights {
	return { ...METRIC_PRESETS[opts.preset ?? 'texture'], ...(opts.weights ?? {}) } as MetricWeights;
}

// ------------------------------------------------------------------------------------------------ features

/** Precomputed, size-specific descriptors of one image (compute once for a fixed target). */
export interface Features {
	width: number;
	height: number;
	/** Per projection direction: sorted quantiles of the projected OKLab values. */
	colourQ: Float32Array[];
	/** log10 power per (radial band × orientation sector) bin (bins with no samples are NaN). */
	spectrum: Float64Array;
	/** Reliability weight per bin, count/(count+8) (few-sample low-frequency bins are noisy). */
	spectrumWeight: Float64Array;
	/** Normalised log-magnitude histogram of gradients. */
	gradMag: Float64Array;
	/** Normalised magnitude-weighted orientation histogram (directed, 0..2π). */
	gradOri: Float64Array;
	/** Total gradient weight (0 = flat image). */
	gradWeight: number;
	/** Per scale: quantiles of local std of L. */
	contrastQ: Float32Array[];
	/** OKLab (+alpha) at 1, ½, ¼ scale for the aligned term: [L, A, B, alpha] planes per level. */
	pyramid: { width: number; height: number; planes: Float32Array[] }[];
	/** Quantiles of alpha, or null when fully opaque. */
	alphaQ: Float32Array | null;
	/** Neighbourhood ops wrap (tileable): the structure term may search circular shifts. */
	wrap: boolean;
	/** Contrast-normalised lightness (z-scores) at 1, ½, ¼ scale for the structure term. */
	zPyramid: { width: number; height: number; z: Float32Array }[];
	/** Band-pass lightness for the motifs term (null unless it weighs). */
	motif: MotifPlane | null;
}

const COLOUR_DIRECTIONS = makeDirections(32);
/** Weight of OKLab a/b relative to L in the colour term (low-chroma hue errors are very visible). */
const CHROMA_WEIGHT = 2;

/** Fixed projection set: the three OKLab axes plus Fibonacci-hemisphere directions. */
function makeDirections(n: number): [number, number, number][] {
	const dirs: [number, number, number][] = [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1]
	];
	const m = n - 3;
	const golden = Math.PI * (3 - Math.sqrt(5));
	for (let i = 0; i < m; i++) {
		const z = 1 - (i + 0.5) / m; // hemisphere (z > 0); projections are sign-symmetric
		const r = Math.sqrt(1 - z * z);
		const t = golden * i;
		// Assign the "z" component to L so the set is spread around the lightness axis.
		dirs.push([z, r * Math.cos(t), r * Math.sin(t)]);
	}
	return dirs;
}

/** Wasserstein-1 between two 1-D distributions given as equal-length quantile arrays. */
function w1(a: Float32Array, b: Float32Array): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
	return s / a.length;
}

// Spectrum ----------------------------------------------------------------------------------------------

function spectrumProfile(
	L: Float32Array,
	w: number,
	h: number,
	windowed: boolean
): { profile: Float64Array; weight: Float64Array } {
	const n = w * h;
	let mean = 0;
	for (let i = 0; i < n; i++) mean += L[i];
	mean /= n;
	const v = new Float64Array(n);
	for (let y = 0; y < h; y++) {
		const wy = windowed && h > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / h) : 1;
		for (let x = 0; x < w; x++) {
			const wx = windowed && w > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / w) : 1;
			v[y * w + x] = (L[y * w + x] - mean) * wx * wy;
		}
	}
	const power = powerSpectrum2d(v, w, h);
	// Half-octave radial bands from the lowest non-zero frequency to Nyquist (cycles / px), each split into
	// SPECTRUM_SECTORS orientation sectors (0°, 45°, 90°, 135°) so anisotropy (planks, brick courses) counts.
	const rMin = 1 / Math.max(w, h);
	const bands = Math.max(3, Math.min(16, Math.round(Math.log2(0.5 / rMin) * 2)));
	const lo = Math.log(rMin * 0.999);
	const span = Math.log(0.5 * 1.0001) - lo;
	const bins = bands * SPECTRUM_SECTORS;
	const sum = new Float64Array(bins);
	const cnt = new Float64Array(bins);
	const sectorWidth = Math.PI / SPECTRUM_SECTORS;
	for (let ky = 0; ky < h; ky++) {
		const fy = (ky <= h / 2 ? ky : ky - h) / h;
		for (let kx = 0; kx < w; kx++) {
			const fx = (kx <= w / 2 ? kx : kx - w) / w;
			const r = Math.hypot(fx, fy);
			if (r === 0 || r > 0.5) continue;
			const b = Math.min(bands - 1, Math.max(0, Math.floor(((Math.log(r) - lo) / span) * bands)));
			let theta = Math.atan2(fy, fx);
			if (theta < 0) theta += Math.PI;
			const sector = Math.floor((theta + sectorWidth / 2) / sectorWidth) % SPECTRUM_SECTORS;
			sum[b * SPECTRUM_SECTORS + sector] += power[ky * w + kx];
			cnt[b * SPECTRUM_SECTORS + sector] += 1;
		}
	}
	// Power per frequency sample / pixel count = variance density (size independent, Parseval). The floor
	// sits far below 8-bit quantisation noise; the comparison removes the overall level (median offset).
	const out = new Float64Array(bins);
	const weight = new Float64Array(bins);
	for (let b = 0; b < bins; b++) {
		weight[b] = cnt[b] / (cnt[b] + 8);
		out[b] = cnt[b] === 0 ? NaN : Math.log10(sum[b] / cnt[b] / n + 1e-9);
	}
	return { profile: out, weight };
}

// Gradients ---------------------------------------------------------------------------------------------

const SPECTRUM_SECTORS = 4;

function gradientHistograms(L: Float32Array, w: number, h: number, wrap: boolean) {
	const { gx, gy } = sobel(L, w, h, wrap);
	const mag = new Float64Array(MAG_BINS);
	const ori = new Float64Array(ORI_BINS);
	let weight = 0;
	const n = w * h;
	for (let i = 0; i < n; i++) {
		const m = Math.hypot(gx[i], gy[i]);
		mag[magBin(m)] += 1;
		weight += addOrientation(ori, 0, gx[i], gy[i], m);
	}
	for (let i = 0; i < MAG_BINS; i++) mag[i] /= n;
	if (weight > 1e-9) for (let i = 0; i < ORI_BINS; i++) ori[i] /= weight;
	else ori.fill(1 / ORI_BINS);
	return { mag, ori, weight: weight / n };
}

/** EMD between two histograms over ordered bins, in bins. */
function emdLinear(a: Float64Array, b: Float64Array): number {
	let c = 0;
	let s = 0;
	for (let i = 0; i < a.length - 1; i++) {
		c += a[i] - b[i];
		s += Math.abs(c);
	}
	return s;
}

/** EMD between two circular histograms, as a fraction of the full circle (0..0.5). */
function emdCircular(a: Float64Array, b: Float64Array): number {
	const n = a.length;
	const c = new Float64Array(n);
	let acc = 0;
	for (let i = 0; i < n; i++) {
		acc += a[i] - b[i];
		c[i] = acc;
	}
	return circularEmd(c, n, new Float64Array(n));
}

// Contrast ----------------------------------------------------------------------------------------------

function localStd(L: Float32Array, w: number, h: number, wrap: boolean): Float32Array {
	const xs = [-1, 0, 1].map((d) => neighbours(w, d, wrap));
	const ys = [-1, 0, 1].map((d) => neighbours(h, d, wrap));
	const out = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let s = 0;
			let s2 = 0;
			for (let dy = 0; dy < 3; dy++) {
				const row = ys[dy][y] * w;
				for (let dx = 0; dx < 3; dx++) {
					const v = L[row + xs[dx][x]];
					s += v;
					s2 += v * v;
				}
			}
			const m = s / 9;
			out[y * w + x] = Math.sqrt(Math.max(0, s2 / 9 - m * m));
		}
	}
	return out;
}

// ------------------------------------------------------------------------------------------------ public

/**
 * Compute the descriptors of an image at its own size (resample beforehand for comparisons). With `weights`, only those
 * of the terms that weigh (the rest are left empty and compare as 0).
 */
export function computeFeatures(
	img: MatchImage,
	opts: Pick<MetricOptions, 'wrap' | 'window' | 'background'> & {
		/** Compute the motifs term's plane without `weights` (it isn't made unless asked: only one preset uses it). */
		motifs?: boolean;
	} = {},
	weights?: MetricWeights
): Features {
	const lab: LabPlanes = toOklab(img, opts.background);
	const { width: w, height: h, L, A, B, alpha } = lab;
	const n = w * h;
	const wrap = opts.wrap ?? false;
	const need = (t: TermName) => !weights || (weights[t] ?? 0) > 0;

	// Colour: project (subsampled to ≤ 16k pixels with a fixed stride) onto each direction.
	const stride = Math.max(1, Math.ceil(n / 16384));
	const m = Math.ceil(n / stride);
	const proj = new Float32Array(m);
	const colourQ = need('colour')
		? COLOUR_DIRECTIONS.map(([dl, da, db]) => {
				const ca = da * CHROMA_WEIGHT;
				const cb = db * CHROMA_WEIGHT;
				for (let i = 0, j = 0; i < n; i += stride, j++) proj[j] = L[i] * dl + A[i] * ca + B[i] * cb;
				return quantiles(proj, 128);
			})
		: [];

	const spec = need('spectrum')
		? spectrumProfile(L, w, h, opts.window ?? false)
		: { profile: new Float64Array(0), weight: new Float64Array(0) };
	const grads = need('gradients')
		? gradientHistograms(L, w, h, wrap)
		: { mag: new Float64Array(0), ori: new Float64Array(0), weight: 0 };

	// L at 1, ½, ¼ scale, made once for the contrast and the aligned / structure pyramids.
	const lPyramid: Plane[] = [{ data: L, width: w, height: h }];
	const lLevel = (l: number) => {
		while (lPyramid.length <= l) {
			const p = lPyramid[lPyramid.length - 1];
			lPyramid.push(boxDown(p.data, p.width, p.height));
		}
		return lPyramid[l];
	};

	const contrastQ: Float32Array[] = [];
	for (let level = 0; level < 3 && need('contrast'); level++) {
		if (level > 0) {
			const prev = lLevel(level - 1);
			if (prev.width < 6 || prev.height < 6) break;
		}
		const lv = lLevel(level);
		contrastQ.push(quantiles(localStd(lv.data, lv.width, lv.height, wrap), 64));
	}

	const pyramid: Features['pyramid'] =
		need('aligned') || need('structure') ? [{ width: w, height: h, planes: [L, A, B, alpha] }] : [];
	for (let level = 1; level < 3 && pyramid.length; level++) {
		const prev = pyramid[level - 1];
		if (prev.width < 4 || prev.height < 4) break;
		const planes = [lLevel(level).data, ...prev.planes.slice(1).map((p) => boxDown(p, prev.width, prev.height).data)];
		pyramid.push({ width: Math.max(1, prev.width >> 1), height: Math.max(1, prev.height >> 1), planes });
	}

	let opaque = true;
	for (let i = 0; i < n; i++)
		if (alpha[i] < 0.999) {
			opaque = false;
			break;
		}

	return {
		width: w,
		height: h,
		colourQ,
		spectrum: spec.profile,
		spectrumWeight: spec.weight,
		gradMag: grads.mag,
		gradOri: grads.ori,
		gradWeight: grads.weight,
		contrastQ,
		pyramid,
		alphaQ: opaque ? null : quantiles(alpha, 64),
		wrap: Boolean(opts.wrap),
		zPyramid: need('structure')
			? pyramid.map((lv) => ({ width: lv.width, height: lv.height, z: zScores(lv.planes[0]) }))
			: [],
		motif: (weights ? (weights.motifs ?? 0) > 0 : opts.motifs) ? motifPlane(L, w, h, wrap) : null
	};
}

/** Per-band cap on |Δlog10| (decades) so bands lost to the noise floor don't dominate. */
const SPECTRUM_CAP = 3;

function spectrumDistance(a: Features, b: Features): number {
	const d: number[] = [];
	const w: number[] = [];
	for (let i = 0; i < a.spectrum.length; i++) {
		if (Number.isNaN(a.spectrum[i]) || Number.isNaN(b.spectrum[i])) continue;
		d.push(a.spectrum[i] - b.spectrum[i]);
		w.push(a.spectrumWeight[i]);
	}
	if (!d.length) return 0;
	const order = d.map((_, i) => i).sort((i, j) => d[i] - d[j]);
	const wsum = w.reduce((x, y) => x + y, 0);
	let acc = 0;
	let med = d[order[order.length - 1]];
	for (const i of order) {
		acc += w[i];
		if (acc >= wsum / 2) {
			med = d[i];
			break;
		}
	}
	let s = 0;
	for (let i = 0; i < d.length; i++) s += Math.min(SPECTRUM_CAP, Math.abs(d[i] - med)) * w[i];
	return s / wsum;
}

/** Contrast-normalised lightness: z-scores (the spread floored, so a flat image doesn't blow up). */
function zScores(L: Float32Array): Float32Array {
	let m = 0;
	for (let i = 0; i < L.length; i++) m += L[i];
	m /= L.length;
	let v = 0;
	for (let i = 0; i < L.length; i++) v += (L[i] - m) ** 2;
	const sd = Math.max(Math.sqrt(v / L.length), 0.02);
	const z = new Float32Array(L.length);
	for (let i = 0; i < L.length; i++) z[i] = (L[i] - m) / sd;
	return z;
}

/** The reference side of the motifs term (its blobs and layout), made once per reference. */
const motifTargets = new WeakMap<Features, MotifTarget>();

function motifTargetOf(b: Features): MotifTarget | null {
	if (!b.motif) return null;
	let t = motifTargets.get(b);
	if (!t) motifTargets.set(b, (t = motifTarget(b.motif)));
	return t;
}

/**
 * b's structure pyramids per circular shift: b is the reference, so the few shifts renders land on recur. Least recently
 * used first, at most SHIFT_CACHE (a score refines over up to 25 shifts: the cache holds a few scores' worth).
 */
const shiftedZCache = new WeakMap<Features, Map<number, Float32Array[]>>();
const SHIFT_CACHE = 64;

/**
 * b's z pyramid with b circularly shifted by (dx, dy) px at full resolution, then reduced. Shifting a reduced level
 * by round(d / 2^l) instead compares box averages of different pixels: the reference against itself moved by one
 * pixel scored like an image with its rivets removed.
 */
function shiftedZPyramid(b: Features, dx: number, dy: number): Float32Array[] {
	const levels = b.zPyramid.length;
	if ((dx === 0 && dy === 0) || !levels) return b.zPyramid.map((lv) => lv.z);
	const { width: w, height: h } = b;
	const sx = ((dx % w) + w) % w;
	const sy = ((dy % h) + h) % h;
	const key = sy * w + sx;
	let cache = shiftedZCache.get(b);
	if (!cache) shiftedZCache.set(b, (cache = new Map()));
	const hit = cache.get(key);
	if (hit) {
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	const L = b.pyramid[0].planes[0];
	let lv: { data: Float32Array; width: number; height: number } = {
		data: new Float32Array(w * h),
		width: w,
		height: h
	};
	for (let y = 0; y < h; y++) {
		const row = ((y + sy) % h) * w;
		for (let x = 0; x < w; x++) lv.data[y * w + x] = L[row + ((x + sx) % w)];
	}
	const out = [zScores(lv.data)];
	while (out.length < levels) {
		lv = boxDown(lv.data, lv.width, lv.height);
		out.push(zScores(lv.data));
	}
	if (cache.size >= SHIFT_CACHE) cache.delete(cache.keys().next().value!);
	cache.set(key, out);
	return out;
}

/** Mean |Δz| of contrast-normalised lightness over the pyramid with b circularly shifted by (dx, dy) px. */
function shiftedZ(a: Features, b: Features, dx: number, dy: number): number {
	let al = 0;
	const levels = Math.min(a.zPyramid.length, b.zPyramid.length);
	const zbs = shiftedZPyramid(b, dx, dy);
	for (let l = 0; l < levels; l++) {
		const { width: w, height: h, z: za } = a.zPyramid[l];
		const zb = zbs[l];
		let sum = 0;
		for (let i = 0; i < w * h; i++) sum += Math.abs(za[i] - zb[i]);
		al += sum / (w * h);
	}
	return levels ? al / levels : 0;
}

/** b's z plane at `level` tiled 2 × 2, so a circular shift reads it without wrapping (made once per reference). */
const coarseTiles = new WeakMap<Features, { level: number; z: Float32Array }>();

function coarseTiled(b: Features, level: number): Float32Array {
	const hit = coarseTiles.get(b);
	if (hit?.level === level) return hit.z;
	const { width: w, height: h, z } = b.zPyramid[level];
	const t = new Float32Array(4 * w * h);
	for (let y = 0; y < 2 * h; y++) for (let x = 0; x < 2 * w; x++) t[y * 2 * w + x] = z[(y % h) * w + (x % w)];
	coarseTiles.set(b, { level, z: t });
	return t;
}

/**
 * Structure: how well the *shapes* line up — mean |Δz| of contrast-normalised lightness (z-scores, so colour
 * and overall contrast are left to the other terms) at the circular shift that best aligns b to a (tileable
 * images have arbitrary phase). Coarse search by correlation at the smallest level, refined at full
 * resolution within one coarse cell. Without wrap: no shift.
 */
function structureDistance(a: Features, b: Features): number {
	if (!a.wrap || !b.wrap) return shiftedZ(a, b, 0, 0);
	const top = Math.min(a.zPyramid.length, b.zPyramid.length) - 1;
	const { width: w, height: h, z: za } = a.zPyramid[top];
	const zb = coarseTiled(b, top);
	const W2 = 2 * w;
	let best = -Infinity;
	let bx = 0;
	let by = 0;
	for (let sy = 0; sy < h; sy++)
		for (let sx = 0; sx < w; sx++) {
			let c = 0;
			for (let y = 0; y < h; y++) {
				const row = (y + sy) * W2 + sx;
				for (let x = 0; x < w; x++) c += za[y * w + x] * zb[row + x];
			}
			if (c > best) {
				best = c;
				bx = sx;
				by = sy;
			}
		}
	const f = 2 ** top;
	let bestD = Infinity;
	const r = Math.max(1, f >> 1);
	for (let dy = -r; dy <= r; dy++)
		for (let dx = -r; dx <= r; dx++) bestD = Math.min(bestD, shiftedZ(a, b, bx * f + dx, by * f + dy));
	return bestD;
}

export function compareFeatures(
	a: Features,
	b: Features,
	weights: MetricWeights = METRIC_PRESETS.texture,
	extra: { texture?: number; windows?: number } = {}
): MetricResult {
	if (a.width !== b.width || a.height !== b.height) throw new Error('compareFeatures: size mismatch');
	const raw = {} as Record<TermName, number>;

	// Colour: 2 × mean W1 over directions ≈ ΔE for a uniform shift (E|u·d| = |d|/2 on the sphere).
	let c = 0;
	for (let i = 0; i < a.colourQ.length; i++) c += w1(a.colourQ[i], b.colourQ[i]);
	raw.colour = a.colourQ.length ? (2 * c) / a.colourQ.length : 0;

	// Spectrum shape: weighted mean |Δlog10| after removing the best (weighted-median) constant offset —
	// overall contrast is the contrast term's job, and a noisy lowest band would otherwise shift every band.
	raw.spectrum = spectrumDistance(a, b);

	// Gradients: magnitude EMD in octaves (bins are half-octaves) + orientation EMD (0..0.5 of a turn),
	// the latter only counting when there are edges to orient, scaled ×4 so a quarter-turn ≈ 1 octave.
	if (a.gradMag.length) {
		const magEmd = emdLinear(a.gradMag, b.gradMag) * 0.5;
		const edge = Math.min(1, Math.max(a.gradWeight, b.gradWeight) / 0.01);
		const oriEmd = emdCircular(a.gradOri, b.gradOri) * 4 * edge;
		raw.gradients = 0.5 * magEmd + 0.5 * oriEmd;
	} else raw.gradients = 0;

	let ct = 0;
	const levels = Math.min(a.contrastQ.length, b.contrastQ.length);
	for (let i = 0; i < levels; i++) ct += w1(a.contrastQ[i], b.contrastQ[i]);
	raw.contrast = levels ? ct / levels : 0;

	raw.structure = weights.structure > 0 && a.zPyramid.length ? structureDistance(a, b) : 0;

	// Motifs count as far as the reference is laid out (b is the reference).
	const motifs = (weights.motifs ?? 0) > 0 && a.motif ? motifTargetOf(b) : null;
	const motifWeight = motifs ? (weights.motifs ?? 0) * motifs.layout : 0;
	raw.motifs = motifs && motifWeight > 0 ? motifDistance(a.motif!, motifs) : 0;

	let al = 0;
	const plevels = Math.min(a.pyramid.length, b.pyramid.length);
	for (let l = 0; l < plevels; l++) {
		const [La, Aa, Ba, aa] = a.pyramid[l].planes;
		const [Lb, Ab, Bb, ab] = b.pyramid[l].planes;
		let sum = 0;
		for (let i = 0; i < La.length; i++) {
			sum += Math.hypot(La[i] - Lb[i], Aa[i] - Ab[i], Ba[i] - Bb[i]) + Math.abs(aa[i] - ab[i]);
		}
		al += sum / La.length;
	}
	raw.aligned = plevels ? al / plevels : 0;

	const hasAlpha = a.alphaQ !== null || b.alphaQ !== null;
	if (hasAlpha) {
		const one = new Float32Array(64).fill(1);
		raw.alpha = w1(a.alphaQ ?? one, b.alphaQ ?? one);
	} else raw.alpha = 0;

	// The texture term is computed on the GPU by the Matcher and the windows term from the full-size images; without
	// them they don't count.
	raw.texture = extra.texture ?? 0;
	raw.windows = extra.windows ?? 0;
	const used: MetricWeights = {
		...weights,
		alpha: hasAlpha ? weights.alpha : 0,
		texture: extra.texture !== undefined ? (weights.texture ?? 0) : 0,
		windows: extra.windows !== undefined ? (weights.windows ?? 0) : 0,
		motifs: motifWeight
	};
	const terms = {} as Record<TermName, number>;
	let total = 0;
	let wsum = 0;
	for (const t of TERM_NAMES) {
		terms[t] = t === 'windows' || t === 'motifs' ? Math.min(1, raw[t]) : norm(raw[t], TERM_SCALES[t]);
		const wt = Math.max(0, used[t] ?? 0);
		total += wt * terms[t];
		wsum += wt;
	}
	return { total: wsum > 0 ? total / wsum : 0, terms, raw, weights: used, width: a.width, height: a.height };
}

/** Resolve the comparison size for a target. */
export function comparisonSize(
	target: { width: number; height: number },
	opts: Pick<MetricOptions, 'size' | 'maxSize'> = {}
): [number, number] {
	const [w, h] = opts.size ?? [target.width, target.height];
	return fitSize(w, h, opts.maxSize ?? 128);
}

/** The windows term of a render, with what a mismatch map needs (Matcher.windowMap). */
export interface WindowsDetail extends WindowResult {
	bank: WindowBank;
	lab: LabPlanes;
}

/** A score with what it was computed from: the render at the comparison size and its windows. */
export interface ScoreDetail {
	result: MetricResult;
	/** The render at the comparison size (sRGB, straight alpha): for display, the pixel diff and colour fits. */
	fit: MatchImage;
	/** The windows term's detail (null without the term). */
	windows: WindowsDetail | null;
}

/**
 * A target with cached descriptors, for scoring many renders against the same reference (optimiser, Match UI).
 * Renders are resampled to the comparison size first; engine output goes in linear (scoreLinear), skipping the sRGB
 * round trip.
 */
export class Matcher {
	readonly width: number;
	readonly height: number;
	readonly target: MatchImage;
	readonly targetFeatures: Features;
	weights: MetricWeights;
	/** GPU texture statistics bound to `target` (vgg.ts); enables the texture term. */
	texture: TextureScorer | null = null;
	/** The reference's windows at the windows term's size (null when the weights don't use the term). */
	readonly windowTarget: WindowBank | null = null;
	private opts: MetricOptions;

	constructor(target: MatchImage, opts: MetricOptions = {}) {
		this.opts = opts;
		[this.width, this.height] = comparisonSize(target, opts);
		this.target = resample(target, this.width, this.height);
		this.weights = resolveWeights(opts);
		this.targetFeatures = computeFeatures(
			this.target,
			{ ...opts, motifs: (this.weights.motifs ?? 0) > 0 },
			opts.weightedOnly ? this.weights : undefined
		);
		if ((this.weights.windows ?? 0) > 0) {
			const [w, h] = comparisonSize(target, { size: opts.size, maxSize: opts.windowMaxSize ?? 512 });
			this.windowTarget = windowBank(resample(target, w, h), {
				wrap: opts.wrap,
				size: windowSide(w, h, opts.windowFraction),
				background: opts.background
			});
		}
	}

	private windowsOfLab(lab: LabPlanes): WindowsDetail | null {
		const t = this.windowTarget;
		if (!t) return null;
		const bank = windowBankOfLab(lab, { wrap: this.opts.wrap, like: t });
		return { ...compareWindows(bank, t), bank, lab };
	}

	/**
	 * Where the render's local texture is least like anything in the reference: the render dimmed to grey, with a heat
	 * overlay (red → yellow) by how far the windows covering each pixel are from their closest reference windows —
	 * relative to this render's best- and worst-matched windows, so it shows where, not how much. From a score's detail.
	 */
	windowMap(r: WindowsDetail): MatchImage {
		const m = windowMismatch(r.bank, r.perWindow);
		let lo = Infinity;
		let hi = -Infinity;
		for (const v of r.perWindow) {
			lo = Math.min(lo, v);
			hi = Math.max(hi, v);
		}
		const span = Math.max(1e-6, hi - lo);
		return heatOverlay(
			r.lab.L,
			m.values.map((v) => (v - lo) / span),
			m.width,
			m.height
		);
	}

	/** Bring an image to the comparison size. */
	fit(img: MatchImage): MatchImage {
		return resample(img, this.width, this.height);
	}

	/** Free the texture scorer's GPU targets (the texture term no longer counts afterwards). */
	dispose(): void {
		this.texture?.dispose();
		this.texture = null;
	}

	score(render: MatchImage): MetricResult {
		return this.scoreDetailed(render).result;
	}

	/** score() of a render already in linear light with premultiplied alpha (straight from the GPU: no sRGB round trip). */
	scoreLinear(lin: LinearPremul): MetricResult {
		return this.scoreLinearDetailed(lin).result;
	}

	/** score() with the fitted render and the windows' detail. */
	scoreDetailed(render: MatchImage): ScoreDetail {
		const t = this.windowTarget;
		const bg = this.opts.background;
		// With the windows term the render is compared at two sizes: one conversion to linear light serves both.
		const lin = t && (render.width !== this.width || render.height !== this.height) ? toLinearPremul(render) : null;
		const fit = lin ? resampleLinear(lin, this.width, this.height) : this.fit(render);
		return this.scoreFit(
			fit,
			() =>
				t &&
				this.windowsOfLab(
					render.width === t.width && render.height === t.height
						? toOklab(render, bg)
						: resampleLinearToOklab(lin ?? toLinearPremul(render), t.width, t.height, bg)
				)
		);
	}

	/** scoreLinear() with the fitted render and the windows' detail. */
	scoreLinearDetailed(lin: LinearPremul): ScoreDetail {
		const t = this.windowTarget;
		const fit = resampleLinear(lin, this.width, this.height);
		return this.scoreFit(
			fit,
			() => t && this.windowsOfLab(resampleLinearToOklab(lin, t.width, t.height, this.opts.background))
		);
	}

	/** The total from the render at the comparison size; the VGG term runs on the GPU while the CPU does the rest. */
	private scoreFit(fit: MatchImage, windows: () => WindowsDetail | null): ScoreDetail {
		const texture = this.texture && (this.weights.texture ?? 0) > 0 ? this.texture.submit(fit) : undefined;
		const w = windows();
		const features = computeFeatures(
			fit,
			{ ...this.opts, motifs: (this.weights.motifs ?? 0) > 0 },
			this.opts.weightedOnly ? this.weights : undefined
		);
		const result = compareFeatures(features, this.targetFeatures, this.weights, {
			texture: texture?.(),
			windows: w?.raw
		});
		return { result, fit, windows: w };
	}
}
