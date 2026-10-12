// Shared GLSL + params for the geometric generator family (docs/features/fr7.2b-geometric-generators.md):
// a seamless rotated frame, period-index wrapping, and exact polygon tiles with gap (mitred inset) and convex
// corner rounding. Each layer compiles its own copy; every helper is prefixed `geo_`.

import { P, type ParamDef } from '@/core/params'

/** Orientation options in 45° steps (enum index = steps clockwise). */
export const ORIENT8: [string, string][] = [
  ['0', '0°'],
  ['45', '45°'],
  ['90', '90°'],
  ['135', '135°'],
  ['180', '180°'],
  ['225', '225°'],
  ['270', '270°'],
  ['315', '315°'],
]

export const orientParam = (hint: string): ParamDef =>
  P.enum('orient', 'Rotation', '0', ORIENT8, { hint })

export const rndModeParam = (labels: [string, string, string], hint: string): ParamDef =>
  P.enum('rnd_mode', 'Random value', 'random', [['random', labels[0]], ['class', labels[1]], ['class_random', labels[2]]], { hint })

/**
 * GLSL helpers. `nv` = capacity of the working polygon (vertices).
 *
 * Frame: `geo_frame(p, ori)` rotates the pixel by ori × 45° (clockwise on screen) into `geo_f` and sets
 * `geo_span`, the frame extent that must hold a whole number of pattern periods for the texture to tile
 * (W×H, H×W, or gcd(W,H)/√2 for diagonal frames). `geo_periods(k)` then fixes the period counts and `geo_cs`.
 * Period-cell indices are made seamless with `geo_wrapCell` (handles the diagonal torus too).
 *
 * Polygons: `geo_begin(); geo_add(unit vertex)…; geo_finish();` builds the working polygon (CCW, vertices in
 * pattern units scaled by `geo_s` px/unit), insets it by `geo_in` px with mitred corners, and `geo_try(anchor
 * px, class, key)` keeps the nearest tile (signed distance of the inset polygon dilated by `geo_r`, i.e. convex
 * corners rounded by geo_r, concave corners sharp).
 */
export const geoGlsl = (nv = 16) => /* glsl */ `
#define GEO_NV ${nv}
const float GEO_C[8] = float[8](1.0, 0.70710678, 0.0, -0.70710678, -1.0, -0.70710678, 0.0, 0.70710678);
const float GEO_S[8] = float[8](0.0, 0.70710678, 1.0, 0.70710678, 0.0, -0.70710678, -1.0, -0.70710678);

vec2 geo_f;        // pixel position in the frame (px)
vec2 geo_span;     // frame extent holding a whole number of periods (px)
vec2 geo_k;        // periods across the span
vec2 geo_cs;       // period size (frame px)
vec2 geo_s;        // px per pattern unit
int geo_ori;
ivec2 geo_AB;      // W/g, H/g (diagonal frames)

int geo_gcd(int a, int b) {
  a = abs(a); b = abs(b);
  for (int i = 0; i < 40; i++) { if (b == 0) break; int t = a % b; a = b; b = t; }
  return max(a, 1);
}

void geo_frame(vec2 p, int ori) {
  ori = clamp(ori, 0, 7);
  geo_ori = ori;
  float c = GEO_C[ori], s = GEO_S[ori];
  geo_f = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  geo_AB = ivec2(1);
  if ((ori & 1) == 0) {
    geo_span = (ori & 2) == 2 ? uRes.yx : uRes;
  } else if (uTile) {
    int w = int(uRes.x + 0.5), h = int(uRes.y + 0.5);
    int g = geo_gcd(w, h);
    geo_AB = ivec2(w / g, h / g);
    geo_span = vec2(float(g) * 0.70710678);
  } else {
    geo_span = uRes * 0.70710678;
  }
}

// A period count: a whole multiple of m when tiling.
float geo_count(float k, int m) {
  float fm = float(max(m, 1));
  return uTile ? max(1.0, floor(k / fm + 0.5)) * fm : max(k, 1e-3);
}

void geo_periods(vec2 k) {
  geo_k = k;
  geo_cs = geo_span / k;
}

// Seamless key of a period cell: on a straight frame indices wrap per axis; on a diagonal frame the torus
// identifies cells along (A,A)/(-B,B) spans (or the mirrored pair), reduced to a canonical representative.
ivec2 geo_wrapCell(ivec2 c) {
  if (!uTile) return c;
  ivec2 k = ivec2(geo_k + 0.5);
  ivec2 c0 = imod(c, k);
  if ((geo_ori & 1) == 0) return c0;
  ivec2 q = (c - c0) / k;
  int u = q.x + q.y, v = q.y - q.x;
  ivec2 m = (geo_ori & 2) == 0 ? 2 * geo_AB : 2 * geo_AB.yx;
  return c0 + k * ivec2(imod(u, m.x), imod(v, m.y));
}

// Seamless key of an integer anchor (pattern units) of a pattern whose period is P units.
ivec2 geo_keyI(ivec2 a, ivec2 P) {
  ivec2 o = imod(a, P);
  return geo_wrapCell((a - o) / P) * P + o;
}

// ---------------------------------------------------------------- polygon tiles
vec2 geo_V[GEO_NV];
int geo_n;
float geo_in;      // inset (px): half the gap + the rounding radius
float geo_r;       // convex corner rounding (px)
vec2 geo_bbC, geo_bbH;
bool geo_ok;

float geo_bestD;
int geo_bestCls;
ivec2 geo_bestKey;

void geo_reset() { geo_bestD = 1e9; geo_bestCls = 0; geo_bestKey = ivec2(0); }
void geo_begin() { geo_n = 0; }
void geo_addPx(vec2 v) { if (geo_n < GEO_NV) { geo_V[geo_n] = v; geo_n++; } }
void geo_add(vec2 u) { geo_addPx(u * geo_s); }

float geo_area() {
  float a = 0.0;
  for (int i = 0; i < GEO_NV; i++) {
    if (i >= geo_n) break;
    vec2 v = geo_V[i], w = geo_V[i + 1 < geo_n ? i + 1 : 0];
    a += v.x * w.y - v.y * w.x;
  }
  return 0.5 * a;
}

// Inset the working polygon (CCW) by geo_in with mitred corners; record its bounding box. A polygon whose
// inset collapses (area flips) is marked unusable.
void geo_finish() {
  vec2 O[GEO_NV];
  float a0 = geo_area();
  for (int i = 0; i < GEO_NV; i++) {
    if (i >= geo_n) break;
    vec2 a = geo_V[i == 0 ? geo_n - 1 : i - 1], b = geo_V[i], c = geo_V[i + 1 < geo_n ? i + 1 : 0];
    vec2 e1 = b - a, e2 = c - b;
    e1 /= max(length(e1), 1e-6);
    e2 /= max(length(e2), 1e-6);
    vec2 n1 = vec2(-e1.y, e1.x), n2 = vec2(-e2.y, e2.x);
    O[i] = b + geo_in * (n1 + n2) / max(1.0 + dot(n1, n2), 0.05);
  }
  vec2 lo = vec2(1e9), hi = vec2(-1e9);
  for (int i = 0; i < GEO_NV; i++) {
    if (i >= geo_n) break;
    geo_V[i] = O[i];
    lo = min(lo, O[i]);
    hi = max(hi, O[i]);
  }
  geo_bbC = 0.5 * (lo + hi);
  geo_bbH = 0.5 * (hi - lo);
  geo_ok = geo_n >= 3 && geo_area() > 1e-3 && (a0 > 0.0);
}

void geo_rect(vec2 lo, vec2 hi) {
  geo_begin();
  geo_add(lo); geo_add(vec2(hi.x, lo.y)); geo_add(hi); geo_add(vec2(lo.x, hi.y));
  geo_finish();
}

// Exact signed distance to the working polygon (after Inigo Quilez).
float geo_sdPoly(vec2 p) {
  float d = dot(p - geo_V[0], p - geo_V[0]);
  float s = 1.0;
  for (int i = 0; i < GEO_NV; i++) {
    if (i >= geo_n) break;
    vec2 vi = geo_V[i], vj = geo_V[i == 0 ? geo_n - 1 : i - 1];
    vec2 e = vj - vi, w = p - vi;
    vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= vi.y, p.y < vj.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}

// Consider the working polygon placed at anchor (frame px). Bounding-box pruning keeps this cheap.
void geo_try(vec2 anchor, int cls, ivec2 key) {
  if (!geo_ok) return;
  vec2 q = geo_f - anchor;
  vec2 bq = abs(q - geo_bbC) - geo_bbH;
  if (length(max(bq, 0.0)) - geo_r >= geo_bestD) return;
  float d = geo_sdPoly(q) - geo_r;
  if (d < geo_bestD) { geo_bestD = d; geo_bestCls = cls; geo_bestKey = key; }
}

// Per-feature random from the winning tile: per tile, per tile kind ((cls + .5) / n), or kind + random.
float geo_rnd(int mode, int nCls) {
  float h = hashI(ivec2(geo_bestKey.x * 16 + geo_bestCls, geo_bestKey.y), uSeed);
  float n = float(max(nCls, 1));
  float c = float(geo_bestCls);
  if (mode == 1) return (c + 0.5) / n;
  if (mode == 2) return (c + 0.15 + 0.7 * h) / n;
  return h;
}
`
