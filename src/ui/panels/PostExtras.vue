<script setup lang="ts">
// Extra actions for specific post filters. Palette: preview swatches (the eyedropper takes their colours) and extract a
// palette from the render.
import { computed, ref, toRaw } from 'vue'
import type { PostFilter, Project } from '@/core/project'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { extractPalette, paletteColors } from '@/render/post/palettes'
import NumberField from '@/ui/components/NumberField.vue'
import { vPick } from '@/ui/eyedropper'

const props = defineProps<{ filter: PostFilter }>()
const store = useProjectStore()
const editor = useEditorStore()
const count = ref(16)
const busy = ref(false)

const swatches = computed(() =>
  props.filter.type === 'palette' ? paletteColors(String(props.filter.params.palette), String(props.filter.params.custom ?? '')) : [],
)

function extract(): void {
  const engine = editor.engine
  if (!engine) return
  busy.value = true
  try {
    const project = toRaw(store.project)
    const at = project.post.findIndex((f) => f.id === props.filter.id)
    // Render with the stack truncated before this filter so we sample the un-palettised image.
    const truncated: Project = { ...project, post: project.post.slice(0, Math.max(0, at)) }
    engine.setProject(truncated)
    engine.renderNow()
    const colours = extractPalette(engine.readFinal(), Math.round(count.value))
    engine.setProject(project)
    store.setPostParam(props.filter.id, 'custom', colours.join(' '))
    store.setPostParam(props.filter.id, 'palette', 'custom')
    editor.notify(`Extracted ${colours.length} colours from the render`)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="filter.type === 'palette'" class="pe">
    <div v-if="swatches.length" class="sw" :title="`${swatches.length} colours`">
      <span v-for="(c, i) in swatches" :key="i" v-pick="() => c" :style="{ background: c }" />
    </div>
    <div class="row">
      <span class="lbl">From render</span>
      <div class="ctl">
        <NumberField v-model="count" :min="2" :max="256" :soft-min="2" :soft-max="64" int label="Colours to extract" />
        <button type="button" class="cf-btn" :disabled="busy" @click="extract">Extract</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pe {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.sw {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  padding: 4px;
  margin-left: 96px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  background: var(--sunken);
}
.sw span {
  width: 9px;
  height: 9px;
}
.row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}
.lbl {
  font-size: 12px;
  color: var(--text-lo);
  text-align: right;
}
.ctl {
  display: flex;
  gap: 4px;
}
.ctl > :first-child {
  flex: 1;
}
</style>
