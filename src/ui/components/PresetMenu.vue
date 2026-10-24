<script setup lang="ts">
	// A card's presets (docs/features/fr5.4-presets.md): a button in its title row opening thumbnail tiles of the presets
	// for its kind and type — the built-ins and the user's own mixed, grouped by category — and Save as preset… /
	// Manage…. Clicking a tile applies it; right-clicking edits it.
	import { computed } from 'vue';
	import type { PresetKind } from '@/core/project';
	import { useEditorStore, type PresetSource } from '@/stores/editor';
	import { usePresetsStore } from '@/stores/presets';
	import { useActions } from '@/ui/actions';
	import DropMenu, { type MenuItem } from './DropMenu.vue';
	import { IconBookmarks, IconDeviceFloppy, IconSettings } from '@tabler/icons-vue';
	import { vTip } from '@/ui/tooltip';

	const props = defineProps<{ kind: PresetKind; target?: string; source: PresetSource }>();

	const editor = useEditorStore();
	const presets = usePresetsStore();
	const act = useActions();
	void presets.load();

	const items = computed<MenuItem[]>(() => [
		...presets.grouped(props.kind, props.target).flatMap((g): MenuItem[] => [
			{ section: g.category },
			...g.entries.map((e) => ({
				label: e.name,
				image: e.preview,
				// The user's own presets are edged in ember.
				hue: e.builtin ? undefined : 'var(--e400)',
				hint: [e.description, e.builtin ? '' : 'Yours'].filter(Boolean).join(' — ') || undefined,
				action: () => act.applyPreset(e, props.source),
				context: () => (editor.presetDialog = { mode: 'edit', key: e.key, source: props.source })
			}))
		]),
		{ section: 'Presets' },
		{
			label: 'Save as preset…',
			icon: IconDeviceFloppy,
			action: () => (editor.presetDialog = { mode: 'save', source: props.source })
		},
		{
			label: 'Manage mine…',
			icon: IconSettings,
			action: () => (editor.presetDialog = { mode: 'manage', kind: props.kind })
		}
	]);
</script>

<template>
	<DropMenu
		v-tip:bottom="'Presets'"
		:items="items"
		layout="tiles"
		placement="under"
		trigger-class="cf-ico-btn"
		aria-label="Presets">
		<IconBookmarks :size="14" />
	</DropMenu>
</template>
