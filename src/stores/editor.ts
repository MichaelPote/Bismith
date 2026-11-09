// Editor UI state: selection, workspace, viewport view state and live engine stats.

import { defineStore } from 'pinia';
import { markRaw, ref, shallowRef } from 'vue';
import type { Engine, EngineStats } from '@/render/engine';
import type { ChannelView } from '@/render/display';
import { SHAPE_MASK, type PresetKind } from '@/core/project';
import type { ParamType, ParamValue } from '@/core/params';
import type { GalleryRender } from '@/gallery/client';

/** A card a preset is applied to or saved from. */
export type PresetSource = { kind: 'layer' | 'group' | 'light' | 'post'; id: string } | { kind: 'lighting' };

/**
 * 'project' is the project's settings (canvas, path tracer), 'base' the Base row of the layer list (the base material),
 * 'environment' the Environment row of the lights (lighting presets, sky, ambient).
 */
export type SelectionKind = 'project' | 'base' | 'environment' | 'layer' | 'light' | 'post' | 'group';

export interface Selection {
	kind: SelectionKind;
	id?: string;
}

export type Workspace = 'create' | 'match' | 'tiling' | 'variants';

/** Viewport shape tools: edit the selected layer's shapes, or draw a new one (a new layer, or a run of the selected pipes). */
export type ShapeTool = 'edit' | 'polygon' | 'freehand' | 'line';

/** A question for the user (editor.ask): pick one of `choices`, or cancel. */
export interface Question {
	title: string;
	detail?: string;
	/** Listed after Cancel; the `primary` one is the tray's game key, focused so Enter picks it. */
	choices: { id: string; label: string; primary?: boolean }[];
}

export const useEditorStore = defineStore('editor', () => {
	const selection = ref<Selection>({ kind: 'project' });
	const workspace = ref<Workspace>('create');
	const channel = ref<ChannelView>('final');
	/** The mask the Masks view shows (FR8.23). */
	const viewMask = ref(SHAPE_MASK);
	const tile = ref(false);
	const grid = ref(false);
	const checker = ref(true);
	/** Draw the viewport's handles: light and layer gizmos, and the drawn shapes' outlines and vertices. */
	const showGizmos = ref(true);
	/** Preview the stack only up to the selected layer. */
	const solo = ref(false);
	/** Canvas device px per texel and top-left offset in device px. */
	const zoom = ref(4);
	const offsetX = ref(0);
	const offsetY = ref(0);
	/** Incremented to ask the viewport to fit the texture. */
	const fitRequest = ref(0);
	const stats = shallowRef<EngineStats | null>(null);
	const engine = shallowRef<Engine | null>(null);
	const engineError = ref<string | null>(null);
	const toast = ref<{ text: string; kind: 'info' | 'error'; at: number } | null>(null);
	/**
	 * Blocking work in progress (e.g. a first shader compile): shown as a modal over the app, fading in after a moment
	 * unless `instant` (when the work will freeze the page, the modal has to be on screen before it starts). `progress`
	 * (0…1), when given, draws a progress bar: the share of the steps done, e.g. shaders compiled.
	 */
	const busy = ref<{
		title: string;
		detail?: string;
		instant?: boolean;
		progress?: number;
		/** Shows a Cancel button that calls it. */
		cancel?: () => void;
	} | null>(null);
	/** The open question (see ask), with the function that answers it. */
	const question = shallowRef<(Question & { answer: (id: string | null) => void }) | null>(null);
	/** The new-project wizard is open. */
	const wizard = ref(false);
	/** Help → About is open. */
	const about = ref(false);
	/**
	 * The preset dialog (FR5.4): save a card as a preset (`source` names it), edit the preset `key` (right-click on its
	 * tile; `source` is the card it may take new settings from), save the project as a template, or manage the user's
	 * presets (of `kind`, or all).
	 */
	const presetDialog = ref<
		| { mode: 'save'; source: PresetSource }
		| { mode: 'edit'; key: string; source: PresetSource }
		| { mode: 'template' }
		| { mode: 'manage'; kind?: PresetKind }
		| null
	>(null);
	const shapeTool = ref<ShapeTool>('edit');
	/** The variant whose Changes dialog is open (FR10). */
	const variantChanges = ref<string | null>(null);
	/** The Export dialog (FR10) is open, with these variants ticked (default: the one shown). */
	const exportDialog = ref<{ variants?: string[] } | null>(null);
	/** File ▸ Export as Preset… (dev server only). */
	const presetExport = ref(false);
	/** The Publish to gallery dialog is open, with the renders it will upload (one per variant, rendered on opening). */
	const publishDialog = shallowRef<{ renders: GalleryRender[] } | null>(null);
	/** Asks the Variants panel to rename this variant in place (from the workspace's menu). */
	const variantRename = ref<string | null>(null);
	/** A param's value copied from its right-click menu, pasted into params of the same type. */
	const paramClipboard = shallowRef<{ type: ParamType; value: ParamValue } | null>(null);

	function select(kind: SelectionKind, id?: string): void {
		selection.value = { kind, id };
	}

	function setEngine(e: Engine | null): void {
		engine.value = e ? markRaw(e) : null;
	}

	function requestFit(): void {
		fitRequest.value++;
	}

	function notify(text: string, kind: 'info' | 'error' = 'info'): void {
		toast.value = { text, kind, at: Date.now() };
	}

	/** Ask in a modal: resolves to the picked choice's id, or null when cancelled (Cancel, Esc, a click outside). */
	function ask(q: Question): Promise<string | null> {
		question.value?.answer(null);
		return new Promise((resolve) => {
			question.value = {
				...q,
				answer: (id) => {
					question.value = null;
					resolve(id);
				}
			};
		});
	}

	return {
		wizard,
		about,
		presetDialog,
		shapeTool,
		paramClipboard,
		variantChanges,
		variantRename,
		exportDialog,
		presetExport,
		publishDialog,
		selection,
		workspace,
		channel,
		viewMask,
		tile,
		grid,
		checker,
		showGizmos,
		solo,
		zoom,
		offsetX,
		offsetY,
		fitRequest,
		stats,
		engine,
		engineError,
		toast,
		busy,
		question,
		select,
		setEngine,
		requestFit,
		notify,
		ask
	};
});
