# FR1.2 — Project model, persistence & history

**Status:** done (v1)

## Goal

A single JSON-serialisable `Project` that fully describes a texture (see architecture §5), held in a Pinia store
with undo/redo and autosave.

## Plan

- `src/core/project.ts` — types for Project, Layer, LayerOutputs, Shaping, LayerMask, Lighting, Light,
  RenderSettings, PostFilter; factory functions with defaults (`createProject`, `createLayer(type)`,
  `createLight`, `createPostFilter`).
- `src/core/params.ts` — `ParamDef` model shared by layers and post filters; `defaultParams(defs)`.
- `src/core/color.ts` — hex ⇄ rgb, sRGB ⇄ linear, OKLab, HSV helpers.
- `src/core/serialize.ts` — `toJSON`, `fromJSON` with version migration and default-filling (unknown params
  dropped, missing params defaulted) so old files keep loading.
- `src/stores/project.ts` — Pinia store: project state, mutations (add/remove/move/duplicate layers, lights,
  post filters), selection-independent.
- `src/core/history.ts` — snapshot undo/redo (JSON strings, debounced commits while scrubbing, 200 entries).
- Autosave to `localStorage` (debounced); restore on load; "New project" resets.

## Checklist

- [x] Project/Layer/Lighting/Render/Post types + defaults
- [x] ParamDef model + defaults helper
- [x] Colour maths (sRGB/linear/OKLab/hex)
- [x] Serialise / deserialise with defaults + version field
- [x] Pinia project store with CRUD for layers, lights, post filters
- [x] Undo / redo (Ctrl+Z / Ctrl+Shift+Z), debounced while dragging
- [x] Autosave + restore from localStorage
- [x] Unit tests for colour maths and serialisation
