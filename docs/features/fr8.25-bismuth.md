# FR8.25 — Bismuth

A generator for bismuth crystals seen from above: stepped pyramids whose top faces sink inward in hopper terraces —
grown by rules, so they spiral, hook and dead-end as real hoppers do — and whose sides fall away in ledges, shingled
over one another with daughter crystals on their corners, or cubes standing on a corner as an isometric drawing shows them, three faces each sunk in its own
stair steps; all coloured by the iridescent film of oxide on them. Source: `src/layers/generators/bismuth.ts` (shader),
`bismuthGrowth.ts` (the rules, on the CPU). Presets: _Bismuth_ (project), _Hopper cube_ and _Bismuth cubes_ (layer).

## Grown faces (bismuthGrowth.ts)

Each face is grown on the CPU as one path through a grid of cells, 2 × **Terraces** across, a terrace wide — a
growing tree, as a hopper grows by its edges:

- A turtle starts on the rim heading along it. At each cell it takes one of the **three ways left to it**: on along
  its ring (straight is three times as likely), round the ring's corner, or off the ring (**Turns**: inward, or outward
  at a third of that — only in the inner rings, ramping in from halfway to 80 % of the way in, so the outer frames stay
  closed and the hooks gather round the hollow; a key that leaves its ring runs on straight two cells first). The rings are squares about a centre **Hollow offset** along a diagonal, so the terraces run
  wide on one side.
- Where it is boxed in, growth resumes from the newest cell with a way open — or, at **Branching**'s odds, from any
  earlier one — so a new facet branches off where two meet. Every cell is reached; the path is a tree.
- A **facet** is a straight run of the path. The level rises by one at every turn (not off a one-cell run, which stays
  with the facet before it: no nubs), so each facet stands at its own height and runs on until it turns or ends against a wall; the face sinks inward in stair steps, four to a lap.
  Neighbouring cells the path joins differ by at most one level.
- **Walls** stand between neighbouring cells the path doesn't join, and round the rim. A wall only ends where the path
  turns round it, so no step stops in mid-air.

`faceTexture` packs 16 such faces side by side in an RGBA8 texture (each cell's level as a share of its face's deepest,
16 bits; its east and north walls; the face's deepest level), memoised by the rules and the seed. Each crystal face
picks one by its hash.

## Shader

- **Layout.** One crystal per cell of a grid (**Crystals across**, whole counts when tiling), with **Size**, **Size
  variation**, **Scatter**, **Rotation** and **Rotation variation** (small by default: bismuth grown in one melt mostly
  lines up). **Generations** adds sizes: each has cells half the last's, grows a crystal in a share of them (**Small
  crystals**) and stands lower (**Small crystal height**).
- **Daughters.** A share of the large crystals (**Daughters**) grow daughters out of their corners, in front and a step
  taller: one on the tip corner — the one **Stack direction** points to — or a mirrored pair on the two beside it
  (**Pairs**), **Daughter size** of the crystal, **Daughter depth** deep along the same corner (the pixel follows the
  daughter on the corner nearest it, so it walks one chain). **Core** (off by default) stands smaller crystals up out of
  the middle, **Core stack** deep.
- **Two passes.** The first is one flat loop over the generations × the cells round the pixel × each crystal's chain
  (a uniform-bound count per generation, so D3D keeps it rolled: ~0.8 s cold, about Hammered's per-pixel cost). It
  computes only the outline, coverage and depth key of each crystal and keeps the front two. Larger generations are in
  front; then crystals further along the Stack direction (**Stacking**: they shingle one way, so most show two or three
  sides as chevrons), or else the taller; a daughter or core in front of its crystal. The second pass draws the facets of
  those two only, the front over the one behind by its coverage (its outer wall falls over 1.5 × Step softness).
- **Pyramid.** **Top face** is the share of the crystal's width that is its top — the hopper, its grown facets sinking
  by **Hopper depth** of the crystal's height. Outside it the sides fall to the base in **Side ledges** steps (by the
  distance to the outline: a square's four trapezoids, a ring round a cube's hexagon), one chunk of the crystal's colour.
  The relief has to be deep for the top and sides to read apart: the default Height › Amount is 12 (about 24 px at
  512 px). Top face 1 gives flat-topped blocks — the Hopper cube preset uses it, its three faces being top and sides.
- **Habit.** _Hopper squares_ are squares, one face each. _Cube corners_ are hexagons of three rhombic faces (right, top,
  left) that fall away from the corner by **Face slope**, each face its own grown template in its rhombus frame, their
  rims meeting along the cube's edges.
- **Facets.** The face's cell and the eight round it are fetched. The floor is the cell's height, stepping to a joined
  neighbour's over **Step softness** at the edge between them. The ribs are the walled edges and the posts at the
  corners where any wall meets (so walls join and a neighbour's wall ends square), **Rib width** of a cell, standing a
  little over the higher floor beside them — more round the rim (**Rim ridge**: a cube's three edges stand out).
  **Hopper depth** sets how far the facets sink.
- **Lean** tilts each crystal its own way. Height › Per-feature variation varies each crystal's height (`feat` is
  zeroed).

## Rims, keys and the crater (after critic rounds 7–9, against top-down photos and CG renders of bismuth)

- **Rim and keys.** The growth stamps bars over the terraces: the rim (**Rim width** cells round each top face) and
  **Keys** per face — each an open G drawn by construction: a stem in from the rim near a corner, an arm along, an arm
  back towards the rim stopping a gap short, and a curl inside; 0.6 of the rim's width, within 60 % of the half-width,
  redrawn if it would come within two cells of another key. Bars stand at the rim's height with risers on both sides,
  are shaded brightest and glossy (Roughness › Parts: bars at the left of the range), and keys are dropped on crystals
  under 3 px a cell, where they would float as glyphs.
- **Treads and grooves.** Between bars the terraces are solid treads separated by dark grooves (**Groove width**, at
  least 1.5 px), sunk below the lower tread. A cell's depth is 0.6 by its ring and 0.4 by its facet's level, so steps
  stay even (no single cliff over flat treads). **Turns** act only from 60 % of the way in.
- **Shade.** Band contrast lights the bars ×1.25, takes the treads down to half brightness at the floor and greys the
  deep treads and sides toward their luminance (`gGenGrey`), so vivid rims stand over quiet, still-lit hollows.
- **Overlaps.** A crystal in front covers one behind with its top face, but its side skirt only where it stands at
  least as high, so rims behind are never cut by the ledges of a lower crystal in front.
- **Defaults.** Top face 0.85 with 3 side ledges (at least 3 px a ledge), Hopper depth 0.65, 8 terraces, Rim width 2,
  Keys 1.2, Hollow offset 0.1; a vivid ramp with a long gold stretch, magenta, a short violet and blue, teal-mint. Cube
  habit links Top face 1 and depth 0.7.

## Outline, tilt and the photo look (critic rounds 10–12, calibrated to the owner's eye)

- **Outline** (its own section): **Corner rounding**; **Edge bevel**, a rounded chamfer down the whole outer wall; **Notches**,
  cells along each side notched at their own place and depth by hash (none at the ends or under 3 px) — a broad cut
  through the outline and a narrower part dropping the surface to the tier below; **Edge noise** (off by default), each
  side stepping in and out in square jogs a terrace long; **Grain**, fine height noise. The side ledges count in from the
  real outline, so notches and rounding carry into them; outlines grow a pixel to close hairline gaps. The Edge card's
  own bevel is hidden (it would scale the colour's ramp position).
- **Tilt and grading.** **Tread tilt** slopes each tread down towards the hollow (a sawtooth per ring) and domes the rim
  bars, so a hopper's four walls face the light differently and the metal shows it; **Terrace grading** narrows the
  rings near the rim. Hopper depth 0.85, Height › Amount 16.
- **Keys** are drawn by the shader on their own fine scale, not the terrace grid: a square spiral of bars winding out
  from near the hollow on a share of the faces (Keys 0.85, **Key size** 0.55 of the half-width ×0.6–1.3 per face, bars
  **Key width** 0.9 of a terrace, arms a bar apart, square ends), each lap a tier higher, domed, glossy and bright like
  the rim.
- **Scale and colour.** Crystals across 6, Rim width 1, Notches 0.25; hue by depth (Colour per terrace 0.18) and per facet
  (Terrace colours 0.3), little sweep (0.12); a light ramp; treads glossy (Roughness › Parts 0.15), bars 0.12, the ground
  rough and non-metal (Metalness › Parts); faint thin grooves (Groove width 0.08, none under 4 px a cell); Band contrast
  0.45 darkens and greys the deep treads. Crystals under 3 px a cell switch to plain terraces ≥ 3 px each.

## Tone and walls (critic rounds 13–15, calibrated)

- **Risers.** The walls between terraces are sloped risers down from the upper tread (**Riser width** 0.45 of a cell, at
  least 3 px), lit and keeping their colour; only the tread floors darken with depth (to 0.12 at the floor). The
  growth's walls carry no rim-like ribs or grooves any more.
- **Mirror facets.** One facet in six is glossy (Roughness › Parts with the bars and keys) and lit brighter across its
  whole area — broad flashes of colour; every facet also tilts its own small way. The per-ring nose glints were dropped
  (they drew pinstripes).
- **Tread tilt** is a smooth cone blended into the steps (no seams where it crosses a ring); Grain is off by default.
- **Defaults** after these rounds: Terraces 6, Hollow offset 0.3, Corner rounding 0.15, Notches 0.5, Band contrast 0.8,
  Rim width 1 (to 1.5); deep treads keep their chroma (greyed at most 0.2), darkened by shade instead.

## Outputs

- **Value** is the oxide's thickness, walked along the ramp and back (so any ramp stays seamless). The ramp's first stop
  is the bare ground; crystals walk the rest of it, from its second stop on. The thickness is **Colour offset**, plus each
  crystal's own place (**Colour per crystal**, over the whole cycle there and back, so the other shifts don't favour one
  end), its laps of facets (**Colour per terrace**, per four turns, may be negative), each top facet's own small random
  shift (**Terrace colours**, low by default so a crystal keeps one colour family; with Band contrast each facet is also
  a little lighter or darker), a linear **Colour sweep** across the crystal (in proportion to its size; **Sweep direction**),
  each daughter's and core's shift (**Sub-crystal colour**), each cube face's (**Colour per face**, right → top → left,
  blended across the edges between faces) and **Mottling**. The default ramp: dark bare metal, then gold, pink, violet,
  blue, cyan, mint and the second-order yellow, light and moderately saturated, as polished metal is.
- **Band contrast** shades the colour (`gGenShade`, a brightness the wrapper multiplies the Diffuse colour by) by each
  facet's depth, solid as the height map shows it — the ribs show in the relief only — without moving the hue.
- **Diffuse** blends the front and behind crystals' _colours_ where they meet in a pixel (`gGenAlt`; docs/architecture.md
  §5.2), not their ramp positions, which would flash the colours in between along every wall.
- **Height** (`hval`) is the crystal's own height. Metalness is on by default (the ramp is the reflectance) with low
  roughness; under a cool environment the warm colours reflect darker.
- **Ground** covers the space between crystals with the ramp's first stop at height 0; off, only the crystals cover
  (anti-aliased) and the layers below show through.
- **Mask**: the crystals' union goes to the mask it writes (opt-in, Mask › Write to), with each crystal's random.

## Defaults

At 512 px: 3 crystals across (size 1.05, scatter 0.75), stacking 0.7, daughters 0.8 (half of them pairs) × 2 deep,
3 generations, top face 0.55 with 5 side ledges, 10 terraces, hopper depth 0.35, turns 0.08, branching 0.02, height
amount 12 (crystals about 24 px tall). New layers are sized to the texture: 4–10 terraces, 1–3 generations, larger
crystals below 192 px, a lower height and gentler mottling on small textures.

## Checklist

- [x] Faces grown by rules on the CPU (bismuthGrowth.ts): rings, turns, branching, a level per facet, walls only where
      the path doesn't join (unit tested)
- [x] Square hoppers and isometric cube corners (three faces each grown), ribs with posts, rim ridge, eccentric rings
- [x] Daughters (tip or mirrored pair), cores, generations, stacking, depth order, lean; tileable
- [x] Thin-film colour on a back-and-forth ramp with the ground kept apart; band contrast (`gGenShade`); colour blended
      between crystals (`gGenAlt`)
- [x] Stepped-pyramid habit (top face, side ledges)
- [x] Mask of the crystals' union; presets; fifteen critic rounds (`private/critic/bismuth/`)
