// Pattern layers (FR2.4): the CPU side — the defaults (the finished looks), editor defaults sized to the texture,
// params the shaders use, and which outputs have a shape.

import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import { createLayer, freshParams, layerParamDefs, linkedChanges } from '../registry'
import { bricksLayer, gridLayer, hexLayer, stripesLayer, voronoiLayer } from './patterns'

const LAYERS = [bricksLayer, hexLayer, voronoiLayer, gridLayer, stripesLayer]

describe('pattern layers', () => {
  ensureBuiltins()

  it('declare every param once (a type param named like a common one redefines its uniform)', () => {
    for (const def of LAYERS) {
      const keys = layerParamDefs(def.type).map((d) => d.key)
      expect(keys.filter((k, i) => keys.indexOf(k) !== i), def.type).toEqual([])
    }
  })

  it('leave Joint variation off by default, so walls made before it look the same', () => {
    expect(bricksLayer.params.find((d) => d.key === 'joint_var')!.default).toBe(0)
  })

  it('use every param of their own in the shader', () => {
    for (const def of LAYERS) for (const d of def.params) if (d.key !== 'seed') expect(def.glsl!.includes(`u_${d.key}`), `${def.type}: u_${d.key} unused`).toBe(true)
  })

  it('default to the finished looks: weathered bricks, hand-set tiles, cobbles, soft value edges', () => {
    expect(createLayer('bricks').params).toMatchObject({ rows: 12, mortar_level: 0.2, crease: true, close: true, chips: 0.4, chip_dust: 0.45, face: 0.35, face_tilt: 0.5, h_var: 0.3, len_var: 0.25, min_size: 0.5 })
    expect(createLayer('hex').params).toMatchObject({ round_bevel: true, grout_level: 0.2, crown: 1.2, chips: 0.3, chip_size: 0.25 })
    expect(createLayer('voronoi').params).toMatchObject({ size_var: 0.5, round_bevel: true, min_bevel: 0.5, grout_level: 0.2, facet_fit: true, crack_var: 0.6, crack_scale: 0.6, crack_tone: 0.7, h_mode: 'add' })
    expect(createLayer('grid').params).toMatchObject({ snap: true, profile: 'smooth' })
    expect(createLayer('stripes').params).toMatchObject({ fit_bevel: true, soft: 3, soft_profile: 'smooth', profile: 'smooth' })
  })

  it('start a new brick wall at about 3:1 bricks with relief sized to the courses', () => {
    const big = freshParams('bricks', { width: 512, height: 512 })
    expect(big.rows).toBe(12)
    expect(Number(big.rows) % 2).toBe(0)
    const course = 512 / Number(big.rows)
    expect(512 / Number(big.columns) / course).toBeCloseTo(3, 0)
    expect(Number(big.bevel)).toBeCloseTo(course * 0.2, 0)
    expect(Number(big.wobble)).toBeGreaterThan(0)
    // Small textures get proportionally small (but not zero) bevels; wide ones keep the bricks' proportions.
    const small = freshParams('bricks', { width: 64, height: 64 })
    expect(Number(small.bevel)).toBeGreaterThanOrEqual(1)
    expect(Number(small.bevel)).toBeLessThan(Number(big.bevel))
    const wide = freshParams('bricks', { width: 1024, height: 256 })
    expect(Number(wide.rows) % 2).toBe(0)
    expect(1024 / Number(wide.columns) / (256 / Number(wide.rows))).toBeGreaterThan(2)
  })

  it('size the other new layers’ bevels to their features', () => {
    for (const type of ['hex', 'voronoi', 'stripes']) {
      const small = Number(freshParams(type, { width: 64, height: 64 }).bevel)
      const big = Number(freshParams(type, { width: 1024, height: 1024 }).bevel)
      expect(small, type).toBeGreaterThanOrEqual(1)
      expect(big, type).toBeGreaterThan(small)
    }
    // Grid lines: grooves, not ink lines — 5 px with a 1.8 px bevel (a flat floor) at 512, thinner on small textures.
    expect(freshParams('grid', { width: 512, height: 512 })).toMatchObject({ width: 5, bevel: 1.8 })
    expect(Number(freshParams('grid', { width: 64, height: 64 }).width)).toBe(1)
  })

  it('cuts Voronoi crackle in as grooves, and switches back for the other outputs', () => {
    expect(createLayer('voronoi', { output: 'crackle' }).params.h_mode).toBe('subtract')
    expect(createLayer('voronoi', { output: 'crackle', h_mode: 'max' }).params.h_mode).toBe('max')
    const crackle = createLayer('voronoi', { output: 'crackle' }).params
    expect(linkedChanges('voronoi', crackle, 'output', 'cells').h_mode).toBe('add')
  })

  it('paint shape stripes by their shape, so their bevels don’t frame them in dark', () => {
    expect(createLayer('stripes', { mode: 'shape' }).params.dif_src).toBe('shape')
    expect(createLayer('stripes', { mode: 'sine' }).params.dif_src).toBe('value')
  })

  it('offer the Shape Mask and Edge only for the outputs that have a shape', () => {
    expect(stripesLayer.sdfShowIf!({ mode: 'sine' })).toBe(false)
    expect(stripesLayer.sdfShowIf!({ mode: 'shape' })).toBe(true)
    expect(voronoiLayer.sdfShowIf!({ output: 'facets' })).toBe(false)
    expect(voronoiLayer.sdfShowIf!({ output: 'cells' })).toBe(true)
  })
})
