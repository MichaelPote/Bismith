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
  (columns / rows, per-instance random → `rnd`) for rivets / bolts / tiles.
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
- [x] Repeat grid with per-instance random — plus row stagger, position jitter, rotation / size variation, drop-out
- [x] Column / Row spacing on the repeat grid
- [x] Bevel profiles from combined distance
- [x] Wrap-around on tileable projects

## Quality pass

- **Instancing reaches far enough.** Each type also gives `shapeExtent(cell)`, a bound on how far it reaches from its
  centre; the repeat loop visits every cell whose instance can reach the pixel (its extent + position jitter + the
  X / Y offset — at least the 3×3 around the pixel, capped at 25 cells per axis), in one flat loop with
  uniform-derived bounds. Shapes larger than their cells, long lines in a grid and big jitter are no longer cut off at
  the neighbouring cells. Row offset and _Mirror odd columns_ / _rows_ (`rep_mirror_x`, `rep_mirror_y` — each
  axis on its own, so a 2-column repeat can pair rivet lines along a plate's edges while its rows stay evenly spaced)
  count rows / columns on the instance itself, so its copies across a tiling edge match. Drop-out wraps the loop body in a test (no `continue`, which ANGLE can
  miscompile). Each instance has a random of its own (Diffuse › Colour variation, Per-feature variation), apart from its position
  jitter.
- **Column / Row spacing** (`col_sp`, `row_sp`, −1 … 1, Repeat): the step between instances grows (or shrinks) by
  that share of the texture width / height — 1 = a whole width more —, the grid centred; the cells that size the
  shapes (inset rectangles, …) keep their size, so spacing only moves the instances. When tiling, instances pushed
  past an edge come round the other side. The loop takes its candidates from `repGrid` (glsl/common.ts, shared with
  the rosette / glyph repeat, vents and tabs): the instances whose place (± the X / Y offset) is within the extent +
  jitter of the pixel, and at least the neighbours within a step either side; at spacing 0 exactly the cells it
  visited before (renders checked pixel-identical: staggered, mirrored, large, dropped and flipped repeats, tiled
  and not). Compile time rect 0.48 → 0.49 s, curve 0.63 → 0.68 s.
- **Repeat:** _Rotation steps_ snaps the rotation variation to multiples of an angle (random quarter turns); _Flip at random_
  mirrors instances left / right, up / down or both; wider sliders (counts to 32, jitter to 64 px).
- **Rectangle:** corner styles _Scoop_ (a quarter circle cut in) and _Notch_ (a square cut out) next to Round and
  Chamfer; chamfers use all four 45° planes everywhere, so the distance stays exact where a large chamfer reaches past
  the middle of a side.
- **Ellipse:** an exact distance at any aspect (iterative closest point), so rings keep their width and bevels follow
  the outline on flat ellipses; _Sweep_ keeps a sector centred on the top — pie slices, and with an Outline, arcs
  and gauges (the cut applies after the outline: `#define SHAPE_CUT`).
- **Polygon / Star:** _Inner radius_ is the star's inner corners as a fraction of the radius; _Inner rounding_
  fillets the star's inner corners. One
  exact folded-sector distance draws polygons and stars (`sdStarFillet`).
- **Line / Curve:** _Taper_ narrows the stroke to both ends (a spindle) or towards the end (a wedge, a claw) — exact
  tapered capsules / bars on Line; Curve gets flat caps (square to the curve at each end) and its own Bézier distance
  that also returns the closest curve parameter, and treats curves within 0.05 px of straight as segments.
- **Cross:** _Arms_ (3–16: Y, plus, asterisk), _Rounding_ of the outer corners that keeps the length and width, and
  _Inner rounding_ where the arms meet — an exact distance in the folded half-sector of an arm.
- **Fresh layers** (added in the editor) are sized to the texture: a panel inset 1/16 of the short side, a circle or
  polygon about 1/5 of it, a 0.6× line or curve, with a bevel of 1/64 of it (1.5 … 24 px). Every shape's Diffuse
  fills the shape (Source › Shape) by default rather than following the bevel's rise through the ramp, and scaled
  instances scale their bevel; Curve defaults to the circular arc, centred on the middle of the curve.
- **Bevel span** (every shape, `dome`): _To the middle_ spans the bevel from the edge to the shape's greatest depth
  (`shapeInradius`: hip roofs, faceted stars, rods, lenses at any size); Rectangle _Pillow_ and Ellipse _Dome_ are
  smooth closed forms ((1 − x²/a²)(1 − y²/b²), 1 − x²/a² − y²/b²) without the ridges a distance bevel makes. They go
  out through `GenOut.bdist`, which the instancing always fills (so they apply when the layer writes no mask, or
  writes it in Normal mode).
  _Scale the bevel too_ (Repeat) measures it in the instance's own units; a shape may also set its own bevel distance (`gShapeBevel`) — Cross measures it arm by arm,
  so crossing arms keep their height instead of rising to a peak. The wrapper's Bevel aspect is applied to these
  distances in `gen` (not to the spans). Taken from the distance's direction alone, the aspect stepped along every
  mitre: the direction flips there, so the two sides divided the same depth by different widths. Every shape therefore
  gives its outline to `shapeEdges` (`SHAPE_EDGES`), measured in the space the aspect stretches. That uses the
  GLSL_BEVEL toolkit: `bevelFrame` maps the instance's local frame there, `bevelSeg2` measures segments, `bevelArc2`
  arcs as eight chords, `bevelEllipse` whole ellipses. The pieces:
  - Rectangle: its sides and corners, any corner style.
  - Polygon / Star: a chain of segments sector by sector, as far as the widest bevel reaches; Rounding moves the
    chain out, with arcs at its convex joints.
  - Ellipse: exact; a Sweep makes it chords plus the two cuts.
  - Line: the sides (sampled under a curved taper), and the caps as segments or arcs.
  - Curve: the stroke sampled into two side polylines, plus its caps.
  - Cross: the arms' bars (the deepest of them, so the arms meet without a step), the fillet blend over every arm's
    sides and fillets, and the stem.

  The bevel is then continuous, and the mitres lean towards the narrower bevel. It runs only at an aspect other than 1,
  so the default renders are untouched. Left on the direction-only path, where outlines still step:
  - an Outline's inner edge, which is taken from the solid's direction (an outline's own gradient is noise along the
    middle of its band);
  - an outlined Sweep (an arc band);
  - every shape in a combined mask mode.

- **Bolts / Rivets › Head** (`head`; type `circle`, labelled Circle / Bolt until 2026-10-25): the plain circle (the default, with Aspect, Sweep with _Cut from_ / _Bevel the cut_,
  Outline and the dome span), or one of the greebles' shared fastener heads (`grb_fastener`, FASTENER_HEADS in
  `greebleCommon.ts`).
  - The heads: dome (_Aspect_, _Bulge_), Allen bolt (_Socket radius_), hex head, both also sunk in a counterbore
    (_Counterbore depth_ and _Radius_), slotted and cross screws, screw hole.
  - The Edge controls shape each head's outer edge — the cap's or pan's rim, the hex flats, a screw hole's wall going
    down — through `GenOut.bdist`, so Bevel, Profile, Bevel span, Bevel aspect and Scale the bevel too work as on any
    shape. A dome's Profile shapes its whole curve, whatever the Bevel (Flat counts as Round). The socket, slots and
    counterbore are the head's own, so a sunk head's bevel follows the head, not the counterbore.
  - A head's footprint is the shape and the mask. Its relief goes to Height through `GenOut.height` (Source ›
    Pattern; sunk parts below the surface); it paints its own value (`SHAPE_RELIEF` / `shapeRelief`, evaluated for the
    nearest instance): the rise, its sockets, slots and floors darker. That value is only shading, so Roughness,
    Specular, Metalness and Emissive with Source › Pattern fill the footprint (`gGenFillLevels`).
  - Rotation and the repeats' rotation variation turn the heads; the Circle-only settings are hidden and have no
    effect (a head is never hollowed by a stored Outline).
- **Round 2 additions:** Ellipse _Arc ends_ (round caps on swept rings); Polygon _Flat tips_ / _Flat valleys_ (gear
  teeth); Line / Curve _Taper curve_ (≥ 1: t^c, leaves; < 1: 1 − (1 − t)^(1/c), needles), _Length variation_ (keeps the
  thickness); Curve _Shape › Circular arc_ (through both ends, Bend = the sagitta: semicircles, horseshoes, elbows),
  _Bend position_ to ±3 (curls back past ±1) and _Centre on › Middle of the curve_; Cross odd counts point an arm down
  (an upright Y) and _Longer bottom arm_ (Latin cross). Wider sliders: Outline 64, Corner size 512, rounding 128, Stroke
  width 256, Aspect 0.1 … 10.
