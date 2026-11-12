// Plane operations shared by the metric terms (metrics.ts, windows.ts) and the tiling analysis (src/tiling/analyze.ts):
// pyramid steps, wrapped neighbour tables, the Sobel gradient and its histogram bins. Pure TypeScript.

/** raw → 0..1: raw / (raw + scale), so `scale` maps to ½ (0 at or below 0). */
export const norm = (raw: number, scale: number) => (raw <= 0 ? 0 : raw / (raw + scale));

/** A scalar plane, rows top-down. */
export interface Plane {
	data: Float32Array;
	width: number;
	height: number;
}

/** One pyramid step: 2 × 2 box average (an odd last row / column is averaged with itself). */
export function boxDown(src: Float32Array, w: number, h: number): Plane {
	const W = Math.max(1, w >> 1);
	const H = Math.max(1, h >> 1);
	const out = new Float32Array(W * H);
	for (let y = 0; y < H; y++) {
		const y0 = Math.min(h - 1, y * 2) * w;
		const y1 = Math.min(h - 1, y * 2 + 1) * w;
		for (let x = 0; x < W; x++) {
			const x0 = Math.min(w - 1, x * 2);
			const x1 = Math.min(w - 1, x * 2 + 1);
			out[y * W + x] = 0.25 * (src[y0 + x0] + src[y0 + x1] + src[y1 + x0] + src[y1 + x1]);
		}
	}
	return { data: out, width: W, height: H };
}

/** Index of the neighbour at offset d of every i in 0…n−1 (wrapping, or clamped at the ends). */
export function neighbours(n: number, d: number, wrap: boolean): Int32Array {
	const out = new Int32Array(n);
	for (let i = 0; i < n; i++) out[i] = wrap ? (((i + d) % n) + n) % n : Math.max(0, Math.min(n - 1, i + d));
	return out;
}

/**
 * The Sobel gradient of a plane, per px (/8), with y up: orientation angles read counter-clockwise from +x, like the
 * light azimuth. Wrapping, or clamped at the edges. In doubles, as the histograms bin them.
 */
export function sobel(v: Float32Array, w: number, h: number, wrap: boolean): { gx: Float64Array; gy: Float64Array } {
	const xl = neighbours(w, -1, wrap);
	const xr = neighbours(w, 1, wrap);
	const yu = neighbours(h, -1, wrap);
	const yd = neighbours(h, 1, wrap);
	const gx = new Float64Array(w * h);
	const gy = new Float64Array(w * h);
	for (let y = 0; y < h; y++) {
		const t = yu[y] * w;
		const m = y * w;
		const b = yd[y] * w;
		for (let x = 0; x < w; x++) {
			const l = xl[x];
			const r = xr[x];
			gx[m + x] = (v[t + r] + 2 * v[m + r] + v[b + r] - v[t + l] - 2 * v[m + l] - v[b + l]) / 8;
			gy[m + x] = (v[t + l] + 2 * v[t + x] + v[t + r] - v[b + l] - 2 * v[b + x] - v[b + r]) / 8;
		}
	}
	return { gx, gy };
}

/** Gradient histograms: magnitude bins (< 1e-3, then half octaves from 1e-3 up to ~2, then ≥), orientation bins. */
export const MAG_BINS = 22;
const MAG_LO = Math.log2(1e-3);
export const ORI_BINS = 16;
/** Gradients weaker than this have no orientation (noise). */
const ORI_MIN = 2e-3;

/** The log-magnitude bin of a gradient magnitude. */
export function magBin(m: number): number {
	return m >= 1e-3 ? Math.min(MAG_BINS - 1, 1 + Math.floor((Math.log2(m) - MAG_LO) * 2)) : 0;
}

/**
 * Add a gradient's magnitude to the directed orientation histogram at `o` (ORI_BINS bins over 0..2π), split linearly
 * between the two nearest bins so the histogram is smooth. Returns the weight added (0 below ORI_MIN).
 */
export function addOrientation(
	hist: Float32Array | Float64Array,
	o: number,
	gx: number,
	gy: number,
	m: number
): number {
	if (!(m > ORI_MIN)) return 0;
	const t = ((Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI)) * ORI_BINS - 0.5;
	const i0 = Math.floor(t);
	const f = t - i0;
	hist[o + ((i0 + ORI_BINS) % ORI_BINS)] += m * (1 - f);
	hist[o + ((i0 + 1) % ORI_BINS)] += m * f;
	return m;
}

/**
 * EMD between two circular histograms from the cumulative differences `c` of their bins (n values; `scratch` holds n
 * more), as a fraction of the full circle (0..0.5): Σ|c − median c| / n. The median by insertion sort (n is small).
 */
export function circularEmd(c: Float64Array, n: number, scratch: Float64Array): number {
	for (let q = 0; q < n; q++) {
		const v = c[q];
		let k = q;
		while (k > 0 && scratch[k - 1] > v) {
			scratch[k] = scratch[k - 1];
			k--;
		}
		scratch[k] = v;
	}
	const med = scratch[n >> 1];
	let s = 0;
	for (let q = 0; q < n; q++) s += Math.abs(c[q] - med);
	return s / n;
}
