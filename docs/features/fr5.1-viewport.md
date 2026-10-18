# FR5.1 — Viewport

**Status:** done (v1)

## Goal
The centre view of the editor: inspect the final render or any channel, zoom to pixels, preview tiling and
place lights.

## Plan
- Display pass: draws the chosen buffer into the canvas with zoom / pan (nearest-neighbour), sRGB encode,
  alpha checkerboard, optional 5×5 tile preview and pixel grid at high zoom.
- Channel selector: Final · Diffuse · Height · Roughness · Normal · Emissive · Opacity · Masks (`0`: a picker for
  any mask the stack writes, and rename).
- Mouse: wheel zoom about cursor, middle/space-drag pan, double-click to fit, `1` = 100 %, `F` = fit.
- Overlay toolbar (Cinderforge viewport header): view name, resolution, sample count, toggles (tile, grid,
  checker), FPS-style readout of samples.
- Light gizmos (draggable point lights, directional indicator), shown only for the selected light; cursor readout
  (px, height value).
- Layer gizmos (Create workspace, the selected layer only; geometry in `src/ui/gizmos.ts`, drawn by
  `LayerGizmo.vue`). Each handle sets the layer's own placement sliders; Ctrl (⌘) snaps angles to 15° and the move
  dot to half pixels.
  - Rectangle, Ellipse, Polygon / Star, Cross, Rosette, Glyph: a move dot (X / Y) and a rotation knob above it
    (Rotation). With repeats, it sits on the top-left instance; Shaping › Offset moves it with the pattern.
  - Stamp, Label: the same, with the knob setting Angle on top of the quarter turns.
  - Line, Curve: the two ends (X / Y, Rotation and Length follow, the other end staying put) and a move dot.
  - Gradient: a move dot for its centre, and an arrow for its Angle.
  - Symmetry: the fold centre of the top-left cell, and its axis (Angle).
  - Cable: its centre line, dragged across itself (Position), and a knob along it (Angle, from its axis).

  Size handles are still to come.

## Checklist
- [x] Display pass with zoom / pan / nearest
- [x] Channel views
- [x] Tile preview 5×5 (copies undimmed)
- [x] Pixel grid at high zoom (off by default; G toggles it)
- [x] Alpha checkerboard
- [x] Viewport header toolbar + readouts
- [x] Light gizmos (selected light only)
- [x] Layer gizmos: move / rotate / line ends (Create workspace, selected layer)
- [x] Cursor readout — texel coordinates plus colour, height, roughness, emissive and the viewed mask's distance (Shape unless the Masks view picks another) under the cursor
