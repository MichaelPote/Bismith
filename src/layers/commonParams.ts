// Params shared by every generator layer: SDF shape handling, value shaping, masking and the channel
// outputs (docs/architecture.md §5.2). They live flat in layer.params next to the type's own params.

import { P, gradient, type GroupDef, type ParamDef } from '@/core/params'

const SRC: [string, string][] = [
  ['value', 'Pattern value'],
  ['flat', 'Flat (1.0)'],
  ['random', 'Per-feature random'],
]

export const SDF_OPS: [string, string][] = [
  ['none', 'Ignore register'],
  ['replace', 'New shape'],
  ['union', 'Union'],
  ['subtract', 'Subtract'],
  ['intersect', 'Intersect'],
  ['smooth-union', 'Smooth union'],
  ['smooth-subtract', 'Smooth subtract'],
  ['smooth-intersect', 'Smooth intersect'],
]

export const PROFILES: [string, string][] = [
  ['flat', 'Flat'],
  ['linear', 'Linear'],
  ['smooth', 'Smooth'],
  ['round', 'Round'],
  ['cove', 'Cove'],
  ['ridge', 'Ridge'],
  ['steps', 'Steps'],
  ['custom', 'Custom curve'],
]

/** Default custom bevel: steep for the first fifth of the bevel, then a long, gentle rise. */
export const DEFAULT_BEVEL_CURVE = { points: [{ x: 0, y: 0 }, { x: 0.15, y: 0.55 }, { x: 0.45, y: 0.82 }, { x: 1, y: 1 }] }

/** The custom bevel curve param (shown when Profile = Custom curve). */
export const bevelCurveParam = (group?: string): ParamDef =>
  P.curve('bevel_curve', 'Bevel curve', DEFAULT_BEVEL_CURVE, {
    ...(group ? { group } : {}),
    showIf: (p) => p.profile === 'custom',
    hint: 'Height (up) against distance into the shape (right, 0 = edge … 1 = bevel width). Points may rise and fall — raised rims, dished centres. Drag points; click to add, double-click to remove',
  })

/**
 * Shader prefix / suffix for layers with a custom bevel curve: profileCurve() in the common GLSL calls bevelCurve(),
 * which forwards to the curve_bevel_curve() emitted with the layer's uniforms.
 */
export const bevelCurveDefine = (defs: ParamDef[]) => (defs.some((d) => d.key === 'bevel_curve') ? '#define BEVEL_CURVE\n' : '')
export const bevelCurveImpl = (defs: ParamDef[]) =>
  defs.some((d) => d.key === 'bevel_curve') ? 'float bevelCurve(float x) { return curve_bevel_curve(x); }\n' : ''

export const BLEND_MODES: [string, string][] = [
  ['normal', 'Normal'],
  ['multiply', 'Multiply'],
  ['screen', 'Screen'],
  ['overlay', 'Overlay'],
  ['add', 'Add'],
  ['subtract', 'Subtract'],
  ['darken', 'Darken'],
  ['lighten', 'Lighten'],
  ['softlight', 'Soft light'],
]

const isSmooth = (p: Record<string, unknown>) => String(p.sdf_op).startsWith('smooth')

export const SDF_PARAMS: ParamDef[] = [
  P.enum('sdf_op', 'Operator', 'replace', SDF_OPS, { group: 'shape', hint: 'How this shape combines with the shape register written by earlier layers' }),
  P.float('sdf_k', 'Smoothness', 4, 0, 256, { softMax: 32, unit: 'px', step: 0.1, group: 'shape', showIf: isSmooth }),
  P.float('bevel', 'Bevel', 3, 0, 1024, { softMax: 32, unit: 'px', step: 0.1, group: 'shape' }),
  P.enum('profile', 'Profile', 'round', PROFILES, { group: 'shape' }),
  bevelCurveParam('shape'),
  P.bool('aa', 'Anti-alias', true, { group: 'shape', hint: 'Off gives hard pixel edges' }),
]

export const SHAPING_PARAMS: ParamDef[] = [
  P.float('ofs_x', 'Offset X', 0, -4096, 4096, { softMin: -32, softMax: 32, unit: 'px', step: 0.1, group: 'shaping', hint: 'Shift the whole pattern (wraps on tileable projects)' }),
  P.float('ofs_y', 'Offset Y', 0, -4096, 4096, { softMin: -32, softMax: 32, unit: 'px', step: 0.1, group: 'shaping', hint: 'Shift the whole pattern down' }),
  P.float('dw_amount', 'Domain warp', 0, 0, 256, { softMax: 8, unit: 'px', step: 0.05, group: 'shaping', hint: 'Displaces the whole generated pattern by smooth noise (after generation): joints wander but keep their width' }),
  P.float('dw_scale', 'Warp scale', 4, 0.25, 128, { softMax: 32, step: 0.01, group: 'shaping', showIf: (p) => Number(p.dw_amount) > 0, hint: 'Warp features across the texture (rounded when tiling)' }),
  P.bool('sh_invert', 'Invert', false, { group: 'shaping' }),
  P.float('sh_lo', 'Low', 0, 0, 1, { step: 0.001, group: 'shaping' }),
  P.float('sh_hi', 'High', 1, 0, 1, { step: 0.001, group: 'shaping' }),
  P.float('sh_gamma', 'Gamma', 1, 0.05, 20, { softMin: 0.2, softMax: 5, step: 0.01, group: 'shaping' }),
  P.int('sh_steps', 'Posterize', 0, 0, 64, { softMax: 16, group: 'shaping', hint: '0 = off' }),
  P.float('sh_cut', 'Cutoff', 0, 0, 1, { step: 0.001, group: 'shaping', hint: 'Covers only where the shaped value ≥ cutoff (0 = off): sparse flecks from white noise, islands from fBm' }),
  P.float('sh_cut_soft', 'Cutoff softness', 0, 0, 0.5, { step: 0.001, group: 'shaping', showIf: (p) => Number(p.sh_cut) > 0 }),
]

const MASK_CHANNELS: [string, string][] = [['none', 'None'], ['1', 'Mask 1'], ['2', 'Mask 2'], ['3', 'Mask 3'], ['4', 'Mask 4']]

/** Named masks (FR8.13), read side: clip a layer (or filter) to one of the four mask channels. */
export const MASK_USE_PARAMS: ParamDef[] = [
  P.enum('mk_use', 'Masked by', 'none', MASK_CHANNELS, { group: 'mask', hint: 'Only where this named mask is set (by a layer\'s "Write to mask", anywhere in the stacks)' }),
  P.bool('mk_invert', 'Outside the mask', false, { group: 'mask', showIf: (p) => (p.mk_use ?? 'none') !== 'none', hint: 'Only where the mask is not set: cut a hole' }),
]

export const MASK_PARAMS: ParamDef[] = [
  P.float('opacity', 'Layer opacity', 1, 0, 1, { step: 0.001, group: 'mask' }),
  ...MASK_USE_PARAMS,
  P.enum('mk_write', 'Write to mask', 'none', MASK_CHANNELS, { group: 'mask', hint: 'Record this layer\'s coverage in a named mask. Masks are worked out before everything else (their writers in stack order, over the base only), so any layer or material can clip to them wherever it sits' }),
  P.enum('mk_mode', 'Mask mode', 'replace', [['replace', 'Replace'], ['add', 'Add (union)'], ['subtract', 'Subtract'], ['intersect', 'Intersect']], { group: 'mask', showIf: (p) => (p.mk_write ?? 'none') !== 'none' }),
  P.enum('m_clip', 'Clip to shape', 'none', [['none', 'None'], ['inside', 'Inside register'], ['outside', 'Outside register']], { group: 'mask' }),
  P.enum('m_hmode', 'Height mask', 'none', [['none', 'None'], ['above', 'Above level'], ['below', 'Below level']], { group: 'mask' }),
  P.float('m_hlevel', 'Level', 0.5, -16, 16, { softMin: 0, softMax: 1, step: 0.001, group: 'mask', showIf: (p) => p.m_hmode !== 'none' }),
  P.float('m_hsoft', 'Softness', 0.1, 0, 4, { softMax: 1, step: 0.001, group: 'mask', showIf: (p) => p.m_hmode !== 'none' }),
]

export const OUTPUT_PARAMS: ParamDef[] = [
  P.bool('dif_on', 'Diffuse', false, { group: 'diffuse' }),
  P.enum('dif_src', 'Source', 'value', SRC, { group: 'diffuse' }),
  P.enum('dif_blend', 'Blend', 'normal', BLEND_MODES, { group: 'diffuse' }),
  P.float('dif_opacity', 'Opacity', 1, 0, 1, { step: 0.001, group: 'diffuse' }),
  P.gradient('dif_grad', 'Colour ramp', gradient('#2a2622', '#b8ab98'), { group: 'diffuse' }),
  P.float('dif_jitter', 'Random jitter', 0, 0, 1, { step: 0.001, group: 'diffuse', hint: 'Shifts the ramp lookup per feature (brick, cell, instance)' }),

  P.bool('op_on', 'Opacity', false, { group: 'alpha' }),
  P.enum('op_mode', 'Mode', 'replace', [['replace', 'Replace'], ['multiply', 'Multiply'], ['union', 'Union (max)'], ['subtract', 'Subtract']], { group: 'alpha' }),

  P.bool('h_on', 'Height', false, { group: 'height' }),
  P.enum('h_src', 'Source', 'value', SRC, { group: 'height' }),
  P.enum('h_mode', 'Mode', 'add', [['add', 'Add'], ['subtract', 'Subtract'], ['max', 'Max'], ['min', 'Min'], ['replace', 'Replace'], ['multiply', 'Multiply']], { group: 'height' }),
  P.float('h_amount', 'Amount', 0.5, -64, 64, { softMin: 0, softMax: 2, step: 0.001, group: 'height' }),
  P.float('h_var', 'Per-feature variation', 0, 0, 1, { step: 0.001, group: 'height', hint: 'Each brick / cell / instance gets its own share of the amount (1 = anywhere from 0 to full): some barely raised, others bold' }),

  P.bool('r_on', 'Roughness', false, { group: 'roughness' }),
  P.enum('r_src', 'Source', 'value', SRC, { group: 'roughness' }),
  P.enum('r_mode', 'Mode', 'replace', [['replace', 'Replace'], ['multiply', 'Multiply'], ['add', 'Add'], ['min', 'Min'], ['max', 'Max']], { group: 'roughness' }),
  P.float('r_a', 'At 0', 0.35, 0, 1, { step: 0.001, group: 'roughness' }),
  P.float('r_b', 'At 1', 0.85, 0, 1, { step: 0.001, group: 'roughness' }),
  P.float('r_opacity', 'Opacity', 1, 0, 1, { step: 0.001, group: 'roughness' }),

  P.bool('s_on', 'Specular', false, { group: 'specular' }),
  P.enum('s_src', 'Source', 'value', SRC, { group: 'specular' }),
  P.enum('s_mode', 'Mode', 'replace', [['replace', 'Replace'], ['multiply', 'Multiply'], ['add', 'Add'], ['min', 'Min'], ['max', 'Max']], { group: 'specular' }),
  P.float('s_a', 'At 0', 0, 0, 1, { step: 0.001, group: 'specular', hint: 'Specular level where the source is 0 (0.5 ≈ 4 % reflectance at scale 1)' }),
  P.float('s_b', 'At 1', 0.6, 0, 1, { step: 0.001, group: 'specular' }),
  P.float('s_opacity', 'Opacity', 1, 0, 1, { step: 0.001, group: 'specular' }),

  P.bool('e_on', 'Emissive', false, { group: 'emissive' }),
  P.enum('e_src', 'Source', 'value', SRC, { group: 'emissive' }),
  P.enum('e_mode', 'Mode', 'add', [['add', 'Add'], ['replace', 'Replace'], ['max', 'Max']], { group: 'emissive' }),
  P.color('e_color', 'Colour', '#ff9019', { group: 'emissive' }),
  P.float('e_intensity', 'Intensity', 2, 0, 1000, { softMax: 20, step: 0.01, group: 'emissive' }),
]

export const GENERATOR_GROUPS: GroupDef[] = [
  { id: 'params', label: 'Pattern' },
  { id: 'shape', label: 'Shape' },
  { id: 'shaping', label: 'Shaping', collapsed: true },
  { id: 'mask', label: 'Mask', collapsed: true },
  { id: 'diffuse', label: 'Diffuse', toggleKey: 'dif_on' },
  { id: 'alpha', label: 'Opacity', toggleKey: 'op_on' },
  { id: 'height', label: 'Height', toggleKey: 'h_on' },
  { id: 'roughness', label: 'Roughness', toggleKey: 'r_on' },
  { id: 'specular', label: 'Specular', toggleKey: 's_on' },
  { id: 'emissive', label: 'Emissive', toggleKey: 'e_on' },
]

export const FILTER_GROUPS: GroupDef[] = [
  { id: 'params', label: 'Filter' },
  { id: 'mask', label: 'Mask', collapsed: true },
]

/** The clip factor of a named mask for the current layer (1 = unmasked). Needs u_mk_use / u_mk_invert. */
export const GLSL_NAMED_MASK = /* glsl */ `
float namedMask(vec4 M) {
  if (u_mk_use <= 0) return 1.0;
  float v = clamp(M[u_mk_use - 1], 0.0, 1.0);
  return u_mk_invert ? 1.0 - v : v;
}
`

/** GLSL for the generator wrapper's use of the common params (declared automatically from the defs above). */
export const GLSL_GENERATOR_MAIN = (sdf: boolean) => /* glsl */ `

float shapeValue(float v) {
  v = clamp((v - u_sh_lo) / max(u_sh_hi - u_sh_lo, 1e-5), 0.0, 1.0);
  if (u_sh_gamma != 1.0) v = pow(v, u_sh_gamma);
  if (u_sh_steps > 1) { float n = float(u_sh_steps); v = min(floor(v * n), n - 1.0) / (n - 1.0); }
  return u_sh_invert ? 1.0 - v : v;
}

float srcValue(int src, float value, float rnd) { return src == 1 ? 1.0 : src == 2 ? rnd : value; }

${GLSL_NAMED_MASK}
uniform bool uWriteMasks;
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(tAlbedo, ip, 0);
  vec4 S = texelFetch(tSurface, ip, 0);
  vec4 E = texelFetch(tEmissive, ip, 0);
  vec4 M = texelFetch(tMasks, ip, 0);
  float prevReg = S.a;

  vec2 pp = gl_FragCoord.xy - vec2(u_ofs_x, -u_ofs_y);
  if (u_dw_amount > 0.0) {
    // Domain warp of the whole pattern: neighbouring features move together, so gaps keep their width.
    vec2 wc = cellsFor(u_dw_scale, 1.0);
    pp += warpOffset(gl_FragCoord.xy / uRes * wc, uTile ? ivec2(wc) : NO_PERIOD, uSeed + 409.0) * 2.0 * u_dw_amount;
  }
  GenOut g = gen(pp);
  float value = g.value;
  float cov = g.mask;
${sdf ? /* glsl */ `
  if (g.sdf > NO_SDF) {
    float d = u_sdf_op == 0 ? g.sdf : sdfCombine(u_sdf_op, prevReg, g.sdf, u_sdf_k);
    if (u_sdf_op != 0) S.a = d;
    cov *= coverage(d, u_aa);
    // Flat (or zero-width) bevels output 1 and let coverage do the anti-aliasing, so edges ramp
    // symmetrically across the boundary; profiled bevels rise from 0 at the edge.
    float inside = max(-d, 0.0);
    value = (u_bevel > 0.0 && u_profile != 0) ? profileCurve(u_profile, inside / u_bevel) : 1.0;
  }
` : ''}
  value = shapeValue(value);
  if (u_sh_cut > 0.0) cov *= u_sh_cut_soft > 0.0 ? smoothstep(u_sh_cut - u_sh_cut_soft, u_sh_cut + u_sh_cut_soft, value) : step(u_sh_cut, value);

  float m = cov * u_opacity;
  if (u_m_clip == 1) m *= clamp(0.5 - prevReg, 0.0, 1.0);
  if (u_m_clip == 2) m *= 1.0 - clamp(0.5 - prevReg, 0.0, 1.0);
  if (u_m_hmode != 0) {
    float s = max(u_m_hsoft, 1e-4);
    float hm = smoothstep(u_m_hlevel - s, u_m_hlevel + s, S.r);
    m *= u_m_hmode == 1 ? hm : 1.0 - hm;
  }
  m *= namedMask(M);

  if (u_dif_on) {
    float v = srcValue(u_dif_src, value, g.rnd);
    v = clamp(v + (g.rnd - 0.5) * u_dif_jitter, 0.0, 1.0);
    vec3 top = gradientLookup(u_dif_grad_stops, u_dif_grad_count, v);
    vec3 base = linearToSrgb(A.rgb);
    vec3 blended = blendMode(u_dif_blend, base, top);
    A.rgb = srgbToLinear(mix(base, blended, m * u_dif_opacity));
  }
  if (u_op_on) {
    if (u_op_mode == 0) A.a = mix(A.a, cov, u_opacity);
    else if (u_op_mode == 1) A.a *= mix(1.0, cov, u_opacity);
    else if (u_op_mode == 2) A.a = max(A.a, m);
    else A.a *= 1.0 - m;
  }
  if (u_h_on) {
    // Per-feature amplitude from a hash decorrelated from the colour random.
    float v = srcValue(u_h_src, value, g.rnd) * u_h_amount * (1.0 - u_h_var * fract(g.rnd * 61.37 + 0.123));
    float h = S.r;
    float nh = u_h_mode == 0 ? h + v : u_h_mode == 1 ? h - v : u_h_mode == 2 ? max(h, v)
             : u_h_mode == 3 ? min(h, v) : u_h_mode == 4 ? v : h * v;
    S.r = mix(h, nh, m);
  }
  if (u_r_on) {
    float v = srcValue(u_r_src, value, g.rnd);
    float r = mix(u_r_a, u_r_b, v);
    float o = S.g;
    float nr = u_r_mode == 0 ? r : u_r_mode == 1 ? o * r : u_r_mode == 2 ? o + r : u_r_mode == 3 ? min(o, r) : max(o, r);
    S.g = clamp(mix(o, nr, m * u_r_opacity), 0.0, 1.0);
  }
  if (u_s_on) {
    float v = srcValue(u_s_src, value, g.rnd);
    float sp = mix(u_s_a, u_s_b, v);
    float o = E.a;
    float ns = u_s_mode == 0 ? sp : u_s_mode == 1 ? o * sp : u_s_mode == 2 ? o + sp : u_s_mode == 3 ? min(o, sp) : max(o, sp);
    E.a = clamp(mix(o, ns, m * u_s_opacity), 0.0, 1.0);
  }
  if (u_e_on) {
    float v = srcValue(u_e_src, value, g.rnd);
    vec3 e = u_e_color * u_e_intensity * v;
    vec3 ne = u_e_mode == 0 ? E.rgb + e : u_e_mode == 1 ? e : max(E.rgb, e);
    E.rgb = mix(E.rgb, ne, m);
  }

  if (uWriteMasks && u_mk_write > 0) {
    // The layer's final coverage (after its own clips) into the named mask (in the masks pre-pass only).
    int c = u_mk_write - 1;
    float o = M[c];
    M[c] = u_mk_mode == 0 ? m : u_mk_mode == 1 ? max(o, m) : u_mk_mode == 2 ? o * (1.0 - m) : min(o, m);
  }

  oAlbedo = A;
  oSurface = S;
  oEmissive = E;
  oMasks = M;
}
`
