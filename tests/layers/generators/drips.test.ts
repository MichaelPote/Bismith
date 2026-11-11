// Drips: the stains (their coverage for a mask, no shape), the placement and head controls, and the editor's
// defaults. (The blisters are a layer of their own: blisters.test.ts.)
import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, getLayerDef, layerGroups, layerParamDefs } from '@/layers/registry';
import { maskWriteKind } from '@/layers/masks';

ensureBuiltins();
const def = (key: string) => layerParamDefs('drips').find((p) => p.key === key)!;

describe('drips mask and edge', () => {
	it('writes only its coverage to a mask (not into Shape), with an Edge card of just Anti-alias, crisp by default', () => {
		const stains = createLayer('drips').params;
		const drips = getLayerDef('drips');
		expect(maskWriteKind(drips, stains)).toBe(false);
		expect(maskWriteKind(drips, { ...stains, mk_target: 'Wet' })).toBe('coverage');
		expect(def('aa').default).toBe(false);
		expect(def('aa').showIf!(stains)).toBe(true);
		expect(def('bevel').showIf!(stains)).toBe(false);
		expect(layerGroups(getLayerDef('drips')!).map((g) => g.id)).not.toContain('shape');
	});

	it('has no blister controls or Output switch any more', () => {
		const keys = layerParamDefs('drips').map((p) => p.key);
		for (const k of ['output', 'blister', 'ragged', 'lift', 'depth', 'ledge_mix']) expect(keys).not.toContain(k);
		expect(createLayer('drips').params.h_on).toBe(false);
	});
});

describe('drips stains', () => {
	it('builds layers in code as scattered streaks with the full stain look ready for a switch to runnels', () => {
		const p = createLayer('drips').params;
		expect(p).toMatchObject({
			style: 'streak',
			density: 0.5,
			ledge_density: 0,
			ledge_start: 1,
			head_fade: 0,
			head_round: 0,
			soft: 0,
			streaks: 0.55,
			seep: 0.8,
			feather: 0.4,
			shape_var: 0.8,
			flow: 0.6,
			str_var: 0.45
		});
	});

	it('groups the ledge controls under Ledges, without the Ledge prefix on the test', () => {
		expect(getLayerDef('drips')!.groups).toEqual([{ id: 'relief', label: 'Ledges' }]);
		expect(['ledge', 'ledge_reach', 'ledge_soft'].map((k) => def(k).label)).toEqual(['Threshold', 'Reach', 'Softness']);
		expect(def('ledge_density').label).toBe('Ledge drips');
	});

	it('shows Ledge spacing and Start at only with Ledge drips', () => {
		for (const k of ['ledge_gap', 'ledge_start']) {
			expect(def(k).showIf!({ ledge_density: 0 })).toBe(false);
			expect(def(k).showIf!({ ledge_density: 0.3 })).toBe(true);
		}
	});

	it('starts editor layers as a detailed stain from 128 px, crisp pixel streaks below', () => {
		expect(freshParams('drips', { width: 512, height: 512 })).toMatchObject({
			style: 'runnels',
			aa: true,
			dif_blend: 'multiply'
		});
		expect(freshParams('drips', { width: 64, height: 64 })).toMatchObject({ style: 'streak', dif_blend: 'multiply' });
		expect(freshParams('drips', { width: 64, height: 64 }).aa).toBeUndefined();
	});

	it('fits the editor defaults in the ranges at every size up to 2048 px', () => {
		for (const width of [16, 64, 128, 512, 2048]) {
			const fresh = freshParams('drips', { width, height: width });
			for (const [k, v] of Object.entries(fresh)) {
				const d = def(k);
				if (typeof v !== 'number' || d.min === undefined) continue;
				expect(v, `${k} at ${width} px`).toBeGreaterThanOrEqual(d.min);
				expect(v, `${k} at ${width} px`).toBeLessThanOrEqual(d.max!);
				if (d.softMax !== undefined)
					expect(v, `${k} at ${width} px (slider)`).toBeLessThanOrEqual(width <= 512 ? d.softMax : d.max!);
			}
		}
	});

	it('hides the controls a style or switch does not use', () => {
		const runnels = { ...createLayer('drips').params, style: 'runnels', aa: true };
		expect(def('soft').showIf!(runnels)).toBe(true);
		expect(def('soft').showIf!({ ...runnels, aa: false })).toBe(false);
		expect(def('streak_w').showIf!({ ...runnels, streaks: 0 })).toBe(false);
		expect(def('streak_w').showIf!(runnels)).toBe(true);
		expect(def('fan').showIf!({ ...runnels, style: 'streak' })).toBe(false);
	});
});
