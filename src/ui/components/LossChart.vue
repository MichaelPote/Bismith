<script setup lang="ts">
// Best-loss curve for the optimiser: one ember line over a hairline grid.
import { computed } from 'vue'

const props = defineProps<{ values: number[]; width?: number; height?: number }>()
const W = computed(() => props.width ?? 320)
const H = computed(() => props.height ?? 96)

const path = computed(() => {
  const v = props.values
  if (v.length < 2) return ''
  const max = Math.max(...v)
  const min = Math.min(...v)
  const span = max - min || 1
  const pad = 4
  return v
    .map((y, i) => {
      const px = pad + (i / (v.length - 1)) * (W.value - pad * 2)
      const py = pad + (1 - (y - min) / span) * (H.value - pad * 2)
      return `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`
    })
    .join(' ')
})
const range = computed(() => {
  const v = props.values
  return v.length ? { max: Math.max(...v), min: Math.min(...v) } : null
})
</script>

<template>
  <div class="lc">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" :aria-label="`Best loss over ${values.length} steps`">
      <line v-for="i in 3" :key="i" x1="0" :x2="W" :y1="(H * i) / 4" :y2="(H * i) / 4" class="grid" />
      <path v-if="path" :d="path" class="line" />
    </svg>
    <div v-if="range" class="axis cf-mono">
      <span>{{ range.max.toFixed(4) }}</span>
      <span>{{ range.min.toFixed(4) }}</span>
    </div>
  </div>
</template>

<style scoped>
.lc {
  position: relative;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  background: var(--sunken);
}
svg {
  width: 100%;
  height: 100%;
  display: block;
}
.grid {
  stroke: var(--hairline);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.line {
  fill: none;
  stroke: var(--e400);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 0 3px rgba(246, 110, 16, 0.5));
}
.axis {
  position: absolute;
  right: 6px;
  top: 4px;
  bottom: 4px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-lo);
  pointer-events: none;
}
</style>
