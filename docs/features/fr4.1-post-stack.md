# FR4.1 — Post stack: glow, blur, tonemap…

**Status:** done (filters). The outliner list / properties UI is owned by FR5.2.

## Goal

An ordered, user-editable stack of post filters over the HDR render (architecture §8).

## Plan

- `src/render/post/registry.ts` — `PostDef { type, label, params: ParamDef[], run(ctx, input, output, params) }`.
- **Glow:** bright-pass (threshold, soft knee) → 6-level down-sample / up-sample blur chain → add (intensity,
  radius, tint). Works on HDR input.
- **Blur:** separable Gaussian.
- **Tonemap:** exposure (EV) + clamp / Reinhard / ACES fitted / AgX / Uncharted 2.
- **Grade:** brightness, contrast, saturation, hue shift.
- **Pixelate:** block size.
- **Sharpen:** unsharp mask.
- Outliner "Post" section with add / remove / reorder / enable; properties per filter.
- Final sRGB encode at display / export.

## Checklist

- [x] Post registry + ping-pong runner
- [x] Glow
- [x] Blur
- [x] Tonemap (5 operators + exposure)
- [x] Grade
- [x] Pixelate
- [x] Sharpen
- [x] Post list UI (add / remove / reorder / enable) — Outliner "Post" section + Properties (FR5.2)

## Implementation notes

Files: `src/render/post/{glow,blur,gaussian,grade,sharpen,pixelate,tonemap}.ts`, registered in
`src/render/post/index.ts` (`POSTS`, add-menu order = usual stack order):
**Glow → Blur → Tonemap → Grade → Sharpen → Pixelate → Palette**. HDR filters (Glow, Blur) belong before Tonemap,
display-referred ones (Grade, Sharpen, Pixelate, Palette) after it. Every filter wraps across the texture edges when
the project is tileable (`uTile`), so tileable textures stay seamless.

| Filter (`type`)       | Params                                                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Glow (`glow`)         | threshold (1), knee (0.5), intensity (1), radius (0.6, 0–0.98), levels (6, 1–8), tint | Full-res bright pass (max channel, Unity-style soft knee, on premultiplied colour) → down-sample chain, each level `ceil(prev/2)` per axis (down to 1×1; works for 16×16 and non-square sizes) with a 5-tap dual-filter kernel → up-sample chain with a 3×3 tent. Level weights ∝ (1−r)·r^(i−1), normalised over the levels that exist, so a uniformly bright area glows by exactly `intensity` and small textures don't dump the remainder into a 1×1 level. Composite adds `bloom × intensity × tint`; over transparent pixels the glow raises alpha (straight alpha). All sampling is manual bilinear via `texelFetch` (no float-linear extension needed) and wrap-aware, so glow bleeds across the tile seam. |
| Blur (`blur`)         | radius (σ px, 1)                                                                      | Separable Gaussian, kernel ±3σ (≤128 taps), premultiplied alpha. `gaussian.ts` is shared with Sharpen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tonemap (`tonemap`)   | exposure, operator, white                                                             | Unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Grade (`grade`)       | brightness, contrast (−1…1), saturation (−1…2), hue (±180°), tint                     | **Expects display-referred input (after Tonemap).** Brightness/contrast use GIMP's Brightness-Contrast formula on sRGB-encoded values (pivot 0.5); saturation scales chroma and hue rotates it in OKLab (keeps lightness); tint multiplies in linear. Before Tonemap it still works but brightness compresses values > 1.                                                                                                                                                                                                                                                                                                                                                                                         |
| Sharpen (`sharpen`)   | amount (1), radius (σ px, 1), threshold (0), luminance only                           | Unsharp mask `c + amount·(c − blur)`, optional threshold gate (soft ramp) and luma-only mode to avoid colour fringes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Pixelate (`pixelate`) | size (px, 4), sample (average / centre pixel)                                         | Blocks anchored at the top-left (partial blocks at right/bottom edges). Two passes: block averages (premultiplied) into a `ceil(W/size)×ceil(H/size)` scratch target, then expand — cost O(W·H) for any block size.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Palette (`palette`)   | see FR4.2                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Verified headlessly (harness renders, viewed upscaled): glow on 128×64, 128×16, 16×16 tileable (seamless when
tiled 2×2; clipped at the edge when not tileable), 13×7 tileable and 1×1 (whole stack, no errors); blur, sharpen
(RGB + luma), grade (brightness/contrast/saturation, hue 120°, greyscale, tint) and pixelate (8 average / point,
non-divisible 5).
