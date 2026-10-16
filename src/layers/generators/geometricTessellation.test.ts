// Tessellation (FR7.2b): the CPU side — defaults (editor ones sized to the texture, linked ones following the tiling
// and the shift), the Tiles recipe's level tiles, and the param ranges the shader's fixed loop and clamps rely on.

import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import { createProject } from '@/core/serialize'
import { addMaterial, setMacro } from '@/recipes'
import { createLayer, freshParams, layerParamDefs, linkedChanges } from '../registry'
import { tessellationLayer } from './geometricTessellation'

describe('tessellation', () => {
  ensureBuiltins()
  const glsl = tessellationLayer.glsl!
  const def = (key: string) => layerParamDefs('tessellation').find((d) => d.key === key)!

  it('sizes a new layer’s joints and bevel to the texture', () => {
    expect(freshParams('tessellation', { width: 512, height: 512 })).toMatchObject({ gap: 2, bevel: 3, laid: 0.8 })
    expect(freshParams('tessellation', { width: 2048, height: 2048 })).toMatchObject({ gap: 8, bevel: 12 })
    // Never below a pixel; a trim follows its short side.
    expect(freshParams('tessellation', { width: 32, height: 32 })).toMatchObject({ gap: 1, bevel: 1, laid: 0.3 })
    expect(freshParams('tessellation', { width: 1024, height: 128 })).toMatchObject({ gap: 1, bevel: 1 })
  })

  it('starts as solid, regular, raised blocks', () => {
    // Scale 7 on a square texture: 7 / √3 ≈ 4.04 rows, so with Keep tile shape the blocks come out regular.
    expect(createLayer('tessellation').params).toMatchObject({
      mode: 'rhombille', scale: 7, fit: true, block_j: 0, crease: 0.25, block_iso: 0.5, bevel: 3, h_var: 0.3, tilt: 0.5, crown: 0.3,
      laid: 0, laid_turn: 0, size_var: 0, missing: 0, only: 'all', only_inv: false, kind_w: 1,
    })
  })

  it('turns tiles as far as it shifts them until the turn is set by hand', () => {
    expect(createLayer('tessellation', { laid: 2 }).params.laid_turn).toBe(2)
    expect(createLayer('tessellation', freshParams('tessellation', { width: 512, height: 512 })).params.laid_turn).toBe(0.8)
    const p = createLayer('tessellation', { laid: 2 }).params
    expect(linkedChanges('tessellation', p, 'laid', 0).laid_turn).toBe(0)
    expect(linkedChanges('tessellation', { ...p, laid_turn: 5 }, 'laid', 0).laid_turn).toBeUndefined()
  })

  it('gives the Tiles recipe level tiles (its macros make the relief), tumbling blocks as rhombi with joints', () => {
    for (const pattern of ['squares', 'herringbone', 'basketweave', 'bone', 'plus', 'rhombille', 'diagonal']) {
      const p = createProject({ width: 64, height: 64, layers: [] })
      const m = addMaterial(p, 'tiles')
      setMacro(p, m, 'pattern', pattern)
      const tess = p.layers.filter((l) => l.type === 'tessellation')
      expect(tess.length, pattern).toBeGreaterThan(0)
      for (const l of tess) {
        expect(l.params, `${pattern}/${l.name}`).toMatchObject({ tilt: 0, crown: 0, laid: 0 })
        if (pattern === 'rhombille') expect(l.params, l.name).toMatchObject({ block_j: 1, block_iso: 0 })
      }
    }
  })

  it('weighs the tile kind by tiling until Kind contrast is set by hand', () => {
    // Kinds that make the motif keep their tones; checker squares are per tile, H / V bricks lean slightly by kind.
    expect(createLayer('tessellation', { mode: 'octagon' }).params.kind_w).toBe(0.8)
    expect(createLayer('tessellation', { mode: 'squares' }).params.kind_w).toBe(0)
    const blocks = createLayer('tessellation').params
    expect(linkedChanges('tessellation', blocks, 'mode', 'herringbone').kind_w).toBe(0.35)
    expect(linkedChanges('tessellation', { ...blocks, kind_w: 0.5 }, 'mode', 'herringbone').kind_w).toBeUndefined()
    for (const o of def('mode').options!) expect(tessellationLayer.linkedDefaults!({ mode: o.value }).kind_w, o.value).toBeTypeOf('number')
  })

  it('has no continue in its shader (ANGLE / D3D11 has miscompiled it in loops)', () => {
    expect(/\bcontinue\s*;/.test(glsl)).toBe(false)
  })

  it('uses every param it declares', () => {
    for (const d of tessellationLayer.params) if (d.key !== 'seed') expect(glsl.includes(`u_${d.key}`), `u_${d.key} unused`).toBe(true)
  })

  it('fits the longest herringbone in the shader’s loop, and clamps the ratio where the param ends', () => {
    const max = def('ratio').max!
    expect(Number(/clamp\(u_ratio, 1, (\d+)\)/.exec(glsl)![1])).toBe(max)
    const bound = Number(/it < (\d+) \* TESS_1/.exec(glsl)![1])
    // Two shapes (horizontal, vertical brick) of 3 × (n / 2 + 4) anchors, one step per shape change and the last check.
    const steps = 2 * 3 * (Math.floor(max / 2) + 4) + 3
    expect(steps).toBeLessThanOrEqual(bound)
  })

  it('offers a kind filter for every kind a tiling has (plus: five)', () => {
    expect(def('only').options!.map((o) => o.value)).toEqual(['all', '1', '2', '3', '4', '5'])
  })
})
