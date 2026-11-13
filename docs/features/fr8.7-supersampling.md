# FR8.7 — Supersampling

**Status:** done — Project › Path tracer › _Supersample_ (1–4, default 1; shown as @Nx in the outliner)

The material stack and the path tracer run at k× the texture size; the traced (linear HDR) image is box-filtered
down to the texture size before the post stack (tonemap, palette snap) — fine features such as 1 px highlights, thin
joints and small bolt holes are computed at k× and averaged instead of being decided by one sample per texel.

- **The k× stack stays within 4096 px** (`MAX_STACK_SIZE`, `capSupersample`): a canvas over 1024 px gets 2× at most and
  one over 2048 px (up to the 4096 maximum) none, for the viewport and exports alike (`supersampleFactor`,
  `exportSupersampleFactor`; the outliner's @Nx shows the factor used). On an RTX 5080 (16 GB, D3D11) an 8192² stack
  (2048 at 4×, 4096 at 2×) took a project 7.7–8 s to render with the GPU otherwise idle — 10× what the 2048² and 4096²
  stacks predict (0.05 s, 0.2 s), likely its float targets (1 GB each at 8192²) paging out of video memory — and
  with other GPU jobs running it reset the display driver: every shader after failed with an empty log and the render
  came out blank. Larger stacks need the stack evaluated in tiles: [FR11](fr11-large-exports.md).
- `core/supersample.ts` — `scaleProject(p, k)`: width / height × k and every pixel-measured value scaled by k through
  `core/pixelScale.ts` (`scalePixels`): ParamDef `unit: 'px'` params (bevels, joints, radii, widths, white-noise block
  sizes, stamp pixel sizes, path vertex lists in px), heightDepth, AO radius and point lights' px params and falloff
  reference `refDist` × k, so patterns keep their size in texture pixels, slopes stay the same and point lights stay
  as bright. Counts per pixel area (ParamDef `perArea`:
  Scratches' density, per 64×64 px) ÷ k², so the texture keeps as many features — before, raising the supersampling
  multiplied the scratches by k² — and per-px quantities (`perPx`: Cavity's gain per px of curvature) ÷ k.
- Resizing the canvas uses the same scaling (`resizeProject`, the store's `resize`): Width / Height, the size buttons
  and Match's size-to-reference rescale the stored values — post filters and smart-material macros too — so a texture
  keeps its look at any size and the sliders still read true pixels. Lengths scale by √(kx·ky) (the side of the area,
  so the steps of a change compose), offsets (`sliderSpan`), lengths tied to an axis (ParamDef `axis`: rect width /
  height, band width across its bands via `orientAxis`) and vertex lists per axis. A run of resizes scales from the
  project before the first, so rounding and clamping don't compound.
- Engine: keeps the k× project for material + tracer; `traced()` box-filters into a texture-size target that post,
  the display ("final") and `readRender` use. Channel views show the k× maps (display `uSS` texel scale); map
  readback (`readMap`, `readAO`) is box-filtered to the texture size so exports match the final image; the cursor
  probe reads the centre texel of the k×k block; height stats are reported in texture px.
- Cost ≈ k² per evaluation; 3× is the sweet spot for 64–128 px textures.

## Checklist

- [x] scaleProject (+ test), engine downsample, display, readback, probe
- [x] Canvas resize scales the same values (resizeProject + test)
- [ ] Optional supersampled channel-view averaging (shows the k× maps today)
