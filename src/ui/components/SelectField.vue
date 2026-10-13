<script setup lang="ts">
// Dropdown. The wheel or the arrow keys over the field step through the options (stopping at the ends), so the
// choices can be previewed in turn. A wheel that is scrolling the panel past the field keeps scrolling it.
import { recentlyScrolled } from '@/ui/scrolling'
import { IconChevronDown } from '@tabler/icons-vue'

const props = defineProps<{ modelValue: string; options: { value: string; label: string; hint?: string }[]; label?: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'commit', v: string): void
}>()

function choose(v: string): void {
  emit('update:modelValue', v)
  emit('commit', v)
}

function onChange(e: Event): void {
  choose((e.target as HTMLSelectElement).value)
}

function step(dir: number): void {
  const i = props.options.findIndex((o) => o.value === props.modelValue)
  const j = Math.max(0, Math.min(props.options.length - 1, (i < 0 ? 0 : i) + dir))
  if (j !== i) choose(props.options[j].value)
}

let wheelAcc = 0
function onWheel(e: WheelEvent): void {
  if (recentlyScrolled() || e.deltaY === 0) return
  e.preventDefault()
  // A mouse notch steps once; a trackpad's small deltas add up to a step.
  if (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50) {
    wheelAcc = 0
    step(Math.sign(e.deltaY))
    return
  }
  wheelAcc += e.deltaY
  if (Math.abs(wheelAcc) >= 100) {
    step(Math.sign(wheelAcc))
    wheelAcc = 0
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.altKey) return
  const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0
  if (!dir) return
  e.preventDefault()
  step(dir)
}
</script>

<template>
  <div class="cf-select">
    <select :value="modelValue" :aria-label="label" @change="onChange" @wheel="onWheel" @keydown="onKey">
      <option v-for="o in options" :key="o.value" :value="o.value" :title="o.hint">{{ o.label }}</option>
    </select>
    <IconChevronDown class="caret" :size="12" />
  </div>
</template>

<style scoped>
.cf-select {
  position: relative;
  min-width: 0;
}
select {
  width: 100%;
  height: 22px;
  padding: 0 22px 0 8px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  background: var(--raised);
  color: var(--text-hi);
  font-size: 12px;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
  text-overflow: ellipsis;
}
select:hover {
  border-color: var(--line);
}
select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--halo);
}
option {
  background: var(--panel);
  color: var(--text);
}
.caret {
  position: absolute;
  right: 6px;
  top: 5px;
  pointer-events: none;
  color: var(--text-lo);
}
</style>
