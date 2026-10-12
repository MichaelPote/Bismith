# FR2.4 — Pattern layers: bricks, Voronoi, clouds…

**Status:** done — nine generator types in `src/layers/generators/patterns.ts` (cell / SDF patterns) and
`src/layers/generators/patternsFill.ts` (clouds, gradient, scratches), registered in `generators/index.ts`.

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
- **Stripes**, **Checker**, **Grid lines**, **Hex tiles**, **Scratches** (random short segments).

## Checklist
- [x] Bricks (+ length variation, edge jitter, wobble)
- [x] Voronoi (cells, F1, F2, edges, crackle, gap SDF, corner rounding, warp)
- [x] Clouds
- [x] Gradient (linear / radial / angular / diamond, clamp / repeat / mirror)
- [x] Stripes (shape SDF or soft-square / sine / triangle / saw value)
- [x] Checker (two-tone value or bevelled squares)
- [x] Grid lines
- [x] Hex tiles (pointy / flat top)
- [x] Scratches

## Layer reference

| Type | Category | SDF | Params (own) | Default outputs |
| --- | --- | --- | --- | --- |
| `bricks` | pattern | yes | columns, rows, stagger, mortar px, round px, row_jitter, len_var, size_jitter px, wobble px, seed | height (round bevel 2 px) + diffuse by per-brick random |
| `hex` | pattern | yes | scale, orient (pointy/flat), gap px, round px, seed | height (smooth bevel) + diffuse by per-tile random |
| `voronoi` | pattern | cells only | output (cells/f1/f2/edges/crackle), scale, jitter, metric, gap px, round px, warp px, warp_scale, seed | height (round bevel 3 px) + diffuse by per-cell random |
| `checker` | pattern | shape mode | mode (value/shape), count_x, count_y, gap px, round px, seed | diffuse two-tone |
| `grid` | pattern | yes | count_x, count_y (0 = none), width px, offset_x, offset_y, seed | height subtract (seams) + dark diffuse |
| `stripes` | pattern | shape mode | mode (shape/square/sine/triangle/saw), count, angle, duty, soft px, offset, seed | height (round bevel) |
| `gradient` | pattern | no | style (linear/radial/angular/diamond), angle, cx, cy, length px (0 = fit), repeat (clamp/repeat/mirror) | diffuse ramp, bottom → top |
| `scratches` | pattern | no | density (per 64×64 px), len_min, len_max, thickness, taper, angle, angle_jitter, fade, hard, seed | light diffuse + shallow height subtract |
| `clouds` | noise | no | basis (value/perlin), style (fbm/billow/ridged), scale, stretch, octaves, gain, warp, contrast, coverage, seed | diffuse multiply (60 %) + light height |

`rnd` is per brick / hex / cell / square / panel / stripe / scratch (gradient: per repeat band; clouds: the
noise value). Non-SDF output modes return `sdf <= NO_SDF`, so value and mask pass straight through.

## Notes and constraints
- **Pixel alignment.** Periodic features start at a cell / period edge and extend by their width (mortar and
  checker gap along the left/top of each cell, grid lines from each cell edge right/down, a stripe covers phase
  `[0, duty)`). With whole-pixel cell sizes and widths every edge lands on a pixel boundary, so 1 px mortar,
  1 px grid lines and 2 px-period stripes stay crisp with `aa: false`. Wave stripes peak a quarter period in,
  so a 2 px period alternates per pixel.
- **Tiling.** Every lattice wraps its indices (and hashes wrapped indices) when the project is tileable.
  - Bricks: columns / rows are whole counts; with a stagger, use an **even row count** (alternate rows are
    counted from the top, so an odd count puts two unshifted rows together at the seam).
  - Checker: counts are rounded **up to even** when tiling (an odd checker cannot repeat).
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
  linear piece), with no rounding. Domain warp (Voronoi) and wobble (bricks) bend the distances slightly.
- **Scratches** set the mask to scratch coverage and the value to scratch strength, so outputs only touch the
  scratches. Density saturates at 24 scratches per cell (cells are about one scratch long).
