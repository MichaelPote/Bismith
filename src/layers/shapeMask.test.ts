import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import { createProject } from '@/core/serialize'
import { createLayer } from './registry'
import { shapeMaskChain, shapeMaskLabel } from './shapeMask'

ensureBuiltins()

describe('shape mask writers', () => {
  it('names the layers the shape mask holds, back to the last Normal writer', () => {
    const p = createProject({ layers: [] })
    const old = createLayer('rect', {}, 'Old')
    const panel = createLayer('rect', {}, 'Panel')
    const grain = createLayer('noise', {}, 'Grain')
    const vent = createLayer('ellipse', { sdf_op: 'subtract' }, 'Vent')
    const off = createLayer('rect', { sm_on: false }, 'Ignored')
    const hidden = { ...createLayer('rect', { sdf_op: 'union' }, 'Hidden'), enabled: false }
    const grime = createLayer('noise', {}, 'Grime')
    p.layers.push(old, panel, grain, vent, off, hidden, grime)
    expect(shapeMaskChain(p, grime.id)).toEqual([
      { name: 'Panel', op: 'replace' },
      { name: 'Vent', op: 'subtract' },
    ])
    expect(shapeMaskLabel(shapeMaskChain(p, grime.id))).toBe('Panel − Vent')
    expect(shapeMaskLabel(shapeMaskChain(p, grain.id))).toBe('Panel')
    expect(shapeMaskChain(p, old.id)).toEqual([])
  })

  it('shortens long chains to the last three writers', () => {
    const p = createProject({ layers: [] })
    for (const n of ['A', 'B', 'C', 'D']) p.layers.push(createLayer('rect', { sdf_op: 'union' }, n))
    const last = createLayer('noise')
    p.layers.push(last)
    expect(shapeMaskLabel(shapeMaskChain(p, last.id))).toBe('… + B + C + D')
  })
})
