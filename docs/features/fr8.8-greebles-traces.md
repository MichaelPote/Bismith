# FR8.8 — Tabs & notches, Traces & mazes, slot ends, formwork, liquid highlights

**Status:** done (first pass) — tuned against grate, vent, circuit-board, lava and water references

## Tabs & notches (`tabs` generator)
Small greeble details with diagonal cuts: trapezoid tabs (45° sides), notches, chevrons, bow-ties, diagonal slits,
chamfered plates — placed along chosen texture edges (left + right, top + bottom, all, one), on a grid (optionally
alternating) or scattered (density, jitter). A crisp SDF for very small relief and colour. The Grate lump uses it for
the clip notches cut into its frame sides.

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
