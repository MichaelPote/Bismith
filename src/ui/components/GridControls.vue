<script setup lang="ts">
	// Shaping › Area's grid controls for an Area layer (FR8.30; LayerDef.area): how many columns and rows its grid has,
	// and the edits that are clumsy to make by hand on the canvas — even out the sizes, clear the merges (layers whose
	// grid is their layout), switch every cell on again, and reset the area to the whole canvas. Shown only when they
	// would change something. The grid's lines, merges and cells are otherwise edited with the grid gizmo.
	import { computed } from 'vue';
	import { IconArrowsMaximize, IconEye, IconLayoutDistributeHorizontal, IconSquaresDiagonal } from '@tabler/icons-vue';
	import type { Layer } from '@/core/project';
	import { MAX_GRID, areaPx, evenOut, gridOf, gridParams, setCount, type Axis, type Grid } from '@/core/grid';
	import { getLayerDef } from '@/layers/registry';
	import { useProjectStore } from '@/stores/project';
	import { vTip } from '@/ui/tooltip';
	import NumberField from './NumberField.vue';

	const props = defineProps<{ layer: Layer; width: number; height: number }>();
	const store = useProjectStore();

	const grid = computed<Grid>(() => gridOf(props.layer.params));
	const layout = computed(() => getLayerDef(props.layer.type)?.area === 'layout');
	const uneven = computed(() => {
		const g = grid.value;
		const off = (s: number[]) => s.some((v, _i, a) => Math.abs(v - 1 / a.length) > 1e-4);
		return off(g.cols) || off(g.rows);
	});
	const anyOff = computed(() => grid.value.off.some((b) => b !== 0));
	const partial = computed(() => !areaPx(props.layer.params, props.width, props.height).full);

	function write(next: Grid): void {
		for (const [k, v] of Object.entries(gridParams(next)))
			if (props.layer.params[k] !== v) store.setLayerParam(props.layer.id, k, v);
	}
	const count = (axis: Axis, n: number) => write(setCount(grid.value, axis, n));
	const allOn = () => write({ ...grid.value, off: grid.value.off.map(() => 0) });
	function wholeCanvas(): void {
		const whole: Record<string, number> = { area_x: 0, area_y: 0, area_w: 1, area_h: 1 };
		for (const [k, v] of Object.entries(whole))
			if (props.layer.params[k] !== v) store.setLayerParam(props.layer.id, k, v);
	}
</script>

<template>
	<div class="grid-controls">
		<div class="row">
			<span
				v-tip="'Sets how many columns the grid has: added ones share the space evenly, removed ones go from the right'"
				class="lbl"
				>Columns</span
			>
			<NumberField
				:model-value="grid.cols.length"
				:min="1"
				:max="MAX_GRID"
				int
				label="Columns"
				:default-value="1"
				@update:model-value="count('col', $event)" />
		</div>
		<div class="row">
			<span
				v-tip="'Sets how many rows the grid has: added ones share the space evenly, removed ones go from the bottom'"
				class="lbl"
				>Rows</span
			>
			<NumberField
				:model-value="grid.rows.length"
				:min="1"
				:max="MAX_GRID"
				int
				label="Rows"
				:default-value="1"
				@update:model-value="count('row', $event)" />
		</div>
		<div v-if="uneven || (layout && grid.merges.length) || anyOff || partial" class="row">
			<span class="lbl" />
			<div class="acts">
				<button
					v-if="uneven"
					v-tip:top="'Makes every column the same width and every row the same height (merges stay)'"
					type="button"
					class="act"
					@click="write(evenOut(grid))">
					<IconLayoutDistributeHorizontal :size="13" />Even out
				</button>
				<button
					v-if="layout && grid.merges.length"
					v-tip:top="'Breaks every merged panel back into single cells'"
					type="button"
					class="act"
					@click="write({ ...grid, merges: [] })">
					<IconSquaresDiagonal :size="13" />Clear merged
				</button>
				<button v-if="anyOff" v-tip:top="'Switches every cell back on'" type="button" class="act" @click="allOn">
					<IconEye :size="13" />All cells on
				</button>
				<button
					v-if="partial"
					v-tip:top="'Makes the area the whole canvas again'"
					type="button"
					class="act"
					@click="wholeCanvas">
					<IconArrowsMaximize :size="13" />Reset Size
				</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
	/* As ParamList's rows: label right-aligned in 88 px, the control beside it. */
	.grid-controls {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 2px;
	}
	.row {
		display: grid;
		grid-template-columns: 88px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
	}
	.lbl {
		font-size: 12px;
		color: var(--text-lo);
		text-align: right;
		white-space: nowrap;
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
	.lbl:hover {
		color: var(--text);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 2px 0;
	}
	.act {
		height: 22px;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0 6px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--sunken);
		color: var(--text-mid);
		font-size: 11px;
		white-space: nowrap;
	}
	.act svg {
		color: var(--text-lo);
	}
	.act:hover {
		border-color: var(--line);
		background: var(--raised);
		color: var(--text-hi);
	}
	.act:hover svg {
		color: var(--e300);
	}
	.act:active {
		background: var(--deep);
	}
	.act:focus-visible {
		outline: 1px solid var(--e100);
		outline-offset: 1px;
	}
</style>
