# FR10 — Project variants

**Status:** done on `feature/variants`; checked in a SwiftShader browser, not yet on the Windows GPU backend

## Problem

One texture often needs several looks — dry and rain-soaked, clean and sooty, noon and dusk — built from the same
stack. Today that means copies of the project file that drift apart: a fix to the bricks has to be made in every copy.

## Goal

Variants of one project: the same layers, lights and post filters, each variant with its own settings. Add, rename,
duplicate, delete and switch between them in a **Variants** panel above the Outliner; see which settings a variant
changes (◆) and reset or promote them from a param's right-click menu; browse them all in a **Variants** workspace;
export any of them from one **Export** dialog. All variants live in the one project file.

## Model

### What a variant owns

Each variant has its own value for every _setting_; everything _structural_ is shared.

| Shared by all variants                                                            | Each variant's own                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Which layers, their types, names, order, lock                                     | Every layer param, and the layer's on/off                                                  |
| Groups: members, name, Limit to                                                   | A group's shown / hidden                                                                   |
| Which lights (and a point light's `refDist`), which post filters, their order     | Light params and on/off; post filter params and on/off                                     |
| Mask hues, canvas width / height, tileable                                        | Base material; Sky light; Ambient                                                          |
| Name, description, preview                                                        | Global seed, Height depth                                                                  |
| Render quality: Max samples, Per frame, Supersample, Export samples / supersample | Render look: Bounces, Specular scale / tint, AO, AO radius, Firefly clamp, Shadows, Jitter |

The split of the Path tracer card follows the engine's own: `engine.setProject` already treats sample counts and export
settings as "not the image" (`tKey`), so the Export dialog's read-only _Project export settings_ (output size,
supersample, samples) are the same for every variant.

### Keys

A setting is addressed by a flat key built from the stable ids the project already has:

```
layer.<id>.on            layer.<id>.p.<param>
group.<id>.on
light.<id>.on            light.<id>.p.<param>
post.<id>.on             post.<id>.p.<param>
base.<key>   sky.<key>   ambient.<key>   render.<key>   seed   heightDepth
```

`src/core/variants.ts` (new, pure, tested) owns the mapping:

- `extractSettings(p): Settings` — every per-variant key → its value (a `ParamValue`, JSON-clonable).
- `applySettings(p, s)` — write values back onto a project with the same structure (unknown keys are ignored).
- `diffSettings(a, base)` — the keys whose values differ (deep-equal on JSON for gradients, curves, shapes).
- `materialise(p, variantId)` — the full project of one variant (base settings + its changes), with no `variants`.
- `forEachVariant(p, fn)` — materialise each variant, run a structural edit on it, re-extract: for the edits that
  rewrite params across the stack (below).

A change exists only while its value differs from the base: a variant set back to the base value loses its ◆, and a
base edit that makes a variant's change equal to it drops that change at the next sync.

### In memory and on disk

The editor keeps working on one ordinary `Project` — the **active variant, materialised** — so the engine, Properties,
gizmos, Match and Tiling need no changes to read it. Variant state rides along in `project.variants` and is part of
every undo snapshot:

```ts
interface ProjectVariant {
	id: string;
	name: string;
	note?: string;
	changes: Record<string, VariantValue>;
}
interface VariantSet {
	baseId: string; // the variant the top level of the file holds
	activeId: string; // the one the editor shows
	list: ProjectVariant[]; // display order, base included (its changes always {})
	baseValues?: Settings; // in memory only: the base's full settings, while editing another variant
}
```

The file holds the **base** at the top level, so tools, the harness and older readers see a plain project, and a
`variants` block for the rest (the canvas's _Packed project file_ board):

```jsonc
{ "version": 2, …the base variant as a plain project…,
  "variants": { "base": { "id": "dry", "name": "Dry", "note": "…" }, "active": "wet",
                "list": [ { "id": "wet", "name": "Rain-soaked", "note": "…", "changes": { "layer.k3f9.p.brickColour": "#5e3125" } } ] } }
```

- `projectToJSON` writes the file form (materialise the base, list the others' changes). Autosave and undo snapshots
  keep the in-memory form; `normalizeProject` reads either.
- `normalizeProject` reads both: a block with `baseValues` is the in-memory form (from `store.load` of a Match or
  Tiling result, a run checkpoint); without it, the file form — the top level becomes `baseValues` and the active
  variant is materialised. Changes whose key no longer exists, or whose value fails its ParamDef, are dropped (unknown
  layer types are already dropped; their keys go with them).
- No `variants` block: the project is a single variant, named after the project; nothing extra is written for it.
  While it is the only variant and hasn't been renamed (`ProjectVariant.auto`, in memory only), its name follows the
  project's (`syncVariants`), and saving it writes no block, so it goes on following after a reload. A name read from
  a file's block is the user's and stays; renaming the variant fixes it too. `PROJECT_VERSION` becomes 2 (nothing is released: no migration beyond "no block = one variant").

### Sync

`syncVariants(p)` runs in `commitNow` before the snapshot is taken (and before switching, saving, exporting):

- On the base: `baseValues` is dropped (the working project _is_ the base); other variants keep their changes, so a
  base edit reaches every variant that doesn't change that setting.
- On another variant: keys new to the working project (a layer, light or post filter added while here) are adopted into
  `baseValues` — structure is shared, so the new item joins every variant with the values it was made with; keys whose
  item is gone are dropped from `baseValues` and from every variant's changes; then
  `active.changes = diffSettings(extract(working), baseValues)`.

### Structural edits across variants

Most structural edits (add, delete, duplicate, reorder layers, lights, post; group, ungroup without a limit) touch only
structure and are handled by the sync above. A few rewrite params and must reach every variant via `forEachVariant`:

- `resize` (`resizeProject` scales px params): every variant's px values scale with the canvas.
- `renameMask`: a mask renamed in one variant is renamed in all.
- `ungroup` (moves the group's Limit to onto its members and its hidden state onto their on/off). A group's own Limit
  to is structure, shared by every variant.
- Duplicating a layer, light or post filter copies each variant's value of it (a new id with the same changes).

## UI — reconciled with the code

The canvas boards are the target; where they disagree with the app as it is, the app wins (listed under each part).
New pieces follow the canvas.

### Variants panel (`src/ui/layout/VariantsPanel.vue`, new)

The left column becomes a stack: `ProjectPanel` (the project's name as its title — double-click to rename — its size and
description: text until clicked, then a text box where Esc keeps the old one; all shared by every variant),
`VariantsPanel`, then `Outliner`, sharing the resizable width (`cf-left`); the top bar no longer shows the name. The
Outliner's top row is _Project settings_, the shown variant's. The panel is a `cf-panel` with the Outliner's `.head`
(`cf-label` _Variants_, count in `cf-mono` readout) and rows of a 40 × 24 thumbnail (a crop of the render's middle at
50% zoom), name, and a _Base_ badge or `◆ n`; the active row has the Outliner's `.sel` treatment. It shows up to seven
rows and scrolls past that; with one variant it is one row. A divider under it sets its height (`cf-variants`;
double-click for its own height again). Header: a delete stud (`cf-ico-btn danger`, crimson), then **+** as the Outliner's
`fk add` key (new variant from the current one); the workspace is reached from the top bar or the menu's _Browse all
variants_. No footer: the keys are in the Help menu (_Variants_).

- **Switch:** click a row; `Alt+↑` / `Alt+↓` step (handled in `App.vue` before its `altKey` early return; the panel's
  own arrow keys, while its list has focus, leave Alt to it). Switching syncs, then loads the target's materialisation
  into `store.project` in place (one undo step; undo returns to the previous variant as it was).
- **Reorder:** drag a row, with the Outliner's drop line. The base is always first and isn't dragged; a variant dropped
  above it becomes the base (the line turns `--gold`; `moveVariant` to 0 is `makeBase`, which also moves the new base
  to the top — from the menu too). Every variant keeps its look; the others' changes are rediffed from the new base.
- **Context menu:** a `DropMenu` with `placement="pointer"`, like the Outliner's row menu — plain items with
  shortcuts, as `MenuItem` has no icons or danger style (the board's icons and red Delete are dropped): New variant
  from _name_ · New variant from _base name_ (base) · — · Rename `F2` · Changes… · Make base · Reset all _n_ changes
  to _base name_ · — · Export… · Browse all variants · — · Delete _name_… `Del`. Make base and Reset are hidden on the base, Changes… with one variant;
  Delete is disabled with one variant. The board's `Ctrl Alt N` for New variant is dropped (it is New project).
- **Rename:** inline input in the row, double-click or F2, as the Outliner renames (Enter keeps, Esc cancels); names
  are unique (a clash gets " 2").
- **Prompts** open anchored under the row, per the canvas (new `AnchoredAsk` popover beside `AskModal`, same choice
  model): _Delete Rain-soaked?_ (Cancel / Delete; undo brings it back) and _Dry is the base — make another variant the
  base first_ (OK). `Del` deletes the active variant only while the panel has focus — elsewhere it keeps deleting the
  selection.
- **Thumbnails:** `src/ui/variantThumbs.ts` — a preview of the whole render (workspace cards) and a 50% crop of its
  middle (`encodeCrop`; the panel's rows and the Export dialog's list); the active variant's from the viewport once its
  render settles, the others rendered off-screen while it is idle — all stale ones in one pass (`renderThumbnails`), so the
  viewport restarts once — cached by a hash of the materialised project; nothing is stored in the file.

### Changed settings

- **Deleting a layer** (`confirmDeleteLayer` in `ui/actions.ts`, before `deleteSelection`): layers are structure, so a
  deletion reaches every variant. On a variant other than the base the modal says the base and the others lose it too
  (naming the variants with their own settings for it); on the base it asks only when another variant changes the
  layer, as those changes go with it. A layer no variant changes, on the base, deletes without asking.
- **Outliner row menu:** on a variant other than the base, a layer it changes (◆) adds _Reset all changes to this
  layer_ after the item's actions (`store.resetItemToBase('layer.<id>')`: every `layer.<id>.` key back to the base's).
- **Outliner:** a 6 px ◆ (`--e400`, a rotated square) after the name of a layer, group (or a member), light or post
  row the active variant changes, on the Base row for base material changes, on the Environment row (first of the
  lights) for sky and ambient, and on the Project settings row for the seed, height depth and path tracer look; nothing
  on the base variant, and no tooltip (per the review). A layer the variant turns off already shows as off. The board's
  _changed in Rain-soaked_ heading note is dropped (done on the canvas too).
- **Properties / `ParamList`:** a new optional `keyPrefix` prop (`layer.<id>.p.` etc.) lets a row look up whether it
  changes from the base: a ◆ before the label and the label in `--accent-hi`. The existing gold `.noted`
  labels keep their meaning; changed wins the colour, the note stays in the tooltip.
- **Param context menu** (new, every `ParamList` row, also with one variant): Copy value · Paste value (enabled when
  the copied value's type fits; no keyboard shortcuts) · — · Make this the base value · Reset to _base name_ (both only
  with more than one variant; disabled on a setting that follows the base) · — · Reset to default. Paste and the resets
  go through the card's own `change` handler, so linked defaults (`setLayerParam`) still apply. The clipboard is the
  editor store's (`editor.paramClipboard`), not the system's. The group Mask card and Write to's own rows have no key
  prefix (shared, or not wired yet): they get Copy / Paste / Reset to default only, and no marks.
- **Editing banner:** dropped from the plan. The board shows one in the Properties header, but Properties has a
  title and description only, and the panel's active row and the ◆ marks already say which variant is edited.

### Variants workspace (`src/ui/panels/VariantsWorkspace.vue`, new)

A fourth key on the workspace rail after Tiling (icon `IconVersions`, hint _Every variant side by side: compare, name,
tidy_). As with Match and Tiling, it fills the centre only; Variants panel, Outliner and Properties stay beside it,
live. The board's right-hand _Differences_ panel is dropped from the workspace (it becomes the Changes dialog, below),
so the grid has the whole centre; the board's lone top bar is the app's own.

- **Bar:** `cf-label` _Variants_ and count, a Final / Diffuse / Height toggle rail (`fk`, one lit), and when cards are
  ticked _n selected_ with a delete stud. (Compare A | B, Save as projects and Export PNGs are gone, per the review.)
- **Grid:** cards of the render (the thumbnail service at 256 px; Diffuse and Height render each variant's material
  maps through `renderExport` with no samples), a tick box, _Base_ or _Editing_ badge, name, `◆ n`, note, and edit
  (switch and go to Create), new-variant-from and more (the panel's menu) studs. Click switches, double-click edits,
  drag reorders (the panel's rule: dropped before the base card, a variant becomes the base). Rename from a card renames in the panel; deleting the ticked cards asks with the modal (`editor.ask`).

### Changes dialog (`src/ui/panels/VariantChanges.vue`, new)

Off the variant's right-click menu (_Changes…_, in the panel and on a card's more stud), not on screen otherwise. A
modal like the preset dialog: the variant's name and note fields, _Compared with_ (the base, or any other variant), its
changes grouped by item (Base material, each layer, Lighting, Post) as _from → to_ rows with a reset stud, and _Reset
all_ and _Close_. Edits apply at once (a reset, or Reset all, is one undo step). The note is edited here only; cards show it.

### Export dialog (`src/ui/panels/ExportDialog.vue`, new)

The top bar's primary key becomes **Export…** (`Ctrl E`) and opens the dialog instead of exporting at once. The File
menu keeps its direct entries (Export PNG @4×, Export all maps, Copy image, Export one map ›), which export the active
variant; its first entry becomes _Export…_ `Ctrl+E`.

- **Variants** column (only with more than one variant): tick boxes with thumbnails, All / None, the active one ticked
  when it opens.
- **Maps:** tick boxes for the `MapKind`s the File menu exports — Final render, Diffuse (+ alpha), Height
  (normalised), Roughness, Specular, Metalness, Ambient occlusion, Emissive, Opacity — and **Normal last**, with an
  OpenGL (Y+) / DirectX (Y−) choice under it, so its extra row doesn't break the grid. The ticks are remembered for the
  session.
- **Project export settings** (read-only): Output size, Supersample (`exportSupersample`, or the project's own when
  higher), Samples (`max(maxSamples, exportSamples)`); _Change…_ selects the project node so Properties shows the Path
  tracer card.
- **Output:** one file is a PNG (`<project>.png` for Final, `<project>_<map>.png` otherwise, as today; with variants
  `<project>_<variant>_<map>.png`); more become `<project>_maps.zip`, which also holds the project file, as Export all
  maps does today. Footer: _n variants × m maps = k PNGs_, Cancel, and **Download PNG** / **Download zip** (disabled
  with nothing ticked).
- **Rendering:** `engine.renderExport` gains an optional `project` (default the live one), so each ticked variant is
  materialised and rendered once, all its maps read from that render. The busy modal shows _Rendering Rain-soaked
  (2 of 3)…_ with overall progress, and Cancel stops between and within variants.

### Elsewhere

- **Status bar:** the active variant and its change count beside the layer counts (only with more than one variant).
- **Presets:** saving a template or preset saves the active variant only, without the `variants` block; applying a
  lighting or layer preset is an ordinary edit, so it becomes the active variant's changes.
- **Match / Tiling:** they edit the active variant like any other edit; their `store.load` of a result keeps the
  `variants` block it carries (the in-memory form), and the next sync turns the result into that variant's changes.
- **Project preview** (FR8.20): what the viewport shows — the active variant — as now.

## Implementation (done, one commit per step)

Each step leaves the app working, with `npx vue-tsc -b`, `npx oxlint`, `npx oxfmt` and `npm test` clean.

1. **Core model** — `src/core/variants.ts` (keys, extract / apply / diff, materialise, sync, `forEachVariant`, file
   form ↔ memory form); `VariantSet` on `Project`; `normalizeProject` / `projectToJSON` and `PROJECT_VERSION = 2`.
   Tests (`tests/core/variants.test.ts`): round trips (memory → file → memory renders the same per variant); a file
   without a block loads as one variant; a change equal to the base drops out; invalid and orphaned changes are dropped.
2. **Store** — `syncVariants` in `commitNow`; actions `addVariant(from)`, `switchVariant`, `renameVariant`,
   `setVariantNote`, `deleteVariant`, `moveVariant`, `makeBase`, `resetVariant`, `resetToBase(key)`, `resetItemToBase(item)`, `variantsChangingItem(item)`,
   `makeBaseValue(key)`, `setVariantValues`, `changedKeys` (computed for the active variant); `forEachVariant` around
   `resize`, `renameMask`, `ungroup`, and `copyItemSettings` for the duplicates. Tests (`tests/stores/project.test.ts`): adding a layer
   on a variant adds it to all; removing one prunes every variant; base edits reach unchanged variants only; make base
   keeps every variant's look; resize scales every variant; undo across a switch; autosave reloads the active variant.
3. **Variants panel** — `VariantsPanel.vue`, the left-column stack in `App.vue`, menu, inline rename, `AnchoredAsk`,
   `Alt+↑ ↓` / F2 / Del, `variantThumbs.ts`.
4. **Changed settings** — Outliner ◆; `ParamList` `keyPrefix`, ◆ and label colour; the param context menu with the
   editor's param clipboard, wired in every `ParamList` of Properties (layer, light, post, the project node's cards,
   group Mask).
5. **Variants workspace and Changes dialog** — the rail key, `VariantsWorkspace.vue`; `VariantChanges.vue` and its
   menu entry, the list from `diffSettings` against any variant, labelled through the ParamDefs.
6. **Export dialog** — `renderExport({ project })`, `ExportDialog.vue`, `Ctrl+E` and the top-bar key, File menu entry,
   naming and zip.
7. **Docs** — this file's status; the table in `docs/architecture.md` (FR10) and its layout paragraph (Variants panel,
   workspace, Export dialog); `fr1.2-project-model.md` (the `variants` block, version 2); `fr5.3-export.md` (the
   dialog).

Checked beyond the tests, in Chromium with SwiftShader (`tools/shot.ts` and a throwaway Playwright script): the panel
over the Outliner with thumbnails, its menu and the anchored delete prompt; a change on a variant giving it `◆ 1` and
the Outliner / Properties marks and the status bar; the param menu; the workspace grid (Final and Diffuse) and the
Changes dialog; the Export dialog, and an
export of two variants × two maps giving a zip of four PNGs (the variants' renders differ) and the project file with its
`variants` block. Not yet checked: the Windows GPU backend, Height cards, drag reordering, and a long
session's undo across switches by hand.

## Naming

_Base_ stays for the variant the others measure from (its badge, _Make base_), though the Outliner's _Base_ row already
means the base material: every other label names the base variant instead (_Reset to Dry_, _New variant from Dry_).
Match's _Variations_, whose name sat close to this feature's, has been removed (FR8.4).
