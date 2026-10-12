// Drips (FR7.7): water / rust / blood stains that run down from scattered sources — a tapering trail that fades as
// it goes, wobbling slightly. The value is the stain strength and the coverage is soft, so with a Normal or Multiply
// diffuse blend a drip stains whatever the layers beneath painted, in proportion to its strength.
// Output "Sources" gives a small dome at each origin instead (same seed → same places): raise it in the relief stack
// for the blistered, flaking paint that rust bleeds from. Wraps on tileable projects.

import { P } from '@/core/params'
import type { LayerDef } from '../types'

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
    P.float('wobble', 'Wobble', 0.4, 0, 16, { softMax: 3, unit: 'px', step: 0.05, hint: 'Sideways meander along the trail' }),
    P.float('relief', 'Relief drive', 0, 0, 1, { step: 0.001, group: 'relief', hint: 'Reads the height built by the layers beneath: 0 = scattered sources, 1 = drips only start on ledges (the lower edges of raised features — rivets, lips, blisters)' }),
    P.float('ledge', 'Ledge threshold', 0.15, 0, 8, { softMax: 1, step: 0.001, group: 'relief', hint: 'Height drop (height units, over the ledge reach) that counts as a ledge — raise it until shallow bumps stop sprouting drips' }),
    P.float('ledge_reach', 'Ledge reach', 2, 1, 16, { softMax: 8, unit: 'px', step: 0.5, group: 'relief', hint: 'How far below a point the drop is measured: short = only hard, sharp steps count; long = soft, gradual edges count too' }),
    P.float('ledge_soft', 'Ledge softness', 0.15, 0, 1, { step: 0.001, group: 'relief', hint: 'Acceptance around the threshold: 0 = hard cut-off, 1 = a gradual ramp (weaker ledges drip less often)' }),
    P.float('relief_len', 'Height → length', 0, 0, 32, { softMax: 8, step: 0.01, group: 'relief', hint: 'Trails lengthen with the ledge they fall from: length × (1 + this × drop) — taller rivets, longer tails' }),
    P.bool('hard', 'Hard edges', true, { hint: 'No anti-aliasing (pixel art)' }),
    P.seed(),
  ],
  groups: [{ id: 'relief', label: 'Relief' }],
  defaults: { h_on: false, dif_on: true, dif_grad: { stops: [{ pos: 0, color: '#5a1e10' }, { pos: 1, color: '#7a2a14' }] } },
  glsl: /* glsl */ `
GenOut gen(vec2 p) {
  vec2 q = vec2(p.x, uRes.y - p.y);          // user space, y down (the direction drips run)
  vec2 cells = vec2(float(u_cols), float(u_rows));
  vec2 cs = uRes / cells;
  int lookUp = int(ceil(u_len_max * (1.0 + u_relief_len) / cs.y)) + 1;
  lookUp = min(lookUp, 24);
  ivec2 c0 = ivec2(floor(q / cs));
  float best = 0.0, bestCov = 0.0, bestRnd = 0.0;
  // One flat loop (rows upward × 3 columns): nested constant loops make D3D's compiler unroll.
  for (int k = 0; k < 78; k++) {
    int jj = k / 3;
    int i = k - jj * 3 - 1;
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
