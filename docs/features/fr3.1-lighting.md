# FR3.1 — Lighting

**Status:** done (v1)

## Goal

Global lighting as a project setting: sky light, ambient strength, and individually placed lights.

## Plan

- `project.lighting = { sky, ambient, lights[] }` (architecture §6).
- Sky: zenith and horizon colours + intensity, sampled by escaping BSDF rays.
- Ambient: un-shadowed constant fill (colour × intensity) at the primary hit.
- Lights (≤ 8): directional (azimuth, elevation, angular radius for soft shadows) and point (x, y in user
  space, z height in px, radius for soft shadows, optional range). Inverse-square falloff (refDist / d)²: intensity 1
  lights a white surface to 1.0 at `refDist` px (default 64), which scales with the canvas like z, so a resize keeps
  point lights as bright. A light added in the editor starts fitted to the canvas (`fitLight`, core/pixelScale.ts):
  its px defaults (z 48, radius 6, refDist 64) are authored for a 128 px canvas and scale by √(w·h) / 128 — the
  resize factor, so it sits as high and lights as brightly relative to the texture at any size. Saved projects and
  presets keep their stored values.
- Outliner "Lights" section: add / remove / enable / duplicate; properties panel per light.
- Viewport gizmos: drag point lights in x/y; directional azimuth indicator.
- Lighting presets: "Top-left key (UI)", "Overhead + sky", "Torch-lit (Quake)".

## Checklist

- [x] Lighting model + defaults
- [x] Sky + ambient settings UI
- [x] Directional lights
- [x] Point lights
- [x] Light list in outliner + properties
- [x] Draggable point-light gizmos — directional lights get a handle too, on a sky map about the texture centre: the
      angle is the azimuth, the distance the elevation (linear: 90° at the centre, 0° on a horizon ring just outside the
      texture). Dragging it sets the azimuth; Shift-drag puts it under the cursor (elevation too); Ctrl (⌘) snaps both
      to 15° steps
- [x] Lighting presets — UI key, Overhead, Torch-lit, Raking, Flat
