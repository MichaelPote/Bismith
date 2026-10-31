<script setup lang="ts">
	// Mask › Write to (FR8.23) as send slots: one line per row — Source → Target, then the Mode as a glyph that opens the
	// full list, and a disclosure for the row's Smoothness and Feather (the regular params). Each of the layer's sources
	// has a row from the start, its mask None until one is picked. Once every row writes a mask, "Add mask" opens one more
	// (another mask from a source) with its mask list dropped open; picking None for such a row removes it, moving the
	// added rows after it up.
	import { computed, nextTick, ref } from 'vue';
	import type { ParamDef, ParamValue, ParamValues } from '@/core/params';
	import { MAX_WRITE_ROWS, rowKey } from '@/layers/commonParams';
	import SelectField from './SelectField.vue';
	import MaskField from './MaskField.vue';
	import ParamList from './ParamList.vue';
	import { IconArrowRight, IconChevronDown, IconChevronUp, IconPlus, IconX } from '@tabler/icons-vue';
	import { vTip } from '@/ui/tooltip';
	import { maskColour } from '@/ui/meta';
	import { useProjectStore } from '@/stores/project';

	const props = defineProps<{ defs: ParamDef[]; values: ParamValues }>();
	const emit = defineEmits<{ (e: 'change', key: string, value: ParamValue): void }>();
	const store = useProjectStore();

	/** Each Mode's glyph: the set operators Limit to uses, a star for the smooth (softer) ones. */
	const GLYPHS: Record<string, string> = {
		replace: '=',
		union: '∪',
		subtract: '−',
		intersect: '∩',
		'smooth-union': '∪*',
		'smooth-subtract': '−*',
		'smooth-intersect': '∩*'
	};
	const ROW_PARAMS = ['mk_src', 'mk_target', 'mk_op', 'mk_smooth', 'mk_feather'];

	const byKey = computed(() => new Map(props.defs.map((d) => [d.key, d])));
	const def = (base: string, n: number) => byKey.value.get(rowKey(base, n));
	const shown = (d: ParamDef | undefined): d is ParamDef => !!d && (!d.showIf || d.showIf(props.values));
	const value = (base: string, n: number): ParamValue | undefined => {
		const d = def(base, n);
		return d ? (props.values[d.key] ?? d.default) : undefined;
	};
	const target = (n: number) => String(value('mk_target', n) ?? '').trim();

	/** The rows each source has from the start (the registry shows them all, mask or not). */
	const own = computed(() => {
		if (!shown(def('mk_target', 1))) return 0;
		return Math.max(1, Math.min(def('mk_src', 1)?.options?.length ?? 1, MAX_WRITE_ROWS));
	});
	/** The last row shown: the sources' rows, then the added ones that write a mask. */
	const count = computed(() => {
		let n = own.value;
		while (n < MAX_WRITE_ROWS && shown(def('mk_target', n + 1)) && target(n + 1)) n++;
		return n;
	});
	/** The row "Add mask" opens: once every row writes a mask, and while there's room. */
	const next = computed(() => {
		const n = count.value + 1;
		const full = Array.from({ length: count.value }, (_, i) => target(i + 1)).every(Boolean);
		return full && n <= MAX_WRITE_ROWS && shown(def('mk_target', n)) ? n : 0;
	});
	const adding = ref(false);
	const slots = computed(() =>
		Array.from({ length: count.value + (adding.value && next.value ? 1 : 0) }, (_, i) => i + 1)
	);
	const open = ref(new Set<number>());

	const modeOptions = (n: number) =>
		(def('mk_op', n)?.options ?? []).map((o) => ({ ...o, label: `${GLYPHS[o.value] ?? ''}  ${o.label}` }));
	const modeLabel = (n: number) => def('mk_op', n)?.options?.find((o) => o.value === value('mk_op', n))?.label;
	const extras = (n: number) =>
		[def('mk_smooth', n), def('mk_feather', n)]
			.filter((d): d is ParamDef => !!d)
			.map((d) => ({ ...d, section: undefined }));
	/** The disclosure's tooltip: what it holds and the values set there. */
	function extrasTip(n: number): string {
		if (open.value.has(n)) return 'Hide';
		return ['mk_smooth', 'mk_feather']
			.filter((b) => shown(def(b, n)))
			.map((b) => `${def(b, n)!.label} ${Number(Number(value(b, n)).toFixed(2))} px`)
			.join(' · ');
	}

	function setTarget(n: number, v: string): void {
		adding.value = false;
		if (v.trim()) emit('change', rowKey('mk_target', n), v);
		else if (n <= own.value) clear(n);
		else if (n <= count.value) remove(n);
	}

	/** A source's own row back to writing nothing, offering its own source again (as a reload would). */
	function clear(n: number): void {
		emit('change', rowKey('mk_target', n), '');
		const src = def('mk_src', n);
		if (src && n > 1) emit('change', src.key, src.default);
		const s = new Set(open.value);
		s.delete(n);
		open.value = s;
	}

	/** Takes added row n out: the added rows after it move up one, and the last one empties (back to its defaults). */
	function remove(n: number): void {
		const last = count.value;
		for (let k = n; k < last; k++)
			for (const b of ROW_PARAMS) {
				const v = value(b, k + 1);
				if (v !== undefined) emit('change', rowKey(b, k), v);
			}
		for (const b of ROW_PARAMS) {
			const d = def(b, last);
			if (d) emit('change', d.key, b === 'mk_target' ? '' : d.default);
		}
		open.value = new Set();
	}

	function toggle(n: number): void {
		const s = new Set(open.value);
		if (!s.delete(n)) s.add(n);
		open.value = s;
	}

	const targets = ref<Record<number, InstanceType<typeof MaskField> | null>>({});
	async function add(): Promise<void> {
		const n = next.value;
		if (!n) return;
		adding.value = true;
		await nextTick();
		targets.value[n]?.open();
	}
</script>

<template>
	<div class="writes">
		<template v-for="n in slots" :key="n">
			<div class="slot">
				<template v-if="shown(def('mk_src', n))">
					<div v-tip="def('mk_src', n)!.hint" class="src">
						<SelectField
							:model-value="String(value('mk_src', n))"
							:options="def('mk_src', n)!.options ?? []"
							:label="def('mk_src', n)!.label"
							@update:model-value="emit('change', rowKey('mk_src', n), $event)" />
					</div>
					<IconArrowRight class="arrow" :size="12" />
				</template>
				<div v-tip="def('mk_target', n)!.hint" class="tgt">
					<MaskField
						:ref="(c) => (targets[n] = c as InstanceType<typeof MaskField> | null)"
						:model-value="target(n)"
						:choices="def('mk_target', n)!.maskChoices ?? []"
						kind="write"
						:label="def('mk_target', n)!.label"
						@update:model-value="setTarget(n, $event)" />
				</div>
				<template v-if="target(n)">
					<div v-tip="{ title: `Mode: ${modeLabel(n)}`, body: def('mk_op', n)!.hint }">
						<SelectField
							:model-value="String(value('mk_op', n))"
							:options="modeOptions(n)"
							:face="GLYPHS[String(value('mk_op', n))] ?? '?'"
							:label="`Mode: ${modeLabel(n)}`"
							@update:model-value="emit('change', rowKey('mk_op', n), $event)" />
					</div>
					<button
						v-tip:top="extrasTip(n)"
						type="button"
						class="cf-ico-btn"
						:class="{ latched: open.has(n) }"
						:aria-expanded="open.has(n)"
						aria-label="Feather and smoothness"
						@click="toggle(n)">
						<component :is="open.has(n) ? IconChevronUp : IconChevronDown" :size="13" />
					</button>
				</template>
				<button
					v-else-if="n > own"
					v-tip:top="'Cancel'"
					type="button"
					class="cf-ico-btn"
					aria-label="Cancel"
					@click="adding = false">
					<IconX :size="13" />
				</button>
				<span v-else class="idle" />
			</div>
			<ParamList
				v-if="open.has(n) && target(n)"
				:defs="extras(n)"
				:values="values"
				class="more"
				:style="{ borderColor: maskColour(store.project, target(n)) }"
				@change="(k, v) => emit('change', k, v)" />
		</template>
		<button v-if="next && !adding" type="button" class="add" @click="add"><IconPlus :size="12" />Add mask</button>
	</div>
</template>

<style scoped>
	.writes {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.slot {
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: 24px;
	}
	.src,
	.tgt {
		flex: 1 1 0;
		min-width: 0;
	}
	.arrow {
		flex: none;
		color: var(--text-lo);
	}
	/* Where a row without a mask would have its Mode and disclosure, so the fields line up. */
	.idle {
		flex: none;
		width: 52px;
	}
	/* A row's Smoothness and Feather, hung under it on a line in its mask's colour. */
	.more {
		margin: 0 0 4px 6px;
		padding-left: 6px;
		border-left: 1px solid var(--line);
	}
	.add {
		height: 22px;
		margin-top: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		border: 1px dashed var(--line);
		border-radius: var(--r-field);
		background: transparent;
		color: var(--text-lo);
		font-size: 12px;
	}
	.add:hover {
		border-color: var(--line-strong);
		color: var(--text-hi);
	}
	.add:focus-visible {
		outline: 1px solid var(--e100);
		outline-offset: 2px;
	}
</style>
