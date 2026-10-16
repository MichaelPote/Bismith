// Panels (FR7.2d): recursive kd-style subdivision of the tile into machine panels, with seams, per-panel
// height steps, inset frames, rivets and small details (vent slots, lights, recesses, perforations). See
// greebleCommon.ts for the relief / SDF output convention.

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { GRB_GLSL } from './greebleCommon'

const hasFrame = (p: Record<string, unknown>) => Number(p.frame_chance) > 0
const hasRivets = (p: Record<string, unknown>) => p.rivets !== 'none'
const hasDetails = (p: Record<string, unknown>) => Number(p.detail_chance) > 0
const hasSlots = (p: Record<string, unknown>) => hasDetails(p) && (Boolean(p.det_vents) || Boolean(p.det_holes))
const hasLight = (p: Record<string, unknown>) => hasDetails(p) && Boolean(p.det_light)
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

export const panelsLayer: LayerDef = {
  type: 'panels',
  label: 'Machine panels',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  // The relief writes the shape mask unless Shape for the mask is None; the shape outputs always do.
  writesMask: (p) => !isRelief(p) || (p.mask ?? 'none') !== 'none',
  description:
    'Recursive rectangular subdivision into machine panels: seams, per-panel height steps, inset frames, rivets, vents, lights, recesses and perforations. Tileable.',
  params: [
    P.enum('output', 'Output', 'relief', [
      ['relief', 'Relief (all, value)'],
      ['panels', 'Panels (shape)'],
      ['seams', 'Seams (shape)'],
      ['frames', 'Inset frames (shape)'],
      ['rivets', 'Rivets (shape)'],
      ['details', 'Details (shape)'],
      ['lights', 'Lights (shape)'],
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
    ], {
      showIf: isRelief,
      hint: 'What the relief hands to the shape mask (Mask card › Use shape mask), for later layers to clip to (grime in the seams, paint on the plates only, glow in the lenses) or chip and bevel from — no second Panels layer needed',
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
    P.float('pinwheel', 'Pinwheel splits', 0.3, 0, 1, { step: 0.001, hint: 'Chance a panel splits into five as a pinwheel (four round a centre) instead of in two, so seams stop at each other instead of running edge to edge' }),
    P.float('aspect', 'Panel aspect', 1, 0.05, 20, { softMin: 0.125, softMax: 8, step: 0.01, hint: 'Height ÷ width of the min and max panel (their geometric mean stays): above 1 tall panels and columns, below 1 wide panels and rows' }),
    P.float('bias', 'Cut bias', 0, -1, 1, { step: 0.001, hint: 'Optional cuts: −1 = vertical cuts (columns), +1 = horizontal cuts (rows), 0 = cut across the longer side. Sides above Max panel are cut anyway (Panel aspect stretches the max)' }),
    P.float('split_var', 'Cut randomness', 0.7, 0, 1, { step: 0.001, hint: '0 = always cut in the middle, 1 = anywhere' }),
    P.int('snap', 'Cut grid', 1, 1, 512, { softMax: 64, unit: 'px', hint: 'Cuts snap to multiples of this (from the tile origin)' }),
    P.float('gap', 'Seam', 1, 0, 128, { softMax: 12, unit: 'px', step: 0.5, hint: 'Seam along the left and top of each panel (whole px stays crisp)' }),
    P.float('seam_taper', 'Seam taper', 0.5, 0, 1, { step: 0.001, hint: 'Main seams wide, fine ones thin: each level of cuts narrows its seams by this fraction (to 1 px). 0 = every seam is Seam wide' }),
    P.float('edge_seam', 'Tile-edge seam', 0.34, 0, 1, { step: 0.001, showIf: (p) => p.root !== 'windmill', hint: 'The seam along the tile border as a share of Seam (whole px): low values keep tiled copies from showing a grid of wide seams at the tile size. 0 = the border panels meet with only their bevels' }),
    P.float('seam_max', 'Seam limit', 0.12, 0, 0.5, { step: 0.001, hint: 'No seam wider than this share of the shorter side of its panel (at least 1 px): the small panels of busy zones get thin seams instead of a waffle grid. 0 = no limit' }),
    P.float('cut_chance', 'Cut corners', 0.35, 0, 1, { step: 0.001, hint: 'Share of the panels with cut corners: one, two opposite or all four chamfered, or one notched out — the floor shows in the cut' }),
    P.float('cut_size', 'Cut size', 0.2, 0.05, 0.5, { step: 0.001, showIf: (p) => Number(p.cut_chance) > 0, hint: 'Chamfer leg or notch side, as a share of the panel’s shorter side' }),
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

    P.float('frame_chance', 'Chance', 0.35, 0, 1, { step: 0.001, group: 'frame', hint: 'Fraction of panels with an inset frame (panels too small for the inset get none)' }),
    P.int('frame_min', 'Min panel', 16, 0, 2048, { softMax: 128, unit: 'px', group: 'frame', showIf: hasFrame, hint: MIN_HINT }),
    P.enum('frame_style', 'Style', 'mixed', [
      ['groove', 'Groove line'],
      ['ridge', 'Raised line'],
      ['recess', 'Recessed centre'],
      ['raise', 'Raised centre'],
      ['hatch', 'Hatch', 'a groove line with two hinge knuckles on one long side and a latch slot opposite'],
      ['mixed', 'Mixed', 'each panel one of the five'],
    ], { group: 'frame', showIf: hasFrame }),
    P.float('frame_inset', 'Inset', 3.5, 0, 512, { softMax: 32, unit: 'px', step: 0.5, group: 'frame', showIf: hasFrame }),
    P.float('frame_width', 'Line width', 1, 0.5, 128, { softMax: 8, unit: 'px', step: 0.5, group: 'frame', showIf: (p) => hasFrame(p) && ['groove', 'ridge', 'hatch', 'mixed'].includes(String(p.frame_style)) }),

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
  ],
  groups: [
    { id: 'frame', label: 'Inset frame', collapsed: true },
    { id: 'rivets', label: 'Rivets', collapsed: true },
    { id: 'details', label: 'Details', collapsed: true },
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
    }
  },
  glsl:
    GRB_GLSL +
    /* glsl */ `
// gap: the widths of the seams along the cell's left and top edges (Seam taper narrows them with the level of the cut).
struct GrbCell { vec2 lo; vec2 hi; uint id; vec2 gap; };

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

// Bounded iterative descent of the kd-tree: every node's decisions hash only its path id, so each pixel
// walks the same tree. The root is the whole tile (its border is a seam; offset moves it) or one piece of the pinwheel.
// The loop count is a uniform, so D3D keeps one copy of the body.
GrbCell grb_panelAt(vec2 q) {
  vec2 lo = vec2(0.0), hi = uRes;
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
  // Levels of the cuts that made the left and top edges (0 = the tile edge), and whether they are still the tile edge.
  vec2 lv = vec2(0.0);
  bvec2 edge = bvec2(u_root != 2);
  vec4 rl = vec4(-1e9);   // the root pinwheel's seam lines: x1, x2, y1, y2
  float sg = float(max(u_snap, 1));
  // Clustering: how busy this region is, inherited down the tree and re-drawn (partly) near the top.
  float busy = 0.5;
  int nd = min(u_depth, 24);
  for (int d = 0; d < nd; d++) {
    vec2 sz = hi - lo;
    bool canX = sz.x >= 2.0 * mn.x - 1e-3;
    bool canY = sz.y >= 2.0 * mn.y - 1e-3;
    if (!canX && !canY) break;
    bool mustX = canX && sz.x > mx.x + 1e-3;
    bool mustY = canY && sz.y > mx.y + 1e-3;
    busy = mix(busy, grb_rand(id, 13u), d < 4 ? 0.6 : 0.15);
    // (Capped below 1 unless Split chance is: busy zones still stop some panels early, not all at Min panel.)
    float ps = clamp(u_split + (busy - 0.5) * 3.0 * u_cluster, 0.0, max(u_split, 0.85));
    if (!mustX && !mustY && grb_rand(id, 1u) >= ps) break;
    // A pinwheel: two cuts each way, four panels round a centre one (needs room for three panels each way).
    bool pin = (grb_rand(id, 16u) < u_pinwheel || (d == 0 && u_root == 1)) && sz.x >= 3.0 * mn.x - 1e-3 && sz.y >= 3.0 * mn.y - 1e-3;
    // The Pinwheel layout's root keeps its centre panel within the middle 30–70 % each way, so none of its seams spans
    // more than 70 % of the tile.
    bool rootPin = pin && d == 0 && u_root == 1;
    float t = 0.5 + (grb_rand(id, 3u) - 0.5) * u_split_var;
    float t2 = 0.5 + (grb_rand(id, 4u) - 0.5) * u_split_var;
    vec2 a0 = rootPin ? lo + 0.3 * sz - mn : lo;
    vec2 a1 = rootPin ? lo + 0.45 * sz + mn : hi - (pin ? mn : vec2(0.0));
    vec2 c1 = grb_cutPos(a0, a1, vec2(t, pin ? t2 : t), mn);
    if (rl.x > -1e8) c1 = grb_offLines(c1, rl, a0 + mn, a1 - mn, sg);
    float cx = c1.x, cy = c1.y;
    vec2 c2 = vec2(-1.0);
    if (pin) {
      vec2 b0 = rootPin ? lo + 0.55 * sz - mn : c1;
      vec2 b1 = rootPin ? lo + 0.7 * sz + mn : hi;
      c2 = grb_cutPos(b0, b1, 0.5 + (vec2(grb_rand(id, 5u), grb_rand(id, 6u)) - 0.5) * u_split_var, mn);
      if (rl.x > -1e8) c2 = grb_offLines(c2, rl, b0 + mn, b1 - mn, sg);
      // No room for the pinwheel: cut in two instead.
      pin = cx >= 0.0 && cy >= 0.0 && all(greaterThanEqual(c2 - c1, mn - 1e-3));
      if (pin && rootPin) rl = vec4(cx, c2.x, cy, c2.y);
    }
    vec2 nlo = lo, nhi = hi;
    uint ck;
    if (pin) {
      float x2 = c2.x, y2 = c2.y;
      // Children 0..3 wind round the centre (4); the mirror image swaps the sense of the winding.
      bool mir = grb_rand(id, 17u) < 0.5;
      float xa = mir ? x2 : cx;   // where the bottom and top arms change over
      int ch = q.y < cy ? (q.x < (mir ? cx : x2) ? (mir ? 1 : 0) : (mir ? 0 : 1))
             : q.y < y2 ? (q.x < cx ? (mir ? 1 : 3) : q.x < x2 ? 4 : (mir ? 3 : 1))
             : (q.x < xa ? (mir ? 2 : 3) : (mir ? 3 : 2));
      vec4 r = ch == 4 ? vec4(cx, cy, x2, y2)
             : !mir ? (ch == 0 ? vec4(lo.x, lo.y, x2, cy) : ch == 1 ? vec4(x2, lo.y, hi.x, y2) : ch == 2 ? vec4(cx, y2, hi.x, hi.y) : vec4(lo.x, cy, cx, hi.y))
                    : (ch == 0 ? vec4(cx, lo.y, hi.x, cy) : ch == 1 ? vec4(lo.x, lo.y, cx, y2) : ch == 2 ? vec4(lo.x, y2, x2, hi.y) : vec4(x2, cy, hi.x, hi.y));
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
        cutY = grb_rand(id, 2u) < clamp(pref + u_bias, 0.0, 1.0);
      }
      float c = cutY ? cy : cx;
      // (Below a root pinwheel, a cut dropped for lying on its seams goes the other way if it can.)
      if (c < 0.0 && rl.x > -1e8 && (cutY ? canX && cx >= 0.0 : canY && cy >= 0.0)) { cutY = !cutY; c = cutY ? cy : cx; }
      if (c < 0.0) break;
      bool upper = (cutY ? q.y : q.x) >= c;
      if (cutY) { if (upper) nlo.y = c; else nhi.y = c; }
      else { if (upper) nlo.x = c; else nhi.x = c; }
      ck = upper ? 0x68E31DA4u : 0xB5297A4Du;
    }
    // The seam of a cut lies in the cell right of it (x) or below it (y: GL y up).
    if (nlo.x != lo.x) { lv.x = float(d); edge.x = false; }
    if (nhi.y != hi.y) { lv.y = float(d); edge.y = false; }
    lo = nlo;
    hi = nhi;
    id = pcg(id ^ ck);
  }
  vec2 gap = vec2(grb_seamW(lv.x), grb_seamW(lv.y));
  if (u_edge_seam < 1.0) {
    float eg = floor(u_gap * u_edge_seam + 0.5);
    gap = vec2(edge.x ? eg : gap.x, edge.y ? eg : gap.y);
  }
  if (u_seam_max > 0.0) gap = min(gap, vec2(max(floor(u_seam_max * min(hi.x - lo.x, hi.y - lo.y) + 0.5), min(u_gap, 1.0))));
  return GrbCell(lo, hi, id, gap);
}

// A panel's cut corners at point p (centre c, half-size hb): chamfered (45°, legs cs) or notched (a cs × cs bite) — the
// distance of the cut-away part, positive outside it (so the panel is max(box, this)); -1e4 where p's corner is uncut.
// ty: 0 one corner, 1 two opposite, 2 all four chamfered, 3 one notched; c0: the first corner (bit 0 right, bit 1 top).
// .y: the same for the cut grown by ins (a frame's inner shape: a rectangle round a notch, not a rounded offset).
vec2 grb_corner(vec2 p, vec2 c, vec2 hb, int ty, int c0, float cs, float r, float ins) {
  vec2 pc = p - c;
  int qi = (pc.x >= 0.0 ? 1 : 0) + (pc.y >= 0.0 ? 2 : 0);
  if (ty < 0 || !(ty == 2 || qi == c0 || (ty == 1 && qi == 3 - c0))) return vec2(-1e4);
  vec2 a = abs(pc);
  // The notch: a box round the corner, its inner corner rounded by r (the plate gets a fillet there).
  vec2 w = abs(a - hb) - vec2(cs - r);
  vec2 wi = w - ins;
  vec2 dn = vec2(length(max(w, 0.0)) + min(max(w.x, w.y), 0.0), length(max(wi, 0.0)) + min(max(wi.x, wi.y), 0.0)) - r;
  float dc = (a.x + a.y - (hb.x + hb.y - cs)) * 0.70710678;
  return ty == 3 ? -dn : vec2(dc, dc + ins);
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

  // Panel = cell minus the seam along its left and top (GL: high y) edges, so whole-px seams are crisp.
  vec2 plo = vec2(cell.lo.x + cell.gap.x, cell.lo.y);
  vec2 phi = vec2(cell.hi.x, cell.hi.y - cell.gap.y);
  vec2 psz = max(phi - plo, vec2(0.0));
  float side = min(psz.x, psz.y);
  float area = sqrt(psz.x * psz.y);   // what the Min panel gates compare
  float dP = grb_rbox(q, plo, phi, u_round);
  // In the seam, the neighbouring panels reach the cell's left / top edge.
  if (dP > 0.0) dP = min(dP, max(min(q.x - cell.lo.x, cell.hi.y - q.y), 0.0));
  // Cut corners: chamfered or notched, a backing plate showing in the cut.
  vec2 pcen = 0.5 * (plo + phi), phb = 0.5 * psz;
  // A cut needs legs of at least 6 px and longer than the Corner rounding (else it reads as a chip, or vanishes).
  float cs = floor(u_cut_size * side + 0.5);
  int cty = grb_rand(id, 34u) < u_cut_chance && cs >= max(6.0, u_round + 2.0) ? int(floor(grb_rand(id, 35u) * 3.999)) : -1;
  int cc0 = int(floor(grb_rand(id, 36u) * 3.999));
  vec2 dCs = grb_corner(q, pcen, phb, cty, cc0, cs, min(u_round, 0.5 * cs), u_frame_inset);
  float dC = dCs.x;
  float dP0 = dP;
  dP = max(dP, dC);

  int levels = max(u_levels, 1);
  float lvl = levels > 1 ? floor(grb_rand(id, 8u) * float(levels)) / float(levels - 1) : 0.0;
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
  float P = 0.75 * mix(1.0, lowest, lvl) * (1.0 + u_bulge / 0.75 * pw.x * pw.y);
  // A panel's bevel is at most a fifth of its shorter side, so the small panels of busy zones keep flat tops.
  float bev = min(u_bevel, max(0.2 * side, 0.5));
  float v = P * grb_rise(dP, bev);
  // In a cut corner a lower backing plate shows (half the plateau), not the black seam floor.
  if (cty >= 0) v = max(v, 0.5 * P * grb_cov(max(dP0, -dC + 1.0)));
  float dSunk = 1e4;   // everything sunk into the plate (the Plate tops shape leaves it out)

  // ---- inset frame
  float dF = 1e4;
  vec4 kn = vec4(1e4, 1e4, -1e4, -1e4);   // a hatch's hinge barrels: centre offset (folded) and half-size, from the panel centre
  float keep = 0.0;   // the details stay this far inside the panel: clear of its frame line and rivets
  if (grb_rand(id, 9u) < u_frame_chance && area >= float(u_frame_min)) {
    vec2 ilo = plo + u_frame_inset, ihi = phi - u_frame_inset;
    int fs = u_frame_style == 5 ? int(floor(grb_rand(id, 14u) * 4.999)) : u_frame_style;
    // An inner rectangle too narrow for the frame to read (a line pair closer than 4 px) gets none.
    float fmin = fs <= 1 || fs == 4 ? 2.0 * u_frame_width + 4.0 : 6.0;
    if (all(greaterThan(ihi - ilo, vec2(fmin)))) {
      float dI = max(grb_rbox(q, ilo, ihi, max(u_round - u_frame_inset, 0.0)), dCs.y);
      keep = ceil(u_frame_inset + (fs <= 1 || fs == 4 ? u_frame_width : bev)) + 1.0;
      if (fs <= 1 || fs == 4) {
        // A line just inside the inner rectangle: starts on its edge, whole px wide. A hatch: a groove line with two
        // hinge knuckles across it on one long side and a latch slot opposite.
        dF = abs(dI + 0.5 * u_frame_width) - 0.5 * u_frame_width;
        v += (fs == 1 ? 1.0 : -1.0) * u_inset_depth * grb_cov(dF);
        float dGroove = dF;
        if (fs == 4) {
          bool hx = psz.x >= psz.y;   // hinges on a long side
          vec2 il = hx ? q - pcen : (q - pcen).yx;
          vec2 ih = 0.5 * (hx ? ihi - ilo : (ihi - ilo).yx);
          float side2 = grb_rand(id, 37u) < 0.5 ? -1.0 : 1.0;
          // Two hinge barrels along the line (folded: one evaluation), each three knuckles split by 1 px gaps.
          float kw = max(u_frame_width + 1.0, 2.0), kl = max(3.0 * (2.0 * kw + 1.0), 0.18 * ih.x);
          kn = vec4(0.5 * ih.x, side2 * (ih.y + 0.5 * u_frame_width), 0.5 * kl, kw);
          vec2 kp = vec2(abs(il.x) - kn.x, il.y - kn.y);
          float dK = max(grb_rbox(kp, vec2(-kn.z, -kw), vec2(kn.z, kw), kw), 0.5 - abs(fract((kp.x + kn.z) / (2.0 * kn.z / 3.0) + 0.5) - 0.5) * (2.0 * kn.z / 3.0));
          kn.xy = hx ? kn.xy : kn.yx;
          kn.zw = hx ? kn.zw : kn.wz;
          // The latch: a short slot on the opposite side, just inside the line; the door stands a hair proud.
          vec2 lp = vec2(il.x, il.y + side2 * (ih.y - kw - 1.0));
          float dLt = sdBox(lp, vec2(1.5 * kw, 0.5 * kw));
          v += u_inset_depth * (0.15 * grb_cov(dI) + grb_dome(max(dK + kw, 0.0), kw) * grb_cov(dK) - grb_cov(dLt));
          dF = min(dF, min(dK, dLt));
          dGroove = min(max(dGroove, -dK), dLt);
        }
        if (fs != 1) dSunk = dGroove;
      } else {
        dF = dI;
        // Raised and recessed centres carry the bulge too.
        vec2 iu = clamp((q - pcen) / max(0.5 * (ihi - ilo), vec2(1e-3)), -1.0, 1.0);
        vec2 ig = 1.0 - min((1.0 - abs(iu)) / bw, 1.0);
        float ib = 1.0 + u_bulge / 0.75 * (1.0 - ig.x * ig.x) * (1.0 - ig.y * ig.y);
        v += (fs == 2 ? -1.0 : 1.0) * u_inset_depth * ib * grb_rise(dI, bev);
      }
      if (fs == 2) dSunk = dF;
    }
  }

  // ---- rivets: two rows (or columns) at least a rivet's width apart; an axis too short for that gets one line down
  // its middle (a strap), a panel short both ways none.
  float dR = 1e4;
  float rr = u_rivet_radius;
  if (u_rivets > 0 && grb_rand(id, 10u) < u_rivet_chance && area >= float(u_rivet_min)) {
    float D = 2.0 * rr;
    float m = grb_rivetM(u_rivet_inset, D);
    vec2 a = plo + m, b = phi - m;   // rectangle of rivet centres
    bvec2 thin = lessThan(b - a, vec2(2.0 * D));
    int rm = u_rivets == 4 ? 1 + int(floor(grb_rand(id, 15u) * 2.999)) : u_rivets;   // 1 corners, 2 edges, 3 long sides
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
      // (None in a cut corner — its quadrant's corner cut, and the rivet within the cut plus a rivet's width.)
      if (cty >= 0) {
        vec2 rp = rc - pcen;
        int rq = (rp.x >= 0.0 ? 1 : 0) + (rp.y >= 0.0 ? 2 : 0);
        vec2 dc = phb - abs(rp);
        bool inCut = cty == 3 ? all(lessThan(dc, vec2(cs + rr + 1.0))) : dc.x + dc.y < cs + 1.5 * (rr + 1.0);
        if ((cty == 2 || rq == cc0 || (cty == 1 && rq == 3 - cc0)) && inCut) dR = 1e4;
      }
      // (Nor on a hinge.)
      vec2 kd = abs(abs(rc - pcen) - abs(kn.xy)) - kn.zw;
      if (max(kd.x, kd.y) < rr + 1.0) dR = 1e4;
      v += u_rivet_height * grb_dome(dR + rr, rr);
    }
  }

  // ---- details: one per chosen panel, or two side by side (Paired details), each a vent grille, light, recess,
  // perforation, ribs or a pipe / handle in an area of Size (± Size variation) centred, against an edge or in a corner of
  // the free part of the panel (inside its frame line, rivets and cut corners, and a bevel and 2 px of plate in
  // from its edge). Big panels may get a hero part instead (Hero parts), small ones a small part (Small parts).
  float dD = 1e4, dL = 1e4;
  float dHole = 1e4;   // through-holes (slots, perforation): left out of every plate shape
  int nk = (u_det_vents ? 1 : 0) + (u_det_light ? 1 : 0) + (u_det_recess ? 1 : 0) + (u_det_holes ? 1 : 0) + (u_det_ribs ? 1 : 0) + (u_det_pipes ? 1 : 0);
  bool big = area >= float(u_det_min);
  bool hasDet = nk > 0 && grb_rand(id, 11u) < u_detail_chance;
  bool smallP = !big && u_detail_chance > 0.0 && grb_rand(id, 32u) < u_small_parts;
  bool hero = big && hasDet && area >= 2.5 * float(u_det_min) && grb_rand(id, 38u) < u_hero
           && (u_det_vents || u_det_holes || u_det_light || u_det_pipes);
  if ((hasDet && big) || smallP) {
    if (cty >= 0) keep = max(keep, (cty == 3 ? cs : ceil(0.5 * cs)) + 2.0);
    float m0 = min(ceil(bev) + 2.0, floor(0.25 * side));
    vec2 flo = plo + max(keep, m0), fhi = phi - max(keep, m0);
    vec2 fsz = max(fhi - flo, vec2(0.0));
    float sz = hero ? 0.9 : u_det_size * (1.0 - u_det_var * grb_rand(id, 24u));
    vec2 asz = min(psz - 2.0 * floor(psz * (1.0 - sz) * 0.5 + 0.5), fsz);
    // Placement: 0 centred, 1 against a random edge, 2 in a random corner.
    int an = hero ? 0 : u_det_anchor == 3 ? int(floor(grb_rand(id, 25u) * 2.999)) : u_det_anchor;
    vec2 slack = fsz - asz;
    vec2 sd = step(0.5, vec2(grb_rand(id, 26u), grb_rand(id, 27u)));   // which side, per axis
    bool ax = grb_rand(id, 28u) < 0.5;                                  // an edge across x (else y)
    vec2 pos = an == 0 ? vec2(0.5) : an == 2 ? sd : (ax ? vec2(sd.x, 0.5) : vec2(0.5, sd.y));
    vec2 rlo = flo + floor(slack * pos), rhi = rlo + asz;
    // Paired: split along the longer side, a gap between, the pixel's part decides.
    uint pid = id;
    bool lx = asz.x >= asz.y;
    float L = lx ? asz.x : asz.y;
    if (!smallP && !hero && grb_rand(id, 29u) < u_det_pair && L >= 12.0) {
      float g = max(2.0, floor(0.06 * L + 0.5));
      float cut = floor(L * mix(0.3, 0.5, grb_rand(id, 31u)) + 0.5);
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
      bool bayRoll = !smallP && (hero || grb_rand(pid, 18u) < u_det_bay);
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
      bool f6 = u_det_pipes && 2.0 * (tr + fw) <= sl0.y && sl0.x >= max(2.0 * tr + 16.0, 8.0 * tr);
      int nh = (f0 ? 1 : 0) + (f3 ? 1 : 0) + (f1 ? 1 : 0) + (f6 ? 1 : 0);
      bool hr = hero && nh > 0;
      int nf = smallP ? (f0 ? 2 : 1) : hr ? nh : (f0 ? 1 : 0) + (f1 ? 1 : 0) + (f2 ? 1 : 0) + (f3 ? 1 : 0) + (f4 ? 1 : 0) + (f6 ? 1 : 0);
      int kind = -1, cnt = 0;
      int pick = int(floor(grb_rand(pid, smallP ? 33u : hr ? 39u : 12u) * float(nf)));
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
        v -= min(u_inset_depth, 0.5 * v) * grb_rise(dD, wall);
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
        bool pipe = hero || (grb_rand(pid, 40u) < 0.6 && sl.x >= 16.0 * tr);
        float fl = max(2.0, floor(0.5 * tr + 0.5));              // flange thickness, along the run
        float R = max(2.0 * tr, floor(0.12 * sl.y + 0.5));
        // Room across for the bundle and its elbow and leg: else fewer runs, or a handle.
        float room = sl.y - (fw + 3.0 * tr + R + fl);
        if (room < 0.0) pipe = false;
        if (!pipe) tr = max(tr, 1.5);
        float sp = 2.0 * tr + max(1.0, floor(0.6 * tr + 0.5));   // run spacing
        float nr = pipe ? 1.0 + floor(grb_rand(pid, 42u) * float(max(u_pipe_runs, 1)) * 0.999) : 1.0;
        nr = clamp(nr, 1.0, max(floor(room / sp) + 1.0, 1.0));
        float band = (nr - 1.0) * sp;
        float sy = grb_rand(pid, 41u) < 0.5 ? 1.0 : -1.0;   // the elbow turns towards +y or -y
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
        float kr = clamp(floor(off / sp + 0.5), 0.0, nr - 1.0);
        float dl = abs(off - kr * sp);
        float dT = fits && inRun ? dl - tr : 1e4;
        vec2 f1c = vec2(x0 - 0.5 * fl, y0 - sy * 0.5 * band), f1h = vec2(0.5 * fl, 0.5 * band + tr + fw);
        vec2 f2c = pipe ? vec2(xe + R + 0.5 * band, y1 + sy * 0.5 * fl) : vec2(xe + 0.5 * fl, y0);
        vec2 f2h = pipe ? vec2(0.5 * band + tr + fw, 0.5 * fl) : f1h;
        float dM = fits ? min(sdBox(ql - f1c, f1h), sdBox(ql - f2c, f2h)) : 1e4;
        dD = min(dT, dM);
        float vh = v;
        float tube = vh + u_inset_depth * grb_dome(dl, tr);
        float flange = vh + 0.6 * u_inset_depth;
        // A 1 px contact line where the tube meets the plate, so its edge reads.
        v -= 0.3 * u_inset_depth * grb_cov(abs(dT - 0.5) - 0.5) * grb_cov(-dM);
        v = mix(mix(v, tube, grb_cov(dT)), flange, grb_cov(dM));
      } else if (kind == 1) {
        int st = hero ? 3 : u_light_style == 4 ? int(floor(grb_rand(pid, 19u) * 3.999)) : u_light_style;
        float rel = (st == 1 ? 0.5 : 1.0) * u_light_rel;   // a row's lamps half the size, so a row has several
        float s = max(u_light_size, floor(rel * sl.y + 0.5));
        float rim = u_light_rim;
        bool low = grb_rand(pid, 20u) < 0.5;   // which long edge a row or strip runs along
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

  if (u_output == 0) {
    // The stack is scaled so its peak fits under 1 — the top plateau with its bulge plus the highest thing that can stand
    // on it (a raised frame, with rivets, a pipe or ribs on it; a rivet or bolt; a lens dome) — so every level, dome and
    // raised centre keeps its shape instead of clipping.
    bool riv = u_rivets > 0 && u_rivet_chance > 0.0;
    float raise = u_frame_chance > 0.0 && u_frame_style != 0 && u_frame_style != 2 ? u_inset_depth * (1.0 + max(u_bulge, 0.0) / 0.75) : 0.0;
    float ribs = u_detail_chance > 0.0 ? (u_det_pipes || u_hero > 0.0 ? u_inset_depth : u_det_ribs ? 0.8 * u_inset_depth : 0.0) : 0.0;
    float bolt = u_small_parts > 0.0 ? u_rivet_height : 0.0;
    float onRaise = raise + max(riv && u_rivet_inset + u_rivet_radius > u_frame_inset ? u_rivet_height : 0.0, ribs);
    float lens = u_det_light && u_detail_chance > 0.0 ? u_light_dome - 0.4 * u_inset_depth : 0.0;
    float peak = 0.75 + max(u_bulge, 0.0) + max(max(onRaise, riv ? u_rivet_height : bolt), max(lens, ribs));
    v = clamp(v / max(peak, 1.0), 0.0, 1.0);
    if (u_mask == 0) return genOut(v, 1.0, rnd, NO_SDF);
    float dm = u_mask == 1 ? max(max(dP, -dHole), -dSunk) : u_mask == 2 ? dP : u_mask == 3 ? -dP : u_mask == 4 ? dF
             : u_mask == 5 ? dR : u_mask == 6 ? dD : dL;
    return genOutOwn(v, 1.0, rnd, dm);
  }
  float d = u_output == 1 ? dP : u_output == 2 ? -dP : u_output == 3 ? dF : u_output == 4 ? dR : u_output == 5 ? dD : dL;
  return genOut(0.0, 1.0, rnd, d);
}
`,
}
