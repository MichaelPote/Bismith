// Project data model. A Project is plain JSON and fully describes a texture (see docs/architecture.md §5).

import type { ParamValues } from './params';
import type { VariantSet } from './variants';

export const PROJECT_VERSION = 2;

/**
 * Where a recipe's or template's layer belongs (the project itself keeps one list): 'relief' layers shape the surface
 * only — their colour outputs are off — and go before the 'paint' layers that colour it.
 */
export type LayerStack = 'relief' | 'paint';

export interface Layer {
	id: string;
	/** LayerDef type id, e.g. 'noise', 'rect', 'bricks', 'blur'. */
	type: string;
	name: string;
	enabled: boolean;
	/** Locked layers are never mutated by the optimiser. */
	locked?: boolean;
	params: ParamValues;
}

/**
 * A group of layers (docs/features/fr8.3-groups.md): ordinary layers that sit together as one block of
 * `project.layers` (see gatherGroups) under a name — a material put together from a preset, or any layers grouped by
 * hand. The outliner shows it as one collapsible entry; it can be hidden, limited to masks and saved as a preset as a
 * whole. Ungrouping drops this record and keeps the layers.
 */
export interface LayerGroup {
	id: string;
	name: string;
	/** Member layer ids. */
	members: string[];
	/**
	 * Masks every member is limited to (FR8.23), on top of each member's own Limit to: terms read left to right, `outside`
	 * inverting the whole — the group in front outside an opening, the one behind inside it.
	 */
	limit?: LimitExpr;
	/** false hides the whole group (its members keep their own on/off states). Absent = shown. */
	enabled?: boolean;
}

/** How one more mask joins a limit: or (union), and (intersection), minus (cut out). */
export type LimitOp = 'or' | 'and' | 'minus';

/** A limit expression (Mask › Limit to): masks by name read left to right; `outside` inverts the result. */
export interface LimitExpr {
	terms: { mask: string; op: LimitOp }[];
	outside: boolean;
}

/** The mask shape layers write by default (FR8.23); later layers limit to it, bevel from it, read its features. */
export const SHAPE_MASK = 'Shape';

/** Ids of the layers hidden because their group is. */
export function hiddenByGroup(p: Pick<Project, 'groups'>): Set<string> {
	const ids = new Set<string>();
	for (const g of p.groups ?? []) if (g.enabled === false) for (const id of g.members) ids.add(id);
	return ids;
}

export type LightType = 'directional' | 'point';

export interface Light {
	id: string;
	type: LightType;
	name: string;
	enabled: boolean;
	params: ParamValues;
	/**
	 * Point lights: the distance (px) at which Intensity 1 lights a white surface to 1.0 — the falloff is
	 * (refDist / distance)². Absent = POINT_LIGHT_REF_DIST (64). Not a slider: it scales with the canvas like the light's
	 * px params (core/pixelScale.ts), so a resized or supersampled light stays as bright.
	 */
	refDist?: number;
}

export interface Lighting {
	/**
	 * The sky escaping rays see: a zenith → horizon gradient, or an environment image (core/images.ts file name, '' =
	 * none) — an equirectangular panorama: its top row the zenith, across it the azimuth clockwise from the top of the
	 * texture as the lights' (its left edge the top), turned clockwise by `rotation` degrees. Both × intensity.
	 * `plane`: the texture as a floor (read as a map: its top north, its right east, the zenith straight out of it) or a
	 * wall — that floor stood up on its bottom edge: the zenith above its top, east still to its right, the ground below,
	 * and its face looking south (azimuth 180) at the horizon.
	 */
	sky: {
		enabled: boolean;
		zenith: string;
		horizon: string;
		intensity: number;
		image?: string;
		rotation?: number;
		plane?: 'floor' | 'wall';
	};
	ambient: { color: string; intensity: number };
	lights: Light[];
}

export interface RenderSettings {
	/** Path-traced samples rendered per animation frame. */
	samplesPerFrame: number;
	/** Accumulation stops at this many samples. */
	maxSamples: number;
	/** Indirect bounces (0 = direct light only). */
	bounces: number;
	/** Specular scale: multiplies every pixel's specular level (base + layer Specular outputs); F0 = 0.08 × level × scale. */
	specular: number;
	/**
	 * Specular tint 0..1: 0 = white (dielectric) highlights; 1 = highlights in the surface's own hue at the same
	 * luminance (albedo / luma(albedo)), so glints enrich the colour instead of greying it.
	 */
	specularTint: number;
	/**
	 * Ambient occlusion strength (0 = off): surface lighting × AO^strength, AO measured from the height field's
	 * horizon around each pixel — dark creases where blocks touch, even with cast shadows off.
	 */
	ao: number;
	/** AO search radius in px. */
	aoRadius: number;
	/** Sub-pixel jitter of primary samples (soft shadow edges); off = texel centres. */
	jitter: boolean;
	/** Per-sample luminance clamp against fireflies (0 = off). */
	clamp: number;
	/** Lights cast shadows (off = shading by surface angle only — the painted, hand-lit texture look). */
	shadows: boolean;
	/**
	 * Supersampling 1–4 (optional, default 1): the material stack and tracer run at k× the size and are box-filtered
	 * down before post, so 1 px details are computed finer and averaged (core/supersample.ts).
	 */
	supersample?: number;
	/** Samples an export (File ▸ Export PNG, the Render map) traces: at least maxSamples (FR8.16a). */
	exportSamples: number;
	/** Supersampling of exports 1–4; a project already supersampled more keeps its own (FR8.16a). */
	exportSupersample: number;
}

export interface PostFilter {
	id: string;
	type: string;
	enabled: boolean;
	params: ParamValues;
}

export interface MaterialBase {
	/** Initial diffuse colour under all layers (sRGB hex). */
	color: string;
	roughness: number;
	/** Initial per-pixel specular level (0.5 = a 4 % dielectric reflection at scale 1); layers' Specular outputs vary it. */
	specular: number;
	/** Initial metalness: 0 = non-metal; 1 = metal, which reflects in its diffuse colour and has no diffuse shading. */
	metalness: number;
	height: number;
	opacity: number;
}

/** What a preset applies to (docs/features/fr5.4-presets.md). */
export type PresetKind = 'project' | 'layer' | 'group' | 'light' | 'lighting' | 'post';

/** The header that makes a project file a preset (Project.preset). */
export interface PresetInfo {
	kind: PresetKind;
	/** The layer type, recipe id, light type or post filter type it applies to (none for project and lighting). */
	target?: string;
	/** Random; lets an import recognise a preset it already has. */
	id: string;
	/** How menus group it; none = Other. */
	category?: string;
	tags?: string[];
	/** The images its item uses (Stamp › Image file), by name, as data URLs: the file carries the pixels. */
	images?: Record<string, string>;
}

export interface Project {
	version: number;
	name: string;
	/** Free text about the project, shown on hover in the wizard and preset menus. */
	description?: string;
	width: number;
	height: number;
	/** Wrap noise, shapes, filters and light rays so the texture repeats seamlessly. */
	tileable: boolean;
	/** World height in px of a height value of 1.0. */
	heightDepth: number;
	/** Global seed mixed into every layer seed. */
	seed: number;
	base: MaterialBase;
	/**
	 * The layers in evaluation order: first = earliest (bottom of the stack), last = latest. Each layer's outputs say
	 * which channels it touches — a relief layer is one with its colour outputs off (Diffuse unticked), and a paint layer
	 * may still add fine relief tied to its colour (lit bumps on colour patches, as in hand-painted textures).
	 */
	layers: Layer[];
	/** Groups of the layers (optional: absent = none). */
	groups?: LayerGroup[];
	/**
	 * Each mask's colour in the UI (FR8.23): a category hue (`--cat-<hue>`, masks.ts MASK_HUES), given when the mask is
	 * first named. Shape's is fixed and not stored.
	 */
	maskHues?: Record<string, string>;
	lighting: Lighting;
	render: RenderSettings;
	post: PostFilter[];
	/**
	 * A small lossy thumbnail of the final render, as a data URL (base64 WebP, or JPEG where the browser can't encode
	 * WebP; ≤ 128 px), written on save. The new-project wizard shows it instead of rendering the project (FR8.20).
	 * Optional; rendering ignores it.
	 */
	preview?: string;
	/** Present when the file is a preset (FR5.4): what it applies to and how it is listed. */
	preset?: PresetInfo;
	/**
	 * The project's variants (FR10, core/variants.ts): the same stack with each variant's own settings. Absent = one
	 * variant. In memory the project's settings are the active variant's; in a file they are the base's.
	 */
	variants?: VariantSet;
	/**
	 * Where the project is published in the gallery (src/gallery): the gallery writes it into the files it serves, and
	 * Publish keeps it, so publishing again offers to update that entry (when this browser holds its edit key).
	 */
	gallery?: GalleryRef;
}

export interface GalleryRef {
	id: string;
}

export const SIZE_PRESETS = [16, 32, 64, 128, 256, 512, 1024];
export const MAX_SIZE = 2048;
export const MAX_LIGHTS = 8;

export function defaultLighting(): Lighting {
	return {
		sky: {
			enabled: true,
			zenith: '#9fb4c8',
			horizon: '#c8c2b8',
			intensity: 0.35,
			image: '',
			rotation: 0,
			plane: 'floor'
		},
		ambient: { color: '#ffffff', intensity: 0.02 },
		lights: []
	};
}

export function defaultRender(): RenderSettings {
	return {
		samplesPerFrame: 4,
		maxSamples: 256,
		bounces: 2,
		specular: 1,
		specularTint: 1,
		ao: 0,
		aoRadius: 4,
		jitter: true,
		clamp: 8,
		shadows: true,
		supersample: 1,
		exportSamples: 1024,
		exportSupersample: 2
	};
}

export function defaultBase(): MaterialBase {
	return { color: '#7a7570', roughness: 0.75, specular: 0.5, metalness: 0, height: 0, opacity: 1 };
}

/** One top-level entry of the layer list: a free layer, or a group's block of member layers. */
export type LayerUnit = { layer: Layer; group?: undefined } | { group: LayerGroup; layers: Layer[]; layer?: undefined };

/** Split `layers` into units (a group's members must already sit together, see gatherGroups). */
export function layerUnits(layers: Layer[], groups: LayerGroup[] | undefined): LayerUnit[] {
	const owner = new Map<string, LayerGroup>();
	for (const g of groups ?? []) for (const id of g.members) owner.set(id, g);
	const units: LayerUnit[] = [];
	for (const l of layers) {
		const g = owner.get(l.id);
		const last = units[units.length - 1];
		if (!g) units.push({ layer: l });
		else if (last?.group === g) last.layers.push(l);
		else units.push({ group: g, layers: [l] });
	}
	return units;
}

export const flattenUnits = (units: LayerUnit[]): Layer[] => units.flatMap((u) => (u.group ? u.layers : [u.layer]));

/**
 * Reorder `layers` so each group's members sit together, gathered where the group's last member is (members keep their
 * relative order, other layers theirs). The outliner shows a group as one collapsible block. Gathering at the last
 * member keeps every colour layer in order when a legacy project's relief stack is merged in: the group's relief
 * members move up to join its paint members.
 */
export function gatherGroups(layers: Layer[], groups: LayerGroup[] | undefined): Layer[] {
	if (!groups?.length) return layers;
	const owner = new Map<string, LayerGroup>();
	for (const g of groups) for (const id of g.members) owner.set(id, g);
	const last = new Map<LayerGroup, string>();
	for (const l of layers) {
		const g = owner.get(l.id);
		if (g) last.set(g, l.id);
	}
	const out: Layer[] = [];
	for (const l of layers) {
		const g = owner.get(l.id);
		if (!g) out.push(l);
		else if (last.get(g) === l.id) out.push(...layers.filter((x) => owner.get(x.id) === g));
	}
	return out;
}
