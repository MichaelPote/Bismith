// Radial / emblem motifs (FR7.2c): rosettes (rings, spokes, stars, star polygons, petals, bead rings) and
// procedural glyphs (mirrored random strokes on a small node grid: runes, sigils, insignia). Both share a
// placement + repeat-grid wrapper modelled on the shape layers (3×3 neighbourhood of repeat cells, torus
// copies when tiling), with a cheap bounding-circle test so far instances cost one length().

import { P, type ParamDef } from '@/core/params'
import type { LayerDef } from '../types'

/**
 * Layer seed for hashing. uSeed can arrive negative (mixSeed in gpu/uniforms.ts returns a signed remainder) and
 * uint() of a negative float is undefined in GLSL, which made different seeds hash alike; abs() keeps them apart.
 */
export const GLSL_MOT_SEED = /* glsl */ `
#define MOT_SEED abs(uSeed)
`

const PLACEMENT: ParamDef[] = [
  P.float('x', 'X', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: 'Centre, 0..1 across (within each repeat cell)' }),
  P.float('y', 'Y', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: 'Centre, 0..1 down (within each repeat cell)' }),
  P.float('rotation', 'Rotation', 0, -360, 360, { softMin: -180, softMax: 180, unit: '°', step: 0.1 }),
]

const REPEAT: ParamDef[] = [
  P.int('rep_x', 'Count X', 1, 1, 256, { softMax: 16, group: 'repeat' }),
  P.int('rep_y', 'Count Y', 1, 1, 256, { softMax: 16, group: 'repeat' }),
  P.float('rep_stagger', 'Row offset', 0, 0, 1, { step: 0.001, group: 'repeat', hint: 'Shift odd rows (use an even row count to tile)' }),
  P.float('rep_rot', 'Rotation jitter', 0, 0, 180, { unit: '°', step: 0.1, group: 'repeat' }),
  P.float('rep_drop', 'Drop out', 0, 0, 1, { step: 0.001, group: 'repeat', hint: 'Fraction of instances removed at random' }),
  P.seed(),
]

/**
 * Instancing wrapper. The layer supplies:
 *   float motifBound()                          — radius (px) enclosing the motif
 *   vec2  motifSnap(vec2 centre)                — pixel snapping of an instance centre
 *   float motifSdf(vec2 q, float inst)          — distance at q (px from the centre, y up, un-rotated)
 *   GenOut motifOut(float d, float rnd, vec2 nearQ) — final output (nearQ = offset from the nearest centre)
 */
const MOT_REPEAT = /* glsl */ `
GenOut gen(vec2 p) {
  vec2 reps = vec2(float(max(u_rep_x, 1)), float(max(u_rep_y, 1)));
  ivec2 ireps = ivec2(reps);
  vec2 cell = uRes / reps;
  float bound = motifBound();
  float best = 1e9, bestRnd = 0.0, nearR = 1e9;
  vec2 nearQ = vec2(1e9);
  int cy0 = int(floor(p.y / cell.y));
  for (int j = -1; j <= 1; j++) {
    int cy = cy0 + j;
    int rowFromTop = ireps.y - 1 - cy;
    float shift = imod(rowFromTop, 2) == 1 ? u_rep_stagger : 0.0;
    int cx0 = int(floor(p.x / cell.x - shift));
    for (int i = -1; i <= 1; i++) {
      ivec2 c = ivec2(cx0 + i, cy);
      if (!uTile && (c.x < 0 || c.y < 0 || c.x >= ireps.x || c.y >= ireps.y)) continue;
      ivec2 cw = uTile ? imod(c, ireps) : c;
      if (u_rep_drop > 0.0 && hashI(cw, MOT_SEED + 3.0) < u_rep_drop) continue;
      float inst = hashI(cw, MOT_SEED);
      vec2 centre = (vec2(c) + vec2(0.5 + shift, 0.5)) * cell + vec2(u_x - 0.5, 0.5 - u_y) * cell;
      centre = motifSnap(centre);
      float ang = u_rotation + (u_rep_rot > 0.0 ? (hashI(cw, MOT_SEED + 5.0) - 0.5) * 2.0 * u_rep_rot : 0.0);
      vec2 q = unrotCW(p - centre, ang);
      float r = length(q);
      // Far instances: the bounding circle is a valid lower bound of the distance.
      float d = r > bound + 4.0 ? r - bound : motifSdf(q, inst);
      if (d < best) { best = d; bestRnd = inst; }
      if (r < nearR) { nearR = r; nearQ = q; }
    }
  }
  return motifOut(best, bestRnd, nearQ);
}
`

const GLSL_TRAPEZOID = /* glsl */ `
// Isosceles trapezoid along y (after Inigo Quilez): half width r1 at y = -he, r2 at y = +he.
float mot_trapezoid(vec2 p, float r1, float r2, float he) {
  vec2 k1 = vec2(r2, he);
  vec2 k2 = vec2(r2 - r1, 2.0 * he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, (p.y < 0.0) ? r1 : r2), abs(p.y) - he);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / max(dot2(k2), 1e-8), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot2(ca), dot2(cb)));
}
// Vesica (pointed petal) along y: half length a, half width b.
float mot_vesica(vec2 p, float a, float b) {
  b = clamp(b, 1e-3, a);
  float r = 0.5 * (a * a / b + b);
  float d = r - b;
  p = abs(p);
  return ((p.y - a) * d > p.x * a) ? length(p - vec2(0.0, a)) : length(p + vec2(d, 0.0)) - r;
}
// Fold q into the sector (2π/n wide) around 'up' rotated by off·step; returns the local point (y = radial).
vec2 mot_polarFold(vec2 q, int n, float off) {
  float s = TAU / float(max(n, 1));
  float a = atan(q.x, q.y) - off * s;      // clockwise from up on screen
  a -= s * floor(a / s + 0.5);
  return length(q) * vec2(sin(a), cos(a));
}
`

// ------------------------------------------------------------------------------------------------ rosette

const STAR_MODES: [string, string][] = [
  ['filled', 'Filled star'],
  ['outline', 'Star outline'],
  ['lines', 'Star polygon lines {n/k}'],
]

const has = (key: string) => (p: Record<string, unknown>) => Number(p[key]) > 0

export const rosetteLayer: LayerDef = {
  type: 'rosette',
  label: 'Rosette',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Radial motifs: concentric rings, spokes / rays, stars and star polygons, petals and bead rings — teleporter discs, light fixtures, medallions. Repeatable.',
  params: [
    P.enum('output', 'Output', 'shape', [
      ['shape', 'Shape (SDF)'],
      ['glow', 'Glow (falloff from shape)'],
      ['radial', 'Radial (1 at centre → 0 at radius)'],
    ], { hint: 'Glow and radial are plain values for emissive / colour ramps' }),
    P.float('glow', 'Glow width', 6, 0.1, 256, { softMax: 32, unit: 'px', step: 0.1, showIf: (p) => p.output === 'glow' }),
    P.float('radius', 'Radius', 28, 0, 4096, { softMax: 256, unit: 'px', step: 0.1, hint: 'Outer radius; the elements below are placed in fractions of it' }),
    ...PLACEMENT,
    P.float('hub', 'Hub', 0, 0, 1, { step: 0.001, hint: 'Filled centre disc, fraction of the radius (0 = none)' }),
    P.int('rings', 'Rings', 2, 0, 32, { softMax: 8, group: 'rings' }),
    P.float('ring_w', 'Ring width', 2, 0, 256, { softMax: 16, unit: 'px', step: 0.1, group: 'rings', showIf: has('rings') }),
    P.float('ring_in', 'Innermost ring', 0.82, 0, 1, { step: 0.001, group: 'rings', showIf: has('rings'), hint: 'Rings are spread evenly from this fraction of the radius out to the rim' }),
    P.int('spokes', 'Spokes', 0, 0, 128, { softMax: 64, group: 'spokes' }),
    P.float('spoke_w', 'Width', 2, 0, 256, { softMax: 16, unit: 'px', step: 0.1, group: 'spokes', showIf: has('spokes') }),
    P.float('spoke_taper', 'Taper', 0, -1, 1, { step: 0.001, group: 'spokes', showIf: has('spokes'), hint: '1 = sharp at the tip (rays), −1 = sharp at the centre' }),
    P.float('spoke_in', 'From', 0.15, 0, 2, { softMax: 1, step: 0.001, group: 'spokes', showIf: has('spokes'), hint: 'Start, fraction of the radius' }),
    P.float('spoke_out', 'To', 1, 0, 2, { softMax: 1.5, step: 0.001, group: 'spokes', showIf: has('spokes') }),
    P.float('spoke_off', 'Offset', 0, 0, 1, { step: 0.001, group: 'spokes', showIf: has('spokes'), hint: 'Angular offset, fraction of a step (0.5 puts spokes between star points)' }),
    P.int('star', 'Star points', 8, 0, 32, { softMax: 16, group: 'star', hint: '0 = none' }),
    P.enum('star_mode', 'Style', 'lines', STAR_MODES, { group: 'star', showIf: has('star') }),
    P.float('star_r', 'Size', 0.8, 0, 2, { softMax: 1.2, step: 0.001, group: 'star', showIf: has('star'), hint: 'Fraction of the radius' }),
    P.float('star_inner', 'Inner ratio', 0.45, 0.02, 1, { step: 0.001, group: 'star', showIf: (p) => has('star')(p) && p.star_mode !== 'lines' }),
    P.int('star_skip', 'Skip (k)', 3, 1, 15, { group: 'star', showIf: (p) => has('star')(p) && p.star_mode === 'lines', hint: 'Each vertex joins the k-th next: {7/3} heptagram, {5/2} pentagram, 1 = polygon' }),
    P.bool('star_sharp', 'Sharp tips', true, { group: 'star', showIf: (p) => has('star')(p) && p.star_mode === 'lines', hint: 'Mitre the points (else the strokes end round)' }),
    P.float('star_w', 'Line width', 2, 0, 256, { softMax: 16, unit: 'px', step: 0.1, group: 'star', showIf: (p) => has('star')(p) && p.star_mode !== 'filled' }),
    P.int('petals', 'Petals', 0, 0, 64, { softMax: 24, group: 'petals' }),
    P.enum('petal_shape', 'Shape', 'pointed', [['pointed', 'Pointed (vesica)'], ['round', 'Round (ellipse)']], { group: 'petals', showIf: has('petals') }),
    P.float('petal_pos', 'Position', 0.55, 0, 2, { softMax: 1, step: 0.001, group: 'petals', showIf: has('petals'), hint: 'Petal centre, fraction of the radius' }),
    P.float('petal_len', 'Length', 0.7, 0, 2, { softMax: 1, step: 0.001, group: 'petals', showIf: has('petals') }),
    P.float('petal_w', 'Width', 0.25, 0, 2, { softMax: 1, step: 0.001, group: 'petals', showIf: has('petals') }),
    P.float('petal_off', 'Offset', 0, 0, 1, { step: 0.001, group: 'petals', showIf: has('petals'), hint: 'Angular offset, fraction of a step' }),
    P.int('dots', 'Beads', 0, 0, 128, { softMax: 48, group: 'dots', hint: 'A ring of round beads / rivets (0 = none)' }),
    P.float('dot_r', 'Bead radius', 1.5, 0, 256, { softMax: 16, unit: 'px', step: 0.1, group: 'dots', showIf: has('dots') }),
    P.float('dot_w', 'Ring width', 0, 0, 256, { softMax: 8, unit: 'px', step: 0.1, group: 'dots', showIf: has('dots'), hint: '0 = solid beads; otherwise rings (overlapping rings make flower-of-life rosettes)' }),
    P.float('dot_pos', 'Position', 0.9, 0, 2, { softMax: 1.2, step: 0.001, group: 'dots', showIf: has('dots'), hint: 'Fraction of the radius' }),
    P.float('dot_off', 'Offset', 0, 0, 1, { step: 0.001, group: 'dots', showIf: has('dots'), hint: 'Angular offset, fraction of a step' }),
    ...REPEAT,
  ],
  groups: [
    { id: 'rings', label: 'Rings' },
    { id: 'spokes', label: 'Spokes / rays', collapsed: true },
    { id: 'star', label: 'Star' },
    { id: 'petals', label: 'Petals', collapsed: true },
    { id: 'dots', label: 'Beads', collapsed: true },
    { id: 'repeat', label: 'Repeat', collapsed: true },
  ],
  defaults: {
    h_on: true,
    h_amount: 0.4,
    bevel: 1,
    profile: 'round',
    dif_on: true,
    dif_src: 'flat',
    dif_grad: { stops: [{ pos: 0, color: '#c8a85a' }] },
  },
  glsl:
    GLSL_MOT_SEED +
    GLSL_TRAPEZOID +
    /* glsl */ `
float motifBound() {
  float R = u_radius;
  float b = R + 0.5 * u_ring_w;
  if (u_spokes > 0) b = max(b, u_spoke_out * R + u_spoke_w);
  if (u_star > 0) b = max(b, u_star_r * R + u_star_w);
  if (u_petals > 0) b = max(b, (u_petal_pos + 0.5 * u_petal_len) * R);
  if (u_dots > 0) b = max(b, u_dot_pos * R + u_dot_r);
  if (u_output == 1) b += u_glow;
  return b;
}
vec2 motifSnap(vec2 c) { return c; }

float motifSdf(vec2 q, float inst) {
  float R = u_radius;
  float r = length(q);
  float d = 1e9;
  if (u_hub > 0.0) d = r - u_hub * R;
  if (u_rings > 0) {
    float hw = 0.5 * u_ring_w;
    float r1 = R - hw;                          // outer ring's outer edge sits on the radius
    float r0 = min(u_ring_in * R + hw, r1);
    float rc = r1;
    if (u_rings > 1) {
      float st = (r1 - r0) / float(u_rings - 1);
      rc = r1 - clamp(floor((r1 - r) / max(st, 1e-4) + 0.5), 0.0, float(u_rings - 1)) * st;
    }
    d = min(d, abs(r - rc) - hw);
  }
  if (u_spokes > 0) {
    vec2 l = mot_polarFold(q, u_spokes, u_spoke_off);
    float a = u_spoke_in * R, b = max(u_spoke_out * R, a + 1e-3);
    float w0 = 0.5 * u_spoke_w * (1.0 - max(-u_spoke_taper, 0.0));
    float w1 = 0.5 * u_spoke_w * (1.0 - max(u_spoke_taper, 0.0));
    d = min(d, mot_trapezoid(l - vec2(0.0, 0.5 * (a + b)), w0, w1, 0.5 * (b - a)));
  }
  if (u_star > 1) {
    float Rs = u_star_r * R;
    if (u_star_mode == 2) {
      // {n/k}: chords from vertex i to vertex i + k (vertex 0 points up).
      int n = u_star;
      int k = clamp(u_star_skip, 1, 15);
      float s = TAU / float(n);
      float hw = 0.5 * u_star_w;
      float dl = 1e9;
      if (u_star_sharp && 2 * k < n) {
        // Bands along the chord lines, clipped by the polygram outline grown by hw. The outline's edges all lie
        // on lines tangent to one circle (radius h), so growing it is a uniform scale with mitred tips. The
        // outline is sdStar with divisor 2n / (n − 2k + 2), i.e. inner ratio m = 1 − (divisor − 2) / (n − 2).
        float h = Rs * cos(PI * float(k) / float(n));
        for (int i = 0; i < 32; i++) {
          if (i >= n) break;
          float a = (float(i) + 0.5 * float(k)) * s;
          dl = min(dl, abs(dot(q, vec2(sin(a), cos(a))) - h));
        }
        float div = 2.0 * float(n) / float(n - 2 * k + 2);
        float m = n > 2 ? 1.0 - (div - 2.0) / float(n - 2) : 1.0;
        d = min(d, max(dl - hw, sdStar(q, Rs * (h + hw) / max(h, 1e-3), n, m)));
      } else {
        for (int i = 0; i < 32; i++) {
          if (i >= n) break;
          float a0 = float(i) * s, a1 = float(i + k) * s;
          dl = min(dl, sdSegment(q, Rs * vec2(sin(a0), cos(a0)), Rs * vec2(sin(a1), cos(a1))));
        }
        d = min(d, dl - hw);
      }
    } else {
      float ds = sdStar(q, Rs, u_star, u_star_inner);
      d = min(d, u_star_mode == 1 ? abs(ds + 0.5 * u_star_w) - 0.5 * u_star_w : ds);
    }
  }
  // Petals and beads may reach into the neighbouring sectors (overlapping rings / long petals): evaluate the
  // copies on either side too.
  if (u_petals > 0) {
    vec2 l0 = mot_polarFold(q, u_petals, u_petal_off);
    float s = TAU / float(u_petals);
    float a = 0.5 * u_petal_len * R, b = 0.5 * u_petal_w * R;
    for (int j = -1; j <= 1; j++) {
      vec2 l = rot2(float(j) * s) * l0 - vec2(0.0, u_petal_pos * R);
      d = min(d, u_petal_shape == 0 ? mot_vesica(l, a, b) : sdEllipse(l, vec2(b, a)));
    }
  }
  if (u_dots > 0) {
    vec2 l = mot_polarFold(q, u_dots, u_dot_off);
    float s = TAU / float(u_dots);
    float pr = u_dot_pos * R;
    int reach = min(int(ceil((u_dot_r + 1.0) / max(pr * s, 1e-3))), 4);
    float db = 1e9;
    for (int j = -4; j <= 4; j++) {
      if (abs(j) > reach) continue;
      float a = float(j) * s;
      float e = length(l - pr * vec2(sin(a), cos(a))) - u_dot_r;
      db = min(db, u_dot_w > 0.0 ? abs(e + 0.5 * u_dot_w) - 0.5 * u_dot_w : e);
    }
    d = min(d, db);
  }
  return d;
}

GenOut motifOut(float d, float rnd, vec2 nearQ) {
  if (u_output == 1) {
    float g = d <= 0.0 ? 1.0 : 1.0 - clamp(d / max(u_glow, 1e-3), 0.0, 1.0);
    return genOut(g * g, 1.0, rnd, NO_SDF);
  }
  if (u_output == 2) return genOut(1.0 - clamp(length(nearQ) / max(u_radius, 1e-3), 0.0, 1.0), 1.0, rnd, NO_SDF);
  return genOut(0.0, 1.0, rnd, d);
}
` +
    MOT_REPEAT,
}

// ------------------------------------------------------------------------------------------------ glyph

export const glyphLayer: LayerDef = {
  type: 'glyph',
  label: 'Glyph / Sigil',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Procedural emblems, runes and sigils: random strokes (or blocks) on a small node grid, mirrored left–right and / or top–bottom. Repeat with variation for rune borders and alien text.',
  params: [
    P.enum('style', 'Style', 'strokes', [['strokes', 'Strokes (runes, sigils)'], ['blocks', 'Blocks (pixel insignia)']]),
    P.int('cols', 'Columns', 5, 2, 9, { hint: 'Nodes (strokes) or cells (blocks) across; odd counts give a centre column' }),
    P.int('rows', 'Rows', 5, 2, 9),
    P.float('size', 'Size', 32, 1, 4096, { softMax: 128, unit: 'px', step: 0.1, hint: 'Glyph height (node span for strokes, cell span for blocks)' }),
    P.float('jitter', 'Node jitter', 0, 0, 1, { step: 0.001, showIf: (p) => p.style === 'strokes', hint: 'Moves each node off the grid at random, up to half a node spacing at 1. Strokes that share a node still meet there' }),
    P.float('width', 'Stroke width', 2, 0, 256, { softMax: 16, unit: 'px', step: 0.1, showIf: (p) => p.style === 'strokes' }),
    P.float('taper', 'Taper', 0, 0, 1, { step: 0.001, showIf: (p) => p.style === 'strokes', hint: 'Thin each stroke towards its ends: full width in the middle of the stroke, 1 = pointed tips' }),
    P.int('strokes', 'Strokes', 4, 1, 8, { showIf: (p) => p.style === 'strokes', hint: 'Random walks per glyph' }),
    P.int('steps', 'Steps', 3, 1, 8, { showIf: (p) => p.style === 'strokes', hint: 'Segments per stroke' }),
    P.float('diag', 'Diagonals', 0.4, 0, 1, { step: 0.001, showIf: (p) => p.style === 'strokes', hint: 'Chance a turn goes diagonal' }),
    P.float('straight', 'Straightness', 0.35, 0, 1, { step: 0.001, showIf: (p) => p.style === 'strokes', hint: 'Chance a stroke keeps its direction' }),
    P.float('overlap', 'Overlaps', 1, 0, 1, { step: 0.001, showIf: (p) => p.style === 'strokes', hint: 'Chance a step may land on a node already drawn (by any stroke, or a mirror image). At 0 strokes never run back into the glyph, and stop early when boxed in. Splines never run back along a drawn line or turn back sharply' }),
    P.enum('line', 'Lines', 'straight', [['straight', 'Straight (and arcs)'], ['spline', 'Splines (hand-drawn)']], { showIf: (p) => p.style === 'strokes', hint: 'Splines draw each stroke as one smooth curve through its nodes' }),
    P.float('curve', 'Curves', 0, 0, 1, { step: 0.001, showIf: (p) => p.style === 'strokes' && p.line !== 'spline', hint: 'Chance a segment bows into an arc' }),
    P.float('roundness', 'Roundness', 1, 0, 2, { step: 0.001, showIf: (p) => p.style === 'strokes' && p.line === 'spline', hint: 'How far the splines swing through the nodes: 0 = straight, 1 = natural, 2 = loopy' }),
    P.float('dots', 'End dots', 0, 0, 64, { softMax: 8, unit: 'px', step: 0.1, showIf: (p) => p.style === 'strokes', hint: 'Radius of a dot at each stroke end (0 = none)' }),
    P.bool('dot_ring', 'Ring dots', false, { showIf: (p) => p.style === 'strokes' && Number(p.dots) > 0, hint: 'Draw the end dots as open rings that the strokes stop at (sigil style). The ring line is the stroke width, thinned to half the radius on small dots' }),
    P.float('density', 'Fill', 0.5, 0, 1, { step: 0.001, showIf: (p) => p.style === 'blocks', hint: 'Fraction of cells filled' }),
    P.bool('mirror', 'Mirror X', true, { hint: 'Left–right symmetry' }),
    P.bool('mirror_y', 'Mirror Y', false, { hint: 'Top–bottom symmetry' }),
    P.bool('centre', 'Centre glyph', false, { hint: 'Centre the drawn glyph on its origin (placement point and rotation pivot) instead of the full node grid' }),
    P.bool('vary', 'Vary per instance', true, { hint: 'Each repeat gets its own glyph (rune text); off repeats one emblem' }),
    P.bool('snap', 'Pixel snap', true, { hint: 'Puts nodes on the pixel grid so 1–2 px strokes stay crisp' }),
    ...PLACEMENT,
    ...REPEAT,
  ],
  groups: [{ id: 'repeat', label: 'Repeat', collapsed: true }],
  defaults: {
    h_on: true,
    h_amount: 0.4,
    bevel: 1,
    profile: 'round',
    dif_on: true,
    dif_src: 'flat',
    dif_grad: { stops: [{ pos: 0, color: '#c8a85a' }] },
  },
  glsl:
    GLSL_MOT_SEED +
    /* glsl */ `
const ivec2 MOT_DIRS[8] = ivec2[8](ivec2(1, 0), ivec2(1, 1), ivec2(0, 1), ivec2(-1, 1),
                                    ivec2(-1, 0), ivec2(-1, -1), ivec2(0, -1), ivec2(1, -1));

ivec2 mot_grid() { return ivec2(clamp(u_cols, 2, 9), clamp(u_rows, 2, 9)); }
// Node spacing (strokes) or cell size (blocks), whole px when snapping.
float mot_spacing() {
  ivec2 g = mot_grid();
  float sp = u_style == 0 ? u_size / float(g.y - 1) : u_size / float(g.y);
  return u_snap ? max(1.0, floor(sp + 0.5)) : sp;
}
float motifBound() {
  ivec2 g = mot_grid();
  float sp = mot_spacing();
  // Splines swing out from the nodes by at most a quarter of their tangent (≤ 0.36 · roundness · spacing).
  // Jitter moves a node up to half the jitter · spacing per axis.
  float swing = u_style == 0 && u_line == 1 ? 0.36 * u_roundness * (1.0 + u_jitter) * sp : 0.0;
  float jit = u_style == 0 ? 0.71 * u_jitter * sp : 0.0;
  return 0.5 * length(vec2(g)) * sp + swing + jit + u_width + 2.0 * u_dots + 1.0;
}
// Strokes: nodes on pixel centres for odd widths, on pixel corners for even ones (and for blocks).
vec2 motifSnap(vec2 c) {
  if (!u_snap) return c;
  ivec2 g = mot_grid();
  float sp = mot_spacing();
  // Offset of node 0 from the centre must be whole px: half-odd spans shift the centre by half a pixel.
  vec2 span = u_style == 0 ? vec2(g - 1) * sp : vec2(g) * sp;
  vec2 half_ = 0.5 * span - floor(0.5 * span);       // 0 or 0.5 per axis
  bool odd = u_style == 0 && mod(floor(u_width + 0.5), 2.0) == 1.0;
  vec2 base = floor(c + 0.5) + half_;
  if (odd) base = floor(c) + 0.5 + half_;
  return base;
}
vec2 mot_node(ivec2 n, ivec2 g, float sp) {
  return vec2(float(n.x) - 0.5 * float(g.x - 1), 0.5 * float(g.y - 1) - float(n.y)) * sp;
}
// Offset (px) from the grid centre to the centre of the drawn nodes / cells lo..hi (whole px when snapping).
vec2 mot_centreOff(ivec2 lo, ivec2 hi, ivec2 g, float sp) {
  vec2 o = vec2(0.5 * float(lo.x + hi.x - g.x + 1), 0.5 * float(g.y - 1 - lo.y - hi.y)) * sp;
  // A mirror image makes the drawing symmetric about that axis already.
  if (u_mirror) o.x = 0.0;
  if (u_mirror_y) o.y = 0.0;
  return u_snap ? floor(o + 0.5) : o;
}
bool mot_cellOn(int i, int j, ivec2 g, int gid) {
  int mi = u_mirror ? min(i, g.x - 1 - i) : i;
  int mj = u_mirror_y ? min(j, g.y - 1 - j) : j;
  return hashI(ivec2(mi + 16 * mj, gid), MOT_SEED + 211.0) < u_density;
}
// Visited nodes for the overlap test: one bit per node (x + 9y < 81) over three words. Mirroring folds the node
// onto the top-left (x onto the left half, y onto the top half), so a node a mirror image has drawn counts as
// visited too.
int mot_nodeKey(ivec2 n, ivec2 g) {
  return (u_mirror ? min(n.x, g.x - 1 - n.x) : n.x) + 9 * (u_mirror_y ? min(n.y, g.y - 1 - n.y) : n.y);
}
// Node position with its jitter (one random offset per node and glyph, so strokes sharing a node still meet).
// Mirroring keys the offset by the folded node and mirrors it on the right / bottom half (zero across the axis on
// an axis node), so the mirror images land on the same moved nodes.
vec2 mot_pt(ivec2 n, ivec2 g, float sp, int gid) {
  vec2 p = mot_node(n, g, sp);
  if (u_jitter <= 0.0) return p;
  vec2 j = (hash2I(ivec2(mot_nodeKey(n, g), gid), MOT_SEED + 503.0) - 0.5) * u_jitter * sp;
  if (u_snap) j = floor(j + 0.5);
  if (u_mirror) j.x *= float(sign(g.x - 1 - 2 * n.x));
  if (u_mirror_y) j.y *= float(sign(g.y - 1 - 2 * n.y));
  return p + j;
}
uvec3 mot_bit(int i) { return uvec3(equal(ivec3(i >> 5), ivec3(0, 1, 2))) << uint(i & 31); }
// Quadratic Bézier distance (as sdBezier) and the parameter t of the nearest point, for the taper.
vec2 mot_bezierT(vec2 pos, vec2 A, vec2 B, vec2 C) {
  vec2 a = B - A;
  vec2 b = A - 2.0 * B + C;
  if (dot(b, b) < 1e-6) {
    vec2 pa = pos - A, ca = C - A;
    float h = clamp(dot(pa, ca) / max(dot(ca, ca), 1e-8), 0.0, 1.0);
    return vec2(length(pa - ca * h), h);
  }
  vec2 c = a * 2.0;
  vec2 d = A - pos;
  float kk = 1.0 / dot(b, b);
  float kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float p = ky - kx * kx;
  float p3 = p * p * p;
  float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p3;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    return vec2(length(d + (c + b * t) * t), t);
  }
  float z = sqrt(-p);
  float v = acos(q / (p * z * 2.0)) / 3.0;
  float m = cos(v);
  float n = sin(v) * 1.732050808;
  vec2 t = clamp(vec2(m + m, -n - m) * z - kx, 0.0, 1.0);
  float d0 = dot2(d + (c + b * t.x) * t.x), d1 = dot2(d + (c + b * t.y) * t.y);
  return d0 < d1 ? vec2(sqrt(d0), t.x) : vec2(sqrt(d1), t.y);
}
// Signed distance to segment k (of n) of a stroke, b → c, and to its mirror images when mirroring. Straight
// lines: one quadratic Bézier bowed sideways by 'bow' (a straight segment when 0). Splines: the Catmull-Rom curve
// through the nodes (tangents from the nodes a before and e after, scaled by roundness) as two quadratic Béziers
// that meet halfway with matching tangents. The half width tapers along the whole stroke (4u(1 − u), u = 0..1).
// One Bézier call in one loop, so the shader holds a single copy of it.
float mot_segD(vec2 q, vec2 a, vec2 b, vec2 c, vec2 e, float bow, float k, float n) {
  bool spline = u_line == 1;
  vec2 c0 = spline ? b + 0.125 * u_roundness * (c - a) : 0.5 * (b + c) + vec2(b.y - c.y, c.x - b.x) * bow;
  vec2 c1 = c - 0.125 * u_roundness * (e - b);
  vec2 m = spline ? 0.5 * (c0 + c1) : c;
  int pieces = spline ? 2 : 1;
  int copies = (u_mirror ? 2 : 1) * (u_mirror_y ? 2 : 1);
  float d = 1e9;
  for (int i = 0; i < pieces * copies; i++) {
    bool second = spline && (i & 1) == 1;
    int mi = i / pieces;                       // which image: bit 0 flips x (when mirroring x), then y
    vec2 qm = q;
    if (u_mirror && (mi & 1) == 1) qm.x = -qm.x;
    if (u_mirror_y && (u_mirror ? mi >= 2 : mi == 1)) qm.y = -qm.y;
    vec2 A = second ? m : b, B = second ? c1 : c0, C = second ? c : m;
    // Nearly straight pieces: a plain segment (the Bézier solve loses precision as the curve flattens).
    vec2 ac = C - A, ab = B - A;
    if (abs(ac.x * ab.y - ac.y * ab.x) < 0.01 * length(ac)) B = 0.5 * (A + C);
    vec2 dt = mot_bezierT(qm, A, B, C);
    float u = (k + (spline ? 0.5 * (float(second) + dt.y) : dt.y)) / max(n, 1.0);
    d = min(d, dt.x - 0.5 * u_width * mix(1.0, 4.0 * u * (1.0 - u), u_taper));
  }
  return d;
}

float motifSdf(vec2 q, float inst) {
  ivec2 g = mot_grid();
  float sp = mot_spacing();
  int gid = u_vary ? int(inst * 65535.0) : 0;
  // Loop bounds below depend on uniforms, so D3D compiles each loop body once instead of unrolling it.
  int eight = uRes.x > 0.0 ? 8 : 0;
  if (u_style == 1) {
    // Blocks: exact distance to the union of filled cells (inside: distance to the nearest empty cell or the
    // grid's outside). One flat loop over the cells, twice when centring: first for the filled cells' bounds.
    int cells = g.x * g.y;
    ivec2 lo = g, hi = ivec2(-1), ci = ivec2(0);
    vec2 hs = vec2(0.5 * sp);
    vec2 gh = 0.5 * vec2(g) * sp;
    bool inside = false;
    float dFill = 1e9, dEmpty = 0.0;
    for (int e = u_centre ? 0 : cells; e < 2 * cells; e++) {
      int c = e < cells ? e : e - cells;
      int i = c % g.x, j = c / g.x;
      bool on = mot_cellOn(i, j, g, gid);
      if (e < cells) {
        if (on) { lo = min(lo, ivec2(i, j)); hi = max(hi, ivec2(i, j)); }
        continue;
      }
      if (c == 0) {
        if (u_centre && hi.x >= 0) q += mot_centreOff(lo, hi, g, sp);
        vec2 cq = (q + gh) / sp;
        ci = ivec2(floor(vec2(cq.x, 2.0 * gh.y / sp - cq.y)));
        dEmpty = max(-sdBox(q, gh), 0.0);
      }
      vec2 cc = vec2((float(i) + 0.5) * sp - gh.x, gh.y - (float(j) + 0.5) * sp);
      float db = sdBox(q - cc, hs);
      if (on) { dFill = min(dFill, db); if (ci == ivec2(i, j)) inside = true; }
      else dEmpty = min(dEmpty, max(db, 0.0));
    }
    return inside ? -dEmpty : dFill;
  }
  // Strokes: random walks over the node grid; each step keeps going straight or turns (diagonals by chance),
  // never reverses, turns away from the grid edge and, unless an overlap is allowed, away from drawn nodes.
  // Splines also never turn back sharply (135°) or step from one drawn node to another (running back along a
  // drawn line): a curve can't retrace a line, so doubling back draws loops and lenses.
  // One flat loop walks all the strokes node by node. Each iteration arrives at a node (or, after a stroke's
  // last node, at a reflected point past its end) and draws the segment before the previous node, now that the
  // nodes on both sides of it are known (spline tangents need them). Centring and tapering walk everything
  // twice: the first pass only finds the bounds of the drawn nodes and each stroke's length.
  float d = 1e9, dd = 1e9, dh = 1e9;
  float rw = min(u_width, 0.5 * u_dots);       // ring line: the stroke width, but leave a hole on small dots
  bool spline = u_line == 1;
  int strokes = clamp(u_strokes, 1, 8), steps = clamp(u_steps, 1, 8);
  bool draw = !u_centre && u_taper <= 0.0;
  uint lens = 0u;                              // segments per stroke, 4 bits each (first pass)
  uvec3 seen = uvec3(0u);
  ivec2 lo = g, hi = ivec2(-1);
  int w = 0, s = -1, dir = 0;                  // s: index of the node arrived at (-1: start the next stroke)
  bool ending = false, old = false;
  ivec2 pos = ivec2(0), nB = ivec2(0), nC = ivec2(0);
  vec2 pA = vec2(0.0), pB = vec2(0.0), pC = vec2(0.0), pStart = vec2(0.0);   // nodes s − 3, s − 2, s − 1
  float bowB = 0.0, bowC = 0.0;                // bows of the segments ending at nodes s − 1 and s
  for (int it = 0; it < 20 * strokes; it++) {
    if (s < 0) {
      if (w >= strokes) {
        if (draw) break;
        if (u_centre) q += mot_centreOff(lo, hi, g, sp);
        draw = true;
        w = 0;
        seen = uvec3(0u);
      }
      vec3 h0 = hash3I(ivec2(w * 16, gid), MOT_SEED + 101.0);
      pos = min(ivec2(floor(h0.xy * vec2(g))), g - 1);
      dir = int(h0.z * 8.0);
      s = 0;
    }
    vec2 pt = 2.0 * pC - pB;
    if (!ending) {
      // Arrive at pos. A node is old when drawn before (a node on a mirror axis always is: its mirror image
      // arrives with it).
      uvec3 pb = mot_bit(mot_nodeKey(pos, g));
      old = any(notEqual(seen & pb, uvec3(0u))) || (u_mirror && 2 * pos.x == g.x - 1) ||
            (u_mirror_y && 2 * pos.y == g.y - 1);
      seen |= pb;
      lo = min(lo, pos);
      hi = max(hi, pos);
      pt = mot_pt(pos, g, sp, gid);
      if (s == 0) { pStart = pt; pB = pt; pC = pt; }
    }
    // The segment from node s − 2 to s − 1; past either end of the stroke the missing neighbour is reflected. A
    // segment that is its own mirror image (along an axis, or across one between mirror nodes, or through the
    // centre when mirroring both ways) stays straight: as a curve it would split from its mirror into a lens.
    if (draw && s >= 2) {
      vec2 before = s > 2 ? pA : 2.0 * pB - pC, after = pt;
      ivec2 mB = g - 1 - nB, mC = g - 1 - nC;
      bool selfX = u_mirror && (ivec2(mB.x, nB.y) == nC || (mB.x == nB.x && mC.x == nC.x));
      bool selfY = u_mirror_y && (ivec2(nB.x, mB.y) == nC || (mB.y == nB.y && mC.y == nC.y));
      if (selfX || selfY || (u_mirror && u_mirror_y && mB == nC)) {
        before = 2.0 * pB - pC;
        after = 2.0 * pC - pB;
      }
      d = min(d, mot_segD(q, before, pB, pC, after, bowB, float(s - 2), float((lens >> uint(4 * w)) & 15u)));
    }
    if (ending) {
      if (!draw) lens |= uint(s - 1) << uint(4 * w);
      if (draw && u_dots > 0.0) {
        for (int k = 0; k < 2; k++) {
          vec2 c = k == 0 ? pStart : pC;
          // Nearest of the dot and its mirror images: fold both onto the same side of each mirror axis.
          vec2 qf = q, cf = c;
          if (u_mirror) { qf.x = abs(qf.x); cf.x = abs(cf.x); }
          if (u_mirror_y) { qf.y = abs(qf.y); cf.y = abs(cf.y); }
          float l = length(qf - cf);
          dd = min(dd, u_dot_ring ? abs(l - u_dots + 0.5 * rw) - 0.5 * rw : l - u_dots);
          dh = min(dh, l - u_dots + rw);
        }
      }
      ending = false;
      w++;
      s = -1;
      continue;
    }
    // Choose the next node; a stroke ends after its last step, or when boxed in.
    bool moved = false;
    int nd = dir;
    float nbow = 0.0;
    if (s < steps) {
      int hid = w * 16 + s + 1;
      vec4 hs = vec4(hash3I(ivec2(hid, gid), MOT_SEED + 101.0), hashI(ivec2(hid, gid), MOT_SEED + 307.0));
      if (s == 0 || hs.x >= u_straight) {
        int k = int(hs.z * 4.0);
        nd = hs.y < u_diag ? 2 * k + 1 : 2 * k;
      }
      bool revisit = (u_overlap >= 1.0 || hashI(ivec2(hid, gid), MOT_SEED + 409.0) < u_overlap) && !(spline && old);
      for (int t = 0; t < eight; t++) {
        ivec2 np = pos + MOT_DIRS[nd];
        bool inGrid = all(greaterThanEqual(np, ivec2(0))) && all(lessThan(np, g));
        // Free: not drawn yet, or the step across an axis onto one of its own mirror nodes (even counts).
        ivec2 mp = g - 1 - pos;
        bool free_ = revisit || all(equal(seen & mot_bit(mot_nodeKey(np, g)), uvec3(0u))) ||
                     (u_mirror && np == ivec2(mp.x, pos.y)) || (u_mirror_y && np == ivec2(pos.x, mp.y)) ||
                     (u_mirror && u_mirror_y && np == mp);
        int turn = abs((nd - dir + 8) % 8 - 4);   // 0 = straight back, 1 = a 135° hairpin
        if (inGrid && free_ && (s == 0 || turn > (spline ? 1 : 0))) { moved = true; break; }
        nd = (nd + 3) % 8;
      }
      nbow = hs.w < u_curve ? (fract(hs.w * 7.31) < 0.5 ? 0.35 : -0.35) : 0.0;
    }
    pA = pB; pB = pC; pC = pt;
    nB = nC; nC = pos;
    bowB = bowC; bowC = nbow;
    if (moved) { pos += MOT_DIRS[nd]; dir = nd; }
    else ending = true;
    s++;
  }
  // Ring dots are open: the strokes stop at the ring instead of running into its hole.
  if (u_dot_ring) d = max(d, -dh);
  return min(d, dd);
}

GenOut motifOut(float d, float rnd, vec2 nearQ) { return genOut(0.0, 1.0, rnd, d); }
` + MOT_REPEAT,
}
