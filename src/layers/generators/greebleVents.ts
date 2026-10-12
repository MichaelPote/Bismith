// Vents and pipes (FR7.2d). Vents: grilles of slots / louvre fins / perforated holes, optionally inside a
// framed field. Pipes: runs of parallel cylinders or conduits with clamp rings. See greebleCommon.ts for the
// relief / SDF output convention.

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { GRB_GLSL, ORIENT } from './greebleCommon'

// ------------------------------------------------------------------------------------------------ vents

export const ventsLayer: LayerDef = {
  type: 'vents',
  label: 'Vents & grilles',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Grille of slots (round or square ends), angled louvre fins or perforated holes, staggered or framed. Tileable.',
  params: [
    P.enum('output', 'Output', 'relief', [
      ['relief', 'Relief (all, value)'],
      ['slots', 'Slots / holes (shape)'],
      ['plate', 'Plate between slots (shape)'],
      ['frame', 'Border frame (shape)'],
    ], { hint: 'Relief: plate with sunken slots or louvre fins (uses the Shape bevel on the frame). Shapes give one element as an SDF' }),
    P.enum('mode', 'Mode', 'slots', [['slots', 'Slots'], ['louvers', 'Louvres (angled fins)'], ['holes', 'Holes']]),
    P.int('cols', 'Columns', 2, 1, 256, { softMax: 32, hint: 'Cells across the field (one slot or hole each)' }),
    P.int('rows', 'Rows', 8, 1, 256, { softMax: 64, hint: 'Cells down the field (even with stagger to tile)' }),
    P.enum('orient', 'Slot direction', 'horizontal', ORIENT, { showIf: (p) => p.mode !== 'holes' }),
    P.float('length', 'Slot length', 24, 1, 4096, { softMax: 128, unit: 'px', step: 0.5, showIf: (p) => p.mode !== 'holes', hint: 'Clamped to the cell; whole px stays crisp' }),
    P.float('width', 'Slot width', 3, 0.5, 1024, { softMax: 16, unit: 'px', step: 0.5, hint: 'Slot thickness, or hole diameter' }),
    P.enum('ends', 'Ends', 'round', [['round', 'Round'], ['square', 'Square'], ['pointed', 'Pointed (45° both sides)'], ['angled', 'Angled (45° cut)']], {
      hint: 'Slot ends. Pointed ends leave bow-tie tabs between staggered slots; angled ends cut both ends on the same diagonal. Holes: round or square',
    }),
    P.float('stagger', 'Stagger', 0, 0, 1, { step: 0.001, hint: 'Shift alternate rows along the slots, fraction of a cell' }),
    P.float('louver', 'Fin slant', 0.8, -1, 1, { step: 0.001, showIf: (p) => p.mode === 'louvers', hint: '0 = rounded bars; ±1 = fins ramping up toward one side' }),
    P.float('margin', 'Frame', 0, 0, 1024, { softMax: 32, unit: 'px', step: 0.5, hint: 'Border with no slots round the tile (0 = endless grille)' }),
    P.float('field_level', 'Field level', 0.8, 0, 1, { step: 0.001, hint: 'Plate height inside the frame; the frame is 1 (relief)' }),
    P.seed(),
  ],
  defaults: {
    h_on: true,
    h_amount: 0.6,
    bevel: 1,
    profile: 'linear',
    dif_on: true,
    dif_src: 'value',
    dif_grad: gradient('#0c0b0a', '#2b2722', '#4c453b', '#6a604f'),
  },
  glsl:
    GRB_GLSL +
    /* glsl */ `
// One slot centred at the origin (x along it): round / square ends, pointed (45° chamfers meeting at a point) or
// angled (both ends cut on the same 45° diagonal).
float vent_slot(vec2 d, float L, float W, float rad) {
  if (u_ends == 2 && u_mode != 2) return max(abs(d.y) - 0.5 * W, (abs(d.x) + abs(d.y) - 0.5 * L) * 0.70710678);
  if (u_ends == 3 && u_mode != 2) return max(abs(d.y) - 0.5 * W, (abs(d.x + d.y) - 0.5 * L + 0.5 * W) * 0.70710678);
  return sdRoundBox(d, 0.5 * vec2(L, W), vec4(rad));
}

GenOut gen(vec2 p) {
  // Local frame: x along the slots, y across them.
  bool vert = u_orient == 1 && u_mode != 2;
  vec2 res = vert ? uRes.yx : uRes;
  vec2 q = vert ? p.yx : p;
  ivec2 n = vert ? ivec2(u_rows, u_cols) : ivec2(u_cols, u_rows);
  n = max(n, ivec2(1));
  float m = u_margin;
  vec2 flo = vec2(m), fhi = res - m;
  vec2 cs = (fhi - flo) / vec2(n);
  bool wrap = uTile && m <= 0.0;
  float dField = grb_box(q, flo, fhi);
  bool holes = u_mode == 2;
  // Slots and holes keep at least a 1 px bar between neighbours (louvre fins may fill the cell).
  float W = min(u_width, u_mode == 1 ? cs.y : max(cs.y - 1.0, 1.0));
  float L = holes ? min(u_width, max(cs.x - 1.0, 1.0)) : min(u_length, cs.x);
  float rad = u_ends == 0 ? 0.5 * min(L, W) : 0.0;
  bool full = !holes && u_length >= cs.x;

  vec2 u = q - flo;
  int r0 = int(floor(u.y / cs.y));
  float best = 1e9, bestRnd = 0.0;
  vec2 bestC = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    int r = r0 + j;
    if (!wrap && (r < 0 || r >= n.y)) continue;
    int rw = wrap ? imod(r, n.y) : r;
    // Alternate rows shift along the slots (rows counted from the top, or from the left when vertical).
    int par = vert ? rw : n.y - 1 - rw;
    float sh = (par & 1) == 1 ? u_stagger * cs.x : 0.0;
    int c0 = int(floor((u.x - sh) / cs.x));
    for (int i = -1; i <= 1; i++) {
      int c = c0 + i;
      if (!wrap && (c < -1 || c > n.x)) continue;
      ivec2 id = ivec2(wrap ? imod(c, n.x) : c, rw);
      vec2 ctr = flo + vec2((float(c) + 0.5) * cs.x + sh, (float(r) + 0.5) * cs.y);
      ctr = vec2(grb_snapC(ctr.x, L), grb_snapC(ctr.y, W));
      // Slots as long as the cell run on as continuous bars (no end caps at the cell / tile edge).
      float d = full ? abs(q.y - ctr.y) - 0.5 * W : vent_slot(q - ctr, L, W, rad);
      if (!wrap) d = max(d, dField);   // staggered slots are clipped by the field
      if (d < best) { best = d; bestRnd = hashI(id, uSeed); bestC = ctr; }
    }
  }

  if (u_output == 1) return genOut(0.0, 1.0, bestRnd, best);
  if (u_output == 2) return genOut(0.0, 1.0, bestRnd, wrap ? -best : max(-best, dField));
  if (u_output == 3) return genOut(0.0, 1.0, bestRnd, m > 0.0 ? -dField : 1e4);

  float plate = m > 0.0 ? mix(1.0, u_field_level, grb_rise(dField, u_bevel)) : u_field_level;
  float v;
  if (u_mode == 1) {
    // Louvre: the slot shows a fin ramping across its width (sharp drop at the high edge).
    float t = clamp((q.y - (bestC.y - 0.5 * W)) / max(W, 1e-3), 0.0, 1.0);
    float x = 2.0 * t - 1.0;
    float ramp = u_louver >= 0.0 ? t : 1.0 - t;
    float fin = mix(sqrt(max(1.0 - x * x, 0.0)), ramp, abs(u_louver));
    v = mix(plate, plate * fin, grb_cov(best));
  } else {
    v = plate * (1.0 - grb_cov(best));
  }
  return genOut(clamp(v, 0.0, 1.0), 1.0, bestRnd, NO_SDF);
}
`,
}

// ------------------------------------------------------------------------------------------------ pipes

export const pipesLayer: LayerDef = {
  type: 'pipes',
  label: 'Pipes & conduits',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Runs of parallel pipes (round) or conduits (flat), optionally bundled, with clamp rings at intervals. Tileable.',
  params: [
    P.enum('output', 'Output', 'relief', [
      ['relief', 'Relief (all, value)'],
      ['pipes', 'Pipes (shape)'],
      ['clamps', 'Clamps (shape)'],
      ['both', 'Pipes + clamps (shape)'],
    ], { hint: 'Relief: true half-cylinder heights (round) or bevelled conduits. Pipes as a shape: use the Round profile with bevel ≈ radius' }),
    P.enum('orient', 'Direction', 'horizontal', ORIENT),
    P.enum('shape', 'Profile', 'round', [['round', 'Round pipe'], ['conduit', 'Flat conduit (bevel)']]),
    P.int('count', 'Count', 3, 1, 256, { softMax: 32, hint: 'Pipes (or bundles) across the tile' }),
    P.int('bundle', 'Bundle', 1, 1, 8, { hint: 'Pipes side by side in each run' }),
    P.float('diameter', 'Diameter', 8, 1, 1024, { softMax: 64, unit: 'px', step: 0.5 }),
    P.float('dia_var', 'Diameter variation', 0, 0, 0.9, { step: 0.001, hint: 'Random reduction per run' }),
    P.float('jitter', 'Position jitter', 0, 0, 256, { softMax: 16, unit: 'px', step: 0.5 }),
    P.float('offset', 'Offset', 0, 0, 1, { step: 0.001, hint: 'Shift across, fraction of the spacing' }),
    P.int('clamps', 'Clamps', 2, 0, 256, { softMax: 16, group: 'clamps', hint: 'Clamp rings per pipe along the tile (0 = none)' }),
    P.float('clamp_width', 'Width', 3, 1, 256, { softMax: 16, unit: 'px', step: 0.5, group: 'clamps' }),
    P.float('clamp_lip', 'Lip', 1, 0, 64, { softMax: 8, unit: 'px', step: 0.5, group: 'clamps', hint: 'How far the ring stands proud of the pipe' }),
    P.float('clamp_offset', 'Offset', 0, 0, 1, { step: 0.001, group: 'clamps', hint: 'Shift of the rings along the pipes, fraction of their spacing' }),
    P.float('clamp_jitter', 'Phase jitter', 1, 0, 1, { step: 0.001, group: 'clamps', hint: 'Random shift of the rings per pipe, fraction of their spacing' }),
    P.seed(),
  ],
  groups: [{ id: 'clamps', label: 'Clamps' }],
  defaults: {
    h_on: true,
    h_amount: 1,
    bevel: 2,
    profile: 'round',
    dif_on: true,
    dif_src: 'value',
    dif_grad: gradient('#0d0c0b', '#3a342c', '#5c5344', '#7c6f5a'),
  },
  glsl:
    GRB_GLSL +
    /* glsl */ `
GenOut gen(vec2 p) {
  // Local frame: x along the pipes, y across.
  bool vert = u_orient == 1;
  vec2 res = vert ? uRes.yx : uRes;
  vec2 q = vert ? p.yx : p;
  int n = max(u_count, 1);
  int nb = max(u_bundle, 1);
  float per = res.y / float(n);
  float D0 = clamp(u_diameter, 1.0, max(floor(per / float(nb)), 1.0));   // runs never overlap
  float lip = max(u_clamp_lip, 0.0);
  float Rmax = 0.5 * D0 + lip;

  int k0 = int(floor(q.y / per - u_offset));
  float best = 1e9, bestR = 1.0, bestY = 0.0, bestRnd = 0.0;
  int bestId = 0;
  for (int j = -1; j <= 1; j++) {
    int k = k0 + j;
    int kw = uTile ? imod(k, n) : k;
    vec3 h = hash3I(ivec2(kw, 0), uSeed);
    float D = u_dia_var > 0.0 ? max(floor(D0 * (1.0 - u_dia_var * h.x) + 0.5), 1.0) : D0;
    float cy = (float(k) + 0.5 + u_offset) * per + (h.y - 0.5) * 2.0 * u_jitter;
    float tot = D * float(nb);
    float y0 = grb_snapC(cy, tot) - 0.5 * tot;
    float jj = clamp(floor((q.y - y0) / D), 0.0, float(nb - 1));
    float c = y0 + (jj + 0.5) * D;
    float d = abs(q.y - c) - 0.5 * D;
    if (d < best) {
      best = d; bestR = 0.5 * D; bestY = q.y - c;
      bestId = kw * 8 + int(jj);
      bestRnd = hashI(ivec2(bestId, 1), uSeed);
    }
  }

  // Clamp rings: whole-px bands along the pipe, phase random per pipe.
  float dC = 1e4, da = 1e4;
  float R = bestR + lip;
  if (u_clamps > 0) {
    float sp = res.x / float(u_clamps);
    float ph = u_clamp_offset + hashI(ivec2(bestId / 8, 3), uSeed) * u_clamp_jitter;   // per run: bundles share straps
    float cw = max(u_clamp_width, 1.0);
    float i0 = floor(q.x / sp - ph);
    for (int i = -1; i <= 1; i++) {
      float x0 = floor((i0 + float(i) + ph) * sp + 0.5);
      da = min(da, abs(q.x - (x0 + 0.5 * cw)) - 0.5 * cw);
    }
    dC = max(da, abs(bestY) - R);
  }

  if (u_output == 1) return genOut(0.0, 1.0, bestRnd, best);
  if (u_output == 2) return genOut(0.0, 1.0, bestRnd, dC);
  if (u_output == 3) return genOut(0.0, 1.0, bestRnd, min(best, dC));

  float hp, hc;
  if (u_shape == 0) {
    hp = sqrt(max(bestR * bestR - bestY * bestY, 0.0)) / Rmax;
    hc = sqrt(max(R * R - bestY * bestY, 0.0)) / Rmax;
  } else {
    hp = bestR / Rmax * grb_rise(best, u_bevel);
    hc = R / Rmax * grb_rise(abs(bestY) - R, u_bevel);
  }
  hp *= grb_cov(best);
  float v = u_clamps > 0 ? max(hp, hc * grb_cov(da)) : hp;
  return genOut(clamp(v, 0.0, 1.0), 1.0, bestRnd, NO_SDF);
}
`,
}
