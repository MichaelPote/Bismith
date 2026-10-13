<script setup lang="ts">
// Renders a list of ParamDefs bound to a values record (label left / control right, Blender density). Labels carry a
// tooltip (the hint, the options, the key and default); params joined by ParamDef.join share a row — Source · Mode
// side by side, At 0 / At 1 as one ramp. A value missing from the record shows (and resets to) the default.
import { computed } from 'vue'
import type { Curve, Gradient, ParamDef, ParamValue, ParamValues } from '@/core/params'
import NumberField from './NumberField.vue'
import ColorField from './ColorField.vue'
import SelectField from './SelectField.vue'
import CheckField from './CheckField.vue'
import GradientField from './GradientField.vue'
import CurveField from './CurveField.vue'
import RampField from './RampField.vue'
import { IconDice5 } from '@tabler/icons-vue'
import { vTip, type Tip } from '@/ui/tooltip'

const props = defineProps<{ defs: ParamDef[]; values: ParamValues }>()
const emit = defineEmits<{
  (e: 'change', key: string, value: ParamValue): void
  (e: 'commit'): void
}>()

type Row = { def: ParamDef; partner?: ParamDef }

const rows = computed<Row[]>(() => {
  const visible = props.defs.filter((d) => !d.showIf || d.showIf(props.values))
  const byKey = new Map(visible.map((d) => [d.key, d]))
  const joined = new Set(visible.filter((d) => d.join && byKey.has(d.join.with)).map((d) => d.join!.with))
  return visible.filter((d) => !joined.has(d.key)).map((d) => ({ def: d, partner: d.join ? byKey.get(d.join.with) : undefined }))
})

const value = (d: ParamDef): ParamValue => props.values[d.key] ?? d.default

function set(key: string, v: ParamValue): void {
  emit('change', key, v)
}

function randomSeed(key: string): void {
  set(key, Math.floor(Math.random() * 99999))
  emit('commit')
}

// ---------------------------------------------------------------- double-click memory (NumberField)
const owners = new WeakMap<object, number>()
let nextOwner = 1
/** Remembers a field's previous value per owner (this values record) and key, across rebuilt fields. */
function memory(d: ParamDef): string {
  let id = owners.get(props.values)
  if (id === undefined) owners.set(props.values, (id = nextOwner++))
  return `${id}:${d.key}`
}

// ---------------------------------------------------------------- tooltips
function show(d: ParamDef, v: ParamValue): string | undefined {
  if (typeof v === 'number') return `${Number(v.toFixed(4))}${d.unit ? ` ${d.unit}` : ''}`
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  if (d.type === 'enum') return d.options?.find((o) => o.value === v)?.label ?? String(v)
  if (d.type === 'color') return String(v)
  return undefined
}

function meta(d: ParamDef): string {
  const def = show(d, d.default)
  return def === undefined ? d.key : `${d.key} · default ${def}`
}

function tip(r: Row): Tip {
  const d = r.def
  const options = d.options?.filter((o) => o.hint).map((o) => [o.label, o.hint!] as [string, string])
  if (r.partner) {
    const p = r.partner
    return {
      title: d.join!.label,
      body: [d.hint, p.hint].filter(Boolean).join('. ') || undefined,
      list: options?.length ? options : undefined,
      meta: d.join!.as === 'ramp' ? `${d.key} · ${p.key} · default ${show(d, d.default)} → ${show(p, p.default)}` : `${meta(d)}\n${meta(p)}`,
    }
  }
  return { title: d.label, body: d.hint, list: options?.length ? options : undefined, meta: meta(d) }
}
</script>

<template>
  <div class="plist">
    <template v-for="r in rows" :key="r.def.key">
      <div v-if="r.def.type === 'bool'" v-tip="tip(r)" class="row">
        <span />
        <CheckField :model-value="Boolean(value(r.def))" :label="r.def.label" @update:model-value="set(r.def.key, $event)" @commit="emit('commit')" />
      </div>
      <div v-else-if="r.partner && r.def.join?.as === 'ramp'" class="row wide">
        <span v-tip="tip(r)" class="lbl">{{ r.def.join.label }}</span>
        <RampField
          :a="Number(value(r.def))"
          :b="Number(value(r.partner))"
          :min="r.def.min"
          :max="r.def.max"
          :step="r.def.step"
          :label="r.def.join.label"
          :default-a="Number(r.def.default)"
          :default-b="Number(r.partner.default)"
          :memory-a="memory(r.def)"
          :memory-b="memory(r.partner)"
          @update:a="set(r.def.key, $event)"
          @update:b="set(r.partner!.key, $event)"
          @commit="emit('commit')"
        />
      </div>
      <div v-else-if="r.partner" class="row">
        <span v-tip="tip(r)" class="lbl">{{ r.def.join!.label }}</span>
        <div class="pair">
          <SelectField
            :model-value="String(value(r.def))"
            :options="r.def.options ?? []"
            :label="r.def.label"
            @update:model-value="set(r.def.key, $event)"
            @commit="emit('commit')"
          />
          <SelectField
            :model-value="String(value(r.partner))"
            :options="r.partner.options ?? []"
            :label="r.partner.label"
            @update:model-value="set(r.partner!.key, $event)"
            @commit="emit('commit')"
          />
        </div>
      </div>
      <div v-else-if="r.def.type === 'gradient'" class="row wide">
        <span v-tip="tip(r)" class="lbl">{{ r.def.label }}</span>
        <GradientField :model-value="value(r.def) as Gradient" :label="r.def.label" @update:model-value="set(r.def.key, $event)" @commit="emit('commit')" />
      </div>
      <div v-else-if="r.def.type === 'curve'" class="row wide">
        <span v-tip="tip(r)" class="lbl">{{ r.def.label }}</span>
        <CurveField :model-value="value(r.def) as Curve" :label="r.def.label" @update:model-value="set(r.def.key, $event)" @commit="emit('commit')" />
      </div>
      <div v-else-if="r.def.type === 'text'" class="row wide">
        <span v-tip="tip(r)" class="lbl">{{ r.def.label }}</span>
        <textarea
          class="text"
          rows="3"
          spellcheck="false"
          :value="String(value(r.def) ?? '')"
          :aria-label="r.def.label"
          @change="set(r.def.key, ($event.target as HTMLTextAreaElement).value); emit('commit')"
        />
      </div>
      <div v-else class="row">
        <label v-tip="tip(r)" class="lbl">{{ r.def.label }}</label>
        <SelectField
          v-if="r.def.type === 'enum'"
          :model-value="String(value(r.def))"
          :options="r.def.options ?? []"
          :label="r.def.label"
          @update:model-value="set(r.def.key, $event)"
          @commit="emit('commit')"
        />
        <ColorField
          v-else-if="r.def.type === 'color'"
          :model-value="String(value(r.def))"
          :label="r.def.label"
          @update:model-value="set(r.def.key, $event)"
          @commit="emit('commit')"
        />
        <div v-else-if="r.def.type === 'seed'" class="seed">
          <NumberField
            :model-value="Number(value(r.def))"
            :min="r.def.min"
            :max="r.def.max"
            :soft-min="0"
            :soft-max="100"
            int
            :label="r.def.label"
            :default-value="Number(r.def.default)"
            :memory-key="memory(r.def)"
            @update:model-value="set(r.def.key, $event)"
            @commit="emit('commit')"
          />
          <button v-tip:top="'Random seed'" type="button" class="cf-ico-btn" aria-label="Random seed" @click="randomSeed(r.def.key)">
            <IconDice5 :size="15" />
          </button>
        </div>
        <NumberField
          v-else
          :model-value="Number(value(r.def))"
          :min="r.def.min"
          :max="r.def.max"
          :soft-min="r.def.softMin"
          :soft-max="r.def.softMax"
          :step="r.def.step"
          :unit="r.def.unit"
          :int="r.def.type === 'int'"
          :label="r.def.label"
          :default-value="Number(r.def.default)"
          :memory-key="memory(r.def)"
          @update:model-value="set(r.def.key, $event)"
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
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}
.lbl:hover {
  color: var(--text);
}
.pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 4px;
  min-width: 0;
}
.seed {
  display: flex;
  align-items: center;
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
