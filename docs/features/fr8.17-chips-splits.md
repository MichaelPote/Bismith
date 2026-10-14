# FR8.17 — Chips & splits, plank-end wobble, soft rings

**Status:** done

## Goal
Worn, hand-painted wood: boards whose ends are sawn a little crooked, chipped at the corners and split along the grain
from the ends inward; slabs crazed with long cracks, short breaks across the grain and the stepped ends of fibre
strips. The damage had to be reusable — the same chips knock the corners off stone setts or panels — so it is a
generator of its own that works on the **Shape Mask** (the shape register), not a feature of the wood.

## Chips & splits (`chips`, `generators/chips.ts`)
A shape-category SDF generator that reads the register (`readsState`) and takes damage out of it. With nothing in the
register the whole texture counts as one piece (only the splits in the open and the nicks apply).

- **Chips** — one spot per cell of 2.5 chip sizes; a spot within a chip size of the edge moves onto it along the
  field's normal (central differences on the register), and an angular flake is cut around it: five half-planes at
  uneven angles, stretched along the edge, clipped to the spot's side of the edge so a chip never reaches across a gap
  into the neighbouring piece. *Corners* adds chance where the distance bends beside the spot (0 on a straight edge,
  ~0.4 at a right angle). *Depth* < 1 leaves a shallow flake with a floor.
- **Splits** — lanes across the grain (*Spacing*), one spot per lane cell (*Length*). A spot whose nearest edge crosses
  the grain (normal within ~40° of it: board ends) starts a split where that edge crosses the lane, flared where it
  opens and running inward, thin, narrowing late; a spot inside, away from such edges, may hold a split *in the open*,
  tapered at both ends. Splits run straight between knots ~0.4 lengths apart with a gentle deflection (*Wobble*) at
  each — wood splits along straight lines. **Merging**: a split from an edge may veer gently into the split in the next
  lane and end on it — only when that split really is there where this one ends (its cell is evaluated, register and
  all) and runs within 0.8 lanes — so two splits join into one (a Y) instead of crossing.
- **Nicks** — short cracks across the grain inside the shape, zigzagging a little (*Nick length*, *Nick width*).
- **Length jitter** — how much shorter than *Length* (or *Nick length*) each may be: 0 all full length, 1 anywhere from
  nothing to full; 0.55 by default (45–100 %, the spread before it had a control).
- **Width jitter** — each split's and nick's width varies around *Width* (*Nick width*) by up to this share: 0 all the
  same, 0.3 (default) 0.7–1.3× — the spread before it had a control — 1 anywhere from a hairline to twice as wide.
- **Bevel** (splits) — a rounded shoulder either side of each split and nick, narrowing with the crack (√ of its taper)
  so tips stay sharp, shaped by the layer's Profile (Flat counts as Linear): 0 a hard crack, more a soft groove. In
  Carve the removal is the larger of the crack's thin-line coverage and the shoulder; in Chipped shape the distance
  from the crack's side is scaled by `bevel / split bevel`, so the layer's bevel spans the split Bevel there (before,
  split shoulders were as wide as the shape's own bevel).

Every feature is a cut `c` (px, > 0 inside it) and a depth `f`. Two outputs, both writing the chipped shape to the
register when *Use shape mask* is on:

- **Carve what is below** (default) — value = how much of the surface is left (1 untouched … 0 cut away), covering only
  the damage, inside the original shape. Height › Multiply carves it out of whatever relief is below; Diffuse ›
  Multiply darkens it. Chip walls follow the layer's Bevel / Profile; splits and nicks use thin-line coverage (a pixel
  box filter, ≤ the width when under a pixel) so hairlines fade instead of flickering. Uses `genOutOwn`.
- **Chipped shape (SDF)** — the register minus the cuts; a part-depth cut sinks `(1 − f) × bevel` instead of reaching
  the edge, so the bevel gives it a floor. Drawn with the layer's bevel, the bevel wraps round each split: board ends
  break into rounded fingers.

A layer can have only one bevel, so a wide pillow bevel for the boards turns hairline cracks into dimples. Use a
*Chipped shape* layer for the chips and end splits and a second *Carve* layer (narrow bevel) for fine cracks and nicks.

Defaults follow the output (`linkedDefaults`): Carve — Height multiply × 1, Diffuse multiply (dark → white);
Chipped shape — Height add 0.4, Diffuse off.

Cost: three flat loops with uniform-derived bounds (9 chip cells, 15 split cells, 9 nick cells); the neighbour
split for a merge is evaluated only when the pixel lies on a merging split. Cold compile on D3D11 (RTX 5080):
**1.8 s** (1.6 s before the split Bevel and Length jitter).

## `genOutOwn`
`GenOut` gained `own`: an SDF generator that paints its own value and coverage but still has a shape. The wrapper
writes the distance to the register (by the Mode) and named masks and leaves value and coverage alone. Wood's `wood`
output now uses it, so a single Wood layer puts its plank outline in the Shape Mask for Chips & splits and clips
(`sdfShowIf` hides the shape params for Grain only and for one slab, which have no outline).

## Wood
- **End wobble** (`end_wobble` px, `end_wobble_px` bend spacing): board ends — the cuts across the grain — wander. Per
  plank column, the nearest joint's offset (1D noise across the plank, keyed by column and joint) shifts the along
  coordinate before the box test, so only the ends bend; both boards at a joint share the line (the gap keeps its
  width) plus a quarter of each side's own. The grain doesn't move. Off by default.
- **Softness** (`grain_soft`, Grain card): what read as harsh "rings" in Height were mostly the fine streaks — a
  steep smoothstep of three octaves of stretched value noise, the top octave near the pixel — plus each ring stopping
  at a hard edge (`fract` wrapping), a little cliff that aliased. Softness damps the top octave (gain 0.5 → 0.2) and
  widens the streaks' smoothstep; a ring's end is softened over `max(softness / 2, one pixel)` of a ring centred on
  the boundary (the end of the previous ring spills into the next) and its darkening widens to at least half a ring.
  At 0 the grain is as before except that ring edges are anti-aliased (hard with Anti-alias off, for pixel art).
  Stored projects keep 0; layers added in the editor start at 0.4 (`fresh`), the Wood smart material at 0.3. Cold
  compile 1.08 → 1.21 s.

- **Grain depth** (`grain_depth`, Grain card): the grain's dark parts sank as low as the gaps in Height. Now the plank
  surface in Height is `(1 − depth) + depth × grain`, times the edge profile: 0 a smooth full-height board, 1 as
  before; the gaps and bevels always span the layer's full height, and colour keeps the full grain. It rides in
  `GenOut.hval`, a separate value for Height › Pattern (shaped like the value; negative = the value). Stored layers
  keep 1; added in the editor, 0.35.
- **Gap X · Y** (`gap`, new `gap_y`): screen-axis gap widths — X the up-and-down gaps, Y the ones across — so side gaps
  and end joints can differ (which is which follows the direction). `migrate` copies a stored layer's single `gap` to
  `gap_y`, as does building one with only `gap` (recipes, templates), so nothing changes until Y is set.

- **Source › Shape** (every generator output): with Roughness › Pattern, Wood's roughness followed the full-contrast
  grain, so every dark grain line was near-mirror and the rest matte — pinpoint glints in the troughs, and raising
  roughness only dulled it. *Shape* is the inside of the layer's own shape (the distance the wrapper combines, before
  the register write: `coverage(d)`; for `sdf: 'mask'` layers `clamp(0.5 − d)`; 1 for layers without a shape), so At 0
  sets the gaps and At 1 the boards and the grain is ignored. On a project with a 4.9 key light, Roughness › Shape at
  0.9 (gaps) / 0.35 (boards) gives the broad sheen along the grain ridges that the hand-painted reference has. (A
  "highlight hold" that keeps rough highlights bright was considered and left out: the dullness came from the
  roughness mapping, and holding peaks would brighten every matte surface.)
- **Shape by default for new shape layers**: a shape layer (`sdf: true`) added in the editor starts with Roughness and
  Specular on *Shape* (`freshParams` in `layers/registry.ts`, before the type's own `fresh`) — on a shape, Pattern is
  the bevel's ramp (and Wood's grain), which nobody expects a roughness to follow. Noise-type layers keep Pattern (their
  pattern is the point; Shape would be 1 everywhere), as do mask-only shapes (Drips), layers built in code (recipes,
  templates, presets) and stored projects.

## Wood smart material
New *Wear* group: **Chips** and **Splits** macros (0.3 / 0.4). They build a *Chips & splits* relief layer (Carve, Height
multiply, after the board and grain relief) and a *Chip shading* paint layer (Carve, Diffuse multiply), both with the
shape mask unticked so each reads the board outlines; sizes follow the boards (chips 6 % of a board's width, splits a
third of its length). Materials added before keep their layers.

## Specular tint default
`render.specularTint` defaults to 1: glints take the surface's hue, which reads as the material; white glints look
like a clear coat. Projects that set it keep it; files without it now get tinted highlights.

## Checklist
- [x] Chips & splits generator: chips (corners, depth, one-sided), splits from edges and in the open, nicks
- [x] Gentle knotted deflection; merging into the neighbouring split
- [x] Carve and Chipped shape outputs; `genOutOwn`; Wood's output writes the register
- [x] Wood end wobble, softness, grain depth (`GenOut.hval`), Gap X · Y
- [x] Wood smart material Chips / Splits
- [x] Specular tint default 1
- [x] Smoke (D3D11) and cold compile times
- [x] Hand-authored recreations of a hand-painted plank floor and a crazed slab (kept in `private/`)
