# FR6.2 — Headless render harness

**Status:** done (v1)

## Goal
Let Claude (or CI) render project JSON to PNG and score it against a reference without touching the UI —
"use your own intuition and a harness to test and iterate".

## Plan
- `src/headless.ts` — `window.__bismith` API: `loadProject(json)`, `render({ samples }) → PNG data URL`,
  `renderChannels()`, `compare(targetDataURL, weights) → metrics`, `optimize(target, options)`.
- `?headless` URL flag renders a minimal page (no editor chrome).
- `tools/harness.ts` (`npm run harness -- <command>`): starts Vite in-process, launches Playwright Chromium
  (SwiftShader/ANGLE when no GPU), and runs:
  - `render <project.json> [--out out.png] [--samples N] [--channels]`
  - `compare <project.json> <target.png> [--out sheet.png]` → metric report + side-by-side contact sheet
  - `optimize <project.json> <target.png> [--iters N] [--out best.json]`
- Output folder `harness-out/` (git-ignored).

## Checklist
- [x] Headless API in the app
- [x] Minimal `?headless` mode
- [x] Playwright CLI: render
- [x] Playwright CLI: compare + contact sheet
- [x] Playwright CLI: optimize
- [x] Documented usage

## Usage
All commands start Vite (no HMR / file watching, so edits elsewhere in the repo can't reload the page mid-run),
open `/?headless` in Playwright Chromium with SwiftShader, and drive `window.__bismith`. Outputs default to
`harness-out/`. Project JSON may be partial — missing fields and params get defaults (`normalizeProject`).

```sh
# Render (and optionally every material map)
npm run harness -- render a.json --out harness-out/a.png --samples 64 [--maps]

# Contact sheet of existing PNGs (nearest-upscaled, checkerboard under alpha)
npm run harness -- sheet harness-out/sheet.png a.png b.png --scale 3

# Score a project against a reference: metric table + sheet [target | render | |difference|×2]
npm run harness -- compare b.json target.png [--out sheet.png] [--samples N] [--preset texture|layout|tile]
        [--weights colour=2,aligned=1] [--max-size 128] [--wrap] [--window] [--json] [--scale N]

# Optimise a project toward a reference: progress per step, best JSON + sheet [target | start | best | diff×2]
npm run harness -- optimize b.json target.png [--iters 100] [--samples 16] [--out best.json]
        [--preset texture|layout|tile] [--weights …] [--lambda 6] [--islands N] [--seed N] [--sigma 0.1]
        [--lights] [--post] [--base] [--shading] [--enums] [--seeds] [--structural] [--final-samples 64] [--max-size N]

# Benchmark the optimiser on (start project, reference) pairs, several seeds each, scored under Tile and Texture
npx tsx tools/matchbench.ts pairs.json strategy.json [--seeds N] [--workers N] [--label NAME] [--only REGEX]
```

- The target is decoded in Node (pngjs, exact 8-bit sRGB) and resampled (area average, linear light) to the
  project size (capped by `--max-size`, default 128) — set the project's width/height to the reference's for a
  1:1 comparison.
- `compare` prints raw value, normalised score and weight per term (see FR6.1), and the total.
- `optimize` prints one line per step: `*` = new best, `R` = restart, best / candidate loss, mean σ, time, and
  what changed. The best project is written to `--out` after every improvement (so an interrupted run keeps its
  progress) and again at the end, followed by a metric table of the best re-rendered at `--final-samples`.
  `--iters` counts steps; each step renders λ candidates. 64² at 16 spp ≈ 25 ms per candidate under SwiftShader,
  so 100 steps × λ6 ≈ 15 s. Runs are deterministic for a given `--seed`.
- Flags `--lights --post --base --shading --enums --seeds` widen the parameter space; `--structural` enables
  toggle / blend / insert / remove layer mutations (FR6.3).
- Headless pages keep the editor's interactive render loop suspended (nothing is displayed; its frames would trace
  between API calls). `memoryInfo()` reports the GPU objects alive (three.js `renderer.info.memory`) — `compare`,
  `fitColours` and each new `optimizeStart` free the VGG scorer targets of the matcher they replace.
- `compare` and `optimize` use the Match workspace's matcher: tileable projects are compared periodically (best
  wrap-around shift, `window` off) and the VGG texture term is attached whenever the preset weights it — so their
  totals are the numbers the workspace shows. `--wrap` / `--window` still override.
- `tools/matchbench.ts` (FR6.3 v2): `pairs.json` lists `{ name, project, reference }`, `strategy.json` the phases
  (`{ preset, steps, options }`, each from the previous phase's best). Every pair × seed runs on a shared worker
  queue; it writes each best project and a [reference | start | best | diff] sheet, appends a line per run to
  `results.jsonl`, and prints per-pair means of the best Tile / Texture totals and per-move statistics.

## Page API (`window.__bismith`, src/headless.ts)
- `loadProject(json) → Project`, `getProject()`, `render({ samples }) → { png, width, height, samples, ms, errors }`,
  `renderMaps(kinds?) → { [kind]: dataURL }` (unchanged).
- `compare(target, opts?) → Promise<HeadlessCompareResult>` — renders the current project (`opts.samples`, default
  its maxSamples) and scores it. `target` is a PNG/JPEG data URL (decoded with `createImageBitmap`, no colour
  management or premultiplication) or `{ width, height, rgba }` with raw 8-bit RGBA (base64 string or byte array).
  `opts` = `MetricOptions` (`preset`, `weights`, `size` default project size, `maxSize`, `wrap`, `window`) +
  `samples`, `diffGain`. Result = `MetricResult` (`total`, `terms`, `raw`, `weights`, `width`, `height`) +
  `renderPng`, `targetPng`, `diffPng` (at the comparison size), `samples`, `ms`.
- `optimize(target, opts?) → Promise<HeadlessOptimizeResult>` — whole run in-page:
  `{ bestProject, bestLoss, initialLoss, evaluations, history: StepInfo[], compare }`; afterwards the best is
  the current project. `opts` = `OptimizerOptions` (FR6.3) + `iters` (default 30), `samples` (16),
  `finalSamples` (64), `metric` (MetricOptions).
- Step-wise (what the CLI uses for progress): `optimizeStart(target, opts) → { initialLoss, entries, width,
  height }`, `optimizeStep(n = 1) → StepInfo[]`, `optimizeBest() → { project, loss } | null`,
  `optimizeFinish() → HeadlessOptimizeResult`.

## Notes
- Chromium needs NSS/NSPR. On machines without them (and without root): `apt-get download libnss3 libnspr4`
  into `.cache/chromium-libs/debs/`, then `dpkg -x <deb> .cache/chromium-libs` for each; `chromiumEnv()` adds
  `.cache/chromium-libs/usr/lib/x86_64-linux-gnu` (and `/nss`) to `LD_LIBRARY_PATH` automatically.
- Results of the reference test runs are in FR6.3.
