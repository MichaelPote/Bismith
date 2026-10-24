// The project store: the single source of truth for the open texture, with snapshot undo/redo and autosave.

import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
import type { ParamValue } from '@/core/params';
import type { Layer, LayerGroup, LayerUnit, LimitExpr, Light, LightType, PostFilter, Project } from '@/core/project';
import { flattenUnits, layerUnits } from '@/core/project';
import {
	addGroup as groupAdd,
	deleteGroup as groupDelete,
	pruneGroups,
	renameMask as groupRenameMask,
	setGroupLimit as groupLimit,
	ungroup as groupUngroup
} from '@/core/groups';
import { createLayer, createLight, createPostFilter, createProject, normalizeProject } from '@/core/serialize';
import { freshParams, linkedChanges } from '@/layers/registry';
import { newId } from '@/core/ids';
import { MAX_LIGHTS } from '@/core/project';
import { fitLight, resizeProject } from '@/core/pixelScale';
import { builtinProject } from '@/presets';

const AUTOSAVE_KEY = 'bismith:project';
/** Autosave key from before the rename to Bismith; read once if the new key is empty. */
const LEGACY_AUTOSAVE_KEY = 'artificer:project';
const HISTORY_LIMIT = 200;

function loadAutosave(): Project | null {
	try {
		const txt = localStorage.getItem(AUTOSAVE_KEY) ?? localStorage.getItem(LEGACY_AUTOSAVE_KEY);
		return txt ? normalizeProject(JSON.parse(txt)) : null;
	} catch {
		return null;
	}
}

function saveAutosave(json: string): void {
	try {
		localStorage.setItem(AUTOSAVE_KEY, json);
	} catch {
		/* storage unavailable or full */
	}
}

function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v)) as T;
}

export const useProjectStore = defineStore('project', () => {
	// First run opens a showcase preset rather than a blank project.
	const project = ref<Project>(loadAutosave() ?? builtinProject('bricks') ?? createProject());
	const past = shallowRef<string[]>([]);
	const future = shallowRef<string[]>([]);
	let current = JSON.stringify(project.value);
	let suppress = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	/** Bumped whenever the project is replaced wholesale (load / new / undo), so views can refit. */
	const generation = ref(0);

	function commitNow(): void {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		const s = JSON.stringify(project.value);
		if (s === current) return;
		past.value = [...past.value, current].slice(-HISTORY_LIMIT);
		future.value = [];
		current = s;
		saveAutosave(s);
	}

	watch(
		project,
		() => {
			if (suppress) return;
			if (timer) clearTimeout(timer);
			timer = setTimeout(commitNow, 350);
		},
		{ deep: true }
	);

	function restore(json: string): void {
		suppress = true;
		project.value = JSON.parse(json) as Project;
		current = json;
		saveAutosave(json);
		generation.value++;
		// Let the deep watcher see the change while suppressed.
		queueMicrotask(() => (suppress = false));
	}

	const canUndo = computed(() => past.value.length > 0);
	const canRedo = computed(() => future.value.length > 0);

	function undo(): void {
		commitNow();
		if (!past.value.length) return;
		const prev = past.value[past.value.length - 1];
		past.value = past.value.slice(0, -1);
		future.value = [...future.value, current];
		restore(prev);
	}

	function redo(): void {
		if (!future.value.length) return;
		const next = future.value[future.value.length - 1];
		future.value = future.value.slice(0, -1);
		past.value = [...past.value, current];
		restore(next);
	}

	/** Replace the whole project (open file, new from preset). Recorded in history. */
	function load(p: Project): void {
		commitNow();
		project.value = normalizeProject(clone(p));
		generation.value++;
		commitNow();
	}

	function newProject(p?: Project): void {
		load(p ?? createProject());
	}

	// A run of resizes (dragging the Width field, 256 → 512 → 256) scales from the project as it was before the first
	// one, so rounding and clamping don't compound; any other edit starts a new run.
	let sizeBase: { project: string; after: string } | null = null;

	/** Change the canvas size, scaling every pixel-measured value with it (core/pixelScale.ts). */
	function resize(width: number, height: number): void {
		const now = JSON.stringify(project.value);
		if (!sizeBase || sizeBase.after !== now) sizeBase = { project: now, after: now };
		const next = resizeProject(
			JSON.parse(sizeBase.project) as Project,
			Math.max(1, Math.round(width)),
			Math.max(1, Math.round(height))
		);
		Object.assign(project.value, next);
		sizeBase.after = JSON.stringify(project.value);
	}

	// ---------------------------------------------------------------- layers
	// One list in evaluation order (index 0 = earliest). A group's members sit together as one block (a unit);
	// moves keep them so: a member moves within its block, anything else moves past whole blocks.
	const layers = () => project.value.layers;

	function layerIndex(id: string): number {
		return layers().findIndex((l) => l.id === id);
	}

	function getLayer(id: string): Layer | undefined {
		return layers().find((l) => l.id === id);
	}

	const units = () => layerUnits(layers(), project.value.groups);

	/** The unit holding a layer (or a group's block, by the group's id) and its position. */
	function unitOf(id: string): { index: number; unit: LayerUnit } | undefined {
		const us = units();
		const index = us.findIndex((u) =>
			u.group ? u.group.id === id || u.layers.some((l) => l.id === id) : u.layer.id === id
		);
		return index < 0 ? undefined : { index, unit: us[index] };
	}

	/** The first index at or after `i` that is not inside a group's block. */
	function outsideBlocks(i: number): number {
		let at = 0;
		for (const u of units()) {
			const n = u.group ? u.layers.length : 1;
			if (i > at && i < at + n) return at + n;
			at += n;
		}
		return i;
	}

	/** A seed no layer uses yet, so a new layer's pattern is its own. */
	function freshSeed(): number {
		const used = new Set(layers().map((x) => x.params.seed));
		let seed = 1;
		while (used.has(seed)) seed = 1 + Math.floor(Math.random() * 99998);
		return seed;
	}

	/** Insert a new layer at `atIndex` (default last, on top); never inside a group's block. It starts from the editor
	 * defaults (freshParams: shape-driven roughness, the type's LayerDef.fresh); a seeded layer gets a seed no other layer has. */
	function addLayer(type: string, atIndex?: number, overrides: Record<string, ParamValue> = {}): Layer {
		const fresh = freshParams(type, { width: project.value.width, height: project.value.height });
		const layer = createLayer(type, { ...fresh, ...overrides });
		if (layer.params.seed !== undefined && overrides.seed === undefined) layer.params.seed = freshSeed();
		const list = layers();
		const i = outsideBlocks(atIndex === undefined ? list.length : Math.max(0, Math.min(list.length, atIndex)));
		list.splice(i, 0, layer);
		return list[i];
	}

	function removeLayer(id: string): void {
		const i = layerIndex(id);
		if (i >= 0) layers().splice(i, 1);
		pruneGroups(project.value);
	}

	/** Copy a layer just after it — after its group's block when it is a member (the copy is a free layer). */
	function duplicateLayer(id: string): Layer | undefined {
		const i = layerIndex(id);
		if (i < 0) return undefined;
		const copy = { ...clone(layers()[i]), id: newId('ly') };
		copy.name = `${copy.name.replace(/ copy$/, '')} copy`;
		const at = outsideBlocks(i + 1);
		layers().splice(at, 0, copy);
		return layers()[at];
	}

	/** Move a free layer or a whole group (by its id) to unit position `to`. */
	function moveUnit(id: string, to: number): void {
		const us = units();
		const at = unitOf(id);
		if (!at) return;
		const j = Math.max(0, Math.min(us.length - 1, to));
		if (j === at.index) return;
		us.splice(at.index, 1);
		us.splice(j, 0, at.unit);
		project.value.layers = flattenUnits(us);
	}

	/** Move a group member to position `to` within its block. */
	function moveMember(id: string, to: number): void {
		const at = unitOf(id);
		if (!at?.unit.group) return;
		const block = at.unit.layers;
		const from = block.findIndex((l) => l.id === id);
		const j = Math.max(0, Math.min(block.length - 1, to));
		if (from === j) return;
		const start = layerIndex(block[0].id);
		const [l] = layers().splice(start + from, 1);
		layers().splice(start + j, 0, l);
	}

	/** One step earlier (−1) or later (+1): a member within its block, a free layer or group past the next unit. */
	function stepLayer(id: string, dir: number): void {
		const at = unitOf(id);
		if (!at) return;
		if (at.unit.group && at.unit.group.id !== id) moveMember(id, at.unit.layers.findIndex((l) => l.id === id) + dir);
		else moveUnit(id, at.index + dir);
	}

	function setLayerParam(id: string, key: string, value: ParamValue): void {
		const l = getLayer(id);
		// With any linked defaults that follow it (Drips: Height turns on with the Sources output).
		if (l) Object.assign(l.params, linkedChanges(l.type, l.params, key, value));
	}

	// ---------------------------------------------------------------- groups
	function getGroup(id: string): LayerGroup | undefined {
		return project.value.groups?.find((g) => g.id === id);
	}

	/**
	 * Add `layers` as one new group at `atIndex` (default last; never inside another group's block): a group preset's
	 * layers, with fresh ids.
	 */
	function addGroup(
		name: string,
		newLayers: Layer[],
		atIndex?: number,
		extra: Pick<LayerGroup, 'limit'> = {}
	): LayerGroup {
		const at = outsideBlocks(atIndex === undefined ? layers().length : Math.max(0, Math.min(layers().length, atIndex)));
		return groupAdd(project.value, name, newLayers, at, extra);
	}

	function setGroupLimit(id: string, limit: LimitExpr | null): void {
		const g = getGroup(id);
		if (g) groupLimit(g, limit);
	}

	/** Rename a mask wherever it is named (FR8.23). */
	function renameMask(from: string, to: string): number {
		return groupRenameMask(project.value, from, to);
	}

	/** Show or hide a whole group (its members keep their own on/off states). */
	function setGroupEnabled(id: string, enabled: boolean): void {
		const g = getGroup(id);
		if (!g) return;
		if (enabled) delete g.enabled;
		else g.enabled = false;
	}

	function renameGroup(id: string, name: string): void {
		const g = getGroup(id);
		if (g && name.trim()) g.name = name.trim();
	}

	function ungroup(id: string): void {
		groupUngroup(project.value, id);
	}

	function deleteGroup(id: string): void {
		groupDelete(project.value, id);
	}

	function updateLayer(id: string, patch: Partial<Pick<Layer, 'name' | 'enabled' | 'locked'>>): void {
		const l = getLayer(id);
		if (l) Object.assign(l, patch);
	}

	// ---------------------------------------------------------------- lights
	const lights = () => project.value.lighting.lights;

	function getLight(id: string): Light | undefined {
		return lights().find((l) => l.id === id);
	}

	function addLight(type: LightType): Light | undefined {
		if (lights().length >= MAX_LIGHTS) return undefined;
		// Sized to the canvas, like a fresh layer (a point light's height, size and falloff).
		lights().push(fitLight(createLight(type), project.value));
		return lights()[lights().length - 1];
	}

	function removeLight(id: string): void {
		const i = lights().findIndex((l) => l.id === id);
		if (i >= 0) lights().splice(i, 1);
	}

	function duplicateLight(id: string): Light | undefined {
		const i = lights().findIndex((l) => l.id === id);
		if (i < 0 || lights().length >= MAX_LIGHTS) return undefined;
		const copy = { ...clone(lights()[i]), id: newId('lt'), name: `${lights()[i].name} copy` };
		lights().splice(i + 1, 0, copy);
		return lights()[i + 1];
	}

	function setLightParam(id: string, key: string, value: ParamValue): void {
		const l = getLight(id);
		if (l) l.params[key] = value;
	}

	function updateLight(id: string, patch: Partial<Pick<Light, 'name' | 'enabled'>>): void {
		const l = getLight(id);
		if (l) Object.assign(l, patch);
	}

	// ---------------------------------------------------------------- post
	const post = () => project.value.post;

	function getPost(id: string): PostFilter | undefined {
		return post().find((f) => f.id === id);
	}

	function addPost(type: string, atIndex?: number): PostFilter {
		const f = createPostFilter(type);
		const list = post();
		const i = atIndex === undefined ? list.length : Math.max(0, Math.min(list.length, atIndex));
		list.splice(i, 0, f);
		return list[i];
	}

	function removePost(id: string): void {
		const i = post().findIndex((f) => f.id === id);
		if (i >= 0) post().splice(i, 1);
	}

	function movePost(id: string, toIndex: number): void {
		const list = post();
		const i = list.findIndex((f) => f.id === id);
		if (i < 0) return;
		const j = Math.max(0, Math.min(list.length - 1, toIndex));
		const [f] = list.splice(i, 1);
		list.splice(j, 0, f);
	}

	function setPostParam(id: string, key: string, value: ParamValue): void {
		const f = getPost(id);
		if (f) f.params[key] = value;
	}

	function updatePost(id: string, patch: Partial<Pick<PostFilter, 'enabled'>>): void {
		const f = getPost(id);
		if (f) Object.assign(f, patch);
	}

	return {
		project,
		generation,
		canUndo,
		canRedo,
		undo,
		redo,
		commitNow,
		load,
		newProject,
		resize,
		getLayer,
		layerIndex,
		unitOf,
		addLayer,
		removeLayer,
		duplicateLayer,
		moveUnit,
		moveMember,
		stepLayer,
		setLayerParam,
		updateLayer,
		getGroup,
		addGroup,
		setGroupLimit,
		renameMask,
		setGroupEnabled,
		renameGroup,
		ungroup,
		deleteGroup,
		getLight,
		addLight,
		removeLight,
		duplicateLight,
		setLightParam,
		updateLight,
		getPost,
		addPost,
		removePost,
		movePost,
		setPostParam,
		updatePost
	};
});
