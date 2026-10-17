import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import { createProject } from '@/core/serialize'
import type { Layer } from '@/core/project'
import type { ParamValues } from '@/core/params'
import { createLayer } from './registry'
import { foldLimit, layerLimit, limitLabel, limitParams, limitTo, maskChain, maskChainLabel, maskLinks, maskWriteKind, masksAbove, planMasks, sanitizeLimit } from './masks'
import { getLayerDef } from './registry'

ensureBuiltins()

const project = (layers: Layer[]) => createProject({ width: 32, height: 32, layers })

describe('mask writers and labels', () => {
  it('names the layers a mask holds, back to the last Normal writer', () => {
    const old = createLayer('rect', {}, 'Old')
    const panel = createLayer('rect', {}, 'Panel')
    const grain = createLayer('noise', {}, 'Grain')
    const vent = createLayer('ellipse', { mk_op: 'subtract' }, 'Vent')
    const off = createLayer('rect', { mk_target: '' }, 'Ignored')
    const other = createLayer('rect', { mk_target: 'Opening' }, 'Hatch')
    const hidden = { ...createLayer('rect', { mk_op: 'union' }, 'Hidden'), enabled: false }
    const grime = createLayer('noise', {}, 'Grime')
    const p = project([old, panel, grain, vent, off, other, hidden, grime])
    expect(maskChain(p, grime.id, 'Shape')).toEqual([
      { name: 'Panel', op: 'replace' },
      { name: 'Vent', op: 'subtract' },
    ])
    expect(maskChainLabel(maskChain(p, grime.id, 'Shape'))).toBe('Panel − Vent')
    expect(maskChainLabel(maskChain(p, grain.id, 'Shape'))).toBe('Panel')
    expect(maskChain(p, old.id, 'Shape')).toEqual([])
    expect(maskChainLabel(maskChain(p, grime.id, 'Opening'))).toBe('Hatch')
    expect(masksAbove(p, grime.id)).toEqual(['Shape', 'Opening'])
    expect(masksAbove(p, grain.id)).toEqual(['Shape'])
  })

  it('shortens long chains to the last three writers', () => {
    const layers = ['A', 'B', 'C', 'D'].map((n) => createLayer('rect', { mk_op: 'union' }, n))
    const last = createLayer('noise')
    expect(maskChainLabel(maskChain(project([...layers, last]), last.id, 'Shape'))).toBe('… + B + C + D')
  })

  it('writes shapes from shape layers, coverage from others — and never coverage into Shape from a shape layer', () => {
    const def = (t: string) => getLayerDef(t)
    expect(maskWriteKind(def('rect'), createLayer('rect').params)).toBe('shape')
    expect(maskWriteKind(def('noise'), createLayer('noise').params)).toBe(false)
    expect(maskWriteKind(def('noise'), { ...createLayer('noise').params, mk_target: 'Moss' })).toBe('coverage')
    const joints = createLayer('stone_blocks', { output: 'joints' }).params
    expect(maskWriteKind(def('stone_blocks'), joints)).toBe(false)
    expect(maskWriteKind(def('stone_blocks'), { ...joints, mk_target: 'Joints' })).toBe('coverage')
    expect(maskWriteKind(def('bevel'), { mk_target: 'Shape' })).toBe(false)
  })
})

describe('limit expressions', () => {
  it('round-trips through the flat params', () => {
    const e = { terms: [{ mask: 'Shape', op: 'and' as const }, { mask: 'Opening', op: 'minus' as const }, { mask: 'Wet', op: 'or' as const }], outside: true }
    expect(layerLimit(limitParams(e))).toEqual(e)
    expect(layerLimit(limitParams(null))).toBeNull()
    expect(layerLimit(limitTo(['Shape', '−', 'Opening', '∪', 'Wet'], { outside: true }))).toEqual(e)
    expect(limitLabel(e)).toBe('outside Shape − Opening ∪ Wet')
    // A gap ends the expression: terms after an empty name are ignored.
    expect(layerLimit({ lim_1: 'A', lim_2: '', lim_op3: 'or', lim_3: 'C' })!.terms.map((t) => t.mask)).toEqual(['A'])
  })

  it('folds Outside into the terms (De Morgan), so the combine never inverts a partial result', () => {
    const a = createLayer('rect', { mk_target: 'A' })
    const b = createLayer('rect', { mk_target: 'B' })
    const at = (limit: ParamValues) => {
      const l = createLayer('noise', limit)
      return planMasks(project([a, b, l])).layers.get(l.id)!.limit!.map((t) => [t.ref.mask, t.op, t.neg])
    }
    expect(at(limitTo(['A', '∪', 'B'], { outside: true }))).toEqual([['A', 'first', true], ['B', 'and', true]])
    expect(at(limitTo(['A', '∩', 'B'], { outside: true }))).toEqual([['A', 'first', true], ['B', 'or', true]])
    expect(at(limitTo(['A', '−', 'B'], { outside: true }))).toEqual([['A', 'first', true], ['B', 'or', false]])
    expect(at(limitTo(['A', '−', 'B']))).toEqual([['A', 'first', false], ['B', 'minus', false]])
  })

  it('folds a material limit into a member’s own when unpacking, where one expression can hold both', () => {
    const own = { terms: [{ mask: 'Shape', op: 'and' as const }], outside: false }
    const out = { terms: [{ mask: 'Shape', op: 'and' as const }], outside: true }
    const hole = { terms: [{ mask: 'Opening', op: 'and' as const }], outside: true }
    const inHole = { terms: [{ mask: 'Opening', op: 'and' as const }], outside: false }
    expect(foldLimit(null, hole)).toEqual(hole)
    expect(foldLimit(own, hole)).toEqual({ terms: [{ mask: 'Shape', op: 'and' }, { mask: 'Opening', op: 'minus' }], outside: false })
    expect(foldLimit(out, hole)).toEqual({ terms: [{ mask: 'Shape', op: 'and' }, { mask: 'Opening', op: 'or' }], outside: true })
    expect(foldLimit(out, inHole)).toEqual({ terms: [{ mask: 'Opening', op: 'and' }, { mask: 'Shape', op: 'minus' }], outside: false })
  })

  it('sanitises stored material limits', () => {
    expect(sanitizeLimit({ terms: [{ mask: ' Opening ', op: 'nope' }, { mask: '' }], outside: 1 })).toEqual({ terms: [{ mask: 'Opening', op: 'and' }], outside: false })
    expect(sanitizeLimit({ terms: [] })).toBeUndefined()
    expect(sanitizeLimit('x')).toBeUndefined()
  })
})

describe('mask plan', () => {
  it('gives a slot only to versions read later, and reuses it once its last reader has run', () => {
    // Shape is written three times; only the second is read (by the grime) — and the last stays for the Masks view.
    const s1 = createLayer('rect', {}, 's1')
    const s2 = createLayer('rect', {}, 's2')
    const grime = createLayer('noise', limitTo('Shape'), 'grime')
    const s3 = createLayer('rect', {}, 's3')
    const plan = planMasks(project([s1, s2, grime, s3]))
    const w = (l: Layer) => plan.layers.get(l.id)!.write!
    // s1's version is read last by s2 (a writer reads what it writes over), s2's by s3; each next write takes the slot
    // its last reader frees (the copy happens after that layer has run), so one slot serves all three.
    expect([w(s1).slot, w(s2).slot, w(s3).slot]).toEqual([0, 0, 0])
    expect(plan.slots).toBe(1)
    expect(plan.layers.get(grime.id)!.limit![0].ref).toMatchObject({ mask: 'Shape', version: 2, slot: 0 })
    expect(plan.final.get('Shape')).toMatchObject({ version: 3, slot: 0 })
    // A second mask alive at the same time needs a second slot.
    const hatch = createLayer('rect', { mk_target: 'Hatch' })
    expect(planMasks(project([s1, hatch, grime, s3])).slots).toBe(2)
  })

  it('needs no slot for a mask nothing reads but the view, and none at all for an empty one', () => {
    const noise = createLayer('noise', limitTo('Nothing'))
    const plan = planMasks(project([noise]))
    expect(plan.slots).toBe(0)
    expect(plan.layers.get(noise.id)!.limit![0].ref).toMatchObject({ version: 0, slot: -1 })
  })

  it('tracks exact distances: shapes are, coverage and Feather aren’t', () => {
    const shape = createLayer('rect')
    const feathered = createLayer('rect', { mk_target: 'Soft', mk_feather: 4 })
    const moss = createLayer('noise', { mk_target: 'Moss' })
    const plan = planMasks(project([shape, feathered, moss]))
    expect([plan.final.get('Shape')!.exact, plan.final.get('Soft')!.exact, plan.final.get('Moss')!.exact]).toEqual([true, false, false])
  })

  it('skips disabled layers and reads Shape for layers that read a mask without writing one', () => {
    const shape = createLayer('rect')
    const off = { ...createLayer('rect', { mk_target: 'Shape' }), enabled: false }
    const chips = createLayer('chips', { mk_target: '' })
    const plan = planMasks(project([shape, off, chips]))
    expect(plan.layers.has(off.id)).toBe(false)
    expect(plan.layers.get(chips.id)!.input).toMatchObject({ mask: 'Shape', version: 1 })
    expect(plan.layers.get(chips.id)!.write).toBeNull()
  })
})

describe('Mask area', () => {
  it('writes the feature shape from Inside, coverage from everything else (and from Inside with Breakup)', () => {
    const def = getLayerDef('surfacemask')
    const at = (p: ParamValues) => maskWriteKind(def, { ...createLayer('surfacemask').params, mk_target: 'M', ...p })
    expect(at({})).toBe('coverage')
    expect(at({ select: 'features' })).toBe('shape')
    expect(at({ select: 'features', bk_amount: 0.5 })).toBe('coverage')
    expect(at({ select: 'features', area: 'gradient' })).toBe('coverage')
    expect(def!.maskSource!({ select: 'features', src_mask: 'Opening' })).toBe('Opening')
    expect(def!.maskSource!({ select: 'surface' })).toBeNull()
    // Reading features plans a source for the layer.
    const shape = createLayer('rect')
    const area = createLayer('surfacemask', { select: 'features' })
    expect(planMasks(project([shape, area])).layers.get(area.id)!.source).toMatchObject({ mask: 'Shape', version: 1 })
  })
})

describe('mask links (the outliner lane)', () => {
  it('links each limited layer to the writers of what it reads, and a material’s limit from the material', () => {
    const panel = createLayer('rect', {}, 'Panel')
    const vent = createLayer('ellipse', { mk_op: 'subtract' }, 'Vent')
    const moss = createLayer('noise', { mk_target: 'Moss' }, 'Moss')
    const grime = createLayer('noise', limitTo(['Shape', '∩', 'Moss']), 'Grime')
    const late = createLayer('rect', {}, 'Late')
    const p = project([panel, vent, moss, grime, late])
    expect(maskLinks(p).map((l) => [l.reader, l.writer, l.mask])).toEqual([
      [grime.id, panel.id, 'Shape'],
      [grime.id, vent.id, 'Shape'],
      [grime.id, moss.id, 'Moss'],
    ])
    p.materials = [{ id: 'm1', recipe: 'tiles', name: 'M', params: {}, members: { x: late.id }, limit: { terms: [{ mask: 'Moss', op: 'and' }], outside: false } }]
    expect(maskLinks(p).filter((l) => l.reader === 'material:m1').map((l) => l.writer)).toEqual([moss.id])
  })
})
