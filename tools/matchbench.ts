// Benchmark the Match optimiser: run it headlessly on (start project, reference) pairs, the way the Match workspace
// does, and score each best result under both the Tile and the Texture preset.
//
//   npx tsx tools/matchbench.ts <pairs.json> <strategy.json> [--label NAME] [--out DIR] [--workers N]
//                               [--backend windows|swiftshader] [--only REGEX] [--seeds N]
//
// pairs.json:    { "pairs": [{ "name": "wall", "project": "start.json", "reference": "ref.png" }, …] }  (paths relative
//                to the file)
// strategy.json: { "phases": [{ "preset": "tile", "steps": 300, "options": { …OptimizerOptions } }, …],  (each phase
//                starts from the previous phase's best)  "samples": 16 (evaluation spp) }
//
// Every pair runs with seeds 1..N (default 1) — single runs are noisy, compare means. Runs are spread over the
// workers. Per run it writes <out>/<label>/<name>-s<seed>.json (best project) and .png ([reference | start | best |
// diff]), and appends one line per run to <out>/results.jsonl; the table shows the mean over seeds per pair.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { openSession, type BackendKind } from './backend'
import { contactSheet, decodePng, readPng, writePng, type Rgba8 } from './png'
import type { HeadlessCompareResult, HeadlessOptimizeOptions, HeadlessOptimizeStart, TargetInput } from '../src/headless'
import type { MetricPreset } from '../src/match/metrics'
import type { StepInfo } from '../src/match/optimizer'

interface Phase {
  preset: MetricPreset
  steps: number
  options?: HeadlessOptimizeOptions
}
interface Spec {
  pairs: { name: string; project: string; reference: string }[]
}
interface Strategy {
  phases: Phase[]
  samples?: number
}
interface Scores {
  tile: number
  texture: number
}

const args = process.argv.slice(2)
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const specFile = resolve(args[0] ?? '')
const spec: Spec = JSON.parse(readFileSync(specFile, 'utf8'))
const strategy: Strategy = JSON.parse(readFileSync(resolve(args[1] ?? ''), 'utf8'))
const base = dirname(specFile)
const label = flag('label') ?? basename(args[1] ?? 'run', '.json')
const outDir = resolve(flag('out') ?? join(base, 'bench'))
const only = flag('only') ? new RegExp(flag('only')!) : null
const pairs = spec.pairs.filter((p) => !only || only.test(p.name))
const samples = strategy.samples ?? 16
const seeds = Number(flag('seeds') ?? 1)

function target(file: string): TargetInput {
  const img = readPng(file)
  return { width: img.width, height: img.height, rgba: Buffer.from(img.data).toString('base64') }
}
const png = (url: string): Rgba8 => decodePng(Buffer.from(url.split(',')[1], 'base64'))

async function main() {
  mkdirSync(join(outDir, label), { recursive: true })
  const s = await openSession({ backend: flag('backend') as BackendKind | undefined, workers: Number(flag('workers') ?? pairs.length) })
  console.error(`[backend ${s.backend}] ${s.renderer} · ${s.workers} workers · ${pairs.length} pairs · label ${label}`)
  try {
    // A shared queue: each worker takes the next (pair, seed) when it is free.
    const jobs = pairs.flatMap((pair) => Array.from({ length: seeds }, (_, k) => ({ pair, seed: k + 1 })))
    const runs: Awaited<ReturnType<typeof runPair>>[] = []
    await Promise.all(
      Array.from({ length: s.workers }, async (_, w) => {
        for (let job = jobs.shift(); job; job = jobs.shift()) runs.push(await runPair(s, w, job.pair, job.seed))
      }),
    )
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const rows = pairs.map((pair) => {
      const rs = runs.filter((r) => r.name === pair.name)
      return {
        name: pair.name,
        start: rs[0].start,
        best: { tile: avg(rs.map((r) => r.best.tile)), texture: avg(rs.map((r) => r.best.texture)) },
        layers: [rs[0].layers[0], Math.max(...rs.map((r) => r.layers[1]))],
        evaluations: Math.round(avg(rs.map((r) => r.evaluations))),
        ms: avg(rs.map((r) => r.ms)),
      }
    })
    console.log(`\n${label}${seeds > 1 ? ` (mean of ${seeds} seeds)` : ''}`)
    console.log('pair           start tile/tex     best tile/tex      Δ tile   Δ tex    layers  evals   s')
    for (const r of rows) {
      console.log(
        `${r.name.padEnd(14)} ${r.start.tile.toFixed(4)}/${r.start.texture.toFixed(4)}   ${r.best.tile.toFixed(4)}/${r.best.texture.toFixed(4)}   ` +
          `${(r.best.tile - r.start.tile).toFixed(4).padStart(7)}  ${(r.best.texture - r.start.texture).toFixed(4).padStart(7)}  ` +
          `${String(r.layers[0]).padStart(2)}→${String(r.layers[1]).padEnd(3)} ${String(r.evaluations).padStart(6)} ${String(Math.round(r.ms / 1000)).padStart(4)}`,
      )
    }
    const mean = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length
    console.log(`mean best tile ${mean((r) => r.best.tile).toFixed(4)} · texture ${mean((r) => r.best.texture).toFixed(4)} · sum ${mean((r) => r.best.tile + r.best.texture).toFixed(4)}`)
    const tot: Record<string, { proposed: number; improved: number; gain: number }> = {}
    for (const r of runs) for (const [k, v] of Object.entries(r.moves)) {
      const t = (tot[k] ??= { proposed: 0, improved: 0, gain: 0 })
      t.proposed += v.proposed
      t.improved += v.improved
      t.gain += v.gain
    }
    console.log(
      'moves (proposed / improved best / total gain): ' +
        Object.entries(tot)
          .sort((a, b) => b[1].gain - a[1].gain)
          .map(([k, v]) => `${k} ${v.proposed}/${v.improved}/${v.gain.toFixed(3)}`)
          .join(' · '),
    )
  } finally {
    await s.close()
  }
}

async function scores(s: Awaited<ReturnType<typeof openSession>>, w: number, t: TargetInput): Promise<Scores & { tileResult: HeadlessCompareResult }> {
  const tileResult = await s.callOn<HeadlessCompareResult>(w, 'compare', t, { preset: 'tile', samples })
  const tex = await s.callOn<HeadlessCompareResult>(w, 'compare', t, { preset: 'texture', samples })
  return { tile: tileResult.total, texture: tex.total, tileResult }
}

async function runPair(s: Awaited<ReturnType<typeof openSession>>, w: number, pair: Spec['pairs'][number], seed: number) {
  const t0 = Date.now()
  const start = JSON.parse(readFileSync(resolve(base, pair.project), 'utf8'))
  const ref = target(resolve(base, pair.reference))
  await s.callOn(w, 'loadProject', start)
  const s0 = await scores(s, w, ref)
  let project: unknown = start
  let evaluations = 0
  // Per move kind: candidates proposed, and steps it won that improved the best.
  const moves: Record<string, { proposed: number; improved: number; gain: number }> = {}
  for (const [k, ph] of strategy.phases.entries()) {
    await s.callOn(w, 'loadProject', project)
    const opts: HeadlessOptimizeOptions = { lambda: 4, ...ph.options, seed, samples, metric: { preset: ph.preset, ...ph.options?.metric } }
    const st = await s.callOn<HeadlessOptimizeStart>(w, 'optimizeStart', ref, opts)
    let last: StepInfo | undefined
    for (let done = 0; done < ph.steps; ) {
      const n = Math.min(25, ph.steps - done)
      const infos = await s.callOn<StepInfo[]>(w, 'optimizeStep', n)
      done += n
      for (const info of infos) {
        for (const m of info.moves ?? []) (moves[m] ??= { proposed: 0, improved: 0, gain: 0 }).proposed++
        if (info.improved && info.move) {
          const m = (moves[info.move] ??= { proposed: 0, improved: 0, gain: 0 })
          m.improved++
          m.gain += (last?.bestLoss ?? info.bestLoss) - info.bestLoss
        }
        last = info
      }
    }
    const best = await s.callOn<{ project: unknown; loss: number } | null>(w, 'optimizeBest')
    if (best) project = best.project
    evaluations += last?.evaluations ?? 0
    console.error(`  ${pair.name} s${seed} phase ${k + 1} ${ph.preset}: ${st.initialLoss.toFixed(4)} → ${(best?.loss ?? st.initialLoss).toFixed(4)} (${st.entries} params)`)
  }
  await s.callOn(w, 'loadProject', project)
  const s1 = await scores(s, w, ref)
  const dir = join(outDir, label)
  writeFileSync(join(dir, `${pair.name}-s${seed}.json`), JSON.stringify(project, null, 2))
  writePng(
    join(dir, `${pair.name}-s${seed}.png`),
    contactSheet([png(s1.tileResult.targetPng), png(s0.tileResult.renderPng), png(s1.tileResult.renderPng), png(s1.tileResult.diffPng)], 3),
  )
  const row = {
    label,
    name: pair.name,
    seed,
    start: { tile: s0.tile, texture: s0.texture },
    best: { tile: s1.tile, texture: s1.texture },
    layers: [(start as { layers: unknown[] }).layers.length, (project as { layers: unknown[] }).layers.length],
    evaluations,
    ms: Date.now() - t0,
    moves,
    phases: strategy.phases,
  }
  appendFileSync(join(outDir, 'results.jsonl'), JSON.stringify(row) + '\n')
  return row
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
