import { describe, expect, it } from 'vitest';
import type { CpuTexture } from '../types';
import { fillet, pathData, polylineData } from './paths';

/** Float i of a data texture (floatTexture: one per texel, little-endian bits). */
const flt = (t: CpuTexture, i: number) => new DataView(t.data.buffer).getFloat32(i * 4, true);

const square = (lo: number, hi: number): [number, number][] => [
	[lo, lo],
	[hi, lo],
	[hi, hi],
	[lo, hi]
];

describe('paths', () => {
	it('rounds a corner within half of either edge', () => {
		expect(fillet([10, 0], [0, 0], [0, 10], 2)).toEqual(
			[2, 2, 2, 2].map((v, i) => (i === 0 ? v : expect.closeTo(v, 9)))
		);
		// A radius larger than the edges allow: t is half the shorter edge.
		expect(fillet([4, 0], [0, 0], [0, 10], 5)[0]).toBe(2);
		// Straight on, or no radius: sharp.
		expect(fillet([-1, 0], [0, 0], [1, 0], 2)[3]).toBe(0);
		expect(fillet([4, 0], [0, 0], [0, 4], 0)[3]).toBe(0);
	});

	it('rounds outer or inner corners by the fill rule (a nested square: a hole, or solid)', () => {
		const polys = [square(0, 30), square(10, 20)];
		// The rounds' radii of the outer square's first corner and the inner one's.
		const radii = (fill: string, at: string) => {
			const t = pathData(polys, fill, 2, at);
			return [flt(t, 3), flt(t, 4 * 4 + 3)];
		};
		expect(radii('evenodd', 'convex')).toEqual([2, 0]);
		expect(radii('evenodd', 'concave')).toEqual([0, 2]);
		expect(radii('union', 'convex')).toEqual([2, 2]);
		expect(radii('subtract', 'convex')).toEqual([2, 0]);
		expect(radii('evenodd', 'all')).toEqual([2, 2]);
		// A square inside the hole is solid again (inside two others).
		const t = pathData([...polys, square(14, 16)], 'evenodd', 0.5, 'convex');
		expect(flt(t, 8 * 4 + 3)).toBeGreaterThan(0);
		// The bounds: the last row.
		expect([0, 1, 2, 3].map((i) => flt(t, 12 * 4 + i))).toEqual([0, 0, 30, 30]);
	});

	it("stores each polyline segment's rounds and how far along its line it starts", () => {
		const t = polylineData(
			[
				[
					[0, 0],
					[10, 0],
					[10, 10]
				]
			],
			1,
			0.5
		);
		const row = (i: number) => Array.from({ length: 8 }, (_, k) => flt(t, i * 8 + k));
		// The bend at (10, 0): the centre line's radius is Corner radius + half the width.
		const [ta, ft, fx, fy, fr, span, s0, f0] = row(0);
		expect([ta, s0, f0]).toEqual([0, 0, 0]);
		expect([ft, fx, fy, fr, span].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([
			1.5,
			8.5,
			1.5,
			1.5,
			Math.round((Math.PI / 2) * 1e4) / 1e4
		]);
		const arc = 1.5 * (Math.PI / 2);
		const r1 = row(1);
		expect(r1[0]).toBeCloseTo(1.5, 5);
		expect(r1[6]).toBe(10);
		expect(r1[7]).toBeCloseTo(10 - 1.5 + arc, 5);
		// The line's length as drawn and along its round; the bounds.
		expect(flt(t, 64 * 8)).toBe(20);
		expect(flt(t, 64 * 8 + 1)).toBeCloseTo(20 - 3 + arc, 5);
		expect([0, 1, 2, 3].map((i) => flt(t, 96 * 8 + i))).toEqual([0, 0, 10, 10]);
	});
});
