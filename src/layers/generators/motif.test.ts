// Truchet / Lines (FR7.2c): the CPU side — editor defaults sized to the texture, defaults that follow other params,
// the labyrinth's maze and the per-room data, and that every param reaches the shader.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, linkedChanges } from '../registry';
import { truchetCells, truchetLayer } from './motif';

/** The labyrinth's walls (bit 0: +x, bit 1: +y) of cell (x, y), from the padded cell texture. */
function walls(p: Record<string, unknown>, size: number, tileable: boolean, seed = 5) {
	const t = truchetCells({ ...createLayer('truchet').params, ...p } as never, {
		width: size,
		height: size,
		tileable,
		seed
	}).cells;
	const n = t.width - 2;
	return { n, at: (x: number, y: number) => t.data[((y + 1) * t.width + x + 1) * 4 + 2] };
}

/** Union-find over n items. */
function unionFind(n: number) {
	const parent = Array.from({ length: n }, (_, i) => i);
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
	return { find, join: (a: number, b: number) => (parent[find(a)] = find(b)) };
}

/** The wall segments (node pairs) of an n × n tiled wall grid, and the walls in each piece they join into. */
function pieceSizes(n: number, at: (x: number, y: number) => number) {
	const node = (x: number, y: number) => (((y % n) + n) % n) * n + (((x % n) + n) % n);
	const segs: [number, number][] = [];
	for (let y = 0; y < n; y++)
		for (let x = 0; x < n; x++) {
			if (at(x, y) & 1) segs.push([node(x + 1, y), node(x + 1, y + 1)]);
			if (at(x, y) & 2) segs.push([node(x, y + 1), node(x + 1, y + 1)]);
		}
	const uf = unionFind(n * n);
	for (const [a, b] of segs) uf.join(a, b);
	const size = new Map<number, number>();
	for (const [a] of segs) size.set(uf.find(a), (size.get(uf.find(a)) ?? 0) + 1);
	return { segs: segs.length, sizes: [...size.values()] };
}

/** Open passages and the cells reachable from (0, 0) through them. */
function passages(n: number, at: (x: number, y: number) => number, tile: boolean) {
	let open = 0;
	const adj: number[][] = Array.from({ length: n * n }, () => []);
	for (let y = 0; y < n; y++)
		for (let x = 0; x < n; x++)
			for (let axis = 0; axis < 2; axis++) {
				let bx = x + (axis === 0 ? 1 : 0);
				let by = y + (axis === 1 ? 1 : 0);
				if (bx >= n || by >= n) {
					if (!tile) continue;
					bx %= n;
					by %= n;
				}
				if (at(x, y) & (1 << axis)) continue;
				open++;
				adj[y * n + x].push(by * n + bx);
				adj[by * n + bx].push(y * n + x);
			}
	const seen = new Set([0]);
	const todo = [0];
	while (todo.length) for (const b of adj[todo.pop()!]) if (!seen.has(b)) (seen.add(b), todo.push(b));
	return { open, reached: seen.size };
}

describe('truchet', () => {
	ensureBuiltins();

	it('sizes a new layer’s lines to the texture', () => {
		expect(freshParams('truchet', { width: 512, height: 512 }).width).toBe(6);
		expect(freshParams('truchet', { width: 64, height: 64 }).width).toBe(1);
		expect(freshParams('truchet', { width: 2048, height: 256 }).width).toBe(3);
	});

	it('starts with the improved looks and labels Density per style', () => {
		const p = createLayer('truchet').params;
		expect(p).toMatchObject({
			width: 1,
			bevel: 1,
			pad: 1,
			cells: 8,
			draw: 'lines',
			cross: 0,
			weave: 0,
			chip_scatter: 4,
			caps: 'square',
			prune: true,
			merge: 1,
			junctions: 0.2,
			chip_style: 'ic',
			key_style: 'running',
			empty: 0.25,
			wide: 0.12
		});
		const density = truchetLayer.params.filter((d) => d.key === 'density');
		expect(density).toHaveLength(1);
		expect(density[0].labelFor!({ ...p, style: 'labyrinth' })).toBe('Perfection');
		expect(density[0].labelFor!({ ...p, style: 'arcs' })).toBe('Tiles drawn');
	});

	it('lets bevel and pads follow the line width, and cells the style, until set by hand', () => {
		const base = createLayer('truchet').params;
		expect(linkedChanges('truchet', base, 'width', 6)).toEqual({ width: 6, bevel: 3, pad: 6 });
		expect(linkedChanges('truchet', { ...base, bevel: 2 }, 'width', 6)).toEqual({ width: 6, pad: 6 });
		expect(linkedChanges('truchet', base, 'style', 'circuit')).toEqual({ style: 'circuit', cells: 32 });
		expect(linkedChanges('truchet', { ...base, cells: 20 }, 'style', 'circuit')).toEqual({ style: 'circuit' });
	});

	it('builds the labyrinth as a perfect maze, wrapping or framed', () => {
		for (const tile of [true, false]) {
			const { n, at } = walls({ style: 'labyrinth', cells: 16 }, 256, tile);
			expect(n).toBe(16);
			const { open, reached } = passages(n, at, tile);
			// A spanning tree: every cell reachable, one passage fewer than cells (no loops).
			expect(reached, `tile ${tile}`).toBe(n * n);
			expect(open, `tile ${tile}`).toBe(n * n - 1);
		}
		// Untiled, a frame closes it: the right column's +x walls and the bottom row's +y walls stay shut.
		const { n, at } = walls({ style: 'labyrinth', cells: 16 }, 256, false);
		for (let i = 0; i < n; i++) {
			expect(at(n - 1, i) & 1).toBe(1);
			expect(at(i, n - 1) & 2).toBe(2);
		}
	});

	it('opens dead ends into loops below density 1, and differs by seed', () => {
		const perfect = passages(
			...(Object.values(walls({ style: 'labyrinth', cells: 16 }, 256, true)) as [
				number,
				(x: number, y: number) => number
			]),
			true
		);
		const braided = passages(
			...(Object.values(walls({ style: 'labyrinth', cells: 16, density: 0.3 }, 256, true)) as [
				number,
				(x: number, y: number) => number
			]),
			true
		);
		expect(braided.open).toBeGreaterThan(perfect.open + 60);
		const a = walls({ style: 'labyrinth', cells: 16 }, 256, true, 5);
		const b = walls({ style: 'labyrinth', cells: 16 }, 256, true, 6);
		let differ = 0;
		for (let i = 0; i < 256; i++) if (a.at(i % 16, i >> 4) !== b.at(i % 16, i >> 4)) differ++;
		expect(differ).toBeGreaterThan(50);
	});

	it('keeps the labyrinth’s corridors short of the texture and drops floating fragments when opened', () => {
		for (const twist of [0, 0.3]) {
			const { n, at } = walls({ style: 'labyrinth', cells: 32, twist }, 512, true);
			// Longest run of one wall line (a corridor side) along x: well under the texture's width.
			let longest = 0;
			for (let y = 0; y < n; y++) {
				let run = 0;
				for (let x = 0; x < 2 * n; x++) longest = Math.max(longest, (run = at(x % n, y) & 2 ? run + 1 : 0));
			}
			expect(longest, `twist ${twist}`).toBeLessThan(n / 2);
		}
		// Opened (density 0.35): no wall piece of fewer than five segments floats free.
		const { n, at } = walls({ style: 'labyrinth', cells: 16, density: 0.35 }, 256, true);
		expect(Math.min(...pieceSizes(n, at).sizes)).toBeGreaterThanOrEqual(5);
	});

	it('merges rooms into bigger ones with walls only between rooms, wrapping or not', () => {
		const p = { ...createLayer('truchet').params, style: 'rooms', cells: 16 };
		// Untiled, the border cells (−1, 16) are rooms too: the cell past the last one is read as is.
		const rooms = (merge: number, tileable = true) => {
			const t = truchetCells({ ...p, merge }, { width: 256, height: 256, tileable, seed: 3 }).cells;
			const wrap = (v: number) => (tileable ? ((v % 16) + 16) % 16 : v);
			const id = (x: number, y: number) => {
				const i = (wrap(y) + 1) * t.width + wrap(x) + 1;
				return t.data[i * 4] * 256 + t.data[i * 4 + 1];
			};
			let wallsBetween = true;
			for (let y = 0; y < 16; y++)
				for (let x = 0; x < 16; x++) {
					const bits = t.data[((y + 1) * t.width + x + 1) * 4 + 2];
					if (((bits & 1) !== 0) !== (id(x, y) !== id(x + 1, y))) wallsBetween = false;
					if (((bits & 2) !== 0) !== (id(x, y) !== id(x, y + 1))) wallsBetween = false;
				}
			const ids = new Set<number>();
			for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) ids.add(id(x, y));
			return { count: ids.size, wallsBetween };
		};
		const one = rooms(1);
		const three = rooms(3);
		expect(one.wallsBetween && three.wallsBetween).toBe(true);
		expect(three.count).toBeLessThan(one.count / 2);
		expect(rooms(1, false).wallsBetween && rooms(3, false).wallsBetween).toBe(true);
	});

	it('lays circuits out without closed loops on the CPU', () => {
		const tex = { width: 512, height: 512, tileable: true, seed: 9 };
		const base = { ...createLayer('truchet').params, style: 'circuit', cells: 32 };
		// Tile graph of the CPU layout (each tile its +x / +y edges), cycles counted by union-find.
		const cycles = (p: Record<string, unknown>) => {
			const t = truchetCells({ ...base, ...p } as never, tex).cells;
			const n = t.width - 2;
			const { find, join } = unionFind(n * n);
			let edges = 0;
			let loops = 0;
			for (let y = 0; y < n; y++)
				for (let x = 0; x < n; x++) {
					const bits = t.data[((y + 1) * t.width + x + 1) * 4 + 2];
					for (const [axis, bx, by] of [
						[0, (x + 1) % n, y],
						[1, x, (y + 1) % n]
					]) {
						if (!(bits & (1 << axis))) continue;
						edges++;
						const a = find(y * n + x);
						const b = find(by * n + bx);
						if (a === b) loops++;
						else join(a, b);
					}
				}
			return { edges, loops };
		};
		// Routed (no regions): traces never meet, so no cycle at all, wrapping or not.
		const routed = cycles({ regions: 0, chips: 0 });
		expect(routed.edges).toBeGreaterThan(200);
		expect(routed.loops).toBe(0);
		// Buses with chips: loops through the chips' pins are broken; only buses wrapping round the torus may close.
		const buses = cycles({ regions: 6, chips: 0.8, chip_scatter: 2 });
		expect(buses.edges).toBeGreaterThan(200);
		expect(buses.loops).toBeLessThanOrEqual(2);
		// Empty board leaves blobs without traces.
		expect(cycles({ regions: 0, chips: 0, empty: 0.5 }).edges).toBeLessThan(routed.edges * 0.8);
	});

	it('drops maze wall pieces under five walls', () => {
		const t = truchetCells(
			{ ...createLayer('truchet').params, style: 'maze', cells: 16, prune: true, density: 0.85 } as never,
			{ width: 256, height: 256, tileable: true, seed: 4 }
		).cells;
		const { segs, sizes } = pieceSizes(16, (x, y) => t.data[((y + 1) * t.width + x + 1) * 4 + 2]);
		expect(segs).toBeGreaterThan(40);
		expect(Math.min(...sizes)).toBeGreaterThanOrEqual(5);
	});

	it('computes per-cell data for the styles laid out on the CPU, a random per room', () => {
		const tex = { width: 256, height: 256, tileable: true, seed: 3 };
		const p = createLayer('truchet').params;
		expect(truchetCells({ ...p, style: 'arcs' }, tex).cells.width).toBe(1);
		for (const style of ['maze', 'rooms', 'labyrinth', 'circuit'])
			expect(truchetCells({ ...p, style }, tex).cells.width, style).toBe(10);
		// Rooms: a random per room, so some neighbouring cells share theirs.
		const t = truchetCells({ ...p, style: 'rooms' }, tex).cells;
		let shared = 0;
		for (let y = 1; y <= 8; y++)
			for (let x = 1; x < 8; x++) {
				const i = (y * 10 + x) * 4;
				if (t.data[i] === t.data[i + 4] && t.data[i + 1] === t.data[i + 5]) shared++;
			}
		expect(shared).toBeGreaterThan(10);
	});
});
