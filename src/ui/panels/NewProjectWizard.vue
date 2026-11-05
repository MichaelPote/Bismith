<script setup lang="ts">
	// New project wizard: Blank at a size picked on its card, or a project preset (docs/features/fr5.4-presets.md) — the built-ins and
	// the user's own, mixed and grouped by category. Every card is its preset's stored preview, so opening compiles and
	// renders nothing; the picked project's shaders compile in the viewport like any opened project's (FR8.16a).
	import { ref } from 'vue';
	import type { Project } from '@/core/project';
	import { createProject } from '@/core/serialize';
	import { useEditorStore } from '@/stores/editor';
	import { usePresetsStore } from '@/stores/presets';
	import { useActions } from '@/ui/actions';
	import { asProject, type PresetEntry } from '@/presets';
	import { IconPlus, IconUser } from '@tabler/icons-vue';
	import DialogFrame from '@/ui/components/DialogFrame.vue';
	import { vTip } from '@/ui/tooltip';

	const editor = useEditorStore();
	const presets = usePresetsStore();
	const act = useActions();

	const SIZES = [128, 256, 512];
	const size = ref(256);
	void presets.load();

	function blankProject(): Project {
		return createProject({ name: 'Untitled', width: size.value, height: size.value, layers: [] });
	}

	function close(): void {
		editor.wizard = false;
	}

	function pick(project: Project): void {
		editor.wizard = false;
		act.newProject(asProject(project));
	}

	async function pickPreset(e: PresetEntry): Promise<void> {
		pick(await e.project());
	}

	const tip = (e: PresetEntry) => (e.description ? `${e.name} — ${e.description}` : e.name);
</script>

<template>
	<DialogFrame title="New project" width="1120px" focus=".blank .open" @close="close">
		<p class="blurb">Start from a blank canvas, or choose one of the presets below to get started.</p>
		<div class="grid">
			<!-- Blank: the card opens it; its size is picked on the card -->
			<div class="card blank" role="group" aria-label="Blank">
				<button type="button" class="open" @click="pick(blankProject())">
					<div class="thumb"><IconPlus :size="32" color="var(--text-lo)" /></div>
					<div class="meta">
						<span class="name">Blank</span>
						<span class="sub">No layers · {{ size }}×{{ size }}</span>
					</div>
				</button>
				<div class="sizes" role="radiogroup" aria-label="Blank texture size">
					<button
						v-for="s in SIZES"
						:key="s"
						type="button"
						class="fk"
						:class="{ lit: size === s }"
						role="radio"
						:aria-checked="size === s"
						@click="size = s">
						<span class="fk-face">{{ s }}</span>
					</button>
				</div>
			</div>
			<template v-for="g in presets.grouped('project')" :key="g.category">
				<h3 class="section">{{ g.category }}</h3>
				<button
					v-for="e in g.entries"
					:key="e.key"
					v-tip:top="tip(e)"
					type="button"
					class="card"
					@click="pickPreset(e)">
					<img v-if="e.preview" class="thumb" :src="e.preview" :alt="e.name" draggable="false" />
					<div v-else class="thumb none">{{ e.name }}</div>
					<div class="meta">
						<span class="name">
							<IconUser v-if="!e.builtin" :size="11" class="mine" aria-label="Yours" />{{ e.name }}
						</span>
						<span v-if="e.description" class="sub">{{ e.description }}</span>
					</div>
				</button>
			</template>
		</div>
		<template #tray>
			<span>File ▸ Save as template… adds your own.</span>
			<span class="grow" />
			<button type="button" class="gk" @click="close"><span class="gk-face">Cancel</span></button>
		</template>
	</DialogFrame>
</template>

<style scoped>
	.blurb {
		margin: 0;
		padding: 0 20px 4px 16px;
		font-size: 13px;
		color: var(--text-lo);
	}
	/* Blank's sizes, under its picture and name: three keys across the card. */
	.sizes {
		display: flex;
		gap: 3px;
	}
	.sizes .fk {
		flex: 1;
		height: 24px;
	}
	.sizes .fk-face {
		padding: 0;
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.grid {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 10px;
		padding: 14px 20px 20px;
	}
	.section {
		grid-column: 1 / -1;
		margin: 6px 0 -2px;
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-lo);
	}
	.section:first-child {
		margin-top: 0;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--base);
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.card:hover:not(:disabled) {
		border-color: var(--line);
		background: var(--raised);
	}
	.card:focus-visible {
		outline: 1px solid var(--e100);
		outline-offset: 2px;
	}
	.thumb {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		height: auto;
		object-fit: cover;
		image-rendering: pixelated;
		border: 1px solid var(--deep);
		background: var(--sunken);
	}
	.thumb.none {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 8px;
		font-size: 11px;
		color: var(--text-lo);
		text-align: center;
	}
	/* The part of Blank's card that opens it. */
	.blank .open {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.blank .open:focus-visible {
		outline: 1px solid var(--e100);
		outline-offset: 2px;
	}
	.blank {
		cursor: default;
	}
	.blank .thumb {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--sunken);
		border-style: dashed;
		border-color: var(--line);
	}
	.meta {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.name {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-hi);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 11px;
		color: var(--text-lo);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mine {
		margin-right: 4px;
		vertical-align: -1px;
		color: var(--e400);
	}
</style>
