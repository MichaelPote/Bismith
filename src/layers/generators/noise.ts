import { P } from '@/core/params'
import type { LayerDef } from '../types'

export const NOISE_TYPES: [string, string][] = [
  ['value', 'Value'],
  ['perlin', 'Perlin'],
  ['simplex', 'Simplex'],
  ['worley', 'Worley F1'],
  ['worley2', 'Worley F2'],
  ['cells', 'Worley edges (F2−F1)'],
  ['white', 'White / pixel'],
]

export const FRACTAL_MODES: [string, string][] = [
  ['none', 'Single octave'],
  ['fbm', 'Clouds'],
  ['ridged', 'Ridged'],
  ['billow', 'Billow'],
  ['turbulence', 'Turbulence'],
]

const isLattice = (p: Record<string, unknown>) => p.noise !== 'white'
const isFractal = (p: Record<string, unknown>) => p.noise !== 'white' && p.fractal !== 'none'

export const noiseLayer: LayerDef = {
  type: 'noise',
  noise: true,
  label: 'Noise',
  category: 'noise',
  kind: 'generator',
  description: 'Tileable lattice, cellular and white noise with fractal sums and domain warp.',
  params: [
    P.enum('noise', 'Type', 'perlin', NOISE_TYPES),
    P.enum('fractal', 'Fractal', 'fbm', FRACTAL_MODES, { showIf: isLattice }),
    P.float('scale', 'Scale', 6, 0.25, 512, { softMax: 64, step: 0.01, showIf: isLattice, hint: 'Cells across the texture width (rounded when tiling)' }),
    P.float('stretch', 'Stretch', 1, 0.05, 20, { softMin: 0.2, softMax: 8, step: 0.01, showIf: isLattice, hint: '>1 elongates features horizontally' }),
    P.int('octaves', 'Octaves', 5, 1, 12, { showIf: isFractal }),
    P.float('lacunarity', 'Lacunarity', 2, 1, 4, { step: 0.01, showIf: isFractal, hint: 'Rounded to an integer when tiling' }),
    P.float('gain', 'Gain', 0.5, 0, 1, { step: 0.001, showIf: isFractal }),
    P.float('warp', 'Warp', 0, 0, 8, { softMax: 2, step: 0.001, showIf: isLattice, hint: 'Domain warp strength, in cells' }),
    P.float('warp_scale', 'Warp scale', 4, 0.25, 128, { softMax: 32, step: 0.01, showIf: (p) => isLattice(p) && Number(p.warp) > 0 }),
    P.int('block', 'Pixel size', 1, 1, 128, { softMax: 16, unit: 'px', showIf: (p) => p.noise === 'white' }),
    P.seed(),
  ],
  defaults: { h_on: true, h_amount: 0.25 },
  glsl: /* glsl */ `
GenOut gen(vec2 p) {
  if (u_noise == 6) {
    float b = float(u_block);
    ivec2 c = ivec2(floor(p / b));
    if (uTile) c = imod(c, ivec2(max(floor(uRes / b + 0.5), vec2(1.0))));
    float v = animValue(hashI(c, uSeed), c, uSeed);
    return genOut(v, 1.0, v, 0.0);
  }
  vec2 cells = cellsFor(u_scale, u_stretch);
  ivec2 period = uTile ? ivec2(cells) : NO_PERIOD;
  vec2 x = p / uRes * cells;
  if (u_warp > 0.0) {
    vec2 wc = cellsFor(u_warp_scale, 1.0);
    ivec2 wper = uTile ? ivec2(wc) : NO_PERIOD;
    x += warpOffset(p / uRes * wc, wper, uSeed + 7.0) * u_warp * 2.0;
  }
  float v = fractalNoise(u_noise, u_fractal, x, period, u_octaves, u_lacunarity, u_gain, uSeed);
  // Worley types have cells (features); value / perlin / simplex are smooth — their "random" is the value itself.
  if (u_noise >= 3) return genOut(v, 1.0, worleyNoise(x, period, 1.0, 0, uSeed).z, 0.0);
  return genOutSmooth(v, 1.0, v, 0.0);
}
`,
}
