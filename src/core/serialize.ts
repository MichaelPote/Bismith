// Project (de)serialisation with defaults-filling so hand-written, optimiser-generated and older files load.

import { ensureBuiltins } from '@/render/builtins';
import { getLayerDef, layerParamDefs, sanitizeLayer, createLayer as registryCreateLayer } from '@/layers/registry';
import { MASK_HUES, sanitizeLimit } from '@/layers/masks';
import { createPostFilter as registryCreatePost, getPostDef, sanitizePostFilter } from '@/render/post/registry';
import { LIGHT_DEFS, createLight } from './lights';
import { GALLERY_ID } from '@/gallery/ids';
import { deepCopy, defaultParams, sanitizeParams } from './params';
import { AMBIENT_DEFS, BASE_DEFS, PROJECT_DEFS, RENDER_DEFS, SKY_DEFS } from './settingsDefs';
import { newId } from './ids';
import {
	applySettings,
	diffSettings,
	extractSettings,
	isVariantSet,
	switchVariant,
	toFileForm,
	uniqueVariantName,
	type ProjectVariant,
	type Settings
} from './variants';
import {
	MAX_LIGHTS,
	PROJECT_VERSION,
	defaultBase,
	defaultLighting,
	defaultRender,
	gatherGroups,
	type Layer,
	type Light,
	type Lighting,
	type MaterialBase,
	type RenderSettings,
	type PostFilter,
	type PresetInfo,
	type PresetKind,
	type Project,
	type LayerGroup
} from './project';

/** The project's own settings (PROJECT_DEFS). */
type ProjectField = 'width' | 'height' | 'tileable' | 'heightDepth' | 'seed';

export function createProject(overrides: Partial<Project> = {}): Project {
	ensureBuiltins();
	const project: Project = {
		version: PROJECT_VERSION,
		name: 'Untitled',
		...(defaultParams(PROJECT_DEFS) as Pick<Project, ProjectField>),
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

const PRESET_KINDS: PresetKind[] = ['project', 'layer', 'group', 'light', 'lighting', 'post'];
const IMAGE_PATTERN = /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/]+=*$/;

/** A valid preset header (Project.preset), or undefined; images that aren't base64 image data URLs are dropped. */
function presetInfo(v: unknown): { preset: PresetInfo } | undefined {
	if (!v || typeof v !== 'object') return undefined;
	const r = v as Record<string, unknown>;
	// (A smart material's preset is a group's now.)
	const kind = r.kind === 'material' ? 'group' : r.kind;
	if (!PRESET_KINDS.includes(kind as PresetKind)) return undefined;
	const preset: PresetInfo = { kind: kind as PresetKind, id: typeof r.id === 'string' && r.id ? r.id : newId() };
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

/** The project's gallery entry (Project.gallery), or undefined. */
function galleryRef(v: unknown): { gallery: { id: string } } | undefined {
	const id = v && typeof v === 'object' ? (v as Record<string, unknown>).id : undefined;
	return typeof id === 'string' && GALLERY_ID.test(id) ? { gallery: { id } } : undefined;
}

function str(v: unknown, def: string): string {
	return typeof v === 'string' ? v : def;
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

/**
 * Validate and default-fill any project-like object. Unknown layer / post types are dropped. Takes a file (the base
 * variant at the top level) or a project from the editor (the active one, FR10); returns the editor's form.
 */
export function normalizeProject(input: unknown): Project {
	ensureBuiltins();
	let raw = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
	// The in-memory form (an autosave, a project being loaded) keeps which names still follow the project's; a file's
	// names are the user's.
	let auto = new Set<string>();
	if (isVariantSet(raw.variants)) {
		auto = new Set(raw.variants.list.filter((v) => v.auto).map((v) => v.id));
		try {
			raw = toFileForm(raw as Project) as unknown as Record<string, any>;
		} catch {
			raw = { ...raw, variants: undefined };
		}
	}
	const p = withVariants(normalizeBase(raw), raw.variants);
	const vs = p.variants;
	// (`auto` before `changes`, as everywhere else: the same project serialises the same.)
	if (vs)
		vs.list = vs.list.map(({ changes, ...v }) => (auto.has(v.id) ? { ...v, auto: true, changes } : { ...v, changes }));
	return p;
}

/**
 * A file's variants (FR10) on its normalised base: each variant's changes applied to a copy and normalised like the
 * base, so values are checked and clamped by the same rules, then measured again (changes of items that are gone, or
 * equal to the base, drop out). The project shows the file's active variant.
 */
function withVariants(base: Project, rv: unknown): Project {
	if (!rv || typeof rv !== 'object') return base;
	const r = rv as Record<string, any>;
	const meta = (v: any, name: string): Omit<ProjectVariant, 'changes'> => ({
		id: str(v?.id, '') || newId('vr'),
		name: str(v?.name, '').trim() || name,
		...(typeof v?.note === 'string' && v.note.trim() ? { note: v.note } : {})
	});
	const first = meta(r.base, 'Variant 1');
	base.variants = { baseId: first.id, activeId: first.id, list: [{ ...first, changes: {} }] };
	const baseValues = extractSettings(base);
	for (const v of Array.isArray(r.list) ? r.list : []) {
		if (!v || typeof v !== 'object') continue;
		const m = meta(v, 'Variant');
		if (base.variants.list.some((x) => x.id === m.id)) continue;
		const copy: Project = deepCopy({ ...base, variants: undefined });
		if (v.changes && typeof v.changes === 'object') applySettings(copy, v.changes as Settings);
		const changes = diffSettings(extractSettings(normalizeBase(copy as unknown as Record<string, any>)), baseValues);
		base.variants.list.push({ ...m, name: uniqueVariantName(base, m.name), changes });
	}
	if (typeof r.active === 'string') switchVariant(base, r.active);
	return base;
}

/**
 * Ids made unique: a repeat (a hand-edited or badly converted file) gets a fresh id, or the two items would share
 * everything kept by id — shader state, variant changes, group membership.
 */
function uniqueIds<T extends { id: string }>(items: T[], prefix: string): T[] {
	const seen = new Set<string>();
	return items.map((it) => {
		const id = seen.has(it.id) ? newId(prefix) : it.id;
		seen.add(id);
		return id === it.id ? it : { ...it, id };
	});
}

/** The project's own fields (in a file, the base variant's), validated and default-filled. */
function normalizeBase(raw: Record<string, any>): Project {
	const rl = (raw.lighting ?? {}) as Record<string, any>;

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
	const flat = uniqueIds([...stack(raw.relief).map(reliefOnly), ...stack(raw.layers)], 'ly');
	const layerIds = new Set(flat.map((l) => l.id));
	// Groups keep only members that still exist; one with none left is dropped. Older projects' smart materials load as
	// groups (their members were by role; their recipe and macros are gone).
	const groups: LayerGroup[] = (
		Array.isArray(raw.groups) ? raw.groups : Array.isArray(raw.materials) ? raw.materials : []
	)
		.filter((g: any) => g && typeof g === 'object')
		.map((g: any) => ({
			id: str(g.id, newId('gr')),
			name: str(g.name, typeof g.recipe === 'string' ? g.recipe : 'Group'),
			members: (Array.isArray(g.members) ? g.members : Object.values(g.members ?? {})).filter(
				(id: unknown): id is string => typeof id === 'string' && layerIds.has(id)
			),
			...(sanitizeLimit(g.limit) ? { limit: sanitizeLimit(g.limit) } : {}),
			...(g.enabled === false ? { enabled: false } : {})
		}))
		.filter((g: LayerGroup) => g.members.length > 0);
	// Masks' colours (FR8.23): known hues only; a mask without one is given one in the editor.
	const maskHues = Object.fromEntries(
		Object.entries(raw.maskHues && typeof raw.maskHues === 'object' ? raw.maskHues : {}).filter(
			([k, h]) => k.trim() && typeof h === 'string' && MASK_HUES.includes(h)
		)
	) as Record<string, string>;

	const lights: Light[] = uniqueIds(
		(Array.isArray(rl.lights) ? rl.lights : [])
			.filter((l: any) => l && (l.type === 'directional' || l.type === 'point'))
			.slice(0, MAX_LIGHTS)
			.map((l: any) => ({
				id: str(l.id, newId('lt')),
				type: l.type,
				name: str(l.name, LIGHT_DEFS[l.type as 'point'].label),
				enabled: l.enabled !== false,
				params: sanitizeParams(LIGHT_DEFS[l.type as 'point'].params, l.params),
				...(l.type === 'point' && typeof l.refDist === 'number' && l.refDist > 0
					? { refDist: Math.min(l.refDist, 1e6) }
					: {})
			})),
		'lt'
	);

	const post: PostFilter[] = uniqueIds(
		(Array.isArray(raw.post) ? raw.post : [])
			.filter((f: any) => f && typeof f.type === 'string' && getPostDef(f.type))
			.map((f: any) =>
				sanitizePostFilter({
					id: str(f.id, newId('pf')),
					type: f.type,
					enabled: f.enabled !== false,
					params: f.params ?? {}
				})
			),
		'pf'
	);

	return {
		version: PROJECT_VERSION,
		name: str(raw.name, 'Untitled'),
		...(typeof raw.description === 'string' && raw.description.trim() ? { description: raw.description } : {}),
		...(sanitizeParams(PROJECT_DEFS, raw) as Pick<Project, ProjectField>),
		base: sanitizeParams(BASE_DEFS, raw.base) as unknown as MaterialBase,
		layers: gatherGroups(flat, groups),
		...(groups.length ? { groups } : {}),
		...(Object.keys(maskHues).length ? { maskHues } : {}),
		lighting: {
			sky: sanitizeParams(SKY_DEFS, rl.sky) as unknown as Lighting['sky'],
			ambient: sanitizeParams(AMBIENT_DEFS, rl.ambient) as unknown as Lighting['ambient'],
			lights
		},
		render: sanitizeParams(RENDER_DEFS, raw.render) as unknown as RenderSettings,
		post,
		...(galleryRef(raw.gallery) ?? {}),
		// Last, so the file's readable part comes first.
		...(isPreview(raw.preview) ? { preview: raw.preview } : {}),
		...(presetInfo(raw.preset) ?? {})
	};
}

/** The project as a file: the base variant at the top level, the others' changes in `variants` (FR10). */
export function projectToJSON(project: Project): string {
	return JSON.stringify(toFileForm(project), null, 2);
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
