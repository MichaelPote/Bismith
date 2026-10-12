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
void geo_squares(vec2 uu) {
  geo_rect(vec2(0.0), vec2(1.0));
  int j0 = int(floor(uu.y));
  for (int dj = -1; dj <= 1; dj++) {
    int j = j0 + dj;
    float o = (j & 1) == 1 ? u_stagger : 0.0;
    int i0 = int(floor(uu.x - o));
    for (int di = -1; di <= 1; di++) {
      ivec2 key = geo_wrapCell(ivec2(i0 + di, j));
      geo_try(vec2(float(i0 + di) + o, float(j)) * geo_s, (key.x + key.y) & 1, key);
    }
  }
}

void geo_diamonds(vec2 uu) {
  geo_begin(); geo_add(vec2(0.0, -0.5)); geo_add(vec2(0.5, 0.0)); geo_add(vec2(0.0, 0.5)); geo_add(vec2(-0.5, 0.0)); geo_finish();
  ivec2 c = ivec2(floor(uu));
  for (int dj = -1; dj <= 1; dj++)
  for (int di = -1; di <= 1; di++) {
    ivec2 cc = c + ivec2(di, dj);
    geo_try((vec2(cc) + 0.5) * geo_s, 0, geo_wrapCell(cc) * ivec2(2, 1));
  }
  for (int dj = 0; dj <= 1; dj++)
  for (int di = 0; di <= 1; di++) {
    ivec2 cc = c + ivec2(di, dj);
    geo_try(vec2(cc) * geo_s, 1, geo_wrapCell(cc) * ivec2(2, 1) + ivec2(1, 0));
  }
}

// Pointy-top hexes (two per unit cell, at (.5,.25) and (0,.75); regular when a unit is √3 tall), each split
// into three rhombi: top (0), left (1), right (2) — a cube lit from above.
void geo_rhombille(vec2 uu) {
  ivec2 c0 = ivec2(floor(uu));
  float bd = 1e9;
  vec2 hc = vec2(0.0);
  ivec2 hk = ivec2(0);
  for (int dj = -1; dj <= 1; dj++)
  for (int di = -1; di <= 1; di++)
  for (int h = 0; h < 2; h++) {
    ivec2 c = c0 + ivec2(di, dj);
    vec2 ctr = vec2(c) + (h == 0 ? vec2(0.5, 0.25) : vec2(0.0, 0.75));
    vec2 d = uu - ctr;
    float dd = d.x * d.x + 3.0 * d.y * d.y;
    if (dd < bd) { bd = dd; hc = ctr; hk = geo_wrapCell(c) * ivec2(2, 1) + ivec2(h, 0); }
  }
  const float T = 1.0 / 3.0;
  const float S = 1.0 / 6.0;
  vec2 a = hc * geo_s;
  geo_begin(); geo_add(vec2(0.0)); geo_add(vec2(0.5, S)); geo_add(vec2(0.0, T)); geo_add(vec2(-0.5, S)); geo_finish();
  geo_try(a, 0, hk);
  geo_begin(); geo_add(vec2(0.0)); geo_add(vec2(-0.5, S)); geo_add(vec2(-0.5, -S)); geo_add(vec2(0.0, -T)); geo_finish();
  geo_try(a, 1, hk);
  geo_begin(); geo_add(vec2(0.0)); geo_add(vec2(0.0, -T)); geo_add(vec2(0.5, -S)); geo_add(vec2(0.5, S)); geo_finish();
  geo_try(a, 2, hk);
}

// Herringbone of n×1 bricks: lattice (1,1), (n,-n); horizontal brick at the lattice point, vertical brick
// at (n, 1-n). Period 2n × 2n.
void geo_herringbone(vec2 uu) {
  int n = clamp(u_ratio, 1, 8);
  float fn = float(n);
  int a0 = int(floor(0.5 * (uu.x + uu.y)));
  int b0 = int(floor((uu.x - uu.y) / (2.0 * fn)));
  ivec2 P = ivec2(2 * n);
  for (int cls = 0; cls < 2; cls++) {
    if (cls == 0) geo_rect(vec2(0.0), vec2(fn, 1.0));
    else geo_rect(vec2(fn, 1.0 - fn), vec2(fn + 1.0, 1.0));
    for (int ia = 0; ia < 8; ia++) {
      if (ia > n / 2 + 3) break;
      for (int db = -1; db <= 1; db++) {
        int a = a0 + 1 - ia, b = b0 + db;
        ivec2 L = ivec2(a + n * b, a - n * b);
        geo_try(vec2(L) * geo_s, cls, geo_keyI(L, P));
      }
    }
  }
}

// Basketweave: n×n blocks of n parallel bricks, alternating horizontal / vertical. Period 2 blocks.
void geo_basketweave(vec2 uu) {
  int n = clamp(u_ratio, 1, 8);
  float fn = float(n);
  ivec2 b = ivec2(floor(uu / fn));
  bool hor = ((b.x + b.y) & 1) == 0;
  ivec2 bk = geo_keyI(b, ivec2(2));
  if (hor) geo_rect(vec2(0.0), vec2(fn, 1.0));
  else geo_rect(vec2(0.0), vec2(1.0, fn));
  for (int k = 0; k < 8; k++) {
    if (k >= n) break;
    vec2 a = vec2(b) * fn + (hor ? vec2(0.0, float(k)) : vec2(float(k), 0.0));
    geo_try(a * geo_s, hor ? 0 : 1, bk * ivec2(8, 1) + ivec2(k, 0));
  }
}

// Hexagonal-topology tiles on a centred 4×2 lattice. Side vertices (2-2p, 0), top corners (2p, 1); each
// slanted side gets a horizontal shoulder through its midpoint (1, .5), point-symmetric so neighbours match.
void geo_cross(vec2 uu) {
  float pl = clamp(u_plateau, 0.01, 0.99);
  float xt = 2.0 * pl;
  float st = max(clamp(u_step, 0.0, 1.0) * abs(1.0 - 2.0 * pl), 0.002);
  float dir = pl <= 0.5 ? 1.0 : -1.0;
  vec2 V1 = vec2(2.0 - xt, 0.0), S1 = vec2(1.0 + dir * st, 0.5), S2 = vec2(1.0 - dir * st, 0.5), V2 = vec2(xt, 1.0);
  geo_begin();
  geo_add(V1); geo_add(S1); geo_add(S2); geo_add(V2);
  geo_add(vec2(-V2.x, V2.y)); geo_add(vec2(-S2.x, S2.y)); geo_add(vec2(-S1.x, S1.y)); geo_add(-V1);
  geo_add(-S1); geo_add(-S2); geo_add(-V2);
  geo_add(vec2(V2.x, -V2.y)); geo_add(vec2(S2.x, -S2.y)); geo_add(vec2(S1.x, -S1.y));
  geo_finish();
  ivec2 c0 = ivec2(floor(uu / vec2(4.0, 2.0)));
  for (int dj = -1; dj <= 1; dj++)
  for (int di = -1; di <= 1; di++)
  for (int sub = 0; sub < 2; sub++) {
    ivec2 c = c0 + ivec2(di, dj);
    vec2 ctr = vec2(c) * vec2(4.0, 2.0) + (sub == 1 ? vec2(2.0, 1.0) : vec2(0.0));
    geo_try(ctr * geo_s, sub, geo_wrapCell(c) * ivec2(2, 1) + ivec2(sub, 0));
  }
}

// Plus pentominoes: centres on the lattice (2,1), (-1,2) (+ half a unit so edges sit on unit lines). Period 5.
void geo_plus(vec2 uu) {
  geo_begin();
  geo_add(vec2(0.5, -1.5)); geo_add(vec2(0.5, -0.5)); geo_add(vec2(1.5, -0.5)); geo_add(vec2(1.5, 0.5));
  geo_add(vec2(0.5, 0.5)); geo_add(vec2(0.5, 1.5)); geo_add(vec2(-0.5, 1.5)); geo_add(vec2(-0.5, 0.5));
  geo_add(vec2(-1.5, 0.5)); geo_add(vec2(-1.5, -0.5)); geo_add(vec2(-0.5, -0.5)); geo_add(vec2(-0.5, -1.5));
  geo_finish();
  vec2 q = uu - 0.5;
  ivec2 b = ivec2(floor(vec2(2.0 * q.x + q.y, 2.0 * q.y - q.x) / 5.0));
  for (int dn = -1; dn <= 1; dn++)
  for (int dm = -1; dm <= 1; dm++) {
    int m = b.x + dm, n = b.y + dn;
    ivec2 L = ivec2(2 * m - n, m + 2 * n);
    geo_try((vec2(L) + 0.5) * geo_s, imod(L.x, 5), geo_keyI(L, ivec2(5)));
  }
}

void geo_octagon(vec2 uu) {
  float c = clamp(u_cut, 0.005, 0.495);
  ivec2 i0 = ivec2(floor(uu));
  geo_begin();
  geo_add(vec2(c, 0.0)); geo_add(vec2(1.0 - c, 0.0)); geo_add(vec2(1.0, c)); geo_add(vec2(1.0, 1.0 - c));
  geo_add(vec2(1.0 - c, 1.0)); geo_add(vec2(c, 1.0)); geo_add(vec2(0.0, 1.0 - c)); geo_add(vec2(0.0, c));
  geo_finish();
  for (int dj = -1; dj <= 1; dj++)
  for (int di = -1; di <= 1; di++) {
    ivec2 cc = i0 + ivec2(di, dj);
    geo_try(vec2(cc) * geo_s, 0, geo_wrapCell(cc) * ivec2(2, 1));
  }
  geo_begin(); geo_add(vec2(0.0, -c)); geo_add(vec2(c, 0.0)); geo_add(vec2(0.0, c)); geo_add(vec2(-c, 0.0)); geo_finish();
  for (int dj = 0; dj <= 1; dj++)
  for (int di = 0; di <= 1; di++) {
    ivec2 cc = i0 + ivec2(di, dj);
    geo_try(vec2(cc) * geo_s, 1, geo_wrapCell(cc) * ivec2(2, 1) + ivec2(1, 0));
  }
}

// Triangles: two rows per unit (regular when a unit is √3 tall); odd rows shift half a triangle.
void geo_triangles(vec2 uu) {
  float ry = uu.y * 2.0;
  int r = int(floor(ry));
  float t = ry - float(r);
  float o = (r & 1) == 1 ? 0.5 : 0.0;
  float x = uu.x - o;
  int i = int(floor(x - 0.5 * t)), j = int(floor(x + 0.5 * t));
  geo_begin();
  int k, cls;
  if (j == i) { k = i; cls = 0; geo_add(vec2(0.0)); geo_add(vec2(1.0, 0.0)); geo_add(vec2(0.5)); }
  else { k = j; cls = 1; geo_add(vec2(0.0)); geo_add(vec2(0.5)); geo_add(vec2(-0.5, 0.5)); }
  geo_finish();
  geo_try(vec2(float(k) + o, 0.5 * float(r)) * geo_s, cls, geo_keyI(ivec2(k, r), ivec2(1, 2)));
}

// Hopscotch (Pythagorean): a×a and 1×1 squares on the lattice (a,1), (-1,a). Period a²+1.
void geo_hopscotch(vec2 uu) {
  int a = clamp(u_ratio, 1, 8);
  float fa = float(a);
  float D = fa * fa + 1.0;
  ivec2 b = ivec2(floor(vec2(fa * uu.x + uu.y, fa * uu.y - uu.x) / D));
  ivec2 P = ivec2(a * a + 1);
  for (int cls = 0; cls < 2; cls++) {
    if (cls == 0) geo_rect(vec2(0.0), vec2(fa));
    else geo_rect(vec2(fa, 0.0), vec2(fa + 1.0, 1.0));
    for (int dn = -1; dn <= 1; dn++)
    for (int dm = -1; dm <= 1; dm++) {
      int m = b.x + dm, n = b.y + dn;
      ivec2 L = ivec2(m * a - n, m + n * a);
      geo_try(vec2(L) * geo_s, cls, geo_keyI(L, P));
    }
  }
}

// Pinwheel: four A×B rectangles around a centre square (A-B), A+B = 1.
void geo_pinwheel(vec2 uu) {
  float inner = clamp(u_inner, 0.02, 0.98);
  float A = 0.5 * (1.0 + inner), B = 0.5 * (1.0 - inner);
  ivec2 c0 = ivec2(floor(uu));
  for (int k = 0; k < 5; k++) {
    int cls = k == 4 ? 2 : (k & 1);
    if (k == 0) geo_rect(vec2(0.0), vec2(A, B));
    else if (k == 1) geo_rect(vec2(A, 0.0), vec2(1.0, A));
    else if (k == 2) geo_rect(vec2(B, A), vec2(1.0));
    else if (k == 3) geo_rect(vec2(0.0, B), vec2(B, 1.0));
    else geo_rect(vec2(B), vec2(A));
    for (int dj = -1; dj <= 1; dj++)
    for (int di = -1; di <= 1; di++) {
      ivec2 cc = c0 + ivec2(di, dj);
      geo_try(vec2(cc) * geo_s, cls, geo_wrapCell(cc) * ivec2(5, 1) + ivec2(k, 0));
    }
  }
}

// Cairo: each unit cell holds a short segment through its centre (horizontal on even cells, vertical on odd),
// joined to the cell corners; every grid edge then owns one pentagon (a triangle from one cell + a trapezoid
// from the next). Period 2×2.
void geo_cairo(vec2 uu) {
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
  int cls;
  geo_begin();
  if (typ == 0) {
    if (((X.x - 1 + X.y) & 1) == 0) { cls = 0; geo_add(vec2(0.0)); geo_add(vec2(0.5, e)); geo_add(vec2(0.5, 1.0 - e)); geo_add(vec2(0.0, 1.0)); geo_add(vec2(-e, 0.5)); }
    else { cls = 1; geo_add(vec2(0.0)); geo_add(vec2(e, 0.5)); geo_add(vec2(0.0, 1.0)); geo_add(vec2(-0.5, 1.0 - e)); geo_add(vec2(-0.5, e)); }
  } else {
    if (((X.x + X.y - 1) & 1) == 0) { cls = 2; geo_add(vec2(0.0)); geo_add(vec2(e, -0.5)); geo_add(vec2(1.0 - e, -0.5)); geo_add(vec2(1.0, 0.0)); geo_add(vec2(0.5, e)); }
    else { cls = 3; geo_add(vec2(0.0)); geo_add(vec2(0.5, -e)); geo_add(vec2(1.0, 0.0)); geo_add(vec2(1.0 - e, 0.5)); geo_add(vec2(e, 0.5)); }
  }
  geo_finish();
  geo_try(vec2(X) * geo_s, cls, geo_keyI(X, ivec2(2)) * ivec2(2, 1) + ivec2(typ, 0));
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

  vec2 uu = geo_f / geo_s;
  if (mode == 0) geo_squares(uu);
  else if (mode == 1) geo_diamonds(uu);
  else if (mode == 2) geo_rhombille(uu);
  else if (mode == 3) geo_herringbone(uu);
  else if (mode == 4) geo_basketweave(uu);
  else if (mode == 5) geo_cross(uu);
  else if (mode == 6) geo_plus(uu);
  else if (mode == 7) geo_octagon(uu);
  else if (mode == 8) geo_triangles(uu);
  else if (mode == 9) geo_hopscotch(uu);
  else if (mode == 10) geo_pinwheel(uu);
  else geo_cairo(uu);

  return genOut(0.0, 1.0, geo_rnd(u_rnd_mode, ncls), min(geo_bestD, 1e4));
}
`,
}
