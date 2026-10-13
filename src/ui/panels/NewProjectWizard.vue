<script setup lang="ts">
// New project wizard. Starters: blank, or one of the example projects (presets). Suggestions: the reference templates
// (match/templates.ts) — the families Match › Suggest offers — each built in a random colour scheme constrained to its
// material (match/schemes.ts): one or two hues in many values and saturations, at the chosen size. Thumbnails render one by one on the
// engine (suspended meanwhile); Shuffle re-rolls the suggestions' colours.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch } from 'vue'
import type { Project } from '@/core/project'
import { createProject } from '@/core/serialize'
import { useEditorStore } from '@/stores/editor'
import { useProjectStore } from '@/stores/project'
import { useActions } from '@/ui/actions'
import { availableTemplates } from '@/match/templates'
import { PRESETS } from '@/presets'
import { rng, schemeAnalysis, templateScheme, type Scheme } from '@/match/schemes'
import { fromLinear, toRgba8 } from '@/match/metrics'
import ImageCanvas from '@/ui/components/ImageCanvas.vue'
import Icon from '@/ui/components/Icon.vue'
import { vTip } from '@/ui/tooltip'

const editor = useEditorStore()
const store = useProjectStore()
const act = useActions()

const SIZES = [32, 64, 128, 256]
const SAMPLES = 16
const size = ref(64)
const seed = ref(Math.floor(Math.random() * 1e9))

interface Card {
  id: string
  label: string
  name: string
  /** Suggestions: their colour scheme. Starters: their preset group. */
  scheme?: Scheme
  group?: string
  project: Project
  px: { pixels: Uint8ClampedArray; width: number; height: number } | null
}
/** The example projects, as they are (their own sizes and colours). */
const starters = shallowRef<Card[]>(PRESETS.map((p) => ({ id: `preset:${p.id}`, label: p.name, name: p.name, group: p.group, project: p.build(), px: null })))
const cards = shallowRef<Card[]>([])
const all = computed(() => [...starters.value, ...cards.value])
const done = computed(() => all.value.filter((c) => c.px).length)

/** Light fixtures get a little glow, so their emission comes on in the scheme's light colour (liquids stay unlit:
 * emission over their light end washed them out). */
const glows = (tags: string[]) => tags.includes('light')

function build(): void {
  const list = availableTemplates()
  cards.value = list.map((t, i) => {
    const scheme = templateScheme(t.id, rng(seed.value + i * 7919))
    const a = schemeAnalysis(scheme, size.value, size.value, glows(t.tags) ? 0.02 : 0)
    const name = t.label.replace(/\s*\(.*\)\s*$/, '')
    const project = { ...t.build(a, { palette: '' }), name }
    return { id: t.id, label: t.label, name, scheme, project, px: null }
  })
  void renderAll()
}

// ---------------------------------------------------------------- thumbnails
let run = 0
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

async function renderAll(): Promise<void> {
  const token = ++run
  const engine = editor.engine
  if (!engine) return
  await nextFrame()
  engine.suspend()
  try {
    for (const c of all.value.filter((x) => !x.px)) {
      if (token !== run) return
      // Compile this suggestion's generators off the main thread where the browser can, then render.
      await engine.precompile([...new Set(c.project.layers.map((l) => l.type))])
      if (token !== run) return
      engine.setProject(c.project)
      engine.renderNow(SAMPLES)
      const img = fromLinear(engine.readFinal())
      const px = { pixels: toRgba8(img), width: img.width, height: img.height }
      const set = (list: Card[]) => list.map((x) => (x === c ? { ...x, px } : x))
      if (starters.value.includes(c)) starters.value = set(starters.value)
      else cards.value = set(cards.value)
      await nextFrame()
    }
  } catch (e) {
    editor.notify(`Suggestions stopped: ${e instanceof Error ? e.message : e}`, 'error')
  } finally {
    if (token === run) engine.resume(toRaw(store.project))
  }
}

function shuffle(): void {
  seed.value = Math.floor(Math.random() * 1e9)
  build()
}

watch(size, build)

// ---------------------------------------------------------------- picking
function blankProject(): Project {
  return createProject({ name: 'Untitled', width: size.value, height: size.value, layers: [] })
}

function close(): void {
  run++
  editor.wizard = false
  editor.engine?.resume(toRaw(store.project))
}

function pick(project: Project): void {
  run++
  editor.wizard = false
  act.newProject(project)
}

const dialog = ref<HTMLElement | null>(null)
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
  }
}
onMounted(async () => {
  window.addEventListener('keydown', onKey, true)
  build()
  await nextTick()
  dialog.value?.focus()
})
onBeforeUnmount(() => {
  run++
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @pointerdown.self="close">
      <div ref="dialog" class="wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title" tabindex="-1">
        <header class="head">
          <div class="titles">
            <h2 id="wizard-title">New project</h2>
            <p>Start blank, from an example, or from a suggestion — each in a random colour for its material: one or two hues in many values and saturations.</p>
          </div>
          <button v-tip:left="'Close (Esc)'" type="button" class="cf-ico-btn" aria-label="Close" @click="close"><Icon name="close" :size="16" /></button>
        </header>

        <div class="bar">
          <span class="cf-label">Size</span>
          <div class="sizes" role="radiogroup" aria-label="Texture size">
            <button
              v-for="s in SIZES"
              :key="s"
              type="button"
              class="fk"
              :class="{ lit: size === s }"
              role="radio"
              :aria-checked="size === s"
              @click="size = s"
            >
              <span class="fk-face">{{ s }}</span>
            </button>
          </div>
          <span class="grow" />
          <span v-if="done < all.length" class="status cf-mono">rendering {{ done }} / {{ all.length }}</span>
          <button v-tip:bottom="'New random colour schemes for the suggestions'" type="button" class="fk" @click="shuffle">
            <span class="fk-face"><Icon name="dice" :size="14" />Shuffle colours</span>
          </button>
        </div>

        <div class="grid">
          <h3 class="section">Starters</h3>
          <button type="button" class="card blank" @click="pick(blankProject())">
            <div class="thumb"><Icon name="plus" :size="32" stroke="var(--text-lo)" /></div>
            <div class="meta">
              <span class="name">Blank</span>
              <span class="sub">No layers — the base material only</span>
            </div>
          </button>
          <button v-for="c in starters" :key="c.id" type="button" class="card" :disabled="!c.px" @click="pick(c.project)">
            <ImageCanvas class="thumb" :pixels="c.px?.pixels ?? null" :width="c.px?.width ?? c.project.width" :height="c.px?.height ?? c.project.height" :label="c.label">
              <span class="pending" />
            </ImageCanvas>
            <div class="meta">
              <span class="name">{{ c.name }}</span>
              <span class="sub">{{ c.group }} · {{ c.project.width }}×{{ c.project.height }}</span>
            </div>
          </button>
          <h3 class="section">Suggestions <span>random colours for each material · {{ size }}×{{ size }}</span></h3>
          <button v-for="c in cards" :key="c.id" v-tip:top="c.label" type="button" class="card" :disabled="!c.px" @click="pick(c.project)">
            <ImageCanvas class="thumb" :pixels="c.px?.pixels ?? null" :width="c.px?.width ?? size" :height="c.px?.height ?? size" :label="c.label">
              <span class="pending" />
            </ImageCanvas>
            <div class="meta">
              <span class="name">{{ c.name }}</span>
              <span v-if="c.scheme" class="swatches" :aria-label="`Colours: ${c.scheme.palette.join(', ')}; accent ${c.scheme.accent}`">
                <span v-for="col in c.scheme.palette" :key="col" class="sw" :class="{ accent: col === c.scheme!.accent }" :style="{ background: col }" />
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(17, 19, 22, 0.72);
}
.wizard {
  display: flex;
  flex-direction: column;
  width: min(1120px, 100%);
  max-height: 100%;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  box-shadow: 0 18px 48px rgba(8, 9, 10, 0.6);
  outline: none;
  user-select: none;
  -webkit-user-select: none;
}
.head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 16px 10px 20px;
}
.titles {
  flex: 1;
  min-width: 0;
}
h2 {
  margin: 0;
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: 24px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-hi);
}
.titles p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-lo);
}
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
  padding: 8px 20px 12px;
  border-bottom: 1px solid var(--hairline);
}
.sizes {
  display: flex;
  gap: 3px;
}
.sizes .fk-face {
  min-width: 40px;
  font-family: var(--font-mono);
}
.grow {
  flex: 1;
}
.status {
  font-size: 11px;
  color: var(--text-lo);
}
.grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  padding: 14px 20px 20px;
}
.section {
  grid-column: 1 / -1;
  margin: 6px 0 -2px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-lo);
}
.section:first-child {
  margin-top: 0;
}
.section span {
  margin-left: 6px;
  letter-spacing: 0.04em;
  text-transform: none;
  font-weight: 400;
  color: var(--line-strong);
}
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  background: var(--base);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.card:hover:not(:disabled) {
  border-color: var(--line);
  background: var(--raised);
}
.card:focus-visible {
  outline: 1px solid var(--e100);
  outline-offset: 2px;
}
.card:disabled {
  cursor: progress;
}
.thumb {
  width: 100%;
  aspect-ratio: 1;
  height: auto;
  border: 1px solid var(--deep);
}
.blank .thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sunken);
  border-style: dashed;
  border-color: var(--line);
}
.pending {
  display: block;
  width: 18px;
  height: 18px;
  border: 2px solid var(--hairline);
  border-top-color: var(--e400);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(1turn);
  }
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-hi);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  font-size: 11px;
  color: var(--text-lo);
}
.swatches {
  display: flex;
  gap: 2px;
}
.sw {
  flex: 1;
  height: 8px;
  border-radius: 1px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
}
.sw.accent {
  flex: 1.6;
  height: 10px;
  margin-top: -1px;
  box-shadow: 0 0 0 1px var(--text-hi);
}
</style>
