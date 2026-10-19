# FR8.6 — Material lumps (recipes tuned against references)

**Status:** in progress — 15 recipes; the set below tuned by eye in the studio against its references

## Goal

Make the building blocks themselves look right: one smart material ("lump", FR8.3) per material family, a handful
of controls each, fitted and tuned against real references rather than left to the optimiser.

## Lumps

| Lump                                                                                           | Generators inside                                                                                                            |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Concrete                                                                                       | noise mottle / smears / streaks / pits, Bricks panels, Ellipse bolt holes, Drips stains, cavity                              |
| Tiles                                                                                          | Tiles (squares, diamonds, diagonal bond, herringbone, basketweave, rhombille), Hex, Bricks                                   |
| Stripes                                                                                        | Stripes, Bands (chevrons, zig-zag), Checker; grunge, scratches                                                               |
| Metal plate                                                                                    | noise, rust patches, Scratches, Treadplate, Bricks seams, Ellipse rivets                                                     |
| Grate & vents                                                                                  | Vents (relief / frame / slots), Ellipse bolts                                                                                |
| Light panel                                                                                    | Rect housings and tubes (emissive)                                                                                           |
| Liquid                                                                                         | Caustics (net / blobs, glow)                                                                                                 |
| Wood                                                                                           | Wood, streak noise                                                                                                           |
| Marble                                                                                         | Marble, grid joints                                                                                                          |
| Rock face                                                                                      | Rock (relief, colour, bed overlay, scarps, crevice dirt, moss — the wizard's Rock face template under macros, FR8.18), grain |
| Circuit board                                                                                  | Truchet circuit (glow)                                                                                                       |
| Plus the earlier Stone wall, Cobblestones, Hammered metal, Brushed metal, Water & rust stains. |

## Lessons (from reviews of the renders)

- **Crisp edges, minimal relief.** A tile / brick / panel edge is a 1 px dark joint plus at most a 1 px highlight —
  a near-hard step a fraction of a pixel high (`bevel` 0.5 px, `h` ≈ 0.15), never a bevel ramp; ambient occlusion
  only as a hint (it widens joints). Bricks have 1–2 px rounded corners.
- **Two levels and a halo** on cast panels: the face, a 1 px lit step, a thin dark seam — and a darkened paint band
  starting a pixel inside each edge (a ring-shaped bevel curve, so the lit edge stays bright).
- **Bolt holes** are steep-walled pits whose lower lip catches the light; the dark paint only fills the core.
- **Per-pixel colour, not blotches.** The references' colour variation is fine grain (often several hues: green
  patina flecks on tiles); broad mottle turns into patches once colours are fitted. A colour grain in the lump's own
  hues also keeps the palette snap from banding.
- **Paint openings last** (grate slots, holes) so grime passes can't lighten them.
- **Rhombille** (tumbling blocks) is its own Tiles pattern; hexagons are hexagons — a pattern control that switches
  generators rebuilds the member layer (`setMacro` handles type changes).
- Real PBR concrete: displacement nearly flat apart from spalls and pinholes; normals almost uniform; roughness high
  with a fine cellular variation; formwork seams shallow — keep concrete relief tiny.

## Workflow

Each lump is set up as a studio project (painted light, Doom palette, `_fit`, reference), colour controls seeded
from the reference's dominant hue; the studio fits colours (FR8.2) and renders; pair sheets [reference | render]
are compared by eye at 3–10×.

## Checklist

- [x] Concrete, Tiles, Stripes, Metal plate, Grate & vents, Light panel, Liquid, Wood, Marble, Circuit
- [x] Tuning pass with review feedback (crisp 1 px relief, halo, bolt lips, patina flecks, rounded corners)
- [ ] Concrete spalls / pinholes / formwork from the PBR study; grate frame notches; finer wood grain
- [ ] Lumps as emulation templates (Suggest / emulate build them with colours from the reference)
