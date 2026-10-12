// Structured pattern layers (FR2.4): bricks, hex tiles, Voronoi cells, checker, grid lines, stripes.
// Cell-based patterns are SDF generators: they return the distance (px, negative inside) to the edge of the
// feature under the pixel plus a per-feature random, so the common shape params can bevel them and the
// channel outputs can vary them per brick / cell / tile. Every lattice wraps its indices when the project is
// tileable, so the pattern repeats seamlessly. (Clouds, gradients and scratches live in patternsFill.ts.)

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { cloudsLayer, gradientLayer, scratchesLayer } from './patternsFill'

/** Small GLSL helpers shared by the pattern layers (each layer compiles its own copy; names are prefixed). */
export const PAT_GLSL = /* glsl */ `
int pat_imod(int a, int m) { return ((a % m) + m) % m; }

// Convex cells (hex tiles, Voronoi cells) are intersections of half-planes. We keep the PAT_K nearest edges
// of the cell under the pixel (distance m, positive inside; outward unit normal n), then build an exact
// signed distance with rounded corners from them.
#define PAT_K 4
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
  for (int i = 0; i < PAT_K; i++)
  for (int j = i + 1; j < PAT_K; j++) {
    if (ms[j] > 1e8) continue;
    d = max(d, pat_wedgeDist(r - ms[i], ns[i], r - ms[j], ns[j]));
  }
  return d - r;
}
`

// GenOut.sdf value meaning "no distance for this pixel" (the wrapper's NO_SDF is declared after gen()).
const NO_SDF = '-1e5'

// ------------------------------------------------------------------------------------------------ bricks

export const bricksLayer: LayerDef = {
  type: 'bricks',
  label: 'Bricks',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Running-bond brickwork with mortar, rounding and per-brick randomness; distance to the brick edge.',
  params: [
    P.int('columns', 'Columns', 4, 1, 256, { softMax: 32, hint: 'Bricks across the texture width' }),
    P.int('rows', 'Rows', 8, 1, 256, { softMax: 64, hint: 'Brick courses down the texture (use an even count with stagger to tile)' }),
    P.float('stagger', 'Stagger', 0.5, 0, 1, { step: 0.001, hint: 'Offset of alternate rows, as a fraction of a brick' }),
    P.float('mortar', 'Mortar', 2, -32, 256, { softMin: -4, softMax: 16, unit: 'px', step: 0.1, hint: 'Gap between bricks. Negative grows the bricks into each other so they touch in creases (with position jitter: dry-stone walls)' }),
    P.float('round', 'Corner rounding', 1, 0, 256, { softMax: 16, unit: 'px', step: 0.1 }),
    P.float('row_jitter', 'Row offset jitter', 0, 0, 1, { step: 0.001, hint: 'Random horizontal shift per row, fraction of a brick' }),
    P.float('len_var', 'Length variation', 0, 0, 1, { step: 0.001, hint: 'Randomly moves the joints so bricks differ in length' }),
    P.float('row_var', 'Course height variation', 0, 0, 1, { step: 0.001, hint: 'Randomly moves the bed joints so courses differ in height (rubble / ashlar walls)' }),
    P.float('size_jitter', 'Edge jitter', 0, 0, 64, { softMax: 4, unit: 'px', step: 0.1, hint: 'Random inset of each brick side (uneven, hand-laid look)' }),
    P.float('wobble', 'Wobble', 0, 0, 32, { softMax: 4, unit: 'px', step: 0.05, hint: 'Noisy, chipped brick edges' }),
    P.float('pos_jitter', 'Position jitter', 0, 0, 64, { softMax: 6, unit: 'px', step: 0.05, hint: 'Random x/y shift per brick — hand-placed stone walls. Overlapping stones meet in a crease, not mortar' }),
    P.float('rot_jitter', 'Rotation jitter', 0, 0, 45, { softMax: 10, unit: '°', step: 0.1, hint: 'Random tilt per brick' }),
    P.bool('vertical', 'Vertical courses', false, { hint: 'Run the courses up the texture (columns then count along a course, rows across)' }),
    P.seed(),
  ],
  defaults: {
    h_on: true,
    h_amount: 0.5,
    bevel: 2,
    profile: 'round',
    dif_on: true,
    dif_src: 'random',
    dif_grad: gradient('#4e2419', '#7a3a27', '#93513a', '#a8674c'),
  },
  glsl:
    PAT_GLSL +
    /* glsl */ `
// Joint k of a row, in brick units. A shift < 0.45 keeps joints ordered (length variation).
float pat_joint(int k, int rw) {
  if (u_len_var <= 0.0) return float(k);
  int kw = uTile ? pat_imod(k, u_columns) : k;
  return float(k) + (hashI(ivec2(kw, rw), uSeed + 23.0) - 0.5) * 0.9 * u_len_var;
}

// Bed joint above course r (between r − 1 and r), in px. A shift < 0.45 courses keeps them ordered; snapped to
// whole pixels so the jittered courses stay crisp.
float pat_rowEdge(int r, float ch) {
  if (u_row_var <= 0.0) return float(r) * ch;
  int rb = uTile ? pat_imod(r, u_rows) : r;
  return floor((float(r) + (hashI(ivec2(rb, 3), uSeed + 61.0) - 0.5) * 0.9 * u_row_var) * ch + 0.5);
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
  vec2 cs = res / vec2(float(u_columns), float(u_rows));
  int r0 = int(floor(p.y / cs.y));
  float best = 1e9;
  float second = 1e9;
  float bestRnd = 0.0;
  for (int j = -1; j <= 1; j++) {
    int r = r0 + j;
    int rw = uTile ? pat_imod(r, u_rows) : r;
    float s = pat_rowShift(rw);
    float ry0 = pat_rowEdge(r, cs.y), ry1 = pat_rowEdge(r + 1, cs.y);
    int k0 = int(floor(p.x / cs.x - s));
    for (int i = -2; i <= 2; i++) {
      int k = k0 + i;
      float x0 = pat_joint(k, rw);
      float x1 = pat_joint(k + 1, rw);
      ivec2 id = ivec2(uTile ? pat_imod(k, u_columns) : k, rw);
      float rnd = hashI(id, uSeed);
      // Mortar runs along the left and top (on screen) of each cell, so whole-pixel brick sizes and mortar
      // widths put every edge on a pixel boundary.
      vec2 ctr = vec2((0.5 * (x0 + x1) + s) * cs.x, 0.5 * (ry0 + ry1)) + vec2(0.5, -0.5) * u_mortar;
      vec2 hs = vec2((x1 - x0) * cs.x, ry1 - ry0) * 0.5 - 0.5 * u_mortar;
      if (u_size_jitter > 0.0) {
        // Independent random inset per side: left, right, bottom, top.
        vec4 sj = vec4(hash3I(id, uSeed + 41.0), hashI(id, uSeed + 43.0)) * u_size_jitter;
        hs -= 0.5 * vec2(sj.x + sj.y, sj.z + sj.w);
        ctr += 0.5 * vec2(sj.x - sj.y, sj.z - sj.w);
      }
      if (u_pos_jitter > 0.0) ctr += (hash2I(id, uSeed + 71.0) - 0.5) * 2.0 * u_pos_jitter;
      vec2 q = p - ctr;
      if (u_rot_jitter > 0.0) {
        float a = (hashI(id, uSeed + 73.0) - 0.5) * 2.0 * radians(u_rot_jitter);
        q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
      }
      float d = sdRoundBox(q, max(hs, vec2(0.0)), vec4(u_round));
      if (d < best) { second = best; best = d; bestRnd = rnd; }
      else if (d < second) second = d;
    }
  }
  // Overlapping bricks (jitter) meet in a crease: inside the union, the distance to the boundary between the two
  // nearest bricks is (second − best) / 2. Equals best whenever bricks do not overlap.
  best = max(best, 0.5 * (best - second));
  if (u_wobble > 0.0) {
    // Features about half a brick course tall.
    vec2 wc = vec2(2.0 * float(u_rows) * res.x / res.y, 2.0 * float(u_rows));
    if (uTile) wc = max(floor(wc + 0.5), vec2(1.0));
    ivec2 wper = uTile ? ivec2(wc) : NO_PERIOD;
    float n = fractalNoise(1, 1, p / res * wc, wper, 3, 2.0, 0.5, uSeed + 57.0);
    best += (n - 0.5) * 4.0 * u_wobble;
  }
  return genOut(0.0, 1.0, bestRnd, best);
}
`,
}

// ------------------------------------------------------------------------------------------------ hex tiles

export const hexLayer: LayerDef = {
  type: 'hex',
  label: 'Hex tiles',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Hexagonal tiling with grout gap and per-tile random. Tiles exactly when the project is tileable (see hint).',
  params: [
    P.float('scale', 'Scale', 6, 1, 256, { softMax: 32, step: 0.01, hint: 'Hexes across the texture width. When tiling, whole counts with an even row count are needed; the nearest choice that keeps hexes regular is used (count may differ by 1–2, slight stretch possible)' }),
    P.enum('orient', 'Orientation', 'pointy', [['pointy', 'Pointy top'], ['flat', 'Flat top']]),
    P.float('gap', 'Gap', 2, 0, 256, { softMax: 16, unit: 'px', step: 0.1 }),
    P.float('round', 'Corner rounding', 0, 0, 256, { softMax: 16, unit: 'px', step: 0.1 }),
    P.seed(),
  ],
  defaults: {
    h_on: true,
    h_amount: 0.5,
    bevel: 2,
    profile: 'smooth',
    dif_on: true,
    dif_src: 'random',
    dif_grad: gradient('#3a4148', '#56606a', '#6f6a5e', '#8b8170'),
  },
  glsl:
    PAT_GLSL +
    /* glsl */ `
// Lattice centre of tile (c, r) in the working frame: rows run along x, odd rows shift half a cell.
vec2 pat_hexCentre(int c, int r, vec2 cs) {
  return vec2((float(c) + 0.5 + 0.5 * float(r & 1)) * cs.x, (float(r) + 0.5) * cs.y);
}

GenOut gen(vec2 p) {
  // Work in a frame where the hexes are pointy-topped; flat-top swaps the axes.
  bool flatTop = u_orient == 1;
  vec2 res = flatTop ? uRes.yx : uRes;
  vec2 q = flatTop ? p.yx : p;
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
      if (pc < (flatTop ? 2.0 : 1.0)) continue;
      for (int k = 0; k < 2; k++) {
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
  // Tile edges are the bisectors with the neighbouring centres (inset by half the gap).
  float ms[PAT_K];
  vec2 ns[PAT_K];
  for (int i = 0; i < PAT_K; i++) { ms[i] = 1e9; ns[i] = vec2(0.0); }
  for (int j = -2; j <= 2; j++) {
    int r = bc.y + j;
    for (int i = -2; i <= 2; i++) {
      if (i == 0 && j == 0) continue;
      vec2 rv = pat_hexCentre(bc.x + i, r, cs) - q;
      vec2 nn = normalize(rv - br);
      pat_pushEdge(ms, ns, dot(0.5 * (br + rv), nn) - 0.5 * u_gap, nn);
    }
  }
  ivec2 id = uTile ? imod(bc, per) : bc;
  return genOut(0.0, 1.0, hashI(id, uSeed), pat_cellSdf(ms, ns, u_round));
}
`,
}

// ------------------------------------------------------------------------------------------------ voronoi

export const voronoiLayer: LayerDef = {
  type: 'voronoi',
  noise: true,
  label: 'Voronoi',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Cellular pattern: bevelled cells (cobbles, flagstones) or F1 / F2 / edge / crackle values.',
  params: [
    P.enum('output', 'Output', 'cells', [
      ['cells', 'Cells (shape)'],
      ['f1', 'F1 (distance to point)'],
      ['f2', 'F2'],
      ['edges', 'Edges (F2 − F1)'],
      ['crackle', 'Crackle'],
      ['facets', 'Facets (tilted planes)'],
    ], { hint: 'Cells is a shape (bevelled by the Shape params); the others are plain values. Facets: each cell a flat plane tilted a random way — with height Min, broad faceted cuts (chipped stone edges)' }),
    P.float('tilt', 'Facet tilt', 1, 0, 8, { softMax: 3, step: 0.01, showIf: (p) => p.output === 'facets', hint: 'Plane slope (value change across one cell)' }),
    P.float('scale', 'Scale', 6, 0.25, 256, { softMax: 32, step: 0.01, hint: 'Cells across the texture width (rounded when tiling)' }),
    P.float('jitter', 'Jitter', 0.8, 0, 1, { step: 0.001, hint: '0 = regular grid' }),
    P.enum('metric', 'Metric', 'euclidean', [['euclidean', 'Euclidean'], ['manhattan', 'Manhattan'], ['chebyshev', 'Chebyshev']]),
    P.float('gap', 'Gap', 2, 0, 256, { softMax: 16, unit: 'px', step: 0.1, showIf: (p) => p.output === 'cells' || p.output === 'crackle', hint: 'Cells: grout width. Crackle: crack falloff width' }),
    P.float('round', 'Corner rounding', 4, 0, 256, { softMax: 16, unit: 'px', step: 0.1, showIf: (p) => p.output === 'cells' && p.metric === 'euclidean' }),
    P.float('warp', 'Warp', 0, 0, 256, { softMax: 16, unit: 'px', step: 0.05, hint: 'Noise displacement — irregular cell borders' }),
    P.float('warp_scale', 'Warp scale', 8, 0.25, 128, { softMax: 32, step: 0.01, showIf: (p) => Number(p.warp) > 0 }),
    P.seed(),
  ],
  defaults: {
    h_on: true,
    h_amount: 0.5,
    bevel: 3,
    profile: 'round',
    dif_on: true,
    dif_src: 'random',
    dif_grad: gradient('#4a463f', '#6b655a', '#7f776a', '#958b7b'),
  },
  glsl:
    PAT_GLSL +
    /* glsl */ `
float pat_metric(vec2 r) {
  return u_metric == 1 ? abs(r.x) + abs(r.y) : u_metric == 2 ? max(abs(r.x), abs(r.y)) : length(r);
}
// Gradient of the (piecewise linear) Manhattan / Chebyshev metric.
vec2 pat_metricGrad(vec2 v) {
  if (u_metric == 1) return sign(v);
  return abs(v.x) > abs(v.y) ? vec2(sign(v.x), 0.0) : vec2(0.0, sign(v.y));
}

GenOut gen(vec2 p) {
  vec2 cells = cellsFor(u_scale, 1.0);
  ivec2 per = uTile ? ivec2(cells) : NO_PERIOD;
  vec2 cs = uRes / cells;
  if (u_warp > 0.0) {
    vec2 wc = cellsFor(u_warp_scale, 1.0);
    ivec2 wper = uTile ? ivec2(wc) : NO_PERIOD;
    p += warpOffset(p / uRes * wc, wper, uSeed + 7.0) * 2.0 * u_warp;
  }
  // Feature points live in px space so distances (and the gap) are true pixels on any aspect ratio.
  ivec2 ip = ivec2(floor(p / cs));
  float F1 = 1e9, F2 = 1e9;
  vec2 mr = vec2(0.0);
  ivec2 mc = ip;
  for (int j = -2; j <= 2; j++)
  for (int i = -2; i <= 2; i++) {
    ivec2 c = ip + ivec2(i, j);
    vec2 o = 0.5 + (cellPoint(imod(c, per), uSeed) - 0.5) * u_jitter;
    vec2 r = (vec2(c) + o) * cs - p;
    float d = pat_metric(r);
    if (d < F1) { F2 = F1; F1 = d; mr = r; mc = c; }
    else if (d < F2) { F2 = d; }
  }
  float rnd = hashI(imod(mc, per), uSeed + 17.0);
  float L = sqrt(cs.x * cs.y);

  if (u_output == 1) return genOut(clamp(F1 / L, 0.0, 1.0), 1.0, rnd, ${NO_SDF});
  if (u_output == 2) return genOut(clamp(F2 / L, 0.0, 1.0), 1.0, rnd, ${NO_SDF});
  if (u_output == 3) return genOut(clamp(2.0 * (F2 - F1) / L, 0.0, 1.0), 1.0, rnd, ${NO_SDF});
  if (u_output == 5) {
    // A plane through the cell's site, tilted in a random direction with a random share of the slope.
    float a = hashI(imod(mc, per), uSeed + 29.0) * 6.2831853;
    float k = u_tilt * (0.4 + 0.6 * hashI(imod(mc, per), uSeed + 31.0));
    return genOut(clamp(0.5 + dot(-mr, vec2(cos(a), sin(a))) / L * k, 0.0, 1.0), 1.0, rnd, ${NO_SDF});
  }

  // Cell edges (inset by half the gap): exact bisectors for Euclidean; the other metrics get a border
  // distance estimate and no corner rounding (their cells need not be convex).
  float g = 0.5 * u_gap;
  float ms[PAT_K];
  vec2 ns[PAT_K];
  for (int i = 0; i < PAT_K; i++) { ms[i] = 1e9; ns[i] = vec2(0.0); }
  if (u_metric == 0) {
    for (int j = -2; j <= 2; j++)
    for (int i = -2; i <= 2; i++) {
      if (i == 0 && j == 0) continue;
      ivec2 c = mc + ivec2(i, j);
      vec2 o = 0.5 + (cellPoint(imod(c, per), uSeed) - 0.5) * u_jitter;
      vec2 r = (vec2(c) + o) * cs - p;
      vec2 dr = r - mr;
      if (dot(dr, dr) < 1e-6) continue;
      vec2 nn = normalize(dr);
      pat_pushEdge(ms, ns, dot(0.5 * (mr + r), nn) - g, nn);
    }
  } else {
    // Each bisector is the zero set of g = M(p - b) - M(p - a), which is piecewise linear, so g / |grad g|
    // is its distance in px (exact within a linear piece; plateaus where g is constant are far away).
    float md = 1e9;
    for (int j = -2; j <= 2; j++)
    for (int i = -2; i <= 2; i++) {
      if (i == 0 && j == 0) continue;
      ivec2 c = mc + ivec2(i, j);
      vec2 o = 0.5 + (cellPoint(imod(c, per), uSeed) - 0.5) * u_jitter;
      vec2 r = (vec2(c) + o) * cs - p;
      float gv = max(pat_metric(r) - F1, 0.0);
      float gl = length(pat_metricGrad(-r) - pat_metricGrad(-mr));
      md = min(md, gl > 0.5 ? gv / gl : (gv < 1e-3 ? 0.0 : 1e4));
    }
    ms[0] = md - g;
  }
  if (u_output == 4) {
    float v = 1.0 - clamp((ms[0] + g) / max(u_gap, 0.5), 0.0, 1.0);
    return genOut(v * v, 1.0, rnd, ${NO_SDF});
  }
  return genOut(0.0, 1.0, rnd, pat_cellSdf(ms, ns, u_metric == 0 ? u_round : 0.0));
}
`,
}

// ------------------------------------------------------------------------------------------------ checker

export const checkerLayer: LayerDef = {
  type: 'checker',
  label: 'Checker',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Checkerboard, as a two-tone value or as bevelled squares.',
  params: [
    P.enum('mode', 'Output', 'value', [['value', 'Two-tone value'], ['shape', 'Squares (shape)']], { hint: 'Shape makes the squares an SDF for bevels; value gives 0 / 1 for a colour ramp' }),
    P.int('count_x', 'Count X', 8, 1, 512, { softMax: 32, hint: 'Squares across (rounded up to even when tiling)' }),
    P.int('count_y', 'Count Y', 8, 1, 512, { softMax: 32, hint: 'Squares down (rounded up to even when tiling)' }),
    P.float('gap', 'Gap', 0, 0, 256, { softMax: 16, unit: 'px', step: 0.1 }),
    P.float('round', 'Corner rounding', 0, 0, 256, { softMax: 16, unit: 'px', step: 0.1 }),
    P.seed(),
  ],
  defaults: {
    dif_on: true,
    dif_grad: gradient('#2c2a27', '#b3aa9a'),
    bevel: 2,
  },
  glsl:
    PAT_GLSL +
    /* glsl */ `
GenOut gen(vec2 p) {
  ivec2 n = ivec2(u_count_x, u_count_y);
  if (uTile) n += n & ivec2(1);   // a checker only repeats with even counts
  vec2 cs = uRes / vec2(n);
  ivec2 c0 = ivec2(floor(p / cs));
  float best = 1e9;
  float rnd = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec2 c = c0 + ivec2(i, j);
    // "On" squares: the top-left square and every other one.
    if (((c.x + n.y - 1 - c.y) & 1) != 0) continue;
    vec2 ctr = (vec2(c) + 0.5) * cs + vec2(0.5, -0.5) * u_gap;   // gap along the left / top: pixel aligned
    float d = sdRoundBox(p - ctr, max(0.5 * (cs - u_gap), vec2(0.0)), vec4(u_round));
    if (d < best) { best = d; rnd = hashI(uTile ? imod(c, n) : c, uSeed); }
  }
  if (u_mode == 1) return genOut(0.0, 1.0, rnd, best);
  float v = u_aa ? clamp(0.5 - best, 0.0, 1.0) : (best <= 0.0 ? 1.0 : 0.0);
  return genOut(v, 1.0, hashI(uTile ? imod(c0, n) : c0, uSeed), ${NO_SDF});
}
`,
}

// ------------------------------------------------------------------------------------------------ grid lines

export const gridLayer: LayerDef = {
  type: 'grid',
  label: 'Grid lines',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Grid of lines as a shape — panel seams, tile grout, etched guides. Per-panel random.',
  params: [
    P.int('count_x', 'Count X', 4, 0, 512, { softMax: 32, hint: 'Vertical lines across the width (0 = none)' }),
    P.int('count_y', 'Count Y', 4, 0, 512, { softMax: 32, hint: 'Horizontal lines down the height (0 = none)' }),
    P.float('width', 'Line width', 2, 0, 512, { softMax: 16, unit: 'px', step: 0.1 }),
    P.float('offset_x', 'Offset X', 0, 0, 1, { step: 0.001, hint: 'Shift, as a fraction of a cell' }),
    P.float('offset_y', 'Offset Y', 0, 0, 1, { step: 0.001 }),
    P.seed(),
  ],
  defaults: {
    h_on: true,
    h_mode: 'subtract',
    h_amount: 0.4,
    bevel: 1,
    profile: 'linear',
    dif_on: true,
    dif_src: 'flat',
    dif_opacity: 0.7,
    dif_grad: gradient('#1d1b19'),
  },
  glsl:
    PAT_GLSL +
    /* glsl */ `
GenOut gen(vec2 p) {
  vec2 n = max(vec2(float(u_count_x), float(u_count_y)), vec2(1.0));
  vec2 cs = uRes / n;
  // Cell coordinates in user orientation (y down) so offsets read naturally. Each line starts at a cell
  // edge and runs width px right / down, so whole-pixel cells and widths land on pixel boundaries.
  vec2 u = vec2(p.x, uRes.y - p.y) / cs - vec2(u_offset_x, u_offset_y);
  vec2 t = u - 0.5 * u_width / cs;
  vec2 dl = abs(t - floor(t + 0.5)) * cs;
  if (u_count_x == 0) dl.x = 1e9;
  if (u_count_y == 0) dl.y = 1e9;
  float d = min(dl.x, dl.y) - 0.5 * u_width;
  ivec2 c = ivec2(floor(u));
  if (uTile) c = imod(c, ivec2(n));
  return genOut(0.0, 1.0, hashI(c, uSeed), d);
}
`,
}

// ------------------------------------------------------------------------------------------------ stripes

export const stripesLayer: LayerDef = {
  type: 'stripes',
  label: 'Stripes',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Parallel stripes at any angle (snapped to the nearest seamless angle when tiling); shape or wave value.',
  params: [
    P.enum('mode', 'Output', 'shape', [
      ['shape', 'Stripes (shape)'],
      ['square', 'Soft square'],
      ['sine', 'Sine'],
      ['triangle', 'Triangle'],
      ['saw', 'Sawtooth'],
    ], { hint: 'Shape makes each stripe an SDF for bevels; the others are plain values across the period' }),
    P.float('count', 'Count', 8, 0.25, 512, { softMax: 64, step: 0.01, hint: 'Stripes per texture width (period = width / count)' }),
    P.float('angle', 'Angle', 0, -360, 360, { softMin: -180, softMax: 180, unit: '°', step: 0.1, hint: 'Stripe direction, clockwise from horizontal. Snapped to a seamless angle when tiling' }),
    P.float('duty', 'Width', 0.5, 0, 1, { step: 0.001, showIf: (p) => p.mode === 'shape' || p.mode === 'square', hint: 'Fraction of each period covered by the stripe' }),
    P.float('soft', 'Softness', 0, 0, 256, { softMax: 32, unit: 'px', step: 0.1, showIf: (p) => p.mode === 'square' }),
    P.float('offset', 'Phase', 0, 0, 1, { step: 0.001 }),
    P.seed(),
  ],
  defaults: { h_on: true, h_amount: 0.4, bevel: 2, profile: 'round' },
  glsl:
    PAT_GLSL +
    /* glsl */ `
int pat_gcd(int a, int b) {
  a = abs(a); b = abs(b);
  for (int i = 0; i < 64; i++) { if (b == 0) break; int t = a % b; a = b; b = t; }
  return max(a, 1);
}

GenOut gen(vec2 p) {
  vec2 up = vec2(p.x, uRes.y - p.y);             // user space (y down)
  float a = radians(u_angle);
  vec2 k = vec2(-sin(a), cos(a)) * u_count / uRes.x;   // stripe normal, cycles per px
  int g = 1;
  if (uTile) {
    // Whole cycles across each axis -> seamless; this snaps the angle to the nearest tileable one.
    vec2 cyc = floor(k * uRes + 0.5);
    if (cyc.x == 0.0 && cyc.y == 0.0) cyc.y = 1.0;
    k = cyc / uRes;
    g = pat_gcd(int(cyc.x), int(cyc.y));
  }
  float f = dot(up, k) - u_offset;
  float period = 1.0 / length(k);
  float fi = floor(f);
  int idx = int(fi);
  if (uTile) idx = pat_imod(idx, g);
  float rnd = hashI(ivec2(idx, 0), uSeed);
  // ph = 0 at a stripe's leading edge, which is a pixel boundary when the period is whole pixels. The stripe
  // covers ph in [0, duty).
  float ph = f - fi;
  float hc = 0.5 * u_duty;
  float d = (abs(fract(ph - hc + 0.5) - 0.5) - hc) * period;
  if (u_mode == 0) return genOut(0.0, 1.0, rnd, d);
  // Waves peak a quarter period in (the centre of a 50% stripe), so a 2 px period alternates per pixel.
  float w = ph - 0.25;
  float v;
  if (u_mode == 1) v = clamp(0.5 - d / max(u_soft, 1.0), 0.0, 1.0);
  else if (u_mode == 2) v = 0.5 + 0.5 * cos(TAU * w);
  else if (u_mode == 3) v = 1.0 - 2.0 * abs(fract(w + 0.5) - 0.5);
  else v = ph;
  return genOut(v, 1.0, rnd, ${NO_SDF});
}
`,
}

/** Pattern-category layers, in add-menu order. */
export const PATTERN_LAYERS: LayerDef[] = [
  bricksLayer,
  hexLayer,
  voronoiLayer,
  checkerLayer,
  gridLayer,
  stripesLayer,
  gradientLayer,
  scratchesLayer,
]

export { cloudsLayer }
