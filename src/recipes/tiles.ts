// Tiled floors and walls tuned against references (FR8.6): square tile grids (8, 16 and 32 px), hex tiles, diagonal
// brick paving, herringbone and basketweave, bone and plus pavers, fan and ring setts — one lump, the pattern as a choice.

import { P, type ParamValues } from '@/core/params'
import { L, ON_FACES, across, clamp, gradient, num, r2, shade } from './parts'
import type { RecipeDef, RecipeLayer } from './types'

export const tiles: RecipeDef = {
  id: 'tiles',
  label: 'Tiles',
  description: 'Square, hex, diamond, diagonal-bond, herringbone or basketweave tiles, bone or plus pavers, fan or ring setts: crisp bevels, per-tile colour and height, grout and grime.',
  icon: 'pattern',
  groups: [
    { id: 'layout', label: 'Layout' },
    { id: 'relief', label: 'Relief' },
    { id: 'colour', label: 'Colour' },
  ],
  params: [
    P.enum('pattern', 'Pattern', 'squares', [['squares', 'Squares'], ['bond', 'Running bond'], ['diagonal', 'Diagonal bond'], ['diamonds', 'Diamonds'], ['hex', 'Hexagons'], ['rhombille', 'Tumbling blocks (rhombi)'], ['herringbone', 'Herringbone'], ['basketweave', 'Basketweave'], ['bone', 'Bone pavers'], ['plus', 'Plus pavers'], ['fan', 'Fan setts (cobbles)'], ['rings', 'Ring setts (rosettes)']], { group: 'layout' }),
    P.float('size', 'Tile size', 16, 2, 256, { group: 'layout', softMax: 64, unit: 'px', hint: 'Short side of a tile (bone pavers: their width; plus pavers: an arm; setts: a sett)' }),
    P.float('fans', 'Fans across', 1, 0.5, 16, { group: 'layout', step: 0.01, hint: 'Fans or rosettes across the width (whole when tiling)', showIf: (p) => p.pattern === 'fan' || p.pattern === 'rings' }),
    P.float('irregular', 'Irregularity', 0.2, 0, 1, { group: 'layout', step: 0.01, hint: 'Hand-laid setts: sizes and places vary a little', showIf: (p) => p.pattern === 'fan' || p.pattern === 'rings' }),
    P.float('joint', 'Joint width', 1, 0, 8, { group: 'layout', step: 0.1, unit: 'px' }),
    P.float('corner', 'Corner rounding', 1.5, 0, 8, { group: 'layout', step: 0.1, unit: 'px' }),
    P.float('edge', 'Edge relief', 0.5, 0, 1, { group: 'relief', step: 0.01, hint: 'A hint of relief: the tile sits a fraction of a pixel above the joint — one dark line and a 1 px highlight' }),
    P.float('raise', 'Raised border', 0, 0, 1, { group: 'relief', step: 0.01, hint: 'A lit ring just inside each tile edge' }),
    P.float('heights', 'Height variation', 0.1, 0, 1, { group: 'relief', step: 0.01 }),
    P.float('rough', 'Surface roughness', 0.15, 0, 1, { group: 'relief', step: 0.01 }),
    P.gradient('colours', 'Tile colours', gradient('#5a4426', '#6e5530', '#7a5f36'), { group: 'colour' }),
    P.float('variety', 'Per-tile colour', 0.15, 0, 1, { group: 'colour', step: 0.01 }),
    P.float('mottle', 'Mottle', 0.15, 0, 1, { group: 'colour', step: 0.01 }),
    P.color('grout', 'Joint colour', '#1e160c', { group: 'colour' }),
    P.float('speckle', 'Speckle', 0.12, 0, 1, { group: 'colour', step: 0.01 }),
    P.float('grain', 'Colour grain', 0.4, 0, 1, { group: 'colour', step: 0.01, hint: 'Per-pixel variation in the tile colours (keeps a palette snap from banding)' }),
    P.float('flecks', 'Flecks', 0, 0, 1, { group: 'colour', step: 0.01, hint: 'Sparse coloured flecks (patina, mineral grains)' }),
    P.color('fleck_colour', 'Fleck colour', '#3a5a2a', { group: 'colour' }),
    P.float('dirt', 'Grime', 0.15, 0, 1, { group: 'colour', step: 0.01 }),
    P.seed('seed', 'Seed', 21, { group: 'layout' }),
  ],
  render: { ao: 0.3, aoRadius: 1, specularTint: 0.7 },
  build(m, ctx) {
    const seed = num(m.seed, 21)
    const size = num(m.size, 16)
    const joint = num(m.joint, 2)
    const pattern = String(m.pattern ?? 'squares')
    // The pattern every copy shares (relief tile, per-tile heights, per-tile colour).
    let type = 'tessellation'
    let shape: ParamValues
    if (pattern === 'hex') {
      type = 'hex'
      shape = { scale: across(ctx, size * 1.15), orient: 'flat', gap: joint, round: num(m.corner, 1.5), seed }
    } else if (pattern === 'fan' || pattern === 'rings') {
      // Setts in arcs: courses from the fan's point (rosette's centre) to its rim, one sett deep each.
      type = 'setts'
      const fans = Math.max(0.5, num(m.fans, 1))
      const w = ctx.width / fans
      const rim = pattern === 'fan' ? w / Math.SQRT2 : w / 2
      shape = { layout: pattern, scale: fans, courses: r2(Math.max(1, rim / size)), length: 1, stagger: 1, irregular: num(m.irregular, 0.2), gap: joint, round: num(m.corner, 1.5), seed }
    } else if (pattern === 'bone') {
      // Interlocking bone (dog-bone) pavers in half-offset columns: hex-topology tiles with a stepped waist.
      shape = { mode: 'cross', scale: across(ctx, size * 2), aspect: 1.35, plateau: 0.6, step: 0.3, gap: joint, round: num(m.corner, 1.5), seed }
    } else if (pattern === 'plus') {
      shape = { mode: 'plus', scale: across(ctx, size * 5), gap: joint, round: num(m.corner, 1.5), seed }
    } else if (pattern === 'bond') {
      type = 'bricks'
      shape = { columns: Math.max(1, Math.round(ctx.width / (size * 2))), rows: Math.max(1, Math.round(ctx.height / size)), stagger: 0.5, mortar: joint, round: num(m.corner, 1.5), seed }
    } else {
      const mode = pattern === 'diagonal' ? 'squares' : pattern
      // Diagonal bond: squares stretched 2:1 into bricks, half-offset rows, turned 45°.
      shape = {
        mode, scale: across(ctx, pattern === 'diagonal' ? size * 2 : pattern === 'herringbone' || pattern === 'basketweave' ? size * 2 : size),
        aspect: pattern === 'diagonal' ? 0.5 : 1, stagger: pattern === 'diagonal' ? 0.5 : 0, orient: pattern === 'diagonal' || pattern === 'diamonds' ? '45' : '0', ratio: 2, gap: joint, round: num(m.corner, 1.5), seed,
      }
      if (pattern === 'diamonds') shape.mode = 'squares'
    }
    shape.aa = false
    const edge = num(m.edge, 0.5)
    const raise = num(m.raise, 0)
    const rough = num(m.rough, 0.15)
    const colours = m.colours ?? gradient('#5a4426', '#7a5f36')
    const grout = String(m.grout ?? '#1e160c')
    const out: RecipeLayer[] = [
      {
        role: 'tile', stack: 'relief',
        // A near-hard step a fraction of a pixel high: the joint reads as one dark line, the lit edge as one faint
        // highlight pixel ("a hint of relief", never a bevel ramp).
        layer: L(type, 'Tiles', { ...shape, bevel: 0.5, profile: 'linear', sdf_op: 'replace', h_on: true, h_amount: r2(0.3 * edge), dif_on: false, r_on: true, r_mode: 'replace', r_src: 'flat', r_a: 0.6, r_b: 0.6, s_on: true, s_mode: 'replace', s_src: 'flat', s_a: 0.2, s_b: 0.2 }),
      },
      {
        role: 'raise', stack: 'relief',
        // A 1 px ridge a couple of pixels inside each edge.
        layer: L(type, 'Raised border', { ...shape, bevel: r2(clamp(size * 0.15, 2, 5)), profile: 'custom', bevel_curve: { points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.45, y: 1 }, { x: 0.6, y: 0 }, { x: 1, y: 0 }] }, sdf_op: 'none', h_on: true, h_amount: r2(0.25 * raise), dif_on: false }, raise > 0),
      },
      { role: 'heights', stack: 'relief', layer: L(type, 'Tile heights', { ...shape, bevel: 0, profile: 'flat', sdf_op: 'none', h_on: true, h_amount: r2(0.15 * num(m.heights, 0.1)), h_var: 1, dif_on: false }, num(m.heights, 0.1) > 0) },
      { role: 'lumps', stack: 'relief', layer: L('noise', 'Lumps', { noise: 'perlin', fractal: 'fbm', scale: across(ctx, clamp(size * 0.6, 4, 16)), octaves: 2, seed: seed + 1, h_on: true, h_amount: r2(0.1 * rough), dif_on: false, s_on: true, s_mode: 'multiply', s_src: 'value', s_a: 0.2, s_b: 1, ...ON_FACES }, rough > 0) },
      { role: 'grout', stack: 'paint', layer: L('noise', 'Grout', { noise: 'white', seed: seed + 2, m_clip: 'outside', h_on: false, dif_on: true, dif_grad: shade(grout, 0.65) }) },
      { role: 'mottle', stack: 'paint', layer: L('noise', 'Mottle', { noise: 'value', fractal: 'fbm', scale: across(ctx, clamp(size * 0.5, 3, 24)), octaves: 3, seed: seed + 3, m_clip: 'inside', sh_lo: r2(0.5 - 0.5 * num(m.mottle, 0.15)), sh_hi: r2(0.5 + 0.5 * num(m.mottle, 0.15)), h_on: false, dif_on: true, dif_grad: colours }) },
      { role: 'tile-colour', stack: 'paint', layer: L(type, 'Tile colour', { ...shape, bevel: 0, profile: 'flat', sdf_op: 'none', m_clip: 'inside', h_on: false, dif_on: true, dif_src: 'random', dif_opacity: r2(num(m.variety, 0.15)), dif_grad: colours }, num(m.variety, 0.15) > 0) },
      { role: 'grain', stack: 'paint', layer: L('noise', 'Colour grain', { noise: 'white', seed: seed + 5, m_clip: 'inside', h_on: false, dif_on: true, dif_opacity: r2(0.5 * num(m.grain, 0.4)), dif_grad: colours }, num(m.grain, 0.4) > 0) },
      {
        role: 'flecks', stack: 'paint',
        layer: L('noise', 'Flecks', { noise: 'white', seed: seed + 6, m_clip: 'inside', sh_cut: r2(1 - 0.3 * num(m.flecks, 0)), sh_cut_soft: 0.02, h_on: false, dif_on: true, dif_grad: shade(String(m.fleck_colour ?? '#3a5a2a'), 0.7) }, num(m.flecks, 0) > 0),
      },
      { role: 'speckle', stack: 'paint', layer: L('noise', 'Speckle', { noise: 'white', seed: seed + 4, m_clip: 'inside', h_on: false, dif_on: true, dif_blend: 'overlay', dif_opacity: r2(num(m.speckle, 0.12)), dif_grad: gradient('#000000', '#ffffff') }, num(m.speckle, 0.12) > 0) },
      { role: 'grime', stack: 'paint', layer: L('cavity', 'Grime', { radius: 1.5, threshold: 0.05, sensitivity: 0.8, wear_amount: 0.25, wear_color: '#8a7a60', dirt_amount: r2(num(m.dirt, 0.15)), dirt_color: grout, noise_scale: 8 }) },
    ]
    return out
  },
}
