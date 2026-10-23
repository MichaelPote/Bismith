// Synthetic images for the match unit tests (deterministic, tileable).

import { oklabToSrgb, srgbToOklab, type RGB } from '../core/color';
import { mulberry32 as rng } from '../core/hash';
import type { MatchImage } from './image';

export { rng };

/** Circular separable box blur of a scalar field (radius r, repeated `passes` times ≈ Gaussian). */
export function blurField(f: Float32Array, w: number, h: number, r: number, passes = 2): Float32Array {
	let src = f;
	for (let p = 0; p < passes; p++) {
		const tmp = new Float32Array(w * h);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				let s = 0;
				for (let d = -r; d <= r; d++) s += src[y * w + ((((x + d) % w) + w) % w)];
				tmp[y * w + x] = s / (2 * r + 1);
			}
		const out = new Float32Array(w * h);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				let s = 0;
				for (let d = -r; d <= r; d++) s += tmp[((((y + d) % h) + h) % h) * w + x];
				out[y * w + x] = s / (2 * r + 1);
			}
		src = out;
	}
	return src;
}

/** Tileable fractal-ish noise field in 0..1. */
export function noiseField(w: number, h: number, seed: number): Float32Array {
	const r = rng(seed);
	const out = new Float32Array(w * h);
	let amp = 1;
	let total = 0;
	for (const rad of [6, 3, 1, 0]) {
		const white = new Float32Array(w * h);
		for (let i = 0; i < white.length; i++) white[i] = r();
		const f = rad > 0 ? blurField(white, w, h, rad) : white;
		let lo = Infinity;
		let hi = -Infinity;
		for (const v of f) {
			lo = Math.min(lo, v);
			hi = Math.max(hi, v);
		}
		for (let i = 0; i < out.length; i++) out[i] += ((f[i] - lo) / Math.max(1e-9, hi - lo)) * amp;
		total += amp;
		amp *= 0.5;
	}
	for (let i = 0; i < out.length; i++) out[i] /= total;
	return out;
}

/** Map a 0..1 field through a two-colour ramp (sRGB 0..1). */
export function colourise(f: Float32Array, w: number, h: number, c0: RGB, c1: RGB): MatchImage {
	const data = new Float32Array(w * h * 4);
	for (let i = 0; i < w * h; i++) {
		const t = Math.min(1, Math.max(0, f[i]));
		data[i * 4] = c0[0] + (c1[0] - c0[0]) * t;
		data[i * 4 + 1] = c0[1] + (c1[1] - c0[1]) * t;
		data[i * 4 + 2] = c0[2] + (c1[2] - c0[2]) * t;
		data[i * 4 + 3] = 1;
	}
	return { width: w, height: h, data };
}

/** A stone-like test texture. */
export function testTexture(w = 64, h = 64, seed = 1): MatchImage {
	return colourise(noiseField(w, h, seed), w, h, [0.23, 0.2, 0.18], [0.65, 0.58, 0.5]);
}

/** A UI-ish panel: bevelled light rectangle on a dark ground. */
export function testPanel(w = 64, h = 64, inset = 10): MatchImage {
	const data = new Float32Array(w * h * 4);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const inside = x >= inset && x < w - inset && y >= inset && y < h - inset;
			const edgeTop = inside && (y < inset + 2 || x < inset + 2);
			const edgeBot = inside && (y >= h - inset - 2 || x >= w - inset - 2);
			const v = !inside ? 0.15 : edgeTop ? 0.75 : edgeBot ? 0.3 : 0.5;
			const i = (y * w + x) * 4;
			data[i] = v;
			data[i + 1] = v * 1.05;
			data[i + 2] = v * 1.15;
			data[i + 3] = 1;
		}
	return { width: w, height: h, data };
}

/** Circular blur of each channel. */
export function blurImage(img: MatchImage, r: number): MatchImage {
	if (r <= 0) return img;
	const { width: w, height: h } = img;
	const out = new Float32Array(img.data.length);
	for (let c = 0; c < 4; c++) {
		const f = new Float32Array(w * h);
		for (let i = 0; i < w * h; i++) f[i] = img.data[i * 4 + c];
		const b = blurField(f, w, h, r);
		for (let i = 0; i < w * h; i++) out[i * 4 + c] = b[i];
	}
	return { width: w, height: h, data: out };
}

/** Add uniform per-channel noise of amplitude ±amp. */
export function addNoise(img: MatchImage, amp: number, seed = 7): MatchImage {
	const r = rng(seed);
	const out = new Float32Array(img.data);
	for (let i = 0; i < out.length; i += 4) {
		const g = (r() - 0.5) * 2 * amp;
		for (let c = 0; c < 3; c++) out[i + c] = Math.min(1, Math.max(0, out[i + c] + g + (r() - 0.5) * amp * 0.5));
	}
	return { width: img.width, height: img.height, data: out };
}

/** Shift every pixel in OKLab by (dL, da, db). */
export function shiftColour(img: MatchImage, dL: number, da = 0, db = 0): MatchImage {
	const out = new Float32Array(img.data);
	for (let i = 0; i < out.length; i += 4) {
		const lab = srgbToOklab([out[i], out[i + 1], out[i + 2]]);
		const s = oklabToSrgb([lab[0] + dL, lab[1] + da, lab[2] + db]);
		out[i] = s[0];
		out[i + 1] = s[1];
		out[i + 2] = s[2];
	}
	return { width: img.width, height: img.height, data: out };
}

/** Circular Gaussian blur of every channel (sigma in px). */
export function gaussBlur(img: MatchImage, sigma: number): MatchImage {
	if (sigma <= 0) return img;
	const { width: w, height: h } = img;
	const r = Math.ceil(sigma * 3);
	const k: number[] = [];
	let ks = 0;
	for (let d = -r; d <= r; d++) {
		const v = Math.exp((-d * d) / (2 * sigma * sigma));
		k.push(v);
		ks += v;
	}
	const kn = k.map((v) => v / ks);
	const tmp = new Float32Array(img.data.length);
	const out = new Float32Array(img.data.length);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++)
			for (let c = 0; c < 4; c++) {
				let s = 0;
				for (let d = -r; d <= r; d++) s += img.data[(y * w + ((((x + d) % w) + w) % w)) * 4 + c] * kn[d + r];
				tmp[(y * w + x) * 4 + c] = s;
			}
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++)
			for (let c = 0; c < 4; c++) {
				let s = 0;
				for (let d = -r; d <= r; d++) s += tmp[(((((y + d) % h) + h) % h) * w + x) * 4 + c] * kn[d + r];
				out[(y * w + x) * 4 + c] = s;
			}
	return { width: w, height: h, data: out };
}
