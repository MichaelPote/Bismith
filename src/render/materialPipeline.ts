// Stage 1 + 2 of the pipeline (docs/architecture.md §2): evaluate the layer stack into the material state
// (albedo · surface · emissive, ping-ponged MRT) and derive normals from height.

import * as THREE from 'three'
import { hiddenByMaterial, type Layer, type Project } from '@/core/project'
import { hexToLinear } from '@/core/color'
import { Gpu, PingPong, type Uniforms } from '@/gpu/context'
import { createUniforms, declareUniforms, mixSeed, updateUniforms } from '@/gpu/uniforms'
import { GLSL_COMMON } from '@/layers/glsl/common'
import { GLSL_NOISE } from '@/layers/glsl/noise'
import { GLSL_SDF } from '@/layers/glsl/sdf'
import { GLSL_BEVEL, GLSL_GENERATOR_MAIN, GLSL_NAMED_MASK, bevelCurveDefine, bevelCurveImpl } from '@/layers/commonParams'
import { getLayerDef, layerParamDefs } from '@/layers/registry'
import type { LayerDef } from '@/layers/types'

/** Declarations available to every material-stage shader. */
const STATE_DECLS = /* glsl */ `
uniform sampler2D tAlbedo;
uniform sampler2D tSurface;
uniform sampler2D tEmissive;
uniform sampler2D tMasks;
uniform float uSeed;
uniform float uDepth;
`

// Named masks (FR8.13) ride along as a fourth attachment: four mask channels, written by generators.
const MRT_OUTS = /* glsl */ `
layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oSurface;
layout(location = 2) out vec4 oEmissive;
layout(location = 3) out vec4 oMasks;
`

/** An MRT pass body that doesn't write the masks gets them passed through (filters never change them). */
function withMaskPassThrough(body: string): string {
  if (body.includes('oMasks')) return body
  return body.replace(/void\s+main\s*\(\s*\)/, 'void mainBody()') + '\nvoid main() { mainBody(); oMasks = texelFetch(tMasks, ivec2(gl_FragCoord.xy), 0); }\n'
}

const GENOUT = /* glsl */ `
// gen() may return sdf <= NO_SDF to opt out of SDF handling for a pixel.
const float NO_SDF = -9e4;
// height: a signed height profile of the generator's own (× the Height amount), or NO_SDF for none (see genOutHeight).
// own (SDF layers): 0 the wrapper draws the shape (value = bevel, coverage = inside); 1 the generator painted its value
// and coverage itself, sdf only goes to the Shape Mask and named masks (genOutOwn); 2 the generator's value × the
// shape's bevel, its own coverage (genOutShaded).
// hval: what Height › Pattern reads instead of the value (0..1, shaped like it; < 0 = the value) — Wood's grain is
// shallower in Height than in colour.
// bdist: the distance the bevel is measured in, Bevel aspect already applied (px of Bevel; NO_SDF = the shape's own
// distance, the aspect taken from its direction) — exact on boxes, whose bevels then meet in a clean mitre.
struct GenOut { float value; float mask; float rnd; float sdf; float feat; float height; int own; float hval; float bdist; };
GenOut genOut(float value, float mask, float rnd, float sdf) { return GenOut(value, mask, rnd, sdf, 1.0, NO_SDF, 0, -1.0, NO_SDF); }
// Patterns without features (smooth noise, clouds): rnd is a continuous value there, so per-feature variation has
// nothing to vary — fract(rnd · k) would turn it into terraces along the pattern's contours.
GenOut genOutSmooth(float value, float mask, float rnd, float sdf) { return GenOut(value, mask, rnd, sdf, 0.0, NO_SDF, 0, -1.0, NO_SDF); }
// With its own height profile, signed (below the surface < 0): Height › Pattern adds it instead of the value, wherever it
// is non-zero — not limited by the coverage, so it can reach past what the other outputs paint (a lip round a hole).
GenOut genOutHeight(float value, float mask, float rnd, float sdf, float height) { return GenOut(value, mask, rnd, sdf, 1.0, height, 0, -1.0, NO_SDF); }
// An SDF layer's output that paints its own value and coverage (chips' carve) but still hands its shape to the Shape
// Mask: the wrapper writes sdf to the register (by the Mode) and named masks only.
GenOut genOutOwn(float value, float mask, float rnd, float sdf) { return GenOut(value, mask, rnd, sdf, 1.0, NO_SDF, 1, -1.0, NO_SDF); }
// A pattern on a shape (Wood's grain on its planks): the wrapper multiplies the value (and hval) by the bevel of the
// combined shape — Bevel, Profile, Bevel aspect, the Shape Mask mode — and keeps the generator's coverage.
GenOut genOutShaded(float value, float mask, float rnd, float sdf) { return GenOut(value, mask, rnd, sdf, 1.0, NO_SDF, 2, -1.0, NO_SDF); }
`

/** Everything a GLSL snippet in the material stage can rely on. */
export const MATERIAL_PRELUDE = STATE_DECLS + GLSL_COMMON + GLSL_NOISE + GLSL_SDF

export const SHAPE_REGISTER_EMPTY = 1e4

export interface FilterContext {
  gpu: Gpu
  project: Project
  layer: Layer
  width: number
  height: number
  /** Current material state (read side). */
  readonly albedo: THREE.Texture
  readonly surface: THREE.Texture
  readonly emissive: THREE.Texture
  /** The layer's combined seed (uSeed). */
  seed: number
  /**
   * An MRT material (writes oAlbedo/oSurface/oEmissive). `body` is GLSL appended after the prelude, the
   * layer's u_<param> uniforms and the MRT outputs; it must define main(). Cached by key.
   */
  mrtMaterial(key: string, body: string, extraUniforms?: Uniforms): THREE.RawShaderMaterial
  /** A single-output material (`out vec4 oColor`). Same prelude and param uniforms. Cached by key. */
  material(key: string, body: string, extraUniforms?: Uniforms): THREE.RawShaderMaterial
  /** Run an MRT pass into the back state buffer and swap: state textures then point at the result. */
  runMRT(mat: THREE.RawShaderMaterial): void
  /** Run a single-output pass into a target. Common uniforms are refreshed automatically. */
  run(mat: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget): void
  /** A float RGBA scratch target (texture size unless given), cached by name. */
  scratch(name: string, width?: number, height?: number): THREE.WebGLRenderTarget
}

export interface HeightStats {
  min: number
  max: number
}

export class MaterialPipeline {
  private gpu: Gpu
  private state: PingPong | null = null
  normal: THREE.WebGLRenderTarget | null = null
  private width = 0
  private height = 0
  private materials = new Map<string, THREE.RawShaderMaterial>()
  /** Generator types whose shader has been compiled (run, or precompiled). */
  private compiled = new Set<string>()
  /** A comment in generator shaders (measuring cold compiles: a new salt defeats the browser's and driver's caches). */
  private salt = ''
  private scratchTargets = new Map<string, THREE.WebGLRenderTarget>()
  private clearMat: THREE.RawShaderMaterial
  private normalMat: THREE.RawShaderMaterial
  private reduceMat: THREE.RawShaderMaterial
  heightStats: HeightStats = { min: 0, max: 0 }
  /** Last compile/runtime error per layer id (shown in the UI). */
  errors = new Map<string, string>()
  /** Called with the layer id before each layer runs (lets the engine attribute shader errors). */
  onBeforeLayer: ((layerId: string) => void) | null = null

  constructor(gpu: Gpu) {
    this.gpu = gpu
    this.clearMat = gpu.material(
      GLSL_COMMON +
        MRT_OUTS +
        /* glsl */ `
      uniform vec4 uBaseAlbedo;
      uniform vec4 uBaseSurface;
      uniform float uBaseSpecular;
      uniform sampler2D tInitMasks;
      uniform bool uInitMasks;
      void main() {
        oAlbedo = uBaseAlbedo;
        oSurface = uBaseSurface;
        oEmissive = vec4(0.0, 0.0, 0.0, uBaseSpecular);
        oMasks = uInitMasks ? texelFetch(tInitMasks, ivec2(gl_FragCoord.xy), 0) : vec4(0.0);
      }`,
      {
        uRes: { value: new THREE.Vector2() },
        uTile: { value: true },
        uBaseAlbedo: { value: new THREE.Vector4() },
        uBaseSurface: { value: new THREE.Vector4() },
        uBaseSpecular: { value: 0.5 },
        tInitMasks: { value: null },
        uInitMasks: { value: false },
      },
    )
    this.normalMat = gpu.material(
      STATE_DECLS +
        GLSL_COMMON +
        /* glsl */ `
      out vec4 oColor;
      float hpx(ivec2 c) { return fetchT(tSurface, c).r * uDepth; }
      void main() {
        ivec2 c = ivec2(gl_FragCoord.xy);
        float tl = hpx(c + ivec2(-1, 1)), t = hpx(c + ivec2(0, 1)), tr = hpx(c + ivec2(1, 1));
        float l = hpx(c + ivec2(-1, 0)), h = hpx(c), r = hpx(c + ivec2(1, 0));
        float bl = hpx(c + ivec2(-1, -1)), b = hpx(c + ivec2(0, -1)), br = hpx(c + ivec2(1, -1));
        float dx = ((tr + 2.0 * r + br) - (tl + 2.0 * l + bl)) / 8.0;
        float dy = ((tl + 2.0 * t + tr) - (bl + 2.0 * b + br)) / 8.0;
        oColor = vec4(normalize(vec3(-dx, -dy, 1.0)), h);
      }`,
      this.commonUniforms(),
    )
    this.reduceMat = gpu.material(
      /* glsl */ `
      uniform sampler2D tSrc;
      uniform vec2 uSrcSize;
      uniform bool uFirst;
      out vec4 oColor;
      void main() {
        ivec2 base = ivec2(gl_FragCoord.xy) * 8;
        ivec2 lim = ivec2(uSrcSize) - 1;
        float mn = 1e30, mx = -1e30;
        for (int y = 0; y < 8; y++)
        for (int x = 0; x < 8; x++) {
          vec4 v = texelFetch(tSrc, min(base + ivec2(x, y), lim), 0);
          float a = uFirst ? v.w : v.x;
          float b = uFirst ? v.w : v.y;
          mn = min(mn, a);
          mx = max(mx, b);
        }
        oColor = vec4(mn, mx, 0.0, 1.0);
      }`,
      { tSrc: { value: null }, uSrcSize: { value: new THREE.Vector2() }, uFirst: { value: true } },
    )
  }

  get albedo(): THREE.Texture | null {
    return this.state?.read.textures[0] ?? null
  }
  get surface(): THREE.Texture | null {
    return this.state?.read.textures[1] ?? null
  }
  get emissive(): THREE.Texture | null {
    return this.state?.read.textures[2] ?? null
  }
  get masks(): THREE.Texture | null {
    return this.state?.read.textures[3] ?? null
  }
  get normalTex(): THREE.Texture | null {
    return this.normal?.texture ?? null
  }

  private commonUniforms(): Uniforms {
    return {
      uRes: { value: new THREE.Vector2() },
      uTile: { value: true },
      uSeed: { value: 0 },
      uDepth: { value: 1 },
      tAlbedo: { value: null },
      tSurface: { value: null },
      tEmissive: { value: null },
      tMasks: { value: null },
    }
  }

  private resize(w: number, h: number): void {
    if (this.state && this.width === w && this.height === h) return
    this.state?.dispose()
    this.normal?.dispose()
    for (const t of this.scratchTargets.values()) t.dispose()
    this.scratchTargets.clear()
    this.state = new PingPong(this.gpu, w, h, { count: 4 })
    this.normal = this.gpu.target(w, h)
    this.width = w
    this.height = h
  }

  private setCommon(mat: THREE.RawShaderMaterial, project: Project, seed: number): void {
    const u = mat.uniforms
    if (u.uRes) (u.uRes.value as THREE.Vector2).set(this.width, this.height)
    if (u.uTile) u.uTile.value = project.tileable
    if (u.uSeed) u.uSeed.value = seed
    if (u.uDepth) u.uDepth.value = project.heightDepth
    if (u.tAlbedo) u.tAlbedo.value = this.state!.read.textures[0]
    if (u.tSurface) u.tSurface.value = this.state!.read.textures[1]
    if (u.tEmissive) u.tEmissive.value = this.state!.read.textures[2]
    if (u.tMasks) u.tMasks.value = this.state!.read.textures[3]
  }

  private blank: THREE.DataTexture | null = null
  private cpuCache = new Map<string, { key: string; tex: Record<string, THREE.DataTexture> }>()

  private blankTexture(): THREE.DataTexture {
    if (!this.blank) {
      this.blank = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
      this.blank.needsUpdate = true
    }
    return this.blank
  }

  /** CPU-computed data textures of a generator layer (LayerDef.cpuData), cached until its inputs change. */
  private cpuTextures(def: LayerDef, layer: Layer, project: Project, seed: number): Record<string, THREE.DataTexture> {
    const key = JSON.stringify([layer.params, this.width, this.height, project.tileable, seed])
    const hit = this.cpuCache.get(layer.id)
    if (hit && hit.key === key) return hit.tex
    if (hit) for (const t of Object.values(hit.tex)) t.dispose()
    const data = def.cpuData!(layer.params, { width: this.width, height: this.height, tileable: project.tileable, seed })
    const tex: Record<string, THREE.DataTexture> = {}
    for (const [name, d] of Object.entries(data)) {
      const t = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, THREE.UnsignedByteType)
      t.minFilter = THREE.NearestFilter
      t.magFilter = THREE.NearestFilter
      t.needsUpdate = true
      tex[name] = t
    }
    this.cpuCache.set(layer.id, { key, tex })
    return tex
  }

  /**
   * A generator's data textures: from the CPU (LayerDef.cpuData, cached) and from its GPU pre-passes over the current
   * state (LayerDef.prepare, run every time — they read what the layers before left).
   */
  private bindTextures(def: LayerDef, layer: Layer, project: Project, seed: number, mat: THREE.RawShaderMaterial): void {
    if (def.cpuData) for (const [name, t] of Object.entries(this.cpuTextures(def, layer, project, seed))) mat.uniforms[`t_${name}`].value = t
    if (def.prepare) {
      for (const t of def.textures ?? []) mat.uniforms[`t_${t}`].value = this.blankTexture()
      for (const [name, t] of Object.entries(def.prepare(this.filterContext(project, layer, seed), layer))) mat.uniforms[`t_${name}`].value = t
    }
  }

  /** Generator types among `types` whose shader isn't compiled yet: their first run would compile it, stalling the page. */
  uncompiled(types: string[]): string[] {
    return [...new Set(types)].filter((t) => getLayerDef(t)?.kind === 'generator' && !this.compiled.has(t))
  }

  /** Generator shaders compile afresh after this (cold-compile timing; the old programs stay cached under the old salt). */
  setShaderSalt(salt: string): void {
    this.salt = salt
    this.compiled.clear()
  }

  /** Compile generators' shaders ahead of their first run (see GpuContext.compile). */
  async precompile(types: string[]): Promise<void> {
    const defs = this.uncompiled(types).map((t) => getLayerDef(t)!)
    await this.gpu.compile(defs.map((d) => this.generatorMaterial(d)))
    for (const d of defs) this.compiled.add(d.type)
  }

  private generatorMaterial(def: LayerDef): THREE.RawShaderMaterial {
    const key = `gen:${def.type}${this.salt}`
    let mat = this.materials.get(key)
    if (!mat) {
      const defs = layerParamDefs(def.type)
      const frag =
        (this.salt ? `// salt ${this.salt}\n` : '') +
        bevelCurveDefine(defs) +
        MATERIAL_PRELUDE +
        MRT_OUTS +
        declareUniforms(defs) +
        bevelCurveImpl(defs) +
        GENOUT +
        (def.sdf === true ? GLSL_BEVEL : '') +
        (def.textures ?? []).map((t) => `uniform sampler2D t_${t};\n`).join('') +
        (def.glsl ?? '') +
        GLSL_GENERATOR_MAIN(def.sdf === 'mask' ? 'mask' : Boolean(def.sdf))
      const tex = Object.fromEntries((def.textures ?? []).map((t) => [`t_${t}`, { value: this.blankTexture() }]))
      mat = this.gpu.material(frag, { ...this.commonUniforms(), ...createUniforms(defs), ...tex, uWriteMasks: { value: false } })
      this.materials.set(key, mat)
    }
    return mat
  }

  private filterContext(project: Project, layer: Layer, seed: number): FilterContext {
    // oxlint-disable-next-line no-this-alias -- getters on the context object need the pipeline
    const self = this
    const defs = layerParamDefs(layer.type)
    const build = (key: string, body: string, outs: string, extra?: Uniforms) => {
      const k = `flt:${layer.type}:${key}`
      let mat = self.materials.get(k)
      if (!mat) {
        const full = outs === MRT_OUTS ? withMaskPassThrough(body) : body
        mat = self.gpu.material(bevelCurveDefine(defs) + MATERIAL_PRELUDE + outs + declareUniforms(defs) + bevelCurveImpl(defs) + full, {
          ...self.commonUniforms(),
          ...createUniforms(defs),
          ...(extra ?? {}),
        })
        self.materials.set(k, mat)
      }
      updateUniforms(mat.uniforms, defs, layer.params)
      return mat
    }
    return {
      gpu: this.gpu,
      project,
      layer,
      width: this.width,
      height: this.height,
      get albedo() {
        return self.state!.read.textures[0]
      },
      get surface() {
        return self.state!.read.textures[1]
      },
      get emissive() {
        return self.state!.read.textures[2]
      },
      seed,
      mrtMaterial: (key, body, extra) => build(key, body, MRT_OUTS, extra),
      material: (key, body, extra) => build(key, body, 'out vec4 oColor;\n', extra),
      runMRT(mat) {
        self.setCommon(mat, project, seed)
        self.gpu.run(mat, self.state!.write)
        self.state!.swap()
      },
      run(mat, target) {
        self.setCommon(mat, project, seed)
        self.gpu.run(mat, target)
      },
      scratch(name, w, h) {
        const width = w ?? self.width
        const height = h ?? self.height
        const k = `${name}:${width}x${height}`
        let t = self.scratchTargets.get(k)
        if (!t) {
          t = self.gpu.target(width, height)
          self.scratchTargets.set(k, t)
        }
        return t
      },
    }
  }

  /**
   * Evaluate the stack. `upTo` (inclusive layer index) previews the stack partway; -1 = base only.
   */
  evaluate(project: Project, upTo = Infinity): void {
    this.resize(project.width, project.height)
    const state = this.state!
    this.errors.clear()

    // Clear to the base material.
    const base = project.base
    const lin = hexToLinear(base.color)
    const cu = this.clearMat.uniforms
    const clear = (initMasks: boolean) => {
      ;(cu.uRes.value as THREE.Vector2).set(this.width, this.height)
      ;(cu.uBaseAlbedo.value as THREE.Vector4).set(lin[0], lin[1], lin[2], base.opacity)
      ;(cu.uBaseSurface.value as THREE.Vector4).set(base.height, base.roughness, 0, SHAPE_REGISTER_EMPTY)
      cu.uBaseSpecular.value = base.specular
      cu.uInitMasks.value = initMasks
      cu.tInitMasks.value = state.read.textures[3]
      this.gpu.run(this.clearMat, state.write)
      state.swap()
    }

    // Named masks (FR8.13) first: every layer that writes one runs, in stack order, on a scratch evaluation; the
    // masks it leaves are where the real evaluation starts — so a mask applies wherever its writer sits.
    const order = project.layers
    const hidden = hiddenByMaterial(project)
    const on = (l: Layer) => l.enabled && !hidden.has(l.id)
    // (Layers that read earlier state — readsState — write their masks in place instead.)
    const writers = order.filter((l, i) => {
      const def = getLayerDef(l.type)
      return i <= upTo && on(l) && String(l.params.mk_write ?? 'none') !== 'none' && def?.kind === 'generator' && !def.readsState
    })
    clear(false)
    if (writers.length) {
      for (const layer of writers) {
        const def = getLayerDef(layer.type)!
        const seed = mixSeed(Number(layer.params.seed ?? 0), project.seed)
        try {
          const mat = this.generatorMaterial(def)
          updateUniforms(mat.uniforms, layerParamDefs(def.type), layer.params)
          this.bindTextures(def, layer, project, seed, mat)
          this.setCommon(mat, project, seed)
          mat.uniforms.uWriteMasks.value = true
          this.gpu.run(mat, state.write)
          mat.uniforms.uWriteMasks.value = false
          state.swap()
        } catch {
          // Reported when the layer runs in the evaluation proper.
        }
      }
      clear(true)
    }

    order.forEach((layer, index) => {
      if (index > upTo || !on(layer)) return
      const def = getLayerDef(layer.type)
      if (!def) {
        this.errors.set(layer.id, `Unknown layer type "${layer.type}"`)
        return
      }
      const seed = mixSeed(Number(layer.params.seed ?? 0), project.seed)
      this.onBeforeLayer?.(layer.id)
      try {
        if (def.kind === 'generator') {
          const mat = this.generatorMaterial(def)
          updateUniforms(mat.uniforms, layerParamDefs(def.type), layer.params)
          this.bindTextures(def, layer, project, seed, mat)
          this.setCommon(mat, project, seed)
          // Masks are written in the pre-pass, except by layers that read earlier state: those write in place.
          mat.uniforms.uWriteMasks.value = def.readsState === true
          this.gpu.run(mat, state.write)
          mat.uniforms.uWriteMasks.value = false
          this.compiled.add(def.type)
          state.swap()
        } else if (def.run) {
          // Multi-pass filters: masked, they run on the whole state and are blended back by the mask after.
          const masked = String(layer.params.mk_use ?? 'none') !== 'none'
          if (masked) this.snapshot(project)
          def.run(this.filterContext(project, layer, seed), layer)
          if (masked) this.blendMasked(project, layer, seed)
        } else if (def.filterGlsl) {
          const ctx = this.filterContext(project, layer, seed)
          const mat = ctx.mrtMaterial(
            'main',
            def.filterGlsl +
              GLSL_NAMED_MASK +
              /* glsl */ `
            void main() {
              ivec2 ip = ivec2(gl_FragCoord.xy);
              vec4 A = texelFetch(tAlbedo, ip, 0);
              vec4 S = texelFetch(tSurface, ip, 0);
              vec4 E = texelFetch(tEmissive, ip, 0);
              vec4 M = texelFetch(tMasks, ip, 0);
              vec4 A0 = A, S0 = S, E0 = E;
              applyFilter(A, S, E, ip);
              float k = namedMask(M);
              oAlbedo = mix(A0, A, k); oSurface = mix(S0, S, k); oEmissive = mix(E0, E, k); oMasks = M;
            }`,
          )
          ctx.runMRT(mat)
        }
      } catch (e) {
        this.errors.set(layer.id, e instanceof Error ? e.message : String(e))
      }
    })

    // Normals (xyz) + world height in px (w).
    this.onBeforeLayer?.('normals')
    this.setCommon(this.normalMat, project, 0)
    this.gpu.run(this.normalMat, this.normal!)
    this.updateHeightStats()
  }

  private snapshotTarget: THREE.WebGLRenderTarget | null = null
  private copyMat: THREE.RawShaderMaterial | null = null

  /** Copy the current state aside (before a masked multi-pass filter). */
  private snapshot(project: Project): void {
    if (!this.snapshotTarget || this.snapshotTarget.width !== this.width || this.snapshotTarget.height !== this.height) {
      this.snapshotTarget?.dispose()
      this.snapshotTarget = this.gpu.target(this.width, this.height, { count: 4 })
    }
    if (!this.copyMat) {
      this.copyMat = this.gpu.material(
        STATE_DECLS + GLSL_COMMON + MRT_OUTS + /* glsl */ `
        void main() {
          ivec2 c = ivec2(gl_FragCoord.xy);
          oAlbedo = texelFetch(tAlbedo, c, 0); oSurface = texelFetch(tSurface, c, 0); oEmissive = texelFetch(tEmissive, c, 0); oMasks = texelFetch(tMasks, c, 0);
        }`,
        this.commonUniforms(),
      )
    }
    this.setCommon(this.copyMat, project, 0)
    this.gpu.run(this.copyMat, this.snapshotTarget)
  }

  /** Blend a masked multi-pass filter's result with the state before it, by the layer's named mask. */
  private blendMasked(project: Project, layer: Layer, seed: number): void {
    const ctx = this.filterContext(project, layer, seed)
    const mat = ctx.mrtMaterial(
      'mask-blend',
      GLSL_NAMED_MASK +
        /* glsl */ `
      uniform sampler2D tPrevA;
      uniform sampler2D tPrevS;
      uniform sampler2D tPrevE;
      uniform sampler2D tPrevM;
      void main() {
        ivec2 c = ivec2(gl_FragCoord.xy);
        vec4 M = texelFetch(tPrevM, c, 0);
        float k = namedMask(M);
        oAlbedo = mix(texelFetch(tPrevA, c, 0), texelFetch(tAlbedo, c, 0), k);
        oSurface = mix(texelFetch(tPrevS, c, 0), texelFetch(tSurface, c, 0), k);
        oEmissive = mix(texelFetch(tPrevE, c, 0), texelFetch(tEmissive, c, 0), k);
        oMasks = M;
      }`,
      { tPrevA: { value: null }, tPrevS: { value: null }, tPrevE: { value: null }, tPrevM: { value: null } },
    )
    const t = this.snapshotTarget!.textures
    mat.uniforms.tPrevA.value = t[0]
    mat.uniforms.tPrevS.value = t[1]
    mat.uniforms.tPrevE.value = t[2]
    mat.uniforms.tPrevM.value = t[3]
    ctx.runMRT(mat)
  }

  /** Min/max world height via an 8×8-block GPU reduction, then a tiny readback. */
  private updateHeightStats(): void {
    let src: THREE.Texture = this.normal!.texture
    let w = this.width
    let h = this.height
    let first = true
    let level = 0
    while (first || w > 8 || h > 8) {
      const nw = Math.max(1, Math.ceil(w / 8))
      const nh = Math.max(1, Math.ceil(h / 8))
      const key = `reduce${level}:${nw}x${nh}`
      let t = this.scratchTargets.get(key)
      if (!t) {
        t = this.gpu.target(nw, nh)
        this.scratchTargets.set(key, t)
      }
      const u = this.reduceMat.uniforms
      u.tSrc.value = src
      ;(u.uSrcSize.value as THREE.Vector2).set(w, h)
      u.uFirst.value = first
      this.gpu.run(this.reduceMat, t)
      src = t.texture
      w = nw
      h = nh
      first = false
      level++
    }
    const data = this.gpu.readTexture(src, w, h)
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < data.length; i += 4) {
      min = Math.min(min, data[i])
      max = Math.max(max, data[i + 1])
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) min = max = 0
    this.heightStats = { min, max }
  }

  /** Read one attachment of the current state as RGBA float (GL row order). */
  readState(index: 0 | 1 | 2 | 3): Float32Array {
    return this.gpu.readTexture(this.state!.read.textures[index], this.width, this.height)
  }

  /** Read the material at one texel (x, y in user space: y down). */
  probe(x: number, y: number): { albedo: Float32Array; surface: Float32Array; emissive: Float32Array } | null {
    if (!this.state || x < 0 || y < 0 || x >= this.width || y >= this.height) return null
    const gy = this.height - 1 - y
    const r = this.gpu.renderer
    const read = (i: number) => {
      const buf = new Float32Array(4)
      r.readRenderTargetPixels(this.state!.read, x, gy, 1, 1, buf, undefined, i)
      return buf
    }
    return { albedo: read(0), surface: read(1), emissive: read(2) }
  }

  readNormal(): Float32Array {
    return this.gpu.readTexture(this.normal!.texture, this.width, this.height)
  }

  dispose(): void {
    this.state?.dispose()
    this.normal?.dispose()
    for (const m of this.materials.values()) m.dispose()
    for (const t of this.scratchTargets.values()) t.dispose()
    this.clearMat.dispose()
    this.normalMat.dispose()
    this.reduceMat.dispose()
    this.copyMat?.dispose()
    this.snapshotTarget?.dispose()
  }
}
