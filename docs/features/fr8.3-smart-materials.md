# FR8.3 — Smart materials (recipes as a handful of controls)

**Status:** done — Outliner *Materials* section, Properties macro cards, linked copies in the editor

## Goal
A good look (dressed stone, cobbles, hammered copper, brushed metal, water + rust stains) takes 7–14 layers across the
relief and paint stacks. Consolidate each into a few macro controls — while the original layers stay available and
editable.

## Design
- **Model** (`Project.materials`, `SmartMaterial`): recipe id, macro values, and role → member layer id. Members are
  ordinary layers in either stack (the outliner shows them as one collapsible row; added from the Smart materials row
  of the add-layer grid); the renderer knows nothing of materials.
- **Recipes** (`src/recipes/`): `RecipeDef { params (macros, grouped), groups, build(macros, size) → role-tagged
  layers, render? }`. Built from the hand-authoring lessons: Stone wall (dressed → rubble via *Irregularity*),
  Cobblestones, Hammered metal, Brushed metal, Water & rust stains (scattered or *Start at ledges*).
- **Macro edits** (`setMacro`): build the recipe with the old and the new macros and write every member param (and
  on/off state) whose built value changed — so a control rewrites exactly what it governs and nothing else; the
  user's own edits to other params survive. Controls at 0 switch their layers off (chips, moss, pits …).
- Adding raises the render settings a look relies on (AO, specular tint); never lowers them.
- **Unpack** drops the record and keeps the layers; **Delete** removes both. Deleting a member prunes it.
- ~~Linked copies~~ (retired in FR8.14): the editor no longer edits same-type, same-seed layers together — each layer
  is edited on its own. Only the optimiser still ties their pattern params into one search entry (`src/core/links.ts`).

## Checklist
- [x] Model + normaliser, recipes, setMacro / unpack / delete / prune (`recipes.test.ts`)
- [x] Linked copies in the store, Unlink, outliner and properties marks (removed again in FR8.14)
- [x] Outliner Materials section + add menu; Properties macro cards + member list
- [ ] Build the emulation templates from the recipes (so emulated results come with macro controls)
- [ ] More recipes (rock, planks, panels with rivets)
