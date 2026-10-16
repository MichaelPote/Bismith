// Circuit router (FR8.10): space-filling traces that never touch, computed on the CPU (a global, sequential process a
// pixel shader can't run) and handed to the Traces generator as a per-node texture.
//
// Nodes on a (wrapping, when tiling) grid. A trace walks node to node in one fixed set of directions — 8 (0°, the
// diagonal angle, 90° …), 6 (horizontal and the four diagonals: hexagonal when the diagonal angle is 60°) or 4 (right
// angles) — and only ever bends one step within that set; sets are never mixed. A trace may only
// enter a node whose neighbourhood is free of other traces (and of its own body, bar its last steps), so traces keep at
// least `gap` free nodes between them and never touch or cross. A few long seed walks go first; then the rest of the
// space fills with traces started next to existing ones and preferring to run alongside them (buses).

export interface RouteOptions {
  nx: number
  ny: number
  wrap: boolean
  seed: number
  /** Long random walks laid first. */
  seeds: number
  seedLength: number
  /** Fill traces shorter than this are dropped. */
  minLength: number
  maxLength: number
  /** Free nodes kept between traces (0 = neighbouring nodes allowed — they still never touch or cross). */
  gap: number
  /** Chance of carrying straight on at each step. */
  straight: number
  /** Direction set: 8 (king moves), 6 (no verticals — hexagonal with a 60° diagonal angle) or 4 (right angles). */
  directions: 4 | 6 | 8
  /**
   * Preference for running alongside existing traces — any beside the step (saturating at 1), far more one running the
   * same way — and for starting the next traces beside a new one (certainly from 2): buses that bend together.
   */
  hug: number
  /** Share of possible fill starts actually tried (0..1): lower leaves more empty board. */
  fill: number
  /** Chance of a via at an interior node. */
  vias: number
  /** Rectangular areas kept free of traces: 0 none … 1 about half the board (open board between clusters). */
  open?: number
  /** Their typical side, as a share of the board (default 0.15). */
  openSize?: number
  /** Horizontal against vertical steps (0 mostly vertical, 1 mostly horizontal; 0.5, the default, = no preference). */
  bias?: number
  /** Chance each node is dropped, breaking its trace into two pad-ended pieces (pin pads: more, shorter traces). */
  pins?: number
}

/** Grid steps sorted by angle (even = the 8 king moves used by the direction sets; odd entries are unused). */
export const ROUTE_DIRS: [number, number][] = [
  [1, 0], [2, 1], [1, 1], [1, 2], [0, 1], [-1, 2], [-1, 1], [-2, 1],
  [-1, 0], [-2, -1], [-1, -1], [-1, -2], [0, -1], [1, -2], [1, -1], [2, -1],
]

export interface RouteResult {
  nx: number
  ny: number
  /** Per node: outgoing direction index (0..15) or -1. */
  out: Int8Array
  /** Per node: bit 0 pad (trace end), bit 1 via, bit 2 on a trace. */
  flags: Uint8Array
  /** Per node / passed cell: the trace id (0 = free). */
  owner: Int32Array
  traces: number
}

/** Small seeded PRNG (mulberry32 style), uniform in [0, 1). */
export function rng(seed: number) {
  let s = (seed >>> 0) ^ 0x9e3779b9
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function routeTraces(o: RouteOptions): RouteResult {
  const { nx, ny } = o
  const n = nx * ny
  const owner = new Int32Array(n) // 0 = free, else trace id (nodes and the cells a knight move passes)
  const order = new Int32Array(n).fill(-1) // step index within its trace (for the own-tail exemption)
  const out = new Int8Array(n).fill(-1)
  const flags = new Uint8Array(n)
  const rand = rng(o.seed * 2654435761 + 17)
  const idx = (x: number, y: number): number => {
    if (o.wrap) return (((y % ny) + ny) % ny) * nx + (((x % nx) + nx) % nx)
    return x < 0 || y < 0 || x >= nx || y >= ny ? -1 : y * nx + x
  }
  // Indices into ROUTE_DIRS (sorted by angle), so "one step" in the set is always the neighbouring direction.
  const dirs = o.directions === 4 ? [0, 4, 8, 12] : o.directions === 6 ? [0, 2, 6, 8, 10, 14] : [0, 2, 4, 6, 8, 10, 12, 14]
  const gap = Math.max(0, Math.round(o.gap))
  const keepOut = openAreas(nx, ny, o.wrap, o.seed, o.open ?? 0, o.openSize ?? 0.15)
  // Horizontal bias: horizontal steps weigh 2·bias, vertical ones 2·(1 − bias), diagonals 1.
  const bias = Math.min(1, Math.max(0, o.bias ?? 0.5))
  const dirW = ROUTE_DIRS.map(([x, y]) => (y === 0 ? 2 * bias : x === 0 ? 2 * (1 - bias) : 1))
  /** A random direction of the set, weighted by the bias. */
  const pickDir = (r: number): number => {
    let tot = 0
    for (const d of dirs) tot += dirW[d]
    const v = r * tot
    let acc = 0
    for (const d of dirs) if (v < (acc += dirW[d])) return d
    return dirs[dirs.length - 1]
  }

  /** Can trace `t` (currently at step `k`) occupy node i? Its neighbourhood must hold no other trace, nor its own older body. */
  const clear = (x: number, y: number, t: number, k: number): boolean => {
    const i = idx(x, y)
    if (i < 0 || owner[i] !== 0 || (keepOut !== null && keepOut[i])) return false
    for (let dy = -gap; dy <= gap; dy++)
      for (let dx = -gap; dx <= gap; dx++) {
        const j = idx(x + dx, y + dy)
        if (j < 0 || owner[j] === 0) continue
        if (owner[j] !== t || order[j] < k - 2 - gap) return false
      }
    return true
  }
  /** Cells a knight move from (x, y) passes beside (they must stay clear too). */
  const between = (x: number, y: number, d: number): [number, number][] => {
    const [sx, sy] = ROUTE_DIRS[d]
    if (Math.abs(sx) + Math.abs(sy) !== 3) return []
    return Math.abs(sx) === 2 ? [[x + Math.sign(sx), y], [x + Math.sign(sx), y + sy]] : [[x, y + Math.sign(sy)], [x + sx, y + Math.sign(sy)]]
  }
  /** Is another trace gap + 1 nodes to the side of a step? Hugging it makes buses. */
  const alongside = (x: number, y: number, t: number): boolean => {
    const r = gap + 1
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const j = idx(x + dx, y + dy)
        if (j >= 0 && owner[j] !== 0 && owner[j] !== t) return true
      }
    return false
  }

  /** Does another trace beside the node (gap + 1 away) run in direction d, either way? */
  const parallel = (x: number, y: number, d: number, t: number): boolean => {
    const r = gap + 1
    const back = (d + 8) % 16
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const j = idx(x + dx, y + dy)
        if (j >= 0 && owner[j] !== 0 && owner[j] !== t && (out[j] === d || out[j] === back)) return true
      }
    return false
  }

  let traceId = 0
  /** The path of the last trace laid (for Run alongside's bus starts). */
  let lastPath: number[] = []
  const walk = (sx: number, sy: number, d0: number, maxLen: number, minLen: number): boolean => {
    const t = ++traceId
    const path: number[] = []
    const extra: number[] = []
    let x = sx
    let y = sy
    let d = d0
    if (!clear(x, y, t, 0)) return false
    const take = (i: number, k: number) => {
      owner[i] = t
      order[i] = k
    }
    take(idx(x, y), 0)
    path.push(idx(x, y))
    // Pads need room: a ring of nodes free of other traces (and of this one's far body). A blocked end backs off a few
    // nodes to find it; an end that can't has no pad.
    const roomy = (i: number): boolean => {
      const x0 = i % nx
      const y0 = Math.floor(i / nx)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = idx(x0 + dx, y0 + dy)
          if (j >= 0 && owner[j] !== 0 && (owner[j] !== t || Math.abs(order[j] - order[i]) > 3)) return false
        }
      return true
    }
    for (let k = 1; k < maxLen; k++) {
      // Pin pads also end traces early, where a pad has room.
      if (k > Math.max(minLen, 3) && (o.pins ?? 0) > 0 && rand() < 0.25 * (o.pins ?? 0) && roomy(path[path.length - 1])) break
      // Candidates: straight on, or one step of the direction set either way, weighted.
      const cands: { d: number; w: number }[] = []
      const pos = dirs.indexOf(d)
      for (const delta of [0, 1, -1]) {
        const nd = dirs[(pos + delta + dirs.length) % dirs.length]
        let w = (delta === 0 ? o.straight : 0.5 * (1 - o.straight)) * dirW[nd]
        const [ddx, ddy] = ROUTE_DIRS[nd]
        if (o.hug > 0 && alongside(x + ddx, y + ddy, t)) w *= 1 + 4 * Math.min(o.hug, 1)
        // A neighbour running the same way weighs far more: buses that bend together.
        if (o.hug > 0 && parallel(x + ddx, y + ddy, nd, t)) w *= 1 + 6 * o.hug
        cands.push({ d: nd, w: w + 1e-3 })
      }
      // Try in a weighted random order; the first clear one wins.
      let moved = false
      while (cands.length) {
        const tot = cands.reduce((s, c) => s + c.w, 0)
        let r = rand() * tot
        let pick = 0
        for (; pick < cands.length - 1; pick++) if ((r -= cands[pick].w) <= 0) break
        const c = cands.splice(pick, 1)[0]
        const [ddx, ddy] = ROUTE_DIRS[c.d]
        const nxp = x + ddx
        const nyp = y + ddy
        if (!clear(nxp, nyp, t, k)) continue
        const mids = between(x, y, c.d)
        if (mids.some(([mx, my]) => !clear(mx, my, t, k))) continue
        // A 45° step must not cross another 45° step over the same grid square — another trace's or its own (a loop
        // coming back round).
        if (Math.abs(ddx) === 1 && Math.abs(ddy) === 1) {
          const a = idx(x + ddx, y)
          const b = idx(x, y + ddy)
          if (a >= 0 && b >= 0 && owner[a] !== 0 && owner[a] === owner[b]) {
            const ta = ROUTE_DIRS[out[a]] ?? [0, 0]
            const tb = ROUTE_DIRS[out[b]] ?? [0, 0]
            if ((idx(x + ddx + ta[0], y + ta[1]) === b && out[a] >= 0) || (idx(x + tb[0], y + ddy + tb[1]) === a && out[b] >= 0)) continue
          }
        }
        out[idx(x, y)] = c.d
        for (const [mx, my] of mids) {
          const mi = idx(mx, my)
          take(mi, k)
          extra.push(mi)
        }
        x = nxp
        y = nyp
        d = c.d
        take(idx(x, y), k)
        path.push(idx(x, y))
        moved = true
        break
      }
      if (!moved) break
    }
    const drop = (i: number) => {
      owner[i] = 0
      order[i] = -1
      out[i] = -1
    }
    for (let b = 0; b < 3 && path.length > minLen && !roomy(path[path.length - 1]); b++) {
      drop(path.pop()!)
      out[path[path.length - 1]] = -1
    }
    for (let b = 0; b < 3 && path.length > minLen && !roomy(path[0]); b++) drop(path.shift()!)
    if (path.length < minLen) {
      for (const i of [...path, ...extra]) drop(i)
      return false
    }
    const pad = (i: number) => {
      flags[i] |= 1
      // Reserve the ring, so later traces keep clear of the pad.
      const x0 = i % nx
      const y0 = Math.floor(i / nx)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = idx(x0 + dx, y0 + dy)
          if (j >= 0 && owner[j] === 0) {
            owner[j] = t
            order[j] = order[i]
          }
        }
    }
    for (const i of path) flags[i] |= 4
    // Pin pads: drop a node at random — the trace becomes two, each ending in a pad one node short of the gap (pieces
    // keep at least two links).
    let since = 2
    for (let i = 3; i < path.length - 3; i++) {
      since++
      if (since < 3 || !(rand() < (o.pins ?? 0)) || !roomy(path[i - 1]) || !roomy(path[i + 1])) continue
      out[path[i - 1]] = -1
      out[path[i]] = -1
      flags[path[i]] = 0
      pad(path[i - 1])
      pad(path[i + 1])
      since = -1
    }
    if (roomy(path[0])) pad(path[0])
    if (roomy(path[path.length - 1])) pad(path[path.length - 1])
    for (let i = 1; i < path.length - 1; i++) if ((flags[path[i]] & 5) === 4 && rand() < o.vias) flags[path[i]] |= 2
    lastPath = path
    return true
  }

  let traces = 0
  for (let s = 0; s < o.seeds; s++) {
    for (let tries = 0; tries < 20; tries++) {
      if (walk(Math.floor(rand() * nx), Math.floor(rand() * ny), pickDir(rand()), o.seedLength, Math.min(o.minLength, 4))) {
        traces++
        break
      }
    }
  }
  // Fill: every node in random order; start beside existing traces where possible, running parallel to them.
  const nodes = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[nodes[i], nodes[j]] = [nodes[j], nodes[i]]
  }
  // Run alongside: the free nodes beside a new trace start traces next (by chance, certainly from 2), so buses grow
  // trace by trace.
  const bus = Math.min(1, Math.max(0, o.hug) / 2)
  const queue: number[] = []
  let head = 0
  const start = (i: number) => {
    if (owner[i] !== 0 || (keepOut !== null && keepOut[i]) || rand() > o.fill) return
    const x = i % nx
    const y = Math.floor(i / nx)
    // Direction of a neighbouring trace (if any) two nodes away — run alongside it.
    let d = pickDir(rand())
    const r = gap + 1
    search: for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const j = idx(x + dx, y + dy)
        if (j >= 0 && out[j] >= 0) {
          d = out[j]
          if (!dirs.includes(d)) d = pickDir(rand())
          break search
        }
      }
    const pos = dirs.indexOf(d)
    const flip = rand() < 0.5 ? 0 : dirs.length / 2
    for (let a = 0; a < dirs.length; a++) {
      // d, its opposite, then the rest (alternating either side).
      const off = a < 2 ? a * (dirs.length / 2) : (a % 2 ? 1 : -1) * Math.ceil((a - 1) / 2)
      if (walk(x, y, dirs[(pos + flip + off + 2 * dirs.length) % dirs.length], o.maxLength, o.minLength)) {
        traces++
        if (bus > 0 && rand() < bus)
          for (const pi of lastPath) {
            const px = pi % nx
            const py = Math.floor(pi / nx)
            for (let dy = -r; dy <= r; dy++)
              for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
                const j = idx(px + dx, py + dy)
                if (j >= 0 && owner[j] === 0) queue.push(j)
              }
          }
        break
      }
    }
  }
  // Two passes (pads and later traces open or close room), each start trying its directions until one walks.
  for (let pass = 0; pass < 2; pass++)
    for (const i of nodes) {
      start(i)
      while (head < queue.length) start(queue[head++])
    }
  return { nx, ny, out, flags, owner, traces }
}

/**
 * Open board: nodes kept free of traces — rectangles of varied size and shape (a component's footprint, a mounting
 * area), wrapping when tiling, laid until about `open` × 50 % of the board is covered. `size`: their typical side as
 * a share of the board (each 0.4–1.6× that, aspect up to 3:1). Null when off.
 */
function openAreas(nx: number, ny: number, wrap: boolean, seed: number, open: number, size: number): Uint8Array | null {
  if (!(open > 0)) return null
  const rand = rng(seed * 40503 + 977)
  const out = new Uint8Array(nx * ny)
  const want = 0.5 * Math.min(1, open) * nx * ny
  const side = Math.max(2, Math.min(1, Math.max(0.02, size)) * Math.sqrt(nx * ny))
  let covered = 0
  for (let k = 0; k < 256 && covered < want; k++) {
    const s = side * (0.4 + 1.2 * rand())
    const aspect = Math.exp((rand() * 2 - 1) * Math.log(3))
    const w = Math.max(2, Math.round(s * Math.sqrt(aspect)))
    const h = Math.max(2, Math.round(s / Math.sqrt(aspect)))
    const x0 = Math.floor(rand() * nx)
    const y0 = Math.floor(rand() * ny)
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        if (!wrap && (x >= nx || y >= ny)) continue
        const i = (y % ny) * nx + (x % nx)
        if (!out[i]) covered++
        out[i] = 1
      }
  }
  return out
}
