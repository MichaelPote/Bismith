# FR8.8 — Tabs & notches, Traces & mazes, slot ends, formwork, liquid highlights

**Status:** done (first pass) — tuned against grate, vent, circuit-board, lava and water references

## Tabs & notches (`tabs` generator)

Small greeble details with diagonal cuts: trapezoid tabs (45° sides by default; Diagonal cut 0 = square, negative =
dovetail), notches, chevrons, bow-ties, diagonal slits, chamfered plates and half-round scallops. A crisp SDF for
small relief (a lit 1–2 px chamfer, cut in by default and shaded a little darker) and colour; it writes the Shape mask
by default.

**Placement**

- _Along the mask's edges_ (default): each pixel takes the nearest edge of the mask before it (the one the layer
  writes, or Shape; distance and normal from the mask), finds how far it runs straight both ways — to a corner, a
  gap, the texture's border — and spreads that side's elements evenly over it, _into_ the shape or _out_ of it.
  Passes before the layer (`prepare`) give every edge texel how far its side runs, by doubling (log₂ of the
  texture's size passes, as in jump flooding); each pixel then refines its side's two ends locally (1 px steps from
  just short of each, then bisection). Exact distances read ~0 all along a straight side, so a tight threshold finds
  its ends; curved edges never stay straight long enough to hold one. Elements keep clear of the side's corners (their shape's own clearance plus
  _Corner clearance_); short sides get fewer or none. Edges filter sides by the way they face. With nothing in the
  mask, the texture's edges are used (`readsMask`).
- _Along the texture edges_ (left + right, top + bottom, all, one).
- _Grid_ (Column / Row spacing round the centre, cells from `repGrid` — those whose element can reach the pixel) and
  _Scattered_ (density, jitter); both take Rotation and Rotation variation.

Along edges the _Spread_ is a Spacing (about one element every N px, a whole number per side, evenly spread — the
default) or a Count per edge. Every placement has Size variation; all but scatter have Drop out and Flip every other (every
other element mirrored end for end; checkerboard on a grid). The Grate lump uses it (texture edges, a count) for the
clip notches cut into its frame sides.

## Traces & mazes (`traces` generator)

A grid of nodes linked east / north and, by chance, diagonally (NE / SE); the two diagonals of a grid square never
both — so traces never cross. The **diagonal angle** sets the cell aspect (45° = square cells, rows rounded to tile),
so diagonals can be any slope. **Grouping** gives each block of cells a dominant direction that most links follow —
parallel bus runs instead of a tangle. Pads on dead ends (round / square), vias (rings). With diagonals 0 and grouping
low it is a right-angle maze. The Circuit board lump is built on it. For pixel-exact line art keep supersampling at 1.

All three modes compute their links per node on the CPU (route and maze in `traceLinks.ts`, a bit-exact port of the
GLSL hashes; fill in `router.ts`, FR8.10) and hand them to the shader as a per-node texture (link mask + flags), so the
shader only draws segments, pads and vias. Route and maze used to run per pixel in GLSL, re-deriving every
neighbour's links; D3D11's compiler (Windows) took over 4 minutes on that shader and hung the browser. It now compiles
in about a second, and the move left every layout pixel-identical.

_Layout_: _Fill_ (routed, FR8.10, the default), _Route_, _Maze_ and **Labyrinth** — a perfect maze, one spanning tree
grown as a growing tree (_Branching_ 0 = depth-first long corridors, 1 = many short dead ends; Straightness, Horizontal
bias and Diagonals weight its steps). Its diagonals keep the walls whole: never crossing in a grid square, never 45°
off another link at a node, never meeting another diagonal in an X or V (only carrying straight on), never beside a
parallel one a node over; the few nodes those rules leave unreachable stay out as solid wall. Controls show only for
the modes they act on; _Shortest trace_ (route, maze) drops pieces with fewer links (no pad-to-pad stubs).

Every connected trace has its own random (the texture's B + A carry a trace id): Per-feature variation, Colour variation
and _Wide traces_ — a share of the traces _Wide trace width_ × as wide (capped to keep 1 px clear of a neighbour), their
pads and vias grown by as much. Pads & vias card: round, square or octagon pads, a smaller pad on crowded fill ends
(_Pads where crowded_), a drill hole (_Pad hole_); vias at least the trace's half-width + _Via ring width_, so the ring
always shows, never two linked side by side, absorbed by a pad they sit on. Drill holes cut through everything.
_Pad height_ and _Pad dome_ lift pads and vias above the traces and round them into solder domes (a drilled one domes
over its ring, peaking mid-ring); with either above 0 Height › Pattern takes the relief from the layer's own shapes
(`genOutHeight`), at 0 from the combined mask like other shape layers. The node search widens with the largest
feature, and the distance is capped where the search stops being sure, so it stays continuous for Bevel / Etch on the
mask. Defaults: a routed board — 4 px domed traces on an ~11 px pitch, raised domed pads on every end, drilled
vias; added in the editor the px sizes follow the texture (2 px pitch and 1 px traces at 64 px).

## Vents: pointed / angled slot ends

`ends`: pointed (45° chamfers meeting at a point — bow-tie bridges between staggered slots) and angled
(both ends cut on one diagonal).

## Grate lighting

Slot walls are a 1 px sloped ramp in relief and the black is painted only in a core one pixel in, so the walls keep
the metal colour and show the light: lit on the walls facing it (bottom / right under the top-left key), dark on the
others — as in the reference. A 1 px border seam at the tile edge lights the frame's outer rim.

## Concrete formwork

Formwork group: plywood sheets or vertical boards (shallow seams, a tone per sheet / board, board grain) and form-tie
holes in a grid per sheet — open (pit with a lit lip), plugged (flush disc in a groove) or cone.

## Liquid highlights

A copy of the caustic pattern (tied by seed) keeps only the rim cores (levels 0.84–1), screened bright with a glow.

## Checklist

- [x] tabs, traces generators; vents ends; Grate (tabs, seam, lit walls), Circuit (traces), Concrete formwork, Liquid highlights
- [ ] Longer bus runs (straight-continuation preference) and a darker board fit for the circuit-board reference
