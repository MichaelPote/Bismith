// Organic structured generators (FR7.2a): wooden planks with grain, and overlapping scales.
//
// Both are SDF layers with an Output switch, because the generator wrapper replaces the value of an SDF
// pixel with the bevel profile:
//   - "combined" (default): the pattern value (grain / scale shading) multiplied by the layer's own bevel
//     profile and coverage — gaps and outlines read 0. Wood hands its plank outline to the shape register
//     (genOutOwn), so chips and clips can follow it; scales don't write it (per-pixel NO_SDF opt-out).
//   - "shape": the plank / scale SDF for the shape register (bevel, clip, etch); value = wrapper profile.
//   - wood only, "grain": the grain value without gaps or edges (stack it over a "shape" layer).

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { ORG_GLSL, ORG_GLSL_SDF, ORG_NO_SDF } from './organicShared'

// ------------------------------------------------------------------------------------------------ wood

const planksOn = (p: Record<string, unknown>) => p.planks !== false
const jointsOn = (p: Record<string, unknown>) => p.planks !== false && Number(p.joints) > 0
const ringsOn = (p: Record<string, unknown>) => Number(p.rings) > 0

export const woodLayer: LayerDef = {
  type: 'wood',
  noise: true,
  label: 'Wood planks',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  // The plank outline goes to the Shape Mask from the Wood and Plank shapes outputs (not Grain only, nor one slab).
  sdfShowIf: (p) => p.planks !== false && p.output !== 'grain',
  description: 'Wooden planks with staggered end joints and grain: fine streaks, ring figure (cathedral arches) and knots.',
  params: [
    P.enum('output', 'Output', 'wood', [
      ['wood', 'Wood (grain × plank edges)'],
      ['shape', 'Plank shapes (SDF)'],
      ['grain', 'Grain only'],
    ], { hint: 'Wood: grain value with gaps = 0 and the Shape bevel darkening plank edges. Shape: the outline of the planks for the shape mask (bevel / clip). Grain: per-board grain without gaps' }),
    P.bool('planks', 'Planks', true, { hint: 'Off: one continuous piece of wood (no gaps, joints or boards)' }),
    P.enum('direction', 'Direction', 'vertical', [['vertical', 'Vertical'], ['horizontal', 'Horizontal']], { hint: 'Which way the planks (and grain) run' }),
    P.int('count', 'Planks', 4, 1, 128, { softMax: 16, showIf: planksOn, hint: 'Planks across the texture' }),
    P.float('gap', 'Gap X', 1, 0, 64, { softMax: 4, unit: 'px', step: 0.1, showIf: planksOn, join: { with: 'gap_y', as: 'pair', label: 'Gap X · Y' }, hint: 'Width of the gaps across the texture (X: the up-and-down gaps — between vertical planks, at the ends of horizontal ones) and down it (Y: the gaps that run across)' }),
    P.float('gap_y', 'Gap Y', 1, 0, 64, { softMax: 4, unit: 'px', step: 0.1, showIf: planksOn }),
    P.int('joints', 'End joints', 1, 0, 32, { softMax: 8, showIf: planksOn, hint: 'Board ends per plank along the texture (0 = full-length boards)' }),
    P.float('stagger', 'Stagger', 0.5, 0, 1, { step: 0.001, showIf: jointsOn, hint: 'Regular joint offset from one plank to the next (fraction of a board)' }),
    P.float('joint_rand', 'Joint randomness', 0.6, 0, 1, { step: 0.001, showIf: jointsOn, hint: 'Random joint offset per plank' }),
    P.float('width_var', 'Width variation', 0, 0, 1, { step: 0.001, showIf: planksOn, hint: 'Uneven plank widths' }),
    P.float('end_wobble', 'End wobble', 0, 0, 64, { softMax: 8, unit: 'px', step: 0.05, showIf: jointsOn, hint: 'Board ends — the cuts across the grain — wander by up to this much, as if sawn by hand. Both sides of a joint follow the same line (mostly), so the gap keeps its width; the long edges stay straight' }),
    P.float('end_wobble_px', 'Wobble size', 32, 2, 1024, { softMax: 128, unit: 'px', step: 0.1, showIf: (p) => jointsOn(p) && Number(p.end_wobble) > 0, hint: 'Distance between the wobble\'s bends along a board end' }),
    P.float('grain_px', 'Grain spacing', 2, 0.5, 32, { softMax: 8, unit: 'px', step: 0.05, group: 'grain', hint: 'Distance between fine grain streaks' }),
    P.float('grain_stretch', 'Grain length', 24, 1, 64, { softMax: 32, step: 0.1, group: 'grain', hint: 'How elongated the fine grain is along the plank' }),
    P.float('grain_depth', 'Grain depth', 1, 0, 1, { step: 0.001, group: 'grain', hint: 'How deep the grain cuts in Height, as a share of the layer\'s height: the plank surface is (1 − depth) + depth × grain, so at 1 dark grain sinks as low as the gaps, at 0.2 it is a fine texture on a full-height board, at 0 the boards are smooth. The gaps and bevels always span the full height; colours keep the full grain' }),
    P.float('fine', 'Fine grain', 0.6, 0, 1, { step: 0.001, group: 'grain' }),
    P.float('rings', 'Rings', 0.6, 0, 1, { step: 0.001, group: 'grain', hint: 'Strength of the growth-ring lines' }),
    P.float('ring_px', 'Ring spacing', 4, 1, 64, { softMax: 16, unit: 'px', step: 0.05, group: 'grain' }),
    P.float('ring_line', 'Latewood', 0.4, 0.02, 1, { step: 0.001, group: 'grain', hint: 'Width of the dark part of each ring (fraction of the spacing)' }),
    P.float('grain_soft', 'Softness', 0, 0, 1, { step: 0.001, group: 'grain', showIf: (p) => ringsOn(p) || Number(p.fine) > 0, hint: 'How soft the rings and grain streaks are — in Height above all. 0: crisp (ring edges anti-aliased to the pixel unless Anti-alias is off, then hard pixel-art steps); 1: soft, rounded bands that rise and fall gently instead of little cliffs' }),
    P.float('figure', 'Arches', 0.5, 0, 1, { step: 0.001, group: 'grain', hint: 'Planks: fraction of boards sawn through the heart (cathedral arches / ovals); the rest show straight lines. No planks: how strongly the lines fold into arches' }),
    P.float('ring_stretch', 'Arch length', 6, 1, 40, { softMax: 16, step: 0.1, group: 'grain', hint: 'Elongation of the rings along the board' }),
    P.float('ring_warp', 'Ring warp', 0.5, 0, 4, { softMax: 2, step: 0.001, group: 'grain', hint: 'Wobble of the ring lines' }),
    P.float('knots', 'Knots', 0.15, 0, 1, { step: 0.001, group: 'grain', hint: 'Chance of a knot per board (at most one each)' }),
    P.float('knot_size', 'Knot size', 3, 0.5, 64, { softMax: 12, unit: 'px', step: 0.05, group: 'grain', showIf: (p) => Number(p.knots) > 0, hint: 'Knot radius across the grain (it is ~1.7× longer along it); clamped to the board' }),
    P.seed(),
  ],
  groups: [{ id: 'grain', label: 'Grain' }],
  // Added in the editor: soft grain (stored projects keep 0, the crisp grain they were made with).
  fresh: () => ({ grain_soft: 0.4, grain_depth: 0.35 }),
  // One gap for both directions before Gap Y: an older (or recipe-built) layer's gap keeps applying to both.
  migrate: (p) => (p.gap !== undefined && p.gap_y === undefined ? { ...p, gap_y: p.gap } : p),
  defaults: {
    bevel: 1,
    profile: 'round',
    h_on: true,
    h_amount: 0.3,
    dif_on: true,
    dif_grad: gradient('#24140a', '#4f321b', '#7a5530', '#9c7343', '#b48a55'),
    dif_jitter: 0.2,
  },
  glsl:
    ORG_GLSL +
    ORG_GLSL_SDF +
    /* glsl */ `
// Plank boundary k across the texture (px, whole pixels). Width variation moves boundaries randomly.
float org_plankEdge(int k, int n, float pw) {
  float j = 0.0;
  if (u_width_var > 0.0) {
    int kw = uTile ? imod(k, n) : k;
    j = (hashI(ivec2(kw, 5), uSeed + 23.0) - 0.5) * 0.9 * u_width_var;
  }
  return floor((float(k) + j) * pw + 0.5);
}

// Smooth 1D noise in -1..1 along a board end (x in wobble cells across the plank; key = plank column, joint).
float org_endWob(float x, int col, int joint, float seed) {
  float i = floor(x), f = x - i;
  ivec2 k = ivec2(int(i), col * 4099 + joint);
  return 2.0 * mix(hashI(k, seed), hashI(k + ivec2(1, 0), seed), f * f * (3.0 - 2.0 * f)) - 1.0;
}

GenOut gen(vec2 p) {
  bool horiz = u_direction == 1;
  // Plank frame: a runs across the planks, l along them (px, from the top / left on screen).
  float A = horiz ? uRes.y : uRes.x;
  float Lr = horiz ? uRes.x : uRes.y;
  float a = horiz ? uRes.y - p.y : p.x;
  float l = horiz ? p.x : uRes.y - p.y;

  int n = u_planks ? max(u_count, 1) : 1;
  int nj = u_planks ? max(u_joints, 0) : 0;
  // Gaps in the plank frame: gA between planks (along their sides), gL at the board ends. X / Y are screen axes.
  float gA = u_planks ? (horiz ? u_gap_y : u_gap) : 0.0;
  float gL = u_planks ? (horiz ? u_gap : u_gap_y) : 0.0;
  float pw = A / float(n);
  float bl = nj > 0 ? Lr / float(nj) : Lr;

  // Nearest board (like bricks): the gap runs along the left / top edge so whole-pixel sizes stay crisp.
  int c0 = int(floor(a / pw));
  float best = 1e9;
  ivec2 bid = ivec2(0);
  vec4 box = vec4(0.0, A, 0.0, Lr);
  for (int i = -1; i <= 1; i++) {
    int c = c0 + i;
    int cw = uTile ? imod(c, n) : c;
    float a0 = org_plankEdge(c, n, pw);
    float a1 = org_plankEdge(c + 1, n, pw);
    float off = float(cw) * u_stagger + hashI(ivec2(cw, 9), uSeed + 29.0) * u_joint_rand;
    // End wobble: the board ends move along the plank by a noise of the across position, one line per joint (shared by
    // the boards either side, so the gap keeps its width) plus a little of each side's own. Shifting l by the nearest
    // joint's offset bends only the ends: the long edges don't depend on l.
    float lw = l;
    if (nj > 0 && u_end_wobble > 0.0) {
      int bj = int(floor(l / bl - off + 0.5));
      int bjw = uTile ? imod(bj, nj) : bj;
      float x = (a - a0) / max(u_end_wobble_px, 1.0);
      float sh = u_end_wobble * org_endWob(x, cw, bjw, uSeed + 71.0);
      bool below = l > floor((float(bj) + off) * bl + 0.5) + 0.5 * gL + sh;
      lw = l - sh - 0.25 * u_end_wobble * org_endWob(x + 0.5, cw, 2 * bjw + (below ? 1 : 0), uSeed + 73.0);
    }
    int b0 = nj > 0 ? int(floor(lw / bl - off)) : 0;
    for (int j = -1; j <= 1; j++) {
      if (nj == 0 && j != 0) continue;
      int b = b0 + j;
      float l0 = nj > 0 ? floor((float(b) + off) * bl + 0.5) : l - 1e4;
      float l1 = nj > 0 ? floor((float(b + 1) + off) * bl + 0.5) : l + 1e4;
      vec2 lo = vec2(a0 + gA, l0 + (nj > 0 ? gL : 0.0));
      vec2 hi = vec2(a1, l1);
      vec2 hs = max(0.5 * (hi - lo), vec2(0.0));
      float d = sdBox(vec2(a, lw) - 0.5 * (lo + hi), hs);
      if (d < best) {
        best = d;
        bid = ivec2(cw, nj > 0 ? (uTile ? imod(b, nj) : b) : 0);
        box = vec4(a0, a1, l0, l1);
      }
    }
  }
  float rnd = hashI(bid, uSeed);
  if (u_output == 1 && u_planks) return genOut(0.0, 1.0, rnd, best);

  // Board-local coordinates: la across from the board centre, ll along from its start (period Lb).
  float pwB = max(box.y - box.x, 1.0);
  float la = a - 0.5 * (box.x + box.y);
  float Lb = nj > 0 ? max(box.w - box.z, 1.0) : Lr;
  float ll = nj > 0 ? l - box.z : l;
  vec4 hb = vec4(hash3I(bid, uSeed + 31.0), hashI(bid, uSeed + 37.0));

  // Knot: grain lines flow around it like potential flow around a cylinder (isolines of the across
  // coordinate bend and bunch up at its rim); inside, dark concentric rings.
  float aEff = la;
  float knotMask = 0.0;
  float knotDark = 0.0;
  vec3 hk = hash3I(bid, uSeed + 61.0);
  if (hk.x < u_knots) {
    float rk = min(max(u_knot_size * (0.7 + 0.6 * hashI(bid, uSeed + 67.0)), 0.75), max(0.4 * pwB, 0.75));
    float ka = (hk.y - 0.5) * pwB * 0.6;
    float da = la - ka;
    if (!u_planks) da -= A * floor(da / A + 0.5);   // one continuous piece wraps across too
    float dl = ll - hk.z * Lb;
    dl -= Lb * floor(dl / Lb + 0.5);
    float rr = length(vec2(da, dl * 0.6));
    // Windowed so the bend stays local (and seamless): fades out between 2 and 4 knot radii.
    float win = 1.0 - smoothstep(2.0 * rk, 4.0 * rk, rr);
    aEff = la - da * win * rk * rk / max(rr * rr, rk * rk);
    float kr = rr / rk;
    knotMask = 1.0 - smoothstep(0.8, 1.05, kr);
    knotDark = clamp(0.95 - 0.45 * kr + 0.3 * smoothstep(0.55, 0.9, fract(kr * 2.5)), 0.0, 1.0);
  }
  float aAbs = aEff + 0.5 * (box.x + box.y);

  // Fine grain: value noise stretched along the plank, tileable on the texture lattice, offset per board.
  vec2 gc = vec2(A / u_grain_px, 0.0);
  gc.y = A / u_grain_px * (Lr / A) / u_grain_stretch;
  if (uTile) gc = max(floor(gc + 0.5), vec2(1.0));
  ivec2 gper = uTile ? ivec2(gc + 0.5) : NO_PERIOD;
  vec2 gx = vec2(aAbs / A, l / Lr) * gc + hb.xy * vec2(57.0, 31.0);
  // Softness damps the finest octave and widens the streaks' edges.
  float g = org_noiseFbm(0, false, gx, gper, 3, 0.5 - 0.3 * u_grain_soft, uSeed + 11.0);
  float fineDark = smoothstep(0.42 - 0.3 * u_grain_soft, 0.78 + 0.12 * u_grain_soft, g);

  // Ring figure. Low-frequency wobble: about one warp cell per plank across, a few along the texture.
  vec2 rc = vec2(float(n), float(n) * (Lr / A) * 0.75);
  if (uTile) rc = max(floor(rc + 0.5), vec2(1.0));
  ivec2 rper = uTile ? ivec2(rc + 0.5) : NO_PERIOD;
  float wn = org_noiseFbm(1, false, vec2(a / A, l / Lr) * rc, rper, 2, 0.5, uSeed + 13.0) - 0.5;
  float spacing = u_ring_px;
  float r;
  int nRings = 1 << 20;
  if (u_planks) {
    // Elongated rings around a heart per board (periodic along the board, so full-length boards tile). The
    // nearer the heart sits to the board, the more arches / ovals show.
    // Arches = the fraction of boards sawn near the heart; the others show straight, wobbly lines.
    float hh = hashI(bid, uSeed + 41.0);
    bool heart = hashI(bid, uSeed + 43.0) < u_figure;
    float side = hb.z < 0.5 ? -1.0 : 1.0;
    float cx = side * pwB * (heart ? 0.05 + 0.4 * hh : 1.5 + 2.5 * hh);
    float rl = (Lb / PI) * sin(PI * (ll - hb.w * Lb) / Lb);
    r = length(vec2(aEff - cx, rl / max(u_ring_stretch, 1.0))) + u_ring_warp * spacing * 2.0 * wn;
  } else {
    // One continuous piece: lines along the grain, folded into arches where the (stronger, with Arches)
    // wobble bends them back. Whole rings across the tile.
    if (uTile) { float nr = max(floor(A / spacing + 0.5), 1.0); spacing = A / nr; nRings = int(nr); }
    vec2 fc = vec2(2.0, 2.0 * (Lr / A) / max(u_ring_stretch * 0.25, 1.0));
    if (uTile) fc = max(floor(fc + 0.5), vec2(1.0));
    float fn = org_noiseFbm(1, false, vec2(a / A, l / Lr) * fc, org_per(fc), 3, 0.5, uSeed + 17.0) - 0.5;
    r = aAbs + u_ring_warp * spacing * 2.0 * wn + u_figure * A * 0.25 * fn;
  }
  float t = fract(r / spacing);
  int ri = int(floor(r / spacing));
  int rp = ri - 1;
  if (!u_planks && uTile) { ri = imod(ri, nRings); rp = imod(rp, nRings); }
  // Rings per pixel.
  float density = length(vec2(dFdx(r), dFdy(r))) / spacing;
  // Each ring darkens through its latewood and stops where the next ring starts. That edge is softened over e (in rings:
  // up to half a ring with Softness, at least a pixel when anti-aliased) centred on the boundary, so the end of the
  // previous ring spills into the start of this one.
  // The darkening widens with it too (to at least half a ring), so a soft ring is a rounded band, not a fainter line.
  float he = 0.5 * clamp(max(0.5 * u_grain_soft, u_aa ? density : 0.0), 2e-4, 1.0);
  float rw = mix(u_ring_line, max(u_ring_line, 0.5), u_grain_soft);
  float ringDark = smoothstep(1.0 - rw, 1.0, t) * (1.0 - smoothstep(1.0 - he, 1.0 + he, t)) * (0.55 + 0.45 * hashI(ivec2(ri, bid.x * 131 + bid.y), uSeed + 19.0))
                 + (1.0 - smoothstep(-he, he, t)) * (0.55 + 0.45 * hashI(ivec2(rp, bid.x * 131 + bid.y), uSeed + 19.0));
  // Fade rings that crowd closer than ~2 px (they would alias into moiré).
  ringDark *= 1.0 - smoothstep(0.35, 0.6, density);

  float v = 1.0 - 0.85 * clamp(u_fine * fineDark + u_rings * ringDark, 0.0, 1.0);
  v = clamp(mix(v, 1.0 - knotDark, knotMask), 0.0, 1.0);
  // Height: the grain at Grain depth on a full-height surface; edges and gaps keep the full range.
  float hv = mix(1.0, v, u_grain_depth);
  GenOut o;
  if (u_output == 0 && u_planks) {
    float edge = org_edgeProfile(best) * coverage(best, u_aa);
    o = genOutOwn(v * edge, 1.0, rnd, best);
    o.hval = hv * edge;
  } else {
    o = genOut(v, 1.0, rnd, ${ORG_NO_SDF});
    o.hval = hv;
  }
  return o;
}
`,
}

// ------------------------------------------------------------------------------------------------ scales

export const scalesLayer: LayerDef = {
  type: 'scales',
  label: 'Scales',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Overlapping fish / dragon scales: rows of arches, each row offset by half and overlapping the row behind.',
  params: [
    P.enum('output', 'Output', 'scales', [
      ['scales', 'Scales (shading × edges)'],
      ['shape', 'Scale shapes (SDF)'],
    ], { hint: 'Scales: domed value with the Shape bevel at the visible edge and outlines = 0. Shape: the outline of each visible scale for the shape mask' }),
    P.int('columns', 'Columns', 4, 1, 128, { softMax: 16, hint: 'Scales per row' }),
    P.int('rows', 'Rows', 0, 0, 256, { softMax: 32, hint: '0 = auto (row spacing = radius: classic fish scales). Rounded up to even when tiling' }),
    P.float('radius', 'Radius', 0.5, 0.25, 1, { step: 0.001, hint: 'Scale radius as a fraction of the column width (0.5 = neighbours touch)' }),
    P.enum('direction', 'Direction', 'up', [['up', 'Arches up'], ['down', 'Arches down']], { hint: 'Up: lower rows lie on top. Down: upper rows lie on top (roof tiles)' }),
    P.float('outline', 'Outline', 1, 0, 32, { softMax: 4, unit: 'px', step: 0.05, hint: 'Dark gap along each visible scale edge' }),
    P.float('dome', 'Dome', 0.6, 0, 1, { step: 0.001, hint: 'Rounded bulge around each scale centre' }),
    P.float('tilt', 'Tilt', 0, 0, 1, { step: 0.001, hint: 'Scales rise towards their free edge (shingle-like)' }),
    P.seed(),
  ],
  defaults: {
    bevel: 2,
    profile: 'round',
    h_on: true,
    h_amount: 0.5,
    dif_on: true,
    dif_grad: gradient('#101412', '#26302b', '#3d4842', '#66716a'),
    dif_jitter: 0.15,
  },
  glsl:
    ORG_GLSL +
    ORG_GLSL_SDF +
    /* glsl */ `
#define ORG_MAXW 12
GenOut gen(vec2 p) {
  int cols = max(u_columns, 1);
  float sw = uRes.x / float(cols);
  int rows = u_rows > 0 ? u_rows : max(int(floor(uRes.y / (u_radius * sw) + 0.5)), 1);
  if (uTile) rows += rows & 1;
  float rh = uRes.y / float(rows);
  float R = min(u_radius * sw, 4.0 * rh);
  // User space (y down) so rows count from the top; "down" mirrors, so front rows are always further down.
  vec2 q = vec2(p.x, u_direction == 1 ? p.y : uRes.y - p.y);
  int iHi = int(floor(q.y / rh)) + 1;
  int nW = min(int(ceil(2.0 * R / rh)) + 3, ORG_MAXW);
  // Walk rows from the front (lowest) to the back. A scale's visible part is its disc (split from its row
  // neighbours at the midline) minus every disc of the rows in front.
  float frontMin = 1e9;
  float best = 1e9;
  vec2 bestC = q;
  ivec2 bestId = ivec2(0);
  for (int k = 0; k < ORG_MAXW; k++) {
    if (k >= nW) break;
    int i = iHi - k;
    float shift = 0.5 * float(imod(i, 2));
    float cy = float(i) * rh + R;
    int c0 = int(floor(q.x / sw - shift));
    float rowMin = 1e9;
    for (int m = -1; m <= 1; m++) {
      int c = c0 + m;
      vec2 C = vec2((float(c) + 0.5 + shift) * sw, cy);
      float dc = length(q - C) - R;
      rowMin = min(rowMin, dc);
      float vis = max(max(dc, abs(q.x - C.x) - 0.5 * sw), -frontMin);
      if (vis < best) { best = vis; bestC = C; bestId = ivec2(c, i); }
    }
    frontMin = min(frontMin, rowMin);
  }
  ivec2 id = uTile ? imod(bestId, ivec2(cols, rows)) : bestId;
  float rnd = hashI(id, uSeed);
  float d = best + u_outline;
  if (u_output == 1) return genOut(0.0, 1.0, rnd, d);
  float rr = length(q - bestC) / max(R, 1e-3);
  float dome = sqrt(max(1.0 - rr * rr, 0.0));
  float tilt = clamp((bestC.y - q.y) / max(R, 1e-3), 0.0, 1.0);
  float v = mix(1.0, dome, u_dome) * mix(1.0, tilt, u_tilt);
  v *= org_edgeProfile(d) * coverage(d, u_aa);
  return genOut(clamp(v, 0.0, 1.0), 1.0, rnd, ${ORG_NO_SDF});
}
`,
}
