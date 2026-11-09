# FR8.26 — Crystal

A generator for faceted crystal masses: cut glass, gem clusters, quartz druse, loose stones. Each crystal is a Voronoi
cell raised into a pyramid of flat faces running from each of its edges up to its tip, and finer layers of crystals grow
out of the valleys between them. Source: `src/layers/generators/crystal.ts`. Presets: _Emerald glass_, _Amber cluster_,
_Amethyst shards_ and _Sapphire stones_ (layer).

## Model

- **Pyramids.** A layer is a Voronoi diagram (**Crystals across**, **Jitter**). Inside a cell, the face of each edge (the
  bisector with a neighbour) is the plane that is 0 on that edge and 1 at the tip: g_j = d_j(p) / d_j(tip), with d_j
  the distance in from the edge less half the **Gap**. The crystal is min_j g_j. That is exactly the cell polygon's
  pyramid: a bisector that isn't one of the cell's edges reaches 0 further out along every ray from the tip, so it never
  wins. Every face is planar, and the ridges run from the tip to the cell's corners. A 3 × 3 search finds the pixel's
  site, then the 5 × 5 cells round it give the faces.
- **Shape.** **Tip offset** moves the tip off the site, its own way per crystal. Each face's run is kept at least 0.3
  of the site's and a fifth of the cell, so the tip never leaves the cell and a thin cell stands as a low ridge, not a
  knife edge. **Face variation** gives each face its own slope, so the faces meet in a short crest, not one point.
  **Height variation** sets each crystal's height. **Flat tops** cuts the tops off flat. **Base** stands the pyramid on a
  prism, whose walls show across a Gap. **Ground** paints the gaps (the ramp's first stop, height 0); off, the layers
  below show through them.
- **Layers.** Up to four layers. Each is finer (**Layer scale**; 1 = as large as the first, down to 0.5 = larger) and
  lower (**Layer height**, up to 2) than the last, and grows a crystal in only a share of its cells (**Small crystals**),
  so the small crystals stand whole among the big ones. **Layer lift** raises a finer layer by a share of its own height.
  **Layer combine** › _Grow between_ combines them by max: where two layers meet, their planes cross in a straight crease
  (a valley). _Stack on top_ adds each layer onto the surface so far, so its crystals stand on the ones before — huge
  crystals on huge crystals at Layer scale 1. **Skip first layer** leaves the solid first layer out: only the finer
  layers grow, each in its share of cells, for crystals scattered at random over the ground. The height is normalised
  by the tallest layer run (or, stacked, by all of them together).
- **Valley fill** rounds valley bottoms over its width, so touching crystals read as fused rather than split by a
  hairline. At a crease between layers it is a smooth max of the two planes, the same from either side. At a cell edge
  it is a fillet, (w − d)² / 2w of the face's slope, capped at a large crystal's steepest. It is off across a gap.
- One flat loop runs over the layers × (9 + 25 cells), with a uniform-bound count: ~0.65 s cold compile on D3D11,
  4.2 ms per layer at 2048² (a third of Voronoi's).

## Colour

- **Value** is the facet's place on the ramp, made up of:
  - **Facet contrast**: a random per face, for light and dark facets side by side, as light refracts through glass.
  - **Sheen** (**Sheen direction**): how squarely the face turns towards one direction, so facets light consistently
    across the texture.
  - **Facet gradient**: a gradient up the face.
  - **Colour per crystal** and **Colour per layer**.
  - **Glints**: a narrow streak across 3 faces in 10 (1 in 10 on the finer layers), parallel to the face's foot.
  - **Inner facets**: on the first layer's crystals, a star of **Inner facet rays** wedges of uneven widths round the tip, each with its own shade
    and faint edges. Each face turns the star its own way (**Inner facet shift**), so it jumps at every ridge as refracted
    light does. Tables show no star.
- **Edge highlight** lights the ridges. Each ridge's strength comes from a random of the two faces it parts and from how
  it faces the sheen; the finer layers' ridges are dimmer. **Valley shade** darkens (or lights) the valleys: cell edges
  and the creases between layers, but not a hidden layer's plane carried past its own facet. Both are **Edge width**
  wide.
- **Anti-aliasing.** Where two facets meet in a pixel — across a ridge, a table's edge, a cell edge, a crease between
  layers, or a gap's edge to the ground — the colour mixes with the other facet's (`gGenAlt`). The other facet's value is
  computed in full, its own star included (two star lookups per pixel), so no facet edge steps.
- **Height** (`hval`) is the surface over the tallest layer's height. Per-feature variation scales each crystal (`feat`
  is zeroed). The default ramp runs from deep navy through royal blue and cyan to white (sapphire), with Roughness 0.08
  (glossy).
- **Bevel** is applied to each crystal along its own edges (and ridges, with _Facets_) before the layers combine, so they
  meet at the true max of their bevelled heights. Measured by the mask's distance it dipped along the creases between
  layers, drawing a dark band round the small crystals.
- **Mask**: the crystal structure goes to the Shape mask by default (Mask › Write to), so the layers after it — Bevel,
  Etch, Chips, Mask area, anything limited to it — work on the crystals. Write to's **Source** picks what it holds: _Crystals_,
  each front crystal's random and its distance to its visible outline (including where another layer's crystal cuts
  it); or _Facets_, each facet's own random and its distance to the facet's ridges and edges too, so a Bevel after it
  follows every facet.

## Defaults

At 512 px: 4 crystals across, jitter 0.9, 3 layers (scale 1.5, height 0.7, small crystals 0.35), tip offset 0.4, face
variation 0.2, valley fill 2 px, edges 1.5 px, inner facets 0.15 with 12 rays, glints 0.35, height amount 6. Facet
values sit on a soft floor (max(v, 0.18 + 0.4 v)), so no face is the ramp's near-black first stop; the finer layers'
ridge highlights and the valley shade round their crystals are half strength. New layers
are sized to the texture: edge width in proportion, a lower height, 2 layers below 256 px and 1 below 128 px (and no
inner facets there).

## Checklist

- [x] Voronoi pyramids with planar faces, tip offset, face variation, flat tops, base, gap, ground; tileable
- [x] Layers combined by max, sparse finer layers, lift; valley fill
- [x] Facet colours: contrast, sheen, gradient, glints, inner-facet stars; ridge / valley shading; anti-aliased facet
      boundaries through `gGenAlt`
- [x] Presets; critic rounds (`private/critic/crystal/`)
