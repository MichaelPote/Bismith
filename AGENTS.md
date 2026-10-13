# Notes for agents working on Bismith

Architecture and feature docs live in `docs/` (start with `docs/architecture.md`). Below: gotchas that have cost
time before.

## Gotchas

- **`<< out` breaks esbuild / `tsx`.** esbuild (used by `npx tsx`, so by every script in `tools/` and any ad-hoc
  script that imports `src/`) parses a left shift followed by an identifier named `out` — e.g. `1 << out[i]` — as
  the start of a TypeScript variance modifier (`<out T>`) and fails with *The modifier "out" is not valid here*.
  Vite / Vitest and `vue-tsc` accept it, so tests and typechecks stay green while every `tsx` tool crashes on
  import. Parenthesise the operand — `1 << (out[i])` (see `src/layers/generators/traceLinks.ts`) — or don't name
  the variable `out`. (`i < out.length` and other single `<` are fine.)
- **"Shape Mask" in the UI is the shape *register* in code.** The running signed-distance shape that shape layers
  write and later layers clip to: `S.a` / `prevReg` in the material shaders, params `sm_on` (write toggle),
  `sdf_op` (mode: Normal = `replace`, Union, Subtract, Intersection, smooth variants — the option index + 1 is the
  `sdfCombine` op, so keep their order), `sdf_k`, and `m_clip` (*Clip to shape mask*). Old projects with
  `sdf_op: 'none'` migrate to `sm_on: false` (`migrateParams` in `src/layers/registry.ts`). The four numbered
  *named masks* (`mk_*` params, `tMasks`) are a separate feature (docs/features/fr8.13-named-masks.md).
- **Shader compile time (D3D11, Chrome's default on Windows) is the cost users feel** — a card renders in ~50 ms,
  but a generator's first compile can take seconds. D3D's compiler inlines every function call, so a helper called
  in several branches (or a branch per case that each calls the same thing) multiplies the shader: pick arguments
  first and call once, use small lookup tables instead of a branch per case, loop over cases (axes, edges) so the
  body exists once. Nested loops of calls (a loop around a function that loops around noise) are much slower than
  one flat loop over all the evaluations, with the arguments chosen per iteration. Loop bounds read from a uniform
  (`ORG_1`, `MOT_1`) stop D3D from unrolling. Measure cold compiles with `npx tsx tools/compile-time.ts <types…>`:
  Tessellation went ~20 s → 1.9 s, Truchet 5.4 → 2.1 s, Marble 2.2 → 0.8 s and Cracks 1.5 → 0.8 s, output
  unchanged. For a generator with many modes, describe each mode as data (shapes, anchors) and run them all through
  one loop (`geometricTessellation.ts`). Don't time while
  another GPU job (e.g. the studio starting) runs. Batch compiles run in parallel (`engine.precompile([...])`).
