<script setup lang="ts">
	// Colour-ramp editor: a bar with draggable gem stops. Click the bar to add a stop. The eyedropper takes the ramp's
	// colour under the pointer.
	import { computed, ref } from 'vue';
	import { MAX_GRADIENT_STOPS, type Gradient } from '@/core/params';
	import { hexToRgb, rgbToHex } from '@/core/color';
	import ColorField from './ColorField.vue';
	import NumberField from './NumberField.vue';
	import { IconArrowsLeftRight, IconTrash } from '@tabler/icons-vue';
	import { vPick } from '@/ui/eyedropper';

	const props = defineProps<{ modelValue: Gradient; label?: string }>();
	const emit = defineEmits<{
		(e: 'update:modelValue', v: Gradient): void;
		(e: 'commit', v: Gradient): void;
	}>();

	const bar = ref<HTMLElement | null>(null);
	const selected = ref(0);

	const stops = computed(() => props.modelValue.stops);
	const sel = computed(() => stops.value[Math.min(selected.value, stops.value.length - 1)]);

	const css = computed(() => {
		const s = [...stops.value].sort((a, b) => a.pos - b.pos);
		if (s.length === 1) return s[0].color;
		return `linear-gradient(90deg, ${s.map((x) => `${x.color} ${(x.pos * 100).toFixed(2)}%`).join(', ')})`;
	});

	function clone(): Gradient {
		return { stops: stops.value.map((s) => ({ ...s })) };
	}

	function update(g: Gradient, commit = false): void {
		emit('update:modelValue', g);
		if (commit) emit('commit', g);
	}

	function colorAt(t: number): string {
		const s = [...stops.value].sort((a, b) => a.pos - b.pos);
		if (t <= s[0].pos) return s[0].color;
		for (let i = 1; i < s.length; i++) {
			if (t <= s[i].pos) {
				const k = (t - s[i - 1].pos) / Math.max(1e-6, s[i].pos - s[i - 1].pos);
				const a = hexToRgb(s[i - 1].color);
				const b = hexToRgb(s[i].color);
				return rgbToHex([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
			}
		}
		return s[s.length - 1].color;
	}

	function posFromEvent(e: PointerEvent | MouseEvent): number {
		const r = bar.value!.getBoundingClientRect();
		return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
	}

	/** Eyedropper: the ramp's colour under the pointer. */
	function colorUnder(e: MouseEvent): string {
		return colorAt(posFromEvent(e));
	}

	function addStop(e: MouseEvent): void {
		if (stops.value.length >= MAX_GRADIENT_STOPS) return;
		const pos = posFromEvent(e);
		const g = clone();
		g.stops.push({ pos, color: colorAt(pos) });
		selected.value = g.stops.length - 1;
		update(g, true);
	}

	let dragIndex = -1;
	function onStopDown(e: PointerEvent, i: number): void {
		selected.value = i;
		dragIndex = i;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onStopMove(e: PointerEvent): void {
		if (dragIndex < 0) return;
		const g = clone();
		g.stops[dragIndex].pos = Number(posFromEvent(e).toFixed(4));
		update(g);
	}
	function onStopUp(e: PointerEvent): void {
		if (dragIndex < 0) return;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		dragIndex = -1;
		update(clone(), true);
	}

	function setColor(c: string, commit: boolean): void {
		const g = clone();
		g.stops[selected.value].color = c;
		update(g, commit);
	}
	function setPos(p: number, commit: boolean): void {
		const g = clone();
		g.stops[selected.value].pos = p;
		update(g, commit);
	}
	function removeStop(): void {
		if (stops.value.length <= 1) return;
		const g = clone();
		g.stops.splice(selected.value, 1);
		selected.value = Math.max(0, selected.value - 1);
		update(g, true);
	}
	function reverse(): void {
		const g = clone();
		g.stops = g.stops.map((s) => ({ ...s, pos: Number((1 - s.pos).toFixed(4)) }));
		update(g, true);
	}
</script>

<template>
	<div class="grad">
		<div
			ref="bar"
			v-pick="colorUnder"
			class="bar"
			:style="{ background: css }"
			title="Click to add a stop"
			@click="addStop" />
		<div class="stops">
			<button
				v-for="(s, i) in stops"
				:key="i"
				type="button"
				class="stop"
				:class="{ sel: i === selected }"
				:style="{ left: `${s.pos * 100}%` }"
				:aria-label="`Stop ${i + 1} at ${(s.pos * 100).toFixed(0)}%`"
				@pointerdown="onStopDown($event, i)"
				@pointermove="onStopMove"
				@pointerup="onStopUp"
				@pointercancel="onStopUp">
				<svg width="12" height="16" viewBox="0 0 16 28" aria-hidden="true">
					<path
						d="M8 3 L15 10 L15 18 L8 25 L1 18 L1 10 Z"
						:fill="s.color"
						:stroke="i === selected ? 'var(--e100)' : 'var(--line-strong)'"
						stroke-width="2" />
				</svg>
			</button>
		</div>
		<div v-if="sel" class="edit">
			<ColorField
				:model-value="sel.color"
				:label="`${label ?? 'Ramp'} stop`"
				@update:model-value="setColor($event, false)"
				@commit="setColor($event, true)" />
			<NumberField
				class="pos"
				:model-value="sel.pos"
				:min="0"
				:max="1"
				:step="0.01"
				label="Stop position"
				@update:model-value="setPos($event, false)"
				@commit="setPos($event, true)" />
			<button type="button" class="cf-ico-btn" title="Reverse" aria-label="Reverse ramp" @click="reverse">
				<IconArrowsLeftRight :size="13" />
			</button>
			<button
				type="button"
				class="cf-ico-btn danger"
				title="Remove stop"
				aria-label="Remove stop"
				:disabled="stops.length <= 1"
				@click="removeStop">
				<IconTrash :size="13" />
			</button>
		</div>
	</div>
</template>

<style scoped>
	.grad {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.bar {
		height: 18px;
		border: 1px solid var(--line);
		border-radius: var(--r-field);
		box-shadow: inset 0 0 0 1px rgba(17, 19, 22, 0.5);
		cursor: copy;
	}
	.stops {
		position: relative;
		height: 16px;
		margin: 0 6px;
	}
	.stop {
		position: absolute;
		top: 0;
		width: 12px;
		height: 16px;
		margin-left: -6px;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: ew-resize;
		touch-action: none;
	}
	.stop.sel {
		filter: var(--drop-halo);
	}
	.edit {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.edit > :first-child {
		flex: 1;
		min-width: 0;
	}
	.edit :deep(.swatch) {
		width: 24px;
	}
	.pos {
		flex: none;
		width: 76px;
	}
</style>
