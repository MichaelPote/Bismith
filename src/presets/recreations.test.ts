// The hand-authored recreations (docs/features/fr7.4-hand-authoring.md) must load without losing anything:
// every layer type registered and every param key known to its type (normalisation would silently drop either).
// They live in an optional, untracked private/recreations/ folder; without it the suite is skipped.

import { describe, expect, it } from 'vitest'
import { normalizeProject } from '@/core/serialize'
import { ensureBuiltins } from '@/render/builtins'
import { getLayerDef, layerParamDefs } from '@/layers/registry'

interface RawLayer {
  type: string
  name: string
  params?: Record<string, unknown>
}

const projects = import.meta.glob('../../private/recreations/**/*.json', { eager: true, import: 'default' }) as Record<
  string,
  { relief?: RawLayer[]; layers: RawLayer[] }
>
const entries = Object.entries(projects).map(([path, p]) => [path.split('/').pop()!, p] as const)

describe.skipIf(entries.length === 0)('recreations', () => {
  ensureBuiltins()

  it.each(entries)('%s loads with every layer and param intact', (file, raw) => {
    const all = [...(raw.relief ?? []), ...raw.layers]
    expect(all.filter((l) => !getLayerDef(l.type)).map((l) => l.type)).toEqual([])
    for (const l of all) {
      const keys = new Set(layerParamDefs(l.type).map((d) => d.key))
      expect(Object.keys(l.params ?? {}).filter((k) => !keys.has(k)), `${file} · ${l.name} (${l.type})`).toEqual([])
    }
    const p = normalizeProject(raw)
    expect(p.layers.length).toBe(raw.layers.length)
    expect(p.relief.length).toBe(raw.relief?.length ?? 0)
    expect(p.render.shadows).toBe(false)
  })
})
