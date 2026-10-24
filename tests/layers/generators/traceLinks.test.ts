import { describe, expect, it } from 'vitest';
import { KING, kingOf, linkDegrees, traceLinks, type TraceLinkOptions } from '@/layers/generators/traceLinks';

const base: TraceLinkOptions = {
	mode: 'route',
	nx: 20,
	ny: 16,
	wrap: true,
	seed: 1234,
	density: 0.8,
	diagonal: 0.5,
	bias: 0.5,
	straight: 0.6,
	grouping: 0.7,
	block: 3,
	vias: 0.2
};

/** A node's index at (x, y), wrapped. */
const wrapIdx = (o: TraceLinkOptions, x: number, y: number) =>
	(((y % o.ny) + o.ny) % o.ny) * o.nx + (((x % o.nx) + o.nx) % o.nx);

/** Every drawn segment as [from x, from y, to x, to y] (to unwrapped). */
function segments(o: TraceLinkOptions): number[][] {
	const { links } = traceLinks(o);
	const out: number[][] = [];
	for (let y = 0; y < o.ny; y++)
		for (let x = 0; x < o.nx; x++)
			for (let d = 0; d < 8; d++) if (links[y * o.nx + x] & (1 << d)) out.push([x, y, x + KING[d][0], y + KING[d][1]]);
	return out;
}

function degrees(o: TraceLinkOptions): number[] {
	const deg = new Array(o.nx * o.ny).fill(0);
	for (const [x0, y0, x1, y1] of segments(o)) {
		deg[wrapIdx(o, x0, y0)]++;
		deg[wrapIdx(o, x1, y1)]++;
	}
	return deg;
}

/** Grid squares (by lower-left node) holding both diagonals. */
function crossings(o: TraceLinkOptions): number {
	const slash = new Set<string>();
	const back = new Set<string>();
	for (const [x0, y0, x1, y1] of segments(o)) {
		if (x0 === x1 || y0 === y1) continue;
		const key = `${(Math.min(x0, x1) + o.nx) % o.nx},${(Math.min(y0, y1) + o.ny) % o.ny}`;
		((x1 - x0) * (y1 - y0) > 0 ? slash : back).add(key);
	}
	return [...slash].filter((k) => back.has(k)).length;
}

describe('trace links', () => {
	for (const mode of ['route', 'maze'] as const) {
		const o = { ...base, mode };

		it(`${mode}: is deterministic and draws a fair share of the board`, () => {
			expect(Array.from(traceLinks(o).links)).toEqual(Array.from(traceLinks(o).links));
			expect(segments(o).length).toBeGreaterThan(o.nx * o.ny * 0.2);
		});

		it(`${mode}: never crosses diagonals in one grid square`, () => {
			expect(crossings(o)).toBe(0);
			expect(crossings({ ...o, wrap: false, seed: 7 })).toBe(0);
		});

		it(`${mode}: keeps every link on the board when not tiling`, () => {
			for (const [, , x, y] of segments({ ...o, wrap: false })) {
				expect(x >= 0 && y >= 0 && x < o.nx && y < o.ny).toBe(true);
			}
		});

		it(`${mode}: flags trace ends (degree 1) and puts vias only on traces`, () => {
			const { flags } = traceLinks(o);
			const deg = degrees(o);
			for (let i = 0; i < deg.length; i++) {
				expect(Boolean(flags[i] & 1)).toBe(deg[i] === 1);
				if (flags[i] & 2) expect(deg[i]).toBeGreaterThan(0);
			}
		});
	}

	it('counts own and arriving links per node, and kingOf inverts KING', () => {
		for (let d = 0; d < 8; d++) expect(kingOf(KING[d][0], KING[d][1])).toBe(d);
		// 3×2 nodes, wrapping: 0 → 1 east, 1 → 4 south (y + 1), 2 → 0 east across the seam.
		const links = new Uint8Array(6);
		links[0] = 1 << 0;
		links[1] = 1 << 2;
		links[2] = 1 << 0;
		expect(Array.from(linkDegrees(links, 3, 2))).toEqual([2, 2, 1, 0, 1, 0]);
	});

	it('route: traces are paths (at most one link in and one out per node)', () => {
		const deg = degrees(base);
		expect(Math.max(...deg)).toBeLessThanOrEqual(2);
		const { links } = traceLinks(base);
		for (const m of links) expect(m & (m - 1)).toBe(0);
	});
});

describe('labyrinth', () => {
	const lab: TraceLinkOptions = {
		...base,
		mode: 'labyrinth',
		nx: 24,
		ny: 18,
		straight: 0.5,
		branching: 0.2,
		diagonal: 0.3
	};

	it('is one tree: through every node without diagonals, nearly every node with them; no crossing diagonals', () => {
		for (const [wrap, diagonal] of [
			[true, 0],
			[false, 0],
			[true, 0.3],
			[false, 0.3]
		] as const) {
			const o = { ...lab, wrap, diagonal };
			const segs = segments(o);
			const nodes = new Set(
				segs.flatMap(([x0, y0, x1, y1]) => [
					`${(x0 + o.nx) % o.nx},${(y0 + o.ny) % o.ny}`,
					`${(x1 + o.nx) % o.nx},${(y1 + o.ny) % o.ny}`
				])
			);
			expect(segs.length).toBe(nodes.size - 1);
			if (diagonal === 0) expect(nodes.size).toBe(o.nx * o.ny);
			else expect(nodes.size).toBeGreaterThan(0.9 * o.nx * o.ny);
			const parent = Array.from({ length: o.nx * o.ny }, (_, i) => i);
			const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
			for (const [x0, y0, x1, y1] of segs) {
				const a = find(wrapIdx(o, x0, y0));
				const b = find(wrapIdx(o, x1, y1));
				expect(a, 'a loop').not.toBe(b);
				parent[a] = b;
			}
			expect(crossings(o)).toBe(0);
			expect(traceLinks(o).links).toEqual(traceLinks(o).links);
		}
	});

	it('never meets diagonals in an X or V, nor a straight link 45° off a diagonal', () => {
		for (const seed of [3, 9, 27]) {
			const o = { ...lab, seed, diagonal: 0.5, branching: 1, straight: 0.25 };
			const at: number[][] = Array.from({ length: o.nx * o.ny }, () => []);
			for (const [x0, y0, x1, y1] of segments(o)) {
				at[wrapIdx(o, x0, y0)].push(kingOf(x1 - x0, y1 - y0));
				at[wrapIdx(o, x1, y1)].push(kingOf(x0 - x1, y0 - y1));
			}
			let wedges = 0;
			let diagonals = 0;
			for (const ds of at)
				for (const a of ds) {
					if (a & 1) diagonals++;
					for (const b of ds) {
						if (a === b || (a & 1) + (b & 1) === 0) continue;
						const turn = Math.min((a - b + 8) % 8, (b - a + 8) % 8);
						if ((a & 1) === 1 && (b & 1) === 1) expect(turn).toBe(4);
						else if (turn === 1) wedges++;
					}
				}
			expect(wedges).toBe(0);
			expect(diagonals).toBeGreaterThan(20);
		}
	});

	it('keeps to right angles with no diagonals, and pads its dead ends', () => {
		const o = { ...lab, diagonal: 0 };
		for (const [x0, y0, x1, y1] of segments(o)) expect(x0 === x1 || y0 === y1).toBe(true);
		const deg = degrees(o);
		const { flags } = traceLinks(o);
		for (let i = 0; i < deg.length; i++) expect(Boolean(flags[i] & 1)).toBe(deg[i] === 1);
	});
});
