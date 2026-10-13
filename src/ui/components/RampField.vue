<script setup lang="ts">
// Scalar ramp (roughness, specular): the output where the source is 0 (left) and where it is 1 (right), shown as a
// grey ramp like the colour ramp. Drag a gem sideways to scrub its value (Shift fine, Ctrl whole numbers), or type
// in the fields below; ⇄ swaps the ends.
import { computed, ref } from 'vue'
import NumberField from './NumberField.vue'
import { IconArrowsLeftRight } from '@tabler/icons-vue'
import { vTip } from '@/ui/tooltip'

const props = withDefaults(
  defineProps<{
    a: number
    b: number
    min?: number
    max?: number
    step?: number
    label?: string
    defaultA?: number
    defaultB?: number
    /** Memory keys for the two fields' double-click restore. */
    memoryA?: string
    memoryB?: string
  }>(),
  { min: 0, max: 1, step: 0.001 },
)
const emit = defineEmits<{
  (e: 'update:a', v: number): void
  (e: 'update:b', v: number): void
  (e: 'commit'): void
}>()

const bar = ref<HTMLElement | null>(null)
const span = computed(() => Math.max(1e-6, props.max - props.min))
const grey = (v: number) => {
  const g = Math.round(255 * Math.min(1, Math.max(0, (v - props.min) / span.value)))
  return `rgb(${g}, ${g}, ${g})`
}
const css = computed(() => `linear-gradient(90deg, ${grey(props.a)}, ${grey(props.b)})`)

const clamp = (v: number) => Math.min(props.max, Math.max(props.min, v))
function setEnd(end: 0 | 1, v: number): void {
  if (end === 0) emit('update:a', v)
  else emit('update:b', v)
}

let drag: { end: 0 | 1; x: number; v: number } | null = null
const dragging = ref<0 | 1 | null>(null)
function onDown(e: PointerEvent, end: 0 | 1): void {
  if (e.button !== 0) return
  drag = { end, x: e.clientX, v: end === 0 ? props.a : props.b }
  dragging.value = end
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onMove(e: PointerEvent): void {
  if (!drag) return
  const w = bar.value?.clientWidth ?? 160
  let v = drag.v + ((e.clientX - drag.x) / w) * span.value * (e.shiftKey ? 0.1 : 1)
  v = e.ctrlKey || e.metaKey ? Math.round(v) : Math.round(v / props.step) * props.step
  setEnd(drag.end, Number(clamp(v).toFixed(6)))
}
function onUp(e: PointerEvent): void {
  if (!drag) return
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  drag = null
  dragging.value = null
  emit('commit')
}

function swap(): void {
  const { a, b } = props
  emit('update:a', b)
  emit('update:b', a)
  emit('commit')
}
</script>

<template>
  <div class="ramp">
    <div ref="bar" class="bar" :style="{ background: css }" />
    <div class="stops">
      <button
        v-for="end in [0, 1] as const"
        :key="end"
        v-tip:top="end === 0 ? 'Where the source is 0 — drag to change' : 'Where the source is 1 — drag to change'"
        type="button"
        class="stop"
        :class="{ sel: dragging === end, right: end === 1 }"
        :aria-label="`${label ?? 'Ramp'} at ${end}`"
        @pointerdown="onDown($event, end)"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      >
        <svg width="12" height="16" viewBox="0 0 16 28" aria-hidden="true">
          <path d="M8 3 L15 10 L15 18 L8 25 L1 18 L1 10 Z" :fill="grey(end === 0 ? a : b)" :stroke="dragging === end ? 'var(--e100)' : 'var(--line-strong)'" stroke-width="2" />
        </svg>
      </button>
    </div>
    <div class="edit">
      <NumberField
        :model-value="a"
        :min="min"
        :max="max"
        :step="step"
        :default-value="defaultA"
        :memory-key="memoryA"
        :label="`${label ?? 'Ramp'} at 0`"
        @update:model-value="emit('update:a', $event)"
        @commit="emit('commit')"
      />
      <button v-tip:top="'Swap the ends'" type="button" class="cf-ico-btn" aria-label="Swap the ends" @click="swap"><IconArrowsLeftRight :size="13" /></button>
      <NumberField
        :model-value="b"
        :min="min"
        :max="max"
        :step="step"
        :default-value="defaultB"
        :memory-key="memoryB"
        :label="`${label ?? 'Ramp'} at 1`"
        @update:model-value="emit('update:b', $event)"
        @commit="emit('commit')"
      />
    </div>
  </div>
</template>

<style scoped>
.ramp {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  user-select: none;
  -webkit-user-select: none;
}
.bar {
  height: 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-field);
  box-shadow: inset 0 0 0 1px rgba(17, 19, 22, 0.5);
}
.stops {
  position: relative;
  height: 16px;
  margin: 0 6px;
}
.stop {
  position: absolute;
  top: 0;
  left: 0;
  width: 12px;
  height: 16px;
  margin-left: -6px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: ew-resize;
  touch-action: none;
}
.stop.right {
  left: 100%;
}
.stop.sel {
  filter: var(--drop-halo);
}
.edit {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 4px;
}
</style>
