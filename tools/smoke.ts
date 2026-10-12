// Smoke test: render every registered layer type and post filter in a tiny project, report shader errors
// and timings, and write a contact sheet per group.
//
//   npx tsx tools/smoke.ts [--out harness-out/smoke] [--size 64] [--only type1,type2]

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { contactSheet, decodePng, writePng, type Rgba8 } from './png'
import type {} from '../src/headless'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function chromiumEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  const lib = join(ROOT, '.cache/chromium-libs/usr/lib/x86_64-linux-gnu')
  if (existsSync(lib)) env.LD_LIBRARY_PATH = [lib, join(lib, 'nss'), env.LD_LIBRARY_PATH].filter(Boolean).join(':')
  return env
}

const flag = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}

async function main() {
  const out = resolve(flag('out', join(ROOT, 'harness-out/smoke')))
  const size = Number(flag('size', '64'))
  const only = flag('only', '').split(',').filter(Boolean)
  mkdirSync(out, { recursive: true })

  const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'error', server: { port: 5192, strictPort: false, host: '127.0.0.1' } })
  await server.listen()
  const builtins = await server.ssrLoadModule('/src/render/builtins.ts')
  builtins.ensureBuiltins()
  const layerReg = await server.ssrLoadModule('/src/layers/registry.ts')
  const postReg = await server.ssrLoadModule('/src/render/post/registry.ts')
  const layerTypes: { type: string; kind: string }[] = layerReg.allLayerDefs().map((d: { type: string; kind: string }) => ({ type: d.type, kind: d.kind }))
  const postTypes: string[] = postReg.allPostDefs().map((d: { type: string }) => d.type)

  const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5192/'
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], env: chromiumEnv() })
  const page = await browser.newPage()
  const consoleErrors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(e.message))
  await page.goto(url + '?headless')
  await page.waitForFunction(() => window.__bismith?.ready === true, null, { timeout: 60_000 })

  const light = { type: 'directional', params: { azimuth: 315, elevation: 35, intensity: 1.4 } }
  const baseLayers = [
    { type: 'noise', params: { scale: 4, h_on: true, h_amount: 0.3, dif_on: true } },
    { type: 'rect', params: { inset_x: size / 5, inset_y: size / 5, radius: size / 12, bevel: 0, profile: 'flat', h_on: true, h_amount: 1 } },
  ]

  let failures = 0
  async function run(name: string, project: object): Promise<Rgba8 | null> {
    consoleErrors.length = 0
    try {
      const r = await page.evaluate((p) => {
        const a = window.__bismith!
        a.loadProject(p)
        return a.render({ samples: 8 })
      }, project)
      const errs = [...Object.values(r.errors), ...consoleErrors.filter((e) => !/GPU stall/.test(e))]
      const status = errs.length ? 'FAIL' : 'ok'
      if (errs.length) failures++
      console.log(`${status.padEnd(4)} ${name.padEnd(28)} ${r.ms.toFixed(0).padStart(5)} ms${errs.length ? '  ' + errs[0].slice(0, 300) : ''}`)
      return decodePng(Buffer.from(r.png.split(',')[1], 'base64'))
    } catch (e) {
      failures++
      console.log(`FAIL ${name.padEnd(28)} ${e instanceof Error ? e.message.slice(0, 300) : e}`)
      return null
    }
  }

  const sheets: Record<string, Rgba8[]> = { generators: [], filters: [], post: [] }
  for (const { type, kind } of layerTypes) {
    if (only.length && !only.includes(type)) continue
    const layers = kind === 'generator' ? [{ type, params: {} }] : [...baseLayers, { type, params: {} }]
    const img = await run(`layer:${type}`, { width: size, height: size, tileable: true, layers, lighting: { lights: [light] }, render: { maxSamples: 8 }, post: [{ type: 'tonemap' }] })
    if (img) sheets[kind === 'generator' ? 'generators' : 'filters'].push(img)
  }
  for (const type of postTypes) {
    if (only.length && !only.includes(type)) continue
    const layers = [
      ...baseLayers,
      { type: 'rect', params: { size_mode: 'size', width: size * 0.6, height: 3, radius: 1.5, bevel: 1, h_on: true, h_amount: 0.3, e_on: true, e_src: 'flat', e_intensity: 6 } },
    ]
    const post = type === 'tonemap' ? [{ type }] : [{ type, params: {} }, { type: 'tonemap' }]
    const img = await run(`post:${type}`, { width: size, height: size, tileable: true, layers, lighting: { lights: [light] }, render: { maxSamples: 8 }, post })
    if (img) sheets.post.push(img)
  }

  for (const [k, imgs] of Object.entries(sheets)) {
    if (!imgs.length) continue
    // Wrap into rows of 8.
    const rows: Rgba8[] = []
    for (let i = 0; i < imgs.length; i += 8) rows.push(contactSheet(imgs.slice(i, i + 8), 2))
    const w = Math.max(...rows.map((r) => r.width))
    const h = rows.reduce((s, r) => s + r.height, 0)
    const data = new Uint8Array(w * h * 4)
    let y0 = 0
    for (const r of rows) {
      for (let y = 0; y < r.height; y++) data.set(r.data.subarray(y * r.width * 4, (y + 1) * r.width * 4), ((y0 + y) * w) * 4)
      y0 += r.height
    }
    writePng(join(out, `${k}.png`), { width: w, height: h, data })
    console.log(`sheet ${k} → ${join(out, `${k}.png`)}`)
  }

  await browser.close()
  await server.close()
  console.log(failures ? `${failures} failure(s)` : 'all passed')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
