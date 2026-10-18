// Tiles: one layer, many lattices — squares and checkerboards, diamonds, rhombille (tumbling blocks), herringbone,
// basketweave, interlocking crosses / stretched hexes, plus (Greek cross) tiles, octagon + square, triangles,
// hopscotch (Pythagorean), pinwheel and Cairo pentagons. Every tile is an exact polygon (signed distance, px),
// inset by half the gap with mitred corners and rounded at its convex corners, so the common bevel / profile /
// combine params work. rnd is per tile, or per tile kind (cube face, H/V brick, octagon/square…). The Tones output
// paints each tile kind its own tone instead (a two-tone checkerboard on squares), blurred by Softness.

import { P } from '@/core/params'
import type { LayerDef } from '../types'
import { geoGlsl, orientParam, rndModeParam } from './geometricCommon'

export const TILE_MODES: [string, string][] = [
  ['squares', 'Squares / checkerboard'],
  ['diamonds', 'Diamonds (argyle)'],
  ['rhombille', 'Rhombille (tumbling blocks)'],
  ['herringbone', 'Herringbone'],
  ['basketweave', 'Basketweave'],
  ['cross', 'Interlocking crosses / hexes'],
  ['plus', 'Plus (Greek cross)'],
  ['octagon', 'Octagon + square'],
  ['triangles', 'Triangles'],
  ['hopscotch', 'Hopscotch (offset squares)'],
  ['pinwheel', 'Pinwheel'],
  ['cairo', 'Cairo pentagons'],
]

const modeIs = (...m: string[]) => (p: Record<string, unknown>) => m.includes(String(p.mode))
const isValue = (p: Record<string, unknown>) => p.output === 'value'
const splitShown = (p: Record<string, unknown>) => p.mode === 'squares' && Number(p.split ?? 0) > 0

/** Tiles drawn: every tile, or one kind (option index = kind + 1 in the shader). */
const TILE_KINDS: [string, string][] = [
  ['all', 'Every tile'],
  ['1', 'Kind 1 only'],
  ['2', 'Kind 2 only'],
  ['3', 'Kind 3 only'],
  ['4', 'Kind 4 only'],
  ['5', 'Kind 5 only'],
]
/** Linked default of Kind contrast per tiling (see linkedDefaults). */
const KIND_CONTRAST: Record<string, number> = {
  squares: 0, diamonds: 0.8, rhombille: 1, herringbone: 0.35, basketweave: 0.35, cross: 0.4,
  plus: 0.4, octagon: 0.8, triangles: 0.3, hopscotch: 0.6, pinwheel: 0.5, cairo: 0.4,
}
const KIND_HINT =
  'Tile kinds: squares and diamonds alternate 1, 2 (checker), split squares\' small tiles 3, 4; blocks: 1 top, 2 left, 3 right faces; herringbone, basketweave: 1 horizontal, 2 vertical bricks; crosses: two interleaved sets; plus: five; octagon: 1 octagons, 2 squares; triangles: 1 up, 2 down; hopscotch: 1 big, 2 small squares; pinwheel: 1 horizontal, 2 vertical rectangles, 3 centre squares; Cairo: four orientations'

// ---------------------------------------------------------------- tile shapes as data
// Each tiling's tile shapes (unit coords, y up, CCW), every vertex linear in the tiling's own params t:
// v = a + t.x · b + t.y · c (t: octagon corner cut; herringbone / basketweave / hopscotch ratio n; crosses plateau
// and signed shoulder; pinwheel centre square; Cairo's e). The shader builds a shape in one loop over this table —
// no branch per tiling, which D3D would compile once for each.

type Lin = [number, number, number]
type Vtx = [Lin, Lin]
const c = (v: number): Lin => [v, 0, 0]
const lx = (a: number, b: number): Lin => [a, b, 0]
const ly = (a: number, cc: number): Lin => [a, 0, cc]
const v = (x: Lin | number, y: Lin | number): Vtx => [typeof x === 'number' ? c(x) : x, typeof y === 'number' ? c(y) : y]
const rect = (lo: Vtx, hi: Vtx): Vtx[] => [lo, [hi[0], lo[1]], hi, [lo[0], hi[1]]]
const poly = (...pts: [number, number][]): Vtx[] => pts.map(([x, y]) => v(x, y))

interface Shape { verts: Vtx[]; rect?: boolean }
const R = (lo: Vtx, hi: Vtx): Shape => ({ verts: rect(lo, hi), rect: true })
const n = lx(0, 1)
const n1 = lx(1, 1) // n + 1
const cut = lx(0, 1), cut1 = lx(1, -1) // c, 1 − c
const pA = lx(0.5, 0.5), pB = lx(0.5, -0.5) // pinwheel: (1 ± inner) / 2
const e = lx(0, 1), e1 = lx(1, -1) // Cairo: e, 1 − e
const S6 = 1 / 6, S3 = 1 / 3

/** Shapes per tiling, in TILE_MODES order. Squares: whole, then a quarter (split cells). Rhombille: three faces, then
 * the whole block (faces joined). */
const SHAPES: Shape[][] = [
  [R(v(0, 0), v(1, 1)), R(v(0, 0), v(0.5, 0.5))],
  [{ verts: poly([0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]) }],
  [
    { verts: poly([0, 0], [0.5, S6], [0, S3], [-0.5, S6]) },
    { verts: poly([0, 0], [-0.5, S6], [-0.5, -S6], [0, -S3]) },
    { verts: poly([0, 0], [0, -S3], [0.5, -S6], [0.5, S6]) },
    { verts: poly([0.5, S6], [0, S3], [-0.5, S6], [-0.5, -S6], [0, -S3], [0.5, -S6]) },
  ],
  [R(v(0, 0), v(n, 1)), R(v(n, lx(1, -1)), v(n1, 1))],
  [R(v(0, 0), v(n, 1)), R(v(0, 0), v(1, n))],
  [
    {
      // Hex topology on a centred 4×2 lattice: side vertex V1 (2 − 2p, 0), shoulders S1 / S2 (1 ± s, .5), top corner
      // V2 (2p, 1), mirrored round (t = plateau p, signed shoulder s).
      verts: [
        v(lx(2, -2), 0), v(ly(1, 1), 0.5), v(ly(1, -1), 0.5), v(lx(0, 2), 1),
        v(lx(0, -2), 1), v(ly(-1, 1), 0.5), v(ly(-1, -1), 0.5), v(lx(-2, 2), 0),
        v(ly(-1, -1), -0.5), v(ly(-1, 1), -0.5), v(lx(0, -2), -1),
        v(lx(0, 2), -1), v(ly(1, -1), -0.5), v(ly(1, 1), -0.5),
      ],
    },
  ],
  [{ verts: poly([0.5, -1.5], [0.5, -0.5], [1.5, -0.5], [1.5, 0.5], [0.5, 0.5], [0.5, 1.5], [-0.5, 1.5], [-0.5, 0.5], [-1.5, 0.5], [-1.5, -0.5], [-0.5, -0.5], [-0.5, -1.5]) }],
  [
    { verts: [v(cut, 0), v(cut1, 0), v(1, cut), v(1, cut1), v(cut1, 1), v(cut, 1), v(0, cut1), v(0, cut)] },
    { verts: [v(0, lx(0, -1)), v(cut, 0), v(0, cut), v(lx(0, -1), 0)] },
  ],
  [{ verts: poly([0, 0], [1, 0], [0.5, 0.5]) }, { verts: poly([0, 0], [0.5, 0.5], [-0.5, 0.5]) }],
  [R(v(0, 0), v(n, n)), R(v(n, 0), v(n1, 1))],
  [R(v(0, 0), v(pA, pB)), R(v(pA, 0), v(1, pA)), R(v(pB, pA), v(1, 1)), R(v(0, pB), v(pB, 1)), R(v(pB, pB), v(pA, pA))],
  [
    { verts: [v(0, 0), v(0.5, e), v(0.5, e1), v(0, 1), v(lx(0, -1), 0.5)] },
    { verts: [v(0, 0), v(e, 0.5), v(0, 1), v(-0.5, e1), v(-0.5, e)] },
    { verts: [v(0, 0), v(e, -0.5), v(e1, -0.5), v(1, 0), v(0.5, e)] },
    { verts: [v(0, 0), v(0.5, lx(0, -1)), v(1, 0), v(e1, 0.5), v(e, 0.5)] },
  ],
]

/**
 * The table as GLSL: every coefficient is a multiple of 1/6 within ±2, so a vertex's six (a, b, c × x, y) pack into one
 * int, 5 bits each (sixths + 12). A table of vec2s, one per coefficient pair, cost ~20 % of the render: D3D copies a
 * dynamically indexed constant array into every pixel's registers, so the smaller the better.
 */
function shapeTable(): string {
  const V: string[] = [], head: string[] = [], first: number[] = []
  for (const shapes of SHAPES) {
    first.push(head.length)
    for (const s of shapes) {
      head.push(`ivec3(${V.length}, ${s.verts.length}, ${s.rect ? 1 : 0})`)
      for (const [x, y] of s.verts) {
        let w = 0
        ;[x[0], y[0], x[1], y[1], x[2], y[2]].forEach((v, i) => {
          const q = Math.round(v * 6)
          if (Math.abs(q - v * 6) > 1e-9 || Math.abs(q) > 12) throw new Error(`tile vertex coefficient ${v} is not a sixth within ±2`)
          w += (q + 12) * 2 ** (5 * i)
        })
        V.push(String(w))
      }
    }
  }
  const arr = (type: string, name: string, items: string[]) => `const ${type} ${name}[${items.length}] = ${type}[${items.length}](\n  ${items.join(', ')});`
  return [
    `// Vertex coefficients, packed: 5 bits each of a.x, a.y, b.x, b.y, c.x, c.y, in sixths + 12.`,
    arr('int', 'TILE_V', V),
    `// Per shape: first vertex, vertex count, axis-aligned rectangle (1).`,
    arr('ivec3', 'TILE_SHAPE', head),
    `const int TILE_MODE0[${first.length}] = int[${first.length}](${first.join(', ')});   // each tiling's first shape`,
  ].join('\n')
}

export const tilesLayer: LayerDef = {
  type: 'tiles',
  label: 'Tiles',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description:
    'Square tiles and checkerboards, tumbling blocks, herringbone, basketweave, interlocking crosses, octagons, triangles, pinwheel, Cairo… Exact tile distances with gap and rounding, per-tile or per-face random — or each kind of tile its own tone (a soft two-tone checker).',
  params: [
    P.enum('mode', 'Tiling', 'rhombille', TILE_MODES),
    P.enum('output', 'Output', 'tiles', [['tiles', 'Tiles (shape)'], ['value', 'Tones (value)']], {
      hint: 'Tiles: every tile a bevelled shape, its Random value per tile or kind (Diffuse › Source Random). Tones: no shape — each kind of tile its own tone, 0 to 1 for a colour ramp (a two-tone checkerboard on Squares; light, mid and dark block faces), blurred by Softness; the joints take the Joint tone',
    }),
    P.float('scale', 'Scale', 7, 0.25, 256, {
      softMax: 32,
      step: 0.01,
      hint: 'Pattern repeats across the width (whole counts when tiling). One repeat = 1 square / diamond pair / cube column / 2×2 herringbone or basket block / cross pair / 5 plus tiles / octagon / triangle pair / pinwheel / 2×2 Cairo cells. A checkerboard (Squares whose kinds show: Tones, a kind filter or a kind-weighted random) keeps even counts when tiling',
    }),
    P.float('aspect', 'Aspect', 1, 0.1, 10, { softMin: 0.25, softMax: 4, step: 0.01, hint: 'Stretch the repeat vertically (rows are rounded to whole counts when tiling)' }),
    orientParam('Multiples of 45°; diagonal frames repeat over gcd(width, height) so they stay seamless'),
    P.float('gap', 'Gap', 2, 0, 256, { softMax: 16, unit: 'px', step: 0.1, hint: 'Grout between tiles (whole even/odd px stay crisp: odd gaps shift the lattice half a pixel)' }),
    P.float('round', 'Corner rounding', 0, 0, 256, { softMax: 48, unit: 'px', step: 0.1, hint: 'Radius of the convex corners — as far as the tile allows; the gap is kept' }),
    P.int('ratio', 'Length ratio', 2, 2, 12, { showIf: modeIs('herringbone', 'basketweave', 'hopscotch'), hint: 'Herringbone: brick length in widths. Basketweave: bricks per block. Hopscotch: big square side in small squares' }),
    P.float('stagger', 'Row offset', 0, 0, 1, { step: 0.001, showIf: modeIs('squares'), hint: 'Shift alternate rows (fraction of a square); rows are made even when tiling' }),
    P.float('split', 'Split squares', 0, 0, 1, {
      step: 0.001,
      showIf: modeIs('squares'),
      hint: 'Chance that a square (where Split where allows) is split into 2 × 2 small squares: mixed big and small tiles, small checkerboards inside big ones. Split squares make kinds 3 and 4 (small light, small dark), so small tiles can take their own colours',
    }),
    P.enum('split_rule', 'Split where', 'any', [['any', 'Any square'], ['columns', 'Column bands'], ['rows', 'Row bands'], ['crossings', 'Where bands cross']], {
      showIf: splitShown,
      hint: 'Which squares may split: any, or bands of columns / rows (Band every, Band width, shifted by Band shift), or only where a column band crosses a row band (blocks of small tiles at the crossings). Bands repeat seamlessly: counts become multiples of Band every when tiling',
    }),
    P.enum('split_kinds', 'Kinds', 'both', [['both', 'Checker and size'], ['size', 'Size only']], {
      showIf: splitShown,
      hint: 'Tile kinds of split squares: checker and size (1, 2 big light / dark; 3, 4 small light / dark), or size only (1 big, 2 small) — when the checker doesn\'t matter, two kinds leave each its own wide band of the colour ramp (Random value: tile kind + random)',
    }),
    P.int('split_every', 'Band every', 4, 2, 32, { softMax: 12, showIf: (p) => splitShown(p) && p.split_rule !== 'any', hint: 'A band starts every this many squares' }),
    P.int('split_run', 'Band width', 2, 1, 31, { softMax: 8, showIf: (p) => splitShown(p) && p.split_rule !== 'any', hint: 'Squares across a band (less than Band every)' }),
    P.int('split_x', 'Band shift X', 0, 0, 31, { softMax: 8, showIf: (p) => splitShown(p) && p.split_rule !== 'any' && p.split_rule !== 'rows', hint: 'Moves the column bands right by this many squares' }),
    P.int('split_y', 'Band shift Y', 0, 0, 31, { softMax: 8, showIf: (p) => splitShown(p) && p.split_rule !== 'any' && p.split_rule !== 'columns', hint: 'Moves the row bands down by this many squares' }),
    P.float('plateau', 'Plateau', 0.25, 0, 1, { step: 0.001, showIf: modeIs('cross'), hint: 'Top edge width: 0 = diamonds, 0.25 = stretched hexes, 0.5 = squares in half-offset columns, > 0.5 = bow ties' }),
    P.float('step', 'Step', 0.6, 0, 1, { step: 0.001, showIf: modeIs('cross'), hint: 'Shoulder in the slanted sides — 0 = straight (hexes), 1 = right-angled arms (plus crosses)' }),
    P.float('cut', 'Corner cut', 0.293, 0, 0.5, { step: 0.001, showIf: modeIs('octagon'), hint: 'Fraction of the cell cut off each corner (0.293 = regular octagons)' }),
    P.float('inner', 'Centre square', 0.33, 0.02, 0.98, { step: 0.001, showIf: modeIs('pinwheel'), hint: 'Size of the centre square (fraction of the repeat)' }),
    P.float('cairo', 'Pentagon shape', 0.274, 0, 0.45, { step: 0.001, showIf: modeIs('cairo'), hint: '0 = squares on the diagonal, 0.274 = equilateral-sided Cairo' }),
    P.float('block_j', 'Joints inside blocks', 0, 0, 1, {
      step: 0.001,
      showIf: modeIs('rhombille'),
      hint: 'The joints between a block’s three faces, as a share of the Gap: 1 = like the outline (three loose rhombi), 0 = no joint — one solid block, its faces meeting at an edge (Crease depth). Below 1 a block’s faces share one height, lean, crown and tone',
    }),
    P.float('crease', 'Crease depth', 0.25, 0, 1, {
      step: 0.001,
      showIf: (p) => p.mode === 'rhombille' && !isValue(p) && Number(p.block_j ?? 1) <= 0,
      hint: 'Solid blocks: how far the edges between a block’s faces dip, as a share of its height, over the Bevel width — 0 = a sharp arris, 1 = down to the joint',
    }),
    P.float('block_iso', 'Block relief', 0.5, 0, 1, {
      step: 0.001,
      showIf: (p) => p.mode === 'rhombille' && !isValue(p),
      hint: 'Height: the top face stays level and the two side faces slope down to the block’s bottom corner by this share of its height — each block raised like a box seen from above',
    }),
    P.bool('fit', 'Keep tile shape', true, {
      hint: 'Tiling needs whole repeats across and down. On: the count across may move off Scale a little so that the rows fit — tiles keep their shape (regular blocks and triangles) and Aspect holds at any scale. Off: exactly Scale across, the rows rounded (tiles may stretch or squash)',
    }),
    P.float('soft', 'Softness', 1.5, 0, 256, {
      softMax: 32,
      unit: 'px',
      step: 0.1,
      showIf: isValue,
      hint: 'Blurs the tones over this many px — on rectangles a smooth 2D blur, so corners where four squares meet stay crossed, not mitred (0 = crisp edges, anti-aliased by Edge › Anti-alias)',
    }),
    P.float('vary', 'Tone variation', 0.3, 0, 1, {
      step: 0.001,
      showIf: isValue,
      hint: 'Each tile shifts its tone by its own random amount, towards the middle of the ramp (at 1 up to 0.45 of the step between kinds, so kinds never cross): worn, unevenly fired or dyed tiles',
    }),
    P.float('joint_tone', 'Joint tone', 1, 0, 1, { step: 0.001, showIf: isValue, hint: 'The tone of the joints and of tiles not drawn (0 = the first kind’s end of the ramp, 1 = the last kind’s)' }),
    P.float('laid', 'Hand-laid shift', 0, 0, 64, {
      softMax: 8,
      unit: 'px',
      step: 0.1,
      section: 'Per tile',
      showIf: (p) => !isValue(p),
      hint: 'Hand-laid: each tile sits off its place by a random amount up to this. Within the joint the tiles keep their size; a tile that needs more room than its joint gives comes out a little smaller, so tiles never overlap',
    }),
    P.float('laid_turn', 'Hand-laid turn', 0, 0, 64, {
      softMax: 8,
      unit: 'px',
      step: 0.1,
      section: 'Per tile',
      showIf: (p) => !isValue(p),
      hint: 'Hand-laid: each tile turns a random way about its middle, its corners moving up to this many px — long tiles turn by less, small ones by more. Follows Hand-laid shift until set by hand',
    }),
    P.float('size_var', 'Size variation', 0, 0, 64, {
      softMax: 8,
      unit: 'px',
      step: 0.1,
      section: 'Per tile',
      showIf: (p) => !isValue(p),
      hint: 'Each tile comes out smaller by a random amount up to this (handmade tiles, worn setts): joints of uneven width',
    }),
    P.float('tilt', 'Tilt', 0.5, 0, 1, {
      step: 0.001,
      section: 'Per tile',
      showIf: (p) => !isValue(p),
      hint: 'Height: each tile leans a random way, its low side down by up to three quarters of its own height at 1 (lippage) — never into the joint, so every edge keeps its bevel. With Per-feature variation, tiles at their own heights and angles',
    }),
    P.float('crown', 'Crown', 0.3, 0, 1, {
      step: 0.001,
      section: 'Per tile',
      showIf: (p) => !isValue(p),
      hint: 'Height: each tile domes towards its middle, its corners down by up to three quarters of its height at 1 (pillowed tiles; the bevel still marks the edge)',
    }),
    P.float('crown_shape', 'Crown shape', 0.3, 0, 1, {
      step: 0.001,
      section: 'Per tile',
      showIf: (p) => !isValue(p) && Number(p.crown) > 0,
      hint: '0 = a round dome over the whole tile; 1 = a flat top with a firm shoulder near the edge (cushioned setts)',
    }),
    P.float('missing', 'Missing tiles', 0, 0, 1, { step: 0.001, section: 'Per tile', hint: 'Share of tiles left out at random (the seed picks which): gaps in a floor, scattered inlays. Their place is outside the shape (its mask: Limit to, Outside); in Tones, the Joint tone' }),
    P.enum('only', 'Tiles drawn', 'all', TILE_KINDS, { section: 'Per tile', hint: KIND_HINT }),
    P.bool('only_inv', 'All but that kind', false, { section: 'Per tile', showIf: (p) => (p.only ?? 'all') !== 'all', hint: 'Draw every tile except that kind (pinwheel rectangles without their centre squares, two faces of each block…)' }),
    { ...rndModeParam(['Per tile', 'Per tile kind', 'Tile kind + random'], `${KIND_HINT}. Use with Diffuse source = random`), section: 'Per tile' },
    P.float('kind_w', 'Kind contrast', 1, 0, 1, {
      step: 0.001,
      section: 'Per tile',
      showIf: (p) => (p.rnd_mode ?? 'class_random') === 'class_random',
      hint: 'How far the tile kind sets the random value: 1 = each kind its own band of the ramp (block faces, octagons and squares apart); lower, the kinds\' bands widen and overlap towards the middle of the ramp; 0 = kinds ignored, every tile its own tone across most of the ramp. Follows the tiling until set by hand: 1 for blocks, 0.8 octagons and argyle, 0.3–0.6 for most, 0 for plain squares',
    }),
    P.seed(),
  ],
  // Tones has no shape: only Anti-alias of the Edge controls (its crisp edges use it).
  sdfShowIf: (p, key) => !isValue(p) || key === 'aa',
  // Kinds that make the motif (block faces, argyle, octagons and squares, big and small squares, pinwheel centres) keep
  // their own tones; elsewhere a kind is only a sub-lattice (checker squares, H / V bricks, interleaved crosses).
  // The turn follows the shift (no shift, no turn) until set by hand; Diffuse paints tiles by their random, tones by
  // the value.
  linkedDefaults: (p) => ({
    kind_w: KIND_CONTRAST[String(p.mode)] ?? 1,
    laid_turn: Number(p.laid ?? 0),
    dif_src: isValue(p) ? 'value' : 'random',
  }),
  fresh: ({ width, height }) => {
    // Joints and bevels that read at the texture's size: 2 px grout and a 3 px bevel at 512 px; hand-laid by about a
    // pixel there (shift and turn), so each seed lays the tiles differently.
    const px = Math.min(width, height) / 512
    const r1 = (v: number) => Math.round(v * 10) / 10
    return { gap: Math.max(1, Math.round(2 * px)), bevel: Math.max(1, Math.round(3 * px * 2) / 2), laid: r1(Math.max(0.3, 0.75 * px)) }
  },
  defaults: {
    rnd_mode: 'class_random',
    h_on: true,
    h_amount: 0.4,
    bevel: 3,
    h_var: 0.3,
    profile: 'smooth',
    dif_on: true,
    // Light → dark, so by kind the blocks' top faces are the lightest and their right faces (away from the default
    // light, top left) the darkest. A stop at each end of the three kind bands of Tile kind + random ((kind + .15 …
    // .85) / 3): the faces of one kind differ tile by tile, the kinds never blur into each other.
    dif_grad: {
      stops: [
        { pos: 0.05, color: '#c0b39a' },
        { pos: 0.283, color: '#958a77' },
        { pos: 0.383, color: '#7c7366' },
        { pos: 0.617, color: '#5f574d' },
        { pos: 0.717, color: '#4a443c' },
        { pos: 0.95, color: '#2e2a25' },
      ],
    },
  },
  glsl:
    geoGlsl(16) +
    shapeTable() +
    /* glsl */ `

// ---------------------------------------------------------------- modes (unit coords, y up, CCW polygons)
// Every mode is a few tile shapes (the table above), each tried at a list of anchors: tile_shape(k) builds shape k
// and says how many anchors it has; tile_anchor(k, a) gives anchor a. gen() runs them all through one flat loop with
// a single geo_finish and one tile try (geo_sdPoly). D3D (Chrome's default on Windows) inlines every call: a mode
// function apiece, each with its own nested loops of tries, took ~20 s to compile; a branch per mode building its
// shapes, ~0.9 s of 2.4.
//
//   squares      offset squares; rows alternate by the stagger
//   diamonds     diamonds on the lattice and on its corners (argyle)
//   rhombille    pointy-top hexes (two per unit cell, at (.5,.25) and (0,.75); regular when a unit is √3 tall),
//                each split into three rhombi: top (0), left (1), right (2) — a cube lit from above
//   herringbone  n×1 bricks: lattice (1,1), (n,-n); horizontal brick at the lattice point, vertical brick at
//                (n, 1-n). Period 2n × 2n
//   basketweave  n×n blocks of n parallel bricks, alternating horizontal / vertical. Period 2 blocks
//   cross        hexagonal-topology tiles on a centred 4×2 lattice. Side vertices (2-2p, 0), top corners (2p, 1);
//                each slanted side gets a horizontal shoulder through its midpoint (1, .5), point-symmetric so
//                neighbours match
//   plus         plus pentominoes: centres on the lattice (2,1), (-1,2) (+ half a unit so edges sit on unit
//                lines). Period 5
//   octagon      octagons with small squares (diamonds) at their corners
//   triangles    two rows per unit (regular when a unit is √3 tall); odd rows shift half a triangle
//   hopscotch    (Pythagorean) a×a and 1×1 squares on the lattice (a,1), (-1,a). Period a²+1
//   pinwheel     four A×B rectangles around a centre square (A-B), A+B = 1
//   cairo        each unit cell holds a short segment through its centre (horizontal on even cells, vertical on
//                odd), joined to the cell corners; every grid edge then owns one pentagon (a triangle from one
//                cell + a trapezoid from the next). Period 2×2

int tile_mode, tile_n;
vec2 tile_uu;
vec2 tile_t;       // the mode's shape params (see the table)
int tile_koff;     // the shape the pixel's own position picks (basketweave block, triangle, Cairo pentagon, whole block)
bool tile_isRect;  // the current shape is an axis-aligned rectangle (Tones' crossed blur)
// The tile under the pixel where a mode finds it directly (rhombille's nearest hex, triangles, Cairo): its anchor
// (units), cell, kind, and the key's lattice (cell, period) and extra kind offset.
vec2 tile_pos;
ivec2 tile_cell, tile_add;
int tile_cls;
bool tile_hex;      // rhombille, solid blocks: one hexagon per block, its faces found after the search
bool tile_nb;       // Tones: rhombille, triangles and Cairo try their neighbourhood too (the blur needs the tile across)
bool tile_valid;    // the anchor is a tile of the shape tried (Cairo's neighbourhood: its kind follows the parity; split squares)
bool tile_split;    // squares: some cells split into 2 × 2

// Squares: whether a cell splits — on the rule's bands (columns / rows / crossings, by the wrapped cell), by chance.
bool tile_splits(ivec2 cell) {
  ivec2 w = geo_wrapCell(cell);
  int P = max(u_split_every, 2);
  bool col = imod(w.x - u_split_x, P) < u_split_run, row = imod(-1 - w.y - u_split_y, P) < u_split_run;
  bool cand = u_split_rule == 0 || (u_split_rule == 1 && col) || (u_split_rule == 2 && row) || (u_split_rule == 3 && col && row);
  return cand && hashI(w, uSeed + 421.0) < u_split;
}
float tile_inner;   // rhombille: how far the faces' inner edges (those at the block's centre) push out into the gap, px
vec2 tile_bu;   // the winning tile's own position in its box (−1…1 across), for tilt and crown
ivec2 tile_bid; // and its id (its block's, when a block's faces meet)
vec2 tile_q;    // and the pixel in its own frame (px from its anchor)
vec2 tile_cs;   // and its turn (cos, sin), its shape (k) and growth (geo_r less its shrink): Bevel aspect's outline
int tile_k;
float tile_rr;

void tile_pick() {
  int m = tile_mode;
  vec2 uu = tile_uu;
  tile_koff = 0;
  if (m == 2) {
    // Nearest hex centre in the metric x² + 3y² (regular hexes): each of the two sub-lattices (.5, .25) + Z² and
    // (0, .75) + Z² is rectangular and the metric axis-aligned, so its nearest centre rounds each axis.
    ivec2 cA = ivec2(floor(uu.x), floor(uu.y + 0.25));
    ivec2 cB = ivec2(floor(uu.x + 0.5), floor(uu.y - 0.25));
    vec2 dA = uu - vec2(cA) - vec2(0.5, 0.25), dB = uu - vec2(cB) - vec2(0.0, 0.75);
    bool b = dB.x * dB.x + 3.0 * dB.y * dB.y < dA.x * dA.x + 3.0 * dA.y * dA.y;
    tile_cell = b ? cB : cA;
    tile_pos = vec2(tile_cell) + (b ? vec2(0.0, 0.75) : vec2(0.5, 0.25));
    tile_add = ivec2(b ? 1 : 0, 0);
    tile_koff = tile_hex ? 3 : 0;
  } else if (m == 4) {
    ivec2 b = ivec2(floor(uu / float(tile_n)));
    tile_koff = ((b.x + b.y) & 1) == 0 ? 0 : 1;
  } else if (tile_nb) {
  } else if (m == 8) {
    float ry = uu.y * 2.0;
    int r = int(floor(ry));
    float t = ry - float(r);
    float o = (r & 1) == 1 ? 0.5 : 0.0;
    float x = uu.x - o;
    int i = int(floor(x - 0.5 * t)), j = int(floor(x + 0.5 * t));
    tile_cls = j == i ? 0 : 1;
    int k = j == i ? i : j;
    tile_pos = vec2(float(k) + o, 0.5 * float(r));
    tile_cell = ivec2(k, r);
    tile_koff = tile_cls;
  } else if (m == 11) {
    float e = tile_t.x;
    ivec2 c = ivec2(floor(uu));
    vec2 l = uu - vec2(c);
    int typ;
    ivec2 X;
    if (((c.x + c.y) & 1) == 0) {
      float w = e * (1.0 - abs(2.0 * l.y - 1.0));
      if (l.x < w) { typ = 0; X = c; }
      else if (l.x > 1.0 - w) { typ = 0; X = c + ivec2(1, 0); }
      else { typ = 1; X = l.y < 0.5 ? c : c + ivec2(0, 1); }
    } else {
      float w = e * (1.0 - abs(2.0 * l.x - 1.0));
      if (l.y < w) { typ = 1; X = c; }
      else if (l.y > 1.0 - w) { typ = 1; X = c + ivec2(0, 1); }
      else { typ = 0; X = l.x < 0.5 ? c : c + ivec2(1, 0); }
    }
    tile_cls = typ == 0 ? (((X.x - 1 + X.y) & 1) == 0 ? 0 : 1) : (((X.x + X.y - 1) & 1) == 0 ? 2 : 3);
    tile_pos = vec2(X);
    tile_cell = X;
    tile_add = ivec2(typ, 0);
    tile_koff = tile_cls;
  }
}

// Shape k of the mode as the working polygon (not yet inset), from the table; returns its anchor count.
int tile_shape(int k) {
  int m = tile_mode;
  ivec3 sh = TILE_SHAPE[TILE_MODE0[m] + k + tile_koff];
  geo_n = sh.y;
  tile_isRect = sh.z == 1;
  for (int i = 0; i < geo_n; i++) {
    int w = TILE_V[sh.x + i];
    vec2 va = vec2(float(w & 31), float((w >> 5) & 31)) - 12.0, vb = vec2(float((w >> 10) & 31), float((w >> 15) & 31)) - 12.0;
    vec2 vc = vec2(float((w >> 20) & 31), float((w >> 25) & 31)) - 12.0;
    geo_V[i] = (va * (1.0 / 6.0) + tile_t.x * (vb * (1.0 / 6.0)) + tile_t.y * (vc * (1.0 / 6.0))) * geo_s;
  }
  if (m == 2 && tile_inner > 0.0 && !tile_hex) {
    // Narrower joints inside the block: push the two edges at the centre (v3 → v0 → v1) out by tile_inner before the
    // inset — v0 by a mitre, v1 and v3 along the outer edges they share.
    vec2 v0 = geo_V[0], v1 = geo_V[1], v2 = geo_V[2], v3 = geo_V[3];
    vec2 ea = normalize(v0 - v3), eb = normalize(v1 - v0);
    vec2 na = vec2(ea.y, -ea.x), nb = vec2(eb.y, -eb.x);   // outward (CCW)
    vec2 u1 = normalize(v2 - v1), u3 = normalize(v2 - v3);
    geo_V[0] = v0 + tile_inner * (na + nb) / max(1.0 + dot(na, nb), 0.05);
    geo_V[1] = v1 + u1 * tile_inner / dot(nb, u1);
    geo_V[3] = v3 + u3 * tile_inner / dot(na, u3);
  }
  // Anchors: a 3×3 neighbourhood for most; one tile found directly (rhombille, triangles, Cairo); diamonds 9 + 4
  // corners; the octagons' squares 4; a herringbone row of bricks; a basketweave block's n bricks; crosses 3×3 × 2.
  return m == 0 && k == 1 ? 36 : m == 1 ? 13 : m == 3 ? 3 * (tile_n / 2 + 4) : m == 4 ? tile_n : m == 5 ? 18 : (m == 7 && k == 1) ? 4
       : (m == 2 || m == 8 || m == 11) ? (!tile_nb ? 1 : m == 2 ? 18 : 9) : 9;
}

// Anchor a of shape k: position (units), tile kind, and its key's parts — key = geo_wrapCell(cell) * mul + add.
void tile_anchor(int k, int a, out vec2 pos, out int cls, out ivec2 cell, out ivec2 mul, out ivec2 add) {
  int m = tile_mode;
  vec2 uu = tile_uu;
  int n = tile_n;
  float fn = float(n);
  ivec2 d3 = ivec2(a % 3 - 1, a / 3 - 1);   // 3×3 neighbourhood, rows outer
  cls = k;
  cell = ivec2(0);
  mul = ivec2(1);
  add = ivec2(0);
  tile_valid = true;
  // Integer-lattice modes: key = geo_keyI(L, P) * kmul + kadd.
  ivec2 L = ivec2(0), P = ivec2(0), kmul = ivec2(1), kadd = ivec2(0);
  if (m == 0 || m == 10) {
    // A cell of the 3×3 neighbourhood; squares shift odd rows by the stagger (kind: from the key, in gen()); pinwheel
    // has five rectangles to a cell. Split squares: shape 0 is a whole cell that doesn't split, shape 1 a quarter of
    // one that does (four to a cell).
    bool quarter = m == 0 && k == 1;
    int c3 = quarter ? a / 4 : a;
    int j = int(floor(uu.y)) + c3 / 3 - 1;
    float o = m == 0 && (j & 1) == 1 ? u_stagger : 0.0;
    int i = int(floor(uu.x - o)) + c3 % 3 - 1;
    pos = vec2(float(i) + o, float(j));
    cell = ivec2(i, j);
    if (m == 0 && tile_split) {
      tile_valid = tile_splits(cell) == quarter;
      if (quarter) {
        ivec2 sub = ivec2(a % 2, (a / 2) % 2);
        pos += 0.5 * vec2(sub);
        mul = ivec2(2);
        add = sub;
      }
    }
    if (m == 10) {
      cls = k == 4 ? 2 : (k & 1);
      mul = ivec2(5, 1);
      add = ivec2(k, 0);
    }
  } else if (m == 1 || m == 7) {
    // Diamonds: 9 on the lattice (+ half a unit), then 4 on its corners; octagons: 9, then the 4 small squares.
    bool corner = m == 1 ? a >= 9 : k == 1;
    int b = m == 1 ? a - 9 : a;
    ivec2 cc = ivec2(floor(uu)) + (corner ? ivec2(b % 2, b / 2) : d3);
    pos = vec2(cc) + (m == 1 && !corner ? 0.5 : 0.0);
    cls = corner ? 1 : 0;
    cell = cc;
    mul = ivec2(2, 1);
    add = ivec2(cls, 0);
  } else if (m == 2 || m == 8 || m == 11) {
    // The tile found directly (tile_pick), or with tile_nb its neighbourhood: rhombille's hexes in the 3×3 cells (two
    // each), the triangles of shape k in three rows by three, Cairo's pentagons of kind k anchored round the cell.
    pos = tile_pos;
    cell = tile_cell;
    ivec2 ad = tile_add;
    int c = tile_cls;
    if (tile_nb) {
      ivec2 c0 = ivec2(floor(uu));
      if (m == 2) {
        int h = a % 2;
        cell = c0 + ivec2((a / 2) % 3 - 1, a / 6 - 1);
        pos = vec2(cell) + (h == 0 ? vec2(0.5, 0.25) : vec2(0.0, 0.75));
        ad = ivec2(h, 0);
      } else if (m == 8) {
        int r = int(floor(uu.y * 2.0)) + d3.y;
        float o = (r & 1) == 1 ? 0.5 : 0.0;
        cell = ivec2(int(floor(uu.x - o)) + d3.x, r);
        pos = vec2(float(cell.x) + o, 0.5 * float(r));
        c = k;
      } else {
        cell = c0 + d3;
        pos = vec2(cell);
        int typ = k / 2;
        ad = ivec2(typ, 0);
        c = typ == 0 ? (((cell.x - 1 + cell.y) & 1) == 0 ? 0 : 1) : (((cell.x + cell.y - 1) & 1) == 0 ? 2 : 3);
        tile_valid = c == k;
      }
    }
    if (m == 2) { mul = ivec2(2, 1); add = ad; }
    else {
      cls = c;
      L = cell;
      P = m == 8 ? ivec2(1, 2) : ivec2(2);
      if (m == 11) { kmul = ivec2(2, 1); kadd = ad; }
    }
  } else if (m == 3) {
    int a0 = int(floor(0.5 * (uu.x + uu.y)));
    int b0 = int(floor((uu.x - uu.y) / (2.0 * fn)));
    int aa = a0 + 1 - a / 3, b = b0 + a % 3 - 1;
    L = ivec2(aa + n * b, aa - n * b);
    P = ivec2(2 * n);
    pos = vec2(L);
  } else if (m == 4) {
    ivec2 b = ivec2(floor(uu / fn));
    bool hor = tile_koff == 0;
    pos = vec2(b) * fn + (hor ? vec2(0.0, float(a)) : vec2(float(a), 0.0));
    cls = tile_koff;
    L = b;
    P = ivec2(2);
    kmul = ivec2(8, 1);
    kadd = ivec2(a, 0);
  } else if (m == 5) {
    int sub = a % 2;
    ivec2 c = ivec2(floor(uu / vec2(4.0, 2.0))) + ivec2((a / 2) % 3 - 1, a / 6 - 1);
    pos = vec2(c) * vec2(4.0, 2.0) + (sub == 1 ? vec2(2.0, 1.0) : vec2(0.0));
    cls = sub;
    cell = c;
    mul = ivec2(2, 1);
    add = ivec2(sub, 0);
  } else {   // plus (6), hopscotch (9)
    // The lattice (a, 1), (-1, a), period a² + 1: hopscotch with a = n; plus tiles are the one with a = 2, centred on
    // half units, their kind the place in the period.
    int ai = m == 6 ? 2 : n;
    float fa = float(ai), o = m == 6 ? 0.5 : 0.0;
    vec2 q = uu - o;
    ivec2 b = ivec2(floor(vec2(fa * q.x + q.y, fa * q.y - q.x) / (fa * fa + 1.0))) + d3;
    L = ivec2(b.x * ai - b.y, b.x + b.y * ai);
    P = ivec2(ai * ai + 1);
    pos = vec2(L) + o;
    if (m == 6) cls = imod(L.x, 5);
  }
  if (P.x > 0) {
    ivec2 o = imod(L, P);
    cell = (L - o) / P;
    mul = P * kmul;
    add = o * kmul + kadd;
  }
}

GenOut gen(vec2 p) {
  int mode = u_mode;
  int n = clamp(u_ratio, 1, 12);
  bool val = u_output == 1;
  int only = u_only - 1;   // -1: every kind
  // Period in pattern units, its natural height/width ratio, tile kinds, smallest tile feature (units), the shape
  // params (see the table).
  vec2 U = vec2(1.0);
  float nat = 1.0;
  int ncls = 1;
  float feat = 0.5;
  int multX = 1, multY = 1;
  vec2 t = vec2(float(n), 0.0);
  bool split = mode == 0 && u_split > 0.0;
  if (mode == 0) {
    // A checkerboard (the kinds show) only repeats with even counts, split bands with whole periods.
    bool chk = val || only >= 0 || u_rnd_mode == 1 || (u_rnd_mode == 2 && u_kind_w > 0.0);
    ncls = split && u_split_kinds == 0 ? 4 : 2;
    feat = split ? 0.5 : 1.0;
    multX = chk ? 2 : 1;
    multY = chk || u_stagger > 0.0 ? 2 : 1;
    int P = max(u_split_every, 2);
    if (split && (u_split_rule == 1 || u_split_rule == 3)) multX = multX == 1 || (P & 1) == 0 ? P : 2 * P;
    if (split && (u_split_rule == 2 || u_split_rule == 3)) multY = multY == 1 || (P & 1) == 0 ? P : 2 * P;
  }
  else if (mode == 1) { ncls = 2; feat = 0.7; }
  else if (mode == 2) { nat = 1.7320508; ncls = 3; feat = 0.25; }
  else if (mode == 3 || mode == 4) { U = vec2(2.0 * float(n)); ncls = 2; feat = 1.0; }
  else if (mode == 5) {
    U = vec2(4.0, 2.0); ncls = 2; feat = 0.5;
    float pl = clamp(u_plateau, 0.01, 0.99);
    t = vec2(pl, (pl <= 0.5 ? 1.0 : -1.0) * max(clamp(u_step, 0.0, 1.0) * abs(1.0 - 2.0 * pl), 0.002));
  }
  else if (mode == 6) { U = vec2(5.0); ncls = 5; feat = 1.0; }
  else if (mode == 7) { ncls = 2; feat = 0.4; t.x = clamp(u_cut, 0.005, 0.495); }
  else if (mode == 8) { nat = 1.7320508; ncls = 2; feat = 0.25; }
  else if (mode == 9) { U = vec2(float(n * n + 1)); ncls = 2; feat = 1.0; }
  else if (mode == 10) { ncls = 3; feat = 0.3; t.x = clamp(u_inner, 0.02, 0.98); }
  else { U = vec2(2.0); ncls = 4; feat = 0.4; t.x = 0.5 - clamp(u_cairo, 0.0, 0.45); }

  // Odd gaps: shift the lattice half a pixel so both gap edges land on pixel boundaries.
  float sh = fract(0.5 * u_gap);
  geo_frame(p - sh, u_orient);
  // Rows per column for the tile shape asked for (natural shape × Aspect).
  float rpc = geo_span.y / (geo_span.x * (U.y / U.x) * nat * u_aspect);
  float kx0 = u_scale * geo_span.x / uRes.x;
  float kx = geo_count(kx0, multX);
  float ky = geo_count(kx * rpc, multY);
  if (uTile && u_fit) {
    // Keep tile shape: try column counts around Scale (and the one that gives a single row band when the rows would
    // round away) and keep the best fit of shape, then of count — log errors, the shape weighing ~3× the count.
    float fx = float(multX), fy = float(multY);
    float lo = max(1.0, floor(kx0 * 0.6 / fx)) * fx;
    float hi = min(max(ceil(kx0 * 1.6), floor(fy / rpc + 0.5)), lo + 47.0 * fx);
    float best = 1e9;
    for (int i = 0; i < 48 * GEO_1; i++) {
      float x = lo + float(i) * fx;
      if (x > hi) break;
      float y = max(1.0, floor(x * rpc / fy + 0.5)) * fy;
      float e = abs(log(y / (x * rpc))) + 0.35 * abs(log(x / max(kx0, 1.0)));
      if (e < best - 1e-4) { best = e; kx = x; ky = y; }
    }
  }
  geo_periods(vec2(kx, ky));
  geo_s = geo_cs / U;

  // Inset = half the gap + the rounding, capped by the smallest tile feature; the rounding gives way first, so heavy
  // rounding never closes the gap.
  float maxIn = 0.45 * feat * min(geo_s.x, geo_s.y);
  float halfGap = min(0.5 * u_gap, maxIn);
  geo_in = min(halfGap + u_round, maxIn);
  geo_r = geo_in - halfGap;
  tile_inner = mode == 2 ? (1.0 - clamp(u_block_j, 0.0, 1.0)) * halfGap : 0.0;
  // Faces that meet without a joint: the block is one hexagon (no seam in its coverage or bevel) — unless one kind of
  // face is drawn alone, which needs the faces as shapes of their own, or the faces take their own tones.
  tile_hex = mode == 2 && u_block_j <= 0.0 && u_only == 0 && !val;
  tile_nb = val;
  tile_split = split;
  geo_reset();

  tile_mode = mode;
  tile_n = n;
  tile_t = t;
  tile_uu = geo_f / geo_s;
  tile_pick();
  tile_bu = vec2(0.0);
  tile_q = vec2(0.0);
  tile_bid = ivec2(0);
  bool blk = mode == 2 && u_block_j < 1.0;
  vec2 hexExt = vec2(0.5, 1.0 / 3.0) * geo_s;   // a block's half extent (rhombille)
  // Hand-laid and Size variation open joints between the tiles: not in Tones, a clean field of tones.
  float laid = val ? 0.0 : u_laid, turnPx = val ? 0.0 : max(u_laid_turn, 0.0), sizeVar = val ? 0.0 : u_size_var;
  // Tones: every tile within half the blur weighs in with its tone (a 1 px ramp at Softness 0 for anti-aliasing).
  // Rectangles blur as a product of 1D ramps where the rounding is smaller than the blur (no mitred corners; over a
  // grid the weights sum to 1), other tiles by their distance.
  float sb = max(u_soft, 1.0);
  float reach = val ? 0.5 * sb : -1e9;
  float kr = u_soft > 0.0 ? clamp(2.0 * geo_r / u_soft, 0.0, 1.0) : 1.0;
  int ntone = mode == 0 ? 2 : ncls;   // Tones: squares by their checker parity, big or small
  float dv = 0.45 * u_vary / float(max(ntone - 1, 1));
  float wSum = 0.0, vSum = 0.0;
  // Every shape, then its anchors, in one flat loop (see the modes above). No continue: ANGLE's D3D11 path has
  // miscompiled it — the per-anchor work sits in an if.
  int shapes = mode == 2 ? (tile_hex ? 1 : 3) : mode == 10 ? 5 : (mode == 3 || mode == 7 || mode == 9 || split) ? 2
             : tile_nb && mode == 8 ? 2 : tile_nb && mode == 11 ? 4 : 1;
  // Bevel aspect: the winning tile's outline is measured after the search (geo_edges2), so its shape is built once more
  // by the same call when another shape came after it — one pass past the last shape.
  bool asp = !val && bevelAspectOn();
  bool rebuilt = false;
  tile_k = 0;
  tile_cs = vec2(1.0, 0.0);
  tile_rr = 0.0;
  int k = -1, a = 0, na = 0;
  for (int it = 0; it < 72 * GEO_1; it++) {
    if (a >= na) {
      k++;
      if (k >= shapes) {
        if (!asp || tile_k == shapes - 1) break;
        k = tile_k;
        rebuilt = true;
      }
      na = tile_shape(k);
      geo_finish();
      a = 0;
      if (rebuilt) break;
    } else {
      vec2 pos;
      int cls;
      ivec2 cell, mul, add;
      tile_anchor(k, a, pos, cls, cell, mul, add);
      ivec2 key = geo_wrapCell(cell) * mul + add;
      // Checker parity; split squares' small ones 3, 4 — or with Kinds › Size only, big 1 and small 2.
      if (mode == 0) cls = split && u_split_kinds == 1 ? k : ((key.x + key.y) & 1) + 2 * k;
      a++;
      // Per tile: the kind filter and missing tiles; Size variation shrinks the tile by s (its distance + s);
      // Hand-laid shifts it and turns it about its box centre, and shrinks it by whatever that moves its corners
      // past the room its joint gives (half the gap + s). So it never leaves its own footprint and the modes that
      // test one tile stay exact. Blocks whose faces meet (Joints inside blocks < 1) go missing, move, tilt and dome
      // as one: the block's id, turned about its centre.
      ivec2 id = ivec2(key.x * 16 + (blk ? 0 : cls), key.y);
      bool skip = !geo_ok || !tile_valid || (only >= 0 && ((cls == only) == u_only_inv)) || hashI(id, uSeed + 211.0) < u_missing;
      if (!skip) {
        vec3 hj = hash3I(id, uSeed + 101.0);
        vec3 hl = hash3I(id, uSeed + 307.0);
        vec2 ctr = blk ? vec2(0.0) : geo_bbC, ext = blk ? hexExt : geo_bbH;
        float R = length(ext);
        vec2 tr = laid * sqrt(hl.x) * normalize(2.0 * hj.yz - 1.0 + vec2(1e-4, 0.0));
        float ang = min(turnPx / max(R, 1e-3), 0.785) * (2.0 * hl.y - 1.0);   // corners move ≤ the turn's px
        vec2 cs = normalize(vec2(1.0, tan(ang)));
        float s = sizeVar * hj.x;
        s += max(length(tr) + R * abs(ang) - (halfGap + s), 0.0);
        vec2 q = geo_f - pos * geo_s - ctr - tr;
        q = vec2(cs.x * q.x + cs.y * q.y, cs.x * q.y - cs.y * q.x) + ctr;
        vec2 bq = abs(q - geo_bbC) - geo_bbH;
        if (length(max(bq, 0.0)) - geo_r + s < max(geo_bestD, reach)) {
          float d = geo_sdPoly(q) - geo_r + s;
          if (d < geo_bestD) {
            geo_bestD = d; geo_bestCls = cls; geo_bestKey = key;
            tile_bu = (q - ctr) / max(ext, vec2(1e-3));
            tile_q = q;
            tile_bid = id;
            tile_cs = cs;
            tile_k = k;
            tile_rr = geo_r - s;
          }
          if (val) {
            // Its tone: the kinds evenly from 0 to 1, each tile moved towards the middle by its own random (a
            // middle kind either way), never as far as the next kind.
            float h = hashI(blk ? id : ivec2(key.x * 16 + cls, key.y), uSeed);
            float tn = float(mode == 0 ? cls & 1 : cls) / float(max(ntone - 1, 1));
            tn += (tn < 0.499 ? h : tn > 0.501 ? -h : 2.0 * h - 1.0) * dv;
            vec3 rw = clamp(0.5 - vec3(bq - geo_r + s, d) / sb, 0.0, 1.0);
            if (u_soft > 0.0) rw = rw * rw * (3.0 - 2.0 * rw);
            float w = tile_isRect ? mix(rw.x * rw.y, rw.z, kr) : rw.z;
            if (u_soft <= 0.0 && !u_aa) w = d <= 0.0 ? 1.0 : 0.0;
            wSum += w;
            vSum += w * tn;
          }
        }
      }
    }
  }
  float D = min(geo_bestD, 1e4);
  // Bevel aspect: the distance to the winning tile's outline in the space the aspect stretches (its frame: the
  // rotation, then the tile's own turn), so the bevels of sides at different angles meet in a clean mitre. Inside only
  // (outside, the bevel is 0 either way).
  mat2 bM = bevelFrame(geo_toScreen(tile_cs), geo_toScreen(vec2(-tile_cs.y, tile_cs.x)));
  float bd = NO_SDF;
  if (asp) bd = D < 0.0 ? -sqrt(geo_edges2(tile_q, tile_rr, bM)) : D;

  // A solid block (one hexagon): which face the pixel is on — top above both upper edges (y > |x| / 3 in units), then
  // left or right — and how far it is from the edges between the faces (rays from the centre to (±.5, 1/6) and
  // (0, −1/3), px): the nearest one bounding its face, and the face across it, for the colour's anti-aliasing; the
  // nearest of all three, for the crease.
  float across = -1.0, eFace = 1e4, eAll = 1e4;
  vec2 eg = vec2(0.0);
  if (tile_hex) {
    vec2 rA = vec2(0.5, 1.0 / 6.0) * geo_s, rB = vec2(-0.5, 1.0 / 6.0) * geo_s, rC = vec2(0.0, -geo_s.y / 3.0);
    vec2 bq0 = tile_q;
    vec3 er = vec3(length(bq0 - rA * clamp(dot(bq0, rA) / dot(rA, rA), 0.0, 1.0)),
                   length(bq0 - rB * clamp(dot(bq0, rB) / dot(rB, rB), 0.0, 1.0)),
                   length(bq0 - rC * clamp(dot(bq0, rC) / dot(rC, rC), 0.0, 1.0)));
    eAll = min(er.x, min(er.y, er.z));
    eg = vec2(dFdx(eAll), dFdy(eAll));
    // Bevel aspect: the crease's distance in the stretched space (px of Bevel), in the units bevelAt divides by eg's.
    if (asp) {
      vec2 ps = bM * bq0;
      eAll = sqrt(min(bevelSeg2(ps, vec2(0.0), bM * rA), min(bevelSeg2(ps, vec2(0.0), bM * rB), bevelSeg2(ps, vec2(0.0), bM * rC))))
           * bevelWidth(eg) / u_bevel;
    }
    vec2 qu0 = bq0 / geo_s;
    int f = qu0.y > abs(qu0.x) / 3.0 ? 0 : qu0.x < 0.0 ? 1 : 2;
    // Bounding edges: top — A (right face), B (left face); left — B (top), C (right); right — A (top), C (left).
    vec2 e1 = f == 0 ? vec2(er.x, 2.0) : f == 1 ? vec2(er.y, 0.0) : vec2(er.x, 0.0);
    vec2 e2 = f == 0 ? vec2(er.y, 1.0) : f == 1 ? vec2(er.z, 2.0) : vec2(er.z, 1.0);
    vec2 en = e1.x <= e2.x ? e1 : e2;
    eFace = en.x;
    across = en.y;
    geo_bestCls = f;
  }

  // Random value: per tile, per kind, or kind + random. Kind + random puts each kind in its band of the ramp, the tile
  // anywhere in the middle 70 % of it ((kind + .15 + .7 · hash) / kinds); lower Kind contrast slides the bands'
  // centres towards the middle of the ramp and widens them, so at 0 every tile falls anywhere in its middle 60 %. A
  // solid block's faces share one hash: the block is lighter or darker as a whole; on a one-hexagon block the face
  // edges blend into the face across over half a pixel each side (unless Height's per-feature variation reads the
  // random: its hash would turn the blend into speckle).
  float h = hashI(blk ? tile_bid : ivec2(geo_bestKey.x * 16 + geo_bestCls, geo_bestKey.y), uSeed);
  float nc = float(ncls);
  vec2 cc = vec2(float(geo_bestCls), max(across, 0.0));
  float w = clamp(u_kind_w, 0.0, 1.0);
  vec2 rr = u_rnd_mode == 1 ? (cc + 0.5) / nc
          : u_rnd_mode == 2 ? mix(vec2(0.5), (cc + 0.5) / nc, w) + (2.0 * h - 1.0) * mix(0.3, 0.35 / nc, w) : vec2(h);
  bool hashedH = u_h_on && u_h_src != 0 && u_h_var > 0.0;
  float rnd = mix(rr.x, rr.y, across >= 0.0 && !hashedH ? clamp(0.5 - eFace, 0.0, 0.5) : 0.0);

  // Tones: the tiles' tones over the blur, the joints (whatever the tiles leave) the Joint tone; overlapping blurs
  // (a corner of a non-rectangular tiling) share out.
  if (val) return genOut(wSum > 1.0 ? vSum / wSum : vSum + (1.0 - wSum) * u_joint_tone, 1.0, rnd, NO_SDF);

  // Tilt, crown, block relief and crease: Height › Pattern reads the bevel (of the shape as drawn — combined with the
  // mask as the wrapper does) × a lean along a random direction × a dome over the tile's box × the block's
  // sloped sides × the crease between a solid block's faces (Crease depth of its height, over the bevel). Lean, crown
  // and relief never take a tile below a quarter of its height, so every edge keeps its bevel. A solid block's faces
  // share one Per-feature variation, applied here (the wrapper's would hash each face's own random).
  GenOut g = genOut(0.0, 1.0, rnd, D);
  g.bdist = bd;
  bool blkVar = blk && u_h_src == 0 && u_h_var > 0.0;
  float iso = mode == 2 ? clamp(u_block_iso, 0.0, 1.0) : 0.0;
  float crease = tile_hex ? clamp(u_crease, 0.0, 1.0) : 0.0;
  if (u_tilt > 0.0 || u_crown > 0.0 || iso > 0.0 || blkVar || crease > 0.0) {
    int op = maskOp();
    float dc = op == 0 ? D : sdfCombine(op, maskIn(ivec2(gl_FragCoord.xy)), D, u_mk_smooth);
    vec2 dg = vec2(dFdx(dc), dFdy(dc));
    vec3 ht = hash3I(tile_bid, uSeed + 503.0);
    float ta = TAU * ht.x;
    float lean = clamp(0.5 + 0.35355339 * dot(vec2(cos(ta), sin(ta)), tile_bu), 0.0, 1.0);   // 0…1 over the box
    float plane = 1.0 - 0.75 * u_tilt * (0.2 + 0.8 * ht.y) * lean;
    float r = clamp(length(tile_bu) * 0.70710678, 0.0, 1.0);    // 0 at the middle, 1 at the box corners
    float dome = 1.0 - 0.75 * u_crown * pow(r, mix(2.0, 10.0, clamp(u_crown_shape, 0.0, 1.0)));
    // Block relief: the side faces fall from the edge they share with the top (β = 0) to the bottom corner (β = 1) —
    // by at most half the height, so the bottom rim stays lit — and meet in a ridge (|x|): convex arrises.
    vec2 qu = tile_q / geo_s;
    float fall = geo_bestCls == 0 ? 0.0 : clamp(abs(qu.x) - 3.0 * qu.y, 0.0, 1.0);
    float side = 1.0 - 0.5 * iso * fall;
    float crs = 1.0 - crease * (1.0 - bevelAt(-eAll, eg));
    float hv = blkVar ? 1.0 - u_h_var * fract(hashI(tile_bid, uSeed + 601.0) * 61.37 + 0.123) : 1.0;
    // (Bevel aspect, drawn as its own shape: the stretched outline distance, as the wrapper takes it.)
    float bev = bevelAt(asp && op <= 1 ? bd * bevelWidth(dg) / u_bevel : dc, dg);
    g.hval = clamp(bev * plane * dome * side * crs * hv, 0.0, 1.0);
    if (blkVar) g.feat = 0.0;
  }
  return g;
}
`,
}
