<script setup lang="ts">
	// The Lighting presets card (docs/features/fr5.4-presets.md): the lighting presets as thumbnail tiles — the built-ins
	// and the user's own, by category — that replace the sky, ambient and lights (right-click one to edit it); and Save
	// the current lighting….
	import { usePresetsStore } from '@/stores/presets';
	import { useEditorStore } from '@/stores/editor';
	import { useActions } from '@/ui/actions';
	import { IconDeviceFloppy } from '@tabler/icons-vue';
	import { vTip } from '@/ui/tooltip';

	const presets = usePresetsStore();
	const editor = useEditorStore();
	const act = useActions();
	void presets.load();
</script>

<template>
	<div class="lp">
		<template v-for="g in presets.grouped('lighting')" :key="g.category">
			<div v-if="presets.grouped('lighting').length > 1" class="cat">{{ g.category }}</div>
			<div class="tiles">
				<button
					v-for="e in g.entries"
					:key="e.key"
					v-tip:top="e.description ? { title: e.name, body: e.description } : e.name"
					type="button"
					class="tile"
					:class="{ mine: !e.builtin }"
					@click="act.applyPreset(e, { kind: 'lighting' })"
					@contextmenu.prevent="editor.presetDialog = { mode: 'edit', key: e.key, source: { kind: 'lighting' } }">
					<img v-if="e.preview" :src="e.preview" alt="" draggable="false" />
					<span class="lbl">{{ e.name }}</span>
				</button>
			</div>
		</template>
		<button
			type="button"
			class="cf-btn save"
			@click="editor.presetDialog = { mode: 'save', source: { kind: 'lighting' } }">
			<IconDeviceFloppy :size="13" />Save this lighting…
		</button>
	</div>
</template>

<style scoped>
	.lp {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.cat {
		font-size: 10.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-lo);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
		gap: 4px;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 3px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--sunken);
		color: var(--text);
		min-width: 0;
	}
	.tile.mine {
		border-color: var(--e400);
	}
	.tile:hover,
	.tile:focus-visible {
		background: var(--raised);
		color: var(--text-hi);
		outline: none;
	}
	.tile img {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		border-radius: 2px;
		background: var(--alpha-bg);
	}
	.lbl {
		font-size: 10.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: center;
	}
	.save {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
</style>
