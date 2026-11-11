// Blisters: peeling paint as a shape for the mask, relief first, placed as Drips places its drips.
import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, getLayerDef, layerGroups, layerParamDefs } from '@/layers/registry';
import { maskWriteKind } from '@/layers/masks';

ensureBuiltins();
const def = (key: string) => layerParamDefs('blisters').find((p) => p.key === key)!;
const keys = (t: string) => layerParamDefs(t).map((p) => p.key);

describe('blisters', () => {
	it('writes its shape to the Shape mask, with an Edge card whose bevel starts off', () => {
		expect(keys('blisters')).toEqual(expect.arrayContaining(['mk_target', 'mk_op', 'mk_smooth', 'bevel', 'aa']));
		expect(def('bevel').default).toBe(0);
		expect(def('aa').default).toBe(false);
		expect(def('mk_target').default).toBe('Shape');
		const p = createLayer('blisters').params;
		expect(maskWriteKind(getLayerDef('blisters'), p)).toBe('shape');
		expect(def('mk_smooth').showIf!({ ...p, mk_op: 'smooth-union' })).toBe(true);
		expect(layerGroups(getLayerDef('blisters')!).map((g) => g.id)).not.toContain('shape');
	});

	it('starts with Height on and a rust paint that is not metal', () => {
		expect(createLayer('blisters').params).toMatchObject({ h_on: true, dif_on: true, mt_on: true, mt_b: 0 });
	});

	it('shares the placement params with Drips, so the same seed and settings line the two up', () => {
		const place = [
			'cols',
			'rows',
			'density',
			'cluster',
			'ledge_density',
			'ledge_gap',
			'ledge_start',
			'ledge',
			'ledge_reach',
			'ledge_soft',
			'seed'
		];
		expect(keys('blisters')).toEqual(expect.arrayContaining(place));
		expect(keys('drips')).toEqual(expect.arrayContaining(place));
		for (const k of place) expect(def(k).default, k).toEqual(layerParamDefs('drips').find((p) => p.key === k)!.default);
		const size = { width: 512, height: 512 };
		const [b, d] = [freshParams('blisters', size), freshParams('drips', size)];
		for (const k of ['cols', 'rows', 'density', 'ledge_density', 'ledge_gap']) expect(b[k], k).toEqual(d[k]);
	});

	it('keeps no stain controls, and its ledge controls under Ledges', () => {
		for (const k of ['style', 'len_min', 'width', 'flow', 'output']) expect(keys('blisters')).not.toContain(k);
		expect(getLayerDef('blisters')!.groups).toEqual([{ id: 'relief', label: 'Ledges' }]);
		expect(def('ledge_mix').label).toBe('Ledge bands');
	});

	it('fits the editor defaults in the ranges at every size up to 2048 px', () => {
		for (const width of [16, 64, 128, 512, 2048]) {
			for (const [k, v] of Object.entries(freshParams('blisters', { width, height: width }))) {
				const d = def(k);
				if (typeof v !== 'number' || d.min === undefined) continue;
				expect(v, `${k} at ${width} px`).toBeGreaterThanOrEqual(d.min);
				expect(v, `${k} at ${width} px`).toBeLessThanOrEqual(d.max!);
			}
		}
	});
});
