// SDF shape layers. Every shape shares placement (position, rotation), an outline (onion) option, a repeat grid with
// per-instance randomness and a Bevel span (the bevel to the middle of the shape); each type supplies, in its local
// frame (q in px relative to the instance centre, y up, already un-rotated):
//   float shapeSdf(vec2 q, float rnd, vec2 cell)   its signed distance (px, < 0 inside)
//   float shapeExtent(vec2 cell)                   how far it can reach from its centre (px, a bound): the instancing
//                                                  visits every repeat cell whose instance can reach the pixel
//   float shapeInradius(vec2 cell)                 its greatest depth (px): Bevel span › To the middle spans it
// and optionally:
//   gShapeBevel = …           (in shapeSdf) a distance to measure the bevel in instead of the outline's — Cross: each
//                             arm on its own, so the arms don't rise where they cross
//   #define SHAPE_CUT         float shapeCut(vec2 q, float d, float outline): applied after the outline — Ellipse's sweep,
//                             so an outlined ellipse cut by it becomes an arc rather than the outline of a pie slice
//   #define SHAPE_DOME        float shapeDome(vec2 q, vec2 cell): a smooth 0..1 dome (1 in the middle) for Bevel span ›
//                             Pillow / Dome, or < 0 to fall back to the distance

import { P, type ParamDef, type ParamValues } from '@/core/params'
import { spacingParams } from '../commonParams'
import type { LayerDef } from '../types'

const PLACEMENT: ParamDef[] = [
  P.float('x', 'X', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: 'Centre, 0..1 across (within each repeat cell)' }),
  P.float('y', 'Y', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: 'Centre, 0..1 down (within each repeat cell)' }),
  P.float('rotation', 'Rotation', 0, -360, 360, { softMin: -180, softMax: 180, unit: '°', step: 0.1 }),
  P.float('outline', 'Outline', 0, 0, 1024, { softMax: 64, unit: 'px', step: 0.1, hint: '0 = solid; otherwise an inner stroke of this width' }),
]

const REPEAT: ParamDef[] = [
  P.int('rep_x', 'Count X', 1, 1, 256, { softMax: 32, group: 'repeat' }),
  P.int('rep_y', 'Count Y', 1, 1, 256, { softMax: 32, group: 'repeat' }),
  ...spacingParams({ group: 'repeat' }),
  P.float('rep_stagger', 'Row offset', 0, 0, 1, { step: 0.001, group: 'repeat', hint: 'Shift odd rows (use an even row count to tile)' }),
  P.float('rep_jitter', 'Position jitter', 0, 0, 1024, { softMax: 64, unit: 'px', step: 0.1, group: 'repeat', hint: 'Moves each instance up to this far from its place (each axis), at random' }),
  P.float('rep_rot', 'Rotation jitter', 0, 0, 180, { unit: '°', step: 0.1, group: 'repeat', hint: 'Turns each instance by up to this much either way, at random' }),
  P.float('rep_rot_step', 'Rotation steps', 0, 0, 180, {
    softMax: 90,
    unit: '°',
    step: 0.1,
    group: 'repeat',
    showIf: (p) => Number(p.rep_rot) > 0,
    hint: 'Snaps the random turns to multiples of this angle (0 = any angle): 90 with a Rotation jitter of 180 turns each instance by a random quarter turn — notched tiles, hooks facing every way',
  }),
  P.enum('rep_flip', 'Random flip', 'none', [
    ['none', 'None'],
    ['x', 'Left / right'],
    ['y', 'Up / down'],
    ['both', 'Both'],
  ], { group: 'repeat', hint: 'Mirrors instances at random (each chosen axis for half of them), so asymmetric shapes — a hooked curve, a notched corner — face both ways' }),
  P.float('rep_scale', 'Scale jitter', 0, 0, 0.95, { step: 0.001, group: 'repeat', hint: 'Shrinks each instance by up to this fraction, at random' }),
  P.bool('rep_scale_bevel', 'Scale the bevel too', true, {
    group: 'repeat',
    showIf: (p) => Number(p.rep_scale) > 0,
    hint: 'Shrunk instances get a proportionally narrower bevel — scaled copies of one shape. Off: every instance keeps the Bevel width in px (small ones domed, large ones flat-topped)',
  }),
  P.float('rep_drop', 'Drop out', 0, 0, 1, { step: 0.001, group: 'repeat', hint: 'Fraction of instances removed at random' }),
  P.bool('rep_mirror', 'Mirror alternate cells', false, { group: 'repeat', hint: 'Mirror the position in odd columns/rows — e.g. 2×2 puts one instance in each corner' }),
  P.seed(),
]

/** Bevel span: Edge › Bevel's width, or all the way to the middle (and, for some shapes, a smooth dome). */
const spanParam = (smooth?: [string, string]): ParamDef =>
  P.enum('dome', 'Bevel span', 'off', [
    ['off', 'Bevel width', 'the bevel is Edge › Bevel wide'],
    ['middle', 'To the middle', 'the bevel rises from the edge all the way to the middle, whatever the shape’s size — roofs, pyramids, rods, lenses (Edge › Profile still shapes the rise)'],
    ...(smooth ? [['smooth', smooth[0], smooth[1]] as [string, string, string]] : []),
  ], { hint: 'How far in the bevel reaches. The spans to the middle need a Bevel above 0 and apply with no mask written or in Mask › Mode Normal' })

// Before the type's GLSL: what a shape may set while it measures itself.
const SHAPE_PRE = /* glsl */ `
float gShapeBevel = 1e9;   // a shape's own bevel distance (local units), 1e9 = the outline's
`
// Stroke shapes: how much of the width the taper has taken at t (0 = full width … 1 = the thin end), and its slope.
// Taper curve c ≥ 1: t^c (wide for longer, rounded sides — leaves); c < 1: 1 − (1 − t)^(1/c) (narrowing early, hollow
// sides ending in a fine point — needles). c = 1: straight sides.
const TAPER_GLSL = /* glsl */ `
vec2 taperShape(float t) {
  float c = max(u_taper_curve, 0.05);
  if (c >= 1.0) return vec2(pow(t, c), c * pow(max(t, 1e-3), c - 1.0));
  float k = 1.0 / c;
  return vec2(1.0 - pow(1.0 - t, k), k * pow(max(1.0 - t, 1e-3), k - 1.0));
}
`

// Instancing: the union of every repeat instance that can reach p — the shape's extent, the position jitter and the
// offset of X / Y decide how many that is (at least the neighbours either side, more for shapes larger than their
// step), with copies round the torus when tiling (repGrid; Column / Row spacing moves the instances, while their cells
// still size the shapes). One flat loop with uniform-derived bounds, so D3D compiles the shape once (and no "continue",
// which ANGLE can miscompile). The nearest instance also gives the bevel distance (GenOut.bdist): the outline's in px,
// the shape's own (Cross), scaled with the instance, or spanned to the middle.
const SHAPE_GEN = /* glsl */ `
GenOut gen(vec2 p) {
  ivec2 R = ivec2(u_rep_x, u_rep_y);
  vec2 cell = uRes / vec2(R);
  vec2 pitch = vec2(repPitch(uRes.x, R.x, u_col_sp, uRes.x), repPitch(uRes.y, R.y, u_row_sp, uRes.y));
  vec2 off0 = vec2(u_x - 0.5, 0.5 - u_y);
  // How far an instance's place can be from p and still reach it (+2 px for the anti-aliasing), and at least a step.
  vec2 reach = max(vec2(shapeExtent(cell) + u_rep_jitter + 2.0), pitch) + abs(off0) * pitch;
  float inr = shapeInradius(cell);
  float shift = u_rep_stagger * pitch.x;
  RepGrid rg = repGrid(R, pitch, 0.5 * uRes, uRes, uTile, p - reach - vec2(shift, 0.0), p + reach);
  int n = repCount(rg);
  float best = 1e9;
  float bestRnd = 0.0;
  float bestBd = 0.0;
  for (int k = 0; k < n; k++) {
    ivec2 cw;
    vec2 centre;
    repAt(rg, k, cw, centre);
    // Rows and the mirror count from the top, on the instance (the same on every copy round the torus, so the copies
    // across an edge match).
    int rowFromTop = R.y - 1 - cw.y;
    if (imod(rowFromTop, 2) == 1) centre.x += shift;
    // Drop out: the body wrapped in a test rather than a "continue".
    if (hashI(cw, uSeed + 3.0) >= u_rep_drop) {
      vec3 h = hash3I(cw, uSeed);
      float rnd = hashI(cw, uSeed + 7.0);   // the instance's own random (Diffuse jitter, Per-feature variation), apart from its jitter
      vec2 off = off0;
      if (u_rep_mirror) {
        if (imod(cw.x, 2) == 1) off.x = -off.x;
        if (imod(rowFromTop, 2) == 1) off.y = -off.y;
      }
      centre += off * pitch + (h.xy - 0.5) * 2.0 * u_rep_jitter;
      float s = 1.0 - h.z * u_rep_scale;
      float jr = (hashI(cw, uSeed + 5.0) - 0.5) * 2.0 * u_rep_rot;
      if (u_rep_rot_step > 0.0) jr = floor(jr / u_rep_rot_step + 0.5) * u_rep_rot_step;
      vec2 q = unrotCW(p - centre, u_rotation + jr) / s;
      if (u_rep_flip > 0) {
        vec2 hf = hash3I(cw, uSeed + 11.0).xy;
        if ((u_rep_flip == 1 || u_rep_flip == 3) && hf.x < 0.5) q.x = -q.x;
        if ((u_rep_flip == 2 || u_rep_flip == 3) && hf.y < 0.5) q.y = -q.y;
      }
      // In the instance's own units (scaled), so the outline keeps its width in px.
      float ol = u_outline / s;
      gShapeBevel = 1e9;
      float dl = shapeSdf(q, rnd, cell);
      float bl = gShapeBevel < 1e8 ? gShapeBevel : dl;
      dl = sdOnion(dl, ol);
      if (ol > 0.0) bl = dl;
#ifdef SHAPE_CUT
      dl = shapeCut(q, dl, ol);
      bl = max(bl, dl);
#endif
      float d = dl * s;
      if (d < best) {
        best = d;
        bestRnd = rnd;
        if (u_dome > 0) {
          // Spanned to the middle: the depth over the shape's greatest depth (a ring's: half its width), as px of Bevel.
          float t = clamp(-bl / max(ol > 0.0 ? min(inr, ol * 0.5) : inr, 1e-3), 0.0, 1.0);
#ifdef SHAPE_DOME
          if (u_dome == 2 && ol <= 0.0) {
            float ts = shapeDome(q, cell);
            if (ts >= 0.0) t = min(ts, 2.5 * t);   // (the distance keeps it at 0 on corners the dome doesn't follow)
          }
#endif
          bestBd = -t * u_bevel;
        } else {
          bestBd = u_rep_scale_bevel ? bl : bl * s;
        }
      }
    }
  }
  GenOut g = genOut(0.0, 1.0, bestRnd, best);
  // Bevel aspect on the shape's own bevel distance, as the wrapper applies it to the outline's (not to the spans).
  vec2 gr = vec2(dFdx(best), dFdy(best));
  float gg = dot(gr, gr);
  vec2 n2 = gg > 1e-12 ? gr * gr / gg : vec2(0.5);
  vec2 W = bevelWidths();
  float wa = u_dome > 0 ? u_bevel : sqrt(dot(n2, W * W));
  g.bdist = bestBd * u_bevel / max(wa, 1e-4);
  return g;
}
`

type ShapeDef = Omit<LayerDef, 'category' | 'kind' | 'sdf' | 'glsl' | 'groups'> & { sdfGlsl: string }

function shape(def: ShapeDef): LayerDef {
  const { sdfGlsl, params, ...rest } = def
  return {
    ...rest,
    category: 'shape',
    kind: 'generator',
    sdf: true,
    params: [...params, ...PLACEMENT, ...REPEAT],
    groups: [{ id: 'repeat', label: 'Repeat', collapsed: true }],
    glsl: SHAPE_PRE + sdfGlsl + SHAPE_GEN,
    // Diffuse fills the shape (Source › Shape) rather than following the bevel's rise through the ramp.
    defaults: { h_on: true, h_amount: 0.5, dif_on: false, dif_src: 'shape', ...(def.defaults ?? {}) },

  }
}

/** Editor defaults sized to the texture: a shape that reads at any size, with a bevel wide enough to show. */
const half = (v: number) => Math.round(v * 2) / 2
const short = (t: { width: number; height: number }) => Math.min(t.width, t.height)
const freshBevel = (t: { width: number; height: number }) => half(Math.min(Math.max(short(t) / 64, 1.5), 24))

const CORNERS: [string, string][] = [
  ['all', 'All'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['tl', 'Top-left'],
  ['tr', 'Top-right'],
  ['br', 'Bottom-right'],
  ['bl', 'Bottom-left'],
  ['diag', 'TL + BR'],
  ['antidiag', 'TR + BL'],
]

export const rectLayer = shape({
  type: 'rect',
  label: 'Rectangle',
  description: 'Rounded, chamfered, scooped or notched rectangle, sized directly or inset from the edges (panels, buttons, wells, pillows).',
  params: [
    P.enum('size_mode', 'Size by', 'inset', [['inset', 'Inset from edges'], ['size', 'Width / height']]),
    P.float('inset_x', 'Inset X', 4, -1024, 2048, { softMin: 0, softMax: 128, unit: 'px', step: 0.5, showIf: (p) => p.size_mode === 'inset', hint: 'Margin left and right (from the texture, or from each repeat cell)' }),
    P.float('inset_y', 'Inset Y', 4, -1024, 2048, { softMin: 0, softMax: 128, unit: 'px', step: 0.5, showIf: (p) => p.size_mode === 'inset', hint: 'Margin top and bottom (from the texture, or from each repeat cell)' }),
    P.float('width', 'Width', 64, 0, 8192, { softMax: 1024, unit: 'px', step: 0.5, showIf: (p) => p.size_mode === 'size' }),
    P.float('height', 'Height', 32, 0, 8192, { softMax: 1024, unit: 'px', step: 0.5, showIf: (p) => p.size_mode === 'size' }),
    P.float('radius', 'Corner', 4, 0, 2048, { softMax: 512, unit: 'px', step: 0.1, hint: 'Size of the corner, up to half the shorter side (there: a stadium, or a circle)' }),
    P.enum('corner_style', 'Corner style', 'round', [
      ['round', 'Round'],
      ['chamfer', 'Chamfer', 'cut off at 45°'],
      ['scoop', 'Scoop', 'a quarter circle cut into the corner'],
      ['notch', 'Notch', 'a square cut out of the corner'],
    ]),
    P.enum('corners', 'Corners', 'all', CORNERS, { hint: 'Which corners get the corner style; the others stay square' }),
    spanParam(['Pillow', 'a smooth cushion over the whole rectangle, highest in the middle, without the ridges a bevel makes where its sides meet']),
  ],
  fresh: (t) => ({ inset_x: Math.round(short(t) / 16), inset_y: Math.round(short(t) / 16), radius: Math.round(short(t) / 32), bevel: freshBevel(t) }),
  sdfGlsl: /* glsl */ `
// The corners each Corners option shapes: (top-right, bottom-right, top-left, bottom-left) in GL (y up).
const vec4 CORNER_SETS[11] = vec4[11](vec4(1.0), vec4(1, 0, 1, 0), vec4(0, 1, 0, 1), vec4(0, 0, 1, 1), vec4(1, 1, 0, 0),
  vec4(0, 0, 1, 0), vec4(1, 0, 0, 0), vec4(0, 1, 0, 0), vec4(0, 0, 0, 1), vec4(0, 1, 1, 0), vec4(1, 0, 0, 1));
vec2 rectHalf(vec2 cell) {
  return max(u_size_mode == 0 ? cell * 0.5 - vec2(u_inset_x, u_inset_y) : vec2(u_width, u_height) * 0.5, vec2(0.0));
}
float shapeExtent(vec2 cell) { return length(rectHalf(cell)); }
float shapeInradius(vec2 cell) { vec2 b = rectHalf(cell); return min(b.x, b.y); }
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  vec2 b = rectHalf(cell);
  vec4 r = CORNER_SETS[clamp(u_corners, 0, 10)] * min(u_radius, min(b.x, b.y));
  if (u_corner_style == 0) return sdRoundBox(q, b, r);
  float d = sdBox(q, b);
  if (u_corner_style == 1) {
    // Chamfers: a 45° half-plane per corner, all four everywhere — exact inside even where one reaches past the middle.
    vec4 pl = (vec4(q.x + q.y, q.x - q.y, q.y - q.x, -q.x - q.y) - (b.x + b.y) + r) * 0.70710678;
    vec4 on = step(1e-4, r);
    pl = pl * on - (1.0 - on) * 1e9;   // (not mix(-1e9, pl, on): that rounds pl to float steps of 1e9)
    return max(d, max(max(pl.x, pl.y), max(pl.z, pl.w)));
  }
  // Scoop / notch: a disc or a square centred on the corner of q's quadrant, cut out.
  float rc = q.x > 0.0 ? (q.y > 0.0 ? r.x : r.y) : (q.y > 0.0 ? r.z : r.w);
  if (rc <= 0.0) return d;
  vec2 k = abs(q) - b;
  return max(d, -(u_corner_style == 2 ? length(k) - rc : sdBox(k, vec2(rc))));
}
// Pillow: (1 − x²/a²)(1 − y²/b²) — smooth everywhere inside, 0 on the sides.
#define SHAPE_DOME
float shapeDome(vec2 q, vec2 cell) {
  vec2 u = q / max(rectHalf(cell), vec2(1e-3));
  vec2 v = clamp(1.0 - u * u, 0.0, 1.0);
  return v.x * v.y;
}
`,
})

export const ellipseLayer = shape({
  type: 'ellipse',
  label: 'Circle / Ellipse',
  description: 'Circles, ellipses and (with an outline) rings; Sweep keeps a sector — pie slices, arcs, gauges. Rivets, bolts, gems, domes, dials.',
  params: [
    P.float('radius', 'Radius', 24, 0, 4096, { softMax: 512, unit: 'px', step: 0.1, hint: 'Half the width' }),
    P.float('squash', 'Aspect', 1, 0.01, 100, { softMin: 0.1, softMax: 10, step: 0.001, hint: 'Height / width' }),
    P.float('sweep', 'Sweep', 360, 0, 360, {
      unit: '°',
      step: 0.1,
      hint: 'How much of the ellipse is kept, centred on the top (turn it with Rotation): 360 = all of it, 180 = the top half, 270 = a gauge with a gap at the bottom. With an Outline, an arc',
    }),
    P.enum('arc_caps', 'Arc ends', 'flat', [['flat', 'Flat'], ['round', 'Round']], {
      showIf: (p) => Number(p.sweep ?? 360) < 360 && Number(p.outline) > 0,
      hint: 'The ends of an arc (an outlined ellipse cut by Sweep): cut square, or rounded off',
    }),
    spanParam(['Dome', 'a smooth dome over the whole ellipse (1 − x²/a² − y²/b²), without the ridge a bevel makes along a long ellipse']),
  ],
  fresh: (t) => ({ radius: Math.round(short(t) * 0.2), bevel: freshBevel(t) }),
  sdfGlsl: /* glsl */ `
// Exact distance to an ellipse with semi-axes ab, at any aspect (iterative closest point after 0xfaded's trig-free method).
float sdEllipseExact(vec2 p, vec2 ab) {
  ab = max(ab, vec2(1e-3));
  if (abs(ab.x - ab.y) < 1e-4 * max(ab.x, ab.y)) return length(p) - ab.x;
  vec2 pa = abs(p);
  vec2 t = vec2(0.70710678);
  vec2 e2 = vec2(ab.x * ab.x - ab.y * ab.y, ab.y * ab.y - ab.x * ab.x) / ab;
  for (int i = 0; i < 4; i++) {
    vec2 e = e2 * t * t * t;
    vec2 qv = pa - e;
    t = clamp((qv * (length(ab * t - e) / max(length(qv), 1e-9)) + e) / ab, 0.0, 1.0);
    t /= max(length(t), 1e-9);
  }
  float d = length(pa - ab * t);
  return dot(pa / ab, pa / ab) > 1.0 ? d : -d;
}
vec2 ellipseAxes() { return vec2(u_radius, u_radius * u_squash); }
float shapeExtent(vec2 cell) { return u_radius * max(1.0, u_squash); }
float shapeInradius(vec2 cell) {
  // The deepest point: the middle (the minor semi-axis); a sector's: its inscribed circle, roughly.
  float r = min(u_radius, u_radius * u_squash);
  if (u_sweep >= 360.0) return r;
  float th = radians(max(u_sweep, 0.0)) * 0.5;
  return th <= 1.5707963 ? r * sin(th) / (1.0 + sin(th)) : r * (0.5 + 0.5 * (th - 1.5707963) / 1.5707963);
}
float shapeSdf(vec2 q, float rnd, vec2 cell) { return sdEllipseExact(q, ellipseAxes()); }
// Sweep: keep the sector within ±sweep/2 of the top (after the outline, so an outlined ellipse becomes an arc).
#define SHAPE_CUT
float shapeCut(vec2 q, float d, float ol) {
  if (u_sweep >= 360.0) return d;
  float th = radians(max(u_sweep, 0.0)) * 0.5;
  vec2 c = vec2(sin(th), cos(th));
  vec2 w = vec2(abs(q.x), q.y);
  float m = length(w - c * max(dot(w, c), 0.0));
  float cut = max(d, m * sign(c.y * w.x - c.x * w.y));
  if (u_arc_caps == 0 || ol <= 0.0) return cut;
  // Round ends: a disc across the ring where the sweep cuts it (the ring's middle along the cut).
  float re = 1.0 / length(c / ellipseAxes());
  return min(cut, length(w - c * (re - ol * 0.5)) - ol * 0.5);
}
#define SHAPE_DOME
float shapeDome(vec2 q, vec2 cell) {
  if (u_sweep < 360.0) return -1.0;
  vec2 u = q / max(ellipseAxes(), vec2(1e-3));
  return clamp(1.0 - dot(u, u), 0.0, 1.0);
}
`,
})

const isStar = (p: ParamValues) => Boolean(p.star)

export const polygonLayer = shape({
  type: 'polygon',
  label: 'Polygon / Star',
  description: 'Regular polygons and stars, with rounded tips and (stars) rounded inner corners, flat tips and valleys — badges, gems, cogs, flowers.',
  params: [
    P.int('sides', 'Sides', 6, 3, 64, { softMax: 16, hint: 'Sides of the polygon, points of the star' }),
    P.float('radius', 'Radius', 24, 0, 4096, { softMax: 512, unit: 'px', step: 0.1, hint: 'Centre to a corner (a star’s tips)' }),
    P.bool('star', 'Star', false),
    P.float('inner_r', 'Inner radius', 0.5, 0.02, 1, {
      step: 0.001,
      showIf: isStar,
      hint: 'Where the star’s inner corners sit, as a fraction of the radius: small = thin spikes, up to the polygon’s own edge (no points), past it = a polygon with twice the corners',
    }),
    P.float('tip_flat', 'Flat tips', 0, 0, 1, { step: 0.001, showIf: isStar, hint: 'Cuts the points off flat (on a circle) — this fraction of their length. With Flat valleys: a gear’s teeth' }),
    P.float('root_flat', 'Flat valleys', 0, 0, 1, { step: 0.001, showIf: isStar, hint: 'Fills the notches between the points up to a circle — this fraction of the way out — so they have flat bottoms' }),
    P.float('round', 'Rounding', 0, 0, 1024, { softMax: 128, unit: 'px', step: 0.1, hint: 'Rounds the corners (a star’s tips), keeping the radius' }),
    P.float('round_in', 'Inner rounding', 0, 0, 1024, { softMax: 128, unit: 'px', step: 0.1, showIf: isStar, hint: 'Rounds the star’s inner corners — fills the notches between the points with an arc of this radius' }),
    spanParam(),
  ],
  fresh: (t) => ({ radius: Math.round(short(t) * 0.22), round: Math.round(short(t) / 128), bevel: freshBevel(t) }),
  sdfGlsl: /* glsl */ `
// A star with n points, tips at radius r and inner corners at k·r (k = cos(π/n): the regular polygon), its inner corners
// filleted with radius f where they are concave. Exact: in the folded sector between an inner corner (on the x axis)
// and a tip the boundary is one edge, or a fillet arc and the rest of the edge.
float sdStarFillet(vec2 p, float r, int n, float k, float f) {
  float an = PI / float(n);
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  vec2 V = vec2(r * k, 0.0);
  vec2 T = r * vec2(cos(an), sin(an));
  vec2 e = normalize(T - V + vec2(0.0, 1e-6));
  // The fillet circle sits on the axis, tangent to the edge and its mirror image: f / sin α out from the corner, touching
  // the edge f / tan α along it (α: the edge's angle to the axis). Convex corners (α ≥ 90°) take none.
  f = e.x > 1e-4 ? min(f, length(T - V) * e.y / e.x) : 0.0;
  vec2 C = vec2(V.x + f / max(e.y, 1e-4), 0.0);
  vec2 Pt = V + e * (f * e.x / max(e.y, 1e-4));
  vec2 pt = p - Pt, te = T - Pt;
  float dEdge = length(pt - te * clamp(dot(pt, te) / max(dot(te, te), 1e-8), 0.0, 1.0));
  vec2 pf = p - C;
  float dArc = dot(pf, e) <= 0.0 ? abs(length(pf) - f) : 1e9;
  bool body = e.x * p.y - e.y * (p.x - V.x) >= 0.0;
  bool fill = pf.x < 0.0 && dot(pf, e) < 0.0 && length(pf) > f;
  float d = min(dEdge, dArc);
  return body || fill ? -d : d;
}
// Rounding: the star shrunk by it, then grown back (rounding the tips); its inner fillet grows by as much less.
float polyCore() { return max(u_radius - max(u_round, 0.0), 1e-4); }
float polyK() { return u_star ? u_inner_r : cos(PI / float(u_sides)); }
float shapeExtent(vec2 cell) { return max(u_radius, u_round); }
float shapeInradius(vec2 cell) {
  // From the middle to the nearest edge (or inner corner), then the flat valleys' circle, plus the rounding.
  float r = polyCore(), k = polyK(), an = PI / float(u_sides);
  vec2 e = normalize(r * vec2(cos(an), sin(an)) - vec2(r * k, 0.0) + vec2(0.0, 1e-6));
  float d = e.x > 1e-4 ? k * r : e.y * k * r;
  if (u_star && u_root_flat > 0.0) d = max(d, mix(k * r, r, u_root_flat));
  return d + max(u_round, 0.0);
}
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  float ro = max(u_round, 0.0);
  float r = polyCore(), k = polyK();
  float d = sdStarFillet(q, r, u_sides, k, u_star ? u_round_in + ro : 0.0);
  if (u_star) {
    // Flat tips: cut by a circle part way down the points; flat valleys: filled to a circle part way up.
    if (u_tip_flat > 0.0) d = max(d, length(q) - mix(r, k * r, u_tip_flat));
    if (u_root_flat > 0.0) d = min(d, length(q) - mix(k * r, r, u_root_flat));
  }
  return d - ro;
}
`,
})

const TAPER_ENDS: [string, string, string][] = [
  ['both', 'Both ends', 'full width in the middle, narrowing to both ends (a spindle, a leaf)'],
  ['end', 'Towards the end', 'full width at the start, narrowing to the end (a wedge, a comet, a claw)'],
]
const tapered = (p: ParamValues) => Number(p.taper) > 0

/** Thickness, caps and taper of the stroke shapes (Line, Curve). */
const strokeParams = (): ParamDef[] => [
  P.float('thickness', 'Thickness', 2, 0, 2048, { softMax: 256, unit: 'px', step: 0.1 }),
  P.enum('caps', 'Caps', 'round', [['round', 'Round', 'a half disc past each end (reaching half the thickness beyond the length)'], ['flat', 'Flat', 'cut square at the ends']]),
  P.float('taper', 'Taper', 0, 0, 1, { step: 0.001, hint: 'Narrows the stroke towards its ends: 0 = even, 1 = to a point' }),
  P.enum('taper_ends', 'Taper towards', 'both', TAPER_ENDS, { showIf: tapered }),
  P.float('taper_curve', 'Taper curve', 1, 0.1, 10, {
    softMin: 0.25,
    softMax: 4,
    step: 0.01,
    showIf: tapered,
    hint: 'How the width falls off: 1 = straight sides; above 1 = it stays wide, then narrows late (rounded sides — a leaf, a spindle); below 1 = it narrows early into a long fine point (hollow sides — a needle, a thorn)',
  }),
  P.float('len_jitter', 'Length jitter', 0, 0, 0.95, { step: 0.001, hint: 'Shortens each repeated instance by up to this fraction, at random — keeping the thickness (Scale jitter shrinks both)' }),
]

export const lineLayer = shape({
  type: 'line',
  label: 'Line',
  description: 'Straight strokes, even or tapered: seams, grooves, light strips, scratches, spikes, leaves.',
  params: [
    P.float('length', 'Length', 96, 0, 8192, { softMax: 1024, unit: 'px', step: 0.5, hint: 'From end to end (round caps reach half the thickness further)' }),
    ...strokeParams(),
    spanParam(),
  ],
  defaults: { bevel: 1 },
  fresh: (t) => {
    const th = Math.max(2, Math.round(short(t) / 64))
    return { length: Math.round(short(t) * 0.6), thickness: th, bevel: half(th / 2) }
  },
  sdfGlsl: TAPER_GLSL + /* glsl */ `
float shapeExtent(vec2 cell) { return (u_length + u_thickness) * 0.5; }
float shapeInradius(vec2 cell) { return u_thickness * 0.5; }
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  // p = (along, across) from where the width is r0 (the middle, folded, for a taper to both ends; else the start) to h,
  // where it is r1.
  float len = u_length * (1.0 - u_len_jitter * fract(rnd * 53.71 + 0.27));
  bool both = u_taper_ends == 0;
  float h = both ? len * 0.5 : len;
  vec2 p = vec2(both ? abs(q.x) : q.x + len * 0.5, abs(q.y));
  float r0 = u_thickness * 0.5;
  float tp = clamp(u_taper, 0.0, 1.0);
  float r1 = r0 * (1.0 - tp);
  if (tp > 0.0 && abs(u_taper_curve - 1.0) > 1e-3 && h > 1e-3) {
    // A curved taper (taperShape): the distance across, corrected for the slope of the side.
    vec2 f = taperShape(clamp(p.x / h, 0.0, 1.0));
    float r = r0 * (1.0 - tp * f.x);
    float dr = r0 * tp * f.y / h;
    float side = (p.y - r) / sqrt(1.0 + min(dr * dr, 100.0));
    if (u_caps == 0) {
      if (p.x > h) return length(p - vec2(h, 0.0)) - r1;
      if (!both && p.x < 0.0) return length(p) - r0;
      return side;
    }
    return max(side, max(p.x - h, both ? -1e9 : -p.x));
  }
  if (u_caps == 0) {
    // Round caps: the capsule tapering from r0 to r1 (exact).
    if (h <= r0 - r1 + 1e-4) return min(length(p) - r0, length(p - vec2(h, 0.0)) - r1);
    float b = (r0 - r1) / h;
    float a = sqrt(1.0 - b * b);
    float k = dot(p, vec2(a, -b));
    if (k < 0.0) return length(p) - r0;
    if (k > a * h) return length(p - vec2(h, 0.0)) - r1;
    return dot(p, vec2(b, a)) - r0;
  }
  // Flat caps: the bar narrowing from r0 to r1 — its slanted side, its end, and its start when that is an end too.
  vec2 sv = vec2(h, r1 - r0), ps = p - vec2(0.0, r0);
  float dSide = length(ps - sv * clamp(dot(ps, sv) / max(dot(sv, sv), 1e-8), 0.0, 1.0));
  float dEnd = length(p - vec2(h, min(p.y, r1)));
  float dStart = both ? 1e9 : length(p - vec2(0.0, min(p.y, r0)));
  bool inside = p.x <= h && (both || p.x >= 0.0) && (p.y - r0) * h <= (r1 - r0) * p.x;
  float d = min(dSide, min(dEnd, dStart));
  return inside ? -d : d;
}
`,
})

export const curveLayer = shape({
  type: 'curve',
  label: 'Curve',
  description: 'A circular arc or a Bézier stroke, even or tapered — pipe elbows, horseshoes, arches, cables, hooks, claws.',
  params: [
    P.enum('kind', 'Shape', 'arc', [
      ['bezier', 'Bézier', 'a parabola-like bow, which Bend position can push towards an end (hooks)'],
      ['arc', 'Circular arc', 'part of a circle through both ends — a semicircle when Bend is half the Length, a horseshoe beyond'],
    ]),
    P.float('length', 'Length', 96, 0, 8192, { softMax: 1024, unit: 'px', step: 0.5, hint: 'From one end to the other, in a straight line' }),
    P.float('bend', 'Bend', 32, -4096, 4096, { softMin: -512, softMax: 512, unit: 'px', step: 0.5, hint: 'How far the middle of the curve bows out from the straight line between its ends (negative: the other way)' }),
    P.float('bend_at', 'Bend position', 0, -3, 3, {
      softMin: -2,
      softMax: 2,
      step: 0.001,
      showIf: (p) => p.kind !== 'arc',
      hint: 'Moves the bend towards the start (−) or the end (+): a hook instead of an arch; past ±1 the end curls back on itself',
    }),
    P.enum('pivot', 'Centre on', 'middle', [
      ['chord', 'Between the ends', 'X / Y, rotation and the repeat place the middle of the straight line between the ends'],
      ['middle', 'Middle of the curve', 'they place the middle of the curve’s bounds, so turned instances stay centred in their cells'],
    ]),
    ...strokeParams(),
    spanParam(),
  ],
  defaults: { thickness: 3, bevel: 1.5 },
  fresh: (t) => {
    const th = Math.max(2, Math.round(short(t) / 64))
    return { length: Math.round(short(t) * 0.6), bend: Math.round(short(t) * 0.12), thickness: th, bevel: half(th / 2) }
  },
  sdfGlsl: TAPER_GLSL + /* glsl */ `
// Quadratic Bézier A → B → C: the distance to it and the curve parameter (0..1) of the closest point (after Inigo Quilez).
vec2 sdBezierT(vec2 pos, vec2 A, vec2 B, vec2 C) {
  vec2 a = B - A;
  vec2 b = A - 2.0 * B + C;
  vec2 c = a * 2.0;
  vec2 d = A - pos;
  // Within 0.05 px of straight (|b| / 4 is how far the middle bows out): the segment, where the cubic is ill-conditioned.
  if (dot(b, b) < 0.04) {
    vec2 ca = C - A;
    float t = clamp(dot(pos - A, ca) / max(dot(ca, ca), 1e-8), 0.0, 1.0);
    return vec2(length(pos - A - ca * t), t);
  }
  float kk = 1.0 / dot(b, b);
  float kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float p = ky - kx * kx;
  float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p * p * p;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    return vec2(length(d + (c + b * t) * t), t);
  }
  float z = sqrt(-p);
  float v = acos(clamp(q / (p * z * 2.0), -1.0, 1.0)) / 3.0;
  float m = cos(v);
  float n = sin(v) * 1.732050808;
  vec2 t = clamp(vec2(m + m, -n - m) * z - kx, 0.0, 1.0);
  float d1 = dot2(d + (c + b * t.x) * t.x);
  float d2 = dot2(d + (c + b * t.y) * t.y);
  return d1 < d2 ? vec2(sqrt(d1), t.x) : vec2(sqrt(d2), t.y);
}
// The circle through (±L/2, 0) and (0, sag), sag > 0: its radius and the half angle of the arc (from the top).
vec2 arcGeom(float L, float sag) {
  float R = (L * L * 0.25 + sag * sag) / (2.0 * sag);
  return vec2(R, atan(L * 0.5 / R, (R - sag) / R));
}
bool curveIsArc(float bend) { return u_kind == 1 && abs(bend) > 0.05; }
// Where the curve's own middle (its bounds' centre) lies from the middle of its chord, for Centre on › Middle.
vec2 curvePivot(float L, float bend) {
  if (u_pivot == 0) return vec2(0.0);
  float bx = u_bend_at * L * 0.5;
  float x0 = -L * 0.5, x1 = L * 0.5;
  if (!curveIsArc(bend) && abs(bx) > L * 0.5) {
    // A control point past an end: the curve overshoots it (x' = 0 at t*).
    float t = (bx + L * 0.5) / (2.0 * bx);
    float x = (1.0 - t) * (1.0 - t) * x0 + 2.0 * t * (1.0 - t) * bx + t * t * x1;
    x0 = min(x0, x);
    x1 = max(x1, x);
  }
  return vec2((x0 + x1) * 0.5, bend * 0.5);
}
float shapeExtent(vec2 cell) {
  // Within its control triangle (Bézier; C mirrors A) or its bounds (arc), from the pivot.
  float L = u_length, bend = u_bend;
  float e;
  if (curveIsArc(bend)) {
    vec2 g = arcGeom(L, abs(bend));
    e = length(vec2(g.y > 1.5707963 ? g.x : L * 0.5, bend));
  } else {
    e = max(L * 0.5, length(vec2(u_bend_at * L * 0.5, bend * 2.0)));
  }
  return e + length(curvePivot(L, bend)) + u_thickness * 0.5;
}
float shapeInradius(vec2 cell) { return u_thickness * 0.5; }
// Half the width at curve parameter t: narrowing from the middle to both ends, or from the start to the end.
float curveR(float t) {
  float u = u_taper_ends == 0 ? abs(2.0 * t - 1.0) : t;
  return u_thickness * 0.5 * (1.0 - clamp(u_taper, 0.0, 1.0) * taperShape(u).x);
}
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  float f = 1.0 - u_len_jitter * fract(rnd * 53.71 + 0.27);
  float L = u_length * f, bend = u_bend * f;
  q += curvePivot(L, bend);
  vec2 A = vec2(-L * 0.5, 0.0), C = vec2(L * 0.5, 0.0);
  vec2 dt, tA, tC;   // distance and curve parameter; the outward tangents at the ends
  if (curveIsArc(bend)) {
    // Circular arc: in the frame where it bows upwards (the flip keeps the ends where they are).
    float sg = sign(bend);
    vec2 g = arcGeom(L, abs(bend));
    vec2 pc = vec2(q.x, q.y * sg) - vec2(0.0, abs(bend) - g.x);
    float phi = atan(pc.x, pc.y);
    if (abs(phi) <= g.y) dt = vec2(abs(length(pc) - g.x), 0.5 + phi / (2.0 * g.y));
    else { float da = length(q - A), dc = length(q - C); dt = da < dc ? vec2(da, 0.0) : vec2(dc, 1.0); }
    tA = vec2(-cos(g.y), -sin(g.y) * sg);
    tC = vec2(cos(g.y), -sin(g.y) * sg);
  } else {
    vec2 B = vec2(u_bend_at * L * 0.5, bend * 2.0);
    dt = sdBezierT(q, A, B, C);
    vec2 ta = A - B, tc = C - B;
    if (dot(ta, ta) < 1e-6) ta = A - C;   // the control point on an end: the chord's direction
    if (dot(tc, tc) < 1e-6) tc = C - A;
    tA = normalize(ta);
    tC = normalize(tc);
  }
  float d = dt.x - curveR(dt.y);
  if (u_caps == 0) return d;
  // Flat caps, square to the curve at each end: past an end (the closest point is the end itself) the distance to the
  // cap; elsewhere the stroke, cut by the cap's line near its end.
  bool atEnd = dt.y >= 0.5;
  vec2 E = atEnd ? C : A;
  vec2 tg = atEnd ? tC : tA;
  float rE = curveR(atEnd ? 1.0 : 0.0);
  float along = dot(q - E, tg);
  float across = abs(dot(q - E, vec2(-tg.y, tg.x))) - rE;
  if (dt.y <= 0.0 || dt.y >= 1.0) return length(max(vec2(along, across), 0.0)) + min(max(along, across), 0.0);
  return length(q - E) < 2.0 * rE + 1.0 ? max(d, along) : d;
}
`,
})

export const crossLayer = shape({
  type: 'cross',
  label: 'Cross',
  description: 'Plus, cross, Y and asterisk shapes with rounded ends, filleted inner corners and an optional long stem — screws, markers, badges.',
  params: [
    P.int('arms', 'Arms', 4, 3, 16, { softMax: 8, hint: '4 = a plus (turn it 45° for an ×), 3 = a Y, 6 or 8 = an asterisk. Odd counts point one arm down' }),
    P.float('size', 'Arm length', 16, 0, 4096, { softMax: 256, unit: 'px', step: 0.1, hint: 'From the centre to the end of an arm' }),
    P.float('arm', 'Arm width', 4, 0, 2048, { softMax: 128, unit: 'px', step: 0.1 }),
    P.float('stem', 'Longer bottom arm', 0, 0, 4096, { softMax: 256, unit: 'px', step: 0.1, hint: 'Extends the arm pointing down by this much — a Latin cross, a sword, a signpost' }),
    P.float('corner', 'Rounding', 0, 0, 1024, { softMax: 128, unit: 'px', step: 0.1, hint: 'Rounds the arms’ outer corners, keeping their length and width (half the width = round ends)' }),
    P.float('fillet', 'Inner rounding', 0, 0, 1024, { softMax: 128, unit: 'px', step: 0.1, hint: 'Rounds the inside corners where the arms meet with an arc of this radius' }),
    spanParam(),
  ],
  fresh: (t) => ({ size: Math.round(short(t) * 0.16), arm: Math.round(short(t) * 0.07), corner: Math.round(short(t) / 128), fillet: Math.round(short(t) / 128), bevel: freshBevel(t) }),
  sdfGlsl: /* glsl */ `
float crossW() { return clamp(u_arm * 0.5, 0.0, max(u_size, 0.0) * tan(PI / float(u_arms))); }
float shapeExtent(vec2 cell) { return length(vec2(u_size + max(u_stem, 0.0), u_arm * 0.5)); }
float shapeInradius(vec2 cell) { return crossW(); }
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  // Odd counts point arm 0 down (a Y); fold into half an arm's sector: x along the arm, 0 <= y <= x·tan(π / arms)
  // across it. The boundary there: the arm's side (y = w) from the inner fillet to the outer corner, the corner's arc, the
  // end (x = s), the fillet.
  vec2 qa = imod(u_arms, 2) == 1 ? -q : q;
  float an = PI / float(u_arms);
  float bn = mod(atan(qa.x, qa.y) + an, 2.0 * an) - an;
  vec2 p = length(qa) * vec2(cos(bn), abs(sin(bn)));
  float s = max(u_size, 0.0);
  float tn = tan(an);
  float w = crossW();
  float ro = clamp(u_corner, 0.0, min(w, s));
  float rf = clamp(u_fillet, 0.0, max((s - ro) * tn - w, 0.0));
  vec2 c = vec2((w + rf) / tn, w + rf);    // the fillet's centre, on the line between this arm and the next
  vec2 o = vec2(s - ro, w - ro);           // the outer corner's centre
  vec2 po = p - o;
  vec2 pf = p - c;
  float dSide = length(p - vec2(clamp(p.x, c.x, max(o.x, c.x)), w));
  float dCorner = po.x > 0.0 && po.y > 0.0 ? abs(length(po) - ro) : 1e9;
  float dEnd = length(p - vec2(s, clamp(p.y, 0.0, w - ro)));
  float dFillet = pf.x <= 0.0 ? abs(length(pf) - rf) : 1e9;
  float d = min(min(dSide, dCorner), min(dEnd, dFillet));
  bool arm = p.x <= s && p.y <= w && !(po.x > 0.0 && po.y > 0.0 && length(po) > ro);
  bool fill = p.y > w && pf.x < 0.0 && length(pf) > rf;
  d = arm || fill ? -d : d;
  // The bevel, arm by arm: this arm's own (rounded) bar, so the arms keep their height where they cross instead of
  // rising to a peak; beside the junction it blends into the fillet's depth.
  vec2 kb = p - o;
  float armD = min(max(kb.x, kb.y), 0.0) + length(max(kb, 0.0)) - ro;
  float bev = armD + min(d - armD, 0.0) * clamp(1.0 - (w - p.y) / max(rf, 1e-3), 0.0, 1.0);
  if (u_stem > 0.0) {
    // The longer bottom arm: a bar from the centre down past the arm's end (its top end hides in the junction).
    float sl = s + u_stem;
    float stem = sdRoundBox(q - vec2(0.0, -sl * 0.5), vec2(w, sl * 0.5), vec4(ro));
    d = min(d, stem);
    bev = min(bev, stem);
  }
  gShapeBevel = bev;
  return d;
}
`,
})

export const SHAPE_LAYERS = [rectLayer, ellipseLayer, polygonLayer, lineLayer, curveLayer, crossLayer]
