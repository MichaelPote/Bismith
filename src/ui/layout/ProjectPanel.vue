<script setup lang="ts">
	// The project panel, top of the left column: what every variant shares — the project's name (its title; double-click
	// to rename; click it or its icon for the project settings), size and description (text until clicked). Its settings
	// are the Outliner's Project settings row, per variant.
	import { nextTick, ref } from 'vue';
	import { IconBox } from '@tabler/icons-vue';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore } from '@/stores/editor';
	import { supersampleFactor } from '@/core/supersample';
	import { vTip } from '@/ui/tooltip';
	import RenameInput from '@/ui/components/RenameInput.vue';

	const store = useProjectStore();
	const editor = useEditorStore();

	const renaming = ref(false);
	const renameText = ref('');

	/** Its RenameInput takes the focus as it appears. */
	function startRename(): void {
		renaming.value = true;
		renameText.value = store.project.name;
	}

	function finishRename(apply: boolean): void {
		if (!renaming.value) return;
		renaming.value = false;
		const name = renameText.value.trim();
		if (apply && name) store.project.name = name;
	}

	const editingDesc = ref(false);
	const descInput = ref<HTMLTextAreaElement | null>(null);

	async function startDescription(): Promise<void> {
		editingDesc.value = true;
		await nextTick();
		descInput.value?.focus();
	}

	/** Leave the description's text box, keeping what was typed unless `apply` is false (Esc). */
	function finishDescription(apply: boolean): void {
		if (!editingDesc.value) return;
		editingDesc.value = false;
		if (!apply) return;
		const t = descInput.value?.value.trim() ?? '';
		if (t === (store.project.description ?? '')) return;
		if (t) store.project.description = t;
		else delete store.project.description;
	}
</script>

<template>
	<section class="project cf-panel" aria-label="Project">
		<div class="head">
			<IconBox class="ident" :size="15" color="var(--accent-hi)" @click="editor.select('project')" />
			<RenameInput v-if="renaming" v-model="renameText" label="Project name" @finish="finishRename" />
			<h2
				v-else
				v-tip:right="'Project settings · double-click to rename'"
				class="title ident"
				@click="editor.select('project')"
				@dblclick="startRename">
				{{ store.project.name }}
			</h2>
			<span v-tip:right="'Texture size @ supersampling'" class="meta cf-mono"
				>{{ store.project.width }}×{{ store.project.height }} @{{ supersampleFactor(store.project) }}x</span
			>
		</div>
		<textarea
			v-if="editingDesc"
			ref="descInput"
			class="desc"
			rows="3"
			placeholder="Project description"
			aria-label="Project description"
			:value="store.project.description ?? ''"
			@keydown.esc.prevent="finishDescription(false)"
			@blur="finishDescription(true)" />
		<button
			v-else
			type="button"
			class="desc-text"
			:class="{ empty: !store.project.description }"
			aria-label="Edit the project description"
			@click="startDescription">
			{{ store.project.description || 'Add a description' }}
		</button>
	</section>
</template>

<style scoped>
	.project {
		display: flex;
		flex-direction: column;
		flex: none;
		overflow: hidden;
	}
	.head {
		height: 34px;
		flex: none;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 10px;
	}
	.title {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 14px;
		font-weight: 500;
		color: var(--accent-hi);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		user-select: none;
		-webkit-user-select: none;
	}
	.ident {
		flex: none;
		cursor: pointer;
	}
	.title.ident {
		flex: 1;
	}
	.meta {
		flex: none;
		font-size: 11px;
		color: var(--readout);
	}
	.desc {
		display: block;
		width: calc(100% - 20px);
		margin: 0 10px 8px;
		min-height: 24px;
		resize: vertical;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--sunken);
		color: var(--text-hi);
		padding: 4px 8px;
		font: inherit;
		font-size: 12px;
		line-height: 1.4;
	}
	.desc:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: var(--halo);
	}
	/* Read only until clicked: the text as it stands, a field's outline on hover. */
	.desc-text {
		display: block;
		width: calc(100% - 20px);
		margin: 0 10px 8px;
		padding: 4px 8px;
		border: 1px solid transparent;
		border-radius: var(--r-field);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: 12px;
		line-height: 1.4;
		text-align: left;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		cursor: text;
	}
	.desc-text:hover {
		border-color: var(--hairline);
		background: var(--sunken);
	}
	.desc-text:focus-visible {
		outline: none;
		border-color: var(--accent);
	}
	.desc-text.empty {
		color: var(--text-lo);
		font-style: italic;
	}
</style>
