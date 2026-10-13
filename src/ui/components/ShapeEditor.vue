<script setup lang="ts">
// Shape editor (docs/features/fr8.5-shape-editor.md): draw and edit shapes on the viewport.
//   Edit      the selected item's shapes only — a Path layer's polygons, a Polyline layer's lines, the runs of a Pipes
//             material or pipework layer: drag vertices (a press within GRAB px grabs one), click an edge to insert a
//             vertex, right-click or double-click a vertex to delete it, click a shape to select it
//   Polygon   click to place vertices; Enter, double-click or a click on the first vertex closes it → a new Path layer
//   Freehand  press and draw a closed shape → a new Path layer
//   Line      click to place points; Enter, double-click or a click on the last point ends it → a new Polyline layer, or a
//             new run of the selected Pipes
// Drafts are kept in texture px and converted to the destination's units on commit. Vertices snap to half pixels
// (hold Alt for free placement). The `points` text stays the source of truth; the middle button still pans.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MAX_PATH_POINTS, parsePolygons, parsePolylines } from '@/core/bitmap'
import type { SmartMaterial } from '@/core/project'
import { layerParamDefs } from '@/layers/registry'
import { getRecipe, materialOf } from '@/recipes'
import { useProjectStore } from '@/stores/project'
import { useEditorStore, type ShapeTool } from '@/stores/editor'
import { useActions } from '@/ui/actions'
import { IconLine, IconPolygon, IconTrash, IconVectorSpline } from '@tabler/icons-vue'

type Pt = [number, number]

const props = defineProps<{
  /** The selected layer or material whose shapes are edited (null: drawing only). */
  target: { kind: 'layer' | 'material'; id: string } | null
  /** The texture's rectangle on screen (CSS px, relative to the stage). */
  rect: { x: number; y: number; w: number; h: number }
  texW: number
  texH: number
  size: { w: number; h: number }
}>()

/** Screen px around a vertex that grab it (drag, delete) rather than add a vertex on the edge or select the shape. */
const GRAB = 10

const store = useProjectStore()
const editor = useEditorStore()
const act = useActions()

/** Where the selected item's shapes live, and how to write them back. */
interface Source {
  open: boolean
  fraction: boolean
  budget: number
  text: string
  /** Pipe runs: the Line tool adds runs here instead of creating a layer. */
  pipes: boolean
  write(text: string): void
}

/** A material whose controls include its shapes (e.g. Pipes' runs): edited through the control, so every layer follows. */
function materialSource(m: SmartMaterial): Source | null {
  const d = getRecipe(m.recipe)?.params.find((p) => p.bitmap === 'points' || p.bitmap === 'lines')
  if (!d) return null
  // Random layouts have no runs to edit; drawing one switches the layout to drawn runs.
  const drawn = !('layout' in m.params) || m.params.layout === 'drawn'
  return {
    open: d.bitmap === 'lines',
    fraction: true,
    budget: 512,
    text: drawn ? String(m.params[d.key] ?? '') : '',
    pipes: d.bitmap === 'lines',
    write: (text) => {
      if (!drawn) store.setMaterialParam(m.id, 'layout', 'drawn')
      store.setMaterialParam(m.id, d.key, text)
    },
  }
}

const source = computed<Source | null>(() => {
  const t = props.target
  if (!t) return null
  if (t.kind === 'material') {
    const m = store.getMaterial(t.id)
    return m ? materialSource(m) : null
  }
  const l = store.getLayer(t.id)
  const d = l && layerParamDefs(l.type).find((p) => p.bitmap === 'points' || p.bitmap === 'lines')
  if (!l || !d) return null
  const m = materialOf(store.project, l.id)
  if (m && getRecipe(m.recipe)?.params.some((p) => p.key === d.key && p.bitmap)) return materialSource(m)
  const pipes = l.type === 'pipework'
  const drawn = !pipes || l.params.layout === 'drawn'
  return {
    open: d.bitmap === 'lines',
    fraction: l.params.units === 'fraction',
    budget: d.uniform === false ? 512 : MAX_PATH_POINTS,
    text: drawn ? String(l.params[d.key] ?? '') : '',
    pipes,
    write: (text) => {
      if (!drawn) store.setLayerParam(l.id, 'layout', 'drawn')
      store.setLayerParam(l.id, d.key, text)
    },
  }
})

const open = computed(() => source.value?.open ?? false)
const fraction = computed(() => source.value?.fraction ?? false)
/** The source's shapes, in its units (px, or fractions of the texture). */
const shapes = computed<Pt[][]>(() => {
  const s = source.value
  if (!s) return []
  return (s.open ? parsePolylines(s.text) : parsePolygons(s.text)) as Pt[][]
})
const total = computed(() => shapes.value.reduce((n, p) => n + p.length, 0))
const minPoints = computed(() => (open.value ? 2 : 3))

const tool = computed<ShapeTool>({ get: () => editor.shapeTool, set: (v) => (editor.shapeTool = v) })
const selected = ref<number | null>(null)
/** The shape being drawn, in texture px. */
const draft = ref<Pt[]>([])
const hover = ref<Pt | null>(null)
let drag: { shape: number; vert: number } | null = null
let sketching = false
const svg = ref<SVGSVGElement | null>(null)

function capture(e: PointerEvent, on: boolean): void {
  try {
    if (on) svg.value?.setPointerCapture(e.pointerId)
    else svg.value?.releasePointerCapture(e.pointerId)
  } catch {
    /* not an active pointer (e.g. synthetic events) */
  }
}

watch(
  () => props.target?.id,
  () => {
    selected.value = null
  },
)

// ---------------------------------------------------------------- coordinates
const srcToPx = ([x, y]: Pt): Pt => (fraction.value ? [x * props.texW, y * props.texH] : [x, y])
const pxToSrc = ([x, y]: Pt, frac = fraction.value): Pt => (frac ? [x / props.texW, y / props.texH] : [x, y])

/** Texture px → screen. */
function pxToScreen([x, y]: Pt): Pt {
  const r = props.rect
  return [r.x + (x / props.texW) * r.w, r.y + (y / props.texH) * r.h]
}
const toScreen = (p: Pt): Pt => pxToScreen(srcToPx(p))

/** Pointer → texture px (snapped to half pixels unless Alt). */
function toPx(e: PointerEvent | MouseEvent, snap = !e.altKey): Pt {
  const b = svg.value!.getBoundingClientRect()
  const r = props.rect
  let x = ((e.clientX - b.left - r.x) / r.w) * props.texW
  let y = ((e.clientY - b.top - r.y) / r.h) * props.texH
  if (snap) {
    x = Math.round(x * 2) / 2
    y = Math.round(y * 2) / 2
  }
  return [x, y]
}

const fmt = (v: number, frac: boolean) => (frac ? String(Number(v.toFixed(4))) : String(Number(v.toFixed(2))))
const shapeText = (list: Pt[][], frac: boolean, min: number) =>
  list
    .filter((p) => p.length >= min)
    .map((p) => p.map(([x, y]) => `${fmt(x, frac)},${fmt(y, frac)}`).join(' '))
    .join('\n')

function write(next: Pt[][]): void {
  source.value?.write(shapeText(next, fraction.value, minPoints.value))
}

const copy = (): Pt[][] => shapes.value.map((p) => p.map(([x, y]) => [x, y] as Pt))
const pathD = (p: Pt[], closed: boolean, conv = toScreen) => p.map((q, i) => `${i ? 'L' : 'M'}${conv(q).join(' ')}`).join('') + (closed ? 'Z' : '')
/** Edges of a shape: (j, j + 1), and the closing one for polygons. */
const edges = (p: Pt[]) => (open.value ? p.slice(0, -1) : p).map((q, j) => [q, p[(j + 1) % p.length]] as [Pt, Pt])

// ---------------------------------------------------------------- edit
/** The vertex nearest the pointer within GRAB screen px (the selected shape's first), if any. */
function nearestVertex(e: MouseEvent): { shape: number; vert: number } | null {
  const b = svg.value!.getBoundingClientRect()
  const x = e.clientX - b.left
  const y = e.clientY - b.top
  let best: { shape: number; vert: number } | null = null
  let bestD = GRAB
  shapes.value.forEach((p, i) =>
    p.forEach((q, j) => {
      const [sx, sy] = toScreen(q)
      // The selected shape wins ties with a shape underneath.
      const d = Math.hypot(sx - x, sy - y) - (i === selected.value ? 0.5 : 0)
      if (d < bestD) {
        bestD = d
        best = { shape: i, vert: j }
      }
    }),
  )
  return best
}

function startDrag(e: PointerEvent, shape: number, vert: number): void {
  e.stopPropagation()
  e.preventDefault()
  selected.value = shape
  drag = { shape, vert }
  capture(e, true)
}

function onVertexDown(e: PointerEvent): void {
  if (tool.value !== 'edit' || e.button !== 0) return
  const v = nearestVertex(e)
  if (v) startDrag(e, v.shape, v.vert)
}

function deleteVertex(shape: number, vert: number): void {
  const next = copy()
  next[shape].splice(vert, 1)
  if (next[shape].length < minPoints.value) next.splice(shape, 1)
  write(next)
}

/** Right-click or double-click near a vertex deletes it. */
function onVertexDelete(e: MouseEvent): void {
  if (tool.value !== 'edit') return
  const v = nearestVertex(e)
  if (!v) return
  e.preventDefault()
  e.stopPropagation()
  deleteVertex(v.shape, v.vert)
}

function onEdgeDown(e: PointerEvent, shape: number, after: number): void {
  if (tool.value !== 'edit' || e.button !== 0) return
  // Near a vertex, grab it instead of inserting one beside it.
  const v = nearestVertex(e)
  if (v) return startDrag(e, v.shape, v.vert)
  if (total.value >= (source.value?.budget ?? MAX_PATH_POINTS)) return
  e.stopPropagation()
  e.preventDefault()
  const next = copy()
  next[shape].splice(after + 1, 0, pxToSrc(toPx(e)))
  write(next)
  selected.value = shape
  drag = { shape, vert: after + 1 }
  capture(e, true)
}

function onShapeDown(e: PointerEvent, shape: number): void {
  if (tool.value !== 'edit' || e.button !== 0) return
  const v = nearestVertex(e)
  if (v) return startDrag(e, v.shape, v.vert)
  e.stopPropagation()
  selected.value = shape
}

// ---------------------------------------------------------------- drawing
/** Drop repeated points (a double-click places its point twice). */
const dedupe = (pts: Pt[]) => pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1])

/** Finish the draft: a new Path or Polyline layer, or a new run of the selected pipes. */
function commit(): void {
  const pts = dedupe(draft.value)
  const kind = tool.value
  draft.value = []
  hover.value = null
  if (kind === 'line') {
    if (pts.length < 2) return
    const s = source.value
    if (s?.pipes) {
      const run = shapeText([pts.map((p) => pxToSrc(p, s.fraction))], s.fraction, 2)
      s.write(s.text.trim() ? `${s.text.trim()}\n${run}` : run)
      selected.value = shapes.value.length - 1
    } else void act.addShapeLayer('polyline', shapeText([pts], false, 2))
  } else {
    if (pts.length < 3) return
    void act.addShapeLayer('path', shapeText([pts], false, 3))
  }
  tool.value = 'edit'
}

function onCaptureDown(e: PointerEvent): void {
  // Only the left button draws: the middle button still pans the view.
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  const p = toPx(e)
  if (tool.value === 'freehand') {
    sketching = true
    draft.value = [toPx(e, false)]
    capture(e, true)
    return
  }
  const near = (q: Pt) => {
    const [ax, ay] = pxToScreen(q)
    const [bx, by] = pxToScreen(p)
    return Math.hypot(ax - bx, ay - by) < 8
  }
  // Polygon: a click on the first vertex closes it. Line: a click on the last point ends it.
  if (tool.value === 'polygon' && draft.value.length >= 3 && near(draft.value[0])) return commit()
  if (tool.value === 'line' && draft.value.length >= 2 && near(draft.value[draft.value.length - 1])) return commit()
  draft.value = [...draft.value, p]
}

function onMove(e: PointerEvent): void {
  if (drag) {
    const next = copy()
    next[drag.shape][drag.vert] = pxToSrc(toPx(e))
    write(next)
    return
  }
  if (sketching) {
    const p = toPx(e, false)
    const [ax, ay] = pxToScreen(draft.value[draft.value.length - 1])
    const [bx, by] = pxToScreen(p)
    if (Math.hypot(ax - bx, ay - by) >= 3) draft.value = [...draft.value, p]
    return
  }
  if (tool.value === 'polygon' || tool.value === 'line') hover.value = toPx(e)
}

function onUp(e: PointerEvent): void {
  if (drag) {
    drag = null
    capture(e, false)
  }
  if (sketching) {
    sketching = false
    capture(e, false)
    const simple = simplify(draft.value, MAX_PATH_POINTS)
    draft.value = simple.map(([x, y]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2] as Pt)
    commit()
  }
}

/** Ramer–Douglas–Peucker on a stroke (texture px), loosening the tolerance until it fits `budget` vertices. */
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
  for (let eps = 0.75; ; eps *= 1.4) {
    const keep = new Set([0, pts.length - 1])
    rdp(0, pts.length - 1, eps, keep)
    const out = [...keep].sort((a, b) => a - b).map((i) => pts[i])
    if (out.length <= Math.max(3, budget) || eps > 1e6) return out.slice(0, Math.max(3, budget))
  }
}

function onCaptureDbl(e: MouseEvent): void {
  e.stopPropagation()
  if (tool.value === 'polygon' || tool.value === 'line') commit()
}

// ---------------------------------------------------------------- toolbar
/** Switching tools finishes a draft that is already a shape, and drops one that isn't. */
watch(tool, (_now, before) => {
  if (draft.value.length && (before === 'polygon' || before === 'line')) {
    const keep = tool.value
    editor.shapeTool = before
    commit()
    editor.shapeTool = keep
  }
  draft.value = []
  hover.value = null
})

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
  if (e.key === 'Enter' && (tool.value === 'polygon' || tool.value === 'line') && draft.value.length) {
    e.preventDefault()
    commit()
  } else if (e.key === 'Escape' && (draft.value.length || tool.value !== 'edit')) {
    e.preventDefault()
    e.stopPropagation()
    draft.value = []
    tool.value = 'edit'
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))

const draftClosed = computed(() => tool.value === 'polygon' || tool.value === 'freehand')
const draftPath = computed(() => {
  const pts = (tool.value === 'polygon' || tool.value === 'line') && hover.value ? [...draft.value, hover.value] : draft.value
  return pathD(pts, draftClosed.value && !sketching, pxToScreen)
})
</script>

<template>
  <svg ref="svg" class="shape-editor" :width="size.w" :height="size.h" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @contextmenu="onVertexDelete">
    <!-- Drawing tools capture the whole stage (left button only). -->
    <rect v-if="tool !== 'edit'" class="capture" x="0" y="0" :width="size.w" :height="size.h" @pointerdown="onCaptureDown" @dblclick="onCaptureDbl" />
    <g v-for="(p, i) in shapes" :key="`p${i}`" :class="{ sel: selected === i, open }">
      <path :d="pathD(p, !open)" class="fill" :class="{ live: tool === 'edit' }" @pointerdown="onShapeDown($event, i)" />
      <template v-if="tool === 'edit'">
        <line
          v-for="([a, b], j) in edges(p)"
          :key="`e${j}`"
          class="edge"
          :x1="toScreen(a)[0]"
          :y1="toScreen(a)[1]"
          :x2="toScreen(b)[0]"
          :y2="toScreen(b)[1]"
          @pointerdown="onEdgeDown($event, i, j)"
        />
        <g v-for="(q, j) in p" :key="`v${j}`" class="vgrab" @pointerdown="onVertexDown" @dblclick="onVertexDelete">
          <circle class="hit" :cx="toScreen(q)[0]" :cy="toScreen(q)[1]" :r="GRAB" />
          <circle class="vertex" :class="{ end: open && (j === 0 || j === p.length - 1) }" :cx="toScreen(q)[0]" :cy="toScreen(q)[1]" r="4.5" />
        </g>
      </template>
      <path v-else :d="pathD(p, !open)" class="outline" />
    </g>
    <template v-if="draft.length">
      <path :d="draftPath" class="draft" :class="{ open: !draftClosed }" />
      <circle
        v-for="(q, j) in tool === 'freehand' ? [] : draft"
        :key="`d${j}`"
        class="vertex draftv"
        :class="{ first: tool === 'polygon' ? j === 0 : j === draft.length - 1 }"
        :cx="pxToScreen(q)[0]"
        :cy="pxToScreen(q)[1]"
        r="4"
      />
    </template>
  </svg>
  <div class="shape-tools" @pointerdown.stop>
    <button type="button" :class="{ on: tool === 'edit' }" title="Edit the selected layer's shapes: drag vertices, click an edge to add one, right-click a vertex to remove it" @click="tool = 'edit'">
      <IconPolygon :size="13" />Edit
    </button>
    <button type="button" :class="{ on: tool === 'polygon' }" title="Polygon: click to place vertices; Enter, double-click or the first vertex closes it — a new Path layer" @click="tool = 'polygon'">
      <IconLine :size="13" />Polygon
    </button>
    <button type="button" :class="{ on: tool === 'freehand' }" title="Freehand: press and draw a shape — a new Path layer" @click="tool = 'freehand'">
      <IconVectorSpline :size="13" />Freehand
    </button>
    <button
      type="button"
      :class="{ on: tool === 'line' }"
      :title="source?.pipes ? 'Line: click to place points; Enter, double-click or the last point ends it — a new run of the selected pipes' : 'Line: click to place points; Enter, double-click or the last point ends it — a new Polyline layer'"
      @click="tool = 'line'"
    >
      <IconLine :size="13" />{{ source?.pipes ? 'Pipe run' : 'Line' }}
    </button>
    <button v-if="shapes.length > 1" type="button" :disabled="selected === null" title="Delete the selected shape" @click="deleteSelected"><IconTrash :size="13" /></button>
    <span v-if="source" class="count cf-mono" :class="{ full: total >= source.budget }" title="Vertices used">{{ total }}/{{ source.budget }}</span>
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
.open .fill {
  fill: none;
  stroke: rgba(246, 110, 16, 0.35);
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.open .fill.live {
  pointer-events: stroke;
}
.sel.open .fill {
  stroke: rgba(246, 110, 16, 0.55);
}
.vertex.end {
  fill: var(--text-hi);
}
.draft.open {
  fill: none;
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
