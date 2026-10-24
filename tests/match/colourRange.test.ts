import { describe, expect, it } from 'vitest';
import { hexToRgb, linearToOklab, srgbToLinear1, type RGB } from '@/core/color';
import { normalizeProject } from '@/core/serialize';
import type { Gradient } from '@/core/params';
import { createImage, type MatchImage } from '@/match/image';
import { LIGHTNESS_WEIGHT, colourRange, constrainLab } from '@/match/colourRange';
import { Optimizer } from '@/match/optimizer';

const lab = (hex: string): RGB => linearToOklab(hexToRgb(hex).map(srgbToLinear1) as RGB);

/** Range distance between two OKLab colours (lightness weighted as in the range). */
const dist = (a: RGB, b: RGB) => Math.hypot(LIGHTNESS_WEIGHT * (a[0] - b[0]), a[1] - b[1], a[2] - b[2]);

/** A grassy reference: greens from dark to light, plus one stray magenta pixel (under the bin minimum). */
function greens(): MatchImage {
	const img = createImage(100, 100);
	for (let i = 0; i < 100 * 100; i++) {
		const t = (i % 100) / 99;
		const c = i === 0 ? hexToRgb('#ff00ff') : ([0.15 + 0.35 * t, 0.3 + 0.5 * t, 0.08 + 0.15 * t] as RGB);
		img.data.set([c[0], c[1], c[2], 1], i * 4);
	}
	return img;
}

describe('colour range', () => {
	const range = colourRange(greens(), 0.05);

	it('keeps colours the reference has, and greys', () => {
		for (const hex of ['#4d7a24', '#6aa034']) {
			const c = lab(hex);
			expect(dist(constrainLab(c, range), c), hex).toBeLessThan(1e-9);
		}
		// Greys pass whatever the reference: multiply / overlay ramps need them.
		for (const hex of ['#ffffff', '#808080', '#202020']) expect(constrainLab(lab(hex), range)).toEqual(lab(hex));
	});

	it('pulls a stray hue in to the edge of the range', () => {
		for (const hex of ['#3050d0', '#c03080', '#20c0c0']) {
			const c = lab(hex);
			const q = constrainLab(c, range);
			// Now exactly `radius` from the nearest allowed colour (a reference colour or the grey of its lightness).
			let nearest = Math.hypot(q[1], q[2]);
			for (let i = 0; i < range.points.length; i += 3)
				nearest = Math.min(nearest, dist(q, [range.points[i], range.points[i + 1], range.points[i + 2]]));
			expect(nearest, hex).toBeCloseTo(0.05, 6);
			expect(Math.hypot(q[1], q[2]), hex).toBeLessThan(Math.hypot(c[1], c[2]));
		}
	});

	it('ignores a handful of stray pixels in the reference', () => {
		const magenta = lab('#ff00ff');
		expect(dist(constrainLab(magenta, range), magenta)).toBeGreaterThan(0.1);
	});

	it('stops the optimiser buying loss with a hue the reference lacks', async () => {
		const project = normalizeProject({
			width: 32,
			height: 32,
			layers: [
				{
					id: 'n',
					type: 'noise',
					params: {
						dif_on: true,
						dif_grad: {
							stops: [
								{ pos: 0, color: '#3a5a20' },
								{ pos: 1, color: '#6a9a30' }
							]
						}
					}
				}
			]
		});
		// A loss that rewards blue in the ramp: what a lit render pushes the search towards.
		const blueness = (p: typeof project) => {
			const g = p.layers[0].params.dif_grad as Gradient;
			return g.stops.reduce((s, st) => s + lab(st.color)[2], 0);
		};
		const run = async (colourRange: number) => {
			const opt = new Optimizer(project, (p) => blueness(p), { target: greens(), colourRange, seed: 3, lambda: 4 });
			for (let i = 0; i < 60; i++) await opt.step();
			return (opt.best.project.layers[0].params.dif_grad as Gradient).stops.map((s) => lab(s.color));
		};
		const free = await run(0);
		const held = await run(0.05);
		// Unconstrained, a stop goes well off into blue; held, every stop stays within the range of the greens.
		expect(Math.min(...free.map((c) => c[2]))).toBeLessThan(-0.05);
		for (const c of held) expect(dist(constrainLab(c, range), c)).toBeLessThan(0.005);
	});
});
