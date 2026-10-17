// Stone recipes: dressed / rubble walls (Bricks) and cobblestones (Voronoi cells), from the stone-wall
// work (FR7.6): one pattern layer lays the stones out in the Shape mask, and Mask area layers read them from there
// (FR8.23): relief = flat Pillow blurred into a dome → crisp Edges (custom curve) → faceted Chips in the edge zone →
// per-stone Heights → Lumps (driving the glints) → Pits; paint = dark joints, multi-hue noise under per-stone colour,
// moss in the hollows, colour speckle, dirt and edge wear.

import { P, type ParamValues } from '@/core/params'
import { HEIGHT_ONLY, L, ON_FACES, across, clamp, crisp, gradient, lerp, num, r2, shade } from './parts'
import type { RecipeContext, RecipeDef, RecipeLayer } from './types'
import { BRICKS_PLAIN, VORONOI_PLAIN } from '@/layers/generators/patterns'
import { SHAPE_MASK, fromMask, limitTo } from '@/layers/masks'

const STONES = gradient('#33260f', '#45330f', '#323232', '#3a2a10', '#2c2c3a', '#4a3814', '#363636')

const GROUPS = [
  { id: 'layout', label: 'Layout' },
  { id: 'relief', label: 'Relief' },
  { id: 'colour', label: 'Colour' },
  { id: 'weather', label: 'Weathering' },
]

/** Controls shared by the stone recipes (relief, colour, weathering). */
const SHARED = [
  P.float('pillow', 'Pillow', 0.6, 0, 1, { group: 'relief', step: 0.01, hint: 'Broad doming of each stone' }),
  P.float('edges', 'Edge lift', 0.5, 0, 1, { group: 'relief', step: 0.01, hint: 'Crisp rise at the stone edges (steep for a pixel or two, then slow)' }),
  P.float('chips', 'Chipped edges', 0.6, 0, 1, { group: 'relief', step: 0.01, hint: 'Broad faceted cuts into the edges' }),
  P.float('heights', 'Height variation', 0.5, 0, 1, { group: 'relief', step: 0.01, hint: 'Some stones barely raised, others bold' }),
  P.float('rough', 'Surface roughness', 0.5, 0, 1, { group: 'relief', step: 0.01, hint: 'Lumps and pits across the faces' }),
  P.float('glints', 'Glints', 0.6, 0, 1, { group: 'relief', step: 0.01, hint: 'Specular on the faces (tinted by the stone colour)' }),
  P.gradient('stone_colours', 'Stone colours', STONES, { group: 'colour', hint: 'Each stone picks from these; the noise under them too' }),
  P.float('variety', 'Per-stone colour', 0.6, 0, 1, { group: 'colour', step: 0.01, hint: 'How strongly each stone takes its own colour over the shared noise' }),
  P.color('joint_colour', 'Joint colour', '#16110a', { group: 'colour' }),
  P.float('speckle', 'Speckle', 0.2, 0, 1, { group: 'colour', step: 0.01, hint: 'Pixel grain (colour only, never height)' }),
  P.float('moss', 'Moss', 0.3, 0, 1, { group: 'weather', step: 0.01, hint: 'Moss in the hollows' }),
  P.color('moss_colour', 'Moss colour', '#3a3a0c', { group: 'weather' }),
  P.float('dirt', 'Crevice dirt', 0.6, 0, 1, { group: 'weather', step: 0.01 }),
  P.float('wear', 'Edge wear', 0.3, 0, 1, { group: 'weather', step: 0.01 }),
  P.seed('seed', 'Seed', 6, { group: 'layout' }),
]

/** The dressed-stone relief and stone paint around a pattern (`shape`: the layout layer's pattern params). */
function stoneLayers(type: 'bricks' | 'voronoi', shape: ParamValues, m: ParamValues, ctx: RecipeContext, blockMin: number, blockMax: number): RecipeLayer[] {
  const seed = num(m.seed, 6)
  const pillow = num(m.pillow, 0.6)
  const edge = num(m.edges, 0.5)
  const chips = num(m.chips, 0.6)
  const rough = num(m.rough, 0.5)
  const glint = num(m.glints, 0.6)
  // One pattern layer lays the stones out (writing the Shape mask); the rest read its stones from there (Mask area).
  const flat = { ...fromMask(SHAPE_MASK, shape), dif_on: false }
  const stones = m.stone_colours ?? STONES
  const joint = String(m.joint_colour ?? '#16110a')
  const relief = (role: string, layer: ReturnType<typeof L>): RecipeLayer => ({ role, stack: 'relief', layer })
  const paint = (role: string, layer: ReturnType<typeof L>): RecipeLayer => ({ role, stack: 'paint', layer })
  return [
    relief('layout', L(type, 'Stones', { ...shape, bevel: 0, profile: 'flat', h_on: false, dif_on: false })),
    relief('pillow', L('surfacemask', 'Pillow', { ...flat, h_on: true, h_amount: r2(pillow) }, pillow > 0)),
    relief('pillow-blur', L('blur', 'Pillow blur', { radius: r2(clamp(blockMin / 4, 1.5, 6)), ...HEIGHT_ONLY }, pillow > 0)),
    relief(
      'edges',
      L('surfacemask', 'Edges', {
        ...fromMask(SHAPE_MASK, shape), bevel: r2(clamp(blockMin * 0.6, 2, 12)), profile: 'custom', bevel_curve: crisp(), dif_on: false,
        h_on: true, h_amount: r2(Math.max(0.05, edge)), r_on: true, r_mode: 'replace', r_src: 'flat', r_a: 0.6, r_b: 0.6,
        s_on: true, s_mode: 'replace', s_src: 'flat', s_a: r2(glint), s_b: r2(glint),
      }),
    ),
    relief(
      'chips',
      L('voronoi', 'Chips', {
        output: 'facets', facet_fit: false, scale: across(ctx, clamp(0.18 * (blockMin + blockMax), 6, 12)), jitter: 1, tilt: 1.6, seed: seed + 13, mk_target: '',
        h_on: true, h_mode: 'min', h_amount: r2(lerp(2.2, 0.8, chips)), dif_on: false, m_hmode: 'below', m_hlevel: r2(0.8 * (pillow + edge)), m_hsoft: 0.08,
      }, chips > 0),
    ),
    relief('heights', L('surfacemask', 'Stone heights', { ...flat, h_on: true, h_amount: r2(0.8 * num(m.heights, 0.5)), h_var: 1 }, num(m.heights, 0.5) > 0)),
    relief(
      'lumps',
      L('noise', 'Lumps', {
        noise: 'perlin', fractal: 'fbm', scale: across(ctx, clamp(blockMin * 0.6, 4, 10)), octaves: 2, seed: seed + 25, h_on: true, h_amount: r2(0.8 * rough), dif_on: false,
        s_on: true, s_mode: 'multiply', s_src: 'value', s_a: 0.15, s_b: 1, ...ON_FACES,
      }, rough > 0),
    ),
    relief(
      'pits',
      L('noise', 'Pits', {
        noise: 'worley', fractal: 'none', w_even: false, w_profile: 'linear', scale: across(ctx, 5), seed: seed + 27, sh_invert: true, sh_cut: 0.94, sh_cut_soft: 0.04,
        h_on: true, h_mode: 'subtract', h_amount: r2(0.5 * rough), dif_on: false, s_on: true, s_mode: 'multiply', s_src: 'flat', s_a: 0.2, s_b: 0.2, ...ON_FACES,
      }, rough > 0),
    ),
    paint('joints', L('noise', 'Joints', { noise: 'white', seed: seed + 1, ...limitTo(SHAPE_MASK, { outside: true }), h_on: false, dif_on: true, dif_grad: shade(joint, 0.6) })),
    paint('stone-noise', L('noise', 'Stone noise', { noise: 'value', fractal: 'fbm', scale: across(ctx, 7), octaves: 3, seed: seed + 6, ...limitTo(SHAPE_MASK), h_on: false, dif_on: true, dif_grad: stones })),
    paint(
      'stone-colour',
      L('surfacemask', 'Stone colour', { ...fromMask(SHAPE_MASK, shape), h_on: false, dif_on: true, dif_src: 'random', dif_opacity: r2(num(m.variety, 0.6)), dif_grad: stones }),
    ),
    paint(
      'moss',
      L('noise', 'Moss', {
        noise: 'perlin', fractal: 'fbm', scale: across(ctx, 6), octaves: 3, seed: seed + 8, sh_cut: r2(lerp(0.95, 0.55, num(m.moss, 0.3))), sh_cut_soft: 0.05,
        m_hmode: 'below', m_hlevel: 0.35, m_hsoft: 0.15, h_on: false, dif_on: true, dif_opacity: 0.85, dif_grad: shade(String(m.moss_colour ?? '#3a3a0c'), 0.75),
      }, num(m.moss, 0.3) > 0),
    ),
    paint(
      'speckle',
      L('noise', 'Speckle', { noise: 'white', seed: seed + 9, ...limitTo(SHAPE_MASK), h_on: false, dif_on: true, dif_blend: 'overlay', dif_opacity: r2(num(m.speckle, 0.2)), dif_grad: gradient('#000000', '#ffffff') }, num(m.speckle, 0.2) > 0),
    ),
    paint(
      'grime',
      L('cavity', 'Dirt & wear', {
        radius: r2(clamp(blockMin / 6, 1, 2.5)), threshold: 0.05, sensitivity: 0.8, wear_amount: r2(num(m.wear, 0.3)), wear_color: '#6a6258',
        dirt_amount: r2(num(m.dirt, 0.6)), dirt_color: joint, noise_scale: 8,
      }),
    ),
  ]
}

export const dressedStone: RecipeDef = {
  id: 'dressed-stone',
  label: 'Stone wall',
  description: 'Dressed blocks to hand-placed rubble: domed faces, crisp chipped edges, per-stone height and colour, moss and grime.',
  groups: GROUPS,
  params: [
    P.int('columns', 'Stones across', 4, 1, 64, { group: 'layout', softMax: 16 }),
    P.int('rows', 'Courses', 8, 1, 64, { group: 'layout', softMax: 32 }),
    P.float('stagger', 'Stagger', 0.5, 0, 1, { group: 'layout', step: 0.01 }),
    P.float('irregular', 'Irregularity', 0.4, 0, 1, { group: 'layout', step: 0.01, hint: 'Dressed (0) to hand-placed rubble (1): stone shifts, tilts, ragged courses, wandering joints' }),
    P.float('joint', 'Joint width', 0.5, -1, 3, { group: 'layout', step: 0.05, unit: 'px', hint: 'Below 0 the stones touch (occlusion separates them)' }),
    ...SHARED,
  ],
  render: { ao: 1, aoRadius: 3, specularTint: 0.75 },
  build(m, ctx) {
    const v = num(m.irregular, 0.4)
    const cols = Math.max(1, Math.round(num(m.columns, 4)))
    const rows = Math.max(1, Math.round(num(m.rows, 8)))
    const shape = {
      ...BRICKS_PLAIN, columns: cols, rows, stagger: num(m.stagger, 0.5), mortar: num(m.joint, 0.5), round: 1.5, aa: false, seed: num(m.seed, 6),
      pos_jitter: r2(1.5 * v), rot_jitter: r2(4 * v), len_var: r2(0.15 + 0.5 * v), row_var: r2(0.6 * v), row_jitter: r2(0.5 * v), dw_amount: r2(0.3 + v), dw_scale: 6,
    }
    const a = ctx.width / cols
    const b = ctx.height / rows
    return stoneLayers('bricks', shape, m, ctx, Math.min(a, b), Math.max(a, b))
  },
}

export const cobblestones: RecipeDef = {
  id: 'cobblestones',
  label: 'Cobblestones',
  description: 'Rounded irregular stones (Voronoi cells) with the stone-wall relief and paint.',
  groups: GROUPS,
  params: [
    P.float('size', 'Stone size', 13, 4, 128, { group: 'layout', softMax: 48, unit: 'px' }),
    P.float('irregular', 'Irregularity', 0.6, 0, 1, { group: 'layout', step: 0.01, hint: 'Grid-like (0) to wandering, uneven stones (1)' }),
    P.float('joint', 'Joint width', 1, 0, 4, { group: 'layout', step: 0.05, unit: 'px' }),
    ...SHARED.map((d) => (d.key === 'seed' ? { ...d, default: 4 } : d)),
  ],
  render: { ao: 1, aoRadius: 3, specularTint: 0.75 },
  build(m, ctx) {
    const size = num(m.size, 13)
    const v = num(m.irregular, 0.6)
    const shape = { ...VORONOI_PLAIN, output: 'cells', scale: across(ctx, size), jitter: r2(lerp(0.5, 1, v)), gap: num(m.joint, 1), round: 2, warp: r2(2.5 * v), seed: num(m.seed, 4), aa: false }
    return stoneLayers('voronoi', shape, m, ctx, size, size)
  },
}
