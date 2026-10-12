<script setup lang="ts">
import { useProjectStore } from '@/stores/project'
import { LIGHTING_PRESETS } from '@/core/lightingPresets'

const store = useProjectStore()

function apply(id: string): void {
  const p = LIGHTING_PRESETS.find((x) => x.id === id)
  if (p) store.project.lighting = p.build()
}
</script>

<template>
  <div class="lp">
    <button v-for="p in LIGHTING_PRESETS" :key="p.id" type="button" class="cf-btn" :title="p.hint" @click="apply(p.id)">{{ p.name }}</button>
  </div>
</template>

<style scoped>
.lp {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 3px;
}
.lp .cf-btn {
  justify-content: center;
}
</style>
