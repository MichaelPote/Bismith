// Marble and caustics: the plain defaults are the current look (ridged marble, rounded nested caustics), the editor's
// sized params stay in range, and caustics' height mode follows its mode.

import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import { createLayer, freshParams, layerParamDefs } from '../registry'

describe('marble / caustics params', () => {
  ensureBuiltins()

  it('defaults to the current look', () => {
    expect(createLayer('marble').params).toMatchObject({ style: 'ridges', stretch: 6, cull: 0.7, filter: true, fine_style: 'same', relief: 0.12, h_mode: 'subtract' })
    expect(createLayer('caustics').params).toMatchObject({ dome: 0.8, cell_h: 0.4, rim_round: 1, octave2_nest: 1, mk_target: '' })
    expect(layerParamDefs('marble').some((d) => d.key === 'look')).toBe(false)
  })

  it('keeps the editor’s fresh params known and within their ranges at any texture size', () => {
    for (const type of ['marble', 'caustics']) {
      const defs = new Map(layerParamDefs(type).map((d) => [d.key, d]))
      for (const width of [16, 64, 512, 2048]) {
        for (const [k, v] of Object.entries(freshParams(type, { width, height: width }))) {
          const d = defs.get(k)
          expect(d, `${type}.${k}`).toBeTruthy()
          if (typeof v === 'number') {
            expect(v, `${type}.${k} at ${width}`).toBeGreaterThanOrEqual(d!.min ?? -Infinity)
            expect(v, `${type}.${k} at ${width}`).toBeLessThanOrEqual(d!.max ?? Infinity)
          }
        }
      }
    }
  })

  it('raises caustics blobs and sinks the net unless a height mode is given', () => {
    expect(createLayer('caustics').params.h_mode).toBe('subtract')
    expect(createLayer('caustics', { mode: 'blobs' }).params.h_mode).toBe('add')
    expect(createLayer('caustics', { mode: 'blobs', h_mode: 'max' }).params.h_mode).toBe('max')
  })
})
