// A layout grid of columns and rows whose cells can be merged into larger rectangles (FR8.30): Panelling's panels, and
// the grid the viewport's grid gizmo edits. Pure functions on a parsed Grid, shared by the gizmo (src/ui/components/
// GridGizmo.vue) and the layers' CPU work, so what the gizmo shows is what renders.
//
// Stored as four text params: column and row sizes as fractions of the layout that sum to 1 ("0.25 0.5 0.25"), the
// merged rectangles as "col,row,w,h" cell spans ("0,1,1,2 3,0,2,1") — cells in no merge are panels of their own — and
// the cells switched off as "col,row" pairs ("1,0 2,2"): the layer draws nothing there (Area, below).

import { hash2I } from './hash';

/** The most columns or rows (the shaders' arrays are this long). */
export const MAX_GRID = 16;

/** A rectangle of cells: column, row, width and height in cells. */
export interface Span {
	c: number;
	r: number;
	w: number;
	h: number;
}

export interface Grid {
	cols: number[];
	rows: number[];
	/** Merged panels (two or more cells each, never overlapping). */
	merges: Span[];
	/** Per row, a bit per column: the cells switched off. */
	off: number[];
}

export type Axis = 'col' | 'row';
export type Dir = 'left' | 'right' | 'up' | 'down';

/** The keys of the grid's four text params (every Area layer has them: commonParams' AREA_PARAMS). */
export const GRID_KEYS = { cols: 'grid_cols', rows: 'grid_rows', merge: 'grid_merge', off: 'grid_off' } as const;

const normalise = (s: number[]): number[] => {
	const t = s.reduce((a, b) => a + b, 0);
	return t > 0 ? s.map((v) => v / t) : s.map(() => 1 / s.length);
};

/** Sizes from text: positive numbers (at most MAX_GRID), as fractions summing to 1. Nothing usable = one cell. */
export function parseSizes(text: string | undefined, fallback = 1): number[] {
	const s = String(text ?? '')
		.split(/[\s,;]+/)
		.map(Number)
		.filter((v) => Number.isFinite(v) && v > 0)
		.slice(0, MAX_GRID);
	return s.length ? normalise(s) : equal(fallback);
}

/** n equal sizes. */
export const equal = (n: number): number[] => {
	const k = Math.max(1, Math.min(MAX_GRID, Math.round(n)));
	return Array.from({ length: k }, () => 1 / k);
};

/** Sizes to text: 4 decimals, the last taking up the rounding so they sum to 1 exactly. */
export function formatSizes(sizes: number[]): string {
	const s = normalise(sizes).map((v) => Math.round(v * 1e4) / 1e4);
	const rest = s.slice(0, -1).reduce((a, b) => a + b, 0);
	s[s.length - 1] = Math.round((1 - rest) * 1e4) / 1e4;
	return s.map((v) => String(v)).join(' ');
}

const overlaps = (a: Span, b: Span) => a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h;
const inside = (a: Span, b: Span) => a.c >= b.c && a.r >= b.r && a.c + a.w <= b.c + b.w && a.r + a.h <= b.r + b.h;
const same = (a: Span, b: Span) => a.c === b.c && a.r === b.r && a.w === b.w && a.h === b.h;

/** Keeps the valid merges: inside nc × nr, two or more cells, none overlapping an earlier one. */
function clean(merges: Span[], nc: number, nr: number): Span[] {
	const out: Span[] = [];
	for (const m of merges) {
		if (![m.c, m.r, m.w, m.h].every(Number.isInteger)) continue;
		if (m.c < 0 || m.r < 0 || m.w < 1 || m.h < 1 || m.c + m.w > nc || m.r + m.h > nr || m.w * m.h < 2) continue;
		if (out.some((o) => overlaps(o, m))) continue;
		out.push({ ...m });
	}
	return out;
}

/** Merges from text ("c,r,w,h c,r,w,h"), cleaned against an nc × nr grid. */
export function parseMerges(text: string | undefined, nc: number, nr: number): Span[] {
	const spans = String(text ?? '')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((t) => t.split(',').map(Number))
		.filter((v) => v.length === 4)
		.map(([c, r, w, h]) => ({ c, r, w, h }));
	return clean(spans, nc, nr);
}

export const formatMerges = (m: Span[]): string => m.map((s) => `${s.c},${s.r},${s.w},${s.h}`).join(' ');

/** Cells switched off from text ("c,r c,r"): per row, a bit per column. */
export function parseOff(text: string | undefined, nc: number, nr: number): number[] {
	const bits = Array<number>(nr).fill(0);
	for (const t of String(text ?? '')
		.trim()
		.split(/\s+/)) {
		const [c, r] = t.split(',').map(Number);
		if (Number.isInteger(c) && Number.isInteger(r) && c >= 0 && c < nc && r >= 0 && r < nr) bits[r] |= 1 << c;
	}
	return bits;
}

export function formatOff(off: number[], nc: number): string {
	const out: string[] = [];
	off.forEach((b, r) => {
		for (let c = 0; c < nc; c++) if (b & (1 << c)) out.push(`${c},${r}`);
	});
	return out.join(' ');
}

export const isOn = (g: Grid, c: number, r: number): boolean => !((g.off[r] ?? 0) & (1 << c));

export function parseGrid(cols: unknown, rows: unknown, merge: unknown, off?: unknown): Grid {
	const c = parseSizes(cols as string);
	const r = parseSizes(rows as string);
	return {
		cols: c,
		rows: r,
		merges: parseMerges(merge as string, c.length, r.length),
		off: parseOff(off as string, c.length, r.length)
	};
}

/** A layer's grid, from its params (GRID_KEYS). */
export const gridOf = (p: Record<string, unknown>): Grid =>
	parseGrid(p[GRID_KEYS.cols], p[GRID_KEYS.rows], p[GRID_KEYS.merge], p[GRID_KEYS.off]);

/** A grid as its four params' values. */
export function gridParams(g: Grid): Record<string, string> {
	return {
		[GRID_KEYS.cols]: formatSizes(g.cols),
		[GRID_KEYS.rows]: formatSizes(g.rows),
		[GRID_KEYS.merge]: formatMerges(g.merges),
		[GRID_KEYS.off]: formatOff(g.off, g.cols.length)
	};
}

/** Switches a panel's cells off, or on again when they are all off already. */
export function toggle(g: Grid, p: Span): Grid {
	let mask = 0;
	for (let c = p.c; c < p.c + p.w; c++) mask |= 1 << c;
	const rows = Array.from({ length: p.h }, (_, i) => p.r + i);
	const allOff = rows.every((r) => ((g.off[r] ?? 0) & mask) === mask);
	const off = g.off.map((b, r) => (rows.includes(r) ? (allOff ? b & ~mask : b | mask) : b));
	return { ...g, off };
}

/** A panel is off when all its cells are. */
export function panelOff(g: Grid, p: Span): boolean {
	for (let r = p.r; r < p.r + p.h; r++) for (let c = p.c; c < p.c + p.w; c++) if (isOn(g, c, r)) return false;
	return true;
}

/** Remaps the off bits of each row by a column map (old column → new; several may land on one: off only if all are). */
function remapCols(off: number[], nc: number, map: (c: number) => number, ncNew: number): number[] {
	return off.map((b) => {
		let on = 0;
		for (let c = 0; c < nc; c++) if (!(b & (1 << c))) on |= 1 << map(c);
		return ~on & ((1 << ncNew) - 1);
	});
}

/** Every panel: the merges and the single cells, ordered by their top-left cell (row by row). */
export function panels(g: Grid): Span[] {
	const out: Span[] = [];
	for (let r = 0; r < g.rows.length; r++)
		for (let c = 0; c < g.cols.length; c++) {
			const m = g.merges.find((s) => s.c <= c && c < s.c + s.w && s.r <= r && r < s.r + s.h);
			if (!m) out.push({ c, r, w: 1, h: 1 });
			else if (m.c === c && m.r === r) out.push({ ...m });
		}
	return out;
}

/** The panel covering a cell. */
export function panelAt(g: Grid, c: number, r: number): Span {
	const m = g.merges.find((s) => s.c <= c && c < s.c + s.w && s.r <= r && r < s.r + s.h);
	return m ? { ...m } : { c, r, w: 1, h: 1 };
}

/** The rectangle a panel would become grown by one strip of cells toward dir, or null when it can't (edge, L-shape). */
export function grown(g: Grid, p: Span, dir: Dir): Span | null {
	const R =
		dir === 'left'
			? { c: p.c - 1, r: p.r, w: p.w + 1, h: p.h }
			: dir === 'right'
				? { c: p.c, r: p.r, w: p.w + 1, h: p.h }
				: dir === 'up'
					? { c: p.c, r: p.r - 1, w: p.w, h: p.h + 1 }
					: { c: p.c, r: p.r, w: p.w, h: p.h + 1 };
	if (R.c < 0 || R.r < 0 || R.c + R.w > g.cols.length || R.r + R.h > g.rows.length) return null;
	for (const m of g.merges) if (overlaps(m, R) && !inside(m, R)) return null;
	return R;
}

/** Grows a panel by one strip toward dir, taking in the merges wholly inside (unchanged grid when it can't). */
export function grow(g: Grid, p: Span, dir: Dir): Grid {
	const R = grown(g, p, dir);
	if (!R) return g;
	return { ...g, merges: [...g.merges.filter((m) => !inside(m, R)), R] };
}

/**
 * Splits a merged panel along grid line k (a column line: between column k − 1 and k; a row line likewise), which must
 * run through it. Either half may be a single cell again.
 */
export function breakAt(g: Grid, p: Span, axis: Axis, k: number): Grid {
	const m = g.merges.find((s) => same(s, p));
	if (!m) return g;
	const a: Span = axis === 'col' ? { c: m.c, r: m.r, w: k - m.c, h: m.h } : { c: m.c, r: m.r, w: m.w, h: k - m.r };
	const b: Span =
		axis === 'col' ? { c: k, r: m.r, w: m.c + m.w - k, h: m.h } : { c: m.c, r: k, w: m.w, h: m.r + m.h - k };
	if (a.w < 1 || a.h < 1 || b.w < 1 || b.h < 1) return g;
	const rest = g.merges.filter((s) => s !== m);
	return { ...g, merges: [...rest, ...[a, b].filter((s) => s.w * s.h >= 2)] };
}

/** Breaks a merged panel into single cells. */
export function breakAll(g: Grid, p: Span): Grid {
	return { ...g, merges: g.merges.filter((s) => !same(s, p)) };
}

const sizesOf = (g: Grid, axis: Axis) => (axis === 'col' ? g.cols : g.rows);
const withSizes = (g: Grid, axis: Axis, s: number[], merges: Span[], off: number[]): Grid =>
	axis === 'col' ? { cols: s, rows: g.rows, merges, off } : { cols: g.cols, rows: s, merges, off };

/**
 * Splits column (row) i at t, the share of it left (above) the new line. Merges crossing it span one more column;
 * single cells become two. No-op at MAX_GRID.
 */
export function split(g: Grid, axis: Axis, i: number, t: number): Grid {
	const s = sizesOf(g, axis);
	if (s.length >= MAX_GRID || i < 0 || i >= s.length) return g;
	const f = Math.min(Math.max(t, 0.05), 0.95);
	const ns = [...s.slice(0, i), s[i] * f, s[i] * (1 - f), ...s.slice(i + 1)];
	const merges = g.merges.map((m) => {
		const [p, n] = axis === 'col' ? [m.c, m.w] : [m.r, m.h];
		const np = p > i ? p + 1 : p;
		const nn = p <= i && i < p + n ? n + 1 : n;
		return axis === 'col' ? { ...m, c: np, w: nn } : { ...m, r: np, h: nn };
	});
	// The new column (row) takes the split one's on / off.
	const off =
		axis === 'col'
			? g.off.map((b) => {
					const lo = b & ((1 << (i + 1)) - 1);
					return lo | ((b >> i) << (i + 1));
				})
			: [...g.off.slice(0, i + 1), g.off[i], ...g.off.slice(i + 1)];
	return withSizes(g, axis, ns, merges, off);
}

/** Removes grid line k (1 … n − 1): its two columns (rows) become one, merges re-mapped. */
export function removeLine(g: Grid, axis: Axis, k: number): Grid {
	const s = sizesOf(g, axis);
	if (k < 1 || k >= s.length) return g;
	const ns = [...s.slice(0, k - 1), s[k - 1] + s[k], ...s.slice(k + 1)];
	const f = (i: number) => (i < k ? i : i - 1);
	const merges = g.merges.map((m) => {
		const [p, n] = axis === 'col' ? [m.c, m.w] : [m.r, m.h];
		const a = f(p);
		const b = f(p + n - 1);
		return axis === 'col' ? { ...m, c: a, w: b - a + 1 } : { ...m, r: a, h: b - a + 1 };
	});
	const nc = axis === 'col' ? ns.length : g.cols.length;
	const nr = axis === 'row' ? ns.length : g.rows.length;
	// The joined column (row) is off only if both were.
	const off =
		axis === 'col'
			? remapCols(g.off, g.cols.length, f, nc)
			: [...g.off.slice(0, k - 1), g.off[k - 1] & g.off[k], ...g.off.slice(k + 1)];
	return withSizes(g, axis, ns, clean(merges, nc, nr), off);
}

/** Positions of the lines (0 … 1), n + 1 of them. */
export function lines(sizes: number[]): number[] {
	const out = [0];
	for (const v of sizes) out.push(out[out.length - 1] + v);
	out[out.length - 1] = 1;
	return out;
}

/**
 * Moves line k (1 … n − 1) to position x (a fraction of the layout); only its two neighbours change size, each kept at
 * least min.
 */
export function moveLine(g: Grid, axis: Axis, k: number, x: number, min: number): Grid {
	const s = sizesOf(g, axis);
	if (k < 1 || k >= s.length) return g;
	const L = lines(s);
	const lo = L[k - 1] + min;
	const hi = L[k + 1] - min;
	const at = lo > hi ? (L[k - 1] + L[k + 1]) / 2 : Math.min(Math.max(x, lo), hi);
	const ns = [...s];
	ns[k - 1] = at - L[k - 1];
	ns[k] = L[k + 1] - at;
	return withSizes(g, axis, ns, g.merges, g.off);
}

/** n columns (rows): added ones share the space evenly with the rest, removed ones go from the end. */
export function setCount(g: Grid, axis: Axis, n: number): Grid {
	const s = sizesOf(g, axis);
	const k = Math.max(1, Math.min(MAX_GRID, Math.round(n)));
	if (k === s.length) return g;
	const ns =
		k > s.length ? [...s.map((v) => (v * s.length) / k), ...equal(k).slice(s.length)] : normalise(s.slice(0, k));
	const nc = axis === 'col' ? k : g.cols.length;
	const nr = axis === 'row' ? k : g.rows.length;
	const merges = g.merges.map((m) =>
		axis === 'col' ? { ...m, w: Math.min(m.w, k - m.c) } : { ...m, h: Math.min(m.h, k - m.r) }
	);
	// New columns (rows) start on.
	const off =
		axis === 'col' ? g.off.map((b) => b & ((1 << k) - 1)) : Array.from({ length: k }, (_, r) => g.off[r] ?? 0);
	return withSizes(g, axis, ns, clean(merges, nc, nr), off);
}

/**
 * Merges at random on top of the drawn ones: each single, switched-on cell (row by row) is taken with chance `share`
 * and grown right, down or both (a 2×2) into single, switched-on cells. `along` keeps them to one row ('row': only
 * 2 × 1) or one column ('col': only 1 × 2) — a staggered layout, whose rows (columns) slide apart, would cut a panel
 * spanning two of them. `blocked` cells (Panelling's rails and pilasters) are never merged. Deterministic for a seed.
 */
export function randomMerges(
	g: Grid,
	share: number,
	seed: number,
	opts: { along?: Axis; blocked?: (c: number, r: number) => boolean } = {}
): Grid {
	if (!(share > 0)) return g;
	let out = g;
	const free = (c: number, r: number) =>
		c < out.cols.length &&
		r < out.rows.length &&
		isOn(out, c, r) &&
		!opts.blocked?.(c, r) &&
		!out.merges.some((m) => overlaps(m, { c, r, w: 1, h: 1 }));
	for (let r = 0; r < g.rows.length; r++)
		for (let c = 0; c < g.cols.length; c++) {
			if (!free(c, r)) continue;
			const [a, b] = hash2I(c, r, seed + 613);
			if (a >= share) continue;
			const right = opts.along !== 'col' && free(c + 1, r);
			const down = opts.along !== 'row' && free(c, r + 1);
			const both = right && down && free(c + 1, r + 1);
			const choice = [right && { c, r, w: 2, h: 1 }, down && { c, r, w: 1, h: 2 }, both && { c, r, w: 2, h: 2 }].filter(
				(o): o is Span => Boolean(o)
			);
			if (choice.length)
				out = { ...out, merges: [...out.merges, choice[Math.min(Math.floor(b * choice.length), choice.length - 1)]] };
		}
	return out;
}

/**
 * Merges kept to one row ('row') or column ('col') each: one spanning several is split into a strip per row (column),
 * single cells dropped. For a staggered layout, where the rows (columns) slide apart: a merge is made in the staggered
 * rows, never across them.
 */
export function splitAcross(g: Grid, along: Axis): Grid {
	const merges: Span[] = [];
	for (const m of g.merges) {
		if (along === 'row') for (let r = m.r; r < m.r + m.h; r++) merges.push({ c: m.c, r, w: m.w, h: 1 });
		else for (let c = m.c; c < m.c + m.w; c++) merges.push({ c, r: m.r, w: 1, h: m.h });
	}
	return { ...g, merges: merges.filter((m) => m.w * m.h >= 2) };
}

/** The axis a layer's merges must keep to (`stagger` / `stag_by`, Panelling's Stagger), or none. */
export function staggerAlong(p: Record<string, unknown>): Axis | undefined {
	return Number(p.stagger) > 0 ? (p.stag_by === 'rows' ? 'row' : 'col') : undefined;
}

/** A layer's grid as it lays out: with Stagger, its merges kept to the staggered rows (columns). */
export function layoutGrid(p: Record<string, unknown>): Grid {
	const g = gridOf(p);
	const along = staggerAlong(p);
	return along ? splitAcross(g, along) : g;
}

/** All columns and rows the same size; merges kept. */
export const evenOut = (g: Grid): Grid => ({ ...g, cols: equal(g.cols.length), rows: equal(g.rows.length) });

/**
 * The lines of n sizes over `total` px, rounded to whole px: n + 1 increasing positions from 0 to total (each cell at
 * least 1 px while total allows).
 */
export function edgesPx(sizes: number[], total: number): number[] {
	const L = lines(sizes).map((v) => Math.round(v * total));
	for (let i = 1; i < L.length; i++) if (L[i] <= L[i - 1] && L[i - 1] < total) L[i] = L[i - 1] + 1;
	L[L.length - 1] = Math.max(Math.round(total), L[L.length - 2]);
	return L;
}

/** The area a layer is restricted to (LayerDef.area), in whole px from the canvas's top-left; full = the whole canvas. */
export interface AreaPx {
	x: number;
	y: number;
	w: number;
	h: number;
	full: boolean;
}

const frac = (v: unknown, d: number) => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : d;
};

/** area_x / _y / _w / _h (fractions of the canvas) in whole px, at least 1 px and inside the canvas. */
export function areaPx(p: Record<string, unknown>, W: number, H: number): AreaPx {
	const x = Math.min(Math.round(frac(p.area_x, 0) * W), W - 1);
	const y = Math.min(Math.round(frac(p.area_y, 0) * H), H - 1);
	const w = Math.max(1, Math.min(Math.round(frac(p.area_w, 1) * W), W - x));
	const h = Math.max(1, Math.min(Math.round(frac(p.area_h, 1) * H), H - y));
	return { x, y, w, h, full: x === 0 && y === 0 && w === W && h === H };
}
