<script setup lang="ts">
// Blender-style outliner: Project · Paint and Relief stacks (top of list = top of stack; relief is evaluated first) ·
// Lighting · Post.
import { computed, nextTick, ref } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useEditorStore, type SelectionKind } from '@/stores/editor'
import { useActions } from '@/ui/actions'
import { allLayerDefs, CATEGORY_LABELS } from '@/layers/registry'
import { allPostDefs } from '@/render/post/registry'
import type { LayerCategory } from '@/layers/types'
import { CATEGORY_HUE, layerHue, layerIcon, LIGHT_HUE, POST_HUE } from '@/ui/meta'
import { MAX_LIGHTS, type Layer, type LayerStack } from '@/core/project'
import DropMenu, { type MenuItem } from '@/ui/components/DropMenu.vue'
import Icon from '@/ui/components/Icon.vue'
import { RECIPES } from '@/recipes'
import { linkedCopies } from '@/core/links'

const store = useProjectStore()
const editor = useEditorStore()
const act = useActions()

const STACKS: { key: LayerStack; label: string; hint: string; empty: string }[] = [
  { key: 'paint', label: 'Paint', hint: 'Colour layers, applied over the finished relief', empty: 'No paint layers. Use + to add one.' },
  { key: 'relief', label: 'Relief', hint: 'Surface shape — height, roughness, specular — evaluated first; never colours', empty: 'No relief layers. Use + to add one.' },
]
const stackList = (key: LayerStack): Layer[] => (key === 'relief' ? (store.project.relief ?? []) : store.project.layers)
const topDown = (key: LayerStack) => [...stackList(key)].reverse()
const errors = computed(() => editor.stats?.errors ?? {})

function addLayerItems(stack: LayerStack): MenuItem[] {
  const items: MenuItem[] = []
  const order: LayerCategory[] = ['noise', 'shape', 'pattern', 'filter', 'adjust']
  for (const cat of order) {
    const defs = allLayerDefs().filter((d) => d.category === cat)
    if (!defs.length) continue
    items.push({ section: CATEGORY_LABELS[cat] })
    for (const d of defs) items.push({ label: d.label, hint: d.description, hue: CATEGORY_HUE[cat], action: () => act.addLayer(d.type, stack) })
  }
  return items
}

// ---------------------------------------------------------------- smart materials
const MATERIAL_HUE = 'var(--accent-hi)'
const materials = computed(() => store.project.materials ?? [])
/** layer id → its smart material (for the member tag). */
const memberOf = computed(() => {
  const m = new Map<string, { id: string; name: string }>()
  for (const mat of materials.value) for (const id of Object.values(mat.members)) m.set(id, mat)
  return m
})
const linkCount = (layer: Layer) => linkedCopies(store.project, layer).length

const addMaterialItems = computed<MenuItem[]>(() =>
  RECIPES.map((r) => ({
    label: r.label,
    hint: r.description,
    hue: MATERIAL_HUE,
    action: () => {
      const m = store.addMaterial(r.id)
      editor.select('material', m.id)
    },
  })),
)

const addLightItems = computed<MenuItem[]>(() => [
  {
    label: 'Directional light',
    hue: LIGHT_HUE,
    disabled: store.project.lighting.lights.length >= MAX_LIGHTS,
    action: () => {
      const l = store.addLight('directional')
      if (l) editor.select('light', l.id)
    },
  },
  {
    label: 'Point light',
    hue: LIGHT_HUE,
    disabled: store.project.lighting.lights.length >= MAX_LIGHTS,
    action: () => {
      const l = store.addLight('point')
      if (l) editor.select('light', l.id)
    },
  },
])

const addPostItems = computed<MenuItem[]>(() =>
  allPostDefs().map((d) => ({
    label: d.label,
    hint: d.description,
    hue: POST_HUE,
    action: () => {
      const f = store.addPost(d.type)
      editor.select('post', f.id)
    },
  })),
)

function isSel(kind: SelectionKind, id?: string): boolean {
  return editor.selection.kind === kind && editor.selection.id === id
}

// ---------------------------------------------------------------- rename
const renaming = ref<string | null>(null)
const renameText = ref('')
const renameInput = ref<HTMLInputElement[] | null>(null)

async function startRename(id: string, name: string): Promise<void> {
  renaming.value = id
  renameText.value = name
  await nextTick()
  renameInput.value?.[0]?.focus()
  renameInput.value?.[0]?.select()
}

function finishRename(kind: 'layer' | 'light', apply: boolean): void {
  const id = renaming.value
  renaming.value = null
  if (!apply || !id || !renameText.value.trim()) return
  if (kind === 'layer') store.updateLayer(id, { name: renameText.value.trim() })
  else store.updateLight(id, { name: renameText.value.trim() })
}

// ---------------------------------------------------------------- drag reorder (layer stacks + post)
type DragList = LayerStack | 'post'
const isStack = (l: DragList): l is LayerStack => l !== 'post'
const drag = ref<{ list: DragList; id: string } | null>(null)
const dropAt = ref<{ list: DragList; index: number } | null>(null)

function onDragStart(e: DragEvent, list: DragList, id: string): void {
  drag.value = { list, id }
  e.dataTransfer?.setData('text/plain', id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(e: DragEvent, list: DragList, rowIndex: number): void {
  // Layers may move between the two stacks; post filters stay in their list.
  if (!drag.value || isStack(drag.value.list) !== isStack(list) || (!isStack(list) && drag.value.list !== list)) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  const after = e.clientY > r.top + r.height / 2
  dropAt.value = { list, index: rowIndex + (after ? 1 : 0) }
}

function onDrop(list: DragList): void {
  const d = drag.value
  const at = dropAt.value
  drag.value = null
  dropAt.value = null
  if (!d || !at || at.list !== list) return
  if (isStack(list)) {
    // Rows are top-down; the stack is bottom-up.
    const dest = stackList(list)
    const from = d.list === list ? dest.findIndex((l) => l.id === d.id) : -1
    let target = dest.length - at.index
    if (from >= 0 && from < target) target -= 1
    store.moveLayer(d.id, target, list)
  } else {
    const from = store.project.post.findIndex((f) => f.id === d.id)
    let target = at.index
    if (from < target) target -= 1
    store.movePost(d.id, target)
  }
}

function onDragEnd(): void {
  drag.value = null
  dropAt.value = null
}
</script>

<template>
  <aside class="outliner cf-panel">
    <div class="head">
      <span class="cf-label">Outliner</span>
    </div>
    <div class="scroll">
      <button type="button" class="row root" :class="{ sel: isSel('project') }" @click="editor.select('project')">
        <Icon name="project" :size="13" :stroke="isSel('project') ? 'var(--accent-hi)' : 'var(--text-lo)'" />
        <span class="name strong">{{ store.project.name }}</span>
        <span class="meta cf-mono">{{ store.project.width }}×{{ store.project.height }}</span>
      </button>

      <!-- Smart materials -->
      <div class="section" title="Recipes as a handful of controls over ordinary layers (the layers stay below, editable)">
        <span class="cf-label">Materials</span>
        <span class="count cf-mono">{{ materials.length }}</span>
        <DropMenu :items="addMaterialItems" align="right" trigger-class="add" aria-label="Add smart material"><Icon name="plus" :size="12" /></DropMenu>
      </div>
      <div class="list">
        <button v-for="m in materials" :key="m.id" type="button" class="row" :class="{ sel: isSel('material', m.id) }" @click="editor.select('material', m.id)">
          <Icon name="diamond" :size="13" :stroke="isSel('material', m.id) ? 'var(--accent-hi)' : MATERIAL_HUE" />
          <span class="name">{{ m.name }}</span>
          <span class="meta cf-mono">{{ Object.keys(m.members).length }} layers</span>
        </button>
        <div v-if="!materials.length" class="empty">Add a stone wall, metal or stains as a few sliders.</div>
      </div>

      <!-- Layer stacks -->
      <template v-for="st in STACKS" :key="st.key">
        <div class="section" :title="st.hint">
          <span class="cf-label">{{ st.label }}</span>
          <span class="count cf-mono">{{ stackList(st.key).length }}</span>
          <DropMenu :items="addLayerItems(st.key)" align="right" trigger-class="add" :aria-label="`Add ${st.label.toLowerCase()} layer`"><Icon name="plus" :size="12" /></DropMenu>
        </div>
        <div class="list" @dragleave.self="dropAt = null" @dragover="!stackList(st.key).length && onDragOver($event, st.key, 0)" @drop.prevent="!stackList(st.key).length && onDrop(st.key)">
          <div
            v-for="(layer, i) in topDown(st.key)"
            :key="layer.id"
            class="row"
            :class="{ sel: isSel('layer', layer.id), off: !layer.enabled, dropBefore: dropAt?.list === st.key && dropAt.index === i, dropAfter: dropAt?.list === st.key && dropAt.index === i + 1 && i === stackList(st.key).length - 1 }"
            draggable="true"
            @dragstart="onDragStart($event, st.key, layer.id)"
            @dragover="onDragOver($event, st.key, i)"
            @drop.prevent="onDrop(st.key)"
            @dragend="onDragEnd"
            @click="editor.select('layer', layer.id)"
          >
            <Icon :name="layerIcon(layer.type)" :size="13" :stroke="isSel('layer', layer.id) ? 'var(--accent-hi)' : layerHue(layer.type)" />
            <input
              v-if="renaming === layer.id"
              ref="renameInput"
              v-model="renameText"
              class="rename"
              aria-label="Layer name"
              @click.stop
              @keydown.enter.prevent="finishRename('layer', true)"
              @keydown.esc.prevent="finishRename('layer', false)"
              @blur="finishRename('layer', true)"
            />
            <span v-else class="name" @dblclick.stop="startRename(layer.id, layer.name)">{{ layer.name }}</span>
            <span v-if="errors[layer.id]" class="err" :title="errors[layer.id]">!</span>
            <span v-if="linkCount(layer)" class="tag" :title="`Linked with ${linkCount(layer)} other layer(s): same pattern, edited together`"><Icon name="link" :size="11" /></span>
            <button
              v-if="memberOf.get(layer.id)"
              type="button"
              class="tag mat"
              :title="`Part of ${memberOf.get(layer.id)!.name}`"
              :aria-label="`Select material ${memberOf.get(layer.id)!.name}`"
              @click.stop="editor.select('material', memberOf.get(layer.id)!.id)"
            >
              <Icon name="diamond" :size="11" />
            </button>
            <button
              type="button"
              class="mini"
              :class="{ dim: !layer.locked }"
              :title="layer.locked ? 'Locked from the optimiser' : 'Lock (optimiser will not change it)'"
              :aria-label="layer.locked ? 'Unlock layer' : 'Lock layer'"
              @click.stop="store.updateLayer(layer.id, { locked: !layer.locked })"
            >
              <Icon :name="layer.locked ? 'lock' : 'unlock'" :size="12" />
            </button>
            <button
              type="button"
              class="mini"
              :title="layer.enabled ? 'Hide' : 'Show'"
              :aria-label="layer.enabled ? 'Hide layer' : 'Show layer'"
              @click.stop="store.updateLayer(layer.id, { enabled: !layer.enabled })"
            >
              <Icon :name="layer.enabled ? 'eye' : 'eye-off'" :size="12" />
            </button>
          </div>
          <div v-if="!stackList(st.key).length" class="empty" :class="{ dropBefore: dropAt?.list === st.key }">{{ st.empty }}</div>
          <div v-if="st.key === 'relief'" class="base row" title="Base material (project settings)" @click="editor.select('project')">
            <span class="swatch" :style="{ background: store.project.base.color }" />
            <span class="name lo">Base material</span>
          </div>
        </div>
      </template>

      <!-- Lighting -->
      <div class="section">
        <span class="cf-label">Lighting</span>
        <span class="count cf-mono">{{ store.project.lighting.lights.length }}</span>
        <DropMenu :items="addLightItems" align="right" trigger-class="add" aria-label="Add light"><Icon name="plus" :size="12" /></DropMenu>
      </div>
      <div class="list">
        <button type="button" class="row" :class="{ sel: isSel('render') }" @click="editor.select('render')">
          <Icon name="sky" :size="13" :stroke="isSel('render') ? 'var(--accent-hi)' : LIGHT_HUE" />
          <span class="name">World &amp; render</span>
          <span class="meta cf-mono">{{ store.project.render.bounces }}b</span>
        </button>
        <div
          v-for="light in store.project.lighting.lights"
          :key="light.id"
          class="row"
          :class="{ sel: isSel('light', light.id), off: !light.enabled }"
          @click="editor.select('light', light.id)"
        >
          <Icon :name="light.type === 'point' ? 'point' : 'sun'" :size="13" :stroke="isSel('light', light.id) ? 'var(--accent-hi)' : LIGHT_HUE" />
          <input
            v-if="renaming === light.id"
            ref="renameInput"
            v-model="renameText"
            class="rename"
            aria-label="Light name"
            @click.stop
            @keydown.enter.prevent="finishRename('light', true)"
            @keydown.esc.prevent="finishRename('light', false)"
            @blur="finishRename('light', true)"
          />
          <span v-else class="name" @dblclick.stop="startRename(light.id, light.name)">{{ light.name }}</span>
          <span class="chip" :style="{ background: String(light.params.color) }" />
          <button
            type="button"
            class="mini"
            :aria-label="light.enabled ? 'Disable light' : 'Enable light'"
            @click.stop="store.updateLight(light.id, { enabled: !light.enabled })"
          >
            <Icon :name="light.enabled ? 'eye' : 'eye-off'" :size="12" />
          </button>
        </div>
      </div>

      <!-- Post -->
      <div class="section">
        <span class="cf-label">Post</span>
        <span class="count cf-mono">{{ store.project.post.length }}</span>
        <DropMenu :items="addPostItems" align="right" trigger-class="add" aria-label="Add post filter"><Icon name="plus" :size="12" /></DropMenu>
      </div>
      <div class="list" @dragleave.self="dropAt = null">
        <div
          v-for="(f, i) in store.project.post"
          :key="f.id"
          class="row"
          :class="{ sel: isSel('post', f.id), off: !f.enabled, dropBefore: dropAt?.list === 'post' && dropAt.index === i, dropAfter: dropAt?.list === 'post' && dropAt.index === i + 1 && i === store.project.post.length - 1 }"
          draggable="true"
          @dragstart="onDragStart($event, 'post', f.id)"
          @dragover="onDragOver($event, 'post', i)"
          @drop.prevent="onDrop('post')"
          @dragend="onDragEnd"
          @click="editor.select('post', f.id)"
        >
          <Icon name="post" :size="13" :stroke="isSel('post', f.id) ? 'var(--accent-hi)' : POST_HUE" />
          <span class="name">{{ allPostDefs().find((d) => d.type === f.type)?.label ?? f.type }}</span>
          <span v-if="errors[f.id]" class="err" :title="errors[f.id]">!</span>
          <button type="button" class="mini" :aria-label="f.enabled ? 'Disable filter' : 'Enable filter'" @click.stop="store.updatePost(f.id, { enabled: !f.enabled })">
            <Icon :name="f.enabled ? 'eye' : 'eye-off'" :size="12" />
          </button>
        </div>
        <div v-if="!store.project.post.length" class="empty">No post filters. The render is clamped to 0–1.</div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.tag {
  display: inline-flex;
  align-items: center;
  color: var(--text-lo);
  background: none;
  border: 0;
  padding: 0;
  flex: none;
}
.tag.mat {
  color: var(--accent-hi);
  cursor: pointer;
}
.outliner {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.head {
  height: 28px;
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-bottom: 1px solid var(--hairline);
}
.scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 12px;
}
.section {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 4px 0 10px;
  margin-top: 6px;
}
.count {
  font-size: 11px;
  color: var(--line-strong);
}
.section :deep(.dm) {
  margin-left: auto;
}
.section :deep(.add) {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  background: var(--sunken);
  color: var(--text-mid);
  padding: 0;
}
.section :deep(.add:hover),
.section :deep(.add.open) {
  border-color: var(--accent);
  color: var(--accent-hi);
  box-shadow: var(--halo);
}
.list {
  display: flex;
  flex-direction: column;
}
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 24px;
  width: 100%;
  padding: 0 4px 0 14px;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: default;
  font-size: 13px;
}
.row:hover {
  background: var(--raised);
}
.row.sel {
  background: var(--raised);
  box-shadow: inset 2px 0 0 var(--accent);
  color: var(--text-hi);
}
.row.off .name {
  color: var(--line-strong);
  text-decoration: line-through;
  text-decoration-color: var(--line);
}
.row.root {
  padding-left: 10px;
}
.row.dropBefore::before,
.row.dropAfter::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  background: var(--under-bar);
}
.row.dropBefore::before {
  top: -1px;
}
.row.dropAfter::after {
  bottom: -1px;
}
.name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name.strong {
  font-weight: 500;
  color: var(--text-hi);
}
.name.lo {
  color: var(--text-lo);
}
.meta {
  font-size: 11px;
  color: var(--text-lo);
}
.rename {
  flex: 1;
  min-width: 0;
  height: 20px;
  border: 1px solid var(--accent);
  border-radius: var(--r-field);
  background: var(--sunken);
  color: var(--text-hi);
  font-size: 12px;
  padding: 0 4px;
  outline: none;
}
.mini {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-lo);
  flex: none;
}
.mini:hover {
  color: var(--text-hi);
  background: var(--hairline);
}
.mini.dim {
  opacity: 0;
}
.row:hover .mini.dim {
  opacity: 0.6;
}
.err {
  width: 14px;
  height: 14px;
  border-radius: 2px;
  background: var(--blood);
  color: var(--deep);
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chip {
  width: 10px;
  height: 10px;
  border: 1px solid var(--line);
}
.swatch {
  width: 13px;
  height: 13px;
  border: 1px solid var(--line);
  flex: none;
}
.base {
  border-top: 1px dashed var(--hairline);
  margin-top: 2px;
}
.empty {
  padding: 4px 14px;
  font-size: 12px;
  color: var(--text-lo);
}
</style>
