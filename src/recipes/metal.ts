// Metal and weathering recipes (FR7.7): hammered copper, brushed metal, and water + rust stains from
// shared sources — scattered, or starting at the ledges of the relief beneath (rivets, lips).

import { P, type ParamValues } from '@/core/params'
import { HEIGHT_ONLY, L, across, gradient, lerp, num, r2, shade, streaks } from './parts'
import type { RecipeDef, RecipeLayer } from './types'

export const hammeredMetal: RecipeDef = {
  id: 'hammered-metal',
  label: 'Hammered metal',
  description: 'Interlocking radial arcs of hammer dents, toned in the dents, with an optional patina.',
  groups: [
    { id: 'dents', label: 'Dents' },
    { id: 'colour', label: 'Colour' },
  ],
  params: [
    P.float('spacing', 'Dent size', 7, 2, 64, { group: 'dents', softMax: 24, unit: 'px' }),
    P.int('centres', 'Centres', 2, 1, 16, { group: 'dents', hint: 'Hammering centres: arcs of dents radiate from each and interlock where they meet' }),
    P.float('irregular', 'Irregularity', 0.7, 0, 1, { group: 'dents', step: 0.01 }),
    P.float('depth', 'Depth', 0.35, 0, 1, { group: 'dents', step: 0.01 }),
    P.float('shape', 'Dent shape', 4, 1, 8, { group: 'dents', step: 0.1, hint: 'Low = soft dimples, high = flat-bottomed dents with sharp rims' }),
    P.float('glints', 'Glints', 0.3, 0, 1, { group: 'dents', step: 0.01 }),
    P.gradient('metal', 'Metal colours', gradient('#2b170c', '#3a1e10', '#4a2616', '#5a2e1a'), { group: 'colour' }),
    P.float('tone', 'Dent tone', 0.6, 0, 1, { group: 'colour', step: 0.01, hint: 'Darkening inside the dents' }),
    P.float('patina', 'Patina', 0.4, 0, 1, { group: 'colour', step: 0.01 }),
    P.color('patina_colour', 'Patina colour', '#2f4034', { group: 'colour' }),
    P.float('speckle', 'Speckle', 0.5, 0, 1, { group: 'colour', step: 0.01 }),
    P.seed('seed', 'Seed', 3, { group: 'dents' }),
  ],
  render: { ao: 0.5, aoRadius: 3, specularTint: 1 },
  build(m, ctx) {
    const seed = num(m.seed, 3)
    const hammer = {
      centres: Math.max(1, Math.round(num(m.centres, 2))), weight_var: 0.5, ring: r2(num(m.spacing, 7) * 0.85), spacing: num(m.spacing, 7),
      jitter: num(m.irregular, 0.7), size: 1.1, shape: num(m.shape, 4), seed,
    }
    const glint = r2(num(m.glints, 0.3))
    const patina = num(m.patina, 0.4)
    const toneDark = Math.round(255 * (1 - 0.3 * num(m.tone, 0.6)))
    const toneHex = `#${toneDark.toString(16).padStart(2, '0').repeat(3)}`
    const out: RecipeLayer[] = [
      {
        role: 'hammer', stack: 'relief',
        layer: L('hammered', 'Hammer', { ...hammer, h_on: true, h_amount: r2(num(m.depth, 0.35)), dif_on: false, r_on: true, r_mode: 'replace', r_src: 'flat', r_a: 0.55, r_b: 0.55, s_on: true, s_mode: 'replace', s_src: 'flat', s_a: glint, s_b: glint }),
      },
      { role: 'soften', stack: 'relief', layer: L('blur', 'Soften', { radius: 0.5, ...HEIGHT_ONLY }) },
      { role: 'metal', stack: 'paint', layer: L('noise', 'Metal', { noise: 'value', fractal: 'fbm', scale: across(ctx, 6), octaves: 4, seed: seed + 2, h_on: false, dif_on: true, dif_grad: m.metal ?? gradient('#2b170c', '#5a2e1a') }) },
      { role: 'tone', stack: 'paint', layer: L('hammered', 'Dent tone', { ...hammer, h_on: false, dif_on: true, dif_blend: 'multiply', dif_grad: gradient('#ffffff', toneHex) }, num(m.tone, 0.6) > 0) },
      {
        role: 'patina', stack: 'paint',
        layer: L('noise', 'Patina', { noise: 'perlin', fractal: 'fbm', scale: 4, octaves: 4, seed: seed + 3, sh_cut: r2(lerp(0.9, 0.4, patina)), sh_cut_soft: 0.1, h_on: false, dif_on: true, dif_opacity: 0.9, dif_grad: shade(String(m.patina_colour ?? '#2f4034'), 0.7) }, patina > 0),
      },
      { role: 'speckle', stack: 'paint', layer: L('noise', 'Speckle', { noise: 'white', seed: seed + 4, h_on: false, dif_on: true, dif_blend: 'overlay', dif_opacity: r2(num(m.speckle, 0.5) * 0.6), dif_grad: gradient('#000000', '#ffffff') }, num(m.speckle, 0.5) > 0) },
      { role: 'grime', stack: 'paint', layer: L('cavity', 'Dents', { radius: 2, threshold: 0.03, sensitivity: 0.8, wear_amount: 0.4, wear_color: '#674e34', dirt_amount: 0.5, dirt_color: '#1c1e18', noise_scale: 8 }) },
    ]
    return out
  },
}

export const brushedMetal: RecipeDef = {
  id: 'brushed-metal',
  label: 'Brushed metal',
  description: 'Long fine streaks in the metal (colour only, never pixel height) over a soft mottle, with shallow dents that catch the light.',
  groups: [
    { id: 'streaks', label: 'Streaks' },
    { id: 'colour', label: 'Colour' },
  ],
  params: [
    P.enum('direction', 'Direction', 'vertical', [['vertical', 'Vertical'], ['horizontal', 'Horizontal']], { group: 'streaks' }),
    P.float('length', 'Streak length', 40, 4, 512, { group: 'streaks', softMax: 128, unit: 'px' }),
    P.float('width', 'Streak width', 2, 2, 16, { group: 'streaks', unit: 'px' }),
    P.float('contrast', 'Contrast', 0.6, 0, 1, { group: 'streaks', step: 0.01 }),
    P.float('dents', 'Dents', 0.3, 0, 1, { group: 'streaks', step: 0.01, hint: 'Shallow dents that make the glints come and go' }),
    P.gradient('metal', 'Metal colours', gradient('#4f3c30', '#695243', '#806656'), { group: 'colour' }),
    P.float('mottle', 'Mottle', 0.5, 0, 1, { group: 'colour', step: 0.01 }),
    P.seed('seed', 'Seed', 7, { group: 'streaks' }),
  ],
  render: { ao: 0.5, aoRadius: 3, specularTint: 0.85 },
  build(m, ctx) {
    const seed = num(m.seed, 7)
    const c = num(m.contrast, 0.6)
    const metal = m.metal ?? gradient('#4f3c30', '#806656')
    return [
      {
        role: 'dents', stack: 'relief',
        layer: L('noise', 'Dents', { noise: 'perlin', fractal: 'fbm', scale: across(ctx, 10), octaves: 2, seed: seed + 25, h_on: true, h_amount: r2(0.3 * num(m.dents, 0.3)), dif_on: false, s_on: true, s_mode: 'multiply', s_src: 'value', s_a: 0.4, s_b: 1 }, num(m.dents, 0.3) > 0),
      },
      { role: 'mottle', stack: 'paint', layer: L('noise', 'Mottle', { noise: 'value', fractal: 'fbm', scale: across(ctx, 8), octaves: 4, seed: seed + 1, h_on: false, dif_on: true, dif_opacity: r2(num(m.mottle, 0.5)), dif_grad: metal }) },
      {
        role: 'streaks', stack: 'paint',
        layer: L('noise', 'Brushed', {
          noise: 'value', fractal: 'fbm', ...streaks(ctx, m.direction !== 'horizontal', num(m.length, 40), num(m.width, 2)), octaves: 2, gain: 0.55, seed,
          sh_lo: r2(0.5 - 0.3 * c), sh_hi: r2(0.5 + 0.3 * c), h_on: false, dif_on: true, dif_opacity: 0.8, dif_grad: metal,
        }),
      },
    ]
  },
}

export const stains: RecipeDef = {
  id: 'stains',
  label: 'Water & rust stains',
  description: 'Water stains darkening what is beneath, rust trails where they are strongest (same sources), optional paint blisters; sources scattered or on the ledges of the relief.',
  groups: [
    { id: 'sources', label: 'Sources' },
    { id: 'colour', label: 'Colour' },
  ],
  params: [
    P.bool('ledges', 'Start at ledges', false, { group: 'sources', hint: 'Drips start only below raised features (rivets, lips) — every ledge drips, taller ones longer' }),
    P.float('density', 'Density', 0.25, 0, 1, { group: 'sources', step: 0.01 }),
    P.float('length', 'Length', 40, 2, 512, { group: 'sources', softMax: 128, unit: 'px' }),
    P.float('width', 'Width', 3, 0.5, 64, { group: 'sources', unit: 'px', softMax: 16 }),
    P.enum('style', 'Style', 'auto', [
      ['auto', 'Auto', 'pixel streaks below 128 px, detailed runnels from 128 px'],
      ['streak', 'Streaks (pixel)', 'narrow trails, crisp at 1 px'],
      ['runnels', 'Runnels (detailed)', 'washes of water with tide-marked edges and thin runnels that split, merge and end in beads'],
    ], { group: 'sources' }),
    P.float('water', 'Water darkening', 0.6, 0, 1, { group: 'colour', step: 0.01 }),
    P.float('rust', 'Rust', 0.5, 0, 1, { group: 'colour', step: 0.01, hint: 'Rust shows where the stain is strongest' }),
    P.color('rust_colour', 'Rust colour', '#a84a22', { group: 'colour' }),
    P.float('blisters', 'Blisters', 0, 0, 1, { group: 'colour', step: 0.01, hint: 'Paint bubbling up at the sources' }),
    P.seed('seed', 'Seed', 5, { group: 'sources' }),
  ],
  build(m, ctx) {
    const ledges = m.ledges === true
    const len = num(m.length, 40)
    const grid: ParamValues = ledges
      ? { cols: Math.ceil(ctx.width / 3), rows: Math.ceil(ctx.height / 3), density: r2(lerp(0.5, 1, num(m.density, 0.25))), relief: 1, ledge: 0.15, ledge_reach: 2, ledge_soft: 0.15, relief_len: 1 }
      : { cols: Math.max(4, Math.round(ctx.width / 5)), rows: Math.max(2, Math.round(ctx.height / 9)), density: num(m.density, 0.25), relief: 0 }
    const src = { ...grid, len_min: r2(len * 0.2), len_max: len, wobble: 0.3, head: 0, seed: num(m.seed, 5) }
    // Runnels (detailed): a wash around thin runnels, sized from Width; rust follows the runnels (the strongest parts).
    const style = String(m.style ?? 'auto')
    const runnels = style === 'runnels' || (style === 'auto' && Math.max(ctx.width, ctx.height) >= 128)
    const w = num(m.width, 3)
    const flow = { style: 'runnels', wobble: r2(w), wander: r2(Math.max(8, len * 0.6)), hard: false }
    // Wide stains need a coarser source grid than 1 px streaks (scattered sources only; ledges keep theirs).
    const cells: ParamValues = runnels && !ledges ? { cols: Math.max(2, Math.round(ctx.width / (w * 4))), rows: Math.max(1, Math.round(ctx.height / Math.max(8, len * 0.6))) } : {}
    const waterFlow: ParamValues = runnels ? { ...flow, ...cells, width: r2(w * 3), runnel_width: r2(Math.max(1, w * 0.5)), runnels: 4, sheet: 0.4, edge: 0.55, breakup: 0.35, beads: 0.3, taper: -0.2 } : {}
    const rustFlow: ParamValues = runnels ? { ...flow, ...cells, width: r2(w * 1.6), runnel_width: r2(Math.max(1, w * 0.4)), runnels: 2, fade: 0.3, sheet: 0.15, edge: 0.3, breakup: 0.5, beads: 0.2, taper: 0.1 } : {}
    const water = num(m.water, 0.6)
    const rust = num(m.rust, 0.5)
    const rc = String(m.rust_colour ?? '#a84a22')
    const wv = Math.round(255 * (1 - 0.65 * water))
    return [
      { role: 'water', stack: 'paint', layer: L('drips', 'Water stain', { output: 'stain', ...src, width: num(m.width, 3), width_var: 0.5, start: 0.7, fade: 0.9, hard: false, ...waterFlow, h_on: false, dif_on: true, dif_blend: 'multiply', dif_grad: gradient('#ffffff', `#${[wv, Math.round(wv * 0.85), Math.round(wv * 0.7)].map((v) => v.toString(16).padStart(2, '0')).join('')}`) }, water > 0) },
      { role: 'rust', stack: 'paint', layer: L('drips', 'Rust trails', { output: 'stain', ...src, width: r2(num(m.width, 3) * 0.45), width_var: 0.6, start: 1, fade: 1, hard: true, ...rustFlow, sh_cut: r2(lerp(0.9, 0.6, rust)), sh_cut_soft: 0.05, h_on: false, dif_on: true, dif_grad: shade(rc, 0.7) }, rust > 0) },
      { role: 'blisters', stack: 'paint', layer: L('drips', 'Blisters', { output: 'source', ...src, ...cells, head: r2(0.4 + 1.2 * num(m.blisters, 0)), hard: true, h_on: true, h_amount: 0.6, dif_on: true, dif_src: 'value', dif_grad: shade(rc, 0.55) }, num(m.blisters, 0) > 0) },
    ]
  },
}
