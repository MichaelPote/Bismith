<script setup lang="ts">
// Shaping › Value graph: a cross-section through one feature of the layer — nothing, the rise to full, the fall,
// nothing — with the current bevel, levels, gamma, posterize, invert, cutoff and Offset applied (shapingSweep). The
// dashed ghost is the value before shaping; with Height on the scale is the height output (the top line = Amount). Drawn at
// its measured pixel width (1 unit = 1 px), so the labels keep their size; in the control column of the param rows,
// or across the whole card in a narrow sidebar (≤ 360 px, the `props` container in Properties.vue).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ParamDef, ParamValues } from '@/core/params'
import { shapingSweep } from '@/layers/shapingPreview'

const props = defineProps<{ defs: ParamDef[]; values: ParamValues; sdf: boolean }>()

const PAD = 6
/** The plot's width in px, measured; its height keeps the proportion up to 175 px. */
const W = ref(200)
const H = computed(() => Math.min(175, Math.round(W.value * 0.42)))
const box = ref<HTMLElement | null>(null)
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([e]) => {
    if (e.contentRect.width > 0) W.value = Math.round(e.contentRect.width)
  })
  ro.observe(box.value!)
})
onBeforeUnmount(() => ro?.disconnect())

const defaults = computed(() => new Map(props.defs.map((d) => [d.key, d.default])))
const sweep = computed(() => shapingSweep((k) => props.values[k] ?? defaults.value.get(k), props.sdf))

/** The vertical range: the unshaped 0 … Amount plus wherever the curves go, a little padded. */
const range = computed(() => {
  const s = sweep.value
  let lo = Math.min(0, s.amount)
  let hi = Math.max(0, s.amount)
  for (const v of [...s.output, ...s.input]) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  if (hi - lo < 1e-6) hi = lo + 1
  const m = (hi - lo) * 0.08
  return { lo: lo - m, hi: hi + m }
})

const toX = (x: number) => PAD + x * (W.value - 2 * PAD)
const toY = (y: number) => H.value - PAD - ((y - range.value.lo) / (range.value.hi - range.value.lo)) * (H.value - 2 * PAD)

function line(ys: number[]): string {
  const xs = sweep.value.xs
  return ys.map((y, i) => `${i ? 'L' : 'M'}${toX(xs[i]).toFixed(1)},${toY(y).toFixed(1)}`).join('')
}

const outPath = computed(() => line(sweep.value.output))
const inPath = computed(() => line(sweep.value.input))
const fillPath = computed(() => `${outPath.value}L${toX(1)},${toY(0)}L${toX(0)},${toY(0)}Z`)

/** The bevel ramps either side (shapes with a profiled bevel), as x spans. */
const bands = computed(() => {
  const s = sweep.value
  if (!props.sdf || s.ramp <= 0) return []
  return [
    [s.edge[0], s.edge[0] + s.ramp],
    [s.edge[1] - s.ramp, s.edge[1]],
  ]
})

/** The full value's level: Amount in height units (1 when Height is off). */
const fmtTop = (v: number) => String(Number(v.toFixed(3)))
const fmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Number(Math.abs(v).toFixed(3))}`
</script>

<template>
  <div class="sgraph">
    <span />
    <div class="body">
      <div ref="box" class="plot">
        <svg :height="H" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Shaped value across one feature">
          <rect v-for="(b, i) in bands" :key="i" :x="toX(b[0])" :width="toX(b[1]) - toX(b[0])" :y="PAD" :height="H - 2 * PAD" class="band" />
          <line :x1="PAD" :x2="W - PAD" :y1="toY(sweep.amount)" :y2="toY(sweep.amount)" class="grid" />
          <line :x1="PAD" :x2="W - PAD" :y1="toY(0)" :y2="toY(0)" class="base" />
          <line v-if="sweep.cut !== null" :x1="PAD" :x2="W - PAD" :y1="toY(sweep.cut)" :y2="toY(sweep.cut)" class="cut" />
          <path :d="fillPath" class="fill" />
          <path :d="inPath" class="ghost" />
          <path :d="outPath" class="line" />
          <text :x="W - PAD - 2" :y="toY(sweep.amount) - 2" class="tag" text-anchor="end">{{ fmtTop(sweep.amount) }}</text>
          <text :x="W - PAD - 2" :y="toY(0) - 2" class="tag" text-anchor="end">0</text>
          <text v-if="sweep.cut !== null" :x="PAD + 2" :y="toY(sweep.cut) - 2" class="tag cutTag">cutoff</text>
          <text v-if="sweep.offset !== 0" :x="PAD + 2" :y="PAD + 10" class="tag">offset {{ fmt(sweep.offset) }}</text>
        </svg>
      </div>
      <div class="axes">
        <span>{{ sdf ? 'outside' : '0' }}</span>
        <span>{{ sdf ? (bands.length ? 'bevel → full → bevel' : 'edge → full → edge') : 'value 0 → 1 → 0' }}</span>
        <span>{{ sdf ? 'outside' : '0' }}</span>
      </div>
      <div class="legend">
        <span><svg viewBox="0 0 16 4" class="key"><line x1="0" x2="16" y1="2" y2="2" class="line" /></svg>shaped</span>
        <span><svg viewBox="0 0 16 4" class="key"><line x1="0" x2="16" y1="2" y2="2" class="ghost" /></svg>before shaping</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sgraph {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 8px;
  padding: 2px 0 4px;
}
.body {
  min-width: 0;
}
@container props (max-width: 360px) {
  .sgraph {
    grid-template-columns: minmax(0, 1fr);
  }
  .sgraph > span {
    display: none;
  }
}
.plot {
  background: var(--sunken);
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  overflow: hidden;
}
.plot svg {
  width: 100%;
  display: block;
}
.band {
  fill: var(--text-lo);
  opacity: 0.08;
}
.grid {
  stroke: var(--line);
  stroke-dasharray: 2 3;
}
.base {
  stroke: var(--line-strong);
}
.cut {
  stroke: var(--gold);
  stroke-dasharray: 3 2;
  opacity: 0.8;
}
.fill {
  fill: var(--accent);
  opacity: 0.14;
}
.ghost {
  fill: none;
  stroke: var(--text-lo);
  stroke-dasharray: 2 2;
  stroke-width: 1;
  opacity: 0.7;
}
.line {
  fill: none;
  stroke: var(--accent-hi);
  stroke-width: 1.6;
  stroke-linejoin: round;
}
.tag {
  font-size: 9px;
  fill: var(--text-lo);
  font-family: var(--font-mono);
}
.cutTag {
  fill: var(--gold);
}
.legend {
  display: flex;
  justify-content: center;
  gap: 12px;
  font-size: 10px;
  color: var(--text-lo);
  margin-top: 1px;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.key {
  width: 16px;
  height: 4px;
  overflow: visible;
}
.key .ghost {
  opacity: 1;
}
.axes {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-lo);
  margin-top: 2px;
}
</style>
