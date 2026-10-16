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
- **`truchet`** draws a line network on a grid of whole cells, with one SDF for all the lines. Arcs, diagonals and
  the meander are built in the shader from per-tile hashes over a 3×3 neighbourhood; the maze, rooms, labyrinth and
  circuit need the whole grid, so the CPU lays them out (`cpuData`, below) and the shader draws them:
  - Truchet quarter arcs and 10-PRINT diagonals, with a random orientation per tile; a share of tiles can cross
    (+ / X) with an over-under weave whose strands rise and sink in Height.
  - Maze walls: every node grows a wall towards a random neighbour; pieces under five walls are dropped.
  - Rooms: every cell links to one neighbour, so rooms are small polyominoes. Walls lie between cells that are not
    linked, and a wall that would be the only one at its end node is dropped, so the walls form a closed net;
    neighbouring rooms then merge into bigger ones.
  - Labyrinth: a perfect maze.
  - Greek-key meander: a running key (one continuous line spiralling in and out of every key), or spiral keys
    hanging from a rail.
  - Circuit traces: parallel buses that bend together at 45°, or routed traces; pads, vias, IC chips, empty board
    and wide power traces.
  - **Draw** lines, grooves (everything but the lines) or, for arcs, two-tone fills; round or square **caps**.
- **`symmetry`** is a single MRT pass (`filterGlsl`). It folds the pixel position per cell of an N×M grid (with
  stagger and optional mirroring of alternate cells) about a centre you can set, then reads every channel at the
  folded position. Reads are nearest (`fetchT`, exact pixel mirrors) or bilinear (`sampleT`) and wrap or clamp by
  tiling. The shape register is folded too, and scaled by the zoom.
- **`rosette`** is a union of radial elements: hub disc, concentric rings (graded widths), spokes or rays
  (trapezoids, optional taper, alternate lengths), a star, petals (vesica or ellipse, solid or outlined) and a bead
  ring (solid or rings). The star can be filled, outlined, or drawn as star-polygon lines {n/k} with mitred sharp
  tips. Elements that repeat round the centre are evaluated in a polar fold, with the neighbouring sectors' copies
  for overlapping petals and rings. Three outputs: shape (SDF), glow (falloff from the shape) and radial (1 at the
  centre to 0 at the radius); glow and radial switch the layer to Emissive (linked defaults). A sculpted relief
  gives each element its own section and height (domed lines, beads and hub; ridged rays, petals and filled
  stars), and a fillet (smooth union) and a hub clearance tidy the joins.
- **`glyph`** draws random walks on a cols × rows node grid, mirrored left–right (the stroke distance is taken at q
  and at its mirror image). Steps go straight or turn, can go diagonal, can bow into arcs, never reverse, and turn
  away from the grid edge. Stroke ends can have dots or rings. A `blocks` style fills cells instead, with an exact
  union-of-cells SDF, for pixel insignia. Instances can each get their own glyph, which gives rune text.
  Follow-ups (below): overlap control, splines, taper, node jitter, centring, open ring dots, top–bottom mirror;
  then (quality pass) stroke ends (square, flat, pen), mitre joins, width variation, a broad-nib calligraphy pen,
  connected walks, dots only on free ends and gaps between blocks.
- **Shared repeat wrapper** (rosette, glyph), after shapes.ts: the repeat grid laid out by `repGrid` (glsl/common.ts,
  shared with the shapes, vents and tabs), with copies round the torus when tiling, plus Column / Row spacing, row
  stagger, rotation, size and position jitter and dropout. It visits every instance whose bound (plus jitter and
  blur) can reach the pixel, and at least the neighbours within a step and a half, nearest first; an instance is
  measured only when its bounding circle (`r − bound`, a lower bound) could beat the nearest distance so far, so a
  far instance costs one `length()` and the distance stays exact (see *Exact distance* below). Taps × instances are
  one flat loop with a pixel-dependent bound (one copy of the motif's SDF in the shader). Size jitter evaluates an
  instance at q / s and scales its distance by s ≤ 1; position jitter moves an instance up to half a step.
- **Column / Row spacing** (`col_sp`, `row_sp`, −1 … 1; also on the shapes, vents and tabs on a grid): the step
  between instances is the texture over the count plus the spacing × the texture (1 = a whole width / height more;
  never below 0, so −1 stacks them). The grid stays centred (X / Y place it within a step); when tiling, instances
  pushed past an edge come round the other side, so the texture stays seamless and only the gap across the seam
  differs. Per axis, `repGrid` walks the instances in order (a run of slots, copy k's instance c being slot k·n + c)
  while the row fits in one period — at spacing 0 exactly the old lattice, pixel-identical — and copy by copy once
  spacing pushes it past a period (the copies overlap).

## Compile time
Truchet holds all its styles in one shader, so every compile builds all of them. D3D inlines every call, so each
helper has one call site: loops over the axes / edges / ends with their arguments chosen first, the circuit tile's
cases only picking up to two segments and two pads that one loop then measures, edges and flags as bit masks rather
than local arrays (D3D compiles dynamically indexed local arrays slowly), the meander's moves, step and rail through
one segment call. Loop bounds read from a uniform (`MOT_1`) keep D3D from unrolling them. Laying the maze, rooms and
circuit out on the CPU took their per-pixel link tests, region Voronoi and chip search out of the shader: 1.2 s cold
(2.2 s before). Measure with `tools/compile-time.ts`.

## Checklist
- [x] `truchet`: arcs (crossings, over-under weave, two-tone), diagonal, maze (fragments dropped), rooms (closed
  polyomino net, merging), labyrinth (perfect maze, twist, braiding), meander (running key or spirals, key size,
  rail, vertical), circuit (bus regions or routed traces, trace density, 45° share, junctions, pads, vias, IC chips
  of any size, scatter, empty board, wide traces); Draw lines / grooves / two-tone; caps
- [x] `truchet`: whole-pixel alignment (each line covers `[k·cell, k·cell + w)`), lattice offset, tileable,
  a random per cell, room, trace or period; new layers' width sized to the texture, bevel and pads linked to the
  width, cells to the style
- [x] `motif.test.ts`: defaults and links, the labyrinth (a spanning tree, framed when untiled, no long runs,
  fragments dropped), merged rooms, the circuit without loops, maze pieces, the uniforms
- [x] `symmetry`: mirror X / Y / XY, ╲ and ╱ diagonal mirrors, 8-fold square (D4), rotational n (2–12),
  kaleidoscope n (2–12), repeat-only
- [x] `symmetry`: N×M cells, stagger, mirrored alternate cells, centre, angle, other-side, nearest / bilinear,
  shared source, zoom, source offset, medallion radius + softness, opacity; register folded and rescaled
- [x] `rosette`: hub, rings, spokes / rays (taper ±), star (filled / outline / {n/k} lines, sharp tips), petals,
  bead rings (solid / ring, overlapping), outputs shape / glow / radial, repeat grid
- [x] `glyph`: strokes (walks, diagonals, straightness, curves, end dots / rings), blocks, mirror, per-instance
  variation, pixel snap, repeat grid
- [x] `glyph` follow-ups: overlaps chance, spline lines (roundness), taper, node jitter, centre glyph (strokes and
  blocks), open ring dots, Mirror Y (alone or with X for four-fold glyphs)
- [x] Quality pass (both): editor-fresh layers sized to the texture; bevel linked to the line widths (domed lines);
  wider slider ranges; repeat size and position jitter; rosette graded rings, alternate spoke lengths, petal
  outlines, glow / radial → Emissive; glyph stroke ends (round / square / flat), width variation, calligraphy
  (broad nib), block gaps. Glow early-out ring fixed
- [x] Exact distance and spacing: the repeat's fixed early-out (`r − bound` past bound + 4 px) left rings in a
  Bevel / Etch reading the shape mask wherever bound circles reached past their cells; now pruned against the
  nearest distance (exact). Column / Row spacing on rosette, glyph (and the shapes, vents, tabs). Glyph `dot_chance`
- [x] Quality pass, second round: rosette sculpted relief with per-element heights, fillet, hub clearance, star
  offset, glow softness, fresh star tips into the inner ring; glyph pen ends (free ends, nib not mirrored), mitre
  joins, connected walks, dots only on free ends, Diagonals 0 strict. The improved values are the plain defaults
- [x] Typecheck (`vue-tsc -b`), oxlint and smoke (`--only truchet,symmetry,rosette,glyph`) clean
- [x] Non-square (256×32), small (24×24) and non-tiling renders checked; 2×2 tiled views show no seams;
  square8 / quad output is exactly pixel-symmetric
- [x] Reference recreations (below)

## Layer reference

### `truchet` (pattern, SDF)

| Param | Default | Notes |
| --- | --- | --- |
| `style` | arcs | arcs · diagonal · maze · rooms · meander · circuit · labyrinth |
| `draw` | lines | lines · grooves (the shape is everything but the lines: `−sdf`, clamped at −10⁴ far from any line so it stays above `NO_SDF`) · two-tone / two-tone swapped (arcs: alternate regions filled, inset by half the width — the lines are the gaps; other styles: as grooves) |
| `cells`, `cells_y` | 8, 0 | Cells across / down (0 = square cells), up to 1024. The meander rounds both to a multiple of its period when tiling, two-tone arcs to even counts. `cells` follows the style until set (arcs 8, diagonal 12, maze 12, rooms 8, meander 15, circuit 32, labyrinth 16) |
| `width` | 1 px (new layers: texture / 85, 6 px at 512) | Line width (grooves: the groove; two-tone: the gap). Whole-pixel cells and widths give crisp lines with `aa` off |
| `caps` | square | maze · rooms · meander · labyrinth: square line ends and mitred corners (the segment's box) or round (sdSegment) |
| `offset_x`, `offset_y` | 0 | Lattice shift, as a fraction of a cell (the polyomino-net reference uses 0.5) |
| `density` | 1 | Labelled per style (`labelFor`). Tiles drawn (arcs / diagonal, not two-tone): share of tiles drawn. Walls (maze): share of nodes growing a wall. Room size (rooms): link chance = 0.6 × density. Perfection (labyrinth): below 1 opens dead ends into loops (all by 0.5), below 0.5 also knocks out walls (half at 0), then drops wall fragments under five walls |
| `cross` | 0 | Arcs / diagonal: share of the drawn tiles that cross instead (+ of straight lines, or an X) |
| `weave` | 0 px | Over-under at crossings: the under strand stops this far from the over strand; the over strand alternates with tile parity, so all-crossing grids weave. A fraction of a pixel = an unbroken weave |
| `dip` | 0.6 | Over-under depth, in Height (`hval` = bevel × strand height): plain strands at 1 − 0.45·dip; a crossing's strands follow one cosine, 1 − 0.45·dip ± 0.45·dip·cos(π/2 · t) (t = 0 at the crossing, 1 at the tile edge): a crown on the over strand, a trough on the under one, steepest midway between crossings |
| `prune` | on | Maze, *Drop fragments*: union-find over the lattice nodes gathers the walls into pieces; pieces under five walls are dropped |
| `merge` | 1 | Rooms: 0–3 merge passes (each pairs rooms with a random neighbour, the fraction a share); walls only between rooms, so no stubs inside one |
| `twist` | 0.5 | Labyrinth: chance a corridor turns at each cell; a straight run is capped at 2 + 6·(1 − twist) cells. The maze grows depth-first 85 % of the steps, from a random open cell otherwise |
| `key_style` | running | Meander: the running key — one line spiralling in (up 2k + 1, right 2k + 1, down 2k, … 1), a step across, and back out between its turns (… 2k, 2k + 1) into the next unit; period 2k + 2 along the band, 2k + 2 across (+ 1 with the rail, one cell below the key); every corridor one cell, though tiling can leave the cells slightly non-square — or spirals hanging from a rail (period key + 1) |
| `key`, `borders`, `vertical` | 2, on, off | Meander: key size (1–12; running: turns; spirals: first arm), rail line, orientation |
| `regions` | 6 cells | Circuit bus-region size: a tileable Voronoi of this size gives each tile a bus direction; an edge carries a trace when both tiles want it and a Trace density draw passes; loops are broken at their junctions first (runs stay whole), buses wrapping round a tiled texture kept (a union-find with unwrapped offsets tells them apart). 0 = routed traces: walks that never touch (no loops, no junctions), mostly straight, from the chip pins first, to about 60 % of the free board |
| `traces` | 0.85 | Circuit: chance a trace crosses each edge (lower = shorter traces, more pads) |
| `bend` | 0.5 | Circuit: share of diagonal buses (regions), and chance a turn is cut at 45° |
| `empty`, `wide` | 0.25, 0.12 | Circuit: share of the board in value-noise blobs without traces; share of whole traces (six or more tiles, not to a chip) at 2.5 × the width |
| `junctions` | 0.2 | Circuit (buses): chance a 3- or 4-trace tile joins them; otherwise the odd trace stops in a pad short of the through trace, or the four turn in chamfered pairs |
| `pad`, `vias`, `chips` | 1 px, 0.3, 0 | Circuit pad radius (follows the width until set), lone vias (on 0.3 × this share of the free tiles outside the blobs), chance of a chip per block |
| `chip_style` | IC | IC: square legs on every outline side (at least a trace wide, out to the tile edge where traces meet them, standing a fifth of the inset off the body) and a notch at the −x end; or plain: a slab, the traces running in under it |
| `chip_w`, `chip_h`, `chip_scatter` | 2, 2, 4 | Chip size in tiles; the block is size + 2 + scatter tiles, the chip at a random place in it at least one tile in (0 = a regular grid); 85 % of the outline sides get a pin |

Defaults: height +0.4 (round bevel 1 px, linked to half the width), flat gold diffuse. `rnd`: per cell (arcs,
diagonal, maze, labyrinth), per room (rooms: each slab one random, for per-feature height or random colour), per
period (meander), per connected trace (circuit; a chip with its traces).

**Two-tone.** Truchet arcs (and their + crossings) are 2-colourable: every region holds lattice nodes of one parity
(a corner quarter-disc its corner, the band between the arcs the two other corners, a crossing's quadrant its
corner), so the pixel's region colour is (cell.x + cell.y + node offset) mod 2 from its own tile alone.

**CPU layouts (`cpuData`).** One RGBA8 texture of (cells + 2)² texels, cell c at c + 1 so an untiled project's
border cells fit; other styles get a 1×1 texture. Maze, rooms, labyrinth: R, G = the random (16 bits), B = the
cell's walls (bit 0 its +x wall, bit 1 its +y wall). The labyrinth is a randomised walk (a perfect maze; wrapping when
tiling, framed when not). Circuit: R, G = the trace's random; B = bit 0 the +x edge, bit 1 the +y edge, bit 2 wide,
bit 3 a lone via, bits 4–6 the bus direction + 1, bit 7 chip; A = the tile's place in its chip (x | y << 4). The
shader still draws every tile's geometry (straight or diagonal bus, chamfered turns, junctions, pads, chip bodies
and legs) from those bits.

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
| Pattern | `output` shape · glow · radial; `glow` 6 px, `glow_soft` 0.6 (blur of the glow over a Vogel disc of 16 taps, radius ½ · softness · glow: a bloom without the distance field's creases); `relief` sculpted · bevel (one Edge bevel round the whole rosette); `blend` 0 px (fillet: smooth union of the elements); `radius` 28 px; `x`, `y` 0.5; `rotation` 0; `hub` 0.1 (fraction), `hub_gap` 0 px (clearance: spokes, star, petals and beads stop this far outside the hub, or clear a disc at the centre without one), `hub_h` 0.9 |
| Rings | `rings` 2, `ring_h` 1, `ring_w` 2 px, `ring_in` 0.8 (innermost, fraction; the outer ring's edge sits on the radius), `ring_w_in` 1 (innermost ring's width × Ring width, graded between: 0.3 = heavy rim, fine inner rings) |
| Spokes | `spokes` 0, `spoke_h` 0.55, `spoke_w` 2 px, `spoke_taper` 0 (1 = sharp tip, −1 = sharp at centre), `spoke_in` 0.15, `spoke_out` 1, `spoke_off` 0 (fraction of a step), `spoke_alt` 0 (every other spoke shortened by this share; even counts) |
| Star | `star` 8 points, `star_mode` lines (filled · outline · lines {n/k}), `star_r` 0.77 (the tips end in the inner ring), `star_off` 0 (turn, fraction of a point step), `star_h` 0.65, `star_inner` 0.45, `star_skip` 3, `star_sharp` on, `star_w` 2 px |
| Petals | `petals` 0, `petal_shape` pointed (vesica) · round, `petal_pos` 0.55, `petal_len` 0.7, `petal_w` 0.25, `petal_off` 0, `petal_line` 0 px (> 0 = outlines; each petal its own band, so overlapping petals cross into a lattice — fused at one height, no over-and-under weave), `petal_h` 0.8 |
| Beads | `dots` 24, `dot_h` 0.8, `dot_r` 1.5 px, `dot_w` 0 (> 0 = rings; overlapping rings give flower-of-life patterns), `dot_pos` 0.9, `dot_off` 0 |
| Repeat | `rep_x`, `rep_y` 1, `rep_stagger` 0, `rep_rot` 0°, `rep_scale` 0 (size jitter: each instance 1 − share × random of its size), `rep_jit` 0 (position jitter, up to half a step), `rep_drop` 0, `col_sp`, `row_sp` 0 (Column / Row spacing: the step grows by this share of the texture width / height; −1 … 1), `seed` |

Element fractions are relative to `radius`. The default is a medallion: two rings with a 24-bead ring between them,
an 8-point {8/3} star whose tips end in the inner ring and a hub, sculpted in layers (rings highest, hub, beads, the
star lower). `rnd` is per instance; a single rosette has no randomness (the seed drives the repeat's jitter and dropout).

**Sculpted relief** (`relief` sculpted, shape output, shape mask off or Normal): Height › Pattern takes the
elements' own sections instead of the Edge bevel. Each element leaves its distance, its depth at full height and
its kind in a slot (hub, rings, spokes, star, petals, beads), and one loop makes the union, the height and the
nearest element's height and section: the height is the highest element at the point, its own height (`*_h`, 0..1)
× a dome √(x(2 − x)) (lines, beads, hub, petal and star outlines) or a ridge x (rays, solid petals, filled stars:
faceted along the spine), x = depth inside / its depth at full height (half its line width, its radius, the half
width where the point is along a ray, the petal's half width, the star's inradius). Fillets get the union's depth
at the nearest element's height and section. Combined with the shape mask (Union, Subtract…) the drawn shape isn't
the rosette's alone, so the Edge bevel applies.

Added in the editor (`fresh`), the rosette fills 80 % of the texture's short side, its line widths 3.5 % of the
radius and its beads 2.6 %.
**Linked defaults:** the bevel is half the narrowest active line (rings — the innermost when graded —, spokes, star
lines, bead rings, petal outlines), so every element rises to full height, the narrowest with a round section and
wider ones with rounded shoulders (a fiftieth of the radius with filled elements only); it follows the widths until
set by hand. The glow and radial outputs switch Diffuse and Height off and Emissive on (a glow's coverage is the
whole texture, so Diffuse would paint everything); shape switches them back.

### `glyph` (pattern, SDF, repeatable)

| Param | Default | Notes |
| --- | --- | --- |
| `style` | strokes | strokes (runes, sigils) · blocks (pixel insignia) |
| `cols`, `rows` | 5, 5 | Nodes (strokes) or cells (blocks), 2–9. Odd column counts give a centre column |
| `size` | 32 px | Glyph height (node span for strokes, cell span for blocks) |
| `width` | 2 px | Stroke width |
| `width_var` | 0 | Each stroke × (1 − 0.9 · share · random): bold main strokes, fine secondary ones |
| `pen`, `pen_angle` | 0, 30° | Calligraphy: broad nib. The half width × mix(1, max(\|sin(tangent − nib)\|, 0.08), pen), with the tangent of the curve at its nearest point; strokes along the nib turn to hairlines. The nib is the same on both sides of a mirror (in a mirror image's frame it is mirrored), so ╱ and ╲ get different weights as a pen gives them |
| `cap` | round | Stroke ends: round · square (a box end half a width past the node) · flat (cut at the node) · pen (cut along the nib: past the node the band runs on straight up to the cut, into the stroke before it; hairlines along the nib turn the cut square). Linked to Calligraphy: pen while it is above 0. Applied past the first and last node of each stroke (where the curve parameter clamps), at free ends only: a node arrived at more than once (another stroke, the stroke itself) or on a mirror axis (the mirror image meets it there, unless the end segment runs along the axis) stays round, as do the joints within a stroke — a square end there would stick out of the joint, and a pen cut would leave a crease in the stroke it joins. Needs the two-pass walk (as centring and taper), which collects the revisited nodes |
| `join` | round | Straight lines: round · mitre. Mitre fills, past a segment's end, the corner where its band and the next one's cross (reaching hw · tan(turn / 2) along it) — at joints within a stroke and where a stroke meets its mirror image on an axis. Cutting each band at the bisector instead would leave a zero-distance crack in the bevel along it. Turns sharper than ≈ 133° stay round |
| `jitter` | 0 | Random offset per node, up to ½ · jitter · spacing per axis. One offset per node, so strokes that share a node still meet; mirrored glyphs mirror the offsets (axis nodes stay on the axis) |
| `taper` | 0 | Thins each stroke towards its ends: half width × mix(1, 4u(1 − u), taper), u = 0..1 along the whole stroke (by segment count). 1 = pointed tips |
| `strokes`, `steps` | 4, 3 | Random walks per glyph, segments per walk (≤ 8 each) |
| `diag`, `straight` | 0.4, 0.35 | Chance of a diagonal turn, of keeping direction. Diagonals 0 means none at all: a boxed-in step doesn't fall back to a diagonal |
| `connect` | 0.85 | Chance a stroke starts on a node already drawn (a reservoir sample of the nodes stepped on from), so glyphs hang together; above 0 the first stroke starts at the centre node (on the axis with Mirror X and an odd column count) |
| `overlap` | 0.3 | Chance a step may land on a node already drawn (by any stroke, or the mirror image: visited nodes are kept as a folded bitmask). A step that may not and finds no free direction ends the stroke |
| `line` | straight | straight (segments, optional arcs) · spline (Catmull-Rom through the nodes) |
| `curve` | 0 | Straight lines: chance of a bowed (Bézier) segment |
| `roundness` | 1 | Splines: tangent scale (0 = straight, 1 = Catmull-Rom, 2 = loopy) |
| `dots`, `dot_joins`, `dot_ring` | 0 px, off, off | `dot_joins` off: dots only on free stroke ends (two-pass walk). End-dot radius; rings when on. Rings are open (strokes stop at the ring); the ring line is the stroke width, at most half the radius, so small rings keep a hole |
| `dot_chance` | 1 | Chance each stroke end gets its dot (one draw per end, shared by its mirror images; only ends that get a ring stop the strokes) |
| `density` | 0.5 | Blocks: fill fraction |
| `gap` | 0 px | Blocks: space between cells. 0 merges neighbours into one shape (exact union distance); > 0 gives separate tiles (the nearest tile's box distance is exact) |
| `mirror`, `mirror_y` | on, off | Mirror X (left–right) and Mirror Y (top–bottom) symmetry; both give four-fold glyphs. Strokes are evaluated at q and each mirror image of it; visited nodes, jitter and block cells are keyed by the node folded onto the top-left |
| `centre`, `vary`, `snap` | on, on, on | Centre the drawn nodes / cells (bounding box) on the origin instead of the full grid (whole px when snapping); a different glyph per instance; nodes on the pixel grid |
| placement + repeat | as rosette | `x`, `y`, `rotation`, `rep_*` (with size and position jitter), `seed` |

Added in the editor (`fresh`), a glyph is one centred emblem across 45 % of the texture's short side, its stroke
width an eighteenth of that (whole px). The defaults make it centred, connected (0.85) and sparing with revisits
(overlaps 0.3: fewer webs of crossing diagonals), dots only on free ends. **Linked default:** the bevel is half the stroke width (a domed stroke) or,
for blocks, about an eighth of a cell (at least 1 px); it follows until set by hand.

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
  period, and chips are only placed in whole blocks. Use an **even cell count** for circuits, because diagonal
  buses alternate by tile parity. Meander counts round to multiples of the key period. Rosette and glyph repeats
  wrap round the torus as the shape layers do (`repGrid`); with Column / Row spacing the instances pushed past an
  edge come round the other side.
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
- **Cost.** truchet: at most 16 segments per pixel (the running key: 3×3 units of up to 4·key + 5 segments); the
  CPU-laid styles fetch 9 texels (the circuit 27) and draw 3×3 cells or tiles. rosette: O(n) for
  `{n/k}` lines, O(1) for the rest. glyph: at most 64 segments (two Bézier pieces each as splines), each evaluated at q and its mirror images (up to 4) or 81
  block cells per instance that could be the nearest (the bounding circle prunes the rest). symmetry: one pass, three fetches (or 12
  bilinear).
- **Exact distance.** The repeat measures an instance only when its bounding circle's lower bound `r − bound` could
  beat the nearest distance so far, visiting the nearest instances first, so the minimum is exact: a pruned
  instance can't be nearer. The old early-out used `r − bound` for every instance past bound + 4 px, which jumps
  below the true distance there; anything reading the distance further out (Bevel and Etch on the shape mask, the
  glow) drew a ring at that radius round every instance — for repeats whose circles reach past their cells, across
  the neighbours too. `MOT_EXACT` (per layer) says how far out the output needs the exact distance: everywhere for
  the shape, the glow width for the glow (its value is 0 beyond), nowhere for radial (which only reads the nearest
  centre). Cost (1024² at 3× supersampling, glyph alone, 1 spp): background pixels now measure one instance, within
  ±10 % of before (3 × 2 emblems 200 vs 182 ms, one emblem 159 vs 171, 16 × 16 runes 182 vs 196; soft glow 177 vs
  166); cold compile glyph 2.32 → 2.39 s, rosette 0.92 → 1.00 s.
- **Glyph splines.** Each segment is two quadratic Béziers meeting halfway, controls at node ± tangent / 4
  (tangent = roundness · (next − previous) / 2), so the curve passes through every node with C1 joins and one
  exact quadratic distance per piece; past a stroke's ends the missing neighbour is reflected. Curves can't
  retrace a line: two curves through the same pair of nodes split into a lens. So in spline mode the walk never
  makes a 135° hairpin, never steps from a drawn node to another drawn node (axis nodes count as drawn when
  mirroring, since the mirror image arrives with the stroke), and a segment that is its own mirror image (along an
  axis, across one between mirror nodes, or through the centre with both mirrors) is drawn straight. Lines mode
  keeps its walk unchanged.
- **Glyph walk loop.** One flat loop walks every stroke node by node (twice when centring or tapering: the first
  pass collects the drawn nodes' bounds and each stroke's segment count). Each iteration arrives at a node, or at a
  reflected point past a stroke's end, and draws the segment before the previous node, once both of its
  neighbours are known. Every helper (Bézier, jitter hash, node bitmask) has one call site. Cold D3D11 compile:
  1.25 s before these follow-ups, 2.8 s with nested pass / stroke / step loops, 1.95 s flat, ≈ 2.05 s with Mirror Y.
  Render time is unchanged (1024², 16 × 16 glyphs of 8 × 8 steps, 16 spp: ≈ 0.2 s in lines and spline modes).
  Quality pass: ends, width variation and calligraphy (in the single segment loop) and the repeat's jitter took glyph
  to 2.3 s and rosette from 0.83 to 0.96 s; flattening the repeat wrapper's 3×3 nest into one loop with a
  uniform-derived bound brought them to 1.9 s and 0.78 s; the free-end test puts glyph at ≈ 2.0 s, where it
  started. Second round (sculpted relief, fillets, pen ends, mitres, connected walks): a loop of glow taps round the
  cell loop made it 2.6 s / 1.15 s; the taps folded into the cell loop (one flat loop over taps × 3×3 cells) and
  the free-end bookkeeping done at arrival (no loop) give ≈ 2.15 s / 0.9 s (the pre-pass versions: 2.05 s /
  0.82 s).
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
