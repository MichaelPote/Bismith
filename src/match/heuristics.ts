// Craft heuristics for the reference-matching optimiser (docs/features/fr7.8-optimizer-heuristics.md).
//
// Lessons from hand-authoring reference textures (FR7.4–7.7), each with the reason it exists, applied three ways:
//   • conformProject(): deterministic repairs — the start project and every candidate are conformed, so the search
//     never wanders back into looks that were judged wrong (deep cliffs, pixel sparkle, tented blocks …);
//   • craftPrior(): search-space priors — params that mislead are excluded, others get sensible ranges;
//   • CRAFT_LIBRARY: layer snippets for structural "insert" mutations, each tagged relief (shape only, goes under the
//     colour layers) or paint.

import { gradient, type ParamDef, type ParamValues } from '@/core/params'
import type { Layer, LayerStack, Project } from '@/core/project'
import { DEFAULT_BEVEL_CURVE } from '@/layers/commonParams'
import type { ParamScope } from './optimizer'

export interface CraftRule {
  id: string
  label: string
  /** What was learned, in a sentence. */
  why: string
  /** Mutates the project in place; returns a description per change. */
  apply(p: Project): string[]
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Smallest feature size (px) a noise layer produces at its base octave (white noise: the block size). */
export function noiseFeaturePx(l: Layer, p: Pick<Project, 'width' | 'height'>): number {
  const q = l.params
  if (q.noise === 'white') return num(q.block, 1)
  const scale = Math.max(num(q.scale, 6), 1e-3)
  const stretch = Math.max(num(q.stretch, 1), 1e-3)
  return Math.min((p.width * stretch) / scale, p.width / scale)
}

/** Pixel-scale noise: lit as height it turns into single-pixel sparkle. */
export const isPixelNoise = (l: Layer, p: Pick<Project, 'width' | 'height'>) => l.type === 'noise' && noiseFeaturePx(l, p) < 2

/** Half the size of a pattern's features (px), for shape generators whose bevel can tent. */
export function featureHalfPx(l: Layer, p: Pick<Project, 'width' | 'height'>): number | null {
  const q = l.params
  if (l.type === 'bricks') return Math.min(p.width / Math.max(1, num(q.columns, 4)), p.height / Math.max(1, num(q.rows, 8))) / 2
  if (l.type === 'voronoi' && (q.output ?? 'cells') === 'cells') return p.width / Math.max(0.25, num(q.scale, 6)) / 2
  if (l.type === 'hex') return p.width / Math.max(1, num(q.scale, 6)) / 2
  return null
}

const STEADY_PROFILES = new Set(['linear', 'smooth', 'round'])
/** Layers whose height is real geometry (round pipes): their relief is their shape, not a cliff to cap. */
const TRUE_SCALE = new Set(['pipework'])
const GAME_PALETTES = new Set(['quake', 'doom'])

export const CRAFT_RULES: CraftRule[] = [
  {
    id: 'fine-relief',
    label: 'Fine relief',
    why: 'Bevels and heights read as cliffs beyond ~2–3 px of world height; hand-painted textures carry their form in shading.',
    apply(p) {
      const out: string[] = []
      const d = Math.min(3, Math.max(1.5, p.heightDepth))
      if (d !== p.heightDepth) {
        out.push(`height depth ${p.heightDepth} → ${d}`)
        p.heightDepth = d
      }
      for (const l of p.layers) {
        const h = l.params.h_amount
        if (typeof h === 'number' && Math.abs(h) > 2.5 && !TRUE_SCALE.has(l.type)) {
          l.params.h_amount = Math.sign(h) * 2.5
          out.push(`${l.name}: height amount capped at 2.5`)
        }
      }
      return out
    },
  },
  {
    id: 'no-pixel-height',
    label: 'No pixel-scale relief',
    why: 'Pixel-scale noise in the height map, lit by a low key light, becomes hard single bright pixels; keep pixel texture in colour.',
    apply(p) {
      const out: string[] = []
      for (const l of p.layers) {
        if (!isPixelNoise(l, p)) continue
        if (l.params.h_on === true && num(l.params.h_amount, 0.25) > 0.05) {
          l.params.h_amount = 0.05
          out.push(`${l.name}: pixel-scale height capped`)
        }
        if (l.params.s_on === true) {
          l.params.s_on = false
          out.push(`${l.name}: pixel-scale specular off (glints should be smooth)`)
        }
      }
      return out
    },
  },
  {
    id: 'domain-warp',
    label: 'Warp after generation',
    why: "Per-brick wobble makes joints wide in places and narrow in others; warping the whole pattern keeps joint width while edges wander.",
    apply(p) {
      const out: string[] = []
      for (const l of p.layers) {
        if (l.type !== 'bricks' || num(l.params.wobble) <= 0) continue
        const w = num(l.params.wobble)
        l.params.dw_amount = Math.max(num(l.params.dw_amount), w * 0.75)
        if (num(l.params.dw_scale) <= 0) l.params.dw_scale = 6
        l.params.wobble = 0
        out.push(`${l.name}: wobble ${w} → domain warp ${l.params.dw_amount}`)
      }
      return out
    },
  },
  {
    id: 'no-tent',
    label: 'Crisp edge, slow rise',
    why: 'A wide steady bevel peaks along the middle of each block (a tent); stone reads as a steep edge then a slow rise — a custom curve.',
    apply(p) {
      const out: string[] = []
      for (const l of p.layers) {
        const half = featureHalfPx(l, p)
        if (half === null || !STEADY_PROFILES.has(String(l.params.profile))) continue
        if (num(l.params.bevel) < 0.5 * half) continue
        const was = String(l.params.profile)
        l.params.profile = 'custom'
        l.params.bevel_curve = JSON.parse(JSON.stringify(DEFAULT_BEVEL_CURVE))
        out.push(`${l.name}: wide ${was} bevel → custom curve`)
      }
      return out
    },
  },
  {
    id: 'tinted-glints',
    label: 'Tinted glints',
    why: 'In the references a highlight enriches the surface colour rather than greying it.',
    apply(p) {
      if (num(p.render.specular) > 0 && num(p.render.specularTint) < 0.5) {
        p.render.specularTint = 0.6
        return ['specular tint → 0.6']
      }
      return []
    },
  },
  {
    id: 'ao-for-joints',
    label: 'Occlusion where blocks touch',
    why: 'Stones that touch read as separate through ambient occlusion in the creases, not through wide mortar.',
    apply(p) {
      const tight = p.layers.some(
        (l) =>
          l.enabled &&
          l.params.h_on !== false &&
          ((l.type === 'bricks' && num(l.params.mortar, 2) <= 1) || (l.type === 'voronoi' && (l.params.output ?? 'cells') === 'cells' && num(l.params.gap, 1) <= 1)),
      )
      if (!tight || num(p.render.ao) >= 0.8) return []
      p.render.ao = 0.8
      if (num(p.render.aoRadius) <= 0) p.render.aoRadius = 3
      return ['ambient occlusion → 0.8 (tight joints)']
    },
  },
  {
    id: 'ledge-grid',
    label: 'Fine grid for ledge drips',
    why: 'Relief-driven drips only find every ledge (each rivet bottom) when source cells are a few px across.',
    apply(p) {
      const out: string[] = []
      for (const l of p.layers) {
        if (l.type !== 'drips' || num(l.params.relief) <= 0) continue
        const cols = Math.ceil(p.width / 3)
        const rows = Math.ceil(p.height / 3)
        if (num(l.params.cols) < cols || num(l.params.rows) < rows) {
          l.params.cols = Math.max(num(l.params.cols), cols)
          l.params.rows = Math.max(num(l.params.rows), rows)
          out.push(`${l.name}: source grid → ${l.params.cols}×${l.params.rows}`)
        }
      }
      return out
    },
  },
  {
    id: 'painted-light',
    label: 'Painted light for game palettes',
    why: 'Palettised game textures are hand-painted: lit by surface angle, without cast shadows.',
    apply(p) {
      // Present, enabled or not: emulation switches the palette off while searching.
      const game = p.post.some((f) => f.type === 'palette' && GAME_PALETTES.has(String(f.params.palette)))
      if (!game || p.render.shadows === false) return []
      p.render.shadows = false
      return ['cast shadows off (painted light)']
    },
  },
]

/** Apply the craft rules to a copy of the project. */
export function conformProject(project: Project, rules: string[] | 'all' = 'all'): { project: Project; changes: string[] } {
  const p: Project = JSON.parse(JSON.stringify(project))
  const changes: string[] = []
  for (const r of CRAFT_RULES) if (rules === 'all' || rules.includes(r.id)) changes.push(...r.apply(p).map((c) => `${r.id}: ${c}`))
  return { project: p, changes }
}

// ------------------------------------------------------------------------------------------------ priors

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

/** Search-space priors from the craft rules. */
export function craftPrior(q: PriorQuery): Prior | undefined {
  if (q.scope !== 'layer' || !q.layerType) return undefined
  const layer = { type: q.layerType, params: q.params } as Layer
  const key = q.def.key
  // Superseded by the domain warp.
  if (q.layerType === 'bricks' && key === 'wobble') return { exclude: true }
  // Height and specular of pixel-scale noise are repaired away — don't spend evaluations on them.
  if (isPixelNoise(layer, q.project) && (key === 'h_amount' || key === 's_a' || key === 's_b')) return { exclude: true }
  if (key === 'h_amount') return { lo: -2, hi: 2 }
  if (key === 'bevel' && STEADY_PROFILES.has(String(q.params.profile))) {
    const half = featureHalfPx(layer, q.project)
    if (half !== null) return { hi: 0.45 * half }
  }
  return undefined
}

// ------------------------------------------------------------------------------------------------ library

export interface CraftLayerTemplate {
  type: string
  name: string
  stack: LayerStack
  params: ParamValues
}

/** Layer snippets that kept recurring in the hand-authored recreations. */
export const CRAFT_LIBRARY: CraftLayerTemplate[] = [
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
    params: { output: 'facets', scale: 6, jitter: 1, tilt: 1.4, sdf_op: 'none', m_hmode: 'below', m_hlevel: 0.6, m_hsoft: 0.1, h_on: true, h_mode: 'min', h_amount: 1.2, dif_on: false },
  },
]
