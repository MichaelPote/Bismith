<script setup lang="ts">
	import { useProjectStore } from '@/stores/project';
	import { LIGHTING_PRESETS } from '@/core/lightingPresets';
	import { vTip } from '@/ui/tooltip';

	const store = useProjectStore();

	function apply(id: string): void {
		const p = LIGHTING_PRESETS.find((x) => x.id === id);
		if (p) store.project.lighting = p.build();
	}
</script>

<template>
	<div class="lp">
		<button v-for="p in LIGHTING_PRESETS" :key="p.id" v-tip:top="p.hint" type="button" class="fk" @click="apply(p.id)">
			<span class="fk-face">{{ p.name }}</span>
		</button>
	</div>
</template>

<style scoped>
	.lp {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 3px;
	}
	.lp .fk {
		width: 100%;
	}
	.lp .fk-face {
		padding: 0 6px;
	}
</style>
