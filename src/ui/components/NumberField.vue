<script setup lang="ts">
// Blender-style number field: drag to scrub (Shift = fine, Ctrl = coarse snap), click to type, arrows to step.
// The fill bar shows the value within its soft range.
import { computed, nextTick, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    softMin?: number
    softMax?: number
    step?: number
    unit?: string
    int?: boolean
    disabled?: boolean
    label?: string
  }>(),
  { unit: '', int: false, disabled: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: number): void
  (e: 'commit', v: number): void
}>()

const track = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const editing = ref(false)
const draft = ref('')
const dragging = ref(false)

const lo = computed(() => props.softMin ?? props.min ?? 0)
const hi = computed(() => props.softMax ?? props.max ?? 1)
const hasRange = computed(() => Number.isFinite(lo.value) && Number.isFinite(hi.value) && hi.value > lo.value)
const frac = computed(() => (hasRange.value ? Math.min(1, Math.max(0, (props.modelValue - lo.value) / (hi.value - lo.value))) : 0))

const stepSize = computed(() => {
  if (props.int) return Math.max(1, props.step ?? 1)
  if (props.step) return props.step
  return hasRange.value ? (hi.value - lo.value) / 100 : 0.01
})

const decimals = computed(() => {
  if (props.int) return 0
  const s = stepSize.value
  if (s >= 1) return 1
  return Math.min(4, Math.max(1, Math.ceil(-Math.log10(s))))
})

const display = computed(() => {
  const v = props.modelValue
  if (!Number.isFinite(v)) return '—'
  const txt = props.int ? String(Math.round(v)) : v.toFixed(decimals.value)
  return props.unit ? `${txt} ${props.unit}` : txt
})

function clamp(v: number): number {
  if (props.min !== undefined) v = Math.max(props.min, v)
  if (props.max !== undefined) v = Math.min(props.max, v)
  if (props.int) v = Math.round(v)
  return v
}

function round(v: number, snap: number): number {
  return Math.round(v / snap) * snap
}

function set(v: number, commit = false): void {
  const c = clamp(Number(v.toFixed(6)))
  if (c !== props.modelValue) emit('update:modelValue', c)
  if (commit) emit('commit', c)
}

function nudge(dir: number): void {
  if (props.disabled) return
  set(props.modelValue + dir * stepSize.value, true)
}

let startX = 0
let startValue = 0
let moved = false

function onDown(e: PointerEvent): void {
  if (props.disabled || editing.value || e.button !== 0) return
  startX = e.clientX
  startValue = props.modelValue
  moved = false
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent): void {
  if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
  const dx = e.clientX - startX
  if (!moved && Math.abs(dx) < 3) return
  moved = true
  dragging.value = true
  const width = track.value?.clientWidth ?? 200
  let perPx: number
  if (hasRange.value) perPx = (hi.value - lo.value) / width
  else perPx = stepSize.value / 2
  if (e.shiftKey) perPx *= 0.1
  let v = startValue + dx * perPx
  if (e.ctrlKey || e.metaKey) v = round(v, stepSize.value * 10)
  else if (!props.int) v = round(v, stepSize.value / 10)
  set(v)
}

function onUp(e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement
  if (!el.hasPointerCapture(e.pointerId)) return
  el.releasePointerCapture(e.pointerId)
  if (moved) {
    dragging.value = false
    emit('commit', props.modelValue)
  } else {
    startEdit()
  }
}

async function startEdit(): Promise<void> {
  if (props.disabled) return
  editing.value = true
  draft.value = props.int ? String(Math.round(props.modelValue)) : String(Number(props.modelValue.toFixed(decimals.value + 2)))
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

function finishEdit(apply: boolean): void {
  if (!editing.value) return
  editing.value = false
  if (!apply) return
  const txt = draft.value.trim().replace(/[a-z°%×]+$/i, '').trim()
  // Allow simple arithmetic like "64/3" or "8*2".
  let v = Number(txt)
  if (!Number.isFinite(v) && /^[-+*/().\d\s]+$/.test(txt)) {
    try {
      v = Function(`"use strict"; return (${txt})`)() as number
    } catch {
      v = NaN
    }
  }
  if (Number.isFinite(v)) set(v, true)
}
</script>

<template>
  <div class="nf" :class="{ dragging, editing, disabled }">
    <button type="button" class="arrow" tabindex="-1" :aria-label="`Decrease ${label ?? ''}`" @click="nudge(-1)">
      <svg width="8" height="8" viewBox="0 0 18 18" aria-hidden="true"><path d="M12 2 L5 9 L12 16" fill="none" stroke="currentColor" stroke-width="2" /></svg>
    </button>
    <div
      ref="track"
      class="track"
      role="slider"
      tabindex="0"
      :aria-label="label"
      :aria-valuenow="modelValue"
      :aria-valuemin="min"
      :aria-valuemax="max"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @keydown.enter.prevent="startEdit"
      @keydown.left.prevent="nudge(-1)"
      @keydown.right.prevent="nudge(1)"
    >
      <div v-if="hasRange" class="fill" :style="{ width: `${frac * 100}%` }" />
      <input
        v-if="editing"
        ref="input"
        v-model="draft"
        class="edit"
        @keydown.enter.prevent="finishEdit(true)"
        @keydown.esc.prevent="finishEdit(false)"
        @blur="finishEdit(true)"
      />
      <span v-else class="val">{{ display }}</span>
    </div>
    <button type="button" class="arrow" tabindex="-1" :aria-label="`Increase ${label ?? ''}`" @click="nudge(1)">
      <svg width="8" height="8" viewBox="0 0 18 18" aria-hidden="true"><path d="M6 2 L13 9 L6 16" fill="none" stroke="currentColor" stroke-width="2" /></svg>
    </button>
  </div>
</template>

<style scoped>
.nf {
  display: flex;
  align-items: stretch;
  height: 22px;
  min-width: 0;
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  background: var(--sunken);
  overflow: hidden;
}
.nf:hover {
  border-color: var(--line);
}
.nf.dragging,
.nf.editing,
.nf:focus-within {
  border-color: var(--accent);
  box-shadow: var(--halo);
}
.nf.disabled {
  opacity: 0.45;
  pointer-events: none;
}
.arrow {
  width: 16px;
  flex: none;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text-lo);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
}
.nf:hover .arrow {
  opacity: 1;
}
.arrow:hover {
  color: var(--text-hi);
  background: var(--hairline);
}
.track {
  position: relative;
  flex: 1;
  min-width: 0;
  cursor: ew-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  touch-action: none;
}
.track:focus-visible {
  outline: none;
}
.fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: var(--hairline);
  pointer-events: none;
}
.nf.dragging .fill {
  background: #3e454b;
}
.val {
  position: relative;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-hi);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}
.edit {
  position: relative;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--text-hi);
  font-family: var(--font-mono);
  font-size: 12px;
  text-align: center;
  padding: 0 4px;
  outline: none;
  cursor: text;
}
</style>
