import { describe, expect, it } from 'vitest';
import {
	Matcher,
	TERM_NAMES,
	absDiff,
	circularShift,
	createImage,
	fromLinear,
	fromRgba8,
	quantiles,
	resample,
	sortFloat32,
	argsortFloat32,
	toRgba8,
	type MatchImage,
	type MetricOptions,
	type TermName
} from '@/match/metrics';
import { dft } from '@/match/fft';
import { matchHistogram } from '@/match/vgg';
import { quantileOf, quantileOfSorted } from '@/match/quantiles';
import { addNoise, colourise, gaussBlur, rng, shiftColour, testPanel, testTexture } from './testUtils';

const tex = testTexture(64, 64, 1);

function score(a: MatchImage, b: MatchImage, opts: MetricOptions = {}) {
	return new Matcher(b, opts).score(a);
}

function expectIncreasing(values: number[], label: string) {
	for (let i = 1; i < values.length; i++) {
		expect(values[i], `${label}: ${values.map((v) => v.toFixed(4)).join(' → ')}`).toBeGreaterThan(values[i - 1]);
	}
}

describe('image helpers', () => {
	it('converts 8-bit and linear images to sRGB floats', () => {
		const img = fromRgba8([255, 128, 0, 255], 1, 1);
		expect(img.data[0]).toBe(1);
		expect(img.data[1]).toBeCloseTo(128 / 255);
		expect(Array.from(toRgba8(img))).toEqual([255, 128, 0, 255]);
		const lin = fromLinear({ width: 1, height: 1, data: new Float32Array([0.2140411, 1.5, -1, 0.5]) });
		expect(lin.data[0]).toBeCloseTo(0.5, 4); // linear 0.214 = sRGB 0.5
		expect(lin.data[1]).toBe(1); // HDR clamps
		expect(lin.data[2]).toBe(0);
		expect(lin.data[3]).toBe(0.5);
	});

	it('box-downsamples by area and keeps constants under bilinear upsampling', () => {
		const img = createImage(4, 2);
		// Left 2×2 block white, right block black.
		for (let y = 0; y < 2; y++)
			for (let x = 0; x < 2; x++) for (let c = 0; c < 3; c++) img.data[(y * 4 + x) * 4 + c] = 1;
		const small = resample(img, 2, 1);
		expect(small.data[0]).toBeCloseTo(1);
		expect(small.data[4]).toBeCloseTo(0);
		const half = resample(createImage(4, 4, [0.5, 0.5, 0.5, 1]), 2, 2);
		expect(half.data[0]).toBeCloseTo(0.5);
		const up = resample(createImage(3, 3, [0.3, 0.6, 0.9, 1]), 7, 5);
		expect(up.width).toBe(7);
		for (let i = 0; i < up.data.length; i += 4) {
			expect(up.data[i]).toBeCloseTo(0.3, 5);
			expect(up.data[i + 2]).toBeCloseTo(0.9, 5);
		}
		expect(resample(img, 4, 2)).toBe(img);
	});

	it('averages in linear light', () => {
		const img = createImage(2, 1);
		img.data.set([1, 1, 1, 1, 0, 0, 0, 1]);
		const avg = resample(img, 1, 1).data[0];
		expect(avg).toBeGreaterThan(0.7); // sRGB of linear 0.5 ≈ 0.735, not 0.5
		expect(avg).toBeLessThan(0.75);
	});

	it('computes quantiles and abs-diff images', () => {
		const q = quantiles([3, 1, 2, 4], 4);
		expect(Array.from(q)).toEqual([1, 2, 3, 4]);
		const d = absDiff(createImage(1, 1, [0.2, 0.5, 1, 1]), createImage(1, 1, [0.4, 0.5, 0, 1]));
		expect(d.data[0]).toBeCloseTo(0.2);
		expect(d.data[1]).toBeCloseTo(0);
		expect(d.data[2]).toBeCloseTo(1);
	});
});

describe('fft', () => {
	function naive(re: number[], im: number[]) {
		const n = re.length;
		const or: number[] = [];
		const oi: number[] = [];
		for (let k = 0; k < n; k++) {
			let sr = 0;
			let si = 0;
			for (let t = 0; t < n; t++) {
				const a = (-2 * Math.PI * k * t) / n;
				sr += re[t] * Math.cos(a) - im[t] * Math.sin(a);
				si += re[t] * Math.sin(a) + im[t] * Math.cos(a);
			}
			or.push(sr);
			oi.push(si);
		}
		return [or, oi];
	}
	for (const n of [1, 2, 8, 16, 7, 12, 45]) {
		it(`matches a naive DFT for n=${n}`, () => {
			const re = Array.from({ length: n }, (_, i) => Math.sin(i * 1.3) + (i % 3));
			const im = Array.from({ length: n }, (_, i) => Math.cos(i * 0.7) * 0.5);
			const [er, ei] = naive(re, im);
			const r = Float64Array.from(re);
			const m = Float64Array.from(im);
			dft(r, m);
			for (let k = 0; k < n; k++) {
				expect(r[k]).toBeCloseTo(er[k], 8);
				expect(m[k]).toBeCloseTo(ei[k], 8);
			}
		});
	}
});

describe('sortFloat32', () => {
	it('orders exactly as Float32Array#sort', () => {
		const r = rng(7);
		for (const n of [0, 5, 600, 5000, 20000]) {
			const v = Float32Array.from({ length: n }, (_, i) =>
				i % 97 === 0 ? 0 : i % 89 === 0 ? -0 : (r() - 0.4) * 10 ** Math.floor(r() * 8 - 4)
			);
			const expected = Float32Array.from(v).sort();
			const got = sortFloat32(v);
			expect(Array.from(got).map((x) => (Object.is(x, -0) ? '-0' : x))).toEqual(
				Array.from(expected).map((x) => (Object.is(x, -0) ? '-0' : x))
			);
		}
	});
});

describe('quantileOf', () => {
	it('selects the value a sort would put at ⌊n·q⌋, duplicates and all', () => {
		const r = rng(11);
		for (const n of [1, 2, 9, 1000, 20001])
			for (const levels of [0, 3]) {
				// levels 3: a few distinct values, many equal (flat images); 0: continuous.
				const v = Float32Array.from({ length: n }, () => (levels ? Math.floor(r() * levels) : r() - 0.5));
				const sorted = Float32Array.from(v).sort();
				for (const q of [0, 0.002, 0.5, 0.9, 0.99, 1]) expect(quantileOf(v, q)).toBe(quantileOfSorted(sorted, q));
			}
		expect(quantileOf(new Float32Array(0), 0.5)).toBe(0);
	});
});

describe('argsortFloat32', () => {
	it('orders as a stable comparison sort by a − b', () => {
		const r = rng(5);
		for (const n of [0, 7, 3000]) {
			const v = Float32Array.from({ length: n }, (_, i) =>
				i % 13 === 0 ? 0 : i % 11 === 0 ? -0 : Math.round((r() - 0.5) * 40) / 8
			);
			const expected = Array.from(v.keys()).sort((i, j) => v[i] - v[j] || i - j);
			expect(Array.from(argsortFloat32(v))).toEqual(expected);
		}
	});
});

describe('matchHistogram', () => {
	it('gives every pixel the reference value of its rank, ties in pixel order', () => {
		const src = testTexture(40, 30, 2);
		const ref = testTexture(40, 30, 3);
		// Repeated values and both zeros, so the tie order counts.
		for (let i = 0; i < src.data.length; i += 7) src.data[i] = i % 3 ? 0.25 : -0;
		const n = src.width * src.height;
		const expected = new Float32Array(src.data);
		for (let c = 0; c < 3; c++) {
			const sorted = Float32Array.from({ length: n }, (_, i) => ref.data[i * 4 + c]).sort();
			const order = Array.from({ length: n }, (_, i) => i).sort(
				(i, j) => src.data[i * 4 + c] - src.data[j * 4 + c] || i - j
			);
			order.forEach((p, r) => (expected[p * 4 + c] = sorted[r]));
		}
		for (let k = 0; k < 2; k++) expect(Array.from(matchHistogram(src, ref).data)).toEqual(Array.from(expected));
	});
});

describe('metrics', () => {
	it('frees its texture scorer on dispose', () => {
		const m = new Matcher(testTexture(16, 16, 1), { preset: 'tile' });
		let disposed = 0;
		m.texture = { submit: () => () => 0.1, dispose: () => disposed++ };
		m.dispose();
		m.dispose();
		expect(disposed).toBe(1);
		expect(m.texture).toBe(null);
	});

	it('scores identical images ~0 for every term and preset', () => {
		for (const preset of ['texture', 'layout'] as const) {
			const r = score(tex, tex, { preset });
			expect(r.total).toBeLessThan(1e-9);
			for (const t of TERM_NAMES) expect(r.terms[t]).toBeLessThan(1e-9);
		}
		const p = testPanel();
		expect(score(p, p, { preset: 'layout' }).total).toBeLessThan(1e-9);
	});

	it('keeps every term in 0..1', () => {
		const r = score(tex, testPanel(), { preset: 'layout' });
		for (const t of TERM_NAMES) {
			expect(r.terms[t]).toBeGreaterThanOrEqual(0);
			expect(r.terms[t]).toBeLessThan(1);
		}
		expect(r.total).toBeGreaterThan(0.4);
	});

	it('increases monotonically under blur', () => {
		const sigmas = [0, 0.5, 1, 1.5, 2];
		const rs = sigmas.map((s) => score(gaussBlur(tex, s), tex));
		expectIncreasing(
			rs.map((r) => r.total),
			'total'
		);
		for (const t of ['spectrum', 'gradients', 'contrast', 'aligned'] as TermName[]) {
			expectIncreasing(
				rs.map((r) => r.raw[t]),
				t
			);
		}
		// The total keeps rising beyond where the spectrum saturates.
		expect(score(gaussBlur(tex, 3), tex).total).toBeGreaterThan(rs[rs.length - 1].total);
	});

	it('increases monotonically under noise', () => {
		const amps = [0, 0.02, 0.05, 0.1, 0.2];
		const rs = amps.map((a) => score(addNoise(tex, a), tex, { preset: 'layout' }));
		expectIncreasing(
			rs.map((r) => r.total),
			'total (layout)'
		);
		for (const t of ['colour', 'spectrum', 'gradients', 'contrast', 'aligned'] as TermName[]) {
			expectIncreasing(
				rs.map((r) => r.raw[t]),
				t
			);
		}
		expectIncreasing(
			amps.map((a) => score(addNoise(tex, a), tex).total),
			'total (texture)'
		);
	});

	it('increases monotonically under colour shifts and reads ≈ ΔE', () => {
		const shifts = [0, 0.02, 0.05, 0.1, 0.15];
		const rs = shifts.map((d) => score(shiftColour(tex, d, d * 0.3, -d * 0.2), tex));
		expectIncreasing(
			rs.map((r) => r.total),
			'total'
		);
		expectIncreasing(
			rs.map((r) => r.raw.colour),
			'colour'
		);
		const d = 0.05;
		const r = score(shiftColour(tex, d), tex);
		expect(r.raw.colour).toBeGreaterThan(d * 0.8);
		expect(r.raw.colour).toBeLessThan(d * 1.2);
		// Pure lightness shifts leave the structural terms alone.
		expect(r.terms.spectrum).toBeLessThan(0.02);
	});

	it('is translation invariant except for the aligned term', () => {
		const shifted = circularShift(tex, 17, 9);
		const r = score(shifted, tex);
		expect(r.terms.colour).toBeLessThan(1e-6);
		expect(r.terms.spectrum).toBeLessThan(1e-6);
		expect(r.terms.gradients).toBeLessThan(0.06); // clamped edges differ slightly
		expect(r.terms.contrast).toBeLessThan(0.06);
		expect(r.terms.aligned).toBeGreaterThan(0.3);
		expect(r.total).toBeLessThan(0.03);
		const wrapped = score(shifted, tex, { wrap: true });
		for (const t of ['colour', 'spectrum', 'gradients'] as TermName[]) expect(wrapped.terms[t]).toBeLessThan(1e-6);
		expect(wrapped.terms.contrast).toBeLessThan(0.05); // ½ and ¼ scales sample a different phase
		// The layout preset does care.
		expect(score(shifted, tex, { preset: 'layout' }).total).toBeGreaterThan(0.2);
	});

	it('finds the structure at any wrap-around shift, odd ones included', () => {
		// Coarse levels used to shift by round(d / 2^l): a 1 px move compared box averages of different pixels.
		for (const [dx, dy] of [
			[1, 0],
			[0, 1],
			[1, 1],
			[17, 9]
		]) {
			const r = score(circularShift(tex, dx, dy), tex, { preset: 'tile', wrap: true });
			expect(r.raw.structure, `${dx},${dy}`).toBeLessThan(1e-5);
		}
	});

	it('ranks a different realisation of the same texture closer than a different texture', () => {
		const same = score(testTexture(64, 64, 2), tex).total;
		const other = score(testPanel(), tex).total;
		const blurred = score(gaussBlur(testTexture(64, 64, 2), 2), tex).total;
		expect(same).toBeLessThan(blurred);
		expect(blurred).toBeLessThan(other);
	});

	it('sees orientation: streaks vs the same streaks rotated 90°', () => {
		const streaks = (seed: number) => {
			const r = rng(seed);
			const f = new Float32Array(64 * 64);
			for (let i = 0; i < f.length; i++) f[i] = r();
			const g = new Float32Array(64 * 64); // horizontal circular box blur, radius 6
			for (let y = 0; y < 64; y++)
				for (let x = 0; x < 64; x++) {
					let acc = 0;
					for (let d = -6; d <= 6; d++) acc += f[y * 64 + ((x + d + 64) % 64)];
					g[y * 64 + x] = (acc / 13 - 0.5) * 3 + 0.5;
				}
			return colourise(g, 64, 64, [0.2, 0.18, 0.15], [0.7, 0.65, 0.55]);
		};
		const a = streaks(1);
		const rotated = circularShift(a, 0, 0);
		for (let y = 0; y < 64; y++)
			for (let x = 0; x < 64; x++)
				rotated.data.set(a.data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4), (x * 64 + y) * 4);
		const same = score(streaks(2), a);
		const rot = score(rotated, a);
		expect(rot.terms.colour).toBeLessThan(1e-6); // same pixels
		expect(rot.raw.spectrum).toBeGreaterThan(same.raw.spectrum * 3);
		expect(rot.terms.gradients).toBeGreaterThan(same.terms.gradients);
		expect(rot.total).toBeGreaterThan(same.total);
	});

	it('layout preset tracks panel geometry', () => {
		const target = testPanel(64, 64, 10);
		const rs = [10, 11, 13, 16, 20].map((inset) => score(testPanel(64, 64, inset), target, { preset: 'layout' }).total);
		expectIncreasing(rs, 'inset');
	});

	it('resamples to the comparison size and caches the target', () => {
		const big = createImage(128, 128); // nearest 2× upsample
		for (let y = 0; y < 128; y++)
			for (let x = 0; x < 128; x++)
				big.data.set(
					tex.data.subarray(((y >> 1) * 64 + (x >> 1)) * 4, ((y >> 1) * 64 + (x >> 1)) * 4 + 4),
					(y * 128 + x) * 4
				);
		const m = new Matcher(big, { size: [64, 64] });
		expect([m.width, m.height]).toEqual([64, 64]);
		const r = m.score(tex);
		expect(r.width).toBe(64);
		expect(r.total).toBeLessThan(1e-3);
		expect(m.score(tex).total).toBe(r.total);
		// maxSize caps the comparison size.
		expect(new Matcher(big, { maxSize: 32 }).width).toBe(32);
	});

	it('weights override presets and alpha only counts with transparency', () => {
		const r = score(shiftColour(tex, 0.05), tex, { weights: { spectrum: 0, gradients: 0, contrast: 0 } });
		expect(r.total).toBeCloseTo(r.terms.colour, 6);
		expect(r.weights.alpha).toBe(0);
		const holes = new Float32Array(tex.data);
		for (let i = 3; i < holes.length; i += 16) holes[i] = 0;
		const ra = score({ width: 64, height: 64, data: holes }, tex);
		expect(ra.weights.alpha).toBeGreaterThan(0);
		expect(ra.terms.alpha).toBeGreaterThan(0.3);
	});

	it('is fast enough for an optimiser loop', () => {
		const m = new Matcher(tex);
		const t0 = performance.now();
		for (let i = 0; i < 10; i++) m.score(testTexture(64, 64, 10 + i));
		expect((performance.now() - t0) / 10).toBeLessThan(100);
	});
});
