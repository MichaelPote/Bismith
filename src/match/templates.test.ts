import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import { layerParamDefs } from '@/layers/registry'
import { stackOrder } from '@/core/project'
import { TEMPLATES, availableTemplates } from './templates'
import { conformProject } from './heuristics'
import { extractParams } from './optimizer'
import type { Analysis } from './analyze'

const analysis: Analysis = {
  width: 64, height: 64, tileable: true, tileX: true, tileY: true,
  palette: ['#201810', '#403020', '#605040', '#807060', '#a09080'], weights: [0.2, 0.2, 0.2, 0.2, 0.2], tones: ['#100c08', '#201810', '#302418', '#504030', '#706050', '#807060', '#908070', '#b0a090'],
  meanL: 0.4, stdL: 0.1, chroma: 0.03, edgeX: 0.02, edgeY: 0.03, glow: 0.02,
  periodX: 16, periodY: 8, periodXStrength: 0.8, periodYStrength: 0.8, phaseX: 0, phaseY: 0, hints: [],
}

describe('emulation templates', () => {
  ensureBuiltins()
  it('every template is available (all required layer types registered)', () => {
    expect(availableTemplates().map((t) => t.id)).toEqual(TEMPLATES.map((t) => t.id))
  })
  for (const t of TEMPLATES) {
    it(`${t.id} builds with known params only`, () => {
      const p = t.build(analysis, { palette: 'quake' })
      expect(p.width).toBe(64)
      for (const l of stackOrder(p)) {
        const keys = new Set(layerParamDefs(l.type).map((d) => d.key))
        for (const k of Object.keys(l.params)) expect(keys.has(k), `${t.id}/${l.name}: unknown param ${k}`).toBe(true)
      }
    })
    it(`${t.id} already follows the craft rules`, () => {
      for (const palette of ['quake', '']) {
        expect(conformProject(t.build(analysis, { palette })).changes, `${t.id} (${palette || 'no palette'})`).toEqual([])
      }
    })
  }

  it('keeps colour in the paint stack and relief in its own', () => {
    for (const t of TEMPLATES) {
      for (const l of t.build(analysis, { palette: 'quake' }).relief) {
        expect(l.params.dif_on === true, `${t.id}/${l.name}: relief layer paints`).toBe(false)
      }
    }
  })

  it('ties the copies of one pattern across the stacks', () => {
    const p = TEMPLATES.find((t) => t.id === 'bricks')!.build(analysis, { palette: 'quake' })
    const space = extractParams(p, { enums: true })
    const columns = space.entries.filter((e) => e.key === 'columns')
    // Pillow, Edges, Block heights (relief) and Stone colour (paint): one entry.
    expect(columns).toHaveLength(1)
    expect(columns[0].tied).toHaveLength(3)
  })
})
