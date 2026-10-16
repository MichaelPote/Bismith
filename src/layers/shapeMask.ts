// What the Shape Mask (the shape register) holds when a layer runs: the earlier layers that wrote it, named for the
// Mask › Shape mask › Clip to options ("Inside Bricks", "Outside Panel − Vent").

import { hiddenByMaterial, type Layer, type Project } from '@/core/project'
import { getLayerDef } from './registry'

/** One writer of the shape mask and how it combined with what was there (its Mode). */
export interface ShapeMaskWriter {
  name: string
  op: string
}

const OP_SYMBOL: Record<string, string> = {
  union: '+',
  subtract: '−',
  intersect: '∩',
  'smooth-union': '+',
  'smooth-subtract': '−',
  'smooth-intersect': '∩',
}

/** A visible shape layer with Use shape mask ticked (and, where it has one, its shape output on). */
function writes(layer: Layer, hidden: Set<string>): boolean {
  const def = getLayerDef(layer.type)
  if (!def || def.kind !== 'generator' || !def.sdf) return false
  if (!layer.enabled || hidden.has(layer.id) || layer.params.sm_on === false) return false
  if (def.writesMask) return def.writesMask(layer.params)
  return !def.sdfShowIf || def.sdfShowIf(layer.params)
}

/**
 * The writers the shape mask holds when `layerId` runs, in evaluation order: back to the last one in Normal mode (which
 * replaced everything before it). Empty: nothing has written the shape mask yet.
 */
export function shapeMaskChain(p: Project, layerId: string): ShapeMaskWriter[] {
  const hidden = hiddenByMaterial(p)
  const chain: ShapeMaskWriter[] = []
  for (let j = p.layers.findIndex((l) => l.id === layerId) - 1; j >= 0; j--) {
    const l = p.layers[j]
    if (!writes(l, hidden)) continue
    const op = String(l.params.sdf_op ?? 'replace')
    chain.unshift({ name: l.name, op })
    if (op === 'replace') break
  }
  return chain
}

/** The chain as a short expression, "Panel − Vent" (the last three writers at most). */
export function shapeMaskLabel(chain: ShapeMaskWriter[]): string {
  const terms = chain.map((w, k) => (k === 0 ? w.name : `${OP_SYMBOL[w.op] ?? '+'} ${w.name}`))
  return terms.length > 3 ? `… ${terms.slice(-3).join(' ')}` : terms.join(' ')
}
