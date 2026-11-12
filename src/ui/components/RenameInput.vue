<script setup lang="ts">
	// A name edited in place (an Outliner row, a variant, the project): focused with its text selected when it appears.
	// Enter or leaving it applies (`finish` true), Esc cancels (`finish` false). Clicks stay in it, so the row under it
	// doesn't select or open its menu.
	import { onMounted, ref } from 'vue';

	defineProps<{ label: string }>();
	const emit = defineEmits<{ finish: [apply: boolean] }>();
	const text = defineModel<string>({ required: true });
	const input = ref<HTMLInputElement | null>(null);

	onMounted(() => {
		input.value?.focus();
		input.value?.select();
	});
</script>

<template>
	<input
		ref="input"
		v-model="text"
		autocomplete="off"
		data-1p-ignore
		class="rename"
		:aria-label="label"
		@click.stop
		@contextmenu.stop
		@keydown.enter.stop.prevent="emit('finish', true)"
		@keydown.esc.stop.prevent="emit('finish', false)"
		@blur="emit('finish', true)" />
</template>

<style scoped>
	.rename {
		flex: 1;
		min-width: 0;
		height: 24px;
		border: 1px solid var(--accent);
		border-radius: var(--r-field);
		background: var(--sunken);
		color: var(--text-hi);
		font-size: 12px;
		padding: 0 4px;
		outline: none;
		user-select: text;
		-webkit-user-select: text;
	}
</style>
