// Tessellation: one layer, many lattices — squares, diamonds, rhombille (tumbling blocks), herringbone,
// basketweave, interlocking crosses / stretched hexes, plus (Greek cross) tiles, octagon + square, triangles,
// hopscotch (Pythagorean), pinwheel and Cairo pentagons. Every tile is an exact polygon (signed distance, px),
// inset by half the gap with mitred corners and rounded at its convex corners, so the common bevel / profile /
// combine params work. rnd is per tile, or per tile kind (cube face, H/V brick, octagon/square…).

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { geoGlsl, orientParam, rndModeParam } from './geometricCommon'

export const TESS_MODES: [string, string][] = [
  ['squares', 'Squares / offset squares'],
  ['diamonds', 'Diamonds (argyle)'],
  ['rhombille', 'Rhombille (tumbling blocks)'],
  ['herringbone', 'Herringbone'],
  ['basketweave', 'Basketweave'],
  ['cross', 'Interlocking crosses / hexes'],
  ['plus', 'Plus (Greek cross)'],
  ['octagon', 'Octagon + square'],
  ['triangles', 'Triangles'],
  ['hopscotch', 'Hopscotch (offset squares)'],
  ['pinwheel', 'Pinwheel'],
  ['cairo', 'Cairo pentagons'],
]

const modeIs = (...m: string[]) => (p: Record<string, unknown>) => m.includes(String(p.mode))

export const tessellationLayer: LayerDef = {
  type: 'tessellation',
  label: 'Tessellation',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description:
    'Tile lattices — tumbling blocks, herringbone, basketweave, interlocking crosses, octagons, triangles, pinwheel, Cairo… Exact tile distances with gap and rounding; per-tile or per-face random.',
  params: [
    P.enum('mode', 'Tiling', 'rhombille', TESS_MODES),
    P.float('scale', 'Scale', 4, 0.25, 256, {
      softMax: 32,
      step: 0.01,
      hint: 'Pattern repeats across the width (whole counts when tiling). One repeat = 1 square / diamond pair / cube column / 2×2 herringbone or basket block / cross pair / 5 plus tiles / octagon / triangle pair / pinwheel / 2×2 Cairo cells',
    }),
    P.float('aspect', 'Aspect', 1, 0.1, 10, { softMin: 0.25, softMax: 4, step: 0.01, hint: 'Stretch the repeat vertically (rows are rounded to whole counts when tiling)' }),
    orientParam('Multiples of 45°; diagonal frames repeat over gcd(width, height) so they stay seamless'),
    P.float('gap', 'Gap', 2, 0, 128, { softMax: 8, unit: 'px', step: 0.1, hint: 'Grout between tiles (whole even/odd px stay crisp: odd gaps shift the lattice half a pixel)' }),
    P.float('round', 'Corner rounding', 0, 0, 128, { softMax: 8, unit: 'px', step: 0.1 }),
    P.int('ratio', 'Length ratio', 2, 2, 8, { showIf: modeIs('herringbone', 'basketweave', 'hopscotch'), hint: 'Herringbone: brick length in widths. Basketweave: bricks per block. Hopscotch: big square side in small squares' }),
    P.float('stagger', 'Row offset', 0, 0, 1, { step: 0.001, showIf: modeIs('squares'), hint: 'Shift alternate rows (fraction of a square); rows are made even when tiling' }),
    P.float('plateau', 'Plateau', 0.25, 0, 1, { step: 0.001, showIf: modeIs('cross'), hint: 'Top edge width: 0 = diamonds, 0.25 = stretched hexes, 0.5 = squares in half-offset columns, > 0.5 = bow ties' }),
    P.float('step', 'Step', 0.6, 0, 1, { step: 0.001, showIf: modeIs('cross'), hint: 'Shoulder in the slanted sides — 0 = straight (hexes), 1 = right-angled arms (plus crosses)' }),
    P.float('cut', 'Corner cut', 0.293, 0, 0.5, { step: 0.001, showIf: modeIs('octagon'), hint: 'Fraction of the cell cut off each corner (0.293 = regular octagons)' }),
    P.float('inner', 'Centre square', 0.33, 0.02, 0.98, { step: 0.001, showIf: modeIs('pinwheel'), hint: 'Size of the centre square (fraction of the repeat)' }),
    P.float('cairo', 'Pentagon shape', 0.274, 0, 0.45, { step: 0.001, showIf: modeIs('cairo'), hint: '0 = squares on the diagonal, 0.274 = equilateral-sided Cairo' }),
    rndModeParam(['Per tile', 'Per tile kind', 'Tile kind + random'], 'Tile kinds: block faces (top/left/right), H/V bricks, octagon/square, up/down triangles, sub-lattices… Use with Diffuse source = random'),
    P.seed(),
  ],
  defaults: {
    rnd_mode: 'class_random',
    h_on: true,
    h_amount: 0.4,
    bevel: 2,
    profile: 'smooth',
    dif_on: true,
    dif_src: 'random',
    dif_grad: gradient('#3b3631', '#6a6157', '#9a8f80'),
  },
  glsl:
    geoGlsl(16) +
    /* glsl */ `
// ---------------------------------------------------------------- modes (unit coords, y up, CCW polygons)
// Every mode is a few tile shapes, each tried at a list of anchors: tess_shape(k) builds shape k and says how many
// anchors it has; tess_anchor(k, a) gives anchor a. gen() runs them all through one flat loop with a single
// geo_finish and geo_try. D3D (Chrome's default on Windows) inlines every call, and a mode function apiece, each
// with its own nested loops of tries, took ~20 s to compile.
//
//   squares      offset squares; rows alternate by the stagger
//   diamonds     diamonds on the lattice and on its corners (argyle)
//   rhombille    pointy-top hexes (two per unit cell, at (.5,.25) and (0,.75); regular when a unit is √3 tall),
//                each split into three rhombi: top (0), left (1), right (2) — a cube lit from above
//   herringbone  n×1 bricks: lattice (1,1), (n,-n); horizontal brick at the lattice point, vertical brick at
//                (n, 1-n). Period 2n × 2n
//   basketweave  n×n blocks of n parallel bricks, alternating horizontal / vertical. Period 2 blocks
//   cross        hexagonal-topology tiles on a centred 4×2 lattice. Side vertices (2-2p, 0), top corners (2p, 1);
//                each slanted side gets a horizontal shoulder through its midpoint (1, .5), point-symmetric so
//                neighbours match
//   plus         plus pentominoes: centres on the lattice (2,1), (-1,2) (+ half a unit so edges sit on unit
//                lines). Period 5
//   octagon      octagons with small squares (diamonds) at their corners
//   triangles    two rows per unit (regular when a unit is √3 tall); odd rows shift half a triangle
//   hopscotch    (Pythagorean) a×a and 1×1 squares on the lattice (a,1), (-1,a). Period a²+1
//   pinwheel     four A×B rectangles around a centre square (A-B), A+B = 1
//   cairo        each unit cell holds a short segment through its centre (horizontal on even cells, vertical on
//                odd), joined to the cell corners; every grid edge then owns one pentagon (a triangle from one
//                cell + a trapezoid from the next). Period 2×2

#define TESS_1 (uRes.x > 0.0 ? 1 : 0)   // 1, from a uniform: a loop bound D3D can't unroll

const vec2 TESS_RHOMB[12] = vec2[12](
  vec2(0.0), vec2(0.5, 1.0 / 6.0), vec2(0.0, 1.0 / 3.0), vec2(-0.5, 1.0 / 6.0),
  vec2(0.0), vec2(-0.5, 1.0 / 6.0), vec2(-0.5, -1.0 / 6.0), vec2(0.0, -1.0 / 3.0),
  vec2(0.0), vec2(0.0, -1.0 / 3.0), vec2(0.5, -1.0 / 6.0), vec2(0.5, 1.0 / 6.0));
const vec2 TESS_PLUS[12] = vec2[12](
  vec2(0.5, -1.5), vec2(0.5, -0.5), vec2(1.5, -0.5), vec2(1.5, 0.5),
  vec2(0.5, 0.5), vec2(0.5, 1.5), vec2(-0.5, 1.5), vec2(-0.5, 0.5),
  vec2(-1.5, 0.5), vec2(-1.5, -0.5), vec2(-0.5, -0.5), vec2(-0.5, -1.5));

int tess_mode, tess_n;
vec2 tess_uu;
// The tile under the pixel where a mode finds it directly (rhombille's nearest hex, triangles, Cairo): its anchor
// (units), cell, kind, and the key's lattice (cell, period) and extra kind offset.
vec2 tess_pos;
ivec2 tess_cell, tess_add;
int tess_cls;

void tess_pick() {
  int m = tess_mode;
  vec2 uu = tess_uu;
  if (m == 2) {
    ivec2 c0 = ivec2(floor(uu));
    float bd = 1e9;
    for (int e = 0; e < 18 * TESS_1; e++) {
      int h = e % 2;
      ivec2 c = c0 + ivec2((e / 2) % 3 - 1, e / 6 - 1);
      vec2 ctr = vec2(c) + (h == 0 ? vec2(0.5, 0.25) : vec2(0.0, 0.75));
      vec2 d = uu - ctr;
      float dd = d.x * d.x + 3.0 * d.y * d.y;
      if (dd < bd) { bd = dd; tess_pos = ctr; tess_cell = c; tess_add = ivec2(h, 0); }
    }
  } else if (m == 8) {
    float ry = uu.y * 2.0;
    int r = int(floor(ry));
    float t = ry - float(r);
    float o = (r & 1) == 1 ? 0.5 : 0.0;
    float x = uu.x - o;
    int i = int(floor(x - 0.5 * t)), j = int(floor(x + 0.5 * t));
    tess_cls = j == i ? 0 : 1;
    int k = j == i ? i : j;
    tess_pos = vec2(float(k) + o, 0.5 * float(r));
    tess_cell = ivec2(k, r);
  } else if (m == 11) {
    float e = 0.5 - clamp(u_cairo, 0.0, 0.45);
    ivec2 c = ivec2(floor(uu));
    vec2 l = uu - vec2(c);
    int typ;
    ivec2 X;
    if (((c.x + c.y) & 1) == 0) {
      float w = e * (1.0 - abs(2.0 * l.y - 1.0));
      if (l.x < w) { typ = 0; X = c; }
      else if (l.x > 1.0 - w) { typ = 0; X = c + ivec2(1, 0); }
      else { typ = 1; X = l.y < 0.5 ? c : c + ivec2(0, 1); }
    } else {
      float w = e * (1.0 - abs(2.0 * l.x - 1.0));
      if (l.y < w) { typ = 1; X = c; }
      else if (l.y > 1.0 - w) { typ = 1; X = c + ivec2(0, 1); }
      else { typ = 0; X = l.x < 0.5 ? c : c + ivec2(1, 0); }
    }
    tess_cls = typ == 0 ? (((X.x - 1 + X.y) & 1) == 0 ? 0 : 1) : (((X.x + X.y - 1) & 1) == 0 ? 2 : 3);
    tess_pos = vec2(X);
    tess_cell = X;
    tess_add = ivec2(typ, 0);
  }
}

// Shape k of the mode as the working polygon (not yet inset); returns its anchor count.
int tess_shape(int k) {
  int m = tess_mode;
  float fn = float(tess_n);
  vec2 lo = vec2(0.0), hi = vec2(1.0);   // a rectangle, unless the mode sets vertices
  geo_n = 0;
  int count = 9;
  if (m == 1 || (m == 7 && k == 1)) {
    float r = m == 1 ? 0.5 : clamp(u_cut, 0.005, 0.495);
    geo_V[0] = vec2(0.0, -r); geo_V[1] = vec2(r, 0.0); geo_V[2] = vec2(0.0, r); geo_V[3] = vec2(-r, 0.0);
    geo_n = 4;
    count = m == 1 ? 13 : 4;
  } else if (m == 2) {
    for (int i = 0; i < 4 * TESS_1; i++) geo_V[i] = TESS_RHOMB[4 * k + i];
    geo_n = 4;
    count = 1;
  } else if (m == 3) {
    if (k == 0) hi = vec2(fn, 1.0);
    else { lo = vec2(fn, 1.0 - fn); hi = vec2(fn + 1.0, 1.0); }
    count = 3 * (tess_n / 2 + 4);
  } else if (m == 4) {
    ivec2 b = ivec2(floor(tess_uu / fn));
    hi = ((b.x + b.y) & 1) == 0 ? vec2(fn, 1.0) : vec2(1.0, fn);
    count = tess_n;
  } else if (m == 5) {
    float pl = clamp(u_plateau, 0.01, 0.99);
    float xt = 2.0 * pl;
    float st = max(clamp(u_step, 0.0, 1.0) * abs(1.0 - 2.0 * pl), 0.002);
    float dir = pl <= 0.5 ? 1.0 : -1.0;
    vec2 V1 = vec2(2.0 - xt, 0.0), S1 = vec2(1.0 + dir * st, 0.5), S2 = vec2(1.0 - dir * st, 0.5), V2 = vec2(xt, 1.0);
    geo_V[0] = V1; geo_V[1] = S1; geo_V[2] = S2; geo_V[3] = V2;
    geo_V[4] = vec2(-V2.x, V2.y); geo_V[5] = vec2(-S2.x, S2.y); geo_V[6] = vec2(-S1.x, S1.y); geo_V[7] = -V1;
    geo_V[8] = -S1; geo_V[9] = -S2; geo_V[10] = -V2;
    geo_V[11] = vec2(V2.x, -V2.y); geo_V[12] = vec2(S2.x, -S2.y); geo_V[13] = vec2(S1.x, -S1.y);
    geo_n = 14;
    count = 18;
  } else if (m == 6) {
    for (int i = 0; i < 12 * TESS_1; i++) geo_V[i] = TESS_PLUS[i];
    geo_n = 12;
  } else if (m == 7) {
    float c = clamp(u_cut, 0.005, 0.495);
    geo_V[0] = vec2(c, 0.0); geo_V[1] = vec2(1.0 - c, 0.0); geo_V[2] = vec2(1.0, c); geo_V[3] = vec2(1.0, 1.0 - c);
    geo_V[4] = vec2(1.0 - c, 1.0); geo_V[5] = vec2(c, 1.0); geo_V[6] = vec2(0.0, 1.0 - c); geo_V[7] = vec2(0.0, c);
    geo_n = 8;
  } else if (m == 8) {
    geo_V[0] = vec2(0.0);
    if (tess_cls == 0) { geo_V[1] = vec2(1.0, 0.0); geo_V[2] = vec2(0.5); }
    else { geo_V[1] = vec2(0.5); geo_V[2] = vec2(-0.5, 0.5); }
    geo_n = 3;
    count = 1;
  } else if (m == 9) {
    if (k == 0) hi = vec2(fn);
    else { lo = vec2(fn, 0.0); hi = vec2(fn + 1.0, 1.0); }
  } else if (m == 10) {
    float inner = clamp(u_inner, 0.02, 0.98);
    float A = 0.5 * (1.0 + inner), B = 0.5 * (1.0 - inner);
    if (k == 0) hi = vec2(A, B);
    else if (k == 1) { lo = vec2(A, 0.0); hi = vec2(1.0, A); }
    else if (k == 2) lo = vec2(B, A);
    else if (k == 3) { lo = vec2(0.0, B); hi = vec2(B, 1.0); }
    else { lo = vec2(B); hi = vec2(A); }
  } else if (m == 11) {
    float e = 0.5 - clamp(u_cairo, 0.0, 0.45);
    int c = tess_cls;
    geo_V[0] = vec2(0.0);
    if (c == 0) { geo_V[1] = vec2(0.5, e); geo_V[2] = vec2(0.5, 1.0 - e); geo_V[3] = vec2(0.0, 1.0); geo_V[4] = vec2(-e, 0.5); }
    else if (c == 1) { geo_V[1] = vec2(e, 0.5); geo_V[2] = vec2(0.0, 1.0); geo_V[3] = vec2(-0.5, 1.0 - e); geo_V[4] = vec2(-0.5, e); }
    else if (c == 2) { geo_V[1] = vec2(e, -0.5); geo_V[2] = vec2(1.0 - e, -0.5); geo_V[3] = vec2(1.0, 0.0); geo_V[4] = vec2(0.5, e); }
    else { geo_V[1] = vec2(0.5, -e); geo_V[2] = vec2(1.0, 0.0); geo_V[3] = vec2(1.0 - e, 0.5); geo_V[4] = vec2(e, 0.5); }
    geo_n = 5;
    count = 1;
  }
  if (geo_n == 0) { geo_V[0] = lo; geo_V[1] = vec2(hi.x, lo.y); geo_V[2] = hi; geo_V[3] = vec2(lo.x, hi.y); geo_n = 4; }
  for (int i = 0; i < geo_n; i++) geo_V[i] *= geo_s;
  return count;
}

// Anchor a of shape k: position (units), tile kind, and its key's parts — key = geo_wrapCell(cell) * mul + add.
void tess_anchor(int k, int a, out vec2 pos, out int cls, out ivec2 cell, out ivec2 mul, out ivec2 add) {
  int m = tess_mode;
  vec2 uu = tess_uu;
  int n = tess_n;
  float fn = float(n);
  ivec2 d3 = ivec2(a % 3 - 1, a / 3 - 1);   // 3×3 neighbourhood, rows outer
  cls = k;
  cell = ivec2(0);
  mul = ivec2(1);
  add = ivec2(0);
  // Integer-lattice modes: key = geo_keyI(L, P) * kmul + kadd.
  ivec2 L = ivec2(0), P = ivec2(0), kmul = ivec2(1), kadd = ivec2(0);
  if (m == 0) {
    int j = int(floor(uu.y)) + d3.y;
    float o = (j & 1) == 1 ? u_stagger : 0.0;
    int i = int(floor(uu.x - o)) + d3.x;
    pos = vec2(float(i) + o, float(j));
    cell = ivec2(i, j);   // kind: from the key, in gen()
  } else if (m == 1 || m == 7) {
    // Diamonds: 9 on the lattice (+ half a unit), then 4 on its corners; octagons: 9, then the 4 small squares.
    bool corner = m == 1 ? a >= 9 : k == 1;
    int b = m == 1 ? a - 9 : a;
    ivec2 cc = ivec2(floor(uu)) + (corner ? ivec2(b % 2, b / 2) : d3);
    pos = vec2(cc) + (m == 1 && !corner ? 0.5 : 0.0);
    cls = corner ? 1 : 0;
    cell = cc;
    mul = ivec2(2, 1);
    add = ivec2(cls, 0);
  } else if (m == 2 || m == 8 || m == 11) {
    pos = tess_pos;
    if (m == 2) { cell = tess_cell; mul = ivec2(2, 1); add = tess_add; }
    else {
      cls = tess_cls;
      L = tess_cell;
      P = m == 8 ? ivec2(1, 2) : ivec2(2);
      if (m == 11) { kmul = ivec2(2, 1); kadd = tess_add; }
    }
  } else if (m == 3) {
    int a0 = int(floor(0.5 * (uu.x + uu.y)));
    int b0 = int(floor((uu.x - uu.y) / (2.0 * fn)));
    int aa = a0 + 1 - a / 3, b = b0 + a % 3 - 1;
    L = ivec2(aa + n * b, aa - n * b);
    P = ivec2(2 * n);
    pos = vec2(L);
  } else if (m == 4) {
    ivec2 b = ivec2(floor(uu / fn));
    bool hor = ((b.x + b.y) & 1) == 0;
    pos = vec2(b) * fn + (hor ? vec2(0.0, float(a)) : vec2(float(a), 0.0));
    cls = hor ? 0 : 1;
    L = b;
    P = ivec2(2);
    kmul = ivec2(8, 1);
    kadd = ivec2(a, 0);
  } else if (m == 5) {
    int sub = a % 2;
    ivec2 c = ivec2(floor(uu / vec2(4.0, 2.0))) + ivec2((a / 2) % 3 - 1, a / 6 - 1);
    pos = vec2(c) * vec2(4.0, 2.0) + (sub == 1 ? vec2(2.0, 1.0) : vec2(0.0));
    cls = sub;
    cell = c;
    mul = ivec2(2, 1);
    add = ivec2(sub, 0);
  } else if (m == 6) {
    vec2 q = uu - 0.5;
    ivec2 b = ivec2(floor(vec2(2.0 * q.x + q.y, 2.0 * q.y - q.x) / 5.0)) + d3;
    L = ivec2(2 * b.x - b.y, b.x + 2 * b.y);
    pos = vec2(L) + 0.5;
    cls = imod(L.x, 5);
    P = ivec2(5);
  } else if (m == 9) {
    float D = fn * fn + 1.0;
    ivec2 b = ivec2(floor(vec2(fn * uu.x + uu.y, fn * uu.y - uu.x) / D)) + d3;
    L = ivec2(b.x * n - b.y, b.x + b.y * n);
    P = ivec2(n * n + 1);
    pos = vec2(L);
  } else {
    ivec2 cc = ivec2(floor(uu)) + d3;
    pos = vec2(cc);
    cls = k == 4 ? 2 : (k & 1);
    cell = cc;
    mul = ivec2(5, 1);
    add = ivec2(k, 0);
  }
  if (P.x > 0) {
    ivec2 o = imod(L, P);
    cell = (L - o) / P;
    mul = P * kmul;
    add = o * kmul + kadd;
  }
}

GenOut gen(vec2 p) {
  int mode = u_mode;
  int n = clamp(u_ratio, 1, 8);
  // Period in pattern units, its natural height/width ratio, tile kinds, smallest tile feature (units).
  vec2 U = vec2(1.0);
  float nat = 1.0;
  int ncls = 1;
  float feat = 0.5;
  int multY = 1;
  if (mode == 0) { ncls = 2; feat = 1.0; multY = u_stagger > 0.0 ? 2 : 1; }
  else if (mode == 1) { ncls = 2; feat = 0.7; }
  else if (mode == 2) { nat = 1.7320508; ncls = 3; feat = 0.25; }
  else if (mode == 3 || mode == 4) { U = vec2(2.0 * float(n)); ncls = 2; feat = 1.0; }
  else if (mode == 5) { U = vec2(4.0, 2.0); ncls = 2; feat = 0.5; }
  else if (mode == 6) { U = vec2(5.0); ncls = 5; feat = 1.0; }
  else if (mode == 7) { ncls = 2; feat = 0.4; }
  else if (mode == 8) { nat = 1.7320508; ncls = 2; feat = 0.25; }
  else if (mode == 9) { U = vec2(float(n * n + 1)); ncls = 2; feat = 1.0; }
  else if (mode == 10) { ncls = 3; feat = 0.3; }
  else { U = vec2(2.0); ncls = 4; feat = 0.4; }

  // Odd gaps: shift the lattice half a pixel so both gap edges land on pixel boundaries.
  float sh = fract(0.5 * u_gap);
  geo_frame(p - sh, u_orient);
  float kx = geo_count(u_scale * geo_span.x / uRes.x, 1);
  float ky = geo_count(kx * geo_span.y / (geo_span.x * (U.y / U.x) * nat * u_aspect), multY);
  geo_periods(vec2(kx, ky));
  geo_s = geo_cs / U;

  float maxIn = 0.45 * feat * min(geo_s.x, geo_s.y);
  geo_in = min(0.5 * u_gap + u_round, maxIn);
  geo_r = min(u_round, geo_in);
  geo_reset();

  tess_mode = mode;
  tess_n = n;
  tess_uu = geo_f / geo_s;
  tess_pick();
  // Every shape, then its anchors, in one flat loop (see the modes above).
  int shapes = mode == 2 ? 3 : mode == 10 ? 5 : (mode == 3 || mode == 7 || mode == 9) ? 2 : 1;
  int k = -1, a = 0, na = 0;
  for (int it = 0; it < 64 * TESS_1; it++) {
    if (a >= na) {
      k++;
      if (k >= shapes) break;
      na = tess_shape(k);
      geo_finish();
      a = 0;
      continue;
    }
    vec2 pos;
    int cls;
    ivec2 cell, mul, add;
    tess_anchor(k, a, pos, cls, cell, mul, add);
    ivec2 key = geo_wrapCell(cell) * mul + add;
    if (mode == 0) cls = (key.x + key.y) & 1;
    geo_try(pos * geo_s, cls, key);
    a++;
  }

  return genOut(0.0, 1.0, geo_rnd(u_rnd_mode, ncls), min(geo_bestD, 1e4));
}
`,
}
