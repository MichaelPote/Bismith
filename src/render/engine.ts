// The Engine owns the WebGL context and orchestrates the pipeline (docs/architecture.md §2):
// material stack → normals → path tracer → post stack → display. It watches project keys and only redoes
// the stages that a change invalidates.

import * as THREE from 'three'
import { SHAPE_MASK, hiddenByMaterial, type Project } from '@/core/project'
import { Gpu } from '@/gpu/context'
import { GLSL_COMMON } from '@/layers/glsl/common'
import { MaterialPipeline } from './materialPipeline'
import { PathTracer } from './pathtracer'
import { PostStack } from './post/stack'
import { Display, type ChannelView, type DisplayOptions, type ViewTransform } from './display'
import { ensureBuiltins } from './builtins'
import { scaleProject, supersampleFactor } from '@/core/supersample'
import { clamp01, linearToSrgb1 } from '@/core/color'
import { onImageReady, pendingImages } from '@/core/images'

// Box filter for supersampling: average each k×k block of the traced image (linear HDR) into one texel.
const DOWNSAMPLE = /* glsl */ `
uniform sampler2D tSrc;
uniform int uK;
out vec4 oColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * uK;
  vec4 s = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    if (y >= uK) break;
    for (int x = 0; x < 4; x++) {
      if (x >= uK) break;
      s += texelFetch(tSrc, p + ivec2(x, y), 0);
    }
  }
  oColor = s / float(uK * uK);
}
`

export interface EngineStats {
  samples: number
  maxSamples: number
  /** Wall-clock ms of the last material evaluation. */
  evalMs: number
  /** Samples per second over the last second. */
  samplesPerSec: number
  /** True while showing the fast interactive preview. */
  draft: boolean
  heightMin: number
  heightMax: number
  errors: Record<string, string>
}

export interface EngineView {
  channel: ChannelView
  transform: ViewTransform
  options: DisplayOptions
  /** Evaluate the stack only up to this layer index (inclusive); null = all. */
  previewUpTo: number | null
  /** The mask the Masks view shows (FR8.23). */
  mask: string
}

export interface ImageData32 {
  width: number
  height: number
  /** RGBA float, rows top-to-bottom. */
  data: Float32Array
}

export class Engine {
  readonly gpu: Gpu
  readonly material: MaterialPipeline
  readonly tracer: PathTracer
  readonly post: PostStack
  private display: Display
  private project: Project | null = null
  private view: EngineView = {
    channel: 'final',
    transform: { zoom: 1, offsetX: 0, offsetY: 0 },
    options: { tile: false, grid: true, checker: true },
    previewUpTo: null,
    mask: SHAPE_MASK,
  }
  private canvasSize: [number, number] = [1, 1]
  private materialKey = ''
  /** Supersampling factor and the k× project the material stack and tracer render. */
  private ss = 1
  private inner: Project | null = null
  private down: THREE.WebGLRenderTarget | null = null
  private downMat: THREE.RawShaderMaterial | null = null
  private traceKey = ''
  private postKey = ''
  private materialDirty = true
  private traceDirty = true
  private postDirty = true
  private displayDirty = true
  private raf = 0
  private running = false
  private suspended = false
  private sampleTimes: number[] = []
  private shaderErrors = new Map<string, string>()
  /** Time of the last material / lighting edit; while recent, the tracer runs in draft quality. */
  private lastEdit = -Infinity
  private draft = false
  /** Draft (fast preview) settings used while the user is dragging. */
  draftWindowMs = 250
  private currentShaderOwner = ''
  stats: EngineStats = { samples: 0, maxSamples: 0, evalMs: 0, samplesPerSec: 0, draft: false, heightMin: 0, heightMax: 0, errors: {} }
  onStats: ((s: EngineStats) => void) | null = null
  /** Called after each material evaluation (e.g. to refresh thumbnails). */
  onMaterial: (() => void) | null = null
  /** settled() callers waiting for the pending material evaluation. */
  private materialWaiters: (() => void)[] = []
  private offImages: () => void = () => undefined
  paused = false

  constructor(canvas: HTMLCanvasElement) {
    ensureBuiltins()
    this.gpu = new Gpu(canvas)
    this.gpu.gl.getExtension('OES_texture_float_linear')
    this.gpu.renderer.debug.onShaderError = (gl, _program, vs, fs) => {
      const log = (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || '')
      this.shaderErrors.set(this.currentShaderOwner || 'shader', log.trim() || 'Shader failed to compile')
      console.error('[bismith] shader error in', this.currentShaderOwner, log)
    }
    this.material = new MaterialPipeline(this.gpu)
    this.material.onBeforeLayer = (id) => {
      this.currentShaderOwner = id
    }
    this.material.onVariantReady = () => {
      this.materialDirty = true
      this.kick()
    }
    // An image a layer uses (core/images.ts) has decoded: evaluate again with it.
    this.offImages = onImageReady(() => {
      this.materialDirty = true
      this.kick()
    })
    this.tracer = new PathTracer(this.gpu)
    this.post = new PostStack(this.gpu)
    this.display = new Display(this.gpu, GLSL_COMMON)
  }

  setProject(project: Project): void {
    this.project = project
    // Supersampling: the material stack and the tracer see the k× project; post runs at the real size.
    this.ss = supersampleFactor(project)
    const inner = scaleProject(project, this.ss)
    this.inner = inner
    const upTo = this.view.previewUpTo
    const mKey = JSON.stringify([
      inner.width, inner.height, inner.tileable, inner.heightDepth, inner.seed, inner.base, inner.layers, upTo, [...hiddenByMaterial(inner)],
    ])
    const tKey = JSON.stringify([inner.lighting, inner.render, this.ss])
    const pKey = JSON.stringify(project.post)
    const first = this.materialKey === ''
    if (mKey !== this.materialKey) {
      this.materialKey = mKey
      this.materialDirty = true
      if (!first) this.lastEdit = performance.now()
    }
    if (tKey !== this.traceKey) {
      this.traceKey = tKey
      this.traceDirty = true
      if (!first) this.lastEdit = performance.now()
    }
    if (pKey !== this.postKey) {
      this.postKey = pKey
      this.postDirty = true
    }
    this.kick()
  }

  setView(view: Partial<EngineView>): void {
    const prevUpTo = this.view.previewUpTo
    this.view = { ...this.view, ...view }
    if (view.previewUpTo !== undefined && view.previewUpTo !== prevUpTo && this.project) {
      this.setProject(this.project)
    }
    this.displayDirty = true
    this.kick()
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    if (w === this.canvasSize[0] && h === this.canvasSize[1]) return
    this.canvasSize = [w, h]
    this.gpu.renderer.setPixelRatio(1)
    this.gpu.renderer.setSize(w, h, false)
    this.displayDirty = true
    this.kick()
  }

  /** Generator shaders among `keys` (shaderKey of the layers) not compiled yet (their first use would stall the page). */
  uncompiled(keys: string[]): string[] {
    return this.material.uncompiled(keys)
  }

  /** Shader compiles run off the main thread here, so precompile() leaves the page responsive. */
  get parallelCompile(): boolean {
    return this.gpu.parallelCompile
  }

  /** Compile generator shaders ahead of their first use (see MaterialPipeline.precompile). */
  precompile(keys: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    return this.material.precompile(keys, onProgress)
  }

  /** Make the next compiles cold (a fresh salt in the shaders): for measuring compile times only. */
  setShaderSalt(salt: string): void {
    this.material.setShaderSalt(salt)
  }

  /** Resolves once the pending material evaluation has run (at once if none is pending or the loop is stopped). */
  settled(): Promise<void> {
    if (!this.materialDirty || !this.running || this.suspended) return Promise.resolve()
    return new Promise((resolve) => this.materialWaiters.push(resolve))
  }

  /** Images the project's layers use, decoded, and the evaluation with them done (headless renders). */
  async imagesSettled(): Promise<void> {
    await pendingImages()
    await this.settled()
  }

  private releaseWaiters(): void {
    for (const resolve of this.materialWaiters.splice(0)) resolve()
  }

  /** Force a restart of accumulation (e.g. after the user asks to re-render). */
  restart(): void {
    this.traceDirty = true
    this.kick()
  }

  start(): void {
    this.running = true
    this.kick()
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.releaseWaiters()
  }

  /**
   * Suspend the interactive loop entirely (e.g. while an optimiser drives renderNow() synchronously).
   * Resuming re-applies `project` (or the last one set) and restarts the loop.
   */
  suspend(): void {
    this.suspended = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.releaseWaiters()
  }

  resume(project?: Project): void {
    this.suspended = false
    if (project) this.setProject(project)
    this.traceDirty = true
    this.displayDirty = true
    this.kick()
  }

  private kick(): void {
    if (!this.running || this.raf || this.suspended) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      const more = this.tick()
      if (more) this.kick()
    })
  }

  /** Bring material + tracer configuration up to date. `allowDraft` enables the interactive fast preview. */
  private prepare(allowDraft = false): void {
    const project = this.inner ?? this.project!
    const draft = allowDraft && performance.now() - this.lastEdit < this.draftWindowMs
    if (draft !== this.draft) {
      this.draft = draft
      this.traceDirty = true
    }
    if (this.materialDirty) {
      const t0 = performance.now()
      this.shaderErrors.clear()
      this.material.evaluate(project, this.view.previewUpTo ?? Infinity)
      this.stats.evalMs = performance.now() - t0
      this.materialDirty = false
      this.traceDirty = true
      this.onMaterial?.()
      this.releaseWaiters()
    }
    if (this.traceDirty) {
      this.tracer.configure(project, this.material, this.draft ? { bounces: Math.min(1, project.render.bounces) } : undefined)
      this.tracer.reset()
      this.traceDirty = false
      this.postDirty = true
    }
  }

  /** One frame of work. Returns true while there is more to do. */
  tick(): boolean {
    const project = this.project
    if (!project) return false
    this.prepare(true)
    const r = project.render
    let traced = 0
    if (!this.paused && this.tracer.samples < r.maxSamples) {
      traced = this.tracer.trace(this.draft ? 1 : Math.max(1, r.samplesPerFrame), r.maxSamples)
      if (traced > 0) this.postDirty = true
      const now = performance.now()
      for (let i = 0; i < traced; i++) this.sampleTimes.push(now)
      while (this.sampleTimes.length && now - this.sampleTimes[0] > 1000) this.sampleTimes.shift()
    }
    if (this.postDirty && this.tracer.output) {
      this.currentShaderOwner = 'post'
      this.post.run(project, this.traced()!)
      this.postDirty = false
      this.displayDirty = true
    }
    if (this.displayDirty) {
      this.draw()
      this.displayDirty = false
    }
    this.updateStats()
    return this.draft || (!this.paused && this.tracer.samples < r.maxSamples)
  }

  private updateStats(): void {
    const project = this.project!
    const errors: Record<string, string> = {}
    for (const [k, v] of this.material.errors) errors[k] = v
    for (const [k, v] of this.post.errors) errors[k] = v
    for (const [k, v] of this.shaderErrors) errors[k] = v
    this.stats = {
      ...this.stats,
      samples: this.tracer.samples,
      maxSamples: project.render.maxSamples,
      samplesPerSec: this.sampleTimes.length,
      draft: this.draft,
      heightMin: this.material.heightStats.min / this.ss,
      heightMax: this.material.heightStats.max / this.ss,
      errors,
    }
    this.onStats?.(this.stats)
  }

  private textureFor(channel: ChannelView): THREE.Texture | null {
    switch (channel) {
      case 'final':
        return this.post.output
      case 'diffuse':
      case 'opacity':
        return this.material.albedo
      case 'height':
      case 'normal':
        return this.material.normalTex
      case 'roughness':
        return this.material.surface
      case 'emissive':
      case 'specular':
        return this.material.emissive
      case 'ao':
        return this.tracer.aoTexture
      case 'masks':
        return this.material.maskTexture(this.view.mask)
    }
  }

  private draw(): void {
    const project = this.project!
    const tex = this.textureFor(this.view.channel)
    this.gpu.clearCanvas(0.09, 0.098, 0.11, 1)
    if (!tex) return
    const hs = this.material.heightStats
    this.display.draw(
      tex,
      this.view.channel,
      [project.width, project.height],
      this.canvasSize,
      this.view.transform,
      this.view.options,
      [hs.min, hs.max > hs.min ? hs.max : hs.min + 1],
      this.view.channel === 'final' ? 1 : this.ss,
    )
  }

  // ------------------------------------------------------------------ synchronous rendering (export, harness)

  /** Render the current project to completion (or `samples`) synchronously and run post. */
  renderNow(samples?: number): void {
    if (!this.project) throw new Error('No project')
    // Deterministic: full quality (no draft) from the first sample, whatever the interactive loop accumulated meanwhile
    // — otherwise the same project could score differently depending on timing.
    this.prepare()
    // Wait for the GPU before and after tracing. With several pages rendering at once (parallel harness workers on
    // ANGLE / D3D11), renders of one project otherwise differed in the last bits from run to run — enough to send
    // identical optimiser runs apart; with these two sync points they match exactly.
    const gl = this.gpu.renderer.getContext()
    gl.finish()
    this.tracer.reset()
    const target = samples ?? this.project.render.maxSamples
    while (this.tracer.samples < target) {
      this.tracer.trace(Math.min(16, target - this.tracer.samples), target)
    }
    gl.finish()
    this.post.run(this.project, this.traced()!)
    this.postDirty = false
    this.displayDirty = true
    this.kick()
  }

  /** The traced image at the texture size: the tracer output, box-filtered down when supersampling. */
  private traced(): THREE.Texture | null {
    const src = this.tracer.output
    if (!src || this.ss <= 1) return src
    const p = this.project!
    if (!this.down || this.down.width !== p.width || this.down.height !== p.height) {
      this.down?.dispose()
      this.down = this.gpu.target(p.width, p.height)
    }
    this.downMat ??= this.gpu.material(DOWNSAMPLE, { tSrc: { value: null }, uK: { value: 1 } })
    this.downMat.uniforms.tSrc.value = src
    this.downMat.uniforms.uK.value = this.ss
    this.gpu.run(this.downMat, this.down)
    return this.down.texture
  }

  /**
   * The colour the viewport shows at texel (x, y), sRGB 0..1: the albedo in the Diffuse view, the final image in every
   * other. Null outside the texture or before the first frame.
   */
  pickColour(x: number, y: number): [number, number, number] | null {
    let v: Float32Array | null
    if (this.view.channel === 'diffuse') {
      const k = this.ss
      v = this.material.probe(x * k + (k >> 1), y * k + (k >> 1))?.albedo ?? null
    } else v = this.post.probe(x, y)
    return v && [linearToSrgb1(clamp01(v[0])), linearToSrgb1(clamp01(v[1])), linearToSrgb1(clamp01(v[2]))]
  }

  /** Read the final post-processed image (linear, display-referred), rows top-to-bottom. */
  readFinal(): ImageData32 {
    const p = this.project!
    const data = this.gpu.readTexture(this.post.output!, p.width, p.height)
    return { width: p.width, height: p.height, data: flipRows(data, p.width, p.height) }
  }

  /** Read the raw HDR path-traced image before post, rows top-to-bottom. */
  readRender(): ImageData32 {
    const p = this.project!
    const data = this.gpu.readTexture(this.traced()!, p.width, p.height)
    return { width: p.width, height: p.height, data: flipRows(data, p.width, p.height) }
  }

  /** Read the ambient-occlusion map (R = AO, 1 = open). */
  readAO(): ImageData32 {
    const p = this.inner ?? this.project!
    this.prepare()
    const data = this.gpu.readTexture(this.tracer.aoTexture!, p.width, p.height)
    return this.toTextureSize({ width: p.width, height: p.height, data: flipRows(data, p.width, p.height) })
  }

  /** Supersampling factor of the current project (material maps are this many texels per texture pixel). */
  get supersample(): number {
    return this.ss
  }

  /** Box-filter a k× map readback to the texture size. */
  private toTextureSize(img: ImageData32): ImageData32 {
    const k = this.ss
    if (k <= 1) return img
    const w = Math.floor(img.width / k)
    const h = Math.floor(img.height / k)
    const out = new Float32Array(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          let s = 0
          for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += img.data[((y * k + j) * img.width + x * k + i) * 4 + c]
          out[(y * w + x) * 4 + c] = s / (k * k)
        }
    return { width: w, height: h, data: out }
  }

  /** Read a material map: 0 albedo, 1 surface (h, rough, metal, sdf), 2 emissive, 3 normal (xyz, h px). */
  readMap(index: 0 | 1 | 2 | 3): ImageData32 {
    const p = this.inner ?? this.project!
    this.prepare()
    const data = index === 3 ? this.material.readNormal() : this.material.readState(index)
    return this.toTextureSize({ width: p.width, height: p.height, data: flipRows(data, p.width, p.height) })
  }

  dispose(): void {
    this.offImages()
    this.stop()
    this.material.dispose()
    this.tracer.dispose()
    this.down?.dispose()
    this.downMat?.dispose()
    this.post.dispose()
    this.display.dispose()
    this.gpu.dispose()
  }
}

export function flipRows(data: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(data.length)
  const row = width * 4
  for (let y = 0; y < height; y++) {
    out.set(data.subarray((height - 1 - y) * row, (height - y) * row), y * row)
  }
  return out
}
