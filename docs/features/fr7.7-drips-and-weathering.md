# FR7.7 — Drips, weathering and relief/paint mixing

**Status:** done (generator); the riveted panels and hammered copper reworked

## Goal
A rusty riveted panel and hammered copper exposed missing tools: fluids that run down and stain what is
beneath, the flaking paint they bleed from, brushed rather than ruled metal, and dish-shaped hammer marks.

## Design
- **Drips** generator (`drips`, `src/layers/generators/drips.ts`): sources scattered on a cols × rows grid
  (density, per-cell jittered position), each with a trail running *down* (user space) of random length
  (`len_min..len_max`), width (tapering to half, `width_var`), strength `start × (1 − t)^fade`, and a gentle
  wobble. Coverage is the strength (soft), so a Normal or Multiply diffuse blend stains in proportion. Wraps on
  tileable projects; pixel-snapped in *hard* mode so 1 px trails hit whole pixels.
  - **Output → Sources**: a dome at each origin instead — the blistered, flaking paint the stains bleed from. Same
    seed ⇒ same places, so a Sources layer (with height) and a Stains layer line up.
  - **Head** (off by default): an optional drop blob for viscous fluids; water, rust and blood have none.
  - **Relief-aware** (group *Relief*): Drips reads the height the layers beneath have built. *Relief drive* blends
    from scattered sources (0) to sources that only start on **ledges** (1) — where the height drops by at least the
    *ledge threshold* within the *ledge reach* below the source (short reach = only hard steps; long = soft, gradual
    edges too; *ledge softness* turns the cut-off into a ramp): the lower edges of rivets, lips, blisters. *Height → length* lengthens a
    trail with the drop it falls from (taller rivets, longer tails). Use a fine source grid (≈ 2 px cells) so every
    ledge gets candidates; place the layer after whatever raises the ledges.
- **Two-stage staining** (from review feedback): one Drips layer as a wide, soft *water stain* with Multiply
  (darkens what is beneath), and a second with the **same seed** as a narrow *rust* trail using the shaping
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
- **Hammered metal (older recipe)**: Worley F1 squared (`sh_gamma 2`) is a field of overlapping dishes with ridges where they
  meet; two sizes combined with height **Min** (dented where either hammer struck), per-dent depth (`h_var`), a
  slight height blur, tinted specular.

## Runnels style (detailed stains)
The classic trail is a 1 px-friendly strip; at higher resolutions and widths it reads as a stripe. **Style → Runnels**
models water running down a wall instead (`dr_runnels` in `drips.ts`):
- **Wash**: the water sheet, its centre line wandering on two octaves of smooth 1D noise (Wobble = how far, Meander
  length = one swing), narrowing or spreading down its length (Taper), widening from a third of its width at the seep
  over its first stretch (so the runnels fan out from one point). A darker **tide mark** within ~1 px of its edges,
  **dry patches** from value noise breaking it up.
- **Runnels**: 1 to *Runnels* thin streams per stain (narrow stains hold fewer), each wandering on its own around its
  lane — so they cross, merge and split — thinning to half, keeping most of their strength (Fade sets how much they
  lose), each ending at its own length; some end in a **bead**, an ellipse narrower than it is tall hanging from the
  runnel (a round one read as a rivet).
- The cell search widens to the columns a stain can reach and up to 40 rows, as one flat loop with a uniform-derived
  count (D3D compiles it quickly). The streak style keeps its exact search, so its renders are unchanged.
- **Where it applies**: Drips added in the editor start as runnels sized to the texture (`LayerDef.fresh`: a
  multiply-darkening water stain); stored projects, recipes and templates keep the streak default. The Water & rust
  stains material has a **Style** macro — Auto (streaks below 128 px, runnels from 128 px), Streaks, Runnels — with a
  source grid sized from the stain's width and length for runnels, rust following the strongest runnels.

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
- [x] Relief/paint mixing settled (paint may add colour-coupled relief)
- [x] Runnels style: wandering wash, tide marks, dry patches, braided runnels, elliptical beads; editor default; Style
      macro on the stains material
