# FR7.2a — Organic generators: marble, caustics, wood, scales, cracks

**Status:** done. Five bespoke generator types in `src/layers/generators/organic*.ts`, exported as
`ORGANIC_LAYERS` from `organic.ts` (already registered in `generators/index.ts`):

| File | Contents |
| --- | --- |
| `organic.ts` | `ORGANIC_LAYERS` = marble, caustics, wood, scales, cracks |
| `organicShared.ts` | `ORG_GLSL` (lean fBm, tileable wave vector, line / breakup helpers, power-Voronoi cell distance), `ORG_GLSL_SDF` (bevel profile for SDF layers) |
| `organicLiquid.ts` | `marble`, `caustics` (value generators) |
| `organicWood.ts` | `wood`, `scales` (SDF generators with a combined output) |
| `organicCracks.ts` | `cracks` (SDF generator with a combined output; tests in `cracks.test.ts`) |

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
  back with a running union, giving an exact-enough SDF of the visible part. Dome / tilt shading. (Later: pointed
  arches, irregularity, size variation, random lapping of overlapping row neighbours, keel — see the reference.)
- **Cracks** — main power-Voronoi crack network (warp, zig-zag, pixel roughness, a width per border segment, bowed
  pillowy sides, rounded plate corners so cracks flare into wedges at the junctions, depth by width) plus a finer
  Voronoi network where each border segment (cell pair) is kept with a probability, so partial cracks end cleanly at
  junctions; fine segments taper away from the main cracks (or form a faint hairline web) and each plate draws its
  own (T-junctions); shattered patches of shards hanging off the main cracks; a depth halo at heavy junctions.

## Checklist
- [x] Marble: streaks / network / cells styles, tile-safe angle, warp + detail, vein width / softness in px,
      width variation, breakup, fine veins, cloudiness, per-tile cuts (`tiles`, `tile_rot`)
- [x] Marble quality pass: smooth / kinked turbulence, roughness, folding, turbulence stretched along the veins
      (tileable at any snapped angle), width from flow, halo, fine-vein style / width / clustering, cloud scale
- [x] Caustics: net / blobs modes, power-Voronoi size variation, roundness, soft warp, rim width / softness,
      glow reach / level / falloff, second octave; default height = rims sunk (blobs domed)
- [x] Caustics quality pass: stretch, warp detail, second-octave scale, rounded relief, the cells as a mask,
      height mode following the mode
- [x] Wood: planks + joints + stagger + width variation, fine grain, ring figure with cathedral arches,
      knots, horizontal / vertical, no-planks mode; outputs wood / plank SDF / grain only
- [x] Scales: columns, rows (auto), radius, up / down, outline, dome, tilt; outputs scales / SDF
- [x] Cracks (optional extra): main + partial fine networks, jaggies, warp; outputs plates / SDF
- [x] Cracks fidelity (crazed glaze / dried slip): rounded plate corners (junction wedges), bowed sides, widths that
      flare at junctions and set the crack's depth, a faint fine hairline web (Fine darkness), shattered patches,
      depth halo, plate roughness, smooth domes. Crazing look: scale 8, size_var 0.9, width 1.6, width_var 1,
      bulge 0.06, depth_var 0.5, zigzag 0.3, jag 0.12, warp 0.1 / 2, fine 0.7 × 1.8 at 0.8 px, Taper 0,
      tone 0.6, fillet 0.08, shatter 0.25 × 5; Height: bevel 1.5 smooth, dome 0.08, rough 0.15, halo 0.6
- [x] Cracks quality pass: non-folding Bend / Squeeze warps with true-px widths, zig-zag, width variation, tapering
      fine branches ending at the main cracks (connected only, shallower grooves of their own depth), plate dome / curl /
      tilt in Height, Plates output writes the Shape mask, editor defaults sized to the texture
- [x] Tileable (checked with 2×2 tiled renders at 64², 96×40, 80×48), non-square (256×32 trims) and tiny
      (16×16) sizes, non-tiling projects
- [x] Smoke test clean; typecheck clean for these files
- [x] Reference recreations (see Notes)

## Layer reference

All five are category `pattern`, tileable, and use only `org_`-prefixed GLSL helpers.

| Type | SDF | Value (→ ramp) | `rnd` | Default outputs |
| --- | --- | --- | --- | --- |
| `marble` | no | 1 on veins, cloudy background up to `cloud` | per vein band (per tile with `tiles`) | diffuse (white marble ramp), roughness 0.25 → 0.45, height subtract (Relief 0.12: faintly etched veins) |
| `caustics` | mask (cells, off by default) | brightness: rims 1, glow → dark cell centres (net); bright blobs, dark cracks (blobs); Height: optional rounded dome per cell (`hval`) | per cell | diffuse (lava ramp), height **subtract** (blobs: **add**) 0.35, emissive ×0.6 |
| `wood` | output | grain (1 = light wood, 0 = dark lines / gaps) × plank-edge bevel | per board | diffuse (oak ramp, jitter 0.2), height 0.3 (per-board variation 0.25), bevel 1 px smooth |
| `scales` | output | dome / tilt shading × edge bevel, outline = 0 | per scale | diffuse (green-grey, jitter 0.15), height 0.5 (per-scale variation 0.3), bevel 2 px smooth, domain warp 2.5 px |
| `cracks` | yes (both outputs) | 1 on plates × bevel, the cracks sunk by their depth (fine cracks by their tone); Height: plate surface (dome, tilt, halo, roughness) less the fine grooves, × the same | per main plate (× fine with `sub_vary`) | diffuse (mud ramp, jitter 0.15), height 0.3, variation 0.3, bevel 2 px smooth |

### marble
| Param | Default | Notes |
| --- | --- | --- |
| `style` | ridges | ridges — the zero set (crest of `1 − \|n\|`) of a warped fBm drawn out along the angle: veins that meander, meet and taper out, one crest per noise cell · streaks (bands along a direction under turbulence) · network (contours of warped noise) · cells (warped Worley borders) |
| `veins` | 2.5 | ridges: noise cells across; streaks: bands per texture width; network / cells: noise cells across |
| `angle` | 30° | ridges / streaks; clockwise from horizontal, snapped to whole cycles per axis when tiling |
| `stretch` | 6 | ridges / streaks: draws the noise / turbulence out along the angle (long, flowing veins); network / cells: > 1 elongates horizontally |
| `levels` | 1 | network: contour lines per unit of noise |
| `turb` | smooth | streaks: smooth (signed noise) · kinked (`\|2n − 1\|`, the classic billow) |
| `warp`, `warp_scale`, `detail`, `rough` | 0.3, 2, 2, 0.35 | turbulence strength (vein periods / cells), cells across, octaves, octave gain (low = flowing, high = crinkled; more octaves and warp breed loops and hooks in ridges) |
| `fold` | 0.2 | streaks: a smooth warp at half the warp scale bending bands and turbulence together (vein periods) |
| `width`, `soft` | 1.6 px, 2 px | vein core and falloff (editor: sized to the texture, `1.6·√(w/512)`, `2·√(w/512)`) |
| `width_var`, `breakup` | 0.5, 0.1 | veins swell / thin; fade in and out (ridges: taper width and strength together, so ends are pointed; along stretched streaks the breakup noise is drawn out with them) |
| `flow` | 0.7 | ridges: width ∝ `(grad / gref)^(1.5·flow)` (clamped 0.2…3) — strong crests broad, weak ones thinning toward their ends. Streaks / network: the other way round, veins swell where the flow spreads (`d · (grad / gref)^flow`, clamped 0.25…3); `gref` is the field's typical gradient, fitted to renders |
| `fork` | 0.5 | Strands. Ridges: one side strand, the zero set of `n − 0.3·fork·s` for a second smooth field `s` (its own loop slot) — on the vein where `s = 0`, parting and fading as `\|s\|` grows. Streaks / network: side strands whose offset grows from zero along the vein (by the width noise) to `0.2·fork` periods, one each side. Strands are at least 1.5 px wide (thinner, they beaded into dotted lines), only appear once parted by a clear gap of ~0.75–2.25 px, and (ridges) only off firm crests — `grad / gref` over 0.35–0.8, and the crest field steeper than the offset field (`t − offset` is no px distance where the two gradients cancel; the strand smeared into a smudge) |
| `cull` | 0.7 | Loop culling. Ridges: the crest tapers (width and strength) as `grad / gref` falls below 0.15…0.75 × cull, where — drawn out by Stretch — it turns across the angle (`\|∇n·k̂\| / \|∇n\|` under 0.35), and where it bends tightly: its curvature from a quadratic fit over six samples (p, ±x, ±y, +x+y), fading out as the bend radius falls from 3 to 1 × (cull · 0.1 × the system's vein spacing) — hooks, hairpins and small rings open into pointed tips, for both vein systems. Streaks / network: fades veins where the field is flat (tiny rings and dots) and, for streaks, where a contour runs back against the bands (`∇F·k < 0`: the far side of closed loops and hairpin folds) |
| `cell_var` | 0.6 | cells: each cell's side of a border its own line weight, heavy to hairline |
| `halo`, `halo_width` | 0.3, 14 px | a soft wash of vein colour round the main veins; colour only (never in Height). Ridges: `(1 − smoothstep(0, 1.5·width, d))²`, culled with its core — no smudge round a culled crest, and as neighbouring washes don't overlap, no pale ribbon either. Other styles: exponential falloff. (Editor: width sized to the texture) |
| `fine`, `fine_style`, `fine_angle`, `fine_stretch`, `fine_scale`, `fine_width`, `fine_near`, `fine_patch` | 0.55, same, 30°, 0.5, 3, 0 (auto), 0.8, 0.5 | second vein system: strength, shape (the main style or another — cells gives a crackle), angle against the main veins, its stretch along its own angle relative to the main Stretch (its lattice direction found alongside the main one's, in one `mb_turbDir` call; ~0.25–0.7 reads best, 1 combs them into stacked dashes), density, core width (auto: hairlines, `clamp(0.35·width, 0.75, 1.5)` px), clustering round the visible main veins (a culled crest counts as far; within ~0.15 × the spacing), density patches across the slab (a low-frequency noise, its own loop slot) |
| `fine_wander`, `fine_break` | 0.35, 0.45 | the fine veins' own extra warp (in main-vein cells: spacing and direction vary locally — network / cells / ridges), and their breakup into tapering lengths |
| `filter` | on | anti-aliasing: each noise octave fades to its mean where its cells shrink under ~2–4 px (allowing for the fold's and the warp's squeeze) or where it alone would crowd the contours under a pixel (`fs · amp / cells` periods per px, fs the periods one unit of that noise moves F); F's gradient is taken over 3 px; streaks / network lines (with the halo, culling and clustering read from the same distance) blend to their average cover once their spacing is under ~2.5 × their width — not ridges or cells, which have no repeating contours (the test smeared strong crests) |
| `relief` | 0.12 | Height › Pattern (`hval`): 1 = the value; lower = mostly the veins, that much shallower (`r · (base·r + (1 − base·r)·vein)`), read with at least 2 px of falloff so no glints; with the default Height › Subtract the veins are faintly etched into polished stone |
| `tiles`, `tile_rot` | 0, 45° | cut into tiles across (each its own piece; rotated veins), 0 = off |
| `cloud`, `cloud_scale`, `cloud_stretch` | 0.25, 0, 1.5 | mottled background level; blotches across (0 = 1.5 × warp scale); ridges / streaks: drawn out along the veins |

**Unclamped noise.** Marble's Perlin (`mb_perlin`) isn't clamped to 0..1 as the library's is: clamping each octave puts
derivative kinks along closed curves round its peaks, where the crest's curvature spiked and the loop culling cut pale
hairlines through the veins. The curvature also floors the gradient at a third of the typical one.

**Open (after the quality pass):** a short parallel dash pair in some seeds (seed 42); fine veins mostly float rather
than branch off the main veins, and Fine clustering is subtle; the extreme "wild" settings (warp 1.5+, detail 4+) read
as crumpled foil; network / cells crackle stays even-sized; loop culling doesn't clear network-style rings; heavy
clouds drown the veins.

**Stretched turbulence on a torus.** The streaks' turbulence is sampled at `x = (p / uRes) · T`, axis 0 along the
veins (`warp_scale / stretch` cells), axis 1 across. Tiling needs `T` integer, and a rotated lattice only repeats on a
non-axis-aligned period lattice, so marble has its own Perlin fBm (`mb_fbm`) whose lattice points are reduced modulo
any integer period basis `B` (to the cell `B·[0, 1)²`; exact in small integers). `T`'s across column is a multiple of
a small integer direction within ~6° of the snapped wave vector (`mb_turbDir`, once per pixel), its along column the
integer vector with the wanted along-vein frequency (`cross(m, A) = ka`, via a Bezout pair of `m`) and the least skew;
`B` is where `T` takes the texture's repeats. With an axis-aligned period `(Px, 0, 0, Py)` it is the noise library's
`imod` wrap.

### caustics
| Param | Default | Notes |
| --- | --- | --- |
| `mode` | net | net (bright rims, dark cells) · blobs (bright domed cells, dark cracks) |
| `scale`, `jitter`, `size_var` | 5, 0.85, 0.5 | cells across; site jitter; power-diagram weights |
| `round` | 0.8 | 0 polygonal glow, 1 round blobs — F1 / F2 for weighted cells, `d1 / √(d1² + Δ)` with Δ the power distance to the nearest other site less the own: the plain F1 / F2 for equal weights, 0 at the site and exactly 1 on the weighted border from both sides (the plain ratio isn't, and the domes stepped there) |
| `stretch` | 1 | > 1 draws the cells (and their warp) out horizontally — flowing lava, a current |
| `warp`, `warp_scale`, `warp_detail` | 0.3, 1, 2 | soft warp in cells; frequency relative to the cells; octaves (more = ragged rims) |
| `rim`, `rim_soft` | 1.4 px, 0.5 px | bright core (net) / dark crack (blobs), measured on screen: the cell distance divided by its gradient through the warp's Jacobian (the warp noise one px right / up) and the stretch metric along the border normal (blended with the second-nearest bisector's within ~3 px of where they swap, or the medial lines from the junctions seam the height) — rims keep their px width instead of breaking into dashes |
| `rim_var` | 0.6 | rims widen and pinch along their length (smooth noise) and change brightness (that and a random per border segment; the glow follows only the smooth part) |
| `rim_round` | 1 | rounded rims: a smoothstep crest across the rim (at least 1.5 px wide; thinner rims dim instead of beading) meeting the glow in a soft maximum — no flat clipped core, no shelf in the height; junction pools keep deepening into bowls; flat plates (dome −1) get a rounded trough `½·rim + 5` px wide. 0 = a flat, clipped core |
| `glow`, `glow_smooth`, `glow_amount`, `falloff` | 1, 0.35, 0.65, 0.7 | reach (× cell radius, up to 3); a polynomial smooth minimum of the two nearest bisectors for the glow / dome (width × R; rounds the medial-axis creases, offset under width / 4 — log-sum-exp over all of them sank the whole dome); level next to the rim; curve (< 1 = wide plateau) |
| `octave2`, `octave2_scale`, `octave2_nest` | 0.3, 2, 1 | the finer net as rims / cracks of its own — cut in, darker and lower, in both modes — and in the height a soft groove of `½·rim + 3` px; its cells per main cell; how far it tapers (width and strength) toward the main rims (`smoothstep(0.05, 0.6, ·)` of the main cell's interior) |
| `dome`, `dome_var`, `cell_h` | 0.8, 0.6, 0.4 | Height › Pattern: 0 = the brightness (flat where the glow fades), 1 = a rounded dome per cell, −1 = flat plates (only the rims / cracks cut in); each cell's dome flat-topped to peaked; each cell's rise above the common rim floor its own (Height › Per-feature variation scales the whole depth instead, so it steps at every rim) |

**Stretch** measures the cells in a metric where they are square (`cl_cells`, a copy of `org_cellDist` with that
metric, a border normal, a per-segment random and a second soft minimum, without `continue`), so the 5×5 searches stay
exact — no straight cuts where a stretched cell outran them.

The height mode follows the mode (`linkedDefaults`): **Subtract** for the net (rims sink, cells bulge), **Add** for
blobs, unless set. The cells inside the rim cores / cracks (`½·rim − border distance`) go to the mask named in
*Write to* (`sdf: 'mask'`) — none by default, as a value pattern shouldn't replace the Shape mask unless asked; its
distance is continuous (the rim width varies only by smooth noise). Both octaves run in one loop, and all their noise
through one call site (warp x / y and rim variation at p, the warp one px right / up): cold D3D11 compile ~0.7 s.

### wood
| Param | Default | Notes |
| --- | --- | --- |
| `output` | wood | wood (grain × plank bevel, gaps = 0; the plank outline still goes to the mask it writes, `genOutShaded`) · shape (plank SDF → mask) · grain (no gaps / edges) |
| `planks` | on | off = one continuous piece (no boards; rings fold into arches with `figure`) |
| `direction` | vertical | vertical · horizontal |
| `count` | 4 | planks across |
| `gap`, `gap_y` | 1, 1 px | Gap X · Y: width of the up-and-down gaps (X) and of the gaps that run across (Y), on the left / top edge of each plank — between planks or at board ends depending on the direction. A single `gap` (older files) is copied to `gap_y` (FR8.17) |
| `joint_var` | 0 | Joint variation (FR8.22): each board's share of the gaps it carries (`1 − joint_var × hash`), also scaling its bevel (the bevel distance stretched by 1 / share), its crown and its Height › Per-feature variation — shut boards butt flush with hardly any edge; the grain stays. At 0 renders are pixel-identical to before |
| `joints`, `stagger`, `joint_rand` | 1, 0.5, 0.6 | board ends per plank along the texture (0 = full length); regular and random offsets |
| `width_var` | 0 | uneven plank widths |
| `end_wobble`, `end_wobble_px`, `end_var` | 0, 32 px, 0.1 | board ends wander by up to this much (bends this far apart), one line per joint shared by both sides plus `end_var` of each side's own; long edges stay straight (FR8.17) |
| `crown` | 0.25 | Height only: boards domed (> 0) or cupped (< 0) across their width |
| `grain_depth` | 0.35 | how deep the grain cuts in Height: plank surface = (1 − depth) + depth × grain, × the edge profile — gaps and bevels keep the full height; colour keeps the full grain (`GenOut.hval`, FR8.17) |
| `grain_px`, `grain_stretch`, `fine` | 2 px, 24, 0.6 | fine streak spacing, elongation, strength |
| `rings`, `ring_px`, `ring_line` | 0.6, 4 px, 0.4 | ring strength, spacing, latewood fraction |
| `ring_ramp`, `ring_var` | 0.6, 0.5 | earlywood fade (latewood darkening from deep in the earlywood to a sharp edge); ring irregularity (uneven widths, bands of tight years) |
| `grain_group`, `board_var` | 0.6, 0.6 | streak grouping (bands of tight streaks); board variety (per-board streak contrast, density, ring spacing, grain slant) |
| `grain_soft` | 0.4 | softness of the rings and fine streaks: 0 crisp (ring edges get one pixel of anti-aliasing, none with `aa` off), 1 soft rounded bands (FR8.17) |
| `cut` | cathedral | figure: cathedral arches (a heart diving into the board: nested open arches) · ovals (rings closed round a point once per board) — FR8.17 |
| `figure` | 0.5 | planks: fraction of boards cut through the heart; no planks: Cathedral the depth of the arched middle, Ovals the fold strength (gentle up to 0.5, then steeply stronger) |
| `ring_stretch`, `ring_warp` | 6, 0.5 | ring elongation along the board; wobble |
| `knots`, `knot_size` | 0.15, 3 px | knots per board: up to 1 the chance of one, above that many on average (≤ 4; bends add up, the strongest paints); radius across the grain |

The Shape group's `bevel` / `profile` / `aa` shade plank edges in the `wood` output too (the layer reads them
itself). Two-layer recipe for exact bevels: `wood` (`output: shape`, height on) then `wood` (`output: grain`,
same seed and plank params, diffuse on, height off, *Limit to* Shape: `lim_1: 'Shape'`); the gaps then show whatever is below
(the project base colour, or a dark fill layer).

### scales
| Param | Default | Notes |
| --- | --- | --- |
| `output` | scales | scales (shading with bevelled rims and outlines; the outline goes to the mask too) · shape (visible-scale SDF → mask) |
| `columns` | 4 | scales per row |
| `rows` | 0 (auto) | auto = row spacing equals the scale's length (radius × aspect: classic fish scale); rounded up to even when tiling |
| `radius` | 0.5 | × column width, up to 1.5 (0.5 = neighbours touch); clamped to 4 row heights |
| `aspect` | 1 | scale length along the rows' direction over its width (ellipses); auto rows follow |
| `direction` | up | up: lower rows lie on top; down: upper rows on top (arches point down) |
| `point` | 0 | free half of each scale a pointed arch: two arcs centred `2·point·r` to either side, squashed back to its length (distance divided by the squash's stretch along the normal) |
| `edges` | lapped | lapped: `genOutOwn` — each rim is bevelled (Bevel / Profile / aspect) down to ~0.8 × the hidden-end level of the scale beneath, and the outline is a crevice on the scale beneath (colour × (1 − c), Height × (1 − c/2)), so scales lie on one another; grooved: `genOutShaded`, every visible edge bevelled into an outline gap |
| `wobble` | 0.5 | each outline's 2nd / 3rd angular harmonics, random per scale, up to ~0.1 r (the scales grow by that, so no holes), and the dome off-centre by up to 0.075 r |
| `jitter` | 0.35 | centres move by up to ¼ column across and 0.3 row along, turn by up to 12° and lengthen by up to 30 %; every scale grows by the largest move, so no holes open where three meet; 0 is exactly regular |
| `size_var` | 0.3 | scales grow by up to 0.5 × this (only grow, for the same reason) |
| `outline` | 1 px | dark line along each visible edge |
| `dome`, `tilt` | 0.6, 0.4 | bulge around each scale centre; rise from where the scale comes out from under the row in front (1 − tilt) to its free edge (1): (front distance / (front distance + inside distance))^0.6, the front a smooth union (no crease) |
| `keel`, `keel_w` | 0, 0.6 | ridge down the middle of each scale: a V (crest rounded over ≤ 1.5 px) whose flanks fall to 1 − 0.7 × keel at `keel_w` × r |
| `lip` | 0.5 | lapped: a rolled band just inside the rim, past the bevel (width max(1.5 px, 0.07 r)), rises halfway to full height; the face behind sinks 12 % |
| `growth`, `growth_sp` | 0.15, 0.08 r | lapped: lines following the edge `growth_sp` × r apart, wavering (2θ, 3θ harmonics), unevenly spaced (monotonic remap), fading towards the focus and where they crowd under ~2 px (screen derivative of their phase), strength per scale; dark in colour (35 %), faint in Height (15 %) |

Shared defaults: a smooth profile, Height › Per-feature variation 0.3, a light green-grey ramp, Domain warp 2.5 px at
scale 2 (rows curve gently). Editor layers (`fresh`) grow the outline, bevel and warp with the texture (1 / 2 / 2.5 px
up to 128 px; 2 / 3 / 5 px at 512).

A scale's free edge stays on its row's line (± jitter): grown scales (Size variation, and the growth that keeps
Irregularity from opening holes) move their centre down by the growth and reach further under the row in front and
sideways, never up over the row behind (which left slivers); the dome stays where an ungrown scale's would be. Lapped
scales handle Height › Per-feature variation themselves (`GenOut.feat` = 0): only the relief above the level the rims
come down to varies, so a scale lying on another is never below it where they meet. Grooved scales split from their row
neighbours along the bisectors with their centres (the midlines when regular).

Lapped rims all come down to one level, `(1 − 0.8·dome)·(1 − tilt)·0.8`, and the covered side slopes down to it over
max(1.25, 0.4·bevel) px from the rim lying on it, so laps are clean anti-aliased crevices, never a step (with Outline 0
too). Where a visible part is under ~3 px across (own edge to the scale on top) it sinks to that level, so slivers read
as crevice. Holes (rows set far apart) are measured from the union of every scale walked, not the visible part's own
distance (which is ~0 along every lap and drew a dotted line).

Overlapping scales of a row lap: each has a random rank, and a scale loses the shapes of the scales up to three columns
either side that rank above it (ties — a scale meeting its own repeat — go by column), so they meet along the upper
one's rim. One flat loop over rows × 9 columns (11 once a scale reaches past 1.5 columns) with a sliding window of
seven, so each shape is evaluated once; the extra columns also keep the smooth front union from stepping where the
pixel crosses a column (cold D3D11 compile ≈ 0.65 s).

### cracks
| Param | Default | Notes |
| --- | --- | --- |
| `output` | plates | plates (painted by the layer, `genOutOwn`: value 1 on the plates × its own Shape bevel — `org_edgeProfile`, so no Bevel aspect and no bevel round a combined mask mode — the cracks sunk by their depth; the plate outline goes to the mask it writes) · shape (plate SDF → mask, the cracks show what is below) |
| `scale`, `jitter`, `size_var` | 5, 0.9, 0.5 | main plates across (0.5…256); jitter; power weights (main network only, 0…2: above 1 small plates get squeezed out) |
| `width`, `width_var` | 2.5 px, 0.8 | main crack width (0…64 px); spread of widths — one random per border segment (0.55–1.45; both plates agree on it), blended between the two nearest borders where they swap (no step at a junction), × a noise along the cracks, × a flare towards the junctions where wide cracks meet (`1 + 1.5·width_var·exp(−second border distance / 0.15 plate)` × smoothstep(0.7, 1.3) of the two widths against the mean, off where the two borders' normals oppose: thin slivers). The fine cracks and shards follow the same noise (whole stretches of the fine network dark, others faint hairlines) × a mild per-segment spread (0.5–1.5) |
| `fillet` | 0.05 | Junction rounding: each plate's corners round off with a circular fillet (`crk_round`, exact elsewhere) of this share of a plate × the meeting cracks' widths against the mean (0.5–1.5: thin cracks meet in tight corners); the band is laid round the rounded plate, so the gap between three plates is a dark wedge with concave sides. Fine cells (share of a fine cell), shards and fine–main joins alike (a fine segment dropped by Connected only gives up its rounding) |
| `bulge` | 0.08 | each border bows in a half sine between its ends (up to this share of a plate, a signed random per cell pair), continuing as a gentle S along long borders, flattened towards the junctions (second-border distance) and faded with the distance from the border (no seam on the plate's skeleton); a pixel carried across the border belongs to the neighbouring plate (its random, offset, normal) |
| `depth_var` | 0.5 | Depth by width: a crack's depth k = mix(1, clamp(0.2 + 0.8·(half width + what the rounding opens) / (0.75·width)), depth_var) — narrow stretches shallow and light, wide ones and junction wedges at the ramp's bottom; value and Height = 1 − k·(1 − bevel × coverage) |
| `zigzag` | 0.6 px | Jaggedness (0…64, slider 16): a domain displacement of the cracks' course by bilinear value noise (2 octaves, lattice ~5× the amplitude, ≥ 4 px) — straight runs with sharp kinks |
| `jag` | 0.25 px | Edge roughness: a ~2 px value noise added to the crack distance; above half the width cracks break into dashes |
| `warp`, `warp_scale`, `warp_mode` | 0.2, 0.8, bend | bend in plate sizes; bends per plate (the field is a 3-octave Perlin fBm, gain 0.38, from half this frequency: flowing meanders without a single visible period or a corrugated ripple; shards are laid out unwarped, the warp being coarse against them); style: **bend** (8 steps along the curl of the field: plates keep their areas, high values swirl), **squeeze** (8 steps along the field: plates bunch up and spread) |
| `sub`, `sub_scale`, `sub_width` | 0.55, 2.5, 1.25 px | fraction of fine segments kept; fine plates per main plate (1…16); width where they leave a main crack. The fine plane warps by 0.7 × Warp per fine plate |
| `sub_taper` | 0.7 | fine segments narrow with the distance from the main cracks to nothing at their own reach (`crk_reach`: 0.12–0.87 plate, mostly short, ÷ taper); under 1 px they fade instead of staying a half-dark line. 0 = even width |
| `sub_tone` | 1 | Fine darkness (colour only): the fine ink is coverage × (0.2 + 0.55 × strength) × this — low values leave a faint grey hairline web |
| `sub_depth` | 0.55 | Height: the fine cracks are grooves of their own, this share of the main cracks' depth × their strength, a rounded V out to shoulders the bevel's width (≥ 1 px); colour draws them by Fine darkness. Not in the mask |
| `sub_connect` | on | the nearest segment is followed to both ends (its line to the cell's next border, from the 5×5 sites kept in an array): dropped when its crack-ward end neither reaches the main crack (its border taken as straight) nor meets a present segment heading on towards it, when it runs within ~40° beside a main crack, its middle within 0.3 plate (doubling it, or boxing in a corner), or when it is under 8 px long (specks); an inner dead end tapers to a point along its whole length (with Taper 0 too) |
| `sub_shape` | off | on: fine cracks cut the plates like the main ones (in the SDF: full depth, the mask, Shape output) |
| `sub_cross` | off | on: one fine network over the texture, crossing the main cracks; off: each main plate keys its own segments, so fine cracks end at the main ones |
| `sub_vary` | off | on: each fine plate its own random; off: one per main plate — the fine network is partial, so per-fine-plate colour or height would change across missing cracks |
| `shatter`, `shatter_scale` | 0, 5 | Shatter: this share of the fine plates (one random per fine plate × main plate; the fine cells are computed even with Fine cracks 0) breaks into shards — a second pass through `crk_fineCracks` (one copy, a 2-pass loop) with `shatter_scale` × the fine cells, jitter 1, 85 % of segments, untapered, unconnected, half width max(0.5·width, 0.75) px — dark and full width within 0.25 of a fine plate of its site, fading out by 0.5 (the band narrowed by the rest of its width) and before the fine border, × 0.7–1 by nearness to a main crack: a compact jagged cluster, never cut along the border. The pass runs only in a shattered plate's fade |
| `halo` | 0.3 | Depth halo (colour × 1 − 0.45·halo, Height × 1 − 0.6·halo): broad pools round heavy junctions (flare² × exp(−distance to the vertex, |(nearest, second border distance)|, / 0.3 plate)) plus a little along wide stretches |
| `rough` | 0.3 | Height: a 3-octave Perlin noise (8 per plate) on the plate surface |
| `dome`, `dome_edge`, `tilt` | 0.35, 0.5, 0.3 | Height only (`GenOut.hval`): > 0 the edges fall away, < 0 they curl up into a lip, over the outer `dome_edge` of t = border distance / (border distance + distance to the site), the border distance a soft minimum over the plate's borders (log-sum-exp, 0.12 plate; no creases along the skeleton) in the warped plane; each plate tilts its own way by a random share. Colour darkens by 0.3 × the fall |

Widths are true screen px under the Bend / Squeeze warps: each border's distance is divided by the warp's stretch across
it (`dFdx` / `dFdy` of the warped point, taken before the zig-zag, whose kinks are too fine for quad derivatives).
Editor defaults (`fresh`) scale `width`, `sub_width`, `zigzag` and `bevel` (2 px at 512) with the texture and use fewer
plates and fewer, longer fine cracks at ≤ 128 px; the match template takes them too.

Glowing cracks (lava crust): a second `cracks` layer with the same params and seed, Shaping →
Invert on, diffuse off, emissive on (value = 1 in the cracks), or later layers limited to *Outside* the Shape mask.

## Notes and constraints
- **Tiling.** Every lattice / noise uses whole cell counts per axis (`cellsFor`) and wraps its hashes. Marble
  streak angles snap to whole cycles per axis (like `stripes`). Wood: plank edges / joints are whole px and
  repeat with the texture; rings are periodic along each board (`sin` wrap), and across the texture in
  no-planks mode, where the ring spacing is snapped to a whole count; knot bending is windowed (fades out
  by 4 radii) and wraps. Scales force an even row count. Verified with 2×2 tiled renders.
- **Combined outputs.** The generator wrapper replaces an SDF pixel's value with the bevel profile, so wood,
  scales and cracks fold their own value × `org_edgeProfile(d)` × coverage into a NO_SDF pixel by default (no
  mask write) and offer an SDF output for the mask. See *Recommended shared change* below. (Since then
  wood and scales return their pattern with `genOutShaded`: the wrapper applies the bevel and writes the mask.
  So does cracks' Plates output, with its plate surface as `hval`.)
- **Derivatives.** Wood fades growth rings that crowd closer than ~2 px with `dFdx/dFdy` of the ring field
  (anti-moiré); called in uniform control flow.
- **Shader size.** The helpers use a lean `org_noiseFbm` (value / Perlin, optional billow) instead of
  `fractalNoise`, whose generic dispatch inlines Worley at every call site. On D3D11 (Chrome's default on
  Windows) nested loops of noise calls compile slowly, so each shader runs its noise in **one flat loop** with a
  single call site, its arguments chosen per iteration. Marble's loop covers the warp components and the field at
  p and one px right / up; the background noise is a third pass of the vein-system loop; and its Worley border is a
  flat-loop copy (`org_worleyBorder`). Cracks' loop covers the warp steps, the fine warp, zig-zag, roughness and
  width noise. The Voronoi searches (`org_cellDist`, cracks' `crk_plates` and fine cracks) are single flat loops. Loop
  bounds use `ORG_1` (1, read from a uniform), so D3D can't unroll them. Marble's quality pass folded all three
  vein systems (each: its width / breakup noise, then the field's nine evaluations; the background) into one flat
  loop with a single `mb_fbm` call and no `continue` (ANGLE / D3D11 can miscompile it): with the new
  controls it compiles in ~1.4 s (0.8 s before the pass; 41 slots now — per system 20: the width noise, six field samples ×
  (warp x, warp y, F), the fine veins' patches or the ridges' strand field; flattening the Worley border search into
  the loop too didn't help). Cold D3D11 compiles: marble 2.2 → 0.8 s,
  cracks 1.5 → 0.8 s (output unchanged, apart from float rounding in a few pixels); the cracks quality pass brings it to
  ~1.2 s (fine-crack connectivity and the kinked zig-zag; no `continue` in its loops). The fixed overhead is ~0.2 s. Measure with `tools/compile-time.ts`.
- **Small textures.** At 16×16 the defaults read as noise (cells / veins of 3 px); lower the scale counts.
- **Limitations.** No diagonal wood (rotated plank frames are not tileable in general); at most four knots per
  board; marble network / cells styles have no rotation (use `stretch`); per-tile marble shares the vein
  angle snapping of the whole texture; tiled stretched ridges / streaks snap the noise's direction to within ~6° of the
  veins', and moving Stretch off exactly 1 changes the noise realisation (a rotated lattice).

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
wood / scales / cracks could write a mask *and* carry grain / shading in one layer, and the combined
outputs here would become unnecessary.
