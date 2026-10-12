<script setup lang="ts">
// Collapsible panel card with a disclosure chevron; optional enable checkbox in the header.
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{ title: string; collapsed?: boolean; toggle?: boolean | null; storageKey?: string }>(),
  { collapsed: false, toggle: null },
)
const emit = defineEmits<{ (e: 'update:toggle', v: boolean): void }>()

function initial(): boolean {
  if (props.storageKey) {
    try {
      const v = localStorage.getItem(`cf-card:${props.storageKey}`)
      if (v !== null) return v === '1'
    } catch {
      /* storage unavailable */
    }
  }
  return !props.collapsed
}

const open = ref(initial())
watch(open, (v) => {
  if (!props.storageKey) return
  try {
    localStorage.setItem(`cf-card:${props.storageKey}`, v ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
})
</script>

<template>
  <section class="card" :class="{ off: toggle === false }">
    <div class="head">
      <button type="button" class="disclose" :aria-expanded="open" @click="open = !open">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path v-if="open" d="M2 3 L5 7 L8 3" fill="none" stroke="currentColor" stroke-width="1.2" />
          <path v-else d="M3 2 L7 5 L3 8" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
        <span v-if="toggle === null" class="title">{{ title }}</span>
      </button>
      <label v-if="toggle !== null" class="toggle">
        <input type="checkbox" :checked="toggle" @change="emit('update:toggle', ($event.target as HTMLInputElement).checked)" />
        <span class="title">{{ title }}</span>
      </label>
      <div class="actions"><slot name="actions" /></div>
    </div>
    <div v-show="open" class="body"><slot /></div>
  </section>
</template>

<style scoped>
.card {
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  background: var(--base);
  overflow: hidden;
  flex: none;
}
.head {
  height: 24px;
  display: flex;
  align-items: center;
  background: var(--panel);
}
.head:hover {
  background: var(--raised);
}
.disclose {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 4px 0 8px;
  border: 0;
  background: transparent;
  color: var(--text-lo);
  text-align: left;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  height: 100%;
  cursor: pointer;
}
.toggle input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}
.disclose:has(.title) {
  flex: 1;
}
.title {
  font-weight: 500;
  color: var(--text-hi);
  font-size: 13px;
}
.off .title {
  color: var(--text-lo);
  font-weight: 400;
}
.actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 4px;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px 8px;
}
.off .body {
  opacity: 0.55;
}
</style>
