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
import { freshParams, getLayerDef, linkedChanges } from '@/layers/registry';
import { LIGHT_DEFS } from '@/core/lights';
import { assignMaskHues, coverageOnlyAt, maskNames, solidSources } from '@/layers/masks';
import { newId } from '@/core/ids';
import { hashText } from '@/core/hash';
import { MAX_LIGHTS } from '@/core/project';
import { fitLight, resizeProject } from '@/core/pixelScale';
import * as V from '@/core/variants';

const AUTOSAVE_KEY = 'bismith:project';
/** Autosave key from before the rename to Bismith; read once if the new key is empty. */
const LEGACY_AUTOSAVE_KEY = 'artificer:project';
/** Hash of the project as last saved or opened (see markSaved). */
const SAVED_KEY = 'bismith:saved';
const HISTORY_LIMIT = 200;

function loadAutosave(): Project | null {
	try {
		const txt = localStorage.getItem(AUTOSAVE_KEY) ?? localStorage.getItem(LEGACY_AUTOSAVE_KEY);
		return txt ? normalizeProject(JSON.parse(txt)) : null;
	} catch {
		return null;
	}
}

function loadSavedHash(): string | null {
	try {
		return localStorage.getItem(SAVED_KEY);
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
	// First run starts blank (empty, like the New Project dialog's Blank) with that dialog open (App.vue).
	const autosaved = loadAutosave();
	/** No autosave: this browser hasn't used Bismith before (or its site data was cleared). */
	const firstRun = !autosaved;
	const project = ref<Project>(autosaved ?? createProject({ width: 256, height: 256, layers: [] }));
	assignMaskHues(project.value);
	const past = shallowRef<string[]>([]);
	const future = shallowRef<string[]>([]);
	let current = JSON.stringify(project.value);
	// The project as last saved to or opened from a file (or started new), by hash. Kept beside the autosave so a
	// reload still knows what is unsaved; without one (first run) the project counts as saved.
	let savedHash = loadSavedHash() ?? hashText(current);
	// Kept at once, so the next visit isn't a first one even if nothing is changed (the dialog opens once).
	if (firstRun) saveAutosave(current);
	let suppress = false;
	let gesture = false;
	let gestureChanged = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	/** Bumped when another project is opened or started (load / new), so views can refit. Undo / redo keep the view. */
	const generation = ref(0);

	function commitNow(): void {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		// The active variant's changes measured again (FR10), in the same undo step as the edit.
		V.syncVariants(project.value);
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
			if (gesture) {
				gestureChanged = true;
				return;
			}
			if (timer) clearTimeout(timer);
			timer = setTimeout(commitNow, 350);
		},
		{ deep: true }
	);

	/**
	 * While a pointer is held (App.vue) the history waits: a drag is one undo step, pauses and all, and what came before it
	 * is its own step. Plain clicks commit nothing, so they don't pay for a snapshot.
	 */
	function beginGesture(): void {
		if (gesture) return;
		if (timer) commitNow();
		gesture = true;
		gestureChanged = false;
	}
	function endGesture(): void {
		gesture = false;
		if (gestureChanged) commitNow();
	}
	// A newly named mask gets its colour (FR8.23) in the same undo step as the change that named it.
	watch(
		() => maskNames(project.value).join('\u0000'),
		() => assignMaskHues(project.value)
	);

	function restore(json: string): void {
		suppress = true;
		project.value = JSON.parse(json) as Project;
		current = json;
		saveAutosave(json);
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
		assignMaskHues(project.value);
		generation.value++;
		commitNow();
	}

	function newProject(p?: Project): void {
		load(p ?? createProject());
		markSaved();
	}

	/** The project as it is now matches a file (saved, opened) or has nothing worth keeping yet (new). */
	function markSaved(): void {
		commitNow();
		savedHash = hashText(current);
		try {
			localStorage.setItem(SAVED_KEY, savedHash);
		} catch {
			/* storage unavailable */
		}
	}

	/** Whether the project has changes no file holds. Stringifies the project, so call it on demand, not reactively. */
	function isDirty(): boolean {
		return hashText(JSON.stringify(project.value)) !== savedHash;
	}

	// A run of resizes (dragging the Width field, 256 → 512 → 256) scales from the project as it was before the first
	// one, so rounding and clamping don't compound; any other edit starts a new run.
	let sizeBase: { project: string; after: string } | null = null;

	/** Change the canvas size, scaling every pixel-measured value with it (core/pixelScale.ts). */
	function resize(width: number, height: number): void {
		const now = JSON.stringify(project.value);
		if (!sizeBase || sizeBase.after !== now) sizeBase = { project: now, after: now };
		const next = JSON.parse(sizeBase.project) as Project;
		const [w, h] = [Math.max(1, Math.round(width)), Math.max(1, Math.round(height))];
		// Every variant's px values scale with the canvas.
		V.forEachVariant(next, (q) => Object.assign(q, resizeProject(q, w, h)));
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
		V.syncVariants(project.value);
		const copy = { ...clone(layers()[i]), id: newId('ly') };
		copy.name = `${copy.name.replace(/ copy$/, '')} copy`;
		const at = outsideBlocks(i + 1);
		layers().splice(at, 0, copy);
		V.copyItemSettings(project.value, `layer.${id}`, `layer.${copy.id}`);
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
		if (!l) return;
		const wasCoverage = coverageOnlyAt(project.value, id);
		// With any linked defaults that follow it (Drips: Height turns on with the Sources output).
		Object.assign(l.params, linkedChanges(l.type, l.params, key, value));
		// Now reading only a coverage (Mask area › Inside a noise's or the joints' mask): Pattern would show little but
		// its edge, so its sources start Solid; the user may pick Pattern again.
		if (!wasCoverage && coverageOnlyAt(project.value, id)) Object.assign(l.params, solidSources(l.params));
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
		let n = 0;
		V.forEachVariant(project.value, (q) => {
			const k = groupRenameMask(q, from, to);
			if (q === project.value) n = k;
		});
		return n;
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
		// Its limit and hidden state move onto the members' params in every variant.
		V.forEachVariant(project.value, (q) => groupUngroup(q, id));
	}

	function deleteGroup(id: string): void {
		groupDelete(project.value, id);
	}

	/** A name cleared to nothing goes back to the layer's or light's default: its type's name. */
	const named = (name: string | undefined, fallback: string) =>
		name === undefined ? {} : { name: name.trim() || fallback };

	function updateLayer(id: string, patch: Partial<Pick<Layer, 'name' | 'enabled' | 'locked'>>): void {
		const l = getLayer(id);
		if (l) Object.assign(l, patch, named(patch.name, getLayerDef(l.type)?.label ?? l.type));
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
		V.syncVariants(project.value);
		const copy = { ...clone(lights()[i]), id: newId('lt'), name: `${lights()[i].name} copy` };
		lights().splice(i + 1, 0, copy);
		V.copyItemSettings(project.value, `light.${id}`, `light.${copy.id}`);
		return lights()[i + 1];
	}

	function setLightParam(id: string, key: string, value: ParamValue): void {
		const l = getLight(id);
		if (l) l.params[key] = value;
	}

	function updateLight(id: string, patch: Partial<Pick<Light, 'name' | 'enabled'>>): void {
		const l = getLight(id);
		if (l) Object.assign(l, patch, named(patch.name, LIGHT_DEFS[l.type].label));
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

	function duplicatePost(id: string): PostFilter | undefined {
		const i = post().findIndex((f) => f.id === id);
		if (i < 0) return undefined;
		V.syncVariants(project.value);
		const copy = { ...clone(post()[i]), id: newId('pf') };
		post().splice(i + 1, 0, copy);
		V.copyItemSettings(project.value, `post.${id}`, `post.${copy.id}`);
		return post()[i + 1];
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

	// ---------------------------------------------------------------- variants (FR10)
	// The project is the active variant; core/variants.ts keeps the others. Each action is its own undo step.
	const variants = computed(() => V.variantsOf(project.value));
	const activeVariant = computed(() => V.activeVariant(project.value));
	/** Keys of the settings the active variant changes from the base (as of the last commit). */
	const changedKeys = computed(() => new Set(Object.keys(activeVariant.value.changes)));
	/**
	 * What the outliner marks: `layer.<id>`, `group.<id>`, `light.<id>`, `post.<id>`, 'base' (material), 'environment'
	 * (sky, ambient), 'project' (the rest: seed, height depth, path tracer).
	 */
	const changedItems = computed(() => {
		const out = new Set<string>();
		for (const k of changedKeys.value) {
			const m = /^(layer|group|light|post)\.([^.]+)\./.exec(k);
			if (m) out.add(`${m[1]}.${m[2]}`);
			else if (k.startsWith('base.')) out.add('base');
			else if (k.startsWith('sky.') || k.startsWith('ambient.')) out.add('environment');
			else out.add('project');
		}
		return out;
	});

	/** Whether `key` is a per-variant setting (not structure, sample counts or canvas size). */
	function isVariantSetting(key: string): boolean {
		return key in V.extractSettings(project.value);
	}

	function variantStep(fn: () => void): void {
		commitNow();
		fn();
		commitNow();
	}

	function switchVariant(id: string): void {
		variantStep(() => V.switchVariant(project.value, id));
	}

	/** Step through the list (−1 / +1), wrapping. */
	function stepVariant(dir: number): void {
		const vs = variants.value;
		if (vs.list.length < 2) return;
		const i = vs.list.findIndex((v) => v.id === vs.activeId);
		switchVariant(vs.list[(i + dir + vs.list.length) % vs.list.length].id);
	}

	function addVariant(from?: string): V.ProjectVariant | undefined {
		let v: V.ProjectVariant | undefined;
		variantStep(() => (v = V.addVariant(project.value, from)));
		return v && V.variantsOf(project.value).list.find((x) => x.id === v!.id);
	}

	function deleteVariant(id: string): boolean {
		let ok = false;
		variantStep(() => (ok = V.deleteVariant(project.value, id)));
		return ok;
	}

	function renameVariant(id: string, name: string): void {
		variantStep(() => V.renameVariant(project.value, id, name));
	}

	function setVariantNote(id: string, note: string): void {
		V.setVariantNote(project.value, id, note);
	}

	function moveVariant(id: string, to: number): void {
		variantStep(() => V.moveVariant(project.value, id, to));
	}

	function makeBase(id: string): void {
		variantStep(() => V.makeBase(project.value, id));
	}

	function resetVariant(id: string): void {
		variantStep(() => V.resetVariant(project.value, id));
	}

	function resetToBase(key: string): void {
		variantStep(() => V.resetToBase(project.value, key));
	}

	/** The active variant drops all its changes to item `item` (`layer.<id>` …): it shows the base's settings for it. */
	function resetItemToBase(item: string): void {
		variantStep(() => V.resetItemToBase(project.value, item));
	}

	/** The other variants that change a setting of item `item` (`layer.<id>` …) from the base. */
	function variantsChangingItem(item: string): V.ProjectVariant[] {
		commitNow();
		return V.variantsChangingItem(project.value, item);
	}

	function makeBaseValue(key: string): void {
		variantStep(() => V.makeBaseValue(project.value, key));
	}

	function setVariantValues(id: string, s: V.Settings): void {
		variantStep(() => V.setVariantValues(project.value, id, s));
	}

	/** Variant `id` as a plain project (for its thumbnail, card or export). */
	function variantProject(id: string): Project {
		commitNow();
		return V.materialise(project.value, id);
	}

	return {
		project,
		firstRun,
		generation,
		canUndo,
		canRedo,
		undo,
		redo,
		commitNow,
		beginGesture,
		endGesture,
		load,
		newProject,
		markSaved,
		isDirty,
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
		duplicatePost,
		movePost,
		setPostParam,
		updatePost,
		variants,
		activeVariant,
		changedKeys,
		changedItems,
		isVariantSetting,
		switchVariant,
		stepVariant,
		addVariant,
		deleteVariant,
		renameVariant,
		setVariantNote,
		moveVariant,
		makeBase,
		resetVariant,
		resetToBase,
		resetItemToBase,
		variantsChangingItem,
		makeBaseValue,
		setVariantValues,
		variantProject
	};
});
