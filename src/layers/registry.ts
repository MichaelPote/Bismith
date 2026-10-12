import { defaultParams, sanitizeParams, type GroupDef, type ParamDef, type ParamValues } from '@/core/params'
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
    all = [...pattern, ...(def.sdf ? SDF_PARAMS : []), ...shaping, ...MASK_PARAMS, ...OUTPUT_PARAMS]
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
  const groups = base.filter((g) => g.id !== 'shape' || def.sdf)
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

export function createLayer(type: string, overrides: ParamValues = {}, name?: string): Layer {
  const def = defs.get(type)
  if (!def) throw new Error(`Unknown layer type: ${type}`)
  const params = { ...defaultParams(layerParamDefs(type)), ...overrides }
  return { id: newId('ly'), type, name: name ?? def.label, enabled: true, params }
}

/** Fill missing params with defaults, drop unknown ones, clamp values. */
export function sanitizeLayer(layer: Layer): Layer {
  const defsForType = layerParamDefs(layer.type)
  return { ...layer, params: sanitizeParams(defsForType, layer.params) }
}
