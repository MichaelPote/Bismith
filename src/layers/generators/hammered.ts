// Hammered (FR7.7): hand-hammered metal — dents laid in courses (rings) around a few hammering centres. Each pixel
// belongs to one centre (a multiplicatively weighted Voronoi partition, so regions meet along interlocking *arcs*);
// within its region the dents sit on courses `ring` px apart — each wandering round its circle (Ring wobble) and set
// off on its own (Course variation) — as many per course as fit at `spacing`, with a random rotation per course and
// jitter. Each dent is a dish — 0 at its deepest point rising to 1 at its rim (Dent shape: higher = flatter floor,
// steeper wall) — with its own size, depth and tilt, lengthened along its course by Stretch, and an optional raised rim
// of displaced metal; the surface is the smooth maximum of the dents' depths (overlapping dents meet in creases, rounded
// by Crease softness). A dent belongs to the region its centre lies in, so dents cross region edges whole; Edge overlap
// lets them run on past it, thinning out. Height's Per-feature variation varies each dent's depth (hval).
// Writing the Shape Mask, the dents are discs (Shape mask size × their radius).

import { P, type ParamValues } from '@/core/params'
import type { LayerDef } from '../types'

/** Whether the dents' discs go to the Shape Mask or a named mask (else the layer leaves the shapes alone). */
const writesShape = (p: ParamValues) => p.sm_on === true || (p.mk_write ?? 'none') !== 'none'

/** Keys only layers from after the quality pass have (stored files keep every param). */
const NEW_KEYS = ['region_var', 'wobble', 'course_var', 'size_var', 'depth_var', 'tilt', 'stretch', 'crease', 'rim', 'overlap', 'mask_r']

/**
 * Files from before the quality pass gave Jitter in px; it is now a share of the spacing. (Only the unit is converted:
 * such layers take the current defaults for everything they lack.)
 */
function migrateHammered(p: ParamValues): ParamValues {
  if (typeof p.jitter !== 'number' || NEW_KEYS.some((k) => k in p)) return p
  const ring = typeof p.ring === 'number' ? p.ring : 24.4
  const spacing = typeof p.spacing === 'number' ? p.spacing : 20.2
  return { ...p, jitter: Math.round((1000 * p.jitter) / Math.max(0.5, Math.min(ring, spacing))) / 1000 }
}

export const hammeredLayer: LayerDef = {
  type: 'hammered',
  label: 'Hammered',
  category: 'pattern',
  kind: 'generator',
  description: 'Hand-hammered metal: overlapping dish dents in wandering courses round a few centres whose regions interlock along arcs.',
  params: [
    P.int('centres', 'Centres', 4, 1, 64, { softMax: 16, hint: 'Hammering centres; each owns a region of courses (rings) of dents' }),
    P.float('weight_var', 'Arc boundaries', 0.6, 0, 4, { softMax: 1.5, step: 0.001, hint: 'Weight variation between centres: 0 = straight region edges, higher = curved, interlocking arcs, and small regions become islands inside big ones' }),
    P.float('region_var', 'Region variation', 0.35, 0, 1, { step: 0.001, hint: 'Each region its own dent size, depth and shade (1 = from 0.7× to 1.4× the size), so the regions read as separate passes of the hammer' }),
    P.float('ring', 'Ring spacing', 24.4, 1, 512, { softMax: 64, unit: 'px', step: 0.05, hint: 'Distance between the courses (rings) of dents' }),
    P.float('spacing', 'Dent spacing', 20.2, 1, 512, { softMax: 64, unit: 'px', step: 0.05, hint: 'Distance between dents along a course' }),
    P.float('wobble', 'Ring wobble', 0.5, 0, 6, { softMax: 3, step: 0.001, hint: 'How far each course wanders from its circle, in ring spacings: 0 = perfect circles, higher = hand-guided, wavy courses that drift apart and together' }),
    P.float('course_var', 'Course variation', 0.4, 0, 2, { softMax: 1, step: 0.001, hint: 'Courses set in or out, changing gradually from course to course (1 = up to half a ring spacing): the gaps between them widen and narrow' }),
    P.float('jitter', 'Jitter', 0.1, 0, 4, { softMax: 0.5, step: 0.001, hint: 'Random offset of each dent, as a share of the spacing: 0 = strict rows, 0.1 keeps the courses readable, 0.4 scatters them' }),
    P.float('size', 'Dent size', 1.9, 0.1, 4, { softMin: 0.3, softMax: 2.5, step: 0.001, hint: 'Dent radius relative to half the spacing: below 1 = separate dimples on flat metal, 1 = touching, above = overlapping facets that cover the sheet' }),
    P.float('size_var', 'Size variation', 0.4, 0, 1, { step: 0.001, hint: 'Each dent its own size: 1 = from half to twice the radius' }),
    P.float('shape', 'Dent shape', 2.4, 0.5, 16, { softMin: 1, softMax: 10, step: 0.01, hint: '1 = cone, 2 = round dish, 2–3 = planished bowls, higher = flat-bottomed punch marks with steep walls and a raised burr of displaced metal round them (from about 5 they strike to much the same depth: Depth variation counts for a third) — set Dent size below 1 to leave metal between the punches; below 1: pointed pits' }),
    P.float('depth_var', 'Depth variation', 0.5, 0, 1, { step: 0.001, hint: 'Each dent its own depth, in colour and height: 1 = from full depth to barely touched (Height › Per-feature variation varies the height alone)' }),
    P.float('tilt', 'Tilt', 1, 0, 1, { step: 0.001, hint: 'Each dent’s deepest point moved towards one side, as from a blow struck at an angle: a long, gentle slope one way and a short, steep one the other, so the facets catch the light differently (floors stay level)' }),
    P.float('stretch', 'Stretch', 1.15, 0.2, 5, { softMin: 0.5, softMax: 3, step: 0.01, hint: 'Dents lengthened along their course (above 1, as a hammer drawn along it) or across it (below 1); the other way they keep their width' }),
    P.float('crease', 'Crease softness', 0.02, 0, 1, { step: 0.001, hint: 'Where overlapping dents meet: 0 = sharp creases, higher = rounded ridges (most of the change is in the first tenth)' }),
    P.float('rim', 'Rim', 0.1, 0, 1, { softMax: 0.5, step: 0.001, hint: 'A raised lip of displaced metal round each dent, as a share of its depth — it shows on untouched metal and on the ridges between dents' }),
    P.float('overlap', 'Edge overlap', 2, 0, 8, { softMax: 4, step: 0.01, hint: 'How far each region’s dents run on past its edge, in dent radii, thinning out over the band (sparse dents skip blows where the neighbour already struck): 0 = every region stops at its edge (seams and wedges of untouched metal where courses meet), higher = the passes mesh and hide the seams' }),
    P.float('mask_r', 'Shape mask size', 1, 0, 2, {
      step: 0.001,
      showIf: writesShape,
      hint: 'With Mask › Use shape mask (or a named-mask write): the shape is a disc per dent, this times its radius — 1 = the whole dent, lower = round its deepest point (its floor); large, overlapping dents still join up below about 0.5',
    }),
    P.seed(),
  ],
  // The dents as discs, for the Shape Mask (opt-in: a hammered sheet usually works inside a plate's shape) and named-mask
  // writes; the generator shapes its own value.
  sdf: 'mask',
  writesMask: (p) => p.sm_on === true,
  migrate: migrateHammered,
  defaults: {
    sm_on: false,
    h_on: true,
    h_amount: 1.4,
    dif_on: true,
    // A copper ramp that darkens the dents only a little.
    dif_grad: { stops: [{ pos: 0, color: '#985230' }, { pos: 1, color: '#aa673e' }] },
  },
  // Added in the editor: the courses sized to the texture — about 21 across, but on small textures fewer, larger dents
  // (5 courses across at 64 px, none closer than 14 px below 300 px) with fewer centres and deeper relief, so each dent
  // keeps a highlight and a shadow. At 512 px this is the plain default.
  fresh: ({ width, height }) => {
    const r1 = (v: number) => Math.round(v * 10) / 10
    const side = Math.sqrt(width * height)
    const u = Math.max(3, side / 21, Math.min(side / 5, 14))
    const small = Math.min(1, Math.max(0, (256 - side) / 192))
    return {
      ring: r1(u), spacing: r1(u * 0.83),
      centres: side >= 384 ? 4 : side >= 192 ? 3 : 2,
      // Small textures: sharp creases and flatter, steeper dents, so each keeps one lit and one dark edge in a few px.
      crease: Math.round(20 * (1 - small)) / 1000, shape: r1(2.4 + 0.8 * small),
      h_amount: r1(1.4 * Math.max(Math.pow(512 / side, 0.25), Math.sqrt(side / 512))),
    }
  },
  glsl: /* glsl */ `
vec2 hmCentre(int i) { return hash2I(ivec2(i, 3), uSeed) * uRes; }
// 1 / (1 + 2v·h): positive at any Arc boundaries v.
float hmWeight(int i) { return 1.0 / (1.0 + 2.0 * u_weight_var * hashI(ivec2(i, 5), uSeed)); }

// Distance from a point to the edge between two centres' regions {|x − A| / wA = |x − B| / wB} — an Apollonius circle,
// the bisector for equal weights; rA, rB = the point minus each centre. The point is on A's side.
float hmEdge(vec2 rA, float wA, vec2 rB, float wB) {
  float k2 = (wB / wA) * (wB / wA);
  return abs(1.0 - k2) < 1e-4 ? (dot(rB, rB) - dot(rA, rA)) / max(2.0 * length(rB - rA), 1e-6)
                              : abs(length((k2 * rA - rB) / (1.0 - k2)) - sqrt(k2) * length(rB - rA) / abs(1.0 - k2));
}

// The order the regions were hammered in: a later pass runs on over an earlier one's edge.
float hmRank(int i) { return hashI(ivec2(i, 6), uSeed); }

// How far a point "at" (c from a centre of weight w and index own) lies past that centre's region: 0 inside, else the
// largest distance past its edge with a centre nearer by distance / weight (each centre's nearest periodic image; jv =
// that centre) — 1e9 once that reaches "early" for a centre hammered earlier (or another copy of the same one), "late"
// for one hammered later (the same now; kept apart for a later pass that runs further). Inside, jv is the nearest region hammered earlier whose edge lies within "near" (else own).
float hmPast(vec2 at, vec2 c, float w, int own, float early, float late, float near, out int jv) {
  float s = length(c) / w * 0.9999;
  float r = hmRank(own);
  float past = 0.0;
  float inEdge = near;
  int jIn = own;
  jv = own;
  for (int i = 0; i < u_centres; i++) {
    vec2 d = wrapDelta(at - hmCentre(i));
    float wi = hmWeight(i);
    bool earlier = i != own && hmRank(i) < r;
    if (length(d) / wi < s) {
      float e = hmEdge(d, wi, c, w);
      if (e >= (i == own || earlier ? early : late)) return 1e9;
      if (e > past) { past = e; jv = i; }
    } else if (earlier && near > 0.0) {
      float e = hmEdge(c, w, d, wi);
      if (e < inEdge) { inEdge = e; jIn = i; }
    }
  }
  if (past <= 0.0) jv = jIn;
  return past;
}

// Ring wobble: how far course kf of a region sits out from its circle at angle a, in ring spacings (at most 1) — two
// low harmonics (the course's overall wander) and a ninth that the outer courses take on (from about 3 rings out), so
// far from the centre, where the courses are long and nearly straight, they still bend; all periodic round the circle,
// their phases drifting slowly from course to course, so neighbouring courses wander together instead of gaping.
float hmWobble(int own, float a, float kf) {
  vec2 h = hash2I(ivec2(own, 9), uSeed);
  float w = 0.0;
  // (A loop bound that isn't a constant: hmWobble is called in several places and D3D would unroll each.)
  for (int m = 1; m <= (uRes.x > 0.0 ? 3 : 0); m++) {
    float fm = m == 3 ? 9.0 : float(m);
    float amp = m == 1 ? 0.45 : m == 2 ? 0.25 : 0.3 * smoothstep(2.0, 8.0, kf);
    w += amp * sin(fm * a + TAU * fract(h.x * float(m) * 1.618) + kf * (fract(h.y * float(m) * 2.414) - 0.5) * 0.5);
  }
  return w;
}

// Course variation: how far course k of a region is set in or out, −0.5 … 0.5 ring spacings — smooth from course to
// course (value noise over every three), so the gaps between courses widen and narrow gradually — and how fast that
// changes per course (y, at most 0.5), by which a course standing further from its neighbours grows its dents.
vec2 hmCourse(int own, int k) {
  float x = float(k) / 3.0;
  float i0 = floor(x);
  float f = x - i0;
  float h0 = hashI(ivec2(own, int(i0) + 7000), uSeed + 13.0);
  float h1 = hashI(ivec2(own, int(i0) + 7001), uSeed + 13.0);
  return vec2(mix(h0, h1, f * f * (3.0 - 2.0 * f)) - 0.5, (h1 - h0) * 2.0 * f * (1.0 - f));
}

// Dent aa (counted from the one nearest angle th) of course k of region own — ring spacing ringW, dent spacing sp,
// jitter jit px: its centre (from the region's centre), angle a, id and course variation cv (hmCourse). valid is false
// for k < 0 and for repeats on a course with fewer dents than the search window.
vec2 hmDent(int own, int k, float th, int aa, float ringW, float sp, float jit, out float a, out ivec2 id, out vec2 cv, out bool valid) {
  cv = hmCourse(own, k);
  float rk = k <= 0 ? 0.0 : ringW * (float(k) + u_course_var * cv.x);
  float n = max(1.0, floor(TAU * rk / sp + 0.5));
  int ni = int(n);
  valid = k >= 0 && aa >= -((ni - 1) / 2) && aa <= ni / 2;
  float stepA = TAU / n;
  float off = hashI(ivec2(own, k), uSeed + 11.0) * stepA;
  float j = floor((th - off) / stepA + 0.5) + float(aa);
  a = off + j * stepA;
  id = ivec2(own * 4096 + k, int(mod(j, n)));
  return vec2(cos(a), sin(a)) * (rk + u_wobble * ringW * hmWobble(own, a, float(k))) + (hash2I(id, uSeed + 17.0) - 0.5) * 2.0 * jit;
}

// Whether region jv (hammered earlier) already struck within "near" px of "at" — one of its own dents (its centre on
// its side of the edge with region own) on the three courses and three dents around: the later pass running on over
// the edge skips a blow there instead of doubling it.
bool hmStruck(vec2 at, int jv, int own, float near) {
  vec2 rel = wrapDelta(at - hmCentre(jv));
  vec2 relO = wrapDelta(at - hmCentre(own));
  float wJ = hmWeight(jv), wO = hmWeight(own);
  float sc = exp2(u_region_var * (hash2I(ivec2(jv, 7), uSeed).x - 0.5));
  float ringW = max(u_ring, 0.5) * sc;
  float sp = max(u_spacing, 0.5) * sc;
  float jit = u_jitter * min(max(u_ring, 0.5), max(u_spacing, 0.5)) * sc;
  float th = atan(rel.y, rel.x);
  float kf = length(rel) / ringW;
  int k0 = int(floor(kf - u_wobble * hmWobble(jv, th, kf) + 0.5));
  bool hit = false;
  // (A loop bound that isn't a constant, so D3D keeps one copy of hmDent.)
  for (int t = 0; t < (uRes.x > 0.0 ? 9 : 0); t++) {
    float a;
    ivec2 id;
    vec2 cv;
    bool valid;
    vec2 c = hmDent(jv, k0 + t / 3 - 1, th, t - (t / 3) * 3 - 1, ringW, sp, jit, a, id, cv, valid);
    vec2 u = rel - c;
    // Its own dent: nearer its centre than the other's (by distance / weight), and close to "at".
    if (valid && !hit && dot(u, u) < near * near && length(c) / wJ <= length(c + relO - rel) / wO) hit = true;
  }
  return hit;
}

// The dents' discs for the Shape Mask, joined with a 2 px fillet so pinholes between nearly touching discs close
// (continuous, so the mask's distance stays usable past its edge).
float hmSmin(float a, float b) {
  float h = max(2.0 - abs(a - b), 0.0) * 0.5;
  return min(a, b) - h * h * 0.5;
}

// Online smooth maximum (log-sum-exp) of non-negative depths, each counted from 0 so untouched metal stays at 0:
// m = the largest so far, S = Σ exp((d − m) / k).
void hmSmax(inout float m, inout float S, float d, float k) {
  if (d > m) { S = S * exp((m - d) / k) + 1.0; m = d; } else S += exp((d - m) / k);
}

GenOut gen(vec2 p) {
  float ringW0 = max(u_ring, 0.5);
  float sp0 = max(u_spacing, 0.5);
  bool wantSdf = u_sm_on || u_mk_write > 0;
  // Region variation scales a region's dents by up to 2^±(rv / 2).
  float sMax = exp2(0.5 * u_region_var);
  // Stretch lengthens the dents: along the course (> 1) or across it (< 1), the other axis keeping its width.
  vec2 ax = vec2(max(u_stretch, 1.0), max(1.0 / max(u_stretch, 0.05), 1.0));
  // The rim: Rim, plus a burr round high-shape punch marks.
  float rimA = u_rim + 0.35 * smoothstep(4.0, 10.0, u_shape);
  // How far out a dent matters, in radii: its edge, the rim (out to 1.4 radii), the Shape-mask disc.
  float ext = max(rimA > 0.0 ? 1.4 : 1.0, wantSdf ? u_mask_r : 0.0);
  float rad0 = 0.5 * u_size * min(ringW0, sp0);
  float jit0 = u_jitter * min(ringW0, sp0);
  // How far a dent's centre can be from a pixel it reaches, and the search window that finds every such dent despite
  // its jitter, its course's wobble and offset: the courses and the dents along them (uniform-derived counts, so D3D
  // doesn't unroll the loop).
  float reachD = rad0 * sMax * exp2(u_size_var) * (1.0 + 0.5 * u_course_var) * max(ax.x, ax.y) * ext;
  float reach = reachD + jit0 * sMax * 1.415;
  int KR = clamp(int(reach / (ringW0 / sMax) + 0.5 + 0.5 * u_course_var + 2.0 * u_wobble), 1, 10);
  // (A strong wobble pulls inner courses' dents inwards, where they stand further apart in angle than their count says.)
  int KA = clamp(int(reach / (sp0 / sMax) + 0.5) + 1 + int(ceil(2.0 * max(u_wobble - 1.0, 0.0))), 1, 14);
  int NA = 2 * KA + 1;
  int per = (2 * KR + 1) * NA;
  // Edge overlap: how far past its region's edge a dent may lie (growing shallower).
  float over = u_overlap * rad0;
  // Flat punches strike to much the same depth: Depth variation counts for less at high Dent shape.
  float dVar = u_depth_var * mix(1.0, 0.3, smoothstep(2.5, 5.0, u_shape));

  // The pixel's region: the centre with the smallest distance / weight (weighted Voronoi → arc-shaped region edges).
  float sA = 1e20, wA = 1.0;
  int oA = 0;
  vec2 rA = vec2(0.0);
  for (int i = 0; i < u_centres; i++) {
    vec2 d = wrapDelta(p - hmCentre(i));
    float w = hmWeight(i);
    if (length(d) / w < sA) { sA = length(d) / w; wA = w; oA = i; rA = d; }
  }
  // The regions whose dents can reach here: those whose edge with A (an Apollonius circle, the bisector for equal
  // weights) passes within a dent's reach (plus the overlap), the nearest eight. Tiling, each centre's images across the
  // wrap count separately, so a centre's courses meet its own copies' along an edge instead of breaking where the wrap
  // flips.
  vec2 rr[8];
  float ww[8];
  int oo[8];
  float ee[8];
  for (int y = 0; y < 8; y++) { rr[y] = rA; ww[y] = wA; oo[y] = oA; ee[y] = 0.0; }
  int nreg = 1;
  int nimg = uTile ? 4 : 1;
  int npairs = u_centres * nimg;
  for (int e = 0; e < npairs; e++) {
    int i = e / nimg;
    int im = e - i * nimg;
    if (im != 0 || i != oA) {
      vec2 d = wrapDelta(p - hmCentre(i));
      if ((im & 1) != 0) d.x -= d.x < 0.0 ? -uRes.x : uRes.x;
      if ((im & 2) != 0) d.y -= d.y < 0.0 ? -uRes.y : uRes.y;
      float w = hmWeight(i);
      // First the edge with A alone; then against every centre (hmPast): the region lies beyond each edge with a
      // centre nearer here, so far images and centres whose circle with A only passes by, owned by others, drop out.
      float inc = reachD + over + 1.0;
      float edge = hmEdge(rA, wA, d, w);
      int jv;
      if (edge < inc) edge = hmPast(p, d, w, i, inc, inc, 0.0, jv);
      if (edge < inc) {
        int slot = nreg;
        bool take = true;
        if (nreg == 8) {
          // Full (many small regions close by): replace the farthest, if this one is nearer.
          slot = 1;
          for (int y = 2; y < 8; y++) if (ee[y] > ee[slot]) slot = y;
          take = edge < ee[slot];
        } else nreg++;
        if (take) { rr[slot] = d; ww[slot] = w; oo[slot] = i; ee[slot] = edge; }
      }
    }
  }
  // Per region: its dent scale, the pixel's angle and the course it sits on (its wobble taken out).
  float scl[8];
  float thE[8];
  float kE[8];
  for (int y = 0; y < 8; y++) { scl[y] = 1.0; thE[y] = 0.0; kE[y] = 0.0; }
  // (A loop bound that isn't a constant: D3D would unroll eight copies of the wobble.)
  for (int y = 0; y < nreg; y++) {
    scl[y] = exp2(u_region_var * (hash2I(ivec2(oo[y], 7), uSeed).x - 0.5));
    thE[y] = atan(rr[y].y, rr[y].x);
    float kf = length(rr[y]) / (ringW0 * scl[y]);
    kE[y] = kf - u_wobble * hmWobble(oo[y], thE[y], kf);
  }

  int count = nreg * per;
  // (A square root, so the first tenth of the slider already rounds the creases visibly.)
  float kc = 0.3 * sqrt(max(u_crease, 1e-5));
  float m1 = 0.0, S1 = 0.0;  // smooth maximum of the depths (colour)
  float m2 = 0.0, S2 = 0.0;  // … with Height's per-dent depths (Per-feature variation)
  float N = 0.0;             // dents reaching here
  float rimV = 0.0, rimH = 0.0;
  float score = 1e9;         // the winning dent (its rnd): the deepest, else (untouched) the nearest in units of its radius
  float dentRnd = 0.0;
  float shade = 0.0;         // the winning dent's region shade (Region variation), −0.5 … 0.5
  float sd = 1e9;            // signed distance to the dents' discs (Shape Mask)
  // (No continue in this loop: ANGLE / D3D11 can miscompile it.)
  for (int t = 0; t < count; t++) {
    int reg = t / per;
    int rest = t - reg * per;
    int kk = rest / NA;
    int aa = rest - kk * NA - KA;
    vec2 rel = rr[reg];
    int own = oo[reg];
    float sc = scl[reg];
    float ringW = ringW0 * sc;
    float sp = sp0 * sc;
    int k = int(floor(kE[reg] + 0.5)) + kk - KR;
    float a;
    ivec2 id;
    vec2 cv;
    bool valid;
    // The dent: its course's own offset (Course variation; none for the centre dent), wobble and jitter.
    vec2 c = hmDent(own, k, thE[reg], aa, ringW, sp, jit0 * sc, a, id, cv, valid);
    if (valid) {
      vec2 rd = vec2(cos(a), sin(a));
      vec4 hr = vec4(hash2I(id, uSeed + 29.0), hash2I(id, uSeed + 31.0));
      float R = max(rad0 * sc * exp2(u_size_var * (2.0 * hr.x - 1.0)) * (1.0 + u_course_var * max(cv.y, 0.0)), 0.25);
      vec2 u = rel - c;
      // In units of the radius: along the course, across it.
      vec2 l = vec2(dot(u, vec2(-rd.y, rd.x)) / ax.x, dot(u, rd) / ax.y) / R;
      float q = length(l);
      float rnd = hashI(id, uSeed + 23.0);
      // The deepest point, moved off centre by Tilt (in radii; never closer than 4 px to the rim, so small dents don't
      // get one-pixel cliffs on their steep side).
      vec2 o = min(u_tilt * (0.4 + 0.3 * hr.w), clamp(1.0 - 4.0 / R, 0.0, 0.7)) * vec2(cos(TAU * hr.z), sin(TAU * hr.z));
      // The Shape-mask disc: Shape mask size × the radius, moving from the dent's centre (1) to its deepest point (0).
      float dDisc = (length(l - o * (1.0 - u_mask_r)) - u_mask_r) * R;
      if (q >= ext + 2.0 / R) {
        // Too far to touch this pixel: only the nearest such dent's random (for untouched metal) and its disc.
        if (1.0 + q < score) { score = 1.0 + q; dentRnd = rnd; shade = hash2I(ivec2(own, 7), uSeed).x - 0.5; }
        if (wantSdf) sd = hmSmin(sd, dDisc);
      } else {
        // Each region's dents cross its edges whole, and run on past them (Edge overlap, both ways), thinning out by
        // count — each dent its own random cut-off over the band, so the regions' last dents don't end along a line of
        // creases — over the other region's own dents, which are all there, so no strip of thinned metal remains.
        // Where dents stand apart (Dent size below about 1.3), near (or past) an earlier region's edge a dent is skipped
        // where that region already struck nearby, so the two passes' courses don't double up along the seam;
        // overlapping facets just strike over each other.
        bool keep = true;
        if (nreg > 1) {
          int jv;
          vec2 at = p - rel + c;
          float near = u_size < 1.3 ? 0.6 * min(ringW, sp) : 0.0;
          float past = hmPast(at, c, ww[reg], own, over, over, near, jv);
          keep = past < 1e8 && (past <= 0.0 || hashI(id, uSeed + 37.0) >= smoothstep(0.2, 1.0, past / max(over, 1e-4)));
          if (keep && jv != own && u_size < 1.3) keep = !hmStruck(at, jv, own, near);
        }
        if (keep) {
          // The dish: 0 at its deepest point (o), 1 at the rim, by its own and its region's depth; qt runs from the
          // deepest point to the rim along the ray through the pixel.
          vec2 hg = hash2I(ivec2(own, 7), uSeed);
          // Small dents (under 6 px radius, Region variation aside) strike shallower, so their walls never become pixel-wide
          // cliffs.
          float D = (1.0 - dVar * hr.y) * (1.0 - 0.5 * u_region_var * hg.y) * min(1.0, pow(R / (6.0 * sc), 0.75));
          vec2 lo = l - o;
          float lv = length(lo);
          float ov = lv > 1e-6 ? dot(o, lo) / lv : 0.0;
          float qt = lv / max(-ov + sqrt(ov * ov + 1.0 - dot(o, o)), 1e-4);
          float dep = D * (1.0 - pow(min(qt, 1.0), u_shape));
          float hv = 1.0 - u_h_var * fract(rnd * 61.37 + 0.123);
          if (dep > 0.0) {
            hmSmax(m1, S1, dep, kc);
            hmSmax(m2, S2, dep * hv, kc);
            N += 1.0;
          }
          // The rim: a bump just outside the edge (0.7 to 1.4 radii, highest at 1.05).
          float x = (q - 1.05) / 0.35;
          float bump = max(1.0 - x * x, 0.0);
          bump *= bump * rimA * D;
          rimV = max(rimV, bump);
          rimH = max(rimH, bump * hv);
          float key = q < 1.0 ? 1.0 - dep : 1.0 + q;
          if (key < score) { score = key; dentRnd = rnd; shade = hg.x - 0.5; }
          if (wantSdf) sd = hmSmin(sd, dDisc);
        }
      }
    }
  }
  // The depth: the deepest dent (Crease softness 0), else the smooth maximum (rounded where dents meet).
  float Dv = u_crease > 0.0 ? m1 + kc * log(S1 + (1.0 - N) * exp(-m1 / kc)) : m1;
  float Dh = u_crease > 0.0 ? m2 + kc * log(S2 + (1.0 - N) * exp(-m2 / kc)) : m2;
  // Rims stand on untouched metal and on the ridges between dents, not down in a dent.
  float value = max(1.0 - Dv + rimV * (1.0 - smoothstep(0.15, 0.6, Dv)), 0.0) / (1.0 + rimA);
  float hval = max(1.0 - Dh + rimH * (1.0 - smoothstep(0.15, 0.6, Dh)), 0.0) / (1.0 + rimA);
  // Region variation's shade: each region a little lighter or darker in colour (not in height).
  value = clamp(value - 0.3 * u_region_var * shade, 0.0, 1.0);
  GenOut g = genOut(value, 1.0, dentRnd, wantSdf ? sd : NO_SDF);
  // Per-feature variation is each dent's depth (hval), not a scale of the whole value — that would step the rims.
  g.feat = 0.0;
  g.hval = hval;
  return g;
}
`,
}
