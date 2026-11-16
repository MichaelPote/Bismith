# FR8.24 — Liquid splats

**Status:** done — generator `splats`, presets Blood splatter, Blood on a wall, Water splash, Oil spill; critic rounds
0–2 (6.3 → 7.4 → 7.8); the specular hot pixels fixed in the renderer (below)

## Goal

Realistic blood, water or oil splats: thrown at a surface (cores, jets, droplets) or poured (pools), with height so
pools look like liquid lying on the surface, and with gravity so they run down a wall — or none, so they pool. Down to
pixel art: a clumpy splat with one long run on a 64 px wall.

## Design (`src/layers/generators/splats.ts`, `splatsGeometry.ts`)

**CPU geometry** (`buildSplats`, `cpuData` → a data texture, as Pipes): every splat is a list of primitives —
ellipses, tapered capsules, and bites (ellipses cut out) — built from the seed; the shader loops over all of them
(its cell's list, from the shared primitive texture `primTexture.ts`, with the grid and unit as derived uniforms
— a uniform-bounded loop D3D11 doesn't unroll: 0.28 s cold compile; 13.6 ms per layer at 2048², between
Noise and Grass). Splats sit on a jittered grid, by the number of splats and the texture's shape only — or, with
**Layout › Placed by hand**, one on every point of _Splat points_ (`points`, the shape editor's open lines, edited with its
Line tool and Edit; `parseSplatPoints` takes each "x,y" pair and ignores the lines; px or fractions with _Units_,
wrapping onto a tileable texture). A placed splat draws its grid position all the same, so splat _i_ looks the same
placed or on the grid, and moving its point moves it whole. The shader's
4000 primitives are shared out: each splat gets an even share of what's left, its core first, then runs, jets,
spikes, droplets and mist until the share runs out — so many splats each throw less, rather than the later ones
going missing. Each is:

- **Core**: a body (sagging and stretched downhill with gravity) and lobes round it (Ragged core: more lobes,
  straying further, of mixed size), bites out of its rim (concave bays), clumps breaking off it; a pour (low Splash)
  spreads a few satellite puddles a gap away from its rim.
- **Spray** (Splash, thrown all round or One-sided towards Spray direction): a crown of short spikes and a few long
  jets (Jets, Jet length; the longest few much longer — a heavy tail) tapering to a point with a solid minimum width,
  slightly bent, often with drops strung out beyond the tip; a jet thinner than about a pixel breaks into a string of
  drops instead (as a thin stream of liquid does — on small textures, pixel specks rather than ruler lines).
  **Droplets**: a power-law of sizes, mostly tiny, the far ones stretched along their flight with a tail; **Fine
  mist**: specks of a px or two flying furthest, thinning out with distance and on small splats.
- **Gravity** (Gravity, Gravity direction): runs from the core's downhill edge (stratified along it, the first near the
  middle the longest) and from the bigger drops, each with a neck into its source, meandering and narrowing, ending in
  a bead (_Run beads_) sized from the run's starting width; big drops near the core slide (stretched downhill, often running on).

**Stable layout.** Every splat, and every part of one (each lobe, bite, jet, droplet, speck, run), draws from a random
stream of its own, keyed by the seed, what it is and its index; a splat draws where it sits, its size and the random
factors of its part counts first, in a fixed order, and a spray direction always takes three draws. So the splats move
only when the seed or the number of splats changes (one more splat on the same grid doesn't move the others); any other
param reshapes the splats where they are, and a count adds or drops parts without moving the rest. (The grid is no
longer widened under gravity for that reason: a run can now fall into the splat below.)

Pieces longer than 0.4 of the tile are cut into segments, each measured around the wrap from its own anchor
(`wrapDelta`), so long runs tile.

**Shader**: Tear warps the sample position with three octaves of value noise at the splats' own scale (lobes, bays,
the scallops of a pool's rim); the primitives are smooth-unioned (radius per piece: a fifth of the core within a
splat's body, a fraction of a drop's size for droplets) and bites smooth-subtracted, giving one distance; Edge
roughness adds fine noise to it. The distance goes to the mask the layer writes (`sdf: 'mask'`); Splats shapes its own
value and coverage; the Edge card still applies — Bevel (0 by default) shapes the thickness further, Anti-alias off
gives pixel art.

**Value = thickness**: rising over the **Meniscus width** from the edge to a flat top, steepest at the edge (the contact
angle) — surface tension: drops smaller than the meniscus stay domed and low, big pools flat on top — times the
piece's swell (beads fuller, jets thinner, big drops a little lower than the core), and times the coverage, so a speck
smaller than a pixel raises no glint brighter than its colour. **Dried rim** adds a darker, raised ring along the edge.
Defaults: blood (ramp `#c0160f` → `#7d0807`), Height 1, glossy Roughness (0.25 → 0.06 with thickness), Specular on.

## Presets (`public/presets/layer/splats/`, category Liquids)

Blood splatter (the defaults) · Blood on a wall (Gravity 1, Splash 0.55) · Water splash (Multiply a light grey: wet
darkening, few jets, lower and wider meniscus, very glossy) · Oil spill (pools, little spray, near-black, glossy).

## Review

Three critic rounds against two references (a sheet of blood splatters; pixel-art blood on a wall with a run):

- r0 6.3 — potato cores, too few and too big droplets, fat straight runs, faint jets.
- r1 7.4 — Tear and bites, Fine mist, solid jets breaking into drops when thin, thin meandering runs with necks.
- r2 7.8 — scalloped pools with detached puddles, rarer lower big drops with tails, beads from the run width, splats
  spread out under gravity. Left: pool silhouettes still a little cartoonish at large sizes; water and oil judged
  only through their presets.

**Hot pixels.** Glossy liquid with steep edges showed single-pixel specular glints, the same at 64 and 512 spp and
absent without the layer. The cause was specular aliasing, not noise: the tracer already samples the sun within its
Softness cone, but the primary hit takes one normal per texel, and on a near-mirror a texel either reflects the sun's
disc or misses it. A thinner liquid with a flat edge removed most of them but cost the look; the renderer now filters
roughness by the normal's variance across the pixel (`filteredRough` in `src/render/pathtracer.ts`, after Kaplanyan &
Hoffman 2016, fading out from roughness 0.25 to 0.45 so rough relief keeps its sparkle): no glint above 80 levels
left on the sheet. Of the starters only the gem changes visibly (its crisp highlight along the inner bevel softens).

## Checklist

- [x] Geometry (cores, bites, clumps, puddles, spikes, jets, drops, mist, runs, beads), tiling-safe segments
- [x] Shader: union / bites, Tear, Edge roughness, thickness profile, Dried rim, mask; the Edge card (Bevel ×
      thickness, Anti-alias) as on every mask-only generator
- [x] Tests (`splats.test.ts`): determinism, Splash, gravity direction, bites, segment length, encoding, fresh sizes
- [x] Compile (0.28 s cold on D3D11) and render cost measured
- [x] Presets with previews
- [x] Renderer: specular anti-aliasing at the primary hit (`pathtracer.ts`)
