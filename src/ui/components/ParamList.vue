<script setup lang="ts">
	// Renders a list of ParamDefs bound to a values record (label left / control right, Blender density). Labels carry a
	// tooltip (the hint, the options, the key and default); params joined by ParamDef.join share a row — Source · Mode
	// side by side, At 0 / At 1 as one ramp. A value missing from the record shows (and resets to) the default. The
	// `section` slot draws extras under a section heading (the Shaping › Value graph); the sections named in `slotted` are
	// drawn by that slot alone (Mask › Write to's send slots), their heading still shown while any of their rows is.
	import { computed, ref } from 'vue';
	import {
		cloneValue,
		type Curve,
		type Gradient,
		type ParamDef,
		type ParamValue,
		type ParamValues
	} from '@/core/params';
	import NumberField from './NumberField.vue';
	import ColorField from './ColorField.vue';
	import SelectField from './SelectField.vue';
	import MaskField from './MaskField.vue';
	import ImageField from './ImageField.vue';
	import CheckField from './CheckField.vue';
	import GradientField from './GradientField.vue';
	import CurveField from './CurveField.vue';
	import RampField from './RampField.vue';
	import DropMenu, { type MenuItem } from './DropMenu.vue';
	import {
		RGBA_PRESETS,
		RGB_PRESETS,
		R_PRESETS,
		withOpacityRamp,
		type ColourPreset,
		type GreyPreset
	} from '@/core/gradientPresets';
	import { SWATCH_CHECKER, gradientCss } from '@/ui/gradientCss';
	import { IconDice5 } from '@tabler/icons-vue';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore } from '@/stores/editor';
	import { vTip, type Tip } from '@/ui/tooltip';

	const props = defineProps<{
		defs: ParamDef[];
		values: ParamValues;
		slotted?: string[];
		/**
		 * The variant-setting key of these params (FR10), less the param's: `layer.<id>.p.`, `base.`, '' for the project's
		 * own. Given, rows the shown variant changes are marked (◆) and the menu can reset them to the base.
		 */
		keyPrefix?: string;
	}>();
	const emit = defineEmits<{
		(e: 'change', key: string, value: ParamValue): void;
	}>();

	/**
	 * A drawn row; `heading` is the section heading drawn above it (the first row of a section). A `slotted` row stands for
	 * its whole section: only the heading and the slot are drawn.
	 */
	type Row = { def: ParamDef; partner?: ParamDef; heading?: string; slotted?: boolean };

	const rows = computed<Row[]>(() => {
		const visible = props.defs.filter((d) => !d.showIf || d.showIf(props.values));
		const byKey = new Map(visible.map((d) => [d.key, d]));
		const joined = new Set(visible.filter((d) => d.join && byKey.has(d.join.with)).map((d) => d.join!.with));
		const list: Row[] = visible
			.filter((d) => !joined.has(d.key))
			.map((d) => ({ def: d, partner: d.join ? byKey.get(d.join.with) : undefined }));
		if (!list.some((r) => r.def.section)) return list;
		// Rows without a section first, then the sections in order of first appearance, each kept together under its heading.
		const sections = new Map<string, Row[]>([['', []]]);
		for (const r of list) {
			const s = r.def.section ?? '';
			if (!sections.has(s)) sections.set(s, []);
			sections.get(s)!.push(r);
		}
		return [...sections].flatMap(([s, rs]) =>
			props.slotted?.includes(s)
				? [{ ...rs[0], heading: s, slotted: true }]
				: rs.map((r, i) => (i === 0 && s ? { ...r, heading: s } : r))
		);
	});

	const value = (d: ParamDef): ParamValue => props.values[d.key] ?? d.default;

	const store = useProjectStore();
	const editor = useEditorStore();

	// ---------------------------------------------------------------- variants (FR10) and the row menu
	const settingKey = (d: ParamDef) => (props.keyPrefix === undefined ? null : props.keyPrefix + d.key);
	const isChanged = (d: ParamDef) => {
		const k = settingKey(d);
		return k !== null && store.changedKeys.has(k);
	};
	const changed = (r: Row): boolean => isChanged(r.def) || (!!r.partner && isChanged(r.partner));

	const menu = ref<InstanceType<typeof DropMenu> | null>(null);
	const menuItems = ref<MenuItem[]>([]);

	/** A grey map's swatch: black (0) to white (1), left to right. */
	const greyCss = (p: GreyPreset) => {
		const g = (f: number) => `hsl(0 0% ${(f * 100).toFixed(1)}%)`;
		return `linear-gradient(90deg, ${g(p.a)}, ${g(p.b)})`;
	};

	/**
	 * A ramp row's presets for its menu, as swatches of the ramps themselves (src/core/gradientPresets.ts): an R row (a
	 * grey At 0 … At 1 pair) gets the grey maps, a colour ramp the RGB ones, and one with opacity the RGB and RGBA ones
	 * and the grey maps again as its A channel (the opacity runs along them, the colours kept). The ones that would leave
	 * the row as it is are ticked.
	 */
	function rampPresetItems(r: Row): MenuItem[] {
		if (r.def.type === 'gradient') {
			const cur = value(r.def) as Gradient;
			const same = JSON.stringify(cur);
			const pick = (label: string, ramp: string, next: Gradient): MenuItem => ({
				label,
				ramp,
				checked: JSON.stringify(next) === same,
				action: () => set(r.def.key, next)
			});
			const colours = (title: string, list: ColourPreset[], alpha: boolean): MenuItem[] => [
				{ section: title },
				...list.map((p) =>
					pick(
						`${p.name} ramp${alpha ? ' with opacity' : ''}`,
						gradientCss(p.gradient, alpha, SWATCH_CHECKER),
						cloneValue(p.gradient)
					)
				)
			];
			return [
				...colours('RGB presets', RGB_PRESETS, false),
				...(r.def.alpha
					? [
							...colours('RGBA presets', RGBA_PRESETS, true),
							{ section: 'A presets' },
							...R_PRESETS.map((p) => pick(`${p.name} opacity`, greyCss(p), withOpacityRamp(cur, p.a, p.b)))
						]
					: [])
			];
		}
		const b = r.partner!;
		const lo = r.def.min ?? 0;
		const span = (r.def.max ?? 1) - lo;
		const step = r.def.step ?? 0.001;
		const val = (f: number) => Number((Math.round((lo + f * span) / step) * step).toFixed(6));
		return [
			{ section: 'R presets' },
			...R_PRESETS.map((p) => ({
				label: `${p.name} ramp`,
				ramp: greyCss(p),
				checked: Number(value(r.def)) === val(p.a) && Number(value(b)) === val(p.b),
				action: () => {
					set(r.def.key, val(p.a));
					set(b.key, val(p.b));
				}
			}))
		];
	}

	/**
	 * Right-click on a row: copy / paste its value, reset it to the base variant's or to its default; a ramp row's
	 * presets below.
	 */
	function onMenu(e: MouseEvent, r: Row): void {
		const t = e.target as HTMLElement;
		// Text being edited keeps the browser's menu (copy, paste, spelling).
		if (t.closest('textarea') || (t instanceof HTMLInputElement && document.activeElement === t)) return;
		e.preventDefault();
		const at = t.closest<HTMLElement>('[data-key]')?.dataset.key;
		const d = r.partner && at === r.partner.key ? r.partner : r.def;
		const clip = editor.paramClipboard;
		const fits =
			!!clip && clip.type === d.type && (d.type !== 'enum' || !!d.options?.some((o) => o.value === clip.value));
		const key = settingKey(d);
		const vs = store.variants;
		const variants = key !== null && vs.list.length > 1 && store.isVariantSetting(key);
		const on = isChanged(d);
		const baseName = vs.list.find((v) => v.id === vs.baseId)?.name ?? 'the base';
		// Name what is copied where it isn't a plain value (paste stays off unless the clipboard holds the same type).
		const what = d.type === 'gradient' ? 'gradient' : 'value';
		menuItems.value = [
			{ label: `Copy ${what}`, action: () => (editor.paramClipboard = { type: d.type, value: cloneValue(value(d)) }) },
			{
				label: `Paste ${what}`,
				disabled: !fits,
				action: () => {
					set(d.key, cloneValue(clip!.value));
				}
			},
			...(variants
				? [
						{ separator: true },
						{
							label: 'Make this the base value',
							disabled: !on,
							hint: on ? `${baseName} and the variants that follow it take this value` : undefined,
							action: () => store.makeBaseValue(key!)
						},
						{ label: `Reset to ${baseName}`, disabled: !on, action: () => store.resetToBase(key!) }
					]
				: []),
			{ separator: true },
			{
				label: 'Reset to default',
				disabled: JSON.stringify(value(d)) === JSON.stringify(d.default),
				action: () => {
					set(d.key, cloneValue(d.default));
				}
			},
			...(r.def.type === 'gradient' || (r.partner && r.def.join?.as === 'ramp')
				? [{ separator: true }, ...rampPresetItems(r)]
				: [])
		];
		menu.value?.openAt(e.clientX, e.clientY);
	}
	/** Slider range: ± the texture width / height for sliderSpan params, else the soft limits. */
	function slider(d: ParamDef): { lo?: number; hi?: number } {
		if (!d.sliderSpan) return { lo: d.softMin, hi: d.softMax };
		const s = d.sliderSpan === 'width' ? store.project.width : store.project.height;
		return { lo: -s, hi: s };
	}

	function set(key: string, v: ParamValue): void {
		emit('change', key, v);
	}

	function randomSeed(key: string): void {
		set(key, Math.floor(Math.random() * 99999));
	}

	// ---------------------------------------------------------------- double-click memory (NumberField)
	const owners = new WeakMap<object, number>();
	let nextOwner = 1;
	/** Remembers a field's previous value per owner (this values record) and key, across rebuilt fields. */
	function memory(d: ParamDef): string {
		let id = owners.get(props.values);
		if (id === undefined) owners.set(props.values, (id = nextOwner++));
		return `${id}:${d.key}`;
	}

	// ---------------------------------------------------------------- tooltips
	function show(d: ParamDef, v: ParamValue): string | undefined {
		if (typeof v === 'number') return `${Number(v.toFixed(4))}${d.unit ? ` ${d.unit}` : ''}`;
		if (typeof v === 'boolean') return v ? 'on' : 'off';
		if (d.type === 'enum') return d.options?.find((o) => o.value === v)?.label ?? String(v);
		if (d.type === 'color') return String(v);
		return undefined;
	}

	function meta(d: ParamDef): string {
		const def = show(d, d.default);
		return def === undefined ? d.key : `${d.key} · default ${def}`;
	}

	/** The label for the current values (ParamDef.labelFor) and the note on them (ParamDef.note), if any. */
	const labelOf = (d: ParamDef): string => d.labelFor?.(props.values) ?? d.label;
	const noteOf = (d: ParamDef): string | undefined => d.note?.(props.values);
	const rowNote = (r: Row): string | undefined =>
		[r.def, r.partner]
			.map((d) => d && noteOf(d))
			.filter(Boolean)
			.join('. ') || undefined;

	function tip(r: Row): Tip {
		const d = r.def;
		const options = d.options?.filter((o) => o.hint).map((o) => [o.label, o.hint!] as [string, string]);
		const note = rowNote(r);
		if (r.partner) {
			const p = r.partner;
			return {
				title: d.join!.label,
				body: [note, d.hint, p.hint].filter(Boolean).join('. ') || undefined,
				list: options?.length ? options : undefined,
				meta:
					d.join!.as === 'ramp'
						? `${d.key} · ${p.key} · default ${show(d, d.default)} → ${show(p, p.default)}`
						: `${meta(d)}\n${meta(p)}`
			};
		}
		return {
			title: labelOf(d),
			body: [note, d.hint].filter(Boolean).join('. ') || undefined,
			list: options?.length ? options : undefined,
			meta: meta(d)
		};
	}
</script>

<template>
	<div class="plist">
		<template v-for="r in rows" :key="r.def.key">
			<div v-if="r.heading" class="sec cf-label">{{ r.heading }}</div>
			<slot v-if="r.heading" name="section" :section="r.heading" />
			<template v-if="r.slotted" />
			<div
				v-else-if="r.def.type === 'bool'"
				v-tip="tip(r)"
				class="row"
				:class="{ changed: changed(r) }"
				@contextmenu="onMenu($event, r)">
				<span class="lead" />
				<CheckField
					:model-value="Boolean(value(r.def))"
					:label="labelOf(r.def)"
					@update:model-value="set(r.def.key, $event)" />
			</div>
			<div
				v-else-if="r.partner && r.def.join?.as === 'ramp'"
				class="row wide"
				:class="{ changed: changed(r) }"
				@contextmenu="onMenu($event, r)">
				<span v-tip="tip(r)" :class="{ noted: rowNote(r) }" class="lbl">{{ r.def.join.label }}</span>
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
					@update:b="set(r.partner!.key, $event)" />
			</div>
			<div v-else-if="r.partner" class="row" :class="{ changed: changed(r) }" @contextmenu="onMenu($event, r)">
				<span v-tip="tip(r)" :class="{ noted: rowNote(r) }" class="lbl">{{ r.def.join!.label }}</span>
				<div class="pair">
					<template v-for="d in [r.def, r.partner]" :key="d.key">
						<SelectField
							v-if="d.type === 'enum'"
							:model-value="String(value(d))"
							:options="d.options ?? []"
							:label="labelOf(d)"
							:data-key="d.key"
							@update:model-value="set(d.key, $event)" />
						<MaskField
							v-else-if="d.type === 'text' && d.mask"
							:model-value="String(value(d) ?? '')"
							:choices="d.maskChoices ?? []"
							:kind="d.mask"
							:label="labelOf(d)"
							:data-key="d.key"
							@update:model-value="set(d.key, $event)" />
						<NumberField
							v-else
							:model-value="Number(value(d))"
							:min="d.min"
							:max="d.max"
							:soft-min="slider(d).lo"
							:soft-max="slider(d).hi"
							:step="d.step"
							:unit="d.unit"
							:int="d.type === 'int'"
							:label="labelOf(d)"
							:data-key="d.key"
							:default-value="Number(d.default)"
							:memory-key="memory(d)"
							@update:model-value="set(d.key, $event)" />
					</template>
				</div>
			</div>
			<div
				v-else-if="r.def.type === 'gradient'"
				class="row wide"
				:class="{ changed: changed(r) }"
				@contextmenu="onMenu($event, r)">
				<span v-tip="tip(r)" :class="{ noted: rowNote(r) }" class="lbl">{{ labelOf(r.def) }}</span>
				<GradientField
					:model-value="value(r.def) as Gradient"
					:alpha="r.def.alpha"
					:label="labelOf(r.def)"
					@update:model-value="set(r.def.key, $event)" />
			</div>
			<div
				v-else-if="r.def.type === 'curve'"
				class="row wide"
				:class="{ changed: changed(r) }"
				@contextmenu="onMenu($event, r)">
				<span v-tip="tip(r)" :class="{ noted: rowNote(r) }" class="lbl">{{ labelOf(r.def) }}</span>
				<CurveField
					:model-value="value(r.def) as Curve"
					:label="labelOf(r.def)"
					@update:model-value="set(r.def.key, $event)" />
			</div>
			<div
				v-else-if="r.def.type === 'enum' && r.def.segmented"
				class="row"
				:class="{ changed: changed(r) }"
				@contextmenu="onMenu($event, r)">
				<span v-if="r.def.bare" />
				<label v-else v-tip="tip(r)" :class="{ noted: rowNote(r) }" class="lbl">{{ labelOf(r.def) }}</label>
				<div class="segs" role="radiogroup" :aria-label="labelOf(r.def)">
					<button
						v-for="o in r.def.options ?? []"
						:key="o.value"
						v-tip="o.hint ? { title: o.label, body: o.hint } : undefined"
						type="button"
						role="radio"
						class="cf-toggle seg"
						:class="{ on: value(r.def) === o.value }"
						:aria-checked="value(r.def) === o.value"
						@click="set(r.def.key, o.value)">
						{{ o.label }}
					</button>
				</div>
			</div>
			<div
				v-else-if="r.def.type === 'text' && r.def.mask"
				class="row"
				:class="{ changed: changed(r) }"
				@contextmenu="onMenu($event, r)">
				<span v-if="r.def.bare" />
				<label v-else v-tip="tip(r)" :class="{ noted: rowNote(r) }" class="lbl">{{ labelOf(r.def) }}</label>
				<MaskField
					:model-value="String(value(r.def) ?? '')"
					:choices="r.def.maskChoices ?? []"
					:kind="r.def.mask"
					:label="labelOf(r.def)"
					@update:model-value="set(r.def.key, $event)" />
			</div>
			<div
				v-else-if="r.def.type === 'text' && r.def.image"
				class="row wide"
				:class="{ changed: changed(r) }"
				@contextmenu="onMenu($event, r)">
				<label v-tip="tip(r)" :class="{ noted: rowNote(r) }" class="lbl">{{ labelOf(r.def) }}</label>
				<ImageField
					:model-value="String(value(r.def) ?? '')"
					:label="labelOf(r.def)"
					:environment="r.def.environment"
					@update:model-value="set(r.def.key, $event)" />
			</div>
			<div
				v-else-if="r.def.type === 'text'"
				class="row wide"
				:class="{ changed: changed(r) }"
				@contextmenu="onMenu($event, r)">
				<span v-tip="tip(r)" :class="{ noted: rowNote(r) }" class="lbl">{{ labelOf(r.def) }}</span>
				<textarea
					class="text"
					rows="3"
					spellcheck="false"
					:value="String(value(r.def) ?? '')"
					:aria-label="labelOf(r.def)"
					@change="set(r.def.key, ($event.target as HTMLTextAreaElement).value)" />
			</div>
			<div v-else class="row" :class="{ changed: changed(r) }" @contextmenu="onMenu($event, r)">
				<label v-tip="tip(r)" :class="{ noted: rowNote(r) }" class="lbl">{{ labelOf(r.def) }}</label>
				<SelectField
					v-if="r.def.type === 'enum'"
					:model-value="String(value(r.def))"
					:options="r.def.options ?? []"
					:label="labelOf(r.def)"
					@update:model-value="set(r.def.key, $event)" />
				<ColorField
					v-else-if="r.def.type === 'color'"
					:model-value="String(value(r.def))"
					:label="labelOf(r.def)"
					@update:model-value="set(r.def.key, $event)" />
				<div v-else-if="r.def.type === 'seed'" class="seed">
					<NumberField
						:model-value="Number(value(r.def))"
						:min="r.def.min"
						:max="r.def.max"
						:soft-min="0"
						:soft-max="100"
						int
						:label="labelOf(r.def)"
						:default-value="Number(r.def.default)"
						:memory-key="memory(r.def)"
						@update:model-value="set(r.def.key, $event)" />
					<button
						v-tip:top="'Random seed'"
						type="button"
						class="cf-ico-btn"
						aria-label="Random seed"
						@click="randomSeed(r.def.key)">
						<IconDice5 :size="15" />
					</button>
				</div>
				<NumberField
					v-else
					:model-value="Number(value(r.def))"
					:min="r.def.min"
					:max="r.def.max"
					:soft-min="slider(r.def).lo"
					:soft-max="slider(r.def).hi"
					:step="r.def.step"
					:unit="r.def.unit"
					:int="r.def.type === 'int'"
					:label="labelOf(r.def)"
					:default-value="Number(r.def.default)"
					:memory-key="memory(r.def)"
					@update:model-value="set(r.def.key, $event)" />
			</div>
		</template>
		<DropMenu ref="menu" :items="menuItems" placement="pointer" />
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
	/* A setting the shown variant changes from the base (FR10): a diamond before the label, which takes Ember 100. */
	.row.changed .lbl,
	.row.changed :deep(.cf-check label) {
		color: var(--accent-hi);
	}
	.row.changed .lbl::before,
	.row.changed .lead::after {
		content: '';
		display: inline-block;
		width: 6px;
		height: 6px;
		margin-right: 6px;
		vertical-align: 1px;
		transform: rotate(45deg);
		background: var(--e400);
	}
	.lead {
		text-align: right;
	}
	/* A segmented choice (ParamDef.segmented): toggle buttons side by side, like the texture-size presets. */
	.segs {
		display: flex;
		gap: 2px;
	}
	.seg {
		flex: 1 1 0;
		min-width: 0;
		font-size: 11px;
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
	/* The current values carry a note (ParamDef.note): see the tooltip. */
	.lbl.noted {
		color: var(--gold);
	}
	/* Section heading within a card (ParamDef.section). */
	.sec {
		padding: 8px 0 2px;
		font-size: 10px;
	}
	.sec:first-child {
		padding-top: 0;
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
