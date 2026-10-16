# Notes for agents working on Bismith

Architecture and feature docs live in `docs/` (start with `docs/architecture.md`). Below: gotchas that have cost
time before.

## This repo is public

Keep anything tied to third-party reference textures — recreations, exemplars, reference names, notes — in
`private/`, which is gitignored and is its own repo. In public files (code, comments, docs, commit messages),
describe a motif generically ("riveted panel", "staggered slots"), never by a reference texture's name or file path.

## Nothing is released yet

Saved projects, recipes, presets and templates don't have to keep rendering the same. Generators may change as
much as they need to: improve plain defaults directly, and don't add hidden version params, legacy code paths or
migrations just to preserve old looks. (Loading old files without errors still matters; matching their old renders
doesn't.)

## Gotchas

- **`<< out` breaks esbuild / `tsx`.** esbuild (used by `npx tsx`, so by every script in `tools/` and any ad-hoc
  script that imports `src/`) parses a left shift followed by an identifier named `out` — e.g. `1 << out[i]` — as
  the start of a TypeScript variance modifier (`<out T>`) and fails with *The modifier "out" is not valid here*.
  Vite / Vitest and `vue-tsc` accept it, so tests and typechecks stay green while every `tsx` tool crashes on
  import. Parenthesise the operand — `1 << (out[i])` (see `src/layers/generators/traceLinks.ts`) — or don't name
  the variable `out`. (`i < out.length` and other single `<` are fine.)
- **"Shape Mask" in the UI is the shape *register* in code.** The running signed-distance shape that shape layers
  write and later layers clip to: `S.a` / `prevReg` in the material shaders, params `sm_on` (write toggle),
  `sdf_op` (mode: Normal = `replace`, Union, Subtract, Intersection, smooth variants — the option index + 1 is the
  `sdfCombine` op, so keep their order), `sdf_k`, and `m_clip` (*Clip to shape mask*). Old projects with
  `sdf_op: 'none'` migrate to `sm_on: false` (`migrateParams` in `src/layers/registry.ts`). The four numbered
  *named masks* (`mk_*` params, `tMasks`) are a separate feature (docs/features/fr8.13-named-masks.md).
- **Pixel units and supersampling.** Supersampling renders the stack at k× and scales params by their declared
  unit (`src/core/supersample.ts`): lengths need `unit: 'px'` (× k), and a count per pixel area (features per N×N
  px) needs `perArea: true` (÷ k²) — otherwise raising the supersampling changes the texture (Scratches gained k² ×
  the scratches). Counts per texture or per cell ("cells across") need nothing.
- **Featureless generators return `genOutSmooth(...)`.** `rnd` is meant to be one random per feature (brick, cell,
  instance); Height's *Per-feature variation* hashes it with `fract(rnd · 61.37)`. A generator without features that
  passes a continuous value as `rnd` (smooth noise, clouds) must use `genOutSmooth`, which switches that variation
  off — with `genOut` the hash turns into dozens of terraces along the pattern's contours.
- **The shape mask is read at a distance, not only by its sign.** Bevel and Etch on the shape mask read the
  register's distance out to their width, so an SDF generator's distance must stay exact (at least continuous) past
  its edge. A shortcut such as "far instances return their bounding circle's `r − bound`" jumps below the true
  distance where it kicks in and draws a ring there; prune against the nearest distance found so far instead
  (`MOT_REPEAT` in `motifRadial.ts`). Grids of separate objects take `spacingParams()` (Column / Row spacing) and lay
  themselves out with `repGrid` (`src/layers/glsl/common.ts`).
- **Shader compile time (D3D11, Chrome's default on Windows) is the cost users feel** — a card renders in ~50 ms,
  but a generator's first compile can take seconds. D3D's compiler inlines every function call, so a helper called
  in several branches (or a branch per case that each calls the same thing) multiplies the shader: pick arguments
  first and call once, use small lookup tables instead of a branch per case, loop over cases (axes, edges) so the
  body exists once. Nested loops of calls (a loop around a function that loops around noise) are much slower than
  one flat loop over all the evaluations, with the arguments chosen per iteration. Loop bounds read from a uniform
  (`ORG_1`, `MOT_1`) stop D3D from unrolling. Measure cold compiles with `npx tsx tools/compile-time.ts <types…>`:
  Tessellation went ~20 s → 1.9 s, Truchet 5.4 → 2.1 s, Marble 2.2 → 0.8 s and Cracks 1.5 → 0.8 s, output
  unchanged. For a generator with many modes, describe each mode as data (shapes, anchors) and run them all through
  one loop (`geometricTessellation.ts`). Don't time while
  another GPU job (e.g. the studio starting) runs. Batch compiles run in parallel (`engine.precompile([...])`).
- **Never set three's `renderer.outputColorSpace`** (nor `gl.drawingBufferColorSpace`). The setter assigns
  `gl.drawingBufferColorSpace`, and Firefox (seen with Windows HDR) then colour-manages the viewport canvas — even
  for `'srgb'`, the default — so the viewport's hues drift from the Match panes and exports (reds toward orange).
  Our shaders write display values themselves; `Gpu.clearCanvas` passes its colour as sRGB instead
  (`src/gpu/context.ts`).
- **The studio's page loads `src/` once.** `tools/studio.ts` keeps one browser page for its whole run, so edits to
  `src/` never reach it: a new layer type is silently dropped on load and renders come out unchanged. Restart the
  studio after changing generator or pipeline code (check a render's metrics actually moved).
- **Icons are `@tabler/icons-vue` components, used directly** (`<IconTrash :size="13" />`; `:color`, not `:stroke`, for
  a hue; `<component :is>` for data-driven ones — layer types and recipes via `layerIcon` / `recipeIcon` in
  `src/ui/meta.ts`). `.tabler-icon { stroke-width: 1.75 }` in `src/styles/base.css` sets the UI's line weight and
  overrides Tabler's `stroke` prop, so a different weight needs CSS (see NumberField's chevrons).
- **ANGLE / D3D11 can miscompile `continue` in a loop.** In Scratches' cell loop it cut the strokes short and thin
  at cell borders (SwiftShader was right). Wrap the loop body in `if (!skip) { … }` instead of `continue`, and check
  a generator's loops on the GPU backend, not only SwiftShader.
- **`Matcher.score()` takes the render at its own size.** The Windows metric (FR8.19) compares at up to 512 px, finer
  than the 128 px of the other terms, so `matcher.score(matcher.fit(img))` silently scores it from the small copy.
  Pass the full render (keep `fit()` for display and for colour maps).
