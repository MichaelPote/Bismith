# FR8.32 — Rock

**Status:** generator done; recreations of fifteen rock photos kept in `private/` (see _Recreations_)

## Goal

A rock generator whose height map reads as a natural rock face — cliffs, boulders, angular fractured blocks, flaky
shale and strata, scooped sandstone, pitted rock — without the regular features of Stones (FR8.18, named Rock until 2026-11-13), whose blocks sit on a
sheared lattice of strata and read as coursed masonry. No bricks and no grid as the building block: irregular fractured
blocks of every size, their heights, tilts, facets and ledges doing the work, and faces of several levels — stacked
sheets broken back in bevelled steps, angular planes — rather than one raised height per block. The height is the primary output; colour is
a ramp by height, and what else needs paint (crevices, fractures, ledges) goes out through Write to's mask sources rather
than an Output dropdown. Colour, moss, dirt and worn edges come from other layers (noise limited to those masks, Edge
wear on the relief).

## Rock (`rock`, `generators/rock.ts`)

Called Rock V2 (`rock2`) while it was built beside the older generator, now Stones.

A pattern-category SDF generator (`genOutOwn`: it paints its own value and hands its blocks to the mask it writes).

### Blocks

- **Power diagram.** Sites free anywhere in their cells (jitter 1), each with a weight (_Size variation_ up to 1:
  0.7 cell² at most — big blocks among small ones; larger weights let a big block's neighbours fall outside the search).
  Nearest three sites over the 5 × 5 cells round the pixel's, then every cell of the 5 × 5 round the nearest as a mesa
  (below): two flat loops of 25 per scale, their bounds from `UNI_1`.
- **Merged masses** (_Larger blocks_, with _Merging_ 0–1). For sizes a power diagram can't reach, neighbouring blocks
  merge: each block reads a broad noise at its site (cells 1.2 blocks across at Merging 0, 2.5 at 1, two across the
  texture at least) and falls in one of eight bands of it, stretched to about equal areas; bands join in a fixed
  interleaved order, an eighth at a time up to 75 % at 1. Blocks of a merged band that touch are one mass: one height, a
  gentle slope from the noise at the pixel (the same for all of them, so the mass is one surface), no curvature, facets,
  chamfers or rim steps, and no edge, skirt or crease between them (the mesa loop skips them); splits still crack across
  it. A few huge masses among small blocks at 1. The masses are worked out in a small loop of their own before the
  mesas, with a plain four-hash lattice noise, and only in the `RV_MERGE` shader variant, which the _Larger blocks_
  tickbox picks (`shaderFeatures`; _Merging_ is gated by it, so dragging never compiles): in every compile they added
  about 2 s to D3D's cold compile.
- **Cleavage frame.** _Elongation_ stretches the blocks along the _Cleavage angle_ (or across it, below 1). The diagram is
  isotropic in the cells' own metric — grid units × the mean cell size — so elongated cells really come out elongated
  (jittered sites in stretched cells alone stay statistically round). A distance `d` along the metric's normal `n` is
  `d / |Mᵀn|` px (`rv_px`), `M` the frame-px → metric map. Within 45° of horizontal the frame is the screen; steeper, its
  axes are swapped (a reflection, so distances stay px). The rows lean by `t`: when tiling `t` is snapped so a row moves a
  whole `m` cells over the tile's width, and cell `(i + nx, j − m)` is cell `(i, j)` (`rv_key`). Every count is worked out
  on the CPU per scale (`rockDerived`: cells, counts, lean, the jaggies' noise cells) — the test checks the keys are
  seamless.
- **Jaggedness.** The pixel moves by a Perlin offset of _Jaggedness_ × the cell size before the search, _Jaggedness
  scale_ blocks across, with _Jaggedness octaves_ octaves (1–6, each half the size of the last): ragged, wandering
  breaks. The same noise wavers the ledges' run and their steps, the rim steps and the sheets' edges, all by
  _Jaggedness_ too (× Jaggedness / 0.3, so the default is unchanged): at 0 every edge and step runs straight. Only the
  cracks' pinching (_Crack variation_) and the fractures' breaks (_Fracture breakup_) keep their own amounts on it, so
  the scale and octaves stay shown while either is on.
- **Fused joints.** That share of blocks keep their edges subdued on every side (8 % of the edge drop), take their
  height from their cluster (3 × 3 cells) and hardly tilt, have no rim steps and facets a third as deep; a joint
  between two of them never opens. Fused neighbours stand level as one big mass among the small pieces — not a paving of
  equal pillows (per block, not per joint: see _Skirts start where faces end_).
- **Splits.** With the _Splits_ chance a block is cut by up to three chords through points anywhere in it, a chain
  (each splits one side of the one before, at least 30° off it), each kinked into two runs 25–50° apart: two to four
  pieces with their own height offsets. On elongated blocks most chords run along the cleavage. They keep half the
  jaggies' warp (with all of it they bent into arcs that pinched a raised piece into a bow-tie; with none they read as
  ruled lines). Each piece's face falls at the chord to a common floor (`edge drop / 2` below the block, its offset in
  the drop), so the pieces meet in a narrow crack whatever their heights. One call site per loop iteration
  (`rv_split`), for the own block at the pixel and for a neighbour at its border point.
- **Shattered blocks.** A block picked by this share has its first flake level turned into rubble: angular pieces
  (planar edges, the full edge drop, no dome) at 2.5 × the flake relief, their creases opened as cracks (and written to
  the Blocks mask and Crevices); not on pieces under ~10 px, where they broke into speckle.

### Relief

- **Mesas.** Each block's face: its height (_Height variation_), a tilt of its own (_Face tilt_), the common _Ledge dip_
  across the cleavage (each block rises to one side and breaks off at the other: shingles), and a dome or scoop (_Face
  curvature_, centred 0.3 of a block off the site — a boulder bulges towards its foot, a scoop is deepest under its rim;
  `0.5 − 0.9 (1 − e^(−2.2 r²/P²))`, levelling off far from its middle, or a scoop's far corners stood as flat plateaus).
  Outside its cell, a skirt that falls one unit per _Ledge run_ px — each block's own with _Ledge variation_ (a quarter
  to four times at 1: some sheer, some long slopes) — or in flaky steps (_Ledge steps_ / _Step width_, each block its
  own step and phase, only where the ledge is steep, 1–3 px of world height per px: on gentle slopes they drew contour
  rings; gated on the run in px they never showed on deep relief, where every run is long in px). The crease takes the
  slopes of the two mesas that meet there. The surface is the highest mesa: tall blocks overhang their neighbours as ledges,
  equal ones meet in a V. The distance to a neighbour's cell is the farthest of its power bisectors with the pixel's
  three nearest sites (a lower bound that doesn't jump across their edges, as in Rock).
- **Edges.** Each border falls away into the face as a chamfer of its own width (_Edge width_ × the block, pair-hashed
  0.7–1.3) and a drop that is the block's own (_Edge drop_ × 0.4–1.6, per block — see below); the face is lowered by the
  largest chamfer, so the edges meet in ridges: linear chamfers give flat facets (a pyramid of planar facets at Edge
  width 1, boxy blocks with bevelled sides at 0.2–0.3), quadratic ones a rounded shoulder (_Edge rounding_). Flakes keep
  their edges mostly planar (0.3 × the rounding): facets, not cobbles within cobbles.
- **Skirts start where faces end.** A neighbour's skirt starts at its face at the border point nearest the pixel: its
  plane there less its chamfer. That chamfer is exactly its drop only if no other edge of the block falls further at
  that point — so every edge of a block drops by the block's own amount (and a fused block's by its own reduced one).
  With a drop per pair of blocks (first), or per-pair fusing (second), a corner's other edge could fall further than the
  shared one, and the skirt stood above the face it hangs from: a bright bead along the border, or a hard-edged wedge.
  Taking the chamfers of the neighbour's borders with the pixel's second and third nearest sites as well only covered
  the corners. Where a split of the neighbour meets the border, the split's own fall is taken too. The flaky steps
  measure from the border (0 there), or a skirt with Ledge steps started half a step above its face.
- **Skirt reach.** Past about a fifth of a block from its border a skirt steepens (`+ (D − 0.2 P)² / 0.1 P`): skirts
  closing in on a low block from every side swallowed it into a pinched star of concave arcs.
- **Steepness cap.** A skirt never rises more than 16 px of world height per px (`run ≥ |Height| × depth / 32`,
  through `u_h_amount` and `uDepth`): one-pixel cliffs aliased into dotted lips under a low light (32 began to
  stair-step under a 12° sun). The first cap, 4 px per px, overrode Ledge run below |Height| × depth / 8 — 25 px on a
  deep project — and switched Ledge steps off with it. (A smooth maximum at
  the crease was tried first: it raised a ridge k / 4 high along every ledge.)
- **Flakes.** _Flake levels_ (up to five) repeat the mesas at other scales, each _Flake scale_ times smaller than the
  one before — below 1, bigger: at 0.1 each level is ten times the last, broad plates and swells spanning many blocks.
  They are added at _Flake relief_ × (size ratio)^0.75 × Facet breakup's patches, fading as the faces dome and on pieces
  under ~5 px; levels under 2 px aren't evaluated at all (`nlev`, worked out on the CPU), so a small Flake scale costs
  nothing for the levels it pushes below a pixel. Their own _Flake ledge run_: large gives soft facets meeting in
  creases, small sharp flaky steps that cast thin shadows (crumpled, shingled rock); a level bigger than the blocks runs
  its ledges out in proportion, and has no hairline fractures or rubble (on plates many blocks wide, those drew long,
  sharp lines across the faces). Flakes differ more by tilt (1.4 ×) than by height (0.6 ×). _Facet breakup_ scales the flakes 0–2 in patches of a broad value noise about two blocks
  across: whole faces beside shattered ones. The grain and the pits follow the same patches by their own _Grain
  breakup_ and _Pit breakup_ (one noise, so crumbly patches are crumbly in every way).
- **Value.** `0.5 + 0.5 tanh(H)`. Rock wants deep relief: the editor's new layer has Height 40 at 512 px (scaled with
  the texture's mean side, 3–56).

### Facets and layers

- **Facets.** Up to three planes per block, each there by the _Facets_ chance, chip the face away beyond a line at a
  random angle — _Facet size_ sets where (from near the far edge to past the middle), _Facet slope_ how steeply it
  falls per block. The face is lowered by the deepest, so a block reads as a few planes meeting in straight ridges at
  any angle. Measured without the jaggies' warp: true planes, crisp ridges. In `rv_split`'s loop (no call site of
  their own).
- **Sheets** (_Layers_). The faces are stacked sheets: a second power diagram (_Sheets across a block_, laid in the
  blocks' sheared frame so on strata they stretch along the cleavage; whole sheets per block when tiling) whose cells
  each stand a whole number of _Layer thickness_ down — one of _Layers_ levels, picked by a smooth noise at the cell's
  site, so neighbouring cells share a level and join into broad plates, with the cell's own random mixed in by _Layer
  breakup_. Each sheet sits a little off its level (equal steps cast a plaid of equal bars) and tilts its own way
  (_Sheet tilt_), so steps fade along their borders and end. Their edges wander by _Layer waver_ (the jaggies' noise
  and a finer one; folding it into kinks broke the sheets into bubbly fragments). Where a sheet stands over the one
  next to it, its edge falls in a step whose whole rise is bevelled — over the Edge card's _Bevel_ in its _Profile_,
  else a chamfer about 0.3 × the rise (3 px at least) — never past a fifth of a sheet; the lower sheet runs flat to the
  border, so they meet there. The step looks at the four nearest sheets: with three, a fourth joining partway through
  a bevel made the surface jump. Sheets fade out under ~20 px. Not cut by level per pixel: slicing each block's depth at
  equal intervals drew contour rings on curved faces and grooves along the breakup cells.
- **Sheet curvature.** A minor option: each sheet dished into a cup rising to rims at its borders (or domed).
- **Rim steps.** A block's top face breaks back toward its edges in _Rim steps_ bevelled steps (_Rim step height_
  each; Layer thickness once, which hid it whenever Layers was 0), within _Rim width_ of the way from the edge to its site — so small blocks keep their tops (a fixed px width
  sank them whole: round pits) — each edge its own inset (some steps hug their edge, some reach deep; the lowest over the
  edges, so the steps run angular and open rather than as a shrunk copy of the outline), wavering along the edge by the
  jaggies' noise and one about a quarter of a block across, folded into kinks. At the border all are down, so a
  neighbour's face there is its plane less them all: its skirt still starts where its face ends. On a fused block
  they fall only toward a lower neighbour — a ledge — no deeper than about 0.8 of its height there (toward every edge
  they grooved each fused joint into a V): each part of the face takes its steps from its nearest edge alone, as deep
  as that edge's share (the height difference at the border point nearest the pixel, which both blocks work out
  alike, so the lower one's skirt still starts where the face ends), blended with the next nearest edge's where the
  two are about as near, so the steps run out at a ledge's ends. The mesa loop takes the own block first, so its
  face is known at every edge. (Tried first: the lowest inset over all edges, which let a joint with a deep inset
  cut into a ledge's band and out again in ribbons; a depth weighed by how near each edge is, which drew grooves; each
  edge's steps on their own with the deepest taken, which crossed one another in strips.) Merged masses have none.
  Their own section, _Rims_, with _Rim step height_ (once Layer thickness, hidden whenever Layers was 0).
- **Bevel.** The Edge card's _Bevel_ and _Profile_ shape every step on the face — the sheets', the rims', and the top of
  every ledge (its first Bevel px in the Profile, the same fall over them). The profile is sampled on the CPU (nine
  values, `d_prof`) and looked up, rather than inlining its branches at each call.

### Cracks

- The crease of the top two mesas is `(M₁ − M₂) / (σ₁ + σ₂)` px from the pixel (σ: their slopes, a skirt's `1 / run`, a
  chamfer's own): the border between equal blocks, the foot of a ledge. With _Open cracks_ (among the joints that aren't
  fused) it opens into a V of _Crack width_, each joint its own width (mostly narrow, a few wide), pinching and swelling
  along it with the jaggies' noise and opening into wedges where blocks meet three at a time (the own block's two nearest
  borders both near). Narrow cracks are shallower (× clamp(width / 4 px, 0.3, 1)); under a pixel a crack stays one pixel
  wide and fades with its width. Splits always open, at 0.7 × the width.
- _Fractures_: a share of the flakes' creases open as hairlines (0.3 × Crack width, at least 0.6 px), 0.15 × the crack
  depth — lines in the face, not trenches — fading in and out along them (_Fracture breakup_, on the blocks' noise: a
  flake's own broke them into dotted chains) and out on flakes under ~12 px (dotted speckle at 128 px).

### Surface

- _Surface grain_ / _Grain size_: Perlin fBm (the shared `roughnessParams`), scaled 0–2 by the broken patches with
  _Grain breakup_.
- _Pits_ / _Pit size_: Worley cells 2.4 pit radii across in three sizes (each half the last), a pit per cell with the
  chance (more in the broken patches, by _Pit breakup_), a bowl about as deep as wide in true px (through Height and depth). At 1 they
  crowd into a porous surface.

### Masks (Write to › Source)

| Source    | Writes                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| Blocks    | the visible blocks and pieces as features (their own random), parted at every crease and split (a shape)      |
| Plates    | each sheet of each block as a feature, parted at every step as well (a shape: bevels across the whole face)   |
| Crevices  | coverage: 1 in the creases and cracks (open joints full, closed 0.55, fused 0.2), fading over _Crevice reach_ |
| Fractures | coverage: the hairlines                                                                                       |
| Ledges    | coverage: the skirts hanging off taller blocks and flakes                                                     |

The hidden `mask_feat` picks what a pass writes (`sdfShowIf`: only Blocks and Plates are shapes, so the coverages never go
into Shape). No Output dropdown: the relief is the layer's one output.

### Cost

Cold D3D11 compile ~3.1–4 s (Stones: 3.2–4.7 s, measured the same day; the `RV_MERGE` variant ~5.7 s); 3.8 ms per layer at 2048² with the defaults (no flake levels; about 11 ms
with one, 20–40 ms with five; Stones 42 ms). One flat loop of 50 cells per scale, the scales in a loop bounded by the uniform Flake levels;
the sheets a flat loop of 25; no `continue` or `break`. The Edge card's profile is a nine-sample lookup (`d_prof`) and
each shared helper has one call site in the loop (the own face and the neighbours go through the same code).

## Recreations

Fifteen rock photos were recreated with Rock plus colour layers (noise limited to its masks, Edge wear): kept with the
references, the authoring script and the critiques in `private/recreations/rock2/` and `private/critic/rock2/` (gitignored;
see AGENTS.md). Reached well: angular blocks split by straight cracks, big slabs with straight fractures, flaky shingled
strata, crumpled pale and dark rock, boulders with moss in the crevices. Weaker: scooped sandstone (scoops but not their
overhanging, lit rims), porous rock (the pits are round bowls, real vugs are irregular and nested), and colour variety
(left to paint layers).

## Checklist

- [x] Power diagram in the cells' metric (elongation), sheared seamless frame on the CPU, steep angles swapped
- [x] Mesas with tilt, dip, offset dome / scoop; per-block edge drop (and fusing), pair-hashed widths
- [x] Fused clusters, splits (chained, kinked chords), angular rubble, flakes with their own ledge run, Facet breakup
- [x] Facets, stacked sheets (Layers), rim steps; the Edge card's Bevel on every step; Plates mask
- [x] Through joints removed: one straight crack across several faces (or across strata) doesn't happen in nature
- [x] Cracks at the crease (per-joint widths, pinch, junction wedges), hairline fractures with breakup
- [x] Grain, three-size pits in true px
- [x] Mask sources: Blocks, Crevices, Fractures, Ledges
- [x] Unit tests (frame snapping, seamless keys, mask writes, fresh defaults); D3D11 compile and render cost
- [x] Critic rounds and recreations (private)
