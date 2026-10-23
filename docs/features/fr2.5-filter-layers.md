# FR2.5 — Filter layers: blur, bevel, etch…

**Status:** done (emboss not implemented — see notes)

## Goal

"Convolutional filters like blur the layers before this one, bevel, etch, etc." — layers that transform the
accumulated channels rather than generating new content.

## Plan

- `src/gpu/jfa.ts` — jump-flood signed distance field from a thresholded source (height / opacity /
  luminance / a mask's coverage), wrap-aware (toroidal distance) on tileable projects.
- **Blur:** separable Gaussian, radius px, channel toggles.
- **Bevel:** source + threshold → distance → profile × depth; inner / outer / both; add / max / replace.
- **Etch:** grooves along the source's boundary (width, depth, softness) with optional diffuse darkening.
- **Cavity / edge wear:** curvature = height − blur(height); tint convex edges (wear/highlight) and cavities
  (dirt), with noise breakup; also affects roughness.
- **Warp:** displace accumulated channels by fBm (strength px, scale).
- **Adjust:** levels on height (in/out range, gamma, invert), HSV + brightness/contrast on diffuse,
  height-from-diffuse luminance, emboss.

## Checklist

- [x] Jump-flood distance field utility
- [x] Blur
- [x] Bevel
- [x] Etch
- [x] Cavity / edge wear
- [x] Warp
- [x] Height levels
- [x] Diffuse HSV / brightness / contrast
- [x] Height from diffuse
- [ ] Emboss (not started; height-from-diffuse + the derived normals cover most uses)

## Files

| File                           | Contents                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gpu/jfa.ts`               | `jumpFlood(ctx, { source, threshold, invert?, maxDistance?, relax?, name? })` → scratch target (r = signed distance px, negative inside; gb = nearest seed; a = found) |
| `src/layers/filters/shared.ts` | distance-source params (`source`, `threshold`, `smooth`), `sourceDistance()`, `blurTexture()` (separable Gaussian into scratch), GLSL helpers                          |
| `src/layers/filters/blur.ts`   | `blur`                                                                                                                                                                 |
| `src/layers/filters/edges.ts`  | `bevel`, `etch`                                                                                                                                                        |
| `src/layers/filters/cavity.ts` | `cavity`                                                                                                                                                               |
| `src/layers/filters/warp.ts`   | `warp` (single-pass `filterGlsl`)                                                                                                                                      |
| `src/layers/filters/adjust.ts` | `levels`, `hsv` (single-pass), `heightFromDiffuse`                                                                                                                     |
| `src/layers/filters/index.ts`  | `FILTERS` in add-menu order                                                                                                                                            |

## Layer types and params

Lengths are px; heights are unitless (1.0 = `heightDepth` px).

- **`blur`** (filter) — `radius` (σ = radius / 2, kernel ≈ 1.5 × radius), toggles `diffuse`, `height`,
  `roughness`, `emissive`, `opacity` (when opacity is blurred, colour is alpha-weighted so cut-outs don't
  bleed). Two MRT passes through the state ping-pong; metallic passes through (filters never change masks).
  `feather` (px, with a Limit to): the radius grows per pixel from 0 on the limit's outline to full that far inside
  (read from the limit's distance), so a limited blur smooths a shape's inside without smearing its edge.
- **`bevel`** (filter) — `source` (`height` | `opacity` | `luminance` | `mask`), `source_mask` (a mask by name,
  Shape by default), `threshold`, `smooth` (edge smoothing, JFA sources only), `invert`, `width`, `profile` (shared `PROFILES`), `depth`,
  `direction` (`inner` | `outer` | `both`), `combine` (`add` | `max` | `min` | `replace`).
  The bevel value b goes 0 (outside / slope foot) → 1 (plateau); `depth × b` is combined with the height
  inside the bevelled region only (inside the edge for inner, within the skirt for outer/both), so `max`,
  `min` and `replace` never touch the far background. `min` with depth = plateau height rounds off an
  existing hard step.
- **`etch`** (filter) — `source`, `threshold`, `smooth`, `width`, `depth` (negative = ridge), `softness`
  (0 crisp flat-bottomed cut … 1 V groove), `offset` (+ inside / − outside; ±0.5 centres odd widths on a
  pixel row); groups Diffuse (`dif_on`, `dif_color`, `dif_amount`), Roughness (`r_on`, `r_value`,
  `r_amount`), Emissive (`e_on`, `e_color`, `e_intensity` — glowing seams).
- **`cavity`** (filter) — `radius` (curvature scale), `threshold` (px of relief ignored), `sensitivity`
  (mask gain per px of curvature); Edge wear `wear_amount`, `wear_color`, `wear_rough` (roughness Δ),
  `wear_noise` (breakup); Cavity dirt `dirt_amount`, `dirt_color`, `dirt_rough`, `dirt_noise`;
  Breakup `noise_scale`, `noise_octaves`, `seed`. Curvature = (h − blur(h)) × heightDepth.
- **`warp`** (filter) — `strength` (≈ largest displacement), `scale` (cells), `octaves`, `nearest`
  (no interpolation: crisp pixel art), `seed`. All channels move together (masks don't: they stay as written).
- **`levels`** (adjust) — `in_lo`, `in_hi`, `gamma` (pow(x, gamma), same convention as generator shaping),
  `out_lo`, `out_hi`, `invert`, `clamp`.
- **`hsv`** (adjust) — `hue` (°), `saturation` (−1 = grey), `brightness`, `contrast`, Colourise group
  (`colorize`, `tint`, `tint_amount`: black → tint → white by luminance). Works on sRGB-encoded diffuse.
- **`heightFromDiffuse`** (adjust) — `amount`, `mode` (add, subtract, max, min, replace, multiply — same as
  the generator height modes), `invert`, `centre` (luminance − 0.5), `blur` (pre-blur radius).

## Notes

- **Jump flood.** Boundary texels (mask differs from a 4-neighbour) seed the flood with a sub-pixel
  iso-line point (linear interpolation of the source value toward each opposite neighbour, combined into
  the perpendicular foot when both axes cross). Flood steps run from half the power-of-two size (or just
  enough to reach `maxDistance`, so bevel/etch only pay for their width) down to 1, plus one extra unit
  step. All fetches go through `fetchT` and all offsets through `wrapDelta`, so the field is toroidal when
  tiling; without tiling the image border is never a boundary. The final pass measures the distance to the
  chords between the nearest seed and its neighbouring texels' seeds (piecewise-linear contour).
- **Edge smoothing (`smooth`, default 3 px).** A thresholded hard edge — especially a generator's AA'd
  flat-profile edge — only locates the iso-line to ~±0.4 px; the per-seed error projects radially and shows
  as faint facets on wide bevels of curves. The relax pass fits a line (PCA of the seeds within the radius)
  and moves each seed onto it, fading out where the neighbourhood is not line-like, so corners stay sharp.
  Measured on a 24 px linear bevel of a circle + rotated rect: mean error vs the exact shape-mask bevel
  < 1/255 of the ramp, visually indistinguishable at 3–4 px. Set 0 to follow pixel steps exactly.
- **Mask source** (`source: 'mask'` + `source_mask`, FR8.23) is exact (no JFA) when only shape layers wrote that
  mask — the best choice for edges built from SDF layers. A mask other layers wrote too is thresholded at its
  coverage (0.5 = the middle of an anti-aliased or feathered edge) and flooded like the channel sources. A mask
  reaches only the layers after its writer, so the filter must come after it in the stack.
- Verified headlessly (128², tileable and not, 160×96 non-square): seam continuity of every filter matches
  the base content's, JFA vs exact-SDF bevel agree, all types pass `tools/smoke.ts`.
