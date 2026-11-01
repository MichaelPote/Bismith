# FR5.3 — Export & project files

**Status:** done (v1)

## Goal

Get textures out (final image and every map) and projects in and out.

## Plan

- Export final (post-processed) PNG at native size, with an optional integer upscale (nearest) for sharing
  pixel art.
- Export maps: diffuse (+alpha), height (8-bit, normalised), roughness, normal (GL / DX), emissive.
- Save / open project JSON (`.bismith.json`), drag-and-drop to open. Save project opens the browser's Save As dialog
  where it has one (`showSaveFilePicker`: Chrome, Edge); Firefox and Safari give pages no such dialog, so there it
  downloads, and asks where only with _Always ask you where to save files_ turned on.
- Copy final image to clipboard.
- **Export dialog** (FR10): Export… (the top bar's primary key; `Ctrl+E`, shown in its tooltip) picks variants and maps; each variant renders
  once at export quality; one file downloads as a PNG, more as a zip with the project file. The File menu keeps the
  direct exports of the variant shown.

## Checklist

- [x] Final PNG export (+ upscale)
- [x] Individual map exports — all maps + project bundled in one zip
- [x] Save / open project JSON
- [x] Drag-and-drop open
- [x] Copy to clipboard
