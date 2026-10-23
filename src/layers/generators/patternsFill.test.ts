// Clouds, Gradient and Scratches (FR2.4): the CPU side — defaults, editor defaults sized to the texture, the clouds'
// measured coverage, the mask on scratches, and option orders the shaders rely on.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { supersampleFactor, scaleProject } from '@/core/supersample';
import { createProject } from '@/core/serialize';
import { createLayer, freshParams, layerGroups, layerParamDefs } from '../registry';
import { cloudsLayer, cloudsSamples, gradientLayer, scratchesLayer } from './patternsFill';

const tex = { width: 512, height: 512 };
const def = (type: string, key: string) => layerParamDefs(type).find((d) => d.key === key);

describe('fill patterns', () => {
	ensureBuiltins();

	it('defaults clouds to soft cumulus, and orders the styles as the shader numbers them', () => {
		expect(createLayer('clouds').params).toMatchObject({ style: 'cumulus', soft: 1, wdetail: 0.4 });
		expect(Number(createLayer('clouds').params.ridge)).toBeGreaterThan(0);
		// The shader numbers the styles 0 fbm, 1 billow, 2 ridged, 3 cumulus.
		expect(def('clouds', 'style')!.options!.map((o) => o.value)).toEqual(['fbm', 'billow', 'ridged', 'cumulus']);
	});

	it('measures this very texture’s value spread for Coverage', () => {
		const base = createLayer('clouds').params;
		const calib = cloudsLayer.cpuData!(base, { width: 64, height: 64, tileable: true, seed: 1 }).calib;
		expect(calib.width).toBe(17);
		// 17 quantiles, rising (16 bits in r, g).
		const q = Array.from({ length: 17 }, (_, k) => calib.data[k * 4] * 256 + calib.data[k * 4 + 1]);
		for (let k = 1; k < 17; k++) expect(q[k]).toBeGreaterThanOrEqual(q[k - 1]);
		// The shader ported: another seed, other values; the same, the same.
		const ctx = { width: 128, height: 128, tileable: true, seed: 11 };
		const a = cloudsSamples({ ...base, style: 'billow' }, ctx);
		expect(a).toHaveLength(4096);
		expect(cloudsSamples({ ...base, style: 'billow' }, ctx)).toEqual(a);
		expect(cloudsSamples({ ...base, style: 'billow' }, { ...ctx, seed: 12 })).not.toEqual(a);
		expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...a)).toBeLessThanOrEqual(1);
	});

	it('keeps the gradient’s options in shader order; odd angular sweeps start on one centre', () => {
		expect(createLayer('gradient').params).toMatchObject({ fit: true, wrap: 'wrap', band_jit: 0 });
		// An angular gradient with an odd count of ramps starts on a single centre (one sweep can't tile round it).
		expect(createLayer('gradient', { style: 'angular' }).params.wrap).toBe('single');
		expect(createLayer('gradient', { style: 'angular', turns: 16 }).params.wrap).toBe('wrap');
		// New layers round the creases between the copies of a centre by a share of the texture.
		expect(Number(freshParams('gradient', tex).seam)).toBeGreaterThan(
			Number(freshParams('gradient', { width: 64, height: 64 }).seam)
		);
		// The shader indexes the styles (0 linear … 4 square) and maps falloff to profileCurve(index + 1).
		expect(def('gradient', 'style')!.options!.map((o) => o.value)).toEqual([
			'linear',
			'radial',
			'angular',
			'diamond',
			'square'
		]);
		expect(def('gradient', 'falloff')!.options!.map((o) => o.value)).toEqual(['linear', 'smooth', 'round', 'cove']);
		expect(gradientLayer.glsl).toContain('profileCurve(u_falloff + 1, v)');
	});

	it('lets scratches write a mask, off by default', () => {
		expect(scratchesLayer.sdf).toBe('mask');
		const p = createLayer('scratches').params;
		// Adding scratches never replaces a Shape mask built above them; given a mask, they start in Normal mode.
		expect([p.mk_target, p.mk_op]).toEqual(['', 'replace']);
		expect(def('scratches', 'mk_target')?.group).toBe('mask');
		// A mask-only shape: the Edge card shapes the scratches' own value, its bevel off until asked for.
		expect(def('scratches', 'bevel')?.default).toBe(0);
		expect(def('scratches', 'aa')?.default).toBe(true);
		expect(layerGroups(scratchesLayer).some((g) => g.id === 'shape')).toBe(false);
	});

	it('sizes a new layer’s scratches to the texture', () => {
		const small = freshParams('scratches', { width: 128, height: 128 });
		const big = freshParams('scratches', { width: 1024, height: 1024 });
		expect(Number(big.len_max)).toBeCloseTo(8 * Number(small.len_max), 1);
		// Longer scratches, fewer of them per area; widths grow slower than lengths.
		expect(Number(big.density)).toBeLessThan(Number(small.density));
		expect(Number(big.thickness) / Number(small.thickness)).toBeLessThan(8);
		expect(Number(big.len_min)).toBeLessThan(Number(big.len_max));
	});

	it('scales the burr width and lengths with supersampling', () => {
		const p = createProject({
			width: 64,
			height: 64,
			layers: [createLayer('scratches', { burr: 0.5, burr_width: 2, len_max: 30 })]
		});
		p.render.supersample = 2;
		const q = scaleProject(p, supersampleFactor(p));
		expect(q.layers[0].params).toMatchObject({ burr_width: 4, len_max: 60 });
	});

	it('avoids `continue` in the scratch loop (D3D11 miscompiles it there)', () => {
		expect(scratchesLayer.glsl).not.toMatch(/\bcontinue\s*;/);
	});
});
