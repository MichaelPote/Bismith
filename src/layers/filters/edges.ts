// Distance-based filters: bevel and etch. The edge comes from a thresholded channel (jump-flood signed
// distance, gpu/jfa.ts) or directly from the shape register written by SDF layers (exact).

import { P } from '@/core/params'
import { PROFILES, bevelCurveParam } from '../commonParams'
import type { LayerDef } from '../types'
import { GLSL_SOURCE_DIST, SMOOTH_PARAM, SOURCE_PARAMS, sourceDistance } from './shared'

const BEVEL_APPLY = /* glsl */ `
${GLSL_SOURCE_DIST}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(tAlbedo, ip, 0);
  vec4 S = texelFetch(tSurface, ip, 0);
  vec4 E = texelFetch(tEmissive, ip, 0);
  float d = sourceDist(ip, S, u_invert);
  float w = max(u_width, 0.0);
  // o = where the slope starts (its outer foot) relative to the edge: inner 0, outer w, both w/2.
  float o = u_direction == 0 ? 0.0 : u_direction == 1 ? w : 0.5 * w;
  float b = w > 1e-3 ? profileCurve(u_profile, (o - d) / w) : (d - o < 0.0 ? 1.0 : 0.0);
  // The bevelled region (anything the slope or plateau covers), anti-aliased by one pixel.
  float m = clamp(o - d + 0.5, 0.0, 1.0);
  float v = u_depth * b;
  float h = S.r;
  float nh = u_combine == 0 ? h + v : u_combine == 1 ? max(h, v) : u_combine == 2 ? min(h, v) : v;
  S.r = mix(h, nh, m);
  oAlbedo = A;
  oSurface = S;
  oEmissive = E;
}
`

export const bevelLayer: LayerDef = {
  type: 'bevel',
  channels: { height: true },
  label: 'Bevel',
  category: 'filter',
  kind: 'filter',
  description: 'Raises (or sinks) a thresholded area or the shape mask with a profiled bevel along its edge.',
  params: [
    ...SOURCE_PARAMS,
    SMOOTH_PARAM,
    P.bool('invert', 'Invert', false, { hint: 'Bevel the outside of the mask (holes, wells) instead' }),
    P.float('width', 'Width', 4, 0, 256, { softMax: 32, unit: 'px', step: 0.1 }),
    P.enum('profile', 'Profile', 'round', PROFILES),
    bevelCurveParam(),
    P.float('depth', 'Depth', 0.5, -16, 16, { softMin: -2, softMax: 2, step: 0.001, hint: 'Height at the top of the bevel (negative sinks)' }),
    P.enum('direction', 'Direction', 'inner', [
      ['inner', 'Inner (inside the edge)'],
      ['outer', 'Outer (skirt outside)'],
      ['both', 'Centred on the edge'],
    ]),
    P.enum('combine', 'Combine', 'add', [
      ['add', 'Add'],
      ['max', 'Max'],
      ['min', 'Min (round off)'],
      ['replace', 'Replace'],
    ], { hint: 'How depth × profile meets the existing height inside the bevelled region' }),
  ],
  run(ctx, layer) {
    const p = layer.params
    const w = Math.max(0, Number(p.width ?? 0))
    const tDist = sourceDistance(ctx, p, w + 2, Boolean(p.invert))
    const mat = ctx.mrtMaterial('apply', BEVEL_APPLY, { tDist: { value: null } })
    mat.uniforms.tDist.value = tDist ?? ctx.surface
    ctx.runMRT(mat)
  },
}

const ETCH_APPLY = /* glsl */ `
${GLSL_SOURCE_DIST}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(tAlbedo, ip, 0);
  vec4 S = texelFetch(tSurface, ip, 0);
  vec4 E = texelFetch(tEmissive, ip, 0);
  float d = sourceDist(ip, S, false);
  float hw = max(u_width, 0.0) * 0.5;
  float ad = abs(d + u_offset);
  // Softness 0: a crisp band (1 px anti-aliased edge); 1: a V-shaped groove reaching hw + .5 from its centre.
  float g = (1.0 - smoothstep(hw - 0.5 - u_softness * hw, hw + 0.5, ad)) * clamp(u_width, 0.0, 1.0);
  S.r -= u_depth * g;
  if (u_dif_on) A.rgb = mix(A.rgb, u_dif_color, clamp(u_dif_amount * g, 0.0, 1.0));
  if (u_r_on) S.g = clamp(mix(S.g, u_r_value, clamp(u_r_amount * g, 0.0, 1.0)), 0.0, 1.0);
  if (u_e_on) E.rgb += u_e_color * u_e_intensity * g;
  oAlbedo = A;
  oSurface = S;
  oEmissive = E;
}
`

export const etchLayer: LayerDef = {
  type: 'etch',
  channels: { diffuse: 'dif_on', height: true },
  label: 'Etch',
  category: 'filter',
  kind: 'filter',
  description: 'Cuts a groove along an edge: panel seams, engraved outlines (optionally darkened, glossed or glowing).',
  params: [
    ...SOURCE_PARAMS,
    SMOOTH_PARAM,
    P.float('width', 'Width', 2, 0, 128, { softMax: 16, unit: 'px', step: 0.1 }),
    P.float('depth', 'Depth', 0.3, -16, 16, { softMin: -1, softMax: 1, step: 0.001, hint: 'Height removed at the groove centre (negative = ridge)' }),
    P.float('softness', 'Softness', 0.3, 0, 1, { step: 0.001, hint: '0 = crisp flat-bottomed cut, 1 = V groove' }),
    P.float('offset', 'Offset', 0, -128, 128, { softMin: -16, softMax: 16, unit: 'px', step: 0.1, hint: 'Moves the groove inside (+) or outside (−) the edge; ±0.5 centres an odd width on a pixel row' }),
    P.bool('dif_on', 'Diffuse', true, { group: 'diffuse' }),
    P.color('dif_color', 'Colour', '#16120e', { group: 'diffuse' }),
    P.float('dif_amount', 'Amount', 0.6, 0, 1, { step: 0.001, group: 'diffuse' }),
    P.bool('r_on', 'Roughness', false, { group: 'roughness' }),
    P.float('r_value', 'Roughness', 0.9, 0, 1, { step: 0.001, group: 'roughness' }),
    P.float('r_amount', 'Amount', 1, 0, 1, { step: 0.001, group: 'roughness' }),
    P.bool('e_on', 'Emissive', false, { group: 'emissive' }),
    P.color('e_color', 'Colour', '#ff9019', { group: 'emissive' }),
    P.float('e_intensity', 'Intensity', 2, 0, 1000, { softMax: 20, step: 0.01, group: 'emissive' }),
  ],
  groups: [
    { id: 'diffuse', label: 'Diffuse', toggleKey: 'dif_on' },
    { id: 'roughness', label: 'Roughness', toggleKey: 'r_on' },
    { id: 'emissive', label: 'Emissive', toggleKey: 'e_on' },
  ],
  run(ctx, layer) {
    const p = layer.params
    const reach = Math.max(0, Number(p.width ?? 0)) * 0.5 + Math.abs(Number(p.offset ?? 0)) + 2
    const tDist = sourceDistance(ctx, p, reach)
    const mat = ctx.mrtMaterial('apply', ETCH_APPLY, { tDist: { value: null } })
    mat.uniforms.tDist.value = tDist ?? ctx.surface
    ctx.runMRT(mat)
  },
}
