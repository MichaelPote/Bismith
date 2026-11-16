# FR8.18 — Stones

**Status:** done — generator with four outputs; the _Stone face_ template and Starter in the New project wizard

## Goal

One generator for natural rock faces, built from what rock surfaces share rather than from noise: **blocks** split along
**bedding** (strata) and **joints** across it, each block with its own height and tilt, sides that fall away as
**scarps**, and faces chipped into finer **facets**. Developed against eighteen references: pale layered limestone with
overhanging ledges, dark crumpled rock, slate split into plates, columnar basalt, a coursed rubble wall, flaky layered
sandstone, a white cliff fluted by water, pillow stones with drip stains, thin beds with lichen, dark fractured rock,
grey rock and blocks with moss, brown cobbles, cobbles packed in mud, foliated schist, dark flaky strata and a scanned
cliff (colour and displacement), and a lava crust. Earlier rock recreations were assembled from Voronoi patches, noise
mottle and Cracks; they got the colour but never the form.

## Stones (`stones`, `generators/stones.ts`)

Named Rock (`rock`) until 2026-11-13, when that name went to the height-first rock generator (FR8.32, formerly Rock V2).

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
  Euclid on `nu` and `−kU`, on the CPU once per render — a derived uniform, `stonesDerived` — like the rest of the frame
  and its snapping: a finer generation's lattice is the blocks' scaled per axis, so its basis is theirs scaled). Checked numerically: every cell is invariant under both periods and the class count equals the
  determinant.
- **Blocks.** One jittered site per lattice cell, nearest site by a power distance in the metric `(u, kb·v)`, `kb = 1 +
  2·bedding`: distances across the bedding count more, so course joints lie flat while joints within a course stand
  across it. _Bedding_ cuts the sites' wander across the row (scaled by 1/kb², or the metric would tilt the joints
  within a course).
- **Bed variation.** Each bedding joint j moves across the bedding by `b_j` (up to ±0.4 rows at 1), so beds run from a
  fifth to nearly twice the _Block size_ — whole joints moving, not single blocks. A row's site sits at its centre with
  the power weight `kb² h²` (h: half its thickness): two rows' sites square across a joint then meet exactly on it, as
  circles tangent to a line, whatever the thicknesses (the weight cancels between sites of one row, so the joints within
  a course don't move). Sites' wander across the row shrinks to `1 − bA` so they stay in their cells (the 3 × 3
  search). Joint j's offset repeats every gcd(shear, rows) rows — seamless where the shear carries row j over the tile
  edge into row j + shear. The finer generations keep a small variation of their own (half the old row offsets').
- **Joint angles.** A joint across the bedding leans by `kb² Δv · W/H / Δu` (its sites' offset across the row in
  rows, over their distance along it in cells): at high Bedding a tiny offset turns it a long way while the bedding
  joints, moved by half the offset, stay put. Sites get offsets up to `±tan(angle) / (2 kb² W/H)`, so joints lean up to
  about the angle — uneven four-sided stones instead of rectangles. (Without it the joints stood square to every bed:
  the old wander across the row was cut by 1/kb² for the bedding's sake.) The angles' offsets take a random of their own
  (`rk_oy`), not Jitter's: on the same random the two leaned the same joints the same way, so either slider just pushed
  the other further and, together, they cut long slivers. Their sum is kept inside the cell (scaled down together to
  `1 − bA`).
- **Through joints.** With this chance a cell takes its place along the bedding, its size and its offset across the row
  from the cell before it across the bedding, so their joints line up and run on through both beds. Only the odd rows of
  the merge pairing link, to the even row before them, so a link never leads to another. A leaning joint runs on
  straight only if its two sites slide along it as they move to the next row — by the rows' distance times its lean —
  so a link works on column pairs (2k − 1, 2k): both cells slide by their pair joint's lean, which runs on straight; the
  other joints of a linked row step a little at the bed, as T-junctions. (The slide may carry a site up to 0.62 of a
  cell from its centre.) That gcd is the number of distinct beds on the torus, and at 1 a single bed spirals through the whole tile:
  per-bed colour, bed relief and row thickness vanished at many angles (the defaults, the template). When tiling, the
  bed count (±2) and the shear (±1) are nudged to the nearby pair with the most distinct beds (up to 6), preferring to
  change the thickness — the angle moves a few degrees at most. _Size variation_ (0–2) is the power weight: some blocks grow
  over their neighbours (up to 2: past about one cell² of weight a block's cell sometimes outruns the 3 × 3 search,
  a rare sliver, accepted for the variety). It also drives a scale field: the pixel moves along the gradient of a value
  noise about two blocks across (`A λ ∇n`, analytic, `rk_vgrad`), whose Jacobian `I + A Hₙ` spreads the blocks out where
  the noise peaks and packs them where it dips — patches of bigger and smaller stones. `A ≤ 0.1` keeps it below the
  noise's greatest curvature (~9), so the map never folds; that limits it to about ±25 % in size, so the weights do most
  of the work.
- **Merged blocks.** Blocks fuse into units — a pair or a whole 2 × 2 group — with one face (the unit's values, centred
  on the unit; a unit across two beds between its outer bedding joints), no joints, crevices or weathering inside — big
  blocks among small ones. Each 2 × 2 group merges with the _Merged blocks_ chance m, and then fuses whole with the
  chance m again, else in one pair: either row (blocks end to end) or either column (across the two beds), at random
  (`rk_unit`). So low values merge pairs, and towards 1 more and more whole groups (whole groups m², pairs m (1 − m)).
  (Every merge was a whole group at first: at low values it read as a few big squares, never as the odd long or tall
  stone.) The second row of a unit across two beds always links (as a through joint) for the unit's cells and the
  cells beside it across the group's sides, so its sides run straight through both rows: with each row's own joints,
  the outline stepped in a right-angled notch at the inner bed. A pair up one column has one side inside its group,
  which a link can't keep straight as well (the pair's cell can slide along one of its leaning sides only): the cell
  beside it there, R, is mirrored instead. The pair's cell P moves to the next row by T (its link's slide, in the
  metric); R moves by T reflected across the joint P | R (unit normal n, from their sites in the row before), so their
  sites' difference stays along n and its midpoint on the joint — the joint runs on straight — and R's size weight is
  scaled with the sites' new distance (the bisector's offset from the midpoint goes as 1 / distance). Where R would
  also have to link for the next group's unit, the link wins. Blocks only (not ridges and prisms). The unit's
  other cells are left out of the ranking of the highest mesas altogether: they share the pixel's own face, and counted,
  they stood second-highest along the unit's outer border and hid the crease (and its crack) there. Likewise the
  second-highest must be another block than the highest: two cells of one unit draping over a neighbour drew a false
  crease where their skirts met. A unit takes its first row's bed (bed relief and colour), or its face stepped at
  the inner row border. When tiling, groups are 2 × 2 cells of the lattice reduced to one domain, whole groups only (an
  odd count leaves the last at the wrap single). The Hermite domain is gcd(nu, kU) cells wide — one when they are
  coprime, as at the defaults, and then no group was ever whole: merging did nothing at most angles. Reduced by the rows
  first (the transposed lattice's Hermite basis, from the bed search's Euclid extended by one coefficient, on the CPU
  with the rest; checked equal on 32 090 lattices) the domain is gcd(shear, rows) rows high; groups
  use whichever of the two holds more whole groups. A unit's identity (joints, ranking) is its first cell's index in
  the domain offset by 2²⁰, apart from any block's key. A unit's side across two beds still steps where its joint
  leans so far that the slide keeping it straight passes the ±0.62 cells a site may move (the 3 × 3 search): strong
  Jitter and Joint angles at high Bedding, mostly under a Cross-joint angle on a tiling lattice.
- **Stagger.** Every other row shifts half a cell along the bedding — a running bond, each block bridging a joint
  below it — its wander shrinking to fit (sites stay inside their cells, so the 3 × 3 nearest-site search holds). The
  distances are taken in cell units (`(u, kb·v)`), so the cells' shape depends on the bedding alone, not on the
  elongation: in a full bond a block's end is a hexagon's flat side spanning `(kb² − ¼) / kb` of its row (75 % at no
  bedding) between two slanted shoulders; rounding and corner rounding make lens-shaped stones of them. The parity
  repeats every gR rows like the row offsets, and with a stagger the bed count is nudged towards an even number of
  distinct beds (an odd one leaves a fault every gR rows).
- **Jaggedness.** The block edges wiggle by up to _Jaggedness_ px (a value-noise offset of the pixel before the frame),
  _Jaggedness scale_ blocks across (0.2 = ragged teeth; 1–2 = joints that sweep in long curves), with _Jaggedness
  octaves_ layers of finer wiggles on the biggest (1 = smooth curves only). Strong, fine jaggedness folds space over on
  itself (the offset turns faster than the pixel moves) and tears the edges; Warp is the bending of whole strata.
- **Folds.** A broad smooth shift across the bedding (value-noise fBm, _Folds across_ the width), in beds: strata
  that bend across the rock. _Fold sharpness_ folds the noise about its mean, `2 (⅛ − |n − ½|)` (about the same
  amplitude): a V-shaped hinge wherever the noise crosses its mean — chevron folds, as in folded shale. Sharp folds get
  fewer noise cells down the texture (a quarter at full sharpness), so the hinges run roughly down it; the finer octaves
  still wander, so they don't stack on one axis as in a textbook chevron.

### Relief

- **Mesas.** Each of the 5×5 blocks around the nearest site is a mesa: its face (height, random tilt, _Ledge dip_ across
  the bedding, _Face rounding_) inside its cell; outside, the face at its nearest border point minus the px distance from
  that border (the power bisector, measured through the frame's transpose) over the _Scarp width_. The surface is the
  highest mesa, so a high block drapes over lower neighbours: plateaus and shelves, with scarps whose run grows with the
  height they fall. Evaluating a neighbour's face at its border (not extrapolating its tilted plane to the pixel) keeps
  a tilted block from slicing diagonal wedges across its neighbours. _Face rounding_ below 0 scoops the faces out.
- **Scarp run.** A skirt falls by one unit of height per _Scarp width_ px (facets twice that), levelling off smoothly
  towards a cell's thickness for blocks and 0.6 of one for facets (`run · cap / (run + cap)`): a skirt that reached past
  the cells around its block (the 5 × 5 window, the three nearest sites' borders) was cut off or jumped there — jagged
  shards over its neighbours at wide scarps, at once in the small facet cells. The crease distances convert relief back
  to px with the same run.
- **Skirt distances.** A neighbour's skirt needs the px distance from the pixel to that neighbour's cell. Its border
  with the pixel's nearest site is exact only for cells next to the pixel's; for cells further away it underestimates,
  and it jumps wherever the nearest site changes — visible steps in the skirts (46 height jumps in a 256 × 128 test at
  Scarp width 2, 302 at 5). The distance is the farthest of the cell's borders with the pixel's three nearest sites
  instead: across a Voronoi edge the three stay the same three, so it doesn't jump there (0 jumps at 2, 4 at 3, 73 at 5;
  with two sites, 48 at 3). Very wide scarps (≥ 8 px over tall steps) still show a few seams where the third and fourth
  nearest swap or the skirt outruns the 5 × 5 window. In a fused unit the three nearest are often all mates, far from
  the cell, and the bound fell far short: a taller neighbour's skirt showed through the unit in thin wedges and dashed
  cracks along its inner borders. Around a fused block the unit's mates' sites are looked up first (four more cells per
  generation, through the same code; a pair's repeat), and the mate nearest each cell is a fourth site — its border
  with the unit. (The
  pixel's fourth nearest site as that fourth bound for all other blocks was tried: 2–5 % fewer jumps over wide scarps,
  but a new seam where the fourth and fifth nearest swap — not kept.)
- **Weathering.** The drop off a block's border is rounded over ±r px (`(s + r)² / 4r`, C¹) on both sides: the block's
  own shoulder (its nearest border, tracked through the loop) and its neighbours' skirts. Facets round by their share of
  the relief, or every facet border becomes a groove. Sheer one-pixel steps light as harsh white and black lines under a
  low key light; 1–2 px of weathering softens them into the gentle shading the references have.
- **Corner rounding.** A block's distance from its borders becomes a smooth maximum of the two nearest (`rk_cornerK`,
  width `k` = 2 × _Corner rounding_ px): `max(a, b) + k h² / 4`, `h = max(k − |a − b|, 0) / k`. A corner sinks by `k / 4`
  whatever its angle and the outline curves over about `k` along each side, so stones round off and **don't meet at
  points**: every junction opens into a small void, as in rubble and drystone walls. (The first version took the exact
  distance to a corner of radius r: it sinks a corner by `r (1 / sin(φ/2) − 1)`, 0.41 r at a right angle but 0.15 r at
  the 120° corners a scattered layout mostly has, so stones still met at points.) Only where the borders really turn
  (normals more than ~20° apart): at a T-junction of courses the edge runs straight on. The rounding is taken with the
  second nearest border and with the third, each gated by its own turn, and the larger kept (`rk_round3`): symmetric in
  the two, so it doesn't jump where they swap — gating by the second's turn alone tore the voids into feathers. The
  crease moves out with it. Neighbours' skirts use the same form from outside over a cell's three farthest borders other
  than a fused unit's inner ones: rounded on the inside only, a corner sank inside its border but its skirt stood
  sharp outside — a lit lip around the voids. (A log-sum-exp soft minimum over all the borders was tried first; in small
  blocks every border is within reach, so whole blocks sank into holes.) A fused unit's outline only turns at its own
  corners. Where an inner joint meets its side, the block beyond the joint touches the other cell of the unit only at a
  point, and that cell's border with it is diagonal: taken for the outline, it turned like a corner, and the rounding
  bit a notch into the straight side either side of the inner joint, leaving a spike between them. So inside a unit
  each neighbour's border takes its direction (the turn, the crack's end share, the lean) from its border with the
  mate nearest it, while its distance stays the farthest of the borders; and outside, a cell's borders with sites that
  face another cell of its unit are left out of its rounding.
- **Rounded cracks.** With _Corner rounding_ on, the main crack (and the Shape mask's distance, and the crevices) follows
  the blocks' rounded outlines themselves. The crease, measured from the relief, wanders with the skirts' steps and
  lean, and the wide voids at the junctions showed it as torn bristles. Each of the pixel's block's three nearest
  borders is a joint of its own (open or closed, its width by its own cross-joint share): each open one's edge is
  inset by its half width (at least half a pixel; thinner cracks fade, as rk_joint's line), closed ones have none, and
  the edges are rounded together pair by pair (`rk_cornerK`, gated by each pair's turn; the largest of the three pairs —
  symmetric, and it needs no sorting, which cost 0.16 s of D3D compile). A sub-pixel crack fades by the nearest cracked edge's width:
  taken from the nearest open edge, a joint without a crack clipped the fillet where a crack met it into a point. So the crack turns each corner between
  joints of two widths, and runs straight on to a closed joint. (With the nearest border's joint and width alone, the
  crack's width switched along the diagonal where the nearest border changes: bow-tie points at every junction where a
  wide bedding crack met a thin cross crack.) The blocks' borders are their generation's own after the loop, as the
  blocks' generation runs last. Without rounding the crack stays on the creases (at the foot of a step): the band of the
  crease with the second highest block and the band of the crease with the third, each its own joint and width —
  the nearest crease alone cut a wide crack off in a chamfer where it met a thin one.
- **Faceted.** _Rounding shape_ Faceted turns each block's face into flat planes, one rising from each of its borders to
  a peak inside it (off the site by up to a quarter cell, a fused unit's at the unit's centre): split, angular stone.
  The height is the least, over the block's borders, of the pixel's distance from the border over the peak's — 0 on every
  border, 1 at the peak, and each border's region exactly the plane through it and the peak. Both distances come from the
  border's own power-bisector equation, so their ratio needs no normalising; the peak's is floored at a tenth of a cell
  (a power diagram's site can lie outside its own cell). The own block takes its planes after the 5 × 5 loop, once all its
  borders are in; a neighbour's face at its border is its planes' foot (0). Blocks only (finer facets keep the dome). The
  code compiles only into layers that pick it (`RK_FACETED`, a `shaderFeatures` variant, chosen by the dropdown): ~0.25 s
  of cold D3D compile otherwise paid by every Stones layer. Strong _Face rounding_ (> ~1.2) bows the planes a little, as
  all relief goes through the final tanh.
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
  drop, mixed in by _Scarp steps_. Each block has its own _Scarp step width_ (±30 %) and phase, the edges wobble with the
  jaggies' noise, and the staircase is measured from the border before the corner rounding, which is added on top, so
  the face meets its skirt there unchanged, at rounded corners too. A fused unit's cells share one staircase (the
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
- **Facets.** _Facet levels_ repeat the blocks at ½ and ¼ the size, added at _Facet relief_ (halved per level):
  chipped, crumpled faces. Facets are fractures, not beds, and several things keep them from reading as rows of little
  bricks: each level splits a block `m·round(elongation)` × `m` ways (about square), keeps only 40 % of the bedding, and
  is offset from the blocks (a translation, still seamless) — nested exactly, its rows fell on the block rows and
  stacked their scarps along every course joint. Their own heights are halved (they differ mostly by tilt; lower facets
  became pits), their scarps run twice as far and don't lean (sheer facet steps lit as one-pixel cracks), and a level
  whose cells are under ~8 px fades out (a grid of pixel bumps). _Facet breakup_ scales the facets and surface grain by a
  broad noise, 0 to 2: whole, smooth faces beside shattered, crumbly ones. _Surface grain_ is a little Perlin noise on top.
- **Noise facets.** _Facets_ picks what makes the detail inside the blocks: **Blocks** (above) or **Noise**, which has
  the Noise layer's controls (type, fractal, cells across, Worley's shape, octaves, warp, levels; a _Facet noise_
  section, without White, as _Surface grain_ is the pixel grain). The noise is added to the relief after the blocks are
  chosen, following the rock's warp and scaled by _Facet relief_ and _Facet breakup_, so it moves no border: blocks,
  joints, scarps and the mask stay the blocks'. Worley's cells stand in for the first facets under _Random value › Per
  facet_; _Facet joints_ need block facets. The controls and shader are Noise's own (`noiseControlsAs`, `noiseFieldGlsl`
  under the `fn_` prefix). Noise compiles as a variant (`RK_FACET_NOISE`) only for the layers that pick it: 2.6 s plain
  against about 5 s on D3D, once, and changing a noise control after that compiles nothing.
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
- **Laminae.** Fine grooves along the bedding, a whole number per bed (spaced across the pixel's own bed, so thin beds
  have finer laminae), each with its own depth (by its index, which repeats where the beds do), fading in and out with a
  breakup noise.

### Joints

The two highest mesas give the crease distance `(P₁ − P₂) × scarp` px — the foot of a scarp, or the border between equal
blocks. _Joint width_ opens it into a crack, each joint (block pair, hashed order-free) by its own share (_Joint
variation_), pinching and swelling along its length with the block-sized warp noise. _Open joints_ keeps only a share of
them, each along its whole length; a closed joint doesn't part its blocks (no crack, no bevel, one piece in the Shape
Mask). At _Joint width_ 0 it still decides which joints part the blocks in the mask (and so where a Bevel rounds them
apart); it then defaults to 0 (`linkedDefaults`), so the blocks blend into one piece unless asked otherwise. (Before,
width 0 opened every joint: each stone bevelled apart from its neighbours.) _Cross-joint width_ scales the joints across the
bedding (blocks end to end, from the two sites' offset) by 1 + its value: wide bedding cracks and thin cross cracks for
slate, the reverse for limestone's vertical cracks. 0 is the same width, −1 no crack, 1 twice as wide. (It was the
factor itself, 0 … 2 with 1 the same: set to 0 with everything else turned off, it left the cross joints without a crack
— only their weathered shoulders, a V groove — beside open cracks along the beds, and looked as if only those could
open.) _Facet joints_ cracks a share of the first facet level's borders too, at 0.6×
the width (at most a twelfth of a facet) — along the facet cell's straight border, not its crease: where a tilted face
meets a neighbour's skirt the crease curves, and cracked it curled into worms. Facet cracks sink only 60 % as deep as
the joints, and the Shape card's bevel rounds the blocks into the main joints only: wrapped round the hairlines too, it
turned them into wide grooves (L-shaped gouges across rubble stones). _Facet joint breakup_ fades them in and out along
their length (value noise about half a block across; the crack's distance shrinks with it, so its crevice glow and Shape
Mask taper to a point — switched off at half, they ended in a hard line): partial hairline cracks inside the stones —
whole and straight, they read as cracked plaster. (_Long fractures_, straight cracks cutting across many blocks at an
angle of their own, were removed: Through joints and Joint angles carry joints across the beds instead.) Under a pixel
wide a crack stays one pixel wide and fades with
its width (box filter), or diagonal hairlines break into dots.

### Outputs and randoms

- _Relief_: the height, coloured by height.
- _Scarps_: 1 on the draped skirts from their top edge to their foot, 0 on the faces (facets' skirts by their strength
  squared, or every facet step paints a fleck). _Scarp facing_ keeps those below ledges (the shaded undersides) or above them
  (shelves where dust, scree and moss settle). Its coverage is its value, as the crevices': a Normal blend paints only
  the scarps (with full coverage it painted the whole layer). The same rock in a second layer paints the scarps their
  own colour, as hand-painted rock does.
- _Crevices_: 1 in the creases (the joints and the foot of every scarp, closed joints too), fading over _Crevice reach_
  — further below a tall step — and broken into patches (_Crevice patchiness_): moss, dirt, damp. Its coverage is its value, so
  a flat colour lands only in the cracks. Main and facet creases are measured separately: a closed main joint keeps its
  crease when a facet crack is open nearby.
- _Streaks_: rain streaks running down each block from its top edge (tracked in the loop: the nearest border whose
  neighbour lies above on screen), fading over _Streak length_: narrow columns (~1.5 px, whole counts when tiling), each
  with a streak at the density's chance — clustered by groups of about eight columns — at its own strength and length,
  edges softened by a 1D tent filter over the neighbouring columns; off the scarps. Water stains, lime or rust washed
  down the faces. (Left out of the template: at its sizes they barely show, for the cost of another Stones evaluation.)
- _Random value_ (Diffuse › Random / jitter): per block, per bed (a row's value repeats where its thickness does), per
  bed varied a little per block, or per facet (patchwork colour).

Every snapped count (beds, blocks, the cross-joint shear, rills, streak columns, the noises' cell counts)
is worked out once on the CPU (`stonesDerived`, in float32 steps), so it comes out the same on every backend. On the GPU
these counts — ratios of whole numbers, often exact halves — were rounded by the GPU's last-bit error, differently on
D3D11 and OpenGL: a slate at −20° got another lattice on Windows (PSNR 21 between the backends). Snapped counts still
round ties down (`floor(x + 0.499)`), the folds' halves up; the noises' counts go through `cellsFor`'s `floor(x + 0.5)`,
which settles the default's tie at 96 / 192 / 384 px (the warp's 2.5 cells) at 3 on every backend. Exact ties remain at
_Jitter_ 0, where the sites form a perfect lattice: about 0.3 % of the pixels along the borders can differ between
the backends there.

A hidden _Pixel scale_ param (`unit: 'px'`, 1) tells the shader how big a texture pixel is under supersampling, which
scales every px param by k: the facets' pixel-scale fade, the streak columns and the jaggies' and thinnest cracks'
floors follow it, so supersampling doesn't bring back facets the small-block tuning faded out.

The defaults are a generic rock face — strata at −15°, gently folded (0.5), tilted blocks (0.8) with stepped scarps
(0.6, every 2 px) leaning down the screen (0.3); the first defaults (folds 1, tilt 0.3, sheer undersides) read as wavy
plaster. The recreations keep every param explicit, so they don't move when a default does. The proven looks are layer
presets (`public/presets/layer/stones/`): Fractured face (the template), Layered ledges, Flaky strata, Slate plates, Columns,
Coursed rubble and Cobbles. Defaults follow the output (`linkedDefaults`); a layer added in the editor sizes its blocks
and relief to the texture (`fresh`: blocks ~12 % of the texture's mean side, Height 0.32 × the block size). All noise
(warp, jaggies, roughness, rills' meander, breakup, zones, folds) runs in one flat loop and every generation in another
(38 cells each, its bound the generation count — per pixel, as facet breakup can fade the last one out); the
joints share one loop (one copy of the joint code); the coherence swell uses a copy of `valueNoise`
without the animation code; the other loop bounds come from a uniform (UNI_1). Cold compile on D3D11 (RTX 5080):
**about 3.7 s** (3.25 s before pairs, the joints' own widths at junctions and the angles' own random, measured
back to back; it had been about 2.6 s, earlier) — over Truchet's (2.0 s; Tessellation 1.8 s, Chips 1.67 s, Cracks 0.81 s); ~3.7–3.9 s while the bed
snapping, the lattice bases and the fractures' direction search still ran per pixel (they are derived uniforms now). The
long fractures cost ~0.3 s of it, the three-site skirt distances ~0.3 s, the streaks ~0.2 s, merging on the reduced
lattice and the fused groups' mates ~0.6 s, scarp steps, stagger, chevron folds and the facet cracks' breakup ~0.2 s
together (measured before the port). Flattening the noise loop over octaves, and uniform bounds on the small loops, made no difference. What
did: **`continue` and early `break` in the generations' loop** — the mates' four cells first skipped the rest of the
body with `continue`, and a faded-out last generation broke out of the loop; together they cost 0.9 s (4.7 s → 3.8 s as
an if / else chain, and the generation count worked out before the loop as the loop's bound; a break on it cost 0.3 s
more). Merging cost 0.42 s of the 3.25 s, and 0.54 s with pairs; the joints' own widths about 0.3 s, after cutting: the
blocks' three borders copied for the crack after the loop cost 0.27 s (now the blocks' generation runs last instead),
and sorting the crack edges 0.16 s (now a symmetric pairwise rounding); choosing the joints' inputs before their loop
made it slower. Per pixel the layer costs about 10 % more (44 against 40 ms per 2048² layer). A whole 1024² frame with
a Stones layer at the defaults renders in ~0.25 s at 16 samples (RTX 5080), so sliders stay interactive.

## Stone face template (New project wizard)

(Called Rock face, with its layers Rock and Rock colour, until the generator became Stones; its presets moved from
`project/rock/` to `project/stone/` (category Stone), with "rock" in their names, ids and descriptions now "stone".)

`rocky` in `match/templates.ts` (it replaced the noise-based _Ridged, faceted rock_): steep strata (−60°) broken into
tilted blocks of widely spread sizes (0.9), 45 % merged — big blocks among small ones; at 30 % and 0.6 they read as a
regular lattice of scales — three facet levels with facet breakup at 0.8 — whole, smooth fracture planes beside
shattered zones — scarps stepped every 2 px (thin layered edges along the blocks' sides), no laminae (even at 0.15 they
turned the smooth faces into wood grain), Height 0.32 × the block size. (At this angle merging only took
effect once it worked on the reduced lattice.) Blocks are 12 % of the texture's mean side (√(w·h), so wide textures
don't get huge blocks), 7–32 px. Small blocks lose their facets (cells under ~8 px fade out), so the settings blend from
a small-block look (less bedding, more tilt, a little grain) at 8 px to the large-block one from 16 px up. Five copies
of one Stones pattern (relief only, colour by height, bed colour overlay, scarps multiplied dark, crevice dirt or moss on
a palette with a real, yellowish green — `greenest()` also takes slate's blue-greys, and painted lighter than the rock
they drew pale lines along every crevice), in-hue grain and cavity grime; the optimiser ties the copies' pattern params
(a test checks it). A low (25°), warm key light and a cool sky, shadows on: the blocks cast shadows. Under a game
palette (painted light, no shadows) the same rock is shaded by its slopes alone. Built from references (Match's
Suggest), the colours follow each reference's palette.

It is also a Starter: _Stone face_ (`project/stone/stone-face.json`) builds the template at 128 px in a fixed warm sandstone
palette, picked from four rendered side by side. And a recipe (smart material): _Rock face_ in `recipes/nature.ts` added
the same look to an existing project under macros — bedding angle, block size (0: an eighth of the texture's mean side)
and variety, bedding, relief depth, tilt, facets, scarp steps, weathering, crevice dirt, moss and its colour, rock
colours, bed colour — and turns shadows on.

Of the candidates rendered across the stone schemes at 32–256 px — layered ledges (from the limestone recreation), flaky
sandstone, columns (from the columns recreation) and fractured blocks — the fractured one read most clearly as rock at
every size: the ledges looked like a flagstone wall and dried mud, the columns like candles, out of their context.

## Settings that reproduce the references

The layer presets take their shape settings from these rows (where they differ from the defaults): Fractured
face from the template, Layered ledges, Flaky strata (Sandstone flakes), Slate plates, Columns (without facets), Coursed
rubble and Cobbles (Brown cobbles) — generated from the recreations, not retyped.

| Look                         | Key settings                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layered ledges               | size 24, elongation 1.4, bedding 0.3, merge 0.6, coherence 0.2, bed relief 0.8, lean −0.6 (sheer undersides), scarp 2, weathering 2, 3 facet levels at 0.8; 0.5 px joints, 12 % open, cross-joint width 1; Height 8, key light 22° |
| Crumpled dark rock           | angle −10°, size 16, bedding 0.45, tilt 1.6, lean −0.4, 3 levels at 0.5, zones 0.7; crevices multiplied dark, blue-black / brown grain                                                                                             |
| Slate plates                 | angle −20°, size 18, elongation 2, heights 0.5, tilt 0.4, folds 1.5, grain 0.25, 2 levels; 2.5 px joints all open, cross-joint width −0.7, facet joints 0.2; 0.5 px bevel; mottle overlay                                          |
| Columns                      | angle 90°, cross-joint angle 20°, size 13, elongation 2.5, bedding 0.7, heights 0.8, bed relief 1.5, pitch 1 (lit caps); hexagonal prism 1, scarp 0.8, lean −0.3; Height 6; vertical streak noise (stretch 0.15) multiplied        |
| Coursed rubble               | size 30, bedding 0.9, dome 0.3, weathering 3, corner rounding 2, grain 0.1, 1.5 px joints + facet joints 0.3 with breakup 0.6, proud 0.4, facets 0.3, 2 px round bevel; Height 2                                                   |
| Sandstone flakes             | angle −25°, size 10, elongation 2.5, bedding 0.3, folds 1.5, bed relief 0.8, heights 1.2, tilt 0.8, lean −0.3, scarp 5 stepped every 2 px (steps 1), 3 levels, zones 0.6; scarps painted olive, bed colour overlay; Height 4       |
| Rubble of lens stones (128²) | size 15, elongation 1.6, bedding 0.3, stagger 0.6, dome 0.5, weathering 1.2, corner rounding 2, tilt 0.4, 2 levels at 0.3; 2 px joints near black; Height 7, key light 25°                                                         |
| White fluted cliff           | angle 90°, cross-joint angle −30°, size 18, elongation 3, rills 0.9 (3 px apart, 24 px long), half the joints open (cross-joint width −0.4), lean −0.3; Height 7                                                                   |
| Pillow stones                | size 12, bedding 0.8, dome 1, weathering 5, corner rounding 3, no merging, 2 px joints; light Streaks (lime drips, Screen), sparse dark ledge drips (Drips, relief-driven), cavity dirt                                            |
| Thin beds with lichen        | size 11, elongation 2, bedding 0.5, merge 0.5, bed relief 0.6, lean −0.6, grain 0.15; per-facet tone overlay, crevices dark, lichen speckle                                                                                        |
| Dark fractured rock          | angle −60°, size 30, tilt 1, 3 levels, zones 1; per-facet black / tan multiply, scarps and crevices near black; Height 10                                                                                                          |
| Grey blocks / rock with moss | size 20–22, bedding 0.15–0.3, tilt 0.8–1; moss: Scarps (Above ledges) ∪ Crevices ∩ a noise breakup → a named mask; Worley noise (scale 70, two octaves, dark → light green) limited to it, as leafy clumps                         |
| Brown cobbles                | size 17, elongation 1.3, bedding 0.2, dome 0.9, weathering 2, corner rounding 3, 2 px joints filled dark                                                                                                                           |
| Cobbles in mud               | size 11, elongation 1.3, dome 0.8, weathering 2, 2.5 px joints filled with mud (a Crevices copy), faint speckle                                                                                                                    |
| Dark flaky strata            | angle −8°, size 10, elongation 3, bed relief 0.5, lean −0.5, tilt 0.8, 3 levels; scarps painted brown                                                                                                                              |
| Foliated schist              | angle 35°, size 5, elongation 4.5, warp 0.6, folds 1.5, tilt 0.8, 2 levels; per-facet colour overlay, olive flecks                                                                                                                 |
| Lava crust                   | size 9, bedding 0, weathering 1, corner rounding 1, all joints open (0.6 px, jaggedness 0.8); a Crevices copy (reach 1 px) dark red → orange with emission, ember specks — tile metric 0.43, the best of the set                   |
| Scanned cliff                | angle 80°, size 12, bedding 0.1, heights 0.3, tilt 1.2, 3 levels at 0.9, grain 0.12, rills 0.5; per-facet hue overlay, Streaks multiplied; soft light (sky 0.55)                                                                   |

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
- [x] Facet levels (square, offset, less bedded, soft, faded under 8 px), facet breakup, roughness, tanh relief
- [x] Rills, laminae, pits
- [x] Joints with width variation (per joint and along it), open share, cross-joint width (each joint its own at junctions), facet joints along the facet
      borders (with breakup), sub-pixel fade; Shape mask
- [x] Corner rounding (rounded-box form), bed relief, pitch, stagger (running bond), scarp steps
- [x] Proud blocks; editor defaults that read as rock (recreations keep every param explicit); layer presets of the proven looks
- [x] Outputs: Relief, Scarps (facing), Crevices (reach, patches), Streaks; per-bed / per-facet randoms
- [x] Smoke, D3D11 compile time, seam tests (half-tile offset vs roll) with every feature on, renders compared between
      D3D11 and OpenGL
- [x] Merging on any lattice (the reduction with more whole groups), pairs before whole groups, fused units' skirts bounded by their mates and rounded only at their own corners,
      corners rounded on both sides of the border
- [x] Stone face template in the New project wizard (a Suggestion in scheme colours, and a Starter in sandstone), and a
      Rock face recipe (smart material) with macros
- [x] Hand-authored recreations of the references
