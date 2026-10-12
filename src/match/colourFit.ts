// Colour fitting (docs/features/fr8.2-colour-fit.md): match a project's colours to a target directly instead of
// leaving them to random search. Render → per-channel OKLab quantile maps from the render's colour distribution to
// the target's → push every absolute colour of the project (base colour, normal-blend gradient stops, colour
// params) through the maps → re-render; a few rounds, keeping the best by the metric. Modulators (multiply,
// overlay, screen … gradients — white means "no change" there) are left alone.
//
// Engine-agnostic: the caller supplies `render(project) → MatchImage` (palette snap off) and a Matcher.

import { linearToOklab, oklabToLinear, linearToSrgb1, srgbToLinear1, hexToRgb, rgbToHex, type RGB } from '@/core/color'
import type { Gradient } from '@/core/params'
import type { Project } from '@/core/project'
import { getLayerDef, layerGroups, layerParamDefs } from '@/layers/registry'
import { TONE_RANKS, targetTones } from './analyze'
import { toOklab, type MatchImage } from './image'
import type { Matcher } from './metrics'
import { getRecipe, setMacro } from '@/recipes'

/** One colour in a project the fit may change. */
export interface ColourSlot {
  /** e.g. "base", "Stone colour › dif_grad #2". */
  label: string
  get(): string
  set(hex: string): void
  /** Fit only the lightness (keep hue and chroma). */
  lightnessOnly?: boolean
}

const NORMAL_BLENDS = new Set(['normal', undefined])

/**
 * Member-layer params a smart material's colour controls drive (`layerId:key`): found by rebuilding the recipe with
 * every colour control changed and diffing — those colours are fitted through the controls instead.
 */
function macroDriven(p: Project): Set<string> {
  const out = new Set<string>()
  for (const m of p.materials ?? []) {
    const def = getRecipe(m.recipe)
    if (!def) continue
    const alt = { ...m.params }
    for (const d of def.params) {
      if (d.type === 'color') alt[d.key] = '#010203'
      else if (d.type === 'gradient' && m.params[d.key]) alt[d.key] = { stops: (m.params[d.key] as Gradient).stops.map((s) => ({ ...s, color: '#010203' })) }
    }
    const ctx = { width: p.width, height: p.height, depth: p.heightDepth }
    const a = def.build(m.params, ctx)
    const b = def.build(alt, ctx)
    for (const x of a) {
      const y = b.find((r) => r.role === x.role)
      const id = m.members[x.role]
      if (!y || !id) continue
      for (const k of Object.keys(x.layer.params)) if (JSON.stringify(x.layer.params[k]) !== JSON.stringify(y.layer.params[k])) out.add(`${id}:${k}`)
    }
  }
  return out
}

/**
 * The absolute colours of `p` (mutable through the slots): base colour, smart materials' colour controls (written
 * through setMacro, so the controls stay in charge), and enabled paint layers' other colours.
 */
export function colourSlots(p: Project): ColourSlot[] {
  const out: ColourSlot[] = [{ label: 'base', get: () => p.base.color, set: (c) => (p.base.color = c) }]
  for (const m of p.materials ?? []) {
    const def = getRecipe(m.recipe)
    const lightnessOnly = def?.fit === 'lightness'
    if (def?.fit === 'none' || def?.fit === 'tones') continue
    for (const d of def?.params ?? []) {
      if (d.type === 'color' && typeof m.params[d.key] === 'string') {
        out.push({ label: `${m.name} › ${d.key}`, get: () => String(m.params[d.key]), set: (c) => void setMacro(p, m, d.key, c), lightnessOnly })
      } else if (d.type === 'gradient' && m.params[d.key]) {
        ;(m.params[d.key] as Gradient).stops.forEach((_, i) =>
          out.push({
            lightnessOnly,
            label: `${m.name} › ${d.key} #${i + 1}`,
            get: () => (m.params[d.key] as Gradient).stops[i].color,
            set: (c) => {
              const g = JSON.parse(JSON.stringify(m.params[d.key])) as Gradient
              g.stops[i].color = c
              setMacro(p, m, d.key, g)
            },
          }),
        )
      }
    }
  }
  const driven = macroDriven(p)
  // Relief layers' colours are discarded by the reset after the relief stack.
  for (const layer of p.layers) {
    if (!layer.enabled || layer.locked) continue
    const def = getLayerDef(layer.type)
    if (!def) continue
    const toggles = new Map(layerGroups(def).filter((g) => g.toggleKey).map((g) => [g.id, g.toggleKey!]))
    const q = layer.params
    for (const d of layerParamDefs(layer.type)) {
      const toggle = d.group ? toggles.get(d.group) : undefined
      if (toggle && q[toggle] !== true) continue
      if (driven.has(`${layer.id}:${d.key}`)) continue
      if (d.type === 'color' && typeof q[d.key] === 'string') {
        out.push({ label: `${layer.name} › ${d.key}`, get: () => String(q[d.key]), set: (c) => (q[d.key] = c) })
      } else if (d.type === 'gradient' && d.key === 'dif_grad' && NORMAL_BLENDS.has(q.dif_blend as string | undefined)) {
        const g = q[d.key] as Gradient
        g.stops.forEach((s, i) => out.push({ label: `${layer.name} › ${d.key} #${i + 1}`, get: () => s.color, set: (c) => (s.color = c) }))
      }
    }
  }
  return out
}

const Q = 256

function quantilesOf(v: Float32Array): Float32Array {
  const s = Float32Array.from(v).sort()
  const out = new Float32Array(Q)
  for (let i = 0; i < Q; i++) {
    const x = (i / (Q - 1)) * (s.length - 1)
    const a = Math.floor(x)
    const b = Math.min(s.length - 1, a + 1)
    out[i] = s[a] + (s[b] - s[a]) * (x - a)
  }
  return out
}

/** Monotone 1-D map taking the distribution with quantiles `src` onto the one with quantiles `dst`. */
export function quantileMap(src: Float32Array, dst: Float32Array): (v: number) => number {
  return (v) => {
    if (v <= src[0]) return dst[0] + (v - src[0])
    if (v >= src[Q - 1]) return dst[Q - 1] + (v - src[Q - 1])
    let lo = 0
    let hi = Q - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (src[mid] <= v) lo = mid
      else hi = mid
    }
    const span = src[hi] - src[lo]
    const t = span > 1e-9 ? (v - src[lo]) / span : 0.5
    return dst[lo] + (dst[hi] - dst[lo]) * t
  }
}

export type ColourMap = (hex: string, lightnessOnly?: boolean) => string

function moments(v: Float32Array): [number, number] {
  let m = 0
  for (let i = 0; i < v.length; i++) m += v[i]
  m /= v.length
  let q = 0
  for (let i = 0; i < v.length; i++) q += (v[i] - m) ** 2
  return [m, Math.sqrt(q / v.length)]
}

/** Mean / spread matching of one channel, the contrast stretch clamped to 0.5–2× (keeps structure intact). */
function momentMap(src: Float32Array, dst: Float32Array): (v: number) => number {
  const [ms, ss] = moments(src)
  const [md, sd] = moments(dst)
  const k = Math.min(2, Math.max(0.5, ss > 1e-6 ? sd / ss : 1))
  return (v) => md + (v - ms) * k
}

export type ColourFitMode = 'quantile' | 'moments'

/**
 * Per-channel OKLab maps from `render`'s colours to `target`'s, as a hex → hex map. 'quantile' matches the whole
 * distribution (best for continuous references); 'moments' matches mean and spread only — gentler, and safe for
 * palettised references with large flat areas (a quantile map stretches their tails into blotches).
 */
export function colourMap(render: MatchImage, target: MatchImage, strength = 1, mode: ColourFitMode = 'quantile'): ColourMap {
  const r = toOklab(render)
  const t = toOklab(target)
  const one = (a: Float32Array, b: Float32Array) => (mode === 'moments' ? momentMap(a, b) : quantileMap(quantilesOf(a), quantilesOf(b)))
  const maps = [one(r.L, t.L), one(r.A, t.A), one(r.B, t.B)]
  return (hex, lightnessOnly = false) => {
    const lab = linearToOklab(hexToRgb(hex).map(srgbToLinear1) as RGB)
    const out = lab.map((v, i) => (lightnessOnly && i > 0 ? v : v + (maps[i](v) - v) * strength)) as RGB
    out[0] = Math.min(1, Math.max(0, out[0]))
    const lin = oklabToLinear(out).map((v) => Math.min(1, Math.max(0, v)))
    return rgbToHex(lin.map(linearToSrgb1) as RGB)
  }
}

/** Push every colour slot of `p` (in place) through `map`. */
export function applyColourMap(p: Project, map: ColourMap): number {
  const slots = colourSlots(p)
  for (const s of slots) s.set(map(s.get(), s.lightnessOnly))
  return slots.length
}

/**
 * Gradient stop positions for tones taken at lightness `ranks`, from the sorted values (0..1) of the layer they colour:
 * each tone sits at the value of the same rank (the ends at 1.5 % / 98.5 %, the middles of the reference's end bands),
 * so the value's distribution maps onto the tones in the reference's proportions.
 */
export function tonePositions(sorted: ArrayLike<number>, ranks: number[] = TONE_RANKS): number[] {
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]
  let prev = -1
  return ranks.map((q) => {
    const pos = Math.max(prev + 0.0005, Math.min(1, at(Math.min(0.985, Math.max(0.015, q)))))
    prev = pos
    return Math.round(pos * 10000) / 10000
  })
}

type Render = (p: Project) => MatchImage | Promise<MatchImage>

/**
 * Tone fit for materials with `fit: 'tones'` (RecipeDef.fit): reads the distribution of the value the material's ramp
 * colours, then makes the ramp the target's tones at the value's quantiles and the colour controls its brightest tone.
 * The value comes from three probe renders with the other colour controls black (lighten layers off): ramp black →
 * white, all black and all white. Light is linear in albedo, so per pixel (a − black) / (white − black) is the ramp's
 * linear albedo whatever the lighting, sheen or glow adds. Returns a fitted copy.
 */
export async function fitTones(project: Project, target: MatchImage, render: Render): Promise<Project> {
  const p: Project = JSON.parse(JSON.stringify(project))
  const tones = targetTones(target)
  for (const m of p.materials ?? []) {
    const def = getRecipe(m.recipe)
    const ramp = def?.params.find((d) => d.type === 'gradient')
    if (def?.fit !== 'tones' || !ramp) continue
    const probe = async (from: string, to: string): Promise<Float32Array> => {
      const q: Project = JSON.parse(JSON.stringify(p))
      const qm = q.materials!.find((x) => x.id === m.id)!
      setMacro(q, qm, ramp.key, { stops: [{ pos: 0, color: from }, { pos: 1, color: to }] })
      for (const d of def.params) if (d.type === 'color') setMacro(q, qm, d.key, '#000000')
      const img = await render(q)
      const out = new Float32Array(img.width * img.height)
      for (let i = 0; i < out.length; i++) out[i] = srgbToLinear1((img.data[i * 4] + img.data[i * 4 + 1] + img.data[i * 4 + 2]) / 3)
      return out
    }
    const a = await probe('#000000', '#ffffff')
    const black = await probe('#000000', '#000000')
    const white = await probe('#ffffff', '#ffffff')
    const value = a.map((v, i) => linearToSrgb1(Math.min(1, Math.max(0, (v - black[i]) / Math.max(white[i] - black[i], 1e-4)))))
    value.sort()
    const pos = tonePositions(value)
    setMacro(p, m, ramp.key, { stops: tones.map((color, k) => ({ pos: pos[k], color })) })
    for (const d of def.params) if (d.type === 'color') setMacro(p, m, d.key, tones[tones.length - 1])
  }
  return p
}

export interface ColourFitResult {
  project: Project
  /** Metric totals before and after. */
  before: number
  after: number
  rounds: number
}

/**
 * Fit the colours of `project` to the matcher's target: up to `rounds` render → map → apply rounds (stopping when a
 * round doesn't improve), returning the best project. The input is not modified.
 */
export async function fitColours(
  project: Project,
  matcher: Matcher,
  render: Render,
  opts: { rounds?: number; strength?: number; mode?: ColourFitMode | 'auto' } = {},
): Promise<ColourFitResult> {
  let best: Project = JSON.parse(JSON.stringify(project))
  let image = matcher.fit(await render(best))
  const before = matcher.score(image).total
  let bestLoss = before
  let rounds = 0
  // Tone-fitted materials first (once); the colour maps below leave their ramps alone.
  if ((best.materials ?? []).some((m) => getRecipe(m.recipe)?.fit === 'tones')) {
    const toned = await fitTones(best, matcher.target, render)
    const im = matcher.fit(await render(toned))
    const l = matcher.score(im).total
    if (l < bestLoss) {
      best = toned
      bestLoss = l
      image = im
      rounds++
    }
  }
  // 'auto' tries both kinds of map each round and keeps whichever scores better.
  const modes: ColourFitMode[] = opts.mode === 'quantile' ? ['quantile'] : opts.mode === 'moments' ? ['moments'] : ['moments', 'quantile']
  for (let i = 0; i < (opts.rounds ?? 4); i++) {
    let next: Project | null = null
    let img: MatchImage | null = null
    let loss = Infinity
    for (const mode of modes) {
      const cand: Project = JSON.parse(JSON.stringify(best))
      applyColourMap(cand, colourMap(image, matcher.target, opts.strength ?? 1, mode))
      const im = matcher.fit(await render(cand))
      const l = matcher.score(im).total
      if (l < loss) {
        loss = l
        next = cand
        img = im
      }
    }
    if (!next || !img || loss >= bestLoss - 1e-5) break
    best = next
    bestLoss = loss
    image = img
    rounds++
  }
  return { project: best, before, after: bestLoss, rounds }
}
