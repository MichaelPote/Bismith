// Registry-wide checks on every layer type's params: each reaches its shader, linked defaults name known params,
// defaults and slider ranges sit inside the hard limits, and the pixel-scale flags are consistent.
import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import type { ParamDef, ParamValues } from '@/core/params';
import { allLayerDefs, createLayer, layerParamDefs } from './registry';

ensureBuiltins();
const defs = allLayerDefs();

/** Params that are not a `u_<key>` uniform of the layer's own shader. */
const noUniform = (d: ParamDef) => d.key === 'seed' || d.uniform === false;

/**
 * Layers that read some params outside their gen() shader — on the CPU (cpuData: layouts, routing, text, wave tables) or
 * in their prepare passes (Drips) — so a param missing from `glsl` is not necessarily unused: skipped here (their own
 * tests cover their CPU side). A new layer of this kind must be added deliberately.
 */
const READ_ELSEWHERE = new Set(['stamp', 'label', 'polyline', 'drips', 'splats', 'traces', 'causticlight', 'pipework']);
/** Filter params read only by their prepare passes (the edge filters' jump flood, Cavity's blur). */
const READ_IN_PREPARE = new Set(['bevel.threshold', 'bevel.smooth', 'etch.threshold', 'etch.smooth', 'cavity.radius']);

/** The enum variants of a layer's own params (defaults, then each other option), to probe param-dependent hooks. */
function variants(type: string, own: ParamDef[]): ParamValues[] {
	const base = createLayer(type).params;
	const out = [base];
	for (const d of own)
		if (d.type === 'enum')
			for (const o of d.options ?? []) if (o.value !== d.default) out.push({ ...base, [d.key]: o.value });
	return out;
}

describe('layer registry', () => {
	it('every param a layer declares is a uniform its shader uses', () => {
		const unused: string[] = [];
		for (const def of defs) {
			const glsl = def.kind === 'generator' ? def.glsl : def.run ? undefined : def.filterGlsl;
			if (!glsl || READ_ELSEWHERE.has(def.type)) continue;
			for (const d of def.params) {
				// (A curve is read through curve_<key>, which the profile helpers may call: Bevel's custom profile.)
				if (noUniform(d) || d.type === 'curve' || READ_IN_PREPARE.has(`${def.type}.${d.key}`)) continue;
				if (!new RegExp(`\\bu_${d.key}\\b`).test(glsl)) unused.push(`${def.type}.${d.key}`);
			}
		}
		expect(unused).toEqual([]);
	});

	it('declares every param once (a type param named like a common one redefines its uniform)', () => {
		const dup: string[] = [];
		for (const def of defs) {
			const seen = new Set<string>();
			for (const d of layerParamDefs(def.type)) {
				if (seen.has(d.key)) dup.push(`${def.type}.${d.key}`);
				seen.add(d.key);
			}
		}
		expect(dup).toEqual([]);
	});

	it('links only known params, to valid options', () => {
		const bad: string[] = [];
		for (const def of defs) {
			if (!def.linkedDefaults) continue;
			const params = new Map(layerParamDefs(def.type).map((d) => [d.key, d]));
			for (const v of variants(def.type, def.params))
				for (const [k, x] of Object.entries(def.linkedDefaults(v))) {
					const d = params.get(k);
					if (!d) bad.push(`${def.type}.${k}: unknown`);
					else if (d.type === 'enum' && !d.options?.some((o) => o.value === x)) bad.push(`${def.type}.${k}: ${x}`);
				}
		}
		expect([...new Set(bad)]).toEqual([]);
	});

	it('sizes fresh layers with known params and valid options', () => {
		const bad: string[] = [];
		for (const def of defs) {
			if (!def.fresh) continue;
			const params = new Map(layerParamDefs(def.type).map((d) => [d.key, d]));
			for (const [width, height] of [
				[64, 64],
				[512, 512],
				[1024, 256]
			])
				for (const [k, v] of Object.entries(def.fresh({ width, height }))) {
					const d = params.get(k);
					if (!d) bad.push(`${def.type}.${k}: unknown`);
					else if (d.type === 'enum' && !d.options?.some((o) => o.value === v)) bad.push(`${def.type}.${k}: ${v}`);
				}
		}
		expect([...new Set(bad)]).toEqual([]);
	});

	it('keeps defaults, slider ranges and enum defaults inside their limits', () => {
		const bad: string[] = [];
		for (const def of defs)
			for (const d of layerParamDefs(def.type)) {
				const at = `${def.type}.${d.key}`;
				if (d.type === 'enum') {
					if (!d.options?.some((o) => o.value === d.default)) bad.push(`${at}: default ${d.default} not an option`);
					continue;
				}
				if (d.type !== 'float' && d.type !== 'int') continue;
				const lo = d.min ?? -Infinity,
					hi = d.max ?? Infinity,
					v = Number(d.default);
				if (!(v >= lo && v <= hi)) bad.push(`${at}: default ${v} outside [${lo}, ${hi}]`);
				if (d.softMin !== undefined && !(d.softMin >= lo && d.softMin <= hi)) bad.push(`${at}: softMin ${d.softMin}`);
				if (d.softMax !== undefined && !(d.softMax >= lo && d.softMax <= hi)) bad.push(`${at}: softMax ${d.softMax}`);
				if ((d.softMin ?? lo) > (d.softMax ?? hi)) bad.push(`${at}: softMin > softMax`);
			}
		expect(bad).toEqual([]);
	});

	it('flags pixel scaling consistently', () => {
		const bad: string[] = [];
		for (const def of defs)
			for (const d of layerParamDefs(def.type)) {
				const at = `${def.type}.${d.key}`;
				const px = d.unit === 'px';
				if ((d.axis || d.outputPx) && !px) bad.push(`${at}: axis / outputPx without unit 'px'`);
				if (px && (d.perArea || d.perPx)) bad.push(`${at}: unit 'px' and perArea / perPx`);
				if (px && d.type !== 'float' && d.type !== 'int') bad.push(`${at}: unit 'px' on a ${d.type}`);
			}
		expect(bad).toEqual([]);
	});
});
