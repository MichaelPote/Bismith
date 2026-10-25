// Bismuth's facets (FR8.25): each hopper face grown on the CPU as one path through a grid of cells, a terrace wide.
//
// A growing tree, as a hopper grows by its edges: a turtle starts on the rim heading along it; at each cell it takes one
// of the three ways left to it — on along its ring (straight, three times as likely), round the ring's corner, or off
// the ring (Turns, in the inner rings only: inward mostly, outward at a third of that; a key leaving its ring runs on
// straight two cells) — and where it is boxed in, growth resumes from the newest cell with a way open (or, at
// Branching's odds, from any earlier one), so a new facet branches off where two meet. Every cell is reached. A facet is
// a straight run of the path: the level rises by one at every turn (not off a one-cell run, which stays with the facet
// before it), so each facet stands at its own height and the face sinks inward in stair steps, four to a lap. The rings are squares
// about a centre Hollow offset along a diagonal, so the terraces run wide on one side. Walls (the ribs) stand between
// neighbouring cells the path doesn't join, and round the rim; a rib only ends where the path turns round it.
//
// Over the terraces stands the rim, a bar Rim width cells wide round the face; no ribs stand beside it: its own sides
// are the risers. (The keys — spirals in the hollow — are drawn by the shader on a finer scale than these cells.)

import { mulberry32 } from '@/core/hash';
import { memoize } from '@/core/memo';
import type { CpuTexture } from '../types';

/** Faces grown per layer; each crystal face picks one. */
export const FACE_TEMPLATES = 16;

/** Cell steps per direction: 0 east, 1 north, 2 west, 3 south (GL orientation, y up). */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export interface Face {
	/** Cells across. */
	n: number;
	/** Per cell (row-major, y up): the number of turns on the path from the rim. */
	level: Uint16Array;
	/** Per cell: bit 0 a wall on its east edge, bit 1 on its north edge (the rim's included), bit 2 the rim's bar over it. */
	walls: Uint8Array;
	maxLevel: number;
}

/**
 * One face of n × n cells grown by the rules above (turn, branch, hollow 0..1), with a rim rim cells wide.
 */
export function growFace(
	n: number,
	turn: number,
	branch: number,
	hollow: number,
	rim: number,
	rand: () => number
): Face {
	const count = n * n;
	const parent = new Int32Array(count).fill(-1);
	const dir = new Uint8Array(count);
	const level = new Uint16Array(count);
	// The straight run so far at each cell, and the cells a key still has to run straight after leaving its ring.
	const run = new Uint16Array(count);
	const key = new Uint8Array(count);
	const seen = new Uint8Array(count);
	const lim = Math.max(0, (n - 1) / 2 - 1);
	const cx = (n - 1) / 2 + (rand() < 0.5 ? -1 : 1) * Math.min(hollow * (n / 2), lim);
	const cy = (n - 1) / 2 + (rand() < 0.5 ? -1 : 1) * Math.min(hollow * (n / 2), lim);
	const ring = (x: number, y: number) => Math.max(Math.abs(x - cx), Math.abs(y - cy));
	const rMax = Math.max(ring(0, 0), ring(n - 1, 0), ring(0, n - 1), ring(n - 1, n - 1));
	// On the west rim, heading north or south along it.
	const start = Math.floor(rand() * n) * n;
	seen[start] = 1;
	run[start] = 2;
	dir[start] = rand() < 0.5 ? 1 : 3;
	const active = [start];
	const opts: number[] = [];
	while (active.length) {
		const ai = rand() < branch ? Math.floor(rand() * active.length) : active.length - 1;
		const c = active[ai];
		const x = c % n;
		const y = (c - x) / n;
		const d = dir[c];
		const rc = ring(x, y);
		// Turns off the ring only in the innermost rings (none in the outer 60 %, all of Turns from 85 % of the way in), so
		// the frames stay closed and the hooks gather round the hollow.
		const t = Math.min(1, Math.max(0, (1 - rc / rMax - 0.6) / 0.25));
		const tw = turn * t * t * (3 - 2 * t);
		// Ahead, left and right (and, from the start, behind: it has no parent there).
		opts.length = 0;
		let total = 0;
		for (const nd of c === start ? [d, (d + 1) & 3, (d + 3) & 3, (d + 2) & 3] : [d, (d + 1) & 3, (d + 3) & 3]) {
			const nx = x + DX[nd];
			const ny = y + DY[nd];
			if (nx < 0 || ny < 0 || nx >= n || ny >= n || seen[ny * n + nx]) continue;
			const dr = ring(nx, ny) - rc;
			// A key that has just left its ring runs on straight for two cells before it may turn.
			const ahead = nd === d ? (key[c] > 0 ? 60 : 3) : 1;
			const w = Math.max((dr > 0.5 ? 0.3 * tw : dr < -0.5 ? tw : 1) * ahead, 1e-6);
			opts.push(nd, w);
			total += w;
		}
		if (!opts.length) {
			active.splice(ai, 1);
			continue;
		}
		let pick = rand() * total;
		let i = 0;
		while (i < opts.length - 2 && (pick -= opts[i + 1]) > 0) i += 2;
		const nd = opts[i];
		const k = (y + DY[nd]) * n + x + DX[nd];
		seen[k] = 1;
		parent[k] = c;
		dir[k] = nd;
		run[k] = nd === d ? run[c] + 1 : 1;
		// A turn steps a level down — but not off a one-cell run, which stays with the facet before it.
		level[k] = level[c] + (nd !== d && run[c] >= 2 ? 1 : 0);
		key[k] = Math.abs(ring(x + DX[nd], y + DY[nd]) - rc) > 0.5 ? 2 : Math.max(key[c] - 1, 0);
		active.push(k);
	}
	// The rim: a bar w cells wide round the face.
	const w = Math.max(1, Math.round(rim));
	const bar = new Uint8Array(count);
	if (rim > 0)
		for (let c = 0; c < count; c++) {
			const x = c % n;
			const y = (c - x) / n;
			if (Math.min(x, y, n - 1 - x, n - 1 - y) < w) bar[c] = 1;
		}
	const joined = (a: number, b: number) => parent[a] === b || parent[b] === a;
	const walls = new Uint8Array(count);
	let maxLevel = 0;
	for (let c = 0; c < count; c++) {
		const x = c % n;
		const y = (c - x) / n;
		const e = x === n - 1 || bar[c] || bar[c + 1] ? 0 : joined(c, c + 1) ? 0 : 1;
		const no = y === n - 1 || bar[c] || bar[c + n] ? 0 : joined(c, c + n) ? 0 : 2;
		walls[c] = e | no | (bar[c] ? 4 : 0) | (x === n - 1 && !bar[c] ? 1 : 0) | (y === n - 1 && !bar[c] ? 2 : 0);
		maxLevel = Math.max(maxLevel, level[c]);
	}
	return { n, level, walls, maxLevel };
}

/**
 * FACE_TEMPLATES faces side by side in one RGBA8 texture (n·FACE_TEMPLATES × n): R, G the cell's depth (0.6 by its
 * ring, 0.4 by its level as a share of its face's deepest; 16 bits, R high), B its walls and bar, A the face's deepest level (at most 255).
 */
export const faceTexture = memoize(
	(n: number, turn: number, branch: number, hollow: number, rim: number, seed: number): CpuTexture => {
		const width = n * FACE_TEMPLATES;
		const data = new Uint8Array(width * n * 4);
		for (let t = 0; t < FACE_TEMPLATES; t++) {
			const f = growFace(n, turn, branch, hollow, rim, mulberry32(seed * 977 + t * 7919 + 13));
			for (let c = 0; c < n * n; c++) {
				const x = c % n;
				const y = (c - x) / n;
				// The depth: mostly by ring (from the rim in, even steps), the facets' own levels within that, so no crystal
				// gets one cliff over near-flat treads.
				const ringD = Math.min(x, y, n - 1 - x, n - 1 - y) / Math.max((n - 1) / 2, 1);
				const d = 0.6 * Math.min(ringD, 1) + 0.4 * (f.level[c] / Math.max(f.maxLevel, 1));
				const q = Math.round(Math.min(d, 1) * 65535);
				const o = (y * width + t * n + x) * 4;
				data[o] = q >> 8;
				data[o + 1] = q & 255;
				data[o + 2] = f.walls[c];
				data[o + 3] = Math.min(255, f.maxLevel);
			}
		}
		return { width, height: n, data };
	}
);
