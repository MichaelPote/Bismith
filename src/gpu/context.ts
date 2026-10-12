// Thin WebGL2 plumbing over Three.js: one renderer, one full-screen triangle, float render targets,
// shader materials composed from GLSL chunks, and float readback.

import * as THREE from 'three'
import { FULLSCREEN_VERT, GLSL_HEADER } from '@/layers/glsl/common'

export type Uniforms = Record<string, THREE.IUniform>

export interface TargetOptions {
  count?: number
  type?: THREE.TextureDataType
  linear?: boolean
}

export class GpuError extends Error {}

export class Gpu {
  readonly renderer: THREE.WebGLRenderer
  readonly canvas: HTMLCanvasElement
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly mesh: THREE.Mesh
  private readonly copyMat: THREE.RawShaderMaterial
  private readTarget: THREE.WebGLRenderTarget | null = null
  /** The browser compiles shaders off the main thread (KHR_parallel_shader_compile): compile() doesn't stall. */
  readonly parallelCompile: boolean

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      })
    } catch {
      throw new GpuError('WebGL2 is not available in this browser.')
    }
    const gl = renderer.getContext() as WebGL2RenderingContext
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new GpuError('This GPU/browser cannot render to float textures (EXT_color_buffer_float).')
    }
    renderer.autoClear = false
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.renderer = renderer
    this.parallelCompile = renderer.extensions.has('KHR_parallel_shader_compile')

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    this.mesh = new THREE.Mesh(geo)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)

    this.copyMat = this.material(
      /* glsl */ `
      uniform sampler2D tSrc;
      out vec4 oColor;
      void main() { oColor = texelFetch(tSrc, ivec2(gl_FragCoord.xy), 0); }
    `,
      { tSrc: { value: null } },
    )
  }

  get gl(): WebGL2RenderingContext {
    return this.renderer.getContext() as WebGL2RenderingContext
  }

  /** A full-screen pass material. `frag` should not include the version/precision header. */
  material(frag: string, uniforms: Uniforms, defines: Record<string, string | number> = {}): THREE.RawShaderMaterial {
    const defs = Object.entries(defines)
      .map(([k, v]) => `#define ${k} ${v}\n`)
      .join('')
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: GLSL_HEADER + FULLSCREEN_VERT,
      fragmentShader: GLSL_HEADER + defs + frag,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
  }

  /**
   * Compile pass materials' programs ahead of their first run. Where the browser has KHR_parallel_shader_compile the
   * compile happens off the main thread and this resolves when it is done; elsewhere it resolves at once and the first
   * run pays for the compile.
   */
  async compile(materials: THREE.Material[]): Promise<void> {
    const group = new THREE.Group()
    for (const m of materials) group.add(new THREE.Mesh(this.mesh.geometry, m))
    await this.renderer.compileAsync(group, this.camera, this.scene)
  }

  target(width: number, height: number, opts: TargetOptions = {}): THREE.WebGLRenderTarget {
    const filter = opts.linear ? THREE.LinearFilter : THREE.NearestFilter
    const t = new THREE.WebGLRenderTarget(width, height, {
      count: opts.count ?? 1,
      type: opts.type ?? THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: filter,
      magFilter: filter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    })
    for (const tex of t.textures) tex.colorSpace = THREE.NoColorSpace
    return t
  }

  /** Run a full-screen pass into `target` (null = canvas). Optionally restrict to a viewport (px). */
  run(
    material: THREE.Material,
    target: THREE.WebGLRenderTarget | null,
    viewport?: { x: number; y: number; w: number; h: number },
  ): void {
    this.mesh.material = material
    const r = this.renderer
    r.setRenderTarget(target)
    if (viewport) {
      if (target) {
        target.viewport.set(viewport.x, viewport.y, viewport.w, viewport.h)
      } else {
        const pr = r.getPixelRatio()
        r.setViewport(viewport.x / pr, viewport.y / pr, viewport.w / pr, viewport.h / pr)
      }
    } else if (target) {
      target.viewport.set(0, 0, target.width, target.height)
    } else {
      const s = r.getSize(new THREE.Vector2())
      r.setViewport(0, 0, s.x, s.y)
    }
    r.render(this.scene, this.camera)
  }

  clearCanvas(r = 0, g = 0, b = 0, a = 0): void {
    this.renderer.setRenderTarget(null)
    this.renderer.setClearColor(new THREE.Color(r, g, b), a)
    this.renderer.clear(true, false, false)
  }

  /** Read any texture back as RGBA float (rows bottom-up, GL order). */
  readTexture(texture: THREE.Texture, width: number, height: number): Float32Array {
    if (!this.readTarget || this.readTarget.width !== width || this.readTarget.height !== height) {
      this.readTarget?.dispose()
      this.readTarget = this.target(width, height)
    }
    this.copyMat.uniforms.tSrc.value = texture
    this.run(this.copyMat, this.readTarget)
    const out = new Float32Array(width * height * 4)
    this.renderer.readRenderTargetPixels(this.readTarget, 0, 0, width, height, out)
    return out
  }

  dispose(): void {
    this.readTarget?.dispose()
    this.copyMat.dispose()
    this.mesh.geometry.dispose()
    this.renderer.dispose()
  }
}

/** A pair of identical targets for ping-pong passes. */
export class PingPong {
  read: THREE.WebGLRenderTarget
  write: THREE.WebGLRenderTarget

  constructor(gpu: Gpu, width: number, height: number, opts: TargetOptions = {}) {
    this.read = gpu.target(width, height, opts)
    this.write = gpu.target(width, height, opts)
  }

  swap(): void {
    const t = this.read
    this.read = this.write
    this.write = t
  }

  get width(): number {
    return this.read.width
  }

  get height(): number {
    return this.read.height
  }

  dispose(): void {
    this.read.dispose()
    this.write.dispose()
  }
}
