# FR5.4 — Presets

**Status:** done (v1)

## Goal
Starter projects that demonstrate both target styles and act as optimiser seeds.

## Plan
- Quake-style (64×64, tileable, Quake palette): riveted plate, stone bricks, cobblestones, tech panel with light strip.
- UI-style (non-tiling, ACES): forged button (Cinderforge keycap + ember underlight + glow), sunken well (chamfered
  notch), bevelled panel (alpha cut-out frame, recess, mirrored corner screws), ember gem.
- `src/presets/presets.test.ts` checks every preset only uses registered types and known param keys, so presets
  can't silently drift when a layer's params are renamed. `npx tsx tools/presets.ts` renders them all to a contact
  sheet for visual review.
- The presets are the Starters of the New project wizard (FR8.16; they used to be a File ▸ New from preset menu);
  presets are plain `Project` objects in `src/presets/`.

## Checklist
- [x] Preset plumbing + New-from-preset menu — File ▸ New from preset; first run opens Stone bricks
- [x] Quake: riveted metal
- [x] Quake: stone bricks
- [x] Quake: cobblestones
- [x] Quake: tech panel with emissive strip
- [x] UI: forged button
- [x] UI: sunken well
- [x] UI: bevelled panel
- [x] UI: ember gem (extra)
- [x] Nature: water caustics — the Liquid material with refracted light, Gerstner waves and an ocean blue-teal ramp
- [x] Preset param validation test + render-all tool
