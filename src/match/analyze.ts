// Target analysis for emulation (docs/features/fr7.3-emulation.md): cheap statistics of a reference image that
// templates use to seed a project — size, tileability, a dark→light colour ramp, contrast and dominant
// orientation. Pure TypeScript (browser, headless page and Node).

import { linearToOklab, srgbToLinear1 } from '@/core/color';
import { extractPalette } from '@/render/post/palettes';
import type { MatchImage } from './image';

export interface Analysis {
	width: number;
	height: number;
	/** The image wraps seamlessly (seam differences no worse than interior ones). */
	tileable: boolean;
	/** Horizontal-only / vertical-only wrap (trims often tile along their length only). */
	tileX: boolean;
	tileY: boolean;
	/** Dominant colours (k-means, OKLab), sorted dark → light, sRGB hex. */
	palette: string[];
	/** Pixel-count weight of each palette entry (same order), sums to 1. */
	weights: number[];
	/** Mean / std of OKLab lightness. */
	meanL: number;
	stdL: number;
	/** Mean OKLab chroma (0 ≈ grey). */
	chroma: number;
	/** Mean absolute horizontal / vertical neighbour difference in L (edge energy per direction). */
	edgeX: number;
	edgeY: number;
	/** Fraction of strongly bright, saturated pixels (light fixtures, lava, glowing bits). */
	glow: number;
	/**
	 * Dominant repeat spacing in px along x (vertical lines: joints, seams) and y (horizontal lines: mortar
	 * courses, panel seams), from the circular autocorrelation of the column / row edge profiles. 0 = none found.
	 */
	periodX: number;
	periodY: number;
	/** Autocorrelation strength of those periods (0..1). */
	periodXStrength: number;
	periodYStrength: number;
	/** Offset (px from the top / left) of the strongest edge line within one period — for phase alignment. */
	phaseX: number;
	phaseY: number;
	/** Coarse class hints derived from the stats. */
	hints: string[];
}

/** Best period of a circular 1D profile: the first strong local maximum of its autocorrelation. */
function dominantPeriod(profile: Float64Array): { period: number; strength: number; phase: number } {
	const n = profile.length;
	if (n < 6) return { period: 0, strength: 0, phase: 0 };
	let mean = 0;
	for (const v of profile) mean += v;
	mean /= n;
	const c = profile.map((v) => v - mean);
	let v0 = 0;
	for (const v of c) v0 += v * v;
	if (v0 < 1e-9) return { period: 0, strength: 0, phase: 0 };
	const ac = new Float64Array(n);
	for (let lag = 0; lag < n; lag++) {
		let s = 0;
		for (let i = 0; i < n; i++) s += c[i] * c[(i + lag) % n];
		ac[lag] = s / v0;
	}
	// Candidate lags: local maxima in [3, n/2]; prefer the smallest lag whose peak is close to the best peak
	// (a period of 8 also peaks at 16, 24 …).
	let bestLag = 0;
	let bestVal = 0;
	for (let lag = 3; lag <= n / 2; lag++) {
		if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[(lag + 1) % n] && ac[lag] > bestVal) {
			bestVal = ac[lag];
			bestLag = lag;
		}
	}
	if (bestLag === 0 || bestVal < 0.2) return { period: 0, strength: Math.max(0, bestVal), phase: 0 };
	for (let lag = 3; lag < bestLag; lag++) {
		if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > bestVal * 0.8 && bestLag % lag <= 1) {
			bestLag = lag;
			break;
		}
	}
	// Phase: position of the strongest line folded into one period.
	const folded = new Float64Array(bestLag);
	for (let i = 0; i < n; i++) folded[i % bestLag] += profile[i];
	let phase = 0;
	for (let i = 1; i < bestLag; i++) if (folded[i] > folded[phase]) phase = i;
	return { period: bestLag, strength: ac[bestLag], phase };
}

/** Mean |ΔL| across a seam relative to interior neighbour differences. */
function seamRatio(L: Float32Array, w: number, h: number, axis: 'x' | 'y'): number {
	let seam = 0;
	let inner = 0;
	let n = 0;
	if (axis === 'x') {
		for (let y = 0; y < h; y++) {
			seam += Math.abs(L[y * w] - L[y * w + w - 1]);
			for (let x = 1; x < w; x++) inner += Math.abs(L[y * w + x] - L[y * w + x - 1]);
			n++;
		}
		return seam / n / Math.max(1e-4, inner / (n * Math.max(1, w - 1)));
	}
	for (let x = 0; x < w; x++) {
		seam += Math.abs(L[x] - L[(h - 1) * w + x]);
		for (let y = 1; y < h; y++) inner += Math.abs(L[y * w + x] - L[(y - 1) * w + x]);
		n++;
	}
	return seam / n / Math.max(1e-4, inner / (n * Math.max(1, h - 1)));
}

export function analyzeTarget(img: MatchImage, paletteSize = 5): Analysis {
	const { width: w, height: h, data: d } = img;
	const n = w * h;
	const L = new Float32Array(n);
	let sumL = 0;
	let sumL2 = 0;
	let sumC = 0;
	let glow = 0;
	for (let p = 0; p < n; p++) {
		const i = p * 4;
		const lab = linearToOklab([srgbToLinear1(d[i]), srgbToLinear1(d[i + 1]), srgbToLinear1(d[i + 2])]);
		L[p] = lab[0];
		sumL += lab[0];
		sumL2 += lab[0] * lab[0];
		const c = Math.hypot(lab[1], lab[2]);
		sumC += c;
		if (lab[0] > 0.75 && c > 0.08) glow++;
	}
	const meanL = sumL / n;
	const stdL = Math.sqrt(Math.max(0, sumL2 / n - meanL * meanL));
	let ex = 0;
	let ey = 0;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const p = y * w + x;
			if (x > 0) ex += Math.abs(L[p] - L[p - 1]);
			if (y > 0) ey += Math.abs(L[p] - L[p - w]);
		}
	ex /= Math.max(1, (w - 1) * h);
	ey /= Math.max(1, w * (h - 1));
	const rx = w > 2 ? seamRatio(L, w, h, 'x') : 9;
	const ry = h > 2 ? seamRatio(L, w, h, 'y') : 9;
	// Game textures nearly always tile; structure lines on the border inflate the seam difference, so only a
	// clearly broken seam counts as non-tiling.
	const tileX = rx < 3.5;
	const tileY = ry < 3.5;

	// Palette from a linear copy (extractPalette works in linear light).
	const lin = new Float32Array(n * 4);
	for (let i = 0; i < n * 4; i += 4) {
		lin[i] = srgbToLinear1(d[i]);
		lin[i + 1] = srgbToLinear1(d[i + 1]);
		lin[i + 2] = srgbToLinear1(d[i + 2]);
		lin[i + 3] = 1;
	}
	const palette = extractPalette({ width: w, height: h, data: lin }, paletteSize);
	// Weights: nearest palette entry per pixel (sRGB distance is fine for a weighting).
	const pal = palette.map((hex) => [
		parseInt(hex.slice(1, 3), 16) / 255,
		parseInt(hex.slice(3, 5), 16) / 255,
		parseInt(hex.slice(5, 7), 16) / 255
	]);
	const counts = new Array(palette.length).fill(0);
	for (let i = 0; i < n * 4; i += 4) {
		let best = 0;
		let bd = Infinity;
		for (let k = 0; k < pal.length; k++) {
			const dd = (d[i] - pal[k][0]) ** 2 + (d[i + 1] - pal[k][1]) ** 2 + (d[i + 2] - pal[k][2]) ** 2;
			if (dd < bd) {
				bd = dd;
				best = k;
			}
		}
		counts[best]++;
	}
	const weights = counts.map((c) => c / n);

	// Edge profiles: horizontal lines raise the row profile, vertical lines the column profile.
	const rowProfile = new Float64Array(h);
	const colProfile = new Float64Array(w);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const p = y * w + x;
			rowProfile[y] += Math.abs(L[p] - L[((y + h - 1) % h) * w + x]);
			colProfile[x] += Math.abs(L[p] - L[y * w + ((x + w - 1) % w)]);
		}
	const py = dominantPeriod(rowProfile);
	const px = dominantPeriod(colProfile);

	const hints: string[] = [];
	const g = glow / n;
	if (g > 0.03) hints.push('glow');
	if (stdL < 0.04) hints.push('flat');
	if (ex > ey * 1.6) hints.push('vertical-lines');
	if (ey > ex * 1.6) hints.push('horizontal-lines');
	if (h <= w / 4) hints.push('trim');
	if (sumC / n > 0.09) hints.push('saturated');

	return {
		width: w,
		height: h,
		tileable: tileX && tileY,
		tileX,
		tileY,
		palette,
		weights,
		meanL,
		stdL,
		chroma: sumC / n,
		edgeX: ex,
		edgeY: ey,
		glow: g,
		periodX: px.period,
		periodY: py.period,
		periodXStrength: px.strength,
		periodYStrength: py.strength,
		phaseX: px.phase,
		phaseY: py.phase,
		hints
	};
}
