# FR5.2 — Outliner & properties

**Status:** done (v1)

## Goal

Blender-style editing: an outliner of everything in the project and a properties panel generated from
`ParamDef`s for whatever is selected.

## Plan

- Outliner sections: **Project** row, **Layers** (top of list = top of stack), **Lights**, **Post**.
- Rows: category-hued stroke icon, name (double-click to rename), eye toggle, lock, drag-to-reorder,
  context actions (duplicate, delete); "+" add menus grouped by category.
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
