import { describe, expect, it } from 'vitest';
import { FONT, MAX_PATH_POINTS, packPolygons, parseBitmap, parsePolygons, takePolygons } from './bitmap';

describe('parseBitmap', () => {
	it('maps cell characters to levels and trims blank edge rows', () => {
		const b = parseBitmap('\n#+-.\n 1 2\n\n', 64);
		expect(b.width).toBe(4);
		expect(b.height).toBe(2);
		expect([...b.levels]).toEqual([3, 2, 1, 0, 0, 1, 0, 2]);
	});

	it('caps at max × max', () => {
		const b = parseBitmap(Array.from({ length: 80 }, () => '#'.repeat(80)).join('\n'), 64);
		expect(b.width).toBe(64);
		expect(b.height).toBe(64);
	});
});

describe('polygons', () => {
	it('parses vertex pairs per line and links each vertex to the next in its polygon', () => {
		const polys = parsePolygons('0,0 10,0 10,10\n20,20, 30,20 30,30 20,30');
		expect(polys).toEqual([
			[
				[0, 0],
				[10, 0],
				[10, 10]
			],
			[
				[20, 20],
				[30, 20],
				[30, 30],
				[20, 30]
			]
		]);
		const { data, count, polygons } = packPolygons(polys);
		expect(count).toBe(7);
		expect(polygons).toBe(2);
		expect([...data.slice(0, 4)]).toEqual([0, 0, 1, 0]);
		expect(data[2 * 4 + 2]).toBe(0); // last vertex of polygon 0 closes back to vertex 0
		expect(data[6 * 4 + 2]).toBe(3); // last vertex of polygon 1 closes back to vertex 3
		expect(data[6 * 4 + 3]).toBe(1);
	});

	it('drops degenerate polygons and accepts negative / decimal coordinates', () => {
		expect(parsePolygons('1,2 3,4 | -5.5,0 4,0 0,7.25')).toEqual([
			[
				[-5.5, 0],
				[4, 0],
				[0, 7.25]
			]
		]);
	});
});

describe('font', () => {
	it('draws every glyph on five rows (the period used to have six and lost its dot)', () => {
		for (const [ch, g] of Object.entries(FONT)) {
			const rows = g.split('/');
			expect(rows.length, ch).toBe(5);
			expect(new Set(rows.map((r) => r.length)).size, `${ch} is rectangular`).toBe(1);
			if (ch !== ' ') expect(g.includes('#'), `${ch} has cells`).toBe(true);
		}
	});
});

describe('takePolygons', () => {
	it('keeps the polygons before the first that would pass the vertex limit', () => {
		const tri = [
			[0, 0],
			[1, 0],
			[0, 1]
		];
		const big = Array.from({ length: MAX_PATH_POINTS - 2 }, (_, i) => [i, i % 2]);
		expect(takePolygons([big.slice(2), tri, tri]).length).toBe(2);
		// The last triangle would fit, but the polygons stay in order.
		expect(takePolygons([tri, big, tri]).length).toBe(1);
		expect(packPolygons([tri, big, tri]).polygons).toBe(1);
	});
});
