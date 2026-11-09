<script lang="ts">
	/** The last category used: presets tend to be exported in runs of one category. */
	let lastCategory = '';
</script>

<script setup lang="ts">
	// File ▸ Export as Preset… (dev server only: TopBar and App leave it out of a build): the open project as a built-in
	// project preset, written into public/presets/project/<category folder>/ by tools/dev-presets.ts.
	import { computed, onMounted, ref, toRaw, useId } from 'vue';
	import { useEditorStore } from '@/stores/editor';
	import { useProjectStore } from '@/stores/project';
	import { usePresetsStore } from '@/stores/presets';
	import { buildTemplate } from '@/presets/apply';
	import { loadBuiltinPresets } from '@/presets';
	import { PROJECT_PREVIEW, renderPreview } from '@/render/preview';
	import DialogFrame from '@/ui/components/DialogFrame.vue';

	const ROUTE = '/__dev/presets';
	const editor = useEditorStore();
	const store = useProjectStore();
	const presets = usePresetsStore();

	const name = ref(store.project.name);
	const description = ref(store.project.description ?? '');
	const category = ref(lastCategory);
	/** Typed over the name's slug, to replace a preset of another name. */
	const fileName = ref('');
	const thumb = ref<string | undefined>();
	const saving = ref(false);
	const listing = ref<{ categories: { folder: string; label: string }[]; files: string[] }>({
		categories: [],
		files: []
	});

	const slug = (s: string) =>
		s
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
	const file = computed(() => slug(fileName.value || name.value));
	const known = computed(() => {
		const typed = category.value.trim().toLowerCase();
		return listing.value.categories.find((c) => c.label.toLowerCase() === typed || c.folder === typed);
	});
	const folder = computed(() => known.value?.folder ?? slug(category.value));
	const path = computed(() => `${folder.value}/${file.value}`);
	const replaces = computed(() => listing.value.files.includes(path.value));
	const inFolder = computed(() =>
		listing.value.files.filter((f) => f.startsWith(`${folder.value}/`)).map((f) => f.split('/')[1])
	);
	const ready = computed(() => !!thumb.value && !!folder.value && !!file.value && !saving.value);

	function close(): void {
		editor.presetExport = false;
	}

	async function save(): Promise<void> {
		if (!ready.value) return;
		saving.value = true;
		try {
			const label = known.value?.label ?? category.value.trim();
			const built = buildTemplate(toRaw(store.project), {
				name: name.value.trim() || file.value,
				description: description.value.trim() || undefined,
				category: label
			});
			const { preset, preview: _old, ...rest } = built;
			const header = { ...preset!, id: file.value };
			// A built-in lighting preset's sky is found by name: no copy in the file.
			const owned = (await loadBuiltinPresets()).flatMap((b) => b.images ?? []);
			for (const n of owned) delete header.images?.[n];
			if (!Object.keys(header.images ?? {}).length) delete header.images;
			const r = await fetch(ROUTE, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					folder: folder.value,
					file: file.value,
					replace: replaces.value,
					project: { ...rest, preview: thumb.value, preset: header }
				})
			});
			const answer = (await r.json()) as { path?: string; error?: string };
			if (!r.ok) throw new Error(answer.error ?? String(r.status));
			lastCategory = label;
			await presets.reloadBuiltins();
			editor.notify(`Saved preset ${answer.path}`);
			close();
		} catch (e) {
			editor.notify(`Could not save the preset: ${e instanceof Error ? e.message : e}`, 'error');
		} finally {
			saving.value = false;
		}
	}

	const formId = useId();
	async function readListing(): Promise<void> {
		const r = await fetch(ROUTE);
		// Vite answers an unknown path with the page: a server started before tools/dev-presets.ts existed.
		if (!r.headers.get('content-type')?.includes('json')) throw new Error('restart the dev server');
		listing.value = await r.json();
	}
	const report = (e: unknown) =>
		editor.notify(`Could not prepare the preset: ${e instanceof Error ? e.message : e}`, 'error');
	onMounted(() => {
		readListing().catch(report);
		renderPreview(editor.engine, PROJECT_PREVIEW)
			.then((url) => (thumb.value = url))
			.catch(report);
	});
</script>

<template>
	<DialogFrame title="Export as Preset" meta="Dev only" width="520px" focus="input" @close="close">
		<form :id="formId" class="save" @submit.prevent="save">
			<div class="thumb">
				<img v-if="thumb" :src="thumb" alt="Thumbnail" />
			</div>
			<div class="fields">
				<label>
					<span class="cf-label">Category</span>
					<input
						autocomplete="off"
						data-1p-ignore
						v-model="category"
						class="cf-field"
						list="export-preset-categories"
						required />
					<datalist id="export-preset-categories">
						<option v-for="c in listing.categories" :key="c.folder" :value="c.label" />
					</datalist>
				</label>
				<label>
					<span class="cf-label">Name</span>
					<input autocomplete="off" data-1p-ignore v-model="name" class="cf-field" required />
				</label>
				<label>
					<span class="cf-label">Description</span>
					<textarea v-model="description" class="cf-field" rows="2" />
				</label>
				<label>
					<span class="cf-label">File</span>
					<input
						autocomplete="off"
						data-1p-ignore
						v-model="fileName"
						class="cf-field"
						list="export-preset-files"
						:placeholder="slug(name)" />
					<datalist id="export-preset-files">
						<option v-for="f in inFolder" :key="f" :value="f" />
					</datalist>
				</label>
				<p class="where" :class="{ warn: replaces }">
					<template v-if="replaces">Replaces presets/project/{{ path }}.json</template>
					<template v-else-if="folder">Saves to presets/project/{{ path }}.json</template>
				</p>
			</div>
		</form>
		<template #tray>
			<span class="grow" />
			<button type="button" class="gk" @click="close"><span class="gk-face">Cancel</span></button>
			<button type="submit" :form="formId" class="gk primary" :disabled="!ready">
				<span class="gk-face">{{ replaces ? 'Replace' : 'Save' }}</span>
			</button>
		</template>
	</DialogFrame>
</template>

<style scoped>
	.grow {
		flex: 1;
	}
	.save {
		display: flex;
		gap: 16px;
		padding: 0 16px 16px;
	}
	.thumb {
		flex: none;
		width: 160px;
		height: 160px;
		background: var(--sunken);
		border: 1px solid var(--deep);
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		image-rendering: pixelated;
	}
	.fields {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.fields label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.fields .cf-field {
		width: 100%;
	}
	textarea.cf-field {
		height: auto;
		padding: 4px 8px;
		resize: vertical;
		font: inherit;
		font-size: 12px;
	}
	.where {
		margin: 0;
		min-height: 14px;
		font-size: 11.5px;
		color: var(--text-lo);
		overflow-wrap: anywhere;
	}
	.where.warn {
		color: var(--e300, var(--text));
	}
</style>
