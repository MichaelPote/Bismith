// Organic cracks (FR7.2a): dried mud / cracked rock / lava crust — plates split by a warped, jagged crack
// network with a finer, partial second generation of cracks that taper out inside the plates. Like wood and
// scales it has a combined output (plate value × bevel, cracks = 0) and an SDF output for the register.

import { P } from '@/core/params'
import type { LayerDef } from '../types'
import { ORG_GLSL, ORG_GLSL_SDF, ORG_NO_SDF } from './organicShared'

export const cracksLayer: LayerDef = {
  type: 'cracks',
  label: 'Cracks',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Dried mud, cracked rock or lava crust: jagged crack network with partial finer cracks; plates as a shape.',
  params: [
    P.enum('output', 'Output', 'plates', [
      ['plates', 'Plates (bevel × coverage)'],
      ['shape', 'Plate shapes (SDF)'],
    ], { hint: 'Plates: value 1 on the plates with the Shape bevel at their edges, 0 in the cracks. Shape: plate SDF for the shape register' }),
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
vec2 org_softWarp(vec2 p, vec2 wc, float seed) {
  vec2 u = p / uRes * wc;
  return vec2(org_noiseFbm(1, false, u, org_per(wc), 2, 0.4, seed + 101.0),
              org_noiseFbm(1, false, u + 17.3, org_per(wc), 2, 0.4, seed + 211.0)) - 0.5;
}

// Fine cracks: Voronoi borders where each border segment (cell pair) is present with probability
// \`keep\` — partial cracks end cleanly at junctions instead of dotting out. Returns (distance px, cell rnd).
vec2 org_fineCracks(vec2 p, vec2 cells, float jitter, float keep, float seed) {
  ivec2 per = org_per(cells);
  vec2 cs = uRes / cells;
  ivec2 ip = ivec2(floor(p / cs));
  float best = 1e20;
  vec2 bs = p;
  ivec2 bc = ip;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec2 c = ip + ivec2(i, j);
    vec2 s = (vec2(c) + 0.5 + (hash2I(imod(c, per), seed) - 0.5) * jitter) * cs;
    float d = org_dot2(s - p);
    if (d < best) { best = d; bs = s; bc = c; }
  }
  ivec2 bw = imod(bc, per);
  float m = 1e9;
  for (int j = -2; j <= 2; j++)
  for (int i = -2; i <= 2; i++) {
    if (i == 0 && j == 0) continue;
    ivec2 c = bc + ivec2(i, j);
    ivec2 cw = imod(c, per);
    vec2 s = (vec2(c) + 0.5 + (hash2I(cw, seed) - 0.5) * jitter) * cs;
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
  vec2 q = p;
  if (u_warp > 0.0) q += org_softWarp(p, cellsFor(u_scale * 1.5, 1.0), uSeed + 7.0) * 2.0 * u_warp * L;
  // Pixel-scale jaggies: a ~2 px value noise nudges the crack distance.
  float jn = 0.0;
  if (u_jag > 0.0) {
    vec2 jc = cellsFor(uRes.x / 2.0, 1.0);
    jn = (org_noiseFbm(0, false, p / uRes * jc, org_per(jc), 2, 0.5, uSeed + 29.0) - 0.5) * 2.0 * u_jag;
  }
  vec4 c1 = org_cellDist(q, cells, u_jitter, u_size_var, 0.0, uSeed);
  // Distance (px) from the pixel to the edge of the crack bands: > 0 on a plate.
  float d = c1.y + jn - 0.5 * u_width;
  float rnd = c1.z;
  if (u_sub > 0.0) {
    vec2 c2s = cellsFor(u_scale * u_sub_scale, 1.0);
    vec2 q2 = q + org_softWarp(p, cellsFor(u_scale * u_sub_scale * 1.5, 1.0), uSeed + 37.0) * 0.6 * u_warp * L / u_sub_scale;
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
