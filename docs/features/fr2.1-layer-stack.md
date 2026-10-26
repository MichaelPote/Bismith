# FR2.1 — Layer stack & channel outputs

**Status:** done (v1)

## Goal

The core compositing model: an ordered stack of generator and filter layers that build the Diffuse, Height,
Roughness, Emissive (and Opacity) channels, with named masks for SDF operators and limits (architecture §5.2–5.4,
FR8.23).

## Plan

- `src/layers/registry.ts` — `LayerDef` registry, categories, lookup, `createLayer(type)`.
- `src/layers/glsl/common.ts` — hashing (PCG), wrap helpers, user→GL conversion, gradient ramp lookup,
  blend modes, profile curves, SDF combine operators.
- Generator wrapper shader (`src/render/materialPipeline.ts`): reads previous MRT state, calls `gen(p)`,
  applies SDF combine → profile → shaping → limit → channel outputs, writes the new MRT state (and the mask it
  writes, if any).
- Clear pass initialises the stack: albedo = project base colour (opaque), height 0, roughness from project
  default, emissive 0; a mask nothing has written yet reads as empty (+1e4, outside everywhere).
- Filters implement `run(ctx, layer)` and swap the ping-pong pair themselves.
- Per-layer enable, solo/preview ("show the stack up to this layer"), lock (excluded from optimiser).
- Uniform upload from params: float/int/bool/enum/color(→linear)/seed/gradient(→vec4[8]).

## Checklist

- [x] LayerDef registry + categories
- [x] Generator wrapper: SDF combine, profiles, shaping, mask, outputs
- [x] Diffuse blend modes (9) + gradient ramp + colour variation — blending happens in sRGB space like a paint program
- [x] Opacity / Height / Roughness / Emissive output modes
- [x] Mask: limit to masks (was: clip to shape register), height range
- [x] Filter `run()` contract with ping-pong
- [x] Preview stack up to the selected layer
- [x] Layer lock flag for the optimiser
