// Strapwork's line network (FR8.30), on the CPU: a periodic tiling, a construction over it (its edges, star patterns by
// rays from each edge's midpoint, or each tile's outline scaled and rounded into overlapping rings), the lines split
// where they cross, the fields between them found on a raster of one period (each with a kind by its size and a colour
// of a two-colouring), and over / under at each crossing from that colouring, so every strand weaves.
// Pure: no GPU, no project types. Coordinates are in tiling units; one period is the rectangle [0, P.x) × [0, P.y).

export type V2 = [number, number];

export interface Tiling {
	/** The period rectangle. */
	period: V2;
	/** Tiles near the period (CCW); the tiling is these translated by whole periods. */
	polys: V2[][];
}

export const TILINGS = ['square', 'hexagon', 'triangle', 'octagon', 'trihex', 'dodecagon', 'rhombille'] as const;
export type TilingName = (typeof TILINGS)[number];

const S3 = Math.sqrt(3);
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const norm = (a: V2): V2 => mul(a, 1 / (len(a) || 1));
const ngon = (c: V2, r: number, n: number, a0: number): V2[] =>
	Array.from({ length: n }, (_, i) => {
		const a = a0 + (i * 2 * Math.PI) / n;
		return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
	});
const ccw = (p: V2[]): V2[] => {
	let s = 0;
	for (let i = 0; i < p.length; i++) s += cross(p[i], p[(i + 1) % p.length]);
	return s < 0 ? [...p].reverse() : p;
};

/** Triangular lattice points (spacing 1, rows √3/2 apart) whose cells touch the period [1, √3]. */
function triLattice(): V2[] {
	const out: V2[] = [];
	for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) out.push([i + (j & 1 ? 0.5 : 0), (j * S3) / 2]);
	return out;
}

export function makeTiling(name: TilingName): Tiling {
	switch (name) {
		case 'square':
			return {
				period: [1, 1],
				polys: [
					[
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 1]
					]
				]
			};
		case 'hexagon':
		case 'rhombille': {
			// Pointy-top hexagons a unit across the flats, centred on the triangular lattice.
			const hexes = triLattice().map((c) => ngon(c, 1 / S3, 6, Math.PI / 6));
			if (name === 'hexagon') return { period: [1, S3], polys: hexes };
			// Each hexagon split into three rhombi from its centre to alternate corners.
			const rh: V2[][] = [];
			for (const h of hexes) {
				const c = mul(
					h.reduce((a, b) => add(a, b), [0, 0] as V2),
					1 / 6
				);
				for (let k = 0; k < 6; k += 2) rh.push(ccw([c, h[k], h[k + 1], h[(k + 2) % 6]]));
			}
			return { period: [1, S3], polys: rh };
		}
		case 'triangle': {
			const t: V2[][] = [];
			for (const p of triLattice()) {
				t.push(ccw([p, add(p, [1, 0]), add(p, [0.5, S3 / 2])]));
				t.push(ccw([add(p, [1, 0]), add(p, [1.5, S3 / 2]), add(p, [0.5, S3 / 2])]));
			}
			return { period: [1, S3], polys: t };
		}
		case 'octagon': {
			// Octagons in the unit square, small squares (turned 45°) at its corners.
			const c = 1 / (2 + Math.SQRT2);
			const oct: V2[] = [
				[c, 0],
				[1 - c, 0],
				[1, c],
				[1, 1 - c],
				[1 - c, 1],
				[c, 1],
				[0, 1 - c],
				[0, c]
			];
			return {
				period: [1, 1],
				polys: [
					oct,
					[
						[0, -c],
						[c, 0],
						[0, c],
						[-c, 0]
					]
				]
			};
		}
		case 'trihex': {
			// Hexagons (side ½) on the lattice, triangles between them.
			const pts = triLattice();
			const polys: V2[][] = pts.map((c) => ngon(c, 0.5, 6, 0));
			for (const p of pts) {
				const a = add(p, [1, 0]);
				const b = add(p, [0.5, S3 / 2]);
				const d = add(p, [1.5, S3 / 2]);
				polys.push(ccw([mul(add(p, a), 0.5), mul(add(a, b), 0.5), mul(add(p, b), 0.5)]));
				polys.push(ccw([mul(add(a, b), 0.5), mul(add(a, d), 0.5), mul(add(b, d), 0.5)]));
			}
			return { period: [1, S3], polys };
		}
		case 'dodecagon': {
			// Dodecagons on the lattice (touching edge to edge), triangles in the gaps.
			const pts = triLattice();
			const R = 0.5 / Math.cos(Math.PI / 12);
			const dod = pts.map((c) => ngon(c, R, 12, Math.PI / 12));
			const polys: V2[][] = [...dod];
			const near = (cs: V2[], at: V2): V2[] => {
				const vs: V2[] = [];
				for (const c of cs) {
					const d = ngon(c, R, 12, Math.PI / 12)
						.map((v) => ({ v, d: len(sub(v, at)) }))
						.sort((x, y) => x.d - y.d);
					vs.push(d[0].v, d[1].v);
				}
				const u: V2[] = [];
				for (const v of vs) if (!u.some((w) => len(sub(v, w)) < 1e-6)) u.push(v);
				return u;
			};
			for (const p of pts) {
				const a = add(p, [1, 0]);
				const b = add(p, [0.5, S3 / 2]);
				const d = add(p, [1.5, S3 / 2]);
				const t1 = near([p, a, b], mul(add(add(p, a), b), 1 / 3));
				const t2 = near([a, d, b], mul(add(add(a, d), b), 1 / 3));
				if (t1.length === 3) polys.push(ccw(t1));
				if (t2.length === 3) polys.push(ccw(t2));
			}
			return { period: [1, S3], polys };
		}
	}
}

/**
 * A square-period tiling turned 45°: its lattice turned, on the axis-aligned period √2 times as large (two of its
 * periods), so the turned pattern still tiles.
 */
export function diagonal(t: Tiling): Tiling {
	const [px, py] = t.period;
	if (Math.abs(px - py) > 1e-9) return t;
	const P = px * Math.SQRT2;
	const rot = (v: V2): V2 => [(v[0] - v[1]) / Math.SQRT2, (v[0] + v[1]) / Math.SQRT2];
	const polys: V2[][] = [];
	for (let j = -3; j <= 3; j++)
		for (let i = -3; i <= 3; i++)
			for (const p of t.polys) {
				const q = p.map((v) => rot(add(v, [i * px, j * py])));
				const c = mul(
					q.reduce((a, b) => add(a, b), [0, 0] as V2),
					1 / q.length
				);
				// Each tile once: the one whose centre falls in the new period.
				if (c[0] >= -1e-9 && c[0] < P - 1e-9 && c[1] >= -1e-9 && c[1] < P - 1e-9) polys.push(q);
			}
	return { period: [P, P], polys };
}

export type Construction = 'edges' | 'stars' | 'rings' | 'edges_stars' | 'edges_rings' | 'rings_spokes' | 'links';

export interface BuildOpts {
	tiling: TilingName;
	construct: Construction;
	/** Stars: the rays' angle to their edge, degrees. */
	angle: number;
	/** Stars: how far apart the two rays start, a share of the edge. */
	offset: number;
	/** Rings: outline scale about the tile's centre. */
	ringScale: number;
	/** Rings: corner rounding, a share of the inradius (1 = circles). */
	ringRound: number;
	/** Turn a square-period tiling 45°. */
	diagonal?: boolean;
	/** Stars: rays run on to the tile's border instead of stopping where they meet. */
	through?: boolean;
	/**
	 * Stars: grown on each tile's outline scaled about its centre by this (1 = the tile itself); below 1 each star is a
	 * rosette inside its tile, tied to the tile's edges by a spoke from each ray pair's start.
	 */
	starInset?: number;
	/** Edges and stars: leave each tile edge open between its ray pair's starts (the pair's diamond stays whole). */
	edgeGap?: boolean;
	/** Links: beads along each tile edge. */
	linkN?: number;
	/** Links: how far each bead swells either side of its edge, a share of the bead's length. */
	linkW?: number;
}

/**
 * A segment, and its class: 1 a tile edge (edges can be drawn heavier), 2 a rosette's spoke against a frame (never
 * merged with the next one), else a star ray or ring.
 */
type Seg = [V2, V2, number?];

/** The tiles' edges; with `gap` > 0 each left open over that share of it round its midpoint. */
function edgesOf(polys: V2[][], gap = 0): Seg[] {
	const out: Seg[] = [];
	for (const p of polys)
		for (let i = 0; i < p.length; i++) {
			const v = p[i];
			const w = p[(i + 1) % p.length];
			if (gap <= 1e-6) {
				out.push([v, w, 1]);
			} else {
				const m = mul(add(v, w), 0.5);
				const h = mul(sub(w, v), 0.5 * gap);
				out.push([v, sub(m, h), 1], [add(m, h), w, 1]);
			}
		}
	return out;
}

/**
 * Chained beads along each tile edge: `n` beads end to end, each two chamfered sides (an elongated hexagon) swelling
 * `w` × its length either side of the edge, so a strap round it leaves an almond eye inside.
 */
function links(polys: V2[][], n: number, w: number): Seg[] {
	const out: Seg[] = [];
	const k = (v: V2) => `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)}`;
	for (const p of polys)
		for (let i = 0; i < p.length; i++) {
			// The same numbers from both tiles sharing the edge (so the copies dedupe).
			let v = p[i];
			let u = p[(i + 1) % p.length];
			if (k(v) > k(u)) [v, u] = [u, v];
			const d = sub(u, v);
			const nrm: V2 = [-d[1], d[0]];
			for (let j = 0; j < n; j++) {
				const a = add(v, mul(d, j / n));
				const b = add(v, mul(d, (j + 1) / n));
				for (const sg of [1, -1]) {
					// Chamfered: in at a quarter of the bead, straight along its middle half.
					const off = mul(nrm, (sg * w) / n);
					const c1 = add(add(a, mul(d, 0.25 / n)), off);
					const c2 = add(add(a, mul(d, 0.75 / n)), off);
					out.push([a, c1], [c1, c2], [c2, b]);
				}
			}
		}
	return out;
}

/** Ray–ray meeting point: a + s·da = b + t·db with s, t > 0, or null. */
function meet(a: V2, da: V2, b: V2, db: V2): V2 | null {
	const den = cross(da, db);
	if (Math.abs(den) < 1e-9) return null;
	const s = cross(sub(b, a), db) / den;
	const t = cross(sub(b, a), da) / den;
	return s > 1e-9 && t > 1e-9 ? add(a, mul(da, s)) : null;
}

/** Where a ray from inside a polygon leaves it (the nearest edge it crosses ahead). */
function exitOf(p: V2[], a: V2, d: V2): V2 | null {
	let best = Infinity;
	for (let i = 0; i < p.length; i++) {
		const c = p[i];
		const e = sub(p[(i + 1) % p.length], c);
		const den = cross(d, e);
		if (Math.abs(den) < 1e-12) continue;
		const t = cross(sub(c, a), e) / den;
		const u = cross(sub(c, a), d) / den;
		if (t > 1e-7 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
	}
	return Number.isFinite(best) ? add(a, mul(d, best)) : null;
}

/**
 * Hankin's polygons in contact: from each edge's midpoint two rays at `angle` to it, cut where they meet the next —
 * or, `through`, run on to where they leave the tile (crossing bars: woven planks, lattices).
 */
function stars(polys: V2[][], angle: number, offset: number, through = false, inset = 1, framed = false): Seg[] {
	const th = (angle * Math.PI) / 180;
	const out: Seg[] = [];
	for (const p0 of polys) {
		const n = p0.length;
		// A rosette: the star grown on the outline scaled about the centre, a spoke from each edge's midpoint to the
		// scaled one. Framed (the tile edges drawn too), spokes butt against the edge (class 2: never merged into one bar
		// with the next tile's spoke).
		const c0 = mul(
			p0.reduce((a, b) => add(a, b), [0, 0] as V2),
			1 / n
		);
		const p = inset < 0.999 ? p0.map((v) => add(c0, mul(sub(v, c0), inset))) : p0;
		if (p !== p0)
			for (let i = 0; i < n; i++)
				out.push([mul(add(p0[i], p0[(i + 1) % n]), 0.5), mul(add(p[i], p[(i + 1) % n]), 0.5), framed ? 2 : 0]);
		const mids = p.map((v, i) => {
			const w = p[(i + 1) % n];
			const e = norm(sub(w, v));
			const nIn: V2 = [-e[1], e[0]];
			const m = mul(add(v, w), 0.5);
			const off = offset * len(sub(w, v)) * 0.5;
			return {
				// Ray A leans toward the edge's end (vertex i + 1), ray B toward its start.
				a: add(m, mul(e, off)),
				da: add(mul(e, Math.cos(th)), mul(nIn, Math.sin(th))),
				b: add(m, mul(e, -off)),
				db: add(mul(e, -Math.cos(th)), mul(nIn, Math.sin(th)))
			};
		});
		if (through) {
			for (const M of mids) {
				const xa = exitOf(p, M.a, M.da);
				const xb = exitOf(p, M.b, M.db);
				if (xa) out.push([M.a, xa]);
				if (xb) out.push([M.b, xb]);
			}
			continue;
		}
		for (let i = 0; i < n; i++) {
			const A = mids[i];
			const B = mids[(i + 1) % n];
			const x = meet(A.a, A.da, B.b, B.db);
			if (x) out.push([A.a, x], [B.b, x]);
			else if (Math.abs(cross(A.da, B.db)) < 1e-9 && dot(A.da, B.db) < 0 && dot(sub(B.b, A.a), A.da) > 1e-9)
				// Collinear rays heading at each other (squares at 45°): the segment between their starts.
				out.push([A.a, B.b]);
		}
	}
	return out;
}

/**
 * Each tile's outline scaled about its centroid, its corners rounded (sampled into short segments); with `spokes`, a
 * line from each tile corner to the ring's corner (coffers joined corner to corner).
 */
function rings(polys: V2[][], scale: number, round: number, spokes = false): Seg[] {
	const out: Seg[] = [];
	for (const p0 of polys) {
		const n = p0.length;
		const c = mul(
			p0.reduce((a, b) => add(a, b), [0, 0] as V2),
			1 / n
		);
		const p = p0.map((v) => add(c, mul(sub(v, c), scale)));
		// Inradius of the scaled polygon (distance from the centroid to its nearest edge).
		let inr = Infinity;
		for (let i = 0; i < n; i++) {
			const a = p[i];
			const e = norm(sub(p[(i + 1) % n], a));
			inr = Math.min(inr, Math.abs(cross(e, sub(c, a))));
		}
		// Eased so the corners round off visibly from the start (a linear radius stays squarish until near 1).
		const rr = Math.max(0, Math.min(1, round));
		const r = (1 - (1 - rr) * (1 - rr)) * inr * 0.999;
		const pts: V2[] = [];
		for (let i = 0; i < n; i++) {
			const prev = p[(i + n - 1) % n];
			const v = p[i];
			const next = p[(i + 1) % n];
			if (r <= 1e-6) {
				pts.push(v);
				if (spokes) out.push([p0[i], v]);
				continue;
			}
			// The arc tangent to both edges at the corner: its centre on the bisector, r from each edge.
			const e1 = norm(sub(prev, v));
			const e2 = norm(sub(next, v));
			const half = Math.acos(Math.max(-1, Math.min(1, dot(e1, e2)))) / 2;
			const t = r / Math.tan(half);
			const a = add(v, mul(e1, t));
			const b = add(v, mul(e2, t));
			const ctr = add(v, mul(norm(add(e1, e2)), r / Math.sin(half)));
			const a0 = Math.atan2(a[1] - ctr[1], a[0] - ctr[0]);
			let a1 = Math.atan2(b[1] - ctr[1], b[0] - ctr[0]);
			while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
			while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
			const k = 6;
			for (let j = 0; j <= k; j++) {
				const ang = a0 + ((a1 - a0) * j) / k;
				pts.push([ctr[0] + r * Math.cos(ang), ctr[1] + r * Math.sin(ang)]);
			}
			// The spoke meets the arc at its middle (the point toward the corner).
			if (spokes) out.push([p0[i], pts[pts.length - 1 - k / 2]]);
		}
		for (let i = 0; i < pts.length; i++) out.push([pts[i], pts[(i + 1) % pts.length]]);
	}
	return out;
}

export interface Piece {
	a: V2;
	b: V2;
	/** The line it is part of (for over / under). */
	line: number;
	/** 1 a tile edge, 0 a star ray or ring. */
	cls: number;
	/**
	 * At each end: 0 a plain end or join, 1 over a crossing, 2 under it, 3 ending on another line's side (a T: it butts
	 * against that strap), 4 the same against a tile edge (which may be drawn heavier).
	 */
	endA: number;
	endB: number;
}

export interface Net {
	period: V2;
	/** How many tiling periods the period holds across and down (1, or 2 when one couldn't be two-coloured). */
	rep: V2;
	/** Pieces whose midpoints lie in the period (the canonical copy of each). */
	pieces: Piece[];
	/** Field labels over one period: rw × rh texels, region id per texel (0 none). */
	rw: number;
	rh: number;
	label: Uint16Array;
	/** Per region id: kind (by size, 0 = largest), colour (0 / 1), inradius in tiling units. */
	regions: { kind: number; colour: number; inr: number; area: number; ang: number }[];
	/** Neighbouring fields of the same colour (the weave is wrong somewhere round them). */
	conflicts: number;
	/** Some vertex joins an odd number of lines, so no weave can be right everywhere. */
	odd: boolean;
}

function mergeCollinear(input: Seg[]): Seg[] {
	const segs: (Seg | null)[] = input.map((s) => [s[0], s[1], s[2]]);
	const r = (v: number) => Math.round(v * 1e5);
	const k = (v: V2) => `${r(v[0])},${r(v[1])}`;
	// Passes until none merges (a merge leaves its far ends' entries stale until the next pass).
	let changed = true;
	while (changed) {
		changed = false;
		const ends = new Map<string, number[]>();
		segs.forEach((s, i) => {
			if (!s) return;
			for (const v of [s[0], s[1]]) {
				const key = k(v);
				if (!ends.has(key)) ends.set(key, []);
				ends.get(key)!.push(i);
			}
		});
		for (const [key, ids] of ends) {
			for (let x = 0; x < ids.length; x++)
				for (let y = x + 1; y < ids.length; y++) {
					const a = segs[ids[x]];
					const b = segs[ids[y]];
					// Skip entries a merge this pass has changed (their ends may no longer be here).
					if (!a || !b || (k(a[0]) !== key && k(a[1]) !== key) || (k(b[0]) !== key && k(b[1]) !== key)) continue;
					// Each seen from the shared end: their far ends.
					const fa = k(a[0]) === key ? a[1] : a[0];
					const fb = k(b[0]) === key ? b[1] : b[0];
					const pa = k(a[0]) === key ? a[0] : a[1];
					const da = norm(sub(fa, pa));
					const db = norm(sub(fb, pa));
					if (Math.abs(cross(da, db)) < 1e-6 && dot(da, db) < 0 && (a[2] ?? 0) === (b[2] ?? 0) && a[2] !== 2) {
						segs[ids[x]] = [fa, fb, a[2]];
						segs[ids[y]] = null;
						changed = true;
					}
				}
		}
	}
	return segs.filter((s): s is Seg => s !== null);
}

/** The construction's lines over a window of periods round the period, deduplicated. */
export function lines(o: BuildOpts, rep: V2 = [1, 1]): { period: V2; segs: Seg[] } {
	const t0 = o.diagonal ? diagonal(makeTiling(o.tiling)) : makeTiling(o.tiling);
	// The tiling repeated rep times (a larger period, when one period can't be two-coloured).
	const t: Tiling = {
		period: [t0.period[0] * rep[0], t0.period[1] * rep[1]],
		polys: []
	};
	for (let j = 0; j < rep[1]; j++)
		for (let i = 0; i < rep[0]; i++)
			for (const p of t0.polys) t.polys.push(p.map((v) => add(v, [i * t0.period[0], j * t0.period[1]])));
	const [px, py] = t.period;
	const polys: V2[][] = [];
	for (let j = -1; j <= 1; j++)
		for (let i = -1; i <= 1; i++) for (const p of t.polys) polys.push(p.map((v) => add(v, [i * px, j * py])));
	let segs: Seg[] = [];
	if (o.construct === 'edges' || o.construct.startsWith('edges_'))
		segs.push(...edgesOf(polys, o.construct === 'edges_stars' && o.edgeGap ? Math.abs(o.offset) : 0));
	if (o.construct === 'links') segs.push(...links(polys, Math.max(1, Math.round(o.linkN ?? 2)), o.linkW ?? 0.25));
	if (o.construct === 'stars' || o.construct === 'edges_stars')
		segs.push(...stars(polys, o.angle, o.offset, o.through, o.starInset ?? 1, o.construct === 'edges_stars'));
	if (o.construct === 'rings' || o.construct === 'edges_rings' || o.construct === 'rings_spokes')
		segs.push(...rings(polys, o.ringScale, o.ringRound, o.construct === 'rings_spokes'));
	// Dedupe (shared edges, rays meeting from both sides).
	const key = (s: Seg) => {
		const r = (v: number) => Math.round(v * 1e5);
		const k1 = `${r(s[0][0])},${r(s[0][1])}`;
		const k2 = `${r(s[1][0])},${r(s[1][1])}`;
		return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
	};
	const seen = new Set<string>();
	segs = segs.filter((s) => {
		if (len(sub(s[1], s[0])) < 1e-7) return false;
		const k = key(s);
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
	// Join segments that run straight on through a shared end (rays from neighbouring tiles crossing an edge's midpoint
	// make one line), so their meeting points become crossings.
	segs = mergeCollinear(segs);
	// Keep those near the period (within half a period of it).
	// Keep segments whose bounding box reaches the window round the period (merged lines can be long).
	const near = (s: Seg) =>
		Math.max(s[0][0], s[1][0]) > -0.5 * px &&
		Math.min(s[0][0], s[1][0]) < 1.5 * px &&
		Math.max(s[0][1], s[1][1]) > -0.5 * py &&
		Math.min(s[0][1], s[1][1]) < 1.5 * py;
	return { period: t.period, segs: segs.filter(near) };
}

/**
 * Builds the network: lines split at their crossings, over / under, and the fields. `res`: raster texels per unit. When
 * one period's fields can't be two-coloured consistently (the weave would break somewhere), it tries the period
 * doubled across, down, then both; `rep` says which it used.
 */
export function buildNet(o: BuildOpts, res = 160): Net {
	let best: Net | null = null;
	for (const rep of [
		[1, 1],
		[2, 1],
		[1, 2],
		[2, 2]
	] as V2[]) {
		const net = buildOnce(o, res / Math.max(rep[0], rep[1]), rep);
		if (!best || net.conflicts < best.conflicts) best = net;
		// A larger period only helps when every vertex joins an even number of lines.
		if (net.conflicts === 0 || net.odd || !net.pieces.some((p) => p.endA || p.endB)) break;
	}
	return best!;
}

function buildOnce(o: BuildOpts, res: number, rep: V2): Net {
	const { period, segs } = lines(o, rep);
	const [px, py] = period;
	// Merge collinear touching segments into lines (ids), so a strand that runs straight on is one line.
	const lineOf = segs.map((_, i) => i);
	// Crossings: interior intersections (both parameters inside), splitting both.
	const cuts: { t: number; x: V2; other: number; cross: boolean }[][] = segs.map(() => []);
	// Ends lying on another line's side (T junctions): 3, or 4 when that line is a tile edge.
	const tee: [number, number][] = segs.map(() => [0, 0]);
	const teeOf = (j: number) => (segs[j][2] === 1 ? 4 : 3);
	for (let i = 0; i < segs.length; i++)
		for (let j = i + 1; j < segs.length; j++) {
			const [a, b] = segs[i];
			const [c, d] = segs[j];
			const r = sub(b, a);
			const s = sub(d, c);
			const den = cross(r, s);
			if (Math.abs(den) < 1e-12) continue;
			const t = cross(sub(c, a), s) / den;
			const u = cross(sub(c, a), r) / den;
			const e = 1e-7;
			if (t < -e || t > 1 + e || u < -e || u > 1 + e) continue;
			const tIn = t > 1e-6 && t < 1 - 1e-6;
			const uIn = u > 1e-6 && u < 1 - 1e-6;
			if (!tIn && !uIn) continue; // meeting at ends: a join
			if (tIn && !uIn) tee[j][u < 0.5 ? 0 : 1] = teeOf(i);
			if (uIn && !tIn) tee[i][t < 0.5 ? 0 : 1] = teeOf(j);
			const x = add(a, mul(r, t));
			// A crossing when both pass through; a T when one ends on the other.
			const both = tIn && uIn;
			if (tIn) cuts[i].push({ t, x, other: j, cross: both });
			if (uIn) cuts[j].push({ t: u, x, other: i, cross: both });
		}
	interface Raw {
		a: V2;
		b: V2;
		line: number;
		cls: number;
		xa: V2 | null;
		xb: V2 | null;
		/** T flags of the line's own ends, on its first / last piece. */
		ta: number;
		tb: number;
	}
	const raw: Raw[] = [];
	segs.forEach((s, i) => {
		const cs = cuts[i].sort((p, q) => p.t - q.t);
		let prev: V2 = s[0];
		let prevX: V2 | null = null;
		let ta = tee[i][0];
		for (const c of cs) {
			raw.push({ a: prev, b: c.x, line: lineOf[i], cls: s[2] ?? 0, xa: prevX, xb: c.cross ? c.x : null, ta, tb: 0 });
			prev = c.x;
			prevX = c.cross ? c.x : null;
			ta = 0;
		}
		raw.push({ a: prev, b: s[1], line: lineOf[i], cls: s[2] ?? 0, xa: prevX, xb: null, ta, tb: tee[i][1] });
	});

	// Fields: draw the lines into a raster of the period (wrapping), flood-fill the gaps.
	const rw = Math.max(16, Math.round(px * res));
	const rh = Math.max(16, Math.round(py * res));
	const wall = new Uint8Array(rw * rh);
	const tx = (x: number) => (x / px) * rw;
	const ty = (y: number) => (y / py) * rh;
	const wrap = (i: number, n: number) => ((i % n) + n) % n;
	for (const s of raw) {
		const ax = tx(s.a[0]);
		const ay = ty(s.a[1]);
		const bx = tx(s.b[0]);
		const by = ty(s.b[1]);
		const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1;
		for (let k = 0; k <= steps; k++) {
			const x = ax + ((bx - ax) * k) / steps;
			const y = ay + ((by - ay) * k) / steps;
			// A wall 2 texels thick, so diagonal lines don't leak.
			for (const [dx, dy] of [
				[0, 0],
				[1, 0],
				[0, 1],
				[1, 1]
			])
				wall[wrap(Math.floor(y - 0.5) + dy, rh) * rw + wrap(Math.floor(x - 0.5) + dx, rw)] = 1;
		}
	}
	const label = new Uint16Array(rw * rh);
	const regions: Net['regions'] = [{ kind: 0, colour: 0, inr: 0, area: 0, ang: 0 }];
	const queue = new Int32Array(rw * rh);
	// Each texel's position unwrapped along the fill (a field can span the whole period, so it can't be unwrapped about
	// one texel).
	const ux = new Int32Array(rw * rh);
	const uy = new Int32Array(rw * rh);
	for (let i0 = 0; i0 < rw * rh; i0++) {
		if (wall[i0] || label[i0]) continue;
		const id = regions.length;
		let qh = 0;
		let qt = 0;
		queue[qt++] = i0;
		label[i0] = id;
		ux[i0] = i0 % rw;
		uy[i0] = (i0 / rw) | 0;
		while (qh < qt) {
			const i = queue[qh++];
			const x = i % rw;
			const y = (i / rw) | 0;
			for (const [dx, dy] of [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1]
			]) {
				const j = wrap(y + dy, rh) * rw + wrap(x + dx, rw);
				if (!wall[j] && !label[j]) {
					label[j] = id;
					ux[j] = ux[i] + dx;
					uy[j] = uy[i] + dy;
					queue[qt++] = j;
				}
			}
		}
		// Second moments for the region's orientation (rhombille's faces differ only in it).
		let sx = 0,
			sy = 0,
			sxx = 0,
			syy = 0,
			sxy = 0;
		const x0 = i0 % rw;
		const y0 = (i0 / rw) | 0;
		for (let q = 0; q < qt; q++) {
			const i = queue[q];
			const x = ux[i] - x0;
			const y = uy[i] - y0;
			const X = (x * px) / rw;
			const Y = (y * py) / rh;
			sx += X;
			sy += Y;
			sxx += X * X;
			syy += Y * Y;
			sxy += X * Y;
		}
		const mx = sx / qt;
		const my = sy / qt;
		const cxx = sxx / qt - mx * mx;
		const cyy = syy / qt - my * my;
		const cxy = sxy / qt - mx * my;
		const aniso = Math.hypot(cxx - cyy, 2 * cxy) / Math.max(cxx + cyy, 1e-12);
		const ang = aniso < 0.1 ? 0 : (((Math.atan2(2 * cxy, cxx - cyy) / 2) * 180) / Math.PI + 180) % 180;
		regions.push({ kind: 0, colour: -1, inr: 0, area: (qt / (rw * rh)) * px * py, ang });
		if (regions.length > 65000) break;
	}
	// Inradius per region: a chamfer distance transform from the walls.
	const dist = new Float32Array(rw * rh).fill(1e9);
	for (let i = 0; i < rw * rh; i++) if (wall[i]) dist[i] = 0;
	for (let pass = 0; pass < 2; pass++)
		for (let k = 0; k < rw * rh; k++) {
			const i = pass === 0 ? k : rw * rh - 1 - k;
			const x = i % rw;
			const y = (i / rw) | 0;
			const s = pass === 0 ? -1 : 1;
			const a = dist[y * rw + wrap(x + s, rw)] + 1;
			const b = dist[wrap(y + s, rh) * rw + x] + 1;
			const c = dist[wrap(y + s, rh) * rw + wrap(x + s, rw)] + Math.SQRT2;
			const d = dist[wrap(y + s, rh) * rw + wrap(x - s, rw)] + Math.SQRT2;
			dist[i] = Math.min(dist[i], a, b, c, d);
		}
	for (let i = 0; i < rw * rh; i++) {
		const r = regions[label[i]];
		if (label[i] && dist[i] > r.inr) r.inr = dist[i];
	}
	for (const r of regions) r.inr = (r.inr + 1) * (px / rw);
	// Kinds: regions grouped by area (within 4 %, the largest first), then by orientation (within 10°).
	const same = (a: { area: number; ang: number }, b: { area: number; ang: number }) =>
		Math.abs(a.area - b.area) / Math.max(a.area, b.area) < 0.04 &&
		Math.min(Math.abs(a.ang - b.ang), 180 - Math.abs(a.ang - b.ang)) < 10;
	// Slivers of a few texels (where many lines converge) aren't fields: they take kind 0 and no kind of their own.
	const tiny = (r: { area: number }) => r.area < 2e-3 * px * py;
	const groups: { area: number; ang: number }[] = [];
	for (const r of [...regions.slice(1)].sort((a, b) => b.area - a.area))
		if (!tiny(r) && !groups.some((g) => same(g, r))) groups.push(r);
	for (const r of regions.slice(1))
		r.kind = tiny(r)
			? 0
			: Math.min(
					7,
					groups.findIndex((g) => same(g, r))
				);
	// Fill the walls with the nearest region, so every texel has one (lookups near a line stay inside a field).
	{
		let qh = 0;
		let qt = 0;
		for (let i = 0; i < rw * rh; i++) if (label[i]) queue[qt++] = i;
		while (qh < qt) {
			const i = queue[qh++];
			const x = i % rw;
			const y = (i / rw) | 0;
			for (const [nx, ny] of [
				[wrap(x + 1, rw), y],
				[wrap(x - 1, rw), y],
				[x, wrap(y + 1, rh)],
				[x, wrap(y - 1, rh)]
			]) {
				const j = ny * rw + nx;
				if (!label[j]) {
					label[j] = label[i];
					queue[qt++] = j;
				}
			}
		}
	}
	const at = (v: V2) => label[wrap(Math.floor(ty(v[1])), rh) * rw + wrap(Math.floor(tx(v[0])), rw)];
	// Two-colour the fields: neighbours across a line take opposite colours.
	const adj = new Map<number, Set<number>>();
	const link = (p: number, q: number) => {
		if (!p || !q || p === q) return;
		if (!adj.has(p)) adj.set(p, new Set());
		if (!adj.has(q)) adj.set(q, new Set());
		adj.get(p)!.add(q);
		adj.get(q)!.add(p);
	};
	const eps = 3 * (px / rw);
	for (const s of raw) {
		const d = sub(s.b, s.a);
		if (len(d) < 4 * eps) continue;
		const m = mul(add(s.a, s.b), 0.5);
		const nrm: V2 = mul(norm([-d[1], d[0]]), eps);
		link(at(add(m, nrm)), at(sub(m, nrm)));
	}
	let conflicts = 0;
	for (let r = 1; r < regions.length; r++) {
		if (regions[r].colour >= 0) continue;
		regions[r].colour = 0;
		const st = [r];
		while (st.length) {
			const q = st.pop()!;
			for (const w of adj.get(q) ?? []) {
				if (regions[w].colour < 0) {
					regions[w].colour = 1 - regions[q].colour;
					st.push(w);
				} else if (regions[w].colour === regions[q].colour) conflicts++;
			}
		}
	}
	// Over / under at each crossing: rotating the over strand counterclockwise sweeps the colour-1 fields.
	// The weave's two-colouring, exactly (no raster: crossings can sit closer than a texel): a point's colour is the
	// parity of the lines crossed on the way from it to a fixed point R. Neighbouring fields differ by the one line
	// between them, so it is a proper colouring wherever every vertex joins an even number of lines.
	const crossesSeg = (a: V2, b: V2, sg: Seg): boolean => {
		const r = sub(b, a);
		const q = sub(sg[1], sg[0]);
		const den = cross(r, q);
		if (Math.abs(den) < 1e-14) return false;
		const t = cross(sub(sg[0], a), q) / den;
		const u = cross(sub(sg[0], a), r) / den;
		return t > 0 && t < 1 && u >= 0 && u < 1;
	};
	const Rp: V2 = [0.37131 * px, 0.61773 * py];
	const colourAt = (v: V2): number => {
		let c = 0;
		for (const sg of segs) if (crossesSeg(v, Rp, sg)) c ^= 1;
		return c;
	};
	// Over / under: rotating the over strand counterclockwise sweeps the colour-1 fields.
	const overAt = (x: V2, d1: V2, d2: V2): boolean => {
		const e1 = norm(d1);
		let e2 = norm(d2);
		if (cross(e1, e2) < 0) e2 = mul(e2, -1);
		return colourAt(add(x, mul(norm(add(e1, e2)), 1e-5 * Math.max(px, py)))) === 1;
	};
	// The colouring repeats with the period only if a loop round it crosses an even number of lines each way;
	// otherwise the period is doubled (buildNet).
	const loopOdd = (a: V2, b: V2) => segs.filter((sg) => crossesSeg(a, b, sg)).length % 2 === 1;
	if (loopOdd([0, 0.43711 * py], [px, 0.43711 * py]) || loopOdd([0.53791 * px, 0], [0.53791 * px, py])) conflicts++;
	const dirOf = (s: Raw): V2 => sub(s.b, s.a);
	const pieces: Piece[] = [];
	for (const s of raw) {
		const m = mul(add(s.a, s.b), 0.5);
		if (m[0] < 0 || m[0] >= px || m[1] < 0 || m[1] >= py) continue;
		const flag = (x: V2 | null): number => {
			if (!x) return 0;
			// Where more than two lines pass through a point (star tips crossing a frame's corner) no strand weaves: they
			// join. Lines that only end there (one piece touching it) don't count: two straight lines still weave.
			const touching = new Map<number, number>();
			for (const o of raw)
				if (len(sub(o.a, x)) < 1e-6 || len(sub(o.b, x)) < 1e-6) touching.set(o.line, (touching.get(o.line) ?? 0) + 1);
			if ([...touching.values()].filter((c) => c >= 2).length > 2) return 0;
			// The other line through x.
			const other = raw.find(
				(o) =>
					o.line !== s.line &&
					(o.xa === x || o.xb === x || len(sub(o.a, x)) < 1e-6 || len(sub(o.b, x)) < 1e-6) &&
					Math.abs(cross(norm(dirOf(o)), norm(dirOf(s)))) > 1e-3
			);
			if (!other) return 0;
			// Two tile edges crossing are a frame's joint (coffers, lattices): they meet, they don't weave.
			if (s.cls === 1 && other.cls === 1) return 0;
			return overAt(x, dirOf(s), dirOf(other)) ? 1 : 2;
		};
		pieces.push({ a: s.a, b: s.b, line: s.line, cls: s.cls, endA: s.ta || flag(s.xa), endB: s.tb || flag(s.xb) });
	}
	// Vertices where an odd number of lines meet (T-junctions, three-way joins): no two-colouring exists then.
	const deg = new Map<string, number>();
	const vk = (v: V2) => `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)}`;
	for (const s of raw) for (const v of [s.a, s.b]) deg.set(vk(v), (deg.get(vk(v)) ?? 0) + 1);
	const odd = [...deg.values()].some((d) => d % 2 === 1 && d > 1);
	return { period, rep, pieces, rw, rh, label, regions, conflicts, odd };
}
