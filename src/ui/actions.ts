// Editor commands shared by menus, toolbar buttons and keyboard shortcuts.

import { nextTick } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { projectFromJSON, projectToJSON } from '@/core/serialize'
import { zipStore } from '@/core/zip'
import { downloadBlob, mapPixels, pixelsToBlob, saveBlobAs, upscale, type MapKind } from '@/render/export'
import { capturePreview } from '@/render/preview'
import type { Project } from '@/core/project'
import { getLayerDef } from '@/layers/registry'
import { getRecipe, recipeLayerTypes } from '@/recipes'

/** Resolves once the browser has painted the current DOM (so a modal is on screen before blocking work starts). */
export function afterPaint(): Promise<void> {
  return nextTick().then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'texture'
}

export function useActions() {
  const store = useProjectStore()
  const editor = useEditorStore()

  function engineOrWarn() {
    const e = editor.engine
    if (!e) editor.notify('The renderer is not ready yet.', 'error')
    return e
  }

  async function exportFinal(scale = 1): Promise<void> {
    const engine = engineOrWarn()
    if (!engine) return
    engine.renderNow()
    const { width, height, pixels } = mapPixels(engine, 'final')
    const blob = await pixelsToBlob(upscale(pixels, width, height, scale), width * scale, height * scale)
    downloadBlob(blob, `${slug(store.project.name)}${scale > 1 ? `@${scale}x` : ''}.png`)
    editor.notify(`Exported ${width * scale}×${height * scale} PNG`)
  }

  async function exportMap(kind: MapKind): Promise<void> {
    const engine = engineOrWarn()
    if (!engine) return
    if (kind === 'final' || kind === 'render') engine.renderNow()
    const { width, height, pixels } = mapPixels(engine, kind)
    downloadBlob(await pixelsToBlob(pixels, width, height), `${slug(store.project.name)}_${kind}.png`)
  }

  async function exportAllMaps(): Promise<void> {
    const engine = engineOrWarn()
    if (!engine) return
    engine.renderNow()
    const kinds: MapKind[] = ['final', 'diffuse', 'height', 'roughness', 'specular', 'ao', 'normal-gl', 'emissive', 'opacity']
    const base = slug(store.project.name)
    const entries = []
    for (const k of kinds) {
      const { width, height, pixels } = mapPixels(engine, k)
      const blob = await pixelsToBlob(pixels, width, height)
      entries.push({ name: `${base}_${k}.png`, data: new Uint8Array(await blob.arrayBuffer()) })
    }
    entries.push({ name: `${base}.bismith.json`, data: new TextEncoder().encode(projectFile()) })
    downloadBlob(new Blob([zipStore(entries) as BlobPart], { type: 'application/zip' }), `${base}_maps.zip`)
    editor.notify(`Exported ${kinds.length} maps + project`)
  }

  async function copyFinal(): Promise<void> {
    const engine = engineOrWarn()
    if (!engine) return
    try {
      engine.renderNow()
      const { width, height, pixels } = mapPixels(engine, 'final')
      const blob = await pixelsToBlob(pixels, width, height)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      editor.notify('Copied the final image')
    } catch {
      editor.notify('Clipboard is not available here', 'error')
    }
  }

  /**
   * The project as a file: with a preview of what the viewport shows now (FR8.20 — the previous one if nothing has
   * rendered). Only the file gets it: the open project is left alone, so saving adds no undo step.
   */
  function projectFile(): string {
    const preview = capturePreview(editor.engine) ?? store.project.preview
    return projectToJSON(preview ? { ...store.project, preview } : store.project)
  }

  async function saveProject(): Promise<void> {
    store.commitNow()
    const blob = new Blob([projectFile()], { type: 'application/json' })
    try {
      const name = await saveBlobAs(blob, `${slug(store.project.name)}.bismith.json`, { description: 'Bismith project', extension: '.json' })
      if (name) editor.notify(`Saved “${name}”`)
    } catch (e) {
      editor.notify(`Could not save the project: ${e instanceof Error ? e.message : e}`, 'error')
    }
  }

  function loadProjectText(text: string): void {
    try {
      const p = projectFromJSON(text)
      store.load(p)
      editor.select('project')
      editor.requestFit()
      editor.notify(`Opened “${p.name}”`)
    } catch (e) {
      editor.notify(`Could not open project: ${e instanceof Error ? e.message : e}`, 'error')
    }
  }

  function openProject(): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (f) loadProjectText(await f.text())
    }
    input.click()
  }

  function newProject(p?: Project): void {
    store.newProject(p)
    editor.select('project')
    editor.requestFit()
  }

  function deleteSelection(): void {
    const s = editor.selection
    if (!s.id) return
    if (s.kind === 'layer') {
      const at = store.layerIndex(s.id)
      store.removeLayer(s.id)
      const list = store.project.layers
      const next = at >= 0 ? list[Math.min(at, list.length - 1)] : undefined
      editor.select(next ? 'layer' : 'project', next?.id)
    } else if (s.kind === 'material') {
      store.deleteMaterial(s.id)
      editor.select('project')
    } else if (s.kind === 'light') {
      store.removeLight(s.id)
      editor.select('project')
    } else if (s.kind === 'post') {
      store.removePost(s.id)
      editor.select('project')
    }
  }

  function duplicateSelection(): void {
    const s = editor.selection
    if (!s.id) return
    if (s.kind === 'layer') {
      const l = store.duplicateLayer(s.id)
      if (l) editor.select('layer', l.id)
    } else if (s.kind === 'light') {
      const l = store.duplicateLight(s.id)
      if (l) editor.select('light', l.id)
    }
  }

  /** Where a new layer or material goes: just after the selected layer or material (after its block), else last. */
  function insertionIndex(): number | undefined {
    const s = editor.selection
    if ((s.kind !== 'layer' && s.kind !== 'material') || !s.id) return undefined
    const at = store.unitOf(s.id)
    if (!at) return undefined
    const last = at.unit.material ? at.unit.layers[at.unit.layers.length - 1] : at.unit.layer
    return store.layerIndex(last.id) + 1
  }

  /**
   * Run `apply`, which adds layers of `types`, first compiling the shaders of any generator types not used yet this
   * session behind the busy modal: a first compile can take seconds (D3D on Windows) and would otherwise freeze the
   * page with no explanation.
   */
  async function withShaders(types: string[], label: string, apply: () => void): Promise<void> {
    const engine = editor.engine
    if (!engine?.uncompiled(types).length) return apply()
    editor.busy = {
      title: 'Compiling shaders…',
      detail: `Setting up ${label} for its first use. This can take a few seconds.`,
      // Without background compiling the page freezes during the compile, so the modal can't wait to fade in.
      instant: !engine.parallelCompile,
    }
    try {
      await afterPaint()
      await engine.precompile(types)
      apply()
      // Where the browser can't compile in the background, the first run does it: keep the modal up until then.
      await nextTick()
      await engine.settled()
    } finally {
      editor.busy = null
    }
  }

  /** Add a layer just after the selection (see insertionIndex). */
  async function addLayer(type: string): Promise<void> {
    await withShaders([type], getLayerDef(type)?.label ?? type, () => {
      const l = store.addLayer(type, insertionIndex())
      editor.select('layer', l.id)
    })
  }

  /** A shape drawn on the canvas becomes its own layer (Path for polygons, Polyline for open lines), just after the selection. */
  async function addShapeLayer(type: 'path' | 'polyline', points: string): Promise<void> {
    await withShaders([type], getLayerDef(type)?.label ?? type, () => {
      const l = store.addLayer(type, insertionIndex(), { points, units: 'px' })
      editor.select('layer', l.id)
    })
  }

  /** Add a smart material (one block of layers) just after the selection. */
  async function addMaterial(recipeId: string): Promise<void> {
    await withShaders(recipeLayerTypes(recipeId, store.project), getRecipe(recipeId)?.label ?? recipeId, () => {
      const m = store.addMaterial(recipeId, insertionIndex())
      editor.select('material', m.id)
    })
  }

  return {
    addShapeLayer,
    exportFinal,
    exportMap,
    exportAllMaps,
    copyFinal,
    saveProject,
    openProject,
    loadProjectText,
    newProject,
    deleteSelection,
    duplicateSelection,
    addLayer,
    addMaterial,
  }
}
