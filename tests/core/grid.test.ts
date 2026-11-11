import { describe, expect, it } from 'vitest';
import {
	breakAll,
	breakAt,
	edgesPx,
	evenOut,
	formatMerges,
	formatSizes,
	grow,
	grown,
	moveLine,
	panelAt,
	panels,
	parseGrid,
	parseMerges,
	parseSizes,
	removeLine,
	setCount,
	split,
	toggle,
	panelOff,
	formatOff,
	areaPx,
	randomMerges,
	splitAcross,
	type Grid
} from '@/core/grid';

const grid = (nc: number, nr: number, merge = ''): Grid =>
	parseGrid(Array(nc).fill(1).join(' '), Array(nr).fill(1).join(' '), merge);

describe('sizes', () => {
	it('parses positive numbers as fractions and falls back to one cell', () => {
		expect(parseSizes('1 3')).toEqual([0.25, 0.75]);
		expect(parseSizes('2, x -1 2')).toEqual([0.5, 0.5]);
		expect(parseSizes('')).toEqual([1]);
		expect(parseSizes(undefined, 3)).toHaveLength(3);
		expect(parseSizes(Array(40).fill(1).join(' '))).toHaveLength(16);
	});
	it('formats to four decimals summing to one', () => {
		const t = formatSizes([1, 1, 1]);
		expect(t).toBe('0.3333 0.3333 0.3334');
		expect(parseSizes(t).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
	});
	it('rounds edges to whole px, each cell at least 1 px', () => {
		expect(edgesPx([0.25, 0.5, 0.25], 100)).toEqual([0, 25, 75, 100]);
		expect(edgesPx([0.001, 0.001, 0.998], 10)).toEqual([0, 1, 2, 10]);
	});
});

describe('merges', () => {
	it('drops invalid, single-cell, out-of-range and overlapping spans', () => {
		expect(parseMerges('0,0,2,1 1,0,1,2 0,1,1,1 2,2,2,1 a 0,1,1,2', 3, 3)).toEqual([
			{ c: 0, r: 0, w: 2, h: 1 },
			{ c: 0, r: 1, w: 1, h: 2 }
		]);
	});
	it('lists every panel once, merges and single cells', () => {
		const g = grid(3, 2, '0,0,1,2 1,0,2,1');
		expect(panels(g)).toEqual([
			{ c: 0, r: 0, w: 1, h: 2 },
			{ c: 1, r: 0, w: 2, h: 1 },
			{ c: 1, r: 1, w: 1, h: 1 },
			{ c: 2, r: 1, w: 1, h: 1 }
		]);
		expect(panelAt(g, 0, 1)).toEqual({ c: 0, r: 0, w: 1, h: 2 });
	});
	it('grows a cell into its neighbour and a panel by a whole strip', () => {
		let g = grid(3, 3);
		g = grow(g, { c: 1, r: 1, w: 1, h: 1 }, 'right');
		expect(formatMerges(g.merges)).toBe('1,1,2,1');
		g = grow(g, panelAt(g, 1, 1), 'up');
		expect(formatMerges(g.merges)).toBe('1,0,2,2');
	});
	it('takes in merges wholly inside, refuses L-shapes and edges', () => {
		const g = grid(3, 3, '1,0,2,1');
		// Growing (0,0) right would take half of the 2×1 merge: an L-shape.
		expect(grown(g, { c: 0, r: 0, w: 1, h: 1 }, 'right')).toBeNull();
		expect(grown(g, { c: 0, r: 0, w: 1, h: 1 }, 'left')).toBeNull();
		// Growing the row below up takes the whole merge.
		const g2 = grow(grow(g, { c: 1, r: 1, w: 1, h: 1 }, 'right'), { c: 1, r: 1, w: 2, h: 1 }, 'up');
		expect(formatMerges(g2.merges)).toBe('1,0,2,2');
	});
	it('breaks a merge along a line, or into cells', () => {
		const g = grid(3, 2, '0,0,3,2');
		const p = { c: 0, r: 0, w: 3, h: 2 };
		expect(formatMerges(breakAt(g, p, 'col', 1).merges)).toBe('0,0,1,2 1,0,2,2');
		expect(formatMerges(breakAt(g, p, 'row', 1).merges)).toBe('0,0,3,1 0,1,3,1');
		expect(formatMerges(breakAt(grid(2, 1, '0,0,2,1'), { c: 0, r: 0, w: 2, h: 1 }, 'col', 1).merges)).toBe('');
		expect(breakAll(g, p).merges).toEqual([]);
	});
});

describe('lines', () => {
	it('splits a column, widening the merges across it', () => {
		const g = split(grid(2, 2, '0,0,2,1 1,1,1,1'), 'col', 0, 0.25);
		expect(g.cols).toEqual([0.125, 0.375, 0.5]);
		expect(formatMerges(g.merges)).toBe('0,0,3,1');
	});
	it('removes a line, re-mapping merges', () => {
		const g = removeLine(grid(4, 2, '0,0,2,1 2,1,2,1 3,0,1,2'), 'col', 2);
		expect(g.cols).toEqual([0.25, 0.5, 0.25]);
		// 0,0,2,1 → 0,0,2,1 (cols 0–1); 2,1,2,1 → 1,1,2,1; 3,0,1,2 → 2,0,1,2 overlaps it and is dropped.
		expect(formatMerges(g.merges)).toBe('0,0,2,1 1,1,2,1');
	});
	it('moves a line between its neighbours only, keeping a minimum', () => {
		const g = moveLine(grid(3, 1), 'col', 1, 0.5, 0.05);
		expect(g.cols[0]).toBeCloseTo(0.5);
		expect(g.cols[1]).toBeCloseTo(1 / 6);
		expect(g.cols[2]).toBeCloseTo(1 / 3);
		expect(moveLine(grid(3, 1), 'col', 1, 0.9, 0.05).cols[1]).toBeCloseTo(0.05);
	});
	it('adds columns sharing the space and drops them from the end, clipping merges', () => {
		const g = setCount(parseGrid('1 3', '1', '0,0,2,1'), 'col', 4);
		expect(g.cols.map((v) => +v.toFixed(4))).toEqual([0.125, 0.375, 0.25, 0.25]);
		const h = setCount(grid(3, 1, '1,0,2,1'), 'col', 2);
		expect(h.merges).toEqual([]);
		expect(evenOut(g).cols).toEqual([0.25, 0.25, 0.25, 0.25]);
	});
});

describe('off cells', () => {
	it('toggles a panel off and on, and follows splits and removals', () => {
		let g = toggle(grid(3, 2, '0,0,2,1'), { c: 0, r: 0, w: 2, h: 1 });
		expect(formatOff(g.off, 3)).toBe('0,0 1,0');
		expect(panelOff(g, { c: 0, r: 0, w: 2, h: 1 })).toBe(true);
		const s = split(g, 'col', 1, 0.5);
		expect(formatOff(s.off, 4)).toBe('0,0 1,0 2,0');
		const r = removeLine(g, 'col', 2);
		// Column 1 (off) joins column 2 (on): on.
		expect(formatOff(r.off, 2)).toBe('0,0');
		const rs = split(toggle(grid(1, 2), { c: 0, r: 1, w: 1, h: 1 }), 'row', 1, 0.5);
		expect(formatOff(rs.off, 1)).toBe('0,1 0,2');
		g = toggle(g, { c: 0, r: 0, w: 2, h: 1 });
		expect(g.off).toEqual([0, 0]);
	});
	it('places the area in whole px inside the canvas', () => {
		expect(areaPx({}, 64, 32)).toEqual({ x: 0, y: 0, w: 64, h: 32, full: true });
		expect(areaPx({ area_x: 0.25, area_y: 0.5, area_w: 0.9, area_h: 0.26 }, 64, 32)).toEqual({
			x: 16,
			y: 16,
			w: 48,
			h: 8,
			full: false
		});
	});
});

describe('random merges', () => {
	it('merges free cells only, never overlapping, the same for a seed', () => {
		const g = toggle(grid(6, 6, '0,0,2,2'), { c: 5, r: 5, w: 1, h: 1 });
		const a = randomMerges(g, 0.6, 3);
		expect(a).toEqual(randomMerges(g, 0.6, 3));
		expect(a.merges.length).toBeGreaterThan(g.merges.length);
		expect(a.merges[0]).toEqual({ c: 0, r: 0, w: 2, h: 2 });
		// Every cell in at most one merge; the off cell in none.
		const seen = new Set<string>();
		for (const m of a.merges)
			for (let r = m.r; r < m.r + m.h; r++)
				for (let c = m.c; c < m.c + m.w; c++) {
					expect(seen.has(`${c},${r}`)).toBe(false);
					seen.add(`${c},${r}`);
				}
		expect(seen.has('5,5')).toBe(false);
		expect(randomMerges(g, 0, 3)).toBe(g);
	});
});

describe('merging in a staggered layout', () => {
	it('keeps random merges to one row or column, off blocked cells', () => {
		const g = grid(6, 6);
		const rows = randomMerges(g, 0.9, 5, { along: 'row' });
		expect(rows.merges.length).toBeGreaterThan(3);
		expect(rows.merges.every((m) => m.h === 1 && m.w === 2)).toBe(true);
		const cols = randomMerges(g, 0.9, 5, { along: 'col', blocked: (c) => c === 1 });
		expect(cols.merges.every((m) => m.w === 1 && m.h === 2 && m.c !== 1)).toBe(true);
	});
	it('splits drawn merges into strips along the staggered rows or columns', () => {
		const g = grid(4, 4, '0,0,2,2 2,0,1,3 3,0,1,1');
		expect(formatMerges(splitAcross(g, 'row').merges)).toBe('0,0,2,1 0,1,2,1');
		expect(formatMerges(splitAcross(g, 'col').merges)).toBe('0,0,1,2 1,0,1,2 2,0,1,3');
	});
});
