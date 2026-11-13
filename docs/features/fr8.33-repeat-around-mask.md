# FR8.33 — One Repeat, on a grid or around a mask

**Status:** built (2026-11-13): every Repeat family on the shared Repeat, the outline side behind `MASK_REPEAT`. Open:
compile times re-measured on a quiet GPU, the readback timed in the editor.

## Goal

1. Every layer with a Repeat card can also place its instances **along the outline of a mask**, or along the texture's
   edges, instead of on a grid. Example: a Path writes the mask _Plate_; a Bolts / Rivets layer set to _Around a mask ›
   Plate_ puts rivets round the plate, 6 px in from its edge, one at every corner and two along each side. The same works
   for squares, stars, rosettes, glyphs, stamps, short lines (stitching), tabs and notches.
2. **One Repeat implementation** for all of them. Today shapes, motifs, Stamp / Label, Path and Tabs & notches each have
   their own instancing loop, with their own per-instance jitter, rotation, size, drop-out and hashing (Tabs also has its own
   edge finder). They move onto one shared GLSL instance source and one shared set of Repeat params, and the outline
   placement is written once, inside it.

Shapes come first (Rectangle, Bolts / Rivets, Polygon / Star, Line, Curve, Cross); Rosette, Glyph / Sigil, Stamp, Label,
Path and Tabs & notches follow on the same code.

## The Repeat card

A first row picks the layout:

**Place:** _Grid_ (default) · _Around a mask_ · _Along the texture edges_. `rep_place`, `optimize: false` (structural).
The texture edges are an outline like a mask's: the canvas's four sides, with its corners. A mask that is empty where the
layer reads it also falls back to the texture edges, as Tabs does today, so the layer never silently shows nothing.

### Grid rows (Place › Grid)

Each family keeps its own way of laying out the grid, because they mean different things:

- **Shapes, Rosette, Glyph, Tabs**: Columns, Rows (cells across the texture), Column / Row spacing, Row offset (every other
  row), Mirror odd columns / rows. Tabs' _Scattered_ placement becomes a grid with Position jitter and Drop out.
- **Stamp, Label**: Repeat X / Y, Spacing by Step or Gap, Step / Gap X / Y, Row shift (each row a step further), as now.
- **Path**: Repeat X / Y, Step X / Y, as now.

### Outline rows (Place › Around a mask, Along the texture edges)

| Param                     | Key            | Type                                                                      | Notes                                                                                                                                                                                                                                                               |
| ------------------------- | -------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mask**                  | `rep_mask`     | mask name (`mask: 'read'`)                                                | Around a mask: the mask whose outline it follows, as the layers before this one left it. Default _Shape_.                                                                                                                                                           |
| **Spread over**           | `rep_along`    | enum: _Each outline_ (default), _Each side_                               | Each outline: the instances go round every separate outline of the mask (each piece, each hole). Each side: they go along every straight side, corner to corner.                                                                                                    |
| **Count**                 | `rep_count_by` | enum: _Repeats_ (default), _Spacing_                                      | Repeats: a fixed number on each outline or side. Spacing: one about every Spacing px, so long outlines and sides get more.                                                                                                                                          |
| **Repeats**               | `rep_n`        | int 1…1024 (slider to 64), default 8                                      | On each outline, or each side. On a side from its corner: 1 = the corners only, 2 = corners and middles, 3 = corners and thirds…                                                                                                                                    |
| **Spacing**               | `rep_space`    | float px, 1…4096 (slider to 256), default 16, `unit: 'px'`                | A whole number of instances per outline or side, `round(L / spacing)`, spaced to fit evenly. An outline shorter than half a step gets none, so specks drop out on their own.                                                                                        |
| **Corners**               | `rep_corners`  | enum: _On the corners_ (default), _Clear of the corners_                  | Each side. On: every corner gets one, the rest at k/N of the way to the next corner. Clear: the instances are centred on each side ((k + ½)/N of it), kept Corner clearance px from its ends; short sides get fewer, or none.                                       |
| **Corner clearance**      | `rep_clear`    | float px, 0…1024 (slider to 64), default 6, `unit: 'px'`                  | Clear of the corners: how far from the ends of a side the instances stay, on top of what their own shape needs (Tabs works that out per shape).                                                                                                                     |
| **Corner angle**          | `rep_corner`   | float °, 5…150, default 30                                                | Each side: how sharply the outline must turn to count as a corner. 30° catches every polygon up to twelve sides.                                                                                                                                                    |
| **Rounded corners up to** | `rep_round`    | float px, 0…1024 (slider to 64), default 16, `unit: 'px'`                 | Each side: a corner rounded up to this radius still counts as one corner, with its instance in the middle of the bend. Rounder bends are part of a curved side.                                                                                                     |
| **Edges**                 | `rep_faces`    | enum: All (default), Left + right, Top + bottom, Left, Right, Top, Bottom | Keeps only the sides (or, on Each outline, the instances) facing these ways: rivets along the top and bottom of a plate only. From Tabs.                                                                                                                            |
| **Offset**                | `rep_off`      | float px, −4096…4096 (slider ±128), default 0, `unit: 'px'`               | How far from the edge: + outside, − inside. The instances follow the outline offset by this much: round a corner outside, a smaller loop inside. A loop that vanishes (too far inside a narrow piece) gets no instances. Tabs keeps its own Side and Inset instead. |
| **Follow the edge**       | `rep_follow`   | bool, default on                                                          | Turns each instance to the edge's direction; Rotation (Placement) adds to it. Off: every instance keeps Rotation. (Tabs always follow.)                                                                                                                             |
| **Shift along**           | `rep_shift`    | float −1…1, default 0                                                     | Slides every instance along by this share of its step, e.g. off the corners.                                                                                                                                                                                        |

Placement's X / Y are hidden on an outline.

### Shared variation rows (every layout, every family)

Position jitter, Rotation variation (with Rotation steps and Flip at random), Size variation (with _Scale the bevel too_
where the type has a bevel span), Drop out, Seed. Shapes have all of these today. The others gain what they lack: Stamp /
Label have only Jitter and Missing repeats, Path none, and Tabs' come over from its own rows. Stamp / Label keep their
_Random per_ rows; Tabs keeps _Flip every other_.

Key renames that come with sharing: Stamp / Label `jitter` → `rep_jitter`, `drop` → `rep_drop`; Tabs `place` → `rep_place`,
`count` / `rows` → `rep_x` / `rep_y` (grid) and `rep_n` (edges), `distribute` → `rep_count_by`, `spacing` → `rep_space`,
`clearance` → `rep_clear`, `edges` → `rep_faces`, `offset` → `rep_shift`, `rot_jitter` → `rep_rot`, `size_var` →
`rep_scale`, `drop` → `rep_drop`, `jitter` → `rep_jit`. The family grid keys stay as they are (`rep_x` means cells across the
texture on shapes but copies a step apart on Path, so they shouldn't share a meaning). Presets and tests that set a renamed
key are updated. Old saved files still load; a renamed value falls back to its default (AGENTS.md › Nothing is released
yet).

## Orientation and order

- With Follow the edge on, instances run clockwise on screen around each piece (anticlockwise around holes). Each one's
  local "up" points **away from the mask** and its local x runs along the edge. So along a top edge an instance looks as it
  does at Rotation 0; a Polygon / Star's point faces outward (teeth); a Line lies along the edge (dashes, stitching);
  Rotation 90° turns lines across it (ticks). Tabs' Side picks whether its elements reach into the mask or out of it.
- **Each outline:** on a closed outline the first instance sits at its topmost point (leftmost of ties), so a rectangle's
  outline at Offset 0 starts on its top-left corner. An outline with corners starts at its first corner from there instead,
  so 4 repeats on a square land on its corners.
- **Each side:** as Corners says. An outline with no corners (a circle, a blob) counts as one side starting at its topmost
  point, and its instances go evenly round it.
- **Outlines cut off by the canvas** (no tiling) are open runs: Each outline spreads over the run with half a step free at
  each end; on Each side the piece between the cut and its first corner is a side of its own, with no instance at the cut.
- **Tiling:** outlines that cross the canvas edge carry on round the other side as one outline.

## How it works

### 1. Find the outline and place the instances — shared `prepare`

1. The source mask comes through `maskSource` (`(p) => p.rep_place === 'mask' ? p.rep_mask || 'Shape' : null`), so the
   pipeline binds its version before this layer, and says whether its distance is exact (only shapes wrote it).
2. Exact: its distance is used as it is. Not exact (noise cutoffs, Mask area, other coverage writers): jump flood from its
   coverage first (`jumpFlood`, as Bevel / Etch do), with `maxDistance` covering |Offset|.
3. A small pass packs `d − Offset` of four neighbouring texels into one float texel (a quarter-width target), clamped to
   ±2 px with a code for "empty", and that is read back (`gpu.readTexture`): 1 MB at 512², 4 MB at 1024². Texture edges
   need no readback: the outline is the canvas rectangle.
4. **Trace** (pure TS, new `src/layers/outline.ts`): marching squares on the zero crossing, with interpolated sub-pixel
   points, saddles split by the cell's middle, and wrapping cells when tiling. Segments are linked into closed loops and
   open runs, oriented so the inside is always on the same side.
5. **Corners** (Each side, and the start of Each outline): the outline's turning, smoothed over about 1 px. Wherever it
   bends more tightly than radius `Rounded corners up to + |Offset|` (offsetting turns a sharp corner into an arc of radius
   |Offset|), the samples form a bend. A bend that turns at least Corner angle in all is a corner, placed where the
   direction is halfway between the two sides'. That is the vertex of a sharp corner and the middle of a rounded one.
   Gentler bends (jump-flood wobble, a slight kink) are ignored. A bend that covers a whole loop (a small circle) means no
   corners.
6. **Place**: arc-length positions by the rules above, then Edges keeps those facing the chosen ways. The tangent is
   averaged over ±min(2 px, step / 4), so wobble and corners don't jerk the angle (at a sharp corner it takes the
   bisector). Each instance keeps its position, edge angle, step, index, outline and the parity of its index. At most 4096
   instances in all; the Repeats and Spacing hints say so.
7. **Bucket** them for the shader: a grid of buckets about one step wide (at least 8 px; whole buckets across a tiling
   canvas), the instances sorted by bucket, and a bucket table of (first, count). They go up as float `DataTexture`s
   (`t_rep_inst`, `t_rep_bucket`) with a header texel (counts, bucket size, the largest step).

A family can add to a side's clearance and cap its count (Tabs: what its shape needs to clear a corner, and how many of its
Length fit). The CPU trace is cached by a hash of the read-back pixels and the params it uses, so a colour or Height slider
doesn't redo it. The readback itself happens on every evaluation of a layer around a mask. It is a sync stall, so I'll
measure it on the Windows GPU, and if it shows I'll also skip it when nothing before the layer has changed.

### 2. One instance source in GLSL — new `src/layers/glsl/repeat.ts`

```glsl
// What a family says about its grid (from its own grid params) before the loop: counts, step, centre, odd-row offset,
// per-row shift, mirrors, X / Y within a step, Rotation, jitter (px and share of a step).
struct RepFrame { ivec2 n; vec2 pitch; vec2 centre; float stagger; float skew; bvec2 mirror; vec2 off; float rot; vec2 jitPx; float jitStep; };
// One candidate instance: id (for hashing), centre (near the pixel, round the torus), its total turn (clockwise °), size,
// random flips, its own random, kept (not dropped, not an empty step), its step (sizes cells), on an outline, odd index.
struct RepInst { ivec2 id; vec2 centre; float ang; float scale; bvec2 flip; float rnd; bool kept; vec2 cell; bool edge; bool odd; };
RepSrc repBegin(vec2 p, RepFrame f, float reach);   // the candidates that can reach p: grid cells or outline buckets
int repIters(RepSrc s);                             // the loop's bound
RepInst repNext(inout RepSrc s);                    // the next candidate (outline: some steps only enter a bucket)
```

- The grid side is today's `repGrid` / `repAt` walk, fed by the family's frame. Odd-row shifts, mirrors, jitter, rotation
  variation and steps, flips, size variation, drop-out and the instance random are worked out here, once, with the hash
  offsets Shapes use today, so shapes render as before and the other families shift a little (allowed: nothing is
  released).
- The outline side walks the instances in the buckets the pixel's reach covers: one flat loop whose bound is the buckets
  plus their instances (counted first), with no nested loops and no `continue`. Positions are taken round the torus with
  `wrapDelta` when tiling. The instance's cell is a square one step wide (it sizes _Inset from edges_ rectangles and the
  like).
- Each family's loop becomes `for (k < repIters(s)) { RepInst it = repNext(s); if (it.kept) { …its own distance… } }`. Its
  own distance code (`shapeSdf`, `motifSdf`, the stamp lookup, `pathSdf`, `tb_shape`) still exists once in the shader
  (AGENTS.md › compile time). Motifs keep their bounding-circle pruning, their glow taps and their extra pass for Bevel
  aspect. Stamp and Path, whose Angle is per layer today, take the angle per instance (Stamp's `ca`/`sa`, `turned` and
  bevel-aspect `Mb` move into the loop). Tabs' edge finder (the foot and run passes in its `prepare`, and the per-pixel side
  walk) goes; its elements sit on the shared outline instances.
- The outline side sits behind a **shader variant**: `shaderFeatures: (p) => p.rep_place !== 'grid' ? ['MASK_REPEAT'] : []`.
  A layer on the grid compiles without it, and the first switch to an outline compiles the variant (in the background, as
  Bevel aspect's does). Tabs defaults to an outline, so its default compile carries it.

### 3. Params, units, UI

- One builder, `repeatParams({ grid, jitter, scaleHint, outline, after })` in a new `src/layers/repeat.ts`. `grid` is the
  family's grid rows (shapes', motifs' and Tabs' are the current shape ones; Stamp's and Path's move out of their files
  into it), `outline` turns off rows a family doesn't use (Tabs: Offset, Follow the edge). It adds Place, the outline rows
  and the shared variation rows, with the `showIf`s that hide each layout's rows under the other.
- Each family's LayerDef gets the shared `prepare`, `maskSource`, `shaderFeatures` and `textures` from one helper
  (`withRepeat(def, hooks)`), so a new Repeat generator needs nothing else. Its hooks: a family's extra corner clearance
  and count cap (Tabs).
- Pixel scaling: `rep_off`, `rep_space`, `rep_clear`, `rep_round` are `unit: 'px'`; `rep_n` counts per outline or side
  (nothing to scale).
- Gizmo (`ui/gizmos.ts`): it stands on the top-left grid instance, which doesn't exist on an outline, so it is hidden
  there.
- Hints in the house style (active, relaxed).

## As built (notes against the plan)

- **Chamfers count as one corner.** A first GPU check put two rivets on every chamfered corner (two 45° turns). Two
  bends of one sign now join when together they make one corner (≤ 135°: not the U-turn round a rectangle's short end),
  the stretch between them is no longer than a rounded corner of the rounding radius turning as much, and it is shorter
  than the stretches either side (not a side of an even polygon). The corner sits in the middle of the stretch where
  the direction is halfway (a chamfer's middle).
- **Each side, by spacing:** every side gets at least one (then capped by the clearance), as Tabs did.
- **Hashes:** the shared variation uses the hash offsets Shapes had, so shapes render as before (distance and random
  identical on the GPU, one height texel 1/255 off). Motifs, Stamp / Label, Path and Tabs get new randoms; without
  randomness Rosette, Glyph, Label and Path render as before, Stamp the same inside (its distance far outside every
  stamp, from the nearest one by centre, can differ).
- **Path's random:** each filled region its own, and with several copies (or on an outline) each copy's own.
- **Tabs:** Scattered is a grid with Position jitter; its X / Y-less grid hides the mirrors; Side and Inset stay its own
  (Offset and Follow the edge hidden); _Flip every other_ and Flip at random › Up / down turn an element end for end. The
  Repeat card starts open on Tabs. Its foot / run passes and per-pixel side walk are gone, so it now also places tabs on
  curved outlines (a circle is one side) and on rounded corners counted as corners.
- **`without`** hides a family's unused rows (kept at their defaults, not optimised) rather than removing them: the shared
  shader reads `u_rep_follow`.
- **Pipeline:** `bindTextures` blanks a type's declared textures before `cpuData` binds its own, so a type with both
  (Path) keeps them.
- **Compile time** (cold, D3D11, one run with another session's studio on the GPU, so high across the board): the grid
  shaders carry none of the outline code (Shapes and motifs within run-to-run noise of before; `REP_SKEW` keeps Stamp's
  row-shift scan out of the others). The outline variant adds about 0.2–0.4 s (rect 0.49 → 0.75 s, stamp 1.20 → 1.62 s,
  glyph 2.49 → 3.48 s); Tabs' default is the variant now, 0.80 s against 0.82 s before.

## Not included

- **Vents & grilles**: its slot grid is the panel's structure (field, clearance, plugs), not repeats of one instance.

## Risks

- **Readback cost.** A sync `readPixels` per evaluation. It is small (packed float, about 1 ms of transfer at 512²) but it
  serialises the pipeline at that layer. I'll measure it and add the "nothing above changed" skip if it shows.
- **Corner finding** is the fiddliest part. The tests below pin it on sharp polygons, rounded rectangles, offsets both ways,
  circles and jump-flood outlines.
- **Many outlines** (a noisy mask with hundreds of islands) hit the 4096 cap with Repeats; Spacing drops specks on its own.
- **Refactoring six instancing loops** risks changing looks beyond the hash offsets. Each family is checked with before /
  after renders on the grid before the outline side is added.
- **Tabs changes most.** It loses its per-pixel side walk, gains tabs on curved outlines (a circle is one side) and on
  rounded corners counted as corners, and its domain warp now moves the elements off the edge as it does any shape's.
- **Compile time:** I'll run `tools/compile-time.ts` on every Repeat type before and after. The grid variant must not get
  slower, and I'll time the outline variant too.

## Checklist

1. [x] `glsl/repeat.ts` (grid side) + `repeat.ts` (`repeatParams`, `withRepeat`); shapes moved onto it. Grid renders and
       compile times before / after.
2. [x] `outline.ts`: trace (loops, open runs, wrap), corners, place, Edges, bucket. Unit tests: a circle SDF (length ≈
       2πr, even spacing, tangents ⟂ radius, up = outward, no corners), a square (first instance on the top-left corner;
       Each side N = 1, 2, 3 on corners, middles, thirds; Clear of the corners), a rounded rectangle (corners in the middle
       of each bend, at Offset ± too), a ring (hole runs the other way), a band across a tiling canvas (one loop through the
       seam), an open run at the canvas edge, Spacing counts, specks dropped, Edges, a wobbly square (still four corners).
3. [x] Shared `prepare` (source → jump flood → pack → readback → trace, cached → textures; texture edges; empty mask) +
       the outline side behind `MASK_REPEAT`; shapes on an outline.
4. [x] Rosette / Glyph onto the shared Repeat.
5. [x] Stamp / Label onto it (per-instance angle; renamed keys).
6. [x] Path onto it.
7. [x] Tabs & notches onto it (its placements, keys and tests; the old edge finder removed).
8. [x] Gizmo hidden on an outline; presets updated; registry test; hints.
9. [ ] Checks (done but the quiet-GPU compile times and the editor's readback timing): unit tests, `vue-tsc`, oxlint, oxfmt; every Repeat type rendered on the Windows backend (`precompile`, then
       `render`, errors empty); compile-time before / after; readback timing.
10. [x] Look: GPU screenshots of a Path plate with rivets on Each side (N = 1, 2, 3) inside (Offset −6) and outside (+8),
        squares with Follow on / off, Line dashes stitched round a patch by Spacing, tabs clear of the corners, a tiling
        band; sent for your review.
11. [x] Docs: this file's status, architecture.md (5.2 + feature index).
