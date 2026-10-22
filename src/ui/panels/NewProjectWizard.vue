<script setup lang="ts">
	// New project wizard: Blank at a chosen size, or a project preset (docs/features/fr5.4-presets.md) — the built-ins and
	// the user's own, mixed and grouped by category. Every card is its preset's stored preview, so opening compiles and
	// renders nothing; the picked project's shaders compile in the viewport like any opened project's (FR8.16a).
	import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
	import type { Project } from '@/core/project';
	import { createProject } from '@/core/serialize';
	import { useEditorStore } from '@/stores/editor';
	import { usePresetsStore } from '@/stores/presets';
	import { useActions } from '@/ui/actions';
	import { asProject, type PresetEntry } from '@/presets';
	import { IconPlus, IconUser, IconX } from '@tabler/icons-vue';
	import { vTip } from '@/ui/tooltip';

	const editor = useEditorStore();
	const presets = usePresetsStore();
	const act = useActions();

	const SIZES = [32, 64, 128, 256];
	const size = ref(64);
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

	function pickPreset(e: PresetEntry): void {
		pick(e.project());
	}

	const tip = (e: PresetEntry) => (e.description ? `${e.name} — ${e.description}` : e.name);

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
		dialog.value?.focus();
	});
	onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
	<Teleport to="body">
		<div class="backdrop" @pointerdown.self="close">
			<div ref="dialog" class="wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title" tabindex="-1">
				<header class="head">
					<div class="titles">
						<h2 id="wizard-title">New project</h2>
						<p>Start blank, or from a preset. File ▸ Save as template… adds your own.</p>
					</div>
					<button v-tip:left="'Close (Esc)'" type="button" class="cf-ico-btn" aria-label="Close" @click="close">
						<IconX :size="16" />
					</button>
				</header>

				<div class="bar">
					<span class="cf-label">Blank size</span>
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

				<div class="grid">
					<button type="button" class="card blank" @click="pick(blankProject())">
						<div class="thumb"><IconPlus :size="32" color="var(--text-lo)" /></div>
						<div class="meta">
							<span class="name">Blank</span>
							<span class="sub">No layers · {{ size }}×{{ size }}</span>
						</div>
					</button>
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
	.wizard {
		display: flex;
		flex-direction: column;
		width: min(1120px, 100%);
		max-height: 100%;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 4px;
		box-shadow: 0 18px 48px rgba(8, 9, 10, 0.6);
		outline: none;
		user-select: none;
		-webkit-user-select: none;
	}
	.head {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 16px 16px 10px 20px;
	}
	.titles {
		flex: 1;
		min-width: 0;
	}
	h2 {
		margin: 0;
		font-family: var(--font-serif);
		font-weight: 600;
		font-size: 24px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-hi);
	}
	.titles p {
		margin: 4px 0 0;
		font-size: 13px;
		color: var(--text-lo);
	}
	.bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px 14px;
		padding: 8px 20px 12px;
		border-bottom: 1px solid var(--hairline);
	}
	.sizes {
		display: flex;
		gap: 3px;
	}
	.sizes .fk-face {
		min-width: 40px;
		font-family: var(--font-mono);
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
