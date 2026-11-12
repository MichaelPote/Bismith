// Pipe networks (FR8.12), CPU side: runs (polylines) → primitives the Pipes shader draws — straight lengths, filleted
// elbows (arcs) and fittings (collars, bolted flanges) — encoded into a primitive texture (primTexture.ts).
//
// Runs come from a drawn polyline list or a random, tileable layout: horizontal runs spanning the width (some jogging
// up or down and back), vertical runs spanning the height or teeing between two horizontal runs; vertical runs pass in
// front. Density then stacks further layers in front — horizontal, vertical, horizontal … each resting on the pipes
// behind it, each pipe where it covers the most bare wall — until that share of the remaining wall is covered (1 = none
// left). When tiling, every run spans exactly one period (or ends on other pipes) and primitives near an edge are
// copied across it, so the texture wraps.

import { parsePolylines } from '@/core/bitmap';
import { seededRng } from '@/core/hash';
import { POS_RANGE, PrimWriter, binByReach, fitUnit, sizeRange, type PrimTexture } from '../primTexture';

export interface PipeRun {
	/** Centre line (px, y down). */
	points: [number, number][];
	radius: number;
	/** Height of the pipe's axis above the wall (px): pipes in front sit higher. */
	depth: number;
	/** Ends that need a fitting (an end inside the texture, not a run continuing across the edge). */
	capStart: boolean;
	capEnd: boolean;
	/** Ends that tee into another pipe: that pipe's radius (the end stops on its near flank, a collar just outside it). */
	teeStart?: number;
	teeEnd?: number;
	/** Runs (indices) this one tees into: it shares their liquid surface (the lowest of them). */
	joins?: number[];
}

export const PRIM_LINE = 0;
export const PRIM_ARC = 1;
export const PRIM_COLLAR = 2;
export const PRIM_FLANGE = 3;

export interface PipePrim {
	kind: number;
	/** Line start / arc centre / fitting centre. */
	x: number;
	y: number;
	/** Line end. */
	x1: number;
	y1: number;
	/** Arc: bend radius, start angle, sweep (rad). Fitting: axis angle, half width, outer radius. */
	bend: number;
	a0: number;
	sweep: number;
	halfWidth: number;
	outer: number;
	radius: number;
	depth: number;
	pipe: number;
	/** Liquid surface (px, y down): the run is liquid below it. */
	level: number;
}

export interface PipeOptions {
	width: number;
	height: number;
	tile: boolean;
	seed: number;
	/** Elbow centre-line radius in pipe radii (≥ 1). */
	bend: number;
	/** Collar spacing along straight lengths (px; 0 = none). */
	spacing: number;
	/** Chance a coupling is a bolted flange. */
	flanges: number;
	/** Collar size: extra radius as a fraction of the pipe radius. */
	collar: number;
	/** Collars at both ends of each elbow. */
	elbowFittings: boolean;
	/** Liquid fill (0..1) of each run's lowest horizontal length; the surface is level across the whole run. */
	fill?: number;
}

/** How far a flange stands proud of its pipe, in Collar sizes (a collar: one). */
export const FLANGE_PROUD = 2.2;
/** A branch teeing into a pipe is this much narrower (equal sizes meet in a sharp V, a narrower one in a saddle). */
export const TEE_SHRINK = 0.85;
/** The most primitives the texture holds; a layout past it loses its last ones. */
export const MAX_PIPE_PRIMS = 4096;
/** Texels a primitive's record takes. */
export const PIPE_STRIDE = 5;

/** The highest a run reaches above the wall (px): its axis depth plus its radius, flanges included. */
export const runTop = (run: PipeRun, o: PipeOptions) => run.depth + run.radius * (1 + FLANGE_PROUD * o.collar);

/** A pipe radius varied by up to ±40 % × variety (u: a random 0..1), at least 1 px. */
const jitterRadius = (r: number, variety: number, u: number) => Math.max(1, r * (1 + variety * 0.8 * (u - 0.5)));

/** Distance from p to the segment a → b. */
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
	const ex = b[0] - a[0];
	const ey = b[1] - a[1];
	const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / Math.max(ex * ex + ey * ey, 1e-9)));
	return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t);
}

/** The highest surface over the wall (px): a primitive's axis depth plus its radius (fittings: their outer radius). */
export function stackHeight(prims: PipePrim[]): number {
	return prims.reduce((m, p) => Math.max(m, p.depth + (p.kind >= PRIM_COLLAR ? p.outer : p.radius)), 0);
}

/** Polylines from a points list ("x,y x,y …", one run per line or "|"); `fraction` scales 0..1 to the texture. */
export function parseRuns(text: string, fraction: boolean, width: number, height: number): [number, number][][] {
	const [sx, sy] = fraction ? [width, height] : [1, 1];
	return parsePolylines(text).map((run) => run.map(([x, y]): [number, number] => [x * sx, y * sy]));
}

/**
 * Drawn runs (a points list, see parseRuns): radii varied by Radius variation; an end inside the texture gets a flange,
 * and an end on another run tees into it, the branch narrowing to meet it in a saddle.
 */
export function drawnRuns(o: PipeOptions, text: string, fraction: boolean, radius: number, variety: number): PipeRun[] {
	const inside = ([x, y]: [number, number]) => x > 0 && y > 0 && x < o.width && y < o.height;
	const runs: PipeRun[] = parseRuns(text, fraction, o.width, o.height).map((pts, i) => ({
		points: pts,
		radius: jitterRadius(radius, variety, (i * 0.618034) % 1),
		depth: 0,
		capStart: inside(pts[0]),
		capEnd: inside(pts[pts.length - 1])
	}));
	/** The run (and its radius) an end lands on. */
	const onRun = (pt: [number, number], self: number): { r: number; j: number } | undefined => {
		for (let j = 0; j < runs.length; j++) {
			const ps = runs[j].points;
			if (j !== self)
				for (let k = 0; k + 1 < ps.length; k++)
					if (segDist(pt, ps[k], ps[k + 1]) <= runs[j].radius) return { r: runs[j].radius, j };
		}
		return undefined;
	};
	// Every tee first, then the branches narrow (so no run's tees depend on the order of the others).
	const tees = runs.map((run, i) => [onRun(run.points[0], i), onRun(run.points[run.points.length - 1], i)]);
	runs.forEach((run, i) => {
		const [a, b] = tees[i];
		run.teeStart = a?.r;
		run.teeEnd = b?.r;
		run.joins = [a?.j, b?.j].filter((j): j is number => j !== undefined);
		if (a) run.capStart = false;
		if (b) run.capEnd = false;
		const joins = Math.min(a?.r ?? Infinity, b?.r ?? Infinity);
		if (Number.isFinite(joins)) run.radius = Math.min(run.radius, joins * TEE_SHRINK);
	});
	return runs;
}

export interface RandomLayout {
	/** Horizontal runs. */
	runs: number;
	/** Vertical runs. */
	drops: number;
	radius: number;
	/** Radius variation (0..1). */
	variety: number;
	/** Chance a horizontal run jogs up or down and back. */
	jogs: number;
	/** Chance a vertical run tees between two horizontal runs instead of spanning the height. */
	tees: number;
	/** 0..1: stack layers of pipes in front until this share of the remaining wall is covered (1 = none left). */
	density?: number;
}

/** The most runs a dense layout adds up to (each costs every pixel a few primitive tests). */
export const MAX_DENSE_RUNS = 96;

/**
 * Which part of the wall the runs cover, on a grid of at most 256 cells a side (wrapping when tiling). Pipe centre
 * lines only — fittings are ignored.
 */
export class Coverage {
	readonly cell: number;
	readonly w: number;
	readonly h: number;
	private readonly cells: Uint8Array;
	private covered = 0;
	constructor(
		width: number,
		height: number,
		private readonly tile: boolean
	) {
		this.cell = Math.max(1, Math.ceil(Math.max(width, height) / 256));
		this.w = Math.max(1, Math.ceil(width / this.cell));
		this.h = Math.max(1, Math.ceil(height / this.cell));
		this.cells = new Uint8Array(this.w * this.h);
	}

	fraction(): number {
		return this.covered / (this.w * this.h);
	}

	/**
	 * Cells within `r` of the segment a → b, each once per call. When tiling, a cell counts if any of its positions round
	 * the torus within the segment's box is near (a box wider than the grid holds some twice).
	 */
	private visit(a: [number, number], b: [number, number], r: number, fn: (i: number) => void): void {
		const c = this.cell;
		const x0 = Math.floor((Math.min(a[0], b[0]) - r) / c);
		const x1 = Math.ceil((Math.max(a[0], b[0]) + r) / c);
		const y0 = Math.floor((Math.min(a[1], b[1]) - r) / c);
		const y1 = Math.ceil((Math.max(a[1], b[1]) + r) / c);
		// One period of cells at most (tiling), each also tested a period on while that stays in the box.
		const pw = this.tile ? this.w : Infinity;
		const ph = this.tile ? this.h : Infinity;
		for (let gy = y0; gy <= Math.min(y1, y0 + ph - 1); gy++) {
			if (!this.tile && (gy < 0 || gy >= this.h)) continue;
			const wy = ((gy % this.h) + this.h) % this.h;
			for (let gx = x0; gx <= Math.min(x1, x0 + pw - 1); gx++) {
				if (!this.tile && (gx < 0 || gx >= this.w)) continue;
				let near = false;
				for (let sy = gy; sy <= y1 && !near; sy += ph)
					for (let sx = gx; sx <= x1 && !near; sx += pw) near = segDist([(sx + 0.5) * c, (sy + 0.5) * c], a, b) <= r;
				if (near) fn(wy * this.w + (((gx % this.w) + this.w) % this.w));
			}
		}
	}

	add(run: PipeRun): void {
		const p = run.points;
		for (let k = 0; k + 1 < p.length; k++)
			this.visit(p[k], p[k + 1], run.radius, (i) => {
				if (!this.cells[i]) {
					this.cells[i] = 1;
					this.covered++;
				}
			});
	}

	/** Bare cells a straight run would cover. */
	gain(a: [number, number], b: [number, number], r: number): number {
		let n = 0;
		this.visit(a, b, r, (i) => {
			if (!this.cells[i]) n++;
		});
		return n;
	}

	/** The centre (px) of a bare cell's row (horizontal) or column, searching from a start fraction; null when full. */
	bare(horizontal: boolean, start: number): number | null {
		const n = this.w * this.h;
		const s = Math.floor(start * n) % n;
		for (let k = 0; k < n; k++) {
			const i = (s + k) % n;
			if (!this.cells[i]) return ((horizontal ? Math.floor(i / this.w) : i % this.w) + 0.5) * this.cell;
		}
		return null;
	}
}

/**
 * Stack layers of straight runs in front of `runs` (in place) until `density` of the wall they leave bare is covered:
 * horizontal, then vertical, then horizontal … each layer resting on everything behind it (its axes at their highest
 * top, fittings included), its runs apart from one another, each placed where it covers the most bare wall (one
 * candidate always on a bare cell, so the last gaps fill).
 */
function densify(
	runs: PipeRun[],
	o: PipeOptions,
	density: number,
	rand: () => number,
	radius: () => number,
	spanEnds: (period: number) => [number, number]
): void {
	if (density <= 0) return;
	const { width: W, height: H } = o;
	const cov = new Coverage(W, H, o.tile);
	for (const r of runs) cov.add(r);
	const target = cov.fraction() + Math.min(1, density) * (1 - cov.fraction());
	const done = () => cov.fraction() >= target - 1e-4 || runs.length >= MAX_DENSE_RUNS;
	let base = runs.reduce((m, r) => Math.max(m, runTop(r, o)), 0);
	for (let layer = 0; layer < 16 && !done(); layer++) {
		const horizontal = layer % 2 === 0;
		const span = horizontal ? H : W;
		const along = horizontal ? W : H;
		const bands: [number, number][] = [];
		const apart = (c: number, r: number) =>
			bands.every(([c2, r2]) => {
				const d = Math.abs(c - c2);
				return (o.tile ? Math.min(d, span - d) : d) >= (r + r2) * 1.05;
			});
		let layerTop = base;
		while (!done()) {
			const r = radius();
			const [start, end] = spanEnds(along);
			const line = (c: number): [[number, number], [number, number]] =>
				horizontal
					? [
							[start, c],
							[end, c]
						]
					: [
							[c, start],
							[c, end]
						];
			const candidates = Array.from({ length: 24 }, () =>
				o.tile ? rand() * span : r + rand() * Math.max(0, span - 2 * r)
			);
			const bare = cov.bare(horizontal, rand());
			if (bare !== null) candidates.push(bare);
			let best: number | null = null;
			let bestGain = 0;
			for (const c of candidates) {
				if (!apart(c, r)) continue;
				const [a, b] = line(c);
				const g = cov.gain(a, b, r);
				if (g > bestGain) {
					bestGain = g;
					best = c;
				}
			}
			if (best === null) break;
			const [a, b] = line(best);
			const run: PipeRun = { points: [a, b], radius: r, depth: base, capStart: false, capEnd: false };
			runs.push(run);
			cov.add(run);
			bands.push([best, r]);
			layerTop = Math.max(layerTop, runTop(run, o));
		}
		base = layerTop;
	}
}

/**
 * A random tileable layout: horizontal runs (some jogging), vertical runs spanning or teeing, verticals in front. Runs
 * keep clear of each other while there is room; one that finds none lies over the runs it overlaps, resting on them
 * (so high run counts stack pipes rather than drop them).
 */
export function randomRuns(o: PipeOptions, l: RandomLayout): PipeRun[] {
	const rand = seededRng(o.seed * 7919 + 13);
	const { width: W, height: H } = o;
	const radius = () => jitterRadius(l.radius, l.variety, rand());
	// A run spanning the texture: exactly one period from a random start when tiling, else past both edges.
	const pad = 4 * l.radius;
	const spanEnds = (period: number): [number, number] => {
		if (!o.tile) return [-pad, period + pad];
		const s = rand() * period;
		return [s, s + period];
	};
	const runs: PipeRun[] = [];
	// Horizontal runs: keep clear of each other (jogs included); `top` = the highest point of the run in the band.
	const taken: { lo: number; hi: number; top: number }[] = [];
	const free = (lo: number, hi: number) => taken.every((t) => hi < t.lo || lo > t.hi);
	const hs: { y: number; r: number; depth: number; pts: [number, number][]; i: number }[] = [];
	const placeH = (y: number, jog: boolean, dy: number, r: number, depth: number) => {
		const [x0, x1] = spanEnds(W);
		let pts: [number, number][] = [
			[x0, y],
			[x1, y]
		];
		if (jog) {
			const span = x1 - x0;
			const a = x0 + span * (0.15 + 0.3 * rand());
			const b = a + span * (0.2 + 0.3 * rand());
			pts = [
				[x0, y],
				[a, y],
				[a, y + dy],
				[b, y + dy],
				[b, y],
				[x1, y]
			];
		}
		runs.push({ points: pts, radius: r, depth, capStart: false, capEnd: false });
		hs.push({ y, r, depth, pts, i: runs.length - 1 });
	};
	for (let k = 0; k < l.runs; k++) {
		const r = radius();
		let last: { y: number; jog: boolean; dy: number; lo: number; hi: number } | null = null;
		let placed = false;
		for (let tries = 0; tries < 40; tries++) {
			const y = o.tile ? rand() * H : r * 2 + rand() * (H - r * 4);
			const jog = rand() < l.jogs;
			const dy = (rand() < 0.5 ? -1 : 1) * (2.5 + 2 * rand()) * r * Math.max(1, o.bend);
			const lo = Math.min(y, jog ? y + dy : y) - r * 1.8;
			const hi = Math.max(y, jog ? y + dy : y) + r * 1.8;
			if (o.tile || (lo >= 0 && hi <= H)) last = { y, jog, dy, lo, hi };
			if (!free(lo, hi) || (!o.tile && (lo < 0 || hi > H))) continue;
			placeH(y, jog, dy, r, 0);
			taken.push({ lo, hi, top: runTop(runs[runs.length - 1], o) });
			placed = true;
			break;
		}
		if (!placed && last) {
			// No clear band left: over the runs it overlaps, resting on them.
			const { lo, hi } = last;
			const depth = taken.reduce((m, t) => (hi < t.lo || lo > t.hi ? m : Math.max(m, t.top)), 0);
			placeH(last.y, last.jog, last.dy, r, depth);
			taken.push({ lo, hi, top: runTop(runs[runs.length - 1], o) });
		}
	}
	// Vertical runs, in front: spanning the height, or teeing between two horizontal runs (on the wall).
	const front = Math.max(0, ...hs.map((h) => runTop(runs[h.i], o)));
	const onWall = hs.filter((h) => h.depth === 0);
	const xs: number[] = [];
	const vs: { x: number; r: number; top: number }[] = [];
	/** A vertical run spanning the height, in front at `depth`. */
	const pushVertical = (x: number, r: number, depth: number) => {
		const [y0, y1] = spanEnds(H);
		const run: PipeRun = {
			points: [
				[x, y0],
				[x, y1]
			],
			radius: r,
			depth,
			capStart: false,
			capEnd: false
		};
		runs.push(run);
		vs.push({ x, r, top: runTop(run, o) });
	};
	for (let k = 0; k < l.drops; k++) {
		const r = radius();
		let lastX: number | null = null;
		let placed = false;
		for (let tries = 0; tries < 40; tries++) {
			const x = o.tile ? rand() * W : r * 2 + rand() * (W - r * 4);
			lastX = x;
			if (xs.some((x2) => Math.abs(x2 - x) < r * 5)) continue;
			xs.push(x);
			placed = true;
			if (onWall.length >= 2 && rand() < l.tees) {
				// A stub between two horizontal runs next to each other at this x (at the same depth: it tees into them),
				// clear of their jogs' elbows.
				const at = onWall
					.map((h) => ({ h, y: yAt(h.pts, x, W, o.tile, r * (o.bend + 2)) }))
					.filter((v) => v.y !== null) as { h: (typeof hs)[0]; y: number }[];
				at.sort((a, b) => a.y - b.y);
				if (at.length < 2) {
					xs.pop();
					placed = false;
					continue;
				}
				const i = Math.floor(rand() * (at.length - 1));
				const a = at[i];
				const b = at[i + 1];
				runs.push({
					points: [
						[x, a.y],
						[x, b.y]
					],
					radius: Math.min(r, a.h.r, b.h.r) * TEE_SHRINK,
					depth: 0,
					capStart: false,
					capEnd: false,
					teeStart: a.h.r,
					teeEnd: b.h.r,
					joins: [a.h.i, b.h.i]
				});
			} else pushVertical(x, r, front);
			break;
		}
		if (!placed && lastX !== null) {
			// No clear column left: a spanning run over the verticals it overlaps, resting on them.
			const x = lastX;
			pushVertical(
				x,
				r,
				vs.reduce((m, v) => (Math.abs(v.x - x) < v.r + r ? Math.max(m, v.top) : m), front)
			);
		}
	}
	densify(runs, o, l.density ?? 0, rand, radius, spanEnds);
	return runs;
}

/**
 * The height of a horizontal run (a polyline of horizontal lengths and vertical jogs) at x — null within `clear` px of
 * a jog (its elbows) or outside the run. When tiling, x wraps into the run's period.
 */
export function yAt(pts: [number, number][], x: number, period: number, tile: boolean, clear: number): number | null {
	const x0 = pts[0][0];
	const xx = tile ? x0 + ((((x - x0) % period) + period) % period) : x;
	// Clear of every jog first, then the horizontal length under x.
	for (let k = 0; k + 1 < pts.length; k++)
		if (Math.abs(pts[k][0] - pts[k + 1][0]) < 1e-6 && Math.abs(xx - pts[k][0]) < clear) return null;
	for (let k = 0; k + 1 < pts.length; k++) {
		const [ax, ay] = pts[k];
		const [bx, by] = pts[k + 1];
		if (Math.abs(ay - by) < 1e-6 && Math.abs(ax - bx) > 1e-6 && xx >= Math.min(ax, bx) && xx <= Math.max(ax, bx))
			return ay;
	}
	return null;
}

/**
 * A run's liquid surface (px, y down). Liquid settles under gravity: one level surface per run, set by its lowest
 * horizontal length (filled to `fill` of its bore); everything in the run below it is liquid — elbows and drops
 * included — and anything higher empty. A run without horizontal lengths fills from its bottom up (spanning, tiling
 * runs: full or empty).
 */
export function runLevel(run: PipeRun, o: PipeOptions): number {
	const r = run.radius;
	const pts = run.points;
	const fill = o.fill ?? 0;
	const flats = pts
		.slice(1)
		.flatMap((p, k) =>
			Math.abs(p[1] - pts[k][1]) < 1e-6 && Math.abs(p[0] - pts[k][0]) > 1e-6 ? [p[1] + r * (1 - 2 * fill)] : []
		);
	const ys = pts.map((p) => p[1]);
	const top = Math.min(...ys) - r;
	const bottom = Math.max(...ys) + r;
	const spans = o.tile && !run.capStart && !run.capEnd && run.teeStart === undefined && run.teeEnd === undefined;
	return flats.length ? Math.max(...flats) : spans ? (fill >= 0.5 ? -1e4 : 1e4) : bottom - fill * (bottom - top);
}

/** Primitives of one run: straight lengths, filleted elbows, couplings / flanges, end and tee fittings. */
export function runPrims(
	run: PipeRun,
	id: number,
	o: PipeOptions,
	rand: () => number,
	level = runLevel(run, o)
): PipePrim[] {
	const out: PipePrim[] = [];
	const { radius: r, depth } = run;
	// A run teeing into another stops on that pipe's near flank, not its axis: two cylinders meeting at the axis show
	// their intersection as a sharp V.
	const pts = run.points.map((p) => [...p] as [number, number]);
	const trim = (i: number, j: number, by: number | undefined) => {
		if (by === undefined) return;
		const dx = pts[j][0] - pts[i][0];
		const dy = pts[j][1] - pts[i][1];
		const l = Math.hypot(dx, dy);
		const t = Math.min(0.5 * by, 0.5 * l);
		if (l > 1e-6) pts[i] = [pts[i][0] + (dx / l) * t, pts[i][1] + (dy / l) * t];
	};
	trim(0, 1, run.teeStart);
	trim(pts.length - 1, pts.length - 2, run.teeEnd);
	const teeStart = run.teeStart === undefined ? undefined : run.teeStart * 0.5;
	const teeEnd = run.teeEnd === undefined ? undefined : run.teeEnd * 0.5;
	const base = { radius: r, depth, pipe: id, x1: 0, y1: 0, bend: 0, a0: 0, sweep: 0, halfWidth: 0, outer: 0, level };
	const collarW = Math.max(1, r * 0.35);
	const fitting = (x: number, y: number, ang: number, flange: boolean): PipePrim => ({
		...base,
		kind: flange ? PRIM_FLANGE : PRIM_COLLAR,
		x,
		y,
		a0: ang,
		halfWidth: flange ? Math.max(1, r * 0.45) : collarW / 2,
		outer: r * (1 + (flange ? FLANGE_PROUD : 1) * o.collar)
	});
	// Fillet each corner: trim the adjoining lengths by t = rb·tan(θ/2) (at most half of either), arc between.
	const starts: [number, number][] = [pts[0]];
	const ends: [number, number][] = [];
	for (let i = 1; i < pts.length - 1; i++) {
		const [ax, ay] = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
		const [bx, by] = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
		const la = Math.hypot(ax, ay);
		const lb = Math.hypot(bx, by);
		if (la < 1e-6 || lb < 1e-6) continue;
		const dot = (ax * bx + ay * by) / (la * lb);
		const cross = (ax * by - ay * bx) / (la * lb);
		const theta = Math.atan2(cross, dot);
		if (Math.abs(theta) < 1e-3) continue;
		const half = Math.tan(Math.abs(theta) / 2);
		const t = Math.min(Math.max(1, o.bend) * r * half, 0.5 * la, 0.5 * lb);
		const rb = t / half;
		const ti: [number, number] = [pts[i][0] - (ax / la) * t, pts[i][1] - (ay / la) * t];
		const to: [number, number] = [pts[i][0] + (bx / lb) * t, pts[i][1] + (by / lb) * t];
		// Centre: from the trim point along the normal on the inside of the turn.
		const s = Math.sign(theta);
		const cx = ti[0] - s * (ay / la) * rb;
		const cy = ti[1] + s * (ax / la) * rb;
		const a0 = Math.atan2(ti[1] - cy, ti[0] - cx);
		out.push({ ...base, kind: PRIM_ARC, x: cx, y: cy, bend: rb, a0, sweep: theta });
		ends.push(ti);
		starts.push(to);
		if (o.elbowFittings) {
			out.push(fitting(ti[0], ti[1], Math.atan2(ay, ax), false));
			out.push(fitting(to[0], to[1], Math.atan2(by, bx), false));
		}
	}
	ends.push(pts[pts.length - 1]);
	for (let k = 0; k < starts.length; k++) {
		const [x0, y0] = starts[k];
		const [x1, y1] = ends[k];
		const l = Math.hypot(x1 - x0, y1 - y0);
		// (Two fillets can take all of a short length between them.)
		if (l >= 1e-3) out.push({ ...base, kind: PRIM_LINE, x: x0, y: y0, x1, y1 });
		const ang = Math.atan2(y1 - y0, x1 - x0);
		// Couplings: evenly spaced (a whole number per length, so spanning runs stay periodic), clear of the ends.
		if (o.spacing > 0 && l > o.spacing * 0.6) {
			const n = Math.max(1, Math.round(l / o.spacing));
			const off = rand();
			for (let j = 0; j < n; j++) {
				const u = (j + 0.5 * (0.6 + 0.8 * off)) / n;
				if (u * l < r * 2 || (1 - u) * l < r * 2) continue;
				out.push(fitting(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, ang, rand() < o.flanges));
			}
		}
	}
	// End fittings: a flange on a free end, a collar just outside the pipe a run tees into.
	const endFit = (i: number, j: number, tee: number | undefined, cap: boolean) => {
		const [x, y] = pts[i];
		const dx = pts[j][0] - x;
		const dy = pts[j][1] - y;
		const l = Math.hypot(dx, dy);
		if (l < 1e-6) return;
		const ang = Math.atan2(dy, dx);
		if (tee !== undefined) {
			const d = tee + collarW * 0.8;
			if (d < l) out.push(fitting(x + (dx / l) * d, y + (dy / l) * d, ang, false));
		} else if (cap) out.push(fitting(x + (dx / l) * collarW * 0.5, y + (dy / l) * collarW * 0.5, ang, true));
	};
	endFit(0, 1, teeStart, run.capStart);
	endFit(pts.length - 1, pts.length - 2, teeEnd, run.capEnd);
	return out;
}

/**
 * How far round a primitive (its box, for a length) a tiling copy must reach the texture to be kept: its own extent,
 * and for a length a margin more, so the mask's distance stays exact a few radii across the seam.
 */
function reach(p: PipePrim): number {
	if (p.kind === PRIM_LINE) return 5 * p.radius;
	if (p.kind === PRIM_ARC) return p.bend + p.radius;
	return Math.max(p.outer, p.halfWidth) * 1.5;
}

/** Every primitive, plus copies across the edges when tiling. */
export function buildPrims(runs: PipeRun[], o: PipeOptions): PipePrim[] {
	const rand = seededRng(o.seed * 31 + 7);
	// A branch shares the liquid surface of the pipes it tees into (the lowest of them: liquid pools there).
	const levels = runs.map((run) => runLevel(run, o));
	const shared = runs.map((run, i) =>
		run.joins?.length ? Math.max(...run.joins.map((j) => levels[j] ?? levels[i])) : levels[i]
	);
	const prims = runs.flatMap((run, i) => runPrims(run, i + 1, o, rand, shared[i]));
	if (!o.tile) return prims;
	const out: PipePrim[] = [];
	for (const p of prims) {
		const m = reach(p);
		const xs = p.kind === PRIM_LINE ? [Math.min(p.x, p.x1), Math.max(p.x, p.x1)] : [p.x, p.x];
		const ys = p.kind === PRIM_LINE ? [Math.min(p.y, p.y1), Math.max(p.y, p.y1)] : [p.y, p.y];
		for (const ox of [-o.width, 0, o.width])
			for (const oy of [-o.height, 0, o.height]) {
				if (xs[1] + ox + m < 0 || xs[0] + ox - m > o.width || ys[1] + oy + m < 0 || ys[0] + oy - m > o.height) continue;
				out.push({ ...p, x: p.x + ox, y: p.y + oy, x1: p.x1 + ox, y1: p.y1 + oy, level: p.level + oy });
			}
	}
	return out;
}

/**
 * The primitive texture (primTexture.ts), a record of 5 texels per primitive: [x, y] [x1, y1 | bend, a0 | angle, half
 * width] [sweep | outer, pipe id] [kind, radius] [depth, liquid level]. Positions (and the level) are positions in the
 * unit; angles map −range..range onto 0..65535; sizes × 64 (bend × 8, depth × 16). The cell lists (no wrapping: the
 * tiling copies are primitives of their own) hold every primitive within 2 px of the cell — all that draw a pixel there;
 * the mask outputs, whose distance is read far out, loop over them all. heightNorm: px for a value of 1.
 */
export function encodePrims(
	prims: PipePrim[],
	heightNorm: number,
	canvas: { width: number; height: number }
): PrimTexture & { heightNorm: number } {
	const list = prims.slice(0, MAX_PIPE_PRIMS);
	const most = (f: (p: PipePrim) => number) => list.reduce((m, p) => Math.max(m, f(p)), 0);
	const unit = fitUnit(
		// (Not the level: ±10⁴ marks a spanning run full or empty, and clamps to the same.)
		[most((p) => Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.x1), Math.abs(p.y1))), POS_RANGE],
		[most((p) => Math.max(p.radius, p.halfWidth, p.outer)), sizeRange(64)],
		[most((p) => p.bend), sizeRange(8)],
		[most((p) => p.depth), sizeRange(16)]
	);
	const bins = binByReach(
		list.map((p) =>
			p.kind === PRIM_LINE
				? { x: (p.x + p.x1) / 2, y: (p.y + p.y1) / 2, reach: Math.hypot(p.x1 - p.x, p.y1 - p.y) / 2 + p.radius + 2 }
				: p.kind === PRIM_ARC
					? { x: p.x, y: p.y, reach: p.bend + p.radius + 2 }
					: { x: p.x, y: p.y, reach: Math.hypot(p.halfWidth, p.outer) + 2 }
		),
		{ ...canvas, tile: false }
	);
	const w = new PrimWriter(PIPE_STRIDE, list.length, bins, unit);
	list.forEach((p, i) => {
		const t = w.rec(i);
		w.pos(t, 0, p.x);
		w.pos(t, 1, p.y);
		if (p.kind === PRIM_LINE) {
			w.pos(t + 1, 0, p.x1);
			w.pos(t + 1, 1, p.y1);
		} else if (p.kind === PRIM_ARC) {
			w.size(t + 1, 0, p.bend, 8);
			w.ang(t + 1, 1, p.a0, Math.PI);
			w.ang(t + 2, 0, p.sweep, 2 * Math.PI);
		} else {
			w.ang(t + 1, 0, p.a0, Math.PI);
			w.size(t + 1, 1, p.halfWidth, 64);
			w.size(t + 2, 0, p.outer, 64);
		}
		w.u16(t + 2, 1, p.pipe);
		w.u8(t + 3, 0, p.kind);
		w.size(t + 3, 1, p.radius, 64);
		w.size(t + 4, 0, p.depth, 16);
		w.pos(t + 4, 1, p.level);
	});
	return { ...w.finish(), heightNorm };
}
