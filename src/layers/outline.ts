// Outlines of a mask for the shared Repeat (FR8.33, docs/features/fr8.33-repeat-around-mask.md): the zero crossing of a
// field read back from the GPU (the mask's distance less the Offset) traced into polylines, their corners found, the
// instances placed along them, then sorted into buckets for the shader (glsl/repeat.ts). Pure, so it is unit tested.
//
// Coordinates are GL px (y up, texel centres at .5), as in the shaders. Every outline runs with the mask's inside on its
// right: clockwise on screen round a piece, anticlockwise round a hole. Its outward normal (away from the mask) is the
// direction of travel turned a quarter anticlockwise.

/** A field sampled at the texel centres, rows bottom-up: inside where v < 0. */
export interface Field {
	width: number;
	height: number;
	tile: boolean;
	v: Float32Array;
}

/**
 * One outline: x, y pairs, each point near the one before (unwrapped round a tiling canvas). A closed outline's last point
 * is its first again (or a copy of it a period away, for one that goes round the torus).
 */
export interface Outline {
	pts: number[];
	closed: boolean;
}

/** Marching squares: the outlines where the field crosses 0. Saddles split by the cell's middle value. */
export function traceOutlines({ width: W, height: H, tile, v }: Field): Outline[] {
	const cw = tile ? W : W - 1;
	const ch = tile ? H : H - 1;
	if (cw < 1 || ch < 1) return [];
	const at = (i: number, j: number) => v[(tile ? (j + H) % H : j) * W + (tile ? (i + W) % W : i)];
	// Edge keys: the horizontal edge from texel (i, j) to (i + 1, j) is 2(jW + i), the vertical one to (i, j + 1) that + 1.
	const hk = (i: number, j: number) => 2 * ((j % H) * W + (i % W));
	const vk = (i: number, j: number) => 2 * ((j % H) * W + (i % W)) + 1;
	const next = new Int32Array(2 * W * H).fill(-1);
	const hasIn = new Uint8Array(2 * W * H);
	const starts: number[] = [];
	const c = [0, 0, 0, 0];
	const inside = [false, false, false, false];
	const keys = [0, 0, 0, 0];
	const link = (a: number, b: number) => {
		next[a] = b;
		hasIn[b] = 1;
		starts.push(a);
	};
	for (let j = 0; j < ch; j++) {
		for (let i = 0; i < cw; i++) {
			// Corners anticlockwise from the bottom-left; edge e runs from corner e to corner e + 1.
			c[0] = at(i, j);
			c[1] = at(i + 1, j);
			c[2] = at(i + 1, j + 1);
			c[3] = at(i, j + 1);
			let idx = 0;
			for (let e = 0; e < 4; e++) {
				inside[e] = c[e] < 0;
				if (inside[e]) idx |= 1 << e;
			}
			if (idx === 0 || idx === 15) continue;
			keys[0] = hk(i, j);
			keys[1] = vk(i + 1, j);
			keys[2] = hk(i, j + 1);
			keys[3] = vk(i, j);
			// Walking the cell's border anticlockwise, the outline comes in where the walk enters the inside and leaves
			// where it leaves it; a saddle pairs each entry with the next exit, or (middle inside) the one before.
			const saddle = idx === 5 || idx === 10;
			const mid = saddle && c[0] + c[1] + c[2] + c[3] < 0;
			for (let e = 0; e < 4; e++) {
				if (inside[e] || !inside[(e + 1) % 4]) continue;
				// e: an entry (outside → inside). Its exit: the next edge going inside → outside, or the one before.
				for (let s = 1; s < 4; s++) {
					const x = mid ? (e - s + 4) % 4 : (e + s) % 4;
					if (inside[x] && !inside[(x + 1) % 4]) {
						link(keys[e], keys[x]);
						break;
					}
				}
			}
		}
	}

	const point = (key: number): [number, number] => {
		const hor = (key & 1) === 0;
		const n = key >> 1;
		const i = n % W;
		const j = (n - i) / W;
		const va = at(i, j);
		const vb = hor ? at(i + 1, j) : at(i, j + 1);
		const t = va === vb ? 0.5 : va / (va - vb);
		return hor ? [i + 0.5 + t, j + 0.5] : [i + 0.5, j + 0.5 + t];
	};
	const wrap = (d: number, period: number) => (tile ? d - period * Math.round(d / period) : d);
	const visited = new Uint8Array(2 * W * H);
	const out: Outline[] = [];
	const follow = (k0: number) => {
		const pts: number[] = [];
		let [px, py] = point(k0);
		let [rx, ry] = [px, py];
		pts.push(px, py);
		visited[k0] = 1;
		let k = next[k0];
		let closed = false;
		while (k >= 0) {
			const [x, y] = point(k);
			px += wrap(x - rx, W);
			py += wrap(y - ry, H);
			rx = x;
			ry = y;
			if (k === k0) {
				closed = true;
				pts.push(px, py);
				break;
			}
			if (visited[k]) break;
			visited[k] = 1;
			const n = pts.length;
			if (Math.abs(px - pts[n - 2]) > 1e-6 || Math.abs(py - pts[n - 1]) > 1e-6) pts.push(px, py);
			k = next[k];
		}
		if (pts.length >= 4) out.push({ pts, closed });
	};
	// Open runs (cut off by the canvas) first, from the keys nothing leads into, then the loops.
	for (const k of starts) if (!hasIn[k] && !visited[k]) follow(k);
	for (const k of starts) if (!visited[k]) follow(k);
	return out;
}

/** The canvas's own edges as an outline (inside = the canvas), pushed out by `offset` px (in, below 0). */
export function canvasOutline(width: number, height: number, offset: number): Outline[] {
	const x0 = -offset;
	const y0 = -offset;
	const x1 = width + offset;
	const y1 = height + offset;
	if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return [];
	// Clockwise on screen from the top-left corner: along the top, down the right, back along the bottom, up the left.
	return [{ pts: [x0, y1, x1, y1, x1, y0, x0, y0, x0, y1], closed: true }];
}

// ---------------------------------------------------------------- arc length

/** An outline measured along its length: cumulative lengths at its points, and its total. */
export class Path {
	readonly pts: number[];
	readonly closed: boolean;
	readonly cum: Float64Array;
	readonly length: number;
	constructor(o: Outline) {
		this.pts = o.pts;
		this.closed = o.closed;
		const n = o.pts.length / 2;
		this.cum = new Float64Array(n);
		for (let i = 1; i < n; i++) {
			this.cum[i] = this.cum[i - 1] + Math.hypot(o.pts[2 * i] - o.pts[2 * i - 2], o.pts[2 * i + 1] - o.pts[2 * i - 1]);
		}
		this.length = this.cum[n - 1];
	}
	/** s along the outline, round a closed one, clamped to an open one. */
	private norm(s: number): number {
		const L = this.length;
		if (this.closed) return L > 0 ? s - L * Math.floor(s / L) : 0;
		return Math.min(Math.max(s, 0), L);
	}
	/** The point at s; a closed outline that goes round the torus carries on a period further each time round. */
	at(s: number): [number, number] {
		const L = this.length;
		const laps = this.closed && L > 0 ? Math.floor(s / L) : 0;
		const t = this.norm(s);
		const cum = this.cum;
		let lo = 0;
		let hi = cum.length - 1;
		while (hi - lo > 1) {
			const m = (lo + hi) >> 1;
			if (cum[m] <= t) lo = m;
			else hi = m;
		}
		const seg = cum[hi] - cum[lo];
		const f = seg > 0 ? (t - cum[lo]) / seg : 0;
		const p = this.pts;
		const n = cum.length - 1;
		// (A loop round the torus ends a period from where it starts.)
		const dx = laps ? laps * (p[2 * n] - p[0]) : 0;
		const dy = laps ? laps * (p[2 * n + 1] - p[1]) : 0;
		return [p[2 * lo] + f * (p[2 * hi] - p[2 * lo]) + dx, p[2 * lo + 1] + f * (p[2 * hi + 1] - p[2 * lo + 1]) + dy];
	}
	/** The direction of travel at s, as the chord over ±w (a corner gets the bisector of its sides). */
	dir(s: number, w: number): [number, number] {
		let a = s - w;
		let b = s + w;
		if (!this.closed) {
			a = Math.max(a, 0);
			b = Math.min(b, this.length);
		}
		const [x0, y0] = this.at(a);
		const [x1, y1] = this.at(b);
		const l = Math.hypot(x1 - x0, y1 - y0);
		return l > 1e-9 ? [(x1 - x0) / l, (y1 - y0) / l] : [1, 0];
	}
	/** The topmost point's position along the outline (the leftmost of ties). */
	top(): number {
		const p = this.pts;
		let best = 0;
		for (let i = 1; i < this.cum.length; i++) {
			const dy = p[2 * i + 1] - p[2 * best + 1];
			if (dy > 1e-3 || (dy > -1e-3 && p[2 * i] < p[2 * best] - 1e-3)) best = i;
		}
		return this.cum[best];
	}
}

// ---------------------------------------------------------------- corners

export interface CornerOptions {
	/** Least turn that makes a corner (°). */
	angle: number;
	/** A corner rounded up to this radius (px) still counts as one, with |offset| added for the offset outline. */
	round: number;
}

const SAMPLE = 0.5; // px between the samples corners are found on
const SMOOTH = 2; // samples either side the turning is averaged over

/**
 * Where an outline's corners are (positions along it, ascending in [0, length)). The turning along it, averaged over about
 * 2 px, is a bend wherever it bends more tightly than a little over the rounding radius; bends of one sign close together
 * join; a bend that turns at least `angle` in all is a corner, placed where it has turned half its turn (a sharp corner's
 * vertex, a rounded one's middle). A loop that bends all the way round (a small circle) has none.
 */
export function findCorners(path: Path, o: CornerOptions): number[] {
	const L = path.length;
	if (L < 4 * SAMPLE) return [];
	const closed = path.closed;
	const m = Math.max(4, Math.round(L / SAMPLE));
	const ds = L / m;
	// Directions of the m segments between samples, then the turn between neighbours (round a closed loop).
	const ns = m;
	const ang = new Float64Array(ns);
	let [px, py] = path.at(0);
	for (let k = 0; k < ns; k++) {
		const [x, y] = path.at(closed ? (k + 1) * ds : Math.min((k + 1) * ds, L));
		ang[k] = Math.atan2(y - py, x - px);
		px = x;
		py = y;
	}
	const nt = closed ? ns : ns - 1;
	const turn = new Float64Array(nt);
	for (let k = 0; k < nt; k++) {
		let d = ang[(k + 1) % ns] - ang[k];
		d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
		turn[k] = d;
	}
	// Averaged over 2·SMOOTH + 1 samples (round a closed loop).
	const kap = new Float64Array(nt);
	for (let k = 0; k < nt; k++) {
		let s = 0;
		let c = 0;
		for (let j = -SMOOTH; j <= SMOOTH; j++) {
			const i = k + j;
			if (closed) s += turn[(i + nt) % nt];
			else if (i >= 0 && i < nt) s += turn[i];
			else continue;
			c++;
		}
		kap[k] = s / c / ds;
	}
	const k0 = 1 / (1.25 * Math.max(o.round, 0) + 6);
	const bent = (k: number) => Math.abs(kap[k]) > k0;
	// Start a closed loop's scan where it doesn't bend.
	let first = 0;
	if (closed) {
		first = -1;
		for (let k = 0; k < nt; k++)
			if (!bent(k)) {
				first = k;
				break;
			}
		if (first < 0) return [];
	}
	// Bends: runs of one sign; turn[k] sits between sample k + 1's neighbours, at (k + 1)·ds along the outline.
	type Bend = { a: number; b: number; sign: number; total: number };
	const bends: Bend[] = [];
	let cur: Bend | null = null;
	for (let n = 0; n < nt; n++) {
		const k = (first + n) % nt;
		const sg = Math.sign(kap[k]);
		if (bent(k)) {
			if (cur && cur.sign === sg) {
				cur.b = n;
				cur.total += turn[k];
			} else {
				if (cur) bends.push(cur);
				cur = { a: n, b: n, sign: sg, total: turn[k] };
			}
		} else if (cur) {
			bends.push(cur);
			cur = null;
		}
	}
	if (cur) bends.push(cur);
	// Join bends of one sign less than a few px apart (noise along a jump-flooded outline can split a rounded corner).
	const gap = Math.max(2, 0.25 * o.round) / ds;
	const joined: Bend[] = [];
	for (const b of bends) {
		const last = joined[joined.length - 1];
		if (last && last.sign === b.sign && b.a - last.b <= gap) {
			for (let n = last.b + 1; n < b.a; n++) last.total += turn[(first + n) % nt];
			last.b = b.b;
			last.total += b.total;
		} else joined.push({ ...b });
	}
	// A chamfer is one corner too: two bends of one sign join when together they make one corner (at most 135°: not the
	// U-turn round a rectangle's short end), the stretch between them is no longer than a rounded corner of that radius
	// turning as much (R · their turns), and it is shorter than the stretches either side — a short cut between long
	// sides, not a side of an even polygon.
	const R = Math.max(o.round, 0);
	const between = (from: number, to: number) => {
		let t = 0;
		for (let n = from; n < to; n++) t += turn[(first + n) % nt];
		return t;
	};
	const nb = joined.length;
	const gapAfter = joined.map((b, i) =>
		i + 1 < nb ? joined[i + 1].a - b.b - 1 : closed ? joined[0].a + nt - b.b - 1 : nt - 1 - b.b
	);
	const gapBefore = (i: number) => (i > 0 ? gapAfter[i - 1] : closed ? gapAfter[nb - 1] : joined[0].a);
	const chamfer = (i: number) => {
		const j = (i + 1) % nb;
		if (nb < 3 || (!closed && i + 1 >= nb)) return false;
		const a = joined[i];
		const b = joined[j];
		const g = gapAfter[i];
		const after = gapAfter[j];
		return (
			a.sign === b.sign &&
			Math.abs(a.total + b.total) <= 0.75 * Math.PI &&
			g * ds <= R * (Math.abs(a.total) + Math.abs(b.total)) &&
			g < 0.75 * gapBefore(i) &&
			g < 0.75 * after
		);
	};
	const corners: Bend[] = [];
	for (let i = 0; i < nb; i++) {
		if (chamfer(i) && (closed || i + 1 < nb) && !(i > 0 && chamfer(i - 1))) {
			const a = joined[i];
			const j = (i + 1) % nb;
			const b = joined[j];
			const bb = j > i ? b.b : b.b + nt;
			corners.push({
				a: a.a,
				b: bb,
				sign: a.sign,
				total: a.total + between(a.b + 1, j > i ? b.a : b.a + nt) + b.total
			});
			if (j > i) i++;
			else corners.shift();
		} else corners.push({ ...joined[i] });
	}
	const minTurn = (o.angle * Math.PI) / 180;
	const out: number[] = [];
	for (const b of corners) {
		if (Math.abs(b.total) < minTurn) continue;
		// Where half the bend's turn is reached: the middle of the stretch where it has turned half (within 2°) — a point on
		// a sharp or rounded corner, a chamfer's middle (its direction is halfway all along it).
		const half = Math.abs(b.total) / 2;
		const eps = 0.035;
		let acc = 0;
		let lo = -1;
		let hi = -1;
		for (let n = b.a; n <= b.b; n++) {
			const t = turn[(first + n) % nt] * b.sign;
			const nxt = acc + t;
			const frac = (x: number) => (t > 0 ? Math.min(Math.max((x - acc) / t, 0), 1) : 0);
			if (lo < 0 && nxt >= half - eps) lo = n + frac(half - eps);
			if (hi < 0 && nxt > half + eps) hi = n + frac(half + eps);
			acc = nxt;
		}
		if (lo < 0) lo = b.b + 1;
		if (hi < 0) hi = b.b + 1;
		const at = 0.5 * (lo + hi);
		// turn[k] is the turn at the sample between segments k and k + 1, i.e. at (k + 1)·ds; a fraction f of the way
		// through it is (k + 0.5 + f)·ds.
		const s = ((((first + at + 0.5) * ds) % L) + L) % L;
		out.push(closed ? s : Math.min(s, L));
	}
	return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------- placement

export interface PlaceOptions {
	/** Spread over: each outline, or each side (corner to corner). */
	along: 'outline' | 'side';
	/** Count: a fixed number per outline or side, or one about every `spacing` px. */
	countBy: 'repeats' | 'spacing';
	n: number;
	spacing: number;
	/** Each side: one on every corner, or centred on the side clear of its ends. */
	corners: 'on' | 'clear';
	/** Clear of the corners: how far from a side's ends the instances' centres stay (px). */
	clear: number;
	/** Corner finding (findCorners); `round` gets |offset| added. */
	angle: number;
	round: number;
	offset: number;
	/** Slides every instance along by this share of its step. */
	shift: number;
	/** Edges kept by the way they face: 0 all, 1 left + right, 2 top + bottom, 3 left, 4 right, 5 top, 6 bottom. */
	faces: number;
	/** Clear of the corners: at most how many fit on a side `len` px long (a family's own rule; Tabs: its Length). */
	fit?: (len: number) => number;
	/** At most this many in all. */
	max: number;
}

export interface Instance {
	x: number;
	y: number;
	/** The edge's direction, clockwise on screen from +x (°): the instance's local x runs along it, its up points out. */
	ang: number;
	/** The step to its neighbours along the outline (px). */
	step: number;
	/** Its index along its outline, and the outline's (for its random). */
	k: number;
	outline: number;
	/** Odd along its side (or outline): Tabs' Flip every other. */
	odd: boolean;
}

/** Which way an outline facing out along normal (nx, ny) faces: 0 left, 1 right, 2 top, 3 bottom (as Tabs' Edges). */
export function faceOf(nx: number, ny: number): number {
	return Math.abs(nx) + 1e-3 >= Math.abs(ny) ? (nx < 0 ? 0 : 1) : ny > 0 ? 2 : 3;
}
export function faceOn(faces: number, face: number): boolean {
	return faces <= 0 || (faces === 1 ? face < 2 : faces === 2 ? face >= 2 : faces - 3 === face);
}

/** The instances along every outline, in outline order (topmost first). */
export function placeInstances(outlines: Outline[], o: PlaceOptions): Instance[] {
	const paths = outlines.map((x) => new Path(x)).filter((p) => p.length > 1e-3);
	// Topmost outline first, then left to right, so their indices don't depend on the trace's order.
	const tops = paths.map((p) => p.at(p.top()));
	const order = paths.map((_, i) => i).sort((a, b) => tops[b][1] - tops[a][1] || tops[a][0] - tops[b][0]);
	const out: Instance[] = [];
	const corner = { angle: o.angle, round: Math.max(o.round, 0) + Math.abs(o.offset) };
	order.forEach((oi, r) => {
		if (out.length < o.max) placeOn(paths[oi], r, o, corner, out);
	});
	return out;
}

function placeOn(path: Path, outline: number, o: PlaceOptions, corner: CornerOptions, out: Instance[]) {
	const L = path.length;
	const repeats = o.countBy === 'repeats';
	// (Specks: a fixed count goes on anything but a speck; by spacing an outline needs half a step.)
	if (repeats && L < 2) return;
	const n = Math.max(1, Math.round(o.n));
	const spacing = Math.max(o.spacing, 1e-3);
	const corners = findCorners(path, corner);
	// A closed outline starts from its topmost point, or the corner nearest after it (a square's top-left corner).
	const top = path.top();
	if (path.closed && corners.length) {
		const from = top - 2;
		let i0 = 0;
		corners.forEach((c, i) => {
			if (fwd(from, c, L) < fwd(from, corners[i0], L)) i0 = i;
		});
		corners.push(...corners.splice(0, i0));
	}
	let k = 0;
	const push = (s: number, step: number, odd: boolean, keep: (face: number) => boolean) => {
		if (out.length >= o.max) return;
		const w = Math.max(0.5, Math.min(2, step / 4));
		const [tx, ty] = path.dir(s, w);
		if (!keep(faceOf(-ty, tx))) return;
		const [x, y] = path.at(s);
		out.push({ x, y, ang: (-Math.atan2(ty, tx) * 180) / Math.PI, step, k: k++, outline, odd });
	};
	const byFace = (f: number) => faceOn(o.faces, f);

	if (o.along === 'outline') {
		const m = repeats ? n : Math.round(L / spacing);
		if (m < 1) return;
		const step = L / m;
		if (path.closed) {
			const s0 = corners.length ? corners[0] : top;
			for (let i = 0; i < m; i++) push(s0 + (i + o.shift) * step, step, (i & 1) === 1, byFace);
		} else {
			for (let i = 0; i < m; i++) {
				const s = (i + 0.5 + o.shift) * step;
				if (s >= -1e-6 && s <= L + 1e-6) push(s, step, (i & 1) === 1, byFace);
			}
		}
		return;
	}

	// Each side: corner to corner. A closed outline without corners is one side from its topmost point; an open run's
	// pieces before its first corner and after its last are cut by the canvas at one end.
	type Side = { a: number; b: number; cutA: boolean; cutB: boolean };
	const sides: Side[] = [];
	if (path.closed) {
		if (!corners.length) sides.push({ a: top, b: top + L, cutA: false, cutB: false });
		else {
			// (Rotated to start at the top-left corner, so they may wrap: each side ends a forward step after it starts.)
			for (let i = 0; i < corners.length; i++) {
				const a = corners[i];
				const b = a + fwd(a, corners[(i + 1) % corners.length], L) || a + L;
				sides.push({ a, b, cutA: false, cutB: false });
			}
		}
	} else {
		const cuts = [0, ...corners.filter((c) => c > 1e-3 && c < L - 1e-3), L];
		for (let i = 0; i + 1 < cuts.length; i++)
			sides.push({ a: cuts[i], b: cuts[i + 1], cutA: i === 0, cutB: i + 2 === cuts.length });
	}
	// Which sides face the kept ways (a whole loop: each instance by its own facing).
	const faceKept = sides.map((sd) => {
		if (sd.b - sd.a >= L - 1e-6 && path.closed) return null;
		const [x0, y0] = path.at(sd.a);
		const [x1, y1] = path.at(sd.b);
		const l = Math.hypot(x1 - x0, y1 - y0);
		if (l < 1e-6) return null;
		return faceOn(o.faces, faceOf(-(y1 - y0) / l, (x1 - x0) / l));
	});
	const clear = o.corners === 'clear';
	sides.forEach((sd, i) => {
		const len = sd.b - sd.a;
		if (len <= 1e-6) return;
		let cnt = repeats ? n : Math.round(len / spacing);
		const centred = clear || (sd.cutA && sd.cutB);
		if (!repeats && !centred) cnt = Math.max(cnt, 1);
		if (clear) {
			const cap = o.fit ? o.fit(len) : o.clear > 0 ? Math.floor(len / (2 * o.clear)) : Infinity;
			cnt = Math.min(cnt, cap);
		}
		if (cnt < 1) return;
		const step = len / cnt;
		const own = faceKept[i];
		// A corner's instance belongs to the side it starts; with some edges left out, it stays if the side before it is kept.
		const prev = faceKept[(i - 1 + sides.length) % sides.length];
		const keepAt = (j: number) => (f: number) =>
			own === null ? byFace(f) : own || (j === 0 && !centred && !sd.cutA && prev === true);
		for (let j = 0; j < cnt; j++) {
			let s: number;
			if (centred) s = sd.a + (j + 0.5 + o.shift) * step;
			else if (sd.cutA) {
				// Cut at its start: from its corner back towards the cut (the corner itself is the next side's).
				if (j === 0) continue;
				s = sd.b - (j - o.shift) * step;
			} else s = sd.a + (j + o.shift) * step;
			if ((sd.cutA || sd.cutB) && (s < -1e-6 || s > L + 1e-6)) continue;
			push(s, step, (j & 1) === 1, keepAt(j));
		}
	});
}

/** How far forward from a to b round a loop of length L. */
function fwd(a: number, b: number, L: number): number {
	return (((b - a) % L) + L) % L;
}

// ---------------------------------------------------------------- buckets

/** Instances per row of the instance texture (glsl/repeat.ts reads two texels each). */
export const INST_ROW = 1024;

export interface Buckets {
	/** Two RGBA texels per instance: (x, y, edge angle, step), (index, outline, odd, 0); INST_ROW texels a row. */
	inst: Float32Array;
	instH: number;
	/** Row 0: (buckets across, down, bucket width, height), (largest step, instances, 0, 0); rows 1…: (first, count). */
	bucket: Float32Array;
	bucketW: number;
	bucketH: number;
}

/**
 * The instances sorted into a grid of buckets about a step wide (at least 8 px; a whole number of them across the canvas,
 * so a tiling canvas wraps bucket for bucket), and the table of where each bucket's run starts.
 */
export function bucketInstances(list: Instance[], width: number, height: number, tile: boolean): Buckets {
	const N = list.length;
	const steps = list.map((i) => i.step).sort((a, b) => a - b);
	const size = Math.min(Math.max(N ? steps[N >> 1] : 8, 8), Math.max(width, height));
	const nbx = Math.max(1, Math.round(width / size));
	const nby = Math.max(1, Math.round(height / size));
	const bw = width / nbx;
	const bh = height / nby;
	const wrap = (x: number, p: number) => (tile ? x - p * Math.floor(x / p) : x);
	const bucketOf = (i: Instance) => {
		const bx = Math.min(Math.max(Math.floor(wrap(i.x, width) / bw), 0), nbx - 1);
		const by = Math.min(Math.max(Math.floor(wrap(i.y, height) / bh), 0), nby - 1);
		return by * nbx + bx;
	};
	const of = list.map(bucketOf);
	const count = new Int32Array(nbx * nby);
	for (const b of of) count[b]++;
	const first = new Int32Array(nbx * nby);
	for (let b = 1; b < first.length; b++) first[b] = first[b - 1] + count[b - 1];
	const fill = first.slice();
	const instH = Math.max(1, Math.ceil((2 * N) / INST_ROW));
	const inst = new Float32Array(INST_ROW * instH * 4);
	let maxStep = 0;
	list.forEach((it, i) => {
		const t = fill[of[i]]++;
		const o = 8 * t;
		inst[o] = wrap(it.x, width);
		inst[o + 1] = wrap(it.y, height);
		inst[o + 2] = it.ang;
		inst[o + 3] = it.step;
		inst[o + 4] = it.k;
		inst[o + 5] = it.outline;
		inst[o + 6] = it.odd ? 1 : 0;
		maxStep = Math.max(maxStep, it.step);
	});
	const bucketW = Math.max(nbx, 2);
	const bucketH = nby + 1;
	const bucket = new Float32Array(bucketW * bucketH * 4);
	bucket.set([nbx, nby, bw, bh, maxStep, N, 0, 0], 0);
	for (let by = 0; by < nby; by++)
		for (let bx = 0; bx < nbx; bx++) {
			const b = by * nbx + bx;
			const o = ((by + 1) * bucketW + bx) * 4;
			bucket[o] = first[b];
			bucket[o + 1] = count[b];
		}
	return { inst, instH, bucket, bucketW, bucketH };
}
