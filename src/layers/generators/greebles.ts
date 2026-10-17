// Greebles (FR7.2d): recursive kd-style subdivision of the tile into machine panels, decorated at every level — each
// piece may get a border or edge strips (pipe runs, grilles, lamps) before what is left splits again — with cut lines
// that step at 45° (trapezoids, rhomboids, diamonds), octilinear plate outlines (corners cut at 45°, L / T / Z / cross /
// U shapes), rivets and details on the final plates, and 45° beams laid over the lot. See greebleCommon.ts for the
// relief / SDF output convention.

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { GRB_GLSL } from './greebleCommon'

const hasFrame = (p: Record<string, unknown>) => Number(p.frame_chance) > 0
const hasEdges = (p: Record<string, unknown>) => Number(p.edge_chance) > 0
const hasRivets = (p: Record<string, unknown>) => p.rivets !== 'none'
const hasDetails = (p: Record<string, unknown>) => Number(p.detail_chance) > 0
const hasSlots = (p: Record<string, unknown>) => hasDetails(p) && (Boolean(p.det_vents) || Boolean(p.det_holes))
const hasLight = (p: Record<string, unknown>) => hasDetails(p) && Boolean(p.det_light)
const hasShapes = (p: Record<string, unknown>) => Number(p.shape_chance) > 0
const hasJogs = (p: Record<string, unknown>) => Number(p.jog) > 0
const hasBeams = (p: Record<string, unknown>) => Number(p.beams) > 0
const isRelief = (p: Record<string, unknown>) => (p.output ?? 'relief') === 'relief'
const MIN_HINT = 'Panels smaller than this get none, so small panels stay plain — measured as the square root of the area, so a long narrow strip still counts (0 = any that fit)'

/**
 * The pinwheel root (`root: windmill`): the tile as a 5 × 5 grid of cells in 15 pieces — 5 squares and 10 bars two cells
 * long, from the windmill tiling whose squares sit on the lattice (1, 2), (−2, 1), which repeats every 5 cells both
 * ways — so no seam runs straight across the tile. Cell (x, y) → piece, row by row; each piece's cells as x0, y0, x1, y1
 * (x0, y0 in 0..4; x1 or y1 past 5 wraps round the tile).
 */
const WINDMILL_CELLS = [0, 2, 10, 10, 11, 4, 4, 5, 9, 11, 14, 3, 5, 13, 13, 14, 7, 7, 8, 12, 1, 2, 6, 8, 1]
const WINDMILL_RECTS = [
  [0, 0, 1, 1], [4, 4, 6, 5], [1, 4, 2, 6], [1, 2, 2, 3], [0, 1, 2, 2], [2, 1, 3, 3], [2, 4, 3, 5], [1, 3, 3, 4],
  [3, 3, 4, 5], [3, 1, 4, 2], [2, 0, 4, 1], [4, 0, 5, 2], [4, 3, 5, 4], [3, 2, 5, 3], [0, 2, 1, 4],
]
export const WINDMILL = { cells: WINDMILL_CELLS, rects: WINDMILL_RECTS }

export const greeblesLayer: LayerDef = {
  type: 'greebles',
  label: 'Greebles',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  // The relief writes the shape mask unless Shape for the mask is None; the shape outputs always do.
  writesMask: (p) => !isRelief(p) || (p.mask ?? 'none') !== 'none',
  description:
    'Machine greebles: a recursive subdivision into panels, each piece at any level maybe bordered or edged with strips (pipe runs, grilles, lamps) before it splits again; cut lines that step at 45° into trapezoids and diamonds; octilinear plate outlines; rivets, vents, lights, recesses, perforations and pipes on the final plates; and 45° beams laid over them. Tileable.',
  params: [
    P.enum('output', 'Output', 'relief', [
      ['relief', 'Relief (all, value)'],
      ['panels', 'Panels (shape)'],
      ['seams', 'Seams (shape)'],
      ['frames', 'Inset frames (shape)'],
      ['rivets', 'Rivets (shape)'],
      ['details', 'Details (shape)'],
      ['lights', 'Lights (shape)'],
      ['beams', 'Beams (shape)'],
    ], { hint: 'Relief composes every element into one height value (uses the Edge bevel). The shape outputs give one element class as a shape — stack copies with the same seed for separate materials' }),
    P.enum('mask', 'Shape for the mask', 'plates', [
      ['none', 'None', 'the relief leaves the shape mask as it was'],
      ['plates', 'Plate tops', 'the panels less everything sunk into them: slots, holes, recesses, light housings, groove lines and recessed centres'],
      ['panels', 'Panels', 'the whole panels: only the seams left out'],
      ['seams', 'Seams', 'the gaps between the panels'],
      ['frames', 'Inset frames', 'the frame lines, or the raised / recessed centres'],
      ['rivets', 'Rivets'],
      ['details', 'Details', 'vent slots, holes, recesses and light housings'],
      ['lights', 'Lights', 'the lenses'],
      ['beams', 'Beams'],
    ], {
      showIf: isRelief,
      hint: 'What the relief hands to the shape mask (Mask card › Use shape mask), for later layers to clip to (grime in the seams, paint on the plates only, glow in the lenses) or chip and bevel from — no second Greebles layer needed',
    }),
    P.enum('root', 'Layout', 'pinwheel', [
      ['tile', 'Whole tile', 'the tile is the first panel, cut in two (or as a pinwheel, by Pinwheel splits); its border is a seam (Offset moves it)'],
      ['pinwheel', 'Pinwheel', 'the tile is first cut as a pinwheel, four panels round a centre one, so no seam runs straight across it; its border is a seam'],
      ['windmill', 'Interlocked', '15 interlocking pieces (5 squares, 10 bars, at random widths) round the torus: no border seam either, so tiled copies show no grid at the tile size'],
    ], { hint: 'What the subdivision starts from' }),
    P.int('depth', 'Depth', 16, 0, 24, { softMax: 16, hint: 'Maximum number of recursive splits. It stops the splits first: if panels stay above Max panel, raise it' }),
    P.int('min_size', 'Min panel', 7, 1, 2048, { softMax: 128, unit: 'px', hint: 'No panel side is cut below this. Panels only get this small where cuts go on: with Split chance, Clustering, and a Max panel close to it (on a small tile, lower Max panel for busy zones)' }),
    P.int('max_size', 'Max panel', 40, 1, 8192, { softMax: 512, unit: 'px', hint: 'Sides longer than this are always cut (while Min panel and Depth allow)' }),
    P.float('split', 'Split chance', 0.65, 0, 1, { step: 0.001, hint: 'Chance to cut a panel that is between min and max size' }),
    P.float('cluster', 'Clustering', 0.45, 0, 1, { step: 0.001, hint: 'Regions decide together: busy zones of small panels next to calm, big plates. 0 = every panel decides alone. It works between Min and Max panel, so a Max panel near Min leaves it little to do' }),
    P.float('diag', 'Diagonal cuts', 0, 0, 1, { step: 0.001, hint: 'Chance a split runs at 45° instead of across or down: triangles, trapezoids and cut-off corners that split on in turn' }),
    P.float('seamless', 'Seamless splits', 1, 0, 1, { step: 0.001, hint: 'Every piece that splits stands on its parent with its own bevel and outline, its parts on it (the seams between them as deep as it stands): this is the chance a piece skips that and keeps its parent’s height, its parts carrying on. 1 = only the final panels draw, all down to the floor' }),
    P.float('pinwheel', 'Pinwheel splits', 0.3, 0, 1, { step: 0.001, hint: 'Chance a panel splits into five as a pinwheel (four round a centre) instead of in two, so seams stop at each other instead of running edge to edge' }),
    P.float('aspect', 'Panel aspect', 1, 0.05, 20, { softMin: 0.125, softMax: 8, step: 0.01, hint: 'Height ÷ width of the min and max panel (their geometric mean stays): above 1 tall panels and columns, below 1 wide panels and rows' }),
    P.float('bias', 'Cut bias', 0, -1, 1, { step: 0.001, hint: 'Optional cuts: −1 = vertical cuts (columns), +1 = horizontal cuts (rows), 0 = cut across the longer side. Sides above Max panel are cut anyway (Panel aspect stretches the max)' }),
    P.float('split_var', 'Cut randomness', 0.7, 0, 1, { step: 0.001, hint: '0 = always cut in the middle, 1 = anywhere' }),
    P.int('snap', 'Cut grid', 1, 1, 512, { softMax: 64, unit: 'px', hint: 'Cuts snap to multiples of this (from the tile origin)' }),
    P.float('gap', 'Seam', 1, 0, 128, { softMax: 12, unit: 'px', step: 0.5, hint: 'Seam along the left and top of each panel (whole px stays crisp)' }),
    P.float('seam_taper', 'Seam taper', 0.5, 0, 1, { step: 0.001, hint: 'Main seams wide, fine ones thin: each level of cuts narrows its seams by this fraction (to 1 px). 0 = every seam is Seam wide' }),
    P.float('edge_seam', 'Tile-edge seam', 0.34, 0, 1, { step: 0.001, showIf: (p) => p.root !== 'windmill', hint: 'The seam along the tile border as a share of Seam (whole px): low values keep tiled copies from showing a grid of wide seams at the tile size. 0 = the border panels meet with only their bevels' }),
    P.float('seam_max', 'Seam limit', 0.12, 0, 0.5, { step: 0.001, hint: 'No seam wider than this share of the shorter side of its panel (at least 1 px): the small panels of busy zones get thin seams instead of a waffle grid. 0 = no limit' }),
    P.float('round', 'Corner rounding', 0.5, 0, 128, { softMax: 24, unit: 'px', step: 0.1 }),
    P.int('levels', 'Height levels', 4, 1, 16, { hint: 'Distinct per-panel heights (relief)' }),
    P.float('height_var', 'Height variation', 0.35, 0, 1, { step: 0.001, hint: 'How far the lowest panel level sits below the highest: 1 = down at the seam floor unless Lowest level holds it up (relief)' }),
    P.float('min_level', 'Lowest level', 0.25, 0, 1, { step: 0.001, hint: 'The lowest panels never sink below this fraction of the highest, so their seams stay visible however large the Height variation; the levels spread evenly above it (relief)' }),
    P.float('bulge_spread', 'Bulge spread', 0.7, 0, 1, { step: 0.001, showIf: (p) => Number(p.bulge) !== 0, hint: 'How far in from the edges the bulge keeps rising: 0 a cushion (rounded edges, flat top) … 1 a full dome' }),
    P.float('bulge', 'Bulge', 0.12, -0.75, 1, { softMin: -0.75, softMax: 0.75, step: 0.001, hint: 'Panels dome up towards their centre (pillowed plates) by this much on the highest level, lower ones in proportion; negative dishes them in, −0.75 down to the floor (relief)' }),
    P.float('inset_depth', 'Inset depth', 0.25, 0, 1, { step: 0.001, hint: 'Depth of grooves, recesses and light housings, and the rise of raised frames (relief)' }),
    P.float('offset_x', 'Offset X', 0, 0, 1, { step: 0.001, hint: 'Shift the layout (fraction of the width) so the tile edge is not a seam' }),
    P.float('offset_y', 'Offset Y', 0, 0, 1, { step: 0.001 }),
    P.seed(),

    P.float('jog', 'Amount', 0, 0, 1, { step: 0.001, group: 'jogs', hint: 'Cut lines step sideways at 45°: how far, as a share of the room each line has before it would meet its neighbours. Small values jog the seams; large ones turn boxes into trapezoids, rhomboids and diamonds. 0 = straight seams' }),
    P.float('jog_chance', 'Chance', 0.7, 0, 1, { step: 0.001, group: 'jogs', showIf: hasJogs, hint: 'Chance each stretch of a line steps' }),
    P.int('jog_layers', 'Steps', 2, 1, 4, { group: 'jogs', showIf: hasJogs, hint: 'Stretches along each line, each of which may step: more steps, more intricate borders' }),

    P.float('cut_chance', 'Cut corners', 0.2, 0, 1, { step: 0.001, group: 'outline', hint: 'Share of the plates’ outside corners cut off at 45°, each corner on its own: all four make an octagon, two side by side an arrow' }),
    P.float('cut_size', 'Cut size', 0.25, 0.05, 0.5, { step: 0.001, group: 'outline', showIf: (p) => Number(p.cut_chance) > 0, hint: 'Chamfer leg as a share of the shorter of the corner’s two edges: 0.5 meets the next chamfer at mid-edge (a diamond)' }),
    P.float('cut_var', 'Cut variation', 0.5, 0, 1, { step: 0.001, group: 'outline', showIf: (p) => Number(p.cut_chance) > 0, hint: 'Each chamfer its own size, down to (1 − this) × Cut size' }),
    P.float('shape_chance', 'Shaped panels', 0.15, 0, 1, { step: 0.001, group: 'outline', hint: 'Share of the panels (from Min panel) whose plate is an L, T, Z, cross or U instead of the whole panel; the floor or backing shows in the rest' }),
    P.enum('shape_kind', 'Shapes', 'mixed', [
      ['l', 'L', 'an arm along two sides'],
      ['t', 'T', 'a bar along one side on a stem: a funnel'],
      ['z', 'Step', 'two overlapping blocks in opposite corners'],
      ['cross', 'Cross', 'a bar each way'],
      ['u', 'Notch', 'one side notched in the middle'],
      ['mixed', 'Mixed', 'each panel one of the five'],
    ], { group: 'outline', showIf: hasShapes }),
    P.int('shape_min', 'Min panel', 20, 0, 2048, { softMax: 128, unit: 'px', group: 'outline', showIf: hasShapes, hint: MIN_HINT }),
    P.float('fillet', 'Inside corners', 0.35, 0, 0.5, { step: 0.001, group: 'outline', showIf: hasShapes, hint: 'The inside corners of shaped plates filled at 45°: leg as a share of the shorter of the corner’s two edges (0 = square)' }),
    P.float('empty', 'Empty panels', 0, 0, 1, { step: 0.001, group: 'outline', hint: 'Share of the panels left out: only their backing (or the floor) shows' }),
    P.enum('fill', 'Fill', 'backing', [
      ['floor', 'Floor', 'the seam floor shows'],
      ['backing', 'Backing plate', 'a lower plate under the plate (Backing height)'],
      ['plates', 'Plates', 'plates of their own, a seam away from the plate and following its outline — the panels interlock'],
    ], { group: 'outline', hint: 'What fills a panel where its plate leaves it: cut corners, the cut-away parts of shaped panels, empty panels' }),
    P.float('backing', 'Backing height', 0.5, 0, 1, { step: 0.001, group: 'outline', showIf: (p) => (p.fill ?? 'backing') === 'backing', hint: 'As a share of the panel’s height' }),

    P.float('frame_chance', 'Chance', 0.3, 0, 1, { step: 0.001, group: 'frame', hint: 'Chance a piece — at any level of the splitting, not only the final panels — gets a border round it; the splitting carries on inside it' }),
    P.int('frame_min', 'Min panel', 16, 0, 2048, { softMax: 128, unit: 'px', group: 'frame', showIf: hasFrame, hint: MIN_HINT }),
    P.enum('frame_style', 'Style', 'mixed', [
      ['groove', 'Groove line', 'a groove down the middle of the border'],
      ['ridge', 'Raised line', 'a ridge down the middle of the border'],
      ['recess', 'Recessed centre', 'the inside steps down from the border'],
      ['raise', 'Raised centre', 'the inside steps up from the border'],
      ['rivets', 'Rivets', 'a row of rivets along the border (Rivets › Radius, Spacing, Height)'],
      ['mixed', 'Mixed', 'each border one of the five'],
    ], { group: 'frame', showIf: hasFrame }),
    P.float('frame_inset', 'Width', 3.5, 1, 512, { softMax: 32, unit: 'px', step: 0.5, group: 'frame', showIf: hasFrame }),
    P.float('frame_width', 'Line width', 1, 0.5, 128, { softMax: 8, unit: 'px', step: 0.5, group: 'frame', showIf: (p) => hasFrame(p) && ['groove', 'ridge', 'mixed'].includes(String(p.frame_style)) }),

    P.float('edge_chance', 'Chance', 0.15, 0, 1, { step: 0.001, group: 'edges', hint: 'Chance a piece (at any level, if it gets no border) gets a strip along one of its long sides holding a pipe run or a detail — a vent grille, lamps, ribs or perforation (the Details kinds that are on); the splitting carries on beside it' }),
    P.int('edge_min', 'Min panel', 24, 0, 2048, { softMax: 128, unit: 'px', group: 'edges', showIf: hasEdges, hint: MIN_HINT }),
    P.float('edge_width', 'Width', 5, 3, 512, { softMax: 48, unit: 'px', step: 0.5, group: 'edges', showIf: hasEdges, hint: 'At most 0.35 of the piece across' }),
    P.float('edge_two', 'Second strip', 0.4, 0, 1, { step: 0.001, group: 'edges', showIf: hasEdges, hint: 'Chance of a second strip along a short side, meeting the first in a corner: a pipe run then wraps round the inside' }),
    P.float('edge_pipes', 'Pipe runs', 0.5, 0, 1, { step: 0.001, group: 'edges', showIf: hasEdges, hint: 'Share of the strips holding a pipe run (Details › Pipes & handles on: its Pipe runs and Min tube), the rest a detail' }),

    P.enum('rivets', 'Rivets', 'mixed', [
      ['none', 'None'],
      ['corners', 'Corners'],
      ['edges', 'Along edges'],
      ['sides', 'Along the long sides'],
      ['mixed', 'Mixed', 'each panel corners, edges or long sides'],
    ], { group: 'rivets', hint: 'A panel too narrow for two rivets across gets one line of them down its middle (a strap)' }),
    P.float('rivet_chance', 'Chance', 0.6, 0, 1, { step: 0.001, group: 'rivets', showIf: hasRivets }),
    P.int('rivet_min', 'Min panel', 12, 0, 2048, { softMax: 128, unit: 'px', group: 'rivets', showIf: hasRivets, hint: MIN_HINT }),
    P.float('rivet_radius', 'Radius', 1, 0.5, 64, { softMax: 12, unit: 'px', step: 0.5, group: 'rivets', showIf: hasRivets, hint: 'Whole or half px: 1 → 2×2, 1.5 → 3×3' }),
    P.float('rivet_inset', 'Inset', 2, 0, 256, { softMax: 32, unit: 'px', step: 0.5, group: 'rivets', showIf: hasRivets, hint: 'Panel edge to rivet centre' }),
    P.float('rivet_spacing', 'Spacing', 8, 1, 512, { softMax: 64, unit: 'px', step: 0.5, group: 'rivets', showIf: (p) => hasRivets(p) && p.rivets !== 'corners' }),
    P.float('rivet_height', 'Height', 0.3, 0, 1, { step: 0.001, group: 'rivets', showIf: hasRivets, hint: 'Dome height above the panel (relief)' }),

    P.float('detail_chance', 'Chance', 0.55, 0, 1, { step: 0.001, group: 'details', hint: 'Fraction of panels with a detail' }),
    P.int('det_min', 'Min panel', 12, 0, 2048, { softMax: 128, unit: 'px', group: 'details', showIf: hasDetails, hint: MIN_HINT }),
    P.bool('det_vents', 'Vent slots', true, { group: 'details', showIf: hasDetails }),
    P.bool('det_light', 'Light', true, { group: 'details', showIf: hasDetails }),
    P.bool('det_recess', 'Recess', true, { group: 'details', showIf: hasDetails }),
    P.bool('det_holes', 'Perforation', true, { group: 'details', showIf: hasDetails, hint: 'A grid of round holes (Slot pitch apart, Slot width across)' }),
    P.bool('det_ribs', 'Ribs', true, { group: 'details', showIf: hasDetails, hint: 'Rounded bars standing up from the plate, Slot pitch apart and Slot width wide (raised by 0.8 × Inset depth)' }),
    P.bool('det_pipes', 'Pipes & handles', true, { group: 'details', showIf: hasDetails, hint: 'A pipe run (a bundle of parallel tubes turning through round elbows) or a grab handle, standing on the plate (raised by Inset depth) between two flange plates' }),
    P.float('pipe_size', 'Pipe size', 0.15, 0.05, 0.4, { step: 0.001, group: 'details', showIf: (p) => hasDetails(p) && Boolean(p.det_pipes), hint: 'Tube diameter as a share of the detail area’s short side' }),
    P.float('pipe_min', 'Min tube', 2, 1, 64, { softMax: 12, unit: 'px', step: 0.5, group: 'details', showIf: (p) => hasDetails(p) && Boolean(p.det_pipes), hint: 'Thinnest tube diameter: areas too small for a tube this thick (with its flanges) get another kind of detail' }),
    P.int('pipe_runs', 'Pipe runs', 3, 1, 4, { group: 'details', showIf: (p) => hasDetails(p) && Boolean(p.det_pipes), hint: 'Up to this many tubes side by side in a run (each run picks 1…this, as many as fit)' }),
    P.float('hero', 'Hero parts', 0.6, 0, 1, { step: 0.001, group: 'details', showIf: hasDetails, hint: 'Share of the panels at least 2.5 × the detail Min panel whose detail is a big one filling most of the panel: a recessed grille or perforation, a light panel or a pipe run' }),
    P.float('small_parts', 'Small parts', 0.5, 0, 1, { step: 0.001, group: 'details', showIf: hasDetails, hint: 'Share of the panels below the detail Min panel that get one small part — a bolt (Rivets › Radius and Height) or a short slot — so busy zones are not blank boxes. Off while Chance is 0' }),
    P.float('det_size', 'Size', 0.6, 0.05, 1, { step: 0.001, group: 'details', showIf: hasDetails, hint: 'Detail area as a fraction of the panel' }),
    P.float('det_var', 'Size variation', 0.4, 0, 1, { step: 0.001, group: 'details', showIf: hasDetails, hint: 'Each detail area its own size, down to (1 − this) × Size' }),
    P.enum('det_anchor', 'Placement', 'mixed', [
      ['centre', 'Centred'],
      ['edge', 'Against an edge', 'pushed to a random side of the panel (clear of its frame and rivets)'],
      ['corner', 'In a corner', 'pushed into a random corner'],
      ['mixed', 'Mixed', 'each panel one of the three'],
    ], { group: 'details', showIf: hasDetails }),
    P.float('det_pair', 'Paired details', 0.35, 0, 1, { step: 0.001, group: 'details', showIf: hasDetails, hint: 'Share of the detailed panels that get two details side by side along their length (a lamp beside a grille), each its own kind' }),
    P.float('recess_wall', 'Recess wall', 1.5, 0, 256, { softMax: 16, unit: 'px', step: 0.5, group: 'details', showIf: hasDetails, hint: 'How wide the walls of recesses slope down to their floor (0 = the Edge bevel)' }),
    P.float('det_bay', 'Recessed grilles', 0.5, 0, 1, { step: 0.001, group: 'details', showIf: hasSlots, hint: 'Share of the vent slots and perforations set in a recess of their own' }),
    P.float('vent_pitch', 'Slot pitch', 2, 2, 128, { softMax: 24, unit: 'px', step: 0.5, group: 'details', showIf: hasSlots, hint: 'Vent slots and perforation holes: centre to centre' }),
    P.float('vent_slot', 'Slot width', 1, 1, 64, { softMax: 12, unit: 'px', step: 0.5, group: 'details', showIf: hasSlots, hint: 'Vent slot width and hole diameter (a 1 px bar always stays between them)' }),
    P.enum('light_style', 'Light', 'mixed', [
      ['lens', 'One lens', 'Light size × Light length, centred'],
      ['row', 'Row of lamps', 'round lamps of Light size along one long edge of the detail area'],
      ['strip', 'Strip', 'Light size wide along one long edge of the detail area'],
      ['window', 'Light panel', 'fills the detail area'],
      ['mixed', 'Mixed', 'each panel one of the four'],
    ], { group: 'details', showIf: hasLight }),
    P.float('light_size', 'Light size', 1.5, 1, 128, { softMax: 24, unit: 'px', step: 0.5, group: 'details', showIf: hasLight, hint: 'Short side of a lens or strip, a lamp’s diameter (at least: see Light scale)' }),
    P.float('light_rel', 'Light scale', 0.3, 0, 1, { step: 0.001, group: 'details', showIf: hasLight, hint: 'Lights grow with their detail area: at least this share of its short side (0 = Light size only)' }),
    P.float('light_len', 'Light length', 3, 1, 64, { softMax: 8, step: 0.1, group: 'details', showIf: (p) => hasLight(p) && ['lens', 'mixed'].includes(String(p.light_style ?? 'lens')), hint: 'One lens: long side ÷ short side (it stays inside the detail area)' }),
    P.float('light_rim', 'Housing', 1, 0, 64, { softMax: 8, unit: 'px', step: 0.5, group: 'details', showIf: hasLight, hint: 'Width of the recessed housing round the lens' }),
    P.float('light_dome', 'Lens dome', 0.35, 0, 1, { step: 0.001, group: 'details', showIf: hasLight, hint: 'The lens bulges up out of its housing like a glass cover (relief); 0 = a flat lens sunk in the housing' }),

    P.int('beams', 'Count', 0, 0, 8, { group: 'beams', hint: 'Long straps laid over everything, straight across the tile (they wrap round, so they tile) — at 45° or level' }),
    P.enum('beam_dir', 'Direction', 'diagonal', [
      ['diagonal', 'Diagonal', 'each beam rising or falling at 45°'],
      ['rising', 'Rising', 'all at 45°, up to the right'],
      ['falling', 'Falling', 'all at 45°, down to the right'],
      ['straight', 'Level', 'each beam horizontal or vertical'],
      ['mixed', 'Mixed', 'each beam any of the four'],
    ], { group: 'beams', showIf: hasBeams }),
    P.float('beam_width', 'Width', 6, 1, 512, { softMax: 32, unit: 'px', step: 0.5, group: 'beams', showIf: hasBeams }),
    P.float('beam_var', 'Width variation', 0.3, 0, 1, { step: 0.001, group: 'beams', showIf: hasBeams, hint: 'Each beam its own width, down to (1 − this) × Width' }),
    P.float('beam_len', 'Length', 1, 0.05, 1, { step: 0.001, group: 'beams', showIf: hasBeams, hint: 'As a share of the tile’s shorter side (each beam 60–100 % of it); 1 = endless' }),
    P.float('beam_height', 'Height', 0.3, -1, 1, { step: 0.001, group: 'beams', showIf: hasBeams, hint: 'How far a beam stands up from what it lies on — it follows the relief under it; negative sinks a channel instead (relief)' }),
    P.enum('beam_style', 'Style', 'strap', [
      ['strap', 'Strap', 'a flat band with bevelled sides'],
      ['rails', 'Rails', 'two thin bars along the band’s edges'],
      ['grooved', 'Grooved', 'a band with a groove down its middle'],
    ], { group: 'beams', showIf: hasBeams }),
  ],
  groups: [
    { id: 'jogs', label: 'Seam jogs', collapsed: true },
    { id: 'outline', label: 'Plate outlines', collapsed: true },
    { id: 'frame', label: 'Borders', collapsed: true },
    { id: 'edges', label: 'Edge strips', collapsed: true },
    { id: 'rivets', label: 'Rivets', collapsed: true },
    { id: 'details', label: 'Details', collapsed: true },
    { id: 'beams', label: 'Beams', collapsed: true },
  ],
  defaults: {
    h_on: true,
    h_amount: 0.6,
    bevel: 1,
    profile: 'smooth',
    dif_on: true,
    dif_src: 'value',
    dif_jitter: 0.12,
    dif_grad: gradient('#0f1011', '#3a3d41', '#5d6166', '#7e8388', '#b6babe'),
  },
  // Added in the editor: the plain defaults (a 128 px texture) scaled to the texture — panel sizes, seams, rivets, frames,
  // slots, lights and tubes; small textures get crisp pixel edges with a 1 px ramp.
  fresh: ({ width, height }) => {
    const k = Math.min(16, Math.max(0.125, Math.sqrt(width * height) / 128))
    const px = (v: number, lo = 1) => Math.max(lo, Math.round(v))
    const half = (v: number, lo = 0.5) => Math.max(lo, Math.round(v * 2) / 2)
    const small = k <= 0.75
    return {
      min_size: px(7 * k, 6),
      max_size: px(40 * k, 24),
      snap: px(k),
      gap: px(0.75 * k),
      round: half(0.4 * k, 0),
      bevel: half(0.6 * k, 1),
      profile: small ? 'linear' : 'smooth',
      aa: !small,
      frame_min: px(Math.max(16, 10 * k)),
      frame_inset: half(3.5 * k, 2),
      frame_width: px(0.5 * k),
      rivet_min: px(Math.max(12, 10 * k)),
      rivet_radius: half(0.75 * k),
      rivet_inset: half(2 * k, 1),
      rivet_spacing: half(8 * k, 2),
      det_min: px(Math.max(12, 8 * k)),
      pipe_min: px(Math.max(2, 1.25 * k)),
      recess_wall: half(1.5 * k, 1),
      vent_pitch: half(2 * k, 2),
      vent_slot: half(k, 1),
      light_size: half(1.5 * k, 1),
      light_rim: px(0.5 * k),
      shape_min: px(Math.max(20, 20 * k)),
      beam_width: px(6 * k, 2),
      edge_min: px(Math.max(24, 20 * k)),
      edge_width: half(5 * k, 3),
    }
  },
  glsl:
    GRB_GLSL +
    /* glsl */ `
// 1, read from a uniform: loops bounded by it are not unrolled by D3D (one copy of the body; see ORG_1).
#define GRB_1 (uRes.x > 0.0 ? 1 : 0)

// A panel's cell: its cuts as straight lines — lo..hi across and down, dlo..dhi along x + y (.x) and x − y (.y) for
// 45° cuts — and gap, the seam widths along its left, top, lower-left (x + y) and upper-left (x − y) edges. dS / dG: the
// distances in from its true (stepping) sides to the plate, seams taken off — left, right, bottom, top / the 45° sides
// (x + y low, high, x − y low, high); dL the distance out to the nearest seam line on its side. vb / hb: the surface the
// pieces above it leave, and that surface's height; jr: how far its sides step off their straight course. kind: where
// the pixel stopped — 0 the final plate, 1 a piece's border (dw wide), 2 a piece's edge strip (dw wide, along side
// (0 left, 1 right, 2 bottom, 3 top) and maybe side2 round the corner; sel 1: the pixel is in side2's). ls: the step of a
// border round the final plate (1e9: none).
struct GrbCell { vec2 lo; vec2 hi; vec2 dlo; vec2 dhi; uint id; vec4 gap; vec4 dS; vec4 dG; float dL; float vb; float hb; float jr; int kind; float dw; int side; int side2; int sel; float ls; };

// Four randoms 0..1 (8 bits each) from one hash: key k of a feature id.
vec4 grb_rand4(uint id, uint k) {
  uint h = pcg(id + k * 0x9E3779B9u);
  return vec4(uvec4(h, h >> 8u, h >> 16u, h >> 24u) & 255u) / 256.0;
}

// Component i (0..3) of v, without indexing (D3D compiles a dynamic index into a slow indexable temporary).
float grb_pick(vec4 v, int i) { return dot(v, vec4(equal(ivec4(i), ivec4(0, 1, 2, 3)))); }

// The smallest and next-smallest of eight distances (a, b) — flat vector work, no loop (a tie gives the same twice).
vec2 grb_min8(vec4 a, vec4 b) {
  vec4 m = min(a, b);
  float m1 = min(min(m.x, m.y), min(m.z, m.w));
  vec4 ea = step(a, vec4(m1)), eb = step(b, vec4(m1));
  vec4 m2v = min(a + 1e9 * ea, b + 1e9 * eb);
  float m2 = min(min(m2v.x, m2v.y), min(m2v.z, m2v.w));
  return vec2(m1, dot(ea + eb, vec4(1.0)) > 1.5 ? m1 : m2);
}

// Distance from p to the segment a..b.
float grb_seg(vec2 p, vec2 a, vec2 b) {
  vec2 e = b - a, w = p - a;
  return length(w - e * clamp(dot(w, e) / max(dot(e, e), 1e-6), 0.0, 1.0));
}

// A cut line's steps at (t along it, u across it from the cut) over the piece's extent tlo..thi along it: its offset at
// t (x) and the distance from (t, u) to its nearest 45° stretch (y; the flat ones are measured straight across). It
// starts at a random offset within ±a and in each of Steps stretches of the extent may step at 45° to another (whole px):
// a large Amount turns boxes into trapezoids, rhomboids and diamonds.
vec2 grb_jog(float t, float u, float tlo, float thi, uint id, float a) {
  float L = (thi - tlo) / float(max(u_jog_layers, 1));
  float f = floor(a * (2.0 * grb_rand(id, 77u) - 1.0) + 0.5);
  float off = f, ds = 1e9;   // the offset as the line goes; the nearest 45° stretch
  for (int i = 0; i < u_jog_layers; i++) {
    vec4 r = grb_rand4(id, 78u + uint(i));
    float st = clamp(floor(a * (2.0 * r.x - 1.0) + 0.5) - off, -floor(0.85 * L), floor(0.85 * L)) * step(r.y, u_jog_chance);
    float al = abs(st);
    float t0 = tlo + float(i) * L + floor(r.z * max(L - al, 0.0));
    if (al >= 1.0) {
      ds = min(ds, grb_seg(vec2(t, u), vec2(t0, off), vec2(t0 + al, off + st)));
      f += st * clamp((t - t0) / al, 0.0, 1.0);
    }
    off += st;
  }
  return vec2(f, ds);
}

// The bounding box (xy low, zw high) of the octagon lo..hi, x + y in dlo.x..dhi.x, x − y in dlo.y..dhi.y, and its corner
// cuts as legs k (x bottom-left, y bottom-right, z top-left, w top-right).
vec4 grb_octBox(vec2 lo, vec2 hi, vec2 dlo, vec2 dhi, out vec4 k) {
  for (int i = 0; i < 2; i++) {
    lo.x = max(lo.x, max(dlo.x - hi.y, dlo.y + lo.y));
    hi.x = min(hi.x, min(dhi.x - lo.y, dhi.y + hi.y));
    lo.y = max(lo.y, max(dlo.x - hi.x, lo.x - dhi.y));
    hi.y = min(hi.y, min(dhi.x - lo.x, hi.x - dlo.y));
  }
  vec2 s = max(hi - lo, vec2(0.0));
  k = clamp(vec4(dlo.x - (lo.x + lo.y), (hi.x - lo.y) - dhi.y, dlo.y - (lo.x - hi.y), (hi.x + hi.y) - dhi.x), 0.0, min(s.x, s.y));
  return vec4(lo, hi);
}

const int GRB_WM_CELL[25] = int[25](${WINDMILL_CELLS.join(', ')});
const vec4 GRB_WM_RECT[15] = vec4[15](${WINDMILL_RECTS.map((r) => `vec4(${r.map((v) => v.toFixed(1)).join(', ')})`).join(', ')});

// Cut positions (x and y at once) between a0 and a1 at fraction t of the allowed range, snapped to the cut grid
// (whole px as a fallback), keeping both children >= mn. -1 where no valid cut exists.
vec2 grb_cutPos(vec2 a0, vec2 a1, vec2 t, vec2 mn) {
  vec2 c = mix(a0 + mn, a1 - mn, t);
  float s = float(max(u_snap, 1));
  vec2 lo = a0 + mn - 1e-3, hi = a1 - mn + 1e-3;
  vec2 cs = floor(c / s + 0.5) * s;
  cs += s * vec2(lessThan(cs, lo));
  cs -= s * vec2(greaterThan(cs, hi));
  vec2 cr = floor(c + 0.5);
  vec2 r = mix(vec2(-1.0), cr, step(lo, cr) * step(cr, hi));
  return mix(r, cs, step(lo, cs) * step(cs, hi));
}

// Seam width of a cut at level L (0 = the first cuts and the tile edge): whole px below the top level, at least 1 px.
float grb_seamW(float L) {
  if (u_seam_taper <= 0.0 || L <= 0.0) return u_gap;
  return max(floor(u_gap * pow(1.0 - u_seam_taper, L) + 0.5), min(u_gap, 1.0));
}

// Below the root pinwheel, a cut (x and y) that lands on one of its seam lines (rl: x1, x2, y1, y2) moves off it, to the
// other side if it must, staying within clo..chi (else -1: no cut that way) — so it doesn't carry that seam on across
// the tile. "On" = closer than
// two seams and two bevels: a seam that close reads as the same line, jogged.
vec2 grb_offLines(vec2 c, vec4 rl, vec2 clo, vec2 chi, float sg) {
  float nd = ceil(max(2.0 * u_gap + 2.0 * u_bevel + 2.0, sg) / sg) * sg;
  vec2 o1 = c - rl.xz, o2 = c - rl.yw;
  vec2 n1 = step(abs(o1), abs(o2));
  vec2 o = mix(o2, o1, n1), base = mix(rl.yw, rl.xz, n1);
  vec2 near = step(abs(o), vec2(nd - 0.5)) * step(0.0, c);
  vec2 aw = mix(vec2(-1.0), vec2(1.0), step(0.0, o)) * nd;
  vec2 ca = base + aw, cb = base - aw;
  clo -= 1e-3;
  chi += 1e-3;
  // Neither side fits: no cut that way (the panel is cut the other way, or stays whole).
  vec2 moved = mix(mix(vec2(-1.0), cb, step(clo, cb) * step(cb, chi)), ca, step(clo, ca) * step(ca, chi));
  return mix(c, moved, near);
}

// Line j of the interlocked root's 5 × 5 grid (both ways), whole px: each a random share of a cell off the even
// spacing, the same in every period.
vec2 grb_wmLine(vec2 j, vec2 cw, uint id) {
  vec2 jm = j - 5.0 * floor(j / 5.0);
  vec2 r = vec2(grb_rand(id, 30u + uint(jm.x)), grb_rand(id, 40u + uint(jm.y)));
  return floor((j + 0.6 * (r - 0.5)) * cw + 0.5);
}

// A piece's height on the surface it stands on (hb): a share g (its level) of the headroom up to the top plateau (0.75),
// at least a quarter of the top's — so seams between pieces always cut down, finer and shallower deeper in.
float grb_lift(float hb, float g) { return hb + max(0.75 - hb, 0.1875) * g; }

// Bevel rises (grb_rise) of three distances over one width, through one copy of the profile.
vec3 grb_rise3(vec3 d, float w) {
  vec3 r = vec3(0.0);
  for (int i = 0; i < 3 * GRB_1; i++) r += grb_rise(i == 0 ? d.x : i == 1 ? d.y : d.z, w) * vec3(equal(ivec3(i), ivec3(0, 1, 2)));
  return r;
}

// Bounded iterative descent of the kd-tree: every node's decisions hash only its path id, so each pixel walks the same
// tree. The root is the whole tile (its border is a seam; offset moves it) or one piece of the pinwheel. Each piece, from
// the top down: it may decorate itself first — an outer border, or a strip along one edge — and a pixel there stops in
// that decoration; in what is left the piece may split (across or down, the cut line stepping at 45°: Jogs; at 45°:
// Diagonal cuts; or as a pinwheel), and the pixel carries on into its part. Each piece that decorates or splits stands
// on its parent as a plate of its own (unless seamless): the surface it leaves is the base for what follows. The loop
// count is a uniform, so D3D keeps one copy of the body.
GrbCell grb_panelAt(vec2 q) {
  vec2 lo = vec2(0.0), hi = uRes;
  vec2 dlo = vec2(-1e9), dhi = vec2(1e9);
  uint id = pcg(uint(uSeed) + 0x51ED27u);
  if (u_root == 2) {
    // The cell of the 5 × 5 grid (whole-px lines floor(j·size/5 + 0.5)) holding q; per seed a shift by whole cells and
    // a mirror image; its piece, unwrapped round q.
    vec2 cw = uRes / 5.0;
    vec2 j = floor(q / cw);
    j -= vec2(lessThan(q, grb_wmLine(j, cw, id)));
    j += vec2(greaterThanEqual(q, grb_wmLine(j + 1.0, cw, id)));
    vec2 sh = floor(vec2(grb_rand(id, 21u), grb_rand(id, 22u)) * 4.999);
    bool fl = grb_rand(id, 23u) < 0.5;
    vec2 c = j + sh;
    if (fl) c.x = -1.0 - c.x;
    vec2 cm = c - 5.0 * floor(c / 5.0);
    int k = GRB_WM_CELL[int(cm.y) * 5 + int(cm.x)];
    vec4 r = GRB_WM_RECT[k];
    vec2 rlo = r.xy + c - cm, rhi = r.zw + c - cm;
    if (rlo.x > c.x) { rlo.x -= 5.0; rhi.x -= 5.0; }
    if (rlo.y > c.y) { rlo.y -= 5.0; rhi.y -= 5.0; }
    if (fl) { float t = rlo.x; rlo.x = -rhi.x; rhi.x = -t; }
    lo = grb_wmLine(rlo - sh, cw, id);
    hi = grb_wmLine(rhi - sh, cw, id);
    id = pcg(id ^ (uint(k) * 0x2C1B3C6Du + 0x297A2D39u));
  }
  // Panel aspect: min and max sizes across (x) and down (y), trading around the set ones.
  float ar = sqrt(clamp(u_aspect, 0.01, 100.0));
  vec2 ak = vec2(1.0 / ar, ar);
  vec2 mn = float(max(u_min_size, 1)) * ak;
  vec2 mx = float(max(u_max_size, 1)) * ak;
  // Seam widths along the left, top and low 45° edges: the tile border's (Tile-edge seam), or a windmill piece's.
  vec4 gap = vec4(u_gap);
  if (u_root != 2 && u_edge_seam < 1.0) gap.xy = vec2(floor(u_gap * u_edge_seam + 0.5));
  // Distances in to the plate from each side (seams taken off): left, right, bottom, top; and the 45° sides (x + y low,
  // high, x − y low, high). How far each side's line jogs off its straight course.
  vec4 dS = vec4(q.x - lo.x - gap.x, hi.x - q.x, q.y - lo.y, hi.y - gap.y - q.y);
  vec4 dG = vec4(1e9);
  vec4 jm = vec4(0.0);
  float dL = min(q.x - lo.x, hi.y - q.y);
  vec4 rl = vec4(-1e9);   // the root pinwheel's seam lines: x1, x2, y1, y2
  float sg = float(max(u_snap, 1));
  // Clustering: how busy this region is, inherited down the tree and re-drawn (partly) near the top.
  float busy = 0.5;
  int nd = min(u_depth, 24);
  // A 45° cut leaves corner pieces with legs of at least twice the min panel.
  float md = 2.0 * sqrt(mn.x * mn.y);
  // Room a jogging line keeps from its parallel neighbours, so lines never cross.
  float jmar = max(0.4 * min(mn.x, mn.y), 2.0 * u_bevel + u_gap + 2.0);
  // The hierarchy's surface: its value here and the height of the piece it is on (the floor at the root).
  float vb = 0.0, hb = 0.0;
  int levels = max(u_levels, 1);
  float lowest = max(1.0 - u_height_var, u_min_level);
  int kind = 0, side = 0, side2 = -1, sel = 0;
  float dw = 0.0, ls = 1e9;
  // (No break in the loop: done skips the rest — FXC copes better with one plain loop.)
  bool done = false;
  for (int d = 0; d < nd; d++) {
   if (!done) {
    vec4 kk;
    vec4 bb = grb_octBox(lo, hi, dlo, dhi, kk);
    vec2 sz = bb.zw - bb.xy;
    // This piece's plate: the distance in from its nearest sides, the meeting of the two nearest rounded (Corner rounding).
    vec2 mm = grb_min8(dS, dG);
    float dN = mm.x, dN2 = mm.y;
    float rr = u_round;
    float dNr = dN < rr && dN2 < rr ? rr - length(vec2(rr - dN, rr - dN2)) : dN;
    vec4 rn = grb_rand4(id, 19u);
    float hN = grb_lift(hb, mix(1.0, lowest, levels > 1 ? floor(rn.y * float(levels)) / float(levels - 1) : 0.0));
    float bN = min(u_bevel, max(0.2 * min(sz.x, sz.y), 0.5));
    bool placed = false;   // its plate is in the surface already
    // Its rise, and a border's step in from the border's inner edge (one profile in the shader).
    vec2 rN = grb_rise3(vec3(-dNr, u_frame_inset - dNr, 1e4), bN).xy;

    // ---- its decoration (not the tile's own): an outer border, or a strip along one of its long sides — and maybe a
    // second along a short side, round the corner (a pipe run then wraps round the inside).
    if (d > 0 || u_root == 2) {
      float bwid = u_frame_inset;
      float room = min(sz.x, sz.y);
      bool bord = rn.z < u_frame_chance && sqrt(sz.x * sz.y) >= float(u_frame_min) && room - 2.0 * bwid >= max(min(mn.x, mn.y), 2.0 * u_bevel + 6.0);
      bool longX = sz.x >= sz.y;
      float ew = min(u_edge_width, 0.35 * (longX ? sz.y : sz.x));
      bool edge = !bord && rn.w < u_edge_chance && sqrt(sz.x * sz.y) >= float(u_edge_min) && ew >= 3.0;
      if (bord || edge) {
        // A decorated piece always stands as a plate of its own.
        vb += (hN - hb) * rN.x;
        hb = hN;
        placed = true;
        vec4 re = grb_rand4(id, 71u);
        int sk = (longX ? 2 : 0) + (re.x < 0.5 ? 0 : 1);   // the strip's side: bottom / top, or left / right
        int sk2 = edge && re.y < u_edge_two ? (longX ? 0 : 2) + (re.z < 0.5 ? 0 : 1) : -1;
        bool in1 = grb_pick(dS, sk) < ew, in2 = sk2 >= 0 && grb_pick(dS, sk2) < ew;
        if (bord ? dN < bwid : in1 || in2) {
          // (Where two strips meet, the corner is the first's.)
          kind = bord ? 1 : 2;
          dw = bord ? bwid : ew;
          side = sk;
          side2 = sk2;
          sel = in1 ? 0 : 1;
          done = true;
        } else {
        // What is left: the plate grown in by the border (every side) or the strips (their sides); no seam there.
        vec4 ins = bord ? vec4(bwid) : ew * (vec4(equal(ivec4(sk), ivec4(0, 1, 2, 3))) + vec4(equal(ivec4(sk2), ivec4(0, 1, 2, 3))));
        dS -= ins;
        if (bord) { dG -= bwid; dlo += bwid * 1.41421356; dhi -= bwid * 1.41421356; }
        lo += ins.xz;
        hi -= ins.yw;
        bb.xy += ins.xz;
        bb.zw -= ins.yw;
        sz = bb.zw - bb.xy;
        gap *= vec4(1.0 - step(0.5, ins.xw), vec2(bord ? 0.0 : 1.0));
        dN -= bord ? bwid : 0.0;
        dNr -= bord ? bwid : 0.0;
        if (bord) {
          // The border's step in: raised or recessed centre (Style), taken by the parts or, if none follow, the final plate.
          int fs = u_frame_style == 5 ? int(floor(re.w * 4.999)) : u_frame_style;
          ls = fs == 3 ? u_inset_depth : fs == 2 ? -u_inset_depth : 0.0;
          // (Nested raised borders don't climb past the top level and a step: the peak stays put.)
          ls = clamp(hb + ls, 0.05, 0.75 + u_inset_depth) - hb;
        }
        }
      }
    }
   if (!done) {
    // Extents along x + y and x − y.
    vec2 de = vec2(min(dhi.x, bb.z + bb.w) - max(dlo.x, bb.x + bb.y), min(dhi.y, bb.z - bb.y) - max(dlo.y, bb.x - bb.w));
    bool canX = sz.x >= 2.0 * mn.x - 1e-3;
    bool canY = sz.y >= 2.0 * mn.y - 1e-3;
    bvec2 canD = greaterThanEqual(de, vec2(2.0 * md));
    bool mustX = canX && sz.x > mx.x + 1e-3;
    bool mustY = canY && sz.y > mx.y + 1e-3;
    vec4 dr = grb_rand4(id, 1u), dr2 = grb_rand4(id, 2u);   // split, busyness, 45° cut, pinwheel; cut way, mirror, 45° axis, 45° place
    busy = mix(busy, dr.y, d < 4 ? 0.6 : 0.15);
    // (Capped below 1 unless Split chance is: busy zones still stop some panels early, not all at Min panel.)
    float ps = clamp(u_split + (busy - 0.5) * 3.0 * u_cluster, 0.0, max(u_split, 0.85));
    // Split, if it can, and must or by chance; else this is the final plate.
    if (!(canX || canY || any(canD)) || (!mustX && !mustY && dr.x >= ps)) done = true;
   if (!done) {
    // Seam width of this split's cuts: narrower the deeper (Seam taper), no wider than Seam limit of the piece.
    float sw = grb_seamW(float(d));
    if (u_seam_max > 0.0) sw = min(sw, max(floor(u_seam_max * min(sz.x, sz.y) + 0.5), min(u_gap, 1.0)));
    bool diag = any(canD) && dr.z < u_diag && !(d == 0 && u_root == 1);
    // A pinwheel: two cuts each way, four panels round a centre one (needs room for three panels each way).
    bool pin = !diag && (dr.w < u_pinwheel || (d == 0 && u_root == 1)) && sz.x >= 3.0 * mn.x - 1e-3 && sz.y >= 3.0 * mn.y - 1e-3;
    // The Pinwheel layout's root keeps its centre panel within the middle 30–70 % each way, so none of its seams spans
    // more than 70 % of the tile.
    bool rootPin = pin && d == 0 && u_root == 1;
    // The cuts: c1 (x and y at once), and a pinwheel's second pair c2 within c1..the far side — one loop, so the cut
    // helpers exist once in the shader.
    vec4 rt = grb_rand4(id, 3u);
    vec2 c1 = vec2(-1.0), c2 = vec2(-1.0);
    for (int k = 0; k < (pin ? 2 : 1) * GRB_1; k++) {
      bool sec = k == 1;
      vec2 e0 = rootPin ? lo + (sec ? 0.55 : 0.3) * sz - mn : sec ? c1 : bb.xy;
      vec2 e1 = rootPin ? lo + (sec ? 0.7 : 0.45) * sz + mn : bb.zw - (pin && !sec ? mn : vec2(0.0));
      vec2 c = grb_cutPos(e0, e1, 0.5 + ((sec ? rt.zw : pin ? rt.xy : rt.xx) - 0.5) * u_split_var, mn);
      if (rl.x > -1e8) c = grb_offLines(c, rl, e0 + mn, e1 - mn, sg);
      if (sec) c2 = c; else c1 = c;
    }
    float cx = c1.x, cy = c1.y;
    if (pin) {
      // No room for the pinwheel: cut in two instead.
      pin = cx >= 0.0 && cy >= 0.0 && all(greaterThanEqual(c2 - c1, mn - 1e-3));
      if (pin && rootPin) rl = vec4(cx, c2.x, cy, c2.y);
    }
    vec2 nlo = lo, nhi = hi, ndlo = dlo, ndhi = dhi;
    uint ck;
    if (diag) {
      // A 45° cut along x + y (or x − y: by chance, or where only that has room), at least md in from either end; its
      // seam lies above it.
      bool ax = canD.x && (!canD.y || dr2.z < 0.5);
      float e0 = ax ? max(dlo.x, bb.x + bb.y) : max(dlo.y, bb.x - bb.w);
      float e1 = e0 + (ax ? de.x : de.y);
      float c = mix(e0 + md, e1 - md, 0.5 + (dr2.w - 0.5) * u_split_var);
      c = clamp(floor(c / sg + 0.5) * sg, ceil(e0 + md), floor(e1 - md));
      float s = ((ax ? q.x + q.y : q.x - q.y) - c) * 0.70710678;
      bool upper = s >= 0.0;
      if (ax) { if (upper) ndlo.x = c; else ndhi.x = c; }
      else { if (upper) ndlo.y = c; else ndhi.y = c; }
      if (upper) { if (ax) gap.z = sw; else gap.w = sw; dL = min(dL, s); }
      dG = mix(dG, vec4(upper ? s - sw : -s), vec4(equal(ivec4(ax ? 0 : 2) + ivec4(upper ? 0 : 1), ivec4(0, 1, 2, 3))));
      ck = upper ? 0x2545F491u : 0x9E3779B1u;
    } else if (pin) {
      float x2 = c2.x, y2 = c2.y;
      // Children 0..3 wind round the centre (4); the mirror image swaps the sense of the winding.
      bool mir = dr2.y < 0.5;
      float xa = mir ? x2 : cx;   // where the bottom and top arms change over
      int ch = q.y < cy ? (q.x < (mir ? cx : x2) ? (mir ? 1 : 0) : (mir ? 0 : 1))
             : q.y < y2 ? (q.x < cx ? (mir ? 1 : 3) : q.x < x2 ? 4 : (mir ? 3 : 1))
             : (q.x < xa ? (mir ? 2 : 3) : (mir ? 3 : 2));
      vec4 r = ch == 4 ? vec4(cx, cy, x2, y2)
             : !mir ? (ch == 0 ? vec4(lo.x, lo.y, x2, cy) : ch == 1 ? vec4(x2, lo.y, hi.x, y2) : ch == 2 ? vec4(cx, y2, hi.x, hi.y) : vec4(lo.x, cy, cx, hi.y))
                    : (ch == 0 ? vec4(cx, lo.y, hi.x, cy) : ch == 1 ? vec4(lo.x, lo.y, cx, y2) : ch == 2 ? vec4(lo.x, y2, x2, hi.y) : vec4(x2, cy, hi.x, hi.y));
      // Its new edges (straight): the seams along the left and top.
      bvec4 nw = bvec4(r.x != lo.x, r.z != hi.x, r.y != lo.y, r.w != hi.y);
      vec4 nd4 = vec4(q.x - r.x - sw, r.z - q.x, q.y - r.y, r.w - sw - q.y);
      dS = mix(dS, nd4, vec4(nw));
      jm *= 1.0 - vec4(nw);
      if (nw.x) { gap.x = sw; dL = min(dL, q.x - r.x); }
      if (nw.w) { gap.y = sw; dL = min(dL, r.w - q.y); }
      nlo = r.xy;
      nhi = r.zw;
      ck = 0x1000193u * uint(ch + 1) + 0x7F4A7C15u;
    } else {
      bool cutY;   // true: a horizontal cut line (splits the height into rows)
      if (!canX) cutY = true;
      else if (!canY) cutY = false;
      else if (mustX != mustY) cutY = mustY;
      else {
        vec2 sa = sz / ak;   // the longer side in the aspect's terms
        float pref = sa.y > sa.x * 1.1 ? 0.8 : (sa.x > sa.y * 1.1 ? 0.2 : 0.5);
        cutY = dr2.x < clamp(pref + u_bias, 0.0, 1.0);
      }
      float c = cutY ? cy : cx;
      // (Below a root pinwheel, a cut dropped for lying on its seams goes the other way if it can.)
      if (c < 0.0 && rl.x > -1e8 && (cutY ? canX && cx >= 0.0 : canY && cy >= 0.0)) { cutY = !cutY; c = cutY ? cy : cx; }
      if (c < 0.0) done = true;
      else {
      // The cut line steps at 45° (Jogs) as far as its parallel sides' own steps leave room for: measured to its 45°
      // stretches as segments, so the corners stay crisp. Its seam lies right of it (x) or below it (y: GL y up).
      int a0i = cutY ? 2 : 0;   // the low side across the cut (bottom or left); a0i + 1 the high one
      float lo1 = cutY ? bb.y : bb.x, hi1 = cutY ? bb.w : bb.z;
      float jA = u_jog * max(min(c - lo1 - grb_pick(jm, a0i), hi1 - c - grb_pick(jm, a0i + 1)) - jmar, 0.0);
      float qu = (cutY ? q.y : q.x) - c;
      vec2 jg = jA >= 1.0 ? grb_jog(cutY ? q.x : q.y, qu, cutY ? bb.x : bb.y, cutY ? bb.z : bb.w, id, jA) : vec2(0.0, 1e9);
      float s = qu - jg.x;
      float dl = min(abs(s), jg.y);
      bool upper = s >= 0.0;
      bool seam = cutY != upper;
      if (cutY) { if (upper) nlo.y = c; else nhi.y = c; }
      else { if (upper) nlo.x = c; else nhi.x = c; }
      if (seam) { if (cutY) gap.y = sw; else gap.x = sw; dL = min(dL, dl); }
      // The child's new side: its low side if it is above / right of the cut, else its high side.
      int ns = a0i + (upper ? 0 : 1);
      vec4 m = vec4(equal(ivec4(ns), ivec4(0, 1, 2, 3)));
      dS = mix(dS, vec4(seam ? dl - sw : dl), m);
      jm = mix(jm, vec4(jA), m);
      ck = upper ? 0x68E31DA4u : 0xB5297A4Du;
      }
    }
   if (!done) {
    // The piece that split, on its parent: unless seamless (or placed by its decoration), its rise carries the surface
    // to its height; a border's step in follows.
    if (!placed && d > 0 && rn.x >= u_seamless) {
      vb += (hN - hb) * rN.x;
      hb = hN;
    }
    if (ls < 1e8) {
      vb += ls * rN.y;
      hb += ls;
      ls = 1e9;
    }
    lo = nlo;
    hi = nhi;
    dlo = ndlo;
    dhi = ndhi;
    id = pcg(id ^ ck);
   }
   }
   }
   }
  }
  return GrbCell(lo, hi, dlo, dhi, id, gap, dS, dG, dL, vb, hb, max(max(jm.x, jm.y), max(jm.z, jm.w)), kind, dw, side, side2, sel, ls);
}


// Plate outlines, anticlockwise: each corner as x + 4 y, indices into the panel's stops (0, x1, x2, 1 across and down) —
// box, L, T, Z (step), cross, U (notch). GRB_SH_MAIN: per outline two candidate parts (x0, y0, x1, y1 as stop indices),
// the larger of which carries the frame, rivets and details.
const int GRB_SH_OFF[7] = int[7](0, 4, 10, 18, 26, 38, 46);
const int GRB_SH_V[46] = int[46](
  0, 3, 15, 12,
  0, 3, 7, 5, 13, 12,
  1, 2, 6, 7, 15, 12, 4, 5,
  1, 3, 11, 10, 14, 12, 4, 5,
  1, 2, 6, 7, 11, 10, 14, 13, 9, 8, 4, 5,
  0, 3, 15, 14, 6, 5, 13, 12);
const ivec4 GRB_SH_MAIN[12] = ivec4[12](
  ivec4(0, 0, 3, 3), ivec4(0, 0, 3, 3), ivec4(0, 0, 1, 3), ivec4(0, 0, 3, 1), ivec4(0, 1, 3, 3), ivec4(0, 1, 3, 3),
  ivec4(0, 1, 2, 3), ivec4(1, 0, 3, 2), ivec4(0, 1, 3, 2), ivec4(1, 0, 2, 3), ivec4(0, 0, 3, 1), ivec4(0, 0, 3, 1));

// A stop point of the outline in px: unit coordinates u (turned: tf.x swaps the axes, tf.y / tf.z mirror x / y) over
// the panel lo..hi, whole px from lo (1 lands on hi).
vec2 grb_stop(vec2 u, bvec3 tf, vec2 lo, vec2 hi) {
  if (tf.x) u = u.yx;
  if (tf.y) u.x = 1.0 - u.x;
  if (tf.z) u.y = 1.0 - u.y;
  return mix(lo + floor(u * (hi - lo) + 0.5), hi, step(0.9995, u));
}

// The 45° cuts across the corners of the box lo..hi, legs k (x bottom-left, y bottom-right, z top-left, w top-right;
// 0 = none): the distance out past the nearest (-1e4 where none).
float grb_corners(vec2 p, vec2 lo, vec2 hi, vec4 k) {
  vec2 pc = p - 0.5 * (lo + hi), h = 0.5 * (hi - lo);
  vec4 dc = (vec4(-pc.x, pc.x, -pc.x, pc.x) + vec4(-pc.y, -pc.y, pc.y, pc.y) - (h.x + h.y) + k) * 0.70710678;
  dc = mix(vec4(-1e4), dc, step(0.5, k));
  return max(max(dc.x, dc.y), max(dc.z, dc.w));
}

// One polygon edge a → b for the distance (d2: nearest squared) and the even-odd inside test (s).
void grb_edge(vec2 p, vec2 a, vec2 b, inout float d2, inout float s) {
  vec2 e = b - a, w = p - a;
  vec2 c = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
  d2 = min(d2, dot(c, c));
  bvec3 k = bvec3(p.y >= a.y, p.y < b.y, e.x * w.y > e.y * w.x);
  if (all(k) || all(not(k))) s = -s;
}

// Beams: each Direction's first direction (0 rising, 1 falling, 2 horizontal, 3 vertical) and how many follow it; each
// direction's normal.
const ivec2 GRB_BEAM_DIR[5] = ivec2[5](ivec2(0, 2), ivec2(0, 1), ivec2(1, 1), ivec2(2, 2), ivec2(0, 4));
const vec2 GRB_BEAM_N[4] = vec2[4](vec2(1.0, -1.0), vec2(1.0), vec2(0.0, 1.0), vec2(1.0, 0.0));

// Greatest common divisor of the tile's sides: the period of 45° lines that tile.
float grb_gcd(vec2 r) {
  int a = int(r.x + 0.5), b = int(r.y + 0.5);
  for (int i = 0; i < 24 * GRB_1; i++) {
    if (b != 0) { int t = int(uint(a) % uint(b)); a = b; b = t; }
  }
  return float(max(a, 1));
}

// Rivet centre distance from a panel edge: the near-edge margin is whole px, so rivets mirror exactly.
float grb_rivetM(float ins, float D) { return max(floor(ins - 0.5 * D + 0.5), 0.0) + 0.5 * D; }

GenOut gen(vec2 p) {
  vec2 shift = floor(vec2(u_offset_x, -u_offset_y) * uRes + 0.5);
  vec2 q = p - shift;
  if (uTile) q = fmod2(q, uRes);
  GrbCell cell = grb_panelAt(q);
  uint id = cell.id;
  float rnd = grb_rand(id, 7u);
  // Where the pixel stopped: on a final plate, or in a piece's border or edge strip (deco: that piece's plate, with its
  // decoration). The distances in from the cell's two nearest sides.
  bool deco = cell.kind != 0;
  vec2 cm = grb_min8(cell.dS, cell.dG);
  float cA = cm.x, cA2 = cm.y;

  // Panel: the cell's box from its cuts as straight lines, less the seams along its left, top (GL: high y) and low 45°
  // edges (pb; pk: its corner cuts where 45° cuts bound it) — for sizes, shapes and details. The plate itself is measured
  // from the cell's true, jogging edges: dCell, its corners rounded by Corner rounding.
  const float R2 = 1.41421356;
  vec2 clo = vec2(cell.lo.x + cell.gap.x, cell.lo.y), chi = vec2(cell.hi.x, cell.hi.y - cell.gap.y);
  vec4 pk;
  vec4 pb = grb_octBox(clo, chi, cell.dlo + cell.gap.zw * R2, cell.dhi, pk);
  bool diagCell = any(greaterThan(pk, vec4(0.5)));
  vec2 plo = pb.xy, phi = pb.zw;
  vec2 psz = max(phi - plo, vec2(0.0));
  // The box inside a 45°-cut cell: less half the corner cuts on each side (what sizes are measured on). The frame, rivets
  // and details go in it less the jogs' reach.
  vec2 ilo0 = plo + 0.5 * vec2(max(pk.x, pk.z), max(pk.x, pk.y)), ihi0 = phi - 0.5 * vec2(max(pk.y, pk.w), max(pk.z, pk.w));
  vec2 isz = max(ihi0 - ilo0, vec2(0.0));
  float side = min(isz.x, isz.y);
  float area = sqrt(isz.x * isz.y);   // what the Min panel gates compare
  // The final plate's randoms, packed: empty / shaped, shape kind, turn (3), fill plate's level, level, rivets, rivet mode.
  vec4 lr = grb_rand4(id, 50u), lr2 = grb_rand4(id, 51u);
  float rnd0 = lr.x;
  bool none = !deco && rnd0 < u_empty;   // an empty panel: only its backing shows
  float rc0 = u_round;
  float dCell = -(cA < rc0 && cA2 < rc0 ? rc0 - length(vec2(rc0 - cA, rc0 - cA2)) : cA);

  // ---- the plate's outline: the panel, or (Shaped panels) an L, T, Z, cross or U inside it; outside corners cut at 45°
  // by chance (Cut corners), inside ones filled at 45° (Inside corners). One polygon, measured in one loop.
  // Shaped arms are at least a quarter of the panel's short side: that must leave room for two bevels and some top.
  int shp = 0;
  if (!none && !deco && !diagCell && (rnd0 - u_empty) / max(1.0 - u_empty, 1e-3) < u_shape_chance && area >= float(u_shape_min)
      && 0.25 * side >= max(2.0 * u_bevel + 3.0, 5.0))
    shp = u_shape_kind == 5 ? 1 + int(floor(lr.y * 4.999)) : 1 + u_shape_kind;
  vec4 r4 = grb_rand4(id, 52u);
  vec4 xs = vec4(0.0, 0.5, 0.5, 1.0), ys = xs;
  if (shp == 1) { xs.y = mix(0.35, 0.6, r4.x); ys.y = mix(0.35, 0.6, r4.y); }
  else if (shp == 2) {
    float a = mix(0.3, 0.5, r4.x), c = mix(0.5 * a + 0.12, 0.88 - 0.5 * a, r4.z);
    xs.yz = vec2(c - 0.5 * a, c + 0.5 * a);
    ys.y = 1.0 - mix(0.35, 0.6, r4.y);
  } else if (shp == 3) {
    vec2 a = mix(vec2(0.6), vec2(0.75), r4.xy);
    xs.yz = vec2(1.0 - a.x, a.x);
    ys.yz = vec2(1.0 - a.y, a.y);
  } else if (shp == 4) {
    vec2 a = mix(vec2(0.3), vec2(0.5), r4.xy), c = mix(vec2(0.4), vec2(0.6), r4.zw);
    xs.yz = c.x + vec2(-0.5, 0.5) * a.x;
    ys.yz = c.y + vec2(-0.5, 0.5) * a.y;
  } else if (shp == 5) {
    xs.yz = vec2(mix(0.25, 0.4, r4.x), 1.0 - mix(0.25, 0.4, r4.z));
    ys.y = mix(0.35, 0.55, r4.y);
  }
  bvec3 tf = lessThan(vec3(lr.zw, lr2.x), vec3(0.5));
  if (shp == 0) tf = bvec3(false);
  float ori = (tf.x != tf.y) != tf.z ? -1.0 : 1.0;   // mirrored once or thrice: clockwise
  // Corner rounding: the outline is built that much smaller and grown back, rounding every outside corner.
  float rr0 = clamp(u_round, 0.0, max(0.5 * side - 0.5, 0.0));
  vec2 olo = plo + rr0, ohi = phi - rr0;
  int s0 = GRB_SH_OFF[shp], nv = GRB_SH_OFF[shp + 1] - s0;
  float pd2 = 1e8, ps = 1.0, kmax = 0.0;
  // (A wedge needs room past its seam for its bevels to meet in a ridge at least.)
  float kWedge = ceil(1.4143 * max(max(cell.gap.x, cell.gap.y), max(cell.gap.z, cell.gap.w)) + 1.5 * min(u_bevel, 0.2 * side) + 2.0);
  // A plain panel: its corners cut by chance (legs by quadrant: bit 0 right, bit 1 top), unless the cell has 45° sides
  // of its own.
  vec4 kq = vec4(0.0);
  if (shp == 0 && !diagCell && !deco) {
    vec4 rc = grb_rand4(id, 60u), rs = grb_rand4(id, 61u);
    kq = min(floor(u_cut_size * side * (1.0 - u_cut_var * rs) + 0.5), vec4(floor(0.5 * side))) * (1.0 - step(vec4(u_cut_chance), rc));
    kq *= step(vec4(u_fill == 2 ? kWedge : 2.0), kq);
    kmax = max(max(kq.x, kq.y), max(kq.z, kq.w));
  }
  vec2 w1 = vec2(0.0), w2 = vec2(0.0), A1 = vec2(0.0), B1 = vec2(0.0);
  // A shaped plate: a sliding window over its corners — corner j comes in, corner j - 1 gets its legs, the edges of corner
  // j - 2 are measured.
  for (int j = -2; j <= 12 * GRB_1; j++) {
    if (shp > 0 && j <= nv) {
      int code = GRB_SH_V[s0 + int(uint(j + nv) % uint(nv))];
      vec2 w3 = grb_stop(vec2(grb_pick(xs, code & 3), grb_pick(ys, code >> 2)), tf, olo, ohi);
      if (j >= 0) {
        vec2 ein = w2 - w1, eout = w3 - w2;
        float lin = length(ein), lout = length(eout), S = min(lin, lout);
        float cr = (ein.x * eout.y - ein.y * eout.x) * ori;
        uint vi = uint(j - 1 + nv) % uint(nv);
        float k = cr > 0.0
          ? (grb_rand(id, 60u + vi) < u_cut_chance ? u_cut_size * S * (1.0 - u_cut_var * grb_rand(id, 80u + vi)) : 0.0)
          : cr < 0.0 ? u_fillet * S : 0.0;
        k = min(floor(k + 0.5), floor(0.5 * S));
        // (Too short to read as a cut — or, with Fill › Plates, to leave a wedge past the seam.)
        if (k < (u_fill == 2 && cr > 0.0 ? kWedge : 2.0)) k = 0.0;
        if (cr > 0.0) kmax = max(kmax, k);
        vec2 A2 = w2 - k * ein / max(lin, 1e-3), B2 = w2 + k * eout / max(lout, 1e-3);
        if (j >= 1) {
          grb_edge(q, A1, B1, pd2, ps);
          grb_edge(q, B1, A2, pd2, ps);
        }
        A1 = A2;
        B1 = B2;
      }
      w1 = w2;
      w2 = w3;
    }
  }
  // The plate: the cell, with its corner cuts or as its shape (both cut by the cell's jogging edges).
  float dRect = dCell;
  float dPoly = none ? 1e4 : max(dCell, shp > 0 ? ps * sqrt(pd2) - rr0 : grb_corners(q, pb.xy, pb.zw, kq));
  if (shp > 0) kq = vec4(kmax);
  float dP = dPoly;
  // An empty panel: the plates are the neighbours, beyond the cell's edges.
  if (none) dP = max(cA, 0.5);
  // In the seam, the neighbouring panel starts at the seam line.
  if (dP > 0.0) dP = min(dP, max(cell.dL, 0.0));

  int levels = max(u_levels, 1);
  float lvl = levels > 1 ? floor(lr2.z * float(levels)) / float(levels - 1) : 0.0;
  // The plateau: evenly spaced levels from the top (0.75) down to the lowest (Height variation, held up by Lowest
  // level), domed (Bulge) by a smooth pillow that is 0 at the panel's edges and 1 at its centre — in proportion to the
  // plateau's height, so a dished low panel stays above the floor.
  float lowest = max(1.0 - u_height_var, u_min_level);
  // The pillow rises over the outer part of each half-width (Bulge spread: 0.3 of it, a cushion with a flat top, … all
  // of it, a full dome).
  vec2 pu = clamp((q - 0.5 * (plo + phi)) / max(0.5 * psz, vec2(1e-3)), -1.0, 1.0);
  float bw = mix(0.3, 1.0, u_bulge_spread);
  vec2 cg = 1.0 - min((1.0 - abs(pu)) / bw, 1.0);
  vec2 pw = 1.0 - cg * cg;
  // (A decoration's pixel is on its piece's plate, in the surface already; a final plate inside a border takes the
  // border's step.)
  float P = deco ? cell.hb : cell.ls < 1e8 ? cell.hb + cell.ls : grb_lift(cell.hb, mix(1.0, lowest, lvl)) * (1.0 + u_bulge / 0.75 * pw.x * pw.y);
  // A panel's bevel is at most a fifth of its shorter side (of a shaped plate's arms; 0.4 of the box inside a 45°-cut
  // cell, whose corners reach past it), so the small panels of busy zones keep flat tops.
  float bev = min(u_bevel, max((shp > 0 ? 0.06 : diagCell ? 0.4 : 0.2) * side, 0.5));
  // The plate stands on the surface the pieces above it leave (cell.vb, at height cell.hb: the floor unless they draw).
  // Where it leaves the panel (cut corners, shapes, empty panels): that surface, a lower backing plate, or plates of
  // their own a seam away from it (at their own level), which then count as plates for the shape outputs. (Their rises
  // are taken after the frame, with a raised or recessed centre's: one bevel profile in the shader, not three.)
  float dPl = dP;
  float dFill = max(dRect, max(cell.gap.x, cell.gap.y) - dPoly);
  float lf = levels > 1 ? floor(lr2.y * float(levels)) / float(levels - 1) : 0.0;
  if (u_fill == 2) dP = min(dP, dFill);
  float v = 0.0;               // what the frame adds; the plate joins it after
  float dIr = 1e4, fc = 0.0;   // a raised (fc > 0) or recessed centre: its outline and rise

  // A shaped plate's frame, rivets and details go on its larger part.
  if (shp > 0) {
    // (Compared in unit space, scaled by the panel turned with the outline.)
    ivec4 m1 = GRB_SH_MAIN[2 * shp], m2 = GRB_SH_MAIN[2 * shp + 1];
    vec4 u1 = vec4(grb_pick(xs, m1.x), grb_pick(ys, m1.y), grb_pick(xs, m1.z), grb_pick(ys, m1.w));
    vec4 u2 = vec4(grb_pick(xs, m2.x), grb_pick(ys, m2.y), grb_pick(xs, m2.z), grb_pick(ys, m2.w));
    vec2 tz = tf.x ? psz.yx : psz;
    vec2 e1 = (u1.zw - u1.xy) * tz, e2 = (u2.zw - u2.xy) * tz;
    vec4 um = e2.x * e2.y > e1.x * e1.y ? u2 : u1;
    vec2 ma = grb_stop(um.xy, tf, plo, phi), mb = grb_stop(um.zw, tf, plo, phi);
    plo = min(ma, mb);
    phi = max(ma, mb);
    psz = phi - plo;
    side = min(psz.x, psz.y);
    area = sqrt(psz.x * psz.y);
  }
  else if (cell.kind == 2) {
    // An edge strip: its rect along the piece's side (the second strip leaves the corner to the first), clear of how far
    // the side steps.
    int sk = cell.sel == 0 ? cell.side : cell.side2, so = cell.sel == 0 ? cell.side2 : cell.side;
    vec4 sr = pb;
    float ew = cell.dw;
    if (sk == 0) sr.z = sr.x + ew; else if (sk == 1) sr.x = sr.z - ew; else if (sk == 2) sr.w = sr.y + ew; else sr.y = sr.w - ew;
    if (cell.sel == 1) { if (so == 0) sr.x += ew; else if (so == 1) sr.z -= ew; else if (so == 2) sr.y += ew; else sr.w -= ew; }
    vec2 jr2 = min(vec2(cell.jr) * (sk < 2 ? vec2(1.0, 0.0) : vec2(0.0, 1.0)), 0.25 * (sr.zw - sr.xy));
    plo = sr.xy + jr2;
    phi = sr.zw - jr2;
    psz = max(phi - plo, vec2(0.0));
    side = min(psz.x, psz.y);
    area = sqrt(psz.x * psz.y);
  }
  else if (cell.kind == 0) {
    plo = ilo0 + min(vec2(cell.jr), 0.25 * isz);
    phi = ihi0 - min(vec2(cell.jr), 0.25 * isz);
    psz = phi - plo;
  }
  vec2 pcen = 0.5 * (plo + phi), phb = 0.5 * psz;
  float dSunk = 1e4;   // everything sunk into the plate (the Plate tops shape leaves it out)

  // ---- a border (the pixel stopped in a piece's border band): a groove or ridge line down its middle, or rivets
  // along it; a raised or recessed centre is the step in, taken by what is inside.
  float dF = 1e4;
  float keep = 0.0;   // the details stay this far inside the panel: clear of its rivets
  int fs = -1;
  if (cell.kind == 1) {
    fs = u_frame_style == 5 ? int(floor(grb_rand4(id, 71u).w * 4.999)) : u_frame_style;
    float dB = -dCell;   // in from the piece's edge
    dF = fs <= 1 ? abs(dB - 0.5 * cell.dw) - 0.5 * u_frame_width : dB - cell.dw;
    if (fs <= 1) v += (fs == 1 ? 1.0 : -1.0) * u_inset_depth * grb_cov(dF);
    if (fs == 0) dSunk = dF;
  }

  vec3 r3 = grb_rise3(vec3(dPl, u_fill == 2 ? dFill : dRect, dIr), bev);
  v += cell.vb + (P - cell.hb) * (u_fill == 1 ? max(r3.x, u_backing * r3.y) : r3.x) + fc * r3.z;
  if (u_fill == 2) v += (grb_lift(cell.hb, mix(1.0, lowest, lf)) - cell.hb) * r3.y;

  // ---- rivets: two rows (or columns) at least a rivet's width apart; an axis too short for that gets one line down
  // its middle (a strap), a panel short both ways none.
  float dR = 1e4;
  float rr = u_rivet_radius;
  // (A riveted border: one row along the middle of its band, round the piece's box.)
  bool rb = cell.kind == 1 && fs == 4;
  if (rb) { plo = pb.xy; phi = pb.zw; psz = phi - plo; pcen = 0.5 * (plo + phi); phb = 0.5 * psz; side = min(psz.x, psz.y); rr = min(rr, max(0.5 * cell.dw - 1.0, 0.5)); }
  if (rb || (!deco && !none && u_rivets > 0 && lr2.w < u_rivet_chance && area >= float(u_rivet_min))) {
    float D = 2.0 * rr;
    float m = rb ? grb_snapC(0.5 * cell.dw, D) : grb_rivetM(u_rivet_inset, D);
    vec2 a = plo + m, b = phi - m;   // rectangle of rivet centres
    bvec2 thin = lessThan(b - a, vec2(2.0 * D));
    int rm = rb ? 2 : u_rivets == 4 ? 1 + int(floor(grb_rand4(id, 53u).x * 2.999)) : u_rivets;   // 1 corners, 2 edges, 3 long sides
    if (!(thin.x && thin.y) && side >= D + 2.0) {
      keep = max(keep, ceil(m + rr) + 1.0);
      vec2 mid = vec2(grb_snapC(0.5 * (plo.x + phi.x), D), grb_snapC(0.5 * (plo.y + phi.y), D));
      if (thin.x) { a.x = mid.x; b.x = mid.x; }
      if (thin.y) { a.y = mid.y; b.y = mid.y; }
      // The nearest rivet centre: a corner, or the nearest along the rows (top / bottom edges) or columns (left / right).
      vec2 near = vec2(q.x < 0.5 * (a.x + b.x) ? a.x : b.x, q.y < 0.5 * (a.y + b.y) ? a.y : b.y);
      vec2 rc = near;
      if (rm != 1) {
        vec2 span = b - a;
        vec2 n = max(floor(span / max(u_rivet_spacing, 1.0) + 0.5), vec2(1.0));
        vec2 st = span / n;
        vec2 k = clamp(floor((q - a) / max(st, vec2(1e-3)) + 0.5), vec2(0.0), n);
        vec2 rowC = vec2(grb_snapC(a.x + k.x * st.x, D), near.y);
        vec2 colC = vec2(near.x, grb_snapC(a.y + k.y * st.y, D));
        bool useRow = rm == 3 ? psz.x >= psz.y : length(q - rowC) <= length(q - colC);
        rc = useRow ? rowC : colC;
      }
      dR = length(q - rc) - rr;
      // (None in a cut corner: its quadrant's chamfer, and the rivet within it plus a rivet's width.)
      vec2 rp = rc - pcen;
      float kr = grb_pick(kq, (rp.x >= 0.0 ? 1 : 0) + (rp.y >= 0.0 ? 2 : 0));
      vec2 dcr = phb - abs(rp);
      if (kr > 0.0 && dcr.x + dcr.y < kr + 1.5 * (rr + 1.0)) dR = 1e4;
      v += u_rivet_height * grb_dome(dR + rr, rr);
    }
  }

  // ---- details: one per chosen panel, or two side by side (Paired details), each a vent grille, light, recess,
  // perforation, ribs or a pipe / handle in an area of Size (± Size variation) centred, against an edge or in a corner of
  // the free part of the panel (inside its frame line, rivets and cut corners, and a bevel and 2 px of plate in
  // from its edge). Big panels may get a hero part instead (Hero parts), small ones a small part (Small parts).
  float dD = 1e4, dL = 1e4;
  // A pipe run's tubes, from a detail or an edge strip: offset across the bundle, run spacing, runs, tube radius; whether
  // the pixel is along the run; its flanges' distance.
  vec4 tp = vec4(0.0, 1.0, 1.0, 1.0);
  bool tOn = false;
  float tM = 1e4;
  float dHole = 1e4;   // through-holes (slots, perforation): left out of every plate shape
  int nk = (u_det_vents ? 1 : 0) + (u_det_light ? 1 : 0) + (u_det_recess ? 1 : 0) + (u_det_holes ? 1 : 0) + (u_det_ribs ? 1 : 0) + (u_det_pipes ? 1 : 0);
  // An edge strip holds a pipe run (Edge strips › Pipe runs: below) or one detail filling it.
  bool strip = cell.kind == 2;
  // (Packed: strip pipe, detail, small part, hero; size, anchor, side x, side y; edge axis, pair, pair cut.)
  vec4 da = grb_rand4(id, 90u), db = grb_rand4(id, 91u), dc = grb_rand4(id, 92u);
  bool sPipe = strip && u_det_pipes && da.x < u_edge_pipes;
  bool big = strip || area >= float(u_det_min);
  bool hasDet = strip ? !sPipe && nk > (u_det_pipes ? 1 : 0) : !deco && !none && nk > 0 && da.y < u_detail_chance;
  bool smallP = !deco && !none && !big && u_detail_chance > 0.0 && da.z < u_small_parts;
  bool hero = !deco && big && hasDet && area >= 2.5 * float(u_det_min) && da.w < u_hero
           && (u_det_vents || u_det_holes || u_det_light || u_det_pipes);
  if ((hasDet && big) || smallP) {
    if (kmax > 0.0) keep = max(keep, ceil(0.5 * kmax) + 2.0);
    float m0 = min(ceil(bev) + 2.0, floor(0.25 * side));
    vec2 flo = plo + max(keep, m0), fhi = phi - max(keep, m0);
    vec2 fsz = max(fhi - flo, vec2(0.0));
    float sz = hero ? 0.9 : strip ? 0.96 : u_det_size * (1.0 - u_det_var * db.x);
    vec2 asz = min(psz - 2.0 * floor(psz * (1.0 - sz) * 0.5 + 0.5), fsz);
    // Placement: 0 centred, 1 against a random edge, 2 in a random corner.
    int an = hero || strip ? 0 : u_det_anchor == 3 ? int(floor(db.y * 2.999)) : u_det_anchor;
    vec2 slack = fsz - asz;
    vec2 sd = step(0.5, db.zw);   // which side, per axis
    bool ax = dc.x < 0.5;         // an edge across x (else y)
    vec2 pos = an == 0 ? vec2(0.5) : an == 2 ? sd : (ax ? vec2(sd.x, 0.5) : vec2(0.5, sd.y));
    vec2 rlo = flo + floor(slack * pos), rhi = rlo + asz;
    // Paired: split along the longer side, a gap between, the pixel's part decides.
    uint pid = id;
    bool lx = asz.x >= asz.y;
    float L = lx ? asz.x : asz.y;
    if (!smallP && !hero && !strip && dc.y < u_det_pair && L >= 12.0) {
      float g = max(2.0, floor(0.06 * L + 0.5));
      float cut = floor(L * mix(0.3, 0.5, dc.z) + 0.5);
      bool second = (lx ? q.x - rlo.x : q.y - rlo.y) >= cut + 0.5 * g;
      if (lx) { if (second) rlo.x += cut + g; else rhi.x = rlo.x + cut; }
      else { if (second) rlo.y += cut + g; else rhi.y = rlo.y + cut; }
      pid = pcg(id ^ (second ? 0x3C6EF372u : 0xA54FF53Au));
    }
    vec2 rs = rhi - rlo;
    if (all(greaterThanEqual(rs, vec2(smallP ? 2.0 : 3.0)))) {
      // 0 vent slots, 1 light, 2 recess, 3 perforation, 4 ribs, 6 pipe or handle; small parts: 0 one slot, 5 a bolt.
      // Heroes: a recessed grille or perforation, a light panel or a pipe run. Only the kinds that are switched on and fit
      // the area (a grille or ribs three bars, a perforation 3 × 3 holes, a light a 3 px lens, a pipe a tube of Min tube
      // with its flanges), so a panel that gets a detail never stays blank.
      bool horiz = rs.x >= rs.y;
      vec2 sl0 = horiz ? rs : rs.yx;   // the area, long side first
      float wall = u_recess_wall > 0.0 ? u_recess_wall : bev;
      // (Packed: bay, kind pick, pipe or handle, elbow side; runs, light style, light edge.)
      vec4 pa = grb_rand4(pid, 93u), pb2 = grb_rand4(pid, 94u);
      bool bayRoll = !smallP && (hero || pa.x < u_det_bay);
      float pitch = max(u_vent_pitch, 2.0);
      float sw = clamp(u_vent_slot, 1.0, pitch - 1.0);
      vec2 nb = floor((sl0 - (bayRoll ? 2.0 * (ceil(wall) + 1.0) : 0.0) + pitch - sw) / pitch);   // in a bay if it gets one
      vec2 nrb = floor((sl0 + pitch - sw) / pitch);
      float tr = max(1.0, floor(0.5 * max(u_pipe_size * sl0.y, u_pipe_min) + 0.5));
      float fw = max(1.0, floor(0.4 * tr + 0.5));
      bool f0 = u_det_vents && (smallP ? sl0.y >= 4.0 : nb.y >= 3.0);
      bool f1 = u_det_light && sl0.y >= 3.0 + 2.0 * u_light_rim;
      bool f2 = u_det_recess;
      bool f3 = u_det_holes && min(nb.x, nb.y) >= 3.0;
      bool f4 = u_det_ribs && nrb.y >= 3.0;
      // (A pipe or handle needs room to read as one, not as a letter: at least 4 tube diameters long.)
      bool f6 = u_det_pipes && !strip && 2.0 * (tr + fw) <= sl0.y && sl0.x >= max(2.0 * tr + 16.0, 8.0 * tr);
      int nh = (f0 ? 1 : 0) + (f3 ? 1 : 0) + (f1 ? 1 : 0) + (f6 ? 1 : 0);
      bool hr = hero && nh > 0;
      int nf = smallP ? (f0 ? 2 : 1) : hr ? nh : (f0 ? 1 : 0) + (f1 ? 1 : 0) + (f2 ? 1 : 0) + (f3 ? 1 : 0) + (f4 ? 1 : 0) + (f6 ? 1 : 0);
      int kind = -1, cnt = 0;
      int pick = int(floor(pa.y * float(nf)));
      if (smallP) {
        if (f0) { if (cnt == pick) kind = 0; cnt++; }
        if (cnt == pick) kind = 5;
      } else if (hr) {
        if (f0) { if (cnt == pick) kind = 0; cnt++; }
        if (f3) { if (cnt == pick) kind = 3; cnt++; }
        if (f1) { if (cnt == pick) kind = 1; cnt++; }
        if (f6) { if (cnt == pick) kind = 6; cnt++; }
      } else {
        if (f0) { if (cnt == pick) kind = 0; cnt++; }
        if (f1) { if (cnt == pick) kind = 1; cnt++; }
        if (f2) { if (cnt == pick) kind = 2; cnt++; }
        if (f3) { if (cnt == pick) kind = 3; cnt++; }
        if (f4) { if (cnt == pick) kind = 4; cnt++; }
        if (f6) { if (cnt == pick) kind = 6; cnt++; }
      }
      bool slots = kind == 0 || kind == 3 || kind == 4;
      // A recess, or the bay a recessed grille sits in: walls sloping over Recess wall (or the Edge bevel). It sinks at
      // most half of what stands under it, so a recess in a recessed centre stays a pocket, not a hole.
      bool bay = (kind == 0 || kind == 3) && bayRoll;
      if (kind == 2 || bay) {
        dD = grb_box(q, rlo, rhi);
        dSunk = min(dSunk, dD);
        // (A plain smooth ramp, not the Edge profile: each profile call site costs D3D compile time.)
        v -= min(u_inset_depth, 0.5 * v) * smoothstep(0.0, 1.0, -dD / max(wall, 0.5));
        if (bay) { float w = ceil(wall) + 1.0; rlo += w; rhi -= w; }
      }
      // Work along the area's longer side: x in ql.
      vec2 ql = horiz ? q : q.yx;
      vec2 lo2 = horiz ? rlo : rlo.yx, hi2 = horiz ? rhi : rhi.yx;
      vec2 sl = hi2 - lo2;
      if (slots && all(greaterThanEqual(sl, vec2(smallP ? 2.0 : 3.0)))) {
        // Slots (and ribs) run along the longer side, stacked across the shorter one; holes sit on a grid of the same
        // pitch. All centre their rows in the area and measure to the nearest one.
        vec2 n = smallP ? vec2(1.0) : max(floor((sl + pitch - sw) / pitch), vec2(1.0));
        if (smallP) sw = min(sw, max(sl.y - 2.0, 2.0));
        vec2 o = lo2 + floor((sl - (n * pitch - (pitch - sw))) * 0.5);
        vec2 j = clamp(floor((ql - o - 0.5 * sw) / pitch + 0.5), vec2(0.0), n - 1.0);
        vec2 s0 = o + j * pitch;
        // A perforation needs at least 3 × 3 holes (fewer read as dice), a grille or ribs three bars (fewer read as
        // scratches) — the kind choice above sees to that, but a bay's walls may still take the room.
        if ((kind == 3 && min(n.x, n.y) < 3.0) || (!smallP && kind != 3 && n.y < 3.0)) s0 = vec2(-1e4);
        dD = kind == 3 ? length(ql - s0 - 0.5 * sw) - 0.5 * sw : grb_rbox(ql, vec2(lo2.x, s0.y), vec2(hi2.x, s0.y + sw), 0.5 * sw);
        if (kind == 4) {
          // Ribs: rounded bars standing up from the plate.
          // (A plain smooth ramp, not the Edge profile: each profile call site costs D3D compile time.)
          v += 0.8 * u_inset_depth * smoothstep(0.0, 1.0, -dD / max(0.5 * sw, 0.5));
        } else {
          dHole = dD;
          dSunk = min(dSunk, dD);
          // The plate slopes down into each opening over a px or two, a wall rather than a cliff.
          float rim = smallP ? 1.0 : max(1.0, min(bev, 0.4 * (pitch - sw)));
          v *= smoothstep(0.0, 1.0, dD / rim);
        }
      } else if (kind == 5) {
        // A bolt: one dome, as big as the part's area allows (up to 1.5 × the rivet radius).
        float br = max(min(1.5 * u_rivet_radius, 0.5 * min(sl.x, sl.y)), 0.5);
        vec2 c = vec2(grb_snapC(0.5 * (lo2.x + hi2.x), 2.0 * br), grb_snapC(0.5 * (lo2.y + hi2.y), 2.0 * br));
        dD = length(ql - c) - br;
        v += u_rivet_height * grb_dome(dD + br, br);
      } else if (kind == 6) {
        // Pipes: a bundle of up to Pipe runs parallel tubes along the area that turn through concentric round elbows off
        // one long edge; handles: one straight tube (none under 12 px long, at least 3 px thick). Each tube a true
        // half-round, Pipe size × the area's short side across (at least Min tube: tr, fw above), standing on what is
        // under it (a raised centre too) and butting a flange plate across the bundle at each end. The runs are measured
        // as an offset from the innermost one (along, round the elbow, up the leg), so one evaluation covers the bundle.
        // (A pipe run with its elbow needs 8 diameters along the area; shorter areas get a handle.)
        bool pipe = hero || (pa.z < 0.6 && sl.x >= 16.0 * tr);
        float fl = max(2.0, floor(0.5 * tr + 0.5));              // flange thickness, along the run
        float R = max(2.0 * tr, floor(0.12 * sl.y + 0.5));
        // Room across for the bundle and its elbow and leg: else fewer runs, or a handle.
        float room = sl.y - (fw + 3.0 * tr + R + fl);
        if (room < 0.0) pipe = false;
        if (!pipe) tr = max(tr, 1.5);
        float sp = 2.0 * tr + max(1.0, floor(0.6 * tr + 0.5));   // run spacing
        float nr = pipe ? 1.0 + floor(pb2.x * float(max(u_pipe_runs, 1)) * 0.999) : 1.0;
        nr = clamp(nr, 1.0, max(floor(room / sp) + 1.0, 1.0));
        float band = (nr - 1.0) * sp;
        float sy = pa.w < 0.5 ? 1.0 : -1.0;   // the elbow turns towards +y or -y
        float y0 = floor(pipe ? (sy > 0.0 ? lo2.y + fw + tr + band : hi2.y - fw - tr - band) : 0.5 * (lo2.y + hi2.y)) + 0.5;
        float x0 = lo2.x + fl;
        float xe = pipe ? hi2.x - fw - tr - band - R : hi2.x - fl;
        float y1 = sy > 0.0 ? hi2.y - fl : lo2.y + fl;
        vec2 E = vec2(xe, y0 + sy * R);
        bool fits = xe - x0 >= (pipe ? 2.0 * tr : 12.0) && (!pipe || sy * (y1 - E.y) >= tr);
        float off = sy * (y0 - ql.y);
        bool inRun = ql.x >= x0 && ql.x <= xe;
        if (pipe && ql.x > xe) {
          bool leg = sy * (ql.y - E.y) > 0.0;
          off = leg ? ql.x - (xe + R) : length(ql - E) - R;
          inRun = !leg || sy * (y1 - ql.y) >= 0.0;
        }
        vec2 f1c = vec2(x0 - 0.5 * fl, y0 - sy * 0.5 * band), f1h = vec2(0.5 * fl, 0.5 * band + tr + fw);
        vec2 f2c = pipe ? vec2(xe + R + 0.5 * band, y1 + sy * 0.5 * fl) : vec2(xe + 0.5 * fl, y0);
        vec2 f2h = pipe ? vec2(0.5 * band + tr + fw, 0.5 * fl) : f1h;
        // (Drawn below, with a strip's pipe run: one copy of the tubes in the shader.)
        tp = vec4(off, sp, nr, tr);
        tOn = fits && inRun;
        tM = fits ? min(sdBox(ql - f1c, f1h), sdBox(ql - f2c, f2h)) : 1e4;
      } else if (kind == 1) {
        int st = hero ? 3 : u_light_style == 4 ? int(floor(pb2.y * 3.999)) : u_light_style;
        float rel = (st == 1 ? 0.5 : 1.0) * u_light_rel;   // a row's lamps half the size, so a row has several
        float s = max(u_light_size, floor(rel * sl.y + 0.5));
        float rim = u_light_rim;
        bool low = pb2.z < 0.5;   // which long edge a row or strip runs along
        vec2 ls, c;
        if (st == 0) {
          // One lens, centred, its housing inside the area too.
          ls = min(vec2(s * max(u_light_len, 1.0), s), max(sl - 2.0 * rim, vec2(1.0)));
          c = 0.5 * (lo2 + hi2);
        } else if (st == 3) {
          // A light panel filling the area.
          ls = max(sl - 2.0 * rim, vec2(1.0));
          c = 0.5 * (lo2 + hi2);
        } else {
          // A row of round lamps, or one strip, along a long edge.
          ls = st == 1 ? vec2(min(s, sl.y)) : vec2(max(sl.x - 2.0 * rim, 1.0), min(s, sl.y));
          float lp = ls.x + 2.0 * rim + max(1.0, floor(0.5 * ls.x + 0.5));
          float n = st == 1 ? max(floor((sl.x - 2.0 * rim - ls.x) / lp) + 1.0, 1.0) : 1.0;
          float x0 = lo2.x + floor((sl.x - (n - 1.0) * lp - ls.x) * 0.5) + 0.5 * ls.x;
          float jx = clamp(floor((ql.x - x0) / lp + 0.5), 0.0, n - 1.0);
          c = vec2(x0 + jx * lp, low ? lo2.y + rim + 0.5 * ls.y : hi2.y - rim - 0.5 * ls.y);
        }
        // A lens thinner than 3 px reads as a scratch — none.
        if (min(ls.x, ls.y) >= 3.0) {
          c = vec2(grb_snapC(c.x, ls.x), grb_snapC(c.y, ls.y));
          dL = grb_rbox(ql, c - 0.5 * ls, c + 0.5 * ls, st == 1 ? 0.5 * ls.x : min(1.0, 0.25 * min(ls.x, ls.y)));
          dD = dL - rim;   // the housing round the lens
          dSunk = min(dSunk, max(dD, -dL));
          // (Sunk into what is under it, a raised centre too.)
          float vh = v;
          v = mix(v, vh - u_inset_depth, grb_cov(dD));
          float hb = 0.5 * min(ls.x, ls.y);
          v = mix(v, vh - 0.4 * u_inset_depth + u_light_dome * grb_dome(hb + dL, hb), grb_cov(dL));
        }
      }
    }
  }

  // ---- a pipe run in an edge strip: up to Pipe runs half-round tubes side by side along the strip, measured in from the
  // piece's side (so they follow its steps); with a second strip they turn its corner in a round elbow, wrapping round the
  // inside. They butt flange plates where the strip meets the piece's other sides.
  if (sPipe) {
    float ew = cell.dw;
    int sk = cell.sel == 0 ? cell.side : cell.side2, so = cell.sel == 0 ? cell.side2 : cell.side;
    float da = grb_pick(cell.dS, cell.side), db = cell.side2 >= 0 ? grb_pick(cell.dS, cell.side2) : 1e9;
    float dI2 = da < ew && db < ew ? ew - length(vec2(ew - da, ew - db)) : min(da, db);   // in from the strips' sides, the corner rounded
    float fw = max(1.0, floor(0.15 * ew + 0.5));
    float use = ew - 2.0 * fw;
    float nr = clamp(1.0 + floor(grb_rand(id, 75u) * float(max(u_pipe_runs, 1)) * 0.999), 1.0, max(floor((use + 1.0) / (2.0 * u_pipe_min + 1.0)), 1.0));
    float tr = max(0.5 * floor((use - (nr - 1.0)) / nr), 0.5);
    float sp = 2.0 * tr + 1.0;
    // Flanges where the strip meets the piece's sides across it (not the corner the run turns).
    ivec2 pp = sk < 2 ? ivec2(2, 3) : ivec2(0, 1);
    float flw = max(2.0, floor(0.5 * ew));
    tp = vec4(dI2 - fw - tr, sp, nr, tr);
    tOn = true;
    tM = min(pp.x == so ? 1e4 : grb_pick(cell.dS, pp.x) - flw, pp.y == so ? 1e4 : grb_pick(cell.dS, pp.y) - flw);
  }
  // The tubes (half-rounds standing on what is under them) butting their flange plates, with a 1 px contact line where
  // a tube meets the plate, so its edge reads.
  if (tOn || tM < 1e3) {
    float kr = clamp(floor(tp.x / tp.y + 0.5), 0.0, tp.z - 1.0);
    float dl = abs(tp.x - kr * tp.y);
    float dT = tOn ? dl - tp.w : 1e4;
    dD = min(dT, tM);
    float vh = v;
    v -= 0.3 * u_inset_depth * grb_cov(abs(dT - 0.5) - 0.5) * grb_cov(-tM);
    v = mix(mix(v, vh + u_inset_depth * grb_dome(dl, tp.w), grb_cov(dT)), vh + 0.6 * u_inset_depth, grb_cov(tM));
  }

  // ---- beams: long straps across everything, along lines that wrap round the tile (45° lines repeat every gcd of the
  // sides), or segments of up to the tile's short side (measured to the nearest copy). They follow the relief under
  // them: added on top (or, at a negative height, sunk in).
  float dBm = 1e4, bPerp = 0.0, bW = 1.0;
  if (u_beams > 0) {
    float g = grb_gcd(uRes);
    float nb = float(u_beams);
    for (int i = 0; i < u_beams; i++) {
      uint b = pcg(uint(uSeed) * 0x2C1B3C6Du + uint(i) * 0x85EBCA6Bu + 0x5BD1E995u);
      // The direction, 0 rising, 1 falling, 2 horizontal, 3 vertical: Direction gives the first and how many to pick from.
      ivec2 dr = GRB_BEAM_DIR[u_beam_dir];
      int dir = dr.x + int(grb_rand(b, 1u) * (float(dr.y) - 0.001));
      vec2 n = GRB_BEAM_N[dir];
      float sc = 1.0 / length(n);
      float per = dir < 2 ? g : dir == 2 ? uRes.y : uRes.x;
      float c = floor((float(i) + grb_rand(b, 2u)) / nb * per);
      float w = max(u_beam_width * (1.0 - u_beam_var * grb_rand(b, 3u)), 1.0);
      float u = dot(n, q) - c;
      float perp = (u - per * floor(u / per + 0.5)) * sc;
      float d = abs(perp) - 0.5 * w;
      if (u_beam_len < 1.0) {
        vec2 p0 = vec2(grb_rand(b, 4u), grb_rand(b, 5u)) * uRes;
        vec2 C = p0 - n * (dot(n, p0) - c) / dot(n, n);
        vec2 dq = q - C;
        dq -= uRes * floor(dq / uRes + 0.5);
        float h = 0.5 * u_beam_len * min(uRes.x, uRes.y) * mix(0.6, 1.0, grb_rand(b, 6u));
        perp = dot(dq, n) * sc;
        d = max(abs(perp) - 0.5 * w, abs(dot(dq, vec2(-n.y, n.x))) * sc - h);
      }
      if (d < dBm) { dBm = d; bPerp = perp; bW = w; }
    }
    // Rails: two bars a quarter of the width along the edges; grooved: a fifth-wide groove down the middle.
    float rw = max(1.0, floor(0.25 * bW + 0.5));
    float dBe = u_beam_style == 1 ? abs(dBm + 0.5 * rw) - 0.5 * rw : dBm;
    float bb = min(u_bevel, u_beam_style == 1 ? 0.5 * rw : 0.3 * bW);
    // (A plain smooth ramp, not the Edge profile: each profile call site costs D3D compile time.)
    v += u_beam_height * (bb > 0.0 ? smoothstep(0.0, 1.0, -dBe / bb) : grb_cov(dBe));
    if (u_beam_style == 2) v -= 0.6 * u_beam_height * grb_cov(abs(bPerp) - 0.5 * max(1.0, floor(0.2 * bW + 0.5))) * grb_cov(dBm);
    dBm = dBe;
  }

  if (u_output == 0) {
    // The stack is scaled so its peak fits under 1 — the top plateau with its bulge plus the highest thing that can stand
    // on it (a raised frame, with rivets, a pipe or ribs on it; a rivet or bolt; a lens dome) — so every level, dome and
    // raised centre keeps its shape instead of clipping.
    bool riv = u_rivets > 0 && u_rivet_chance > 0.0;
    float raise = u_frame_chance > 0.0 && u_frame_style != 0 && u_frame_style != 2 ? u_inset_depth * (1.0 + max(u_bulge, 0.0) / 0.75) : 0.0;
    float ribs = u_detail_chance > 0.0 || u_edge_chance > 0.0 ? (u_det_pipes || u_hero > 0.0 ? u_inset_depth : u_det_ribs ? 0.8 * u_inset_depth : 0.0) : 0.0;
    float bolt = u_small_parts > 0.0 ? u_rivet_height : 0.0;
    float onRaise = raise + max(riv && u_rivet_inset + u_rivet_radius > u_frame_inset ? u_rivet_height : 0.0, ribs);
    float lens = u_det_light && u_detail_chance > 0.0 ? u_light_dome - 0.4 * u_inset_depth : 0.0;
    // (Nested pieces — under borders, strips or drawn splits — may stand up to a raised border and a quarter of the top
    // above it.)
    float nest = u_frame_chance > 0.0 || u_edge_chance > 0.0 || u_seamless < 1.0 ? u_inset_depth + 0.1875 : 0.0;
    float peak = 0.75 + nest + max(u_bulge, 0.0) + max(max(onRaise, riv ? u_rivet_height : bolt), max(lens, ribs)) + (u_beams > 0 ? max(u_beam_height, 0.0) : 0.0);
    v = clamp(v / max(peak, 1.0), 0.0, 1.0);
    if (u_mask == 0) return genOut(v, 1.0, rnd, NO_SDF);
    float dm = u_mask == 1 ? max(max(dP, -dHole), -dSunk) : u_mask == 2 ? dP : u_mask == 3 ? -dP : u_mask == 4 ? dF
             : u_mask == 5 ? dR : u_mask == 6 ? dD : u_mask == 7 ? dL : dBm;
    return genOutOwn(v, 1.0, rnd, dm);
  }
  float d = u_output == 1 ? dP : u_output == 2 ? -dP : u_output == 3 ? dF : u_output == 4 ? dR : u_output == 5 ? dD : u_output == 6 ? dL : dBm;
  return genOut(0.0, 1.0, rnd, d);
}
`,
}
