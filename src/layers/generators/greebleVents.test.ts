// Vents & pipes (FR7.2d): the CPU side — editor defaults sized to the texture, the plain defaults' look, the shape-mask
// writer rule, enum orders the shaders rely on, and px units for supersampling.

import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import { createLayer, freshParams, layerParamDefs } from '../registry'
import { pipesLayer, ventsLayer } from './greebleVents'

describe('vents & pipes', () => {
  ensureBuiltins()

  it('sizes a new vent to the texture: the plain grille at 64 px, a framed panel at 512 px', () => {
    expect(freshParams('vents', { width: 64, height: 64 })).toMatchObject({ cols: 2, rows: 8, width: 3, margin: 0 })
    const big = freshParams('vents', { width: 512, height: 512 })
    expect(big).toMatchObject({ cols: 4, rows: 18, width: 10, margin: 32, fasteners: 'corners' })
    expect(Number(big.clear)).toBeGreaterThan(0)
    expect(Number(big.outer)).toBeGreaterThan(0)
    expect(Number(big.round)).toBeGreaterThan(0)
    // Slots fill most of the cell, rims and the frame bevel grow with the texture.
    expect(Number(big.length)).toBeGreaterThan(80)
    expect(Number(big.rim)).toBeGreaterThan(1)
    expect(Number(big.bevel)).toBeGreaterThan(1)
    // A strip keeps whole cells along it.
    const strip = freshParams('vents', { width: 256, height: 16 })
    expect(Number(strip.rows)).toBeGreaterThanOrEqual(1)
    expect(Number(strip.cols)).toBeGreaterThanOrEqual(1)
  })

  it('writes the shape mask from its relief by default, not when told None', () => {
    for (const def of [ventsLayer, pipesLayer]) {
      const relief = createLayer(def.type).params
      expect(relief.mask, def.type).toBe(def.type === 'vents' ? 'plate' : 'all')
      expect(def.writesMask!(relief), def.type).toBe(true)
      expect(def.writesMask!({ ...relief, mask: 'none' }), def.type).toBe(false)
      expect(def.writesMask!({ ...relief, mask: 'none', output: def.type === 'vents' ? 'slots' : 'pipes' }), def.type).toBe(true)
    }
  })

  it('sizes new pipes to the texture', () => {
    const small = freshParams('pipes', { width: 64, height: 64 })
    const big = freshParams('pipes', { width: 512, height: 512 })
    expect(small.count).toBe(3)
    expect(big.count).toBe(5)
    expect(Number(big.diameter)).toBeGreaterThan(40)
    expect(Number(big.clamp_foot)).toBeGreaterThan(0)
    // Clamps in proportion to the pipe, a jitter in proportion to the spacing, a joint per run.
    expect(Number(big.clamp_lip)).toBeGreaterThanOrEqual(Number(big.diameter) * 0.07)
    expect(Number(big.jitter)).toBeGreaterThan(0)
    expect(big.joints).toBe(1)
  })

  it('starts with the finished look: rims, long points, true-size pipes with joints, bolted feet, supports in line', () => {
    const v = createLayer('vents').params
    expect(v).toMatchObject({ depth: 1, tip: 1.5, fast_style: 'slotted', mask: 'plate', profile: 'smooth', h_amount: 1 })
    expect(Number(v.rim)).toBeGreaterThan(0)
    const p = createLayer('pipes').params
    expect(p).toMatchObject({
      scale: 'true', mask: 'all', bolts: true, joints: 1, lid: true, clamp_jitter: 0, clamp_seeded: true, clamp_rel: true, h_amount: 0.5,
    })
    expect(Number(p.dia_var)).toBeGreaterThan(0)
    expect(Number(p.clamp_foot)).toBeGreaterThan(0)
  })

  it('keeps the enum orders the shaders index (new options appended)', () => {
    const opts = (type: string, key: string) => layerParamDefs(type).find((d) => d.key === key)!.options!.map((o) => o.value)
    expect(opts('vents', 'ends')).toEqual(['round', 'square', 'pointed', 'angled', 'hex'])
    expect(opts('vents', 'mode')).toEqual(['slots', 'louvers', 'holes', 'hoods'])
    expect(opts('vents', 'fasteners')).toEqual(['none', 'corners', 'sides'])
    expect(opts('vents', 'fast_style')).toEqual(['dome', 'slotted', 'cross'])
    expect(opts('pipes', 'joint_style')).toEqual(['coupling', 'flange', 'weld'])
    expect(opts('vents', 'output')).toEqual(['relief', 'slots', 'plate', 'frame'])
    expect(opts('vents', 'mask')).toEqual(['none', 'plate', 'slots', 'frame'])
    expect(opts('pipes', 'output')).toEqual(['relief', 'pipes', 'clamps', 'both'])
    expect(opts('pipes', 'mask')).toEqual(['none', 'all', 'pipes', 'clamps'])
    expect(opts('pipes', 'scale')).toEqual(['unit', 'true'])
  })

  it('only sets known params in the editor defaults, and marks lengths as px', () => {
    for (const def of [ventsLayer, pipesLayer]) {
      const keys = new Set(layerParamDefs(def.type).map((d) => d.key))
      for (const k of Object.keys(def.fresh!({ width: 512, height: 512 }))) expect(keys.has(k), `${def.type}.${k}`).toBe(true)
    }
    const px = (type: string, key: string) => layerParamDefs(type).find((d) => d.key === key)!.unit
    for (const k of ['length', 'width', 'rim', 'margin', 'outer', 'round', 'fast_size']) expect(px('vents', k), k).toBe('px')
    for (const k of ['diameter', 'jitter', 'bundle_gap', 'clamp_width', 'clamp_lip', 'clamp_foot']) expect(px('pipes', k), k).toBe('px')
  })

  it('uses every param it declares in its shader', () => {
    for (const def of [ventsLayer, pipesLayer]) {
      for (const d of def.params) if (d.key !== 'seed') expect(def.glsl!.includes(`u_${d.key}`), `${def.type}.${d.key}`).toBe(true)
    }
  })
})
