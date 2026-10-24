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
    layer** (open polylines with a width, round or flat ends). With a **Pipework** layer selected the tool reads _Pipe run_ and adds a run to it instead — one Pipework layer holds
    many runs, so tees and crossings join; a random layout switches to drawn runs. With a **Liquid splats** layer
    selected it reads _Splats_ and puts a splat on every point placed (a single click and Enter is one splat); a random
    layout switches to Placed by hand. A shape param with `shapeEdit.dots` (Splats' points) is drawn as separate dots,
    with no lines between them, in the draft and in Edit, and a click on the last point places another instead of
    finishing.
  - **Edit**: only the selected item's shapes — a Path's polygons, a Polyline's lines, the Pipework layer's runs, the placed
    splats (deleting a splat's last point removes it): drag vertices
    (a press within 10 screen px grabs one), click an edge to insert one, right-click or double-click a vertex to
    delete it, click a shape to select it (🗑 deletes it when there are several). A shape can't be edited unless its
    layer is selected.
  - After a shape is drawn the tool returns to Edit with it selected. Esc cancels a draft / returns to Edit; Backspace
    removes the draft's last point. Only the left button draws; the middle button still pans.
  - **A hint bar** at the top of the viewport says, while a drawing tool is active, what to do next and how to finish:
    how many points are placed (and the minimum), click the first vertex / last point, double-click or Enter, Esc.
- Drafts are kept in texture px and converted to the destination's units when committed (new layers: px; Pipework:
  fractions of the texture). Vertices snap to half pixels (Alt: free).
- **Shape params**: `bitmap: 'points'` (closed polygons, even–odd holes) or `'lines'` (open polylines, two or more
  points; the packed "next" of a line's last vertex wraps and the shader skips that segment). The editor draws and
  edits a param by its kind. Fractions scale x by the width and y by the height (Path and Polyline alike — Path used
  to scale y by the width, which misplaced shapes on non-square textures).
- **Areas**: a Path layer writing the Shape mask (or a mask of its own name) lets later layers be limited to it —
  hand-drawn regions for paint, wear or stains.
- Tested in a headless browser (Playwright): polygon → Path layer, line → Polyline layer, two runs into one
  Pipework layer, vertex drag.

## Checklist

- [x] Tools, snapping, vertex budget, delete shape
- [x] One layer per drawn shape (Path / Polyline); pipe runs into the selected Pipework layer
- [x] Polyline layer (open polylines, width, round / flat ends)
- [ ] Stamp bitmap painting on the viewport (pixel editor)
