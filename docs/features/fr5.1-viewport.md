# FR5.1 — Viewport

**Status:** done (v1)

## Goal
The centre view of the editor: inspect the final render or any channel, zoom to pixels, preview tiling and
place lights.

## Plan
- Display pass: draws the chosen buffer into the canvas with zoom / pan (nearest-neighbour), sRGB encode,
  alpha checkerboard, optional 5×5 tile preview and pixel grid at high zoom.
- Channel selector: Final · Diffuse · Height · Roughness · Normal · Emissive · Opacity · Shape register.
- Mouse: wheel zoom about cursor, middle/space-drag pan, double-click to fit, `1` = 100 %, `F` = fit.
- Overlay toolbar (Cinderforge viewport header): view name, resolution, sample count, toggles (tile, grid,
  checker), FPS-style readout of samples.
- Light gizmos (draggable point lights, directional indicator), cursor readout (px, height value).

## Checklist
- [x] Display pass with zoom / pan / nearest
- [x] Channel views
- [x] Tile preview 5×5 (copies undimmed)
- [x] Pixel grid at high zoom (off by default; G toggles it)
- [x] Alpha checkerboard
- [x] Viewport header toolbar + readouts
- [x] Light gizmos
- [x] Cursor readout — texel coordinates plus colour, height, roughness, emissive and SDF value under the cursor
