// The project store: the single source of truth for the open texture, with snapshot undo/redo and autosave.

import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type { ParamValue } from '@/core/params'
import type { Layer, LayerStack, Light, LightType, PostFilter, Project, SmartMaterial } from '@/core/project'
import { stackOrder } from '@/core/project'
import { setLinkedParam } from '@/core/links'
import { addMaterial as recipeAdd, deleteMaterial as recipeDelete, pruneMaterials, setMacro, setMaterialMask as recipeMask, unpackMaterial as recipeUnpack } from '@/recipes'
import { createLayer, createLight, createPostFilter, createProject, normalizeProject } from '@/core/serialize'
import { newId } from '@/core/ids'
import { MAX_LIGHTS } from '@/core/project'
import { PRESETS } from '@/presets'

const AUTOSAVE_KEY = 'bismith:project'
/** Autosave key from before the rename to Bismith; read once if the new key is empty. */
const LEGACY_AUTOSAVE_KEY = 'artificer:project'
const HISTORY_LIMIT = 200

function loadAutosave(): Project | null {
  try {
    const txt = localStorage.getItem(AUTOSAVE_KEY) ?? localStorage.getItem(LEGACY_AUTOSAVE_KEY)
    return txt ? normalizeProject(JSON.parse(txt)) : null
  } catch {
    return null
  }
}

function saveAutosave(json: string): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, json)
  } catch {
    /* storage unavailable or full */
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export const useProjectStore = defineStore('project', () => {
  // First run opens a showcase preset rather than a blank project.
  const project = ref<Project>(loadAutosave() ?? PRESETS.find((p) => p.id === 'bricks')?.build() ?? createProject())
  const past = shallowRef<string[]>([])
  const future = shallowRef<string[]>([])
  let current = JSON.stringify(project.value)
  let suppress = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Bumped whenever the project is replaced wholesale (load / new / undo), so views can refit. */
  const generation = ref(0)

  function commitNow(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const s = JSON.stringify(project.value)
    if (s === current) return
    past.value = [...past.value, current].slice(-HISTORY_LIMIT)
    future.value = []
    current = s
    saveAutosave(s)
  }

  watch(
    project,
    () => {
      if (suppress) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(commitNow, 350)
    },
    { deep: true },
  )

  function restore(json: string): void {
    suppress = true
    project.value = JSON.parse(json) as Project
    current = json
    saveAutosave(json)
    generation.value++
    // Let the deep watcher see the change while suppressed.
    queueMicrotask(() => (suppress = false))
  }

  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  function undo(): void {
    commitNow()
    if (!past.value.length) return
    const prev = past.value[past.value.length - 1]
    past.value = past.value.slice(0, -1)
    future.value = [...future.value, current]
    restore(prev)
  }

  function redo(): void {
    if (!future.value.length) return
    const next = future.value[future.value.length - 1]
    future.value = future.value.slice(0, -1)
    past.value = [...past.value, current]
    restore(next)
  }

  /** Replace the whole project (open file, new from preset). Recorded in history. */
  function load(p: Project): void {
    commitNow()
    project.value = normalizeProject(clone(p))
    generation.value++
    commitNow()
  }

  function newProject(p?: Project): void {
    load(p ?? createProject())
  }

  // ---------------------------------------------------------------- layers
  // Two stacks: 'relief' (evaluated first; shapes the surface only) and 'paint' (project.layers).
  const stackList = (stack: LayerStack): Layer[] => {
    if (stack === 'paint') return project.value.layers
    if (!project.value.relief) project.value.relief = []
    return project.value.relief
  }

  /** Which stack holds a layer, and where. */
  function locateLayer(id: string): { stack: LayerStack; index: number } | undefined {
    for (const stack of ['relief', 'paint'] as const) {
      const index = stackList(stack).findIndex((l) => l.id === id)
      if (index >= 0) return { stack, index }
    }
    return undefined
  }

  function getLayer(id: string): Layer | undefined {
    const at = locateLayer(id)
    return at ? stackList(at.stack)[at.index] : undefined
  }

  function addLayer(type: string, atIndex?: number, overrides: Record<string, ParamValue> = {}, stack: LayerStack = 'paint'): Layer {
    // Relief layers shape the surface only: height on, colour outputs off.
    const layer = createLayer(type, stack === 'relief' ? { h_on: true, dif_on: false, op_on: false, e_on: false, ...overrides } : overrides)
    const layers = stackList(stack)
    const i = atIndex === undefined ? layers.length : Math.max(0, Math.min(layers.length, atIndex))
    layers.splice(i, 0, layer)
    return layers[i]
  }

  function removeLayer(id: string): void {
    const at = locateLayer(id)
    if (at) stackList(at.stack).splice(at.index, 1)
    pruneMaterials(project.value)
  }

  function duplicateLayer(id: string): Layer | undefined {
    const at = locateLayer(id)
    if (!at) return undefined
    const layers = stackList(at.stack)
    const copy = { ...clone(layers[at.index]), id: newId('ly') }
    copy.name = `${copy.name.replace(/ copy$/, '')} copy`
    layers.splice(at.index + 1, 0, copy)
    return layers[at.index + 1]
  }

  /** Move within its stack, or into the other stack when `toStack` differs. */
  function moveLayer(id: string, toIndex: number, toStack?: LayerStack): void {
    const at = locateLayer(id)
    if (!at) return
    const dest = toStack ?? at.stack
    const from = stackList(at.stack)
    const to = stackList(dest)
    if (dest === at.stack) {
      const j = Math.max(0, Math.min(to.length - 1, toIndex))
      if (at.index === j) return
      const [l] = from.splice(at.index, 1)
      to.splice(j, 0, l)
      return
    }
    const [l] = from.splice(at.index, 1)
    if (dest === 'relief') Object.assign(l.params, { dif_on: false, op_on: false, e_on: false })
    to.splice(Math.max(0, Math.min(to.length, toIndex)), 0, l)
  }

  /** Set a layer param; a pattern param also moves the layer's linked copies (same type and seed, see core/links). */
  function setLayerParam(id: string, key: string, value: ParamValue): void {
    const l = getLayer(id)
    if (l) setLinkedParam(project.value, l, key, value)
  }

  /** Give a layer a seed of its own so it stops following its linked copies. */
  function unlinkLayer(id: string): void {
    const l = getLayer(id)
    if (!l || l.params.seed === undefined) return
    const used = new Set(stackOrder(project.value).map((x) => x.params.seed))
    let seed = Number(l.params.seed)
    do seed = 1 + Math.floor(Math.random() * 99998)
    while (used.has(seed))
    l.params.seed = seed
  }

  // ---------------------------------------------------------------- smart materials
  function getMaterial(id: string): SmartMaterial | undefined {
    return project.value.materials?.find((m) => m.id === id)
  }

  function addMaterial(recipeId: string): SmartMaterial {
    return recipeAdd(project.value, recipeId)
  }

  function setMaterialParam(id: string, key: string, value: ParamValue): void {
    const m = getMaterial(id)
    if (m) setMacro(project.value, m, key, value)
  }

  function setMaterialMask(id: string, use: string, invert: boolean): void {
    const m = getMaterial(id)
    if (m) recipeMask(project.value, m, use, invert)
  }

  function renameMaterial(id: string, name: string): void {
    const m = getMaterial(id)
    if (m && name.trim()) m.name = name.trim()
  }

  function unpackMaterial(id: string): void {
    recipeUnpack(project.value, id)
  }

  function deleteMaterial(id: string): void {
    recipeDelete(project.value, id)
  }

  function updateLayer(id: string, patch: Partial<Pick<Layer, 'name' | 'enabled' | 'locked'>>): void {
    const l = getLayer(id)
    if (l) Object.assign(l, patch)
  }

  // ---------------------------------------------------------------- lights
  const lights = () => project.value.lighting.lights

  function getLight(id: string): Light | undefined {
    return lights().find((l) => l.id === id)
  }

  function addLight(type: LightType): Light | undefined {
    if (lights().length >= MAX_LIGHTS) return undefined
    lights().push(createLight(type))
    return lights()[lights().length - 1]
  }

  function removeLight(id: string): void {
    const i = lights().findIndex((l) => l.id === id)
    if (i >= 0) lights().splice(i, 1)
  }

  function duplicateLight(id: string): Light | undefined {
    const i = lights().findIndex((l) => l.id === id)
    if (i < 0 || lights().length >= MAX_LIGHTS) return undefined
    const copy = { ...clone(lights()[i]), id: newId('lt'), name: `${lights()[i].name} copy` }
    lights().splice(i + 1, 0, copy)
    return lights()[i + 1]
  }

  function setLightParam(id: string, key: string, value: ParamValue): void {
    const l = getLight(id)
    if (l) l.params[key] = value
  }

  function updateLight(id: string, patch: Partial<Pick<Light, 'name' | 'enabled'>>): void {
    const l = getLight(id)
    if (l) Object.assign(l, patch)
  }

  // ---------------------------------------------------------------- post
  const post = () => project.value.post

  function getPost(id: string): PostFilter | undefined {
    return post().find((f) => f.id === id)
  }

  function addPost(type: string, atIndex?: number): PostFilter {
    const f = createPostFilter(type)
    const list = post()
    const i = atIndex === undefined ? list.length : Math.max(0, Math.min(list.length, atIndex))
    list.splice(i, 0, f)
    return list[i]
  }

  function removePost(id: string): void {
    const i = post().findIndex((f) => f.id === id)
    if (i >= 0) post().splice(i, 1)
  }

  function movePost(id: string, toIndex: number): void {
    const list = post()
    const i = list.findIndex((f) => f.id === id)
    if (i < 0) return
    const j = Math.max(0, Math.min(list.length - 1, toIndex))
    const [f] = list.splice(i, 1)
    list.splice(j, 0, f)
  }

  function setPostParam(id: string, key: string, value: ParamValue): void {
    const f = getPost(id)
    if (f) f.params[key] = value
  }

  function updatePost(id: string, patch: Partial<Pick<PostFilter, 'enabled'>>): void {
    const f = getPost(id)
    if (f) Object.assign(f, patch)
  }

  return {
    project,
    generation,
    canUndo,
    canRedo,
    undo,
    redo,
    commitNow,
    load,
    newProject,
    getLayer,
    locateLayer,
    addLayer,
    removeLayer,
    duplicateLayer,
    moveLayer,
    setLayerParam,
    unlinkLayer,
    updateLayer,
    getMaterial,
    addMaterial,
    setMaterialParam,
    setMaterialMask,
    renameMaterial,
    unpackMaterial,
    deleteMaterial,
    getLight,
    addLight,
    removeLight,
    duplicateLight,
    setLightParam,
    updateLight,
    getPost,
    addPost,
    removePost,
    movePost,
    setPostParam,
    updatePost,
  }
})
