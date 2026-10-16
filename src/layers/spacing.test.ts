// Column / Row spacing (commonParams.spacingParams) on the generators that lay out a grid of separate objects, and
// Glyph's dot chance: the params, where they show, and that stored layers keep their layout.

import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import { createLayer, layerParamDefs } from './registry'

const GRIDS = ['glyph', 'rosette', 'rect', 'ellipse', 'polygon', 'line', 'curve', 'cross', 'vents', 'tabs']

describe('column / row spacing', () => {
  ensureBuiltins()

  it('gives every object grid both sliders, −1 … 1 of the texture, off by default', () => {
    for (const type of GRIDS) {
      const defs = layerParamDefs(type)
      for (const key of ['col_sp', 'row_sp']) {
        const d = defs.find((x) => x.key === key)
        expect(d, `${type}.${key}`).toMatchObject({ type: 'float', min: -1, max: 1, default: 0 })
      }
      expect(createLayer(type).params).toMatchObject({ col_sp: 0, row_sp: 0 })
    }
  })

  it('keeps them with the repeat settings on repeat grids', () => {
    for (const type of ['glyph', 'rosette', 'rect', 'cross']) {
      expect(layerParamDefs(type).find((d) => d.key === 'col_sp')?.group).toBe('repeat')
    }
  })

  it('shows them on a grid of tabs only (not scattered, not along edges)', () => {
    const show = layerParamDefs('tabs').find((d) => d.key === 'row_sp')!.showIf!
    const tabs = createLayer('tabs').params
    expect(show({ ...tabs, place: 'grid' })).toBe(true)
    expect(show({ ...tabs, place: 'scatter' })).toBe(false)
    expect(show({ ...tabs, place: 'border' })).toBe(false)
  })

  it('leaves plane-filling tilings and grids with their own steps alone', () => {
    for (const type of ['bricks', 'checker', 'treadplate', 'stamp', 'drips']) {
      expect(layerParamDefs(type).some((d) => d.key === 'col_sp'), type).toBe(false)
    }
  })
})

describe('glyph dot chance', () => {
  ensureBuiltins()

  it('puts a dot on every end by default, and shows with end dots only', () => {
    expect(createLayer('glyph').params.dot_chance).toBe(1)
    const d = layerParamDefs('glyph').find((x) => x.key === 'dot_chance')!
    expect(d).toMatchObject({ min: 0, max: 1 })
    const g = createLayer('glyph').params
    expect(d.showIf!({ ...g, dots: 0 })).toBe(false)
    expect(d.showIf!({ ...g, dots: 3 })).toBe(true)
    expect(d.showIf!({ ...g, dots: 3, style: 'blocks' })).toBe(false)
  })
})
