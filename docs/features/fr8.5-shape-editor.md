# FR8.5 — Shape editor (hand-drawn shapes and areas)

**Status:** done — viewport overlay for Path layers (add a Path layer to draw)

## Goal
Draw shapes and areas by hand on the texture: cut-outs, panels, trims, decals, and masks for other layers.

## Design (`src/ui/components/ShapeEditor.vue`, mounted by `Viewport.vue`)
- Shown when the selected layer has a `points` polygon param (the Path generator). The layer's `points` text stays the
  source of truth (one polygon per line; px from the top-left, or fractions with Units = fraction).
- **Edit**: drag vertices — a press within 10 screen px of one grabs it, even over an edge or the fill; click an
  edge away from the vertices to insert one (and drag it); right-click (or double-click) a vertex to delete it; click
  a shape to select it (🗑 deletes it). **Polygon**: click to place vertices; Enter, double-click or the first vertex
  closes. **Freehand**: press and draw; the stroke is simplified (Ramer–Douglas–Peucker, loosened until it fits the
  64-vertex budget). Esc cancels / returns to Edit.
- Vertices snap to half pixels (Alt: free). Overlapping shapes cut holes (even–odd), as in the generator.
- A Path layer without shapes opens in Polygon mode. (The viewport's *Draw shape* button was removed: add a Path
  layer from the layer menu.)
- **Areas**: a Path layer with *Shape → Operator* set writes the shape register, so the layers above can clip to it
  (Mask → Clip inside / outside) — hand-drawn regions for paint, wear or stains.

## Checklist
- [x] Overlay, three modes, snapping, vertex budget, delete shape
- [x] Entry point: the Path layer (Draw shape button retired in FR8.14)
- [ ] Stamp bitmap painting on the viewport (pixel editor)
