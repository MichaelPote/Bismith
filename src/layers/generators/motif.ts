// Motif & ornament generators (FR7.2c, docs/features/fr7.2c-motif-generators.md): tile-based line networks
// (truchet arcs, 10-PRINT diagonals, mazes, polyomino rooms, Greek-key meanders, circuit traces) in this file,
// radial rosettes and procedural glyphs / sigils in motifRadial.ts. All are SDF generators (distance in px,
// negative inside) so the common bevel / etch / emissive machinery applies; every lattice wraps when the
// project is tileable.

import { hash3I, hashI, mulberry32, pcg, pcg3, u2f, unionFind } from '@/core/hash';
import { memoReads } from '@/core/memo';
import { P, round1 as r1, type ParamValues } from '@/core/params';
import type { CpuTexture, LayerDef } from '../types';
import { GLSL_MOT_COMMON, MOTIF_DEFAULTS } from './motifCommon';
import { glyphLayer, rosetteLayer } from './motifRadial';

// ------------------------------------------------------------------------------------------------ truchet

const STYLES: [string, string][] = [
	['arcs', 'Truchet arcs'],
	['diagonal', 'Diagonal (10 PRINT)'],
	['maze', 'Maze walls (random)'],
	['rooms', 'Rooms (polyomino walls)'],
	['meander', 'Greek key / meander'],
	['circuit', 'Circuit traces'],
	['labyrinth', 'Labyrinth (perfect maze)']
];

const DRAW: [string, string, string][] = [
	['lines', 'Lines', 'the lines are the shape (raised wires, inlay)'],
	[
		'grooves',
		'Grooves',
		'everything but the lines: the lines are cut into a solid surface (on Rooms, each slab gets a random value for per-feature height and random colour)'
	],
	[
		'tone',
		'Two-tone',
		'on Truchet arcs, fills every other region between the lines (the classic two-colour Truchet), with the lines as the gaps; other styles draw as Grooves'
	],
	['tone2', 'Two-tone, swapped', 'like Two-tone, but fills the other regions']
];

/** Density's label per style (it means something different in each). */
const DENSITY_LABEL: Record<string, string> = {
	arcs: 'Tiles drawn',
	diagonal: 'Tiles drawn',
	maze: 'Walls',
	rooms: 'Room size',
	labyrinth: 'Perfection'
};

/** Cells across each style starts with (linked: they follow the style until set by hand). */
const STYLE_CELLS: Record<string, number> = {
	arcs: 8,
	diagonal: 12,
	maze: 12,
	rooms: 8,
	meander: 15,
	circuit: 32,
	labyrinth: 16
};

const isStyle =
	(...s: string[]) =>
	(p: Record<string, unknown>) =>
		s.includes(String(p.style));
const isTone = (p: Record<string, unknown>) => p.style === 'arcs' && String(p.draw).startsWith('tone');

// ---- CPU side (cpuData): the layouts that need the whole grid — the maze's, rooms' and labyrinth's walls with a
// random per room (per cell for the maze and labyrinth), and the circuit's traces, chips and vias. Texture of
// (cells + 2)² texels, cell c at c + 1 (the border cells of an untiled project included). Walls: R, G = the random
// (16 bits), B = walls (bit 0 the cell's +x wall, bit 1 its +y wall). Circuit: see circuitTiles. The hashes are the
// shaders' (core/hash.ts), but nothing on the GPU redraws them: they only need to be deterministic.

/** The shader's cell counts (mot_cellCount without the meander's rounding, which these styles don't use). */
function cellCount(p: ParamValues, w: number, h: number): [number, number] {
	const nx = Math.max(1, Math.round(Number(p.cells ?? 8)));
	const ny = Number(p.cells_y ?? 0) > 0 ? Number(p.cells_y) : (nx * h) / w;
	return [nx, Math.max(1, Math.floor(ny + 0.5))];
}

const D4 = [
	[1, 0],
	[0, 1],
	[-1, 0],
	[0, -1]
];
const NODE_CELL = [
	[0, -1],
	[-1, 0],
	[-1, -1],
	[-1, -1]
];
const NODE_AXIS = [1, 0, 1, 0];

/** The CPU-side layouts' random stream, seeded from the layer's seed. */
const prng = (seed: number) => mulberry32(seed * 2654435761 + 0x6d2b79f5);

/**
 * The padded grid a layout walks: cells lo … hiX / hiY — 0 … n − 1 wrapping round when tiling, else `below` cells
 * before the texture's and `above` after it (the border cells) — and idx, a cell's texel in the (n + 2)² texture (cell c
 * at c + 1).
 */
function padGrid(nx: number, ny: number, tile: boolean, below = 1, above = below) {
	const W = nx + 2;
	const lo = tile ? 0 : -below;
	const hiX = tile ? nx - 1 : nx - 1 + above;
	const hiY = tile ? ny - 1 : ny - 1 + above;
	const wrap = (x: number, n: number) => (tile ? ((x % n) + n) % n : x);
	return {
		W,
		H: ny + 2,
		lo,
		hiX,
		hiY,
		wrap,
		inside: (x: number, y: number) => tile || (x >= lo && x <= hiX && y >= lo && y <= hiY),
		idx: (x: number, y: number) => (wrap(y, ny) + 1) * W + wrap(x, nx) + 1
	};
}

/**
 * Floating wall fragments: union-find over the lattice nodes the segments (node pairs) join; a segment is kept when its
 * piece has at least `min` segments. `glue` joins nodes without counting as segments, and the piece holding node
 * `keepNode` always stays (the labyrinth's frame).
 */
function bigPieces(segs: [number, number][], nNodes: number, min = 5, glue: [number, number][] = [], keepNode = -1) {
	const uf = unionFind(nNodes);
	for (const [a, b] of glue) uf.join(a, b);
	for (const [a, b] of segs) uf.join(a, b);
	const size = new Map<number, number>();
	const roots = segs.map(([a]) => uf.find(a));
	for (const r of roots) size.set(r, (size.get(r) ?? 0) + 1);
	const keep = keepNode >= 0 ? uf.find(keepNode) : -1;
	return roots.map((r) => r === keep || size.get(r)! >= min);
}

/** A random 0..1 as 16 bits: the two bytes of the texel's R, G (mot_rnd16 reads them back). */
function rnd16(v: number): [number, number] {
	const r = Math.min(65535, Math.floor(v * 65536));
	return [r >> 8, r & 255];
}

/**
 * Rooms: every cell links to one random neighbour (a 0.6 × Room size chance; beyond about 0.6 stubby dead-end walls
 * appear); a wall stands between cells that aren't linked, unless it would be the only wall at either of its end
 * nodes, so the walls close into a net of small polyominoes. Union-find joins the cells of each room, and Merge
 * (0–3) then joins neighbouring rooms: each pass pairs rooms with a random neighbour (a room joins at most once a
 * pass), the last pass with the fractional chance. Returns per padded cell the room's random and the walls between
 * different rooms (bit 0 +x, bit 1 +y: no stubs inside a room).
 */
function roomCells(
	p: ParamValues,
	nx: number,
	ny: number,
	tile: boolean,
	seed: number
): { rnd: Float32Array; walls: Uint8Array } {
	const thr = 0.6 * Number(p.density ?? 1);
	const ls = (seed + 3) >>> 0;
	const { W, H, lo, hiX, hiY, wrap, idx } = padGrid(nx, ny, tile);
	// Each cell's link (cells −8 … n + 7: the walls look up to three cells out), drawn once; −2 = not yet.
	const linkCache = new Int8Array((nx + 16) * (ny + 16)).fill(-2);
	const link = (x: number, y: number) => {
		x = wrap(x, nx);
		y = wrap(y, ny);
		const key = (y + 8) * (nx + 16) + x + 8;
		let v = linkCache[key];
		if (v === -2) {
			const h = pcg3(x >>> 0, y >>> 0, ls);
			v = linkCache[key] = u2f(h) < thr ? Math.floor(u2f(pcg(h)) * 4) : -1;
		}
		return v;
	};
	const linked = (x: number, y: number, axis: number) =>
		link(x, y) === axis || link(x + D4[axis][0], y + D4[axis][1]) === axis + 2;
	const nodeOpen = (x: number, y: number, dir: number) =>
		linked(x + NODE_CELL[dir][0], y + NODE_CELL[dir][1], NODE_AXIS[dir]);
	const lonely = (x: number, y: number, dir: number) => [1, 2, 3].every((k) => nodeOpen(x, y, (dir + k) % 4));
	const wall = (x: number, y: number, axis: number) => {
		if (linked(x, y, axis)) return false;
		const da = axis === 0 ? 1 : 0;
		return !lonely(x + (axis === 0 ? 1 : 0), y + (axis === 0 ? 0 : 1), da) && !lonely(x + 1, y + 1, da + 2);
	};
	const uf = unionFind(W * H);
	// Cells -1 … n (untiled: the border cells too), or 0 … n − 1 wrapping round; the edges between them.
	const edges: [number, number, number][] = []; // cell, neighbour (padded indices), axis
	for (let y = lo; y <= hiY; y++)
		for (let x = lo; x <= hiX; x++)
			for (let axis = 0; axis < 2; axis++) {
				let bx = x + D4[axis][0];
				let by = y + D4[axis][1];
				if (tile) {
					bx = wrap(bx, nx);
					by = wrap(by, ny);
				} else if (bx > hiX || by > hiY) continue;
				const a = idx(x, y);
				const b = idx(bx, by);
				edges.push([a, b, axis]);
				if (!wall(x, y, axis)) uf.join(a, b);
			}
	const merge = Math.min(3, Math.max(0, Number(p.merge ?? 1)));
	const rand = prng(seed + 29);
	for (let pass = 0; pass < Math.ceil(merge); pass++) {
		const chance = Math.min(1, merge - pass);
		for (let i = edges.length - 1; i > 0; i--) {
			const j = Math.floor(rand() * (i + 1));
			[edges[i], edges[j]] = [edges[j], edges[i]];
		}
		const joined = new Set<number>();
		for (const [a, b] of edges) {
			const ra = uf.find(a);
			const rb = uf.find(b);
			if (ra === rb || joined.has(ra) || joined.has(rb) || rand() >= chance) continue;
			uf.join(ra, rb);
			joined.add(uf.find(ra));
		}
	}
	const walls = new Uint8Array(W * H);
	for (const [a, b, axis] of edges) if (uf.find(a) !== uf.find(b)) walls[a] |= 1 << axis;
	const rnd = new Float32Array(W * H);
	for (let i = 0; i < W * H; i++) rnd[i] = u2f(pcg3(uf.find(i), 7, (seed + 17) >>> 0));
	return { rnd, walls };
}

/**
 * Labyrinth: a perfect maze (one path between any two cells) grown from a random cell — mostly depth-first (long
 * winding corridors), now and then from a random open cell (branches everywhere, no region left to one corridor) —
 * wrapping round when tiling, else framed. Twist: chance each step turns; a straight run never passes 2 + 6 · (1 −
 * twist) cells, so no corridor spans the texture. Density below 1 opens dead ends into loops (all of them at 0.5),
 * below 0.5 also knocks out walls at random (half of them at 0); wall fragments of fewer than five segments left
 * floating are then dropped. Returns the wall bits of the padded grid.
 */
function labyrinthWalls(p: ParamValues, nx: number, ny: number, tile: boolean, seed: number): Uint8Array {
	const rand = prng(seed);
	const twist = Math.min(1, Math.max(0, Number(p.twist ?? 0.5)));
	const maxRun = 2 + Math.round(6 * (1 - twist));
	const density = Math.min(1, Math.max(0, Number(p.density ?? 1)));
	const braid = Math.min(1, 2 * (1 - density));
	const knock = Math.max(0, 0.5 - density);
	const n = nx * ny;
	const walls = new Uint8Array(n).fill(3);
	const step = (c: number, d: number) => {
		let x = (c % nx) + D4[d][0];
		let y = Math.floor(c / nx) + D4[d][1];
		if (tile) {
			x = (x + nx) % nx;
			y = (y + ny) % ny;
		} else if (x < 0 || y < 0 || x >= nx || y >= ny) return -1;
		return y * nx + x;
	};
	const shut = (c: number, d: number) => {
		const b = step(c, d);
		return b >= 0 && (d < 2 ? walls[c] & (1 << d) : walls[b] & (1 << (d - 2))) !== 0;
	};
	// Open the wall between c and its neighbour in direction d (a cell holds its +x and +y walls).
	const open = (c: number, d: number) => {
		const b = step(c, d);
		if (d < 2) walls[c] &= ~(1 << d);
		else walls[b] &= ~(1 << (d - 2));
	};
	const seen = new Uint8Array(n);
	const from = new Int8Array(n);
	const run = new Uint8Array(n);
	const active = [Math.floor(rand() * n)];
	seen[active[0]] = 1;
	from[active[0]] = Math.floor(rand() * 4);
	const free: number[] = [];
	while (active.length) {
		const ai = rand() < 0.85 ? active.length - 1 : Math.floor(rand() * active.length);
		const c = active[ai];
		free.length = 0;
		for (let d = 0; d < 4; d++) {
			const b = step(c, d);
			if (b >= 0 && !seen[b]) free.push(d);
		}
		if (!free.length) {
			active[ai] = active[active.length - 1];
			active.pop();
			continue;
		}
		const straight = free.includes(from[c]);
		const turns = straight && run[c] >= maxRun && free.length > 1 ? free.filter((d) => d !== from[c]) : free;
		const d = straight && run[c] < maxRun && rand() >= twist ? from[c] : turns[Math.floor(rand() * turns.length)];
		const b = step(c, d);
		open(c, d);
		seen[b] = 1;
		from[b] = d;
		run[b] = d === from[c] ? run[c] + 1 : 1;
		active.push(b);
	}
	if (braid > 0) {
		for (let c = 0; c < n; c++) {
			const closed: number[] = [];
			let sides = 0;
			for (let d = 0; d < 4; d++) {
				if (step(c, d) < 0) continue;
				sides++;
				if (shut(c, d)) closed.push(d);
			}
			// A dead end has one open side: every other side with a neighbour is shut.
			if (closed.length === sides - 1 && closed.length && rand() < braid)
				open(c, closed[Math.floor(rand() * closed.length)]);
		}
	}
	if (knock > 0) for (let c = 0; c < n; c++) for (let d = 0; d < 2; d++) if (shut(c, d) && rand() < knock) open(c, d);
	if (density < 1) {
		// Floating fragments, over the lattice nodes (untiled, the frame is one big piece that stays).
		const NX = tile ? nx : nx + 1;
		const NY = tile ? ny : ny + 1;
		const node = (x: number, y: number) => (tile ? (y % ny) * nx + (x % nx) : y * NX + x);
		const frame: [number, number][] = [];
		if (!tile) {
			for (let x = 0; x < NX - 1; x++) frame.push([node(x, 0), node(x + 1, 0)], [node(x, NY - 1), node(x + 1, NY - 1)]);
			for (let y = 0; y < NY - 1; y++) frame.push([node(0, y), node(0, y + 1)], [node(NX - 1, y), node(NX - 1, y + 1)]);
		}
		const segs: [number, number][] = [];
		const wallAt: number[] = []; // 2 · cell + axis
		for (let c = 0; c < n; c++)
			for (let d = 0; d < 2; d++) {
				if (!(walls[c] & (1 << d))) continue;
				const x = c % nx;
				const y = Math.floor(c / nx);
				segs.push(d === 0 ? [node(x + 1, y), node(x + 1, y + 1)] : [node(x, y + 1), node(x + 1, y + 1)]);
				wallAt.push(2 * c + d);
			}
		const keep = bigPieces(segs, NX * NY, 5, frame, tile ? -1 : node(0, 0));
		wallAt.forEach((w, i) => keep[i] || (walls[w >> 1] &= ~(1 << (w & 1))));
	}
	// Padded. Untiled, the last column's +x and the last row's +y walls stay shut (no neighbour); the frame's other two
	// sides are the +x walls of the column left of the maze and the +y walls of the row above it.
	const W = nx + 2;
	const out = new Uint8Array(W * (ny + 2));
	for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) out[(y + 1) * W + x + 1] = walls[y * nx + x];
	if (!tile) {
		for (let y = 0; y < ny; y++) out[(y + 1) * W] |= 1;
		for (let x = 0; x < nx; x++) out[x + 1] |= 2;
	}
	return out;
}

/**
 * Maze walls: each lattice node grows a wall to a random neighbour (a Walls share of the nodes). With Drop
 * fragments, union-find over the nodes gathers them into pieces and pieces of fewer than five walls are dropped.
 * Returns them as cell walls (bit 0 the cell's +x wall, bit 1 its +y wall) of the padded grid.
 */
function mazeWalls(p: ParamValues, nx: number, ny: number, tile: boolean, seed: number): Uint8Array {
	const density = Number(p.density ?? 1);
	const prune = p.prune !== false;
	// Nodes −2 … n + 2 when untiled (beyond the padded grid's walls), 0 … n − 1 wrapping when tiled.
	const { W, H, lo, hiX, hiY, wrap, inside, idx } = padGrid(nx, ny, tile, 2, 3);
	const NW = hiX - lo + 1;
	const NN = NW * (hiY - lo + 1);
	const node = (x: number, y: number) => (wrap(y, ny) - lo) * NW + wrap(x, nx) - lo;
	const walls = new Map<number, [number, number, number, number]>(); // by node pair: two nodes may grow the same wall
	for (let y = lo; y <= hiY; y++)
		for (let x = lo; x <= hiX; x++) {
			const h = hash3I(wrap(x, nx), wrap(y, ny), seed + 3);
			const k = Math.floor(h[1] * 4);
			if (!(h[0] < density) || k > 3) continue;
			const bx = x + D4[k][0];
			const by = y + D4[k][1];
			if (!inside(bx, by)) continue;
			const a = node(x, y);
			const b = node(bx, by);
			walls.set(Math.min(a, b) * NN + Math.max(a, b), [x, y, bx, by]);
		}
	const list = [...walls.values()];
	const keep = prune
		? bigPieces(
				list.map(([x, y, bx, by]) => [node(x, y), node(bx, by)]),
				NN
			)
		: null;
	const out = new Uint8Array(W * H);
	const cellBit = (cx: number, cy: number, bit: number) => {
		if (tile || (cx >= -1 && cy >= -1 && cx <= nx && cy <= ny)) out[idx(cx, cy)] |= bit;
	};
	list.forEach(([x, y, bx, by], i) => {
		if (keep && !keep[i]) return;
		// Horizontal (a, b)–(a + 1, b): cell (a, b − 1)'s +y wall; vertical (a, b)–(a, b + 1): cell (a − 1, b)'s +x wall.
		if (y === by) cellBit(Math.min(x, bx), y - 1, 2);
		else cellBit(x - 1, Math.min(y, by), 1);
	});
	return out;
}

/** The sides (bits R U L D) each bus direction (none, then 0–3) wants on even / odd tiles. */
const WANT = [15, 15, 5, 5, 10, 10, 6, 9, 12, 3];

/**
 * The circuit board. Tiles are centred on lattice nodes; a trace crosses a tile edge at its midpoint.
 *
 * - Bus regions: a coarse, tileable Voronoi gives each tile a bus direction (horizontal, vertical or one of the two
 *   diagonals); an edge carries a trace when both its tiles want it (WANT) and a Trace density draw passes, so
 *   traces run in parallel buses that bend together at 45°. Diagonal buses use one chamfer pair per tile,
 *   alternating with tile parity, so their lines run every other diagonal (the straight buses' pitch at 45°).
 *   Closed loops are then broken, at their junctions first so the runs stay whole; a bus wrapping round a tiled
 *   texture is no loop on the board (a union-find with each tile's unwrapped offset from its root tells them apart).
 * - No regions: routed traces — walks that never touch another trace (no junctions, no loops), mostly straight,
 *   continuing across each edge with the Trace density chance, starting from the chip pins, until about 60 % of the
 *   free board is covered.
 * - Chips of S tiles sit in blocks of S + 2 + scatter tiles, at a random place at least a tile in; 85 % of their
 *   outline sides get a pin edge. Empty board: value-noise blobs without traces. Wide traces: whole traces of six or
 *   more tiles, not to a chip. Lone vias: on a 0.3 × Vias share of the free tiles outside the blobs.
 *
 * Per padded tile: R, G = the trace's random (16 bits: per connected trace, a chip with its traces); B = bit 0 the
 * +x edge, bit 1 the +y edge, bit 2 wide, bit 3 a lone via, bits 4–6 the bus direction + 1, bit 7 chip; A = the
 * tile's place in its chip (x | y << 4).
 */
function circuitTiles(p: ParamValues, nx: number, ny: number, tile: boolean, seed: number): Uint8Array {
	const { W, H, lo, hiX, hiY, wrap, inside, idx } = padGrid(nx, ny, tile);
	// Chips: the chip of each tile (−1 none), and the tile's place in it.
	const S = [
		Math.min(16, Math.max(1, Math.round(Number(p.chip_w ?? 2)))),
		Math.min(16, Math.max(1, Math.round(Number(p.chip_h ?? 2))))
	];
	const sc = Math.min(32, Math.max(0, Math.round(Number(p.chip_scatter ?? 4))));
	const B = [S[0] + 2 + sc, S[1] + 2 + sc];
	const chips = Number(p.chips ?? 0);
	const place = new Uint8Array(W * H);
	const chip = new Int32Array(W * H).fill(-1);
	if (chips > 0)
		for (let y = lo; y <= hiY; y++)
			for (let x = lo; x <= hiX; x++) {
				const tx = wrap(x, nx);
				const ty = wrap(y, ny);
				const m = [Math.floor(tx / B[0]), Math.floor(ty / B[1])];
				const h = hash3I(m[0], m[1], seed + 71);
				if ((tile && ((m[0] + 1) * B[0] > nx || (m[1] + 1) * B[1] > ny)) || h[0] >= chips) continue;
				const ox = m[0] * B[0] + 1 + Math.min(Math.floor(h[1] * (sc + 1)), sc) - tx;
				const oy = m[1] * B[1] + 1 + Math.min(Math.floor(h[2] * (sc + 1)), sc) - ty;
				if (!(ox <= 0 && oy <= 0 && ox + S[0] > 0 && oy + S[1] > 0)) continue;
				place[idx(x, y)] = -ox | (-oy << 4);
				chip[idx(x, y)] = (m[1] * 4096 + m[0]) & 0xffffff;
			}
	// Empty board: blobs of value noise over a coarse grid (about six tiles a cell), the given share of the tiles.
	const empty = new Uint8Array(W * H);
	const share = Math.min(0.9, Math.max(0, Number(p.empty ?? 0.25)));
	const rand = prng(seed + 53);
	if (share > 0) {
		const cx = Math.max(2, Math.round(nx / 6));
		const cy = Math.max(2, Math.round(ny / 6));
		const g = Array.from({ length: (cx + 1) * (cy + 1) }, () => rand());
		if (tile)
			for (let i = 0; i <= cx; i++)
				for (let j = 0; j <= cy; j++) g[j * (cx + 1) + i] = g[(j % cy) * (cx + 1) + (i % cx)];
		const sm = (t: number) => t * t * (3 - 2 * t);
		const val: [number, number][] = [];
		for (let y = lo; y <= hiY; y++)
			for (let x = lo; x <= hiX; x++) {
				const u = ((Math.min(Math.max(x, 0), nx - 1) + 0.5) / nx) * cx;
				const v = ((Math.min(Math.max(y, 0), ny - 1) + 0.5) / ny) * cy;
				const i = Math.floor(u);
				const j = Math.floor(v);
				const a = sm(u - i);
				const b = sm(v - j);
				const at = (di: number, dj: number) => g[Math.min(j + dj, cy) * (cx + 1) + Math.min(i + di, cx)];
				val.push([idx(x, y), (at(0, 0) * (1 - a) + at(1, 0) * a) * (1 - b) + (at(0, 1) * (1 - a) + at(1, 1) * a) * b]);
			}
		const sorted = val.map((v) => v[1]).sort((a, b) => a - b);
		const thr = sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
		for (const [i, v] of val) if (v < thr && chip[i] < 0) empty[i] = 1;
	}
	const out = new Uint8Array(W * H);
	const setEdge = (x: number, y: number, d: number) => {
		// d: 0 R, 1 U, 2 L, 3 D — stored on the tile whose +x / +y edge it is.
		if (d < 2) out[idx(x, y)] |= 1 << d;
		else out[idx(x + D4[d][0], y + D4[d][1])] |= 1 << (d - 2);
	};
	const regions = Number(p.regions ?? 6);
	const traces = Number(p.traces ?? 0.85);
	const uf = unionFind(W * H);
	// A chip is one node: traces between two of its pins would close a loop through it.
	const chipRoot = new Map<number, number>();
	for (let i = 0; i < W * H; i++) {
		if (chip[i] < 0) continue;
		const r = chipRoot.get(chip[i]);
		if (r === undefined) chipRoot.set(chip[i], i);
		else uf.join(i, r);
	}
	const dir = new Int8Array(W * H).fill(-1);
	if (regions > 0) {
		// Bus directions from the regions' Voronoi (the nearest site's random picks the direction), then the edges.
		const bend = Number(p.bend ?? 0.5);
		const cnt = [Math.max(1, Math.floor(nx / regions + 0.5)), Math.max(1, Math.floor(ny / regions + 0.5))];
		const dirOf = (x: number, y: number) => {
			const X = [((x + 0.5) / nx) * cnt[0], ((y + 0.5) / ny) * cnt[1]];
			const ip = [Math.floor(X[0]), Math.floor(X[1])];
			let best = 1e9;
			let rnd = 0;
			for (let j = -1; j <= 1; j++)
				for (let i = -1; i <= 1; i++) {
					const gx = tile ? (((ip[0] + i) % cnt[0]) + cnt[0]) % cnt[0] : ip[0] + i;
					const gy = tile ? (((ip[1] + j) % cnt[1]) + cnt[1]) % cnt[1] : ip[1] + j;
					const hh = pcg3(gx >>> 0, gy >>> 0, (seed + 31) >>> 0);
					const rx = ip[0] + i + 0.5 + (u2f(hh) - 0.5) * 0.9 - X[0];
					const ry = ip[1] + j + 0.5 + (u2f(pcg(hh)) - 0.5) * 0.9 - X[1];
					const d = rx * rx + ry * ry;
					if (d < best) {
						best = d;
						rnd = hashI(gx, gy, seed + 37);
					}
				}
			if (rnd < bend) return rnd < 0.5 * bend ? 2 : 3;
			return rnd - bend < 0.5 * (1 - bend) ? 0 : 1;
		};
		const wants = (dir: number, x: number, y: number, side: number) =>
			((WANT[(dir + 1) * 2 + ((x + y) & 1)] >> side) & 1) !== 0;
		for (let y = lo; y <= hiY; y++) for (let x = lo; x <= hiX; x++) dir[idx(x, y)] = dirOf(wrap(x, nx), wrap(y, ny));
		const live: [number, number, number, number, boolean][] = []; // x, y, side (0 R / 1 U), neighbour index, pin
		for (let y = lo; y <= hiY; y++)
			for (let x = lo; x <= hiX; x++)
				for (let axis = 0; axis < 2; axis++) {
					const bx = x + D4[axis][0];
					const by = y + D4[axis][1];
					if (!inside(bx, by)) continue;
					const a = idx(x, y);
					const b = idx(bx, by);
					const ca = chip[a] >= 0;
					const cb = chip[b] >= 0;
					if (ca && cb) continue;
					const h = hashI(wrap(x, nx), wrap(y, ny), seed + (axis === 0 ? 11 : 13));
					const on = ca || cb ? h < 0.85 : wants(dir[a], x, y, axis) && wants(dir[b], bx, by, axis + 2) && h < traces;
					if (on && !empty[a] && !empty[b]) live.push([x, y, axis, b, ca || cb]);
				}
		// Kept first: pins, then edges between tiles of at most two edges (the runs of a bus), then those at junctions,
		// each group in a random order; an edge that would close a loop is dropped.
		const degree = new Uint8Array(W * H);
		for (const [x, y, , b] of live) (degree[idx(x, y)]++, degree[b]++);
		for (let i = live.length - 1; i > 0; i--) {
			const j = Math.floor(rand() * (i + 1));
			[live[i], live[j]] = [live[j], live[i]];
		}
		const rank = (e: (typeof live)[number]) => (e[4] ? 0 : degree[idx(e[0], e[1])] <= 2 && degree[e[3]] <= 2 ? 1 : 2);
		live.sort((a, b) => rank(a) - rank(b));
		const par = new Int32Array(W * H).map((_, i) => i);
		const off = new Int32Array(2 * W * H);
		const path: number[] = [];
		const root = (i: number): number => {
			// Walk up, then point every node on the way at the root with its offset summed (iterative: no deep recursion).
			path.length = 0;
			while (par[i] !== i) (path.push(i), (i = par[i]));
			for (let k = path.length - 2; k >= 0; k--) {
				const v = path[k];
				const up = par[v];
				off[2 * v] += off[2 * up];
				off[2 * v + 1] += off[2 * up + 1];
				par[v] = i;
			}
			return i;
		};
		// Chips are single nodes here too, each tile at its true offset (a chip never straddles the seam), so a loop
		// through a chip counts as one.
		for (let i = 0; i < W * H; i++) {
			const r = chip[i] >= 0 ? chipRoot.get(chip[i])! : i;
			if (r === i) continue;
			par[i] = r;
			off[2 * i] = (i % W) - (r % W);
			off[2 * i + 1] = Math.floor(i / W) - Math.floor(r / W);
		}
		for (const [x, y, axis, b] of live) {
			const a = idx(x, y);
			const ra = root(a);
			const rb = root(b);
			const sx = D4[axis][0];
			const sy = D4[axis][1];
			if (ra === rb) {
				const wraps = off[2 * a] + sx !== off[2 * b] || off[2 * a + 1] + sy !== off[2 * b + 1];
				if (!wraps) continue;
			} else {
				par[ra] = rb;
				off[2 * ra] = off[2 * b] - sx - off[2 * a];
				off[2 * ra + 1] = off[2 * b + 1] - sy - off[2 * a + 1];
			}
			uf.join(a, b);
			setEdge(x, y, axis);
		}
	} else {
		// Routed traces: no tile is used twice, so traces never meet.
		const used = new Uint8Array(W * H);
		for (let i = 0; i < W * H; i++) if (chip[i] >= 0 || empty[i]) used[i] = 1;
		let free = 0;
		for (let y = lo; y <= hiY; y++) for (let x = lo; x <= hiX; x++) if (!used[idx(x, y)]) free++;
		let filled = 0;
		const walk = (x: number, y: number, d: number) => {
			const start = idx(x, y);
			used[start] = 1;
			filled++;
			for (let steps = 0; steps < 4 * (nx + ny) && rand() < traces; steps++) {
				// Straight on mostly, else a turn either way; never back.
				const turn = rand() < 0.5 ? 1 : 3;
				const order = rand() < 0.75 ? [d, (d + turn) % 4, (d + 4 - turn) % 4] : [(d + turn) % 4, d, (d + 4 - turn) % 4];
				let moved = false;
				for (const e of order) {
					const bx = x + D4[e][0];
					const by = y + D4[e][1];
					if (!inside(bx, by) || used[idx(bx, by)]) continue;
					setEdge(x, y, e);
					uf.join(idx(x, y), idx(bx, by));
					x = bx;
					y = by;
					d = e;
					used[idx(x, y)] = 1;
					filled++;
					moved = true;
					break;
				}
				if (!moved) break;
			}
		};
		// From the chip pins outwards (85 % of the outline sides), then from random free tiles.
		for (let y = lo; y <= hiY; y++)
			for (let x = lo; x <= hiX; x++) {
				if (chip[idx(x, y)] < 0) continue;
				for (let d = 0; d < 4; d++) {
					const bx = x + D4[d][0];
					const by = y + D4[d][1];
					if (!inside(bx, by) || chip[idx(bx, by)] >= 0 || used[idx(bx, by)] || rand() >= 0.85) continue;
					setEdge(x, y, d);
					uf.join(idx(x, y), idx(bx, by));
					walk(bx, by, d);
				}
			}
		for (let tries = 0; tries < 20 * free && filled < 0.6 * free; tries++) {
			const x = lo + Math.floor(rand() * (hiX - lo + 1));
			const y = lo + Math.floor(rand() * (hiY - lo + 1));
			if (!used[idx(x, y)]) walk(x, y, Math.floor(rand() * 4));
		}
	}
	// Lone vias (bit 3) on tiles without traces, outside the empty blobs.
	const vias = Number(p.vias ?? 0.3) * 0.3;
	for (let y = lo; y <= hiY; y++)
		for (let x = lo; x <= hiX; x++) {
			const i = idx(x, y);
			const left = out[idx(x - 1, y)] & 1;
			const down = out[idx(x, y - 1)] & 2;
			if (
				!(out[i] & 3) &&
				!(inside(x - 1, y) && left) &&
				!(inside(x, y - 1) && down) &&
				chip[i] < 0 &&
				!empty[i] &&
				rand() < vias
			)
				out[i] |= 8;
		}
	// Wide traces: whole connected pieces without a chip, at least six tiles long (no fat stubs).
	const wide = Math.min(1, Math.max(0, Number(p.wide ?? 0.12)));
	if (wide > 0) {
		const pick = new Map<number, boolean>();
		const tiles = new Map<number, number>();
		for (let i = 0; i < W * H; i++) tiles.set(uf.find(i), (tiles.get(uf.find(i)) ?? 0) + 1);
		for (const [r, k] of tiles) if (k < 6) pick.set(r, false);
		for (let i = 0; i < W * H; i++) if (chip[i] >= 0) pick.set(uf.find(i), false);
		for (let y = lo; y <= hiY; y++)
			for (let x = lo; x <= hiX; x++) {
				const i = idx(x, y);
				const r = uf.find(i);
				if (!pick.has(r)) pick.set(r, rand() < wide);
				if (pick.get(r)) out[i] |= 4;
			}
	}
	const data = new Uint8Array(W * H * 4);
	for (let i = 0; i < W * H; i++)
		data.set(
			[...rnd16(u2f(pcg3(uf.find(i), 5, seed))), out[i] | ((dir[i] + 1) << 4) | (chip[i] >= 0 ? 128 : 0), place[i]],
			i * 4
		);
	return data;
}

export function truchetCells(
	p: ParamValues,
	ctx: { width: number; height: number; tileable: boolean; seed: number }
): Record<string, CpuTexture> {
	const style = String(p.style);
	if (!['maze', 'rooms', 'labyrinth', 'circuit'].includes(style))
		return { cells: { width: 1, height: 1, data: new Uint8Array(4) } };
	const [nx, ny] = cellCount(p, ctx.width, ctx.height);
	const seed = ctx.seed;
	const W = nx + 2;
	const H = ny + 2;
	if (style === 'circuit') return { cells: { width: W, height: H, data: circuitTiles(p, nx, ny, ctx.tileable, seed) } };
	// Walls (B) and a random per room — per cell for the maze and the labyrinth (R, G: 16 bits).
	const data = new Uint8Array(W * H * 4);
	const room = style === 'rooms' ? roomCells(p, nx, ny, ctx.tileable, seed) : null;
	const walls = room
		? room.walls
		: style === 'maze'
			? mazeWalls(p, nx, ny, ctx.tileable, seed)
			: labyrinthWalls(p, nx, ny, ctx.tileable, seed);
	for (let i = 0; i < W * H; i++)
		data.set([...rnd16(room ? room.rnd[i] : u2f(pcg3(i, 11, seed))), walls[i], 255], i * 4);
	return { cells: { width: W, height: H, data } };
}

export const truchetLayer: LayerDef = {
	type: 'truchet',
	label: 'Truchet / Lines',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Truchet / Lines: Line networks built from grid tiles, drawn as raised lines or cut in as grooves. Makes Truchet arcs and weaves, 10-PRINT diagonals, mazes, polyomino rooms, Greek-key meanders, circuit boards.',
	params: [
		P.enum('style', 'Style', 'arcs', STYLES),
		P.enum('draw', 'Draw', 'lines', DRAW, {
			hint: 'Picks what makes up the shape: the lines, the surface between them, or (on arcs) every other region'
		}),
		P.int('cells', 'Cells across', 8, 1, 1024, {
			softMax: 128,
			hint: 'How many grid cells fit across the width. Meanders round this to a multiple of the key period when tiling'
		}),
		P.int('cells_y', 'Cells down', 0, 0, 1024, {
			softMax: 128,
			hint: 'How many grid cells fit down the height (0 = follow the aspect ratio, for square cells)'
		}),
		P.float('width', 'Line width', 1, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			hint: 'Sets how wide the lines are (with Grooves, the groove width; with Two-tone, the gap between the filled regions). Whole-pixel widths on whole-pixel cells give crisp lines with anti-aliasing off'
		}),
		P.enum(
			'caps',
			'Caps',
			'square',
			[
				['round', 'Round', 'round line ends and outer corners'],
				['square', 'Square', 'square ends and mitred corners']
			],
			{
				showIf: isStyle('maze', 'rooms', 'meander', 'labyrinth'),
				hint: 'Shapes the line ends and corners of the lattice styles (maze, rooms, meander, labyrinth)'
			}
		),
		P.float('offset_x', 'Lattice shift X', 0, 0, 1, {
			step: 0.001,
			hint: 'Shifts the lattice by a fraction of a cell'
		}),
		P.float('offset_y', 'Lattice shift Y', 0, 0, 1, { step: 0.001 }),
		P.float('density', 'Density', 1, 0, 1, {
			step: 0.001,
			showIf: (p) => isStyle('arcs', 'diagonal', 'maze', 'rooms', 'labyrinth')(p) && !isTone(p),
			labelFor: (p) => DENSITY_LABEL[String(p.style)] ?? 'Density',
			hint: 'Arcs / diagonal (Tiles drawn): how many of the tiles get their lines. Maze (Walls): how many grid nodes grow a wall. Rooms (Room size): how readily cells join into a room (1 = rooms of about three cells; use Merge rooms for bigger ones). Labyrinth (Perfection): 1 = a perfect maze; lower opens dead ends into loops (all of them by 0.5), then knocks out walls (half of them at 0)'
		}),
		P.float('twist', 'Twist', 0.5, 0, 1, {
			step: 0.001,
			uniform: false,
			showIf: isStyle('labyrinth'),
			hint: 'Makes the labyrinth’s corridors turn more often (0 = long straight runs, 1 = winding)'
		}),
		P.float('cross', 'Crossings', 0, 0, 1, {
			step: 0.001,
			showIf: isStyle('arcs', 'diagonal'),
			hint: 'Swaps some tiles for crossing lines: a + of straight lines (arcs) or an X (diagonal). At 1 you get a grid, or a weave with Over-under gap'
		}),
		P.float('weave', 'Over-under gap', 0, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			showIf: (p) => isStyle('arcs', 'diagonal')(p) && Number(p.cross) > 0 && !isTone(p),
			hint: 'Breaks the under strand this far either side of the over strand at crossings, alternating like a weave or knotwork (0 = the lines just cross; a fraction of a pixel = an unbroken weave where the strands only rise and sink)'
		}),
		P.float('dip', 'Over-under depth', 0.6, 0, 1, {
			step: 0.001,
			showIf: (p) => isStyle('arcs', 'diagonal')(p) && Number(p.cross) > 0 && Number(p.weave) > 0 && !isTone(p),
			hint: 'Raises the over strand to a crown at its crossing and sinks the under strand to its cut ends (0 = flat strands)'
		}),
		P.bool('prune', 'Drop fragments', true, {
			uniform: false,
			showIf: isStyle('maze'),
			hint: 'Leaves out wall pieces of fewer than five walls (floating dashes, small crosses), so the walls form a network'
		}),
		P.float('merge', 'Merge rooms', 1, 0, 3, {
			step: 0.001,
			uniform: false,
			showIf: isStyle('rooms'),
			hint: 'Joins neighbouring rooms into bigger, more varied ones. Each whole step pairs every room with a neighbour, and a fraction pairs some of them (0 = the plain polyomino net). Merged rooms have no stub walls inside'
		}),
		P.int('key', 'Key size', 2, 1, 12, {
			showIf: isStyle('meander'),
			hint: 'Sets how big each key is. Spirals: how many cells the key’s first arm spans before it spirals in (period key + 1). Running key: how many turns it makes in (and out), with a period of 2·key + 2 cells along the band and 2·key + 2 across (+ 1 with Border lines)'
		}),
		P.enum(
			'key_style',
			'Key style',
			'running',
			[
				['spiral', 'Spirals on a rail', 'square spirals hanging from a rail (period key + 1)'],
				[
					'running',
					'Running key',
					'one continuous line spiralling in and back out of every key, the classic Greek key (period 2·key + 2 cells along the band; across it 2·key + 2, + 1 with Border lines)'
				]
			],
			{ showIf: isStyle('meander') }
		),
		P.bool('borders', 'Border lines', true, {
			showIf: isStyle('meander'),
			hint: 'Draws the rail lines. Spirals: the rail every key hangs from (also the next band’s top). Running key: a rail one cell below each band'
		}),
		P.bool('vertical', 'Vertical bands', false, {
			showIf: isStyle('meander'),
			hint: 'Runs the bands down instead of across'
		}),
		P.float('regions', 'Bus regions', 6, 0, 256, {
			softMax: 32,
			step: 0.1,
			uniform: false,
			showIf: isStyle('circuit'),
			hint: 'Groups the traces into regions this many cells across, where they run parallel as horizontal, vertical or diagonal buses that bend together (0 = routed traces that wander out from the chips and never meet)'
		}),
		P.float('traces', 'Trace density', 0.85, 0, 1, {
			step: 0.001,
			uniform: false,
			showIf: isStyle('circuit'),
			hint: 'How likely a trace is to carry on across each cell edge (lower = shorter traces, more pads)'
		}),
		P.float('bend', 'Diagonals', 0.5, 0, 1, {
			step: 0.001,
			showIf: isStyle('circuit'),
			hint: 'With Bus regions, makes more of the buses diagonal. Without, makes more turns cut the corner at 45° instead of a right angle'
		}),
		P.float('empty', 'Empty board', 0.25, 0, 0.9, {
			step: 0.001,
			uniform: false,
			showIf: isStyle('circuit'),
			hint: 'Clears traces off this much of the board, in blobs a few tiles across (chips stay)'
		}),
		P.float('wide', 'Wide traces', 0.12, 0, 1, {
			step: 0.001,
			uniform: false,
			showIf: isStyle('circuit'),
			hint: 'Draws this share of the traces at 2.5 × the width, like power lines (whole connected traces, not those to chips)'
		}),
		P.float('junctions', 'Junctions', 0.2, 0, 1, {
			step: 0.001,
			showIf: (p) => p.style === 'circuit' && Number(p.regions) > 0,
			hint: 'Joins traces where buses meet into T or + junctions. Otherwise the odd trace stops in a pad short of the other, or the four turn in pairs (0 = no merges, like a real board)'
		}),
		P.float('pad', 'Pad radius', 1, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			showIf: isStyle('circuit'),
			hint: 'Sets the size of the round pads at trace ends and vias (follows the line width until you set it)'
		}),
		P.float('vias', 'Vias', 0.3, 0, 1, {
			step: 0.001,
			uniform: false,
			showIf: isStyle('circuit'),
			hint: 'Scatters lone vias over the cells without traces, on 0.3 × this share of them (outside the empty blobs)'
		}),
		P.float('chips', 'Chips', 0, 0, 1, {
			step: 0.001,
			uniform: false,
			showIf: isStyle('circuit'),
			hint: 'Places chips with pins, this likely in each block of chip size + 2 + scatter cells'
		}),
		P.int('chip_w', 'Chip width', 2, 1, 16, {
			showIf: (p) => p.style === 'circuit' && Number(p.chips) > 0,
			hint: 'How many cells across each chip is, with a one-cell margin of traces round it'
		}),
		P.int('chip_h', 'Chip height', 2, 1, 16, {
			showIf: (p) => p.style === 'circuit' && Number(p.chips) > 0,
			hint: 'How many cells down each chip is'
		}),
		P.enum(
			'chip_style',
			'Chip style',
			'ic',
			[
				['plain', 'Plain', 'a slab with the traces running in under it'],
				['ic', 'IC', 'square legs on every side for the traces to meet, and a notch at one end']
			],
			{
				showIf: (p) => p.style === 'circuit' && Number(p.chips) > 0
			}
		),
		P.int('chip_scatter', 'Chip scatter', 4, 0, 32, {
			softMax: 8,
			uniform: false,
			showIf: (p) => p.style === 'circuit' && Number(p.chips) > 0,
			hint: 'Adds extra cells to each chip’s block and puts the chip at a random place in it, for sparser, irregular placement (0 = a regular grid)'
		}),
		P.seed()
	],
	// Lines read as rounded wires: the bevel spans half the line (at least 1 px) and pads are a line width in radius;
	// each style starts at a cell count that suits it (circuits fine, arcs coarse) — until set by hand.
	linkedDefaults: (p) => ({
		bevel: r1(Math.max(1, 0.5 * Number(p.width))),
		pad: r1(Math.max(1, Number(p.width))),
		cells: STYLE_CELLS[String(p.style)] ?? 8
	}),
	// Added in the editor: lines thick enough to read as raised wires at the texture's size (6 px at 512).
	fresh: ({ width, height }) => ({ width: Math.max(1, Math.round(Math.min(width, height) / 85)) }),
	textures: ['cells'],
	// Memoised by the params it reads: a colour or Height slider leaves the layout as it is.
	cpuData: memoReads(truchetCells, 4),
	defaults: MOTIF_DEFAULTS,
	glsl:
		GLSL_MOT_COMMON +
		/* glsl */ `
// Per-cell data from the CPU (truchetCells): cell c at texel c + 1; none (0) outside the texture.
vec4 mot_cellData(ivec2 c, ivec2 n) {
  ivec2 t = wrapCell(c, n) + 1;
  return any(lessThan(t, ivec2(0))) || any(greaterThanEqual(t, textureSize(t_cells, 0))) ? vec4(0.0) : texelFetch(t_cells, t, 0);
}

// Loop bounds below read a uniform (UNI_1, 1 at run time): D3D's compiler can't unroll such loops, so each body is
// compiled once instead of once per iteration — the style loops took seconds to compile unrolled.

// A texel's byte, and the 16-bit random of a cell's R, G (rnd16 on the CPU).
int mot_byte(float v) { return int(v * 255.0 + 0.5); }
float mot_rnd16(vec4 t) { return (float(mot_byte(t.r)) * 256.0 + float(mot_byte(t.g)) + 0.5) / 65536.0; }

// Cells per axis (whole counts); rounded to a multiple of 'mult' per axis (the meander period) when tiling.
ivec2 mot_cellCount(ivec2 mult) {
  float nx = float(max(u_cells, 1));
  float ny = u_cells_y > 0 ? float(u_cells_y) : nx * uRes.y / uRes.x;
  vec2 n = max(vec2(1.0), floor(vec2(nx, ny) + 0.5));
  vec2 m = vec2(max(mult, ivec2(1)));
  if (uTile) n = max(m, floor(n / m + 0.5) * m);
  return ivec2(n);
}

const ivec2 MOT_D4[4] = ivec2[4](ivec2(1, 0), ivec2(0, 1), ivec2(-1, 0), ivec2(0, -1));

// Exact distance to a quarter circle of radius r centred at c, spanning the quadrant towards signs s. With gMotStr,
// S: the band of half width w round it in the stretched space (mot_bandS; sq scales the directions back from a
// squashed frame).
float mot_quarterArc(vec2 p, vec2 c, float r, vec2 s, vec2 sq, float w, out float S) {
  vec2 d = p - c;
  float l = length(d);
  bool arc = d.x * s.x >= 0.0 && d.y * s.y >= 0.0;
  vec2 e0 = d - vec2(s.x * r, 0.0), e1 = d - vec2(0.0, s.y * r);
  bool end0 = dot(e0, e0) < dot(e1, e1);
  vec2 v = arc ? d : end0 ? e0 : e1;
  float dist = arc ? abs(l - r) : length(v);
  // Past an end: the sides there run along the arc's tangent, across its radius.
  vec2 nl = arc ? d : end0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  S = gMotStr ? mot_bandS(dist, v * sq, arc ? dist : abs(end0 ? e0.x : e1.y), nl * sq, w) : 0.0;
  return dist;
}

// Bevel aspect (GLSL_BEVEL): the lines' distances in the space the aspect stretches (gMotStr; the lattice's axes are
// the screen's, swapped for vertical meanders), piece by piece — a round piece across its nearest point's direction
// (mot_bandS), a square-capped wall or a box as a box there (the stretch keeps it one), a pad exactly (mot_discS) —
// so the bevels meet in clean mitres where walls turn and where boxes have corners. mot_boxS: a box whose axes are
// gMotF's (the lattice's: identity or swapped, never rotated — M·h is the half size only then).
float mot_boxS(vec2 p, vec2 h) {
  mat2 M = bevelFrame(gMotF[0], gMotF[1]);
  return sdBox(M * p, abs(M * h));
}

// Line-centre distance to the axis-aligned segment a–b: round caps (sdSegment), or square ones (Caps: the line's
// box, so ends are cut square and corners mitred), both measured to the centre line (the caller subtracts half the
// width); y: the line's own distance (its half width taken off) in the stretched space, with gMotStr.
vec2 mot_seg(vec2 p, vec2 a, vec2 b, float hw) {
  if (u_caps == 0) return vec2(sdSegment(p, a, b), gMotStr ? mot_segS(p, a, b, hw) : 0.0);
  vec2 c = p - 0.5 * (a + b), h = 0.5 * abs(b - a) + hw;
  return vec2(sdBox(c, h) + hw, gMotStr ? mot_boxS(c, h) : 0.0);
}

// ---- circuit: the board is laid out on the CPU (circuitTiles); each tile's data holds its +x / +y edges, wide and
// via flags, bus direction, chip flag and place in its chip, and a random per trace.

// Line-centre distance (x) and solid distance (y) of circuit tile c at offset l (px from the tile centre); rr: its
// random; st: with gMotStr, the lines' own distance (the half width taken off) and the solid's but its pads in the
// stretched space; pad: the nearest pad's centre (l) and radius (z), and its distance (w). Each case only picks its
// segments (at most two: a0 → b0, a1 → b1) and pads (at most two: at p0, p1); one loop then measures them, so every primitive is compiled once (D3D inlines each call site). Flags and edges are bit
// masks, not arrays (D3D compiles dynamically indexed local arrays slowly).
vec2 mot_circuitTile(ivec2 c, vec2 l, vec2 cs, ivec2 n, float hw, out float rr, out vec2 st, out vec4 pad) {
  ivec2 cw = wrapCell(c, n);
  vec2 h = 0.5 * cs;
  vec2 eR = vec2(h.x, 0.0), eL = vec2(-h.x, 0.0), eU = vec2(0.0, h.y), eD = vec2(0.0, -h.y), O = vec2(0.0);
  vec4 td = mot_cellData(c, n);
  int t = mot_byte(td.b);
  rr = mot_rnd16(td);
  // R and U are the tile's own edges; L and D its −x / −y neighbours' +x / +y edges (one fetch, looped).
  int e = t & 3;
  for (int s = 0; s < 2 * UNI_1; s++) if (((mot_byte(mot_cellData(c - MOT_D4[s], n).b) >> s) & 1) != 0) e |= 4 << s;
  bool R = (e & 1) != 0, U = (e & 2) != 0, L = (e & 4) != 0, D = (e & 8) != 0;
  vec2 a0 = O, b0 = O, a1 = O, b1 = O, p0 = O, p1 = O;
  int on = 0;   // bit 0, 1: segment 0, 1 drawn; bit 2, 3: pad 0, 1
  float ds = 1e9, dsS = 1e9;
  int k = int(R) + int(L) + int(U) + int(D);
  vec3 hh = hash3I(cw, uSeed + 5.0);
  bool junc = hh.x < u_junctions;
  int dir = ((t >> 4) & 7) - 1;
  bool chip = (t & 128) != 0;
  if (chip) {
    // Body: the chip's tiles inset by a third of a tile.
    ivec2 S = clamp(ivec2(u_chip_w, u_chip_h), ivec2(1), ivec2(16));
    int pl = mot_byte(td.a);
    ivec2 li = ivec2(pl & 15, pl >> 4);   // this tile's place in the chip
    vec2 bc = (0.5 * vec2(S - 1) - vec2(li)) * cs;
    vec2 bh = max(0.5 * vec2(S) * cs - max(cs / 3.0, vec2(u_width)), vec2(0.5));
    ds = sdBox(l - bc, bh);
    if (gMotStr) dsS = mot_boxS(l - bc, bh);
    if (u_chip_style == 1) {
      // IC: a notch in the body's −x end, and a leg on every tile side along the outline, from the body out to the
      // tile edge (where a trace meets it) — wider than a trace, square.
      vec2 nv = l - bc + vec2(bh.x, 0.0);
      ds = max(ds, 0.35 * min(bh.x, bh.y) - length(nv));
      if (gMotStr) dsS = max(dsS, mot_bl(0.35 * min(bh.x, bh.y) - length(nv), nv));
      // Per axis, the tile's sides on the outline: + or − (a chip one tile across: both, folded by |l|). The legs
      // stand a little off the body (a gap of a fifth of the inset, at least 1 px) and are narrower than a tile.
      float lw = min(max(hw, 0.14 * min(cs.x, cs.y)), 0.3 * min(cs.x, cs.y));
      for (int ax = 0; ax < 2 * UNI_1; ax++) {
        bool x = ax == 0;
        int at = x ? li.x : li.y;
        bool pp = at == (x ? S.x : S.y) - 1, pm = at == 0;
        if (pp || pm) {
          float sg = pp ? 1.0 : -1.0, lc = x ? l.x : l.y;
          float body = (pp && pm ? 0.0 : sg * (x ? bc.x : bc.y)) + (x ? bh.x : bh.y), edge = x ? h.x : h.y;
          body += min(max(0.2 * (edge - body), 1.0), 0.5 * (edge - body));
          vec2 lp = vec2((pp && pm ? abs(lc) : sg * lc) - 0.5 * (edge + body), x ? l.y : l.x), lh = vec2(0.5 * (edge - body), lw);
          ds = min(ds, sdBox(lp, lh));
          if (gMotStr) dsS = min(dsS, mot_boxS(x ? lp : lp.yx, x ? lh : lh.yx));
        }
      }
    } else {
      // Plain: pins run from each live edge to the centre (under the body).
      a0 = R ? eR : O; b0 = L ? eL : O; a1 = U ? eU : O; b1 = D ? eD : O;
      on = int(R || L) | (int(U || D) << 1);
    }
  } else if (k == 0) {
    on = (t & 8) != 0 ? 4 : 0;   // a lone via
  } else if ((dir == 0 && !U && !D) || (dir == 1 && !R && !L)) {
    // Straight bus: through, or a trace end with a pad.
    bool a = dir == 0 ? R : U, b = dir == 0 ? L : D;
    vec2 ea = dir == 0 ? eR : eU, eb = dir == 0 ? eL : eD;
    a0 = a ? ea : eb; b0 = a && b ? eb : O;
    on = a && b ? 1 : 5;
  } else if (dir >= 2) {
    // Diagonal bus: one chamfer per tile (see circuitTiles); chained, they form 45° lines. Each pair is a chamfer when
    // both its ends are live, a stub ending in a pad mid-chamfer when one is.
    bool A0 = L, B0 = dir == 2 ? U : D, A1 = R, B1 = dir == 2 ? D : U;
    vec2 f0 = dir == 2 ? eU : eD, f1 = dir == 2 ? eD : eU;
    p0 = 0.5 * (eL + f0); p1 = 0.5 * (eR + f1);
    a0 = A0 ? eL : f0; b0 = A0 && B0 ? f0 : p0;
    a1 = A1 ? eR : f1; b1 = A1 && B1 ? f1 : p1;
    on = int(A0 || B0) | (int(A1 || B1) << 1) | (int(A0 != B0) << 2) | (int(A1 != B1) << 3);
  } else if (k == 1) {
    // Random traces (and any tile whose edges do not fit its bus) from here on. One edge: a trace end with a pad.
    a0 = R ? eR : L ? eL : U ? eU : eD;
    on = 5;
  } else if (k == 2) {
    if (R && L) { a0 = eR; b0 = eL; on = 1; }
    else if (U && D) { a0 = eU; b0 = eD; on = 1; }
    else {
      // A turn: cut at 45°, or a right angle through the centre.
      vec2 a = R ? eR : eL, b = U ? eU : eD;
      bool cut = hh.y < u_bend;
      a0 = a; b0 = cut ? b : O; b1 = b;
      on = cut ? 1 : 3;
    }
  } else if (k == 3) {
    // The odd edge either tees into the through trace, or the corner pair is chamfered and the remaining edge
    // ends in a pad part-way in.
    // Without a junction (Junctions), the odd edge stops in a pad short of the through trace instead of teeing.
    bool horiz = R && L;
    vec2 e1 = horiz ? eR : eU, e2 = horiz ? eL : eD;
    vec2 o = horiz ? (U ? eU : eD) : (R ? eR : eL);
    bool cut = hh.y < u_bend * 0.5, z = hh.z < 0.5;
    bool tee = !cut && junc;
    vec2 keep = z ? e1 : e2, lone = cut ? (z ? e2 : e1) : o;
    a0 = cut ? keep : e1; b0 = cut ? o : e2; a1 = lone; b1 = tee ? O : lone * 0.4; p0 = lone * 0.4;
    on = tee ? 3 : 7;
  } else {
    // A crossing: two chamfers, or straight through with a pad (a via) — always chamfers without a junction.
    bool cut = hh.y < u_bend || !junc, z = hh.z < 0.5;
    a0 = eR; b0 = cut ? (z ? eU : eD) : eL;
    a1 = cut ? eL : eU; b1 = cut ? (z ? eD : eU) : eD;
    on = cut ? 3 : 7;
  }
  // A wide trace (power line): 2.5 × the width, its pads grown as much.
  float wx = (t & 4) != 0 && !chip ? max(1.5 * hw, 1.0) : 0.0;
  float dl = 1e9, dlS = 1e9;
  pad = vec4(0.0, 0.0, 0.0, 1e9);
  for (int q = 0; q < 2 * UNI_1; q++) {
    vec2 a = q == 0 ? a0 : a1, b = q == 0 ? b0 : b1, pc = q == 0 ? p0 : p1;
    if ((on & (1 << q)) != 0) {
      dl = min(dl, sdSegment(l, a, b));
      if (gMotStr) dlS = min(dlS, mot_segS(l, a, b, hw + wx));
    }
    if ((on & (4 << q)) != 0) {
      float e = length(l - pc) - u_pad;
      ds = min(ds, e);
      if (e - wx < pad.w) pad = vec4(pc, u_pad + wx, e - wx);
    }
  }
  st = vec2(dlS, dsS);
  return vec2(dl - wx, ds - wx);
}

GenOut gen(vec2 p) {
  int style = u_style;
  int key = clamp(u_key, 1, 12);
  // Meander periods (along the band, across it): spirals key + 1 cells both ways; the running key 2·key + 2 along
  // and across (+ 1 across with its rail).
  bool running = style == 4 && u_key_style == 1;
  ivec2 PP = running ? ivec2(2 * key + 2, 2 * key + 2 + int(u_borders)) : ivec2(key + 1);
  // Two-tone arcs colour each region by the parity of the lattice nodes it holds, so tiling needs even counts.
  bool tone = style == 0 && u_draw >= 2;
  ivec2 n = mot_cellCount(style == 4 ? (u_vertical ? PP.yx : PP) : ivec2(tone ? 2 : 1));
  // User space (y down), shifted by half the line width so a line on lattice line k covers [k·cell, k·cell + w):
  // whole-pixel cells and widths put every straight edge on a pixel boundary.
  vec2 u = vec2(p.x, uRes.y - p.y) - 0.5 * u_width - vec2(u_offset_x, u_offset_y) * uRes / vec2(n);
  vec2 res = uRes;
  if (style == 4 && u_vertical) { u = u.yx; n = n.yx; res = res.yx; }
  vec2 cs = res / vec2(n);
  float hw = 0.5 * u_width;
  float best = 1e9, solid = 1e9;
  float rnd = 0.0;
  // Bevel aspect: also the lines' own distance and the solids' in the stretched space (gMotStr, mot_bl).
  MOT_SET_STR(bevelAspectOn());
  gMotF = style == 4 && u_vertical ? mat2(0.0, 1.0, 1.0, 0.0) : mat2(1.0);
  float bestS = 1e9, solidS = 1e9;

  float side = 0.0;   // two-tone: 1 in the filled regions
  // Over-under: the Height factor of the nearest strand — plain strands at wBase; crossing strands one cosine from a
  // crown of 1 at the over crossing, through wBase at the tile edge, down to the under crossing.
  float wAmp = 0.45 * u_dip, wBase = 1.0 - wAmp;
  float hgt = wBase;
  if (style <= 1) {
    // Truchet arcs / diagonals: one random orientation bit per tile; a share of the tiles cross instead (+ or X).
    ivec2 c0 = ivec2(floor(u / cs));
    float m = min(cs.x, cs.y);
    float dens = tone ? 1.0 : u_density;
    float gap = tone ? 0.0 : u_weave;
    int par0 = 0;
    for (int j = -UNI_1; j <= UNI_1; j++)
    for (int i = -UNI_1; i <= UNI_1; i++) {
      ivec2 c = c0 + ivec2(i, j);
      ivec2 cw = wrapCell(c, n);
      vec3 h = hash3I(cw, uSeed);
      // (An if around the body, not continue: ANGLE / D3D can miscompile continue in a loop.)
      if (h.x < dens) {
      bool crossing = h.x < dens * u_cross;   // h.x / dens is uniform over the drawn tiles
      bool o = h.y < 0.5;
      vec2 l = u - vec2(c) * cs;
      float da, db;   // the tile's two strands (crossings: ─ and │, or ╲ and ╱)
      float sa = 0.0, sb = 0.0;   // Bevel aspect: their bands in the stretched space
      vec2 la, lb;    // and the directions across them (crossings: for the weave's cut)
      vec2 L = l * (m / cs);   // arcs: square frame (non-square cells squash the arcs)
      vec2 sq = m / cs;        // (which scales directions inversely)
      float r = 0.5 * m;
      if (style == 0) {
        // Arcs round two opposite corners: (0, 0) and (m, m), or (m, 0) and (0, m); each spans the quadrant inwards.
        vec2 ca = o ? vec2(0.0) : vec2(m, 0.0), cb = vec2(m) - ca;
        la = vec2(0.0, sq.y);
        lb = vec2(sq.x, 0.0);
        if (crossing) {
          vec2 q = L - r;
          vec2 va = vec2(sign(q.x) * max(abs(q.x) - r, 0.0), q.y), vb = vec2(q.x, sign(q.y) * max(abs(q.y) - r, 0.0));
          da = length(va);
          db = length(vb);
          if (gMotStr) {
            sa = mot_bandS(da, va * sq, abs(q.y), la, hw);
            sb = mot_bandS(db, vb * sq, abs(q.x), lb, hw);
          }
        } else {
          // One strand per iteration (one copy of mot_quarterArc).
          for (int s = 0; s < 2 * UNI_1; s++) {
            vec2 cc = s == 0 ? ca : cb;
            float S;
            float e = mot_quarterArc(L, cc, r, sign(r - cc), sq, hw, S);
            if (s == 0) { da = e; sa = S; } else { db = e; sb = S; }
          }
        }
        // Two-tone: every region holds lattice nodes of one parity — a corner quarter-disc its corner, the band
        // between the arcs the other two corners, a crossing's quadrant its corner. The pixel's own tile decides.
        if (i == 0 && j == 0) par0 = (cw.x + cw.y + (crossing ? int(L.x > r) + int(L.y > r) : int((length(L - ca) < r || length(L - cb) < r) != o))) & 1;
      } else {
        // ╲ and ╱, one per iteration (one copy of each segment call).
        for (int s = 0; s < 2 * UNI_1; s++) {
          vec2 a = s == 0 ? vec2(0.0) : vec2(cs.x, 0.0), b = s == 0 ? cs : vec2(0.0, cs.y);
          float e = sdSegment(l, a, b), S = gMotStr ? mot_segS(l, a, b, hw) : 0.0;
          if (s == 0) { da = e; sa = S; } else { db = e; sb = S; }
        }
        la = vec2(-cs.y, cs.x);
        lb = cs;
        if (!crossing) { if (o) { db = 1e9; sb = 1e9; } else { da = 1e9; sa = 1e9; } }
      }
      float hO = wBase, hU = wBase;
      bool woven = crossing && gap > 0.0;
      if (woven) {
        // Over-under: alternate tiles carry the other strand on top; the under strand stops short of it. In Height
        // the over strand rises to a crown at the crossing and the under strand sinks towards its cut ends, both
        // back to the plain height at the tile's edge.
        bool aOver = ((cw.x + cw.y) & 1) == 0;
        float ov = aOver ? da : db;
        // Stretched: the under strand cut by the over one's band grown by the gap (across the over strand).
        if (gMotStr) bestS = min(bestS, min(aOver ? sa : sb, max(aOver ? sb : sa, mot_bl(hw + gap - ov, aOver ? la : lb))));
        db = max(aOver ? db : da, 2.0 * hw + gap - ov);
        da = ov;
        float t = (style == 0 ? length(L - r) / r : length(l - 0.5 * cs) / (0.5 * length(cs)));   // 0 centre … 1 edge
        float cw2 = wAmp * cos(1.5707963 * min(t, 1.0));
        hO = wBase + cw2;
        hU = wBase - cw2;
      } else if (gMotStr) {
        bestS = min(bestS, min(sa, sb));
      }
      float d = min(da, db);
      if (d < best) { best = d; rnd = h.z; hgt = db < da ? hU : hO; }
      }
    }
    side = float(par0 == u_draw - 2);
  } else if (style == 2 || style == 3 || style == 6) {
    // Maze / rooms / labyrinth, laid out on the CPU (truchetCells): the +x and +y walls of the 3×3 cells around the
    // pixel (cell c spans lattice [c, c + 1]), and the random of the pixel's cell (per room for rooms).
    ivec2 c0 = ivec2(floor(u / cs));
    vec4 rd = vec4(0.0);
    int wb = 0;   // the block's walls, bit 2 · (cell index in the 3×3 block) + axis (Bevel aspect)
    for (int j = -UNI_1; j <= UNI_1; j++)
    for (int i = -UNI_1; i <= UNI_1; i++) {
      ivec2 c = c0 + ivec2(i, j);
      vec2 o = vec2(c + 1) * cs;
      vec4 cd = mot_cellData(c, n);
      if (i == 0 && j == 0) rd = cd;
      int bits = mot_byte(cd.b);
      wb |= (bits & 3) << (2 * (i + 1 + 3 * (j + 1)));
      // Both walls through one segment call.
      for (int ax = 0; ax < 2 * UNI_1; ax++)
        if (((bits >> ax) & 1) == 1) {
          vec2 sg = mot_seg(u, o, ax == 0 ? vec2(o.x, o.y - cs.y) : vec2(o.x - cs.x, o.y), hw);
          best = min(best, sg.x);
          bestS = min(bestS, sg.y);
        }
    }
    if (gMotStr && u_caps == 1) {
      // Bevel aspect with square caps: walls are boxes overlapping at the nodes, and where one runs on in line into the
      // next, its end there (inside the next) would dent the bevel across the joint — its end along the wall measures
      // in the stretched space at another scale than its sides. So a wall running on (within the block) is measured
      // on to the next node, inside the next wall: the joint disappears, free ends and corners stay.
      bestS = 1e9;
      for (int w = 0; w < 18 * UNI_1; w++) {
        if (((wb >> w) & 1) != 0) {
          int ax = w & 1;
          ivec2 ij = ivec2((w >> 1) % 3, (w >> 1) / 3);
          ivec2 dn = ax == 0 ? ivec2(0, 1) : ivec2(1, 0);
          ivec2 nA = ij + dn, nB = ij - dn;
          bool runA = nA.x <= 2 && nA.y <= 2 && ((wb >> (2 * (nA.x + 3 * nA.y) + ax)) & 1) != 0;
          bool runB = nB.x >= 0 && nB.y >= 0 && ((wb >> (2 * (nB.x + 3 * nB.y) + ax)) & 1) != 0;
          vec2 o = vec2(c0 + ij) * cs, step = vec2(dn) * cs;
          bestS = min(bestS, mot_seg(u, o + (runA ? step : vec2(0.0)), o - step - (runB ? step : vec2(0.0)), hw).y);
        }
      }
    }
    rnd = mot_rnd16(rd);
  } else if (style == 4) {
    // Meander, in units of PP cells (y up from the band's bottom). Spirals: a key of 2·key moves (lengths key, key,
    // key − 1, key − 1, … 1, 1) hangs from a rail along the bottom, bands repeating every key + 1 cells, so each rail
    // is also the next band's top. Running key (one continuous line): from the unit's bottom-left corner it spirals
    // in clockwise (up 2k + 1, right 2k + 1, down 2k, left 2k − 1, … 1), steps across, and spirals back out between
    // its own turns (… 2k, 2k + 1) to leave along the bottom into the next unit's corner; with Border lines a rail
    // runs one cell below. Every move, the step and the rail go through one segment call.
    // Each unit's lines (and rails) lie within its own PP box (a rail drawn on past its ends for Bevel aspect only
    // repeats its neighbour's), so the 2 × 2 units nearest the pixel are enough: its own and the neighbours on the side
    // of each half it is in. Every point of a unit further off has one of theirs nearer on both axes, so they hold the
    // nearest line at any cell aspect, with round or square caps.
    vec2 g = u / cs;
    ivec2 k0 = ivec2(floor(g / vec2(PP)));
    k0 -= ivec2(lessThan(g - vec2(k0 * PP), 0.5 * vec2(PP)));   // the 2 × 2's lower-left unit
    int nIn = running ? 2 * key + 2 : 2 * key, nOut = running ? 2 * key + 1 : 0;
    for (int j = 0; j <= UNI_1; j++)
    for (int i = 0; i <= UNI_1; i++) {
      ivec2 k = k0 + ivec2(i, j);
      vec2 lq = g - vec2(k * PP);
      lq.y = float(PP.y) - lq.y - (running && u_borders ? 1.0 : 0.0);   // the key grows up from the band's bottom
      vec2 lp = lq * cs;
      float d = 1e9;
      vec2 pi = vec2(0.0), po = vec2(float(PP.x), 0.0);
      for (int s = 0; s < (nIn + nOut + 2) * UNI_1; s++) {
        vec2 a, b;
        bool draw = true;
        if (s < nIn) {
          int len = running ? (s == 0 ? 2 * key + 1 : 2 * key + 2 - s) : key - s / 2;
          a = pi; pi += vec2(MOT_D4[(5 - s % 4) % 4]) * float(len); b = pi;   // up, right, down, left, …
        } else if (s < nIn + nOut) {
          int m = s - nIn;
          a = po; po += vec2(MOT_D4[(6 - m % 4) % 4]) * float(2 * key + 1 - m); b = po;   // left, up, right, …
        } else if (s == nIn + nOut) {
          a = pi; b = po; draw = running;   // the step between the in and out spirals
        } else {
          a = vec2(0.0, running ? -1.0 : 0.0); b = vec2(float(PP.x), a.y); draw = u_borders;   // the rail
          // Bevel aspect: the rails run on into the next units' (else their square ends would dent the bevel there).
          if (gMotStr) { a.x -= 1.0; b.x += 1.0; }
        }
        if (draw) {
          vec2 sg = mot_seg(lp, a * cs, b * cs, hw);
          d = min(d, sg.x);
          bestS = min(bestS, sg.y);
        }
      }
      if (d < best) { best = d; rnd = hashI(wrapCell(k, max(n / PP, ivec2(1))), uSeed); }
    }
  } else {
    // Circuit: tiles centred on lattice nodes (traces run along lattice lines), laid out on the CPU.
    ivec2 c0 = ivec2(floor(u / cs + 0.5));
    float padD = 1e9, padR = 0.0;   // the nearest pad (Bevel aspect measures it once, exactly)
    vec2 padC = vec2(0.0);
    for (int j = -UNI_1; j <= UNI_1; j++)
    for (int i = -UNI_1; i <= UNI_1; i++) {
      ivec2 c = c0 + ivec2(i, j);
      float rr;
      vec2 st;
      vec4 pd;
      vec2 t = mot_circuitTile(c, u - vec2(c) * cs, cs, n, hw, rr, st, pd);
      if (pd.w < padD) { padD = pd.w; padC = pd.xy + vec2(c) * cs; padR = pd.z; }
      if (min(t.x - hw, t.y) < min(best - hw, solid)) rnd = rr;
      best = min(best, t.x);
      solid = min(solid, t.y);
      bestS = min(bestS, st.x);
      solidS = min(solidS, st.y);
    }
    if (gMotStr && padD < 1e8) solidS = min(solidS, mot_discS(u - padC, padR));
  }
  float sd = min(best - hw, solid);
  if (tone) sd = (side > 0.5 ? -best : best) + hw;   // the filled regions, inset by half the line (the gap)
  else if (u_draw >= 1) sd = -sd;                      // grooves: everything but the lines
  sd = max(sd, -1e4);   // far from every line (grooves): deep inside, not below NO_SDF (which would opt out)
  GenOut g = genOut(0.0, 1.0, rnd, sd);
  // Bevel aspect: the same shape from the stretched distances (the gaps between two-tone regions: outside, as is).
  float bd = sd;
  if (gMotStr) {
    bd = min(bestS, solidS);
    if (tone) bd = side > 0.5 ? -bestS : sd;
    else if (u_draw >= 1) bd = -bd;
    g.bdist = max(bd, -1e4);
  }
  // Over-under lines: Height reads the bevel × the strand's height (the bevel as the wrapper draws it).
  if (style <= 1 && u_draw == 0 && u_cross > 0.0 && u_weave > 0.0 && u_dip > 0.0)
    g.hval = bevelPlain(bd) * hgt;
  return g;
}
`
};

/** Motif-family layers, in add-menu order. */
export const MOTIF_LAYERS: LayerDef[] = [truchetLayer, rosetteLayer, glyphLayer];
