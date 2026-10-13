// Drips (FR7.7): water / rust / blood stains that run down from scattered sources — a tapering trail that fades as
// it goes, wobbling slightly. The value is the stain strength and the coverage is soft, so with a Normal or Multiply
// diffuse blend a drip stains whatever the layers beneath painted, in proportion to its strength.
// Output "Sources" gives the blisters the rust bleeds from instead (same seed → same places): ragged holes in the paint at
// the origins, and along the ledges below raised features, that grow with the Blister radius from specks to patches
// that merge into whole areas. Their outline goes to the Shape Mask (clip the rust beneath inside it, the paint outside);
// their height is the peel — the paint lifts towards the torn edge, steepening as it curls, then falls into the hole,
// below the surface. Wraps on tileable projects.
//
// Two styles. Streak (pixel): the classic narrow trail, crisp at 1 px. Runnels (detailed), for higher resolutions and
// wide stains: water running down a wall — a faint wash whose centre line wanders on smooth noise (it may widen or
// narrow as it goes), a darker tide-mark deposit along its edges, dry patches breaking it up, and inside it a few thin
// runnels, each wandering on its own (so they cross, merge and split), each ending at its own length, thinning as it
// goes, some in a drop bead. Drips added in the editor start as runnels (LayerDef.fresh); everything else keeps the
// streak default.

import type { Texture } from 'three'
import { P } from '@/core/params'
import { DISTANCE_SOURCE, jumpFlood } from '@/gpu/jfa'
import type { LayerDef } from '../types'

const stains = (p: Record<string, unknown>) => p.output !== 'source'
const sources = (p: Record<string, unknown>) => p.output === 'source'
const isRunnels = (p: Record<string, unknown>) => stains(p) && p.style === 'runnels'

/** The ledge test, shared by the sources' relief drive, the blisters and the ledge flood (prepare). */
const LEDGE_GLSL = /* glsl */ `
// The height drop from a pixel to the one the ledge reach below it (GL pixel c).
float dr_drop(ivec2 c) { return fetchT(tSurface, c).r - fetchT(tSurface, c - ivec2(0, int(u_ledge_reach + 0.5))).r; }
// How much a drop counts as a ledge, 0..1.
float dr_ledgeOk(float drop) {
  return u_ledge > 0.0 ? smoothstep(u_ledge * (1.0 - max(u_ledge_soft, 0.01)), u_ledge, drop) : step(1e-4, drop);
}
`

/** The ledge flood's source (gpu/jfa.ts, custom): inside where the drop counts as a ledge. */
const LEDGE_FLOOD = LEDGE_GLSL + /* glsl */ `
float jfaCustom(ivec2 c) { return dr_ledgeOk(dr_drop(c)) - 0.5; }
`

export const dripsLayer: LayerDef = {
  type: 'drips',
  // Relief-driven drips read the heights below: a mask they write is written in place.
  readsState: true,
  label: 'Drips',
  category: 'pattern',
  kind: 'generator',
  description: 'Water, rust or blood stains running down from scattered sources, staining what is beneath; or the sources themselves: blisters of peeling paint (a shape mask, with a lifted, torn edge).',
  params: [
    P.enum('output', 'Output', 'stain', [['stain', 'Stains (trails)'], ['source', 'Sources (blisters)']], {
      hint: 'Sources: ragged blisters of peeling paint at the drip origins and along ledges — a Shape Mask for the rust beneath, with the paint lifting at the torn edge and a hole below the surface as height',
    }),
    P.enum('style', 'Style', 'streak', [
      ['streak', 'Streak (pixel)', 'a narrow trail, tapering and fading — crisp at 1 px'],
      ['runnels', 'Runnels (detailed)', 'a wandering wash of water with tide-marked edges and thin runnels inside that split, merge and end in beads — for higher resolutions and wide stains'],
    ], { showIf: stains }),
    P.int('cols', 'Columns', 12, 1, 256, { softMax: 48, hint: 'Source cells across the texture' }),
    P.int('rows', 'Rows', 6, 1, 256, { softMax: 32, hint: 'Source cells down the texture' }),
    P.float('density', 'Density', 0.5, 0, 1, { step: 0.001, hint: 'Chance that a cell holds a drip' }),
    P.float('blister', 'Blister radius', 2, 0, 256, {
      softMax: 32,
      unit: 'px',
      step: 0.05,
      showIf: sources,
      hint: 'Grows the blisters from specks (and the ledges from thin lines) to patches that merge into whole areas',
    }),
    P.float('blister_var', 'Size variation', 0.5, 0, 1, { step: 0.001, showIf: sources, hint: 'Each blister its own share of the radius (1 = anywhere from none to full)' }),
    P.float('ragged', 'Raggedness', 0.5, 0, 1, { step: 0.001, showIf: sources, hint: 'How torn the edge is: lobes as big as the blister, a fine tear along it, and paint lifting unevenly' }),
    P.float('lift', 'Lift', 0.8, 0, 8, { softMax: 2, step: 0.01, showIf: sources, hint: 'How high the paint curls up at the torn edge (× the Height amount)' }),
    P.float('lift_width', 'Lift width', 2, 0, 64, { softMax: 8, unit: 'px', step: 0.05, showIf: sources, hint: 'How far out from the edge the paint is lifted; it rises steeply only near the edge' }),
    P.float('depth', 'Depth', 1, 0, 8, { softMax: 2, step: 0.01, showIf: sources, hint: 'How far the hole falls below the surface (× the Height amount): the rust beneath, rough' }),
    P.float('len_min', 'Min length', 4, 0, 1024, { softMax: 64, unit: 'px', step: 0.5, showIf: stains }),
    P.float('len_max', 'Max length', 20, 0, 1024, { softMax: 128, unit: 'px', step: 0.5, showIf: stains }),
    P.float('width', 'Width', 1, 0.25, 64, { softMax: 6, unit: 'px', step: 0.05, showIf: stains, hint: 'Trail width at the head (it tapers to half)' }),
    P.float('width_var', 'Width variation', 0.5, 0, 1, { step: 0.001, showIf: stains }),
    P.float('head', 'Head', 0, 0, 32, { softMax: 4, unit: 'px', step: 0.05, showIf: stains, hint: 'A drop blob at the origin (0 = none — water and blood have none)' }),
    P.float('start', 'Trail strength', 0.8, 0, 1, { step: 0.001, showIf: stains, hint: 'Strength where the trail starts (it fades to 0)' }),
    P.float('fade', 'Fade', 1, 0.1, 8, { softMax: 4, step: 0.01, showIf: stains, hint: 'How quickly the trail fades: 1 linear, < 1 stays strong longer, > 1 fades early' }),
    P.float('wobble', 'Wobble', 0.4, 0, 64, { softMax: 8, unit: 'px', step: 0.05, showIf: stains, hint: 'Sideways meander along the trail (runnels: how far the whole stain wanders)' }),
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
    P.float('relief_len', 'Height → length', 0, 0, 32, { softMax: 8, step: 0.01, group: 'relief', showIf: stains, hint: 'Trails lengthen with the ledge they fall from: length × (1 + this × drop) — taller rivets, longer tails' }),
    P.float('ledge_mix', 'Ledges', 0.5, 0, 1, {
      step: 0.001,
      group: 'relief',
      showIf: sources,
      hint: 'Blisters along every ledge too (the lower edges of raised features, by the ledge settings above), growing with the radius: 0 = only at the sources, 1 = as fast as the spots',
    }),
    P.bool('hard', 'Hard edges', true, { hint: 'No anti-aliasing (pixel art)' }),
    P.seed(),
  ],
  groups: [{ id: 'relief', label: 'Relief' }],
  // Sources: the blisters' outline goes to the Shape Mask; Drips shapes the peel itself.
  sdf: 'mask',
  sdfShowIf: sources,
  textures: ['ledges'],
  // Blisters along the ledges: the distance to every ledge pixel, flooded from the heights beneath.
  prepare(ctx, layer): Record<string, Texture> {
    const p = layer.params
    const r = Number(p.blister)
    const mix = Number(p.ledge_mix)
    if (p.output !== 'source' || !(r > 0) || !(mix > 0)) return {}
    // Only as far as a blister along a ledge can reach: its growth, raggedness and lifted lip.
    const ragged = Number(p.ragged)
    const reach = r * mix + 0.5 * Number(p.ledge_reach) + 0.5 + ragged * (0.7 * r + 2.4) + Number(p.lift_width) + 2
    const field = jumpFlood(ctx, { source: DISTANCE_SOURCE.custom, custom: LEDGE_FLOOD, threshold: 0, maxDistance: reach, name: 'drips-ledges' })
    return { ledges: field.texture }
  },
  // Sources are relief first: the peel is their height.
  linkedDefaults: (p) => ({ h_on: p.output === 'source' }),
  // Before the blisters had their own radius, Sources used the head size (at least 0.75 px).
  migrate: (p) => (p.output === 'source' && p.blister === undefined && p.head !== undefined ? { ...p, blister: Math.max(Number(p.head), 0.75) } : p),
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
${LEDGE_GLSL}
// The drip source of cell c (unwrapped, so it lies near the caller): false when the cell holds none. cw: the cell
// wrapped (for its hashes), rnd: its random, drop: the ledge it sits on. Stains and blisters both use it, so the same
// seed puts them in the same places.
bool dr_source(ivec2 c, vec2 cells, vec2 cs, out ivec2 cw, out vec2 src, out float rnd, out float drop) {
  cw = uTile ? imod(c, ivec2(cells)) : c;
  rnd = hashI(cw, uSeed);
  src = (vec2(c) + hash2I(cw, uSeed + 9.0)) * cs;
  drop = 0.0;
  // Relief: the strongest ledge in the cell — the largest height drop from a pixel to the one "reach" px below,
  // sampled on a 4×4 grid — and, when relief-driven, the source sits exactly there. Deterministic, so every
  // real ledge (rivet bottoms, lips) gets its drips and shallow bumps stay below the threshold. (A uniform-derived
  // count: D3D keeps it a loop rather than unrolling it at both call sites.)
  int samples = u_relief > 0.0 || u_relief_len > 0.0 ? 16 : 0;
  float bestDrop = -1.0;
  vec2 bestPos = src;
  for (int s = 0; s < samples; s++) {
    vec2 cand = (vec2(c) + (vec2(float(s - (s / 4) * 4), float(s / 4)) + 0.5) / 4.0) * cs;
    float dd = dr_drop(ivec2(floor(cand.x), floor(uRes.y - cand.y)));
    if (dd > bestDrop) { bestDrop = dd; bestPos = cand; }
  }
  if (samples > 0) {
    drop = max(bestDrop, 0.0);
    if (u_relief > 0.0) src = bestPos;
  }
  if (hashI(cw, uSeed + 5.0) >= u_density * mix(1.0, dr_ledgeOk(drop), u_relief)) return false;
  if (u_hard) src = floor(src) + 0.5;  // pixel centres, so 1 px trails and heads hit whole pixels
  return true;
}

// Blisters' ragged-edge noises, all through one valueNoise call (D3D inlines every call site): 0 lobes, two per
// source cell (they stay put as the radius grows, and tile); 1–3 the tear's octaves from ~2.5 px down to single pixels;
// 4 the lift's unevenness along the edge.
const float DR_NSCALE[5] = float[5](2.0, 1.0, 2.0, 4.0, 1.0);
const float DR_NSEED[5] = float[5](301.0, 307.0, 311.0, 317.0, 313.0);

// Blisters (Sources), finished: d is the spots' smooth union (gen's cell loop). Adds the ledges (t_ledges: the distance
// to them, flooded before the layer runs) and the raggedness — lobes as big as the blister, a tear that small specks
// keep little of — then the peel: the paint lifts towards the torn edge, steepening as it curls, in flaps (some curled
// well up, some barely lifted), and falls into the hole, Depth below the surface, onto a rough floor.
GenOut dr_peel(vec2 p, vec2 q, vec2 cells, vec2 cs, float d, float rnd, float lobeAmp, float tearAmp, float ks) {
  float R = u_blister;
  vec2 tc = uTile ? max(vec2(1.0), floor(uRes / 2.5 + 0.5)) : uRes / 2.5;
  float nv[5] = float[5](0.5, 0.5, 0.5, 0.5, 0.5);
  int count = uRes.x > 0.0 ? 5 : 0;  // uniform-derived, so D3D keeps it a loop
  for (int i = 0; i < count; i++) {
    float sc = DR_NSCALE[i];
    vec2 x = (i == 0 ? q / cs : q / uRes * tc) * sc;
    ivec2 per = uTile ? (i == 0 ? ivec2(cells) : ivec2(tc)) * int(sc) : NO_PERIOD;
    nv[i] = valueNoise(x, per, uSeed + DR_NSEED[i]);
  }
  float tear = (0.5 * nv[1] + 0.3 * nv[2] + 0.2 * nv[3]) * 2.0 - 1.0;
  if (R > 0.0) {
    // Ledges: the band of ledge pixels (about the reach tall) opens from its middle as the radius grows.
    if (u_ledge_mix > 0.0) d = sdfCombine(5, d, fetchT(t_ledges, ivec2(floor(p))).r + 0.5 * u_ledge_reach + 0.5 - R * u_ledge_mix, ks);
    d += lobeAmp * (nv[0] * 2.0 - 1.0) + tearAmp * tear;
  }
  float x = clamp(1.0 - max(d, 0.0) / max(u_lift_width, 1e-3), 0.0, 1.0);
  float uneven = mix(1.0, 0.1 + 1.5 * smoothstep(0.25, 0.75, nv[4]), u_ragged);
  float lift = u_lift * x * x * x * uneven;
  float floorH = -u_depth * (0.85 + 0.15 * tear);
  float hole = u_hard ? (d <= 0.0 ? 1.0 : 0.0) : clamp(0.5 - d, 0.0, 1.0);
  // The value is the floor's roughness (0.6..1), for a ramp to shade the rust by; coverage, the hole.
  return genOutHeight(0.8 + 0.2 * tear, hole, rnd, d, mix(lift, floorH, hole));
}

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
  for (int j = 0; j < k; j++) {
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
  ivec2 c0 = ivec2(floor(q / cs));
  bool blisters = u_output == 1;
  bool runnels = !blisters && u_style == 1;
  // The cells to visit: columns either side, and rows from rowStart in steps of rowStep.
  int colReach, rows, rowStart, rowStep;
  float R = u_blister, lobeAmp = 0.0, tearAmp = 0.0;
  if (blisters) {
    // Every source whose blister (ragged, with its lifted lip) can reach this pixel. A big radius on a fine grid is
    // cut short at 5 cells each way (8 without the relief search): by then the blisters have merged into areas.
    lobeAmp = 0.7 * u_ragged * R;
    tearAmp = 2.4 * u_ragged * min(1.0, R / 2.5);
    float reach = R + lobeAmp + tearAmp + u_lift_width + 1.0;
    int most = u_relief > 0.0 ? 5 : 8;
    colReach = clamp(int(ceil(reach / cs.x)), 1, most);
    int ry = clamp(int(ceil(reach / cs.y)), 1, most);
    rows = R > 0.0 ? 2 * ry + 1 : 0;
    rowStart = -ry;
    rowStep = 1;
  } else {
    // Stains: from the row below (heads straddling a cell edge) upward as far as a trail can run; one column either
    // side for streaks, runnels as far as their stain can wander and spread.
    int lookUp = int(ceil(u_len_max * (1.0 + u_relief_len) / cs.y)) + 1;
    lookUp = min(lookUp, runnels ? 40 : 24);
    float reachX = u_wobble + 0.5 * u_width * (1.0 + max(-u_taper, 0.0)) + 3.0 * u_runnel_width + 2.0;
    colReach = runnels ? clamp(int(ceil(reachX / cs.x)), 1, 6) : 1;
    rows = lookUp + 2;
    rowStart = 1;
    rowStep = -1;
  }
  int ncol = 2 * colReach + 1;
  int total = ncol * rows;
  float best = 0.0, bestCov = 0.0, bestRnd = 0.0;
  float bd = 1e4, nearest = 1e4, ks = max(0.35 * R, 0.25);
  // One flat loop over the cells, for both outputs, with a uniform-derived count: nested constant loops make D3D's
  // compiler unroll, and one loop inlines dr_source once.
  for (int n = 0; n < total; n++) {
    int jj = n / ncol;
    {
      ivec2 c = c0 + ivec2(n - jj * ncol - colReach, rowStart + rowStep * jj);
      ivec2 cw;
      vec2 src;
      float rnd, drop;
      if (!dr_source(c, cells, cs, cw, src, rnd, drop)) continue;
      if (blisters) {
        float ds = length(q - src) - R * (1.0 - u_blister_var * hashI(cw, uSeed + 19.0));
        if (ds < nearest) { nearest = ds; bestRnd = rnd; }
        bd = sdfCombine(5, bd, ds, ks);
        continue;
      }
      float len = mix(u_len_min, u_len_max, hashI(cw, uSeed + 13.0)) * (1.0 + u_relief_len * drop);
      float w = u_width * (1.0 - u_width_var * hashI(cw, uSeed + 17.0));
      vec2 d = q - src;
      if (uTile) d.x -= uRes.x * floor(d.x / uRes.x + 0.5);
      float v = 0.0, cov = 0.0;
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
  if (blisters) return dr_peel(p, q, cells, cs, bd, bestRnd, lobeAmp, tearAmp, ks);
  // Soft coverage = strength, so a Normal diffuse blend stains in proportion to it. No shape (only the blisters have one).
  return genOut(best, bestCov * best, bestRnd, NO_SDF);
}
`,
}
