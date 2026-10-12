// Pipe networks (FR8.12), CPU side: runs (polylines) → primitives the Pipes shader draws — straight lengths, filleted
// elbows (arcs) and fittings (collars, bolted flanges) — encoded into an RGBA8 texture (16-bit fixed point).
//
// Runs come from a drawn polyline list or a random, tileable layout: horizontal runs spanning the width (some jogging
// up or down and back), vertical runs spanning the height or teeing between two horizontal runs; vertical runs pass in
// front. When tiling, every run spans exactly one period (or ends on other pipes) and primitives near an edge are
// copied across it, so the texture wraps.

export interface PipeRun {
  /** Centre line (px, y down). */
  points: [number, number][]
  radius: number
  /** Height of the pipe's axis above the wall (px): pipes in front sit higher. */
  depth: number
  /** Ends that need a fitting (an end inside the texture, not a run continuing across the edge). */
  capStart: boolean
  capEnd: boolean
  /** Ends that tee into another pipe: a collar just outside it, at this distance from the end. */
  teeStart?: number
  teeEnd?: number
  /** Runs (indices) this one tees into: it shares their liquid surface (the lowest of them). */
  joins?: number[]
}

export const PRIM_LINE = 0
export const PRIM_ARC = 1
export const PRIM_COLLAR = 2
export const PRIM_FLANGE = 3

export interface PipePrim {
  kind: number
  /** Line start / arc centre / fitting centre. */
  x: number
  y: number
  /** Line end. */
  x1: number
  y1: number
  /** Arc: bend radius, start angle, sweep (rad). Fitting: axis angle, half width, outer radius. */
  bend: number
  a0: number
  sweep: number
  halfWidth: number
  outer: number
  radius: number
  depth: number
  pipe: number
  /** Liquid surface (px, y down): the run is liquid below it. */
  level: number
}

export interface PipeOptions {
  width: number
  height: number
  tile: boolean
  seed: number
  /** Elbow centre-line radius in pipe radii (≥ 1). */
  bend: number
  /** Coupling spacing along straight lengths (px; 0 = none). */
  spacing: number
  /** Chance a coupling is a bolted flange. */
  flanges: number
  /** Collar size: extra radius as a fraction of the pipe radius. */
  collar: number
  /** Collars at both ends of each elbow. */
  elbowFittings: boolean
  /** Liquid fill (0..1) of each run's lowest horizontal length; the surface is level across the whole run. */
  fill?: number
}

export function rng(seed: number) {
  let s = (Math.floor(seed) >>> 0) ^ 0x9e3779b9
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Polylines from a points list ("x,y x,y …", one run per line or "|"); `fraction` scales 0..1 to the texture. */
export function parseRuns(text: string, fraction: boolean, width: number, height: number): [number, number][][] {
  const out: [number, number][][] = []
  for (const part of text.split(/[|\n]/)) {
    const pts = part
      .trim()
      .split(/\s+/)
      .map((t) => t.split(',').map(Number))
      .filter((v) => v.length === 2 && v.every(Number.isFinite))
      .map(([x, y]) => (fraction ? [x * width, y * height] : [x, y]) as [number, number])
    if (pts.length >= 2) out.push(pts)
  }
  return out
}

export interface RandomLayout {
  /** Horizontal runs. */
  runs: number
  /** Vertical runs. */
  drops: number
  radius: number
  /** Radius variation (0..1). */
  variety: number
  /** Chance a horizontal run jogs up or down and back. */
  jogs: number
  /** Chance a vertical run tees between two horizontal runs instead of spanning the height. */
  tees: number
}

/** A random tileable layout: horizontal runs (some jogging), vertical runs spanning or teeing, verticals in front. */
export function randomRuns(o: PipeOptions, l: RandomLayout): PipeRun[] {
  const rand = rng(o.seed * 7919 + 13)
  const { width: W, height: H } = o
  const radius = () => Math.max(1, l.radius * (1 + l.variety * 0.8 * (rand() - 0.5)))
  const pad = o.tile ? 0 : 4 * l.radius
  const runs: PipeRun[] = []
  // Horizontal runs: keep clear of each other (jogs included).
  const taken: [number, number][] = []
  const free = (lo: number, hi: number) => taken.every(([a, b]) => hi < a || lo > b)
  const hs: { y: number; r: number; pts: [number, number][]; i: number }[] = []
  for (let k = 0; k < l.runs; k++) {
    const r = radius()
    for (let tries = 0; tries < 40; tries++) {
      const y = o.tile ? rand() * H : r * 2 + rand() * (H - r * 4)
      const jog = rand() < l.jogs
      const dy = (rand() < 0.5 ? -1 : 1) * (2.5 + 2 * rand()) * r * Math.max(1, o.bend)
      const lo = Math.min(y, jog ? y + dy : y) - r * 1.8
      const hi = Math.max(y, jog ? y + dy : y) + r * 1.8
      if (!free(lo, hi) || (!o.tile && (lo < 0 || hi > H))) continue
      taken.push([lo, hi])
      const x0 = o.tile ? rand() * W : -pad
      const x1 = o.tile ? x0 + W : W + pad
      let pts: [number, number][] = [[x0, y], [x1, y]]
      if (jog) {
        const span = x1 - x0
        const a = x0 + span * (0.15 + 0.3 * rand())
        const b = a + span * (0.2 + 0.3 * rand())
        pts = [[x0, y], [a, y], [a, y + dy], [b, y + dy], [b, y], [x1, y]]
      }
      runs.push({ points: pts, radius: r, depth: 0, capStart: false, capEnd: false })
      hs.push({ y, r, pts, i: runs.length - 1 })
      break
    }
  }
  // Vertical runs, in front: spanning the height, or teeing between two horizontal runs.
  const front = Math.max(0, ...hs.map((h) => h.r))
  const xs: number[] = []
  for (let k = 0; k < l.drops; k++) {
    const r = radius()
    for (let tries = 0; tries < 40; tries++) {
      const x = o.tile ? rand() * W : r * 2 + rand() * (W - r * 4)
      if (xs.some((x2) => Math.abs(x2 - x) < r * 5)) continue
      xs.push(x)
      if (hs.length >= 2 && rand() < l.tees) {
        // A stub between two horizontal runs next to each other at this x (at the same depth: it tees into them),
        // clear of their jogs' elbows.
        const at = hs.map((h) => ({ h, y: yAt(h.pts, x, W, o.tile, r * (o.bend + 2)) })).filter((v) => v.y !== null) as { h: (typeof hs)[0]; y: number }[]
        at.sort((a, b) => a.y - b.y)
        if (at.length < 2) {
          xs.pop()
          continue
        }
        const i = Math.floor(rand() * (at.length - 1))
        const a = at[i]
        const b = at[i + 1]
        runs.push({ points: [[x, a.y], [x, b.y]], radius: Math.min(r, a.h.r, b.h.r) * 0.85, depth: 0, capStart: false, capEnd: false, teeStart: a.h.r, teeEnd: b.h.r, joins: [a.h.i, b.h.i] })
      } else {
        const y0 = o.tile ? rand() * H : -pad
        runs.push({ points: [[x, y0], [x, o.tile ? y0 + H : H + pad]], radius: r, depth: front, capStart: false, capEnd: false })
      }
      break
    }
  }
  return runs
}

const len = (x: number, y: number) => Math.hypot(x, y)

/**
 * The height of a horizontal run (a polyline of horizontal lengths and vertical jogs) at x — null within `clear` px of
 * a jog (its elbows) or outside the run. When tiling, x wraps into the run's period.
 */
export function yAt(pts: [number, number][], x: number, period: number, tile: boolean, clear: number): number | null {
  const x0 = pts[0][0]
  const xx = tile ? x0 + ((((x - x0) % period) + period) % period) : x
  // Clear of every jog first, then the horizontal length under x.
  for (let k = 0; k + 1 < pts.length; k++) if (Math.abs(pts[k][0] - pts[k + 1][0]) < 1e-6 && Math.abs(xx - pts[k][0]) < clear) return null
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, ay] = pts[k]
    const [bx, by] = pts[k + 1]
    if (Math.abs(ay - by) < 1e-6 && Math.abs(ax - bx) > 1e-6 && xx >= Math.min(ax, bx) && xx <= Math.max(ax, bx)) return ay
  }
  return null
}

/**
 * A run's liquid surface (px, y down). Liquid settles under gravity: one level surface per run, set by its lowest
 * horizontal length (filled to `fill` of its bore); everything in the run below it is liquid — elbows and drops
 * included — and anything higher empty. A run without horizontal lengths fills from its bottom up (spanning, tiling
 * runs: full or empty).
 */
export function runLevel(run: PipeRun, o: PipeOptions): number {
  const r = run.radius
  const pts = run.points
  const fill = o.fill ?? 0
  const flats = pts.slice(1).flatMap((p, k) => (Math.abs(p[1] - pts[k][1]) < 1e-6 && Math.abs(p[0] - pts[k][0]) > 1e-6 ? [p[1] + r * (1 - 2 * fill)] : []))
  const ys = pts.map((p) => p[1])
  const top = Math.min(...ys) - r
  const bottom = Math.max(...ys) + r
  const spans = o.tile && !run.capStart && !run.capEnd && run.teeStart === undefined && run.teeEnd === undefined
  return flats.length ? Math.max(...flats) : spans ? (fill >= 0.5 ? -1e4 : 1e4) : bottom - fill * (bottom - top)
}

/** Primitives of one run: straight lengths, filleted elbows, couplings / flanges, end and tee fittings. */
export function runPrims(run: PipeRun, id: number, o: PipeOptions, rand: () => number, level = runLevel(run, o)): PipePrim[] {
  const out: PipePrim[] = []
  const { radius: r, depth } = run
  // A run teeing into another stops on that pipe's near flank, not its axis: two cylinders meeting at the axis show
  // their intersection as a sharp V.
  const pts = run.points.map((p) => [...p] as [number, number])
  const trim = (i: number, j: number, by: number | undefined) => {
    if (by === undefined) return
    const dx = pts[j][0] - pts[i][0]
    const dy = pts[j][1] - pts[i][1]
    const l = Math.hypot(dx, dy)
    const t = Math.min(0.5 * by, 0.5 * l)
    if (l > 1e-6) pts[i] = [pts[i][0] + (dx / l) * t, pts[i][1] + (dy / l) * t]
  }
  trim(0, 1, run.teeStart)
  trim(pts.length - 1, pts.length - 2, run.teeEnd)
  const teeStart = run.teeStart === undefined ? undefined : run.teeStart * 0.5
  const teeEnd = run.teeEnd === undefined ? undefined : run.teeEnd * 0.5
  const base = { radius: r, depth, pipe: id, x1: 0, y1: 0, bend: 0, a0: 0, sweep: 0, halfWidth: 0, outer: 0, level }
  const collarW = Math.max(1, r * 0.35)
  const fitting = (x: number, y: number, ang: number, flange: boolean): PipePrim => ({
    ...base,
    kind: flange ? PRIM_FLANGE : PRIM_COLLAR,
    x,
    y,
    a0: ang,
    halfWidth: flange ? Math.max(1, r * 0.45) : collarW / 2,
    outer: r * (1 + (flange ? 2.2 : 1) * o.collar),
  })
  // Fillet each corner: trim the adjoining lengths by t = rb·tan(θ/2) (at most half of either), arc between.
  const starts: [number, number][] = [pts[0]]
  const ends: [number, number][] = []
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]
    const [bx, by] = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]]
    const la = len(ax, ay)
    const lb = len(bx, by)
    if (la < 1e-6 || lb < 1e-6) continue
    const dot = (ax * bx + ay * by) / (la * lb)
    const cross = (ax * by - ay * bx) / (la * lb)
    const theta = Math.atan2(cross, dot)
    if (Math.abs(theta) < 1e-3) continue
    const half = Math.tan(Math.abs(theta) / 2)
    const t = Math.min(Math.max(1, o.bend) * r * half, 0.5 * la, 0.5 * lb)
    const rb = t / half
    const ti: [number, number] = [pts[i][0] - (ax / la) * t, pts[i][1] - (ay / la) * t]
    const to: [number, number] = [pts[i][0] + (bx / lb) * t, pts[i][1] + (by / lb) * t]
    // Centre: from the trim point along the normal on the inside of the turn.
    const s = Math.sign(theta)
    const cx = ti[0] - s * (ay / la) * rb
    const cy = ti[1] + s * (ax / la) * rb
    const a0 = Math.atan2(ti[1] - cy, ti[0] - cx)
    out.push({ ...base, kind: PRIM_ARC, x: cx, y: cy, bend: rb, a0, sweep: theta })
    ends.push(ti)
    starts.push(to)
    if (o.elbowFittings) {
      out.push(fitting(ti[0], ti[1], Math.atan2(ay, ax), false))
      out.push(fitting(to[0], to[1], Math.atan2(by, bx), false))
    }
  }
  ends.push(pts[pts.length - 1])
  for (let k = 0; k < starts.length; k++) {
    const [x0, y0] = starts[k]
    const [x1, y1] = ends[k]
    out.push({ ...base, kind: PRIM_LINE, x: x0, y: y0, x1, y1 })
    const l = len(x1 - x0, y1 - y0)
    const ang = Math.atan2(y1 - y0, x1 - x0)
    // Couplings: evenly spaced (a whole number per length, so spanning runs stay periodic), clear of the ends.
    if (o.spacing > 0 && l > o.spacing * 0.6) {
      const n = Math.max(1, Math.round(l / o.spacing))
      const off = rand()
      for (let j = 0; j < n; j++) {
        const u = (j + 0.5 * (0.6 + 0.8 * off)) / n
        if (u * l < r * 2 || (1 - u) * l < r * 2) continue
        out.push(fitting(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, ang, rand() < o.flanges))
      }
    }
  }
  // End fittings: a flange on a free end, a collar just outside the pipe a run tees into.
  const endFit = (i: number, j: number, tee: number | undefined, cap: boolean) => {
    const [x, y] = pts[i]
    const dx = pts[j][0] - x
    const dy = pts[j][1] - y
    const l = len(dx, dy)
    if (l < 1e-6) return
    const ang = Math.atan2(dy, dx)
    if (tee !== undefined) {
      const d = tee + collarW * 0.8
      if (d < l) out.push(fitting(x + (dx / l) * d, y + (dy / l) * d, ang, false))
    } else if (cap) out.push(fitting(x + (dx / l) * collarW * 0.5, y + (dy / l) * collarW * 0.5, ang, true))
  }
  endFit(0, 1, teeStart, run.capStart)
  endFit(pts.length - 1, pts.length - 2, teeEnd, run.capEnd)
  return out
}

/** Bounding radius of a primitive around its anchor (for tiling copies). */
function reach(p: PipePrim): number {
  if (p.kind === PRIM_LINE) return Math.max(Math.abs(p.x1 - p.x), Math.abs(p.y1 - p.y)) + p.radius
  if (p.kind === PRIM_ARC) return p.bend + p.radius
  return Math.max(p.outer, p.halfWidth) * 1.5
}

/** Every primitive, plus copies across the edges when tiling. */
export function buildPrims(runs: PipeRun[], o: PipeOptions): PipePrim[] {
  const rand = rng(o.seed * 31 + 7)
  // A branch shares the liquid surface of the pipes it tees into (the lowest of them: liquid pools there).
  const levels = runs.map((run) => runLevel(run, o))
  const shared = runs.map((run, i) => (run.joins?.length ? Math.max(...run.joins.map((j) => levels[j] ?? levels[i])) : levels[i]))
  const prims = runs.flatMap((run, i) => runPrims(run, i + 1, o, rand, shared[i]))
  if (!o.tile) return prims
  const out: PipePrim[] = []
  for (const p of prims) {
    const m = reach(p)
    const xs = p.kind === PRIM_LINE ? [Math.min(p.x, p.x1), Math.max(p.x, p.x1)] : [p.x, p.x]
    const ys = p.kind === PRIM_LINE ? [Math.min(p.y, p.y1), Math.max(p.y, p.y1)] : [p.y, p.y]
    for (const ox of [-o.width, 0, o.width])
      for (const oy of [-o.height, 0, o.height]) {
        if (xs[1] + ox + m < 0 || xs[0] + ox - m > o.width || ys[1] + oy + m < 0 || ys[0] + oy - m > o.height) continue
        out.push({ ...p, x: p.x + ox, y: p.y + oy, x1: p.x1 + ox, y1: p.y1 + oy, level: p.level + oy })
      }
  }
  return out
}

/**
 * RGBA8 texture: texel 0 = header (count, max surface height ×16); then 5 texels per primitive, two 16-bit values
 * each (high byte first): [x, y] [x1, y1 | bend, a0 | angle, half width] [sweep | outer, pipe id] [kind, radius]
 * [depth, liquid level]. Positions (and the level) are (v + 4096) × 8, angles map −range..range onto 0..65535, sizes × 64
 * (bend × 8, depth × 16).
 */
export function encodePrims(prims: PipePrim[]): { width: number; height: number; data: Uint8Array } {
  const n = prims.length
  const data = new Uint8Array((1 + 5 * n) * 4)
  const put16 = (texel: number, slot: number, v: number) => {
    const q = Math.max(0, Math.min(65535, Math.round(v)))
    data[texel * 4 + slot * 2] = q >> 8
    data[texel * 4 + slot * 2 + 1] = q & 255
  }
  const pos = (v: number) => (v + 4096) * 8
  const ang = (a: number, range: number) => ((a / range) * 0.5 + 0.5) * 65535
  let hmax = 1
  for (const p of prims) hmax = Math.max(hmax, p.depth + (p.kind >= PRIM_COLLAR ? p.outer : p.radius))
  put16(0, 0, n)
  put16(0, 1, hmax * 16)
  prims.forEach((p, i) => {
    const t = 1 + 5 * i
    put16(t, 0, pos(p.x))
    put16(t, 1, pos(p.y))
    if (p.kind === PRIM_LINE) {
      put16(t + 1, 0, pos(p.x1))
      put16(t + 1, 1, pos(p.y1))
    } else if (p.kind === PRIM_ARC) {
      put16(t + 1, 0, p.bend * 8)
      put16(t + 1, 1, ang(p.a0, Math.PI))
      put16(t + 2, 0, ang(p.sweep, 2 * Math.PI))
    } else {
      put16(t + 1, 0, ang(p.a0, Math.PI))
      put16(t + 1, 1, p.halfWidth * 64)
      put16(t + 2, 0, p.outer * 64)
    }
    put16(t + 2, 1, p.pipe)
    data[(t + 3) * 4] = p.kind
    put16(t + 3, 1, p.radius * 64)
    put16(t + 4, 0, p.depth * 16)
    put16(t + 4, 1, pos(Math.max(-4096, Math.min(4095, p.level))))
  })
  return { width: 1 + 5 * n, height: 1, data }
}
