// Organic cracks (FR7.2a): dried mud / cracked rock / lava crust — plates split by a warped, jagged crack
// network with a finer, partial second generation of cracks that taper out inside the plates. Like wood and
// scales it has a combined output (plate value × bevel, cracks = 0) and an SDF output for the register.

import { P } from '@/core/params'
import type { LayerDef } from '../types'
import { ORG_GLSL, ORG_GLSL_SDF, ORG_NO_SDF } from './organicShared'

export const cracksLayer: LayerDef = {
  type: 'cracks',
  noise: true,
  label: 'Cracks',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Dried mud, cracked rock or lava crust: jagged crack network with partial finer cracks; plates as a shape.',
  params: [
    P.enum('output', 'Output', 'plates', [
      ['plates', 'Plates (bevel × coverage)'],
      ['shape', 'Plate shapes (SDF)'],
    ], { hint: 'Plates: value 1 on the plates with the Shape bevel at their edges, 0 in the cracks. Shape: the outline of the plates for the shape mask' }),
    P.float('scale', 'Scale', 4, 0.5, 64, { softMax: 16, step: 0.01, hint: 'Main plates across the texture width (rounded when tiling)' }),
    P.float('jitter', 'Jitter', 0.9, 0, 1, { step: 0.001 }),
    P.float('size_var', 'Size variation', 0.3, 0, 1, { step: 0.001, hint: 'Main plates only' }),
    P.float('width', 'Crack width', 1.25, 0, 32, { softMax: 6, unit: 'px', step: 0.05 }),
    P.float('warp', 'Warp', 0.1, 0, 2, { softMax: 1, step: 0.001, hint: 'Bends the cracks (in plate sizes)' }),
    P.float('jag', 'Jaggedness', 0.25, 0, 8, { softMax: 3, unit: 'px', step: 0.01, hint: 'Pixel-scale roughness of the crack edges' }),
    P.float('sub', 'Fine cracks', 0.4, 0, 1, { step: 0.001, hint: 'Fraction of the finer crack segments present (each segment between two fine plates is kept or dropped)' }),
    P.float('sub_scale', 'Fine scale', 2.5, 1.5, 6, { step: 0.01, showIf: (p) => Number(p.sub) > 0, hint: 'Fine plates per main plate (across)' }),
    P.float('sub_width', 'Fine width', 1, 0, 16, { softMax: 4, unit: 'px', step: 0.05, showIf: (p) => Number(p.sub) > 0 }),
    P.seed(),
  ],
  defaults: {
    bevel: 0,
    profile: 'flat',
    h_on: true,
    h_amount: 0.3,
    dif_on: true,
    // Crack colour only at the very bottom, so an added bevel shades plate edges rather than widening cracks.
    dif_grad: { stops: [{ pos: 0, color: '#1e150d' }, { pos: 0.3, color: '#4a3624' }, { pos: 0.7, color: '#6b5038' }, { pos: 1, color: '#7a5e43' }] },
    dif_jitter: 0.15,
  },
  glsl:
    ORG_GLSL +
    ORG_GLSL_SDF +
    /* glsl */ `
// Fine cracks: Voronoi borders where each border segment (cell pair) is present with probability
// \`keep\` — partial cracks end cleanly at junctions instead of dotting out. Returns (distance px, cell rnd).
vec2 org_fineCracks(vec2 p, vec2 cells, float jitter, float keep, float seed) {
  ivec2 per = org_per(cells);
  vec2 cs = uRes / cells;
  ivec2 ip = ivec2(floor(p / cs));
  float best = 1e20;
  vec2 bs = p;
  ivec2 bc = ip, bw = ip;
  float m = 1e9;
  // One flat loop (see ORG_1): the 3×3 cells for the nearest site, then the 5×5 around it for the borders.
  for (int e = 0; e < 34 * ORG_1; e++) {
    bool near = e < 9;
    ivec2 g = near ? ivec2(e % 3 - 1, e / 3 - 1) : ivec2((e - 9) % 5 - 2, (e - 9) / 5 - 2);
    if (!near && g == ivec2(0)) continue;
    ivec2 c = (near ? ip : bc) + g;
    ivec2 cw = imod(c, per);
    vec2 s = (vec2(c) + 0.5 + (cellPoint(cw, seed) - 0.5) * jitter) * cs;
    if (near) {
      float d = org_dot2(s - p);
      if (d < best) { best = d; bs = s; bc = c; bw = cw; }
      continue;
    }
    // Order-independent pair hash so both sides agree on the segment.
    ivec2 lo = (bw.x < cw.x || (bw.x == cw.x && bw.y < cw.y)) ? bw : cw;
    ivec2 hi = (lo == bw) ? cw : bw;
    if (hashI(lo * 7919 + hi, seed + 53.0) >= keep) continue;
    vec2 ab = s - bs;
    float L = length(ab);
    if (L < 1e-4) continue;
    m = min(m, max((org_dot2(p - s) - org_dot2(p - bs)) / (2.0 * L), 0.0));
  }
  return vec2(m, hashI(bw, seed + 17.0));
}

GenOut gen(vec2 p) {
  vec2 cells = cellsFor(u_scale, 1.0);
  vec2 cs = uRes / cells;
  float L = sqrt(cs.x * cs.y);
  // The noise, in one flat loop (one copy of its code; see ORG_1): the warp of the main cracks (x, y), of the fine
  // cracks (x, y), then the pixel-scale jaggies (a ~2 px value noise that nudges the crack distance).
  vec2 jc = cellsFor(uRes.x / 2.0, 1.0);
  vec4 w = vec4(0.0);
  float jn = 0.0;
  for (int e = 0; e < 5 * ORG_1; e++) {
    bool jag = e == 4;
    int gen = e / 2, c = e % 2;
    if (jag ? u_jag <= 0.0 : u_warp <= 0.0 || (gen == 1 && u_sub <= 0.0)) continue;
    vec2 nc = jag ? jc : cellsFor(u_scale * (gen == 0 ? 1.0 : u_sub_scale) * 1.5, 1.0);
    vec2 x = p / uRes * nc;
    float seed = jag ? uSeed + 29.0 : uSeed + (gen == 0 ? 7.0 : 37.0) + (c == 0 ? 101.0 : 211.0);
    float n = org_noiseFbm(jag ? 0 : 1, false, c == 1 ? x + 17.3 : x, org_per(nc), 2, jag ? 0.5 : 0.4, seed);
    if (jag) jn = (n - 0.5) * 2.0 * u_jag;
    else if (e == 0) w.x = n;
    else if (e == 1) w.y = n;
    else if (e == 2) w.z = n;
    else w.w = n;
  }
  vec2 q = p;
  if (u_warp > 0.0) q += (w.xy - 0.5) * 2.0 * u_warp * L;
  vec4 c1 = org_cellDist(q, cells, u_jitter, u_size_var, 0.0, uSeed);
  // Distance (px) from the pixel to the edge of the crack bands: > 0 on a plate.
  float d = c1.y + jn - 0.5 * u_width;
  float rnd = c1.z;
  if (u_sub > 0.0) {
    vec2 c2s = cellsFor(u_scale * u_sub_scale, 1.0);
    vec2 q2 = q + (w.zw - 0.5) * 0.6 * u_warp * L / u_sub_scale;
    vec2 c2 = org_fineCracks(q2, c2s, u_jitter, u_sub, uSeed + 3.0);
    d = min(d, c2.x + jn - 0.5 * u_sub_width);
    rnd = fract(rnd + c2.y * 0.37);
  }
  float sdf = -d;
  if (u_output == 1) return genOut(0.0, 1.0, rnd, sdf);
  float v = org_edgeProfile(sdf) * coverage(sdf, u_aa);
  return genOut(v, 1.0, rnd, ${ORG_NO_SDF});
}
`,
}
