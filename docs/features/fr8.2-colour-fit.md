# FR8.2 — Colour fitting

**Status:** done — before screening in emulation (`--no-colour-fit` to skip), in Suggest (FR8.4)

## Goal
Colour is the one thing that can be solved directly instead of left to random search. Fit it first, so template
rankings compare shapes rather than starting colours (on a stone wall, rubble lost to marble on colour, 0.40 vs
0.32, not shape) and the optimiser spends its budget on relief and structure.

## Design (`src/match/colourFit.ts`)
- Render → per-channel OKLab quantile maps (256 quantiles) from the render's colour distribution to the target's →
  push every **absolute** colour of the project through them: base colour, normal-blend `dif_grad` stops and colour
  params of enabled paint layers / channels. Modulators (multiply / overlay / screen … gradients, where white means
  "no change") and relief layers (their colour is discarded) are left alone.
- Two kinds of map: **quantile** (the whole distribution; best for continuous references) and **moments** (mean and
  spread per channel, stretch clamped to 0.5–2×; safe for palettised references with large flat areas, where a
  quantile map stretches tails into blotches). Default **auto**: each round tries both and keeps the better.
- Up to 4 rounds (re-render, re-map), stopping when a round doesn't improve the metric; returns the best project.
- **Smart materials** are fitted through their colour controls (`setMacro`), so the controls stay in charge; member
  colours a control drives are found by rebuilding the recipe with every colour control changed, and skipped.
- **Fit modes per material** (`RecipeDef.fit`): `all` (default); `lightness` (hue and chroma as authored); `none`;
  `tones` — for saturated, glowing looks a colour map dulls (lava, water): the material's ramp becomes the
  reference's **tonal ramp** (`targetTones`: the mean colour at lightness ranks 0, 15, 30, 50, 70, 85, 95, 100 % —
  denser at the light end so the brightest colour stays on a few percent of pixels), each stop placed at the same
  rank of the layer's **value**, and the other colour controls take the brightest tone. The value is read from three
  probe renders (ramp black → white, all black, all white; other colour controls black): light is linear in albedo,
  so per pixel (a − black) / (white − black) is the ramp's albedo whatever lighting, sheen or glow add. The
  reference's dynamic range and proportions — deep cores, bright filaments — without touching hue. Run once, before
  the colour-map rounds (which skip `tones` materials); kept only if the metric improves.
- Headless `fitColours(target)`; studio `"_fit": true` fits before rendering and writes `<name>.fit.json`.
- Engine-agnostic: the caller passes `render(project) → MatchImage` and a Matcher.

## Checklist
- [x] Slots, quantile maps, colour map, iterative fit (`colourFit.test.ts`)
- [x] Tone fit (`fit: 'tones'`, the Liquid lump)
- [x] Emulation (before screening), Suggest gallery
- [ ] "Fit colours" button in the Match workspace for hand-built projects
