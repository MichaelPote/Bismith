# FR7.8 — Craft heuristics for the optimiser

**Status:** done — on by default (`OptimizerOptions.heuristics`, Match workspace "Craft heuristics",
`harness optimize --no-heuristics` to disable)

## Goal
Hand-authoring textures against references (FR7.4–7.7) produced a list of lessons, most of them review corrections:
looks the optimiser would happily wander into because the metric does not penalise them. Encode them so automatic
matching starts from, and stays within, what reads right.

## Design (`src/match/heuristics.ts`)
1. **Craft rules** — `conformProject(project)` applies deterministic, idempotent repairs; the optimiser conforms its
   start project and **every candidate** (after `applyParams`, and after structural mutations), so a repaired value
   can never win back in.

   | Rule | Repair | Why (lesson) |
   | ---- | ------ | ------------ |
   | `fine-relief` | heightDepth → 1.5–3; \|h_amount\| ≤ 2.5 | deep bevels read as cliffs |
   | `no-pixel-height` | pixel-scale noise (feature < 2 px): height ≤ 0.05, specular output off | lit pixel noise = "hard single bright pixels"; keep pixel texture in colour, glints smooth |
   | `domain-warp` | Bricks wobble → whole-pattern domain warp | wobble makes joints wide and narrow; warp keeps their width |
   | `no-tent` | bricks / Voronoi cells / hex with a steady profile (linear, smooth, round) whose bevel ≥ ½ the feature half-size → custom curve (steep edge, slow rise) | wide steady bevels tent up in the middle |
   | `tinted-glints` | specular in use → tint ≥ 0.6 | highlights enrich the colour, not grey it |
   | `ao-for-joints` | tight joints (mortar / gap ≤ 1 px) → AO ≥ 0.8 (the AO lever then searches from 0.8 up) | touching stones separate through occlusion, not wide mortar |
   | `ledge-grid` | relief-driven Drips → source cells ≤ 3 px | every ledge (each rivet) must get candidates |
   | `painted-light` | a game palette (quake / doom) present → cast shadows off | palettised game textures are hand-painted |
2. **Search-space priors** — `craftPrior` plugs into the new `SpaceOptions.prior` hook of `extractParams`
   (exclude an entry, or narrow its numeric range keeping the current value inside): Bricks *wobble* excluded;
   height / specular of pixel-scale noise excluded (they are repaired anyway); `h_amount` in −2…2; a steady-profile
   bevel at most 0.45 × the feature half-size.
3. **Craft library** — `CRAFT_LIBRARY` replaces the default insert library when heuristics are on, each snippet
   tagged with its stack: Lumps and Chipped edges (Voronoi facets, Min, masked to the edge zone) into **relief**;
   Colour grain (height off), Mottle, Crevice dirt, Edge wear, Water stains (Drips, Multiply), Moss in hollows into
   **paint**. Structural mutations now see both stacks (toggle, insert, remove).
4. **Tied pattern params** (`patternTies` in `optimizer.ts`) — layers of one type that share a seed are copies of
   one pattern doing different jobs (relief Pillow / Edges / Block heights plus a paint layer colouring each stone;
   water stains, rust trails and blisters from the same sources; a relief noise and the paint that follows it). A
   pattern param (the generator's own groups, offsets, domain warp) they hold equal becomes **one** entry, labelled
   "(+N linked)", written to every copy — tuning can no longer pull the copies apart. Params the copies already
   differ in (bevel, trail width) stay independent. Always on; it only needs the convention "same seed = same
   pattern", so independent layers get distinct seeds.
5. **Templates rebuilt** (emulation, `src/match/templates.ts`) — the structural lessons became the templates
   themselves, so emulation starts from the recipes instead of hoping the search finds them:
   - **Masonry** (bricks, vertical bricks, blocks, new *rubble*, new *carved*) and **cobbles**: the dressed-stone
     relief stack (flat Pillow → height blur ≈ ¼ block → Edges with the crisp custom curve → Voronoi-facet Chips,
     Min, masked to the edge zone → Block heights `h_var` 1 → Lumps driving the glints → Pits), stone paint (dark
     joints outside the stones, multi-hue noise and per-stone colour ordered by **hue** so stones differ in hue,
     moss in the hollows when the palette has a green, colour-only speckle, crevice dirt / edge wear), thin mortar,
     AO 1, specular tint 0.75. Whole-pattern domain warp instead of wobble; courses never taller than the stones are
     long (a misread period falls back to half-length courses). *Carved*: grooves × a noise relief mask,
     joint paint from the same (tied) noise.
   - **Metal**: brushed streaks (`scale = W / len`, `stretch = width / len`, ≥ 2 px wide, levels widening contrast)
     in colour only; shallow Dents in relief with glints; plates / rivets / seams stay colour-coupled paint layers
     (seedless shapes can't be tied); **water stains + rust trails** from one seed — on riveted plates and panel
     grids driven by the relief (sources on every ledge, fine grid), on new *brushed* scattered with paint
     blisters. Rust only on a warm palette. New *hammered*: Hammered relief + the same pattern toning the
     dents, patina only when the palette has a green, bare-metal ramp without the greens.
   - **Ground / rock**: relief Form or Ridges (+ Voronoi facets for rock) + lumps + pits; paint shade from the same
     (tied) noise, a hue tint, colour grain.
   - Everything else: no pixel-scale height, explicit seeds, specular as its own term (base level per family:
     stone 0 with the faces' Specular output, metal 0.25, glossy tiles / marble / liquids 0.4–0.5), AO where joints
     or recesses are tight, painted light for game palettes (key light azimuth 315°, elevation 28°, intensity 1.8,
     sky 0.15, no cast shadows: 1.8 · sin 28° + 0.15 ≈ 1, so flat surfaces still render at their albedo).
   - Test: every template already satisfies the craft rules (`conformProject` changes nothing), relief layers
     never paint, and a masonry template's layout is a single tied entry.

## Checklist
- [x] Rules + `conformProject` (idempotent), applied to start, candidates, structural mutations
- [x] `SpaceOptions.prior` hook + `craftPrior`
- [x] Stack-aware craft library and structural mutations
- [x] Painted-light templates for game palettes
- [x] UI toggle, CLI `--no-heuristics`, tests (`src/match/heuristics.test.ts`)
- [x] Tied pattern params (same type + seed) in the optimiser
- [x] Rebuild the emulation templates around the relief-stack recipes (34 templates; new rubble, carved, brushed,
      hammered)
