<script setup lang="ts">
	import { computed } from 'vue';
	import { useEditorStore } from '@/stores/editor';
	import { useProjectStore } from '@/stores/project';

	const editor = useEditorStore();
	const store = useProjectStore();
	const s = computed(() => editor.stats);
	const changes = computed(() => store.changedKeys.size);
</script>

<template>
	<footer class="status cf-panel cf-mono">
		<span
			><span class="k">Drag</span> pan · <span class="k">Wheel</span> zoom · <span class="k">F</span> fit ·
			<span class="k">T</span> tile · <span class="k">0–9</span> <span class="k">M</span> channels</span
		>
		<span
			><span class="k">Field</span> drag scrub · <span class="k">Shift</span> fine · <span class="k">Ctrl</span> snap ·
			<span class="k">Dbl-click</span> previous</span
		>
		<span class="grow" />
		<span v-if="s">eval {{ s.evalMs.toFixed(1) }} ms</span>
		<template v-if="store.variants.list.length > 1">
			<span class="sep">|</span>
			<span
				>variant <span class="hi">{{ store.activeVariant.name }}</span> ·
				{{
					store.activeVariant.id === store.variants.baseId ? 'base' : `${changes} change${changes === 1 ? '' : 's'}`
				}}</span
			>
		</template>
		<span class="sep">|</span>
		<span
			>{{ store.project.layers.length }} layers · {{ store.project.lighting.lights.length }} lights ·
			{{ store.project.post.length }} post</span
		>
		<span class="sep">|</span>
		<span class="hi">Bismith v0.1</span>
	</footer>
</template>

<style scoped>
	.status {
		flex: none;
		height: 24px;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 10px;
		font-size: 11px;
		color: var(--text-lo);
		white-space: nowrap;
		overflow: hidden;
	}
	.k {
		color: var(--pill);
	}
	.grow {
		flex: 1;
	}
	.sep {
		color: var(--line);
	}
	.hi {
		color: var(--text-hi);
	}
</style>
