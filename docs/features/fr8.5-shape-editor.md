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
  - **Grab** (first, and the tool a shape layer starts in when it is selected): everything Select does except the
    marquee — a left-drag off the vertices and edges pans the view as usual, a click there clears the vertex selection
    (Shift-click on a vertex still adds to it), and a press on a shape's area selects that shape and pans.
  - **Select**: only the selected item's shapes — a Path's polygons, a Polyline's lines, the Pipework layer's runs, the
    placed splats (deleting a splat's last point removes it). Click a vertex (a press within 10 screen px grabs one) or
    drag a marquee from empty space or a shape's area to select vertices (Shift adds to the selection); dragging a
    selected vertex carries every selected one along by the same amount (only the grabbed one snaps), dragging another
    selects it alone (with Shift it joins the selection but moves alone, since Shift also snaps). Click an edge (an
    18 px wide band) to insert a vertex, right-click a vertex or press Delete / Backspace to remove the selected ones
    (not the layer), click a shape to select it (🗑 deletes it when there are several). A closed polygon also has a
    dot on its area centroid: dragging it moves the whole polygon, in half pixels (Alt: free), so its shape never
    changes; a vertex nearer the press than the dot is grabbed instead. A shape can't be edited unless its layer is
    selected. In Select, left-drag on the viewport draws the marquee (the middle button pans).
  - **Double-click** anywhere in Grab or Select (on a vertex, an edge or empty space) starts a new shape there with the tool
    the layer's shapes take — Line (or the layer's own: Pipe run, Splats) for open lines, Polygon for polygons. On a
    vertex it starts exactly on it, so a run can tee off another; on an edge, the vertex the first click inserted is
    taken back.
  - A layer with its own drawing (`shapeEdit.adds`: Pipe run, Splats) shows only that tool beside Select: Polygon and
    Freehand, which would make new Path layers, are hidden.
  - After a shape is drawn the tool returns to Grab or Select, whichever was used last, with it selected. Esc cancels a
    draft / returns there; Backspace or a right-click removes the draft's last point, and a right-click with none
    placed returns there.
    Only the left button draws; the middle button still pans.
  - **A hint bar** at the top of the viewport says, while a drawing tool is active, what to do next and how to finish:
    how many points are placed (and the minimum), click the first vertex / last point, double-click or Enter, Esc.
- Drafts are kept in texture px and converted to the destination's units when committed (new layers: px; Pipework:
  fractions of the texture). Vertices — dragged, or placed while drawing (the ghost under the pointer shows where) —
  snap to half pixels (Alt: free). **Ctrl** (⌘) holds one to the nearest of the vertical and horizontal lines through
  its neighbours (the previous and next vertex; while drawing, the last placed and, for a polygon, the first), shown
  as dashed guides; within 8 screen px of a line across it, it goes to their crossing. A vertex whose neighbours are
  all moving with it uses the lines through where it was taken. **Shift** snaps to every tenth pixel; with Ctrl, it
  steps by ten along the line. The **snap toggle** (magnet, after 🗑) swaps Shift: on, vertices always snap to the
  10 px grid and Shift frees them (`editor.shapeSnap`). Pressing or releasing a modifier applies at once
  (`snapVertex` in `src/ui/gizmos.ts`).
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
