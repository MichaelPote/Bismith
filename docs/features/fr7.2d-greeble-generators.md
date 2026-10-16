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
  - the relief also writes the shape mask by default (Panels' plates, Trim's strips, Vents' plate; each layer's
    *Shape mask* choice, `none` to leave the register alone) through `genOutOwn`, which keeps the relief as the value;
    `LayerDef.writesMask` tells the Clip to labels when that happens
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
  - slots (round/square/pointed/angled/hex ends, adjustable point length), louvres (sunken fins or blade grilles with a signed slant), pressed hoods, holes (round/square/hex)
  - rows × cols cells, horizontal/vertical slots, stagger, Column / Row spacing
  - framed panel: recessed field, corner radius, outer bevel, fasteners (dome / slotted / cross heads)
  - full-length slots become continuous bars
  - a 1 px bar is kept between slots and holes
  - slot depth, chamfered rims with an optional bead, per-slot depth variation (dished) and missing slots (plugs)
  - four outputs; the relief can hand the plate, the openings or the frame to the shape mask
- [x] **pipes**:
  - horizontal/vertical runs, count, bundle (pipes side by side, with a gap and per-pipe variation)
  - diameter with per-run variation, jitter within the free space, offset
  - round (true half-cylinder) or conduit (bevelled trunking with crown and lid seams), heights normalised or true to size
  - joints: couplings, flange pairs or weld beads, in proportion to the pipe
  - clamp straps: count, width, lip, feet with bolts, offset, per-run phase jitter (bundles share straps)
  - four outputs; the relief can hand the pipes and/or clamps to the shape mask
- [x] **trim**:
  - six bands (px height, profile, level, base), mirror about the centre, stretch band
  - twelve band profiles: flat, bead, cove, ridge, groove, step, chamfer in/out, quarter round in/out, ogee in/out
  - strips stacked across the texture (count, height with a gap round it, position, stagger)
  - dividers (groove / seam / raised bar, depth, inset, offset, length variation)
  - elements (rivet, ringed bolt, slot along, slot across, round hole, square hole, hex head, slotted screw)
    - laid out evenly along the tile or within each block
    - 1–64 rows, row spacing, stagger; hole depth, head turn, missing share
  - six outputs; the relief can also write the Shape Mask (`mask_shape`)
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
Like vents and trim, the relief **writes a shape to the shape mask** (`mask`, *Shape for the mask*, default plate tops;
`none` leaves the mask alone; `writesMask` tells the Clip-to labels): plates, panels, seams, frames, rivets, details or
lights, through `genOutOwn` — later layers clip to it (grime in the seams: *Outside the shape mask*), chip or bevel from
it, while the relief value stays the layer's own. *Plate tops* leaves out everything sunk into the plates (slots, holes,
recesses, housing rings, groove lines, recessed centres) and keeps what stands on them (lenses, hinge knuckles, pipes,
ribs); *Panels* only the seams.

The relief is scaled so its peak fits under 1 — the top plateau with its bulge plus the highest thing that can stand on
it (a raised frame, with rivets, a pipe or ribs on it; a rivet or bolt; a lens dome) — instead of clipping, so levels,
domes and raised centres keep their shape. Each panel's bevel is at most a fifth of its shorter side; details stay
clear of frame lines, rivets and cut corners and a bevel + 2 px in from the panel edge; recesses sink at most half of
what stands under them (no black holes when nested); slots and holes have a 1–2 px sloped rim; frames whose lines would
sit closer than 4 px and lenses thinner than 3 px are left out.

The plain defaults are the full look for a 128 px texture. A layer **added in the editor** (`fresh`) scales the sizes
to the texture: `k` = mean side / 128, so 512 px gets 4× them (min/max 28/160 px, 4 px cut grid, 3 px main seams,
2.5 px bevel, 3 px rivets, frames and rivets from 40 px panels, details from 32 px, 5 px min tube…). Small textures
(≤ 96 px) get crisp edges: a linear 1 px bevel without anti-aliasing. Seams, frame lines and housings stay whole px.

| Param | Default | Notes |
| --- | --- | --- |
| output | relief | relief · panels · seams · frames · rivets · details · lights |
| mask | plates | relief only: none · plates (plate tops) · panels · seams · frames · rivets · details · lights (see above) |
| root | pinwheel | tile (cut in two, or as a pinwheel by `pinwheel`) · pinwheel (the first split always a pinwheel, its centre panel within the middle 30–70 % each way so no root seam spans more than 70 % of the tile; cuts below it that would land within two seams + two bevels of a root seam move off it, or go the other way — measured: no interior seam over 67 % of the tile at 512 px) · windmill ("Interlocked": the 15 pieces of the windmill tiling whose squares sit on the lattice (1, 2), (−2, 1) of a 5 × 5 grid, repeating every 5 cells both ways, grid lines jittered per seed — no border seam; `WINDMILL` in the source, tested to cover the torus once with no grid line uncrossed) |
| depth | 16 | max split levels (≤ 24; a uniform-bounded loop). It stops the splits before Max panel does |
| min_size / max_size | 7 / 40 px | no child side below min; sides above max are always cut (while min and depth allow) |
| split | 0.65 | chance to cut a panel that is between the min and max sizes |
| cluster | 0.45 | regions decide together: the split chance moves by ±1.5·cluster with a "busyness" inherited down the tree (re-drawn mostly in the first 4 levels), capped at max(split, 0.85) so busy zones keep some variety — busy zones of small panels next to calm plates |
| pinwheel | 0.3 | chance a node splits into five (four arms winding round a centre, either sense) instead of two; needs room for three panels each way |
| aspect | 1 | height ÷ width of min and max (geometric mean kept): > 1 tall panels / columns, < 1 wide panels / rows. Unlike the bias it also stretches the forced (max-size) cuts |
| bias | 0 | optional cuts: −1 vertical (columns) … +1 horizontal (rows); 0 = cut across the longer side |
| split_var | 0.7 | 0 = cut in the middle, 1 = anywhere |
| snap | 1 px | cut grid from the tile origin (falls back to whole px) |
| gap | 1 px | seam along the left/top of each panel |
| edge_seam | 0.34 | the tile-border seam as a share of `gap` (whole px; 0 = border panels meet with only their bevels) — thin keeps tiled copies from showing a grid of wide seams |
| seam_max | 0.12 | no seam wider than this share of its panel's shorter side (≥ 1 px): thin seams in busy zones |
| seam_taper | 0.5 | each level of cuts narrows its seams by this fraction, whole px, ≥ 1 px (level 0 = the first cuts and the tile edge keep `gap`) |
| cut_chance, cut_size | 0.35, 0.2 | share of panels with cut corners — one, two opposite or all four chamfered (45°), or one notched (its inner corner rounded by min(Corner rounding, leg / 2); an inset frame steps round it with a rectangle), legs `cut_size` × the shorter side (none under 6 px or under Corner rounding + 2); a backing plate at half the plateau shows in the cut, frames follow it, rivets and details keep clear (`grb_corner`, one evaluation per pixel) |
| round | 0.5 px | corner rounding |
| levels / height_var / min_level | 4 / 0.35 / 0.25 | per-panel plateau levels, evenly from 0.75 down to `0.75·max(1 − var, min_level)` |
| bulge, bulge_spread | 0.12, 0.7 | a pillow over each panel rising over the outer `mix(0.3, 1, spread)` of each half-width — 0 a cushion with a flat top, 1 a full dome — in proportion to its plateau (`bulge` on the top level), and on raised / recessed centres too; negative dishes, −0.75 down to the floor |
| inset_depth | 0.25 | groove, recess and light-housing depth, raised-frame rise (relief) |
| offset_x / offset_y | 0 | shift the layout (moves the tile-edge seam) |
| frame_chance, frame_min, frame_style, frame_inset, frame_width | 0.35, 16 px, mixed, 3.5 px, 1 px | groove · ridge · recess · raise · hatch (a groove; on one long side two hinge barrels on the line, three knuckles each split by 1 px gaps, rivets kept off them; a latch slot opposite; the door a hair proud) · mixed (one of the five per panel). `*_min`: panels smaller than it (√ of the area, so long strips still count) get none |
| rivets, rivet_chance, rivet_min, rivet_radius, rivet_inset, rivet_spacing, rivet_height | mixed, 0.6, 12 px, 1 px, 2 px, 8 px, 0.3 | none · corners · edges · sides (the two long sides) · mixed. Radius 0.5 → 1 px, 1 → 2×2, 1.5 → 3×3. Rows of rivets need a rivet's width between them; an axis too short for that gets one line down its middle (a strap), a panel short both ways none |
| detail_chance, det_min, det_vents / det_light / det_recess / det_holes, det_size | 0.55, 12 px, on / on / on / on, 0.6 | one detail per chosen panel, `det_size` of the panel, clear of the panel's frame line or raised / recessed step and rivets |
| det_var, det_anchor, det_pair | 0.4, mixed, 0.35 | size variation (down to (1 − var) × size); placement centre · edge · corner · mixed (random side); paired: the area split along its length (30–50 %, a gap between), each part its own kind |
| recess_wall, det_bay | 1.5 px, 0.5 | recess wall slope (0 = the Edge bevel); share of slots / perforations set in a recess of their own |
| det_ribs, det_pipes, pipe_size, pipe_min, pipe_runs | on, on, 0.15, 2 px, 3 | ribs: rounded bars standing up (0.8 × inset depth) on the slot grid. Pipes & handles: half-round tubes `pipe_size` × the area's short side across (at least `pipe_min`; handles at least 3 px), raised by inset depth on whatever is under them (a raised centre too), butting a flange plate at each end with a 1 px contact line round them — a pipe run of 1…`pipe_runs` parallel tubes (as many as fit across with their elbow and leg) along the area turning through concentric round elbows off one long edge (measured as an offset from the innermost run, one evaluation for the bundle), only where the area is 16 tube radii long, else a straight grab handle (at least 4 diameters long) |
| (kind choice) | | a detail picks only among the kinds that are switched on *and fit its area* — a grille or ribs three bars, a perforation 3 × 3 holes, a light a 3 px lens, a pipe or handle its tube with flanges — so a panel that gets a detail never stays blank. Lights, too, sink into what is under them |
| hero, small_parts | 0.6, 0.5 | hero parts: share of the panels ≥ 2.5 × `det_min` whose detail fills 0.9 of the panel, centred, unpaired: a recessed grille, recessed perforation, light panel or pipe run — only among the kinds switched on. Small parts: share of the panels below `det_min` that get one bolt or one short slot (1 px walls, a flat floor; off while the detail Chance is 0) |
| vent_pitch, vent_slot | 2 px, 1 px | slot pitch and width; the perforation uses them as hole pitch and diameter |
| light_style, light_size, light_rel, light_len, light_rim, light_dome | mixed, 1.5 px, 0.3, 3, 1 px, 0.35 | lens (centred, size × length) · row of round lamps · strip · light panel (fills the detail area) · mixed; rows and strips run along a random long edge. Size at least `light_rel` × the area's short side (half that for a row's lamps, so rows hold several). Housing width; lens dome height (0 = flat lens sunk in the housing) |

### `vents` — Vents & grilles
The relief writes the shape mask by **Shape for the mask** (`mask`): the plate (metal, frame and fasteners, openings
cut out; the default), the openings or the frame (`genOutOwn`, by the Mask card's mode), or none (`writesMask` then
doesn't list the layer as a writer). Later layers clip to it — paint only the plate, or grime only inside the slots — or bevel from it. Its
random is per slot inside the slots and one value on the plate, and Per-feature variation is off on the relief (it would
step the plate per slot; Depth variation varies the slots instead). Relief heights: frame 1, field `field_level`,
openings down to `field × (1 − depth)`; hoods, beads and fasteners rise above that, and Height (`hval`) is then divided
by the highest reachable level so nothing clips, while the paint keeps the frame at 1 (colours don't shift when
fasteners or hoods are switched on).

The plain defaults are a 64 px grille (2 × 8 slots, 1 px rims, long points, the Smooth profile, Height amount 1, the plate
in the shape mask, a ramp with the field and frame as mid metal). A layer **added in the editor** (`fresh`) sizes it to
the texture: cells about 1/20 of the height tall (8…48 px; on strips and small panels from a 100 px short side never
below ~22 px), five times as wide, slots 80 % × 40 % of the cell, rims 0.3 × the slot width (≥ 1 px), and from 128 px
a framed panel — a frame of 1/16 of the short side with the field at 0.6, an edge clearance of the bevel plus half a
bar, corner radius side/64, an outer bevel ≈ side/170, the frame bevel ≈ side/128, and corner fasteners (from a 6 px
frame; radius ⅕ of the frame, capped by its flat).

| Param | Default | Notes |
| --- | --- | --- |
| output | relief | relief · slots · plate (metal between slots) · frame (border) |
| mode | slots | slots · louvers (sunken fins; several blades = a blade grille) · holes · hoods (pressed louvres) |
| cols / rows | 2 / 8 | cells across the field. Use an even row count with stagger to tile |
| col_sp / row_sp | 0 / 0 | Column / Row spacing, −1 … 1: the step between slots grows by this share of the texture width / height (along the texture's axes, whichever way the slots run), the grid centred on the field; slots keep to the step (the 1 px bar) and the field clips them; an endless grille wraps them round the torus. Laid out by `repGrid` (glsl/common.ts) |
| orient | horizontal | slot long axis (ignored for holes) |
| length / width | 24 / 3 px | slot size; holes use width as the diameter (hex: across the flats). Length ≥ cell → continuous bars |
| ends, tip | round, 1.5 | round · square · pointed · angled (one diagonal) · hex (60° points). `tip`: length of pointed / angled ends in slot widths (0.5 = 45°). Holes: round · square · hex (standing on a point; stagger 0.5 with rows ≈ 0.87 × the column spacing packs a honeycomb — their points may reach into the next rows) |
| stagger | 0 | shifts alternate rows along the slots (fraction of a cell) |
| louver, blades | 0.8, 1 | fin slant −1..1 (sign: which side opens; 0 = rounded bars / domed hoods, 1 = straight ramps); fins or hoods per opening. Two or more sunken fins are a blade grille: a dark gap (22 % of the pitch), then the slat's face rising to a step under the plate (so each opening keeps its top edge), rounding over in a 1.5–3 px lip, painted as metal (`hval` keeps the height). Steps between blades are blended over a pixel |
| rise | 0.3 | hoods: height of the lip above the plate (relief units). The hood falls to the plate at its hinge in a crease and curves down (a quarter round over about half the blade's width) to meet the plate at the opening's ends; the first 25 % of each blade is the dark slit under the lip |
| depth | 1 | how far the openings sink below the plate (1 = through to 0; lower = shallow pressed recesses, whose floor curves up to the walls in a fillet; fins scale with it) |
| rim, bead | 1 px, 0 | chamfer round each opening on the plate outside it (Edge profile), so the opening keeps its width; `bead` raises an embossed bead on it (the chamfer then takes its first third) |
| depth_var, missing, plugs | 0, 0, on | Wear: per-slot random depth (partly filled openings dish toward the middle); share of openings left out, shown as blanking plugs (a fine seam round a slightly sunk patch) unless `plugs` is off |
| margin, field_level | 0 px, 0.8 | Frame: border round the tile (> 0 makes a framed panel; slots are clipped to the field); the field's height, the frame is 1. The Edge bevel slopes the frame to the field |
| clear | 0 px | Frame: edge clearance — the openings are laid out over the field less this border (and clipped to it), so the outer bars match the inner ones |
| outer, round | 1 px, 2 px | Frame: outer bevel down to the wall at the tile edge (tiled panels meet in a groove); corner radius of the field, the outer corners concentric (radius + frame) |
| fasteners, fast_size, fast_style | none, 3 px, slotted | Frame: none · corners · sides (corners and mid-sides), on the centre line of the frame's flat (between the outer bevel and the step to the field; round the bend of rounded corners), the radius capped at 0.3 × that flat (≥ 1.25 px; the slider notes the cap); dome · slotted · cross heads (0.6 above the frame) in a dark, slightly sunk seat ring, shaded by their dome, slots turned at random per fastener (seeded) |
| mask | plate | what the relief writes to the shape mask: none · plate · slots (openings) · frame |

### `pipes` — Pipes & conduits
Each run is the nearest few (±1, more for wide feet or flanges, up to ±4: a uniform loop bound), composited by height.
Jitter moves a run at most into the free space beside it, so runs may touch but never overlap (values beyond that act
as the maximum). **Relief height** (`scale`) *True to size* outputs the heights in px of the pipes' own radius
(`genOutHeight`-style, converted by the project's Height depth), so Height amount 1 gives round pipes as tall as their
radius at any diameter (the default, at Height amount 0.5: half as tall, round without swamping finer relief); *Tallest
pipe = Amount* is a flat 0..1 relief. The value (diffuse) stays the normalised height,
except that clamp feet and bolts paint as metal (0.75 / 0.9) while their height stays low (`hval`). **Shape for the
mask** (`mask`) hands pipes + clamps (the default), the pipes (with their joints) or the clamps to the shape mask (rust
on the pipes, grime on the wall between), or none.

The plain defaults are three 8 px runs on a 64 px wall with diameter variation 0.35, a coupling per pipe, clamp straps in
line at a seeded place with bolted feet, sized with each pipe, true-to-size heights, a dark (not black) wall. A layer
**added in the editor** (`fresh`) sizes it to the texture: runs about 110 px apart (2…24 across) with a jitter of 12 % of
the spacing, pipes half the spacing thick, clamp straps ¼ of the diameter wide with a lip of 0.08 × and feet of 0.3 × the
diameter (none under 8 px), a joint per pipe from 8 px.

| Param | Default | Notes |
| --- | --- | --- |
| output | relief | relief · pipes (with joints) · clamps · both |
| orient | horizontal | pipe direction |
| shape, crown, lid | round, 0.4, on | round (half-cylinder heights) · conduit (trunking: flat top, bevelled; its straps flat saddle bands, edges rounded over, painted like it; its couplings covers with a lip at each end); a conduit's crown (1 = 30 % higher in the middle than at the bevel's inner edge) and lid seams along both sides of its top |
| count / bundle | 3 / 1 | runs across the tile, and pipes side by side per run |
| bundle_gap, pipe_var | 0 px, 0 | space between a bundle's pipes; each pipe's own random reduction, centred in its place |
| diameter, dia_var, jitter, offset | 8 px, 0.35, 2 px, 0 | diameter is clamped so that the runs fit their spacing; jitter stays within the free space |
| scale | true | relief height: unit (tallest = Height amount) · true (px of the radius ÷ Height depth; Levels / Gamma don't apply) |
| mask | all | what the relief writes to the shape mask: none · all · pipes · clamps |
| joints, joint_style, joint_size, joint_jitter, joint_spread, flange_bolts | 1, coupling, 1, 1, 0.5, on | Joints per pipe along the tile, at a random phase per run. In a bundle they are a staggered group — each pipe's joint a joint's length plus a gap along from its neighbour's (direction at random per run), each its own circle combined by height, so a sleeve stands over the pipe beside it but never clashes with its joint. The group is pushed clear of the nearest clamp by 0.6 D, or centred between two where the gap is short (single pipes' couplings shorten to fit it); Spacing jitter shifts each group along the run (1 = ± 0.3 of the spacing; the two nearest per pipe are evaluated): coupling (a sleeve 0.7 D long, lip 0.07 D, chamfered shoulders, a fine groove near each end) · flange (two discs 0.12 D thick, lip 0.28 D, a 1 px seam between, hex nuts with domed ends on their outer faces at the bolt circle's centre and ± 45°) · weld (a bead 0.12 D wide, lip 0.06 D, rippled unevenly: two ripples with random phases per weld); size scales them |
| clamps, clamp_width, clamp_lip, clamp_foot, bolts, clamp_offset, clamp_jitter, clamp_seeded, clamp_rel | 2, 3 px, 1 px, 2 px, on, 0, 0, on, on | straps per pipe along the tile, hugging each pipe of a bundle; feet are flat tabs (as thick as the lip, ≥ 1 px) reaching past the run's sides, filleted into the strap, at most half way to the next run (dropped below 40 %), optionally with a bolt head each; with feet the strap paints as metal down to the wall. The phase is random per run; Shift with the seed moves all straps by a seeded amount; Size with each pipe scales width, lip and feet by the run's diameter ÷ Diameter (never below 3 px wide, 1.5 px proud and 3 px feet) and leaves clamps off runs thinner than 10 px (or the Diameter, if less). Bolts need feet ≥ 3 px |

To use pipes as a shape, set the Round profile with bevel ≈ radius. That gives a half-cylinder in the shared bevel path.

### `trim` — Trim strip
| Param | Default | Notes |
| --- | --- | --- |
| output | relief | relief · blocks · dividers · elements · band (`sel_band`) · strip (the strip material: strips less holes, seams and the empty holes of missing heads) |
| mask_shape | strip | what the relief output hands to the Shape Mask (via `genOutOwn`, so its own value and coverage stay): none (the register passes through) · strip · blocks · dividers · elements · band. One relief layer can then feed Chips (strip edges), dirt clipped outside (the cuts) or a colour clipped inside (brass rivets, red beads) without a second Trim layer |
| orient | horizontal | strip direction (vertical: bands from the left edge) |
| mirror | true | bands run from both edges to the centre. A band touching the centre joins its mirror image, except the one-sided profiles (chamfers, quarter rounds, ogees, coves), which make a roof/valley |
| fill | 4 | this band stretches to fill the remaining height (0 = none: the last band's level continues) |
| strips, strip_h, strip_pos, strip_stagger, strip_var, strip_alt | 1, 0 (fill), 0.5, 0.5, 0.6, 0.3 | strips stacked across the texture, each in a share with edges on whole px (a trim sheet); a strip height under the share leaves a gap the layer doesn't cover (a trim band across a wall), centred on the position (fraction of the share, wraps). With 2+ strips: alternate strips shift along by the stagger × a block (or the element spacing); Alternate heights splits each pair's two shares (1 + alt) : (1 − alt); Strip variety lets each strip by its own random halve or double its plates, run plain, go without elements or swap its shaped bands for others that start and end the same way (bead / ridge / step; rising chamfer / quarter round / ogee / cove; flute / groove; the falling ones) |
| band1..6 / prof1..6 / level1..6 / base1..6 | 2 flat 0.2 · 4 bead 0.2→0.82 · 2 cove (in) 0.2→0.42 · 8 bead 0.42→0.54 · 0 · 0 | heights from the outer edge (px, or proportions when fitted); the profile runs from base up to level. Profiles: flat, bead, flute (`cove`: the symmetric concave channel), ridge, groove, step, chamfer in/out, quarter round in/out, ogee in/out, cove in/out (concave quarter rounds). A stack taller than the strip shrinks to fit; profiles are averaged over the pixel (no one-pixel creases at steep ends) |
| band_fit, band_scale, band_chain | on, 1, on | Fit: the stack as given is scaled to span the strip (each half when mirrored), so the heights act as proportions and the moulding follows Strip height; off: px × Band scale. Whole px either way. Join bands: every band but a flat one starts where the previous ends — its base, or for profiles that start high (flute, groove, falling ones) its level — keeping its own rise (level − base, clamped to 0…1), so ridges, steps and grooves run on without cliffs. Unmirrored strips fall to 0 at their far edge over the Edge bevel |
| div_count, div_style, div_prof, div_width, div_depth, div_inset, div_offset, div_var, div_return | 3, groove, V, 1 px, 0.7, 0, 0, 0.25, on | groove bevels the blocks down into the seam; seam = flat line; bar = raised. Profile: Edge bevel · square · V · round — the last three across the divider's own width, whatever the bevel; V and round end in a rounded cap inside the strip, so bars and grooves die away at its edge. Depth: how far a groove / seam sinks or a bar rises (1 = to the bottom / top). Length variation moves each divider by up to ±45% of a block. The margins dividers stop short of (inset) take the strip's random, not the blocks'. Frame the blocks: within the frame width (all bands but the innermost) of a block end the bands run across the end, mitred, so each block is a framed plate; unframed, Per-feature variation lifts only the face and its heads (the mouldings run on through the dividers) |
| elem, elem_layout, elem_count, elem_pitch, elem_inset, elem_clear | rivet, block, 8, 14.5, 3.5, 1 | none · rivet · bolt (flat-topped head on a washer) · slot · vslot · hole · square · hex (a nut on a washer: six steep flats, corners chamfered) · screw (slotted pan head). Layout `block` spaces Count from Inset to Inset within each block (inside the frame of framed blocks), or a centred row every Pitch (spacing within 25% of it; one centred head where one gap won't fit) — longer blocks get more; heads stay ≥ 1 px apart (in a short block the inset gives way, then the count); a strip without dividers spaces them evenly along the tile. Clearance (0 = off) keeps heads off the dividers (counted from the frame of framed blocks): even ones that come closer are dropped (a block left without any gets one at its centre), within blocks the inset grows |
| elem_size, elem_len, elem_ref, elem_y, elem_rows, elem_row_gap, elem_stagger, elem_offset | 2.25, 6, face, 0.5, 1, 8, off, 0 | size is the radius or half-width; rows are centred on `elem_y`, a share of the strip or (`elem_ref` = face) of the face — the stretch band, else the innermost band; slots and heads stay inside the strip by the fillet + 1 px |
| elem_fit, elem_bevel, elem_chamfer | on, 0.3, 0.25 | Scale with bands: element sizes, spacing, insets, clearance are in the bands' units (× Fit factor or Band scale). Fillet (a share of the head radius, ≥ 1 px when on): slopes the walls of holes and slots and dishes their floors, makes seats rounded-V countersinks and fillets washer edges (0 = hard cuts). Chamfer (hex): how far the cone that clips a nut's corners reaches in from them (from about the apothem); the six-sided wall is the main step up from the washer |
| elem_height, elem_seat, elem_depth, elem_turn, elem_missing, elem_hole | 0.46, 1, 1, 1, 0, 0.55 | head height (held under the relief's ceiling of 1, so a head on a high band stays round); seat: a fine sunken ring round each head (round a washer); hole / slot depth below the surface round it (1 = to the bottom); random turn of hex heads and screw slots; share of elements left out at random (heads leave a shallow empty hole, its radius a share of the head's) |

The defaults above are the design (in band units fitted to the strip, so they hold at any strip height), with the
layer's Edge as a smooth 3 px bevel, Per-feature variation 0.3 and a brass ramp. **Editor defaults** (`trimFresh`) only
size it to the texture: up to 96 px across, one strip; larger, strips of about 64 px (8 on 512 px); tall textures run
vertically; plates about three strip heights long; the V grooves (H / 20) and the Edge bevel (H / 21) in proportion.

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
- **Bounded loops.** Panels descend at most 24 levels (a uniform loop count: one copy of the body on D3D, ~1.7–1.8 s cold compile). Vents check a 3×3 cell neighbourhood (one flat loop with a uniform bound), pipes 3–9 runs (a uniform bound). Trim checks 6 bands and 3 rows × 3 elements.
- **Small and odd sizes.** Slot width is clamped to keep a 1 px bar. Pipe diameter is clamped to the run spacing. Panels skip cuts and details that don't fit, and rivets that don't fit the panel.
- **Value range.** Relief values are clamped to 0..1. Panel plateaus sit at ≤ 0.75 so rivets and raised frames have headroom. Pipes are normalised by the clamp radius.

## Possible shared improvements (not done here)
1. **Value-carrying SDFs.** Let a generator keep its own `value` alongside an SDF, for example a `LayerDef` flag or a `GenOut` field that multiplies the bevel profile. Per-panel height steps and rivet domes could then combine with the shape register in one layer instead of needing the relief/NO_SDF route.
2. **Emissive colour ramp.** Emissive is `colour × intensity × value`. Per-feature light colours (red/green/amber panel lights) need a gradient source like the diffuse ramp.
3. **Promote helpers.** `grb_snapC` (pixel-snapped centre) and `grb_rise` (profile with a coverage fallback) are generally useful and could move to `glsl/common.ts`.
4. **Parent checklist.** `fr7.2-bespoke-generators.md` already links here; its "Greeble generators" checkbox can be ticked. The presets could also get a greeble example, such as a tech wall or a riveted trim.
