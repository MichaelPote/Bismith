// Hammered (FR7.7): the CPU side — the courses sized to the texture, the mask opt-in, and every param reaching the
// shader.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs } from '../registry';
import { maskWriteKind } from '../masks';
import { hammeredLayer } from './hammered';

describe('hammered', () => {
	ensureBuiltins();
	const def = (key: string) => layerParamDefs('hammered').find((d) => d.key === key)!;

	it('sizes a new layer’s courses to the texture; at 512 px that is the plain default', () => {
		const big = freshParams('hammered', { width: 512, height: 512 });
		const huge = freshParams('hammered', { width: 2048, height: 2048 });
		const small = freshParams('hammered', { width: 64, height: 64 });
		const tiny = freshParams('hammered', { width: 16, height: 16 });
		for (const [k, v] of Object.entries(big)) expect(v, k).toBe(def(k).default);
		expect(Number(huge.ring)).toBeCloseTo(4 * Number(big.ring), 0);
		// Dents closer along a course than the courses are apart, so the courses read.
		expect(Number(big.spacing)).toBeLessThan(Number(big.ring));
		// Small textures: fewer, larger dents (5 courses across at 64 px), fewer centres, deeper relief; never under 3 px …
		expect(Number(small.ring)).toBeCloseTo(12.8, 1);
		expect(Number(small.centres)).toBeLessThan(Number(big.centres));
		expect(Number(small.h_amount)).toBeGreaterThan(Number(big.h_amount));
		expect(Number(tiny.ring)).toBeGreaterThanOrEqual(3);
		// … and sharper creases with flatter, steeper dents, so each keeps a lit and a dark edge.
		expect(Number(small.crease)).toBeLessThan(Number(big.crease));
		expect(Number(small.shape)).toBeGreaterThan(Number(big.shape));
	});

	it('writes a mask only when asked, and shows the mask size then', () => {
		expect(maskWriteKind(hammeredLayer, createLayer('hammered').params)).toBe(false);
		expect(maskWriteKind(hammeredLayer, { ...createLayer('hammered').params, mk_target: 'Shape' })).toBe('shape');
		const show = def('mask_r').showIf!;
		expect(show({ mk_target: '' })).toBe(false);
		expect(show({ mk_target: 'Shape' })).toBe(true);
		expect(show({ mk_target: 'Dents' })).toBe(true);
	});

	it('declares px lengths for supersampling, and no continue in the shader', () => {
		for (const k of ['ring', 'spacing']) expect(def(k).unit, k).toBe('px');
		// A share of the spacing: no unit (supersampling scales the spacing).
		expect(def('jitter').unit).toBeUndefined();
		// The shader loops must not use continue (ANGLE / D3D11 can miscompile it).
		expect(/\bcontinue\s*;/.test(hammeredLayer.glsl!)).toBe(false);
	});
});
