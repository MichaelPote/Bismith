<script setup lang="ts">
	import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore } from '@/stores/editor';
	import { useActions } from '@/ui/actions';
	import { CHANNEL_VIEWS } from '@/render/display';
	import TopBar from '@/ui/layout/TopBar.vue';
	import Outliner from '@/ui/layout/Outliner.vue';
	import ProjectPanel from '@/ui/layout/ProjectPanel.vue';
	import VariantsPanel from '@/ui/layout/VariantsPanel.vue';
	import Viewport from '@/ui/layout/Viewport.vue';
	import Properties from '@/ui/layout/Properties.vue';
	import StatusBar from '@/ui/layout/StatusBar.vue';
	import MatchWorkspace from '@/ui/panels/MatchWorkspace.vue';
	import TilingWorkspace from '@/ui/panels/TilingWorkspace.vue';
	import VariantsWorkspace from '@/ui/panels/VariantsWorkspace.vue';
	import VariantChanges from '@/ui/panels/VariantChanges.vue';
	import ExportDialog from '@/ui/panels/ExportDialog.vue';
	import BusyModal from '@/ui/components/BusyModal.vue';
	import AskModal from '@/ui/components/AskModal.vue';
	import EyedropperChip from '@/ui/components/EyedropperChip.vue';
	import NewProjectWizard from '@/ui/panels/NewProjectWizard.vue';
	import PresetDialog from '@/ui/panels/PresetDialog.vue';
	import AboutDialog from '@/ui/panels/AboutDialog.vue';
	import { offerResume } from '@/ui/resumeRuns';

	const store = useProjectStore();
	const editor = useEditorStore();
	const act = useActions();

	// ---------------------------------------------------------------- resizable side panels
	function readWidth(key: string, def: number): number {
		try {
			const v = Number(localStorage.getItem(key));
			return v > 0 ? v : def;
		} catch {
			return def;
		}
	}
	const leftW = ref(readWidth('cf-left', 250));
	const rightW = ref(readWidth('cf-right', 340));
	watch([leftW, rightW], ([l, r]) => {
		try {
			localStorage.setItem('cf-left', String(l));
			localStorage.setItem('cf-right', String(r));
		} catch {
			/* storage unavailable */
		}
	});
	const cols = computed(() => `${leftW.value}px 4px minmax(0, 1fr) 4px ${rightW.value}px`);

	function startResize(e: PointerEvent, side: 'left' | 'right'): void {
		const startX = e.clientX;
		const start = side === 'left' ? leftW.value : rightW.value;
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => {
			const d = ev.clientX - startX;
			// The properties sidebar may grow twice as wide as the outliner (wide graphs and ramps).
			const w = Math.max(180, Math.min(side === 'left' ? 560 : 1120, side === 'left' ? start + d : start - d));
			if (side === 'left') leftW.value = w;
			else rightW.value = w;
		};
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}

	// The Variants panel's height over the Outliner; 0 = its natural height (up to seven rows).
	const variantsH = ref(readWidth('cf-variants', 0));
	watch(variantsH, (h) => {
		try {
			if (h) localStorage.setItem('cf-variants', String(h));
			else localStorage.removeItem('cf-variants');
		} catch {
			/* storage unavailable */
		}
	});
	/** The Outliner keeps at least this much of the column (its `min-height` below); a short window shrinks the panel. */
	const OUTLINER_MIN = 160;
	const variantsStyle = computed(() => (variantsH.value ? { height: `${variantsH.value}px` } : undefined));

	function startVariantsResize(e: PointerEvent): void {
		const el = e.currentTarget as HTMLElement;
		const panel = el.previousElementSibling as HTMLElement;
		const outliner = el.nextElementSibling as HTMLElement;
		const startY = e.clientY;
		const start = panel.offsetHeight;
		const max = start + outliner.offsetHeight - OUTLINER_MIN;
		el.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => {
			// The head and one row at least.
			variantsH.value = Math.round(Math.max(68, Math.min(max, start + ev.clientY - startY)));
		};
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}

	// ---------------------------------------------------------------- shortcuts
	function isTyping(t: EventTarget | null): boolean {
		const el = t as HTMLElement | null;
		if (!el) return false;
		const tag = el.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
	}

	function onKey(e: KeyboardEvent): void {
		// The new-project wizard, questions and the Export and Changes dialogs are modal: the editor's shortcuts wait.
		if (editor.wizard || editor.question || editor.exportDialog || editor.variantChanges) return;
		const mod = e.ctrlKey || e.metaKey;
		const k = e.key.toLowerCase();
		if (mod && k === 'z' && !e.shiftKey) {
			if (isTyping(e.target)) return;
			e.preventDefault();
			store.undo();
			return;
		}
		if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) {
			if (isTyping(e.target)) return;
			e.preventDefault();
			store.redo();
			return;
		}
		if (mod && k === 's') {
			e.preventDefault();
			act.saveProject();
			return;
		}
		if (mod && k === 'o') {
			e.preventDefault();
			act.openProject();
			return;
		}
		if (mod && k === 'e') {
			e.preventDefault();
			editor.exportDialog = {};
			return;
		}
		if (mod && e.altKey && k === 'n') {
			e.preventDefault();
			editor.wizard = true;
			return;
		}
		// Alt+↑ / Alt+↓: the previous / next variant (FR10).
		if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isTyping(e.target)) {
			e.preventDefault();
			store.stepVariant(e.key === 'ArrowUp' ? -1 : 1);
			return;
		}
		if (isTyping(e.target) || mod || e.altKey) {
			if (mod && k === 'd' && !isTyping(e.target)) {
				e.preventDefault();
				act.duplicateSelection();
			}
			return;
		}
		if (k === 'delete' || k === 'backspace') {
			act.deleteSelection();
		} else if (k === 'f') {
			editor.requestFit();
		} else if (k === 't') {
			editor.tile = !editor.tile;
		} else if (k === 'g') {
			editor.grid = !editor.grid;
		} else if (k === 's') {
			editor.solo = !editor.solo;
		} else if (k === 'r') {
			editor.engine?.restart();
		} else {
			const c = CHANNEL_VIEWS.find((v) => v.key === k);
			if (c) editor.channel = c.id;
		}
	}

	// ---------------------------------------------------------------- drag & drop project files
	async function onDrop(e: DragEvent): Promise<void> {
		const f = e.dataTransfer?.files?.[0];
		if (!f) return;
		e.preventDefault();
		if (f.name.endsWith('.json') || f.type === 'application/json') act.loadProjectText(await f.text());
		else if (f.type.startsWith('image/')) {
			editor.workspace = 'match';
			// After the workspace has mounted (a first visit), so it hears the event.
			await nextTick();
			window.dispatchEvent(new CustomEvent('bismith:reference', { detail: f }));
		}
	}

	// ---------------------------------------------------------------- toast
	const toastVisible = ref(false);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	watch(
		() => editor.toast,
		(t) => {
			if (!t) return;
			toastVisible.value = true;
			if (toastTimer) clearTimeout(toastTimer);
			toastTimer = setTimeout(() => (toastVisible.value = false), t.kind === 'error' ? 5000 : 2600);
		}
	);

	// Leaving with changes no file holds asks first. The autosave would bring them back, but only in this browser.
	function onBeforeUnload(e: BeforeUnloadEvent): void {
		if (store.isDirty()) e.preventDefault();
	}

	onMounted(() => {
		window.addEventListener('keydown', onKey);
		window.addEventListener('beforeunload', onBeforeUnload);
		// A long run (Match's optimiser) lost with the page — a discarded background tab, a crash — can carry on.
		void offerResume();
	});
	onBeforeUnmount(() => {
		window.removeEventListener('keydown', onKey);
		window.removeEventListener('beforeunload', onBeforeUnload);
	});
</script>

<template>
	<div class="app" @dragover.prevent @drop="onDrop">
		<TopBar />
		<main class="main" :style="{ gridTemplateColumns: cols }">
			<div class="left">
				<ProjectPanel />
				<VariantsPanel :class="{ sized: variantsH > 0 }" :style="variantsStyle" />
				<div
					class="vgutter"
					role="separator"
					aria-orientation="horizontal"
					aria-label="Resize variants"
					@pointerdown="startVariantsResize"
					@dblclick="variantsH = 0" />
				<Outliner />
			</div>
			<div
				class="gutter"
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize outliner"
				@pointerdown="startResize($event, 'left')" />
			<div class="centre">
				<Viewport v-show="editor.workspace === 'create'" />
				<KeepAlive><MatchWorkspace v-if="editor.workspace === 'match'" /></KeepAlive>
				<KeepAlive><TilingWorkspace v-if="editor.workspace === 'tiling'" /></KeepAlive>
				<VariantsWorkspace v-if="editor.workspace === 'variants'" />
			</div>
			<div
				class="gutter"
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize properties"
				@pointerdown="startResize($event, 'right')" />
			<Properties />
		</main>
		<StatusBar />
		<div v-if="toastVisible && editor.toast" class="toast" :class="editor.toast.kind" role="status">
			{{ editor.toast.text }}
		</div>
		<NewProjectWizard v-if="editor.wizard" />
		<PresetDialog v-if="editor.presetDialog" />
		<VariantChanges v-if="editor.variantChanges" />
		<ExportDialog v-if="editor.exportDialog" />
		<AboutDialog v-if="editor.about" />
		<BusyModal />
		<AskModal />
		<EyedropperChip />
	</div>
</template>

<style scoped>
	.app {
		height: 100%;
		display: grid;
		grid-template-rows: 36px minmax(0, 1fr) 24px;
		gap: var(--gap-app);
		padding: var(--gap-app);
		background: var(--void);
	}
	.main {
		display: grid;
		min-height: 0;
	}
	/* The Project, Variants and Outliner panels, stacked in the column. */
	.left {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	/* As thin as the app's gaps, with a wider grip either side. */
	.vgutter {
		flex: none;
		height: var(--gap-app);
		position: relative;
		cursor: row-resize;
		touch-action: none;
	}
	.vgutter::before {
		content: '';
		position: absolute;
		inset: -3px 0;
		z-index: 1;
	}
	.vgutter:hover {
		background: linear-gradient(transparent 1px, var(--line) 1px, var(--line) 2px, transparent 2px);
	}
	.left > .project {
		margin-bottom: var(--gap-app);
	}
	.left > :last-child {
		flex: 1;
		min-height: 160px;
	}
	.centre {
		display: grid;
		min-width: 0;
		min-height: 0;
	}
	.centre > * {
		grid-area: 1 / 1;
		min-width: 0;
		min-height: 0;
	}
	.gutter {
		cursor: col-resize;
		touch-action: none;
	}
	.gutter:hover {
		background: linear-gradient(90deg, transparent 1px, var(--line) 1px, var(--line) 2px, transparent 2px);
	}
	.toast {
		position: fixed;
		left: 50%;
		bottom: 40px;
		transform: translateX(-50%);
		padding: 8px 14px;
		border: 1px solid var(--line);
		border-left: 2px solid var(--pill);
		border-radius: var(--r-field);
		background: rgba(44, 49, 54, 0.97);
		color: var(--text-hi);
		font-size: 12px;
		z-index: 200;
		box-shadow: 0 6px 18px rgba(8, 9, 10, 0.5);
	}
	.toast.error {
		border-left-color: var(--blood);
	}
</style>
