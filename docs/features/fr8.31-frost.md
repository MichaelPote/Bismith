# FR8.31 — Frost

A generator that coats the layers below in winter, in up to three layers that build on one another: a grainy white rime
on every exposed face, snow where it settles, and ice — icicles hanging from the overhangs of a wall, or a clear glaze
built up in the hollows of a floor. Source: `src/layers/generators/frost.ts`. (Ice, FR8.28, is the clear sheet; its
icicles moved here.)

## Mode

**Mode** picks a shader variant (`FROST_FLOOR` for Floor), not a branch, so each mode compiles only its own code.

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
feathered by a grain (**Grain size**), and inside them a veil with the grain clustered into brighter flecks of crystals,
a few of which sparkle (a grain under a pixel leaves a flat veil). **Rime** sets the share it covers, smoothly from none
to all; crevices stay bare by **Shelter**, and edges and high spots catch it first. Matte (Roughness › Parts).

## Snow

**Wall: caps on the ledges.** A prepare pass (`frost-snow`) works out the snow's thickness on every pixel. Looking down
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
**Length variation**; shorter ones thinner, never under 2 px wide), a cone from its root — sunk under the ledge's lip —
to a drop, bulging in rings (**Icicle ripples**), slightly bent, round in section (its height in px, under a third of its
width, so the snow caps stand higher) for Height and refraction. It is milky over its upper part and clear only towards
the tip (a thin one milky all along), with a narrow core, a rim that catches the light on its lit side (**Light from**)
and darkens on the other, and a **Glint** on the side away from the light. What is behind it — the layers below, bent by
its round section (half of **Refraction**), with the rime and snow over them — shows through the clear part, lightly
tinted by **Depth colour**.

**Floor: ice in the hollows**, never under the snow. Where the relief lies low, deep in a hollow or in a crevice (and
the drifts' noise is low), by **Ice**, smoothly: a glaze that fills a hollow level — its top the mean of two rings round
the pixel (**Fill width** and half of it) raised towards their highest, the more as Ice rises, never above it — and
coats the rest 0.3 px thick. Clear, so the layers below show through, tinted by the thin end of Depth colour, with a
faint sheen; bent by its surface (0.3 × **Refraction**: the slope of the rings' level, which is smooth — the glaze's own
top kinks along every joint, and its screen-space slope there scattered the view in 2 × 2 steps); milky towards its
edges and in faint frozen streaks; glossy. Part of its colour is transmitted light (`gGenTransmit`).

## Outputs

**Output** › _Frost_ (default) paints the layers' colour itself (`gGenRgb`, unpremultiplied over their combined
coverage, so the rime's partial veil lays over the layers below once) and its Height is the snow, the ice's fill and the
icicles' domes. _Rime_, _Snow_ and _Ice_ put out that layer's coverage as the value and the coverage, for the ramp,
Height or a mask (Write to › Source offers each). Roughness and Specular default to Source › _Parts_.

## Cost

One shader per mode. Both: the shelter loop (48 samples), two fBms in one flat loop (8 octaves), three value noises.
Wall: 12 taps of the snow pass's texture and the icicle cells round the pixel's column; Floor: 12 fill taps. The snow
pass (Wall) loops Cap depth + Cling px per pixel, once per render; the ledge cells pass (with each cell's march down to
where its icicle must stop) runs only with Icicles above 0.
