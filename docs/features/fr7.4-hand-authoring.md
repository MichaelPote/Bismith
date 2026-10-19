# FR7.4 — Hand-authored recreations (studio)

**Status:** done

## Goal

The FR6.3 optimiser and the FR7.3 emulation pipeline converge on textures with the right _statistics_ but not the
right _intent_: blocks land in the wrong places, emblems become noise, panels have no reason to be where they are.
Instead, an author (a person, or Claude driving the tools) recreates each reference deliberately — reading its
layout, sampling its colours, choosing generators — and uses the renderer and the metric only as a mirror.
Where a motif cannot be expressed, a generator is added (FR7.2, FR7.5).

## Workflow

1. **Study** the reference: `tools/grid.ts` (nearest-upscaled contact sheets), `tools/ascii.ts` (luminance digits per
   pixel; `--mean` gives a region's mean / dark / light colours; `--cut` thresholds into a Stamp mask),
   `tools/palof.ts` (dark→light k-means palette + periods).
2. **Measure** the layout: column / row means, runs of light or dark pixels per row (panel edges, joints, grooves,
   rivet blobs) — a few lines of Python over the `ascii.ts` digits.
3. **Author** the project JSON, using small Python helpers that write it (`project()`, `L()`, `ramp()`, `rampAt()`,
   `band()`, `rectpx()`, `stamp()`, `label()`, `beads()`, `poly()`, `raster()`, `hspeck()`, `flecks()`, `mottle()`,
   `rockskin()`, `tekplate()`, `ribbed()`). Project fields `_ref`, `_maps`, `_scale`, `_samples` are read by the
   studio and ignored by the app.
4. **Render** with `tools/studio.ts`: a GPU session that watches the folder and, whenever `<name>.json` changes,
   writes `<name>.png`, `<name>.sheet.png` ([reference | render | height | diffuse]) and `<name>.txt` (timing,
   shader errors, tile-metric breakdown). Iterate until the sheet reads right; the metric is a sanity check, not
   the goal.

## The painted Quake look

- Lighting: one directional key light (azimuth 315°, elevation 28°, intensity 1.8), sky 0.15, **shadows off**,
  specular 0 → a flat surface renders ≈ its albedo, slopes facing the key light brighten and the others darken —
  the hand-painted bevel look. Tonemap _clamp_, then the exact Quake palette.
- Colours come from the reference (`ascii.ts --mean`, `palof.ts`), never from intuition.
- Relief is subtle (heightDepth 2–2.5); detail lives in height so it is _lit_, not painted on.
- Speckle stays in hue (white noise through a ramp between two sampled colours), not black/white overlay.
- Many Quake-style details are painted flat (mouldings, channels, shadow lines): paint them as flat bands / rects and
  add height only where the reference shows a lit edge.
- Hand-drawn motifs (emblems, logos, numbers) are Stamps / Labels; designed shapes (cut-outs, channels, inlays) are
  Paths; their polygons come straight from the measured runs.

## Recipes (examples)

| Texture family | Recipe                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rock           | `rockskin()`: warped Voronoi colour patches + value mottle + jagged crack network carved into height + in-hue grain + rare coloured flecks (cutoff)                                                         |
| Crates         | wood grain, flat-painted moulding bands, 1×2 px lit beads (Stamp repeats), traced emblem Stamp + Label "03", black hand-hold slots                                                                          |
| Tech plates    | `tekplate()` (mottle, grain, hammer dents) + Path cut-out (subtract, linear bevel) filled by `ribbed()` / louvre stripes / panel greebles limited to the Shape mask, rivet Stamps (row shift for diagonals) |
| Lights         | flat rects with a value ramp (edge brown → orange → yellow → white) + small emissive; circuit grooves as 1 px subtract rects                                                                                |
| Wood           | `wood` generator (planks / joints / grain) with sampled ramps; logos and inlays as Stamp / Path                                                                                                             |
| Lava           | single-octave Worley cells (dark centres) + soft-light heat + in-hue grain                                                                                                                                  |
| Rope moulding  | `cable` (1 strand, loop ≈ 9, back depth ≈ 0.45) in a dark bed                                                                                                                                               |

## Tracing dense greebles

Console walls are dozens of tiny blocks in a specific layout; placing them by hand does not scale.
`tools/trace.ts <ref.png> [--tiers 4] [--mirror auto|x|none] [--min 3] [--chroma 45]` splits luminance into tiers
(1-D k-means; tier 0 = background), removes specks, detects left–right symmetry, and writes a project of nested-tier
Stamps (stacked relief lit by the key light, tier-mean colours, grain overlay) plus a
**colour pass**: saturated pixels grouped into six hue sectors, stamped at full width with a little emission
(screens, lamps, warning stripes). The skeleton is then authored further where it falls short (one hybrid wall: plate
and cut-outs by hand, traced greebles clipped into them, runes traced from their red pixels). Asymmetric content
(stripes, screens, rune columns) needs `--mirror none`.

## Results

Most references were authored by hand, a few with a traced motif (crate emblems, a demon face, the hybrid wall's
greebles and runes) and the console walls from the tracer + colour pass. The load test checks every layer type and
param key survives loading. Tile-metric totals range 0.24–0.59; the best-reading results (crates, lights, tech
plates, the bolt door, the switch) are also the lowest losses, but several good-looking rocks score ~0.5 — another
sign the metric under-weights intent.

## Checklist

- [x] Studio loop (watch → render → sheet → metric)
- [x] Reference study tools: `ascii.ts` (digits, thresholds, region means), `palof.ts`, `grid.ts`
- [x] Painted-light recipe (shadows off, specular 0) and verified albedo ≈ render
- [x] Rocks, bricks, wall / metal / ground batches
- [x] Crates (traced emblems), woods, lava, lights, a riveted plate
- [x] Tech plates (Path cut-outs, ribbed fills, circuit fills, diagonal rivets)
- [x] Switch (logo), rope moulding (cable), door (Path bolt + inlays), more tech walls and doors
- [x] Procedural drip mask; traced face Stamp, repeated
- [x] Console / greeble walls via `tools/trace.ts` (+ one hybrid)
- [x] Finished projects + load test
- [x] Gallery of reference vs recreation, built from the studio renders
- [ ] Revisit the weakest: overlapping-plate detail, a rock, a moulded stone, rods
