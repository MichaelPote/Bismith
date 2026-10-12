# FR7.3 — Automatic emulation pipeline

**Status:** in progress — pipeline working; templates growing with the bespoke generators

## Goal
Emulate a whole reference texture library (palette PNGs) procedurally, at scale, on the GPU.

## Design
- `src/match/analyze.ts` — size, tileability (seam vs interior differences, lenient: border structure lines are
  common), dark→light k-means palette + weights, lightness stats, chroma, directional edge energy, glow fraction,
  **dominant periods + phases** along x/y (circular autocorrelation of column/row edge profiles → brick courses,
  tile and panel spacing) and coarse hints.
- `src/match/templates.ts` — family recipes `build(analysis, ctx) → Project`: size/tiling from the target, colour
  ramps from its palette, counts/offsets from its periods, subtle relief (heightDepth 2.5), lighting calibrated so a
  flat surface renders ≈ its albedo, final palette snap (exact library palette). Since FR7.8 the templates are
  built from the hand-authoring recipes: a relief stack (dressed stone, lumps, dents, facets) separate from the
  paint, specular and AO per family, water + rust stains — see
  [FR7.8 § Templates rebuilt](fr7.8-optimizer-heuristics.md).
- `src/match/emulate.ts` — screen every template with a short optimisation → race the best few → optimise the
  winner → final render (metric: texture statistics + a modest pixel-aligned term).
- `window.__bismith.emulate(target, opts)` (headless) and `tools/emulate.ts` (batch: N GPU workers, resumable
  index, per-target JSON / render / sheet / result, `gallery.html`). Palette auto-detected from the PNG `PLTE`.
- **Run until good enough** — `targetLoss` / `timeMs` (`--until LOSS`, `--time SECONDS` per target): screening
  always completes; the race and the final optimisation then run until the search loss reaches the target or the
  time is up (`evals` caps each finalist only when given). A finalist that stalls (`patience`, default 80 steps
  without progress) hands the remaining time to the next raced template, so a long budget also tries the
  runners-up; the best of them wins. The result records `stop` (why it ended) and `finalists` (loss and
  evaluations per raced template).

## Known limit: family choice
The screen ranks templates by the metric after a short optimisation. Its heaviest term, *structure*, compares
pixels at the best circular shift — it rewards a layout that lines up (a regular 2×2 block wall) but reads every
irregular pattern on another seed as unrelated (≈ 0.63 for every template on two irregular references), so the ranking
falls to colour and contrast and can prefer a smooth template (marble) to the right family (rubble). Shift-invariant
autocorrelation of lightness, of half-resolution lightness and of edge magnitude were tried as a replacement and
did not separate families on 64 px palette textures (pixel speckle dominates). Until there is a better term, pass
`--templates` when the family is known.

## Results log
- Baseline templates, small reference library (6 GPU workers): 4.0 min, mean loss 0.303. Strong on bricks, blocks,
  rock, marble tiles, lava, planks; tech panels, emblems, scales and chains need FR7.2 generators.

## Checklist
- [x] Target analysis incl. period / phase detection
- [x] Template library v1 (rough, rocky, cobbles, bricks, blocks, plate, panel grid, tiles, two-tone tiles, planks, liquid, trim, light)
- [x] In-page emulate (screen → race → optimise → final)
- [x] Batch tool with workers, resume, gallery
- [x] Doom palette built in
- [x] Templates for the FR7.2 generators
- [x] Template library v2: relief-stack recipes, tied copies, stains (FR7.8)
- [ ] Experience memory: seed new targets with nearest past winners
- [ ] Full library run + per-family report
