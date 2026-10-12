# FR6.3 — Reference-matching optimiser

**Status:** done (v1) — optimiser, parameter vectors, structural mutations, deterministic evaluation,
headless runs and the in-app Match workspace.

## Goal
An automated, self-improving loop that iterates the project toward a reference texture.

## Plan
- `src/match/optimizer.ts` — evolution strategy over a flat parameter vector extracted from the unlocked
  layers (+ optionally lights and post): floats/ints (normalised by min/max), colours (OKLab), enums
  (categorical resample with low probability), gradients (stop colours/positions).
- (1+λ)-ES with per-parameter step sizes adapted by success rate, periodic restarts around the best,
  optional structural mutations (toggle a layer, change a blend mode, insert a layer from a small library).
- Deterministic low-sample renders (fixed RNG) so the loss is not noise-driven; final best re-rendered at full
  quality.
- **Match workspace:** load reference (file / drop), view reference ⇆ render side by side and as a difference
  image, metric preset + weights, run / pause / apply best / revert, loss curve and per-term breakdown.
- Same optimiser callable headlessly via the harness (FR6.2).

## Checklist
- [x] Parameter vector extraction / application
- [x] (1+λ)-ES with adaptive steps + restarts
- [x] Structural mutations
- [x] Deterministic low-sample evaluation renders
- [x] Match workspace UI (reference, side-by-side, diff, curve) — `src/ui/panels/MatchWorkspace.vue`
- [x] Headless optimise via harness

## Notes
Files: `src/match/optimizer.ts` (engine-agnostic), `src/match/evaluate.ts` (engine glue), tests in
`src/match/optimizer.test.ts`.

**Parameter space.** `extractParams(project, opts?) → ParamSpace { entries, size, initial, options }` and
`applyParams(project, space, vector) → Project` (a new project; the input is never mutated; gradient stops are
re-sorted by position, colours travel with their stops). Every entry has a stable `id`
(`layer:<layerId>:<key>`, `layer:<id>:dif_grad:<i>:color|pos`, `light:<id>:azimuth`, `post:<id>:exposure`,
`base::color`, `lighting::sky.intensity`), a `label` ("Noise › Scale"), `kind`, `offset`/`dims` into the vector.
- Only enabled, unlocked layers; params with `isOptimizable(def)` (float, int, colour, gradient unless the def
  says otherwise).
- Numbers are normalised over `softMin..softMax` (the slider range; hard limits when absent), widened to include
  the current value; `px` params are limited to ±texture size; ranges with min > 0 and max/min ≥ 16 are
  log-scaled (scale, stretch, gamma…); angles spanning 360° wrap; ints are rounded on apply (a mutation always
  moves at least one unit).
- Colours (params, gradient stops, base, lights) are 3 dims in OKLab (L, and a/b mapped to 0..1), clipped to
  the sRGB gamut after mutation.
- `SpaceOptions`: `lights` (light params + sky/ambient intensity), `post`, `base`, `enums` (enum/bool params
  except channel enables; also any def with `optimize: true`), `seeds`, `softRange`, `filter(entry)` (UI
  checklist).
- `isEntryActive(project, entry)` — false when the param is hidden by `showIf` or its channel group is off
  (e.g. `warp_scale` with warp 0, roughness params with the roughness output off); inactive entries are never
  mutated. `entryValue(entry, vector)` decodes a value for display.

**Algorithm.** Per step, λ candidates (default 6) are generated from the parent; each mutates k ≥ 1 entries
(geometric, mean 2), picked with weights learnt per entry: `(1 + successes) / (1 + 0.15·fails + 0.5·neutral)`,
×0.15 for enums/seeds, ×0.3 for *dormant* entries (an effect that is off: value = default = minimum, e.g.
jitter 0, posterize 0, repeat count 1) until they succeed once. Numbers move by σᵢ·N(0,1) in normalised units,
reflected at the range ends; σᵢ starts at 0.1 and adapts per entry (×1.5 on success, ×0.9 on failure ≈ 1/5
rule, ×1.25 when the loss didn't change — quantised or inert). Enums resample to another option, seeds re-roll.
The best candidate replaces the parent when it is no worse (ties drift through inert params). *Momentum*: after
an improving step, the next step's first candidate repeats the same change. *Restarts*: after `restartAfter`
(20) steps without a significant gain (`minImprovement` 0.002), σ is reset and the parent restarts from a
perturbed copy of the best. *Islands* (`islands`, default 1): independent chains explored round-robin, the
worse half dropped every `islandSteps` (12) rounds — helps long runs (≳ 250 steps) escape early bad basins.
*Structural mutations* (`structural: true`, 10 % of candidates): toggle an unlocked layer, change a diffuse blend
mode, insert a layer from `DEFAULT_LIBRARY` (Grain, Mottle, Bumps, Cells, Blotches — noise-based; types that
aren't registered are skipped; up to `maxLayers`), or remove a layer the optimiser inserted. Locked layers are
never touched. All randomness comes from a seeded RNG (`seed`), so a run is reproducible when `evaluate` is
deterministic (the path tracer is seeded by sample index, so a fixed sample count is).

**API for the Match workspace.**
```ts
import { Matcher, fromRgba8, TERM_NAMES, TERM_LABELS } from '@/match/metrics'
import { Optimizer, type StepInfo } from '@/match/optimizer'
import { makeEvaluator, renderToMatchImage } from '@/match/evaluate'

const matcher = new Matcher(fromRgba8(imageData.data, w, h), { preset: 'texture', size: [project.width, project.height] })
// A dedicated Engine on its own (offscreen) canvas — evaluation drives it synchronously.
const evaluate = makeEvaluator(evalEngine, matcher, {
  samples: 16,
  yieldBefore: () => new Promise(requestAnimationFrame), // keep the UI responsive
  onEvaluate: (p, img, r) => { /* show latest candidate / terms */ },
})
const opt = new Optimizer(project, evaluate, { seed: 1, space: { lights: false } })
await opt.init()                       // initial loss (opt.initialLoss)
while (running) {
  const info: StepInfo = await opt.step()   // { step, evaluations, bestLoss, parentLoss, candidateLoss,
                                            //   improved, accepted, restarted, structural, changed[],
                                            //   meanSigma, island, islands, ms }
  plot(opt.lossCurve)                       // best loss per step (monotone)
}
opt.best        // { project (copy), loss, detail: MetricResult of the best, step }
opt.current     // the active chain's parent
opt.entryStates() // per-entry { id, label, sigma, success, fail, neutral, value } for a params table
opt.space       // ParamSpace (entries with labels)
await opt.run(n, { onStep, signal })        // convenience loop with AbortSignal
```
Pause = stop calling `step()`; apply best = put `opt.best.project` into the store (it's a copy); revert = keep the
project you started from (the optimiser never mutates its input). Re-render the best at full quality for display.

**Results** (64² projects, 16 spp evaluations, ≈25–35 ms per candidate under SwiftShader; harness defaults
100 steps × λ6 ≈ 20 s):
- *Panel* (rounded rect over noise; start: rect too small, sharp corners, terracotta; noise too fine and
  green-grey), layout preset: loss 0.709 → 0.489 (100 steps), → 0.358 with `--iters 300 --islands 4` (47 s) — the
  best render has the target's blue-grey rounded panel in the right place over brownish noise. The texture preset
  lowers its loss on the same target just as readily but may swap which region gets which colour (position-free).
- *Bricks* (staggered rect repeat over noise; start: grey-blue, 2×3 courses, wrong bevel/colours/noise scale),
  texture preset: 0.576 → 0.263 (seed 1) / 0.282 (seed 2) in 100 steps — brown staggered horizontal courses; seed 2
  switched the shape outline on (hollow bricks).
- Synthetic loss in parameter space (unit test): 0.357 → 0.003 in 150 steps.
Variance between seeds is large (local optima); when a run stalls, try another `seed`, `islands: 4` for long runs,
or the layout preset for laid-out targets — the texture preset happily swaps which region gets which colour.

Ideas not done: CMA-style correlated steps; a prior pulling towards the starting values; sensitivity-based
pre-screening of parameters; per-region (masked) metrics.

**Match workspace (UI).** Top tab *Match*. Load or drop a reference image; *Match size* resizes the project to it
(long side ≤ 512). Panes: reference · best so far · |difference|×3. Settings: metric preset (texture / layout),
samples per candidate, max steps, which parts to tune (layers, base, lights, post, modes, seeds, add/remove
layers). Live stats (step, evaluations, best, gain, σ), the best-loss curve, per-term bars of the best and a
log of accepted changes. *Apply best* loads the best project into the editor (undoable); *Reset* forgets the
run. It drives the editor's own Engine, suspending the interactive render loop for the duration
(`Engine.suspend()/resume()`), so no second WebGL context is needed. In-browser test: Stone bricks start →
Cobblestones reference, 149 steps in ≈25 s, loss 0.341 → 0.239.

## Craft heuristics (FR7.8)
On by default: the start project and every candidate are conformed to the rules learnt hand-authoring, the search
space uses craft priors and structural inserts come from the craft library — see
[FR7.8](fr7.8-optimizer-heuristics.md). `heuristics: false` restores the plain optimiser.

**Tied pattern params** (always on): layers of one type and seed are copies of one pattern; a pattern param they
hold equal is a single entry (`ParamEntry.tied` lists the other owners, label "(+N linked)") that `applyParams`
writes to every copy — see [FR7.8](fr7.8-optimizer-heuristics.md).

## Stop criteria
`Optimizer.runUntil(stop)` steps until the first criterion is met (`StopReason`): `targetLoss` (good enough),
`timeMs` (wall clock), `steps`, `evaluations` (total), `patience` (steps in a row without the best loss improving
by `minImprovement`, default 0.001 — restarts don't reset it), or an abort signal. `RunLimits` holds the bookkeeping
so the same rules drive the harness CLI and the Match workspace. With no bound set a run only ends when aborted.
- Match workspace: *Max steps* (whole run), *Stop at loss*, *Time limit* (per press of Optimise / Resume), *Stall
  after* — 0 switches each off; with all off the optimiser runs until paused. The log ends with the reason.
- `harness optimize … --until LOSS --time SECONDS --patience STEPS` (`--iters` then caps the steps only when given).
