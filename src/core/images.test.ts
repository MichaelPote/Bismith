import { describe, expect, it } from 'vitest'
import { getImage, hasImage, imageUrl, imagesVersion, putImage } from './images'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAA'

describe('images', () => {
  it('keeps images by file name, replacing one loaded again under the same name', () => {
    const v0 = imagesVersion()
    putImage('decal.png', PNG, false)
    expect(hasImage('decal.png')).toBe(true)
    expect(imageUrl('decal.png')).toBe(PNG)
    expect(imagesVersion()).toBeGreaterThan(v0)
    const v1 = imagesVersion()
    putImage('decal.png', PNG, false) // the same image: nothing changes
    expect(imagesVersion()).toBe(v1)
    putImage('decal.png', PNG2, false)
    expect(imageUrl('decal.png')).toBe(PNG2)
    expect(imagesVersion()).toBeGreaterThan(v1)
  })

  it('takes only image data URLs, and has nothing for an unknown name', () => {
    putImage('x.txt', 'data:text/plain;base64,aGk=', false)
    expect(hasImage('x.txt')).toBe(false)
    expect(getImage('nowhere.png')).toBeNull()
  })
})
