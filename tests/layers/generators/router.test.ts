import { describe, expect, it } from 'vitest';
import { KING, nodeIndex, routeTraces, type RouteOptions } from '@/layers/generators/router';
import { linkTo } from '@/layers/generators/traceLinks';

const base: RouteOptions = {
	nx: 24,
	ny: 24,
	wrap: true,
	seed: 3,
	seeds: 3,
	seedLength: 60,
	minLength: 4,
	maxLength: 40,
	gap: 1,
	straight: 0.75,
	directions: 8,
	hug: 0.6,
	fill: 1,
	vias: 0.05
};

/** A route's node index at (x, y), wrapped. */
const wrapIdx = (r: { nx: number; ny: number }, x: number, y: number) =>
	(((y % r.ny) + r.ny) % r.ny) * r.nx + (((x % r.nx) + r.nx) % r.nx);

describe('circuit router', () => {
	it('is deterministic and fills the board with several traces', () => {
		const a = routeTraces(base);
		const b = routeTraces(base);
		expect(Array.from(a.out)).toEqual(Array.from(b.out));
		expect(a.traces).toBeGreaterThan(5);
		const used = a.owner.filter((t) => t !== 0).length;
		expect(used / (24 * 24)).toBeGreaterThan(0.2);
	});

	it('never lets two traces touch (one free node between them)', () => {
		const r = routeTraces(base);
		const at = (x: number, y: number) => {
			const i = wrapIdx(r, x, y);
			return r.flags[i] & 4 ? r.owner[i] : 0;
		};
		for (let y = 0; y < r.ny; y++)
			for (let x = 0; x < r.nx; x++) {
				const t = at(x, y);
				if (!t) continue;
				for (let dy = -1; dy <= 1; dy++)
					for (let dx = -1; dx <= 1; dx++) {
						const u = at(x + dx, y + dy);
						expect(u === 0 || u === t, `traces ${t} and ${u} touch at ${x},${y}`).toBe(true);
					}
			}
	});

	it('links only to nodes of the same trace, and ends carry pads', () => {
		const r = routeTraces({ ...base, directions: 6 });
		for (let i = 0; i < r.out.length; i++) {
			const d = r.out[i];
			if (d < 0) continue;
			expect([0, 1, 3, 4, 5, 7]).toContain(d); // the 6-direction set only (no verticals)
			const [dx, dy] = KING[d];
			const j = wrapIdx(r, (i % r.nx) + dx, Math.floor(i / r.nx) + dy);
			expect(r.owner[j]).toBe(r.owner[i]);
		}
		expect(Array.from(r.flags).some((f) => f & 1)).toBe(true);
	});

	it('breaks traces into pad-ended pieces with room around every pad', () => {
		const opts: RouteOptions = {
			...base,
			nx: 40,
			ny: 40,
			gap: 0,
			seedLength: 160,
			maxLength: 80,
			minLength: 3,
			hug: 0.7
		};
		const pads = (r: ReturnType<typeof routeTraces>) => Array.from(r.flags).filter((f) => f & 1).length;
		const none = routeTraces({ ...opts, pins: 0 });
		const many = routeTraces({ ...opts, pins: 0.3 });
		expect(pads(many)).toBeGreaterThan(1.3 * pads(none));
		for (let i = 0; i < many.flags.length; i++) {
			if (!(many.flags[i] & 1)) continue;
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++) {
					const j = wrapIdx(many, (i % many.nx) + dx, Math.floor(i / many.nx) + dy);
					// No other trace's node beside a pad, and no pad right beside another (the dropped node separates them).
					if (many.flags[j] & 4) expect(many.owner[j]).toBe(many.owner[i]);
					if (j !== i && many.flags[j] & 1) expect.fail(`pads touch at ${i} and ${j}`);
				}
		}
	});
});

describe('circuit router: crossings and bias', () => {
	/** Grid squares crossed by both diagonals (any traces, the same one included). */
	const crossings = (r: ReturnType<typeof routeTraces>) => {
		const slash = new Set<number>();
		const back = new Set<number>();
		for (let i = 0; i < r.out.length; i++) {
			if (r.out[i] < 0) continue;
			const [dx, dy] = KING[r.out[i]];
			if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) continue;
			const x = i % r.nx;
			const y = Math.floor(i / r.nx);
			(dx * dy > 0 ? slash : back).add(wrapIdx(r, Math.min(x, x + dx), Math.min(y, y + dy)));
		}
		return [...slash].filter((k) => back.has(k)).length;
	};

	it('never crosses diagonals in one grid square, not even a trace its own', () => {
		for (const directions of [6, 8] as const)
			for (let seed = 1; seed < 30; seed++)
				expect(crossings(routeTraces({ ...base, gap: 0, nx: 32, ny: 18, seed, directions, pins: 0.15 }))).toBe(0);
	});

	it('a horizontal bias of 1 favours horizontal steps, 0 vertical ones', () => {
		const steps = (bias: number) => {
			const r = routeTraces({ ...base, nx: 40, ny: 40, gap: 0, directions: 4, bias });
			let h = 0;
			let v = 0;
			for (const d of r.out) if (d >= 0) KING[d][1] === 0 ? h++ : v++;
			return h / Math.max(1, v);
		};
		expect(steps(1)).toBeGreaterThan(3);
		expect(steps(0)).toBeLessThan(1 / 3);
	});

	it('open areas leave bare board; run alongside lays more traces beside one running the same way', () => {
		const used = (r: ReturnType<typeof routeTraces>) => Array.from(r.flags).filter((f) => f & 4).length;
		const o = { ...base, nx: 48, ny: 48, gap: 0 };
		expect(used(routeTraces({ ...o, open: 1 }))).toBeLessThan(0.8 * used(routeTraces(o)));
		// Steps with a parallel neighbour (same direction, a node to the side).
		const parallel = (r: ReturnType<typeof routeTraces>) => {
			let k = 0;
			for (let i = 0; i < r.out.length; i++) {
				const d = r.out[i];
				if (d < 0) continue;
				const [dx, dy] = KING[d];
				const x = i % r.nx;
				const y = Math.floor(i / r.nx);
				if (r.out[wrapIdx(r, x - dy, y + dx)] === d || r.out[wrapIdx(r, x + dy, y - dx)] === d) k++;
			}
			return k / Math.max(1, r.out.filter((d) => d >= 0).length);
		};
		expect(parallel(routeTraces({ ...o, hug: 3 }))).toBeGreaterThan(parallel(routeTraces({ ...o, hug: 0 })) + 0.1);
	});

	it('indexes nodes wrapped round the board, or -1 off it', () => {
		expect(nodeIndex(-1, 0, 5, 4, true)).toBe(4);
		expect(nodeIndex(5, 4, 5, 4, true)).toBe(0);
		expect(nodeIndex(2, -1, 5, 4, true)).toBe(17);
		expect(nodeIndex(-1, 0, 5, 4, false)).toBe(-1);
		expect(nodeIndex(4, 3, 5, 4, false)).toBe(19);
		// A link from the last node toward KING[1] (+1, +1) wraps to the first.
		expect(linkTo(19, 1, 5, 4)).toBe(0);
	});
});
