// Editor defaults for new layers (freshParams): shape layers take roughness and specular from their shape; code-built
// layers keep the plain defaults.

import { describe, expect, it } from 'vitest'
import { ensureBuiltins } from '@/render/builtins'
import { createLayer, freshParams } from './registry'

describe('freshParams', () => {
  ensureBuiltins()
  const tex = { width: 128, height: 128 }

  it('drives a shape layer’s roughness and specular from its shape', () => {
    for (const type of ['rect', 'wood', 'bricks', 'chips']) {
      expect(freshParams(type, tex), type).toMatchObject({ r_src: 'shape', s_src: 'shape' })
    }
  })

  it('keeps Pattern on layers without a shape (or with a mask-only one) and adds the type’s own defaults', () => {
    expect(freshParams('noise', tex).r_src).toBeUndefined()
    expect(freshParams('drips', tex).r_src).toBeUndefined()
    expect(freshParams('wood', tex)).toMatchObject({ ring_px: 4, gap: 1 })
  })

  it('leaves layers built in code on the plain default', () => {
    expect(createLayer('wood').params.r_src).toBe('value')
  })
})
