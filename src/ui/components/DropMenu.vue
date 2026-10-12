<script setup lang="ts">
// Dropdown menu: a trigger button and a popover list of actions, section headers and separators.
import { nextTick, onBeforeUnmount, ref } from 'vue'

export interface MenuItem {
  label?: string
  /** Non-clickable section header. */
  section?: string
  separator?: boolean
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  hint?: string
  /** CSS colour for the leading category tick. */
  hue?: string
  action?: () => void
}

const props = withDefaults(defineProps<{ items: MenuItem[]; label?: string; align?: 'left' | 'right'; triggerClass?: string; ariaLabel?: string }>(), {
  align: 'left',
  triggerClass: 'menu-trigger',
})

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)

function onDocDown(e: PointerEvent): void {
  if (root.value && !root.value.contains(e.target as Node)) close()
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}

async function toggle(): Promise<void> {
  if (open.value) return close()
  open.value = true
  document.addEventListener('pointerdown', onDocDown, true)
  document.addEventListener('keydown', onKey)
  await nextTick()
  ;(list.value?.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus()
}

function close(): void {
  open.value = false
  document.removeEventListener('pointerdown', onDocDown, true)
  document.removeEventListener('keydown', onKey)
}

function run(item: MenuItem): void {
  close()
  item.action?.()
}

onBeforeUnmount(close)
defineExpose({ toggle, close })
void props
</script>

<template>
  <div ref="root" class="dm">
    <button type="button" :class="[triggerClass, { open }]" :aria-expanded="open" :aria-label="ariaLabel" aria-haspopup="menu" @click="toggle">
      <slot>{{ label }}</slot>
    </button>
    <div v-if="open" ref="list" class="pop" :class="align" role="menu">
      <template v-for="(item, i) in items" :key="i">
        <div v-if="item.separator" class="sep" />
        <div v-else-if="item.section" class="section">{{ item.section }}</div>
        <button v-else type="button" role="menuitem" class="item" :disabled="item.disabled" :title="item.hint" @click="run(item)">
          <span class="tick" :style="item.hue ? { borderColor: item.hue } : undefined" :class="{ hue: !!item.hue, checked: item.checked }" />
          <span class="lbl">{{ item.label }}</span>
          <span v-if="item.shortcut" class="sc">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dm {
  position: relative;
  display: inline-flex;
}
.menu-trigger {
  height: 26px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: var(--text);
}
.menu-trigger:hover,
.menu-trigger.open {
  background: var(--raised);
  color: var(--text-hi);
}
.pop {
  position: absolute;
  top: calc(100% + 2px);
  z-index: 100;
  min-width: 220px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 4px 0;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--r-field);
  box-shadow: 0 8px 24px rgba(8, 9, 10, 0.55);
}
.pop.left {
  left: 0;
}
.pop.right {
  right: 0;
}
.item {
  width: 100%;
  height: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 8px;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 13px;
}
.item:hover:not(:disabled),
.item:focus-visible {
  background: var(--raised);
  color: var(--text-hi);
  outline: none;
  box-shadow: inset 2px 0 0 var(--accent);
}
.item:disabled {
  color: var(--line-strong);
  cursor: default;
}
.tick {
  width: 8px;
  height: 8px;
  flex: none;
}
.tick.hue {
  border: 1.5px solid;
}
.tick.checked {
  background: var(--e400);
  transform: rotate(45deg) scale(0.8);
}
.lbl {
  flex: 1;
  white-space: nowrap;
}
.sc {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-lo);
}
.section {
  padding: 8px 12px 3px 24px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-lo);
}
.sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--hairline);
}
</style>
