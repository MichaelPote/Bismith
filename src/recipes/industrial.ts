// Industrial lumps (FR8.12): rusty pipe runs on a wall, and peeling paint over any surface beneath it.

import { P, type ParamValues } from '@/core/params'
import { L, across, clamp, gradient, lerp, num, r2, shade } from './parts'

/** A colour scaled towards black. */
const shadeHex = (hex: string, k: number) => shade(hex, k).stops[0].color
import type { RecipeDef, RecipeLayer } from './types'
import { SHAPE_MASK, limitTo } from '@/layers/masks'

const drawn = (p: Record<string, unknown>) => p.layout === 'drawn'
const random = (p: Record<string, unknown>) => (p.layout ?? 'random') === 'random'

/** Pipe finishes: colours, surface (roughness, specular) and what weathers them. */
interface Finish {
  metal: string[]
  rough: number
  spec: number
  /** Weathering colour (rust, verdigris, chips); '' = the Rust colour control. */
  weather: string
  /** Weathering roughness (rust is rough; verdigris chalky). */
  weatherRough: number
}

const FINISHES: Record<string, Finish> = {
  rusty: { metal: ['#34302c', '#4c433c', '#62554a'], rough: 0.32, spec: 0.55, weather: '', weatherRough: 0.85 },
  painted: { metal: [], rough: 0.45, spec: 0.45, weather: '', weatherRough: 0.85 },
  copper: { metal: ['#7a3c20', '#a0582e', '#c27a46'], rough: 0.2, spec: 0.85, weather: '#4f8f78', weatherRough: 0.7 },
  steel: { metal: ['#5a6066', '#747a80', '#8c9298'], rough: 0.26, spec: 0.75, weather: '', weatherRough: 0.85 },
  chrome: { metal: ['#8a9096', '#b2b8be', '#d4d8dc'], rough: 0.07, spec: 1, weather: '', weatherRough: 0.6 },
  plastic: { metal: [], rough: 0.38, spec: 0.35, weather: '#6a6458', weatherRough: 0.6 },
}

const isGlass = (p: Record<string, unknown>) => p.finish === 'glass'
const colourFinish = (p: Record<string, unknown>) => p.finish === 'painted' || p.finish === 'plastic'

export const pipes: RecipeDef = {
  id: 'pipes',
  label: 'Pipes',
  description: 'Pipe runs on a wall — rusty, painted, copper, steel, chrome, plastic or glass — with elbows, tees, crossings, collars and bolted flanges: round, glossy where they should be, shadow-casting, weathered.',
  groups: [
    { id: 'layout', label: 'Layout' },
    { id: 'fittings', label: 'Fittings' },
    { id: 'finish', label: 'Finish' },
  ],
  params: [
    P.enum('layout', 'Layout', 'random', [['random', 'Random (tileable)'], ['drawn', 'Drawn runs']], { group: 'layout' }),
    P.bitmap('points', 'Runs', '0,0.4 1,0.4 | 0.3,0.4 0.3,1', 'lines', {
      group: 'layout', showIf: drawn, hint: 'Centre lines, x,y as fractions of the texture; one run per line or "|" (edit on the canvas with the shape editor)',
    }),
    P.int('runs', 'Horizontal runs', 3, 0, 64, { group: 'layout', softMax: 16, showIf: random, hint: 'Beyond the room for them, runs lie over the ones they overlap' }),
    P.int('drops', 'Vertical runs', 2, 0, 64, { group: 'layout', softMax: 16, showIf: random, hint: 'Beyond the room for them, runs lie over the ones they overlap' }),
    P.float('jogs', 'Jogs', 0.5, 0, 1, { group: 'layout', step: 0.01, showIf: random }),
    P.float('tees', 'Tees', 0.5, 0, 1, { group: 'layout', step: 0.01, showIf: random }),
    P.float('density', 'Density', 0, 0, 1, { group: 'layout', step: 0.01, showIf: random, hint: 'Stack more pipes in front, layer on layer, until this share of the bare wall is covered (1 = none left). The stack is scaled to fit: raise Roundness for rounder pipes' }),
    P.float('radius', 'Pipe radius', 8, 1, 128, { group: 'layout', softMax: 32, unit: 'px', step: 0.1 }),
    P.float('variety', 'Radius variety', 0.3, 0, 1, { group: 'layout', step: 0.01 }),
    P.float('bend', 'Bend radius', 2, 1, 6, { group: 'layout', step: 0.01, hint: 'Elbows, in pipe radii' }),
    P.float('spacing', 'Coupling spacing', 96, 0, 1024, { group: 'fittings', softMax: 256, unit: 'px', step: 1 }),
    P.float('flanges', 'Flanges', 0.35, 0, 1, { group: 'fittings', step: 0.01 }),
    P.float('collar', 'Collar size', 0.18, 0, 0.6, { group: 'fittings', step: 0.01 }),
    P.bool('elbow_fittings', 'Elbow collars', true, { group: 'fittings' }),
    P.enum('finish', 'Finish', 'rusty', [['rusty', 'Rusty iron'], ['painted', 'Painted'], ['copper', 'Copper'], ['steel', 'Galvanised steel'], ['chrome', 'Chrome'], ['plastic', 'Plastic (PVC)'], ['glass', 'Glass']], { group: 'finish' }),
    P.gradient('metal', 'Metal colours', gradient('#34302c', '#4c433c', '#62554a'), { group: 'finish', hint: 'Rusty iron, per pipe', showIf: (p) => (p.finish ?? 'rusty') === 'rusty' }),
    P.color('colour', 'Colour', '#3c5a44', { group: 'finish', showIf: colourFinish }),
    P.float('shine', 'Shine', 0.5, 0, 1, { group: 'finish', step: 0.01, hint: 'From the finish\u2019s usual sheen (0.5) to dull (0) or polished (1): roughness and specular together' }),
    P.float('rust', 'Weathering', 0.5, 0, 1, { group: 'finish', step: 0.01, hint: 'Rust on iron and steel, verdigris on copper, chips on paint, grime on plastic and chrome', showIf: (p) => !isGlass(p) }),
    P.color('rust_colour', 'Rust colour', '#8c4a24', { group: 'finish', showIf: (p) => !isGlass(p) && p.finish !== 'copper' }),
    P.float('fitting_rust', 'Weathered fittings', 0.6, 0, 1, { group: 'finish', step: 0.01 }),
    P.float('grime', 'Grime underneath', 0.5, 0, 1, { group: 'finish', step: 0.01 }),
    P.float('trails', 'Trails', 0.4, 0, 1, { group: 'finish', step: 0.01, hint: 'Streaks running down the wall from the pipes\u2019 undersides', showIf: (p) => !isGlass(p) }),
    P.color('tint', 'Glass tint', '#9ad0c0', { group: 'finish', showIf: isGlass }),
    P.float('refraction', 'Refraction', 0.5, 0, 2, { group: 'finish', step: 0.01, hint: 'In pipe radii', showIf: isGlass }),
    P.float('fill', 'Liquid level', 0, 0, 1, { group: 'finish', step: 0.01, hint: 'How full each run\u2019s lowest horizontal pipe is: the surface stays level through bends and drops; higher parts stay empty', showIf: isGlass }),
    P.color('liquid', 'Liquid colour', '#2aa070', { group: 'finish', showIf: isGlass }),
    P.float('glow', 'Liquid glow', 0, 0, 2, { group: 'finish', step: 0.01, showIf: isGlass }),
    P.float('relief', 'Roundness', 1, 0, 2, { group: 'finish', step: 0.01, hint: '1 = true-scale cylinders (as tall as they are wide)' }),
    P.seed('seed', 'Seed', 3, { group: 'layout' }),
  ],
  render: { shadows: true, ao: 0.4, aoRadius: 4, specularTint: 0.6 },
  build(m, ctx) {
    const radius = num(m.radius, 8)
    const seed = num(m.seed, 3)
    const shape: ParamValues = {
      layout: m.layout ?? 'random', points: m.points ?? '0,0.4 1,0.4 | 0.3,0.4 0.3,1', units: 'fraction', runs: num(m.runs, 3), drops: num(m.drops, 2), jogs: num(m.jogs, 0.5), tees: num(m.tees, 0.5), density: num(m.density, 0),
      radius, variety: num(m.variety, 0.3), bend: num(m.bend, 2), spacing: num(m.spacing, 96), flanges: num(m.flanges, 0.35), collar: num(m.collar, 0.18), elbow_fittings: m.elbow_fittings !== false, seed,
    }
    const finish = String(m.finish ?? 'rusty')
    const glass = finish === 'glass'
    const f = FINISHES[finish] ?? FINISHES.steel
    // Shine 0.5 = the finish as is; towards 0 rougher and duller, towards 1 smoother and brighter.
    const shine = num(m.shine, 0.5) - 0.5
    const rough = r2(clamp(f.rough * (1 - 1.6 * shine), 0.03, 1))
    const spec = r2(clamp(f.spec + 0.6 * shine * (1 - f.spec + 0.3), 0, 1))
    const colour = String(m.colour ?? '#3c5a44')
    const metal = finish === 'rusty' ? (m.metal ?? gradient(...FINISHES.rusty.metal)) : colourFinish(m) ? gradient(shadeHex(colour, 0.85), colour) : gradient(...f.metal)
    const weather = num(m.rust, 0.5)
    const wc = f.weather || String(m.rust_colour ?? '#8c4a24')
    const fr = num(m.fitting_rust, 0.6)
    const grime = num(m.grime, 0.5)
    const trails = glass ? 0 : num(m.trails, 0.4)
    // Surface height 1 = 4 radii: true scale is 4·radius px.
    const hAmount = r2((num(m.relief, 1) * 4 * radius) / Math.max(ctx.depth ?? 2, 0.01))
    // Glass fittings are steel collars.
    const fitColour = glass ? gradient(...FINISHES.steel.metal) : shade(wc, 0.7)
    const out: RecipeLayer[] = [
      {
        role: 'relief', stack: 'relief',
        layer: L('pipework', 'Pipes', { ...shape, output: 'height', h_on: true, h_mode: 'max', h_amount: hAmount, dif_on: false, r_on: true, r_mode: 'replace', r_src: 'flat', r_a: rough, r_b: rough, s_on: true, s_mode: 'replace', s_src: 'flat', s_a: spec, s_b: spec }),
      },
      // Coverage writes the pipes' outline to the Shape mask: the layers after are limited to it (glass: the tubes only).
      {
        role: 'metal', stack: 'paint',
        layer: L('pipework', glass ? 'Glass tubes' : 'Pipe metal', { ...shape, output: glass ? 'tubes' : 'cover', mk_op: 'replace', bevel: 0, profile: 'flat', aa: true, h_on: false, dif_on: !glass, dif_src: 'random', dif_grad: metal }),
      },
      {
        // Polished metal mirrors its surroundings: bright sky towards the light, a dark band past the middle, the
        // floor's glow at the far edge — chrome in full, steel and copper as a hint over their colour.
        role: 'reflections', stack: 'paint',
        layer: L('pipework', 'Reflections', {
          ...shape, output: 'facing', h_on: false, dif_on: true, dif_src: 'value',
          dif_blend: finish === 'chrome' ? 'normal' : 'multiply', dif_opacity: finish === 'chrome' ? 1 : finish === 'steel' ? 0.5 : 0.35,
          dif_grad: finish === 'chrome'
            ? { stops: [{ pos: 0, color: '#c4c8cc' }, { pos: 0.22, color: '#8e9398' }, { pos: 0.4, color: '#3a3e42' }, { pos: 0.55, color: '#6a6f74' }, { pos: 0.72, color: '#dfe3e6' }, { pos: 0.88, color: '#f6f8fa' }, { pos: 1, color: '#d0d4d8' }] }
            : { stops: [{ pos: 0, color: '#d8d8d8' }, { pos: 0.4, color: '#7a7a7a' }, { pos: 0.6, color: '#b0b0b0' }, { pos: 0.85, color: '#ffffff' }, { pos: 1, color: '#e8e8e8' }] },
        }, finish === 'chrome' || finish === 'steel' || finish === 'copper'),
      },
      {
        // Mottled weathering (rust, verdigris, chips, grime): dark to the weathering colour, rougher where it is.
        role: 'rust', stack: 'paint',
        layer: L('noise', finish === 'copper' ? 'Verdigris' : finish === 'painted' ? 'Chips' : 'Pipe rust', {
          noise: 'perlin', fractal: 'fbm', scale: across(ctx, radius * 1.2), octaves: 5, warp: 0.8, seed: seed + 1, ...limitTo(SHAPE_MASK), sh_lo: r2(lerp(0.74, 0.4, weather)), sh_hi: r2(lerp(0.74, 0.4, weather) + 0.3), sh_cut: 0.02, sh_cut_soft: 0.02,
          h_on: false, dif_on: true, dif_src: 'value', dif_opacity: 0.9, dif_grad: gradient(shadeHex(wc, 0.45), shadeHex(wc, 0.8), wc), r_on: true, r_mode: 'replace', r_src: 'flat', r_a: f.weatherRough, r_b: f.weatherRough, s_on: true, s_mode: 'multiply', s_src: 'flat', s_a: 0.4, s_b: 0.4,
        }, !glass && weather > 0),
      },
      {
        role: 'glass', stack: 'paint',
        layer: L('glass', 'Glass', { refraction: r2(num(m.refraction, 0.5) * radius), tint: String(m.tint ?? '#9ad0c0'), tint_amount: 0.35, transmit: 0.7, fresnel: 0.7, glint: 0.6, roughness: rough, specular: spec }, glass),
      },
      // After the glass: the liquid fills the tube (refracting it would squeeze it into a thread).
      {
        role: 'liquid', stack: 'paint',
        layer: L('pipework', 'Liquid', { ...shape, output: 'liquid', fill: num(m.fill, 0), sh_cut: 0.5, sh_cut_soft: 0.02, h_on: false, dif_on: true, dif_src: 'flat', dif_opacity: 0.8, dif_grad: gradient(String(m.liquid ?? '#2aa070')), e_on: num(m.glow, 0) > 0, e_src: 'flat', e_color: String(m.liquid ?? '#2aa070'), e_intensity: r2(num(m.glow, 0)) }, glass && num(m.fill, 0) > 0),
      },
      { role: 'fittings', stack: 'paint', layer: L('pipework', 'Fittings', { ...shape, output: 'fittings', sh_cut: 0.5, h_on: false, dif_on: true, dif_src: 'random', dif_opacity: glass ? 1 : r2(fr), dif_grad: fitColour }, glass || fr > 0) },
      { role: 'grime', stack: 'paint', layer: L('pipework', 'Grime underneath', { ...shape, output: 'underside', h_on: false, dif_on: true, dif_src: 'value', dif_blend: 'multiply', dif_opacity: r2(grime * (glass ? 0.3 : 1)), dif_grad: gradient('#ffffff', '#ffffff', '#4a3c30') }, grime > 0) },
      { role: 'grain', stack: 'paint', layer: L('noise', 'Pipe grain', { noise: 'white', seed: seed + 2, ...limitTo(SHAPE_MASK), h_on: false, dif_on: true, dif_blend: 'overlay', dif_opacity: 0.08, dif_grad: gradient('#000000', '#ffffff') }, !glass) },
      {
        // Trails from the pipes' lower edges (ledges in the height), down the wall only.
        role: 'trails', stack: 'paint',
        layer: L('drips', 'Rust trails', {
          output: 'stain', cols: Math.ceil(ctx.width / 3), rows: Math.ceil(ctx.height / 3), density: r2(lerp(0.15, 0.6, trails)), relief: 1, ledge: 1, ledge_reach: 3, ledge_soft: 0.3, relief_len: 0.2,
          len_min: r2(radius * 1.5), len_max: r2(radius * 8), width: r2(Math.max(1, radius * 0.35)), width_var: 0.6, wobble: 0.3, head: 0, start: 0.8, fade: 1.2, hard: false, seed: seed + 3,
          ...limitTo(SHAPE_MASK, { outside: true }), h_on: false, dif_on: true, dif_blend: 'multiply', dif_opacity: r2(0.4 + 0.6 * trails), dif_grad: gradient('#ffffff', wc),
        }, trails > 0),
      },
    ]
    return out
  },
}

export const paint: RecipeDef = {
  id: 'paint',
  label: 'Peeling paint',
  description: 'Paint over whatever is beneath — tiles, plates, concrete — flaking off in ragged chips to rust or bare substrate, with a raised paint edge, mottling, rust streaks and grime.',
  groups: [
    { id: 'peel', label: 'Peeling' },
    { id: 'colour', label: 'Colour' },
  ],
  params: [
    P.float('coverage', 'Paint left', 0.7, 0, 1, { group: 'peel', step: 0.01 }),
    P.float('size', 'Chip size', 32, 2, 1024, { group: 'peel', softMax: 128, unit: 'px', step: 0.5 }),
    P.float('ragged', 'Raggedness', 0.5, 0, 1, { group: 'peel', step: 0.01, hint: 'Finer, more broken chip edges' }),
    P.float('thickness', 'Paint thickness', 0.4, 0, 1, { group: 'peel', step: 0.01, hint: 'The step at a chip’s edge: a lit rim and a shadow' }),
    P.float('vertical', 'Vertical streaking', 0.2, 0, 1, { group: 'peel', step: 0.01, hint: 'Chips stretched down the wall, as rust runs from seams and edges' }),
    P.gradient('colours', 'Paint colours', gradient('#2c5560', '#3d6e7a', '#548a94'), { group: 'colour', hint: 'Near a chip → well inside the paint' }),
    P.gradient('under', 'Beneath', gradient('#24140c', '#4e2a16', '#7a4422', '#9a6a44'), { group: 'colour', hint: 'What the chips expose: rust → bare metal, primer or plaster' }),
    P.float('mottle', 'Mottle', 0.4, 0, 1, { group: 'colour', step: 0.01, hint: 'Large patches of faded and darker paint' }),
    P.float('streaks', 'Rust streaks', 0.3, 0, 1, { group: 'colour', step: 0.01 }),
    P.color('rust_colour', 'Streak colour', '#7a4222', { group: 'colour' }),
    P.float('grime', 'Grime', 0.3, 0, 1, { group: 'colour', step: 0.01, hint: 'Dirt in the joints and creases beneath' }),
    P.seed('seed', 'Seed', 11, { group: 'peel' }),
  ],
  render: { ao: 0.3, aoRadius: 2 },
  build(m, ctx) {
    const seed = num(m.seed, 11)
    const size = num(m.size, 32)
    const rag = num(m.ragged, 0.5)
    // fBm sits around 0.5 (spread ≈ 0.15): paint where the noise clears the cut.
    const cut = r2(0.5 - (num(m.coverage, 0.7) - 0.5) * 0.6)
    const chips: ParamValues = { noise: 'perlin', fractal: 'fbm', scale: across(ctx, size), stretch: r2(1 / (1 + 1.5 * num(m.vertical, 0.2))), octaves: Math.round(lerp(3, 7, rag)), warp: r2(lerp(0.2, 1.2, rag)), seed }
    const mottle = num(m.mottle, 0.4)
    const streaks = num(m.streaks, 0.3)
    const grime = num(m.grime, 0.3)
    return [
      { role: 'edge', stack: 'relief', layer: L('noise', 'Paint edge', { ...chips, sh_cut: cut, sh_cut_soft: 0.004, h_on: true, h_mode: 'add', h_amount: r2(0.3 * num(m.thickness, 0.4)), dif_on: false }, num(m.thickness, 0.4) > 0) },
      {
        role: 'under', stack: 'paint',
        layer: L('noise', 'Beneath', { noise: 'perlin', fractal: 'fbm', scale: across(ctx, size * 0.5), octaves: 4, seed: seed + 1, h_on: false, dif_on: true, dif_src: 'value', dif_grad: m.under ?? gradient('#2a1a10', '#b8905c'), r_on: true, r_mode: 'replace', r_src: 'flat', r_a: 0.9, r_b: 0.9 }),
      },
      {
        // The same noise: painted where it clears the cut, darker near a chip, lighter well inside.
        role: 'paint', stack: 'paint',
        layer: L('noise', 'Paint', { ...chips, sh_lo: r2(cut - 0.01), sh_hi: r2(cut + 0.3), sh_cut: 0.03, sh_cut_soft: 0.005, h_on: false, dif_on: true, dif_src: 'value', dif_grad: m.colours ?? gradient('#2c5560', '#548a94'), r_on: true, r_mode: 'replace', r_src: 'flat', r_a: 0.6, r_b: 0.6 }),
      },
      { role: 'mottle', stack: 'paint', layer: L('noise', 'Mottle', { noise: 'perlin', fractal: 'fbm', scale: across(ctx, size * 4), octaves: 3, seed: seed + 2, h_on: false, dif_on: true, dif_blend: 'overlay', dif_opacity: r2(0.6 * mottle), dif_grad: gradient('#000000', '#ffffff') }, mottle > 0) },
      { role: 'grain', stack: 'paint', layer: L('noise', 'Grain', { noise: 'white', seed: seed + 3, h_on: false, dif_on: true, dif_blend: 'overlay', dif_opacity: 0.15, dif_grad: gradient('#000000', '#ffffff') }) },
      {
        role: 'streaks', stack: 'paint',
        layer: L('drips', 'Rust streaks', {
          output: 'stain', cols: Math.max(4, Math.round(ctx.width / (size * 0.5))), rows: Math.max(2, Math.round(ctx.height / size)), density: r2(lerp(0.15, 0.6, streaks)), relief: 0,
          len_min: r2(size * 0.5), len_max: r2(size * 2.5), width: r2(Math.max(1, size * 0.08)), width_var: 0.7, wobble: 0.4, head: 0, start: 0.7, fade: 1, hard: false, seed: seed + 4,
          h_on: false, dif_on: true, dif_blend: 'multiply', dif_opacity: r2(0.3 + 0.7 * streaks), dif_grad: gradient('#ffffff', String(m.rust_colour ?? '#7a4222')),
        }, streaks > 0),
      },
      { role: 'grime', stack: 'paint', layer: L('cavity', 'Grime', { radius: 2, threshold: 0.05, sensitivity: 0.8, wear_amount: 0, dirt_amount: r2(grime), dirt_color: '#1e1610', noise_scale: 8 }, grime > 0) },
    ]
  },
}

export const cutout: RecipeDef = {
  id: 'cutout',
  label: 'Cut-out',
  description: 'An opening that writes a mask (Opening, and Opening frame for its frame ring), added at the top of the stack so the materials below can use it: limit the material in front to outside Opening ∪ Opening frame and the one behind to inside Opening (each material’s Mask card). A recessed step at its edge and an optional raised frame around it.',
  first: true,
  groups: [
    { id: 'shape', label: 'Opening' },
    { id: 'edge', label: 'Edge' },
  ],
  params: [
    P.enum('shape', 'Shape', 'rect', [['rect', 'Rectangle'], ['ellipse', 'Ellipse']], { group: 'shape' }),
    P.float('x', 'Centre X', 0.5, 0, 1, { group: 'shape', step: 0.001 }),
    P.float('y', 'Centre Y', 0.5, 0, 1, { group: 'shape', step: 0.001 }),
    P.float('width', 'Width', 0.5, 0.01, 1.5, { group: 'shape', step: 0.001, hint: 'Fraction of the texture width' }),
    P.float('height', 'Height', 0.4, 0.01, 1.5, { group: 'shape', step: 0.001, hint: 'Fraction of the texture height' }),
    P.float('corner', 'Corner radius', 8, 0, 512, { group: 'shape', softMax: 64, unit: 'px', step: 0.5, showIf: (p) => (p.shape ?? 'rect') === 'rect' }),
    P.text('mask', 'Mask', 'Opening', { group: 'shape', mask: 'write', hint: 'The mask the opening writes (its frame ring writes the same name + " frame"): limit the material behind to inside it, the one in front to outside it and its frame' }),
    P.float('depth', 'Recess', 1, 0, 8, { group: 'edge', softMax: 3, step: 0.01, hint: 'How far the opening sits below the surface (a step that catches the light and casts a shadow)' }),
    P.float('rim', 'Edge bevel', 1, 0, 64, { group: 'edge', softMax: 8, unit: 'px', step: 0.1 }),
    P.float('frame', 'Frame width', 0, 0, 128, { group: 'edge', softMax: 16, unit: 'px', step: 0.5, hint: 'A raised frame around the opening (0 = none)' }),
    P.float('frame_height', 'Frame height', 0.6, 0, 4, { group: 'edge', step: 0.01, showIf: (p) => Number(p.frame ?? 0) > 0 }),
    P.color('frame_colour', 'Frame colour', '#6a6a66', { group: 'edge', showIf: (p) => Number(p.frame ?? 0) > 0 }),
  ],
  render: { shadows: true },
  build(m, ctx) {
    const rect = (m.shape ?? 'rect') === 'rect'
    const w = num(m.width, 0.5) * ctx.width
    const h = num(m.height, 0.4) * ctx.height
    const at = { x: num(m.x, 0.5), y: num(m.y, 0.5) }
    const corner = num(m.corner, 8)
    // The opening grown by `g` px on every side (the frame is a ring just outside it).
    const shape = (g: number): ParamValues =>
      rect
        ? { ...at, size_mode: 'size', width: r2(w + 2 * g), height: r2(h + 2 * g), radius: r2(corner + g) }
        : { ...at, radius: r2(w / 2 + g), squash: r2((h + 2 * g) / Math.max(1, w + 2 * g)) }
    const type = rect ? 'rect' : 'ellipse'
    const frame = num(m.frame, 0)
    const depth = num(m.depth, 1)
    const off = { dif_on: false, h_on: false }
    const mask = String(m.mask ?? '').trim() || 'Opening'
    return [
      { role: 'opening', stack: 'relief', layer: L(type, 'Opening (mask)', { ...shape(0), bevel: 0, profile: 'flat', aa: true, ...off, mk_target: mask, mk_op: 'replace' }) },
      { role: 'recess', stack: 'relief', layer: L(type, 'Recess', { ...shape(0), mk_target: '', bevel: r2(Math.max(0.5, num(m.rim, 1))), profile: 'smooth', aa: true, dif_on: false, h_on: true, h_mode: 'subtract', h_amount: r2(depth) }, depth > 0) },
      { role: 'frame', stack: 'relief', layer: L(type, 'Frame', { ...shape(frame), outline: r2(frame), mk_target: `${mask} frame`, mk_op: 'replace', bevel: r2(Math.min(2, frame / 2)), profile: 'round', aa: true, dif_on: false, h_on: true, h_mode: 'add', h_amount: r2(num(m.frame_height, 0.6)) }, frame > 0) },
      {
        role: 'frame-colour', stack: 'paint',
        layer: L(type, 'Frame colour', { ...shape(frame), outline: r2(frame), mk_target: '', bevel: 0, profile: 'flat', aa: true, h_on: false, dif_on: true, dif_src: 'flat', dif_grad: gradient(String(m.frame_colour ?? '#6a6a66')), s_on: true, s_mode: 'replace', s_src: 'flat', s_a: 0.5, s_b: 0.5 }, frame > 0),
      },
    ]
  },
}
