<script setup lang="ts">
	// An Outliner row's show / hide key (styled by the row: `.mini`).
	import { IconEye, IconEyeOff } from '@tabler/icons-vue';
	import { vTip } from '@/ui/tooltip';

	defineProps<{ on: boolean; tip: string; label: string }>();
	const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
	<button v-tip:right="tip" type="button" class="mini" :aria-label="label" @click.stop="emit('toggle')">
		<component :is="on ? IconEye : IconEyeOff" :size="14" />
	</button>
</template>
