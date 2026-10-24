<script setup lang="ts">
	// An image file param (core/images.ts): a thumbnail tile (the size of the lighting presets'), with the file name and
	// "Load…" below it to pick a PNG / JPEG / WebP (scaled down to fit the texture, at most IMAGE_MAX px) — or, for an
	// environment, also an EXR / HDR / Ultra HDR file, kept as a small Ultra HDR JPEG — and × to clear it. The value is the file name; a name this browser has no image for shows as missing, so the
	// file can be loaded again.
	import { computed, onBeforeUnmount, ref } from 'vue';
	import { IconPhoto, IconX } from '@tabler/icons-vue';
	import { IMAGE_MAX, fitImage, imageUrl, onImageReady, putImage } from '@/core/images';
	import { environmentFromFile } from '@/core/environment';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore } from '@/stores/editor';

	/** `environment`: HDR files accepted too, kept as a small Ultra HDR JPEG (core/environment.ts). */
	const props = defineProps<{ modelValue: string; label?: string; environment?: boolean }>();
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

	const accept = computed(() =>
		props.environment
			? '.exr,.hdr,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'
			: 'image/png,image/jpeg,image/webp'
	);
	const url = computed(() => (tick.value, props.modelValue ? imageUrl(props.modelValue) : undefined));
	const missing = computed(() => Boolean(props.modelValue) && !url.value);

	async function onPick(e: Event): Promise<void> {
		const el = e.target as HTMLInputElement;
		const file = el.files?.[0];
		el.value = '';
		if (!file) return;
		busy.value = true;
		try {
			const url = props.environment
				? await environmentFromFile(file)
				: (await fitImage(file, Math.min(IMAGE_MAX, Math.max(store.project.width, store.project.height)))).url;
			putImage(file.name, url);
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
		<!-- The thumbnail at the size of the lighting presets' tiles; clicking it browses too. -->
		<button
			type="button"
			class="thumb"
			:disabled="busy"
			:title="modelValue || 'Load an image'"
			:aria-label="label ? `Load ${label}` : 'Load image'"
			@click="input?.click()">
			<img v-if="url" :src="url" alt="" />
			<IconPhoto v-else :size="20" />
		</button>
		<span class="name" :title="modelValue">{{
			modelValue ? (missing ? `${modelValue} — missing` : modelValue) : 'None'
		}}</span>
		<span class="actions">
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
		</span>
		<input ref="input" type="file" :accept="accept" hidden @change="onPick" />
	</div>
</template>

<style scoped>
	.image-field {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		min-width: 0;
	}
	/* As a lighting preset tile (LightingPresets.vue): a square, the image cropped to fill it. */
	.thumb {
		flex: none;
		width: 72px;
		height: 72px;
		display: grid;
		place-items: center;
		padding: 3px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--sunken);
		color: var(--text-lo);
		overflow: hidden;
		cursor: pointer;
	}
	.thumb:hover,
	.thumb:focus-visible {
		background: var(--raised);
		color: var(--text-hi);
		outline: none;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 2px;
	}
	.name {
		max-width: 100%;
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
	.actions {
		display: flex;
		align-items: center;
		gap: 4px;
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
