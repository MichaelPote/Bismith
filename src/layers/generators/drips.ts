// Drips (FR7.7): water / rust / blood stains that run down from scattered sources — a tapering trail that fades as
// it goes, wobbling slightly. The value is the stain strength and the coverage is soft, so with a Normal or Multiply
// diffuse blend a drip stains whatever the layers beneath painted, in proportion to its strength.
// Output "Sources" gives a small dome at each origin instead (same seed → same places): raise it in the relief stack
// for the blistered, flaking paint that rust bleeds from. Wraps on tileable projects.
//
// Two styles. Streak (pixel): the classic narrow trail, crisp at 1 px. Runnels (detailed), for higher resolutions and
// wide stains: water running down a wall — a faint wash whose centre line wanders on smooth noise (it may widen or
// narrow as it goes), a darker tide-mark deposit along its edges, dry patches breaking it up, and inside it a few thin
// runnels, each wandering on its own (so they cross, merge and split), each ending at its own length, thinning as it
// goes, some in a drop bead. Drips added in the editor start as runnels (LayerDef.fresh); everything else keeps the
// streak default.

import { P } from '@/core/params'
import type { LayerDef } from '../types'

const isRunnels = (p: Record<string, unknown>) => p.style === 'runnels'
const stains = (p: Record<string, unknown>) => p.output !== 'source'

export const dripsLayer: LayerDef = {
  type: 'drips',
  label: 'Drips',
  category: 'pattern',
  kind: 'generator',
  description: 'Water, rust or blood stains running down from scattered sources, staining what is beneath; or the sources themselves (paint blisters).',
  params: [
    P.enum('output', 'Output', 'stain', [['stain', 'Stains (trails)'], ['source', 'Sources (blisters)']], {
      hint: 'Sources: a dome at each drip origin — raise it in the relief stack for flaking, bubbled paint the stains bleed from',
    }),
    P.enum('style', 'Style', 'streak', [
      ['streak', 'Streak (pixel)', 'a narrow trail, tapering and fading — crisp at 1 px'],
      ['runnels', 'Runnels (detailed)', 'a wandering wash of water with tide-marked edges and thin runnels inside that split, merge and end in beads — for higher resolutions and wide stains'],
    ], { showIf: stains }),
    P.int('cols', 'Columns', 12, 1, 256, { softMax: 48, hint: 'Source cells across the texture' }),
    P.int('rows', 'Rows', 6, 1, 256, { softMax: 32, hint: 'Source cells down the texture' }),
    P.float('density', 'Density', 0.5, 0, 1, { step: 0.001, hint: 'Chance that a cell holds a drip' }),
    P.float('len_min', 'Min length', 4, 0, 1024, { softMax: 64, unit: 'px', step: 0.5 }),
    P.float('len_max', 'Max length', 20, 0, 1024, { softMax: 128, unit: 'px', step: 0.5 }),
    P.float('width', 'Width', 1, 0.25, 64, { softMax: 6, unit: 'px', step: 0.05, hint: 'Trail width at the head (it tapers to half)' }),
    P.float('width_var', 'Width variation', 0.5, 0, 1, { step: 0.001 }),
    P.float('head', 'Head / blister size', 0, 0, 32, { softMax: 4, unit: 'px', step: 0.05, hint: 'Stains: a drop blob at the origin (0 = none — water and blood have none). Sources: blister radius' }),
    P.float('start', 'Trail strength', 0.8, 0, 1, { step: 0.001, hint: 'Strength where the trail starts (it fades to 0)' }),
    P.float('fade', 'Fade', 1, 0.1, 8, { softMax: 4, step: 0.01, hint: 'How quickly the trail fades: 1 linear, < 1 stays strong longer, > 1 fades early' }),
    P.float('wobble', 'Wobble', 0.4, 0, 64, { softMax: 8, unit: 'px', step: 0.05, hint: 'Sideways meander along the trail (runnels: how far the whole stain wanders)' }),
    P.float('wander', 'Meander length', 28, 2, 512, { softMax: 96, unit: 'px', step: 0.5, showIf: isRunnels, hint: 'Length of one sideways swing of the stain; the runnels swing about twice as often' }),
    P.float('taper', 'Taper', 0.2, -1, 1, { step: 0.01, showIf: isRunnels, hint: 'Width change down the stain: 1 narrows to a point, 0 keeps it, below 0 it spreads' }),
    P.int('runnels', 'Runnels', 4, 1, 8, { showIf: isRunnels, hint: 'Most runnels in one stain (each stain draws 1 to this many; narrow stains hold fewer)' }),
    P.float('runnel_width', 'Runnel width', 1.5, 0.5, 32, { softMax: 6, unit: 'px', step: 0.05, showIf: isRunnels, hint: 'Width of each runnel where it starts; it thins to half' }),
    P.float('sheet', 'Wash', 0.35, 0, 1, { step: 0.001, showIf: isRunnels, hint: 'The faint stain of the water sheet between the runnels' }),
    P.float('edge', 'Tide marks', 0.5, 0, 1, { step: 0.001, showIf: isRunnels, hint: 'The darker deposit along the wash\'s edges, where it dried' }),
    P.float('breakup', 'Dry patches', 0.35, 0, 1, { step: 0.001, showIf: isRunnels, hint: 'Breaks the wash up into patches' }),
    P.float('beads', 'Beads', 0.3, 0, 1, { step: 0.001, showIf: isRunnels, hint: 'Chance a runnel ends in a drop' }),
    P.float('relief', 'Relief drive', 0, 0, 1, { step: 0.001, group: 'relief', hint: 'Reads the height built by the layers beneath: 0 = scattered sources, 1 = drips only start on ledges (the lower edges of raised features — rivets, lips, blisters)' }),
    P.float('ledge', 'Ledge threshold', 0.15, 0, 8, { softMax: 1, step: 0.001, group: 'relief', hint: 'Height drop (height units, over the ledge reach) that counts as a ledge — raise it until shallow bumps stop sprouting drips' }),
    P.float('ledge_reach', 'Ledge reach', 2, 1, 16, { softMax: 8, unit: 'px', step: 0.5, group: 'relief', hint: 'How far below a point the drop is measured: short = only hard, sharp steps count; long = soft, gradual edges count too' }),
    P.float('ledge_soft', 'Ledge softness', 0.15, 0, 1, { step: 0.001, group: 'relief', hint: 'Acceptance around the threshold: 0 = hard cut-off, 1 = a gradual ramp (weaker ledges drip less often)' }),
    P.float('relief_len', 'Height → length', 0, 0, 32, { softMax: 8, step: 0.01, group: 'relief', hint: 'Trails lengthen with the ledge they fall from: length × (1 + this × drop) — taller rivets, longer tails' }),
    P.bool('hard', 'Hard edges', true, { hint: 'No anti-aliasing (pixel art)' }),
    P.seed(),
  ],
  groups: [{ id: 'relief', label: 'Relief' }],
  // Added in the editor: a detailed water stain, sized to the texture, darkening what is beneath.
  fresh: ({ width }) => {
    const k = Math.max(0.5, width / 128)
    const r1 = (v: number) => Math.round(v * 10) / 10
    return {
      style: 'runnels', cols: 6, rows: 3, density: 0.6, len_min: r1(24 * k), len_max: r1(80 * k), width: r1(10 * k), width_var: 0.4, wobble: r1(3 * k),
      wander: r1(32 * k), runnel_width: r1(Math.max(1, 1.6 * k)), start: 0.85, fade: 0.8, hard: false,
      dif_blend: 'multiply', dif_grad: { stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#5e4c3c' }] },
    }
  },
  defaults: { h_on: false, dif_on: true, dif_grad: { stops: [{ pos: 0, color: '#5a1e10' }, { pos: 1, color: '#7a2a14' }] } },
  glsl: /* glsl */ `
// Smooth 1D value noise, −1..1.
float dr_n1(float x, float s) {
  float i = floor(x);
  float f = x - i;
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hashI(ivec2(int(i), 71), s), hashI(ivec2(int(i) + 1, 71), s), u) * 2.0 - 1.0;
}

// The runnel style's centre line (px across, at px down) and half width at t = 0..1.
float dr_cx(float y, float lam, float rs) { return u_wobble * (0.65 * dr_n1(y / lam, rs) + 0.35 * dr_n1(y / (0.37 * lam), rs + 3.1)); }
float dr_hw(float w, float t) { return max(0.5 * w * (1.0 - u_taper * t), 0.5); }
// The water spreads from its seep: the stain widens from a third of its width over its first stretch.
float dr_spread(float y, float w) { return mix(0.3, 1.0, smoothstep(0.0, max(3.0, 1.2 * w), y)); }
// Runnel j's place across the wash (−1..1) at px down.
float dr_bj(float base, float y, float lam, float rs, int j) {
  float s = rs + 7.0 + float(j) * 5.3;
  return clamp(base + 0.5 * dr_n1(y / (0.5 * lam), s) + 0.2 * dr_n1(y / (0.17 * lam), s + 2.7), -0.95, 0.95);
}

// One runnel-style stain, d from its source (px, y down), length len, head width w, per-stain seed rs: its strength
// (already anti-aliased: the caller uses it as both value and coverage).
float dr_runnels(vec2 d, float len, float w, float rs) {
  float lam = max(u_wander, 2.0);
  if (d.y < -2.0 || d.y > len + 4.0 * u_runnel_width + 2.0) return 0.0;
  if (abs(d.x) > u_wobble + 0.5 * w * (1.0 + max(-u_taper, 0.0)) + 3.0 * u_runnel_width + 2.0) return 0.0;
  float t = clamp(d.y / max(len, 1e-3), 0.0, 1.0);
  float x = d.x - dr_cx(d.y, lam, rs);
  float hw = dr_hw(w, t) * dr_spread(d.y, w);
  float best = 0.0;
  // Wash: the water sheet, a tide-marked edge, dry patches.
  if (d.y >= 0.0 && d.y <= len) {
    float inEdge = hw - abs(x);
    float inside = u_hard ? step(0.0, inEdge) : clamp(inEdge + 0.5, 0.0, 1.0);
    if (inside > 0.0) {
      float tide = exp(-max(inEdge, 0.0) * max(inEdge, 0.0) / 1.5);
      float dry = 1.0;
      if (u_breakup > 0.0) {
        float n = valueNoise(vec2(x / max(1.5, 0.5 * hw), d.y / max(3.0, hw)) + rs, NO_PERIOD, rs);
        dry = smoothstep(u_breakup - 0.12, u_breakup + 0.12, n);
      }
      best = u_start * pow(1.0 - t, u_fade) * (u_sheet * dry + u_edge * tide) * inside;
    }
  }
  // Runnels: 1 to u_runnels of them (narrow stains hold fewer), each wandering on its own.
  int k = 1 + int(floor(hashI(ivec2(1, 31), rs) * float(u_runnels)));
  k = clamp(min(k, int(2.0 * 0.5 * w / max(1.5 * u_runnel_width, 0.75)) + 1), 1, 8);
  for (int j = 0; j < 8; j++) {
    if (j >= k) break;
    float hj = hashI(ivec2(j, 33), rs);
    float hb = hashI(ivec2(j, 35), rs);
    float lj = len * (0.45 + 0.55 * hj);
    float base = k == 1 ? 0.0 : ((float(j) + 0.5) / float(k) * 2.0 - 1.0) * 0.8;
    // A runnel keeps most of its strength to its end (fade: how much it loses), where it may stop in a bead.
    float endS = u_start * (0.7 + 0.3 * hb) * mix(1.0, 0.35, clamp(0.5 * u_fade, 0.0, 1.0));
    if (d.y >= 0.0 && d.y <= lj) {
      float tj = d.y / max(lj, 1e-3);
      float rw = max(u_runnel_width * (1.0 - 0.5 * tj), 0.5);
      float dist = abs(x - dr_bj(base, d.y, lam, rs, j) * hw) - 0.5 * rw;
      float cov = u_hard ? step(dist, 0.0) : clamp(0.5 - dist, 0.0, 1.0);
      best = max(best, mix(u_start * (0.7 + 0.3 * hb), endS, tj) * cov);
    }
    // Bead: a drop where the runnel ends, a little stronger than the runnel there — an ellipse narrower than it is
    // tall, hanging from the runnel (a round one reads as a rivet).
    if (hb < u_beads) {
      float hwL = dr_hw(w, lj / max(len, 1e-3)) * dr_spread(lj, w);
      vec2 rb = vec2(0.45, 0.85) * (u_runnel_width + 0.6);
      vec2 bc = vec2(dr_cx(lj, lam, rs) + dr_bj(base, lj, lam, rs, j) * hwL, lj + 0.5 * rb.y);
      float db = (length((d - bc) / rb) - 1.0) * rb.x;
      float cb = u_hard ? step(db, 0.0) : clamp(0.5 - db, 0.0, 1.0);
      best = max(best, min(1.0, endS + 0.15) * cb);
    }
  }
  return best;
}

GenOut gen(vec2 p) {
  vec2 q = vec2(p.x, uRes.y - p.y);          // user space, y down (the direction drips run)
  vec2 cells = vec2(float(u_cols), float(u_rows));
  vec2 cs = uRes / cells;
  bool runnels = u_style == 1 && u_output == 0;
  int lookUp = int(ceil(u_len_max * (1.0 + u_relief_len) / cs.y)) + 1;
  lookUp = min(lookUp, runnels ? 40 : 24);
  // Columns either side: one for streaks; runnels reach as far as their stain can wander and spread.
  float reachX = u_wobble + 0.5 * u_width * (1.0 + max(-u_taper, 0.0)) + 3.0 * u_runnel_width + 2.0;
  int colReach = runnels ? clamp(int(ceil(reachX / cs.x)), 1, 6) : 1;
  int ncol = 2 * colReach + 1;
  int total = ncol * (lookUp + 2);
  ivec2 c0 = ivec2(floor(q / cs));
  float best = 0.0, bestCov = 0.0, bestRnd = 0.0;
  // One flat loop (rows upward × columns) with a uniform-derived count: nested constant loops make D3D's compiler
  // unroll.
  for (int k = 0; k < total; k++) {
    int jj = k / ncol;
    int i = k - jj * ncol - colReach;
    int j = jj - 1;                          // from the row below (blisters straddling a cell edge) upward
    if (j > lookUp) break;
    {
      ivec2 c = c0 + ivec2(i, -j);
      ivec2 cw = uTile ? imod(c, ivec2(cells)) : c;
      float rnd = hashI(cw, uSeed);
      vec2 src = (vec2(c) + hash2I(cw, uSeed + 9.0)) * cs;
      // Relief: the strongest ledge in the cell — the largest height drop from a pixel to the one "reach" px below,
      // sampled on a 4×4 grid — and, when relief-driven, the source sits exactly there. Deterministic, so every
      // real ledge (rivet bottoms, lips) gets its drips and shallow bumps stay below the threshold.
      float drop = 0.0;
      if (u_relief > 0.0 || u_relief_len > 0.0) {
        float bestDrop = -1.0;
        vec2 bestPos = src;
        for (int s = 0; s < 16; s++) {
          vec2 cand = (vec2(c) + (vec2(float(s - (s / 4) * 4), float(s / 4)) + 0.5) / 4.0) * cs;
          ivec2 pi = ivec2(floor(cand.x), floor(uRes.y - cand.y));
          float dd = fetchT(tSurface, pi).r - fetchT(tSurface, pi - ivec2(0, int(u_ledge_reach + 0.5))).r;
          if (dd > bestDrop) { bestDrop = dd; bestPos = cand; }
        }
        drop = max(bestDrop, 0.0);
        if (u_relief > 0.0) src = bestPos;
      }
      float ledgeOk = smoothstep(u_ledge * (1.0 - max(u_ledge_soft, 0.01)), u_ledge, drop);
      if (hashI(cw, uSeed + 5.0) >= u_density * mix(1.0, ledgeOk, u_relief)) continue;
      if (u_hard) src = floor(src) + 0.5;  // pixel centres, so 1 px trails and heads hit whole pixels
      float len = mix(u_len_min, u_len_max, hashI(cw, uSeed + 13.0)) * (1.0 + u_relief_len * drop);
      float w = u_width * (1.0 - u_width_var * hashI(cw, uSeed + 17.0));
      vec2 d = q - src;
      if (uTile) d.x -= uRes.x * floor(d.x / uRes.x + 0.5);
      float v = 0.0, cov = 0.0;
      if (u_output == 1) {
        // Source: a dome (blister) at the origin.
        float r = max(u_head, 0.75);
        float dl = length(d);
        float cs2 = u_hard ? (dl <= r ? 1.0 : 0.0) : clamp(r + 0.5 - dl, 0.0, 1.0);
        if (cs2 > 0.0) { v = sqrt(max(1.0 - (dl / (r + 0.5)) * (dl / (r + 0.5)), 0.0)); cov = cs2; }
        if (v * cov > best * bestCov) { best = v; bestCov = cov; bestRnd = rnd; }
        continue;
      }
      // Optional drop blob at the origin.
      if (u_head > 0.0) {
        float dh = length(d) - u_head;
        float ch = u_hard ? (dh <= 0.0 ? 1.0 : 0.0) : clamp(0.5 - dh, 0.0, 1.0);
        if (ch > 0.0) { v = 1.0; cov = ch; }
      }
      if (runnels) {
        float sr = dr_runnels(d, len, w, uSeed + 977.0 * rnd);
        if (sr > v * cov) { v = sr; cov = 1.0; }
        if (v * cov > best * bestCov) { best = v; bestCov = cov; bestRnd = rnd; }
        continue;
      }
      // Trail below the source.
      if (d.y >= 0.0 && d.y <= len) {
        float t = d.y / max(len, 1e-3);
        float cx = u_wobble * (sin(d.y * 0.7 + rnd * 40.0) * 0.6 + sin(d.y * 0.23 + rnd * 17.0) * 0.4);
        float hw = 0.5 * w * (1.0 - 0.5 * t);
        if (u_hard) { cx = floor(cx + 0.5); hw = max(hw, 0.5); }
        float dx = abs(d.x - cx) - hw;
        float ct = u_hard ? (dx <= 0.0 ? 1.0 : 0.0) : clamp(0.5 - dx, 0.0, 1.0);
        float vt = u_start * pow(1.0 - t, u_fade);
        if (ct > 0.0 && vt * ct > v * cov) { v = vt; cov = ct; }
      }
      if (v * cov > best * bestCov) { best = v; bestCov = cov; bestRnd = rnd; }
    }
  }
  // Stains: soft coverage = strength, so a Normal diffuse blend stains in proportion to it.
  // Sources: full coverage, the dome profile in the value (for height).
  return genOut(best, u_output == 1 ? bestCov : bestCov * best, bestRnd, 0.0);
}
`,
}
