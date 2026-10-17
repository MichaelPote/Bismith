// Params shared by every generator layer: SDF shape handling, value shaping, masking and the channel
// outputs (docs/architecture.md §5.2). They live flat in layer.params next to the type's own params.

import { P, gradient, type GroupDef, type ParamDef } from '@/core/params'

/** What drives a channel output (the uniform keeps the option order: 0 value, 1 flat, 2 random, 3 shape). */
const SRC: [string, string, string][] = [
  ['value', 'Pattern', 'the layer’s own value: noise brightness, the bevel’s rise on a shape — varies across it'],
  ['flat', 'Solid', 'full strength everywhere the layer covers: the ramp’s end colour, the whole amount'],
  ['random', 'Random', 'one random value per feature: each brick, cell or shape instance its own'],
  ['shape', 'Shape', 'the layer’s shape without its pattern: 1 inside, 0 outside (anti-aliased) — e.g. Wood’s gaps rougher than its boards, grain ignored. 1 everywhere on layers without a shape'],
]

const SRC_HINT = 'What drives this output'

// Masks (FR8.23): named, each a signed distance plus the random of the feature there. A layer writes one (Mask › Write
// to, shape layers default to the Shape mask) and is limited by an expression of them (Limit to). The mode is how the
// layer's shape or coverage combines with what the mask held. Option order matters: the index + 1 is sdfCombine's op.
export const SDF_OPS: [string, string][] = [
  ['replace', 'Normal'],
  ['union', 'Union'],
  ['subtract', 'Subtract'],
  ['intersect', 'Intersection'],
  ['smooth-union', 'Smooth union'],
  ['smooth-subtract', 'Smooth subtract'],
  ['smooth-intersect', 'Smooth intersection'],
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

const isSmooth = (p: Record<string, unknown>) => String(p.mk_op).startsWith('smooth')
const writes = (p: Record<string, unknown>) => String(p.mk_target ?? '').trim() !== ''

/** The Source dropdown of a channel output, drawn in one row with its blend mode. */
const source = (key: string, group: string, mode: string, modeLabel = 'Mode'): ParamDef =>
  P.enum(key, 'Source', 'value', SRC, { group, hint: SRC_HINT, join: { with: mode, as: 'pair', label: `Source · ${modeLabel}` } })

/** "At 0" / "At 1" of a scalar output, drawn as one ramp. */
const ramp = (key: string, group: string) => ({ join: { with: key, as: 'ramp' as const, label: 'Ramp' }, group })

const HEIGHT_MODES: [string, string, string][] = [
  ['add', 'Add', 'raise by the amount'],
  ['subtract', 'Subtract', 'sink by the amount'],
  ['max', 'Max', 'raise to the amount where lower (caps, plateaus)'],
  ['min', 'Min', 'lower to the amount where higher (chips, cut-offs)'],
  ['replace', 'Replace', 'set the height to the amount'],
  ['multiply', 'Multiply', 'scale the height below (masks relief in and out)'],
]
const LEVEL_MODES: [string, string][] = [['replace', 'Replace'], ['multiply', 'Multiply'], ['add', 'Add'], ['min', 'Min'], ['max', 'Max']]

/**
 * Mask card › Write to (FR8.23): the mask this layer writes and how. Shape layers write their shape (a distance, and the
 * random of each feature) and default to the Shape mask; other generators write their coverage when given a mask.
 */
export const MASK_WRITE_PARAMS: ParamDef[] = [
  P.text('mk_target', 'Write to', '', {
    group: 'mask',
    section: 'Write to',
    hint: 'The mask this layer writes, by name: a shape layer its shape (and which feature is where), any other layer where it covers. Later layers can be limited to it (Limit to), bevel or etch along it, or read its features (Mask area). Shape layers write the Shape mask unless told otherwise; empty = none',
  }),
  P.enum('mk_op', 'Mode', 'replace', SDF_OPS, {
    group: 'mask',
    section: 'Write to',
    showIf: writes,
    hint: 'Normal: this layer replaces what the mask held. Union: adds to it. Subtract: cuts this layer out of it. Intersection: keeps only the overlap. Smooth: blended with a rounded fillet. A shape layer draws the combined shape in every mode',
  }),
  P.float('mk_smooth', 'Smoothness', 4, 0, 256, {
    softMax: 32,
    unit: 'px',
    step: 0.1,
    group: 'mask',
    section: 'Write to',
    showIf: (p) => writes(p) && isSmooth(p),
    hint: 'How wide the rounded fillet is where this layer meets what the mask held (the smooth modes)',
  }),
  P.float('mk_feather', 'Feather', 0, 0, 1024, {
    softMax: 32,
    unit: 'px',
    step: 0.1,
    group: 'mask',
    section: 'Write to',
    showIf: writes,
    hint: 'Soft edge of the written mask: a ramp this wide across a shape\'s outline (shape layers). Other layers soften with Shaping › Cutoff softness',
  }),
]

/** Most masks a Limit to expression combines. */
export const MAX_LIMIT_TERMS = 4

export const LIMIT_OPS: [string, string, string][] = [
  ['and', '∩ and', 'only where both are'],
  ['or', '∪ or', 'where either is'],
  ['minus', '− minus', 'cut this mask out of the ones before'],
]

/**
 * Mask card › Limit to (FR8.23), for generators and filters: up to four masks by name, read left to right (lim_1, then
 * lim_op2 lim_2 …), Outside inverting the result. Not uploaded: the pipeline combines the masks into one limit.
 */
export const LIMIT_PARAMS: ParamDef[] = [
  ...Array.from({ length: MAX_LIMIT_TERMS }, (_, i): ParamDef[] => {
    const n = i + 1
    const shown = (p: Record<string, unknown>) => i === 0 || String(p[`lim_${i}`] ?? '').trim() !== ''
    const name = P.text(`lim_${n}`, i === 0 ? 'Limit to' : `Mask ${n}`, '', {
      group: 'mask',
      section: 'Limit to',
      showIf: shown,
      hint: i === 0
        ? 'Draw this layer only where a mask is (or, with Outside, isn\'t): a mask written by a layer above, by name — Shape is the one shape layers write. Empty = anywhere'
        : 'One more mask, joined to the ones before by the operator',
    })
    if (i === 0) return [name]
    return [P.enum(`lim_op${n}`, 'Then', 'and', LIMIT_OPS, { group: 'mask', section: 'Limit to', uniform: false, showIf: shown }), name]
  }).flat(),
  P.bool('lim_out', 'Outside', false, {
    group: 'mask',
    section: 'Limit to',
    uniform: false,
    showIf: (p) => String(p.lim_1 ?? '').trim() !== '',
    hint: 'Use the masks the other way round: only where they are not — grout between the tiles, a hole cut through',
  }),
]

export const SDF_PARAMS: ParamDef[] = [
  P.float('bevel', 'Bevel', 3, 0, 1024, { softMax: 64, unit: 'px', step: 0.1, group: 'shaping', section: 'Edge' }),
  P.enum('profile', 'Profile', 'round', PROFILES, { group: 'shaping', section: 'Edge' }),
  { ...bevelCurveParam('shaping'), section: 'Edge' },
  P.float('bevel_aspect', 'Bevel aspect', 1, 0.05, 20, {
    softMin: 0.25,
    softMax: 4,
    step: 0.01,
    group: 'shaping',
    section: 'Edge',
    showIf: (p) => Number(p.bevel) > 0 && p.profile !== 'flat',
    hint: 'Top / bottom bevel width against left / right: the two trade around Bevel (their geometric mean) — 2 makes top and bottom bevels 1.41× Bevel and left and right 0.71× (the ends of vertical planks round off twice as far in as their sides), 0.5 the reverse. Slanted edges and corners fall in between',
  }),
  P.bool('aa', 'Anti-alias', true, { group: 'shaping', section: 'Edge', hint: 'Off gives hard pixel edges' }),
]

/**
 * GLSL for SDF layers (needs their u_bevel, u_bevel_aspect, u_profile): the bevel profile at signed distance d (px,
 * < 0 inside) with screen-space gradient g — 0 at the edge rising to 1 a bevel in. Bevel aspect a makes left / right
 * bevels Bevel / √a and top / bottom ones Bevel · √a; an edge with unit normal n gets the width the bevel has across it
 * in that stretched space, √((nx·Wx)² + (ny·Wy)²). 1 everywhere for a flat profile or no bevel (coverage anti-aliases).
 */
export const GLSL_BEVEL = /* glsl */ `
vec2 bevelWidths() { float r = sqrt(max(u_bevel_aspect, 1e-3)); return u_bevel * vec2(1.0 / r, r); }
float bevelAt(float d, vec2 g) {
  if (u_bevel <= 0.0 || u_profile == 0) return 1.0;
  float gg = dot(g, g);
  vec2 n2 = gg > 1e-12 ? g * g / gg : vec2(0.5);
  vec2 W = bevelWidths();
  return profileCurve(u_profile, max(-d, 0.0) / max(sqrt(dot(n2, W * W)), 1e-4));
}
`

export const SHAPING_PARAMS: ParamDef[] = [
  P.float('ofs_x', 'Offset X', 0, -4096, 4096, { softMin: -32, softMax: 32, sliderSpan: 'width', unit: 'px', step: 0.1, group: 'shaping', section: 'Position', hint: 'Shift the whole pattern (wraps on tileable projects)' }),
  P.float('ofs_y', 'Offset Y', 0, -4096, 4096, { softMin: -32, softMax: 32, sliderSpan: 'height', unit: 'px', step: 0.1, group: 'shaping', section: 'Position', hint: 'Shift the whole pattern down' }),
  P.float('dw_amount', 'Domain warp', 0, 0, 256, { softMax: 8, unit: 'px', step: 0.05, group: 'shaping', section: 'Position', hint: 'Displaces the whole generated pattern by smooth noise (after generation): joints wander but keep their width' }),
  P.float('dw_scale', 'Warp scale', 4, 0.25, 128, { softMax: 32, step: 0.01, group: 'shaping', section: 'Position', showIf: (p) => Number(p.dw_amount) > 0, hint: 'Warp features across the texture (rounded when tiling)' }),
  P.bool('sh_invert', 'Invert', false, { group: 'shaping', section: 'Value' }),
  P.float('sh_lo', 'Low', 0, 0, 1, { step: 0.001, group: 'shaping', section: 'Value', join: { with: 'sh_hi', as: 'pair', label: 'Levels' }, hint: 'Low: the value at or below it becomes 0 (raise it to drop the faint parts)' }),
  P.float('sh_hi', 'High', 1, 0, 1, { step: 0.001, group: 'shaping', section: 'Value', hint: 'High: the value at or above it becomes 1 (lower it to push more of the pattern to full)' }),
  P.float('sh_gamma', 'Gamma', 1, 0.05, 20, { softMin: 0.2, softMax: 5, step: 0.01, group: 'shaping', section: 'Value' }),
  P.int('sh_steps', 'Posterize', 0, 0, 64, { softMax: 16, group: 'shaping', section: 'Value', hint: '0 = off' }),
  P.float('sh_cut', 'Cutoff', 0, 0, 1, { step: 0.001, group: 'shaping', section: 'Value', hint: 'Covers only where the shaped value ≥ cutoff (0 = off): sparse flecks from white noise, islands from clouds' }),
  P.float('sh_cut_soft', 'Cutoff softness', 0, 0, 0.5, { step: 0.001, group: 'shaping', section: 'Value', showIf: (p) => Number(p.sh_cut) > 0 }),
]

/**
 * Column / Row spacing of a grid of separate objects (repeat grids, vent slots, tread plate, tabs on cells): the step
 * between neighbours grows (or, below 0, shrinks) by a share of the texture — 1 = a whole width / height more. The grid
 * stays centred; on a tileable texture, instances pushed past an edge come round the other side. repPitch / repGrid
 * (glsl/common.ts) lay it out.
 */
export const spacingParams = (extra: Pick<ParamDef, 'group' | 'showIf'> = {}): ParamDef[] => [
  P.float('col_sp', 'Column spacing', 0, -1, 1, {
    step: 0.001,
    ...extra,
    hint: 'Pushes the columns apart (or, below 0, draws them together) by this share of the texture width: 1 = a whole width more between neighbours. The grid stays centred; when tiling, columns pushed past an edge come round the other side',
  }),
  P.float('row_sp', 'Row spacing', 0, -1, 1, {
    step: 0.001,
    ...extra,
    hint: 'Pushes the rows apart (or, below 0, draws them together) by this share of the texture height: 1 = a whole height more between neighbours. The grid stays centred; when tiling, rows pushed past an edge come round the other side',
  }),
]

const PHASE_HINT = 'Animates the noise: 0 → 1 is one seamless loop (render frames at even steps); it repeats beyond 1'

/** Phase of a noise-driven pattern (LayerDef.noise), in its Pattern card. Every generator has a `phase`. */
export const PHASE_PARAM: ParamDef = P.float('phase', 'Phase', 0, -10000, 10000, { softMin: 0, softMax: 1, step: 0.001, optimize: false, hint: PHASE_HINT })

/** The same for other generators, in Shaping: it moves their domain warp (and a type's own warp or wobble). */
export const WARP_PHASE_PARAM: ParamDef = P.float('phase', 'Warp phase', 0, -10000, 10000, {
  softMin: 0,
  softMax: 1,
  step: 0.001,
  optimize: false,
  group: 'shaping',
  section: 'Position',
  showIf: (p) => Number(p.dw_amount) > 0 || Number(p.warp ?? 0) > 0 || Number(p.wobble ?? 0) > 0,
  hint: 'Animates the domain warp: 0 → 1 is one seamless loop; it repeats beyond 1',
})

export const MASK_PARAMS: ParamDef[] = [
  P.float('opacity', 'Strength', 1, 0, 1, {
    step: 0.001,
    group: 'mask',
    hint: 'How much of this layer shows: it scales everything the layer writes (colour, height, roughness, specular, glow) at once — 1 = full, 0.5 = half way from what was beneath, 0 = no effect. Not the Opacity output, which writes the texture\'s alpha',
  }),
  ...LIMIT_PARAMS,
  ...MASK_WRITE_PARAMS,
  P.enum('m_hmode', 'Limit to', 'none', [
    ['none', 'Anywhere', 'the height doesn\'t limit this layer'],
    ['above', 'Above the level', 'only where the surface stands higher — wear, highlights, dust on the tops'],
    ['below', 'Below the level', 'only where it lies lower — dirt, water, moss in the hollows and joints'],
  ], {
    group: 'mask',
    section: 'Height mask',
    hint: 'Limit this layer by the height of the surface the layers before it built: only above, or only below, a level',
  }),
  P.float('m_hlevel', 'Level', 0.5, -16, 16, {
    softMin: 0,
    softMax: 1,
    step: 0.001,
    group: 'mask',
    section: 'Height mask',
    showIf: (p) => p.m_hmode !== 'none',
    hint: 'The height that divides above from below, in height units (1 = the project\'s Height depth in px; the base starts at its own Height, 0 by default). The viewport\'s Hgt view shows the heights',
  }),
  P.float('m_hsoft', 'Softness', 0.1, 0, 4, {
    softMax: 1,
    step: 0.001,
    group: 'mask',
    section: 'Height mask',
    showIf: (p) => p.m_hmode !== 'none',
    hint: 'How gradually the layer fades in across the level, in height units either side of it: 0 = a hard cut',
  }),
]

export const OUTPUT_PARAMS: ParamDef[] = [
  P.bool('dif_on', 'Diffuse', false, { group: 'diffuse' }),
  source('dif_src', 'diffuse', 'dif_blend', 'Blend'),
  P.enum('dif_blend', 'Blend', 'normal', BLEND_MODES, { group: 'diffuse', hint: 'How the colour mixes with the layers below' }),
  P.float('dif_opacity', 'Opacity', 1, 0, 1, { step: 0.001, group: 'diffuse' }),
  P.gradient('dif_grad', 'Colour ramp', gradient('#2a2622', '#b8ab98'), { group: 'diffuse', hint: 'The source picks a colour along the ramp: 0 at the left, 1 at the right' }),
  P.float('dif_jitter', 'Random jitter', 0, 0, 1, { step: 0.001, group: 'diffuse', hint: 'Shifts the ramp lookup per feature (brick, cell, instance)' }),

  P.bool('op_on', 'Opacity', false, { group: 'alpha' }),
  P.enum('op_mode', 'Mode', 'replace', [['replace', 'Replace'], ['multiply', 'Multiply'], ['union', 'Union (max)'], ['subtract', 'Subtract']], { group: 'alpha' }),

  P.bool('h_on', 'Height', false, { group: 'height' }),
  source('h_src', 'height', 'h_mode'),
  P.enum('h_mode', 'Mode', 'add', HEIGHT_MODES, { group: 'height', hint: 'How the height combines with the surface below' }),
  P.float('h_amount', 'Amount', 0.5, -64, 64, { softMin: 0, softMax: 2, step: 0.001, group: 'height', hint: 'Height at a source of 1 (1.0 = the project’s height depth in px)' }),
  P.float('h_offset', 'Offset', 0, -64, 64, {
    softMin: -1,
    softMax: 1,
    step: 0.001,
    optimize: false,
    group: 'height',
    hint: 'Raises (or, below 0, sinks) the whole height output by this much, in the units of Amount: the height is Offset at a source of 0 and Offset + Amount at 1. Lifts one layer’s relief above another’s without squashing its range. Applies wherever the layer covers',
  }),
  P.float('h_var', 'Per-feature variation', 0, 0, 1, { step: 0.001, group: 'height', hint: 'Each brick / cell / instance gets its own share of the amount (1 = anywhere from 0 to full): some barely raised, others bold. No effect on patterns without features (smooth noise, clouds)' }),

  P.bool('r_on', 'Roughness', false, { group: 'roughness' }),
  source('r_src', 'roughness', 'r_mode'),
  P.enum('r_mode', 'Mode', 'replace', LEVEL_MODES, { group: 'roughness' }),
  P.float('r_a', 'At 0', 0.35, 0, 1, { step: 0.001, ...ramp('r_b', 'roughness'), hint: 'Roughness where the source is 0 (left) and 1 (right): 0 glossy … 1 matte' }),
  P.float('r_b', 'At 1', 0.85, 0, 1, { step: 0.001, group: 'roughness' }),
  P.float('r_opacity', 'Opacity', 1, 0, 1, { step: 0.001, group: 'roughness' }),

  P.bool('s_on', 'Specular', false, { group: 'specular' }),
  source('s_src', 'specular', 's_mode'),
  P.enum('s_mode', 'Mode', 'replace', LEVEL_MODES, { group: 'specular' }),
  P.float('s_a', 'At 0', 0, 0, 1, { step: 0.001, ...ramp('s_b', 'specular'), hint: 'Specular level where the source is 0 (left) and 1 (right); 0.5 ≈ 4 % reflectance at scale 1' }),
  P.float('s_b', 'At 1', 0.6, 0, 1, { step: 0.001, group: 'specular' }),
  P.float('s_opacity', 'Opacity', 1, 0, 1, { step: 0.001, group: 'specular' }),

  P.bool('e_on', 'Emissive', false, { group: 'emissive' }),
  source('e_src', 'emissive', 'e_mode'),
  P.enum('e_mode', 'Mode', 'add', [['add', 'Add'], ['replace', 'Replace'], ['max', 'Max']], { group: 'emissive' }),
  P.color('e_color', 'Colour', '#ff9019', { group: 'emissive' }),
  P.float('e_intensity', 'Intensity', 2, 0, 1000, { softMax: 20, step: 0.01, group: 'emissive', hint: 'Emitted light at a source of 1 (HDR: above 1 glows past white)' }),
]

export const GENERATOR_GROUPS: GroupDef[] = [
  { id: 'params', label: 'Pattern' },
  // Shaping: the shape's edge (bevel, profile, anti-alias), where the pattern sits (offset, warp) and its value (levels,
  // gamma, posterize, invert, cutoff) — the chain that makes the layer's value.
  { id: 'shaping', label: 'Shaping' },
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

/** GLSL for the generator wrapper's use of the common params (declared automatically from the defs above). */
export const GLSL_GENERATOR_MAIN = (sdf: boolean | 'mask') => /* glsl */ `

float shapeValue(float v) {
  v = clamp((v - u_sh_lo) / max(u_sh_hi - u_sh_lo, 1e-5), 0.0, 1.0);
  if (u_sh_gamma != 1.0) v = pow(v, u_sh_gamma);
  if (u_sh_steps > 1) { float n = float(u_sh_steps); v = min(floor(v * n), n - 1.0) / (n - 1.0); }
  return u_sh_invert ? 1.0 - v : v;
}

// shapeV: inside the layer's shape (Source › Shape), 1 for layers without one.
float srcValue(int src, float value, float rnd, float shapeV) { return src == 1 ? 1.0 : src == 2 ? rnd : src == 3 ? shapeV : value; }

// A mask texel (distance, feature random, feature flag) after this layer's write: c is its own distance s combined with
// the mask's by op; the feature comes from whichever side c follows (the earlier contents where this layer cuts).
// fid < 0: no features here.
vec4 maskTexel(int op, float c, float s, float fid, vec4 prev) {
  bool fresh = op <= 1 || (op != 3 && op != 6 && abs(c - s) <= abs(c - prev.x));
  return fresh ? vec4(c, max(fid, 0.0), fid >= 0.0 ? 1.0 : 0.0, 0.0) : vec4(c, prev.yzw);
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(tAlbedo, ip, 0);
  vec4 S = texelFetch(tSurface, ip, 0);
  vec4 E = texelFetch(tEmissive, ip, 0);
  // The mask before this layer: the one it writes, or the Shape mask. Pixels it doesn't write keep it.
  vec4 maskPrev = texelFetch(tMaskIn, ip, 0);
  vec4 maskOut = maskPrev;
  float prevReg = maskPrev.x;
  gPhase = u_phase;

  vec2 pp = gl_FragCoord.xy - vec2(u_ofs_x, -u_ofs_y);
  if (u_dw_amount > 0.0) {
    // Domain warp of the whole pattern: neighbouring features move together, so gaps keep their width.
    vec2 wc = cellsFor(u_dw_scale, 1.0);
    pp += warpOffset(gl_FragCoord.xy / uRes * wc, uTile ? ivec2(wc) : NO_PERIOD, uSeed + 409.0) * 2.0 * u_dw_amount;
  }
  GenOut g = gen(pp);
  float value = g.value;
  float cov = g.mask;
  float shapeV = 1.0;
${sdf === true ? /* glsl */ `
  // Writing its shape (Mask › Write to), the layer combines it with the mask by the Mode (index + 1 = sdfCombine op) and
  // draws the combined shape. The combined distance and its screen-space gradient (Bevel aspect) are taken before
  // branching: derivatives need uniform control flow.
  int op = uMaskKind == 1 ? u_mk_op + 1 : 0;
  float d = op == 0 ? g.sdf : sdfCombine(op, prevReg, g.sdf, u_mk_smooth);
  vec2 dGrad = vec2(dFdx(d), dFdy(d));
  if (g.sdf > NO_SDF) {
    if (op != 0) {
      maskOut = maskTexel(op, d, g.sdf, g.fid, maskPrev);
      // Feather stores a soft ramp across the outline instead of the distance (its coverage reads back the same way).
      if (u_mk_feather > 0.0) maskOut.x = clamp(d / u_mk_feather, -0.5, 0.5);
    }
    shapeV = coverage(d, u_aa);
    // The bevel: from the generator's own bevel distance (GenOut.bdist) while the drawn shape is its own (not combined
    // with the mask), else from the combined distance with the aspect taken from its direction.
    float bev = g.bdist > NO_SDF && op <= 1 ? ((u_bevel > 0.0 && u_profile != 0) ? profileCurve(u_profile, max(-g.bdist, 0.0) / u_bevel) : 1.0)
                                            : bevelAt(d, dGrad);
    if (g.own == 1) {
      // genOutOwn: the generator painted its own value and coverage; the shape only goes to the mask.
    } else if (g.own == 2) {
      // genOutShaded: the generator's pattern × the bevel of the combined shape (so another mode — Intersection with a
      // chipped Shape mask — bevels round it too); the coverage stays the generator's.
      float e = bev * coverage(d, u_aa);
      value *= e;
      if (g.hval >= 0.0) g.hval *= e;
    } else {
      cov *= coverage(d, u_aa);
      // The coverage now carries the shape's anti-aliasing, so Source › Shape is 1 wherever the layer paints — taking
      // the coverage twice put the ramp's middle (often its darkest) on every edge pixel, a dark 1 px outline.
      shapeV = 1.0;
      // Flat (or zero-width) bevels output 1 and let coverage do the anti-aliasing, so edges ramp
      // symmetrically across the boundary; profiled bevels rise from 0 at the edge.
      value = bev;
    }
  }
` : ''}${sdf === 'mask' ? /* glsl */ `
  if (g.sdf > NO_SDF) {
    // A shape for the mask only: the generator shapes its own value and coverage around it.
    int op = uMaskKind == 1 ? u_mk_op + 1 : 0;
    float d = op == 0 ? g.sdf : sdfCombine(op, prevReg, g.sdf, u_mk_smooth);
    if (op != 0) {
      maskOut = maskTexel(op, d, g.sdf, g.fid, maskPrev);
      // Feather stores a soft ramp across the outline instead of the distance (its coverage reads back the same way).
      if (u_mk_feather > 0.0) maskOut.x = clamp(d / u_mk_feather, -0.5, 0.5);
    }
    shapeV = clamp(0.5 - d, 0.0, 1.0);
  }
` : ''}
  value = shapeValue(value);
  // A separate value for Height (GenOut.hval), shaped the same way.
  float hval = g.hval < 0.0 ? value : shapeValue(g.hval);
  float cutK = 1.0;
  if (u_sh_cut > 0.0) cutK = u_sh_cut_soft > 0.0 ? smoothstep(u_sh_cut - u_sh_cut_soft, u_sh_cut + u_sh_cut_soft, value) : step(u_sh_cut, value);
  cov *= cutK;

  // Everything else that limits the layer: opacity, Limit to, the height mask.
  float k = u_opacity * limitAt(ip);
  if (u_m_hmode != 0) {
    float s = max(u_m_hsoft, 1e-4);
    float hm = smoothstep(u_m_hlevel - s, u_m_hlevel + s, S.r);
    k *= u_m_hmode == 1 ? hm : 1.0 - hm;
  }
  float m = cov * k;
  // Writing its coverage (layers without a shape): as a distance-like value that reads back as the coverage.
  if (uMaskKind == 2) {
    int cop = u_mk_op + 1;
    float s = 0.5 - m;
    maskOut = maskTexel(cop, cop <= 1 ? s : sdfCombine(cop, prevReg, s, u_mk_smooth), s, g.fid, maskPrev);
  }

  if (u_dif_on) {
    float v = srcValue(u_dif_src, value, g.rnd, shapeV);
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
    // A height profile of the generator's own (signed, genOutHeight) stands in for the value and carries its own extent:
    // it applies wherever it is non-zero, limited by the clips and opacity but not by the coverage.
    bool own = u_h_src == 0 && g.height > NO_SDF;
    // Per-feature amplitude from a hash decorrelated from the colour random; Offset shifts the whole output.
    float v = (own ? g.height : srcValue(u_h_src, hval, g.rnd, shapeV)) * u_h_amount * (1.0 - u_h_var * g.feat * fract(g.rnd * 61.37 + 0.123)) + u_h_offset;
    float h = S.r;
    float nh = u_h_mode == 0 ? h + v : u_h_mode == 1 ? h - v : u_h_mode == 2 ? max(h, v)
             : u_h_mode == 3 ? min(h, v) : u_h_mode == 4 ? v : h * v;
    S.r = mix(h, nh, own ? (g.height != 0.0 ? k : 0.0) : m);
  }
  if (u_r_on) {
    float v = srcValue(u_r_src, value, g.rnd, shapeV);
    float r = mix(u_r_a, u_r_b, v);
    float o = S.g;
    float nr = u_r_mode == 0 ? r : u_r_mode == 1 ? o * r : u_r_mode == 2 ? o + r : u_r_mode == 3 ? min(o, r) : max(o, r);
    S.g = clamp(mix(o, nr, m * u_r_opacity), 0.0, 1.0);
  }
  if (u_s_on) {
    float v = srcValue(u_s_src, value, g.rnd, shapeV);
    float sp = mix(u_s_a, u_s_b, v);
    float o = E.a;
    float ns = u_s_mode == 0 ? sp : u_s_mode == 1 ? o * sp : u_s_mode == 2 ? o + sp : u_s_mode == 3 ? min(o, sp) : max(o, sp);
    E.a = clamp(mix(o, ns, m * u_s_opacity), 0.0, 1.0);
  }
  if (u_e_on) {
    float v = srcValue(u_e_src, value, g.rnd, shapeV);
    vec3 e = u_e_color * u_e_intensity * v;
    vec3 ne = u_e_mode == 0 ? E.rgb + e : u_e_mode == 1 ? e : max(E.rgb, e);
    E.rgb = mix(E.rgb, ne, m);
  }

  oAlbedo = A;
  oSurface = S;
  oEmissive = E;
  oMask = maskOut;
}
`
