import { describe, expect, it } from 'vitest';
import { freshParams } from '../registry';
import { ensureBuiltins } from '@/render/builtins';
import {
	MAX_SPLAT_PRIMS,
	SPLAT_BITE,
	SPLAT_CAPSULE,
	buildSplats,
	encodeSplats,
	type SplatOptions
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
		const prims = buildSplats({ ...base, width: 64, height: 64, size: 10, gravity: 1, runLength: 12, jetLength: 8 });
		for (const p of prims) if (p.kind === SPLAT_CAPSULE) expect(Math.hypot(p.dx, p.dy)).toBeLessThan(32);
	});

	it('stays within the shader loop and encodes every primitive', () => {
		const many = buildSplats({ ...base, count: 200, mist: 3, drops: 3 });
		expect(many.length).toBeLessThanOrEqual(MAX_SPLAT_PRIMS);
		const tex = encodeSplats(many);
		expect(tex.width).toBeLessThanOrEqual(1024);
		expect(tex.width * tex.height).toBeGreaterThanOrEqual(1 + 4 * many.length);
		expect((tex.data[0] << 8) | tex.data[1]).toBe(many.length);
	});

	it('shares the primitives out, so more splats always put more on screen', () => {
		// Every splat's body is its first primitive, and each draws its own random.
		const splats = (count: number) => new Set(buildSplats({ ...base, count, size: 40 }).map((p) => p.rnd)).size;
		expect(splats(24)).toBeGreaterThan(20);
		expect(splats(100)).toBeGreaterThanOrEqual(100);
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

	it('sizes a new layer to the texture', () => {
		ensureBuiltins();
		expect(freshParams('splats', { width: 128, height: 128 }).size).toBe(10);
		expect(freshParams('splats', { width: 512, height: 512 }).size).toBe(40);
	});
});
