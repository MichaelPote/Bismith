# FR8.22 — Stone blocks

**Status:** done — generator with four outputs (relief, joints, scars, gaps); five Starters in the New project wizard

## Goal

A wall of dressed, rock-faced stone: rectangular blocks laid in courses, but irregular the way random and broken ashlar
are — courses of different heights, blocks of different lengths, some split into stacked slabs and short pieces, a few
running through two courses — and faces that a mason has pitched: flake scars struck in from the edges, a rounded
margin falling to a thin joint, the middle of a big stone left as its original face. Developed against five reference
walls: yellow sandstone in broken ashlar with cream blotches (with its diffuse, normal and AO maps), small rust-red
random ashlar, long multicoloured sandstone blocks with lichen and fine cracks, dark wet slate in tall courses crazed
with cracks and mossy joints, and pale frosted stone with moss speckle. Bricks and Rock got close to none of them:
Bricks has no splits or faces, Rock's blocks are Voronoi cells, not dressed rectangles.

## Stone blocks (`stone_blocks`, `generators/stoneBlocks.ts`)

A pattern-category SDF generator (`genOutOwn`: it paints its own value; the Relief output hands its stones to the mask it
writes, Shape by default).

### Layout

- **Courses.** Rows of nominal height _Course height_ (whole rows down the texture when tiling), each row edge jittered
  by up to 0.4 rows (_Course variation_) and snapped to texture pixels. The jitter stays under half a row, so the row
  holding a pixel is found by one test either side of `floor(y / h)`.
- **Blocks.** Each course has its own block length (_Block length_ × course height, varied by _Length variation_; whole
  blocks across when tiling) and its own starting offset — random, or a running bond at _Bond_ 1. Joint positions are
  jittered by up to 0.4 blocks, again found with one test either side.
- **Through stones.** A block of an even course runs on through the course above with this chance. A pixel in the
  course above first looks up the block of the course below at its x: if that one is tall, the pixel is part of it;
  otherwise its own block stops short of a tall neighbour either side (its id rehashed, so the two halves of a block cut
  by a through stone differ). Pairs start on even courses only, so tall blocks never overlap; with an odd number of
  courses on the torus the last can't be tall (the course above it is course 0).
- **Splits.** Guillotine subdivision of the block holding the pixel: up to _Split levels_ times, with chance _Splits_
  (a little less each level), the piece is halved at 30–70 % of its span — along the course (a slab) with chance
  _Slabs_, otherwise across it — never leaving a piece under _Smallest piece_. Per pixel this is only a walk down one
  branch, so it costs three hashes a level. Setting _Smallest piece_ to ~0.4 courses stops stacks of thin slivers.
- **The stone's outline.** A rounded box of the piece inset by half the joint (_Corner rounding_), its distance roughened
  by 5 px noise (_Jaggedness_). Odd joint widths shift by half a pixel so both edges land on pixel boundaries.

### Relief (0 = the original face)

- **Per stone:** a height (_Height variation_), a share set back (_Set-back stones_, _Set-back depth_), a slight
  tilt.
- **Pitched margin:** within _Margin width_ (wandering 0.4–1.6× along the edge) the face falls to the joint in a
  rounded (quarter-circle) shoulder of _Margin drop_.
- **Flake scars.** The look that makes a rock face. Each scar is a hollow below the face, 0 at its rim, and the surface
  takes the lowest of them, so rims meet in crisp ridges and outside them the original face stays flat. One scar is a
  tilted plane — deepest at its struck end, running out at a grazing angle at the other — walled in by the bowl
  `d⁴ − 1` wherever that is shallower: a steep, crisp wall round the struck end, the sides curving up to the rim. (A
  paraboloid alone read as round dents, hammered metal; planar floors read as facets.) Each stone reads the field at
  its own random offset, so scars never run on across a joint.
  - _Scars from edges_: this share of scars is struck from the stone's nearest edge — the struck end at the edge, the scar
    running inward — as a mason pitches a face. An edge scar whose struck end falls short of its edge fades out, so a big
    stone keeps its original face in the middle. Scars are wider along the edge than inward (_Scar stretch_, up to
    2.4×): scallops. Stretched along the strike instead they read as blades.
  - Two sizes in one flat loop: the 4 × 4 cells round the pixel for big scars and for small ones (0.42×, _Small
    scars_); a scar's reach is capped at 1.45 cells so the window always holds it.
  - The field is warped by noise half a scar across (±0.1 scar): ragged rims instead of clean ellipses. Much more
    (±0.3) turned them into worm tracks.
  - _Scar depth_ is in proportion to _Scar size_ over the course height: resizing the scars keeps their slopes (big
    scars at a fixed depth went flat).
- **Surface grain:** fine Perlin noise.
- **Joints and gaps.** The joint's floor sits _Joint depth_ below the face (or below a set-back stone). _Open gaps_:
  with this chance a stone's joint opens at one corner, along one or both edges, tapering from _Gap width_ to nothing
  over a share of the edge — the dark L-shaped holes of a dry-laid wall; they sink deeper still.
- **Joint variation.** Each stone gets its own share of the joint, `1 − variation × hash` (0 = all joints as set, 1 = from
  shut to full width). The share scales the stone's half of the joint (inset, jaggedness, corner rounding), the joint's
  depth, the margin drop, the stone's own height, set-back and tilt, and its part of the Joints mask; open gaps stay.
  A stone owns half of every joint round it, so two shut stones close the joint between them and a shut one beside an
  open one leaves a half joint. Stones under 0.3 are _shut_: they read one shared scar field (no offset of their own,
  none struck from their edges), so a scar runs on across the hairline and two shut stones read as one rock. Two tries
  that didn't work: flush heights alone left a border wherever an edge-struck scar dipped at the edge; fading the scars
  out towards a shut stone's edge left a raised picture frame round each one. At 0 every factor is exactly 1: renders
  of the Starters were checked pixel-identical.
  Bricks and Wood planks have the same control (FR2.4, FR7.2a): there each piece carries the joints on its left and
  top, so a joint closes when the piece that carries it is shut.
- **Value:** `0.5 + 0.5·tanh(v / 2)`: linear over the usual range, deep scars and gaps rounded off rather than clipped.

### Outputs

- **Relief** — the height (and colour by height or per stone); puts the stones in the mask it writes (Shape by default).
- **Joints** — 1 in the joints and gaps, fading over _Joint reach_; _Joint patchiness_ breaks it into patches about three
  blocks across (moss along some joints).
- **Scars** — how deep the scars cut (0 on the original face): paler fresh breaks, or shaded hollows.
- **Gaps** — the open gaps alone, to paint dark.

The masks return no distance (`NO_SDF`), so they hide the Shape card (`sdfShowIf`) and leave the Shape mask alone;
_Write to_ another mask records what they paint as coverage — a joint-moss mask that a speckle layer is _Limited to_
(green flecks along the joints). With a distance (Relief), the mask it writes holds the stones.

**One layer for the wall and its masks.** Mask › Write to's rows take _Joints_, _Gaps_ and _Scars_ as their Source
(`LayerDef.maskSources`, FR8.23): name a target and the relief writes that output's plain coverage there as well,
exactly what a copy of the layer set to that output and writing that mask would — so the masks can't drift from the
stones when the wall is edited. Each is one more pass of the same shader (no compile cost), run before the relief's own
pass with the row's Mode and the layer's Limit to; Shape is refused (it holds the stones). Joint reach and Joint patchiness
show while a Joints row has a target.

### Random value

Per stone, per block (pieces split from one block share it), or per course.

## Recreations

Hand-authored in the studio (kept with the references in the private repo). What carried each:

- _Yellow sandstone, broken ashlar:_ course 64, Block length 3.6, Splits 0.4 at two levels, Through stones 0.25,
  Smallest piece 26, scars 110 px at depth 3.2, faint joints (depth 0.15) and open gaps; paint is a few noise layers:
  broad ochre zones, mottling, cream blotches with grainy edges (Perlin fBm, gain 0.78, cutoff), a fine grain, joints
  multiplied light brown with white-noise grit limited to Shape with Invert, the Gaps output dark green-black. Render AO
  0.7 darkens the scar creases as in the reference; more AO darkened everything.
- _Rust-red small random ashlar:_ course 26, small scars, Height 5 (deeper relief cast shadow outlines round every
  stone), orange lichen as fine fBm specks.
- _Long sandstone with lichen:_ course 64, length 4.2, few splits, shallow scars; overlapping fBm patches of grey, rust,
  dark lichen and pale crust with soft cutoffs; hairline Cracks limited to the stones.
- _Dark wet slate:_ course 125, one split level, dense small scars and roughness under a sheen; a Cracks layer on top
  that also multiplies the specular to 0 (otherwise the sky's reflection washed the dark cracks out); Joints with
  Joint reach 10 and Joint patchiness 0.55 written to a mask, bright green white-noise flecks limited to it.
- _Pale frosted stone:_ course 80 with 12 px scars at depth 2.5 (a fine crumpled relief), a Perlin overlay, hairline
  Cracks, moss as clusters (a mask of their own) filled with fine specks.

## Starters (New project wizard)

Each recreation is also a Starter in the _Nature_ group (`presets/index.ts`), at 512 px as tuned: _Sandstone ashlar_,
_Rust rubble wall_, _Lichen sandstone_, _Mossy slate wall_, _Frosted stone_ (`public/presets/project/stone/*.json`). Each has one
Stone blocks layer: the relief writes _Joints_ (the slate's _Moss_) and, in the ashlar, _Gaps_, and Mask area layers
(Features › Inside) paint the joints and gaps from those masks, so nothing can drift from the stones. They replaced
copies of the layer set to the Joints and Gaps outputs; renders of all five came out pixel-identical. (They were
checked once to build the same project as the studio recreations, param for param.) (The studio projects set no base specular, so loading
took the legacy path and doubled the render specular: the slate's 0.5 is 1 in its Starter.)

## Performance

Cold D3D11 compile 1.9 s (Rock 4.1 s, Bricks 1.4 s). The scar loop is one flat loop of 32 with a uniform bound
(`UNI_1`); the layout's searches are straight-line code.

## Checks

- Tiling: on 384 × 200 with through stones and on 512² supersampled 2×, the mean height difference across each wrap
  seam is no larger than between neighbouring pixels inside (2.1 vs 4.5 across x, 3.9 vs 6.6 across y).
- Supersampling: 1× and 2× renders show the same stones, scars and relief (every length is a px param).
- `stoneBlocks.test.ts`: editor sizing, paint defaults per output, which outputs have a shape, every param used, ranges
  the shader relies on.
