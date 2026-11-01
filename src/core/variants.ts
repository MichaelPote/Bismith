// Project variants (docs/features/fr10-variants.md): the same stack with each variant's own settings. A setting is a
// flat key built from the stable ids the project has (`layer.<id>.p.<param>`, `light.<id>.on`, `base.roughness` …);
// a variant stores only the settings it changes from the base variant.
//
// In memory the project is the active variant, materialised; `variants.baseValues` holds the base's settings while
// another variant is active. In a file the top level is the base and `variants` lists the others' changes.

import type { ParamValue } from './params';
import type { Project } from './project';
import { newId } from './ids';

/** Every per-variant setting of a project, by key. */
export type Settings = Record<string, ParamValue>;

export interface ProjectVariant {
	id: string;
	name: string;
	note?: string;
	/** The settings it changes from the base (empty for the base itself). */
	changes: Settings;
}

/** A project's variants in memory (Project.variants). */
export interface VariantSet {
	/** The variant the file's top level holds and the others measure from. */
	baseId: string;
	/** The variant the project shows (its settings are the project's). */
	activeId: string;
	/** In display order, the base included. */
	list: ProjectVariant[];
	/** The base's settings while another variant is active. */
	baseValues?: Settings;
}

/** Project.variants in a file: the top level is the base; the others are listed with their changes. */
export interface VariantFile {
	base: { id: string; name: string; note?: string };
	active: string;
	list: ProjectVariant[];
}

/** The name a project's only variant goes by until it is renamed. */
export const FIRST_VARIANT = 'Variant 1';
const FIRST_ID = 'v1';

/** Path tracer settings that change the image; sample counts and supersampling are shared by every variant. */
export const RENDER_LOOK_KEYS = [
	'bounces',
	'specular',
	'specularTint',
	'ao',
	'aoRadius',
	'clamp',
	'shadows',
	'jitter'
] as const;

const clone = <T>(v: T): T => (typeof v === 'object' && v !== null ? (JSON.parse(JSON.stringify(v)) as T) : v);
const same = (a: unknown, b: unknown): boolean =>
	a === b || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

type Rec = Record<string, unknown>;

/** Visit every per-variant setting: its key, and the record and field it lives in. */
function walk(p: Project, visit: (key: string, rec: Rec, field: string) => void): void {
	const fields = (prefix: string, rec: Rec, keys: readonly string[] = Object.keys(rec)) => {
		for (const k of keys) if (k in rec) visit(prefix + k, rec, k);
	};
	for (const l of p.layers) {
		visit(`layer.${l.id}.on`, l as unknown as Rec, 'enabled');
		fields(`layer.${l.id}.p.`, l.params);
	}
	for (const g of p.groups ?? []) visit(`group.${g.id}.on`, g as unknown as Rec, 'enabled');
	for (const l of p.lighting.lights) {
		visit(`light.${l.id}.on`, l as unknown as Rec, 'enabled');
		fields(`light.${l.id}.p.`, l.params);
	}
	for (const f of p.post) {
		visit(`post.${f.id}.on`, f as unknown as Rec, 'enabled');
		fields(`post.${f.id}.p.`, f.params);
	}
	fields('base.', p.base as unknown as Rec);
	fields('sky.', p.lighting.sky as unknown as Rec);
	fields('ambient.', p.lighting.ambient as unknown as Rec);
	fields('render.', p.render as unknown as Rec, RENDER_LOOK_KEYS);
	visit('seed', p as unknown as Rec, 'seed');
	visit('heightDepth', p as unknown as Rec, 'heightDepth');
}

/** A group's `enabled` is absent when shown. */
const isGroupOn = (key: string) => key.startsWith('group.');

/** Every per-variant setting of `p` (values copied). */
export function extractSettings(p: Project): Settings {
	const out: Settings = {};
	walk(p, (key, rec, field) => {
		out[key] = isGroupOn(key) ? rec[field] !== false : clone(rec[field] as ParamValue);
	});
	return out;
}

/** Write `s` onto `p` (values copied); keys `p` has no setting for are ignored. */
export function applySettings(p: Project, s: Settings): void {
	walk(p, (key, rec, field) => {
		if (!(key in s)) return;
		if (isGroupOn(key)) {
			if (s[key] === false) rec[field] = false;
			else delete rec[field];
		} else rec[field] = clone(s[key]);
	});
}

/** The settings of `s` that differ from `base` (keys `base` lacks are left out). */
export function diffSettings(s: Settings, base: Settings): Settings {
	const out: Settings = {};
	for (const k in s) if (k in base && !same(s[k], base[k])) out[k] = clone(s[k]);
	return out;
}

/** The project's variants, or the one it has without a `variants` block (not attached to it). */
export function variantsOf(p: Project): VariantSet {
	return (
		p.variants ?? {
			baseId: FIRST_ID,
			activeId: FIRST_ID,
			list: [{ id: FIRST_ID, name: FIRST_VARIANT, changes: {} }]
		}
	);
}

/** The project's variants, attaching the block when it has none. */
export function ensureVariants(p: Project): VariantSet {
	return (p.variants ??= variantsOf(p));
}

export function activeVariant(p: Project): ProjectVariant {
	const vs = variantsOf(p);
	return vs.list.find((v) => v.id === vs.activeId) ?? vs.list[0];
}

export function baseVariant(p: Project): ProjectVariant {
	const vs = variantsOf(p);
	return vs.list.find((v) => v.id === vs.baseId) ?? vs.list[0];
}

/** The base's settings (call syncVariants first when the active variant's changes may be stale). */
export function baseSettings(p: Project): Settings {
	const vs = p.variants;
	return vs && vs.activeId !== vs.baseId && vs.baseValues ? vs.baseValues : extractSettings(p);
}

function setIfChanged(rec: Rec, field: string, v: unknown): boolean {
	if (same(rec[field], v)) return false;
	rec[field] = v;
	return true;
}

/**
 * Bring the variant state up to date with the project (the active variant) after edits, in place: settings of items
 * added since are adopted into the base (structure is shared, so a new layer joins every variant as it was made),
 * those of items gone are dropped everywhere, the active variant's changes are measured again, and changes that now
 * equal the base are dropped. Only fields whose value differs are written, so syncing a synced project changes nothing.
 * Returns whether anything changed.
 */
export function syncVariants(p: Project): boolean {
	const vs = p.variants;
	if (!vs) return false;
	let changed = false;
	const cur = extractSettings(p);
	const onBase = vs.activeId === vs.baseId;
	let base: Settings;
	if (onBase) {
		base = cur;
		if (vs.baseValues) {
			delete vs.baseValues;
			changed = true;
		}
	} else {
		const old = vs.baseValues ?? {};
		base = {};
		for (const k in cur) base[k] = k in old ? old[k] : clone(cur[k]);
		changed = setIfChanged(vs as unknown as Rec, 'baseValues', base) || changed;
	}
	for (const v of vs.list) {
		const next =
			v.id === vs.baseId ? {} : v.id === vs.activeId ? diffSettings(cur, base) : diffSettings(v.changes, base);
		changed = setIfChanged(v as unknown as Rec, 'changes', next) || changed;
	}
	return changed;
}

/** The full settings of variant `id` (after syncVariants). */
export function variantSettings(p: Project, id: string): Settings {
	const vs = variantsOf(p);
	if (id === vs.activeId) return extractSettings(p);
	const base = baseSettings(p);
	const v = vs.list.find((x) => x.id === id);
	return { ...base, ...(v && id !== vs.baseId ? v.changes : {}) };
}

/** Variant `id` as a plain project, without the `variants` block (after syncVariants). */
export function materialise(p: Project, id: string): Project {
	const q = clone(p);
	delete q.variants;
	if (id !== variantsOf(p).activeId) applySettings(q, variantSettings(p, id));
	return q;
}

/** Show variant `id` (in place): the project takes its settings. */
export function switchVariant(p: Project, id: string): void {
	const vs = p.variants;
	if (!vs || id === vs.activeId || !vs.list.some((v) => v.id === id)) return;
	syncVariants(p);
	const base = baseSettings(p);
	const target = variantSettings(p, id);
	applySettings(p, target);
	vs.activeId = id;
	if (id === vs.baseId) delete vs.baseValues;
	else vs.baseValues = clone(base);
	syncVariants(p);
}

/** A name not yet used by another variant: `name`, else `name 2`, `name 3` … */
export function uniqueVariantName(p: Project, name: string, except?: string): string {
	const used = new Set(
		variantsOf(p)
			.list.filter((v) => v.id !== except)
			.map((v) => v.name.toLowerCase())
	);
	const stem = name.trim() || 'Variant';
	if (!used.has(stem.toLowerCase())) return stem;
	const bare = stem.replace(/ \d+$/, '');
	for (let n = 2; ; n++) if (!used.has(`${bare} ${n}`.toLowerCase())) return `${bare} ${n}`;
}

/** A new variant with the settings of variant `from` (default the active one), after it in the list; it becomes active. */
export function addVariant(p: Project, from?: string, name?: string): ProjectVariant {
	const vs = ensureVariants(p);
	syncVariants(p);
	const src = vs.list.find((v) => v.id === (from ?? vs.activeId)) ?? vs.list[0];
	const v: ProjectVariant = {
		id: newId('vr'),
		name: uniqueVariantName(p, name ?? `Variant ${vs.list.length + 1}`),
		changes: src.id === vs.baseId ? {} : clone(src.id === vs.activeId ? activeVariant(p).changes : src.changes)
	};
	vs.list.splice(vs.list.indexOf(src) + 1, 0, v);
	switchVariant(p, v.id);
	return v;
}

/** Delete variant `id` (never the base); when it is shown, the base is shown instead. */
export function deleteVariant(p: Project, id: string): boolean {
	const vs = p.variants;
	if (!vs || id === vs.baseId || vs.list.length < 2) return false;
	if (vs.activeId === id) switchVariant(p, vs.baseId);
	vs.list = vs.list.filter((v) => v.id !== id);
	return true;
}

export function renameVariant(p: Project, id: string, name: string): void {
	const v = ensureVariants(p).list.find((x) => x.id === id);
	if (v && name.trim()) v.name = uniqueVariantName(p, name, id);
}

export function setVariantNote(p: Project, id: string, note: string): void {
	const v = ensureVariants(p).list.find((x) => x.id === id);
	if (!v) return;
	if (note.trim()) v.note = note;
	else delete v.note;
}

/** Move variant `id` to position `to` in the list. */
export function moveVariant(p: Project, id: string, to: number): void {
	const list = p.variants?.list;
	const i = list?.findIndex((v) => v.id === id) ?? -1;
	if (!list || i < 0) return;
	const [v] = list.splice(i, 1);
	list.splice(Math.max(0, Math.min(list.length, to)), 0, v);
}

/** Make variant `id` the base: every variant keeps its look, its changes measured from the new base. */
export function makeBase(p: Project, id: string): void {
	const vs = p.variants;
	if (!vs || id === vs.baseId || !vs.list.some((v) => v.id === id)) return;
	syncVariants(p);
	const all = new Map(vs.list.map((v) => [v.id, variantSettings(p, v.id)]));
	const base = all.get(id)!;
	vs.baseId = id;
	for (const v of vs.list) v.changes = v.id === id ? {} : diffSettings(all.get(v.id)!, base);
	if (vs.activeId === id) delete vs.baseValues;
	else vs.baseValues = clone(base);
}

/** Drop every change of variant `id`: it shows the base's settings. */
export function resetVariant(p: Project, id: string): void {
	const vs = p.variants;
	if (!vs || id === vs.baseId) return;
	if (id === vs.activeId) applySettings(p, baseSettings(p));
	const v = vs.list.find((x) => x.id === id);
	if (v) v.changes = {};
}

/** The active variant takes the base's value of `key`. */
export function resetToBase(p: Project, key: string): void {
	const vs = p.variants;
	if (!vs || vs.activeId === vs.baseId) return;
	const base = baseSettings(p);
	if (key in base) applySettings(p, { [key]: base[key] });
	syncVariants(p);
}

/** The base takes the active variant's value of `key` (variants that don't change it follow). */
export function makeBaseValue(p: Project, key: string): void {
	const vs = p.variants;
	if (!vs || vs.activeId === vs.baseId || !vs.baseValues) return;
	const cur = extractSettings(p);
	if (!(key in cur)) return;
	vs.baseValues[key] = clone(cur[key]);
	syncVariants(p);
}

/**
 * Give the item `to` (a new copy of `from`: `layer.<id>`, `light.<id>`, `post.<id>`) each variant's settings of
 * `from`. Call after the copy is made and before the next sync adopts it.
 */
export function copyItemSettings(p: Project, from: string, to: string): void {
	const vs = p.variants;
	if (!vs) return;
	const copy = (s: Settings) => {
		for (const k of Object.keys(s)) if (k.startsWith(`${from}.`)) s[to + k.slice(from.length)] = clone(s[k]);
	};
	if (vs.baseValues) copy(vs.baseValues);
	for (const v of vs.list) if (v.id !== vs.activeId) copy(v.changes);
}

/**
 * Run a structural edit that rewrites settings (a resize, a mask rename, an ungroup) on every variant, in place: each
 * variant is materialised, edited and measured again. `edit` mutates the project it is given.
 */
export function forEachVariant(p: Project, edit: (q: Project) => void): void {
	const vs = p.variants;
	if (!vs || vs.list.length < 2) {
		edit(p);
		syncVariants(p);
		return;
	}
	syncVariants(p);
	const edited = new Map<string, Settings>();
	for (const v of vs.list) {
		if (v.id === vs.activeId) continue;
		const q = materialise(p, v.id);
		edit(q);
		edited.set(v.id, extractSettings(q));
	}
	edit(p);
	// An edit that assigns a whole copy (Object.assign(p, resizeProject(p, …))) brings its own old block along.
	p.variants = vs;
	const cur = extractSettings(p);
	const base = vs.activeId === vs.baseId ? cur : edited.get(vs.baseId)!;
	for (const v of vs.list) {
		if (v.id === vs.baseId || v.id === vs.activeId) continue;
		v.changes = diffSettings(edited.get(v.id)!, base);
	}
	if (vs.activeId !== vs.baseId) vs.baseValues = base;
	syncVariants(p);
}

/** `p` (in memory: the active variant) in its file form: the base at the top level, the others' changes listed. */
export function toFileForm(p: Project): Project {
	if (!p.variants) return p;
	const q = clone(p);
	syncVariants(q);
	const vs = q.variants!;
	const out = materialise(q, vs.baseId);
	const base = vs.list.find((v) => v.id === vs.baseId)!;
	const meta = (v: ProjectVariant) => ({ id: v.id, name: v.name, ...(v.note ? { note: v.note } : {}) });
	const file: VariantFile = {
		base: meta(base),
		active: vs.activeId,
		list: vs.list.filter((v) => v !== base).map((v) => ({ ...meta(v), changes: v.changes }))
	};
	return { ...out, variants: file } as unknown as Project;
}

/** Whether `v` is the in-memory form of Project.variants (VariantSet) rather than the file's (VariantFile). */
export function isVariantSet(v: unknown): v is VariantSet {
	return !!v && typeof v === 'object' && typeof (v as VariantSet).baseId === 'string';
}
