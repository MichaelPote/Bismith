// Pattern params: the generator's own params (its Pattern group and any type-specific groups) plus placement and the
// whole-pattern domain warp. Layers of one type that share a seed are copies of one pattern doing different jobs
// (height-only Pillow / Edges / Block heights plus a layer colouring each stone); the optimiser ties their pattern
// params into one search entry (optimizer.ts). The editor never links layers: each is edited on its own.

import { getLayerDef, layerParamDefs } from '@/layers/registry';

/** Placement and whole-pattern warp: part of the pattern, though they live in the common Shaping group. */
export const PLACEMENT_KEYS = new Set(['ofs_x', 'ofs_y', 'dw_amount', 'dw_scale']);

const cache = new Map<string, Set<string>>();

/** Keys that place / shape the pattern itself for a layer type. */
export function patternKeys(type: string): Set<string> {
	let keys = cache.get(type);
	if (!keys) {
		const def = getLayerDef(type);
		const own = new Set(['params', ...(def?.groups ?? []).map((g) => g.id)]);
		keys = new Set(
			layerParamDefs(type)
				.filter((d) => own.has(d.group ?? 'params') || PLACEMENT_KEYS.has(d.key))
				.map((d) => d.key)
		);
		cache.set(type, keys);
	}
	return keys;
}
