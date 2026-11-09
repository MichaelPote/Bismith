# FR8.9 — Caustic light (refraction)

**Status:** done (first pass) — the Liquid lump's default style; tuned against lava and water references

The earlier caustics generator drew cells with soft rims; light doesn't behave like that. `causticlight` simulates it:

- **Surface**: a sum of plane waves with whole-number wave counts across the texture — tiles, and its slope is exact
  and cheap. **Waves** per octave, in exactly evenly spaced directions (one random rotation per seed; an uneven or
  duplicated set stretches the cells along the dominant ones). **Octaves** (1–4, up to 32 waves in all) layer further
  bands like octaves of noise: each at twice the frequency of the last, **Detail** × its slope share, travelling one
  more wavelength per loop, and rotated as far from every earlier direction as it can be (modulo 180°) — a parallel
  wave adds nothing new. (The earlier fixed "Fine waves" band put its waves on a half step, which landed on coarse
  directions at 3, 6, 9… waves, so 3 waves looked like 2.) Cost: 5 × 2 waves ≈ 160 ms per 2048² layer, 5 × 3 ≈ 370 ms.
- **Wave variation** v (0–1 by drag, up to 3 typed): at 0 every wave is alike — one length, one height, and when
  tiling each whole-number wave vector is picked by direction first, so 2 waves draw a square grid and 3 a symmetric
  weave. Above 0, each octave's wavelengths come from evenly spaced strata of ±0.35·v octaves shuffled over the
  directions (no two share a length by chance), heights vary by × 1 − 0.245·v · random, and the rounding weighs length
  more (a relative length error counts 0.12 radians at 0, 1.5 from v = 1): direction-first rounding had most lengths
  land alike at a few cells across. The default is 0: with octaves for detail, randomly matched waves look busy
  rather than richer. One or two plane waves still make a periodic pattern whatever their phases (a
  phase only shifts it); Meander is what breaks that up.
- **Crest sharpness**: each wave carries a second, in-phase sine (cos φ + c·cos 2φ, a Stokes profile: sharper
  crests, flatter troughs) — light focuses into thinner filaments. c = Crest sharpness / 16: at 1 the trough
  curvature is still largest mid-trough, so cells stay whole; above it the troughs flatten and a faint wall splits
  each cell (a random-phase harmonic did the same at any strength — it adds new, smaller cells).
- **Meander**: the surface is read at p + w(p), w two slow, whole-cycle sines per axis (about two cells long), each
  bending its axis by at most 0.35 · Meander of slope; the slope follows by the chain rule ((I + J)ᵀ ∇h). Curved walls
  and cells of varied size instead of a lattice of straight folds. The meander waves travel with Phase (one
  wavelength per loop, either way), so the warp drifts as the surface animates. Range 0–2 by drag, up to 4 typed: above about 1.4
  the warp folds over into creases and doubled filaments (an artistic range).
- **Wave model Gerstner** (FR8.15): trochoidal waves instead of sines. The surface is parametric — the point of
  parameter u sits at X(u) = u − Σ qᵢ κ̂ᵢ sin θᵢ, height Z(u) = Σ aᵢ cos θᵢ — so it gathers towards the crests: sharp
  crests over broad, flat troughs, crisp connected filaments. The gather walks the parameter lattice; each sample
  lands at X(u) + Refraction · ∇z with ∇z = J⁻ᵀ ∂Z/∂u (J = ∂X/∂u, symmetric) and carries det J, the horizontal area
  of its patch — the light it catches. **Wave steepness** S: qᵢ = S aᵢ / λ, λ the top eigenvalue of Σ aᵢ|kᵢ| k̂ᵢk̂ᵢᵀ, so the
  surface folds nowhere below S = 1 (cusps at 1); where the meander stretches the waves past that, the gathering is
  scaled back locally. Light thrown past the lattice window near a cusp fades out by its own throw, so no window
  edges show. Wave steepness 0 is exactly the sines model with Crest sharpness 0. Surface height inverts X by fixed-point
  iteration. Phase moves the crests with their rolling motion; the loop stays seamless.
- **Gathering**: under every pixel, samples of a fine lattice are displaced by the surface slope × Refraction (px)
  and splatted with a Gaussian (**Filament width**, px); the pixel's light is the sum of the splats landing on it. Light piles up into
  filaments and brighter cusps where refraction converges and thins into dark cells where it diverges (1 = flat).
- **Halo**: the same light gathered with a wide kernel (Halo radius; a coarser lattice suffices) is added where it
  exceeds the sharp light, × Halo — a glow around the filaments that leaves the filaments and the cells' dark cores
  alone (mixing it in instead lifted the cores and, once tone-mapped, fattened the filaments into chunky bands).
- **Value** = 1 − exp(−Exposure · light^Contrast): additive, soft, never clipping (Contrast darkens the cells and
  keeps the filaments). Output _Surface height_ gives the waves themselves (relief, depth tint).

The Liquid lump keeps the filaments thin (Filament width 0.45 px, Refraction 7 px, Meander 0.7, Halo 0.5) and is
tone-fitted (FR8.2, `fit: 'tones'`): its ramp becomes the reference's tones at the value's quantiles — the
reference's dynamic range (lava and water lightness quantiles within ~0.02) with its own hues. Moving a slider
afterwards shifts the value under fixed stops; re-fitting restores the proportions (Suggest, emulation and the
studio fit today; a Fit colours button for hand-built projects is still open in FR8.2).

The lump renders no relief by default (Surface relief 0): lit waves streaked the caustics along the key light.

Lessons: brightness belongs in the colour ramp, not emission (emission + a clamp tonemap clipped each channel → flat
orange plateaus); a colour fit dulls saturated glowing looks, so the Liquid lump is not fitted (`RecipeDef.fit:
'none'`) and its ramp is seeded from the reference palette; highlights are lightened, never screened past their colour.
