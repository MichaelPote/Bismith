import { describe, expect, it } from 'vitest'
import { createLayer, createProject, normalizeProject } from '@/core/serialize'
import type { Gradient } from '@/core/params'
import type { Project } from '@/core/project'
import { Optimizer, RunLimits, applyParams, entryValue, extractParams, isEntryActive, type ParamSpace } from './optimizer'

const EXAMPLE = {
  width: 64,
  height: 64,
  tileable: true,
  heightDepth: 8,
  layers: [
    { id: 'noise1', type: 'noise', params: { scale: 4, h_on: true, h_amount: 0.5, dif_on: true, dif_grad: { stops: [{ pos: 0, color: '#3b342e' }, { pos: 1, color: '#9a8c7a' }] } } },
    { id: 'rect1', type: 'rect', params: { inset_x: 8, inset_y: 8, radius: 6, bevel: 4, h_on: true, h_amount: 1, dif_on: true, dif_src: 'flat', dif_grad: { stops: [{ pos: 0, color: '#6d7f8f' }] } } },
  ],
  lighting: { lights: [{ id: 'sun', type: 'directional', params: { azimuth: 315, elevation: 35, intensity: 1.5 } }] },
  render: { maxSamples: 32 },
  post: [{ id: 'tm', type: 'tonemap' }],
}

const project = (): Project => normalizeProject(JSON.parse(JSON.stringify(EXAMPLE)))

function byId(space: ParamSpace, id: string) {
  const e = space.entries.find((x) => x.id === id)
  if (!e) throw new Error(`no entry ${id}: ${space.entries.map((x) => x.id).join(', ')}`)
  return e
}

describe('parameter space', () => {
  it('extracts numbers, colours and gradient stops from unlocked enabled layers', () => {
    const p = project()
    const space = extractParams(p)
    expect(space.size).toBe(space.initial.length)
    const scale = byId(space, 'layer:noise1:scale')
    expect(scale.log).toBe(true) // 0.25..64 soft range is multiplicative
    expect(entryValue(scale, space.initial)).toBeCloseTo(4, 3)
    const stop = byId(space, 'layer:noise1:dif_grad:1:color')
    expect(stop.dims).toBe(3)
    expect(entryValue(stop, space.initial)).toBe('#9a8c7a')
    byId(space, 'layer:noise1:dif_grad:1:pos')
    // A single-stop ramp has no position entry.
    expect(space.entries.some((e) => e.id === 'layer:rect1:dif_grad:0:pos')).toBe(false)
    // Pixel params are limited to the texture size.
    expect(byId(space, 'layer:rect1:radius').hi).toBeLessThanOrEqual(64)
    // Seeds, enums and bools are off by default; lights and post too.
    expect(space.entries.some((e) => e.kind === 'enum' || e.kind === 'seed')).toBe(false)
    expect(space.entries.some((e) => e.scope !== 'layer')).toBe(false)
    for (const x of space.initial) expect(Number.isFinite(x)).toBe(true)
  })

  it('skips locked and disabled layers', () => {
    const p = project()
    p.layers[0].locked = true
    expect(extractParams(p).entries.some((e) => e.owner === 'noise1')).toBe(false)
    const q = project()
    q.layers[1].enabled = false
    expect(extractParams(q).entries.some((e) => e.owner === 'rect1')).toBe(false)
  })

  it('round-trips without changing the project and never mutates its input', () => {
    const p = project()
    const before = JSON.stringify(p)
    const space = extractParams(p, { lights: true, post: true, base: true, enums: true, seeds: true })
    const q = applyParams(p, space, space.initial)
    expect(JSON.stringify(p)).toBe(before)
    const again = extractParams(q, space.options)
    expect(again.entries.map((e) => e.id)).toEqual(space.entries.map((e) => e.id))
    for (let i = 0; i < space.entries.length; i++) {
      expect(entryValue(again.entries[i], again.initial)).toEqual(entryValue(space.entries[i], space.initial))
    }
    const a = p.layers[0].params
    const b = q.layers[0].params
    expect(b.scale).toBeCloseTo(a.scale as number, 3)
    expect(b.dif_grad).toEqual(a.dif_grad)
    expect(q.lighting.lights[0].params.azimuth).toBeCloseTo(315, 2)
    expect(q.base.color).toBe(p.base.color)
  })

  it('optionally includes lights, post, base, enums and seeds', () => {
    const space = extractParams(project(), { lights: true, post: true, base: true, enums: true, seeds: true })
    const az = byId(space, 'light:sun:azimuth')
    expect(az.wrap).toBe(true)
    byId(space, 'post:tm:exposure')
    byId(space, 'base::color')
    byId(space, 'lighting::sky.intensity')
    const noiseType = byId(space, 'layer:noise1:noise')
    expect(noiseType.kind).toBe('enum')
    expect(byId(space, 'layer:noise1:seed').kind).toBe('seed')
    // Channel enables are structural, never tuned.
    expect(space.entries.some((e) => e.key === 'dif_on' || e.key === 'h_on')).toBe(false)
    const v = Float64Array.from(space.initial)
    v[noiseType.offset] = noiseType.options!.indexOf('worley')
    expect(applyParams(project(), space, v).layers[0].params.noise).toBe('worley')
  })

  it('maps vectors back to clamped values and sorted stops', () => {
    const p = project()
    const space = extractParams(p)
    const v = Float64Array.from(space.initial)
    v[byId(space, 'layer:noise1:dif_grad:0:pos').offset] = 0.9
    v[byId(space, 'layer:noise1:dif_grad:1:pos').offset] = 0.2
    v[byId(space, 'layer:noise1:scale').offset] = 1.7 // out of range → clamped
    const q = applyParams(p, space, v)
    const g = q.layers[0].params.dif_grad as Gradient
    expect(g.stops.map((s) => s.pos)).toEqual([0.2, 0.9])
    expect(g.stops[0].color).toBe('#9a8c7a') // colour travels with its stop
    expect(q.layers[0].params.scale).toBeCloseTo(64, 3)
  })

  it('knows which entries are inert', () => {
    const p = project()
    const space = extractParams(p)
    expect(isEntryActive(p, byId(space, 'layer:noise1:warp_scale'))).toBe(false) // warp = 0
    expect(isEntryActive(p, byId(space, 'layer:noise1:r_a'))).toBe(false) // roughness channel off
    expect(isEntryActive(p, byId(space, 'layer:noise1:h_amount'))).toBe(true)
    const v = Float64Array.from(space.initial)
    v[byId(space, 'layer:noise1:warp').offset] = 0.5
    expect(isEntryActive(applyParams(p, space, v), byId(space, 'layer:noise1:warp_scale'))).toBe(true)
  })

  it('ties the pattern params of same-type, same-seed copies and writes them together', () => {
    const shape = { columns: 4, rows: 8, mortar: 0.5, seed: 6 }
    const p = createProject({
      width: 64,
      height: 64,
      layers: [
        createLayer('bricks', { ...shape, bevel: 0, h_amount: 0.6 }, 'Pillow'),
        createLayer('bricks', { ...shape, bevel: 4, h_amount: 0.5 }, 'Edges'),
        createLayer('bricks', { ...shape, h_on: false, dif_on: true }, 'Stone colour'),
        createLayer('bricks', { ...shape, seed: 7, h_on: false }, 'Other pattern'),
      ],
    })
    const [pillow, edges, colour, other] = p.layers
    const space = extractParams(p)
    const cols = space.entries.filter((e) => e.key === 'columns')
    // One tied entry for the three seed-6 copies, one for the seed-7 pattern.
    expect(cols.map((e) => e.owner).sort()).toEqual([pillow.id, other.id].sort())
    const tied = cols.find((e) => e.owner === pillow.id)!
    expect(tied.tied).toEqual([edges.id, colour.id])
    expect(tied.label).toContain('linked')
    // Params the copies differ in stay separate.
    expect(space.entries.filter((e) => e.key === 'h_amount').map((e) => e.owner)).toEqual(expect.arrayContaining([pillow.id, edges.id]))
    const v = Float64Array.from(space.initial)
    v[tied.offset] = 1
    const q = applyParams(p, space, v)
    const after = q.layers.map((l) => l.params.columns)
    expect(after[0]).toBe(after[1])
    expect(after[0]).toBe(after[2])
    expect(after[0]).not.toBe(4)
    expect(after[3]).toBe(4)
  })
})

describe('Optimizer', () => {
  // Synthetic loss: distance to a hidden target in parameter space (cheap stand-in for render + metrics).
  function syntheticLoss() {
    const target = project()
    target.layers[0].params.scale = 9
    target.layers[0].params.h_amount = 1.1
    target.layers[1].params.inset_x = 14
    ;(target.layers[0].params.dif_grad as Gradient).stops[1].color = '#c0a080'
    const space = extractParams(target)
    const goal = space.initial
    const keys = ['layer:noise1:scale', 'layer:noise1:h_amount', 'layer:rect1:inset_x', 'layer:noise1:dif_grad:1:color']
    const entries = keys.map((k) => byId(space, k))
    return (p: Project) => {
      const v = extractParams(p).initial
      let s = 0
      for (const e of entries) for (let d = 0; d < e.dims; d++) s += (v[e.offset + d] - goal[e.offset + d]) ** 2
      return Math.sqrt(s)
    }
  }

  it('reduces the loss and is deterministic for a seed', async () => {
    const loss = syntheticLoss()
    const run = async (seed: number) => {
      const opt = new Optimizer(project(), loss, { seed, lambda: 4 })
      const l0 = await opt.init()
      await opt.run(150)
      return { l0, opt }
    }
    const a = await run(3)
    console.log(`synthetic loss ${a.l0.toFixed(3)} → ${a.opt.best.loss.toFixed(3)}`)
    expect(a.opt.best.loss).toBeLessThan(a.l0 * 0.35)
    expect(a.opt.history.length).toBe(150)
    expect(a.opt.evaluations).toBeGreaterThanOrEqual(1 + 150 * 4)
    const curve = a.opt.lossCurve
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeLessThanOrEqual(curve[i - 1])
    const b = await run(3)
    expect(b.opt.lossCurve).toEqual(curve)
    expect(JSON.stringify(b.opt.best.project.layers.map((l) => l.params))).toBe(JSON.stringify(a.opt.best.project.layers.map((l) => l.params)))
    const c = await run(4)
    expect(c.opt.lossCurve).not.toEqual(curve)
  })

  it('never touches locked layers and keeps the input project intact', async () => {
    const p = project()
    p.layers[1].locked = true
    const before = JSON.stringify(p)
    const opt = new Optimizer(p, syntheticLoss(), { seed: 1, structural: true, structuralRate: 0.3 })
    await opt.run(40)
    expect(JSON.stringify(p)).toBe(before)
    const rect = opt.best.project.layers.find((l) => l.id === 'rect1')!
    expect(JSON.stringify(rect)).toBe(JSON.stringify(p.layers[1]))
  })

  it('restarts after stagnation and reports it', async () => {
    const opt = new Optimizer(project(), () => 1, { seed: 2, restartAfter: 3 })
    const steps = await opt.run(10)
    expect(steps.some((s) => s.restarted)).toBe(true)
    // Neutral moves are accepted (drift) but never count as improvements.
    expect(steps.every((s) => !s.improved)).toBe(true)
  })

  it('applies structural mutations when they help', async () => {
    // Loss rewards an extra enabled noise layer and a "multiply" blend on the bottom layer.
    const loss = (p: Project) => {
      const enabled = p.layers.filter((l) => l.enabled)
      let s = Math.abs(enabled.length - 3)
      if (p.layers[0].params.dif_blend !== 'multiply') s += 0.5
      return s
    }
    const opt = new Optimizer(project(), loss, { seed: 5, structural: true, structuralRate: 0.5 })
    await opt.run(60)
    expect(opt.best.loss).toBe(0)
    expect(opt.history.some((h) => h.structural)).toBe(true)
    expect(opt.best.project.layers.length).toBeLessThanOrEqual(5)
  })

  it('runs islands with successive halving', async () => {
    const opt = new Optimizer(project(), syntheticLoss(), { seed: 1, islands: 4, islandSteps: 3 })
    const l0 = await opt.init()
    const steps = await opt.run(40)
    expect(new Set(steps.slice(0, 12).map((s) => s.island)).size).toBe(4)
    expect(steps[0].islands).toBe(4)
    expect(steps[steps.length - 1].islands).toBe(1)
    expect(opt.best.loss).toBeLessThan(l0)
    const again = new Optimizer(project(), syntheticLoss(), { seed: 1, islands: 4, islandSteps: 3 })
    await again.run(40)
    expect(again.lossCurve).toEqual(opt.lossCurve)
  })

  it('treats evaluation errors as infinitely bad', async () => {
    let n = 0
    const opt = new Optimizer(project(), () => {
      n++
      if (n > 1 && n % 2 === 0) throw new Error('boom')
      return 1 / n
    }, { seed: 1 })
    const info = await opt.step()
    expect(Number.isFinite(info.bestLoss)).toBe(true)
  })

  it('refuses an empty space', () => {
    const p = project()
    for (const l of p.layers) l.locked = true
    expect(() => new Optimizer(p, () => 0)).toThrow(/Nothing to optimise/)
  })
})

describe('stop criteria', () => {
  it('stops at the target loss, a step budget or an evaluation budget', async () => {
    let n = 0
    // Loss falls by 0.1 per evaluation: 1.0, 0.9, 0.8, …
    const falling = () => Math.max(0, 1 - 0.1 * n++)
    const opt = new Optimizer(project(), falling, { seed: 1, lambda: 2 })
    const out = await opt.runUntil({ targetLoss: 0.45, steps: 100 })
    expect(out.reason).toBe('target')
    expect(opt.best.loss).toBeLessThanOrEqual(0.45)
    expect((await opt.runUntil({ steps: 2 })).steps).toHaveLength(2)
    const e = opt.evaluations
    expect((await opt.runUntil({ evaluations: e + 3 })).reason).toBe('evaluations')
    expect(opt.evaluations).toBeGreaterThanOrEqual(e + 3)
  })

  it('stops when stalled, on time, and does nothing when already at the target', async () => {
    const opt = new Optimizer(project(), () => 0.5, { seed: 1, lambda: 2 })
    const stalled = await opt.runUntil({ patience: 5, steps: 100 })
    expect(stalled.reason).toBe('stalled')
    expect(stalled.steps).toHaveLength(5)
    expect((await opt.runUntil({ timeMs: 0 })).steps).toHaveLength(0)
    expect((await opt.runUntil({ targetLoss: 0.6 })).reason).toBe('target')
    const ac = new AbortController()
    ac.abort()
    expect((await opt.runUntil({ steps: 10 }, { signal: ac.signal })).reason).toBe('aborted')
  })

  it('counts real progress only for patience', () => {
    const l = new RunLimits({ patience: 2, minImprovement: 0.01 }, 1)
    expect(l.after(0.995, 1)).toBe(null) // too small to count
    expect(l.after(0.95, 2)).toBe(null) // progress: resets
    expect(l.after(0.949, 3)).toBe(null)
    expect(l.after(0.948, 4)).toBe('stalled')
  })
})
