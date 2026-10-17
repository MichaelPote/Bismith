# FR1.3 — GPU pipeline foundation

**Status:** done (v1)

## Goal
Thin, reusable WebGL2 plumbing on top of Three.js for full-screen passes, multiple-render-target ping-pong and
float readback, used by the material pipeline, path tracer, post stack and display.

## Plan
- `src/gpu/context.ts` — owns one `THREE.WebGLRenderer` (WebGL2, `preserveDrawingBuffer` for export),
  an orthographic camera and a single full-screen triangle mesh; `runPass(material, target)` helper.
- `src/gpu/targets.ts` — helpers to make float/half-float targets, the 3-attachment MRT material state
  (`albedo`, `surface`, `emissive`), ping-pong pairs, wrap mode from `project.tileable`, resize/dispose.
- `RawShaderMaterial` (GLSL 3.00 ES) everywhere, with `#include`-style string composition of shared chunks.
- Shader cache keyed by layer type; uniforms updated in place.
- `readPixelsFloat(target, attachment)` for export, metrics and height statistics.
- Capability check (EXT_color_buffer_float) with a friendly error state.

## Checklist
- [x] Renderer + full-screen pass helper
- [x] Float / half-float / MRT target helpers with wrap modes — RGBA32F everywhere (simpler readback, exact SDF masks) rather than half float
- [x] Shader chunk composition + per-type cache
- [x] Float readback helper
- [x] WebGL2 / float-render capability check + error UI
