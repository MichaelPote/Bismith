// Circuit router (FR8.10): space-filling traces that never touch, computed on the CPU (a global, sequential process a
// pixel shader can't run) and handed to the Traces generator as a per-node texture.
//
// Nodes on a (wrapping, when tiling) grid. A trace walks node to node in one fixed set of directions — 8 (0°, the
// diagonal angle, 90° …), 6 (horizontal and the four diagonals: hexagonal when the diagonal angle is 60°) or 4 (right
// angles) — and only ever bends one step within that set; sets are never mixed. A trace may only
// enter a node whose neighbourhood is free of other traces (and of its own body, bar its last steps), so traces keep at
// least `gap` free nodes between them and never touch or cross. A few long seed walks go first; then the rest of the
// space fills with traces started next to existing ones and preferring to run alongside them (buses).

import { seededRng } from '@/core/hash';
import { imod } from '../derivedMath';

export interface RouteOptions {
	nx: number;
	ny: number;
	wrap: boolean;
	seed: number;
	/** Long random walks laid first. */
	seeds: number;
	seedLength: number;
	/** Fill traces shorter than this are dropped. */
	minLength: number;
	maxLength: number;
	/** Free nodes kept between traces (0 = neighbouring nodes allowed — they still never touch or cross). */
	gap: number;
	/** Chance of carrying straight on at each step. */
	straight: number;
	/** Direction set: 8 (king moves), 6 (no verticals — hexagonal with a 60° diagonal angle) or 4 (right angles). */
	directions: 4 | 6 | 8;
	/**
	 * Preference for running alongside existing traces — any beside the step (saturating at 1), far more one running the
	 * same way — and for starting the next traces beside a new one (certainly from 2): buses that bend together.
	 */
	hug: number;
	/** Share of possible fill starts actually tried (0..1): lower leaves more empty board. */
	fill: number;
	/** Chance of a via at an interior node. */
	vias: number;
	/** Rectangular areas kept free of traces: 0 none … 1 about half the board (open board between clusters). */
	open?: number;
	/** Their typical side, as a share of the board (default 0.15). */
	openSize?: number;
	/** Horizontal against vertical steps (0 mostly vertical, 1 mostly horizontal; 0.5, the default, = no preference). */
	bias?: number;
	/** Chance each node is dropped, breaking its trace into two pad-ended pieces (pin pads: more, shorter traces). */
	pins?: number;
}

/**
 * The 8 king moves, east then counter-clockwise (y down): the router's directions (sorted by angle, so "one step" in a
 * set is the neighbouring direction), and bit d of a Traces node's link mask (a trace from it toward KING[d]).
 */
export const KING: [number, number][] = [
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
	[0, -1],
	[1, -1]
];

export interface RouteResult {
	nx: number;
	ny: number;
	/** Per node: outgoing direction (a KING index) or -1. */
	out: Int8Array;
	/** Per node: bit 0 pad (trace end), bit 1 via, bit 2 on a trace. */
	flags: Uint8Array;
	/** Per node: the trace id (0 = free; pads also reserve the ring round them). */
	owner: Int32Array;
	traces: number;
}

/** Array index of node (x, y) on an nx × ny board: wrapped when it wraps, else -1 off the board. */
export const nodeIndex = (x: number, y: number, nx: number, ny: number, wrap: boolean): number =>
	wrap ? imod(y, ny) * nx + imod(x, nx) : x < 0 || y < 0 || x >= nx || y >= ny ? -1 : y * nx + x;

export function routeTraces(o: RouteOptions): RouteResult {
	const { nx, ny } = o;
	const n = nx * ny;
	const owner = new Int32Array(n); // 0 = free, else trace id
	const order = new Int32Array(n).fill(-1); // step index within its trace (for the own-tail exemption)
	const out = new Int8Array(n).fill(-1);
	const flags = new Uint8Array(n);
	const rand = seededRng(o.seed * 2654435761 + 17);
	const idx = (x: number, y: number): number => nodeIndex(x, y, nx, ny, o.wrap);
	// Indices into KING (sorted by angle), so "one step" in the set is always the neighbouring direction.
	const dirs = o.directions === 4 ? [0, 2, 4, 6] : o.directions === 6 ? [0, 1, 3, 4, 5, 7] : [0, 1, 2, 3, 4, 5, 6, 7];
	const gap = Math.max(0, Math.round(o.gap));
	const pins = o.pins ?? 0;
	const keepOut = openAreas(nx, ny, o.wrap, o.seed, o.open ?? 0, o.openSize ?? 0.15);
	// Horizontal bias: horizontal steps weigh 2·bias, vertical ones 2·(1 − bias), diagonals 1.
	const bias = Math.min(1, Math.max(0, o.bias ?? 0.5));
	const dirW = KING.map(([x, y]) => (y === 0 ? 2 * bias : x === 0 ? 2 * (1 - bias) : 1));
	let dirTot = 0;
	for (const d of dirs) dirTot += dirW[d];
	/** A random direction of the set, weighted by the bias. */
	const pickDir = (r: number): number => {
		const v = r * dirTot;
		let acc = 0;
		for (const d of dirs) if (v < (acc += dirW[d])) return d;
		return dirs[dirs.length - 1];
	};

	/**
	 * Visits the board nodes of the (2r + 1)² box round (x, y) in raster order — only its ring (Chebyshev distance r) when
	 * `ring` — until fn returns true; whether it did.
	 */
	const scan = (x: number, y: number, r: number, ring: boolean, fn: (j: number) => boolean | void): boolean => {
		for (let dy = -r; dy <= r; dy++) {
			const step = ring && Math.abs(dy) !== r ? 2 * r : 1;
			for (let dx = -r; dx <= r; dx += step) {
				const j = idx(x + dx, y + dy);
				if (j >= 0 && fn(j)) return true;
			}
		}
		return false;
	};
	/** Can trace `t` (currently at step `k`) occupy node i? Its neighbourhood must hold no other trace, nor its own older body. */
	const clear = (x: number, y: number, t: number, k: number): boolean => {
		const i = idx(x, y);
		if (i < 0 || owner[i] !== 0 || (keepOut !== null && keepOut[i])) return false;
		return !scan(x, y, gap, false, (j) => owner[j] !== 0 && (owner[j] !== t || order[j] < k - 2 - gap));
	};
	/**
	 * Another trace gap + 1 nodes to the side of a step: 0 none, 1 one beside it, 2 one running in direction d (either
	 * way). Hugging them makes buses.
	 */
	const beside = (x: number, y: number, d: number, t: number): number => {
		const back = (d + 4) % 8;
		let found = 0;
		scan(x, y, gap + 1, true, (j) => {
			if (owner[j] === 0 || owner[j] === t) return;
			found = out[j] === d || out[j] === back ? 2 : 1;
			return found === 2;
		});
		return found;
	};

	let traceId = 0;
	/** The path of the last trace laid (for Run alongside's bus starts). */
	let lastPath: number[] = [];
	const walk = (sx: number, sy: number, d0: number, maxLen: number, minLen: number): boolean => {
		const t = ++traceId;
		const path: number[] = [];
		let x = sx;
		let y = sy;
		let d = d0;
		if (!clear(x, y, t, 0)) return false;
		const take = (i: number, k: number) => {
			owner[i] = t;
			order[i] = k;
		};
		take(idx(x, y), 0);
		path.push(idx(x, y));
		// Pads need room: a ring of nodes free of other traces (and of this one's far body). A blocked end backs off a few
		// nodes to find it; an end that can't has no pad.
		const roomy = (i: number): boolean =>
			!scan(
				i % nx,
				Math.floor(i / nx),
				1,
				false,
				(j) => owner[j] !== 0 && (owner[j] !== t || Math.abs(order[j] - order[i]) > 3)
			);
		for (let k = 1; k < maxLen; k++) {
			// Pin pads also end traces early, where a pad has room.
			if (k > Math.max(minLen, 3) && pins > 0 && rand() < 0.25 * pins && roomy(path[path.length - 1])) break;
			// Candidates: straight on, or one step of the direction set either way, weighted.
			const cands: { d: number; w: number }[] = [];
			const pos = dirs.indexOf(d);
			for (const delta of [0, 1, -1]) {
				const nd = dirs[(pos + delta + dirs.length) % dirs.length];
				let w = (delta === 0 ? o.straight : 0.5 * (1 - o.straight)) * dirW[nd];
				const [ddx, ddy] = KING[nd];
				const near = o.hug > 0 ? beside(x + ddx, y + ddy, nd, t) : 0;
				if (near > 0) w *= 1 + 4 * Math.min(o.hug, 1);
				// A neighbour running the same way weighs far more: buses that bend together.
				if (near > 1) w *= 1 + 6 * o.hug;
				cands.push({ d: nd, w: w + 1e-3 });
			}
			// Try in a weighted random order; the first clear one wins.
			let moved = false;
			while (cands.length) {
				const tot = cands.reduce((s, c) => s + c.w, 0);
				let r = rand() * tot;
				let pick = 0;
				for (; pick < cands.length - 1; pick++) if ((r -= cands[pick].w) <= 0) break;
				const c = cands.splice(pick, 1)[0];
				const [ddx, ddy] = KING[c.d];
				const nxp = x + ddx;
				const nyp = y + ddy;
				if (!clear(nxp, nyp, t, k)) continue;
				// A 45° step must not cross another 45° step over the same grid square — another trace's or its own (a loop
				// coming back round).
				if (Math.abs(ddx) === 1 && Math.abs(ddy) === 1) {
					const a = idx(x + ddx, y);
					const b = idx(x, y + ddy);
					if (a >= 0 && b >= 0 && owner[a] !== 0 && owner[a] === owner[b]) {
						if (out[a] >= 0 && idx(x + ddx + KING[out[a]][0], y + KING[out[a]][1]) === b) continue;
						if (out[b] >= 0 && idx(x + KING[out[b]][0], y + ddy + KING[out[b]][1]) === a) continue;
					}
				}
				out[idx(x, y)] = c.d;
				x = nxp;
				y = nyp;
				d = c.d;
				take(idx(x, y), k);
				path.push(idx(x, y));
				moved = true;
				break;
			}
			if (!moved) break;
		}
		const drop = (i: number) => {
			owner[i] = 0;
			order[i] = -1;
			out[i] = -1;
		};
		for (let b = 0; b < 3 && path.length > minLen && !roomy(path[path.length - 1]); b++) {
			drop(path.pop()!);
			out[path[path.length - 1]] = -1;
		}
		for (let b = 0; b < 3 && path.length > minLen && !roomy(path[0]); b++) drop(path.shift()!);
		if (path.length < minLen) {
			for (const i of path) drop(i);
			return false;
		}
		const pad = (i: number) => {
			flags[i] |= 1;
			// Reserve the ring, so later traces keep clear of the pad.
			scan(i % nx, Math.floor(i / nx), 1, false, (j) => {
				if (owner[j] === 0) {
					owner[j] = t;
					order[j] = order[i];
				}
			});
		};
		for (const i of path) flags[i] |= 4;
		// Pin pads: drop a node at random — the trace becomes two, each ending in a pad one node short of the gap (pieces
		// keep at least two links).
		let since = 2;
		for (let i = 3; i < path.length - 3; i++) {
			since++;
			if (since < 3 || !(rand() < pins) || !roomy(path[i - 1]) || !roomy(path[i + 1])) continue;
			out[path[i - 1]] = -1;
			out[path[i]] = -1;
			flags[path[i]] = 0;
			pad(path[i - 1]);
			pad(path[i + 1]);
			since = -1;
		}
		if (roomy(path[0])) pad(path[0]);
		if (roomy(path[path.length - 1])) pad(path[path.length - 1]);
		for (let i = 1; i < path.length - 1; i++) if ((flags[path[i]] & 5) === 4 && rand() < o.vias) flags[path[i]] |= 2;
		lastPath = path;
		return true;
	};

	let traces = 0;
	for (let s = 0; s < o.seeds; s++) {
		for (let tries = 0; tries < 20; tries++) {
			if (
				walk(Math.floor(rand() * nx), Math.floor(rand() * ny), pickDir(rand()), o.seedLength, Math.min(o.minLength, 4))
			) {
				traces++;
				break;
			}
		}
	}
	// Fill: every node in random order; start beside existing traces where possible, running parallel to them.
	const nodes = Array.from({ length: n }, (_, i) => i);
	for (let i = n - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[nodes[i], nodes[j]] = [nodes[j], nodes[i]];
	}
	// Run alongside: the free nodes beside a new trace start traces next (by chance, certainly from 2), so buses grow
	// trace by trace.
	const bus = Math.min(1, Math.max(0, o.hug) / 2);
	const queue: number[] = [];
	let head = 0;
	const start = (i: number) => {
		if (owner[i] !== 0 || (keepOut !== null && keepOut[i]) || rand() > o.fill) return;
		const x = i % nx;
		const y = Math.floor(i / nx);
		// Direction of a neighbouring trace (if any) within gap + 1 nodes — run alongside it.
		let d = pickDir(rand());
		const r = gap + 1;
		scan(x, y, r, false, (j) => {
			if (out[j] < 0) return false;
			d = out[j];
			if (!dirs.includes(d)) d = pickDir(rand());
			return true;
		});
		const pos = dirs.indexOf(d);
		const flip = rand() < 0.5 ? 0 : dirs.length / 2;
		for (let a = 0; a < dirs.length; a++) {
			// d, its opposite, then the rest (alternating either side).
			const off = a < 2 ? a * (dirs.length / 2) : (a % 2 ? 1 : -1) * Math.ceil((a - 1) / 2);
			if (walk(x, y, dirs[(pos + flip + off + 2 * dirs.length) % dirs.length], o.maxLength, o.minLength)) {
				traces++;
				if (bus > 0 && rand() < bus)
					for (const pi of lastPath)
						scan(pi % nx, Math.floor(pi / nx), r, true, (j) => {
							if (owner[j] === 0) queue.push(j);
						});
				break;
			}
		}
	};
	// Two passes (pads and later traces open or close room), each start trying its directions until one walks.
	for (let pass = 0; pass < 2; pass++)
		for (const i of nodes) {
			start(i);
			while (head < queue.length) start(queue[head++]);
		}
	return { nx, ny, out, flags, owner, traces };
}

/**
 * Open board: nodes kept free of traces — rectangles of varied size and shape (a component's footprint, a mounting
 * area), wrapping when tiling, laid until about `open` × 50 % of the board is covered. `size`: their typical side as
 * a share of the board (each 0.4–1.6× that, aspect up to 3:1). Null when off.
 */
function openAreas(nx: number, ny: number, wrap: boolean, seed: number, open: number, size: number): Uint8Array | null {
	if (!(open > 0)) return null;
	const rand = seededRng(seed * 40503 + 977);
	const out = new Uint8Array(nx * ny);
	const want = 0.5 * Math.min(1, open) * nx * ny;
	const side = Math.max(2, Math.min(1, Math.max(0.02, size)) * Math.sqrt(nx * ny));
	let covered = 0;
	for (let k = 0; k < 256 && covered < want; k++) {
		const s = side * (0.4 + 1.2 * rand());
		const aspect = Math.exp((rand() * 2 - 1) * Math.log(3));
		const w = Math.max(2, Math.round(s * Math.sqrt(aspect)));
		const h = Math.max(2, Math.round(s / Math.sqrt(aspect)));
		const x0 = Math.floor(rand() * nx);
		const y0 = Math.floor(rand() * ny);
		for (let y = y0; y < y0 + h; y++)
			for (let x = x0; x < x0 + w; x++) {
				if (!wrap && (x >= nx || y >= ny)) continue;
				const i = (y % ny) * nx + (x % nx);
				if (!out[i]) covered++;
				out[i] = 1;
			}
	}
	return out;
}
