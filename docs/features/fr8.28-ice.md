# FR8.28 — Ice

A generator that lays ice over the layers below: frozen lakes, iced-over floors and walls, frosted panes. What is under
it shows through, bent by the ice's surface and tinted by its thickness, with cracks going down into it, trapped bubbles
and blades of frost. Source: `src/layers/generators/ice.ts`. Icicles hanging from the overhangs in the relief below are
Frost's (Wall mode, docs/features/fr8.31-frost.md).

## Seeing through

- **Shared helper.** Everything transparent goes through `GLSL_TRANSPARENCY` (`src/layers/glsl/transparency.ts`), as
  the Glass filter does: `slopeNormal` → `lensShift` (out along the surface's slope × **Refraction**) → `seenThrough`
  (a bilinear sample of the albedo below) → `absorbTint`, `grazing` / `rimFresnel`, `innerGlint`. The colour's
  transmitted share goes out through `gGenTransmit`: the generator wrapper hands it to `layTransparent`, which carries it
  as emission (light through the ice isn't shaded by the ice surface) and keeps the rest as lit albedo.
- **The surface bends the view by its own slope.** Its relief is the ripples and the bumps, in px: **Ripples** (an fBm
  at **Ripples across**, with a ridged share: crests where the noise crosses its middle, steep on one side and gentler
  on the other) rise 0.17 × their width × Ripples per unit of their noise, and **Surface bumps** (a fine fBm cut into
  sparse, smooth lenses, **Bump size** px across, stretched sideways, in patches with smooth glassy stretches between)
  0.25 × Bump size × Surface bumps — so each sets a slope whatever its size (measured: ripples typically 0.12 px per px
  at Ripples 1, the steepest 0.5; bumps about 0.5 at their steeper 5% and 1 at the steepest 1%). Height › Amount scales
  it, as it scales the output (default 1). The slope is taken from the same noises a pixel across and up (in the same
  loop as the other noises, so smooth, not the 2 × 2 steps of a screen-space derivative), and the view moves by it ×
  **Refraction** — the shift in px where the surface slopes at 45°, about a quarter of the ice's thickness — eased off
  past a slope of about ½ (a steep lens a few px across would otherwise shift the view further than it is wide and
  scramble it). So the ripples and bumps bend the view exactly as much as they tilt in the relief. (The ridged share has
  to be over a third: under it the ridge's fall cancels the noise's rise and leaves half the surface flat.) The bumps
  catch a sun in glints: a top-down view sees a sun at 40° elevation only where the surface tilts about 25° towards it.
  Each crack's veil offsets the view across it (**Offset**), and a bubble turns it over.
- **Fill hollows** levels the relief below: the ice's top rises from the mean of three rings round the pixel (**Fill
  width**, a half and a quarter of it) towards their highest by Fill. The level is smooth, so a part fill sags across a
  joint instead of stepping at its walls; the ice is that much thicker (bluer) there. The fill goes out through the
  generator's own height (`GenOut.height`, divided by Height › Amount so it lands in the surface's units).
- **Thickness** (an fBm at **Patches across**, spread by **Thickness variation**, deeper where Fill hollows fills) picks
  the ice's colour along **Depth colour**, a gradient ramp from thin (left) to the deepest (right). What is below is
  tinted by it, and **Subsurface scattering** mixes in the light scattered inside the ice, which grows with the depth and
  takes the colour — growing with the square of the depth (thin ice stays clear), dimmer over a dark ground (dark water
  stays dark), capped so the ground still shows — so deep ice shows less of what is below and glows in a stronger
  colour. Haze, cracks, bubbles and frost are tinted by the same local colour. **Coverage** below 1 cuts the
  sheet into patches along the same noise, thinner and white towards their edges (shore ice): the threshold is the
  noise's quantile at 1 − Coverage (a small table of measured quantiles, its ends past the noise's range), compared with
  the unclamped noise, so the covered share follows Coverage smoothly from none at 0 to all at 1. **Haze** clouds it
  white in a second noise.
- **Transmission**: the share of the clear ice's colour carried as transmitted light; cracks, bubbles, frost and haze
  scatter, so they are always lit like a surface.

## Features

- **Cracks.** A network along the edges of a jittered Voronoi diagram (**Cracks across**) laid on a warped position
  (**Meander**, a 3-octave warp of up to a fifth of a cell), so the cracks wander and meet in T- and Y-junctions. An
  edge cracks by its pair's own random (**Network**); a third crack only partway from one end and taper off, so cracks
  end against others. Along an edge the width (0.5–2.4 px) and brightness vary. A crack is a plane going down into the
  ice at an angle: a crisp hairline where it meets the top (a faint glow round it), and on some a **Veil** into one of
  its two cells (the same answer from either side) — dimming as it goes deeper, a soft shoulder and a faint line where
  it ends (`icVeil`, which fades in over a veil's first px of width, so **Veil** 0 draws none on network cracks, star
  rays or long cracks), streaked across by hackle marks; the view below jumps across the veil (**Offset**). A bisector's
  line runs on past its edge, so only the three nearest cracked edges count. A veil is drawn in its own cell only, so it
  fades out over 4 px before the cell's other edges (the nearest, or the next when the nearest is its own) instead of
  ending in a straight cut where the next cell begins. **Long cracks**
  run straight across the whole texture over the network, fading in and out along their length — when tiling at a
  slope that wraps (a widths, b heights per lap; measured along by c·x/W + d·y/H with a·c + b·d = 1, the same at every
  copy of a texel); they barely meander. **Star cracks**: a share of the cells burst from their point in straight rays
  towards their near neighbours, each star its own size and each ray its own length, two in five with a veil beside
  them, round a small, dark impact pit.
- **Depth.** Each crack, bubble and speck lies at its own depth (**Depth spread**): deeper ones are wider, dimmer and
  bluer, and are seen shifted with the ripples above them (parallax through the surface).
- **Bubbles** (per 64 × 64 px): one per cell where **Clustering** keeps one (a slow value noise at twice Patches
  across). Small ones are clear beads with a bright rim and a highlight towards **Light from**, and turn the view below
  over; large ones are flat, frosty discs with a bright rim over a dimmer mottled fill. **Stacks**: under a large one,
  up to two smaller discs in a column going down, each clear of the one above and deeper. **Specks**: tiny white dots, one per cell.
- **Frost** in patches (a slow Perlin noise at **Frost patches across**, over its measured quantile at 1 − Frost, so
  the frosted share follows Frost from none to all): one to three blades from a point, longer in the thick of a patch
  (**Feather length**) and fading out at its edge, so they stay inside it. A blade is a gently curving spine with barbs at 60° (ice grows in
  sixes) slanting towards its tip, from roots about **Barb spacing** apart, each side its own and each barb its own
  length within the blade's outline (widest near its base); long barbs grow barbs of their own. Every line is
  anti-aliased and tapers to its tip; the barbs' own barbs fade out before they are too fine to draw. Blades start from
  points of their own near their cell's, and one side's barbs are shorter (a lopsided frond); more grow as Frost rises.
  A faint plate fills each blade, and a glaze of rime with a grain of crystals covers the patch, thicker as Frost rises. Frost
  raises the surface slightly and is matte.

## Outputs

**Output** › _Ice_ (default) paints the refracted colour itself (`gGenRgb`; the gradient ramp isn't used) and its
Height is the surface: ripples, frost, a fine groove on shallow cracks. _Cracks_, _Bubbles_, _Frost_ and _Thickness_
put out that feature as the value, for the ramp, Height or a mask (Write to ›
Source offers each). Roughness and Specular default to Source › _Parts_: clear ice glossy, frost and haze matte.

## Cost

One shader, its searches as flat loops with uniform-bound counts (cracks 9 + 25 cells and up to 8 long cracks,
bubbles 9 × 3, frost 1 + 9 × 3, fill 24 taps), and the four smooth noises plus the ripples' two offset copies in one
loop over their octaves (17 evaluations): ~3.2 s cold compile on D3D11 (the bubbles' grain is ~0.3 s of it).
