import { describe, expect, it } from 'vitest';
import type { CpuTexture } from '@/layers/types';
import {
	GLYPH_TABLES,
	bridgeCells,
	mirrorCells,
	parseCells,
	smoothCells,
	stampLayer,
	stampTexture,
	strokeCells,
	textCells,
	type Cells
} from '@/layers/generators/stamp';

const rows = (c: Cells) =>
	Array.from({ length: c.h }, (_, y) => Array.from(c.lv.subarray(y * c.w, (y + 1) * c.w)).join(''));

describe('stamp bitmaps', () => {
	it('parses rows of cell characters, blank rows at either end dropped, up to 128 × 128', () => {
		expect(rows(parseCells('..#..\n.###.\n#####'))).toEqual(['00300', '03330', '33333']);
		expect(rows(parseCells('\n\n#+-.\n  #\n\n'))).toEqual(['3210', '0030']);
		expect(parseCells('#'.repeat(200)).w).toBe(128);
		expect(parseCells(Array(200).fill('#').join('\n')).h).toBe(128);
	});

	it('mirrors the left half (odd: shared centre column)', () => {
		const c = parseCells('#+.\n-..');
		expect(rows(mirrorCells(c, 'odd'))).toEqual(['32023', '10001']);
		expect(rows(mirrorCells(c, 'even'))).toEqual(['320023', '100001']);
		expect(mirrorCells(c, 'none')).toBe(c);
	});

	it('draws the compact font from the core glyphs, upper-cased, with its own extras and stroke glyphs', () => {
		expect(rows(textCells('03'))).toEqual(['3330333', '3030003', '3030033', '3030003', '3330333']);
		expect(rows(textCells('a'))).toEqual(rows(textCells('A')));
		expect(rows(textCells('.'))[4]).toBe('3');
		expect(rows(textCells(','))).toEqual(['00', '00', '00', '03', '30']);
		// Unknown characters: the font's '#'.
		expect(rows(textCells('~'))).toEqual(rows(textCells('#')));
		// Drawn as strokes, B closes its middle bar.
		expect(rows(textCells('B'))[2]).toBe('330');
		expect(rows(textCells('B', { strokeGlyphs: true }))[2]).toBe('333');
		// Lines centre within the widest (M is 5 wide, 1 is 3).
		expect(rows(textCells('M|1'))[6]).toBe('00300');
	});

	it('aligns lines, spaces letters, bolds, and draws the large font with descenders', () => {
		expect(rows(textCells('1|11', { align: 'left' }))[0]).toBe('0300000');
		expect(rows(textCells('1|11', { align: 'right' }))[0]).toBe('0000030');
		expect(textCells('11', { spacing: 3 }).w).toBe(9);
		expect(textCells('1|1', { lineGap: 4 }).h).toBe(14);
		// Bold widens the advance; advance-only (bold applied later, after Join diagonals) keeps the glyphs as drawn.
		expect(textCells('11', { bold: true }).w).toBe(9);
		expect(rows(textCells('1', { bold: true, boldAdvanceOnly: true }))[0]).toBe('0300');
		expect(textCells('A', { font: 'large' }).h).toBe(7);
		expect(textCells('Ag', { font: 'large' }).h).toBe(8);
		// Text longer than 64 cells is no longer cut.
		expect(textCells('ABCDEFGHIJKLMNOPQRSTUVWXYZ').w).toBeGreaterThan(64);
	});

	it('joins diagonals by adding corner bridges only', () => {
		// An X: the crossing and the arms join (the half-cells beside each corner contact are set) …
		const x = bridgeCells(parseCells('#.#\n.#.\n#.#'));
		expect(rows(x)).toEqual(['330033', '333333', '033330', '033330', '333333', '330033']);
		// … and an L keeps its square corners (nothing is cleared, nothing added where no corner-only contact exists).
		const l = bridgeCells(parseCells('#.\n##'));
		expect(rows(l)).toEqual(['3300', '3300', '3333', '3333']);
	});

	it('draws joined lettering as straight strokes', () => {
		const N = 8;
		const at = (c: Cells, x: number, y: number) => c.lv[Math.floor((y + 2) * N) * c.w + Math.floor((x + 2) * N)] > 0;
		// An X: two straight diagonals through the centre, nothing square about the crossing.
		const x = strokeCells(parseCells('#...#\n.#.#.\n..#..\n.#.#.\n#...#'), N, 2);
		expect(at(x, 2.5, 2.5)).toBe(true);
		expect(at(x, 1.5, 1.5) && at(x, 3.5, 1.5) && at(x, 1.5, 3.5)).toBe(true);
		expect(at(x, 2.5, 1.7)).toBe(false); // the notch between the upper arms
		expect(at(x, 2.5, 3.3)).toBe(false);
		// A slash of uneven stair runs: one straight stroke (its middle on the line between its end cells' centres).
		const slash = strokeCells(parseCells('....#\n...#.\n...#.\n..#..\n.#...\n.#...\n#....'), N, 2);
		for (let k = 0; k <= 10; k++) {
			const y = 0.5 + 0.6 * k;
			expect(at(slash, 4.5 - (4 / 6) * (y - 0.5), y), `slash at ${y}`).toBe(true);
		}
		// A loop that leaves and returns to one junction (an "a"'s bowl) is drawn whole.
		const a = strokeCells(parseCells('.###.\n....#\n.####\n#...#\n.####'), N, 2);
		expect(at(a, 2.5, 4.5) && at(a, 0.5, 3.5) && at(a, 2.5, 2.5)).toBe(true);
		expect(at(a, 2.5, 3.5)).toBe(false);
		// Straight cell runs stay straight: a "c"'s flat bottom and an "A"'s flat top are not pulled into points.
		const c = strokeCells(parseCells('.###.\n#....\n#....\n#...#\n.###.'), N, 2);
		for (const xx of [1.5, 2.5, 3.5]) expect(at(c, xx, 4.5), `c bottom at ${xx}`).toBe(true);
		expect(at(c, 2.5, 3.6)).toBe(false);
		const foot = strokeCells(parseCells('...#\n...#\n#..#\n.##.'), N, 2);
		expect(at(foot, 1.5, 3.5) && at(foot, 2.5, 3.5)).toBe(true); // the J's two-cell foot stays a flat bottom
		const A = strokeCells(parseCells('.###.\n#...#\n#####\n#...#'), N, 2);
		for (const xx of [1.5, 2.5, 3.5]) expect(at(A, xx, 0.5), `A top at ${xx}`).toBe(true);
		// Bold widens strokes sideways only: an "a"-like counter keeps its height.
		const ring = strokeCells(parseCells('.###.\n#...#\n.###.'), N, 2, 1);
		expect(at(ring, 2.5 + 0.5, 1.5)).toBe(false);
	});

	it('draws every glyph on a rectangle of the right height, punctuation on the baseline', () => {
		for (const [name, table] of Object.entries(GLYPH_TABLES))
			for (const [ch, g] of Object.entries(table)) {
				const rows = g.split('/');
				expect(new Set(rows.map((r) => r.length)).size, `${name} ${ch}`).toBe(1);
				expect(name.startsWith('large') ? [7, 8] : [5], `${name} ${ch} rows`).toContain(rows.length);
			}
		// The full font's "." sits on the baseline (row 7 of 7), like the dots of "!" and "?"; "," and ";" dip one row.
		const last = (t: string) => rows(textCells(t, { font: 'large' }));
		expect(last('.')[6]).toBe('3');
		expect(last('!')[6]).toBe('3');
		expect(textCells(',', { font: 'large' }).h).toBe(8);
	});

	it("draws the full font's 0 dotted and its 3 round", () => {
		expect(rows(textCells('0', { font: 'large' }))[3]).toBe('30303');
		expect(rows(textCells('3', { font: 'large' }))[0]).toBe('03330');
	});

	it('stores near-exact nearest cells of the other state', () => {
		// A ring with a hole and a diagonal: compare every cell's stored neighbour with brute force.
		const c = parseCells('.#####..\n##...##.\n#.....#.\n##...##.\n.#####.#\n.......#');
		const M = 4;
		const tex = stampTexture(c, { margin: M });
		const W = c.w + 2 * M;
		const H = c.h + 2 * M;
		const level = (x: number, y: number) =>
			x >= M && y >= M && x < M + c.w && y < M + c.h ? c.lv[(y - M) * c.w + x - M] : 0;
		const d2 = (x: number, y: number, sx: number, sy: number) =>
			Math.max(Math.abs(x - sx) - 0.5, 0) ** 2 + Math.max(Math.abs(y - sy) - 0.5, 0) ** 2;
		let worst = 0;
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const t = (y * tex.width + x) * 4;
				const inside = level(x, y) > 0;
				const nx = tex.data[t + 1] + (tex.data[t + 3] & 15) * 256;
				const ny = tex.data[t + 2] + (tex.data[t + 3] >> 4) * 256;
				expect(level(nx, ny) > 0).toBe(!inside);
				let best = Infinity;
				for (let sy = 0; sy < H; sy++)
					for (let sx = 0; sx < W; sx++) if (level(sx, sy) > 0 !== inside) best = Math.min(best, d2(x, y, sx, sy));
				worst = Math.max(worst, Math.sqrt(d2(x, y, nx, ny)) - Math.sqrt(best));
			}
		expect(worst).toBeLessThan(0.05);
		// Header: the bitmap's size, the margin, one cell per cell, exact outline.
		expect(Array.from(tex.data.subarray(H * tex.width * 4, H * tex.width * 4 + 8))).toEqual([
			c.w,
			0,
			c.h,
			0,
			M,
			0,
			1,
			0
		]);
	});

	it("keeps each map's own cells per bitmap cell in its header", () => {
		const header = (t: CpuTexture) =>
			Array.from(t.data.subarray((t.height - 1) * t.width * 4, (t.height - 1) * t.width * 4 + 8));
		const c = parseCells('####\n####\n####\n####');
		// The same cells, margin and outline, joined (pre 2) or not: two maps (one cached grid used to serve both).
		expect(header(stampTexture(c, { margin: 8, pre: 2 }))).toEqual([4, 0, 4, 0, 8, 0, 2, 0]);
		expect(header(stampTexture(c, { margin: 8, pre: 1 }))).toEqual([4, 0, 4, 0, 8, 0, 1, 0]);
		// Smoothed and strokes: on the fine grid (N cells per cell), the margin in fine cells, N × pre, smooth outline.
		expect(header(stampTexture(c, { margin: 4, smooth: 1, fine: 3, pre: 2 }))).toEqual([12, 0, 12, 0, 12, 0, 6, 1]);
		expect(header(stampTexture(c, { margin: 2, smooth: 1, fine: 4, strokes: { bold: 0 } }))).toEqual([
			16, 0, 16, 0, 8, 0, 4, 1
		]);
	});

	it('smooths the outline without losing single cells or breaking diagonal lines', () => {
		const N = 4;
		const filledFine = (c: Cells, x: number, y: number) => c.lv[(y + 2 * N) * c.w + x + 2 * N] > 0;
		// A lone cell keeps a round blob at its centre.
		const dot = smoothCells(parseCells('#'), 1, N, 2);
		expect(filledFine(dot, 2, 2)).toBe(true);
		expect(filledFine(dot, 0, 0)).toBe(false);
		// A one-cell diagonal stays connected along its length (the centres of its cells and of the joins between them).
		const diag = smoothCells(parseCells('#...\n.#..\n..#.\n...#'), 1, N, 2);
		for (let k = N / 2; k < 4 * N - N / 2; k++) expect(filledFine(diag, k, k), `fine cell ${k}`).toBe(true);
		// A symmetric drawing stays symmetric however far it is smoothed (the default warning triangle).
		const tri = parseCells(String(stampLayer.params.find((d) => d.key === 'pixels')!.default));
		for (const amount of [0.5, 1, 2, 3]) {
			const f = smoothCells(tri, amount, N, 2);
			let off = 0;
			for (let y = 0; y < f.h; y++)
				for (let x = 0; x < f.w; x++) if (f.lv[y * f.w + x] > 0 !== f.lv[y * f.w + f.w - 1 - x] > 0) off++;
			expect(off, `smooth ${amount}`).toBe(0);
		}
		// Levels follow: a two-level block keeps its inner level inside.
		const two = smoothCells(parseCells('####\n#++#\n#++#\n####'), 1, N, 2);
		expect(two.lv[(2 * N + 2 * N) * two.w + 2 * N + 2 * N]).toBe(2);
		expect(two.lv[(2 * N + 1) * two.w + 2 * N + 8]).toBe(3);
	});
});
