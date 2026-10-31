# FR8.17 — Cracks (was Chips & splits), plank-end wobble, soft rings

**Status:** done

## Goal

Worn, hand-painted wood: boards whose ends are sawn a little crooked, chipped at the corners and split along the grain
from the ends inward; slabs crazed with long cracks, short breaks across the grain and the stepped ends of fibre
strips. The damage had to be reusable — the same chips knock the corners off stone setts or panels — so it is a
generator of its own that works on a **mask** (the Shape mask by default), not a feature of the wood.

## Cracks (`chips`, `generators/chips.ts`)

Named _Chips & splits_ until the follow-up below; the type id stays `chips`, so saved projects load. An SDF generator,
listed with the filters in the add menu (category `filter`: it damages what the layers before it drew), that reads the
mask before it (`readsMask`: its _Write to_ mask, or Shape when it writes none) and takes damage out of it. With
nothing in the mask the whole texture counts as one piece (only the splits in the open and the nicks apply).
**Material** picks the damage: **Stone** (default; _Stone_, further down — breaks, flake scars, cracks, faults) or
**Wood** (below — chips, splits, nicks); each shows only its own controls.

- **Chips** — one spot per cell of 2.5 chip sizes; a spot within a chip size of the edge moves onto it along the
  field's normal (central differences on the mask), and an angular flake is cut around it: five half-planes at
  uneven angles, stretched along the edge, clipped to the spot's side of the edge so a chip never reaches across a gap
  into the neighbouring piece. _Corner chips_ adds chance where the distance bends beside the spot (0 on a straight edge,
  ~0.4 at a right angle). _Chip depth_ < 1 leaves a shallow flake with a floor.
- **Splits** — lanes across the grain (_Split spacing_), one spot per lane cell (_Split length_). A spot whose nearest edge crosses
  the grain (normal within ~40° of it: board ends) starts a split where that edge crosses the lane, flared where it
  opens and running inward, thin, narrowing late; a spot inside, away from such edges, may hold a split in the open
  (_Splits in the open_), tapered at both ends. Splits run straight between knots ~0.4 lengths apart with a gentle deflection (_Split wobble_) at
  each — wood splits along straight lines. **Split merging**: a split from an edge may veer gently into the split in the next
  lane and end on it — only when that split really is there where this one ends (its cell is evaluated, mask and
  all) and runs within 0.8 lanes — so two splits join into one (a Y) instead of crossing.
- **Nicks** — short cracks across the grain inside the shape, zigzagging a little (_Nick length_, _Nick width_).
- **Length variation** — how much shorter than _Split length_ (or _Nick length_) each may be: 0 all full length, 1 anywhere from
  nothing to full; 0.55 by default (45–100 %, the spread before it had a control).
- **Width variation** — each split's and nick's width varies around _Split width_ (_Nick width_) by up to this share: 0 all the
  same, 0.3 (default) 0.7–1.3× — the spread before it had a control — 1 anywhere from a hairline to twice as wide.
- **Split bevel** — a rounded shoulder either side of each split and nick, narrowing with the crack (√ of its taper)
  so tips stay sharp, shaped by the layer's Profile (Flat counts as Linear): 0 a hard crack, more a soft groove. In
  Carve the removal is the larger of the crack's thin-line coverage and the shoulder; in Chipped shape the distance
  from the crack's side is scaled by `bevel / split bevel`, so the layer's bevel spans the Split bevel there (before,
  split shoulders were as wide as the shape's own bevel).

Every feature is a cut `c` (px, > 0 inside it) and a depth `f`. **Operate on** (`output`; was _Output_, whose
"Carve what is below" / "Chipped shape (SDF)" read as two kinds of result rather than two things to act on) — both
write the chipped shape to the mask in _Write to_ (Shape by default):

- **Height below (carve it)** (`carve`, default) — value = how deep to carve (0 untouched … 1 cut down to the shape's
  edge level), covering only the damage, inside the original shape. Height › Subtract carves it out of whatever relief
  is below; Diffuse › Multiply darkens it. Chip walls follow the layer's Bevel / Profile; splits and nicks use thin-line coverage (a pixel
  box filter, ≤ the width when under a pixel) so hairlines fade instead of flickering. Uses `genOutOwn`.
- **Shape mask (redraw it chipped)** (`shape`) — the mask minus the cuts; a part-depth cut sinks `(1 − f) × bevel` instead of reaching
  the edge, so the bevel gives it a floor. Drawn with the layer's bevel, the bevel wraps round each split: board ends
  break into rounded fingers.

A layer can have only one bevel, so a wide pillow bevel for the boards turns hairline cracks into dimples. Use a
_Chipped shape_ layer for the chips and end splits and a second _Carve_ layer (narrow bevel) for fine cracks and nicks.

Defaults follow the output (`linkedDefaults`): Carve — Height subtract × 0.5 (a shape layer's usual height), Diffuse
multiply (white → dark); Chipped shape — Height add 0.4, Diffuse off.

Cost: three flat loops with uniform-derived bounds (9 chip cells, 15 split cells, 9 nick cells); the neighbour
split for a merge is evaluated only when the pixel lies on a merging split. Cold compile on D3D11 (RTX 5080):
**1.8 s** (1.6 s before the Split bevel and Length variation).

### Following the shape (round 2)

- **Split starts** were found by dividing the distance at a split's spot by the edge normal's grain component. On a
  wobbly end the normal tilts, the division overshoots, and splits started tens of px off the edge — inside the next
  board. They now step along the grain by the distance (sphere tracing on the mask, ≤ 8 fetches) until on the edge,
  so they open exactly where the (wobbly, chipped) end is.
- **Carve eats the bevel**: the carve value is the bevel on the original less the bevel on the chipped shape
  (`bevelAt(reg) · coverage(reg) − bevelAt(d') · coverage(d')`; until the follow-up below, their ratio for Height ›
  Multiply) with this layer's Bevel / Profile / aspect — give it those of the layer that drew the relief, and Height ›
  Amount its height, and Height › Subtract leaves that relief exactly, its bevel following every
  chip and split (before, chip walls had their own profile and the plank bevel ran straight past them). Splits' and
  nicks' distances are scaled so the bevel spans the Split bevel (narrowing with the crack); hairlines keep their
  thin-line coverage. The chipped shape also goes to the mask it writes, as before, for later limits.
- **Bevel aspect** (Shaping › Edge, every SDF layer): left / right bevels Bevel / √aspect, top / bottom Bevel · √aspect —
  the two trade around Bevel (their geometric mean), so both axes move; an edge at an angle gets the stretched width
  across it, √((nx·Wx)² + (ny·Wy)²). The wrapper takes the
  combined distance and its screen-space gradient before branching (`bevelAt(d, grad)`, `GLSL_BEVEL`); a generator
  can give an exact bevel distance (`GenOut.bdist`) — Wood's boxes in a stretched space, so a wide end bevel meets the
  side bevel in a clean crease instead of a step along the 45° diagonal. Wood's grain now reaches the wrapper through
  `genOutShaded`, which applies the bevel (with aspect, and the combined shape for the other mask modes).

### Stone (Material › Stone)

Weathered stone — big broken edges and corners, flakes spalled off in terraces, deep cracks and faults — compiled as a
shader variant of its own (`shaderFeatures` → `CH_STONE`; `material` is `uniform: false`): a Wood layer leaves the
Stone code out and the other way round (cold compile on D3D11: Wood 1.2 s as before, Stone 1.85 s; one shader with
both was 3.2 s). Wood renders are bit-identical to before.

The partitions are jagged Worley cells (borders bent by one smooth octave of warp, so they never crenellate or fold
into islands). Every pixel of a cell judges it — broken or not, its face plane — at the same screen point (the offset
to the cell's point includes the warp; without it a cell broke for some of its pixels and not others: walls, combs and
pits). Each pass returns the pixel's cell and the cells across its two nearest borders; their surfaces blend
three ways over a 1.5 px band (each neighbour weighing 1 on its border, 0 a band in), so steps are crisp but
anti-aliased and nothing jumps where the nearest border changes near a three-cell corner.

- **Breaks** (_Chips_ card: Breaks, Corner breaks, Edge wear, Break size, Break roughness, Break face drop, Break rim
  drop, Break depth). A cell whose
  point lies within about half a cell of the mask's edge breaks off by the _Breaks_ chance, more where the edge turns a
  corner. A broken chunk drops at its rim by _Break rim drop_ × _Break depth_ (a crisp scarp), then is a true plane sloping, along
  the mask's outward normal at the cell's point, to _Break face drop_ × _Break depth_ below the top at the edge — a lit chip below
  the top, not a hole — leaning a little its own way. Right at a corner (the pixel's own corner measure, by central
  differences on the mask — dFdx would step it per 2 × 2 pixels) it falls up to 1.8× as far and bites the outline. Where it meets an intact cell the face rises to its rim within half a cell, so
  that border steps by the Break rim drop only. _Edge wear_: a second partition at a quarter of the Break size, its chips
  0.3–0.8 × half as deep, along every edge, so the edges between the big breaks wear too. _Break roughness_ bends the rims
  with smooth noise. Breaks are cuts: in Carve their surface goes in as a distance the bevel reads back (`−Bevel ×
  height`), so give this layer the Bevel of the layer that drew the relief, as for Wood.
- **Flake scars** (Flake scars, Scars from edges, Scar size, Scar depth, Scar stretch, Small scars, Scar raggedness) — as
  Stone blocks pitches its faces (docs/features/fr8.22-stone-blocks.md): each scar a hollow below the surface, 0 at
  its rim, the lowest winning, so rims meet in crisp ridges and the face between them stays whole. A scar is a tilted
  plane, deepest at its struck end and running out at a grazing angle at the other, walled in by the bowl `d⁸ − 1`
  (Stone blocks' `d⁴` read soft at the shallower depth a share of a shape's height gives). _Scars from edges_ of them are
  struck from the mask's nearest edge (its outward normal at the scar's site: the struck end at the edge, the scar
  running inward, wider along the edge than inward up to 2.4×); one whose struck end falls short of the edge fades out,
  so a big piece keeps its face in the middle. Two sizes in one flat loop of 2 × 16 cells (_Small scars_ at 0.42×), the
  field warped by noise half a scar across (_Scar raggedness_). Each piece of the mask (its feature random, `fid`) reads
  the field at an offset of its own and keeps only scars whose site lies on it, so scars never run across a joint. They
  sink the surface by up to _Scar depth_ × the height in Height's value only (`GenOut.hval`): Diffuse › Multiply
  darkens the breaks and cracks and leaves the scars to the light. (They replaced nested Worley spalls in terraces,
  whose polygonal plates read as camouflage on bricks.)
- **Cracks** (Cracks, Crack length, Crack width, Crack depth, Crack wander, Crack jaggedness, Crack branching, Crack
  side drop, Crack bevel). One spot per cell of about the
  _Crack length_; a spot near the mask's edge moves onto it and a crack meanders in: a path of 12 segments, each heading
  along the base direction (inward, ± a little) bent by a slow meander — 1D value noise along the path, about a wave
  per four segments, up to ±0.9 rad (_Crack wander_) — and a light finer octave (_Crack jaggedness_). Headings are absolute around the
  base, not a random walk, so a crack wanders without curling back; capped, so it never doubles into a V. It tapers
  from the _Crack width_ to its tip, where under a pixel wide it fades in depth instead of breaking into dashes. By the
  _Crack branching_ chance a fork leaves a third to half of the way along (and, less often, a second further on), 0.5–0.9 rad
  to one side, meandering on its own (±0.55 rad, so it doesn't hook back into its parent) and tapering from the path's
  width there. One side sits lower by the _Crack side drop_; cracks fade where a break lowered the surface, so they end at its
  rim. (The first version — four straight segments with kinks — read as stiff twigs.)
- **Faults** (Faults, Fault length, Fault drop, Fault slab width). From the same edge spots: a jagged line running in from the edge, and the
  slab between it and the edge — on the side the fault leans towards — drops by its own _Fault drop_ (0.6–1.4×), deepest at
  the edge: a triangle bounded by the fault, a jagged line converging on its tip from _Fault slab width_ along the edge, and the
  edge, with crisp risers and no groove.

Breaks and cracks are cuts, so they work in both _Operate on_ modes; flake scars and faults sink the surface, which only
_Height below_ can carry (a shape mask holds a shape, not heights). In _Shape mask_ mode the chipped shape builds the
relief itself, so turn the height of the layer that drew the shape off. Sizes follow the texture for new layers
(`fresh`, k = side / 256, at least ¼): Break size, Scar size, Crack length, Fault length and Fault slab width ×k, Crack
width and Crack bevel ×√k. Each helper sits at one call site (D3D inlines every call): all partitions run in one loop, the cells round
a border are judged by one function (`ch_cell`), and cracks and faults share one loop and one `ch_crack`.

Built in six rounds against two sculpted-stone references with an adversarial critic (docs/generator-critic.md;
critiques and the hand-over in the private critic folder). The first try — fBm bites eating the edge, plates as one
Worley mosaic, cracks along every plate border — read as rotten edges, camouflage and dried mud (4/10); what replaced
it: chunks as planar faces under a crisp scarp that stay lit below the top, nested feathered spalls at the edges,
cracks as lines running in from the edges, faults as dropped slabs.

### Follow-up: Cracks

- Renamed _Chips & splits_ → **Cracks**, and the old Cracks generator (`cracks`, the crack network) → **Cracked crust**.
  Type ids are unchanged.
- **Stone** is the default Material (a layer without the key is Stone too); the Wood smart material's layer sets Wood.
- Moved to the **filters** in the add menu (`category: 'filter'`; still an SDF generator, so _Write to_ defaults to
  Shape as before).
- **Carve subtracts**: the value is the depth to carve (see Operate on), for Height › Subtract × 0.5, so the damage cuts
  into the shape layer before it by that layer's height instead of scaling whatever relief is below. A shape below with a
  wider bevel than this layer's is cut below its floor near the edge; match the Bevel.
- **Flake scars** from Stone blocks replaced the terraced spalls (Flakes, above). Cold compile on D3D11 (Stone): 1.3 s.

## `genOutOwn`

`GenOut` gained `own`: an SDF generator that paints its own value and coverage but still has a shape. The wrapper
writes the distance to the mask in _Write to_ (by the Mode) and leaves value and coverage alone. Wood's `wood`
output now uses it, so a single Wood layer puts its plank outline in the Shape mask for Chips & splits and limits
(`sdfShowIf` hides the shape params for Grain only and for one slab, which have no outline).

## Wood

- **End wobble** (`end_wobble` px, `end_wobble_px` bend spacing): board ends — the cuts across the grain — wander. Per
  plank column, the nearest joint's offset (1D noise across the plank, keyed by column and joint) shifts the along
  coordinate before the box test, so only the ends bend; both boards at a joint share the line (the gap keeps its
  width) plus a quarter of each side's own. The grain doesn't move. Off by default.
- **Grain softness** (`grain_soft`, Grain card): what read as harsh "rings" in Height were mostly the fine streaks — a
  steep smoothstep of three octaves of stretched value noise, the top octave near the pixel — plus each ring stopping
  at a hard edge (`fract` wrapping), a little cliff that aliased. Grain softness damps the top octave (gain 0.5 → 0.2) and
  widens the streaks' smoothstep; a ring's end is softened over `max(softness / 2, one pixel)` of a ring centred on
  the boundary (the end of the previous ring spills into the next) and its darkening widens to at least half a ring.
  At 0 ring edges get one pixel of anti-aliasing (hard with Anti-alias off, for pixel art). Default 0.4 (the Wood smart
  material 0.3).

- **Grain depth** (`grain_depth`, Grain card): the grain's dark parts sank as low as the gaps in Height. Now the plank
  surface in Height is `(1 − depth) + depth × grain`, times the edge profile: 0 a smooth full-height board, 1 as
  before; the gaps and bevels always span the layer's full height, and colour keeps the full grain. It rides in
  `GenOut.hval`, a separate value for Height › Pattern (shaped like the value; negative = the value). Default 0.35.
- **Gap X · Y** (`gap`, new `gap_y`): screen-axis gap widths — X the up-and-down gaps, Y the ones across — so side gaps
  and end joints can differ (which is which follows the direction). `migrate` copies a single `gap` (older files,
  recipes and templates that set only it) to `gap_y`.

### Quality pass

- **Editor defaults that follow the texture** (`fresh`): with k = max(1, mean side / 128), gaps round(√k) px, bevel
  max(1, round(2.2·k^0.75 − 1.2)), grain spacing 2·k^0.35, ring spacing 4·√k, knot size 3·k^0.95, end wobble spacing 32·√k,
  Rings 0.6 → 0.8 and Fine grain 0.6 → 0.45 between 128 and 512 px — the plain defaults up to 128 px (pixel art); at
  512 px 2 px gaps, a 5 px bevel, 8 px rings and ~11 px knots, which read on 128 px boards instead of hairlines and
  pinholes, and fewer streaks drowning the figure. Plain defaults: Cathedral figure, Ring variation 0.5, Earlywood
  fade 0.6, Grain bunching 0.6, Board variation 0.6, Crown 0.25, End fit 0.1, Grain softness 0.4, Grain depth 0.35, a smooth
  profile and Height › Per-feature variation 0.25.
- **Ranges**: Gap slider to 8 px, Grain spacing to 64 (slider 16), Ring spacing to 256 (slider 32), Arch length to 64
  (slider 16), Knot size to 128 (slider 32), Knots to 4.
- **Figure** (`cut`): _Cathedral arches_ or _Ovals_. Cathedral: rings are cylinders round a heart running along the
  board at depth D, ρ = √(dx² + D²); a ring shows where D < ρ and its two lines meet in an arch tip where D = ρ. On
  boards with end joints D grows along the board (1 / Arch length, a random direction) with two broad swells, so the
  arches nest, point one way and stay open; full-length boards repeat along the texture, so D rises and falls once
  (with a swell at twice that). A heart board's heart stays within 0.3 of its width of the middle, so its tips are on
  the board. The ring wobble is sampled at an offset per board, so the figure doesn't carry on across an end joint. One
  slab gets a heart of its own: its across distance wrapped (the far side mirrors, as in a book-matched slab), wandering
  0.12 + 0.05 of the width sideways along the texture (two harmonics), D rising and falling along it, scaled by Arches
  (0 straight lines, 1 twice a board's rise). _Ovals_: rings closed round a point once per board; with no planks, lines
  folded by a broad wobble — gentle waves up to Arches 0.5, then steeply stronger (0.25·f → 0.125 + 1.75·(f − 0.5) of
  the width) while the fold's finer octaves fade (gain 0.5 → 0.1), the fine streaks following the extra fold.
- **Rings**: each ring its own latewood width (0.4…1.6×) and darkness (0.25…1); its dark part fades in from deep in the
  earlywood (_Earlywood fade_: up to 0.8 × the earlywood earlier) along a convex ramp (exponent 1 + 2·fade) to a sharp
  outer edge. Where the face runs nearly along a ring (arch tips, oval centres) the latewood width and soft edge are
  capped at 1.5× their usual px width, so tips stay lines. _Ring variation_: r through a smooth monotonic remap —
  noise over 2.5 rings (0.45 spacings) plus one over 9 (3.5 spacings), slope ≤ 0.85, periodic round a tiled slab — so
  widths run about 3:1 and tight years cluster in bands. Height takes the rings with their sharp edge eased over ≥ 2 px,
  so a lit render doesn't stair-step along sloping rings.
- **Fine grain**: billowed value noise (`|2n − 1|`, gain 0.55) whose low values are the streaks — thin wavy pore lines
  where the noise crosses its mean; Grain softness widens their rounded profile rather than blurring the field; they fade by
  0.6 × Rings in each ring's latewood, so they band with the rings. No octave finer than ~2.5 px across (a finer
  octave's creases alias into a grid of dots); anti-aliased over at least the noise's typical slope per px (a billowed
  noise's own derivative vanishes at its crease and is one per 2×2 pixels). Each streak its own width (±60 %) and
  darkness (0.4…1) from a noise at ~1.7 grain spacings; a slow noise over 5 spacings thickens and darkens them in some
  bands; _Grain bunching_ runs their across coordinate through a monotonic remap (noise over 6.4 spacings, slope ≤
  0.75), so tight streaks bunch with sparser stretches between. On a Cathedral figure the across coordinate is the
  ring field itself, so the streaks run in the rings' flow; its gradient, worked out exactly (across `dx/ρ`, along
  `(dx·dx′ + D·D′)/ρ`) rather than from screen derivatives (2 px blocks), fades them where |∇ρ| < 0.75 (they would
  widen and smear) and to 35 % where the flow runs steeply across the board.
- **Knots**: up to 4 per board — up to 1 the chance of one, above that many on average (knot s is there when its random
  is below Knots − s); further knots are spread along the board, and on boards with ends they keep off the last eighth
  at either end. Each has a smooth, slightly lumpy oval rim (2θ, 3θ harmonics), and its own eye size (0.1…0.4), 1.5…4.5
  rings with their own contrast, rim darkness and tone; short dark tails run along the grain. The grain parts round a
  cylinder 1.2× the knot, its bend windowed over 2.5…5 radii with a wake twice as long on a random downstream side. In
  Height its rings show (12 %), and it either stands proud (a dome) or has a sunken core, with a shallow groove at the
  rim.
- **Board variation** (`board_var`): per board, the streaks' contrast (±150 %) and density (threshold ±0.3), ring spacing
  (±50 %) and, on boards with end joints, a slight slant of the grain (measured from the board's middle). A broad soft
  tone per board (the ring wobble's noise) goes to colour only.
- **Crown** (`crown`, −1…1, Height only): domed boards sink at their edges by this share, cupped ones in the middle.
- **End fit** (`end_var`): how much each side of a joint wanders on its own.
- The full-length-board case no longer skips two of the three boxes with `continue` (ANGLE can miscompile it): the
  three boxes are the same and the first stays the nearest. Cold D3D11 compile 1.75 s.

- **Source › Shape** (every generator output): with Roughness › Pattern, Wood's roughness followed the full-contrast
  grain, so every dark grain line was near-mirror and the rest matte — pinpoint glints in the troughs, and raising
  roughness only dulled it. _Shape_ is the inside of the layer's own shape (the distance the wrapper combines, before
  the mask write: `coverage(d)`; for `sdf: 'mask'` layers `clamp(0.5 − d)`; 1 for layers without a shape), so At 0
  sets the gaps and At 1 the boards and the grain is ignored. On a project with a 4.9 key light, Roughness › Shape at
  0.9 (gaps) / 0.35 (boards) gives the broad sheen along the grain ridges that the hand-painted reference has. (A
  "highlight hold" that keeps rough highlights bright was considered and left out: the dullness came from the
  roughness mapping, and holding peaks would brighten every matte surface.)
- **Shape by default for new shape layers**: a shape layer (`sdf: true`) added in the editor starts with Roughness and
  Specular on _Shape_ (`freshParams` in `layers/registry.ts`, before the type's own `fresh`) — on a shape, Pattern is
  the bevel's ramp (and Wood's grain), which nobody expects a roughness to follow. Noise-type layers keep Pattern (their
  pattern is the point; Shape would be 1 everywhere), as do mask-only shapes (Drips), layers built in code (recipes,
  templates, presets) and stored projects.

## Wood smart material

New _Wear_ group: **Chips** and **Splits** macros (0.3 / 0.4). They build a _Chips & splits_ relief layer (Carve, Height
multiply, after the board and grain relief; now _Cracks_, Wood, Height subtract × 0.2 — the boards' height) and a _Chip shading_ paint layer (Carve, Diffuse multiply), both writing no
mask so each reads the boards' outlines from the Shape mask; sizes follow the boards (chips 6 % of a board's width,
splits a third of its length). Materials added before keep their layers.

## Specular tint default

`render.specularTint` defaults to 1: glints take the surface's hue, which reads as the material; white glints look
like a clear coat. Projects that set it keep it; files without it now get tinted highlights.

## Checklist

- [x] Chips & splits generator: chips (corners, depth, one-sided), splits from edges and in the open, nicks
- [x] Gentle knotted deflection; merging into the neighbouring split
- [x] Carve and Chipped shape outputs; `genOutOwn`; Wood's output writes the register (now its mask)
- [x] Wood end wobble, softness, grain depth (`GenOut.hval`), Gap X · Y
- [x] Wood smart material Chips / Splits
- [x] Specular tint default 1
- [x] Smoke (D3D11) and cold compile times
- [x] Hand-authored recreations of a hand-painted plank floor and a crazed slab (kept in `private/`)
