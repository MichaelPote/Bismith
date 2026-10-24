// Card presets (docs/features/fr5.4-presets.md): copy a preset's item onto a layer, smart material, light, the lighting
// or a post filter of the open project — and build the preset project a card is saved as.

import type { Layer, Light, PostFilter, Project, SmartMaterial } from '@/core/project';
import type { ParamValues } from '@/core/params';
import { newId } from '@/core/ids';
import { resizeProject } from '@/core/pixelScale';
import { putImage, imageUrl } from '@/core/images';
import { getLayerDef, layerParamDefs } from '@/layers/registry';
import { presetBase, presetProject, type PresetItem } from './stage';
import { builtinProject } from './index';

/** Mask wiring (FR8.23) belongs to the project, not the look: a preset keeps the layer's own. */
const isMaskKey = (k: string) => k.startsWith('mk_') || k.startsWith('lim_');

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

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

/** Apply a smart material preset (same recipe): macros and members' params replaced by role; its limit is kept. */
export function applyMaterialPreset(project: Project, material: SmartMaterial, preset: Project): boolean {
	const p = fitted(preset, project);
	const item = p.materials?.find((m) => m.recipe === material.recipe);
	if (!item) return false;
	bringImages(preset);
	material.params = clone(item.params);
	for (const [role, id] of Object.entries(material.members)) {
		const from = p.layers.find((l) => l.id === item.members[role]);
		const into = project.layers.find((l) => l.id === id);
		if (from && into && from.type === into.type) copyParams(into.params, from.params);
	}
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
	what: { kind: 'layer' | 'material' | 'light' | 'post'; id: string } | { kind: 'lighting' }
): PresetItem | undefined {
	switch (what.kind) {
		case 'layer': {
			const layer = project.layers.find((l) => l.id === what.id);
			return layer && { kind: 'layer', layer: clone(layer) };
		}
		case 'material': {
			const material = project.materials?.find((m) => m.id === what.id);
			if (!material) return undefined;
			const ids = new Set(Object.values(material.members));
			return {
				kind: 'material',
				material: clone(material),
				layers: clone(project.layers.filter((l) => ids.has(l.id)))
			};
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
export function buildPreset(
	project: Project,
	item: PresetItem,
	meta: { name: string; description?: string; category?: string }
): Project {
	const base = presetBase(project.width, project.height, project.tileable);
	if (item.kind === 'layer' || item.kind === 'material') base.heightDepth = project.heightDepth;
	const p = presetProject(
		item,
		base,
		{ id: newId('pr'), ...(meta.category ? { category: meta.category } : {}) },
		() => {
			const scene = builtinProject('bricks')!;
			return resizeProject(scene, project.width, project.height);
		}
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
	p.name = meta.name;
	if (meta.description) p.description = meta.description;
	else delete p.description;
	p.preset = { kind: 'project', id: newId('pr'), ...(meta.category ? { category: meta.category } : {}) };
	const images = imagesOf(p);
	if (images) p.preset.images = images;
	return p;
}
