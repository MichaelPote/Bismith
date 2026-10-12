// Project data model. A Project is plain JSON and fully describes a texture (see docs/architecture.md §5).

import type { ParamValues } from './params'

export const PROJECT_VERSION = 1

/** The two layer stacks: relief (surface shape, evaluated first) and paint (colour; `project.layers`). */
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
 * member layers in either stack. Moving a macro rewrites only the member params it affects; the layers stay normal,
 * editable layers, and unpacking drops this record and keeps them.
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
   * Relief stack, bottom → top, evaluated first. Its layers shape the surface — height, roughness, specular and the
   * shape register — and never colour it: albedo, opacity and emission colour are reset to the base afterwards, so
   * height modes compose freely (bricks × noise) and the paint stack sees the finished relief.
   */
  relief: Layer[]
  /**
   * Paint stack, bottom → top, evaluated after the relief. Paint layers may still add fine relief tied to their colour
   * (lit bumps that coincide with colour patches, as in hand-painted textures); the relief stack carries the structure.
   */
  layers: Layer[]
  /** Smart materials over the stacks' layers (optional: absent = none). */
  materials?: SmartMaterial[]
  lighting: Lighting
  render: RenderSettings
  post: PostFilter[]
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
  return { samplesPerFrame: 4, maxSamples: 256, bounces: 2, specular: 1, specularTint: 0, ao: 0, aoRadius: 4, jitter: true, clamp: 8, shadows: true }
}

export function defaultBase(): MaterialBase {
  return { color: '#7a7570', roughness: 0.75, specular: 0.5, height: 0, opacity: 1 }
}

/** Every layer in evaluation order: the relief stack, then the paint stack. */
export function stackOrder(project: Pick<Project, 'relief' | 'layers'>): Layer[] {
  return [...(project.relief ?? []), ...project.layers]
}
