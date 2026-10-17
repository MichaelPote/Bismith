import { describe, expect, it } from 'vitest'
import { createProject, normalizeProject } from '@/core/serialize'
import type { Project } from '@/core/project'
import { layerParamDefs } from '@/layers/registry'
import { RECIPES, addMaterial, deleteMaterial, materialOf, pruneMaterials, setMacro, setMaterialLimit, unpackMaterial } from './index'
import { layerLimit, planMasks } from '@/layers/masks'

const blank = (): Project => createProject({ width: 64, height: 64, layers: [] })
const byRole = (p: Project, role: string) => {
  const id = p.materials![0].members[role]
  return p.layers.find((l) => l.id === id)!
}

describe('recipes', () => {
  for (const r of RECIPES) {
    it(`${r.id} builds known params into one block, relief first, and follows the craft rules`, () => {
      const p = blank()
      const m = addMaterial(p, r.id)
      expect(Object.keys(m.members).length).toBeGreaterThan(0)
      for (const l of p.layers) {
        const keys = new Set(layerParamDefs(l.type).map((d) => d.key))
        for (const k of Object.keys(l.params)) expect(keys.has(k), `${r.id}/${l.name}: unknown param ${k}`).toBe(true)
      }
      // Its relief layers come first and never paint (they shape the surface only).
      const built = r.build(m.params, { width: p.width, height: p.height, depth: p.heightDepth })
      const roles = [...built.filter((b) => b.stack === 'relief'), ...built.filter((b) => b.stack !== 'relief')].map((b) => b.role)
      expect(p.layers.map((l) => l.id)).toEqual(roles.map((role) => m.members[role]))
      for (const b of built.filter((x) => x.stack === 'relief')) {
        const l = byRole(p, b.role)
        for (const k of ['dif_on', 'op_on', 'e_on', 'diffuse', 'opacity', 'emissive']) expect(l.params[k] === true, `${r.id}/${l.name} paints in relief (${k})`).toBe(false)
      }
    })
  }

  it('a macro rewrites only what it affects, across both stacks', () => {
    const p = blank()
    const m = addMaterial(p, 'dressed-stone')
    byRole(p, 'lumps').params.octaves = 5 // the user's own edit
    byRole(p, 'pillow').params.h_amount = 0.9
    expect(setMacro(p, m, 'columns', 6)).toBeGreaterThan(0)
    // One layer lays the stones out; Pillow, Edges, heights and colour read them from the Shape mask.
    expect(byRole(p, 'layout').params.columns).toBe(6)
    for (const role of ['pillow', 'edges', 'heights', 'stone-colour']) expect(byRole(p, role).type).toBe('surfacemask')
    expect(byRole(p, 'lumps').params.octaves).toBe(5)
    expect(byRole(p, 'pillow').params.h_amount).toBe(0.9) // 'columns' doesn't touch the pillow height…
    setMacro(p, m, 'pillow', 0.3)
    expect(byRole(p, 'pillow').params.h_amount).toBe(0.3) // …'pillow' does
    expect(m.params.columns).toBe(6)
  })

  it('switches layers off at zero and back on', () => {
    const p = blank()
    const m = addMaterial(p, 'dressed-stone')
    setMacro(p, m, 'chips', 0)
    expect(byRole(p, 'chips').enabled).toBe(false)
    setMacro(p, m, 'chips', 0.5)
    expect(byRole(p, 'chips').enabled).toBe(true)
  })

  it('raises the render settings the look needs', () => {
    const p = blank()
    p.render.ao = 0
    addMaterial(p, 'dressed-stone')
    expect(p.render.ao).toBe(1)
  })

  it('survives a save / load round trip and prunes deleted members', () => {
    const p = blank()
    addMaterial(p, 'stains')
    const q = normalizeProject(JSON.parse(JSON.stringify(p)))
    expect(q.materials).toHaveLength(1)
    const first = Object.values(q.materials![0].members)[0]
    q.layers = q.layers.filter((l) => l.id !== first)
    pruneMaterials(q)
    expect(Object.values(q.materials![0].members)).not.toContain(first)
    expect(materialOf(q, Object.values(q.materials![0].members)[0])?.recipe).toBe('stains')
  })

  it('unpacks (layers stay) or deletes (layers go)', () => {
    const p = blank()
    const m = addMaterial(p, 'hammered-metal')
    const n = p.layers.length
    unpackMaterial(p, m.id)
    expect(p.materials).toHaveLength(0)
    expect(p.layers).toHaveLength(n)
    const m2 = addMaterial(p, 'hammered-metal')
    deleteMaterial(p, m2.id)
    expect(p.layers).toHaveLength(n)
  })
})

describe('macro that switches generator', () => {
  it('rebuilds the members whose type changes (Tiles → hexagons)', () => {
    const p = createProject({ width: 64, height: 64, layers: [] })
    const m = addMaterial(p, 'tiles')
    setMacro(p, m, 'pattern', 'hex')
    const tile = p.layers.find((l) => l.id === m.members.tile)!
    expect(tile.type).toBe('hex')
    expect(tile.params.orient).toBe('flat')
    // The tile colour reads the tiles from the Shape mask, whatever draws them.
    expect(p.layers.find((l) => l.id === m.members['tile-colour'])!.type).toBe('surfacemask')
  })

  it('limits every member to masks, through macro rebuilds, a save and unpacking', () => {
    const p = createProject({ width: 64, height: 64, layers: [] })
    const m = addMaterial(p, 'tiles')
    const limit = { terms: [{ mask: 'Opening', op: 'and' as const }], outside: true }
    setMaterialLimit(m, limit)
    const members = () => Object.values(m.members).map((id) => p.layers.find((l) => l.id === id)!)
    // The pipeline adds it to each member's own limit (group 1 when the member has one of its own).
    for (const l of members().filter((l) => l.enabled)) {
      const own = layerLimit(l.params)
      const terms = planMasks(p).layers.get(l.id)!.limit!
      expect(terms.at(-1)).toMatchObject({ ref: { mask: 'Opening' }, neg: true, group: own ? 1 : 0 })
    }
    // A macro that rebuilds members (another generator type) keeps it: it stays on the material.
    setMacro(p, m, 'pattern', 'hex')
    expect(m.limit).toEqual(limit)
    expect(normalizeProject(JSON.parse(JSON.stringify(p))).materials![0].limit).toEqual(limit)
    // Unpacked, it moves onto the members.
    const ids = Object.values(m.members)
    unpackMaterial(p, m.id)
    for (const id of ids) expect(layerLimit(p.layers.find((l) => l.id === id)!.params)!.terms.at(-1)).toMatchObject({ mask: 'Opening' })
    setMaterialLimit(m, null)
    expect(m.limit).toBeUndefined()
  })

  it('cut-out goes on top and writes its opening (and frame ring) from shapes with every output off', () => {
    const p = createProject({ width: 64, height: 64, layers: [] })
    addMaterial(p, 'tiles')
    const m = addMaterial(p, 'cutout', { frame: 4 })
    const opening = p.layers.find((l) => l.id === m.members.opening)!
    expect(p.layers[0].id).toBe(opening.id)
    expect(opening.params.mk_target).toBe('Opening')
    expect([opening.params.dif_on, opening.params.h_on]).toEqual([false, false])
    expect(p.layers.find((l) => l.id === m.members.frame)!.params.mk_target).toBe('Opening frame')
    setMacro(p, m, 'mask', 'Hatch')
    expect(p.layers.find((l) => l.id === m.members.opening)!.params.mk_target).toBe('Hatch')
  })
})

describe('renaming a mask', () => {
  it('renames it wherever it is named: writes, limits, sources, material limits and macros', async () => {
    const { renameMask } = await import('./index')
    const { createLayer } = await import('@/core/serialize')
    const p = createProject({ width: 64, height: 64, layers: [] })
    const cut = addMaterial(p, 'cutout', { frame: 2 })
    const tiles = addMaterial(p, 'tiles')
    setMaterialLimit(tiles, { terms: [{ mask: 'Opening', op: 'and' }], outside: true })
    const bevel = createLayer('bevel', { source: 'mask', source_mask: 'Opening' })
    const area = createLayer('surfacemask', { select: 'features', src_mask: 'Opening' })
    p.layers.push(bevel, area)
    expect(renameMask(p, 'Opening', 'Hatch')).toBeGreaterThanOrEqual(4)
    expect(p.layers.find((l) => l.id === cut.members.opening)!.params.mk_target).toBe('Hatch')
    expect(cut.params.mask).toBe('Hatch')
    expect(tiles.limit!.terms[0].mask).toBe('Hatch')
    expect([bevel.params.source_mask, area.params.src_mask]).toEqual(['Hatch', 'Hatch'])
    // The Cut-out's macro rebuilds its frame, whose mask follows the new name.
    expect(p.layers.find((l) => l.id === cut.members.frame)!.params.mk_target).toBe('Hatch frame')
  })
})
