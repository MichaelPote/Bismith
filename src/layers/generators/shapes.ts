// SDF shape layers. Every shape shares placement (position, rotation), an outline (onion) option and a
// repeat grid with per-instance randomness; each type only supplies `float shapeSdf(vec2 q, float rnd)`
// in its local frame (q in px relative to the instance centre, y up, already un-rotated).

import { P, type ParamDef } from '@/core/params'
import type { LayerDef } from '../types'

const PLACEMENT: ParamDef[] = [
  P.float('x', 'X', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: 'Centre, 0..1 across (within each repeat cell)' }),
  P.float('y', 'Y', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: 'Centre, 0..1 down (within each repeat cell)' }),
  P.float('rotation', 'Rotation', 0, -360, 360, { softMin: -180, softMax: 180, unit: '°', step: 0.1 }),
  P.float('outline', 'Outline', 0, 0, 512, { softMax: 32, unit: 'px', step: 0.1, hint: '0 = solid; otherwise an inner stroke of this width' }),
]

const REPEAT: ParamDef[] = [
  P.int('rep_x', 'Count X', 1, 1, 256, { softMax: 16, group: 'repeat' }),
  P.int('rep_y', 'Count Y', 1, 1, 256, { softMax: 16, group: 'repeat' }),
  P.float('rep_stagger', 'Row offset', 0, 0, 1, { step: 0.001, group: 'repeat', hint: 'Shift odd rows (use an even row count to tile)' }),
  P.float('rep_jitter', 'Position jitter', 0, 0, 256, { softMax: 16, unit: 'px', step: 0.1, group: 'repeat' }),
  P.float('rep_rot', 'Rotation jitter', 0, 0, 180, { unit: '°', step: 0.1, group: 'repeat' }),
  P.float('rep_scale', 'Scale jitter', 0, 0, 0.95, { step: 0.001, group: 'repeat' }),
  P.float('rep_drop', 'Drop out', 0, 0, 1, { step: 0.001, group: 'repeat', hint: 'Fraction of instances removed at random' }),
  P.bool('rep_mirror', 'Mirror alternate cells', false, { group: 'repeat', hint: 'Mirror the position in odd columns/rows — e.g. 2×2 puts one instance in each corner' }),
  P.seed(),
]

// Instancing wrapper: evaluates the 3×3 neighbourhood of repeat cells (torus copies when tiling) and
// returns the union, carrying the nearest instance's random value.
const SHAPE_GEN = /* glsl */ `
GenOut gen(vec2 p) {
  vec2 reps = vec2(float(u_rep_x), float(u_rep_y));
  vec2 cell = uRes / reps;
  float best = 1e9;
  float bestRnd = 0.0;
  int cy0 = int(floor(p.y / cell.y));
  for (int j = -1; j <= 1; j++) {
    int cy = cy0 + j;
    // GL rows count upward; stagger alternate rows counted from the top so presets read naturally.
    int rowFromTop = int(reps.y) - 1 - cy;
    float shift = imod(rowFromTop, 2) == 1 ? u_rep_stagger : 0.0;
    int cx0 = int(floor(p.x / cell.x - shift));
    for (int i = -1; i <= 1; i++) {
      ivec2 c = ivec2(cx0 + i, cy);
      if (!uTile && (c.x < 0 || c.y < 0 || c.x >= int(reps.x) || c.y >= int(reps.y))) continue;
      ivec2 cw = uTile ? imod(c, ivec2(reps)) : c;
      vec3 h = hash3I(cw, uSeed);
      float h4 = hashI(cw, uSeed + 3.0);
      if (h4 < u_rep_drop) continue;
      vec2 off = vec2(u_x - 0.5, 0.5 - u_y);
      if (u_rep_mirror) {
        ivec2 cm = imod(c, ivec2(2));
        // Rows count up in GL; mirror relative to the top row so y keeps meaning "down from the top".
        int rowTop = imod(rowFromTop, 2);
        if (cm.x == 1) off.x = -off.x;
        if (rowTop == 1) off.y = -off.y;
      }
      vec2 centre = (vec2(c) + vec2(0.5 + shift, 0.5)) * cell + off * cell;
      centre += (h.xy - 0.5) * 2.0 * u_rep_jitter;
      float s = 1.0 - h.z * u_rep_scale;
      float ang = u_rotation + (hashI(cw, uSeed + 5.0) - 0.5) * 2.0 * u_rep_rot;
      vec2 q = unrotCW(p - centre, ang) / s;
      float d = shapeSdf(q, h.x, cell) * s;
      d = sdOnion(d, u_outline);
      if (d < best) { best = d; bestRnd = h.x; }
    }
  }
  return genOut(0.0, 1.0, bestRnd, best);
}
`

function shape(def: Omit<LayerDef, 'category' | 'kind' | 'sdf' | 'glsl' | 'groups'> & { sdfGlsl: string }): LayerDef {
  const { sdfGlsl, params, ...rest } = def
  return {
    ...rest,
    category: 'shape',
    kind: 'generator',
    sdf: true,
    params: [...params, ...PLACEMENT, ...REPEAT],
    groups: [{ id: 'repeat', label: 'Repeat', collapsed: true }],
    glsl: sdfGlsl + SHAPE_GEN,
    defaults: { h_on: true, h_amount: 0.5, dif_on: false, ...(def.defaults ?? {}) },
  }
}

const CORNERS: [string, string][] = [
  ['all', 'All'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['tl', 'Top-left (notch)'],
  ['tr', 'Top-right'],
  ['br', 'Bottom-right'],
  ['bl', 'Bottom-left'],
  ['diag', 'TL + BR'],
  ['antidiag', 'TR + BL'],
]

export const rectLayer = shape({
  type: 'rect',
  label: 'Rectangle',
  description: 'Rounded or chamfered rectangle, sized directly or inset from the edges (panels, buttons, wells).',
  params: [
    P.enum('size_mode', 'Size by', 'inset', [['inset', 'Inset from edges'], ['size', 'Width / height']]),
    P.float('inset_x', 'Inset X', 4, -1024, 2048, { softMin: 0, softMax: 64, unit: 'px', step: 0.5, showIf: (p) => p.size_mode === 'inset' }),
    P.float('inset_y', 'Inset Y', 4, -1024, 2048, { softMin: 0, softMax: 64, unit: 'px', step: 0.5, showIf: (p) => p.size_mode === 'inset' }),
    P.float('width', 'Width', 64, 0, 4096, { softMax: 512, unit: 'px', step: 0.5, showIf: (p) => p.size_mode === 'size' }),
    P.float('height', 'Height', 32, 0, 4096, { softMax: 512, unit: 'px', step: 0.5, showIf: (p) => p.size_mode === 'size' }),
    P.float('radius', 'Corner', 4, 0, 1024, { softMax: 64, unit: 'px', step: 0.1 }),
    P.enum('corner_style', 'Corner style', 'round', [['round', 'Round'], ['chamfer', 'Chamfer']]),
    P.enum('corners', 'Corners', 'all', CORNERS),
  ],
  sdfGlsl: /* glsl */ `
vec4 cornerMask(int m) {
  // x: top-right, y: bottom-right, z: top-left, w: bottom-left (GL, y up)
  if (m == 1) return vec4(1, 0, 1, 0);
  if (m == 2) return vec4(0, 1, 0, 1);
  if (m == 3) return vec4(0, 0, 1, 1);
  if (m == 4) return vec4(1, 1, 0, 0);
  if (m == 5) return vec4(0, 0, 1, 0);
  if (m == 6) return vec4(1, 0, 0, 0);
  if (m == 7) return vec4(0, 1, 0, 0);
  if (m == 8) return vec4(0, 0, 0, 1);
  if (m == 9) return vec4(0, 1, 1, 0);
  if (m == 10) return vec4(1, 0, 0, 1);
  return vec4(1);
}
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  vec2 b = u_size_mode == 0 ? cell * 0.5 - vec2(u_inset_x, u_inset_y) : vec2(u_width, u_height) * 0.5;
  b = max(b, vec2(0.0));
  vec4 r = cornerMask(u_corners) * u_radius;
  if (u_corner_style == 0) return sdRoundBox(q, b, r);
  float d = sdBox(q, b);
  float rc = q.x > 0.0 ? (q.y > 0.0 ? r.x : r.y) : (q.y > 0.0 ? r.z : r.w);
  rc = min(rc, min(b.x, b.y));
  if (rc > 0.0) d = max(d, (abs(q.x) + abs(q.y) - (b.x + b.y - rc)) * 0.70710678);
  return d;
}
`,
})

export const ellipseLayer = shape({
  type: 'ellipse',
  label: 'Circle / Ellipse',
  description: 'Circles, ellipses and (with an outline) rings — rivets, bolts, gems, dials.',
  params: [
    P.float('radius', 'Radius', 24, 0, 4096, { softMax: 256, unit: 'px', step: 0.1 }),
    P.float('squash', 'Aspect', 1, 0.01, 100, { softMin: 0.1, softMax: 4, step: 0.001, hint: 'Height / width' }),
  ],
  sdfGlsl: /* glsl */ `
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  return sdEllipse(q, vec2(u_radius, u_radius * u_squash));
}
`,
})

export const polygonLayer = shape({
  type: 'polygon',
  label: 'Polygon / Star',
  description: 'Regular polygons and stars with rounded corners.',
  params: [
    P.int('sides', 'Sides', 6, 3, 32, { softMax: 12 }),
    P.float('radius', 'Radius', 24, 0, 4096, { softMax: 256, unit: 'px', step: 0.1 }),
    P.bool('star', 'Star', false),
    P.float('inner', 'Inner ratio', 0.5, 0.05, 1, { step: 0.001, showIf: (p) => Boolean(p.star) }),
    P.float('round', 'Rounding', 0, 0, 256, { softMax: 16, unit: 'px', step: 0.1 }),
  ],
  sdfGlsl: /* glsl */ `
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  float r = max(u_radius - u_round, 0.0);
  float d = u_star ? sdStar(q, r, u_sides, u_inner) : sdNgon(q, r, u_sides);
  return d - u_round;
}
`,
})

export const lineLayer = shape({
  type: 'line',
  label: 'Line',
  description: 'Straight strokes: seams, grooves, light strips, scratches.',
  params: [
    P.float('length', 'Length', 96, 0, 8192, { softMax: 512, unit: 'px', step: 0.5 }),
    P.float('thickness', 'Thickness', 2, 0, 1024, { softMax: 32, unit: 'px', step: 0.1 }),
    P.enum('caps', 'Caps', 'round', [['round', 'Round'], ['flat', 'Flat']]),
  ],
  defaults: { bevel: 1 },
  sdfGlsl: /* glsl */ `
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  vec2 a = vec2(-u_length * 0.5, 0.0), b = vec2(u_length * 0.5, 0.0);
  float t = u_thickness * 0.5;
  return u_caps == 1 ? sdSegmentFlat(q, a, b, t) : sdSegment(q, a, b) - t;
}
`,
})

export const curveLayer = shape({
  type: 'curve',
  label: 'Curve',
  description: 'Quadratic Bézier stroke — bent pipes, arcs, cables.',
  params: [
    P.float('length', 'Length', 96, 0, 8192, { softMax: 512, unit: 'px', step: 0.5 }),
    P.float('bend', 'Bend', 32, -4096, 4096, { softMin: -256, softMax: 256, unit: 'px', step: 0.5, hint: 'Offset of the control point' }),
    P.float('bend_at', 'Bend position', 0, -1, 1, { step: 0.001 }),
    P.float('thickness', 'Thickness', 3, 0, 1024, { softMax: 32, unit: 'px', step: 0.1 }),
  ],
  defaults: { bevel: 1.5 },
  sdfGlsl: /* glsl */ `
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  vec2 a = vec2(-u_length * 0.5, 0.0), c = vec2(u_length * 0.5, 0.0);
  vec2 b = vec2(u_bend_at * u_length * 0.5, u_bend * 2.0);
  return sdBezier(q, a, b, c) - u_thickness * 0.5;
}
`,
})

export const crossLayer = shape({
  type: 'cross',
  label: 'Cross',
  description: 'Plus / cross shapes — screws, markers.',
  params: [
    P.float('size', 'Size', 16, 0, 4096, { softMax: 128, unit: 'px', step: 0.1 }),
    P.float('arm', 'Arm width', 4, 0, 2048, { softMax: 64, unit: 'px', step: 0.1 }),
    P.float('round', 'Rounding', 0, 0, 256, { softMax: 16, unit: 'px', step: 0.1 }),
  ],
  sdfGlsl: /* glsl */ `
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  return sdCross(q, vec2(u_size, u_arm * 0.5), 0.0) - u_round;
}
`,
})

export const SHAPE_LAYERS = [rectLayer, ellipseLayer, polygonLayer, lineLayer, curveLayer, crossLayer]
