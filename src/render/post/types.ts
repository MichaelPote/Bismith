import type * as THREE from 'three'
import type { ParamDef, GroupDef } from '@/core/params'
import type { PostFilter, Project } from '@/core/project'
import type { Gpu, Uniforms } from '@/gpu/context'

export interface PostContext {
  gpu: Gpu
  project: Project
  filter: PostFilter
  width: number
  height: number
  /**
   * A single-output material. `body` is appended after GLSL_COMMON, the filter's u_<param> uniforms and
   * `uniform sampler2D tInput; out vec4 oColor;` — it must define main(). Cached per filter type + key.
   * Param uniforms are refreshed from the filter's params on every call.
   */
  material(key: string, body: string, extraUniforms?: Uniforms): THREE.RawShaderMaterial
  /** Run a pass. Sets uRes (to the target size) and uTile; `input` is bound to tInput when given. */
  run(mat: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget, input?: THREE.Texture | null): void
  /** A float RGBA scratch target, cached by name and size. Linear filtering when `linear`. */
  scratch(name: string, width?: number, height?: number, linear?: boolean): THREE.WebGLRenderTarget
}

export interface PostDef {
  type: string
  label: string
  description?: string
  params: ParamDef[]
  groups?: GroupDef[]
  /** Single pass: GLSL defining `vec4 post(ivec2 ip)` (read tInput yourself). */
  glsl?: string
  /** Full control (multi-pass). Must write the final result into `output`. */
  run?: (ctx: PostContext, input: THREE.Texture, output: THREE.WebGLRenderTarget) => void
}
