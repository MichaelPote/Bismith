# FR7.7 — Drips, weathering and relief/paint mixing

**Status:** done (generators: Drips, Blisters); the riveted panels and hammered copper reworked

## Goal

A rusty riveted panel and hammered copper exposed missing tools: fluids that run down and stain what is
beneath, the flaking paint they bleed from, brushed rather than ruled metal, and dish-shaped hammer marks.

## Design

- **Drips** generator (`drips`, `src/layers/generators/drips.ts`): sources scattered on a cols × rows grid
  (density, per-cell jittered position), each with a trail running _down_ (user space) of random length
  (`len_min..len_max`), width (tapering to half, `width_var`), strength `start × (1 − t)^fade`, and a gentle
  wobble. Coverage is the strength (soft), so a Normal or Multiply diffuse blend stains in proportion. Wraps on
  tileable projects; pixel-snapped in _hard_ mode so 1 px trails hit whole pixels.
  - **Blisters** are a layer of their own (`blisters`, see _Blisters_ below; once Drips' _Output → Sources_). Both
    place their sources through `src/layers/dripSources.ts`, so the same seed and placement settings line them up.
  - **Head**: _Head fade_ (px, off by default) fades each trail in over its first stretch, eased at both ends, so it
    grows out of the surface instead of starting at a hard line; _Head rounding_ caps its top in a half-ellipse
    (0.5: a half circle as wide as the trail; up to 2: a longer, rounded point — a runnels stain's wash and its runnels'
    lanes narrow into the cap together). _Drop blob_ (`head`, off) adds a round drop at the source for viscous fluids;
    water, rust and blood have none.
  - **Two sets of drips**, independent of each other. **Scattered**: Columns × Rows grid cells, each dripping by
    _Density_ from a random spot in it — never looking at the relief. **Ledge drips** (`ledge_density`, Ledges group, 0
    by default): cells of _Ledge spacing_ px (blisters: at least half the radius), each holding its strongest ledge
    pixel (`ledgeCells`: pixels within 4 % of the strongest are picked among at random, so drips along an even ledge
    — a pipe, a moulding — don't line up a cell apart), dripping by Ledge drips × how much the drop counts × Clustering.
    So rows / columns / Density place the free drips, and Ledge drips / spacing / threshold / reach / softness the ones
    on the relief. (Replaced the single _Drips from_ slider, `spawn`, and its _Off-ledge drips_, `bare`; the built-in
    presets were converted by the counts they gave.) Prepare runs one ledge-cell pass and the source pass (one
    texture, set B below set A; `sourceCells` in dripSources.ts); the generator runs through both sets in one flat loop
    (no `continue`: ANGLE can miscompile it).
  - **Start at** (`ledge_start`, 1): where on a ledge's drop its drips start — 0 at the lip (the ledge pixel, the top
    of the Ledge reach window), 1 at its foot: the source pass walks down from the lip (`dr_foot`, at most 6 × reach +
    8 px, ≤ 96) while the height keeps falling by at least a fifth of the ledge's average per px, so under a hard step
    the foot is about the reach below, and under a round pipe or a rounded lip it is the crease where it meets the
    surface behind, rather than somewhere on its flank. The search windows of set B reach that far further up.
  - **Ledge drips** start on the ledge's own line, darkest against it — no ragged lip, no fade-in, tight corners —
    with a seep of Seep width × their width centred on the ledge spot, fanning out by Fan-out like any stain, up to
    1.5 × as wide, all by how far the ledge runs (the source pass measures it at 8 offsets, ±¼…1½ stain widths): a lip
    fully, a rivet's lower edge a little — its drip fainter (0.4–1 of the strength) and up to 1.6 × longer, so it runs
    on past the next rivet. Neighbours along a lip meet in one band that breaks into streaks.
  - **Free drips** seep from one rounded point (only a broad seep's lip is ragged, in bumps a third of the seep
    across, ≤ 6 px deep), fading in over at least 4 px, longest at the sides; their sway ramps in below the seep, so
    the seep sits on its source; their runnels leave it together and part below.
  - **Surface flow** (0.6): weaker for every rise crossed since the source in this pixel's column (counted from reach
    - 3 px below the source, so its own ledge doesn't dim it; rivet-sized rises under 0.25 height units ignored; over
      ~8 px below a rise rather than a cut; each trail its own sensitivity), pooling darker just above a rise.
      Overlapping stains add up (1 − ∏(1 − strength)), so a column of rivets darkens all the way down.
  - **Relief-aware** (group _Ledges_, `relief`): Drips reads the height the layers beneath have built. _Ledge drips_
    puts sources on **ledges** — where the height drops by at least the _Threshold_ within the _Reach_ below the source
    (short reach = only hard steps; long = soft, gradual edges too; _Softness_ turns the cut-off into a ramp; in the
    Ledges group they drop the "Ledge" prefix that Snow's Ledges section keeps, `ledgeParams(…, short)`): the lower edges of rivets, lips, pipes, blisters. _Length
    from height_ lengthens a trail with the drop it falls from (taller rivets, longer tails). Place the layer after
    whatever raises the ledges.
- **Two-stage staining** (from review feedback): one Drips layer as a wide, soft _water stain_ with Multiply
  (darkens what is beneath), and a second with the **same seed** as a narrow _rust_ trail using the shaping
  **cutoff** on the same strength field — rust appears only where the darkening is extreme (near the source).
- **Brushed metal**: value noise stretched into thin vertical lines — `scale = W / line length`,
  `stretch = line width / line length` (stretch < 1 narrows features horizontally) — with levels widened
  (`sh_lo 0.32 … sh_hi 0.68`) because fBm sits mid-range.
- **Hammered** generator (`hammered`): hand-hammered metal as the craftsman makes it — dents laid on concentric rings
  around a few hammering centres. Pixels belong to the centre with the smallest distance / weight (a multiplicatively
  weighted Voronoi partition), so regions meet along interlocking **arcs** and never overlap; each region's rings are
  `ring` px apart with `round(2πr / spacing)` dents per ring, a random rotation per ring and positional jitter
  (slightly irregular dots). The value is the dent profile, `(d / r)^shape` — higher shape = flat floors, thin rims.
  For an antiqued look the floors are light and the rims dark (a Multiply paint layer with the same params).
  - **Smooth union of dishes** (quality pass): the surface is the smooth maximum (log-sum-exp, each dent counted from
    its edge so untouched metal stays put) of the dents' depths — overlapping dents meet in creases, rounded by **Crease
    softness** (0 = the plain deepest dent). Per dent: **Size variation** (½×–2× radius), **Depth variation** (colour
    and height), **Dent tilt** (the deepest point moved off centre — a long gentle slope one way, a short steep one the
    other, floors level), **Dent stretch** (lengthens along the course, or across it below 1, never narrows), and
    **Dent rims** of displaced metal just outside the edge (0.7–1.4 radii), shown on untouched metal and the ridges between dents,
    faded down in a dent. Height › _Per-feature variation_ varies each dent's depth through `hval` (the wrapper's own
    scaling is off — it would step the rims).
  - **Hand-guided courses**: **Ring wobble** (in ring spacings, slider 0–3, up to 6: two low harmonics round the circle
    and a ninth that courses from about 3 rings out take on, so long outer courses still bend; phases drift slowly from
    course to course and the harmonics are the same on every course, so neighbouring courses wander together instead of
    gaping), **Ring variation** (courses set in or out by value noise over every three courses, so the gaps widen and
    narrow gradually; a course standing further from its neighbours grows its dents to close the gap — independent
    per-course offsets left long ridges of untouched metal), **Region variation** (each region its own dent scale, depth
    and a shade in colour only, so the regions read as separate passes). **Region arcs** weights are 1 / (1 + 2v·h)
    on new layers (positive at any v, slider to 1.5, up to 4).
  - **Regions without seams**: a dent belongs to the region its _centre_ lies in (exact weighted-Voronoi test against
    every centre), and the regions whose edge passes within a dent's reach of the pixel (the exact Apollonius-circle
    distance, nearest eight — a region counts only if it lies within reach past its edge with _every_ nearer centre, so
    far images and circles that merely pass by don't crowd out the real neighbours) are searched too, so dents cross
    region edges whole instead of being cut. **Region overlap** (in dent radii, default 2): every region's dents run on
    past its edges, both ways — whole dents (never faded ghosts), thinning out by count with a random cut-off per dent
    from 20 % of the overlap on, so the regions' last dents don't end along a line of creases (a one-sided overlap left
    the earlier region's last dents ending in a straight welt). Where dents stand apart (Dent size < 1.3), a dent near
    or past the edge of a region hammered _earlier_ (a random rank per centre) is skipped if that region already struck
    within 0.6 spacings (`hmStruck`: its own dents on the three courses and three dents around), so the passes don't
    double up along the seam. Small dents (radius under 6 px, Region variation aside) strike shallower, ×(R / 6)^0.75,
    and Dent tilt keeps the deepest point at least 4 px inside the rim, so fine peening has no one-pixel cliffs (dark
    speckle). Tiling, each centre's periodic images are separate regions, so one centre no longer breaks where the wrap
    flips. The search window follows the dent reach, wobble and course offsets (uniform-derived loop counts, no
    `continue` — ANGLE / D3D11 can miscompile it); cold D3D11 compile ≈ 1.4 s (about 0.45 s of it the doubled-strike
    check; folding the check into the main loop as a state machine with one hmDent call site compiled slower). A Ring
    wobble above 1 widens the angular search (it pulls inner courses' dents inwards, where they stand further apart in
    angle). From Dent shape 2.5 to 5 Depth variation drops to 0.3× (punches strike to much the same depth, so their
    floors don't step into each other — set Dent size below 1 to leave metal between them), and above shape 4 a burr of
    displaced metal rises round them (up to +0.35 Dent rims at 10). Crease softness maps through a square root (kc =
    0.3·√crease), so the first tenth of the slider already rounds the creases. The mask discs are joined with a 2
    px fillet, so pinholes between nearly touching dents close.
  - **Mask** (`sdf: 'mask'`, opt-in — _Write to_ is empty by default, so adding dents never replaces the Shape mask):
    the dents as discs of _Mask size_ × their radius, moving from the dent's centre (1 = whole dents) to its tilted
    deepest point (lower = round its floor).
  - **Defaults**: the plain defaults are the look at 512 px (planished bowls, Dent tilt 1 — off-centre floors — meeting in
    crisp creases, in wandering courses round 4 centres); `fresh` sizes the courses to the texture — about 21 across,
    but on small textures fewer, larger dents (5 courses across at 64 px, none closer than 14 px below 300 px), fewer
    centres, sharp creases and flatter dents (crease 0.02 → 0, Dent shape 2.4 → 3.2 from 256 px down to 64 px, so each
    dent keeps a lit and a dark edge); Height › Amount 1.4 at 512 px, × max((512 / side)^¼, √(side / 512)) — deeper on
    small textures (each dent keeps a highlight and a shadow) and with the larger dents of big ones — and a copper ramp
    that darkens the dents only a little. Height › Amount 1.4 and that ramp are the plain defaults too. **Jitter** is a
    share of the spacing; files from before the quality pass gave it in px, and loading converts it (a layer with none
    of the newer keys: `jitter` ÷ the smaller spacing). The hammered-metal recipe (Irregularity drives jitter, wobble,
    ring, size and depth variation together; Depth × 2 as Height, small dents striking shallower) and the Match
    template (separate dents, Region overlap 0.6) set the newer controls themselves.
- **Hammered metal (older recipe)**: Worley F1 squared (`sh_gamma 2`) is a field of overlapping dishes with ridges where they
  meet; two sizes combined with height **Min** (dented where either hammer struck), per-dent depth (`h_var`), a
  slight height blur, tinted specular.

## Runnels style (detailed stains)

The classic trail is a 1 px-friendly strip; at higher resolutions and widths it reads as a stripe. **Style → Runnels**
models water running down a wall instead (`dr_runnels` in `drips.ts`):

- **Wash**: the water sheet, its centre line wandering on two octaves of smooth 1D noise (Wobble = how far, Wobble
  length = one swing), narrowing or spreading down its length (Wash taper), widening from a third of its width at the seep
  over its first stretch (so the runnels fan out from one point). A darker **tide mark** within ~1 px of its edges,
  **dry patches** from value noise breaking it up.
- **Runnels**: 1 to _Runnels_ thin streams per stain (narrow stains hold fewer), each wandering on its own around its
  lane — so they cross, merge and split — thinning to half, keeping most of their strength (Trail fade sets how much they
  lose), each ending at its own length; some end in a **bead**, an ellipse narrower than it is tall hanging from the
  runnel (a round one read as a rivet).
- The cell search widens to the columns a stain can reach and up to 96 rows, as one flat loop with a uniform-derived
  count (D3D compiles it quickly).
- **Where it applies**: Drips added in the editor start as runnels sized to the texture (`LayerDef.fresh`: a
  multiply-darkening water stain); layers built in code keep the streak style unless they ask. The Water & rust
  stains material has a **Style** macro — Auto (streaks below 128 px, runnels from 128 px), Streaks, Runnels — with a
  source grid sized from the stain's width and length for runnels, rust following the strongest runnels.
- **Quality pass**:
  - **The seep**: _Seep width_ sets how wide the stain is where it seeps out (low = a point; 1 = a
    whole line — a crack, a lip; 0.8 by default); its corners are rounded, and the runnels start below it.
    **Fan-out** stretches the widening from seep to full width from about the stain's own width to its whole length,
    as a straight V; **Wash taper** acts past the fan-out, to the end (fan 0: over the whole length), so the
    two are distinct. **Shape variation** gives each stain its own seep, fan-out and taper. **Wash feather** fades the sheet
    in from its sides and down from the lip (darkest along the middle) — no more crisp-sided tubes. The wash is whole
    at its seep and breaks into streaks further down; dry patches only from 10 % of the way down. Tide marks run along
    the sides only (not across the seep), widen on broad stains, and go to 2 (a strong rim). Runnel ends are
    anti-aliased like their sides; each runnel and bead has its own width / size; sideways sways (the stain's wobble,
    the runnels' braiding) stretch over a longer stretch when they would pass ~20° from vertical.
  - **Surface flow** (group Relief, wherever the drips start): a prepare pass takes the rise from each pixel to the
    one below it (past 0.025 of grain) and prefix-sums it down every column (Hillis–Steele, log₂ H passes). A trail
    then weakens by `1 / (1 + 3 · flow · rises crossed since its source, in this column)` — a dry shadow below each
    rivet, a break at each seam (it runs on weaker) — and pools (up to 1 + 1.5 · flow) within 3 px above a rise.
  - **Clustering**: the drip chance swells and fades over patches (≥ 1/8 of the texture, ≥ 3 cells) — runs of drips
    and bare stretches along a ledge.
  - **Per-cell source pass**: every cell's drip (position, ledge drop, whether it drips) is worked out once in a pass into a (cols + 16) × (rows + 104) texture, margins for cells beyond the
    texture; the generator fetches it. The row search now reaches 96 rows for both styles.
  - **Streaks**: fine streaks down through the wash (value noise stretched down the stain, _Streak spacing_ apart), each
    lighter or as dark as the wash, each running out at its own length — a ragged, frayed lower end. They break the
    tide marks too. No dry patches in the narrow seep (they read as holes).
  - **Stain softness** (px) blurs every edge (wash, streaks, runnels, beads, heads; the streak style's trail too).
    **Strength variation** gives each trail its own share of the strength (faint old stains among fresh ones);
    **Runnel strength** sets the runnels' darkness against the wash; **Runnel braiding** how far they wander across it (0 =
    straight lanes); _Runnels_ may be 0 (the wash alone) up to 16.
  - The strength is capped at 1 (a strong wash plus tide marks used to pass it, blending past the ramp into dark and
    coloured specks). Trails longer than the row search reaches (96 rows) are shortened to it, so they still fade out
    instead of being cut off; the streak style searches as many columns as its width and
    wobble need, and a wide wobble sways over a longer stretch rather than zig-zagging.
  - Wider ranges: up to 1024 source cells per axis (relief drives want ≈ 3 px cells at 2048 px), lengths to 4096 px,
    width to 512, wobble 256, wobble length 2048, runnel width 64, ledge reach 64 px.
  - **Defaults**: the look itself is the plain default — broad seeps (0.8) narrowing down (Wash taper 0.45, Fan-out 0.1),
    Shape variation 0.8, Wash feather 0.4, Streaks 0.55, Wash 1, Tide marks 0.25, Dry patches 0.2, three faint braided
    runnels (Runnel strength 0.5, Runnel braiding 0.35, Runnel beads 0.15), Strength variation 0.45, Width variation 0.65,
    Clustering 0.35, Surface flow 0.6, Start at 1 (the foot), Raggedness 0.8. The **editor default** (`fresh`) adds what
    depends on the texture size or the style: runnels, Density 0.4 on a 7 × 3 grid and Ledge drips 0.3, 14–80 / 128 of the width long,
    Stain softness, widths, Ledge spacing 14 / 128, a brown multiply ramp; below 128 px crisp pixel streaks instead
    (Density 0.3, Ledge drips 0.15). Layers built in code keep the streak style and scattered drips only (Ledge drips 0)
    unless they ask. Its Edge card holds only Anti-alias (`sdf: 'mask'`, `sdfShowIf` for `aa`): stains have no shape,
    and write their coverage when given a mask other than Shape.

## Blisters

Peeling paint giving way to the rust beneath, as a **mask** rather than domes: the **Blisters** generator (`blisters`,
`src/layers/generators/blisters.ts`), split out of Drips (where it was _Output → Sources_) so each shader carries only
its own work. Its placement params, defaults and hashes are Drips' (`placementParams` / `sourceCells` in
`dripSources.ts`), so a Blisters layer and a Drips layer above it with the same seed and placement have the stains run
down from the blisters; built-in presets and recreations that used Sources were converted to it.

- **Where**: a ragged hole at each source (scattered, and with _Ledge blisters_ along the ledges, at least half the
  radius apart) smooth-unioned with bands along **every ledge** — the pixels the ledge test (_Threshold / Reach /
  Softness_) accepts, flooded into an exact distance field before the layer runs (`prepare` → jump flood with a custom
  source, `t_ledges`). _Ledge bands_ (`ledge_mix`, 0..1) sets how fast the bands grow with the radius (0 = spots only);
  a band opens from its middle, so radius 0 shows nothing.
- **Blister radius** grows everything: specks → dots and thin ledge lines → blobs → patches that merge into whole
  areas. _Size variation_ gives each source its own share. A big radius on a fine grid is cut short at 5 source cells
  each way (8 without the relief search); by then the blisters have merged anyway.
- **Raggedness**: lobes on the source grid's scale (they stay put as the radius grows, and tile) as big as the
  blister, plus a tear from ~2.5 px down to single pixels that small specks keep little of; it also makes the lift
  uneven along the edge — flaps curled well up next to ones barely lifted.
  - Quality pass: the lobes are an fBm — octaves from half a source cell down to ~4 px, each as deep as the radius
    allows (`0.8 · ragged · min(R, 0.6 λ)`) — so big blisters get bays and peninsulas at every scale, not just one
    wobble per cell, and stay put as the radius grows; the flaps are as long as the lift is wide (≥ 2.5 px, the old
    size at the default width) instead of pixel speckle on wide lips. Ranges: radius to 512 px, edge lift width to 128.
    Then: lobes deeper (`ragged · min(R, 0.8 λ)`); the ledge bands grow by 0.35–1.65 of the radius along the ledge
    (the cell-scale lobe noise), so no two stretches peel alike; the flaps vary the lift's width as well as its height;
    the floor steps down at the edge, then sinks deeper towards the middle over half the radius, broadly uneven (mid
    lobe noise) as well as rough — and the value (for the rust ramp) darkens with it.
- **Outputs**: the distance goes to the mask in _Write to_ (`sdf: 'mask'`: no bevel card; Shape by default, Normal),
  so the layers after it are limited to it for the rust beneath and to it with _Invert_ for the paint. **Height** is the peel, signed
  (`genOutHeight`): outside, the paint lifts towards the torn edge by _Edge lift_, steepening as it curls (cubic over _Edge
  lift width_); at the edge it falls to _Hole depth_ below the surface onto a rough floor — both × the Height amount, added to the
  relief beneath (which shows through the hole). Coverage is the hole; the value its floor's roughness (0.6–1), for a
  diffuse ramp to shade the rust by. _Hard edges_ steps the edge and the drop at whole pixels.
- The rusty-panel Match template builds them without writing a mask (`mk_target: ''`), with ledge bands only when its
  stains start at ledges.
- **Height** is on from the start (the peel is the layer), with a rust ramp that isn't metal.
- Compile cost (D3D11, cold, `tools/compile-time.ts`): one flat cell loop serves both outputs (each picks its cell
  range first), so the source search is inlined once; the blisters' five noise lookups run through one `valueNoise`
  call; the runnels' loop is bounded by their count, not a constant 8 with a break (which D3D unrolled). 1.7 s → 0.95 s
  (the stains-only generator before the blisters: 0.8 s), every map byte-identical; runnels are ~0.4 s of it (merging
  each runnel's stream and bead into one evaluation didn't help). Quality pass: ≈ 1.0 s → 1.25 s, mostly the wash's
  streak noises (four lookups through one `valueNoise` call, accumulated as they come rather than into an indexed
  array) and the fBm lobes; the source search moved to its own pass, and a bead reuses its runnel's position (one
  `dr_bj` / `dr_cx` / width evaluation fewer: 1.43 → 1.25 s). With everything since (two source sets, ledge drips,
  the free head, flow) ≈ 1.45 s. Split into two layers (and the source pass shared): Drips 0.25 s, Blisters 0.35 s on
  an RTX 5080 (the combined Drips was 0.58 s there).

## Relief / paint mixing (lesson)

Enforcing "paint never changes the shape" regressed the stone walls: part of their look was paint noise layers also
adding fine height, so lit bumps coincided with colour patches. The model is therefore: **the relief stack carries
the structure** (blocks, joints, dents); **paint layers may add fine, colour-coupled relief** — written explicitly
(`h_on`, `h_amount`) — and switch it off where only the structure should light (hammered copper).
Caution: the Noise generator's default has height on (0.25) — set it deliberately on paint layers.

## Checklist

- [x] Drips generator: stains / sources, wobble, taper, fade, pixel snap, tiling
- [x] Relief-aware sources (ledges) and height-driven trail length
- [x] Water-darkening + same-seed rust (cutoff) recipe; blisters from sources
- [x] Brushed ribs on the riveted panels; hammered copper (radial Hammered generator)
- [x] Hammered generator: weighted-Voronoi regions with arc boundaries, concentric dent rings, dent shape
- [x] Hammered quality pass: smooth union of dishes (size, depth, tilt, stretch, rim per dent), wandering courses,
      region variation, whole dents across region edges, later passes over earlier edges, seamless tiling with one
      centre, mask, small textures with fewer, larger dents, the improved look as the plain defaults
- [x] Relief/paint mixing settled (paint may add colour-coupled relief)
- [x] Runnels style: wandering wash, tide marks, dry patches, braided runnels, elliptical beads; editor default; Style
      macro on the stains material
- [x] Blisters as a mask: sources + flooded ledges grown by one radius, ragged edges, lift-and-drop peel height
- [x] Drips from: one slider grid → ledges (old Relief drive = its first half),
      whole-cell ledge search, crossfaded so the drip count grows steadily, ledge-spaced sources, both outputs
- [x] Blisters split out of Drips into a layer of its own; shared placement (`dripSources.ts`); Relief group → Ledges
- [x] Placement split: scattered (Columns × Rows × Density) and Ledge drips (own density, spacing, ledge test)
      independent; Start at lip → foot (the crease under a pipe or rounded lip); Head fade and Head rounding; random
      pick among near-strongest ledge pixels
- [x] Drips quality pass: seep width, fan-out, taper past it, shape variation, feather, streaks, softness, strength
      variation, runnel strength and braiding, clustering, surface flow, per-cell source pass (96-row reach), capped
      strength, fractal blister edges, uneven ledge bands and lips, bowl floors, wider ranges, editor default and paint swap
