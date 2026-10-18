// Stamp and Label (FR7.5): hand-drawn pixel bitmaps and pixel-font text as shapes — crate insignia, painted
// emblems, panel numbers and warning lettering that no procedural motif can reproduce. Path and Polyline: polygons
// and open lines from vertex lists (the shape editor draws them).
//
// Stamp / Label: the CPU lays out the bitmap (mirror, text in one of two pixel fonts) and stores, per cell, the nearest
// cell of the other state (a jump flood), so the shader's signed distance — to the nearest cell of the other state —
// is exact at any bevel width from nine lookups. The cell level (1..3) is the per-feature random, so a Per-feature
// colour ramp paints multi-tone bitmaps; repeats can carry their own random instead.

import { MAX_PATH_POINTS, parsePolygons, textBitmap } from '@/core/bitmap'
import { P, type ParamDef, type ParamValues } from '@/core/params'
import type { CpuTexture, LayerDef } from '../types'
import { getImage } from '@/core/images'

// ------------------------------------------------------------------------------------------------ bitmaps (CPU)

/** A laid-out bitmap: row-major levels 0..3, top row first. */
export interface Cells {
  w: number
  h: number
  lv: Uint8Array
}

/** Stamp bitmaps: up to 128 × 128 cells. */
export const STAMP_MAX = 128
/** Label bitmaps: up to 256 cells across, 128 down. */
export const LABEL_MAX_W = 256
export const LABEL_MAX_H = 128

/** Cell character → level: '.', ' ', '0' empty · '-', '1' low · '+', '2' mid · anything else full. */
const levelOf = (ch: string) => (ch === '.' || ch === ' ' || ch === '0' ? 0 : ch === '-' || ch === '1' ? 1 : ch === '+' || ch === '2' ? 2 : 3)

/** Rows of cell characters (one row per line; blank lines at either end dropped). */
export function parseCells(src: string): Cells {
  const all = src.replace(/\r/g, '').split('\n')
  let a = 0
  let b = all.length
  while (a < b && all[a].trim() === '') a++
  while (b > a && all[b - 1].trim() === '') b--
  const rows = all.slice(a, b).slice(0, STAMP_MAX)
  const w = Math.min(STAMP_MAX, rows.reduce((m, r) => Math.max(m, r.replace(/\s+$/, '').length), 0))
  const lv = new Uint8Array(w * rows.length)
  rows.forEach((r, y) => {
    for (let x = 0; x < Math.min(w, r.length); x++) lv[y * w + x] = levelOf(r[x])
  })
  return { w, h: rows.length, lv }
}

/** The right half reflected from the left: 'odd' shares the centre column, 'even' doesn't. */
export function mirrorCells(c: Cells, mode: unknown): Cells {
  if ((mode !== 'odd' && mode !== 'even') || c.w === 0) return c
  const w = c.w * 2 - (mode === 'odd' ? 1 : 0)
  const lv = new Uint8Array(w * c.h)
  for (let y = 0; y < c.h; y++) for (let x = 0; x < w; x++) lv[y * w + x] = c.lv[y * c.w + (x < c.w ? x : w - 1 - x)]
  return { w, h: c.h, lv }
}

// The small font (3 × 5, 5 × 5 for M and W) is the core one (core/bitmap.ts); these glyphs fill in what it lacks.
const SMALL_CORE = new Set('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ -.:/!+=#')
const SMALL_EXTRA: Record<string, string> = {
  ',': '../../../.#/#.', ';': '../.#/../.#/#.', '?': '###/..#/.##/.../.#.', "'": '#/#/././.', '"': '#.#/#.#/.../.../...',
  '(': '.#/#./#./#./.#', ')': '#./.#/.#/.#/#.', '[': '##/#./#./#./##', ']': '##/.#/.#/.#/##', '_': '.../.../.../.../###',
  '*': '.../#.#/.#./#.#/...', '%': '#.#/..#/.#./#../#.#', '<': '..#/.#./#../.#./..#', '>': '#../.#./..#/.#./#..',
  '&': '.#./#.#/.#./#.#/.##', '@': '.##/#.#/#.#/#../.##', '°': '###/#.#/###/.../...', '\\': '#../#../.#./..#/..#',
}

// The compact font drawn as strokes (Label, Join diagonals at Smooth ≥ 1): a few glyphs that a 3 × 5 bitmap leaves
// ambiguous once its corners are joined, redrawn (wider where needed). Bitmap labels keep the core glyphs.
const SMALL_STROKE: Record<string, string> = {
  B: '##./#.#/###/#.#/##.', Q: '###/#.#/#.#/###/..#', '#': '.#.#./#####/.#.#./#####/.#.#.', J: '..#/..#/..#/#.#/##.',
  '&': '.#../#.#./.#../#.#./.#.#', '@': '.##./#..#/#.##/#.../.##.',
}

// The large font: 5 × 7 (narrower where the letter is), capitals, lower case (g j p q y descend an eighth row),
// digits and punctuation.
const LARGE: Record<string, string> = {
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#', B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.', D: '###../#..#./#...#/#...#/#...#/#..#./###..',
  E: '#####/#..../#..../####./#..../#..../#####', F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.####', H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '###/.#./.#./.#./.#./.#./###', J: '..###/...#./...#./...#./...#./#..#./.##..',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#', L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#', N: '#...#/#...#/##..#/#.#.#/#..##/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.', P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#', R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.', T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.', V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#.', X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/#...#/.#.#./..#../..#../..#..', Z: '#####/....#/...#./..#../.#.../#..../#####',
  a: '...../...../.###./....#/.####/#...#/.####', b: '#..../#..../#.##./##..#/#...#/#...#/####.',
  c: '...../...../.###./#..../#..../#...#/.###.', d: '....#/....#/.##.#/#..##/#...#/#...#/.####',
  e: '...../...../.###./#...#/#####/#..../.###.', f: '..##/.#../.#../###./.#../.#../.#..',
  g: '...../...../.####/#...#/#...#/.####/....#/.###.', h: '#..../#..../#.##./##..#/#...#/#...#/#...#',
  i: '.#./.../##./.#./.#./.#./###', j: '...#/..../..##/...#/...#/...#/#..#/.##.',
  k: '#.../#.../#..#/#.#./##../#.#./#..#', l: '##./.#./.#./.#./.#./.#./###',
  m: '...../...../##.#./#.#.#/#.#.#/#...#/#...#', n: '...../...../#.##./##..#/#...#/#...#/#...#',
  o: '...../...../.###./#...#/#...#/#...#/.###.', p: '...../...../####./#...#/#...#/####./#..../#....',
  q: '...../...../.####/#...#/#...#/.####/....#/....#', r: '...../...../#.##./##..#/#..../#..../#....',
  s: '...../...../.####/#..../.###./....#/####.', t: '.#../.#../###./.#../.#../.#.#/..#.',
  u: '...../...../#...#/#...#/#...#/#..##/.##.#', v: '...../...../#...#/#...#/#...#/.#.#./..#..',
  w: '...../...../#...#/#...#/#.#.#/#.#.#/.#.#.', x: '...../...../#...#/.#.#./..#../.#.#./#...#',
  y: '...../...../#...#/#...#/#...#/.####/....#/.###.', z: '...../...../#####/...#./..#../.#.../#####',
  '0': '.###./#...#/#...#/#.#.#/#...#/#...#/.###.', '1': '.#./##./.#./.#./.#./.#./###',
  '2': '.###./#...#/....#/...#./..#../.#.../#####', '3': '.###./#...#/....#/..##./....#/#...#/.###.',
  '4': '...#./..##./.#.#./#..#./#####/...#./...#.', '5': '#####/#..../####./....#/....#/#...#/.###.',
  '6': '..##./.#.../#..../####./#...#/#...#/.###.', '7': '#####/....#/...#./..#../.#.../.#.../.#...',
  '8': '.###./#...#/#...#/.###./#...#/#...#/.###.', '9': '.###./#...#/#...#/.####/....#/...#./.##..',
  ' ': '.../.../.../.../.../.../...', '-': '..../..../..../####/..../..../....', '.': '././././././#',
  ',': '../../../../../../.#/#.', ':': '././#/./././#', ';': '../../.#/../../../.#/#.', '!': '#/#/#/#/#/./#',
  '?': '.###./#...#/....#/...#./..#../...../..#..', '/': '....#/...#./...#./..#../.#.../.#.../#....',
  '\\': '#..../.#.../.#.../..#../...#./...#./....#', '+': '...../..#../..#../#####/..#../..#../.....',
  '=': '...../...../#####/...../#####/...../.....', '#': '.#.#./.#.#./#####/.#.#./#####/.#.#./.#.#.',
  "'": '#/#/././././.', '"': '#.#/#.#/.../.../.../.../...', '(': '..#/.#./#../#../#../.#./..#',
  ')': '#../.#./..#/..#/..#/.#./#..', '[': '###/#../#../#../#../#../###', ']': '###/..#/..#/..#/..#/..#/###',
  '_': '...../...../...../...../...../...../#####', '*': '...../..#../#.#.#/.###./#.#.#/..#../.....',
  '%': '##..#/##..#/...#./..#../.#.../#..##/#..##', '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#',
  '<': '...#/..#./.#../#.../.#../..#./...#', '>': '#.../.#../..#./...#/..#./.#../#...',
  '@': '.###./#...#/#.###/#.#.#/#.###/#..../.###.', '°': '.##./#..#/.##./..../..../..../....',
}
const LARGE_UNKNOWN = '#####/#...#/#...#/#...#/#...#/#...#/#####'

/** A glyph's rows ('#' set). The small font upper-cases (it has no lower case); unknown characters get a box. */
/** Every hand-drawn glyph table (for tests: rectangular rows, 5 or 7–8 of them). */
export const GLYPH_TABLES: Record<string, Record<string, string>> = { large: LARGE, smallExtra: SMALL_EXTRA, smallStroke: SMALL_STROKE }

function glyphRows(ch: string, font: 'small' | 'large', strokes = false): string[] {
  if (font === 'large') return (LARGE[ch] ?? LARGE[ch.toUpperCase()] ?? LARGE_UNKNOWN).split('/')
  const u = ch.toUpperCase()
  if (strokes && SMALL_STROKE[u]) return SMALL_STROKE[u].split('/')
  if (!SMALL_CORE.has(u) && SMALL_EXTRA[u]) return SMALL_EXTRA[u].split('/')
  const b = textBitmap(u)
  return Array.from({ length: b.height }, (_, y) => Array.from({ length: b.width }, (_, x) => (b.levels[y * b.width + x] ? '#' : '.')).join(''))
}

export interface TextLayout {
  font?: 'small' | 'large'
  /** Empty cells between letters. */
  spacing?: number
  /** Empty rows between lines. */
  lineGap?: number
  align?: 'center' | 'left' | 'right'
  /** Each glyph's uprights doubled (one cell wider; the advance grows with it). */
  bold?: boolean
  /** Only widen the advance for bold (the caller emboldens the whole bitmap later, e.g. after joining diagonals). */
  boldAdvanceOnly?: boolean
  /** Drawn as strokes: the compact font's stroke versions of its ambiguous glyphs. */
  strokeGlyphs?: boolean
}

/** Text in a pixel font; lines split on '\n' or '|' and are aligned within the widest. */
export function textCells(text: string, o: TextLayout = {}): Cells {
  const font = o.font === 'large' ? 'large' : 'small'
  const gap = Math.max(0, Math.round(o.spacing ?? 1))
  const lineGap = Math.max(0, Math.round(o.lineGap ?? 1))
  const embolden = (g: string[]) => g.map((r) => [...r, '.'].map((ch, x) => (ch === '#' || (!o.boldAdvanceOnly && r[x - 1] === '#') ? '#' : '.')).join(''))
  const lines = text.replace(/\r/g, '').split(/\n|\|/).map((l) => [...l].map((ch) => (o.bold ? embolden(glyphRows(ch, font, o.strokeGlyphs)) : glyphRows(ch, font, o.strokeGlyphs))))
  // Rows per line: the font's (5 or 7), one more where a descender needs it.
  const rowsPer = lines.reduce((m, gs) => gs.reduce((n, g) => Math.max(n, g.length), m), font === 'large' ? 7 : 5)
  const lineWidth = (gs: string[][]) => gs.reduce((w, g, i) => w + g[0].length + (i ? gap : 0), 0)
  const w = Math.min(LABEL_MAX_W, lines.reduce((m, l) => Math.max(m, lineWidth(l)), 0))
  const h = Math.min(LABEL_MAX_H, lines.length * rowsPer + (lines.length - 1) * lineGap)
  const lv = new Uint8Array(w * h)
  lines.forEach((gs, li) => {
    const lw = lineWidth(gs)
    let x = o.align === 'left' ? 0 : o.align === 'right' ? w - lw : Math.floor((w - lw) / 2)
    const y0 = li * (rowsPer + lineGap)
    for (const g of gs) {
      g.forEach((row, gy) => {
        for (let gx = 0; gx < row.length; gx++) {
          const px = x + gx
          const py = y0 + gy
          if (row[gx] === '#' && px >= 0 && px < w && py < h) lv[py * w + px] = 3
        }
      })
      x += g[0].length + gap
    }
  })
  return { w, h, lv }
}

/** Bold lettering: every set cell also sets the one to its right (one cell wider). */
export function boldCells(c: Cells): Cells {
  if (c.w === 0) return c
  const w = c.w + 1
  const lv = new Uint8Array(w * c.h)
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < w; x++) lv[y * w + x] = Math.max(x < c.w ? c.lv[y * c.w + x] : 0, x > 0 ? c.lv[y * c.w + x - 1] : 0)
  return { w, h: c.h, lv }
}

/**
 * Join diagonals: each cell becomes 2 × 2 half-cells, and wherever two cells touch only at a corner (the other two of
 * their 2 × 2 empty) the two empty half-cells at that corner are filled — add only, so square corners stay square and
 * a one-cell diagonal (or an X's crossing) becomes one stroke of half-cell steps.
 */
export function bridgeCells(c: Cells): Cells {
  const w = c.w * 2
  const h = c.h * 2
  const lv = new Uint8Array(w * h)
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < c.w && y < c.h ? c.lv[y * c.w + x] : 0)
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const v = at(x, y)
      lv[2 * y * w + 2 * x] = lv[2 * y * w + 2 * x + 1] = lv[(2 * y + 1) * w + 2 * x] = lv[(2 * y + 1) * w + 2 * x + 1] = v
    }
  const fill = (x: number, y: number, v: number) => {
    if (!lv[y * w + x]) lv[y * w + x] = v
  }
  for (let y = -1; y < c.h; y++)
    for (let x = -1; x < c.w; x++) {
      const tl = at(x, y)
      const tr = at(x + 1, y)
      const bl = at(x, y + 1)
      const br = at(x + 1, y + 1)
      // The corner shared by the four cells is at half-cell (2x + 2, 2y + 2).
      if (tl && br && !tr && !bl) {
        fill(2 * x + 2, 2 * y + 1, Math.max(tl, br))
        fill(2 * x + 1, 2 * y + 2, Math.max(tl, br))
      }
      if (tr && bl && !tl && !br) {
        fill(2 * x + 1, 2 * y + 1, Math.max(tr, bl))
        fill(2 * x + 2, 2 * y + 2, Math.max(tr, bl))
      }
    }
  return { w, h, lv }
}

/** Bold on the bitmap: every set cell also sets the `k` cells to its right (the advance was widened for it). */
function emboldenCells(c: Cells, k: number): Cells {
  const lv = new Uint8Array(c.lv)
  for (let y = 0; y < c.h; y++)
    for (let x = c.w - 1; x >= 0; x--)
      for (let j = 1; j <= k; j++) if (x - j >= 0) lv[y * c.w + x] = Math.max(lv[y * c.w + x], c.lv[y * c.w + x - j])
  return { w: c.w, h: c.h, lv }
}

/**
 * The outline of the filled cells as closed loops on the cell-corner lattice (filled on the right, y down), one vertex
 * per cell edge: diagonal neighbours join (a loop turns left where two cells touch at a corner), so one-cell diagonal
 * lines stay one line.
 */
function outlineLoops(c: Cells): [number, number][][] {
  const W = c.w
  const H = c.h
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && c.lv[y * W + x] > 0
  const DX = [1, 0, -1, 0]
  const DY = [0, 1, 0, -1]
  // Edges by start vertex: (vertex, direction) — 0 right, 1 down, 2 left, 3 up.
  const V = W + 1
  const outs = new Map<number, number[]>()
  const add = (x: number, y: number, d: number) => {
    const k = y * V + x
    const l = outs.get(k)
    if (l) l.push(d)
    else outs.set(k, [d])
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!filled(x, y)) continue
      if (!filled(x, y - 1)) add(x, y, 0)
      if (!filled(x + 1, y)) add(x + 1, y, 1)
      if (!filled(x, y + 1)) add(x + 1, y + 1, 2)
      if (!filled(x - 1, y)) add(x, y + 1, 3)
    }
  const loops: [number, number][][] = []
  for (const [k0, l0] of outs) {
    while (l0.length) {
      let x = k0 % V
      let y = Math.floor(k0 / V)
      let d = l0.pop()!
      const pts: [number, number][] = []
      for (let guard = 0; guard < 4 * (W + 1) * (H + 1); guard++) {
        pts.push([x, y])
        x += DX[d]
        y += DY[d]
        const l = outs.get(y * V + x)
        if (!l || !l.length) break
        const left = (d + 3) % 4
        const i = l.length > 1 && l.includes(left) ? l.indexOf(left) : l.length - 1
        d = l.splice(i, 1)[0]
      }
      if (pts.length >= 4) loops.push(pts)
    }
  }
  return loops
}

/** Chaikin corner cutting of closed loops: `r` of each edge cut off at either end (0.25 → a quadratic B-spline). */
function chaikin(loops: [number, number][][], r: number, iterations: number): [number, number][][] {
  let ls = loops
  for (let it = 0; it < iterations; it++)
    ls = ls.map((l) =>
      l.flatMap(([ax, ay], i) => {
        const [bx, by] = l[(i + 1) % l.length]
        return [
          [ax + (bx - ax) * r, ay + (by - ay) * r],
          [ax + (bx - ax) * (1 - r), ay + (by - ay) * (1 - r)],
        ] as [number, number][]
      }),
    )
  return ls
}

type Pt = [number, number]

/** Douglas–Peucker on an open run (keeps its ends): the vertices more than `eps` off the simplified line. */
function simplifyRun(pts: Pt[], eps: number): Pt[] {
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    const [ax, ay] = pts[i]
    const [bx, by] = pts[j]
    const L = Math.hypot(bx - ax, by - ay)
    // The farthest vertex (from the chord; from its end when the run closes on itself); near-ties go to the one nearest
    // the run's middle, so a run walked the other way (the mirror side of a symmetric shape) splits at the mirror vertex.
    let far = -1
    let fd = eps
    const mid = (i + j) / 2
    for (let k = i + 1; k < j; k++) {
      const d = L > 1e-9 ? Math.abs((bx - ax) * (pts[k][1] - ay) - (by - ay) * (pts[k][0] - ax)) / L : Math.hypot(pts[k][0] - ax, pts[k][1] - ay)
      if (d > fd + 1e-6 || (d > fd - 1e-6 && far >= 0 && Math.abs(k - mid) < Math.abs(far - mid))) {
        fd = Math.max(fd, d)
        far = k
      }
    }
    if (far >= 0) {
      keep[far] = 1
      stack.push([i, far], [far, j])
    }
  }
  return pts.filter((_, k) => keep[k])
}

/**
 * A closed loop with its staircase runs fitted by straight segments (within `eps` cells). The loop is cut at its corners
 * first — vertices where the direction over five edges either side turns by more than 70° (the sharpest of a cluster)
 * — so runs straighten between corners that stay put; small loops (≤ 24 edges: dots, bars) stay as they are.
 */
function simplifyLoop(l: Pt[], eps: number): Pt[] {
  const n = l.length
  if (n <= 24 || eps <= 0) return l
  const W = 5
  const turn = l.map((p, i) => {
    const a = l[(i - W + n) % n]
    const b = l[(i + W) % n]
    const a1 = Math.atan2(p[1] - a[1], p[0] - a[0])
    const a2 = Math.atan2(b[1] - p[1], b[0] - p[0])
    return Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)))
  })
  const corners: number[] = []
  for (let i = 0; i < n; i++) {
    if (turn[i] < (70 * Math.PI) / 180) continue
    let peak = true
    // The sharpest within W either side; ties all count (a flat tip keeps both its corners — symmetric either way round).
    for (let k = 1; k <= W && peak; k++) if (turn[(i + k) % n] > turn[i] + 1e-9 || turn[(i - k + n) % n] > turn[i] + 1e-9) peak = false
    if (peak) corners.push(i)
  }
  if (corners.length < 2) {
    let far = 0
    let fd = -1
    l.forEach(([x, y], i) => {
      const d = (x - l[0][0]) ** 2 + (y - l[0][1]) ** 2
      if (d > fd) {
        fd = d
        far = i
      }
    })
    corners.length = 0
    corners.push(0, far)
  }
  const out: Pt[] = []
  corners.forEach((c, k) => {
    const e = corners[(k + 1) % corners.length]
    const run: Pt[] = []
    for (let i = c; ; i = (i + 1) % n) {
      run.push(l[i])
      if (i === e) break
    }
    out.push(...simplifyRun(run, eps).slice(0, -1))
  })
  return out
}

/** Extra vertices `rho` in from both ends of every longer edge, so corner cutting rounds only within `rho` of a corner. */
function guardCorners(l: Pt[], rho: number): Pt[] {
  return l.flatMap(([ax, ay], i) => {
    const [bx, by] = l[(i + 1) % l.length]
    const L = Math.hypot(bx - ax, by - ay)
    if (L <= 2 * rho) return [[ax, ay] as Pt]
    const f = rho / L
    return [[ax, ay], [ax + (bx - ax) * f, ay + (by - ay) * f], [bx - (bx - ax) * f, by - (by - ay) * f]] as Pt[]
  })
}

/**
 * Smoothed outline loops. Up to `a` = 1 each staircase edge is cut back toward its middle (at 1 the loop runs
 * through the edge midpoints — 1:1 staircases turn straight, one-cell diagonal lines √½ wide), then Chaikin rounds it.
 * From 1 to 2 the uneven staircase runs between corners are fitted by straight segments (up to a cell off at 2), corners rounded within half
 * a cell; beyond 2 the fit loosens and the corner rounds grow (to 3½ cells at 4).
 */
export function smoothLoops(c: Cells, a: number): Pt[][] {
  const k = Math.min(1, Math.max(0, a))
  // Each edge's ends cut back toward its middle (one corner cut at ratio k/2: the same from either direction, so a
  // symmetric drawing stays symmetric); at 1 only the midpoints are left.
  const mid = chaikin(outlineLoops(c), 0.5 * k, 1).map((l) => l.filter((p, i) => {
    const q = l[(i + 1) % l.length]
    return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 1e-9
  }))
  if (a <= 1) return chaikin(mid, 0.25 * Math.min(1, 2 * k), 4)
  const eps = Math.min(1, a - 1) + 0.4 * Math.max(0, a - 2)
  const rho = 0.5 + 1.5 * Math.max(0, a - 2)
  return chaikin(mid.map((l) => guardCorners(simplifyLoop(l, eps), rho)), 0.25, 4)
}

/** Fills closed loops (cell units) even–odd on a grid N× finer with `margin` coarse cells round the bitmap. */
function fillLoops(loops: [number, number][][], w: number, h: number, N: number, margin: number): Uint8Array {
  const rows: number[][] = Array.from({ length: h }, () => [])
  for (const l of loops)
    l.forEach(([ax, ay], i) => {
      const [bx, by] = l[(i + 1) % l.length]
      if (ay === by) return
      // Fine rows whose centre lies in [min y, max y) cross this edge.
      const fy0 = Math.ceil((Math.min(ay, by) + margin) * N - 0.5)
      const fy1 = Math.ceil((Math.max(ay, by) + margin) * N - 0.5) - 1
      for (let j = Math.max(0, fy0); j <= Math.min(h - 1, fy1); j++) {
        const yc = (j + 0.5) / N - margin
        rows[j].push(ax + ((yc - ay) * (bx - ax)) / (by - ay))
      }
    })
  const m = new Uint8Array(w * h)
  rows.forEach((xs, j) => {
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Centres on a span's ends count (both ends alike, so mirror images fill alike).
      const i0 = Math.max(0, Math.ceil((xs[k] + margin) * N - 0.5 - 1e-7))
      const i1 = Math.min(w - 1, Math.floor((xs[k + 1] + margin) * N - 0.5 + 1e-7))
      for (let i = i0; i <= i1; i++) m[j * w + i] = 1
    }
  })
  return m
}

/**
 * The bitmap with a smoothed outline (smoothLoops), on a grid N× finer (with `margin` empty coarse cells round it),
 * filled even–odd. The level boundaries inside are smoothed the same way (each "level ≥ L" area on its own).
 */
export function smoothCells(c: Cells, amount: number, N: number, margin: number): Cells {
  const w = (c.w + 2 * margin) * N
  const h = (c.h + 2 * margin) * N
  const lv = new Uint8Array(w * h)
  let prev = ''
  for (let L = 1; L <= 3; L++) {
    const at = c.lv.map((v) => (v >= L ? 1 : 0))
    const sig = at.join('')
    if (!at.some((v) => v)) break
    if (sig !== prev) {
      const m = fillLoops(smoothLoops({ w: c.w, h: c.h, lv: at }, amount), w, h, N, margin)
      for (let i = 0; i < w * h; i++) if (m[i] && (L === 1 || lv[i])) lv[i] = L
    } else for (let i = 0; i < w * h; i++) if (lv[i] === L - 1) lv[i] = L
    prev = sig
  }
  return { w, h, lv }
}

/**
 * Lettering as strokes (Label with Join diagonals and Smooth outline ≥ 1): the filled cells' centres are joined to
 * their neighbours — side by side, and diagonally where two cells touch only at a corner — and each run between ends
 * and junctions is fitted by straight segments (centres up to half a cell off), drawn as round-ended strokes a cell
 * wide (wider across for bold, which grows them sideways only, so counters keep their height). An X is two straight
 * diagonals crossing in their own diamond, a slash one straight stroke; lone cells are round dots a cell across.
 * Filled on a grid N× finer with `margin` empty cells round the bitmap; all one level (lettering).
 */
export function strokeCells(c: Cells, N: number, margin: number, bold = 0, keepEnds = true, round = 0): Cells & { sdf: Float32Array } {
  const w = (c.w + 2 * margin) * N
  const h = (c.h + 2 * margin) * N
  const lv = new Uint8Array(w * h)
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < c.w && y < c.h && c.lv[y * c.w + x] > 0
  const id = (x: number, y: number) => y * c.w + x
  // Neighbours: the four sides, and the corners where the two cells between are empty (else they already connect).
  const nbr = new Map<number, number[]>()
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      if (!on(x, y)) continue
      const l: number[] = []
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (on(x + dx, y + dy)) l.push(id(x + dx, y + dy))
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) if (on(x + dx, y + dy) && !on(x + dx, y) && !on(x, y + dy)) l.push(id(x + dx, y + dy))
      nbr.set(id(x, y), l)
    }
  // A diagonal run that ends beside a bar runs on into the bar's corner cell rather than turning into it through a
  // one-cell stub (a z's diagonal, an M's shoulders): where a cell's only diagonal continues straight back into a
  // filled cell it touches at a corner (the two cells between: one filled), that corner joins and the stub goes.
  const unlink = (a: number, b: number) => {
    nbr.set(a, nbr.get(a)!.filter((n) => n !== b))
    nbr.set(b, nbr.get(b)!.filter((n) => n !== a))
  }
  for (const [k, l] of [...nbr]) {
    const x = k % c.w
    const y = Math.floor(k / c.w)
    const diag = l.filter((n) => n % c.w !== x && Math.floor(n / c.w) !== y)
    if (diag.length !== 1) continue
    const vx = (diag[0] % c.w) - x
    const vy = Math.floor(diag[0] / c.w) - y
    const ex = x - vx
    const ey = y - vy
    if (!on(ex, ey) || on(ex, y) === on(x, ey)) continue
    const e = id(ex, ey)
    const shared = on(ex, y) ? id(ex, y) : id(x, ey)
    if (!l.includes(shared) || nbr.get(e)!.includes(k)) continue
    unlink(k, shared)
    nbr.get(k)!.push(e)
    nbr.get(e)!.push(k)
  }
  const centre = (k: number): Pt => [(k % c.w) + 0.5, Math.floor(k / c.w) + 0.5]
  const seen = new Set<string>()
  const ek = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)
  const chains: { pts: Pt[]; closed: boolean }[] = []
  const walk = (a: number, b: number) => {
    const path = [a, b]
    seen.add(ek(a, b))
    let prev = a
    let cur = b
    while ((nbr.get(cur) ?? []).length === 2) {
      const next = nbr.get(cur)!.find((n) => n !== prev)!
      if (seen.has(ek(cur, next))) break
      seen.add(ek(cur, next))
      path.push(next)
      prev = cur
      cur = next
    }
    return path
  }
  // Runs from every end or junction, then the loops left over (all their cells joined to two others).
  for (const [k, l] of nbr) if (l.length !== 2) for (const n of l) if (!seen.has(ek(k, n))) chains.push({ pts: walk(k, n).map(centre), closed: false })
  for (const [k, l] of nbr)
    for (const n of l)
      if (!seen.has(ek(k, n))) {
        const path = walk(k, n)
        chains.push({ pts: path.slice(0, path[path.length - 1] === path[0] ? -1 : undefined).map(centre), closed: true })
      }
  // Fit each run, keeping straight cell runs: the ends of every side-by-side run of two steps or more (and, with
  // `keepEnds`, of any such run next to a junction or a stroke's end) stay put, so flat tops, bowls and stems stay flat;
  // only the uneven stairs between them straighten (a slash's pairs).
  const segs: [Pt, Pt][] = []
  for (const ch of chains) {
    const pts = ch.pts
    const n = pts.length
    const m = ch.closed ? n : n - 1 // steps
    const dir = (i: number) => {
      const [ax, ay] = pts[i % n]
      const [bx, by] = pts[(i + 1) % n]
      return `${bx - ax},${by - ay}`
    }
    const ortho = (i: number) => {
      const [ax, ay] = pts[i % n]
      const [bx, by] = pts[(i + 1) % n]
      return ax === bx || ay === by
    }
    const anchor = new Uint8Array(n)
    if (!ch.closed) anchor[0] = anchor[n - 1] = 1
    // Runs of equal steps.
    let i = 0
    const runs: [number, number][] = []
    if (ch.closed && m > 0) {
      // Start a closed chain where the direction changes (any run boundary), so no run is split.
      let s0 = 0
      while (s0 < m && dir(s0) === dir((s0 - 1 + m) % m)) s0++
      if (s0 === m) s0 = 0
      i = s0
      for (let done = 0; done < m; ) {
        let len = 1
        while (len < m && dir((i + len) % m) === dir(i % m)) len++
        runs.push([i % m, len])
        i += len
        done += len
      }
    } else {
      while (i < m) {
        let len = 1
        while (i + len < m && dir(i + len) === dir(i)) len++
        runs.push([i, len])
        i += len
      }
    }
    const step = (k: number): Pt => {
      const [ax, ay] = pts[((k % m) + m) % m % n]
      const [bx, by] = pts[(((k % m) + m) % m + 1) % n]
      return [bx - ax, by - ay]
    }
    const turn = (u: Pt, v: Pt) => Math.sign(u[0] * v[1] - u[1] * v[0])
    for (const [r0, len] of runs) {
      const atEnd = !ch.closed && (r0 === 0 || r0 + len === m)
      // A single side-by-side step is kept where the stroke turns the same way into and out of it (the bottom of a
      // J, the flat of a cup); between turns the other way it is a stair of a slant (a slash's pairs) and straightens.
      const hasPrev = ch.closed || r0 > 0
      const hasNext = ch.closed || r0 + len < m
      const cup = hasPrev && hasNext && turn(step(r0 - 1), step(r0)) !== 0 && turn(step(r0 - 1), step(r0)) === turn(step(r0 + len - 1), step(r0 + len))
      if (ortho(r0) && (len >= 2 || cup || (atEnd && keepEnds))) {
        anchor[r0 % n] = 1
        anchor[(r0 + len) % n] = 1
      }
    }
    const idx = [...anchor.keys()].filter((k) => anchor[k])
    let fitted: Pt[]
    if (!idx.length) fitted = ch.closed ? simplifyLoop(pts, 0.5) : simplifyRun(pts, 0.5)
    else {
      // Between anchors (round the loop when closed).
      fitted = []
      const spans = ch.closed ? idx.length : idx.length - 1
      for (let k = 0; k < spans; k++) {
        const a = idx[k]
        const e = idx[(k + 1) % idx.length]
        const run: Pt[] = []
        for (let j = a; ; j = (j + 1) % n) {
          run.push(pts[j])
          if (j === e && run.length > 1) break
        }
        fitted.push(...simplifyRun(run, 0.5).slice(0, -1))
      }
      if (!ch.closed) fitted.push(pts[n - 1])
    }
    // Smooth outline beyond 1: the stroke's own corners cut into curves (Chaikin on its centre line; a run's ends and a
    // stroke's ends stay), so bends round off inside and out, with no bulge.
    if (round > 0 && fitted.length > 2)
      for (let it = 0; it < 3; it++) {
        const q = fitted
        const L = q.length
        const out2: Pt[] = ch.closed ? [] : [q[0]]
        for (let j = 0; j < (ch.closed ? L : L - 1); j++) {
          const [ax, ay] = q[j]
          const [bx, by] = q[(j + 1) % L]
          if (ch.closed || j > 0) out2.push([ax + (bx - ax) * round, ay + (by - ay) * round])
          if (ch.closed || j < L - 2) out2.push([ax + (bx - ax) * (1 - round), ay + (by - ay) * (1 - round)])
        }
        if (!ch.closed) out2.push(q[L - 1])
        fitted = out2
      }
    const fn = fitted.length
    for (let j = 0; j + 1 < (ch.closed ? fn + 1 : fn); j++) segs.push([fitted[j], fitted[(j + 1) % fn]])
  }
  // Dots: cells joined to nothing.
  for (const [k, l] of nbr) if (!l.length) segs.push([centre(k), centre(k)])
  // A round-ended stroke per segment, half a cell either side; bold sweeps it a cell sideways too (a rounded
  // parallelogram): wider uprights, counters as tall, the same round ends. The distance to the strokes is exact —
  // worked out at every fine cell's centre within the margin of each stroke — so slanted strokes have clean edges.
  const r = 0.5
  const hb = 0.5 * bold
  const sdf = new Float32Array(w * h).fill(margin * N)
  const segDist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const ex = bx - ax
    const ey = by - ay
    const ee = ex * ex + ey * ey
    const t = ee > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / ee)) : 0
    return (px - ax - ex * t) ** 2 + (py - ay - ey * t) ** 2
  }
  for (const [[ax0, ay], [bx0, by]] of segs) {
    // Shifted by half the extra width, so the letter stays in its widened advance.
    const ax = ax0 + hb
    const bx = bx0 + hb
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - hb + margin - margin) * N))
    const i1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + hb + 2 * margin) * N))
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) + margin - margin) * N))
    const j1 = Math.min(h - 1, Math.ceil((Math.max(ay, by) + 2 * margin) * N))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) / N - margin
        const py = (j + 0.5) / N - margin
        // Signed distance to the swept parallelogram (a segment when not bold), less the pen's radius.
        let d2 = Math.min(segDist2(px, py, ax - hb, ay, bx - hb, by), segDist2(px, py, ax + hb, ay, bx + hb, by))
        let inside = false
        if (hb > 0) {
          d2 = Math.min(d2, segDist2(px, py, ax - hb, ay, ax + hb, ay), segDist2(px, py, bx - hb, by, bx + hb, by))
          const ey = by - ay
          if (Math.abs(ey) > 1e-9) {
            const t = (py - ay) / ey
            inside = t > 0 && t < 1 && Math.abs(px - (ax + (bx - ax) * t)) < hb
          }
        }
        const d = ((inside ? -Math.sqrt(d2) : Math.sqrt(d2)) - r) * N
        const k = j * w + i
        if (d < sdf[k]) sdf[k] = d
      }
  }
  for (let k = 0; k < w * h; k++) lv[k] = sdf[k] < 0 ? 3 : 0
  return { w, h, lv, sdf }
}

/**
 * For every cell of a W × H grid, the nearest cell (index) where `target` holds — nearest from the cell's centre to
 * that cell's square. Jump flooding (+ one extra pass of 1), near-exact; -1 where there is none.
 */
function nearestCells(W: number, H: number, target: (i: number) => boolean): Int32Array {
  let cur = new Int32Array(W * H).fill(-1)
  let nxt = new Int32Array(W * H)
  for (let i = 0; i < W * H; i++) if (target(i)) cur[i] = i
  const dist = (x: number, y: number, s: number) => {
    const dx = Math.max(Math.abs(x - (s % W)) - 0.5, 0)
    const dy = Math.max(Math.abs(y - Math.floor(s / W)) - 0.5, 0)
    return dx * dx + dy * dy
  }
  const steps: number[] = []
  for (let k = 1 << Math.ceil(Math.log2(Math.max(W, H, 2))); k >= 1; k >>= 1) steps.push(k)
  steps.push(1)
  for (const k of steps) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let best = cur[y * W + x]
        let bd = best >= 0 ? dist(x, y, best) : Infinity
        for (let dy = -k; dy <= k; dy += k)
          for (let dx = -k; dx <= k; dx += k) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
            const s = cur[ny * W + nx]
            if (s < 0 || s === best) continue
            const d = dist(x, y, s)
            if (d < bd) {
              bd = d
              best = s
            }
          }
        nxt[y * W + x] = best
      }
    ;[cur, nxt] = [nxt, cur]
  }
  return cur
}

/** Squared distance from the centre of cell i to the square of cell s (cells of a W-wide grid). */
function cellDist2(W: number, i: number, s: number): number {
  const dx = Math.max(Math.abs((i % W) - (s % W)) - 0.5, 0)
  const dy = Math.max(Math.abs(Math.floor(i / W) - Math.floor(s / W)) - 0.5, 0)
  return dx * dx + dy * dy
}

export interface StampMap {
  /** Empty cells kept round the bitmap (bitmap cells). */
  margin: number
  /** Smoothed outline (0 = the pixel outline, exact): its amount, 0..1. */
  smooth?: number
  /** Fine cells per bitmap cell for the smoothed outline. */
  fine?: number
  /** The cells are already this many per bitmap cell (2 after the corner bridges). */
  pre?: number
  /** Lettering as strokes (strokeCells) on the fine grid, with this bold (0 or 1). */
  strokes?: { bold: number }
}

interface Grid {
  W: number
  H: number
  lv: Uint8Array
  /** Exact signed distances at the cell centres (cells), when known (strokes) — else from the cells. */
  sdf?: Float32Array
  /** Cells per bitmap cell. */
  N: number
  /** Margin in grid cells. */
  M: number
  smooth: boolean
}
const gridCache = new Map<string, Grid>()

/** The grid the shader samples: the bitmap (or its smoothed outline, N× finer) with the margin round it. Cached. */
function stampGrid(c: Cells, o: StampMap): Grid {
  const smooth = (o.smooth ?? 0) > 0
  const N = smooth ? Math.max(1, Math.round(o.fine ?? 4)) : 1
  const M = o.margin * N
  const key = `${c.w}:${c.h}:${o.margin}:${smooth ? `${o.smooth}:${N}` : 0}:${o.strokes ? `s${o.strokes.bold}` : ''}:${c.lv.join('')}`
  const hit = gridCache.get(key)
  if (hit) return hit
  let g: Grid
  if (smooth && o.strokes) {
    // Straight runs of two steps (three cells) and more always stay; from Smooth outline 1.5 the single steps next to
    // a junction or a stroke's end straighten too, and beyond 1 the strokes' bends round off (corner cutting up to a
    // quarter of each segment at 2).
    const a = o.smooth ?? 1
    const f = strokeCells(c, N, o.margin, o.strokes.bold, a < 1.5, 0.25 * Math.min(1, Math.max(0, a - 1)))
    g = { W: f.w, H: f.h, lv: f.lv, sdf: f.sdf, N, M, smooth }
  } else if (smooth) {
    const f = smoothCells(c, o.smooth!, N, o.margin)
    g = { W: f.w, H: f.h, lv: f.lv, N, M, smooth }
  } else {
    const W = c.w + 2 * M
    const H = c.h + 2 * M
    const lv = new Uint8Array(W * H)
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) lv[(y + M) * W + x + M] = c.lv[y * c.w + x]
    g = { W, H, lv, N, M, smooth }
  }
  gridCache.set(key, g)
  if (gridCache.size > 24) gridCache.delete(gridCache.keys().next().value!)
  return g
}

const texCache = new WeakMap<Grid, CpuTexture>()
const lvCache = new WeakMap<Grid, CpuTexture>()
const EMPTY_TEX: CpuTexture = { width: 2, height: 1, data: new Uint8Array(8) }
const hasCells = (c: Cells) => c.w > 0 && c.h > 0 && c.lv.some((v) => v > 0)
/** A signed distance in cells as 16 bits, 1/16 cell steps. */
const fix16 = (d: number) => Math.max(-32768, Math.min(32767, Math.round(d * 16))) & 0xffff

/**
 * The shader's data texture: the bitmap with a margin of empty cells round it, one texel per cell, R = level (bits
 * 0–1) | the level of the nearest cell of the other state (bits 2–3). Exact (pixel) outline: G/B/A = that cell's x and
 * y (12 bits each: G, B the low bytes, A the high nibbles). Smoothed outline (on a finer grid): G/B = the signed
 * distance from the cell's centre to the outline, 1/16 cell steps (16-bit). One extra row on top: texel 0 = the
 * bitmap's size in cells, texel 1 = the margin (16-bit), cells per bitmap cell, outline mode (0 exact, 1 smooth).
 */
export function stampTexture(c: Cells, o: StampMap): CpuTexture {
  if (!hasCells(c)) return EMPTY_TEX
  const g = stampGrid(c, o)
  const hit = texCache.get(g)
  if (hit) return hit
  const { W, H, lv, N, M, smooth, sdf } = g
  const toEmpty = sdf ? new Int32Array(0) : nearestCells(W, H, (i) => lv[i] === 0)
  const toFilled = sdf ? new Int32Array(0) : nearestCells(W, H, (i) => lv[i] > 0)
  const width = Math.max(W, 2)
  const data = new Uint8Array(width * (H + 1) * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const t = (y * width + x) * 4
      if (sdf) {
        // Strokes: one level, their exact distance.
        data[t] = lv[i] | (3 << 2)
        const v = fix16(sdf[i])
        data[t + 1] = v & 255
        data[t + 2] = v >> 8
        continue
      }
      const n = lv[i] > 0 ? toEmpty[i] : toFilled[i]
      data[t] = lv[i] | ((n >= 0 ? lv[n] : 0) << 2)
      if (smooth) {
        const v = fix16(n >= 0 ? Math.sqrt(cellDist2(W, i, n)) * (lv[i] > 0 ? -1 : 1) : 0)
        data[t + 1] = v & 255
        data[t + 2] = v >> 8
      } else {
        const nx = n >= 0 ? n % W : x
        const ny = n >= 0 ? Math.floor(n / W) : y
        data[t + 1] = nx & 255
        data[t + 2] = ny & 255
        data[t + 3] = ((nx >> 8) & 15) | (((ny >> 8) & 15) << 4)
      }
    }
  const bw = c.w * N
  const bh = c.h * N
  data.set([bw & 255, bw >> 8, bh & 255, bh >> 8, M & 255, M >> 8, N * (o.pre ?? 1), smooth ? 1 : 0], H * width * 4)
  const tex = { width, height: H + 1, data }
  texCache.set(g, tex)
  return tex
}

/**
 * For Level relief, on the same grid: the edges of the "level ≥ 2" and "level ≥ 3" areas. Exact outline: two texels
 * per cell (x·2 + L − 2) holding, like the outline's, the nearest cell across that edge — R, G the low bytes of its x
 * and y, B their high nibbles, A bit 0 = the cell is in the area, bit 1 = the area exists — so level steps are as
 * square as the colours. Smoothed outline: one texel per cell, the signed centre distances (R, G: "≥ 2"; B, A: "≥ 3";
 * 16 bits, 1/16 cell), read bilinearly like the outline.
 */
export function levelTexture(c: Cells, o: StampMap): CpuTexture {
  if (!hasCells(c)) return EMPTY_TEX
  const g = stampGrid(c, o)
  const hit = lvCache.get(g)
  if (hit) return hit
  const { W, H, lv, smooth } = g
  const per = smooth ? 1 : 2
  const data = new Uint8Array(W * per * H * 4)
  for (const L of [2, 3]) {
    const any = lv.some((v) => v >= L)
    const below = any ? nearestCells(W, H, (i) => lv[i] < L) : null
    const above = any ? nearestCells(W, H, (i) => lv[i] >= L) : null
    for (let i = 0; i < W * H; i++) {
      const n = !below || !above ? -1 : lv[i] >= L ? below[i] : above[i]
      if (smooth) {
        const v = fix16(n < 0 ? 2047 : Math.sqrt(cellDist2(W, i, n)) * (lv[i] >= L ? -1 : 1))
        data[i * 4 + (L - 2) * 2] = v & 255
        data[i * 4 + (L - 2) * 2 + 1] = v >> 8
      } else {
        const x = i % W
        const y = Math.floor(i / W)
        const nx = n >= 0 ? n % W : x
        const ny = n >= 0 ? Math.floor(n / W) : y
        const t = (y * W * 2 + x * 2 + L - 2) * 4
        data.set([nx & 255, ny & 255, ((nx >> 8) & 15) | (((ny >> 8) & 15) << 4), (lv[i] >= L ? 1 : 0) | (any ? 2 : 0)], t)
      }
    }
  }
  const tex = { width: W * per, height: H, data }
  lvCache.set(g, tex)
  return tex
}

/** Empty cells kept round the bitmap: enough for distances out past a Grow (beyond them they are approximate). */
function marginFor(q: ParamValues): number {
  const reach = Math.ceil(Math.max(0, Number(q.grow ?? 0)) / Math.max(0.01, Number(q.scale ?? 1))) + 3
  let m = 4
  while (m < reach && m < 64) m *= 2
  return m
}

/**
 * A layer's data textures (`stamp`, and `lv` for Level relief — 1 × 1 when off): its margin, and for a smoothed
 * outline a grid fine enough for ~1 px cells.
 */
function layerTextures(c0: Cells, q: ParamValues): Record<string, CpuTexture> {
  // Label with Join diagonals and Smooth outline ≥ 1: lettering as strokes (bold drawn by the pen).
  const strokes = Boolean(q._strokes) && Boolean(q.join) && Number(q.smooth ?? 0) >= 1
  // Join diagonals: half-cells with the corner bridges, then (Label) bold — after the join, so bold diagonals stay
  // even.
  const pre = q.join && !strokes ? 2 : 1
  const joined = pre > 1 ? bridgeCells(c0) : c0
  const c = q.bold && q._boldLate && !strokes ? emboldenCells(joined, pre) : joined
  const margin = marginFor(q) * pre
  const smooth = Math.min(4, Math.max(0, Number(q.smooth ?? 0)))
  const want = Math.ceil(Math.max(0.01, Number(q.scale ?? 1)) / pre / 1.25)
  const room = Math.floor(320 / (Math.max(c.w, c.h) + 2 * margin))
  const o: StampMap =
    smooth > 0 ? { margin, smooth, fine: Math.max(2, Math.min(8, want, room)), pre, ...(strokes ? { strokes: { bold: q.bold ? 1 : 0 } } : {}) } : { margin, pre }
  // Level edges: for Level relief, and for anti-aliased level colours (Random per level) — only with two levels or more.
  const levels = new Set(c.lv).size - (c.lv.includes(0) ? 1 : 0)
  const wantLv = levels > 1 && (Number(q.lvl_h ?? 0) > 0 || (q.aa !== false && q.rnd_by !== 'instance'))
  return { stamp: stampTexture(c, o), lv: wantLv ? levelTexture(c, o) : { width: 1, height: 1, data: new Uint8Array(4) } }
}

// ------------------------------------------------------------------------------------------------ Stamp / Label

const repeats = (p: ParamValues) => Number(p.count_x) > 1 || Number(p.count_y) > 1

const placement: ParamDef[] = [
  P.float('x', 'X', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: 'Centre, 0..1 across' }),
  P.float('y', 'Y', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: 'Centre, 0..1 down' }),
  P.float('scale', 'Pixel size', 1, 0.25, 256, { softMax: 32, unit: 'px', step: 0.05, hint: 'Texture px per bitmap cell (whole numbers keep the cells on the pixel grid, crisp)' }),
  P.enum('rotate', 'Rotate', '0', [['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']], { hint: 'Quarter turns, clockwise: the cells stay on the pixel grid' }),
  P.float('angle', 'Angle', 0, -360, 360, {
    softMin: -180,
    softMax: 180,
    unit: '°',
    step: 0.1,
    hint: 'Free rotation on top of the quarter turns, clockwise. Off the quarter turns the cell edges leave the pixel grid: keep Anti-alias on',
  }),
  P.float('grow', 'Grow', 0, -256, 256, {
    softMin: -8,
    softMax: 16,
    unit: 'px',
    step: 0.1,
    hint: 'Offsets the outline: out (rounding the outer corners — bold, blobby lettering) or in (thinner, rounding the inner corners)',
  }),
  P.float('outline', 'Outline', 0, 0, 512, { softMax: 16, unit: 'px', step: 0.1, hint: '0 = solid; otherwise only a stroke of this width inside the outline' }),
  P.float('smooth', 'Smooth outline', 0, 0, 4, {
    softMax: 2,
    step: 0.001,
    hint: '0 = the exact pixel outline: crisp, but a bevel wider than about a cell follows every stair and spikes inward at each step — raise Smooth outline for wide bevels. Lettering with Join diagonals (strokes) from 1: beyond 1 the strokes’ bends round off into curves (fully at 2). Otherwise up to 1 the staircase is rounded into curves (45° steps become straight diagonals) — a stamp drawn small, shown large; from 1 to 2 uneven stair runs straighten into the sides they suggest; beyond 2 corners round further',
  }),
  P.int('count_x', 'Repeat X', 1, 1, 256, { softMax: 32, group: 'repeat' }),
  P.int('count_y', 'Repeat Y', 1, 1, 256, { softMax: 32, group: 'repeat' }),
  P.enum('step_by', 'Spacing', 'gap', [
    ['step', 'Step', 'centre to centre, in px'],
    ['gap', 'Gap', 'the space between neighbouring repeats (their size plus it is the step): follows the pixel size and rotation'],
  ], { group: 'repeat', showIf: repeats }),
  P.float('step_x', 'Step X', 16, 0, 4096, { softMax: 256, unit: 'px', step: 0.5, group: 'repeat', showIf: (p) => Number(p.count_x) > 1 && p.step_by !== 'gap', hint: 'Centre to centre; repeats may overlap (they merge)' }),
  P.float('step_y', 'Step Y', 16, 0, 4096, { softMax: 256, unit: 'px', step: 0.5, group: 'repeat', showIf: (p) => Number(p.count_y) > 1 && p.step_by !== 'gap', hint: 'Centre to centre; repeats may overlap (they merge)' }),
  P.float('gap_x', 'Gap X', 1, -256, 256, { softMin: -4, softMax: 16, step: 0.05, group: 'repeat', showIf: (p) => Number(p.count_x) > 1 && p.step_by === 'gap', hint: 'Between neighbouring repeats, in cells (follows Pixel size); negative overlaps them (they merge)' }),
  P.float('gap_y', 'Gap Y', 1, -256, 256, { softMin: -4, softMax: 16, step: 0.05, group: 'repeat', showIf: (p) => Number(p.count_y) > 1 && p.step_by === 'gap', hint: 'Between neighbouring rows, in cells (follows Pixel size); negative overlaps them (they merge)' }),
  P.float('skew', 'Row shift', 0, -4096, 4096, { softMin: -256, softMax: 256, unit: 'px', step: 0.5, group: 'repeat', showIf: (p) => Number(p.count_y) > 1, hint: 'Shifts each row of repeats sideways — diagonal rivet lines, staggered grids (half the step: brick bond)' }),
  P.float('jitter', 'Position jitter', 0, 0, 1024, { softMax: 32, unit: 'px', step: 0.1, group: 'repeat', showIf: repeats, hint: 'Moves each repeat by up to this much (snapped to whole pixels), by the seed' }),
  P.float('drop', 'Drop out', 0, 0, 1, { step: 0.001, group: 'repeat', showIf: repeats, hint: 'Fraction of the repeats left out at random (missing rivets), by the seed' }),
  P.enum('rnd_by', 'Random per', 'level', [
    ['level', 'Pixel level', 'the cell level: "-" low, "+" mid, "#" full — multi-tone bitmaps through a Random colour ramp'],
    ['instance', 'Repeat', 'one random value per repeat — each rivet its own shade or height'],
    ['both', 'Level + repeat', 'the level picks a third of the ramp, the repeat a shade within it'],
  ], { group: 'repeat', hint: 'What the per-feature random (Random sources, Random jitter, Per-feature variation) follows' }),
  P.float('rnd_lo', 'From', 0, 0, 1, {
    step: 0.001,
    group: 'repeat',
    showIf: (p) => p.rnd_by !== 'level',
    join: { with: 'rnd_hi', as: 'pair', label: 'Repeat random range' },
    hint: 'The part of the ramp each repeat\'s random falls in — e.g. 0.3 … 1 keeps every repeat clear of a dark base',
  }),
  P.float('rnd_hi', 'To', 1, 0, 1, { step: 0.001, group: 'repeat', showIf: (p) => p.rnd_by !== 'level' }),
  P.seed('seed', 'Seed', 1, { group: 'repeat' }),
]

const stampGroups = [{ id: 'repeat', label: 'Repeat', collapsed: true }]

/** Layers saved before Spacing existed spaced their repeats by Step X / Y: they keep that meaning. */
const migrateSpacing = (p: ParamValues): ParamValues => ('step_by' in p || !('step_x' in p || 'step_y' in p) ? p : { ...p, step_by: 'step' })

const defaults = { bevel: 0.5, profile: 'linear', aa: true, h_on: true, h_amount: 0.6, dif_on: true, dif_src: 'random' }

/** Bevel's note on the exact pixel outline: wider than about a cell, it spikes inward at every stair. */
const wideBevelNote = (p: ParamValues) =>
  Number(p.smooth ?? 0) === 0 && Number(p.bevel) > 1.25 * Number(p.scale ?? 1)
    ? 'Wider than a cell on the exact pixel outline: the bevel spikes inward at every stair — raise Smooth outline for wide bevels'
    : undefined

/**
 * A new stamp-like layer, sized to the texture: about `cells` cells across half of it, a bevel a third of a cell (half
 * a pixel at pixel-art sizes: crisp, full height at the edge).
 */
function freshStamp(texture: { width: number; height: number }, cells: number): ParamValues {
  const scale = Math.max(1, Math.round((0.5 * Math.min(texture.width, texture.height)) / cells))
  return { scale, bevel: scale >= 3 ? Math.round(scale * 0.35) : 0.5 }
}

const STAMP_GLSL = /* glsl */ `
// 1, read from a uniform: loops bounded by it are not unrolled by D3D (see ORG_1 in organicShared).
#define STM_1 (uRes.x > 0.0 ? 1 : 0)
ivec4 stm_t(ivec2 c) { return ivec4(texelFetch(t_stamp, c, 0) * 255.0 + 0.5); }
#ifdef STAMP_IMAGE
// Stamp › Image file: the image's colour (sRGB, straight alpha) at bitmap position b — the pixel itself, or bilinear
// (Smooth image; mixed premultiplied, so transparent pixels don't darken the edge).
vec4 stm_image(vec2 b, vec2 dims) {
  ivec2 m = textureSize(t_img, 0) - 1;
  vec2 bb = clamp(b, vec2(0.0), dims - 1e-3);
  if (!u_img_smooth) return texelFetch(t_img, clamp(ivec2(floor(bb)), ivec2(0), m), 0);
  vec2 g = bb - 0.5;
  ivec2 i0 = ivec2(floor(g));
  vec2 f = g - floor(g);
  vec4 c = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    vec4 t = texelFetch(t_img, clamp(i0 + ivec2(j & 1, j >> 1), ivec2(0), m), 0);
    c += vec4(t.rgb * t.a, t.a) * ((j & 1) == 1 ? f.x : 1.0 - f.x) * ((j >> 1) == 1 ? f.y : 1.0 - f.y);
  }
  return vec4(c.a > 1e-4 ? c.rgb / c.a : vec3(0.0), c.a);
}
#endif
// The bevel's rise at signed distance d (px) — Bevel and Profile as the wrapper draws them (flat: 1 inside).
float stm_bev(float d) { return u_bevel <= 0.0 || u_profile == 0 ? (d <= 0.0 ? 1.0 : 0.0) : profileCurve(u_profile, max(-d, 0.0) / u_bevel); }

// Bevel aspect: the squared distance from b to the unit cell box at lo (bitmap cells, b outside it) in the stretched
// space Mb maps cell offsets into — to its two faces on b's side (turned by Angle, the box is a parallelogram there and
// the nearest point is not the clamped one).
float stm_box2(vec2 b, vec2 lo, mat2 Mb) {
  vec2 f = lo + step(lo + 0.5, b);
  vec2 ax = Mb * (vec2(f.x, lo.y) - b), ay = Mb * (vec2(lo.x, f.y) - b);
  vec2 vx = ax + Mb[1] * clamp(-dot(ax, Mb[1]) / dot(Mb[1], Mb[1]), 0.0, 1.0);
  vec2 vy = ay + Mb[0] * clamp(-dot(ay, Mb[0]) / dot(Mb[0], Mb[0]), 0.0, 1.0);
  return min(dot(vx, vx), dot(vy, vy));
}

// The repeats a coordinate may touch along one axis: f = its position in steps from the first repeat, e = the reach of
// one repeat in steps; the nearest one when none reaches. At most three.
ivec2 stm_range(float f, float e, float n) {
  float lo = ceil(f - e);
  float hi = floor(f + e);
  if (lo > hi) { lo = floor(f + 0.5); hi = lo; }
  lo = clamp(lo, 0.0, n - 1.0);
  hi = clamp(hi, lo, min(n - 1.0, lo + 2.0));
  return ivec2(lo, hi);
}

GenOut gen(vec2 p) {
  ivec2 ts = textureSize(t_stamp, 0);
  ivec4 h0 = stm_t(ivec2(0, ts.y - 1));
  ivec2 sz = ivec2(h0.x + h0.y * 256, h0.z + h0.w * 256);
  if (sz.x == 0 || sz.y == 0) return genOut(0.0, 0.0, 0.0, 1e4);
  // Margin, cells per bitmap cell (a smoothed outline is stored finer) and the outline mode.
  ivec4 h1 = stm_t(ivec2(1, ts.y - 1));
  int M = h1.x + h1.y * 256;
  bool smoothMap = h1.w == 1;
  ivec2 mapMax = ivec2(ts.x, ts.y - 1) - 1;
  vec2 dims = vec2(sz);
  bool odd = u_rotate == 1 || u_rotate == 3;
  vec2 outDims = odd ? dims.yx : dims;
  float sc = max(u_scale, 0.01) / float(max(h1.z, 1));
  vec2 hs = outDims * sc * 0.5;
  bool turned = mod(u_angle, 360.0) != 0.0;
  float ca = cos(radians(u_angle));
  float sa = sin(radians(u_angle));
  // How far one repeat reaches from its centre (px).
  vec2 ext = (turned ? vec2(length(hs)) : hs) + max(u_grow, 0.0) + u_jitter + 1.0;

  // Positions with y down from the top; the offset from the centre wraps on tileable projects.
  vec2 q = vec2(p.x, uRes.y - p.y);
  vec2 centre = vec2(u_x, u_y) * uRes;
  vec2 dq = q - centre;
  if (uTile) dq -= uRes * floor(dq / uRes + 0.5);
  vec2 cnt = vec2(float(u_count_x), float(u_count_y));
  // Spacing by gap: the repeat's extent (its bounding box when turned) plus the gap.
  vec2 box = turned ? vec2(abs(ca) * hs.x + abs(sa) * hs.y, abs(sa) * hs.x + abs(ca) * hs.y) * 2.0 : hs * 2.0;
  vec2 stp = u_step_by == 1 ? max(box + vec2(u_gap_x, u_gap_y) * max(u_scale, 0.01), 0.0) : vec2(u_step_x, u_step_y);
  vec2 ss = max(stp, 1e-3);
  vec2 c0 = (cnt - 1.0) * 0.5;
  vec2 e = ext / ss;
  // Tileable: also the repeats a texture away (the far end of a grid wraps round to this side).
  bool altX = uTile && cnt.x > 1.0;
  ivec2 ry0 = stm_range(dq.y / ss.y + c0.y, e.y, cnt.y);
  ivec2 ry1 = uTile && cnt.y > 1.0 ? stm_range((dq.y - uRes.y * sign(dq.y)) / ss.y + c0.y, e.y, cnt.y) : ivec2(1, 0);

  // Every repeat that may reach here (overlapping repeats merge): rows from both ranges, up to three repeats per row
  // from each of its two x ranges — one flat loop.
  float best = 1e9;
  int bestLv = 0;
  ivec2 bestId = ivec2(0);
  vec2 bestB = vec2(0.0);
  // The two deepest repeats under the pixel (depth, centre): where repeats overlap, depth is taken against the union's
  // outline — √(a² + b²) of the two, so an outline hidden inside the other repeat leaves no groove. Coincident
  // repeats (step 0) count once.
  float dep1 = 0.0;
  float dep2 = 0.0;
  vec2 cen1 = vec2(1e9);
  vec2 cen2 = vec2(-1e9);
  // Bevel aspect (GLSL_BEVEL) on the exact outline: the distance in the space the aspect stretches, to the same cells
  // (a cell offset → screen px → × Bevel / its width per screen axis), so the bevels meet in clean mitres. Mb maps a
  // bitmap-cell offset there: undo the quarter turns, cells → px, undo Angle. (Even strokes cap each axis' width at 0.4
  // cell, as they cap the bevel.) bestS, sdep1/2: as best, dep1/2.
  bool aspX = bevelAspectOn() && !smoothMap;
  vec2 Wb = bevelWidths();
  if (u_bev_lim) Wb = min(Wb, vec2(0.4 * max(u_scale, 0.01)));
  mat2 Rq = u_rotate == 1 ? mat2(0.0, 1.0, -1.0, 0.0) : u_rotate == 2 ? mat2(-1.0, 0.0, 0.0, -1.0)
          : u_rotate == 3 ? mat2(0.0, -1.0, 1.0, 0.0) : mat2(1.0);
  mat2 Mb = mat2(u_bevel / Wb.x, 0.0, 0.0, u_bevel / Wb.y) * (turned ? mat2(ca, sa, -sa, ca) : mat2(1.0)) * Rq * sc;
  // The cells searched round the pixel's: 3×3, or 5×5 with the aspect — the nearest cell in the stretched space can lie
  // a cell or two along an edge from the nearest one (the candidates are those cells and their own nearest ones).
  int nb = aspX ? 5 : 3;
  float bestS = 1e9;
  float sdep1 = 0.0;
  float sdep2 = 0.0;
  for (int k = 0; k < 36 * STM_1; k++) {
    // (No continue: ANGLE / D3D11 can miscompile it in a loop — the body is skipped by a flag instead.)
    int ky = k / 6;
    int kx = k - ky * 6;
    int iy = ky < 3 ? ry0.x + ky : ry1.x + ky - 3;
    bool use = ky < 3 ? iy <= ry0.y : (iy <= ry1.y && (iy < ry0.x || iy > ry0.y));
    float shift = (float(iy) - c0.y) * u_skew;
    ivec2 rx0 = stm_range((dq.x - shift) / ss.x + c0.x, e.x, cnt.x);
    ivec2 rx1 = altX ? stm_range((dq.x - uRes.x * sign(dq.x) - shift) / ss.x + c0.x, e.x, cnt.x) : ivec2(1, 0);
    int ix = kx < 3 ? rx0.x + kx : rx1.x + kx - 3;
    use = use && (kx < 3 ? ix <= rx0.y : (ix <= rx1.y && (ix < rx0.x || ix > rx0.y)));
    ivec2 id = ivec2(ix, iy);
    use = use && !(u_drop > 0.0 && hashI(id, uSeed + 31.0) < u_drop);
    if (use) {
      // The repeat's top-left corner snapped to the pixel grid (whole pixel sizes stay crisp), the pixel in its cells.
      vec2 ic = centre + (vec2(id) - c0) * stp + vec2(shift, 0.0);
      if (u_jitter > 0.0) ic += (hash2I(id, uSeed + 17.0) * 2.0 - 1.0) * u_jitter;
      vec2 tl = floor(ic - hs + 0.5);
      vec2 o = centre + dq - ic;
      if (uTile) o -= uRes * floor(o / uRes + 0.5);
      vec2 lp = o + ic - tl;
      if (turned) { vec2 r = lp - hs; lp = hs + vec2(ca * r.x + sa * r.y, ca * r.y - sa * r.x); }
      vec2 ob = lp / sc;
      // Output cell space → bitmap cell space.
      vec2 b = u_rotate == 1 ? vec2(ob.y, dims.y - ob.x)
             : u_rotate == 2 ? dims - ob
             : u_rotate == 3 ? vec2(dims.x - ob.y, ob.x)
             : ob;

      ivec2 cell = ivec2(floor(b)) + M;
      ivec2 tc = clamp(cell, ivec2(0), mapMax);
      ivec4 t0 = stm_t(tc);
      float d;
      float dS = 0.0;
      int lvl;
      if (smoothMap) {
        // Smoothed outline: the stored distances at the cell centres, bilinear (outside the margin: plus the way to it).
        vec2 g = b - 0.5;
        ivec2 g0 = ivec2(floor(g)) + M;
        vec4 sd;
        for (int j = 0; j < 4 * STM_1; j++) {
          ivec2 n = g0 + ivec2(j & 1, j >> 1);
          ivec2 cn = clamp(n, ivec2(0), mapMax);
          ivec4 t = stm_t(cn);
          int raw = t.y + t.z * 256;
          sd[j] = float(raw >= 32768 ? raw - 65536 : raw) / 16.0 + length(vec2(n - cn));
        }
        vec2 f = g - floor(g);
        d = mix(mix(sd.x, sd.y, f.x), mix(sd.z, sd.w, f.x), f.y) * sc;
        lvl = (t0.x & 3) > 0 ? t0.x & 3 : t0.x >> 2;
      } else {
        // Exact: distance to the nearest cell of the other state, among the 3×3 cells round this one each either of the
        // other state itself or holding its own nearest such cell (outside the stored margin: from its edge).
        int lv = tc == cell ? t0.x & 3 : 0;
        bool inside = lv > 0;
        float bd = 1e9;
        float bs = 1e9;
        int blv = lv;
        for (int j = 0; j < nb * nb * STM_1; j++) {
          ivec2 n = clamp(tc + ivec2(j % nb, j / nb) - nb / 2, ivec2(0), mapMax);
          ivec4 t = stm_t(n);
          bool other = ((t.x & 3) > 0) != inside;
          ivec2 c = other ? n : ivec2(t.y + (t.w & 15) * 256, t.z + (t.w >> 4) * 256);
          vec2 lo = vec2(c - M);
          vec2 dd = max(max(lo - b, b - lo - 1.0), 0.0);
          float d2 = dot(dd, dd);
          if (d2 < bd) { bd = d2; blv = other ? t.x & 3 : t.x >> 2; }
          if (aspX) bs = min(bs, stm_box2(b, lo, Mb));
        }
        d = (inside ? -sqrt(bd) : sqrt(bd)) * sc;
        dS = inside ? -sqrt(bs) : sqrt(bs);
        // Outside, the level of the nearest filled cell (so a grown rim keeps its cell's colour).
        lvl = inside ? lv : blv;
      }
      if (d < best) { best = d; bestLv = lvl; bestId = id; bestB = b; bestS = dS; }
      if (-d > dep1) { if (length(ic - cen1) > 0.5) { dep2 = dep1; cen2 = cen1; sdep2 = sdep1; } dep1 = -d; cen1 = ic; sdep1 = -dS; }
      else if (-d > dep2 && length(ic - cen1) > 0.5) { dep2 = -d; cen2 = ic; sdep2 = -dS; }
    }
  }
  // The distance's direction (uniform control flow, before returning): Bevel aspect on the smoothed outline and as a
  // fallback on the outline itself.
  vec2 gb = vec2(dFdx(best), dFdy(best));
  if (best > 1e8) return genOut(0.0, 0.0, 0.0, 1e4);
  if (best < 0.0) { best = -sqrt(dep1 * dep1 + dep2 * dep2); bestS = -sqrt(sdep1 * sdep1 + sdep2 * sdep2); }
  // The local stretch: px of Bevel per px across the outline (exact: from the stretched distance, so continuous through
  // a mitre; else from the distance's direction).
  float kS = aspX && abs(best) > 0.05 ? bestS / best : u_bevel / bevelWidth(gb);
  float best0 = best;
  // Even strokes (Label): depth scaled so the bevel ends 0.4 cell in — inside the middle of a one-cell stroke.
  if (u_bev_lim && best < 0.0 && u_bevel > 0.4 * max(u_scale, 0.01)) best *= u_bevel / (0.4 * max(u_scale, 0.01));
  float d = sdOnion(best - u_grow, u_outline);
  float h = mix(u_rnd_lo, u_rnd_hi, hashI(bestId, uSeed + 53.0));
  float rnd = u_rnd_by == 0 ? float(bestLv) / 3.0 : u_rnd_by == 1 ? h : (float(max(bestLv, 1)) - 1.0 + h) / 3.0;
  // The level edges ("≥ 2", "≥ 3" areas), for Level relief and for anti-aliased level colours (stored only when the
  // bitmap has more than one level).
  bool lvTex = textureSize(t_lv, 0).x > 1;
  bool aaLv = lvTex && u_aa && u_rnd_by != 1;
  GenOut g = genOut(1.0, 1.0, rnd, d);
  // Bevel aspect: the outline's distance (grown, as an outline) × the local stretch — exactly the stretched distance on
  // the exact outline without Grow / Outline, and along straight runs with them. The smoothed outline (no corners)
  // keeps the distance's direction. (Even strokes: Mb caps the widths instead of scaling the depth.)
  bool asp = bevelAspectOn();
  float dB = d;
  if (aspX) {
    dB = u_grow == 0.0 && u_outline <= 0.0 ? bestS : sdOnion(best0 - u_grow, u_outline) * kS;
    g.bdist = dB;
  } else if (asp) dB = d * kS;
  if (lvTex && (u_lvl_h > 0.0 || aaLv)) {
    float d2;
    float d3;
    // Bevel aspect on the level edges, as on the outline (stretched).
    float d2S = 0.0;
    float d3S = 0.0;
    if (smoothMap) {
      // Smoothed: the stored centre distances, bilinear.
      vec2 gq = bestB - 0.5;
      ivec2 g0 = ivec2(floor(gq)) + M;
      vec2 f = gq - floor(gq);
      ivec2 lvMax = textureSize(t_lv, 0) - 1;
      vec4 l2;
      vec4 l3;
      for (int j = 0; j < 4 * STM_1; j++) {
        ivec2 n = g0 + ivec2(j & 1, j >> 1);
        ivec2 cn = clamp(n, ivec2(0), lvMax);
        ivec4 t = ivec4(texelFetch(t_lv, cn, 0) * 255.0 + 0.5);
        int r2 = t.x + t.y * 256;
        int r3 = t.z + t.w * 256;
        float out_ = length(vec2(n - cn));
        l2[j] = float(r2 >= 32768 ? r2 - 65536 : r2) / 16.0 + out_;
        l3[j] = float(r3 >= 32768 ? r3 - 65536 : r3) / 16.0 + out_;
      }
      d2 = mix(mix(l2.x, l2.y, f.x), mix(l2.z, l2.w, f.x), f.y) * sc;
      d3 = mix(mix(l3.x, l3.y, f.x), mix(l3.z, l3.w, f.x), f.y) * sc;
      // (No corners: from each distance's direction.)
      float e2 = max(d2, d), e3 = max(d3, d);
      d2S = bevelLine(e2, vec2(dFdx(e2), dFdy(e2)));
      d3S = bevelLine(e3, vec2(dFdx(e3), dFdy(e3)));
    } else {
      // Exact: the nearest cell across each level edge among the 3×3 round the pixel, as for the outline (square steps).
      ivec2 cell = ivec2(floor(bestB)) + M;
      ivec2 tc = clamp(cell, ivec2(0), mapMax);
      ivec4 o2 = ivec4(texelFetch(t_lv, ivec2(tc.x * 2, tc.y), 0) * 255.0 + 0.5);
      ivec4 o3 = ivec4(texelFetch(t_lv, ivec2(tc.x * 2 + 1, tc.y), 0) * 255.0 + 0.5);
      bool in2 = tc == cell && (o2.w & 1) == 1;
      bool in3 = tc == cell && (o3.w & 1) == 1;
      vec2 bd = vec2(1e9);
      vec2 bs = vec2(1e9);
      for (int j = 0; j < 2 * nb * nb * STM_1; j++) {
        int l = j / (nb * nb);
        int m = j - l * nb * nb;
        ivec2 n = clamp(tc + ivec2(m % nb, m / nb) - nb / 2, ivec2(0), mapMax);
        ivec4 t = ivec4(texelFetch(t_lv, ivec2(n.x * 2 + l, n.y), 0) * 255.0 + 0.5);
        bool other = ((t.w & 1) == 1) != (l == 0 ? in2 : in3);
        ivec2 c = other ? n : ivec2(t.x + (t.z & 15) * 256, t.y + (t.z >> 4) * 256);
        vec2 lo = vec2(c - M);
        vec2 dd = max(max(lo - bestB, bestB - lo - 1.0), 0.0);
        if (l == 0) bd.x = min(bd.x, dot(dd, dd)); else bd.y = min(bd.y, dot(dd, dd));
        if (aspX) {
          float s2 = stm_box2(bestB, lo, Mb);
          if (l == 0) bs.x = min(bs.x, s2); else bs.y = min(bs.y, s2);
        }
      }
      d2 = (o2.w & 2) == 0 ? 1e4 : (in2 ? -sqrt(bd.x) : sqrt(bd.x)) * sc;
      d3 = (o3.w & 2) == 0 ? 1e4 : (in3 ? -sqrt(bd.y) : sqrt(bd.y)) * sc;
      d2S = max((o2.w & 2) == 0 ? 1e4 : in2 ? -sqrt(bs.x) : sqrt(bs.x), dB);
      d3S = max((o3.w & 2) == 0 ? 1e4 : in3 ? -sqrt(bs.y) : sqrt(bs.y), dB);
    }
    if (u_lvl_h > 0.0) {
      // Level relief: the outline's bevel plus a bevel up each level edge, a third each — for Height › Pattern
      // (GenOut.hval).
      // (Bevel aspect: the stretched distances, px of Bevel, as the wrapper takes GenOut.bdist.)
      float b1 = stm_bev(asp ? dB : d);
      g.hval = mix(b1, (b1 + stm_bev(asp ? d2S : max(d2, d)) + stm_bev(asp ? d3S : max(d3, d))) / 3.0, u_lvl_h);
    }
    if (aaLv) {
      // Anti-aliased level colours: each level area's coverage across its edge (outside the outline, as at its edge),
      // so the per-feature random blends over the edge pixel like the outline does.
      float lift = max(best - u_grow + 0.5, 0.0);
      float lvl = 1.0 + clamp(0.5 - d2 + lift, 0.0, 1.0) + clamp(0.5 - d3 + lift, 0.0, 1.0);
      g.rnd = u_rnd_by == 0 ? lvl / 3.0 : (lvl - 1.0 + h) / 3.0;
    }
  }
#ifdef STAMP_IMAGE
  // Image file: the image's pixel under the cell (past the outline, the nearest one): its colour into Diffuse (in place
  // of the ramp, gGenRgb), or its brightness into Height (× the bevel, as genOutShaded); its alpha fades the coverage.
  vec4 ic = vec4(1.0);
  float val = float(bestLv) / 3.0;
  if (u_source == 1) {
    ic = stm_image(bestB, dims);
    val = dot(ic.rgb, vec3(0.2126, 0.7152, 0.0722));
  }
  // Wear: values below a threshold drop out, the threshold varied over the stamp by a few octaves of noise (each
  // repeat its own): dark (or, inverted, bright) values and the noise's high spots go first.
  float keep = 1.0;
  if (u_wear > 0.0) {
    vec2 wp = bestB / max(max(dims.x, dims.y), 1.0) * u_wear_scale;
    float ws = uSeed + 71.0 + 97.0 * hashI(bestId, uSeed + 7.0);
    float n = 0.0, a = 1.0, na = 0.0;
    for (int o = 0; o < 8; o++) {
      if (o < u_wear_oct) {
        n += a * perlinNoise(wp, NO_PERIOD, ws + float(o) * 31.0);
        na += a;
      }
      a *= 0.5;
      wp *= 2.0;
    }
    // 0: below every value (nothing drops) … 1: above every value (all gone); the noise spreads it over the stamp.
    float t = 2.0 * u_wear - 1.0 + n / max(na, 1e-4);
    keep = smoothstep(t - u_wear_soft, t + u_wear_soft + 1e-4, u_wear_inv ? 1.0 - val : val);
  }
  if (u_source == 1 && u_into == 1) {
    g.own = 2;
    g.value = val;
    g.mask = ic.a * keep * coverage(d, u_aa);
  } else {
    if (u_source == 1) gGenRgb = ic.rgb;
    g.mask *= ic.a * keep;
  }
#endif
  return g;
}
`

/** The default stamp: a warning triangle, two levels, the exclamation mark cut out. */
const DEFAULT_PIXELS = [
  '..........##..........',
  '..........##..........',
  '.........####.........',
  '.........####.........',
  '........######........',
  '........##++##........',
  '.......###++###.......',
  '......###+..+###......',
  '......##++..++##......',
  '.....###++..++###.....',
  '.....##+++..+++##.....',
  '....###+++..+++###....',
  '...###++++..++++###...',
  '...##++++++++++++##...',
  '..###+++++..+++++###..',
  '..##++++++..++++++##..',
  '.###++++++++++++++###.',
  '.####################.',
  '######################',
].join('\n')

const fromImage = (p: ParamValues) => p.source === 'image'
const worn = (p: ParamValues) => Number(p.wear) > 0
const NO_IMAGE: CpuTexture = { width: 1, height: 1, data: new Uint8Array(4) }

/**
 * Stamp › Image file: the image's pixels at least Alpha cut opaque are the cells (one level), the image itself goes up
 * as t_img. Nothing (an empty bitmap) while it decodes or when none is picked.
 */
function imageTextures(q: ParamValues): Record<string, CpuTexture> {
  const img = getImage(String(q.image ?? ''))
  const cut = Math.round(Math.min(1, Math.max(0.004, Number(q.alpha_cut ?? 0.5))) * 255)
  const c: Cells = img ? { w: img.width, h: img.height, lv: new Uint8Array(img.width * img.height) } : { w: 0, h: 0, lv: new Uint8Array(0) }
  if (img) for (let i = 0; i < c.lv.length; i++) c.lv[i] = img.data[i * 4 + 3] >= cut ? 3 : 0
  // (Join diagonals, Mirror and Level relief are the typed pixels' alone.)
  const t = layerTextures(c, { ...q, join: false, lvl_h: 0 })
  return { ...t, img: img ? { width: img.width, height: img.height, data: img.data } : NO_IMAGE }
}

export const stampLayer: LayerDef = {
  type: 'stamp',
  label: 'Stamp',
  category: 'shape',
  kind: 'generator',
  sdf: true,
  description: 'A hand-drawn pixel bitmap or an image file (insignia, emblem, decal) as a shape: typed rows of cells (# full, + mid, - low, . empty), or a PNG / JPEG / WebP whose colours go into Diffuse or its brightness into Height.',
  params: [
    P.enum('source', 'Source', 'pixels', [
      ['pixels', 'Typed pixels', 'rows of cell characters'],
      ['image', 'Image file', 'a PNG, JPEG or WebP: its opaque pixels are the stamp, one cell each'],
    ]),
    P.image('image', 'Image', {
      showIf: fromImage,
      hint: 'A PNG, JPEG or WebP, scaled down on loading to fit the texture (at most 1024 px): each of its pixels is a cell, Pixel size texture px across. The project saves its file name; the image itself stays in this browser (load it again elsewhere)',
    }),
    P.enum('into', 'Into', 'diffuse', [
      ['diffuse', 'Diffuse', 'the image’s colours, in place of the colour ramp'],
      ['height', 'Height', 'the image’s brightness as height (× the bevel at its outline)'],
    ], { showIf: fromImage, hint: 'Where the image goes. Its outline still bevels and writes the mask either way' }),
    P.float('alpha_cut', 'Alpha cut', 0.5, 0.004, 1, { step: 0.001, showIf: fromImage, hint: 'Pixels at least this opaque are the stamp; their alpha still fades the colour' }),
    P.bool('img_smooth', 'Smooth image', false, { showIf: fromImage, hint: 'Blend between the image’s pixels (when Pixel size enlarges it) instead of keeping each one square' }),
    P.bitmap('pixels', 'Pixels', DEFAULT_PIXELS, 'pixels', {
      uniform: false,
      showIf: (p) => !fromImage(p),
      hint: 'One row per line (up to 128 × 128): "#" full, "+" mid, "-" low level, "." or space empty. Levels drive Per-feature colour',
    }),
    P.enum('mirror', 'Mirror', 'none', [['none', 'None'], ['odd', 'Mirror (shared centre column)'], ['even', 'Mirror (no shared column)']], {
      showIf: (p) => !fromImage(p),
      hint: 'Draw only the left half; the right half is reflected',
    }),
    P.float('lvl_h', 'Level relief', 1, 0, 1, {
      step: 0.001,
      showIf: (p) => !fromImage(p),
      hint: 'Height follows the cell levels: "-" a third, "+" two thirds, "#" full, each step bevelled like the outline (Height › Pattern) — multi-tone bitmaps emboss. Cells drawn "+" or "-" only for their colour (a rivet\'s highlight) then sit lower too — set 0 for one height for all'
    }),
    P.bool('join', 'Join diagonals', false, {
      showIf: (p) => !fromImage(p),
      hint: 'Bridges cells that touch only at a corner with two half-cell squares, so one-cell diagonal lines (and an X’s crossing) bevel as one stroke instead of a row of squares; nothing else changes — square corners stay square',
    }),
    ...placement,
    P.float('wear', 'Wear', 0, 0, 1, {
      step: 0.001,
      group: 'wear',
      hint: 'Drops out values below a threshold that noise varies over the stamp: the dark parts of an image (the low levels of typed pixels) and the noise’s high spots go first — worn paint, a scuffed decal. 0 = none, 1 = all gone',
    }),
    P.float('wear_scale', 'Noise scale', 4, 0.25, 256, { softMax: 32, step: 0.01, group: 'wear', showIf: worn, hint: 'Noise features across the stamp (each repeat wears its own way)' }),
    P.int('wear_oct', 'Octaves', 4, 1, 8, { group: 'wear', showIf: worn, hint: 'Noise octaves: more = finer, ragged edges to the worn patches' }),
    P.float('wear_soft', 'Softness', 0.04, 0, 0.5, { step: 0.001, group: 'wear', showIf: worn, hint: 'Fades the dropped-out edge instead of cutting it' }),
    P.bool('wear_inv', 'Bright parts first', false, { group: 'wear', showIf: worn, hint: 'Wear the bright values first instead of the dark ones' }),
  ],
  groups: [...stampGroups, { id: 'wear', label: 'Wear', collapsed: true }],
  // An image goes into one output: Diffuse (its colours) or Height (its brightness) — the other starts off.
  linkedDefaults: (p) => (fromImage(p) ? { dif_on: p.into !== 'height', h_on: p.into === 'height' } : { dif_on: true, h_on: true }),
  defaults,
  paramPatch: { bevel: { note: (p) => wideBevelNote(p) } },
  migrate: migrateSpacing,
  fresh: (t) => freshStamp(t, 22),
  textures: ['stamp', 'lv', 'img'],
  cpuData: (q) => (fromImage(q) ? imageTextures(q) : { ...layerTextures(mirrorCells(parseCells(String(q.pixels ?? '')), q.mirror), q), img: NO_IMAGE }),
  glsl: 'const bool u_bev_lim = false;\n#define STAMP_IMAGE\n' + STAMP_GLSL,
}

export const labelLayer: LayerDef = {
  type: 'label',
  label: 'Label',
  category: 'shape',
  kind: 'generator',
  sdf: true,
  description: 'Pixel-font lettering (3×5 or 5×7 px letters, digits, punctuation) — crate numbers, panel codes, warning text.',
  params: [
    P.bitmap('text', 'Text', 'BAY 03', 'font', { uniform: false, hint: 'Letters, digits and punctuation; "|" or a new line starts a new line. The small font has capitals only' }),
    P.enum('font', 'Font', 'large', [
      ['small', 'Compact 3 × 5 (capitals)', 'letters 3 cells wide, 5 tall — for small textures; lower case is drawn as capitals'],
      ['large', 'Full 5 × 7', 'letters 5 cells wide, 7 tall (descenders one more), lower case — legible at larger sizes'],
    ]),
    P.int('spacing', 'Letter spacing', 1, 0, 32, { softMax: 4, hint: 'Empty cells between letters' }),
    P.int('line_gap', 'Line spacing', 2, 0, 64, { softMax: 8, hint: 'Empty rows between lines' }),
    P.enum('align', 'Align', 'center', [['center', 'Centre'], ['left', 'Left'], ['right', 'Right']], { hint: 'Lines within the widest one' }),
    P.bool('bold', 'Bold', false, { hint: 'Doubles the upright strokes (each letter one cell wider)' }),
    P.bool('join', 'Join diagonals', true, {
      hint: 'Joins cells that touch only at a corner. With Smooth outline below 1: two half-cell squares bridge each such corner (square corners stay square). From 1: the letters are drawn as strokes through the cell centres — straight diagonals (an X crosses cleanly), straight runs kept, round ends',
    }),
    P.bool('bev_lim', 'Even strokes', true, {
      hint: 'Limits the bevel to just under half a stroke (0.4 cell), so thin strokes rise to full height like their junctions — no bright beads where strokes meet',
    }),
    ...placement,
  ],
  groups: stampGroups,
  defaults: { ...defaults, smooth: 1, gap_y: 2, rnd_lo: 0.25 },
  migrate: migrateSpacing,
  paramPatch: {
    bevel: {
      note: (p) => {
        const cap = 0.4 * Number(p.scale ?? 1)
        return p.bev_lim && Number(p.bevel) > cap ? `Capped at ${Math.round(cap * 10) / 10} px (0.4 cell) by Even strokes` : wideBevelNote(p)
      },
    },
  },
  // Sized to the texture: small textures get the compact font, and below 3 px cells the plain pixel outline (joined,
  // smoothed strokes need room).
  fresh: (t) => {
    const small = Math.min(t.width, t.height) < 128
    const f = freshStamp(t, small ? 24 : 36)
    const big = Number(f.scale) >= 3
    return { ...f, ...(small ? { font: 'small', line_gap: 1 } : {}), ...(big ? {} : { smooth: 0, join: false }) }
  },
  textures: ['stamp', 'lv'],
  cpuData: (q) => {
    // With Join diagonals, bold is applied after the join (only the advance is widened here).
    const c = textCells(String(q.text ?? ''), {
      font: q.font === 'large' ? 'large' : 'small',
      spacing: Number(q.spacing ?? 1),
      lineGap: Number(q.line_gap ?? 1),
      align: q.align === 'left' || q.align === 'right' ? q.align : 'center',
      bold: Boolean(q.bold),
      boldAdvanceOnly: Boolean(q.join),
      strokeGlyphs: Boolean(q.join) && Number(q.smooth ?? 0) >= 1,
    })
    return layerTextures(c, { ...q, _boldLate: Boolean(q.join), _strokes: true })
  },
  // No Level relief on lettering (all one level).
  glsl: 'const float u_lvl_h = 0.0;\n' + STAMP_GLSL,
}

// ------------------------------------------------------------------------------------------------ Path / Polyline

/** A shape layer drawn from vertex coordinates in a 64 px square, scaled to the texture. */
const scaledPoints = (src: string, texture: { width: number; height: number }) =>
  src.replace(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g, (_, x, y) => `${Math.round((Number(x) * texture.width) / 64)},${Math.round((Number(y) * texture.height) / 64)}`)

// A corner's round (fillet) of radius R between the edges v → a and v → b: (t, centre, r) — t how far back along each
// edge the round starts, r its radius (0: sharp). Rounds take at most half of either edge.
const FILLET_GLSL = /* glsl */ `
float shp_cross(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
vec4 shp_fillet(vec2 a, vec2 v, vec2 b, float R) {
  vec2 e1 = a - v;
  vec2 e2 = b - v;
  float l1 = length(e1);
  float l2 = length(e2);
  if (R <= 0.0 || l1 < 1e-4 || l2 < 1e-4) return vec4(0.0, v, 0.0);
  e1 /= l1;
  e2 /= l2;
  float c = clamp(dot(e1, e2), -1.0, 1.0);
  vec2 bis = e1 + e2;
  float bl = length(bis);
  if (c < -0.99999 || bl < 1e-5) return vec4(0.0, v, 0.0);
  float tn = sqrt((1.0 - c) / (1.0 + c));
  float t = min(R / max(tn, 1e-4), 0.5 * min(l1, l2));
  float r = t * tn;
  return vec4(t, v + bis / bl * sqrt(t * t + r * r), r);
}
// p in the sector of the round (between its centre's rays to the two tangent points t1, t2)?
bool shp_sector(vec2 p, vec2 c, vec2 t1, vec2 t2) {
  float cr = shp_cross(t1 - c, t2 - c);
  return shp_cross(t1 - c, p - c) * cr >= 0.0 && shp_cross(p - c, t2 - c) * cr >= 0.0;
}
// The torus copies a tileable project evaluates (the centre first).
const ivec2 SHP_TILE[9] = ivec2[9](ivec2(0, 0), ivec2(-1, -1), ivec2(0, -1), ivec2(1, -1), ivec2(-1, 0), ivec2(1, 0), ivec2(-1, 1), ivec2(0, 1), ivec2(1, 1));
`

const pointsHint = 'x,y vertex pairs (px from the top-left, or 0..1 with Units = fraction); one polygon per line or "|". Max 64 vertices'

export const pathLayer: LayerDef = {
  type: 'path',
  label: 'Path',
  category: 'shape',
  kind: 'generator',
  sdf: true,
  description: 'Arbitrary polygons from a vertex list — chamfered cut-outs, Z-shaped channels, trims; overlapping polygons cut holes (even–odd) or merge (union).',
  params: [
    P.bitmap('points', 'Points', '8,16 24,8 56,8 56,48 40,56 8,56', 'points', { hint: pointsHint }),
    P.enum('units', 'Units', 'px', [['px', 'Pixels'], ['fraction', 'Fraction of the texture']]),
    P.enum('fill', 'Fill', 'evenodd', [
      ['evenodd', 'Even–odd', 'overlaps cut holes: a polygon inside another is a hole, one inside that solid again'],
      ['union', 'Union', 'every polygon solid, overlaps merge (a plate with a tab)'],
      ['subtract', 'First minus the rest', 'the first polygon solid, every later one cut out of it'],
    ]),
    P.float('radius', 'Corner radius', 0, 0, 4096, { softMax: 64, unit: 'px', step: 0.1, hint: 'Rounds the corners (a round takes at most half of either edge)' }),
    P.enum('round_at', 'Round', 'all', [
      ['all', 'All corners'],
      ['convex', 'Outer corners', 'corners pointing out of their polygon'],
      ['concave', 'Inner corners', 'corners pointing into their polygon'],
    ], { showIf: (p) => Number(p.radius) > 0 }),
    P.float('grow', 'Grow', 0, -1024, 1024, { softMin: -64, softMax: 64, unit: 'px', step: 0.1, hint: 'Offsets the outline: out (rounding the outer corners) or in' }),
    P.float('outline', 'Outline', 0, 0, 1024, { softMax: 32, unit: 'px', step: 0.1, hint: '0 = solid; otherwise only a stroke of this width inside the outline' }),
    P.float('scale', 'Scale', 1, 0.01, 100, { softMin: 0.1, softMax: 4, step: 0.001, hint: 'Sizes the polygons about the centre of their bounds (bevels and radii stay in px)' }),
    P.float('rotation', 'Rotation', 0, -360, 360, { softMin: -180, softMax: 180, unit: '°', step: 0.1, hint: 'Turns them about the same centre, clockwise' }),
    P.int('rep_x', 'Repeat X', 1, 1, 64, { softMax: 16, group: 'repeat', hint: 'Copies of the polygons side by side (Offset X / Y under Shaping moves them all)' }),
    P.int('rep_y', 'Repeat Y', 1, 1, 64, { softMax: 16, group: 'repeat' }),
    P.float('rep_dx', 'Step X', 64, -4096, 4096, { softMin: 0, softMax: 512, unit: 'px', step: 0.5, group: 'repeat', showIf: (p) => Number(p.rep_x) > 1, hint: 'Between copies, rightward' }),
    P.float('rep_dy', 'Step Y', 64, -4096, 4096, { softMin: 0, softMax: 512, unit: 'px', step: 0.5, group: 'repeat', showIf: (p) => Number(p.rep_y) > 1, hint: 'Between copies, downward' }),
    P.seed('seed', 'Seed', 1, { hint: 'Reshuffles the per-feature random: one value per filled region' }),
  ],
  groups: [{ id: 'repeat', label: 'Repeat', collapsed: true }],
  // Per polygon, whether its corners point the other way relative to the filled area (a hole): for Round outer /
  // inner corners. Even–odd: polygons inside an odd number of others; First minus the rest: all but the first.
  textures: ['poly'],
  cpuData: (q, ctx) => {
    const k = q.units === 'fraction' ? [ctx.width, ctx.height] : [1, 1]
    const polys: number[][][] = []
    let n = 0
    for (const poly of parsePolygons(String(q.points ?? ''))) {
      if (n + poly.length > MAX_PATH_POINTS) break
      polys.push(poly.map(([x, y]) => [x * k[0], y * k[1]]))
      n += poly.length
    }
    const inside = (p: number[], poly: number[][]) => {
      let c = false
      poly.forEach(([ax, ay], i) => {
        const [bx, by] = poly[(i + 1) % poly.length]
        if (ay > p[1] !== by > p[1] && p[0] < ax + ((p[1] - ay) * (bx - ax)) / (by - ay)) c = !c
      })
      return c
    }
    const data = new Uint8Array(Math.max(1, polys.length) * 4)
    polys.forEach((poly, i) => {
      // A point just inside the polygon: its first vertex, nudged toward the middle of its first edge's neighbours.
      const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length
      const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length
      const pt = [poly[0][0] + (cx - poly[0][0]) * 1e-3, poly[0][1] + (cy - poly[0][1]) * 1e-3]
      const depth = polys.reduce((d, o, j) => d + (j !== i && inside(pt, o) ? 1 : 0), 0)
      const hole = q.fill === 'subtract' ? i > 0 : q.fill === 'union' ? false : depth % 2 === 1
      data[i * 4] = hole ? 255 : 0
    })
    return { poly: { width: Math.max(1, polys.length), height: 1, data } }
  },
  defaults: { bevel: 1, radius: 1, profile: 'round', h_on: true, h_amount: 0.6, dif_on: true },
  fresh: (t) => {
    const s = Math.min(t.width, t.height)
    return { points: scaledPoints('8,16 24,8 56,8 56,48 40,56 8,56', t), bevel: Math.max(1, Math.round(s / 128)), radius: Math.round(s / 64) }
  },
  glsl: FILLET_GLSL + /* glsl */ `
#define PTH_1 (uRes.x > 0.0 ? 1 : 0)
#define PTH_MAXP 22
// Per polygon: signed area (its orientation, for outer / inner corners) and, for Union / Subtract, the distance to it.
float pth_area[PTH_MAXP];
float pth_d[PTH_MAXP];
// Bevel aspect (GLSL_BEVEL): the same distances in the space the aspect stretches (squared, px of Bevel; pth_dS per
// polygon), pth_M mapping the polygons' space there, pth_bs the signed result.
bool pth_asp;
mat2 pth_M;
float pth_dS[PTH_MAXP];
float pth_bs;

// Signed distance to the polygons and the filled region's polygon: the last polygon that contains the point (outside:
// of the region across the nearest edge), so a frame with a hole is one feature.
vec2 pathSdf(vec2 q, vec2 k) {
  int n = u_points_size.x;
  int np = min(u_points_size.y, PTH_MAXP);
  // The inside tests run at a point nudged off the pixel centre, so a centre exactly on an edge (integer slopes through
  // integer vertices) is on the same side for the crossing count and for a round's corner.
  vec2 qs = q + vec2(0.00131, 0.00207);
  for (int i = 0; i < PTH_MAXP; i++) { pth_d[i] = 1e20; pth_dS[i] = 1e20; }
  float d = 1e20;
  float dS = 1e20;
  float pid = 0.0;
  int inPoly = 0; // bit i: inside polygon i (even–odd)
  for (int i = 0; i < ${MAX_PATH_POINTS}; i++) {
    if (i >= n) break;
    // The edge v → w, v the vertex after i: with v's round (from i, v, w) and w's (from v, w and the one after).
    vec4 v4 = u_points[int(u_points[i].z)];
    vec4 w4 = u_points[int(v4.z)];
    vec2 v = v4.xy * k;
    vec2 w = w4.xy * k;
    int pi = int(v4.w);
    int bit = 1 << pi;
    vec2 e = w - v;
    vec2 qv = qs - v;
    bvec3 c = bvec3(qs.y >= v.y, qs.y < w.y, e.x * qv.y > e.y * qv.x);
    if (all(c) || all(not(c))) inPoly ^= bit;
    qv = q - v;
    float dd;
    float ddS = 1e20;
    if (u_radius > 0.0) {
      vec2 a = u_points[i].xy * k;
      vec2 x = u_points[int(w4.z)].xy * k;
      // Outer / inner corners by the turn against the polygon's orientation.
      float sgn = (pi < PTH_MAXP ? sign(pth_area[pi]) : 1.0) * (texelFetch(t_poly, ivec2(pi, 0), 0).r > 0.5 ? -1.0 : 1.0);
      bool convexV = shp_cross(v - a, w - v) * sgn > 0.0;
      bool convexW = shp_cross(w - v, x - w) * sgn > 0.0;
      float rv = u_round_at == 0 || (u_round_at == 1) == convexV ? u_radius : 0.0;
      float rw = u_round_at == 0 || (u_round_at == 1) == convexW ? u_radius : 0.0;
      vec4 fv = shp_fillet(a, v, w, rv);
      float tw = shp_fillet(v, w, x, rw).x;
      float L = max(length(e), 1e-6);
      vec2 t = e / L;
      vec2 h = qv - t * clamp(dot(qv, t), fv.x, max(L - tw, fv.x));
      dd = dot(h, h);
      if (pth_asp) ddS = bevelSeg2(vec2(0.0), pth_M * (t * fv.x - qv), pth_M * (t * max(L - tw, fv.x) - qv));
      if (fv.w > 0.0) {
        vec2 t1 = v + normalize(a - v) * fv.x;
        vec2 t2 = v + t * fv.x;
        float ml = length(q - fv.yz);
        if (shp_sector(q, fv.yz, t1, t2)) dd = min(dd, (ml - fv.w) * (ml - fv.w));
        // The round, stretched: an elliptic arc (chords), from the pixel (whose sector test doesn't carry over).
        if (pth_asp) ddS = min(ddS, bevelArc2(vec2(0.0), pth_M, fv.yz - q, fv.w, normalize(t1 - fv.yz), normalize(t2 - fv.yz), normalize(v - fv.yz)));
        // Between the round and the corner the inside flips: an outer corner cut off, an inner one filled.
        float s1 = shp_cross(v - t1, qs - t1);
        float s2 = shp_cross(t2 - v, qs - v);
        float s3 = shp_cross(t1 - t2, qs - t2);
        bool tri = (s1 >= 0.0 && s2 >= 0.0 && s3 >= 0.0) || (s1 <= 0.0 && s2 <= 0.0 && s3 <= 0.0);
        if (length(qs - fv.yz) > fv.w && tri) inPoly ^= bit;
      }
    } else {
      vec2 h = qv - e * clamp(dot(qv, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
      dd = dot(h, h);
      if (pth_asp) ddS = bevelSeg2(vec2(0.0), pth_M * -qv, pth_M * (e - qv));
    }
    if (dd < d) { d = dd; pid = v4.w; }
    dS = min(dS, ddS);
    if (u_fill != 0 && pi < PTH_MAXP) { pth_d[pi] = min(pth_d[pi], dd); pth_dS[pi] = min(pth_dS[pi], ddS); }
  }
  // Inside by the fill rule; the distance from all edges (even–odd) or from the polygons combined.
  int parity = 0;
  for (int i = 0; i < PTH_MAXP; i++) parity ^= (inPoly >> i) & 1;
  bool inside = u_fill == 1 ? inPoly != 0 : u_fill == 2 ? inPoly == 1 : parity == 1;
  float sd = inside ? -sqrt(d) : sqrt(d);
  pth_bs = inside ? -sqrt(dS) : sqrt(dS);
  if (u_fill != 0) {
    // Union / First minus the rest, combined with round joins (hg_sdf's round union and intersection): where outlines
    // cross, the corner rounds with the Corner radius too — inner corners of a union, outer ones of a cut. At radius 0
    // the union's inside is √(a² + b²) of the overlapping depths, so an edge hidden in another polygon leaves no groove.
    float ru = u_round_at != 1 ? u_radius : 0.0;
    float rs = u_round_at != 2 ? u_radius : 0.0;
    // (Bevel aspect: the stretched distances combined alike, x = px, y = stretched; the stretch keeps areas, so the
    // joins' radius stays.)
    vec2 acc = vec2(1e20);
    for (int i = 0; i < PTH_MAXP * PTH_1; i++) {
      if (i < np && (u_fill == 1 || i > 0)) {
        vec2 di = (((inPoly >> i) & 1) == 1 ? -1.0 : 1.0) * sqrt(vec2(pth_d[i], pth_dS[i]));
        acc = acc.x > 1e19 ? di : max(vec2(ru), min(acc, di)) - vec2(length(max(vec2(ru - acc.x, ru - di.x), 0.0)), length(max(vec2(ru - acc.y, ru - di.y), 0.0)));
      }
    }
    if (u_fill == 1) { sd = acc.x; pth_bs = acc.y; }
    else {
      vec2 d0 = ((inPoly & 1) == 1 ? -1.0 : 1.0) * sqrt(vec2(pth_d[0], pth_dS[0]));
      vec2 c = min(vec2(-rs), max(d0, -acc)) + vec2(length(max(vec2(rs + d0.x, rs - acc.x), 0.0)), length(max(vec2(rs + d0.y, rs - acc.y), 0.0)));
      sd = acc.x > 1e19 ? d0.x : c.x;
      pth_bs = acc.x > 1e19 ? d0.y : c.y;
    }
  }
  int set = inside ? inPoly : inPoly ^ (1 << int(pid));
  return vec2(sd, floor(log2(float(max(set, 1)) + 0.5)));
}

GenOut gen(vec2 p) {
  if (u_points_size.x < 3) return genOut(0.0, 0.0, 0.0, 1e4);
  // Fractions of the texture's width and height, as the shape editor draws them.
  vec2 k = u_units == 1 ? uRes : vec2(1.0);
  int n = u_points_size.x;
  // Once per pixel: each polygon's signed area, and the bounds' centre (the pivot of Scale and Rotation).
  for (int i = 0; i < PTH_MAXP; i++) pth_area[i] = 0.0;
  vec2 lo = vec2(1e20);
  vec2 hi = vec2(-1e20);
  for (int i = 0; i < ${MAX_PATH_POINTS} * PTH_1; i++) {
    if (i >= n) break;
    vec2 a = u_points[i].xy * k;
    vec2 b = u_points[int(u_points[i].z)].xy * k;
    int pi = int(u_points[i].w);
    if (pi < PTH_MAXP) pth_area[pi] += shp_cross(a, b);
    lo = min(lo, a);
    hi = max(hi, a);
  }
  vec2 q0 = vec2(p.x, uRes.y - p.y);
  float sc = max(u_scale, 1e-3);
  float zs = 1.0 / sc;
  vec2 piv = 0.5 * (lo + hi);
  float ca = cos(radians(u_rotation));
  float sa = sin(radians(u_rotation));
  // Bevel aspect: polygon-space offsets → screen (turned back, scaled; y down, which the widths don't mind) → stretched.
  pth_asp = bevelAspectOn();
  pth_M = mat2(u_bevel / bevelWidths().x, 0.0, 0.0, u_bevel / bevelWidths().y) * mat2(ca, sa, -sa, ca) * sc;
  float rS = 1e20;
  // Repeats: the copy nearest the pixel along each axis and the next one toward it.
  vec2 rep = vec2(float(u_rep_x), float(u_rep_y));
  vec2 stepR = vec2(u_rep_dx, u_rep_dy);
  // Tileable projects: the 3×3 torus copies too, so a polygon may cross the edge. One flat loop over (torus copy ×
  // 2 × 2 repeats); a copy whose bounds lie farther than the nearest distance found so far is skipped.
  vec2 r = vec2(1e20, 0.0);
  float reach = 1e20;
  for (int c = 0; c < 36 * PTH_1; c++) {
    int tc = c / 4;
    int rc = c - tc * 4;
    if (tc > 0 && !uTile) break;
    vec2 qt = q0 + vec2(SHP_TILE[tc]) * uRes;
    vec2 f = (qt - piv) / max(abs(stepR), 1e-3) * sign(stepR + 1e-9);
    vec2 base = clamp(floor(f), vec2(0.0), max(rep - 1.0, 0.0));
    vec2 kk = clamp(base + vec2(float(rc & 1), float(rc >> 1)), vec2(0.0), max(rep - 1.0, 0.0));
    bool dup = (rc & 1) == 1 && kk.x == base.x || (rc >> 1) == 1 && kk.y == base.y;
    vec2 q = qt - kk * stepR;
    // Into the polygons' own space (Scale / Rotation about the bounds' centre).
    vec2 m = q - piv;
    q = piv + vec2(ca * m.x + sa * m.y, ca * m.y - sa * m.x) * zs;
    vec2 bx = max(max(lo - q, q - hi), 0.0);
    if (!dup && length(bx) * sc < reach) {
      vec2 o = pathSdf(q, k);
      o.x *= sc;
      if (o.x < r.x) { r = o; rS = pth_bs; }
      reach = abs(r.x) + max(u_grow, 0.0) + 2.0;
    }
  }
  float sd = sdOnion(r.x - u_grow, u_outline);
  GenOut g = genOut(1.0, 1.0, hashI(ivec2(int(r.y), 7), uSeed), sd);
  // Bevel aspect: the stretched distance to the outline, so the bevels meet in clean mitres. Grown or outlined: the
  // distance × the local stretch (stretched over plain distance to the polygons' outline) — exact along straight edges,
  // continuous through the mitres.
  vec2 gr = vec2(dFdx(r.x), dFdy(r.x));
  if (pth_asp) {
    float kS = abs(r.x) > 0.05 ? rS / r.x : u_bevel / bevelWidth(gr);
    g.bdist = u_grow == 0.0 && u_outline <= 0.0 ? rS : sd * kS;
  }
  return g;
}
`,
}

export const polylineLayer: LayerDef = {
  type: 'polyline',
  label: 'Polyline',
  category: 'shape',
  kind: 'generator',
  sdf: true,
  description: 'Open polylines with a width — cables, trims, cracks, painted and dashed lines; drawn with the Line tool on the canvas. Round or flat ends, rounded bends, tapers.',
  params: [
    P.bitmap('points', 'Points', '8,44 22,20 42,44 56,20', 'lines', {
      hint: 'x,y vertex pairs (px from the top-left, or 0..1 with Units = fraction); one line per row or "|". Max 64 vertices',
    }),
    P.enum('units', 'Units', 'px', [['px', 'Pixels'], ['fraction', 'Fraction of the texture']]),
    P.float('width', 'Width', 3, 0.25, 1024, { softMax: 64, unit: 'px', step: 0.25 }),
    P.enum('caps', 'Ends', 'round', [['round', 'Round'], ['flat', 'Flat']], { hint: 'The lines’ ends (and the dashes’)' }),
    P.enum('overlap', 'Overlap', 'stack', [
      ['merge', 'Merge', 'crossing lines become one shape (the later line’s colour where they cross)'],
      ['stack', 'Later on top', 'each line lies over the ones before it, with its own edge and bevel where it crosses them, and rises over them in height (Stack lift)'],
    ]),
    P.float('lift', 'Stack lift', 1, 0, 4, {
      softMax: 2,
      step: 0.001,
      showIf: (p) => p.overlap === 'stack',
      hint: 'How far a later line rises where it crosses an earlier one, in line heights (Height › Pattern): 0 = level with it, 1 = a full line height above. Lines that cross nothing keep their height; Height › Amount scales it all',
    }),
    P.float('lift_fall', 'Lift falloff', 0, 0, 1024, {
      softMax: 128,
      unit: 'px',
      step: 0.5,
      showIf: (p) => p.overlap === 'stack' && Number(p.lift) > 0,
      hint: 'Extra distance before the crossing over which the top line starts to rise (it always eases over a line width plus the bevel): a cable arching over another',
    }),
    P.float('radius', 'Corner radius', 4.5, 0, 4096, { softMax: 128, unit: 'px', step: 0.1, hint: 'Bends the line round each corner: the radius of its inner edge (the centre line bends on this plus half the width; at most half of either segment) — cable and pipe runs. 0 = sharp inner corners' }),
    P.float('taper', 'Taper', 0, 0, 1, { step: 0.001, hint: 'Narrows each line toward its end(s): 1 = to a point' }),
    P.enum('taper_at', 'Taper to', 'end', [['end', 'End'], ['start', 'Start'], ['both', 'Both ends']], { showIf: (p) => Number(p.taper) > 0 }),
    P.float('taper_len', 'Taper length', 1, 0.01, 1, { step: 0.001, showIf: (p) => Number(p.taper) > 0 && !(Number(p.taper_px) > 0), hint: 'Share of each line the taper takes (both ends: half of it at each) — short for brush strokes that end in a point' }),
    P.float('taper_px', 'Taper length (px)', 0, 0, 4096, { softMax: 512, unit: 'px', step: 0.5, showIf: (p) => Number(p.taper) > 0, hint: 'The taper\'s length in px at each tapered end (the same tips on long and short lines); 0 = by the share above' }),
    P.enum('taper_curve', 'Taper shape', 'linear', [
      ['linear', 'Straight', 'the width falls evenly: a spike'],
      ['smooth', 'Smooth', 'eases in and out: no corner where the taper starts'],
      ['round', 'Round', 'stays wide, then rounds off quickly: a brush or bullet tip'],
    ], { showIf: (p) => Number(p.taper) > 0 }),
    P.float('dash', 'Dash', 0, 0, 4096, { softMax: 64, unit: 'px', step: 0.5, hint: '0 = solid; otherwise dashes this long along each line (each its own per-feature random)' }),
    P.float('gap', 'Gap', 8, 0, 4096, { softMax: 64, unit: 'px', step: 0.5, showIf: (p) => Number(p.dash) > 0, hint: 'Space between dashes' }),
    P.bool('dash_fit', 'Fit to each line', true, { showIf: (p) => Number(p.dash) > 0, hint: 'Stretches dash and gap a little so every line starts and ends on a whole dash' }),
    P.float('dash_ofs', 'Dash offset', 0, -4096, 4096, { softMin: -64, softMax: 64, unit: 'px', step: 0.5, showIf: (p) => Number(p.dash) > 0, hint: 'Slides the dashes along the lines' }),
    P.float('outline', 'Outline', 0, 0, 512, { softMax: 32, unit: 'px', step: 0.1, hint: '0 = solid; otherwise only a stroke of this width inside the edge — twin rails' }),
    P.seed('seed', 'Seed', 1, { hint: 'Reshuffles the per-feature random (per line, or per dash)' }),
  ],
  defaults: { bevel: 1.5, profile: 'round', h_on: true, h_amount: 0.6, dif_on: true },
  fresh: (t) => {
    const width = Math.max(2, Math.round(Math.min(t.width, t.height) / 40))
    return { points: scaledPoints('8,44 22,20 42,44 56,20', t), width, radius: width * 1.5, bevel: width / 2 }
  },
  glsl: FILLET_GLSL + /* glsl */ `
#define PLN_1 (uRes.x > 0.0 ? 1 : 0)
#define PLN_LINES 32

// Width factor at x along a line of length L (0 = its start … 1 = its end) for the taper: s = 0 where the taper
// starts … 1 at the tip, shaped by Taper shape.
float pln_taper(float x, float L) {
  float l = u_taper_px > 0.0 ? min(u_taper_px / max(L, 1e-3), u_taper_at == 2 ? 0.5 : 1.0) * (u_taper_at == 2 ? 2.0 : 1.0) : max(u_taper_len, 1e-3);
  float s = clamp(u_taper_at == 1 ? (l - x) / l : u_taper_at == 2 ? max(0.5 * l - x, x - 1.0 + 0.5 * l) / (0.5 * l) : (x - 1.0 + l) / l, 0.0, 1.0);
  float f = u_taper_curve == 1 ? s * s * (3.0 - 2.0 * s) : u_taper_curve == 2 ? 1.0 - sqrt(max(1.0 - s * s, 0.0)) : s;
  return 1.0 - u_taper * f;
}
// The bevel's rise at signed distance d (px), as the wrapper draws it (flat: 1 inside).
float pln_bev(float d) { return u_bevel <= 0.0 || u_profile == 0 ? (d <= 0.0 ? 1.0 : 0.0) : profileCurve(u_profile, max(-d, 0.0) / u_bevel); }

// Per line: its length as drawn (the taper) and along its rounds (fitting the dashes), and per pixel the distance to it
// and its nearest dash.
float pln_len[PLN_LINES];
float pln_flen[PLN_LINES];
float pln_d[PLN_LINES];
float pln_dash[PLN_LINES];
// Bevel aspect (GLSL_BEVEL): the same distances in the space the aspect stretches (px of Bevel), each piece's term
// across its own edge (bevelLine with the piece's normal) — the flat ends and dash ends exact, as half-planes, so their
// corners meet in clean mitres.
bool pln_asp;
mat2 pln_M;          // screen px → the stretched space (px of Bevel)
float pln_reach;     // the widest bevel
float pln_dS[PLN_LINES];
// A half circle in nine points from its start (0) to its end (π): cos, sin.
const vec2 PLN_HC[9] = vec2[9](vec2(1.0, 0.0), vec2(0.92388, 0.38268), vec2(0.70711, 0.70711), vec2(0.38268, 0.92388),
  vec2(0.0, 1.0), vec2(-0.38268, 0.92388), vec2(-0.70711, 0.70711), vec2(-0.92388, 0.38268), vec2(-1.0, 0.0));
// A distance d and its stretched one dS through Outline: the band's inner edge at the same local stretch.
float pln_onion(float d, float dS) { return u_outline > 0.0 ? sdOnion(d, u_outline) * (abs(d) > 0.05 ? dS / d : 1.0) : dS; }

// Distance to each open polyline (segments whose "next" wraps back close a line: skipped), minus half the width, into
// pln_d / pln_dash.
void lineSdf(vec2 q, vec2 k, float hw) {
  int n = u_points_size.x;
  for (int i = 0; i < PLN_LINES * PLN_1; i++) { pln_d[i] = 1e20; pln_dash[i] = 0.0; pln_dS[i] = 1e20; }
  float s0 = 0.0; // along the line as drawn, at the segment's start (the taper)
  float f0 = 0.0; // along the line with its rounds (the dashes)
  for (int i = 0; i < ${MAX_PATH_POINTS}; i++) {
    if (i >= n) break;
    vec4 a4 = u_points[i];
    int j = int(a4.z);
    int li = min(int(a4.w), PLN_LINES - 1);
    // Segments whose "next" wraps back (a line's closing one) are skipped — by a flag, not continue (ANGLE / D3D11).
    if (j > i) {
      bool first = i == 0 || u_points[i - 1].w != a4.w;
      bool last = int(u_points[j].z) <= j;
      if (first) { s0 = 0.0; f0 = 0.0; }
      vec2 a = a4.xy * k;
      vec2 b = u_points[j].xy * k;
      vec2 e = b - a;
      float L = max(length(e), 1e-6);
      vec2 t = e / L;
      vec2 w = q - a;
      float u = dot(w, t);
      float v = dot(w, vec2(-t.y, t.x));
      // Rounds at the inner vertices: this segment starts ta after a and ends fb.x before b, then bends round b.
      float ta = 0.0;
      vec4 fb = vec4(0.0);
      vec2 nb = b;
      if (u_radius > 0.0) {
        // Corner radius is the inner edge's: the centre line bends on radius + half the width (no cusp when wide).
        if (!first) ta = shp_fillet(u_points[i - 1].xy * k, a, b, u_radius + hw).x;
        if (!last) { nb = u_points[j + 1].xy * k; fb = shp_fillet(a, b, nb, u_radius + hw); }
      }
      float uc = clamp(u, ta, max(L - fb.x, ta));
      float ex = abs(u - uc); // past the straight part's end
      float pv = abs(v);      // across the line
      // (Bevel aspect: the piece's directions across (nA, with the signed offset vs) and along (nL, ex's sign sx).)
      vec2 nA = vec2(-t.y, t.x), nL = t;
      float vs = v, sx = u < uc ? -1.0 : 1.0;
      float exC = ex;
      bool inSec = false;
      float adv = 0.0;
      vec2 mr = vec2(0.0);
      float sl = s0 + uc;
      float fl = f0 + uc - ta;
      float arc = 0.0;
      if (fb.w > 0.0) {
        vec2 t1 = b - t * fb.x;
        vec2 t2 = b + normalize(nb - b) * fb.x;
        vec2 m = q - fb.yz;
        float span = acos(clamp(dot(normalize(t1 - fb.yz), normalize(t2 - fb.yz)), -1.0, 1.0));
        arc = span * fb.w;
        float ad = abs(length(m) - fb.w);
        inSec = shp_sector(q, fb.yz, t1, t2);
        adv = ad;
        mr = m;
        if (inSec && ad < length(vec2(ex, pv))) {
          float ang = acos(clamp(dot(normalize(t1 - fb.yz), normalize(m)), -1.0, 1.0));
          ex = 0.0;
          pv = ad;
          nA = m;
          nL = vec2(m.y, -m.x);
          vs = length(m) - fb.w;
          sl = s0 + L - fb.x + 2.0 * fb.x * ang / max(span, 1e-5);
          fl = f0 + L - fb.x - ta + ang * fb.w;
        }
      }
      float hwk = u_taper > 0.0 ? hw * pln_taper(sl / max(pln_len[li], 1e-6), pln_len[li]) : hw;
      float dd;
      float ddS = 1e20;
      float dash = 0.0;
      if (u_dash > 0.0) {
        // Along the line to the nearest dash (0 on one), its index. Fitted: dash and gap scaled so the line holds a
        // whole number of dashes, one at either end.
        float dl = u_dash;
        float gl = max(u_gap, 0.0);
        if (u_dash_fit) {
          float lf = pln_flen[li];
          float cnt = max(1.0, floor((lf + gl) / (dl + gl) + 0.5));
          float f = lf / max(cnt * dl + (cnt - 1.0) * gl, 1e-3);
          dl *= f;
          gl *= f;
        }
        float per = dl + gl;
        float z = fl - u_dash_ofs;
        float ph = z - per * floor(z / per);
        bool on = ph < dl;
        float gapD = on ? 0.0 : min(ph - dl, per - ph);
        dash = floor(z / per) + (!on && ph - dl > per - ph ? 1.0 : 0.0);
        float al = (on ? -min(ph, dl - ph) : gapD) + ex;
        dd = u_caps == 1 ? max(pv - hwk, al) : length(vec2(ex + gapD, pv)) - hwk;
        if (pln_asp) {
          // Along: past the straight part, else towards the nearer dash (behind it, or ahead).
          float sa = ex > 0.0 ? sx : ph - dl < per - ph ? 1.0 : -1.0;
          ddS = u_caps == 1 ? max(bevelLine(pv - hwk, nA), bevelLine(al, nL)) : bevelLine(dd, sa * (ex + gapD) * nL + vs * nA);
        }
      } else {
        dd = length(vec2(ex, pv)) - hwk;
        if (pln_asp) {
          // The straight part's capsule: inside, the deepest of its sides (half-planes) and its round ends — each end's
          // half circle, an elliptic arc stretched (chords), only near enough to matter (no nearer than a side further
          // off); outside, across by its direction. The bend's band (Corner radius), a curve: across by its radial
          // direction. Their union.
          vec2 n0 = vec2(-t.y, t.x);
          float dc = length(vec2(exC, v)) - hwk;
          float cS = bevelLine(dc, (u - uc) * t + v * n0);
          if (dc < 0.0) {
            cS = bevelLine(abs(v) - hwk, n0);
            float uB = max(L - fb.x, ta);
            float m2 = 1e20;
            for (int j = 0; j < 16 * PLN_1; j++) {
              int en = j / 8, kk = j - en * 8;
              float ue = en == 0 ? ta : uB;
              if (abs(u - ue) < hwk + pln_reach) {
                vec2 md = en == 0 ? -t : t;
                vec2 c0 = a + t * ue - q;
                vec2 h0 = PLN_HC[kk], h1 = PLN_HC[kk + 1];
                m2 = min(m2, bevelSeg2(vec2(0.0), pln_M * (c0 + hwk * (h0.x * n0 + h0.y * md)), pln_M * (c0 + hwk * (h1.x * n0 + h1.y * md))));
              }
            }
            cS = max(cS, -sqrt(m2));
          }
          ddS = min(cS, inSec ? bevelLine(adv - hwk, mr) : 1e20);
        }
      }
      if (u_caps == 1) {
        // Flat ends: cut square at a line's first and last vertex.
        if (first && u < 0.0) { dd = max(abs(v) - hwk, -u); ddS = max(bevelLine(abs(v) - hwk, vec2(-t.y, t.x)), bevelLine(-u, t)); }
        if (last && u > L) { dd = max(abs(v) - hwk, u - L); ddS = max(bevelLine(abs(v) - hwk, vec2(-t.y, t.x)), bevelLine(u - L, t)); }
      }
      if (dd < pln_d[li]) { pln_d[li] = dd; pln_dash[li] = dash; }
      pln_dS[li] = min(pln_dS[li], ddS);
      s0 += L;
      f0 += L - ta - fb.x + arc;
    }
  }
}

GenOut gen(vec2 p) {
  if (u_points_size.x < 2) return genOut(0.0, 0.0, 0.0, 1e4);
  // Fractions of the texture's width and height, as the shape editor draws them.
  vec2 k = u_units == 1 ? uRes : vec2(1.0);
  int n = u_points_size.x;
  int nl = min(u_points_size.y, PLN_LINES);
  // Once per pixel: each line's length as drawn and along its rounds (for the taper and fitted dashes).
  for (int i = 0; i < PLN_LINES * PLN_1; i++) { pln_len[i] = 0.0; pln_flen[i] = 0.0; }
  if (u_taper > 0.0 || (u_dash > 0.0 && u_dash_fit)) {
    for (int i = 0; i < ${MAX_PATH_POINTS} * PLN_1; i++) {
      if (i >= n) break;
      int j = int(u_points[i].z);
      int li = min(int(u_points[i].w), PLN_LINES - 1);
      if (j > i) {
        vec2 a = u_points[i].xy * k;
        vec2 b = u_points[j].xy * k;
        float L = length(b - a);
        pln_len[li] += L;
        pln_flen[li] += L;
        // A round at b shortens the line by 2t and adds its arc.
        if (u_radius > 0.0 && int(u_points[j].z) > j) {
          vec2 c = u_points[j + 1].xy * k;
          vec4 f = shp_fillet(a, b, c, u_radius + 0.5 * u_width);
          float cs = dot(normalize(a - b), normalize(c - b));
          pln_flen[li] += f.w > 0.0 ? f.w * (3.14159265 - acos(clamp(cs, -1.0, 1.0))) - 2.0 * f.x : 0.0;
        }
      }
    }
  }
  float hw = 0.5 * u_width;
  vec2 q = vec2(p.x, uRes.y - p.y);
  // Tileable projects: the nearest of the 3×3 torus copies of each line, so a line may cross the edge.
  float best[PLN_LINES];
  float bdash[PLN_LINES];
  float bestS[PLN_LINES];
  pln_asp = bevelAspectOn();
  pln_M = mat2(u_bevel / bevelWidths().x, 0.0, 0.0, u_bevel / bevelWidths().y);
  pln_reach = max(bevelWidths().x, bevelWidths().y);
  for (int i = 0; i < PLN_LINES * PLN_1; i++) { best[i] = 1e20; bdash[i] = 0.0; bestS[i] = 1e20; }
  for (int c = 0; c < 9; c++) {
    if (c > 0 && !uTile) break;
    lineSdf(q + vec2(SHP_TILE[c]) * uRes, k, hw);
    for (int i = 0; i < PLN_LINES * PLN_1; i++) {
      if (pln_d[i] < best[i]) { best[i] = pln_d[i]; bdash[i] = pln_dash[i]; }
      bestS[i] = min(bestS[i], pln_dS[i]);
    }
  }
  // The lines combined: the union (the two deepest where they cross, so a crossing has no crease), or the topmost line
  // over the rest, blended across its anti-aliased edge. The per-feature random is the topmost line's under the pixel
  // (the nearest line's outside them all).
  float d = 1e20;
  float a1 = 0.0;
  float a2 = 0.0;
  // (Bevel aspect: the same union of the stretched distances, apart — each is continuous on its own.)
  float dS = 1e20;
  float s1 = 0.0;
  float s2 = 0.0;
  int top = -1;
  int near = 0;
  for (int i = 0; i < PLN_LINES * PLN_1; i++) {
    if (i < nl) {
      float di = best[i];
      if (di < d) { d = di; near = i; }
      if (-di > a1) { a2 = a1; a1 = -di; } else if (-di > a2) a2 = -di;
      if (di < (u_overlap == 1 ? 0.5 : 0.0)) top = i;
      float si = bestS[i];
      dS = min(dS, si);
      if (-si > s1) { s2 = s1; s1 = -si; } else if (-si > s2) s2 = -si;
    }
  }
  if (d < 0.0) d = -sqrt(a1 * a1 + a2 * a2);
  if (dS < 0.0) dS = -sqrt(s1 * s1 + s2 * s2);
  int feat = top >= 0 ? top : near;
  float hv = -1.0;
  if (u_overlap == 1 && top >= 0) {
    // Later on top: the top line's own distance, eased into the union of the lines below across its edge pixel.
    float under = 1e20;
    float b1 = 0.0;
    float b2 = 0.0;
    float underS = 1e20;
    float c1 = 0.0;
    float c2 = 0.0;
    int below = -1;
    for (int i = 0; i < PLN_LINES * PLN_1; i++) {
      if (i < top) {
        under = min(under, best[i]);
        if (-best[i] > b1) { b2 = b1; b1 = -best[i]; } else if (-best[i] > b2) b2 = -best[i];
        if (best[i] < 0.0) below = i;
        underS = min(underS, bestS[i]);
        if (-bestS[i] > c1) { c2 = c1; c1 = -bestS[i]; } else if (-bestS[i] > c2) c2 = -bestS[i];
      }
    }
    if (under < 0.0) under = -sqrt(b1 * b1 + b2 * b2);
    if (underS < 0.0) underS = -sqrt(c1 * c1 + c2 * c2);
    float dt = best[top];
    float dtS = bestS[top];
    d = mix(min(under, dt), dt, clamp(0.5 - dt, 0.0, 1.0));
    dS = mix(min(underS, dtS), dtS, clamp(0.5 - dt, 0.0, 1.0));
    // The colour: the top line where the pixel's centre is on it, else the topmost line below that is.
    if (dt >= 0.0 && below >= 0) feat = below;
    // Height (GenOut.height, may pass 1): the top line's profile raised by Stack lift where it passes over the lines
    // below — eased by the distance to them, from a line width plus the bevel (plus Lift falloff) outside their edge to
    // full over their crown, so it arches over — and never below their surface, so its sides settle onto them.
    // (Bevel aspect: the stretched distances, as the wrapper takes GenOut.bdist.)
    float U = pln_bev(pln_asp ? pln_onion(under, underS) : sdOnion(under, u_outline));
    float bt = pln_bev(pln_asp ? pln_onion(dt, dtS) : sdOnion(dt, u_outline));
    float S = 1.0 - smoothstep(-hw, u_width + u_bevel + u_lift_fall, under);
    hv = max(U, bt * (1.0 + u_lift * S));
  } else if (u_overlap == 1) {
    hv = pln_bev(pln_asp ? pln_onion(d, dS) : sdOnion(d, u_outline));
  }
  float rnd = u_dash > 0.0 ? hashI(ivec2(feat, 7919 + int(bdash[feat])), uSeed) : hashI(ivec2(feat, 7), uSeed);
  float sd = sdOnion(d, u_outline);
  // Later on top: its own height profile, anti-aliased by the coverage (the wrapper doesn't limit it).
  GenOut g = genOut(1.0, 1.0, rnd, sd);
  if (u_overlap == 1) g = genOutHeight(1.0, 1.0, rnd, sd, hv * coverage(sd, u_aa));
  if (pln_asp) g.bdist = pln_onion(d, dS);
  return g;
}
`,
}

export const STAMP_LAYERS: LayerDef[] = [stampLayer, labelLayer, pathLayer, polylineLayer]
