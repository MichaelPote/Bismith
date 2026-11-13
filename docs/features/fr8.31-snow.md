# FR8.31 — Snow

A generator that coats the layers below in winter, in up to three layers that build on one another: a grainy white rime
on every exposed face, snow where it settles, and ice — icicles hanging from the overhangs of a wall, or a clear glaze
built up in the hollows of a floor. Source: `src/layers/generators/snow.ts` (once called Frost). (Ice, FR8.28, is the clear sheet; its
icicles moved here.)

## Mode

**Mode** picks a shader variant (`SNOW_FLOOR` for Floor), not a branch, so each mode compiles only its own code.

- **Wall**: the surface stands upright; down the texture is down. Rime, then snow caps on the top sides of the ledges,
  then icicles from their undersides.
- **Floor**: the surface lies flat. Rime, then ice in the hollows, then snow on the most exposed parts. A Floor layer
  starts with less snow (`linkedDefaults`: 0.45 against a Wall's 0.7).

## Shelter and exposure

Both modes look at the relief below as Mask area does (`surfaceMask.ts`): in each of 8 directions the steepest rise out
to 3 × **Shelter radius** and the steepest fall within about it, each opposite pair counting twice the lesser plus half
the difference — 0..1 crevices (lower than around them) and high spots (exposed edges and ridges). The 48 samples' mean
is the local level, so the height above it tells the tops of the relief from what lies low.

## Rime

The broadest layer, colour only (no height). Patches of a 4-octave fBm (**Rime patches across**), their outline
feathered by a grain, and inside them a veil with the grain's highs clustered into brighter flecks of crystals, the
brightest of which sparkle (antialiased over the grain's change across the pixel). The grain is Noise's own noise,
adjustable in **Rime grain** (`noiseControlsAs('rg_', …)` and `noiseFieldGlsl('rg_', true)`: type, fractal, Cells across,
stretch, octaves, warp, levels — by default a 3-octave value fBm of 3 px cells, `rg_scale` 170 at 512 px and sized to a
new layer's width). It is band-limited: an octave whose cells shrink under 2.5 px fades to mid-grey by 1 px, so a grain
finer than the pixels leaves a flat veil instead of aliasing into speckle. Worley grains compile in a variant of their
own (`SNOW_GRAIN_CELLS`; the others define `NZ_LATTICE_ONLY`): in every shader they would add ~0.3 s to its compile. The
snow takes a faint tint of the same grain. **Rime** sets the share it covers, smoothly from none
to all; crevices stay bare by **Shelter**, and edges and high spots catch it first. Matte (Roughness › Parts).

## Snow

**Wall: caps on the ledges.** A prepare pass (`snow-caps`) works out the snow's thickness on every pixel. Looking down
the texture up to **Cap depth** × Snow: a ledge's top — where the height rises going down, by as much as counts as a
ledge (the ledge test, **Ledges**, the other way up: the rise from the lowest point passed) — carries a cap as thick as
its rise over the pixel plus **Snow height**, rounded off over the cap's depth as a quarter ellipse. So the cap fills a
joint above a ledge and, given the depth, heaps up over it onto the face above. **Drift** heaps and thins the caps along
the ledges (a value noise at **Drifts across**), and **Lumps** bulge and sag their tops (a noise about a cap across).
Looking up: just below a ledge's top edge the snow clings down its face, Snow height thick, as far as **Cling**
(ragged). In the layer's shader the thickness is smoothed along the row (each column finds its cap on its own, and over
rough relief neighbours jump), and each cap's ends are rounded off: along the row, the distance to where the cap runs
out on either side (a crossing found among 12 taps half a cap deep), the cap thinned over the nearer one, and a run
shorter than a cap's depth or so — a chip's sliver, a vertical joint — faded out. **Lumps** also roughen its surface
and outline (a gradient noise: value noise's cells showed as a plaid in the relief).

**Floor: the exposed parts.** Where the surface, smoothed over its joints (the mean of the shelter samples within a
quarter of the reach, and half judged on those within half of it), stands above its local level — a domed stone's crown
first, a narrow joint between raised parts as high as they, so a drift's edge crosses the joints instead of following
them — mixed with drifts (**Drifts across**); **Snow** sets the share, smoothly. It lies as a blanket: its top the
smoothed surface (a crown showing through only a little) plus its depth, which thickens in from its edge to **Snow
height**, never thinner than a quarter of that over a crown; its edge feathered over about 2 px.

Snow is white (**Snow colour**), faintly grained, matte, with sparse glossy grains that glint (**Sparkle**, through
Roughness and Specular › Parts). It adds height: Height › Pattern takes the snow's own thickness (`GenOut.height`, in
the surface's units, so Amount 1 is as built).

## Ice

**Wall: icicles** hang from the ledges in the relief below, found as Drips finds them (`src/layers/ledges.ts`): where the
height drops by the ledge threshold over the ledge reach going down. The **Ledges** threshold defaults higher than
Drips' (0.35): only clear steps carry snow and icicles, not the faint ones on a rough face. A prepare pass records each
**Icicle spacing** cell's strongest ledge pixel; each cell grows an icicle by the chance **Icicles** × how much its drop
counts as a ledge × **Icicle clustering**, and works out how far it may hang: down to where the surface stands out past
the overhang (a block that projects further), so an icicle never runs into one — a brick below as far out as the one
above lets it hang in front. A new layer on a small texture gets fewer icicles. Per pixel the cells round its column
are searched, from its own row up as far as an icicle reaches. An icicle is of random length (**Icicle length**,
**Length variation**) and width (**Icicle width**, **Width variation**; shorter ones also a little thinner, never under
2 px wide), a cone from its root — sunk under the ledge's lip — to a drop, bulging in rings (**Icicle ripples**),
slightly bent, cylindrical: its section a half circle as high as its radius, for Height and refraction.

Its height sits in the relief: its front is the overhang's own height at its root (the highest of the relief 1 and
3 px above it), its axis a fifth of its root's radius below that, plus its round section — maxed with the relief below. So it grows out
of its ledge (just under the root the ledge stands higher, and the icicle emerges from it), stands proud in front of a
face set back behind it, and is hidden where rock below juts out past it (its colour fades out too, over a px of
height). It is milky over its upper part and clear only towards the tip (a thin one milky all along), with a narrow core
and a rim that reflects at grazing angles. It has no painted highlights: its round section is in the height and it is
glossy (Parts), so the project's lighting gives it its highlights and shadows. What is behind it — the layers below, bent by
its round section (half of **Refraction**), with the rime and snow over them — shows through the clear part, lightly
tinted by **Depth colour**.

**Floor: ice in the hollows**, never under the snow. Where the relief lies low, deep in a hollow or in a crevice (and
the drifts' noise is low), by **Ice**, smoothly: a glaze that fills a hollow level — its top the mean of two rings round
the pixel (**Fill width** and half of it) raised towards their highest, the more as Ice rises
(`fillLevel`, shared with Ice's Fill hollows: the highest a mean weighted by e^(h / 0.5 px), so the level is smooth) — and
coats the rest 0.3 px thick. Clear, so the layers below show through, tinted by the thin end of Depth colour, with a
faint sheen; bent by its surface (0.3 × **Refraction**: the slope of the rings' level, the same level a pixel across and
up — the glaze's own top kinks along every joint, and a screen-space slope would scatter the view in 2 × 2 steps); milky towards its
edges and in faint frozen streaks; glossy. Part of its colour is transmitted light (`gGenTransmit`).

## Outputs

**Output** › _All_ (default) paints the layers' colour itself (`gGenRgb`, unpremultiplied over their combined
coverage, so the rime's partial veil lays over the layers below once) and its Height is the snow, the ice's fill and the
icicles' domes. _Rime_, _Snow_ and _Ice_ put out that layer's coverage as the value and the coverage, for the ramp,
Height or a mask (Write to › Source offers each). Roughness and Specular default to Source › _Parts_.

## Cost

One shader per mode (and each again with a Worley grain). Both: the shelter loop (48 samples), two fBms in one flat loop
(8 octaves), the grain's noise field, a value and a Perlin noise. Wall: 12 taps of the snow pass's texture, the icicle
cells round the pixel's column and 2 taps at the front icicle's root; Floor: 3 × 13 fill taps. ~2.0 s cold compile on
D3D11 (1.0 s of it the grain's noise field). The snow
pass (Wall) loops Cap depth + Cling px per pixel, once per render; the ledge cells pass (with each cell's march down to
where its icicle must stop) runs only with Icicles above 0.
