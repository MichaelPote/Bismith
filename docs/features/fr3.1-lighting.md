# FR3.1 — Lighting

**Status:** done (v1)

## Goal

Global lighting as a project setting: sky light, ambient strength, and individually placed lights.

## Plan

- `project.lighting = { sky, ambient, lights[] }` (architecture §6).
- Sky: zenith and horizon colours + intensity, sampled by escaping BSDF rays. Or an environment image in their place
  (Sky light › Environment): an equirectangular panorama, its top row the zenith, turned by Rotation, × intensity — what
  metals reflect, coloured by direction. Any file loads (`core/environment.ts`): OpenEXR and Radiance HDR through
  three's loaders, Ultra HDR JPEGs with their gain map applied in full (scene-referred, not display-adapted as three's
  `UltraHDRLoader` does), plain PNG / JPEG / WebP as sRGB. Whatever came in is kept as a 512 px **Ultra HDR JPEG** (an
  SDR picture — the thumbnail — and a gain map, ISO 21496-1 / hdrgm, written with gainmap-js's JPEG assembler): tens of
  KB, so the browser and lighting presets keep it as an image like a Stamp's (`core/images.ts`: the project saves the
  file name). The tracer decodes it to half-float radiance. The built-in Studio, Overcast, Sunset and Workshop presets
  are painted as HDR by `npx tsx tools/env-presets.ts`, each with a light for its sun or key (a crisp shadow).
- **Floor or wall** (Sky light › Plane): a floor reads as a map — its top north, its right east, the zenith straight out
  of it. A wall is that floor stood up on its bottom edge: the camera looks north at it (east on its right), its face
  looks south at the horizon, the zenith is above its top and the ground below. Lights keep their directions relative to
  the texture.
- **The environment is importance-sampled** (`skySamplingTable` in `core/environment.ts`, `envSample` / `envPdf` in
  the tracer): each bounce also draws one sky direction in proportion to its brightness × sin θ (from a CDF table of the
  sky the plane faces; texels weighted by their brightest neighbour, as the sky is read bilinearly) and shadow-tests it as one
  more light in `directLight`'s loop (no second march to inline). Light and BRDF samples are combined by the power
  heuristic (MIS), so a small, very bright sun or lamp lights the scene from the first samples without fireflies; the
  first bounce's sky sample isn't firefly-clamped, so a strong sun keeps its energy. Checked: a uniform sky renders the
  albedo exactly, and old and new estimators converge to the same mean.
- **Only the sky the surface faces is drawn from.** A ray reaches the sky only going out of the plane (on a tiling
  height field anything heading into it hits the surface), so the table gives probability only to texels within about
  a texel's angle of that hemisphere: the upper half for a floor, the hemisphere in front of a wall — wherever the
  rotation turns the sky, so the table is rebuilt (≈ 4 ms at 512 × 256) when the plane or rotation changes; the HDR
  texture is kept. Draws that still miss (behind a pixel's own normal, or blocked by relief) are rejected, and MIS gives
  those directions to BRDF rays. With a bright sun behind a wall and a lamp in front, this halves the noise.
- Ambient: un-shadowed constant fill (colour × intensity) at the primary hit.
- Lights (≤ 8): directional (azimuth, elevation, angular radius for soft shadows) and point (x, y in user
  space, z height in px, radius for soft shadows, optional range). Inverse-square falloff (refDist / d)²: intensity 1
  lights a white surface to 1.0 at `refDist` px (default 64), which scales with the canvas like z, so a resize keeps
  point lights as bright. A light added in the editor starts fitted to the canvas (`fitLight`, core/pixelScale.ts):
  its px defaults (z 48, radius 6, refDist 64) are authored for a 128 px canvas and scale by √(w·h) / 128 — the
  resize factor, so it sits as high and lights as brightly relative to the texture at any size. Saved projects and
  presets keep their stored values. On a tileable texture a point light repeats with it: once its range passes half
  the texture, its copies in the tiles around (up to 2 out) light the pixel too, so there is no seam where the nearest
  copy changes. Each sample picks one copy by its unshadowed light (`directLight`, render/pathtracer.ts); the range is
  held within those tiles, and range 0 ends 2.5 textures out.
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
