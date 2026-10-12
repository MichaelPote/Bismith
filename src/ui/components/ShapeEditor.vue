<script setup lang="ts">
// Shape editor (docs/features/fr8.5-shape-editor.md): edit a Path layer's polygons on the viewport.
//   Edit      drag vertices (a press within GRAB px of one grabs it, wherever it lands) · click an edge away from the
//             vertices to insert one · right-click or double-click a vertex to delete it · click a shape to select it
//   Polygon   click to place vertices; Enter, double-click or a click on the first vertex closes the shape
//   Freehand  press and draw; the stroke is simplified to fit the vertex budget
// Vertices snap to half pixels (hold Alt for free placement). The layer's `points` text stays the source of truth.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MAX_PATH_POINTS, parsePolygons } from '@/core/bitmap'
import { useProjectStore } from '@/stores/project'
import Icon from '@/ui/components/Icon.vue'

type Pt = [number, number]
type Mode = 'edit' | 'polygon' | 'freehand'

const props = defineProps<{
  layerId: string
  /** The texture's rectangle on screen (CSS px, relative to the stage). */
  rect: { x: number; y: number; w: number; h: number }
  texW: number
  texH: number
  size: { w: number; h: number }
}>()

/** Screen px around a vertex that grab it (drag, delete) rather than add a vertex on the edge or select the shape. */
const GRAB = 10

const store = useProjectStore()
const layer = computed(() => store.getLayer(props.layerId))
const fraction = computed(() => layer.value?.params.units === 'fraction')
const polys = computed<Pt[][]>(() => parsePolygons(String(layer.value?.params.points ?? '')) as Pt[][])
const total = computed(() => polys.value.reduce((n, p) => n + p.length, 0))

/** A Path layer without shapes yet opens ready to place vertices. */
const startMode = (): Mode => (total.value === 0 ? 'polygon' : 'edit')
const mode = ref<Mode>(startMode())
const selected = ref<number | null>(null)
const draft = ref<Pt[]>([])
const hover = ref<Pt | null>(null)
let drag: { poly: number; vert: number } | null = null
let sketching = false
const svg = ref<SVGSVGElement | null>(null)

function capture(e: PointerEvent, on: boolean): void {
  try {
    if (on) svg.value?.setPointerCapture(e.pointerId)
    else capture(e, false)
  } catch {
    /* not an active pointer (e.g. synthetic events) */
  }
}

watch(
  () => props.layerId,
  () => {
    draft.value = []
    selected.value = null
    mode.value = startMode()
  },
)

// ---------------------------------------------------------------- coordinates
/** Texture units (px from the top-left, or 0..1 with Units = fraction) → screen. */
function toScreen([x, y]: Pt): Pt {
  const r = props.rect
  const fx = fraction.value ? x : x / props.texW
  const fy = fraction.value ? y : y / props.texH
  return [r.x + fx * r.w, r.y + fy * r.h]
}

function toTex(e: PointerEvent | MouseEvent, snap = !e.altKey): Pt {
  const b = svg.value!.getBoundingClientRect()
  const r = props.rect
  const fx = (e.clientX - b.left - r.x) / r.w
  const fy = (e.clientY - b.top - r.y) / r.h
  let x = fx * props.texW
  let y = fy * props.texH
  if (snap) {
    x = Math.round(x * 2) / 2
    y = Math.round(y * 2) / 2
  }
  return fraction.value ? [x / props.texW, y / props.texH] : [x, y]
}

const fmt = (v: number) => (fraction.value ? String(Number(v.toFixed(4))) : String(Number(v.toFixed(2))))

function write(next: Pt[][]): void {
  const text = next
    .filter((p) => p.length >= 3)
    .map((p) => p.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' '))
    .join('\n')
  store.setLayerParam(props.layerId, 'points', text)
}

const copy = (): Pt[][] => polys.value.map((p) => p.map(([x, y]) => [x, y] as Pt))
const pathD = (p: Pt[], closed = true) => p.map((q, i) => `${i ? 'L' : 'M'}${toScreen(q).join(' ')}`).join('') + (closed ? 'Z' : '')

// ---------------------------------------------------------------- edit mode
/** The vertex nearest the pointer within GRAB screen px (the selected shape's first), if any. */
function nearestVertex(e: MouseEvent): { poly: number; vert: number } | null {
  const b = svg.value!.getBoundingClientRect()
  const x = e.clientX - b.left
  const y = e.clientY - b.top
  let best: { poly: number; vert: number } | null = null
  let bestD = GRAB
  polys.value.forEach((p, i) =>
    p.forEach((q, j) => {
      const [sx, sy] = toScreen(q)
      // The selected shape wins ties with a shape underneath.
      const d = Math.hypot(sx - x, sy - y) - (i === selected.value ? 0.5 : 0)
      if (d < bestD) {
        bestD = d
        best = { poly: i, vert: j }
      }
    }),
  )
  return best
}

function startDrag(e: PointerEvent, poly: number, vert: number): void {
  e.stopPropagation()
  e.preventDefault()
  selected.value = poly
  drag = { poly, vert }
  capture(e, true)
}

function onVertexDown(e: PointerEvent): void {
  if (mode.value !== 'edit' || e.button !== 0) return
  const v = nearestVertex(e)
  if (v) startDrag(e, v.poly, v.vert)
}

function deleteVertex(poly: number, vert: number): void {
  const next = copy()
  next[poly].splice(vert, 1)
  if (next[poly].length < 3) next.splice(poly, 1)
  write(next)
}

/** Right-click or double-click near a vertex deletes it. */
function onVertexDelete(e: MouseEvent): void {
  if (mode.value !== 'edit') return
  const v = nearestVertex(e)
  if (!v) return
  e.preventDefault()
  e.stopPropagation()
  deleteVertex(v.poly, v.vert)
}

function onEdgeDown(e: PointerEvent, poly: number, after: number): void {
  if (mode.value !== 'edit' || e.button !== 0) return
  // Near a vertex, grab it instead of inserting one beside it.
  const v = nearestVertex(e)
  if (v) return startDrag(e, v.poly, v.vert)
  if (total.value >= MAX_PATH_POINTS) return
  e.stopPropagation()
  e.preventDefault()
  const next = copy()
  next[poly].splice(after + 1, 0, toTex(e))
  write(next)
  selected.value = poly
  drag = { poly, vert: after + 1 }
  capture(e, true)
}

function onShapeDown(e: PointerEvent, poly: number): void {
  if (mode.value !== 'edit' || e.button !== 0) return
  const v = nearestVertex(e)
  if (v) return startDrag(e, v.poly, v.vert)
  e.stopPropagation()
  selected.value = poly
}

// ---------------------------------------------------------------- drawing
function onCaptureDown(e: PointerEvent): void {
  e.stopPropagation()
  e.preventDefault()
  const p = toTex(e)
  if (mode.value === 'freehand') {
    if (total.value + 3 > MAX_PATH_POINTS) return
    sketching = true
    draft.value = [toTex(e, false)]
    capture(e, true)
    return
  }
  // Polygon: a click near the first vertex closes the shape.
  if (draft.value.length >= 3) {
    const [fx, fy] = toScreen(draft.value[0])
    const [px, py] = toScreen(p)
    if (Math.hypot(fx - px, fy - py) < 8) return closeDraft()
  }
  if (total.value + draft.value.length >= MAX_PATH_POINTS) return
  draft.value = [...draft.value, p]
}

function onMove(e: PointerEvent): void {
  if (drag) {
    const next = copy()
    next[drag.poly][drag.vert] = toTex(e)
    write(next)
    return
  }
  if (sketching) {
    const p = toTex(e, false)
    const last = draft.value[draft.value.length - 1]
    const [ax, ay] = toScreen(last)
    const [bx, by] = toScreen(p)
    if (Math.hypot(ax - bx, ay - by) >= 3) draft.value = [...draft.value, p]
    return
  }
  if (mode.value === 'polygon') hover.value = toTex(e)
}

function onUp(e: PointerEvent): void {
  if (drag) {
    drag = null
    capture(e, false)
  }
  if (sketching) {
    sketching = false
    capture(e, false)
    const budget = MAX_PATH_POINTS - total.value
    const simple = simplify(draft.value, budget)
    draft.value = []
    if (simple.length >= 3) {
      const snapped = simple.map(([x, y]) => (fraction.value ? [x, y] : [Math.round(x * 2) / 2, Math.round(y * 2) / 2]) as Pt)
      write([...copy(), snapped])
      selected.value = polys.value.length - 1
    }
  }
}

function closeDraft(): void {
  if (draft.value.length >= 3) {
    write([...copy(), draft.value])
    selected.value = polys.value.length - 1
  }
  draft.value = []
  hover.value = null
}

/** Ramer–Douglas–Peucker on a closed stroke, loosening the tolerance until it fits `budget` vertices. */
function simplify(pts: Pt[], budget: number): Pt[] {
  if (pts.length <= 3) return pts
  const rdp = (a: number, b: number, eps: number, keep: Set<number>) => {
    let best = -1
    let far = 0
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const len = Math.hypot(bx - ax, by - ay) || 1e-9
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len
      if (d > far) {
        far = d
        best = i
      }
    }
    if (far > eps && best > 0) {
      keep.add(best)
      rdp(a, best, eps, keep)
      rdp(best, b, eps, keep)
    }
  }
  const unit = fraction.value ? 1 / Math.max(props.texW, props.texH) : 1
  for (let eps = 0.75 * unit; ; eps *= 1.4) {
    const keep = new Set([0, pts.length - 1])
    rdp(0, pts.length - 1, eps, keep)
    const out = [...keep].sort((a, b) => a - b).map((i) => pts[i])
    if (out.length <= Math.max(3, budget) || eps > 1e6) return out.slice(0, Math.max(3, budget))
  }
}

function onCaptureDbl(e: MouseEvent): void {
  e.stopPropagation()
  if (mode.value === 'polygon') closeDraft()
}

// ---------------------------------------------------------------- toolbar
function setMode(m: Mode): void {
  if (mode.value === 'polygon' && m !== 'polygon') closeDraft()
  mode.value = m
}

function deleteSelected(): void {
  if (selected.value === null) return
  const next = copy()
  next.splice(selected.value, 1)
  selected.value = null
  write(next)
}

function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
  if (e.key === 'Enter' && mode.value === 'polygon') {
    e.preventDefault()
    closeDraft()
  } else if (e.key === 'Escape' && (draft.value.length || mode.value !== 'edit')) {
    e.preventDefault()
    e.stopPropagation()
    draft.value = []
    mode.value = 'edit'
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <svg ref="svg" class="shape-editor" :width="size.w" :height="size.h" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @contextmenu="onVertexDelete">
    <!-- Drawing modes capture the whole stage. -->
    <rect v-if="mode !== 'edit'" class="capture" x="0" y="0" :width="size.w" :height="size.h" @pointerdown="onCaptureDown" @dblclick="onCaptureDbl" />
    <g v-for="(p, i) in polys" :key="`p${i}`" :class="{ sel: selected === i }">
      <path :d="pathD(p)" class="fill" :class="{ live: mode === 'edit' }" @pointerdown="onShapeDown($event, i)" />
      <template v-if="mode === 'edit'">
        <line
          v-for="(q, j) in p"
          :key="`e${j}`"
          class="edge"
          :x1="toScreen(q)[0]"
          :y1="toScreen(q)[1]"
          :x2="toScreen(p[(j + 1) % p.length])[0]"
          :y2="toScreen(p[(j + 1) % p.length])[1]"
          @pointerdown="onEdgeDown($event, i, j)"
        />
        <g v-for="(q, j) in p" :key="`v${j}`" class="vgrab" @pointerdown="onVertexDown" @dblclick="onVertexDelete">
          <circle class="hit" :cx="toScreen(q)[0]" :cy="toScreen(q)[1]" :r="GRAB" />
          <circle class="vertex" :cx="toScreen(q)[0]" :cy="toScreen(q)[1]" r="4.5" />
        </g>
      </template>
      <path v-else :d="pathD(p)" class="outline" />
    </g>
    <template v-if="draft.length">
      <path :d="pathD(mode === 'polygon' && hover ? [...draft, hover] : draft, mode === 'freehand')" class="draft" />
      <circle v-for="(q, j) in mode === 'polygon' ? draft : []" :key="`d${j}`" class="vertex draftv" :class="{ first: j === 0 }" :cx="toScreen(q)[0]" :cy="toScreen(q)[1]" r="4" />
    </template>
  </svg>
  <div class="shape-tools" @pointerdown.stop>
    <button type="button" :class="{ on: mode === 'edit' }" title="Edit: drag vertices, click an edge to add one, right-click a vertex to remove it" @click="setMode('edit')">
      <Icon name="polygon" :size="13" />Edit
    </button>
    <button type="button" :class="{ on: mode === 'polygon' }" title="Polygon: click to place vertices; Enter, double-click or the first vertex closes it" @click="setMode('polygon')">
      <Icon name="line" :size="13" />Polygon
    </button>
    <button type="button" :class="{ on: mode === 'freehand' }" title="Freehand: press and draw" @click="setMode('freehand')">
      <Icon name="curve" :size="13" />Freehand
    </button>
    <button type="button" :disabled="selected === null" title="Delete the selected shape" @click="deleteSelected"><Icon name="trash" :size="13" /></button>
    <span class="count cf-mono" :class="{ full: total >= MAX_PATH_POINTS }" title="Vertices used (all shapes share the budget)">{{ total }}/{{ MAX_PATH_POINTS }}</span>
  </div>
</template>

<style scoped>
.shape-editor {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.capture {
  fill: transparent;
  pointer-events: all;
  cursor: crosshair;
}
.fill {
  fill: rgba(246, 110, 16, 0.08);
  stroke: none;
}
.fill.live {
  pointer-events: fill;
  cursor: pointer;
}
.sel .fill {
  fill: rgba(246, 110, 16, 0.16);
}
.outline {
  fill: none;
  stroke: var(--text-hi);
  stroke-width: 1;
  opacity: 0.7;
}
.edge {
  stroke: var(--text-hi);
  stroke-width: 1.25;
  pointer-events: stroke;
  cursor: copy;
}
.edge:hover {
  stroke: var(--accent-hi);
  stroke-width: 3;
}
.sel .edge {
  stroke: var(--accent-hi);
}
.vgrab {
  cursor: move;
}
.hit {
  fill: transparent;
  stroke: none;
  pointer-events: all;
}
.vertex {
  fill: rgba(23, 25, 28, 0.8);
  stroke: var(--text-hi);
  stroke-width: 1.5;
  pointer-events: none;
}
.sel .vertex {
  stroke: var(--accent-hi);
}
.vgrab:hover .vertex {
  fill: var(--accent-hi);
}
.draft {
  fill: rgba(246, 110, 16, 0.08);
  stroke: var(--accent-hi);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
  pointer-events: none;
}
.draftv {
  pointer-events: none;
}
.draftv.first {
  fill: var(--accent-hi);
}
.shape-tools {
  position: absolute;
  left: 12px;
  top: 44px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: rgba(23, 25, 28, 0.88);
  border: 1px solid var(--hairline);
  border-radius: 6px;
  z-index: 3;
}
.shape-tools button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--text);
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}
.shape-tools button:hover {
  background: var(--sunken);
}
.shape-tools button.on {
  color: var(--accent-hi);
  background: var(--sunken);
}
.shape-tools button:disabled {
  opacity: 0.35;
  cursor: default;
}
.count {
  font-size: 11px;
  color: var(--text-lo);
  padding: 0 6px;
}
.count.full {
  color: var(--accent-hi);
}
</style>
