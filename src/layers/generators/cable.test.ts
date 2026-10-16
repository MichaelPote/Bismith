// Cable (FR7.5): the CPU side — editor defaults sized to the texture, plain defaults, stored layers loading, param
// ranges.

import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import { createLayer, freshParams, layerParamDefs, sanitizeLayer } from '../registry'
import { cableLayer } from './cable'

describe('cable', () => {
  ensureBuiltins()

  it('sizes a new layer’s rope to the texture', () => {
    const big = freshParams('cable', { width: 512, height: 512 })
    expect(big).toMatchObject({ thickness: 9, radius: 10.4, count: 5 })
    // Strands just touch round a core, with yarns about 6 px wide.
    expect(Number(big.radius) / Number(big.thickness)).toBeCloseTo(1.15, 1)
    expect(big.yarns).toBe(9)
    // Small textures keep a legible rope; a wide strip's rope follows its height and gets more turns.
    const small = freshParams('cable', { width: 32, height: 32 })
    expect(small.thickness).toBe(2.5)
    expect(Number(small.yarns)).toBeGreaterThanOrEqual(3)
    const strip = freshParams('cable', { width: 1024, height: 64 })
    expect(strip.thickness).toBe(2.5)
    expect(Number(strip.count)).toBeGreaterThan(Number(big.count))
  })

  it('is a laid rope out of the box that writes the Shape Mask by Union', () => {
    const plain = createLayer('cable').params
    expect(plain).toMatchObject({ sm_on: true, sdf_op: 'union', strands: 3, sink: 0.35, core: 0.6, irregular: 0.5 })
    // The plain sizes are the editor's at 512 px.
    const fresh = freshParams('cable', { width: 512, height: 512 })
    for (const k of ['radius', 'thickness', 'count', 'yarns']) expect(plain[k], k).toBe(fresh[k])
    // A stored cable from before the newer params still loads, with them at their defaults.
    const old = sanitizeLayer({
      id: 'ly1',
      type: 'cable',
      name: 'Rope',
      enabled: true,
      params: { axis: 'horizontal', pos: 0.29, count: 4, radius: 7, lean: 9, thickness: 3, strands: 1, back: 0.45 },
    })
    expect(old.params).toMatchObject({ count: 4, radius: 7, lean: 9, thickness: 3, strands: 1, back: 0.45, angle: 0, sag: 0, start: 0, end: 1, rows: 1 })
  })

  it('uses every param it declares, with slider ranges inside the hard limits', () => {
    for (const d of cableLayer.params) {
      if (d.key !== 'seed') expect(cableLayer.glsl!.includes(`u_${d.key}`), `u_${d.key} unused`).toBe(true)
      if (d.softMin !== undefined) expect(d.softMin, d.key).toBeGreaterThanOrEqual(d.min!)
      if (d.softMax !== undefined) expect(d.softMax, d.key).toBeLessThanOrEqual(d.max!)
    }
    // Lengths scale with supersampling.
    for (const k of ['radius', 'thickness', 'lean', 'sag']) expect(layerParamDefs('cable').find((d) => d.key === k)?.unit, k).toBe('px')
    // esbuild reads `<< out` as a TypeScript variance modifier (AGENTS.md).
    expect(cableLayer.glsl).not.toMatch(/<<\s*out\b/)
  })
})
