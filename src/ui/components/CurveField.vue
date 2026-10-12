<script setup lang="ts">
// Curve editor (e.g. custom bevel profile): a smooth, shape-preserving curve through draggable points on [0,1]² —
// points may rise and fall (rims, dishes).
// Drag a point; click empty space to add one; double-click a point to remove it (the end points stay).
import { computed, ref } from 'vue'
import { MAX_CURVE_POINTS, evalCurve, type Curve, type CurvePoint } from '@/core/params'

const props = defineProps<{ modelValue: Curve; label?: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: Curve): void
  (e: 'commit', v: Curve): void
}>()

const W = 200
const H = 110
const PAD = 8
const svg = ref<SVGSVGElement | null>(null)
const dragging = ref<number | null>(null)

const pts = computed(() => props.modelValue.points)
const toX = (x: number) => PAD + x * (W - 2 * PAD)
const toY = (y: number) => H - PAD - y * (H - 2 * PAD)

const path = computed(() => {
  const c = props.modelValue
  const n = 64
  let d = ''
  for (let i = 0; i <= n; i++) {
    const x = i / n
    d += `${i ? 'L' : 'M'}${toX(x).toFixed(1)},${toY(evalCurve(c, x)).toFixed(1)}`
  }
  return d
})

function local(e: PointerEvent | MouseEvent): CurvePoint {
  const r = svg.value!.getBoundingClientRect()
  const x = ((e.clientX - r.left) / r.width) * W
  const y = ((e.clientY - r.top) / r.height) * H
  return {
    x: Math.min(1, Math.max(0, (x - PAD) / (W - 2 * PAD))),
    y: Math.min(1, Math.max(0, (H - PAD - y) / (H - 2 * PAD))),
  }
}

function emitPoints(points: CurvePoint[], commit = false): void {
  const v = { points: points.map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4) })) }
  emit('update:modelValue', v)
  if (commit) emit('commit', v)
}

function onPointDown(e: PointerEvent, i: number): void {
  e.stopPropagation()
  dragging.value = i
  ;(e.target as Element).setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent): void {
  const i = dragging.value
  if (i === null) return
  const p = local(e)
  const list = pts.value.map((q) => ({ ...q }))
  const last = list.length - 1
  // End points stay on the left / right edge; inner points stay between their neighbours.
  const lo = i === 0 ? 0 : list[i - 1].x + 0.01
  const hi = i === last ? 1 : list[i + 1].x - 0.01
  list[i] = { x: i === 0 ? 0 : i === last ? 1 : Math.min(hi, Math.max(lo, p.x)), y: p.y }
  emitPoints(list)
}

function onUp(): void {
  if (dragging.value === null) return
  dragging.value = null
  emitPoints(pts.value, true)
}

function onBackground(e: MouseEvent): void {
  if (pts.value.length >= MAX_CURVE_POINTS) return
  const p = local(e)
  if (p.x <= 0.005 || p.x >= 0.995) return
  emitPoints([...pts.value, p].sort((a, b) => a.x - b.x), true)
}

function onRemove(e: MouseEvent, i: number): void {
  e.stopPropagation()
  if (i === 0 || i === pts.value.length - 1 || pts.value.length <= 2) return
  emitPoints(pts.value.filter((_, j) => j !== i), true)
}
</script>

<template>
  <div class="curve">
    <svg
      ref="svg"
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      :aria-label="label ?? 'Curve'"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointerleave="onUp"
      @click="onBackground"
    >
      <rect :x="PAD" :y="PAD" :width="W - 2 * PAD" :height="H - 2 * PAD" class="frame" />
      <line v-for="g in 3" :key="`v${g}`" :x1="toX(g / 4)" :x2="toX(g / 4)" :y1="PAD" :y2="H - PAD" class="grid" />
      <line v-for="g in 3" :key="`h${g}`" :y1="toY(g / 4)" :y2="toY(g / 4)" :x1="PAD" :x2="W - PAD" class="grid" />
      <path :d="path" class="line" />
      <circle
        v-for="(p, i) in pts"
        :key="i"
        :cx="toX(p.x)"
        :cy="toY(p.y)"
        r="4.5"
        class="pt"
        :class="{ active: dragging === i }"
        @pointerdown="onPointDown($event, i)"
        @click.stop
        @dblclick="onRemove($event, i)"
      />
    </svg>
    <div class="axes"><span>edge</span><span>bevel width →</span></div>
  </div>
</template>

<style scoped>
.curve {
  width: 100%;
}
svg {
  width: 100%;
  height: auto;
  display: block;
  background: var(--bg-inset, #15171a);
  border: 1px solid var(--line, #2b2f35);
  border-radius: 4px;
  touch-action: none;
  cursor: crosshair;
}
.frame {
  fill: none;
  stroke: var(--line, #2b2f35);
}
.grid {
  stroke: var(--line, #2b2f35);
  stroke-dasharray: 2 3;
}
.line {
  fill: none;
  stroke: var(--accent, #d8893a);
  stroke-width: 1.6;
}
.pt {
  fill: var(--panel, #1e2126);
  stroke: var(--accent-hi, #f0a04b);
  stroke-width: 1.5;
  cursor: grab;
}
.pt.active {
  fill: var(--accent-hi, #f0a04b);
  cursor: grabbing;
}
.axes {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-lo, #8a8f98);
  margin-top: 2px;
}
</style>
