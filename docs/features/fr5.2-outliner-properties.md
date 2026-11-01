# FR5.2 — Outliner & properties

**Status:** done (v1)

## Goal

Blender-style editing: an outliner of everything in the project and a properties panel generated from
`ParamDef`s for whatever is selected.

## Plan

- Outliner sections: **Project settings** row (Canvas, Path tracer), **Layers** (top of list = top of stack, headed by
  the **Base** row: the base material), **Lights** (headed by the **Environment** row: lighting presets, sky light,
  ambient), **Post**.
- Rows: category-hued stroke icon, name (double-click to rename; cleared, a layer or light takes its type's name
  again), and after a renamed layer's or light's name its type, muted, in one column per list; eye toggle,
  drag-to-reorder; "+" add menus grouped by category. A row's right-click menu holds the same actions as the studs in
  its inspector heading — lock, move up / down, ungroup, duplicate, delete — from one list (`src/ui/itemActions.ts`,
  drawn by `ItemStuds.vue`), so the two stay in step; a light's adds Rename.
- Properties: header with name + type; collapsible `PanelCard`s: Parameters (grouped by `ParamDef.group`),
  Shaping, Mask, and one card per channel output (Diffuse, Opacity, Height, Roughness, Emissive) each with an
  enable checkbox in its header.
- Project properties: name, size (presets 16…1024 + custom, non-square), tileable, height depth, seed,
  base colour/roughness, render settings.
- `showIf` support for conditional params.

## Checklist

- [x] Outliner sections + selection
- [x] Add-layer / add-light / add-post menus
- [x] Reorder (drag + move up/down), duplicate, delete, rename, enable
- [x] Right-click menu on layer and material rows (selects the row; Delete) — DropMenu `placement="pointer"`
- [x] Mask lane left of the icons (FR8.23): a line from each layer (or material) with a Limit to up to the layers that
      wrote the masks it reads, one colour per mask; links to one writer's mask share a trunk (`maskLinks`, masks.ts)
- [x] Properties generated from ParamDefs with groups + showIf
- [x] Channel output cards
- [x] Project + render settings panel
