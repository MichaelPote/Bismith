// Natural-surface lumps tuned against references (FR8.6): liquids (lava, water, slime, nukage), wood and marble.
// Colour is carried by the generators; relief stays minimal.

import { P, type ParamValues } from '@/core/params'
import { L, gradient, num, r2 } from './parts'
import type { RecipeDef } from './types'

export const liquid: RecipeDef = {
  id: 'liquid',
  label: 'Liquid',
  fit: 'tones',
  description: 'Lava, water, slime or nukage: light refracted through the wavy surface gathers into bright filaments around dark cells (or a stylised caustic net / blobs).',
  icon: 'pattern',
  groups: [
    { id: 'flow', label: 'Flow' },
    { id: 'colour', label: 'Colour' },
  ],
  params: [
    P.enum('style', 'Style', 'refraction', [['refraction', 'Refracted light'], ['net', 'Caustic net'], ['blobs', 'Blobs']], { group: 'flow' }),
    P.float('scale', 'Cells across', 4, 0.5, 32, { group: 'flow', step: 0.01 }),
    P.float('strength', 'Refraction', 7, 0, 24, { group: 'flow', step: 0.05, unit: 'px', hint: 'Refracted light: sharper filaments and darker cells as it rises', showIf: (p) => (p.style ?? 'refraction') === 'refraction' }),
    P.float('softness', 'Filament width', 0.45, 0.3, 6, { group: 'flow', step: 0.05, unit: 'px', hint: 'Width (blur) of the bright filaments; the halo glows around them', showIf: (p) => (p.style ?? 'refraction') === 'refraction' }),
    P.float('exposure', 'Exposure', 0.4, 0.1, 6, { group: 'flow', step: 0.01, showIf: (p) => (p.style ?? 'refraction') === 'refraction' }),
    P.float('contrast', 'Contrast', 2.2, 0.5, 4, { group: 'flow', step: 0.01, hint: 'Darker cells, filaments as bright', showIf: (p) => (p.style ?? 'refraction') === 'refraction' }),
    P.int('waves', 'Waves', 11, 2, 16, { group: 'flow', showIf: (p) => (p.style ?? 'refraction') === 'refraction' }),
    P.float('meander', 'Meander', 0.7, 0, 1, { group: 'flow', step: 0.01, hint: 'Curved walls and cells of varied size; high values streak', showIf: (p) => (p.style ?? 'refraction') === 'refraction' }),
    P.float('halo', 'Halo', 0.5, 0, 1, { group: 'flow', step: 0.01, hint: 'Soft glow around the filaments, fading into the cells', showIf: (p) => (p.style ?? 'refraction') === 'refraction' }),
    P.float('rim', 'Rim width', 1.8, 0, 6, { group: 'flow', step: 0.01, showIf: (p) => p.style === 'net' || p.style === 'blobs' }),
    P.float('warp', 'Swirl', 0.3, 0, 2, { group: 'flow', step: 0.01, showIf: (p) => p.style === 'net' || p.style === 'blobs' }),
    P.float('variety', 'Size variety', 0.9, 0, 1, { group: 'flow', step: 0.01 }),
    P.float('relief', 'Surface relief', 0, 0, 1, { group: 'flow', step: 0.01, hint: 'Lit waves on the surface — off by default: shading from the key light streaks the caustics along its direction' }),
    P.gradient('colours', 'Colours', { stops: [{ pos: 0, color: '#3a0400' }, { pos: 0.3, color: '#901800' }, { pos: 0.55, color: '#e05010' }, { pos: 0.85, color: '#ff9020' }, { pos: 1, color: '#ffd040' }] }, {
      group: 'colour', hint: 'Dark (little light) → bright (gathered light). Seed it from the reference palette',
    }),
    P.float('glow', 'Glow', 0.12, 0, 4, { group: 'colour', step: 0.01, hint: 'Emission on top of the colour — a hint of glow; high values clip to flat colour' }),
    P.float('highlight', 'Highlights', 0.6, 0, 1, { group: 'colour', step: 0.01, hint: 'Brightest cores of the filaments' }),
    P.color('highlight_colour', 'Highlight colour', '#f0f060', { group: 'colour' }),
    P.seed('seed', 'Seed', 81, { group: 'flow' }),
  ],
  build(m) {
    const style = String(m.style ?? 'refraction')
    const refr = style === 'refraction'
    const type = refr ? 'causticlight' : 'caustics'
    const c: ParamValues = refr
      ? {
          output: 'light', scale: num(m.scale, 4), waves: Math.round(num(m.waves, 11)), spread: num(m.variety, 0.9), strength: num(m.strength, 7), softness: num(m.softness, 0.45),
          exposure: num(m.exposure, 0.4), contrast: num(m.contrast, 2.2), octave2: 0.4, harmonic: 1, meander: num(m.meander, 0.7), halo: num(m.halo, 0.5), halo_size: 3, seed: num(m.seed, 81),
        }
      : { mode: style, scale: num(m.scale, 4), jitter: 0.85, size_var: num(m.variety, 0.9), round: 0.8, warp: num(m.warp, 0.3), warp_scale: 1, rim: num(m.rim, 1.8), rim_soft: 1.1, glow: 1, glow_amount: 0.65, falloff: 0.7, octave2: 0, seed: num(m.seed, 81) }
    const colours = m.colours ?? gradient('#3a0000', '#ffd040')
    const top = (colours as { stops: { color: string }[] }).stops.at(-1)?.color ?? '#ffd040'
    const hl = String(m.highlight_colour ?? '#f0f060')
    return [
      // Relief: the surface itself (refraction) or the caustic pattern, barely raised; glints on the swells.
      {
        role: 'relief', stack: 'relief',
        layer: L(type, 'Surface', { ...c, ...(refr ? { output: 'surface' } : {}), h_on: true, h_amount: r2(0.12 * num(m.relief, 0)), dif_on: false, s_on: true, s_mode: 'replace', s_src: 'value', s_a: 0.2, s_b: 0.6 }, num(m.relief, 0) > 0),
      },
      { role: 'colour', stack: 'paint', layer: L(type, 'Liquid', { ...c, h_on: false, dif_on: true, dif_src: 'value', dif_grad: colours, e_on: num(m.glow, 0.12) > 0, e_src: 'value', e_color: top, e_intensity: r2(num(m.glow, 0.12)) }) },
      {
        // The same light (tied), only its brightest part, lightened to the highlight colour — never past it.
        role: 'highlights', stack: 'paint',
        layer: L(type, 'Highlights', {
          ...c, sh_lo: 0.75, sh_hi: 1, sh_gamma: 1.3, h_on: false, dif_on: true, dif_src: 'value', dif_blend: 'lighten', dif_opacity: r2(num(m.highlight, 0.6)),
          dif_grad: gradient('#000000', hl), e_on: num(m.glow, 0.12) > 0, e_src: 'value', e_color: hl, e_intensity: r2(0.5 * num(m.glow, 0.12)),
        }, num(m.highlight, 0.6) > 0),
      },
    ]
  },
}

export const wood: RecipeDef = {
  id: 'wood',
  label: 'Wood',
  description: 'Boards or a single slab: grain, growth rings, figure and knots, with board gaps and staggered joints.',
  icon: 'pattern',
  groups: [
    { id: 'boards', label: 'Boards' },
    { id: 'grain', label: 'Grain' },
    { id: 'colour', label: 'Colour' },
  ],
  params: [
    P.enum('direction', 'Direction', 'horizontal', [['horizontal', 'Horizontal'], ['vertical', 'Vertical']], { group: 'boards' }),
    P.bool('planks', 'Boards', true, { group: 'boards', hint: 'Off = one continuous slab' }),
    P.int('count', 'Boards across', 4, 1, 32, { group: 'boards', softMax: 12 }),
    P.float('gap', 'Gap', 1, 0, 4, { group: 'boards', unit: 'px', step: 0.5 }),
    P.int('joints', 'End joints', 1, 0, 8, { group: 'boards' }),
    P.float('grain_px', 'Grain size', 1, 0.5, 16, { group: 'grain', unit: 'px', step: 0.1 }),
    P.float('rings', 'Growth rings', 0.15, 0, 1, { group: 'grain', step: 0.01 }),
    P.float('streaks', 'Streaks', 0.5, 0, 1, { group: 'grain', step: 0.01, hint: 'Fine dark / light streaks along the grain' }),
    P.float('figure', 'Figure', 0.25, 0, 1, { group: 'grain', step: 0.01 }),
    P.float('knots', 'Knots', 0.15, 0, 1, { group: 'grain', step: 0.01 }),
    P.gradient('colours', 'Wood colours', gradient('#2a1a0e', '#4a3020', '#6a4a30'), { group: 'colour' }),
    P.float('variety', 'Per-board colour', 0.2, 0, 1, { group: 'colour', step: 0.01 }),
    P.seed('seed', 'Seed', 91, { group: 'boards' }),
  ],
  render: { ao: 0.6, aoRadius: 2 },
  build(m) {
    const w = {
      planks: m.planks !== false, direction: m.direction ?? 'horizontal', count: Math.max(1, Math.round(num(m.count, 4))), gap: num(m.gap, 1), joints: Math.round(num(m.joints, 1)), stagger: 0.5, joint_rand: 0.6,
      grain_px: num(m.grain_px, 1), grain_stretch: 40, fine: 0.9, rings: num(m.rings, 0.15), ring_px: 4, ring_line: 0.4, figure: num(m.figure, 0.25), ring_stretch: 6, ring_warp: 0.5, knots: num(m.knots, 0.15), knot_size: 3, aa: false, seed: num(m.seed, 91),
    }
    return [
      { role: 'relief', stack: 'relief', layer: L('wood', 'Board relief', { ...w, output: 'shape', bevel: 0.75, profile: 'custom', sdf_op: 'replace', h_on: true, h_amount: 0.2, dif_on: false }, m.planks !== false) },
      { role: 'grain-relief', stack: 'relief', layer: L('wood', 'Grain relief', { ...w, output: 'grain', sdf_op: 'none', h_on: true, h_amount: 0.06, dif_on: false, s_on: true, s_mode: 'multiply', s_src: 'value', s_a: 0.4, s_b: 1 }) },
      { role: 'wood', stack: 'paint', layer: L('wood', 'Wood', { ...w, output: 'wood', sdf_op: 'none', h_on: false, dif_on: true, dif_grad: m.colours ?? gradient('#2a1a0e', '#6a4a30'), dif_jitter: r2(num(m.variety, 0.2)) }) },
      {
        role: 'streaks', stack: 'paint',
        layer: L('noise', 'Streaks', {
          noise: 'value', fractal: 'fbm', octaves: 3, seed: num(m.seed, 91) + 1, ...(m.direction === 'vertical' ? { scale: 1.5, stretch: 0.03 } : { scale: 48, stretch: 30 }),
          sh_lo: 0.25, sh_hi: 0.75, h_on: false, dif_on: true, dif_blend: 'overlay', dif_opacity: r2(Math.min(1, 1.2 * num(m.streaks, 0.5))), dif_grad: gradient('#000000', '#ffffff'),
        }, num(m.streaks, 0.5) > 0),
      },
    ]
  },
}

export const marble: RecipeDef = {
  id: 'marble',
  label: 'Marble',
  description: 'Veined stone: streaks, a vein network or cells over clouded colour; optionally cut into tiles.',
  icon: 'pattern',
  groups: [
    { id: 'veins', label: 'Veins' },
    { id: 'colour', label: 'Colour' },
  ],
  params: [
    P.enum('style', 'Style', 'network', [['streaks', 'Streaks'], ['network', 'Network'], ['cells', 'Cells']], { group: 'veins' }),
    P.float('veins', 'Veins', 3, 0.5, 16, { group: 'veins', step: 0.1 }),
    P.float('width', 'Vein width', 1, 0.25, 6, { group: 'veins', unit: 'px', step: 0.05 }),
    P.float('warp', 'Warp', 0.5, 0, 2, { group: 'veins', step: 0.01 }),
    P.float('cloud', 'Clouding', 0.4, 0, 1, { group: 'veins', step: 0.01 }),
    P.int('tiles', 'Tiles across', 0, 0, 16, { group: 'veins', hint: '0 = one slab' }),
    P.gradient('colours', 'Stone colours', gradient('#0a120a', '#1a2a18', '#2a3a26'), { group: 'colour' }),
    P.color('vein', 'Vein colour', '#4a6a40', { group: 'colour' }),
    P.seed('seed', 'Seed', 101, { group: 'veins' }),
  ],
  build(m, ctx) {
    const tiles = Math.max(0, Math.round(num(m.tiles, 0)))
    const mb = { style: m.style ?? 'network', veins: num(m.veins, 3), angle: 30, stretch: 1, levels: 1, warp: num(m.warp, 0.5), warp_scale: 3, detail: 5, width: num(m.width, 1), soft: 1, width_var: 0.5, breakup: 0.3, fine: 0.45, fine_scale: 3, tiles, tile_rot: 90, cloud: num(m.cloud, 0.4), seed: num(m.seed, 101) }
    const base = (m.colours ?? gradient('#0a120a', '#2a3a26')) as { stops: { pos: number; color: string }[] }
    const grad = { stops: [...base.stops.map((s) => ({ pos: r2(s.pos * 0.7), color: s.color })), { pos: 1, color: String(m.vein ?? '#4a6a40') }] }
    return [
      { role: 'joints', stack: 'relief', layer: L('grid', 'Joints', { count_x: Math.max(1, tiles), count_y: Math.max(1, Math.round((tiles * ctx.height) / ctx.width)), width: 1, aa: false, bevel: 0.5, profile: 'linear', sdf_op: 'replace', h_on: true, h_mode: 'subtract', h_amount: 0.25, dif_on: false }, tiles > 0) },
      { role: 'marble', stack: 'paint', layer: L('marble', 'Marble', { ...mb, h_on: false, dif_on: true, dif_grad: grad, r_on: true, r_a: 0.3, r_b: 0.5 }) },
      { role: 'speckle', stack: 'paint', layer: L('noise', 'Speckle', { noise: 'white', seed: num(m.seed, 101) + 1, h_on: false, dif_on: true, dif_blend: 'overlay', dif_opacity: 0.1, dif_grad: gradient('#000000', '#ffffff') }) },
    ]
  },
}
