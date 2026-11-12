// Path and Polyline (FR7.5): polygons and open lines from vertex lists (the shape editor draws them). The shader reads
// the vertices from u_points; what doesn't depend on the pixel — each corner's round, the bounds, the lines' lengths —
// the CPU works out once into a data texture of floats (t_poly, t_line).

import { MAX_PATH_POINTS, parsePolygons, parsePolylines, takePolygons } from '@/core/bitmap';
import { memoReads } from '@/core/memo';
import { P, type ParamValues } from '@/core/params';
import { GLSL_PRIMTEX, floatTexture } from '../primTexture';
import { TAPER_GLSL, taperParams } from './shapes';
import type { CpuTexture, LayerCanvas, LayerDef } from '../types';

type V2 = [number, number];

/** A shape layer drawn from vertex coordinates in a 64 px square, scaled to the texture. */
const scaledPoints = (src: string, texture: { width: number; height: number }) =>
	src.replace(
		/(-?\d*\.?\d+),(-?\d*\.?\d+)/g,
		(_, x, y) => `${Math.round((Number(x) * texture.width) / 64)},${Math.round((Number(y) * texture.height) / 64)}`
	);

/**
 * A corner's round (fillet) of radius R between the edges v → a and v → b: [t, centre x, centre y, r] — t how far back
 * along each edge the round starts, r its radius (0: sharp). Rounds take at most half of either edge.
 */
export function fillet(a: V2, v: V2, b: V2, R: number): [number, number, number, number] {
	const l1 = Math.hypot(a[0] - v[0], a[1] - v[1]);
	const l2 = Math.hypot(b[0] - v[0], b[1] - v[1]);
	if (R <= 0 || l1 < 1e-4 || l2 < 1e-4) return [0, v[0], v[1], 0];
	const e1 = [(a[0] - v[0]) / l1, (a[1] - v[1]) / l1];
	const e2 = [(b[0] - v[0]) / l2, (b[1] - v[1]) / l2];
	const c = Math.min(1, Math.max(-1, e1[0] * e2[0] + e1[1] * e2[1]));
	const bis = [e1[0] + e2[0], e1[1] + e2[1]];
	const bl = Math.hypot(bis[0], bis[1]);
	if (c < -0.99999 || bl < 1e-5) return [0, v[0], v[1], 0];
	const tn = Math.sqrt((1 - c) / (1 + c));
	const t = Math.min(R / Math.max(tn, 1e-4), 0.5 * Math.min(l1, l2));
	const r = t * tn;
	const s = Math.sqrt(t * t + r * r) / bl;
	return [t, v[0] + bis[0] * s, v[1] + bis[1] * s, r];
}

/**
 * The vertex lists as the shader has them (u_points: those that fit, float32), scaled by `k` — the texture's size for
 * Units = fraction — as the shader scales them.
 */
function shaderPoints(lists: number[][][], k: V2): V2[][] {
	return takePolygons(lists).map((l) =>
		l.map(([x, y]) => [Math.fround(Math.fround(x) * k[0]), Math.fround(Math.fround(y) * k[1])] as V2)
	);
}

const unitsScale = (q: ParamValues, ctx: { width: number; height: number }): V2 =>
	q.units === 'fraction' ? [ctx.width, ctx.height] : [1, 1];

// Shared by Path and Polyline: floats from a data texture (floatTexture: texF32), and the sector test of a corner's round.
const PATHS_GLSL = /* glsl */ `
${GLSL_PRIMTEX}
float shp_cross(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
// p in the sector of the round (between its centre's rays to the two tangent points t1, t2)?
bool shp_sector(vec2 p, vec2 c, vec2 t1, vec2 t2) {
  float cr = shp_cross(t1 - c, t2 - c);
  return shp_cross(t1 - c, p - c) * cr >= 0.0 && shp_cross(p - c, t2 - c) * cr >= 0.0;
}
`;

// ------------------------------------------------------------------------------------------------ Path

/**
 * Path's data texture (t_poly), 4 floats across: a row per vertex (in u_points' order) holding its round (t, centre,
 * r) — rounded or not by Rounded corners, which looks at whether the corner points out of the filled area: out of its polygon,
 * or into it for a hole (Even–odd: a polygon inside an odd number of others; First minus the rest: all but the
 * first) — and a last row with the bounds (lo, hi).
 */
export function pathData(polys: V2[][], fill: unknown, radius: number, roundAt: unknown): CpuTexture {
	const n = polys.reduce((s, p) => s + p.length, 0);
	const f = new Float32Array((n + 1) * 4);
	const inside = (p: V2, poly: V2[]) => {
		let c = false;
		poly.forEach(([ax, ay], i) => {
			const [bx, by] = poly[(i + 1) % poly.length];
			if (ay > p[1] !== by > p[1] && p[0] < ax + ((p[1] - ay) * (bx - ax)) / (by - ay)) c = !c;
		});
		return c;
	};
	const lo: V2 = [Infinity, Infinity];
	const hi: V2 = [-Infinity, -Infinity];
	let at = 0;
	polys.forEach((poly, i) => {
		// A point just inside the polygon: its first vertex, nudged toward the vertices' centroid.
		const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
		const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
		const pt: V2 = [poly[0][0] + (cx - poly[0][0]) * 1e-3, poly[0][1] + (cy - poly[0][1]) * 1e-3];
		const depth = polys.reduce((d, o, j) => d + (j !== i && inside(pt, o) ? 1 : 0), 0);
		const hole = fill === 'subtract' ? i > 0 : fill === 'union' ? false : depth % 2 === 1;
		// Outer / inner corners by the turn against the polygon's orientation (its signed area), flipped for a hole.
		const area = poly.reduce((s, [ax, ay], j) => {
			const [bx, by] = poly[(j + 1) % poly.length];
			return s + ax * by - ay * bx;
		}, 0);
		const sgn = Math.sign(area) * (hole ? -1 : 1);
		poly.forEach((v, j) => {
			const a = poly[(j + poly.length - 1) % poly.length];
			const b = poly[(j + 1) % poly.length];
			const convex = ((v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0])) * sgn > 0;
			const r =
				roundAt === 'convex' || roundAt === 'concave' ? ((roundAt === 'convex') === convex ? radius : 0) : radius;
			f.set(fillet(a, v, b, r), (at + j) * 4);
			lo[0] = Math.min(lo[0], v[0]);
			lo[1] = Math.min(lo[1], v[1]);
			hi[0] = Math.max(hi[0], v[0]);
			hi[1] = Math.max(hi[1], v[1]);
		});
		at += poly.length;
	});
	if (n) f.set([lo[0], lo[1], hi[0], hi[1]], n * 4);
	return floatTexture(f, 4);
}

const PATH_GLSL = /* glsl */ `
// At most a third of the vertices: every polygon has three or more.
#define PTH_MAXP ${Math.floor(MAX_PATH_POINTS / 3)}
// Per polygon, for Union / Subtract: the distance to it.
float pth_d[PTH_MAXP];
// Bevel aspect (GLSL_BEVEL): the same distances in the space the aspect stretches (squared, px of Bevel; pth_dS per
// polygon), pth_M mapping the polygons' space there, pth_bs the signed result.
bool pth_asp;
mat2 pth_M;
float pth_dS[PTH_MAXP];
float pth_bs;

// Vertex v's round (t, centre, r): t_poly's row v.
vec4 pth_fillet(int v) {
  return vec4(texF32(t_poly, ivec2(0, v)), texF32(t_poly, ivec2(1, v)), texF32(t_poly, ivec2(2, v)), texF32(t_poly, ivec2(3, v)));
}

// Signed distance to the polygons and the filled region's polygon: the last polygon that contains the point (outside:
// of the region across the nearest edge), so a frame with a hole is one feature.
vec2 pathSdf(vec2 q, vec2 k) {
  int n = u_points_size.x;
  int np = min(u_points_size.y, PTH_MAXP);
  // The inside tests run at a point nudged off the pixel centre, so a centre exactly on an edge (integer slopes through
  // integer vertices) is on the same side for the crossing count and for a round's corner.
  vec2 qs = q + vec2(0.00131, 0.00207);
  for (int i = 0; i < PTH_MAXP; i++) { pth_d[i] = 1e20; pth_dS[i] = 1e20; }
  float d = 1e20;
  float dS = 1e20;
  float pid = 0.0;
  int inPoly = 0; // bit i: inside polygon i (even–odd)
  for (int i = 0; i < ${MAX_PATH_POINTS} * UNI_1; i++) {
    if (i >= n) break;
    // The edge v → w, v the vertex after i: with v's round and w's.
    int vi = int(u_points[i].z);
    vec4 v4 = u_points[vi];
    int wi = int(v4.z);
    vec2 v = v4.xy * k;
    vec2 w = u_points[wi].xy * k;
    int pi = int(v4.w);
    int bit = 1 << pi;
    vec2 e = w - v;
    vec2 qv = qs - v;
    bvec3 c = bvec3(qs.y >= v.y, qs.y < w.y, e.x * qv.y > e.y * qv.x);
    if (all(c) || all(not(c))) inPoly ^= bit;
    qv = q - v;
    float dd;
    float ddS = 1e20;
    if (u_radius > 0.0) {
      vec2 a = u_points[i].xy * k;
      vec4 fv = pth_fillet(vi);
      float tw = texF32(t_poly, ivec2(0, wi));
      float L = max(length(e), 1e-6);
      vec2 t = e / L;
      vec2 h = qv - t * clamp(dot(qv, t), fv.x, max(L - tw, fv.x));
      dd = dot(h, h);
      if (pth_asp) ddS = bevelSeg2(vec2(0.0), pth_M * (t * fv.x - qv), pth_M * (t * max(L - tw, fv.x) - qv));
      if (fv.w > 0.0) {
        vec2 t1 = v + normalize(a - v) * fv.x;
        vec2 t2 = v + t * fv.x;
        float ml = length(q - fv.yz);
        if (shp_sector(q, fv.yz, t1, t2)) dd = min(dd, (ml - fv.w) * (ml - fv.w));
        // The round, stretched: an elliptic arc (chords), from the pixel (whose sector test doesn't carry over).
        if (pth_asp) ddS = min(ddS, bevelArc2(vec2(0.0), pth_M, fv.yz - q, fv.w, normalize(t1 - fv.yz), normalize(t2 - fv.yz), normalize(v - fv.yz)));
        // Between the round and the corner the inside flips: an outer corner cut off, an inner one filled.
        float s1 = shp_cross(v - t1, qs - t1);
        float s2 = shp_cross(t2 - v, qs - v);
        float s3 = shp_cross(t1 - t2, qs - t2);
        bool tri = (s1 >= 0.0 && s2 >= 0.0 && s3 >= 0.0) || (s1 <= 0.0 && s2 <= 0.0 && s3 <= 0.0);
        if (length(qs - fv.yz) > fv.w && tri) inPoly ^= bit;
      }
    } else {
      vec2 h = qv - e * clamp(dot(qv, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
      dd = dot(h, h);
      if (pth_asp) ddS = bevelSeg2(vec2(0.0), pth_M * -qv, pth_M * (e - qv));
    }
    if (dd < d) { d = dd; pid = v4.w; }
    dS = min(dS, ddS);
    if (u_fill != 0) { pth_d[pi] = min(pth_d[pi], dd); pth_dS[pi] = min(pth_dS[pi], ddS); }
  }
  // Inside by the fill rule; the distance from all edges (even–odd) or from the polygons combined.
  int parity = 0;
  for (int i = 0; i < PTH_MAXP; i++) parity ^= (inPoly >> i) & 1;
  bool inside = u_fill == 1 ? inPoly != 0 : u_fill == 2 ? inPoly == 1 : parity == 1;
  float sd = inside ? -sqrt(d) : sqrt(d);
  pth_bs = inside ? -sqrt(dS) : sqrt(dS);
  if (u_fill != 0) {
    // Union / First minus the rest, combined with round joins (hg_sdf's round union and intersection): where outlines
    // cross, the corner rounds with the Corner radius too — inner corners of a union, outer ones of a cut. At radius 0
    // the union's inside is √(a² + b²) of the overlapping depths, so an edge hidden in another polygon leaves no groove.
    float ru = u_round_at != 1 ? u_radius : 0.0;
    float rs = u_round_at != 2 ? u_radius : 0.0;
    // (Bevel aspect: the stretched distances combined alike, x = px, y = stretched; the stretch keeps areas, so the
    // joins' radius stays.)
    vec2 acc = vec2(1e20);
    for (int i = 0; i < PTH_MAXP * UNI_1; i++) {
      if (i < np && (u_fill == 1 || i > 0)) {
        vec2 di = (((inPoly >> i) & 1) == 1 ? -1.0 : 1.0) * sqrt(vec2(pth_d[i], pth_dS[i]));
        acc = acc.x > 1e19 ? di : max(vec2(ru), min(acc, di)) - vec2(length(max(vec2(ru - acc.x, ru - di.x), 0.0)), length(max(vec2(ru - acc.y, ru - di.y), 0.0)));
      }
    }
    if (u_fill == 1) { sd = acc.x; pth_bs = acc.y; }
    else {
      vec2 d0 = ((inPoly & 1) == 1 ? -1.0 : 1.0) * sqrt(vec2(pth_d[0], pth_dS[0]));
      vec2 c = min(vec2(-rs), max(d0, -acc)) + vec2(length(max(vec2(rs + d0.x, rs - acc.x), 0.0)), length(max(vec2(rs + d0.y, rs - acc.y), 0.0)));
      sd = acc.x > 1e19 ? d0.x : c.x;
      pth_bs = acc.x > 1e19 ? d0.y : c.y;
    }
  }
  int set = inside ? inPoly : inPoly ^ (1 << int(pid));
  return vec2(sd, floor(log2(float(max(set, 1)) + 0.5)));
}

GenOut gen(vec2 p) {
  int n = u_points_size.x;
  if (n < 3) return genOut(0.0, 0.0, 0.0, 1e4);
  // Fractions of the texture's width and height, as the shape editor draws them.
  vec2 k = u_units == 1 ? uRes : vec2(1.0);
  // The bounds (t_poly's last row) and their centre, the pivot of Scale and Rotation.
  vec2 lo = vec2(texF32(t_poly, ivec2(0, n)), texF32(t_poly, ivec2(1, n)));
  vec2 hi = vec2(texF32(t_poly, ivec2(2, n)), texF32(t_poly, ivec2(3, n)));
  vec2 q0 = vec2(p.x, uRes.y - p.y);
  float sc = max(u_scale, 1e-3);
  float zs = 1.0 / sc;
  vec2 piv = 0.5 * (lo + hi);
  float ca = cos(radians(u_rotation));
  float sa = sin(radians(u_rotation));
  // Bevel aspect: polygon-space offsets → screen (turned back, scaled; y down, which the widths don't mind) → stretched.
  pth_asp = bevelAspectOn();
  pth_M = bevelFrame(vec2(ca, sa), vec2(-sa, ca)) * sc;
  float rS = 1e20;
  // Repeats (Step X / Y apart, either way from the polygons as drawn), and round the torus when tiling (repGrid): every
  // copy whose bounds can reach the pixel, nearest first; a copy whose bounds lie farther than the nearest distance
  // found so far is skipped.
  ivec2 rep = ivec2(u_rep_x, u_rep_y);
  vec2 stepR = vec2(u_rep_dx, u_rep_dy);
  float ext = 0.5 * length(hi - lo) * sc + max(u_grow, 0.0) + 2.0;
  RepGrid rg = repGrid(rep, max(abs(stepR), 1e-3), piv + 0.5 * vec2(rep - 1) * stepR, uRes, uTile, q0 - ext, q0 + ext);
  int nc = repCount(rg);
  vec2 r = vec2(1e20, 0.0);
  float reach = 1e20;
  for (int c = 0; c < nc; c++) {
    ivec2 cw;
    vec2 pos;
    repAt(rg, c, cw, pos);
    // Into the polygons' own space (the copy's offset off, Scale / Rotation about the bounds' centre).
    vec2 m = q0 - pos;
    vec2 q = piv + vec2(ca * m.x + sa * m.y, ca * m.y - sa * m.x) * zs;
    vec2 bx = max(max(lo - q, q - hi), 0.0);
    if (length(bx) * sc < reach) {
      vec2 o = pathSdf(q, k);
      o.x *= sc;
      if (o.x < r.x) { r = o; rS = pth_bs; }
      reach = abs(r.x) + max(u_grow, 0.0) + 2.0;
    }
  }
  float sd = sdOnion(r.x - u_grow, u_outline);
  GenOut g = genOut(1.0, 1.0, hashI(ivec2(int(r.y), 7), uSeed), sd);
  // Bevel aspect: the stretched distance to the outline, so the bevels meet in clean mitres. Grown or outlined: the
  // distance × the local stretch (stretched over plain distance to the polygons' outline) — exact along straight edges,
  // continuous through the mitres.
  vec2 gr = vec2(dFdx(r.x), dFdy(r.x));
  if (pth_asp) {
    float kS = abs(r.x) > 0.05 ? rS / r.x : u_bevel / bevelWidth(gr);
    g.bdist = u_grow == 0.0 && u_outline <= 0.0 ? rS : sd * kS;
  }
  return g;
}
`;

const pointsHint =
	'Lists the corners as x,y pairs (px from the top-left, or 0..1 with Units = fraction). Put each polygon on its own line or separate them with "|". Up to 64 vertices';

export const pathLayer: LayerDef = {
	type: 'path',
	label: 'Path',
	category: 'shape',
	kind: 'generator',
	sdf: true,
	description:
		'Path: Polygons of any shape, made from a list of corner points, where overlaps can cut holes or merge. Makes chamfered cut-outs, Z-shaped channels, trims.',
	params: [
		P.bitmap('points', 'Points', '8,16 24,8 56,8 56,48 40,56 8,56', 'points', { hint: pointsHint }),
		P.enum('units', 'Units', 'px', [
			['px', 'Pixels'],
			['fraction', 'Fraction of the texture']
		]),
		P.enum('fill', 'Fill', 'evenodd', [
			[
				'evenodd',
				'Even–odd',
				'overlaps cut holes: a polygon inside another makes a hole, and one inside that is solid again'
			],
			['union', 'Union', 'fills every polygon and merges the overlaps (a plate with a tab)'],
			['subtract', 'First minus the rest', 'fills the first polygon and cuts every later one out of it']
		]),
		P.float('radius', 'Corner radius', 0, 0, 4096, {
			softMax: 64,
			unit: 'px',
			step: 0.1,
			hint: 'Rounds the corners (a rounding uses up at most half of either edge)'
		}),
		P.enum(
			'round_at',
			'Rounded corners',
			'all',
			[
				['all', 'All corners'],
				['convex', 'Outer corners', 'rounds only the corners pointing out of their polygon'],
				['concave', 'Inner corners', 'rounds only the corners pointing into their polygon']
			],
			{ showIf: (p) => Number(p.radius) > 0 }
		),
		P.float('grow', 'Grow', 0, -1024, 1024, {
			softMin: -64,
			softMax: 64,
			unit: 'px',
			step: 0.1,
			hint: 'Pushes the outline out (rounding the outer corners) or, below 0, pulls it in'
		}),
		P.float('outline', 'Outline', 0, 0, 1024, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			hint: 'Draws only a stroke this wide just inside the outline (0 = solid)'
		}),
		P.float('scale', 'Scale', 1, 0.01, 100, {
			softMin: 0.1,
			softMax: 4,
			step: 0.001,
			hint: 'Scales the polygons around the centre of their bounds (bevels and radii stay the same in px)'
		}),
		P.float('rotation', 'Rotation', 0, -360, 360, {
			softMin: -180,
			softMax: 180,
			unit: '°',
			step: 0.1,
			hint: 'Turns the polygons clockwise around the same centre'
		}),
		P.int('rep_x', 'Repeat X', 1, 1, 64, {
			softMax: 16,
			group: 'repeat',
			hint: 'Repeats the polygons side by side this many times (Offset X / Y under Shaping moves them all)'
		}),
		P.int('rep_y', 'Repeat Y', 1, 1, 64, { softMax: 16, group: 'repeat' }),
		P.float('rep_dx', 'Step X', 64, -4096, 4096, {
			softMin: 0,
			softMax: 512,
			unit: 'px',
			axis: 'x',
			step: 0.5,
			group: 'repeat',
			showIf: (p) => Number(p.rep_x) > 1,
			hint: 'Sets how far right each copy sits from the one before'
		}),
		P.float('rep_dy', 'Step Y', 64, -4096, 4096, {
			softMin: 0,
			softMax: 512,
			unit: 'px',
			axis: 'y',
			step: 0.5,
			group: 'repeat',
			showIf: (p) => Number(p.rep_y) > 1,
			hint: 'Sets how far down each copy sits from the one before'
		}),
		P.seed('seed', 'Seed', 1, { hint: 'Reshuffles the random value each filled region gets' })
	],
	groups: [{ id: 'repeat', label: 'Repeat', collapsed: true }],
	textures: ['poly'],
	// (Memoised by the params it reads: a colour or Height slider keeps the uploaded texture.)
	cpuData: memoReads((q: ParamValues, ctx: LayerCanvas) => ({
		poly: pathData(
			shaderPoints(parsePolygons(String(q.points ?? '')), unitsScale(q, ctx)),
			q.fill,
			Number(q.radius ?? 1),
			q.round_at
		)
	})),
	defaults: { bevel: 1, radius: 1, profile: 'round', h_on: true, h_amount: 0.6, dif_on: true },
	fresh: (t) => {
		const s = Math.min(t.width, t.height);
		return {
			points: scaledPoints('8,16 24,8 56,8 56,48 40,56 8,56', t),
			bevel: Math.max(1, Math.round(s / 128)),
			radius: Math.round(s / 64)
		};
	},
	glsl: PATHS_GLSL + PATH_GLSL
};

// ------------------------------------------------------------------------------------------------ Polyline

const PLN_LINES = 32;
/** t_line's width: floats per row. */
const PLN_ROW = 8;

/**
 * Polyline's data texture (t_line), 8 floats across. A row per vertex (in u_points' order), for the segment from it to
 * the next: ta (how far after its start the straight part begins: the previous corner's round), the round at its end
 * (t, centre, r), the round's angle, and how far along the line the segment starts — as drawn (s0, the taper) and along
 * the rounds (f0, the dashes). Rows MAX_PATH_POINTS + line: the line's length as drawn and along its rounds. The last
 * row: the points' bounds (lo, hi). Corner radius is the inner edge's: the centre line bends on it plus half the width.
 */
export function polylineData(lines: V2[][], radius: number, hw: number): CpuTexture {
	const f = new Float32Array(PLN_ROW * (MAX_PATH_POINTS + PLN_LINES + 1));
	const R = radius > 0 ? radius + hw : 0;
	const lo: V2 = [Infinity, Infinity];
	const hi: V2 = [-Infinity, -Infinity];
	let at = 0;
	lines.forEach((pts, l) => {
		const lr = (MAX_PATH_POINTS + Math.min(l, PLN_LINES - 1)) * PLN_ROW;
		let s0 = 0;
		let f0 = 0;
		pts.forEach((a, j) => {
			lo[0] = Math.min(lo[0], a[0]);
			lo[1] = Math.min(lo[1], a[1]);
			hi[0] = Math.max(hi[0], a[0]);
			hi[1] = Math.max(hi[1], a[1]);
			if (j + 1 >= pts.length) return;
			const b = pts[j + 1];
			const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
			const L = Math.max(len, 1e-6);
			const ta = j > 0 ? fillet(pts[j - 1], a, b, R)[0] : 0;
			const fb = j + 2 < pts.length ? fillet(a, b, pts[j + 2], R) : [0, 0, 0, 0];
			let span = 0;
			if (fb[3] > 0) {
				const nb = pts[j + 2];
				const ln = Math.hypot(nb[0] - b[0], nb[1] - b[1]);
				const t1 = [b[0] - ((b[0] - a[0]) / L) * fb[0] - fb[1], b[1] - ((b[1] - a[1]) / L) * fb[0] - fb[2]];
				const t2 = [b[0] + ((nb[0] - b[0]) / ln) * fb[0] - fb[1], b[1] + ((nb[1] - b[1]) / ln) * fb[0] - fb[2]];
				const c = (t1[0] * t2[0] + t1[1] * t2[1]) / (Math.hypot(t1[0], t1[1]) * Math.hypot(t2[0], t2[1]));
				span = Math.acos(Math.min(1, Math.max(-1, c)));
			}
			f.set([ta, ...fb, span, s0, f0], (at + j) * PLN_ROW);
			const bend = span * fb[3] - ta - fb[0];
			s0 += L;
			f0 += L + bend;
			f[lr] += len;
			f[lr + 1] += len + (fb[3] > 0 ? span * fb[3] - 2 * fb[0] : 0);
		});
		at += pts.length;
	});
	if (at) f.set([lo[0], lo[1], hi[0], hi[1]], (MAX_PATH_POINTS + PLN_LINES) * PLN_ROW);
	return floatTexture(f, PLN_ROW);
}

const POLYLINE_GLSL = /* glsl */ `
#define PLN_LINES ${PLN_LINES}
// t_line's rows: the lines' lengths from PLN_LROW, the bounds at PLN_BROW.
#define PLN_LROW ${MAX_PATH_POINTS}
#define PLN_BROW ${MAX_PATH_POINTS + PLN_LINES}
float pln_f(int x, int y) { return texF32(t_line, ivec2(x, y)); }

// Per line, over every copy (torus) evaluated: the distance to it (less half the width) and its nearest dash's index.
float pln_best[PLN_LINES];
float pln_bdash[PLN_LINES];
// Bevel aspect (GLSL_BEVEL): the same distances in the space the aspect stretches (px of Bevel), each piece's term
// across its own edge (bevelLine with the piece's normal) — the flat ends and dash ends exact, as half-planes, so their
// corners meet in clean mitres.
bool pln_asp;
mat2 pln_M;          // screen px → the stretched space (px of Bevel)
float pln_reach;     // the widest bevel
float pln_bestS[PLN_LINES];
// A half circle in nine points from its start (0) to its end (π): cos, sin.
const vec2 PLN_HC[9] = vec2[9](vec2(1.0, 0.0), vec2(0.92388, 0.38268), vec2(0.70711, 0.70711), vec2(0.38268, 0.92388),
  vec2(0.0, 1.0), vec2(-0.38268, 0.92388), vec2(-0.70711, 0.70711), vec2(-0.92388, 0.38268), vec2(-1.0, 0.0));
// The torus copies a tileable project evaluates (the centre first).
const ivec2 PLN_TILE[9] = ivec2[9](ivec2(0, 0), ivec2(-1, -1), ivec2(0, -1), ivec2(1, -1), ivec2(-1, 0), ivec2(1, 0), ivec2(-1, 1), ivec2(0, 1), ivec2(1, 1));
// A distance d and its stretched one dS through Outline: the band's inner edge at the same local stretch.
float pln_onion(float d, float dS) { return u_outline > 0.0 ? sdOnion(d, u_outline) * (abs(d) > 0.05 ? dS / d : 1.0) : dS; }
// The two deepest (depths a.x ≥ a.y) of the distances d fed in; their union's distance: √(a² + b²) inside.
void pln_deep(inout vec2 a, float d) { if (-d > a.x) a = vec2(-d, a.x); else if (-d > a.y) a.y = -d; }
float pln_union(float dmin, vec2 a) { return dmin < 0.0 ? -sqrt(a.x * a.x + a.y * a.y) : dmin; }

// Distance to each open polyline (segments whose "next" wraps back close a line: skipped), minus half the width, into
// pln_best / pln_bdash / pln_bestS where nearer.
void lineSdf(vec2 q, vec2 k, float hw) {
  int n = u_points_size.x;
  for (int i = 0; i < ${MAX_PATH_POINTS} * UNI_1; i++) {
    if (i >= n) break;
    vec4 a4 = u_points[i];
    int j = int(a4.z);
    int li = min(int(a4.w), PLN_LINES - 1);
    // Segments whose "next" wraps back (a line's closing one) are skipped — by a flag, not continue (ANGLE / D3D11).
    if (j > i) {
      bool first = i == 0 || u_points[i - 1].w != a4.w;
      bool last = int(u_points[j].z) <= j;
      vec2 a = a4.xy * k;
      vec2 b = u_points[j].xy * k;
      vec2 e = b - a;
      float L = max(length(e), 1e-6);
      vec2 t = e / L;
      vec2 w = q - a;
      float u = dot(w, t);
      float v = dot(w, vec2(-t.y, t.x));
      // Rounds at the inner vertices: this segment starts ta after a and ends fb.x before b, then bends round b.
      float ta = pln_f(0, i);
      vec4 fb = vec4(pln_f(1, i), pln_f(2, i), pln_f(3, i), pln_f(4, i));
      float s0 = pln_f(6, i); // along the line as drawn, at the segment's start (the taper)
      float f0 = pln_f(7, i); // along the line with its rounds (the dashes)
      float uc = clamp(u, ta, max(L - fb.x, ta));
      float ex = abs(u - uc); // past the straight part's end
      float pv = abs(v);      // across the line
      // (Bevel aspect: the piece's directions across (nA, with the signed offset vs) and along (nL, ex's sign sx).)
      vec2 nA = vec2(-t.y, t.x), nL = t;
      float vs = v, sx = u < uc ? -1.0 : 1.0;
      float exC = ex;
      bool inSec = false;
      float adv = 0.0;
      vec2 mr = vec2(0.0);
      float sl = s0 + uc;
      float fl = f0 + uc - ta;
      if (fb.w > 0.0) {
        vec2 t1 = b - t * fb.x;
        vec2 t2 = b + normalize(u_points[j + 1].xy * k - b) * fb.x;
        vec2 m = q - fb.yz;
        float span = pln_f(5, i);
        float ad = abs(length(m) - fb.w);
        inSec = shp_sector(q, fb.yz, t1, t2);
        adv = ad;
        mr = m;
        if (inSec && ad < length(vec2(ex, pv))) {
          float ang = acos(clamp(dot(normalize(t1 - fb.yz), normalize(m)), -1.0, 1.0));
          ex = 0.0;
          pv = ad;
          nA = m;
          nL = vec2(m.y, -m.x);
          vs = length(m) - fb.w;
          sl = s0 + L - fb.x + 2.0 * fb.x * ang / max(span, 1e-5);
          fl = f0 + L - fb.x - ta + ang * fb.w;
        }
      }
      float lineLen = pln_f(0, PLN_LROW + li);
      float hwk = u_taper > 0.0 ? hw * taperAt(sl / max(lineLen, 1e-6), lineLen, u_taper).x : hw;
      float dd;
      float ddS = 1e20;
      float dash = 0.0;
      if (u_dash > 0.0) {
        // Along the line to the nearest dash (0 on one), its index. Fitted: dash and gap scaled so the line holds a
        // whole number of dashes, one at either end.
        float dl = u_dash;
        float gl = max(u_gap, 0.0);
        if (u_dash_fit) {
          float lf = pln_f(1, PLN_LROW + li);
          float cnt = max(1.0, floor((lf + gl) / (dl + gl) + 0.5));
          float f = lf / max(cnt * dl + (cnt - 1.0) * gl, 1e-3);
          dl *= f;
          gl *= f;
        }
        float per = dl + gl;
        float z = fl - u_dash_ofs;
        float ph = z - per * floor(z / per);
        bool on = ph < dl;
        float gapD = on ? 0.0 : min(ph - dl, per - ph);
        dash = floor(z / per) + (!on && ph - dl > per - ph ? 1.0 : 0.0);
        float al = (on ? -min(ph, dl - ph) : gapD) + ex;
        dd = u_caps == 1 ? max(pv - hwk, al) : length(vec2(ex + gapD, pv)) - hwk;
        if (pln_asp) {
          // Along: past the straight part, else towards the nearer dash (behind it, or ahead).
          float sa = ex > 0.0 ? sx : ph - dl < per - ph ? 1.0 : -1.0;
          ddS = u_caps == 1 ? max(bevelLine(pv - hwk, nA), bevelLine(al, nL)) : bevelLine(dd, sa * (ex + gapD) * nL + vs * nA);
        }
      } else {
        dd = length(vec2(ex, pv)) - hwk;
        if (pln_asp) {
          // The straight part's capsule: inside, the deepest of its sides (half-planes) and its round ends — each end's
          // half circle, an elliptic arc stretched (chords), only near enough to matter (no nearer than a side further
          // off); outside, across by its direction. The bend's band (Corner radius), a curve: across by its radial
          // direction. Their union.
          vec2 n0 = vec2(-t.y, t.x);
          float dc = length(vec2(exC, v)) - hwk;
          float cS = bevelLine(dc, (u - uc) * t + v * n0);
          if (dc < 0.0) {
            cS = bevelLine(abs(v) - hwk, n0);
            float uB = max(L - fb.x, ta);
            float m2 = 1e20;
            for (int j = 0; j < 16 * UNI_1; j++) {
              int en = j / 8, kk = j - en * 8;
              float ue = en == 0 ? ta : uB;
              if (abs(u - ue) < hwk + pln_reach) {
                vec2 md = en == 0 ? -t : t;
                vec2 c0 = a + t * ue - q;
                vec2 h0 = PLN_HC[kk], h1 = PLN_HC[kk + 1];
                m2 = min(m2, bevelSeg2(vec2(0.0), pln_M * (c0 + hwk * (h0.x * n0 + h0.y * md)), pln_M * (c0 + hwk * (h1.x * n0 + h1.y * md))));
              }
            }
            cS = max(cS, -sqrt(m2));
          }
          ddS = min(cS, inSec ? bevelLine(adv - hwk, mr) : 1e20);
        }
      }
      if (u_caps == 1) {
        // Flat ends: cut square at a line's first and last vertex.
        if (first && u < 0.0) { dd = max(abs(v) - hwk, -u); ddS = max(bevelLine(abs(v) - hwk, vec2(-t.y, t.x)), bevelLine(-u, t)); }
        if (last && u > L) { dd = max(abs(v) - hwk, u - L); ddS = max(bevelLine(abs(v) - hwk, vec2(-t.y, t.x)), bevelLine(u - L, t)); }
      }
      if (dd < pln_best[li]) { pln_best[li] = dd; pln_bdash[li] = dash; }
      pln_bestS[li] = min(pln_bestS[li], ddS);
    }
  }
}

GenOut gen(vec2 p) {
  if (u_points_size.x < 2) return genOut(0.0, 0.0, 0.0, 1e4);
  // Fractions of the texture's width and height, as the shape editor draws them.
  vec2 k = u_units == 1 ? uRes : vec2(1.0);
  int nl = min(u_points_size.y, PLN_LINES);
  float hw = 0.5 * u_width;
  vec2 q = vec2(p.x, uRes.y - p.y);
  pln_asp = bevelAspectOn();
  pln_M = bevelFrame(vec2(1.0, 0.0), vec2(0.0, 1.0));
  pln_reach = max(bevelWidths().x, bevelWidths().y);
  for (int i = 0; i < PLN_LINES * UNI_1; i++) { pln_best[i] = 1e20; pln_bdash[i] = 0.0; pln_bestS[i] = 1e20; }
  // Tileable projects: the nearest of the 3×3 torus copies of each line, so a line may cross the edge. A copy is skipped
  // when no line of it can come nearer than the farthest line's distance so far (after the centre copy): its distance
  // is at least the pixel's from the points' bounds less half the width (√½ of it with flat ends' square corners;
  // flat-ended dashes, cut short at a dash, are always evaluated).
  vec2 blo = vec2(pln_f(0, PLN_BROW), pln_f(1, PLN_BROW));
  vec2 bhi = vec2(pln_f(2, PLN_BROW), pln_f(3, PLN_BROW));
  float far = 1e20;
  float farS = 1e20;
  for (int c = 0; c < 9 * UNI_1; c++) {
    if (c > 0 && !uTile) break;
    vec2 qc = q + vec2(PLN_TILE[c]) * uRes;
    if (c == 1) {
      far = -1e20;
      farS = -1e20;
      for (int i = 0; i < PLN_LINES * UNI_1; i++)
        if (i < nl) { far = max(far, pln_best[i]); farS = max(farS, pln_bestS[i]); }
    }
    float lb = length(max(max(blo - qc, qc - bhi), 0.0)) * (u_caps == 1 ? 0.7071 : 1.0) - hw;
    bool skip = c > 0 && !(u_dash > 0.0 && u_caps == 1) && lb > 0.0 && lb >= far && (!pln_asp || lb * u_bevel / pln_reach >= farS);
    if (!skip) lineSdf(qc, k, hw);
  }
  // The lines combined: the union (the two deepest where they cross, so a crossing has no crease), or the topmost line
  // over the rest, blended across its anti-aliased edge. The per-feature random is the topmost line's under the pixel
  // (the nearest line's outside them all).
  float d = 1e20;
  vec2 dp = vec2(0.0);
  // (Bevel aspect: the same union of the stretched distances, apart — each is continuous on its own.)
  float dS = 1e20;
  vec2 sp = vec2(0.0);
  int top = -1;
  int near = 0;
  for (int i = 0; i < PLN_LINES * UNI_1; i++) {
    if (i < nl) {
      float di = pln_best[i];
      if (di < d) { d = di; near = i; }
      pln_deep(dp, di);
      if (di < (u_overlap == 1 ? 0.5 : 0.0)) top = i;
      dS = min(dS, pln_bestS[i]);
      pln_deep(sp, pln_bestS[i]);
    }
  }
  d = pln_union(d, dp);
  dS = pln_union(dS, sp);
  int feat = top >= 0 ? top : near;
  float hv = -1.0;
  if (u_overlap == 1 && top >= 0) {
    // Later on top: the top line's own distance, eased into the union of the lines below across its edge pixel.
    float under = 1e20;
    vec2 up = vec2(0.0);
    float underS = 1e20;
    vec2 usp = vec2(0.0);
    int below = -1;
    for (int i = 0; i < PLN_LINES * UNI_1; i++) {
      if (i < top) {
        under = min(under, pln_best[i]);
        pln_deep(up, pln_best[i]);
        if (pln_best[i] < 0.0) below = i;
        underS = min(underS, pln_bestS[i]);
        pln_deep(usp, pln_bestS[i]);
      }
    }
    under = pln_union(under, up);
    underS = pln_union(underS, usp);
    float dt = pln_best[top];
    float dtS = pln_bestS[top];
    d = mix(min(under, dt), dt, clamp(0.5 - dt, 0.0, 1.0));
    dS = mix(min(underS, dtS), dtS, clamp(0.5 - dt, 0.0, 1.0));
    // The colour: the top line where the pixel's centre is on it, else the topmost line below that is.
    if (dt >= 0.0 && below >= 0) feat = below;
    // Height (GenOut.height, may pass 1): the top line's profile raised by Stack lift where it passes over the lines
    // below — eased by the distance to them, from a line width plus the bevel (plus Lift falloff) outside their edge to
    // full over their crown, so it arches over — and never below their surface, so its sides settle onto them.
    // (Bevel aspect: the stretched distances, as the wrapper takes GenOut.bdist.)
    float U = bevelRise(pln_asp ? pln_onion(under, underS) : sdOnion(under, u_outline));
    float bt = bevelRise(pln_asp ? pln_onion(dt, dtS) : sdOnion(dt, u_outline));
    float S = 1.0 - smoothstep(-hw, u_width + u_bevel + u_lift_fall, under);
    hv = max(U, bt * (1.0 + u_lift * S));
  } else if (u_overlap == 1) {
    hv = bevelRise(pln_asp ? pln_onion(d, dS) : sdOnion(d, u_outline));
  }
  float rnd = u_dash > 0.0 ? hashI(ivec2(feat, 7919 + int(pln_bdash[feat])), uSeed) : hashI(ivec2(feat, 7), uSeed);
  float sd = sdOnion(d, u_outline);
  // Later on top: its own height profile, anti-aliased by the coverage (the wrapper doesn't limit it).
  GenOut g = genOut(1.0, 1.0, rnd, sd);
  if (u_overlap == 1) g = genOutHeight(1.0, 1.0, rnd, sd, hv * coverage(sd, u_aa));
  if (pln_asp) g.bdist = pln_onion(d, dS);
  return g;
}
`;

export const polylineLayer: LayerDef = {
	type: 'polyline',
	label: 'Polyline',
	category: 'shape',
	kind: 'generator',
	sdf: true,
	description:
		'Polyline: Open lines with a width, drawn with the Line tool on the canvas, with optional rounded bends, tapers and dashes. Makes cables, trims, cracks, painted lines.',
	params: [
		P.bitmap('points', 'Points', '8,44 22,20 42,44 56,20', 'lines', {
			hint: 'Lists the points as x,y pairs (px from the top-left, or 0…1 with Units = fraction). Put each line on its own row or separate them with "|". Up to 64 vertices'
		}),
		P.enum('units', 'Units', 'px', [
			['px', 'Pixels'],
			['fraction', 'Fraction of the texture']
		]),
		P.float('width', 'Width', 3, 0.25, 1024, { softMax: 64, unit: 'px', step: 0.25 }),
		P.enum(
			'caps',
			'Ends',
			'round',
			[
				['round', 'Round'],
				['flat', 'Flat']
			],
			{ hint: 'Sets the shape of the line ends (and the dash ends)' }
		),
		P.enum('overlap', 'Overlap', 'stack', [
			['merge', 'Merge', 'merges crossing lines into one shape (the later line’s colour shows where they cross)'],
			[
				'stack',
				'Later on top',
				'lays each line over the ones before it, with a separate edge and bevel where it crosses them, and lifts it over them in height (Stack lift)'
			]
		]),
		P.float('lift', 'Stack lift', 1, 0, 4, {
			softMax: 2,
			step: 0.001,
			showIf: (p) => p.overlap === 'stack',
			hint: 'Lifts a later line where it crosses an earlier one, in line heights (Height › Pattern; 0 = level with it, 1 = a full line height above). Lines that cross nothing keep their height, and Height › Amount scales it all'
		}),
		P.float('lift_fall', 'Lift falloff', 0, 0, 1024, {
			softMax: 128,
			unit: 'px',
			step: 0.5,
			showIf: (p) => p.overlap === 'stack' && Number(p.lift) > 0,
			hint: 'Starts the top line rising this much further before the crossing, like a cable arching over another (it always eases up over at least a line width plus the bevel)'
		}),
		P.float('radius', 'Corner radius', 4.5, 0, 4096, {
			softMax: 128,
			unit: 'px',
			step: 0.1,
			hint: 'Bends the line round each corner, like cable and pipe runs. Sets the radius of the inner edge; the centre line bends on this plus half the width, using at most half of either segment (0 = sharp inner corners)'
		}),
		...taperParams({ at: 'end' }),
		P.float('dash', 'Dash length', 0, 0, 4096, {
			softMax: 64,
			unit: 'px',
			step: 0.5,
			hint: 'Breaks each line into dashes this long, each with a random value (0 = solid)'
		}),
		P.float('gap', 'Dash gap', 8, 0, 4096, {
			softMax: 64,
			unit: 'px',
			step: 0.5,
			showIf: (p) => Number(p.dash) > 0,
			hint: 'Sets the space between dashes'
		}),
		P.bool('dash_fit', 'Fit dashes to lines', true, {
			showIf: (p) => Number(p.dash) > 0,
			hint: 'Stretches dash and gap a little so every line starts and ends on a whole dash'
		}),
		P.float('dash_ofs', 'Dash offset', 0, -4096, 4096, {
			softMin: -64,
			softMax: 64,
			unit: 'px',
			step: 0.5,
			showIf: (p) => Number(p.dash) > 0,
			hint: 'Slides the dashes along the lines'
		}),
		P.float('outline', 'Outline', 0, 0, 512, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			hint: 'Draws only a stroke this wide just inside each edge, making twin rails (0 = solid)'
		}),
		P.seed('seed', 'Seed', 1, { hint: 'Reshuffles the random value each line (or dash) gets' })
	],
	defaults: { bevel: 1.5, profile: 'round', h_on: true, h_amount: 0.6, dif_on: true },
	fresh: (t) => {
		const width = Math.max(2, Math.round(Math.min(t.width, t.height) / 40));
		return { points: scaledPoints('8,44 22,20 42,44 56,20', t), width, radius: width * 1.5, bevel: width / 2 };
	},
	textures: ['line'],
	cpuData: memoReads((q: ParamValues, ctx: LayerCanvas) => ({
		line: polylineData(
			shaderPoints(parsePolylines(String(q.points ?? '')), unitsScale(q, ctx)),
			Number(q.radius ?? 4.5),
			0.5 * Number(q.width ?? 3)
		)
	})),
	glsl: PATHS_GLSL + TAPER_GLSL + POLYLINE_GLSL
};

export const PATH_LAYERS: LayerDef[] = [pathLayer, polylineLayer];
