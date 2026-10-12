// Grid contact sheet of many PNGs (nearest-scaled to fit a cell, aspect kept), for surveying texture sets.
//   npx tsx tools/grid.ts <out.png> --cell 64 --cols 16 <files…>   (or --list file.txt with one path per line)

import { readFileSync } from 'node:fs'
import { readPng, writePng, type Rgba8 } from './png'

const args = process.argv.slice(2)
const flag = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`)
  if (i < 0) return d
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const cell = Number(flag('cell', '64'))
const cols = Number(flag('cols', '16'))
const list = flag('list', '')
const [out, ...rest] = args
const files = list ? readFileSync(list, 'utf8').split('\n').filter(Boolean) : rest
const gap = 4
const rows = Math.ceil(files.length / cols)
const W = cols * (cell + gap) + gap
const H = rows * (cell + gap) + gap
const data = new Uint8Array(W * H * 4)
for (let i = 0; i < W * H; i++) data.set([30, 33, 36, 255], i * 4)
files.forEach((f, idx) => {
  let img: Rgba8
  try {
    img = readPng(f)
  } catch {
    return
  }
  const s = Math.min(cell / img.width, cell / img.height)
  const w = Math.max(1, Math.round(img.width * s))
  const h = Math.max(1, Math.round(img.height * s))
  const x0 = gap + (idx % cols) * (cell + gap) + Math.floor((cell - w) / 2)
  const y0 = gap + Math.floor(idx / cols) * (cell + gap) + Math.floor((cell - h) / 2)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = (Math.min(img.height - 1, Math.floor(y / s)) * img.width + Math.min(img.width - 1, Math.floor(x / s))) * 4
      const di = ((y0 + y) * W + x0 + x) * 4
      data[di] = img.data[si]
      data[di + 1] = img.data[si + 1]
      data[di + 2] = img.data[si + 2]
      data[di + 3] = 255
    }
})
writePng(out, { width: W, height: H, data })
console.log(`grid ${files.length} → ${out} (${W}×${H})`)
