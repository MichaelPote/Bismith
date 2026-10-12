import type { GroupDef, ParamDef, ParamValue, ParamValues } from '@/core/params'
import type { Layer } from '@/core/project'
import type { FilterContext } from '@/render/materialPipeline'

export type LayerCategory = 'noise' | 'shape' | 'pattern' | 'filter' | 'adjust'

export interface LayerDef {
  type: string
  label: string
  category: LayerCategory
  kind: 'generator' | 'filter'
  description?: string
  /** Type-specific params (group defaults to 'params'). */
  params: ParamDef[]
  /**
   * Generators: GLSL defining `GenOut gen(vec2 p)` where p is the GL pixel position (centres at .5).
   * In scope: the common/noise/sdf GLSL chunks, `uSeed` (layer seed), `uRes`, `uTile`, the previous state
   * samplers `tAlbedo`, `tSurface`, `tEmissive`, and a `u_<key>` uniform per param.
   * Construct results with `genOut(value, mask, rnd, sdf)`.
   */
  glsl?: string
  /**
   * Generator produces a signed distance (px, negative inside) in GenOut.sdf. The wrapper then adds the
   * shape params (SDF operator, bevel, profile, anti-alias) and derives mask + value from the distance.
   * A gen() may return sdf <= NO_SDF (-9e4) to opt out per-pixel (value/mask pass through, register untouched).
   */
  sdf?: boolean
  /**
   * Filters: a single MRT pass. GLSL defining `void applyFilter(inout vec4 A, inout vec4 S, inout vec4 E, ivec2 ip)`
   * (note: `filter` is a reserved word in GLSL ES 3.00).
   */
  filterGlsl?: string
  /** Filters: full control, may issue several passes. Takes precedence over filterGlsl. */
  run?: (ctx: FilterContext, layer: Layer) => void
  /**
   * Generators: data computed on the CPU from the params — global, sequential algorithms a pixel shader can't run (e.g.
   * routing). Returns RGBA8 textures by name, bound as `uniform sampler2D t_<name>` (declare the names in `textures`).
   * Recomputed only when the params, size, tiling or seed change.
   */
  cpuData?: (params: ParamValues, ctx: { width: number; height: number; tileable: boolean; seed: number }) => Record<string, CpuTexture>
  textures?: string[]
  /** Overrides for common param defaults (e.g. which channel outputs start enabled). */
  defaults?: Record<string, ParamValue>
  /** Extra groups for this type's params, in display order (the default 'params' group is implicit). */
  groups?: GroupDef[]
  /**
   * Filters: which of the outliner's Diffuse and Height columns the filter affects — a bool param key when a tick turns
   * it on and off, `true` when it always does. Generators use their Diffuse / Height outputs (dif_on / h_on).
   */
  channels?: LayerChannels
}

export interface LayerChannels {
  diffuse?: string | true
  height?: string | true
}

/** An RGBA8 texture computed on the CPU (LayerDef.cpuData). */
export interface CpuTexture {
  width: number
  height: number
  data: Uint8Array
}
