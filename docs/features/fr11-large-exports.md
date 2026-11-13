# FR11 — Large exports (rendered in tiles)

**Status:** proposed — nothing built. Until it is, the k× stack is capped at 4096 px (`MAX_STACK_SIZE`,
`src/core/supersample.ts`; docs/features/fr8.7-supersampling.md): a 4096 canvas renders and exports at 1×, a 2048
canvas at 2× at most.

## Problem

Supersampling (FR8.7) runs the material stack and the path tracer at k× the canvas, so the GPU holds every stack-sized
target at k² the pixels. The material state alone is three RGBA32F textures ping-ponged per layer (six), plus the
mask written, the mask slots alive, the normal / height texture, the tracer's accumulation and AO — around ten
targets of 16 B a texel. At 8192² each is 1 GB.

Measured on the user's RTX 5080 (16 GB, ANGLE D3D11), the lichen preset rendering at 1 sample:

| stack | how                       | time                   |
| ----- | ------------------------- | ---------------------- |
| 2048² | 2048 canvas at 1×         | ≈ 0.05 s of stack work |
| 4096² | 2048 at 2×, or 4096 at 1× | ≈ 0.2 s                |
| 8192² | 2048 at 4×, or 4096 at 2× | 7.7–8 s, alone         |

8192² is 10× over the linear prediction (≈ 0.8 s): most likely its targets no longer fit in video memory and WDDM
pages them. With other GPU jobs running (other sessions' renders) the same renders reset the Windows display driver
twice — the whole desktop went black, and in the page every shader after failed with an empty log and the render came
out blank. A full-frame draw at that size is also one long GPU job, which is what the driver's ~2 s timeout (TDR)
watches.

So bigger exports — a 4096 canvas supersampled, or later canvases over 4096 — can't come from bigger targets.

## Goal

Exports (File ▸ Export, maps, gallery renders: `Engine.renderExport`, `exportRender` in `src/ui/actions.ts`) render
stacks well past 4096 px — at least 16384 (4096 at 4×, WebGL's usual texture limit) — with the GPU's memory and every
single GPU job bounded, whatever the canvas or the factor, and the result the same as an untiled render of the same
stack (pixel for pixel where the untiled one fits). The viewport keeps the cap: it is interactive, and an export is
where the size is wanted.

## Design (proposed)

### Two separate limits

1. **Time per GPU job.** Each layer's pass is one full-target draw; at 8192² a heavy generator's draw can run for
   seconds. Splitting a draw into scissored tiles with a `gl.finish()` (and a painted frame) between bounds it without
   changing anything else: every texel of a pass reads only the previous targets, so the order of the tiles doesn't
   matter. Cheap, and worth doing first even for 4096² stacks on slower GPUs (the tracer's samples are already traced
   in chunks of ~40 ms in `renderExport`).
2. **Memory.** Needs the stack evaluated per output tile, below.

### Tiled evaluation

The export is cut into output tiles (e.g. 1024² of stack px). For each tile the stack is evaluated on a tile-sized
target **plus a halo**, at the tile's global texel coordinates (a tile-offset uniform: generators already work in
texture space and hash per feature, so a texel comes out the same in any tile; `fetchT` / `sampleT` map global
coordinates to the tile's, wrapping globally when tileable — the halo of an edge tile holds the wrapped content because
it is evaluated there, not copied).

- **Reach.** Every layer and filter declares how far from a texel it reads (`LayerDef.reach(params, ctx)`, px of the
  stack): 0 for point generators; the radius for Blur, Cavity, Edges; the strength for Warp; the pull for Splits;
  bevel / etch width for layers reading a mask's distance; the Sobel's 1 px for normals; the AO radius. The halo is
  the sum of the reaches down the stack. A layer that can't bound its reach — Symmetry (reads the mirrored texel),
  anything with a global reduction — makes the project **untiled**: it exports as today, capped. Auditing every
  `LayerDef` (and `prepare` / multi-pass layers: Blisters, Ledges, Snow, Drips, Repeat, the filters) is step one.
- **Masks.** Slots are tile-sized too; a mask read at a distance is covered by that reader's reach.
- **CPU data** (`cpuData` generators: Patterns, Stamp, Paths, Pipes, Stones, Motif …) is planned once for the whole
  texture (layouts, feature lists) and shared by every tile — check none of it is sized per stack pixel.
- **Global values** — the height range (tracer escape test, Height view), any auto-levelling — come from a first pass
  over all tiles (a reduction per tile, combined), or from an untiled low-resolution pass if a layer needs them during
  the stack.

### Tracing

Shadow and bounce rays march the whole height field, so a tile's tracing needs heights outside its halo. Two passes:

1. Evaluate the stack per tile and write only its **height** into one full-size R32F texture (4 B a texel: 256 MB at
   8192², 1 GB at 16384² — instead of ~10 × 16 B).
2. Per tile again: evaluate the stack (albedo, surface, emissive for the tile only), derive its normals from the
   full-size height, trace its samples (rays march the full-size height; R32F needs `OES_texture_float_linear` for the
   tracer's bilinear march — check it on D3D11), box-filter it down into the canvas-sized output.

Evaluating the stack twice costs exports time (the stack is small next to hundreds of samples), not memory. The
tracer's RNG is seeded by pixel and sample index, so with global pixel indices a tiled trace matches an untiled one.
AO is its own pass over the height field: per tile, reading the full-size height.

### After the stack

Post filters run at the canvas size after the downsample, untouched — while the canvas stays ≤ 4096. Canvases over
4096 later also need the post stack and the readback / PNG encode tiled (Glow and Blur reach far; Palette's k-means
reads the whole image), and a canvas-sized float buffer of 1 GB at 8192²: out of scope here.

## Plan

- [ ] Scissor-split each stack pass (material layers, normals, AO, tracer) into tiles with a `gl.finish()` between
      when the target is large; no change to output (check bit-identical on a few presets).
- [ ] VRAM estimate per evaluation (targets × size × bytes) and a budget; until tiling exists, the cap could follow
      the budget instead of the fixed 4096.
- [ ] Audit layer reach: `reach` on every `LayerDef`, non-local layers marked; a test that a layer's output at a
      texel depends only on texels within its reach (render with the outside scrambled).
- [ ] Tile-offset uniforms in the material pipeline and `fetchT` / `sampleT`; evaluate one tile of a stack.
- [ ] Two-pass tiled export (height, then shade and trace per tile); the full-size R32F height for the tracer and AO.
- [ ] Export UI: the factor no longer capped for tileable projects (the outliner's @Nx stays the viewport's), progress
      per tile.

## Validation

- **Same as untiled:** at sizes where both fit (stacks ≤ 4096, e.g. 2048 at 2×), a tiled export with small tiles
  (256–512, so halos and tile edges are everywhere) matches the untiled export — every layer type and filter, tileable
  and not; a differing texel names the layer whose reach is wrong.
- **Bounded:** at 4096 at 4× (16384²), no GPU job over ~100 ms, VRAM within the budget (`nvidia-smi` at
  `/usr/lib/wsl/lib/nvidia-smi` samples memory while it runs).
- **Safety while testing:** a GPU reset blanks the user's whole desktop. Keep test renders at or under 4096² stacks
  until the scissoring and budget are in, check `nvidia-smi` shows the GPU idle (other sessions' studios and tools
  render too), and ask the user before the first big render.

## Not in scope

- The viewport at stacks over 4096 (interactive; it keeps the cap).
- Canvases over 4096 (post and readback tiling, above).
- Lower-precision targets (RGBA16F albedo / emissive halves memory but not height, and changes renders) — possible
  later, independent of tiling.

## Open questions

- Tile size: memory against the halo's overhead (a 1024² tile with a 128 px halo evaluates 1.6× its area).
- Whether a cheaper single pass is good enough: trace each tile against a height halo sized by the longest shadow
  (`(maxH − minH) / tan(lowest light elevation)`) and accept tiny differences on grazing bounces.
- Non-local layers: export them untiled and capped (simple), or evaluate them alone at full size once and read the
  result per tile.
