# FR2.2 — Noise layers

**Status:** done (v1)

## Goal
"Noise — all different types": a tileable noise library and a Noise layer exposing it, plus convenience
layers (Clouds lives in FR2.4).

## Plan
- `src/layers/glsl/noise.ts` — periodic (tileable) implementations taking an integer period:
  white (per-texel), value, Perlin (gradient), simplex-style (non-periodic; falls back to Perlin when tiling),
  Worley F1 / F2 / F2−F1, plus fractal wrappers fBm, ridged, billow, turbulence; domain warp.
- **Noise** layer params: type, fractal mode, scale X / Y (cells across; integer when tiling), octaves,
  lacunarity (integer when tiling), gain, warp strength, warp scale, seed, contrast via shaping.
- Pixel noise (white) at 1 cell = 1 px for pixel-art speckle, with optional block size.

## Checklist
- [x] White / pixel noise
- [x] Value noise (periodic)
- [x] Perlin gradient noise (periodic)
- [x] Simplex noise — not periodic; tiling projects fall back to Perlin
- [x] Worley F1 / F2 / F2−F1 (periodic)
- [x] fBm / ridged / billow / turbulence
- [x] Domain warp
- [x] Anisotropic scale (brushed / grain looks)
- [x] Noise layer with full params
