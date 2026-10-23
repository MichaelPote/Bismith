// Cable (FR7.5): tubes wound on a helix and seen side-on — coil springs (1 strand), twisted rope and cable mouldings
// (2–8 strands). Each strand point has a depth (front strands sit higher than the back of each loop), so the value is a
// height: the topmost tube surface at the pixel above the bed, normalised over the cable's depth.
//
// One flat loop per pixel walks the chords of every strand within reach — a window along the axis around the pixel,
// vertices on a fixed grid of the helix angle so neighbouring pixels see the same polyline, and for rows that come
// close the neighbouring row too. Consecutive chords covering the pixel make one piece of swept tube; the topmost piece
// wins, and where its edge lies over another the two blend by its coverage, so front-over-back crossings anti-alias. Sink sets the cable into the surface: a bed plane hides what lies
// below it, and the outline follows where the tubes rise out of it. Fibres groove each strand with yarns wound round
// it; Irregularity varies the strands' thickness, radius and lay from one half turn to the next (seeded). The outline
// is the layer's shape for its mask (`sdf: 'mask'`, by Union). Path: an angle
// (snapped to a direction that closes on the torus when tiling), a sag and cut ends with rounded strand tips.

import { P, type ParamValues } from '@/core/params';
import type { LayerDef } from '../types';

const r1 = (v: number) => Math.round(v * 10) / 10;
/** The texture axis the cable runs along, for resizing its px lengths (null when Angle turns it well off its Axis). */
const cableAlong = (p: ParamValues): 'x' | 'y' | null => {
	const a = Math.abs((((((Number(p.angle) || 0) + 90) % 180) + 180) % 180) - 90);
	return a > 30 ? null : p.axis === 'vertical' ? 'y' : 'x';
};
const cableAcross = (p: ParamValues): 'x' | 'y' | null => {
	const a = cableAlong(p);
	return a === 'x' ? 'y' : a === 'y' ? 'x' : null;
};

export const cableLayer: LayerDef = {
	type: 'cable',
	label: 'Cable',
	category: 'pattern',
	kind: 'generator',
	description:
		'Coil springs, twisted rope and cable mouldings: tubes wound on a helix seen from the side; front strands cross over the back of each loop.',
	params: [
		P.enum('axis', 'Axis', 'horizontal', [
			['horizontal', 'Horizontal'],
			['vertical', 'Vertical']
		]),
		P.float('angle', 'Angle', 0, -180, 180, {
			softMin: -90,
			softMax: 90,
			step: 0.1,
			hint: 'Turns the cable from its axis, degrees clockwise. On tileable textures it snaps to the nearest direction that repeats across the tile (on a square: 45°, 26.6°, 18.4° …)'
		}),
		P.float('pos', 'Position', 0.5, -1, 2, {
			softMin: 0,
			softMax: 1,
			step: 0.001,
			hint: 'Centre line, 0..1 across the cable (down for horizontal cables); with several rows, their middle'
		}),
		P.float('count', 'Turns', 5, 0.25, 1024, {
			softMax: 64,
			step: 0.01,
			hint: 'Turns of each strand along the texture (rounded when tiling): fewer = a long, shallow lay; more = tightly wound'
		}),
		P.int('strands', 'Strands', 3, 1, 8, {
			hint: '1 = a coil spring or a wave; 2–8 = twisted rope (strands evenly spaced round the helix)'
		}),
		P.float('radius', 'Radius', 10.4, 0, 512, {
			softMax: 64,
			unit: 'px',
			axis: cableAcross,
			step: 0.1,
			hint: 'Helix radius: from the cable’s centre to the centre of a strand (≈ 1.15 × the tube radius lays 3 strands tight; 0 = one straight tube)'
		}),
		P.float('thickness', 'Tube radius', 9, 0.25, 256, {
			softMax: 48,
			unit: 'px',
			axis: cableAcross,
			step: 0.05,
			hint: 'Radius of each strand (the wire of a spring)'
		}),
		P.float('lean', 'Loop opening', 0, -512, 512, {
			softMin: -32,
			softMax: 32,
			unit: 'px',
			axis: cableAlong,
			step: 0.1,
			hint: 'Oblique view along the axis: 0 = straight side-on (a wave; rope strands as slanted bands), larger values open each turn into a loop (coil springs, cords); the sign tilts the loops the other way'
		}),
		P.float('back', 'Back depth', 1, 0, 4, {
			softMax: 2,
			step: 0.001,
			hint: 'How far the back of each loop sinks below the front: 1 = the true helix, more = deeper, less = a shallow braid; at 0 the strands lie level and merge where they cross'
		}),
		P.bool('flip', 'Reverse twist', false, {
			hint: 'Twist the other way: the strands slant the other way (left- instead of right-hand lay)'
		}),
		P.float('sink', 'Sink', 0.35, 0, 0.95, {
			step: 0.001,
			hint: 'Sets the cable into the surface: 0 = it stands on it (a drop at its outline, the backs of the loops show); 0.5 = sunk to its axis, a half-round moulding whose strands rise out of the surface; higher = only the crowns show'
		}),
		P.float('core', 'Core', 0.6, 0, 1, {
			step: 0.001,
			hint: 'Ropes (2 strands or more): a core behind the strands that fills the gaps between them — 0 = none, the surface shows through; 1 = as high as the strands’ centre line'
		}),
		P.float('irregular', 'Irregularity', 0.5, 0, 2, {
			softMax: 1,
			step: 0.001,
			hint: 'Hand-laid unevenness: each strand’s thickness, radius and lay vary from one half turn to the next (by the Seed)'
		}),
		P.seed(),
		P.int('yarns', 'Fibres', 9, 0, 64, {
			softMax: 24,
			section: 'Fibres',
			hint: 'Yarns twisted round each strand, grooving it: 0 = smooth strands (a moulding, a wire); 6–12 = laid rope'
		}),
		P.float('yarn_depth', 'Fibre depth', 1, 0, 6, {
			softMax: 4,
			step: 0.001,
			section: 'Fibres',
			showIf: (p) => Number(p.yarns) > 0,
			hint: 'Depth of the grooves between the yarns: 1 = round yarns, 4 = deep cuts. With Irregularity the yarns stand at different heights'
		}),
		P.float('yarn_angle', 'Fibre angle', 40, -85, 85, {
			step: 0.1,
			section: 'Fibres',
			showIf: (p) => Number(p.yarns) > 0,
			hint: 'Angle of the yarns to their strand, degrees: rope yarns run against the twist of the strands (about 30–50); negative leans them the other way, 0 runs them along the strand'
		}),
		P.float('sag', 'Sag', 0, -4096, 4096, {
			softMin: -128,
			softMax: 128,
			unit: 'px',
			axis: cableAcross,
			step: 0.1,
			section: 'Path',
			hint: 'The cable hangs: its centre line drops this far in the middle, between its ends (or the texture’s edges) — swags and festoons; negative arches it'
		}),
		P.float('start', 'Start', 0, 0, 1, {
			step: 0.001,
			section: 'Path',
			hint: 'Where the cable begins along its length (0..1); with End, a cut length whose strands end in rounded tips'
		}),
		P.float('end', 'End', 1, 0, 1, {
			step: 0.001,
			section: 'Path',
			hint: 'Where the cable ends along its length (0..1)'
		}),
		P.int('rows', 'Rows', 1, 1, 256, {
			softMax: 16,
			section: 'Rows',
			hint: 'Parallel cables evenly spaced across the texture (around Position): a bank of springs, a rope-work field'
		}),
		P.float('row_shift', 'Row shift', 0, -1, 1, {
			step: 0.001,
			section: 'Rows',
			showIf: (p) => Number(p.rows) > 1,
			hint: 'Each row starts this fraction of a turn further along (0.5 staggers the crossings between rows)'
		}),
		P.bool('row_flip', 'Alternate twist', false, {
			section: 'Rows',
			showIf: (p) => Number(p.rows) > 1,
			hint: 'Every other row twisted the other way: herringbone, knitted cables (an even number of rows repeats seamlessly)'
		})
	],
	// The outline goes to its mask (Shape by default), by Union (a trim laid over earlier shapes adds to them).
	sdf: 'mask',
	defaults: { mk_op: 'union', h_on: true, h_amount: 0.6, dif_on: true },
	// Plain defaults: a three-strand laid rope with fibres round a core, set a third into the surface, slightly uneven,
	// sized for 512 px. Added in the editor, its sizes follow the texture.
	fresh: ({ width, height }) => {
		const r = r1(Math.max(2.5, (9 * Math.min(width, height)) / 512));
		const R = r1(r * 1.15);
		return {
			radius: R,
			thickness: r,
			// A lay angle of about 35° to the axis: one turn every ≈ 9 helix radii.
			count: Math.max(1, Math.round(width / (9 * R))),
			// Yarns about 6 px wide (fewer on thin strands, where narrower ones would fade out).
			yarns: Math.max(3, Math.min(16, Math.round((2 * Math.PI * r) / 6)))
		};
	},
	glsl: /* glsl */ `
const float CABLE_TAU = 6.28318530718;

// A smooth random wobble along a strand (one knot per half turn), -1..1 per component: size, tube radius, lay; w: the
// strand's own thickness, constant along it. The knots repeat every period (> 0 when tiling): seamless.
vec4 cableJitter(float x, float period, int id) {
  float k0 = floor(x);
  float f = x - k0;
  f = f * f * (3.0 - 2.0 * f);
  float k1 = k0 + 1.0;
  if (period > 0.0) { k0 = mod(k0, period); k1 = mod(k1, period); }
  vec3 j = mix(hash3I(ivec2(int(k0), id), uSeed + 301.0), hash3I(ivec2(int(k1), id), uSeed + 301.0), f);
  return vec4(j, hashI(ivec2(id, 9), uSeed + 307.0)) * 2.0 - 1.0;
}

// Fibre relief on a strand (px, <= 0): yarns wound round it. f = (helix angle at the nearest chord point, tube radius
// (<= 0: the core, smooth), strand index + lay drift, size) there; px = the pixel in its row's frame; geo = (period,
// loop, helix radius, strands); K = yarn turns per helix turn along the strand; cb = cos(yarn angle); yp = how many
// yarns pass along the whole cable (tiling: their identities repeat after it; 0 = no repeat).
float cableFibre(vec4 f, vec2 px, vec4 geo, float K, float cb, float yp) {
  if (u_yarns <= 0 || u_yarn_depth <= 0.0 || f.y <= 0.0) return 0.0;
  // The nearest point of the smooth strand, by Newton steps from the chord's: the chords' own parameter kinks at each
  // vertex, which would print the polyline into the yarns.
  float P = geo.x, L = geo.y, Rk = geo.z * f.w, off = CABLE_TAU * f.z / geo.w;
  float th = f.x;
  vec2 rel = vec2(0.0), d1 = vec2(1.0, 0.0);
  for (int it = 0; it < 3; it++) {
    float a = th + off;
    float sa = sin(a), ca = cos(a);
    rel = px - vec2(P * th / CABLE_TAU + L * sa, Rk * ca);
    d1 = vec2(P / CABLE_TAU + L * ca, -Rk * sa);
    if (it == 2) break;
    float dd = dot(d1, d1);
    th += dot(rel, d1) / max(dd + dot(rel, vec2(L * sa, Rk * ca)), 0.25 * dd);
  }
  float sn = clamp((d1.x * rel.y - d1.y * rel.x) * inversesqrt(max(dot(d1, d1), 1e-6)) / f.y, -1.0, 1.0);
  float ny = float(u_yarns);
  float strand = floor(f.z + 0.5);
  float ph = ny * asin(sn) / CABLE_TAU + K * th / CABLE_TAU + 0.37 * strand;
  float x = fract(ph);
  float w = CABLE_TAU * f.y / ny;
  // The yarns' spacing on screen (closer towards the strand's sides). Wide yarns are round, meeting in V grooves; narrow
  // ones turn into a plain ripple (a V's corner would alias), and under ~2 px they fade out.
  float per = w * cb * sqrt(1.0 - sn * sn);
  float g = mix(0.5 + 0.5 * cos(CABLE_TAU * x), (2.0 * x - 1.0) * (2.0 * x - 1.0), smoothstep(3.0, 8.0, per));
  // Uneven: each yarn's crown stands at its own height (the grooves between stay put, so neighbours still meet).
  float yi = floor(ph);
  if (yp > 0.5) yi = mod(yi, yp);
  float lo = 0.7 * min(u_irregular, 1.0) * hashI(ivec2(int(yi), int(strand)), uSeed + 53.0);
  return -u_yarn_depth * 0.5 * w * (g + (1.0 - g) * lo) * smoothstep(1.5, 3.0, per);
}

GenOut gen(vec2 p) {
  bool vert = u_axis == 1;
  vec2 q = vec2(p.x, uRes.y - p.y);
  // The cable's frame in y-down pixels: d along it, n across (a vertical cable's frame is mirrored, as it always was:
  // across runs to the right), its length len along d and the spacing of its parallel copies. Tiling, the direction
  // snaps to (a·W, b·H) for small coprime a, b, so the cable closes on the torus, and the next copy across sits wrapU
  // further along (0 for horizontal and vertical cables).
  vec2 d = vert ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  if (u_angle != 0.0) {
    float ca = cos(radians(u_angle)), sa = sin(radians(u_angle));
    d = vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y);
  }
  float len = abs(d.x) * uRes.x + abs(d.y) * uRes.y;
  vec2 lat = vec2(0.0);
  if (uTile) {
    vec2 tu = d / uRes;
    tu /= max(abs(tu.x), abs(tu.y));
    vec2 ab = vec2(1.0, 0.0);
    float best = 2.0;
    int mMax = 12 + int(0.0 * uRes.x);
    for (int m = 1; m <= mMax; m++) {
      vec2 c = floor(float(m) * tu + 0.5);
      float e = 1.0 - dot(normalize(c * uRes), d);
      if (e < best - 1e-7) { best = e; ab = c; }
    }
    len = length(ab * uRes);
    d = ab * uRes / len;
    // A lattice step (k.x·W, k.y·H) one copy across: a·k.y − b·k.x = 1.
    lat = vec2(-1.0 / (abs(ab.y) > 0.5 ? ab.y : 1.0), 0.0);
    for (int i = 0; i <= 2 * mMax; i++) {
      float k1 = float(i - mMax), k2 = (1.0 + ab.y * k1) / ab.x;
      if (abs(ab.x) > 0.5 && abs(k2 - floor(k2 + 0.5)) < 1e-3) { lat = vec2(k1, floor(k2 + 0.5)); break; }
    }
    lat *= uRes;
  }
  vec2 nv = vert ? vec2(d.y, -d.x) : vec2(-d.y, d.x);
  float across = uTile ? uRes.x * uRes.y / len : abs(nv.x) * uRes.x + abs(nv.y) * uRes.y;
  if (dot(lat, nv) < 0.0) lat = -lat;
  float wrapU = dot(lat, d);
  wrapU -= len * floor(wrapU / len + 0.5);
  vec2 cc = 0.5 * uRes + (u_pos - 0.5) * across * nv;
  float u = dot(q - cc, d) + 0.5 * len;
  float v = dot(q - cc, nv);
  float turns = uTile ? max(1.0, floor(u_count + 0.5)) : u_count;
  float P = len / turns;

  float irr = u_irregular;
  float R = u_radius, L = u_lean, r = max(u_thickness, 0.25);
  float Rm = R * (1.0 + 0.3 * irr), rm = r * (1.0 + 0.3 * irr) * (1.0 + 0.25 * irr);
  float ext = Rm + rm;                       // the cable's half height
  float reach = ext + max(8.0, rm);          // distances (its mask) are worked out this far from its centre
  float top = Rm * u_back + rm;              // its crown above the centre plane
  float bed = mix(-top, top, u_sink);        // the surface it is set into

  // Rows, evenly spaced around Position (k: which copy across, tiling). Sag bends every row the same way: its centre
  // line drops by a parabola between the ends, and distances across are taken square to the bent line.
  int rows = max(u_rows, 1);
  float sp = across / float(rows);
  float mid = 0.5 * float(rows - 1);
  bool seg = u_start > 0.0 || u_end < 1.0;
  float xs = min(u_start, u_end) * len, xe = max(max(u_start, u_end) * len, xs + 1.0);
  float ub = u - (uTile ? floor(floor(v / sp + mid + 0.5) / float(rows)) : 0.0) * wrapU;
  float cm = uTile ? floor((ub - 0.5 * (xs + xe)) / len + 0.5) * len : 0.0;
  float span = seg ? xe - xs : len;
  float sg = clamp((ub - (seg ? xs + cm : uTile ? len * floor(ub / len) : 0.0)) / span, 0.0, 1.0);
  float sagV = 4.0 * u_sag * sg * (1.0 - sg);
  float sagK = inversesqrt(1.0 + pow(4.0 * u_sag * (1.0 - 2.0 * sg) / span, 2.0));
  v -= sagV;
  // The nearest row, and its neighbour on the pixel's side when within reach.
  float j0 = floor(v / sp + mid + 0.5);
  if (!uTile) j0 = clamp(j0, 0.0, float(rows - 1));
  float v0 = (v - (j0 - mid) * sp) * sagK;
  if (abs(v0) > reach) return genOut(0.0, 0.0, 0.0, abs(v0) - ext);
  float j1 = j0 + (v0 > 0.0 ? 1.0 : -1.0);
  float v1 = (v - (j1 - mid) * sp) * sagK;
  bool two = abs(v1) <= reach && (uTile || (j1 >= 0.0 && j1 <= float(rows - 1)));
  vec2 kw = uTile ? floor(vec2(j0, j1) / float(rows)) : vec2(0.0);
  ivec2 jr = ivec2(vec2(j0, j1) - kw * float(rows));
  // Each row in its own frame: shifted along by Row shift (and, uneven, by a random part of a turn), mirrored across
  // for the other twist. The ends move with it.
  vec2 sgn = u_row_flip ? vec2(1 - 2 * (jr & 1)) : vec2(1.0);
  vec2 vr = vec2(v0, v1) * sgn * (u_flip ? -1.0 : 1.0);
  vec2 rph = vec2(hashI(ivec2(jr.x, 3), uSeed + 211.0), hashI(ivec2(jr.y, 3), uSeed + 211.0)) - 0.5;
  vec2 shift = P * (u_row_shift * vec2(jr) + 0.6 * min(irr, 1.0) * rph);
  vec2 ub2 = u - kw * wrapU;
  vec2 cm2 = uTile ? floor((ub2 - 0.5 * (xs + xe)) / len + 0.5) * len : vec2(0.0);
  vec2 ur = ub2 + shift;
  vec4 ends = vec4(xs, xe, xs, xe) + (cm2 + shift).xxyy;
  // Chords per turn: about 2 px long at the strand's fastest; the window covers every chord that can reach the pixel.
  float SEG = clamp(ceil(CABLE_TAU * length(vec2(P / CABLE_TAU + abs(L), Rm)) * 0.5), 8.0, 512.0);
  float W = (abs(L) + reach) / P + 1.0 / SEG;
  SEG = min(SEG, floor(766.0 / (2.0 * W)));
  int NV = int(ceil(2.0 * W * SEG)) + 2;
  int n = clamp(u_strands, 1, 8);
  int perRow = n * NV;
  int total = two ? 2 * perRow : perRow;
  float jitPeriod = uTile ? 2.0 * turns : 0.0;

  // A: the topmost piece of tube at the pixel (with its coverage); B: the topmost one covering it fully (under A's
  // edge). A piece is a run of consecutive chords of a strand that cover the pixel: its height is their highest, its
  // coverage their largest (on a coil's steep turn the highest chord need not be the nearest). f = (helix angle, tube
  // radius (-1: the core), strand + lay drift, size) at its nearest point, for the fibres.
  float hA = -1e9, cA = 0.0, hB = -1e9, sdf = 1e4;
  vec4 fA = vec4(0.0, -1.0, 0.0, 1.0), fB = fA, fR = fA;
  vec2 pA = vec2(0.0), pB = pA, pR = pA;
  int idA = 0, idR = 0;
  bool inRun = false;
  float hR = 0.0, cR = 0.0;
  vec4 prev = vec4(0.0);
  vec3 prevF = vec3(0.0);
  // One flat loop with a uniform-derived bound (row-, then strand-major, and one more pass to close the last piece):
  // nested or constant loops make D3D's compiler unroll hundreds of iterations.
  for (int k = 0; k <= total; k++) {
    int c = k / perRow;
    int rem = k - c * perRow;
    int s = rem / NV;
    int i = rem - s * NV;
    vec2 px = c == 0 ? vec2(ur.x, vr.x) : vec2(ur.y, vr.y);
    int id = (c == 0 ? jr.x : jr.y) * 8 + s;
    float kk = floor((px.x / P - W) * SEG) + float(i);
    float th = kk * CABLE_TAU / SEG;
    vec4 jit = irr > 0.0 ? cableJitter(2.0 * kk / SEG, jitPeriod, id) * irr : vec4(0.0);
    // The strand swells and thins as a whole (tube and helix radius together, so a tight lay stays closed), with some
    // of its own on the tube — along it and for the whole strand — and drifts along its lay by up to a quarter of the
    // strand spacing.
    float sf = float(s) + 0.25 * jit.z;
    float sz = 1.0 + 0.3 * jit.x;
    float a = th + CABLE_TAU * sf / float(n);
    // Along the axis, across it, depth toward the viewer; tube radius.
    vec4 cv = vec4(P * th / CABLE_TAU + L * sin(a), R * sz * cos(a), R * sz * sin(a) * u_back, r * sz * (1.0 + 0.1 * jit.y + 0.15 * jit.w));
    vec3 cf = vec3(th, sf, sz);
    bool hit = false;
    float h = 0.0, cov = 0.0;
    vec4 f = vec4(0.0, -1.0, 0.0, 1.0);
    // A chord of the strand from the previous vertex (inside the ends); on ropes the first vertex of the first strand
    // stands in for the core.
    vec2 en = c == 0 ? ends.xy : ends.zw;
    bool inside = !seg || (min(prev.x, cv.x) >= en.x && max(prev.x, cv.x) <= en.y);
    if (k < total && ((i > 0 && inside) || (i == 0 && s == 0 && n > 1 && u_core > 0.0))) {
      // The core: a flattened tube (by ks) along the centre line, rounded off at the ends.
      float d = seg ? length(vec2(max(max(en.x - px.x, px.x - en.y), 0.0), px.y)) : abs(px.y);
      float z = 0.0, rr = R, ks = max(u_core * u_back, 1e-3);
      h = ks * sqrt(max(rr * rr - d * d, 0.0));
      if (i > 0) {
        vec2 e = cv.xy - prev.xy;
        float el = max(length(e), 1e-4);
        vec2 eh = e / el;
        vec2 w = px - prev.xy;
        float s0 = dot(w, eh);
        float t = clamp(s0 / el, 0.0, 1.0);
        d = length(w - e * t);
        z = mix(prev.z, cv.z, t);
        rr = mix(prev.w, cv.w, t);
        ks = 1.0;
        vec3 m = mix(prevF, cf, t);
        f = vec4(m.x, rr, m.y, m.z);
        // The top of the swept tube over the pixel: along a chord that climbs at slope g the highest point lies uphill
        // of the nearest one, and the tube stands sqrt(1 + g²) higher over its axis (steep turns of a coil).
        float g = (cv.z - prev.z) / el;
        float dp = eh.x * w.y - eh.y * w.x;
        float q2 = rr * rr - dp * dp;
        float sm = clamp(s0 + g * sqrt(max(q2, 0.0)) * inversesqrt(1.0 + g * g), 0.0, el);
        h = q2 > 0.0 ? prev.z + g * sm + sqrt(max(q2 - (sm - s0) * (sm - s0), 0.0)) : z;
      }
      // The footprint: what rises above the bed (a tube of radius rr round z; the core flattened by ks).
      float under = max(bed - z, 0.0) / ks;
      float rho2 = rr * rr - under * under;
      if (rho2 > 0.0) {
        float rho = sqrt(rho2);
        sdf = min(sdf, d - rho);
        cov = clamp(rho - d + 0.5, 0.0, 1.0);
        hit = cov > 0.0;
      }
    }
    // A piece ends where its chords stop covering the pixel, at the end of a strand and at the core.
    if (inRun && (!hit || i <= 1)) {
      if (hR > hA) { hA = hR; cA = cR; fA = fR; pA = pR; idA = idR; }
      if (cR >= 1.0 && hR > hB) { hB = hR; fB = fR; pB = pR; }
      inRun = false;
    }
    if (hit) {
      if (!inRun || cov > cR) { fR = f; pR = px; idR = id; }
      hR = inRun ? max(hR, h) : h;
      cR = inRun ? max(cR, cov) : cov;
      inRun = true;
    }
    prev = cv;
    prevF = cf;
  }
  if (cA <= 0.0) return genOut(0.0, 0.0, 0.0, sdf);

  // Fibres: K yarn turns per helix turn give the yarn angle on the strand's crown (rounded when tiling).
  float tb = tan(radians(u_yarn_angle));
  float K = -tb * length(vec2(P / CABLE_TAU, R)) * float(u_yarns) / r;
  if (uTile) K = floor(K * turns + 0.5) / turns;
  float yp = uTile ? abs(K * turns) : 0.0;
  float cb = inversesqrt(1.0 + tb * tb);
  vec4 geo = vec4(P, L, R, float(n));
  // Where A's edge lies over another tube, the two surfaces blend by A's coverage (a loop, so the fibres compile once).
  bool over = cA < 1.0 && hB > -1e8;
  float H = 0.0;
  for (int m = 0; m < (over ? 2 : 1); m++) {
    float hm = (m == 0 ? hA : hB) + cableFibre(m == 0 ? fA : fB, m == 0 ? pA : pB, geo, K, cb, yp);
    H = m == 0 ? hm : mix(hm, H, cA);
  }
  // Coverage: of the union of the tubes (the outline's anti-aliasing, Edge › Anti-alias), whichever of them is on top.
  float cov = over ? 1.0 : max(cA, coverage(sdf, u_aa));
  // Height over the bed, over the cable's depth above it (the colour's range). Height › Pattern takes it over at least a
  // tube's diameter, so crowns that barely rise out of a deep bed keep their own gentle height instead of being
  // stretched to the full range (the same value at sinks up to about a half).
  float value = clamp((H - bed) / max(top - bed, 1e-3), 0.0, 1.0);
  float hval = clamp((H - bed) / max(top - bed, 2.0 * rm), 0.0, 1.0);
  // Per strand along the ramp (two-tone ropes); a single strand gets one random per row.
  float rnd = n > 1 ? floor(fA.z + 0.5) / float(n - 1) : hashI(ivec2(idA / 8, 0), uSeed + 7.0);
  GenOut o = genOut(value, cov, rnd, sdf);
  o.hval = hval;
  return o;
}
`
};
