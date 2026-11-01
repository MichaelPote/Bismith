<script setup lang="ts">
	// The preset dialog (docs/features/fr5.4-presets.md, editor.presetDialog):
	//  - save: a card as a preset — name, description and category, beside its thumbnail, rendered off-screen on the
	//    standard rig (and the stage, for an item without relief of its own) while the user's project is left untouched;
	//  - edit (right-click on a preset's tile): its name, description and category, and optionally its settings retaken
	//    from the card the menu belongs to, with a new thumbnail. A built-in is read-only, so saving one makes the user's
	//    own copy;
	//  - template: the whole project as a project preset (a Starter in the new-project wizard), its thumbnail what the
	//    viewport shows;
	//  - manage: the user's presets — rename, describe, recategorise, delete — and Import… / Export mine… to a file.
	import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch } from 'vue';
	import type { PresetKind, Project } from '@/core/project';
	import { newId } from '@/core/ids';
	import { useEditorStore, type PresetSource } from '@/stores/editor';
	import { useProjectStore } from '@/stores/project';
	import { usePresetsStore } from '@/stores/presets';
	import { buildPreset, buildTemplate, presetItemOf } from '@/presets/apply';
	import { renderThumbnail } from '@/presets/thumbnail';
	import { capturePreview, PROJECT_PREVIEW } from '@/render/preview';
	import { downloadBlob } from '@/render/export';
	import { IconDownload, IconTrash, IconUpload, IconX } from '@tabler/icons-vue';
	import CheckField from '@/ui/components/CheckField.vue';
	import { vTip } from '@/ui/tooltip';

	const editor = useEditorStore();
	const store = useProjectStore();
	const presets = usePresetsStore();
	void presets.load();

	const mode = computed(() => editor.presetDialog!.mode);
	const KIND_LABEL: Record<PresetKind, string> = {
		project: 'Project template',
		layer: 'Layer',
		group: 'Group',
		light: 'Light',
		lighting: 'Lighting',
		post: 'Post filter'
	};
	/** Edit mode's "Update its settings to the current …". */
	const SOURCE_NOUN: Record<PresetSource['kind'], string> = {
		layer: 'layer',
		group: 'group',
		light: 'light',
		lighting: 'lighting',
		post: 'post filter'
	};

	// ---------------------------------------------------------------- save / edit / template
	const name = ref('');
	const description = ref('');
	const category = ref('');
	const thumb = ref<string | undefined>();
	const rendering = ref(false);
	/** The preset project being saved (its thumbnail rendered from it). */
	const draft = shallowRef<Project | null>(null);
	/** Edit mode: the preset (undefined once it is gone). */
	const edited = computed(() => {
		const d = editor.presetDialog;
		return d?.mode === 'edit' ? presets.entries.find((e) => e.key === d.key) : undefined;
	});
	/** Edit mode: replace the preset's settings with the card's (a fresh draft and thumbnail). */
	const replace = ref(false);
	/** Edit mode keeps the preset's thumbnail until its settings are replaced. */
	const shownThumb = computed(() => (mode.value === 'edit' && !replace.value ? edited.value?.preview : thumb.value));
	const saveKind = computed<PresetKind>(() => {
		const d = editor.presetDialog;
		if (d?.mode === 'edit') return edited.value?.kind ?? d.source.kind;
		return d?.mode === 'save' ? d.source.kind : 'project';
	});

	function defaultName(): string {
		const d = editor.presetDialog;
		const p = store.project;
		if (d?.mode === 'edit') return edited.value?.name ?? 'Preset';
		if (d?.mode !== 'save') return p.name;
		switch (d.source.kind) {
			case 'layer':
				return store.getLayer(d.source.id)?.name ?? 'Layer';
			case 'group':
				return store.getGroup(d.source.id)?.name ?? 'Group';
			case 'light':
				return store.getLight(d.source.id)?.name ?? 'Light';
			case 'lighting':
				return 'My lighting';
			case 'post': {
				const id = d.source.id;
				return p.post.find((f) => f.id === id)?.type ?? 'Post filter';
			}
		}
	}

	async function prepare(): Promise<void> {
		const d = editor.presetDialog;
		const project = toRaw(store.project);
		name.value = defaultName();
		if (d?.mode === 'template') {
			description.value = project.description ?? '';
			thumb.value = capturePreview(editor.engine, PROJECT_PREVIEW);
			return;
		}
		if (d?.mode === 'edit') {
			const e = edited.value;
			if (!e) return close();
			description.value = e.description ?? '';
			category.value = e.category ?? '';
			return;
		}
		if (d?.mode === 'save') await buildDraft(d.source);
	}

	/** The preset project of the card `source`, and its thumbnail. */
	async function buildDraft(source: PresetSource): Promise<void> {
		const project = toRaw(store.project);
		const item = presetItemOf(project, source);
		if (!item) return close();
		draft.value = buildPreset(project, item, { name: name.value });
		const engine = editor.engine;
		if (!engine) return;
		rendering.value = true;
		try {
			thumb.value = await renderThumbnail(engine, draft.value, toRaw(store.project));
		} catch (e) {
			editor.notify(`Thumbnail failed: ${e instanceof Error ? e.message : e}`, 'error');
		} finally {
			rendering.value = false;
		}
	}

	watch(replace, (on) => {
		const d = editor.presetDialog;
		if (on && !draft.value && d?.mode === 'edit') void buildDraft(d.source);
	});

	async function save(): Promise<void> {
		const meta = {
			name: name.value.trim() || defaultName(),
			description: description.value.trim() || undefined,
			category: category.value.trim() || undefined
		};
		if (mode.value === 'edit') return saveEdit(meta);
		let p: Project;
		if (mode.value === 'template') p = buildTemplate(toRaw(store.project), meta);
		else {
			if (!draft.value) return;
			p = { ...draft.value, name: meta.name };
			if (meta.description) p.description = meta.description;
			p.preset = { ...draft.value.preset!, ...(meta.category ? { category: meta.category } : {}) };
		}
		if (thumb.value) p.preview = thumb.value;
		await presets.save(p);
		editor.notify(
			presets.persistent
				? `Saved preset “${meta.name}”`
				: `Saved “${meta.name}” for this session only: this browser won’t store it`
		);
		close();
	}

	/**
	 * Edit mode: a user preset is updated in place (keeping its id); a built-in, or new settings, means writing the
	 * project afresh — for a built-in as the user's copy under a new id.
	 */
	async function saveEdit(meta: { name: string; description?: string; category?: string }): Promise<void> {
		const e = edited.value;
		if (!e) return close();
		if (!e.builtin && !replace.value) {
			await presets.update(e.key, { name: meta.name, description: description.value, category: category.value });
		} else {
			if (replace.value && !draft.value) return;
			const p = replace.value ? { ...draft.value! } : e.project();
			p.name = meta.name;
			if (meta.description) p.description = meta.description;
			else delete p.description;
			const header = { ...p.preset!, id: e.builtin ? newId('pr') : e.key.slice('user:'.length) };
			if (meta.category) header.category = meta.category;
			else delete header.category;
			p.preset = header;
			if (replace.value && thumb.value) p.preview = thumb.value;
			await presets.save(p);
		}
		editor.notify(e.builtin ? `Saved your copy of “${meta.name}”` : `Saved preset “${meta.name}”`);
		close();
	}

	async function removeEdited(): Promise<void> {
		const e = edited.value;
		if (e && (await remove(e.key, e.name))) close();
	}

	// ---------------------------------------------------------------- manage
	const filter = ref<PresetKind | 'all'>(
		editor.presetDialog?.mode === 'manage' ? (editor.presetDialog.kind ?? 'all') : 'all'
	);
	const mine = computed(() =>
		presets.entries
			.filter((e) => !e.builtin && (filter.value === 'all' || e.kind === filter.value))
			.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
	);
	const kindsInUse = computed(() => [...new Set(presets.entries.filter((e) => !e.builtin).map((e) => e.kind))]);

	function setField(key: string, field: 'name' | 'description' | 'category', value: string): void {
		void presets.update(key, { [field]: value });
	}

	async function remove(key: string, label: string): Promise<boolean> {
		if (!confirm(`Delete the preset “${label}”?`)) return false;
		await presets.remove(key);
		return true;
	}

	function exportMine(): void {
		const text = presets.exportText();
		downloadBlob(new Blob([text], { type: 'application/json' }), 'my.bismith-presets.json');
	}

	function importFile(): void {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json,application/json';
		input.onchange = async () => {
			const f = input.files?.[0];
			if (!f) return;
			try {
				const { added, skipped } = await presets.importText(await f.text());
				editor.notify(`Imported ${added} preset${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}`);
			} catch (e) {
				editor.notify(`Could not import: ${e instanceof Error ? e.message : e}`, 'error');
			}
		};
		input.click();
	}

	// ---------------------------------------------------------------- dialog
	function close(): void {
		editor.presetDialog = null;
	}
	const dialog = ref<HTMLElement | null>(null);
	function onKey(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	}
	onMounted(async () => {
		window.addEventListener('keydown', onKey, true);
		await nextTick();
		(dialog.value?.querySelector('input') as HTMLInputElement | null)?.select();
		void prepare();
	});
	onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
	<Teleport to="body">
		<div class="backdrop" @pointerdown.self="close">
			<div ref="dialog" class="dlg" :class="mode" role="dialog" aria-modal="true" aria-labelledby="preset-title">
				<header class="head">
					<h2 id="preset-title">
						{{
							mode === 'manage'
								? 'My presets'
								: mode === 'template'
									? 'Save as template'
									: mode === 'edit'
										? 'Edit preset'
										: 'Save as preset'
						}}
					</h2>
					<span v-if="mode !== 'manage'" class="kind">{{ KIND_LABEL[saveKind] }}</span>
					<span class="grow" />
					<button
						v-tip:left="{ body: 'Close', keys: 'Esc' }"
						type="button"
						class="cf-ico-btn"
						aria-label="Close"
						@click="close">
						<IconX :size="16" />
					</button>
				</header>

				<form v-if="mode !== 'manage'" class="save" @submit.prevent="save">
					<div class="thumb">
						<img v-if="shownThumb" :src="shownThumb" alt="Thumbnail" />
						<span v-else-if="rendering" class="spin" aria-label="Rendering the thumbnail" />
					</div>
					<div class="fields">
						<label>
							<span class="cf-label">Name</span>
							<input autocomplete="off" data-1p-ignore v-model="name" class="cf-field" required />
						</label>
						<label>
							<span class="cf-label">Description</span>
							<textarea v-model="description" class="cf-field" rows="3" />
						</label>
						<label>
							<span class="cf-label">Category</span>
							<input
								autocomplete="off"
								data-1p-ignore
								v-model="category"
								class="cf-field"
								list="preset-categories"
								placeholder="Other" />
							<datalist id="preset-categories">
								<option v-for="c in presets.categories(saveKind)" :key="c" :value="c" />
							</datalist>
						</label>
						<template v-if="mode === 'edit' && editor.presetDialog?.mode === 'edit'">
							<CheckField
								v-model="replace"
								:label="`Update its settings to the current ${SOURCE_NOUN[editor.presetDialog.source.kind]}`" />
							<p v-if="edited?.builtin" class="note-inline">
								Built-in presets can’t be changed: saving adds your own copy beside it.
							</p>
						</template>
						<p v-if="!presets.persistent" class="warn">
							This browser won’t store presets (private window or blocked site data): this one lasts for the session.
							Export it from "My presets" to keep it.
						</p>
						<div class="buttons">
							<button
								v-if="mode === 'edit' && edited && !edited.builtin"
								type="button"
								class="cf-btn delete"
								@click="removeEdited">
								<IconTrash :size="13" />Delete
							</button>
							<button type="button" class="cf-btn" @click="close">Cancel</button>
							<button type="submit" class="cf-btn primary" :disabled="rendering">
								{{ mode === 'edit' && edited?.builtin ? 'Save a copy' : 'Save' }}
							</button>
						</div>
					</div>
				</form>

				<div v-else class="manage">
					<div class="bar">
						<select v-model="filter" class="cf-field" aria-label="Show">
							<option value="all">All kinds</option>
							<option v-for="k in kindsInUse" :key="k" :value="k">{{ KIND_LABEL[k] }}</option>
						</select>
						<span class="grow" />
						<button type="button" class="cf-btn" @click="importFile"><IconUpload :size="13" />Import…</button>
						<button type="button" class="cf-btn" :disabled="!mine.length && filter === 'all'" @click="exportMine">
							<IconDownload :size="13" />Export mine…
						</button>
					</div>
					<p class="note">Your presets live in this browser. Export them to keep a copy or move them to another one.</p>
					<div class="rows">
						<div v-for="e in mine" :key="e.key" class="row">
							<img v-if="e.preview" :src="e.preview" alt="" class="mini" />
							<span v-else class="mini" />
							<div class="cols">
								<div class="line">
									<input
										autocomplete="off"
										data-1p-ignore
										class="cf-field nm"
										:value="e.name"
										aria-label="Name"
										@change="setField(e.key, 'name', ($event.target as HTMLInputElement).value)" />
									<input
										autocomplete="off"
										data-1p-ignore
										class="cf-field cat"
										:value="e.category ?? ''"
										placeholder="Other"
										aria-label="Category"
										@change="setField(e.key, 'category', ($event.target as HTMLInputElement).value)" />
									<span class="k">{{ KIND_LABEL[e.kind] }}{{ e.target ? ` · ${e.target}` : '' }}</span>
								</div>
								<input
									autocomplete="off"
									data-1p-ignore
									class="cf-field"
									:value="e.description ?? ''"
									placeholder="Description"
									aria-label="Description"
									@change="setField(e.key, 'description', ($event.target as HTMLInputElement).value)" />
							</div>
							<button
								v-tip:left="'Delete'"
								type="button"
								class="cf-ico-btn danger"
								aria-label="Delete preset"
								@click="remove(e.key, e.name)">
								<IconTrash :size="13" />
							</button>
						</div>
						<p v-if="!mine.length" class="empty">
							You don’t have any presets yet. Save one from a layer’s presets menu, or use File ▸ Save as template…
						</p>
					</div>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: rgba(17, 19, 22, 0.72);
	}
	.dlg {
		display: flex;
		flex-direction: column;
		width: min(520px, 100%);
		max-height: 100%;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 4px;
		box-shadow: 0 18px 48px rgba(8, 9, 10, 0.6);
	}
	.dlg.manage {
		width: min(720px, 100%);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 14px 10px 18px;
		border-bottom: 1px solid var(--hairline);
	}
	h2 {
		margin: 0;
		font-family: var(--font-serif);
		font-weight: 600;
		font-size: 20px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-hi);
	}
	.kind {
		font-size: 11px;
		color: var(--text-lo);
	}
	.grow {
		flex: 1;
	}
	.save {
		display: flex;
		gap: 16px;
		padding: 16px 18px 18px;
	}
	.thumb {
		flex: none;
		width: 160px;
		height: 160px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--sunken);
		border: 1px solid var(--deep);
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		image-rendering: pixelated;
	}
	.spin {
		width: 20px;
		height: 20px;
		border: 2px solid var(--hairline);
		border-top-color: var(--e400);
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
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
	.warn {
		margin: 0;
		font-size: 11.5px;
		color: var(--e300, var(--text));
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		margin-top: auto;
	}
	.cf-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.cf-btn.primary {
		border-color: var(--e400);
		color: var(--text-hi);
	}
	.cf-btn.delete {
		margin-right: auto;
	}
	.note-inline {
		margin: 0;
		font-size: 11.5px;
		color: var(--text-lo);
	}
	.manage {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 18px 6px;
	}
	.note {
		margin: 0;
		padding: 0 18px 8px;
		font-size: 11.5px;
		color: var(--text-lo);
	}
	.rows {
		overflow-y: auto;
		padding: 0 18px 16px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--base);
	}
	.mini {
		flex: none;
		width: 48px;
		height: 48px;
		object-fit: cover;
		image-rendering: pixelated;
		background: var(--sunken);
	}
	.cols {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.nm {
		flex: 2;
		min-width: 0;
	}
	.cat {
		flex: 1;
		min-width: 0;
	}
	.k {
		flex: none;
		font-size: 11px;
		color: var(--text-lo);
	}
	.empty {
		margin: 8px 0;
		font-size: 12px;
		color: var(--text-lo);
	}
</style>
