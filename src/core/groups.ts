// Groups of layers (core/project.ts LayerGroup): a block of ordinary layers under a name — a material put together from
// a preset, or layers grouped by hand. Finding a layer's group, adding a preset's layers as one, ungrouping, deleting,
// limiting a whole group to masks, renaming a mask everywhere it is named.

import { newId } from './ids';
import type { Layer, LayerGroup, LimitExpr, Project } from './project';
import { foldLimit, layerLimit, limitParams } from '@/layers/masks';
import { layerParamDefs } from '@/layers/registry';

/** The group a layer belongs to, if any. */
export function groupOf(p: Pick<Project, 'groups'>, layerId: string): LayerGroup | undefined {
	return (p.groups ?? []).find((g) => g.members.includes(layerId));
}

/**
 * Add `layers` (in stack order) to `p` as one new group at `at` (default last, on top of everything), in place. The
 * caller picks an index outside other groups' blocks. Returns the group.
 */
export function addGroup(
	p: Project,
	name: string,
	layers: Layer[],
	at = p.layers.length,
	extra: Pick<LayerGroup, 'limit' | 'enabled'> = {}
): LayerGroup {
	p.layers.splice(Math.max(0, Math.min(p.layers.length, at)), 0, ...layers);
	const g: LayerGroup = { id: newId('gr'), name, members: layers.map((l) => l.id), ...extra };
	(p.groups ??= []).push(g);
	return g;
}

/** Drop the group record; its layers stay as ordinary layers (switched off if the group was hidden). */
export function ungroup(p: Project, id: string): void {
	const g = (p.groups ?? []).find((x) => x.id === id);
	for (const lid of g?.members ?? []) {
		const l = p.layers.find((x) => x.id === lid);
		if (!l) continue;
		if (g!.enabled === false) l.enabled = false;
		// The group's limit moves onto its members.
		if (g!.limit) Object.assign(l.params, limitParams(foldLimit(layerLimit(l.params), g!.limit)));
	}
	p.groups = (p.groups ?? []).filter((x) => x.id !== id);
}

/** Remove the group and its member layers. */
export function deleteGroup(p: Project, id: string): void {
	const g = (p.groups ?? []).find((x) => x.id === id);
	if (!g) return;
	const ids = new Set(g.members);
	p.layers = p.layers.filter((l) => !ids.has(l.id));
	ungroup(p, id);
}

/** Forget members that no longer exist (after a layer is deleted); drop a group left without members. */
export function pruneGroups(p: Project): void {
	if (!p.groups?.length) return;
	const ids = new Set(p.layers.map((l) => l.id));
	for (const g of p.groups) g.members = g.members.filter((id) => ids.has(id));
	p.groups = p.groups.filter((g) => g.members.length > 0);
}

/**
 * Limit a whole group to masks (FR8.23), on top of each member's own Limit to — e.g. a wall outside an opening an
 * earlier shape wrote, the group behind it inside. Kept on the group (the pipeline applies it).
 */
export function setGroupLimit(g: LayerGroup, limit: LimitExpr | null): void {
	if (limit?.terms.length) g.limit = limit;
	else delete g.limit;
}

/**
 * Rename a mask everywhere it is named (FR8.23): what layers write and are limited to, their sources, and groups'
 * limits. Returns how many places changed.
 */
export function renameMask(p: Project, from: string, to: string): number {
	const name = to.trim();
	if (!name || name === from) return 0;
	let n = 0;
	for (const l of p.layers) {
		for (const d of layerParamDefs(l.type)) {
			if (d.mask && String(l.params[d.key] ?? '').trim() === from) {
				l.params[d.key] = name;
				n++;
			}
		}
	}
	for (const g of p.groups ?? []) {
		for (const t of g.limit?.terms ?? []) {
			if (t.mask === from) {
				t.mask = name;
				n++;
			}
		}
	}
	// Its colour goes with it — unless it was renamed into a mask that already has one.
	const hue = p.maskHues?.[from];
	if (hue) {
		delete p.maskHues![from];
		p.maskHues![name] ??= hue;
	}
	return n;
}
