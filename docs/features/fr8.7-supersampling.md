# FR8.7 — Supersampling

**Status:** done — Project › Path tracer › *Supersample* (1–4, default 1; shown as @Nx in the outliner)

The material stack and the path tracer run at k× the texture size; the traced (linear HDR) image is box-filtered
down to the texture size before the post stack (tonemap, palette snap) — fine features such as 1 px highlights, thin
joints and small bolt holes are computed at k× and averaged instead of being decided by one sample per texel.

- `core/supersample.ts` — `scaleProject(p, k)`: width / height, every pixel-unit param (ParamDef `unit: 'px'`:
  bevels, joints, radii, widths, white-noise block sizes, stamp pixel sizes, path vertex lists in px), heightDepth,
  AO radius and point-light px params × k, so patterns keep their size in texture pixels and slopes stay the same.
  Counts per pixel area (ParamDef `perArea`: Scratches' density, per 64×64 px) ÷ k², so the texture keeps as many
  features — before, raising the supersampling multiplied the scratches by k².
- Engine: keeps the k× project for material + tracer; `traced()` box-filters into a texture-size target that post,
  the display ("final") and `readRender` use. Channel views show the k× maps (display `uSS` texel scale); map
  readback (`readMap`, `readAO`) is box-filtered to the texture size so exports match the final image; the cursor
  probe reads the centre texel of the k×k block; height stats are reported in texture px.
- Cost ≈ k² per evaluation; 3× is the sweet spot for 64–128 px textures.

## Checklist
- [x] scaleProject (+ test), engine downsample, display, readback, probe
- [ ] Optional supersampled channel-view averaging (shows the k× maps today)
