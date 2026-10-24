# FR9 — Tiling Workspace

**Status:** in progress — analysis, attribution, the fix search, `tools/tiling.ts` and the Tiling workspace done;
the Flatten filter to do

## Problem

Textures made with the program often look great up close, but when previewing the tiling (5×5 tiling grid mode) there
are very jarring and obvious repeating patterns.

Two different things make a tile's repeat obvious:

- **Broad tone.** A darker blotch or a lighter corner, 1–4 cycles across the tile, turns the grid of tiles into a
  visible checkerboard. This is low frequency and nothing else.
- **Landmarks.** One crack longer than the rest, a lone bright stone, a clump of rivets with an empty patch beside it:
  a mid-frequency feature unlike the rest of the tile, which the eye finds again in every copy. Usually the bigger
  problem, and a frequency filter can't touch it — removing it means removing every feature of its size.

A tile always repeats; the goal is a tile whose repeat doesn't _draw the eye_: features spread evenly, none standing
out from its kind, no tone across the tile.

## Goal

A **Tiling** workspace beside Create and Match, for tuning the texture as a whole once its layers are built. It works on
the live project, not on an exported image: every fix is a change to the stack (a layer's seed or layout params, a
post filter), so the fixed texture stays procedural, crisp at any size, and every exported map — diffuse, height,
normal — agrees with the final render. Nothing extra for the user to paint or pick: the workspace finds what is
jarring, traces it to the layer responsible, and proposes the fix.

## Design

### Workspace (`src/ui/panels/TilingWorkspace.vue`)

The **Tiling** key on the workspace rail, laid out like Match (outliner and properties stay beside it, live):

- **Bar:** _Analyse_ (the current project again), _Run fix_ / _Stop_, and once a run is done _Keep this_ (applies the fix
  to the project, Ctrl+Z undoes it; asks first when the project was edited during the run) and _Discard_.
- **Panes:** _Current project / Before_ 3 × 3 with its tiling score · _Fixed_ (_Best so far_ while running) 3 × 3 with
  score and drift · _Hotspots_ 3 × 3, of before or of the fix.
- **Settings** — the search's inputs: _Seeds_ per layer (24), _Layers_ to fix (2), _Nudge_ (0.12 of a param's slider
  range, also tried at 40 %), _Hold look_ (drift weight, 2), _Min gain_ (0.01), _Samples_ per candidate (32), _Allow
  scale changes_ (off).
- **Progress:** candidates, score before → best, the look allowance; a chart of the kept best's loss.
- **Terms:** a bar per term (of the hotspot pane's image), before → fixed values; below, the culprits and the changes.

Edits made beside it are re-analysed once they pause (300 ms), except while a run or its result holds the panes.
Leaving the workspace stops a run; its best so far stays to keep or discard. The run works on a copy of the project
taken when it began. Candidates are rendered and analysed on the GPU (below), one per frame, so the page answers
between them; a hidden tab keeps the run going (`nextFrame` in `src/ui/schedule.ts` yields through a MessageChannel
there).

Planned on top: hovering a culprit to show its contribution, the Flatten tone fix as a button, per-finding fixes.

### 1. Finding the hotspots

Computed on the final render (lit, post stack applied), wrapping, as a per-pixel map plus a score:

- **Patches:** areas of a colour that has no equal elsewhere in the tile — a big dark shadow, one bright face. The
  colour blurred to region scale, scored by how rare it is among the colours of the _rest_ of the tile (its own
  neighbourhood left out). Busy is fine, and so are many small dark features; one area like nothing else isn't.
- **Lines:** long straight edges unlike the other lines of their direction — one crease across the tile, not brick
  courses or panel seams, which have their equals all through it — and only lines that end inside the tile: one that
  runs right through joins its copies into a single line across the grid (structure), one that ends repeats as dashes.
- **Clumping:** feature density (gradient magnitude, local contrast), blurred to tile scale; its variation across the
  tile (low-frequency energy, bins 1…k cycles per tile) measures clumps and holes.
- **Broad tone:** the same low-frequency energy of OKLab L (and optionally a, b) of the render itself — the CPU FFT in
  `src/match/fft.ts` does it at analysis sizes.

The hotspot map is the terms' maps together, each weighted by how much its term counts; the score mixes the terms. Cutoffs
are in cycles per tile, so the score doesn't change with canvas size or supersampling.

### 2. Tracing a hotspot to its layer

**Leave one out.** For each enabled layer, render the project with that layer disabled and take the difference from
the full render. The difference is exactly that layer's contribution, through every route — its paint, the lighting
of its height, the masks later layers read from it. The pipeline already evaluates a subset of layers
(`materialPipeline.ts`: `upTo`, disabled and hidden layers), so this needs no generator changes. ~50 ms a render, so a
15-layer stack costs under a second; renders run at the Match optimiser's fixed low sample count, deterministic.

**Blame** is concentration, not size: a layer's mean contribution inside the hotspots divided by its mean contribution
elsewhere. A base fill or a noise present everywhere changes a lot when removed, but evenly — it isn't to blame. The
layer whose contribution piles up on the hotspot is.

Groups and smart materials are blamed as their member layers. Layers of one type sharing a seed are one pattern
(`patternTies` in `src/match/optimizer.ts`) and are blamed and fixed together.

_Later, if leave-one-out is too slow on big stacks:_ an ID buffer recorded during evaluation (`onBeforeLayer` hook, a
running argmax of each layer's change). One pass instead of N, but it misses contributions through lighting and masks.
The feature random `GenOut.fid` could also name the culprit _feature_ (which crack), for a future per-feature fix.

### 3. Fixing the culprit (`src/tiling/fix.ts`)

A narrow search over the blamed layers only, culprit by culprit in the order of the findings (two by default):

- **Reseed:** N seeds (24), the copies of a pattern reseeded together so they stay one pattern; the best is kept.
- **Even out layout:** then each of the culprit's pattern params (`patternKeys`), one at a time, at ±0.05 and ±0.12 of
  its slider range, keeping a step when it helps. Not the offsets (a shift is no new layout once tiled), not effects
  that are off (at a minimum of 0 — turning one on adds a feature), and not the scale — px lengths and `scale` (cells
  across) — unless asked (`scale: true`, `--scale`): a smaller pattern hides the repeat, but that changes the material.
- **Objective:** `loss = score + 2 · max(0, drift − allowance)`; a change has to gain 0.01 to be kept (smaller gains
  are noise, and each change moves the look). `drift` is the Windows match preset (colour, VGG texture, local windows —
  all layout-free) against the render before the fix. The **allowance** is what a reseed costs for this project: from
  each culprit on, the largest median drift of the culprits' reseeds so far (rock ≈0.34, water 0.40, scattered flecks
  0.03) — a fixed 0.25 penalised every reseed of the rock and allowed big changes to the flecks.
- Only the culprits' params move, so the rest of the stack can't drift.

`__bismith.tilingFix(opts)` runs attribution and the search in the page, loads the fixed project and returns scores,
drift, the changes, every trial, and before / after renders and hotspot overlays; `npx tsx tools/tiling.ts … --fix`
prints them and writes `<name>.fix.png` [before 3 × 3 | after 3 × 3 | hotspots before | after] and
`<name>.fixed.json`. ≈50–140 evaluations per project; an evaluation is the render, the GPU analysis and the drift
(the Windows match: now the largest part). The original's evaluation is the attribution's (drift 0), and the search
keeps the render and analysis of the candidate it may return, so nothing is rendered twice. Locked layers are left
alone: a culprit's locked layers keep their seed and params, and a culprit with nothing unlocked is skipped.

A fix that doesn't reach the target still reports which layer and which param kind (seed, density, size) is the
problem, so the user — or we, when tuning generators — know where to look.

**First results, eight material presets** (score before → after, drift; the changes):

| preset  | score       | drift | changes                                                             |
| ------- | ----------- | ----- | ------------------------------------------------------------------- |
| slate   | 0.61 → 0.50 | 0.13  | stone blocks reseeded: the bright L of moss joints is gone          |
| rock    | 0.65 → 0.55 | 0.33  | reseeded; angle, cross-joint angle, elongation, bedding, rough      |
| bricks  | 0.60 → 0.54 | 0.26  | bricks and mortar grit reseeded: light / dark bricks spread out     |
| lichen  | 0.55 → 0.50 | 0.17  | dark lichen and rust patches reseeded: the diagonal streaks broke   |
| blank   | 0.56 → 0.51 | 0.22  | noise reseeded — its features are too big for the tile: needs scale |
| cobbles | 0.63 → 0.60 | 0.24  | grain reseeded, its contrast up                                     |
| water   | 0.70 → 0.67 | 0.37  | liquid reseeded                                                     |
| frost   | 0.52 → 0.52 | 0     | nothing: the best reseed (0.50) drifted past the allowance          |

A first version without the scale, off-effect and per-culprit rules halved the rock's block size, switched on rills
and cross fractures, and raised the cells across of the cobbles, moss and caustics: better scores, other materials.

### 4. Broad tone: a Flatten post filter

For the tone term, a **Flatten** post filter (`src/render/post/`, a multi-pass `PostDef.run`) that the workspace adds or
adjusts. It's an ordinary post filter, so Create shows it in the post stack too.

- **Transform:** FFT in fragment shaders (WebGL2 has no compute) — Stockham radix-2, one ping-pong pass per stage over
  RGBA32F scratch targets (`ctx.scratch`), two real channels packed per complex texel; 8 passes per axis at 256 px.
  Sizes aren't powers of two (any width up to `MAX_SIZE`): a direct DFT pass for those (N fetches per pixel per axis —
  ~67 M at 256² for the whole transform), mixed radix only if it shows up in timing. Twiddles computed in the shader
  from angles in [0, 2π). The texture tiles, so no windowing, no edge artefacts.
- **Filter:** a gain per frequency, `mix(1 − strength, 1, rolloff(f))`, with `rolloff` a Butterworth / Gaussian
  high-pass — _Cutoff_ (cycles per tile), _Softness_ (transition width), _Strength_ (how far the low band is cut). DC
  always kept. No brick-wall cutoff (ringing).
- **Channels:** OKLab L by default (hue kept), _Colour too_ to flatten a and b.
- **Mode:** _Subtract_ (image − low band) or _Divide_ (image ÷ low band × mean — suits shading-like blotches, never
  negative).
- Band-pass / band-reject as a later mode of the same curve.

Applied on the final render only, so exported maps keep their tone; if that matters, the same filter as a layer-stack
filter on albedo and height later (out of scope here).

## Implementation notes (analysis and attribution)

- **Working size** (`analyzeTiling`): the render box-downsampled to 128 px on the short side (`WORK_SIZE`); lengths
  below are px of that, the maps are upsampled back to the render's size when first read (`maps`; `work` has them at
  the working size).
- **GPU and CPU** (`src/tiling/gpu.ts`, `tilingKernels` in analyze.ts): the per-pixel kernels — box down to the working
  size and OKLab, Sobel, the blurs, colour rarity at both radii, the 16 directions' line sums — run as fragment passes
  into one atlas read back once; medians, quantiles, the low band and the scores stay on the CPU (`finishAnalysis`).
  The CPU kernels are the reference and the fallback (Node, tests, no float targets): rarity buckets the samples by
  colour (only the 27 cells within the kernel's cut) and tables the exponential, line sums are one sparse kernel per
  direction. `tilingGpu(gpu)` checks the GPU against the CPU once on a test card and returns null (CPU) if they
  differ — a D3D shader that failed to compile renders nothing, without an error. `tools/tiling.ts --check` compares
  them on real renders; `--cpu` runs the tool on the CPU. On an RTX 5080 (D3D11) an analysis takes 4–16 ms on the
  GPU, 0.1–0.5 s on the CPU; a rock fix (98 evaluations at 128 px) 7.5 s, bricks 2.3 s.
- **Patches** (`colourRarity`): OKLab blurred at radii 2 and 5 (two box passes); per pixel −log of a Gaussian kernel
  density (ΔE 0.02) over 2000 fixed sample pixels, leaving out samples within 16 px (wrapped) of it; minus the median,
  the larger of the two radii. The term is the mean of the top 2 %. Without the left-out neighbourhood, rarity by pixel
  share rates many small dark dots as rare as one big blob; the larger radius tells them apart too.
- **Lines** (`uniqueLines`): per direction (16 over 180°), the signed Sobel gradient across it averaged over 65 px
  along it (half the tile) in mean gradients; minus the 97th percentile of that over the tile in the same direction
  (`LINE_EQUALS`: the strongest 3 % are each other's equals); times how much the sum drops over twice the length (a
  line running through the tile keeps it, and counts 0). The term is the mean of the top 1 %.
- **Clumping:** Sobel magnitude of OKLab L as the density; rms of its low band relative to its mean. **Tone:** rms
  OKLab ΔE of the low band of L, a, b. The low band (≤ 3 cycles per tile within a circle) is summed directly per
  frequency bin — a few dozen, any size, no FFT.
- **Scales and weights** (`TILING_SCALES`, raw → 0.5; `DEFAULT_TILING_WEIGHTS`): patches 1.5 / 1, lines 0.25 / 3,
  clumping 0.4 / 0.5, tone 0.03 / 0.5 — fitted to critics' ratings (_Calibration_ below).
- **Hotspot map:** each term's map from its median (0) to its top ½ % (1), times `HOTSPOT_WEIGHTS` (patches 1, lines 1,
  clumping and tone 0.5), the largest — not the score's weights: patches find where better than they rank how bad.
- **Blame** (`attributeTiling`): 32 spp for the full and each leave-one-out render, so noise mostly cancels; findings
  need blame ≥ ¼ of the term's top and ≥ 0.0015 ΔE (`MIN_BLAME`, above what faint layers measure from noise).
- `__bismith.tiling({ samples, maps, analysisOnly })` returns the scores, render and hotspot PNGs, per-layer blame
  (with contribution maps) and findings; `heatOverlay` (`src/match/image.ts`) is shared with Match's window-mismatch
  pane.

**Hand-marked reference: the rock preset.** Marked by eye as the most jarring in its 3 × 3 tiling: the big dark crevice
shadow and the bright face beside it, a long thin crease low in the tile, a straight horizontal edge, a bright block.
Scored as ROC AUC of each map (blurred 2 px) against the marks:

| map                                               | AUC  |
| ------------------------------------------------- | ---- |
| window self-similarity (the first landmark term)  | 0.67 |
| long-line strength alone (65 px)                  | 0.71 |
| colour rarity at radius 2                         | 0.75 |
| lines unlike their surroundings                   | 0.81 |
| max(rarity, unique lines)                         | 0.87 |
| hotspot, weighted sum of all four (first version) | 0.71 |
| hotspot, max of maps (after calibration)          | 0.85 |

Patches find the crevice shadow and the bright face; lines the crease and the crevice's edge. The window term was
dropped: added to the two it lowered the AUC (0.78). A weighted sum diluted them with the broad clumping and tone
maps; the max of the maps doesn't.

On the presets, the line term flags a darker mortar course and head joints stacked over two courses in the bricks (a
real if mild oddity) and no longer the riveted panel's seam running across the whole tile (1.68 → 0.53 once lines that
run through count 0).

### Calibration (critics)

Three critic subagents (brief and marks in `private/critic/tiling/`) each judged a share of the 18 example projects'
3 × 3 tilings — all three the rock, as an anchor — rating how obvious the repeat is (0–10) and marking the jarring
areas on a one-tile grid in eighths. Their rock ratings agreed (5, 6, 6) and all three marked the dark crevice and the
bright face also marked by hand, but each added areas of its own (IoU with the hand marks 0.11–0.16): marks are a noisy
target, so only means over many tiles count.

Maps against the critics' marks (mean ROC AUC over the 20 judgements): patches 0.74, lines 0.64, clumping 0.61, tone
0.62, the max-of-maps hotspot 0.75 (the earlier weighted-sum hotspot 0.73). Against the hand-marked rock: hotspot 0.85.

Terms against the ratings (Spearman over the 18; over the 13 materials without the single objects): lines 0.92 / 0.89,
clumping 0.91 / 0.76, tone 0.72 / 0.50, patches 0.50 / 0.28 — patches hardly vary in size between materials, so they
say where more than how much. A grid search over scales and weights, keeping every term, gives 0.95 / 0.84 (all equal
weights and the first scales: 0.92 / 0.73). Fitted scores run from grass 0.40 and rust wall 0.42 to the single objects
0.78–0.82; the worst misfit is ashlar (rated 3, scored with the 4–5 materials). 18 tiles and three raters are a small
set: refit when more are marked (`calib.ts` there scores maps and terms from the marks).

## Not in scope

- Pixel-level re-synthesis (patch-based texture optimisation, neural synthesis): the fix is always a change to the
  stack. Revisit only if generator-side fixes prove too coarse.
- Per-feature fixes (moving one crack): needs generators to take per-feature overrides.
- Larger periods (rendering a 2×2-tile texture to halve the repeat).

## Open questions

- **More marked references.** One hand-marked tile so far; mark a few more (a crack-heavy, a blotchy, a regular
  one) before trusting the scales.
- **Fix acceptance.** Automatic (best result applied, undoable) or a pick from the 3 best? Default automatic, matching
  "no extra burden"; picks if the best ones differ in look.
- **Score weighting** between patches, lines, clumping and tone, calibrated by eye on test projects (below).

## Plan

- [x] Tiling analysis (`src/tiling/analyze.ts`, pure TS): patches, lines, clumping and tone terms, hotspot map; unit
      tests on synthetic tiles (one big blob among dots → patch; one crease, not courses → line; half-filled → clumping;
      a gradient → tone)
- [x] Leave-one-out attribution and blame (`src/tiling/attribute.ts`), group and pattern-copy aware; the analysis of
      each leave-one-out render ("without it") only on request (`without`, `tools/tiling.ts --without`)
- [x] GPU analysis (`src/tiling/gpu.ts`), checked against the CPU reference (`tools/tiling.ts --check`)
- [x] Fix search over blamed layers (reseed, layout; `fix.ts`), `__bismith.tilingFix()`, `tools/tiling.ts --fix`
- [x] `tools/tiling.ts`: score and blame project files or the presets headless (`__bismith.tiling()`), writing tiled
      sheets [render | hotspots | top culprits' contributions] — fixing comes with the fix search
- [ ] Flatten post filter (GPU FFT / DFT), smoke-tested at power-of-two and odd sizes
- [x] Tiling workspace UI: 3 × 3 before / fixed / hotspots, settings, run / stop, Keep this / Discard (undoable)
- [x] Docs: architecture.md (layout, tools, tiling/), FR index
- [ ] Post table entry with the Flatten filter

## Validation

- Synthetic tiles: the analysis ranks one-odd-feature and clumped tiles above even ones; blame picks the layer that
  added the odd feature in a 3-layer stack.
- A set of real projects with visibly jarring tilings: the critic subagent (`docs/generator-critic.md`) judges 5×5
  before / after sheets — repeat less obvious, material unchanged — and the tiling score agrees with its ranking.
- Flatten: identity at strength 0; FFT → inverse round trip within float precision at power-of-two and odd sizes; cold
  compile time measured with `tools/compile-time.ts`-style timing.
