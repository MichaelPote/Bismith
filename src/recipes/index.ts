// Smart-material recipes: registry and the operations on a project (docs/features/fr8.3-smart-materials.md).

import { defaultParams, sanitizeParams, type ParamValue, type ParamValues } from '@/core/params'
import { newId } from '@/core/ids'
import type { Layer, LimitExpr, Project, SmartMaterial } from '@/core/project'
import { foldLimit, layerLimit, limitParams } from '@/layers/masks'
import { layerParamDefs } from '@/layers/registry'
import { cobblestones, dressedStone } from './stone'
import { brushedMetal, hammeredMetal, stains } from './metal'
import { concrete } from './surfaces'
import { tiles } from './tiles'
import { stripes } from './patterned'
import { circuit, grate, lightPanel, metalPlate } from './tech'
import { liquid, marble, rock, wood } from './nature'
import { cutout, paint, pipes } from './industrial'
import type { RecipeContext, RecipeDef } from './types'

export type { RecipeDef, RecipeLayer, RecipeContext } from './types'

export const RECIPES: RecipeDef[] = [
  dressedStone, cobblestones, tiles, concrete, stripes, metalPlate, grate, lightPanel, circuit, liquid, wood, marble, rock, hammeredMetal, brushedMetal, stains, pipes, paint, cutout,
]

export function getRecipe(id: string): RecipeDef | undefined {
  return RECIPES.find((r) => r.id === id)
}

const ctxOf = (p: Project): RecipeContext => ({ width: p.width, height: p.height, depth: p.heightDepth })
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const copy = <T>(v: T): T => (v !== null && typeof v === 'object' ? (JSON.parse(JSON.stringify(v)) as T) : v)

function findLayer(p: Project, id: string): Layer | undefined {
  return p.layers.find((l) => l.id === id)
}

/** The layer types a recipe adds (built with its default macros), e.g. to compile their shaders before adding it. */
export function recipeLayerTypes(recipeId: string, p: Project): string[] {
  const def = getRecipe(recipeId)
  return def ? [...new Set(def.build(defaultParams(def.params), ctxOf(p)).map((b) => b.layer.type))] : []
}

/**
 * Add a smart material to `p` (in place): its layers go in as one block — the relief ones (shape only) first, then
 * the paint — at `at` (default: last, on top of everything); render settings the look relies on are raised. Returns
 * the new material.
 */
export function addMaterial(p: Project, recipeId: string, overrides: ParamValues = {}, name?: string, at?: number): SmartMaterial {
  const def = getRecipe(recipeId)
  if (!def) throw new Error(`Unknown recipe: ${recipeId}`)
  const params = sanitizeParams(def.params, { ...defaultParams(def.params), ...overrides })
  const members: Record<string, string> = {}
  const built = def.build(params, ctxOf(p))
  const block = [...built.filter((b) => b.stack === 'relief'), ...built.filter((b) => b.stack !== 'relief')]
  for (const { role, layer } of block) members[role] = layer.id
  const i = def.first ? 0 : at === undefined ? p.layers.length : Math.max(0, Math.min(p.layers.length, at))
  p.layers.splice(i, 0, ...block.map((b) => b.layer))
  if (def.render) {
    const r = def.render
    if (r.ao !== undefined) p.render.ao = Math.max(p.render.ao, r.ao)
    if (r.aoRadius !== undefined && p.render.ao > 0) p.render.aoRadius = Math.max(p.render.aoRadius, r.aoRadius)
    if (r.specularTint !== undefined) p.render.specularTint = Math.max(p.render.specularTint, r.specularTint)
    if (r.shadows) p.render.shadows = true
  }
  const m: SmartMaterial = { id: newId('sm'), recipe: recipeId, name: name ?? def.label, params, members }
  ;(p.materials ??= []).push(m)
  return m
}

/**
 * Set one macro control (in place): rebuild the recipe with the old and the new macros and write every member param
 * (and on/off state) whose built value changed. Params the macro doesn't affect — including the user's own edits —
 * are left alone. Returns how many member values were written.
 */
export function setMacro(p: Project, m: SmartMaterial, key: string, value: ParamValue): number {
  const def = getRecipe(m.recipe)
  if (!def) return 0
  const ctx = ctxOf(p)
  const next = { ...m.params, [key]: value }
  const before = def.build(m.params, ctx)
  const after = def.build(next, ctx)
  let written = 0
  for (const a of after) {
    const b = before.find((x) => x.role === a.role)
    const id = m.members[a.role]
    const layer = id ? findLayer(p, id) : undefined
    if (!b || !layer) continue
    if (a.layer.type !== layer.type) {
      // The macro picks another generator (e.g. Tiles → Pattern): the member becomes the newly built layer.
      layer.type = a.layer.type
      layer.name = a.layer.name
      layer.params = copy(a.layer.params)
      layer.enabled = a.layer.enabled
      written++
      continue
    }
    for (const k of new Set([...Object.keys(a.layer.params), ...Object.keys(b.layer.params)])) {
      if (same(a.layer.params[k], b.layer.params[k])) continue
      layer.params[k] = copy(a.layer.params[k])
      written++
    }
    if (a.layer.enabled !== b.layer.enabled) {
      layer.enabled = a.layer.enabled
      written++
    }
  }
  m.params = next
  return written
}

/**
 * Limit a whole material to masks (FR8.23), on top of each member's own Limit to — e.g. a wall outside an opening an
 * earlier shape wrote, the material behind it inside. Kept on the material (the pipeline applies it), so members a
 * macro rebuilds keep it.
 */
export function setMaterialLimit(m: SmartMaterial, limit: LimitExpr | null): void {
  if (limit?.terms.length) m.limit = limit
  else delete m.limit
}

/**
 * Rename a mask everywhere it is named (FR8.23): what layers write and are limited to, their sources, materials' limits
 * and recipe macros that name a mask (the Cut-out's). Returns how many places changed.
 */
export function renameMask(p: Project, from: string, to: string): number {
  const name = to.trim()
  if (!name || name === from) return 0
  let n = 0
  for (const l of p.layers) {
    for (const d of layerParamDefs(l.type)) {
      if (d.mask && String(l.params[d.key] ?? '').trim() === from) {
        l.params[d.key] = name
        n++
      }
    }
  }
  for (const m of p.materials ?? []) {
    for (const t of m.limit?.terms ?? []) {
      if (t.mask === from) {
        t.mask = name
        n++
      }
    }
    for (const d of getRecipe(m.recipe)?.params ?? []) {
      if (d.mask && String(m.params[d.key] ?? '').trim() === from) {
        setMacro(p, m, d.key, name)
        n++
      }
    }
  }
  return n
}

/** The material a layer belongs to, if any. */
export function materialOf(p: Project, layerId: string): SmartMaterial | undefined {
  return (p.materials ?? []).find((m) => Object.values(m.members).includes(layerId))
}

/** Drop the material record; its layers stay as ordinary layers (switched off if the material was hidden). */
export function unpackMaterial(p: Project, id: string): void {
  const m = (p.materials ?? []).find((x) => x.id === id)
  for (const lid of Object.values(m?.members ?? {})) {
    const l = findLayer(p, lid)
    if (!l) continue
    if (m!.enabled === false) l.enabled = false
    // The material's limit moves onto its members.
    if (m!.limit) Object.assign(l.params, limitParams(foldLimit(layerLimit(l.params), m!.limit)))
  }
  p.materials = (p.materials ?? []).filter((x) => x.id !== id)
}

/** Remove the material and its member layers. */
export function deleteMaterial(p: Project, id: string): void {
  const m = (p.materials ?? []).find((x) => x.id === id)
  if (!m) return
  const ids = new Set(Object.values(m.members))
  p.layers = p.layers.filter((l) => !ids.has(l.id))
  unpackMaterial(p, id)
}

/** Forget members that no longer exist (after a layer is deleted); drop a material left without members. */
export function pruneMaterials(p: Project): void {
  if (!p.materials?.length) return
  const ids = new Set(p.layers.map((l) => l.id))
  for (const m of p.materials) for (const [role, id] of Object.entries(m.members)) if (!ids.has(id)) delete m.members[role]
  p.materials = p.materials.filter((m) => Object.keys(m.members).length > 0)
}
