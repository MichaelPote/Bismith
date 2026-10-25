# FR8.25 — Bismuth

A generator for bismuth crystals seen from above: hopper squares that sink in whorled, meandering terraces to a hollow
centre, with smaller crystals stepping down from their corners like ziggurats — or cubes standing on a corner as an
isometric drawing shows them — coloured by the iridescent film of oxide on them. Source:
`src/layers/generators/bismuth.ts`. Presets: _Bismuth_ (project), _Hopper cube_ and _Bismuth cubes_ (layer).

## Model

- **Layout.** One crystal per cell of a grid (**Crystals across**, whole counts when tiling), with **Size**, **Size
  variation**, **Scatter**, **Rotation** and **Rotation variation** (small by default: bismuth grown in one melt mostly
  lines up). **Generations** adds sizes: each has cells half the last's, grows a crystal in a share of them (**Small
  crystals**) and stands lower (**Small crystal height**).
- **Sub-crystals.** **Core** grows a smaller crystal at each one's centre, aligned with it and a step taller; **Core
  stack** repeats that inside the core. **Corner crystals** grows smaller ones out of a large crystal's corners, a step
  lower and behind it, so its outline steps down like a ziggurat; **Corner depth** repeats that, each from the corner of
  the last nearest the pixel (so a pixel follows one chain, not a tree), in spikes along the diagonals. Only the largest
  generation grows them: on small crystals they turn to grit. A pixel visits the generations × the cells round it × the
  crystal, its cores and its corner chain in one flat loop (a uniform-bound count, so D3D keeps it rolled: ~0.8 s cold,
  about Hammered's per-pixel cost).
- **Habit.** _Hopper squares_ are squares. _Cube corners_ are hexagons split into three rhombic faces (right, top,
  left) that fall away from the corner by **Face slope** — a cube on its corner, as an isometric drawing shows it; their
  corner crystals grow from the hexagon's points.
- **Depth order.** Crystals are painted as an isometric drawing is: larger generations in front, then the taller
  crystal, cores in front of and corner crystals behind the crystal they grew from, each over what is behind it by its
  coverage (its outer wall falls over 1.5 × the Step softness). Height and colour both come from the front crystal
  blended into the one behind, so one crystal grows whole through another instead of the two cutting each other along
  their terraces.
- **Terraces.** On each face a hopper coordinate c runs from 0 at the hollow centre to 1 at the rim (Chebyshev distance
  in the face's frame) and is cut into N terraces, as many **Terrace width**s as fit — so smaller crystals have fewer.
  The outermost terrace is the rim; the others step down inwards by **Hopper depth**, each rising over **Step softness**
  (in px: its width in s follows s's rate across the face, ripples and spiral included) with a **Lip** after its drop.
  **Rim ridge** puts a crest on the rim rising to its edge — a cube's three edges from its corner stand out as bright
  ridges. The ring boundaries are s ∈ ℤ for s = c·N + ripples − arms·a:
  - **Terrace variation**: a monotone ripple in c·N, so terraces run broad and narrow.
  - **Corner jogs**: a ripple of each side's own (by the side the pixel is on, blended into the neighbouring side's over
    a pixel across the mitre), so the frames step at different places on each side and jog where they meet.
  - **Spiral**: a (0 → 1 round the square) wraps by whole steps, so s stays continuous and the terraces wind into a
    square spiral staircase with that many arms — the whorls at a crystal's centre (1 by default).
- **Meander.** The rings are cut along each side into cells **Meander length** terraces long (each ring's cells set off
  by a phase of their own), and a share of them (**Meander**) turn a step in or out: a hook where a terrace runs into the
  next ring out, a dead end where the ring in runs on — the Greek-key look. The shader blends the rings below, at and
  above the pixel's, on its side and across the mitre, each cell into its nearer neighbour over a softness; the lip
  rises only where a step drops.
- **Lean** tilts each crystal its own way (added along a direction, so its terraces stay flat but catch the light
  differently). Height › Per-feature variation varies each crystal's height (`feat` is zeroed).

## Outputs

- **Value** is the oxide's thickness, walked along the ramp and back (so any ramp stays seamless). The ramp's first stop
  is the bare ground; crystals walk the rest of it, from its second stop on, so no crystal colour mixes with the ground's.
  The thickness is **Colour offset**, plus each crystal's own place (**Colour per crystal**, over the whole cycle there
  and back, so the other shifts don't favour one end of the ramp), the terraces (**Colour per terrace**, may be
  negative; **Terrace colours**: each terrace's own random shift, blended over its rise), a linear **Colour sweep**
  across the crystal (in proportion to its size; **Sweep direction**), each core's and corner crystal's shift
  (**Sub-crystal colour**), each cube face's (**Colour per face**, right → top → left, blended across the edges between
  faces) and **Mottling**. The default ramp: dark bare metal, then fiery gold, pink, violet, blue, cyan, mint and the
  second-order yellow, bright and moderately saturated.
- **Band contrast** shades the colour (`gGenShade`, a brightness the wrapper multiplies the Diffuse colour by): each
  terrace darkens towards the foot of the step above it and brightens along its lip, and the hollows go darker — the
  light/dark structure of bright lips over dark recesses, without moving the hue.
- **Diffuse** blends the front and behind crystals' _colours_ where they meet in a pixel (`gGenAlt`; docs/architecture.md
  §5.2), not their ramp positions, which would flash the colours in between along every wall.
- **Height** (`hval`) is the crystal's own height. Metalness is on by default (the ramp is the reflectance) with low
  roughness; under a cool environment the warm colours reflect darker.
- **Ground** covers the space between crystals with the ramp's first stop at height 0; off, only the crystals cover
  (anti-aliased) and the layers below show through.
- **Mask**: the crystals' union goes to the mask it writes (opt-in, Mask › Write to), with each crystal's random.

## Defaults

At 512 px: 3 crystals across (size 1.05, scatter 0.75), corner crystals 0.45 × 2, 3 generations, terraces 6 px,
spiral 1, meander 0.35, height amount 4 (crystals about 8 px tall). New layers are sized to the texture: terraces about
1/85 of it (at least 2 px), 1–3 generations, a lower height and gentler mottling on small textures.

## Checklist

- [x] Square hoppers and isometric cube corners, terraces, lips, rim ridge, jogs, spiral, meander
- [x] Cores and corner crystals (ziggurat outlines), generations, depth order, lean; tileable
- [x] Thin-film colour on a back-and-forth ramp with the ground kept apart; band contrast (`gGenShade`); colour blended
      between crystals (`gGenAlt`)
- [x] Mask of the crystals' union; presets; four critic rounds (`private/critic/bismuth/`)
