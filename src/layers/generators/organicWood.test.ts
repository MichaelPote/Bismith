// Wood and Scales (FR7.2a, FR8.17): the CPU side — editor defaults sized to the texture, the plain defaults, and params
// the shaders rely on.

import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import { createLayer, freshParams, getLayerDef, sanitizeLayer } from '../registry'
import { scalesLayer, woodLayer } from './organicWood'

describe('wood', () => {
  ensureBuiltins()

  it('leaves Joint variation off by default and uses it in the shader', () => {
    expect(woodLayer.params.find((d) => d.key === 'joint_var')!.default).toBe(0)
    expect(woodLayer.glsl!).toContain('u_joint_var')
  })

  it('keeps the plain px sizes up to 128 px and grows them with the texture', () => {
    const small = freshParams('wood', { width: 64, height: 64 })
    const def = getLayerDef('wood')!
    const plain = (k: string) => def.params.find((d) => d.key === k)!.default
    for (const k of ['gap', 'gap_y', 'grain_px', 'ring_px', 'knot_size', 'end_wobble_px', 'rings', 'fine']) expect(small[k], k).toBe(plain(k))
    expect(small.bevel).toBe(def.defaults!.bevel)
    const big = freshParams('wood', { width: 512, height: 512 })
    expect(big).toMatchObject({ gap: 2, gap_y: 2, bevel: 5, ring_px: 8, rings: 0.8, fine: 0.45 })
    expect(Number(big.knot_size)).toBeGreaterThan(8)
    expect(Number(big.grain_px)).toBeGreaterThan(Number(small.grain_px))
  })

  it('starts with the cathedral figure and the varied grain', () => {
    expect(createLayer('wood').params).toMatchObject({ cut: 'cathedral', ring_var: 0.5, ring_ramp: 0.6, grain_group: 0.6, board_var: 0.6, crown: 0.25, grain_soft: 0.4, grain_depth: 0.35, profile: 'smooth' })
  })

  it('reads one old gap for both directions', () => {
    expect(sanitizeLayer({ ...createLayer('wood'), params: { gap: 3 } }).params).toMatchObject({ gap: 3, gap_y: 3 })
  })

  it('allows several knots per board', () => {
    const knots = woodLayer.params.find((d) => d.key === 'knots')!
    expect(knots.max).toBe(4)
    expect(createLayer('wood', { knots: 2.5 }).params.knots).toBe(2.5)
  })

  it('uses every param it declares', () => {
    for (const layer of [woodLayer, scalesLayer]) {
      for (const d of layer.params) if (d.key !== 'seed') expect(layer.glsl!.includes(`u_${d.key}`), `${layer.type}: u_${d.key} unused`).toBe(true)
    }
  })
})

describe('scales', () => {
  ensureBuiltins()

  it('starts lapped, irregular and tilted, writing its outline to the shape mask', () => {
    const p = createLayer('scales').params
    expect(p).toMatchObject({ edges: 'lapped', sm_on: true, profile: 'smooth' })
    for (const k of ['jitter', 'wobble', 'size_var', 'tilt', 'lip', 'growth']) expect(Number(p[k]), k).toBeGreaterThan(0)
  })

  it('grows its outline, bevel and row curve with the texture', () => {
    const small = freshParams('scales', { width: 64, height: 64 })
    const big = freshParams('scales', { width: 512, height: 512 })
    expect(small).toMatchObject({ outline: 1, bevel: 2, dw_amount: 2.5 })
    expect(Number(big.outline)).toBeGreaterThan(1)
    expect(Number(big.bevel)).toBeGreaterThan(2)
    expect(Number(big.dw_amount)).toBeGreaterThan(2.5)
  })
})
