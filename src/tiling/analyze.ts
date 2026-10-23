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
// the canvas size or supersampling; the maps come back at the render's size. Low frequency is up to `cycles` cycles per
// tile on each axis (within a circle).
//
//   const a = analyzeTiling(render)          // a.score 0..1, a.terms, a.maps.hotspot (0..1 per pixel)

import { resample, toOklab, type LabPlanes, type MatchImage } from '@/match/image';

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
	maps: TilingMaps;
}

const norm = (raw: number, scale: number) => (raw <= 0 ? 0 : raw / (raw + scale));

/** Analyse a final render (tileable: everything wraps). */
export function analyzeTiling(img: MatchImage, opts: TilingOptions = {}): TilingAnalysis {
	const k = Math.min(1, WORK_SIZE / Math.min(img.width, img.height));
	const w = Math.max(1, Math.round(img.width * k));
	const h = Math.max(1, Math.round(img.height * k));
	const a = analyzeTilingLab(toOklab(k < 1 ? resample(img, w, h, 'box') : img), opts);
	if (k === 1) return a;
	const up = (m: Float32Array) => upsample(m, w, h, img.width, img.height);
	const maps = a.maps;
	return {
		...a,
		maps: {
			width: img.width,
			height: img.height,
			patches: up(maps.patches),
			lines: up(maps.lines),
			clumping: up(maps.clumping),
			tone: up(maps.tone),
			hotspot: up(maps.hotspot)
		}
	};
}

/** analyzeTiling of OKLab planes, at their own size (resample to about WORK_SIZE first). */
export function analyzeTilingLab(lab: LabPlanes, opts: TilingOptions = {}): TilingAnalysis {
	const { width: W, height: H } = lab;
	const cycles = opts.cycles ?? 3;
	const weights = { ...DEFAULT_TILING_WEIGHTS, ...opts.weights };
	const unit = Math.min(W, H) / WORK_SIZE;

	const patches = colourRarity(lab, unit);
	const density = gradientMagnitude(lab.L, W, H);
	const lines = uniqueLines(lab.L, W, H, unit);
	const band = lowBand(W, H, cycles);

	// Clumping: relative deviation of the low-passed density from its mean.
	const dMean = mean(density) || 1e-6;
	const dLow = band.lowpass(density);
	const clumpMap = new Float32Array(W * H);
	let clumpSq = 0;
	for (let i = 0; i < W * H; i++) {
		const r = (dLow[i] - dMean) / dMean;
		clumpMap[i] = Math.abs(r);
		clumpSq += r * r;
	}

	// Tone: OKLab ΔE of the low-passed colour from the mean colour (a, b weighted as L, as ΔE does).
	const toneMap = new Float32Array(W * H);
	let toneSq = 0;
	const lows = [lab.L, lab.A, lab.B].map((c) => {
		const m = mean(c);
		const lp = band.lowpass(c);
		for (let i = 0; i < lp.length; i++) lp[i] -= m;
		return lp;
	});
	for (let i = 0; i < W * H; i++) {
		const sq = lows[0][i] ** 2 + lows[1][i] ** 2 + lows[2][i] ** 2;
		toneMap[i] = Math.sqrt(sq);
		toneSq += sq;
	}

	const raw: Record<TilingTerm, number> = {
		patches: topMean(patches, 0.02),
		lines: topMean(lines, 0.01),
		clumping: Math.sqrt(clumpSq / (W * H)),
		tone: Math.sqrt(toneSq / (W * H))
	};
	const terms = Object.fromEntries(TILING_TERMS.map((t) => [t, norm(raw[t], TILING_SCALES[t])])) as Record<
		TilingTerm,
		number
	>;
	const wsum = TILING_TERMS.reduce((s, t) => s + Math.max(0, weights[t]), 0) || 1;
	const score = TILING_TERMS.reduce((s, t) => s + Math.max(0, weights[t]) * terms[t], 0) / wsum;

	// Hotspot: each term's map from its median (0) to its top ½ % (1), weighted, the largest.
	const maps = { patches, lines, clumping: clumpMap, tone: toneMap };
	const hotspot = new Float32Array(W * H);
	for (const t of TILING_TERMS) {
		const m = maps[t];
		const lo = median(m);
		const span = quantile(m, 0.995) - lo;
		if (!(span > 0)) continue;
		const w = HOTSPOT_WEIGHTS[t];
		for (let i = 0; i < m.length; i++)
			hotspot[i] = Math.max(hotspot[i], w * Math.min(1, Math.max(0, (m[i] - lo) / span)));
	}

	return { score, raw, terms, maps: { width: W, height: H, ...maps, hotspot } };
}

/** Colour samples for the rarity density, and the density's kernel width (OKLab ΔE). */
const RARITY_SAMPLES = 2000;
const RARITY_KERNEL = 0.02;

/** Blur radii (px of a 128 px tile) the rarity is measured at: areas the size of a feature, and larger ones. */
const RARITY_RADII = [2, 5];
/** Own neighbourhood (px of a 128 px tile) left out of the density: an area isn't its own equal. */
const RARITY_EXCLUDE = 16;

/**
 * Colour areas without an equal elsewhere in the tile: the colour blurred over a few px, then −log of how common that
 * colour is among the (blurred) colours of the rest of the tile — a kernel density over a fixed sample of pixels,
 * leaving out those within RARITY_EXCLUDE of it — minus the tile's median; the larger over the radii. Blurring keeps it
 * to areas (a dark speck blurs into its surroundings, a big dark shadow stays dark); leaving out the neighbourhood
 * keeps it to unique ones (a dark dot among many has its equals at the other dots, however few pixels they cover).
 */
function colourRarity(lab: LabPlanes, unit: number): Float32Array {
	const { width: W, height: H } = lab;
	const n = W * H;
	const out = new Float32Array(n);
	const m = Math.min(n, RARITY_SAMPLES);
	const idx = Array.from({ length: m }, (_, k) => Math.floor(((k + 0.5) * n) / m));
	const px = Int32Array.from(idx, (j) => j % W);
	const py = Int32Array.from(idx, (j) => Math.floor(j / W));
	const ex = RARITY_EXCLUDE * unit;
	const inv = 1 / (2 * RARITY_KERNEL * RARITY_KERNEL);
	const cut = 9 * RARITY_KERNEL * RARITY_KERNEL;
	const rare = new Float32Array(n);
	for (const radius of RARITY_RADII) {
		const r = Math.max(1, Math.round(radius * unit));
		const [L, A, B] = [lab.L, lab.A, lab.B].map((c) => boxBlur(c, W, H, r));
		const sL = Float32Array.from(idx, (j) => L[j]);
		const sA = Float32Array.from(idx, (j) => A[j]);
		const sB = Float32Array.from(idx, (j) => B[j]);
		for (let i = 0; i < n; i++) {
			const x = i % W;
			const y = (i - x) / W;
			let p = 0;
			let count = 0;
			for (let j = 0; j < m; j++) {
				const ddx = Math.abs(px[j] - x);
				const ddy = Math.abs(py[j] - y);
				if (Math.min(ddx, W - ddx) < ex && Math.min(ddy, H - ddy) < ex) continue;
				count++;
				const d = (L[i] - sL[j]) ** 2 + (A[i] - sA[j]) ** 2 + (B[i] - sB[j]) ** 2;
				if (d < cut) p += Math.exp(-d * inv);
			}
			rare[i] = -Math.log(p / (count || 1) + 1e-6);
		}
		const med = median(rare);
		for (let i = 0; i < n; i++) out[i] = Math.max(out[i], rare[i] - med);
	}
	return out;
}

/** Orientations of the line search, and the line length in px of a 128 px tile. */
const LINE_DIRS = 16;
const LINE_LENGTH = 64;
/**
 * Share of the tile a direction's strongest lines may cover and still be each other's equals: brick courses or panel
 * seams of one direction recurring through the tile cover more, one crease across it less.
 */
const LINE_EQUALS = 0.03;

/**
 * Long straight edges unlike their surroundings: per orientation, the edge strength across it (the signed gradient
 * across the line, so only edges of one polarity add up) averaged along a line of half the tile, in units of the
 * tile's mean gradient; minus the strength the strongest LINE_EQUALS of the tile reach in that direction. A crease
 * across the tile stands out; brick courses or panel seams have their equals all through it and cancel. Only lines
 * that end count: one running right through the tile joins its copies into one line across the grid, which reads as
 * structure (a seam, a course), while one that ends repeats as dashes the eye pairs up.
 */
function uniqueLines(L: Float32Array, W: number, H: number, unit: number): Float32Array {
	const n = W * H;
	const at = (x: number, y: number) => L[(((y % H) + H) % H) * W + (((x % W) + W) % W)];
	const gx = new Float32Array(n);
	const gy = new Float32Array(n);
	let gm = 0;
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x;
			gx[i] =
				(at(x + 1, y - 1) +
					2 * at(x + 1, y) +
					at(x + 1, y + 1) -
					at(x - 1, y - 1) -
					2 * at(x - 1, y) -
					at(x - 1, y + 1)) /
				8;
			gy[i] =
				(at(x - 1, y + 1) +
					2 * at(x, y + 1) +
					at(x + 1, y + 1) -
					at(x - 1, y - 1) -
					2 * at(x, y - 1) -
					at(x + 1, y - 1)) /
				8;
			gm += Math.hypot(gx[i], gy[i]);
		}
	gm = gm / n || 1e-6;
	const half = Math.max(2, Math.round((LINE_LENGTH * unit) / 2));
	const out = new Float32Array(n);
	const across = new Float32Array(n);
	const sum = new Float32Array(n);
	const strength = new Float32Array(n);
	for (let k = 0; k < LINE_DIRS; k++) {
		const th = (Math.PI * k) / LINE_DIRS;
		const dx = Math.cos(th);
		const dy = Math.sin(th);
		for (let i = 0; i < n; i++) across[i] = gy[i] * dx - gx[i] * dy;
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				let s = 0;
				for (let q = -half; q <= half; q++) s += bilinear(across, W, H, x + q * dx, y + q * dy);
				sum[y * W + x] = s;
				strength[y * W + x] = Math.abs(s) / (2 * half + 1) / gm;
			}
		const equal = quantile(strength, 1 - LINE_EQUALS);
		const o = half + 0.5;
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
	}
	return out;
}

/** Mean of the largest `fraction` of the values (at least one). */
function topMean(v: Float32Array, fraction: number): number {
	const s = Float32Array.from(v).sort();
	const k = Math.max(1, Math.round(s.length * fraction));
	let t = 0;
	for (let i = s.length - k; i < s.length; i++) t += s[i];
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

/** Circular box blur of radius r, twice (≈ Gaussian). */
function boxBlur(f: Float32Array, W: number, H: number, r: number): Float32Array {
	let src = f;
	const tmp = new Float32Array(W * H);
	for (let pass = 0; pass < 2; pass++) {
		for (let y = 0; y < H; y++) {
			let s = 0;
			for (let d = -r; d <= r; d++) s += src[y * W + (((d % W) + W) % W)];
			for (let x = 0; x < W; x++) {
				tmp[y * W + x] = s / (2 * r + 1);
				s += src[y * W + ((((x + r + 1) % W) + W) % W)] - src[y * W + ((((x - r) % W) + W) % W)];
			}
		}
		const out = new Float32Array(W * H);
		for (let x = 0; x < W; x++) {
			let s = 0;
			for (let d = -r; d <= r; d++) s += tmp[(((d % H) + H) % H) * W + x];
			for (let y = 0; y < H; y++) {
				out[y * W + x] = s / (2 * r + 1);
				s += tmp[((((y + r + 1) % H) + H) % H) * W + x] - tmp[((((y - r) % H) + H) % H) * W + x];
			}
		}
		src = out;
	}
	return src;
}

/** Sobel gradient magnitude of a plane, wrapping. */
export function gradientMagnitude(v: Float32Array, W: number, H: number): Float32Array {
	const out = new Float32Array(W * H);
	for (let y = 0; y < H; y++) {
		const yu = ((y - 1 + H) % H) * W;
		const y0 = y * W;
		const yd = ((y + 1) % H) * W;
		for (let x = 0; x < W; x++) {
			const xl = (x - 1 + W) % W;
			const xr = (x + 1) % W;
			const gx = v[yu + xr] + 2 * v[y0 + xr] + v[yd + xr] - v[yu + xl] - 2 * v[y0 + xl] - v[yd + xl];
			const gy = v[yd + xl] + 2 * v[yd + x] + v[yd + xr] - v[yu + xl] - 2 * v[yu + x] - v[yu + xr];
			out[y0 + x] = 0.125 * Math.hypot(gx, gy);
		}
	}
	return out;
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

function median(v: Float32Array): number {
	return quantile(v, 0.5);
}

function quantile(v: Float32Array, q: number): number {
	const s = Float32Array.from(v).sort();
	return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0;
}
