import type { GroupDef, ParamDef, ParamValue, ParamValues } from '@/core/params'
import type { Layer } from '@/core/project'
import type { FilterContext } from '@/render/materialPipeline'
import type * as THREE from 'three'

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
   * Construct results with `genOut(value, mask, rnd, sdf)`, or `genOutHeight(…, height)` with a signed height profile
   * of the generator's own (see GENOUT in render/materialPipeline.ts).
   */
  glsl?: string
  /**
   * Generator produces a signed distance (px, negative inside) in GenOut.sdf. The wrapper then adds the
   * shape params (SDF operator, bevel, profile, anti-alias) and derives mask + value from the distance.
   * A gen() may return sdf <= NO_SDF (-9e4) to opt out per-pixel (value/mask pass through, the mask it writes keeps
   * what was there).
   * 'mask': the distance only goes to the mask the layer writes (Mask › Write to) — the generator shapes its own value
   * and coverage around it (Drips' blisters: a lifted lip outside the edge, a pit inside), so there is no Edge card.
   */
  sdf?: boolean | 'mask'
  /**
   * When the shape params apply (default: always) — e.g. only one of a generator's outputs has a shape. Called with a
   * `key` it decides that one Edge control (a value mode may keep Anti-alias but hide Bevel); without one, whether the
   * layer has a shape at all.
   */
  sdfShowIf?: (params: ParamValues, key?: string) => boolean
  /**
   * What the layer writes into its mask (Mask › Write to) with these params: its shape (a signed distance), its
   * coverage, or nothing (false). Default: SDF layers their shape wherever `sdfShowIf` gives them one (else nothing),
   * other generators their coverage — e.g. a relief output that has Edge controls but writes its shape only when told
   * which part to write (masks.ts).
   */
  maskWrite?: (params: ParamValues) => 'shape' | 'coverage' | false
  /**
   * Reads the mask before it in its own shader (`maskIn()`: its write target's, or the Shape mask when it writes none)
   * — Chips damages the shape there, Tabs sit on its outline, Glass refracts inside it. Other layers read masks only
   * through Limit to.
   */
  readsMask?: boolean
  /** The mask a layer reads as its source with these params (`maskSrc()`; edge filters, Mask area), or null. */
  maskSource?: (params: ParamValues) => string | null
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
  /**
   * Generators: GPU passes over the current state run just before the layer (e.g. a distance field of something in
   * the heights below). Returns textures by name, bound like cpuData's (declare the names in `textures`; any it leaves
   * out stay blank). Runs on every evaluation, so keep it to what the layer's params ask for.
   */
  prepare?: (ctx: FilterContext, layer: Layer) => Record<string, THREE.Texture>
  /**
   * Generators: the pattern comes from the noise library (glsl/noise.ts) or its cell points, so a Phase param in the
   * Pattern card animates it. Other generators get the Phase in Shaping, shown while a domain warp is on.
   */
  noise?: boolean
  /**
   * What a layer added in the editor starts with, over the defaults (sized to the texture). Code that builds layers —
   * recipes, templates, presets — and stored projects keep the plain defaults, so new looks can be offered without
   * changing old ones.
   */
  fresh?: (texture: { width: number; height: number }) => ParamValues
  /**
   * Defaults that follow other params (Drips: Height on for the Sources output). A new layer takes them unless given
   * them; changing a param moves any still at its old default to the new one (`linkedChanges`), so a value set by
   * hand stays.
   */
  linkedDefaults?: (params: ParamValues) => ParamValues
  /** Rewrites params stored before a change to this type's params (after the common migrations). */
  migrate?: (params: ParamValues) => ParamValues
  /** Overrides for common param defaults (e.g. which channel outputs start enabled). */
  defaults?: Record<string, ParamValue>
  /** This type's own hint, label or note on a common param (e.g. a note on Bevel when this type caps it). */
  paramPatch?: Record<string, Pick<ParamDef, 'hint' | 'labelFor' | 'note'>>
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
