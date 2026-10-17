// Per-pixel cost of generator layers on the Windows browser (D3D11): a 2048² project stacking 32 copies of a layer
// (re-seeded each run so the stack re-evaluates), minus the empty project; interleaved rounds, each spec's best round
// (GPU clocks drift over a run, and a render carries ~0.5 s of fixed cost, so single runs of a few layers are noise).
//
//   npx tsx tools/render-cost.ts <type[:mode[:{json params}]]> …
//   npx tsx tools/render-cost.ts tiles:squares 'tiles:rhombille:{"output":"value"}' bricks
//
// Compare two versions of a generator in one run (register the old one under another type), not across runs.

import { openSession } from './backend'
import { createLayer, createProject } from '../src/core/serialize'
import { ensureBuiltins } from '../src/render/builtins'

ensureBuiltins()
const specs = process.argv.slice(2)
if (!specs.length) {
  console.error('usage: npx tsx tools/render-cost.ts <type[:mode[:{json params}]]> …')
  process.exit(1)
}
const SIZE = 2048
const COPIES = 32
const ROUNDS = 4

const parse = (spec: string) => {
  const [type, mode, ...rest] = spec.split(':')
  const extra = rest.join(':')
  return { type, mode, more: extra ? (JSON.parse(extra) as Record<string, unknown>) : {} }
}

const s = await openSession({ backend: 'windows', logPage: false })
console.log(s.renderer)

/** Median render time (ms) of a project, after one warm-up (compile) run. */
async function time(layers: (seed: number) => ReturnType<typeof createLayer>[]) {
  const ms: number[] = []
  for (let i = 0; i < 5; i++) {
    const project = createProject({ width: SIZE, height: SIZE, tileable: true, layers: layers(i + 1) } as Parameters<typeof createProject>[0])
    await s.call('loadProject', project)
    const r = await s.call<{ ms: number }>('render', { samples: 1 })
    if (i >= 1) ms.push(r.ms)
  }
  ms.sort((a, b) => a - b)
  return ms[Math.floor(ms.length / 2)]
}

const best = new Map<string, number>()
let base = Infinity
for (let round = 0; round < ROUNDS; round++) {
  base = Math.min(base, await time(() => []))
  for (const spec of specs) {
    const { type, mode, more } = parse(spec)
    const t = await time((seed) =>
      Array.from({ length: COPIES }, (_, k) => createLayer(type, { ...(mode ? { mode } : {}), ...more, seed: seed * 100 + k, dif_on: true, h_on: true })),
    )
    best.set(spec, Math.min(best.get(spec) ?? Infinity, t))
  }
}
console.log(`empty project ${base.toFixed(0)} ms`)
for (const spec of specs) console.log(`${spec.padEnd(40)} ${((best.get(spec)! - base) / COPIES).toFixed(2)} ms per layer`)
await s.close()
