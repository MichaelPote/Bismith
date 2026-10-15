# FR6.3 — Reference-matching optimiser

**Status:** done (v2, 2026-10-14) — optimiser, parameter vectors, structural mutations, deterministic
evaluation, headless runs and the in-app Match workspace; v2 adds the search order, sweeps, gradient steps, colour
fits, copy alignment, shading levers and the Tile + Texture preset (see v2 below).

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
- `SpaceOptions`: `lights` (light params + sky/ambient intensity), `post`, `base`, `shading` (render AO strength and
  radius, specular scale and tint — scope `render` — and the project's height depth — scope `project`; ranges from
  `src/core/settingsDefs.ts`, shared with the Properties panel; the AO radius is inactive while the strength is 0), `enums` (enum/bool params except channel enables; also any def with
  `optimize: true`), `seeds`, `softRange`, `filter(entry)` (UI checklist).
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
*Structural mutations* (`structural: true`; by default only once the search has stalled, see below): toggle an unlocked layer, switch a diffuse blend
among the tonal modes (normal, multiply, overlay, soft light, screen — add, subtract, darken and lighten won pixels
but left colours nobody would author), insert a snippet from `DEFAULT_LIBRARY` (lumps, colour grain, mottle,
crevice dirt, edge wear, water stains, moss, chipped edges; types that aren't registered are skipped; up to
`maxLayers`), *duplicate* an enabled generator layer (a new seed, half the time an octave apart in `scale`, right
above it or above its smart material), or remove a layer the optimiser added. A paint snippet takes its colours from
the reference where the parent's render misses it most (`residualColours`, the worst tenth of the pixels). Kinds are
picked by their recent gain per evaluation (`StepInfo.moves` reports them as `structural:insert` …). An inserted layer
is *incubated* before it is judged: `incubation` (default 3) extra evaluations mutate only its own numeric params
with wide steps (σ 0.25), and the best version competes with the parent — at its template values a new layer almost
never beats a parent tuned for many steps, so without this inserts were rejected before they could be tuned.
Locked layers are never touched. All randomness comes from a seeded RNG (`seed`), so a run is reproducible when `evaluate` is
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
(long side ≤ 512). Panes: reference · best so far · |difference|×3 (with the Windows metric, FR8.19, the window
mismatch map instead). Settings: metric preset (tile / windows / texture / layout; a reference of ≥ 256 px starts on Windows, a smaller one on Tile, until one is picked; changing it rescores the panes),
samples per candidate, max steps, which parts to tune (layers, base, shading, lights, post, modes, seeds, add/remove
layers — on by default). Live stats (step, evaluations, best, gain, σ), the best-loss curve (its axis spans at least 0.2 down from the start, so late
gains look as small as they are and a flattening is plain), per-term bars of the best and a
log of accepted changes (structural ones too when they're kept without a new best). The settings panel's
height is draggable (stored per browser). *Apply best* loads the best project into the editor (undoable); *Reset* forgets the
run. It drives the editor's own Engine, suspending the interactive render loop for the duration
(`Engine.suspend()/resume()`), so no second WebGL context is needed. In-browser test: Stone bricks start →
Cobblestones reference, 149 steps in ≈25 s, loss 0.341 → 0.239.

## v2 — search order, sweeps, gradient steps, colour fits (2026-10-14)

Benchmarked with `tools/matchbench.ts` (below) on eight start-project / reference pairs — two hand-built stone walls
and six recipe defaults (cobblestones, metal plate, pipes, wood, hammered metal, concrete) against game textures —
three or four seeds each, every result scored under both the Tile and the Texture preset. Single runs are noisy
(the same strategy differs by ±0.05 between seeds), so changes were kept only on paired means.

**Levers.** `SpaceOptions.shading` adds the render's AO strength and radius, specular scale and tint and the
project's height depth (scopes `render` / `project`, ranges from `src/core/settingsDefs.ts`, shared with the
Properties panel); `base` now includes the base specular. Lights (key-light direction, intensity, sky and ambient)
help as much as anything here and are on by default in the Match workspace.

**Search order** (`ordered`, default on). Entries fall in three tiers (`entryTier`): *form* — pattern / layout,
height, roughness, specular, edge shaping, lights, shading; *tone* — diffuse amounts, value shaping (`sh_*`), masks,
post; *colour* — colours and gradient stops. Selection weights start at form 1, tone 0.2, colour 0.03; when the
search stalls (`restartAfter` steps without a significant gain) the next tier opens instead of a restart (form +
tone, then everything). Colour still moves from the start, through colour fits.

**Moves.** Besides the sparse mutations and momentum:
- *Sweeps* (`sweepRate` 0.2 of steps): one entry at λ values spread over its range or a window around it (integers
  try other values, enums other options, seeds new seeds) — a coarse line search past the local dips of a
  periodic or multimodal parameter (a stagger, a light azimuth).
- *Gradient steps* (`gradientRate` 0.15 of steps, SPSA): `gradientSize` (8) numeric entries move together by
  ±½σ with random signs; the two scores give a slope, and two more candidates step along it — the correlated moves
  single-entry mutations miss.
- *Colour fits* (`colourFitRate` 0.08 of candidates, when `target` is set and `evaluate` returns its render): the
  parent's colours — all of them, or one owner's (the base or one layer), a quarter of the time lightness only —
  mapped towards the reference's OKLab distribution (`colourFit.ts`, moments or quantile map, strength 0.4–1).
  The most efficient move per evaluation by far early on; higher rates crowd out the rest and lose overall.
- *Copy alignment* (`relinkRate` 0.05): layers of one type and seed are copies of one pattern
  (`driftedCopies`); when they've drifted apart, a candidate aligns one copy to another (all differing keys or a
  random half).
- *Structural* (`structural`, off by default in the API, on in the Match workspace): inserted layers are incubated (above) and must save `layerCost`
  (0.003) of loss to be kept — removals are credited the same — so the stack no longer fills to `maxLayers` with
  layers that barely help. `structuralWhen` (default `'stalled'`): when the search stalls with every tier open, a
  round of `structuralRound` (8) changes of the best replaces the restart — inserts incubated, the two most promising
  new layers then tuned for 16 evaluations ((1+1)-ES on their numbers and colours) — and the best of them is kept if
  it beats the best, layer cost included; otherwise the restart follows. `'always'` mixes structural candidates into
  every step at `structuralRate` (adaptive like the other moves; incubation evaluations count against them).

*Adaptive move mix* (`adaptive`, default on): each move kind's rate is scaled by its recent gain per evaluation
relative to plain mutations (×0.25…×4 once both have ≥ 20 evaluations; gains count only beyond `tolerance` and decay
with a half-life of ~35 steps) — colour fits pay early and fade later, so a fixed rate is wrong at one end or the
other. Neutral to slightly positive in the benchmark (Δ Tile + Texture −0.004 ± 0.007, 15 pairs × 3 seeds).

`StepInfo` reports `stage` / `opened`, `sweep`, and the move kind behind each candidate (`moves`) and the accepted
one (`move`); the Match log shows tier openings and kept structural changes.

**Determinism.** Identical runs (same project, reference, seed) now reach identical results, also when several
headless pages run at once. Three causes were found and fixed: the wrap helpers `imod` / `pat_imod` took `%` of
negative numbers — undefined in GLSL ES, and on ANGLE / D3D11 its result could vary between runs of the same draw
(it is now Euclidean with non-negative operands); under multi-page load, render passes still raced in the last bits,
so `Engine.renderNow` waits for the GPU (`gl.finish`) before and after tracing (no measurable cost) and always starts
from sample 0 at full quality; and the optimiser compared losses exactly, so last-bit noise decided ties between inert
moves — losses within `tolerance` (1e-6) now tie, and ties go to the earlier candidate (also for the sign of a
gradient step). Headless pages run with the interactive loop suspended.

**The structure floor (investigated, metric unchanged).** On stochastic materials the Tile preset's *structure* term
has a floor: two renders of one project that differ only in their random detail already score ≈0.58 (stone wall),
≈0.60 (metal), ≈0.62 (wood) on it — a match whose detail was re-rolled is "perfect" yet far from 0, and optimised
results sit near that floor. Coarser scales, local shift tolerance and edge maps were tried as a *layout* term
(multi-scale |Δz| at ½–⅛ scale, ±1 texel tolerance): none lowered the floor relative to unrelated textures
(≈0.41–0.50 of their distance for every variant — the randomness reaches every scale: mottle, lumps, joint tone),
and on a retrieval test (66 hand-authored recreations against their references) none ranked the right reference
significantly better than structure. Optimising with structure at weight 0.5 or 0 left the original Tile and Texture
totals of the results unchanged (paired, 14 pairs × 3 seeds). So the term stays; its residual on such materials is a
property of the material, not something a search can remove.

**A stronger texture term (investigated, metric unchanged).** Three ways of strengthening the VGG term were measured:
- *Sliced Wasserstein* distances between the VGG feature distributions instead of Gram matrices (Heitz et al. 2021;
  one random direction per channel at each tap, sorted projections compared).
- *Scale*: the network run at 1×, 2× or 4× the reference's size, or a mean over several of those.
- A *texture weight* doubled in the objective (Tile with texture 6).

SW tracks the Gram distance closely (r 0.96–0.98 over 4 356 pairs). On the retrieval test it ranked the right reference
first just as often: 46/66 each on the term alone, and 60 vs 59 within the Tile metric. It also cost 3× as much (≈16 vs
5 ms). Optimising with it changed nothing (Δ Tile + Texture +0.001 ± 0.008 on 15 pairs × 3 seeds, +0.000 ± 0.009 held
out). No scale or mix of scales was consistently better (retrieval 42–48/66; separation favoured the larger scales).
A heavier texture weight ranked references no better (58/66 at 2×, 57/66 at 4×), and with the doubled weight the
results' *Texture* totals didn't even drop (+0.002 ± 0.011). Gram stays; the search, not the texture statistic,
limits the results.

**Structural moves (measured, 2026-10-15).** At an equal budget of evaluations (`matchbench` phases take
`"evaluations"`), mixed in from the start the old structural moves cost Tile + Texture +0.008 ± 0.016 at 1200
evaluations (15 pairs × 3 seeds) — they compete with tuning that still pays. Counting incubation as cost, adaptive
kind choice, duplicates (the best kind per candidate) and tonal blends only brought that to about neutral (−0.009 ±
0.012 at 1200, +0.010 ± 0.017 at 6000). Stalled rounds were neutral on the dev set (−0.004 ± 0.009 at 6000). A
direct test of what structure is for — 18 hand-authored textures, each with its most telling detail layer removed,
against the full render (≈ 0.15 of loss to recover) — showed how little the moves rebuild: mixed in, −0.001 ± 0.004;
stalled rounds, −0.002 ± 0.002; stalled rounds that tune their best new layers properly, −0.005 ± 0.002 (never more
than +0.008 worse on a pair, up to −0.030 better; +0.2 layers). Residual colours for inserts made no measurable
difference. A missing speckle or streak needs a snippet close to it to begin with; the library and duplicates rarely
are, so most of the gap is closed — partly — by retuning the layers that are there.

**Metric speed.** The colour and contrast terms sort tens of thousands of values per evaluation; `sortFloat32` (LSD
radix on the float bit patterns, exactly Float32Array#sort's order) made feature computation 3.2× faster (128²:
35 → 11 ms; CPU scoring per evaluation 8.6 → 4.1 ms at 64², 42.5 → 14.6 ms at 128²) with bit-identical scores.

**Metric.** Optimising the Tile preset lowered the *Texture* total too — more than optimising a mean of the two
presets did (+0.04 on the Tile + Texture sum at 1000 steps, worse on both) and as much as switching presets mid-run
(Tile already weighs the VGG texture term at 3) — so Tile stays the default objective.

**Results** (mean over the eight pairs and three or four seeds; Tile / Texture, lower is better):

| Strategy | 300 steps | 1000 steps |
| -------- | --------- | ---------- |
| v1 search; layers, base, AO (one seed) | 0.445 / 0.336 | — |
| + shading levers | 0.439 / 0.330 | — |
| + search order, sweeps, alignment, colour fits | 0.419 / 0.300 | — |
| + lights | 0.411 / 0.289 | 0.387 / 0.262 |
| + gradient steps (the defaults) | 0.410 / 0.288 | 0.376 / 0.254 |

Tried and dropped (paired, not better): higher colour-fit rates (0.2, 0.35 — clearly worse), colour fits of one layer
or of lightness only, λ 6 at equal evaluations, σ₀ 0.15, three entries per mutation, islands (no reliable gain at 300
or 1000 steps), a longer restart patience, seeds in the space (neutral at 300 steps, slightly worse at 1000 — also
with each new seed incubated, and on converged projects), and a Tile + Texture objective (above). Also measured and
removed: a *layout fit* (rescale a pattern parameter by the ratio of the render's repeat to the reference's, from
edge-profile periods — as efficient per candidate as a mutation but no better overall, +0.004 ± 0.009, and
consistently worse on irregular cobblestones) and *cheap screening* (score candidates at 4 or 8 samples, evaluate in
full only those beating the parent's cheap score — 5× fewer full evaluations but only 13 % less time, since scoring,
not tracing, dominates an evaluation; quality unchanged within noise).

**Benchmark tool.** `npx tsx tools/matchbench.ts <pairs.json> <strategy.json> [--seeds N] [--workers N]`: runs the
optimiser headlessly the way the Match workspace does (same matcher: periodic comparison and the VGG term), one
phase per metric preset in the strategy, every pair × seed on a shared worker queue; writes each best project and a
[reference | start | best | diff] sheet, appends a line per run to `results.jsonl`, and prints per-pair means and the
move statistics (candidates proposed, steps won that improved the best, total gain per move kind).

## Craft heuristics (FR7.8, removed)
The craft rules — conforming the start project and every candidate to the lessons of hand-authoring, with search-space
priors to match — were removed (2026-10-15): a project that broke a rule was rewritten before its first evaluation and
on every candidate, so a run could end worse than the project it started from (on two of 18 test projects, Tile
0.07 → 0.19 and 0.12 → 0.17), and the search could never undo the rewrite. What remains of FR7.8: the insert library
(`DEFAULT_LIBRARY`, its snippets) and the tied pattern params below.

**Tied pattern params** (always on): layers of one type and seed are copies of one pattern; a pattern param they
hold equal is a single entry (`ParamEntry.tied` lists the other owners, label "(+N linked)") that `applyParams`
writes to every copy — see [FR7.8](fr7.8-optimizer-heuristics.md).

## Stop criteria
`Optimizer.runUntil(stop)` steps until the first criterion is met (`StopReason`): `targetLoss` (good enough),
`timeMs` (wall clock), `steps`, `evaluations` (total), `patience` (steps in a row without the best loss improving
by `minImprovement`, default 0.001 — restarts don't reset it), or an abort signal. `RunLimits` holds the bookkeeping
so the same rules drive the harness CLI and the Match workspace. With no bound set a run only ends when aborted.
- Match workspace: *Max steps*, *Stop at loss*, *Time limit*, *Stall after* — each press of Optimise / Continue /
  Resume runs afresh (up to Max steps *more*, a new time limit and stall count; a target loss already reached no
  longer stops it), so a finished run can always keep going without Apply best. 0 switches each off; with all off
  the optimiser runs until paused. The log ends with the reason.
- The workspace is kept alive across Create ↔ Match: the reference, settings and optimiser survive. Leaving pauses a
  run (the viewport needs the engine); returning re-renders the preview, and if the project was edited in Create the
  optimiser starts over from it (its best would undo the edits). *Fit colours* fits the current project's colours to
  the reference (FR8.2) — undoable.
- `harness optimize … --until LOSS --time SECONDS --patience STEPS` (`--iters` then caps the steps only when given).
