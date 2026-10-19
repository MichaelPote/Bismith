// Local texture by windows (docs/features/fr8.19-window-metric.md): windows cut from the render and from the
// reference, each described by its local statistics — colour, fine edges (gradient strength and direction) and
// oriented detail at several scales — and matched to their nearest neighbours in both directions. Where the layout
// lands (which plank a gap falls on) doesn't count, only whether every patch of the render looks like some patch of
// the reference (coherence) and every patch of the reference has a look-alike in the render (completeness).
// Compared at up to 512 px, so fine detail that the 128 px global terms average away still counts.
//
//   const target = windowBank(reference, { wrap })               // colour bins from the reference
//   const r = compareWindows(windowBank(render, { wrap, like: target }), target)   // r.raw ≈ 0..1, r.perWindow
//
// Statistics are summed per cell (¼ of the window side) and windows are 4 × 4 cells at a step of two cells, so the
// banks are dense at little cost. Positions are a fixed grid, not drawn at random per evaluation: the optimiser
// compares candidates by their score, and a fresh draw each time would turn that comparison into noise.

import type { LabPlanes, MatchImage } from './image';
import { toOklab } from './image';

/** Cells per window side, the default step between windows in cells, and the most windows along an axis. */
const CELLS = 4;
const STEP = 2;
const MAX_ACROSS = 16;
/** Colour histogram bins per channel. */
const NB = 24;
const MAG_BINS = 22; // < 1e-3, then half-octave bins from 1e-3 up to ~2 (as the global gradient term)
const MAG_LO = Math.log2(1e-3);
const ORI_BINS = 16;
/** Oriented detail: 4 orientations per pyramid level, up to 4 levels. */
const ORIENTS = 4;
const MAX_LEVELS = 4;
/** Weight of OKLab a/b relative to L (as the global colour term). */
const CHROMA = 2;

/** Raw value per part that maps to 0.5 (as TERM_SCALES for the global terms). */
export const WINDOW_SCALES = { colour: 0.06, edges: 0.25, detail: 0.15 };
export type WindowPart = keyof typeof WINDOW_SCALES;
export const WINDOW_PARTS = Object.keys(WINDOW_SCALES) as WindowPart[];
export type WindowWeights = Record<WindowPart, number>;
/**
 * Fine edges tell textures apart best (planks: grain removed, re-seeded, reference ≈ +0.9…1.6 above the layout floor
 * on their own, against +0.6 for detail and +0.5 for colour); local-contrast histograms only added noise.
 */
export const DEFAULT_WINDOW_WEIGHTS: WindowWeights = { colour: 1, edges: 3, detail: 1 };

export interface WindowBankOptions {
	/** Periodic image (tileable): windows wrap around the edges. */
	wrap?: boolean;
	/** Window side in px (default: windowSide of the image). Ignored with `like`. */
	size?: number;
	/** Take the window size and the colour bin ranges from this bank (renders: the target's bank). */
	like?: WindowBank;
	/** Step between windows in cells (default 2: half a window — more where that would exceed 16 windows across, which
	 *  bounds the matching to 256 × 256 pairs). */
	step?: number;
	/** Background (sRGB) for semi-transparent pixels. */
	background?: [number, number, number];
}

/** Default window side: `fraction` (default ⅛) of the short side as a power of two, 16…128 px, at most half the side. */
export function windowSide(width: number, height: number, fraction = 1 / 8): number {
	const s = Math.min(width, height);
	let w = 2 ** Math.round(Math.log2(Math.max(1, s * fraction)));
	w = Math.max(16, Math.min(128, w));
	while (w > 8 && w > s / 2) w >>= 1;
	return w;
}

/** Descriptors of the windows of one image. */
export interface WindowBank {
	width: number;
	height: number;
	/** Window side and cell side (px). */
	size: number;
	cell: number;
	count: number;
	/** Window origins (top-left, px). */
	x: Int32Array;
	y: Int32Array;
	/** Cells across / down, and the cells each window covers (count × CELLS², −1 = none), for mismatch maps. */
	cellsX: number;
	cellsY: number;
	cells: Int32Array;
	/** Colour bins per channel (L, 2a, 2b): lower edge and bin width. */
	ranges: { lo: number; width: number }[];
	/** count × 3·NB: cumulative colour histograms. */
	colour: Float32Array;
	/** count × MAG_BINS: cumulative log-magnitude histogram of the (Sobel) gradients. */
	mag: Float32Array;
	/** count × ORI_BINS: cumulative magnitude-weighted orientation histogram (directed — lighting shows here). */
	ori: Float32Array;
	/** Mean gradient magnitude per window (orientation is faded out for flat windows). */
	edge: Float32Array;
	/** count × levels·ORIENTS: log10 mean |oriented derivative| per pyramid level (robust to a few strong edges). */
	detail: Float32Array;
	levels: number;
}

interface Plane {
	w: number;
	h: number;
	v: Float32Array;
}

function boxDown(p: Plane): Plane {
	const W = Math.max(1, p.w >> 1);
	const H = Math.max(1, p.h >> 1);
	const v = new Float32Array(W * H);
	for (let y = 0; y < H; y++) {
		const y0 = Math.min(p.h - 1, y * 2);
		const y1 = Math.min(p.h - 1, y * 2 + 1);
		for (let x = 0; x < W; x++) {
			const x0 = Math.min(p.w - 1, x * 2);
			const x1 = Math.min(p.w - 1, x * 2 + 1);
			v[y * W + x] = 0.25 * (p.v[y0 * p.w + x0] + p.v[y0 * p.w + x1] + p.v[y1 * p.w + x0] + p.v[y1 * p.w + x1]);
		}
	}
	return { w: W, h: H, v };
}

/** Index of the neighbour at offset d of every i in 0…n−1 (wrapping, or clamped at the ends). */
function neighbours(n: number, d: number, wrap: boolean): Int32Array {
	const out = new Int32Array(n);
	for (let i = 0; i < n; i++) out[i] = wrap ? (i + d + n) % n : Math.max(0, Math.min(n - 1, i + d));
	return out;
}

/** Colour bin range of a channel: its 0.2 … 99.8 % span plus a margin (values outside land in the end bins). */
function rangeOf(v: Float32Array): { lo: number; width: number } {
	const s = Float32Array.from(v).sort();
	const a = s[Math.floor(s.length * 0.002)];
	const b = s[Math.min(s.length - 1, Math.floor(s.length * 0.998))];
	const pad = Math.max(0.02, (b - a) * 0.25);
	return { lo: a - pad, width: (b - a + 2 * pad) / NB };
}

/** Describe the windows of `img` (at its own size; resample it beforehand). */
export function windowBank(img: MatchImage, opts: WindowBankOptions = {}): WindowBank {
	return windowBankOfLab(toOklab(img, opts.background), opts);
}

/** windowBank of an image already in OKLab (e.g. from resampleLinearToOklab). */
export function windowBankOfLab(lab: LabPlanes, opts: Omit<WindowBankOptions, 'background'> = {}): WindowBank {
	const wrap = opts.wrap ?? false;
	const { width: W, height: H } = lab;
	const size = opts.like?.size ?? Math.max(8, Math.min(opts.size ?? windowSide(W, H), Math.min(W, H)));
	const cell = Math.max(1, Math.floor(size / CELLS));
	const n = W * H;
	const A2 = new Float32Array(n);
	const B2 = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		A2[i] = lab.A[i] * CHROMA;
		B2[i] = lab.B[i] * CHROMA;
	}
	const ranges = opts.like?.ranges ?? [lab.L, A2, B2].map(rangeOf);

	// Pyramid of L; a level counts while its cells are at least one pixel.
	const pyr: Plane[] = [{ w: W, h: H, v: lab.L }];
	while (pyr.length < MAX_LEVELS && cell >> pyr.length >= 1 && pyr[pyr.length - 1].w >= 8 && pyr[pyr.length - 1].h >= 8)
		pyr.push(boxDown(pyr[pyr.length - 1]));
	const levels = pyr.length;

	const cx = Math.ceil(W / cell);
	const cy = Math.ceil(H / cell);
	const nCells = cx * cy;
	const colH = new Float32Array(nCells * 3 * NB);
	const magH = new Float32Array(nCells * MAG_BINS);
	const oriH = new Float32Array(nCells * ORI_BINS);
	const edgeS = new Float32Array(nCells);
	const detS = new Float32Array(nCells * levels * ORIENTS);
	const cnt = new Float32Array(nCells * levels);

	// Full resolution: colour, Sobel magnitude and orientation.
	{
		const xl = neighbours(W, -1, wrap);
		const xr = neighbours(W, 1, wrap);
		const yu = neighbours(H, -1, wrap);
		const yd = neighbours(H, 1, wrap);
		const cellOf = Int32Array.from({ length: W }, (_, x) => Math.floor(x / cell));
		const L = lab.L;
		const [r0, r1, r2] = ranges;
		const bin = (v: number, r: { lo: number; width: number }) => {
			const b = Math.floor((v - r.lo) / r.width);
			return b < 0 ? 0 : b >= NB ? NB - 1 : b;
		};
		for (let y = 0; y < H; y++) {
			const t = yu[y] * W;
			const m = y * W;
			const b = yd[y] * W;
			const crow = Math.floor(y / cell) * cx;
			for (let x = 0; x < W; x++) {
				const c = crow + cellOf[x];
				const p = m + x;
				const o = c * 3 * NB;
				colH[o + bin(L[p], r0)]++;
				colH[o + NB + bin(A2[p], r1)]++;
				colH[o + 2 * NB + bin(B2[p], r2)]++;
				const l = xl[x];
				const rr = xr[x];
				const gx = (L[t + rr] + 2 * L[m + rr] + L[b + rr] - L[t + l] - 2 * L[m + l] - L[b + l]) / 8;
				// y up (orientation angles read like the light azimuth convention, as the global gradient term).
				const gy = (L[t + l] + 2 * L[t + x] + L[t + rr] - L[b + l] - 2 * L[b + x] - L[b + rr]) / 8;
				const mg = Math.hypot(gx, gy);
				magH[c * MAG_BINS + (mg >= 1e-3 ? Math.min(MAG_BINS - 1, 1 + Math.floor((Math.log2(mg) - MAG_LO) * 2)) : 0)]++;
				if (mg > 2e-3) {
					const tt = ((Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI)) * ORI_BINS - 0.5;
					const i0 = Math.floor(tt);
					const f = tt - i0;
					oriH[c * ORI_BINS + ((i0 + ORI_BINS) % ORI_BINS)] += mg * (1 - f);
					oriH[c * ORI_BINS + ((i0 + 1) % ORI_BINS)] += mg * f;
					edgeS[c] += mg;
				}
			}
		}
	}
	// Every level: mean |central difference| along 0°, 45°, 90°, 135° — detail per scale and direction.
	for (let l = 0; l < levels; l++) {
		const { w, h, v } = pyr[l];
		const xl = neighbours(w, -1, wrap);
		const xr = neighbours(w, 1, wrap);
		const yu = neighbours(h, -1, wrap);
		const yd = neighbours(h, 1, wrap);
		const cs = cell / 2 ** l;
		const cellOf = Int32Array.from({ length: w }, (_, x) => Math.min(cx - 1, Math.floor(x / cs)));
		for (let y = 0; y < h; y++) {
			const t = yu[y] * w;
			const m = y * w;
			const b = yd[y] * w;
			const crow = Math.min(cy - 1, Math.floor(y / cs)) * cx;
			for (let x = 0; x < w; x++) {
				const c = crow + cellOf[x];
				const gx = 0.5 * (v[m + xr[x]] - v[m + xl[x]]);
				const gy = 0.5 * (v[b + x] - v[t + x]);
				const o = (c * levels + l) * ORIENTS;
				detS[o] += Math.abs(gx);
				detS[o + 1] += Math.SQRT1_2 * Math.abs(gx + gy);
				detS[o + 2] += Math.abs(gy);
				detS[o + 3] += Math.SQRT1_2 * Math.abs(gx - gy);
				cnt[c * levels + l]++;
			}
		}
	}

	// Windows: CELLS × CELLS cells every `step` cells (wrapping), or spread so the last one ends at the image edge.
	const step = Math.max(1, opts.step ?? Math.max(STEP, Math.ceil(Math.max(cx, cy) / MAX_ACROSS)));
	const starts = (nc: number) => {
		if (wrap) return Array.from({ length: Math.max(1, Math.ceil(nc / step)) }, (_, i) => i * step);
		if (nc <= CELLS) return [0];
		const k = Math.ceil((nc - CELLS) / step) + 1;
		return Array.from({ length: k }, (_, i) => Math.round((i * (nc - CELLS)) / (k - 1)));
	};
	const sx = starts(cx);
	const sy = starts(cy);
	const count = sx.length * sy.length;
	const bank: WindowBank = {
		width: W,
		height: H,
		size,
		cell,
		count,
		x: new Int32Array(count),
		y: new Int32Array(count),
		cellsX: cx,
		cellsY: cy,
		cells: new Int32Array(count * CELLS * CELLS).fill(-1),
		ranges,
		colour: new Float32Array(count * 3 * NB),
		mag: new Float32Array(count * MAG_BINS),
		ori: new Float32Array(count * ORI_BINS),
		edge: new Float32Array(count),
		detail: new Float32Array(count * levels * ORIENTS),
		levels
	};
	const col = new Float64Array(3 * NB);
	const mag = new Float64Array(MAG_BINS);
	const ori = new Float64Array(ORI_BINS);
	const det = new Float64Array(levels * ORIENTS);
	const ct = new Float64Array(levels);
	let k = 0;
	for (const y0 of sy)
		for (const x0 of sx) {
			bank.x[k] = x0 * cell;
			bank.y[k] = y0 * cell;
			col.fill(0);
			mag.fill(0);
			ori.fill(0);
			det.fill(0);
			ct.fill(0);
			let edge = 0;
			let ci = 0;
			for (let j = 0; j < Math.min(CELLS, cy); j++)
				for (let i = 0; i < Math.min(CELLS, cx); i++) {
					const c = ((y0 + j) % cy) * cx + ((x0 + i) % cx);
					bank.cells[k * CELLS * CELLS + ci++] = c;
					for (let q = 0; q < 3 * NB; q++) col[q] += colH[c * 3 * NB + q];
					for (let q = 0; q < MAG_BINS; q++) mag[q] += magH[c * MAG_BINS + q];
					for (let q = 0; q < ORI_BINS; q++) ori[q] += oriH[c * ORI_BINS + q];
					for (let q = 0; q < levels * ORIENTS; q++) det[q] += detS[c * levels * ORIENTS + q];
					for (let l = 0; l < levels; l++) ct[l] += cnt[c * levels + l];
					edge += edgeS[c];
				}
			const px = ct[0];
			// Cumulative, normalised histograms: W1 / EMD become L1 between them.
			for (let ch = 0; ch < 3; ch++) {
				let acc = 0;
				for (let q = 0; q < NB; q++) {
					acc += col[ch * NB + q] / px;
					bank.colour[(k * 3 + ch) * NB + q] = acc;
				}
			}
			for (let l = 0; l < levels; l++)
				for (let o = 0; o < ORIENTS; o++)
					bank.detail[(k * levels + l) * ORIENTS + o] = Math.log10(det[l * ORIENTS + o] / ct[l] + 1e-5);
			let acc = 0;
			for (let q = 0; q < MAG_BINS; q++) {
				acc += mag[q] / px;
				bank.mag[k * MAG_BINS + q] = acc;
			}
			acc = 0;
			for (let q = 0; q < ORI_BINS; q++) {
				acc += edge > 1e-9 ? ori[q] / edge : 1 / ORI_BINS;
				bank.ori[k * ORI_BINS + q] = acc;
			}
			bank.edge[k] = edge / px;
			k++;
		}
	return bank;
}

const norm = (raw: number, scale: number) => (raw <= 0 ? 0 : raw / (raw + scale));

/** Raw part distances between window i of a and window j of b. */
function partDistances(
	a: WindowBank,
	i: number,
	b: WindowBank,
	j: number,
	scratch: Float64Array,
	out: Record<WindowPart, number>
): void {
	// Colour: W1 per channel (bin widths are shared), summed — ≈ ΔE for a uniform shift.
	let colour = 0;
	for (let ch = 0; ch < 3; ch++) {
		let s = 0;
		for (let q = 0, ia = (i * 3 + ch) * NB, ib = (j * 3 + ch) * NB; q < NB - 1; q++)
			s += Math.abs(a.colour[ia + q] - b.colour[ib + q]);
		colour += s * a.ranges[ch].width;
	}
	out.colour = colour;
	// Edges: magnitude EMD in octaves + orientation EMD (turn fraction ×4), as the global gradient term.
	let s = 0;
	for (let q = 0, ia = i * MAG_BINS, ib = j * MAG_BINS; q < MAG_BINS - 1; q++)
		s += Math.abs(a.mag[ia + q] - b.mag[ib + q]);
	const magEmd = s * 0.5;
	// Circular EMD: Σ|c − median c| of the cumulative difference (median by insertion sort into the scratch's top half).
	for (let q = 0, ia = i * ORI_BINS, ib = j * ORI_BINS; q < ORI_BINS; q++) {
		const v = a.ori[ia + q] - b.ori[ib + q];
		scratch[q] = v;
		let k = ORI_BINS + q;
		while (k > ORI_BINS && scratch[k - 1] > v) {
			scratch[k] = scratch[k - 1];
			k--;
		}
		scratch[k] = v;
	}
	const med = scratch[ORI_BINS + (ORI_BINS >> 1)];
	s = 0;
	for (let q = 0; q < ORI_BINS; q++) s += Math.abs(scratch[q] - med);
	const edge = Math.min(1, Math.max(a.edge[i], b.edge[j]) / 0.01);
	out.edges = 0.5 * magEmd + 0.5 * (s / ORI_BINS) * 4 * edge;
	// Detail: mean |Δlog10| of the oriented amplitudes per level.
	const lv = Math.min(a.levels, b.levels);
	s = 0;
	for (let q = 0, ia = i * a.levels * ORIENTS, ib = j * b.levels * ORIENTS; q < lv * ORIENTS; q++)
		s += Math.min(3, Math.abs(a.detail[ia + q] - b.detail[ib + q]));
	out.detail = s / (lv * ORIENTS);
}

export interface WindowResult {
	/** ½ (coherence + completeness): mean nearest-neighbour distance of the windows, ≈0..1. */
	raw: number;
	/** Mean over the render's windows of the distance to the closest reference window. */
	coherence: number;
	/** Mean over the reference's windows of the distance to the closest render window. */
	completeness: number;
	/** Per window of `render`: distance to its closest reference window (for a mismatch map). */
	perWindow: Float32Array;
	/** Mean raw part distances of the matched pairs (render → reference), for reporting. */
	parts: Record<WindowPart, number>;
}

/**
 * Bidirectional nearest-neighbour distance between the windows of a render and of a reference (same window size).
 * Each pair's distance is the weighted mean of its normalised part distances (0 identical … 1 unrelated).
 */
export function compareWindows(
	render: WindowBank,
	target: WindowBank,
	weights: WindowWeights = DEFAULT_WINDOW_WEIGHTS
): WindowResult {
	if (render.size !== target.size) throw new Error('compareWindows: window sizes differ');
	const K = render.count;
	const M = target.count;
	const colMin = new Float32Array(M).fill(Infinity);
	const perWindow = new Float32Array(K);
	const bestJ = new Int32Array(K);
	const scratch = new Float64Array(2 * ORI_BINS);
	const pd = { colour: 0, edges: 0, detail: 0 };
	const w = WINDOW_PARTS.map((p) => Math.max(0, weights[p]));
	const wsum = w.reduce((a, b) => a + b, 0) || 1;
	for (let i = 0; i < K; i++) {
		let best = Infinity;
		for (let j = 0; j < M; j++) {
			partDistances(render, i, target, j, scratch, pd);
			const d =
				(w[0] * norm(pd.colour, WINDOW_SCALES.colour) +
					w[1] * norm(pd.edges, WINDOW_SCALES.edges) +
					w[2] * norm(pd.detail, WINDOW_SCALES.detail)) /
				wsum;
			if (d < best) {
				best = d;
				bestJ[i] = j;
			}
			if (d < colMin[j]) colMin[j] = d;
		}
		perWindow[i] = best;
	}
	let coherence = 0;
	for (let i = 0; i < K; i++) coherence += perWindow[i];
	coherence /= K || 1;
	let completeness = 0;
	for (let j = 0; j < M; j++) completeness += colMin[j];
	completeness /= M || 1;
	const parts = { colour: 0, edges: 0, detail: 0 };
	for (let i = 0; i < K; i++) {
		partDistances(render, i, target, bestJ[i], scratch, pd);
		for (const p of WINDOW_PARTS) parts[p] += pd[p] / (K || 1);
	}
	return { raw: 0.5 * (coherence + completeness), coherence, completeness, perWindow, parts };
}

/**
 * Mismatch map of a render's windows: per pixel, the mean distance (0..1) of the windows covering it to their
 * closest reference windows — where the render's local texture has no counterpart in the reference.
 */
export function windowMismatch(
	bank: WindowBank,
	perWindow: Float32Array
): { width: number; height: number; values: Float32Array } {
	const sum = new Float32Array(bank.cellsX * bank.cellsY);
	const n = new Float32Array(sum.length);
	for (let k = 0; k < bank.count; k++)
		for (let q = 0; q < CELLS * CELLS; q++) {
			const c = bank.cells[k * CELLS * CELLS + q];
			if (c < 0) continue;
			sum[c] += perWindow[k];
			n[c]++;
		}
	const values = new Float32Array(bank.width * bank.height);
	for (let y = 0; y < bank.height; y++)
		for (let x = 0; x < bank.width; x++) {
			const c = Math.floor(y / bank.cell) * bank.cellsX + Math.floor(x / bank.cell);
			values[y * bank.width + x] = n[c] ? sum[c] / n[c] : 0;
		}
	return { width: bank.width, height: bank.height, values };
}
