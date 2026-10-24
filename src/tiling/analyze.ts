// What makes a tile's repeat obvious (docs/features/fr9-tiling-workspace.md). Pure TypeScript over a final render,
// usable in the app, the headless page and Node tools. Four terms, each a number and a map of where:
//
//   - patches: areas of a colour found nowhere else in the tile (a big dark shadow, one bright face) — colour rarity
//     after blurring at region scale, so small specks don't count, only areas the eye picks out.
//   - lines: long straight edges unlike the lines around them — one crease across the tile, not brick courses or panel
//     seams, which recur everywhere alike.
//   - clumping: feature density (gradient strength) varying across the tile at low frequency — clumps and holes.
//   - tone: the colour itself varying across the tile at low frequency — blotches, a lighter corner.
//
// Measured on a copy of the render at WORK_SIZE px (short side), in units of that size, so the terms don't change with
// the canvas size or supersampling; the maps come back at the render's size (upsampled when first read). Low frequency
// is up to `cycles` cycles per tile on each axis (within a circle).
//
// The per-pixel work is in two kernels, the colour rarity and the line sums (`tilingKernels`); the GPU computes them in
// a few ms (src/tiling/gpu.ts, passed as `gpu`), this file is the reference and the fallback where there is no GPU.
// Sums over the tile, quantiles and the low band stay here.
//
//   const a = analyzeTiling(render)          // a.score 0..1, a.terms, a.maps.hotspot (0..1 per pixel)

import { resampleLinearToOklab, toLinearPremul, toOklab, type LabPlanes, type MatchImage } from '@/match/image';
import { sortFloat32 } from '@/match/quantiles';

export type TilingTerm = 'patches' | 'lines' | 'clumping' | 'tone';
export const TILING_TERMS: TilingTerm[] = ['patches', 'lines', 'clumping', 'tone'];

/**
 * Raw value per term that maps to 0.5 (`raw / (raw + scale)`): patches — colour rarity (nats) above the tile's median;
 * lines — line strength above its equals, in mean gradients; clumping — relative variation of the low-passed density;
 * tone — rms OKLab ΔE of the low-passed colour. Scales and weights fitted to critics' ratings of the example projects'
 * 3 × 3 tilings (docs/features/fr9-tiling-workspace.md, _Calibration_): lines rank the tilings best; patches find
 * where the problem is better than they tell how bad it is, so they count more in the hotspot map than in the score.
 */
export const TILING_SCALES: Record<TilingTerm, number> = { patches: 1.5, lines: 0.25, clumping: 0.4, tone: 0.03 };
export const DEFAULT_TILING_WEIGHTS: Record<TilingTerm, number> = { patches: 1, lines: 3, clumping: 0.5, tone: 0.5 };
/** How much each term's map counts in the hotspot map (fitted to where the critics marked). */
export const HOTSPOT_WEIGHTS: Record<TilingTerm, number> = { patches: 1, lines: 1, clumping: 0.5, tone: 0.5 };

/** Short side the terms are measured at (px). */
export const WORK_SIZE = 128;

export interface TilingOptions {
	/** Low band for clumping and tone, in cycles per tile (default 3). */
	cycles?: number;
	weights?: Partial<Record<TilingTerm, number>>;
}

export interface TilingMaps {
	width: number;
	height: number;
	/** Per pixel, in each term's raw units (see TILING_SCALES). */
	patches: Float32Array;
	lines: Float32Array;
	clumping: Float32Array;
	tone: Float32Array;
	/** All terms together, 0..1: where the repeat draws the eye (each map from its median to its top ½ %, the max). */
	hotspot: Float32Array;
}

export interface TilingAnalysis {
	/** Weighted mean of the normalised terms, 0 (repeat invisible) … 1. */
	score: number;
	/** Raw term values. */
	raw: Record<TilingTerm, number>;
	/** Normalised term values 0..1. */
	terms: Record<TilingTerm, number>;
	/** At the render's size (upsampled from the work size when first read). */
	maps: TilingMaps;
	/** The maps at the work size. */
	work: TilingMaps;
}

/** The per-pixel kernels of the analysis, at the work size: what the GPU computes (src/tiling/gpu.ts). */
export interface TilingKernels {
	/** The render in OKLab. */
	lab: LabPlanes;
	/** Feature density: the Sobel gradient magnitude of L. */
	density: Float32Array;
	/** Per RARITY_RADII: −log of how common each pixel's blurred colour is among the rest of the tile. */
	rarity: Float32Array[];
	/** Per line direction: the signed gradient across the line, summed along it (2 · half + 1 taps). */
	lineSums: Float32Array[];
}

/** Computes the kernels elsewhere (the GPU); null when it can't, and the CPU does. */
export interface TilingKernelSource {
	kernels(img: MatchImage, width: number, height: number): TilingKernels | null;
}

const norm = (raw: number, scale: number) => (raw <= 0 ? 0 : raw / (raw + scale));

/** The size a render is analysed at: its short side scaled to WORK_SIZE (never up). */
export function workSize(width: number, height: number): [number, number] {
	const k = Math.min(1, WORK_SIZE / Math.min(width, height));
	return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}

/** Analyse a final render (tileable: everything wraps). `gpu` computes the kernels when given. */
export function analyzeTiling(
	img: MatchImage,
	opts: TilingOptions = {},
	gpu?: TilingKernelSource | null
): TilingAnalysis {
	const [w, h] = workSize(img.width, img.height);
	const kernels = gpu?.kernels(img, w, h) ?? tilingKernels(workLab(img, w, h));
	return finishAnalysis(kernels, opts, img.width, img.height);
}

/** The render in OKLab at the work size (box-filtered in linear light). */
export function workLab(img: MatchImage, w: number, h: number): LabPlanes {
	if (w === img.width && h === img.height) return toOklab(img);
	return resampleLinearToOklab(toLinearPremul(img), w, h, undefined, 'box');
}

/** The analysis from its kernels; the maps come back at `width` × `height`. */
export function finishAnalysis(
	kernels: TilingKernels,
	opts: TilingOptions = {},
	width = kernels.lab.width,
	height = kernels.lab.height
): TilingAnalysis {
	const { lab, density } = kernels;
	const { width: W, height: H } = lab;
	const n = W * H;
	const cycles = opts.cycles ?? 3;
	const weights = { ...DEFAULT_TILING_WEIGHTS, ...opts.weights };
	const geo = tilingGeometry(W, H);

	// Patches: each radius' rarity above the tile's median, the larger.
	const patches = new Float32Array(n);
	for (const rare of kernels.rarity) {
		const med = quantile(sortFloat32(rare), 0.5);
		for (let i = 0; i < n; i++) patches[i] = Math.max(patches[i], rare[i] - med);
	}
	const dMean = mean(density) || 1e-6;
	const lines = uniqueLines(kernels.lineSums, W, H, geo, dMean);
	const band = lowBand(W, H, cycles);

	// Clumping: relative deviation of the low-passed density from its mean.
	const dLow = band.lowpass(density);
	const clumpMap = new Float32Array(n);
	let clumpSq = 0;
	for (let i = 0; i < n; i++) {
		const r = (dLow[i] - dMean) / dMean;
		clumpMap[i] = Math.abs(r);
		clumpSq += r * r;
	}

	// Tone: OKLab ΔE of the low-passed colour from the mean colour (a, b weighted as L, as ΔE does).
	const toneMap = new Float32Array(n);
	let toneSq = 0;
	const lows = [lab.L, lab.A, lab.B].map((c) => {
		const m = mean(c);
		const lp = band.lowpass(c);
		for (let i = 0; i < lp.length; i++) lp[i] -= m;
		return lp;
	});
	for (let i = 0; i < n; i++) {
		const sq = lows[0][i] ** 2 + lows[1][i] ** 2 + lows[2][i] ** 2;
		toneMap[i] = Math.sqrt(sq);
		toneSq += sq;
	}

	const maps = { patches, lines, clumping: clumpMap, tone: toneMap };
	const sorted = Object.fromEntries(TILING_TERMS.map((t) => [t, sortFloat32(maps[t])])) as Record<
		TilingTerm,
		Float32Array
	>;
	const raw: Record<TilingTerm, number> = {
		patches: topMean(sorted.patches, 0.02),
		lines: topMean(sorted.lines, 0.01),
		clumping: Math.sqrt(clumpSq / n),
		tone: Math.sqrt(toneSq / n)
	};
	const terms = Object.fromEntries(TILING_TERMS.map((t) => [t, norm(raw[t], TILING_SCALES[t])])) as Record<
		TilingTerm,
		number
	>;
	const wsum = TILING_TERMS.reduce((s, t) => s + Math.max(0, weights[t]), 0) || 1;
	const score = TILING_TERMS.reduce((s, t) => s + Math.max(0, weights[t]) * terms[t], 0) / wsum;

	// Hotspot: each term's map from its median (0) to its top ½ % (1), weighted, the largest.
	const hotspot = new Float32Array(n);
	for (const t of TILING_TERMS) {
		const m = maps[t];
		const lo = quantile(sorted[t], 0.5);
		const span = quantile(sorted[t], 0.995) - lo;
		if (!(span > 0)) continue;
		const w = HOTSPOT_WEIGHTS[t];
		for (let i = 0; i < n; i++) hotspot[i] = Math.max(hotspot[i], w * Math.min(1, Math.max(0, (m[i] - lo) / span)));
	}

	const work: TilingMaps = { width: W, height: H, ...maps, hotspot };
	return { score, raw, terms, maps: width === W && height === H ? work : upsampledMaps(work, width, height), work };
}

/** `work` at w × h, each map upsampled when first read (the fix search reads none of them). */
function upsampledMaps(work: TilingMaps, w: number, h: number): TilingMaps {
	const maps = { width: w, height: h } as TilingMaps;
	for (const key of [...TILING_TERMS, 'hotspot'] as const) {
		let m: Float32Array | null = null;
		Object.defineProperty(maps, key, {
			enumerable: true,
			get: () => (m ??= upsample(work[key], work.width, work.height, w, h))
		});
	}
	return maps;
}

/** Colour samples for the rarity density, and the density's kernel width (OKLab ΔE). */
export const RARITY_SAMPLES = 2000;
export const RARITY_KERNEL = 0.02;

/** Blur radii (px of a 128 px tile) the rarity is measured at: areas the size of a feature, and larger ones. */
const RARITY_RADII = [2, 5];
/** Own neighbourhood (px of a 128 px tile) left out of the density: an area isn't its own equal. */
const RARITY_EXCLUDE = 16;

/** Orientations of the line search, and the line length in px of a 128 px tile. */
const LINE_DIRS = 16;
const LINE_LENGTH = 64;
/**
 * Share of the tile a direction's strongest lines may cover and still be each other's equals: brick courses or panel
 * seams of one direction recurring through the tile cover more, one crease across it less.
 */
const LINE_EQUALS = 0.03;

/** The kernels' sizes for a W × H work plane (shared with the GPU passes). */
export interface TilingGeometry {
	/** Blur radius per rarity measurement (px). */
	radii: number[];
	/** Neighbourhood left out of the rarity density: samples closer than this on both axes (px, wrapped). */
	exclude: number;
	/** Rarity sample positions (pixel indices). */
	samples: Int32Array;
	/** Taps each side of a line's centre (the line has 2 · half + 1). */
	half: number;
	/** Line directions (cos, sin), 0 … π. */
	dirs: [number, number][];
}

export function tilingGeometry(W: number, H: number): TilingGeometry {
	const unit = Math.min(W, H) / WORK_SIZE;
	const n = W * H;
	const m = Math.min(n, RARITY_SAMPLES);
	return {
		radii: RARITY_RADII.map((r) => Math.max(1, Math.round(r * unit))),
		exclude: RARITY_EXCLUDE * unit,
		samples: Int32Array.from({ length: m }, (_, k) => Math.floor(((k + 0.5) * n) / m)),
		half: Math.max(2, Math.round((LINE_LENGTH * unit) / 2)),
		dirs: Array.from({ length: LINE_DIRS }, (_, k): [number, number] => {
			const th = (Math.PI * k) / LINE_DIRS;
			return [Math.cos(th), Math.sin(th)];
		})
	};
}

/** The kernels on the CPU, from the render in OKLab at the work size. */
export function tilingKernels(lab: LabPlanes): TilingKernels {
	const { width: W, height: H } = lab;
	const geo = tilingGeometry(W, H);
	const { gx, gy, mag } = sobel(lab.L, W, H);
	return { lab, density: mag, rarity: colourRarity(lab, geo), lineSums: lineSums(gx, gy, W, H, geo) };
}

/** e^−u over the rarity kernel's support (u < 4.5, d² < its cut), linearly interpolated: ±1e-6. */
const EXP_N = 2048;
const EXP_K = EXP_N / 4.5;
const EXP_TABLE = Float64Array.from({ length: EXP_N + 2 }, (_, i) => Math.exp(-i / EXP_K));

/**
 * Colour areas without an equal elsewhere in the tile: the colour blurred over a few px, then −log of how common that
 * colour is among the (blurred) colours of the rest of the tile — a kernel density over a fixed sample of pixels,
 * leaving out those within RARITY_EXCLUDE of it; per radius (the analysis takes each above the tile's median, the
 * larger). Blurring keeps it to areas (a dark speck blurs into its surroundings, a big dark shadow stays dark); leaving
 * out the neighbourhood keeps it to unique ones (a dark dot among many has its equals at the other dots, however few
 * pixels they cover).
 */
function colourRarity(lab: LabPlanes, geo: TilingGeometry): Float32Array[] {
	const { width: W, height: H } = lab;
	const n = W * H;
	const idx = geo.samples;
	const m = idx.length;
	const px = Int32Array.from(idx, (j) => j % W);
	const py = Int32Array.from(idx, (j) => Math.floor(j / W));
	const ex = geo.exclude;
	const inv = 1 / (2 * RARITY_KERNEL * RARITY_KERNEL);
	const cut = 9 * RARITY_KERNEL * RARITY_KERNEL;
	// Samples left in per pixel: m minus the samples in its wrapped neighbourhood (a box count of their positions).
	const ind = new Float32Array(n);
	for (let j = 0; j < m; j++) ind[py[j] * W + px[j]] += 1;
	const inBox = boxSum(ind, W, H, Math.ceil(ex) - 1);
	// Samples bucketed by colour in cells of 3 σ: every sample within the kernel's cut lies in the 27 cells around.
	const cell = 3 * RARITY_KERNEL;
	return geo.radii.map((r) => {
		const [L, A, B] = [lab.L, lab.A, lab.B].map((c) => boxBlur(c, W, H, r));
		const lo = [L, A, B].map((c) => c.reduce((a, v) => Math.min(a, v), Infinity));
		const hi = [L, A, B].map((c) => c.reduce((a, v) => Math.max(a, v), -Infinity));
		const [nl, na, nb] = [0, 1, 2].map((c) => Math.floor((hi[c] - lo[c]) / cell) + 1);
		const cellOf = (l: number, a: number, b: number) =>
			(Math.floor((l - lo[0]) / cell) * na + Math.floor((a - lo[1]) / cell)) * nb + Math.floor((b - lo[2]) / cell);
		const start = new Int32Array(nl * na * nb + 1);
		const sc = Int32Array.from(idx, (j) => cellOf(L[j], A[j], B[j]));
		for (let j = 0; j < m; j++) start[sc[j] + 1]++;
		for (let c = 0; c + 1 < start.length; c++) start[c + 1] += start[c];
		const fill = start.slice(0, -1);
		const sL = new Float32Array(m);
		const sA = new Float32Array(m);
		const sB = new Float32Array(m);
		const sx = new Int32Array(m);
		const sy = new Int32Array(m);
		for (let j = 0; j < m; j++) {
			const k = fill[sc[j]]++;
			sL[k] = L[idx[j]];
			sA[k] = A[idx[j]];
			sB[k] = B[idx[j]];
			sx[k] = px[j];
			sy[k] = py[j];
		}
		const rare = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const x = i % W;
			const y = (i - x) / W;
			const Li = L[i];
			const Ai = A[i];
			const Bi = B[i];
			const li = Math.floor((Li - lo[0]) / cell);
			const ai = Math.floor((Ai - lo[1]) / cell);
			const bi = Math.floor((Bi - lo[2]) / cell);
			let p = 0;
			for (let cl = Math.max(0, li - 1); cl <= Math.min(nl - 1, li + 1); cl++)
				for (let ca = Math.max(0, ai - 1); ca <= Math.min(na - 1, ai + 1); ca++) {
					const base = (cl * na + ca) * nb;
					const k1 = start[base + Math.min(nb - 1, bi + 1) + 1];
					for (let k = start[base + Math.max(0, bi - 1)]; k < k1; k++) {
						const d = (Li - sL[k]) ** 2 + (Ai - sA[k]) ** 2 + (Bi - sB[k]) ** 2;
						if (!(d < cut)) continue;
						const ddx = Math.abs(sx[k] - x);
						const ddy = Math.abs(sy[k] - y);
						if (Math.min(ddx, W - ddx) < ex && Math.min(ddy, H - ddy) < ex) continue;
						const u = d * inv * EXP_K;
						const ui = u | 0;
						p += EXP_TABLE[ui] + (EXP_TABLE[ui + 1] - EXP_TABLE[ui]) * (u - ui);
					}
				}
			rare[i] = -Math.log(p / (m - inBox[i] || 1) + 1e-6);
		}
		return rare;
	});
}

/**
 * Per direction, the signed gradient across the line (only edges of one polarity add up) summed along a line of half
 * the tile. The taps fall at the same sub-pixel offsets from every pixel, so each direction is one sparse kernel of
 * integer offsets (its bilinear weights merged) over a plane padded by the kernel's reach, so no tap wraps.
 */
function lineSums(gx: Float32Array, gy: Float32Array, W: number, H: number, geo: TilingGeometry): Float32Array[] {
	const { half } = geo;
	return geo.dirs.map(([dx, dy]) => {
		const kw = new Map<number, number>();
		let ox0 = 0;
		let ox1 = 0;
		let oy0 = 0;
		let oy1 = 0;
		const add = (ox: number, oy: number, w: number) => {
			if (w === 0) return;
			ox0 = Math.min(ox0, ox);
			ox1 = Math.max(ox1, ox);
			oy0 = Math.min(oy0, oy);
			oy1 = Math.max(oy1, oy);
			const key = (oy + 4096) * 8192 + ox + 4096;
			kw.set(key, (kw.get(key) ?? 0) + w);
		};
		for (let q = -half; q <= half; q++) {
			const fx0 = Math.floor(q * dx);
			const fy0 = Math.floor(q * dy);
			const fx = q * dx - fx0;
			const fy = q * dy - fy0;
			add(fx0, fy0, (1 - fx) * (1 - fy));
			add(fx0 + 1, fy0, fx * (1 - fy));
			add(fx0, fy0 + 1, (1 - fx) * fy);
			add(fx0 + 1, fy0 + 1, fx * fy);
		}
		const PW = W + ox1 - ox0;
		const PH = H + oy1 - oy0;
		const pad = new Float32Array(PW * PH);
		for (let yy = 0; yy < PH; yy++) {
			const sy = (((yy + oy0) % H) + H) % H;
			for (let xx = 0; xx < PW; xx++) {
				const i = sy * W + ((((xx + ox0) % W) + W) % W);
				pad[yy * PW + xx] = gy[i] * dx - gx[i] * dy;
			}
		}
		const kOff = new Int32Array(kw.size);
		const kW = new Float64Array(kw.size);
		let kk = 0;
		for (const [key, w] of kw) {
			kOff[kk] = (Math.floor(key / 8192) - 4096 - oy0) * PW + ((key % 8192) - 4096 - ox0);
			kW[kk++] = w;
		}
		const sum = new Float32Array(W * H);
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const b0 = y * PW + x;
				let s = 0;
				for (let t = 0; t < kOff.length; t++) s += kW[t] * pad[b0 + kOff[t]];
				sum[y * W + x] = s;
			}
		return sum;
	});
}

/**
 * Long straight edges unlike their surroundings: per orientation, the line sum's strength in units of the tile's mean
 * gradient `gm`, minus the strength the strongest LINE_EQUALS of the tile reach in that direction. A crease across the
 * tile stands out; brick courses or panel seams have their equals all through it and cancel. Only lines that end
 * count: one running right through the tile joins its copies into one line across the grid, which reads as structure
 * (a seam, a course), while one that ends repeats as dashes the eye pairs up.
 */
function uniqueLines(sums: Float32Array[], W: number, H: number, geo: TilingGeometry, gm: number): Float32Array {
	const n = W * H;
	const { half } = geo;
	const out = new Float32Array(n);
	const strength = new Float32Array(n);
	const o = half + 0.5;
	sums.forEach((sum, k) => {
		const [dx, dy] = geo.dirs[k];
		for (let i = 0; i < n; i++) strength[i] = Math.abs(sum[i]) / (2 * half + 1) / gm;
		const equal = quantile(sortFloat32(strength), 1 - LINE_EQUALS);
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const i = y * W + x;
				if (!(strength[i] > equal)) continue;
				// Over twice the length: a line running on (through the tile, joining its copies) keeps its sum, a line
				// that ends inside the tile — a dash once tiled — loses half of it or more.
				const s2 = bilinear(sum, W, H, x - o * dx, y - o * dy) + bilinear(sum, W, H, x + o * dx, y + o * dy);
				const ends = Math.max(0, Math.min(1, 2 * (1 - Math.abs(s2) / (2 * Math.abs(sum[i])))));
				out[i] = Math.max(out[i], (strength[i] - equal) * ends);
			}
	});
	return out;
}

/** Mean of the largest `fraction` of the values (at least one), from the values sorted. */
function topMean(sorted: Float32Array, fraction: number): number {
	const k = Math.max(1, Math.round(sorted.length * fraction));
	let t = 0;
	for (let i = sorted.length - k; i < sorted.length; i++) t += sorted[i];
	return t / k;
}

/** Bilinear sample of a periodic plane. */
function bilinear(f: Float32Array, W: number, H: number, x: number, y: number): number {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const xa = ((x0 % W) + W) % W;
	const xb = (xa + 1) % W;
	const ya = (((y0 % H) + H) % H) * W;
	const yb = ((((y0 + 1) % H) + H) % H) * W;
	return (f[ya + xa] * (1 - fx) + f[ya + xb] * fx) * (1 - fy) + (f[yb + xa] * (1 - fx) + f[yb + xb] * fx) * fy;
}

/** A periodic plane resampled bilinearly to w × h. */
function upsample(f: Float32Array, W: number, H: number, w: number, h: number): Float32Array {
	const out = new Float32Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++)
			out[y * w + x] = bilinear(f, W, H, ((x + 0.5) * W) / w - 0.5, ((y + 0.5) * H) / h - 0.5);
	return out;
}

/** Wrapped index i (−len ≤ i < 2 · len) into 0 … len − 1. */
const wrap = (i: number, len: number) => (i < 0 ? i + len : i >= len ? i - len : i);

/** Circular box blur of radius r, twice (≈ Gaussian). */
function boxBlur(f: Float32Array, W: number, H: number, r: number): Float32Array {
	let src = f;
	const tmp = new Float32Array(W * H);
	for (let pass = 0; pass < 2; pass++) {
		for (let y = 0; y < H; y++) {
			const row = y * W;
			let s = 0;
			for (let d = -r; d <= r; d++) s += src[row + (((d % W) + W) % W)];
			for (let x = 0; x < W; x++) {
				tmp[row + x] = s / (2 * r + 1);
				s += src[row + ((x + r + 1) % W)] - src[row + ((((x - r) % W) + W) % W)];
			}
		}
		const out = new Float32Array(W * H);
		for (let x = 0; x < W; x++) {
			let s = 0;
			for (let d = -r; d <= r; d++) s += tmp[(((d % H) + H) % H) * W + x];
			for (let y = 0; y < H; y++) {
				out[y * W + x] = s / (2 * r + 1);
				s += tmp[((y + r + 1) % H) * W + x] - tmp[((((y - r) % H) + H) % H) * W + x];
			}
		}
		src = out;
	}
	return src;
}

/** Wrapped box sum, offsets −r … r on each axis (each counted once when 2r + 1 reaches the side). */
function boxSum(f: Float32Array, W: number, H: number, r: number): Float32Array {
	const pass = (
		src: Float32Array,
		len: number,
		stride: number,
		lines: number,
		lineStride: number,
		dst: Float32Array
	) => {
		const full = 2 * r + 1 >= len;
		for (let l = 0; l < lines; l++) {
			const o = l * lineStride;
			let s = 0;
			if (full) {
				for (let t = 0; t < len; t++) s += src[o + t * stride];
				for (let t = 0; t < len; t++) dst[o + t * stride] = s;
				continue;
			}
			for (let d = -r; d <= r; d++) s += src[o + wrap(d, len) * stride];
			for (let t = 0; t < len; t++) {
				dst[o + t * stride] = s;
				s += src[o + wrap(t + r + 1, len) * stride] - src[o + wrap(t - r, len) * stride];
			}
		}
	};
	const tmp = new Float32Array(W * H);
	const out = new Float32Array(W * H);
	pass(f, W, 1, H, W, tmp);
	pass(tmp, H, W, W, 1, out);
	return out;
}

/** Sobel gradient of a plane (gx, gy: per px, /8) and its magnitude, wrapping. */
function sobel(v: Float32Array, W: number, H: number): { gx: Float32Array; gy: Float32Array; mag: Float32Array } {
	const gx = new Float32Array(W * H);
	const gy = new Float32Array(W * H);
	const mag = new Float32Array(W * H);
	for (let y = 0; y < H; y++) {
		const yu = ((y - 1 + H) % H) * W;
		const y0 = y * W;
		const yd = ((y + 1) % H) * W;
		for (let x = 0; x < W; x++) {
			const xl = (x - 1 + W) % W;
			const xr = (x + 1) % W;
			const a = (v[yu + xr] + 2 * v[y0 + xr] + v[yd + xr] - v[yu + xl] - 2 * v[y0 + xl] - v[yd + xl]) / 8;
			const b = (v[yd + xl] + 2 * v[yd + x] + v[yd + xr] - v[yu + xl] - 2 * v[yu + x] - v[yu + xr]) / 8;
			gx[y0 + x] = a;
			gy[y0 + x] = b;
			mag[y0 + x] = Math.hypot(a, b);
		}
	}
	return { gx, gy, mag };
}

/**
 * The low band of a W × H periodic plane: the frequencies (kx, ky) cycles per tile with 0 < kx² + ky² ≤ cycles², summed
 * directly (a few dozen bins — any size, no FFT needed). `lowpass` returns the band plus the mean.
 */
export function lowBand(W: number, H: number, cycles: number): { lowpass: (v: Float32Array) => Float32Array } {
	const K = Math.max(0, Math.floor(cycles));
	const table = (n: number) => {
		const c: Float32Array[] = [];
		const s: Float32Array[] = [];
		for (let k = 0; k <= K; k++) {
			c.push(Float32Array.from({ length: n }, (_, x) => Math.cos((2 * Math.PI * k * x) / n)));
			s.push(Float32Array.from({ length: n }, (_, x) => Math.sin((2 * Math.PI * k * x) / n)));
		}
		return { c, s };
	};
	const tx = table(W);
	const ty = table(H);
	// Half plane: ky > 0, or ky = 0 and kx > 0; the conjugates are implied (real input).
	const bins: [number, number][] = [];
	for (let ky = 0; ky <= K; ky++)
		for (let kx = -K; kx <= K; kx++) {
			if (ky === 0 && kx <= 0) continue;
			if (kx * kx + ky * ky > cycles * cycles) continue;
			if (Math.abs(kx) * 2 >= W || ky * 2 >= H) continue; // above Nyquist on a tiny plane
			bins.push([kx, ky]);
		}
	return {
		lowpass(v) {
			const out = new Float32Array(W * H).fill(mean(v));
			const n = W * H;
			for (const [kx, ky] of bins) {
				const ax = Math.abs(kx);
				const sx = kx < 0 ? -1 : 1;
				// e^{-iθ}, θ = 2π (kx x / W + ky y / H): cos θ = cx cy − sx·sxk sy …, separably.
				let re = 0;
				let im = 0;
				for (let y = 0; y < H; y++) {
					const cy = ty.c[ky][y];
					const sy = ty.s[ky][y];
					for (let x = 0; x < W; x++) {
						const cx = tx.c[ax][x];
						const sxv = sx * tx.s[ax][x];
						const val = v[y * W + x];
						re += val * (cx * cy - sxv * sy);
						im -= val * (sxv * cy + cx * sy);
					}
				}
				// Add the bin and its conjugate: (2/n)(re cos θ − im sin θ).
				const a = (2 * re) / n;
				const b = (2 * im) / n;
				for (let y = 0; y < H; y++) {
					const cy = ty.c[ky][y];
					const sy = ty.s[ky][y];
					for (let x = 0; x < W; x++) {
						const cx = tx.c[ax][x];
						const sxv = sx * tx.s[ax][x];
						out[y * W + x] += a * (cx * cy - sxv * sy) - b * (sxv * cy + cx * sy);
					}
				}
			}
			return out;
		}
	};
}

function mean(v: Float32Array): number {
	let s = 0;
	for (let i = 0; i < v.length; i++) s += v[i];
	return s / (v.length || 1);
}

/** The q-quantile of values already sorted. */
function quantile(sorted: Float32Array, q: number): number {
	return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0;
}
