# FR8.25 — Bismuth

A generator for bismuth hopper crystals seen from above: stepped square frames that sink in terraces to a hollow
centre, or cubes standing on a corner as an isometric drawing shows them, coloured by the iridescent film of oxide on
them. Source: `src/layers/generators/bismuth.ts`. Presets: _Bismuth_ (project), _Hopper cube_ and _Bismuth cubes_
(layer).

## Model

- **Layout.** One crystal per cell of a grid (**Crystals across**, whole counts when tiling), with **Size**, **Size
  variation**, **Scatter**, **Rotation** and **Rotation variation** (small by default: bismuth grown in one melt mostly
  lines up). **Generations** adds sizes: each has cells half the last's, grows a crystal in a share of them (**Small
  crystals**) and stands lower (**Small crystal height**). **Core** grows a smaller crystal at each one's centre, aligned
  with it and a step taller; **Core stack** repeats that inside the core. A pixel visits the generations × the cells
  round it × the crystal and its cores in one flat loop (a uniform-bound count, so D3D keeps it rolled: ~0.4 s cold).
- **Habit.** _Hopper squares_ are squares. _Cube corners_ are hexagons split into three rhombic faces (right, top,
  left) that fall away from the corner by **Face slope** — a cube on its corner, as an isometric drawing shows it.
- **Depth order.** Crystals are painted as an isometric drawing is: larger generations in front, then the taller
  crystal, each core in front of the crystal it grew in, each over what is behind it by its coverage (its outer wall
  falls over 1.5 × the Step softness). Height and colour both come from the front crystal blended into the one behind,
  so one crystal grows whole through another instead of the two cutting each other along their terraces.
- **Terraces.** On each face a hopper coordinate c runs from 0 at the hollow centre to 1 at the rim (Chebyshev distance
  in the face's frame) and is cut into N terraces, as many **Terrace width**s as fit — so smaller crystals have fewer.
  The outermost terrace is the rim; the others step down inwards by **Hopper depth**, each rising over **Step softness**
  (in px: its width in s follows s's rate across the face, ripples and spiral included) and carrying a **Lip** after its
  drop. **Rim ridge** puts a crest on the rim rising to its edge — a cube's three edges from its corner stand out as
  bright ridges. The step boundaries are s ∈ ℤ for s = c·N + ripples − arms·a:
  - **Terrace variation**: a monotone ripple in c·N, so terraces run broad and narrow.
  - **Corner jogs**: a ripple of each side's own (by the side the pixel is on, blended into the neighbouring side's over
    a pixel across the mitre), so the frames step at different places on each side and jog where they meet, like a maze.
  - **Spiral**: a (0 → 1 round the square) wraps by whole steps, so s stays continuous and the terraces wind into a
    square spiral staircase with that many arms. Jogs drown it; it reads best with Corner jogs low.
- **Lean** tilts each crystal its own way (added along a direction, so its terraces stay flat but catch the light
  differently). Height › Per-feature variation varies each crystal's height (`feat` is zeroed).

## Outputs

- **Value** is the oxide's thickness — **Colour offset**, plus each crystal's own place (**Colour per crystal**), the
  terraces (**Colour per terrace**, may be negative; **Terrace colours**: each terrace's own random shift, blended over
  its rise), a linear **Colour sweep** across the crystal (in proportion to its size; **Sweep direction**), each core's
  shift (**Core colour**), each cube face's (**Colour per face**, right → top → left, blended across the edges between
  faces) and **Mottling** — walked along the ramp and back (0 → 1 → 0), so any ramp stays seamless. The default ramp
  starts with bare metal (the ground) and runs through pastel thin-film colours: gold, rose, orchid, violet, blue, sky,
  mint.
- **Diffuse** blends the front and behind crystals' _colours_ where they meet in a pixel (`gGenAlt`, a second value the
  wrapper looks up and mixes; docs/architecture.md §5.2), not their ramp positions, which would flash the colours in
  between along every wall.
- **Height** (`hval`) is the crystal's own height. Metalness is on by default (the ramp is the reflectance) with low
  roughness.
- **Ground** covers the space between crystals with the ramp's start at height 0; off, only the crystals cover
  (anti-aliased) and the layers below show through.
- **Mask**: the crystals' union goes to the mask it writes (opt-in, Mask › Write to), with each crystal's random.

## Defaults

At 512 px: 3 crystals across, 3 generations, terraces 6 px, height amount 4 (crystals about 8 px tall). New layers are
sized to the texture: terraces about 1/85 of it (at least 2 px), 1–3 generations, a lower height and gentler mottling
on small textures.

## Checklist

- [x] Square hoppers and isometric cube corners, terraces, lips, rim ridge, jogs, spiral, cores
- [x] Generations, depth order, lean; tileable
- [x] Thin-film colour on a back-and-forth ramp; colour blended between crystals (`gGenAlt`)
- [x] Mask of the crystals' union; presets; three critic rounds (`private/critic/bismuth/`)
