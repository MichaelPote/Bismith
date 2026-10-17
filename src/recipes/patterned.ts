// Stripes lump (FR8.6): warning stripes and alternating bands (OWRNGA / OWRNGB / OWRNGC) — two colours, crisp edges,
// barely raised, worn and grimy.

import { P, type ParamValues } from '@/core/params'
import { L, across, gradient, num, r2, shade } from './parts'
import type { RecipeDef, RecipeLayer } from './types'

export const stripes: RecipeDef = {
  id: 'stripes',
  label: 'Stripes',
  description: 'Warning stripes and alternating bands — diagonal, straight, chevrons, zig-zags or checks — in two colours with crisp edges, wear and grime.',
  groups: [
    { id: 'layout', label: 'Layout' },
    { id: 'colour', label: 'Colour' },
    { id: 'wear', label: 'Wear' },
  ],
  params: [
    P.enum('pattern', 'Pattern', 'diagonal', [['diagonal', 'Diagonal'], ['straight', 'Straight'], ['chevron', 'Chevrons'], ['zigzag', 'Zig-zag'], ['checker', 'Checks']], { group: 'layout' }),
    P.float('count', 'Stripes across', 4, 0.5, 64, { group: 'layout', softMax: 16, step: 0.5, hint: 'Stripe pairs per texture width' }),
    P.float('angle', 'Angle', 45, -90, 90, { group: 'layout', unit: '°', step: 1, hint: 'Diagonal / straight: stripe direction (snapped to a seamless angle)' }),
    P.float('duty', 'Stripe width', 0.5, 0.05, 0.95, { group: 'layout', step: 0.01, hint: 'Share of each pair in the first colour' }),
    P.float('edge', 'Edge relief', 0.4, 0, 1, { group: 'layout', step: 0.01, hint: 'The first colour sits a hair above the second (crisp 1 px edge)' }),
    P.gradient('colour_a', 'First colour', gradient('#b07418', '#d49a28', '#e0ac38'), { group: 'colour' }),
    P.gradient('colour_b', 'Second colour', gradient('#0e0c0a', '#1c1814', '#26201a'), { group: 'colour' }),
    P.float('mottle', 'Mottle', 0.3, 0, 1, { group: 'colour', step: 0.01 }),
    P.float('specks', 'Grunge specks', 0.2, 0, 1, { group: 'wear', step: 0.01, hint: 'Dark pits in the paint' }),
    P.float('scratches', 'Scratches', 0.15, 0, 1, { group: 'wear', step: 0.01 }),
    P.float('dirt', 'Dirt', 0.15, 0, 1, { group: 'wear', step: 0.01 }),
    P.seed('seed', 'Seed', 31, { group: 'layout' }),
  ],
  build(m, ctx) {
    const seed = num(m.seed, 31)
    const pattern = String(m.pattern ?? 'diagonal')
    const count = num(m.count, 4)
    const duty = num(m.duty, 0.5)
    let type = 'stripes'
    let shape: ParamValues
    if (pattern === 'checker') {
      // The first colour's squares of a checkerboard as the shape (even counts when tiling).
      type = 'tiles'
      const cx = Math.max(1, Math.round(count * 2)), cy = Math.max(1, Math.round((count * 2 * ctx.height) / ctx.width))
      shape = { mode: 'squares', scale: cx, aspect: (cx * ctx.height) / (ctx.width * cy), fit: false, only: '1', gap: 0, round: 0, tilt: 0, crown: 0, h_var: 0, laid: 0 }
    } else if (pattern === 'chevron' || pattern === 'zigzag') {
      type = 'bands'
      const lanes = Math.max(1, Math.round((count * ctx.height) / ctx.width))
      shape = { mode: pattern, count: Math.max(1, Math.round(count / 2)), rows: lanes, width: r2((ctx.height / lanes) * duty), margin_top: 0, margin_bottom: 0, rail: 0, keep_angle: false, h_var: 0, angle: num(m.angle, 45), run: 0, orient: '0' }
    } else {
      shape = { mode: 'shape', count, angle: pattern === 'straight' ? num(m.angle, 0) : num(m.angle, 45), duty, offset: 0 }
    }
    shape = { ...shape, aa: false, seed }
    const a = m.colour_a ?? gradient('#b07418', '#e0ac38')
    const b = m.colour_b ?? gradient('#0e0c0a', '#26201a')
    const mot = num(m.mottle, 0.3)
    const edge = num(m.edge, 0.4)
    const out: RecipeLayer[] = [
      { role: 'stripe', stack: 'relief', layer: L(type, 'Stripe relief', { ...shape, bevel: 1, profile: 'linear', sdf_op: 'replace', h_on: true, h_amount: r2(0.2 * edge), dif_on: false }, edge > 0) },
      { role: 'base', stack: 'paint', layer: L('noise', 'Second colour', { noise: 'value', fractal: 'fbm', scale: across(ctx, 2.5), octaves: 2, seed: seed + 1, sh_lo: r2(0.5 - 0.5 * mot), sh_hi: r2(0.5 + 0.5 * mot), h_on: false, dif_on: true, dif_grad: b }) },
      { role: 'stripe-colour', stack: 'paint', layer: L(type, 'Stripes', { ...shape, bevel: 0, profile: 'flat', sdf_op: 'replace', h_on: false, dif_on: true, dif_src: 'flat', dif_grad: { stops: [{ pos: 0, color: (a as { stops: { color: string }[] }).stops[1]?.color ?? '#d49a28' }] } }) },
      { role: 'stripe-mottle', stack: 'paint', layer: L('noise', 'First colour', { noise: 'value', fractal: 'fbm', scale: across(ctx, 2.5), octaves: 2, seed: seed + 2, m_clip: 'inside', sh_lo: r2(0.5 - 0.5 * mot), sh_hi: r2(0.5 + 0.5 * mot), h_on: false, dif_on: true, dif_grad: a }) },
      {
        role: 'specks', stack: 'paint',
        layer: L('noise', 'Grunge specks', { noise: 'white', seed: seed + 3, sh_cut: r2(1 - 0.25 * num(m.specks, 0.2)), sh_cut_soft: 0.02, h_on: false, dif_on: true, dif_blend: 'multiply', dif_opacity: 0.8, dif_grad: gradient('#ffffff', '#3a3028') }, num(m.specks, 0.2) > 0),
      },
      {
        role: 'scratches', stack: 'paint',
        layer: L('scratches', 'Scratches', { density: r2(2 + 16 * num(m.scratches, 0.15)), len_min: 2, len_max: 8, thickness: 1, taper: 0.5, angle: 20, angle_jitter: 60, fade: 0.5, hard: true, seed: seed + 4, m_clip: 'inside', h_on: false, dif_on: true, dif_opacity: 0.7, dif_grad: shade((b as { stops: { color: string }[] }).stops[0]?.color ?? '#1c1814', 1) }, num(m.scratches, 0.15) > 0),
      },
      { role: 'grime', stack: 'paint', layer: L('cavity', 'Dirt', { radius: 1.5, threshold: 0.05, sensitivity: 0.8, wear_amount: 0.2, wear_color: '#c8a050', dirt_amount: r2(num(m.dirt, 0.15)), dirt_color: '#14100c', noise_scale: 8 }) },
    ]
    return out
  },
}
