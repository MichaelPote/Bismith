import { describe, expect, it } from 'vitest'
import { ROUTE_DIRS, routeTraces, type RouteOptions } from './router'

const base: RouteOptions = { nx: 24, ny: 24, wrap: true, seed: 3, seeds: 3, seedLength: 60, minLength: 4, maxLength: 40, gap: 1, straight: 0.75, directions: 8, hug: 0.6, fill: 1, vias: 0.05 }

describe('circuit router', () => {
  it('is deterministic and fills the board with several traces', () => {
    const a = routeTraces(base)
    const b = routeTraces(base)
    expect(Array.from(a.out)).toEqual(Array.from(b.out))
    expect(a.traces).toBeGreaterThan(5)
    const used = a.owner.filter((t) => t !== 0).length
    expect(used / (24 * 24)).toBeGreaterThan(0.2)
  })

  it('never lets two traces touch (one free node between them)', () => {
    const r = routeTraces(base)
    const at = (x: number, y: number) => {
      const i = (((y % r.ny) + r.ny) % r.ny) * r.nx + (((x % r.nx) + r.nx) % r.nx)
      return r.flags[i] & 4 ? r.owner[i] : 0
    }
    for (let y = 0; y < r.ny; y++)
      for (let x = 0; x < r.nx; x++) {
        const t = at(x, y)
        if (!t) continue
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const u = at(x + dx, y + dy)
          expect(u === 0 || u === t, `traces ${t} and ${u} touch at ${x},${y}`).toBe(true)
        }
      }
  })

  it('links only to nodes of the same trace, and ends carry pads', () => {
    const r = routeTraces({ ...base, directions: 6 })
    for (let i = 0; i < r.out.length; i++) {
      const d = r.out[i]
      if (d < 0) continue
      expect([0, 2, 6, 8, 10, 14]).toContain(d) // the 6-direction set only (no verticals, no knight moves)
      const [dx, dy] = ROUTE_DIRS[d]
      const x = (i % r.nx) + dx
      const y = Math.floor(i / r.nx) + dy
      const j = (((y % r.ny) + r.ny) % r.ny) * r.nx + (((x % r.nx) + r.nx) % r.nx)
      expect(r.owner[j]).toBe(r.owner[i])
    }
    expect(Array.from(r.flags).some((f) => f & 1)).toBe(true)
  })

  it('breaks traces into pad-ended pieces with room around every pad', () => {
    const opts: RouteOptions = { ...base, nx: 40, ny: 40, gap: 0, seedLength: 160, maxLength: 80, minLength: 3, hug: 0.7 }
    const pads = (r: ReturnType<typeof routeTraces>) => Array.from(r.flags).filter((f) => f & 1).length
    const none = routeTraces({ ...opts, pins: 0 })
    const many = routeTraces({ ...opts, pins: 0.3 })
    expect(pads(many)).toBeGreaterThan(1.3 * pads(none))
    const wrap = (x: number, y: number) => (((y % many.ny) + many.ny) % many.ny) * many.nx + (((x % many.nx) + many.nx) % many.nx)
    for (let i = 0; i < many.flags.length; i++) {
      if (!(many.flags[i] & 1)) continue
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = wrap((i % many.nx) + dx, Math.floor(i / many.nx) + dy)
          // No other trace's node beside a pad, and no pad right beside another (the dropped node separates them).
          if (many.flags[j] & 4) expect(many.owner[j]).toBe(many.owner[i])
          if (j !== i && many.flags[j] & 1) expect.fail(`pads touch at ${i} and ${j}`)
        }
    }
  })
})
