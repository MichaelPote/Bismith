// LayerDef.derivedUniforms: values a layer's shader needs that depend only on its params and the canvas, computed on
// the CPU once per render and uploaded as `d_<name>` uniforms, so that work doesn't run at every pixel.

import type { Uniforms } from '@/gpu/context';
import type { DerivedUniforms, DerivedUniformType, LayerCanvas } from '@/layers/types';
import type { ParamValues } from '@/core/params';

const COMPONENTS: Record<string, number> = {
	int: 1,
	float: 1,
	vec2: 2,
	vec3: 3,
	vec4: 4,
	ivec2: 2,
	ivec3: 3,
	ivec4: 4
};

/** A declared type's parts: whether it holds ints, its components per element, and its array length (0: not an array). */
function parseType(type: DerivedUniformType): { base: string; int: boolean; comps: number; length: number } {
	const m = /^(\w+)(?:\[(\d+)\])?$/.exec(type);
	const comps = m ? COMPONENTS[m[1]] : undefined;
	const length = m?.[2] ? Number(m[2]) : 0;
	if (!m || !comps || (m[2] !== undefined && length < 1)) throw new Error(`Unknown derived uniform type "${type}"`);
	return { base: m[1], int: m[1].startsWith('i'), comps, length };
}

/** The GLSL declarations of a layer's derived uniforms. */
export function declareDerived(d: DerivedUniforms | undefined): string {
	if (!d) return '';
	return Object.entries(d.decl)
		.map(([name, type]) => {
			const t = parseType(type);
			return `uniform ${t.base} d_${name}${t.length ? `[${t.length}]` : ''};\n`;
		})
		.join('');
}

/** Material uniforms for a layer's derived uniforms, zeroed (a scalar a number, else a typed array of its components). */
export function createDerived(d: DerivedUniforms | undefined): Uniforms {
	const u: Uniforms = {};
	for (const [name, type] of Object.entries(d?.decl ?? {})) {
		const t = parseType(type);
		const n = t.comps * Math.max(t.length, 1);
		u[`d_${name}`] = { value: n === 1 && !t.length ? 0 : t.int ? new Int32Array(n) : new Float32Array(n) };
	}
	return u;
}

/** Check computed values against the declaration and write them into a material's uniforms. */
export function setDerived(
	uniforms: Uniforms,
	d: DerivedUniforms,
	values: Record<string, number | ArrayLike<number>>
): void {
	for (const [name, type] of Object.entries(d.decl)) {
		const t = parseType(type);
		const v = values[name];
		const n = t.comps * Math.max(t.length, 1);
		const list: ArrayLike<number> | undefined = typeof v === 'number' ? [v] : v;
		if (!list || list.length !== n) throw new Error(`Derived uniform ${name} (${type}) needs ${n} value(s)`);
		for (let i = 0; i < n; i++)
			if (!Number.isFinite(list[i]) || (t.int && !Number.isInteger(list[i])))
				throw new Error(`Derived uniform ${name} (${type}): ${list[i]} is not ${t.int ? 'an integer' : 'finite'}`);
		const u = uniforms[`d_${name}`];
		if (!u) continue;
		if (typeof u.value === 'number') u.value = list[0];
		else (u.value as Int32Array | Float32Array).set(list);
	}
}

/**
 * Computed values by slot (a layer, or one of its extra mask writes), recomputed when the params or canvas change. Not
 * worth caching for the cheap ones, but a lattice search or fit loop needn't rerun on every frame of a drag elsewhere.
 */
export class DerivedCache {
	private hits = new Map<string, { key: string; values: Record<string, number | ArrayLike<number>> }>();

	values(
		slot: string,
		d: DerivedUniforms,
		params: ParamValues,
		canvas: LayerCanvas
	): Record<string, number | ArrayLike<number>> {
		const key = JSON.stringify([params, canvas.width, canvas.height, canvas.tileable, canvas.seed]);
		const hit = this.hits.get(slot);
		if (hit && hit.key === key) return hit.values;
		const values = d.compute(params, canvas);
		this.hits.set(slot, { key, values });
		return values;
	}

	/** Forget the slots of layers no longer in the stack (`live`: layer ids; a slot is its layer's id or `id#…`). */
	prune(live: Set<string>): void {
		for (const slot of this.hits.keys()) if (!live.has(slot.split('#')[0])) this.hits.delete(slot);
	}
}
