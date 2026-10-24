import { describe, expect, it } from 'vitest';
import type { MatchImage } from '@/match/image';
import { rng } from '../match/testUtils';
import { analyzeTiling, lowBand } from '@/tiling/analyze';

const S = 128;

/** Grey image from a value field (sRGB 0..1). */
function grey(v: (x: number, y: number) => number, w = S, h = S): MatchImage {
	const data = new Float32Array(w * h * 4);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const g = Math.max(0, Math.min(1, v(x, y)));
			data.set([g, g, g, 1], (y * w + x) * 4);
		}
	return { width: w, height: h, data };
}

/** Wrapped distance. */
const wd = (a: number, b: number, n: number) => Math.min(Math.abs(a - b), n - Math.abs(a - b));

/** Jittered dark dots on a light ground (+ fine noise), optionally only where `keep` says, plus extra blobs. */
function dots(
	seed: number,
	opts: { keep?: (x: number, y: number) => boolean; blobs?: [number, number, number][] } = {}
) {
	const r = rng(seed);
	const pts: [number, number, number][] = [];
	const step = 16;
	for (let gy = 0; gy < S / step; gy++)
		for (let gx = 0; gx < S / step; gx++) {
			const x = gx * step + 4 + r() * 8;
			const y = gy * step + 4 + r() * 8;
			if (!opts.keep || opts.keep(x, y)) pts.push([x, y, 2.5 + r()]);
		}
	pts.push(...(opts.blobs ?? []));
	const n = rng(seed + 99);
	const noise = Float32Array.from({ length: S * S }, () => n() * 0.04);
	return grey((x, y) => {
		let v = 0.7 + noise[y * S + x];
		for (const [px, py, pr] of pts) if (Math.hypot(wd(x, px, S), wd(y, py, S)) < pr) v = 0.2;
		return v;
	});
}

describe('lowBand', () => {
	it('keeps a low frequency and drops a high one, at any size', () => {
		for (const [w, h] of [
			[64, 64],
			[96, 80]
		]) {
			const v = Float32Array.from({ length: w * h }, (_, i) => {
				const x = i % w;
				const y = Math.floor(i / w);
				return 0.5 + 0.2 * Math.cos((2 * Math.PI * 2 * x) / w + 1) + 0.1 * Math.sin((2 * Math.PI * 9 * y) / h);
			});
			const lp = lowBand(w, h, 3).lowpass(v);
			for (let i = 0; i < w * h; i += 37) {
				const x = i % w;
				expect(lp[i]).toBeCloseTo(0.5 + 0.2 * Math.cos((2 * Math.PI * 2 * x) / w + 1), 4);
			}
		}
	});

	it("gives the band's sum of squares from its coefficients", () => {
		const r = rng(2);
		for (const [w, h] of [
			[64, 64],
			[48, 30]
		]) {
			const band = lowBand(w, h, 3);
			const v = Float32Array.from({ length: w * h }, () => r());
			const [coef] = band.coefficients([v]);
			const s = band.synth(coef);
			expect(band.energy(coef)).toBeCloseTo(
				s.reduce((a, x) => a + x * x, 0),
				4
			);
		}
	});
});

describe('analyzeTiling', () => {
	it('finds a patch of a colour found nowhere else, and puts the hotspot on it', () => {
		const even = analyzeTiling(dots(1));
		const odd = analyzeTiling(dots(1, { blobs: [[40, 88, 11]] }));
		expect(odd.raw.patches).toBeGreaterThan(even.raw.patches * 2);
		expect(odd.score).toBeGreaterThan(even.score);
		const h = odd.maps.patches;
		let at = 0;
		for (let i = 1; i < h.length; i++) if (h[i] > h[at]) at = i;
		expect(Math.hypot(wd(at % S, 40, S), wd(Math.floor(at / S), 88, S))).toBeLessThan(12);
	});

	it('finds one long line, not lines that recur all over the tile', () => {
		const n = rng(4);
		const noise = Float32Array.from({ length: S * S }, () => n() * 0.25);
		// Courses every 16 px (as bricks), and the same ground with a single diagonal crease instead.
		const courses = analyzeTiling(grey((x, y) => (y % 16 < 2 ? 0.2 : 0.5 + noise[y * S + x])));
		const crease = analyzeTiling(
			grey((x, y) => (Math.abs(((x - y + S) % S) - 40) < 1.5 && y > 20 && y < 100 ? 0.2 : 0.5 + noise[y * S + x]))
		);
		expect(crease.raw.lines).toBeGreaterThan(courses.raw.lines * 2);
	});

	it('finds clumping: features in half the tile only', () => {
		const even = analyzeTiling(dots(2));
		const half = analyzeTiling(dots(2, { keep: (x) => x < S / 2 }));
		expect(half.raw.clumping).toBeGreaterThan(even.raw.clumping * 3);
		expect(half.score).toBeGreaterThan(even.score);
	});

	it('finds broad tone but not fine texture', () => {
		const n = rng(5);
		const noise = Float32Array.from({ length: S * S }, () => n() * 0.2);
		const flat = analyzeTiling(grey((x, y) => 0.4 + noise[y * S + x]));
		const blotch = analyzeTiling(
			grey((x, y) => 0.4 + noise[y * S + x] + 0.08 * Math.cos((2 * Math.PI * x) / S) * Math.cos((2 * Math.PI * y) / S))
		);
		expect(flat.raw.tone).toBeLessThan(0.01);
		expect(blotch.raw.tone).toBeGreaterThan(0.02);
		expect(blotch.terms.tone).toBeGreaterThan(flat.terms.tone * 3);
	});

	it('handles small and non-square tiles', () => {
		const a = analyzeTiling(grey((x, y) => 0.5 + 0.1 * Math.sin(x) * Math.cos(y * 0.7), 48, 32));
		expect(Number.isFinite(a.score)).toBe(true);
		expect(a.maps.hotspot.length).toBe(48 * 32);
	});
});
