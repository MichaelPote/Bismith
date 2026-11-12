// Structured pattern layers (FR2.4): bricks, hex tiles, Voronoi cells, grid lines, stripes (checkerboards: Tiles).
// Cell-based patterns are SDF generators: they return the distance (px, negative inside) to the edge of the
// feature under the pixel plus a per-feature random, so the common shape params can bevel them and the
// channel outputs can vary them per brick / cell / tile. Every lattice wraps its indices when the project is
// tileable, so the pattern repeats seamlessly. (Clouds, gradients and scratches live in patternsFill.ts.)

import { hash2I, hashI } from '@/core/hash';
import { memoReads } from '@/core/memo';
import { P, gradient, round1 as r1, type ParamValues } from '@/core/params';
import { f32, gcd } from '../derivedMath';
import type { LayerCanvas, LayerDef } from '../types';
import { gradientLayer, scratchesLayer } from './patternsFill';

/**
 * Convex-cell helpers of hex tiles and Voronoi cells (each layer compiles its own copy; names are prefixed). A cell is an
 * intersection of half-planes: we keep the PAT_K nearest edges of the cell under the pixel (distance m, positive inside;
 * outward unit normal n), then build an exact signed distance with rounded corners from them.
 */
const PAT_CELL_GLSL = /* glsl */ `
#define PAT_K 4
// The pairs of the PAT_K edges: every corner the kept edges can make.
const ivec2 PAT_PAIRS[6] = ivec2[6](ivec2(0, 1), ivec2(0, 2), ivec2(0, 3), ivec2(1, 2), ivec2(1, 3), ivec2(2, 3));

void pat_pushEdge(inout float ms[PAT_K], inout vec2 ns[PAT_K], float m, vec2 n) {
  if (m >= ms[PAT_K - 1]) return;
  ms[PAT_K - 1] = m;
  ns[PAT_K - 1] = n;
  for (int i = PAT_K - 1; i > 0; i--) {
    if (ms[i] >= ms[i - 1]) break;
    float tm = ms[i]; ms[i] = ms[i - 1]; ms[i - 1] = tm;
    vec2 tn = ns[i]; ns[i] = ns[i - 1]; ns[i - 1] = tn;
  }
}
// Distance from the pixel to the intersection of two half-planes, given its signed distances o (positive
// outside) and outward normals: the corner point when the pixel lies in the corner's normal cone.
float pat_wedgeDist(float o1, vec2 n1, float o2, vec2 n2) {
  float c = dot(n1, n2);
  float s2 = 1.0 - c * c;
  if (s2 > 1e-4 && o1 - o2 * c > 0.0 && o2 - o1 * c > 0.0)
    return sqrt(max(o1 * o1 + o2 * o2 - 2.0 * o1 * o2 * c, 0.0) / s2);
  return max(o1, o2);
}
// Signed distance (px, negative inside) to the cell with corners rounded by r. Each edge pair gives a lower
// bound of the distance to the cell shrunk by r; the pair forming the nearest corner makes it exact.
float pat_cellSdf(float ms[PAT_K], vec2 ns[PAT_K], float r) {
  float d = r - ms[0];
  for (int k = 0; k < 6 * UNI_1; k++) {
    int i = PAT_PAIRS[k].x, j = PAT_PAIRS[k].y;
    if (ms[j] <= 1e8) d = max(d, pat_wedgeDist(r - ms[i], ns[i], r - ms[j], ns[j]));
  }
  return d - r;
}

// Turns a convex cell, kept as its PAT_K nearest edges, by a (radians) about its centre c (relative to the pixel), then
// moves it by off (px). Each edge plane keeps its distance h from the centre — and is drawn in by as much as the moved
// edge would reach past its place (the edge half length about 0.6 h; g: half the joint), side by side, so a cell is
// never cut off by its neighbours' places but only the sides that need it give way.
void pat_moveCell(inout float ms[PAT_K], inout vec2 ns[PAT_K], vec2 c, float a, vec2 off, float g) {
  mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
  float ca = cos(a), sa = abs(sin(a));
  for (int i = 0; i < PAT_K; i++) {
    if (ms[i] <= 1e8) {
      float h = ms[i] - dot(c, ns[i]);
      float out_ = dot(off, ns[i]) + h * (ca - 1.0) + 0.6 * h * sa - g;
      vec2 n = R * ns[i];
      ms[i] = h + dot(c + off, n) - max(out_, 0.0);
      ns[i] = n;
    }
  }
}

// Depth of the pixel in a convex cell kept as its PAT_K nearest edges (m: distance to each edge plane, positive
// inside; n: outward normal) with corners rounded by r, measured so that every contour has corners of radius r: the
// depth t at which the cell inset by t, then rounded by r, passes through the pixel. (The plain distance's inner
// contours sharpen into mitres deeper than r.) Per edge pair: the inset wedge's corner V(τ) = a − τb, τ = t + r, is r
// from the pixel — the larger root — when the pixel lies in its normal cone, else the nearer edge; t is the least.
float pat_roundDepth(float ms[PAT_K], vec2 ns[PAT_K], float r) {
  float t = ms[0];
  for (int k = 0; k < 6 * UNI_1; k++) {
    int i = PAT_PAIRS[k].x, j = PAT_PAIRS[k].y;
    vec2 n1 = ns[i], n2 = ns[j];
    float det = n1.x * n2.y - n1.y * n2.x;
    float tij = min(ms[i], ms[j]);
    if (ms[j] <= 1e8 && abs(det) > 1e-3) {
      vec2 a = vec2(n2.y * ms[i] - n1.y * ms[j], n1.x * ms[j] - n2.x * ms[i]) / det;
      vec2 b = vec2(n2.y - n1.y, n1.x - n2.x) / det;
      float bb = dot(b, b), ab = dot(a, b);
      float disc = ab * ab - bb * (dot(a, a) - r * r);
      if (bb > 1e-6 && disc >= 0.0) {
        float tau = (ab + sqrt(disc)) / bb;
        vec2 v = tau * b - a;   // from the corner to the pixel
        // In the corner's normal cone: v = α n1 + β n2 with α, β ≥ 0.
        float al = (v.x * n2.y - v.y * n2.x) / det, be = (n1.x * v.y - n1.y * v.x) / det;
        if (al >= 0.0 && be >= 0.0) tij = tau - r;
      }
    }
    if (ms[j] <= 1e8) t = min(t, tij);
  }
  return t;
}

// Bevel aspect (GLSL_BEVEL) of a convex cell kept as its PAT_K nearest edges (ms: px to each edge plane from the pixel,
// positive inside; ns: outward unit normals in the generator's frame, which jx / jy — dFdx / dFdy of its position — take
// to the screen) with corners rounded by r: the distance in the space the aspect stretches, px of Bevel, negative inside
// (dE: the cell's own distance, for the sign). Each edge is a plane there too; a rounded corner, a circle's arc, becomes
// an ellipse's (bevelArc2, for the true corner nearest the pixel — only within r of it can an arc be the nearest piece):
// exact, its mitres continuous where the direction-based width steps. Round bevel corners (rb): pat_roundDepth in the
// stretched space — the depth t at which the cell inset by t there, then rounded by the stretched corner (the ellipse),
// passes through the pixel: the corner of the edges inset by t plus the ellipse's reach across each, V(t) = a − t b, has
// the pixel on the ellipse round it, |K⁻¹(t b − a)| = r (the larger root), with the ellipse's normal there in the
// corner's normal cone. extra: how far every edge is moved in first (Size / Joint variation, Wobble).
float pat_cellBevel(float ms[PAT_K], vec2 ns[PAT_K], vec2 jx, vec2 jy, float r, float dE, bool rb, float extra) {
  for (int i = 0; i < PAT_K; i++) if (ms[i] <= 1e8) ms[i] -= extra;
  vec2 k = u_bevel / bevelWidths();   // screen axes → the stretched space
  vec2 ki = 1.0 / k;
  vec2 nc[PAT_K];   // the normals on screen
  float mS[PAT_K];  // the planes in the stretched space: distance and unit normal
  vec2 nS[PAT_K];
  float t = 1e9;
  for (int i = 0; i < PAT_K; i++) {
    vec2 n = vec2(dot(jx, ns[i]), dot(jy, ns[i]));
    n /= max(length(n), 1e-6);
    nc[i] = n;
    float l = max(length(n * ki), 1e-6);
    mS[i] = ms[i] <= 1e8 ? ms[i] / l : 1e9;
    nS[i] = n * ki / l;
    t = min(t, mS[i]);
  }
  // A corner of edges i, j: rb, the stretched round depth; else the nearest true corner (inside every other edge,
  // inset by r) for the arc. One loop over the pairs, the arc evaluated once after it.
  float vb = 1e18;
  vec2 vc = vec2(0.0), d0 = vec2(1.0, 0.0), d1 = vec2(0.0, 1.0);
  for (int c = 0; c < 6 * UNI_1; c++) {
    int i = PAT_PAIRS[c].x, j = PAT_PAIRS[c].y;
    vec2 n1 = rb ? nS[i] : nc[i], n2 = rb ? nS[j] : nc[j];
    float det = n1.x * n2.y - n1.y * n2.x;
    if (ms[j] <= 1e8 && abs(det) > 1e-3 && r > 0.0) {
      float m1 = rb ? mS[i] - r * length(k * n1) : ms[i] - r;
      float m2 = rb ? mS[j] - r * length(k * n2) : ms[j] - r;
      vec2 a = vec2(n2.y * m1 - n1.y * m2, n1.x * m2 - n2.x * m1) / det;
      if (rb) {
        vec2 b = vec2(n2.y - n1.y, n1.x - n2.x) / det;
        vec2 A = a * ki, B = b * ki;
        float bb = dot(B, B), ab = dot(A, B);
        float disc = ab * ab - bb * (dot(A, A) - r * r);
        if (bb > 1e-6 && disc >= 0.0) {
          float tc = (ab + sqrt(disc)) / bb;
          vec2 w = (tc * b - a) * ki * ki;   // the ellipse's normal at the pixel
          float al = (w.x * n2.y - w.y * n2.x) / det, be = (n1.x * w.y - n1.y * w.x) / det;
          if (al >= 0.0 && be >= 0.0) t = min(t, tc);
        }
      } else {
        bool real = true;
        for (int o = 0; o < PAT_K; o++) {
          if (o != i && o != j && ms[o] <= 1e8 && dot(a, nc[o]) > ms[o] - r + 1e-3) real = false;
        }
        if (real && dot(a, a) < vb) { vb = dot(a, a); vc = a; d0 = n1; d1 = n2; }
      }
    }
  }
  if (rb) return -t;
  // (The arc in screen px about the pixel, so its stretched position is 0.)
  if (vb < 1e17) t = min(t, sqrt(bevelArc2(vec2(0.0), mat2(k.x, 0.0, 0.0, k.y), vc, r, d0, d1, normalize(d0 + d1))));
  return dE > 0.0 ? abs(t) : -t;
}
`;

/**
 * Relief helpers of feature patterns (bricks, hex tiles, Voronoi cells; need their u_face / u_crown / u_face_tilt):
 * Height reads a value of its own (GenOut.hval) that the wrapper multiplies by the bevel — lumps of smooth noise and a
 * random tilt per feature over the domed shape, while Diffuse and the other outputs keep the plain bevel — or, with a
 * mortar / grout bed, a whole height profile of its own (genOutHeight).
 */
const PAT_RELIEF_GLSL = /* glsl */ `
// Smooth fractal noise with features about size px across (tileable; per-feature offsets keep it tileable too).
float pat_noise(vec2 p, vec2 res, float size, int oct, float seed) {
  vec2 fc = res / max(size, 1.0);
  fc = snapCells(fc);
  return fbm(p / res * fc, periodOf(fc), oct, seed);
}

// Height across a feature's face, 0..1: lumps and pits (Face relief), a pillow (Crown) and a tilt in a random direction
// (Face tilt). Each feature has its own surface — its own noise, lump size (0.6–1.4 × size px), strength and character:
// cloudy lumps, scattered pits (bowls, deepest at the noise's lows) or veins (soft grooves along its mid-contours) — and
// keeps headroom: Face relief 1 dents up to half the height, Face tilt 1 lowers the low side to 0.4. Crown falls
// away from the middle towards the edge by the feature's depth (dep px in from its outline, out of dmax): a flat top
// with rounded shoulders. q: position from the feature's centre (px), hs: its half size (px), id: its key.
float pat_face(vec2 p, vec2 res, float size, vec2 q, vec2 hs, ivec2 id, float dep, float dmax) {
  float h = 1.0;
  vec4 r = vec4(hash3I(id, uSeed + 89.0), hashI(id, uSeed + 91.0));
  if (u_face > 0.0) {
    float n = pat_noise(p + r.xy * res, res, size * (0.6 + 0.8 * r.z), 3, uSeed + 83.0);
    // Soft saturation (never flat): the lumps stay one continuous relief, not plateaus with cliffs between them.
    float xc = 2.2 * (0.5 - n);
    float cloud = 0.5 + 0.5 * xc / sqrt(1.0 + xc * xc);
    float pt = max(0.62 - n, 0.0) / 0.3;
    float pit = pt * pt / (1.0 + pt * pt);
    // Veins: soft, wide (Gaussian) valleys along the noise's mid-contours — no cusp, no thin outline grooves.
    float vx = (2.0 * n - 1.0) / 0.4;
    float vein = exp(-vx * vx);
    float c = fract(r.w * 7.13);
    float dent = c < 0.45 ? cloud : c < 0.75 ? 0.45 * cloud + 0.8 * pit : 0.5 * cloud + 0.5 * vein;
    h -= u_face * (0.4 + 0.6 * r.w) * 0.5 * clamp(dent, 0.0, 1.0);
  }
  if (u_crown > 0.0) {
    float t = 1.0 - clamp(dep / max(dmax, 1.0), 0.0, 1.0);
    h *= 1.0 - 0.5 * u_crown * t * t;
  }
  if (u_face_tilt > 0.0) {
    vec3 t = hash3I(id, uSeed + 97.0);
    float a = t.x * TAU;
    float s = dot(q / max(hs, vec2(1.0)), vec2(cos(a), sin(a)));
    h *= 1.0 - 0.6 * u_face_tilt * (0.25 + 0.75 * t.y) * (0.5 + 0.5 * clamp(s, -1.0, 1.0));
  }
  return clamp(h, 0.0, 1.0);
}

// The bevel distance a generator hands the wrapper (GenOut.bdist; NO_SDF = none): set before pat_out / pat_bedOut.
float pat_bd = NO_SDF;
// A share of the layer's coverage (Chip dust: chips show some of the colour beneath), set before pat_out / pat_bedOut.
float pat_cov = 1.0;
// Chip dust: how far the colour random moves towards 1 — with Diffuse › Random, the ramp's light end: a paler, freshly
// broken face (set before pat_out / pat_bedOut).
float pat_tint = 0.0;
// How deep the pixel is in a chip's smooth hollow, a share of the feature's height (pat_bedOut: where it reaches the
// bed, the colour is the bed's).
float pat_hollow = 0.0;
// The feature's share of its joint (Bricks › Joint variation; 1 = all of it): a shut feature (0) sits flush — its face
// relief and Height › Per-feature variation shrink with the share — so two shut ones meet level (set before pat_out /
// pat_bedOut; at 1 nothing changes).
float pat_js = 1.0;

// Sets pat_bd from a bevel distance in px (negative inside), with Bevel aspect applied the way the wrapper does
// (from the direction of its gradient). Call in uniform control flow. (At aspect 1 only: with an aspect, the generators
// measure the stretched distance themselves — pat_cellBevel, pat_notchS — as the gradient's direction steps on mitres.)
void pat_setBevelDist(float bd) { pat_bd = bevelLine(bd, vec2(dFdx(bd), dFdy(bd))); }

// The distance the wrapper draws: the layer's shape combined with its mask by the Mode (when it writes one).
float pat_drawnDist(float sdf) {
  return maskOp() > 0 ? sdfCombine(maskOp(), maskIn(ivec2(gl_FragCoord.xy)), sdf, u_mk_smooth) : sdf;
}

// A feature shape's result. With face relief on, Height reads hv × the bevel (genOutShaded with GenOut.hval) and the
// coverage is the one the wrapper draws otherwise: of drawn, pat_drawnDist(sdf).
// faced: whether the layer's settings make any (a uniform condition, so the result's kind never changes per pixel).
GenOut pat_out(float rnd, float sdf, float drawn, float hv, bool faced) {
  GenOut o = genOut(0.0, 1.0, rnd, sdf);
  if (faced) {
    o = genOutShaded(1.0, coverage(drawn, u_aa) * pat_cov, mix(rnd, 1.0, pat_tint), sdf);
    o.hval = hv;
    if (pat_tint > 0.0) {
      // The tinted random must not reach Height › Per-feature variation: apply it here, from the feature's own random.
      o.hval *= 1.0 - u_h_var * featVar(rnd);
      o.feat = 0.0;
    }
    o.hval = mix(1.0, o.hval, pat_js);
  }
  o.feat *= pat_js;
  o.bdist = pat_bd;
  o.fid = rnd;
  return o;
}

// With a mortar / grout bed: Height reads a profile of the layer's own (genOutHeight) — the features (bevel × hv × their
// Height › Per-feature variation, the wrapper's hash) rising from a bed at level (a share of their height), lumpy by the
// noise n (0..1). The bed fills chips and the feet of the bevels; colour and the other outputs cover only the features.
GenOut pat_bedOut(float rnd, float sdf, float drawn, float hv, float level, float n) {
  vec2 dg = vec2(dFdx(drawn), dFdy(drawn));
  float cov = coverage(drawn, u_aa);
  // Height › Per-feature variation, but never sinking a feature into the bed: at least 0.6 of the way up from it.
  float var = mix(1.0, max(1.0 - u_h_var * featVar(rnd), min(1.0, level + 0.6 * (1.0 - level))), pat_js);
  hv = mix(1.0, hv, pat_js);
  // The bevel as the wrapper draws it (bevelAt, one profileCurve call): from the generator's bevel distance while the
  // shape is its own, else from the drawn distance with Bevel aspect taken from its direction.
  bool own = pat_bd > NO_SDF && maskOp() <= 1;
  float bx = own ? max(-pat_bd, 0.0) / max(u_bevel, 1e-4) : max(-drawn, 0.0) / bevelWidth(dg);
  float bev = bevelProfile(bx);
  // The feature rises from the bed at its outline (no crease where its bevel would cross the bed level — the
  // "picture mount" line), to its top; hollows (chips) fill up to the bed.
  // The bed's level is measured against the features' lowest edge (Crown and Face tilt lower the edges), so it never
  // buries their outlines.
  float lv = level * (1.0 - 0.5 * min(u_crown, 2.0)) * (1.0 - 0.6 * u_face_tilt);
  float bed = lv * (0.92 + 0.16 * n);
  // A chip that goes down to the bed shows the colour beneath there too (a crisp edge) — no ghost of the outline.
  float through = 1.0 - smoothstep(0.96 - lv, 1.0 - lv, pat_hollow);
  GenOut o = genOutHeight(0.0, pat_cov * through, mix(rnd, 1.0, pat_tint), sdf, mix(bed, max(hv * var, bed), bev * cov));
  o.fid = rnd;
  o.feat = 0.0;   // the variation is in the profile already, and must not move the bed
  o.bdist = pat_bd;
  return o;
}

// Whether the layer's settings give its features any face relief (a uniform condition).
#define PAT_FACED (u_face > 0.0 || u_face_tilt > 0.0 || u_crown > 0.0)

// A feature layer's result from its distance (sdf), relief (hv; faced: PAT_FACED, or chips) and bed (level: Mortar /
// Grout level, 0 = none; n: the bed's lumps, 0..1).
GenOut pat_finish(float rnd, float sdf, float hv, bool faced, float level, float n) {
  float drawn = faced || level > 0.0 ? pat_drawnDist(sdf) : sdf;
  if (level > 0.0) return pat_bedOut(rnd, sdf, drawn, hv, level, n);
  return pat_out(rnd, sdf, drawn, hv, faced);
}
`;

/**
 * Chipped corners of bricks and hex tiles (need their u_chip_*; after PAT_RELIEF_GLSL): angular pieces broken out of a
 * feature (pat_notch), hollows in its height with a rough floor, and the colour and coverage that go with them.
 */
const PAT_CHIP_GLSL = /* glsl */ `
// A chip floor's roughness, 0..1: two octaves of value noise with features about size px (tileable).
float pat_rough(vec2 p, vec2 res, float size) {
  vec2 fc = res / max(size, 1.0);
  fc = snapCells(fc);
  ivec2 fp = periodOf(fc);
  return 0.65 * valueNoise(p / res * fc, fp, uSeed + 137.0) + 0.35 * valueNoise(p / res * fc * 2.0, periodOf(fc * 2.0), uSeed + 139.0);
}

// A chip's depth share at b px inside its hollow of size r: a crisp rim, then deeper towards the broken edge.
// The rim is a pixel wide on small chips and widens with the chip (a tenth of its size), so a big chip's wall reads
// as a broken slope, not a thin crack line.
float pat_chipK(float b, float r) {
  float rw = max(1.0, 0.1 * r);
  return 0.4 * clamp(b / rw + 0.5, 0.0, 1.0) + 0.6 * clamp(b / (0.6 * r), 0.0, 1.0);
}

// An angular chip: the piece of a feature on ref's side of the kinked line A – K – B (both cuts: a convex notch that
// always reaches the outline, never an island). Positive inside it, px.
// n1, n2: the cuts' unit normals, pointing into the piece.
void pat_notchN(vec2 A, vec2 K, vec2 B, vec2 ref, out vec2 n1, out vec2 n2) {
  n1 = normalize(vec2(K.y - A.y, A.x - K.x));
  n2 = normalize(vec2(B.y - K.y, K.x - B.x));
  n1 *= sign(dot(ref - A, n1));
  n2 *= sign(dot(ref - K, n2));
}
float pat_notch(vec2 x, vec2 A, vec2 K, vec2 B, vec2 ref) {
  vec2 n1, n2;
  pat_notchN(A, K, B, ref, n1, n2);
  return min(dot(x - A, n1), dot(x - K, n2));
}

// Bevel aspect of a chip broken through the outline (pat_notch, its distance moved by off): its two cuts as planes in
// the stretched space, px of Bevel. F takes a direction in x's frame to the screen.
float pat_notchS(vec2 x, vec2 A, vec2 K, vec2 B, vec2 ref, float off, mat2 F) {
  vec2 n1, n2;
  pat_notchN(A, K, B, ref, n1, n2);
  return min(bevelLine(dot(x - A, n1) + off, F * n1), bevelLine(dot(x - K, n2) + off, F * n2));
}

// After the chip loop (k: the deepest hollow's share, 0..1): the rough, broken floor — the hollows' depth varies
// strongly with a fine noise (size px; the colour follows the smooth hollow, so it doesn't speckle). Sets Chip dust's
// tint, and the colour beneath shows fully, with a crisp edge, where a chip goes nearly down to the joint, so no ghost
// of the old outline stays in colour. Returns the factor on the feature's height.
float pat_chipsDone(float k, vec2 p, vec2 res, float size) {
  float kc = k;
  if (k > 0.0) k *= 0.45 + 1.1 * pat_rough(p, res, size);
  pat_cov = 1.0 - smoothstep(0.9, 0.95, 1.3 * u_chip_depth * kc);
  pat_tint = u_chip_dust * clamp(1.4 * kc, 0.0, 1.0);
  pat_hollow = 1.3 * u_chip_depth * kc;   // (× 1.3: where the rough floor's deeper parts reach)
  return 1.0 - u_chip_depth * k;
}
`;

/** Face relief params (PAT_RELIEF_GLSL), in a Relief section. */
const faceParams = (what: string) => [
	P.float('face', 'Face relief', 0, 0, 1, {
		step: 0.001,
		section: 'Relief',
		hint: `Adds lumps and hollows across each ${what}’s face, in Height only (× the bevel), for worn, hand-made, uneven surfaces instead of flat tops. Each ${what} gets a random mix: cloudy, pitted or veined, finer or coarser`
	}),
	P.float('crown', 'Crown', 0, 0, 2, {
		step: 0.001,
		section: 'Relief',
		hint: `Domes each ${what}’s face, in Height only: the middle stays high and it falls away towards the edges (1 = by half, 2 = all the way down), for pillowed, worn ${what}s`
	}),
	P.float('face_tilt', 'Face tilt', 0, 0, 1, {
		step: 0.001,
		section: 'Relief',
		hint: `Tilts each ${what} a random way by a random amount up to this, in Height only, so one side sits lower (at 1, down to 0.4 of the height) and they look unevenly laid or settled`
	})
];

/**
 * Bricks and Voronoi cells with their own relief and wear off (face relief, crown, tilt, chips, the mortar / grout bed,
 * per-feature height): for recipes and templates that stack copies of one shape (pillow, edges, heights, colour) and
 * build the relief themselves.
 */
const RELIEF_OFF = { face: 0, crown: 0, face_tilt: 0, h_var: 0 };
export const BRICKS_PLAIN = { ...RELIEF_OFF, mortar_level: 0, chips: 0 };
export const VORONOI_PLAIN = { ...RELIEF_OFF, grout_level: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ------------------------------------------------------------------------------------------------ bricks

export const bricksLayer: LayerDef = {
	type: 'bricks',
	label: 'Bricks',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Bricks: Running-bond brickwork with mortar, rounding and random variation per brick, from crisp brick to hand-laid rubble with chipped corners and lumpy, tilted faces. Makes brick walls, dry-stone walls, rubble, paving.',
	params: [
		P.int('columns', 'Columns', 4, 1, 256, {
			softMax: 32,
			section: 'Layout',
			hint: 'How many bricks fit across the texture width'
		}),
		P.int('rows', 'Rows', 12, 1, 256, {
			softMax: 64,
			section: 'Layout',
			hint: 'How many brick courses run down the texture (use an even count with stagger to tile). Real bricks are about 3× as long as a course is tall'
		}),
		P.float('stagger', 'Stagger', 0.5, 0, 1, {
			step: 0.001,
			section: 'Layout',
			hint: 'Shifts alternate rows sideways, as a fraction of a brick'
		}),
		P.float('mortar', 'Mortar width', 2, -32, 256, {
			softMin: -8,
			softMax: 24,
			unit: 'px',
			step: 0.1,
			section: 'Layout',
			hint: 'Sets the gap between bricks. Negative grows the bricks into each other so they touch in creases (with Position jitter: dry-stone walls)'
		}),
		P.float('joint_var', 'Joint variation', 0, 0, 1, {
			step: 0.001,
			section: 'Layout',
			hint: 'Gives each brick a random amount of the mortar it carries (its left and top joints), of its bevel, and of its face relief and height variation (0 = every joint as set, 1 = from fully shut to full width). Shut bricks sit flush against the next with no mortar and hardly any edge, so runs of them read as one stone'
		}),
		P.float('round', 'Corner rounding', 1, 0, 256, { softMax: 32, unit: 'px', step: 0.1, section: 'Layout' }),
		P.float('mortar_level', 'Mortar level', 0.2, 0, 1, {
			step: 0.001,
			section: 'Layout',
			hint: 'Raises the mortar bed, as a share of the bricks’ height (Height › Pattern only): 0 leaves the joints at the surface below, higher fills them with a level, slightly lumpy bed so the bricks stand out less and chips fill up. When it’s on, Height skips Shaping › Value'
		}),
		P.bool('vertical', 'Vertical courses', false, {
			section: 'Layout',
			hint: 'Runs the courses up the texture (Columns then count along a course, Rows across)'
		}),
		P.float('row_jitter', 'Stagger variation', 0, 0, 1, {
			step: 0.001,
			section: 'Irregularity',
			hint: 'Shifts each row sideways by a random amount, as a fraction of a brick'
		}),
		P.float('len_var', 'Length variation', 0.25, 0, 1, {
			step: 0.001,
			section: 'Irregularity',
			hint: 'Randomly moves the joints so bricks differ in length'
		}),
		P.float('row_var', 'Row height variation', 0, 0, 1, {
			step: 0.001,
			section: 'Irregularity',
			hint: 'Randomly moves the bed joints so courses differ in height (rubble / ashlar walls)'
		}),
		P.float('min_size', 'Smallest piece', 0.5, 0, 1, {
			step: 0.001,
			section: 'Irregularity',
			showIf: (p) => Number(p.len_var) > 0 || Number(p.row_var) > 0,
			hint: 'Stops the variations from making slivers: the shortest brick and the lowest course are at least 0.1 + 0.9 × this of the regular size'
		}),
		P.float('size_jitter', 'Edge variation', 0, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			section: 'Irregularity',
			hint: 'Insets each brick side by a random amount, for uneven joints and a hand-laid look. Go up to a third of a course for rubble'
		}),
		P.float('pos_jitter', 'Position jitter', 0, 0, 64, {
			softMax: 24,
			unit: 'px',
			step: 0.05,
			section: 'Irregularity',
			hint: 'Shifts each brick by a random x/y amount, like hand-placed stone walls. Overlapping stones meet in a crease, not mortar'
		}),
		P.float('rot_jitter', 'Rotation variation', 0.5, 0, 45, {
			softMax: 20,
			unit: '°',
			step: 0.1,
			section: 'Irregularity',
			hint: 'Tilts each brick by a random angle up to this'
		}),
		P.float('shape_var', 'Stone shape', 0, 0, 1, {
			step: 0.001,
			section: 'Irregularity',
			hint: 'Breaks the rectangles into stones: corners cut off at random angles (mostly a little, now and then deeply), slanted ends, and sagging, bowed tops and bottoms. Makes rubble, dry-stone and flagstone walls instead of bricks'
		}),
		P.bool('close', 'Close gaps', true, {
			section: 'Irregularity',
			showIf: (p) => p.crease === true && Number(p.mortar) < 0,
			hint: 'Closes the gaps the creases leave between stones (dry stone: Straight creases, negative Mortar width). Each stone grows into them up to their middle and meets its neighbour in the same thin groove, so there’s no open mortar'
		}),
		P.bool('crease', 'Straight creases', true, {
			section: 'Irregularity',
			hint: 'Splits overlapping stones (negative Mortar width, Position jitter / Rotation variation) along one straight line across the overlap, like the tight joints of dry-stone walls. Off, each overlap follows the nearer outline, which can leave a corner poking into its neighbour'
		}),
		P.float('wobble', 'Wobble', 0, 0, 32, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			section: 'Irregularity',
			hint: 'Makes the brick outlines noisy and uneven, so the joints change width (Shaping › Domain warp bends them while keeping their width)'
		}),
		P.float('wobble_var', 'Wobble variation', 0.7, 0, 1, {
			step: 0.001,
			section: 'Irregularity',
			showIf: (p) => Number(p.wobble) > 0,
			hint: 'Gives each brick a random amount of the wobble (1 = anywhere from none to full), so some are crisp and some ragged'
		}),
		P.float('wobble_scale', 'Wobble scale', 1, 0.05, 16, {
			softMin: 0.1,
			softMax: 4,
			step: 0.01,
			section: 'Irregularity',
			showIf: (p) => Number(p.wobble) > 0 || Number(p.chips) > 0 || Number(p.mortar_level) > 0,
			hint: 'Sets the size of the wobble’s bumps (and of the chips’ ragged outline and the mortar bed’s lumps): 1 ≈ half a course, smaller is finer and crumblier'
		}),
		P.float('chips', 'Chipped corners', 0.4, 0, 1, {
			step: 0.001,
			section: 'Relief',
			hint: 'How many corners (and long sides) break out of each brick, leaving ragged hollows in its height that are deepest at the edge. The outline stays (Stone shape, Edge variation and Wobble break that)'
		}),
		P.float('chip_size', 'Chip size', 0.3, 0, 1, {
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.chips) > 0,
			hint: 'Sets the radius of the largest chips, as a share of each brick’s height (each one varies down to about a third of it)'
		}),
		P.float('chip_depth', 'Chip depth', 0.6, 0, 1, {
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.chips) > 0,
			hint: 'How deep the chips break in, as a share of the brick’s height (1 = down to the mortar at the broken edge)'
		}),
		P.float('chip_break', 'Broken outline', 0.35, 0, 1, {
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.chips) > 0,
			hint: 'How much of each chip breaks right through, notching the brick’s outline down to the mortar (0 = the outline stays, the chips only dent the face)'
		}),
		P.float('chip_dust', 'Chip dust', 0.45, 0, 1, {
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.chips) > 0,
			hint: 'Makes the chips’ broken floors paler, like a freshly broken face, so the chips show in colour as well as in relief. With Diffuse › Source Random, it moves them this far towards the light end of the gradient ramp (where a chip breaks through, the mortar shows anyway)'
		}),
		...faceParams('brick'),
		P.seed()
	],
	// A brick wall added in the editor, sized to the texture: bricks about 3:1 (an even row count from the aspect), a
	// bevel that domes them at this size, edge jitter and wobble in proportion to the courses.
	fresh: ({ width, height }) => {
		const columns = 4;
		const rows = Math.max(2, 2 * Math.round((columns * 3 * height) / width / 2));
		const course = height / rows;
		return {
			columns,
			rows,
			bevel: r1(clamp(course * 0.2, 1, 64)),
			size_jitter: r1(clamp(course * 0.03, 0, 8)),
			wobble: r1(clamp(course * 0.02, 0.2, 4))
		};
	},
	defaults: {
		face: 0.35,
		face_tilt: 0.5,
		h_var: 0.3,
		h_on: true,
		h_amount: 0.5,
		bevel: 2,
		profile: 'round',
		dif_on: true,
		dif_src: 'random',
		dif_grad: gradient('#4e2419', '#7a3a27', '#93513a', '#a8674c')
	},
	glsl:
		PAT_RELIEF_GLSL +
		PAT_CHIP_GLSL +
		/* glsl */ `
// Joint k of a row, in brick units. A shift < 0.45 keeps joints ordered (length variation).
float pat_joint(int k, int rw) {
  if (u_len_var <= 0.0) return float(k);
  int kw = wrapCell(k, u_columns);
  return float(k) + (hashI(ivec2(kw, rw), uSeed + 23.0) - 0.5) * 0.9 * u_len_var * (1.0 - u_min_size);
}

// Bed joint above course r (between r − 1 and r), in px. A shift < 0.45 courses keeps them ordered; snapped to
// whole pixels so the jittered courses stay crisp.
float pat_rowEdge(int r, float ch) {
  if (u_row_var <= 0.0) return float(r) * ch;
  int rb = wrapCell(r, u_rows);
  return floor((float(r) + (hashI(ivec2(rb, 3), uSeed + 61.0) - 0.5) * 0.9 * u_row_var * (1.0 - u_min_size)) * ch + 0.5);
}

// Horizontal shift of a row in brick units. Alternate rows are counted from the top.
float pat_rowShift(int rw) {
  int fromTop = u_rows - 1 - rw;
  float s = (fromTop & 1) == 1 ? u_stagger : 0.0;
  return s + (hashI(ivec2(rw, 7), uSeed + 31.0) - 0.5) * u_row_jitter;
}

GenOut gen(vec2 p) {
  // Vertical courses: work in transposed space.
  vec2 res = u_vertical ? uRes.yx : uRes;
  if (u_vertical) p = p.yx;
  // The frame's axes on screen (the vertical swap, Shaping › Domain warp), for Bevel aspect.
  vec2 jx = dFdx(p), jy = dFdy(p);
  bool asp = bevelAspectOn();
  vec2 cs = res / vec2(float(u_columns), float(u_rows));
  int r0 = int(floor(p.y / cs.y));
  // Dry stone: straight creases with negative mortar.
  bool dry = u_crease && u_mortar < 0.0;
  // How far (px) a brick can reach past its course at most: negative mortar, edge and position jitter, the turn of its
  // longer half (and dry stone's growth to still cover its place), the moved bed joints. Past half a course the search
  // takes five courses instead of three, so far-reaching stones aren't clipped along the course lines.
  float sa = sin(radians(u_rot_jitter));
  vec2 hm = 0.5 * cs * (1.0 + 0.9 * vec2(u_len_var, u_row_var) * (1.0 - u_min_size)) + 0.5;   // the largest half size
  float reach = max(-u_mortar, 0.0) + 0.5 * u_size_jitter + u_pos_jitter + 2.0 * sa * hm.x + sa * sa * hm.y + hm.y - 0.5 * cs.y;
  int nr = reach > 0.5 * cs.y ? 5 : 3;
  int jr = r0 - nr / 2;   // the lowest course searched
  // Each course's shift (brick units) and bed joints (px), once per course.
  float RS[5], RE[6];
  for (int j = 0; j < (nr + 1) * UNI_1; j++) {
    RE[j] = pat_rowEdge(jr + j, cs.y);
    if (j < nr) RS[j] = pat_rowShift(wrapCell(jr + j, u_rows));
  }
  // Every brick around the pixel (nr courses × 5): its distance, the pixel in its frame, half size, centre, turn, key.
  float DD[25];
  vec2 QQ[25], HH[25], CC[25];
  vec2 XA[25];   // each brick's own x axis (its turn)
  ivec2 II[25];
  // One flat loop over the bricks (bound from a uniform, so D3D keeps it rolled: a much smaller shader).
  for (int t = 0; t < nr * 5 * UNI_1; t++) {
    int j = t / 5;
    int r = jr + j;
    int rw = wrapCell(r, u_rows);
    float s = RS[j];
    float ry0 = RE[j], ry1 = RE[j + 1];
    int k = int(floor(p.x / cs.x - s)) + t % 5 - 2;
    float x0 = pat_joint(k, rw);
    float x1 = pat_joint(k + 1, rw);
    ivec2 id = ivec2(wrapCell(k, u_columns), rw);
    // Mortar runs along the left and top (on screen) of each cell, so whole-pixel brick sizes and mortar
    // widths put every edge on a pixel boundary. Joint variation: each brick carries its own share of it.
    float mo = u_mortar * (1.0 - u_joint_var * hashI(id, uSeed + 191.0));
    vec2 ctr = vec2((0.5 * (x0 + x1) + s) * cs.x, 0.5 * (ry0 + ry1)) + vec2(0.5, -0.5) * mo;
    vec2 hs = vec2((x1 - x0) * cs.x, ry1 - ry0) * 0.5 - 0.5 * mo;
    if (u_size_jitter > 0.0) {
      // Independent random inset per side: left, right, bottom, top. Dry stone keeps the stones' sizes and only moves
      // them, so the jitter opens no joints.
      vec4 sj = vec4(hash3I(id, uSeed + 41.0), hashI(id, uSeed + 43.0)) * u_size_jitter;
      if (!dry) hs -= 0.5 * vec2(sj.x + sj.y, sj.z + sj.w);
      ctr += 0.5 * vec2(sj.x - sj.y, sj.z - sj.w);
    }
    vec2 sh = u_pos_jitter > 0.0 ? (hash2I(id, uSeed + 71.0) - 0.5) * 2.0 * u_pos_jitter : vec2(0.0);
    // Dry stone: a shifted stone spans both its place and where it moved to (half the shift and half as big again), so
    // the shift opens no joint behind it.
    ctr += dry ? 0.5 * sh : sh;
    vec2 q = p - ctr;
    float a = 0.0;
    if (u_rot_jitter > 0.0) {
      a = (hashI(id, uSeed + 73.0) - 0.5) * 2.0 * radians(u_rot_jitter);
      q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
    }
    // Dry stone: a turned stone grows to still cover its place, so the turn opens no gaps either — the creases split
    // the overlaps instead.
    if (dry) hs += abs(sin(a)) * hs.yx + 0.5 * abs(sh);
    hs = max(hs, vec2(0.0));
    DD[t] = sdRoundBox(q, hs, vec4(u_round));
    QQ[t] = q; HH[t] = hs; CC[t] = ctr; II[t] = id;
    XA[t] = vec2(cos(a), sin(a));
  }
  int nb = nr * 5;
  float cg = 0.5 * clamp(0.2 * u_bevel, 1.0, 2.0);   // half the groove between creased stones
  float CS[25];   // Bevel aspect: each stone's creases in the space the aspect stretches (px of Bevel)
  for (int t = 0; t < nb * UNI_1; t++) CS[t] = -1e9;
  // Only where stones can overlap: the narrowest joint against how far two neighbours can move and turn towards each
  // other (conservative — below that no two boxes meet, and the test would change nothing).
  bool overlap = u_mortar * (1.0 - u_joint_var) <= 2.0 * (u_pos_jitter + sa * max(hm.x, hm.y)) + 0.1;
  if (u_crease && overlap) {
    // Straight creases: each stone near the pixel is split from every stone it overlaps (separating-axis test on their
    // four edge directions) along one line across the middle of the overlap, square to the axis they overlap least on
    // (the contact normal). The line is the same seen from either stone, so every pixel agrees which stone it is in,
    // and it runs right across both: each stone is its box cut by half-planes, so it stays convex — no stubs, steps or
    // hammer-heads. The stones keep a groove of about a fifth of the bevel (1–2 px) between them.
    float DC[25];
    for (int t = 0; t < nb * UNI_1; t++) DC[t] = DD[t];
    for (int t = 0; t < nb * UNI_1; t++) {
      if (DD[t] < 0.25 * cs.y) {
        vec2 cA = CC[t], hA = HH[t];
        vec2 ax0 = XA[t], ax1 = vec2(-ax0.y, ax0.x);
        float dA = DD[t], sA = -1e9;
        for (int o = 0; o < nb * UNI_1; o++) {
          if (o != t && DD[o] < 1e8) {
            vec2 dc = CC[o] - cA, oHs = HH[o];
            vec2 bx0 = XA[o], bx1 = vec2(-bx0.y, bx0.x);
            float pen = 1e9, sp = 0.0;
            vec2 n = vec2(1.0, 0.0);
            for (int i = 0; i < 4; i++) {
              vec2 u = i == 0 ? ax0 : i == 1 ? ax1 : i == 2 ? bx0 : bx1;
              float ha = abs(dot(u, ax0)) * hA.x + abs(dot(u, ax1)) * hA.y;
              float hb = abs(dot(u, bx0)) * oHs.x + abs(dot(u, bx1)) * oHs.y;
              float D = dot(dc, u);
              float pi = ha + hb - abs(D);
              if (pi < pen) { pen = pi; n = D < 0.0 ? -u : u; sp = 0.5 * (abs(D) - hb + ha); }
            }
            if (pen > 0.0) {
              float pl = dot(p - cA, n) - sp + cg;
              dA = max(dA, pl);
              if (asp) sA = max(sA, bevelLine(pl, vec2(dot(jx, n), dot(jy, n))));
            }
          }
        }
        DC[t] = dA;
        CS[t] = sA;
      }
    }
    for (int t = 0; t < nb * UNI_1; t++) DD[t] = DC[t];
  }
  // The nearest three after the creases.
  float best = 1e9, second = 1e9, third = 1e9;
  int b0 = 0, b1 = 0;
  for (int t = 0; t < nb * UNI_1; t++) {
    float d = DD[t];
    if (d < best) { third = second; second = best; b1 = b0; best = d; b0 = t; }
    else if (d < second) { third = second; second = d; b1 = t; }
    else if (d < third) third = d;
  }
  ivec2 bestId = II[b0], secId = II[b1];
  int wi = b0;   // the nearest stone's index
  // Bevel aspect: its own pieces in the space the aspect stretches (cutS: Stone shape's cuts; cutE: the same in px).
  float cutS = -1e9, cutE = -1e9;
  vec2 wa = XA[b0], wb = vec2(-wa.y, wa.x);
  vec2 sax = normalize(vec2(dot(jx, wa), dot(jy, wa))), say = normalize(vec2(dot(jx, wb), dot(jy, wb)));
  vec2 bestQ = QQ[b0], secQ = QQ[b1];
  vec2 bestHs = HH[b0], secHs = HH[b1];
  if (u_close && dry) {
    // Close gaps: where the creases leave a gap between stones, the nearest stone grows to the gap's middle line (the
    // crease between it and the next stone: 0.5 (best − second)), keeping the groove there — the stones fit into
    // each other and no open mortar is left. (Before Stone shape, which then still cuts its corners and ends.) Where a
    // stone already meets its neighbour in a crease, this changes nothing (second = |best| + groove there).
    best = min(best, cg + 0.5 * (best - second));
  }
  if (u_shape_var > 0.0) {
    // Stone shapes: the nearest brick loses a chamfer at each corner (random angle, depth mostly small, now and then
    // deep), its ends slant, and its top and bottom sag towards one end and bow — each a cut. Where that leaves the
    // pixel nearer the second brick, that one is the nearest.
    vec4 hc = vec4(hash3I(bestId, uSeed + 161.0), hashI(bestId, uSeed + 163.0));
    vec4 ha = vec4(hash3I(bestId, uSeed + 167.0), hashI(bestId, uSeed + 169.0));
    vec4 hb = vec4(hash3I(bestId, uSeed + 171.0), hashI(bestId, uSeed + 173.0));
    vec3 ht = hash3I(bestId, uSeed + 177.0);
    float m = min(bestHs.x, bestHs.y);
    float ux = bestQ.x / max(bestHs.x, 1.0);
    float cut = -1e9;
    for (int c = 0; c < 6 * UNI_1; c++) {
      // Half-plane cuts: the corners (0–3) chamfered, the ends (4 left, 5 right) slanted.
      bool corner = c < 4;
      vec2 sg = corner ? vec2((c & 1) == 0 ? -1.0 : 1.0, (c & 2) == 0 ? -1.0 : 1.0) : vec2(c == 4 ? -1.0 : 1.0, 0.0);
      float an = corner ? 0.785398 + (ha[c & 3] - 0.5) * 0.8 : (hb[c & 1] - 0.5) * u_shape_var;
      vec2 nn = corner ? sg * vec2(cos(an), sin(an)) : vec2(sg.x * cos(an), sin(an));
      float hcc = hc[c & 3];
      // Corners: cut in by a random depth — the deeper of the two at an end only, the other kept small, so an end is
      // slanted or chamfered on one side, never sharpened into an arrowhead; ends: the plane turns about the middle.
      float hco = hc[(c & 3) ^ 2];
      float depth = corner ? u_shape_var * m * (0.1 + 0.9 * hcc * hcc) * (hcc < hco ? 0.25 : 1.0) : bestHs.y * abs(sin(an));
      float cv = dot(bestQ, nn) - dot(bestHs, abs(nn)) + depth;
      cut = max(cut, cv);
      if (asp) cutS = max(cutS, bevelLine(cv, sax * nn.x + say * nn.y));
    }
    for (int c = 0; c < 2 * UNI_1; c++) {
      // The top (0) and bottom (1): sagging towards one end and bowed, y = ±(hs.y − sag(x)).
      float bow = u_shape_var * (0.05 + 0.3 * hb[c + 2]) * bestHs.y;
      float tap = u_shape_var * 0.35 * ht[c] * bestHs.y;
      float sx = ht.z < 0.5 ? 1.0 : -1.0;
      float sag = bow * ux * ux + tap * (0.5 + 0.5 * sx * ux);
      float slope = (2.0 * bow * ux + 0.5 * tap * sx) / max(bestHs.x, 1.0);
      float cv = ((c == 0 ? 1.0 : -1.0) * bestQ.y - (bestHs.y - sag)) / sqrt(1.0 + slope * slope);
      cut = max(cut, cv);
      // (The curve's normal where the pixel is: (slope, ±1) in the stone's frame.)
      if (asp) cutS = max(cutS, bevelLine(cv, sax * slope + say * (c == 0 ? 1.0 : -1.0)));
    }
    float b = max(best, cut);
    if (b > second) {
      best = second; second = min(b, third);
      bestId = secId; bestQ = secQ; bestHs = secHs;
      wi = b1;
      cutS = -1e9;
    } else {
      best = b;
      cutE = cut;
    }
  }
  float bestRnd = hashI(bestId, uSeed);
  // Overlapping bricks (jitter) meet in a crease: inside the union, the distance to the boundary between the two
  // nearest bricks is (second − best) / 2. Equals best whenever bricks do not overlap.
  best = max(best, 0.5 * (best - second));
  // Wobble noise, features about half a brick course tall (× Wobble scale); it also frays the chips and lumps the bed.
  float n = 0.5;
  if (u_wobble > 0.0 || u_chips > 0.0 || u_mortar_level > 0.0) n = pat_noise(p, res, 0.5 * cs.y * u_wobble_scale, 3, uSeed + 57.0);
  if (u_wobble > 0.0) best += (n - 0.5) * 4.0 * u_wobble * (1.0 - u_wobble_var * hashI(bestId, uSeed + 59.0));
  float bdS = NO_SDF;
  if (asp) {
    // Bevel aspect: the nearest stone — its rounded box, creases and Stone shape's cuts, each convex — measured in the
    // space the aspect stretches: each side and cut a plane there (bevelLine), a rounded corner an ellipse's arc
    // (bevelArc2), the most outside of them (the stone is their intersection), so its mitres stay continuous.
    if (wi != b0) {
      wa = XA[wi];
      wb = vec2(-wa.y, wa.x);
      sax = normalize(vec2(dot(jx, wa), dot(jy, wa)));
      say = normalize(vec2(dot(jx, wb), dot(jy, wb)));
    }
    vec2 wq = QQ[wi], wh = HH[wi];
    float db = sdRoundBox(wq, wh, vec4(u_round));
    float s = max(bevelLine(abs(wq.x) - wh.x, sax), bevelLine(abs(wq.y) - wh.y, say));
    float rr = min(u_round, min(wh.x, wh.y));
    if (rr > 0.0) {
      vec2 sg = vec2(wq.x < 0.0 ? -1.0 : 1.0, wq.y < 0.0 ? -1.0 : 1.0);
      mat2 M = bevelFrame(sax, say);
      s = -min(-s, sqrt(bevelArc2(M * wq, M, sg * (wh - rr), rr, vec2(sg.x, 0.0), vec2(0.0, sg.y), normalize(sg))));
      if (db > 0.0) s = abs(s);
    }
    float bc = max(DD[wi], cutE);   // the same in px
    bdS = max(max(s, CS[wi]), cutS);
    // What the rest did to the distance (Close gaps, overlaps, Wobble) goes on at the local stretch — the stretched
    // distance's share of the plain one, eased to 1 at the outline (continuous, so it doesn't step).
    float dw = best - bc;
    bdS += dw * (bdS * bc + 1.0) / (bc * bc + 1.0);
  }
  float hv = 1.0;
  if (PAT_FACED) hv = pat_face(p, res, 0.5 * cs.y, bestQ, bestHs, bestId,
    smin(bestHs.x - abs(bestQ.x), bestHs.y - abs(bestQ.y), 0.6 * min(bestHs.x, bestHs.y)), min(bestHs.x, bestHs.y));
  if (u_chips > 0.0) {
    // Chips: angular pieces broken out of the nearest brick — one may knock off each corner (0–3), two more bite into
    // its long sides (4, 5): the piece beyond a kinked cut (pat_notch), so it always reaches the outline. Each is a
    // hollow in the height around the piece (a crisp rim, deeper towards the broken edge); with Broken outline the
    // piece itself — less of it for lower values — is cut away down to the mortar.
    float k = 0.0;
    float brk = -1e9;
    float cr = 2.0 * u_chip_size * min(bestHs.x, bestHs.y);
    vec2 cA = vec2(0.0), cK = vec2(0.0), cB = vec2(0.0), cRef = vec2(0.0), cS = vec2(1.0);   // the piece broken out furthest
    float cOff = 0.0;
    // The four corners' chances (c = 0..3); at most one chip per end, so an end never turns into an arrowhead.
    vec4 hx = vec4(hashI(bestId, uSeed + 101.0), hashI(bestId, uSeed + 102.0), hashI(bestId, uSeed + 103.0), hashI(bestId, uSeed + 104.0));
    for (int c = 0; c < 6 * UNI_1; c++) {
      vec4 h = vec4(hash3I(bestId, uSeed + 101.0 + float(c)), hashI(bestId, uSeed + 131.0 + float(c)));
      // Corners chip far more often than the long sides; the other corner at this end wins if it chipped with a lower
      // chance.
      bool lose = c < 4 && hx[c ^ 2] < u_chips && hx[c ^ 2] < h.x;
      if (h.x < (c < 4 ? u_chips : 0.35 * u_chips) && !lose) {
        float r = max(cr * (0.35 + 0.65 * h.y), 0.5);
        vec2 s = c < 4 ? vec2((c & 1) == 0 ? -1.0 : 1.0, (c & 2) == 0 ? -1.0 : 1.0) : vec2(1.0, c == 4 ? 1.0 : -1.0);
        vec2 x = bestQ * s;
        float ka = 0.5 + 0.4 * h.z, kb = 0.5 + 0.4 * h.w;
        // A corner: the piece beyond a cut from the top edge (aa in) to the side (bb in) — one facet (a straight cut)
        // or two (a kink K). A long side: a shallow, lopsided bite of width 2 aa along the arris.
        float aa = r * (0.6 + 0.8 * h.z), bb = r * (0.6 + 0.8 * h.w);
        bool one = fract(h.y * 11.3) < 0.35;
        float x0 = (fract(h.y * 5.17) - 0.5) * 1.4 * bestHs.x;
        vec2 A = c < 4 ? bestHs - vec2(aa, 0.0) : vec2(x0 - aa, bestHs.y);
        vec2 B = c < 4 ? bestHs - vec2(0.0, bb) : vec2(x0 + aa, bestHs.y);
        vec2 K = c < 4 ? (one ? 0.5 * (A + B) : bestHs - vec2(ka * aa, kb * bb))
                       : vec2(x0 + (ka - 0.7) * 1.6 * aa, bestHs.y - 0.35 * bb);
        vec2 ref = c < 4 ? bestHs + 1.0 : vec2(x0, bestHs.y + 1.0);
        float en = (n - 0.5) * 0.3 * r;
        float e = pat_notch(x, A, K, B, ref) + en;
        k = max(k, pat_chipK(e + r, r));
        // Broken outline: from none of the piece (0) through all of it to a little of the hollow round it (1).
        float o = (0.9 * u_chip_break - 0.5) * r;
        if (e + o > brk) { brk = e + o; cA = A; cK = K; cB = B; cRef = ref; cS = s; cOff = en + o; }
      }
    }
    hv *= pat_chipsDone(k, p, res, 0.12 * cs.y);
    if (u_chip_break > 0.0) {
      best = max(best, brk);
      // Bevel aspect: the broken piece's cuts as planes in the stretched space (x = the stone's frame × s).
      if (asp && brk > -1e8) bdS = max(bdS, pat_notchS(bestQ * cS, cA, cK, cB, cRef, cOff, mat2(sax, say) * mat2(cS.x, 0.0, 0.0, cS.y)));
    }
  }
  if (u_joint_var > 0.0) {
    // Joint variation: the nearest brick's bevel narrows with its share of the joint (a shut brick has hardly any edge)
    // and its relief goes flush (pat_js).
    pat_js = 1.0 - u_joint_var * hashI(bestId, uSeed + 191.0);
    if (!asp) pat_setBevelDist(best / max(pat_js, 0.05));
  }
  if (asp) pat_bd = bdS / max(pat_js, 0.05);
  return pat_finish(bestRnd, best, hv, PAT_FACED || u_chips > 0.0, u_mortar_level, n);
}
`
};

// ------------------------------------------------------------------------------------------------ hex tiles

export const hexLayer: LayerDef = {
	type: 'hex',
	label: 'Hex tiles',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Hex tiles: Hexagonal tiles with grout between them and a random value per tile, from neat to hand-set and chipped. Makes floor tiles, honeycomb, hex paving.',
	params: [
		P.float('scale', 'Tiles across', 6, 1, 256, {
			softMax: 32,
			step: 0.01,
			hint: 'How many hexes fit across the texture width. Tiling needs whole counts with an even row count, so it picks the nearest count that keeps the hexes regular (it may differ by 1–2, with a slight stretch)'
		}),
		P.enum('orient', 'Orientation', 'pointy', [
			['pointy', 'Pointy top'],
			['flat', 'Flat top']
		]),
		P.float('gap', 'Grout width', 2, 0, 256, { softMax: 24, unit: 'px', step: 0.1 }),
		P.float('round', 'Corner rounding', 0, 0, 256, { softMax: 32, unit: 'px', step: 0.1 }),
		P.bool('round_bevel', 'Round bevel corners', true, {
			showIf: (p) => Number(p.round) > 0,
			hint: 'Keeps the bevel’s inner contours as round as the corners, however wide the bevel. Off, they sharpen into mitre lines from each corner once the bevel is deeper than the rounding'
		}),
		P.float('grout_level', 'Grout level', 0.2, 0, 1, {
			step: 0.001,
			hint: 'Raises the grout bed, as a share of the tiles’ height (Height › Pattern only): 0 leaves the joints at the surface below, higher fills them with a level, slightly lumpy bed. When it’s on, Height skips Shaping › Value'
		}),
		P.float('size_jitter', 'Size variation', 0, 0, 128, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			section: 'Irregularity',
			hint: 'Moves each side of each tile in or out by a random amount (up to half this either way; the average joint stays the same and never closes below a pixel), for irregular hexagons and uneven grout. Add Position jitter and Rotation variation for hand-set tiles'
		}),
		P.float('pos_jitter', 'Position jitter', 0, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			section: 'Irregularity',
			hint: 'Shifts each tile by a random amount within its place; a tile that would need more room than the grout gives gets shrunk to fit'
		}),
		P.float('rot_jitter', 'Rotation variation', 0, 0, 30, {
			softMax: 10,
			unit: '°',
			step: 0.1,
			section: 'Irregularity',
			hint: 'Turns each tile by a random angle; a tile whose corners would need more room than the grout gives gets shrunk to fit'
		}),
		P.float('wobble', 'Wobble', 0, 0, 32, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			section: 'Irregularity',
			hint: 'Makes the tile sides uneven, like handmade or worn tiles. It fades out towards the corners so they stay sharp (Shaping › Domain warp bends the whole grid instead)'
		}),
		P.float('chips', 'Chipped corners', 0.3, 0, 1, {
			step: 0.001,
			section: 'Relief',
			hint: 'How many corners break out of each tile, leaving ragged hollows in its height that are deepest at the corner (the outline stays)'
		}),
		P.float('chip_size', 'Chip size', 0.25, 0, 1, {
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.chips) > 0,
			hint: 'Sets the radius of the largest chips, as a share of the tile’s radius (centre to corner; each chip varies down to about a third of it)'
		}),
		P.float('chip_depth', 'Chip depth', 0.7, 0, 1, {
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.chips) > 0,
			hint: 'How deep the chips break in, as a share of the tile’s height'
		}),
		P.float('chip_break', 'Broken outline', 0.5, 0, 1, {
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.chips) > 0,
			hint: 'How much of each chip breaks right through, notching the tile’s outline down to the grout (0 = the outline stays, the chips only dent the face)'
		}),
		P.float('chip_dust', 'Chip dust', 0.2, 0, 1, {
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.chips) > 0,
			hint: 'Makes the chips’ broken floors paler, like a freshly broken face, so the chips show in colour as well as in relief. With Diffuse › Source Random, it moves them this far towards the light end of the gradient ramp (where a chip breaks through, the grout shows anyway)'
		}),
		...faceParams('tile'),
		P.seed()
	],
	// Tiles added in the editor: a short bevel sized to the tiles; the strong crown (a default) domes the face on from
	// it, so there is no flat plateau framed by the bevel's inner contour.
	fresh: ({ width }) => ({ bevel: r1(clamp((width / 6) * 0.06, 1, 64)) }),
	defaults: {
		face: 0.2,
		crown: 1.2,
		face_tilt: 0.25,
		h_var: 0.25,
		h_on: true,
		h_amount: 0.5,
		bevel: 2,
		profile: 'smooth',
		dif_on: true,
		dif_src: 'random',
		dif_grad: gradient('#3a4148', '#56606a', '#6f6a5e', '#8b8170')
	},
	glsl:
		PAT_CELL_GLSL +
		PAT_RELIEF_GLSL +
		PAT_CHIP_GLSL +
		/* glsl */ `
// The neighbours whose bisectors can be among a tile's PAT_K nearest edges, by class: (rows off, half cells along),
// each with its mirror images — 0, 1 the six neighbours; 2 the next centres off its corners beside them (a row off, 1.5
// cells along); 3 two rows off straight across; 4 two cells along; 5 two rows off, a cell along; 6 three rows off; 7
// three cells along.
const ivec2 PAT_HEX_CLS[8] = ivec2[8](ivec2(0, 2), ivec2(1, 1), ivec2(1, 3), ivec2(2, 0), ivec2(0, 4), ivec2(2, 2), ivec2(3, 1), ivec2(0, 6));
// The classes that can hold a PAT_K place somewhere in a tile, as bits, by the lattice's stretch q (row spacing / cell
// width; regular: √3/2 ≈ 0.866), found by sampling the cell over q 0.3 … 3.4, with a margin: the corner centres from
// q 0.46, two rows across up to 1.22, three rows below 0.54, three cells along above 2.17. Two cells along (above q
// 0.866) and two rows a cell along (below it) only tie there — a regular lattice (the untiled one) needs neither — but
// the joints' jitter moves the edges, so then both are in round it. (Exact for q 0.3 … 3.4: a lattice squashed further
// reaches past these.)
int pat_hexNeed(float q, bool jit) {
  return 3 | (q > 0.45 ? 4 : 0) | (q < 1.25 ? 8 : 0) | (q > (jit ? 0.8 : 0.8669) ? 16 : 0)
       | (q < (jit ? 0.93 : 0.8652) ? 32 : 0) | (q < 0.56 ? 64 : 0) | (q > 2.12 ? 128 : 0);
}

// Lattice centre of tile (c, r) in the working frame: rows run along x, odd rows shift half a cell.
vec2 pat_hexCentre(int c, int r, vec2 cs) {
  return vec2((float(c) + 0.5 + 0.5 * float(r & 1)) * cs.x, (float(r) + 0.5) * cs.y);
}

GenOut gen(vec2 p) {
  // Work in a frame where the hexes are pointy-topped; flat-top swaps the axes.
  bool flatTop = u_orient == 1;
  vec2 res = flatTop ? uRes.yx : uRes;
  vec2 q = flatTop ? p.yx : p;
  // The frame's axes on screen (the flat-top swap, Shaping › Domain warp), for Bevel aspect.
  vec2 jx = dFdx(q), jy = dFdy(q);
  bool asp = bevelAspectOn();
  const float S = 0.8660254;   // row spacing / cell width for regular hexes
  vec2 n;
  if (!flatTop) { n.x = u_scale; n.y = res.y * u_scale / (res.x * S); }
  else { n.y = u_scale; n.x = res.x * S * u_scale / res.y; }
  if (uTile) {
    // Whole counts with an even row count (odd rows are offset). Among nearby choices keep the hexes as
    // regular as possible, with a small penalty for straying from the requested scale.
    float bestCost = 1e9;
    vec2 bn = vec2(1.0, 2.0);
    for (int i = -2; i <= 2; i++) {
      // Primary count = hexes across the width: columns (pointy) or rows of the frame (flat, must be even).
      float pc = flatTop ? 2.0 * floor(u_scale * 0.5 + 0.5) + 2.0 * float(i) : floor(u_scale + 0.5) + float(i);
      for (int k = 0; k < 2 && pc >= (flatTop ? 2.0 : 1.0); k++) {
        vec2 c;
        if (!flatTop) {
          float ideal = res.y * pc / (res.x * S);
          c = vec2(pc, max(2.0, 2.0 * floor(ideal * 0.5) + 2.0 * float(k)));
        } else {
          float ideal = res.x * S * pc / res.y;
          c = vec2(max(1.0, floor(ideal) + float(k)), pc);
        }
        float ratio = (res.y / c.y) / (res.x / c.x) / S;
        float cost = abs(log(ratio)) + 0.5 * abs(log(pc / max(u_scale, 0.5)));
        if (cost < bestCost) { bestCost = cost; bn = c; }
      }
    }
    n = bn;
  }
  vec2 cs = res / n;
  ivec2 per = ivec2(n + 0.5);

  // Nearest lattice centre.
  int r0 = int(floor(q.y / cs.y));
  float bd = 1e9;
  ivec2 bc = ivec2(0);
  vec2 br = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    int r = r0 + j;
    int c0 = int(floor(q.x / cs.x - 0.5 * float(r & 1)));
    for (int i = -1; i <= 1; i++) {
      vec2 rv = pat_hexCentre(c0 + i, r, cs) - q;
      float d = dot(rv, rv);
      if (d < bd) { bd = d; bc = ivec2(c0 + i, r); br = rv; }
    }
  }
  // Tile edges are the bisectors with the neighbouring centres, inset by half the gap — and, with Size variation, each
  // side by its own random amount (an irregular hexagon, not one shrunk about its centre).
  ivec2 id = wrapCell(bc, per);
  float ms[PAT_K];
  vec2 ns[PAT_K];
  for (int i = 0; i < PAT_K; i++) { ms[i] = 1e9; ns[i] = vec2(0.0); }
  // Not just the six neighbours: a farther centre's bisector can come nearer than a side at a corner and hold one of the
  // PAT_K places there — which ones, by the lattice's stretch (PAT_HEX_CLS, pat_hexNeed). The classes needed, packed in
  // order 3 bits each, and how many neighbours they hold; then one flat loop over those neighbours alone.
  int need = pat_hexNeed(cs.y / cs.x, u_size_jitter > 0.0);
  int order = 0, nCls = 0, nNb = 0;
  for (int c = 0; c < 8 * UNI_1; c++) {
    if (((need >> c) & 1) != 0) {
      order |= c << (3 * nCls);
      nCls++;
      nNb += PAT_HEX_CLS[c].x == 0 || PAT_HEX_CLS[c].y == 0 ? 2 : 4;
    }
  }
  int ci = 0, k = 0;
  for (int t = 0; t < 24 * UNI_1; t++) {
    if (t >= nNb) break;
    // Neighbour k of class ci: its mirror images by k's bits (one axis off: by the low bit), rows up or down, half cells
    // along either way; the rows of odd offset sit half a cell along.
    ivec2 cl = PAT_HEX_CLS[(order >> (3 * ci)) & 7];
    int sa = (k & 1) != 0 ? -1 : 1, sb = (k & 2) != 0 ? -1 : 1;
    int j = cl.x * (cl.y == 0 ? sa : sb), dx2 = cl.y * sa;
    int i = (dx2 - ((j & 1) == 0 ? 0 : (bc.y & 1) == 0 ? 1 : -1)) / 2;
    k++;
    if (k == (cl.x == 0 || cl.y == 0 ? 2 : 4)) { k = 0; ci++; }
    vec2 rv = pat_hexCentre(bc.x + i, bc.y + j, cs) - q;
    vec2 nn = normalize(rv - br);
    // In or out by up to half the jitter (the mean joint stays), never closing the joint below a pixel.
    float sj = u_size_jitter > 0.0 ? max(u_size_jitter * (hashI(ivec2(id.x * 7 + i + 3, id.y * 7 + j + 3), uSeed + 41.0) - 0.5), 0.5 - 0.5 * u_gap) : 0.0;
    pat_pushEdge(ms, ns, dot(0.5 * (br + rv), nn) - 0.5 * u_gap - sj, nn);
  }
  // The tile's corner radius (centre to corner, inside the grout).
  float Rt = (cs.x - u_gap) * 0.57735;
  float rot = 0.0;
  vec2 off = vec2(0.0);
  if (u_rot_jitter > 0.0 || u_pos_jitter > 0.0) {
    // Hand-set: turned and shifted in its place; the sides that would reach past it give way (pat_moveCell).
    vec3 hj = hash3I(id, uSeed + 71.0);
    rot = (hj.x - 0.5) * 2.0 * radians(u_rot_jitter);
    off = (hj.yz - 0.5) * 2.0 * u_pos_jitter;
    pat_moveCell(ms, ns, br, rot, off, 0.5 * u_gap);
  }
  // Bumps about a third of a tile for the wobble (fading out towards the corners, so they stay corners), the chips'
  // ragged cuts and the grout bed.
  float nz = u_wobble > 0.0 || u_chips > 0.0 || u_grout_level > 0.0 ? pat_noise(q, res, 0.3 * cs.x, 3, uSeed + 57.0) : 0.5;
  float extra = (nz - 0.5) * 4.0 * u_wobble * smoothstep(0.1 * Rt, 0.45 * Rt, ms[1]);
  float d = pat_cellSdf(ms, ns, u_round) + extra;
  // Round bevel corners: the bevel measured so its inner contours keep the corners' rounding.
  // Bevel aspect: the distance in the space the aspect stretches, its edges moved by the wobble and its corners rounded
  // by what the wobble leaves of the rounding (as the distance's own corners are).
  if (asp) pat_bd = pat_cellBevel(ms, ns, jx, jy, max(u_round - extra, 0.0), d, u_round_bevel && u_round > 0.0, extra);
  else if (u_round_bevel && u_round > 0.0) pat_setBevelDist(extra - pat_roundDepth(ms, ns, u_round));
  vec2 qc = -br - off;   // the pixel from the tile's centre
  float hv = 1.0;
  if (PAT_FACED) {
    float kc = 0.5 * Rt;
    hv = pat_face(q, res, 0.35 * cs.x, qc, 0.5 * cs, id, smin(smin(ms[0], ms[1], kc), ms[2], kc) - extra, 0.866 * Rt);
  }
  if (u_chips > 0.0) {
    // Chips: angular pieces broken off the tile's corners (turned with it) — the piece beyond a kinked cut between
    // the corner's two sides (pat_notch), a hollow in the height round it, and with Broken outline cut away.
    float k = 0.0;
    float brk = -1e9;
    vec2 cA = vec2(0.0), cK = vec2(0.0), cB = vec2(0.0), cRef = vec2(0.0);   // the piece broken out furthest (Bevel aspect)
    float cOff = 0.0;
    // One corner of each tile (its own pick) chips most often; the others a third as often.
    int cm = int(hashI(id, uSeed + 107.0) * 6.0);
    for (int c = 0; c < 6 * UNI_1; c++) {
      vec4 h = vec4(hash3I(id, uSeed + 101.0 + float(c)), hashI(id, uSeed + 131.0 + float(c)));
      if (h.x < (c == cm ? min(1.0, 2.5 * u_chips) : 0.35 * u_chips)) {
        // Sizes spread widely: many small chips, now and then a big one.
        float r = max(u_chip_size * Rt * (0.2 + 0.8 * h.y * h.y), 0.5);
        float th = 0.5235988 + float(c) * 1.0471976 + rot;
        vec2 V = Rt * vec2(cos(th), sin(th));
        vec2 t1 = normalize(Rt * vec2(cos(th - 1.0471976), sin(th - 1.0471976)) - V);
        vec2 t2 = normalize(Rt * vec2(cos(th + 1.0471976), sin(th + 1.0471976)) - V);
        float aa = r * (0.6 + 0.8 * h.z), bb = r * (0.6 + 0.8 * h.w);
        float ka = 0.5 + 0.4 * fract(h.y * 5.17), kb = 0.5 + 0.4 * fract(h.z * 3.71);
        vec2 A = V + aa * t1, K = V + ka * aa * t1 + kb * bb * t2, B = V + bb * t2;
        float en = (nz - 0.5) * 0.3 * r;
        float e = pat_notch(qc, A, K, B, 1.1 * V) + en;
        k = max(k, pat_chipK(e + r, r));
        float o = -(1.0 - u_chip_break) * 0.5 * r;
        // With a raised grout bed, the part of the hollow the bed would fill is broken out of the outline too, so the
        // colour shows the chip where the height does (chipK passes (1 − level) / depth at e = (that − 1.4) r).
        if (u_grout_level > 0.0) o = max(o, -max(((1.0 - u_grout_level) / max(u_chip_depth, 0.05) - 1.4) * r, -0.3 * r));
        if (e + o > brk) { brk = e + o; cA = A; cK = K; cB = B; cRef = 1.1 * V; cOff = en + o; }
      }
    }
    hv *= pat_chipsDone(k, q, res, 0.1 * cs.x);
    if (u_chip_break > 0.0 || u_grout_level > 0.0) {
      d = max(d, brk);
      // Bevel aspect: the broken piece's cuts as planes in the stretched space.
      if (asp && brk > -1e8) pat_bd = max(pat_bd, pat_notchS(qc, cA, cK, cB, cRef, cOff, mat2(jx.x, jy.x, jx.y, jy.y)));
    }
  }
  return pat_finish(hashI(id, uSeed), d, hv, PAT_FACED || u_chips > 0.0, u_grout_level, nz);
}
`
};

// ------------------------------------------------------------------------------------------------ voronoi

const cellsOut = (p: Record<string, unknown>) => (p.output ?? 'cells') === 'cells';

// The shader's Voronoi cell points (glsl/noise.ts cellPoint), replicated on the CPU with its hashes (core/hash.ts) so
// the cells to merge can be decided once per cell (Smallest cell).
function cellPointCpu(x: number, y: number, seed: number, phase: number): [number, number] {
	const p = hash2I(x, y, seed);
	if (phase === 0) return p;
	const anim = (v: number, s: number) => {
		const dir = hashI(x, y, Math.fround(Math.fround(s) + 7.31)) < 0.5 ? -1 : 1;
		const m = v + 2 * dir * phase;
		return 1 - Math.abs(1 - (m - 2 * Math.floor(m / 2)));
	};
	return [anim(p[0], seed + 41), anim(p[1], seed + 43)];
}
const imodJs = (a: number, m: number) => ((a % m) + m) % m;

/**
 * Voronoi's per-cell data (t_cells, R = 255: merged away): with Smallest cell, a cell whose nearest edge comes closer
 * to its site than that (the same power-diagram edges as the shader, from its 5 × 5 neighbours) is left out of the
 * diagram, so its neighbours fill its place — decided once per cell, so every pixel agrees.
 */
function voronoiCells(
	q: Record<string, unknown>,
	ctx: { width: number; height: number; tileable: boolean; seed: number }
) {
	const blank = { cells: { width: 1, height: 1, data: new Uint8Array(4) } };
	const minCell = Number(q.min_cell ?? 0);
	if (!(minCell > 0) || (q.output ?? 'cells') !== 'cells' || q.metric !== 'euclidean') return blank;
	const W = ctx.width,
		H = ctx.height;
	const scale = Number(q.scale ?? 6);
	let cx = scale,
		cy = (scale * H) / W;
	if (ctx.tileable) {
		cx = Math.max(1, Math.floor(cx + 0.5));
		cy = Math.max(1, Math.floor(cy + 0.5));
	} else {
		cx = Math.max(cx, 1e-3);
		cy = Math.max(cy, 1e-3);
	}
	const csx = W / cx,
		csy = H / cy;
	const L = Math.sqrt(csx * csy);
	const jitter = Number(q.jitter ?? 0.8);
	const W2 = Math.max(0, Number(q.size_var ?? 0)) * L * L;
	const g = 0.5 * Number(q.gap ?? 2);
	const phase = Number(q.phase ?? 0);
	const per = ctx.tileable ? [cx, cy] : [1 << 20, 1 << 20];
	const M = ctx.tileable ? 0 : 3 + Math.ceil(Number(q.warp ?? 0) / Math.min(csx, csy));
	const nx = ctx.tileable ? cx : Math.ceil(cx) + 2 * M,
		ny = ctx.tileable ? cy : Math.ceil(cy) + 2 * M;
	if (nx * ny > 1 << 20) return blank;
	// Every site the cells' 5 × 5 neighbourhoods reach, once: (x, y, power weight), over the cells and 2 more each side.
	const sw = nx + 4,
		sites = new Float64Array(sw * (ny + 4) * 3);
	for (let j = 0; j < ny + 4; j++)
		for (let i = 0; i < sw; i++) {
			const x = i - M - 2,
				y = j - M - 2;
			const cp = cellPointCpu(imodJs(x, per[0]), imodJs(y, per[1]), ctx.seed, phase);
			const o = (j * sw + i) * 3;
			sites[o] = (x + 0.5 + (cp[0] - 0.5) * jitter) * csx;
			sites[o + 1] = (y + 0.5 + (cp[1] - 0.5) * jitter) * csy;
			sites[o + 2] = W2 * (cp[0] * 7.13 + cp[1] * 3.71 - Math.floor(cp[0] * 7.13 + cp[1] * 3.71));
		}
	const sizeJitter = Number(q.size_jitter ?? 0);
	const sjSeed = Math.fround(Math.fround(ctx.seed) + 41);
	const data = new Uint8Array(nx * ny * 4);
	for (let j = 0; j < ny; j++)
		for (let i = 0; i < nx; i++) {
			const a = ((j + 2) * sw + i + 2) * 3;
			let hmin = Infinity;
			for (let dj = -2; dj <= 2; dj++)
				for (let di = -2; di <= 2; di++) {
					if (di === 0 && dj === 0) continue;
					const b = a + (dj * sw + di) * 3;
					const dl = Math.hypot(sites[b] - sites[a], sites[b + 1] - sites[a + 1]);
					if (dl > 1e-6) hmin = Math.min(hmin, 0.5 * dl + (0.5 * (sites[a + 2] - sites[b + 2])) / dl - g);
				}
			// Joint variation shrinks the cell by its own random share (the shader's hashI(cell, seed + 41)) — count that too.
			const sj = sizeJitter > 0 ? sizeJitter * hashI(imodJs(i - M, per[0]), imodJs(j - M, per[1]), sjSeed) : 0;
			if (hmin - sj < minCell) data[(j * nx + i) * 4] = 255;
		}
	return { cells: { width: nx, height: ny, data } };
}

export const voronoiLayer: LayerDef = {
	type: 'voronoi',
	noise: true,
	label: 'Voronoi',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Voronoi: A cellular pattern, either as bevelled cells or as F1 / F2 / edge / crackle / facet values. Makes cobbles, flagstones, cracked mud, chipped stone.',
	params: [
		P.enum(
			'output',
			'Output',
			'cells',
			[
				['cells', 'Cells (shape)'],
				['f1', 'F1 (distance to point)'],
				['f2', 'F2'],
				['edges', 'Edges (F2 − F1)'],
				['crackle', 'Crackle'],
				['facets', 'Facets (tilted planes)']
			],
			{
				hint: 'Picks what the layer draws. Cells is a shape (bevelled by the Shape params); the others are plain values. Facets turns each cell into a flat plane tilted a random way, and with height Min it makes broad faceted cuts (chipped stone edges)'
			}
		),
		P.float('tilt', 'Facet tilt', 1, 0, 8, {
			softMax: 3,
			step: 0.01,
			showIf: (p) => p.output === 'facets',
			hint: 'Sets how steep each plane is (how much the value changes across one cell)'
		}),
		P.float('facet_soft', 'Facet edge width', 3, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			showIf: (p) => p.output === 'facets' && p.facet_fit === true,
			hint: 'Sets the width of the chamfer where two soft facets meet: a few px for crisp cut stone, more for worn, rounded ridges'
		}),
		P.bool('facet_fit', 'Soft facets', true, {
			showIf: (p) => p.output === 'facets',
			hint: 'Keeps every plane in range (its slope capped, no clipped plateaus) and turns the cliff where two facets meet into a short slope, so you get a faceted surface instead of a stack of cut-outs'
		}),
		P.float('scale', 'Cells across', 6, 0.25, 256, {
			softMax: 32,
			step: 0.01,
			hint: 'How many cells fit across the texture width (rounded when tiling)'
		}),
		P.float('jitter', 'Jitter', 0.8, 0, 1, {
			step: 0.001,
			hint: 'Moves each cell’s point randomly away from a grid (0 = regular grid)'
		}),
		P.enum('metric', 'Metric', 'euclidean', [
			['euclidean', 'Euclidean'],
			['manhattan', 'Manhattan'],
			['chebyshev', 'Chebyshev']
		]),
		P.float('gap', 'Gap', 2, 0, 256, {
			softMax: 24,
			unit: 'px',
			step: 0.1,
			showIf: (p) => p.output === 'cells' || p.output === 'crackle',
			hint: 'Sets the grout width (Cells) or how wide the cracks fade out (Crackle)'
		}),
		P.float('crack_var', 'Crack variation', 0.6, 0, 1, {
			step: 0.001,
			showIf: (p) => p.output === 'crackle',
			hint: 'Gives each crack a random width and depth that also wander along it (1 = from hairlines to the full Gap), and makes the cracks V-shaped'
		}),
		P.float('crack_scale', 'Crack swell length', 0.6, 0.1, 8, {
			softMax: 4,
			step: 0.01,
			showIf: (p) => p.output === 'crackle' && Number(p.crack_var) > 0,
			hint: 'How long the swells and narrows of the cracks are, in cells (small = each crack varies along its length, large = whole regions of hairlines and of wide cracks)'
		}),
		P.float('crack_tone', 'Crack darkness', 0.7, 0, 1, {
			step: 0.001,
			showIf: (p) => p.output === 'crackle',
			hint: 'Darkens the cracks in Diffuse by their depth (with Source › Random: towards the dark end of the gradient ramp), so they read as dark gaps'
		}),
		P.float('round', 'Corner rounding', 4, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			showIf: (p) => p.output === 'cells' && p.metric === 'euclidean'
		}),
		P.float('min_cell', 'Smallest cell', 0, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			showIf: (p) => cellsOut(p) && p.metric === 'euclidean',
			hint: 'Merges away cells whose nearest edge comes closer to their middle than this, letting their neighbours fill the space, so there are no pebbles in the joints or needle slivers (0 = keep every cell)'
		}),
		P.float('min_bevel', 'Smallest bevel', 0.5, 0, 1, {
			step: 0.001,
			showIf: (p) => cellsOut(p) && p.metric === 'euclidean',
			hint: 'Gives cells too small for the bevel a narrower one, scaled with their size down to this share of the Bevel, so small stones still dome up (1 = every cell gets the same bevel)'
		}),
		P.bool('round_bevel', 'Round bevel corners', true, {
			showIf: (p) => p.output === 'cells' && p.metric === 'euclidean' && Number(p.round) > 0,
			hint: 'Keeps the bevel’s inner contours as round as the corners, however wide the bevel. Off, they sharpen into mitre lines from each corner once the bevel is deeper than the rounding'
		}),
		P.float('warp', 'Warp', 0, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.05,
			hint: 'Pushes the cells around with noise, for irregular cell borders'
		}),
		P.float('warp_scale', 'Warp scale', 8, 0.25, 128, { softMax: 32, step: 0.01, showIf: (p) => Number(p.warp) > 0 }),
		P.float('grout_level', 'Grout level', 0.2, 0, 1, {
			step: 0.001,
			showIf: cellsOut,
			hint: 'Raises the bed between the cells, as a share of the cells’ height (Height › Pattern only): 0 leaves the joints at the surface below, higher fills them with a level, slightly lumpy bed. When it’s on, Height skips Shaping › Value'
		}),
		P.float('size_var', 'Cell size variation', 0.5, 0, 1, {
			step: 0.001,
			showIf: (p) => p.metric === 'euclidean' && p.output !== 'facets',
			section: 'Irregularity',
			hint: 'Lets some cells grow at their neighbours’ expense (the edges stay straight), for big stones among small ones instead of cells all about the same size'
		}),
		P.float('size_jitter', 'Joint variation', 0, 0, 128, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			showIf: cellsOut,
			section: 'Irregularity',
			hint: 'Shrinks each cell by a random amount up to this, for joints of uneven width and loosely laid stones'
		}),
		P.float('pos_jitter', 'Position jitter', 0, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			showIf: (p) => cellsOut(p) && p.metric === 'euclidean',
			section: 'Irregularity',
			hint: 'Shifts each cell by a random amount within its place; a cell that would need more room than its joint gives gets shrunk to fit'
		}),
		P.float('rot_jitter', 'Rotation variation', 2, 0, 30, {
			softMax: 10,
			unit: '°',
			step: 0.1,
			showIf: (p) => cellsOut(p) && p.metric === 'euclidean',
			section: 'Irregularity',
			hint: 'Turns each cell by a random angle; a cell whose corners would need more room than its joint gives gets shrunk to fit'
		}),
		...faceParams('cell').map((d) => ({ ...d, showIf: cellsOut })),
		P.seed()
	],
	sdfShowIf: cellsOut,
	textures: ['cells'],
	// Memoised by the params it reads: a colour or Height slider leaves the cells as they are.
	cpuData: memoReads(voronoiCells),
	// Crackle's lines are the high value: as Height they would stand up as ridges, so they cut in instead.
	linkedDefaults: (p) => ({ h_mode: p.output === 'crackle' ? 'subtract' : 'add' }),
	// Cells added in the editor: cobbles sized to the texture — bevel, gap, corner rounding, warp, size jitter and the
	// smallest cell in proportion to the cells.
	fresh: ({ width }) => {
		const cell = width / 6;
		return {
			bevel: r1(clamp(cell * 0.14, 1, 64)),
			gap: r1(clamp(cell * 0.03, 1, 16)),
			round: r1(clamp(cell * 0.08, 0, 32)),
			warp: r1(clamp(cell * 0.05, 0.5, 16)),
			size_jitter: r1(clamp(cell * 0.02, 0, 8)),
			min_cell: r1(clamp(cell * 0.08, 1, 32))
		};
	},
	defaults: {
		face: 0.35,
		crown: 0.3,
		face_tilt: 0.35,
		h_var: 0.3,
		h_on: true,
		h_amount: 0.5,
		bevel: 3,
		profile: 'round',
		dif_on: true,
		dif_src: 'random',
		dif_grad: gradient('#4a463f', '#6b655a', '#7f776a', '#958b7b')
	},
	glsl:
		PAT_CELL_GLSL +
		PAT_RELIEF_GLSL +
		/* glsl */ `
float pat_metric(vec2 r) {
  return u_metric == 1 ? abs(r.x) + abs(r.y) : u_metric == 2 ? max(abs(r.x), abs(r.y)) : length(r);
}
// A site's power-diagram weight share (0..1), hashed from its feature point (no second hash per cell).
float pat_weight(vec2 o) { return fract(o.x * 7.13 + o.y * 3.71); }

// Smallest cell: whether cell c was merged away (t_cells, from the CPU; tiling: indexed by the wrapped cell, else
// offset by the margin round the texture's cells).
bool pat_merged(ivec2 c, ivec2 per, vec2 cells) {
  if (u_min_cell <= 0.0) return false;
  ivec2 ts = textureSize(t_cells, 0);
  ivec2 i = uTile ? imod(c, per) : c + (ts - ivec2(ceil(cells))) / 2;
  if (any(lessThan(i, ivec2(0))) || any(greaterThanEqual(i, ts))) return false;
  return texelFetch(t_cells, i, 0).r > 0.5;
}

// Gradient of the (piecewise linear) Manhattan / Chebyshev metric.
vec2 pat_metricGrad(vec2 v) {
  if (u_metric == 1) return sign(v);
  return abs(v.x) > abs(v.y) ? vec2(sign(v.x), 0.0) : vec2(0.0, sign(v.y));
}

GenOut gen(vec2 p) {
  vec2 cells = cellsFor(u_scale, 1.0);
  ivec2 per = periodOf(cells);
  vec2 cs = uRes / cells;
  // The warped frame's axes on screen (Shaping › Domain warp, then Warp): Bevel aspect takes the cells' edges there.
  vec2 jx = dFdx(p), jy = dFdy(p);
  if (u_warp > 0.0) {
    vec2 wc = cellsFor(u_warp_scale, 1.0);
    ivec2 wper = periodOf(wc);
    // The Warp displacement (warpOffset) — with Bevel aspect also a pixel right and up, for the
    // warp's Jacobian (dFdx of the warped position is constant over each 2 × 2 quad on some GPUs, which steps the
    // bevel's width). One loop, so the noise compiles once.
    vec2 w[3] = vec2[3](vec2(0.0), vec2(0.0), vec2(0.0));
    int nw = bevelAspectOn() ? 3 : 1;
    for (int i = 0; i < 3 * UNI_1; i++) {
      if (i < nw) {
        vec2 wx = (p + (i == 1 ? vec2(1.0, 0.0) : i == 2 ? vec2(0.0, 1.0) : vec2(0.0))) / uRes * wc;
        w[i] = warpOffset(wx, wper, uSeed + 7.0) * 2.0 * u_warp;
      }
    }
    if (nw == 3) {
      mat2 Jw = mat2(1.0) + mat2(w[1] - w[0], w[2] - w[0]);
      jx = Jw * jx;
      jy = Jw * jy;
    }
    p += w[0];
  }
  // Feature points live in px space so distances (and the gap) are true pixels on any aspect ratio.
  ivec2 ip = ivec2(floor(p / cs));
  float L = sqrt(cs.x * cs.y);
  // Cell size variation: a power diagram — each site's squared weight w2 is taken off its squared distance.
  // (Not for Facets: their soft blend needs ordinary cells.)
  bool power = u_size_var > 0.0 && u_metric == 0 && u_output != 5;
  float W2 = u_size_var * L * L;
  float F1 = 1e9, F2 = 1e9, F3 = 1e9, F4 = 1e9;
  vec2 mr = vec2(0.0), mr2 = vec2(0.0), mr3 = vec2(0.0), mr4 = vec2(0.0);
  ivec2 mc = ip, mc2 = ip, mc3 = ip, mc4 = ip;
  float mw2 = 0.0;
  for (int t = 0; t < 25 * UNI_1; t++) {
    ivec2 c = ip + ivec2(t % 5 - 2, t / 5 - 2);
    vec2 cp = cellPoint(imod(c, per), uSeed);
    vec2 o = 0.5 + (cp - 0.5) * u_jitter;
    vec2 r = (vec2(c) + o) * cs - p;
    float w2 = power ? W2 * pat_weight(cp) : 0.0;
    float d = pat_merged(c, per, cells) ? 1e9 : power ? dot(r, r) - w2 : pat_metric(r);
    if (d < F1) { F4 = F3; mr4 = mr3; mc4 = mc3; F3 = F2; mr3 = mr2; mc3 = mc2; F2 = F1; mr2 = mr; mc2 = mc; F1 = d; mr = r; mc = c; mw2 = w2; }
    else if (d < F2) { F4 = F3; mr4 = mr3; mc4 = mc3; F3 = F2; mr3 = mr2; mc3 = mc2; F2 = d; mr2 = r; mc2 = c; }
    else if (d < F3) { F4 = F3; mr4 = mr3; mc4 = mc3; F3 = d; mr3 = r; mc3 = c; }
    else if (d < F4) { F4 = d; mr4 = r; mc4 = c; }
  }
  // The raw ordering values (distance, or power distance) for Soft facets' weights.
  vec3 RF = vec3(F1, F2, F3);
  if (power) { F1 = sqrt(max(F1 + mw2, 0.0)); F2 = sqrt(max(F2, 0.0)); }
  float rnd = hashI(imod(mc, per), uSeed + 17.0);

  if (u_output == 1) return genOut(clamp(F1 / L, 0.0, 1.0), 1.0, rnd, NO_SDF);
  if (u_output == 2) return genOut(clamp(F2 / L, 0.0, 1.0), 1.0, rnd, NO_SDF);
  if (u_output == 3) return genOut(clamp(2.0 * (F2 - F1) / L, 0.0, 1.0), 1.0, rnd, NO_SDF);
  if (u_output == 5) {
    // A plane through the cell's site, tilted in a random direction with a random share of the slope. Soft facets:
    // the slope capped so a plane stays in range across its cell (a knee catches the odd large one), and the three
    // nearest cells' planes blended by soft weights over a few px at their borders — a partition of unity, so the
    // surface is continuous through borders and junctions alike: crisp creases, no cliffs or pixel steps.
    float x = 0.0, ws = 0.0;
    float t2 = 1e9;   // px to the border with the second cell (colour anti-aliasing)
    // Soft facets' band. The four nearest cells' planes are blended (a fifth cell, when it takes over, is far from
    // every border the pixel is near, so its weight would be ~0): continuous through triple and quadruple junctions.
    float band = max(u_facet_soft, 0.5);
    vec4 RF4 = vec4(RF, F4);
    float vs = 0.0;   // the weighted per-feature variation
    float x2 = 0.0, rv2 = 0.0;   // the second cell's plane and random
    for (int i = 0; i < 4 * UNI_1; i++) {
      ivec2 cw = imod(i == 0 ? mc : i == 1 ? mc2 : i == 2 ? mc3 : mc4, per);
      vec2 rr = i == 0 ? mr : i == 1 ? mr2 : i == 2 ? mr3 : mr4;
      float a = hashI(cw, uSeed + 29.0) * 6.2831853;
      float k = u_tilt * (0.4 + 0.6 * hashI(cw, uSeed + 31.0));
      if (u_facet_fit) k = min(k, 0.6);
      float xi = dot(-rr, vec2(cos(a), sin(a))) / L * k;
      float ax = abs(xi);
      if (u_facet_fit && ax > 0.4) xi = sign(xi) * (0.4 + 0.1 * (1.0 - exp((0.4 - ax) / 0.1)));
      // Plain facets: the nearest cell's plane only. Soft: weights from how much nearer the nearest site is (in the
      // metric the cells use), over about a tenth of a cell.
      // t: how far (px) the pixel is from the border with that cell — exact for Euclidean (and power) cells: the
      // difference of (power) squared distances over twice the sites' separation.
      float Ri = RF4[i];
      // tw: the same over a fixed separation (a cell), so cells that swap places in the ordering (equal distances)
      // have equal weights there — the blend has no steps where the second, third or fourth nearest cell changes.
      float sep = max(length(rr - mr), 1e-3);
      float dq = u_metric != 0 ? 0.5 * (Ri - RF.x) : power ? Ri - RF.x : Ri * Ri - RF.x * RF.x;
      float t = u_metric != 0 ? dq : dq / (2.0 * sep);
      float tw = u_metric != 0 ? dq : dq / (2.0 * L);
      float rv = hashI(cw, uSeed + 17.0);
      if (i == 1) { t2 = t; x2 = xi; rv2 = rv; }
      // One band for every pair (a band that depended on the planes would change as the nearest cells change, and
      // step at triple junctions).
      float wi = i == 0 ? 1.0 : u_facet_fit && Ri < 1e8 ? exp(-tw / band) : 0.0;
      x += wi * xi;
      ws += wi;
      // Per-feature variation with the same weights, so it doesn't step at the soft borders either.
      vs += wi * (1.0 - u_h_var * featVar(rv));
    }
    // Plain facets: the planes meet in a 1 px anti-aliased step. Colour: the cell's random blends with the next
    // cell's over that pixel too (Diffuse › Random), so the boundaries are not stair-stepped.
    float aa = 0.5 * (1.0 - clamp(t2, 0.0, 1.0));
    // (Only the nearest plane was summed, ws = 1.) The second cell's plane, for the step's anti-aliasing.
    if (!u_facet_fit) x = mix(x, x2, aa);
    // Height › Per-feature variation is applied here (feat = 0), blended over the same pixel as the random: the
    // wrapper's hash of a blended random would scatter random heights along every boundary.
    float var = u_facet_fit ? vs / ws : mix(1.0 - u_h_var * featVar(rnd), 1.0 - u_h_var * featVar(rv2), aa);
    GenOut o = genOut(clamp(0.5 + x / ws, 0.0, 1.0) * var, 1.0, mix(rnd, rv2, aa), NO_SDF);
    o.feat = 0.0;
    return o;
  }

  // Cell edges (inset by half the gap): exact bisectors for Euclidean; the other metrics get a border
  // distance estimate and no corner rounding (their cells need not be convex).
  float g = 0.5 * u_gap;
  float ms[PAT_K];
  vec2 ns[PAT_K];
  for (int i = 0; i < PAT_K; i++) { ms[i] = 1e9; ns[i] = vec2(0.0); }
  // The two nearest edges: px to each and its normal (crackle: each edge its own width and depth, the same seen from both
  // cells).
  float me = 1e9, me2 = 1e9;
  vec2 en = vec2(0.0), en2 = vec2(0.0);
  // One loop over the neighbours for every metric (the neighbour's point computed once). hmin: how close the cell's
  // nearest edge comes to its site — the same for every pixel of the cell (only the two sites and their weights).
  float md = 1e9;
  float hmin = 1e9;
  for (int t = 0; t < 25 * UNI_1; t++) {
    ivec2 c = mc + ivec2(t % 5 - 2, t / 5 - 2);
    vec2 cp = cellPoint(imod(c, per), uSeed);
    vec2 o = 0.5 + (cp - 0.5) * u_jitter;
    vec2 r = (vec2(c) + o) * cs - p;
    vec2 dr = r - mr;
    // (Skips the cell itself: its site is where mr is.)
    if (t != 12 && dot(dr, dr) >= 1e-6 && !pat_merged(c, per, cells)) {
      if (u_metric == 0) {
        vec2 nn = normalize(dr);
        // A power diagram's bisector moves towards the lighter site by the weights' difference.
        float sh = power ? 0.5 * (mw2 - W2 * pat_weight(cp)) / length(dr) : 0.0;
        float m = dot(0.5 * (mr + r), nn) + sh - g;
        hmin = min(hmin, 0.5 * length(dr) + sh - g);
        if (m < me) { me2 = me; en2 = en; me = m; en = nn; }
        else if (m < me2) { me2 = m; en2 = nn; }
        pat_pushEdge(ms, ns, m, nn);
      } else {
        // Each bisector is the zero set of f = M(p - b) - M(p - a), which is piecewise linear: a Newton step along
        // its gradient, then f / |grad f| from there, measures the distance in px across a kink of the bisector too.
        // Where the two sites tie over an area (f flat at 0), there is no border.
        float fv = max(pat_metric(r) - F1, 0.0);
        vec2 gr = pat_metricGrad(-r) - pat_metricGrad(-mr);
        float gl = dot(gr, gr);
        float e = 1e4;
        if (gl > 0.25) {
          vec2 st = gr * (fv / gl);   // p − q: the step to the linear estimate of the border
          float fq = max(pat_metric(r + st) - pat_metric(mr + st), 0.0);
          float gq = length(pat_metricGrad(-r - st) - pat_metricGrad(-mr - st));
          e = length(st) + (gq > 0.5 ? fq / gq : 0.0);
        }
        // (en: towards the border, the estimate's step.)
        if (e < md) { md = e; en = gl > 0.25 ? -gr * inversesqrt(gl) : vec2(0.0); }
      }
    }
  }
  if (u_metric != 0) {
    ms[0] = md - g;
    me = ms[0];
  }
  // Smooth value noise (one octave, cheap to compile) for the cracks' width and the grout bed's lumps.
  vec2 fc = uRes / max(0.4 * L, 1.0);
  fc = snapCells(fc);
  ivec2 fper = periodOf(fc);
  float nz = u_output == 0 && u_grout_level > 0.0 ? valueNoise(p / uRes * fc, fper, uSeed + 53.0) : 0.5;
  if (u_output == 4) {
    // Width variation: each of the two nearest edges a crack whose width and depth wander with smooth noise read on
    // the crack's own line — one field over the whole network, so a crack swells and narrows along its length and runs
    // on through the junctions without steps (no per-edge values, no spindles). Where edges meet, the deeper wins.
    float v = 0.0;
    // Broken lips: the cracks' rims fray with a noise about twice the Gap across (each side its own), so the frayed
    // edge scales with the crack instead of speckling per pixel.
    vec2 lc = uRes / max(2.0 * u_gap, 2.0);
    lc = snapCells(lc);
    float lip = valueNoise(p / uRes * lc, periodOf(lc), uSeed + 59.0);
    vec2 wfc = uRes / max(u_crack_scale * L, 1.0);
    wfc = snapCells(wfc);
    ivec2 wper = periodOf(wfc);
    // (Other metrics: the nearest edge only.)
    int ne = u_metric == 0 ? 2 : 1;
    for (int i = 0; i < ne * UNI_1; i++) {
      float e = (i == 0 ? me : me2) + g;
      // The noise is read on the crack's own line (the pixel's foot on the bisector), so both sides of a crack get
      // the same width and depth.
      vec2 pc = p + (i == 0 ? en : en2) * e;
      // Long stretches: about a cell and a half per swell (width), half that for the depth.
      float wz = valueNoise(pc / uRes * wfc, wper, uSeed + 53.0);
      // Broken, not brushed: the width steps between a few levels along the crack (a quick change where the noise
      // crosses a level, straight-walled stretches between), instead of swelling smoothly into lenses.
      float zq = wz * 4.0;
      wz = (floor(zq) + smoothstep(0.35, 0.65, fract(zq))) / 4.0;
      e = sqrt(e * e + 1.0) - 1.0;
      float w = max(u_gap * (1.0 - u_crack_var * clamp(0.5 + 2.0 * (0.5 - wz), 0.0, 0.92)), 0.75);
      w *= 1.0 + 0.8 * u_crack_var * (lip - 0.5);
      // Depth: the wide stretches of a crack the deepest (crisp dark trenches), the hairlines may be shallower.
      // Depth wanders with the same field (the wide stretches the deepest), so junctions are as deep as their arms.
      float dep = 1.0 - 0.45 * u_crack_var * clamp(0.5 + 1.6 * (0.5 - wz), 0.0, 1.0);
      // A crisp crack: steep walls from a sharp rim (twice the V's slope there), easing into a narrow rounded bottom —
      // neither a soft V nor a flat-floored trench.
      float vi = 1.0 - clamp(e / w, 0.0, 1.0);
      float vw = 1.0 - (1.0 - vi) * (1.0 - vi);
      v = max(v, dep * vw);
    }
    // The cell's random stays its own (colour) — darkened by Crack darkness along the crack (towards 0, the ramp's
    // dark end); the crack's depth is not varied per cell (both sides must agree; feat = 0, so the random doesn't
    // reach the height).
    GenOut o = genOut(v, 1.0, rnd * (1.0 - u_crack_tone * clamp(1.5 * v, 0.0, 1.0)), NO_SDF);
    o.feat = 0.0;
    return o;
  }
  ivec2 id = imod(mc, per);
  if (u_metric == 0 && (u_rot_jitter > 0.0 || u_pos_jitter > 0.0)) {
    // Loosely laid: each cell turned about its site and shifted in its place; the sides that would reach past it
    // give way (pat_moveCell).
    vec3 hj = hash3I(id, uSeed + 71.0);
    pat_moveCell(ms, ns, mr, (hj.x - 0.5) * 2.0 * radians(u_rot_jitter), (hj.yz - 0.5) * 2.0 * u_pos_jitter, g);
  }
  float extra = u_size_jitter > 0.0 ? u_size_jitter * hashI(id, uSeed + 41.0) : 0.0;
  float d = pat_cellSdf(ms, ns, u_metric == 0 ? u_round : 0.0) + extra;
  // Round bevel corners: the bevel measured so its inner contours keep the corners' rounding. Smallest bevel: a cell
  // whose inradius (hmin, per cell) is under the bevel takes a bevel of 0.8 of it, down to that share of the Bevel —
  // the inside distance stretched to match — so it still rises to (nearly) the full height.
  bool rb = u_round_bevel && u_round > 0.0 && u_metric == 0;
  bool fs = u_min_bevel < 1.0 && u_metric == 0;
  float be = fs ? clamp(0.8 * (hmin - extra), u_min_bevel * u_bevel, u_bevel) : u_bevel;
  if (bevelAspectOn() && u_metric == 0) {
    // Bevel aspect: the distance in the space the aspect stretches (pat_cellBevel), its edges moved in by the size
    // jitter and its corners rounded by what that leaves of the rounding (as the distance's own corners are).
    float bd = pat_cellBevel(ms, ns, jx, jy, max(u_round - extra, 0.0), d, rb, extra);
    pat_bd = bd < 0.0 ? bd * u_bevel / max(be, 1e-3) : bd;
  } else if (rb || fs) {
    float bd = rb ? extra - pat_roundDepth(ms, ns, u_round) : d;
    pat_setBevelDist(bd < 0.0 ? bd * u_bevel / max(be, 1e-3) : bd);
  }
  float hv = 1.0;
  if (PAT_FACED) {
    float kc = 0.2 * L;
    hv = pat_face(p, uRes, 0.35 * L, -mr, 0.5 * cs, id, smin(smin(ms[0], ms[1], kc), ms[2], kc) - extra, 0.35 * L);
  }
  return pat_finish(rnd, d, hv, PAT_FACED, u_grout_level, nz);
}
`
};

// ------------------------------------------------------------------------------------------------ grid lines

export const gridLayer: LayerDef = {
	type: 'grid',
	label: 'Grid lines',
	category: 'pattern',
	kind: 'generator',
	area: true,
	sdf: true,
	description:
		'Grid lines: A grid of lines used as a shape, with a random value per panel. Makes panel seams, tile grout, etched guides.',
	params: [
		P.int('count_x', 'Columns', 4, 0, 512, {
			softMax: 32,
			hint: 'How many vertical lines run across the width (0 = none)'
		}),
		P.int('count_y', 'Rows', 4, 0, 512, {
			softMax: 32,
			hint: 'How many horizontal lines run down the height (0 = none)'
		}),
		P.float('width', 'Line width', 2, 0, 512, { softMax: 16, unit: 'px', step: 0.1 }),
		P.float('offset_x', 'Line shift X', 0, 0, 1, { step: 0.001, hint: 'Shifts the lines, as a fraction of a cell' }),
		P.float('offset_y', 'Line shift Y', 0, 0, 1, { step: 0.001 }),
		P.float('round', 'Corner rounding', 0, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			hint: 'Rounds the panels’ corners where the lines cross, like rounded tiles in their grout'
		}),
		P.bool('snap', 'Whole-pixel lines', true, {
			hint: 'Where the count doesn’t divide the texture, puts every line on whole pixels (the remainder spread over the panels), so all lines look equally heavy. Moved or varied lines always sit on whole pixels'
		}),
		P.float('jitter', 'Spacing variation', 0, 0, 1, {
			step: 0.001,
			section: 'Irregularity',
			hint: 'Moves the lines so the rows and columns get uneven widths (at 1, mostly from about 0.45 to 1.55 of a cell, never closer than two line widths plus the bevels), without neighbouring panels simply alternating narrow and wide. Moved lines sit on whole pixels. For staggered panels, use Bricks'
		}),
		P.float('width_var', 'Width variation', 0, 0, 1, {
			step: 0.001,
			section: 'Irregularity',
			hint: 'Gives each line a random width, from full down to (1 − this) × Line width, in whole pixels and at least 1; thin lines keep the full groove depth'
		}),
		P.seed()
	],
	// Lines added in the editor: grooves wide enough to read as grooves at this size, not ink lines.
	fresh: ({ width, height }) => {
		const w = Math.round(clamp(Math.min(width, height) / 96, 1, 8));
		return { width: w, bevel: r1(clamp(w * 0.35, 0.5, 4)) };
	},
	defaults: {
		h_on: true,
		h_mode: 'subtract',
		h_amount: 0.4,
		bevel: 1,
		profile: 'smooth',
		dif_on: true,
		dif_src: 'flat',
		dif_opacity: 0.7,
		dif_grad: gradient('#1d1b19')
	},
	glsl: /* glsl */ `
// Line k of an axis (0 = x, 1 = y) with m cells of cs px, the axis offset off (cells): where it starts (cells, jittered)
// and its width (px). Moved or varied lines start and end on whole pixels (so equal lines look equal), and at full
// jitter neighbouring lines stay at least 0.4 of a cell, two line widths plus the bevels and 2 px apart.
vec2 pat_line(int k, int axis, int m, float cs, float off) {
  if (u_jitter <= 0.0 && u_width_var <= 0.0) {
    // Whole-pixel lines: where the count doesn't divide the size, each line starts on the nearest whole pixel (the
    // remainder spread over the panels), so every line has the same weight.
    if (u_snap) return vec2(floor((float(k) + off) * cs + 0.5) / cs - off, u_width);
    return vec2(float(k), u_width);
  }
  vec2 h = hash2I(ivec2(wrapCell(k, m), axis), uSeed + 211.0);
  float h0 = hashI(ivec2(wrapCell(k - 1, m), axis), uSeed + 211.0);
  // Panel k spans 1 + ½ J (h(k+1) − h(k−1)) cells: up to ±0.75 at Jitter 1 (most within 0.45–1.55 cells), but never
  // closer than two line widths plus the bevels and 2 px.
  float J = min(1.5 * u_jitter, 2.0 * max(1.0 - (2.0 * u_width + 2.0 * u_bevel + 2.0) / cs, 0.0));
  // The shift averages this line's random with the previous line's, so neighbouring panels don't alternate narrow and
  // wide (independent shifts make a narrow strip beside every wide one: tartan).
  float x = floor((float(k) + 0.5 * (h.x + h0 - 1.0) * J + off) * cs + 0.5) / cs - off;
  return vec2(x, max(floor(u_width * (1.0 - u_width_var * h.y) + 0.5), min(u_width, 1.0)));
}

GenOut gen(vec2 p) {
  vec2 n = max(vec2(float(u_count_x), float(u_count_y)), vec2(1.0));
  ivec2 m = ivec2(n);
  vec2 cs = uRes / n;
  // Cell coordinates in user orientation (y down) so offsets read naturally. Each line starts at a cell
  // edge and runs width px right / down, so whole-pixel cells and widths land on pixel boundaries.
  vec2 ofs = vec2(u_offset_x, u_offset_y);
  vec2 u = vec2(p.x, uRes.y - p.y) / cs - ofs;
  ivec2 c = ivec2(floor(u));
  vec2 dl = vec2(1e9);
  vec2 wl = vec2(u_width);
  // Per axis: the nearest of the three lines around the pixel (and its width), and the cell it lies in between the
  // (moved) lines. One flat loop over both axes' lines (one copy of pat_line); lx: where each starts.
  vec3 lx[2];
  for (int t = 0; t < 6 * UNI_1; t++) {
    int a = t / 3, k = t % 3 - 1;
    vec2 L = pat_line(c[a] + k, a, m[a], cs[a], ofs[a]);
    float e = abs((u[a] - L.x) * cs[a] - 0.5 * L.y) - 0.5 * L.y;
    if (e < dl[a]) { dl[a] = e; wl[a] = L.y; }
    lx[a][k + 1] = L.x;
  }
  for (int a = 0; a < 2; a++) {
    if (u[a] < lx[a].y) c[a]--;
    else if (u[a] >= lx[a].z) c[a]++;
  }
  if (u_count_x == 0) dl.x = 1e9;
  if (u_count_y == 0) dl.y = 1e9;
  // Width variation: a line thinner than both its bevels gets a narrower one, at most 0.375 (w − 1) (and half a pixel):
  // every line reaches the full depth on at least its middle pixel, and the weight still grows with the width. Each
  // line's own profile, before the two directions are combined, so where lines cross the deeper one wins.
  if (u_width_var > 0.0) {
    vec2 sc = max(vec2(1.0), u_bevel / max(0.375 * (wl - 1.0), 0.5));
    dl = mix(dl, dl * sc, lessThan(dl, vec2(0.0)));
  }
  float d = min(dl.x, dl.y);
  // Rounded panel corners: inside a panel, its distance to a rounded box's corner.
  bool corner = u_round > 0.0 && dl.x < u_round && dl.y < u_round;
  if (corner) d = u_round - length(max(u_round - dl, 0.0));
  c = wrapCell(c, m);
  GenOut o = genOut(0.0, 1.0, hashI(c, uSeed), d);
  if (bevelAspectOn()) {
    // Bevel aspect: each line's distance in the space the aspect stretches (where lines cross, the deeper wins, as in
    // the distance), and at a rounded panel corner the distance to its arc there — an ellipse's quarter. Taken from the
    // direction of the distance instead, the width would step along the diagonals of every crossing.
    vec2 k = u_bevel / bevelWidths();
    o.bdist = min(dl.x * k.x, dl.y * k.y);
    if (corner) {
      float e = bevelEllipse(k * (u_round - dl), mat2(k.x, 0.0, 0.0, k.y), vec2(u_round));
      o.bdist = d < 0.0 ? -e : e;
    }
  }
  return o;
}
`
};

// ------------------------------------------------------------------------------------------------ stripes

const stripeShape = (p: Record<string, unknown>) => p.mode === 'shape' || p.mode === 'square';

/**
 * Stripes' uniform-only work (its derived uniforms): the stripe normal in cycles per px (k) — when tiling snapped to
 * whole cycles across each axis, which snaps the angle to the nearest seamless one — and how many stripes are told
 * apart then (g, the gcd of those cycles). In float32 steps, as the shader did.
 */
export function stripesDerived(p: ParamValues, c: LayerCanvas): { k: number[]; g: number } {
	const a = f32(f32(Number(p.angle)) * f32(Math.PI / 180));
	const n = f32(Number(p.count));
	const k = [f32(f32(-f32(Math.sin(a)) * n) / c.width), f32(f32(f32(Math.cos(a)) * n) / c.width)];
	if (!c.tileable) return { k, g: 1 };
	const cyc = [Math.floor(f32(f32(k[0] * c.width) + 0.5)), Math.floor(f32(f32(k[1] * c.height) + 0.5))];
	if (cyc[0] === 0 && cyc[1] === 0) cyc[1] = 1;
	return { k: [cyc[0] / c.width, cyc[1] / c.height], g: gcd(cyc[0], cyc[1]) };
}

export const stripesLayer: LayerDef = {
	type: 'stripes',
	label: 'Stripes',
	category: 'pattern',
	kind: 'generator',
	area: true,
	sdf: true,
	description:
		'Stripes: Parallel stripes at any angle, either as a shape or as a wave of values. Makes planks, ruled lines, barcodes, hazard stripes.',
	params: [
		P.enum(
			'mode',
			'Output',
			'shape',
			[
				['shape', 'Stripes (shape)'],
				['square', 'Soft square'],
				['sine', 'Sine'],
				['triangle', 'Triangle'],
				['saw', 'Sawtooth']
			],
			{
				hint: 'Picks what the layer draws: Stripes makes each stripe a shape you can bevel, the others are plain values across each period'
			}
		),
		P.float('count', 'Stripes across', 8, 0.25, 512, {
			uniform: false,
			softMax: 64,
			step: 0.01,
			hint: 'How many stripes fit across the texture width (period = width / count). When tiling, whole cycles must fit across both axes, so a slanted count is rounded with the angle (e.g. 12 at 45° gives 8 crossings per edge, about 11.3)'
		}),
		P.float('angle', 'Angle', 0, -360, 360, {
			uniform: false,
			softMin: -180,
			softMax: 180,
			unit: '°',
			step: 0.1,
			hint: 'Turns the stripes, clockwise from horizontal (snapped to the nearest seamless angle when tiling)'
		}),
		P.float('duty', 'Stripe width', 0.5, 0, 1, {
			step: 0.001,
			showIf: (p) => p.mode === 'shape' || p.mode === 'square',
			hint: 'How much of each period the stripe covers'
		}),
		P.float('soft', 'Edge softness', 3, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			showIf: (p) => p.mode === 'square' || p.mode === 'saw',
			hint: 'Softens the edges: on Soft square, how wide the soft edge is; on Sawtooth, the drop back to 0 takes this many px instead of one'
		}),
		P.enum(
			'soft_profile',
			'Softness profile',
			'smooth',
			[
				['linear', 'Linear'],
				['smooth', 'Smooth']
			],
			{
				showIf: (p) => p.mode === 'square' || p.mode === 'saw',
				hint: 'Picks how the softened edges change: Smooth eases them in and out, with no crease where a slope starts and stops'
			}
		),
		P.bool('fit_bevel', 'Fit the bevel', true, {
			showIf: (p) => p.mode === 'shape',
			hint: 'Keeps each stripe’s bevel to at most a third of its width (so narrow stripes stay planks with flat tops, not rods), and puts its half height at the stripe’s edge, where the colour stops, so 0.5 looks half and half. Height then skips Shaping › Value'
		}),
		P.float('offset', 'Phase', 0, 0, 1, { step: 0.001 }),
		P.float('width_var', 'Width variation', 0, 0, 1, {
			step: 0.001,
			section: 'Irregularity',
			showIf: stripeShape,
			hint: 'Gives each stripe a random width, from (1 − this) to (1 + this) × Stripe width, never thinner than a pixel plus its bevels and never closing the gap to the next'
		}),
		P.float('jitter', 'Spacing variation', 0, 0, 1, {
			step: 0.001,
			section: 'Irregularity',
			showIf: stripeShape,
			hint: 'Moves each stripe randomly within its period (at 1, up to a quarter period into its neighbours’, where they may merge), for uneven spacing: planks, ruled lines, barcodes'
		}),
		P.float('skip', 'Missing stripes', 0, 0, 1, {
			step: 0.001,
			section: 'Irregularity',
			showIf: stripeShape,
			hint: 'Leaves out stripes at random, for clusters and wide gaps (barcodes, sparse planks, worn markings)'
		}),
		P.seed()
	],
	sdfShowIf: (p) => p.mode === 'shape',
	// Diffuse: shape stripes are painted flat by their shape (the bevel only in Height, so no dark frame along every
	// edge); the waves by their value.
	linkedDefaults: (p) => ({ dif_src: p.mode === 'shape' ? 'shape' : 'value' }),
	// Stripes added in the editor: a bevel that rounds each stripe into a band at this size.
	fresh: ({ width }) => ({ bevel: r1(clamp((width / 8) * 0.5 * 0.25, 1, 32)) }),
	defaults: { h_on: true, h_amount: 0.4, bevel: 2, profile: 'smooth' },
	// Uniform-only work on the CPU (stripesDerived); the params only it reads are `uniform: false`.
	derivedUniforms: { decl: { k: 'vec2', g: 'int' }, compute: stripesDerived },
	glsl: /* glsl */ `
GenOut gen(vec2 p) {
  vec2 up = vec2(p.x, uRes.y - p.y);             // user space (y down)
  // Stripe normal (cycles per px; whole cycles across each axis when tiling) and the stripes told apart (stripesDerived).
  vec2 k = d_k;
  int g = d_g;
  float f = dot(up, k) - u_offset;
  float period = 1.0 / length(k);
  float fi = floor(f);
  int idx = int(fi);
  idx = wrapCell(idx, g);
  float rnd = hashI(ivec2(idx, 0), uSeed);
  // ph = 0 at a stripe's leading edge, which is a pixel boundary when the period is whole pixels. The stripe
  // covers ph in [0, duty).
  float ph = f - fi;
  float hc = 0.5 * u_duty;
  float d = (abs(fract(ph - hc + 0.5) - 0.5) - hc) * period;
  float wn = u_duty;   // the nearest stripe's width (share of the period)
  if (u_width_var > 0.0 || u_jitter > 0.0 || u_skip > 0.0) {
    // Stripe i covers [i + o, i + o + w) with its own width w and shift o (it stays inside its period), unless it is
    // skipped: the nearest of the three around the pixel. Widths stay between a pixel plus the bevels and the period
    // less that, unless Width itself is outside.
    // Thin stripes keep their full rounding: inside, the distance is stretched so the bevel spans the half width.
    float wmin = 1.5 / period;
    // The three stripes around the pixel as intervals [lo, hi) (phase units; a skipped one empty), each merged with an
    // overlapping neighbour into one span, so jittered stripes that run into each other make one flat plank.
    vec3 lo = vec3(1e9), hi = vec3(-1e9), rr = vec3(rnd);
    for (int i = 0; i < 3; i++) {
      int si = int(fi) + i - 1;
      int wi = wrapCell(si, g);
      vec4 h = vec4(hash3I(ivec2(wi, 5), uSeed + 211.0), hashI(ivec2(wi, 6), uSeed + 213.0));
      if (h.z >= u_skip) {
        float w = clamp(u_duty * (1.0 + u_width_var * (2.0 * h.x - 1.0)), min(u_duty, wmin), max(u_duty, 1.0 - wmin));
        // Within the period's slack, and up to a quarter period into the neighbours'.
        float o = u_jitter * (h.y * (1.0 - w) + 0.5 * (h.w - 0.5));
        lo[i] = float(si) + o;
        hi[i] = lo[i] + w;
        rr[i] = hashI(ivec2(wi, 0), uSeed);
      }
    }
    vec3 L = lo, H = hi;
    bool m01 = hi.x >= lo.y && lo.x < 1e8 && lo.y < 1e8;
    bool m12 = hi.y >= lo.z && lo.y < 1e8 && lo.z < 1e8;
    if (m01) { L.y = L.x; H.x = H.y; }
    if (m12) { L.z = L.y; H.y = H.z; }
    if (m01 && m12) H.x = H.z;
    d = period;
    for (int i = 0; i < 3; i++) {
      if (lo[i] < 1e8) {
        float di = (abs(f - 0.5 * (L[i] + H[i])) - 0.5 * (H[i] - L[i])) * period;
        if (di < d) { d = di; wn = H[i] - L[i]; rnd = rr[i]; }
      }
    }
    if (!u_fit_bevel && d < 0.0) d *= max(1.0, u_bevel / max(0.5 * (wn * period - 1.0), 0.5));
  }
  if (u_fit_bevel && u_mode == 0) {
    // Fit the bevel: at most a third of this stripe's width (inside, the distance is stretched to match), on the
    // stripe grown by half of it — Height reads that as a profile of its own (genOutHeight, reaching past the
    // coverage), while colour, coverage and the mask keep the stripe at its Width: the bevel's half height.
    float be = min(u_bevel, wn * period / 3.0);
    float dg = d - 0.5 * be;
    if (dg < 0.0) dg *= u_bevel / max(be, 1e-3);
    vec2 gg = vec2(dFdx(dg), dFdy(dg));
    return genOutHeight(0.0, 1.0, rnd, d, bevelAt(dg, gg) * coverage(dg, u_aa));
  }
  if (u_mode == 0) return genOut(0.0, 1.0, rnd, d);
  // Waves peak a quarter period in (the centre of a 50% stripe), so a 2 px period alternates per pixel.
  float w = ph - 0.25;
  float v;
  bool smoothSoft = u_soft_profile == 1;
  if (u_mode == 1) {
    v = clamp(0.5 - d / max(u_soft, 1.0), 0.0, 1.0);
    if (smoothSoft) v = v * v * (3.0 - 2.0 * v);
  }
  else if (u_mode == 2) v = 0.5 + 0.5 * cos(TAU * w);
  else if (u_mode == 3) v = 1.0 - 2.0 * abs(fract(w + 0.5) - 0.5);
  else {
    // Sawtooth: rises over the period, drops back over Softness px.
    float sw = clamp(u_soft / period, 0.0, 0.5);
    v = ph < 1.0 - sw ? ph / (1.0 - sw) : (1.0 - ph) / sw;
    if (smoothSoft && ph >= 1.0 - sw) v = v * v * (3.0 - 2.0 * v);
  }
  return genOut(v, 1.0, rnd, NO_SDF);
}
`
};

/** Pattern-category layers, in add-menu order. */
export const PATTERN_LAYERS: LayerDef[] = [
	bricksLayer,
	hexLayer,
	voronoiLayer,
	gridLayer,
	stripesLayer,
	gradientLayer,
	scratchesLayer
];
