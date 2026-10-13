// Cold shader compile time per generator type, in the Windows browser (D3D11 by default — Chrome's default backend
// on Windows, where compiles are slowest):
//
//   npx tsx tools/compile-time.ts truchet marble cracks …   (no types: every generator)
//   BISMITH_ANGLE=gl npx tsx tools/compile-time.ts …        (another ANGLE backend)
//
// Each type compiles alone with fresh salted shaders, so the browser's and the driver's caches can't answer.

import { openSession } from './backend'
import { ensureBuiltins } from '../src/render/builtins'
import { allLayerDefs } from '../src/layers/registry'

ensureBuiltins()
const args = process.argv.slice(2)
const types = args.length ? args : allLayerDefs().filter((d) => d.kind === 'generator').map((d) => d.type)
const s = await openSession({ backend: 'windows', logPage: false })
console.log(s.renderer)
const rows: [string, number][] = []
for (const t of types) {
  const r = await s.call<{ ms: number }>('precompile', [t], { cold: true })
  rows.push([t, r.ms])
  console.log(`${t.padEnd(16)} ${(r.ms / 1000).toFixed(2).padStart(6)} s`)
}
if (rows.length > 1) {
  rows.sort((a, b) => b[1] - a[1])
  console.log(`\nslowest: ${rows.slice(0, 5).map(([t, ms]) => `${t} ${(ms / 1000).toFixed(1)} s`).join(', ')}`)
}
await s.close()
