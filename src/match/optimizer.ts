// Reference-matching optimiser (docs/features/fr6.3-optimizer.md). Engine-agnostic: it only needs an
// `evaluate(project) → loss` callback (render + metrics), so the same class runs in the Match workspace
// and headlessly (src/headless.ts → tools/harness.ts optimize).
//
//   const space = extractParams(project)               // what may change, as a flat normalised vector
//   const p2 = applyParams(project, space, vector)       // → new Project (input untouched)
//   const opt = new Optimizer(project, evaluate, { seed: 1 })
//   await opt.step()  // one generation of λ candidates; opt.best / opt.history for the UI
//
// Algorithm: (1+λ)-ES over sparse mutations (a few entries per candidate) with a per-entry step size σ
// adapted by success rate (≈1/5 rule), per-entry selection weights learnt from successes / inert
// mutations, categorical resampling for enums (low probability), restarts around the best after
// stagnation, and optional structural mutations (toggle a layer, change a blend mode, insert / remove a
// layer from a small library; an inserted layer gets a few evaluations of its own tuning before it is judged).
// All randomness comes from a seeded RNG, so runs are reproducible as long as `evaluate` is deterministic (fixed
// sample count; the path tracer is seeded by sample index).

import { linearToOklab, oklabToLinear, linearToSrgb1, srgbToLinear1, rgbToHex, hexToRgb, type RGB } from '@/core/color'
import { isOptimizable, gradient, type Gradient, type ParamDef, type ParamValues } from '@/core/params'
import type { Layer, Project } from '@/core/project'
import { LIGHT_DEFS } from '@/core/lights'
import { BASE_DEFS, PROJECT_DEFS, RENDER_DEFS } from '@/core/settingsDefs'
import { ensureBuiltins } from '@/render/builtins'
import { createLayer, getLayerDef, layerGroups, layerParamDefs } from '@/layers/registry'
import { getPostDef } from '@/render/post/registry'
import { patternKeys } from '@/core/links'
import { applyColourMap, colourMap } from './colourFit'
import { colourRange, constrainLab, type ColourRange } from './colourRange'
import type { MatchImage } from './image'

// ------------------------------------------------------------------------------------------------ RNG

/** Small seeded PRNG (mulberry32) with normal / integer helpers. */
export class Rng {
  private s: number
  constructor(seed = 1) {
    this.s = (seed >>> 0) ^ 0x9e3779b9
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  normal(): number {
    let u = 0
    while (u === 0) u = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next())
  }
  int(n: number): number {
    return Math.min(n - 1, Math.floor(this.next() * n))
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]
  }
}

// ------------------------------------------------------------------------------------------------ space

export interface PriorQuery {
  project: Project
  scope: ParamScope
  /** Layer type when the owner is a layer. */
  layerType?: string
  params: ParamValues
  def: ParamDef
}

export interface Prior {
  /** Leave the entry out of the search. */
  exclude?: boolean
  /** Narrow the numeric range (the current value always stays inside). */
  lo?: number
  hi?: number
}

export interface SpaceOptions {
  /** Unlocked, enabled layers' optimisable params (default true). */
  layers?: boolean
  /** Light params, sky and ambient intensity (default false). */
  lights?: boolean
  /** Post filter params of enabled filters (default false). */
  post?: boolean
  /** Base material colour, roughness and specular (default false). */
  base?: boolean
  /**
   * Shading levers (default false): ambient occlusion strength and radius, specular scale and tint (render settings)
   * and the project's height depth.
   */
  shading?: boolean
  /** Include enum / bool params (resampled categorically, with low probability). Default false. */
  enums?: boolean
  /** Include layer seeds (re-rolled, like enums). Default false. */
  seeds?: boolean
  /** Map numbers over softMin..softMax (the UI slider range) rather than the hard limits. Default true. */
  softRange?: boolean
  /** Final say over which entries are included (e.g. a UI checklist). */
  filter?: (entry: ParamEntry) => boolean
  /** Per-param prior: exclude an entry or narrow its numeric range. */
  prior?: (q: PriorQuery) => Prior | undefined
}

export type ParamScope = 'layer' | 'light' | 'post' | 'base' | 'lighting' | 'render' | 'project'

export type EntryKind = 'number' | 'color' | 'stop-color' | 'stop-pos' | 'enum' | 'seed'

export interface ParamEntry {
  /** Stable id, e.g. "layer:ly_abc12:scale", "layer:ly_abc12:dif_grad:1:color", "light:lt_x:azimuth". */
  id: string
  /** Human-readable, e.g. "Noise › Scale". */
  label: string
  kind: EntryKind
  scope: ParamScope
  /** Layer / light / post filter id ('' for base, lighting, render and project). */
  owner: string
  /** Param key (e.g. 'roughness' for base, 'heightDepth' for project, 'sky.intensity' for lighting). */
  key: string
  /** Gradient stop index for stop-color / stop-pos. */
  stop?: number
  /** Index of the first component in the vector. */
  offset: number
  /** Number of vector components (3 for colours: OKLab, else 1). */
  dims: number
  /** number: value range mapped to 0..1 (log-scaled when `log`). */
  lo?: number
  hi?: number
  log?: boolean
  int?: boolean
  /** Circular (angles spanning 360°). */
  wrap?: boolean
  /** At its default "off" value (e.g. jitter 0, posterize 0, count 1): switching an effect on is picked less. */
  dormant?: boolean
  /** enum: option values (vector holds the index). */
  options?: (string | boolean)[]
  /** The ParamDef this entry came from (when any). */
  def?: ParamDef
  /** Further layers written with the same value: copies of one pattern (see patternTies). */
  tied?: string[]
}

export interface ParamSpace {
  entries: ParamEntry[]
  /** Vector length. */
  size: number
  /** The extracted project's values. */
  initial: Float64Array
  options: SpaceOptions
}

// OKLab components are stored normalised: L as is (0..1), a and b as (v + AB) / (2·AB).
const AB = 0.4

function colorToVec(hex: string): RGB {
  const lab = linearToOklab(hexToRgb(hex).map(srgbToLinear1) as RGB)
  return [lab[0], (lab[1] + AB) / (2 * AB), (lab[2] + AB) / (2 * AB)]
}

/** Normalised OKLab → linear RGB, clipped to gamut (returns the clipped linear colour). */
function vecToLinear(v: ArrayLike<number>, o: number): RGB {
  const lin = oklabToLinear([v[o], v[o + 1] * 2 * AB - AB, v[o + 2] * 2 * AB - AB])
  return [Math.min(1, Math.max(0, lin[0])), Math.min(1, Math.max(0, lin[1])), Math.min(1, Math.max(0, lin[2]))]
}

function vecToColor(v: ArrayLike<number>, o: number): string {
  return rgbToHex(vecToLinear(v, o).map(linearToSrgb1) as RGB)
}

/** Pull an out-of-gamut colour back onto the gamut (in place) so the vector matches what renders. */
function clipColorInPlace(v: Float64Array, o: number): void {
  v[o] = Math.min(1, Math.max(0, v[o]))
  const lab = linearToOklab(vecToLinear(v, o))
  v[o] = lab[0]
  v[o + 1] = (lab[1] + AB) / (2 * AB)
  v[o + 2] = (lab[2] + AB) / (2 * AB)
}

function numToX(e: ParamEntry, value: number): number {
  const lo = e.lo!
  const hi = e.hi!
  if (e.log) return (Math.log(Math.max(lo, value)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
  return (value - lo) / (hi - lo)
}

function xToNum(e: ParamEntry, x: number): number {
  const lo = e.lo!
  const hi = e.hi!
  let v = e.log ? Math.exp(Math.log(lo) + x * (Math.log(hi) - Math.log(lo))) : lo + x * (hi - lo)
  if (e.def?.min !== undefined) v = Math.max(e.def.min, v)
  if (e.def?.max !== undefined) v = Math.min(e.def.max, v)
  if (e.int) return Math.round(v)
  // Keep JSON tidy: 5 significant digits.
  return Number(v.toPrecision(5))
}

function numberRange(def: ParamDef, value: number, softRange: boolean, pxLimit: number) {
  let lo = softRange && def.softMin !== undefined ? def.softMin : (def.min ?? 0)
  let hi = softRange && def.softMax !== undefined ? def.softMax : (def.max ?? Math.max(1, Math.abs(value) * 2))
  if (def.unit === 'px') {
    // Pixel params: ranges beyond the texture size are rarely useful.
    lo = Math.max(lo, -pxLimit)
    hi = Math.min(hi, pxLimit)
  }
  lo = Math.min(lo, value)
  hi = Math.max(hi, value)
  if (hi - lo < 1e-9) hi = lo + 1
  const log = lo > 0 && hi / lo >= 16
  const wrap = def.unit === '°' && hi - lo >= 359.999
  return { lo, hi, log, wrap }
}

interface Owner {
  scope: ParamScope
  id: string
  /** Layer type (layers only). */
  type?: string
  name: string
  defs: ParamDef[]
  params: ParamValues
  /** group id → toggle key (channel enables) */
  toggles: Map<string, string>
  /** Keys that place / shape the pattern itself (layers only; see patternTies). */
  pattern?: Set<string>
}

/**
 * Tied pattern params. Layers of one type that share a seed are copies of one pattern, used for different jobs:
 * height-only Pillow / Edges / Block heights, a layer colouring each stone, water stains plus rust
 * trails from the same sources. A pattern param they hold equal becomes one entry (on the first copy, `tied` to
 * the others) so tuning moves the copies together instead of pulling them apart. Params they already differ in
 * (a bevel, a trail width) stay independent.
 */
function patternTies(os: Owner[]): { lead: Map<string, string[]>; follow: Set<string> } {
  const groups = new Map<string, { key: string; ids: string[] }>()
  for (const o of os) {
    if (!o.pattern || o.params.seed === undefined) continue
    for (const key of o.pattern) {
      const v = o.params[key]
      if (v === undefined) continue
      const g = `${o.type}\u0000${String(o.params.seed)}\u0000${key}\u0000${JSON.stringify(v)}`
      const entry = groups.get(g)
      if (entry) entry.ids.push(o.id)
      else groups.set(g, { key, ids: [o.id] })
    }
  }
  const lead = new Map<string, string[]>()
  const follow = new Set<string>()
  for (const { key, ids } of groups.values()) {
    if (ids.length < 2) continue
    lead.set(`${ids[0]}:${key}`, ids.slice(1))
    for (const id of ids.slice(1)) follow.add(`${id}:${key}`)
  }
  return { lead, follow }
}

function owners(project: Project, opts: SpaceOptions): Owner[] {
  const out: Owner[] = []
  if (opts.layers !== false) {
    for (const layer of project.layers) {
      if (!layer.enabled || layer.locked) continue
      const def = getLayerDef(layer.type)
      if (!def) continue
      const toggles = new Map<string, string>()
      for (const g of layerGroups(def)) if (g.toggleKey) toggles.set(g.id, g.toggleKey)
      const defs = layerParamDefs(layer.type)
      out.push({ scope: 'layer', id: layer.id, type: layer.type, name: layer.name, defs, params: layer.params, toggles, pattern: patternKeys(layer.type) })
    }
  }
  if (opts.lights) {
    for (const light of project.lighting.lights) {
      if (!light.enabled) continue
      out.push({ scope: 'light', id: light.id, name: light.name, defs: LIGHT_DEFS[light.type].params, params: light.params, toggles: new Map() })
    }
  }
  if (opts.base) {
    const defs = BASE_DEFS.filter((d) => d.key === 'color' || d.key === 'roughness' || d.key === 'specular')
    out.push({ scope: 'base', id: '', name: 'Base', defs, params: project.base as unknown as ParamValues, toggles: new Map() })
  }
  if (opts.shading) {
    // The AO radius only matters while the strength is above 0 (its showIf), so isEntryActive skips it until then.
    const keys = new Set(['ao', 'aoRadius', 'specular', 'specularTint'])
    out.push({ scope: 'render', id: '', name: 'Render', defs: RENDER_DEFS.filter((d) => keys.has(d.key)), params: project.render as unknown as ParamValues, toggles: new Map() })
    const depth = PROJECT_DEFS.filter((d) => d.key === 'heightDepth')
    out.push({ scope: 'project', id: '', name: 'Texture', defs: depth, params: project as unknown as ParamValues, toggles: new Map() })
  }
  if (opts.post) {
    for (const f of project.post) {
      const def = getPostDef(f.type)
      if (!f.enabled || !def) continue
      const toggles = new Map<string, string>()
      for (const g of def.groups ?? []) if (g.toggleKey) toggles.set(g.id, g.toggleKey)
      out.push({ scope: 'post', id: f.id, name: def.label, defs: def.params, params: f.params, toggles })
    }
  }
  return out
}

/** Extract the mutable parameters of a project as a normalised vector (see ParamEntry). */
export function extractParams(project: Project, opts: SpaceOptions = {}): ParamSpace {
  ensureBuiltins()
  const entries: ParamEntry[] = []
  const values: number[] = []
  const softRange = opts.softRange !== false
  const pxLimit = Math.max(project.width, project.height)
  const add = (e: Omit<ParamEntry, 'offset'>, v: number[]) => {
    const entry = { ...e, offset: values.length } as ParamEntry
    if (opts.filter && !opts.filter(entry)) return
    entries.push(entry)
    values.push(...v)
  }

  const os = owners(project, opts)
  const ties = patternTies(os)
  for (const o of os) {
    const toggleKeys = new Set(o.toggles.values())
    for (const def of o.defs) {
      const value = o.params[def.key]
      if (value === undefined) continue
      if (ties.follow.has(`${o.id}:${def.key}`)) continue // written through the first copy's entry
      const prior = opts.prior?.({ project, scope: o.scope, layerType: o.type, params: o.params, def })
      if (prior?.exclude) continue
      const tied = ties.lead.get(`${o.id}:${def.key}`)
      const base = { scope: o.scope, owner: o.id, key: def.key, def, ...(tied ? { tied } : {}) }
      const id = `${o.scope}:${o.id}:${def.key}`
      const label = `${o.name} › ${def.label}${tied ? ` (+${tied.length} linked)` : ''}`
      if (def.type === 'seed') {
        if (opts.seeds) add({ ...base, id, label, kind: 'seed', dims: 1 }, [Number(value)])
        continue
      }
      if (def.type === 'enum' || def.type === 'bool') {
        const wanted = def.optimize === true || (opts.enums && def.optimize !== false && def.uniform !== false)
        if (!wanted) continue
        if (toggleKeys.has(def.key)) continue // channel enables are structure, not tuning
        const options: (string | boolean)[] = def.type === 'bool' ? [false, true] : (def.options ?? []).map((x) => x.value)
        if (options.length < 2) continue
        add({ ...base, id, label, kind: 'enum', dims: 1, options }, [Math.max(0, options.indexOf(value as string | boolean))])
        continue
      }
      if (!isOptimizable(def)) continue
      if (def.type === 'float' || def.type === 'int') {
        const r = numberRange(def, Number(value), softRange, pxLimit)
        if (prior && (prior.lo !== undefined || prior.hi !== undefined)) {
          // Narrow to the prior, keeping the current value inside.
          r.lo = Math.min(Number(value), Math.max(r.lo, prior.lo ?? r.lo))
          r.hi = Math.max(Number(value), Math.min(r.hi, prior.hi ?? r.hi))
          if (r.hi - r.lo < 1e-9) r.hi = r.lo + 1e-3
          r.log = r.lo > 0 && r.hi / r.lo >= 16
        }
        const dormant = value === def.default && value === def.min
        const e = { ...base, id, label, kind: 'number' as const, dims: 1, ...r, int: def.type === 'int', dormant }
        add(e, [numToX(e as ParamEntry, Number(value))])
      } else if (def.type === 'color') {
        add({ ...base, id, label, kind: 'color', dims: 3 }, colorToVec(String(value)))
      } else if (def.type === 'gradient') {
        const stops = (value as Gradient).stops
        stops.forEach((s, i) => {
          const sid = `${id}:${i}`
          const slabel = `${label} stop ${i + 1}`
          add({ ...base, id: `${sid}:color`, label: `${slabel} colour`, kind: 'stop-color', stop: i, dims: 3 }, colorToVec(s.color))
          if (stops.length > 1) add({ ...base, id: `${sid}:pos`, label: `${slabel} position`, kind: 'stop-pos', stop: i, dims: 1 }, [s.pos])
        })
      }
    }
  }

  if (opts.lights) {
    const sky = { id: 'lighting::sky.intensity', label: 'Sky › Intensity', kind: 'number' as const, scope: 'lighting' as const, owner: '', key: 'sky.intensity', dims: 1, lo: 0, hi: Math.max(2, project.lighting.sky.intensity) }
    if (project.lighting.sky.enabled) add(sky, [numToX(sky as ParamEntry, project.lighting.sky.intensity)])
    const amb = { id: 'lighting::ambient.intensity', label: 'Ambient › Intensity', kind: 'number' as const, scope: 'lighting' as const, owner: '', key: 'ambient.intensity', dims: 1, lo: 0, hi: Math.max(0.5, project.lighting.ambient.intensity) }
    add(amb, [numToX(amb as ParamEntry, project.lighting.ambient.intensity)])
  }

  return { entries, size: values.length, initial: Float64Array.from(values), options: opts }
}

function findParams(p: Project, e: ParamEntry): ParamValues | null {
  if (e.scope === 'layer') return p.layers.find((l) => l.id === e.owner)?.params ?? null
  if (e.scope === 'light') return p.lighting.lights.find((l) => l.id === e.owner)?.params ?? null
  if (e.scope === 'post') return p.post.find((f) => f.id === e.owner)?.params ?? null
  if (e.scope === 'render') return p.render as unknown as ParamValues
  if (e.scope === 'base') return p.base as unknown as ParamValues
  if (e.scope === 'project') return p as unknown as ParamValues
  return null
}

/** Decode one entry's value from a vector (number, hex string, enum value, …). */
export function entryValue(e: ParamEntry, vector: ArrayLike<number>): number | string | boolean {
  const o = e.offset
  switch (e.kind) {
    case 'number':
      return xToNum(e, e.wrap ? ((vector[o] % 1) + 1) % 1 : Math.min(1, Math.max(0, vector[o])))
    case 'color':
    case 'stop-color':
      return vecToColor(vector, o)
    case 'stop-pos':
      return Number(Math.min(1, Math.max(0, vector[o])).toFixed(4))
    case 'enum':
      return e.options![Math.min(e.options!.length - 1, Math.max(0, Math.round(vector[o])))]
    case 'seed':
      return Math.max(0, Math.min(99999, Math.round(vector[o])))
  }
}

/** Write a vector into a copy of `project` (the input is never mutated). Gradient stops are re-sorted. */
export function applyParams(project: Project, space: ParamSpace, vector: ArrayLike<number>): Project {
  const p: Project = JSON.parse(JSON.stringify(project))
  const touched = new Set<Gradient>()
  for (const e of space.entries) {
    const v = entryValue(e, vector)
    if (e.scope === 'lighting') {
      if (e.key === 'sky.intensity') p.lighting.sky.intensity = Number(v)
      else p.lighting.ambient.intensity = Number(v)
      continue
    }
    for (const owner of e.tied ? [e.owner, ...e.tied] : [e.owner]) {
      const params = findParams(p, { ...e, owner })
      if (!params) continue
      if (e.kind === 'stop-color' || e.kind === 'stop-pos') {
        const g = params[e.key] as Gradient
        const s = g?.stops?.[e.stop!]
        if (!s) continue
        if (e.kind === 'stop-color') s.color = String(v)
        else s.pos = Number(v)
        touched.add(g)
      } else {
        params[e.key] = v
      }
    }
  }
  for (const g of touched) g.stops.sort((a, b) => a.pos - b.pos)
  return p
}

/** Whether mutating the entry can change the render of `project` (its layer/channel is on, showIf passes). */
export function isEntryActive(project: Project, e: ParamEntry): boolean {
  if (e.scope === 'lighting') return true
  const params = findParams(project, e)
  if (!params) return false
  const def = e.def
  if (!def) return true
  if (def.showIf && !def.showIf(params)) return false
  if (e.scope === 'layer') {
    const layer = project.layers.find((l) => l.id === e.owner)!
    if (!layer.enabled) return false
    const ldef = getLayerDef(layer.type)
    const group = ldef ? layerGroups(ldef).find((g) => g.id === def.group) : undefined
    if (group?.toggleKey && params[group.toggleKey] !== true) return false
  }
  return true
}

// ------------------------------------------------------------------------------------------------ search order

/**
 * Search tier of an entry: 0 form (layout, lighting, height, roughness, specular, edge shaping, shading), 1 tone
 * (diffuse amounts, value shaping, masks, post), 2 colour (colours and gradient stops).
 */
export function entryTier(e: ParamEntry): 0 | 1 | 2 {
  if (e.kind === 'color' || e.kind === 'stop-color' || e.kind === 'stop-pos') return 2
  if (e.scope === 'post') return 1
  if (e.scope !== 'layer') return 0
  const g = e.def?.group ?? 'params'
  if (g === 'params' || g === 'height' || g === 'roughness' || g === 'specular') return 0
  if (g === 'shaping' && !e.key.startsWith('sh_')) return 0 // bevel, profile, offset, warp; sh_* shape the value
  return 1
}

/** Selection weight per tier while form only (stage 0), form + tone (1), everything (2) is open. */
const TIER_WEIGHTS = [
  [1, 0.2, 0.03],
  [1, 1, 0.25],
  [1, 1, 1],
]

/**
 * Pattern copies that drifted apart: layers of one type and seed (copies of one pattern doing different jobs —
 * pillow, edges, heights, colour) whose pattern params differ. Returns the differing keys per group; locked and
 * disabled layers are left out. Copies can drift a long way (a tuning run moves each one), so any difference counts.
 */
export function driftedCopies(p: Project): { ids: string[]; keys: string[] }[] {
  const groups = new Map<string, Layer[]>()
  for (const l of p.layers) {
    if (!l.enabled || l.locked || l.params.seed === undefined) continue
    const k = `${l.type}\u0000${String(l.params.seed)}`
    groups.set(k, [...(groups.get(k) ?? []), l])
  }
  const out: { ids: string[]; keys: string[] }[] = []
  for (const ls of groups.values()) {
    if (ls.length < 2) continue
    const keys = [...patternKeys(ls[0].type)].filter((k) => k !== 'seed' && ls.every((l) => l.params[k] !== undefined))
    const differ = keys.filter((k) => ls.some((l) => JSON.stringify(l.params[k]) !== JSON.stringify(ls[0].params[k])))
    if (differ.length) out.push({ ids: ls.map((l) => l.id), keys: differ })
  }
  return out
}

// ------------------------------------------------------------------------------------------------ structure

export interface LayerTemplate {
  type: string
  name: string
  params: ParamValues
  /** 'relief' snippets (shape only) go under the first colour layer; paint ones (the default) above it. */
  stack?: 'relief' | 'paint'
}

/**
 * Blend modes a structural mutation may switch a layer's diffuse to: paint and the tonal modulations. Add, subtract,
 * darken and lighten could win a few pixels, but turn a layer's colour into something nobody would author.
 */
const TONAL_BLENDS = new Set(['normal', 'multiply', 'overlay', 'softlight', 'screen'])

/** Evaluations of tuning for each of the two most promising new layers of a stalled structural round. */
const ROUND_TUNING = 16

/**
 * Layer snippets for the "insert layer" structural mutation — ones that kept recurring in hand-authored textures, each
 * tagged relief (shape only, goes under the colour layers) or paint.
 */
export const DEFAULT_LIBRARY: LayerTemplate[] = [
  {
    type: 'noise',
    name: 'Lumps',
    stack: 'relief',
    params: { noise: 'perlin', fractal: 'fbm', scale: 6, octaves: 2, h_on: true, h_amount: 0.25, dif_on: false },
  },
  {
    type: 'noise',
    name: 'Colour grain',
    stack: 'paint',
    params: { noise: 'white', block: 1, h_on: false, dif_on: true, dif_blend: 'overlay', dif_opacity: 0.2, dif_grad: gradient('#000000', '#ffffff') },
  },
  {
    type: 'noise',
    name: 'Mottle',
    stack: 'paint',
    params: { noise: 'perlin', fractal: 'fbm', scale: 4, octaves: 4, h_on: false, dif_on: true, dif_blend: 'multiply', dif_opacity: 0.4, dif_grad: gradient('#9a9a9a', '#ffffff') },
  },
  {
    type: 'cavity',
    name: 'Crevice dirt',
    stack: 'paint',
    params: { radius: 1.5, threshold: 0.05, sensitivity: 0.8, wear_amount: 0, dirt_amount: 0.6, dirt_color: '#140e08', noise_scale: 8 },
  },
  {
    type: 'cavity',
    name: 'Edge wear',
    stack: 'paint',
    params: { radius: 1.5, threshold: 0.05, sensitivity: 1, wear_amount: 0.5, wear_color: '#8a7a6a', dirt_amount: 0, noise_scale: 8 },
  },
  {
    type: 'drips',
    name: 'Water stains',
    stack: 'paint',
    params: { output: 'stain', cols: 12, rows: 6, density: 0.5, len_min: 6, len_max: 30, width: 2.5, width_var: 0.5, start: 0.8, fade: 0.9, hard: false, h_on: false, dif_on: true, dif_blend: 'multiply', dif_grad: gradient('#ffffff', '#5a4a3c') },
  },
  {
    type: 'noise',
    name: 'Moss in hollows',
    stack: 'paint',
    params: { noise: 'perlin', fractal: 'fbm', scale: 10, octaves: 3, sh_cut: 0.7, sh_cut_soft: 0.05, m_hmode: 'below', m_hlevel: 0.3, m_hsoft: 0.15, h_on: false, dif_on: true, dif_opacity: 0.85, dif_grad: gradient('#2e2e06', '#3e3e0c') },
  },
  {
    type: 'voronoi',
    name: 'Chipped edges',
    stack: 'relief',
    params: { output: 'facets', scale: 6, jitter: 1, tilt: 1.4, facet_fit: false, mk_target: '', m_hmode: 'below', m_hlevel: 0.6, m_hsoft: 0.1, h_on: true, h_mode: 'min', h_amount: 1.2, dif_on: false },
  },
]

// ------------------------------------------------------------------------------------------------ stopping

/** When a run stops: whichever criterion is met first. */
export interface StopCriteria {
  /** Steps in this run. */
  steps?: number
  /** Total evaluations of the optimiser (earlier runs included). */
  evaluations?: number
  /** Best loss at or below this: good enough. */
  targetLoss?: number
  /** Wall-clock budget for this run (ms). */
  timeMs?: number
  /** Stalled: this many steps in a row without the best loss improving by `minImprovement` (restarts included). */
  patience?: number
  /** Improvement that counts as progress for `patience` (default 0.001). */
  minImprovement?: number
}

export type StopReason = 'target' | 'steps' | 'evaluations' | 'time' | 'stalled' | 'aborted'

export const STOP_LABELS: Record<StopReason, string> = {
  target: 'reached the target loss',
  steps: 'step budget used',
  evaluations: 'evaluation budget used',
  time: 'time limit',
  stalled: 'stalled (no progress)',
  aborted: 'interrupted',
}

export interface RunOutcome {
  reason: StopReason
  steps: StepInfo[]
  ms: number
}

/** Tracks a run against its StopCriteria (shared by Optimizer.runUntil, the harness CLI and the Match workspace). */
export class RunLimits {
  private readonly t0 = Date.now()
  private steps = 0
  private mark: number
  private since = 0

  constructor(
    readonly stop: StopCriteria,
    bestLoss: number,
  ) {
    this.mark = bestLoss
  }

  elapsed(): number {
    return Date.now() - this.t0
  }

  /** Record a finished step; returns why the run should stop now, or null. */
  after(bestLoss: number, evaluations: number): StopReason | null {
    this.steps++
    if (bestLoss < this.mark - (this.stop.minImprovement ?? 0.001)) {
      this.mark = bestLoss
      this.since = 0
    } else this.since++
    return this.check(bestLoss, evaluations)
  }

  /** Whether a criterion is already met (e.g. before the first step). */
  check(bestLoss: number, evaluations: number): StopReason | null {
    const s = this.stop
    if (s.targetLoss !== undefined && bestLoss <= s.targetLoss) return 'target'
    if (s.steps !== undefined && this.steps >= s.steps) return 'steps'
    if (s.evaluations !== undefined && evaluations >= s.evaluations) return 'evaluations'
    if (s.timeMs !== undefined && this.elapsed() >= s.timeMs) return 'time'
    if (s.patience !== undefined && this.since >= s.patience) return 'stalled'
    return null
  }

  /** Steps since the last real improvement (for `patience`). */
  get stalledSteps(): number {
    return this.since
  }
}

// ------------------------------------------------------------------------------------------------ optimiser

export interface EvalResult {
  loss: number
  /** Anything the caller wants to keep with the best candidate (e.g. the MetricResult breakdown). */
  detail?: unknown
  /** The render the loss was measured on: with `target` set, colour-fit candidates are mapped from it. */
  image?: MatchImage
}

export type Evaluate = (project: Project) => Promise<number | EvalResult> | number | EvalResult

export interface OptimizerOptions {
  /** RNG seed (default 1). */
  seed?: number
  /** Candidates per step (default 6). */
  lambda?: number
  /** Initial normalised step size σ (default 0.1 of each range). */
  sigma?: number
  /** Mean number of entries mutated per candidate (default 2). */
  mutateCount?: number
  /** Relative selection weight of enum / seed entries (default 0.15 — "low probability"). */
  enumWeight?: number
  /** Relative selection weight of dormant entries (effects that are off, e.g. jitter = 0). Default 0.3. */
  dormantWeight?: number
  /** After an improving step, retry the same parameter change once more (default true). */
  momentum?: boolean
  /** Steps without a significant improvement of the parent before restarting around the best (default 20). */
  restartAfter?: number
  /** Loss decrease that counts as progress for restart purposes (default 0.002). */
  minImprovement?: number
  /**
   * Independent chains explored round-robin; every `islandSteps` rounds each, the worse half is dropped
   * (successive halving), so early unlucky basins are abandoned. Default 1 (a single chain); 4 helps
   * on long runs (≳ 250 steps) but slows short ones. `islandSteps` default 12.
   */
  islands?: number
  islandSteps?: number
  /** Enable structural mutations (default false). */
  structural?: boolean
  /** structuralWhen 'always': probability that a candidate is a structural mutation (default 0.1). */
  structuralRate?: number
  /**
   * When structural changes are tried: 'always' — mixed into every step at `structuralRate`; 'stalled' — only when the
   * search has stalled with every tier open, as a round of `structuralRound` changes from the best (the most promising
   * new layers tuned properly) in place of a restart, which follows only when none of them pays. Default 'stalled':
   * mixed in from the start, structure competes with tuning that still pays and rarely wins on merit.
   */
  structuralWhen?: 'always' | 'stalled'
  /** Structural changes tried per stalled round (default 8). */
  structuralRound?: number
  /**
   * Extra evaluations spent tuning a freshly inserted layer (its own params only) before it is judged against the
   * parent (default 3; 0 = judge it as inserted). A new layer at its template values almost never beats a parent
   * whose params have been tuned for many steps, so without this inserts are rejected before they can be tuned.
   */
  incubation?: number
  /**
   * Loss a layer must save to be inserted, and may cost when removed (default 0.003): without it every insert whose
   * tuned version happens to be a hair better is kept, and the stack fills to `maxLayers` with layers that do little.
   */
  layerCost?: number
  /** Layer library for insertions (default DEFAULT_LIBRARY; types that aren't registered are skipped). */
  library?: LayerTemplate[]
  /** Never grow the stack beyond this many layers (default: initial count + 3). */
  maxLayers?: number
  /**
   * Search in order (default true): form first — layout, lighting, height, roughness, specular, shading — then tone
   * (diffuse amounts, value shaping, masks), then colour (colours and ramp stops). The next tier opens when the
   * search stalls (where it would otherwise restart), so colour ramps aren't bent to make up for light and form.
   */
  ordered?: boolean
  /**
   * Probability that a step sweeps one parameter: its λ candidates spread over the parameter's range (or a window
   * around its value), a coarse line search that steps over the local dips small mutations get stuck in. Default 0.2.
   */
  sweepRate?: number
  /**
   * Probability that a step estimates a gradient (default 0.15): a few active numeric parameters (`gradientSize`,
   * default 8) move together by ±½σ (two candidates, SPSA), then two more candidates step along the estimate. It finds
   * the correlated moves single-parameter mutations miss (light elevation against height depth against AO).
   */
  gradientRate?: number
  gradientSize?: number
  /**
   * Probability that a candidate re-aligns drifted pattern copies (see driftedCopies) to one member's pattern;
   * aligned copies are then tuned together. Default 0.05.
   */
  relinkRate?: number
  /**
   * The reference (as compared). With it, and renders returned by `evaluate`, a candidate may refit the parent's
   * colours to the reference's distribution (colourFit.ts: a moments or quantile map at a random strength) — one
   * principled move for every colour instead of many random ramp tweaks.
   */
  target?: MatchImage
  /** Probability that a candidate is a colour fit, when `target` is set (default 0.08). */
  colourFitRate?: number
  /**
   * Keep the layers' and base colours within this OKLab distance of the reference's own colours (colourRange.ts;
   * lightness counts half, greys always pass), when `target` is set. 0 = off (default). Every candidate is pulled into
   * range before it is rendered, so no move can buy pixels with hues the reference doesn't have.
   */
  colourRange?: number
  /**
   * Losses closer than this are equal (default 1e-6). The same project renders a hair differently in different pages
   * (last-bit float differences, ~1e-8), and inert moves tie exactly — compared exactly, a tie would be a win in one
   * page and a loss in another, and identical runs would part ways.
   */
  tolerance?: number
  /**
   * Adapt the move mix (default true): each move kind's rate (sweeps, gradient steps, colour fits, copy alignment) is scaled by its recent gain per evaluation relative to plain mutations — ×0.25 to ×4, once each has
   * enough evaluations; gains decay with a half-life of ~35 steps, since what pays early (colour fits) fades later.
   */
  adaptive?: boolean
  /** What to optimise (see SpaceOptions). */
  space?: SpaceOptions
}

export interface StepInfo {
  /** 1-based step number. */
  step: number
  /** Evaluations so far (including the initial one). */
  evaluations: number
  /** Best loss among this step's candidates. */
  candidateLoss: number
  /** Loss of the current parent after the step. */
  parentLoss: number
  /** Best loss found so far (monotone non-increasing — plot this). */
  bestLoss: number
  /** The global best improved during this step. */
  improved: boolean
  /** The parent was replaced (strictly better or equal). */
  accepted: boolean
  /** The step began with a restart around the best. */
  restarted: boolean
  /** Description of an accepted structural change, if any. */
  structural: string | null
  /** Labels of the entries changed by the accepted candidate. */
  changed: string[]
  /** Mean σ over the space (normalised units). */
  meanSigma: number
  /** Island (chain) this step worked on, and how many are still alive. */
  island: number
  islands: number
  /** Search tiers open (ordered search): 0 form, 1 form + tone, 2 everything. */
  stage: number
  /** The step opened the next tier instead of restarting. */
  opened: boolean
  /** Label of the entry this step swept, if it was a sweep step. */
  sweep: string | null
  /** Kind of move behind each candidate of the step, and of the accepted one (mutate, momentum, sweep, gradient,
   *  colour, align, structural:toggle / blend / insert / duplicate / remove). */
  moves: string[]
  move: string | null
  ms: number
}

interface Island {
  id: number
  parent: Candidate
  /** Best loss this island's parent has reached. */
  best: number
  stagnation: number
  stagRef: number
  /** The last improving change (vector delta over the same space), retried once by momentum. */
  lastDelta: { space: ParamSpace; delta: Float64Array; entries: ParamEntry[] } | null
  /** Steps run since the last cull. */
  rounds: number
}

interface EntryStats {
  sigma: number
  success: number
  fail: number
  neutral: number
}

interface Candidate {
  project: Project
  base: Project
  space: ParamSpace
  vector: Float64Array
  loss: number
  detail?: unknown
  mutated: ParamEntry[]
  structural: string | null
  /** Id of the layer a structural insert added (tuned by incubate() before it is judged). */
  inserted?: string
  /** A structural removal (judged with the layer cost credited). */
  removed?: boolean
  /** Part of a sweep: its value was placed across the range, so it says nothing about the step size. */
  sweep?: boolean
  /** Its render, when the evaluator returns one (for colour fits). */
  image?: MatchImage
  /** Kind of move that made it (see StepInfo.moves). */
  move?: string
  /** Structural moves: which one (toggle, blend, insert, duplicate, remove). */
  kind?: string
  /** Evaluations it took (1, plus any incubation). */
  cost?: number
}

/**
 * Colours of `target` where `render` misses it most (the worst-matched tenth of the pixels), `count` of them, ordered
 * dark to light — what a layer added to supply the missing detail should paint.
 */
export function residualColours(render: MatchImage, target: MatchImage, count: number, rng: Rng): string[] {
  const n = Math.min(render.width * render.height, target.width * target.height)
  const err = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    err[i] = Math.abs(render.data[o] - target.data[o]) + Math.abs(render.data[o + 1] - target.data[o + 1]) + Math.abs(render.data[o + 2] - target.data[o + 2])
  }
  const cut = Float32Array.from(err).sort()[Math.floor(n * 0.9)]
  const worst: number[] = []
  for (let i = 0; i < n; i++) if (err[i] >= cut) worst.push(i)
  const picks = Array.from({ length: count }, () => rng.pick(worst))
  const rgb = picks.map((i) => [target.data[i * 4], target.data[i * 4 + 1], target.data[i * 4 + 2]] as RGB)
  const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  return rgb.sort((a, b) => lum(a) - lum(b)).map((c) => rgbToHex(c.map((v) => Math.min(1, Math.max(0, v))) as RGB))
}

/** A candidate's move as StepInfo reports it (structural ones with their kind, e.g. "structural:insert"). */
function moveName(c: Candidate): string {
  return c.kind ? `${c.move ?? 'structural'}:${c.kind}` : (c.move ?? '?')
}

export interface OptimizerBest {
  project: Project
  loss: number
  detail?: unknown
  /** Step at which it was found (0 = initial project). */
  step: number
}

export class Optimizer {
  readonly opts: Required<Omit<OptimizerOptions, 'space' | 'library' | 'maxLayers' | 'target'>> & {
    space: SpaceOptions
    library: LayerTemplate[]
    maxLayers: number
    target: MatchImage | null
  }
  readonly history: StepInfo[] = []
  evaluations = 0
  initialLoss: number | null = null
  private evaluate: Evaluate
  private range: ColourRange | null = null
  private rng: Rng
  private bestC: Candidate | null = null
  private bestStep = 0
  private stats = new Map<string, EntryStats>()
  private stepCount = 0
  private inserted = new Set<string>()
  /** Moves of this step's structural round (structuralWhen 'stalled'), for StepInfo.moves. */
  private roundMoves: string[] = []
  /** Search tiers open (see OptimizerOptions.ordered). */
  private stage = 0
  /** Decayed gain and evaluations per move kind (adaptive move mix). */
  private moveStats = new Map<string, { gain: number; evals: number }>()
  /** Independent chains (successive halving: the worse half is dropped every `islandSteps` rounds). */
  private islands: Island[]
  /** The island the last / current step works on. */
  private isl: Island

  // The current island's chain state.
  private get parent(): Candidate {
    return this.isl.parent
  }
  private set parent(c: Candidate) {
    this.isl.parent = c
    this.isl.best = Math.min(this.isl.best, c.loss)
  }
  private get stagnation(): number {
    return this.isl.stagnation
  }
  private set stagnation(n: number) {
    this.isl.stagnation = n
  }
  private get stagRef(): number {
    return this.isl.stagRef
  }
  private set stagRef(n: number) {
    this.isl.stagRef = n
  }
  private get lastDelta(): Island['lastDelta'] {
    return this.isl.lastDelta
  }
  private set lastDelta(d: Island['lastDelta']) {
    this.isl.lastDelta = d
  }

  constructor(project: Project, evaluate: Evaluate, opts: OptimizerOptions = {}) {
    ensureBuiltins()
    this.evaluate = evaluate
    this.opts = {
      seed: opts.seed ?? 1,
      lambda: Math.max(1, Math.round(opts.lambda ?? 6)),
      sigma: opts.sigma ?? 0.1,
      mutateCount: Math.max(1, opts.mutateCount ?? 2),
      enumWeight: opts.enumWeight ?? 0.15,
      dormantWeight: opts.dormantWeight ?? 0.3,
      momentum: opts.momentum ?? true,
      restartAfter: opts.restartAfter ?? 20,
      islands: Math.max(1, Math.round(opts.islands ?? 1)),
      islandSteps: Math.max(1, Math.round(opts.islandSteps ?? 12)),
      minImprovement: opts.minImprovement ?? 0.002,
      structural: opts.structural ?? false,
      structuralRate: opts.structuralRate ?? 0.1,
      structuralWhen: opts.structuralWhen ?? 'stalled',
      structuralRound: Math.max(1, Math.round(opts.structuralRound ?? 8)),
      incubation: Math.max(0, Math.round(opts.incubation ?? 3)),
      layerCost: Math.max(0, opts.layerCost ?? 0.003),
      ordered: opts.ordered ?? true,
      sweepRate: opts.sweepRate ?? 0.2,
      relinkRate: opts.relinkRate ?? 0.05,
      gradientRate: opts.gradientRate ?? 0.15,
      gradientSize: Math.max(2, Math.round(opts.gradientSize ?? 8)),
      target: opts.target ?? null,
      colourFitRate: opts.colourFitRate ?? 0.08,
      colourRange: Math.max(0, opts.colourRange ?? 0),
      adaptive: opts.adaptive ?? true,
      tolerance: Math.max(0, opts.tolerance ?? 1e-6),
      space: opts.space ?? {},
      library: opts.library ?? DEFAULT_LIBRARY,
      maxLayers: opts.maxLayers ?? project.layers.length + 3,
    }
    this.rng = new Rng(this.opts.seed)
    if (this.opts.target && this.opts.colourRange > 0) this.range = colourRange(this.opts.target, this.opts.colourRange)
    const base: Project = JSON.parse(JSON.stringify(project))
    const space = extractParams(base, this.opts.space)
    const start: Candidate = { project: base, base, space, vector: Float64Array.from(space.initial), loss: Infinity, mutated: [], structural: null }
    this.islands = Array.from({ length: this.opts.islands }, (_, id) => ({
      id,
      parent: start,
      best: Infinity,
      stagnation: 0,
      stagRef: Infinity,
      lastDelta: null,
      rounds: 0,
    }))
    this.isl = this.islands[0]
    if (space.entries.length === 0 && !this.opts.structural) {
      throw new Error('Nothing to optimise: every layer is locked or disabled (or no entries match the options)')
    }
  }

  /** The parameter space of the current parent. */
  get space(): ParamSpace {
    return this.parent.space
  }

  /** Best project found so far (the initial project until something beats it). A copy — safe to keep / edit. */
  get best(): OptimizerBest {
    const c = this.bestC ?? this.parent
    return { project: JSON.parse(JSON.stringify(c.project)), loss: c.loss, detail: c.detail, step: this.bestStep }
  }

  /** Current parent of the active island (differs from best after a restart). A copy. */
  get current(): { project: Project; loss: number } {
    return { project: JSON.parse(JSON.stringify(this.parent.project)), loss: this.parent.loss }
  }

  /** Best loss per step, for plotting. */
  get lossCurve(): number[] {
    return this.history.map((h) => h.bestLoss)
  }

  /** Per-entry state for display: label, σ, success counts and current value. */
  entryStates(): { id: string; label: string; sigma: number; success: number; fail: number; neutral: number; value: unknown }[] {
    return this.parent.space.entries.map((e) => {
      const s = this.stat(e)
      return { id: e.id, label: e.label, sigma: s.sigma, success: s.success, fail: s.fail, neutral: s.neutral, value: entryValue(e, this.parent.vector) }
    })
  }

  /** Evaluate the starting project (called automatically by the first step()). */
  async init(): Promise<number> {
    if (this.initialLoss !== null) return this.initialLoss
    const start = this.islands[0].parent
    await this.score(start)
    for (const isl of this.islands) isl.best = start.loss
    this.initialLoss = start.loss
    this.bestC = start
    return start.loss
  }

  /** Run one generation: λ candidates from the parent, keep the best if it is no worse. */
  async step(): Promise<StepInfo> {
    const t0 = performance.now()
    await this.init()
    this.stepCount++
    this.nextIsland()
    let restarted = false
    let opened = false
    let reshaped: Candidate | null = null
    const bestBefore = this.bestC?.loss ?? Infinity
    this.roundMoves = []
    if (this.stagnation >= this.opts.restartAfter) {
      if (this.opts.ordered && this.stage < 2) {
        // Stalled on the open tiers: open the next one rather than restarting.
        this.stage++
        this.stagnation = 0
        opened = true
      } else if (this.opts.structural && this.opts.structuralWhen === 'stalled' && (reshaped = await this.structuralRound())) {
        // Tuning had nothing left: a change of structure gives it something new.
      } else {
        await this.restart()
        restarted = true
      }
    }
    const parent = this.parent
    const candidates: Candidate[] = []
    const momentum = this.opts.momentum ? this.momentumCandidate(parent) : null
    this.lastDelta = null
    const sweep = this.rng.next() < this.rate('sweep', this.opts.sweepRate) ? this.sweepCandidates(parent) : null
    const gradient = !sweep && this.rng.next() < this.rate('gradient', this.opts.gradientRate) ? await this.gradientCandidates(parent) : null
    if (sweep) {
      for (const c of sweep) {
        await this.score(c)
        candidates.push(c)
      }
    } else if (gradient) {
      candidates.push(...gradient)
    } else {
      for (let i = 0; i < this.opts.lambda; i++) {
        let c: Candidate | null = null
        if (i === 0 && momentum) c = momentum
        else if (this.opts.structural && this.opts.structuralWhen === 'always' && this.rng.next() < this.rate('structural', this.opts.structuralRate))
          c = this.structuralCandidate(parent)
        else if (this.rng.next() < this.rate('align', this.opts.relinkRate)) c = this.relinkCandidate(parent)
        else if (this.opts.target && this.rng.next() < this.rate('colour', this.opts.colourFitRate)) c = this.colourFitCandidate(parent)
        c ??= this.mutateCandidate(parent)
        if (!c) continue
        await this.score(c)
        if (c.inserted) c = await this.incubate(c, [c.inserted], this.opts.incubation, 0.25)
        candidates.push(c)
      }
    }

    // Move-mix credit: gain beyond the tolerance per evaluation, decayed per step.
    for (const s of this.moveStats.values()) {
      s.gain *= 0.98
      s.evals *= 0.98
    }
    for (const c of candidates) this.credit(c, parent.loss)

    // Step-size / selection-weight adaptation.
    for (const c of candidates) {
      for (const e of c.mutated) {
        const s = this.stat(e)
        const k = c.sweep ? 1 : 0 // sweeps place values across the range: count them, but leave σ alone
        const vs = this.cmp(c.loss, parent.loss)
        if (vs < 0) {
          s.success++
          s.sigma = Math.min(0.5, s.sigma * (k ? 1 : 1.5))
        } else if (vs === 0) {
          // Inert (hidden, quantised or position-only under a texture metric): try bigger steps, pick less.
          s.neutral++
          s.sigma = Math.min(0.5, s.sigma * (k ? 1 : 1.25))
        } else {
          s.fail++
          s.sigma = Math.max(0.004, s.sigma * (k ? 1 : 0.9))
        }
      }
    }

    // Selection: inserts pay the layer cost, removals are credited it (the reported losses stay as measured).
    const judged = (c: Candidate) => this.judged(c)
    let winner: Candidate | null = null
    // Ties (within the tolerance) go to the earlier candidate, so the choice doesn't hinge on float noise.
    for (const c of candidates) if (!winner || this.cmp(judged(c), judged(winner)) < 0) winner = c
    const accepted = !!winner && this.cmp(judged(winner), parent.loss) <= 0
    let improved = false
    if (winner && accepted) {
      if (this.cmp(winner.loss, parent.loss) < 0) {
        if (!winner.structural && winner.space === parent.space) {
          const delta = new Float64Array(winner.vector.length)
          for (let i = 0; i < delta.length; i++) delta[i] = winner.vector[i] - parent.vector[i]
          this.lastDelta = { space: winner.space, delta, entries: winner.mutated }
        }
      }
      this.parent = winner
      if (this.cmp(winner.loss, this.bestC?.loss ?? Infinity) < 0) {
        this.bestC = winner
        this.bestStep = this.stepCount
        improved = true
      }
    }
    // Stagnation = steps without a significant improvement of the parent (tiny gains from barely-relevant
    // params would otherwise postpone restarts forever).
    if (this.parent.loss < this.stagRef - this.opts.minImprovement || (accepted && winner!.structural)) {
      this.stagRef = this.parent.loss
      this.stagnation = 0
    } else this.stagnation++

    const info: StepInfo = {
      step: this.stepCount,
      evaluations: this.evaluations,
      candidateLoss: winner?.loss ?? Infinity,
      parentLoss: this.parent.loss,
      bestLoss: this.best.loss,
      improved: improved || this.cmp(this.best.loss, bestBefore) < 0,
      accepted,
      restarted,
      structural: reshaped?.structural ?? (accepted ? (winner!.structural ?? null) : null),
      changed: [
        ...(reshaped?.structural ? [reshaped.structural] : []),
        ...(accepted ? (winner!.structural ? [winner!.structural] : winner!.mutated.map((e) => e.label)) : []),
      ],
      meanSigma: this.meanSigma(),
      island: this.isl.id,
      islands: this.islands.length,
      stage: this.opts.ordered ? this.stage : 2,
      opened,
      sweep: sweep?.[0]?.mutated[0]?.label ?? null,
      moves: [...this.roundMoves, ...candidates.map(moveName)],
      move: reshaped ? moveName(reshaped) : accepted ? moveName(winner!) : null,
      ms: performance.now() - t0,
    }
    this.history.push(info)
    return info
  }

  /** Round-robin over the live islands; cull the worse half once each has had `islandSteps` rounds. */
  private nextIsland(): void {
    if (this.islands.length > 1 && this.islands.every((i) => i.rounds >= this.opts.islandSteps)) {
      const keep = Math.ceil(this.islands.length / 2)
      this.islands = [...this.islands].sort((a, b) => a.best - b.best || a.id - b.id).slice(0, keep).sort((a, b) => a.id - b.id)
      for (const i of this.islands) i.rounds = 0
    }
    const idx = this.islands.indexOf(this.isl)
    this.isl = this.islands[(idx + 1) % this.islands.length]
    if (this.stepCount === 1) this.isl = this.islands[0]
    this.isl.rounds++
  }

  /** Run several steps. Stops early when `signal` aborts. */
  async run(steps: number, opts: { onStep?: (info: StepInfo) => void; signal?: AbortSignal } = {}): Promise<StepInfo[]> {
    return (await this.runUntil({ steps }, opts)).steps
  }

  /**
   * Step until a stop criterion is met — a target loss, a time limit, a step / evaluation budget, a stall — or the
   * signal aborts. Set at least one bound: with none the run only ends when aborted.
   */
  async runUntil(stop: StopCriteria, opts: { onStep?: (info: StepInfo) => void; signal?: AbortSignal } = {}): Promise<RunOutcome> {
    await this.init()
    const limits = new RunLimits(stop, this.best.loss)
    const steps: StepInfo[] = []
    let reason = limits.check(this.best.loss, this.evaluations)
    while (!reason) {
      if (opts.signal?.aborted) {
        reason = 'aborted'
        break
      }
      const info = await this.step()
      steps.push(info)
      opts.onStep?.(info)
      reason = limits.after(this.best.loss, this.evaluations)
    }
    return { reason, steps, ms: limits.elapsed() }
  }

  // ---------------------------------------------------------------------------------------------- internals

  /**
   * A move kind's rate: `base`, scaled (adaptive) by its recent gain per evaluation relative to plain mutations,
   * ×0.25…×4 once both have ≥ 20 (decayed) evaluations.
   */
  private rate(move: string, base: number): number {
    if (!this.opts.adaptive || base <= 0) return base
    const k = this.payoff(move)
    return k === null ? base : Math.min(0.9, base * k)
  }

  /** A move's recent gain per evaluation relative to plain mutations, ×0.25…×4 (null until both have 20 evaluations). */
  private payoff(move: string): number | null {
    const s = this.moveStats.get(move)
    const m = this.moveStats.get('mutate')
    if (!s || !m || s.evals < 20 || m.evals < 20) return null
    const mine = s.gain / s.evals
    const ref = m.gain / m.evals
    const k = ref > 0 ? mine / ref : mine > 0 ? 4 : 0.25
    return Math.min(4, Math.max(0.25, k))
  }

  /** -1 when loss `a` beats `b` by more than the tolerance, 1 when it loses by more, 0 for a tie. */
  private cmp(a: number, b: number): -1 | 0 | 1 {
    const t = this.opts.tolerance
    return a < b - t ? -1 : a > b + t ? 1 : 0
  }

  private stat(e: ParamEntry): EntryStats {
    let s = this.stats.get(e.id)
    if (!s) {
      s = { sigma: this.opts.sigma, success: 0, fail: 0, neutral: 0 }
      this.stats.set(e.id, s)
    }
    return s
  }

  private meanSigma(): number {
    const es = this.parent.space.entries.filter((e) => e.kind !== 'enum' && e.kind !== 'seed')
    if (!es.length) return 0
    return es.reduce((s, e) => s + this.stat(e).sigma, 0) / es.length
  }

  /** A candidate project from a vector. */
  private build(base: Project, space: ParamSpace, vector: Float64Array): Project {
    return applyParams(base, space, vector)
  }

  /** Pull the candidate's layer and base colours into the colour range (vector and project), if one is set. */
  private constrain(c: Candidate): void {
    if (!this.range) return
    let changed = false
    for (const e of c.space.entries) {
      if ((e.kind !== 'color' && e.kind !== 'stop-color') || (e.scope !== 'layer' && e.scope !== 'base')) continue
      // Colours of switched-off outputs (an emissive colour with Emissive off) don't render: leave them be.
      if (!isEntryActive(c.project, e)) continue
      const o = e.offset
      const v = c.vector
      const lab: RGB = [v[o], v[o + 1] * 2 * AB - AB, v[o + 2] * 2 * AB - AB]
      const q = constrainLab(lab, this.range)
      if (q === lab) continue
      v[o] = q[0]
      v[o + 1] = (q[1] + AB) / (2 * AB)
      v[o + 2] = (q[2] + AB) / (2 * AB)
      changed = true
    }
    if (changed) c.project = this.build(c.base, c.space, c.vector)
  }

  private async score(c: Candidate): Promise<void> {
    this.evaluations++
    this.constrain(c)
    try {
      const r = await this.evaluate(c.project)
      if (typeof r === 'number') c.loss = r
      else {
        c.loss = r.loss
        c.detail = r.detail
        c.image = r.image
      }
      if (!Number.isFinite(c.loss)) c.loss = Infinity
    } catch (err) {
      console.warn('[optimizer] evaluation failed', err)
      c.loss = Infinity
    }
  }

  private weight(e: ParamEntry): number {
    const s = this.stat(e)
    let w = (1 + s.success) / (1 + 0.15 * s.fail + 0.5 * s.neutral)
    if (e.kind === 'enum' || e.kind === 'seed') w *= this.opts.enumWeight
    else if (e.dormant && s.success === 0) w *= this.opts.dormantWeight
    w = Math.max(0.02, w)
    return this.opts.ordered ? w * TIER_WEIGHTS[this.stage][entryTier(e)] : w
  }

  /** Pick k distinct active entries (passing `only`), weighted. */
  private pickEntries(parent: Candidate, k: number, only?: (e: ParamEntry) => boolean): ParamEntry[] {
    const pool = parent.space.entries.filter((e) => isEntryActive(parent.project, e) && (!only || only(e)))
    const chosen: ParamEntry[] = []
    const weights = pool.map((e) => this.weight(e))
    for (let n = 0; n < k && pool.length; n++) {
      const total = weights.reduce((a, b) => a + b, 0)
      let r = this.rng.next() * total
      let i = 0
      while (i < pool.length - 1 && r >= weights[i]) r -= weights[i++]
      chosen.push(pool[i])
      pool.splice(i, 1)
      weights.splice(i, 1)
    }
    return chosen
  }

  private mutateEntry(v: Float64Array, e: ParamEntry, sigma: number): void {
    const o = e.offset
    switch (e.kind) {
      case 'number':
      case 'stop-pos': {
        const before = e.kind === 'number' ? entryValue(e, v) : null
        let x = v[o] + sigma * this.rng.normal()
        if (e.wrap) x = ((x % 1) + 1) % 1
        else x = reflect01(x)
        v[o] = x
        if (e.int && entryValue(e, v) === before) {
          // Integers: guarantee a change of at least one unit.
          const cur = Number(before)
          const target = cur + (this.rng.next() < 0.5 ? -1 : 1)
          const clamped = Math.min(e.def?.max ?? Infinity, Math.max(e.def?.min ?? -Infinity, target))
          v[o] = reflect01(numToX(e, clamped === cur ? cur - (target - cur) : clamped))
        }
        break
      }
      case 'color':
      case 'stop-color':
        for (let d = 0; d < 3; d++) v[o + d] += sigma * this.rng.normal() * (d === 0 ? 1 : 0.7)
        clipColorInPlace(v, o)
        break
      case 'enum': {
        const n = e.options!.length
        const cur = Math.round(v[o])
        v[o] = (cur + 1 + this.rng.int(n - 1)) % n
        break
      }
      case 'seed':
        v[o] = 1 + this.rng.int(99998)
        break
    }
  }

  private mutateCandidate(parent: Candidate): Candidate | null {
    // k ≥ 1, geometric with mean mutateCount.
    let k = 1
    const p = 1 / this.opts.mutateCount
    while (this.rng.next() > p && k < 8) k++
    const picked = this.pickEntries(parent, k)
    if (!picked.length) return null
    const vector = Float64Array.from(parent.vector)
    for (const e of picked) this.mutateEntry(vector, e, this.stat(e).sigma)
    return {
      project: this.build(parent.base, parent.space, vector),
      base: parent.base,
      space: parent.space,
      vector,
      loss: Infinity,
      mutated: picked,
      structural: null,
      move: 'mutate',
    }
  }

  /** Repeat the last improving change (a cheap line-search step along a direction that worked). */
  private momentumCandidate(parent: Candidate): Candidate | null {
    const d = this.lastDelta
    if (!d || d.space !== parent.space) return null
    const vector = Float64Array.from(parent.vector)
    for (const e of d.entries) {
      if (e.kind === 'enum' || e.kind === 'seed') return null
      for (let k = 0; k < e.dims; k++) vector[e.offset + k] += d.delta[e.offset + k]
      if (e.kind === 'color' || e.kind === 'stop-color') clipColorInPlace(vector, e.offset)
      else vector[e.offset] = e.wrap ? ((vector[e.offset] % 1) + 1) % 1 : reflect01(vector[e.offset])
    }
    return {
      project: this.build(parent.base, parent.space, vector),
      base: parent.base,
      space: parent.space,
      vector,
      loss: Infinity,
      mutated: d.entries,
      structural: null,
      move: 'momentum',
    }
  }

  private structuralCandidate(parent: Candidate): Candidate | null {
    const proj: Project = JSON.parse(JSON.stringify(parent.project))
    const all = proj.layers
    const unlocked = all.filter((l) => !l.locked)
    const kinds: string[] = []
    if (unlocked.length) kinds.push('toggle')
    if (unlocked.some((l) => l.enabled && l.params.dif_on === true)) kinds.push('blend')
    const library = this.opts.library.filter((t) => getLayerDef(t.type))
    if (library.length && all.length < this.opts.maxLayers) kinds.push('insert')
    const copyable = unlocked.filter((l) => l.enabled && getLayerDef(l.type)?.kind === 'generator')
    if (all.length < this.opts.maxLayers && copyable.length) kinds.push('duplicate')
    if (all.some((l) => this.inserted.has(l.id))) kinds.push('remove')
    if (!kinds.length) return null
    // Kinds that have paid lately (gain per evaluation, as for the move mix) are picked more often.
    const weights = kinds.map((k) => (this.opts.adaptive ? (this.payoff(`structural:${k}`) ?? 1) : 1))
    let r = this.rng.next() * weights.reduce((a, b) => a + b, 0)
    let pick = 0
    while (pick < kinds.length - 1 && r >= weights[pick]) r -= weights[pick++]
    const kind = kinds[pick]
    let desc = ''
    let inserted: string | undefined
    let removed = false
    if (kind === 'toggle') {
      const enabledCount = all.filter((l) => l.enabled).length
      const choices = unlocked.filter((l) => !l.enabled || enabledCount > 1)
      if (!choices.length) return null
      const l = this.rng.pick(choices)
      l.enabled = !l.enabled
      desc = `${l.enabled ? 'enable' : 'disable'} layer "${l.name}"`
    } else if (kind === 'blend') {
      const l = this.rng.pick(unlocked.filter((x) => x.enabled && x.params.dif_on === true))
      const def = layerParamDefs(l.type).find((d) => d.key === 'dif_blend')
      const opts = (def?.options ?? []).map((o) => o.value).filter((v) => v !== l.params.dif_blend && TONAL_BLENDS.has(String(v)))
      if (!opts.length) return null
      l.params.dif_blend = this.rng.pick(opts)
      desc = `blend of "${l.name}" → ${l.params.dif_blend}`
    } else if (kind === 'insert') {
      const t = this.rng.pick(library)
      const layer: Layer = createLayer(t.type, { ...JSON.parse(JSON.stringify(t.params)), seed: 1 + this.rng.int(99998) }, t.name)
      // Relief snippets (shape only) go under the first layer that paints; the rest above it.
      const list = proj.layers
      const first = list.findIndex((l) => l.params.dif_on === true)
      const split = first < 0 ? list.length : first
      const at = t.stack === 'relief' ? this.rng.int(split + 1) : split + 1 + this.rng.int(Math.max(1, list.length - split))
      list.splice(Math.min(at, list.length), 0, layer)
      desc = `insert "${t.name}" (${t.type}) as ${t.stack ?? 'paint'} at ${at}`
      // A paint snippet takes its colours from where the render misses the reference most.
      if (this.opts.target && parent.image && t.stack !== 'relief' && this.paintFromResidual(layer, parent.image, this.opts.target)) desc += ', residual colours'
      this.inserted.add(layer.id)
      inserted = layer.id
    } else if (kind === 'duplicate') {
      // Another instance of a layer the project already has (new seed), right above it — or above its smart
      // material, whose members stay together.
      const src = this.rng.pick(copyable)
      const params: ParamValues = JSON.parse(JSON.stringify(src.params))
      if (typeof params.seed === 'number') params.seed = 1 + this.rng.int(99998)
      // Half the time an octave apart (detail over detail, or a coarser pass of it).
      const octave = typeof params.scale === 'number' && this.rng.next() < 0.5 ? (this.rng.next() < 0.5 ? 2 : 0.5) : 1
      if (octave !== 1) {
        const def = layerParamDefs(src.type).find((d) => d.key === 'scale')
        params.scale = Math.min(def?.max ?? Infinity, Math.max(def?.min ?? 0, Number(params.scale) * octave))
      }
      const layer: Layer = { ...createLayer(src.type, params, `${src.name} (copy)`), params }
      const block = (proj.materials ?? []).find((m) => Object.values(m.members).includes(src.id))
      const members = new Set(block ? Object.values(block.members) : [src.id])
      let at = 0
      proj.layers.forEach((l, i) => {
        if (members.has(l.id)) at = i + 1
      })
      proj.layers.splice(at, 0, layer)
      desc = `duplicate "${src.name}"${octave !== 1 ? ` at scale ×${octave}` : ''}`
      this.inserted.add(layer.id)
      inserted = layer.id
    } else {
      const l = this.rng.pick(all.filter((x) => this.inserted.has(x.id)))
      proj.layers = proj.layers.filter((x) => x !== l)
      desc = `remove "${l.name}"`
      removed = true
    }
    const space = extractParams(proj, this.opts.space)
    return { project: proj, base: proj, space, vector: Float64Array.from(space.initial), loss: Infinity, mutated: [], structural: desc, inserted, removed, move: 'structural', kind }
  }

  /** Set a new layer's colour params and its paint ramp (normal blend) to residual colours; false when it has none. */
  private paintFromResidual(layer: Layer, render: MatchImage, target: MatchImage): boolean {
    let changed = false
    for (const d of layerParamDefs(layer.type)) {
      const v = layer.params[d.key]
      if (d.type === 'color' && typeof v === 'string') {
        layer.params[d.key] = residualColours(render, target, 1, this.rng)[0]
        changed = true
      } else if (d.key === 'dif_grad' && (layer.params.dif_blend ?? 'normal') === 'normal' && v && typeof v === 'object') {
        const g = v as Gradient
        const cs = residualColours(render, target, g.stops.length, this.rng)
        g.stops.forEach((st, i) => (st.color = cs[i]))
        changed = true
      }
    }
    return changed
  }

  /**
   * Tune a fresh change for a few evaluations — only the numbers of the layers it concerns (`owners`), at step size
   * `sigma` — and return the best version (the change itself when nothing beats it). An inserted layer is then judged
   * by what it can do rather than by its template values.
   */
  private async incubate(c: Candidate, owners: string[], rounds: number, sigma: number): Promise<Candidate> {
    const own = c.space.entries.filter((e) => owners.includes(e.owner) && e.kind === 'number' && isEntryActive(c.project, e))
    let best = c
    let cost = 1
    for (let n = 0; n < rounds && own.length; n++) {
      const vector = Float64Array.from(best.vector)
      const k = Math.min(own.length, 1 + this.rng.int(2))
      const pool = [...own]
      for (let j = 0; j < k; j++) this.mutateEntry(vector, pool.splice(this.rng.int(pool.length), 1)[0], sigma)
      const v: Candidate = { ...c, project: this.build(c.base, c.space, vector), vector, loss: Infinity }
      await this.score(v)
      cost++
      if (this.cmp(v.loss, best.loss) < 0) best = v
    }
    return { ...best, cost }
  }

  /**
   * (1+1)-ES on the numbers and colours of the layers `owners` (a new layer) for `rounds` evaluations, the step size
   * ×1.5 after a win and ×0.85 otherwise.
   */
  private async tune(c: Candidate, owners: string[], rounds: number): Promise<Candidate> {
    const own = c.space.entries.filter((e) => owners.includes(e.owner) && (e.kind === 'number' || e.kind === 'color' || e.kind === 'stop-color') && isEntryActive(c.project, e))
    let best = c
    let sigma = 0.2
    let cost = c.cost ?? 1
    for (let n = 0; n < rounds && own.length; n++) {
      const vector = Float64Array.from(best.vector)
      const pool = [...own]
      for (let j = Math.min(own.length, 1 + this.rng.int(3)); j > 0; j--) this.mutateEntry(vector, pool.splice(this.rng.int(pool.length), 1)[0], sigma)
      const v: Candidate = { ...c, project: this.build(c.base, c.space, vector), vector, loss: Infinity }
      await this.score(v)
      cost++
      if (this.cmp(v.loss, best.loss) < 0) {
        best = v
        sigma = Math.min(0.5, sigma * 1.5)
      } else sigma = Math.max(0.02, sigma * 0.85)
    }
    return { ...best, cost }
  }

  /**
   * One parameter at λ values spread over its range — or, half the time, over a window around its value — the rest
   * unchanged: a coarse line search. Integers with few values try each other value; enums try other options; seeds
   * try λ new seeds (for a pattern, λ layouts).
   */
  private sweepCandidates(parent: Candidate): Candidate[] | null {
    const [e] = this.pickEntries(parent, 1, (x) => x.kind !== 'color' && x.kind !== 'stop-color')
    if (!e) return null
    const n = this.opts.lambda
    const o = e.offset
    const cur = parent.vector[o]
    let xs: number[]
    if (e.kind === 'enum') {
      const others = e.options!.map((_, i) => i).filter((i) => i !== Math.round(cur))
      xs = []
      while (others.length && xs.length < n) xs.push(others.splice(this.rng.int(others.length), 1)[0])
    } else if (e.kind === 'seed') {
      xs = Array.from({ length: n }, () => 1 + this.rng.int(99998))
    } else {
      const local = this.rng.next() < 0.5
      const lo = local ? Math.max(0, cur - 0.15) : 0
      const hi = local ? Math.min(1, cur + 0.15) : 1
      xs = Array.from({ length: n }, (_, i) => lo + ((i + this.rng.next()) / n) * (hi - lo))
      if (e.int) {
        // Distinct integer values other than the current one.
        const seen = new Set([entryValue(e, parent.vector)])
        const vals: number[] = []
        const v = Float64Array.from(parent.vector)
        for (const x of xs) {
          v[o] = x
          const iv = entryValue(e, v)
          if (seen.has(iv)) continue
          seen.add(iv)
          vals.push(x)
        }
        xs = vals
      }
    }
    if (!xs.length) return null
    return xs.map((x) => {
      const vector = Float64Array.from(parent.vector)
      vector[o] = x
      return { project: this.build(parent.base, parent.space, vector), base: parent.base, space: parent.space, vector, loss: Infinity, mutated: [e], structural: null, sweep: true, move: 'sweep' }
    })
  }

  /**
   * SPSA: perturb k active numeric entries together by ±½σᵢ (random signs), score both, estimate the gradient, then
   * step along it by one and two σ-scaled units. Returns the four scored candidates (null when < 2 entries apply).
   */
  private async gradientCandidates(parent: Candidate): Promise<Candidate[] | null> {
    const es = this.pickEntries(parent, this.opts.gradientSize, (e) => e.kind === 'number' || e.kind === 'stop-pos').filter((e) => !e.int)
    if (es.length < 2) return null
    const signs = es.map(() => (this.rng.next() < 0.5 ? -1 : 1))
    const make = (f: (e: ParamEntry, i: number) => number): Candidate => {
      const vector = Float64Array.from(parent.vector)
      es.forEach((e, i) => {
        const x = vector[e.offset] + f(e, i)
        vector[e.offset] = e.wrap ? ((x % 1) + 1) % 1 : reflect01(x)
      })
      return { project: this.build(parent.base, parent.space, vector), base: parent.base, space: parent.space, vector, loss: Infinity, mutated: es, structural: null, sweep: true, move: 'gradient' }
    }
    const h = (e: ParamEntry) => 0.5 * this.stat(e).sigma
    const plus = make((e, i) => signs[i] * h(e))
    const minus = make((e, i) => -signs[i] * h(e))
    await this.score(plus)
    await this.score(minus)
    const out = [plus, minus]
    const d = plus.loss - minus.loss
    // A tie says nothing about the slope (and its sign would be float noise).
    if (Number.isFinite(d) && this.cmp(plus.loss, minus.loss) !== 0) {
      // Step against the estimated slope: per entry −sign(gᵢ)·σᵢ (unit-free, so one loss scale fits every entry).
      for (const k of [1, 2]) {
        const c = make((e, i) => -Math.sign(d) * signs[i] * k * this.stat(e).sigma)
        await this.score(c)
        out.push(c)
      }
    }
    return out
  }

  /**
   * The parent's colours mapped towards the reference's distribution (see OptimizerOptions.target). Every colour at
   * once: mapping one layer's or the lightness only was tried and lost on long runs.
   */
  private colourFitCandidate(parent: Candidate): Candidate | null {
    if (!this.opts.target || !parent.image || this.opts.space.layers === false) return null
    const mode = this.rng.next() < 0.5 ? 'moments' : 'quantile'
    const strength = 0.4 + 0.6 * this.rng.next()
    const proj: Project = JSON.parse(JSON.stringify(parent.project))
    applyColourMap(proj, colourMap(parent.image, this.opts.target, strength, mode))
    const space = extractParams(proj, this.opts.space)
    const desc = `fit colours (${mode}, ${strength.toFixed(2)})`
    return { project: proj, base: proj, space, vector: Float64Array.from(space.initial), loss: Infinity, mutated: [], structural: desc, move: 'colour' }
  }

  /**
   * Re-align a drifted pattern copy (see driftedCopies) to another: all the keys they differ in, or half the time a
   * random half of them. Small moves, so each can be judged; copies converge only as far as the loss wants.
   */
  private relinkCandidate(parent: Candidate): Candidate | null {
    const groups = driftedCopies(parent.project)
    if (!groups.length) return null
    const g = this.rng.pick(groups)
    const proj: Project = JSON.parse(JSON.stringify(parent.project))
    const members = proj.layers.filter((l) => g.ids.includes(l.id))
    const donor = this.rng.pick(members)
    const same = (k: string, l: Layer) => JSON.stringify(l.params[k]) === JSON.stringify(donor.params[k])
    const targets = members.filter((l) => l !== donor && g.keys.some((k) => !same(k, l)))
    if (!targets.length) return null
    const target = this.rng.pick(targets)
    let keys = g.keys.filter((k) => !same(k, target))
    if (keys.length > 1 && this.rng.next() < 0.5) {
      for (let i = keys.length - 1; i > 0; i--) {
        const j = this.rng.int(i + 1)
        ;[keys[i], keys[j]] = [keys[j], keys[i]]
      }
      keys = keys.slice(0, Math.ceil(keys.length / 2))
    }
    for (const k of keys) target.params[k] = JSON.parse(JSON.stringify(donor.params[k]))
    const space = extractParams(proj, this.opts.space)
    const desc = `align ${keys.join(', ')} of "${target.name}" to "${donor.name}"`
    return { project: proj, base: proj, space, vector: Float64Array.from(space.initial), loss: Infinity, mutated: [], structural: desc, move: 'align' }
  }

  /** A candidate's loss for selection: inserts pay the layer cost, removals are credited it. */
  private judged(c: Candidate): number {
    return c.loss + (c.inserted ? this.opts.layerCost : 0) - (c.removed ? this.opts.layerCost : 0)
  }

  /** Move-mix credit: gain over `ref` beyond the tolerance, per evaluation (structural kinds also on their own). */
  private credit(c: Candidate, ref: number): void {
    const m = (c.move ?? 'mutate') === 'momentum' ? 'mutate' : (c.move ?? 'mutate')
    const gain = this.cmp(c.loss, ref) < 0 ? ref - c.loss : 0
    for (const key of c.kind ? [m, `${m}:${c.kind}`] : [m]) {
      const s = this.moveStats.get(key) ?? { gain: 0, evals: 0 }
      s.gain += gain
      s.evals += c.cost ?? 1
      this.moveStats.set(key, s)
    }
  }

  /**
   * structuralWhen 'stalled': `structuralRound` structural changes of the best (inserts incubated as usual, the two most
   * promising then tuned for ROUND_TUNING evaluations); the best one becomes the parent when it beats the best (layer
   * cost included). Null when none does.
   */
  private async structuralRound(): Promise<Candidate | null> {
    const best = this.bestC ?? this.parent
    const tried: Candidate[] = []
    for (let i = 0; i < this.opts.structuralRound; i++) {
      let c = this.structuralCandidate(best)
      if (!c) continue
      await this.score(c)
      if (c.inserted) c = await this.incubate(c, [c.inserted], this.opts.incubation, 0.25)
      tried.push(c)
    }
    // The two most promising new layers get a proper tuning before the round is judged: a missing detail needs its
    // threshold, scale, opacity and colours right together, which a few random nudges don't find.
    const fresh = tried.filter((c) => c.inserted).sort((a, b) => this.judged(a) - this.judged(b)).slice(0, 2)
    for (const c of fresh) tried[tried.indexOf(c)] = await this.tune(c, [c.inserted!], ROUND_TUNING)
    let winner: Candidate | null = null
    for (const c of tried) {
      this.credit(c, best.loss)
      this.roundMoves.push(moveName(c))
      if (!winner || this.cmp(this.judged(c), this.judged(winner)) < 0) winner = c
    }
    if (!winner || this.cmp(this.judged(winner), best.loss) >= 0) return null
    this.parent = winner
    if (this.cmp(winner.loss, best.loss) < 0) {
      this.bestC = winner
      this.bestStep = this.stepCount
    }
    this.stagnation = 0
    this.stagRef = winner.loss
    return winner
  }

  private async restart(): Promise<void> {
    const best = this.bestC ?? this.parent
    for (const s of this.stats.values()) {
      s.sigma = this.opts.sigma
      s.fail = Math.floor(s.fail / 2)
      s.neutral = Math.floor(s.neutral / 2)
    }
    // Perturb a few entries of the best with the initial step size and continue from there.
    const vector = Float64Array.from(best.vector)
    const picked = this.pickEntries(best, Math.min(best.space.entries.length, this.opts.mutateCount * 3))
    for (const e of picked) this.mutateEntry(vector, e, this.opts.sigma * 2)
    const c: Candidate = {
      project: this.build(best.base, best.space, vector),
      base: best.base,
      space: best.space,
      vector,
      loss: Infinity,
      mutated: picked,
      structural: null,
    }
    await this.score(c)
    this.parent = c
    if (this.cmp(c.loss, best.loss) < 0) {
      this.bestC = c
      this.bestStep = this.stepCount
    }
    this.stagnation = 0
    this.stagRef = c.loss
  }
}

function reflect01(x: number): number {
  if (x < 0) x = -x
  if (x > 1) x = 2 - x
  return Math.min(1, Math.max(0, x))
}
