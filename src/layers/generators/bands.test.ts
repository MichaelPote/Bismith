// Bands (FR7.2b): the editor's fresh layer stays within the params' ranges at every texture size, the Direction
// options map to frame rotations in 45° steps (the shader passes the option index straight to geo_frame), and a plain
// layer is the tech-wall look (staggered, varied Z steps between lower rails).

import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import { createLayer, freshParams, layerParamDefs } from '../registry'

ensureBuiltins()
const defs = new Map(layerParamDefs('bands').map((d) => [d.key, d]))

describe('bands', () => {
  it('sizes a fresh layer to the texture within the param ranges', () => {
    for (const [width, height] of [[16, 16], [64, 64], [512, 512], [2048, 2048], [256, 64], [64, 256], [1024, 32]]) {
      const p = freshParams('bands', { width, height })
      for (const [k, v] of Object.entries(p)) {
        const d = defs.get(k)
        expect(d, `${k} is a bands param`).toBeDefined()
        if (typeof v === 'number') {
          if (d!.min !== undefined) expect(v, `${k} at ${width}×${height}`).toBeGreaterThanOrEqual(d!.min)
          if (d!.max !== undefined) expect(v, `${k} at ${width}×${height}`).toBeLessThanOrEqual(d!.max)
        }
      }
      // The band and its margins fit a lane, leaving room for the rise.
      const lane = height / Number(p.rows)
      expect(Number(p.width) + Number(p.margin_top) + Number(p.margin_bottom)).toBeLessThan(lane)
    }
    expect(freshParams('bands', { width: 512, height: 512 })).toMatchObject({ rows: 3, count: 2, width: 32, rail: 17 })
    expect(freshParams('bands', { width: 256, height: 64 }).rows).toBe(1)
  })

  it('maps every Direction option to its rotation in 45° steps', () => {
    const opts = defs.get('orient')!.options!.map((o) => o.value)
    opts.forEach((v, i) => expect(Number(v)).toBe(i * 45))
    for (const v of ['0', '90', '180', '270']) expect(opts).toContain(v)
  })

  it('makes the tech-wall look by default, the same as a fresh 512 px layer', () => {
    const p = createLayer('bands').params
    expect(p).toMatchObject({ mode: 'z', rail_h: 0.7, keep_angle: true, even: true, run_var: 0.5, rise_var: 0.6, stagger: 0.7, profile: 'custom', dif_src: 'random' })
    expect(p).toMatchObject({ width_var: 0, jitter: 0, jitter_piece: 0, skip: 0, amp: 1, fill: 'band', orient: '0' })
    const { r_src, s_src, ...sized } = freshParams('bands', { width: 512, height: 512 })
    expect(r_src).toBe('shape')
    expect(s_src).toBe('shape')
    expect(p).toMatchObject(sized)
  })
})
