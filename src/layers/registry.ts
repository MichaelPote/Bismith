import {
	defaultParams,
	sanitizeParams,
	type GroupDef,
	type ParamDef,
	type ParamValue,
	type ParamValues
} from '@/core/params';
import type { Layer } from '@/core/project';
import { newId } from '@/core/ids';
import type { LayerCategory, LayerChannels, LayerDef } from './types';
import {
	FILTER_GROUPS,
	GENERATOR_GROUPS,
	LIMIT_PARAMS,
	MASK_PARAMS,
	MASK_WRITE_PARAMS,
	OUTPUT_PARAMS,
	PHASE_PARAM,
	SDF_PARAMS,
	MASK_SDF_PARAMS,
	SHAPING_PARAMS,
	WARP_PHASE_PARAM
} from './commonParams';
import { SHAPE_MASK } from '@/core/project';

const defs = new Map<string, LayerDef>();
/** Mask › Write to's params, which show only while the layer can write a mask. */
const WRITE_KEYS = new Set(MASK_WRITE_PARAMS.map((p) => p.key));
const fullParams = new Map<string, ParamDef[]>();

export const CATEGORY_LABELS: Record<LayerCategory, string> = {
	noise: 'Noise',
	shape: 'Shapes',
	pattern: 'Patterns',
	filter: 'Filters',
	adjust: 'Adjust'
};

export function registerLayer(def: LayerDef): void {
	defs.set(def.type, def);
	const own = def.params.map((p) => ({ ...p, group: p.group ?? 'params' }));
	let all: ParamDef[];
	if (def.kind === 'generator') {
		// Every generator has a `phase` (the wrapper sets the noise library's gPhase from it): its own, the noise one in
		// the Pattern card (before the seed), or the domain-warp one in Shaping.
		const hasPhase = own.some((p) => p.key === 'phase');
		const seedAt = own.findIndex((p) => p.key === 'seed');
		const pattern =
			hasPhase || !def.noise
				? own
				: seedAt < 0
					? [...own, PHASE_PARAM]
					: [...own.slice(0, seedAt), PHASE_PARAM, ...own.slice(seedAt)];
		const shaping = hasPhase || def.noise ? SHAPING_PARAMS : [...SHAPING_PARAMS, WARP_PHASE_PARAM];
		// Shape layers and mask-only ones alike get the Edge card; on a mask-only layer the bevel shapes the generator's own
		// value, so it starts at 0 (the generator's look) there.
		let shape = def.sdf === true ? SDF_PARAMS : def.sdf === 'mask' ? MASK_SDF_PARAMS : [];
		const when = def.sdfShowIf;
		if (when)
			shape = shape.map((p) => ({ ...p, showIf: (v: ParamValues) => when(v, p.key) && (!p.showIf || p.showIf(v)) }));
		// Write to (FR8.23): shape layers write the Shape mask unless told otherwise; other generators (and shape layers in a
		// mode without a shape) write their coverage when given a mask (masks.ts maskWriteKind).
		const writable = (v: ParamValues) => !def.maskWrite || def.maskWrite({ ...v, mk_target: SHAPE_MASK }) !== false;
		const mask = MASK_PARAMS.map((p) => {
			if (!WRITE_KEYS.has(p.key)) return p;
			const q = p.key === 'mk_target' && def.sdf ? { ...p, default: SHAPE_MASK } : p;
			return { ...q, showIf: (v: ParamValues) => writable(v) && (!q.showIf || q.showIf(v)) };
		});
		all = [...pattern, ...shape, ...shaping, ...mask, ...OUTPUT_PARAMS];
	} else {
		// Filters: their own params, then Limit to (FR8.23).
		all = [...own, ...LIMIT_PARAMS];
	}
	if (def.defaults) {
		all = all.map((p) => (p.key in def.defaults! ? { ...p, default: def.defaults![p.key] } : p));
	}
	if (def.paramPatch) {
		all = all.map((p) => (p.key in def.paramPatch! ? { ...p, ...def.paramPatch![p.key] } : p));
	}
	fullParams.set(def.type, all);
}

export function getLayerDef(type: string): LayerDef | undefined {
	return defs.get(type);
}

export function allLayerDefs(): LayerDef[] {
	return [...defs.values()];
}

/** Type params followed by the common generator params, with per-type default overrides applied. */
export function layerParamDefs(type: string): ParamDef[] {
	return fullParams.get(type) ?? [];
}

export function layerGroups(def: LayerDef): GroupDef[] {
	const base = def.kind === 'generator' ? GENERATOR_GROUPS : FILTER_GROUPS;
	const extra = def.groups ?? [];
	// Type-specific groups go right after the main params group.
	return [base[0], ...extra, ...base.slice(1)];
}

const GENERATOR_CHANNELS: LayerChannels = { diffuse: 'dif_on', height: 'h_on' };

/** Which of the Diffuse / Height columns a layer type affects, and the tick that switches each (see LayerDef.channels). */
export function layerChannels(type: string): LayerChannels {
	const def = defs.get(type);
	if (!def) return {};
	return def.kind === 'generator' ? GENERATOR_CHANNELS : (def.channels ?? {});
}

/** Params stored before a change to a type's params, rewritten by the type (LayerDef.migrate). */
export function migrateParams(params: ParamValues, type: string): ParamValues {
	const def = defs.get(type);
	return def?.migrate ? def.migrate(params) : params;
}

/**
 * What a layer added in the editor starts with (before the caller's overrides): a shape layer's Roughness and Specular
 * follow its shape — one value inside, another outside (Source › Shape) — not its pattern, which on a shape is the
 * bevel's ramp and on Wood the grain (every dark line would turn glossy); then the type's own editor defaults
 * (LayerDef.fresh). Layers built in code and stored projects keep the plain defaults.
 */
export function freshParams(type: string, texture: { width: number; height: number }): ParamValues {
	const def = defs.get(type);
	if (!def) return {};
	const shape: ParamValues = def.kind === 'generator' && def.sdf === true ? { r_src: 'shape', s_src: 'shape' } : {};
	return { ...shape, ...(def.fresh?.(texture) ?? {}) };
}

export function createLayer(type: string, overrides: ParamValues = {}, name?: string): Layer {
	const def = defs.get(type);
	if (!def) throw new Error(`Unknown layer type: ${type}`);
	const params = { ...defaultParams(layerParamDefs(type)), ...migrateParams(overrides, type) };
	if (def.linkedDefaults)
		for (const [k, v] of Object.entries(def.linkedDefaults(params))) if (!(k in overrides)) params[k] = v;
	return { id: newId('ly'), type, name: name ?? def.label, enabled: true, params };
}

/**
 * The params to write when `key` changes to `value`: it, and the type's linked defaults (LayerDef.linkedDefaults)
 * that were still at their default and now have another.
 */
export function linkedChanges(type: string, params: ParamValues, key: string, value: ParamValue): ParamValues {
	const changes: ParamValues = { [key]: value };
	const link = defs.get(type)?.linkedDefaults;
	if (!link) return changes;
	const before = link(params);
	const after = link({ ...params, [key]: value });
	// By value: a linked gradient is a new object on every call (and a loaded one never the same object).
	const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
	for (const [k, v] of Object.entries(after))
		if (k !== key && same(params[k], before[k]) && !same(v, before[k])) changes[k] = v;
	return changes;
}

/** Fill missing params with defaults, drop unknown ones, clamp values. */
export function sanitizeLayer(layer: Layer): Layer {
	const defsForType = layerParamDefs(layer.type);
	return { ...layer, params: sanitizeParams(defsForType, migrateParams(layer.params, layer.type)) };
}
