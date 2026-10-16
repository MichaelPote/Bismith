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
- [x] `treadplate`: lozenge (vesica), capsule, 5-bar groups, studs, teardrops, diamonds; checker / row / column /
      same / herringbone alternation; whole-grid rotation in 45° steps; offset rows; dome and crest; angle and
      position jitter, size variation
- [x] `weave`: plain, twill 2/2, 2/1, 3/1, basket 2×2 / 3×3, satin, herringbone twill, lattice; 45° meshes;
      over/under arch with dive floor, strand roundness with flanks resting on the strands beneath, under depth,
      run on under (strips running under their neighbours); width variation; crossing studs with height and dome;
      per-float, per-strand or per-direction random
- [x] `bands`: diagonal bars (seamless stripes when margins are 0), zig-zag band, nested chevrons, Z steps;
      asymmetric margins, rails on the lane edges, chamfered ends, rounding, outline, fill band / between / above /
      below (one random per panel), mirrored lanes, 8 directions; per-piece width variation, per-lane shift jitter,
      missing pieces; robust bends (sharp peaks, bands wider than their segments)
- [x] Tiling verified 2×2 for every mode, 45°/90°/135° frames, 128×32 / 256×32 trims, 16×16, non-tiling
- [x] Reference recreations (contact sheet below)

## Layer reference

Common to all four: the shape params (`sdf_op`, `bevel`, `profile`, `aa`), shaping, mask and channel outputs.
`orient` = 0°…315° in 45° steps (bands: Horizontal / Vertical / flipped and the four diagonals). `rnd_mode`: per feature / per kind
(`(kind + .5) / kinds`) / kind + random (`(kind + .15 + .7·hash) / kinds`).

### `tessellation`
| Param | Default | Notes |
| --- | --- | --- |
| `mode` | rhombille | squares, diamonds, rhombille, herringbone, basketweave, cross, plus, octagon, triangles, hopscotch, pinwheel, cairo |
| `scale` | 7 | pattern **repeats** across the width (whole when tiling). One repeat = 1 square / 1 diamond pair / 1 cube column pair (2 hexes) / 2n×2n herringbone or basket block / cross pair (4×2 units) / 5 plus tiles / 1 octagon / 2 triangle rows / (a²+1) hopscotch block / 1 pinwheel / 2×2 Cairo cells |
| `aspect` | 1 | vertical stretch of the repeat (row count re-rounded when tiling) |
| `orient` | 0° | 45° frames tile over gcd(W,H) |
| `gap` | 2 px | grout (0–256, slider 16); odd values shift the lattice ½ px for crisp edges |
| `round` | 0 px | convex corner radius (0–256, slider 48), capped by the tile's smallest feature; the rounding gives way before the gap does, so heavy rounding never closes the grout |
| `fit` | on | Keep tile shape: when tiling, the count across may move off `scale` (log error of the rows' fit + 0.35 × that of the count, over counts 0.6–1.6 × scale and the one that gives a single row band) so tiles keep their natural shape × `aspect` — regular cubes / triangles, and Aspect holds at low counts (plus at scale 1, aspect 2 → 2 across, 1 down). Off: exactly `scale` across, rows rounded |
| `ratio` | 2 | herringbone brick length / basket bricks per block / hopscotch big-square side (2–12) |
| `stagger` | 0 | squares: alternate row offset (rows made even) |
| `plateau` | 0.25 | cross: 0 diamonds · 0.25 stretched hexes · 0.5 half-offset square columns · >0.5 bow ties |
| `step` | 0.6 | cross: shoulder in the slanted sides (0 straight → 1 right-angled arms). Interlocking-hex reference ≈ 0.69 |
| `cut` | 0.293 | octagon corner cut (0.293 = regular) |
| `inner` | 0.33 | pinwheel centre square |
| `cairo` | 0.274 | Cairo segment half-length (0 = 45° squares, 0.274 = equal-sided) |
| `block_j` | 0 | rhombille: joints inside a block as a share of the gap (the faces' edges at the block centre are pushed out by (1 − j) × gap/2 before the inset). Below 1 a block is one unit: one id for missing / hand-laid / tilt / crown / tone, one Per-feature variation (applied in `hval`, `feat` 0, when Height reads Pattern). At 0 (and every kind drawn) the block is one hexagon: no seam in its coverage, bevel or shape mask; the face comes from the pixel's place (top above both upper edges, then left / right), its colour blending into the face across over ±½ px |
| `crease` | 0.25 | solid blocks (block_j 0): the edges between the faces dip by this share of the height over the Bevel width (Height › Pattern, × (1 − c · (1 − bevel(distance to the nearest face edge))) — 0 = a sharp arris, 1 = down to the joint |
| `block_iso` | 0.5 | rhombille: the side faces slope from the edge they share with the top (β = 0) to the bottom corner (β = \|x\| − 3y = 1), down by 0.5 × this (the bottom rim stays lit) and meet in a ridge — raised boxes with convex arrises |
| `laid`, `laid_turn` | 0 px (new layers 0.75 px × size/512), = shift | hand-laid: a random shift (disc) and turn about the tile's box centre (a solid block's centre) that moves its corners ≤ `laid_turn` px (angle = px / box half-diagonal, so long tiles turn less); the turn follows the shift (linked default) until set by hand. Whatever exceeds the joint's room (gap/2 + size variation) shrinks the tile, so it never leaves its footprint (the one-tile modes stay exact) |
| `size_var` | 0 px | each tile shrinks by a random 0…this (its distance + s): uneven joints, handmade tiles |
| `tilt` | 0.5 | Height: a random lean per tile over its box, low side down by ≤ 0.75 × tilt of its own height (never into the joint) |
| `crown`, `crown_shape` | 0.3, 0.3 | Height: dome = 1 − 0.75 · crown · r^k, r = box-normalised radius, k = 2 … 10 by the shape (round dome → flat top with a shoulder) |
| `missing` | 0 | share of tiles left out at random (seeded): holes in a floor, scattered inlays. In the modes that test only the tile under the pixel (rhombille, triangles, Cairo, basketweave's block) a hole's distance is "far outside" rather than the distance to its neighbours |
| `only`, `only_inv` | all, off | draw one kind of tile (Kind 1…5 = class 0…4, the kinds below), or every tile but that kind: the small squares of octagon + square, pinwheel rectangles without their centres… so a kind gets its own layer (shape mask, bevel, material) |
| `rnd_mode` | kind + random | kinds: squares/diamonds parity, cube faces top/left/right, H/V bricks, cross sub-lattice, 5 plus classes, octagon/square, up/down triangles, big/small squares, pinwheel H/V/centre, 4 Cairo orientations |
| `kind_w` | 1, linked to the tiling | Kind contrast (kind + random): rnd = mix(.5, (kind + .5)/kinds, w) + (2h − 1) · mix(.3, .35/kinds, w) — 1 keeps each kind in its own band; lower, the bands slide to the middle and widen. Linked default: blocks 1, octagon / argyle 0.8, hopscotch 0.6, pinwheel 0.5, crosses / plus / Cairo 0.4, herringbone / basketweave 0.35, triangles 0.3, squares 0. |

Defaults: solid, isometrically raised blocks — scale 7 with Keep tile shape (7/√3 ≈ 4.04 rows: regular cubes on a
square texture), joints inside blocks 0 (crease 0.25), block relief 0.5; height add 0.4, smooth bevel 3 px, per-block
height variation 0.3, tilt 0.5, crown 0.3; diffuse by `rnd` (3-tone stone ramp, light → dark, so by kind the cubes'
tops are lightest and their right faces darkest under the default top-left light). A layer added in the editor
(`fresh`) sizes its gap (2 px) and bevel (3 px) to the texture (at 512 px; by the short side, ≥ 1 px) and is hand-laid
by 0.75 px there (shift and turn), so each seed lays the blocks differently. The Tiles recipe sets its tiles level
(no tilt, crown or per-tile height of their own — its macros make the relief) and tumbling blocks as rhombi with
joints. The main loop has no `continue` (ANGLE's D3D11 path has miscompiled it).

### `treadplate`
| Param | Default | Notes |
| --- | --- | --- |
| `style` | lozenge | lozenge (pointed vesica) · capsule · bars (n parallel bars) · stud · teardrop (round end tapering to a tip) · diamond (rhombus; Crest 1 = pyramids) |
| `count_x`, `count_y` | 8, 8 | cells (1–256, slider 48); made even when the alternation / offset needs it |
| `orient` | 0° | turns the whole grid in 45° steps (diagonal grids tile over gcd(W,H)); 45° + angle 0 = the diagonal 5-bar basket |
| `layout` | herringbone | alternate by checker / row / column, all the same (alternates turn 90°), or herringbone: rows alternate and odd rows shift half a cell (rows made even), each lug pointing at the next one's flank |
| `angle` | 45° | axis, clockwise from the grid's horizontal |
| `length`, `width` | 1.35, 0.15 | fractions of the cell size (√(w·h)); bars: width = fraction of bar spacing; stud: diameter |
| `crown` | 1 | Dome: the Profile over max(Bevel, Dome × the shape's half-width), so 1 domes each lug to its spine (works without a Bevel) |
| `crest` | 0.5 | blends the dome towards the straight ridge (value = the distance fraction): a crest along the spine that catches the light; pyramids on diamonds |
| `bars` | 5 | bars per group (1–16) |
| `stagger` | off | offset alternate rows half a cell (herringbone always does) |
| `jitter` | 1.5° | random rotation per lozenge (0–90°, slider 45) |
| `pos_jitter` | 0.015 | random offset per lozenge, share of the cell (0–0.3) |
| `size_var` | 0 | each lozenge shrinks at random: length by up to this share, width by half as much (slider 0–0.5) |

Layout, angle, length and jitter hide for studs. Style-linked defaults (`linkedDefaults`, follow the style while left
alone): layout / angle / length / width — lozenge herringbone · 45° · 1.35 · 0.15; capsule herringbone · 45° · 1.1 ·
0.2; bars checker · 0° · 0.85 · 0.5 (groups square in their cells, a basket weave; Rotation 45° puts it on the
diagonal); stud checker, width 0.45; teardrop checker · 45° · 0.85 · 0.32; diamond all the same · 0° · 0.92 · 0.92.
Code-built layers that set these keep theirs (the tech recipe sets only style and counts, so each tread style gets its
own look).

While the layer draws its own shape (Shape mask off or Normal) it paints its own value (`genOutShaded` with its own
coverage and a constant bevel factor, divided out), so Bevel aspect is not applied; the combine modes fall back to the
plain bevel of the combined shape. Defaults: height add 0.4 with per-lug variation 0.06 (rolled plate: nearly level),
round bevel 1.5 px, diffuse 60 % by value (steel ramp) with jitter 0.12, the micro jitters above (so seeds differ), and
roughness 0.55 → 0.25 / specular 0.2 → 0.7 by the value, so the spines glint (a layer added in the editor keeps those
sources at Pattern rather than the registry's Shape).

### `weave`
| Param | Default | Notes |
| --- | --- | --- |
| `pattern` | plain | plain, twill 2/2, twill 2/1, twill 3/1, basket 2×2, satin 4/1, lattice (horizontal layer always on top), basket 3×3 (repeat 6), herringbone twill (2/2 mirrored every `period` strands) |
| `period` | 8 | herringbone: strands per zig-zag arm (2–16; repeat 2 × this, 4 × when odd) |
| `count_x`, `count_y` | 8, 8 | strands; rounded to multiples of the weave repeat when tiling |
| `orient` | 0° | 45° → diagonal mesh |
| `width` | 0.85 | strand width / pitch (lower opens holes) |
| `width_var` | 0.2 | each strand thinner by a random 0…this share (seamless per strand, straight and diagonal frames) |
| `gap` | 1 px | clearance at crossings and between neighbours |
| `arch` | 0.6 | Over/under arch: each float runs in a sine arch from 1 in its middle down to 1 − this where it dives under the crossing strand (no bevel there — it butts into the strand on top) |
| `crown` | 0.6 | Roundness: the Profile across over max(Bevel, Roundness × half-width) (1 = round wire / cord). A float's flanks come down only to the strand passing beneath it (a float end at 1 − Arch, or an under-run), and to the base only over the holes |
| `under` | 0.5 | Under depth: under-runs (a strand between two crossings it passes under — the bottom layer of a lattice, bits between a basket's floats) lie at 1 − 0.85 × this, flat along |
| `run_on` | 0 | Run on under: strips run on under the crossing strands — no end gap, no dip, and inside only their sides bound them (lattices, strap grates). Older files' negative Float ends (`dip`) load as this |
| `round` | 1 px | float corner radius |
| `stud` | 0 px | rivet radius at every crossing (overrides the strands inside it, joining the strand it sits on) |
| `stud_h` | 0.35 | Stud height: the strands are lowered by this share so the heads stand proud |
| `stud_dome` | 1 | Stud dome: 0 flat head with the Bevel at its rim, 1 domed all over |
| `rnd_mode` | per strand | per float · 0.25 / 0.75 for horizontal / vertical strands · direction + random · per strand (one value along a strand's whole length; Height's per-feature variation then varies whole strands) |

While the layer draws its own shape (Shape mask off or Normal) it paints its own relief (`genOutShaded`, its own
coverage), so Bevel aspect is not applied; the combine modes fall back to the plain bevel of the combined shape.
Under-run slivers shorter than 2 px are left out (they aliased into hairlines).

Defaults: height add 0.5 with per-strand variation 0.15, round bevel 3 px, diffuse by value (darker dives and flanks,
fibre ramp) with jitter 0.35, so each strand gets its own tone.

### `bands`
| Param | Default | Notes |
| --- | --- | --- |
| `mode` | z | diagonal bars · zig-zag band · chevrons · Z steps (tech-wall) |
| `count` | 2 | repeats along the band direction (slider to 32) |
| `rows` | 3 | lanes across (chevrons: stripe spacing; slider to 32) |
| `width` | 32 px | band thickness (perpendicular; slider to 128) |
| `width_var` | 0 | per piece (bar, Z piece) or lane (zig-zag, chevron) thickness, down to (1 − 0.8 × this) × width; the piece's rounding, chamfer and bevel (via `bdist`) scale with it |
| `margin_top`, `margin_bottom` | 20, 20 px | clear strips per lane; diagonal bars with both 0 run through as seamless stripes (slope snapped) |
| `rail` | 17 px | strips this thick centred on the lane edges (shared by neighbouring lanes); not for chevrons |
| `rail_h` | 0.7 | the rails' level against the bands (value × bevel, so it also shades them in Diffuse › Pattern) |
| `angle` | 45° | slope of rising parts; negative mirrors along the band |
| `amp` | 1 | zig-zag: share of the lane it climbs, centred (1 = margin to margin) |
| `keep_angle` | on | zig-zag: a slope that can't climb the lane within a repeat lowers the zig-zag (centred) instead of steepening |
| `run` | 0.4 | Z: flat run length / repeat · zig-zag: share of flats on the high side · chevron: flat fraction |
| `run_var`, `rise_var` | 0.5, 0.6 | Z: per-piece run lengths (0.25…1.75 × Run at 1) with the rises spread over part of the repeat's slack, and partial-height pieces (climbing from the low run, mostly well below full, never under 1.5 band widths; not in the fill modes, whose panels need full-height pieces). The rises spread only as far as leaves every run its shortest flat. Runs are fitted to the neighbours: each stops a band width (across the rise) short of the neighbouring rise at its height, or short of a neighbour's run lying within a quarter band width of it; it is at least a band width + the chamfer long (at most Run), or — with no room for that — left out, the rise then ending in its own chamfered cut |
| `chamfer` | 9 px | Z end chamfer (up to half the width: pointed ends) |
| `round` | 0 px | convex corners (outer bends, ends); half the width → round ends and bends |
| `outline` | 0 px | inner outline instead of a solid band |
| `fill` | band | band · between (lane interior minus bands) · above / below (zig-zag only: panels on one side → rows of trapezoids); each panel gets its own random |
| `even` | on | fill modes (Z, zig-zag): the runs lie against the rails (on the lane edges without rails) and the panels keep one band width from them — every joint one band width; the margins aren't used, and the runs keep their lengths unfitted (they lie in the frame's joint) |
| `phase` | 0 | shift along the band (fraction of a repeat) |
| `jitter` | 0 | each lane shifted along the band by its own random amount (1 = ± half a repeat) |
| `stagger` | 0.7 | Z steps and bars between margins: each lane starts at its own random point (like `jitter`, but ignored by zig-zags, chevrons and through stripes, whose lanes must line up) |
| `jitter_piece` | 0 | each bar / Z piece shifted along the band by its own random amount |
| `skip` | 0 | share of pieces left out at random (whole lanes for zig-zags and chevrons) |
| `mirror` | off | flip alternate lanes (hourglass panels; rows made even; not for chevrons) |
| `orient` | horizontal | horizontal / vertical / flipped, and 45° / 135° / 225° / 315° (diagonal frames: counts fit the diagonal repeat) |

Defaults: a tech wall — staggered, varied Z steps between lower rails (the seed changes the layout); height add 0.4
with per-feature variation 0.3, crowned (custom curve, bevel 16 px = half the band), colour by Random (pale-metal
ramp). Added in the editor (`fresh`) the sizes follow the lane height (whole px; half px on tiny textures): 3 lanes (1
on wide trims), width 0.19 × lane, margins 0.12, rails 0.1, chamfer 0.055, bevel half the width. The Stripes recipe's
chevrons and zig-zags set rails 0, Keep angle off and no per-feature height.

## Reference recreations

Checked on a contact sheet (ref | render, palette Quake, ACES).

| Reference | Layer setup | Match |
| --- | --- | --- |
| Tumbling-block cubes (two) | `tessellation` rhombille, scale 3 / 2, aspect 1.5, gap 2, linear bevel 1, height 0.3 over grain | geometry exact (tall cubes, Y junctions); relief a little heavier than the ref's drawn grooves |
| Interlocking hexes (two) | `tessellation` cross, scale 1, plateau 0.25, step 0.69, gap 2; the second uses a stepped colour ramp on a 5 px linear bevel for the orange/white rims | outline shape essentially identical; rim widths slightly heavier |
| Herringbone | `tessellation` herringbone, scale 1, ratio 2, gap 2 | exact layout (32×16 bricks); mirror via orient 90/270 |
| Diagonal diamonds | `tessellation` diamonds, scale 2, aspect 0.5, gap 1 | layout right; one diagonal family fades under 315° light |
| Tread plate (two) | `treadplate` 8×12, rows layout, offset rows, angle 40, length 0.95, width 0.3 | good density and orientation |
| Strap grate | `weave` lattice, 45°, 6×6, width 0.52, run on 1, stud 3 | straps, holes and rivets match; under-strips read slightly tile-like |
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
- **Weave height.** Floats are separate SDF shapes; the over/under read comes from the value painted along the
  float (`arch`), not from a separate height field, so `profile`/`bevel` still drive the cross-section. The search runs
  as one flat loop over 12 candidates (2 directions × 3 strands × the float here or either side) with a uniform
  bound, the over/under tests and profile lookups each from one call site (D3D inlines each, and the custom bevel
  curve with it).
- **Loops are bounded** (fixed candidate sets per mode — at most 45 bounding-box-pruned rect tries for pinwheel,
  ≤ 60 for herringbone at ratio 12, a handful of polygons elsewhere; float search ±8 crossings; bands: one flat loop of ≤ 640
  segment / bar tries — Z pieces ≤ 16, chevrons ±2…8 lanes and waves ±1…4 repeats as far as the band reaches).
  Polygons hold ≤ 16 vertices (bands' bars 4).
- **Bands geometry.** Bands are not offset polygons (which fold over themselves at sharp peaks or where the band is
  wider than its segments): the distance is the min over the centre line's segments as capsules (`bnd_seg`; flat,
  chamfered ends where a Z piece ends) and its bends (`bnd_joint`: the mitred outer corner, exact with its apex region,
  clipped at 4 half widths, plus the inner corner point where the segments leave room for it). Rounding insets by r and
  subtracts r.
  Zig-zags are clipped to their lane (not in the fill modes, where the clip would pull the feet back and leave a
  sliver of panel on the margin), so sharp peaks stay inside the margins and tile. In the fill modes a band's ends
  and outer corners on the margins are squared off by boxes ("feet") from the margin to the centre line, so panels
  never wrap a chamfer or a rounding into the margin, and bars run past the margins; each panel takes its random from
  the piece to its left (bars, Z) or the repeat that bounds it (waves). The loop body has no `continue` (guarded
  blocks; see AGENTS.md). Through diagonal stripes key
  their random modulo gcd(count, repeats advanced × rows) — the stripes the torus actually tells apart. Every helper
  has one call site in a uniform-bounded loop: cold D3D11 compile 1.96 s → 1.3 s (1.0 s before Z pieces were fitted to their neighbours; each Z piece takes six
  steps of the flat loop — three draw it and its neighbours from one hash chain each, three are its segments).
- **Compile time.** Tessellation's modes are data: `tess_shape(k)` builds a mode's shape k and gives its anchor
  count, and `tess_anchor(k, a)` gives each anchor's position, kind and key parts (key = `geo_wrapCell(cell) ×
  mul + add`; `geo_keyI` lattices are split into those parts). The tile under the pixel, for the modes that find
  it directly, comes from `tess_pick`. `gen()` runs every shape and anchor through **one** flat loop with a single
  `geo_finish` and one tile try (the kind filter, missing tiles and uneven joints inline, around a single
  `geo_sdPoly`), bounded by `TESS_1` (1, read from a uniform) so D3D can't unroll it. Each mode used
  to have its own function with nested loops of tries, and D3D inlines every call: a cold D3D11 compile took ~20 s.
  It then took 1.9 s, with output pixel-identical (36 variants: every mode, kinds, ratios, rotations, non-tiling);
  2.3 s with the per-tile controls (hand-laid, size variation, tilt / crown / block relief / crease through `hval`, Keep tile
  shape's small count search).

## Recommended shared changes (not made — outside this family's files)
- Move `geo_sdPoly` + mitred inset into `glsl/sdf.ts` (`sdPolygon(n)`), and `geo_frame` / `geo_wrapCell`
  (seamless 45° frames with diagonal-torus index wrapping) into `glsl/common.ts`; stripes / grid / bricks could
  then offer 45° rotation seamlessly.
- A generic pattern offset (x/y phase in px) for cell patterns, so e.g. tread-plate studs or shape repeats can be
  aligned to a weave's crossings.
- Promote the batch render tool used here (one session, many projects, [ref | render | height] cells, mean
  colour per image) to `tools/batch.ts`.
- Add this document to the feature index in `docs/architecture.md`.
