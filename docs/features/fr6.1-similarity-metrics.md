# FR6.1 — Similarity metrics

**Status:** done (v1)

## Goal

A numeric "how much does this render resemble the reference?" that works for stochastic textures (where pixels
won't line up) and for laid-out UI elements (where they should).

## Plan

`src/match/metrics.ts`, pure TypeScript over `{ width, height, data: Float32Array RGBA (sRGB 0..1) }`:

- **colour** — sliced Wasserstein distance between OKLab pixel distributions (fixed projection set).
- **spectrum** — radially binned log power spectrum of luminance (FFT), L1 between normalised profiles.
- **gradients** — histograms of gradient magnitude (log bins) and orientation (magnitude-weighted).
- **contrast** — multi-scale local standard deviation distributions.
- **aligned** — OKLab L1 at full, ½ and ¼ resolution (for UI targets).
- Weighted sum with a per-term breakdown; presets "Texture" (aligned = 0) and "Layout" (aligned high).
- Resampling helper so reference and render are compared at the same size.

## Checklist

- [x] Image type + resample + OKLab conversion
- [x] Colour sliced-Wasserstein
- [x] Spectrum term (FFT)
- [x] Gradient histograms
- [x] Multi-scale contrast
- [x] Aligned term
- [x] Weighted total + breakdown, presets
- [x] Unit tests (identity = 0, monotonic under degradation)

## Notes

Files: `src/match/image.ts` (image type and pixel helpers), `src/match/fft.ts`, `src/match/metrics.ts` (re-exports
`image.ts`), tests in `tests/match/metrics.test.ts` (synthetic images from `tests/match/testUtils.ts`).

**Image convention (`MatchImage`).** RGBA `Float32Array`, rows top-down, **sRGB-encoded 0..1** (what a PNG
stores ÷ 255, _not_ linear light), straight alpha. Converters: `fromLinear(engine.readFinal())` (the engine's
`ImageData32` is linear, possibly HDR — clamped), `fromRgba8(bytes, w, h)` (PNG / canvas), `toRgba8(img)`.
`resample(img, w, h, 'auto' | 'box' | 'bilinear')` filters in linear light on premultiplied alpha (box /
area-average along shrinking axes, bilinear along growing ones). `toOklab()` composites transparent pixels over a
background (default mid grey) and keeps alpha separately. `absDiff(a, b, gain)` makes the difference panel.

**Terms.** Each raw value is mapped to ≈0..1 with `raw / (raw + scale)` (`TERM_SCALES`: 0 = identical, 0.5 =
"clearly different", → 1 = unrelated); raw values are reported too.

| term      | raw value                                                                                                                                                                                                                                                                                                                                                                                                                                    | scale |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| colour    | 2 × mean W1 over 32 fixed projections (3 axes + Fibonacci hemisphere) of OKLab with a, b ×2 (low-chroma hue errors are very visible). ≈ ΔE for a uniform shift. Pixels subsampled to ≤ 16k by fixed stride.                                                                                                                                                                                                                                  | 0.06  |
| spectrum  | Luminance (OKLab L) power spectrum in half-octave radial bands × 4 orientation sectors (0°/45°/90°/135°, so horizontal brick courses ≠ vertical ones), as log10 variance density. Distance = reliability-weighted (count/(count+8)) mean \|Δlog10\| after removing the best constant offset (weighted median), capped at 3 decades per bin. Contrast-independent: it compares spectral _shape_. Exact DFT at any size (radix-2 + Bluestein). | 0.4   |
| gradients | Sobel on L. ½ × magnitude-histogram EMD (22 half-octave log bins, in octaves) + ½ × 4 × circular EMD of the magnitude-weighted directed orientation histogram (16 bins; lighting direction shows up here), the latter faded out for nearly flat images.                                                                                                                                                                                      | 0.25  |
| contrast  | Mean over 1, ½, ¼ scale of W1 between the distributions (64 quantiles) of 3×3 local std of L.                                                                                                                                                                                                                                                                                                                                                | 0.012 |
| aligned   | Mean over 1, ½, ¼ scale of per-pixel OKLab ΔE + \|Δα\|. The only position-sensitive term.                                                                                                                                                                                                                                                                                                                                                    | 0.06  |
| alpha     | W1 between alpha distributions; only counted when either image has transparency (else its weight is 0).                                                                                                                                                                                                                                                                                                                                      | 0.1   |
| windows   | Local texture at up to 512 px: windows of render and reference matched to their nearest neighbours both ways ([FR8.19](fr8.19-window-metric.md)); already 0..1, reported as it is. Counts only in the Windows preset.                                                                                                                                                                                                                        | —     |

`total = Σ wᵢ·termᵢ / Σ wᵢ`. Presets (`METRIC_PRESETS`): **texture** colour 2, spectrum 1, gradients 1,
contrast 1, aligned 0, alpha 0.5; **layout** colour 1, spectrum 0.25, gradients 0.5, contrast 0.25, aligned 3,
alpha 0.5; **windows** colour 1, texture 1, windows 4, alpha 0.5; **tilewin** Tile's weights + windows 3 (FR8.19; _tile_ and the VGG _texture_ term are in FR6.3 / FR8.1).
`MetricOptions.weights` overrides single terms.

**API.**

- `compareImages(render, target, opts?) → MetricResult` — one-shot.
- `new Matcher(target, opts?)` caches the target's descriptors; `matcher.score(render)` resamples the render to
  the comparison size and compares (≈5 ms at 64², ≈50 ms at 256²); `matcher.fit(img)`, `matcher.target`. Pass
  `score` the render at its own size, not `fit(render)`: the windows term compares at up to 512 px.
- `computeFeatures(img)` / `compareFeatures(a, b, weights)` — lower level.
- `MetricResult = { total, terms, raw, weights, width, height }`; `TERM_NAMES`, `TERM_LABELS` for UIs.
- Options: `preset`, `weights`, `size` (comparison size; default the target's), `maxSize` (long-side cap,
  default 128), `wrap` (periodic neighbourhoods for gradients/contrast — exact translation invariance for
  tileable images; default off so non-tileable references don't get a seam), `window` (Hann window before the
  FFT for non-tileable references; default off), `background`.

**Calibration (from the tests, texture preset, 64² stone texture).** Same image: 0. Circular shift by (17, 9):
colour/spectrum 0, gradients/contrast < 0.06 (clamped edges), aligned ≈ 0.46, total ≈ 0.01. Different random
realisation of the same (blobby, few-feature) texture ≈ 0.13–0.16. Gaussian blur σ = 0.5 / 1 / 2: ≈ 0.10 / 0.24 /
0.33. Noise ±0.02 / 0.05 / 0.1: ≈ 0.16 / 0.34 / 0.51. Lightness shift 0.02 / 0.05: ≈ 0.10 / 0.18. Stone vs. a
bevelled panel ≈ 0.72. Horizontal streaks vs. the same image rotated 90°: spectrum > 3× the different-seed level.
A render compared to its own 8-bit PNG: ≈ 0.006 at 64 spp and ≈ 0.03 at 16 spp (path-tracing noise is the
floor the optimiser sees).

Known limits: the texture preset is position-free by design, so for laid-out targets it cannot tell which
region should get which colour (use **layout**); the spectrum term saturates for very strong blur (the other
terms keep rising).
