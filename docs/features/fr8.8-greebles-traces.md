# FR8.8 — Tabs & notches, Traces & mazes, slot ends, formwork, liquid highlights

**Status:** done (first pass) — tuned against grate, vent, circuit-board, lava and water references

## Tabs & notches (`tabs` generator)
Small greeble details with diagonal cuts: trapezoid tabs (45° sides by default; Diagonal cut 0 = square, negative =
dovetail), notches, chevrons, bow-ties, diagonal slits, chamfered plates and half-round scallops. A crisp SDF for
small relief (a lit 1–2 px chamfer, cut in by default and shaded a little darker) and colour; it writes the shape mask.

**Placement**
- *Along the shape mask's edges* (default): each pixel takes the nearest edge of the shape mask below (distance and
  normal from the register), follows it both ways to where it stops being straight — a corner, a gap, the texture's
  border — and spreads that side's elements evenly over it, *into* the shape or *out* of it. Exact distances read ~0
  all along a straight side, so a tight threshold finds its ends (1 px steps, then bisection); curved edges never stay
  straight long enough to hold one. Elements keep clear of the side's corners (their shape's own clearance plus
  *Corner clearance*); short sides get fewer or none. Edges filter sides by the way they face. With nothing in the
  shape mask, the texture's edges are used. It reads earlier state (`readsState`), so its named-mask writes happen in
  place.
- *Along the texture edges* (left + right, top + bottom, all, one).
- *Grid* (Column / Row spacing round the centre, cells from `repGrid` — those whose element can reach the pixel) and
  *Scattered* (density, jitter); both take Rotation and Random rotation.

Along edges the *Spread* is a Spacing (about one element every N px, a whole number per side, evenly spread — the
default) or a Count per edge. Every placement has Size variation; all but scatter have Drop out and Alternate (every
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

Modes: *Fill* (routed, FR8.10, the default), *Route*, *Maze* and **Labyrinth** — a perfect maze, one spanning tree
grown as a growing tree (*Branching* 0 = depth-first long corridors, 1 = many short dead ends; Straightness, Horizontal
bias and Diagonals weight its steps). Its diagonals keep the walls whole: never crossing in a grid square, never 45°
off another link at a node, never meeting another diagonal in an X or V (only carrying straight on), never beside a
parallel one a node over; the few nodes those rules leave unreachable stay out as solid wall. Controls show only for
the modes they act on; *Shortest trace* (route, maze) drops pieces with fewer links (no pad-to-pad stubs).

Every connected trace has its own random (the texture's B + A carry a trace id): Per-feature variation, Random jitter
and *Wide traces* — a share of the traces *Wide width* × as wide (capped to keep 1 px clear of a neighbour), their
pads and vias grown by as much. Pads & vias card: round, square or octagon pads, a smaller pad on crowded fill ends
(*Pads where crowded*), a drill hole (*Pad hole*); vias at least the trace's half-width + *Via ring*, so the ring
always shows, never two linked side by side, absorbed by a pad they sit on. Drill holes cut through everything.
*Pad height* and *Pad dome* lift pads and vias above the traces and round them into solder domes (a drilled one domes
over its ring, peaking mid-ring); with either above 0 Height › Pattern takes the relief from the layer's own shapes
(`genOutHeight`), at 0 from the combined shape mask like other shape layers. The node search widens with the largest
feature, and the distance is capped where the search stops being sure, so it stays continuous for Bevel / Etch on the
shape mask. Defaults: a routed board — 4 px domed traces on an ~11 px pitch, raised domed pads on every end, drilled
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
