// Bismith headless harness (docs/features/fr6.2-headless-harness.md).
//
// Starts Vite in-process, opens the app with ?headless in a browser and drives window.__bismith
// (src/headless.ts) through tools/backend.ts. Default backend: headless Chrome on the Windows host with GPU
// WebGL (`--backend windows`); fallback: CPU SwiftShader in WSL (`--backend swiftshader`).
// Outputs default to harness-out/ (git-ignored). All commands accept --backend and --workers.
//
//   npm run harness -- render  <project.json> [--out file.png] [--samples N] [--maps]
//   npm run harness -- sheet   <out.png> <a.png> [b.png …] [--scale N]
//   npm run harness -- compare <project.json> <target.png> [--out sheet.png] [--samples N]
//                              [--preset texture|layout] [--weights colour=2,aligned=1] [--max-size N]
//                              [--wrap] [--window] [--json]
//       Renders the project, scores it against the target (resampled to the project size) and prints the
//       metric table; writes a contact sheet [target | render | |difference|×2].
//   npm run harness -- optimize <project.json> <target.png> [--iters N] [--samples N] [--out best.json]
//       [--until LOSS] [--time SECONDS] [--patience STEPS]
//       --until / --time / --patience run until the loss reaches LOSS, the time is up or STEPS steps pass without
//       progress (whichever first); --iters then caps the steps only when given.
//                              [--preset texture|layout] [--weights …] [--lambda N] [--islands N] [--seed N]
//                              [--sigma X] [--lights] [--post] [--base] [--shading] [--enums] [--seeds]
//                              [--structural] [--no-heuristics] [--final-samples N] [--max-size N] [--wrap] [--window]
//       Runs the (1+λ)-ES optimiser in-page for N steps (λ renders each, default 100 × 6 at 16 spp),
//       printing progress; writes the best project JSON (also after every improvement) and a contact
//       sheet [target | start | best | |best − target|×2] next to it (best.png).
//
// Examples:
//   npm run harness -- render a.json --out harness-out/target.png --samples 64
//   npm run harness -- compare b.json harness-out/target.png --preset layout
//   npm run harness -- optimize b.json harness-out/target.png --iters 60 --out harness-out/b.best.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openSession, type BackendKind, type Session } from './backend'
import { contactSheet, decodePng, readPng, writePng, type Rgba8 } from './png'
import type {
  CompareOptions,
  HeadlessCompareResult,
  HeadlessOptimizeOptions,
  HeadlessOptimizeResult,
  HeadlessOptimizeStart,
  HeadlessRenderResult,
  TargetInput,
} from '../src/headless'
import { RunLimits, STOP_LABELS, type StepInfo, type StopCriteria } from '../src/match/optimizer'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'harness-out')

/** Open a rendering session; `--backend windows|swiftshader` and `--workers N` are honoured. */
function session(args: { flags: Record<string, string | boolean> }): Promise<Session> {
  const backend = typeof args.flags.backend === 'string' ? (args.flags.backend as BackendKind) : undefined
  const workers = typeof args.flags.workers === 'string' ? Number(args.flags.workers) : 1
  return openSession({ backend, workers }).then((s) => {
    console.error(`[backend ${s.backend}] ${s.renderer}${s.workers > 1 ? ` · ${s.workers} workers` : ''}`)
    return s
  })
}

export function dataUrlToBuffer(url: string): Buffer {
  return Buffer.from(url.split(',')[1], 'base64')
}

function parseArgs(argv: string[]) {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else flags[key] = true
    } else positional.push(a)
  }
  return { positional, flags }
}

async function cmdRender(args: ReturnType<typeof parseArgs>) {
  const file = args.positional[0]
  if (!file) throw new Error('usage: render <project.json> [--out file.png] [--samples N] [--maps]')
  const project = JSON.parse(readFileSync(file, 'utf8'))
  const out = String(args.flags.out ?? join(OUT_DIR, basename(file).replace(/\.json$/, '') + '.png'))
  const samples = args.flags.samples ? Number(args.flags.samples) : undefined
  mkdirSync(dirname(out), { recursive: true })
  const s = await session(args)
  try {
    await s.callOn(0, 'loadProject', project)
    const result = await s.callOn<HeadlessRenderResult>(0, 'render', { samples })
    writeFileSync(out, dataUrlToBuffer(result.png))
    console.log(`rendered ${result.width}×${result.height}, ${result.samples} spp in ${result.ms.toFixed(0)} ms → ${out}`)
    if (Object.keys(result.errors).length) console.log('errors:', result.errors)
    if (args.flags.maps) {
      const maps = await s.callOn<Record<string, string>>(0, 'renderMaps')
      for (const [k, url] of Object.entries(maps)) {
        const p = out.replace(/\.png$/, `.${k}.png`)
        writeFileSync(p, dataUrlToBuffer(String(url)))
        console.log(`  map ${k} → ${p}`)
      }
    }
  } finally {
    await s.close()
  }
}

async function cmdSheet(args: ReturnType<typeof parseArgs>) {
  const [out, ...inputs] = args.positional
  if (!out || inputs.length === 0) throw new Error('usage: sheet <out.png> <a.png> [b.png …] [--scale N]')
  const scale = args.flags.scale ? Number(args.flags.scale) : 3
  writePng(out, contactSheet(inputs.map(readPng), scale))
  console.log(`sheet → ${out}`)
}

type Args = ReturnType<typeof parseArgs>

const TERMS = ['colour', 'spectrum', 'gradients', 'contrast', 'aligned', 'structure', 'texture', 'alpha'] as const

function targetInput(file: string): TargetInput {
  const img = readPng(file)
  return { width: img.width, height: img.height, rgba: Buffer.from(img.data).toString('base64') }
}

function num(v: string | boolean | undefined): number | undefined {
  if (v === undefined || v === true || v === false) return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`)
  return n
}

/** --preset, --weights colour=2,aligned=1, --max-size, --wrap, --window */
function metricOptions(args: Args): CompareOptions {
  const opts: CompareOptions = {}
  if (args.flags.preset) {
    const preset = String(args.flags.preset)
    if (preset !== 'texture' && preset !== 'layout' && preset !== 'tile') throw new Error(`unknown preset ${preset} (texture|layout|tile)`)
    opts.preset = preset
  }
  if (typeof args.flags.weights === 'string') {
    const w: Record<string, number> = {}
    for (const part of args.flags.weights.split(',')) {
      const [k, v] = part.split('=')
      if (!(TERMS as readonly string[]).includes(k)) throw new Error(`unknown term ${k} (${TERMS.join(', ')})`)
      w[k] = Number(v)
    }
    opts.weights = w as CompareOptions['weights']
  }
  const maxSize = num(args.flags['max-size'])
  if (maxSize) opts.maxSize = maxSize
  if (args.flags.wrap) opts.wrap = true
  if (args.flags.window) opts.window = true
  return opts
}

function printMetrics(r: HeadlessCompareResult) {
  console.log('term        weight   raw       score')
  for (const t of TERMS) {
    const w = r.weights[t]
    console.log(`${t.padEnd(11)} ${w.toFixed(2).padStart(6)}   ${r.raw[t].toFixed(4).padStart(7)}   ${r.terms[t].toFixed(3)}${w === 0 ? '  (unweighted)' : ''}`)
  }
  console.log(`${'total'.padEnd(11)} ${''.padStart(6)}   ${''.padStart(7)}   ${r.total.toFixed(4)}`)
}

function png(url: string): Rgba8 {
  return decodePng(dataUrlToBuffer(url))
}

async function cmdCompare(args: Args) {
  const [file, targetFile] = args.positional
  if (!file || !targetFile) {
    throw new Error('usage: compare <project.json> <target.png> [--out sheet.png] [--samples N] [--preset texture|layout]')
  }
  const project = JSON.parse(readFileSync(file, 'utf8'))
  const out = String(args.flags.out ?? join(OUT_DIR, basename(file).replace(/\.json$/, '') + '.compare.png'))
  const opts: CompareOptions = { ...metricOptions(args), samples: num(args.flags.samples) }
  const target = targetInput(targetFile)
  mkdirSync(dirname(out), { recursive: true })
  const s = await session(args)
  try {
    await s.callOn(0, 'loadProject', project)
    const r = await s.callOn<HeadlessCompareResult>(0, 'compare', target, opts)
    if (args.flags.json) {
      console.log(JSON.stringify({ total: r.total, terms: r.terms, raw: r.raw, weights: r.weights }, null, 2))
    } else {
      const t = target as { width: number; height: number }
      console.log(`compare ${basename(file)} vs ${basename(targetFile)} (${t.width}×${t.height} → ${r.width}×${r.height}, ${r.samples} spp, ${r.ms.toFixed(0)} ms)`)
      printMetrics(r)
    }
    writePng(out, contactSheet([png(r.targetPng), png(r.renderPng), png(r.diffPng)], sheetScale(r.width, args)))
    console.log(`sheet [target | render | diff×2] → ${out}`)
  } finally {
    await s.close()
  }
}

function sheetScale(width: number, args: Args): number {
  return num(args.flags.scale) ?? Math.max(1, Math.min(4, Math.floor(256 / width)))
}

async function cmdOptimize(args: Args) {
  const [file, targetFile] = args.positional
  if (!file || !targetFile) {
    throw new Error('usage: optimize <project.json> <target.png> [--iters N] [--samples N] [--out best.json] [--preset texture|layout]')
  }
  const project = JSON.parse(readFileSync(file, 'utf8'))
  const out = String(args.flags.out ?? join(OUT_DIR, basename(file).replace(/\.json$/, '') + '.best.json'))
  const sheetOut = out.replace(/\.json$/, '') + '.png'
  const stop: StopCriteria = {
    targetLoss: num(args.flags.until),
    timeMs: args.flags.time !== undefined ? Number(args.flags.time) * 1000 : undefined,
    patience: num(args.flags.patience),
  }
  const open = stop.targetLoss !== undefined || stop.timeMs !== undefined || stop.patience !== undefined
  stop.steps = num(args.flags.iters) ?? (open ? undefined : 100)
  const iters = stop.steps
  const opts: HeadlessOptimizeOptions = {
    samples: num(args.flags.samples) ?? 16,
    finalSamples: num(args.flags['final-samples']) ?? 64,
    lambda: num(args.flags.lambda),
    islands: num(args.flags.islands),
    seed: num(args.flags.seed),
    sigma: num(args.flags.sigma),
    structural: Boolean(args.flags.structural),
    heuristics: !args.flags['no-heuristics'],
    metric: metricOptions(args),
    space: {
      lights: Boolean(args.flags.lights),
      post: Boolean(args.flags.post),
      base: Boolean(args.flags.base),
      shading: Boolean(args.flags.shading),
      enums: Boolean(args.flags.enums),
      seeds: Boolean(args.flags.seeds),
    },
  }
  const target = targetInput(targetFile)
  mkdirSync(dirname(out), { recursive: true })
  const s = await session(args)
  try {
    await s.callOn(0, 'loadProject', project)
    const before = await s.callOn<HeadlessCompareResult>(0, 'compare', target, { ...opts.metric, samples: opts.finalSamples })
    const start = { ...(await s.callOn<HeadlessOptimizeStart>(0, 'optimizeStart', target, opts)), before }
    const startPng = png(start.before.renderPng)
    console.log(
      `optimize ${basename(file)} → ${basename(targetFile)}: ${start.entries} params, ${start.width}×${start.height}, ` +
        `${iters ?? '∞'} steps × λ=${opts.lambda ?? 6}${opts.islands ? ` (${opts.islands} islands)` : ''} at ${opts.samples} spp, preset ${opts.metric?.preset ?? 'texture'}` +
        (stop.targetLoss !== undefined ? `, until loss ≤ ${stop.targetLoss}` : '') +
        (stop.timeMs !== undefined ? `, ≤ ${stop.timeMs / 1000} s` : '') +
        (stop.patience !== undefined ? `, patience ${stop.patience}` : ''),
    )
    console.log(`start loss ${start.initialLoss.toFixed(4)} (at ${opts.finalSamples} spp: ${start.before.total.toFixed(4)})`)
    const t0 = Date.now()
    let best = start.initialLoss
    const limits = new RunLimits(stop, best)
    let reason = limits.check(best, 1)
    while (!reason) {
      const [info] = await s.callOn<StepInfo[]>(0, 'optimizeStep', 1)
      reason = limits.after(info.bestLoss, info.evaluations)
      const mark = info.improved ? '*' : info.restarted ? 'R' : ' '
      const changed = info.changed.length ? '  ' + info.changed.slice(0, 3).join(', ') + (info.changed.length > 3 ? ', …' : '') : ''
      console.log(
        `${mark} step ${String(info.step).padStart(3)}/${iters ?? '∞'}  best ${info.bestLoss.toFixed(4)}  cand ${info.candidateLoss.toFixed(4)}  ` +
          `σ ${info.meanSigma.toFixed(3)}  ${(info.ms / 1000).toFixed(1)}s${info.improved ? changed : ''}`,
      )
      if (info.bestLoss < best) {
        best = info.bestLoss
        const b = await s.callOn<{ project: unknown; loss: number } | null>(0, 'optimizeBest')
        if (b) writeFileSync(out, JSON.stringify(b.project, null, 2))
      }
    }
    const result = await s.callOn<HeadlessOptimizeResult>(0, 'optimizeFinish')
    writeFileSync(out, JSON.stringify(result.bestProject, null, 2))
    const r = result.compare
    console.log(
      `\nloss ${result.initialLoss.toFixed(4)} → ${result.bestLoss.toFixed(4)} (${result.evaluations} evaluations, ${((Date.now() - t0) / 1000).toFixed(0)} s; ${STOP_LABELS[reason]})`,
    )
    console.log(`final render at ${r.samples} spp (start ${start.before.total.toFixed(4)}):`)
    printMetrics(r)
    writePng(sheetOut, contactSheet([png(r.targetPng), startPng, png(r.renderPng), png(r.diffPng)], sheetScale(r.width, args)))
    console.log(`best project → ${out}`)
    console.log(`sheet [target | start | best | diff×2] → ${sheetOut}`)
  } finally {
    await s.close()
  }
}

const COMMANDS: Record<string, (a: Args) => Promise<void>> = {
  render: cmdRender,
  sheet: cmdSheet,
  compare: cmdCompare,
  optimize: cmdOptimize,
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const fn = COMMANDS[cmd]
  if (!fn) {
    console.log(`usage: npm run harness -- <${Object.keys(COMMANDS).join('|')}> …`)
    process.exit(1)
  }
  await fn(parseArgs(rest))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
