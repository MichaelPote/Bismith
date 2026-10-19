# FR2.4 — Pattern layers: bricks, Voronoi, clouds…

**Status:** done — eight generator types in `src/layers/generators/patterns.ts` (cell / SDF patterns) and
`src/layers/generators/patternsFill.ts` (clouds, gradient, scratches), registered in `generators/index.ts`. The
Checker layer has been folded into **Tiles** (FR7.2b, `geometricTiles.ts`): Squares, with the Tones output for a
two-tone value (softness, tone variation) and the tile kinds for bevelled checker squares.

## Goal

Structured patterns that make up most game surfaces, all tileable and all exposing a per-feature random and an
edge distance so they can be bevelled and varied per cell.

## Plan

- **Bricks:** rows, columns, stagger offset, mortar (px), corner rounding, per-row random offset, brick SDF
  (distance to mortar edge), per-brick random.
- **Voronoi:** scale, jitter, metric (Euclidean / Manhattan / Chebyshev), output (cells random, F1, edge
  distance, crackle), gap (px) → cell SDF for bevelled cobbles / flagstones.
- **Clouds:** classic fBm clouds with warp, contrast and coverage.
- **Gradient:** linear / radial / angular / diamond with angle, centre, repeat — UI shading.
- **Stripes**, **Checker** (now Tiles › Squares), **Grid lines**, **Hex tiles**, **Scratches** (random short segments).

## Checklist

- [x] Bricks (+ length variation, edge jitter, wobble, wobble scale / variation, stone shape, straight creases, smallest piece, chipped corners with broken outline, face relief / crown / tilt, mortar level, joint variation)
- [x] Voronoi (cells, F1, F2, edges, crackle, facets, gap SDF, corner rounding, warp, cell size variation, size / position / rotation jitter, grout level, face relief / tilt, crack width variation, facets kept in range)
- [x] Clouds
- [x] Gradient (linear / radial / angular / diamond, clamp / repeat / mirror)
- [x] Stripes (shape SDF or soft-square / sine / triangle / saw value; width variation, spacing jitter, missing stripes, saw softness)
- [x] Checker — moved to Tiles (FR7.2b)
- [x] Grid lines (corner rounding, spacing jitter, width variation)
- [x] Hex tiles (pointy / flat top; grout level, size / position / rotation jitter, wobble, chips with broken outline, round bevel corners, face relief / crown / tilt)
- [x] Scratches

## Layer reference

| Type        | Category | SDF        | Params (own)                                                                                                                                                                                                                                                                                                                                                                       | Default outputs                                                                                          |
| ----------- | -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `bricks`    | pattern  | yes        | Layout: columns, rows, stagger, mortar px, joint_var, round px, mortar_level, vertical · Irregularity: row_jitter, len_var, row_var, min_size, size_jitter px, pos_jitter px, rot_jitter °, shape_var, crease, close, wobble px, wobble_var, wobble_scale · Relief: chips, chip_size (share of the brick height), chip_depth, chip_break, chip_dust, face, crown, face_tilt · seed | height (round bevel 2 px) + diffuse by per-brick random                                                  |
| `hex`       | pattern  | yes        | scale, orient (pointy/flat), gap px, round px, round_bevel, grout_level · Irregularity: size_jitter px, pos_jitter px, rot_jitter °, wobble px · Relief: chips, chip_size, chip_depth, chip_break, chip_dust, face, crown, face_tilt · seed                                                                                                                                        | height (smooth bevel) + diffuse by per-tile random                                                       |
| `voronoi`   | pattern  | cells only | output (cells/f1/f2/edges/crackle/facets), tilt + facet_fit (facets), scale, jitter, metric, gap px, crack_var (crackle), round px, min_cell px, min_bevel, round_bevel, warp px, warp_scale · cells: grout_level, size_var, size_jitter px, pos_jitter px, rot_jitter °, face, crown, face_tilt · seed                                                                            | height (round bevel 3 px) + diffuse by per-cell random; crackle: Height › Mode Subtract (linked default) |
| `grid`      | pattern  | yes        | count_x, count_y (0 = none), width px, offset_x, offset_y, round px, snap · Irregularity: jitter, width_var · seed                                                                                                                                                                                                                                                                 | height subtract (seams) + dark diffuse                                                                   |
| `stripes`   | pattern  | shape mode | mode (shape/square/sine/triangle/saw), count, angle, duty, soft px + soft_profile (square, saw), fit_bevel (shape), offset · shape/square: width_var, jitter, skip · seed                                                                                                                                                                                                          | height (round bevel); shape: Diffuse › Source Shape (linked default)                                     |
| `gradient`  | pattern  | no         | style (linear/radial/angular/diamond/square), angle, cx, cy, length px (0 = fit), stretch, round, turns (angular ramps), twist, repeat (clamp/repeat/mirror), shift, fit, wrap (wrap/single), seam px, falloff (linear/smooth/round/cove), aa, seed                                                                                                                                | diffuse ramp, bottom → top                                                                               |
| `scratches` | pattern  | mask only  | density (per 64×64 px), cap, angle, angle_jitter, clump, clump_scale, len_min, len_max, len_bias, thickness, th_var, fade, taper, taper_len, blunt, bend, bend_coh, wobble px, breakup, groove, burr, burr_width px, mask_min, hard, seed                                                                                                                                          | light diffuse + shallow height subtract                                                                  |
| `clouds`    | noise    | no         | basis (value/perlin), style (fbm/billow/ridged), scale, stretch, octaves, lacunarity, gain, crease, warp, wdetail, contrast, coverage, soft, even, seed                                                                                                                                                                                                                            | diffuse multiply (60 %) + light height                                                                   |

`rnd` is per brick / hex / cell / square / panel / stripe / scratch (gradient: per repeat band; clouds: the
noise value). Non-SDF output modes return `sdf <= NO_SDF`, so value and mask pass straight through, and their
Edge controls are hidden and they write no shape (`sdfShowIf`: stripes in shape mode, Voronoi in cells).

**Defaults.** The plain defaults are the finished looks:

- Bricks: 12 courses, mortar level 0.2, straight creases and Close gaps (for dry stone), wobble varying per brick
  (0.7), 0.5° rotation jitter, 25 % length variation (smallest piece 0.5), chips 0.4 (broken outline 0.35, dust 0.45),
  face relief 0.35, face tilt 0.5, Height › Per-feature variation 0.3.
- Hex tiles: round bevel corners, a strong crown (1.2) so the face domes on from the bevel without a framed plateau,
  grout level 0.2, face relief 0.2, face tilt 0.25, chips 0.3 (size 0.25, broken outline 0.5, dust 0.2), per-feature
  variation 0.25.
- Voronoi: cell size variation 0.5, 2° rotation jitter, round bevel corners, smallest bevel 0.5, grout level 0.2, face
  relief 0.35, crown 0.3, face tilt 0.35, per-feature variation 0.3; soft facets with a 3 px edge; crackle variation
  0.6 at scale 0.6, crack darkness 0.7.
- Grid: whole-pixel lines, smooth profile. Stripes: Fit the bevel, smooth profile, smooth softness 3 px.

A layer added in the editor (`fresh`) also gets the values that depend on the texture size: bricks about 3:1 (4
columns, an even row count from the aspect), a round bevel of 0.2 of a course, edge jitter and wobble in proportion
to the courses; hex a short bevel (0.06 of a tile); Voronoi cobbles with bevel, gap, corner rounding, warp, size jitter
and Smallest cell sized to the cells; grid 5 px lines with a 1.8 px bevel at
512 px; stripes a bevel of a quarter of a stripe.

Recipes and templates that stack copies of one shape and build their own relief (stone walls, cobbles, tiles, panels,
plates) spread `BRICKS_PLAIN` / `BRICKS_REGULAR` / `HEX_PLAIN` / `VORONOI_PLAIN` (exported from `patterns.ts`) to turn
the layers' own relief and wear (and, for `*_REGULAR`, the bricks' irregular geometry) off.

**Face relief** (bricks, hex tiles, Voronoi cells; `PAT_FACE_GLSL`). _Face relief_ dents each face with smooth
3-octave noise, each feature its own (noise offset, lump size 0.6–1.4×, strength 0.4–1×, and character: cloudy
lumps softly saturated in the noise (never flat), scattered pits — bowls deepening towards the noise's lows — or wide
Gaussian valleys along its mid-contours, all without
thresholds, so no terraces), up to 0.35 of its height at 1 — headroom, so faces never clip into plateaus or pits to
the joint. _Crown_ falls away from the middle by the depth in from the outline (a flat top with rounded shoulders,
down to half at the edge). _Face tilt_ leans
each feature a random way, its low side at 1 down to 0.4. Both go to Height only: the generator returns `genOutShaded` with the face in `GenOut.hval`, so the
wrapper multiplies it by the bevel of the drawn shape while Diffuse keeps the plain bevel; the coverage it returns is
the wrapper's own (the shape combined with the mask it writes, by the Mode, `pat_drawnDist`). With all relief at 0 the
layer returns plain `genOut`. _Chips_ (bricks, hex) are angular pieces — bricks:
one per corner and two V bites along the long sides; hex: one per corner — by chance _Chipped corners_, sized as a
share of the feature (so they scale with it): the piece beyond a kinked cut (`pat_notch`: on the corner's side of
both segments, so it always reaches the outline and never leaves an island), a hollow in the height round it (crisp
rim, deeper towards the break), frayed a little by the wobble noise. _Broken outline_ cuts the piece itself (less of
it for lower values) away down to the joint; at 0 the outline stays. Bricks chip mostly at the corners (long sides
at a third of the rate, as shallow lopsided bites), at most one corner per end (no arrowheads), corner chips have one
facet or two, and every hollow's floor is broken up by a fine two-octave noise (`pat_rough`, depth 0.45–1.55×). Hex
tiles chip mostly at one corner of their own (the others a third as often), with sizes spread from 0.2 to 1 of Chip
size. _Chip dust_ (bricks 0.45, hex 0.2) tints the hollows paler: the colour random moves that share of the
way to 1 (`pat_tint`; with Diffuse › Source Random, the ramp's light end — a freshly broken face; Height › Per-feature
variation is then applied in the shader from the feature's own random), no translucent mix with the mortar. Where a
hollow goes nearly to the joint (or, with a raised bed, down to the bed) the coverage goes to 0 with a crisp edge,
so the mortar shows there and no ghost of the broken outline stays in colour. The colour follows the
smooth hollow (before the floor's roughness, `pat_hollow` × 1.3 for its deeper parts), so it doesn't speckle. The chip's
rim is a pixel wide on small chips and a tenth of the chip on big ones (a broken slope, not a crack line). Broken outline at 1 cuts the whole piece and a little of the
hollow round it. With a raised hex grout bed, the part of a hollow the bed would fill also breaks the outline
(at most 0.3 of the chip in from its cut), so the colour shows the chip where the height does. _Crown_ (0–2; 2 = down to the edge) reads its depth as a
smooth minimum of the edge distances, so it is a pillow without ridges from the corners.

**Round bevel corners** (hex, Voronoi cells; `pat_roundDepth`). An exact distance's inner contours keep the corners'
rounding only to the rounding's depth, then sharpen into mitre lines. With this on, the bevel is measured in a depth
whose every contour has corners of the rounding radius — the depth at which the cell inset by it, then rounded,
passes through the pixel (per edge pair, a quadratic for the inset corner's position, solved in closed form). It goes
to the wrapper as `GenOut.bdist` with Bevel aspect applied (`pat_setBevelDist`), so it applies while the shape is the
layer's own (writing no mask, or in Normal mode).

**Joint variation** (bricks, FR8.22). Each brick gets a share of the joint, `1 − joint_var × hash`: it scales the mortar
the brick carries (its left and top joints), and for the nearest brick its bevel (handed to the wrapper as the bevel
distance stretched by 1 / share, so a shut brick has hardly any edge) and, through `pat_js` in `pat_out` / `pat_bedOut`,
its face relief and Height › Per-feature variation (`feat × share`), so shut bricks sit flush and a run of them reads as
one stone. A joint closes when the brick that carries it is shut; beside an open brick the open one's bevel still
shows. At 0 every factor is exactly 1 (bricks, hex and Voronoi renders checked pixel-identical).

**Mortar / grout level** (bricks, hex, Voronoi cells; `pat_bedOut`). Above 0 the layer returns its own height
profile (`genOutHeight`): the features (bevel × face × per-feature variation) rising from a level, slightly lumpy bed
at that share of their lowest edge's height (Crown and Face tilt lower the edges, so the bed never buries the
outlines) — from the bed at their outline (mix(bed, top, bevel), so no crease where the bevel
would cross the bed: no inset "picture mount" line) — which also fills chips. Colour still covers only the
features. The per-feature variation is applied in the shader (same hash as the wrapper, `feat = 0`) so the bed itself
stays level, and is floored so no feature sinks below 0.6 of the way up from the bed; Height then skips Shaping ›
Value.

**Bricks: rubble and dry stone.** _Stone shape_ cuts each corner of the nearest brick at a random angle and depth
(mostly a little, now and then deeply), slants its ends, and lets its top and bottom sag towards one end and bow
(cuts after the search; where that leaves the pixel nearer the second brick, it takes that one). _Smallest piece_
scales the length and course variation so no brick or course is thinner than 0.1 + 0.9 × it. Overlapping stones meet
in a crease: off, the nearer outline wins (a corner can poke into its neighbour); with _Straight creases_, every stone
near the pixel (all 15 searched) is split from every stone it overlaps (separating-axis test on their four edge
directions) along one line across the middle of the overlap, square to the axis of least overlap. The line is the same
from either stone and runs right across both, so each stone is its box cut by half-planes: convex, and every pixel
agrees which stone it is in (no stubs, steps or hammer-heads); a groove of a fifth of the bevel (1–2 px) stays between
them, so stones never fuse. With negative mortar, shifted and turned stones grow by their shift and turn so they keep
filling their places (a shifted stone spans its place and where it moved to; Edge jitter only moves it), and with
_Close gaps_ (on by default) every gap the creases leave closes: in it the nearest stone grows to the gap's middle
line, `min(best, groove + ½ (best − second))` — a no-op where stones already meet in a crease — so the stones fit
into each other in the same thin groove and a dry wall has no open mortar (mortar-grey pixels about half the default
wall's). It runs before Stone shape, which still cuts the stones' corners and ends (small pockets at the joints). Stone shape cuts only one corner of an end deeply (the other stays small), so ends are slanted or
chamfered, not arrowheads. With negative mortar, a turned stone grows to still fill its place (dry stone
stays dry).

**Hex / Voronoi: hand-set cells.** _Position_ and _Rotation jitter_ move each cell within its place: its four kept
edge planes are turned about its centre and shifted (`pat_moveCell`), and each side is drawn in by as much as its
moved edge would reach past its place (shift along it, turn × half the edge, less half the gap) — side by side, so
only the sides that need it give way and the joints stay tight. Hex _Size jitter_ moves each side in or out by its
own random amount (the mean joint stays, never below a pixel: irregular hexagons) and hex _Wobble_ fades out towards
the corners. Voronoi _Smallest cell_ (px) merges away every cell whose nearest edge comes closer to its site than that: the
decision is made once per cell on the CPU (`cpuData` → `t_cells`, the shader's hashes and cell points replicated in
TypeScript, from the same 5 × 5 power-diagram edges, less the cell's Size jitter), and the shader's site search skips
merged sites, so their
neighbours fill the place — no pebbles or needle slivers, and every pixel agrees. _Smallest bevel_ gives a cell whose
inradius is under the bevel a narrower one, 0.8 of the inradius, but at least that share of the Bevel, so small stones
still dome up without turning into flat tablets.
Voronoi's _Cell size variation_ turns the cells into a power diagram (each site's squared weight, up to a cell's area,
hashed from its feature point, is taken off its squared distance; the bisectors stay straight and move towards the
lighter site), so big cells sit among small ones.

**Voronoi values.** _Soft facets_ caps each plane's slope so it stays in range across its cell (a knee catches the odd
large one) and blends the four nearest cells' planes with soft weights (from the differences of their squared
distances, so ranks that swap have equal weights: no steps at triple junctions) over _Facet edge_ px (default 3: crisp
chamfers like cut stone) — Height ›
Per-feature variation blended with the same weights — (a partition of
unity: continuous through borders and junctions) — a faceted surface with crisp creases, no cliffs or pixel steps. Each plane's border distance is exact (the difference
of (power) squared distances over twice the sites' separation). Plain facets meet in a 1 px anti-aliased step, and the
colour random blends over that pixel too; Height › Per-feature variation is applied in the shader (`feat = 0`),
blended the same way, so it doesn't scatter along the boundaries.
Crackle's crest is rounded over about a pixel (no dashed aliasing along the ridge), and a crackle layer defaults to
Height › Subtract (`linkedDefaults`) so the cracks cut in rather than stand up. _Crack variation_ makes each of
the two nearest edges a V crack whose width and depth come from one smooth noise (_Variation scale_ cells per swell:
small varies each crack along its length, large gives regions of hairlines and of wide cracks) read on the crack's
own line, stepped between four levels (a quick change where the noise crosses a level, straight-walled stretches
between: broken lips, not smooth lenses) — one field over the whole network, so cracks swell and narrow along their length and run on
through junctions without steps or spindles; the wide stretches are the deepest, junctions as deep as their arms. Its walls drop steeply from a sharp rim
into a narrow rounded bottom, the rim frayed by a noise about twice the Gap across (not per pixel); where edges meet,
the deeper crack wins. _Crack darkness_ darkens the
cracks in Diffuse by their depth — the random moves towards 0, the ramp's dark end (Source › Random), with feat = 0 so
the height isn't affected. The per-feature random stays the cell's (colour) and the crack is not varied per cell (`feat = 0`).
Manhattan / Chebyshev borders take one Newton step along
the bisector function's gradient before its `f / |∇f|` estimate (exact across a kink of the bisector), and areas where
two sites tie are no border.

## Notes and constraints

- **Pixel alignment.** Periodic features start at a cell / period edge and extend by their width (mortar along
  the left/top of each cell, grid lines from each cell edge right/down, a stripe covers phase
  `[0, duty)`). With whole-pixel cell sizes and widths every edge lands on a pixel boundary, so 1 px mortar,
  1 px grid lines and 2 px-period stripes stay crisp with `aa: false`. Wave stripes peak a quarter period in,
  so a 2 px period alternates per pixel.
- **Tiling.** Every lattice wraps its indices (and hashes wrapped indices) when the project is tileable.
  - Bricks: columns / rows are whole counts; with a stagger, use an **even row count** (alternate rows are
    counted from the top, so an odd count puts two unshifted rows together at the seam).
  - Hex: a hex lattice only repeats with whole counts and an **even row count** (odd rows are offset half a
    cell). Regular hexes rarely fit a square texture exactly, so when tiling the layer searches whole counts
    near the requested scale and takes the most regular fit (the count may differ by 1–2; a few % stretch).
    Non-tiling projects use exactly regular hexes.
  - Stripes: when tiling, the stripe frequency is snapped to whole cycles across each axis, which snaps the
    angle to the nearest seamless one (e.g. count 10 at 30° → 29.7°).
  - Gradient: radial / diamond / angular use the nearest periodic copy of the centre when tiling (continuous
    for radial / diamond). A linear gradient cannot repeat unless `repeat` / `mirror` divides the texture.
  - Voronoi / clouds / scratches / grid: scale and warp frequencies are integer per axis via `cellsFor`.
- **Distances.** Hex and Euclidean Voronoi cells are exact inside (nearest bisectors). Corner rounding is exact:
  the four nearest edges are kept and the cell distance is the max over edge pairs of the distance to their
  half-plane intersection. Manhattan / Chebyshev cells use a per-bisector `g / |∇g|` estimate (exact on each
  linear piece), with no rounding. Domain warp (Voronoi) and wobble (bricks, hex) bend the distances slightly;
  size jitter (hex, Voronoi) insets each cell by a per-cell random.
- **Jittered lines.** Grid lines and stripes with spacing jitter / width variation search the three lines around the
  pixel (each line its own shift and width, hashed by its wrapped index), so they still tile; a grid's per-panel
  random follows the moved lines. With all at 0 the result is the regular, pixel-aligned pattern. Grid jitter 1 is
  the most that still leaves neighbouring lines two widths plus the bevels (and 2 px) apart; varied widths are at
  least 1 px, and a line thinner than its two bevels has its inside distance stretched so it still reaches full
  depth. Grid _Corner rounding_ rounds the panels (a rounded box's corner distance where both lines are within the
  radius). Stripe widths vary both ways, (1 ± var) × Width, kept between a pixel plus the bevels and the period less
  that; _Missing stripes_ drops stripes by chance (gaps of several periods).
- **Sawtooth softness.** The saw rises over the period less _Softness_ px and drops back over Softness px; _Softness
  profile › Smooth_ eases soft-square edges and the saw's drop.
- **Fit the bevel** (stripes, shape mode): each stripe's bevel at most a third of its width (its inside distance
  stretched to match), on the stripe grown by half of it — Height reads that as a profile of its own (`genOutHeight`),
  while colour, coverage and the mask it writes stop at the stripe's Width, the bevel's half height. Jittered stripes that
  run into each other merge into one span (the intervals' union), one flat plank.
- **Diffuse by shape.** Shape stripes default to Diffuse › Source Shape
  (`linkedDefaults`): painted flat, the bevel in Height only, so the ramp's dark end no longer frames every edge.
- **Thin features keep their depth.** Moved or varied grid lines (and, with _Whole-pixel lines_, the plain lattice
  where the count doesn't divide the size) start and end on whole pixels and have whole-pixel widths; a varied line
  thinner than its bevels gets a narrower bevel, at most 0.375 (w − 1) and half a pixel, so every line reaches the
  full depth on at least its middle pixel and the weight still grows with the width — per line, before the two
  directions are combined, so where lines cross the deeper one wins; a moved line's shift averages its random with
  the previous line's, so a narrow panel no longer sits beside every wide one (no tartan) — at Jitter 1 panels span
  mostly 0.45–1.55 cells (±0.75 at most), never closer than two line widths plus the bevels; a varied stripe thinner than
  its bevels likewise keeps its full rounding. Varied stripe widths are kept between 1.5 px and the period less 1.5 px; spacing jitter
  can move a stripe a quarter period into its neighbours' slots (they may merge).
- **Compile time.** The pattern layers' fBm goes through `pat_fbm` (identical to the library's Perlin fBm, its
  octave loop bounded by a uniform so D3D keeps it rolled); cold D3D11 compiles: bricks ≈ 1.25 s, hex ≈ 0.8 s,
  Voronoi ≈ 1.7 s, checker (since moved to Tiles) / grid / stripes ≈ 0.4 s. Shader loops avoid `continue` (ANGLE / D3D11 can miscompile it). After round 3: bricks ≈ 1.4 s, hex ≈ 0.95 s,
  Voronoi ≈ 1.75 s. After round 5: bricks ≈ 1.5 s, hex ≈ 0.95 s, Voronoi ≈ 2.1 s (most of it the two 5 × 5 site
  loops with their inlined cell points; rolling or merging loops further gained nothing measurable). Round 8: bricks ≈ 1.4 s (its 3 × 5
  search one rolled loop, gap closing in one line), hex ≈ 0.95 s (edge loop rolled), Voronoi ≈ 2.1 s (one noise for
  crack width and depth). Facets don't use Cell size variation (their soft blend needs ordinary cells).
- **Scratches** set the mask to scratch coverage and the value to scratch strength, so outputs only touch the
  scratches. Density saturates at _Density limit_ scratches per cell (cells are about one scratch long; 64, up to 256
  for dense brushing); the control shows when a layer gets near it.
  - _Shape_: each scratch is a tapered stroke along a parabolic arc (Bend: one curvature for all, so the sagitta
    grows with length² — up to a quarter of the longest's length — random side per scratch unless _Bend bias_ leans
    them one way), plus Wobble (a smooth 1D noise across it, one to three waves along it, growing with width past
    2 px but under 3 % of the length), its distance measured across the arc. Taper narrows the last _Taper length_ of
    each half (1 = a spindle), less at a _Blunt start_. _Breakup_ runs a 1D noise along each scratch (its waves at
    least half a short scratch long) that varies its depth and width and opens gaps. _Length bias_ skews lengths short
    (`h^(1 + 3·bias)`). Thickness jitter ties width to strength (the weak ones are the hairlines); _Width by length_
    scales width by `(len / max)^0.7`, capped at len / 8 (no rice grains). _Swirl_ (`bend_coh`) lines the scratches
    up along circles: each circles its own centre (one per Clump scale cell, moved by up to 0.3 × its distance),
    drifts off the circle by up to ±12°, keeps its own direction within a minimum radius and stops at ¾ of a circle —
    wiping and polishing marks. _Directions_ (1–4) spreads the headings over 180° from Angle; _Direction balance_
    gives the first more of the scratches, _Direction spread_ turns the others off the even spread by a random angle.
    Clumping draws `1 + clump` × the scratches and keeps each by a two-octave Perlin at its centre, so worn patches
    and bare areas alternate at the same overall count.
  - _Relief_: Groove shape gives Height (`hval`) a cross-section `1 − u^(1/groove)` (u = 0 on the centre line, 1 at
    the edge: flat, U, V, needle), faded in over 1 … 2 px of width so thin scratches don't bead; the deepest groove
    wins where scratches cross. Burr adds a raised lip (`sin²` over Burr width beside the cut) through
    `genOutHeight` — uneven between the sides, broken by the breakup noise, none at the start and rising towards the
    end, none round the caps, none inside another cut, fading out below 2 px of width — so Height then skips
    Shaping's value controls. _Exit heap_ (also `genOutHeight`): a crescent ridge bowed round each end, sized per
    scratch (a fifth none) and by strength and width. _Shallow hairlines_ scales a cut's depth and coverage by its
    width under 1 px (thin ends fade out, no dashes), so fine brushing reads as a sheen.
  - _Mask_ (`sdf: 'mask'`): the signed distance to the nearest scratch (exact within the 3 × 3 cells, snapped off
    ±0.5 px with Hard edges; gaps of the breakup pushed outside) goes to the mask named in _Write to_ — none by
    default, so adding scratches never replaces the Shape mask built above them. Normal / Union: later layers limited
    to it stay inside the scratches (rust, bare metal); Subtract: a panel's mask loses them (paint that skips the
    scratches). _Mask strength_ leaves the faint ones out.
  - The cell loop has no `continue`: D3D11 miscompiled one there (scratches thinned and cut off at cell borders).
  - The plain defaults suit about 128 px; the editor's new layer (`fresh`) sizes density, lengths, thickness, wobble
    and burr width to the texture.
- **Clouds** sum their octaves in one flat value / Perlin loop (one copy of each noise in the D3D shader). Styles:
  _Soft_ (fBm), _Billow_, _Ridged_ and _Cumulus_ (the default: the first octave smooth — the masses — the next two
  folded into puffy sub-lumps, the finer ones plain noise: cauliflower clouds without hairline creases).
  - _Coverage_ is measured on this very texture: `cpuData` runs the shader's `gen()` ported line for line
    (`cloudsSamples`: the same PCG hashes, lattices, turned lattice, warp and octave loop) at 64 × 64 points and
    uploads 17 quantiles; `eq_value` (from Noise) maps them onto fBm's spread and the threshold is the evened-out
    `1 − coverage` quantile — the share above mid-grey for every style, seed and size (measured 0.35 / 0.5 / 0.65 /
    0.8 → 35.0 / 49.2–50.3 / 64.7 / 80.2 %). Not ported: the animation phase and the layer's own domain warp / offset.
  - _Softness_ box-filters the clip of Contrast over up to 2 × 0.5 (quadratic shoulders), and above 0.5 blends into
    `0.5 + tanh(2(v − 0.5))/2` — domes, not plateaus (at 1, 9 % at black where the hard clip has 26 %).
  - _Crease softness_ replaces the fold `|2n − 1|` by `√((2n − 1)² + e²) − e` (renormalised). Billow rounds every
    octave's fold alike (`e = 0.25 · crease · (1 + o/2)`), domes the lumps (`fold^(1 − crease/2)`) and multiplies in
    the second octave's creases (faintly the third's): creases at two scales, sub-lumps; its finer octaves fade out
    inside the first octave's creases. Ridged softens more on finer octaves.
  - _Ridge hierarchy_ (Clouds sharpens the main crest by `c^(2 + 6h²)`) and _Ridge offset_ as in Noise.
  - _Warp detail_ scales the warp down per octave (`× lacunarity · detail` per octave in that octave's cells), so the
    large shapes swirl and the fine detail isn't drawn into strands.
  - Octaves are decorrelated (shifted; turned on the tileable turned lattice of `NZ_SHARED_GLSL`, or freely when not
    tiling), and value noise is the mean of two lattices (the second turned the other way and shifted half a cell, at
    one lattice's spread), so no fold creases along its cell edges.
  - The default ramp is a wide Overlay ramp that both darkens and lightens what is beneath.
- **Gradient** extras: _Square_ rings (L∞; _Roundness_ turns diamonds and squares into superellipses, p 1 → 2 and
  ∞ → 2, without diagonal creases), _Stretch_ (rings elongated along the Angle), angular _Ramps_ (fans and stars;
  with Mirror two ramps make one wedge) and _Twist_ (spirals), _Band offset_, _Band width jitter_ (each boundary moved
  by up to ± 0.45 × jitter, wrapped with the band count so fitted bands still tile: strata, planks) and a _Falloff_
  curve (the bevel profiles: smooth, round, cove — radial + cove + Invert is a hemisphere).
  - Tiling radial-type rings blend the 5 × 5 copies of the centre by their own metric with weights
    `e^(−(m − m_min) / τ)`, τ = Seam rounding / 4: repeating ramps blend their _phase_ (the unit vector of
    `2π t / period`), so bands bend from one copy's into the next and stay sharp, without a seam or a notch; a clamped
    ramp blends t. _Centre: Single_ uses only the one centre (a plain spotlight, not tiling). New layers round the
    seams by 5 % of the texture (`fresh`).
  - A tiling, unstretched angular sweep takes its angle from a ratio of Jacobi thetas — `arg θ₁(πz) − arg θ₁(π(z − b))`
    with the pole b at the tile's corner (four terms, scaled by `e^(−|Im x|)`; tiles up to 3:1) plus `π Re z`, the
    phase of the doubly periodic `|h|`, turning by π across the tile and keeping its symmetry (rays evenly spread at
    every radius): seamless for an even count of ramps (a multiple of 4 with Mirror). Other counts take `− π Im z / T`
    (no turn across the tile; the rays crowd towards a diagonal), and an angular gradient with an odd count starts on
    Centre › Single (`linkedDefaults`). Stretched sweeps and longer tiles take the nearest copy of the centre.
  - _Fit the tile_ (on by default) snaps a repeating linear ramp's frequency to whole cycles per axis (the angle
    moves a little, like Stripes) and a radial-type band length to a whole number of bands to the tile's edge.
  - The wrap of Repeat (and an angular sweep's start) and the folds of Mirror are box-filtered (the integrals of
    `fract` and of the triangle wave over the pixel's footprint), so they are anti-aliased and bands finer than a
    pixel fade to their mean (over 0.75 … 2 px of footprint); angular sweeps take that width from their own rate
    (`turns / (2π r)`, and the corner whirl's) rather than quad derivatives; _Anti-alias_ off keeps hard steps.
    Per-band randoms wrap with the band count when a tiling gradient repeats a whole number of times.
