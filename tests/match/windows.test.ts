import { describe, expect, it } from 'vitest';
import {
	Matcher,
	circularShift,
	compareImages,
	resample,
	resampleLinear,
	resampleLinearToOklab,
	toLinearPremul,
	toOklab,
	type MatchImage
} from '@/match/metrics';
import { compareWindows, windowBank, windowMismatch, windowSide } from '@/match/windows';
import { addNoise, gaussBlur, rng } from './testUtils';

/**
 * Vertical planks with dark gaps and end joints, over vertical grain (noise smeared along the plank). `layout` seeds
 * the plank widths and joints, `grain` the fine streaks (0 = smooth planks).
 */
function planks(size: number, layout: number, grain: number, grainPx = 1): MatchImage {
	const r = rng(layout);
	const g = rng(grain || 1);
	const edges = [0];
	while (edges[edges.length - 1] < size)
		edges.push(edges[edges.length - 1] + Math.round(size / 5 + (r() - 0.5) * (size / 8)));
	edges[edges.length - 1] = size;
	const joints = edges.map(() => Math.floor(r() * size));
	const tone = edges.map(() => 0.42 + r() * 0.1);
	// Streak value per column (constant along y, slowly drifting) — the grain.
	const cols = new Float32Array(size);
	for (let x = 0; x < size; x++) cols[x] = g() - 0.5;
	const data = new Float32Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			let p = 0;
			while (edges[p + 1] <= x) p++;
			const gap = x - edges[p] < 2 || Math.abs(((y - joints[p] + size) % size) - 0) < 2;
			const streak = grain ? cols[Math.floor(x / grainPx) * grainPx] * 0.12 * (0.7 + 0.3 * Math.sin(y * 0.05 + x)) : 0;
			const v = gap ? 0.08 : tone[p] + streak;
			const i = (y * size + x) * 4;
			data[i] = v * 1.15;
			data[i + 1] = v * 0.85;
			data[i + 2] = v * 0.6;
			data[i + 3] = 1;
		}
	return { width: size, height: size, data };
}

const win = (a: MatchImage, b: MatchImage, wrap = true) => {
	const t = windowBank(b, { wrap });
	return compareWindows(windowBank(a, { wrap, like: t }), t);
};

describe('windows term', () => {
	const ref = planks(256, 1, 11);

	it('is zero for the same image and for shifts by whole window steps', () => {
		expect(win(ref, ref).raw).toBeLessThan(1e-9);
		const step = windowSide(256, 256) / 2;
		expect(win(circularShift(ref, step * 3, step), ref).raw).toBeLessThan(1e-9);
	});

	it('prices a different layout of the same planks below a change of their grain', () => {
		const layout = win(planks(256, 2, 12), ref).raw;
		const smooth = win(planks(256, 1, 0), ref).raw;
		const coarse = win(planks(256, 1, 11, 4), ref).raw;
		expect(layout).toBeLessThan(smooth);
		expect(layout).toBeLessThan(coarse);
		// Same for the preset: the layout is free, the grain isn't.
		const m = new Matcher(ref, { preset: 'windows', wrap: true });
		expect(m.score(planks(256, 2, 12)).total).toBeLessThan(m.score(planks(256, 1, 0)).total);
	});

	it('rises with noise and blur', () => {
		const noise = [0.01, 0.03, 0.08].map((a) => win(addNoise(ref, a), ref).raw);
		const blur = [0.5, 1, 2].map((s) => win(gaussBlur(ref, s), ref).raw);
		for (const xs of [noise, blur]) for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
	});

	it('handles non-tileable, non-square images', () => {
		const img = planks(256, 3, 5);
		const crop: MatchImage = { width: 200, height: 120, data: new Float32Array(200 * 120 * 4) };
		for (let y = 0; y < 120; y++) crop.data.set(img.data.subarray(y * 256 * 4, (y * 256 + 200) * 4), y * 200 * 4);
		const r = win(crop, crop, false);
		expect(r.raw).toBeLessThan(1e-9);
		const t = windowBank(crop, { wrap: false });
		// Every pixel is covered by some window.
		const map = windowMismatch(t, new Float32Array(t.count).fill(1));
		expect(Math.min(...map.values)).toBe(1);
	});

	it('counts in the windows presets only, at up to 512 px', () => {
		const big = planks(640, 4, 9);
		const m = new Matcher(big, { preset: 'windows', wrap: true });
		expect(m.windowTarget?.width).toBe(512);
		const r = m.score(planks(640, 5, 10));
		expect(r.weights.windows).toBeGreaterThan(0);
		expect(r.terms.windows).toBeGreaterThan(0);
		expect(r.weights.structure).toBe(0);
		const map = m.windowMap(big)!;
		expect([map.width, map.height]).toEqual([512, 512]);
		// Other presets leave it out (and don't pay for it).
		const t = compareImages(big, big, { preset: 'tile', wrap: true });
		expect(t.weights.windows).toBe(0);
		// Tile + windows keeps Tile's structure term and adds the windows.
		const tw = new Matcher(big, { preset: 'tilewin', wrap: true }).score(planks(640, 5, 10));
		expect(tw.weights.structure).toBeGreaterThan(0);
		expect(tw.weights.windows).toBeGreaterThan(0);
		expect(new Matcher(big, { preset: 'tile' }).windowTarget).toBeNull();
	});
});

describe('one linear conversion for two sizes', () => {
	const img = planks(200, 6, 3);
	img.data[3] = 0.4; // some transparency

	it('resamples bit for bit like resample()', () => {
		const lin = toLinearPremul(img);
		for (const [w, h] of [
			[64, 64],
			[128, 80],
			[300, 300]
		])
			expect(resampleLinear(lin, w, h).data).toEqual(resample(img, w, h).data);
	});

	it('goes straight to OKLab like toOklab(resample(…))', () => {
		const a = resampleLinearToOklab(toLinearPremul(img), 128, 96);
		const b = toOklab(resample(img, 128, 96));
		for (const k of ['L', 'A', 'B', 'alpha'] as const)
			for (let i = 0; i < a[k].length; i += 37) expect(a[k][i]).toBeCloseTo(b[k][i], 5);
		const same = resampleLinearToOklab(toLinearPremul(img), 200, 200);
		expect(same.L[1234]).toBeCloseTo(toOklab(img).L[1234], 5);
	});
});
