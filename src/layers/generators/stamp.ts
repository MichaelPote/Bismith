// Stamp and Label (FR7.5): hand-drawn pixel bitmaps and pixel-font text as shapes — crate insignia, painted
// emblems, panel numbers and warning lettering that no procedural motif can reproduce. The bitmap is an SDF
// (distance to the nearest cell of the other state), so the usual bevel/profile/height/colour outputs apply;
// the cell level (1..3) is the per-feature random, so a Per-feature colour ramp paints multi-tone bitmaps.

import { MAX_PATH_POINTS } from '@/core/bitmap'
import { P, type ParamDef } from '@/core/params'
import type { LayerDef } from '../types'

const placement: ParamDef[] = [
  P.float('x', 'X', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: 'Centre, 0..1 across' }),
  P.float('y', 'Y', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: 'Centre, 0..1 down' }),
  P.float('scale', 'Pixel size', 1, 0.25, 64, { softMax: 8, unit: 'px', step: 0.05, hint: 'Texture px per bitmap cell (integers stay crisp)' }),
  P.enum('rotate', 'Rotate', '0', [['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']]),
  P.int('count_x', 'Repeat X', 1, 1, 64, { softMax: 16 }),
  P.int('count_y', 'Repeat Y', 1, 1, 64, { softMax: 16 }),
  P.float('step_x', 'Step X', 16, 0, 4096, { softMax: 128, unit: 'px', step: 0.5, showIf: (p) => Number(p.count_x) > 1 }),
  P.float('step_y', 'Step Y', 16, 0, 4096, { softMax: 128, unit: 'px', step: 0.5, showIf: (p) => Number(p.count_y) > 1 }),
  P.float('skew', 'Row shift', 0, -4096, 4096, { softMin: -32, softMax: 32, unit: 'px', step: 0.5, showIf: (p) => Number(p.count_y) > 1, hint: 'Shifts each row of repeats sideways — diagonal rivet lines, staggered grids' }),
]

const defaults = { bevel: 0, profile: 'flat', aa: false, h_on: true, h_amount: 0.2, dif_on: true, dif_src: 'random' }

const glsl = (key: string, mirror: boolean) => /* glsl */ `
int stampCell(ivec2 c) {
  ivec2 sz = u_${key}_size;
  ${mirror ? `if (u_mirror > 0) { int w = sz.x * 2 - (u_mirror == 1 ? 1 : 0); if (c.x >= sz.x && c.x < w) c.x = w - 1 - c.x; }` : ''}
  if (c.x < 0 || c.y < 0 || c.x >= sz.x || c.y >= sz.y) return 0;
  ivec4 r = u_${key}[c.y];
  int w = c.x < 16 ? r.x : c.x < 32 ? r.y : c.x < 48 ? r.z : r.w;
  return (w >> ((c.x & 15) * 2)) & 3;
}

GenOut gen(vec2 p) {
  ivec2 sz = u_${key}_size;
  if (sz.x == 0 || sz.y == 0) return genOut(0.0, 0.0, 0.0, 1e4);
  vec2 dims = vec2(sz);
  ${mirror ? `if (u_mirror > 0) dims.x = dims.x * 2.0 - (u_mirror == 1 ? 1.0 : 0.0);` : ''}
  bool odd = u_rotate == 1 || u_rotate == 3;
  vec2 outDims = odd ? dims.yx : dims;
  float sc = max(u_scale, 0.01);

  // Nearest instance (wrapping on tileable projects), snapped so integer pixel sizes stay on the pixel grid.
  vec2 q = vec2(p.x, uRes.y - p.y);
  vec2 centre = vec2(u_x, u_y) * uRes;
  vec2 dq = q - centre;
  if (uTile) dq -= uRes * floor(dq / uRes + 0.5);
  vec2 cnt = vec2(float(u_count_x), float(u_count_y));
  vec2 stp = vec2(u_step_x, u_step_y);
  float iy = clamp(floor(dq.y / max(stp.y, 1e-3) + (cnt.y - 1.0) * 0.5 + 0.5), 0.0, cnt.y - 1.0);
  float shift = (iy - (cnt.y - 1.0) * 0.5) * u_skew;
  float ix = clamp(floor((dq.x - shift) / max(stp.x, 1e-3) + (cnt.x - 1.0) * 0.5 + 0.5), 0.0, cnt.x - 1.0);
  vec2 idx = vec2(ix, iy);
  vec2 ic = centre + (idx - (cnt - 1.0) * 0.5) * stp + vec2(shift, 0.0);
  vec2 tl = floor(ic - outDims * sc * 0.5 + 0.5);
  vec2 ob = (centre + dq - tl) / sc;

  // Output cell space → bitmap cell space.
  vec2 b = u_rotate == 1 ? vec2(ob.y, dims.y - ob.x)
         : u_rotate == 2 ? dims - ob
         : u_rotate == 3 ? vec2(dims.x - ob.y, ob.x)
         : ob;

  ivec2 cell = ivec2(floor(b));
  int lvl = stampCell(cell);
  bool inside = lvl > 0;
  int R = clamp(int(ceil((u_bevel + 1.0) / sc)), 1, 4);
  // Far from the bitmap: plain box distance.
  vec2 bd = max(max(-b, b - dims), 0.0);
  if (max(bd.x, bd.y) > float(R)) return genOut(1.0, 1.0, 0.0, length(bd) * sc);
  float best = 1e9;
  for (int j = -4; j <= 4; j++)
  for (int i = -4; i <= 4; i++) {
    if (abs(i) > R || abs(j) > R) continue;
    ivec2 n = cell + ivec2(i, j);
    if ((stampCell(n) > 0) == inside) continue;
    vec2 d = max(max(vec2(n) - b, b - vec2(n + 1)), 0.0);
    best = min(best, dot(d, d));
  }
  float dist = best < 1e8 ? sqrt(best) * sc : float(R) * sc;
  return genOut(1.0, 1.0, float(lvl) / 3.0, inside ? -dist : dist);
}
`

export const stampLayer: LayerDef = {
  type: 'stamp',
  label: 'Stamp',
  category: 'shape',
  kind: 'generator',
  sdf: true,
  description: 'A hand-drawn pixel bitmap (insignia, emblem, decal) as a shape: one row per line, # full, + mid, - low, . empty.',
  params: [
    P.bitmap('pixels', 'Pixels', '..#..\n.###.\n#####\n.###.\n..#..', 'pixels', {
      hint: 'One row per line (max 64×64): "#" full, "+" mid, "-" low level, "." or space empty. Levels drive Per-feature colour',
    }),
    P.enum('mirror', 'Mirror', 'none', [['none', 'None'], ['odd', 'Mirror (shared centre column)'], ['even', 'Mirror (no shared column)']], {
      hint: 'Draw only the left half; the right half is reflected',
    }),
    ...placement,
  ],
  defaults,
  glsl: glsl('pixels', true),
}

export const labelLayer: LayerDef = {
  type: 'label',
  label: 'Label',
  category: 'shape',
  kind: 'generator',
  sdf: true,
  description: 'Pixel-font lettering (5 px capitals, digits, punctuation) — crate numbers, panel codes, warning text.',
  params: [
    P.bitmap('text', 'Text', '03', 'font', { hint: 'Capitals, digits and - . : / ! + = ; "|" or a new line starts a centred line' }),
    ...placement,
  ],
  defaults,
  glsl: glsl('text', false),
}

export const pathLayer: LayerDef = {
  type: 'path',
  label: 'Path',
  category: 'shape',
  kind: 'generator',
  sdf: true,
  description: 'Arbitrary polygons from a vertex list — chamfered cut-outs, Z-shaped channels, trims; overlapping polygons cut holes (even–odd).',
  params: [
    P.bitmap('points', 'Points', '8,16 24,8 56,8 56,48 40,56 8,56', 'points', {
      hint: 'x,y vertex pairs (px from the top-left, or 0..1 with Units = fraction); one polygon per line or "|". Max 64 vertices',
    }),
    P.enum('units', 'Units', 'px', [['px', 'Pixels'], ['fraction', 'Fraction of the texture']]),
  ],
  defaults: { bevel: 1, profile: 'linear', h_on: true, h_amount: 0.3, dif_on: true },
  glsl: /* glsl */ `
vec2 pathSdf(vec2 q, vec2 k) {
  int n = u_points_size.x;
  float d = 1e20;
  float s = 1.0;
  float pid = 0.0;
  for (int i = 0; i < ${MAX_PATH_POINTS}; i++) {
    if (i >= n) break;
    vec4 a4 = u_points[i];
    vec2 a = a4.xy * k;
    vec2 b = u_points[int(a4.z)].xy * k;
    vec2 e = b - a;
    vec2 w = q - a;
    vec2 h = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
    float dd = dot(h, h);
    if (dd < d) { d = dd; pid = a4.w; }
    bvec3 c = bvec3(q.y >= a.y, q.y < b.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return vec2(s * sqrt(d), pid);
}

GenOut gen(vec2 p) {
  if (u_points_size.x < 3) return genOut(0.0, 0.0, 0.0, 1e4);
  // Fractions of the texture's width and height, as the shape editor draws them.
  vec2 k = u_units == 1 ? uRes : vec2(1.0);
  vec2 q = vec2(p.x, uRes.y - p.y);
  vec2 r = pathSdf(q, k);
  if (uTile) {
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      vec2 o = pathSdf(q + vec2(float(i), float(j)) * uRes, k);
      if (o.x < r.x) r = o;
    }
  }
  return genOut(1.0, 1.0, hashI(ivec2(int(r.y), 7), uSeed), r.x);
}
`,
}

export const polylineLayer: LayerDef = {
  type: 'polyline',
  label: 'Polyline',
  category: 'shape',
  kind: 'generator',
  sdf: true,
  description: 'Open polylines with a width — cables, trims, cracks, painted lines; drawn with the Line tool on the canvas. Round joins; round or flat ends.',
  params: [
    P.bitmap('points', 'Points', '8,32 56,32', 'lines', {
      hint: 'x,y vertex pairs (px from the top-left, or 0..1 with Units = fraction); one line per row or "|". Max 64 vertices',
    }),
    P.enum('units', 'Units', 'px', [['px', 'Pixels'], ['fraction', 'Fraction of the texture']]),
    P.float('width', 'Width', 3, 0.25, 1024, { softMax: 32, unit: 'px', step: 0.25 }),
    P.enum('caps', 'Ends', 'round', [['round', 'Round'], ['flat', 'Flat']]),
  ],
  defaults: { bevel: 1.5, profile: 'round', h_on: true, h_amount: 0.4, dif_on: true },
  glsl: /* glsl */ `
// Distance to the open polylines (segments whose "next" wraps back close a line: skipped), minus half the width.
vec2 lineSdf(vec2 q, vec2 k, float hw) {
  int n = u_points_size.x;
  float d = 1e20;
  float pid = 0.0;
  for (int i = 0; i < ${MAX_PATH_POINTS}; i++) {
    if (i >= n) break;
    vec4 a4 = u_points[i];
    int j = int(a4.z);
    if (j <= i) continue;
    vec2 a = a4.xy * k;
    vec2 b = u_points[j].xy * k;
    vec2 e = b - a;
    float L = max(length(e), 1e-6);
    vec2 t = e / L;
    vec2 w = q - a;
    float u = dot(w, t);
    float v = dot(w, vec2(-t.y, t.x));
    float dd = length(vec2(u - clamp(u, 0.0, L), v)) - hw;
    if (u_caps == 1) {
      // Flat ends: cut square at a line's first and last vertex.
      bool first = i == 0 || u_points[i - 1].w != a4.w;
      bool last = int(u_points[j].z) <= j;
      if (first && u < 0.0) dd = max(abs(v) - hw, -u);
      if (last && u > L) dd = max(abs(v) - hw, u - L);
    }
    if (dd < d) { d = dd; pid = a4.w; }
  }
  return vec2(d, pid);
}

GenOut gen(vec2 p) {
  if (u_points_size.x < 2) return genOut(0.0, 0.0, 0.0, 1e4);
  // Fractions of the texture's width and height, as the shape editor draws them.
  vec2 k = u_units == 1 ? uRes : vec2(1.0);
  float hw = 0.5 * u_width;
  vec2 q = vec2(p.x, uRes.y - p.y);
  vec2 r = lineSdf(q, k, hw);
  if (uTile) {
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      vec2 o = lineSdf(q + vec2(float(i), float(j)) * uRes, k, hw);
      if (o.x < r.x) r = o;
    }
  }
  return genOut(1.0, 1.0, hashI(ivec2(int(r.y), 7), uSeed), r.x);
}
`,
}

export const STAMP_LAYERS: LayerDef[] = [stampLayer, labelLayer, pathLayer, polylineLayer]
