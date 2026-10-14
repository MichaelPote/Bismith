import { describe, expect, it } from 'vitest'
import { createLayer, createPostFilter, createProject } from '@/core/serialize'
import type { Project } from '@/core/project'
import { CRAFT_LIBRARY, conformProject, craftPrior, isPixelNoise, noiseFeaturePx } from './heuristics'
import { Optimizer, extractParams } from './optimizer'

function proj(over: Partial<Project> = {}): Project {
  return createProject({ width: 64, height: 64, layers: [], ...over })
}

describe('craft rules', () => {
  it('measures noise feature sizes (white = block, lattice = width / scale × stretch)', () => {
    const p = proj()
    expect(noiseFeaturePx(createLayer('noise', { noise: 'white', block: 1 }), p)).toBe(1)
    expect(noiseFeaturePx(createLayer('noise', { noise: 'perlin', scale: 8, stretch: 1 }), p)).toBe(8)
    expect(isPixelNoise(createLayer('noise', { noise: 'value', scale: 40 }), p)).toBe(true)
  })

  it('caps pixel-scale height and turns off pixel-scale specular', () => {
    const p = proj({ layers: [createLayer('noise', { noise: 'white', h_on: true, h_amount: 0.25, s_on: true }, 'Speckle')] })
    const { project, changes } = conformProject(p)
    expect(project.layers[0].params.h_amount).toBe(0.05)
    expect(project.layers[0].params.s_on).toBe(false)
    expect(changes.some((c) => c.startsWith('no-pixel-height'))).toBe(true)
  })

  it('turns per-brick wobble into a whole-pattern domain warp', () => {
    const p = proj({ layers: [createLayer('bricks', { wobble: 2 })] })
    const b = conformProject(p).project.layers[0].params
    expect(b.wobble).toBe(0)
    expect(b.dw_amount).toBe(1.5)
  })

  it('replaces a tenting bevel with the crisp-edge custom curve', () => {
    // 2 rows on 64 px → blocks 32 tall, half 16; a 10 px round bevel tents.
    const p = proj({ layers: [createLayer('bricks', { columns: 2, rows: 2, bevel: 10, profile: 'round' })] })
    const b = conformProject(p).project.layers[0].params
    expect(b.profile).toBe('custom')
    expect((b.bevel_curve as { points: unknown[] }).points.length).toBeGreaterThan(2)
    const narrow = proj({ layers: [createLayer('bricks', { columns: 2, rows: 2, bevel: 3, profile: 'round' })] })
    expect(conformProject(narrow).project.layers[0].params.profile).toBe('round')
  })

  it('adds occlusion for tight joints, tints glints, fine ledge grids and painted light', () => {
    const p = proj({
      layers: [createLayer('bricks', { mortar: 0.5 }), createLayer('drips', { relief: 1, cols: 8, rows: 4 })],
      post: [createPostFilter('palette', { palette: 'quake' })],
    })
    p.render.specular = 1
    p.render.specularTint = 0
    const q = conformProject(p).project
    expect(q.render.ao).toBe(0.8)
    expect(q.render.specularTint).toBe(0.6)
    expect(q.layers[1].params.cols).toBeGreaterThanOrEqual(22)
    expect(q.render.shadows).toBe(false)
  })

  it('keeps relief fine', () => {
    const p = proj({ heightDepth: 8 })
    expect(conformProject(p).project.heightDepth).toBe(3)
  })

  it('is idempotent', () => {
    const p = proj({
      heightDepth: 6,
      layers: [createLayer('bricks', { wobble: 1, mortar: 0, bevel: 20, profile: 'smooth', columns: 2, rows: 2 }), createLayer('noise', { noise: 'white', h_on: true })],
    })
    const once = conformProject(p).project
    expect(conformProject(once).changes).toEqual([])
  })
})

describe('craft priors', () => {
  it('excludes wobble and pixel-noise height, narrows steady bevels', () => {
    const p = proj({
      layers: [
        createLayer('bricks', { columns: 2, rows: 2, bevel: 3, profile: 'round', wobble: 1 }, 'Bricks'),
        createLayer('noise', { noise: 'white', h_on: true, h_amount: 0.05 }, 'Speckle'),
      ],
    })
    const keys = (s: ReturnType<typeof extractParams>) => s.entries.map((e) => e.label)
    const plain = extractParams(p)
    const prior = extractParams(p, { prior: craftPrior })
    expect(keys(plain)).toContain('Bricks › Wobble')
    expect(keys(prior)).not.toContain('Bricks › Wobble')
    expect(keys(plain)).toContain('Speckle › Amount')
    expect(keys(prior)).not.toContain('Speckle › Amount')
    const bevel = prior.entries.find((e) => e.label === 'Bricks › Bevel')!
    expect(bevel.hi).toBeLessThanOrEqual(0.45 * 16 + 1e-9)
  })
})

describe('optimiser with heuristics', () => {
  it('conforms the start project and inserts relief snippets under the colour layers', async () => {
    const p = proj({ layers: [createLayer('bricks', { wobble: 2, mortar: 2, dif_on: false, h_on: true }), createLayer('noise', { noise: 'perlin', dif_on: true })] })
    const opt = new Optimizer(p, () => 1, { seed: 3, structural: true, structuralRate: 1, lambda: 6 })
    expect(opt.best.project.layers[0].params.wobble).toBe(0)
    for (let i = 0; i < 6; i++) await opt.step()
    const reliefTypes = new Set(CRAFT_LIBRARY.filter((t) => t.stack === 'relief').map((t) => t.name))
    const c = opt.current.project
    const firstPaint = c.layers.findIndex((l) => l.params.dif_on === true)
    c.layers.forEach((l, i) => {
      if (reliefTypes.has(l.name)) expect(i).toBeLessThan(firstPaint)
    })
  })

  it('searches ambient occlusion only above the floor tight joints keep it at', () => {
    const p = proj({ layers: [createLayer('bricks', { mortar: 0.5, h_on: true })] })
    const ao = new Optimizer(p, () => 1, { space: { shading: true } }).space.entries.find((e) => e.id === 'render::ao')!
    expect(ao.lo).toBe(0.8)
    const loose = proj({ layers: [createLayer('bricks', { mortar: 3, h_on: true })] })
    expect(new Optimizer(loose, () => 1, { space: { shading: true } }).space.entries.find((e) => e.id === 'render::ao')!.lo).toBe(0)
  })

  it('can be switched off', () => {
    const p = proj({ layers: [createLayer('bricks', { wobble: 2 })] })
    const opt = new Optimizer(p, () => 1, { heuristics: false })
    expect(opt.best.project.layers[0].params.wobble).toBe(2)
  })
})
