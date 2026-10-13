// Drips' blisters: a shape for the Shape Mask only (no bevel card), shown for the Sources output, and old Sources
// layers keep their size.
import { describe, expect, it } from 'vitest'
import type { ParamValues } from '@/core/params'
import { ensureBuiltins } from '@/render/builtins'
import { createLayer, getLayerDef, layerGroups, layerParamDefs, linkedChanges, sanitizeLayer } from '@/layers/registry'

ensureBuiltins()
const def = (key: string) => layerParamDefs('drips').find((p) => p.key === key)!

describe('drips blisters', () => {
  it('writes the Shape Mask without the bevel params', () => {
    const keys = layerParamDefs('drips').map((p) => p.key)
    expect(keys).toEqual(expect.arrayContaining(['sm_on', 'sdf_op', 'sdf_k']))
    expect(keys).not.toContain('bevel')
    const groups = layerGroups(getLayerDef('drips')!).map((g) => g.id)
    expect(groups).toContain('shapemask')
    expect(groups).not.toContain('shape')
  })

  it('shows the Shape Mask only for Sources', () => {
    const stains = createLayer('drips').params
    const sources = createLayer('drips', { output: 'source' }).params
    expect(def('sm_on').showIf!(stains)).toBe(false)
    expect(def('sm_on').showIf!(sources)).toBe(true)
    expect(def('sdf_op').showIf!(sources)).toBe(true)
    expect(def('sdf_k').showIf!({ ...sources, sdf_op: 'smooth-union' })).toBe(true)
    expect(def('sdf_k').showIf!({ ...sources, sdf_op: 'union' })).toBe(false)
  })

  it('takes an old Sources head size as the blister radius', () => {
    const old: ParamValues = { ...createLayer('drips').params, output: 'source', head: 1.5 }
    delete old.blister
    expect(sanitizeLayer({ id: 'a', type: 'drips', name: 'Blisters', enabled: true, params: old }).params.blister).toBe(1.5)
    const tiny = { ...old, head: 0 }
    expect(sanitizeLayer({ id: 'b', type: 'drips', name: 'Blisters', enabled: true, params: tiny }).params.blister).toBe(0.75)
    // Stains and layers saved since keep theirs.
    const stains = { ...old, output: 'stain' }
    expect(sanitizeLayer({ id: 'c', type: 'drips', name: 'Drips', enabled: true, params: stains }).params.blister).toBe(2)
  })
})

describe('drips height follows the output', () => {
  it('starts Sources with Height on, Stains with it off', () => {
    expect(createLayer('drips').params.h_on).toBe(false)
    expect(createLayer('drips', { output: 'source' }).params.h_on).toBe(true)
    expect(createLayer('drips', { output: 'source', h_on: false }).params.h_on).toBe(false)
  })
  it('switches Height with the output unless it was set by hand', () => {
    const stains = createLayer('drips').params
    expect(linkedChanges('drips', stains, 'output', 'source')).toEqual({ output: 'source', h_on: true })
    const sources = { ...stains, output: 'source', h_on: true }
    expect(linkedChanges('drips', sources, 'output', 'stain')).toEqual({ output: 'stain', h_on: false })
    expect(linkedChanges('drips', { ...stains, h_on: true }, 'output', 'source')).toEqual({ output: 'source' })
    expect(linkedChanges('drips', stains, 'density', 0.3)).toEqual({ density: 0.3 })
  })
})
