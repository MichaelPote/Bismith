<script setup lang="ts">
// Renders a list of ParamDefs bound to a values record (label left / control right, Blender density).
import { computed } from 'vue'
import type { Curve, Gradient, ParamDef, ParamValue, ParamValues } from '@/core/params'
import NumberField from './NumberField.vue'
import ColorField from './ColorField.vue'
import SelectField from './SelectField.vue'
import CheckField from './CheckField.vue'
import GradientField from './GradientField.vue'
import CurveField from './CurveField.vue'

const props = defineProps<{ defs: ParamDef[]; values: ParamValues }>()
const emit = defineEmits<{
  (e: 'change', key: string, value: ParamValue): void
  (e: 'commit'): void
}>()

const visible = computed(() => props.defs.filter((d) => !d.showIf || d.showIf(props.values)))

function set(key: string, v: ParamValue): void {
  emit('change', key, v)
}

function randomSeed(key: string): void {
  set(key, Math.floor(Math.random() * 99999))
  emit('commit')
}
</script>

<template>
  <div class="plist">
    <template v-for="d in visible" :key="d.key">
      <div v-if="d.type === 'bool'" class="row" :title="d.hint">
        <span />
        <CheckField :model-value="Boolean(values[d.key])" :label="d.label" @update:model-value="set(d.key, $event)" @commit="emit('commit')" />
      </div>
      <div v-else-if="d.type === 'gradient'" class="row wide" :title="d.hint">
        <span class="lbl">{{ d.label }}</span>
        <GradientField :model-value="values[d.key] as Gradient" :label="d.label" @update:model-value="set(d.key, $event)" @commit="emit('commit')" />
      </div>
      <div v-else-if="d.type === 'curve'" class="row wide" :title="d.hint">
        <span class="lbl">{{ d.label }}</span>
        <CurveField :model-value="values[d.key] as Curve" :label="d.label" @update:model-value="set(d.key, $event)" @commit="emit('commit')" />
      </div>
      <div v-else-if="d.type === 'text'" class="row wide" :title="d.hint">
        <span class="lbl">{{ d.label }}</span>
        <textarea
          class="text"
          rows="3"
          spellcheck="false"
          :value="String(values[d.key] ?? '')"
          :aria-label="d.label"
          @change="set(d.key, ($event.target as HTMLTextAreaElement).value); emit('commit')"
        />
      </div>
      <div v-else class="row" :title="d.hint">
        <label class="lbl">{{ d.label }}</label>
        <SelectField
          v-if="d.type === 'enum'"
          :model-value="String(values[d.key])"
          :options="d.options ?? []"
          :label="d.label"
          @update:model-value="set(d.key, $event)"
          @commit="emit('commit')"
        />
        <ColorField
          v-else-if="d.type === 'color'"
          :model-value="String(values[d.key])"
          :label="d.label"
          @update:model-value="set(d.key, $event)"
          @commit="emit('commit')"
        />
        <div v-else-if="d.type === 'seed'" class="seed">
          <NumberField
            :model-value="Number(values[d.key])"
            :min="d.min"
            :max="d.max"
            :soft-min="0"
            :soft-max="100"
            int
            :label="d.label"
            @update:model-value="set(d.key, $event)"
            @commit="emit('commit')"
          />
          <button type="button" class="cf-ico-btn" title="Random seed" aria-label="Random seed" @click="randomSeed(d.key)">
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M2 2h14v14H2z" /><path d="M6 6h.01M12 6h.01M9 9h.01M6 12h.01M12 12h.01" stroke-width="2.4" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <NumberField
          v-else
          :model-value="Number(values[d.key])"
          :min="d.min"
          :max="d.max"
          :soft-min="d.softMin"
          :soft-max="d.softMax"
          :step="d.step"
          :unit="d.unit"
          :int="d.type === 'int'"
          :label="d.label"
          @update:model-value="set(d.key, $event)"
          @commit="emit('commit')"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.plist {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.row.wide {
  align-items: start;
}
.row.wide .lbl {
  padding-top: 3px;
}
.lbl {
  font-size: 12px;
  color: var(--text-lo);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.seed {
  display: flex;
  gap: 4px;
  min-width: 0;
}
.seed > :first-child {
  flex: 1;
}
.text {
  width: 100%;
  resize: vertical;
  min-height: 48px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  background: var(--sunken);
  color: var(--text-hi);
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 4px 6px;
}
.text:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--halo);
}
</style>
