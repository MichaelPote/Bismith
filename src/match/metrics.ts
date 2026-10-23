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
// Total = Σ wᵢ·termᵢ / Σ wᵢ over the applicable terms. Presets: 'texture' (aligned weight 0, stochastic
// textures), 'layout' (aligned weight high, for UI elements / laid-out targets), 'tile' (structure at the best
// wrap-around shift), 'windows' (global colour + local texture; the layout is free) and 'tilewin' (tile + windows).

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
import { quantiles } from './quantiles';
import type { TextureScorer } from './vgg';
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
export { quantiles, sortFloat32 } from './quantiles';

export type TermName =
	| 'colour'
	| 'spectrum'
	| 'gradients'
	| 'contrast'
	| 'aligned'
	| 'structure'
	| 'texture'
	| 'windows'
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
	'alpha'
];

export type MetricWeights = Record<TermName, number>;
export type MetricPreset = 'texture' | 'layout' | 'tile' | 'windows' | 'tilewin';

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

function boxDown(src: Float32Array, w: number, h: number): { data: Float32Array; width: number; height: number } {
	const W = Math.max(1, w >> 1);
	const H = Math.max(1, h >> 1);
	const out = new Float32Array(W * H);
	for (let y = 0; y < H; y++) {
		const y0 = Math.min(h - 1, y * 2);
		const y1 = Math.min(h - 1, y * 2 + 1);
		for (let x = 0; x < W; x++) {
			const x0 = Math.min(w - 1, x * 2);
			const x1 = Math.min(w - 1, x * 2 + 1);
			out[y * W + x] = 0.25 * (src[y0 * w + x0] + src[y0 * w + x1] + src[y1 * w + x0] + src[y1 * w + x1]);
		}
	}
	return { data: out, width: W, height: H };
}

function sampler(w: number, h: number, wrap: boolean) {
	return wrap
		? (x: number, y: number) => (((y % h) + h) % h) * w + (((x % w) + w) % w)
		: (x: number, y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x);
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

const MAG_BINS = 22; // < 1e-3, then half-octave bins from 1e-3 up to ~2, then ≥
const MAG_LO = Math.log2(1e-3);
const ORI_BINS = 16;

function gradientHistograms(L: Float32Array, w: number, h: number, wrap: boolean) {
	const at = sampler(w, h, wrap);
	const mag = new Float64Array(MAG_BINS);
	const ori = new Float64Array(ORI_BINS);
	let weight = 0;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const tl = L[at(x - 1, y - 1)],
				tc = L[at(x, y - 1)],
				tr = L[at(x + 1, y - 1)];
			const ml = L[at(x - 1, y)],
				mr = L[at(x + 1, y)];
			const bl = L[at(x - 1, y + 1)],
				bc = L[at(x, y + 1)],
				br = L[at(x + 1, y + 1)];
			const gx = (tr + 2 * mr + br - tl - 2 * ml - bl) / 8;
			// y up (so orientation angles read like the light azimuth convention: counter-clockwise from +x).
			const gy = (tl + 2 * tc + tr - bl - 2 * bc - br) / 8;
			const m = Math.hypot(gx, gy);
			let b = 0;
			if (m >= 1e-3) b = Math.min(MAG_BINS - 1, 1 + Math.floor((Math.log2(m) - MAG_LO) * 2));
			mag[b] += 1;
			if (m > 2e-3) {
				const a = Math.atan2(gy, gx) + Math.PI; // 0..2π
				// Linear interpolation between the two nearest orientation bins (smooth histogram).
				const t = (a / (2 * Math.PI)) * ORI_BINS - 0.5;
				const i0 = Math.floor(t);
				const f = t - i0;
				ori[((i0 % ORI_BINS) + ORI_BINS) % ORI_BINS] += m * (1 - f);
				ori[(((i0 + 1) % ORI_BINS) + ORI_BINS) % ORI_BINS] += m * f;
				weight += m;
			}
		}
	}
	const n = w * h;
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
	const med = Float64Array.from(c).sort()[n >> 1];
	let s = 0;
	for (let i = 0; i < n; i++) s += Math.abs(c[i] - med);
	return s / n;
}

// Contrast ----------------------------------------------------------------------------------------------

function localStd(L: Float32Array, w: number, h: number, wrap: boolean): Float32Array {
	const at = sampler(w, h, wrap);
	const out = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let s = 0;
			let s2 = 0;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const v = L[at(x + dx, y + dy)];
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

/** Compute the descriptors of an image at its own size (resample beforehand for comparisons). */
export function computeFeatures(
	img: MatchImage,
	opts: Pick<MetricOptions, 'wrap' | 'window' | 'background'> = {}
): Features {
	const lab: LabPlanes = toOklab(img, opts.background);
	const { width: w, height: h, L, A, B, alpha } = lab;
	const n = w * h;
	const wrap = opts.wrap ?? false;

	// Colour: project (subsampled to ≤ 16k pixels with a fixed stride) onto each direction.
	const stride = Math.max(1, Math.ceil(n / 16384));
	const m = Math.ceil(n / stride);
	const proj = new Float32Array(m);
	const colourQ = COLOUR_DIRECTIONS.map(([dl, da, db]) => {
		const ca = da * CHROMA_WEIGHT;
		const cb = db * CHROMA_WEIGHT;
		for (let i = 0, j = 0; i < n; i += stride, j++) proj[j] = L[i] * dl + A[i] * ca + B[i] * cb;
		return quantiles(proj, 128);
	});

	const spec = spectrumProfile(L, w, h, opts.window ?? false);
	const grads = gradientHistograms(L, w, h, wrap);

	const contrastQ: Float32Array[] = [];
	let lv = { data: L, width: w, height: h };
	for (let level = 0; level < 3; level++) {
		if (level > 0) {
			if (lv.width < 6 || lv.height < 6) break;
			lv = boxDown(lv.data, lv.width, lv.height);
		}
		contrastQ.push(quantiles(localStd(lv.data, lv.width, lv.height, wrap), 64));
	}

	const pyramid: Features['pyramid'] = [{ width: w, height: h, planes: [L, A, B, alpha] }];
	for (let level = 1; level < 3; level++) {
		const prev = pyramid[level - 1];
		if (prev.width < 4 || prev.height < 4) break;
		const planes = prev.planes.map((p) => boxDown(p, prev.width, prev.height).data);
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
		zPyramid: pyramid.map((lv) => {
			const Lp = lv.planes[0];
			let m = 0;
			for (let i = 0; i < Lp.length; i++) m += Lp[i];
			m /= Lp.length;
			let v = 0;
			for (let i = 0; i < Lp.length; i++) v += (Lp[i] - m) ** 2;
			const sd = Math.max(Math.sqrt(v / Lp.length), 0.02);
			const z = new Float32Array(Lp.length);
			for (let i = 0; i < Lp.length; i++) z[i] = (Lp[i] - m) / sd;
			return { width: lv.width, height: lv.height, z };
		})
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

const norm = (raw: number, scale: number) => (raw <= 0 ? 0 : raw / (raw + scale));

/** Compare two feature sets computed at the same size. */
/** Mean |Δz| of contrast-normalised lightness over the pyramid with b circularly shifted by (dx, dy) px. */
function shiftedZ(a: Features, b: Features, dx: number, dy: number): number {
	let al = 0;
	const levels = Math.min(a.zPyramid.length, b.zPyramid.length);
	for (let l = 0; l < levels; l++) {
		const { width: w, height: h, z: za } = a.zPyramid[l];
		const zb = b.zPyramid[l].z;
		const sx = Math.round(dx / 2 ** l);
		const sy = Math.round(dy / 2 ** l);
		let sum = 0;
		for (let y = 0; y < h; y++) {
			const yb = (((y + sy) % h) + h) % h;
			for (let x = 0; x < w; x++) sum += Math.abs(za[y * w + x] - zb[yb * w + ((((x + sx) % w) + w) % w)]);
		}
		al += sum / (w * h);
	}
	return levels ? al / levels : 0;
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
	const zb = b.zPyramid[top].z;
	let best = -Infinity;
	let bx = 0;
	let by = 0;
	for (let sy = 0; sy < h; sy++)
		for (let sx = 0; sx < w; sx++) {
			let c = 0;
			for (let y = 0; y < h; y++) {
				const yb = (y + sy) % h;
				for (let x = 0; x < w; x++) c += za[y * w + x] * zb[yb * w + ((x + sx) % w)];
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
	raw.colour = (2 * c) / a.colourQ.length;

	// Spectrum shape: weighted mean |Δlog10| after removing the best (weighted-median) constant offset —
	// overall contrast is the contrast term's job, and a noisy lowest band would otherwise shift every band.
	raw.spectrum = spectrumDistance(a, b);

	// Gradients: magnitude EMD in octaves (bins are half-octaves) + orientation EMD (0..0.5 of a turn),
	// the latter only counting when there are edges to orient, scaled ×4 so a quarter-turn ≈ 1 octave.
	const magEmd = emdLinear(a.gradMag, b.gradMag) * 0.5;
	const edge = Math.min(1, Math.max(a.gradWeight, b.gradWeight) / 0.01);
	const oriEmd = emdCircular(a.gradOri, b.gradOri) * 4 * edge;
	raw.gradients = 0.5 * magEmd + 0.5 * oriEmd;

	let ct = 0;
	const levels = Math.min(a.contrastQ.length, b.contrastQ.length);
	for (let i = 0; i < levels; i++) ct += w1(a.contrastQ[i], b.contrastQ[i]);
	raw.contrast = levels ? ct / levels : 0;

	raw.structure = weights.structure > 0 ? structureDistance(a, b) : 0;

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
		windows: extra.windows !== undefined ? (weights.windows ?? 0) : 0
	};
	const terms = {} as Record<TermName, number>;
	let total = 0;
	let wsum = 0;
	for (const t of TERM_NAMES) {
		terms[t] = t === 'windows' ? Math.min(1, raw[t]) : norm(raw[t], TERM_SCALES[t]);
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

/** One-shot comparison: resamples both images to the comparison size, then compares. */
export function compareImages(render: MatchImage, target: MatchImage, opts: MetricOptions = {}): MetricResult {
	return new Matcher(target, opts).score(render);
}

/**
 * A target with cached descriptors, for scoring many renders against the same reference (optimiser,
 * Match UI). `score()` resamples the render to the comparison size first.
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
		this.targetFeatures = computeFeatures(this.target, opts);
		this.weights = resolveWeights(opts);
		if ((this.weights.windows ?? 0) > 0) {
			const [w, h] = comparisonSize(target, { size: opts.size, maxSize: opts.windowMaxSize ?? 512 });
			this.windowTarget = windowBank(resample(target, w, h), {
				wrap: opts.wrap,
				size: windowSide(w, h, opts.windowFraction),
				background: opts.background
			});
		}
	}

	/** The windows term of a render (null without the term): nearest-neighbour distances of its windows. */
	windows(render: MatchImage, lin?: LinearPremul): (WindowResult & { bank: WindowBank; lab: LabPlanes }) | null {
		const t = this.windowTarget;
		if (!t) return null;
		const bg = this.opts.background;
		const lab =
			render.width === t.width && render.height === t.height
				? toOklab(render, bg)
				: resampleLinearToOklab(lin ?? toLinearPremul(render), t.width, t.height, bg);
		const bank = windowBankOfLab(lab, { wrap: this.opts.wrap, like: t });
		return { ...compareWindows(bank, t), bank, lab };
	}

	/**
	 * Where the render's local texture is least like anything in the reference: the render dimmed to grey, with a heat
	 * overlay (red → yellow) by how far the windows covering each pixel are from their closest reference windows —
	 * relative to this render's best- and worst-matched windows, so it shows where, not how much.
	 */
	windowMap(render: MatchImage): MatchImage | null {
		const r = this.windows(render);
		if (!r) return null;
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
		// With the windows term the render is compared at two sizes: one conversion to linear light serves both.
		const lin =
			this.windowTarget && (render.width !== this.width || render.height !== this.height)
				? toLinearPremul(render)
				: undefined;
		const fit = lin ? resampleLinear(lin, this.width, this.height) : this.fit(render);
		const texture = this.texture && (this.weights.texture ?? 0) > 0 ? this.texture.distance(fit) : undefined;
		const windows = this.windows(render, lin)?.raw;
		return compareFeatures(computeFeatures(fit, this.opts), this.targetFeatures, this.weights, { texture, windows });
	}
}
