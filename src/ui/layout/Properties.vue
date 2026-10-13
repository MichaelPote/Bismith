<script setup lang="ts">
// Properties of the current selection, generated from ParamDefs and grouped into collapsible cards.
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { getLayerDef, layerGroups, layerParamDefs } from '@/layers/registry'
import { shapeMaskChain, shapeMaskLabel } from '@/layers/shapeMask'
import { getPostDef } from '@/render/post/registry'
import { LIGHT_DEFS } from '@/core/lights'
import { P, type ParamDef, type ParamValue, type ParamValues } from '@/core/params'
import { layerUnits, SIZE_PRESETS } from '@/core/project'
import { layerHue, layerIcon, LIGHT_HUE, POST_HUE } from '@/ui/meta'
import { useActions } from '@/ui/actions'
import PanelCard from '@/ui/components/PanelCard.vue'
import ParamList from '@/ui/components/ParamList.vue'
import {
  IconArrowDown,
  IconArrowUp,
  IconBox,
  IconBulb,
  IconCopy,
  IconLock,
  IconLockOpen,
  IconSparkles,
  IconSquareRotated,
  IconStack2,
  IconSun,
  IconTrash,
} from '@tabler/icons-vue'
import PostExtras from '@/ui/panels/PostExtras.vue'
import { getRecipe } from '@/recipes'
import LightingPresets from '@/ui/panels/LightingPresets.vue'
import { vTip } from '@/ui/tooltip'

const store = useProjectStore()
const editor = useEditorStore()
const act = useActions()

const sel = computed(() => editor.selection)
const layer = computed(() => (sel.value.kind === 'layer' && sel.value.id ? store.getLayer(sel.value.id) : undefined))
const layerDef = computed(() => (layer.value ? getLayerDef(layer.value.type) : undefined))
const light = computed(() => (sel.value.kind === 'light' && sel.value.id ? store.getLight(sel.value.id) : undefined))
const post = computed(() => (sel.value.kind === 'post' && sel.value.id ? store.getPost(sel.value.id) : undefined))
const postDef = computed(() => (post.value ? getPostDef(post.value.type) : undefined))

// Smart materials (recipes as a few controls over ordinary layers).
const material = computed(() => (sel.value.kind === 'material' && sel.value.id ? store.getMaterial(sel.value.id) : undefined))
const recipe = computed(() => (material.value ? getRecipe(material.value.recipe) : undefined))
const materialCards = computed(() => {
  const r = recipe.value
  if (!r) return []
  return r.groups.map((g) => ({ group: g, defs: r.params.filter((d) => (d.group ?? r.groups[0].id) === g.id) })).filter((c) => c.defs.length > 0)
})
const layerMaterial = computed(() => (layer.value ? (store.project.materials ?? []).find((m) => Object.values(m.members).includes(layer.value!.id)) : undefined))

// A material's named mask (FR8.13): the same controls as a layer's, applied to every member.
const MATERIAL_MASK_DEFS: ParamDef[] = [
  P.enum('use', 'Masked by', 'none', [['none', 'None'], ['1', 'Mask 1'], ['2', 'Mask 2'], ['3', 'Mask 3'], ['4', 'Mask 4']], { hint: 'Clip every layer of this material to a named mask ("Write to mask" on any layer)' }),
  P.bool('invert', 'Outside the mask', false, { showIf: (p) => p.use !== 'none', hint: 'Cut a hole: the material is kept only where the mask is not set' }),
]
const materialMask = computed<ParamValues>(() => ({ use: material.value?.mask?.use ?? 'none', invert: material.value?.mask?.invert ?? false }))
function setMaterialMask(key: string, value: ParamValue): void {
  const m = material.value
  if (!m) return
  const next = { ...materialMask.value, [key]: value }
  store.setMaterialMask(m.id, String(next.use), next.invert === true)
}

function unpackMaterial(): void {
  const m = material.value
  if (!m) return
  const first = Object.values(m.members)[0]
  store.unpackMaterial(m.id)
  editor.select(first ? 'layer' : 'project', first)
}

/** Mask › Shape mask › Clip to: name what the shape mask holds here — "Inside Bricks", "Outside Panel − Vent". */
function withClipNames(d: ParamDef, layerId: string): ParamDef {
  const chain = shapeMaskChain(store.project, layerId)
  const what = chain.length ? shapeMaskLabel(chain) : 'the shape mask (empty here)'
  const label = (v: string) => (v === 'inside' ? `Inside ${what}` : v === 'outside' ? `Outside ${what}` : undefined)
  return { ...d, options: d.options?.map((o) => ({ ...o, label: label(o.value) ?? o.label })) }
}

const layerCards = computed(() => {
  const l = layer.value
  const def = layerDef.value
  if (!l || !def) return []
  const defs = layerParamDefs(l.type).map((d) => (d.key === 'm_clip' ? withClipNames(d, l.id) : d))
  const shown = (d: ParamDef) => !d.showIf || d.showIf(l.params)
  return layerGroups(def)
    .map((g) => ({
      group: g,
      defs: defs.filter((d) => (d.group ?? 'params') === g.id && d.key !== g.toggleKey),
      toggle: defs.find((d) => d.key === g.toggleKey),
    }))
    // A card whose params (and header tick) are all hidden for these settings goes too.
    .filter((c) => c.defs.length > 0 && (c.defs.some(shown) || (c.toggle !== undefined && shown(c.toggle))))
})

/** Position in the layer list (top = applied first), or within its material. */
function layerIndexLabel(): string {
  const l = layer.value
  const at = l ? store.unitOf(l.id) : undefined
  if (!l || !at) return ''
  if (at.unit.material) return `${at.unit.layers.findIndex((x) => x.id === l.id) + 1} of ${at.unit.layers.length}`
  return `${store.layerIndex(l.id) + 1} of ${store.project.layers.length}`
}

/** Can the selected layer / material move one step earlier (−1) or later (+1)? */
function canStep(id: string, dir: number): boolean {
  const at = store.unitOf(id)
  if (!at) return false
  if (at.unit.material && at.unit.material.id !== id) {
    const i = at.unit.layers.findIndex((x) => x.id === id) + dir
    return i >= 0 && i < at.unit.layers.length
  }
  const j = at.index + dir
  return j >= 0 && j < layerUnits(store.project.layers, store.project.materials).length
}

// ---------------------------------------------------------------- project / world param tables
const PROJECT_DEFS: ParamDef[] = [
  P.int('width', 'Width', 128, 1, 2048, { softMin: 16, softMax: 1024, unit: 'px' }),
  P.int('height', 'Height', 128, 1, 2048, { softMin: 16, softMax: 1024, unit: 'px' }),
  P.bool('tileable', 'Tileable (seamless wrap)', true),
  P.float('heightDepth', 'Height depth', 2, 0, 4096, { softMax: 8, unit: 'px', step: 0.01, hint: 'World height in px of a height value of 1.0. Keep it small (1–3 px) for fine relief' }),
  P.seed('seed', 'Global seed'),
]
const BASE_DEFS: ParamDef[] = [
  P.color('color', 'Colour', '#7a7570'),
  P.float('roughness', 'Roughness', 0.75, 0, 1, { step: 0.001 }),
  P.float('specular', 'Specular', 0.5, 0, 1, { step: 0.001, hint: 'Specular level before layers (0.5 ≈ 4 % reflectance at scale 1); Specular outputs vary it per pixel' }),
  P.float('height', 'Height', 0, -64, 64, { softMin: -1, softMax: 1, step: 0.001 }),
  P.float('opacity', 'Opacity', 1, 0, 1, { step: 0.001 }),
]
const SKY_DEFS: ParamDef[] = [
  P.bool('enabled', 'Sky light', true),
  P.color('zenith', 'Zenith', '#9fb4c8'),
  P.color('horizon', 'Horizon', '#c8c2b8'),
  P.float('intensity', 'Intensity', 0.35, 0, 1000, { softMax: 4, step: 0.001 }),
]
const AMBIENT_DEFS: ParamDef[] = [
  P.color('color', 'Colour', '#ffffff'),
  P.float('intensity', 'Strength', 0.02, 0, 1000, { softMax: 1, step: 0.001, hint: 'Un-shadowed fill light' }),
]
const RENDER_DEFS: ParamDef[] = [
  P.int('maxSamples', 'Max samples', 256, 1, 65536, { softMin: 1, softMax: 2048 }),
  P.int('samplesPerFrame', 'Per frame', 4, 1, 64, { softMax: 32 }),
  P.int('bounces', 'Bounces', 2, 0, 4),
  P.float('specular', 'Specular scale', 1, 0, 4, { step: 0.001, hint: 'Multiplies every pixel’s specular level: F0 = 0.08 × level × scale. 0 turns highlights off' }),
  P.float('specularTint', 'Specular tint', 0, 0, 1, { step: 0.001, hint: '0 = white highlights; 1 = highlights in the surface’s own hue, enriching the colour' }),
  P.float('ao', 'Ambient occlusion', 0, 0, 8, { softMax: 3, step: 0.01, hint: 'Darkens creases and touching edges: lighting × AO^strength (0 = off). Works with cast shadows off' }),
  P.float('aoRadius', 'AO radius', 4, 0.5, 128, { softMax: 16, unit: 'px', step: 0.1, showIf: (p) => Number(p.ao) > 0 }),
  P.float('clamp', 'Firefly clamp', 8, 0, 1000, { softMax: 32, step: 0.1, hint: 'Max luminance of indirect samples (0 = off)' }),
  P.bool('jitter', 'Sub-pixel jitter (soft shadow edges)', true),
  P.bool('shadows', 'Cast shadows', true, { hint: 'Off: lights shade by surface angle only (painted / hand-lit look)' }),
  P.int('supersample', 'Supersample', 1, 1, 4, { hint: 'Render the surface and lighting at 2–4× and average down: finer 1 px highlights, thin joints and small holes (costs k² time). Shown as @Nx beside the project in the outliner' }),
]

function assign(obj: object, key: string, v: ParamValue): void {
  ;(obj as Record<string, ParamValue>)[key] = v
}
const asValues = (o: object) => o as unknown as ParamValues
</script>

<template>
  <aside class="props cf-panel">
    <!-- Layer -->
    <template v-if="layer && layerDef">
      <div class="title">
        <component :is="layerIcon(layer.type)" :size="15" :color="layerHue(layer.type)" />
        <input class="name" :value="layer.name" aria-label="Layer name" @change="store.updateLayer(layer.id, { name: ($event.target as HTMLInputElement).value })" />
        <label class="en" title="Enabled">
          <input type="checkbox" :checked="layer.enabled" aria-label="Layer enabled" @change="store.updateLayer(layer.id, { enabled: ($event.target as HTMLInputElement).checked })" />
        </label>
      </div>
      <div class="sub">
        <span class="type">{{ layerDef.label }}</span>
        <span v-tip="layerMaterial ? `Position within ${layerMaterial.name} (top = applied first)` : 'Position in the layer list (top = applied first)'" class="cf-mono lo">{{ layerIndexLabel() }}</span>
        <span class="grow" />
        <button
          v-tip="layer.locked ? 'Locked: the optimiser leaves this layer alone. Click to unlock' : 'Lock from the optimiser: it will not change this layer'"
          type="button"
          class="cf-ico-btn"
          :class="{ latched: layer.locked }"
          :aria-pressed="!!layer.locked"
          aria-label="Lock from the optimiser"
          @click="store.updateLayer(layer.id, { locked: !layer.locked })"
        >
          <component :is="layer.locked ? IconLock : IconLockOpen" :size="13" />
        </button>
        <span class="vsep" />
        <button v-tip="'Move up: applied earlier'" type="button" class="cf-ico-btn" aria-label="Move layer up" :disabled="!canStep(layer.id, -1)" @click="store.stepLayer(layer.id, -1)">
          <IconArrowUp :size="13" />
        </button>
        <button v-tip="'Move down: applied later, over more'" type="button" class="cf-ico-btn" aria-label="Move layer down" :disabled="!canStep(layer.id, 1)" @click="store.stepLayer(layer.id, 1)">
          <IconArrowDown :size="13" />
        </button>
        <button v-tip="'Duplicate (Ctrl+D)'" type="button" class="cf-ico-btn" aria-label="Duplicate layer" @click="act.duplicateSelection"><IconCopy :size="13" /></button>
        <button v-tip="'Delete (Del)'" type="button" class="cf-ico-btn" aria-label="Delete layer" @click="act.deleteSelection"><IconTrash :size="13" /></button>
      </div>
      <p v-if="layerDef.description" class="desc">{{ layerDef.description }}</p>
      <div v-if="layerMaterial" class="links">
        <button v-tip="`Part of the smart material ${layerMaterial.name} — select it`" type="button" class="chip" @click="editor.select('material', layerMaterial.id)">
          <IconSquareRotated :size="11" />{{ layerMaterial.name }}
        </button>
      </div>
      <div class="scroll">
        <PanelCard
          v-for="c in layerCards"
          :key="`${layer.id}:${c.group.id}`"
          :title="c.group.label === 'Pattern' ? layerDef.label : c.group.label"
          :collapsed="c.group.collapsed"
          :storage-key="`${layer.type}:${c.group.id}`"
          :toggle="c.group.toggleKey ? Boolean(layer.params[c.group.toggleKey]) : null"
          @update:toggle="store.setLayerParam(layer.id, c.group.toggleKey!, $event)"
        >
          <ParamList :defs="c.defs" :values="layer.params" @change="(k, v) => store.setLayerParam(layer!.id, k, v)" />
        </PanelCard>
      </div>
    </template>

    <!-- Smart material -->
    <template v-else-if="material && recipe">
      <div class="title">
        <IconSquareRotated :size="15" color="var(--accent-hi)" />
        <input class="name" :value="material.name" aria-label="Material name" @change="store.renameMaterial(material.id, ($event.target as HTMLInputElement).value)" />
        <label v-tip="'Shown'" class="en">
          <input type="checkbox" :checked="material.enabled !== false" aria-label="Material shown" @change="store.setMaterialEnabled(material.id, ($event.target as HTMLInputElement).checked)" />
        </label>
      </div>
      <div class="sub">
        <span class="type">{{ recipe.label }}</span>
        <span class="cf-mono lo">{{ Object.keys(material.members).length }} layers</span>
        <span class="grow" />
        <button v-tip="'Move up: applied earlier'" type="button" class="cf-ico-btn" aria-label="Move material up" :disabled="!canStep(material.id, -1)" @click="store.stepLayer(material.id, -1)">
          <IconArrowUp :size="13" />
        </button>
        <button v-tip="'Move down: applied later, over more'" type="button" class="cf-ico-btn" aria-label="Move material down" :disabled="!canStep(material.id, 1)" @click="store.stepLayer(material.id, 1)">
          <IconArrowDown :size="13" />
        </button>
        <button v-tip="'Unpack: keep the layers, drop the controls'" type="button" class="cf-ico-btn" aria-label="Unpack material" @click="unpackMaterial"><IconStack2 :size="13" /></button>
        <button v-tip="'Delete the material and its layers (Del)'" type="button" class="cf-ico-btn" aria-label="Delete material" @click="act.deleteSelection"><IconTrash :size="13" /></button>
      </div>
      <p class="desc">{{ recipe.description }} Its layers are ordinary layers — open it in the outliner to edit one; a control here rewrites only the settings it governs.</p>
      <div class="scroll">
        <PanelCard v-for="c in materialCards" :key="`${material.id}:${c.group.id}`" :title="c.group.label" :storage-key="`material:${recipe.id}:${c.group.id}`">
          <ParamList :defs="c.defs" :values="material.params" @change="(k, v) => store.setMaterialParam(material!.id, k, v)" />
        </PanelCard>
        <PanelCard title="Mask" storage-key="material:mask">
          <p class="hint">Clip this material to a mask written by any layer (e.g. a Cut-out). Cutting a hole: the material in front outside the mask, the one behind inside it — otherwise the hidden one's glow and relief show through.</p>
          <ParamList :defs="MATERIAL_MASK_DEFS" :values="materialMask" @change="setMaterialMask" />
        </PanelCard>
      </div>
    </template>

    <!-- Light -->
    <template v-else-if="light">
      <div class="title">
        <component :is="light.type === 'point' ? IconBulb : IconSun" :size="15" :color="LIGHT_HUE" />
        <input class="name" :value="light.name" aria-label="Light name" @change="store.updateLight(light.id, { name: ($event.target as HTMLInputElement).value })" />
        <label class="en" title="Enabled">
          <input type="checkbox" :checked="light.enabled" aria-label="Light enabled" @change="store.updateLight(light.id, { enabled: ($event.target as HTMLInputElement).checked })" />
        </label>
      </div>
      <div class="sub">
        <span class="type">{{ LIGHT_DEFS[light.type].label }} light</span>
        <span class="grow" />
        <button v-tip="'Duplicate (Ctrl+D)'" type="button" class="cf-ico-btn" aria-label="Duplicate light" @click="act.duplicateSelection"><IconCopy :size="13" /></button>
        <button v-tip="'Delete (Del)'" type="button" class="cf-ico-btn" aria-label="Delete light" @click="act.deleteSelection"><IconTrash :size="13" /></button>
      </div>
      <p class="desc">{{ light.type === 'point' ? 'Drag the gizmo in the viewport to move it. Intensity 1 lights a white surface to 1.0 at 64 px.' : 'Drag the sun gizmo around the texture to set the azimuth. Hold Shift to place it under the cursor, setting the elevation too (the centre is overhead, the dashed ring the horizon); hold Ctrl to snap to 15° steps.' }}</p>
      <div class="scroll">
        <PanelCard title="Light">
          <ParamList :defs="LIGHT_DEFS[light.type].params" :values="light.params" @change="(k, v) => store.setLightParam(light!.id, k, v)" />
        </PanelCard>
      </div>
    </template>

    <!-- Post filter -->
    <template v-else-if="post && postDef">
      <div class="title">
        <IconSparkles :size="15" :color="POST_HUE" />
        <span class="name static">{{ postDef.label }}</span>
        <label class="en" title="Enabled">
          <input type="checkbox" :checked="post.enabled" aria-label="Filter enabled" @change="store.updatePost(post.id, { enabled: ($event.target as HTMLInputElement).checked })" />
        </label>
      </div>
      <div class="sub">
        <span class="type">Post filter · {{ store.project.post.findIndex((f) => f.id === post!.id) + 1 }} of {{ store.project.post.length }}</span>
        <span class="grow" />
        <button v-tip="'Move up: applied earlier'" type="button" class="cf-ico-btn" aria-label="Move filter earlier" @click="store.movePost(post.id, store.project.post.findIndex((f) => f.id === post!.id) - 1)">
          <IconArrowUp :size="13" />
        </button>
        <button v-tip="'Move down: applied later'" type="button" class="cf-ico-btn" aria-label="Move filter later" @click="store.movePost(post.id, store.project.post.findIndex((f) => f.id === post!.id) + 1)">
          <IconArrowDown :size="13" />
        </button>
        <button v-tip="'Delete (Del)'" type="button" class="cf-ico-btn" aria-label="Delete filter" @click="act.deleteSelection"><IconTrash :size="13" /></button>
      </div>
      <p v-if="postDef.description" class="desc">{{ postDef.description }}</p>
      <div class="scroll">
        <PanelCard :title="postDef.label">
          <ParamList :defs="postDef.params" :values="post.params" @change="(k, v) => store.setPostParam(post!.id, k, v)" />
          <PostExtras :filter="post" />
        </PanelCard>
      </div>
    </template>

    <!-- Project -->
    <template v-else>
      <div class="title">
        <IconBox :size="15" color="var(--text-lo)" />
        <input class="name" :value="store.project.name" aria-label="Project name" @change="store.project.name = ($event.target as HTMLInputElement).value" />
      </div>
      <div v-if="sel.kind === 'base'" class="sub"><span class="type">Base</span></div>
      <p class="desc">Texture size and tiling, the base material every layer builds on, world lighting and the path tracer.</p>
      <div class="scroll">
        <PanelCard title="Texture">
          <div class="sizes">
            <button
              v-for="s in SIZE_PRESETS"
              :key="s"
              type="button"
              class="cf-toggle size"
              :class="{ on: store.project.width === s && store.project.height === s }"
              @click="(store.project.width = s), (store.project.height = s)"
            >
              {{ s }}
            </button>
          </div>
          <ParamList :defs="PROJECT_DEFS" :values="asValues(store.project)" @change="(k, v) => assign(store.project, k, v)" />
        </PanelCard>
        <PanelCard title="Path tracer" storage-key="world:tracer">
          <ParamList :defs="RENDER_DEFS" :values="asValues(store.project.render)" @change="(k, v) => assign(store.project.render, k, v)" />
        </PanelCard>
        <PanelCard title="Base material">
          <ParamList :defs="BASE_DEFS" :values="asValues(store.project.base)" @change="(k, v) => assign(store.project.base, k, v)" />
        </PanelCard>
        <PanelCard title="Lighting presets" storage-key="world:presets">
          <LightingPresets />
        </PanelCard>
        <PanelCard title="Sky light" storage-key="world:sky">
          <ParamList :defs="SKY_DEFS" :values="asValues(store.project.lighting.sky)" @change="(k, v) => assign(store.project.lighting.sky, k, v)" />
        </PanelCard>
        <PanelCard title="Ambient" storage-key="world:ambient">
          <ParamList :defs="AMBIENT_DEFS" :values="asValues(store.project.lighting.ambient)" @change="(k, v) => assign(store.project.lighting.ambient, k, v)" />
        </PanelCard>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 0 12px 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: var(--sunken);
  color: var(--accent-hi);
  cursor: pointer;
}
.chip.lo {
  color: var(--text-lo);
  cursor: default;
}
.cf-btn.small {
  font-size: 11px;
  padding: 1px 8px;
  height: auto;
}
.hint {
  margin: 0 0 6px;
  font-size: 11px;
  color: var(--text-lo);
}
.props {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--hairline);
  flex: none;
}
.name {
  flex: 1;
  min-width: 0;
  height: 24px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  background: var(--sunken);
  color: var(--text-hi);
  padding: 0 8px;
  font-size: 13px;
  font-weight: 500;
}
.name:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--halo);
}
.name.static {
  border-color: transparent;
  background: transparent;
  display: flex;
  align-items: center;
}
.en input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}
.sub {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 6px 0 10px;
  flex: none;
}
.type {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-lo);
}
.lo {
  font-size: 11px;
  color: var(--line-strong);
  white-space: nowrap;
}
.grow {
  flex: 1;
}
.vsep {
  width: 1px;
  height: 14px;
  margin: 0 3px;
  background: var(--hairline);
}
.desc {
  margin: 0;
  padding: 0 10px 8px;
  font-size: 12px;
  color: var(--text-lo);
  line-height: 1.4;
  flex: none;
}
.scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0 6px 12px;
}
.sizes {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 0 0 4px 96px;
}
.size {
  font-family: var(--font-mono);
  font-size: 11px;
}
</style>
