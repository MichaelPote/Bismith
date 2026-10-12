import { describe, expect, it } from 'vitest'
import { hexToRgb, linearToOklab, linearToSrgb1, oklabToLinear, rgbToHex, srgbToLinear1 } from './color'
import { P, evalCurve, sanitizeParams, sanitizeValue } from './params'
import { createProject, normalizeProject, projectFromJSON, projectToJSON } from './serialize'
import { stackOrder } from './project'
import { crc32, zipStore } from './zip'

describe('color', () => {
  it('round-trips hex', () => {
    expect(rgbToHex(hexToRgb('#7a7570'))).toBe('#7a7570')
    expect(hexToRgb('#fff')).toEqual([1, 1, 1])
    expect(hexToRgb('nope')).toEqual([0, 0, 0])
  })
  it('round-trips sRGB transfer for every 8-bit level', () => {
    for (let i = 0; i < 256; i++) {
      const v = i / 255
      expect(Math.round(linearToSrgb1(srgbToLinear1(v)) * 255)).toBe(i)
    }
  })
  it('round-trips OKLab', () => {
    const c: [number, number, number] = [0.2, 0.5, 0.8]
    const back = oklabToLinear(linearToOklab(c))
    back.forEach((v, i) => expect(v).toBeCloseTo(c[i], 5))
    expect(linearToOklab([1, 1, 1])[0]).toBeCloseTo(1, 4)
  })
})

describe('params', () => {
  const defs = [
    P.float('a', 'A', 0.5, 0, 1),
    P.int('n', 'N', 3, 1, 8),
    P.enum('e', 'E', 'x', [['x', 'X'], ['y', 'Y']]),
    P.color('c', 'C', '#ff0000'),
    P.gradient('g', 'G', { stops: [{ pos: 0, color: '#000000' }] }),
  ]
  it('clamps, rounds and defaults', () => {
    expect(sanitizeValue(defs[0], 4)).toBe(1)
    expect(sanitizeValue(defs[1], 2.6)).toBe(3)
    expect(sanitizeValue(defs[2], 'z')).toBe('x')
    expect(sanitizeValue(defs[3], '#ABCDEF')).toBe('#abcdef')
    const p = sanitizeParams(defs, { a: 'bad' as unknown as number, extra: 1 })
    expect(p).toEqual({ a: 0.5, n: 3, e: 'x', c: '#ff0000', g: { stops: [{ pos: 0, color: '#000000' }] } })
  })
  it('sorts and limits gradient stops', () => {
    const g = sanitizeValue(defs[4], { stops: [{ pos: 0.8, color: '#111111' }, { pos: 0.2, color: '#222222' }] })
    expect(g).toEqual({ stops: [{ pos: 0.2, color: '#222222' }, { pos: 0.8, color: '#111111' }] })
  })
})

describe('curves', () => {
  const steep = { points: [{ x: 0, y: 0 }, { x: 0.15, y: 0.55 }, { x: 0.45, y: 0.82 }, { x: 1, y: 1 }] }
  it('passes through its points and never overshoots a rising curve', () => {
    expect(evalCurve(steep, 0)).toBeCloseTo(0)
    expect(evalCurve(steep, 0.15)).toBeCloseTo(0.55)
    expect(evalCurve(steep, 1)).toBeCloseTo(1)
    let prev = -1
    for (let i = 0; i <= 200; i++) {
      const y = evalCurve(steep, i / 200)
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(y).toBeLessThanOrEqual(1 + 1e-9)
      prev = y
    }
  })
  it('allows rims and dishes: peaks and valleys sit exactly on their points, with no overshoot', () => {
    const rimDish = { points: [{ x: 0, y: 0 }, { x: 0.2, y: 1 }, { x: 0.6, y: 0.3 }, { x: 1, y: 0.5 }] }
    let max = 0
    let min = 1
    for (let i = 0; i <= 400; i++) {
      const y = evalCurve(rimDish, i / 400)
      if (i / 400 > 0.05) min = Math.min(min, y)
      max = Math.max(max, y)
    }
    expect(max).toBeCloseTo(1, 6)
    expect(min).toBeCloseTo(0.3, 6)
    expect(evalCurve(rimDish, 0.2)).toBeCloseTo(1)
    expect(evalCurve(rimDish, 0.6)).toBeCloseTo(0.3)
  })
  it('sanitises: clamps, sorts, drops duplicates, needs two points', () => {
    const d = P.curve('c', 'C', steep)
    expect(sanitizeValue(d, { points: [{ x: 1.5, y: 2 }, { x: -1, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.6 }] })).toEqual({
      points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
    })
    expect(sanitizeValue(d, { points: [{ x: 0.2, y: 0.2 }] })).toEqual(steep)
  })
})

describe('serialize', () => {
  it('round-trips a default project', () => {
    const p = createProject()
    const back = projectFromJSON(projectToJSON(p))
    expect(back).toEqual(p)
  })
  it('fills defaults and drops unknown types', () => {
    const p = normalizeProject({ width: 99999, layers: [{ type: 'noise' }, { type: 'does-not-exist' }], post: [{ type: 'tonemap' }] })
    expect(p.width).toBe(2048)
    expect(p.layers).toHaveLength(1)
    expect(p.layers[0].params.noise).toBe('perlin')
    expect(p.layers[0].params.h_on).toBe(true)
    expect(p.post[0].params.operator).toBe('aces')
    expect(p.lighting.sky.enabled).toBe(true)
  })
  it('keeps the relief stack separate and evaluates it first', () => {
    const p = normalizeProject({ relief: [{ type: 'bricks' }], layers: [{ type: 'noise' }] })
    expect(p.relief.map((l) => l.type)).toEqual(['bricks'])
    expect(stackOrder(p).map((l) => l.type)).toEqual(['bricks', 'noise'])
    expect(normalizeProject({ layers: [] }).relief).toEqual([])
  })
  it('migrates the old single specular setting to base level × render scale with the same F0', () => {
    const old = normalizeProject({ base: { color: '#806040' }, render: { specular: 0.8 } })
    expect(old.base.specular).toBe(0.5)
    expect(0.08 * old.base.specular * old.render.specular).toBeCloseTo(0.08 * 0.8)
    const off = normalizeProject({ render: { specular: 0 } })
    expect(off.base.specular * off.render.specular).toBe(0)
    const cur = normalizeProject({ base: { specular: 0.2 }, render: { specular: 1.5 } })
    expect([cur.base.specular, cur.render.specular]).toEqual([0.2, 1.5])
  })
})

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
  it('writes a valid end-of-central-directory record', () => {
    const z = zipStore([{ name: 'a.txt', data: new TextEncoder().encode('hello') }])
    const v = new DataView(z.buffer)
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50)
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(1)
  })
})

describe('supersampling', () => {
  it('scales pixel-unit params, point lists, height depth and AO radius; leaves counts and fractions alone', async () => {
    const { scaleProject, supersampleFactor } = await import('./supersample')
    const { createLayer, createProject } = await import('./serialize')
    const p = createProject({
      width: 64,
      height: 32,
      heightDepth: 2.5,
      relief: [createLayer('bricks', { columns: 4, mortar: 1.5, bevel: 2 })],
      layers: [createLayer('path', { points: '8,16 24,8 56,8' }), createLayer('noise', { noise: 'white', block: 1, scale: 6 })],
    })
    p.render.supersample = 3
    expect(supersampleFactor(p)).toBe(3)
    const q = scaleProject(p, 3)
    expect([q.width, q.height, q.heightDepth]).toEqual([192, 96, 7.5])
    expect(q.relief[0].params.columns).toBe(4)
    expect(q.relief[0].params.mortar).toBe(4.5)
    expect(q.relief[0].params.bevel).toBe(6)
    expect(q.layers[0].params.points).toBe('24,48 72,24 168,24')
    expect(q.layers[1].params.block).toBe(3)
    expect(q.layers[1].params.scale).toBe(6)
    expect(q.render.aoRadius).toBe(p.render.aoRadius * 3)
    expect(p.width).toBe(64) // input untouched
  })
})
