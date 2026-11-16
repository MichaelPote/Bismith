// Presets (docs/features/fr5.4-presets.md): the built-ins (presets/, read-only) and the user's own, kept in this
// browser's IndexedDB — far more room than localStorage, which the autosave and stored images already use. Browser
// storage belongs to one origin and goes when site data is cleared, so the user's presets export to a file and import
// back. Menus list both kinds mixed, grouped by category.

import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';
import type { PresetKind, Project } from '@/core/project';
import { normalizeProject, projectFromJSON, projectToJSON } from '@/core/serialize';
import { forgetBuiltinPresets, loadBuiltinPresets, type PresetEntry } from '@/presets';
import { idbRun } from '@/core/idb';

/** One stored user preset: the project file's text, and its header copied out for listing without parsing it all. */
interface UserRecord {
	id: string;
	text: string;
	kind: PresetKind;
	target?: string;
	name: string;
	description?: string;
	category?: string;
	preview?: string;
}

const run = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
	idbRun('presets', mode, f);

function toRecord(project: Project): UserRecord {
	const h = project.preset!;
	return {
		id: h.id,
		text: projectToJSON(project),
		kind: h.kind,
		target: h.target,
		name: project.name,
		description: project.description,
		category: h.category,
		preview: project.preview
	};
}

function toEntry(r: UserRecord): PresetEntry {
	return {
		key: `user:${r.id}`,
		builtin: false,
		kind: r.kind,
		target: r.target,
		name: r.name,
		description: r.description,
		category: r.category,
		preview: r.preview,
		project: async () => projectFromJSON(r.text)
	};
}

/** Categories listed first, in this order (the starters' and the group presets'); the rest follow alphabetically. */
const CATEGORY_ORDER = [
	'UI surfaces',
	'Stone',
	'Floors & walls',
	'Nature',
	'Liquids',
	'Metal',
	'Industrial',
	'Tech',
	'Basics'
];

export interface PresetGroup {
	category: string;
	entries: PresetEntry[];
}

export const usePresetsStore = defineStore('presets', () => {
	/** The built-ins, from presets/manifest.json (empty until it has loaded). */
	const builtin = shallowRef<PresetEntry[]>([]);
	const user = shallowRef<UserRecord[]>([]);
	/** false when this browser won't store them (private window, blocked site data): they last for the session only. */
	const persistent = shallowRef(true);
	let loading: Promise<void> | null = null;

	/** The built-ins' manifest again (a dev export changed the presets). */
	async function reloadBuiltins(): Promise<void> {
		forgetBuiltinPresets();
		builtin.value = await loadBuiltinPresets();
	}

	/** Read the built-ins' manifest and the user's presets from IndexedDB (once; menus call it as they open). */
	function load(): Promise<void> {
		loading ??= Promise.all([
			loadBuiltinPresets()
				.then((list) => {
					builtin.value = list;
				})
				.catch((e) => {
					console.warn('[bismith] built-in presets did not load', e);
					loading = null; // try again when a menu next opens
				}),
			run<UserRecord[]>('readonly', (s) => s.getAll())
				.then((list) => {
					user.value = list;
				})
				.catch(() => {
					persistent.value = false;
				})
		]).then(() => undefined);
		return loading;
	}

	const entries = computed<PresetEntry[]>(() => [...builtin.value, ...user.value.map(toEntry)]);

	/** Presets of a kind (and target, for those that have one). */
	function list(kind: PresetKind, target?: string): PresetEntry[] {
		return entries.value.filter((e) => e.kind === kind && (target === undefined || e.target === target));
	}

	/**
	 * `list` grouped by category, built-ins and the user's mixed: the starters' categories in their usual order
	 * (CATEGORY_ORDER), then the rest alphabetically, Other last; presets by name within each.
	 */
	function grouped(kind: PresetKind, target?: string): PresetGroup[] {
		const groups = new Map<string, PresetEntry[]>();
		for (const e of list(kind, target)) {
			const c = e.category ?? 'Other';
			groups.set(c, [...(groups.get(c) ?? []), e]);
		}
		const rank = (c: string) => (c === 'Other' ? Infinity : CATEGORY_ORDER.indexOf(c) + 1 || 1e6);
		return [...groups.entries()]
			.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
			.map(([category, list]) => ({ category, entries: list.sort((a, b) => a.name.localeCompare(b.name)) }));
	}

	/** The categories in use for a kind (for the save dialog's suggestions). */
	function categories(kind: PresetKind): string[] {
		return [...new Set(list(kind).flatMap((e) => (e.category ? [e.category] : [])))];
	}

	async function put(r: UserRecord): Promise<void> {
		user.value = [...user.value.filter((x) => x.id !== r.id), r];
		if (persistent.value)
			await run('readwrite', (s) => s.put(r)).catch(() => {
				persistent.value = false;
			});
	}

	/** Store a preset project (it must carry its `preset` header). */
	async function save(project: Project): Promise<PresetEntry> {
		if (!project.preset) throw new Error('Not a preset');
		await load();
		const r = toRecord(project);
		await put(r);
		return toEntry(r);
	}

	/** Rename one of the user's presets, or change its description or category. */
	async function update(key: string, patch: { name?: string; description?: string; category?: string }): Promise<void> {
		const r = user.value.find((x) => `user:${x.id}` === key);
		if (!r) return;
		const p = projectFromJSON(r.text);
		if (patch.name !== undefined) p.name = patch.name.trim() || p.name;
		if (patch.description !== undefined) {
			if (patch.description.trim()) p.description = patch.description.trim();
			else delete p.description;
		}
		if (patch.category !== undefined) {
			if (patch.category.trim()) p.preset!.category = patch.category.trim();
			else delete p.preset!.category;
		}
		await put(toRecord(p));
	}

	async function remove(key: string): Promise<void> {
		const id = key.replace(/^user:/, '');
		user.value = user.value.filter((x) => x.id !== id);
		if (persistent.value) await run('readwrite', (s) => s.delete(id)).catch(() => undefined);
	}

	/** The user's presets (optionally one category) as a .bismith-presets.json file's text: an array of preset files. */
	function exportText(category?: string): string {
		const list = user.value.filter((r) => category === undefined || (r.category ?? 'Other') === category);
		return `[\n${list.map((r) => r.text).join(',\n')}\n]\n`;
	}

	/**
	 * Import a .bismith-presets.json file, or a single preset file. Presets already stored (by id) are skipped, as are
	 * projects without a preset header.
	 */
	async function importText(text: string): Promise<{ added: number; skipped: number }> {
		await load();
		const raw = JSON.parse(text) as unknown;
		const items = Array.isArray(raw) ? raw : [raw];
		let added = 0;
		let skipped = 0;
		for (const item of items) {
			const p = normalizeProject(item);
			if (!p.preset || user.value.some((r) => r.id === p.preset!.id)) {
				skipped++;
				continue;
			}
			await put(toRecord(p));
			added++;
		}
		return { added, skipped };
	}

	return {
		user,
		persistent,
		load,
		reloadBuiltins,
		entries,
		list,
		grouped,
		categories,
		save,
		update,
		remove,
		exportText,
		importText
	};
});
