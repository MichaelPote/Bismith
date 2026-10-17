# Shader compile time and miscompiles (ANGLE / D3D11)

Each generator is a GLSL ES 3.00 fragment shader. On Windows, Chrome runs WebGL through ANGLE on Direct3D 11: ANGLE
translates the GLSL to HLSL and hands it to Microsoft's FXC compiler (`D3DCompile`, shader model 5). A card renders
in ~50 ms; the first compile of a big generator takes seconds, almost all of it inside FXC
([Jamie Madill, ANGLE](https://groups.google.com/g/angleproject/c/KX_zYmiidHk);
[WebGL list, 2017](https://www.khronos.org/webgl/public-mailing-list/public_webgl/1702/msg00048.php)). This page
collects what is known about keeping that compile short and correct. Measure every change:

```
npx tsx tools/compile-time.ts <types…>                  # cold compiles on the Windows browser (D3D11)
BISMITH_ANGLE=gl npx tsx tools/compile-time.ts <types…> # the same through another ANGLE backend
```

The tool salts each shader so neither the browser's nor the driver's cache can answer. Don't time while another GPU
job runs (AGENTS.md). A restructuring can also change the per-pixel cost, so check that too:

```
npx tsx tools/render-cost.ts <type[:mode[:{json params}]]> …   # ms per layer at 2048², 32 copies, best of 4 rounds
```

Its absolute numbers drift between runs (GPU clocks); compare an old and a new version in **one** run (register the
old file under another type for the occasion). Sections: [checklist](#checklist), [the pipeline](#what-happens-to-a-shader-on-windows),
[loops](#loops), [arrays](#arrays-and-indexing), [branches](#branches-ternaries-and-switch),
[derivatives](#derivatives), [integers](#integers), [miscompiles](#miscompiles),
[hiding the cost](#hiding-the-cost), [measured here](#measured-in-this-repo), [ideas](#ideas-not-yet-verified),
[sources](#sources).

## Checklist

Do:

- Give every helper **one call site**. FXC inlines every function call, so each call is another full copy of the body
  ([docs](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-function-syntax)). Pick the
  arguments first (branches, lookup tables), then call once.
- Run repeated work through **one flat loop** with a bound read from a uniform (`ORG_1`, `GEO_1`…), choosing each
  iteration's arguments inside the body. FXC can't unroll a loop whose trip count it can't know.
- Describe **modes as data** (shapes, anchors, vertex tables) and run them all through the same loop
  (`geometricTiles.ts`), rather than a branch per mode that each calls the same helpers. Keep the tables **small**:
  pack them (Tiles packs a vertex's six coefficients into one `int`) — a big dynamically indexed `const` array costs
  per-pixel time ([measured](#measured-in-this-repo)).
- Use **bit masks** or small `const` tables instead of dynamically indexed, written-to local arrays.
- Loop to the real count (`i < geo_n`), not to a constant capacity with an early `break` (`i < 16 … if (i >= n)
  break`): FXC unrolls the latter.
- Take **derivatives** (`dFdx`, `dFdy`, `fwidth`, implicit-LOD `texture`) at the top level of `gen()`, outside loops and
  ideally outside branches. Use `textureLod` / `texelFetch` inside loops.
- Skip loop work with a flag (`if (!skip) { … }`), never `continue`; prefer no `break` either (see [derivatives](#derivatives)).
- Check every new loop on the GPU backend (`--backend windows`), not only SwiftShader.
- Precompile in batches (`engine.precompile([...])`): with `KHR_parallel_shader_compile` they compile in parallel off
  the main thread.

Avoid:

- Constant-bound loops around big bodies (FXC may unroll them: one copy of the body per iteration), and loops nested
  inside a function that is itself called in a loop.
- The same expensive call in several branches of an if/else chain or `switch`.
- `continue` in loops (miscompiled here before), and `continue` inside a `switch` (FXC rejects it with X3708,
  [wgpu #4485](https://github.com/gfx-rs/wgpu/issues/4485)).
- Deep chains of helpers calling helpers (FXC's time can grow exponentially with call depth, see [loops](#loops)).
- Gradients inside loops: they make ANGLE add `[loop]` and flatten every enclosing `if` (both sides run), and inside a
  loop with `break` / `continue` / `return` they silently become 0.
- Mixed int/float literals in vector constructors (`vec3(x, 0, 0)`): ANGLE's generated constructor helpers can collide
  and FXC rejects the shader with X3067
  ([report](https://github.com/CelestialLemon/pixel3d-renderer/issues/27)). Write `0.0`.
- Per-pixel work that only depends on the layout: move it to the CPU and pass a texture (Traces, Truchet, below).

## What happens to a shader on Windows

ANGLE's HLSL translator ([`TranslatorHLSL.cpp`](https://github.com/google/angle/blob/main/src/compiler/translator/hlsl/TranslatorHLSL.cpp))
rewrites the AST before printing HLSL. The passes that matter to us:

- **Every ternary becomes an `if`** with a temporary: `UnfoldShortCircuitToIf` matches all `?:` nodes, and `&&` / `||`
  whose right side has side effects ([pattern matcher](https://github.com/google/angle/blob/main/src/compiler/translator/tree_util/IntermNodePatternMatcher.cpp)).
  HLSL's `?:` evaluates both sides, so ANGLE can't print it as is.
- **Loop conditions that need such statements move into the body.** `SimplifyLoopConditions` turns
  `for (init; cond; inc)` into `{ init; bool s = cond; while (s) { { body } inc; s = cond; } }`, and copies `inc` and
  the condition update in front of every `continue`
  ([source](https://github.com/google/angle/blob/main/src/compiler/translator/tree_ops/SimplifyLoopConditions.cpp)).
  `i < 72 * GEO_1`, with `GEO_1` a ternary, is such a condition.
- **Dynamic indexing of a vector or matrix** (`v[i]`, `m[i]`) becomes a call to a generated `dyn_index_vec2(v, i)` /
  `dyn_index_write_…` helper: a `switch` over the components
  ([source](https://github.com/google/angle/blob/main/src/compiler/translator/tree_ops/RemoveDynamicIndexing.cpp)).
  Indexing an array (`a[i]`) is left to HLSL; in WebGL ("hardened") contexts its index is clamped to the bounds
  ([`ShaderD3D.cpp`](https://github.com/google/angle/blob/main/src/libANGLE/renderer/d3d/ShaderD3D.cpp)).
- **Functions that return arrays** get an out parameter; **switch fall-through** is removed; **globals** become HLSL
  `static` variables (zero-initialised).
- **Variables first assigned in an inner loop** from outside it get a `+ 0` to break an FXC aliasing bug
  ([`BreakVariableAliasingInInnerLoops`](https://github.com/google/angle/blob/main/src/compiler/translator/tree_ops/hlsl/BreakVariableAliasingInInnerLoops.cpp)).

FXC then compiles with `D3DCOMPILE_OPTIMIZATION_LEVEL2`. If that fails it tries again with skip-validation, then
skip-optimization; and an X3531 error ("can't unroll a loop marked `[loop]`") retries the same config without the
`[loop]` / `[flatten]` macros ([`Renderer11::compileToExecutable`](https://github.com/google/angle/blob/main/src/libANGLE/renderer/d3d/d3d11/Renderer11.cpp),
[`HLSLCompiler.cpp`](https://github.com/google/angle/blob/main/src/libANGLE/renderer/d3d/HLSLCompiler.cpp)).
**Every failed attempt is another full compile**, so a shader that trips one of these pays two or three times.

ANGLE compiles the HLSL at link time or later (it needs both stages' signatures; output-layout variants can compile
at draw time, [doc](https://chromium.googlesource.com/angle/angle/+/HEAD/doc/DynamicShaderCompilation.md)).

## Loops

- Without an attribute, FXC "will first attempt to emit a rolled version of the loop, and if that fails, or if some
  operations would be easier if the loop was unrolled, will fall back to an unrolled version". It "simulates loops by
  default to evaluate whether it can unroll them"; `[fastopt]` skips that and `[loop]` forces flow control
  ([`for` statement](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-for)).
- ANGLE writes no attribute on ordinary loops. It writes `[loop]` only on loops whose call graph contains a gradient
  (and `[flatten]` on the ifs around them); it never writes `[fastopt]`
  ([`OutputHLSL.cpp`](https://github.com/google/angle/blob/main/src/compiler/translator/hlsl/OutputHLSL.cpp)). We
  can't add attributes from GLSL, so the uniform-derived bound is our `[loop]`.
- `[loop]` + `[fastopt]` brought long-loop compiles "near GL" in a 2011 ANGLE patch
  ([thread](https://groups.google.com/g/angleproject/c/eWaMGHqioXY)); for another engine ANGLE's own `[loop]` /
  `[flatten]` made one shader slower, 13.8 s vs 8.5 s without
  ([flutter_scene #501](https://github.com/bdero/flutter_scene/issues/501)). Flattening is the likely cost there.
- Things FXC must unroll for — writing an array element it can't address, a gradient in a varying loop — fail with
  X3511 "forced to unroll loop, but unrolling failed" when the bound is a uniform
  ([Tint](https://dawn.googlesource.com/tint/+/b293f51f83cab41b45f334414c44e6d50fe64ba0)), and ANGLE's retries above
  kick in.
- FXC's loop unrolling is the one backend problem the WebGPU group calls critical ("It's really only FXC that we have
  a critical problem with", [gpuweb #4110](https://github.com/gpuweb/gpuweb/issues/4110)).
- FXC's time can grow exponentially with call depth: a generated chain of calls 12 deep takes FXC 107 s, 8 deep
  0.6 s; a large uber-shader takes 52.6 s with FXC's optimiser and 4.9 s without it. Benchmarks from FXC2, an
  FXC-compatible compiler built on vkd3d ([FXC2](https://github.com/MichaelMoroz/FXC2)). Keep helper chains shallow
  as well as single-call.
- The runtime cost of keeping a loop rolled isn't measured here or in the sources for loops like ours; renders stayed
  pixel-identical after every restructuring below.

## Arrays and indexing

- A dynamically indexed local array lives in an indexable temp (`x#` registers), which hardware handles worse than
  plain registers ([geidav](https://geidav.wordpress.com/2013/03/05/hidden-hlsl-performance-hit-accessing-unpadded-arrays-in-constant-buffers/),
  [Beyond3D](https://forum.beyond3d.com/threads/hlsl-array-reference-issue.40143/)). Writes FXC can't address natively
  force a loop to unroll (warning X3550) or fail outright (X3500), notably arrays inside structs and vector components
  ([wgpu #4460](https://github.com/gfx-rs/wgpu/issues/4460),
  [Tint](https://dawn.googlesource.com/tint/+/refs/heads/chromium/4765%5E%21/)). Tint's workaround: copy the array
  to a plain local, write it, copy it back.
- Array analysis grows with array size, separately from loop analysis
  ([GameDev.net](https://gamedev.net/forums/topic/593463-d3dcompile-way-too-slow/4762071/)). Keep arrays as small as
  the data needs.
- `v[i]` on a vector costs a generated `switch` per access (above); `v.x`/`.y` with constant indices or `mix` /
  `dot` with a one-hot mask avoid it.
- Repo: Truchet switched its edges and flags to bit masks, "rather than local arrays (D3D compiles dynamically indexed
  local arrays slowly)" (docs/features/fr7.2c-motif-generators.md).

## Branches, ternaries and switch

- With no attribute, FXC may compile a `switch` as a hardware switch or a series of ifs
  ([docs](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-switch)); ANGLE prints it
  without attributes. Either way every case is compiled, and what a case calls is inlined there.
- `[flatten]` evaluates both sides of an `if`
  ([docs](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-if)); ANGLE emits it only
  around loops containing gradients.
- A per-mode if/else chain is cheap if each branch only picks values; it is expensive when branches call helpers or
  run loops. Repo: Tessellation's per-mode functions with nested try loops took ~20 s; as data through one loop, 1.9 s;
  Tiles' branch per mode that wrote its shape's vertices still cost ~0.6 s of 2.4 s until the shapes became a table.

## Derivatives

- Gradient operations for ANGLE: `dFdx`, `dFdy`, `fwidth`, `texture`, `textureProj`, `textureOffset`… (implicit LOD)
  ([`ASTMetadataHLSL.cpp`](https://github.com/google/angle/blob/main/src/compiler/translator/hlsl/ASTMetadataHLSL.cpp)).
- A loop containing one (directly or through a call) gets `[loop]`, and every `if` around such a loop gets `[flatten]`
  ("D3D errors when there is a gradient operation in a loop in an unflattened if", `OutputHLSL.cpp`).
- A loop is *discontinuous* if a `break` or `continue` inside an `if` can leave it, or a `return` / `discard` happens
  inside it. There, **`dFdx` / `dFdy` are printed as `0.0`**, implicit-LOD samples become LOD 0, and every function
  called from it that uses gradients gets a second `…Lod0` copy (`OutputHLSL.cpp`: `EOpDFdx` → `(x, 0.0)`).
- Implicit-gradient texture reads in a variable-length loop made one raymarch pass 45–73 ms per frame on D3D11 vs
  ~1–1.5 ms with explicit LOD 0
  ([three-geospatial #115](https://github.com/takram-design-engineering/three-geospatial/issues/115)).
- So: take derivatives outside loops, in uniform control flow (the repo already does for Wood's anti-moiré,
  docs/features/fr7.2a-organic-generators.md), and sample with `textureLod` / `texelFetch` in loops.

## Integers

- FXC warns "Integer divides might be much slower, try using uints if possible" (X3556); ANGLE silences that warning
  (`OutputHLSL.cpp`), so it never shows. Hashes that divide or take a modulo should do it in `uint` (FXC's own advice;
  the size of the gain isn't documented). GLSL's `%` on negative operands is undefined anyway (use `imod`).

## Miscompiles

- `continue` in a loop: ANGLE / D3D11 cut Scratches' strokes short at cell borders while SwiftShader was right
  (AGENTS.md, docs/features/fr2.4-pattern-layers.md). Every generator since uses a skip flag.
- FXC has known aliasing bugs in loops: ANGLE's `+ 0` workaround above; a loop miscompiled when a `const` parameter was
  passed in it ([Stephen Hill](https://gist.github.com/selfshadow/d11280213633b1744d31)); a nested 16 × 64 loop where
  `floor(nu)` returned `nu` on every D3D11 device and was fixed by shadowing file-scope variables with locals inside
  the loop ([three-geospatial #114](https://github.com/takram-design-engineering/three-geospatial/issues/114)).
  Prefer locals declared in the loop body over globals rewritten each iteration.
- Early returns made FXC's optimised output hang the GPU (passes with optimisation off,
  [crbug 42242249](https://issues.chromium.org/issues/42242249)); a `switch` in a loop misbehaved
  ([crbug 42251176](https://issues.chromium.org/issues/42251176)).
- When a render differs only on Windows, compare against `BISMITH_ANGLE=gl` / `vulkan`; if those match SwiftShader,
  suspect the D3D path.

## Hiding the cost

- `KHR_parallel_shader_compile` adds a non-blocking `COMPLETION_STATUS_KHR` query; any other query on the program
  (link status, uniform locations, a draw) still waits for the compile
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices),
  [Ken Russell](https://www.khronos.org/webgl/public-mailing-list/public_webgl/1905/msg00014.php)). three.js's
  `renderer.compileAsync()` uses it ([docs](https://threejs.org/docs/pages/WebGLRenderer.html)); we call it from
  `Gpu.compile` (`src/gpu/context.ts`). It hides latency; it doesn't make FXC faster.
- Chrome caches compiled programs (in memory and on disk,
  [`passthrough_program_cache.h`](https://chromium.googlesource.com/chromium/src/+/195019cd1a4900bbdf372939132fe94de57f6885/gpu/command_buffer/service/passthrough_program_cache.h)),
  keyed by source, so a second visit is fast but any change to the source (a `#define`, a salt) is a cold compile.
  Specialising shaders with `#define`s multiplies cold compiles; Bismith keeps "everything is a uniform"
  (docs/architecture.md).
- Chrome's GPU watchdog kills a GPU process that stalls too long (10 s by default in 2017,
  [Ken Russell](https://groups.google.com/g/webgl-dev-list/c/9caMjxg7xO8)); the Traces and Cable shaders hung the page
  here before they were restructured.
- Other ANGLE backends (`chrome://flags/#use-angle`, or `--use-angle=gl|vulkan`) skip FXC: a 15 s freeze under ANGLE
  D3D was "a few hundred milliseconds" on GL backends, and turning ANGLE off in Firefox compiled 3–10× faster
  ([WebGL list](https://www.khronos.org/webgl/public-mailing-list/public_webgl/1702/msg00048.php)). Users mostly run
  the D3D11 default, so time that.
- Hand-reducing shader code made PlayCanvas's compiles up to 50 % faster and halved them overall
  ([WebGL list](https://www.khronos.org/webgl/public-mailing-list/public_webgl/1702/msg00048.php)): less code
  in, less FXC time out.

## Measured in this repo

Cold D3D11 compiles (RTX 5080), output unchanged unless noted:

| Generator | Before → after | Change | Doc |
| --- | --- | --- | --- |
| Tessellation | ~20 s → 1.9 s | per-mode functions with nested loops → modes as data, one flat loop, one `geo_sdPoly` | fr7.2b |
| Tiles (Tessellation + Checker) | 2.4 → 1.55 s | shape vertices from one packed table instead of a branch per mode (−0.6 s); one-pass in-place polygon inset; merged anchor cases; direct nearest-hex pick | fr7.2b |
| Setts | 1.1 → 0.35 s | shared polygon loops to `geo_n` instead of a constant 16 / 4 with `break`; `geo_gcd` uniform-bounded; inset in one pass | fr7.2b |
| Traces | > 4 min (hung) → ~1 s | per-pixel neighbour link search → links computed on the CPU, passed as a texture | fr8.8 |
| Truchet | 5.4 → 2.1 s, 2.2 → 1.2 s | one call site per helper, bit masks; then maze / rooms / circuit laid out on the CPU | fr7.2c |
| Noise | 2.3 → 0.9 s | own flat octave loop (the generic fBm inlined Worley per unrolled octave) | fr2.2 |
| Marble | 2.2 → 0.8 s | all noise through one flat loop with one `mb_fbm` call | fr7.2a |
| Cracks | 1.5 → 0.8 s | the same | fr7.2a |
| Cable | page hang → ~0.5 s | one flat loop over rows × strands × chords; fibres in a loop over the surfaces | fr7.5 |
| Custom bevel curve (every SDF layer) | Greebles 3.5 → 3.1 s, Bricks 1.45 → 1.35 s | `curve_<key>()` (`src/gpu/uniforms.ts`) looped to the constant capacity with `break` / `return`, and is inlined at every bevel-profile call site; now loops to the uniform count with a found flag (renders identical) | — |
| Greebles | 3.7 → 3.1 s | the above; a pinwheel's two cut positions through one loop (one copy of the cut helpers); randoms packed four to a hash; the 8-way nearest-sides search as flat vector math; one tube composition for detail and strip pipes; the recess wall a plain ramp (one fewer profile site). No measurable effect: a lookup table for the pinwheel's child rects, a done flag instead of `break` (kept) | fr7.2d |

- The fixed overhead of a generator shader is ~0.2 s (fr7.2a).
- Not every flattening helps: folding Drips' doubled-strike check into the main loop as a state machine compiled
  slower (fr7.7), and flattening Marble's Worley border search into its loop didn't help (fr7.2a). Measure.
- **Constant tables cost per pixel.** Tiles' first vertex table (three `const vec2` arrays, 408 entries) compiled
  fast but rendered ~20 % slower per pixel than the old branchy code (same-run A/B, 2048², 8 layers: 47 vs 39 ms);
  packing each vertex into one `int` (136 entries, decoded with shifts) brought it back to parity. FXC (or the
  driver) evidently copies a dynamically indexed constant array per invocation; keep such tables small.
- A ternary-free uniform bound (`#define GEO_1 int(uRes.x > 0.0)` instead of `(uRes.x > 0.0 ? 1 : 0)`, so ANGLE
  doesn't rewrite the loop condition) made no measurable difference on Tiles (1.57 → 1.55 s); kept, as harmless.
- New-project wizard: 45 cards compiled one after another took ~66 s; batched through `KHR_parallel_shader_compile`,
  ~7 s cold for 26 (fr8.16).

## Ideas not yet verified

Worth a measurement with `tools/compile-time.ts` before relying on them:

- **Bigger tables as textures.** A table too big to pack small could go to the GPU as a data texture
  (`cpuData`, RGBA8: exact for small integers) read with `texelFetch`, which shouldn't cost a per-pixel copy.
- **Locals for loop state.** Copy globals such as `geo_V` / `geo_n` into locals for the hot loop (or make the helpers
  take them as `inout`), given the FXC aliasing bugs with file-scope variables above.
- **`uint` hashing** throughout (no signed `/` or `%`).
- **Look at the HLSL.** `WEBGL_debug_shaders.getTranslatedShaderSource()` returns ANGLE's HLSL when Chrome runs with
  privileged extensions (`--enable-privileged-webgl-extensions`, [MDN](https://developer.mozilla.org/docs/Web/API/WEBGL_debug_shaders),
  [ANGLE debugging](https://www.ianww.com/blog/2013/01/15/debugging-angle-errors-in-webgl-on-windows/)). Feeding it
  to `fxc.exe /T ps_5_0 /O2 /Fc` on Windows would time FXC alone and show what it unrolled (`dcl_indexableTemp`,
  repeated blocks) — a quicker loop than the browser for bisecting a slow shader.

## Sources

ANGLE source (google/angle, main): `TranslatorHLSL.cpp`, `OutputHLSL.cpp`, `ASTMetadataHLSL.cpp`,
`SimplifyLoopConditions.cpp`, `RemoveDynamicIndexing.cpp`, `UnfoldShortCircuitToIf.cpp`,
`IntermNodePatternMatcher.cpp`, `BreakVariableAliasingInInnerLoops.cpp`, `ShaderD3D.cpp`, `HLSLCompiler.cpp`,
`Renderer11.cpp`, `Shader.cpp`; [commit "Use attributes to avoid unrolling and flatten conditionals"](https://chromium.googlesource.com/angle/angle/+/chromium/2193%5E!/)
(2014); [DynamicShaderCompilation.md](https://chromium.googlesource.com/angle/angle/+/HEAD/doc/DynamicShaderCompilation.md).

Microsoft: [for](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-for),
[if](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-if),
[switch](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-switch),
[function syntax](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-function-syntax),
[D3DCOMPILE constants](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/d3dcompile-constants).

Khronos / MDN / three.js: [KHR_parallel_shader_compile](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/),
[WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices),
[WEBGL_debug_shaders](https://developer.mozilla.org/docs/Web/API/WEBGL_debug_shaders),
[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html).

Reports and discussions: linked inline above (ANGLE and WebGL mailing lists, gpuweb #4110, Tint commits, wgpu #4460,
flutter_scene #501, three-geospatial #114 / #115, OneJS #130 — an interpreter shader with every opcode inlined took
7.55 s on D3D11 vs 3.6 ms on WebGPU, [link](https://github.com/Singtaa/OneJS/issues/130)).
