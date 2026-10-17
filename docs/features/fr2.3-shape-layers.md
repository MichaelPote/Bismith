# FR2.3 — Shape layers (SDF)

**Status:** done (v1)

## Goal
"Straight lines, curves, boxes, rectangles, circles, etc." as exact 2D signed-distance primitives that can be
combined with SDF operators and bevelled analytically — the backbone of skeuomorphic UI surfaces.

## Plan
- `src/layers/glsl/sdf.ts` — primitives: rounded rectangle (per-corner radius), circle / ellipse, ring,
  regular polygon / star, line segment (round / flat caps), quadratic Bézier curve, cross; operators:
  union, subtract, intersect, smooth variants, onion (outline), round.
- Shape layer params: position (0..1, y down), size in px or **inset** margins in px (rect), rotation,
  corner radius, outline thickness (onion), anti-alias toggle (off = hard pixel edges), **repeat** grid
  (count X/Y, per-instance random → `rnd`) for rivets / bolts / tiles.
- Common SDF params on every SDF generator: combine operator + smoothness, bevel width (px), profile.
- Wrap-around evaluation on tileable projects (minimum over neighbouring periods).

## Checklist
- [x] SDF primitive library
- [x] SDF operators incl. smooth variants + onion
- [x] Rectangle (centred size / inset margins, rounded corners) — also chamfered corners and per-corner selection (Cinderforge notch)
- [x] Circle / ellipse / ring
- [x] Polygon / star
- [x] Line segment
- [x] Bézier curve
- [x] Repeat grid with per-instance random — plus row stagger, position/rotation/scale jitter, drop-out
- [x] Column / Row spacing on the repeat grid
- [x] Bevel profiles from combined distance
- [x] Wrap-around on tileable projects

## Quality pass

- **Instancing reaches far enough.** Each type also gives `shapeExtent(cell)`, a bound on how far it reaches from its
  centre; the repeat loop visits every cell whose instance can reach the pixel (its extent + position jitter + the
  X / Y offset — at least the 3×3 around the pixel, capped at 25 cells per axis), in one flat loop with
  uniform-derived bounds. Shapes larger than their cells, long lines in a grid and big jitter are no longer cut off at
  the neighbouring cells. Row offset and *Mirror alternate cells* count rows / columns on the instance itself, so its
  copies across a tiling edge match. Drop-out wraps the loop body in a test (no `continue`, which ANGLE can
  miscompile). Each instance has a random of its own (Diffuse jitter, Per-feature variation), apart from its position
  jitter.
- **Column / Row spacing** (`col_sp`, `row_sp`, −1 … 1, Repeat): the step between instances grows (or shrinks) by
  that share of the texture width / height — 1 = a whole width more —, the grid centred; the cells that size the
  shapes (inset rectangles, …) keep their size, so spacing only moves the instances. When tiling, instances pushed
  past an edge come round the other side. The loop takes its candidates from `repGrid` (glsl/common.ts, shared with
  the rosette / glyph repeat, vents and tabs): the instances whose place (± the X / Y offset) is within the extent +
  jitter of the pixel, and at least the neighbours within a step either side; at spacing 0 exactly the cells it
  visited before (renders checked pixel-identical: staggered, mirrored, large, dropped and flipped repeats, tiled
  and not). Compile time rect 0.48 → 0.49 s, curve 0.63 → 0.68 s.
- **Repeat:** *Rotation steps* snaps the rotation jitter to multiples of an angle (random quarter turns); *Random flip*
  mirrors instances left / right, up / down or both; wider sliders (counts to 32, jitter to 64 px).
- **Rectangle:** corner styles *Scoop* (a quarter circle cut in) and *Notch* (a square cut out) next to Round and
  Chamfer; chamfers use all four 45° planes everywhere, so the distance stays exact where a large chamfer reaches past
  the middle of a side.
- **Ellipse:** an exact distance at any aspect (iterative closest point), so rings keep their width and bevels follow
  the outline on flat ellipses; *Sweep* keeps a sector centred on the top — pie slices, and with an Outline, arcs
  and gauges (the cut applies after the outline: `#define SHAPE_CUT`).
- **Polygon / Star:** *Inner radius* is the star's inner corners as a fraction of the radius; *Inner rounding*
  fillets the star's inner corners. One
  exact folded-sector distance draws polygons and stars (`sdStarFillet`).
- **Line / Curve:** *Taper* narrows the stroke to both ends (a spindle) or towards the end (a wedge, a claw) — exact
  tapered capsules / bars on Line; Curve gets flat caps (square to the curve at each end) and its own Bézier distance
  that also returns the closest curve parameter, and treats curves within 0.05 px of straight as segments.
- **Cross:** *Arms* (3–16: Y, plus, asterisk), *Rounding* of the outer corners that keeps the length and width, and
  *Inner rounding* where the arms meet — an exact distance in the folded half-sector of an arm.
- **Fresh layers** (added in the editor) are sized to the texture: a panel inset 1/16 of the short side, a circle or
  polygon about 1/5 of it, a 0.6× line or curve, with a bevel of 1/64 of it (1.5 … 24 px). Every shape's Diffuse
  fills the shape (Source › Shape) by default rather than following the bevel's rise through the ramp, and scaled
  instances scale their bevel; Curve defaults to the circular arc, centred on the middle of the curve.
- **Bevel span** (every shape, `dome`): *To the middle* spans the bevel from the edge to the shape's greatest depth
  (`shapeInradius`: hip roofs, faceted stars, rods, lenses at any size); Rectangle *Pillow* and Ellipse *Dome* are
  smooth closed forms ((1 − x²/a²)(1 − y²/b²), 1 − x²/a² − y²/b²) without the ridges a distance bevel makes. They go
  out through `GenOut.bdist`, which the instancing always fills (so they apply when the layer writes no mask, or
  writes it in Normal mode).
  *Scale the bevel too* (Repeat) measures it in the instance's own units; a shape may also set its own bevel distance (`gShapeBevel`) — Cross measures it arm by arm,
  so crossing arms keep their height instead of rising to a peak. The wrapper's Bevel aspect is applied to these
  distances in `gen` (not to the spans).
- **Round 2 additions:** Ellipse *Arc ends* (round caps on swept rings); Polygon *Flat tips* / *Flat valleys* (gear
  teeth); Line / Curve *Taper curve* (≥ 1: t^c, leaves; < 1: 1 − (1 − t)^(1/c), needles), *Length jitter* (keeps the
  thickness); Curve *Shape › Circular arc* (through both ends, Bend = the sagitta: semicircles, horseshoes, elbows),
  *Bend position* to ±3 (curls back past ±1) and *Centre on › Middle of the curve*; Cross odd counts point an arm down
  (an upright Y) and *Longer bottom arm* (Latin cross). Wider sliders: Outline 64, Corner 512, rounding 128, stroke
  thickness 256, Aspect 0.1 … 10.
