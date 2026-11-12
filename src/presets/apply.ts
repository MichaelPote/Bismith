// Card presets (docs/features/fr5.4-presets.md): copy a preset's item onto a layer, smart material, light, the lighting
// or a post filter of the open project — and build the preset project a card is saved as.

import type { Layer, LayerGroup, LimitExpr, Light, PostFilter, Project } from '@/core/project';
import { deepCopy as clone, type ParamValues } from '@/core/params';
import { newId } from '@/core/ids';
import { resizeProject } from '@/core/pixelScale';
import { putImage, imageUrl } from '@/core/images';
import { getLayerDef, layerParamDefs } from '@/layers/registry';
import { presetBase, presetProject, type PresetItem } from './stage';
import { builtinProject, STARTER } from './index';

/** Mask wiring (FR8.23) belongs to the project, not the look: a preset keeps the layer's own. */
const isMaskKey = (k: string) => k.startsWith('mk_') || k.startsWith('lim_');

/** The preset's project at the open project's size: pixel-measured values rescaled, as a canvas resize would. */
function fitted(preset: Project, project: Project): Project {
	return resizeProject(preset, project.width, project.height);
}

/** The images a preset carries, stored in this browser first so its Stamp layers and its sky find them. */
function bringImages(preset: Project): void {
	for (const [name, url] of Object.entries(preset.preset?.images ?? {})) putImage(name, url);
}

function copyParams(into: ParamValues, from: ParamValues): void {
	for (const k of Object.keys(into)) if (!isMaskKey(k) && !(k in from)) delete into[k];
	for (const [k, v] of Object.entries(from)) if (!isMaskKey(k)) into[k] = clone(v);
}

/** The item of a layer preset: its last layer of the type (a stage, if any, comes first). */
function presetLayer(preset: Project, type: string): Layer | undefined {
	return [...preset.layers].reverse().find((l) => l.type === type);
}

/** Apply a layer preset to `layer` (same type): params replaced, mask wiring kept; a default name takes the preset's. */
export function applyLayerPreset(project: Project, layer: Layer, preset: Project): boolean {
	const item = presetLayer(fitted(preset, project), layer.type);
	if (!item) return false;
	bringImages(preset);
	copyParams(layer.params, item.params);
	if (layer.name === getLayerDef(layer.type)?.label) layer.name = item.name;
	return true;
}

/**
 * A group preset's layers to add to `project`: fitted to its size, with fresh ids (the same preset can go in twice), and
 * its group's name and limit. Its images are stored in this browser first.
 */
export function groupPresetLayers(
	project: Project,
	preset: Project
): { name: string; layers: Layer[]; limit?: LimitExpr } | undefined {
	const p = fitted(preset, project);
	const g = p.groups?.[0];
	if (!g) return undefined;
	bringImages(preset);
	const layers = p.layers.filter((l) => g.members.includes(l.id)).map((l) => ({ ...clone(l), id: newId('ly') }));
	return { name: preset.name || g.name, layers, ...(g.limit ? { limit: clone(g.limit) } : {}) };
}

/** Apply a group preset to a group: its layers replaced by the preset's, where they were; its name and limit kept. */
export function applyGroupPreset(project: Project, group: LayerGroup, preset: Project): boolean {
	const item = groupPresetLayers(project, preset);
	if (!item) return false;
	const old = new Set(group.members);
	const at = project.layers.findIndex((l) => old.has(l.id));
	project.layers = project.layers.filter((l) => !old.has(l.id));
	project.layers.splice(at < 0 ? project.layers.length : at, 0, ...item.layers);
	group.members = item.layers.map((l) => l.id);
	return true;
}

/** Apply a light preset (same type): all its params. */
export function applyLightPreset(project: Project, light: Light, preset: Project): boolean {
	const item = fitted(preset, project).lighting.lights.find((l) => l.type === light.type);
	if (!item) return false;
	light.params = clone(item.params);
	// Its falloff reference was fitted with its height; a point light without one uses the default.
	if (item.refDist === undefined) delete light.refDist;
	else light.refDist = item.refDist;
	return true;
}

/** Apply a lighting preset: sky, ambient and the light list (render settings are left alone). */
export function applyLightingPreset(project: Project, preset: Project): void {
	bringImages(preset);
	const l = fitted(preset, project).lighting;
	project.lighting = { sky: l.sky, ambient: l.ambient, lights: l.lights.map((x) => ({ ...x, id: newId('lt') })) };
}

/** Apply a post filter preset (same type): all its params. */
export function applyPostPreset(project: Project, filter: PostFilter, preset: Project): boolean {
	const item = [...fitted(preset, project).post].reverse().find((f) => f.type === filter.type);
	if (!item) return false;
	filter.params = clone(item.params);
	return true;
}

// ---------------------------------------------------------------------------------------------------- saving

/** The images `p` uses (Stamp › Image file, the sky's environment), as data URLs, so the preset file carries them. */
function imagesOf(p: Project): Record<string, string> | undefined {
	const names = [p.lighting.sky.image ?? ''];
	for (const l of p.layers)
		for (const d of layerParamDefs(l.type)) if (d.image) names.push(String(l.params[d.key] ?? ''));
	const out: Record<string, string> = {};
	for (const name of names) {
		const url = name ? imageUrl(name) : undefined;
		if (url) out[name] = url;
	}
	return Object.keys(out).length ? out : undefined;
}

/** What to save as a preset, taken (copied) from the open project. */
export function presetItemOf(
	project: Project,
	what: { kind: 'layer' | 'group' | 'light' | 'post'; id: string } | { kind: 'lighting' }
): PresetItem | undefined {
	switch (what.kind) {
		case 'layer': {
			const layer = project.layers.find((l) => l.id === what.id);
			return layer && { kind: 'layer', layer: clone(layer) };
		}
		case 'group': {
			const group = project.groups?.find((g) => g.id === what.id);
			if (!group) return undefined;
			const ids = new Set(group.members);
			return { kind: 'group', group: clone(group), layers: clone(project.layers.filter((l) => ids.has(l.id))) };
		}
		case 'light': {
			const light = project.lighting.lights.find((l) => l.id === what.id);
			return light && { kind: 'light', light: clone(light) };
		}
		case 'lighting':
			return { kind: 'lighting', lighting: clone(project.lighting) };
		case 'post': {
			const filter = project.post.find((f) => f.id === what.id);
			return filter && { kind: 'post', filter: clone(filter) };
		}
	}
}

/**
 * The preset project for `item` at the open project's size and tiling: the item under the standard rig, on the stage
 * when it has no relief of its own, a post filter on the Stone bricks starter; named, described and carrying the
 * images it uses. The thumbnail (preview) is rendered from it afterwards.
 */
export async function buildPreset(
	project: Project,
	item: PresetItem,
	meta: { name: string; description?: string; category?: string }
): Promise<Project> {
	const base = presetBase(project.width, project.height, project.tileable);
	if (item.kind === 'layer' || item.kind === 'group') base.heightDepth = project.heightDepth;
	// The starter is fetched only for a post filter (on the plain stage when it can't be).
	const scene = item.kind === 'post' ? await builtinProject(STARTER).catch(() => undefined) : undefined;
	const p = presetProject(
		item,
		base,
		{ id: newId('pr'), ...(meta.category ? { category: meta.category } : {}) },
		scene && (() => resizeProject(scene, project.width, project.height))
	);
	p.name = meta.name;
	if (meta.description) p.description = meta.description;
	const images = imagesOf(p);
	if (images) p.preset!.images = images;
	delete p.preview;
	return p;
}

/** The project saved by File ▸ Save as template…: the whole project as a `project` preset. */
export function buildTemplate(
	project: Project,
	meta: { name: string; description?: string; category?: string }
): Project {
	const p = clone(project);
	// The variant shown, alone (FR10): a template starts a project with one.
	delete p.variants;
	p.name = meta.name;
	if (meta.description) p.description = meta.description;
	else delete p.description;
	p.preset = { kind: 'project', id: newId('pr'), ...(meta.category ? { category: meta.category } : {}) };
	const images = imagesOf(p);
	if (images) p.preset.images = images;
	return p;
}
