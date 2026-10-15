<script setup lang="ts">
// The eyedropper's preview beside the cursor: the colour a click would take, and its hex (src/ui/eyedropper.ts).
import { pick } from '@/ui/eyedropper'
</script>

<template>
  <div v-if="pick.active && pick.hex" class="eyedrop-chip" :style="{ left: `${pick.x + 16}px`, top: `${pick.y + 16}px` }" aria-hidden="true">
    <span class="sw" :style="{ background: pick.hex }" />
    <span class="cf-mono">{{ pick.hex }}</span>
  </div>
</template>

<style scoped>
.eyedrop-chip {
  position: fixed;
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 7px 3px 3px;
  border: 1px solid var(--line);
  border-radius: var(--r-field);
  background: var(--panel);
  color: var(--text-hi);
  font-size: 11px;
  box-shadow: 0 6px 18px rgba(8, 9, 10, 0.5);
  pointer-events: none;
}
.sw {
  width: 22px;
  height: 16px;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px rgba(17, 19, 22, 0.6);
}
</style>
