# FR8.15 — Animated noise (Phase) and soft limits

**Status:** done — Phase on every noise-driven generator, the domain warp, the Warp and Cavity filters and the
Liquid material; Blender-style soft limits in number fields

## Goal

Animate textures (water, lava, boiling noise) by rendering frames at successive phases, with a seamless loop; and let
number fields go past the range a slider shows without lifting the real limits.

## Design

- **Noise library** (`glsl/noise.ts`): a global `gPhase` (0 → 1 = one loop) that every generator's wrapper sets from
  its `phase` param. Phase 0 is the still noise exactly (renders are unchanged).
  - Perlin / simplex: each lattice gradient turns one whole revolution per loop, clockwise or not by a second hash.
  - Value / white noise: each lattice value travels 2 per loop, up or down, reflected at 0 and 1 (`animValue`): back
    to itself at phase 1, and uniformly distributed over the lattice at every phase (the up- and down-movers'
    windows cover the reflected circle exactly).
  - Worley and other cellular generators (Voronoi, Cracks): feature points move the same way per axis
    (`cellPoint`), so they stay inside their cell and the 3 × 3 search stays exact.
- **Params**: generators flagged `noise` (Noise, Clouds, Voronoi, Marble, Caustics, Wood, Cracks) get _Phase_ in their
  Pattern card; every other generator gets _Warp phase_ in Shaping, shown while a domain warp (or its own warp /
  wobble) is on. Caustic light has its own Phase: each wave travels a whole number of wavelengths per loop (fine
  waves twice as fast), forwards or backwards. The Warp and Cavity filters have one for their noise. The Liquid
  material's Flow card drives its generators' Phase. Phase is never optimised.
- **Soft limits** (`NumberField`): a drag stays within softMin…softMax (widened to the start value when it is already
  outside); typing and the arrow keys go past it, up to the hard min / max. Liquid's Refraction, Cells across,
  Filament width, Exposure, Rim width and Glow now have a soft max with generous hard limits; Caustic light's
  Refraction hard max is 256 px (beyond its gather reach the look turns sharp-edged and sparse — kept as an artistic
  range).
- Fix: Enter / Esc / arrows typed into a number field's text box no longer reach the slider track (Enter used to
  reopen the editor, arrows nudged the value instead of moving the caret).

## Checklist

- [x] Phase 0 renders identical (88 regression renders); phase 1 = phase 0 for every animated type; all 60 layer and
      post types compile
- [x] Phase params, Warp phase, filters, Liquid macro
- [x] Soft-range drag, typed / arrow overrun, Liquid soft maxes
- [x] Caustic light: Gerstner wave model (Wave steepness) and a wider Meander range — see FR8.9
- [ ] Add to the feature index in `docs/architecture.md` (left for after the in-progress traces fix lands there)
