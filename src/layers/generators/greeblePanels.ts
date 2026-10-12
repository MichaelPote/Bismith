// Panels (FR7.2d): recursive kd-style subdivision of the tile into machine panels, with seams, per-panel
// height steps, inset frames, rivets and small details (vent slots, lights, recesses). See greebleCommon.ts
// for the relief / SDF output convention.

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { GRB_GLSL } from './greebleCommon'

const hasFrame = (p: Record<string, unknown>) => Number(p.frame_chance) > 0
const hasRivets = (p: Record<string, unknown>) => p.rivets !== 'none'
const hasDetails = (p: Record<string, unknown>) => Number(p.detail_chance) > 0

export const panelsLayer: LayerDef = {
  type: 'panels',
  label: 'Machine panels',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description:
    'Recursive rectangular subdivision into machine panels: seams, per-panel height steps, inset frames, rivets, vents, lights and recesses. Tileable.',
  params: [
    P.enum('output', 'Output', 'relief', [
      ['relief', 'Relief (all, value)'],
      ['panels', 'Panels (shape)'],
      ['seams', 'Seams (shape)'],
      ['frames', 'Inset frames (shape)'],
      ['rivets', 'Rivets (shape)'],
      ['details', 'Details (shape)'],
      ['lights', 'Lights (shape)'],
    ], { hint: 'Relief composes every element into one height value (uses the Shape bevel). The shape outputs give one element class as an SDF — stack copies with the same seed for separate materials' }),
    P.int('depth', 'Depth', 4, 0, 12, { hint: 'Maximum number of recursive splits' }),
    P.int('min_size', 'Min panel', 8, 1, 1024, { softMax: 64, unit: 'px', hint: 'No panel side is cut below this' }),
    P.int('max_size', 'Max panel', 32, 1, 4096, { softMax: 256, unit: 'px', hint: 'Sides longer than this are always cut (if min allows)' }),
    P.float('split', 'Split chance', 0.6, 0, 1, { step: 0.001, hint: 'Chance to cut a panel that is between min and max size' }),
    P.float('bias', 'Cut bias', 0, -1, 1, { step: 0.001, hint: '−1 = vertical cuts (columns), +1 = horizontal cuts (rows), 0 = cut across the longer side' }),
    P.float('split_var', 'Cut randomness', 0.7, 0, 1, { step: 0.001, hint: '0 = always cut in the middle, 1 = anywhere' }),
    P.int('snap', 'Cut grid', 4, 1, 256, { softMax: 32, unit: 'px', hint: 'Cuts snap to multiples of this (from the tile origin)' }),
    P.float('gap', 'Seam', 1, 0, 64, { softMax: 8, unit: 'px', step: 0.5, hint: 'Seam along the left and top of each panel (whole px stays crisp)' }),
    P.float('round', 'Corner rounding', 0, 0, 64, { softMax: 8, unit: 'px', step: 0.1 }),
    P.int('levels', 'Height levels', 3, 1, 16, { hint: 'Distinct per-panel heights (relief)' }),
    P.float('height_var', 'Height variation', 0.3, 0, 1, { step: 0.001, hint: 'How far the lowest panel level sits below the highest (relief)' }),
    P.float('inset_depth', 'Inset depth', 0.25, 0, 1, { step: 0.001, hint: 'Depth of grooves, recesses and light housings (relief)' }),
    P.float('offset_x', 'Offset X', 0, 0, 1, { step: 0.001, hint: 'Shift the layout (fraction of the width) so the tile edge is not a seam' }),
    P.float('offset_y', 'Offset Y', 0, 0, 1, { step: 0.001 }),
    P.seed(),

    P.float('frame_chance', 'Chance', 0.35, 0, 1, { step: 0.001, group: 'frame', hint: 'Fraction of panels with an inset frame' }),
    P.enum('frame_style', 'Style', 'groove', [['groove', 'Groove line'], ['ridge', 'Raised line'], ['recess', 'Recessed centre'], ['raise', 'Raised centre']], { group: 'frame', showIf: hasFrame }),
    P.float('frame_inset', 'Inset', 3, 0, 256, { softMax: 16, unit: 'px', step: 0.5, group: 'frame', showIf: hasFrame }),
    P.float('frame_width', 'Line width', 1, 0.5, 64, { softMax: 4, unit: 'px', step: 0.5, group: 'frame', showIf: (p) => hasFrame(p) && (p.frame_style === 'groove' || p.frame_style === 'ridge') }),

    P.enum('rivets', 'Rivets', 'corners', [['none', 'None'], ['corners', 'Corners'], ['edges', 'Along edges']], { group: 'rivets' }),
    P.float('rivet_chance', 'Chance', 0.6, 0, 1, { step: 0.001, group: 'rivets', showIf: hasRivets }),
    P.float('rivet_radius', 'Radius', 1, 0.5, 32, { softMax: 4, unit: 'px', step: 0.5, group: 'rivets', showIf: hasRivets, hint: 'Whole or half px: 1 → 2×2, 1.5 → 3×3' }),
    P.float('rivet_inset', 'Inset', 2.5, 0, 64, { softMax: 16, unit: 'px', step: 0.5, group: 'rivets', showIf: hasRivets, hint: 'Panel edge to rivet centre' }),
    P.float('rivet_spacing', 'Spacing', 8, 1, 256, { softMax: 32, unit: 'px', step: 0.5, group: 'rivets', showIf: (p) => p.rivets === 'edges' }),
    P.float('rivet_height', 'Height', 0.3, 0, 1, { step: 0.001, group: 'rivets', showIf: hasRivets, hint: 'Dome height above the panel (relief)' }),

    P.float('detail_chance', 'Chance', 0.3, 0, 1, { step: 0.001, group: 'details', hint: 'Fraction of panels with a detail' }),
    P.bool('det_vents', 'Vent slots', true, { group: 'details', showIf: hasDetails }),
    P.bool('det_light', 'Light', true, { group: 'details', showIf: hasDetails }),
    P.bool('det_recess', 'Recess', true, { group: 'details', showIf: hasDetails }),
    P.float('det_size', 'Size', 0.6, 0.05, 1, { step: 0.001, group: 'details', showIf: hasDetails, hint: 'Detail area as a fraction of the panel' }),
    P.float('vent_pitch', 'Vent pitch', 3, 2, 64, { softMax: 8, unit: 'px', step: 0.5, group: 'details', showIf: (p) => hasDetails(p) && Boolean(p.det_vents) }),
    P.float('vent_slot', 'Vent slot', 1, 1, 32, { softMax: 6, unit: 'px', step: 0.5, group: 'details', showIf: (p) => hasDetails(p) && Boolean(p.det_vents) }),
    P.float('light_size', 'Light size', 2, 1, 64, { softMax: 8, unit: 'px', step: 0.5, group: 'details', showIf: (p) => hasDetails(p) && Boolean(p.det_light), hint: 'Short side; the long side is twice this' }),
  ],
  groups: [
    { id: 'frame', label: 'Inset frame', collapsed: true },
    { id: 'rivets', label: 'Rivets', collapsed: true },
    { id: 'details', label: 'Details', collapsed: true },
  ],
  defaults: {
    h_on: true,
    h_amount: 0.6,
    bevel: 1,
    profile: 'linear',
    dif_on: true,
    dif_src: 'value',
    dif_jitter: 0.12,
    dif_grad: gradient('#14120f', '#3b352d', '#5a5145', '#6e6455', '#9a8a70'),
  },
  glsl:
    GRB_GLSL +
    /* glsl */ `
struct GrbCell { vec2 lo; vec2 hi; uint id; };

// Cut position between a0 and a1 at fraction t of the allowed range, snapped to the cut grid (whole px as a
// fallback), keeping both children >= mn. Returns -1 when no valid cut exists.
float grb_cutPos(float a0, float a1, float t, float mn) {
  float c = mix(a0 + mn, a1 - mn, t);
  float s = float(max(u_snap, 1));
  float cs = floor(c / s + 0.5) * s;
  if (cs < a0 + mn - 1e-3) cs += s;
  if (cs > a1 - mn + 1e-3) cs -= s;
  if (cs >= a0 + mn - 1e-3 && cs <= a1 - mn + 1e-3) return cs;
  c = floor(c + 0.5);
  if (c >= a0 + mn - 1e-3 && c <= a1 - mn + 1e-3) return c;
  return -1.0;
}

// Bounded iterative descent of the kd-tree: every node's decisions hash only its path id, so each pixel
// walks the same tree. The root is the whole tile (its border is a seam; offset moves it).
GrbCell grb_panelAt(vec2 q) {
  vec2 lo = vec2(0.0), hi = uRes;
  uint id = pcg(uint(uSeed) + 0x51ED27u);
  float mn = float(max(u_min_size, 1));
  float mx = float(max(u_max_size, 1));
  for (int d = 0; d < 12; d++) {
    if (d >= u_depth) break;
    vec2 sz = hi - lo;
    bool canX = sz.x >= 2.0 * mn - 1e-3;
    bool canY = sz.y >= 2.0 * mn - 1e-3;
    if (!canX && !canY) break;
    bool mustX = canX && sz.x > mx + 1e-3;
    bool mustY = canY && sz.y > mx + 1e-3;
    if (!mustX && !mustY && grb_rand(id, 1u) >= u_split) break;
    bool cutY;   // true: a horizontal cut line (splits the height into rows)
    if (!canX) cutY = true;
    else if (!canY) cutY = false;
    else if (mustX != mustY) cutY = mustY;
    else {
      float pref = sz.y > sz.x * 1.1 ? 0.8 : (sz.x > sz.y * 1.1 ? 0.2 : 0.5);
      cutY = grb_rand(id, 2u) < clamp(pref + u_bias, 0.0, 1.0);
    }
    float t = 0.5 + (grb_rand(id, 3u) - 0.5) * u_split_var;
    float c = cutY ? grb_cutPos(lo.y, hi.y, t, mn) : grb_cutPos(lo.x, hi.x, t, mn);
    if (c < 0.0) break;
    bool upper = (cutY ? q.y : q.x) >= c;
    if (cutY) { if (upper) lo.y = c; else hi.y = c; }
    else { if (upper) lo.x = c; else hi.x = c; }
    id = pcg(id ^ (upper ? 0x68E31DA4u : 0xB5297A4Du));
  }
  return GrbCell(lo, hi, id);
}

// Rivet centre distance from a panel edge: the near-edge margin is whole px, so rivets mirror exactly.
float grb_rivetM(float ins, float D) { return max(floor(ins - 0.5 * D + 0.5), 0.0) + 0.5 * D; }

GenOut gen(vec2 p) {
  vec2 shift = floor(vec2(u_offset_x, -u_offset_y) * uRes + 0.5);
  vec2 q = p - shift;
  if (uTile) q = fmod2(q, uRes);
  GrbCell cell = grb_panelAt(q);
  uint id = cell.id;
  float rnd = grb_rand(id, 7u);

  // Panel = cell minus the seam along its left and top (GL: high y) edges, so whole-px seams are crisp.
  vec2 plo = vec2(cell.lo.x + u_gap, cell.lo.y);
  vec2 phi = vec2(cell.hi.x, cell.hi.y - u_gap);
  vec2 psz = max(phi - plo, vec2(0.0));
  float dP = grb_rbox(q, plo, phi, u_round);
  // In the seam, the neighbouring panels reach the cell's left / top edge.
  if (dP > 0.0) dP = min(dP, max(min(q.x - cell.lo.x, cell.hi.y - q.y), 0.0));

  int levels = max(u_levels, 1);
  float lvl = levels > 1 ? floor(grb_rand(id, 8u) * float(levels)) / float(levels - 1) : 0.0;
  float P = 0.75 * (1.0 - u_height_var * lvl);
  float v = P * grb_rise(dP, u_bevel);

  // ---- inset frame
  float dF = 1e4;
  if (grb_rand(id, 9u) < u_frame_chance) {
    vec2 ilo = plo + u_frame_inset, ihi = phi - u_frame_inset;
    if (all(greaterThan(ihi - ilo, vec2(2.0)))) {
      float dI = grb_rbox(q, ilo, ihi, max(u_round - u_frame_inset, 0.0));
      if (u_frame_style <= 1) {
        // A line just inside the inner rectangle: starts on its edge, whole px wide.
        dF = abs(dI + 0.5 * u_frame_width) - 0.5 * u_frame_width;
        v += (u_frame_style == 0 ? -1.0 : 1.0) * u_inset_depth * grb_cov(dF);
      } else {
        dF = dI;
        v += (u_frame_style == 2 ? -1.0 : 1.0) * u_inset_depth * grb_rise(dI, u_bevel);
      }
    }
  }

  // ---- rivets
  float dR = 1e4;
  float rr = u_rivet_radius;
  if (u_rivets > 0 && grb_rand(id, 10u) < u_rivet_chance) {
    float D = 2.0 * rr;
    float m = grb_rivetM(u_rivet_inset, D);
    vec2 a = plo + m, b = phi - m;   // rectangle of rivet centres
    if (all(greaterThanEqual(b - a, vec2(0.0)))) {
      if (u_rivets == 1) {
        vec2 c = vec2(q.x < 0.5 * (a.x + b.x) ? a.x : b.x, q.y < 0.5 * (a.y + b.y) ? a.y : b.y);
        dR = length(q - c) - rr;
      } else {
        vec2 span = b - a;
        vec2 n = max(floor(span / max(u_rivet_spacing, 1.0) + 0.5), vec2(1.0));
        vec2 st = span / n;
        vec2 k = clamp(floor((q - a) / max(st, vec2(1e-3)) + 0.5), vec2(0.0), n);
        float x = grb_snapC(a.x + k.x * st.x, D);
        float y = grb_snapC(a.y + k.y * st.y, D);
        dR = min(min(length(q - vec2(x, a.y)), length(q - vec2(x, b.y))),
                 min(length(q - vec2(a.x, y)), length(q - vec2(b.x, y)))) - rr;
      }
      v += u_rivet_height * grb_dome(dR + rr, rr);
    }
  }

  // ---- one detail per chosen panel: vent slots, a light, or a recess
  float dD = 1e4, dL = 1e4;
  int nk = (u_det_vents ? 1 : 0) + (u_det_light ? 1 : 0) + (u_det_recess ? 1 : 0);
  if (nk > 0 && grb_rand(id, 11u) < u_detail_chance) {
    vec2 mg = floor(psz * (1.0 - u_det_size) * 0.5 + 0.5);
    vec2 rlo = plo + mg, rhi = phi - mg;
    vec2 rs = rhi - rlo;
    if (all(greaterThanEqual(rs, vec2(3.0)))) {
      int pick = int(floor(grb_rand(id, 12u) * float(nk)));
      int kind = -1, cnt = 0;
      if (u_det_vents) { if (cnt == pick) kind = 0; cnt++; }
      if (u_det_light) { if (cnt == pick) kind = 1; cnt++; }
      if (u_det_recess) { if (cnt == pick) kind = 2; cnt++; }
      bool horiz = rs.x >= rs.y;
      if (kind == 0) {
        // Slots run along the longer side, stacked across the shorter one.
        vec2 ql = horiz ? q : q.yx;
        vec2 lo2 = horiz ? rlo : rlo.yx, hi2 = horiz ? rhi : rhi.yx;
        float pitch = max(u_vent_pitch, 2.0);
        float sw = clamp(u_vent_slot, 1.0, pitch - 1.0);
        float sl = hi2.y - lo2.y;
        float n = max(floor((sl + pitch - sw) / pitch), 1.0);
        float tot = n * pitch - (pitch - sw);
        float y0 = lo2.y + floor((sl - tot) * 0.5);
        float j = clamp(floor((ql.y - y0) / pitch), 0.0, n - 1.0);
        float sy = y0 + j * pitch;
        dD = grb_rbox(ql, vec2(lo2.x, sy), vec2(hi2.x, sy + sw), 0.5 * sw);
        v = mix(v, 0.0, grb_cov(dD));
      } else if (kind == 1) {
        float s = max(u_light_size, 1.0);
        vec2 ls = horiz ? vec2(min(2.0 * s, rs.x), min(s, rs.y)) : vec2(min(s, rs.x), min(2.0 * s, rs.y));
        vec2 c = 0.5 * (rlo + rhi);
        c = vec2(grb_snapC(c.x, ls.x), grb_snapC(c.y, ls.y));
        dL = grb_rbox(q, c - 0.5 * ls, c + 0.5 * ls, min(1.0, 0.25 * min(ls.x, ls.y)));
        dD = dL - 1.0;   // housing: one px round the lens
        v = mix(v, P - u_inset_depth, grb_cov(dD));
        v = mix(v, P - 0.4 * u_inset_depth, grb_cov(dL));
      } else if (kind == 2) {
        dD = grb_box(q, rlo, rhi);
        v -= u_inset_depth * grb_rise(dD, u_bevel);
      }
    }
  }

  if (u_output == 0) return genOut(clamp(v, 0.0, 1.0), 1.0, rnd, NO_SDF);
  float d = u_output == 1 ? dP : u_output == 2 ? -dP : u_output == 3 ? dF : u_output == 4 ? dR : u_output == 5 ? dD : dL;
  return genOut(0.0, 1.0, rnd, d);
}
`,
}
