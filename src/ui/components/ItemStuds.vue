<script setup lang="ts">
	// An inspector heading's studs for a layer, group, light or post filter (lock, move, ungroup, duplicate, delete):
	// the same actions as its Outliner row's right-click menu (ui/itemActions.ts).
	import { computed } from 'vue';
	import { useItemActions, type ItemKind } from '@/ui/itemActions';
	import { vTip } from '@/ui/tooltip';

	const props = defineProps<{ kind: ItemKind; id: string }>();
	const { actions } = useItemActions();
	const list = computed(() => actions(props.kind, props.id));
</script>

<template>
	<template v-for="(a, i) in list" :key="a.id">
		<span v-if="a.gapBefore && i > 0" class="vsep" />
		<button
			v-tip="a.tip"
			type="button"
			class="cf-ico-btn"
			:class="{ latched: a.latched, danger: a.danger }"
			:aria-label="a.aria"
			:aria-pressed="a.id === 'lock' ? a.latched : undefined"
			:disabled="a.disabled"
			@click="a.run">
			<component :is="a.icon" :size="16" />
		</button>
	</template>
</template>

<style scoped>
	.cf-ico-btn {
		width: 28px;
		height: 28px;
	}
	.vsep {
		width: 1px;
		height: 14px;
		margin: 0 3px;
		background: var(--hairline);
	}
</style>
