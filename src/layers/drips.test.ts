// Drips' blisters: a shape for the Shape Mask only (no bevel card), shown for the Sources output, and old Sources
// layers keep their size.
import { describe, expect, it } from 'vitest'
import type { ParamValues } from '@/core/params'
import { ensureBuiltins } from '@/render/builtins'
import { createLayer, freshParams, getLayerDef, layerGroups, layerParamDefs, linkedChanges, sanitizeLayer } from '@/layers/registry'

ensureBuiltins()
const def = (key: string) => layerParamDefs('drips').find((p) => p.key === key)!

describe('drips blisters', () => {
  it('writes the Shape Mask without the bevel params', () => {
    const keys = layerParamDefs('drips').map((p) => p.key)
    expect(keys).toEqual(expect.arrayContaining(['sm_on', 'sdf_op', 'sdf_k']))
    expect(keys).not.toContain('bevel')
    expect(def('sm_on').group).toBe('mask')
    expect(layerGroups(getLayerDef('drips')!).map((g) => g.id)).not.toContain('shape')
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

describe('drips stains', () => {
  it('builds layers in code as scattered streaks with the full stain look ready for a switch to runnels', () => {
    const p = createLayer('drips').params
    expect(p).toMatchObject({ style: 'streak', spawn: 0, soft: 0, streaks: 0.55, seep: 0.8, feather: 0.4, shape_var: 0.8, flow: 0.6, str_var: 0.45 })
  })

  it('reads an old Relief drive as the first half of Drips from (grid cells at their ledges = 0.5)', () => {
    const old: ParamValues = { ...createLayer('drips').params, relief: 1 }
    delete old.spawn
    const p = sanitizeLayer({ id: 'a', type: 'drips', name: 'Drips', enabled: true, params: old }).params
    expect(p.spawn).toBe(0.5)
    expect(p.relief).toBeUndefined()
    expect(createLayer('drips', { relief: 0.4 }).params.spawn).toBe(0.2)
    expect(createLayer('drips', { relief: 1 }).params).not.toHaveProperty('relief')
    expect(def('ledge_gap').showIf!({ spawn: 0 })).toBe(false)
    expect(def('ledge_gap').showIf!({ spawn: 0.3 })).toBe(true)
  })

  it('swaps the editor paint with the output: brown multiply for stains, rust for blisters — paint set by hand stays', () => {
    const fresh = createLayer('drips', freshParams('drips', { width: 512, height: 512 })).params
    const toSources = linkedChanges('drips', fresh, 'output', 'source')
    expect(toSources).toMatchObject({ output: 'source', h_on: true, dif_blend: 'normal' })
    const back = linkedChanges('drips', { ...fresh, ...toSources }, 'output', 'stain')
    expect(back).toMatchObject({ output: 'stain', h_on: false, dif_blend: 'multiply' })
    expect(back.dif_grad).toEqual(fresh.dif_grad)
    // A layer built in code (the plain rust ramp) or repainted keeps its paint.
    expect(linkedChanges('drips', createLayer('drips').params, 'output', 'source')).toEqual({ output: 'source', h_on: true })
    const repainted = { ...fresh, dif_grad: { stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }] } }
    expect(linkedChanges('drips', repainted, 'output', 'source')).toEqual({ output: 'source', h_on: true })
  })

  it('starts editor layers as a detailed stain from 128 px, crisp pixel streaks below', () => {
    expect(freshParams('drips', { width: 512, height: 512 })).toMatchObject({ style: 'runnels', hard: false, dif_blend: 'multiply' })
    expect(freshParams('drips', { width: 64, height: 64 })).toMatchObject({ style: 'streak', dif_blend: 'multiply' })
    expect(freshParams('drips', { width: 64, height: 64 }).hard).toBeUndefined()
  })

  it('fits the editor defaults in the ranges at every size up to 2048 px', () => {
    for (const width of [16, 64, 128, 512, 2048]) {
      const fresh = freshParams('drips', { width, height: width })
      for (const [k, v] of Object.entries(fresh)) {
        const d = def(k)
        if (typeof v !== 'number' || d.min === undefined) continue
        expect(v, `${k} at ${width} px`).toBeGreaterThanOrEqual(d.min)
        expect(v, `${k} at ${width} px`).toBeLessThanOrEqual(d.max!)
        if (d.softMax !== undefined) expect(v, `${k} at ${width} px (slider)`).toBeLessThanOrEqual(width <= 512 ? d.softMax : d.max!)
      }
    }
  })

  it('hides the controls a style or switch does not use', () => {
    const runnels = { ...createLayer('drips').params, style: 'runnels', hard: false }
    expect(def('soft').showIf!(runnels)).toBe(true)
    expect(def('soft').showIf!({ ...runnels, hard: true })).toBe(false)
    expect(def('streak_w').showIf!({ ...runnels, streaks: 0 })).toBe(false)
    expect(def('streak_w').showIf!(runnels)).toBe(true)
    expect(def('fan').showIf!({ ...runnels, style: 'streak' })).toBe(false)
  })
})
