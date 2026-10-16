// Tessellation: one layer, many lattices — squares, diamonds, rhombille (tumbling blocks), herringbone,
// basketweave, interlocking crosses / stretched hexes, plus (Greek cross) tiles, octagon + square, triangles,
// hopscotch (Pythagorean), pinwheel and Cairo pentagons. Every tile is an exact polygon (signed distance, px),
// inset by half the gap with mitred corners and rounded at its convex corners, so the common bevel / profile /
// combine params work. rnd is per tile, or per tile kind (cube face, H/V brick, octagon/square…).

import { P } from '@/core/params'
import type { LayerDef } from '../types'
import { geoGlsl, orientParam, rndModeParam } from './geometricCommon'

export const TESS_MODES: [string, string][] = [
  ['squares', 'Squares / offset squares'],
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

/** Tiles drawn: every tile, or one kind (option index = kind + 1 in the shader). */
const TESS_KINDS: [string, string][] = [
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
  'Tile kinds: squares and diamonds alternate 1, 2 (checker); blocks: 1 top, 2 left, 3 right faces; herringbone, basketweave: 1 horizontal, 2 vertical bricks; crosses: two interleaved sets; plus: five; octagon: 1 octagons, 2 squares; triangles: 1 up, 2 down; hopscotch: 1 big, 2 small squares; pinwheel: 1 horizontal, 2 vertical rectangles, 3 centre squares; Cairo: four orientations'

export const tessellationLayer: LayerDef = {
  type: 'tessellation',
  label: 'Tessellation',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description:
    'Tile lattices — tumbling blocks, herringbone, basketweave, interlocking crosses, octagons, triangles, pinwheel, Cairo… Exact tile distances with gap and rounding; per-tile or per-face random.',
  params: [
    P.enum('mode', 'Tiling', 'rhombille', TESS_MODES),
    P.float('scale', 'Scale', 7, 0.25, 256, {
      softMax: 32,
      step: 0.01,
      hint: 'Pattern repeats across the width (whole counts when tiling). One repeat = 1 square / diamond pair / cube column / 2×2 herringbone or basket block / cross pair / 5 plus tiles / octagon / triangle pair / pinwheel / 2×2 Cairo cells',
    }),
    P.float('aspect', 'Aspect', 1, 0.1, 10, { softMin: 0.25, softMax: 4, step: 0.01, hint: 'Stretch the repeat vertically (rows are rounded to whole counts when tiling)' }),
    orientParam('Multiples of 45°; diagonal frames repeat over gcd(width, height) so they stay seamless'),
    P.float('gap', 'Gap', 2, 0, 256, { softMax: 16, unit: 'px', step: 0.1, hint: 'Grout between tiles (whole even/odd px stay crisp: odd gaps shift the lattice half a pixel)' }),
    P.float('round', 'Corner rounding', 0, 0, 256, { softMax: 48, unit: 'px', step: 0.1, hint: 'Radius of the convex corners — as far as the tile allows; the gap is kept' }),
    P.int('ratio', 'Length ratio', 2, 2, 12, { showIf: modeIs('herringbone', 'basketweave', 'hopscotch'), hint: 'Herringbone: brick length in widths. Basketweave: bricks per block. Hopscotch: big square side in small squares' }),
    P.float('stagger', 'Row offset', 0, 0, 1, { step: 0.001, showIf: modeIs('squares'), hint: 'Shift alternate rows (fraction of a square); rows are made even when tiling' }),
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
      showIf: (p) => p.mode === 'rhombille' && Number(p.block_j ?? 1) <= 0,
      hint: 'Solid blocks: how far the edges between a block’s faces dip, as a share of its height, over the Bevel width — 0 = a sharp arris, 1 = down to the joint',
    }),
    P.float('block_iso', 'Block relief', 0.5, 0, 1, {
      step: 0.001,
      showIf: modeIs('rhombille'),
      hint: 'Height: the top face stays level and the two side faces slope down to the block’s bottom corner by this share of its height — each block raised like a box seen from above',
    }),
    P.bool('fit', 'Keep tile shape', true, {
      hint: 'Tiling needs whole repeats across and down. On: the count across may move off Scale a little so that the rows fit — tiles keep their shape (regular blocks and triangles) and Aspect holds at any scale. Off: exactly Scale across, the rows rounded (tiles may stretch or squash)',
    }),
    P.float('laid', 'Hand-laid shift', 0, 0, 64, {
      softMax: 8,
      unit: 'px',
      step: 0.1,
      section: 'Per tile',
      hint: 'Hand-laid: each tile sits off its place by a random amount up to this. Within the joint the tiles keep their size; a tile that needs more room than its joint gives comes out a little smaller, so tiles never overlap',
    }),
    P.float('laid_turn', 'Hand-laid turn', 0, 0, 64, {
      softMax: 8,
      unit: 'px',
      step: 0.1,
      section: 'Per tile',
      hint: 'Hand-laid: each tile turns a random way about its middle, its corners moving up to this many px — long tiles turn by less, small ones by more. Follows Hand-laid shift until set by hand',
    }),
    P.float('size_var', 'Size variation', 0, 0, 64, {
      softMax: 8,
      unit: 'px',
      step: 0.1,
      section: 'Per tile',
      hint: 'Each tile comes out smaller by a random amount up to this (handmade tiles, worn setts): joints of uneven width',
    }),
    P.float('tilt', 'Tilt', 0.5, 0, 1, {
      step: 0.001,
      section: 'Per tile',
      hint: 'Height: each tile leans a random way, its low side down by up to three quarters of its own height at 1 (lippage) — never into the joint, so every edge keeps its bevel. With Per-feature variation, tiles at their own heights and angles',
    }),
    P.float('crown', 'Crown', 0.3, 0, 1, {
      step: 0.001,
      section: 'Per tile',
      hint: 'Height: each tile domes towards its middle, its corners down by up to three quarters of its height at 1 (pillowed tiles; the bevel still marks the edge)',
    }),
    P.float('crown_shape', 'Crown shape', 0.3, 0, 1, {
      step: 0.001,
      section: 'Per tile',
      showIf: (p) => Number(p.crown) > 0,
      hint: '0 = a round dome over the whole tile; 1 = a flat top with a firm shoulder near the edge (cushioned setts)',
    }),
    P.float('missing', 'Missing tiles', 0, 0, 1, { step: 0.001, section: 'Per tile', hint: 'Share of tiles left out at random (the seed picks which): gaps in a floor, scattered inlays. Their place is outside the shape (shape mask, Clip to outside)' }),
    P.enum('only', 'Tiles drawn', 'all', TESS_KINDS, { section: 'Per tile', hint: KIND_HINT }),
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
  // Kinds that make the motif (block faces, argyle, octagons and squares, big and small squares, pinwheel centres) keep
  // their own tones; elsewhere a kind is only a sub-lattice (checker squares, H / V bricks, interleaved crosses).
  // The turn follows the shift (no shift, no turn) until set by hand.
  linkedDefaults: (p) => ({ kind_w: KIND_CONTRAST[String(p.mode)] ?? 1, laid_turn: Number(p.laid ?? 0) }),
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
    dif_src: 'random',
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
    /* glsl */ `
// ---------------------------------------------------------------- modes (unit coords, y up, CCW polygons)
// Every mode is a few tile shapes, each tried at a list of anchors: tess_shape(k) builds shape k and says how many
// anchors it has; tess_anchor(k, a) gives anchor a. gen() runs them all through one flat loop with a single
// geo_finish and one tile try (geo_sdPoly). D3D (Chrome's default on Windows) inlines every call, and a mode function apiece, each
// with its own nested loops of tries, took ~20 s to compile.
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

#define TESS_1 (uRes.x > 0.0 ? 1 : 0)   // 1, from a uniform: a loop bound D3D can't unroll

const vec2 TESS_RHOMB[12] = vec2[12](
  vec2(0.0), vec2(0.5, 1.0 / 6.0), vec2(0.0, 1.0 / 3.0), vec2(-0.5, 1.0 / 6.0),
  vec2(0.0), vec2(-0.5, 1.0 / 6.0), vec2(-0.5, -1.0 / 6.0), vec2(0.0, -1.0 / 3.0),
  vec2(0.0), vec2(0.0, -1.0 / 3.0), vec2(0.5, -1.0 / 6.0), vec2(0.5, 1.0 / 6.0));
const vec2 TESS_HEX[6] = vec2[6](   // a whole block (rhombille, faces joined)
  vec2(0.5, 1.0 / 6.0), vec2(0.0, 1.0 / 3.0), vec2(-0.5, 1.0 / 6.0), vec2(-0.5, -1.0 / 6.0), vec2(0.0, -1.0 / 3.0), vec2(0.5, -1.0 / 6.0));
const vec2 TESS_PLUS[12] = vec2[12](
  vec2(0.5, -1.5), vec2(0.5, -0.5), vec2(1.5, -0.5), vec2(1.5, 0.5),
  vec2(0.5, 0.5), vec2(0.5, 1.5), vec2(-0.5, 1.5), vec2(-0.5, 0.5),
  vec2(-1.5, 0.5), vec2(-1.5, -0.5), vec2(-0.5, -0.5), vec2(-0.5, -1.5));

int tess_mode, tess_n;
vec2 tess_uu;
// The tile under the pixel where a mode finds it directly (rhombille's nearest hex, triangles, Cairo): its anchor
// (units), cell, kind, and the key's lattice (cell, period) and extra kind offset.
vec2 tess_pos;
ivec2 tess_cell, tess_add;
int tess_cls;
bool tess_hex;      // rhombille, solid blocks: one hexagon per block, its faces found after the search
float tess_inner;   // rhombille: how far the faces' inner edges (those at the block's centre) push out into the gap, px
vec2 tess_bu;   // the winning tile's own position in its box (−1…1 across), for tilt and crown
ivec2 tess_bid; // and its id (its block's, when a block's faces meet)
vec2 tess_q;    // and the pixel in its own frame (px from its anchor)

void tess_pick() {
  int m = tess_mode;
  vec2 uu = tess_uu;
  if (m == 2) {
    ivec2 c0 = ivec2(floor(uu));
    float bd = 1e9;
    for (int e = 0; e < 18 * TESS_1; e++) {
      int h = e % 2;
      ivec2 c = c0 + ivec2((e / 2) % 3 - 1, e / 6 - 1);
      vec2 ctr = vec2(c) + (h == 0 ? vec2(0.5, 0.25) : vec2(0.0, 0.75));
      vec2 d = uu - ctr;
      float dd = d.x * d.x + 3.0 * d.y * d.y;
      if (dd < bd) { bd = dd; tess_pos = ctr; tess_cell = c; tess_add = ivec2(h, 0); }
    }
  } else if (m == 8) {
    float ry = uu.y * 2.0;
    int r = int(floor(ry));
    float t = ry - float(r);
    float o = (r & 1) == 1 ? 0.5 : 0.0;
    float x = uu.x - o;
    int i = int(floor(x - 0.5 * t)), j = int(floor(x + 0.5 * t));
    tess_cls = j == i ? 0 : 1;
    int k = j == i ? i : j;
    tess_pos = vec2(float(k) + o, 0.5 * float(r));
    tess_cell = ivec2(k, r);
  } else if (m == 11) {
    float e = 0.5 - clamp(u_cairo, 0.0, 0.45);
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
    tess_cls = typ == 0 ? (((X.x - 1 + X.y) & 1) == 0 ? 0 : 1) : (((X.x + X.y - 1) & 1) == 0 ? 2 : 3);
    tess_pos = vec2(X);
    tess_cell = X;
    tess_add = ivec2(typ, 0);
  }
}

// Shape k of the mode as the working polygon (not yet inset); returns its anchor count.
int tess_shape(int k) {
  int m = tess_mode;
  float fn = float(tess_n);
  vec2 lo = vec2(0.0), hi = vec2(1.0);   // a rectangle, unless the mode sets vertices
  geo_n = 0;
  int count = 9;
  if (m == 1 || (m == 7 && k == 1)) {
    float r = m == 1 ? 0.5 : clamp(u_cut, 0.005, 0.495);
    geo_V[0] = vec2(0.0, -r); geo_V[1] = vec2(r, 0.0); geo_V[2] = vec2(0.0, r); geo_V[3] = vec2(-r, 0.0);
    geo_n = 4;
    count = m == 1 ? 13 : 4;
  } else if (m == 2) {
    geo_n = tess_hex ? 6 : 4;
    for (int i = 0; i < geo_n * TESS_1; i++) geo_V[i] = tess_hex ? TESS_HEX[i] : TESS_RHOMB[4 * k + i];
    count = 1;
  } else if (m == 3) {
    if (k == 0) hi = vec2(fn, 1.0);
    else { lo = vec2(fn, 1.0 - fn); hi = vec2(fn + 1.0, 1.0); }
    count = 3 * (tess_n / 2 + 4);
  } else if (m == 4) {
    ivec2 b = ivec2(floor(tess_uu / fn));
    hi = ((b.x + b.y) & 1) == 0 ? vec2(fn, 1.0) : vec2(1.0, fn);
    count = tess_n;
  } else if (m == 5) {
    float pl = clamp(u_plateau, 0.01, 0.99);
    float xt = 2.0 * pl;
    float st = max(clamp(u_step, 0.0, 1.0) * abs(1.0 - 2.0 * pl), 0.002);
    float dir = pl <= 0.5 ? 1.0 : -1.0;
    vec2 V1 = vec2(2.0 - xt, 0.0), S1 = vec2(1.0 + dir * st, 0.5), S2 = vec2(1.0 - dir * st, 0.5), V2 = vec2(xt, 1.0);
    geo_V[0] = V1; geo_V[1] = S1; geo_V[2] = S2; geo_V[3] = V2;
    geo_V[4] = vec2(-V2.x, V2.y); geo_V[5] = vec2(-S2.x, S2.y); geo_V[6] = vec2(-S1.x, S1.y); geo_V[7] = -V1;
    geo_V[8] = -S1; geo_V[9] = -S2; geo_V[10] = -V2;
    geo_V[11] = vec2(V2.x, -V2.y); geo_V[12] = vec2(S2.x, -S2.y); geo_V[13] = vec2(S1.x, -S1.y);
    geo_n = 14;
    count = 18;
  } else if (m == 6) {
    for (int i = 0; i < 12 * TESS_1; i++) geo_V[i] = TESS_PLUS[i];
    geo_n = 12;
  } else if (m == 7) {
    float c = clamp(u_cut, 0.005, 0.495);
    geo_V[0] = vec2(c, 0.0); geo_V[1] = vec2(1.0 - c, 0.0); geo_V[2] = vec2(1.0, c); geo_V[3] = vec2(1.0, 1.0 - c);
    geo_V[4] = vec2(1.0 - c, 1.0); geo_V[5] = vec2(c, 1.0); geo_V[6] = vec2(0.0, 1.0 - c); geo_V[7] = vec2(0.0, c);
    geo_n = 8;
  } else if (m == 8) {
    geo_V[0] = vec2(0.0);
    if (tess_cls == 0) { geo_V[1] = vec2(1.0, 0.0); geo_V[2] = vec2(0.5); }
    else { geo_V[1] = vec2(0.5); geo_V[2] = vec2(-0.5, 0.5); }
    geo_n = 3;
    count = 1;
  } else if (m == 9) {
    if (k == 0) hi = vec2(fn);
    else { lo = vec2(fn, 0.0); hi = vec2(fn + 1.0, 1.0); }
  } else if (m == 10) {
    float inner = clamp(u_inner, 0.02, 0.98);
    float A = 0.5 * (1.0 + inner), B = 0.5 * (1.0 - inner);
    if (k == 0) hi = vec2(A, B);
    else if (k == 1) { lo = vec2(A, 0.0); hi = vec2(1.0, A); }
    else if (k == 2) lo = vec2(B, A);
    else if (k == 3) { lo = vec2(0.0, B); hi = vec2(B, 1.0); }
    else { lo = vec2(B); hi = vec2(A); }
  } else if (m == 11) {
    float e = 0.5 - clamp(u_cairo, 0.0, 0.45);
    int c = tess_cls;
    geo_V[0] = vec2(0.0);
    if (c == 0) { geo_V[1] = vec2(0.5, e); geo_V[2] = vec2(0.5, 1.0 - e); geo_V[3] = vec2(0.0, 1.0); geo_V[4] = vec2(-e, 0.5); }
    else if (c == 1) { geo_V[1] = vec2(e, 0.5); geo_V[2] = vec2(0.0, 1.0); geo_V[3] = vec2(-0.5, 1.0 - e); geo_V[4] = vec2(-0.5, e); }
    else if (c == 2) { geo_V[1] = vec2(e, -0.5); geo_V[2] = vec2(1.0 - e, -0.5); geo_V[3] = vec2(1.0, 0.0); geo_V[4] = vec2(0.5, e); }
    else { geo_V[1] = vec2(0.5, -e); geo_V[2] = vec2(1.0, 0.0); geo_V[3] = vec2(1.0 - e, 0.5); geo_V[4] = vec2(e, 0.5); }
    geo_n = 5;
    count = 1;
  }
  if (geo_n == 0) { geo_V[0] = lo; geo_V[1] = vec2(hi.x, lo.y); geo_V[2] = hi; geo_V[3] = vec2(lo.x, hi.y); geo_n = 4; }
  for (int i = 0; i < geo_n; i++) geo_V[i] *= geo_s;
  if (m == 2 && tess_inner > 0.0 && !tess_hex) {
    // Narrower joints inside the block: push the two edges at the centre (v3 → v0 → v1) out by tess_inner before the
    // inset — v0 by a mitre, v1 and v3 along the outer edges they share.
    vec2 v0 = geo_V[0], v1 = geo_V[1], v2 = geo_V[2], v3 = geo_V[3];
    vec2 ea = normalize(v0 - v3), eb = normalize(v1 - v0);
    vec2 na = vec2(ea.y, -ea.x), nb = vec2(eb.y, -eb.x);   // outward (CCW)
    vec2 u1 = normalize(v2 - v1), u3 = normalize(v2 - v3);
    geo_V[0] = v0 + tess_inner * (na + nb) / max(1.0 + dot(na, nb), 0.05);
    geo_V[1] = v1 + u1 * tess_inner / dot(nb, u1);
    geo_V[3] = v3 + u3 * tess_inner / dot(na, u3);
  }
  return count;
}

// Anchor a of shape k: position (units), tile kind, and its key's parts — key = geo_wrapCell(cell) * mul + add.
void tess_anchor(int k, int a, out vec2 pos, out int cls, out ivec2 cell, out ivec2 mul, out ivec2 add) {
  int m = tess_mode;
  vec2 uu = tess_uu;
  int n = tess_n;
  float fn = float(n);
  ivec2 d3 = ivec2(a % 3 - 1, a / 3 - 1);   // 3×3 neighbourhood, rows outer
  cls = k;
  cell = ivec2(0);
  mul = ivec2(1);
  add = ivec2(0);
  // Integer-lattice modes: key = geo_keyI(L, P) * kmul + kadd.
  ivec2 L = ivec2(0), P = ivec2(0), kmul = ivec2(1), kadd = ivec2(0);
  if (m == 0) {
    int j = int(floor(uu.y)) + d3.y;
    float o = (j & 1) == 1 ? u_stagger : 0.0;
    int i = int(floor(uu.x - o)) + d3.x;
    pos = vec2(float(i) + o, float(j));
    cell = ivec2(i, j);   // kind: from the key, in gen()
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
    pos = tess_pos;
    if (m == 2) { cell = tess_cell; mul = ivec2(2, 1); add = tess_add; }
    else {
      cls = tess_cls;
      L = tess_cell;
      P = m == 8 ? ivec2(1, 2) : ivec2(2);
      if (m == 11) { kmul = ivec2(2, 1); kadd = tess_add; }
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
    bool hor = ((b.x + b.y) & 1) == 0;
    pos = vec2(b) * fn + (hor ? vec2(0.0, float(a)) : vec2(float(a), 0.0));
    cls = hor ? 0 : 1;
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
  } else if (m == 6) {
    vec2 q = uu - 0.5;
    ivec2 b = ivec2(floor(vec2(2.0 * q.x + q.y, 2.0 * q.y - q.x) / 5.0)) + d3;
    L = ivec2(2 * b.x - b.y, b.x + 2 * b.y);
    pos = vec2(L) + 0.5;
    cls = imod(L.x, 5);
    P = ivec2(5);
  } else if (m == 9) {
    float D = fn * fn + 1.0;
    ivec2 b = ivec2(floor(vec2(fn * uu.x + uu.y, fn * uu.y - uu.x) / D)) + d3;
    L = ivec2(b.x * n - b.y, b.x + b.y * n);
    P = ivec2(n * n + 1);
    pos = vec2(L);
  } else {
    ivec2 cc = ivec2(floor(uu)) + d3;
    pos = vec2(cc);
    cls = k == 4 ? 2 : (k & 1);
    cell = cc;
    mul = ivec2(5, 1);
    add = ivec2(k, 0);
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
  // Period in pattern units, its natural height/width ratio, tile kinds, smallest tile feature (units).
  vec2 U = vec2(1.0);
  float nat = 1.0;
  int ncls = 1;
  float feat = 0.5;
  int multY = 1;
  if (mode == 0) { ncls = 2; feat = 1.0; multY = u_stagger > 0.0 ? 2 : 1; }
  else if (mode == 1) { ncls = 2; feat = 0.7; }
  else if (mode == 2) { nat = 1.7320508; ncls = 3; feat = 0.25; }
  else if (mode == 3 || mode == 4) { U = vec2(2.0 * float(n)); ncls = 2; feat = 1.0; }
  else if (mode == 5) { U = vec2(4.0, 2.0); ncls = 2; feat = 0.5; }
  else if (mode == 6) { U = vec2(5.0); ncls = 5; feat = 1.0; }
  else if (mode == 7) { ncls = 2; feat = 0.4; }
  else if (mode == 8) { nat = 1.7320508; ncls = 2; feat = 0.25; }
  else if (mode == 9) { U = vec2(float(n * n + 1)); ncls = 2; feat = 1.0; }
  else if (mode == 10) { ncls = 3; feat = 0.3; }
  else { U = vec2(2.0); ncls = 4; feat = 0.4; }

  // Odd gaps: shift the lattice half a pixel so both gap edges land on pixel boundaries.
  float sh = fract(0.5 * u_gap);
  geo_frame(p - sh, u_orient);
  // Rows per column for the tile shape asked for (natural shape × Aspect).
  float rpc = geo_span.y / (geo_span.x * (U.y / U.x) * nat * u_aspect);
  float kx0 = u_scale * geo_span.x / uRes.x;
  float kx = geo_count(kx0, 1);
  float ky = geo_count(kx * rpc, multY);
  if (uTile && u_fit) {
    // Keep tile shape: try column counts around Scale (and the one that gives a single row band when the rows would
    // round away) and keep the best fit of shape, then of count — log errors, the shape weighing ~3× the count.
    float fm = float(multY);
    float lo = max(1.0, floor(kx0 * 0.6));
    float hi = min(max(ceil(kx0 * 1.6), floor(fm / rpc + 0.5)), lo + 47.0);
    float best = 1e9;
    for (int i = 0; i < 48 * TESS_1; i++) {
      float x = lo + float(i);
      if (x > hi) break;
      float y = max(1.0, floor(x * rpc / fm + 0.5)) * fm;
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
  tess_inner = mode == 2 ? (1.0 - clamp(u_block_j, 0.0, 1.0)) * halfGap : 0.0;
  // Faces that meet without a joint: the block is one hexagon (no seam in its coverage or bevel) — unless one kind of
  // face is drawn alone, which needs the faces as shapes of their own.
  tess_hex = mode == 2 && u_block_j <= 0.0 && u_only == 0;
  geo_reset();
  int only = u_only - 1;   // -1: every kind

  tess_mode = mode;
  tess_n = n;
  tess_uu = geo_f / geo_s;
  tess_pick();
  tess_bu = vec2(0.0);
  tess_q = vec2(0.0);
  tess_bid = ivec2(0);
  bool blk = mode == 2 && u_block_j < 1.0;
  vec2 hexExt = vec2(0.5, 1.0 / 3.0) * geo_s;   // a block's half extent (rhombille)
  float turnPx = max(u_laid_turn, 0.0);
  // Every shape, then its anchors, in one flat loop (see the modes above). No continue: ANGLE's D3D11 path has
  // miscompiled it — the per-anchor work sits in an if.
  int shapes = mode == 2 ? (tess_hex ? 1 : 3) : mode == 10 ? 5 : (mode == 3 || mode == 7 || mode == 9) ? 2 : 1;
  int k = -1, a = 0, na = 0;
  for (int it = 0; it < 72 * TESS_1; it++) {
    if (a >= na) {
      k++;
      if (k >= shapes) break;
      na = tess_shape(k);
      geo_finish();
      a = 0;
    } else {
      vec2 pos;
      int cls;
      ivec2 cell, mul, add;
      tess_anchor(k, a, pos, cls, cell, mul, add);
      ivec2 key = geo_wrapCell(cell) * mul + add;
      if (mode == 0) cls = (key.x + key.y) & 1;
      a++;
      // Per tile: the kind filter and missing tiles; Size variation shrinks the tile by s (its distance + s);
      // Hand-laid shifts it and turns it about its box centre, and shrinks it by whatever that moves its corners
      // past the room its joint gives (half the gap + s). So it never leaves its own footprint and the modes that
      // test one tile stay exact. Blocks whose faces meet (Joints inside blocks < 1) go missing, move, tilt and dome
      // as one: the block's id, turned about its centre.
      ivec2 id = ivec2(key.x * 16 + (blk ? 0 : cls), key.y);
      bool skip = !geo_ok || (only >= 0 && ((cls == only) == u_only_inv)) || hashI(id, uSeed + 211.0) < u_missing;
      if (!skip) {
        vec3 hj = hash3I(id, uSeed + 101.0);
        vec3 hl = hash3I(id, uSeed + 307.0);
        vec2 ctr = blk ? vec2(0.0) : geo_bbC, ext = blk ? hexExt : geo_bbH;
        float R = length(ext);
        vec2 t = u_laid * sqrt(hl.x) * normalize(2.0 * hj.yz - 1.0 + vec2(1e-4, 0.0));
        float ang = min(turnPx / max(R, 1e-3), 0.785) * (2.0 * hl.y - 1.0);   // corners move ≤ the turn's px
        vec2 cs = normalize(vec2(1.0, tan(ang)));
        float s = u_size_var * hj.x;
        s += max(length(t) + R * abs(ang) - (halfGap + s), 0.0);
        vec2 q = geo_f - pos * geo_s - ctr - t;
        q = vec2(cs.x * q.x + cs.y * q.y, cs.x * q.y - cs.y * q.x) + ctr;
        vec2 bq = abs(q - geo_bbC) - geo_bbH;
        if (length(max(bq, 0.0)) - geo_r + s < geo_bestD) {
          float d = geo_sdPoly(q) - geo_r + s;
          if (d < geo_bestD) {
            geo_bestD = d; geo_bestCls = cls; geo_bestKey = key;
            tess_bu = (q - ctr) / max(ext, vec2(1e-3));
            tess_q = q;
            tess_bid = id;
          }
        }
      }
    }
  }
  float D = min(geo_bestD, 1e4);

  // A solid block (one hexagon): which face the pixel is on — top above both upper edges (y > |x| / 3 in units), then
  // left or right — and how far it is from the edges between the faces (rays from the centre to (±.5, 1/6) and
  // (0, −1/3), px): the nearest one bounding its face, and the face across it, for the colour's anti-aliasing; the
  // nearest of all three, for the crease.
  vec2 rA = vec2(0.5, 1.0 / 6.0) * geo_s, rB = vec2(-0.5, 1.0 / 6.0) * geo_s, rC = vec2(0.0, -geo_s.y / 3.0);
  vec2 bq0 = tess_q;
  vec3 er = vec3(length(bq0 - rA * clamp(dot(bq0, rA) / dot(rA, rA), 0.0, 1.0)),
                 length(bq0 - rB * clamp(dot(bq0, rB) / dot(rB, rB), 0.0, 1.0)),
                 length(bq0 - rC * clamp(dot(bq0, rC) / dot(rC, rC), 0.0, 1.0)));
  float eAll = min(er.x, min(er.y, er.z));
  vec2 eg = vec2(dFdx(eAll), dFdy(eAll));
  float across = -1.0, eFace = 1e4;
  if (tess_hex) {
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
  float h = hashI(blk ? tess_bid : ivec2(geo_bestKey.x * 16 + geo_bestCls, geo_bestKey.y), uSeed);
  float nc = float(ncls);
  vec2 cc = vec2(float(geo_bestCls), max(across, 0.0));
  float w = clamp(u_kind_w, 0.0, 1.0);
  vec2 rr = u_rnd_mode == 1 ? (cc + 0.5) / nc
          : u_rnd_mode == 2 ? mix(vec2(0.5), (cc + 0.5) / nc, w) + (2.0 * h - 1.0) * mix(0.3, 0.35 / nc, w) : vec2(h);
  bool hashedH = u_h_on && u_h_src != 0 && u_h_var > 0.0;
  float rnd = mix(rr.x, rr.y, across >= 0.0 && !hashedH ? clamp(0.5 - eFace, 0.0, 0.5) : 0.0);

  // Tilt, crown, block relief and crease: Height › Pattern reads the bevel (of the shape as drawn — combined with the
  // shape mask as the wrapper does) × a lean along a random direction × a dome over the tile's box × the block's
  // sloped sides × the crease between a solid block's faces (Crease depth of its height, over the bevel). Lean, crown
  // and relief never take a tile below a quarter of its height, so every edge keeps its bevel. A solid block's faces
  // share one Per-feature variation, applied here (the wrapper's would hash each face's own random).
  int op = u_sm_on ? u_sdf_op + 1 : 0;
  float dc = op == 0 ? D : sdfCombine(op, texelFetch(tSurface, ivec2(gl_FragCoord.xy), 0).a, D, u_sdf_k);
  vec2 dg = vec2(dFdx(dc), dFdy(dc));
  GenOut g = genOut(0.0, 1.0, rnd, D);
  bool blkVar = blk && u_h_src == 0 && u_h_var > 0.0;
  float iso = mode == 2 ? clamp(u_block_iso, 0.0, 1.0) : 0.0;
  float crease = tess_hex ? clamp(u_crease, 0.0, 1.0) : 0.0;
  if (u_tilt > 0.0 || u_crown > 0.0 || iso > 0.0 || blkVar || crease > 0.0) {
    vec3 ht = hash3I(tess_bid, uSeed + 503.0);
    float ta = TAU * ht.x;
    float lean = clamp(0.5 + 0.35355339 * dot(vec2(cos(ta), sin(ta)), tess_bu), 0.0, 1.0);   // 0…1 over the box
    float plane = 1.0 - 0.75 * u_tilt * (0.2 + 0.8 * ht.y) * lean;
    float r = clamp(length(tess_bu) * 0.70710678, 0.0, 1.0);    // 0 at the middle, 1 at the box corners
    float dome = 1.0 - 0.75 * u_crown * pow(r, mix(2.0, 10.0, clamp(u_crown_shape, 0.0, 1.0)));
    // Block relief: the side faces fall from the edge they share with the top (β = 0) to the bottom corner (β = 1) —
    // by at most half the height, so the bottom rim stays lit — and meet in a ridge (|x|): convex arrises.
    vec2 qu = tess_q / geo_s;
    float fall = geo_bestCls == 0 ? 0.0 : clamp(abs(qu.x) - 3.0 * qu.y, 0.0, 1.0);
    float side = 1.0 - 0.5 * iso * fall;
    float crs = 1.0 - crease * (1.0 - bevelAt(-eAll, eg));
    float hv = blkVar ? 1.0 - u_h_var * fract(hashI(tess_bid, uSeed + 601.0) * 61.37 + 0.123) : 1.0;
    g.hval = clamp(bevelAt(dc, dg) * plane * dome * side * crs * hv, 0.0, 1.0);
    if (blkVar) g.feat = 0.0;
  }
  return g;
}
`,
}
