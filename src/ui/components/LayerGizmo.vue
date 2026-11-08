<script setup lang="ts">
	// The selected layer's viewport gizmo (Create workspace; geometry in src/ui/gizmos.ts): a move dot, a rotation knob, a
	// line's or curve's two ends, a gradient's arrow, a fold axis or a cable's centre line. Dragging a handle sets the
	// layer's own placement sliders. Ctrl (⌘) snaps: angles to 15°, the move dot to half pixels.
	import { computed, onBeforeUnmount } from 'vue';
	import type { Layer, Project } from '@/core/project';
	import { useProjectStore } from '@/stores/project';
	import { endTo, layerGizmo, moveTo, turnTo, type ParamPatch, type Pt } from '@/ui/gizmos';

	const props = defineProps<{
		layer: Layer;
		project: Project;
		/** The texture's rectangle on screen (CSS px, relative to the stage). */
		rect: { x: number; y: number; w: number; h: number };
		size: { w: number; h: number };
	}>();

	const store = useProjectStore();

	/** The rotation knob's distance from the move dot (CSS px). */
	const KNOB = 46;
	/** Ctrl (⌘) snaps angles to this step, as the sun gizmo does. */
	const ANGLE_SNAP = 15;

	const g = computed(() => layerGizmo(props.layer, props.project));

	function toScreen(p: Pt): Pt {
		return [
			props.rect.x + (p[0] / props.project.width) * props.rect.w,
			props.rect.y + (p[1] / props.project.height) * props.rect.h
		];
	}
	function toTex(p: Pt): Pt {
		return [
			((p[0] - props.rect.x) / props.rect.w) * props.project.width,
			((p[1] - props.rect.y) / props.rect.h) * props.project.height
		];
	}

	const centre = computed<Pt | null>(() => (g.value ? toScreen(g.value.move) : null));
	const dir = computed<Pt | null>(() => {
		const t = g.value?.turn;
		return t === undefined ? null : [Math.cos((t * Math.PI) / 180), Math.sin((t * Math.PI) / 180)];
	});
	const knob = computed<Pt | null>(() =>
		centre.value && dir.value ? [centre.value[0] + dir.value[0] * KNOB, centre.value[1] + dir.value[1] * KNOB] : null
	);
	const ends = computed<[Pt, Pt] | null>(() =>
		g.value?.ends ? [toScreen(g.value.ends[0]), toScreen(g.value.ends[1])] : null
	);
	/** A fold axis or a cable's centre line: through the move dot, across the whole view. */
	const axis = computed(() => {
		if (!g.value?.axis || !centre.value || !dir.value) return null;
		const r = Math.hypot(props.size.w, props.size.h);
		const [cx, cy] = centre.value;
		const [dx, dy] = dir.value;
		return { x1: cx - dx * r, y1: cy - dy * r, x2: cx + dx * r, y2: cy + dy * r };
	});
	/** A gradient's arrow head at the knob. */
	const arrowHead = computed(() => {
		if (!g.value?.arrow || !knob.value || !dir.value) return null;
		const [x, y] = knob.value;
		const [dx, dy] = dir.value;
		const s = 9;
		return `M${x + dx * 4} ${y + dy * 4}L${x - dx * s - dy * s * 0.6} ${y - dy * s + dx * s * 0.6}L${x - dx * s + dy * s * 0.6} ${y - dy * s - dx * s * 0.6}Z`;
	});

	type Part = 'move' | 'turn' | 'end0' | 'end1';
	let drag: { part: Part; id: number; grab: Pt; fixed?: Pt; pivot?: Pt; svg: DOMRect } | null = null;
	let last: { x: number; y: number; ctrl: boolean } = { x: 0, y: 0, ctrl: false };

	function onDown(e: PointerEvent, part: Part): void {
		if (e.button !== 0 || !g.value) return;
		e.stopPropagation();
		e.preventDefault();
		// preventDefault keeps the focus where it is: a field still being typed in would keep Ctrl+Z from reaching the
		// editor. Finished first, its value is an undo step of its own.
		(document.activeElement as HTMLElement | null)?.blur();
		store.commitNow();
		const svg = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
		// Grab offset: the handle stays where it was taken rather than jumping to the pointer.
		const at: Pt = [e.clientX - svg.left, e.clientY - svg.top];
		const h = part === 'move' ? centre.value! : part === 'turn' ? knob.value! : ends.value![part === 'end0' ? 0 : 1];
		drag = { part, id: e.pointerId, grab: [h[0] - at[0], h[1] - at[1]], svg };
		if (part === 'end0' || part === 'end1') drag.fixed = g.value.ends![part === 'end0' ? 1 : 0];
		// Turning: about the move dot where it is now (a cable's dot would otherwise move as it turns).
		if (part === 'turn') drag.pivot = g.value.move;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		window.addEventListener('keydown', onKey);
		window.addEventListener('keyup', onKey);
	}

	function apply(): void {
		if (!drag) return;
		const scr: Pt = [last.x - drag.svg.left + drag.grab[0], last.y - drag.svg.top + drag.grab[1]];
		const at = toTex(scr);
		const snap = last.ctrl ? ANGLE_SNAP : 0;
		let patch: ParamPatch;
		if (drag.part === 'move') {
			patch = moveTo(
				props.layer,
				props.project,
				last.ctrl ? [Math.round(at[0] * 2) / 2, Math.round(at[1] * 2) / 2] : at
			);
		} else if (drag.part === 'turn') {
			patch = turnTo(props.layer, props.project, at, snap, drag.pivot);
		} else {
			patch = endTo(props.layer, props.project, drag.part === 'end0' ? 0 : 1, at, snap, drag.fixed);
		}
		for (const [k, v] of Object.entries(patch))
			if (props.layer.params[k] !== v) store.setLayerParam(props.layer.id, k, v);
	}

	function onMove(e: PointerEvent): void {
		if (!drag || e.pointerId !== drag.id) return;
		last = { x: e.clientX, y: e.clientY, ctrl: e.ctrlKey || e.metaKey };
		apply();
	}
	/** Pressing or releasing Ctrl mid-drag re-applies without a move. */
	function onKey(e: KeyboardEvent): void {
		if (!drag || (e.key !== 'Control' && e.key !== 'Meta') || e.repeat) return;
		last = { ...last, ctrl: e.ctrlKey || e.metaKey };
		apply();
	}
	function onUp(e: PointerEvent): void {
		if (!drag || e.pointerId !== drag.id) return;
		end();
	}
	function end(): void {
		drag = null;
		window.removeEventListener('keydown', onKey);
		window.removeEventListener('keyup', onKey);
	}
	onBeforeUnmount(end);
</script>

<template>
	<svg
		v-if="g && centre"
		class="layer-gizmo"
		:width="size.w"
		:height="size.h"
		@pointermove="onMove"
		@pointerup="onUp"
		@pointercancel="onUp">
		<line v-if="axis" v-bind="axis" class="axis" />
		<template v-if="ends">
			<line :x1="ends[0][0]" :y1="ends[0][1]" :x2="ends[1][0]" :y2="ends[1][1]" class="guide" />
			<g v-for="(p, i) in ends" :key="i" class="handle" @pointerdown="onDown($event, i === 0 ? 'end0' : 'end1')">
				<circle :cx="p[0]" :cy="p[1]" r="11" class="hit" />
				<rect :x="p[0] - 5" :y="p[1] - 5" width="10" height="10" class="end" />
			</g>
		</template>
		<template v-if="knob">
			<line
				v-if="!axis"
				:x1="centre[0]"
				:y1="centre[1]"
				:x2="knob[0]"
				:y2="knob[1]"
				class="stalk"
				:class="{ arrow: arrowHead }" />
			<g class="handle turn" @pointerdown="onDown($event, 'turn')">
				<circle :cx="knob[0]" :cy="knob[1]" r="11" class="hit" />
				<path v-if="arrowHead" :d="arrowHead" class="head" />
				<circle v-else :cx="knob[0]" :cy="knob[1]" r="5" class="knob" />
			</g>
		</template>
		<g class="handle" @pointerdown="onDown($event, 'move')">
			<circle :cx="centre[0]" :cy="centre[1]" r="11" class="ring" />
			<path :d="`M${centre[0] - 4.5} ${centre[1]}h9M${centre[0]} ${centre[1] - 4.5}v9`" class="cross" />
		</g>
	</svg>
</template>

<style scoped>
	.layer-gizmo {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: visible;
	}
	.handle {
		pointer-events: auto;
		cursor: move;
	}
	.handle.turn {
		cursor: grab;
	}
	.hit {
		fill: transparent;
	}
	.ring {
		fill: rgba(23, 25, 28, 0.55);
		stroke: var(--accent-hi);
		stroke-width: 1.5;
		filter: drop-shadow(0 0 4px rgba(246, 110, 16, 0.6));
	}
	.cross {
		stroke: var(--text-hi);
		stroke-width: 1.5;
	}
	.knob,
	.end {
		fill: var(--text-hi);
		stroke: var(--deep);
		stroke-width: 1;
	}
	.head {
		fill: var(--accent-hi);
		stroke: var(--deep);
		stroke-width: 1;
	}
	.handle:hover .knob,
	.handle:hover .end,
	.handle:hover .ring {
		stroke: var(--accent-hi);
	}
	.handle:hover .knob,
	.handle:hover .end {
		fill: var(--accent-hi);
	}
	.stalk,
	.guide {
		stroke: var(--text-hi);
		stroke-width: 1;
		stroke-dasharray: 3 3;
		opacity: 0.7;
		pointer-events: none;
	}
	.stalk.arrow {
		stroke: var(--accent-hi);
		stroke-dasharray: none;
		stroke-width: 1.5;
		opacity: 1;
	}
	.axis {
		stroke: var(--accent-hi);
		stroke-width: 1;
		stroke-dasharray: 6 4;
		opacity: 0.75;
		pointer-events: none;
	}
</style>
