# FR8.5 — Shape editor (hand-drawn shapes, lines and pipe runs)

**Status:** done — viewport tools in the Create workspace; every drawn shape is its own layer

## Goal
Draw shapes and areas by hand on the texture: cut-outs, panels, trims, decals, cables, pipe runs, and masks for other
layers — each drawn shape a layer in the layer list.

## Design (`src/ui/components/ShapeEditor.vue`, mounted by `Viewport.vue` in the Create workspace)
- **Tools** (a strip over the viewport; `editor.shapeTool`):
  - **Polygon**: click to place vertices; Enter, double-click or a click on the first vertex closes it → a **new Path
    layer** just after the selection, selected. **Freehand**: press and draw → a new Path layer (the stroke simplified
    by Ramer–Douglas–Peucker until it fits the 64-vertex budget).
  - **Line**: click to place points; Enter, double-click or a click on the last point ends it → a **new Polyline
    layer** (open polylines with a width, round or flat ends). With **Pipes** selected (the material, one of its
    layers or a bare Pipework layer) the tool reads *Pipe run* and adds a run to them instead — one Pipes entry holds
    many runs, so tees and crossings join; a random layout switches to drawn runs.
  - **Edit**: only the selected item's shapes — a Path's polygons, a Polyline's lines, the Pipes' runs: drag vertices
    (a press within 10 screen px grabs one), click an edge to insert one, right-click or double-click a vertex to
    delete it, click a shape to select it (🗑 deletes it when there are several). A shape can't be edited unless its
    layer (or material) is selected.
  - After a shape is drawn the tool returns to Edit with it selected. Esc cancels a draft / returns to Edit. Only the
    left button draws; the middle button still pans.
- Drafts are kept in texture px and converted to the destination's units when committed (new layers: px; Pipes:
  fractions of the texture). Vertices snap to half pixels (Alt: free).
- **Shape params**: `bitmap: 'points'` (closed polygons, even–odd holes) or `'lines'` (open polylines, two or more
  points; the packed "next" of a line's last vertex wraps and the shader skips that segment). The editor draws and
  edits a param by its kind. Fractions scale x by the width and y by the height (Path and Polyline alike — Path used
  to scale y by the width, which misplaced shapes on non-square textures).
- A material whose controls include a shape param (Pipes' *Runs*) is edited through that control, so every member
  layer follows.
- **Areas**: a Path layer writing the Shape mask (or a mask of its own name) lets later layers be limited to it —
  hand-drawn regions for paint, wear or stains.
- Tested in a headless browser (Playwright): polygon → Path layer, line → Polyline layer, two runs into a Pipes
  material shared by all its layers, vertex drag.

## Checklist
- [x] Tools, snapping, vertex budget, delete shape
- [x] One layer per drawn shape (Path / Polyline); pipe runs into the selected Pipes
- [x] Polyline layer (open polylines, width, round / flat ends)
- [ ] Stamp bitmap painting on the viewport (pixel editor)
