// Tabs & notches (FR8.8): small greeble details with diagonal cuts — the clip notches on a grate frame,
// chevrons, bow-tie bridges, diagonal slits and chamfered plates — placed along the texture's edges, on a grid or
// scattered. A crisp SDF shape (value 1 inside), meant for very small relief (a 1 px lit edge) and colour.
//
// Local frame per element: u along its edge (centred), v inward from the edge (≥ 0 inside the texture). Grid and
// scatter elements use the same frame centred on their cell.

import { P } from '@/core/params'
import type { LayerDef } from '../types'

const EDGES: [string, string][] = [
  ['sides', 'Left + right'],
  ['ends', 'Top + bottom'],
  ['all', 'All four'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
]

export const tabsLayer: LayerDef = {
  type: 'tabs',
  label: 'Tabs & notches',
  category: 'shape',
  kind: 'generator',
  sdf: true,
  description: 'Small details with diagonal cuts — trapezoid tabs, notches, chevrons, bow-ties, slits, chamfered plates — along the edges, on a grid or scattered.',
  params: [
    P.enum('shape', 'Shape', 'trapezoid', [
      ['trapezoid', 'Trapezoid tab (45° sides)'],
      ['notch', 'Notch (triangle)'],
      ['chevron', 'Chevron (V stroke)'],
      ['bowtie', 'Bow-tie'],
      ['slit', 'Diagonal slit'],
      ['plate', 'Chamfered plate'],
    ]),
    P.enum('place', 'Placement', 'border', [['border', 'Along the edges'], ['grid', 'Grid'], ['scatter', 'Scattered']]),
    P.enum('edges', 'Edges', 'sides', EDGES, { showIf: (p) => p.place === 'border' }),
    P.int('count', 'Count', 3, 1, 256, { softMax: 16, hint: 'Per edge (along the edges) or across (grid / scatter)' }),
    P.int('rows', 'Rows', 3, 1, 256, { softMax: 16, showIf: (p) => p.place !== 'border' }),
    P.float('length', 'Length', 8, 0.5, 1024, { softMax: 32, unit: 'px', step: 0.5, hint: 'Along the edge (the wide side of a tab)' }),
    P.float('depth', 'Depth', 4, 0.5, 1024, { softMax: 16, unit: 'px', step: 0.5, hint: 'Inward from the edge' }),
    P.float('cut', 'Diagonal cut', 1, 0, 2, { step: 0.01, hint: 'Slope of the cut sides: 1 = 45°, 0 = square', showIf: (p) => p.shape === 'trapezoid' || p.shape === 'plate' }),
    P.float('thickness', 'Stroke', 1.5, 0.5, 64, { softMax: 6, unit: 'px', step: 0.5, showIf: (p) => p.shape === 'chevron' || p.shape === 'slit' }),
    P.float('angle', 'Slit angle', 45, -90, 90, { unit: '°', step: 1, showIf: (p) => p.shape === 'slit' }),
    P.float('inset', 'Inset', 0, -64, 256, { softMin: -8, softMax: 32, unit: 'px', step: 0.5, hint: 'Shift away from the edge (negative straddles it)' }),
    P.float('offset', 'Offset', 0, -1, 1, { step: 0.001, hint: 'Shift along, fraction of the spacing' }),
    P.bool('alternate', 'Alternate', false, { hint: 'Flip every other element (grid / scatter)' }),
    P.float('jitter', 'Jitter', 0.5, 0, 1, { step: 0.001, showIf: (p) => p.place === 'scatter', hint: 'Random offset within the cell' }),
    P.float('density', 'Density', 0.6, 0, 1, { step: 0.001, showIf: (p) => p.place === 'scatter' }),
    P.seed(),
  ],
  defaults: { h_on: true, h_mode: 'subtract', h_amount: 0.15, bevel: 0.5, profile: 'linear', aa: false, dif_on: true, dif_src: 'flat' },
  glsl: /* glsl */ `
const float TB_R2 = 0.70710678;

// One element in its local frame: u along (centred), v inward (0 at the edge).
float tb_shape(vec2 q) {
  float u = q.x, v = q.y;
  float hl = 0.5 * u_length, d = u_depth;
  if (u_shape == 0) {
    // Trapezoid: full length at the edge, sides cut inward at the given slope.
    float k = u_cut;
    return max(max(-v, v - d), (abs(u) - (hl - v * k)) / sqrt(1.0 + k * k));
  }
  if (u_shape == 1) {
    float k = hl / max(d, 1e-3);
    return max(-v, (abs(u) - (hl - v * k)) / sqrt(1.0 + k * k));
  }
  if (u_shape == 2) {
    float s = min(sdSegment(q, vec2(-hl, 0.0), vec2(0.0, d)), sdSegment(q, vec2(0.0, d), vec2(hl, 0.0)));
    return s - 0.5 * u_thickness;
  }
  if (u_shape == 3) {
    // Bow-tie: two triangles meeting tip to tip at the middle of the depth.
    float k = d / max(2.0 * hl, 1e-3) * 2.0;
    float w = abs(v - 0.5 * d) - abs(u) * k;
    return max(abs(u) - hl, max(w / sqrt(1.0 + k * k), abs(v - 0.5 * d) - 0.5 * d));
  }
  if (u_shape == 4) {
    vec2 r = rotCW(vec2(u, v - 0.5 * d), u_angle);
    return sdBox(r, vec2(hl, 0.5 * u_thickness));
  }
  // Chamfered plate.
  vec2 c = vec2(abs(u), abs(v - 0.5 * d));
  vec2 b = vec2(hl, 0.5 * d);
  float ch = min(b.x, b.y) * clamp(u_cut, 0.0, 1.0);
  return max(sdBox(c, b), (c.x + c.y - (b.x + b.y - ch)) * TB_R2);
}

// Nearest element along one edge: 'along' runs the edge, 'inward' is the distance from it.
float tb_edge(float along, float inward, float span, out float id) {
  float n = float(max(u_count, 1));
  float sp = span / n;
  float t = along / sp - 0.5 - u_offset;
  float i = floor(t + 0.5);
  id = uTile ? mod(i, n) : i;
  if (!uTile && (i < 0.0 || i > n - 1.0)) return 1e4;
  float u = (t - i) * sp;
  return tb_shape(vec2(u, inward - u_inset));
}

GenOut gen(vec2 p) {
  float best = 1e4;
  float bid = 0.0;
  if (u_place == 0) {
    // Edges: 0 sides, 1 ends, 2 all, 3 left, 4 right, 5 top, 6 bottom. p.y = 0 is the bottom of the image.
    bool L = u_edges == 0 || u_edges == 2 || u_edges == 3;
    bool R = u_edges == 0 || u_edges == 2 || u_edges == 4;
    bool T = u_edges == 1 || u_edges == 2 || u_edges == 5;
    bool B = u_edges == 1 || u_edges == 2 || u_edges == 6;
    float top = uRes.y - p.y;
    float id;
    float d;
    if (L) { d = tb_edge(top, p.x, uRes.y, id); if (d < best) { best = d; bid = id; } }
    if (R) { d = tb_edge(top, uRes.x - p.x, uRes.y, id); if (d < best) { best = d; bid = id + 101.0; } }
    if (T) { d = tb_edge(p.x, top, uRes.x, id); if (d < best) { best = d; bid = id + 211.0; } }
    if (B) { d = tb_edge(p.x, p.y, uRes.x, id); if (d < best) { best = d; bid = id + 307.0; } }
  } else {
    ivec2 n = ivec2(max(u_count, 1), max(u_rows, 1));
    vec2 cs = uRes / vec2(n);
    vec2 g = p / cs;
    ivec2 c0 = ivec2(floor(g));
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        ivec2 c = c0 + ivec2(i, j);
        ivec2 cw = uTile ? imod(c, n) : c;
        if (!uTile && (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, n)))) continue;
        vec2 ctr = (vec2(c) + 0.5 + vec2(u_offset, 0.0)) * cs;
        bool flip = u_alternate && ((cw.x + cw.y) & 1) == 1;
        if (u_place == 2) {
          if (hashI(cw, uSeed + 3.0) > u_density) continue;
          ctr += (hash2I(cw, uSeed) - 0.5) * cs * u_jitter;
          flip = hashI(cw, uSeed + 7.0) > 0.5;
        }
        vec2 q = p - ctr;
        q = vec2(q.x, (flip ? q.y : -q.y) + 0.5 * u_depth - u_inset);
        float d = tb_shape(q);
        if (d < best) { best = d; bid = float(cw.x + cw.y * 977); }
      }
  }
  return genOut(1.0, 1.0, hashI(ivec2(int(bid), 17), uSeed), best);
}
`,
}
