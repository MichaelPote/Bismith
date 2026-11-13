// Snow (FR8.31): new layers sized to the texture, the Wall / Floor shader variants and their linked snow, which
// params are lengths, and the shader's loops.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs, linkedChanges } from '@/layers/registry';
import { snowLayer } from '@/layers/generators/snow';
import { iceLayer } from '@/layers/generators/ice';

describe('snow', () => {
	ensureBuiltins();
	const def = (key: string) => layerParamDefs('snow').find((d) => d.key === key)!;

	it('sizes a new layer to the texture; at 512 px that is the plain default', () => {
		const big = freshParams('snow', { width: 512, height: 512 });
		for (const [k, v] of Object.entries(big)) expect(v, k).toBe(def(k).default);
		const huge = freshParams('snow', { width: 2048, height: 2048 });
		expect(Number(huge.snow_depth)).toBeCloseTo(4 * Number(big.snow_depth), 0);
		expect(Number(huge.ice_len)).toBeCloseTo(4 * Number(big.ice_len), 0);
		// Never under a pixel or so at 64 px.
		const small = freshParams('snow', { width: 64, height: 64 });
		expect(Number(small.rg_scale)).toBeCloseTo(170 / 8, 0);
		expect(Number(small.snow_depth)).toBeGreaterThanOrEqual(3);
	});

	it('picks the Floor variant by its mode, and a Floor starts with less snow', () => {
		const p = createLayer('snow').params;
		expect(p.mode).toBe('wall');
		expect(snowLayer.shaderFeatures!(p)).toEqual([]);
		expect(snowLayer.shaderFeatures!({ ...p, mode: 'floor' })).toEqual(['SNOW_FLOOR']);
		expect(def('mode').uniform).toBe(false);
		const toFloor = linkedChanges('snow', p, 'mode', 'floor');
		expect(Number(toFloor.snow)).toBeLessThan(Number(p.snow));
		// Wall-only controls hide on a Floor, and the other way round.
		const floor = { ...p, mode: 'floor' };
		for (const k of ['icicles', 'snow_depth', 'snow_cling', 'ledge']) expect(def(k).showIf!(floor), k).toBe(false);
		expect(def('ice').showIf!(p)).toBe(false);
		expect(def('ice').showIf!(floor)).toBe(true);
	});

	it('declares its lengths in px, the ones along one axis on it', () => {
		for (const k of [
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
		expect(/\bcontinue\s*;/.test(snowLayer.glsl!)).toBe(false);
		const ice = iceLayer.params.map((d) => d.key);
		for (const k of ['icicles', 'icicles_on', 'sheet', 'ledge']) expect(ice, k).not.toContain(k);
		expect(iceLayer.prepare).toBeUndefined();
	});

	it('takes its highlights from the lighting: no Light from on Snow or Ice', () => {
		for (const l of [snowLayer, iceLayer]) {
			const keys = l.params.map((d) => d.key);
			expect(keys, l.type).not.toContain('light');
			expect(l.glsl, l.type).not.toMatch(/\bu_light\b/);
		}
		expect(snowLayer.params.map((d) => d.key)).not.toContain('glint');
	});

	it('grains its rime with Noise’s controls, band-limited', () => {
		expect(def('rg_noise').default).toBe('value');
		expect(def('rg_noise').options!.map((o) => o.value)).not.toContain('white');
		expect(def('rg_octaves').section).toBe('Rime grain');
		expect(snowLayer.glsl).toMatch(/if \(true\) n = mix\(0\.5, n/);
		expect(snowLayer.textures).toContain('calib');
		// Hidden with no rime and no snow.
		const p = createLayer('snow').params;
		expect(def('rg_scale').showIf!({ ...p, rime: 0, snow: 0 })).toBe(false);
	});

	it('varies the icicles’ widths, and sets their height in the relief: from the root, maxed', () => {
		expect(def('ice_w_var').section).toBe('Icicles');
		expect(snowLayer.glsl).toMatch(/u_ice_w \* \(1\.0 - u_ice_w_var \* h\.y\)/);
		expect(snowLayer.glsl).toMatch(/iH = max\(top - h0, 0\.0\) \* iC/);
	});

	it('gives Ice a ripples phase that moves the ripples alone', () => {
		const d = iceLayer.params.find((x) => x.key === 'ripple_phase')!;
		expect(d.default).toBe(0);
		expect(iceLayer.glsl).toMatch(/gPhase = jn == 2 \? ph0 \+ u_ripple_phase : ph0/);
	});
});
