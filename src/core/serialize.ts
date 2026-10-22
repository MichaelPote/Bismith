// Project (de)serialisation with defaults-filling so hand-written, optimiser-generated and older files load.

import { ensureBuiltins } from '@/render/builtins';
import { getLayerDef, layerParamDefs, sanitizeLayer, createLayer as registryCreateLayer } from '@/layers/registry';
import { sanitizeLimit } from '@/layers/masks';
import { createPostFilter as registryCreatePost, getPostDef, sanitizePostFilter } from '@/render/post/registry';
import { LIGHT_DEFS, createLight } from './lights';
import { sanitizeParams } from './params';
import { newId } from './ids';
import {
	MAX_LIGHTS,
	MAX_SIZE,
	PROJECT_VERSION,
	defaultBase,
	defaultLighting,
	defaultRender,
	groupMaterials,
	type Layer,
	type Light,
	type PostFilter,
	type PresetInfo,
	type PresetKind,
	type Project,
	type SmartMaterial
} from './project';

export function createProject(overrides: Partial<Project> = {}): Project {
	ensureBuiltins();
	const project: Project = {
		version: PROJECT_VERSION,
		name: 'Untitled',
		width: 128,
		height: 128,
		tileable: true,
		heightDepth: 2,
		seed: 1,
		base: defaultBase(),
		layers: [
			createLayer('noise', {
				noise: 'perlin',
				fractal: 'fbm',
				scale: 4,
				octaves: 6,
				h_on: true,
				h_amount: 0.6,
				dif_on: true,
				dif_grad: {
					stops: [
						{ pos: 0, color: '#3b342e' },
						{ pos: 1, color: '#9a8c7a' }
					]
				}
			})
		],
		lighting: { ...defaultLighting(), lights: [createLight('directional')] },
		render: defaultRender(),
		post: [createPostFilter('tonemap')],
		...overrides
	};
	return project;
}

/** Longest preview data URL kept on load (a 128 px WebP is a few KB; anything this large is not a preview). */
export const PREVIEW_LIMIT = 256 * 1024;
const PREVIEW_PATTERN = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/;

/** A project preview (Project.preview): a base64 WebP, JPEG or PNG data URL of reasonable size. */
export function isPreview(v: unknown): v is string {
	return typeof v === 'string' && v.length <= PREVIEW_LIMIT && PREVIEW_PATTERN.test(v);
}

const PRESET_KINDS: PresetKind[] = ['project', 'layer', 'material', 'light', 'lighting', 'post'];
const IMAGE_PATTERN = /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/]+=*$/;

/** A valid preset header (Project.preset), or undefined; images that aren't base64 image data URLs are dropped. */
function presetInfo(v: unknown): { preset: PresetInfo } | undefined {
	if (!v || typeof v !== 'object') return undefined;
	const r = v as Record<string, unknown>;
	if (!PRESET_KINDS.includes(r.kind as PresetKind)) return undefined;
	const preset: PresetInfo = { kind: r.kind as PresetKind, id: typeof r.id === 'string' && r.id ? r.id : newId() };
	if (typeof r.target === 'string' && r.target) preset.target = r.target;
	if (typeof r.category === 'string' && r.category.trim()) preset.category = r.category.trim();
	if (Array.isArray(r.tags)) preset.tags = r.tags.filter((t): t is string => typeof t === 'string');
	if (r.images && typeof r.images === 'object') {
		const images = Object.entries(r.images as Record<string, unknown>).filter(
			(e): e is [string, string] => typeof e[1] === 'string' && IMAGE_PATTERN.test(e[1])
		);
		if (images.length) preset.images = Object.fromEntries(images);
	}
	return { preset };
}

function num(v: unknown, def: number, min: number, max: number, int = false): number {
	let n = typeof v === 'number' ? v : Number(v);
	if (!Number.isFinite(n)) n = def;
	n = Math.min(max, Math.max(min, n));
	return int ? Math.round(n) : n;
}

function str(v: unknown, def: string): string {
	return typeof v === 'string' ? v : def;
}

function hex(v: unknown, def: string): string {
	return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : def;
}

/** The on/off params of the colour outputs (diffuse, opacity, emission) across layer types. */
const COLOUR_TOGGLES = new Set(['dif_on', 'op_on', 'e_on', 'diffuse', 'opacity', 'emissive']);

/**
 * Untick a layer's colour outputs so it shapes the surface only (in place). Used for layers from a legacy relief stack
 * — projects once kept relief and paint apart and reset the relief's colour to the base after it — and for templates'
 * relief layers.
 */
export function reliefOnly(layer: Layer): Layer {
	for (const d of layerParamDefs(layer.type))
		if (d.type === 'bool' && COLOUR_TOGGLES.has(d.key)) layer.params[d.key] = false;
	return layer;
}

/** Validate and default-fill any project-like object. Unknown layer / post types are dropped. */
export function normalizeProject(input: unknown): Project {
	ensureBuiltins();
	const raw = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
	const base = defaultBase();
	const rb = (raw.base ?? {}) as Record<string, unknown>;
	const lighting = defaultLighting();
	const rl = (raw.lighting ?? {}) as Record<string, any>;
	const render = defaultRender();
	const rr = (raw.render ?? {}) as Record<string, unknown>;

	const stack = (list: unknown): Layer[] =>
		(Array.isArray(list) ? list : [])
			.filter((l: any) => l && typeof l.type === 'string' && getLayerDef(l.type))
			.map((l: any) =>
				sanitizeLayer({
					id: str(l.id, newId('ly')),
					type: l.type,
					name: str(l.name, getLayerDef(l.type)!.label),
					enabled: l.enabled !== false,
					...(l.locked ? { locked: true } : {}),
					params: l.params ?? {}
				})
			);
	// Older projects had a separate relief stack, evaluated before the paint stack: it now leads the one list.
	const flat = [...stack(raw.relief).map(reliefOnly), ...stack(raw.layers)];
	const layerIds = new Set(flat.map((l) => l.id));
	// Smart materials keep only members that still exist; one with none left is dropped.
	const materials: SmartMaterial[] = (Array.isArray(raw.materials) ? raw.materials : [])
		.filter((m: any) => m && typeof m.recipe === 'string')
		.map((m: any) => ({
			id: str(m.id, newId('sm')),
			recipe: m.recipe,
			name: str(m.name, m.recipe),
			params: m.params && typeof m.params === 'object' ? JSON.parse(JSON.stringify(m.params)) : {},
			members: Object.fromEntries(
				Object.entries(m.members ?? {}).filter(([, id]) => typeof id === 'string' && layerIds.has(id as string))
			) as Record<string, string>,
			...(sanitizeLimit(m.limit) ? { limit: sanitizeLimit(m.limit) } : {}),
			...(m.enabled === false ? { enabled: false } : {})
		}))
		.filter((m: SmartMaterial) => Object.keys(m.members).length > 0);

	const lights: Light[] = (Array.isArray(rl.lights) ? rl.lights : [])
		.filter((l: any) => l && (l.type === 'directional' || l.type === 'point'))
		.slice(0, MAX_LIGHTS)
		.map((l: any) => ({
			id: str(l.id, newId('lt')),
			type: l.type,
			name: str(l.name, LIGHT_DEFS[l.type as 'point'].label),
			enabled: l.enabled !== false,
			params: sanitizeParams(LIGHT_DEFS[l.type as 'point'].params, l.params)
		}));

	const post: PostFilter[] = (Array.isArray(raw.post) ? raw.post : [])
		.filter((f: any) => f && typeof f.type === 'string' && getPostDef(f.type))
		.map((f: any) =>
			sanitizePostFilter({
				id: str(f.id, newId('pf')),
				type: f.type,
				enabled: f.enabled !== false,
				params: f.params ?? {}
			})
		);

	// Specular used to be a single render setting (the level, F0 = 0.08 × specular). Projects without a base level
	// keep their look: base level 0.5, render scale = old level / 0.5.
	const legacySpec = rb.specular === undefined;
	const specLevel = legacySpec ? 0.5 : num(rb.specular, base.specular, 0, 1);
	const specScale = legacySpec ? num(rr.specular, 0.5, 0, 2) / 0.5 : num(rr.specular, render.specular, 0, 4);

	return {
		version: PROJECT_VERSION,
		name: str(raw.name, 'Untitled'),
		...(typeof raw.description === 'string' && raw.description.trim() ? { description: raw.description } : {}),
		width: num(raw.width, 128, 1, MAX_SIZE, true),
		height: num(raw.height, 128, 1, MAX_SIZE, true),
		tileable: raw.tileable !== false,
		heightDepth: num(raw.heightDepth, 2, 0, 4096),
		seed: num(raw.seed, 1, 0, 99999, true),
		base: {
			color: hex(rb.color, base.color),
			roughness: num(rb.roughness, base.roughness, 0, 1),
			specular: specLevel,
			height: num(rb.height, base.height, -64, 64),
			opacity: num(rb.opacity, base.opacity, 0, 1)
		},
		layers: groupMaterials(flat, materials),
		...(materials.length ? { materials } : {}),
		lighting: {
			sky: {
				enabled: rl.sky?.enabled !== false,
				zenith: hex(rl.sky?.zenith, lighting.sky.zenith),
				horizon: hex(rl.sky?.horizon, lighting.sky.horizon),
				intensity: num(rl.sky?.intensity, lighting.sky.intensity, 0, 1000)
			},
			ambient: {
				color: hex(rl.ambient?.color, lighting.ambient.color),
				intensity: num(rl.ambient?.intensity, lighting.ambient.intensity, 0, 1000)
			},
			lights
		},
		render: {
			samplesPerFrame: num(rr.samplesPerFrame, render.samplesPerFrame, 1, 64, true),
			maxSamples: num(rr.maxSamples, render.maxSamples, 1, 65536, true),
			bounces: num(rr.bounces, render.bounces, 0, 4, true),
			specular: specScale,
			specularTint: num(rr.specularTint, render.specularTint, 0, 1),
			ao: num(rr.ao, render.ao, 0, 8),
			aoRadius: num(rr.aoRadius, render.aoRadius, 0.5, 128),
			jitter: rr.jitter !== false,
			clamp: num(rr.clamp, render.clamp, 0, 1000),
			shadows: rr.shadows !== false,
			supersample: num(rr.supersample, 1, 1, 4, true),
			exportSamples: num(rr.exportSamples, render.exportSamples, 1, 65536, true),
			exportSupersample: num(rr.exportSupersample, render.exportSupersample, 1, 4, true)
		},
		post,
		// Last, so the file's readable part comes first.
		...(isPreview(raw.preview) ? { preview: raw.preview } : {}),
		...(presetInfo(raw.preset) ?? {})
	};
}

export function projectToJSON(project: Project): string {
	return JSON.stringify(project, null, 2);
}

export function projectFromJSON(text: string): Project {
	return normalizeProject(JSON.parse(text));
}

/** createLayer / createPostFilter that make sure the built-in types are registered first. */
export function createLayer(...args: Parameters<typeof registryCreateLayer>): Layer {
	ensureBuiltins();
	return registryCreateLayer(...args);
}

export function createPostFilter(...args: Parameters<typeof registryCreatePost>): PostFilter {
	ensureBuiltins();
	return registryCreatePost(...args);
}

export { createLight };
