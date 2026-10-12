<script setup lang="ts">
// Modal over the app while blocking work runs (editor.busy), e.g. a generator's first shader compile. It blocks input
// at once but fades in after a short delay (unless `instant`), so quick work doesn't flash it. The spinner animates
// only transform, which browsers can run off the main thread, so it may keep turning while a compile stalls the page.
import { useEditorStore } from '@/stores/editor'

const editor = useEditorStore()
</script>

<template>
  <div v-if="editor.busy" class="busy" :class="{ instant: editor.busy.instant }" role="dialog" aria-modal="true" aria-busy="true" aria-labelledby="busy-title" aria-describedby="busy-detail">
    <div class="card">
      <span class="spinner" aria-hidden="true" />
      <div>
        <div id="busy-title" class="title">{{ editor.busy.title }}</div>
        <div v-if="editor.busy.detail" id="busy-detail" class="detail">{{ editor.busy.detail }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.busy {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(8, 9, 10, 0.45);
  cursor: progress;
  animation: busy-in 160ms ease-out 250ms both;
}
.busy.instant {
  animation: none;
}
.card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  max-width: 360px;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: var(--r-field);
  background: var(--panel);
  box-shadow: 0 8px 24px rgba(8, 9, 10, 0.55);
}
.spinner {
  width: 20px;
  height: 20px;
  flex: none;
  margin-top: 1px;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: busy-spin 0.8s linear infinite;
}
.title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-hi);
}
.detail {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-mid);
}
@keyframes busy-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes busy-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 2.4s;
  }
}
</style>
