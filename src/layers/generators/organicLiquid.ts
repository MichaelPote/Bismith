// Organic value generators (FR7.2a): veined marble and liquid caustics. Both output a plain value (veins /
// bright rims = 1) for the colour ramp; neither writes the shape register.

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { ORG_GLSL, ORG_NO_SDF } from './organicShared'

// ------------------------------------------------------------------------------------------------ marble

const notStreaks = (p: Record<string, unknown>) => p.style !== 'streaks'

export const marbleLayer: LayerDef = {
  type: 'marble',
  noise: true,
  label: 'Marble',
  category: 'pattern',
  kind: 'generator',
  description: 'Veined marble: turbulent streaks, meandering vein networks or cellular veins, with fine secondary veins. Veins = 1.',
  params: [
    P.enum('style', 'Style', 'streaks', [
      ['streaks', 'Streaks (turbulent bands)'],
      ['network', 'Network (meandering)'],
      ['cells', 'Cells (vein mesh)'],
    ], { hint: 'Streaks: classic sin(x + turbulence) veins along a direction. Network: contour lines of warped noise. Cells: veins along warped cell borders' }),
    P.float('veins', 'Veins', 3, 0.25, 64, { softMax: 16, step: 0.01, hint: 'Streaks: vein bands per texture width. Network / cells: noise cells across (rounded when tiling)' }),
    P.float('angle', 'Angle', 30, -360, 360, { softMin: -90, softMax: 90, unit: '°', step: 0.1, showIf: (p) => p.style === 'streaks', hint: 'Vein direction, clockwise from horizontal (snapped to a seamless angle when tiling)' }),
    P.float('stretch', 'Stretch', 1, 0.1, 10, { softMin: 0.25, softMax: 4, step: 0.01, showIf: notStreaks, hint: '>1 elongates the network horizontally' }),
    P.float('levels', 'Contours', 1, 0.5, 8, { softMax: 4, step: 0.01, showIf: (p) => p.style === 'network', hint: 'Vein contour lines per unit of noise — more = denser, nested veins' }),
    P.float('warp', 'Warp', 0.5, 0, 8, { softMax: 4, step: 0.001, hint: 'Turbulence strength (in vein periods / cells)' }),
    P.float('warp_scale', 'Warp scale', 3, 0.25, 64, { softMax: 16, step: 0.01, hint: 'Turbulence cells across the texture (rounded when tiling)' }),
    P.int('detail', 'Detail', 5, 1, 8, { hint: 'Turbulence octaves (kinks and wiggles in the veins)' }),
    P.float('width', 'Vein width', 1, 0, 32, { softMax: 6, unit: 'px', step: 0.05 }),
    P.float('soft', 'Softness', 1, 0, 32, { softMax: 8, unit: 'px', step: 0.05, hint: 'Falloff beyond the vein core (0 = crisp)' }),
    P.float('width_var', 'Width variation', 0.5, 0, 1, { step: 0.001, hint: 'Veins swell and thin along their length' }),
    P.float('breakup', 'Breakup', 0.3, 0, 1, { step: 0.001, hint: 'Fades veins in and out along their length' }),
    P.float('fine', 'Fine veins', 0.45, 0, 1, { step: 0.001, hint: 'Strength of a second, finer vein system' }),
    P.float('fine_scale', 'Fine scale', 3, 1, 8, { softMax: 6, step: 0.01, showIf: (p) => Number(p.fine) > 0, hint: 'Fine veins per main vein' }),
    P.int('tiles', 'Tiles', 0, 0, 64, { softMax: 8, hint: 'Cut into tiles across (0 = off): each tile gets its own piece of marble; the per-feature random is per tile' }),
    P.float('tile_rot', 'Tile vein turn', 45, 0, 180, { unit: '°', step: 0.1, showIf: (p) => Number(p.tiles) > 0 && p.style === 'streaks', hint: 'Random vein rotation per tile (±)' }),
    P.float('cloud', 'Cloudiness', 0.35, 0, 1, { step: 0.001, hint: 'Mottled background between the veins (raises the value up to this much)' }),
    P.seed(),
  ],
  defaults: {
    dif_on: true,
    dif_grad: gradient('#d9d4ca', '#bfb8ac', '#8d867c', '#4b4641'),
    r_on: true,
    r_a: 0.25,
    r_b: 0.45,
  },
  glsl:
    ORG_GLSL +
    /* glsl */ `
// worleyNoise(x, per, 1.0, 0, seed).wz — distance to the cell border (cells) and the cell's random — in one flat loop:
// the 3×3 cells for the nearest point, then the 5×5 for the border (the library's nested loops compile slower).
vec2 org_worleyBorder(vec2 x, ivec2 per, float seed) {
  ivec2 ip = ivec2(floor(x));
  vec2 fp = fract(x);
  float F1 = 1e9, md = 1e9;
  vec2 mr = vec2(0.0);
  ivec2 mc = ip;
  for (int e = 0; e < 34 * ORG_1; e++) {
    bool near = e < 9;
    ivec2 g = near ? ivec2(e % 3 - 1, e / 3 - 1) : ivec2((e - 9) % 5 - 2, (e - 9) / 5 - 2);
    vec2 r = vec2(g) + (0.5 + (cellPoint(imod(ip + g, per), seed) - 0.5)) - fp;
    if (near) {
      float d = dot(r, r);
      if (d < F1) { F1 = d; mr = r; mc = ip + g; }
    } else {
      vec2 dr = r - mr;
      if (dot(dr, dr) > 1e-6) md = min(md, dot(0.5 * (mr + r), normalize(dr)));
    }
  }
  return vec2(md, hashI(imod(mc, per), seed + 17.0));
}

// Distance (px) from p to the nearest vein of one vein system, and a per-vein random. Streaks and network: veins
// lie on the integer level sets of a field F — streaks: bands along the wave vector k bent by billow turbulence;
// network: contours of noise under a domain warp (Detail octaves; the contoured noise itself has few, or its
// contours scribble). Cells: borders of warped Worley cells.
//
// All the noise runs in one flat loop of evaluations — for p and one px right / up (for the gradient of F): the two
// warp components (not for streaks), then F (not for cells, which only need the warped p). D3D (Chrome's default on
// Windows) inlines every call, and nested loops of noise calls compiled several times slower than this one site.
vec2 org_veinDist(vec2 p, float count, float wm, float ang, float seed) {
  vec2 wc = cellsFor(u_warp_scale, 1.0);
  int g = 1;
  vec2 k = org_waveK(count, ang, g);
  vec2 nc = cellsFor(count, u_stretch);
  bool streaks = u_style == 0, cells = u_style == 2;
  vec3 f = vec3(0.0);
  vec2 w = vec2(0.0), x = vec2(0.0);
  for (int e = 0; e < 9 * ORG_1; e++) {
    int i = e / 3, c = e - 3 * i;   // sample i (p, right, up); c = warp x, warp y, field
    if (streaks && c < 2) continue;
    vec2 o = i == 0 ? vec2(0.0) : i == 1 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec2 u = (p + o) / uRes;
    vec2 uw = u * wc;
    if (c == 2) {
      x = streaks ? uw : u * nc + (w - 0.5) * u_warp * 2.0;
      if (cells) break;
    }
    bool warp = c < 2;
    float n = org_noiseFbm(1, streaks, c == 2 ? x : c == 0 ? uw : uw + 17.3, org_per(warp || streaks ? wc : nc),
                           warp || streaks ? u_detail : min(u_detail, 3), warp || streaks ? 0.5 : 0.45,
                           c == 0 ? seed + 7.0 + 101.0 : c == 1 ? seed + 7.0 + 211.0 : seed);
    if (c == 0) w.x = n;
    else if (c == 1) w.y = n;
    else {
      float F = streaks ? dot(p + o, k) + u_warp * wm * 2.0 * n : (n - 0.5) * 2.0 * u_levels;
      if (i == 0) f.x = F; else if (i == 1) f.y = F; else f.z = F;
    }
  }
  if (cells) {
    vec2 wb = org_worleyBorder(x, org_per(nc), seed);
    vec2 cs = uRes / nc;
    return vec2(wb.x * sqrt(cs.x * cs.y), wb.y);
  }
  float f0 = f.x;
  float grad = max(length(f.yz - f0), 1e-4);
  float d = abs(fract(f0 + 0.5) - 0.5) / grad;
  int band = int(floor(f0 + 0.5));
  if (streaks && uTile) band = imod(band, g);
  return vec2(d, hashI(ivec2(band, 3), seed));
}

GenOut gen(vec2 p) {
  vec2 u = p / uRes;
  // Tiles: each tile shows its own cut of the marble (shifted pattern, rotated veins).
  vec2 q = p;
  float ang = u_angle;
  float tileRnd = -1.0;
  if (u_tiles > 0) {
    vec2 tn = vec2(float(u_tiles), max(1.0, floor(float(u_tiles) * uRes.y / uRes.x + 0.5)));
    ivec2 ti = imod(ivec2(floor(p / (uRes / tn))), ivec2(tn));
    vec3 th = hash3I(ti, uSeed + 5.0);
    q = p + floor(th.xy * uRes);
    ang += (th.z - 0.5) * 2.0 * u_tile_rot;
    tileRnd = hashI(ti, uSeed + 9.0);
  }
  u = q / uRes;
  vec2 bc = cellsFor(max(u_warp_scale, 1.0) * 2.0, 1.0);
  vec2 cc = cellsFor(max(u_warp_scale, 1.0) * 1.5, 1.0);
  float vein = 0.0;
  float rnd = 0.0;
  float base = 0.0;
  // System 0: main veins; 1: finer, fainter veins; 2: the mottled background between them. One loop, so one copy
  // of each noise (see org_veinDist).
  for (int sys = 0; sys < 3 * ORG_1; sys++) {
    bool cloud = sys == 2;
    if ((sys == 1 && u_fine <= 0.0) || (cloud && u_cloud <= 0.0)) continue;
    // The veins' width / breakup noise, or the background.
    float nb = org_fbm(u, cloud ? cc : bc * float(sys + 1), cloud ? 5 : 3, cloud ? uSeed + 77.0 : uSeed + 91.0 + 2.0 * float(sys));
    if (cloud) {
      base = u_cloud * clamp((nb - 0.2) / 0.6, 0.0, 1.0);
      break;
    }
    float fs = sys == 0 ? 1.0 : u_fine_scale;
    vec2 vd = org_veinDist(q, u_veins * fs, fs, ang, uSeed + 50.0 * float(sys));
    float wv = mix(1.0, clamp(0.25 + 1.5 * nb, 0.25, 2.0), u_width_var);
    float w = sys == 0 ? u_width * wv : max(u_width * 0.6, min(u_width, 1.0));
    float l = org_line(vd.x, w, u_soft * (sys == 0 ? wv : 0.5));
    if (u_breakup > 0.0) l *= org_breakup(nb, u_breakup);
    if (sys == 0) rnd = vd.y;
    vein = max(vein, sys == 0 ? l : l * u_fine);
  }
  float v = base + (1.0 - base) * vein;
  return genOut(clamp(v, 0.0, 1.0), 1.0, tileRnd >= 0.0 ? tileRnd : rnd, ${ORG_NO_SDF});
}
`,
}

// ------------------------------------------------------------------------------------------------ caustics

export const causticsLayer: LayerDef = {
  type: 'caustics',
  noise: true,
  label: 'Caustics / liquid',
  category: 'pattern',
  kind: 'generator',
  description: 'Liquid surfaces — lava, slime, water: bright rims on warped, rounded cells (net) or bright blobs split by dark cracks.',
  params: [
    P.enum('mode', 'Mode', 'net', [
      ['net', 'Caustic net (bright rims)'],
      ['blobs', 'Blobs (bright cells, dark cracks)'],
    ], { hint: 'Value is brightness in both modes. Net: subtract it from height so the blobs bulge; Blobs: add it' }),
    P.float('scale', 'Scale', 5, 0.5, 64, { softMax: 16, step: 0.01, hint: 'Cells across the texture width (rounded when tiling)' }),
    P.float('jitter', 'Jitter', 0.85, 0, 1, { step: 0.001 }),
    P.float('size_var', 'Size variation', 0.3, 0, 1, { step: 0.001, hint: 'Weighted cells: some blobs grow, others shrink' }),
    P.float('round', 'Roundness', 0.8, 0, 1, { step: 0.001, hint: '0 = polygonal cells; 1 = round blobs (the glow follows F1 / F2 circles; the net thickens slightly at junctions)' }),
    P.float('warp', 'Warp', 0.3, 0, 2, { softMax: 1, step: 0.001, hint: 'Domain warp, in cells — wobbly, organic rims' }),
    P.float('warp_scale', 'Warp scale', 1, 0.25, 4, { step: 0.01, hint: 'Warp noise frequency relative to the cells' }),
    P.float('rim', 'Rim width', 1, 0, 32, { softMax: 8, unit: 'px', step: 0.05, hint: 'Width of the bright core (net) or dark crack (blobs)' }),
    P.float('rim_soft', 'Rim softness', 0.5, 0, 16, { softMax: 4, unit: 'px', step: 0.05 }),
    P.float('glow', 'Glow reach', 1, 0, 1.5, { step: 0.001, hint: 'How far the rim light reaches into the cell (fraction of the cell radius)' }),
    P.float('glow_amount', 'Glow level', 0.65, 0, 1, { step: 0.001, hint: 'Brightness of the glow next to the rim (net) / of the blob edge (blobs)' }),
    P.float('falloff', 'Falloff', 0.7, 0.1, 8, { softMax: 4, step: 0.01, hint: 'Glow curve: < 1 keeps the glow level wide then drops into dark cores; > 1 fades quickly from the rim (net). Blobs: higher = flatter tops' }),
    P.float('octave2', 'Second octave', 0.2, 0, 1, { step: 0.001, hint: 'Fainter net of smaller cells layered on top' }),
    P.seed(),
  ],
  defaults: {
    dif_on: true,
    dif_grad: gradient('#1c0400', '#4f0b00', '#9c2400', '#e05a00', '#ffa21a', '#ffe08a'),
    h_on: true,
    h_mode: 'subtract',
    h_amount: 0.35,
    e_on: true,
    e_color: '#ff6a10',
    e_intensity: 0.6,
  },
  glsl:
    ORG_GLSL +
    /* glsl */ `
// Brightness from the cell distances: a crisp rim core on the border plus a glow (net) / dome (blobs)
// whose shape blends from polygonal (border distance) to round blobs (F1 / F2) with Roundness.
float org_liquid(vec4 c, float R, float rim, float glowAmt) {
  float d = c.x;
  float core = 1.0 - smoothstep(-0.5, 0.5 + u_rim_soft, d - 0.5 * rim);
  float reach = max(u_glow, 1e-3);
  float tPoly = clamp(d / (reach * R), 0.0, 1.0);
  float tRound = clamp((1.0 - c.w) / (reach * 0.6), 0.0, 1.0);
  float t = mix(tPoly, tRound, u_round);
  if (u_mode == 0) return max(core, pow(1.0 - t, u_falloff) * glowAmt);
  float dome = 1.0 - pow(1.0 - t, u_falloff);
  return (1.0 - core) * mix(glowAmt, 1.0, dome);
}

vec4 org_liquidCells(vec2 p, float scale, float seed, out float R) {
  vec2 cells = cellsFor(scale, 1.0);
  vec2 cs = uRes / cells;
  R = 0.5 * min(cs.x, cs.y);
  vec2 q = p;
  if (u_warp > 0.0) {
    vec2 wc = cellsFor(scale * u_warp_scale, 1.0);
    // Two soft octaves: smooth, blobby distortion rather than jagged borders.
    vec2 w = vec2(org_noiseFbm(1, false, p / uRes * wc, org_per(wc), 2, 0.35, seed + 101.0),
                  org_noiseFbm(1, false, p / uRes * wc + 17.3, org_per(wc), 2, 0.35, seed + 211.0)) - 0.5;
    q += w * 2.0 * u_warp * cs;
  }
  return org_cellDist(q, cells, u_jitter, u_size_var, u_round * R * 0.15, seed);
}

GenOut gen(vec2 p) {
  float R;
  vec4 c = org_liquidCells(p, u_scale, uSeed, R);
  float v = org_liquid(c, R, u_rim, u_glow_amount);
  if (u_octave2 > 0.0) {
    float R2;
    vec4 c2 = org_liquidCells(p, u_scale * 2.0, uSeed + 1.0, R2);
    float v2 = org_liquid(c2, R2, max(u_rim * 0.6, min(u_rim, 1.0)), u_glow_amount);
    if (u_mode == 0) v = max(v, v2 * u_octave2);
    else v *= 1.0 - u_octave2 * 0.6 * (1.0 - v2);
  }
  return genOut(clamp(v, 0.0, 1.0), 1.0, c.z, ${ORG_NO_SDF});
}
`,
}
