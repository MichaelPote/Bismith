// Linked copies: layers of one type that share a seed are copies of one pattern doing different jobs — a relief
// Pillow / Edges / Block heights plus a paint layer colouring each stone, water stains and rust trails from the same
// sources. The editor keeps their pattern params in step (editing one edits the copies) and the optimiser ties them
// into one entry (optimizer.ts). "Pattern params" are the generator's own params (its Pattern group and any
// type-specific groups) plus placement and the whole-pattern domain warp.

import { stackOrder, type Layer, type Project } from './project'
import { getLayerDef, layerParamDefs } from '@/layers/registry'

/** Placement and whole-pattern warp: part of the pattern, though they live in the common Shaping group. */
export const PLACEMENT_KEYS = new Set(['ofs_x', 'ofs_y', 'dw_amount', 'dw_scale'])

const cache = new Map<string, Set<string>>()

/** Keys that place / shape the pattern itself for a layer type. */
export function patternKeys(type: string): Set<string> {
  let keys = cache.get(type)
  if (!keys) {
    const def = getLayerDef(type)
    const own = new Set(['params', ...(def?.groups ?? []).map((g) => g.id)])
    keys = new Set(layerParamDefs(type).filter((d) => own.has(d.group ?? 'params') || PLACEMENT_KEYS.has(d.key)).map((d) => d.key))
    cache.set(type, keys)
  }
  return keys
}

/** Generators with a seed can be linked (seedless shapes have no pattern identity). */
export const linkable = (l: Layer) => l.params.seed !== undefined && getLayerDef(l.type)?.kind === 'generator'

/** The other layers linked to `layer` (same type, same seed), in either stack. */
export function linkedCopies(p: Project, layer: Layer): Layer[] {
  if (!linkable(layer)) return []
  return stackOrder(p).filter((l) => l.id !== layer.id && l.type === layer.type && l.params.seed === layer.params.seed)
}

/**
 * Set a param on `layer` and, for a pattern param, on its linked copies that held the same value (copies that
 * already differ in it — a bevel, a trail width — keep their own). Returns the layers changed.
 */
export function setLinkedParam(p: Project, layer: Layer, key: string, value: Layer['params'][string]): Layer[] {
  const changed = [layer]
  if (patternKeys(layer.type).has(key)) {
    const before = JSON.stringify(layer.params[key])
    for (const c of linkedCopies(p, layer)) {
      if (JSON.stringify(c.params[key]) !== before) continue
      c.params[key] = structuredCloneValue(value)
      changed.push(c)
    }
  }
  layer.params[key] = value
  return changed
}

function structuredCloneValue<T>(v: T): T {
  return v !== null && typeof v === 'object' ? (JSON.parse(JSON.stringify(v)) as T) : v
}
