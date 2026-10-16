// Tread plate and Weave (FR7.2b): the CPU side — param ranges and option order, defaults, style-linked proportions,
// the Float ends → Run on under conversion, and params the shader uses.

import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import type { LayerDef } from '../types'
import { createLayer, freshParams, layerParamDefs, linkedChanges, sanitizeLayer } from '../registry'
import { treadplateLayer, weaveLayer } from './geometricSurface'

const tex = { width: 512, height: 512 }

function inRange(def: LayerDef) {
  for (const d of def.params) {
    if (d.type !== 'float' && d.type !== 'int') continue
    expect(Number(d.default), d.key).toBeGreaterThanOrEqual(d.min ?? -Infinity)
    expect(Number(d.default), d.key).toBeLessThanOrEqual(d.max ?? Infinity)
  }
}

function freshKnown(type: string) {
  const defs = new Map(layerParamDefs(type).map((d) => [d.key, d]))
  for (const [k, v] of Object.entries(freshParams(type, tex))) {
    const d = defs.get(k)
    expect(d, `${type}: fresh sets unknown ${k}`).toBeDefined()
    if (d!.type === 'enum') expect(d!.options!.map((o) => o.value), k).toContain(v)
  }
}

describe('treadplate', () => {
  ensureBuiltins()

  it('keeps defaults in range, uses its params and keeps the option order', () => {
    inRange(treadplateLayer)
    for (const d of treadplateLayer.params) if (d.key !== 'seed') expect(treadplateLayer.glsl!.includes(`u_${d.key}`), `u_${d.key} unused`).toBe(true)
    const opts = (k: string) => treadplateLayer.params.find((d) => d.key === k)!.options!.map((o) => o.value)
    expect(opts('style').slice(0, 4)).toEqual(['lozenge', 'capsule', 'bars', 'stud'])
    expect(opts('layout').slice(0, 4)).toEqual(['checker', 'rows', 'cols', 'same'])
  })

  it('starts as domed, ridged, glinting diamond plate', () => {
    const l = createLayer('treadplate')
    expect(l.params).toMatchObject({ layout: 'herringbone', crown: 1, crest: 0.5, r_on: true, s_on: true, r_src: 'value' })
    expect(Number(l.params.h_var)).toBeLessThan(0.1) // rolled plate: lugs nearly level
    // The plain defaults are the lozenge style's own look.
    expect(l.params).toMatchObject(treadplateLayer.linkedDefaults!({ style: 'lozenge' }))
    // In the editor, roughness and specular follow the relief rather than the registry's shape source.
    freshKnown('treadplate')
    expect(freshParams('treadplate', tex)).toMatchObject({ r_src: 'value', s_src: 'value' })
  })

  it('switches arrangement and proportions with the style, keeping what the user set', () => {
    const base = createLayer('treadplate').params
    const bars = linkedChanges('treadplate', base, 'style', 'bars')
    expect(bars).toMatchObject({ layout: 'checker', angle: 0, width: 0.5 })
    const user = { ...base, ...bars, width: 0.4 }
    const back = linkedChanges('treadplate', user, 'style', 'lozenge')
    expect(back.angle).toBe(45)
    expect(back.width).toBeUndefined()
    // A recipe that sets the style and its arrangement keeps them.
    const set = createLayer('treadplate', { style: 'bars', layout: 'checker', angle: 45, length: 0.8, width: 0.26 })
    expect(set.params).toMatchObject({ layout: 'checker', angle: 45, length: 0.8, width: 0.26 })
  })
})

describe('weave', () => {
  ensureBuiltins()

  it('keeps defaults in range, uses its params and keeps the option order', () => {
    inRange(weaveLayer)
    for (const d of weaveLayer.params) if (d.key !== 'seed') expect(weaveLayer.glsl!.includes(`u_${d.key}`), `u_${d.key} unused`).toBe(true)
    const opts = (k: string) => weaveLayer.params.find((d) => d.key === k)!.options!.map((o) => o.value)
    expect(opts('pattern').slice(0, 7)).toEqual(['plain', 'twill', 'twill21', 'twill31', 'basket', 'satin', 'lattice'])
    expect(opts('rnd_mode').slice(0, 3)).toEqual(['random', 'class', 'class_random'])
  })

  it('starts with arched floats, rounded strands, lower under-runs and a tone per strand', () => {
    expect(createLayer('weave').params).toMatchObject({ arch: 0.6, crown: 0.6, under: 0.5, run_on: 0, rnd_mode: 'strand', profile: 'round', dif_src: 'value' })
    freshKnown('weave')
  })

  it('reads an old negative Float ends as Run on under, and drops the old key', () => {
    const old = (dip: number) => sanitizeLayer({ id: 'l', type: 'weave', name: 'Weave', enabled: true, params: { pattern: 'lattice', dip } }).params
    expect(old(-1)).toMatchObject({ run_on: 1, pattern: 'lattice' })
    expect(old(-0.4).run_on).toBeCloseTo(0.4)
    expect(old(0.7).run_on).toBe(0)
    expect('dip' in old(-1)).toBe(false)
  })
})
