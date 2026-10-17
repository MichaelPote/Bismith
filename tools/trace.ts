// Trace a reference into a stacked-relief project skeleton (docs/features/fr7.4-hand-authoring.md).
//
//   npx tsx tools/trace.ts <ref.png> [--tiers 3] [--mirror auto|x|none] [--min 3] [--depth 2] [--step 0.3]
//                          [--chroma 45] [--out harness-out/studio/<name>.json]
//
// For greeble-dense references (consoles, control panels) whose layout is too intricate to place by hand:
// luminance is split into tiers by 1-D k-means (tier 0, the darkest, is the background); each tier t ≥ 1 becomes a
// Stamp of the pixels at tier ≥ t — nested masks, so the stamps stack into a stepped relief, each with a short
// bevel lit by the painted key light. Specks smaller than --min px are removed per tier, and a left–right
// symmetric reference is traced from its left half and mirrored. Colours are the tier means of the reference.
// The result is a starting point: materials, lights and details are then authored on top.

import { writeFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { readPng } from './png'

const args = process.argv.slice(2)
const flag = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : d
}
const file = args[0]
const img = readPng(file)
const W = img.width
const H = img.height
const tiers = Number(flag('tiers', '3'))
const minPx = Number(flag('min', '3'))
const depth = Number(flag('depth', '2'))
const step = Number(flag('step', '0.3'))
const name = basename(file, extname(file))
const out = resolve(flag('out', `harness-out/studio/${name}.json`)!)

const lum = new Float32Array(W * H)
for (let i = 0; i < W * H; i++) lum[i] = (0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2]) / 255

// 1-D k-means on luminance → K = tiers + 1 centres, sorted dark → light.
const K = tiers + 1
const sorted = [...lum].sort((a, b) => a - b)
let centres = Array.from({ length: K }, (_, k) => sorted[Math.floor(((k + 0.5) / K) * sorted.length)])
for (let it = 0; it < 30; it++) {
  const sum = new Array(K).fill(0)
  const cnt = new Array(K).fill(0)
  for (const v of lum) {
    let b = 0
    for (let k = 1; k < K; k++) if (Math.abs(v - centres[k]) < Math.abs(v - centres[b])) b = k
    sum[b] += v
    cnt[b]++
  }
  centres = centres.map((c, k) => (cnt[k] ? sum[k] / cnt[k] : c)).sort((a, b) => a - b)
}
const tier = new Uint8Array(W * H)
for (let i = 0; i < W * H; i++) {
  let b = 0
  for (let k = 1; k < K; k++) if (Math.abs(lum[i] - centres[k]) < Math.abs(lum[i] - centres[b])) b = k
  tier[i] = b
}

// Mirror detection: mean |left − mirrored right| luminance.
let asym = 0
for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) asym += Math.abs(lum[y * W + x] - lum[y * W + (W - 1 - x)])
asym /= (W / 2) * H
const mirrorFlag = flag('mirror', 'auto')
const mirror = mirrorFlag === 'x' || (mirrorFlag === 'auto' && asym < 0.06)

// Mean colour per tier.
const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const tierColour = Array.from({ length: K }, (_, k) => {
  const s = [0, 0, 0]
  let n = 0
  for (let i = 0; i < W * H; i++) if (tier[i] === k) { s[0] += img.data[i * 4]; s[1] += img.data[i * 4 + 1]; s[2] += img.data[i * 4 + 2]; n++ }
  return hex(s.map((v) => v / Math.max(1, n)))
})

// Per tier t ≥ 1: mask of tier ≥ t, small components removed, as Stamp rows (left half when mirrored).
const cw = mirror ? Math.ceil(W / 2) : W
function rowsFor(t: number): string[] {
  const m = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) m[i] = tier[i] >= t ? 1 : 0
  const seen = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || seen[i]) continue
    const comp: number[] = []
    const st = [i]
    seen[i] = 1
    while (st.length) {
      const j = st.pop()!
      comp.push(j)
      const x = j % W
      const y = (j / W) | 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = (x + dx + W) % W
        const ny = (y + dy + H) % H
        const n = ny * W + nx
        if (m[n] && !seen[n]) { seen[n] = 1; st.push(n) }
      }
    }
    if (comp.length < minPx) for (const j of comp) m[j] = 0
  }
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let r = ''
    for (let x = 0; x < cw; x++) r += m[y * W + x] ? '#' : '.'
    rows.push(r)
  }
  return rows
}

const L = (type: string, name: string, params: Record<string, unknown>) => ({ type, name, params })
const layers: unknown[] = [
  L('noise', 'Grain', { noise: 'white', h_on: false, dif_on: true, dif_opacity: 0.25, dif_grad: { stops: [{ pos: 0, color: tierColour[0] }, { pos: 1, color: tierColour[1] }] } }),
]
// Stamps hold ≤ 64×64 cells: wider / taller references are traced in 64-cell tiles.
for (let t = 1; t < K; t++) {
  const rows = rowsFor(t)
  for (let ty = 0; ty < H; ty += 64)
    for (let tx = 0; tx < cw; tx += 64) {
      const part = rows.slice(ty, ty + 64).map((r) => r.slice(tx, tx + 64))
      if (!part.some((r) => r.includes('#'))) continue
      const pw = part[0].length
      const ph = part.length
      const x0 = tx
      const cx = x0 + (mirror && tx + pw >= cw ? (W - 2 * x0) / 2 : pw / 2)
      layers.push(
        L('stamp', `Tier ${t}${H > 64 || cw > 64 ? ` (${tx},${ty})` : ''}`, {
          pixels: part.join('\n'),
          mirror: mirror && tx + pw >= cw ? (W % 2 ? 'odd' : 'even') : 'none',
          x: cx / W,
          y: (ty + ph / 2) / H,
          scale: 1,
          bevel: 1,
          profile: 'linear',
          aa: false,
          mk_target: '',
          h_on: true,
          h_amount: step,
          dif_on: true,
          dif_src: 'flat',
          dif_grad: { stops: [{ pos: 0, color: tierColour[t] }] },
        }),
      )
    }
}

// Colour pass: saturated pixels (screens, lamps, warning stripes) grouped into six hue sectors, each stamped at full
// width (never mirrored — screen content is rarely symmetric) in its mean colour with a little emission.
const minChroma = Number(flag('chroma', '45'))
const sectors: number[][] = Array.from({ length: 6 }, () => [])
for (let i = 0; i < W * H; i++) {
  const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2]
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  if (mx - mn < minChroma || mx < 40) continue
  const d = mx - mn
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  if (h < 0) h += 6
  sectors[Math.floor((h + 0.5) % 6)].push(i)
}
sectors.forEach((px, k) => {
  if (px.length < 4) return
  const sum = [0, 0, 0]
  for (const i of px) for (let c = 0; c < 3; c++) sum[c] += img.data[i * 4 + c]
  const colour = hex(sum.map((v) => v / px.length))
  const set = new Set(px)
  for (let ty = 0; ty < H; ty += 64)
    for (let tx = 0; tx < W; tx += 64) {
      const rows: string[] = []
      for (let y = ty; y < Math.min(H, ty + 64); y++) {
        let r = ''
        for (let x = tx; x < Math.min(W, tx + 64); x++) r += set.has(y * W + x) ? '#' : '.'
        rows.push(r)
      }
      if (!rows.some((r) => r.includes('#'))) continue
      layers.push(
        L('stamp', `Colour ${['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'][k]}${H > 64 || W > 64 ? ` (${tx},${ty})` : ''}`, {
          pixels: rows.join('\n'),
          mirror: 'none',
          x: (tx + rows[0].length / 2) / W,
          y: (ty + rows.length / 2) / H,
          scale: 1,
          bevel: 0,
          profile: 'flat',
          aa: false,
          mk_target: '',
          h_on: false,
          dif_on: true,
          dif_src: 'flat',
          dif_grad: { stops: [{ pos: 0, color: colour }] },
          e_on: true,
          e_src: 'flat',
          e_color: colour,
          e_intensity: 0.15,
        }),
      )
    }
})

// Grain over everything: the references are speckled within each tier.
layers.push(L('noise', 'Speckle', { noise: 'white', seed: 3, h_on: false, dif_on: true, dif_blend: 'overlay', dif_opacity: 0.15, dif_grad: { stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }] } }))

const project = {
  _ref: resolve(file),
  _maps: true,
  _trace: { tiers: centres.map((c) => +c.toFixed(3)), colours: tierColour, mirror, asymmetry: +asym.toFixed(4) },
  name,
  width: W,
  height: H,
  tileable: true,
  heightDepth: depth,
  base: { color: tierColour[0], roughness: 0.95 },
  layers,
  lighting: {
    sky: { enabled: true, zenith: '#d8dde2', horizon: '#c9c6c0', intensity: 0.15 },
    ambient: { color: '#ffffff', intensity: 0.02 },
    lights: [{ type: 'directional', params: { azimuth: 315, elevation: 28, angle: 2, intensity: 1.8, color: '#ffffff' } }],
  },
  render: { maxSamples: 96, bounces: 1, jitter: false, specular: 0, shadows: false },
  post: [{ type: 'tonemap', params: { operator: 'clamp' } }, { type: 'palette', params: { palette: 'quake' } }],
}
writeFileSync(out, JSON.stringify(project, null, 1))
console.log(`${name}: ${W}×${H} · tiers ${centres.map((c) => c.toFixed(2)).join(' ')} · ${tierColour.join(' ')} · mirror ${mirror} (asym ${asym.toFixed(3)}) → ${out}`)
