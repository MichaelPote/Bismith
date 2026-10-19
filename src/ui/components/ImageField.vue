<script setup lang="ts">
	// An image file param (core/images.ts): a thumbnail and the file name, "Load…" to pick a PNG / JPEG / WebP (scaled down
	// to fit the texture, at most IMAGE_MAX px) and × to clear it. The value is the file name; a name this browser has no
	// image for shows as missing, so the file can be loaded again.
	import { computed, onBeforeUnmount, ref } from 'vue';
	import { IconPhoto, IconX } from '@tabler/icons-vue';
	import { IMAGE_MAX, fitImage, imageUrl, onImageReady, putImage } from '@/core/images';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore } from '@/stores/editor';

	const props = defineProps<{ modelValue: string; label?: string }>();
	const emit = defineEmits<{
		(e: 'update:modelValue', v: string): void;
		(e: 'commit', v: string): void;
	}>();

	const store = useProjectStore();
	const editor = useEditorStore();
	const input = ref<HTMLInputElement | null>(null);
	const busy = ref(false);
	/** Bumped when the library changes (an image loaded or decoded), so the thumbnail and "missing" follow. */
	const tick = ref(0);
	const off = onImageReady(() => tick.value++);
	onBeforeUnmount(off);

	const url = computed(() => (tick.value, props.modelValue ? imageUrl(props.modelValue) : undefined));
	const missing = computed(() => Boolean(props.modelValue) && !url.value);

	async function onPick(e: Event): Promise<void> {
		const el = e.target as HTMLInputElement;
		const file = el.files?.[0];
		el.value = '';
		if (!file) return;
		busy.value = true;
		try {
			const max = Math.min(IMAGE_MAX, Math.max(store.project.width, store.project.height));
			const img = await fitImage(file, max);
			putImage(file.name, img.url);
			tick.value++;
			emit('update:modelValue', file.name);
			emit('commit', file.name);
		} catch {
			editor.notify(`Could not read “${file.name}” as an image`, 'error');
		} finally {
			busy.value = false;
		}
	}

	function clear(): void {
		emit('update:modelValue', '');
		emit('commit', '');
	}
</script>

<template>
	<div class="image-field" :class="{ missing }">
		<span class="thumb">
			<img v-if="url" :src="url" alt="" />
			<IconPhoto v-else :size="14" />
		</span>
		<span class="name" :title="modelValue">{{
			modelValue ? (missing ? `${modelValue} — missing` : modelValue) : 'None'
		}}</span>
		<button
			type="button"
			class="cf-btn small"
			:disabled="busy"
			:aria-label="label ? `Load ${label}` : 'Load image'"
			@click="input?.click()">
			{{ missing ? 'Find…' : 'Load…' }}
		</button>
		<button v-if="modelValue" type="button" class="clear" aria-label="Clear the image" @click="clear">
			<IconX :size="12" />
		</button>
		<input ref="input" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onPick" />
	</div>
</template>

<style scoped>
	.image-field {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		height: 24px;
	}
	.thumb {
		flex: none;
		width: 22px;
		height: 22px;
		display: grid;
		place-items: center;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--sunken);
		color: var(--text-lo);
		overflow: hidden;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		image-rendering: pixelated;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		color: var(--text-hi);
	}
	.missing .name {
		color: var(--gold);
	}
	.cf-btn.small {
		height: 22px;
		padding: 0 8px;
		font-size: 11px;
	}
	.clear {
		flex: none;
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		background: none;
		color: var(--text-lo);
		cursor: pointer;
	}
	.clear:hover {
		color: var(--text-hi);
	}
</style>
