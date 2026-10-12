import { describe, expect, it } from 'vitest'
import { KING, traceLinks, type TraceLinkOptions } from './traceLinks'

const base: TraceLinkOptions = { mode: 'route', nx: 20, ny: 16, wrap: true, seed: 1234, density: 0.8, diagonal: 0.5, bias: 0.5, straight: 0.6, grouping: 0.7, block: 3, vias: 0.2 }

/** Every drawn segment as [from x, from y, to x, to y] (to unwrapped). */
function segments(o: TraceLinkOptions): number[][] {
  const { links } = traceLinks(o)
  const out: number[][] = []
  for (let y = 0; y < o.ny; y++)
    for (let x = 0; x < o.nx; x++)
      for (let d = 0; d < 8; d++) if (links[y * o.nx + x] & (1 << d)) out.push([x, y, x + KING[d][0], y + KING[d][1]])
  return out
}

function degrees(o: TraceLinkOptions): number[] {
  const deg = new Array(o.nx * o.ny).fill(0)
  const wrap = (x: number, y: number) => (((y % o.ny) + o.ny) % o.ny) * o.nx + (((x % o.nx) + o.nx) % o.nx)
  for (const [x0, y0, x1, y1] of segments(o)) {
    deg[wrap(x0, y0)]++
    deg[wrap(x1, y1)]++
  }
  return deg
}

/** Grid squares (by lower-left node) holding both diagonals. */
function crossings(o: TraceLinkOptions): number {
  const slash = new Set<string>()
  const back = new Set<string>()
  for (const [x0, y0, x1, y1] of segments(o)) {
    if (x0 === x1 || y0 === y1) continue
    const key = `${(Math.min(x0, x1) + o.nx) % o.nx},${(Math.min(y0, y1) + o.ny) % o.ny}`
    ;((x1 - x0) * (y1 - y0) > 0 ? slash : back).add(key)
  }
  return [...slash].filter((k) => back.has(k)).length
}

describe('trace links', () => {
  for (const mode of ['route', 'maze'] as const) {
    const o = { ...base, mode }

    it(`${mode}: is deterministic and draws a fair share of the board`, () => {
      expect(Array.from(traceLinks(o).links)).toEqual(Array.from(traceLinks(o).links))
      expect(segments(o).length).toBeGreaterThan(o.nx * o.ny * 0.2)
    })

    it(`${mode}: never crosses diagonals in one grid square`, () => {
      expect(crossings(o)).toBe(0)
      expect(crossings({ ...o, wrap: false, seed: 7 })).toBe(0)
    })

    it(`${mode}: keeps every link on the board when not tiling`, () => {
      for (const [, , x, y] of segments({ ...o, wrap: false })) {
        expect(x >= 0 && y >= 0 && x < o.nx && y < o.ny).toBe(true)
      }
    })

    it(`${mode}: flags trace ends (degree 1) and puts vias only on traces`, () => {
      const { flags } = traceLinks(o)
      const deg = degrees(o)
      for (let i = 0; i < deg.length; i++) {
        expect(Boolean(flags[i] & 1)).toBe(deg[i] === 1)
        if (flags[i] & 2) expect(deg[i]).toBeGreaterThan(0)
      }
    })
  }

  it('route: traces are paths (at most one link in and one out per node)', () => {
    const deg = degrees(base)
    expect(Math.max(...deg)).toBeLessThanOrEqual(2)
    const { links } = traceLinks(base)
    for (const m of links) expect(m & (m - 1)).toBe(0)
  })
})
