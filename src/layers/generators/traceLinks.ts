// Route and maze links for the Traces generator (FR8.8), computed once per node on the CPU and handed to the shader as
// a per-node texture, like the Fill router's output (router.ts). They used to be evaluated per pixel in GLSL, where
// every pixel re-derived its neighbours' links through nested helper calls; D3D's shader compiler (ANGLE on Windows,
// so Chrome and Firefox there) inlines all of that and took minutes to compile it, hanging the browser.
//
// The hashes reproduce the GLSL hashI bit for bit (and the float maths in float32), so layouts are unchanged.
//   Route: every node has at most one outgoing link (straight on, or a 45° turn from its block's direction) and accepts
//          at most one incoming link (a fixed per-node priority among its neighbours), so traces are paths: no
//          junctions, no crossings (crossing diagonals in one grid square: the square keeps one), a pad at each end.
//   Maze:  independent links east / north and, by chance, diagonally; junctions allowed.

/** The 8 king moves, east then counter-clockwise. Bit d of a node's link mask: a trace from it toward KING[d]. */
export const KING: [number, number][] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
]

export interface TraceLinkOptions {
  mode: 'route' | 'maze'
  nx: number
  ny: number
  wrap: boolean
  /** The layer's combined seed (the shader's uSeed). */
  seed: number
  density: number
  diagonal: number
  bias: number
  straight: number
  grouping: number
  block: number
  vias: number
}

export interface TraceLinks {
  /** Per node: bit d set = a trace segment from the node toward KING[d]. */
  links: Uint8Array
  /** Per node: bit 0 trace end (pad candidate), bit 1 via. */
  flags: Uint8Array
}

// ---------------------------------------------------------------- GLSL hash port (layers/glsl/common.ts)
const f = Math.fround

function pcg(v: number): number {
  const state = (Math.imul(v, 747796405) + 2891336453) >>> 0
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0
  return ((word >>> 22) ^ word) >>> 0
}

/** hashI(ivec2(x, y), seed): uint() wraps negative coordinates; u2f rounds to float32 (so it can reach 1.0). */
export function hashI(x: number, y: number, seed: number): number {
  return f(pcg((x >>> 0) ^ pcg((y >>> 0) ^ pcg(seed >>> 0)))) / 4294967296
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const mix = (a: number, b: number, t: number) => f(f(a * f(1 - t)) + f(b * t))

// ---------------------------------------------------------------- links

export function traceLinks(o: TraceLinkOptions): TraceLinks {
  const { nx, ny, wrap } = o
  const n = nx * ny
  const blk = Math.max(Math.round(o.block), 1)
  const bnx = Math.max(Math.trunc(nx / blk), 1)
  const bny = Math.max(Math.trunc(ny / blk), 1)
  const imod = (a: number, m: number) => ((a % m) + m) % m
  const wx = (x: number) => (wrap ? imod(x, nx) : x)
  const wy = (y: number) => (wrap ? imod(y, ny) : y)
  const inside = (x: number, y: number) => wrap || (x >= 0 && y >= 0 && x < nx && y < ny)
  /** Array index of a node (wrapped when tiling), or -1 outside the board. */
  const idx = (x: number, y: number) => (inside(x, y) ? wy(y) * nx + wx(x) : -1)
  const h = (x: number, y: number, salt: number) => hashI(wx(x), wy(y), o.seed + salt)
  /** Hash of the node's block of cells (blocks share a direction). */
  const hb = (x: number, y: number, salt: number) => {
    let bx = Math.floor(wx(x) / blk)
    let by = Math.floor(wy(y) / blk)
    if (wrap) [bx, by] = [imod(bx, bnx), imod(by, bny)]
    return hashI(bx, by, o.seed + salt)
  }
  const density = f(o.density)
  const bias = f(o.bias)
  const diag = clamp01(f(o.diagonal))
  const vias = f(o.vias)
  const links = new Uint8Array(n)
  const flags = new Uint8Array(n)
  const finish = (x: number, y: number, i: number, degree: number) => {
    flags[i] = (degree === 1 ? 1 : 0) | (degree >= 1 && h(x, y, 23) < vias ? 2 : 0)
  }

  if (o.mode === 'maze') {
    // Links stored once per node: 0 east, 1 north, 2 north-east, 3 south-east.
    const STEP = [[1, 0], [0, 1], [1, 1], [1, -1]]
    const KING_BIT = [1 << 0, 1 << 2, 1 << 1, 1 << 7]
    const pStraight = f(density * f(1 - diag))
    const pBase = [f(f(pStraight * 2) * bias), f(f(pStraight * 2) * f(1 - bias)), f(density * diag), f(density * diag)]
    const straightShare = f(2 * f(1 - diag))
    const domScale = f(straightShare + f(2 * diag))
    const domCuts = [f(straightShare * bias), straightShare, f(straightShare + diag)]
    const grouping = clamp01(f(o.grouping))
    const minor = f(density * f(0.08))
    const raw = (x: number, y: number, dir: number) => {
      if (!inside(x, y)) return false
      // Grouping: each block of cells has a dominant direction (chosen with the same weights); its links mostly follow it.
      const r = f(hb(x, y, 41) * domScale)
      const dom = r < domCuts[0] ? 0 : r < domCuts[1] ? 1 : r < domCuts[2] ? 2 : 3
      return h(x, y, 1 + dir) < mix(pBase[dir], dir === dom ? density : minor, grouping)
    }
    // The two diagonals of the square [k, k + (1,1)] cross: the square picks one.
    const pickNE = (x: number, y: number) => h(x, y, 9) < 0.5
    const link = (x: number, y: number, dir: number) =>
      dir === 2 ? raw(x, y, 2) && pickNE(x, y) && inside(x + 1, y + 1)
      : dir === 3 ? raw(x, y, 3) && !pickNE(x, y - 1) && inside(x + 1, y - 1)
      : dir === 0 ? raw(x, y, 0) && inside(x + 1, y)
      : raw(x, y, 1) && inside(x, y + 1)
    const own = new Uint8Array(n)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) for (let dir = 0; dir < 4; dir++) if (link(x, y, dir)) own[y * nx + x] |= 1 << dir
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x
        let degree = 0
        for (let dir = 0; dir < 4; dir++) {
          if (own[i] & (1 << dir)) {
            degree++
            links[i] |= KING_BIT[dir]
          }
          const j = idx(x - STEP[dir][0], y - STEP[dir][1])
          if (j >= 0 && own[j] & (1 << dir)) degree++
        }
        finish(x, y, i, degree)
      }
    return { links, flags }
  }

  // Route. The block's direction: straight (E / W by the horizontal bias, N / S) or diagonal, by the Diagonals share.
  const straight = clamp01(f(o.straight))
  const turnCut = f(straight + f(0.5 * f(1 - straight)))
  const blockDir = (x: number, y: number) => {
    const h2 = hb(x, y, 43)
    if (hb(x, y, 41) < diag) return 1 + 2 * Math.floor(h2 * 4) // NE, NW, SW, SE
    return (hb(x, y, 47) < bias ? 0 : 2) + (h2 < 0.5 ? 0 : 4) // E / W or N / S
  }
  // The node's one outgoing direction, or -1.
  const out = new Int8Array(n)
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      let d = -1
      if (h(x, y, 31) <= density) {
        const b = blockDir(x, y)
        const t = h(x, y, 33)
        d = (t < straight ? b : t < turnCut ? b + 1 : b + 7) % 8
        if (!inside(x + KING[d][0], y + KING[d][1])) d = -1
      }
      out[y * nx + x] = d
    }
  const outAt = (x: number, y: number) => {
    const i = idx(x, y)
    return i < 0 ? -1 : out[i]
  }
  // The one incoming direction a node accepts (its first predecessor, in a per-node priority order), or -1.
  const acc = new Int8Array(n).fill(-1)
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const start = Math.floor(h(x, y, 37) * 8)
      for (let t = 0; t < 8; t++) {
        const a = (start + t) % 8
        if (outAt(x - KING[a][0], y - KING[a][1]) === a) {
          acc[y * nx + x] = a
          break
        }
      }
    }
  const accAt = (x: number, y: number) => {
    const i = idx(x, y)
    return i < 0 ? -1 : acc[i]
  }
  const raw = (x: number, y: number, d: number) => outAt(x, y) === d && accAt(x + KING[d][0], y + KING[d][1]) === d
  // A diagonal link and the other diagonal of its grid square: the square keeps only one of the two.
  const link = (x: number, y: number, d: number) => {
    if (d < 0 || !raw(x, y, d)) return false
    if ((d & 1) === 0) return true
    const slash = d === 1 || d === 5
    const [cx, cy] = d === 1 ? [x, y] : d === 5 ? [x - 1, y - 1] : d === 3 ? [x - 1, y] : [x, y - 1]
    const keepSlash = h(cx, cy, 51) < 0.5
    if (slash === keepSlash) return true
    return !(slash ? raw(cx + 1, cy, 3) || raw(cx, cy + 1, 7) : raw(cx, cy, 1) || raw(cx + 1, cy + 1, 5))
  }
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x
      const linked = link(x, y, out[i])
      if (linked) links[i] = 1 << (out[i]) // parenthesised: esbuild reads "<< out" as a TS variance modifier
      // Degree: the outgoing link plus the one accepted incoming link.
      const a = acc[i]
      finish(x, y, i, (linked ? 1 : 0) + (a >= 0 && link(x - KING[a][0], y - KING[a][1], a) ? 1 : 0))
    }
  return { links, flags }
}
