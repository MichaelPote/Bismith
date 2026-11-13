// Frost (FR8.31): new layers sized to the texture, the Wall / Floor shader variants and their linked snow, which
// params are lengths, and the shader's loops.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs, linkedChanges } from '@/layers/registry';
import { frostLayer } from '@/layers/generators/frost';
import { iceLayer } from '@/layers/generators/ice';

describe('frost', () => {
	ensureBuiltins();
	const def = (key: string) => layerParamDefs('frost').find((d) => d.key === key)!;

	it('sizes a new layer to the texture; at 512 px that is the plain default', () => {
		const big = freshParams('frost', { width: 512, height: 512 });
		for (const [k, v] of Object.entries(big)) expect(v, k).toBe(def(k).default);
		const huge = freshParams('frost', { width: 2048, height: 2048 });
		expect(Number(huge.snow_depth)).toBeCloseTo(4 * Number(big.snow_depth), 0);
		expect(Number(huge.ice_len)).toBeCloseTo(4 * Number(big.ice_len), 0);
		// Never under a pixel or so at 64 px.
		const small = freshParams('frost', { width: 64, height: 64 });
		expect(Number(small.rime_grain)).toBeGreaterThanOrEqual(1);
		expect(Number(small.snow_depth)).toBeGreaterThanOrEqual(3);
	});

	it('picks the Floor variant by its mode, and a Floor starts with less snow', () => {
		const p = createLayer('frost').params;
		expect(p.mode).toBe('wall');
		expect(frostLayer.shaderFeatures!(p)).toEqual([]);
		expect(frostLayer.shaderFeatures!({ ...p, mode: 'floor' })).toEqual(['FROST_FLOOR']);
		expect(def('mode').uniform).toBe(false);
		const toFloor = linkedChanges('frost', p, 'mode', 'floor');
		expect(Number(toFloor.snow)).toBeLessThan(Number(p.snow));
		// Wall-only controls hide on a Floor, and the other way round.
		const floor = { ...p, mode: 'floor' };
		for (const k of ['icicles', 'snow_depth', 'snow_cling', 'ledge']) expect(def(k).showIf!(floor), k).toBe(false);
		expect(def('ice').showIf!(p)).toBe(false);
		expect(def('ice').showIf!(floor)).toBe(true);
	});

	it('declares its lengths in px, the ones along one axis on it', () => {
		for (const k of [
			'rime_grain',
			'shelter_r',
			'snow_depth',
			'snow_height',
			'snow_cling',
			'pool_w',
			'ice_gap',
			'ice_len',
			'ice_w',
			'refraction'
		])
			expect(def(k).unit, k).toBe('px');
		for (const k of ['snow_depth', 'snow_cling', 'ice_len']) expect(def(k).axis, k).toBe('y');
		expect(def('ice_w').axis).toBe('x');
	});

	it('has no continue in its loops, and Ice no longer grows icicles', () => {
		expect(/\bcontinue\s*;/.test(frostLayer.glsl!)).toBe(false);
		const ice = iceLayer.params.map((d) => d.key);
		for (const k of ['icicles', 'icicles_on', 'sheet', 'ledge']) expect(ice, k).not.toContain(k);
		expect(iceLayer.prepare).toBeUndefined();
	});
});
