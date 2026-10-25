# FR8.25 — Bismuth

A generator for bismuth crystals seen from above: hopper squares whose faces sink inward in stair-stepped terraces —
grown by rules, so they spiral, hook and dead-end as real hoppers do — shingled over one another with daughter crystals
on their corners, or cubes standing on a corner as an isometric drawing shows them, three faces each sunk in its own
stair steps; all coloured by the iridescent film of oxide on them. Source: `src/layers/generators/bismuth.ts` (shader),
`bismuthGrowth.ts` (the rules, on the CPU). Presets: _Bismuth_ (project), _Hopper cube_ and _Bismuth cubes_ (layer).

## Grown faces (bismuthGrowth.ts)

Each face is grown on the CPU as one path through a grid of cells, 2 × **Terraces** across, a terrace wide — a
growing tree, as a hopper grows by its edges:

- A turtle starts on the rim heading along it. At each cell it takes one of the **three ways left to it**: on along
  its ring (straight is three times as likely), round the ring's corner, or off the ring (**Turns**: inward, or outward
  at a third of that). The rings are squares about a centre **Hollow offset** along a diagonal, so the terraces run
  wide on one side.
- Where it is boxed in, growth resumes from the newest cell with a way open — or, at **Branching**'s odds, from any
  earlier one — so a new facet branches off where two meet. Every cell is reached; the path is a tree.
- A **facet** is a straight run of the path. The level rises by one at every turn, so each facet stands at its own
  height and runs on until it turns or ends against a wall; the face sinks inward in stair steps, four to a lap.
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

## Outputs

- **Value** is the oxide's thickness, walked along the ramp and back (so any ramp stays seamless). The ramp's first stop
  is the bare ground; crystals walk the rest of it, from its second stop on. The thickness is **Colour offset**, plus each
  crystal's own place (**Colour per crystal**, over the whole cycle there and back, so the other shifts don't favour one
  end), its laps of facets (**Colour per terrace**, per four turns, may be negative), each facet's own random shift
  (**Terrace colours**), a linear **Colour sweep** across the crystal (in proportion to its size; **Sweep direction**),
  each daughter's and core's shift (**Sub-crystal colour**), each cube face's (**Colour per face**, right → top → left,
  blended across the edges between faces) and **Mottling**. The default ramp: dark bare metal, then fiery gold, pink,
  violet, blue, cyan, mint and the second-order yellow.
- **Band contrast** shades the colour (`gGenShade`, a brightness the wrapper multiplies the Diffuse colour by): dark
  floors, bright ribs, darker down the hopper — without moving the hue.
- **Diffuse** blends the front and behind crystals' _colours_ where they meet in a pixel (`gGenAlt`; docs/architecture.md
  §5.2), not their ramp positions, which would flash the colours in between along every wall.
- **Height** (`hval`) is the crystal's own height. Metalness is on by default (the ramp is the reflectance) with low
  roughness; under a cool environment the warm colours reflect darker.
- **Ground** covers the space between crystals with the ramp's first stop at height 0; off, only the crystals cover
  (anti-aliased) and the layers below show through.
- **Mask**: the crystals' union goes to the mask it writes (opt-in, Mask › Write to), with each crystal's random.

## Defaults

At 512 px: 3 crystals across (size 1.05, scatter 0.75), stacking 0.7, daughters 0.8 (half of them pairs) × 2 deep,
3 generations, 10 terraces, turns 0.03, branching 0.02, height amount 4 (crystals about 8 px tall). New layers are sized
to the texture: 4–10 terraces, 1–3 generations, a lower height and gentler mottling on small textures.

## Checklist

- [x] Faces grown by rules on the CPU (bismuthGrowth.ts): rings, turns, branching, a level per facet, walls only where
      the path doesn't join (unit tested)
- [x] Square hoppers and isometric cube corners (three faces each grown), ribs with posts, rim ridge, eccentric rings
- [x] Daughters (tip or mirrored pair), cores, generations, stacking, depth order, lean; tileable
- [x] Thin-film colour on a back-and-forth ramp with the ground kept apart; band contrast (`gGenShade`); colour blended
      between crystals (`gGenAlt`)
- [x] Mask of the crystals' union; presets; five critic rounds (`private/critic/bismuth/`)
