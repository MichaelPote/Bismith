<script setup lang="ts">
	import { useId } from 'vue';
	defineProps<{ modelValue: boolean; label?: string }>();
	const emit = defineEmits<{
		(e: 'update:modelValue', v: boolean): void;
	}>();
	const id = useId();
	function onChange(e: Event): void {
		const v = (e.target as HTMLInputElement).checked;
		emit('update:modelValue', v);
	}
</script>

<template>
	<div class="cf-check">
		<input :id="id" type="checkbox" :checked="modelValue" @change="onChange" />
		<label v-if="label" :for="id">{{ label }}</label>
	</div>
</template>

<style scoped>
	.cf-check {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 22px;
		min-width: 0;
	}
	input {
		width: 14px;
		height: 14px;
		margin: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}
	label {
		font-size: 12px;
		color: var(--text);
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
