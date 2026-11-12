<script setup lang="ts">
	// Blender-style number field: drag to scrub (Shift = fine, Ctrl = snap to the range's divisions — 0.1 on 0–1, 10 on
	// 0–360, see snapDivision), click to type, arrows to step (Ctrl = to the next division). Dragging pauses at the
	// soft range's ends (softMin / softMax) like a notch, for NOTCH_PX, then goes on to the hard min or max; typing and the
	// arrows go past them freely. Double-click goes back to the value before the last change — again to return —
	// or, if the field hasn't been changed, to its default. The fill bar shows the value within its soft range.
	import { computed, nextTick, ref } from 'vue';
	import { IconChevronLeft, IconChevronRight } from '@tabler/icons-vue';
	import { snapDivision, snapStep, snapTo } from '@/ui/snap';

	/** Previous values by memory key, so they outlive the field (the inspector rebuilds its fields on reselect). */
	const previousByKey = new Map<string, number>();
	/** How far (px) a drag holds at a soft limit before carrying on past it. */
	const NOTCH_PX = 12;

	const props = withDefaults(
		defineProps<{
			modelValue: number;
			min?: number;
			max?: number;
			softMin?: number;
			softMax?: number;
			step?: number;
			unit?: string;
			int?: boolean;
			label?: string;
			/** Double-click target when the field has no previous value yet. */
			defaultValue?: number;
			/** Where to remember the previous value (e.g. owner + param key); without one it lives in the component. */
			memoryKey?: string;
		}>(),
		{ unit: '', int: false }
	);

	const emit = defineEmits<{
		(e: 'update:modelValue', v: number): void;
	}>();

	const track = ref<HTMLElement | null>(null);
	const input = ref<HTMLInputElement | null>(null);
	const editing = ref(false);
	const draft = ref('');
	const dragging = ref(false);

	const lo = computed(() => props.softMin ?? props.min ?? 0);
	const hi = computed(() => props.softMax ?? props.max ?? 1);
	const hasRange = computed(() => Number.isFinite(lo.value) && Number.isFinite(hi.value) && hi.value > lo.value);
	const frac = computed(() =>
		hasRange.value ? Math.min(1, Math.max(0, (props.modelValue - lo.value) / (hi.value - lo.value))) : 0
	);

	const stepSize = computed(() => {
		if (props.int) return Math.max(1, props.step ?? 1);
		if (props.step) return props.step;
		return hasRange.value ? (hi.value - lo.value) / 100 : 0.01;
	});

	/** What Ctrl snaps to, from the soft range the fill bar shows. */
	const division = computed(() => snapDivision(hasRange.value ? hi.value - lo.value : 0, props.int));

	const decimals = computed(() => {
		if (props.int) return 0;
		const s = stepSize.value;
		if (s >= 1) return 1;
		return Math.min(4, Math.max(1, Math.ceil(-Math.log10(s))));
	});

	const display = computed(() => {
		const v = props.modelValue;
		if (!Number.isFinite(v)) return '—';
		const txt = props.int ? String(Math.round(v)) : v.toFixed(decimals.value);
		return props.unit ? `${txt} ${props.unit}` : txt;
	});

	function clamp(v: number): number {
		if (props.min !== undefined) v = Math.max(props.min, v);
		if (props.max !== undefined) v = Math.min(props.max, v);
		if (props.int) v = Math.round(v);
		return v;
	}

	function round(v: number, snap: number): number {
		return Math.round(v / snap) * snap;
	}

	/** The latest value set (the prop catches up a render later). */
	let current = props.modelValue;

	function set(v: number): void {
		const c = clamp(Number(v.toFixed(6)));
		current = c;
		if (c !== props.modelValue) emit('update:modelValue', c);
	}

	// ---------------------------------------------------------------- previous value (double-click)
	const localPrevious = ref<number | undefined>();
	const getPrevious = () => (props.memoryKey ? previousByKey.get(props.memoryKey) : localPrevious.value);
	function setPrevious(v: number): void {
		if (props.memoryKey) previousByKey.set(props.memoryKey, v);
		else localPrevious.value = v;
	}
	/** Value when the current change began (drag, typing, step), null outside a change. */
	let before: number | null = null;
	function begin(): void {
		if (before === null) before = props.modelValue;
		current = props.modelValue;
	}
	function end(): void {
		if (before !== null && Number.isFinite(before) && current !== before) setPrevious(before);
		before = null;
	}

	function restorePrevious(): void {
		if (editing.value) {
			editing.value = false;
			before = null;
		}
		const target = getPrevious() ?? props.defaultValue;
		if (target === undefined || !Number.isFinite(target) || target === props.modelValue) return;
		setPrevious(props.modelValue);
		set(target);
	}

	function nudge(dir: number, e?: MouseEvent | KeyboardEvent): void {
		begin();
		const v = props.modelValue;
		// Ctrl: to the next division in that direction.
		const next = e && (e.ctrlKey || e.metaKey) ? snapStep(v, division.value, dir) : v + dir * stepSize.value;
		set(next);
		end();
	}

	let startX = 0;
	let startValue = 0;
	let moved = false;

	function onDown(e: PointerEvent): void {
		if (editing.value || e.button !== 0) return;
		startX = e.clientX;
		startValue = props.modelValue;
		moved = false;
		begin();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onMove(e: PointerEvent): void {
		if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
		const dx = e.clientX - startX;
		if (!moved && Math.abs(dx) < 3) return;
		moved = true;
		dragging.value = true;
		const width = track.value?.clientWidth ?? 200;
		let perPx: number;
		if (hasRange.value) perPx = (hi.value - lo.value) / width;
		else perPx = stepSize.value / 2;
		if (e.shiftKey) perPx *= 0.1;
		let v = startValue + dx * perPx;
		// The soft limits are notches: crossing one, the value holds there for NOTCH_PX, then carries on towards the hard
		// limit (set clamps to it). Taken in the order the drag meets them, each one it has passed holding it back.
		if (hasRange.value) {
			const eps = Math.max(1e-9, (hi.value - lo.value) * 1e-6);
			const hold = NOTCH_PX * perPx;
			const notches = [
				props.softMin !== props.min ? props.softMin : undefined,
				props.softMax !== props.max ? props.softMax : undefined
			]
				.filter((L): L is number => L !== undefined && Math.abs(startValue - L) > eps)
				.sort((a, b) => (v > startValue ? a - b : b - a));
			for (const L of notches) {
				if (startValue < L && v > L) v = Math.max(L, v - hold);
				else if (startValue > L && v < L) v = Math.min(L, v + hold);
			}
		}
		if (e.ctrlKey || e.metaKey) v = snapTo(v, division.value);
		else if (!props.int) v = round(v, stepSize.value / 10);
		set(v);
	}

	function onUp(e: PointerEvent): void {
		const el = e.currentTarget as HTMLElement;
		if (!el.hasPointerCapture(e.pointerId)) return;
		el.releasePointerCapture(e.pointerId);
		if (moved) {
			dragging.value = false;
			end();
		} else {
			before = null;
			startEdit();
		}
	}

	async function startEdit(): Promise<void> {
		begin();
		editing.value = true;
		draft.value = props.int
			? String(Math.round(props.modelValue))
			: String(Number(props.modelValue.toFixed(decimals.value + 2)));
		await nextTick();
		input.value?.focus();
		input.value?.select();
	}

	/** Keys in the text box stay there: Enter / Esc finish, arrows move the caret (the track's keys would reopen the
	 * editor or nudge the value). */
	function onEditKey(e: KeyboardEvent): void {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			finishEdit(true);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			finishEdit(false);
		}
	}

	function finishEdit(apply: boolean): void {
		if (!editing.value) return;
		editing.value = false;
		if (!apply) {
			before = null;
			return;
		}
		const txt = draft.value
			.trim()
			.replace(/[a-z°%×]+$/i, '')
			.trim();
		// Allow simple arithmetic like "64/3" or "8*2".
		let v = Number(txt);
		if (!Number.isFinite(v) && /^[-+*/().\d\s]+$/.test(txt)) {
			try {
				v = Function(`"use strict"; return (${txt})`)() as number;
			} catch {
				v = NaN;
			}
		}
		if (Number.isFinite(v)) set(v);
		end();
	}
</script>

<template>
	<div class="nf" :class="{ dragging, editing }">
		<button
			type="button"
			class="arrow"
			tabindex="-1"
			:aria-label="`Decrease ${label ?? ''}`"
			@click="nudge(-1, $event)">
			<IconChevronLeft :size="11" />
		</button>
		<div
			ref="track"
			class="track"
			role="slider"
			tabindex="0"
			:aria-label="label"
			:aria-valuenow="modelValue"
			:aria-valuemin="min"
			:aria-valuemax="max"
			@pointerdown="onDown"
			@pointermove="onMove"
			@pointerup="onUp"
			@pointercancel="onUp"
			@dblclick.prevent="restorePrevious"
			@keydown.enter.prevent="startEdit"
			@keydown.left.prevent="nudge(-1, $event)"
			@keydown.right.prevent="nudge(1, $event)">
			<div v-if="hasRange" class="fill" :style="{ width: `${frac * 100}%` }" />
			<input
				autocomplete="off"
				data-1p-ignore
				v-if="editing"
				ref="input"
				v-model="draft"
				class="edit"
				@keydown="onEditKey"
				@blur="finishEdit(true)" />
			<span v-else class="val">{{ display }}</span>
		</div>
		<button type="button" class="arrow" tabindex="-1" :aria-label="`Increase ${label ?? ''}`" @click="nudge(1, $event)">
			<IconChevronRight :size="11" />
		</button>
	</div>
</template>

<style scoped>
	.nf {
		display: flex;
		align-items: stretch;
		height: 22px;
		min-width: 0;
		user-select: none;
		-webkit-user-select: none;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--sunken);
		overflow: hidden;
	}
	.nf:hover {
		border-color: var(--line);
	}
	.nf.dragging,
	.nf.editing,
	.nf:focus-within {
		border-color: var(--accent);
		box-shadow: var(--halo);
	}
	.arrow {
		width: 16px;
		flex: none;
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--text-lo);
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
	}
	.nf:hover .arrow {
		opacity: 1;
	}
	.arrow:hover {
		color: var(--text-hi);
		background: var(--hairline);
	}
	.arrow .tabler-icon {
		stroke-width: 2;
	}
	.track {
		position: relative;
		flex: 1;
		min-width: 0;
		cursor: ew-resize;
		display: flex;
		align-items: center;
		justify-content: center;
		user-select: none;
		touch-action: none;
	}
	.track:focus-visible {
		outline: none;
	}
	.fill {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		background: var(--hairline);
		pointer-events: none;
	}
	.nf.dragging .fill {
		background: #3e454b;
	}
	.val {
		position: relative;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-hi);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
	}
	.edit {
		position: relative;
		width: 100%;
		height: 100%;
		border: 0;
		background: transparent;
		color: var(--text-hi);
		font-family: var(--font-mono);
		font-size: 12px;
		text-align: center;
		padding: 0 4px;
		outline: none;
		cursor: text;
		user-select: text;
		-webkit-user-select: text;
	}
</style>
