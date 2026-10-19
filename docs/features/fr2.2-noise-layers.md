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
- [x] Worley jitter (0 = regular lattice … 1 = random) and distance metric (Euclidean / Manhattan / Chebyshev)

## Notes

- **One flat octave loop.** The Noise layer sums its octaves itself (the same values as `fractalNoise()`), in one
  loop with a runtime bound, so each base noise is compiled once; the library's generic dispatch inlines Worley in
  every unrolled octave. Cold D3D11 compile 2.3 s → 0.9 s (1.2 s with the turned lattice and Lp cells). Worley's cell random (`rnd`, per-feature variation) comes
  from the first octave.
- **Own Worley** (`nz_worley`): `worleyNoise()`'s F1, F2 and random in one flat loop (9 cells, then the 25 round the
  nearest point's cell). Its `w` is the true distance to the nearest cell's border (cell units): a soft minimum
  `(Σ d⁻³)^(−1/3)` — exactly 0 on the border, so F1 dimples ease into it without knife lines — over the exact bisector distances (Euclidean) or over `g / |∇g|`, `g = d(x, b) − d(x, a)`
  (exact at the border) for the other metrics. Manhattan and Chebyshev are the 1.3- and 4-norms (|r| softened over
  0.05 cells): strictly convex, so cells have real borders — the 1- and ∞-norms share whole regions between two
  points (F1 = F2), which drew flat ties and sparkle stars.
- **Cells.** _Even cells_, from the true border distance `d`: Worley edges rise over _Wall width_ (`1 − e^(−d / wall)`,
  cells): the same walls for big and small cells, their middles level; F1 dimples are `u = smin(F1, F2, 0.12) / (F1 + d)`, 0 at the point, 1 at its own border
  (the soft-min rounds the crest where two cells meet), with points kept in the middle 70 % of their cells (no sliver
  cells, whose walls ran through the dimples as needles); its profiles are dish shapes over u — Linear a cone,
  Smooth a parabolic dish `u²` (round bottoms packed edge to edge), Round a spherical dish (sharp rims), Cove `smoothstep`. _Cell profile_ (profileCurve of the inside; F1 is its inverse):
  round = wide dished dimples with sharp ridges (F1), pillows (edges); smooth = soft dimples / cushions.
- **Crease softness** (Ridged, Billow) replaces `|2n − 1|` by `√((2n − 1)² + e²) − e` (renormalised), `e = 0.25 ·
  crease · (octave + 1)` (+ `0.15 · hierarchy · octave` for Ridged): the fine octaves' wiry crests soften most.
  **Ridge hierarchy** (Ridged, shared with Clouds; c = crest closeness, 0 … 1): the first octave is sharpened to a
  ridgeline (`c^(2 + 3h)`) and gates the second wide (weight `2c^(2 − h)`: its ridgelets reach down the flanks,
  attached to the main crest, up to 60 % louder); the finer octaves are gated only near the crests of the one before
  (`2c^(2 + 2h)`), `(1 − 0.35h)` quieter each and creased more; an octave counts in the normalisation only as far as
  it is weighted. At 0 the classic ridged multifractal. Measured on the sheet, hierarchy 0 → 0.7 changes the ridged
  height maps to r ≈ 0.95 (crest Laplacian 16.7 → 5.4). **Ridge offset** also floors every octave's weight at the
  offset (≤ 1), so the basins keep detail (it acts under Even levels too).
- **Billow with Crease softness** fades the finer octaves out inside the first octave's creases (by its fold,
  `smoothstep(0, 0.6, fold₀)`, × crease): clean folds, detail on the lumps.
- **Decorrelated octaves**: each octave's lattice is shifted by a hashed offset and turned: freely when not tiling; when
  tiling (value, Perlin, square cell grids) the octaves run on a turned lattice that still tiles (`NZ_SHARED_GLSL`,
  shared with Clouds): the lattice of `y = W·u` for an integer matrix `W` with columns `n·(2, 1)`, `n·(−1, 2)`
  (a turn by atan ½, alternating per octave), its corners reduced modulo `W·Z²` before hashing — no axis-aligned
  grid lines or crests, still periodic.
- **Even levels** (lattice types, `cpuData`): `fractalQuantiles` runs the octave loop on the CPU
  — value / Perlin ported, 8192 samples, for the layer's mode, basis, octaves, gain, lacunarity (whole when tiling),
  crease, ridge offset and hierarchy — and uploads 17 quantiles (1 … 99 %, 16 bit) as `t_calib`. `eq_value`
  (`NZ_SHARED_GLSL`) maps the median to mid-grey and the 7 % / 93 % quantiles to ± 0.21 (where 6-octave fBm has them)
  through one monotone quadratic, straight beyond: the darks and lights balance for every mode without the shapes
  within being stretched as a full histogram match would.
- **Levels** (lattice types): Contrast about mid-grey, Brightness, and Softness — the clip box-filtered over up to 1
  (quadratic shoulders, mid-tones untouched). 1 / 0 skip it entirely.
- **Defaults:** even levels, even cells with the smooth profile, ridge offset 0.4, crease softness 0.5, ridge
  hierarchy 0.7; octaves are always decorrelated. Code-built layers keep neutral levels (contrast 1, softness 0):
  they are usually thresholded (Cutoff, height masks), where a roll-off would move the cut; the editor's new layer
  (`fresh`) takes contrast 1.1 / softness 1 (rolls off without clipping). Recipes that cut raw Worley distances
  (pits, cracks) set Even cells off and the linear profile; the concrete smear asks for classic ridged.
- **Ranges** are generous for 16 … 2048 px textures: scale up to 1024 cells (slider 128), stretch 0.02 … 100 (slider
  0.1 … 16 — brushed metal and fibres want 8 … 30), warp up to 16 cells, pixel size up to 256 px.
- Simplex isn't periodic: tileable projects get Perlin for it (the option reads "Simplex (Perlin when tiling)").
