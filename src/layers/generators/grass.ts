// Grass: blades of grass seen from above — tapered strokes that bend and curl, strewn in depth over one another.
//
// Each blade grows from a root along a curve whose heading turns by Bend over its length plus Curl towards the tip,
// drawn as a polyline of short segments, its width tapering from the root. Roots are scattered on a grid of cells one
// blade long (tufts gather some of a cell's roots on one spot), so a pixel only searches the 3 × 3 cells about it,
// and a bounding circle about each blade's middle skips most of them before the polyline is walked.
//
// Every blade has a depth; along it the blade rises by Rise towards its tip, so tips lie over the roots of the blades
// around them. The topmost blades at a pixel are kept (two, and the highest one covering it fully, for anti-aliased
// edges) and composited. Value is a shade: high blades light, deep ones dark, the half of a folded blade facing Light
// from lighter, and a contact shadow where a higher blade passes close by — the darkest end of the ramp is the shadowed
// ground between blades. Height (hval) is the blade's own height with a slight dome across it; rnd is per blade.

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { ORG_GLSL } from './organicShared'

export const grassLayer: LayerDef = {
  type: 'grass',
  label: 'Grass',
  category: 'pattern',
  kind: 'generator',
  description: 'Blades of grass from above: tapered, bending, curling strokes laid in depth over one another, shaded light at the tips and dark down among the roots. Tufts, bare patches, tileable.',
  params: [
    P.float('length', 'Blade length', 24, 1, 512, { softMax: 128, unit: 'px', step: 0.1, hint: 'Length of the longest blades, along the curve' }),
    P.float('length_var', 'Length variation', 0.5, 0, 1, { step: 0.001, hint: 'How much shorter blades may be: 0 all full length, 1 anywhere from nothing to full' }),
    P.float('width', 'Blade width', 2, 0.2, 64, { softMax: 10, unit: 'px', step: 0.05, hint: 'Width at the root' }),
    P.float('width_var', 'Width variation', 0.3, 0, 1, { step: 0.001 }),
    P.float('taper', 'Taper', 0.9, 0, 1, { step: 0.001, hint: 'How much a blade narrows to its tip: 1 a sharp point, 0 an even ribbon' }),
    P.float('density', 'Density', 3, 0.05, 16, { softMax: 8, step: 0.01, hint: 'How many blades lie over each spot, on average (the count follows the blade size)' }),
    P.float('angle', 'Direction', 0, 0, 360, { unit: '°', step: 0.1, section: 'Growth', hint: 'Which way the blades point from their roots, clockwise from up' }),
    P.float('spread', 'Spread', 180, 0, 180, { unit: '°', step: 0.1, section: 'Growth', hint: 'How far blades may turn either side of the Direction: 180 any way at all' }),
    P.float('bend', 'Bend', 50, 0, 360, { softMax: 180, unit: '°', step: 0.1, section: 'Growth', hint: 'How far a blade’s heading turns from root to tip, evenly — arcs; each blade bends left or right, by 40–100 % of it' }),
    P.float('curl', 'Curl', 20, 0, 720, { softMax: 360, unit: '°', step: 0.1, section: 'Growth', hint: 'Further turn gathered towards the tip: hooks, then curls and loops (moss, fleece)' }),
    P.float('wiggle', 'Wiggle', 0, 0, 180, { softMax: 90, unit: '°', step: 0.1, section: 'Growth', hint: 'Heading wavers either way by up to this much, one to three waves along each blade: kinked, squiggly strands instead of clean arcs' }),
    P.float('clump', 'Tufts', 0.15, 0, 1, { step: 0.001, section: 'Growth', hint: 'Share of the blades that grow from a tuft (one per blade-length cell), fanning out from one spot' }),
    P.float('arch', 'Arch', 0, 0, 1, { step: 0.001, section: 'Shading', hint: 'Blades rise to their middle and droop again to the tip (arching grass) instead of climbing all the way: 1 the tip back down at its root’s depth' }),
    P.float('lift', 'Rise', 1, 0, 4, { softMax: 2, step: 0.001, section: 'Shading', hint: 'How far a blade climbs towards its tip, against the depth blades lie in: high, the tips lie over the roots around them and the roots sink into shade' }),
    P.float('depth', 'Depth shading', 0.7, 0, 1, { step: 0.001, section: 'Shading', hint: 'Deep blades (and roots) darker than high ones and tips: 0 every blade at the bright end of the ramp' }),
    P.float('shadow', 'Contact shadow', 0.6, 0, 1, { step: 0.001, section: 'Shading', hint: 'Shade cast on a blade beside a higher one passing over it, keeping overlapping blades apart' }),
    P.float('shadow_w', 'Shadow width', 2, 0.1, 64, { softMax: 8, unit: 'px', step: 0.05, section: 'Shading', showIf: (p) => Number(p.shadow) > 0 }),
    P.float('fold', 'Fold', 0.4, 0, 1, { step: 0.001, section: 'Shading', hint: 'Blades are creased along the middle: the half facing the light lighter, the other darker' }),
    P.float('light', 'Light from', 315, 0, 360, { unit: '°', step: 0.1, section: 'Shading', showIf: (p) => Number(p.fold) > 0, hint: 'Where the light falls from for the Fold, clockwise from up (315 = top left)' }),
    P.bool('kinds', 'Two kinds', false, { section: 'Shading', hint: 'Two kinds of blade (green and dry, say) on one ramp: its middle is the shade both share, the first kind lightens towards the start of the ramp, the second towards the end' }),
    P.float('kind_share', 'Second kind', 0.4, 0, 1, { step: 0.001, section: 'Shading', showIf: (p) => Boolean(p.kinds), hint: 'Share of the blades of the second kind' }),
    P.enum('gaps', 'Gaps', 'fill', [
      ['fill', 'Shadowed ground', 'gaps between blades take the dark end of the ramp'],
      ['clear', 'Clear', 'only the blades are drawn: what is below shows between them (a second layer of grass, soil)'],
    ], { section: 'Ground' }),
    P.float('bare', 'Bare patches', 0, 0, 1, { step: 0.001, section: 'Ground', hint: 'Patches where the grass thins out and stops, showing what is below (worn lawn, soil)' }),
    P.float('bare_scale', 'Patches across', 5, 0.5, 64, { softMax: 16, step: 0.01, section: 'Ground', showIf: (p) => Number(p.bare) > 0, hint: 'Size of the bare patches: about this many across the texture' }),
    P.float('patches', 'Colour patches', 0, 0, 1, { step: 0.001, section: 'Ground', hint: 'Broad patches where the blades shift along the ramp (drier, lusher)' }),
    P.float('patch_scale', 'Colour patches across', 3, 0.5, 64, { softMax: 16, step: 0.01, section: 'Ground', showIf: (p) => Number(p.patches) > 0 }),
    P.seed(),
  ],
  defaults: {
    dif_on: true,
    dif_grad: gradient('#1a260c', '#3b5f18', '#6f9a2c', '#b8d060'),
    dif_jitter: 0.12,
    h_on: true,
    h_amount: 0.6,
  },
  fresh: ({ width, height }) => {
    const s = Math.sqrt(width * height)
    const length = Math.max(4, Math.round(s / 12))
    return { length, width: Math.max(1, Math.round(length / 6) / 2) }
  },
  glsl:
    ORG_GLSL +
    /* glsl */ `
float gr_u8(uint h, uint sh) { return float((h >> sh) & 0xffu) / 256.0; }
float gr_u16(uint h, uint sh) { return float((h >> sh) & 0xffffu) / 65536.0; }

GenOut gen(vec2 p) {
  float L = max(u_length, 0.5);
  float W = max(u_width, 0.05);
  float sw = max(u_shadow_w, 0.05);
  // Cells at least as big as a blade's reach, so its root is never more than one cell away.
  float reach = L + 0.5 * W + sw + 1.0;
  vec2 ncell = uTile ? max(floor(uRes / reach), 1.0) : vec2(1e6);
  vec2 cs = uTile ? uRes / ncell : vec2(reach);
  ivec2 per = ivec2(ncell);
  float area = L * (1.0 - 0.5 * u_length_var) * W * (1.0 - 0.5 * u_width_var) * (1.0 - 0.4 * u_taper);
  float Kf = min(u_density * cs.x * cs.y / max(area, 0.05), 256.0);
  int K = max(int(ceil(Kf)), 1);
  float lastKeep = Kf - float(K - 1);

  float a0base = radians(u_angle), spread = radians(u_spread);
  float bendR = radians(u_bend), curlR = radians(u_curl);
  vec2 Ld = vec2(sin(radians(u_light)), cos(radians(u_light)));
  bool bare = u_bare > 0.0;
  float bLo = 0.25 + 0.45 * u_bare;

  // Topmost blade, the one under it, and the highest blade covering the pixel fully: height, shade, coverage, rnd, hval.
  float h1 = -1.0, v1 = 0.0, c1 = 0.0, r1 = 0.0, hv1 = 0.0, k1 = 0.0;
  float h2 = -1.0, v2 = 0.0, c2 = 0.0, r2 = 0.0, hv2 = 0.0, k2 = 0.0;
  float hF = -1.0, vF = 0.0, rF = 0.0, hvF = 0.0, kF = 0.0;
  // Highest nearby blade, falling away over the shadow width beside it (contact shadow).
  float M = -1.0;

  ivec2 c0 = ivec2(floor(p / cs));
  for (int ci = 0; ci < 9 * ORG_1; ci++) {
    ivec2 cell = c0 + ivec2(ci % 3 - 1, ci / 3 - 1);
    vec2 lo = vec2(cell) * cs;
    vec2 q = max(max(lo - p, p - lo - cs), 0.0);
    if (dot(q, q) < reach * reach) {
      ivec2 key = uTile ? imod(cell, per) : cell;
      uint hc = pcg3(uvec3(uint(key.x), uint(key.y), uint(uSeed)));
      vec2 tuft = lo + cs * (0.2 + 0.6 * vec2(gr_u16(hc, 0u), gr_u16(hc, 16u)));
      for (int k = 0; k < K; k++) {
        uint g1 = pcg(hc ^ (uint(k) * 0x9e3779b9u));
        uint g2 = pcg(g1);
        uint g3 = pcg(g2);
        bool keep = k < K - 1 || gr_u16(g3, 0u) < lastKeep;
        vec2 rr = vec2(gr_u16(g1, 0u), gr_u16(g1, 16u));
        vec2 root = gr_u8(g3, 16u) < u_clump ? clamp(tuft + (rr - 0.5) * 0.4 * L, lo, lo + cs) : lo + rr * cs;
        float len = L * (1.0 - u_length_var * gr_u8(g2, 16u));
        float rb = gr_u8(g2, 24u);
        float bm = (rb < 0.5 ? -1.0 : 1.0) * (0.4 + 1.2 * abs(rb - 0.5));
        float a0 = a0base + spread * (2.0 * gr_u16(g2, 0u) - 1.0);
        float kb = bendR * bm, kc = curlR * bm;
        // Every point of a curve lies within half its length of its middle; the middle is estimated from the heading a
        // quarter of the way along, with room for the error that turning makes.
        float aq = a0 + 0.25 * kb + 0.0625 * kc;
        vec2 mid = root + 0.5 * len * vec2(sin(aq), cos(aq));
        float wg = radians(u_wiggle);
        float rad = len * (0.5 + 0.25 * min(abs(0.5 * kb + 0.25 * kc) + 2.0 * wg, 2.0)) + 0.5 * W + sw + 1.0;
        vec2 dm = p - mid;
        if (keep && dot(dm, dm) < rad * rad) {
          uint g4 = pcg(g3);
          bool grows = true;
          if (bare) {
            float n = org_fbm(root / uRes, vec2(u_bare_scale), 3, uSeed + 71.0);
            grows = gr_u8(g4, 16u) < smoothstep(bLo, bLo + 0.25, n);
          }
          if (grows) {
            float wi = W * (1.0 - u_width_var * gr_u8(g3, 24u));
            uint g5 = pcg(g4);
            float wf = 1.0 + 2.0 * gr_u16(g5, 0u), wph = gr_u16(g5, 16u);
            int N = clamp(int(ceil((abs(kb) + abs(kc) + 6.0 * wg * wf) / 0.3)), 1, 32);
            float fn = float(N), seg = len / fn;
            vec2 a = root;
            float best = 1e9, bd = 0.0, bhw = 0.0, bt = 0.0, bsp = 0.0;
            vec2 bT = vec2(0.0, 1.0);
            for (int i = 0; i < N; i++) {
              float tm = (float(i) + 0.5) / fn;
              float ang = a0 + kb * tm + kc * tm * tm + wg * sin(6.2831853 * (wf * tm + wph));
              vec2 T = vec2(sin(ang), cos(ang));
              vec2 pa = p - a;
              float u = clamp(dot(pa, T) / seg, 0.0, 1.0);
              vec2 off = pa - seg * u * T;
              float d = length(off);
              float t = (float(i) + u) / fn;
              float hw = 0.5 * wi * (1.0 - u_taper * t * sqrt(t));
              if (d - hw < best) { best = d - hw; bd = d; bhw = hw; bt = t; bsp = dot(off, vec2(-T.y, T.x)); bT = T; }
              a += seg * T;
            }
            float rise = mix(bt, sin(3.14159265 * bt), u_arch);
            float hgt = (gr_u16(g4, 0u) + u_lift * rise) / (1.0 + u_lift);
            M = max(M, hgt - smoothstep(0.0, sw, max(best, 0.0)));
            // Box-filtered coverage of the blade across the pixel (blades thinner than a pixel cover part of it).
            float cov = clamp(min(bd + bhw, 0.5) - max(bd - bhw, -0.5), 0.0, 1.0);
            bool full = cov > 0.99;
            if (cov > 0.0 && (hgt > h2 || (full && hgt > hF))) {
              float v = mix(1.0, hgt, u_depth);
              float lit = dot(vec2(-bT.y, bT.x), Ld) * clamp(bsp / 0.6, -1.0, 1.0);
              v = lit > 0.0 ? mix(v, 1.0, 0.35 * u_fold * lit) : v * (1.0 + 0.5 * u_fold * lit);
              float kd = gr_u8(g4, 24u) < u_kind_share ? 1.0 : 0.0;
              float uu = bsp / max(bhw, 1e-3);
              float hv = hgt + min(0.08 * bhw, 0.25) * sqrt(max(1.0 - uu * uu, 0.0));
              float rnd = gr_u16(g3, 0u) * 0.37 + gr_u16(g1, 0u) * 0.63;
              if (hgt > h1) {
                h2 = h1; v2 = v1; c2 = c1; r2 = r1; hv2 = hv1; k2 = k1;
                h1 = hgt; v1 = v; c1 = cov; r1 = rnd; hv1 = hv; k1 = kd;
              } else if (hgt > h2) {
                h2 = hgt; v2 = v; c2 = cov; r2 = rnd; hv2 = hv; k2 = kd;
              }
              if (full && hgt > hF) { hF = hgt; vF = v; rF = rnd; hvF = hv; kF = kd; }
            }
          }
        }
      }
    }
  }

  // Contact shadow and colour patches shade each blade; with two kinds, each kind then takes its half of the ramp.
  float sk = 3.0;
  float shift = u_patches > 0.0 ? u_patches * (org_fbm(p / uRes, vec2(u_patch_scale), 4, uSeed + 113.0) - 0.5) * 1.6 : 0.0;
  // Two kinds share the dark middle of the ramp: anti-aliased edges between them pass through shade, not a third colour.
  v1 = clamp(v1 * (1.0 - u_shadow * clamp((M - h1) * sk, 0.0, 1.0)) + shift, 0.0, 1.0);
  v2 = clamp(v2 * (1.0 - u_shadow * clamp((M - h2) * sk, 0.0, 1.0)) + shift, 0.0, 1.0);
  vF = clamp(vF * (1.0 - u_shadow * clamp((M - hF) * sk, 0.0, 1.0)) + shift, 0.0, 1.0);
  if (u_kinds) {
    v1 = 0.5 + (k1 > 0.5 ? 0.5 : -0.5) * v1;
    v2 = 0.5 + (k2 > 0.5 ? 0.5 : -0.5) * v2;
    vF = 0.5 + (kF > 0.5 ? 0.5 : -0.5) * vF;
  }
  float gap = u_kinds ? 0.5 : 0.0;
  bool anyF = hF >= 0.0;
  // Composite from the bottom: the ground (or the fully covering blade), the second blade, the top one.
  float v = mix(mix(anyF ? vF : gap, v2, c2), v1, c1);
  float hv = mix(mix(anyF ? hvF : 0.0, hv2, c2), hv1, c1);
  float blades = 1.0 - (1.0 - c1) * (1.0 - c2) * (anyF ? 0.0 : 1.0);
  float rnd = c1 >= 0.5 ? r1 : c2 >= 0.5 ? r2 : anyF ? rF : r1;

  float mask = blades;
  if (u_gaps == 0) {
    float ground = 1.0;
    if (bare) ground = smoothstep(bLo - 0.02, bLo + 0.1, org_fbm(p / uRes, vec2(u_bare_scale), 3, uSeed + 71.0));
    mask = max(blades, ground);
  } else {
    // Clear gaps: the blades' own shade, not darkened towards the ground at their anti-aliased edges.
    v = blades > 0.0 ? clamp((v - gap * (1.0 - blades)) / blades, 0.0, 1.0) : gap;
    hv = blades > 0.0 ? hv / blades : 0.0;
  }
  return GenOut(clamp(v, 0.0, 1.0), mask, rnd, 0.0, 1.0, NO_SDF, 0, clamp(hv, 0.0, 1.0), NO_SDF);
}
`,
}
