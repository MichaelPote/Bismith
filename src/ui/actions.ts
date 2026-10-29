// Editor commands shared by menus, toolbar buttons and keyboard shortcuts.

import { nextTick } from 'vue';
import { useProjectStore } from '@/stores/project';
import { useEditorStore } from '@/stores/editor';
import { projectFromJSON, projectToJSON } from '@/core/serialize';
import { zipStore } from '@/core/zip';
import { downloadBlob, mapPixels, pixelsToBlob, saveBlobAs, upscale, type MapKind } from '@/render/export';
import { capturePreview, PROJECT_PREVIEW } from '@/render/preview';
import type { Project } from '@/core/project';
import type { Engine } from '@/render/engine';
import type { PresetSource } from '@/stores/editor';
import { asProject, type PresetEntry } from '@/presets';
import {
	applyLayerPreset,
	applyLightPreset,
	applyLightingPreset,
	applyGroupPreset,
	groupPresetLayers,
	applyPostPreset
} from '@/presets/apply';
import { getLayerDef } from '@/layers/registry';

/** Resolves once the browser has painted the current DOM (so a modal is on screen before blocking work starts). */
export function afterPaint(): Promise<void> {
	return nextTick().then(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
	);
}

function slug(name: string): string {
	return (
		name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'texture'
	);
}

export function useActions() {
	const store = useProjectStore();
	const editor = useEditorStore();

	function engineOrWarn() {
		const e = editor.engine;
		if (!e) editor.notify('The renderer is not ready yet.', 'error');
		return e;
	}

	/**
	 * Render for an export behind the busy modal (progress, Cancel) at the project's export quality — Export samples and
	 * supersampling, finer than the viewport (FR8.16a) — and `read` the result; null when cancelled. `trace` false
	 * renders the material maps only.
	 */
	async function exportRender<T>(what: string, read: (engine: Engine) => T, trace = true): Promise<T | null> {
		const engine = engineOrWarn();
		if (!engine) return null;
		const r = store.project.render;
		const ctrl = new AbortController();
		const ss = Math.max(r.supersample ?? 1, r.exportSupersample);
		editor.busy = {
			title: `Rendering ${what}…`,
			detail: trace ? `${Math.max(r.maxSamples, r.exportSamples)} samples at ${ss}×` : `At ${ss}×`,
			instant: true,
			progress: 0,
			cancel: () => ctrl.abort()
		};
		try {
			await afterPaint();
			const out = await engine.renderExport(
				{
					samples: trace ? r.exportSamples : 0,
					supersample: r.exportSupersample,
					signal: ctrl.signal,
					onProgress: (f) => editor.busy && (editor.busy.progress = f)
				},
				() => read(engine)
			);
			if (out === null) editor.notify('Export cancelled');
			return out;
		} catch (e) {
			editor.notify(`Export failed: ${e instanceof Error ? e.message : e}`, 'error');
			return null;
		} finally {
			editor.busy = null;
		}
	}

	async function exportFinal(scale = 1): Promise<void> {
		const img = await exportRender('the final image', (e) => mapPixels(e, 'final'));
		if (!img) return;
		const { width, height, pixels } = img;
		const blob = await pixelsToBlob(upscale(pixels, width, height, scale), width * scale, height * scale);
		downloadBlob(blob, `${slug(store.project.name)}${scale > 1 ? `@${scale}x` : ''}.png`);
		editor.notify(`Exported ${width * scale}×${height * scale} PNG`);
	}

	async function exportMap(kind: MapKind): Promise<void> {
		const traced = kind === 'final' || kind === 'render';
		const img = await exportRender(`the ${kind} map`, (e) => mapPixels(e, kind), traced);
		if (!img) return;
		downloadBlob(await pixelsToBlob(img.pixels, img.width, img.height), `${slug(store.project.name)}_${kind}.png`);
	}

	async function exportAllMaps(): Promise<void> {
		const kinds: MapKind[] = [
			'final',
			'diffuse',
			'height',
			'roughness',
			'specular',
			'metalness',
			'ao',
			'normal-gl',
			'emissive',
			'opacity'
		];
		const maps = await exportRender('the maps', (e) => kinds.map((k) => mapPixels(e, k)));
		if (!maps) return;
		const base = slug(store.project.name);
		const entries = [];
		for (let i = 0; i < kinds.length; i++) {
			const { width, height, pixels } = maps[i];
			const blob = await pixelsToBlob(pixels, width, height);
			entries.push({ name: `${base}_${kinds[i]}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
		}
		entries.push({ name: `${base}.bismith.json`, data: new TextEncoder().encode(projectFile()) });
		downloadBlob(new Blob([zipStore(entries) as BlobPart], { type: 'application/zip' }), `${base}_maps.zip`);
		editor.notify(`Exported ${kinds.length} maps + project`);
	}

	async function copyFinal(): Promise<void> {
		const img = await exportRender('the final image', (e) => mapPixels(e, 'final'));
		if (!img) return;
		try {
			const blob = await pixelsToBlob(img.pixels, img.width, img.height);
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
			editor.notify('Copied the final image');
		} catch {
			editor.notify('Clipboard is not available here', 'error');
		}
	}

	/**
	 * The project as a file: with a preview of what the viewport shows now (FR8.20 — the previous one if nothing has
	 * rendered). Only the file gets it: the open project is left alone, so saving adds no undo step.
	 */
	function projectFile(): string {
		const preview = capturePreview(editor.engine, PROJECT_PREVIEW) ?? store.project.preview;
		return projectToJSON(preview ? { ...store.project, preview } : store.project);
	}

	async function saveProject(): Promise<void> {
		store.commitNow();
		const blob = new Blob([projectFile()], { type: 'application/json' });
		try {
			const name = await saveBlobAs(blob, `${slug(store.project.name)}.bismith.json`, {
				description: 'Bismith project',
				extension: '.json'
			});
			if (name === false) return;
			store.markSaved();
			if (name) editor.notify(`Saved “${name}”`);
		} catch (e) {
			editor.notify(`Could not save the project: ${e instanceof Error ? e.message : e}`, 'error');
		}
	}

	function loadProjectText(text: string): void {
		try {
			const p = projectFromJSON(text);
			store.load(p);
			store.markSaved();
			editor.select('project');
			editor.requestFit();
			editor.notify(`Opened “${p.name}”`);
		} catch (e) {
			editor.notify(`Could not open project: ${e instanceof Error ? e.message : e}`, 'error');
		}
	}

	function openProject(): void {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json,application/json';
		input.onchange = async () => {
			const f = input.files?.[0];
			if (f) loadProjectText(await f.text());
		};
		input.click();
	}

	function newProject(p?: Project): void {
		store.newProject(p);
		editor.select('project');
		editor.requestFit();
	}

	function deleteSelection(): void {
		const s = editor.selection;
		if (!s.id) return;
		if (s.kind === 'layer') {
			const at = store.layerIndex(s.id);
			store.removeLayer(s.id);
			const list = store.project.layers;
			const next = at >= 0 ? list[Math.min(at, list.length - 1)] : undefined;
			editor.select(next ? 'layer' : 'project', next?.id);
		} else if (s.kind === 'group') {
			store.deleteGroup(s.id);
			editor.select('project');
		} else if (s.kind === 'light') {
			store.removeLight(s.id);
			editor.select('project');
		} else if (s.kind === 'post') {
			store.removePost(s.id);
			editor.select('project');
		}
	}

	function duplicateSelection(): void {
		const s = editor.selection;
		if (!s.id) return;
		if (s.kind === 'layer') {
			const l = store.duplicateLayer(s.id);
			if (l) editor.select('layer', l.id);
		} else if (s.kind === 'light') {
			const l = store.duplicateLight(s.id);
			if (l) editor.select('light', l.id);
		} else if (s.kind === 'post') {
			const f = store.duplicatePost(s.id);
			if (f) editor.select('post', f.id);
		}
	}

	/** Where a new layer or group goes: just after the selected layer or group (after its block), else last. */
	function insertionIndex(): number | undefined {
		const s = editor.selection;
		if ((s.kind !== 'layer' && s.kind !== 'group') || !s.id) return undefined;
		const at = store.unitOf(s.id);
		if (!at) return undefined;
		const last = at.unit.group ? at.unit.layers[at.unit.layers.length - 1] : at.unit.layer;
		return store.layerIndex(last.id) + 1;
	}

	/**
	 * Run `apply`, which adds layers of `types`, first compiling the shaders of any generator types not used yet this
	 * session behind the busy modal: a first compile can take seconds (D3D on Windows) and would otherwise freeze the
	 * page with no explanation.
	 */
	async function withShaders(types: string[], label: string, apply: () => void): Promise<void> {
		const engine = editor.engine;
		const pending = engine?.uncompiled(types).length ?? 0;
		if (!engine || !pending) return apply();
		// Progress: a step per shader, and one for the first run.
		const steps = pending + 1;
		editor.busy = {
			title: 'Compiling shaders…',
			detail: `Setting up ${label} for its first use. This can take a few seconds.`,
			// Without background compiling the page freezes during the compile, so the modal can't wait to fade in.
			instant: !engine.parallelCompile,
			progress: 0
		};
		try {
			await afterPaint();
			await engine.precompile(types, (done) => editor.busy && (editor.busy.progress = done / steps));
			apply();
			// Where the browser can't compile in the background, the first run does it: keep the modal up until then.
			await nextTick();
			await engine.settled();
		} finally {
			editor.busy = null;
		}
	}

	/** Add a layer just after the selection (see insertionIndex). */
	async function addLayer(type: string): Promise<void> {
		await withShaders([type], getLayerDef(type)?.label ?? type, () => {
			const l = store.addLayer(type, insertionIndex());
			editor.select('layer', l.id);
		});
	}

	/** A shape drawn on the canvas becomes its own layer (Path for polygons, Polyline for open lines), just after the selection. */
	async function addShapeLayer(type: 'path' | 'polyline', points: string): Promise<void> {
		await withShaders([type], getLayerDef(type)?.label ?? type, () => {
			const l = store.addLayer(type, insertionIndex(), { points, units: 'px' });
			editor.select('layer', l.id);
		});
	}

	/** Add a group preset's layers as a new group just after the selection (the New Layer menu's Presets tab). */
	async function addGroupPreset(entry: PresetEntry): Promise<void> {
		const preset = entry.project();
		const types = [...new Set(preset.layers.map((l) => l.type))];
		await withShaders(types, entry.name, () => {
			const item = groupPresetLayers(store.project, preset);
			if (!item) return;
			const g = store.addGroup(item.name, item.layers, insertionIndex(), item.limit ? { limit: item.limit } : {});
			editor.select('group', g.id);
		});
	}

	/**
	 * Apply a preset to a card of the open project (FR5.4): one undo step; a project preset opens as a new project.
	 * Shaders it needs compile behind the busy modal (the viewport's guard).
	 */
	function applyPreset(entry: PresetEntry, source?: PresetSource): void {
		const preset = entry.project();
		if (entry.kind === 'project' || !source) {
			newProject(asProject(preset));
			return;
		}
		const p = store.project;
		store.commitNow();
		let ok = true;
		switch (source.kind) {
			case 'layer': {
				const l = store.getLayer(source.id);
				ok = !!l && applyLayerPreset(p, l, preset);
				break;
			}
			case 'group': {
				const g = store.getGroup(source.id);
				ok = !!g && applyGroupPreset(p, g, preset);
				break;
			}
			case 'light': {
				const l = store.getLight(source.id);
				ok = !!l && applyLightPreset(p, l, preset);
				break;
			}
			case 'lighting':
				applyLightingPreset(p, preset);
				break;
			case 'post': {
				const f = store.getPost(source.id);
				ok = !!f && applyPostPreset(p, f, preset);
				break;
			}
		}
		store.commitNow();
		editor.notify(
			ok ? `Applied “${entry.name}”` : `“${entry.name}” doesn’t fit this ${source.kind}`,
			ok ? 'info' : 'error'
		);
	}

	return {
		applyPreset,
		addShapeLayer,
		exportFinal,
		exportMap,
		exportAllMaps,
		copyFinal,
		saveProject,
		openProject,
		loadProjectText,
		newProject,
		deleteSelection,
		duplicateSelection,
		addLayer,
		addGroupPreset
	};
}
