// Stamp and Label (FR7.5): hand-drawn pixel bitmaps and pixel-font text as shapes — crate insignia, painted
// emblems, panel numbers and warning lettering that no procedural motif can reproduce. (Path and Polyline, shapes from
// vertex lists: paths.ts.)
//
// The CPU lays out the bitmap (mirror, text in one of two pixel fonts) and stores, per cell, the nearest
// cell of the other state (a jump flood), so the shader's signed distance — to the nearest cell of the other state —
// is exact at any bevel width from nine lookups. The cell level (1..3) is the per-feature random, so a Per-feature
// colour ramp paints multi-tone bitmaps; repeats can carry their own random instead.

import { FONT, parseBitmap } from '@/core/bitmap';
import { Lru, memoReads } from '@/core/memo';
import { P, type ParamDef, type ParamValues } from '@/core/params';
import type { CpuTexture, LayerDef } from '../types';
import { getImage } from '@/core/images';

// ------------------------------------------------------------------------------------------------ bitmaps (CPU)

/** A laid-out bitmap: row-major levels 0..3, top row first. */
export interface Cells {
	w: number;
	h: number;
	lv: Uint8Array;
}

/** Stamp bitmaps: up to 128 × 128 cells. */
const STAMP_MAX = 128;
/** Label bitmaps: up to 256 cells across, 128 down. */
const LABEL_MAX_W = 256;
const LABEL_MAX_H = 128;

/** Rows of cell characters (one row per line; blank lines at either end dropped): core/bitmap's parser. */
export function parseCells(src: string): Cells {
	const b = parseBitmap(src, STAMP_MAX);
	return { w: b.width, h: b.height, lv: b.levels };
}

/** The right half reflected from the left: 'odd' shares the centre column, 'even' doesn't. */
export function mirrorCells(c: Cells, mode: unknown): Cells {
	if ((mode !== 'odd' && mode !== 'even') || c.w === 0) return c;
	const w = c.w * 2 - (mode === 'odd' ? 1 : 0);
	const lv = new Uint8Array(w * c.h);
	for (let y = 0; y < c.h; y++) for (let x = 0; x < w; x++) lv[y * w + x] = c.lv[y * c.w + (x < c.w ? x : w - 1 - x)];
	return { w, h: c.h, lv };
}

// The small font (3 × 5, 5 × 5 for M and W) is the core one (core/bitmap.ts); these glyphs fill in what it lacks.
const SMALL_EXTRA: Record<string, string> = {
	',': '../../../.#/#.',
	';': '../.#/../.#/#.',
	'?': '###/..#/.##/.../.#.',
	"'": '#/#/././.',
	'"': '#.#/#.#/.../.../...',
	'(': '.#/#./#./#./.#',
	')': '#./.#/.#/.#/#.',
	'[': '##/#./#./#./##',
	']': '##/.#/.#/.#/##',
	_: '.../.../.../.../###',
	'*': '.../#.#/.#./#.#/...',
	'%': '#.#/..#/.#./#../#.#',
	'<': '..#/.#./#../.#./..#',
	'>': '#../.#./..#/.#./#..',
	'&': '.#./#.#/.#./#.#/.##',
	'@': '.##/#.#/#.#/#../.##',
	'°': '###/#.#/###/.../...',
	'\\': '#../#../.#./..#/..#'
};

// The compact font drawn as strokes (Label, Join diagonals at Smooth ≥ 1): a few glyphs that a 3 × 5 bitmap leaves
// ambiguous once its corners are joined, redrawn (wider where needed). Bitmap labels keep the core glyphs.
const SMALL_STROKE: Record<string, string> = {
	B: '##./#.#/###/#.#/##.',
	Q: '###/#.#/#.#/###/..#',
	'#': '.#.#./#####/.#.#./#####/.#.#.',
	J: '..#/..#/..#/#.#/##.',
	'&': '.#../#.#./.#../#.#./.#.#',
	'@': '.##./#..#/#.##/#.../.##.'
};

// The large font: 5 × 7 (narrower where the letter is), capitals, lower case (g j p q y descend an eighth row),
// digits and punctuation.
const LARGE: Record<string, string> = {
	A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
	B: '####./#...#/#...#/####./#...#/#...#/####.',
	C: '.###./#...#/#..../#..../#..../#...#/.###.',
	D: '###../#..#./#...#/#...#/#...#/#..#./###..',
	E: '#####/#..../#..../####./#..../#..../#####',
	F: '#####/#..../#..../####./#..../#..../#....',
	G: '.###./#...#/#..../#.###/#...#/#...#/.####',
	H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
	I: '###/.#./.#./.#./.#./.#./###',
	J: '..###/...#./...#./...#./...#./#..#./.##..',
	K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
	L: '#..../#..../#..../#..../#..../#..../#####',
	M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
	N: '#...#/#...#/##..#/#.#.#/#..##/#...#/#...#',
	O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
	P: '####./#...#/#...#/####./#..../#..../#....',
	Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
	R: '####./#...#/#...#/####./#.#../#..#./#...#',
	S: '.####/#..../#..../.###./....#/....#/####.',
	T: '#####/..#../..#../..#../..#../..#../..#..',
	U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
	V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
	W: '#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#.',
	X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
	Y: '#...#/#...#/#...#/.#.#./..#../..#../..#..',
	Z: '#####/....#/...#./..#../.#.../#..../#####',
	a: '...../...../.###./....#/.####/#...#/.####',
	b: '#..../#..../#.##./##..#/#...#/#...#/####.',
	c: '...../...../.###./#..../#..../#...#/.###.',
	d: '....#/....#/.##.#/#..##/#...#/#...#/.####',
	e: '...../...../.###./#...#/#####/#..../.###.',
	f: '..##/.#../.#../###./.#../.#../.#..',
	g: '...../...../.####/#...#/#...#/.####/....#/.###.',
	h: '#..../#..../#.##./##..#/#...#/#...#/#...#',
	i: '.#./.../##./.#./.#./.#./###',
	j: '...#/..../..##/...#/...#/...#/#..#/.##.',
	k: '#.../#.../#..#/#.#./##../#.#./#..#',
	l: '##./.#./.#./.#./.#./.#./###',
	m: '...../...../##.#./#.#.#/#.#.#/#...#/#...#',
	n: '...../...../#.##./##..#/#...#/#...#/#...#',
	o: '...../...../.###./#...#/#...#/#...#/.###.',
	p: '...../...../####./#...#/#...#/####./#..../#....',
	q: '...../...../.####/#...#/#...#/.####/....#/....#',
	r: '...../...../#.##./##..#/#..../#..../#....',
	s: '...../...../.####/#..../.###./....#/####.',
	t: '.#../.#../###./.#../.#../.#.#/..#.',
	u: '...../...../#...#/#...#/#...#/#..##/.##.#',
	v: '...../...../#...#/#...#/#...#/.#.#./..#..',
	w: '...../...../#...#/#...#/#.#.#/#.#.#/.#.#.',
	x: '...../...../#...#/.#.#./..#../.#.#./#...#',
	y: '...../...../#...#/#...#/#...#/.####/....#/.###.',
	z: '...../...../#####/...#./..#../.#.../#####',
	'0': '.###./#...#/#...#/#.#.#/#...#/#...#/.###.',
	'1': '.#./##./.#./.#./.#./.#./###',
	'2': '.###./#...#/....#/...#./..#../.#.../#####',
	'3': '.###./#...#/....#/..##./....#/#...#/.###.',
	'4': '...#./..##./.#.#./#..#./#####/...#./...#.',
	'5': '#####/#..../####./....#/....#/#...#/.###.',
	'6': '..##./.#.../#..../####./#...#/#...#/.###.',
	'7': '#####/....#/...#./..#../.#.../.#.../.#...',
	'8': '.###./#...#/#...#/.###./#...#/#...#/.###.',
	'9': '.###./#...#/#...#/.####/....#/...#./.##..',
	' ': '.../.../.../.../.../.../...',
	'-': '..../..../..../####/..../..../....',
	'.': '././././././#',
	',': '../../../../../../.#/#.',
	':': '././#/./././#',
	';': '../../.#/../../../.#/#.',
	'!': '#/#/#/#/#/./#',
	'?': '.###./#...#/....#/...#./..#../...../..#..',
	'/': '....#/...#./...#./..#../.#.../.#.../#....',
	'\\': '#..../.#.../.#.../..#../...#./...#./....#',
	'+': '...../..#../..#../#####/..#../..#../.....',
	'=': '...../...../#####/...../#####/...../.....',
	'#': '.#.#./.#.#./#####/.#.#./#####/.#.#./.#.#.',
	"'": '#/#/././././.',
	'"': '#.#/#.#/.../.../.../.../...',
	'(': '..#/.#./#../#../#../.#./..#',
	')': '#../.#./..#/..#/..#/.#./#..',
	'[': '###/#../#../#../#../#../###',
	']': '###/..#/..#/..#/..#/..#/###',
	_: '...../...../...../...../...../...../#####',
	'*': '...../..#../#.#.#/.###./#.#.#/..#../.....',
	'%': '##..#/##..#/...#./..#../.#.../#..##/#..##',
	'&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#',
	'<': '...#/..#./.#../#.../.#../..#./...#',
	'>': '#.../.#../..#./...#/..#./.#../#...',
	'@': '.###./#...#/#.###/#.#.#/#.###/#..../.###.',
	'°': '.##./#..#/.##./..../..../..../....'
};
const LARGE_UNKNOWN = '#####/#...#/#...#/#...#/#...#/#...#/#####';

/** Every hand-drawn glyph table (for tests: rectangular rows, 5 or 7–8 of them). */
export const GLYPH_TABLES: Record<string, Record<string, string>> = {
	large: LARGE,
	smallExtra: SMALL_EXTRA,
	smallStroke: SMALL_STROKE
};

/**
 * A glyph's rows ('#' set). The small font upper-cases (it has no lower case); unknown characters get a box (the
 * small font: its '#').
 */
function glyphRows(ch: string, font: 'small' | 'large', strokes = false): string[] {
	if (font === 'large') return (LARGE[ch] ?? LARGE[ch.toUpperCase()] ?? LARGE_UNKNOWN).split('/');
	const u = ch.toUpperCase();
	return ((strokes && SMALL_STROKE[u]) || (FONT[u] ?? SMALL_EXTRA[u] ?? FONT['#'])).split('/');
}

/**
 * One row of bold: each cell the highest of itself and the `k` cells to its left, `w` cells (past the row's end:
 * empty).
 */
function boldRow(row: ArrayLike<number>, k: number, w: number): number[] {
	return Array.from({ length: w }, (_, x) => {
		let v = 0;
		for (let j = 0; j <= k; j++) if (x - j >= 0 && x - j < row.length) v = Math.max(v, row[x - j]);
		return v;
	});
}

export interface TextLayout {
	font?: 'small' | 'large';
	/** Empty cells between letters. */
	spacing?: number;
	/** Empty rows between lines. */
	lineGap?: number;
	align?: 'center' | 'left' | 'right';
	/** Each glyph's uprights doubled (one cell wider; the advance grows with it). */
	bold?: boolean;
	/** Only widen the advance for bold (the caller emboldens the whole bitmap later, e.g. after joining diagonals). */
	boldAdvanceOnly?: boolean;
	/** Drawn as strokes: the compact font's stroke versions of its ambiguous glyphs. */
	strokeGlyphs?: boolean;
}

/** Text in a pixel font; lines split on '\n' or '|' and are aligned within the widest. */
export function textCells(text: string, o: TextLayout = {}): Cells {
	const font = o.font === 'large' ? 'large' : 'small';
	const gap = Math.max(0, Math.round(o.spacing ?? 1));
	const lineGap = Math.max(0, Math.round(o.lineGap ?? 1));
	// Bold: a cell wider (only the advance with boldAdvanceOnly).
	const embolden = (g: string[]) =>
		g.map((r) =>
			boldRow(
				[...r].map((ch) => (ch === '#' ? 1 : 0)),
				o.boldAdvanceOnly ? 0 : 1,
				r.length + 1
			)
				.map((v) => (v ? '#' : '.'))
				.join('')
		);
	const lines = text
		.replace(/\r/g, '')
		.split(/\n|\|/)
		.map((l) =>
			[...l].map((ch) => (o.bold ? embolden(glyphRows(ch, font, o.strokeGlyphs)) : glyphRows(ch, font, o.strokeGlyphs)))
		);
	// Rows per line: the font's (5 or 7), one more where a descender needs it.
	const rowsPer = lines.reduce((m, gs) => gs.reduce((n, g) => Math.max(n, g.length), m), font === 'large' ? 7 : 5);
	const lineWidth = (gs: string[][]) => gs.reduce((w, g, i) => w + g[0].length + (i ? gap : 0), 0);
	const w = Math.min(
		LABEL_MAX_W,
		lines.reduce((m, l) => Math.max(m, lineWidth(l)), 0)
	);
	const h = Math.min(LABEL_MAX_H, lines.length * rowsPer + (lines.length - 1) * lineGap);
	const lv = new Uint8Array(w * h);
	lines.forEach((gs, li) => {
		const lw = lineWidth(gs);
		let x = o.align === 'left' ? 0 : o.align === 'right' ? w - lw : Math.floor((w - lw) / 2);
		const y0 = li * (rowsPer + lineGap);
		for (const g of gs) {
			g.forEach((row, gy) => {
				for (let gx = 0; gx < row.length; gx++) {
					const px = x + gx;
					const py = y0 + gy;
					if (row[gx] === '#' && px >= 0 && px < w && py < h) lv[py * w + px] = 3;
				}
			});
			x += g[0].length + gap;
		}
	});
	return { w, h, lv };
}

/**
 * Join diagonals: each cell becomes 2 × 2 half-cells, and wherever two cells touch only at a corner (the other two of
 * their 2 × 2 empty) the two empty half-cells at that corner are filled — add only, so square corners stay square and
 * a one-cell diagonal (or an X's crossing) becomes one stroke of half-cell steps.
 */
export function bridgeCells(c: Cells): Cells {
	const w = c.w * 2;
	const h = c.h * 2;
	const lv = new Uint8Array(w * h);
	const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < c.w && y < c.h ? c.lv[y * c.w + x] : 0);
	for (let y = 0; y < c.h; y++)
		for (let x = 0; x < c.w; x++) {
			const v = at(x, y);
			lv[2 * y * w + 2 * x] =
				lv[2 * y * w + 2 * x + 1] =
				lv[(2 * y + 1) * w + 2 * x] =
				lv[(2 * y + 1) * w + 2 * x + 1] =
					v;
		}
	const fill = (x: number, y: number, v: number) => {
		if (!lv[y * w + x]) lv[y * w + x] = v;
	};
	for (let y = -1; y < c.h; y++)
		for (let x = -1; x < c.w; x++) {
			const tl = at(x, y);
			const tr = at(x + 1, y);
			const bl = at(x, y + 1);
			const br = at(x + 1, y + 1);
			// The corner shared by the four cells is at half-cell (2x + 2, 2y + 2).
			if (tl && br && !tr && !bl) {
				fill(2 * x + 2, 2 * y + 1, Math.max(tl, br));
				fill(2 * x + 1, 2 * y + 2, Math.max(tl, br));
			}
			if (tr && bl && !tl && !br) {
				fill(2 * x + 1, 2 * y + 1, Math.max(tr, bl));
				fill(2 * x + 2, 2 * y + 2, Math.max(tr, bl));
			}
		}
	return { w, h, lv };
}

/** Bold on the bitmap: every set cell also sets the `k` cells to its right (the advance was widened for it). */
function emboldenCells(c: Cells, k: number): Cells {
	const lv = new Uint8Array(c.lv.length);
	for (let y = 0; y < c.h; y++) lv.set(boldRow(c.lv.subarray(y * c.w, (y + 1) * c.w), k, c.w), y * c.w);
	return { w: c.w, h: c.h, lv };
}

/**
 * The outline of the filled cells as closed loops on the cell-corner lattice (filled on the right, y down), one vertex
 * per cell edge: diagonal neighbours join (a loop turns left where two cells touch at a corner), so one-cell diagonal
 * lines stay one line.
 */
function outlineLoops(c: Cells): [number, number][][] {
	const W = c.w;
	const H = c.h;
	const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && c.lv[y * W + x] > 0;
	const DX = [1, 0, -1, 0];
	const DY = [0, 1, 0, -1];
	// Edges by start vertex: (vertex, direction) — 0 right, 1 down, 2 left, 3 up.
	const V = W + 1;
	const outs = new Map<number, number[]>();
	const add = (x: number, y: number, d: number) => {
		const k = y * V + x;
		const l = outs.get(k);
		if (l) l.push(d);
		else outs.set(k, [d]);
	};
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			if (!filled(x, y)) continue;
			if (!filled(x, y - 1)) add(x, y, 0);
			if (!filled(x + 1, y)) add(x + 1, y, 1);
			if (!filled(x, y + 1)) add(x + 1, y + 1, 2);
			if (!filled(x - 1, y)) add(x, y + 1, 3);
		}
	const loops: [number, number][][] = [];
	for (const [k0, l0] of outs) {
		while (l0.length) {
			let x = k0 % V;
			let y = Math.floor(k0 / V);
			let d = l0.pop()!;
			const pts: [number, number][] = [];
			for (let guard = 0; guard < 4 * (W + 1) * (H + 1); guard++) {
				pts.push([x, y]);
				x += DX[d];
				y += DY[d];
				const l = outs.get(y * V + x);
				if (!l || !l.length) break;
				const left = (d + 3) % 4;
				const i = l.length > 1 && l.includes(left) ? l.indexOf(left) : l.length - 1;
				d = l.splice(i, 1)[0];
			}
			if (pts.length >= 4) loops.push(pts);
		}
	}
	return loops;
}

/**
 * Chaikin corner cutting: `r` of each edge cut off at either end (0.25 → a quadratic B-spline). Closed loops, or open
 * runs (`closed` false), whose first and last points stay and whose end edges are cut at their inner end only.
 */
function chaikin(loops: [number, number][][], r: number, iterations: number, closed = true): [number, number][][] {
	let ls = loops;
	for (let it = 0; it < iterations; it++)
		ls = ls.map((l) => {
			const L = l.length;
			const cut = l.slice(0, closed ? L : L - 1).flatMap(([ax, ay], i) => {
				const [bx, by] = l[(i + 1) % L];
				const out: [number, number][] = [];
				if (closed || i > 0) out.push([ax + (bx - ax) * r, ay + (by - ay) * r]);
				if (closed || i < L - 2) out.push([ax + (bx - ax) * (1 - r), ay + (by - ay) * (1 - r)]);
				return out;
			});
			return closed ? cut : [l[0], ...cut, l[L - 1]];
		});
	return ls;
}

type Pt = [number, number];

/** Douglas–Peucker on an open run (keeps its ends): the vertices more than `eps` off the simplified line. */
function simplifyRun(pts: Pt[], eps: number): Pt[] {
	const keep = new Uint8Array(pts.length);
	keep[0] = keep[pts.length - 1] = 1;
	const stack: [number, number][] = [[0, pts.length - 1]];
	while (stack.length) {
		const [i, j] = stack.pop()!;
		const [ax, ay] = pts[i];
		const [bx, by] = pts[j];
		const L = Math.hypot(bx - ax, by - ay);
		// The farthest vertex (from the chord; from its end when the run closes on itself); near-ties go to the one nearest
		// the run's middle, so a run walked the other way (the mirror side of a symmetric shape) splits at the mirror vertex.
		let far = -1;
		let fd = eps;
		const mid = (i + j) / 2;
		for (let k = i + 1; k < j; k++) {
			const d =
				L > 1e-9
					? Math.abs((bx - ax) * (pts[k][1] - ay) - (by - ay) * (pts[k][0] - ax)) / L
					: Math.hypot(pts[k][0] - ax, pts[k][1] - ay);
			if (d > fd + 1e-6 || (d > fd - 1e-6 && far >= 0 && Math.abs(k - mid) < Math.abs(far - mid))) {
				fd = Math.max(fd, d);
				far = k;
			}
		}
		if (far >= 0) {
			keep[far] = 1;
			stack.push([i, far], [far, j]);
		}
	}
	return pts.filter((_, k) => keep[k]);
}

/**
 * A closed loop with its staircase runs fitted by straight segments (within `eps` cells). The loop is cut at its corners
 * first — vertices where the direction over five edges either side turns by more than 70° (the sharpest of a cluster)
 * — so runs straighten between corners that stay put; small loops (≤ 24 edges: dots, bars) stay as they are.
 */
function simplifyLoop(l: Pt[], eps: number): Pt[] {
	const n = l.length;
	if (n <= 24 || eps <= 0) return l;
	const W = 5;
	const turn = l.map((p, i) => {
		const a = l[(i - W + n) % n];
		const b = l[(i + W) % n];
		const a1 = Math.atan2(p[1] - a[1], p[0] - a[0]);
		const a2 = Math.atan2(b[1] - p[1], b[0] - p[0]);
		return Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
	});
	const corners: number[] = [];
	for (let i = 0; i < n; i++) {
		if (turn[i] < (70 * Math.PI) / 180) continue;
		let peak = true;
		// The sharpest within W either side; ties all count (a flat tip keeps both its corners — symmetric either way round).
		for (let k = 1; k <= W && peak; k++)
			if (turn[(i + k) % n] > turn[i] + 1e-9 || turn[(i - k + n) % n] > turn[i] + 1e-9) peak = false;
		if (peak) corners.push(i);
	}
	if (corners.length < 2) {
		let far = 0;
		let fd = -1;
		l.forEach(([x, y], i) => {
			const d = (x - l[0][0]) ** 2 + (y - l[0][1]) ** 2;
			if (d > fd) {
				fd = d;
				far = i;
			}
		});
		corners.length = 0;
		corners.push(0, far);
	}
	const out: Pt[] = [];
	corners.forEach((c, k) => {
		const e = corners[(k + 1) % corners.length];
		const run: Pt[] = [];
		for (let i = c; ; i = (i + 1) % n) {
			run.push(l[i]);
			if (i === e) break;
		}
		out.push(...simplifyRun(run, eps).slice(0, -1));
	});
	return out;
}

/** Extra vertices `rho` in from both ends of every longer edge, so corner cutting rounds only within `rho` of a corner. */
function guardCorners(l: Pt[], rho: number): Pt[] {
	return l.flatMap(([ax, ay], i) => {
		const [bx, by] = l[(i + 1) % l.length];
		const L = Math.hypot(bx - ax, by - ay);
		if (L <= 2 * rho) return [[ax, ay] as Pt];
		const f = rho / L;
		return [
			[ax, ay],
			[ax + (bx - ax) * f, ay + (by - ay) * f],
			[bx - (bx - ax) * f, by - (by - ay) * f]
		] as Pt[];
	});
}

/**
 * Smoothed outline loops. Up to `a` = 1 each staircase edge is cut back toward its middle (at 1 the loop runs
 * through the edge midpoints — 1:1 staircases turn straight, one-cell diagonal lines √½ wide), then Chaikin rounds it.
 * From 1 to 2 the uneven staircase runs between corners are fitted by straight segments (up to a cell off at 2), corners rounded within half
 * a cell; beyond 2 the fit loosens and the corner rounds grow (to 3½ cells at 4).
 */
function smoothLoops(c: Cells, a: number): Pt[][] {
	const k = Math.min(1, Math.max(0, a));
	// Each edge's ends cut back toward its middle (one corner cut at ratio k/2: the same from either direction, so a
	// symmetric drawing stays symmetric); at 1 only the midpoints are left.
	const mid = chaikin(outlineLoops(c), 0.5 * k, 1).map((l) =>
		l.filter((p, i) => {
			const q = l[(i + 1) % l.length];
			return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 1e-9;
		})
	);
	if (a <= 1) return chaikin(mid, 0.25 * Math.min(1, 2 * k), 4);
	const eps = Math.min(1, a - 1) + 0.4 * Math.max(0, a - 2);
	const rho = 0.5 + 1.5 * Math.max(0, a - 2);
	return chaikin(
		mid.map((l) => guardCorners(simplifyLoop(l, eps), rho)),
		0.25,
		4
	);
}

/** Fills closed loops (cell units) even–odd on a grid N× finer with `margin` coarse cells round the bitmap. */
function fillLoops(loops: [number, number][][], w: number, h: number, N: number, margin: number): Uint8Array {
	const rows: number[][] = Array.from({ length: h }, () => []);
	for (const l of loops)
		l.forEach(([ax, ay], i) => {
			const [bx, by] = l[(i + 1) % l.length];
			if (ay === by) return;
			// Fine rows whose centre lies in [min y, max y) cross this edge.
			const fy0 = Math.ceil((Math.min(ay, by) + margin) * N - 0.5);
			const fy1 = Math.ceil((Math.max(ay, by) + margin) * N - 0.5) - 1;
			for (let j = Math.max(0, fy0); j <= Math.min(h - 1, fy1); j++) {
				const yc = (j + 0.5) / N - margin;
				rows[j].push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
			}
		});
	const m = new Uint8Array(w * h);
	rows.forEach((xs, j) => {
		xs.sort((p, q) => p - q);
		for (let k = 0; k + 1 < xs.length; k += 2) {
			// Centres on a span's ends count (both ends alike, so mirror images fill alike).
			const i0 = Math.max(0, Math.ceil((xs[k] + margin) * N - 0.5 - 1e-7));
			const i1 = Math.min(w - 1, Math.floor((xs[k + 1] + margin) * N - 0.5 + 1e-7));
			for (let i = i0; i <= i1; i++) m[j * w + i] = 1;
		}
	});
	return m;
}

/**
 * The bitmap with a smoothed outline (smoothLoops), on a grid N× finer (with `margin` empty coarse cells round it),
 * filled even–odd. The level boundaries inside are smoothed the same way (each "level ≥ L" area on its own).
 */
export function smoothCells(c: Cells, amount: number, N: number, margin: number): Cells {
	const w = (c.w + 2 * margin) * N;
	const h = (c.h + 2 * margin) * N;
	const lv = new Uint8Array(w * h);
	let prev: Uint8Array | null = null;
	for (let L = 1; L <= 3; L++) {
		const at = c.lv.map((v) => (v >= L ? 1 : 0));
		if (!at.some((v) => v)) break;
		// The same area as the level below: no new edge, the cells just step up.
		if (!prev || at.some((v, i) => v !== prev![i])) {
			const m = fillLoops(smoothLoops({ w: c.w, h: c.h, lv: at }, amount), w, h, N, margin);
			for (let i = 0; i < w * h; i++) if (m[i] && (L === 1 || lv[i])) lv[i] = L;
		} else for (let i = 0; i < w * h; i++) if (lv[i] === L - 1) lv[i] = L;
		prev = at;
	}
	return { w, h, lv };
}

/**
 * Lettering as strokes (Label with Join diagonals and Smooth outline ≥ 1): the filled cells' centres are joined to
 * their neighbours — side by side, and diagonally where two cells touch only at a corner — and each run between ends
 * and junctions is fitted by straight segments (centres up to half a cell off), drawn as round-ended strokes a cell
 * wide (wider across for bold, which grows them sideways only, so counters keep their height). An X is two straight
 * diagonals crossing in their own diamond, a slash one straight stroke; lone cells are round dots a cell across.
 * Filled on a grid N× finer with `margin` empty cells round the bitmap; all one level (lettering).
 */
export function strokeCells(
	c: Cells,
	N: number,
	margin: number,
	bold = 0,
	keepEnds = true,
	round = 0
): Cells & { sdf: Float32Array } {
	const w = (c.w + 2 * margin) * N;
	const h = (c.h + 2 * margin) * N;
	const lv = new Uint8Array(w * h);
	const on = (x: number, y: number) => x >= 0 && y >= 0 && x < c.w && y < c.h && c.lv[y * c.w + x] > 0;
	const id = (x: number, y: number) => y * c.w + x;
	// Neighbours: the four sides, and the corners where the two cells between are empty (else they already connect).
	const nbr = new Map<number, number[]>();
	for (let y = 0; y < c.h; y++)
		for (let x = 0; x < c.w; x++) {
			if (!on(x, y)) continue;
			const l: number[] = [];
			for (const [dx, dy] of [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1]
			])
				if (on(x + dx, y + dy)) l.push(id(x + dx, y + dy));
			for (const [dx, dy] of [
				[1, 1],
				[-1, 1],
				[1, -1],
				[-1, -1]
			])
				if (on(x + dx, y + dy) && !on(x + dx, y) && !on(x, y + dy)) l.push(id(x + dx, y + dy));
			nbr.set(id(x, y), l);
		}
	// A diagonal run that ends beside a bar runs on into the bar's corner cell rather than turning into it through a
	// one-cell stub (a z's diagonal, an M's shoulders): where a cell's only diagonal continues straight back into a
	// filled cell it touches at a corner (the two cells between: one filled), that corner joins and the stub goes.
	const unlink = (a: number, b: number) => {
		nbr.set(
			a,
			nbr.get(a)!.filter((n) => n !== b)
		);
		nbr.set(
			b,
			nbr.get(b)!.filter((n) => n !== a)
		);
	};
	for (const [k, l] of [...nbr]) {
		const x = k % c.w;
		const y = Math.floor(k / c.w);
		const diag = l.filter((n) => n % c.w !== x && Math.floor(n / c.w) !== y);
		if (diag.length !== 1) continue;
		const vx = (diag[0] % c.w) - x;
		const vy = Math.floor(diag[0] / c.w) - y;
		const ex = x - vx;
		const ey = y - vy;
		if (!on(ex, ey) || on(ex, y) === on(x, ey)) continue;
		const e = id(ex, ey);
		const shared = on(ex, y) ? id(ex, y) : id(x, ey);
		if (!l.includes(shared) || nbr.get(e)!.includes(k)) continue;
		unlink(k, shared);
		nbr.get(k)!.push(e);
		nbr.get(e)!.push(k);
	}
	const centre = (k: number): Pt => [(k % c.w) + 0.5, Math.floor(k / c.w) + 0.5];
	const seen = new Set<string>();
	const ek = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
	const chains: { pts: Pt[]; closed: boolean }[] = [];
	const walk = (a: number, b: number) => {
		const path = [a, b];
		seen.add(ek(a, b));
		let prev = a;
		let cur = b;
		while ((nbr.get(cur) ?? []).length === 2) {
			const next = nbr.get(cur)!.find((n) => n !== prev)!;
			if (seen.has(ek(cur, next))) break;
			seen.add(ek(cur, next));
			path.push(next);
			prev = cur;
			cur = next;
		}
		return path;
	};
	// Runs from every end or junction, then the loops left over (all their cells joined to two others).
	for (const [k, l] of nbr)
		if (l.length !== 2)
			for (const n of l) if (!seen.has(ek(k, n))) chains.push({ pts: walk(k, n).map(centre), closed: false });
	for (const [k, l] of nbr)
		for (const n of l)
			if (!seen.has(ek(k, n))) {
				const path = walk(k, n);
				chains.push({
					pts: path.slice(0, path[path.length - 1] === path[0] ? -1 : undefined).map(centre),
					closed: true
				});
			}
	// Fit each run, keeping straight cell runs: the ends of every side-by-side run of two steps or more (and, with
	// `keepEnds`, of any such run next to a junction or a stroke's end) stay put, so flat tops, bowls and stems stay flat;
	// only the uneven stairs between them straighten (a slash's pairs).
	const segs: [Pt, Pt][] = [];
	for (const ch of chains) {
		const pts = ch.pts;
		const n = pts.length;
		const m = ch.closed ? n : n - 1; // steps
		const dir = (i: number) => {
			const [ax, ay] = pts[i % n];
			const [bx, by] = pts[(i + 1) % n];
			return `${bx - ax},${by - ay}`;
		};
		const ortho = (i: number) => {
			const [ax, ay] = pts[i % n];
			const [bx, by] = pts[(i + 1) % n];
			return ax === bx || ay === by;
		};
		const anchor = new Uint8Array(n);
		if (!ch.closed) anchor[0] = anchor[n - 1] = 1;
		// Runs of equal steps.
		let i = 0;
		const runs: [number, number][] = [];
		if (ch.closed && m > 0) {
			// Start a closed chain where the direction changes (any run boundary), so no run is split.
			let s0 = 0;
			while (s0 < m && dir(s0) === dir((s0 - 1 + m) % m)) s0++;
			if (s0 === m) s0 = 0;
			i = s0;
			for (let done = 0; done < m;) {
				let len = 1;
				while (len < m && dir((i + len) % m) === dir(i % m)) len++;
				runs.push([i % m, len]);
				i += len;
				done += len;
			}
		} else {
			while (i < m) {
				let len = 1;
				while (i + len < m && dir(i + len) === dir(i)) len++;
				runs.push([i, len]);
				i += len;
			}
		}
		const step = (k: number): Pt => {
			const [ax, ay] = pts[(((k % m) + m) % m) % n];
			const [bx, by] = pts[((((k % m) + m) % m) + 1) % n];
			return [bx - ax, by - ay];
		};
		const turn = (u: Pt, v: Pt) => Math.sign(u[0] * v[1] - u[1] * v[0]);
		for (const [r0, len] of runs) {
			const atEnd = !ch.closed && (r0 === 0 || r0 + len === m);
			// A single side-by-side step is kept where the stroke turns the same way into and out of it (the bottom of a
			// J, the flat of a cup); between turns the other way it is a stair of a slant (a slash's pairs) and straightens.
			const hasPrev = ch.closed || r0 > 0;
			const hasNext = ch.closed || r0 + len < m;
			const cup =
				hasPrev &&
				hasNext &&
				turn(step(r0 - 1), step(r0)) !== 0 &&
				turn(step(r0 - 1), step(r0)) === turn(step(r0 + len - 1), step(r0 + len));
			if (ortho(r0) && (len >= 2 || cup || (atEnd && keepEnds))) {
				anchor[r0 % n] = 1;
				anchor[(r0 + len) % n] = 1;
			}
		}
		const idx = [...anchor.keys()].filter((k) => anchor[k]);
		let fitted: Pt[];
		if (!idx.length) fitted = ch.closed ? simplifyLoop(pts, 0.5) : simplifyRun(pts, 0.5);
		else {
			// Between anchors (round the loop when closed).
			fitted = [];
			const spans = ch.closed ? idx.length : idx.length - 1;
			for (let k = 0; k < spans; k++) {
				const a = idx[k];
				const e = idx[(k + 1) % idx.length];
				const run: Pt[] = [];
				for (let j = a; ; j = (j + 1) % n) {
					run.push(pts[j]);
					if (j === e && run.length > 1) break;
				}
				fitted.push(...simplifyRun(run, 0.5).slice(0, -1));
			}
			if (!ch.closed) fitted.push(pts[n - 1]);
		}
		// Smooth outline beyond 1: the stroke's own corners cut into curves (Chaikin on its centre line; a run's ends and a
		// stroke's ends stay), so bends round off inside and out, with no bulge.
		if (round > 0 && fitted.length > 2) fitted = chaikin([fitted], round, 3, ch.closed)[0];
		const fn = fitted.length;
		for (let j = 0; j + 1 < (ch.closed ? fn + 1 : fn); j++) segs.push([fitted[j], fitted[(j + 1) % fn]]);
	}
	// Dots: cells joined to nothing.
	for (const [k, l] of nbr) if (!l.length) segs.push([centre(k), centre(k)]);
	// A round-ended stroke per segment, half a cell either side; bold sweeps it a cell sideways too (a rounded
	// parallelogram): wider uprights, counters as tall, the same round ends. The distance to the strokes is exact —
	// worked out at every fine cell's centre within the margin of each stroke — so slanted strokes have clean edges.
	const r = 0.5;
	const hb = 0.5 * bold;
	const sdf = new Float32Array(w * h).fill(margin * N);
	const segDist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
		const ex = bx - ax;
		const ey = by - ay;
		const ee = ex * ex + ey * ey;
		const t = ee > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / ee)) : 0;
		return (px - ax - ex * t) ** 2 + (py - ay - ey * t) ** 2;
	};
	for (const [[ax0, ay], [bx0, by]] of segs) {
		// Shifted by half the extra width, so the letter stays in its widened advance.
		const ax = ax0 + hb;
		const bx = bx0 + hb;
		// The fine cells within `margin` cells of the stroke (fine cell i is at (i + 0.5) / N − margin).
		const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - hb) * N));
		const i1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + hb + 2 * margin) * N));
		const j0 = Math.max(0, Math.floor(Math.min(ay, by) * N));
		const j1 = Math.min(h - 1, Math.ceil((Math.max(ay, by) + 2 * margin) * N));
		for (let j = j0; j <= j1; j++)
			for (let i = i0; i <= i1; i++) {
				const px = (i + 0.5) / N - margin;
				const py = (j + 0.5) / N - margin;
				// Signed distance to the swept parallelogram (a segment when not bold), less the pen's radius.
				let d2 = Math.min(segDist2(px, py, ax - hb, ay, bx - hb, by), segDist2(px, py, ax + hb, ay, bx + hb, by));
				let inside = false;
				if (hb > 0) {
					d2 = Math.min(d2, segDist2(px, py, ax - hb, ay, ax + hb, ay), segDist2(px, py, bx - hb, by, bx + hb, by));
					const ey = by - ay;
					if (Math.abs(ey) > 1e-9) {
						const t = (py - ay) / ey;
						inside = t > 0 && t < 1 && Math.abs(px - (ax + (bx - ax) * t)) < hb;
					}
				}
				const d = ((inside ? -Math.sqrt(d2) : Math.sqrt(d2)) - r) * N;
				const k = j * w + i;
				if (d < sdf[k]) sdf[k] = d;
			}
	}
	for (let k = 0; k < w * h; k++) lv[k] = sdf[k] < 0 ? 3 : 0;
	return { w, h, lv, sdf };
}

/**
 * For every cell of a W × H grid, the nearest cell (index) where `target` holds — nearest from the cell's centre to
 * that cell's square. Jump flooding (+ one extra pass of 1), near-exact; -1 where there is none.
 */
function nearestCells(W: number, H: number, target: (i: number) => boolean): Int32Array {
	let cur = new Int32Array(W * H).fill(-1);
	let nxt = new Int32Array(W * H);
	for (let i = 0; i < W * H; i++) if (target(i)) cur[i] = i;
	const steps: number[] = [];
	for (let k = 1 << Math.ceil(Math.log2(Math.max(W, H, 2))); k >= 1; k >>= 1) steps.push(k);
	steps.push(1);
	for (const k of steps) {
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				let best = cur[y * W + x];
				let bd = best >= 0 ? cellDist2(W, x, y, best) : Infinity;
				for (let dy = -k; dy <= k; dy += k)
					for (let dx = -k; dx <= k; dx += k) {
						const nx = x + dx;
						const ny = y + dy;
						if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
						const s = cur[ny * W + nx];
						if (s < 0 || s === best) continue;
						const d = cellDist2(W, x, y, s);
						if (d < bd) {
							bd = d;
							best = s;
						}
					}
				nxt[y * W + x] = best;
			}
		[cur, nxt] = [nxt, cur];
	}
	return cur;
}

/** Squared distance from the centre of cell (x, y) to the square of cell s (cells of a W-wide grid). */
function cellDist2(W: number, x: number, y: number, s: number): number {
	const dx = Math.max(Math.abs(x - (s % W)) - 0.5, 0);
	const dy = Math.max(Math.abs(y - Math.floor(s / W)) - 0.5, 0);
	return dx * dx + dy * dy;
}

/** The distance from the centre of cell i to the square of cell s, signed (negative inside). */
const cellDist = (W: number, i: number, s: number, inside: boolean) =>
	Math.sqrt(cellDist2(W, i % W, Math.floor(i / W), s)) * (inside ? -1 : 1);

/** A bitmap's levels as a short key: its size and a 32-bit FNV-1a hash of the cells. */
function cellsKey(c: Cells): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < c.lv.length; i++) h = Math.imul(h ^ c.lv[i], 0x01000193);
	return `${c.w}x${c.h}#${(h >>> 0).toString(36)}`;
}

interface StampMap {
	/** Empty cells kept round the bitmap (bitmap cells). */
	margin: number;
	/** Smoothed outline (0 = the pixel outline, exact): its amount, 0..1. */
	smooth?: number;
	/** Fine cells per bitmap cell for the smoothed outline. */
	fine?: number;
	/** The cells are already this many per bitmap cell (2 after the corner bridges). */
	pre?: number;
	/** Lettering as strokes (strokeCells) on the fine grid, with this bold (0 or 1). */
	strokes?: { bold: number };
}

interface Grid {
	W: number;
	H: number;
	lv: Uint8Array;
	/** Exact signed distances at the cell centres (cells), when known (strokes) — else from the cells. */
	sdf?: Float32Array;
	/** Cells per bitmap cell. */
	N: number;
	/** Margin in grid cells. */
	M: number;
	smooth: boolean;
}
const gridCache = new Lru<Grid>(24);

/** The grid the shader samples: the bitmap (or its smoothed outline, N× finer) with the margin round it. Cached. */
function stampGrid(c: Cells, o: StampMap): Grid {
	const smooth = (o.smooth ?? 0) > 0;
	const N = smooth ? Math.max(1, Math.round(o.fine ?? 4)) : 1;
	const M = o.margin * N;
	// (pre too: the texture's header holds it.)
	const key = `${cellsKey(c)}:${o.margin}:${o.pre ?? 1}:${smooth ? `${o.smooth}:${N}` : 0}:${o.strokes ? `s${o.strokes.bold}` : ''}`;
	return gridCache.get(key, (): Grid => {
		if (smooth && o.strokes) {
			// Straight runs of two steps (three cells) and more always stay; from Smooth outline 1.5 the single steps next to
			// a junction or a stroke's end straighten too, and beyond 1 the strokes' bends round off (corner cutting up to a
			// quarter of each segment at 2).
			const a = o.smooth ?? 1;
			const f = strokeCells(c, N, o.margin, o.strokes.bold, a < 1.5, 0.25 * Math.min(1, Math.max(0, a - 1)));
			return { W: f.w, H: f.h, lv: f.lv, sdf: f.sdf, N, M, smooth };
		}
		if (smooth) {
			const f = smoothCells(c, o.smooth!, N, o.margin);
			return { W: f.w, H: f.h, lv: f.lv, N, M, smooth };
		}
		const W = c.w + 2 * M;
		const H = c.h + 2 * M;
		const lv = new Uint8Array(W * H);
		for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) lv[(y + M) * W + x + M] = c.lv[y * c.w + x];
		return { W, H, lv, N, M, smooth };
	});
}

const texCache = new WeakMap<Grid, CpuTexture>();
const lvCache = new WeakMap<Grid, CpuTexture>();
const EMPTY_TEX: CpuTexture = { width: 2, height: 1, data: new Uint8Array(8) };
const hasCells = (c: Cells) => c.w > 0 && c.h > 0 && c.lv.some((v) => v > 0);
/** A signed distance in cells as 16 bits, 1/16 cell steps, into data[at] (low byte) and data[at + 1]. */
function put16(data: Uint8Array, at: number, d: number): void {
	const v = Math.max(-32768, Math.min(32767, Math.round(d * 16))) & 0xffff;
	data[at] = v & 255;
	data[at + 1] = v >> 8;
}
/** A cell's x and y (12 bits each) as three bytes: their low bytes, then their high nibbles (stm_cell decodes it). */
const packCell = (x: number, y: number) => [x & 255, y & 255, ((x >> 8) & 15) | (((y >> 8) & 15) << 4)];

/**
 * The shader's data texture: the bitmap with a margin of empty cells round it, one texel per cell, R = level (bits
 * 0–1) | the level of the nearest cell of the other state (bits 2–3). Exact (pixel) outline: G/B/A = that cell's x and
 * y (12 bits each: G, B the low bytes, A the high nibbles). Smoothed outline (on a finer grid): G/B = the signed
 * distance from the cell's centre to the outline, 1/16 cell steps (16-bit). One extra row on top: texel 0 = the
 * bitmap's size in cells, texel 1 = the margin (16-bit), cells per bitmap cell, outline mode (0 exact, 1 smooth).
 */
export function stampTexture(c: Cells, o: StampMap): CpuTexture {
	if (!hasCells(c)) return EMPTY_TEX;
	const g = stampGrid(c, o);
	const hit = texCache.get(g);
	if (hit) return hit;
	const { W, H, lv, N, M, smooth, sdf } = g;
	const toEmpty = sdf ? new Int32Array(0) : nearestCells(W, H, (i) => lv[i] === 0);
	const toFilled = sdf ? new Int32Array(0) : nearestCells(W, H, (i) => lv[i] > 0);
	const width = Math.max(W, 2);
	const data = new Uint8Array(width * (H + 1) * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x;
			const t = (y * width + x) * 4;
			if (sdf) {
				// Strokes: one level, their exact distance.
				data[t] = lv[i] | (3 << 2);
				put16(data, t + 1, sdf[i]);
				continue;
			}
			const n = lv[i] > 0 ? toEmpty[i] : toFilled[i];
			data[t] = lv[i] | ((n >= 0 ? lv[n] : 0) << 2);
			if (smooth) put16(data, t + 1, n >= 0 ? cellDist(W, i, n, lv[i] > 0) : 0);
			else data.set(n >= 0 ? packCell(n % W, Math.floor(n / W)) : packCell(x, y), t + 1);
		}
	const bw = c.w * N;
	const bh = c.h * N;
	data.set([bw & 255, bw >> 8, bh & 255, bh >> 8, M & 255, M >> 8, N * (o.pre ?? 1), smooth ? 1 : 0], H * width * 4);
	const tex = { width, height: H + 1, data };
	texCache.set(g, tex);
	return tex;
}

/**
 * For Level relief, on the same grid: the edges of the "level ≥ 2" and "level ≥ 3" areas. Exact outline: two texels
 * per cell (x·2 + L − 2) holding, like the outline's, the nearest cell across that edge — R, G the low bytes of its x
 * and y, B their high nibbles, A bit 0 = the cell is in the area, bit 1 = the area exists — so level steps are as
 * square as the colours. Smoothed outline: one texel per cell, the signed centre distances (R, G: "≥ 2"; B, A: "≥ 3";
 * 16 bits, 1/16 cell), read bilinearly like the outline.
 */
function levelTexture(c: Cells, o: StampMap): CpuTexture {
	if (!hasCells(c)) return EMPTY_TEX;
	const g = stampGrid(c, o);
	const hit = lvCache.get(g);
	if (hit) return hit;
	const { W, H, lv, smooth } = g;
	const per = smooth ? 1 : 2;
	const data = new Uint8Array(W * per * H * 4);
	for (const L of [2, 3]) {
		const any = lv.some((v) => v >= L);
		const below = any ? nearestCells(W, H, (i) => lv[i] < L) : null;
		const above = any ? nearestCells(W, H, (i) => lv[i] >= L) : null;
		for (let i = 0; i < W * H; i++) {
			const n = !below || !above ? -1 : lv[i] >= L ? below[i] : above[i];
			if (smooth) put16(data, i * 4 + (L - 2) * 2, n < 0 ? 2047 : cellDist(W, i, n, lv[i] >= L));
			else {
				// Texel x·2 + L − 2 of row y: the nearest cell across the edge (itself when there is none).
				const m = n >= 0 ? n : i;
				data.set([...packCell(m % W, Math.floor(m / W)), (lv[i] >= L ? 1 : 0) | (any ? 2 : 0)], (i * 2 + L - 2) * 4);
			}
		}
	}
	const tex = { width: W * per, height: H, data };
	lvCache.set(g, tex);
	return tex;
}

/** Empty cells kept round the bitmap: enough for distances out past a Grow (beyond them they are approximate). */
function marginFor(q: ParamValues): number {
	const reach = Math.ceil(Math.max(0, Number(q.grow ?? 0)) / Math.max(0.01, Number(q.scale ?? 1))) + 3;
	let m = 4;
	while (m < reach && m < 64) m *= 2;
	return m;
}

interface LayerMaps {
	/** Label with Join diagonals and Smooth outline ≥ 1: lettering as strokes (bold drawn by the pen). */
	strokes?: boolean;
	/** Label with Join diagonals: Bold applied here, after the join (textCells only widened the advance). */
	boldLate?: boolean;
	/** Stamp: the `lv` texture too (Level relief, anti-aliased level colours) — 1 × 1 when the bitmap doesn't need it. */
	levels?: boolean;
}

/**
 * A layer's data textures (`stamp`, and with `levels` the `lv` one): its margin, and for a smoothed outline a grid
 * fine enough for ~1 px cells.
 */
function layerTextures(c0: Cells, q: ParamValues, opts: LayerMaps = {}): Record<string, CpuTexture> {
	const strokes = Boolean(opts.strokes);
	// Join diagonals: half-cells with the corner bridges, then (Label) bold — after the join, so bold diagonals stay
	// even.
	const pre = q.join && !strokes ? 2 : 1;
	const joined = pre > 1 ? bridgeCells(c0) : c0;
	const c = q.bold && opts.boldLate && !strokes ? emboldenCells(joined, pre) : joined;
	const margin = marginFor(q) * pre;
	const smooth = Math.min(4, Math.max(0, Number(q.smooth ?? 0)));
	const want = Math.ceil(Math.max(0.01, Number(q.scale ?? 1)) / pre / 1.25);
	const room = Math.floor(320 / (Math.max(c.w, c.h) + 2 * margin));
	const o: StampMap =
		smooth > 0
			? {
					margin,
					smooth,
					fine: Math.max(2, Math.min(8, want, room)),
					pre,
					...(strokes ? { strokes: { bold: q.bold ? 1 : 0 } } : {})
				}
			: { margin, pre };
	if (!opts.levels) return { stamp: stampTexture(c, o) };
	// Level edges: for Level relief, and for anti-aliased level colours (Random per level) — only with two levels or more.
	const levels = new Set(c.lv).size - (c.lv.includes(0) ? 1 : 0);
	const wantLv = levels > 1 && (Number(q.lvl_h ?? 0) > 0 || (q.aa !== false && q.rnd_by !== 'instance'));
	return {
		stamp: stampTexture(c, o),
		lv: wantLv ? levelTexture(c, o) : { width: 1, height: 1, data: new Uint8Array(4) }
	};
}

// ------------------------------------------------------------------------------------------------ Stamp / Label

const repeats = (p: ParamValues) => Number(p.count_x) > 1 || Number(p.count_y) > 1;

const placement: ParamDef[] = [
	P.float('x', 'Centre X', 0.5, -2, 3, {
		softMin: 0,
		softMax: 1,
		step: 0.001,
		hint: 'Moves the centre left or right (0…1 across)'
	}),
	P.float('y', 'Centre Y', 0.5, -2, 3, {
		softMin: 0,
		softMax: 1,
		step: 0.001,
		hint: 'Moves the centre up or down (0…1 down)'
	}),
	P.float('scale', 'Pixel size', 1, 0.25, 256, {
		softMax: 32,
		unit: 'px',
		step: 0.05,
		hint: 'How many texture px each bitmap cell takes up (whole numbers keep the cells crisp on the pixel grid)'
	}),
	P.enum(
		'rotate',
		'Rotate',
		'0',
		[
			['0', '0°'],
			['90', '90°'],
			['180', '180°'],
			['270', '270°']
		],
		{ hint: 'Turns the stamp in quarter turns, clockwise, keeping the cells on the pixel grid' }
	),
	P.float('angle', 'Angle', 0, -360, 360, {
		softMin: -180,
		softMax: 180,
		unit: '°',
		step: 0.1,
		hint: 'Turns the stamp freely on top of the quarter turns, clockwise. Off the quarter turns the cell edges leave the pixel grid, so keep Anti-alias on'
	}),
	P.float('grow', 'Grow', 0, -256, 256, {
		softMin: -8,
		softMax: 16,
		unit: 'px',
		step: 0.1,
		hint: 'Pushes the outline out (rounding the outer corners: bold, blobby lettering) or pulls it in (thinner, rounding the inner corners)'
	}),
	P.float('outline', 'Outline', 0, 0, 512, {
		softMax: 16,
		unit: 'px',
		step: 0.1,
		hint: 'Hollows the stamp out, leaving only a stroke of this width inside the outline (0 = solid)'
	}),
	P.float('smooth', 'Smooth outline', 0, 0, 4, {
		softMax: 2,
		step: 0.001,
		hint: 'Smooths the pixel staircase of the outline (0 = the exact pixel outline: crisp, but a bevel wider than about a cell follows every stair and spikes inward at each step, so raise this for wide bevels). Up to 1, the staircase rounds into curves (45° steps become straight diagonals), like a stamp drawn small and shown large; from 1 to 2, uneven stair runs straighten into the sides they suggest; beyond 2, corners round further. For lettering with Join diagonals (strokes from 1), beyond 1 the strokes’ bends round off into curves (fully at 2)'
	}),
	P.int('count_x', 'Repeat X', 1, 1, 256, { softMax: 32, group: 'repeat' }),
	P.int('count_y', 'Repeat Y', 1, 1, 256, { softMax: 32, group: 'repeat' }),
	P.enum(
		'step_by',
		'Spacing',
		'gap',
		[
			['step', 'Step', 'sets the distance centre to centre, in px'],
			[
				'gap',
				'Gap',
				'sets the space between neighbouring repeats (the step is their size plus the gap), following the pixel size and rotation'
			]
		],
		{ group: 'repeat', showIf: repeats }
	),
	P.float('step_x', 'Step X', 16, 0, 4096, {
		softMax: 256,
		unit: 'px',
		axis: 'x',
		step: 0.5,
		group: 'repeat',
		showIf: (p) => Number(p.count_x) > 1 && p.step_by !== 'gap',
		hint: 'Spaces the repeats this far apart, centre to centre; they can overlap (and merge)'
	}),
	P.float('step_y', 'Step Y', 16, 0, 4096, {
		softMax: 256,
		unit: 'px',
		axis: 'y',
		step: 0.5,
		group: 'repeat',
		showIf: (p) => Number(p.count_y) > 1 && p.step_by !== 'gap',
		hint: 'Spaces the rows this far apart, centre to centre; they can overlap (and merge)'
	}),
	P.float('gap_x', 'Gap X', 1, -256, 256, {
		softMin: -4,
		softMax: 16,
		step: 0.05,
		group: 'repeat',
		showIf: (p) => Number(p.count_x) > 1 && p.step_by === 'gap',
		hint: 'Adds a gap between neighbouring repeats, in cells (follows Pixel size); negative overlaps them (they merge)'
	}),
	P.float('gap_y', 'Gap Y', 1, -256, 256, {
		softMin: -4,
		softMax: 16,
		step: 0.05,
		group: 'repeat',
		showIf: (p) => Number(p.count_y) > 1 && p.step_by === 'gap',
		hint: 'Adds a gap between neighbouring rows, in cells (follows Pixel size); negative overlaps them (they merge)'
	}),
	P.float('skew', 'Row shift', 0, -4096, 4096, {
		softMin: -256,
		softMax: 256,
		unit: 'px',
		axis: 'x',
		step: 0.5,
		group: 'repeat',
		showIf: (p) => Number(p.count_y) > 1,
		hint: 'Shifts each row of repeats sideways for diagonal rivet lines or staggered grids (half the step = brick bond)'
	}),
	P.float('jitter', 'Position jitter', 0, 0, 1024, {
		softMax: 32,
		unit: 'px',
		step: 0.1,
		group: 'repeat',
		showIf: repeats,
		hint: 'Moves each repeat randomly by up to this much (snapped to whole pixels, set by the seed)'
	}),
	P.float('drop', 'Missing repeats', 0, 0, 1, {
		step: 0.001,
		group: 'repeat',
		showIf: repeats,
		hint: 'Leaves out some of the repeats at random, like missing rivets (0 = none, 1 = all; set by the seed)'
	}),
	P.enum(
		'rnd_by',
		'Random per',
		'level',
		[
			[
				'level',
				'Pixel level',
				'follows the cell level ("-" low, "+" mid, "#" full), for multi-tone bitmaps through a Random gradient ramp'
			],
			['instance', 'Repeat', 'gives each repeat a random value, so each rivet can be its own shade or height'],
			['both', 'Level + repeat', 'the level picks a third of the gradient ramp, the repeat a shade within it']
		],
		{
			group: 'repeat',
			hint: 'Picks what the per-feature random value follows (for Random sources, Colour variation, Per-feature variation)'
		}
	),
	P.float('rnd_lo', 'From', 0, 0, 1, {
		step: 0.001,
		group: 'repeat',
		showIf: (p) => p.rnd_by !== 'level',
		join: { with: 'rnd_hi', as: 'pair', label: 'Repeat random range' },
		hint: "Limits each repeat's random value to this part of the gradient ramp (e.g. 0.3 … 1 keeps every repeat clear of a dark base)"
	}),
	P.float('rnd_hi', 'To', 1, 0, 1, { step: 0.001, group: 'repeat', showIf: (p) => p.rnd_by !== 'level' }),
	P.seed('seed', 'Seed', 1, { group: 'repeat' })
];

const stampGroups = [{ id: 'repeat', label: 'Repeat', collapsed: true }];

const defaults = {
	bevel: 0.5,
	profile: 'linear',
	aa: true,
	h_on: true,
	h_amount: 0.6,
	dif_on: true,
	dif_src: 'random'
};

/** Bevel's note on the exact pixel outline: wider than about a cell, it spikes inward at every stair. */
const wideBevelNote = (p: ParamValues) =>
	Number(p.smooth ?? 0) === 0 && Number(p.bevel) > 1.25 * Number(p.scale ?? 1)
		? 'Wider than a cell on the exact pixel outline: the bevel spikes inward at every stair — raise Smooth outline for wide bevels'
		: undefined;

/**
 * A new stamp-like layer, sized to the texture: about `cells` cells across half of it, a bevel a third of a cell (half
 * a pixel at pixel-art sizes: crisp, full height at the edge).
 */
function freshStamp(texture: { width: number; height: number }, cells: number): ParamValues {
	const scale = Math.max(1, Math.round((0.5 * Math.min(texture.width, texture.height)) / cells));
	return { scale, bevel: scale >= 3 ? Math.round(scale * 0.35) : 0.5 };
}

const STAMP_GLSL = /* glsl */ `
ivec4 stm_t(ivec2 c) { return ivec4(texelFetch(t_stamp, c, 0) * 255.0 + 0.5); }
// A stored distance (put16: signed 16 bits, 1/16 cell) from its low and high bytes.
float stm_s16(int lo, int hi) { int raw = lo + hi * 256; return float(raw >= 32768 ? raw - 65536 : raw) / 16.0; }
// Bilinear between four corner values (x, y the top pair, z, w the bottom) at f.
float stm_bilin(vec4 s, vec2 f) { return mix(mix(s.x, s.y, f.x), mix(s.z, s.w, f.x), f.y); }
// A cell stored by packCell: the low bytes of x and y, then their high nibbles.
ivec2 stm_cell(ivec3 t) { return ivec2(t.x + (t.z & 15) * 256, t.y + (t.z >> 4) * 256); }
#ifdef STAMP_IMAGE
// Stamp › Image file: the image's colour (sRGB, straight alpha) at bitmap position b — the pixel itself, or bilinear
// (Smooth image; mixed premultiplied, so transparent pixels don't darken the edge).
vec4 stm_image(vec2 b, vec2 dims) {
  ivec2 m = textureSize(t_img, 0) - 1;
  vec2 bb = clamp(b, vec2(0.0), dims - 1e-3);
  if (!u_img_smooth) return texelFetch(t_img, clamp(ivec2(floor(bb)), ivec2(0), m), 0);
  vec2 g = bb - 0.5;
  ivec2 i0 = ivec2(floor(g));
  vec2 f = g - floor(g);
  vec4 c = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    vec4 t = texelFetch(t_img, clamp(i0 + ivec2(j & 1, j >> 1), ivec2(0), m), 0);
    c += vec4(t.rgb * t.a, t.a) * ((j & 1) == 1 ? f.x : 1.0 - f.x) * ((j >> 1) == 1 ? f.y : 1.0 - f.y);
  }
  return vec4(c.a > 1e-4 ? c.rgb / c.a : vec3(0.0), c.a);
}
#endif

// Bevel aspect: the squared distance from b to the unit cell box at lo (bitmap cells, b outside it) in the stretched
// space Mb maps cell offsets into — to its two faces on b's side (turned by Angle, the box is a parallelogram there and
// the nearest point is not the clamped one).
float stm_box2(vec2 b, vec2 lo, mat2 Mb) {
  vec2 f = lo + step(lo + 0.5, b);
  vec2 ax = Mb * (vec2(f.x, lo.y) - b), ay = Mb * (vec2(lo.x, f.y) - b);
  vec2 vx = ax + Mb[1] * clamp(-dot(ax, Mb[1]) / dot(Mb[1], Mb[1]), 0.0, 1.0);
  vec2 vy = ay + Mb[0] * clamp(-dot(ay, Mb[0]) / dot(Mb[0], Mb[0]), 0.0, 1.0);
  return min(dot(vx, vx), dot(vy, vy));
}

GenOut gen(vec2 p) {
  ivec2 ts = textureSize(t_stamp, 0);
  ivec4 h0 = stm_t(ivec2(0, ts.y - 1));
  ivec2 sz = ivec2(h0.x + h0.y * 256, h0.z + h0.w * 256);
  if (sz.x == 0 || sz.y == 0) return genOut(0.0, 0.0, 0.0, 1e4);
  // Margin, cells per bitmap cell (a smoothed outline is stored finer) and the outline mode.
  ivec4 h1 = stm_t(ivec2(1, ts.y - 1));
  int M = h1.x + h1.y * 256;
  bool smoothMap = h1.w == 1;
  ivec2 mapMax = ivec2(ts.x, ts.y - 1) - 1;
  vec2 dims = vec2(sz);
  bool odd = u_rotate == 1 || u_rotate == 3;
  vec2 outDims = odd ? dims.yx : dims;
  float sc = max(u_scale, 0.01) / float(max(h1.z, 1));
  vec2 hs = outDims * sc * 0.5;
  bool turned = mod(u_angle, 360.0) != 0.0;
  float ca = cos(radians(u_angle));
  float sa = sin(radians(u_angle));
  // How far one repeat reaches from its centre (px).
  vec2 ext = (turned ? vec2(length(hs)) : hs) + max(u_grow, 0.0) + u_jitter + 1.0;

  // Positions with y down from the top.
  vec2 q = vec2(p.x, uRes.y - p.y);
  vec2 centre = vec2(u_x, u_y) * uRes;
  ivec2 cnt = ivec2(u_count_x, u_count_y);
  // Spacing by gap: the repeat's extent (its bounding box when turned) plus the gap.
  vec2 box = turned ? vec2(abs(ca) * hs.x + abs(sa) * hs.y, abs(sa) * hs.x + abs(ca) * hs.y) * 2.0 : hs * 2.0;
  vec2 stp = u_step_by == 1 ? max(box + vec2(u_gap_x, u_gap_y) * max(u_scale, 0.01), 0.0) : vec2(u_step_x, u_step_y);
  vec2 ss = max(stp, 1e-3);
  vec2 c0 = vec2(cnt - 1) * 0.5;
  // The repeats that may reach here, round the torus when tiling (repGrid, in this y-down space). Row shift moves each
  // row its own way: the window reaches as far across as the rows it covers are shifted.
  vec2 sh = vec2(0.0);
  if (u_skew != 0.0 && cnt.y > 1) {
    RepGrid ry = repGrid(ivec2(1, cnt.y), ss, centre, uRes, uTile, q - ext, q + ext);
    sh = vec2(1e9, -1e9);
    for (int k = 0; k < repCount(ry); k++) {
      ivec2 cw;
      vec2 pos;
      repAt(ry, k, cw, pos);
      float s = (float(cw.y) - c0.y) * u_skew;
      sh = vec2(min(sh.x, s), max(sh.y, s));
    }
  }
  RepGrid rg = repGrid(cnt, ss, centre, uRes, uTile, q - ext - vec2(sh.y, 0.0), q + ext - vec2(sh.x, 0.0));
  int nr = repCount(rg);

  // Every repeat in reach (overlapping repeats merge), or the nearest one when none is: one flat loop, the last turn
  // for that nearest one.
  float best = 1e9;
  int bestLv = 0;
  ivec2 bestId = ivec2(0);
  vec2 bestB = vec2(0.0);
  // The two deepest repeats under the pixel (depth, centre): where repeats overlap, depth is taken against the union's
  // outline — √(a² + b²) of the two, so an outline hidden inside the other repeat leaves no groove. Coincident
  // repeats (step 0) count once.
  float dep1 = 0.0;
  float dep2 = 0.0;
  vec2 cen1 = vec2(1e9);
  // Bevel aspect (GLSL_BEVEL) on the exact outline: the distance in the space the aspect stretches, to the same cells
  // (a cell offset → screen px → × Bevel / its width per screen axis), so the bevels meet in clean mitres. Mb maps a
  // bitmap-cell offset there: undo the quarter turns, cells → px, undo Angle. (Even strokes cap each axis' width at 0.4
  // cell, as they cap the bevel.) bestS, sdep1/2: as best, dep1/2.
  bool aspX = bevelAspectOn() && !smoothMap;
  vec2 Wb = bevelWidths();
  if (u_bev_lim) Wb = min(Wb, vec2(0.4 * max(u_scale, 0.01)));
  mat2 Rq = u_rotate == 1 ? mat2(0.0, 1.0, -1.0, 0.0) : u_rotate == 2 ? mat2(-1.0, 0.0, 0.0, -1.0)
          : u_rotate == 3 ? mat2(0.0, -1.0, 1.0, 0.0) : mat2(1.0);
  mat2 Mb = mat2(u_bevel / Wb.x, 0.0, 0.0, u_bevel / Wb.y) * (turned ? mat2(ca, sa, -sa, ca) : mat2(1.0)) * Rq * sc;
  // The cells searched round the pixel's: 3×3, or 5×5 with the aspect — the nearest cell in the stretched space can lie
  // a cell or two along an edge from the nearest one (the candidates are those cells and their own nearest ones).
  int nb = aspX ? 5 : 3;
  float bestS = 1e9;
  float sdep1 = 0.0;
  float sdep2 = 0.0;
  bool reached = false;
  float farD = 1e20;
  ivec2 farId = ivec2(-1);
  vec2 farC = vec2(0.0);
  for (int k = 0; k <= nr; k++) {
    // (No continue: ANGLE / D3D11 can miscompile it in a loop — the body is skipped by a flag instead.)
    ivec2 id = farId;
    vec2 ic = farC;
    bool use = k == nr && !reached && farId.x >= 0;
    if (k < nr) {
      vec2 pos;
      repAt(rg, k, id, pos);
      // The repeat's centre (before jitter): its place on the grid (Step 0 stacks them), its row shifted.
      ic = pos + (vec2(id) - c0) * (stp - ss) + vec2((float(id.y) - c0.y) * u_skew, 0.0);
      bool kept = !(u_drop > 0.0 && hashI(id, uSeed + 31.0) < u_drop);
      vec2 o = abs(q - ic);
      use = kept && o.x <= ext.x && o.y <= ext.y;
      reached = reached || use;
      if (kept && !use && length(q - ic) < farD) { farD = length(q - ic); farId = id; farC = ic; }
    }
    if (use) {
      if (u_jitter > 0.0) ic += (hash2I(id, uSeed + 17.0) * 2.0 - 1.0) * u_jitter;
      // The repeat's top-left corner snapped to the pixel grid (whole pixel sizes stay crisp), the pixel in its cells.
      vec2 tl = floor(ic - hs + 0.5);
      vec2 lp = q - tl;
      if (turned) { vec2 r = lp - hs; lp = hs + vec2(ca * r.x + sa * r.y, ca * r.y - sa * r.x); }
      vec2 ob = lp / sc;
      // Output cell space → bitmap cell space.
      vec2 b = u_rotate == 1 ? vec2(ob.y, dims.y - ob.x)
             : u_rotate == 2 ? dims - ob
             : u_rotate == 3 ? vec2(dims.x - ob.y, ob.x)
             : ob;

      ivec2 cell = ivec2(floor(b)) + M;
      ivec2 tc = clamp(cell, ivec2(0), mapMax);
      ivec4 t0 = stm_t(tc);
      float d;
      float dS = 0.0;
      int lvl;
      if (smoothMap) {
        // Smoothed outline: the stored distances at the cell centres, bilinear (outside the margin: plus the way to it).
        vec2 g = b - 0.5;
        ivec2 g0 = ivec2(floor(g)) + M;
        vec4 sd;
        for (int j = 0; j < 4 * UNI_1; j++) {
          ivec2 n = g0 + ivec2(j & 1, j >> 1);
          ivec2 cn = clamp(n, ivec2(0), mapMax);
          ivec4 t = stm_t(cn);
          sd[j] = stm_s16(t.y, t.z) + length(vec2(n - cn));
        }
        d = stm_bilin(sd, g - floor(g)) * sc;
        lvl = (t0.x & 3) > 0 ? t0.x & 3 : t0.x >> 2;
      } else {
        // Exact: distance to the nearest cell of the other state, among the 3×3 cells round this one each either of the
        // other state itself or holding its own nearest such cell (outside the stored margin: from its edge).
        int lv = tc == cell ? t0.x & 3 : 0;
        bool inside = lv > 0;
        float bd = 1e9;
        float bs = 1e9;
        int blv = lv;
        for (int j = 0; j < nb * nb * UNI_1; j++) {
          ivec2 n = clamp(tc + ivec2(j % nb, j / nb) - nb / 2, ivec2(0), mapMax);
          ivec4 t = stm_t(n);
          bool other = ((t.x & 3) > 0) != inside;
          vec2 lo = vec2((other ? n : stm_cell(t.yzw)) - M);
          vec2 dd = max(max(lo - b, b - lo - 1.0), 0.0);
          float d2 = dot(dd, dd);
          if (d2 < bd) { bd = d2; blv = other ? t.x & 3 : t.x >> 2; }
          if (aspX) bs = min(bs, stm_box2(b, lo, Mb));
        }
        d = (inside ? -sqrt(bd) : sqrt(bd)) * sc;
        dS = inside ? -sqrt(bs) : sqrt(bs);
        // Outside, the level of the nearest filled cell (so a grown rim keeps its cell's colour).
        lvl = inside ? lv : blv;
      }
      if (d < best) { best = d; bestLv = lvl; bestId = id; bestB = b; bestS = dS; }
      if (-d > dep1) { if (length(ic - cen1) > 0.5) { dep2 = dep1; sdep2 = sdep1; } dep1 = -d; cen1 = ic; sdep1 = -dS; }
      else if (-d > dep2 && length(ic - cen1) > 0.5) { dep2 = -d; sdep2 = -dS; }
    }
  }
  // The distance's direction (uniform control flow, before returning): Bevel aspect on the smoothed outline and as a
  // fallback on the outline itself.
  vec2 gb = vec2(dFdx(best), dFdy(best));
  if (best > 1e8) return genOut(0.0, 0.0, 0.0, 1e4);
  if (best < 0.0) { best = -sqrt(dep1 * dep1 + dep2 * dep2); bestS = -sqrt(sdep1 * sdep1 + sdep2 * sdep2); }
  // The local stretch: px of Bevel per px across the outline (exact: from the stretched distance, so continuous through
  // a mitre; else from the distance's direction).
  float kS = aspX && abs(best) > 0.05 ? bestS / best : u_bevel / bevelWidth(gb);
  float d = sdOnion(best - u_grow, u_outline);
  float h = mix(u_rnd_lo, u_rnd_hi, hashI(bestId, uSeed + 53.0));
  float rnd = u_rnd_by == 0 ? float(bestLv) / 3.0 : u_rnd_by == 1 ? h : (float(max(bestLv, 1)) - 1.0 + h) / 3.0;
  GenOut g = genOut(1.0, 1.0, rnd, d);
  // Bevel aspect: the outline's distance (grown, as an outline) × the local stretch — exactly the stretched distance on
  // the exact outline without Grow / Outline, and along straight runs with them. The smoothed outline (no corners)
  // keeps the distance's direction. (Even strokes: Mb caps the widths.)
  bool asp = bevelAspectOn();
  float dB = d;
  if (aspX) {
    dB = u_grow == 0.0 && u_outline <= 0.0 ? bestS : d * kS;
    g.bdist = dB;
  } else if (asp) dB = d * kS;
  // Even strokes (Label): the bevel ends 0.4 cell in — inside the middle of a one-cell stroke — its depth scaled into
  // the bevel's distance (GenOut.bdist), the shape's own distance left exact.
  float cap = 0.4 * max(u_scale, 0.01);
  if (u_bev_lim && !aspX && u_bevel > cap) g.bdist = (d < 0.0 ? d * u_bevel / cap : d) * (asp ? kS : 1.0);
#ifdef STAMP_LEVELS
  // The level edges ("≥ 2", "≥ 3" areas), for Level relief and for anti-aliased level colours (stored only when the
  // bitmap has more than one level).
  bool lvTex = textureSize(t_lv, 0).x > 1;
  bool aaLv = lvTex && u_aa && u_rnd_by != 1;
  if (lvTex && (u_lvl_h > 0.0 || aaLv)) {
    float d2;
    float d3;
    // Bevel aspect on the level edges, as on the outline (stretched).
    float d2S = 0.0;
    float d3S = 0.0;
    if (smoothMap) {
      // Smoothed: the stored centre distances, bilinear.
      vec2 gq = bestB - 0.5;
      ivec2 g0 = ivec2(floor(gq)) + M;
      ivec2 lvMax = textureSize(t_lv, 0) - 1;
      vec4 l2;
      vec4 l3;
      for (int j = 0; j < 4 * UNI_1; j++) {
        ivec2 n = g0 + ivec2(j & 1, j >> 1);
        ivec2 cn = clamp(n, ivec2(0), lvMax);
        ivec4 t = ivec4(texelFetch(t_lv, cn, 0) * 255.0 + 0.5);
        float out_ = length(vec2(n - cn));
        l2[j] = stm_s16(t.x, t.y) + out_;
        l3[j] = stm_s16(t.z, t.w) + out_;
      }
      d2 = stm_bilin(l2, gq - floor(gq)) * sc;
      d3 = stm_bilin(l3, gq - floor(gq)) * sc;
      // (No corners: from each distance's direction.)
      float e2 = max(d2, d), e3 = max(d3, d);
      d2S = bevelLine(e2, vec2(dFdx(e2), dFdy(e2)));
      d3S = bevelLine(e3, vec2(dFdx(e3), dFdy(e3)));
    } else {
      // Exact: the nearest cell across each level edge among the 3×3 round the pixel, as for the outline (square steps).
      ivec2 cell = ivec2(floor(bestB)) + M;
      ivec2 tc = clamp(cell, ivec2(0), mapMax);
      ivec4 o2 = ivec4(texelFetch(t_lv, ivec2(tc.x * 2, tc.y), 0) * 255.0 + 0.5);
      ivec4 o3 = ivec4(texelFetch(t_lv, ivec2(tc.x * 2 + 1, tc.y), 0) * 255.0 + 0.5);
      bool in2 = tc == cell && (o2.w & 1) == 1;
      bool in3 = tc == cell && (o3.w & 1) == 1;
      vec2 bd = vec2(1e9);
      vec2 bs = vec2(1e9);
      for (int j = 0; j < 2 * nb * nb * UNI_1; j++) {
        int l = j / (nb * nb);
        int m = j - l * nb * nb;
        ivec2 n = clamp(tc + ivec2(m % nb, m / nb) - nb / 2, ivec2(0), mapMax);
        ivec4 t = ivec4(texelFetch(t_lv, ivec2(n.x * 2 + l, n.y), 0) * 255.0 + 0.5);
        bool other = ((t.w & 1) == 1) != (l == 0 ? in2 : in3);
        vec2 lo = vec2((other ? n : stm_cell(t.xyz)) - M);
        vec2 dd = max(max(lo - bestB, bestB - lo - 1.0), 0.0);
        if (l == 0) bd.x = min(bd.x, dot(dd, dd)); else bd.y = min(bd.y, dot(dd, dd));
        if (aspX) {
          float s2 = stm_box2(bestB, lo, Mb);
          if (l == 0) bs.x = min(bs.x, s2); else bs.y = min(bs.y, s2);
        }
      }
      d2 = (o2.w & 2) == 0 ? 1e4 : (in2 ? -sqrt(bd.x) : sqrt(bd.x)) * sc;
      d3 = (o3.w & 2) == 0 ? 1e4 : (in3 ? -sqrt(bd.y) : sqrt(bd.y)) * sc;
      d2S = max((o2.w & 2) == 0 ? 1e4 : in2 ? -sqrt(bs.x) : sqrt(bs.x), dB);
      d3S = max((o3.w & 2) == 0 ? 1e4 : in3 ? -sqrt(bs.y) : sqrt(bs.y), dB);
    }
    if (u_lvl_h > 0.0) {
      // Level relief: the outline's bevel plus a bevel up each level edge, a third each — for Height › Pattern
      // (GenOut.hval).
      // (Bevel aspect: the stretched distances, px of Bevel, as the wrapper takes GenOut.bdist.)
      float b1 = bevelRise(asp ? dB : d);
      g.hval = mix(b1, (b1 + bevelRise(asp ? d2S : max(d2, d)) + bevelRise(asp ? d3S : max(d3, d))) / 3.0, u_lvl_h);
    }
    if (aaLv) {
      // Anti-aliased level colours: each level area's coverage across its edge (outside the outline, as at its edge),
      // so the per-feature random blends over the edge pixel like the outline does.
      float lift = max(best - u_grow + 0.5, 0.0);
      float lvl = 1.0 + clamp(0.5 - d2 + lift, 0.0, 1.0) + clamp(0.5 - d3 + lift, 0.0, 1.0);
      g.rnd = u_rnd_by == 0 ? lvl / 3.0 : (lvl - 1.0 + h) / 3.0;
    }
  }
#endif
#ifdef STAMP_IMAGE
  // Image file: the image's pixel under the cell (past the outline, the nearest one): its colour into Diffuse (in place
  // of the ramp, gGenRgb), or its brightness into Height (× the bevel, as genOutShaded); its alpha fades the coverage.
  vec4 ic = vec4(1.0);
  float val = float(bestLv) / 3.0;
  if (u_source == 1) {
    ic = stm_image(bestB, dims);
    val = luma(ic.rgb);
  }
  // Wear: values below a threshold drop out, the threshold varied over the stamp by a few octaves of noise (each
  // repeat its own): dark (or, inverted, bright) values and the noise's high spots go first.
  float keep = 1.0;
  if (u_wear > 0.0) {
    vec2 wp = bestB / max(max(dims.x, dims.y), 1.0) * u_wear_scale;
    // (A whole-number seed per repeat, 37 apart: the noise hashes take its integer part, and no repeat's octave lands
    // on another's — they are 31 apart.)
    float ws = uSeed + 71.0 + 37.0 * floor(hashI(bestId, uSeed + 7.0) * 4096.0);
    float n = 0.0, a = 1.0, na = 0.0;
    for (int o = 0; o < u_wear_oct; o++) {
      n += a * perlinNoise(wp, NO_PERIOD, ws + float(o) * 31.0);
      na += a;
      a *= 0.5;
      wp *= 2.0;
    }
    // 0: below every value (nothing drops) … 1: above every value (all gone); the noise spreads it over the stamp.
    float t = 2.0 * u_wear - 1.0 + n / max(na, 1e-4);
    keep = smoothstep(t - u_wear_soft, t + u_wear_soft + 1e-4, u_wear_inv ? 1.0 - val : val);
  }
  if (u_source == 1 && u_into == 1) {
    g.own = 2;
    g.value = val;
    g.mask = ic.a * keep * coverage(d, u_aa);
  } else {
    if (u_source == 1) gGenRgb = ic.rgb;
    g.mask *= ic.a * keep;
  }
#endif
  return g;
}
`;

/** The default stamp: a warning triangle, two levels, the exclamation mark cut out. */
const DEFAULT_PIXELS = [
	'..........##..........',
	'..........##..........',
	'.........####.........',
	'.........####.........',
	'........######........',
	'........##++##........',
	'.......###++###.......',
	'......###+..+###......',
	'......##++..++##......',
	'.....###++..++###.....',
	'.....##+++..+++##.....',
	'....###+++..+++###....',
	'...###++++..++++###...',
	'...##++++++++++++##...',
	'..###+++++..+++++###..',
	'..##++++++..++++++##..',
	'.###++++++++++++++###.',
	'.####################.',
	'######################'
].join('\n');

const fromImage = (p: ParamValues) => p.source === 'image';
const worn = (p: ParamValues) => Number(p.wear) > 0;
const NO_IMAGE: CpuTexture = { width: 1, height: 1, data: new Uint8Array(4) };
const imageCells = new WeakMap<object, { cut: number; cells: Cells }>();

/**
 * Stamp › Image file: the image's pixels at least Opacity threshold opaque are the cells (one level), the image itself goes up
 * as t_img. Nothing (an empty bitmap) while it decodes or when none is picked.
 */
function imageTextures(q: ParamValues): Record<string, CpuTexture> {
	const img = getImage(String(q.image ?? ''));
	const cut = Math.round(Math.min(1, Math.max(0.004, Number(q.alpha_cut ?? 0.5))) * 255);
	let c: Cells = { w: 0, h: 0, lv: new Uint8Array(0) };
	if (img) {
		// Kept per image and cut: params that don't touch the cells (Bevel, colours) skip rebuilding them.
		const hit = imageCells.get(img);
		if (hit?.cut === cut) c = hit.cells;
		else {
			c = { w: img.width, h: img.height, lv: new Uint8Array(img.width * img.height) };
			for (let i = 0; i < c.lv.length; i++) c.lv[i] = img.data[i * 4 + 3] >= cut ? 3 : 0;
			imageCells.set(img, { cut, cells: c });
		}
	}
	// (Join diagonals, Mirror and Level relief are the typed pixels' alone: the cells are all one level.)
	const t = layerTextures(c, { ...q, join: false }, { levels: true });
	return { ...t, img: img ? { width: img.width, height: img.height, data: img.data } : NO_IMAGE };
}

/**
 * The typed pixels' textures, remembered by the params they read (a colour or Height slider doesn't rebuild them). An
 * image's (imageTextures) aren't: the image may still be loading.
 */
const pixelTextures = memoReads(
	(q: ParamValues): Record<string, CpuTexture> => ({
		...layerTextures(mirrorCells(parseCells(String(q.pixels ?? '')), q.mirror), q, { levels: true }),
		img: NO_IMAGE
	}),
	4
);

export const stampLayer: LayerDef = {
	type: 'stamp',
	label: 'Stamp',
	category: 'shape',
	kind: 'generator',
	sdf: true,
	description:
		'Stamp: A hand-drawn pixel bitmap or an image file used as a shape; an image’s colours can go into Diffuse or its brightness into Height. Makes insignia, emblems, decals, rivets.',
	params: [
		P.enum('source', 'Stamp source', 'pixels', [
			['pixels', 'Typed pixels', 'type rows of cell characters'],
			['image', 'Image file', 'a PNG, JPEG or WebP: its opaque pixels become the stamp, one cell each']
		]),
		P.image('image', 'Image', {
			showIf: fromImage,
			hint: 'Loads a PNG, JPEG or WebP, scaled down to fit the texture (at most 1024 px); each of its pixels becomes a cell, Pixel size texture px across. The project only saves the file name, and the image itself stays in this browser (load it again elsewhere)'
		}),
		P.enum(
			'into',
			'Image into',
			'diffuse',
			[
				['diffuse', 'Diffuse', 'uses the image’s colours instead of the gradient ramp'],
				['height', 'Height', 'uses the image’s brightness as height (× the bevel at its outline)']
			],
			{ showIf: fromImage, hint: 'Picks where the image goes. Its outline still bevels and writes the mask either way' }
		),
		P.float('alpha_cut', 'Opacity threshold', 0.5, 0.004, 1, {
			step: 0.001,
			showIf: fromImage,
			hint: 'Makes pixels at least this opaque part of the stamp; their alpha still fades the colour'
		}),
		P.bool('img_smooth', 'Smooth image', false, {
			showIf: fromImage,
			hint: 'Blends between the image’s pixels (when Pixel size enlarges it) instead of keeping each one square'
		}),
		P.bitmap('pixels', 'Pixels', DEFAULT_PIXELS, 'pixels', {
			uniform: false,
			showIf: (p) => !fromImage(p),
			hint: 'Type one row per line (up to 128 × 128): "#" full, "+" mid, "-" low level, "." or space empty. The levels drive Per-feature colour'
		}),
		P.enum(
			'mirror',
			'Mirror',
			'none',
			[
				['none', 'None'],
				['odd', 'Mirror (shared centre column)'],
				['even', 'Mirror (no shared column)']
			],
			{
				showIf: (p) => !fromImage(p),
				hint: 'Lets you draw only the left half and reflects it into the right half'
			}
		),
		P.float('lvl_h', 'Level relief', 1, 0, 1, {
			step: 0.001,
			showIf: (p) => !fromImage(p),
			hint: 'Makes the height follow the cell levels ("-" a third, "+" two thirds, "#" full), each step bevelled like the outline (Height › Pattern), so multi-tone bitmaps emboss. Cells drawn "+" or "-" just for their colour (a rivet\'s highlight) sit lower too, so set 0 for one height for all'
		}),
		P.bool('join', 'Join diagonals', false, {
			showIf: (p) => !fromImage(p),
			hint: 'Bridges cells that touch only at a corner with two half-cell squares, so one-cell diagonal lines (and an X’s crossing) bevel as one stroke instead of a row of squares. Nothing else changes: square corners stay square'
		}),
		...placement,
		P.float('wear', 'Wear', 0, 0, 1, {
			step: 0.001,
			group: 'wear',
			hint: 'Wears the stamp away below a threshold that noise varies over it: the dark parts of an image (the low levels of typed pixels) and the noise’s high spots go first, like worn paint or a scuffed decal (0 = none, 1 = all gone)'
		}),
		P.float('wear_scale', 'Wear scale', 4, 0.25, 256, {
			softMax: 32,
			step: 0.01,
			group: 'wear',
			showIf: worn,
			hint: 'How many noise features fit across the stamp (each repeat wears differently)'
		}),
		P.int('wear_oct', 'Wear octaves', 4, 1, 8, {
			group: 'wear',
			showIf: worn,
			hint: 'Adds noise octaves: more = finer, more ragged edges on the worn patches'
		}),
		P.float('wear_soft', 'Wear softness', 0.04, 0, 0.5, {
			step: 0.001,
			group: 'wear',
			showIf: worn,
			hint: 'Fades the dropped-out edge instead of cutting it'
		}),
		P.bool('wear_inv', 'Bright parts first', false, {
			group: 'wear',
			showIf: worn,
			hint: 'Wears away the bright values first instead of the dark ones'
		})
	],
	groups: [...stampGroups, { id: 'wear', label: 'Wear', collapsed: true }],
	// An image goes into one output: Diffuse (its colours) or Height (its brightness) — the other starts off.
	linkedDefaults: (p) =>
		fromImage(p) ? { dif_on: p.into !== 'height', h_on: p.into === 'height' } : { dif_on: true, h_on: true },
	defaults,
	paramPatch: { bevel: { note: (p) => wideBevelNote(p) } },
	fresh: (t) => freshStamp(t, 22),
	textures: ['stamp', 'lv', 'img'],
	cpuData: (q) => (fromImage(q) ? imageTextures(q) : pixelTextures(q)),
	glsl: 'const bool u_bev_lim = false;\n#define STAMP_IMAGE\n#define STAMP_LEVELS\n' + STAMP_GLSL
};

const labelLayer: LayerDef = {
	type: 'label',
	label: 'Label',
	category: 'shape',
	kind: 'generator',
	sdf: true,
	description:
		'Label: Pixel-font lettering in 3×5 or 5×7 px letters, digits and punctuation. Makes crate numbers, panel codes, warning text.',
	params: [
		P.bitmap('text', 'Text', 'BAY 03', 'font', {
			uniform: false,
			hint: 'Type letters, digits and punctuation; "|" or a new line starts a new line. The small font only has capitals'
		}),
		P.enum('font', 'Font', 'large', [
			[
				'small',
				'Compact 3 × 5 (capitals)',
				'letters 3 cells wide and 5 tall, for small textures; lower case is drawn as capitals'
			],
			[
				'large',
				'Full 5 × 7',
				'letters 5 cells wide and 7 tall (descenders one more), with lower case; easier to read at larger sizes'
			]
		]),
		P.int('spacing', 'Letter spacing', 1, 0, 32, { softMax: 4, hint: 'Adds empty cells between letters' }),
		P.int('line_gap', 'Line spacing', 2, 0, 64, { softMax: 8, hint: 'Adds empty rows between lines' }),
		P.enum(
			'align',
			'Align',
			'center',
			[
				['center', 'Centre'],
				['left', 'Left'],
				['right', 'Right']
			],
			{ hint: 'Aligns each line within the widest one' }
		),
		P.bool('bold', 'Bold', false, { hint: 'Doubles the upright strokes (each letter one cell wider)' }),
		P.bool('join', 'Join diagonals', true, {
			hint: 'Joins cells that touch only at a corner. With Smooth outline below 1, two half-cell squares bridge each such corner (square corners stay square). From 1, the letters are drawn as strokes through the cell centres: straight diagonals (an X crosses cleanly), straight runs kept, round ends'
		}),
		P.bool('bev_lim', 'Even strokes', true, {
			hint: 'Limits the bevel to just under half a stroke (0.4 cell), so thin strokes rise to full height like their junctions, with no bright beads where strokes meet'
		}),
		...placement
	],
	groups: stampGroups,
	defaults: { ...defaults, smooth: 1, gap_y: 2, rnd_lo: 0.25 },
	paramPatch: {
		bevel: {
			note: (p) => {
				const cap = 0.4 * Number(p.scale ?? 1);
				return p.bev_lim && Number(p.bevel) > cap
					? `Capped at ${Math.round(cap * 10) / 10} px (0.4 cell) by Even strokes`
					: wideBevelNote(p);
			}
		}
	},
	// Sized to the texture: small textures get the compact font, and below 3 px cells the plain pixel outline (joined,
	// smoothed strokes need room).
	fresh: (t) => {
		const small = Math.min(t.width, t.height) < 128;
		const f = freshStamp(t, small ? 24 : 36);
		const big = Number(f.scale) >= 3;
		return { ...f, ...(small ? { font: 'small', line_gap: 1 } : {}), ...(big ? {} : { smooth: 0, join: false }) };
	},
	textures: ['stamp'],
	// (Remembered by the params it reads, as Stamp's typed pixels.)
	cpuData: memoReads((q: ParamValues) => {
		// Join diagonals and Smooth outline ≥ 1: drawn as strokes. With Join diagonals, bold is applied after the join
		// (only the advance is widened here).
		const strokes = Boolean(q.join) && Number(q.smooth ?? 0) >= 1;
		const c = textCells(String(q.text ?? ''), {
			font: q.font === 'large' ? 'large' : 'small',
			spacing: Number(q.spacing ?? 1),
			lineGap: Number(q.line_gap ?? 1),
			align: q.align === 'left' || q.align === 'right' ? q.align : 'center',
			bold: Boolean(q.bold),
			boldAdvanceOnly: Boolean(q.join),
			strokeGlyphs: strokes
		});
		return layerTextures(c, q, { strokes, boldLate: Boolean(q.join) });
	}, 4),
	// Lettering is all one level: no level edges (STAMP_LEVELS).
	glsl: STAMP_GLSL
};

export const STAMP_LAYERS: LayerDef[] = [stampLayer, labelLayer];
