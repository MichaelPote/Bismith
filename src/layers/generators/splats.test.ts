import { describe, expect, it } from 'vitest';
import { freshParams } from '../registry';
import { ensureBuiltins } from '@/render/builtins';
import { PRIM_ROW, TexelReader } from '../primTexture';
import {
	MAX_SPLAT_PRIMS,
	SPLAT_BITE,
	SPLAT_CAPSULE,
	SPLAT_STRIDE,
	buildSplats,
	encodeSplats,
	parseSplatPoints,
	type SplatOptions,
	type SplatPrim
} from './splatsGeometry';

const base: SplatOptions = {
	width: 256,
	height: 256,
	tile: true,
	seed: 1,
	count: 3,
	size: 20,
	sizeVar: 0.5,
	splash: 0.7,
	ragged: 0.5,
	jets: 8,
	jetLength: 2.2,
	drops: 1,
	reach: 2.5,
	mist: 1,
	aim: 0,
	oneSided: 0,
	gravity: 0,
	gravityAngle: 0,
	runs: 3,
	runLength: 4,
	bead: 0.6
};

describe('splats geometry', () => {
	it('is deterministic and changes with the seed', () => {
		expect(buildSplats(base)).toEqual(buildSplats(base));
		expect(buildSplats({ ...base, seed: 2 })).not.toEqual(buildSplats(base));
	});

	it('throws nothing out of a poured pool, and more with Splash', () => {
		const pool = buildSplats({ ...base, splash: 0 });
		const thrown = buildSplats(base);
		expect(pool.every((p) => p.kind !== SPLAT_CAPSULE)).toBe(true);
		expect(thrown.length).toBeGreaterThan(5 * pool.length);
	});

	it('runs down with gravity (and only then), in the direction asked', () => {
		const capsules = (o: Partial<SplatOptions>) =>
			buildSplats({ ...base, splash: 0, ...o }).filter((p) => p.kind === SPLAT_CAPSULE);
		expect(capsules({})).toHaveLength(0);
		const down = capsules({ gravity: 1 });
		expect(down.length).toBeGreaterThan(3);
		// User px, y down: the runs fall towards +y; at 90° (to the left) towards −x.
		expect(down.reduce((s, p) => s + p.dy, 0)).toBeGreaterThan(0);
		const left = capsules({ gravity: 1, gravityAngle: 90 });
		expect(left.reduce((s, p) => s + p.dx, 0)).toBeLessThan(0);
	});

	it('bites into the rim of a ragged core only', () => {
		expect(buildSplats({ ...base, ragged: 0 }).some((p) => p.kind === SPLAT_BITE)).toBe(false);
		expect(buildSplats({ ...base, ragged: 1 }).some((p) => p.kind === SPLAT_BITE)).toBe(true);
	});

	it('keeps every piece under half the tile, so the shader can wrap it from its anchor', () => {
		for (const size of [10, 40]) {
			const prims = buildSplats({ ...base, width: 64, height: 64, size, gravity: 1, runLength: 12, jetLength: 8 });
			for (const p of prims) {
				const len = p.kind === SPLAT_CAPSULE ? Math.hypot(p.dx, p.dy) : 0;
				expect(len + Math.max(p.r0, p.r1) + p.k).toBeLessThan(32);
			}
		}
	});

	it('stays within the budget and encodes every primitive', () => {
		const many = buildSplats({ ...base, count: 200, mist: 3, drops: 3 });
		expect(many.length).toBeLessThanOrEqual(MAX_SPLAT_PRIMS);
		const tex = encodeSplats(many, { width: 256, height: 256, tile: true, margin: 8 });
		expect(tex.texture.width).toBe(PRIM_ROW);
		expect(tex.count).toBe(many.length);
		expect(tex.table).toBeGreaterThan(new TexelReader(tex).rec(many.length - 1, SPLAT_STRIDE) + 3);
		expect(tex.grid[0] * tex.grid[1]).toBeGreaterThan(1);
	});

	it('shares the primitives out, so more splats always put more on screen and none goes missing', () => {
		// Every splat's body is its first primitive, and each draws its own random (a bite has none).
		const splats = (o: Partial<SplatOptions>) =>
			new Set(buildSplats({ ...base, ...o }).flatMap((p) => (p.kind === SPLAT_BITE ? [] : [p.rnd]))).size;
		expect(splats({ count: 24, size: 40 })).toBe(24);
		expect(splats({ count: 100, size: 40 })).toBe(100);
		// Ragged cores alone (lobes, bites, clumps, puddles) would take the budget.
		for (const splash of [0, 1])
			expect(splats({ width: 512, height: 512, count: 200, size: 40, ragged: 1, splash })).toBe(200);
	});

	it('encodes positions far out in a coarser unit instead of clamping them', () => {
		const p: SplatPrim = {
			kind: SPLAT_CAPSULE,
			x: 5000,
			y: 8000,
			dx: -4500,
			dy: 30,
			r0: 1500,
			r1: 2,
			k: 600,
			swell: 1,
			rnd: 0.5
		};
		const tex = encodeSplats([p], { width: 8192, height: 8192, tile: false, margin: 8 });
		expect(tex.unit).toBe(2);
		const r = new TexelReader(tex);
		expect([r.pos(0, 0), r.pos(0, 1), r.pos(1, 0), r.pos(1, 1)]).toEqual([5000, 8000, -4500, 30]);
		expect((r.u16(2, 0) / 64) * tex.unit).toBeCloseTo(1500, 1);
		expect(((r.u16(3, 0) & 16383) / 32) * tex.unit).toBeCloseTo(600, 1);
		expect(
			encodeSplats([{ ...p, x: 100, y: 100, dx: 50, r0: 20, k: 4 }], { width: 256, height: 256, tile: true, margin: 8 })
				.unit
		).toBe(1);
	});

	it('keeps the layout while any other param changes: only the splat count and the seed move the splats', () => {
		const centres = (o: Partial<SplatOptions>) => {
			const prims = buildSplats({ ...base, gravity: 0, ...o });
			// Bodies: the ellipses whose radii are 0.75 × R and whose k is 0.2 × R (R = r0 / 0.75).
			return prims
				.filter((p) => p.kind === 0 && p.r0 === p.r1 && Math.abs(p.k - (0.2 * p.r0) / 0.75) < 1e-9)
				.map((p) => [Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.r0 * 1000)]);
		};
		const ref = centres({});
		expect(ref).toHaveLength(base.count);
		for (const change of [
			{ jets: 20 },
			{ drops: 2.5 },
			{ mist: 0 },
			{ ragged: 1 },
			{ splash: 0.2 },
			{ oneSided: 0.9 },
			{ reach: 6 },
			{ jetLength: 5 }
		])
			expect(centres(change), JSON.stringify(change)).toEqual(ref);
		expect(centres({ seed: 2 })).not.toEqual(ref);
		// One more splat on the same grid (2 × 2) adds it without moving the three; a new grid lays them out anew.
		expect(centres({ count: 4 }).slice(0, 3)).toEqual(ref);
		expect(centres({ count: 7 }).slice(0, 3)).not.toEqual(ref);
	});

	it('adds a jet without moving the others, and Bead changes only the beads', () => {
		const capsules = (o: Partial<SplatOptions>) =>
			buildSplats({ ...base, count: 1, drops: 0, mist: 0, splash: 1, ...o })
				.filter((p) => p.kind === SPLAT_CAPSULE)
				.map((p) => [p.x, p.y, p.dx, p.dy].map((v) => Math.round(v * 1000)).join(','));
		const eight = capsules({ jets: 8 });
		const nine = new Set(capsules({ jets: 9 }));
		// Spikes are 2 × jets, so the counts shift; every capsule of the 8-jet splat is still there with 9.
		expect(eight.every((c) => nine.has(c))).toBe(true);
		const runs = (bead: number) =>
			buildSplats({ ...base, count: 1, splash: 0, gravity: 1, bead }).filter((p) => p.kind === SPLAT_CAPSULE);
		expect(runs(0.2)).toEqual(runs(0.9));
	});

	it('lists every primitive a cell needs: the distance within the margin is the same as over all of them', () => {
		// The shader's distance (splats.ts), from the encoded texture: over every primitive, or over q's cell's list only.
		for (const tile of [true, false]) {
			const W = 128;
			const margin = 6;
			const prims = buildSplats({ ...base, width: W, height: W, tile, count: 5, size: 12, ragged: 1, gravity: 0.6 });
			const tex = encodeSplats(prims, { width: W, height: W, tile, margin });
			const r = new TexelReader(tex);
			const wrap = (v: number) => (tile ? v - W * Math.floor(v / W + 0.5) : v);
			const sdEllipse = (x: number, y: number, a: number, b: number) => {
				if (Math.abs(a - b) < 1e-3) return Math.hypot(x, y) - a;
				const k0 = Math.hypot(x / a, y / b);
				return k0 < 1e-6 ? -Math.min(a, b) : (k0 * (k0 - 1)) / Math.hypot(x / (a * a), y / (b * b));
			};
			const dist = (qx: number, qy: number, list: number[]) => {
				let d = 1e4;
				for (const i of list) {
					const t = r.rec(i, SPLAT_STRIDE);
					const vx = wrap(qx - r.pos(t, 0));
					const vy = wrap(qy - r.pos(t, 1));
					const r0 = (r.u16(t + 2, 0) / 64) * tex.unit;
					const r1 = (r.u16(t + 2, 1) / 64) * tex.unit;
					const kind = r.u16(t + 3, 0) >> 14;
					const k = Math.max(((r.u16(t + 3, 0) & 16383) / 32) * tex.unit, 1e-4);
					let di: number;
					if (kind === SPLAT_CAPSULE) {
						const ex = r.pos(t + 1, 0);
						const ey = r.pos(t + 1, 1);
						const h = Math.min(1, Math.max(0, (vx * ex + vy * ey) / Math.max(ex * ex + ey * ey, 1e-6)));
						di = Math.hypot(vx - ex * h, vy - ey * h) - (r0 + (r1 - r0) * h);
					} else {
						const ax = r.u16(t + 1, 0) / 32767.5 - 1;
						const ay = r.u16(t + 1, 1) / 32767.5 - 1;
						di = sdEllipse(vx * ax + vy * ay, -vx * ay + vy * ax, Math.max(r0, 0.05), Math.max(r1, 0.05));
					}
					// sdfCombine: smooth union (5), smooth subtraction (6).
					const h = Math.min(
						1,
						Math.max(0, kind === SPLAT_BITE ? 0.5 - (0.5 * (d + di)) / k : 0.5 + (0.5 * (di - d)) / k)
					);
					d = kind === SPLAT_BITE ? d + (-di - d) * h + k * h * (1 - h) : di + (d - di) * h - k * h * (1 - h);
				}
				return d;
			};
			const all = prims.map((_, i) => i);
			let near = 0;
			for (let y = -10.5; y < W + 10; y += 1.7)
				for (let x = -10.5; x < W + 10; x += 1.7) {
					const full = dist(x, y, all);
					if (Math.abs(full) >= margin) continue;
					expect(dist(x, y, r.cellList(x, y, { width: W, height: W, tile }))).toBeCloseTo(full, 4);
					near++;
				}
			expect(near).toBeGreaterThan(500);
		}
	});

	it('places a splat on every point by hand, each looking the same wherever it is moved', () => {
		// The body is a splat's first primitive (centred on it without gravity); each splat draws its own random.
		const bodies = (at: [number, number][]) => {
			const seen = new Map<number, [number, number]>();
			for (const p of buildSplats({ ...base, at }))
				if (p.kind !== SPLAT_BITE && !seen.has(p.rnd)) seen.set(p.rnd, [p.x, p.y]);
			return [...seen.values()];
		};
		expect(
			bodies([
				[50, 60],
				[200, 100],
				[120, 220]
			])
		).toEqual([
			[50, 60],
			[200, 100],
			[120, 220]
		]);
		// Off a tileable texture it wraps back on.
		expect(bodies([[-6, 300]])).toEqual([[250, 44]]);
		// Moving a point moves its splat whole: the same pieces, shifted.
		const rel = (x: number, y: number) =>
			buildSplats({ ...base, at: [[x, y]] }).map((p) => [
				p.kind,
				Math.round((p.x - x) * 1e3),
				Math.round((p.y - y) * 1e3),
				p.r0
			]);
		expect(rel(100, 100)).toEqual(rel(130, 90));
	});

	it('reads every point of the shape editor’s text as a splat, the lines between them ignored', () => {
		expect(parseSplatPoints('10,20 | 30,40 50,60\n70,80', false, 256, 128)).toEqual([
			[10, 20],
			[30, 40],
			[50, 60],
			[70, 80]
		]);
		expect(parseSplatPoints('0.5,0.25', true, 256, 128)).toEqual([[128, 32]]);
	});

	it('sizes a new layer to the texture', () => {
		ensureBuiltins();
		expect(freshParams('splats', { width: 128, height: 128 }).size).toBe(10);
		expect(freshParams('splats', { width: 512, height: 512 }).size).toBe(40);
	});
});
