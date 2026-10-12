# FR7.2c — Motif & ornament generators

**Status:** done — three generator types (`truchet`, `rosette`, `glyph`) in `src/layers/generators/motif.ts` and
`src/layers/generators/motifRadial.ts` (exported as `MOTIF_LAYERS`), and the `symmetry` filter in
`src/layers/filters/symmetry.ts` (exported as `SYMMETRY_FILTERS`). Both lists were already registered by the index
files. Typecheck, lint and smoke tests pass. Checked by eye against the references below.

## Goal
Make the motifs that the generic layers cannot: line networks (circuit boards, mazes, Greek keys), radial
ornaments (teleporter discs, light fittings, medallions), procedural emblems and runes, and a kaleidoscope that
turns earlier noise and shapes into carpet and medallion ornament. Every generator is an SDF generator, so bevel,
etch, emissive and the shape register work as they do for the other shapes. Everything wraps when the project is
tileable, works on non-square and small textures, and keeps 1–2 px lines crisp with anti-aliasing off.

References: circuit boards, polyomino line nets, carpets, medallion panels, teleporters (heptagrams, glowing
discs), sigils, a light fitting, a winged emblem with runes, and other ornamented wall panels.

## Plan
- **`truchet`** draws a line network on a grid of whole cells, with one SDF for all the lines. It offers several
  styles, each built from per-cell (or per-node) hashes evaluated over a 3×3 or 4×4 neighbourhood:
  - Truchet quarter arcs and 10-PRINT diagonals, with a random orientation per tile.
  - Maze walls: every node grows a wall towards a random neighbour.
  - Rooms: every cell links to one neighbour, so rooms are small polyominoes. Walls lie between cells that are not
    linked, and a wall that would be the only one at its end node is dropped, so the walls form a closed net.
  - Greek-key meander: a spiral key of 2·key moves hangs from a rail, and the bands repeat every key + 1 cells.
  - Circuit traces. Tiles are centred on lattice nodes and a trace crosses each tile edge at its midpoint. A coarse,
    tileable Voronoi gives each tile a bus direction: horizontal, vertical or one of the two diagonals. An edge
    carries a trace when both tiles want it, so traces run in parallel buses that bend together at 45°. Diagonal
    buses use one chamfer per tile, alternating with tile parity, which keeps their pitch the same as the straight
    buses. Trace ends get round pads, empty tiles may get vias, and 2×2 chips with pins are optional. Setting
    `regions = 0` gives independent random edges instead: 45° or right-angle turns, T-junctions and pads.
- **`symmetry`** is a single MRT pass (`filterGlsl`). It folds the pixel position per cell of an N×M grid (with
  stagger and optional mirroring of alternate cells) about a centre you can set, then reads every channel at the
  folded position. Reads are nearest (`fetchT`, exact pixel mirrors) or bilinear (`sampleT`) and wrap or clamp by
  tiling. The shape register is folded too, and scaled by the zoom.
- **`rosette`** is a union of radial elements: hub disc, concentric rings, spokes or rays (trapezoids, optional
  taper), a star, petals (vesica or ellipse) and a bead ring (solid or rings). The star can be filled, outlined, or
  drawn as star-polygon lines {n/k} with mitred sharp tips. Elements that repeat round the centre are evaluated in a
  polar fold, with the neighbouring sectors' copies for overlapping petals and rings. Three outputs: shape (SDF),
  glow (falloff from the shape) and radial (1 at the centre to 0 at the radius).
- **`glyph`** draws random walks on a cols × rows node grid, mirrored left–right (the stroke distance is taken at q
  and at its mirror image). Steps go straight or turn, can go diagonal, can bow into arcs, never reverse, and turn
  away from the grid edge. Stroke ends can have dots or rings. A `blocks` style fills cells instead, with an exact
  union-of-cells SDF, for pixel insignia. Instances can each get their own glyph, which gives rune text.
- **Shared repeat wrapper** (rosette, glyph), after shapes.ts: a 3×3 neighbourhood of repeat cells with torus
  copies when tiling, plus row stagger, rotation jitter and dropout. It adds a bounding-circle early-out, so a far
  instance costs one `length()`.

## Checklist
- [x] `truchet`: arcs, diagonal, maze, rooms (closed polyomino net), meander (key size, rail, vertical), circuit
  (bus regions, trace density, 45° share, pads, vias, chips; random mode)
- [x] `truchet`: whole-pixel alignment (each line covers `[k·cell, k·cell + w)`), lattice offset, tileable,
  per-cell / per-bus random
- [x] `symmetry`: mirror X / Y / XY, ╲ and ╱ diagonal mirrors, 8-fold square (D4), rotational n (2–12),
  kaleidoscope n (2–12), repeat-only
- [x] `symmetry`: N×M cells, stagger, mirrored alternate cells, centre, angle, other-side, nearest / bilinear,
  shared source, zoom, source offset, medallion radius + softness, opacity; register folded and rescaled
- [x] `rosette`: hub, rings, spokes / rays (taper ±), star (filled / outline / {n/k} lines, sharp tips), petals,
  bead rings (solid / ring, overlapping), outputs shape / glow / radial, repeat grid
- [x] `glyph`: strokes (walks, diagonals, straightness, curves, end dots / rings), blocks, mirror, per-instance
  variation, pixel snap, repeat grid
- [x] Typecheck (`vue-tsc -b`), oxlint and smoke (`--only truchet,symmetry,rosette,glyph`) clean
- [x] Non-square (256×32), small (24×24) and non-tiling renders checked; 2×2 tiled views show no seams;
  square8 / quad output is exactly pixel-symmetric
- [x] Reference recreations (below)

## Layer reference

### `truchet` (pattern, SDF)

| Param | Default | Notes |
| --- | --- | --- |
| `style` | arcs | arcs · diagonal · maze · rooms · meander · circuit |
| `cells`, `cells_y` | 8, 0 | Cells across / down (0 = square cells). The meander rounds both to a multiple of key + 1 when tiling |
| `width` | 1 px | Line width. Whole-pixel cells and widths give crisp lines with `aa` off |
| `offset_x`, `offset_y` | 0 | Lattice shift, as a fraction of a cell (the polyomino-net reference uses 0.5) |
| `density` | 1 | arcs / diagonal: share of tiles drawn. maze: share of nodes growing a wall. rooms: merging (link probability = 0.6 × density) |
| `key`, `borders`, `vertical` | 2, on, off | Meander: spiral turns (period = key + 1), rail line, orientation |
| `regions` | 6 cells | Circuit bus-region size (0 = random traces) |
| `traces` | 0.85 | Circuit: chance a trace crosses each edge (lower = shorter traces, more pads) |
| `bend` | 0.5 | Circuit: share of diagonal buses (regions), or chance of a 45° turn (random mode) |
| `pad`, `vias`, `chips` | 1 px, 0.3, 0 | Circuit pad radius, lone-via chance, chance of a 2×2 chip per 4×4 block |

Defaults: height +0.4 (round bevel 1 px), flat gold diffuse. `rnd`: per cell (arcs, diagonal, maze, rooms), per
period (meander), per bus region (circuit with regions) or per tile (random circuit).

### `symmetry` (filter)

| Param | Default | Notes |
| --- | --- | --- |
| `mode` | square8 | mirror-x · mirror-y · quad · diagonal (╲) · antidiagonal (╱) · square8 (D4) · rotate · kaleido · repeat |
| `n` | 6 | Order for rotate / kaleido (2–12) |
| `angle` | 0° | Rotates the mirror axes / wedges |
| `flip` | off | Read the other half or wedge. The default source is the left / top / top-left half, or the wedge from up towards up-left |
| `cx`, `cy` | 0.5 | Fold centre within each cell (y down) |
| `nearest` | on | texelFetch (exact pixel mirrors) vs bilinear |
| `cells_x`, `cells_y`, `stagger`, `alt` | 1, 1, 0, off | Grid of folds; odd-row offset; mirror alternate cells (wallpaper) |
| `shared`, `zoom`, `src_x`, `src_y` | off, 1, 0, 0 | All cells copy the top-left cell's source; magnification; source offset (fraction) |
| `radius`, `soft`, `opacity` | 0, 0 px, 1 | Fold only inside a medallion (fraction of half a cell, 0 = whole cell); edge softness; mix |

### `rosette` (pattern, SDF, repeatable)

| Group | Params (defaults) |
| --- | --- |
| Pattern | `output` shape · glow · radial; `glow` 6 px; `radius` 28 px; `x`, `y` 0.5; `rotation` 0; `hub` 0 (fraction) |
| Rings | `rings` 2, `ring_w` 2 px, `ring_in` 0.82 (innermost, fraction; the outer ring's edge sits on the radius) |
| Spokes | `spokes` 0, `spoke_w` 2 px, `spoke_taper` 0 (1 = sharp tip, −1 = sharp at centre), `spoke_in` 0.15, `spoke_out` 1, `spoke_off` 0 (fraction of a step) |
| Star | `star` 8 points, `star_mode` lines (filled · outline · lines {n/k}), `star_r` 0.8, `star_inner` 0.45, `star_skip` 3, `star_sharp` on, `star_w` 2 px |
| Petals | `petals` 0, `petal_shape` pointed (vesica) · round, `petal_pos` 0.55, `petal_len` 0.7, `petal_w` 0.25, `petal_off` 0 |
| Beads | `dots` 0, `dot_r` 1.5 px, `dot_w` 0 (> 0 = rings; overlapping rings give flower-of-life patterns), `dot_pos` 0.9, `dot_off` 0 |
| Repeat | `rep_x`, `rep_y` 1, `rep_stagger` 0, `rep_rot` 0°, `rep_drop` 0, `seed` |

Element fractions are relative to `radius`. The default draws an 8-point {8/3} star inside two rings. `rnd` is per
instance.

### `glyph` (pattern, SDF, repeatable)

| Param | Default | Notes |
| --- | --- | --- |
| `style` | strokes | strokes (runes, sigils) · blocks (pixel insignia) |
| `cols`, `rows` | 5, 5 | Nodes (strokes) or cells (blocks), 2–9. Odd column counts give a centre column |
| `size` | 32 px | Glyph height (node span for strokes, cell span for blocks) |
| `width` | 2 px | Stroke width |
| `strokes`, `steps` | 4, 3 | Random walks per glyph, segments per walk (≤ 8 each) |
| `diag`, `straight`, `curve` | 0.4, 0.35, 0 | Chance of a diagonal turn, of keeping direction, of a bowed (Bézier) segment |
| `dots`, `dot_ring` | 0 px, off | End-dot radius, drawn as rings when on (sigil style) |
| `density` | 0.5 | Blocks: fill fraction |
| `mirror`, `vary`, `snap` | on, on, on | Left–right symmetry; a different glyph per instance; nodes on the pixel grid |
| placement + repeat | as rosette | `x`, `y`, `rotation`, `rep_*`, `seed` |

## Reference recreations
Full projects (existing layers plus these; post = tonemap, then palette `doom` or `quake`):

| Reference | Recipe | Match |
| --- | --- | --- |
| Circuit board | noise bg + `truchet` circuit, 32 cells (2 px), width 1, regions 5, traces 0.88, bend 0.6, pad 0.8, random orange ramp | Very close: parallel buses at 2 px pitch, 45° bends, diagonal regions, pads |
| Polyomino line net | white-noise bg + `truchet` rooms, 8 cells, offset 0.5, width 1, density 0.75, yellow + faint emissive | Close: closed polyomino net. Rooms are slightly more varied in size than the reference |
| Teleporter (heptagram) | rect panel + rivets + `rosette` radial ramp + 56 thin spokes + {7/3} lines (width 3, sharp) + small ring | Very close |
| Teleporter (glowing disc) | disc + `rosette` (3 rings, {16/5} lines, 8 overlapping bead rings) with emissive + glow | Good in character; the interlace pattern differs |
| Light fitting | grid bars + `rosette` bead ring + `rosette` radial-output emissive disc | Close |
| Carpet | white-noise red + thresholded value noise (scale 24) → `symmetry` square8 + tan grid | Good ornament character; the reference motifs are more regular "stamps" |
| Medallion panel | thresholded noise height → `symmetry` square8 + rect frames + `rosette` rings / beads + cavity | Close in mood and layout |
| Sigils | wood + `rosette` ×2 ({7/3} lines in a ring) + `glyph` ×2 (3×5, curves, ring dots) | Close: pentagram circles and sigils read correctly |
| Winged emblem with runes | wood panel + `glyph` wings (9×4, diagonal, straight) + hub + rune-text row + blocks | Partial: the runes work; the wings only roughly suggest feathers |

## Notes and constraints
- **Pixel alignment.** Lattice lines are shifted by half the line width, so a 1 px line covers exactly one pixel
  column or row when cells are whole pixels. Diagonals of odd width pass through pixel centres, giving clean
  staircases. The circuit's 2 px cells give a 1-on / 1-off circuit-board look. Glyph `snap` puts nodes on pixel
  centres for odd widths and on corners for even ones (blocks: cell edges on pixel boundaries). Rotation breaks
  the alignment.
- **Tiling.** Every hash uses wrapped cell, node or region indices. Circuit regions use a Voronoi with an integer
  period, and chips are only placed in whole 4×4 blocks. Use an **even cell count** for circuits, because diagonal
  buses alternate by tile parity. Meander counts round to multiples of the key period. Rosette and glyph repeats
  wrap their 3×3 neighbourhood as the shape layers do.
- **Symmetry exactness.** With nearest sampling, mirror, quad and square8 modes on whole-pixel cells are exactly
  pixel-symmetric (verified: zero differing pixels). Rotation-only folds show seams by nature, wherever
  non-matching wedge edges meet. Folding the shape register keeps mirror distances exact on the source side. Near
  fold lines the mirrored copy can be closer than the stored distance, so it slightly overestimates there. That is
  harmless for bevels.
- **Polar elements.** Spokes, petals and beads are evaluated in a sector fold. Petals also evaluate the ±1 sector
  copies, and beads as many as their radius needs (up to ±4), so overlapping rings and long petals stay exact.
  `{n/k}` lines with `star_sharp` are bands along the chord lines, clipped by the polygram outline grown by half
  the width. Its edges are all tangent to one circle, so growing it is a uniform scale with mitred tips. The
  outline is `sdStar` with divisor `2n / (n − 2k + 2)`. Without `star_sharp` (or when n ≤ 2k), the strokes are
  capsules with round ends.
- **Cost.** truchet: at most 16 segments per pixel, except the circuit, which caches the bus direction and chip
  flag of the 5×5 tiles around the pixel (a 3×3 Voronoi each) before evaluating 3×3 tiles. rosette: O(n) for
  `{n/k}` lines, O(1) for the rest. glyph: at most 64 strokes (each evaluated at q and its mirror image) or 81
  block cells per nearby instance, after the bounding-circle early-out. symmetry: one pass, three fetches (or 12
  bilinear).
- **Seeds.** `uSeed` can be negative (see below), so these layers hash with `abs(uSeed)` (`GLSL_MOT_SEED` in
  motifRadial.ts).

## Recommended shared changes (not made — outside this feature's files)
- **`mixSeed` (src/gpu/uniforms.ts) returns negative seeds.** `h ^= h >>> 12` turns `h` back into a signed int32,
  so `h % 65521` can be negative. GLSL `uint()` of a negative float is undefined (SwiftShader gives 0), so many
  layer seeds produce **identical output in every layer that hashes with `uSeed`**. For example, bricks with seed 1
  and seed 7 render byte-identical. Fix: `return (h >>> 0) % 65521`. This changes which pattern each seed gives in
  existing projects. Once it is fixed, the `abs()` workaround here is harmless.
- **Registration.** `MOTIF_LAYERS` now exports `[truchet, rosette, glyph]` and `SYMMETRY_FILTERS` exports
  `[symmetry]`. No index change is needed.
- **Possible follow-ups:** a preset or two built from the recreations (circuit board, teleporter, carpet
  kaleidoscope), and an `fr7.2c` row in the architecture feature index.
