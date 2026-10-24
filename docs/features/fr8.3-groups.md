# FR8.3 — Groups and group presets (were smart materials)

**Status:** done — groups of layers in the Outliner, group presets in `presets/group/`, the add menu's _Presets_ tab.
Smart materials (recipes with macro controls) are retired.

## Goal

A good look (dressed stone, cobbles, hammered copper, rusty pipes, water + rust stains) takes 7–14 layers. Keep it
together as one item in the layer list, save it and reuse it — while every layer stays an ordinary, editable layer.

## What changed

Smart materials built their layers from code (`src/recipes/`, `RecipeDef.build(macros)`) and drove them with a few
macro controls. Every look was a second code path beside the presets, its controls rewrote member params behind the
user's back, and a look could only be made by writing a recipe. They are replaced by:

- **Groups** — a name over a block of layers, with no behaviour of their own beyond hiding and limiting.
- **Group presets** — ordinary preset files (FR5.4) holding a group and its layers. Each old recipe (and the pipe
  finishes, lava and water) became one, `presets/group/*.json`, in the categories Stone, Floors & walls, Nature,
  Liquids, Metal, Industrial and Tech.
- **Outputs to masks** (FR8.23) — recipes stacked the same generator several times to reach another of its Output
  modes; the group presets use one layer writing each output to its own mask, and paint layers limited to it.

## Design

- **Model** (`Project.groups`, `LayerGroup { id, name, members, limit?, enabled? }`, `src/core/project.ts`):
  `members` are layer ids in stack order, always one contiguous block (`gatherGroups` restores that after a move or a
  load). `limit` is a Limit to expression applied on top of each member's own (FR8.23); `enabled: false` hides the
  members (`hiddenByGroup`). The renderer knows nothing else about groups. Files with the old `materials` load as
  groups (members from the role map; recipe and macros dropped).
- **Operations** (`src/core/groups.ts`, wrapped by the project store): `addGroup`, `ungroup` (the layers stay; the
  group's limit moves onto them, a hidden group's layers are switched off), `deleteGroup`, `pruneGroups` (after a
  member is deleted), `setGroupLimit`, `renameMask` (writes, limits, sources and group limits).
- **Outliner**: a group is one collapsible row with its members under it (`layerUnits`); its menu has Ungroup and
  Delete. The add menu has two tabs: _New Layer_ (the layer grid, the default) and _Presets_ (group presets with
  thumbnails, by category). Adding a preset inserts its layers as a new group after the selection and selects it.
- **Properties › group card**: name, presets menu (apply / save, kind `group`), Shown, the member count, move up /
  down, Ungroup, Delete, the preset's description and the group's Mask limit.
- **Presets** (`src/presets/apply.ts`): `groupPresetLayers` fits the preset to the project (`resizeProject`), gives
  its layers fresh ids so one preset can go in twice, and stores its images. Applying a group preset to an existing
  group replaces its members in place; the group's name and limit are kept. Saving a group as a preset stores the
  group and its layers (`presetItemOf`).

## Checklist

- [x] `LayerGroup` model, loading old `materials`, group operations (`core.test.ts`, `masks.test.ts`)
- [x] Outliner group rows, Ungroup / Delete, the add menu's Presets tab
- [x] Properties group card with presets menu and mask limit
- [x] Recipes converted to `presets/group/*.json`; `src/recipes/` deleted
- [x] Duplicate output-mode layers collapsed into outputs to masks
