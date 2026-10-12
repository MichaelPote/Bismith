# FR7.2a — Organic generators: marble, caustics, wood, scales, cracks

**Status:** done. Five bespoke generator types in `src/layers/generators/organic*.ts`, exported as
`ORGANIC_LAYERS` from `organic.ts` (already registered in `generators/index.ts`):

| File | Contents |
| --- | --- |
| `organic.ts` | `ORGANIC_LAYERS` = marble, caustics, wood, scales, cracks |
| `organicShared.ts` | `ORG_GLSL` (lean fBm, tileable wave vector, line / breakup helpers, power-Voronoi cell distance), `ORG_GLSL_SDF` (bevel profile for SDF layers) |
| `organicLiquid.ts` | `marble`, `caustics` (value generators) |
| `organicWood.ts` | `wood`, `scales` (SDF generators with a combined output) |
| `organicCracks.ts` | `cracks` (SDF generator with a combined output) |

Part of FR7.2 (bespoke generators for emulating reference texture libraries).

## Goal
Motifs the generic noise / Voronoi / bricks layers cannot reproduce: veined marble, liquid caustics and lava
(also water, slime, icy water and sludge), wooden planks with grain, overlapping scales, and dried mud / cracked
crust.

## Plan
- **Marble** — veins are the level sets of a scalar field: `dot(p, k) + warp·turbulence` (streaks), contour
  lines of warped fBm (network) or warped Worley borders (cells). Pixel distance to the vein =
  `|fract(F + ½) − ½| / |∇F|` (finite differences), so vein width and softness are true px. A second, finer
  vein system, width variation, breakup and a cloudy background; optional per-tile cuts.
- **Caustics** — power-weighted Voronoi (size variation) in a softly warped domain. A crisp rim core on the
  cell border plus a glow / dome whose shape blends from polygonal (border distance) to round blobs (F1/F2,
  whose level sets are Apollonius circles). Log-sum-exp soft minimum over the bisectors thickens junctions.
  Optional second octave at 2× frequency.
- **Wood** — planks (count, gap, end joints with stagger + randomness, width variation) found brick-style
  (nearest board box of a 3×3 neighbourhood, gaps on the left / top so whole-px sizes are crisp). Grain per
  board: stretched value-noise streaks; elongated growth rings around a per-board heart (periodic along the
  board so full-length boards tile) with low-frequency wobble; knots that bend the grain like potential flow
  around a cylinder, with dark concentric rings inside.
- **Scales** — rows of discs (alternate rows offset half a column). A scale's visible part is its disc (split
  from its row neighbours at the midline) minus every disc of the rows in front; rows are walked front to
  back with a running union, giving an exact-enough SDF of the visible part. Dome / tilt shading.
- **Cracks** — main power-Voronoi crack network (warp + pixel jaggies) plus a finer Voronoi network where each
  border segment (cell pair) is kept with a probability, so partial cracks end cleanly at junctions.

## Checklist
- [x] Marble: streaks / network / cells styles, tile-safe angle, warp + detail, vein width / softness in px,
      width variation, breakup, fine veins, cloudiness, per-tile cuts (`tiles`, `tile_rot`)
- [x] Caustics: net / blobs modes, power-Voronoi size variation, roundness, soft warp, rim width / softness,
      glow reach / level / falloff, second octave; default height = rims sunk (blobs domed)
- [x] Wood: planks + joints + stagger + width variation, fine grain, ring figure with cathedral arches,
      knots, horizontal / vertical, no-planks mode; outputs wood / plank SDF / grain only
- [x] Scales: columns, rows (auto), radius, up / down, outline, dome, tilt; outputs scales / SDF
- [x] Cracks (optional extra): main + partial fine networks, jaggies, warp; outputs plates / SDF
- [x] Tileable (checked with 2×2 tiled renders at 64², 96×40, 80×48), non-square (256×32 trims) and tiny
      (16×16) sizes, non-tiling projects
- [x] Smoke test clean; typecheck clean for these files
- [x] Reference recreations (see Notes)

## Layer reference

All five are category `pattern`, tileable, and use only `org_`-prefixed GLSL helpers.

| Type | SDF | Value (→ ramp) | `rnd` | Default outputs |
| --- | --- | --- | --- | --- |
| `marble` | no | 1 on veins, cloudy background up to `cloud` | per vein band (per tile with `tiles`) | diffuse (white marble ramp), roughness 0.25 → 0.45 |
| `caustics` | no | brightness: rims 1, glow → dark cell centres (net); bright blobs, dark cracks (blobs) | per cell | diffuse (lava ramp), height **subtract** 0.35, emissive ×0.6 |
| `wood` | output | grain (1 = light wood, 0 = dark lines / gaps) × plank-edge bevel | per board | diffuse (oak ramp, jitter 0.2), height 0.3, bevel 1 px round |
| `scales` | output | dome / tilt shading × edge bevel, outline = 0 | per scale | diffuse (dark green-grey, jitter 0.15), height 0.5, bevel 2 px round |
| `cracks` | output | 1 on plates (× optional bevel), 0 in cracks | per plate (main × fine) | diffuse (mud ramp, jitter 0.15), height 0.3, flat (no bevel) |

### marble
| Param | Default | Notes |
| --- | --- | --- |
| `style` | streaks | streaks · network · cells |
| `veins` | 3 | streaks: bands per texture width; network / cells: noise cells across |
| `angle` | 30° | streaks only; clockwise from horizontal, snapped to whole cycles per axis when tiling |
| `stretch` | 1 | network / cells: > 1 elongates horizontally |
| `levels` | 1 | network: contour lines per unit of noise |
| `warp`, `warp_scale`, `detail` | 0.5, 3, 5 | turbulence strength (vein periods / cells), cells across, octaves |
| `width`, `soft` | 1 px, 1 px | vein core and falloff |
| `width_var`, `breakup` | 0.5, 0.3 | veins swell / thin; fade in and out |
| `fine`, `fine_scale` | 0.45, 3 | second vein system strength and density |
| `tiles`, `tile_rot` | 0, 45° | cut into tiles across (each its own piece; rotated veins), 0 = off |
| `cloud` | 0.35 | mottled background level |

### caustics
| Param | Default | Notes |
| --- | --- | --- |
| `mode` | net | net (bright rims, dark cells) · blobs (bright domed cells, dark cracks) |
| `scale`, `jitter`, `size_var` | 5, 0.85, 0.3 | cells across; site jitter; power-diagram weights |
| `round` | 0.8 | 0 polygonal glow, 1 round blobs (F1/F2) |
| `warp`, `warp_scale` | 0.3, 1 | soft 2-octave warp in cells; frequency relative to the cells |
| `rim`, `rim_soft` | 1 px, 0.5 px | bright core (net) / dark crack (blobs) |
| `glow`, `glow_amount`, `falloff` | 1, 0.65, 0.7 | reach (× cell radius), level next to the rim, curve (< 1 = wide plateau) |
| `octave2` | 0.2 | fainter net of 2× smaller cells |

In **blobs** mode the value is high inside the cells, so switch the height mode to **Add** (the default
Subtract is right for net mode: rims sink, cells bulge).

### wood
| Param | Default | Notes |
| --- | --- | --- |
| `output` | wood | wood (grain × plank bevel, gaps = 0) · shape (plank SDF → register) · grain (no gaps / edges) |
| `planks` | on | off = one continuous piece (no boards; rings fold into arches with `figure`) |
| `direction` | vertical | vertical · horizontal |
| `count`, `gap` | 4, 1 px | planks across; gap on the left / top edge of each plank |
| `joints`, `stagger`, `joint_rand` | 1, 0.5, 0.6 | board ends per plank along the texture (0 = full length); regular and random offsets |
| `width_var` | 0 | uneven plank widths |
| `grain_px`, `grain_stretch`, `fine` | 2 px, 24, 0.6 | fine streak spacing, elongation, strength |
| `rings`, `ring_px`, `ring_line` | 0.6, 4 px, 0.4 | ring strength, spacing, latewood fraction |
| `figure` | 0.5 | planks: fraction of boards cut through the heart (cathedral arches / ovals); no planks: fold strength |
| `ring_stretch`, `ring_warp` | 6, 0.5 | ring elongation along the board; wobble |
| `knots`, `knot_size` | 0.15, 3 px | chance per board (≤ 1 each); radius across the grain |

The Shape group's `bevel` / `profile` / `aa` shade plank edges in the `wood` output too (the layer reads them
itself). Two-layer recipe for exact bevels: `wood` (`output: shape`, height on) then `wood` (`output: grain`,
same seed and plank params, diffuse on, height off, `m_clip: inside`); the gaps then show whatever is below
(the project base colour, or a dark fill layer).

### scales
| Param | Default | Notes |
| --- | --- | --- |
| `output` | scales | scales (shading × edge bevel, outline = 0) · shape (visible-scale SDF → register) |
| `columns` | 4 | scales per row |
| `rows` | 0 (auto) | auto = row spacing equals the radius (classic fish scale); rounded up to even when tiling |
| `radius` | 0.5 | × column width (0.5 = neighbours touch); clamped to 4 row heights |
| `direction` | up | up: lower rows lie on top; down: upper rows on top (arches point down) |
| `outline` | 1 px | dark gap along each visible edge |
| `dome`, `tilt` | 0.6, 0 | bulge around each disc centre; rise towards the free edge |

### cracks
| Param | Default | Notes |
| --- | --- | --- |
| `output` | plates | plates (value 1 on plates × optional bevel, 0 in cracks) · shape (plate SDF → register) |
| `scale`, `jitter`, `size_var` | 4, 0.9, 0.3 | main plates across; jitter; weights (main network only) |
| `width` | 1.25 px | main crack width |
| `warp`, `jag` | 0.1, 0.25 px | bend (plate sizes); pixel-scale edge roughness |
| `sub`, `sub_scale`, `sub_width` | 0.4, 2.5, 1 px | fraction of fine crack segments kept; fine plates per main plate; width |

Glowing cracks (lava crust): a second `cracks` layer with the same params and seed, Shaping →
Invert on, diffuse off, emissive on (value = 1 in the cracks).

## Notes and constraints
- **Tiling.** Every lattice / noise uses whole cell counts per axis (`cellsFor`) and wraps its hashes. Marble
  streak angles snap to whole cycles per axis (like `stripes`). Wood: plank edges / joints are whole px and
  repeat with the texture; rings are periodic along each board (`sin` wrap), and across the texture in
  no-planks mode, where the ring spacing is snapped to a whole count; knot bending is windowed (fades out
  by 4 radii) and wraps. Scales force an even row count. Verified with 2×2 tiled renders.
- **Combined outputs.** The generator wrapper replaces an SDF pixel's value with the bevel profile, so wood,
  scales and cracks fold their own value × `org_edgeProfile(d)` × coverage into a NO_SDF pixel by default (no
  register write) and offer an SDF output for the register. See *Recommended shared change* below.
- **Derivatives.** Wood fades growth rings that crowd closer than ~2 px with `dFdx/dFdy` of the ring field
  (anti-moiré); called in uniform control flow.
- **Shader size.** The helpers use a lean `org_noiseFbm` (value / Perlin, optional billow) instead of
  `fractalNoise`, whose generic dispatch inlines Worley at every call site; marble evaluates its finite
  differences and its two vein systems in loops. SwiftShader compile times: marble ~0.45 s, the others
  0.1–0.25 s.
- **Small textures.** At 16×16 the defaults read as noise (cells / veins of 3 px); lower the scale counts.
- **Limitations.** No diagonal wood (rotated plank frames are not tileable in general); at most one knot per
  board; marble network / cells styles have no rotation (use `stretch`); per-tile marble shares the vein
  angle snapping of the whole texture; caustics blobs mode needs the height mode switched by hand.

### Reference recreations
Projects (64×64, sun 315°/40°, ACES tonemap + Quake / Doom palette) for two lavas, water, slime, metal scales,
two wooden floors, a checkered marble floor (checker + tiled marble + bricks bevel), dried mud, cracked lava crust
(cracks + inverted cracks as emissive) and veined marble. Closest: the scales (geometry exact: 2 columns, auto
rows), the lava crust, the wooden floors (plank layout and grain), the marble floor, the mud and the marble.
Liquids match the structure (rims, round dark cores, second octave); the remaining difference is mostly ramp /
exposure (lit renders darken the cores) — liquids look best with emissive from the value.

### Recommended shared change
Let SDF generators keep their own value: e.g. a `LayerDef.sdfValue?: 'profile' | 'pattern' | 'multiply'` (or a
common `sdf_value` param) so the wrapper computes `value = pattern × profile` instead of replacing it. Then
wood / scales / cracks could write the register *and* carry grain / shading in one layer, and the combined
outputs here would become unnecessary.
