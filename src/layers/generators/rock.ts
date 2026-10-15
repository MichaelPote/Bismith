// Rock: fractured, bedded stone (docs/features/fr8.18-rock.md). Blocks lie in strata — courses along the bedding, split
// by joints across it — on a doubly sheared lattice (any bedding and cross-joint angle stays seamless). Each block is a
// mesa: its own height, a random tilt, a dip across the bedding (ledges), a rounding (dome, ridge or hexagonal prism),
// and sides (scarps) that fall away from its border at a fixed slope, so a higher block drapes over its lower
// neighbours: plateaus, ledges and shelves instead of cliffs everywhere. Finer generations of blocks (facets) are added
// on top at falling strength: chipped, crumpled faces. The surface is the upper envelope of the mesas, with weathered
// shoulders, rills and laminae; the creases where two meet are the joints, which can open into cracks, and the blocks
// between them go to the Shape Mask. Scarps and crevices are outputs of their own, for paint.

import { P, gradient, type ParamValues } from '@/core/params'
import type { LayerDef } from '../types'
import { ORG_GLSL, ORG_GLSL_SDF } from './organicShared'

// Styles: the shape settings of hand-authored recreations (docs/features/fr8.18-rock.md, the settings table), where
// they differ from the defaults. Block size, facet levels, Height and the paint stay as they are; params a style
// doesn't name go back to their defaults. (Columns: no facets — the recreation had one level.)
const STYLES: Record<string, ParamValues> = {
  fractured: {
    angle: -60, fold: 0, elong: 1.15, bedding: 0.6, jitter: 1, merge: 0.45, size_var: 0.9, tilt: 1, lean: 0.6,
    weather: 0.5, facets: 0.35, zones: 0.8, steps: 0.8, joint: 0,
  },
  ledges: {
    angle: 0, elong: 1.4, bedding: 0.3, merge: 0.6, size_var: 0.7, fold: 0, coherence: 0.2, tilt: 0.15, scarp: 2,
    weather: 2, lean: -0.6, steps: 0, bed_relief: 0.8, facets: 0.8, zones: 0.3, rough: 0.02, rough_scale: 3, joint: 0.5,
    joint_open: 0.12, joint_cross: 2, joint_var: 0.6, joint_depth: 0.15,
  },
  flakes: {
    angle: -25, cross: 25, elong: 2.5, bedding: 0.3, jitter: 1, merge: 0, size_var: 0.5, fold: 1.5, heights: 1.2,
    coherence: 0.4, dip: 0.2, scarp: 5, weather: 0, lean: -0.3, steps: 1, bed_relief: 0.8, zones: 0.6, rough: 0.05,
    joint: 0, joint_open: 1, joint_cross: 1, joint_var: 0.6, joint_depth: 0.6,
  },
  slate: {
    angle: -20, elong: 2, merge: 0, warp: 0.3, jag: 0.6, fold: 1.5, fold_scale: 1, heights: 0.5, coherence: 0.2,
    tilt: 0.4, dip: 0.2, weather: 0.3, lean: 0.8, steps: 0, facets: 0.3, zones: 0, rough: 0.25, rough_scale: 3,
    joint: 2.5, joint_open: 1, joint_cross: 0.3, joint_facets: 0.2, joint_var: 1, joint_depth: 0.8, fractures: 0.5,
    frac_angle: -60,
  },
  columns: {
    angle: 90, cross: 20, elong: 2.5, bedding: 0.7, jitter: 1, merge: 0, size_var: 0.4, warp: 0.03, jag: 0.1, fold: 0,
    heights: 0.8, coherence: 0, tilt: 0.1, pitch: 1, bulge: 1, crest: 'hex', scarp: 0.8, weather: 0, lean: -0.3,
    steps: 0, bed_relief: 1.5, zones: 0, rough: 0.05, rough_scale: 3, joint: 0, joint_open: 1, joint_cross: 1,
    joint_var: 0.6, joint_depth: 0.6, facets: 0,
  },
  rubble: {
    angle: 0, elong: 1.8, bedding: 0.9, merge: 0, size_var: 0.5, warp: 0.2, jag: 0.4, fold: 0, heights: 0.4, proud: 0.4,
    coherence: 0.2, tilt: 0.4, dip: 0.1, bulge: 0.3, scarp: 2, weather: 3, corner: 2, steps: 0, facets: 0.3, zones: 0.5,
    rough: 0.1, rough_scale: 1.5, joint: 1.5, joint_open: 1, joint_cross: 1, joint_facets: 0.3, facet_break: 0.6,
    joint_var: 0.5, joint_depth: 0.6,
  },
  cobbles: {
    angle: 0, elong: 1.3, bedding: 0.2, jitter: 1, merge: 0, warp: 0.2, fold: 0, heights: 0.4, coherence: 0.2,
    tilt: 0.3, bulge: 0.9, scarp: 2, weather: 2, corner: 3, lean: 0, steps: 0, facets: 0.2, zones: 0.4, rough: 0.05,
    joint: 2, joint_open: 1, joint_cross: 1, joint_var: 0.5, joint_depth: 0.8,
  },
}
const STYLE_KEYS = [...new Set(Object.values(STYLES).flatMap((s) => Object.keys(s)))]

export const rockLayer: LayerDef = {
  type: 'rock',
  label: 'Rock',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Fractured, bedded stone: blocks in strata (ledges, slabs, columns, rubble) with their own heights, tilts and draped scarps, finer facets, joints and weathering — plus masks of its scarps, crevices and rain streaks to paint.',
  params: [
    P.enum('output', 'Output', 'relief', [
      ['relief', 'Relief', 'the rock surface: block faces, scarps, facets and cracks, as a height (and a colour by height)'],
      ['scarps', 'Scarps', '1 on the scarps — the slopes a block runs out over its lower neighbours — 0 on the faces: paint the shaded, weathered faces, or dust and scree on them'],
      ['crevices', 'Crevices', '1 in the creases where blocks meet (the joints and the foot of every scarp), fading over the Crevice reach: moss, dirt and damp in the cracks'],
      ['streaks', 'Streaks', 'rain streaks running down each block from its top edge, fading as they go: water stains, lime or rust washed down the faces'],
    ], { hint: 'Every output comes from the same rock (same settings, same seed) and puts its blocks in the Shape Mask' }),
    P.enum('style', 'Style', 'default', [
      ['default', 'Default', 'the generator’s defaults: gently folded strata of tilted blocks'],
      ['fractured', 'Fractured face', 'steep strata broken into tilted blocks of many sizes, with finer fractures (the wizard’s Rock face)'],
      ['ledges', 'Layered ledges', 'level beds standing out as ledges with sheer undersides, a few open joints'],
      ['flakes', 'Flaky strata', 'folded beds of thin plates, each ledge a staircase of flakes'],
      ['slate', 'Slate plates', 'flat plates in angled, folded beds, wide open joints and long fractures'],
      ['columns', 'Columns', 'hexagonal columns with sheared, lit ends'],
      ['rubble', 'Coursed rubble', 'big rounded stones in courses, partly cracked, mostly flush'],
      ['cobbles', 'Cobbles', 'domed, rounded stones with open joints'],
    ], { uniform: false, hint: 'Sets the shape to a proven look (block size, Height and paint stay). Params you change afterwards stay as you set them' }),
    P.enum('scarp_face', 'Facing', 'all', [
      ['all', 'All', 'every scarp'],
      ['down', 'Below ledges', 'the scarps a block runs out over the rock below it (down the screen): the shaded undersides'],
      ['up', 'Above ledges', 'the scarps rising to the block above (up the screen): shelves where dust, scree and moss settle'],
    ], { showIf: (p) => p.output === 'scarps' }),
    P.float('crev_patch', 'Patchiness', 0.5, 0, 1, { step: 0.001, showIf: (p) => p.output === 'crevices', hint: 'Breaks the crevice mask into patches about two blocks across: 0 = every crack filled, 1 = only here and there' }),
    P.float('crev_reach', 'Crevice reach', 3, 0.5, 64, { softMax: 12, unit: 'px', step: 0.05, showIf: (p) => p.output === 'crevices', hint: 'How far the crevice mask fades out from the crease (deeper steps reach a little further)' }),
    P.float('streak_len', 'Streak length', 24, 1, 512, { softMax: 96, unit: 'px', step: 0.1, showIf: (p) => p.output === 'streaks', hint: 'Longest streak; each runs 40–100 % of it down from its block’s top edge' }),
    P.float('streak_density', 'Streak density', 0.5, 0, 1, { step: 0.001, showIf: (p) => p.output === 'streaks', hint: 'How many of the narrow columns (about 1.5 px wide) carry a streak, in clusters: about this share up to 0.5, three quarters at 1' }),
    P.float('angle', 'Bedding angle', -15, -90, 90, { step: 0.1, unit: '°', hint: 'Direction the strata run, clockwise from horizontal; ±90 = columns. Snapped a little when tiling so the texture stays seamless' }),
    P.float('cross', 'Cross-joint angle', 0, -60, 60, { step: 0.1, unit: '°', hint: 'Lean of the joints across the bedding: 0 = square to the strata, otherwise rhomboid blocks. Snapped (coarsely for big blocks) when tiling so the texture stays seamless' }),
    P.float('size', 'Block size', 16, 2, 512, { softMax: 64, unit: 'px', step: 0.1, hint: 'Thickness of a block across the bedding (course height, column width)' }),
    P.float('elong', 'Elongation', 1.6, 0.5, 12, { softMax: 6, step: 0.01, hint: 'Block length along the bedding ÷ its thickness' }),
    P.float('bedding', 'Bedding', 0.45, 0, 1, { step: 0.001, hint: '1: blocks line up in straight courses; 0: scattered, any which way' }),
    P.float('jitter', 'Irregularity', 0.9, 0, 1, { step: 0.001, hint: 'Spread of block lengths and positions' }),
    P.float('stagger', 'Stagger', 0, 0, 1, { step: 0.001, hint: 'Shifts every other course half a block along the bedding — a running bond, as in brickwork and coursed rubble: each block bridges a joint below it. With little bedding the blocks become hexagons, their ends slanted' }),
    P.float('merge', 'Merge', 0.4, 0, 1, { step: 0.001, hint: 'Chance that a 2 × 2 group of blocks fuses into one big block: one face, no joints inside — big blocks among small ones (not for ridges and prisms)' }),
    P.float('size_var', 'Size variation', 0.6, 0, 1, { step: 0.001, hint: 'Some blocks grow at their neighbours’ expense' }),
    P.float('warp', 'Warp', 0.15, 0, 2, { softMax: 1, step: 0.001, hint: 'Bends the strata (in block sizes)' }),
    P.float('fold', 'Folds', 0.5, 0, 16, { softMax: 4, step: 0.01, hint: 'Bends the strata in broad folds: how many beds they shift up and down across the texture' }),
    P.float('fold_scale', 'Fold count', 1.5, 0.5, 16, { softMax: 6, step: 0.01, showIf: (p) => Number(p.fold) > 0, hint: 'Folds across the texture width (rounded when tiling)' }),
    P.float('fold_sharp', 'Fold sharpness', 0, 0, 1, { step: 0.001, showIf: (p) => Number(p.fold) > 0, hint: 'Turns the smooth folds into chevrons: strata bent in sharp V-shaped hinges, as in folded shale and flaky sandstone' }),
    P.float('jag', 'Jaggedness', 0.3, 0, 8, { softMax: 3, unit: 'px', step: 0.01, hint: 'Raggedness of the block edges, in wiggles about a fifth of a block across' }),

    P.float('heights', 'Height variation', 1, 0, 4, { softMax: 1.5, step: 0.001, section: 'Relief', hint: 'How much the blocks differ in height' }),
    P.float('bed_relief', 'Bed relief', 0, 0, 2, { softMax: 1, step: 0.001, section: 'Relief', hint: 'Each bed (course, column) stands out or sinks back as a whole — hard beds weather proud, soft ones recede: ledges along the strata, columns of different heights' }),
    P.float('coherence', 'Height coherence', 0.3, 0, 1, { step: 0.001, section: 'Relief', hint: 'Neighbouring blocks share their heights: they follow broad swells across the rock, so only some joints step (ledges here and there) instead of every one' }),
    P.float('proud', 'Proud blocks', 1, 0, 1, { step: 0.001, section: 'Relief', hint: 'Share of the blocks that stand out or sink by their own height; the rest sit flush with their neighbours, parted only by the joints — as in most rock faces, where a step is the exception' }),
    P.float('tilt', 'Tilt', 0.8, 0, 2, { softMax: 1, step: 0.001, section: 'Relief', hint: 'Random slope of each block face' }),
    P.float('dip', 'Ledge dip', 0, -2, 2, { softMin: -1, softMax: 1, step: 0.001, section: 'Relief', hint: 'Every block leans across the bedding the same way: a saw-tooth of ledges, each with a drop along one side. Negative flips the side' }),
    P.float('pitch', 'Pitch', 0, -2, 2, { softMin: -1, softMax: 1, step: 0.001, section: 'Relief', hint: 'Every block leans along the bedding the same way: a saw-tooth along each course or column whose steps all face one way. Positive: the faces rise up the screen (columns) or to the right, and the breaks face up or right — lit caps under a light from the top left' }),
    P.float('bulge', 'Rounding', 0, -1, 2, { softMin: 0, softMax: 1, step: 0.001, section: 'Relief', hint: 'Rounds each block’s face (rubble, boulders, weathered columns). Below 0 the faces are scooped out instead: the shell-shaped scars where flakes spalled off' }),
    P.enum('crest', 'Rounding shape', 'dome', [
      ['dome', 'Dome', 'rounded all round, like a pillow or a boulder'],
      ['ridge', 'Ridge', 'a crest along the block and two faces falling away from it; its ends break off in a slope from the crest'],
      ['hex', 'Hexagonal prism', 'a hexagonal column lying along the bedding, each turned its own way (two or three faces showing); its ends break off in a sloping plane whose outline follows the hexagon'],
    ], { section: 'Relief', showIf: (p) => Number(p.bulge) > 0, hint: 'Ridges and prisms span their own course or column, whatever its width' }),
    P.float('scarp', 'Scarp width', 1.5, 0, 64, { softMax: 16, unit: 'px', step: 0.05, section: 'Relief', hint: 'How far a block’s side runs out over a lower neighbour, per full height step: 0 = sheer steps, more = sloping shelves' }),
    P.float('weather', 'Weathering', 0.6, 0, 64, { softMax: 12, unit: 'px', step: 0.05, section: 'Relief', hint: 'Rounds the blocks’ edges over this many px, inside and out: worn, pillowy shoulders instead of fresh, sharp breaks' }),
    P.float('corner', 'Corner rounding', 0, 0, 64, { softMax: 8, unit: 'px', step: 0.05, section: 'Relief', hint: 'Rounds the blocks’ corners in plan: each corner sinks away in a curve this wide and the cracks open up where blocks meet — pillows, rubble, worn cobbles' }),
    P.float('lean', 'Scarp lean', 0.3, -1, 1, { step: 0.001, section: 'Relief', hint: 'Scarps run out further below the blocks (on screen) and stand sheer above them: shaded shelves under every ledge, a crisp lit step on top. Negative flips it: sheer undersides that cast shadows, lit slopes up to the block above. Blocks only (facets don’t lean)' }),
    P.float('steps', 'Scarp steps', 0.6, 0, 1, { step: 0.001, section: 'Relief', hint: 'Breaks each block’s scarp into a staircase of thin plates — flat treads, steep risers — instead of one slope: flaky, shingled ledges, each edge with its own thin shadow' }),
    P.float('step_px', 'Step width', 2, 1, 32, { softMax: 12, unit: 'px', step: 0.05, section: 'Relief', showIf: (p) => Number(p.steps) > 0, hint: 'How far apart the scarp’s steps are, in px (each block varies it ±30 %)' }),
    P.int('detail', 'Facet levels', 3, 1, 3, { section: 'Relief', hint: 'Generations of blocks: each further level splits the faces into smaller facets (half the size; levels under ~8 px fade out)' }),
    P.float('facets', 'Facet strength', 0.4, 0, 1, { step: 0.001, section: 'Relief', showIf: (p) => Number(p.detail) > 1, hint: 'Relief of the finer facets relative to the blocks (halved again for each further level)' }),
    P.float('zones', 'Fracture zones', 0.7, 0, 1, { step: 0.001, section: 'Relief', showIf: (p) => Number(p.detail) > 1 || Number(p.rough) > 0, hint: 'The facets and roughness come and go across the rock in zones a few blocks wide: smooth, whole faces beside shattered, crumbly ones' }),
    P.float('rough', 'Roughness', 0.04, 0, 1, { step: 0.001, section: 'Relief', hint: 'Fine grainy unevenness over every face' }),
    P.float('rough_scale', 'Roughness size', 4, 1, 64, { softMax: 16, unit: 'px', step: 0.05, section: 'Relief', showIf: (p) => Number(p.rough) > 0 }),

    P.float('rills', 'Rills', 0, 0, 1, { step: 0.001, section: 'Surface', hint: 'Vertical flutes worn by running water: rounded channels between sharp crests, always down the screen' }),
    P.float('rill_space', 'Rill spacing', 3, 1, 64, { softMax: 12, unit: 'px', step: 0.05, section: 'Surface', showIf: (p) => Number(p.rills) > 0 }),
    P.float('rill_len', 'Rill length', 24, 2, 512, { softMax: 96, unit: 'px', step: 0.1, section: 'Surface', showIf: (p) => Number(p.rills) > 0 }),
    P.float('pits', 'Pits', 0, 0, 1, { step: 0.001, section: 'Surface', hint: 'Small round pits (vugs) scattered over the faces — not in the crevices or on the scarps' }),
    P.float('pit_size', 'Pit size', 1.2, 0.5, 16, { softMax: 4, unit: 'px', step: 0.05, section: 'Surface', showIf: (p) => Number(p.pits) > 0, hint: 'Radius of the biggest pits (each from a quarter of it to all of it, mostly small)' }),
    P.float('laminae', 'Laminae', 0, 0, 1, { step: 0.001, section: 'Surface', hint: 'Fine grooves along the bedding — the thin layers inside each bed — some deeper than others, fading in and out' }),
    P.float('lam_space', 'Lamina spacing', 3, 1, 64, { softMax: 12, unit: 'px', step: 0.05, section: 'Surface', showIf: (p) => Number(p.laminae) > 0, hint: 'Rounded so each bed holds a whole number of laminae' }),

    P.float('joint', 'Joint width', 0.6, 0, 32, { softMax: 6, unit: 'px', step: 0.05, section: 'Joints', hint: 'Open cracks along the joints between blocks (the creases where two blocks meet)' }),
    P.float('joint_open', 'Open joints', 0.35, 0, 1, { step: 0.001, section: 'Joints', showIf: (p) => Number(p.joint) > 0, hint: 'Share of the joints that open into cracks, each along its whole length; the rest stay closed — only a step or a crease, no bevel, and the blocks either side are one piece in the Shape Mask' }),
    P.float('joint_cross', 'Cross-joint width', 1.6, 0, 2, { step: 0.001, section: 'Joints', showIf: (p) => Number(p.joint) > 0, hint: 'Width of the joints across the bedding (block ends) relative to those along it: below 1, wide bedding cracks and thin cross cracks (slate); above 1, the other way (columns)' }),
    P.float('joint_facets', 'Facet joints', 0, 0, 1, { step: 0.001, section: 'Joints', showIf: (p) => Number(p.joint) > 0 && Number(p.detail) > 1, hint: 'Share of the borders between the first level of facets that crack too — hairlines, thinner and shallower than the joints; each cracks along its whole length or not at all' }),
    P.float('facet_break', 'Facet joint breakup', 0, 0, 1, { step: 0.001, section: 'Joints', showIf: (p) => Number(p.joint) > 0 && Number(p.joint_facets) > 0 && Number(p.detail) > 1, hint: 'Facet cracks fade in and out along their length (noise about half a block across): partial, hairline cracks inside the stones rather than whole straight ones' }),
    P.float('joint_var', 'Width variation', 0.8, 0, 1, { step: 0.001, section: 'Joints', showIf: (p) => Number(p.joint) > 0, hint: 'Each joint opens by its own share of the width (1 = from shut to fully open), and pinches and swells along its length (with Warp on)' }),
    P.float('joint_depth', 'Joint depth', 0.25, 0, 1, { step: 0.001, section: 'Joints', showIf: (p) => Number(p.joint) > 0 || Number(p.fractures) > 0, hint: 'How far the cracks (and the long fractures) sink below the faces' }),
    P.float('fractures', 'Long fractures', 0, 0, 1, { step: 0.001, section: 'Joints', hint: 'Long, straight cracks that cut across many blocks at their own angle (tectonic joints), each a few blocks long, in a lane of their own' }),
    P.float('frac_angle', 'Fracture angle', 70, -90, 90, { step: 0.1, unit: '°', section: 'Joints', showIf: (p) => Number(p.fractures) > 0, hint: 'Direction of the long fractures, clockwise from horizontal (each wanders a little)' }),
    // Not a control: 1 px of the texture in shader px. Supersampling scales every px param by k, so this tells the shader
    // how big a texture pixel is (the facets' pixel-scale fade, streak columns, the thinnest cracks).
    P.float('px_scale', 'Pixel scale', 1, 1, 8, { unit: 'px', step: 1, optimize: false, showIf: () => false }),
    P.enum('rnd_mode', 'Random value', 'block', [
      ['block', 'Per block', 'each block its own value'],
      ['bed', 'Per bed', 'each bed (course, column) its own value: colour bands along the strata. Angled strata that tile repeat their beds sooner'],
      ['mix', 'Per bed, varied', 'the bed’s value, each block shifted from it a little'],
      ['facet', 'Per facet', 'each facet of the first facet level its own value (blocks without facets: per block): patchwork colour'],
    ], { hint: 'The random value Diffuse › Random and Random jitter read' }),
    P.seed(),
  ],
  defaults: {
    bevel: 0,
    profile: 'round',
    aa: true,
    h_on: true,
    // Deep relief: ledges cast shadows a few px long (the default Block size is 16 px).
    h_amount: 5,
    dif_on: true,
    dif_grad: gradient('#3b3631', '#7d746a', '#a69c90'),
  },
  // Added in the editor: blocks a little over a tenth of the texture's mean side, the relief deepening with them.
  fresh: ({ width, height }) => {
    const size = Math.round(Math.min(48, Math.max(6, Math.sqrt(width * height) * 0.12)) * 10) / 10
    return { size, h_amount: Math.round(size * 3.2) / 10, detail: size >= 14 ? 3 : 2 }
  },
  // Relief is the height; scarps and crevices are masks for paint (their coverage is their value, so a colour lands only
  // on them): scarps darken the faces they cover, crevices fill with moss.
  linkedDefaults: (p) => ({
    ...(p.output === 'scarps'
      ? { h_on: false, dif_blend: 'multiply', dif_grad: gradient('#ffffff', '#7a6a58') }
      : p.output === 'crevices'
        ? { h_on: false, dif_blend: 'normal', dif_grad: gradient('#3a3a1c', '#4e5226') }
        : p.output === 'streaks'
          ? { h_on: false, dif_blend: 'multiply', dif_grad: gradient('#ffffff', '#6a5e50') }
        : { h_on: true, dif_blend: 'normal', dif_grad: gradient('#3b3631', '#7d746a', '#a69c90') }),
    ...Object.fromEntries(STYLE_KEYS.map((k) => [k, rockLayer.params.find((d) => d.key === k)!.default])),
    ...STYLES[String(p.style)],
  }),
  glsl:
    ORG_GLSL +
    ORG_GLSL_SDF +
    /* glsl */ `
// Seamless key of a lattice cell. The tile's two periods move the cells by (nu, ks) and (−kU, nv): a lattice whose
// Hermite basis is (g, B), (0, C) — u wraps every g cells shifting the rows by B, v every C rows (rk_basis). rk_wrap
// reduces a cell by that basis: rk_wrap(c, ivec2(g, C), B).
ivec2 rk_wrap(ivec2 c, ivec2 n, int k) {
  if (!uTile) return c;
  int i = imod(c.x, n.x);
  int q = (c.x - i) / n.x;
  return ivec2(i, imod(c.y - q * k, n.y));
}

// Hermite basis of the lattice generated by (a, ks) and (−kU, nv), a > 0: (g, B, C). Extended Euclid on a and −kU.
ivec3 rk_basis(int a, int ks, int kU, int nv) {
  if (kU == 0) return ivec3(a, ks, nv);
  int r0 = a, r1 = -kU, s0 = 1, s1 = 0, t0 = 0, t1 = 1;
  // Loop bounds from a uniform (ORG_1): D3D unrolls constant ones, and every unrolled copy costs compile time.
  for (int i = 0; i < 40 * ORG_1; i++) {
    if (r1 == 0) break;
    int q = r0 / r1;
    int r2 = r0 - q * r1, s2 = s0 - q * s1, t2 = t0 - q * t1;
    r0 = r1; r1 = r2; s0 = s1; s1 = s2; t0 = t1; t1 = t2;
  }
  if (r0 < 0) { r0 = -r0; s0 = -s0; t0 = -t0; }
  // s0 a + t0 (−kU) = g: (g, s0 ks + t0 nv) is in the lattice; so is (0, (a nv + ks kU) / g).
  int C = abs((a * nv + ks * kU) / r0);
  return ivec3(r0, imod(s0 * ks + t0 * nv, max(C, 1)), max(C, 1));
}

// A joint between the two highest blocks a and b, d px from their crease: (crack coverage, signed distance — negative
// on the blocks). Each joint (pair of blocks) is open with probability keep, by its own share of the width; a closed
// one doesn't part the blocks (far inside: no bevel, one piece in the Shape Mask). Without cracks (width 0) every crease
// outlines its blocks.
vec2 rk_joint(float d, ivec2 a, ivec2 b, float width, float keep, float seed) {
  if (width <= 0.0) return vec2(0.0, -d);
  ivec2 lo = (a.x < b.x || (a.x == b.x && a.y < b.y)) ? a : b;
  ivec2 hi = lo == a ? b : a;
  vec2 hp = hash2I(lo * 7919 + hi, seed);
  if (hp.y >= keep) return vec2(0.0, -1e3);
  float jw = width * (1.0 - u_joint_var * hp.x);
  // Under a pixel wide, a crack stays one pixel wide and fades with its width (a box filter): no dotted lines.
  float cut = u_aa ? org_line(d, max(jw, 1.0), 0.0) * min(jw, 1.0) : (d < 0.5 * jw ? 1.0 : 0.0);
  return vec2(cut, 0.5 * jw - d);
}

// Round to the nearest whole number, ties down. Snapped counts are often exact halves (ratios of whole numbers), and
// floor(x + 0.5) then rounds them by the GPU's last-bit error — differently on D3D and OpenGL: another lattice.
float rk_round(float x) { return floor(x + 0.499); }

// Distance from a point to a convex corner, from its signed distances a, b to the corner's two lines (> 0 outside) and
// the cosine c between their normals: the nearer edge where the point projects onto it, else the vertex — exact at any
// angle (|(a, b)| holds only at right angles: 22 % too far at 120°).
float rk_corner(float a, float b, float c) {
  if (a <= 0.0 && b <= 0.0) return max(a, b);
  if (a > 0.0 && b <= c * a) return a;
  if (b > 0.0 && a <= c * b) return b;
  return sqrt(max((a * a + b * b - 2.0 * c * a * b) / max(1.0 - c * c, 1e-4), 0.0));
}

// valueNoise without the animation (its Phase code costs compile time here); the same values at Phase 0.
float rk_vnoise(vec2 x, ivec2 per, float seed) {
  ivec2 i = ivec2(floor(x));
  vec2 f = fract(x);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hashI(imod(i, per), seed), b = hashI(imod(i + ivec2(1, 0), per), seed);
  float c = hashI(imod(i + ivec2(0, 1), per), seed), d = hashI(imod(i + ivec2(1, 1), per), seed);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Weathered shoulder: the drop below a block's face at signed px distance s from its border (> 0 outside), rounded over
// ±r px (C¹; r = 0 gives max(s, 0), a sharp break).
float rk_shoulder(float s, float r) {
  if (r <= 0.0) return max(s, 0.0);
  return s >= r ? s : s <= -r ? 0.0 : (s + r) * (s + r) / (4.0 * r);
}

GenOut gen(vec2 p) {
  // Strata frame: within 45° of horizontal, u = x / W along the bedding and v = (y + t x) / H across it (a shear: rows
  // keep whole cell counts per tile, so any angle tiles once t is snapped). Steeper bedding turns the frame 90°.
  float ang = clamp(u_angle, -90.0, 90.0);
  bool vert = abs(ang) > 45.0;
  vec2 span = vert ? uRes.yx : uRes;
  float a = radians(vert ? ang - sign(ang) * 90.0 : ang);
  float T = max(u_size, 1.0);
  float pxs = max(u_px_scale, 1.0);
  float H = T / cos(a);
  float nv0 = span.y / H;
  float nv = uTile ? max(1.0, rk_round(nv0)) : nv0;
  H = span.y / nv;
  float ks = span.x * tan(a) / H;
  if (uTile) ks = rk_round(ks);
  // Distinct beds on the torus (gcd of the shear and the bed count; all of them without a shear).
  // Stagger alternates the rows, so it wants an even count of distinct beds (an odd one leaves a fault every gR rows).
  if (uTile && ks == 0.0 && u_stagger > 0.0 && nv > 0.5 && imod(int(nv + 0.5), 2) == 1) {
    // (Towards the unsnapped count, by a margin: a tie would be broken by the GPU's last bit.)
    nv += nv < 1.5 || nv0 > nv + 0.01 ? 1.0 : -1.0;
    H = span.y / nv;
  }
  int bedsG = int(nv + 0.5), bS = 0;
  if (uTile && ks != 0.0) {
    // On the torus a bed sheared by ks rows across the tile joins bed j + ks, so only gcd(ks, nv) beds are distinct — at
    // 1, one bed spirals through the whole tile and per-bed colour, bed relief and row thickness vanish. Nudge the bed
    // count (thickness, ±2) and the shear (angle, ±1) to the nearby pair with the most distinct beds (up to 6), preferring
    // to change the thickness.
    // One flat loop: 15 candidates × 24 Euclid steps (a gcd loop called inside the candidate loop multiplied on D3D).
    // Extended: sa |k2| + t n2 = gcd, for the merge domain's basis (bS, below).
    float bestS = -1e9, n2 = nv, k2 = ks;
    vec2 bestP = vec2(nv, ks);
    int ga = 0, gb = 0, sa = 1, sb = 0;
    bool ok = false;
    for (int it = 0; it < 15 * 24 * ORG_1; it++) {
      int i = it / 24, st = it - i * 24;
      if (st == 0) {
        n2 = nv + float(i % 5 - 2);
        k2 = ks + float(i / 5 - 1);
        ok = n2 >= 1.0 && k2 != 0.0 && sign(k2) == sign(ks);
        ga = abs(int(k2));
        gb = int(n2);
        sa = 1;
        sb = 0;
      }
      if (!ok) continue;
      if (gb != 0) { int q = ga / gb, r = ga - q * gb, sn = sa - q * sb; ga = gb; gb = r; sa = sb; sb = sn; }
      if (st < 23) continue;
      float sc = min(float(max(ga, 1)), 6.0) - 0.4 * abs(n2 - nv) - 1.5 * abs(k2 - ks)
               + (u_stagger > 0.0 && ga % 2 == 0 ? 2.0 : 0.0);
      if (sc > bestS) { bestS = sc; bestP = vec2(n2, k2); bedsG = max(ga, 1); bS = k2 < 0.0 ? -sa : sa; }
    }
    nv = bestP.x;
    ks = bestP.y;
    H = span.y / nv;
  }
  float t = ks * H / span.x;
  // Cross joints run along (s, 1) in the frame: u = (q.x − s q.y) / W. Square to the strata is s = t; the lean turns
  // them from there. A block is W √(1 + t²) / (1 + s t) long along the bedding: W is set so that length is the elongation
  // × the thickness. When tiling, s is then snapped so u moves a whole kU cells over the tile's height.
  float s = tan(clamp(atan(t) + radians(u_cross), -1.4, 1.4));
  float W = T * max(u_elong, 0.2) * max(1.0 + s * t, 0.1) / sqrt(1.0 + t * t);
  float nu = uTile ? max(1.0, rk_round(span.x / W)) : span.x / W;
  W = span.x / nu;
  ivec2 nCells = ivec2(int(nu + 0.5), int(nv + 0.5));
  int kShear = int(ks);
  float kUf = uTile ? rk_round(s * span.y / W) : 0.0;
  if (uTile) s = kUf * W / span.y;
  int kU = int(kUf);
  // Rows (courses, columns) get their own thickness: a row's offset repeats every gR rows, which keeps it seamless
  // where the shear carries row j across the tile edge into row j + kShear.
  int gR = uTile ? bedsG : 1 << 20;

  // The noise, in one flat loop (one copy of its code; see ORG_1): the strata warp (x, y), the edge jaggies (x, y), the
  // roughness, the rills' meander, a breakup (laminae, crevice patches, pit clusters), the fracture zones, the folds and
  // the facet cracks' breakup.
  vec2 wv = vec2(0.5), jv = vec2(0.5);
  float rn = 0.5, rl = 0.5, lb = 1.0, zn = 0.5, fd = 0.5, fb = 1.0;
  for (int e = 0; e < 10 * ORG_1; e++) {
    int kind = e < 5 ? e / 2 : e - 2;
    float amt = kind == 0 ? u_warp : kind == 1 ? max(u_jag, u_steps) : kind == 2 ? u_rough : kind == 3 ? u_rills
              : kind == 4 ? max(max(u_laminae, u_pits), u_output == 2 ? u_crev_patch : 0.0) : kind == 5 ? u_zones
              : kind == 6 ? u_fold : u_facet_break * u_joint_facets;
    if (amt <= 0.0) continue;
    float cellPx = kind == 0 ? 1.5 * T * max(u_elong, 1.0) : kind == 1 ? max(0.2 * T, 1.5 * pxs) : kind == 2 ? max(u_rough_scale, 1.0)
                 : kind == 3 ? max(u_rill_len, 2.0) : kind == 4 ? 2.0 * T * max(u_elong, 1.0) : kind == 5 ? 3.0 * T * max(u_elong, 1.0)
                 : kind == 6 ? uRes.x / max(u_fold_scale, 0.5) : 0.5 * T;
    // (The folds' counts come from their scale itself, halves rounded up: through the division the default 1.5 lands on
    // a tie, which floor(x + 0.5) rounds by the GPU's last-bit error. Sharp folds get down to a quarter of the cells down
    // the texture: the noise varies mostly across it, so the chevrons' hinges stack on near-vertical lines.)
    vec2 fc2 = vec2(1.0, uRes.y / uRes.x * (1.0 - 0.75 * u_fold_sharp)) * u_fold_scale;
    vec2 nc = kind == 6 ? (uTile ? max(vec2(1.0), floor(fc2 + 0.501)) : max(fc2, vec2(1e-3))) : cellsFor(uRes.x / cellPx, 1.0);
    vec2 x = p / uRes * nc + (e % 2 == 1 ? 17.3 : 0.0);
    // Perlin for the smooth fields (warp, roughness, meander); value noise for the pixel jaggies and the breakups.
    float n = org_noiseFbm(kind == 0 || kind == 2 || kind == 3 ? 1 : 0, false, x, org_per(nc), kind == 0 || kind == 3 ? 2 : 3, 0.5, uSeed + 11.0 + float(e) * 13.0);
    if (e == 0) wv.x = n;
    else if (e == 1) wv.y = n;
    else if (e == 2) jv.x = n;
    else if (e == 3) jv.y = n;
    else if (e == 4) rn = n;
    else if (e == 5) rl = n;
    else if (e == 6) lb = n;
    else if (e == 7) zn = n;
    else if (e == 8) fd = n;
    else fb = n;
  }
  // Fracture zones: a multiplier on the facets and roughness, 0 in the whole zones and 2 in the shattered ones (mean 1).
  float zf = mix(1.0, 2.0 * smoothstep(0.38, 0.62, zn), u_zones);
  vec2 pw = p + (wv - 0.5) * 2.0 * u_warp * T + (jv - 0.5) * 2.0 * u_jag;
  vec2 q = vert ? vec2(pw.y, -pw.x) : pw;
  vec2 f = vec2((q.x - s * q.y) / W, (q.y + t * q.x) / H);
  // Folds: a broad, smooth shift across the bedding (in beds). Sharpness folds the noise about its mean (≈ 0.5 ± 0.25):
  // 2 (⅛ − |n − ½|) has a V-shaped hinge wherever the noise crosses its mean — chevron folds — at about the same amplitude.
  float fn = fd - 0.5;
  f.y += 2.0 * u_fold * mix(fn, 2.0 * (0.125 - abs(fn)), u_fold_sharp);

  // Bedding: sites keep to their rows, and distances across the bedding count kb× (flat course joints). Distances are
  // taken in that metric, F = (u, kb v); power weights (size variation) let some blocks grow.
  float kb = 1.0 + 2.0 * u_bedding;
  vec2 K = vec2(1.0, kb);
  // Sites wander across their row by less as kb grows (the metric magnifies it kb²×: joints within a course would lean);
  // whole rows shift instead, so courses and columns differ in thickness but keep straight sides.
  vec2 jit = vec2(u_jitter, u_jitter * (1.0 - u_bedding) * 0.9 / (kb * kb));
  float jRow = u_jitter * u_bedding * 0.8;
  float wsc = u_size_var * 0.5 * kb;
  float scarp = max(u_scarp, 0.05);
  // Height coherence: block heights partly follow a smooth swell (value noise in px, ~3 block lengths across).
  vec2 swc = cellsFor(uRes.x / (3.0 * T * max(u_elong, 1.0)), 1.0);

  // Each generation: the nearest site (3×3 cells), then the mesas of the 5×5 cells around it. A mesa is the block's
  // face — height, tilt, dip, rounding — inside its cell; outside, the face at its nearest border point minus the px
  // distance from that border over the scarp width. The surface is the highest mesa; in the first two generations the
  // two highest give the crease (joint) distance and which joint it is. Where the highest is another cell's skirt, the
  // pixel lies on a scarp.
  float relief = 0.0, scarps = 0.0, scarpsAll = 0.0, rnd = 0.0, rndF = -1.0, stepH = 0.0, wu = 0.0;
  ivec2 rowK = ivec2(0);
  vec2 dc = vec2(1e4);
  ivec2 c1 = ivec2(0), c2 = ivec2(0), c3 = ivec2(0), c4 = ivec2(0), o1 = ivec2(0), o2 = ivec2(0);
  vec2 s1 = vec2(0.0), s2 = vec2(1.0, 0.0), x1 = vec2(0.0), x2 = vec2(1.0, 0.0);
  vec2 fo = f, Fo = f, Sb = f;
  ivec2 ip = ivec2(0), bc = ivec2(0);
  float best = 1e20, bw = 0.0, pb1 = -1e9, pb2 = -1e9, amp = 1.0, m = 1.0, wd = -1.0;
  // The second and third nearest sites (for the skirts' distances).
  float best2 = 1e20, best3 = 1e20, w2 = 0.0, w3 = 0.0;
  vec2 S2 = vec2(0.0), S3 = vec2(0.0);
  ivec2 c2n = ivec2(0), c3n = ivec2(0);
  // Finer generations split each block mx × m ways: about square facets (mx = m × the elongation, whole).
  float mx = 1.0, E = max(1.0, rk_round(u_elong));
  ivec3 wrapB = ivec3(1);
  ivec3 wrap0 = uTile ? rk_basis(nCells.x, kShear, kU, nCells.y) : ivec3(1);
  // The block the pixel is in: its face and crest (its drop needs the distance to its nearest border: after the loop).
  float ownFace = 0.0, ownCrest = 0.0, din = 1e4, dinRun = 1.0, dinEnd = 0.0, ownRnd = 0.0;
  ivec2 dinC = ivec2(0);
  ivec2 ownC = ivec2(0), ownRow = ivec2(0);
  vec2 ownS = vec2(0.0);
  // Weathering rounds facets by their share of the relief: at full radius every facet border would become a groove.
  float wr = max(u_weather, 0.0);
  float kC = max(u_corner, 0.0), din2 = 1e4, dcR = 0.0, dTop = 1e4;
  vec2 dinN = vec2(1.0, 0.0), dinN2 = vec2(0.0, 1.0);
  bool prism = u_crest > 0 && u_bulge > 0.0;
  // Merge: the nearest block's 2 × 2 group and whether it is fused (blocks only).
  ivec2 bg0 = ivec2(0);
  // A fused group's four sites (xy) and weights (z).
  vec3 M0 = vec3(0.0), M1 = M0, M2 = M0, M3 = M0;
  bool bmg = false, merging = u_merge > 0.0 && !prism;
  // Groups are 2 × 2 cells of the tile's lattice reduced to one domain, whole groups only. rk_wrap's domain is
  // gcd(nu, kU) cells wide — one when they are coprime (as at the defaults), and then no group is whole; reduced by the
  // rows first (rk_basis on the transposed lattice) it is gcd(ks, nv) rows high. Groups use whichever holds more.
  ivec2 dimM = wrap0.xz;
  ivec3 wrapT = ivec3(1);
  bool mT = false;
  if (uTile && merging) {
    // The transposed lattice's Hermite basis (y first): (gR, B), (0, C) — from the bed search's extended Euclid
    // (bS ks + t nv = gR), not a second Euclid loop (~0.1 s of D3D compile).
    if (kShear == 0) wrapT = ivec3(nCells.y, -kU, nCells.x);
    else {
      int tB = (bedsG - bS * kShear) / nCells.y;
      wrapT = ivec3(bedsG, bS * nCells.x - tB * kU, max(abs(nCells.x * nCells.y + kU * kShear) / bedsG, 1));
    }
    ivec2 dT = ivec2(wrapT.z, wrapT.x);
    vec2 a0 = vec2(dimM - imod(dimM, ivec2(2))) / vec2(dimM), aT = vec2(dT - imod(dT, ivec2(2))) / vec2(dT);
    mT = aT.x * aT.y > a0.x * a0.y;
    if (mT) dimM = dT;
  }
  // Generations: the detail, less the last when it fades out entirely (see amp; the first facets stay for the facet
  // joints and values). It bounds the loop: breaking out of it instead cost 0.3 s of D3D compile.
  int nGen = min(u_detail > 2 && (u_facets <= 0.0 || zf <= 0.0 || T <= 16.0 * pxs) ? 2 : u_detail, 3);
  for (int e = 0; e < nGen * 38 * ORG_1; e++) {
    int o = e / 38, g = e - o * 38;
    if (g == 0) {
      m = float(1 << o);
      mx = o == 0 ? 1.0 : m * E;
      // Facets under ~8 px fade out: at pixel scale they read as a grid of bumps (Roughness is for that grain).
      amp = o == 0 ? 1.0 : u_facets * pow(0.5, float(o - 1)) * zf * smoothstep(4.0 * pxs, 8.0 * pxs, T / m);
      // Facets are fractures, not beds: the finer generations keep only 40 % of the bedding (or they line up in rows of
      // little bricks).
      float bed = o == 0 ? u_bedding : 0.4 * u_bedding;
      kb = 1.0 + 2.0 * bed;
      K = vec2(1.0, kb);
      jit = vec2(u_jitter, u_jitter * (1.0 - bed) * 0.9 / (kb * kb));
      jRow = u_jitter * bed * 0.8;
      wsc = u_size_var * 0.5 * kb;
      // Finer generations are offset from the blocks (a translation keeps them seamless): nested exactly, their rows
      // would fall on the block rows and stack their scarps along every course joint.
      fo = f * vec2(mx, m) + vec2(0.37, 0.5) * float(o);
      // This generation's lattice is the blocks' scaled by (mx, m) per axis, so its basis is theirs scaled.
      ivec2 sc = ivec2(int(mx + 0.5), 1 << o);
      wrapB = ivec3(wrap0.x * sc.x, wrap0.y * sc.y, wrap0.z * sc.y);
      Fo = fo * K;
      ip = ivec2(floor(fo));
      best = 1e20; best2 = 1e20; best3 = 1e20; pb1 = -1e9; pb2 = -1e9; wd = -1.0; din = 1e4; din2 = 1e4;
    }
    // Then, around a fused block, its group's four sites (for the skirts' distance, below).
    bool near = g < 9, mate = g >= 9 && g < 13;
    ivec2 c = near ? ip + ivec2(g % 3 - 1, g / 3 - 1) : mate ? bg0 + ivec2((g - 9) % 2, (g - 9) / 2)
            : bc + ivec2((g - 13) % 5 - 2, (g - 13) / 5 - 2);
    ivec2 cw = rk_wrap(c, wrapB.xz, wrapB.y);
    float sd = uSeed + float(o) * 101.0;
    vec3 h = hash3I(cw, sd);
    vec3 h2 = hash3I(cw, sd + 37.0);
    // Merge: a fused group's blocks take one set of face values from the group (sites, and so the joints, stay their own).
    // cg: the cell in the merge domain (see dimM). Only whole 2 × 2 groups: with an odd count of columns or rows, the
    // last group at the wrap has one.
    ivec2 cg = mT ? rk_wrap(c.yx, wrapT.xz, wrapT.y).yx : cw;
    ivec2 grp = (cg - imod(cg, ivec2(2))) / 2;
    bool mg = o == 0 && merging && hashI(grp, sd + 131.0) < u_merge
              && (!uTile || (grp.x * 2 + 1 < dimM.x && grp.y * 2 + 1 < dimM.y));
    // A fused group's identity: its group, apart from the blocks' keys (cells lie well within ±2²⁰).
    ivec2 gid = ivec2(grp.x - (1 << 20), grp.y);
    vec3 hf = mg ? hash3I(grp, sd + 141.0) : h;
    vec3 hf2 = mg ? hash3I(grp, sd + 178.0) : h2;
    float hr = hashI(ivec2(imod(c.y, gR * (1 << o)), o), uSeed + 71.0) - 0.5;
    // Stagger (blocks): every other row shifts half a cell along the bedding (a running bond), its wander shrinking to fit
    // the 3 × 3 search. Its parity repeats every gR rows like the row offsets (an odd gR leaves one fault per gR rows).
    float stg = o == 0 ? u_stagger : 0.0;
    vec2 S = (vec2(c) + 0.5 + (h.xy - 0.5) * jit * vec2(1.0 - 0.5 * stg, 1.0)
              + vec2(0.5 * stg * (float(imod(imod(c.y, gR), 2)) - 0.5), hr * jRow)) * K;
    float w = (h2.z - 0.5) * wsc;
    // (No continue in this loop: on D3D each one costs compile time.)
    if (mate) {
      vec3 Mi = vec3(S, w);
      if (g == 9) M0 = Mi; else if (g == 10) M1 = Mi; else if (g == 11) M2 = Mi; else M3 = Mi;
    } else if (near) {
      float dd = dot(S - Fo, S - Fo) - w;
      if (dd < best) {
        best3 = best2; S3 = S2; w3 = w2; c3n = c2n;
        best2 = best; S2 = Sb; w2 = bw; c2n = bc;
        best = dd; Sb = S; bw = w; bc = c; bmg = mg; bg0 = c - imod(cg, ivec2(2));
      } else if (dd < best2) {
        best3 = best2; S3 = S2; w3 = w2; c3n = c2n;
        best2 = dd; S2 = S; w2 = w; c2n = c;
      } else if (dd < best3) { best3 = dd; S3 = S; w3 = w; c3n = c; }
    } else {
      // Another cell of the pixel's own fused group: its border is no border (no weathering, no crease).
      // (In the frame: comparing the reduced groups misfires in tiny tiles, where a wrapped copy lies in the window.)
      bool inner = bmg && all(greaterThanEqual(c - bg0, ivec2(0))) && all(lessThan(c - bg0, ivec2(2)));
      // The face's origin: the site, or the group's centre (in c's frame: cg plus the wrap offset c − cg).
      vec2 So = mg ? (vec2(grp * 2 + (c - cg)) + 1.0) * K : S;
      // Power bisectors (g < 0 on the near site's side) and their px distances through the frame's transpose
      // (F = K (mx (q.x − s q.y) / W, m (q.y + t q.x) / H)). Fb: the nearest point of this cell's border.
      vec2 Fb = Fo;
      // Facets' scarps run out twice as far (soft creases rather than one-pixel cracks) and don't lean: lean is the
      // bedding's ledges.
      float run0 = o == 0 ? scarp : 2.0 * scarp, lean = o == 0 ? u_lean : 0.0;
      float dout = 0.0, dB = 0.0, run = run0, endK = 0.0, up = 0.0;
      if (c != bc) {
        // The skirt's distance: from the pixel to this cell, as the farthest of its borders with the pixel's three nearest
        // sites (k = 0 the nearest). The border with the nearest alone is exact only for cells next to the pixel's; for the
        // others it underestimates, and jumps where the nearest site changes — steps in the skirts. Across a Voronoi edge
        // the three nearest stay the same three, so the farthest of their borders doesn't jump. In a fused group the three
        // are often all mates, far from this cell: a fourth, the mate nearest it, gives its border with the group (without
        // it a taller neighbour's skirt showed through the group in thin wedges). One copy of the code (a loop bound from a
        // uniform).
        ivec2 dm = clamp(c - bg0, ivec2(0), ivec2(1));
        vec3 Mk = dm.y == 0 ? (dm.x == 0 ? M0 : M1) : (dm.x == 0 ? M2 : M3);
        bool useM = bmg && bg0 + dm != bc && bg0 + dm != c;
        // A fused cell's own mates share its face: their borders are no corners (taken for corners, the rounding pulled
        // the skirt away from the block where an inner border meets the group's outline). They still bound the distance.
        ivec2 cg0 = c - imod(cg, ivec2(2));
        vec2 N = vec2(1.0, 0.0), nPx = vec2(1.0, 0.0), N0 = N, nPx0 = nPx, nPx2 = vec2(0.0, 1.0);
        float gb = 0.0, sgn = -1e9, sgnR = -1e9, sgn2 = -1e9, sgn0 = 0.0;
        vec2 nPxR = nPx;
        for (int k = 0; k < 4 * ORG_1; k++) {
          vec2 Sk = k == 0 ? Sb : k == 1 ? S2 : k == 2 ? S3 : Mk.xy;
          float wk = k == 0 ? bw : k == 1 ? w2 : k == 2 ? w3 : Mk.z;
          ivec2 ck = k == 0 ? bc : k == 1 ? c2n : c3n;
          ivec2 dk = ck - cg0;
          bool skip = k == 3 ? !useM : k > 0 && (ck == c || (k == 1 ? best2 : best3) > 1e19);
          bool mateK = mg && k > 0 && k < 3 && all(greaterThanEqual(dk, ivec2(0))) && all(lessThan(dk, ivec2(2)));
          vec2 Nk = S - Sk;
          // (From the sites' midpoint: |F|² − |S|² cancels badly far from the origin, and the borders jitter.)
          float gk = dot(Fo - 0.5 * (S + Sk), Nk) + 0.5 * (w - wk);
          vec2 nk = vec2(mx * Nk.x / W + t * kb * m * Nk.y / H, kb * m * Nk.y / H - s * mx * Nk.x / W);
          float sk = skip ? -1e9 : -gk / max(length(nk), 1e-6);
          if (k == 0) { sgn0 = sk; N0 = Nk; nPx0 = nk; }
          if (sk > sgn) { sgn = sk; gb = gk; N = Nk; nPx = nk; }
          // The two farthest borders other than mates' (the corner rounding's).
          float skR = mateK ? -1e9 : sk;
          if (skR > sgnR) { sgn2 = sgnR; nPx2 = nPxR; sgnR = skR; nPxR = nk; }
          else if (skR > sgn2) { sgn2 = skR; nPx2 = nk; }
        }
        dout = max(sgn, 0.0);
        dB = dout;
        // Rounded corners (blocks), outside: within kC of two of this cell's borders, the distance to its corner rounded
        // by kC — the exterior of the rounded box the pixel's own block uses inside (at g == 37), so a skirt meets the
        // rounded shoulder across the border without a lip. The borders' normals point into this cell, the own block's out
        // of it: the same angle between them.
        if (o == 0 && kC > 0.0 && sgn2 > -kC) {
          float cn = dot(nPxR, nPx2) / max(length(nPxR) * length(nPx2), 1e-6);
          float turnO = 1.0 - smoothstep(0.82, 0.96, cn);
          // (Acute corners keep the right-angle form: exact, they'd jump where the second border comes within kC.)
          dout = mix(dout, max(dout, rk_corner(sgnR + kC, sgn2 + kC, max(cn, 0.0)) - kC), turnO);
        }
        Fb = Fo - min(gb, 0.0) / max(dot(N, N), 1e-6) * N;
        // 1 where this border is one of the block's ends (across the bedding), 0 along its sides.
        endK = abs(N.x) / max(length(N), 1e-6);
        // Lean: a skirt running down the screen (this block lies above the pixel) runs out further. nPx points from the
        // pixel's side towards this cell, in q; q.x is the screen's y in the turned frame. The sheer side keeps a quarter
        // of the run: a step in one pixel lights as a dotted line of single bright pixels.
        up = (vert ? nPx.x : nPx.y) / max(length(nPx), 1e-6);
        run *= max(1.0 + lean * up, 0.25);
        // The pixel's own block, seen from its border with this one (k = 0): inside it by sgn0 px. Its run is the
        // opposite lean's.
        // In a fused group the nearest site's bisectors cut through the group (its mates' cells are the block too): there
        // the farthest of the three borders, as for the skirts.
        if (bmg) { sgn0 = sgn; N0 = N; nPx0 = nPx; }
        float up0 = (vert ? nPx0.x : nPx0.y) / max(length(nPx0), 1e-6);
        if (!inner) {
          // The two nearest borders (corner rounding needs both).
          vec2 nn = nPx0 / max(length(nPx0), 1e-6);
          float endK0 = abs(N0.x) / max(length(N0), 1e-6);
          if (sgn0 < din) { din2 = din; dinN2 = dinN; din = sgn0; dinN = nn; dinRun = run0 * max(1.0 - lean * up0, 0.25); dinEnd = endK0; dinC = cw; }
          else if (sgn0 < din2) { din2 = sgn0; dinN2 = nn; }
          // The block's top edge (its neighbour lies above on screen): where streaks start.
          if (o == 0 && up0 > 0.4) dTop = min(dTop, max(sgn0, 0.0));
        }
      }
      vec2 df = (Fb - So) / K;
      float ta = hf2.x * TAU;
      float dome = 1.0 - (mg ? 1.0 : 4.0) * dot(df, df), domeMax = 1.0;
      if (u_crest > 0 && u_bulge > 0.0) {
        // Ridges and prisms span their own row, between the midpoints to the rows either side (rows shift by jRow).
        float hm = hashI(ivec2(imod(c.y - 1, gR * (1 << o)), o), uSeed + 71.0) - 0.5;
        float hp = hashI(ivec2(imod(c.y + 1, gR * (1 << o)), o), uSeed + 71.0) - 0.5;
        float lo = float(c.y) + 0.5 * (hm + hr) * jRow, hi = float(c.y) + 1.0 + 0.5 * (hr + hp) * jRow;
        float y = (Fb.y / kb - 0.5 * (lo + hi)) / max(hi - lo, 0.05);
        if (u_crest == 1) dome = 1.0 - 2.0 * abs(y);
        else {
          // Upper hull of a hexagon (circumradius ½ the row, turned 0–60°): the lowest of its three upward faces'
          // heights; the faces' slopes are capped so the side walls stay steep but finite.
          float th = fract(h2.x * 7.31 + h.y * 3.7) * 1.0471976;
          float s0 = sin(th), c0 = cos(th);
          vec3 sn = vec3(s0, 0.5 * s0 + 0.8660254 * c0, 0.8660254 * c0 - 0.5 * s0);
          vec3 cn = vec3(c0, 0.5 * c0 - 0.8660254 * s0, -0.5 * c0 - 0.8660254 * s0);
          vec3 zz = (0.4330127 - cn * y) / max(sn, 0.25);
          dome = 2.0 * min(zz.x, min(zz.y, zz.z));
          domeMax = max(c0, 0.8660254 * s0 + 0.5 * c0);
        }
      }
      // Height coherence: the blocks' own heights shrink; the shared swell is added once, after the loop (see there).
      float hz = (hf.z - 0.5) * (o == 0 ? 1.0 - u_coherence : 1.0);
      // Proud blocks: only this share of the blocks keep their own height; the rest sit flush (with the swell).
      if (o == 0 && fract(hf.z * 91.7 + hf2.x * 3.1) >= u_proud) hz = 0.0;
      // Facets differ mostly by their tilt: crumpled planes meeting in creases. Their own heights stay small, or every
      // facet lower than its neighbours turns into a pit.
      if (o > 0) hz *= 0.5;
      // Bed relief: the row's own offset (blocks only), repeating every gR rows like its thickness. A fused group takes
      // its first row's (it spans two).
      int rowC = mg ? c.y - imod(cg.y, 2) : c.y;
      float bedOff = o == 0 ? u_bed_relief * (hashI(ivec2(imod(rowC, gR), 9), uSeed + 191.0) - 0.5) : 0.0;
      // Pitch: in the turned frame (columns) u runs up the screen; otherwise along the strata, rightwards.
      float face = bedOff + u_heights * hz + u_tilt * hf2.y * dot(vec2(cos(ta), sin(ta)), df) - u_dip * df.y + u_pitch * df.x + u_bulge * (dome - 0.5);
      float crest = face + u_bulge * (domeMax - dome);
      if (c == bc) {
        ownFace = amp * face; ownCrest = amp * crest; ownC = mg ? gid : cw; ownS = S; ownRnd = fract(hf2.z * 7.13 + hf.z);
        ownRow = ivec2(imod(rowC, gR), 0);
      } else if (!inner) {
        // (A fused group's other cells share its face, which the pixel's own block already carries: left out, so they
        // can't stand second-highest at the group's outer border and hide the crease there.)
        // Scarp steps (blocks): the distance from the border as a staircase — flat treads, risers over the last 35 % of
        // each step — each block with its own step width (±30 %) and phase, the edges wobbling with the jaggies' noise.
        // Measured from the border (before corner rounding, which is added on top), so the face meets its skirt there
        // unchanged, rounded corners too. A fused group's cells share one staircase (the group's hashes).
        float dS = dout;
        if (o == 0 && u_steps > 0.0) {
          float sp = max(u_step_px, pxs) * (0.7 + 0.6 * fract(hf2.x * 23.17 + hf.y));
          float x0 = fract(hf.x * 13.7 + hf2.z) + 0.8 * (jv.x - 0.5), x = x0 + dB / sp;
          float stair = floor(x) + smoothstep(0.65, 1.0, fract(x)) - floor(x0) - smoothstep(0.65, 1.0, fract(x0));
          dS = mix(dout, max(stair * sp, 0.0) + dout - dB, u_steps);
        }
        float drop = rk_shoulder(dS, wr * min(amp, 1.0)) / run;
        // A prism breaks off at its ends in a plane sloping from its crest: the lower of that plane and the prism, so
        // the cap's outline follows the prism's profile. Along its sides it falls away as before.
        float Pk = prism ? min(amp * face - (1.0 - endK) * drop, amp * crest - drop) : amp * face - drop;
        // A fused group's blocks share one identity (its first cell), and the second-highest must be another block: two
        // cells of one group draping over the pixel would draw a crease (and a crack) where their skirts meet.
        ivec2 id = mg ? gid : cw;
        if (Pk > pb1) {
          if (id != o1) { pb2 = pb1; o2 = o1; x2 = x1; }
          pb1 = Pk; o1 = id; x1 = S; wd = dout; wu = up;
          if (o == 0) { rnd = fract(hf2.z * 7.13 + hf.z); rowK = ivec2(imod(rowC, gR), 0); }
          if (o == 1) rndF = fract(h2.z * 7.13 + h.z);
        }
        else if (Pk > pb2 && id != o1) { pb2 = Pk; o2 = id; x2 = S; }
      }
    }
    if (g == 37) {
      // The pixel's own block, its shoulder rounded inside its nearest border (no drop at all when Weathering is 0).
      // Rounded corners (blocks): within kC px of two borders, the distance to a corner rounded by kC (rk_corner, the
      // rounded-box form at any angle) — the corner sinks away in a curve beyond the arc — and the crease moves out by the
      // same amount, so the cracks open up where blocks meet. Elsewhere (one border near, or none) nothing changes.
      float dinS = din;
      if (o == 0 && kC > 0.0 && din2 < kC) {
        // Only where the borders really turn (normals > ~20° apart): at a T-junction the edge runs straight on.
        float cn = dot(dinN, dinN2);
        float turn = 1.0 - smoothstep(0.82, 0.96, cn);
        dinS = mix(din, kC - rk_corner(kC - din, kC - din2, max(cn, 0.0)), turn);
        dcR = din - dinS;
      }
      float drop = rk_shoulder(-dinS, wr * min(amp, 1.0)) / dinRun;
      float Pk = prism ? min(ownFace - (1.0 - dinEnd) * drop, ownCrest - drop) : ownFace - drop;
      if (Pk > pb1) {
        if (ownC != o1) { pb2 = pb1; o2 = o1; x2 = x1; }
        pb1 = Pk; o1 = ownC; x1 = ownS; wd = -1.0;
        if (o == 0) { rnd = ownRnd; rowK = ownRow; }
        if (o == 1) rndF = ownRnd;
      }
      else if (Pk > pb2 && ownC != o1) { pb2 = Pk; o2 = ownC; x2 = ownS; }
      relief += pb1;
      float d = (pb1 - pb2) * scarp;
      // On a skirt from its top edge (the border it falls from) to its foot (the crease), anti-aliased at both.
      // Facets' skirts count by their strength squared: at full weight every little facet step paints a dark fleck.
      // Facing: up > 0 when the skirt's block lies above the pixel on screen (the skirt runs down: an underside).
      float fk = u_scarp_face == 0 ? 1.0 : smoothstep(-0.2, 0.4, u_scarp_face == 1 ? wu : -wu);
      float sk = wd >= 0.0 ? min(amp * amp, 1.0) * clamp(wd + 0.5, 0.0, 1.0) * clamp(d + 0.5, 0.0, 1.0) : 0.0;
      scarps = max(scarps, fk * sk);
      scarpsAll = max(scarpsAll, sk);
      if (o == 0) { dc.x = d; c1 = o1; c2 = o2; s1 = x1; s2 = x2; }
      // How deep the crease lies below the higher block's face: a step reaches further than a flat joint.
      if (o == 0) stepH = max(wd >= 0.0 ? wd / max(scarp, 0.05) : 0.0, 0.0);
      // Facet joints follow the facet's own cell border (straight): its crease, where a tilted face meets a neighbour's
      // skirt, curves, and cracked it curled into worms.
      if (o == 1) { dc.y = max(din, 0.0); c3 = ownC; c4 = dinC; }
    }
  }

  // Height coherence: a smooth swell (value noise, ~3 block lengths across) shared by all the blocks at a pixel. Added to
  // every mesa alike it changes none of the comparisons, so it is added once here: neighbouring blocks share it at their
  // border, and only the blocks' own (shrunk) heights make steps — ledges here and there instead of at every joint.
  if (u_coherence > 0.0) relief += u_heights * u_coherence * 1.8 * (rk_vnoise(pw / uRes * swc, org_per(swc), uSeed + 83.0) - 0.5);
  // tanh: near linear for the usual range, rounding off big stacks of relief instead of clipping them flat.
  float v = 0.5 + 0.5 * tanh(relief) + u_rough * zf * (rn - 0.5);
  if (u_rills > 0.0) {
    // Rills: parallel channels down the screen, rill_space apart (whole counts when tiling), meandering a little. Each is
    // a parabolic bowl — round-bottomed, meeting its neighbours in sharp crests — cut into segments about rill_len long,
    // each segment with its own depth, fading in and out along it.
    float nCh = uTile ? max(1.0, rk_round(uRes.x / max(u_rill_space, 0.5))) : uRes.x / max(u_rill_space, 0.5);
    float nSeg = uTile ? max(1.0, rk_round(uRes.y / max(u_rill_len, 2.0))) : uRes.y / max(u_rill_len, 2.0);
    // Meander: about ±1 channel, so neighbouring rills bend together and pinch.
    float xr = p.x / uRes.x * nCh + 3.0 * (rl - 0.5);
    float ci = floor(xr), fx = xr - ci;
    int cw = uTile ? imod(int(ci), int(nCh)) : int(ci);
    float yr = p.y / uRes.y * nSeg + hashI(ivec2(cw, 5), uSeed + 97.0);
    float sg = floor(yr);
    int sw = uTile ? imod(int(sg), int(nSeg)) : int(sg);
    float depth = hashI(ivec2(cw, sw), uSeed + 99.0) * sin(3.14159265 * (yr - sg));
    v -= 0.3 * u_rills * depth * (1.0 - (2.0 * fx - 1.0) * (2.0 * fx - 1.0));
  }
  if (u_pits > 0.0) {
    // Pits: one candidate per cell of 4 pit radii (whole counts when tiling), kept with the pits' chance — clustered by
    // the breakup noise (about two blocks across) — its centre a radius in from the cell's sides so it never needs the
    // neighbours: one evaluation. Sizes from a quarter to all of the radius, mostly small. A bowl half as deep as it is
    // wide in true px (through the Height amount and the project's depth), only on the faces: away from the creases and
    // off the scarps.
    float r = max(u_pit_size, 0.5);
    vec2 pc = cellsFor(uRes.x / (4.0 * r), 1.0);
    vec2 cs = uRes / pc;
    ivec2 ci = ivec2(floor(p / cs));
    vec4 hp = vec4(hash3I(imod(ci, org_per(pc)), uSeed + 211.0), hashI(imod(ci, org_per(pc)), uSeed + 223.0));
    if (hp.z < u_pits * 2.0 * smoothstep(0.38, 0.62, lb)) {
      float rr = r * (0.25 + 0.75 * hp.w * hp.w);
      vec2 ctr = (vec2(ci) + 0.5) * cs + (hp.xy - 0.5) * max(cs - 2.0 * rr, 0.0);
      float d = length(p - ctr) / rr;
      float face = (1.0 - scarpsAll) * smoothstep(pxs, 3.0 * pxs, dc.x);
      v -= face * max(1.0 - d * d, 0.0) * 0.5 * rr / max(abs(u_h_amount) * uDepth, 0.5);
    }
  }
  if (u_laminae > 0.0) {
    // Laminae: k grooves per bed (whole, so beds hold them seamlessly), each with its own depth (hashed by its index,
    // which repeats where the beds do), fading in and out with a breakup noise about two blocks across.
    float k = max(1.0, rk_round(T / max(u_lam_space, 0.5)));
    float L = f.y * k;
    float li = floor(L + 0.5);
    float dpx = abs(L - li) * T / k;
    float depth = 0.35 + 0.65 * hashI(ivec2(imod(int(li), int(k) * gR), 3), uSeed + 91.0);
    v -= 0.2 * u_laminae * depth * smoothstep(0.25, 0.75, lb) * (1.0 - smoothstep(0.25 * pxs, pxs, dpx));
  }
  // Joints: cracks along the creases of the blocks (and, thinner, along some of the first facets' creases), sunk below
  // the faces; the blocks between them are the shape.
  // A joint across the bedding (its blocks lie end to end) takes the cross-joint share of the width; along its length a
  // crack pinches and swells with the (smooth, block-sized) warp noise, by the width variation.
  vec2 sN = s2 - s1;
  float crossK = abs(sN.x) / max(length(sN), 1e-6);
  float swell = max(1.0 + 1.6 * u_joint_var * (wv.x - 0.5), 0.0);
  dc.x -= dcR;
  // One loop over the two generations of joints, so rk_joint's code exists once (D3D inlines every call).
  vec2 j = vec2(0.0, -1e4);
  float jMainD = -1e4, jFacetD = -1e4;
  for (int k = 0; k < 2 * ORG_1; k++) {
    if (k == 1 && (u_joint_facets <= 0.0 || u_joint <= 0.0 || u_detail < 2)) break;
    bool f0 = k == 0;
    // Facet cracks: 0.6 × the width, at most a twelfth of a facet (half a block); see below for their depth.
    vec2 jk = rk_joint(f0 ? dc.x : dc.y, f0 ? c1 : c3, f0 ? c2 : c4,
                       f0 ? u_joint * mix(1.0, u_joint_cross, crossK * crossK) * swell : min(0.6 * u_joint, T / 24.0),
                       f0 ? u_joint_open : u_joint_facets, uSeed + (f0 ? 53.0 : 59.0));
    // Breakup: facet cracks fade in and out along their length.
    if (!f0 && u_facet_break > 0.0) {
      // (The fBm sits around 0.5 ± 0.15: the cut sweeps that, from a few gaps to a few fragments left.)
      float cut = 0.33 + 0.3 * u_facet_break;
      float fc = smoothstep(cut - 0.05, cut + 0.05, fb);
      // The crack's distance shrinks too, to nothing (its crevice glow and Shape Mask taper to a point, not cut off).
      jk = vec2(jk.x * fc, jk.y - (1.0 - fc) * (0.5 * min(0.6 * u_joint, T / 24.0) + 3.0 * max(u_crev_reach, 0.5) + 1.0));
    }
    // Hairline facet cracks sink only 60 % as deep as the joints.
    j = max(j, vec2(jk.x * (f0 ? 1.0 : 0.6), jk.y));
    if (f0) jMainD = jk.y;
    else jFacetD = jk.y;
  }
  if (u_fractures > 0.0) {
    // Long fractures: lanes about two blocks apart across the fracture direction; each lane holds segments ~4.5 blocks
    // long, present with the fractures' chance, a little off the lane's centre and turned a few degrees, fading out over
    // the last fifth of each end; 0.6 × the joints' width (at least 0.6 px), at their depth. When tiling, the direction is
    // snapped to a primitive lattice vector v = (a W, b H) (a, b coprime) and completed to a basis with u = (c W, d H),
    // ad − bc = 1: a step along v moves Lp = |v| along the lanes (a whole number of segments), a step along u moves one
    // tile-period across them (a whole number of lanes) and slide along, which each lane's segments are shifted back by —
    // so the fractures repeat under both, hence under the tile's (W, 0) and (0, H).
    float fa = radians(u_frac_angle);
    vec2 fdir = vec2(cos(fa), -sin(fa));
    float lane = 2.2 * T, segL = 4.5 * T;
    float nL = 1e6, nS = 1e6, slide = 0.0;
    if (uTile) {
      // The shortest coprime (a, b), |a| ≤ 6, |b| ≤ 3, within a few degrees of the direction.
      vec2 ab = vec2(1.0, 0.0);
      float bestE = 1e9;
      for (int i = 0; i < 49 * ORG_1; i++) {
        int a = i % 7, b = i / 7 - 3;
        if (a == 0 && b <= 0) continue;
        int bAbs = abs(b);
        if ((a % 2 == 0 && bAbs % 2 == 0) || (a % 3 == 0 && bAbs % 3 == 0) || (a % 5 == 0 && b == 0)) continue;
        vec2 v = vec2(float(a), float(b)) * uRes;
        float e = 1.0 - abs(dot(normalize(v), fdir)) + 0.0004 * length(v) / uRes.x;
        if (e < bestE) { bestE = e; ab = vec2(float(a), float(b)); }
      }
      vec2 v = ab * uRes;
      float Lp = length(v);
      fdir = v / Lp;
      // u = (c, d) with a d − b c = 1.
      int a = int(ab.x), b = int(ab.y);
      vec2 cd = vec2(-float(b), 0.0);
      for (int c = -6 * ORG_1; c <= 6 * ORG_1; c++) {
        if (a == 0) break;
        int num = 1 + b * c;
        if (imod(num, a) == 0) { cd = vec2(float(c), float(num / a)); break; }
      }
      slide = dot(cd * uRes, fdir);
      float across = uRes.x * uRes.y / Lp;
      nL = max(1.0, rk_round(across / lane));
      lane = across / nL;
      nS = max(1.0, rk_round(Lp / segL));
      segL = Lp / nS;
    }
    vec2 fn = vec2(-fdir.y, fdir.x);
    vec2 pr = vec2(dot(pw, fdir), dot(pw, fn));
    float li = floor(pr.y / lane - 0.5);
    float best = 0.0;
    for (int k = 0; k < 2 * ORG_1; k++) {
      float lk = li + float(k);
      int lwi = imod(int(lk), int(nL));
      float rep = float((int(lk) - lwi) / int(nL));
      vec2 hl = hash2I(ivec2(lwi, 0), uSeed + 151.0);
      float off = (lk + 0.5 + 0.3 * (hl.x - 0.5)) * lane;
      float sp = (pr.x - rep * slide) / segL + hl.y * 7.0;
      float si = floor(sp);
      vec2 hs = hash2I(ivec2(lwi, imod(int(si), int(nS)) + 1), uSeed + 163.0);
      if (hs.x >= u_fractures) continue;
      float uu = sp - si;
      float ang = (hs.y - 0.5) * 0.12;
      float d = abs(pr.y - off - (uu - 0.5) * segL * ang) - 0.5 * max(u_joint, pxs) * 0.6;
      float fadeE = smoothstep(0.0, 0.2, uu) * (1.0 - smoothstep(0.8, 1.0, uu));
      best = max(best, fadeE * clamp(0.5 - d, 0.0, 1.0));
    }
    j.x = max(j.x, best);
  }
  v -= u_joint_depth * j.x;
  // The Shape bevel rounds the blocks into the joints only: around the hairline facet cracks it turned them into grooves.
  v *= org_edgeProfile(jMainD);
  // Per bed: a row's value repeats every gR rows, like its thickness (seamless where the shear wraps the beds).
  if (u_rnd_mode == 3) { if (rndF >= 0.0) rnd = rndF; }
  else if (u_rnd_mode > 0) {
    float rb = hashI(rowK, uSeed + 113.0);
    rnd = u_rnd_mode == 1 ? rb : clamp(rb + 0.25 * (rnd - 0.5), 0.0, 1.0);
  }
  // The masks' coverage is their value, so any blend (a Normal paint too) lands only on them.
  float cov = 1.0;
  if (u_output == 1) { v = scarps; cov = v; }
  if (u_output == 3) {
    // Streaks: narrow columns (~1.5 px, whole counts when tiling), each with a streak at the density's chance — clustered:
    // the chance varies over groups of about eight columns — running down from the top edge of the block the pixel is in
    // for 40–100 % of the length, each at its own strength, strongest at the top and fading; edges softened by the
    // neighbouring columns (a 1D tent filter); off the scarps.
    float nCol = uTile ? max(1.0, rk_round(uRes.x / (1.5 * pxs))) : uRes.x / (1.5 * pxs);
    float nGrp = uTile ? max(1.0, rk_round(nCol / 8.0)) : nCol / 8.0;
    float xc = p.x / uRes.x * nCol;
    float st = 0.0;
    for (int k = -ORG_1; k <= ORG_1; k++) {
      float ck = floor(xc) + float(k);
      int cm = uTile ? imod(int(ck), int(nCol)) : int(ck);
      vec3 hc = hash3I(ivec2(cm, 0), uSeed + 233.0);
      int gi = uTile ? cm * int(nGrp) / int(nCol) : int(floor(ck / 8.0));
      float grp = hashI(ivec2(gi, 1), uSeed + 239.0);
      float len = max(u_streak_len, 1.0) * (0.4 + 0.6 * hc.y);
      float sk = hc.x < u_streak_density * 2.0 * grp ? (0.4 + 0.6 * hc.z) * max(1.0 - dTop / len, 0.0) : 0.0;
      st += sk * max(1.0 - abs(xc - ck - 0.5) / 1.5, 0.0);
    }
    v = clamp(st, 0.0, 1.0) * (1.0 - scarpsAll);
    cov = v;
  }
  if (u_output == 2) {
    // Crevices: from the crack's edge (or the crease) out over the reach, further on the skirt of a tall step.
    float reach = max(u_crev_reach, 0.5) * (1.0 + min(stepH, 2.0));
    // Closed joints (no crack) still hold a crease; open facet cracks add theirs.
    float dMain = jMainD > -1e2 ? max(-jMainD, 0.0) : dc.x;
    // (A tapered facet crack reaches −200 or so; closed ones are −1e3.)
    float dFacet = jFacetD > -5e2 ? max(-jFacetD, 0.0) : 1e4;
    v = 1.0 - smoothstep(0.0, reach, min(dMain, dFacet));
    v = max(v, j.x);
    // Patches: the breakup noise (fbm, about 0.5 ± 0.12) cut at a level that rises with the patchiness (0.5: about half).
    float cut = 0.35 + 0.3 * u_crev_patch;
    if (u_crev_patch > 0.0) v *= smoothstep(cut - 0.04, cut + 0.04, lb);
    cov = v;
  }
  return genOutOwn(clamp(v, 0.0, 1.0), cov, rnd, j.y);
}
`,
}
