# FR7.2b — Geometric generators: tessellation, tread plate, weave, bands

**Status:** done — four generator types in the *pattern* category, registered through `GEOMETRIC_LAYERS`
(`src/layers/generators/geometric.ts`). Typecheck clean, smoke clean, visually checked against references
(tech-wall bands; cube, hex, herringbone and diamond tilings; tread plate; mesh grating; fabric; strap and
chain-link fences).

| File | Contents |
| --- | --- |
| `geometric.ts` | `GEOMETRIC_LAYERS` (add-menu order) |
| `geometricCommon.ts` | shared GLSL (`geoGlsl(nv)`): seamless rotated frame, period-index wrapping, exact polygon tiles with mitred inset + convex rounding; `orientParam`, `rndModeParam` |
| `geometricTessellation.ts` | `tessellation` (12 lattices) |
| `geometricSurface.ts` | `treadplate`, `weave` |
| `geometricBands.ts` | `bands` |

## Goal
Motifs the generic layers cannot express: tumbling blocks, herringbone, interlocking crosses, octagons, Cairo
pentagons…, diamond plate, woven strands / lattices / chain-link, and tech-wall bands (Z steps,
zig-zags, trapezoid panels). All are SDF generators (distance in px, negative inside) so the common shape params
(bevel, profile, register combine, aa) work, all tile seamlessly, and all carry a per-feature `rnd`.

## Plan
- One shared GLSL toolkit (`geo_*`):
  - **Frame** — the pixel is rotated by a multiple of 45° (`geo_frame`). Straight frames hold whole periods
    across W×H (or H×W). Diagonal frames repeat over `gcd(W,H)/√2`; period-cell indices are reduced on the
    diagonal torus (`geo_wrapCell`: canonical representative modulo the (A,A)/(−B,B) spans, A = W/g, B = H/g),
    so per-tile random stays seamless too.
  - **Polygon tiles** — a mode builds its tile in pattern units (CCW), it is scaled to px (non-uniform stretch
    allowed: distances stay exact because the frame is an isometry), inset by `gap/2 + round` with mitred
    corners, and evaluated with an exact polygon SDF minus `round` → convex corners rounded, concave corners
    sharp, exact px distances inside. Candidates are pruned by bounding box.
- Per mode: point location / small candidate sets on the mode's lattice; keys from wrapped lattice anchors.

## Checklist
- [x] Shared frame + polygon toolkit (`geometricCommon.ts`)
- [x] `tessellation`: squares/offset squares, diamonds (argyle), rhombille (cube faces as classes), herringbone,
      basketweave, interlocking crosses / stretched hexes / bow ties (one family), plus (Greek cross) pentominoes,
      octagon + square, triangles, hopscotch (Pythagorean), pinwheel, Cairo pentagons
- [x] Rotation in 45° steps, aspect stretch, gap, corner rounding, per-tile / per-kind random
- [x] Odd gaps shift the lattice half a pixel → 1 px grout stays crisp with `aa: false`
- [x] `treadplate`: lozenge (vesica), capsule, 5-bar groups, studs; checker / row / column / same alternation;
      offset rows; angle jitter
- [x] `weave`: plain, twill 2/2, 2/1, 3/1, basket, satin, lattice; 45° meshes; over/under dip (and negative dip
      for strips running under); crossing studs; per-float or per-direction random
- [x] `bands`: diagonal bars (seamless stripes when margins are 0), zig-zag band, nested chevrons, Z steps;
      asymmetric margins, chamfered ends, rounding, outline, fill band / between / above / below, mirrored lanes,
      4 directions
- [x] Tiling verified 2×2 for every mode, 45°/90°/135° frames, 128×32 / 256×32 trims, 16×16, non-tiling
- [x] Reference recreations (contact sheet below)

## Layer reference

Common to all four: the shape params (`sdf_op`, `bevel`, `profile`, `aa`), shaping, mask and channel outputs.
`orient` = 0°…315° in 45° steps (bands: Horizontal / Vertical / flipped). `rnd_mode`: per feature / per kind
(`(kind + .5) / kinds`) / kind + random (`(kind + .15 + .7·hash) / kinds`).

### `tessellation`
| Param | Default | Notes |
| --- | --- | --- |
| `mode` | rhombille | squares, diamonds, rhombille, herringbone, basketweave, cross, plus, octagon, triangles, hopscotch, pinwheel, cairo |
| `scale` | 4 | pattern **repeats** across the width (whole when tiling). One repeat = 1 square / 1 diamond pair / 1 cube column pair (2 hexes) / 2n×2n herringbone or basket block / cross pair (4×2 units) / 5 plus tiles / 1 octagon / 2 triangle rows / (a²+1) hopscotch block / 1 pinwheel / 2×2 Cairo cells |
| `aspect` | 1 | vertical stretch of the repeat (row count re-rounded when tiling) |
| `orient` | 0° | 45° frames tile over gcd(W,H) |
| `gap` | 2 px | grout; odd values shift the lattice ½ px for crisp edges |
| `round` | 0 px | convex corner radius |
| `ratio` | 2 | herringbone brick length / basket bricks per block / hopscotch big-square side (2–8) |
| `stagger` | 0 | squares: alternate row offset (rows made even) |
| `plateau` | 0.25 | cross: 0 diamonds · 0.25 stretched hexes · 0.5 half-offset square columns · >0.5 bow ties |
| `step` | 0.6 | cross: shoulder in the slanted sides (0 straight → 1 right-angled arms). Interlocking-hex reference ≈ 0.69 |
| `cut` | 0.293 | octagon corner cut (0.293 = regular) |
| `inner` | 0.33 | pinwheel centre square |
| `cairo` | 0.274 | Cairo segment half-length (0 = 45° squares, 0.274 = equal-sided) |
| `rnd_mode` | kind + random | kinds: squares/diamonds parity, cube faces top/left/right, H/V bricks, cross sub-lattice, 5 plus classes, octagon/square, up/down triangles, big/small squares, pinwheel H/V/centre, 4 Cairo orientations |

Defaults: height add 0.4, smooth bevel 2 px, diffuse by `rnd` (3-tone stone ramp → shaded cubes out of the box).

### `treadplate`
| Param | Default | Notes |
| --- | --- | --- |
| `style` | lozenge | lozenge (pointed vesica) · capsule · bars (n parallel bars) · stud |
| `count_x`, `count_y` | 8, 8 | cells; made even when the alternation / offset needs it |
| `layout` | checker | alternate by checker / row / column, or all the same (alternates turn 90°) |
| `angle` | 45° | axis, clockwise from horizontal |
| `length`, `width` | 0.85, 0.28 | fractions of the cell size (√(w·h)); bars: width = fraction of bar spacing; stud: diameter |
| `bars` | 5 | bars per group |
| `stagger` | off | offset alternate rows half a cell |
| `jitter` | 0° | random rotation per lozenge |

Defaults: height add 0.4, round bevel 1.5 px, diffuse 60 % by bevel value (steel ramp).

### `weave`
| Param | Default | Notes |
| --- | --- | --- |
| `pattern` | plain | plain, twill 2/2, twill 2/1, twill 3/1, basket 2×2, satin 4/1, lattice (horizontal layer always on top) |
| `count_x`, `count_y` | 8, 8 | strands; rounded to multiples of the weave repeat when tiling |
| `orient` | 0° | 45° → diagonal mesh / chain-link |
| `width` | 0.85 | strand width / pitch (lower opens holes) |
| `gap` | 1 px | clearance at crossings and between neighbours |
| `dip` | 0.7 | >0 stretches the bevel along each float (ramps down where it passes under); <0 removes the bevel at cut ends (strips that run on underneath — lattices) |
| `round` | 1 px | float corner radius |
| `stud` | 0 px | rivet radius at every crossing (overrides the strands inside it) |
| `rnd_mode` | per float | or 0.25 / 0.75 for horizontal / vertical strands |

Defaults: height add 0.5, smooth bevel 3 px, diffuse by `rnd` (fibre ramp).

### `bands`
| Param | Default | Notes |
| --- | --- | --- |
| `mode` | z | diagonal bars · zig-zag band · chevrons · Z steps (tech-wall) |
| `count` | 1 | repeats along the band direction |
| `rows` | 1 | lanes across (chevrons: stripe spacing) |
| `width` | 16 px | band thickness (perpendicular) |
| `margin_top`, `margin_bottom` | 6, 6 px | clear strips per lane; diagonal bars with both 0 run through as seamless stripes (slope snapped) |
| `angle` | 45° | slope of rising parts; negative mirrors along the band |
| `run` | 0.5 | Z: flat run length / repeat · zig-zag: share of flats on the high side · chevron: flat fraction |
| `chamfer` | 4 px | Z end chamfer |
| `round` | 0 px | convex corners (outer bends, ends) |
| `outline` | 0 px | inner outline instead of a solid band |
| `fill` | band | band · between (lane interior minus bands) · above / below (zig-zag only: panels on one side → rows of trapezoids) |
| `phase` | 0 | shift along the band (fraction of a repeat) |
| `mirror` | off | flip alternate lanes (hourglass panels; rows made even; not for chevrons) |
| `orient` | horizontal | horizontal / vertical / flipped |

Defaults: height add 0.4, smooth bevel 2 px, diffuse by bevel value (pale metal).

## Reference recreations

Checked on a contact sheet (ref | render, palette Quake, ACES).

| Reference | Layer setup | Match |
| --- | --- | --- |
| Tumbling-block cubes (two) | `tessellation` rhombille, scale 3 / 2, aspect 1.5, gap 2, linear bevel 1, height 0.3 over grain | geometry exact (tall cubes, Y junctions); relief a little heavier than the ref's drawn grooves |
| Interlocking hexes (two) | `tessellation` cross, scale 1, plateau 0.25, step 0.69, gap 2; the second uses a stepped colour ramp on a 5 px linear bevel for the orange/white rims | outline shape essentially identical; rim widths slightly heavier |
| Herringbone | `tessellation` herringbone, scale 1, ratio 2, gap 2 | exact layout (32×16 bricks); mirror via orient 90/270 |
| Diagonal diamonds | `tessellation` diamonds, scale 2, aspect 0.5, gap 1 | layout right; one diagonal family fades under 315° light |
| Tread plate (two) | `treadplate` 8×12, rows layout, offset rows, angle 40, length 0.95, width 0.3 | good density and orientation |
| Strap grate | `weave` lattice, 45°, 6×6, width 0.52, dip −1, stud 3 | straps, holes and rivets match; under-strips read slightly tile-like |
| Chain-link | `weave` plain, 45°, 11×6 on 128×64, width 0.22 | very close |
| Mesh grating | `weave` plain, 45°, 11×11, width 0.6 | close (ref has no visible over/under) |
| Fabric | `weave` plain 32×32, width 1, gap 0 | close |
| Tech-wall Z steps | `bands` z, width 28, margins 18/32, angle 40, run 0.47, chamfer 7, phase 0.78, recessed | layout matches (rivets need a shapes layer) |
| Tech-wall zig-zag panels | `bands` zigzag, width 4, margins 20/14, angle 77, run 0.65, fill below, phase 0.38 | trapezoid panels match |
| Tech-wall hourglass panels | `bands` zigzag vertical, rows 2 + mirror, margins 12/0, angle 50, run 0.72, fill below | hourglass + chamfered side panels match |

## Notes and constraints
- **Tiling constraints.** Straight frames: whole repeats per axis (`aspect` picks the nearest whole row count,
  so non-natural aspect ratios stretch tiles — e.g. rhombille cubes are only regular when the texture aspect
  allows ≈ √3·k rows). Diagonal frames: the repeat must divide `gcd(W,H)/√2`, so on trims like 256×32 the
  diagonal repeat is at most 22.6 px and shapes can be strongly stretched; prefer straight frames on trims.
  Treadplate checker alternation / offset rows and weave repeats round counts to even / repeat multiples.
  Bands: counts are whole; diagonal bars with zero margins snap the slope so each lane advances whole repeats.
- **Pixel alignment.** Tessellation shifts the lattice by `fract(gap/2)` px, so both edges of an odd gap land on
  pixel boundaries (1 px grout is crisp with `aa: false`). Bands put lane edges / horizontal band edges on whole
  px when width and margins are whole.
- **Distance quality.** Inside distances are exact (bevels are true). Several modes evaluate only the tile that
  contains the pixel (rhombille hex, basketweave block, triangles, Cairo); the zero set is exact, but outside
  distances near acute corners may be overestimated up to ~2× (affects only AA / register ops in the grout).
- **Weave height.** Floats are separate SDF shapes; the over/under read comes from the bevel stretched along the
  float (`dip`), not from a separate height field, so `profile`/`bevel` still drive the cross-section.
- **Loops are bounded** (fixed candidate sets per mode — at most 45 bounding-box-pruned rect tries for pinwheel,
  ≤ 42 for herringbone, a handful of polygons elsewhere; float search ±8 crossings; Z pieces ≤ 12; chevrons ±2
  lanes). Polygons hold ≤ 16 vertices (bands ≤ 40).

## Recommended shared changes (not made — outside this family's files)
- Move `geo_sdPoly` + mitred inset into `glsl/sdf.ts` (`sdPolygon(n)`), and `geo_frame` / `geo_wrapCell`
  (seamless 45° frames with diagonal-torus index wrapping) into `glsl/common.ts`; stripes / grid / bricks could
  then offer 45° rotation seamlessly.
- A generic pattern offset (x/y phase in px) for cell patterns, so e.g. tread-plate studs or shape repeats can be
  aligned to a weave's crossings.
- Promote the batch render tool used here (one session, many projects, [ref | render | height] cells, mean
  colour per image) to `tools/batch.ts`.
- Add this document to the feature index in `docs/architecture.md`.
