# FR8.14 — One layer list, inspector fields and Forged keys

**Status:** done — single Layers list with Diffuse / Height columns, materials as collapsible blocks, field
behaviours, tooltips, Forged keys v2

## Goal
A UI pass after daily use: the split into Materials, Paint and Relief sections didn't match how a texture is built,
fields lacked the small conveniences of a Blender-style editor (snap, reset, wheel), and the main buttons still used
the old ember-underline styling instead of Cinderforge's Forged keys v2.

## Design
- **One layer list.** `project.relief` is gone: `project.layers` is the whole stack in evaluation order (first =
  earliest). A "relief" layer is simply one with its colour outputs off. The relief → paint reset pass is removed.
  - *Migration* (`normalizeProject`): a legacy relief stack leads the list with its colour toggles unticked
    (`reliefOnly`: dif_on / op_on / e_on, blur's diffuse / emissive / opacity), which reproduces the old reset for
    everything but a colour-only filter placed in the relief stack (Diffuse adjust, Cavity, Glass) — none of the
    recipes, templates or recreations do that. All 66 recreations render pixel-identically.
  - Templates and recipes still tag layers `relief` / `paint`; relief ones go first (with colour off).
- **Materials are blocks.** A smart material's members sit together (`groupMaterials`, gathered where the last
  member is, so colour layers keep their order when legacy projects merge). `layerUnits()` splits the list into
  free layers and material blocks; the store moves units (`moveUnit`), members within their block (`moveMember`)
  and steps either (`stepLayer`). New layers and materials go just after the selection, never inside another block;
  a duplicated member lands after its block as a free layer. `SmartMaterial.enabled = false` hides a whole material
  without touching its members' own on/off states.
- **Outliner**: Project (size @ supersample) · Layers · Lighting · Post. Layers top to bottom = applied first to
  last. Material rows collapse (closed when added; opened when a member is selected). Columns: **Diffuse** and
  **Height** — `LayerDef.channels` names the tick a filter has for each (blur: `diffuse` / `height`, etch:
  `dif_on`) or `true` when it always affects it; generators use `dif_on` / `h_on`. Clicking a mark flips the same
  tick as the inspector. The optimiser lock moved to the inspector toolbar. Rows aren't text-selectable.
- **Project node** holds Texture, Base material, Lighting presets, Sky, Ambient and Path tracer (the World & render
  node and the Base material row are gone). Supersample defaults to 1.
- **Fields**: number fields — Ctrl-drag snaps to whole numbers, Ctrl + arrow steps to the next whole number,
  double-click returns to the value before the last change (again to come back; the default when unchanged),
  remembered per owner and key across reselection. Dropdowns step with the wheel or arrow keys (a wheel that is
  scrolling the panel keeps scrolling). Labels have Tippy.js tooltips: hint, option meanings, key and default.
- **Channel outputs**: Source · Mode share one row; Source reads *Pattern / Solid / Random* (was *Pattern value /
  Flat (1.0) / Per-feature random*); roughness and specular *At 0 / At 1* are one grey **Ramp** (`RampField`: drag
  the gems or type; ⇄ swaps). Joins are declared on the ParamDef (`join: { with, as: 'pair' | 'ramp', label }`).
- **Icons**: Tabler (`@tabler/icons-vue`, MIT) behind `Icon.vue`'s own names, so call sites keep `name="eye"`; layer
  types and recipes have their own icons (`ui/meta.ts`, `RecipeDef.icon`).
- **Base row**: the first row of the Layers list (the material under every layer) carries the Diffuse / Height column
  heads; selecting it opens the project panel (selection kind `base`).
- **No automatic linking**: editing a layer never changes another; new layers get a seed no other layer has.
- **Forged keys v2** (`.fk` in base.css: lip + face, lit / latched / primary, `.fk-rail`, `.kc` keycap chips): the
  workspace switcher (*Create* / *Match*) and channel tabs are rails of keys without a tray, one lit; viewport overlays are latched toggle keys with a
  pilot lamp; Export and Optimise are primary keys; menu-bar items are plates with an Ember 400 underline when open;
  icon buttons are studs. Channel keys shrink (ellipsis) instead of scrolling.

## Checklist
- [x] Single list: model, migration, pipeline, engine key, store ops, recipes, optimiser / heuristics / templates
- [x] Regression: recreations identical; single-material recipe projects identical or within 0.4 / 255 mean, two
      materials within 3 / 255 (a material's relief now lands just before its own paint, after free and earlier
      layers' height, instead of before all paint)
- [x] Outliner: units, collapsible materials, Diffuse / Height columns, drag rules, material eye
- [x] Inspector: lock in the toolbar, move up / down by list order, project node with world and render
- [x] Fields: Ctrl snap, double-click previous, dropdown wheel / arrows, tooltips, Source · Mode, ramps
- [x] Forged keys: top bar, viewport header, Match workspace, menu plates, studs
- [x] Tabler icons; Base row; no linking; Lights; stronger selection; no key trays; Create workspace
- [x] Path editor: Draw shape button removed, 10 px vertex grab, right-click deletes a vertex
