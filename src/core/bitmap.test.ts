import { describe, expect, it } from 'vitest'
import { BITMAP_MAX, packBitmap, packPolygons, parseBitmap, parsePolygons, textBitmap } from './bitmap'

describe('parseBitmap', () => {
  it('maps cell characters to levels and trims blank edge rows', () => {
    const b = parseBitmap('\n#+-.\n 1 2\n\n')
    expect(b.width).toBe(4)
    expect(b.height).toBe(2)
    expect([...b.levels]).toEqual([3, 2, 1, 0, 0, 1, 0, 2])
  })

  it('caps at 64×64', () => {
    const b = parseBitmap(Array.from({ length: 80 }, () => '#'.repeat(80)).join('\n'))
    expect(b.width).toBe(BITMAP_MAX)
    expect(b.height).toBe(BITMAP_MAX)
  })
})

describe('packBitmap', () => {
  it('packs 2 bits per cell, 16 cells per int, 4 ints per row', () => {
    const b = parseBitmap('#.+' + '.'.repeat(14) + '-\n.#')
    const p = packBitmap(b)
    expect(p.length).toBe(BITMAP_MAX * 4)
    expect(p[0]).toBe(3 | (2 << 4)) // cells 0 and 2 of row 0
    expect(p[1]).toBe(1 << 2) // cell 17 → second int, slot 1
    expect(p[4]).toBe(3 << 2) // row 1, cell 1
  })

  it('round-trips the sign bit of the 16th cell', () => {
    const p = packBitmap(parseBitmap('.'.repeat(15) + '#'))
    expect((p[0] >> 30) & 3).toBe(3)
  })
})

describe('textBitmap', () => {
  it('renders 5-row glyphs with 1 px letter spacing', () => {
    const b = textBitmap('03')
    expect(b.height).toBe(5)
    expect(b.width).toBe(7)
    const row0 = [...b.levels.slice(0, 7)].map((v) => (v ? '#' : '.')).join('')
    expect(row0).toBe('###.###')
  })

  it('centres multiple lines', () => {
    const b = textBitmap('M|1')
    expect(b.width).toBe(5)
    expect(b.height).toBe(11)
  })
})

describe('polygons', () => {
  it('parses vertex pairs per line and links each vertex to the next in its polygon', () => {
    const polys = parsePolygons('0,0 10,0 10,10\n20,20, 30,20 30,30 20,30')
    expect(polys).toEqual([
      [[0, 0], [10, 0], [10, 10]],
      [[20, 20], [30, 20], [30, 30], [20, 30]],
    ])
    const { data, count, polygons } = packPolygons(polys)
    expect(count).toBe(7)
    expect(polygons).toBe(2)
    expect([...data.slice(0, 4)]).toEqual([0, 0, 1, 0])
    expect(data[2 * 4 + 2]).toBe(0) // last vertex of polygon 0 closes back to vertex 0
    expect(data[6 * 4 + 2]).toBe(3) // last vertex of polygon 1 closes back to vertex 3
    expect(data[6 * 4 + 3]).toBe(1)
  })

  it('drops degenerate polygons and accepts negative / decimal coordinates', () => {
    expect(parsePolygons('1,2 3,4 | -5.5,0 4,0 0,7.25')).toEqual([[[-5.5, 0], [4, 0], [0, 7.25]]])
  })
})
