// Colour range (Match): keeps the colours the optimiser writes near the reference's own colours. Without it the search
// buys a few pixels with hues the reference never shows (a teal blade, a purple base under everything) and, once a
// light shades the surface, saturates the ramps further and further to cancel the shading.
//
// The reference's colours are its pixels in OKLab, binned (bins holding only a handful of pixels dropped, so stray
// specks don't count). A colour further than `radius` from all of them is pulled straight towards the nearest one
// until it is `radius` away. Lightness counts half — light and shade legitimately move it — so the range mostly holds
// hue and chroma. Greys are always in range: multiply / overlay ramps need their white-to-grey stops, and a grey
// can't push the hue anywhere.

import type { RGB } from '@/core/color';
import { toOklab, type MatchImage } from './image';

export interface ColourRange {
	/** The reference's colours, OKLab triples. */
	points: Float32Array;
	/** Allowed distance (OKLab, lightness weighted by LIGHTNESS_WEIGHT). */
	radius: number;
}

/** How much a lightness difference counts against the range, relative to hue and chroma. */
const LIGHTNESS_WEIGHT = 0.5;
const BIN = 0.02;

/** The reference's colours for a range of `radius` (OKLab). */
export function colourRange(img: MatchImage, radius: number): ColourRange {
	const bins = new Map<string, { n: number; l: number; a: number; b: number }>();
	let total = 0;
	const { L, A, B } = toOklab(img, null);
	const d = img.data;
	for (let i = 0; i < img.width * img.height; i++) {
		if (d[i * 4 + 3] < 0.5) continue;
		const [l, a, b] = [L[i], A[i], B[i]];
		const key = `${Math.round(l / BIN)},${Math.round(a / BIN)},${Math.round(b / BIN)}`;
		const s = bins.get(key);
		if (s) {
			s.n++;
			s.l += l;
			s.a += a;
			s.b += b;
		} else bins.set(key, { n: 1, l, a, b });
		total++;
	}
	// A bin needs 1 in 10 000 of the pixels (at least 2) to count.
	const min = Math.max(2, total * 1e-4);
	const kept = [...bins.values()].filter((s) => s.n >= min);
	const points = new Float32Array(kept.length * 3);
	kept.forEach((s, i) => points.set([s.l / s.n, s.a / s.n, s.b / s.n], i * 3));
	return { points, radius };
}

/** `lab` pulled into the range (unchanged when it is already in it). */
export function constrainLab(lab: RGB, range: ColourRange): RGB {
	const w = LIGHTNESS_WEIGHT;
	// The grey of the same lightness is always allowed: its distance is the chroma.
	let best = Math.hypot(lab[1], lab[2]);
	let q: RGB = [lab[0], 0, 0];
	const p = range.points;
	for (let i = 0; i < p.length; i += 3) {
		const dl = w * (lab[0] - p[i]);
		const da = lab[1] - p[i + 1];
		const db = lab[2] - p[i + 2];
		const dist = Math.sqrt(dl * dl + da * da + db * db);
		if (dist < best) {
			best = dist;
			q = [p[i], p[i + 1], p[i + 2]];
		}
	}
	if (best <= range.radius) return lab;
	const t = range.radius / best;
	return [q[0] + (lab[0] - q[0]) * t, q[1] + (lab[1] - q[1]) * t, q[2] + (lab[2] - q[2]) * t];
}
