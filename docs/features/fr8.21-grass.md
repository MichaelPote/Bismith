# FR8.21 — Grass

A generator for grass seen from above: lawns, meadow, dry straw over undergrowth, mossy or fleecy curls, painted
game-style grass. Source: `src/layers/generators/grass.ts`.

## Model

- **Blades.** Each blade grows from a root along a curve whose heading turns by **Bend** evenly from root to tip, by a
  further **Curl** gathered towards the tip (hooks, then curls and loops), and wavers by **Wiggle** (one to three waves
  along the blade, random phase). Every blade bends left or right at random, by 40–100 % of Bend and Curl. It is drawn
  as a polyline of short segments (more where it turns more), its width tapering from **Blade width** at the root by
  **Taper** (`w · (1 − taper · t^1.5)`: wide through the middle, pointed at the tip). **Shape › Leaf** makes it widest
  in the middle and pointed at both ends instead (`w · mix(1, √sin(πt), taper)`): fallen leaves, litter, clover. Coverage
  is box-filtered across the pixel, so blades thinner than a pixel draw as faint lines rather than aliasing.
- **Scattering.** Roots lie on a grid of cells at least one blade's reach across (whole cells when tiling), so a pixel
  searches only the 3 × 3 cells about it. **Density** is how many blades lie over each spot on average; the count per
  cell follows from the blade area (capped at 256 per cell). **Tufts** gathers that share of a cell's roots round one
  spot. A bounding circle about each blade's middle (every point of a curve lies within half its length of its middle)
  rejects most candidates before the polyline is walked. Loops are bounded by uniforms (`UNI_1`, the per-cell count),
  so D3D doesn't unroll them.
- **Depth.** Each blade has a random depth and climbs by **Rise** towards its tip (with **Arch**, it climbs to its
  middle and droops again), so tips lie over the roots of the blades about them. At each pixel the two highest blades
  and the highest one covering the pixel fully are kept and composited, which keeps anti-aliased edges over other
  blades right.

## Outputs

- **Value** is a shade: **Depth shading** darkens deep blades and roots; **Fold** creases each blade along its middle,
  the half facing **Light from** lighter; **Contact shadow** darkens a blade beside a higher one passing over it (the
  highest nearby blade, falling away over **Shadow width**: higher blades cast wider shade). **Blade variation** makes
  each blade lighter or darker than the next (sunlit and shaded blades; Random jitter moves along the ramp instead, hue
  and all) and **Roundness** lights each blade along its middle, darker at its edges. **Colour patches** shift the
  blades along the ramp in broad patches (drier, lusher).
- **Two kinds** puts two kinds of blade on one ramp: its middle is the shade both share, the first kind lightens
  towards the ramp's start, the second towards its end. Anti-aliased edges between the kinds pass through shade
  rather than a third colour, which reads as a contact line.
- **Gaps**: _Shadowed ground_ paints the gaps with the dark end of the ramp (the middle with two kinds); _Clear_ draws
  only the blades, so a layer below (soil, a finer grass) shows between them. **Bare patches** thin the blades out and
  stop them in noise patches (**Patches across**); the ground fill thins out on the same curve, so no band of shadowed
  ground rings a patch. **Patch edges** adds octaves to the patch noise and keeps more of each, fraying the outlines into
  islands and specks (worn turf). **Grow in patches** turns it round: blades only in the patches (clusters of litter,
  clover). The **Patch seed** lays out the bare and colour patches and the relief: grass layers with the same patch
  seed share them, so top blades thin out over the same bare ground as the turf beneath.
- **Height** (`hval`) is the blade's own height plus a slight dome across it, separate from the shading, and **Turf
  relief** adds hummocks and hollows (smooth noise, **Relief across**) that blades and ground ride on — under a light the
  turf shades in broad soft swells and AO darkens the hollows. **rnd** is per blade, so Random jitter and Per-feature
  variation vary blade by blade.

## Looks

| Look                                        | Settings                                                                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Painted meadow, arching                     | long, wide blades (90 / 5.5 px at 512), Direction 0, Spread 55°, Bend 110°, Arch 0.7, Tufts 0.4, Two kinds (olive and green)                                                                       |
| Lawn over soil                              | thin blades (40 / 1.6 px), Gaps Clear over a brown noise layer, Bare patches 0.2                                                                                                                   |
| Moss / fleece                               | thin (1.5 px), Bend 90°, Curl 90°, Wiggle 45°, Depth shading 0.9, bright top of the ramp                                                                                                           |
| Lawn with leaf litter (the _Grass_ starter) | soil noise, short fill blades, a Leaf litter layer growing in patches and sparse top blades; tuned with Match against a photo (Colour range Normal), height depth 1.5, low sun with shadows and AO |
| Photo lawn                                  | soil noise, a dense fill layer (12 / 1.6 px) and a sparse clear top layer, Blade variation 0.5, Roundness 0.4, Turf relief 0.5; lit by a low sun with shadows and AO                               |
| Leaf litter on a lawn                       | a Leaf layer (13 / 6 px, Taper 0.8, Rise 0.3, Curl 60°) in a brown ramp, Gaps Clear, Bare patches 0.7 with Grow in patches                                                                         |
| Worn turf over sand                         | sandy noise below; fill and top layers with the same Patch seed, Bare patches 0.4, Patch edges 0.9                                                                                                 |
| Straw over undergrowth                      | a dense short dark layer, Blur 2.5 px, then sparse wide straw blades (Gaps Clear) with Fold and Colour patches                                                                                     |

## Checklist

- [x] Blades: bend, curl, wiggle, taper, width / length variation; polyline with box-filtered coverage
- [x] Cell scattering with tufts and density from the blade area, tileable; bounding-circle rejection
- [x] Depth compositing (top two + top full), rise and arch
- [x] Shading: depth, fold, contact shadow, colour patches; two kinds on one ramp
- [x] Gaps fill / clear, bare patches; height (hval) with a dome; per-blade rnd
- [x] Blade variation, roundness; Leaf shape; patch edges, grow in patches, shared patch seed; turf relief
- [x] Cold compile time on D3D11 (`tools/compile-time.ts grass`): 0.97 s on an RTX 5080 (Noise: 1.4 s)
