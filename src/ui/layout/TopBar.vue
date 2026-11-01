<script setup lang="ts">
	import { computed } from 'vue';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore } from '@/stores/editor';
	import { useActions } from '@/ui/actions';
	import { CHANNEL_VIEWS } from '@/render/display';
	import DropMenu, { type MenuItem } from '@/ui/components/DropMenu.vue';
	import {
		IconArrowBackUp,
		IconArrowForwardUp,
		IconDownload,
		IconLayoutGrid,
		IconStack2,
		IconTarget
	} from '@tabler/icons-vue';
	import { vTip } from '@/ui/tooltip';

	const store = useProjectStore();
	const editor = useEditorStore();
	const act = useActions();
	const logoSrc = `${import.meta.env.BASE_URL}logo-64.png`;

	const fileItems = computed<MenuItem[]>(() => {
		const items: MenuItem[] = [
			{ label: 'New project…', shortcut: 'Ctrl+Alt+N', action: () => (editor.wizard = true) },
			{ label: 'Open project…', shortcut: 'Ctrl+O', action: act.openProject },
			{ label: 'Save project', shortcut: 'Ctrl+S', action: act.saveProject },
			{ label: 'Save as template…', action: () => (editor.presetDialog = { mode: 'template' }) },
			{ label: 'My presets…', action: () => (editor.presetDialog = { mode: 'manage' }) },
			{ separator: true },
			{ label: 'Export PNG', shortcut: 'Ctrl+E', action: () => act.exportFinal(1) },
			{ label: 'Export PNG @4× (nearest)', action: () => act.exportFinal(4) },
			{ label: 'Export all maps (.zip)', action: act.exportAllMaps },
			{ label: 'Copy image', action: act.copyFinal },
			{ section: 'Export one map' },
			{ label: 'Diffuse (+ alpha)', action: () => act.exportMap('diffuse') },
			{ label: 'Height (normalised)', action: () => act.exportMap('height') },
			{ label: 'Roughness', action: () => act.exportMap('roughness') },
			{ label: 'Specular', action: () => act.exportMap('specular') },
			{ label: 'Metalness', action: () => act.exportMap('metalness') },
			{ label: 'Ambient occlusion', action: () => act.exportMap('ao') },
			{ label: 'Normal — OpenGL (Y+)', action: () => act.exportMap('normal-gl') },
			{ label: 'Normal — DirectX (Y−)', action: () => act.exportMap('normal-dx') },
			{ label: 'Emissive', action: () => act.exportMap('emissive') },
			{ label: 'Opacity', action: () => act.exportMap('opacity') }
		];
		return items;
	});

	const editItems = computed<MenuItem[]>(() => [
		{ label: 'Undo', shortcut: 'Ctrl+Z', disabled: !store.canUndo, action: store.undo },
		{ label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: !store.canRedo, action: store.redo },
		{ separator: true },
		{ label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !editor.selection.id, action: act.duplicateSelection },
		{ label: 'Delete', shortcut: 'Del', disabled: !editor.selection.id, action: act.deleteSelection }
	]);

	const viewItems = computed<MenuItem[]>(() => [
		{ section: 'Channel' },
		...CHANNEL_VIEWS.map((c) => ({
			label: c.label,
			shortcut: c.key,
			checked: editor.channel === c.id,
			action: () => (editor.channel = c.id)
		})),
		{ separator: true },
		{ label: 'Tile preview (5×5)', shortcut: 'T', checked: editor.tile, action: () => (editor.tile = !editor.tile) },
		{ label: 'Pixel grid', shortcut: 'G', checked: editor.grid, action: () => (editor.grid = !editor.grid) },
		{ label: 'Alpha checkerboard', checked: editor.checker, action: () => (editor.checker = !editor.checker) },
		{
			label: 'Preview up to selected layer',
			shortcut: 'S',
			checked: editor.solo,
			action: () => (editor.solo = !editor.solo)
		},
		{ separator: true },
		{ label: 'Fit to view', shortcut: 'F', action: editor.requestFit },
		{ label: 'Restart render', shortcut: 'R', action: () => editor.engine?.restart() }
	]);

	const WORKSPACES = [
		{ id: 'create', label: 'Create', icon: IconStack2, hint: 'Build the texture: layers, lights, post' },
		{
			id: 'match',
			label: 'Match',
			icon: IconTarget,
			hint: 'Match a reference image: templates, colour fitting, the optimiser'
		},
		{
			id: 'tiling',
			label: 'Tiling',
			icon: IconLayoutGrid,
			hint: 'Hide the repeat: what gives it away, which layer draws it, and a fix that keeps the look'
		}
	] as const;

	const helpItems: MenuItem[] = [
		{ section: 'Viewport' },
		{ label: 'Wheel — zoom about cursor', disabled: true },
		{ label: 'Middle / Space-drag — pan', disabled: true },
		{ label: 'Drag a light gizmo — move light', disabled: true },
		{ section: 'Fields' },
		{ label: 'Drag — scrub · Shift fine · Ctrl snap to divisions', disabled: true },
		{ label: 'Click — type a value or expression', disabled: true },
		{ label: 'Double-click — back to the previous value', disabled: true },
		{ label: 'Wheel / arrows over a dropdown — step through it', disabled: true },
		{ separator: true },
		{ label: 'About Bismith', action: () => (editor.about = true) }
	];
</script>

<template>
	<header class="top cf-panel">
		<div class="brand">
			<img :src="logoSrc" width="20" height="20" alt="" />
			<span>Bismith</span>
		</div>
		<DropMenu label="File" :items="fileItems" />
		<DropMenu label="Edit" :items="editItems" />
		<DropMenu label="View" :items="viewItems" />
		<DropMenu label="Help" :items="helpItems" />

		<div class="ws">
			<span class="cf-label">Workspace</span>
			<div class="fk-rail" role="tablist" aria-label="Workspaces">
				<button
					v-for="w in WORKSPACES"
					:key="w.id"
					v-tip:bottom="w.hint"
					type="button"
					role="tab"
					class="fk"
					:class="{ lit: editor.workspace === w.id }"
					:aria-selected="editor.workspace === w.id"
					@click="editor.workspace = w.id">
					<span class="fk-face"><component :is="w.icon" :size="14" />{{ w.label }}</span>
				</button>
			</div>
		</div>

		<div class="right">
			<span class="file cf-mono">
				{{ store.project.name }}
				<span class="dim"
					>· {{ store.project.width }}×{{ store.project.height }}{{ store.project.tileable ? ' · tiling' : '' }}</span
				>
			</span>
			<button
				v-tip:bottom="'Undo (Ctrl+Z)'"
				type="button"
				class="fk hist"
				aria-label="Undo"
				:disabled="!store.canUndo"
				@click="store.undo">
				<span class="fk-face"><IconArrowBackUp :size="15" /></span>
			</button>
			<button
				v-tip:bottom="'Redo (Ctrl+Shift+Z)'"
				type="button"
				class="fk hist"
				aria-label="Redo"
				:disabled="!store.canRedo"
				@click="store.redo">
				<span class="fk-face"><IconArrowForwardUp :size="15" /></span>
			</button>
			<button v-tip:bottom="'Export the final PNG'" type="button" class="fk primary" @click="act.exportFinal(1)">
				<span class="fk-face"><IconDownload :size="13" />Export PNG<span class="kc">Ctrl E</span></span>
			</button>
		</div>
	</header>
</template>

<style scoped>
	.top {
		height: 36px;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0 8px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-right: 10px;
		margin-right: 4px;
		border-right: 1px solid var(--hairline);
		height: 22px;
	}
	.brand span {
		font-family: var(--font-serif);
		font-weight: 600;
		font-size: 16px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-hi);
	}
	.ws {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-left: 20px;
	}
	.ws .fk {
		height: 26px;
	}
	.ws .fk-face {
		gap: 7px;
		padding: 0 12px;
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0.04em;
		color: var(--text);
	}
	.ws .fk.lit .fk-face {
		font-weight: 700;
		color: var(--text-hi);
	}
	.ws .fk-face :deep(svg) {
		color: var(--text-mid);
	}
	.ws .fk.lit .fk-face :deep(svg) {
		color: var(--e100);
	}
	.right {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.file {
		font-size: 12px;
		color: var(--text);
		margin-right: 6px;
		white-space: nowrap;
	}
	.dim {
		color: var(--text-lo);
	}
	/* Undo / Redo: icon keys at the workspace keys' height. */
	.right .fk.hist {
		width: 30px;
		height: 26px;
	}
	.right .fk.hist .fk-face {
		padding: 0;
	}
	.right .fk.primary {
		height: 28px;
		margin-left: 6px;
	}
	.right .fk.primary .kc {
		margin-left: 4px;
		background: var(--e600);
		box-shadow:
			inset 0 0 0 1px var(--e700),
			0 1px 0 var(--e800);
		color: var(--e50);
		text-transform: none;
	}
</style>
