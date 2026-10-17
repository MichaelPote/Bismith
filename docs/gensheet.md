# Generator test sheets (`tools/gensheet.ts`)

`tools/gensheet.ts` renders one generator in several variants (seeds, settings, texture sizes) and lays the results
out as a sheet for review: by you, or by a critic subagent (`docs/generator-critic.md`). It runs on the rendering
harness (`tools/backend.ts`, docs/features/fr7.1-gpu-harness.md), so the images are real renders of the app.

```
npx tsx tools/gensheet.ts <spec.json> [--out DIR] [--samples N] [--backend windows|swiftshader]
```

- `--out` defaults to `harness-out/gensheet`; keep sheets out of the repo (a scratch folder, one subfolder per round).
- `--samples` is the path-tracer sample count (default 64).
- `--backend windows` renders on the Windows host's GPU (ANGLE / D3D11, what most users see); `swiftshader` is the
  CPU fallback inside WSL. The default picks windows when a Windows browser is reachable. Check loops on the GPU
  backend: ANGLE miscompiles some constructs that SwiftShader renders correctly (see AGENTS.md).

## The spec

```json
{
  "type": "bricks",
  "name": "bricks",
  "size": 512,
  "params": { "seed": 1 },
  "below": [{ "type": "noise", "params": { "scale": 4 } }],
  "above": [],
  "project": { "heightDepth": 2 },
  "variants": [
    { "label": "default" },
    { "label": "seed 7", "params": { "seed": 7 } },
    { "label": "mortar 6 px, rubble", "params": { "mortar": 6, "shape_var": 1 } },
    { "label": "64 px default", "project": { "width": 64, "height": 64 } },
    { "label": "on a dark base", "below": [{ "type": "noise", "params": { "dif_on": true } }] }
  ]
}
```

- `type` is the generator under review; each variant's layer starts from the **editor's new-layer values**
  (`freshParams`, sized to the variant's texture), with Diffuse and Height switched on so shape and relief both show,
  then the spec's `params` and the variant's `params` on top.
- `below` / `above` are context layers (also from their new-layer values), e.g. a riveted panel under Drips. A variant
  may replace them with its own.
- `project` overrides project fields (size, height depth, lighting, tiling, base colour); a variant's `width` /
  `height` also size its fresh defaults, so a "64 px default" column shows what a new layer gets at 64 px.
- Labels should say what the column shows ("Run variation 1, Rise variation 0.8"), so a reader can match the image to
  the settings without opening the `.md`.

Good variants: the default, two or three other seeds, each important slider near both ends, every mode or style, a
small (64 px) and a large texture, and a column with the generator over a busy context.

## What it writes

- `<name>.png`: the sheet. Top row final renders, bottom row height maps, one column per variant, left to right.
- `<name>/<i>.png` and `<name>/<i>.height.png`: each column at full size. Look at these, not only the downscaled sheet.
- `<name>.md`: each column's label and the params it sets, then every parameter of the generator with its plain
  default, new-layer value and column-1 value where they differ, its hard range, slider range and tooltip, and the
  shared controls (Edge, Shape mask, Value shaping, Height) as column 1 has them. Render errors are listed here too.

Height maps are stretched to 0..255 per image, so compare relief within one image, or judge it from the render.

## Comparing rounds

Render the same spec into a new folder after each change and compare like for like:

- `ffmpeg -i a/1.png -i b/1.png -filter_complex hstack ab.png` puts two columns side by side.
- Crop a detail at full size (`ffmpeg -i 3.png -vf "crop=128:128:200:140,scale=512:-1:flags=neighbor" zoom.png`).
- Pixel checks (rows, counts, seams) are easiest with ffmpeg to raw gray plus numpy. Tiling: compare a texture's
  edge columns with its interior steps, or roll it by half a tile.

## Related tools

- `npx tsx tools/compile-time.ts <types…>`: cold shader compile time per generator on D3D11 (all generators with no
  arguments). Don't time while other GPU jobs run.
- `npx tsx tools/render-cost.ts <type[:mode[:{json}]]…>`: per-pixel cost per layer (2048², 32 copies, best of four
  interleaved rounds); compare versions within one run. See docs/shader-compilation.md.
- `npx tsx tools/previews.ts`: regenerates the preset thumbnails after a generator's look changes.
