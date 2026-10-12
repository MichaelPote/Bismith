# FR8.9 — Caustic light (refraction)

**Status:** done (first pass) — the Liquid lump's default style; tuned against lava and water references

The earlier caustics generator drew cells with soft rims; light doesn't behave like that. `causticlight` simulates it:

- **Surface**: a sum of plane waves (Waves, Cells across, Wavelength spread, Fine waves) with whole-number wave counts
  across the texture — tiles, and its slope is exact and cheap. Coarse and fine waves each take exactly evenly spaced
  directions (one random rotation per seed), and when tiling each whole-number wave vector is the one closest in
  *direction* (then length): unevenly rounded directions stretched the cells along the dominant ones.
- **Crest sharpness**: each wave carries a second, in-phase sine (cos φ + c·cos 2φ, a Stokes profile: sharper
  crests, flatter troughs) — light focuses into thinner filaments. c = Crest sharpness / 16: at 1 the trough
  curvature is still largest mid-trough, so cells stay whole; above it the troughs flatten and a faint wall splits
  each cell (a random-phase harmonic did the same at any strength — it adds new, smaller cells).
- **Meander**: the surface is read at p + w(p), w two slow, whole-cycle sines per axis (about two cells long), each
  bending its axis by at most 0.35 · Meander of slope (no fold-over); the slope follows by the chain rule
  ((I + J)ᵀ ∇h). Curved walls and cells of varied size instead of a lattice of straight folds; near 1 it streaks.
- **Gathering**: under every pixel, samples of a fine lattice are displaced by the surface slope × Refraction (px)
  and splatted with a Gaussian (**Filament width**, px); the pixel's light is the sum of the splats landing on it. Light piles up into
  filaments and brighter cusps where refraction converges and thins into dark cells where it diverges (1 = flat).
- **Halo**: the same light gathered with a wide kernel (Halo radius; a coarser lattice suffices) is added where it
  exceeds the sharp light, × Halo — a glow around the filaments that leaves the filaments and the cells' dark cores
  alone (mixing it in instead lifted the cores and, once tone-mapped, fattened the filaments into chunky bands).
- **Value** = 1 − exp(−Exposure · light^Contrast): additive, soft, never clipping (Contrast darkens the cells and
  keeps the filaments). Output *Surface height* gives the waves themselves (relief, depth tint).

The Liquid lump keeps the filaments thin (Filament width 0.45 px, Refraction 7 px, Meander 0.7, Halo 0.5) and is
tone-fitted (FR8.2, `fit: 'tones'`): its ramp becomes the reference's tones at the value's quantiles — the
reference's dynamic range (lava and water lightness quantiles within ~0.02) with its own hues. Moving a slider
afterwards shifts the value under fixed stops; re-fitting restores the proportions (Suggest, emulation and the
studio fit today; a Fit colours button for hand-built projects is still open in FR8.2).

The lump renders no relief by default (Surface relief 0): lit waves streaked the caustics along the key light.

Lessons: brightness belongs in the colour ramp, not emission (emission + a clamp tonemap clipped each channel → flat
orange plateaus); a colour fit dulls saturated glowing looks, so the Liquid lump is not fitted (`RecipeDef.fit:
'none'`) and its ramp is seeded from the reference palette; highlights are lightened, never screened past their colour.
