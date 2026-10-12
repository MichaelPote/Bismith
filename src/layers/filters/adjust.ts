// Per-pixel adjustments of the accumulated channels: height levels, diffuse HSV / brightness / contrast /
// colourise, and height derived from diffuse luminance.

import { P } from '@/core/params'
import type { LayerDef } from '../types'
import { blurTexture } from './shared'

export const levelsLayer: LayerDef = {
  type: 'levels',
  channels: { height: true },
  label: 'Height levels',
  category: 'adjust',
  kind: 'filter',
  description: 'Remaps the height range: input range, gamma, output range, invert.',
  params: [
    P.float('in_lo', 'Input low', 0, -16, 16, { softMin: 0, softMax: 1, step: 0.001 }),
    P.float('in_hi', 'Input high', 1, -16, 16, { softMin: 0, softMax: 1, step: 0.001 }),
    P.float('gamma', 'Gamma', 1, 0.05, 20, { softMin: 0.2, softMax: 5, step: 0.01, hint: '> 1 lowers the mid heights, < 1 raises them' }),
    P.float('out_lo', 'Output low', 0, -16, 16, { softMin: -1, softMax: 2, step: 0.001 }),
    P.float('out_hi', 'Output high', 1, -16, 16, { softMin: -1, softMax: 2, step: 0.001 }),
    P.bool('invert', 'Invert', false),
    P.bool('clamp', 'Clamp', true, { hint: 'Clamp to the input range (off extrapolates beyond it)' }),
  ],
  filterGlsl: /* glsl */ `
void applyFilter(inout vec4 A, inout vec4 S, inout vec4 E, ivec2 ip) {
  float span = u_in_hi - u_in_lo;
  if (abs(span) < 1e-5) span = 1e-5;
  float x = (S.r - u_in_lo) / span;
  if (u_clamp) x = clamp(x, 0.0, 1.0);
  if (u_gamma != 1.0) x = sign(x) * pow(abs(x), u_gamma);
  if (u_invert) x = 1.0 - x;
  S.r = mix(u_out_lo, u_out_hi, x);
}
`,
}

export const hsvLayer: LayerDef = {
  type: 'hsv',
  channels: { diffuse: true },
  label: 'Diffuse adjust',
  category: 'adjust',
  kind: 'filter',
  description: 'Hue, saturation, brightness and contrast of the diffuse colour, with optional colourise.',
  params: [
    P.float('hue', 'Hue shift', 0, -180, 180, { unit: '°', step: 0.1 }),
    P.float('saturation', 'Saturation', 0, -1, 4, { softMax: 1, step: 0.001, hint: '−1 = greyscale' }),
    P.float('brightness', 'Brightness', 0, -1, 1, { step: 0.001 }),
    P.float('contrast', 'Contrast', 0, -1, 4, { softMax: 1, step: 0.001 }),
    P.bool('colorize', 'Colourise', false, { group: 'colorize' }),
    P.color('tint', 'Tint', '#8a6a48', { group: 'colorize', hint: 'Black → tint → white by luminance' }),
    P.float('tint_amount', 'Amount', 1, 0, 1, { step: 0.001, group: 'colorize' }),
  ],
  groups: [{ id: 'colorize', label: 'Colourise', toggleKey: 'colorize' }],
  filterGlsl: /* glsl */ `
void applyFilter(inout vec4 A, inout vec4 S, inout vec4 E, ivec2 ip) {
  vec3 c = linearToSrgb(A.rgb);
  c = clamp((c - 0.5) * (1.0 + u_contrast) + 0.5 + u_brightness, 0.0, 1.0);
  if (u_hue != 0.0 || u_saturation != 0.0) {
    vec3 hsv = rgb2hsv(c);
    hsv.x = fract(hsv.x + u_hue / 360.0);
    hsv.y = clamp(hsv.y * (1.0 + u_saturation), 0.0, 1.0);
    c = hsv2rgb(hsv);
  }
  if (u_colorize) {
    float L = luma(c);
    vec3 t = linearToSrgb(u_tint);
    vec3 tinted = L < 0.5 ? t * (2.0 * L) : mix(t, vec3(1.0), 2.0 * L - 1.0);
    c = mix(c, tinted, u_tint_amount);
  }
  A.rgb = srgbToLinear(clamp(c, 0.0, 1.0));
}
`,
}

const HFD_APPLY = /* glsl */ `
uniform sampler2D tLum;
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(tAlbedo, ip, 0);
  vec4 S = texelFetch(tSurface, ip, 0);
  vec4 E = texelFetch(tEmissive, ip, 0);
  float l = luma(linearToSrgb(texelFetch(tLum, ip, 0).rgb));
  if (u_invert) l = 1.0 - l;
  if (u_centre) l -= 0.5;
  float v = l * u_amount;
  float h = S.r;
  S.r = u_mode == 0 ? h + v : u_mode == 1 ? h - v : u_mode == 2 ? max(h, v)
      : u_mode == 3 ? min(h, v) : u_mode == 4 ? v : h * v;
  oAlbedo = A;
  oSurface = S;
  oEmissive = E;
}
`

export const heightFromDiffuseLayer: LayerDef = {
  type: 'heightFromDiffuse',
  channels: { height: true },
  label: 'Height from diffuse',
  category: 'adjust',
  kind: 'filter',
  description: 'Turns diffuse luminance into height (bright = high), optionally pre-blurred.',
  params: [
    P.float('amount', 'Amount', 0.5, -16, 16, { softMin: -2, softMax: 2, step: 0.001 }),
    P.enum('mode', 'Mode', 'add', [['add', 'Add'], ['subtract', 'Subtract'], ['max', 'Max'], ['min', 'Min'], ['replace', 'Replace'], ['multiply', 'Multiply']]),
    P.bool('invert', 'Invert', false, { hint: 'Dark = high' }),
    P.bool('centre', 'Centre on mid-grey', false, { hint: 'Luminance − 0.5, so mid-grey leaves height unchanged' }),
    P.float('blur', 'Pre-blur', 0, 0, 64, { softMax: 8, unit: 'px', step: 0.1 }),
  ],
  run(ctx, layer) {
    const radius = Number(layer.params.blur ?? 0)
    const src = radius > 0 ? blurTexture(ctx, ctx.albedo, radius, 'hfd').texture : ctx.albedo
    const mat = ctx.mrtMaterial('apply', HFD_APPLY, { tLum: { value: null } })
    mat.uniforms.tLum.value = src
    ctx.runMRT(mat)
  },
}
