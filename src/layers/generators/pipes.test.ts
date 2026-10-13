import { describe, expect, it } from 'vitest'
import { Coverage, PRIM_ARC, PRIM_LINE, buildPrims, encodePrims, parseRuns, randomRuns, runLevel, runPrims, rng, yAt, type PipeOptions } from './pipesGeometry'
import { pipeRuns } from './pipes'

const opts: PipeOptions = { width: 128, height: 128, tile: true, seed: 3, bend: 2, spacing: 40, flanges: 0.3, collar: 0.15, elbowFittings: true }

describe('pipe geometry', () => {
  it('fillets a right-angle corner with an arc that meets both straight lengths', () => {
    const prims = runPrims({ points: [[0, 20], [60, 20], [60, 100]], radius: 5, depth: 0, capStart: false, capEnd: false }, 1, { ...opts, spacing: 0 }, rng(1))
    const arc = prims.find((p) => p.kind === PRIM_ARC)!
    const lines = prims.filter((p) => p.kind === PRIM_LINE)
    expect(lines).toHaveLength(2)
    expect(arc.bend).toBeCloseTo(10)
    // The arc starts where the first length ends and sweeps a quarter turn to where the second begins.
    expect(arc.x + arc.bend * Math.cos(arc.a0)).toBeCloseTo(lines[0].x1)
    expect(arc.y + arc.bend * Math.sin(arc.a0)).toBeCloseTo(lines[0].y1)
    expect(arc.x + arc.bend * Math.cos(arc.a0 + arc.sweep)).toBeCloseTo(lines[1].x)
    expect(arc.y + arc.bend * Math.sin(arc.a0 + arc.sweep)).toBeCloseTo(lines[1].y)
    expect(Math.abs(arc.sweep)).toBeCloseTo(Math.PI / 2)
  })

  it('lays out tileable runs that span exactly one period', () => {
    const runs = randomRuns(opts, { runs: 3, drops: 2, radius: 5, variety: 0.3, jogs: 1, tees: 0 })
    expect(runs.length).toBeGreaterThanOrEqual(4)
    for (const r of runs) {
      const a = r.points[0]
      const b = r.points[r.points.length - 1]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      expect((Math.abs(dx - 128) < 1e-6 && Math.abs(dy) < 1e-6) || (Math.abs(dy - 128) < 1e-6 && Math.abs(dx) < 1e-6)).toBe(true)
    }
  })

  it('copies primitives across the edges when tiling, and encodes a header', () => {
    const runs = randomRuns(opts, { runs: 2, drops: 1, radius: 5, variety: 0, jogs: 0, tees: 0 })
    const prims = buildPrims(runs, opts)
    const flat = buildPrims(runs, { ...opts, tile: false })
    expect(prims.length).toBeGreaterThan(flat.length)
    const tex = encodePrims(prims)
    expect(tex.width).toBe(1 + 5 * prims.length)
    expect((tex.data[0] << 8) | tex.data[1]).toBe(prims.length)
  })

  it('parses drawn runs and tees an end that lands on another run', () => {
    expect(parseRuns('0,0 1,0 | 0.5,0 0.5,1', true, 64, 32)).toEqual([[[0, 0], [64, 0]], [[32, 0], [32, 32]]])
    const runs = pipeRuns({ layout: 'drawn', points: '0,32 64,32 | 32,32 32,64', radius: 4, variety: 0 }, { ...opts, width: 64, height: 64, tile: false })
    expect(runs[1].teeStart).toBe(4)
    expect(runs[1].capStart).toBe(false)
  })

  it('tees branches into the runs at their actual height, clear of jogs', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const o = { ...opts, seed }
      const runs = randomRuns(o, { runs: 3, drops: 4, radius: 5, variety: 0.2, jogs: 1, tees: 1 })
      const horizontal = runs.filter((r) => r.depth === 0 && r.teeStart === undefined)
      for (const t of runs.filter((r) => r.teeStart !== undefined)) {
        const [x, y0] = t.points[0]
        const [, y1] = t.points[1]
        const ys = horizontal.map((h) => yAt(h.points, x, 128, true, 0)).filter((y) => y !== null)
        expect(ys).toContain(y0)
        expect(ys).toContain(y1)
      }
    }
  })

  it('stacks runs that find no room over the ones they overlap instead of dropping them', () => {
    const runs = randomRuns(opts, { runs: 24, drops: 24, radius: 5, variety: 0.2, jogs: 0.5, tees: 0 })
    expect(runs).toHaveLength(48)
    const horizontal = runs.slice(0, 24)
    expect(horizontal.some((r) => r.depth > 0)).toBe(true)
    // Verticals stand in front of every horizontal run.
    const front = Math.max(...horizontal.map((r) => r.depth + r.radius))
    for (const v of runs.slice(24)) expect(v.depth).toBeGreaterThanOrEqual(front - 1e-9)
  })

  it('fills the wall with stacked layers as density rises; density 0 is the plain layout', () => {
    const layout = { runs: 2, drops: 1, radius: 5, variety: 0.2, jogs: 0.5, tees: 0.5 }
    const covered = (runs: ReturnType<typeof randomRuns>) => {
      const c = new Coverage(128, 128, true)
      for (const r of runs) c.add(r)
      return c.fraction()
    }
    const plain = randomRuns(opts, layout)
    expect(randomRuns(opts, { ...layout, density: 0 })).toEqual(plain)
    const half = randomRuns(opts, { ...layout, density: 0.5 })
    const full = randomRuns(opts, { ...layout, density: 1 })
    expect(half.slice(0, plain.length)).toEqual(plain)
    expect(covered(half)).toBeGreaterThanOrEqual(covered(plain) + 0.5 * (1 - covered(plain)) - 1e-3)
    expect(covered(full)).toBeGreaterThan(0.999)
    // The added layers stand in front of the plain layout.
    const plainTop = Math.max(...plain.map((r) => r.depth))
    for (const r of full.slice(plain.length)) expect(r.depth).toBeGreaterThan(plainTop)
  })

  it('keeps the liquid surface level through bends, pooled in the lowest length, shared by branches', () => {
    const o = { ...opts, tile: false, fill: 0.5 }
    // Down a drop to a lower length: the surface is set by the lower length's middle; the upper length stays empty.
    const jog = { points: [[0, 20], [60, 20], [60, 80], [128, 80]] as [number, number][], radius: 6, depth: 0, capStart: false, capEnd: false }
    expect(runLevel(jog, o)).toBeCloseTo(80)
    expect(runLevel({ ...jog, points: [[0, 80], [60, 80], [60, 20], [128, 20]] }, o)).toBeCloseTo(80)
    // A branch takes the surface of the pipe it tees into.
    const main = { points: [[0, 60], [128, 60]] as [number, number][], radius: 8, depth: 0, capStart: false, capEnd: false }
    const branch = { points: [[64, 60], [64, 0]] as [number, number][], radius: 6, depth: 0, capStart: false, capEnd: true, teeStart: 8, joins: [0] }
    const prims = buildPrims([main, branch], o)
    expect(new Set(prims.map((p) => Math.round(p.level)))).toEqual(new Set([60]))
  })
})
