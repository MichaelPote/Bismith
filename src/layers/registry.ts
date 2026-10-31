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
import type { LayerCategory, LayerChannels, LayerDef, MaskSourceDef } from './types';
import {
	FILTER_GROUPS,
	GENERATOR_GROUPS,
	LIMIT_PARAMS,
	MASK_PARAMS,
	MASK_WRITE_PARAMS,
	MAX_WRITE_ROWS,
	rowKey,
	rowOf,
	rowTarget,
	OUTPUT_PARAMS,
	PARTS_SRC_KEYS,
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
/** The params of one Write to row (`rowKey` gives row n's). */
const ROW_BASES = ['mk_src', 'mk_target', 'mk_op', 'mk_smooth', 'mk_feather'];
const fullParams = new Map<string, ParamDef[]>();

export const CATEGORY_LABELS: Record<LayerCategory, string> = {
	noise: 'Noise',
	shape: 'Shapes',
	pattern: 'Patterns',
	filter: 'Filters',
	adjust: 'Adjust'
};

/** The source every layer offers unless its type lists its own: itself, as drawn. */
const LAYER_SOURCE: MaskSourceDef = { value: 'layer', label: 'This layer', hint: 'the layer as drawn', params: {} };
/** An output's label without its parenthesis ("Edges (F2 − F1)" → "Edges"); the parenthesis goes to the hint. */
const shortLabel = (l: string) => l.replace(/\s*\(.*\)\s*$/, '');
const sources = new Map<string, MaskSourceDef[]>();

/**
 * What a generator can write into a mask (Write to › Source): its own list (LayerDef.maskSources) or This layer, then one
 * per option of its Output enum (`out_<value>`, the layer run as that output) — except an output named like a source it
 * already has (Greebles' rivets, a part and an output both).
 */
function buildSources(def: LayerDef, own: ParamDef[]): MaskSourceDef[] {
	if (def.kind !== 'generator') return [];
	const list = [...(def.maskSources ?? [LAYER_SOURCE])];
	const output = own.find((p) => p.key === 'output' && p.type === 'enum');
	for (const o of output?.options ?? []) {
		const label = shortLabel(o.label);
		if (list.some((s) => s.label.toLowerCase() === label.toLowerCase())) continue;
		const paren = /\((.*)\)\s*$/.exec(o.label)?.[1];
		list.push({
			value: `out_${o.value}`,
			label,
			hint: [paren, o.hint].filter(Boolean).join(': ') || undefined,
			params: { output: o.value },
			soft: true
		});
	}
	return list;
}

/** A generator's mask sources (Write to › Source), the first the default. */
export function maskSourcesOf(type: string): MaskSourceDef[] {
	return sources.get(type) ?? [];
}

export function registerLayer(def: LayerDef): void {
	const own = def.params.map((p) => ({ ...p, group: p.group ?? 'params' }));
	const srcs = buildSources(def, own);
	sources.set(def.type, srcs);
	defs.set(def.type, def);
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
		// Write to's rows: row 1 targets Shape on a shape layer; each of the type's sources has a row of its own from the
		// start (row n's Source defaults to the nth); rows past them are added ones (Write to › Add mask). Every
		// Source lists the type's sources (hidden when there is only one).
		const options = srcs.map((s) => ({ value: s.value, label: s.label, ...(s.hint ? { hint: s.hint } : {}) }));
		const srcRows = Math.max(1, Math.min(srcs.length, MAX_WRITE_ROWS));
		const mask = MASK_PARAMS.map((p) => {
			if (!WRITE_KEYS.has(p.key)) return p;
			let q = p.key === 'mk_target' && def.sdf ? { ...p, default: SHAPE_MASK } : p;
			const n = rowOf(p.key);
			if (p.key.startsWith('mk_src') || p.key.startsWith('mk_target')) {
				// An added row stays while it and those before it write a mask; an empty one is the next to add, shown once
				// every row before it writes one.
				const filled = (v: ParamValues, from: number, to: number) => {
					for (let k = from; k <= to; k++) if (!rowTarget(v, k)) return false;
					return true;
				};
				const rowShown = (v: ParamValues) =>
					n <= srcRows || (filled(v, srcRows + 1, n - 1) && (rowTarget(v, n) !== '' || filled(v, 1, n - 1)));
				q = { ...q, showIf: rowShown };
			}
			if (p.key.startsWith('mk_src')) {
				const shown = q.showIf;
				q = {
					...q,
					options,
					default: (srcs[n - 1] ?? srcs[0])?.value ?? 'layer',
					showIf: (v) => srcs.length > 1 && (!shown || shown(v))
				};
			}
			const r = q;
			return { ...r, showIf: (v: ParamValues) => writable(v) && (!r.showIf || r.showIf(v)) };
		});
		all = [...pattern, ...shape, ...shaping, ...mask, ...OUTPUT_PARAMS];
	} else {
		// Filters: their own params, then Limit to (FR8.23).
		all = [...own, ...LIMIT_PARAMS];
	}
	if (def.parts) {
		const opt = { value: 'parts', label: 'Parts', hint: def.parts };
		all = all.map((p) => (PARTS_SRC_KEYS.includes(p.key) ? { ...p, options: [...(p.options ?? []), opt] } : p));
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

/** Params stored before a change to a type's params, rewritten by the type (LayerDef.migrate), then the old mask fields. */
export function migrateParams(params: ParamValues, type: string): ParamValues {
	const def = defs.get(type);
	const p = def?.migrate ? def.migrate(params) : params;
	return def?.kind === 'generator' ? migrateMaskRows(p, type) : p;
}

/**
 * The mask fields before Write to's rows (FR8.23) folded into rows: "… to" fields (an output's `mk_<output>`, Mask
 * area's `mk_crev` / `mk_high`) into rows after the first with that source; a "what goes to the mask" choice (Greebles,
 * Vents and Pipes' `mask`, Trim's `mask_shape`, Crystal's `mask_feat`, Mask area's `mk_sdf`) into row 1's source.
 */
function migrateMaskRows(params: ParamValues, type: string): ParamValues {
	const srcs = sources.get(type) ?? [];
	const has = (v: string) => srcs.some((s) => s.value === v);
	const out: ParamValues = { ...params };
	const extra: [string, string][] = [];
	for (const [k, v] of Object.entries(params)) {
		const m = /^mk_(.+)$/.exec(k);
		if (!m || WRITE_KEYS.has(k)) continue;
		// (An output's, else a part of the same name: Greebles' lights, Trim's dividers.)
		const src =
			m[1] === 'crev' ? 'crevices_sdf' : m[1] === 'high' ? 'high_sdf' : has(`out_${m[1]}`) ? `out_${m[1]}` : m[1];
		delete out[k];
		if (has(src) && String(v ?? '').trim()) extra.push([src, String(v).trim()]);
	}
	// Row 1's source from the old choice of what goes to the mask ('none': it wrote nothing).
	const pick = (key: string, map: (v: string) => string) => {
		if (!(key in params) || 'mk_src' in params) return;
		const v = String(params[key]);
		if (v === 'none') out.mk_target = '';
		else if (has(map(v))) out.mk_src = map(v);
	};
	pick('mask', (v) => v);
	pick('mask_shape', (v) => v);
	pick('mask_feat', (v) => v);
	if (params.mk_sdf === 'distance') pick('find', (v) => (v === 'high' ? 'high_sdf' : 'crevices_sdf'));
	// Each into its source's own row when that is free, else the first free row after row 1.
	const free = (n: number) => !String(out[rowKey('mk_target', n)] ?? '').trim();
	for (const [src, target] of extra) {
		const at = srcs.findIndex((s) => s.value === src) + 1;
		let n = at > 1 && free(at) ? at : 2;
		while (n <= MAX_WRITE_ROWS && !free(n)) n++;
		if (n > MAX_WRITE_ROWS) break;
		out[rowKey('mk_src', n)] = src;
		out[rowKey('mk_target', n)] = target;
	}
	return out;
}

/**
 * What a layer added in the editor starts with (before the caller's overrides): a shape layer's Roughness, Specular and
 * Metalness follow its shape (unless the type's defaults pick their Source) — one value inside, another outside (Source › Shape) — not its pattern, which on a shape is the
 * bevel's ramp and on Wood the grain (every dark line would turn glossy); then the type's own editor defaults
 * (LayerDef.fresh). Layers built in code and stored projects keep the plain defaults.
 */
export function freshParams(type: string, texture: { width: number; height: number }): ParamValues {
	const def = defs.get(type);
	if (!def) return {};
	const shape: ParamValues = {};
	if (def.kind === 'generator' && def.sdf === true)
		for (const k of ['r_src', 's_src', 'mt_src']) if (def.defaults?.[k] === undefined) shape[k] = 'shape';
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
	const params = sanitizeParams(defsForType, migrateParams(layer.params, layer.type));
	// Write to's rows (FR8.23): a further row that writes from another source's own row, while that one is empty, moves
	// there; a further row that writes nothing offers its own source again. (Saves from before each source had a row of
	// its own hold the first source in every row, and their masks packed from row 2.)
	const srcs = sources.get(layer.type) ?? [];
	const srcRows = Math.min(srcs.length, MAX_WRITE_ROWS);
	for (let n = 2; n <= srcRows; n++) {
		const k = srcs.findIndex((s) => s.value === params[rowKey('mk_src', n)]) + 1;
		if (k < 2 || k > srcRows || k === n || !rowTarget(params, n) || rowTarget(params, k)) continue;
		for (const b of ROW_BASES)
			[params[rowKey(b, k)], params[rowKey(b, n)]] = [params[rowKey(b, n)], params[rowKey(b, k)]];
	}
	for (const d of defsForType)
		if (d.key.startsWith('mk_src_') && !rowTarget(params, rowOf(d.key))) params[d.key] = d.default;
	return { ...layer, params };
}
