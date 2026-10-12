<script setup lang="ts">
// Swatch (opens the native picker) + editable hex.
import { ref, watch } from 'vue'

const props = defineProps<{ modelValue: string; label?: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'commit', v: string): void
}>()

const hex = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => (hex.value = v),
)

function normalize(v: string): string | null {
  let h = v.trim().replace(/^#/, '').toLowerCase()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return /^[0-9a-f]{6}$/.test(h) ? `#${h}` : null
}

function onPick(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  emit('update:modelValue', v)
}
function onPickDone(e: Event): void {
  emit('commit', (e.target as HTMLInputElement).value)
}
function onHex(): void {
  const n = normalize(hex.value)
  if (n) {
    emit('update:modelValue', n)
    emit('commit', n)
  } else hex.value = props.modelValue
}
</script>

<template>
  <div class="cf-color">
    <label class="swatch" :style="{ background: modelValue }" :title="label">
      <input type="color" :value="modelValue" :aria-label="label ? `${label} colour` : 'Colour'" @input="onPick" @change="onPickDone" />
    </label>
    <input
      v-model="hex"
      class="hex"
      spellcheck="false"
      :aria-label="label ? `${label} hex` : 'Hex colour'"
      @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      @blur="onHex"
    />
  </div>
</template>

<style scoped>
.cf-color {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.swatch {
  position: relative;
  width: 34px;
  height: 22px;
  flex: none;
  border: 1px solid var(--line);
  border-radius: var(--r-field);
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(17, 19, 22, 0.6);
}
.swatch:hover {
  border-color: var(--line-strong);
}
.swatch input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}
.hex {
  flex: 1;
  min-width: 0;
  height: 22px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  background: var(--sunken);
  color: var(--text-hi);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 0 6px;
}
.hex:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--halo);
}
</style>
