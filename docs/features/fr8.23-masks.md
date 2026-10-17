# FR8.23 — One mask system

**Status:** done — named masks with a slot plan, Limit to expressions and material limits (phases 1–3); Mask area
(4); mask-name fields, the Masks view picker and rename (5); docs (6)

## Problem
- **Copies of one layer.** A look often needs the same layout applied at several places in the stack: a stone wall
  stacks three copies of one Bricks layer, identical except for their outputs — one bevels the edges and writes the
  shape, one lifts each block by its own random amount after the chips, one tints each block after the stone noise.
  The copies drift apart when one is edited (the optimiser ties them by seed, `src/core/links.ts`; the editor can't).
  The second and third copies only exist because nothing later in the stack can read *which block* a pixel is in: the
  Shape Mask holds one distance (`S.a`), no per-feature random.
- **Two mask systems that do nearly the same job.** The Shape Mask (one running signed distance, written by shape
  layers in stack order, read by *Clip to*, Bevel / Etch / Glass and a few generators) and the named masks (four
  numbered coverage channels in `tMasks`, written by any layer in a pre-pass so they apply wherever their writer sits,
  read by *Masked by*, material masks, filters, Bevel / Etch). Two param sets (`sm_on` `sdf_op` `sdf_k` · `mk_write`
  `mk_mode` `mk_feather`; `m_clip` · `mk_use` `mk_invert`), two Mask-card sections, two viewport views, two edge
  sources, and a pre-pass with its own exceptions (`readsState`).
- **Four, numbered.** "Mask 2" says nothing about what it holds, and four is a hard limit.

## Design

### Masks
A **mask** is a name. Each holds, per pixel: a signed distance (px, negative inside), the per-feature random of the
feature there, and whether there is a feature. There is no fixed number of them and no numbering: a mask exists
because a layer writes it.

*Shape* is an ordinary mask — the one shape layers write by default. A user who never names a mask sees today's Shape
Mask, unchanged; named masks are no longer a separate feature, just writing to another name.

**One rule:** a mask at a layer is what the layers above it wrote into it. Stack order, as the Shape Mask works today.
The named-mask pre-pass goes away — a mask no longer reaches layers above its writer.

### Writing (Mask card › *Write to*)
- **Write to**: None, *Shape*, or a name (an existing mask, or a new one typed in). Shape layers default to *Shape*,
  everything else to None. One target per layer.
- **Mode**: Replace, Union, Subtract, Intersect and the smooth variants (`sdfCombine`, as today; the option index + 1
  is the op). A shape layer draws the combined shape, whichever mask it writes — a rect unioned into *Opening* bevels
  as one shape with what *Opening* held.
- **Smoothness** (px): the fillet of the smooth modes. **Feather** (px): a soft ramp across a shape's outline instead
  of its crisp edge, as now.
- **What is stored**: shape layers store their combined distance (exact). Layers without a distance (noise with a
  cutoff, Mask area, Drips) store `0.5 − coverage`, which reads back through the same `clamp(0.5 − d)`.
  The random and the feature flag come from whichever operand wins the combine (the new shape where it wins, the
  mask's earlier contents elsewhere).

### Limiting (Mask card › *Limit to*)
- An expression of up to four terms, read left to right, no brackets: the first is a mask; each further row adds one
  with **∪** (or), **∩** (and) or **−** (minus; *Except* on the card). *Invert* (was *Outside* in this plan) turns the
  whole result inside out. Labelled on the card the way the Shape Mask is today: *Inside Shape − Opening*, *Outside
  Moss ∪ Wet*.
- Terms combine with `sdfCombine` (min / max / max(a, −b)), so the result is still a distance and keeps a feature
  random (from the winning term).
- Anything needing brackets, or shared by many layers, is a mask of its own: write it once, limit to it.
- **Materials** keep a limit expression of their own (`SmartMaterial.mask`); each member's result is its own limit ∩
  the material's.
- The height-range limit (*Above / below level*, `m_hmode`) stays as it is: it reads the surface, not a mask.

### Selecting areas: the *Mask area* generator
A generator that only selects areas: it draws no layout of its own, it picks parts of what is already there — from the
surface the layers above built, or from the features of a mask. It writes a mask by default (named after the layer,
channel outputs off), but every output is there, so it can paint its selection directly too (darken the bottom of
each block, lift each block by its random). It grows out of *Crevices & high spots* (`surfacemask`, whose modes become
its surface modes) and is also how a later layer reads a mask's features, so the layer count doesn't grow.

**Select › Surface** (reads the surface built so far, `readsState`; its mask applies to the layers after it):
- **Crevices / High spots / Both / Slopes**: as *Crevices & high spots* today (Radius, Depth or Full at slope).
- **Facing**: slopes whose face turns towards *Direction* (an angle; Bottom, Top, Left, Right as quick picks), with
  *Spread* (how far round from it still counts) and *Full at slope*: all the bottom edges of the raised blocks, the
  lit side of every bump.
- **Height range**: above or below a level, softened.

**Select › Features of a mask** (reads one mask; Mask names it, default *Shape*):
- **Inside**: the mask's shape itself: its distance goes through the wrapper's bevel and profile, its stored random
  is the layer's `rnd`, so *Source › Random* and *Per-feature variation* work per feature. The stone wall becomes one
  Bricks layer writing *Shape*, *Mask area* (Inside *Shape*) with Height and per-feature variation 1 after the chips,
  and *Mask area* (Inside *Shape*) with Diffuse by Random after the stone noise.
- **Gradient**: a ramp across each feature along *Direction*, 0 at the far side and 1 at the near one (fading from
  the bottom of each block to its top). *Across*: the whole feature, or a band *Width* px in from its edge (only each
  block's bottom edge). Shaping (levels, gamma, cutoff) shapes the ramp as for any generator.
- Everything selected here keeps the features' random and feature flag, so a mask written from a gradient still
  knows its blocks.

**Breakup** (every mode): *Amount*, *Scale* (`unit: 'px'`) and a seed. fBm noise pulls the selection down before the
levels and cutoff — `v · (1 − amount · noise)` — so a selection that would end in a clean line (every bottom edge, the
bottom fifth of each block) ends raggedly, in patches and flecks: chipped edge wear, grime that stops unevenly.
With a cutoff it breaks into islands; without one it stays a soft, mottled mask.

**What it writes**: its selection as coverage (`0.5 − v`), so a gradient becomes a soft mask: *Limit to* it and a layer
fades in across each block. *Inside* writes the source distance (exact, re-bevelled by Mode like any shape) — unless
Breakup is on, which turns it into coverage too.

### Edges, filters, view
- Bevel, Etch and Glass take a mask (or a limit expression) as their source. Exact when every writer of that mask
  version was a shape (the stored distance is real); otherwise jump flood from the coverage, as the mask sources do
  today.
- Filters are limited by an expression like any layer (multi-pass filters keep the snapshot-and-blend).
- One **Masks** viewport view with a picker (replaces *Shape Mask* `0` and *Named masks* `M`).

## Implementation

### Mask analysis (CPU, `src/layers/masks.ts`, replacing `shapeMask.ts`)
Run before every evaluation, and by the Properties panel:
- **Versions.** Each write makes a new version of its mask (SSA). For each layer: the version it reads as its combine
  input (the previous version of its target), the versions its limit and sources read, the version it writes.
- **Liveness and slots.** A version lives from its write to its last read. Slots come from a free list, so the number
  of slot textures is the most versions alive at once — usually one or two. A version nobody reads gets no slot.
- **Exactness.** Per version: whether all its writers were shapes (decides exact vs jump flood for edges).
- **Labels and option lists.** The masks written above a layer, for the *Limit to* and *Mask area* pickers, and the
  chain labels (*Panel − Vent*) — what `shapeMaskChain` / `shapeMaskLabel` do today, per mask.

### Pipeline (`src/render/materialPipeline.ts`)
- **State**: albedo · surface · emissive as now; the fourth output becomes **mask out** (distance, random, feature, —)
  instead of carrying `tMasks` through every pass. `withMaskPassThrough` and `tMasks` go; `S.a` is freed (unused).
- **Slots**: float RGBA scratch targets from the existing `scratch()` pool (`mask0`, `mask1` …), resized with the
  state, so supersampling needs nothing new (distances are in render px, as `S.a` is).
- **After a pass that writes a mask**, copy output 3 into the version's slot if the version is read later (one cheap
  blit). Rebinding attachment 3 to the slot directly would save the copy; three.js makes that awkward, so copy first
  and measure.
- **Limit expressions** with more than one term run a small shared combine pass (up to four slot inputs, ops as
  uniforms) into a temporary slot before the layer; a one-term limit reads its slot directly. Generator shaders keep
  one limit input whatever the expression — no compile-time growth (AGENTS.md › shader compile time).
- **Delete** the named-mask pre-pass (scratch evaluation, re-clear with `uInitMasks`, `uWriteMasks`, the `readsState`
  exception for mask writers).
- An empty mask (nothing wrote it above) reads as `SHAPE_REGISTER_EMPTY`, outside everywhere.

### Generator wrapper (`src/layers/commonParams.ts`)
- Samplers: `tMaskIn` (combine input, replaces `prevReg = S.a`), `tLimit` (the limit result); `tMaskSrc` (a source
  mask) only in Mask area and the edge filters. Blank texture when unused. Uniforms the pipeline derives from the
  analysis: the write op (0 = none), limit inside/outside.
- `namedMask(M)` and `GLSL_NAMED_MASK` go; `m_clip` and `mk_use` both become one `k *= limit`.
- Write `oMask = (d, rnd, feat, 0)` when writing; zeros otherwise (no texel fetch, cheaper than the pass-through).

### Layers that read the Shape Mask directly
Each reads a slot texture instead of `S.a` / `tSurface.a`:
- **Chips** (`chips.ts`, distance and gradient at neighbouring texels), **Tabs** (`tabs.ts`), **patterns.ts** (combines
  its pattern with the register), **Tessellation** (`geometricTiles.ts`): the previous version of their write target,
  or *Shape* when they write nothing.
- **Glass** (`glass.ts`), **edge sources** (`filters/shared.ts`, source `shape` / `mask1`–`mask4`) and **jump flood**
  (`gpu/jfa.ts`, sources 3 and 4–7 become one "slot texture" source).
- Generators that test `u_sm_on` / `u_sdf_op` in GLSL (`geometricSurface.ts`, `motifRadial.ts`, `patterns.ts`,
  `geometricTiles.ts`, `hammered.ts`) test the derived write op instead.
- **Display** (`render/display.ts`): views `register` and `masks` become one `masks` view taking a slot.

### Mask area (`generators/surfaceMask.ts`, extended)
- Keeps the type id `surfacemask` (ids aren't shown; no type-rename on load needed), relabelled *Mask area*. Params:
  `select` (surface / features), the surface modes as today plus *Facing* and *Height range*, `mask` (the source mask
  for features), `dir` (angle), `spread`, `across` (whole feature / from the edge), `width` (`unit: 'px'`),
  `bk_amount`, `bk_scale` (`unit: 'px'`), `bk_seed`. Breakup samples the shared fBm (`glsl/noise.ts`) once per pixel,
  after the mode's value and before Shaping.
- **Surface modes** keep `readsState`. *Facing* takes the height gradient as *Slopes* does and weights it by how far
  its downhill direction turns from *Direction*.
- **Feature modes** read the source mask's slot (`tMaskSrc`), not the state. *Inside* returns the stored distance,
  random and feature flag as its `GenOut` (an SDF generator in this mode, `sdfShowIf`). *Gradient* marches from the
  pixel both ways along *Direction* to the feature's edge — sphere-tracing the stored distance (step `max(|d|, 1)` px),
  stopping where the distance turns positive or the stored random changes (features that touch with no gap) — and
  returns `back / (back + ahead)`, or `1 − back / width` for a band. Both directions in one flat loop with a
  uniform bound (AGENTS.md › shader compile time); masks without an exact distance step 1 px up to the bound.
- Featureless in its surface modes (`genOutSmooth`, AGENTS.md); per-feature in its feature modes (`genOut` with the
  stored random).

### Params, and no migration
Nothing is released, so there is no mapping from the old params (AGENTS.md › Nothing is released yet). New keys, so
no old value is misread under a new meaning:

| Old | New |
|---|---|
| `sm_on`, `sdf_op`, `sdf_k`, `mk_write`, `mk_mode` | `mk_target` (text, '' = none), `mk_op` (the seven modes), `mk_smooth` (px) |
| `mk_feather` | kept (same meaning) |
| `m_clip`, `mk_use`, `mk_invert` | `mk_limit` — a new `maskexpr` param type, `{ terms: [{ mask, op }], outside }`, with its own field; not uploaded, not optimised |
| edge filters' `source` `shape` / `mask1`–`mask4` | `source` *Mask* + `source_mask` (text) |
| `SmartMaterial.mask` `{ use, invert }` | `SmartMaterial.limit` (a `maskexpr`) |

Old files still load without errors: `sanitizeParams` keeps only the keys a type declares, so the old ones drop and
the new ones take their defaults (shape layers write *Shape*, nothing is limited). Their looks change; that's
accepted. Delete the old migration rule (`sdf_op: 'none'` → `sm_on: false` in `migrateParams`) and its test.

### Clean-up: everything the old masks touch
Every place below is rewritten to the new system in the phase that switches it over; none keeps a fallback. Phase 6
ends with a grep for the old identifiers (`sm_on`, `sdf_op`, `sdf_k`, `mk_write`, `mk_mode`, `mk_use`, `mk_invert`,
`m_clip`, `tMasks`, `namedMask`, `MASK_CHANNELS`, `prevReg`, `shapeMaskChain`, `uWriteMasks`, `uInitMasks`,
`withMaskPassThrough`, `'register'`, `mask1`–`mask4`) that must come back empty outside this file and FR8.13.

**Core and pipeline**
- `render/materialPipeline.ts`: `tMasks`, `oMasks`, `withMaskPassThrough`, the pre-pass, `uInitMasks` /
  `tInitMasks` in the clear, `blendMasked`'s mask read, the `masks` / `surface` getters for the views; the clear stops
  writing `SHAPE_REGISTER_EMPTY` into `S.a` (an empty mask is a slot default instead).
- `layers/commonParams.ts`: the Shape mask and Named masks sections of the Mask card, `MASK_CHANNELS`,
  `GLSL_NAMED_MASK`, `prevReg`, both `S.a = d` writes, the `m_clip` / `mk_use` code, the hints.
- `layers/shapeMask.ts` → `layers/masks.ts`; `shapeMask.test.ts` → `masks.test.ts`.
- `layers/types.ts`: `writesMask` becomes `writesTarget` (whether the layer writes its target with these params),
  `sdfShowIf` stays; the GenOut `own` docs stop naming the register and named masks.
- `layers/registry.ts`: the old migration; `createLayer`'s defaults.
- `core/project.ts` (`SmartMaterial`), `stores/project.ts` (`setMaterialMask` → `setMaterialLimit`),
  `recipes/index.ts` (`applyMaterialMask`, `setMaterialMask`).

**GPU, views, filters**
- `gpu/jfa.ts`: sources 3 (register) and 4–7 (`tMasks` channels) become one *slot texture* source;
  `DISTANCE_SOURCE` loses `mask1`–`mask4`.
- `render/display.ts`, `render/engine.ts`: views `register` (`0`) and `masks` (`M`) → one `masks` view with a picker.
- `layers/filters/shared.ts` (edge source options, `u_source == 3`), `glass.ts` (`S.a`), `edges.ts`, `symmetry.ts`
  (copy).

**Generators**
- Read the register texture directly: `chips.ts`, `tabs.ts`, `patterns.ts`, `geometricTiles.ts`.
- Test `u_sm_on` / `u_sdf_op` in GLSL or defaults: `geometricSurface.ts`, `motifRadial.ts`, `hammered.ts`,
  `patternsFill.ts`, `organicLiquid.ts`, `organicWood.ts`, `stoneBlocks.ts`, `cable.ts`, `drips.ts`.
- Per-type shape-writing rules (`writesMask`): `greebles.ts`, `greebleVents.ts`, `greebleTrim.ts`, `hammered.ts`.
- `surfaceMask.ts` → Mask area.
- Hints and descriptions that say *Shape Mask*, *register* or *Mask 1*: about 30 generator and filter files (`tabs`,
  `chips`, `hammered`, `geometricSurface`, `rock`, `patternsFill`, `organicLiquid`, `organicCracks`, `motifRadial`,
  `greebleVents`, `drips`, `stoneBlocks`, `organicWood`, `greebles`, `greebleTrim`, `cable`, `traces`, `patterns`,
  `geometricTiles`, `shapes`, `pipes`, `geometricBands`, …) — reworded to *the mask it writes* / *Shape*.

**Content, rewritten directly (no compatibility)**
- Recipes: `tech.ts`, `tiles.ts`, `surfaces.ts`, `industrial.ts` (Cut-out: opening at the top, a named mask),
  `stone.ts`, `nature.ts`, `patterned.ts`, `metal.ts`.
- `match/templates.ts` (the stone-wall template's copies → one Bricks + Mask area), `match/optimizer.ts` (its starting
  facets layer), `presets/index.ts` (*Mossy slate wall*, *Frosted stone*: named masks *Moss*, *Frost*). Sweep all of
  them for copies of one layer (same type and seed, what `core/links.ts` ties) and replace those with Mask area.
- Regenerate preset previews (`tools/previews.ts`).

**UI and tools**
- `ui/layout/Properties.vue`: `withClipNames` → the *Write to* / *Limit to* pickers and labels; a new field for
  `maskexpr`; the Masks view picker and rename.
- `tools/gensheet.ts`, `tools/trace.ts`: their mask params.

**Tests** — rewrite to the new keys: `core.test.ts` (drop the migration test), `recipes.test.ts`, `drips.test.ts`,
`hammered`, `patterns`, `patternsFill`, `geometricTiles`, `stoneBlocks`, `greebles`, `greebleVents`, `cracks`,
`organicWood`, `organicLiquid`, `cable` tests.

**Docs** — `AGENTS.md` (the *Shape Mask is the register* gotcha becomes a short note on masks), `docs/architecture.md`
(§5.1 `LayerDef`, §5.2 wrapper steps 1 and 4, the shape-register section), FR8.13 marked superseded by this one, and a
terminology pass over the feature docs that describe current behaviour (fr1.3, fr2.1, fr2.3, fr2.4, fr2.5, fr5.1,
fr5.4, fr6.3, fr7.2a–d, fr7.4–7.7, fr8.5, fr8.8, fr8.12, fr8.17, fr8.18, fr8.22), `docs/gensheet.md`,
`docs/generator-critic.md`, `docs/shader-compilation.md`.

**Private repo (local, not part of this repo)**: the hand-authored recreations and starts use the old keys too. A
one-off conversion script kept in `private/` rewrites them (the mapping the app no longer carries); generated bench
output is regenerated, not converted.

### Recipes, templates, presets — behaviour
- **Cut-out**: the opening layer goes to the top of the stack (above the materials it cuts); the recess stays after
  them. Its mask gets a unique name (*Opening*, *Opening 2* …).
- **Mask area** (was Crevices & high spots) writes a mask named after the layer by default.
- Renaming a mask (from the Masks view) renames every reference; duplicating layers keeps names (both copies write the
  same mask, as both wrote the Shape Mask before).

## As built (phases 1–3)
Where the build differs from the design above, or adds to it:
- **Limit to is flat params** (`lim_1`…`lim_4`, `lim_op2`…`lim_op4`, `lim_out`), not a new param type: sanitising,
  cloning, the optimiser and the panel handle them unchanged. `layerLimit` / `limitParams` / `limitTo` convert. A
  material's limit is a `LimitExpr` on `SmartMaterial.limit`; unpacking folds it into the members' own (`foldLimit`).
- **Write to** is `mk_target` (text), `mk_op`, `mk_smooth`, `mk_feather`. A shape layer in a mode without a shape
  (Stone blocks' joints) writes its coverage — into any named mask but the Shape mask, which it leaves alone
  (`maskWriteKind`). Hooks: `LayerDef.maskWrite` (what a type writes), `readsMask` (reads `maskIn()` in its shader:
  Chips, Tabs, Glass), `maskSource` (edge filters). `readsState` is gone with the pre-pass.
- **The feature random** a mask stores is `GenOut.fid` — rnd can be tinted for colour and `feat` zeroed where a
  generator varies heights itself; `genOut*` set `fid = rnd` (`genOutSmooth` −1, no features); Bricks-family shapes
  set it to the brick's own random.
- **Cut-out**: a material's members sit together in the stack, so the whole Cut-out goes to the top (`RecipeDef.first`).
  Its opening writes *Opening* and its frame ring *Opening frame*; the material in front is limited to outside
  *Opening ∪ Opening frame*, the one behind to inside *Opening*, so neither paints over the frame.
- **Edges** take one mask by name (`source: 'mask'`, `source_mask`), not an expression yet. **Symmetry** no longer
  folds masks (only colour, height and the other channels).
- **Masks view**: one view (`0`) with a mask picker; features are tinted by their random. `maskData(name)` on the
  headless API reads a mask back.
- **Cost**: cold compiles the same or faster (the named-mask code is gone), per-pixel cost no worse — lower for most
  layers, which no longer read and pass the four masks through every pass.
- **Private files** were converted once by `private/tools/convert_masks.py` (which the private authoring helper also
  applies); the app has no migration.

## As built (phases 4–6)
- **Mask area** keeps the type id `surfacemask`. Beyond the design: Slopes and Facing measure the slope across half the
  Radius (bilinear samples), so surface grain doesn't speckle them; defaults Radius 6 px, Full at slope 0.2, Level
  0.2. Gradient's march counts a sample up to 0.75 px past the outline as inside, so a ray along an edge skims past
  one-pixel notches instead of stopping in them. The band (*A band at the edge*) is solid with its inner end fading
  over *Band softness* (default half the Width), measured from the mask's outline — a bevel inside it is part of the
  band. In feature modes Breakup is shifted by each feature's random and pulls between 0.4× and 1.6× as hard per
  feature, so every brick frays its own way and by its own amount. Crevices' Radius defaults to 8 px. Inside starts
  with a flat Edge; surface modes are featureless (`genOutSmooth`). Three critic rounds on a bricks sheet scored
  6.6, 7.6 and 8.4; left open: Shaping's Cutoff is a hard 0/1 step unless *Cutoff softness* is raised (shared by every
  generator, hard on purpose for pixel-art flecks), so a frayed selection's edge is aliased at softness 0, and a
  Breakup size close to a narrow band's width dithers it into dots.
- **Content**: `fromMask(mask, layout)` (masks.ts) gives a Mask area › Inside layer, passing on the layout layer's
  Anti-alias. The stone templates and recipes lay the stones out once (a *Stones* Bricks or Voronoi layer writing
  Shape, outputs off) and read them for Pillow, Edges, Stone heights and Stone colour; the Tiles recipe's raised
  border, heights and colour read the Tiles layer's Shape mask. Copies of non-shape patterns (noise, Rock's outputs,
  caustics) stay copies: a mask carries a shape and a feature random, not their values. Renders against the copies:
  Tiles the same; the stone walls the same at a glance, sub-pixel bevel and edge detail different (Mask area bevels
  from the stored distance, Bricks' copies from their own mitred bevel distance).
- **UI**: mask-name params are `mask: 'read' | 'write'` (ParamDef, UI only) and drawn as `MaskField` — a dropdown of
  the masks there are (read: written above the layer; write: all, and Shape) with None and *New mask…*; the inspector
  fills `maskChoices` per layer and notes what a read mask holds here ("Shape here: Panel − Vent") or that nothing above
  writes it. In the layer list, a mask lane left of the icons draws a line from each layer with a Limit to (and each
  material with a limit, from its row) up to the layers that wrote what it reads — horizontal from the icon, a
  rounded turn, up, a rounded turn into the writer's icon; one colour per mask in the order they appear, links to one
  writer's mask sharing a lane, overlapping spans in separate lanes, a closed material's members drawn on its row
  (`maskLinks` in masks.ts; `Outliner.vue` measures the rows). Between Limit to's mask fields, And / Or / Except (∩ ∪ −) are toggle buttons (`segmented`, the following masks'
  fields unlabelled: `bare`). The Masks view (`0`) has a picker and an inline
  rename (`renameMask` in recipes/index.ts: writes, limits, sources, material limits and recipe macros). The Height
  mask's field is *Height* (it said *Limit to* too). The cursor readout shows the viewed mask's distance (it read the
  old register slot).

## Phases
Each phase ends with `npm test`, `vue-tsc` and `npx tsx tools/smoke.ts` green.

1. **Mask analysis** — `masks.ts` with versions, liveness, slot allocation, exactness and labels; the `maskexpr` type.
   Unit tests: slot count equals the peak of live versions; unread versions get no slot; labels. Nothing uses it yet.
2. **Switch over** — new params, pipeline and wrapper, direct readers, jump flood, display, pre-pass deleted, old
   migration deleted; every recipe, template, preset and test rewritten to the new keys in the same step (single-term
   limits; the Cut-out reordered). Before it, render every preset (`tools/presets.ts`) and recipe; after, compare —
   identical except the Cut-out. Cold compiles of a few heavy types (`tools/compile-time.ts`) and per-pixel cost
   (`tools/render-cost.ts`) no worse.
3. **Limit expressions** — the combine pass, multi-term limits, material limits.
4. **Mask area** — Inside first (rebuild the stone-wall template and every copy found in the sweep; compare renders),
   then Gradient, Facing, Height range and Breakup. Gensheets of each mode (Masks view and painted) through the critic
   (`docs/gensheet.md`, `docs/generator-critic.md`); check Gradient's march on the GPU backend, not only SwiftShader
   (AGENTS.md › ANGLE loops); cold compile with `tools/compile-time.ts surfacemask`.
5. **UI** — the Mask card (*Write to* picker with *New mask…*, *Mode*, *Limit to* rows with labels), mask pickers
   for edge sources, the Masks view picker and rename. Screenshot it (`tools/shot.ts`).
6. **Clean-up and docs** — hints and copy, docs (above), the grep gate, previews regenerated, this file to done.
   Convert the private recreations with the one-off script.

## Later
- **Copy or rebind** for mask output → slot: copy first; rebind only if `render-cost.ts` shows the copies matter.
- **Smooth ops in *Limit to***: free (same `sdfCombine`), left out to keep the rows small; add if a rounded clip is
  wanted.
- **Two write targets** (a shape that writes *Shape* and *Opening*): not supported; use a second layer. Revisit if
  recipes keep needing it.
- **Height-range limit on every layer** (`m_hmode`): *Mask area › Height range* covers it as a mask; the per-layer
  limit could then go.
- **Marching on huge features**: Gradient's march is bounded; features longer than the bound ramp only over the
  bound. A *Max size* param if that shows.
