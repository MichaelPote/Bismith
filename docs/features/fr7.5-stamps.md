# FR7.5 — Stamps, labels, paths & cables

**Status:** done (generators); used throughout the FR7.4 recreations

## Goal

Some texture motifs are _drawn_, not grown: a crate's winged skull, a stencilled "03", a logo burned into a
switch, a lightning-bolt channel routed through a door, a rope moulding. Procedural motifs only approximate these,
and that approximation is what made optimiser results look aimless. These generators take deliberate, hand-authored
input and still behave like every other shape: they are SDFs (bevel, profile, masks, Limit to) and they
light through the path tracer.

## Design

- **Encoded text params** (`src/core/bitmap.ts`, `src/gpu/uniforms.ts`). A `text` param may declare
  `bitmap: 'pixels' | 'font' | 'points'`; it is then uploaded:
  - `pixels` — rows of cell characters (`#` full, `+` mid, `-` low, `.`/space empty; ≤ 64×64) packed 2 bits per
    cell into `ivec4 u_<key>[64]` + `ivec2 u_<key>_size`.
  - `font` — the same layout, rendered from text with a built-in 5-row pixel font (digits, capitals, `- . : / ! + = #`;
    `|` or a new line starts a centred line).
  - Stamp and Label keep these encodings for their params but no longer upload them (`uniform: false`): they lay
    their bitmaps out on the CPU (below).
  - `points` — polygons (`x,y x,y …`, one per line or `|`, ≤ 64 vertices) as `vec4 u_<key>[64]`
    = (x, y, index of the polygon's next vertex, polygon index) + `ivec2 u_<key>_size` (vertices, polygons).
- **Stamp** (`stamp`, `src/layers/generators/stamp.ts`). SDF = distance to the nearest cell of the other state, so
  bevels follow the pixel outline — exact at any width: the CPU (`cpuData`) lays out the bitmap (≤ 128 × 128, mirror
  applied) with a margin of empty cells and stores per cell the nearest cell of the other state (jump flooding, +1
  pass), and the shader takes the nearest of the candidates in the 3×3 cells round the pixel (9 lookups; outside the
  margin, from its edge — continuous, so its mask can be bevelled from outside). Placement by centre (0..1),
  pixel size, quarter turns, free _Angle_, mirror (draw the left half; odd = shared centre column); _Grow_ offsets the
  outline, _Outline_ keeps an inner stroke, _Join diagonals_ halves the cells first and, wherever two cells touch
  only at a corner (the other two of their 2 × 2 empty), fills the two empty half-cells at that corner — add only, so
  square corners stay square and one-cell diagonals and X crossings become single strokes (the shader's cells are then
  half a bitmap cell). Repeats in a Repeat group: count, spacing by _Step_ (centre to centre, px) or _Gap_ (between
  neighbours, in cells: the repeat's extent — its bounding box when turned — plus the gap; the default, 1),
  **row shift** (±256 on the slider) for diagonal rivet lines and brick bond, _Position jitter_, _Missing repeats_
  (seeded). One flat loop runs over every repeat that can reach the pixel (≤ 3 per axis from each side of the tile
  seam), so a grid's far end wraps round on tileable projects; overlapping repeats merge, with the depth inside taken
  as √(a² + b²) of the two deepest repeats (coincident ones count once), so outlines hidden inside another repeat leave
  no groove. Repeats snap to the pixel grid. The per-feature random is the cell level (1..3: a _Random_ colour ramp
  paints multi-tone stamps), the repeat, or both (_Random per_); the repeat's random can be kept to a sub-range
  (_Repeat random range_), e.g. clear of a base colour.
- **Stamp › Image file** (_Stamp source_). The stamp is an image file instead of typed rows: a PNG, JPEG or WebP picked in the
  inspector (`ImageField.vue`), scaled down on loading so it fits the texture (at most 1024 px; `fitImage`). Each of
  its pixels is a cell, _Pixel size_ px across; the pixels at least _Opacity threshold_ opaque are the stamp. So the outline,
  bevel, mask, placement and repeats are the typed stamp's, and Join diagonals, Mirror and Level relief don't apply.
  - _Image into_ picks the output: **Diffuse** paints the image's colours (the generator's own colour, `gGenRgb`, takes the
    ramp's place), **Height** its brightness, × the bevel at the outline (`genOutShaded`). The pixel's alpha fades the
    coverage either way.
  - _Image into_ is a linked default: Diffuse turns the layer's Diffuse on and Height off, Height the other way round.
  - _Smooth image_ blends between the image's pixels (bilinear, premultiplied); otherwise each stays square.
  - **Images by file name** (`src/core/images.ts`). The param holds the file name, the "path" the project saves: a
    browser page doesn't see where the file lives. The pixels stay in this browser, in memory and in localStorage under
    the name. A project opened where that image isn't stored draws nothing for it, and the inspector shows the name as
    missing with _Find…_ to load it again. Loading a file under a name already used replaces it everywhere.
  - Decoding is asynchronous: the layer draws nothing until the image is ready, then the engine re-evaluates
    (`onImageReady`). `Engine.imagesSettled()` waits for it in headless renders.
  - Embedding the image in the saved file (base64) is to come.
- **Stamp › Wear** (typed pixels and images). Values below a threshold drop out, the threshold varied over the stamp
  by a few octaves of Perlin noise, a different pattern per repeat. Dark values (the low levels of typed pixels) and
  the noise's high spots go first; _Bright parts first_ reverses it. The threshold is 2·Wear − 1 + noise, so 0 leaves
  everything and 1 removes everything; _Wear softness_ fades the edge. Wear fades the coverage, so the worn holes have no
  bevel of their own: worn paint, a scuffed decal.
  - _Level relief_ (0..1): Height › Pattern (GenOut `hval`) becomes a third of the outline's bevel plus a third of a
    bevel up each level edge — "-" ⅓, "+" ⅔, "#" full — from a second texture: on the exact outline the nearest cell
    across the "level ≥ 2" and "level ≥ 3" edges per cell (searched like the outline's, so the steps are as square as
    the colours), on a smoothed one the centre distances, read bilinearly. With Anti-alias on and Random per level,
    the same distances blend the level (and so its colour) across each level edge's pixel, as the outline is
    (stored only for bitmaps of two levels or more; Anti-alias off keeps level edges as hard as the outline).
  - _Smooth outline_ (0 = the exact pixel outline): the staircase of each "level ≥ L" area is traced (diagonal
    neighbours joined); up to 1 each edge is cut back toward its middle (one Chaikin step at ratio a/2, the same from
    either direction; at 1 the loop runs through the edge midpoints, 1:1 staircases straight), then Chaikin rounds it.
    From 1 to 2 the loop is cut at its corners (the direction over five edges either side turning > 70°; tied
    vertices all count) and the runs between them fitted by straight segments (Douglas–Peucker, up to a cell off at
    2, near-ties split toward the run's middle), so uneven stair runs become straight sides; corners round within
    half a cell, more beyond 2. Every step is direction-independent and spans fill with both ends inclusive, so a
    symmetric drawing stays symmetric (tested). Small loops (dots, bars) keep the midpoint outline. Filled even–odd on a grid 2–8× finer (≈ 1.25 px cells) whose centre distances the shader
    interpolates bilinearly — clean curves and wide bevels from a small drawing.
  - Defaults: a warning-triangle stamp, Level relief on, linear bevel, anti-aliased, repeats spaced by a one-cell
    Gap. New layers in the editor (`fresh`) size it about half the texture across, the bevel a third of a cell (½ px
    at pixel-art sizes: crisp, full height at the edge).
- **Label** (`label`) — the Stamp with text laid out on the CPU: the compact 3 × 5 font (capitals; the core font plus
  punctuation it lacked) or the full 5 × 7 one (lower case, descenders on g j p q y, one-cell punctuation), _Letter
  spacing_, _Line spacing_, _Align_ (centre / left / right), _Bold_ (each glyph's uprights doubled, its advance one
  cell wider; with Join diagonals bold is applied after the join, so bold diagonals stay even); the full font's 0 is
  dotted and its 3 round (no diagonals to kink); up to 256 × 128 cells, so long lines are no longer cut. With Join diagonals and Smooth outline ≥ 1 the
  lettering is drawn as strokes (`strokeCells`): cell centres joined to their side neighbours and to corner-only
  neighbours, each run between ends and junctions (and each closed loop) fitted by straight segments (centres up to
  half a cell off) — except that the ends of every straight cell run of three cells or more (and, below Smooth 1.5, of
  any straight run next to a junction or a stroke's end) stay put, so flat tops, bowls and stems stay flat and only the
  uneven stairs between them straighten — and a single straight step is kept too where the stroke turns the same way
  into and out of it (a J's foot, the flat of a cup; between opposite turns it is a stair of a slant and straightens).
  Drawn as round-ended strokes a cell wide whose distance is exact (worked out per fine cell, not rasterised), so
  slanted strokes have clean edges and dots reach full height. An X is two straight diagonals crossing, a slash one
  straight stroke, a lone cell a round dot. Bold sweeps the round pen a cell sideways (a rounded parallelogram per
  segment): wider uprights, counters as tall, the same round ends. A diagonal run that ends beside a bar runs on into
  the bar's corner cell instead of a one-cell stub (z, M). Beyond Smooth 1 each stroke's centre line is corner-cut
  (Chaikin, up to a quarter of each segment at 2), so bends round off inside and out. In stroke mode the compact
  font's B, Q, #, &, @ and J use clearer stroke versions. _Even strokes_ scales the depth so the bevel
  ends 0.4 cell in, inside a one-cell stroke: strokes and their junctions rise alike (no beads). No Level relief (one
  level). Defaults: "BAY 03" in the full font, Join diagonals, Smooth outline 1, Even strokes, rows two cells apart,
  Repeat random from 0.25; new layers in the editor take the compact font below 128 px and the plain pixel outline
  below 3 px cells.
- **Path** (`path`) — exact polygon SDF, units px or fraction (in `paths.ts`, with Polyline); tileable projects evaluate every
  copy within reach (`repGrid`), so a polygon may cross the tile edge (coordinates outside 0..size are fine). _Fill_: even–odd (overlaps cut holes),
  _Union_ (all solid, merged) or _First minus the rest_, combined with hg_sdf's round union / intersection at the
  Corner radius, so the corners where outlines cross round too (a union's inner ones, a cut's outer ones; at radius
  0 the union's inside is √(a² + b²) of the overlapping depths — no groove). _Corner radius_ rounds the corners — all,
  the outer or the inner ones, judged against the filled area: the turn against the polygon's orientation (its
  signed area), flipped for holes (a CPU pass, `cpuData`: polygons inside an odd number of others under even–odd,
  all but the first under First minus the rest). Each edge is trimmed where the round starts, the arc counts
  inside its sector, and the corner between arc and vertex flips the inside (an outer corner cut off, an inner one
  filled). The inside tests run at a point nudged 0.002 px off the pixel centre, so a centre exactly on an edge
  (integer slopes through integer vertices) falls on the same side for the crossing count and the round's corner — it
  used to leave pinholes. _Scale_ and _Rotation_ about the polygons' bounds centre (Shaping › Offset X / Y moves
  them); _Repeat_ X / Y with a step in px. One flat loop runs over the torus copies × the two repeats either side of
  the pixel per axis, skipping any copy whose bounds lie farther than the nearest distance found so far.
  _Grow_ / _Outline_ as on the Stamp. The per-feature random is per filled region — the last polygon containing the point (outside: of the region
  across the nearest edge), so a frame with a hole is one feature. Editor default: the chamfered plate sized to the
  texture, small corner radius, round bevel.
- **Polyline** (`polyline`) — open lines with a width (round or flat ends, round joins): _Corner radius_ bends each
  inner vertex on an arc (the radius of the line's inner edge: the centre line bends on it + half the width, so wide
  lines have no cusp), _Taper_ narrows each line toward its end, start or both over _Taper length_ (a share of the
  line; or _Fixed taper length_, px, for the same tips on every line), shaped straight, smooth or round (brush tips), _Dash length_ / _Dash gap_ / _Dash offset_ along the rounded line (each dash its own random), _Fit dashes to lines_
  (default) stretching dash and gap so every line starts and ends on a whole dash (from each line's length along its
  rounds, worked out once per pixel), _Outline_ = twin rails. Each line's distance is kept apart: _Overlap_ = Merge
  (the union; inside a crossing the two deepest lines combined, no crease) or Later on top (the topmost line's own
  distance, eased into the lines below across its edge pixel; in height its own profile (GenOut `height`, so it may pass
  1 — Height › Amount scales it; default lift 1) raised by _Stack lift_ × a support that eases from a line width + bevel (+ _Lift
  falloff_) outside the lines below to full over their crown, and never below their surface — it arches over them and
  its sides settle onto them; lines that cross nothing keep their height); the per-feature random is
  the topmost line under the pixel, so crossings change colour along the top line's edge rather than the bisector
  (in Merge that edge is pixel-hard in colour). Defaults: a rounded zigzag (sized to the texture for new layers), Later
  on top.
- Bevel notes (`LayerDef.paramPatch`): on the exact pixel outline a Bevel wider than ~1.25 cells notes "raise Smooth
  outline for wide bevels"; on a Label with Even strokes, a Bevel past 0.4 cell notes the cap.
- Shader loops skip work by a flag, never `continue` (ANGLE / D3D11 miscompiles it); cold D3D11 compiles: Stamp,
  Label ~0.6 s, Path ~0.55 s, Polyline ~0.8 s.
- **Cable** (`cable`, `src/layers/generators/cable.ts`) — a tube of radius _r_ wound on a helix of radius _R_ seen
  from the side: screen position `(Pθ/2π + L·sin a, R·cos a)`, depth `R·sin a · back`. 1 strand = coil spring,
  2–8 = twisted rope; _Loop opening_ (L) opens the turns into loops (front and back of a turn part once
  2L > P/2 + 2r), _Reverse twist_ mirrors the lay. Per pixel one flat loop walks the strands' chords within reach
  (vertices on a fixed grid of θ, about 2 px long; the window follows Loop opening and the tube size). Consecutive chords that cover the pixel form one _piece_ of tube — its height the highest
  of theirs (a swept tube: on a chord climbing at slope g the top lies uphill of the nearest point and stands
  √(1+g²) higher), its coverage the largest. The topmost piece wins; where its edge lies over another piece that
  covers the pixel fully the two blend by its coverage, so front-over-back crossings anti-alias. Value = surface
  height above the bed, normalised over the cable's depth; Height › Pattern gets it (GenOut `hval`) over at least a
  tube's diameter, so deeply sunk crowns keep a gentle rise.
  - _Path_: _Angle_ turns the cable (degrees clockwise from its axis). Tiling, the direction snaps to (a·W, b·H) for
    coprime |a|, |b| ≤ 12 so the cable closes on the torus; its length is |(aW, bH)|, its parallel copies are W·H/len
    apart, and a lattice step with a·k₂ − b·k₁ = 1 gives the shift along the cable from one copy to the next.
    _Sag_ drops the centre line by a parabola between the ends (distances across taken square to the bent line: swags,
    festoons); _Start_ / _End_ cut a length whose strands end in rounded tips (chords beyond the ends are dropped; the
    core is capped).
  - _Sink_ raises a bed plane through the cable (0 = standing on the surface; 0.5 = to its axis, a
    half-round moulding whose outline meets the surface without a drop); what lies below it is hidden. _Core_ (ropes)
    fills the gaps behind the strands with a flattened tube along the axis.
  - _Strand variation_ (seeded): each strand swells and thins (tube and helix radius together, so a tight lay stays
    closed) and drifts along its lay, smoothly per half turn; each strand has its own thickness, each row a random lay
    phase, each yarn its own crown height; periodic when tiling (yarn identities repeat after the yarns passing along
    the whole cable).
  - _Fibres_: yarns wound round each strand at _Fibre angle_ to it, grooving it (round yarns in V grooves when wide,
    a plain ripple when narrow, faded under ~2 px). Their phase comes from the nearest point of the smooth strand
    (Newton steps from the chord's), so the polyline doesn't print into them; yarn turns per helix turn are rounded
    when tiling.
  - _Rows_: parallel cables evenly spaced round Position, each shifted by _Row shift_ of a turn; _Alternate row twist_
    mirrors every other one (herringbone). Rows closer than a cable's height are resolved like crossing strands.
  - The outline (union of the tubes' footprints above the bed) is the layer's shape for its mask (Shape by
    default; `sdf: 'mask'`), written by Union.
  - Defaults: a three-strand laid rope, a third sunk, with a core, fibres and some unevenness, sized for 512 px; added
    in the editor (`fresh`) its radius, tube, turns and yarn count follow the texture.
- **Cutoff** (shaping, all generators): coverage only where the shaped value ≥ cutoff (optional softness) — sparse
  flecks from white noise, islands / streaks from fBm.

## Notes

- D3D11 (ANGLE's default on Windows) once compiled the Cable shader extremely slowly — long enough to hang the page.
  Its loop is one flat loop with a uniform-derived bound (rows × strands × chords), and the fibres are evaluated in a
  loop over the one or two surfaces so they compile once; the tiling snap and lattice searches have uniform-derived
  bounds too. A cold D3D11 compile takes ~0.5 s.
- After a GPU hang Chrome blocks WebGL for the page's origin; the harness now launches with
  `--disable-domain-blocking-for-3d-apis` and kills any stale tagged browser before launching.
- Tracing a motif from a reference: `tools/ascii.ts <png> --x --y --w --h --levels 0123456789` dumps luminance
  digits; threshold them into Stamp rows (see FR7.4). Geometric motifs are cleaner drawn from geometry (e.g. a logo
  of two offset ellipses, a top cut and a tapered nail, built by a small Python helper).

## Checklist

- [x] Encoded text params (`pixels`, `font`, `points`) + tests
- [x] Stamp: SDF, levels, mirror, rotate, repeats, row shift, pixel snap, tiling
- [x] Label: 5-row pixel font
- [x] Path: polygon SDF, holes, per-polygon random, tiling
- [x] Quality pass (Stamp, Label, Path, Polyline): exact bitmap SDF at any bevel (CPU nearest-cell map), smooth
      outline, angle, grow, outline, merging / wrapping repeats with jitter, drop out and per-repeat random; 5 × 7 font,
      spacing, align, bold; path corner radius and per-region random; polyline corner radius, taper, dashes, outline;
      editor defaults sized to the texture
- [x] Round 2: union depth for merged repeats, spacing by gap, level relief, straight-run smoothing; label bold
      advance, compact-font default, bridged diagonals; path fill rules, outer / inner rounds, scale / rotation, pinhole
      fix; polyline later-on-top overlap, fitted dashes, taper length
- [x] Round 3: symmetric smoothing, square level steps, gap in cells, join diagonals (Scale2x); label even strokes,
      rounder 3 / dotted 0; path hole-aware outer / inner rounds, rounded booleans, repeats with pruned copies; polyline
      stack lift, taper shape and px length, stack by default
- [x] Round 4: add-only corner bridges for Join diagonals, anti-aliased level colours, bold after the join, Digits
      style; polyline lift eased by distance, above 1, no renormalisation
- [x] Round 5: lettering as fitted strokes (X crossings, slashes), bold by an elliptical pen, Round digits' %; Bevel
      notes; polyline inner-edge corner radius, stack lift 1 by default
- [x] Round 6: stroke fitting keeps straight cell runs (flat c, 8, A), one round terminal for regular and bold, Join
      tooltip, repeat random range
- [x] Round 7: exact stroke distances (clean slants, full-height dots), cup steps kept, full-font punctuation on the
      baseline, compact stroke glyphs, glyph-table test, new labels' Random From 0.25
- [x] Round 8: the core font's "." had six rows and lost its dot (fixed in `core/bitmap.ts`, tested); stroke bends
      round beyond Smooth 1; diagonals into bar corners (z, M); compact stroke J; stepped full-font comma and semicolon
- [x] Cable: helix tubes, strands, loop, back depth, front-over-back resolution
- [x] Cable quality pass: anti-aliased crossings, swept-tube heights, sink, core, irregularity, fibres, rows, angle
      (tile-snapped), sag, cut ends, mask outline, editor rope defaults
- [x] Shaping cutoff
- [x] Stamp image files (Diffuse or Height, alpha cut, smooth image; saved by file name) and Wear
- [ ] Embed stamp images in the saved project file (base64), as an option
- [ ] UI: a pixel editor for Stamp bitmaps (today a monospace textarea) and on-canvas vertex editing for Path
