# FR8.16a — Instant wizard, project loading and export quality

**Status:** done, except the D3D11 / Firefox timing checks and the export before/after comparison (see Checklist)

## Goal

- The New project wizard (FR8.16) opens instantly and never holds up the project you pick: it shows only presets, from
  their stored previews, and compiles nothing.
- Opening a project shows that it is loading (spinner, progress, what it is doing) instead of freezing the page,
  including in browsers that can't compile shaders in the background (Firefox).
- File ▸ Export PNG renders the image at a higher quality than the interactive viewport, and the page stays
  responsive while it does.

Layer, light and post presets, presets as files and the user's own presets are in FR5.4 (v2).

## Design

### Wizard

- **Where the time goes now.** Starters already show stored previews (FR8.20) and compile nothing. The Suggestions
  don't: every template is built from a colour seed drawn at random once per session, so no stored picture matches
  it. Opening the wizard batch-compiles every Suggestion's shaders in parallel (`compileAll`; ~7 s cold on D3D11),
  then renders them one by one. Picking a card stops the render queue (`stopRendering`), but the batch keeps the
  driver's compile threads busy, so the picked project's shaders wait behind it. This is the stall.
- **Presets only.** The Suggestions are removed, and with them the per-material colour schemes: `match/schemes.ts`,
  its test and `TEMPLATE_LOOKS`. The reference templates (`match/templates.ts`) stay for the Match workspace (FR8.4).
  The wizard lists Blank, then the `project` presets (FR5.4) grouped by category, the user's and the
  built-ins mixed.
- **Every card is a stored picture.** Each preset carries its preview (FR5.4 requires one), so the wizard never
  compiles or renders: the batch precompile, the render queue, the thumbnail cache and the viewport suspend/resume
  all go. A preset without a preview (e.g. an imported file saved before it had one) shows a placeholder with its
  name, not a live render.
- **Size** applies to Blank only. A preset opens at the size it was authored at; Project › Canvas resizes it
  afterwards (`resizeProject`), as for any project.
- **Picking** loads the project; its shaders compile in the viewport as for any opened project. With nothing else
  compiling, nothing gets ahead of them.

### Loading a project

- **Now.** The busy modal (`BusyModal.vue`: a spinner and a progress bar, a step per shader) is shown only when the
  engine starts (`startEngine` in `Viewport.vue`) and when a layer or smart material of a new type is added
  (`withShaders` in `ui/actions.ts`). Opening a file (`loadProjectText`), picking in the wizard (`newProject`),
  undo / redo and, later, applying a preset (FR5.4) just swap the project, and the next frame compiles every shader
  it hasn't seen on the main thread: the page freezes with nothing on screen.
- **Firefox has no background compile** (no `KHR_parallel_shader_compile`), so even the existing modal is poor there:
  `MaterialPipeline.precompile` starts every compile at once (`Promise.all` of `compileAsync`), and the first status
  check blocks until all of them are linked — the bar jumps from 0 to 100 % at the end.
- **One guard for every way a project changes** (`updateProject` in `Viewport.vue`). Every change of the project
  reaches the engine through it. When the project uses generator types whose shaders aren't compiled, it holds the
  change (the engine keeps showing the last frame), shows the busy modal, compiles, then applies the latest project
  and keeps the modal up until that frame has evaluated (`settled`). Opening, the wizard, undo / redo, presets and
  imports are all covered without touching each one. Only plain types are checked: a type's shader variants (Bevel
  aspect, optional parts) still compile in the background as they are used. `withShaders` (adding a layer) stays:
  it compiles before the layer is added, so the guard finds nothing left to do.
- **Steps the user can follow.** Without background compile, `Engine.precompile` compiles one program per step and
  waits for a painted frame between them, so the bar moves and the page repaints between shaders. Each blocks for
  its own compile only. With background compile it stays a parallel batch.
- **The first frame is one step.** The steps are the generator shaders plus one for the first frame ("Rendering the
  first frame…"), which compiles any filters and post filters on the spot. The path tracer compiles at start-up, and
  the filters and post filters are small next to the generators, so listing them as steps of their own wasn't worth
  the plumbing.
- **The modal says what is happening**: "Opening “Stone bricks”…" when a new project came in (store generation),
  "Compiling shaders…" otherwise, with "Compiling shaders · 3 of 9 — Bricks" as it steps. It appears at once
  (`instant`) when compiles block the page, as before. Start-up uses the same modal ("Starting the renderer…").
- **The spinner keeps turning** while a compile blocks the main thread only where the browser animates `transform`
  on the compositor; it already uses only `transform`. Check it in Firefox; if it stalls there, the stepped progress
  above is what keeps the page from looking hung.

### Export quality

- **Now.** `exportFinal` already re-traces from zero with `engine.renderNow()` up to `render.maxSamples` (default
  256), at the project's supersampling (usually 1), then runs post. It does not copy the viewport buffer, but it is no
  better than a viewport left to converge, and it blocks the page synchronously for the whole trace.
- **Export settings**, in Project › Path tracer under an _Export_ heading:
  - `render.exportSamples`: default 1024; never fewer than `maxSamples`.
  - `render.exportSupersample`: 1–4, default 2. The export renders at k× and box-filters down, the same path as
    FR8.7's supersampling, with px params rescaled by `scalePixels` for the render only. A project already
    supersampled at more than this keeps its own.
  - Jitter is forced on for exports, so edges are antialiased even at 1×.
- **Asynchronous render.** `engine.renderExport({ samples, supersample, signal, onProgress }, read)` suspends the
  interactive loop, sets the export project, compiles its shaders (`precompile`), traces in chunks sized to ~40 ms of
  GPU work with a painted frame between chunks, runs post, calls `read` for the pixels, and resumes the viewport with
  the user's project. `samples` 0 traces nothing (material maps only). The busy modal shows progress with a Cancel
  button (`editor.busy.cancel`); cancelling resumes the viewport and saves nothing ("Export cancelled").
- **What uses it** (`exportRender` in `ui/actions.ts`): Export PNG (and its @4× nearest upscale), Copy image, Export
  map, and Export all maps. Single maps other than Final and Render (diffuse, height, AO, normal…) skip the trace but
  still render at the export supersampling and are box-filtered to the texture size, as FR8.7's map readback is, so
  they line up with the final image.
- **Unchanged**: Save project (Ctrl+S) still takes its preview from what the viewport shows (`capturePreview`,
  FR8.20). The headless harness and the optimiser keep calling `renderNow(samples)` synchronously; determinism
  matters to them, speed and responsiveness don't.
- Palettised projects (FR4.2) gain least: more samples change few palette indices. They get the same settings anyway,
  as they cost little at 64 px.

## Checklist

### Wizard

- [x] Remove the Suggestions, Shuffle colours, `match/schemes.ts` (+ test) and the wizard's compile / render queue
- [x] Cards: Blank, then `project` presets (by category, the user's and built-ins mixed) from their previews, or a
      placeholder
- [x] Size for Blank only
- [ ] Measure on D3D11 (Windows Chrome): wizard opening and pick-to-first-frame, cold and warm cache
- [x] FR8.16 doc: note that Suggestions and schemes are gone

### Loading a project

- [x] Viewport guard: uncompiled generator types → hold the change, busy modal, precompile, apply; covers open,
      wizard, undo / redo, presets, import
- [x] Sequential `precompile` with a painted frame between programs when there is no background compile
- [x] Modal closes on the first frame (filters and post compile in that one step)
- [x] Modal text: project name, "Compiling shaders · n of m — type"
- [ ] Check in Firefox (spinner, bar steps) and Chrome on D3D11 (no regression in load time)

### Export quality

- [x] `render.exportSamples`, `render.exportSupersample` (defaults, `normalizeProject`, Path tracer card)
- [x] `engine.renderExport`: chunked trace, progress, cancel, viewport resumed
- [x] Export PNG, Copy image, Export map and Export all maps use it; maps at the export supersampling
- [ ] Before/after comparison of a few starters (noise, edge aliasing) at default settings
