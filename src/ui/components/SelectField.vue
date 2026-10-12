<script setup lang="ts">
defineProps<{ modelValue: string; options: { value: string; label: string }[]; label?: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'commit', v: string): void
}>()
function onChange(e: Event): void {
  const v = (e.target as HTMLSelectElement).value
  emit('update:modelValue', v)
  emit('commit', v)
}
</script>

<template>
  <div class="cf-select">
    <select :value="modelValue" :aria-label="label" @change="onChange">
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <svg class="caret" width="10" height="8" viewBox="0 0 12 10" aria-hidden="true"><path d="M1 2 L6 8 L11 2" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
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
  right: 7px;
  top: 7px;
  pointer-events: none;
  color: var(--text-lo);
}
</style>
