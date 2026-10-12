<script setup lang="ts">
// The centre view: owns the Engine, the canvas, zoom/pan, channel views and light gizmos.
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { Engine } from '@/render/engine'
import { GpuError } from '@/gpu/context'
import { CHANNEL_VIEWS } from '@/render/display'
import Icon from '@/ui/components/Icon.vue'
import ShapeEditor from '@/ui/components/ShapeEditor.vue'
import SelectField from '@/ui/components/SelectField.vue'
import { vTip } from '@/ui/tooltip'
import { layerParamDefs } from '@/layers/registry'
import { linearToSrgb1, rgbToHex } from '@/core/color'

const store = useProjectStore()
const editor = useEditorStore()

const wrap = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const cssSize = ref({ w: 1, h: 1 })
const dpr = ref(window.devicePixelRatio || 1)
const cursor = ref<{ x: number; y: number } | null>(null)
let engine: Engine | null = null
let ro: ResizeObserver | null = null

const ZOOMS = [0.125, 0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64]

const project = computed(() => store.project)

const previewUpTo = computed(() => {
  if (!editor.solo || editor.selection.kind !== 'layer') return null
  const i = store.project.layers.findIndex((l) => l.id === editor.selection.id)
  return i >= 0 ? i : null
})

function pushView(): void {
  engine?.setView({
    channel: editor.channel,
    transform: { zoom: editor.zoom, offsetX: editor.offsetX, offsetY: editor.offsetY },
    options: { tile: editor.tile, grid: editor.grid, checker: editor.checker },
    previewUpTo: previewUpTo.value,
  })
}

function fit(): void {
  const p = store.project
  const span = editor.tile ? 3 : 1
  const availW = cssSize.value.w * dpr.value * 0.88
  const availH = (cssSize.value.h - 72) * dpr.value * 0.88
  const ideal = Math.min(availW / (p.width * span), availH / (p.height * span))
  const z = [...ZOOMS].reverse().find((s) => s <= ideal) ?? ZOOMS[0]
  editor.zoom = z
  centre()
}

function centre(): void {
  const p = store.project
  editor.offsetX = Math.round((cssSize.value.w * dpr.value - p.width * editor.zoom) / 2)
  editor.offsetY = Math.round((cssSize.value.h * dpr.value - p.height * editor.zoom) / 2 + 18 * dpr.value)
}

function zoomAt(newZoom: number, cx: number, cy: number): void {
  // cx, cy in device px relative to the canvas.
  const z0 = editor.zoom
  const tx = (cx - editor.offsetX) / z0
  const ty = (cy - editor.offsetY) / z0
  editor.zoom = newZoom
  editor.offsetX = Math.round(cx - tx * newZoom)
  editor.offsetY = Math.round(cy - ty * newZoom)
}

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const rect = canvas.value!.getBoundingClientRect()
  const cx = (e.clientX - rect.left) * dpr.value
  const cy = (e.clientY - rect.top) * dpr.value
  const i = ZOOMS.findIndex((z) => z >= editor.zoom - 1e-6)
  const cur = i < 0 ? ZOOMS.length - 1 : i
  const next = e.deltaY < 0 ? Math.min(ZOOMS.length - 1, cur + 1) : Math.max(0, cur - 1)
  zoomAt(ZOOMS[next], cx, cy)
}

let panning: { x: number; y: number; ox: number; oy: number; id: number } | null = null
function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 && e.button !== 1) return
  e.preventDefault()
  panning = { x: e.clientX, y: e.clientY, ox: editor.offsetX, oy: editor.offsetY, id: e.pointerId }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent): void {
  const rect = canvas.value!.getBoundingClientRect()
  const tx = ((e.clientX - rect.left) * dpr.value - editor.offsetX) / editor.zoom
  const ty = ((e.clientY - rect.top) * dpr.value - editor.offsetY) / editor.zoom
  const p = store.project
  cursor.value = tx >= 0 && ty >= 0 && tx < p.width && ty < p.height ? { x: Math.floor(tx), y: Math.floor(ty) } : null
  probeCursor()
  if (panning && panning.id === e.pointerId) {
    editor.offsetX = Math.round(panning.ox + (e.clientX - panning.x) * dpr.value)
    editor.offsetY = Math.round(panning.oy + (e.clientY - panning.y) * dpr.value)
  }
}
function onPointerUp(e: PointerEvent): void {
  if (panning?.id === e.pointerId) panning = null
}

// ---------------------------------------------------------------- texel probe (throttled)
const probe = ref<{ h: number; r: number; hex: string; e: number; sdf: number } | null>(null)
let probeAt = 0
function probeCursor(): void {
  const c = cursor.value
  const now = performance.now()
  if (!c || !engine) {
    probe.value = null
    return
  }
  if (now - probeAt < 60) return
  probeAt = now
  const k = engine.supersample
  const v = engine.material.probe(c.x * k + (k >> 1), c.y * k + (k >> 1))
  if (!v) return
  const srgb = Array.from(v.albedo.slice(0, 3)).map((x) => linearToSrgb1(Math.min(1, Math.max(0, x))))
  probe.value = {
    h: v.surface[0],
    r: v.surface[1],
    hex: rgbToHex(srgb as [number, number, number]),
    e: Math.max(v.emissive[0], v.emissive[1], v.emissive[2]),
    sdf: v.surface[3],
  }
}

// ---------------------------------------------------------------- light gizmos
const texRect = computed(() => {
  const p = project.value
  return {
    x: editor.offsetX / dpr.value,
    y: editor.offsetY / dpr.value,
    w: (p.width * editor.zoom) / dpr.value,
    h: (p.height * editor.zoom) / dpr.value,
  }
})

const gizmos = computed(() => {
  const r = texRect.value
  return project.value.lighting.lights
    .filter((l) => l.enabled)
    .map((l) => {
      const sel = editor.selection.kind === 'light' && editor.selection.id === l.id
      if (l.type === 'point') {
        return { id: l.id, type: 'point' as const, sel, color: String(l.params.color), x: r.x + Number(l.params.x) * r.w, y: r.y + Number(l.params.y) * r.h }
      }
      const az = (Number(l.params.azimuth) * Math.PI) / 180
      const cx = r.x + r.w / 2
      const cy = r.y + r.h / 2
      const len = Math.max(40, Math.min(r.w, r.h) / 2 + 26)
      return { id: l.id, type: 'directional' as const, sel, color: String(l.params.color), cx, cy, x: cx + Math.sin(az) * len, y: cy - Math.cos(az) * len }
    })
})

// ---------------------------------------------------------------- shape editor (Path layers)
/** The selected layer when it has editable polygons (a `points` param). */
const shapeLayer = computed(() => {
  const s = editor.selection
  if (s.kind !== 'layer' || !s.id) return null
  const l = store.getLayer(s.id)
  return l && layerParamDefs(l.type).some((d) => d.bitmap === 'points') ? l : null
})

const CHANNEL_OPTIONS = CHANNEL_VIEWS.map((c) => ({ value: c.id, label: `${c.label} · ${c.key.toUpperCase()}` }))

/** Channel key labels for a narrow viewport (the tooltip keeps the full name). */
const SHORT: Record<string, string> = {
  final: 'Fin', diffuse: 'Dif', height: 'Hgt', roughness: 'Rgh', specular: 'Spc', normal: 'Nrm', ao: 'AO', emissive: 'Emi', opacity: 'Opa', register: 'SDF', masks: 'Msk',
}

/** Viewport overlays: toggle keys that latch, with a pilot lamp. */
const toggles = computed(() => [
  { label: 'Preview up to selected layer', tip: 'Preview up to the selected layer (S)', icon: 'layers', on: editor.solo, flip: () => (editor.solo = !editor.solo) },
  { label: 'Tile preview', tip: 'Tile preview, 3×3 (T)', icon: 'tile', on: editor.tile, flip: () => (editor.tile = !editor.tile) },
  { label: 'Pixel grid', tip: 'Pixel grid (G)', icon: 'grid', on: editor.grid, flip: () => (editor.grid = !editor.grid) },
  { label: 'Alpha checkerboard', tip: 'Alpha checkerboard', icon: 'checker', on: editor.checker, flip: () => (editor.checker = !editor.checker) },
])

let gizmoDrag: { id: string; type: 'point' | 'directional' } | null = null
function onGizmoDown(e: PointerEvent, g: { id: string; type: 'point' | 'directional' }): void {
  e.stopPropagation()
  e.preventDefault()
  editor.select('light', g.id)
  gizmoDrag = g
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
}
function onGizmoMove(e: PointerEvent): void {
  if (!gizmoDrag) return
  const rect = wrap.value!.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  const r = texRect.value
  if (gizmoDrag.type === 'point') {
    store.setLightParam(gizmoDrag.id, 'x', Number(((px - r.x) / r.w).toFixed(4)))
    store.setLightParam(gizmoDrag.id, 'y', Number(((py - r.y) / r.h).toFixed(4)))
  } else {
    const dx = px - (r.x + r.w / 2)
    const dy = py - (r.y + r.h / 2)
    let az = (Math.atan2(dx, -dy) * 180) / Math.PI
    if (az < 0) az += 360
    store.setLightParam(gizmoDrag.id, 'azimuth', Math.round(az))
  }
}
function onGizmoUp(e: PointerEvent): void {
  if (!gizmoDrag) return
  ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
  gizmoDrag = null
}

// ---------------------------------------------------------------- status
const stats = computed(() => editor.stats)
const progress = computed(() => (stats.value ? Math.min(1, stats.value.samples / Math.max(1, stats.value.maxSamples)) : 0))
const errorList = computed(() => Object.entries(stats.value?.errors ?? {}))
const zoomLabel = computed(() => (editor.zoom >= 1 ? `${editor.zoom}×` : `1/${Math.round(1 / editor.zoom)}`))

// ---------------------------------------------------------------- lifecycle
let lastStats = 0
onMounted(() => {
  try {
    engine = new Engine(canvas.value!)
  } catch (e) {
    editor.engineError = e instanceof GpuError ? e.message : `Renderer failed to start: ${e instanceof Error ? e.message : e}`
    return
  }
  editor.setEngine(engine)
  // Dev-only handle for scripted UI tests (tools/shot.ts --eval).
  if (import.meta.env.DEV) (window as unknown as { __bismithEngine?: Engine }).__bismithEngine = engine
  engine.onStats = (s) => {
    const now = performance.now()
    if (now - lastStats > 120 || s.samples >= s.maxSamples) {
      lastStats = now
      editor.stats = { ...s }
    }
  }
  ro = new ResizeObserver(() => {
    const el = wrap.value!
    dpr.value = window.devicePixelRatio || 1
    const first = cssSize.value.w <= 1
    cssSize.value = { w: el.clientWidth, h: el.clientHeight }
    engine!.resize(el.clientWidth * dpr.value, el.clientHeight * dpr.value)
    if (first) fit()
    pushView()
  })
  ro.observe(wrap.value!)
  engine.setProject(toRaw(store.project))
  pushView()
  engine.start()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  editor.setEngine(null)
  engine?.dispose()
  engine = null
})

watch(
  () => store.project,
  (p) => engine?.setProject(toRaw(p)),
  { deep: true },
)
watch(
  () => [editor.channel, editor.zoom, editor.offsetX, editor.offsetY, editor.tile, editor.grid, editor.checker, previewUpTo.value],
  pushView,
)
watch(() => editor.fitRequest, fit)
watch(
  () => [store.project.width, store.project.height, editor.tile, store.generation],
  () => fit(),
)
</script>

<template>
  <section class="viewport cf-panel">
    <div
      ref="wrap"
      class="stage"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="cursor = null"
      @dblclick="fit"
    >
      <canvas ref="canvas" class="canvas" />
      <svg class="gizmos" :width="cssSize.w" :height="cssSize.h" @pointermove="onGizmoMove" @pointerup="onGizmoUp">
        <template v-for="g in gizmos" :key="g.id">
          <g v-if="g.type === 'point'" class="gizmo" :class="{ sel: g.sel }" @pointerdown="onGizmoDown($event, g)">
            <circle :cx="g.x" :cy="g.y" r="11" class="ring" />
            <circle :cx="g.x" :cy="g.y" r="5" :fill="g.color" class="core" />
          </g>
          <g v-else class="gizmo" :class="{ sel: g.sel }">
            <line :x1="g.cx" :y1="g.cy" :x2="g.x" :y2="g.y" class="ray" />
            <g @pointerdown="onGizmoDown($event, g)">
              <circle :cx="g.x" :cy="g.y" r="11" class="ring" />
              <circle :cx="g.x" :cy="g.y" r="5" :fill="g.color" class="core" />
              <path
                :d="`M${g.x - 15} ${g.y}h-4M${g.x + 15} ${g.y}h4M${g.x} ${g.y - 15}v-4M${g.x} ${g.y + 15}v4`"
                class="rays"
              />
            </g>
          </g>
        </template>
      </svg>
      <ShapeEditor v-if="shapeLayer" :key="shapeLayer.id" :layer-id="shapeLayer.id" :rect="texRect" :tex-w="project.width" :tex-h="project.height" :size="cssSize" />
    </div>

    <div class="header">
      <div class="channels fk-rail" role="tablist" aria-label="Channel">
        <button
          v-for="c in CHANNEL_VIEWS"
          :key="c.id"
          v-tip:bottom="`${c.label} · key ${c.key.toUpperCase()}`"
          type="button"
          role="tab"
          class="fk"
          :class="{ lit: editor.channel === c.id }"
          :aria-selected="editor.channel === c.id"
          @click="editor.channel = c.id"
        >
          <span class="fk-face"><span class="lbl full">{{ c.label }}</span><span class="lbl short">{{ SHORT[c.id] ?? c.label }}</span></span>
        </button>
      </div>
      <SelectField class="ch-select" :model-value="editor.channel" :options="CHANNEL_OPTIONS" label="Channel" @update:model-value="editor.channel = $event as typeof editor.channel" />
      <div class="tools">
        <button
          v-for="t in toggles"
          :key="t.label"
          v-tip:bottom="t.tip"
          type="button"
          class="fk toggle"
          :class="{ latched: t.on }"
          :aria-label="t.label"
          :aria-pressed="t.on"
          @click="t.flip()"
        >
          <span class="fk-face"><Icon :name="t.icon" :size="14" /><span class="fk-lamp" /></span>
        </button>
        <div class="vsep" />
        <button v-tip:bottom="'Fit to view (F)'" type="button" class="cf-ico-btn" aria-label="Fit to view" @click="fit"><Icon name="fit" :size="14" /></button>
        <span class="chip cf-mono">{{ zoomLabel }}</span>
      </div>
    </div>

    <div class="readout cf-mono">
      <div>{{ project.width }}×{{ project.height }} px<span v-if="project.tileable"> · tileable</span></div>
      <div v-if="cursor">
        cursor <span class="hi">x {{ cursor.x }} y {{ cursor.y }}</span>
        <template v-if="probe">
          · <span class="sw" :style="{ background: probe.hex }" /> <span class="hi">{{ probe.hex }}</span> · h <span class="hi">{{ probe.h.toFixed(3) }}</span> · r
          <span class="hi">{{ probe.r.toFixed(2) }}</span><template v-if="probe.e > 0"> · e <span class="hi">{{ probe.e.toFixed(2) }}</span></template
          ><template v-if="probe.sdf < 5000"> · sdf <span class="hi">{{ probe.sdf.toFixed(1) }}</span></template>
        </template>
      </div>
      <div v-else-if="stats">height <span class="hi">{{ stats.heightMin.toFixed(2) }} … {{ stats.heightMax.toFixed(2) }} px</span></div>
    </div>

    <div v-if="stats" class="status" :class="{ done: progress >= 1 }">
      <Icon name="bolt" :size="14" :stroke="progress >= 1 ? 'var(--pill)' : 'var(--accent-hi)'" />
      <span class="txt">{{ stats.draft ? 'Draft' : progress >= 1 ? 'Converged' : 'Tracing' }} · <span class="cf-mono">{{ stats.samples }}/{{ stats.maxSamples }} spp</span></span>
      <span v-if="progress < 1" class="cf-mono lo">{{ stats.samplesPerSec }}/s</span>
      <div class="bar"><div :style="{ width: `${progress * 100}%` }" /></div>
    </div>

    <div v-if="errorList.length" class="errors">
      <div v-for="[id, msg] in errorList.slice(0, 3)" :key="id" class="error"><b>Shader error</b> <span class="cf-mono">{{ msg.slice(0, 220) }}</span></div>
    </div>

    <div v-if="editor.engineError" class="fatal">
      <div class="fatal-title">The renderer could not start</div>
      <div>{{ editor.engineError }}</div>
      <div class="lo">Bismith needs WebGL2 with float render targets (any recent desktop browser with hardware acceleration enabled).</div>
    </div>
  </section>
</template>

<style scoped>
.viewport {
  position: relative;
  overflow: hidden;
  background: var(--void);
}
.stage {
  position: absolute;
  inset: 0;
  cursor: grab;
  touch-action: none;
}
.stage:active {
  cursor: grabbing;
}
.canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  image-rendering: pixelated;
}
.gizmos {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.gizmo {
  pointer-events: auto;
  cursor: move;
}
.gizmo .ring {
  fill: rgba(23, 25, 28, 0.55);
  stroke: var(--text-hi);
  stroke-width: 1.5;
}
.gizmo .core {
  stroke: var(--deep);
  stroke-width: 1;
}
.gizmo .ray {
  stroke: var(--text-hi);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  opacity: 0.6;
  pointer-events: none;
}
.gizmo .rays {
  stroke: var(--text-hi);
  stroke-width: 1.5;
}
.gizmo.sel .ring,
.gizmo.sel .rays {
  stroke: var(--accent-hi);
  filter: drop-shadow(0 0 4px rgba(246, 110, 16, 0.7));
}
.header {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
  background: rgba(36, 40, 44, 0.92);
  border-bottom: 1px solid var(--hairline);
  user-select: none;
  -webkit-user-select: none;
  container-type: inline-size;
}
/* Channel keys shrink (labels ellipsised) rather than scroll when the viewport is narrow. */
.channels {
  flex: 0 1 auto;
  min-width: 0;
}
.channels .fk {
  height: 24px;
  flex: 0 1 auto;
  min-width: 26px;
}
.channels .fk-face {
  padding: 0 8px;
  min-width: 0;
}
.channels .lbl {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.channels .fk.lit .fk-face {
  font-weight: 500;
}
.channels .lbl.short {
  display: none;
}
/* Too narrow for the full names: three-letter keys (then ellipsis as a last resort). */
@container (max-width: 960px) {
  .channels .lbl.full {
    display: none;
  }
  .channels .lbl.short {
    display: inline;
  }
  .channels .fk-face {
    padding: 0 6px;
  }
}
/* Narrower still: a dropdown (the wheel steps through the views). */
.ch-select {
  display: none;
  width: 150px;
  flex: none;
}
@container (max-width: 720px) {
  .channels {
    display: none;
  }
  .ch-select {
    display: block;
  }
}
.tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 3px;
  flex: none;
}
.fk.toggle {
  width: 28px;
  height: 24px;
}
.fk.toggle .fk-face {
  padding: 0;
}
.vsep {
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: var(--hairline);
}
.chip {
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  margin-left: 4px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  background: var(--sunken);
  font-size: 12px;
  color: var(--pill);
}
.readout {
  position: absolute;
  left: 12px;
  bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--text-lo);
  pointer-events: none;
}
.readout .hi {
  color: var(--pill);
}
.readout .sw {
  display: inline-block;
  width: 9px;
  height: 9px;
  border: 1px solid var(--line);
  vertical-align: -1px;
}
.status {
  position: absolute;
  right: 12px;
  bottom: 10px;
  display: grid;
  grid-template-columns: auto auto auto;
  align-items: center;
  gap: 4px 10px;
  padding: 7px 12px 8px;
  border: 1px solid var(--line);
  border-left: 2px solid var(--accent);
  border-radius: var(--r-field);
  background: rgba(44, 49, 54, 0.95);
  font-size: 12px;
  color: var(--text-hi);
  pointer-events: none;
}
.status.done {
  border-left-color: var(--pill);
}
.status .lo {
  color: var(--text-lo);
  font-size: 11px;
}
.status .bar {
  grid-column: 1 / -1;
  height: 2px;
  background: var(--hairline);
}
.status .bar > div {
  height: 100%;
  background: var(--e400);
}
.status.done .bar > div {
  background: var(--pill);
}
.errors {
  position: absolute;
  left: 12px;
  right: 12px;
  top: 40px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  pointer-events: none;
}
.error {
  padding: 6px 10px;
  border: 1px solid var(--blood);
  border-left-width: 2px;
  background: rgba(30, 33, 36, 0.95);
  font-size: 12px;
  color: var(--text);
  white-space: pre-wrap;
}
.error b {
  color: var(--blood);
  margin-right: 6px;
}
.fatal {
  position: absolute;
  inset: 30% 15% auto;
  padding: 20px 24px;
  border: 1px solid var(--line);
  border-left: 2px solid var(--blood);
  background: var(--panel);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fatal-title {
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: 22px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-hi);
}
.fatal .lo {
  color: var(--text-lo);
  font-size: 12px;
}
</style>
