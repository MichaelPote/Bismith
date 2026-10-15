// Project data model. A Project is plain JSON and fully describes a texture (see docs/architecture.md §5).

import type { ParamValues } from './params'

export const PROJECT_VERSION = 1

/**
 * Where a recipe's or template's layer belongs (the project itself keeps one list): 'relief' layers shape the surface
 * only — their colour outputs are off — and go before the 'paint' layers that colour it.
 */
export type LayerStack = 'relief' | 'paint'

export interface Layer {
  id: string
  /** LayerDef type id, e.g. 'noise', 'rect', 'bricks', 'blur'. */
  type: string
  name: string
  enabled: boolean
  /** Locked layers are never mutated by the optimiser. */
  locked?: boolean
  params: ParamValues
}

/**
 * A smart material (docs/features/fr8.3-smart-materials.md): a recipe's handful of macro controls over ordinary
 * member layers, which sit together as one block of `project.layers` (see groupMaterials). Moving a macro rewrites only
 * the member params it affects; the layers stay normal, editable layers, and unpacking drops this record and keeps them.
 */
export interface SmartMaterial {
  id: string
  /** Recipe id (src/recipes). */
  recipe: string
  name: string
  /** Macro control values. */
  params: ParamValues
  /** Role → member layer id. */
  members: Record<string, string>
  /** Named mask (FR8.13) every member is clipped to: channel '1'..'4', inside or outside (cut a hole). */
  mask?: { use: string; invert: boolean }
  /** false hides the whole material (its members keep their own on/off states). Absent = shown. */
  enabled?: boolean
}

/** Ids of the layers hidden because their smart material is. */
export function hiddenByMaterial(p: Pick<Project, 'materials'>): Set<string> {
  const ids = new Set<string>()
  for (const m of p.materials ?? []) if (m.enabled === false) for (const id of Object.values(m.members)) ids.add(id)
  return ids
}

export type LightType = 'directional' | 'point'

export interface Light {
  id: string
  type: LightType
  name: string
  enabled: boolean
  params: ParamValues
}

export interface Lighting {
  sky: { enabled: boolean; zenith: string; horizon: string; intensity: number }
  ambient: { color: string; intensity: number }
  lights: Light[]
}

export interface RenderSettings {
  /** Path-traced samples rendered per animation frame. */
  samplesPerFrame: number
  /** Accumulation stops at this many samples. */
  maxSamples: number
  /** Indirect bounces (0 = direct light only). */
  bounces: number
  /** Specular scale: multiplies every pixel's specular level (base + layer Specular outputs); F0 = 0.08 × level × scale. */
  specular: number
  /**
   * Specular tint 0..1: 0 = white (dielectric) highlights; 1 = highlights in the surface's own hue at the same
   * luminance (albedo / luma(albedo)), so glints enrich the colour instead of greying it.
   */
  specularTint: number
  /**
   * Ambient occlusion strength (0 = off): surface lighting × AO^strength, AO measured from the height field's
   * horizon around each pixel — dark creases where blocks touch, even with cast shadows off.
   */
  ao: number
  /** AO search radius in px. */
  aoRadius: number
  /** Sub-pixel jitter of primary samples (soft shadow edges); off = texel centres. */
  jitter: boolean
  /** Per-sample luminance clamp against fireflies (0 = off). */
  clamp: number
  /** Lights cast shadows (off = shading by surface angle only — the painted, hand-lit texture look). */
  shadows: boolean
  /**
   * Supersampling 1–4 (optional, default 1): the material stack and tracer run at k× the size and are box-filtered
   * down before post, so 1 px details are computed finer and averaged (core/supersample.ts).
   */
  supersample?: number
}

export interface PostFilter {
  id: string
  type: string
  enabled: boolean
  params: ParamValues
}

export interface MaterialBase {
  /** Initial diffuse colour under all layers (sRGB hex). */
  color: string
  roughness: number
  /** Initial per-pixel specular level (0.5 = a 4 % dielectric reflection at scale 1); layers' Specular outputs vary it. */
  specular: number
  height: number
  opacity: number
}

export interface Project {
  version: number
  name: string
  width: number
  height: number
  /** Wrap noise, shapes, filters and light rays so the texture repeats seamlessly. */
  tileable: boolean
  /** World height in px of a height value of 1.0. */
  heightDepth: number
  /** Global seed mixed into every layer seed. */
  seed: number
  base: MaterialBase
  /**
   * The layers in evaluation order: first = earliest (bottom of the stack), last = latest. Each layer's outputs say
   * which channels it touches — a relief layer is one with its colour outputs off (Diffuse unticked), and a paint layer
   * may still add fine relief tied to its colour (lit bumps on colour patches, as in hand-painted textures).
   */
  layers: Layer[]
  /** Smart materials over the layers (optional: absent = none). */
  materials?: SmartMaterial[]
  lighting: Lighting
  render: RenderSettings
  post: PostFilter[]
  /**
   * A small lossy thumbnail of the final render, as a data URL (base64 WebP, or JPEG where the browser can't encode
   * WebP; ≤ 128 px), written on save. The new-project wizard shows it instead of rendering the project (FR8.20).
   * Optional; rendering ignores it.
   */
  preview?: string
}

export const SIZE_PRESETS = [16, 32, 64, 128, 256, 512, 1024]
export const MAX_SIZE = 2048
export const MAX_LIGHTS = 8

export function defaultLighting(): Lighting {
  return {
    sky: { enabled: true, zenith: '#9fb4c8', horizon: '#c8c2b8', intensity: 0.35 },
    ambient: { color: '#ffffff', intensity: 0.02 },
    lights: [],
  }
}

export function defaultRender(): RenderSettings {
  return { samplesPerFrame: 4, maxSamples: 256, bounces: 2, specular: 1, specularTint: 1, ao: 0, aoRadius: 4, jitter: true, clamp: 8, shadows: true, supersample: 1 }
}

export function defaultBase(): MaterialBase {
  return { color: '#7a7570', roughness: 0.75, specular: 0.5, height: 0, opacity: 1 }
}

/** One top-level entry of the layer list: a free layer, or a smart material's block of member layers. */
export type LayerUnit = { layer: Layer; material?: undefined } | { material: SmartMaterial; layers: Layer[]; layer?: undefined }

/** Split `layers` into units (a material's members must already sit together, see groupMaterials). */
export function layerUnits(layers: Layer[], materials: SmartMaterial[] | undefined): LayerUnit[] {
  const owner = new Map<string, SmartMaterial>()
  for (const m of materials ?? []) for (const id of Object.values(m.members)) owner.set(id, m)
  const units: LayerUnit[] = []
  for (const l of layers) {
    const m = owner.get(l.id)
    const last = units[units.length - 1]
    if (!m) units.push({ layer: l })
    else if (last?.material === m) last.layers.push(l)
    else units.push({ material: m, layers: [l] })
  }
  return units
}

export const flattenUnits = (units: LayerUnit[]): Layer[] => units.flatMap((u) => (u.material ? u.layers : [u.layer]))

/**
 * Reorder `layers` so each smart material's members sit together, gathered where the material's last member is
 * (members keep their relative order, other layers theirs). The outliner shows a material as one collapsible block.
 * Gathering at the last member keeps every colour layer in order when a legacy project's relief stack is merged in:
 * the material's relief members move up to join its paint members.
 */
export function groupMaterials(layers: Layer[], materials: SmartMaterial[] | undefined): Layer[] {
  if (!materials?.length) return layers
  const owner = new Map<string, SmartMaterial>()
  for (const m of materials) for (const id of Object.values(m.members)) owner.set(id, m)
  const last = new Map<SmartMaterial, string>()
  for (const l of layers) {
    const m = owner.get(l.id)
    if (m) last.set(m, l.id)
  }
  const out: Layer[] = []
  for (const l of layers) {
    const m = owner.get(l.id)
    if (!m) out.push(l)
    else if (last.get(m) === l.id) out.push(...layers.filter((x) => owner.get(x.id) === m))
  }
  return out
}
