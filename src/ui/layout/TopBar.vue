<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { useActions } from '@/ui/actions'
import { CHANNEL_VIEWS } from '@/render/display'
import { PRESETS } from '@/presets'
import DropMenu, { type MenuItem } from '@/ui/components/DropMenu.vue'
import Icon from '@/ui/components/Icon.vue'

const store = useProjectStore()
const editor = useEditorStore()
const act = useActions()

const fileItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = [
    { label: 'New project', shortcut: 'Ctrl+Alt+N', action: () => act.newProject() },
    { label: 'Open project…', shortcut: 'Ctrl+O', action: act.openProject },
    { label: 'Save project', shortcut: 'Ctrl+S', action: act.saveProject },
    { separator: true },
    { label: 'Export PNG', shortcut: 'Ctrl+E', action: () => act.exportFinal(1) },
    { label: 'Export PNG @4× (nearest)', action: () => act.exportFinal(4) },
    { label: 'Export all maps (.zip)', action: act.exportAllMaps },
    { label: 'Copy image', action: act.copyFinal },
    { section: 'Export one map' },
    { label: 'Diffuse (+ alpha)', action: () => act.exportMap('diffuse') },
    { label: 'Height (normalised)', action: () => act.exportMap('height') },
    { label: 'Roughness', action: () => act.exportMap('roughness') },
    { label: 'Specular', action: () => act.exportMap('specular') },
    { label: 'Ambient occlusion', action: () => act.exportMap('ao') },
    { label: 'Normal — OpenGL (Y+)', action: () => act.exportMap('normal-gl') },
    { label: 'Normal — DirectX (Y−)', action: () => act.exportMap('normal-dx') },
    { label: 'Emissive', action: () => act.exportMap('emissive') },
    { label: 'Opacity', action: () => act.exportMap('opacity') },
  ]
  let group = ''
  for (const p of PRESETS) {
    if (p.group !== group) {
      group = p.group
      items.push({ section: `New from preset · ${group}` })
    }
    items.push({ label: p.name, action: () => act.newProject(p.build()) })
  }
  return items
})

const editItems = computed<MenuItem[]>(() => [
  { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !store.canUndo, action: store.undo },
  { label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: !store.canRedo, action: store.redo },
  { separator: true },
  { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !editor.selection.id, action: act.duplicateSelection },
  { label: 'Delete', shortcut: 'Del', disabled: !editor.selection.id, action: act.deleteSelection },
])

const viewItems = computed<MenuItem[]>(() => [
  { section: 'Channel' },
  ...CHANNEL_VIEWS.map((c) => ({ label: c.label, shortcut: c.key, checked: editor.channel === c.id, action: () => (editor.channel = c.id) })),
  { separator: true },
  { label: 'Tile preview (3×3)', shortcut: 'T', checked: editor.tile, action: () => (editor.tile = !editor.tile) },
  { label: 'Pixel grid', shortcut: 'G', checked: editor.grid, action: () => (editor.grid = !editor.grid) },
  { label: 'Alpha checkerboard', checked: editor.checker, action: () => (editor.checker = !editor.checker) },
  { label: 'Preview up to selected layer', shortcut: 'S', checked: editor.solo, action: () => (editor.solo = !editor.solo) },
  { separator: true },
  { label: 'Fit to view', shortcut: 'F', action: editor.requestFit },
  { label: 'Restart render', shortcut: 'R', action: () => editor.engine?.restart() },
])

const helpItems: MenuItem[] = [
  { section: 'Viewport' },
  { label: 'Wheel — zoom about cursor', disabled: true },
  { label: 'Middle / Space-drag — pan', disabled: true },
  { label: 'Drag a light gizmo — move light', disabled: true },
  { section: 'Fields' },
  { label: 'Drag — scrub · Shift fine · Ctrl snap', disabled: true },
  { label: 'Click — type a value or expression', disabled: true },
]
</script>

<template>
  <header class="top cf-panel">
    <div class="brand">
      <svg width="16" height="16" viewBox="0 0 26 26" aria-hidden="true">
        <path d="M13 2 L24 13 L13 24 L2 13 Z" fill="none" stroke="var(--accent)" stroke-width="2" />
        <path d="M13 8 L18 13 L13 18 L8 13 Z" fill="var(--accent)" />
      </svg>
      <span>Bismith</span>
    </div>
    <DropMenu label="File" :items="fileItems" />
    <DropMenu label="Edit" :items="editItems" />
    <DropMenu label="View" :items="viewItems" />
    <DropMenu label="Help" :items="helpItems" />

    <div class="tabs" role="tablist" aria-label="Workspaces">
      <button
        v-for="w in [{ id: 'forge', label: 'Forge' }, { id: 'match', label: 'Match' }] as const"
        :key="w.id"
        type="button"
        role="tab"
        class="tab"
        :class="{ on: editor.workspace === w.id }"
        :aria-selected="editor.workspace === w.id"
        @click="editor.workspace = w.id"
      >
        {{ w.label }}
      </button>
    </div>

    <div class="right">
      <span class="file cf-mono">
        {{ store.project.name }}
        <span class="dim">· {{ store.project.width }}×{{ store.project.height }}{{ store.project.tileable ? ' · tiling' : '' }}</span>
      </span>
      <button type="button" class="cf-btn" title="Undo (Ctrl+Z)" aria-label="Undo" :disabled="!store.canUndo" @click="store.undo"><Icon name="undo" :size="13" /></button>
      <button type="button" class="cf-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" :disabled="!store.canRedo" @click="store.redo"><Icon name="redo" :size="13" /></button>
      <button type="button" class="cf-heat" title="Export the final PNG (Ctrl+E)" @click="act.exportFinal(1)">
        <span class="core"><Icon name="download" :size="13" />Export PNG</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.top {
  height: 36px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 10px;
  margin-right: 4px;
  border-right: 1px solid var(--hairline);
  height: 22px;
}
.brand span {
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: 16px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-hi);
}
.tabs {
  display: flex;
  align-items: flex-end;
  align-self: stretch;
  margin-left: 20px;
  gap: 2px;
}
.tab {
  position: relative;
  height: 34px;
  padding: 0 14px;
  border: 0;
  background: transparent;
  color: var(--text-lo);
}
.tab:hover {
  color: var(--text-hi);
}
.tab.on {
  color: var(--text-hi);
  font-weight: 500;
  background: var(--under-body);
}
.tab.on::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--under-bar);
}
.tab.on::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  height: 10px;
  background: var(--under-spill);
  pointer-events: none;
  z-index: 2;
}
.right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.file {
  font-size: 12px;
  color: var(--text);
  margin-right: 6px;
  white-space: nowrap;
}
.dim {
  color: var(--text-lo);
}
.right .cf-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  justify-content: center;
}
</style>
