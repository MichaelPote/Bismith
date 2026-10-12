# FR7.2d — Tech / greeble generators: panels, vents, pipes, trim

**Status:** done. There are four generator types: `panels`, `vents`, `pipes` and `trim`, all in category `pattern`.
- `src/layers/generators/greeble.ts` exports `GREEBLE_LAYERS`, which is already registered.
- `greebleCommon.ts` holds the shared `grb_` GLSL helpers.
- `greeblePanels.ts` holds `panels`.
- `greebleVents.ts` holds `vents` and `pipes`.
- `greebleTrim.ts` holds `trim`.

## Goal
Bespoke generators for the machine-made motifs that generic layers cannot build:
- subdivided machine panels
- slot grilles, louvres and perforated plates
- pipe runs
- trim strips (256×16, 256×32, 128×16/32)

All four are tileable and per-seed deterministic. They work on non-square and small textures.

## Design: one layout, several outputs
Every greeble layer is an SDF generator (`sdf: true`) with an **`output`** enum. There are two kinds of output:

- **Relief (value).** The default output. It composes the whole motif into one 0..1 height value:
  - panel plateaus at per-panel levels, seams, frames, rivet domes, sunken slots, louvre fins, half-cylinder pipes, band profiles
  - main edges use the layer's own **Shape** params (bevel width, profile, anti-alias)
  - it returns `sdf = NO_SDF`, so the wrapper passes the value through and leaves the shape register untouched
  - out of the box it gives a complete height map, and a value-mapped diffuse ramp (dark seams → metal → bright rivets)
- **Shape outputs (SDF).** Each returns the signed distance of one element class, such as panels, seams, rivets, lights, slots, clamps or bands:
  - the common bevel, profile, SDF combine and clip params apply to it
  - `rnd` is per element (per panel, slot, pipe run, block or element)
  - stacking copies of the layer with the **same seed and layout params** but different outputs gives one layout with several materials. Examples: relief → height + base colour; rivets → brass diffuse; lights → emissive; band 1 → a clip mask for a stucco noise. The `rp3` and `rt1` recreations below do this.

Why not a single SDF output? The wrapper replaces `value` with the bevel profile whenever `sdf > NO_SDF`. An SDF output therefore can't also carry per-panel height steps or rivet domes. The relief output is the self-contained alternative (see the shared-change notes below).

## Plan / checklist
- [x] Shared helpers `grb_cov`, `grb_rise` (layer profile with coverage fallback), `grb_box/rbox`, `grb_rand`, `grb_snapC` (pixel-snapped centres), `grb_dome`.
- [x] **panels**:
  - bounded iterative kd-descent: a split, axis and cut per node are hashed from the node's path id; cuts snap to a grid
  - min/max size, split chance, cut bias, cut randomness, layout offset
  - seams on the left/top of each panel (crisp whole-px)
  - per-panel height levels
  - inset frame (groove / ridge / recessed centre / raised centre)
  - rivets (corners / along edges)
  - details: vent slots, light with housing, recess
  - seven outputs
- [x] **vents**:
  - slots (round/square ends), louvres (angled fins with signed slant), holes (round/square)
  - rows × cols cells, horizontal/vertical slots, stagger
  - border frame (margin) with a recessed field level
  - full-length slots become continuous bars
  - a 1 px bar is kept between slots and holes
  - four outputs
- [x] **pipes**:
  - horizontal/vertical runs, count, bundle (pipes side by side)
  - diameter with per-run variation, jitter, offset
  - round (true half-cylinder) or conduit (bevelled) profile
  - clamp rings: count, width, lip, offset, per-run phase jitter (bundles share straps)
  - four outputs
- [x] **trim**:
  - six bands (px height, profile, level), mirror about the centre, stretch band
  - eight band profiles: flat, bead, cove, ridge, groove, step, chamfer in/out
  - dividers (groove / seam / raised bar, inset, offset)
  - elements (rivet, ringed bolt, slot along, slot across, round hole, square hole)
    - laid out evenly along the tile or within each block
    - 1–64 rows, row spacing, stagger
  - five outputs
- [x] Typecheck, smoke (`--only panels,vents,pipes,trim`, 64 px and 32 px).
- [x] Robustness: 16×16, 256×16 and non-tiling 48×40 renders of every output.
- [x] Tiling check: 2×2 repeats.
- [x] Reference recreations (see below).

## Param reference

Common to every type:
- `output`, `seed`.
- The Shape params apply: `bevel`, `profile`, `aa`, `sdf_op`, `sdf_k`.
- Relief uses `bevel` and `profile` for the main edges.

Defaults:
- height add, ~0.6 amount (pipes 1.0)
- `bevel` 1 px, `profile` linear (pipes: 2 px round)
- diffuse = value through a dark→metal ramp

### `panels` — Machine panels
| Param | Default | Notes |
| --- | --- | --- |
| output | relief | relief · panels · seams · frames · rivets · details · lights |
| depth | 4 | max split levels (≤ 12) |
| min_size / max_size | 8 / 32 px | no child side below min; sides above max are always cut (when min allows) |
| split | 0.6 | chance to cut a panel that is between the min and max sizes |
| bias | 0 | −1 vertical cuts (columns) … +1 horizontal cuts (rows); 0 = cut across the longer side |
| split_var | 0.7 | 0 = cut in the middle, 1 = anywhere |
| snap | 4 px | cut grid from the tile origin (falls back to whole px) |
| gap | 1 px | seam along the left/top of each panel |
| round | 0 px | corner rounding |
| levels / height_var | 3 / 0.3 | per-panel plateau levels: `0.75·(1 − var·level)` |
| inset_depth | 0.25 | groove, recess and light-housing depth (relief) |
| offset_x / offset_y | 0 | shift the layout (moves the tile-edge seam) |
| frame_chance, frame_style, frame_inset, frame_width | 0.35, groove, 3 px, 1 px | groove · ridge · recess · raise |
| rivets, rivet_chance, rivet_radius, rivet_inset, rivet_spacing, rivet_height | corners, 0.6, 1 px, 2.5 px, 8 px, 0.3 | rivets: none · corners · edges. Radius 0.5 → 1 px, 1 → 2×2, 1.5 → 3×3 |
| detail_chance, det_vents / det_light / det_recess, det_size, vent_pitch, vent_slot, light_size | 0.3, all on, 0.6, 3 px, 1 px, 2 px | one detail per chosen panel, centred, `det_size` of the panel |

### `vents` — Vents & grilles
| Param | Default | Notes |
| --- | --- | --- |
| output | relief | relief · slots · plate (metal between slots) · frame (border) |
| mode | slots | slots · louvers · holes |
| cols / rows | 2 / 8 | cells across the field. Use an even row count with stagger to tile |
| orient | horizontal | slot long axis (ignored for holes) |
| length / width | 24 / 3 px | slot size; holes use width as the diameter. Length ≥ cell → continuous bars |
| ends | round | round · square (also the hole shape) |
| stagger | 0 | shifts alternate rows along the slots (fraction of a cell) |
| louver | 0.8 | fin slant −1..1 (0 = rounded bars) |
| margin | 0 px | border frame round the tile; > 0 makes a framed vent (slots are clipped to the field) |
| field_level | 0.8 | plate height inside the frame; the frame is 1 |

### `pipes` — Pipes & conduits
| Param | Default | Notes |
| --- | --- | --- |
| output | relief | relief · pipes · clamps · both |
| orient | horizontal | pipe direction |
| shape | round | round (half-cylinder heights) · conduit (flat top, bevelled) |
| count / bundle | 3 / 1 | runs across the tile, and pipes side by side per run |
| diameter, dia_var, jitter, offset | 8 px, 0, 0 px, 0 | diameter is clamped so that runs never overlap |
| clamps, clamp_width, clamp_lip, clamp_offset, clamp_jitter | 2, 3 px, 1 px, 0, 1 | rings per pipe along the tile; the phase is random per run |

To use pipes as a shape, set the Round profile with bevel ≈ radius. That gives a half-cylinder in the shared bevel path.

### `trim` — Trim strip
| Param | Default | Notes |
| --- | --- | --- |
| output | relief | relief · blocks · dividers · elements · band (`sel_band`) |
| orient | horizontal | strip direction (vertical: bands from the left edge) |
| mirror | true | bands run from both edges to the centre. A band touching the centre joins its mirror image, except the chamfers, which make a roof/valley |
| fill | 4 | this band stretches to fill the remaining height (0 = none: the last band's level continues) |
| band1..6 / prof1..6 / level1..6 | 1 flat 0.1 · 2 bead 0.9 · 1 flat 0.45 · 4 flat 0.7 · 0 · 0 | px heights from the outer edge; profile shape × level |
| div_count, div_style, div_width, div_inset, div_offset | 0, groove, 1 px, 0, 0 | groove bevels the blocks down into the seam; seam = flat line; bar = raised |
| elem, elem_layout, elem_count, elem_inset | rivet, even, 8, 4 px | none · rivet · bolt · slot · vslot · hole · square. Layout `block` spaces Count from Inset to Inset within each block |
| elem_size, elem_len, elem_y, elem_rows, elem_row_gap, elem_stagger, elem_offset, elem_height | 1.5 px, 6 px, 0.5, 1, 8 px, off, 0, 0.3 | size is the radius or half-width; rows are centred on `elem_y` |

## Reference recreations
The project files are in the session scratchpad: `…/scratchpad/greeble/rec/*.json`, with `_ref` naming each target. Each one stacks the greeble layer(s) with noise, cavity, tonemap and the reference's palette.

| Recreation | Match |
| --- | --- |
| `rp1` 2×2 riveted panels | Strong structural match. Our seams are slightly harsher. |
| `rp2` overlapping plates | Fair. Steps and edge rivets are right; the plates are less "overlapped". |
| `rp3` busy tech panel | Good style match. Layout is random, not the hand-drawn symmetry. |
| `rv1` staggered slots | Near-exact. |
| `rv2` framed hole grid (ellipse for the side notches) | Strong. |
| `rv3` recessed rounded slots (slots SDF subtract) | Strong. |
| `rv4` perforated plate | Good. |
| `rv5` framed louvres | Good. |
| `rv6` framed vertical slot grid | Near-exact. |
| `rq1` packed pipes + machinery strip (panels clipped to a rect) | Good. |
| `rq2` bundled vertical pipe bank | Plausible. |
| `rt1` vertical riveted plate between stucco bands | Near-exact. |
| `rt2–rt7` trim strips | Strong structural match: slot ladder, bolts, short slots, red rivet strip, green 2-block riveted plates, orange 4-block plates with rivet columns. |

## Notes and constraints
- **Pixel alignment.**
  - Seams and cut positions are whole px.
  - Feature centres use `grb_snapC`: the leading edge is snapped, so odd-sized features centre on a pixel centre and even-sized ones on a pixel corner.
  - Rivets mirror exactly: the near-edge margin is whole px on both sides.
  - Whole-px params with `aa: false` give crisp 1 px features.
- **Tiling.**
  - `panels` subdivides the whole tile and wraps the pixel into it. The tile border is always a seam, so use `offset_x/y` to move it.
  - `vents` wraps its lattice when `margin = 0`. With a margin it is one framed panel per tile.
  - `pipes`, `trim` dividers and elements use whole counts per tile.
  - With stagger, use an even row count.
- **Bounded loops.** Panels descend at most 12 levels. Vents check a 3×3 cell neighbourhood, pipes 3 runs. Trim checks 6 bands and 3 rows × 3 elements.
- **Small and odd sizes.** Slot width is clamped to keep a 1 px bar. Pipe diameter is clamped to the run spacing. Panels skip cuts and details that don't fit, and rivets that don't fit the panel.
- **Value range.** Relief values are clamped to 0..1. Panel plateaus sit at ≤ 0.75 so rivets and raised frames have headroom. Pipes are normalised by the clamp radius.

## Possible shared improvements (not done here)
1. **Value-carrying SDFs.** Let a generator keep its own `value` alongside an SDF, for example a `LayerDef` flag or a `GenOut` field that multiplies the bevel profile. Per-panel height steps and rivet domes could then combine with the shape register in one layer instead of needing the relief/NO_SDF route.
2. **Emissive colour ramp.** Emissive is `colour × intensity × value`. Per-feature light colours (red/green/amber panel lights) need a gradient source like the diffuse ramp.
3. **Promote helpers.** `grb_snapC` (pixel-snapped centre) and `grb_rise` (profile with a coverage fallback) are generally useful and could move to `glsl/common.ts`.
4. **Parent checklist.** `fr7.2-bespoke-generators.md` already links here; its "Greeble generators" checkbox can be ticked. The presets could also get a greeble example, such as a tech wall or a riveted trim.
