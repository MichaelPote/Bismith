// Surface textures of the geometric family: tread plate (diamond plate lozenges, capsules, 5-bar groups,
// studs) and woven strands (plain / twill / basket / satin weaves, chain-link-style meshes on a 45° frame).

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { geoGlsl, orientParam, rndModeParam } from './geometricCommon'

// ------------------------------------------------------------------------------------------------ tread plate

export const treadplateLayer: LayerDef = {
  type: 'treadplate',
  label: 'Tread plate',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Raised lozenges / bars in alternating orientation — diamond plate, 5-bar tread, stud plate. Per-lozenge random.',
  params: [
    P.enum('style', 'Style', 'lozenge', [
      ['lozenge', 'Lozenge (diamond plate)'],
      ['capsule', 'Capsule'],
      ['bars', 'Bar group (5-bar)'],
      ['stud', 'Round studs'],
    ]),
    P.int('count_x', 'Count X', 8, 1, 256, { softMax: 32, hint: 'Cells across (made even when tiling with alternating orientation)' }),
    P.int('count_y', 'Count Y', 8, 1, 256, { softMax: 32, hint: 'Cells down' }),
    P.enum('layout', 'Orientation', 'checker', [
      ['checker', 'Alternate (checker)'],
      ['rows', 'Alternate by row'],
      ['cols', 'Alternate by column'],
      ['same', 'All the same'],
    ], { hint: 'Alternate cells turn 90° from the angle below' }),
    P.float('angle', 'Angle', 45, -180, 180, { softMin: -90, softMax: 90, unit: '°', step: 0.1, hint: 'Lozenge axis, clockwise from horizontal' }),
    P.float('length', 'Length', 0.85, 0.05, 1.5, { step: 0.001, hint: 'Fraction of the cell size (geometric mean of its width and height)' }),
    P.float('width', 'Width', 0.28, 0.02, 1, { step: 0.001, hint: 'Fraction of the cell (bars: of the bar spacing; studs: diameter)' }),
    P.int('bars', 'Bars', 5, 2, 9, { showIf: (p) => p.style === 'bars' }),
    P.bool('stagger', 'Offset rows', false, { hint: 'Shift alternate rows half a cell (rows made even when tiling)' }),
    P.float('jitter', 'Angle jitter', 0, 0, 45, { unit: '°', step: 0.1, hint: 'Random rotation per lozenge (worn / hand-made plate)' }),
    P.seed(),
  ],
  defaults: {
    h_on: true,
    h_amount: 0.4,
    bevel: 1.5,
    profile: 'round',
    dif_on: true,
    dif_src: 'value',
    dif_opacity: 0.6,
    dif_grad: gradient('#55595e', '#9aa0a6'),
  },
  glsl: /* glsl */ `
// Pointed lens along x: tips at (±hl, 0), half-width hw (two circular arcs).
float geo_vesica(vec2 p, float hl, float hw) {
  hw = max(hw, 1e-3);
  hl = max(hl, hw + 1e-3);
  p = abs(p);
  float r = 0.5 * (hl * hl + hw * hw) / hw;
  float d = r - hw;
  return ((p.x - hl) * d > p.y * hl) ? length(p - vec2(hl, 0.0)) : length(p - vec2(0.0, -d)) - r;
}

float geo_capsule(vec2 p, float hl, float hw) {
  p = abs(p);
  p.x = max(p.x - max(hl - hw, 0.0), 0.0);
  return length(p) - hw;
}

GenOut gen(vec2 p) {
  ivec2 n = ivec2(u_count_x, u_count_y);
  if (uTile) {
    if (u_layout == 0) n += n & ivec2(1);
    if (u_layout == 1 || u_stagger) n.y += n.y & 1;
    if (u_layout == 2) n.x += n.x & 1;
  }
  vec2 cs = uRes / vec2(n);
  float pitch = sqrt(cs.x * cs.y);           // non-square cells keep the lozenge proportions
  float hl = 0.5 * u_length * pitch;
  float hw = 0.5 * u_width * pitch;
  int j0 = int(floor(p.y / cs.y));
  float best = 1e9;
  float bestRnd = 0.0;
  for (int dj = -1; dj <= 1; dj++) {
    int j = j0 + dj;
    float sh = (u_stagger && (j & 1) == 1) ? 0.5 : 0.0;
    int i0 = int(floor(p.x / cs.x - sh));
    for (int di = -1; di <= 1; di++) {
      int i = i0 + di;
      ivec2 id = uTile ? imod(ivec2(i, j), n) : ivec2(i, j);
      int flip = u_layout == 0 ? ((i + j) & 1) : u_layout == 1 ? (j & 1) : u_layout == 2 ? (i & 1) : 0;
      float ang = u_angle + 90.0 * float(flip) + (hashI(id, uSeed + 11.0) - 0.5) * 2.0 * u_jitter;
      vec2 ctr = (vec2(float(i) + sh, float(j)) + 0.5) * cs;
      vec2 q = unrotCW(p - ctr, ang);
      float d;
      if (u_style == 0) d = geo_vesica(q, hl, hw);
      else if (u_style == 1) d = geo_capsule(q, hl, hw);
      else if (u_style == 2) {
        // n parallel bars along the axis, spread over the lozenge length across it.
        float nb = float(u_bars);
        float sp = 2.0 * hl / nb;
        float bw = 0.5 * u_width * sp;
        float k = clamp(floor(q.y / sp + 0.5 * nb), 0.0, nb - 1.0);
        float yc = (k + 0.5 - 0.5 * nb) * sp;
        d = geo_capsule(vec2(q.x, q.y - yc), hl, bw);
      } else d = length(q) - hw;
      if (d < best) { best = d; bestRnd = hashI(id, uSeed); }
    }
  }
  return genOut(0.0, 1.0, bestRnd, best);
}
`,
}

// ------------------------------------------------------------------------------------------------ weave

export const weaveLayer: LayerDef = {
  type: 'weave',
  label: 'Weave',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description:
    'Over-under woven strands (fabric, basket, wire mesh). Each visible float is a shape whose bevel dips where it passes under; per-float random.',
  params: [
    P.enum('pattern', 'Weave', 'plain', [
      ['plain', 'Plain (1/1)'],
      ['twill', 'Twill 2/2'],
      ['twill21', 'Twill 2/1'],
      ['twill31', 'Twill 3/1'],
      ['basket', 'Basket 2×2'],
      ['satin', 'Satin 4/1'],
      ['lattice', 'Lattice (horizontal on top)'],
    ], { hint: 'Lattice: no weaving — one layer of strips lies over the other (trellis, strap grates)' }),
    P.int('count_x', 'Strands X', 8, 1, 512, { softMax: 64, hint: 'Vertical strands across (a multiple of the weave repeat when tiling)' }),
    P.int('count_y', 'Strands Y', 8, 1, 512, { softMax: 64, hint: 'Horizontal strands down' }),
    orientParam('45° gives a diagonal (chain-link style) mesh; diagonal frames repeat over gcd(width, height)'),
    P.float('width', 'Strand width', 0.85, 0.05, 1, { step: 0.001, hint: 'Fraction of the strand pitch; lower values open holes (mesh)' }),
    P.float('gap', 'Gap', 1, 0, 64, { softMax: 4, unit: 'px', step: 0.1, hint: 'Clearance where a strand dives under another, and between neighbouring strands' }),
    P.float('dip', 'Over/under dip', 0.7, -1, 1, { step: 0.001, hint: '> 0 lengthens the bevel along each float so it ramps down where it passes under; < 0 removes the bevel at the cut ends (strips that run on underneath, e.g. lattices)' }),
    P.float('round', 'Corner rounding', 1, 0, 64, { softMax: 8, unit: 'px', step: 0.1 }),
    P.float('stud', 'Crossing studs', 0, 0, 256, { softMax: 8, unit: 'px', step: 0.1, hint: 'Radius of a rivet / stud at every crossing (0 = none)' }),
    rndModeParam(['Per float', 'Per direction (warp / weft)', 'Direction + random'], 'rnd per visible float, or 0.25 / 0.75 for horizontal / vertical strands'),
    P.seed(),
  ],
  defaults: {
    h_on: true,
    h_amount: 0.5,
    bevel: 3,
    profile: 'smooth',
    dif_on: true,
    dif_src: 'random',
    dif_grad: gradient('#5b4632', '#7d6246', '#9a7d5a'),
  },
  glsl:
    geoGlsl(4) +
    /* glsl */ `
int geo_repeat() {
  int m = u_pattern;
  return m == 0 ? 2 : m == 2 ? 3 : m == 5 ? 5 : m == 6 ? 1 : 4;
}
// Is the horizontal strand j over the vertical strand i at their crossing?
bool geo_overH(int i, int j) {
  int m = u_pattern;
  if (m == 0) return ((i + j) & 1) == 0;
  if (m == 1) return imod(i + j, 4) < 2;
  if (m == 2) return imod(i + j, 3) < 2;
  if (m == 3) return imod(i + j, 4) < 3;
  if (m == 4) return (((i >> 1) + (j >> 1)) & 1) == 0;
  if (m == 5) return imod(i + 2 * j, 5) != 0;
  return true;
}
// Strand 'line' of direction dir (0 = horizontal) is over the crossing strand 'c'.
bool geo_over(int dir, int c, int line) { return dir == 0 ? geo_overH(c, line) : !geo_overH(line, c); }

float geo_floatBest;
float geo_floatRnd;
int geo_floatDir;

// Visible float of strand 'line' (direction dir) between the under-crossings lo and hi.
// a = position along the strand (px), b = across (px).
void geo_floatSeg(int dir, int line, int lo, int hi, float a, float b, vec2 sp, float hwA, float hwX) {
  float pa = dir == 0 ? sp.x : sp.y;
  float pb = dir == 0 ? sp.y : sp.x;
  float x0 = (float(lo) + 0.5) * pa + hwX + u_gap;
  float x1 = (float(hi) + 0.5) * pa - hwX - u_gap;
  if (x1 <= x0) return;                       // fully hidden under the crossing strands
  float hx = 0.5 * (x1 - x0);
  vec2 q = vec2(a - 0.5 * (x0 + x1), b - (float(line) + 0.5) * pb);
  float r = min(u_round, min(hx, hwA));
  vec2 dq = abs(q) - vec2(hx, hwA) + r;
  float d = min(max(dq.x, dq.y), 0.0) + length(max(dq, 0.0)) - r;
  if (u_dip >= 0.0) {
    // Stretch the bevel along the float so it reads as dipping under at both ends.
    float f = mix(1.0, hwA / max(hx, hwA), u_dip);
    d = max(d, (abs(q.x) - hx) * f);
  } else if (d < 0.0) {
    // Negative dip: drop the bevel at the cut ends, so the strand reads as running on under its neighbour.
    d = mix(d, abs(q.y) - hwA, -u_dip);
  }
  if (d < geo_floatBest) {
    geo_floatBest = d;
    ivec2 R = ivec2(geo_repeat());
    // A strand that never dives under (lattice) is one feature: key it by the strand alone.
    int a0 = hi - lo >= 16 ? 0 : lo;
    ivec2 key = geo_keyI(dir == 0 ? ivec2(a0, line) : ivec2(line, a0), R);
    geo_floatRnd = hashI(ivec2(key.x * 2 + dir, key.y), uSeed);
    geo_floatDir = dir;
  }
}

// The float covering crossing c where the strand is over: runs to the nearest under-crossings either side.
void geo_float(int dir, int line, int c, float a, float b, vec2 sp, float hwA, float hwX) {
  int lo = c - 8, hi = c + 8;
  for (int k = 1; k <= 8; k++) { if (!geo_over(dir, c - k, line)) { lo = c - k; break; } }
  for (int k = 1; k <= 8; k++) { if (!geo_over(dir, c + k, line)) { hi = c + k; break; } }
  geo_floatSeg(dir, line, lo, hi, a, b, sp, hwA, hwX);
}

GenOut gen(vec2 p) {
  int R = geo_repeat();
  geo_frame(p, u_orient);
  vec2 k = vec2(float(u_count_x), float(u_count_y)) * geo_span / uRes / float(R);
  geo_periods(vec2(geo_count(k.x, 1), geo_count(k.y, 1)));
  vec2 sp = geo_cs / float(R);           // strand pitch (px)
  vec2 uu = geo_f / sp;
  float hwH = max(0.5 * u_width * sp.y - 0.5 * u_gap, 0.25);   // horizontal strands' half-width
  float hwV = max(0.5 * u_width * sp.x - 0.5 * u_gap, 0.25);
  geo_floatBest = 1e9;
  geo_floatRnd = 0.0;
  geo_floatDir = 0;
  ivec2 c = ivec2(floor(uu));
  for (int dir = 0; dir < 2; dir++) {
    int line0 = dir == 0 ? c.y : c.x;
    int cr = dir == 0 ? c.x : c.y;
    float a = dir == 0 ? geo_f.x : geo_f.y;
    float b = dir == 0 ? geo_f.y : geo_f.x;
    float hwA = dir == 0 ? hwH : hwV;
    float hwX = dir == 0 ? hwV : hwH;
    for (int dl = -1; dl <= 1; dl++) {
      int line = line0 + dl;
      float pb = dir == 0 ? sp.y : sp.x;
      if (abs(b - (float(line) + 0.5) * pb) - hwA >= geo_floatBest) continue;
      if (geo_over(dir, cr, line)) geo_float(dir, line, cr, a, b, sp, hwA, hwX);
      else {
        // Under here: the floats ending at this crossing, or the short segments between two under-crossings
        // (visible in the holes of an open weave / lattice).
        if (geo_over(dir, cr - 1, line)) geo_float(dir, line, cr - 1, a, b, sp, hwA, hwX);
        else geo_floatSeg(dir, line, cr - 1, cr, a, b, sp, hwA, hwX);
        if (geo_over(dir, cr + 1, line)) geo_float(dir, line, cr + 1, a, b, sp, hwA, hwX);
        else geo_floatSeg(dir, line, cr, cr + 1, a, b, sp, hwA, hwX);
      }
    }
  }
  if (u_stud > 0.0) {
    // Round studs at the crossings (union with the strands).
    vec2 cc = (vec2(c) + 0.5) * sp;
    float ds = length(geo_f - cc) - u_stud;
    // A stud sits on top: inside its radius it replaces the strands (its rim reads as a seam).
    if (ds < 0.0 || ds < geo_floatBest) { geo_floatBest = ds; geo_floatRnd = hashI(geo_keyI(c, ivec2(R)) + ivec2(7919, 0), uSeed); }
  }
  float rnd = geo_floatRnd;
  if (u_rnd_mode == 1) rnd = geo_floatDir == 0 ? 0.25 : 0.75;
  else if (u_rnd_mode == 2) rnd = (float(geo_floatDir) + 0.15 + 0.7 * geo_floatRnd) * 0.5;
  return genOut(0.0, 1.0, rnd, min(geo_floatBest, 1e4));
}
`,
}
