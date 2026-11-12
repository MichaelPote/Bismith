# FR8.30 — Carved relief: Panelling, Strapwork, Carving

**Status:** built — Area, the grid gizmo, Panelling, Strapwork and Carving (checklist below), each through three critic
rounds; the open flaws are in the private hand-over.

## Goal

Three generators whose job is **height**: carved and joined wood (or plaster, stone) where the look is all in the
relief, not the material. Their value is the height, normalised 0..1, so Diffuse is a plain gradient ramp from low to
high (dark recesses, light faces) and anything richer — grain, stain, wear — is a layer over it (Wood with Multiply,
Cavity, Edges). The references are carved wood, but the grain is out of scope.

| Generator     | Type id     | Makes                                                                                                                                  |
| ------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Panelling** | `panelling` | Frame-and-panel joinery: stiles and rails round raised, flat or recessed fields, mouldings stepped in, panels merged into larger units |
| **Strapwork** | `strapwork` | Geometric line networks raised as straps over sunken fields: star-and-polygon patterns, coffers, interlaced rings, parquet strips      |
| **Carving**   | `carving`   | Organic cells with curved outlines, pillowed bodies and flowing grooves: scales, ogee leaves, waves, spirals, overlapping circles      |

Why three and not one: Panelling's layout is a rectangle partition with no neighbour search (exact and cheap);
Strapwork needs a line arrangement built on the CPU (intersections, faces, over/under), uploaded as data; Carving is
analytic per cell, with curved outlines and scalar-field grooves and no CPU geometry. They share one relief toolkit (the
moulding stack, the groove maker and the field fills), so a fill or profile added once works in all three.

What the references show (described generically; the file mapping is in `private/critic/carved-relief/refs.md`):

| #   | Motif                                                                                        | Generator | Needs                                                                    |
| --- | -------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| P1  | Grid of square panels, two or three nested rectangles stepping in; some panels span two rows | Panelling | merged cells (grid gizmo), repeated insets                               |
| P2  | Three tall raised panels, stiles between, corner blocks inside the moulding                  | Panelling | raised field, corner bosses mask                                         |
| P3  | Tall panels under a cornice, pilasters between with corbels                                  | Panelling | rails as bands (dado / cornice rows), pilaster flutes                    |
| P4  | Wide raised-and-fielded panels, heavy multi-step moulding, chamfered field                   | Panelling | moulding stack with ogee / cove / step, chamfer field                    |
| P5  | Square panels with a dentil cornice and fluted pilasters                                     | Panelling | flute fill on stiles, dentil row on a rail                               |
| P6  | One tall door panel, quarter-round notched corners with bosses                               | Panelling | concave-notch corner shape, corner boss                                  |
| P7  | Vertical boards with staggered cusped dish recesses                                          | Panelling | board joints, staggered columns, cusped panel shape, dished recess       |
| P8  | Horizontal rails over bands of cross-hatched and diagonal grooves, alternating               | Panelling | per-row fill alternation, crosshatch / diagonal flute fills, round rails |
| G1  | Hexagons with nested hex outlines, slatted rhombi between                                    | Strapwork | edges of a hex tiling, concentric field steps, slats per kind            |
| G2  | Tumbling-block rhombi, each face slatted in its own direction                                | Strapwork | rhombille, slat fill angle by kind, narrow straps                        |
| G3  | Octagon + square coffers (regular, and stretched into long hexagons)                         | Strapwork | edges of 4.8.8 with aspect, wide moulded straps, sunken fields           |
| G4  | Figure-eight chain links on a diagonal grid, lens holes                                      | Strapwork | rings mode (scaled, rounded outlines), interlace                         |
| G5  | Square parquet frames with interwoven diagonal strips inside                                 | Strapwork | edges + rings on a square, strip over/under, frame border                |
| G6  | Six-fold star strapwork, raised double-line straps, hexagonal rosettes                       | Strapwork | stars mode on hex, double-fillet straps, interlace                       |
| G7  | Eight-fold star strapwork, every field with its own raised inner outline and a diaper fill   | Strapwork | stars on 4.8.8, field inset step, diaper fill, boss fill                 |
| G8  | Zig-zag strap lattice (eight-point stars and crosses) laid on a flat ground                  | Strapwork | stars mode, straps raised over a flat ground (no field moulding)         |
| G9  | Grid of square/diamond fields with chamfered (hipped) edges and V joints                     | Strapwork | stars on squares, pyramid / chamfer field fill                           |
| O1  | Interlocking spirals on a staggered grid, concave-square fillers between                     | Carving   | spiral layout, spiral groove motif, filler kind                          |
| O2  | Diagonal squares, each filled with fanned wavy lines, alternate cells turned                 | Carving   | diagonal-square layout, fan motif, rotate by parity                      |
| O3  | Scale rows of sickle / crescent fans                                                         | Carving   | scales layout, crescent motif, shingled depth                            |
| O4  | Ogee lattice, each onion cell a leaf with curved veins                                       | Carving   | ogee layout, leaf motif, pillow body                                     |
| O5  | Overlapping circles (four-petal lenses and concave squares)                                  | Carving   | circles layout, outline grooves, lens / square kinds                     |
| O6  | Pointed scales with nested chevron grooves following the outline                             | Carving   | scales layout (pointed), concentric motif, shingled depth                |
| O7  | Sine-wave bands with lines following the wave                                                | Carving   | wave-bands layout, parallel motif                                        |
| O8  | Diamond lattice of raised ribs, an eight-petal flower in every cell                          | Carving   | diamond layout, petals motif, rib outline                                |

Out of scope: free-form ornament (acanthus leaves, corbels, capitals, florets with tendrils). Every generator writes
masks for the places ornament sits (corners, field centres, stile tops), so a Stamp, Glyph or Rosette layer limited to
them can add it.

## Shared: the height-first convention and the relief toolkit

### Output convention

- `value` = the composed height 0..1 (0 = deepest recess, 1 = highest face), built from the toolkit, returned with
  `genOutOwn` like the greebles' relief, so the wrapper's bevel doesn't redraw it. `sdf` is the outline of what the
  layer's mask writes (the panel field, the straps, the cell).
- Defaults: Height output on (amount set so the deepest step is a few px of relief), Diffuse on with a two-stop
  ramp (dark brown low, warm light brown high) — the simple gradient — and the value as its source. Per-feature
  variation off (panels shouldn't jump about), `rnd` per panel / field / cell for whoever wants it.
- **Output** enum on each: _Relief_ (default) and the parts as coverage (fields, frames, straps, grooves, corners,
  kinds) for Diffuse, Roughness and masks; mask parts through `maskSources`, so one layer paints its grooves dark
  with a _Write to_ row instead of a second copy.
- Tile seamlessly; repeats across are whole when the project tiles; lengths `unit: 'px'`, counts per texture plain.

### Relief toolkit (`src/layers/generators/reliefCommon.ts`, GLSL `rlf_*`)

1. **Moulding stack** `rlf_moulding(d)` — height as a function of the inside distance `d` (px, ≥ 0 inside a field or
   strap), from a list of up to six **steps**, each _width · profile · level_: the profiles are Trim's `BAND_PROFILES`
   (flat, bead, cove, ridge, groove, step, chamfer / quarter-round / ogee / cove rising or falling) through
   `grb_bandShape` (move it from `greebleTrim.ts` into the toolkit; Trim imports it back). Because `d` is the distance to
   a polygon's edges, every step mitres at the corners for free. **Repeat** runs the stack _n_ times, each pass inset
   by the stack's total width and its levels scaled toward the centre — the "inset / bevel / inset" of nested panels
   (P1, G1) without six copies of the params. Widths in px or as a share of the field's half-size (_Fit to field_, as
   Trim's _Fit bands_), so small and large panels keep their proportions.
2. **Grooves from a scalar field** `rlf_iso(phi, grad, count, w, prof)` — lines along the isolines of a field φ
   with an analytic gradient: distance to the nearest line ≈ |φ·count − round(φ·count)| / (count·|∇φ|), so widths stay
   in px wherever the field stretches; profile V, U, round; a _Reed_ option rounds the strips between the grooves
   instead (reeding). Fade and stop margin from the field's edge. Used by every fill below and by all of Carving.
3. **Field fills** (one enum, shared): none (flat) · dome / pillow (round profile of `d` to the centre) · pyramid /
   hipped (linear to the centre ridge) · flutes (parallel grooves at an angle) · crosshatch · chevron · concentric
   (isolines of `d`) · fan (angle about a pivot) · diaper (a small grid of sunken squares or pyramids) · boss (a
   disc or dome at the centre, also written as a mask for ornament). Angle, count, depth, width per fill; _Angle by
   kind_ turns a fill per field kind (G2's slats).
4. **Fill alternation**: a second fill (_Fill B_) with _Alternate by_ none / row / column / checker / kind / random
   (share) — P8's alternating bands, O2's turned squares.
5. **Interlace** (Strapwork, and Carving's rings): at a crossing the under strand dips (_Dip_) and is cut by the over
   strand's edge with a small shadow gap (_Gap_), the over strand arching slightly. Modelled on Weave's over/under
   arch, shared there if the code fits.

Compile time: one stack, one fill evaluation per pixel (pick the fill's parameters first, call once), loop bounds from
uniforms (`n * UNI_1`), no `continue`. Measure every generator with `tools/compile-time.ts`.

## Generator 1 — Panelling (`panelling`)

### Layout

- **The grid** — columns, rows, their sizes and which cells are merged into larger panels — is edited on the canvas
  with the **grid gizmo** (below), not typed. The inspector shows only _Columns_ and _Rows_ counts (changing one adds
  or removes a column / row at the end, sharing the space evenly), an _Even out_ button (all columns, all rows equal;
  merges kept) and _Clear merged_. Default 3 × 2, equal. The grid spans the layer's Area (no repeat: add lines
  instead, up to 16 each way).
- **Random merges** (a share of neighbours merged into 2×1 / 1×2 / 2×2 units, seeded) on top of the drawn ones, for
  variety without drawing; off by default.
- **Stagger**: alternate columns (or rows) shifted by a share of a cell (P7's boards).
- **Frame**: stile width, rail width (px or share), outer frame width, and **Boards**: the frame's surface split into
  boards with V or square joints at a spacing (P7), or none.
- **Band rows**: up to three full-width rails above / below the panel grid — cornice, dado, skirting — each with its
  own moulding stack and an optional **dentil** row (P3, P5).
- **Pilasters**: stiles drawn as pilasters (wider, with a flute or reed fill and capital / base blocks as a mask
  for ornament) on every _n_th stile (P3, P5).

### Area and grid gizmo

Two generic pieces, built with Panelling but not tied to it.

**Area** (`LayerDef.area: true`; `area_x`, `area_y`, `area_w`, `area_h`, fractions of the canvas, default the whole
canvas): restricts a layer to a rectangle. The layer's pass sees the area as its canvas — `uRes` is the area's size in
whole px, the pattern's origin its top-left corner, `uTile` off unless the area is the whole canvas, and its CPU work
(`cpuData`, derived uniforms) gets the area as its `LayerCanvas` — so the pattern is laid out to fit it (whole tiles,
whole panels, a trim strip's full stack) instead of being cropped. Outside it the layer has no coverage and the shape
it writes is pushed out (its distance at least the distance to the area). Opted in: Panelling, Tiles, Greebles, Trim
(more later: anything that lays out against `uRes` and doesn't read the layers below at moved coordinates). Inspector:
an _Area_ section with the four values and _Reset Size_.

**Gizmo** (`src/ui/components/GridGizmo.vue`; edits as pure functions in `src/core/grid.ts`, with unit tests, which
the generators' CPU work also uses, so gizmo and render can't disagree), shown in the Create workspace while the layer
is selected and _Show Gizmos_ is on:

- **Area outline** for every area layer: drag an edge or a corner to resize, the move stud (`IconArrowsMove`, just
  outside the top-left corner) to move. Snaps to whole px; Shift to every tenth px. Tiles, Greebles and Trim get this
  part only.
- **Grid** for layers that declare one (`gridEdit: { cols, rows, merge }` on a ParamDef, naming the three params
  below): Panelling now; Trim (rows = strips, columns = block dividers) and Greebles (the grid as its root panels, each
  then subdivided at random) are the next candidates.

**What the grid stores** — three text params with no inspector field (`uniform: false`, `optimize: false`):

- `grid_cols`, `grid_rows`: the sizes as fractions of one repeat, space-separated, summing to 1. Fractions, so resizing
  the canvas, the area or the repeat keeps the proportions; edges round to whole px when rendered.
- `grid_merge`: the merged panels as cell rectangles `col,row,w,h` (`0,1,1,2 4,1,1,2`); cells not listed are single
  panels. Parsing drops overlapping or out-of-range rectangles, so a hand-edited or stale value never breaks a render.

**What it draws** — over one repeat of the layout (the top-left one; the other repeats show its lines faintly, dashed):

- The grid lines and each panel's outline (lines inside a merged panel are not drawn).
- **Borders**: every grid line is one handle. Hovering a visible segment of it highlights the whole line and shows the
  resize cursor.
- **Add**: hovering just outside the repeat's top or bottom edge shows a ghost column line and a ⊕ stud at the pointer
  (outside, so the edge itself stays the area's resize handle); a click splits the column there (a merged panel
  crossing it spans one more column). The left and right sides do the same for rows.
- **Merge arrows**, **only on the panel under the pointer** (all sizes, all zooms): up to four arrow studs
  (`IconArrowUp` / `Down` / `Left` / `Right`), one near the middle of each side. An arrow grows the panel by the next
  strip of cells that way: the whole row (column) of cells beside that side, across the panel's full width (height),
  and any merged panels wholly inside the grown rectangle. No arrow where that is impossible: the repeat's edge, or a
  merged panel only partly inside (an L-shape). For single cells beside single cells this is "merge with the neighbour".
- **Break buttons**, also only on the hovered panel: in a merged panel, at the middle of each internal grid line's
  segment inside it (where its cells were joined), a break stud (`IconArrowsHorizontal` on a column line,
  `IconArrowsVertical` on a row line) splits the panel along that line. Shift-click breaks it into single cells.
- A press within 6 screen px of a line goes to the line, never to a stud.

**Interactions**:

- **Drag a border**: moves that grid line; only the two cells either side change size, each kept at least 4 px.
  Snaps to whole px; **Shift** to every tenth px, **Ctrl** (⌘) to the even split of its two cells. A modifier pressed or
  released mid-drag applies at once.
- **Remove a line**: right-click it: its two columns (rows) become one, merges re-mapped.
- Every gesture is one undo step (`store.commitNow()` first, as LayerGizmo), through `store.setLayerParam`, so
  variants, presets and undo need nothing new.
- **Stagger** shifts alternate columns' rows: the gizmo edits the unstaggered layout and draws the shifted ones dashed.

### Panel

- **Shape**: rectangle · cut corners · rounded · notched (concave quarter-round, P6) · stepped notch · arched top
  (round / segmental) · cusped (pointed lobes top and bottom, P7) · oval. Built as one polygon-with-arcs SDF with exact
  px distance inside (`geoPolyGlsl` for the straight ones; arcs as in `bevelArc2`), so the moulding mitres follow the
  shape. Corner size in px or as a share.
- **Moulding** (frame into panel): the toolkit's stack with Repeat. Default: a small ovolo off the frame, a cove down,
  a flat, then the field.
- **Field**: raised (a chamfer up to a flat centre — the raised-and-fielded panel), flat, recessed (the stack falls
  instead of rising), dished (smooth bowl, P7) — then the shared fill (P8's crosshatch) and its alternation.
- **Corner bosses**: discs / squares at the moulding's corners (P2, P6), height and size, also a mask part.
- **Variation**: per-panel field height and fill jitter (small), a share of panels with Fill B, a share left blank.

### Implementation

The CPU turns `grid_cols` / `grid_rows` and `grid_merge` (parsed by the same `src/core/grid.ts` functions the gizmo uses,
so they can't disagree) into cumulative column / row edges in px (derived uniforms) and a panel table
(rectangles, kind, which fill) in a small data texture (`cpuData`). Per pixel: find the column and row by a bounded
scan of the edges, look up the cell's panel, compute the rectangle-in-frame distance (exact, so no neighbour search),
then the shape, moulding and fill. Frame joints and boards come from the same coordinates. `bdist` for Bevel aspect
via `bevelFrame`.

## Generator 2 — Strapwork (`strapwork`)

### Network

- **Base tiling**: square, triangle, hexagon, rhombille, octagon + square (4.8.8), trihexagonal (3.6.3.6), 3.12.12,
  4.6.12, Cairo — the polygon tables move from `geometricTiles.ts` to a shared CPU module, with the new ones added as
  data. Scale = repeats across, Aspect (G3's stretched octagons), Rotation in 45° steps via the `geo_` frame.
- **Construction**:
  - _Edges_ — the tiling's own edges (coffers G3, cube faces G2, hex lattice G1).
  - _Stars_ — polygons in contact (Hankin's method): from every edge's midpoint two rays enter each tile at the
    _Contact angle_, split apart by _Offset_, cut where they first meet another. Squares at 45° give the eight-point
    star-and-cross (G8, G9); 4.8.8 the eight-fold star field (G7); hexagons the six-fold (G6); 3.12.12 twelve-fold.
  - _Rings_ — each tile's outline scaled by _Ring scale_ (> 1 overlaps its neighbours) and its corners rounded by
    _Ring rounding_ (1 = circles): chain links (G4), overlapping circles, parquet strips (G5).
  - _Edges + Rings_ / _Edges + Stars_ — both networks (G5's frames with strips inside).
- The CPU builds one period's arrangement: segments and arcs, split at crossings; **over/under** parity by walking each
  strand (alternating, so every strand weaves); **faces** of the planar graph with a **kind** (classified by vertex
  count and area, so all stars are one kind, all kites another). Segments and faces are binned into a k×k bucket grid
  over the period and sent as a data texture; the shader loops over its bucket's list (a uniform bound, flat: no
  helper calling helpers in nested loops).

### Straps and fields

- **Strap**: width (px), profile (flat, round, ridge, chamfered), **Lines** 1–3 (a fillet groove down the middle
  makes the double-line straps of G6), height above the field, edge bevel (the moulding stack, Repeat 1).
- **Interlace**: off / over-under (the toolkit's helper), dip, gap.
- **Ground**: _Fields_ (each face sunk and moulded in: G1, G3, G7) or _Flat ground_ (the straps sit on one plane:
  G8).
- **Field**: depth, its own moulding stack with Repeat (G7's raised inner outline, G1's nested hexagons), fill from the
  shared list with _Angle by kind_ and Fill B by kind (G2: slats turned per face; G7: diaper in the polygons, a boss
  in the stars), per-kind depth offset.
- Outputs: relief, straps, fields, fields by kind (a tone per kind, like Tiles' Tones), crossings.

### Implementation risks

The arrangement and face extraction are the biggest piece of CPU code here: they need robust intersection with
tolerance, a period-wrapping graph (edges crossing the cell boundary), and tests (`tests/` against known vertex and face
counts for the classic patterns). Shader cost depends on the bucket size: limit items per bucket (~24) by choosing k
from the density, and check `tools/render-cost.ts`.

## Generator 3 — Carving (`carving`)

### Layout (each gives the cell id, local coordinates, inside distance `d`, kind and depth order)

- **Scales**: rows of arcs offset by half, round or pointed (_Pointed tips_), shingled — each scale tucks under the one
  above (O3, O6). Reuse Scales' (`organicWood.ts`) layout maths.
- **Ogee**: mirrored sine waves running down, forming onion cells; _Waist_ and _Curve_ (O4).
- **Wave bands**: horizontal bands bounded by phase-shifted sines; amplitude, wavelength, band count (O7).
- **Circles**: circles on a square or hex grid, radius by _Overlap_ — lenses and concave squares as two kinds (O5).
- **Diagonal squares / diamonds**: a square grid at 45° with a rib outline (O2, O8).
- **Spirals**: discs on a staggered grid with concave fillers between as a second kind (O1).

### Cell

- **Body**: flat · pillow (round profile of `d`) · dome · tilted (high at one edge, for shingling) · chamfered; the
  outline as a groove (width, depth, profile) or a raised rib.
- **Motif** (grooves from the toolkit's isoline maker over a field φ in cell coordinates):
  - _Concentric_ — φ = `d`: nested arches and chevrons (O6).
  - _Parallel_ — φ = the band's cross coordinate: lines following the wave (O7).
  - _Fan_ — φ = angle about a pivot (corner, base centre), bent by _Curl_: fanned flowing lines (O2).
  - _Leaf_ — a midrib groove and veins φ = y − k·|x|^p, mirrored, stopping short of the edge (O4).
  - _Spiral_ — φ = θ/2π + r / pitch, arms 1–3, _Tighten_ (O1).
  - _Crescents_ — arc bands nested in the cell (O3).
  - _Petals_ — _n_ petals in one or two rings, each pillowed with a midrib (O8).
  - Count, groove width / depth / profile, Reed, edge margin, fade.
- **Per kind**: the second kind (fillers, lenses) has its own body and motif (O1's concave squares, O5's lenses).
- **Variation**: turn / mirror by row, column or checker (O2), motif phase and count jitter, size jitter.

### Implementation

All analytic: point location in the layout plus a small neighbour set for overlapping layouts (scales, circles), the
top one by depth order. φ and its gradient come out of one function selected by a mode index; keep it one call per
pixel. Flowing lines must stay smooth: no corrugated ripple along them, no visible warp period, no clumping where
they converge (fans, spiral centres) — thin them out instead.

## Diffuse and presets

No colour logic beyond the ramp: value → two- or three-stop ramp. Presets (layer and project, in a `carved` folder)
pair each generator with a Cavity filter (darkened grooves), a soft sun + sky with shadows and AO (relief reads only
with them), and optionally a Wood layer on Multiply for the grain. One preset per reference row above.

## Phases and checklist

- [ ] **Toolkit**: `reliefCommon.ts` — moulding stack (moved `grb_bandShape`), isoline grooves, field fills, fill
      alternation, interlace; unit tests for the CPU mirrors.
- [x] **Area**: `LayerDef.area` (`true`, or `'layout'` when the grid is the layer's own layout); `AREA_PARAMS` and
      `GLSL_AREA` in commonParams.ts (the pass's `uRes` / origin / `uTile`, coverage and shape cut outside the area and
      in off cells); the area as the CPU canvas (materialPipeline `canvas()`). Opted in: Panelling, Tiles, Greebles,
      Trim, Bands, Grid lines, Stripes. Rendered on D3D11: Tiles laid out in an area, cells off on Tiles and Grid lines.
- [x] **Grid model**: `src/core/grid.ts` — sizes, merges and off cells as text params; panels, grow (no L-shapes),
      break, split, remove line, move line, counts, even out, area px; `tests/core/grid.test.ts`.
- [x] **Grid gizmo**: `GridGizmo.vue`, mounted by Viewport for the selected Area layer. Away from the viewport only a
      faint outline and the hatched off cells show; over it the grid lines, corners, move stud and a hint for lines /
      edges / the add band; studs (switch, merge arrows, split) only on the panel under the pointer. Drags snap to px
      (Shift 10 px, Ctrl even split), readout while dragging, right-click removes a line. Checked in the GPU editor
      (hover, line drag, add band, area resize); `tools/editor.ts` gained `move` and `dragAt` for it.
- [x] **Inspector grid controls** (`GridControls.vue`, in Shaping › Area through Properties' section slot): Columns and
      Rows counts, and Even out, Clear merged (layout layers), All cells on and Reset Size, each shown only when it
      would change something. Checked in the GPU editor, undo included.
- [ ] Gizmo, later: keyboard nudge of a hovered line.
- [x] **Panelling, first pass** (`panelling.ts`): panels from the grid (merged, off), stiles / rails / outer frame,
      square / cut / rounded / notched corners, a four-step moulding (step, chamfer, round, cove, ogee, bead / flute,
      ridge / V groove) with Repeat, flat / raised / domed / pyramid fields with field variation, fills (flutes, reeds,
      horizontal, diagonal, crosshatch) with a second fill by row / column / checker; panels written to the mask.
      0.24 s cold compile.
- [x] **Panelling extras**: random merges (`randomMerges` in grid.ts: single, switched-on cells grown 2 × 1, 1 × 2 or
      2 × 2, seeded; on top of the drawn ones, not shown by the gizmo; never into rails or pilasters), merging after
      staggering (with Stagger, merges keep to the rows or columns that slide — random ones are 2 × 1 or 1 × 2 along
      them, drawn ones split into a strip per row / column by `layoutGrid`, and the gizmo offers no arrows across), stagger of alternate columns or rows (wrapped
      round, between the rails; the gizmo draws the shifted lines dashed and edits the unshifted ones), boards with V
      joints on the frame (every Board width, or on the grid lines), top and bottom rail rows (cornice / skirting: a
      profile out to the area's edge; dentils along the cornice), pilaster columns (alternate columns: a rounded shaft
      with flutes, capital and base blocks), arched / rounded both ends / pointed arch / cusped / oval panels, corner
      bosses (discs or squares, only where the corner is inside the panel), and Output parts (fields, frame, bosses and
      capitals). 0.46 s cold compile.
- [x] **Panelling ornament**: running ornament along a moulding step (bead and reel, egg and dart, rope, nailheads,
      leaf tips; units fitted to each side so they meet in the mitres), corner carvings (leaf spray, fan, rosette;
      _Corner spread_ stretches them along the rails), a medallion (lozenge, roundel, quatrefoil, beaded rim), rosette
      bosses, pilaster capitals (leaves with an abacus and a hanging drop, or volutes). Also from the critic rounds:
      _Quirks_ (a fine groove between members), multi-member rail profiles (cornice, skirting) meeting without a step
      at the seam, outer frame per axis (default half the stile, so the default tiles), open panel ends where there is
      no frame, _Shape from step_ (a notched inner moulding inside a square outer one, bosses set in its notches),
      anti-aliased fills. 0.93 s cold compile.
- [x] **Critic run** against the panelling references: 5.5 → 6.3 → 6.6 over three rounds; hand-over (open flaws:
      console capitals, default moulding legibility, leaf cleanup, a field-edge moulding) in the private critic folder.
- [ ] Panelling, later: shared toolkit split out once Strapwork needs it; gensheet critic rounds and recreations P1–P8;
      carved ornament stays with Stamp / Glyph / Rosette over the Bosses output.
- [x] **Strapwork** (`strapwork.ts`; network in `strapNet.ts`, tested in `tests/layers/generators/strapNet.test.ts`):
      seven tilings (squares, hexagons, triangles, octagons and squares, hexagons and triangles, dodecagons and
      triangles, rhombille; square ones can turn 45°, _Diagonal_), built as their own CPU tables rather than shared
      with Tiles (whose tables are shader-packed); lines from the tiling's edges, Hankin stars (_Star angle_, _Star
      offset_ — negative starts the rays crossed —, _Rays through_ to the tile border) or rounded rings, or edges with
      stars / rings (_Edge weight_ draws the frame heavier). Collinear pieces merge into lines, lines split at their
      crossings; the weave is decided exactly by a checkerboard parity (a path to a fixed point), the period doubled
      when one period can't carry it; tile edges crossing each other join, and points where more than two lines pass
      through join. Fields come from a raster of one period: kinds by size and orientation, inradius. On the GPU:
      pieces, a bucket grid, the field raster and a region table as data textures. Straps: flat / round / ridge /
      hollow / stepped / moulded, 1–3 lines, under dip and gap; fields flat / pyramid / dome / dish with a flat top,
      levels per kind, field variation, fills (slats turned per kind with jitter, terraced insets, diaper),
      band-limited. Outputs: relief, straps, fields, field kinds. 0.3 s cold compile.
- [x] **Carving** (`carving.ts`): layouts scales (round or pointed, rows lying over the ones below), ogee, wave bands
      (per-wave variation), overlapping circles, diamonds, squares, discs (staggered or square); bodies flat /
      pillowed / domed / tilted / chamfered, an outline groove or rib; motifs following the outline (with a line count),
      parallel, fan (curl and S-bend), leaf, spiral, crescents, petals, following the free edge — grooves as isolines with
      analytic gradients, band-limited, optionally reeded; a second kind of cell (gaps, lenses) with its own motif and
      level; turned cells. 0.35 s cold compile.
- [x] **Critic run**: three rounds each against the geometric (G1–G9) and organic (O1–O8) references; hand-over in the
      private critic folder.
- [ ] Each generator: tiling 2×2 at 45° frames and odd sizes, supersampling (px units), cold compile on the Windows
      backend (target < 2 s), gensheet + critic rounds (`docs/gensheet.md`, `docs/generator-critic.md`), presets,
      docs (this file's layer reference, architecture.md's generator list and feature index).

## Open questions

- Panelling is the most direct win and comes first; Strapwork the largest (CPU geometry). Carving could be folded into
  Strapwork later if the layouts turn out to be curved tilings of the same kind, but starting them apart keeps
  Carving's shader free of the data texture.
- Ornament (leaves, corbels, florets) stays with Stamp / Glyph / Rosette via the masks; a raster ornament import is a
  separate feature.
- `panels` was Greebles' old id; the new type is `panelling` to keep old files from loading as the wrong layer.
