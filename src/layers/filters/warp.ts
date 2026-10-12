// Warp: displace every accumulated channel by tileable fBm (wraps on tileable projects).

import { P } from '@/core/params'
import type { LayerDef } from '../types'

export const warpLayer: LayerDef = {
  type: 'warp',
  channels: { diffuse: true, height: true },
  label: 'Warp',
  category: 'filter',
  kind: 'filter',
  description: 'Displaces the layers below by fractal noise: wobbly edges, melted or hand-made looks.',
  params: [
    P.float('strength', 'Strength', 4, 0, 512, { softMax: 32, unit: 'px', step: 0.1, hint: 'Roughly the largest displacement' }),
    P.float('scale', 'Scale', 6, 0.25, 256, { softMax: 64, step: 0.01, hint: 'Noise cells across the texture (rounded when tiling)' }),
    P.int('octaves', 'Octaves', 3, 1, 8),
    P.bool('nearest', 'Nearest pixel', false, { hint: 'No interpolation: keeps hard pixel-art edges' }),
    P.float('phase', 'Phase', 0, -10000, 10000, { softMin: 0, softMax: 1, step: 0.001, optimize: false, hint: 'Animates the warp: 0 → 1 is one seamless loop; it repeats beyond 1' }),
    P.seed(),
  ],
  filterGlsl: /* glsl */ `
void applyFilter(inout vec4 A, inout vec4 S, inout vec4 E, ivec2 ip) {
  if (u_strength <= 0.0) return;
  gPhase = u_phase;
  vec2 p = vec2(ip) + 0.5;
  vec2 cells = cellsFor(u_scale, 1.0);
  ivec2 per = uTile ? ivec2(cells) : NO_PERIOD;
  vec2 x = p / uRes * cells;
  vec2 o = vec2(
    fractalNoise(1, 1, x, per, u_octaves, 2.0, 0.5, uSeed + 101.0),
    fractalNoise(1, 1, x, per, u_octaves, 2.0, 0.5, uSeed + 211.0)) - 0.5;
  vec2 q = p + o * 3.0 * u_strength;
  if (u_nearest) {
    ivec2 c = ivec2(floor(q));
    A = fetchT(tAlbedo, c);
    S = fetchT(tSurface, c);
    E = fetchT(tEmissive, c);
  } else {
    A = sampleT(tAlbedo, q);
    S = sampleT(tSurface, q);
    E = sampleT(tEmissive, q);
  }
}
`,
}
