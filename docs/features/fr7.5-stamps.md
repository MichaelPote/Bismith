# FR7.5 — Stamps, labels, paths & cables

**Status:** done (generators); used throughout the FR7.4 recreations

## Goal
Some texture motifs are *drawn*, not grown: a crate's winged skull, a stencilled "03", a logo burned into a
switch, a lightning-bolt channel routed through a door, a rope moulding. Procedural motifs only approximate these,
and that approximation is what made optimiser results look aimless. These generators take deliberate, hand-authored
input and still behave like every other shape: they are SDFs (bevel, profile, shape register, clipping) and they
light through the path tracer.

## Design
- **Encoded text params** (`src/core/bitmap.ts`, `src/gpu/uniforms.ts`). A `text` param may declare
  `bitmap: 'pixels' | 'font' | 'points'`; it is then uploaded:
  - `pixels` — rows of cell characters (`#` full, `+` mid, `-` low, `.`/space empty; ≤ 64×64) packed 2 bits per
    cell into `ivec4 u_<key>[64]` + `ivec2 u_<key>_size`.
  - `font` — the same layout, rendered from text with a built-in 5-row pixel font (digits, capitals, `- . : / ! + = #`;
    `|` or a new line starts a centred line).
  - `points` — polygons (`x,y x,y …`, one per line or `|`, ≤ 64 vertices) as `vec4 u_<key>[64]`
    = (x, y, index of the polygon's next vertex, polygon index) + `ivec2 u_<key>_size` (vertices, polygons).
- **Stamp** (`stamp`, `src/layers/generators/stamp.ts`). SDF = distance to the nearest cell of the other state
  (searched within the bevel, ≤ 4 cells), so bevels follow the pixel outline. Placement by centre (0..1), pixel size,
  rotation in 90° steps, mirror (draw the left half; odd = shared centre column), repeats (count / step) with a
  **row shift** (skew) for diagonal rivet lines. Instances snap to the pixel grid. The cell level (1..3) is the
  per-feature random, so a *Per-feature random* colour ramp paints multi-tone stamps. Wraps on tileable projects.
- **Label** (`label`) — the Stamp with a `font` bitmap.
- **Path** (`path`) — exact polygon SDF (even–odd, so overlapping polygons cut holes), units px or fraction, the
  per-feature random is per polygon; tileable projects evaluate the 3×3 neighbouring copies so a polygon may cross
  the tile edge (coordinates outside 0..size are fine).
- **Cable** (`cable`, `src/layers/generators/cable.ts`) — a tube of radius *r* wound on a helix of radius *R* seen
  from the side: screen position `(Pθ/2π + L·sin a, R·cos a)`, depth `R·sin a · back`. Each pixel takes the topmost
  tube surface it lies inside (fringe hits only anti-alias where no tube covers the pixel), so front strands cross
  over the back of the loops. 1 strand = coil, 2–4 = twisted rope; *Loop* (L) opens the strands into loops (its sign
  sets the twist direction). Value = surface height normalised over the cable depth.
- **Cutoff** (shaping, all generators): coverage only where the shaped value ≥ cutoff (optional softness) — sparse
  flecks from white noise, islands / streaks from fBm.

## Notes
- D3D11 (ANGLE's default on Windows) compiles the Cable shader extremely slowly — long enough to hang the page.
  The loop is flattened with a uniform-derived bound to discourage unrolling, but the studio runs on
  `BISMITH_ANGLE=gl` (ANGLE on the NVIDIA OpenGL driver), which compiles it instantly.
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
- [x] Cable: helix tubes, strands, loop, back depth, front-over-back resolution
- [x] Shaping cutoff
- [ ] UI: a pixel editor for Stamp bitmaps (today a monospace textarea) and on-canvas vertex editing for Path
