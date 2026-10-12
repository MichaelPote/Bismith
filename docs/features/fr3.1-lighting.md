# FR3.1 — Lighting

**Status:** done (v1)

## Goal
Global lighting as a project setting: sky light, ambient strength, and individually placed lights.

## Plan
- `project.lighting = { sky, ambient, lights[] }` (architecture §6).
- Sky: zenith and horizon colours + intensity, sampled by escaping BSDF rays.
- Ambient: un-shadowed constant fill (colour × intensity) at the primary hit.
- Lights (≤ 8): directional (azimuth, elevation, angular radius for soft shadows) and point (x, y in user
  space, z height in px, radius for soft shadows, optional range).
- Outliner "Lights" section: add / remove / enable / duplicate; properties panel per light.
- Viewport gizmos: drag point lights in x/y; directional azimuth indicator.
- Lighting presets: "Top-left key (UI)", "Overhead + sky", "Torch-lit (Quake)".

## Checklist
- [x] Lighting model + defaults
- [x] Sky + ambient settings UI
- [x] Directional lights
- [x] Point lights
- [x] Light list in outliner + properties
- [x] Draggable point-light gizmos — directional lights get an azimuth handle too
- [x] Lighting presets — UI key, Overhead, Torch-lit, Raking, Flat
