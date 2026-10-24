# FR8.18 — Rock

**Status:** done — generator with four outputs; the _Rock face_ template and Starter in the New project wizard

## Goal

One generator for natural rock faces, built from what rock surfaces share rather than from noise: **blocks** split along
**bedding** (strata) and **joints** across it, each block with its own height and tilt, sides that fall away as
**scarps**, and faces chipped into finer **facets**. Developed against eighteen references: pale layered limestone with
overhanging ledges, dark crumpled rock, slate split into plates, columnar basalt, a coursed rubble wall, flaky layered
sandstone, a white cliff fluted by water, pillow stones with drip stains, thin beds with lichen, dark fractured rock,
grey rock and blocks with moss, brown cobbles, cobbles packed in mud, foliated schist, dark flaky strata and a scanned
cliff (colour and displacement), and a lava crust. Earlier rock recreations were assembled from Voronoi patches, noise
mottle and Cracks; they got the colour but never the form.

## Rock (`rock`, `generators/rock.ts`)

A pattern-category SDF generator (`genOutOwn`: it paints its own value and hands its blocks to the mask it writes, Shape
by default).

### Layout

- **Strata frame.** Within 45° of horizontal, `u = (x − s·y) / W` runs along the bedding and `v = (y + t·x) / H` across
  it — shears, not a rotation: rows keep whole cell counts per tile, so any _Bedding angle_ tiles once `t` is snapped to
  a whole number of rows across the width (steps of a few degrees). Steeper angles turn the frame 90° (±90° = columns).
  _Block size_ is the thickness across the bedding (px), _Elongation_ the length ÷ thickness.
- **Cross joints.** Joints across the bedding run along `(s, 1)`: square to the strata at _Cross-joint angle_ 0 (`s =
  t`), leaning otherwise — rhomboid blocks, as in jointed slate. When tiling, `s` is snapped so `u` moves a whole `kU`
  cells over the tile's height (coarse steps for big blocks). The tile's two periods then move the lattice by `(nu, ks)`
  and `(−kU, nv)`; cells are made seamless by reducing them with that lattice's Hermite basis `(g, B), (0, C)` (extended
  Euclid on `nu` and `−kU`, on the CPU once per render — a derived uniform, `rockDerived` — like the rest of the frame
  and its snapping: a finer generation's lattice is the blocks' scaled per axis, so its basis is theirs scaled). Checked numerically: every cell is invariant under both periods and the class count equals the
  determinant.
- **Blocks.** One jittered site per lattice cell, nearest site by a power distance in the metric `(u, kb·v)`, `kb = 1 +
  2·bedding`: distances across the bedding count more, so course joints lie flat while joints within a course stand
  across it. _Bedding_ also trades per-site wander across the row (scaled by 1/kb², or the metric would tilt the joints
  within a course) for a per-row offset, so courses and columns differ in thickness but keep straight sides. A row's
  offset repeats every gcd(shear, rows) rows — seamless where the shear carries row j over the tile edge into row j +
  shear. That gcd is the number of distinct beds on the torus, and at 1 a single bed spirals through the whole tile:
  per-bed colour, bed relief and row thickness vanished at many angles (the defaults, the template). When tiling, the
  bed count (±2) and the shear (±1) are nudged to the nearby pair with the most distinct beds (up to 6), preferring to
  change the thickness — the angle moves a few degrees at most. _Size variation_ is the power weight: some blocks grow
  over their neighbours.
- **Merge.** A 2 × 2 group of blocks fuses with this chance: one face (the group's values, centred on the group), no
  joints, crevices or weathering inside — big blocks among small ones. Blocks only (not ridges and prisms). The group's
  other cells are left out of the ranking of the highest mesas altogether: they share the pixel's own face, and counted,
  they stood second-highest along the group's outer border and hid the crease (and its crack) there. Likewise the
  second-highest must be another block than the highest: two cells of one group draping over a neighbour drew a false
  crease where their skirts met. A fused group takes its first row's bed (bed relief and colour), or its face stepped at
  the inner row border. When tiling, groups are 2 × 2 cells of the lattice reduced to one domain, whole groups only (an
  odd count leaves the last at the wrap single). The Hermite domain is gcd(nu, kU) cells wide — one when they are
  coprime, as at the defaults, and then no group was ever whole: merging did nothing at most angles. Reduced by the rows
  first (the transposed lattice's Hermite basis, from the bed search's Euclid extended by one coefficient, on the CPU
  with the rest; checked equal on 32 090 lattices) the domain is gcd(shear, rows) rows high; groups
  use whichever of the two holds more whole groups. A group's identity (joints, ranking) is its group index offset by
  2²⁰, apart from any block's key.
- **Stagger.** Every other row shifts half a cell along the bedding — a running bond, each block bridging a joint
  below it — its wander shrinking to fit (sites stay inside their cells, so the 3 × 3 nearest-site search holds). The
  distances are taken in cell units (`(u, kb·v)`), so the cells' shape depends on the bedding alone, not on the
  elongation: in a full bond a block's end is a hexagon's flat side spanning `(kb² − ¼) / kb` of its row (75 % at no
  bedding) between two slanted shoulders; rounding and corner rounding make lens-shaped stones of them. The parity
  repeats every gR rows like the row offsets, and with a stagger the bed count is nudged towards an even number of
  distinct beds (an odd one leaves a fault every gR rows).
- **Folds.** A broad smooth shift across the bedding (value-noise fBm, _Fold count_ across the width), in beds: strata
  that bend across the rock. _Fold sharpness_ folds the noise about its mean, `2 (⅛ − |n − ½|)` (about the same
  amplitude): a V-shaped hinge wherever the noise crosses its mean — chevron folds, as in folded shale. Sharp folds get
  fewer noise cells down the texture (a quarter at full sharpness), so the hinges run roughly down it; the finer octaves
  still wander, so they don't stack on one axis as in a textbook chevron.

### Relief

- **Mesas.** Each of the 5×5 blocks around the nearest site is a mesa: its face (height, random tilt, _Ledge dip_ across
  the bedding, _Rounding_) inside its cell; outside, the face at its nearest border point minus the px distance from
  that border (the power bisector, measured through the frame's transpose) over the _Scarp width_. The surface is the
  highest mesa, so a high block drapes over lower neighbours: plateaus and shelves, with scarps whose run grows with the
  height they fall. Evaluating a neighbour's face at its border (not extrapolating its tilted plane to the pixel) keeps
  a tilted block from slicing diagonal wedges across its neighbours. _Rounding_ below 0 scoops the faces out.
- **Skirt distances.** A neighbour's skirt needs the px distance from the pixel to that neighbour's cell. Its border
  with the pixel's nearest site is exact only for cells next to the pixel's; for cells further away it underestimates,
  and it jumps wherever the nearest site changes — visible steps in the skirts (46 height jumps in a 256 × 128 test at
  Scarp width 2, 302 at 5). The distance is the farthest of the cell's borders with the pixel's three nearest sites
  instead: across a Voronoi edge the three stay the same three, so it doesn't jump there (0 jumps at 2, 4 at 3, 73 at 5;
  with two sites, 48 at 3). Very wide scarps (≥ 8 px over tall steps) still show a few seams where the third and fourth
  nearest swap or the skirt outruns the 5 × 5 window. In a fused group the three nearest are often all mates, far from
  the cell, and the bound fell far short: a taller neighbour's skirt showed through the group in thin wedges and dashed
  cracks along its inner borders. Around a fused block the four mates' sites are looked up first (four more cells per
  generation, through the same code), and the mate nearest each cell is a fourth site — its border with the group. (The
  pixel's fourth nearest site as that fourth bound for all other blocks was tried: 2–5 % fewer jumps over wide scarps,
  but a new seam where the fourth and fifth nearest swap — not kept.)
- **Weathering.** The drop off a block's border is rounded over ±r px (`(s + r)² / 4r`, C¹) on both sides: the block's
  own shoulder (its nearest border, tracked through the loop) and its neighbours' skirts. Facets round by their share of
  the relief, or every facet border becomes a groove. Sheer one-pixel steps light as harsh white and black lines under a
  low key light; 1–2 px of weathering softens them into the gentle shading the references have.
- **Corner rounding.** Within _Corner rounding_ px of two of its borders, a block's inside distance becomes the distance
  to a corner of that radius — the rounded-box form over the two nearest borders, exact at any angle (`rk_corner`: the
  nearer edge where the point projects onto it, else the vertex, from the two distances and the cosine between the
  normals; `|(r − d₁, r − d₂)|` holds only at right angles and put skirts 22 % too far at 120° corners; acute corners
  keep it, or the exact form jumps where the second border comes within reach) — so the corner sinks away beyond the
  arc, and the crease moves out by the same amount, opening the cracks where blocks meet: rubble, pillows, worn cobbles.
  Only where the two borders really turn (normals more than ~20° apart): at a T-junction of courses the edge runs
  straight on and is left alone. (A first version used a log-sum-exp soft minimum over all the borders; in small blocks
  every border is within reach, so whole blocks sank into holes.) Neighbours' skirts use the same rounded box from
  outside — `rk_corner(d₁ + r, d₂ + r, cos) − r`, gated by the same turn — over a cell's two farthest borders other than
  a fused group's inner ones (taken for corners, they pulled a group's skirt away from it where an inner border meets
  the outline; they still bound the distance): rounded on the inside only, a corner sank inside its border but its skirt
  stood sharp outside — a lip at the scarp's top. Known limit: the cosine belongs to the second border, so where the
  second and third swap (a cell with three borders within reach: wide scarps with rounding, or blocks under about twice
  the radius) the rounded distance steps; at the usual sizes it doesn't show (cobbles and rubble at 8 px blocks, radius
  3, checked).
- **Prisms.** _Rounding shape_ Ridge or Hexagonal prism gives each block a profile across its own row (between the
  midpoints to the rows either side, so it spans the course or column whatever its width): a ridge, or the upper hull of
  a hexagon (circumradius half the row) turned 0–60° per block, so two or three flat faces show, its steepest faces'
  slopes capped so the sides stay finite. A prism doesn't fall away along its length: at its ends (borders across the
  bedding, `endK = |N_u| / |N|`) it breaks off in a plane falling from its crest at the scarp slope, and the surface is
  the lower of that plane and the prism — the break's outline on the prism follows its profile (a chevron), the
  hexagonal end of a column sheared off at an angle. Small _Scarp width_ (~1 px) makes the breaks steep at both ends.
- **Bed relief and pitch.** _Bed relief_ gives each bed (course, column) its own height offset — hard beds weather
  proud, soft ones recede (differential erosion): ledges along the strata, columns standing out or set back as a whole.
  _Pitch_ leans every block along the bedding the same way, a saw-tooth whose steps all face one way: with columns, the
  sheared ends become lit caps all facing up, as in the reference, where random heights left half of them dark bands.
- **Scarp steps.** A block's skirt descends as a staircase instead of one slope: the px distance from its border goes
  through `floor(x) + smoothstep(0.65, 1, fract(x))` (flat treads, risers over the last 35 % of each step) before the
  drop, mixed in by _Scarp steps_. Each block has its own _Step width_ (±30 %) and phase, the edges wobble with the
  jaggies' noise, and the staircase is measured from the border before the corner rounding, which is added on top, so
  the face meets its skirt there unchanged, at rounded corners too. A fused group's cells share one staircase (the
  group's hashes; with each cell's own, the steps zipped where the cells meet). Flaky sandstone and shale show ledges as
  stacks of thin plates, each edge casting its own thin shadow; one smooth slope per ledge read as a broad soft shadow
  band (the sandstone recreation's metric 0.51 → 0.56 with it). Short scarps (≤ 2 px) gain little, and without
  weathering the crease at a skirt's foot follows the steps: cracks along short scarps on flat, regular blocks get
  jagged ticks.
- **Height coherence.** Block heights are part random, part a smooth swell (value noise in px, ~3 block lengths across).
  With independent heights every joint shows — a shaded skirt or a lit step, since neighbours never match — and the rock
  reads as coursed masonry; sharing heights leaves ledges here and there. The swell is the same for every mesa at a
  pixel, so it changes none of their comparisons: the blocks' own heights shrink by the coherence and the swell is added
  once after the loop (sampled per site inside the loop, it cost 34 noise lookups a pixel for the same look).
- **Proud blocks.** Only this share of the blocks keep their own height; the rest sit flush with their neighbours (and
  the swell), parted only by the joints. In most rock faces a step is the exception — coherence alone shrinks every
  step at once, where flush joints with an occasional proud or sunken block read as flagstone or slate. Little effect
  where tilt or facets dominate the relief (the template; the layered limestone's quilting came from its facets).
- **Scarp lean.** Scarps run out further down the screen than up (`run × max(1 + lean·n_down, ¼)`, the bisector normal
  in px): a shaded shelf under every ledge and a sheer lit step above it; negative leans give sheer undersides that cast
  shadows. The sheer side keeps a quarter of the run — a step in one pixel lights as a dotted line of single bright
  pixels. On screen rather than across the bedding, so it means the same for columns (their ends) and angled strata.
  _Ledge dip_ is the other way to a saw-tooth — every face leans the same way — and reads as rippled shale.
- **Facets.** _Facet levels_ repeat the blocks at ½ and ¼ the size, added at _Facet strength_ (halved per level):
  chipped, crumpled faces. Facets are fractures, not beds, and several things keep them from reading as rows of little
  bricks: each level splits a block `m·round(elongation)` × `m` ways (about square), keeps only 40 % of the bedding, and
  is offset from the blocks (a translation, still seamless) — nested exactly, its rows fell on the block rows and
  stacked their scarps along every course joint. Their own heights are halved (they differ mostly by tilt; lower facets
  became pits), their scarps run twice as far and don't lean (sheer facet steps lit as one-pixel cracks), and a level
  whose cells are under ~8 px fades out (a grid of pixel bumps). _Fracture zones_ scale the facets and roughness by a
  broad noise, 0 to 2: whole, smooth faces beside shattered, crumbly ones. Roughness is a little Perlin noise on top.
- **Relief.** `0.5 + 0.5·tanh(Σ mesas)`: linear over the usual range, rounding off big stacks instead of clipping them
  flat (clipped plateaus read as cardboard).

### Surface

- **Pits.** Small round pits (vugs) scattered over the faces: one candidate per cell of four pit radii (whole counts
  when tiling), its centre a radius in from the cell's sides so no neighbour is needed — one evaluation — kept with the
  pits' chance and clustered by the breakup noise; sizes mostly small. Half as deep as wide in true px (through the
  Height amount and the project's depth: at Height 8 a pit as deep as the value range turned one pixel black), only on
  the faces.
- **Rills.** Parallel channels down the screen, _Rill spacing_ apart (whole counts when tiling), meandering a little:
  each a parabolic bowl, round-bottomed and meeting its neighbours in sharp crests, cut into segments about _Rill
  length_ long with their own depth, fading in and out along each — the fluting water wears into limestone. (A first
  version used billowed Perlin noise stretched down the screen; it read as cross-hatching, not flutes.)
- **Laminae.** Fine grooves along the bedding, a whole number per bed, each with its own depth (by its index, which
  repeats where the beds do), fading in and out with a breakup noise.

### Joints

The two highest mesas give the crease distance `(P₁ − P₂) × scarp` px — the foot of a scarp, or the border between equal
blocks. _Joint width_ opens it into a crack, each joint (block pair, hashed order-free) by its own share (_Width
variation_), pinching and swelling along its length with the block-sized warp noise. _Open joints_ keeps only a share of
them, each along its whole length; a closed joint doesn't part its blocks (no crack, no bevel, one piece in the Shape
Mask — with no cracks at all, every crease outlines its blocks). _Cross-joint width_ scales the joints across the
bedding (blocks end to end, from the two sites' offset): wide bedding cracks and thin cross cracks for slate, the
reverse for limestone's vertical cracks. _Facet joints_ cracks a share of the first facet level's borders too, at 0.6×
the width (at most a twelfth of a facet) — along the facet cell's straight border, not its crease: where a tilted face
meets a neighbour's skirt the crease curves, and cracked it curled into worms. Facet cracks sink only 60 % as deep as
the joints, and the Shape card's bevel rounds the blocks into the main joints only: wrapped round the hairlines too, it
turned them into wide grooves (L-shaped gouges across rubble stones). _Facet joint breakup_ fades them in and out along
their length (value noise about half a block across; the crack's distance shrinks with it, so its crevice glow and Shape
Mask taper to a point — switched off at half, they ended in a hard line): partial hairline cracks inside the stones —
whole and straight, they read as cracked plaster. _Long fractures_ are straight cracks that cut across many blocks at
their own angle (tectonic joints): lanes about two blocks apart across the fracture direction, each holding segments
~4.5 blocks long with the fractures' chance, a little off the lane's centre and turned a few degrees, fading out at
their ends. When tiling, the direction is snapped to a primitive lattice vector `v = (a W, b H)` and completed to a
basis with `u = (c W, d H)`, `ad − bc = 1`; lanes and segments are counted in whole numbers along `v` and across it, and
each tile-step across the lanes shifts the segments back by its slide along them — checked numerically (every key
invariant under both tile periods) and in the seam test. Under a pixel wide a crack stays one pixel wide and fades with
its width (box filter), or diagonal hairlines break into dots.

### Outputs and randoms

- _Relief_: the height, coloured by height.
- _Scarps_: 1 on the draped skirts from their top edge to their foot, 0 on the faces (facets' skirts by their strength
  squared, or every facet step paints a fleck). _Facing_ keeps those below ledges (the shaded undersides) or above them
  (shelves where dust, scree and moss settle). Its coverage is its value, as the crevices': a Normal blend paints only
  the scarps (with full coverage it painted the whole layer). The same rock in a second layer paints the scarps their
  own colour, as hand-painted rock does.
- _Crevices_: 1 in the creases (the joints and the foot of every scarp, closed joints too), fading over _Crevice reach_
  — further below a tall step — and broken into patches (_Patchiness_): moss, dirt, damp. Its coverage is its value, so
  a flat colour lands only in the cracks. Main and facet creases are measured separately: a closed main joint keeps its
  crease when a facet crack is open nearby.
- _Streaks_: rain streaks running down each block from its top edge (tracked in the loop: the nearest border whose
  neighbour lies above on screen), fading over _Streak length_: narrow columns (~1.5 px, whole counts when tiling), each
  with a streak at the density's chance — clustered by groups of about eight columns — at its own strength and length,
  edges softened by a 1D tent filter over the neighbouring columns; off the scarps. Water stains, lime or rust washed
  down the faces. (Left out of the template: at its sizes they barely show, for the cost of another Rock evaluation.)
- _Random value_ (Diffuse › Random / jitter): per block, per bed (a row's value repeats where its thickness does), per
  bed varied a little per block, or per facet (patchwork colour).

Every snapped count (beds, blocks, the cross-joint shear, rills, streak columns, fracture lanes, the noises' cell counts)
is worked out once on the CPU (`rockDerived`, in float32 steps), so it comes out the same on every backend. On the GPU
these counts — ratios of whole numbers, often exact halves — were rounded by the GPU's last-bit error, differently on
D3D11 and OpenGL: a slate at −20° got another lattice on Windows (PSNR 21 between the backends). Snapped counts still
round ties down (`floor(x + 0.499)`), the folds' halves up; the noises' counts go through `cellsFor`'s `floor(x + 0.5)`,
which settles the default's tie at 96 / 192 / 384 px (the warp's 2.5 cells) at 3 on every backend. Exact ties remain at
_Irregularity_ 0, where the sites form a perfect lattice: about 0.3 % of the pixels along the borders can differ between
the backends there.

A hidden _Pixel scale_ param (`unit: 'px'`, 1) tells the shader how big a texture pixel is under supersampling, which
scales every px param by k: the facets' pixel-scale fade, the streak columns and the jaggies' and thinnest cracks'
floors follow it, so supersampling doesn't bring back facets the small-block tuning faded out.

The defaults are a generic rock face — strata at −15°, gently folded (0.5), tilted blocks (0.8) with stepped scarps
(0.6, every 2 px) leaning down the screen (0.3); the first defaults (folds 1, tilt 0.3, sheer undersides) read as wavy
plaster. The recreations keep every param explicit, so they don't move when a default does. _Style_ (UI-only, `uniform:
false`) jumps to a proven look — fractured face (the template), layered ledges, flaky strata, slate plates, columns,
coursed rubble, cobbles — through the same linked defaults: the shape params the recreations settled on (block size,
Height and paint stay), and those a style doesn't name back to their defaults; as with every linked default, a param the
user changed stays changed. Defaults follow the output (`linkedDefaults`); a layer added in the editor sizes its blocks
and relief to the texture (`fresh`: blocks ~12 % of the texture's mean side, Height 0.32 × the block size). All noise
(warp, jaggies, roughness, rills' meander, breakup, zones, folds) runs in one flat loop and every generation in another
(38 cells each, its bound the generation count — per pixel, as fracture zones can fade the last one out); the two
generations of joints share one loop (one copy of the joint code); the coherence swell uses a copy of `valueNoise`
without the animation code; the other loop bounds come from a uniform (UNI_1). Cold compile on D3D11 (RTX 5080):
**about 2.6 s** — over Truchet's (2.0 s; Tessellation 1.8 s, Chips 1.67 s, Cracks 0.81 s); ~3.7–3.9 s while the bed
snapping, the lattice bases and the fractures' direction search still ran per pixel (they are derived uniforms now). The
long fractures cost ~0.3 s of it, the three-site skirt distances ~0.3 s, the streaks ~0.2 s, merging on the reduced
lattice and the fused groups' mates ~0.6 s, scarp steps, stagger, chevron folds and the facet cracks' breakup ~0.2 s
together (measured before the port). Flattening the noise loop over octaves, and uniform bounds on the small loops, made no difference. What
did: **`continue` and early `break` in the generations' loop** — the mates' four cells first skipped the rest of the
body with `continue`, and a faded-out last generation broke out of the loop; together they cost 0.9 s (4.7 s → 3.8 s as
an if / else chain, and the generation count worked out before the loop as the loop's bound; a break on it cost 0.3 s
more). A whole 1024² frame with a Rock layer at the defaults renders in ~0.25 s at 16 samples (RTX 5080), so sliders
stay interactive.

## Rock face template (New project wizard)

`rocky` in `match/templates.ts` (it replaced the noise-based _Ridged, faceted rock_): steep strata (−60°) broken into
tilted blocks of widely spread sizes (0.9), 45 % merged — big blocks among small ones; at 30 % and 0.6 they read as a
regular lattice of scales — three facet levels with fracture zones at 0.8 — whole, smooth fracture planes beside
shattered zones — scarps stepped every 2 px (thin layered edges along the blocks' sides), no laminae (even at 0.15 they
turned the smooth faces into wood grain), Height 0.32 × the block size. Its Rock copies (and the recipe's) carry the
style _Fractured face_, which is this look, so picking another style moves every param. (At this angle merging only took
effect once it worked on the reduced lattice.) Blocks are 12 % of the texture's mean side (√(w·h), so wide textures
don't get huge blocks), 7–32 px. Small blocks lose their facets (cells under ~8 px fade out), so the settings blend from
a small-block look (less bedding, more tilt, a little grain) at 8 px to the large-block one from 16 px up. Five copies
of one Rock pattern (relief only, colour by height, bed colour overlay, scarps multiplied dark, crevice dirt or moss on
a palette with a real, yellowish green — `greenest()` also takes slate's blue-greys, and painted lighter than the rock
they drew pale lines along every crevice), in-hue grain and cavity grime; the optimiser ties the copies' pattern params
(a test checks it). A low (25°), warm key light and a cool sky, shadows on: the blocks cast shadows. Under a game
palette (painted light, no shadows) the same rock is shaded by its slopes alone. Built from references (Match's
Suggest), the colours follow each reference's palette.

It is also a Starter: _Rock face_ (Nature, `presets/index.ts`) builds the template at 128 px in a fixed warm sandstone
palette, picked from four rendered side by side. And a recipe (smart material): _Rock face_ in `recipes/nature.ts` adds
the same look to an existing project under macros — bedding angle, block size (0: an eighth of the texture's mean side)
and variety, bedding, relief depth, tilt, facets, scarp steps, weathering, crevice dirt, moss and its colour, rock
colours, bed colour — and turns shadows on.

Of the candidates rendered across the stone schemes at 32–256 px — layered ledges (from the limestone recreation), flaky
sandstone, columns (from the columns recreation) and fractured blocks — the fractured one read most clearly as rock at
every size: the ledges looked like a flagstone wall and dried mud, the columns like candles, out of their context.

## Settings that reproduce the references

The layer's _Style_ presets take their shape settings from these rows (where they differ from the defaults): Fractured
face from the template, Layered ledges, Flaky strata (Sandstone flakes), Slate plates, Columns (without facets), Coursed
rubble and Cobbles (Brown cobbles) — generated from the recreations, not retyped.

| Look                         | Key settings                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layered ledges               | size 24, elongation 1.4, bedding 0.3, merge 0.6, coherence 0.2, bed relief 0.8, lean −0.6 (sheer undersides), scarp 2, weathering 2, 3 facet levels at 0.8; 0.5 px joints, 12 % open, cross-joint width 2; Height 8, key light 22° |
| Crumpled dark rock           | angle −10°, size 16, bedding 0.45, tilt 1.6, lean −0.4, 3 levels at 0.5, zones 0.7; crevices multiplied dark, blue-black / brown grain                                                                                             |
| Slate plates                 | angle −20°, size 18, elongation 2, heights 0.5, tilt 0.4, folds 1.5, roughness 0.25, 2 levels; 2.5 px joints all open, cross-joint width 0.3, facet joints 0.2, long fractures 0.5 at −60°; 0.5 px bevel; mottle overlay           |
| Columns                      | angle 90°, cross-joint angle 20°, size 13, elongation 2.5, bedding 0.7, heights 0.8, bed relief 1.5, pitch 1 (lit caps); hexagonal prism 1, scarp 0.8, lean −0.3; Height 6; vertical streak noise (stretch 0.15) multiplied        |
| Coursed rubble               | size 30, bedding 0.9, dome 0.3, weathering 3, corner rounding 2, roughness 0.1, 1.5 px joints + facet joints 0.3 with breakup 0.6, proud 0.4, facets 0.3, 2 px round bevel; Height 2                                               |
| Sandstone flakes             | angle −25°, size 10, elongation 2.5, bedding 0.3, folds 1.5, bed relief 0.8, heights 1.2, tilt 0.8, lean −0.3, scarp 5 stepped every 2 px (steps 1), 3 levels, zones 0.6; scarps painted olive, bed colour overlay; Height 4       |
| Rubble of lens stones (128²) | size 15, elongation 1.6, bedding 0.3, stagger 0.6, dome 0.5, weathering 1.2, corner rounding 2, tilt 0.4, 2 levels at 0.3; 2 px joints near black; Height 7, key light 25°                                                         |
| White fluted cliff           | angle 90°, cross-joint angle −30°, size 18, elongation 3, rills 0.9 (3 px apart, 24 px long), half the joints open (cross-joint width 0.6), lean −0.3; Height 7                                                                    |
| Pillow stones                | size 12, bedding 0.8, dome 1, weathering 5, corner rounding 3, no merging, 2 px joints; light Streaks (lime drips, Screen), sparse dark ledge drips (Drips, relief-driven), cavity dirt                                            |
| Thin beds with lichen        | size 11, elongation 2, bedding 0.5, merge 0.5, bed relief 0.6, lean −0.6, roughness 0.15; per-facet tone overlay, crevices dark, lichen speckle                                                                                    |
| Dark fractured rock          | angle −60°, size 30, tilt 1, 3 levels, zones 1; per-facet black / tan multiply, scarps and crevices near black; Height 10                                                                                                          |
| Grey blocks / rock with moss | size 20–22, bedding 0.15–0.3, tilt 0.8–1; moss: Scarps (Above ledges) ∪ Crevices ∩ a noise breakup → a named mask; Worley noise (scale 70, two octaves, dark → light green) limited to it, as leafy clumps                         |
| Brown cobbles                | size 17, elongation 1.3, bedding 0.2, dome 0.9, weathering 2, corner rounding 3, 2 px joints filled dark                                                                                                                           |
| Cobbles in mud               | size 11, elongation 1.3, dome 0.8, weathering 2, 2.5 px joints filled with mud (a Crevices copy), faint speckle                                                                                                                    |
| Dark flaky strata            | angle −8°, size 10, elongation 3, bed relief 0.5, lean −0.5, tilt 0.8, 3 levels; scarps painted brown                                                                                                                              |
| Foliated schist              | angle 35°, size 5, elongation 4.5, warp 0.6, folds 1.5, tilt 0.8, 2 levels; per-facet colour overlay, olive flecks                                                                                                                 |
| Lava crust                   | size 9, bedding 0, weathering 1, corner rounding 1, all joints open (0.6 px, jaggedness 0.8); a Crevices copy (reach 1 px) dark red → orange with emission, ember specks — tile metric 0.43, the best of the set                   |
| Scanned cliff                | angle 80°, size 12, bedding 0.1, heights 0.3, tilt 1.2, 3 levels at 0.9, roughness 0.12, rills 0.5; per-facet hue overlay, Streaks multiplied; soft light (sky 0.55)                                                               |

All render with shadows on, a soft sky (0.4–0.6) and sub-pixel jitter: the references' ledge shadows are cast. Without
jitter, shadows alias into dotted lines along thin cracks.

Lessons: rock wants deeper relief than the panel convention (Height 4–10 at depth 2, not 0.4): the references' ledge
shadows are 4–8 px bands, which only a step falling several px can cast — sheer undersides (negative lean) and a low key
light cast them best. Colour comes as much from geometry as from paint: dark recesses, olive scarps, moss in crevices.

## Checklist

- [x] Sheared strata frame (seamless at any angle), bedding metric, row thickness, power-weighted sizes, merging, folds
      (smooth or chevron)
- [x] Cross-joint angle on a general lattice (Hermite reduction), checked numerically
- [x] Mesas with border-anchored faces, height coherence, scarp width and lean, weathering, dip, dome / ridge /
      hexagonal prism rounding (prisms break off at their ends in a plane), scooped faces
- [x] Facet levels (square, offset, less bedded, soft, faded under 8 px), fracture zones, roughness, tanh relief
- [x] Rills, laminae, pits
- [x] Joints with width variation (per joint and along it), open share, cross-joint width, facet joints along the facet
      borders (with breakup), long fractures on a lattice basis, sub-pixel fade; Shape mask
- [x] Corner rounding (rounded-box form), bed relief, pitch, stagger (running bond), scarp steps
- [x] Proud blocks; editor defaults that read as rock (recreations keep every param explicit); Style presets
- [x] Outputs: Relief, Scarps (facing), Crevices (reach, patches), Streaks; per-bed / per-facet randoms
- [x] Smoke, D3D11 compile time, seam tests (half-tile offset vs roll) with every feature on, renders compared between
      D3D11 and OpenGL
- [x] Merging on any lattice (the reduction with more whole groups), fused groups' skirts bounded by their mates,
      corners rounded on both sides of the border
- [x] Rock face template in the New project wizard (a Suggestion in scheme colours, and a Starter in sandstone), and a
      Rock face recipe (smart material) with macros
- [x] Hand-authored recreations of the references (kept in `private/`)
