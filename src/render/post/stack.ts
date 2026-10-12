// Stage 4 (docs/architecture.md §8): run the user-ordered post filters over the linear HDR render.

import * as THREE from 'three'
import type { Project } from '@/core/project'
import { Gpu, PingPong, type Uniforms } from '@/gpu/context'
import { createUniforms, declareUniforms, updateUniforms } from '@/gpu/uniforms'
import { GLSL_COMMON } from '@/layers/glsl/common'
import { getPostDef } from './registry'
import type { PostContext } from './types'

export class PostStack {
  private gpu: Gpu
  private pp: PingPong | null = null
  private materials = new Map<string, THREE.RawShaderMaterial>()
  private scratchTargets = new Map<string, THREE.WebGLRenderTarget>()
  private copyMat: THREE.RawShaderMaterial
  private width = 0
  private height = 0
  output: THREE.Texture | null = null
  errors = new Map<string, string>()

  constructor(gpu: Gpu) {
    this.gpu = gpu
    this.copyMat = gpu.material(
      GLSL_COMMON +
        `uniform sampler2D tInput; out vec4 oColor; void main() { oColor = texelFetch(tInput, ivec2(gl_FragCoord.xy), 0); }`,
      { uRes: { value: new THREE.Vector2() }, uTile: { value: true }, tInput: { value: null } },
    )
  }

  private ensure(w: number, h: number): void {
    if (this.pp && this.width === w && this.height === h) return
    this.pp?.dispose()
    for (const t of this.scratchTargets.values()) t.dispose()
    this.scratchTargets.clear()
    this.pp = new PingPong(this.gpu, w, h)
    this.width = w
    this.height = h
  }

  /** Run all enabled filters over `input`; the result is left in `this.output`. */
  run(project: Project, input: THREE.Texture): THREE.Texture {
    this.ensure(project.width, project.height)
    const pp = this.pp!
    this.errors.clear()
    // Start from a copy so filters never write into the tracer's accumulation buffer.
    this.copyMat.uniforms.tInput.value = input
    this.gpu.run(this.copyMat, pp.write)
    pp.swap()

    for (const filter of project.post) {
      if (!filter.enabled) continue
      const def = getPostDef(filter.type)
      if (!def) continue
      // oxlint-disable-next-line no-this-alias -- the context object reads pipeline state
      const self = this
      const ctx: PostContext = {
        gpu: this.gpu,
        project,
        filter,
        width: this.width,
        height: this.height,
        material(key, body, extra?: Uniforms) {
          const k = `${def.type}:${key}`
          let mat = self.materials.get(k)
          if (!mat) {
            mat = self.gpu.material(
              GLSL_COMMON + declareUniforms(def.params) + 'uniform sampler2D tInput;\nout vec4 oColor;\n' + body,
              { uRes: { value: new THREE.Vector2() }, uTile: { value: true }, tInput: { value: null }, ...createUniforms(def.params), ...(extra ?? {}) },
            )
            self.materials.set(k, mat)
          }
          updateUniforms(mat.uniforms, def.params, filter.params)
          return mat
        },
        run(mat, target, inputTex) {
          const u = mat.uniforms
          if (u.uRes) (u.uRes.value as THREE.Vector2).set(target.width, target.height)
          if (u.uTile) u.uTile.value = project.tileable
          if (inputTex !== undefined && u.tInput) u.tInput.value = inputTex
          self.gpu.run(mat, target)
        },
        scratch(name, w, h, linear) {
          const width = w ?? self.width
          const height = h ?? self.height
          const k = `${def.type}:${name}:${width}x${height}:${linear ? 'l' : 'n'}`
          let t = self.scratchTargets.get(k)
          if (!t) {
            t = self.gpu.target(width, height, { linear })
            self.scratchTargets.set(k, t)
          }
          return t
        },
      }
      try {
        if (def.run) {
          def.run(ctx, pp.read.texture, pp.write)
        } else if (def.glsl) {
          const mat = ctx.material('main', def.glsl + `\nvoid main() { oColor = post(ivec2(gl_FragCoord.xy)); }\n`)
          ctx.run(mat, pp.write, pp.read.texture)
        }
        pp.swap()
      } catch (e) {
        this.errors.set(filter.id, e instanceof Error ? e.message : String(e))
      }
    }
    this.output = pp.read.texture
    return this.output
  }

  dispose(): void {
    this.pp?.dispose()
    for (const m of this.materials.values()) m.dispose()
    for (const t of this.scratchTargets.values()) t.dispose()
    this.copyMat.dispose()
  }
}
