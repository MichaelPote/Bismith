// Editor UI state: selection, workspace, viewport view state and live engine stats.

import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef } from 'vue'
import type { Engine, EngineStats } from '@/render/engine'
import type { ChannelView } from '@/render/display'

export type SelectionKind = 'project' | 'layer' | 'light' | 'post' | 'render' | 'material'

export interface Selection {
  kind: SelectionKind
  id?: string
}

export type Workspace = 'forge' | 'match'

export const useEditorStore = defineStore('editor', () => {
  const selection = ref<Selection>({ kind: 'project' })
  const workspace = ref<Workspace>('forge')
  const channel = ref<ChannelView>('final')
  const tile = ref(false)
  const grid = ref(true)
  const checker = ref(true)
  /** Preview the stack only up to the selected layer. */
  const solo = ref(false)
  /** Canvas device px per texel and top-left offset in device px. */
  const zoom = ref(4)
  const offsetX = ref(0)
  const offsetY = ref(0)
  /** Incremented to ask the viewport to fit the texture. */
  const fitRequest = ref(0)
  const stats = shallowRef<EngineStats | null>(null)
  const engine = shallowRef<Engine | null>(null)
  const engineError = ref<string | null>(null)
  const toast = ref<{ text: string; kind: 'info' | 'error'; at: number } | null>(null)

  function select(kind: SelectionKind, id?: string): void {
    selection.value = { kind, id }
  }

  function setEngine(e: Engine | null): void {
    engine.value = e ? markRaw(e) : null
  }

  function requestFit(): void {
    fitRequest.value++
  }

  function notify(text: string, kind: 'info' | 'error' = 'info'): void {
    toast.value = { text, kind, at: Date.now() }
  }

  return {
    selection,
    workspace,
    channel,
    tile,
    grid,
    checker,
    solo,
    zoom,
    offsetX,
    offsetY,
    fitRequest,
    stats,
    engine,
    engineError,
    toast,
    select,
    setEngine,
    requestFit,
    notify,
  }
})
