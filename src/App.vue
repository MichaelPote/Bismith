<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { useActions } from '@/ui/actions'
import { CHANNEL_VIEWS } from '@/render/display'
import TopBar from '@/ui/layout/TopBar.vue'
import Outliner from '@/ui/layout/Outliner.vue'
import Viewport from '@/ui/layout/Viewport.vue'
import Properties from '@/ui/layout/Properties.vue'
import StatusBar from '@/ui/layout/StatusBar.vue'
import MatchWorkspace from '@/ui/panels/MatchWorkspace.vue'
import BusyModal from '@/ui/components/BusyModal.vue'
import AskModal from '@/ui/components/AskModal.vue'
import EyedropperChip from '@/ui/components/EyedropperChip.vue'
import NewProjectWizard from '@/ui/panels/NewProjectWizard.vue'

const store = useProjectStore()
const editor = useEditorStore()
const act = useActions()

// ---------------------------------------------------------------- resizable side panels
function readWidth(key: string, def: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return v > 0 ? v : def
  } catch {
    return def
  }
}
const leftW = ref(readWidth('cf-left', 250))
const rightW = ref(readWidth('cf-right', 340))
watch([leftW, rightW], ([l, r]) => {
  try {
    localStorage.setItem('cf-left', String(l))
    localStorage.setItem('cf-right', String(r))
  } catch {
    /* storage unavailable */
  }
})
const cols = computed(() => `${leftW.value}px 4px minmax(0, 1fr) 4px ${rightW.value}px`)

function startResize(e: PointerEvent, side: 'left' | 'right'): void {
  const startX = e.clientX
  const start = side === 'left' ? leftW.value : rightW.value
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => {
    const d = ev.clientX - startX
    // The properties sidebar may grow twice as wide as the outliner (wide graphs and ramps).
    const w = Math.max(180, Math.min(side === 'left' ? 560 : 1120, side === 'left' ? start + d : start - d))
    if (side === 'left') leftW.value = w
    else rightW.value = w
  }
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}

// ---------------------------------------------------------------- shortcuts
function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function onKey(e: KeyboardEvent): void {
  // The new-project wizard and questions are modal: the editor's shortcuts wait until they close.
  if (editor.wizard || editor.question) return
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  if (mod && k === 'z' && !e.shiftKey) {
    if (isTyping(e.target)) return
    e.preventDefault()
    store.undo()
    return
  }
  if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) {
    if (isTyping(e.target)) return
    e.preventDefault()
    store.redo()
    return
  }
  if (mod && k === 's') {
    e.preventDefault()
    act.saveProject()
    return
  }
  if (mod && k === 'o') {
    e.preventDefault()
    act.openProject()
    return
  }
  if (mod && k === 'e') {
    e.preventDefault()
    act.exportFinal(1)
    return
  }
  if (mod && e.altKey && k === 'n') {
    e.preventDefault()
    editor.wizard = true
    return
  }
  if (isTyping(e.target) || mod || e.altKey) {
    if (mod && k === 'd' && !isTyping(e.target)) {
      e.preventDefault()
      act.duplicateSelection()
    }
    return
  }
  if (k === 'delete' || k === 'backspace') {
    act.deleteSelection()
  } else if (k === 'f') {
    editor.requestFit()
  } else if (k === 't') {
    editor.tile = !editor.tile
  } else if (k === 'g') {
    editor.grid = !editor.grid
  } else if (k === 's') {
    editor.solo = !editor.solo
  } else if (k === 'r') {
    editor.engine?.restart()
  } else {
    const c = CHANNEL_VIEWS.find((v) => v.key === e.key)
    if (c) editor.channel = c.id
  }
}

// ---------------------------------------------------------------- drag & drop project files
async function onDrop(e: DragEvent): Promise<void> {
  const f = e.dataTransfer?.files?.[0]
  if (!f) return
  e.preventDefault()
  if (f.name.endsWith('.json') || f.type === 'application/json') act.loadProjectText(await f.text())
  else if (f.type.startsWith('image/')) {
    editor.workspace = 'match'
    // After the workspace has mounted (a first visit), so it hears the event.
    await nextTick()
    window.dispatchEvent(new CustomEvent('bismith:reference', { detail: f }))
  }
}

// ---------------------------------------------------------------- toast
const toastVisible = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => editor.toast,
  (t) => {
    if (!t) return
    toastVisible.value = true
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toastVisible.value = false), t.kind === 'error' ? 5000 : 2600)
  },
)

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="app" @dragover.prevent @drop="onDrop">
    <TopBar />
    <main class="main" :style="{ gridTemplateColumns: cols }">
      <Outliner />
      <div class="gutter" role="separator" aria-orientation="vertical" aria-label="Resize outliner" @pointerdown="startResize($event, 'left')" />
      <div class="centre">
        <Viewport v-show="editor.workspace === 'create'" />
        <KeepAlive><MatchWorkspace v-if="editor.workspace === 'match'" /></KeepAlive>
      </div>
      <div class="gutter" role="separator" aria-orientation="vertical" aria-label="Resize properties" @pointerdown="startResize($event, 'right')" />
      <Properties />
    </main>
    <StatusBar />
    <div v-if="toastVisible && editor.toast" class="toast" :class="editor.toast.kind" role="status">{{ editor.toast.text }}</div>
    <NewProjectWizard v-if="editor.wizard" />
    <BusyModal />
    <AskModal />
    <EyedropperChip />
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  display: grid;
  grid-template-rows: 36px minmax(0, 1fr) 24px;
  gap: var(--gap-app);
  padding: var(--gap-app);
  background: var(--void);
}
.main {
  display: grid;
  min-height: 0;
}
.centre {
  display: grid;
  min-width: 0;
  min-height: 0;
}
.centre > * {
  grid-area: 1 / 1;
  min-width: 0;
  min-height: 0;
}
.gutter {
  cursor: col-resize;
  touch-action: none;
}
.gutter:hover {
  background: linear-gradient(90deg, transparent 1px, var(--line) 1px, var(--line) 2px, transparent 2px);
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
  padding: 8px 14px;
  border: 1px solid var(--line);
  border-left: 2px solid var(--pill);
  border-radius: var(--r-field);
  background: rgba(44, 49, 54, 0.97);
  color: var(--text-hi);
  font-size: 12px;
  z-index: 200;
  box-shadow: 0 6px 18px rgba(8, 9, 10, 0.5);
}
.toast.error {
  border-left-color: var(--blood);
}
</style>
