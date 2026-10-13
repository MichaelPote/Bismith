import { defaultParams, sanitizeParams, type GroupDef, type ParamDef, type ParamValue, type ParamValues } from '@/core/params'
import type { Layer } from '@/core/project'
import { newId } from '@/core/ids'
import type { LayerCategory, LayerChannels, LayerDef } from './types'
import {
  FILTER_GROUPS,
  GENERATOR_GROUPS,
  MASK_PARAMS,
  MASK_USE_PARAMS,
  OUTPUT_PARAMS,
  PHASE_PARAM,
  SDF_MASK_PARAMS,
  SDF_PARAMS,
  SHAPING_PARAMS,
  WARP_PHASE_PARAM,
} from './commonParams'

const defs = new Map<string, LayerDef>()
const fullParams = new Map<string, ParamDef[]>()

export const CATEGORY_LABELS: Record<LayerCategory, string> = {
  noise: 'Noise',
  shape: 'Shapes',
  pattern: 'Patterns',
  filter: 'Filters',
  adjust: 'Adjust',
}

export function registerLayer(def: LayerDef): void {
  defs.set(def.type, def)
  const own = def.params.map((p) => ({ ...p, group: p.group ?? 'params' }))
  let all: ParamDef[]
  if (def.kind === 'generator') {
    // Every generator has a `phase` (the wrapper sets the noise library's gPhase from it): its own, the noise one in
    // the Pattern card (before the seed), or the domain-warp one in Shaping.
    const hasPhase = own.some((p) => p.key === 'phase')
    const seedAt = own.findIndex((p) => p.key === 'seed')
    const pattern = hasPhase || !def.noise ? own : seedAt < 0 ? [...own, PHASE_PARAM] : [...own.slice(0, seedAt), PHASE_PARAM, ...own.slice(seedAt)]
    const shaping = hasPhase || def.noise ? SHAPING_PARAMS : [...SHAPING_PARAMS, WARP_PHASE_PARAM]
    let shape = def.sdf === 'mask' ? SDF_MASK_PARAMS : def.sdf ? SDF_PARAMS : []
    const when = def.sdfShowIf
    if (when) shape = shape.map((p) => ({ ...p, showIf: (v: ParamValues) => when(v) && (!p.showIf || p.showIf(v)) }))
    all = [...pattern, ...shape, ...shaping, ...MASK_PARAMS, ...OUTPUT_PARAMS]
  } else {
    // Filters: their own params, then the named-mask clip (FR8.13).
    all = [...own, ...MASK_USE_PARAMS]
  }
  if (def.defaults) {
    all = all.map((p) => (p.key in def.defaults! ? { ...p, default: def.defaults![p.key] } : p))
  }
  fullParams.set(def.type, all)
}

export function getLayerDef(type: string): LayerDef | undefined {
  return defs.get(type)
}

export function allLayerDefs(): LayerDef[] {
  return [...defs.values()]
}

/** Type params followed by the common generator params, with per-type default overrides applied. */
export function layerParamDefs(type: string): ParamDef[] {
  return fullParams.get(type) ?? []
}

export function layerGroups(def: LayerDef): GroupDef[] {
  const base = def.kind === 'generator' ? GENERATOR_GROUPS : FILTER_GROUPS
  const groups = base.filter((g) => (g.id === 'shapemask' ? Boolean(def.sdf) : g.id === 'shape' ? def.sdf === true : true))
  const extra = def.groups ?? []
  // Type-specific groups go right after the main params group.
  return [groups[0], ...extra, ...groups.slice(1)]
}

const GENERATOR_CHANNELS: LayerChannels = { diffuse: 'dif_on', height: 'h_on' }

/** Which of the Diffuse / Height columns a layer type affects, and the tick that switches each (see LayerDef.channels). */
export function layerChannels(type: string): LayerChannels {
  const def = defs.get(type)
  if (!def) return {}
  return def.kind === 'generator' ? GENERATOR_CHANNELS : (def.channels ?? {})
}

/**
 * Params from before the Shape Mask toggle: "Ignore register" was an operator (sdf_op 'none'); it is now the
 * unticked Shape Mask (sm_on false) with the mode left at Normal.
 */
export function migrateParams(params: ParamValues, type?: string): ParamValues {
  const p = params.sdf_op === 'none' ? { ...params, sdf_op: 'replace', sm_on: false } : params
  const def = type ? defs.get(type) : undefined
  return def?.migrate ? def.migrate(p) : p
}

export function createLayer(type: string, overrides: ParamValues = {}, name?: string): Layer {
  const def = defs.get(type)
  if (!def) throw new Error(`Unknown layer type: ${type}`)
  const params = { ...defaultParams(layerParamDefs(type)), ...migrateParams(overrides, type) }
  if (def.linkedDefaults) for (const [k, v] of Object.entries(def.linkedDefaults(params))) if (!(k in overrides)) params[k] = v
  return { id: newId('ly'), type, name: name ?? def.label, enabled: true, params }
}

/**
 * The params to write when `key` changes to `value`: it, and the type's linked defaults (LayerDef.linkedDefaults)
 * that were still at their default and now have another.
 */
export function linkedChanges(type: string, params: ParamValues, key: string, value: ParamValue): ParamValues {
  const changes: ParamValues = { [key]: value }
  const link = defs.get(type)?.linkedDefaults
  if (!link) return changes
  const before = link(params)
  const after = link({ ...params, [key]: value })
  for (const [k, v] of Object.entries(after)) if (k !== key && params[k] === before[k] && v !== before[k]) changes[k] = v
  return changes
}

/** Fill missing params with defaults, drop unknown ones, clamp values. */
export function sanitizeLayer(layer: Layer): Layer {
  const defsForType = layerParamDefs(layer.type)
  return { ...layer, params: sanitizeParams(defsForType, migrateParams(layer.params, layer.type)) }
}
