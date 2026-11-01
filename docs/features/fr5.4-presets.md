# FR5.4 — Presets

**Status:** v2 done — presets as files in `presets/`, a presets menu on every layer, group, light and post
filter card (and the Lighting presets card), the user's own presets in the browser. v2 supersedes v1's starters built
in code.

## Goal

- Starter projects that show off both target styles and seed the optimiser (v1).
- Starting points for every card, not only for whole projects: pick a look for one layer, light or post filter from a
  menu of thumbnails, and save your own looks the same way. No backend, and no file downloads for the user to manage.
- Built-in presets that are easy to maintain: data files, not 1,700 lines of code.

## Design

### Preset files

- **Every project has a name and a description.** `Project.name` exists already; `Project.description` (optional,
  plain text) joins it, for every project file, preset or not. Both are edited on the Project card, shown on hover in
  the wizard and the preset menus, and filled in by the Save as preset… dialog. Presets carry no name or description
  of their own.
- **One format for everything.** A preset is an ordinary project file (`projectToJSON`; it loads with
  `projectFromJSON`) with an extra `preset` key: `{ kind, target?, id, category?, tags? }`. `id` is random, and lets
  an import recognise a preset it already has.
  - `kind`: `project` (a wizard starter), `layer`, `group` (a group of layers, FR8.3; files saved as `material` load
    as `group`), `light`, `lighting` (the whole rig: sky, ambient and every light) or `post`.
  - `target`: what it applies to. The layer type (`bricks`), the light type
    (`directional`) or the post filter type. Not used for `project` and `lighting`.
  - `category`: how menus group it (the starters' `Quake-style`, `UI surfaces`, `Nature`, `Basics`; free text
    elsewhere).
  - `Project.preview` (FR8.20) is the thumbnail. Every preset carries one.
- **A card preset is a whole project around the item.** The file holds the item and whatever it was rendered with, so
  it can still be opened as a project (File ▸ Open) and judged as one. Only the item is copied when the preset is
  applied; the rest is ignored.
- **Images travel with the preset.** A Stamp's image and the sky's environment image are only names
  (`core/images.ts`); the pixels stay in the browser that loaded them. A preset embeds the images its project uses as
  `preset.images: { name: dataURL }`, and applying it (or opening a starter, `asProject`) `putImage`s them first.
- **Built-ins live in `presets/` at the repository root**, one file each, in a folder per kind:
  `presets/project/bricks.json`, `presets/layer/<type>/<name>.json`, `presets/group/<name>.json`,
  `presets/light/…`, `presets/lighting/…`, `presets/post/…`. They are bundled (the app works offline and from a
  static host, which couldn't list a folder) through `src/presets/builtin.ts`, an index of static imports generated
  by `npx tsx tools/presets-index.ts`. Static imports load the same way in the app, Vitest and `tsx` tools; Vite's
  `import.meta.glob` exists only in the first two. All of it loads up front (~50 files, a few hundred KB of JSON,
  far less gzipped); `src/presets/index.ts` reads the headers and normalises a project only when it's asked for.
  `presets/*.json` imports are typed `unknown` (`src/presets/json.d.ts`) so the typecheck doesn't infer them.
- **Moving v1 over** (done once): the starters that `src/presets/index.ts` built went to `presets/project/<id>.json`
  with their previews, and `LIGHTING_PRESETS` to `presets/lighting/<id>.json` on the stage; the builders,
  `core/lightingPresets.ts` and `src/presets/previews.ts` are gone, and the Lighting presets card shows the lighting
  presets as thumbnail tiles. `tools/previews.ts` renders previews into the files (`--missing`, `--only
  project/bricks,torch`) and regenerates the index; `tools/presets.ts` makes its contact sheet from the starters.
  `PRESETS` (id, name, group, build) is still exported for the tools.
- **Tests**: `presets.test.ts` checks that `builtin.ts` lists exactly the files in `presets/`, and that each one loads,
  uses only registered types and known param keys, sits in its kind's folder, holds the item its header names, and has
  a preview.

### What a preset is rendered with

- **Items with their own relief** — generators that write height (shapes, noise, patterns) and groups —
  are saved as they are: the item alone on the base material, under the standard light rig below. No stage.
- **Items without relief of their own** get a stage: `presetStage(item)` puts a fixed scene under them, so the
  thumbnail shows something. Used for the built-ins (the tool) and the user's presets (the app) alike:
  - **Filters and adjust layers** (Blur, Bevel, Etch, Levels…), anything reading a mask (_Limit to_, a mask input)
    and **paint-stack layers**: a test relief — a few bevel-able shapes over soft noise, writing the `Shape` mask.
  - **Lights and lighting** (`presetLightStage`): the test relief with a polished steel dome in the middle, which shows
    the light's highlight and what metals reflect (the sky or its environment image); the rig below is replaced by the
    preset's.
  - **Post filters**: the Stone bricks starter (`bricks`), with the filter appended to its post stack.
- **The standard light rig** (`presetLighting` / `presetBase` in `src/presets/stage.ts`): a sun from the top left,
  sky, AO and shadows, as the Match setups use — flat ambient light hides relief. Base material mid grey, post tonemap
  only. Every thumbnail but a light or lighting preset's uses it, so they compare. A layer or material preset keeps the
  project's height depth.
- **What counts as relief** (`makesRelief`): a generator layer with its Height output on. The stage is large
  bevelled bricks (writing the `Shape` mask) over soft noise, relief only.
- Size: the current project's size for the user's presets, 128 px for the built-ins. Tileable as the project is.

### Menus

- **Every inspector** (layer, group, each light, each post filter) has a **Presets** key at the bottom right of its
  description (`PresetMenu.vue`; it sat in the title row as an icon stud until FR10). It opens a drop-down of thumbnail
  tiles for that card's `kind` and `target`, grouped by category (`DropMenu`'s tiles, placed `under` the button). The
  user's presets and the built-ins are mixed in the same groups, in name order: the starters' categories first in their
  usual order (Quake-style, UI surfaces, Nature, Basics), then the rest alphabetically, _Other_ (no category) last.
  Presets of other types aren't shown.
- **The Lighting presets card** (project view) shows the lighting presets as tiles in the card itself, with **Save this
  lighting…** under them.
- Hovering a tile shows its name and description. Clicking applies it. The user's own tiles are edged in ember.
- **Right-clicking a tile edits the preset** (`PresetDialog`'s edit mode): its name, description and category, and
  **Update its settings to the current …** to retake them from the card the menu belongs to (or the current lighting),
  with a fresh thumbnail. The user's presets are changed in place (same id) and can be deleted there; a built-in is
  read-only, so saving one adds the user's own copy (new id) beside it.
- At the bottom: **Save as preset…** and **Manage mine…**, which opens **My presets** (also File ▸ My presets…):
  each of the user's presets with its name, category and description to edit, a delete button, and **Import…** /
  **Export mine…** (see Storage). Built-ins aren't listed there (right-click one for an edited copy).

### Applying

- One undo step, and only the card changes.
- **Layer**: same type only. Its params are replaced by the preset's, except mask wiring: `mk_target`, `mk_op`,
  `mk_smooth` and `lim_*` keep the layer's current values, since masks belong to the project and not to the look. The
  layer keeps its id, enabled state and lock. Its name changes only if it is still the type's default name.
- **Pixel units**: the preset's params are at its own size. They are rescaled to the project with `scaleParams`
  (`core/pixelScale.ts`, kx = project width / preset width, ky likewise, and the project's supersampling), as a
  canvas resize would, so a 128 px preset looks the same in a 512 px project.
- **Group**: any group preset. The group's layers are replaced by the preset's (fresh ids, in place); the group's name
  and `limit` are kept. A group preset is also added whole from the add menu's _Presets_ tab (FR8.3).
- **Light**: same type only; all its params. **Lighting**: sky, ambient and the light list. Render settings
  (shadows, AO) are left alone.
- **Post filter**: same type only; all its params.
- **Project** presets are the wizard's Starters (FR8.16), and creating from one is a new project, as now. A project
  opened from a preset loses the `preset` header (`asProject`), so saving it doesn't make another preset.
- Applying is `applyPreset` in `ui/actions.ts` over `src/presets/apply.ts`, which works on the preset project resized
  to the open project's size (`resizeProject`). New generator types compile behind the busy modal (FR8.16a's guard).

### Saving

- **Save as preset…** (`PresetDialog.vue`) asks for a name, a description (the preset project's own) and (optional)
  a category (suggesting those in use), with the thumbnail already rendering beside the form.
- The thumbnail is rendered off-screen: build the preset's project (the item under the standard rig, on
  `presetStage(item)` when it has no relief), suspend the viewport, `setProject` it, compile, `renderNow` at a modest
  sample count, capture with `capturePreview`'s encoder, then `resume` with the user's project. Nothing in the user's
  project changes: no layers are switched off and no undo step is added.
- **File ▸ Save as template…** saves the whole project as a `project` preset, its thumbnail what the viewport shows;
  it appears in the wizard in the category it is given.

### Storage

- The user's presets go in **IndexedDB** (database `bismith`, store `presets`, key `preset.id`, a random id). Each
  value is the preset file's text plus its `preset` header copied out for listing without parsing everything.
  IndexedDB holds far more than localStorage's ~5 MB, which the autosave and stored images already use.
  The database is opened in one place, `src/core/idb.ts`, which also holds run checkpoints (FR6.3).
- Built-ins are read-only and keyed separately (`builtin:<path>` against `user:<id>`), so the user's presets never
  collide with or shadow them. To start from a built-in, apply it and save it again.
- Where the browser won't store them (a private window, blocked site data) presets last for the session, and the
  save dialog says so.
- Browser storage belongs to one origin and is gone when site data is cleared. **Export mine…** downloads the user's
  presets as `my.bismith-presets.json` (an array of preset files), and **Import…** reads one back, or a single preset
  file. Imports with an id already stored are skipped.
- **Adding a built-in** needs no backend either: save the preset in the app, export it, copy the preset out of the
  array into `presets/<kind>/…`, and run `npx tsx tools/previews.ts --only <path>` (it re-renders the thumbnail at the
  file's size and regenerates the index).

## Built-ins

Card presets (v2), harvested from the starters' tuned layers at 128 px with their mask wiring reset:

- Layers: Stone bricks, Cobblestones, Sandstone ashlar, Frosted blocks, Slate wall, Rock face (Stone); Brushed metal,
  Rivets (Metal); Panel seams, Tech plates (Tech); Stone grain (Surface); Moss, Orange lichen, Grass (Organic);
  Scratches, Rust patches, Cracks, Grime & wear (Wear).
- Groups: the 25 looks that were smart materials (FR8.3) — stone, floors, wood, liquids, metals, pipes, tech.
- Lights: Warm key, Raking sun, Torch. Post filters: Quake palette, Soft glow, Clamp.
- Lighting: UI key, Overhead, Torch-lit, Raking, Flat (v1's lighting buttons).

Starters (v1):

- Quake-style (64×64, tileable, Quake palette): riveted plate, stone bricks, cobblestones, tech panel with light strip,
  tech plates.
- UI surfaces (non-tiling, ACES): forged button (Cinderforge keycap + ember underlight + glow), sunken well (chamfered
  notch), bevelled panel (alpha cut-out frame, recess, mirrored corner screws), ember gem.
- Nature: rock face, water caustics, stone walls (FR8.22), grass.
- Basics: blank noise.

## Checklist

### v1

- [x] Preset plumbing; presets are the Starters of the New project wizard (FR8.16)
- [x] Quake: riveted metal, stone bricks, cobblestones, tech panel with emissive strip
- [x] UI: forged button, sunken well, bevelled panel, ember gem
- [x] Nature: water caustics — the Liquid material with refracted light, Gerstner waves and an ocean blue-teal ramp
- [x] Nature: rock face — the Rock face suggestion (FR8.18) at 128 px in a warm sandstone palette
- [x] Nature: stone walls (FR8.22) at 512 px — Sandstone ashlar, Rust rubble wall, Lichen sandstone, Mossy slate wall,
      Frosted stone
- [x] Preset param validation test + render-all tool
- [x] Previews for the new-project wizard (FR8.20)

### v2

- [x] `Project.description` (serialised, on the Project card)
- [x] `preset` header in the project format (`normalizeProject` keeps it; images must be base64 image data URLs)
- [x] v1 starters → `presets/project/*.json`, lighting presets → `presets/lighting/*.json`; builders,
      `lightingPresets.ts` and `previews.ts` deleted
- [x] Generated static-import index (`tools/presets-index.ts` → `src/presets/builtin.ts`); wizard reads from it
- [x] `presets.test.ts`, `tools/previews.ts`, `tools/presets.ts` work on the files
- [x] Standard rig, `presetStage` (relief-less items only); thumbnails rendered off-screen without touching the project
- [x] Apply: layers (mask wiring kept, pixel units rescaled), groups, lights, lighting, post filters; one
      undo step each
- [x] Presets key and thumbnail drop-down in every inspector; Lighting presets card as tiles
- [x] Save as preset… dialog; File ▸ Save as template…; My presets (rename, describe, recategorise, delete)
- [x] IndexedDB store; Export mine… / Import…
- [x] Embedded images for Stamp presets
- [x] A first set of built-in layer, material, light and post presets
- [ ] Try it in Firefox (IndexedDB, menus, save dialog) — checked in Chromium only
