// Chips & splits: damage taken out of the current Shape Mask — angular chips knocked off its edges (more at corners),
// splits that run along the grain from the edges that cross it, tapering as they go, the odd split in the open and short
// nicks across the grain. Works on whatever wrote the shape mask (planks, bricks, panels, setts); with nothing there the
// whole texture is one piece, which only gets the splits in the open and the nicks.
//
// Every feature is a cut c (px, > 0 inside it) and a depth f (0..1). Two outputs:
//   - Carve (default): value = how much of the surface is left (1 untouched … 0 cut away to the shape's edge level),
//     covering only the damage, so Height › Multiply carves it out of the relief below and Diffuse › Multiply darkens
//     it. Chip walls follow this layer's Bevel / Profile.
//   - Chipped shape: the shape mask minus the cuts as an SDF; a part-depth cut sinks (1 − f) × bevel below the surface
//     instead of reaching the edge, so the wrapper's bevel gives it a floor.
// Both write the chipped shape to the Shape Mask when it's used (genOutOwn for Carve), for later clips.

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'

const chipsOn = (p: Record<string, unknown>) => Number(p.chips) > 0 || Number(p.corners) > 0
const splitsOn = (p: Record<string, unknown>) => Number(p.splits) > 0 || Number(p.interior) > 0
const nicksOn = (p: Record<string, unknown>) => Number(p.nicks) > 0

export const chipsLayer: LayerDef = {
  type: 'chips',
  label: 'Chips & splits',
  category: 'shape',
  kind: 'generator',
  sdf: true,
  readsState: true,
  description: 'Damage to the shape mask: chips knocked off its edges and corners, splits along the grain from the edges that cross it, nicks across it.',
  params: [
    P.enum('output', 'Output', 'carve', [
      ['carve', 'Carve what is below', 'how much of the surface is left, 1 untouched … 0 cut away, over the damage only: Height › Multiply carves it out of the relief beneath, Diffuse › Multiply darkens it'],
      ['shape', 'Chipped shape (SDF)', 'the shape mask with the damage taken out, drawn with this layer’s bevel: build the relief from it'],
    ], { hint: 'Both outputs put the chipped shape in the Shape Mask (when Use shape mask is on), so later layers can clip to it' }),
    P.float('chips', 'Chips', 0.35, 0, 1, { step: 0.001, section: 'Chips', hint: 'Chance of a chip at each spot along the edges of the shape mask' }),
    P.float('corners', 'Corners', 0.5, 0, 1, { step: 0.001, section: 'Chips', hint: 'Extra chance of a chip where an edge turns a corner' }),
    P.float('chip_size', 'Size', 5, 0.5, 256, { softMax: 24, unit: 'px', step: 0.05, section: 'Chips', showIf: chipsOn, hint: 'Chip radius; spots are about 2.5 sizes apart' }),
    P.float('chip_var', 'Size variation', 0.6, 0, 1, { step: 0.001, section: 'Chips', showIf: chipsOn }),
    P.float('chip_depth', 'Depth', 0.8, 0, 1, { step: 0.001, section: 'Chips', showIf: chipsOn, hint: '1: chips go down to the level of the shape’s edge; less leaves a shallow flake with a floor' }),
    P.enum('grain', 'Grain', 'vertical', [['vertical', 'Vertical'], ['horizontal', 'Horizontal']], { group: 'splits', hint: 'Which way splits run (and nicks cross)' }),
    P.float('splits', 'From edges', 0.5, 0, 1, { step: 0.001, group: 'splits', hint: 'Chance of a split at each lane where an edge crosses the grain (board ends): it opens at the edge and runs in, tapering' }),
    P.float('interior', 'In the open', 0.1, 0, 1, { step: 0.001, group: 'splits', hint: 'Chance of a split away from the edges, tapered at both ends' }),
    P.float('split_len', 'Length', 48, 2, 2048, { softMax: 192, unit: 'px', step: 0.1, group: 'splits', showIf: splitsOn, hint: 'Longest split (each takes 45–100 % of it)' }),
    P.float('split_width', 'Width', 1.5, 0.1, 32, { softMax: 6, unit: 'px', step: 0.05, group: 'splits', showIf: splitsOn, hint: 'Width where a split opens (on average); it narrows to nothing along the split' }),
    P.float('split_width_var', 'Width jitter', 0.3, 0, 1, { step: 0.001, group: 'splits', showIf: (p) => splitsOn(p) || nicksOn(p), hint: 'How much each split\'s (and nick\'s) width varies around the Width: 0 all the same, 0.3 from 0.7× to 1.3×, 1 anywhere from a hairline to twice as wide' }),
    P.float('split_len_var', 'Length jitter', 0.55, 0, 1, { step: 0.001, group: 'splits', showIf: (p) => splitsOn(p) || nicksOn(p), hint: 'How much shorter than the Length (or Nick length) each one may be: 0 all full length, 1 anywhere from nothing to full' }),
    P.float('split_bevel', 'Bevel', 1, 0, 64, { softMax: 8, unit: 'px', step: 0.05, group: 'splits', showIf: (p) => splitsOn(p) || nicksOn(p), hint: 'Width of the rounded shoulder either side of a split or nick (shaped by Shaping › Profile): 0 a hard-edged crack, more a soft groove' }),
    P.float('split_space', 'Spacing', 10, 1, 512, { softMax: 48, unit: 'px', step: 0.1, group: 'splits', showIf: splitsOn, hint: 'Distance between neighbouring split lanes across the grain' }),
    P.float('split_wobble', 'Wobble', 0.75, 0, 32, { softMax: 4, unit: 'px', step: 0.05, group: 'splits', showIf: (p) => splitsOn(p) || nicksOn(p), hint: 'How far splits bend across the grain: they run straight between a few knots and deflect gently at each (nicks zigzag by it too)' }),
    P.float('merge', 'Merging', 0.3, 0, 1, { step: 0.001, group: 'splits', showIf: splitsOn, hint: 'Chance a split from an edge veers into the split beside it and ends there, the two joining into one' }),
    P.float('nicks', 'Nicks', 0, 0, 1, { step: 0.001, group: 'splits', hint: 'Chance of a short crack across the grain at each spot (spots are 1.5 nick lengths apart)' }),
    P.float('nick_len', 'Nick length', 14, 1, 512, { softMax: 64, unit: 'px', step: 0.1, group: 'splits', showIf: nicksOn }),
    P.float('nick_width', 'Nick width', 1.5, 0.1, 32, { softMax: 6, unit: 'px', step: 0.05, group: 'splits', showIf: nicksOn }),
    P.seed(),
  ],
  groups: [{ id: 'splits', label: 'Splits' }],
  defaults: {
    bevel: 1.5,
    profile: 'linear',
    h_on: true,
    h_mode: 'multiply',
    h_amount: 1,
    dif_on: true,
    dif_blend: 'multiply',
    dif_grad: gradient('#3a3029', '#ffffff'),
  },
  // Carve multiplies what is beneath; a chipped shape is drawn like any other shape.
  linkedDefaults: (p) =>
    p.output === 'shape'
      ? { h_mode: 'add', h_amount: 0.4, dif_on: false, dif_blend: 'normal' }
      : { h_mode: 'multiply', h_amount: 1, dif_on: true, dif_blend: 'multiply' },
  glsl: /* glsl */ `
// 1, read from a uniform: loops bounded by it are not unrolled by D3D (see ORG_1 in organicShared).
#define CH_1 (uRes.x > 0.0 ? 1 : 0)

// The Shape Mask's distance at a pixel; with nothing written yet the whole texture is inside.
float ch_reg(vec2 s) {
  float d = fetchT(tSurface, ivec2(floor(s))).a;
  return d > 5e3 ? -1e4 : d;
}

// Distance and outward normal (central differences; zero where the field is flat, e.g. no shape at all).
vec3 ch_regN(vec2 s) {
  ivec2 c = ivec2(floor(s));
  float d = fetchT(tSurface, c).a;
  vec2 g = vec2(fetchT(tSurface, c + ivec2(1, 0)).a - fetchT(tSurface, c - ivec2(1, 0)).a,
                fetchT(tSurface, c + ivec2(0, 1)).a - fetchT(tSurface, c - ivec2(0, 1)).a);
  if (d > 5e3) return vec3(-1e4, 0.0, 0.0);
  return vec3(d, dot(g, g) > 1e-6 ? normalize(g) : vec2(0.0));
}

// A crack's removal across it (Carve), ax px from its side (< 0 inside): the crack itself with thin-line coverage (a
// pixel box filter, ≤ the width w when under a pixel, so hairlines fade instead of flickering) and the Bevel's
// shoulder either side, b px wide (the Bevel, narrowing with the crack so its tip stays sharp), shaped by the layer's
// Profile (Flat counts as Linear).
float ch_crack(float ax, float w, float b) {
  float core = clamp(0.5 - ax, 0.0, min(w, 1.0));
  float sh = b > 0.0 ? 1.0 - profileCurve(u_profile == 0 ? 1 : u_profile, max(ax, 0.0) / b) : 0.0;
  return max(core, sh);
}

// Smooth 1D noise in -1..1.
float ch_noise1(float x, float seed) {
  float i = floor(x), f = x - i;
  return 2.0 * mix(hash1(i, seed), hash1(i + 1.0, seed), f * f * (3.0 - 2.0 * f)) - 1.0;
}

// Cells of about size px per axis over extent px, whole when tiling (x: cell size, y: cell count).
vec2 ch_cells(float extent, float size) {
  float n = max(floor(extent / max(size, 1.0) + 0.5), 1.0);
  return uTile ? vec2(extent / n, n) : vec2(max(size, 1.0), 1e6);
}

// A split in grain-frame px (x along the grain, y across): it opens at start and runs dir · len (open: tapered at both
// ends, centred on its spot); y is its lane position before any bend.
struct ChSplit { bool ok; bool open; float start; float dir; float len; float y; float w; float rnd; };

// The split a lane cell holds, if any. A spot whose nearest edge crosses the grain starts one where that edge crosses
// the lane, running inward; a spot inside, away from such edges, may hold one in the open.
ChSplit ch_split(ivec2 c, vec2 cs, ivec2 per, bool vert) {
  ChSplit S = ChSplit(false, false, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
  ivec2 cw = imod(c, per);
  vec4 h = vec4(hash3I(cw, uSeed + 201.0), hashI(cw, uSeed + 203.0));
  if (h.z >= max(u_splits, u_interior)) return S;
  vec2 s = (vec2(c) + vec2(h.x, 0.15 + 0.7 * h.y)) * cs;
  vec3 dn = ch_regN(vert ? s.yx : s);
  float ng = vert ? dn.z : dn.y;
  S.len = cs.x * (1.0 - u_split_len_var * h.w);
  if (abs(dn.x) < cs.x && abs(ng) > 0.75) {
    if (h.z >= u_splits) return S;
    S.start = s.x - dn.x / ng;
    S.dir = -sign(ng);
  } else {
    if (dn.x > -2.0 || h.z >= u_interior) return S;
    S.start = s.x - 0.5 * S.len;
    S.open = true;
  }
  S.ok = true;
  S.y = s.y;
  S.w = u_split_width * (1.0 + u_split_width_var * (2.0 * fract(h.w * 13.7) - 1.0));
  S.rnd = h.y;
  return S;
}

// A split's bend across the grain at u px along it: straight runs between knots kn.x px apart (kn.y per texture), each
// knot offset by up to the Wobble — wood splits run straight with gentle deflections.
float ch_defl(ivec2 cw, float u, vec2 kn) {
  float i = floor(u / kn.x);
  int i0 = int(i), i1 = i0 + 1;
  if (uTile) { i0 = imod(i0, int(kn.y)); i1 = imod(i1, int(kn.y)); }
  int key = cw.x * 4099 + cw.y;
  return u_split_wobble * (2.0 * mix(hashI(ivec2(i0, key), uSeed + 221.0), hashI(ivec2(i1, key), uSeed + 221.0), u / kn.x - i) - 1.0);
}

GenOut gen(vec2 p) {
  float reg0 = ch_reg(gl_FragCoord.xy);
  float K = max(u_bevel, 1.0);
  float bs = K / max(u_split_bevel, 0.25);   // Chipped shape: splits' shoulders span their own Bevel
  float cut = -1e9;    // the furthest-reaching cut, depth applied (Chipped shape)
  float keep = 1.0;    // how much of the surface is left (Carve)
  float rnd = 0.5;
  bool vert = u_grain == 0;
  // Grain frame: x along the grain, y across (px).
  vec2 q = vert ? p.yx : p;
  vec2 ext = vert ? uRes.yx : uRes;

  // ---- Chips: one spot per cell near the edge, moved onto it along the field's normal, a flake cut around it.
  if (u_chips > 0.0 || u_corners > 0.0) {
    vec2 cx = ch_cells(uRes.x, 2.5 * u_chip_size), cy = ch_cells(uRes.y, 2.5 * u_chip_size);
    vec2 cs = vec2(cx.x, cy.x);
    ivec2 per = ivec2(cx.y, cy.y);
    ivec2 ip = ivec2(floor(p / cs));
    for (int e = 0; e < 9 * CH_1; e++) {
      ivec2 c = ip + ivec2(e % 3 - 1, e / 3 - 1);
      ivec2 cw = imod(c, per);
      vec4 h = vec4(hash3I(cw, uSeed + 101.0), hashI(cw, uSeed + 103.0));
      if (h.z >= u_chips + u_corners) continue;
      vec2 s = (vec2(c) + h.xy) * cs;
      float R = u_chip_size * (1.0 - u_chip_var * h.w);
      vec3 dn = ch_regN(s);
      if (abs(dn.x) > R || dn.yz == vec2(0.0)) continue;
      // Corner: how far the distance bends beside the spot — 0 along a straight edge, ~0.4 at a right angle.
      float corner = 0.0;
      if (u_corners > 0.0) {
        vec2 tg = vec2(-dn.z, dn.y) * max(abs(dn.x), 0.4 * R);
        corner = smoothstep(0.08, 0.3, (0.5 * (ch_reg(s + tg) + ch_reg(s - tg)) - dn.x) / length(tg));
      }
      if (h.z >= u_chips + u_corners * corner) continue;
      vec3 g = hash3I(cw, uSeed + 107.0);
      // Centre on the edge (a little in or out), then an angular flake: five half-planes at uneven angles, in a frame
      // stretched along the edge (flakes come off wider than they are deep).
      float off = R * (g.x - 0.35) * 0.7;
      vec2 d = p - (s - dn.x * dn.yz + dn.yz * off);
      if (dot(d, d) > 4.0 * R * R) continue;
      d = vec2(dot(d, vec2(-dn.z, dn.y)) / (1.0 + 0.6 * fract(g.x * 5.3)), dot(d, dn.yz));
      float a0 = g.y * 6.2832;
      // Only this side of the edge: a chip doesn't reach across a gap into the neighbouring piece.
      float dc = d.y + off - 0.5;
      for (int k = 0; k < 5; k++) {
        float jit = fract(g.z * float(17 * k + 5));
        float a = a0 + float(k) * 1.2566 + (jit - 0.5) * 0.7;
        dc = max(dc, dot(d, vec2(cos(a), sin(a))) - R * (0.6 + 0.4 * fract(jit * 7.31)));
      }
      float f = u_chip_depth * (0.6 + 0.4 * fract(g.z * 31.7));
      cut = max(cut, -dc - (1.0 - f) * K);
      // The wall: anti-aliased, then this layer's bevel profile from the rim inward.
      float wall = coverage(dc, u_aa) * ((u_bevel > 0.0 && u_profile != 0) ? profileCurve(u_profile, max(-dc, 0.0) / u_bevel) : 1.0);
      float kc = 1.0 - f * wall;
      if (kc < keep) { keep = kc; rnd = g.x; }
    }
  }

  // ---- Splits: lanes across the grain, one spot per lane cell (ch_split). Each runs straight between knots along the
  // grain with a gentle bend at each; some veer into the split in the next lane and end there, the two merging into one.
  if (u_splits > 0.0 || u_interior > 0.0) {
    vec2 cl = ch_cells(ext.x, u_split_len), cw2 = ch_cells(ext.y, u_split_space);
    vec2 cs = vec2(cl.x, cw2.x);
    ivec2 per = ivec2(cl.y, cw2.y);
    vec2 kn = ch_cells(ext.x, max(0.4 * u_split_len, 8.0));
    ivec2 ip = ivec2(floor(q / cs));
    for (int e = 0; e < 15 * CH_1; e++) {
      ivec2 c = ip + ivec2(e / 3 - 2, e % 3 - 1);
      ChSplit A = ch_split(c, cs, per, vert);
      if (!A.ok) continue;
      float t = (q.x - A.start) * A.dir;
      if (t < -3.0 || t > A.len) continue;
      float y = A.y + ch_defl(imod(c, per), q.x, kn);
      // Merging: the split ends on its neighbour's line if that split is there where this one ends and runs close by.
      bool merged = false;
      float hm = hashI(imod(c, per), uSeed + 231.0);
      if (!A.open && hm < u_merge) {
        ivec2 cb = c + ivec2(0, hm < 0.5 * u_merge ? -1 : 1);
        ChSplit B = ch_split(cb, cs, per, vert);
        float um = A.start + A.dir * A.len;
        float tb = (um - B.start) * B.dir;
        float gap = B.y + ch_defl(imod(cb, per), um, kn) - A.y - ch_defl(imod(c, per), um, kn);
        if (B.ok && tb > 2.0 && tb < B.len - 2.0 && abs(gap) < 0.8 * cs.y) {
          merged = true;
          y = mix(y, B.y + ch_defl(imod(cb, per), q.x, kn), smoothstep(0.3, 1.0, t / A.len));
        }
      }
      float x = q.y - y;
      // A thin line that narrows late (a merging one only halfway: it joins the other at width), flared where it opens.
      float tau = A.open ? 1.0 - abs(2.0 * t / A.len - 1.0) : 1.0 - (merged ? 0.5 : 1.0) * max(t, 0.0) / A.len;
      float w = A.w * pow(tau, 0.3) * (A.open ? 1.0 : 1.0 + 0.6 * exp(-max(t, 0.0) / max(A.w, 1.0)));
      float ends = min(t + 3.0, A.len - t + (merged ? 2.0 : 0.0));
      float f = pow(tau, 0.35);
      // Chipped shape: the distance from the crack's side scaled so the layer's bevel spans the split Bevel.
      float ax = abs(x) - 0.5 * w;
      cut = max(cut, min(-ax * bs, ends) - (1.0 - f) * K);
      float ks = 1.0 - f * ch_crack(ax, w, u_split_bevel * sqrt(tau)) * clamp(ends + 0.5, 0.0, 1.0);
      if (ks < keep) { keep = ks; rnd = A.rnd; }
    }
  }

  // ---- Nicks: short cracks across the grain, inside the shape.
  if (u_nicks > 0.0) {
    vec2 cx = ch_cells(uRes.x, 1.5 * u_nick_len), cy = ch_cells(uRes.y, 1.5 * u_nick_len);
    vec2 cs = vec2(cx.x, cy.x);
    ivec2 per = ivec2(cx.y, cy.y);
    ivec2 ip = ivec2(floor(p / cs));
    for (int e = 0; e < 9 * CH_1; e++) {
      ivec2 c = ip + ivec2(e % 3 - 1, e / 3 - 1);
      ivec2 cw = imod(c, per);
      vec4 h = vec4(hash3I(cw, uSeed + 301.0), hashI(cw, uSeed + 303.0));
      if (h.z >= u_nicks) continue;
      vec2 s = (vec2(c) + h.xy) * cs;
      if (ch_reg(s) > -2.0) continue;
      vec2 sq = vert ? s.yx : s;
      float L = u_nick_len * (1.0 - u_split_len_var * h.w);
      float t = q.y - sq.y + 0.5 * L;
      if (t < 0.0 || t > L) continue;
      float tau = 1.0 - abs(2.0 * t / L - 1.0);
      float x = q.x - sq.x - (0.3 * u_nick_width + 0.6 * u_split_wobble) * ch_noise1(t / 6.0 + h.w * 37.0, uSeed + 311.0);
      float w = u_nick_width * (1.0 + u_split_width_var * (2.0 * fract(h.w * 9.1) - 1.0)) * pow(tau, 0.3);
      float f = pow(tau, 0.3);
      float ax = abs(x) - 0.5 * w;
      cut = max(cut, min(-ax * bs, min(t, L - t)) - (1.0 - f) * K);
      float kn = 1.0 - f * ch_crack(ax, w, u_split_bevel * sqrt(tau)) * clamp(min(t, L - t) + 0.5, 0.0, 1.0);
      if (kn < keep) { keep = kn; rnd = h.x; }
    }
  }

  float d = max(reg0, cut);
  if (u_output == 1) return genOutSmooth(0.0, 1.0, 0.5, d);
  // Only the shape is carved: beyond its edge there is nothing to take away.
  keep = 1.0 - (1.0 - keep) * coverage(reg0, true);
  return genOutOwn(keep, clamp((1.0 - keep) * 64.0, 0.0, 1.0), rnd, d);
}
`,
}
