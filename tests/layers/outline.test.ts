// The shared Repeat's outlines (FR8.33, src/layers/outline.ts): tracing a mask's zero crossing, its corners, the
// instances placed along it and their buckets.

import { describe, expect, it } from 'vitest';
import {
	bucketInstances,
	canvasOutline,
	findCorners,
	Path,
	placeInstances,
	traceOutlines,
	type Field,
	type Instance,
	type PlaceOptions
} from '@/layers/outline';

/** A field from a distance function of GL px (texel centres at .5), less an offset. */
function field(W: number, H: number, sdf: (x: number, y: number) => number, tile = false, offset = 0): Field {
	const v = new Float32Array(W * H);
	for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) v[j * W + i] = sdf(i + 0.5, j + 0.5) - offset;
	return { width: W, height: H, tile, v };
}
const circle = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) - r;
const box =
	(cx: number, cy: number, hx: number, hy: number, r = 0) =>
	(x: number, y: number) => {
		const qx = Math.abs(x - cx) - hx + r;
		const qy = Math.abs(y - cy) - hy + r;
		return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
	};
const opts = (o: Partial<PlaceOptions> = {}): PlaceOptions => ({
	along: 'outline',
	countBy: 'repeats',
	n: 8,
	spacing: 16,
	corners: 'on',
	clear: 0,
	angle: 30,
	round: 16,
	offset: 0,
	shift: 0,
	faces: 0,
	max: 4096,
	...o
});
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
/** Angle difference in degrees, wrapped to ±180. */
const dAng = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

describe('traceOutlines', () => {
	it('traces a circle as one closed loop of the right length, clockwise on screen', () => {
		const o = traceOutlines(field(64, 64, circle(32, 32, 20)));
		expect(o).toHaveLength(1);
		expect(o[0].closed).toBe(true);
		const p = new Path(o[0]);
		expect(near(p.length, 2 * Math.PI * 20, 0.5)).toBe(true);
		// Clockwise with y up: the signed area is negative.
		let a = 0;
		const q = o[0].pts;
		for (let i = 0; i + 3 < q.length; i += 2) a += q[i] * q[i + 3] - q[i + 2] * q[i + 1];
		expect(a).toBeLessThan(0);
	});

	it('runs round a hole the other way', () => {
		const ring = (x: number, y: number) => Math.abs(Math.hypot(x - 32, y - 32) - 18) - 6;
		const o = traceOutlines(field(64, 64, ring));
		expect(o).toHaveLength(2);
		const area = (pts: number[]) => {
			let a = 0;
			for (let i = 0; i + 3 < pts.length; i += 2) a += pts[i] * pts[i + 3] - pts[i + 2] * pts[i + 1];
			return a;
		};
		const signs = o.map((x) => Math.sign(area(x.pts))).sort();
		expect(signs).toEqual([-1, 1]);
	});

	it('follows an outline through the seam of a tiling canvas as one loop', () => {
		// A horizontal band: two loops (its top and bottom edges), each once round the torus.
		const band = (_x: number, y: number) => Math.abs(y - 20) - 6;
		const o = traceOutlines(field(48, 40, band, true));
		expect(o).toHaveLength(2);
		for (const x of o) {
			expect(x.closed).toBe(true);
			expect(near(new Path(x).length, 48, 1e-3)).toBe(true);
		}
		// A circle across the corner of a tiling canvas is still one loop.
		const c = (x: number, y: number) => {
			const dx = ((x - 2 + 24) % 48) - 24;
			const dy = ((y - 3 + 20) % 40) - 20;
			return Math.hypot(dx, dy) - 10;
		};
		const t = traceOutlines(field(48, 40, c, true));
		expect(t).toHaveLength(1);
		expect(near(new Path(t[0]).length, 2 * Math.PI * 10, 0.5)).toBe(true);
	});

	it('leaves an outline cut by the canvas open when it does not tile', () => {
		const o = traceOutlines(field(64, 64, circle(0, 32, 20)));
		expect(o).toHaveLength(1);
		expect(o[0].closed).toBe(false);
	});

	it('traces nothing in an empty field', () => {
		expect(traceOutlines(field(16, 16, () => 1e4))).toEqual([]);
	});
});

describe('findCorners', () => {
	it('finds no corners on a circle, four on a square, at its vertices', () => {
		const c = new Path(traceOutlines(field(64, 64, circle(32, 32, 20)))[0]);
		expect(findCorners(c, { angle: 30, round: 16 })).toEqual([]);
		const sq = new Path(traceOutlines(field(64, 64, box(32, 32, 16, 16)))[0]);
		const cs = findCorners(sq, { angle: 30, round: 16 });
		expect(cs).toHaveLength(4);
		for (const s of cs) {
			const [x, y] = sq.at(s);
			expect(near(Math.abs(x - 32), 16, 1) && near(Math.abs(y - 32), 16, 1)).toBe(true);
		}
	});

	it('puts a rounded corner in the middle of its bend, inside and out', () => {
		for (const offset of [-6, 0, 8]) {
			const f = field(96, 96, box(48, 48, 28, 20, 8), false, offset);
			const p = new Path(traceOutlines(f)[0]);
			const cs = findCorners(p, { angle: 30, round: 16 + Math.abs(offset) });
			expect(cs, `offset ${offset}`).toHaveLength(4);
			// The middle of a rounded corner lies on the diagonal from its centre of curvature.
			const r = 8 + offset;
			for (const s of cs) {
				const [x, y] = p.at(s);
				const ex = 28 - 8 + r / Math.SQRT2;
				const ey = 20 - 8 + r / Math.SQRT2;
				expect(near(Math.abs(x - 48), ex, 1) && near(Math.abs(y - 48), ey, 1), `offset ${offset}: ${x}, ${y}`).toBe(
					true
				);
			}
		}
	});

	it('counts a chamfer as one corner, in its middle, but keeps an octagon’s long sides apart', () => {
		// A square with its corners cut off by 12 px chamfers.
		const cham = (x: number, y: number) => {
			const dx = Math.abs(x - 48);
			const dy = Math.abs(y - 48);
			return Math.max(dx - 30, dy - 30, (dx + dy - 48) / Math.SQRT2);
		};
		const p = new Path(traceOutlines(field(96, 96, cham))[0]);
		const cs = findCorners(p, { angle: 30, round: 16 });
		expect(cs).toHaveLength(4);
		for (const s of cs) {
			const [x, y] = p.at(s);
			expect(near(Math.abs(x - 48), 24, 1) && near(Math.abs(y - 48), 24, 1), `${x}, ${y}`).toBe(true);
		}
		// A big octagon: 45° turns 50 px apart are eight corners.
		const oct = (x: number, y: number) => {
			const dx = Math.abs(x - 80);
			const dy = Math.abs(y - 80);
			return Math.max(dx - 60, dy - 60, (dx + dy - 85) / Math.SQRT2);
		};
		expect(findCorners(new Path(traceOutlines(field(160, 160, oct))[0]), { angle: 30, round: 16 })).toHaveLength(8);
	});

	it('keeps four corners on a wobbly square, and ignores a gentle kink', () => {
		const wob = (x: number, y: number) => box(40, 40, 22, 22)(x, y) + 0.35 * Math.sin(x * 1.7) * Math.cos(y * 2.3);
		const p = new Path(traceOutlines(field(80, 80, wob))[0]);
		expect(findCorners(p, { angle: 30, round: 4 })).toHaveLength(4);
		// A 15° kink in a side is no corner at 30°, but is at 10°.
		const kink = (x: number, y: number) => {
			const t = Math.tan((15 * Math.PI) / 180);
			const top = y - (52 + (x > 40 ? (x - 40) * t : 0));
			return Math.max(box(40, 40, 24, 30)(x, y), top);
		};
		const k = new Path(traceOutlines(field(80, 100, kink))[0]);
		expect(findCorners(k, { angle: 30, round: 4 })).toHaveLength(4);
		expect(findCorners(k, { angle: 10, round: 4 })).toHaveLength(5);
	});
});

describe('placeInstances', () => {
	const square = () => traceOutlines(field(64, 64, box(32, 32, 16, 16)));
	const pos = (list: Instance[]) => list.map((i) => [Math.round(i.x), Math.round(i.y)]);

	it('spreads a circle evenly, each turned along it with its up pointing out', () => {
		const list = placeInstances(traceOutlines(field(64, 64, circle(32, 32, 20))), opts({ n: 12 }));
		expect(list).toHaveLength(12);
		for (const it of list) {
			expect(near(Math.hypot(it.x - 32, it.y - 32), 20, 0.3)).toBe(true);
			// Local up (the edge direction turned a quarter anticlockwise, y up) points away from the centre.
			const a = (-it.ang * Math.PI) / 180;
			const up = [-Math.sin(a), Math.cos(a)];
			expect(up[0] * (it.x - 32) + up[1] * (it.y - 32)).toBeGreaterThan(19);
			expect(near(it.step, (2 * Math.PI * 20) / 12, 0.3)).toBe(true);
		}
		// The first sits at the top (GL y largest), the next clockwise on screen (to its right).
		expect(near(list[0].x, 32, 0.6) && near(list[0].y, 52, 0.3)).toBe(true);
		expect(list[1].x).toBeGreaterThan(list[0].x);
		// (The topmost of the traced points, within a couple of degrees of the circle's top.)
		expect(Math.abs(dAng(list[0].ang, 0))).toBeLessThan(3);
	});

	it('starts a square at its top-left corner, and lands 4 repeats on its corners', () => {
		const list = placeInstances(square(), opts({ n: 4 }));
		expect(pos(list)).toEqual([
			[16, 48],
			[48, 48],
			[48, 16],
			[16, 16]
		]);
	});

	it('puts N per side from each corner: corners, then middles, then thirds', () => {
		const one = placeInstances(square(), opts({ along: 'side', n: 1 }));
		expect(pos(one)).toEqual([
			[16, 48],
			[48, 48],
			[48, 16],
			[16, 16]
		]);
		const two = placeInstances(square(), opts({ along: 'side', n: 2 }));
		expect(two).toHaveLength(8);
		expect(pos(two).slice(0, 2)).toEqual([
			[16, 48],
			[32, 48]
		]);
		const three = placeInstances(square(), opts({ along: 'side', n: 3 }));
		expect(three).toHaveLength(12);
		expect(three.slice(0, 3).map((i) => i.x)).toEqual([
			expect.closeTo(16, 0),
			expect.closeTo(16 + 32 / 3, 0),
			expect.closeTo(16 + 64 / 3, 0)
		]);
	});

	it('keeps clear of the corners: centred on each side, fewer on a short one', () => {
		const list = placeInstances(square(), opts({ along: 'side', corners: 'clear', n: 2 }));
		expect(pos(list).slice(0, 2)).toEqual([
			[24, 48],
			[40, 48]
		]);
		// 10 px clearance: a 32 px side holds one centred instance at most.
		const few = placeInstances(square(), opts({ along: 'side', corners: 'clear', n: 3, clear: 10 }));
		expect(few).toHaveLength(4);
		expect(pos(few)[0]).toEqual([32, 48]);
	});

	it('counts by spacing: a whole number per outline or side, specks get none', () => {
		const list = placeInstances(square(), opts({ countBy: 'spacing', spacing: 10 }));
		expect(list).toHaveLength(13); // 128 / 10
		const sides = placeInstances(square(), opts({ along: 'side', countBy: 'spacing', spacing: 10 }));
		expect(sides).toHaveLength(12); // 3 per 32 px side
		const speck = traceOutlines(field(32, 32, circle(16, 16, 0.8)));
		expect(placeInstances(speck, opts({ countBy: 'spacing', spacing: 16 }))).toHaveLength(0);
	});

	it('keeps only the edges facing the chosen ways, corners with their kept side', () => {
		const tb = placeInstances(square(), opts({ along: 'side', n: 2, faces: 2 }));
		// Top side (its two) and bottom side (its two), plus the top-right corner kept with the top side's end? No: a corner
		// belongs to the side it starts; the right side is dropped, but its corner stays because the top side before it is kept.
		expect(pos(tb)).toEqual([
			[16, 48],
			[32, 48],
			[48, 48],
			[48, 16],
			[32, 16],
			[16, 16]
		]);
		const left = placeInstances(square(), opts({ n: 8, faces: 3 }));
		for (const it of left) expect(it.x).toBeLessThan(17);
	});

	it('slides along by Shift, and spreads an open run with half a step free at each end', () => {
		const s = placeInstances(square(), opts({ n: 4, shift: 0.5 }));
		expect(pos(s)[0]).toEqual([32, 48]);
		// A straight band edge cut by the canvas: 4 over 64 px, at 8, 24, 40, 56.
		const band = traceOutlines(field(64, 40, (_x, y) => y - 20));
		expect(band).toHaveLength(1);
		const xs = placeInstances(band, opts({ n: 4 }))
			.map((i) => Math.round(i.x))
			.sort((a, b) => a - b);
		expect(xs).toEqual([8, 24, 40, 56]);
	});

	it('follows the canvas edges as an outline, offset in', () => {
		const list = placeInstances(canvasOutline(64, 32, -4), opts({ along: 'side', n: 1 }));
		expect(pos(list)).toEqual([
			[4, 28],
			[60, 28],
			[60, 4],
			[4, 4]
		]);
	});

	it('stops at the cap', () => {
		expect(placeInstances(square(), opts({ n: 100, max: 37 }))).toHaveLength(37);
	});
});

describe('bucketInstances', () => {
	it('sorts the instances into whole buckets across the canvas, with a header', () => {
		const list = placeInstances(traceOutlines(field(64, 64, circle(32, 32, 20))), opts({ n: 16 }));
		const b = bucketInstances(list, 64, 64, true);
		const [nbx, nby, bw, bh, maxStep, n] = b.bucket;
		expect(nbx * bw).toBeCloseTo(64);
		expect(nby * bh).toBeCloseTo(64);
		expect(n).toBe(16);
		expect(maxStep).toBeCloseTo((2 * Math.PI * 20) / 16, 1);
		// Every bucket's run holds instances inside it, and the runs cover them all.
		let total = 0;
		for (let by = 0; by < nby; by++)
			for (let bx = 0; bx < nbx; bx++) {
				const o = ((by + 1) * b.bucketW + bx) * 4;
				const [first, count] = [b.bucket[o], b.bucket[o + 1]];
				for (let i = first; i < first + count; i++) {
					expect(Math.floor(b.inst[8 * i] / bw)).toBe(bx);
					expect(Math.floor(b.inst[8 * i + 1] / bh)).toBe(by);
				}
				total += count;
			}
		expect(total).toBe(16);
	});
});
