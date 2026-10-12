// Editor commands shared by menus, toolbar buttons and keyboard shortcuts.

import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { projectFromJSON, projectToJSON } from '@/core/serialize'
import { zipStore } from '@/core/zip'
import { downloadBlob, mapPixels, pixelsToBlob, upscale, type MapKind } from '@/render/export'
import type { Project } from '@/core/project'

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
    entries.push({ name: `${base}.bismith.json`, data: new TextEncoder().encode(projectToJSON(store.project)) })
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

  function saveProject(): void {
    store.commitNow()
    const blob = new Blob([projectToJSON(store.project)], { type: 'application/json' })
    downloadBlob(blob, `${slug(store.project.name)}.bismith.json`)
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

  /** Add a layer just after the selection (see insertionIndex). */
  function addLayer(type: string): void {
    const l = store.addLayer(type, insertionIndex())
    editor.select('layer', l.id)
  }

  /** Add a smart material (one block of layers) just after the selection. */
  function addMaterial(recipeId: string): void {
    const m = store.addMaterial(recipeId, insertionIndex())
    editor.select('material', m.id)
  }

  return {
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
