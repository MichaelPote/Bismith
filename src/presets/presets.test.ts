import { describe, expect, it } from 'vitest'
import { PRESETS } from './index'
import { layerParamDefs, getLayerDef } from '@/layers/registry'
import { getPostDef } from '@/render/post/registry'
import { LIGHT_DEFS } from '@/core/lights'
import { isPreview, normalizeProject } from '@/core/serialize'

describe('presets', () => {
  for (const preset of PRESETS) {
    it(`${preset.id} only uses known types and params`, () => {
      const p = preset.build()
      for (const l of p.layers) {
        expect(getLayerDef(l.type), `layer type ${l.type}`).toBeTruthy()
        const keys = new Set(layerParamDefs(l.type).map((d) => d.key))
        for (const k of Object.keys(l.params)) expect(keys.has(k), `${preset.id}/${l.name}: unknown param "${k}"`).toBe(true)
      }
      for (const f of p.post) {
        const def = getPostDef(f.type)
        expect(def, `post type ${f.type}`).toBeTruthy()
        const keys = new Set(def!.params.map((d) => d.key))
        for (const k of Object.keys(f.params)) expect(keys.has(k), `${preset.id}/${f.type}: unknown param "${k}"`).toBe(true)
      }
      for (const l of p.lighting.lights) {
        const keys = new Set(LIGHT_DEFS[l.type].params.map((d) => d.key))
        for (const k of Object.keys(l.params)) expect(keys.has(k), `${preset.id}/${l.name}: unknown light param "${k}"`).toBe(true)
      }
      // Survives normalisation unchanged in shape.
      const n = normalizeProject(JSON.parse(JSON.stringify(p)))
      expect(n.layers.map((l) => l.type)).toEqual(p.layers.map((l) => l.type))
      expect(n.post.map((f) => f.type)).toEqual(p.post.map((f) => f.type))
    })

    it(`${preset.id} carries a preview for the new-project wizard (npx tsx tools/previews.ts)`, () => {
      expect(isPreview(preset.build().preview)).toBe(true)
    })
  }
})
