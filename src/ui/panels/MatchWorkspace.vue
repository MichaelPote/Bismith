<script setup lang="ts">
// Reference matching (docs/features/fr6.3-optimizer.md): load a reference, then let the evolution strategy
// tune the unlocked layers toward it while you watch the loss fall.
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, toRaw } from 'vue'
import type { Project } from '@/core/project'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { Matcher, TERM_NAMES, absDiff, fromLinear, fromRgba8, resample, toRgba8, type MatchImage, type MetricPreset, type MetricResult } from '@/match/metrics'
import { analyzeTarget } from '@/match/analyze'
import { availableTemplates } from '@/match/templates'
import { fitColours } from '@/match/colourFit'
import { attachTexture } from '@/match/evaluate'
import { variations } from '@/match/variations'
import { Optimizer, RunLimits, STOP_LABELS, extractParams, type StepInfo, type StopCriteria, type StopReason } from '@/match/optimizer'
import ImageCanvas from '@/ui/components/ImageCanvas.vue'
import LossChart from '@/ui/components/LossChart.vue'
import NumberField from '@/ui/components/NumberField.vue'
import SelectField from '@/ui/components/SelectField.vue'
import CheckField from '@/ui/components/CheckField.vue'
import {
  IconGrid4x4,
  IconPalette,
  IconPhoto,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconWand,
  IconX,
} from '@tabler/icons-vue'

const store = useProjectStore()
const editor = useEditorStore()

const reference = shallowRef<MatchImage | null>(null)
const refName = ref('')
const preset = ref<MetricPreset>('tile')
const samples = ref(16)
// Stop criteria (0 = off). With all off the run goes on until paused.
const maxSteps = ref(300)
const targetLoss = ref(0)
const timeLimit = ref(0)
const stallSteps = ref(0)
const stopped = ref<StopReason | null>(null)
const space = ref({ layers: true, base: true, lights: false, post: false, enums: false, seeds: false })
const structural = ref(false)
const heuristics = ref(true)

const running = ref(false)
const optimizer = shallowRef<Optimizer | null>(null)
const curve = ref<number[]>([])
const lastInfo = shallowRef<StepInfo | null>(null)
const log = ref<string[]>([])
const bestResult = shallowRef<MetricResult | null>(null)
const startLoss = ref<number | null>(null)
const renderPx = shallowRef<{ pixels: Uint8ClampedArray; width: number; height: number } | null>(null)
const diffPx = shallowRef<{ pixels: Uint8ClampedArray; width: number; height: number } | null>(null)
const fitting = ref(false)
let abort = false
/** The project as last scored / optimised from: on returning to Match, a different one means it was edited meanwhile. */
let seen = ''
const snapshot = () => JSON.stringify(toRaw(store.project))

const TERM_SHORT: Record<string, string> = { colour: 'Colour', spectrum: 'Frequency', gradients: 'Edges', contrast: 'Contrast', aligned: 'Alignment', structure: 'Structure', texture: 'Texture', alpha: 'Alpha' }

const refPx = computed(() => (reference.value ? { pixels: toRgba8(reference.value), width: reference.value.width, height: reference.value.height } : null))
const entryCount = computed(() => extractParams(store.project, { ...space.value }).entries.length)

// ---------------------------------------------------------------- reference loading
async function loadFile(file: File): Promise<void> {
  try {
    const bmp = await createImageBitmap(file)
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height)
    reference.value = fromRgba8(d.data, d.width, d.height)
    refName.value = file.name
    reset()
    editor.notify(`Reference “${file.name}” · ${d.width}×${d.height}`)
    void scoreCurrent()
  } catch (e) {
    editor.notify(`Could not read the image: ${e instanceof Error ? e.message : e}`, 'error')
  }
}

function pickFile(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const f = input.files?.[0]
    if (f) void loadFile(f)
  }
  input.click()
}

function onDropEvent(e: Event): void {
  const f = (e as CustomEvent<File>).detail
  if (f) void loadFile(f)
}

function matchSize(): void {
  const r = reference.value
  if (!r) return
  const long = Math.max(r.width, r.height)
  const s = long > 512 ? 512 / long : 1
  store.project.width = Math.max(1, Math.round(r.width * s))
  store.project.height = Math.max(1, Math.round(r.height * s))
  reset()
}

// ---------------------------------------------------------------- evaluation
/** A matcher for the reference, with the GPU texture term when the preset uses it. */
async function makeMatcher(target: MatchImage = reference.value!, wrap = store.project.tileable): Promise<Matcher> {
  const m = new Matcher(target, { preset: preset.value, wrap, window: !wrap })
  if (editor.engine) await attachTexture(editor.engine, m, wrap)
  return m
}

function renderImage(p: Project): MatchImage {
  const engine = editor.engine!
  engine.setProject(p)
  engine.renderNow(samples.value)
  return fromLinear(engine.readFinal())
}

function show(img: MatchImage, matcher: Matcher): void {
  renderPx.value = { pixels: toRgba8(img), width: img.width, height: img.height }
  const a = matcher.fit(img)
  const d = absDiff(a, matcher.target, 3)
  diffPx.value = { pixels: toRgba8(d), width: d.width, height: d.height }
}

async function scoreCurrent(): Promise<void> {
  const engine = editor.engine
  if (!engine || !reference.value) return
  const matcher = await makeMatcher()
  engine.suspend()
  try {
    seen = snapshot()
    const img = renderImage(toRaw(store.project))
    bestResult.value = matcher.score(img)
    show(img, matcher)
  } finally {
    engine.resume(toRaw(store.project))
  }
}

/** Palette snaps off while fitting (the fit compares raw colours), back on after. */
function paletteOff(p: Project): { project: Project; restore: (q: Project) => Project } {
  const on = new Set(p.post.filter((f) => f.type === 'palette' && f.enabled !== false).map((f) => f.id))
  return {
    project: { ...p, post: p.post.map((f) => (on.has(f.id) ? { ...f, enabled: false } : f)) },
    restore: (q) => ({ ...q, post: q.post.map((f) => (on.has(f.id) ? { ...f, enabled: true } : f)) }),
  }
}

/** Fit the current project's colours to the reference (materials through their colour controls; Liquid by tones). */
async function fitColoursNow(): Promise<void> {
  const engine = editor.engine
  if (!engine || !reference.value || running.value || busy.value || fitting.value) return
  fitting.value = true
  await nextFrame()
  const matcher = await makeMatcher()
  engine.suspend()
  try {
    const { project, restore } = paletteOff(structuredClone(toRaw(store.project)))
    const r = await fitColours(project, matcher, (p) => renderImage(p))
    if (r.after < r.before - 1e-5) {
      store.load(restore(r.project))
      reset()
      editor.notify(`Colours fitted · loss ${r.before.toFixed(3)} → ${r.after.toFixed(3)} — undo with Ctrl+Z`)
    } else editor.notify('The colours already fit as well as the fit can do')
  } catch (e) {
    editor.notify(`Colour fit failed: ${e instanceof Error ? e.message : e}`, 'error')
  } finally {
    fitting.value = false
    engine.resume(toRaw(store.project))
  }
  void scoreCurrent()
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

async function run(): Promise<void> {
  const engine = editor.engine
  if (!engine || !reference.value || running.value) return
  running.value = true
  abort = false
  const matcher = await makeMatcher()
  engine.suspend()
  try {
    if (!optimizer.value) {
      const opt = new Optimizer(
        structuredClone(toRaw(store.project)),
        (p) => {
          const r = matcher.score(renderImage(p))
          return { loss: r.total, detail: r }
        },
        { lambda: 4, structural: structural.value, heuristics: heuristics.value, space: { ...space.value }, seed: 1 },
      )
      seen = snapshot()
      startLoss.value = await opt.init()
      optimizer.value = opt
      curve.value = [startLoss.value]
      log.value = [`start · loss ${startLoss.value.toFixed(4)} · ${opt.space.entries.length} params`]
    }
    const opt = optimizer.value
    // Every press runs afresh: up to Max steps more, a new time limit and stall count — so a run that stopped can
    // always keep going. A target loss already reached no longer stops it (it keeps improving past it).
    const stop: StopCriteria = {
      ...(maxSteps.value > 0 ? { steps: maxSteps.value } : {}),
      ...(targetLoss.value > 0 && opt.best.loss > targetLoss.value ? { targetLoss: targetLoss.value } : {}),
      ...(timeLimit.value > 0 ? { timeMs: timeLimit.value * 1000 } : {}),
      ...(stallSteps.value > 0 ? { patience: stallSteps.value } : {}),
    }
    const limits = new RunLimits(stop, opt.best.loss)
    stopped.value = null
    let reason = limits.check(opt.best.loss, opt.evaluations)
    while (!reason) {
      if (abort) {
        reason = 'aborted'
        break
      }
      const info = await opt.step()
      lastInfo.value = info
      curve.value = [...curve.value, info.bestLoss]
      if (info.improved) {
        bestResult.value = (opt.best.detail as MetricResult) ?? null
        show(renderImage(opt.best.project), matcher)
        const what = info.structural ?? info.changed.slice(0, 3).join(', ')
        log.value = [`#${info.step} ${info.bestLoss.toFixed(4)} ${what}`, ...log.value].slice(0, 40)
      }
      reason = limits.after(opt.best.loss, opt.evaluations)
      await nextFrame()
    }
    stopped.value = reason
    log.value = [`stopped · ${STOP_LABELS[reason]} · best ${opt.best.loss.toFixed(4)} · ${(limits.elapsed() / 1000).toFixed(0)} s`, ...log.value].slice(0, 40)
  } catch (e) {
    editor.notify(`Optimiser stopped: ${e instanceof Error ? e.message : e}`, 'error')
  } finally {
    running.value = false
    engine.resume(toRaw(store.project))
  }
}

// ---------------------------------------------------------------- suggest (templates) and variations
interface Card {
  id: string
  label: string
  project: Project
  loss: number | null
  px: { pixels: Uint8ClampedArray; width: number; height: number }
  current?: boolean
}
const overlay = ref<null | 'suggest' | 'vary'>(null)
const cards = shallowRef<Card[]>([])
const busy = ref<string | null>(null)
const palette = ref<'none' | 'quake' | 'doom'>('none')
const spread = ref(0.3)

function withPalette(p: Project, on: boolean): Project {
  return { ...p, post: p.post.map((f) => (f.type === 'palette' ? { ...f, enabled: on } : f)) }
}
const thumb = (img: MatchImage) => ({ pixels: toRgba8(img), width: img.width, height: img.height })

/**
 * Every template built for the reference (colours from its palette, counts from its periods), colour-fitted, scored
 * with the texture-aware metric and shown ranked — you pick the family.
 */
async function suggest(): Promise<void> {
  const engine = editor.engine
  const ref = reference.value
  if (!engine || !ref || busy.value) return
  overlay.value = 'suggest'
  cards.value = []
  engine.suspend()
  try {
    // At most 128 px on the long side: game textures are that size; a photo is matched at a texture's scale.
    const s = Math.min(1, 128 / Math.max(ref.width, ref.height))
    const target = s < 1 ? resample(ref, Math.max(1, Math.round(ref.width * s)), Math.max(1, Math.round(ref.height * s))) : ref
    const analysis = analyzeTarget(target)
    const matcher = await makeMatcher(target, analysis.tileable)
    const ctx = { palette: palette.value === 'none' ? '' : palette.value }
    const list = availableTemplates()
    for (const [i, t] of list.entries()) {
      if (overlay.value !== 'suggest') break
      busy.value = `Trying ${t.label} (${i + 1}/${list.length})`
      await nextFrame()
      const fit = await fitColours(withPalette(t.build(analysis, ctx), false), matcher, (p) => renderImage(p))
      const project = withPalette(fit.project, true)
      cards.value = [...cards.value, { id: t.id, label: t.label, project, loss: fit.after, px: thumb(renderImage(project)) }].sort((a, b) => (a.loss ?? 0) - (b.loss ?? 0))
    }
  } catch (e) {
    editor.notify(`Suggest stopped: ${e instanceof Error ? e.message : e}`, 'error')
  } finally {
    busy.value = null
    engine.resume(toRaw(store.project))
  }
}

/** Eight perturbed versions around the current project (centre), scored when a reference is loaded. */
async function vary(): Promise<void> {
  const engine = editor.engine
  if (!engine || busy.value) return
  overlay.value = 'vary'
  busy.value = 'Making variations…'
  await nextFrame()
  const matcher = reference.value ? await makeMatcher() : null
  engine.suspend()
  try {
    const base = structuredClone(toRaw(store.project))
    const vs = variations(base, 8, { strength: spread.value })
    const all = [...vs.slice(0, 4), { project: base, changed: [] as string[] }, ...vs.slice(4)]
    cards.value = all.map((v, i) => {
      const img = renderImage(v.project)
      return {
        id: `v${i}`,
        label: v.changed.length ? v.changed.slice(0, 2).join(' · ') + (v.changed.length > 2 ? ' …' : '') : 'Current',
        project: v.project,
        loss: matcher ? matcher.score(img).total : null,
        px: thumb(img),
        current: v.changed.length === 0,
      }
    })
  } catch (e) {
    editor.notify(`Variations failed: ${e instanceof Error ? e.message : e}`, 'error')
  } finally {
    busy.value = null
    engine.resume(toRaw(store.project))
  }
}

function pickCard(c: Card): void {
  if (overlay.value === 'vary') {
    if (c.current) {
      overlay.value = null
      return
    }
    store.load(c.project)
    reset()
    void vary() // keep evolving around the pick
    return
  }
  store.load(c.project)
  reset()
  overlay.value = null
  editor.notify(`Started from “${c.label}” — Optimise to refine, Variations to explore (undo with Ctrl+Z)`)
  void scoreCurrent()
}

function closeOverlay(): void {
  overlay.value = null
}

function pause(): void {
  abort = true
}

function reset(): void {
  abort = true
  stopped.value = null
  optimizer.value = null
  curve.value = []
  log.value = []
  lastInfo.value = null
  startLoss.value = null
}

function applyBest(): void {
  const opt = optimizer.value
  if (!opt) return
  store.load(opt.best.project)
  editor.notify(`Applied best (loss ${opt.best.loss.toFixed(4)}) — undo with Ctrl+Z`)
  reset()
  void scoreCurrent()
}

onMounted(() => window.addEventListener('bismith:reference', onDropEvent))
onBeforeUnmount(() => {
  abort = true
  window.removeEventListener('bismith:reference', onDropEvent)
})
// Kept alive across workspace switches: the reference, settings and optimiser survive a visit to Create. Leaving pauses
// a run (the viewport needs the engine); coming back re-renders — and if the project was edited meanwhile, the
// optimiser starts over from it (its best would undo the edits).
onDeactivated(() => {
  abort = true
})
onActivated(() => {
  if (!reference.value || running.value) return
  if (snapshot() === seen) return
  if (optimizer.value) {
    reset()
    editor.notify('The project changed in Create — the optimiser will start over from it')
  }
  void scoreCurrent()
})

const improvement = computed(() => {
  const c = curve.value
  return c.length > 1 && c[0] > 0 ? 1 - c[c.length - 1] / c[0] : null
})
const bestLoss = computed(() => (curve.value.length ? curve.value[curve.value.length - 1] : bestResult.value?.total ?? null))
</script>

<template>
  <section class="match cf-panel">
    <div class="bar">
      <button type="button" class="cf-btn" @click="pickFile"><IconPhoto :size="13" />Load reference…</button>
      <span v-if="reference" class="cf-mono ref">{{ refName }} · {{ reference.width }}×{{ reference.height }}</span>
      <button v-if="reference" type="button" class="cf-btn" title="Resize the project to the reference (long side ≤ 512)" @click="matchSize">Match size</button>
      <span class="grow" />
      <button type="button" class="cf-btn" :disabled="!reference || !editor.engine || running || !!busy" title="Build every template in the reference's colours, ranked — pick the family to start from" @click="suggest">
        <IconWand :size="13" />Suggest
      </button>
      <button type="button" class="cf-btn" :disabled="!editor.engine || running || !!busy" title="Eight variations around the current project — pick by eye, repeat" @click="vary">
        <IconGrid4x4 :size="13" />Variations
      </button>
      <button
        type="button"
        class="cf-btn"
        :disabled="!reference || !editor.engine || running || !!busy || fitting"
        title="Fit the current project's colours to the reference — materials through their colour controls, liquids by their tones (undo with Ctrl+Z)"
        @click="fitColoursNow"
      >
        <IconPalette :size="13" />{{ fitting ? 'Fitting…' : 'Fit colours' }}
      </button>
      <button v-if="!running" type="button" class="fk primary" :disabled="!reference || !editor.engine" @click="run">
        <span class="fk-face"><IconPlayerPlay :size="12" />{{ optimizer ? (stopped && stopped !== 'aborted' ? 'Continue' : 'Resume') : 'Optimise' }}</span>
      </button>
      <button v-else type="button" class="cf-btn" @click="pause"><IconPlayerPause :size="12" />Pause</button>
      <button type="button" class="cf-btn" :disabled="!optimizer || running" @click="applyBest">Apply best</button>
      <button type="button" class="cf-btn" :disabled="running" title="Forget the optimiser state" @click="reset">Reset</button>
    </div>

    <div v-if="overlay" class="overlay">
      <div class="ohead">
        <span class="cf-label">{{ overlay === 'suggest' ? 'Start from a template' : 'Variations' }}</span>
        <span class="lo">{{
          busy ?? (overlay === 'suggest' ? 'Ranked by the metric (colours fitted) — your eye decides. Click one to start from it.' : 'Click one to take it and vary again; the centre is the current project.')
        }}</span>
        <span class="grow" />
        <template v-if="overlay === 'suggest'">
          <span class="lo">Palette</span>
          <SelectField v-model="palette" :options="[{ value: 'none', label: 'None' }, { value: 'quake', label: 'Quake' }, { value: 'doom', label: 'Doom' }]" label="Palette snap" />
        </template>
        <template v-else>
          <span class="lo">Spread</span>
          <div class="spread"><NumberField v-model="spread" :min="0.02" :max="0.6" :step="0.01" label="Variation spread" /></div>
          <button type="button" class="cf-btn" :disabled="!!busy" @click="vary"><IconRefresh :size="12" />Again</button>
        </template>
        <button type="button" class="cf-ico-btn" aria-label="Close" @click="closeOverlay"><IconX :size="13" /></button>
      </div>
      <div class="cards" :class="{ nine: overlay === 'vary' }">
        <button v-for="c in cards" :key="c.id" type="button" class="card" :class="{ current: c.current }" :title="c.label" @click="pickCard(c)">
          <ImageCanvas :pixels="c.px.pixels" :width="c.px.width" :height="c.px.height" :label="c.label" />
          <span class="clabel">{{ c.label }}</span>
          <span v-if="c.loss !== null" class="closs cf-mono">{{ c.loss.toFixed(3) }}</span>
        </button>
      </div>
    </div>

    <div v-else class="panes">
      <figure>
        <figcaption class="cf-label">Reference</figcaption>
        <ImageCanvas :pixels="refPx?.pixels ?? null" :width="refPx?.width ?? 1" :height="refPx?.height ?? 1" label="Reference image">
          Load or drop an image to match. Texture references compare statistics (colour, frequency, edges);
          the Layout preset also compares pixel positions for UI elements.
        </ImageCanvas>
      </figure>
      <figure>
        <figcaption class="cf-label">{{ optimizer ? 'Best so far' : 'Current project' }}</figcaption>
        <ImageCanvas :pixels="renderPx?.pixels ?? null" :width="renderPx?.width ?? 1" :height="renderPx?.height ?? 1" label="Rendered candidate">
          The render appears once a reference is loaded.
        </ImageCanvas>
      </figure>
      <figure>
        <figcaption class="cf-label">Difference ×3</figcaption>
        <ImageCanvas :pixels="diffPx?.pixels ?? null" :width="diffPx?.width ?? 1" :height="diffPx?.height ?? 1" label="Absolute difference" />
      </figure>
    </div>

    <div class="lower">
      <div class="settings">
        <div class="row"><span class="lbl">Metric</span><SelectField v-model="preset" :options="[{ value: 'tile', label: 'Tile (structure at best shift)' }, { value: 'texture', label: 'Texture (statistics)' }, { value: 'layout', label: 'Layout (+ pixel aligned)' }]" label="Metric preset" @update:model-value="reset" /></div>
        <div class="row"><span class="lbl">Samples</span><NumberField v-model="samples" :min="1" :max="256" :soft-min="1" :soft-max="64" int label="Samples per candidate" /></div>
        <div class="row" title="Each Optimise / Continue runs up to this many steps (0 = no limit)"><span class="lbl">Max steps</span><NumberField v-model="maxSteps" :min="0" :max="1000000" :soft-min="0" :soft-max="2000" int label="Max steps" /></div>
        <div class="row" title="Stop as soon as the best loss reaches this (0 = off)"><span class="lbl">Stop at loss</span><NumberField v-model="targetLoss" :min="0" :max="2" :soft-max="0.6" :step="0.001" label="Target loss" /></div>
        <div class="row" title="Stop after this long, per run (0 = off)"><span class="lbl">Time limit</span><NumberField v-model="timeLimit" :min="0" :max="86400" :soft-max="1800" :step="1" unit="s" int label="Time limit" /></div>
        <div class="row" title="Stop after this many steps without progress, restarts included (0 = off)"><span class="lbl">Stall after</span><NumberField v-model="stallSteps" :min="0" :max="100000" :soft-max="400" int unit="steps" label="Stall after" /></div>
        <div class="row"><span class="lbl">Tune</span>
          <div class="checks">
            <CheckField v-model="space.layers" label="Layers" @update:model-value="reset" />
            <CheckField v-model="space.base" label="Base" @update:model-value="reset" />
            <CheckField v-model="space.lights" label="Lights" @update:model-value="reset" />
            <CheckField v-model="space.post" label="Post" @update:model-value="reset" />
            <CheckField v-model="space.enums" label="Modes" @update:model-value="reset" />
            <CheckField v-model="space.seeds" label="Seeds" @update:model-value="reset" />
            <CheckField v-model="structural" label="Add/remove layers" @update:model-value="reset" />
            <CheckField
              v-model="heuristics"
              label="Craft heuristics"
              title="Apply the rules learnt hand-authoring: fine relief, no pixel-scale height, warp not wobble, crisp-edge bevels, AO for tight joints, tinted glints, painted light"
              @update:model-value="reset"
            />
          </div>
        </div>
        <p class="hint">{{ entryCount }} parameters in play. Lock layers in the outliner to keep them fixed.</p>
      </div>

      <div class="progress">
        <div class="stats cf-mono">
          <span>step <b>{{ lastInfo?.step ?? 0 }}</b></span>
          <span>evals <b>{{ optimizer?.evaluations ?? 0 }}</b></span>
          <span>best <b>{{ bestLoss !== null ? bestLoss.toFixed(4) : '—' }}</b></span>
          <span v-if="improvement !== null">gain <b>{{ (improvement * 100).toFixed(1) }}%</b></span>
          <span v-if="lastInfo">σ <b>{{ lastInfo.meanSigma.toFixed(3) }}</b></span>
          <span v-if="stopped && !running">{{ STOP_LABELS[stopped] }}</span>
        </div>
        <LossChart :values="curve" />
      </div>

      <div class="terms">
        <div v-for="t in TERM_NAMES" :key="t" class="term">
          <span class="tl">{{ TERM_SHORT[t] ?? t }}</span>
          <div class="tb"><div :style="{ width: `${Math.min(100, (bestResult?.terms[t] ?? 0) * 100)}%`, opacity: bestResult?.weights[t] ? 1 : 0.3 }" /></div>
          <span class="tv cf-mono">{{ bestResult ? bestResult.terms[t].toFixed(3) : '—' }}</span>
        </div>
        <div class="log cf-mono">
          <div v-for="(l, i) in log" :key="i">{{ l }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.overlay {
  display: grid;
  grid-template-rows: 34px minmax(0, 1fr);
  min-height: 0;
  padding: 0 6px 6px;
}
.ohead {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.ohead .lo {
  color: var(--text-lo);
}
.spread {
  width: 90px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
  overflow-y: auto;
  min-height: 0;
  align-content: start;
}
.cards.nine {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  overflow: hidden;
  align-content: stretch;
}
.card {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 6px;
  padding: 4px;
  background: var(--sunken);
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  cursor: pointer;
  min-height: 150px;
  text-align: left;
}
.cards.nine .card {
  min-height: 0;
}
.card:hover {
  border-color: var(--accent);
}
.card.current {
  border-color: var(--accent-hi);
}
.card :deep(canvas),
.card > :first-child {
  grid-column: 1 / -1;
  min-height: 0;
}
.clabel {
  font-size: 11px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.closs {
  font-size: 11px;
  color: var(--text-lo);
}
.match {
  display: grid;
  grid-template-rows: 36px minmax(0, 1fr) 190px;
  overflow: hidden;
}
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-bottom: 1px solid var(--hairline);
}
.ref {
  font-size: 12px;
  color: var(--text-lo);
}
.grow {
  flex: 1;
}
.panes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 6px;
  min-height: 0;
}
figure {
  margin: 0;
  display: grid;
  grid-template-rows: 20px minmax(0, 1fr);
  min-height: 0;
}
.lower {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 280px;
  gap: 8px;
  padding: 6px 8px 8px;
  border-top: 1px solid var(--hairline);
  min-height: 0;
}
.settings {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
}
.row {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-height: 24px;
}
.lbl {
  font-size: 12px;
  color: var(--text-lo);
  text-align: right;
}
.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 0 12px;
}
.hint {
  margin: 4px 0 0 78px;
  font-size: 11px;
  color: var(--text-lo);
}
.progress {
  display: grid;
  grid-template-rows: 22px minmax(0, 1fr);
  gap: 4px;
  min-height: 0;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0 14px;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-lo);
  align-items: center;
}
.stats b {
  color: var(--pill);
  font-weight: 400;
}
.terms {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 0;
}
.term {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr) 44px;
  gap: 6px;
  align-items: center;
  font-size: 11px;
}
.tl {
  color: var(--text-lo);
  text-align: right;
}
.tb {
  height: 6px;
  background: var(--hairline);
}
.tb > div {
  height: 100%;
  background: var(--sigil);
}
.tv {
  color: var(--text);
  text-align: right;
}
.log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-top: 4px;
  padding: 4px 6px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  background: var(--sunken);
  font-size: 10px;
  color: var(--text-lo);
  line-height: 1.5;
}
</style>
