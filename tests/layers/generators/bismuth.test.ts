// Bismuth: the CPU side — editor defaults sized to the texture, supersampling units.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams } from '@/layers/registry';
import { bismuthLayer } from '@/layers/generators/bismuth';

describe('bismuth', () => {
	ensureBuiltins();

	it('is registered and paints a metal and raises by default', () => {
		expect(createLayer('bismuth').params).toMatchObject({ dif_on: true, h_on: true, mt_on: true, mk_target: '' });
	});

	it('sizes a new layer’s terraces and height to the texture', () => {
		const small = freshParams('bismuth', { width: 64, height: 64 });
		const big = freshParams('bismuth', { width: 512, height: 512 });
		expect(Number(small.terrace)).toBeGreaterThanOrEqual(2);
		expect(Number(big.terrace)).toBeGreaterThan(Number(small.terrace));
		expect(Number(small.gens)).toBeLessThan(Number(big.gens));
		expect(Number(small.h_amount)).toBeLessThan(Number(big.h_amount));
	});

	it('scales its lengths with supersampling, not its counts', () => {
		const px = bismuthLayer.params.filter((d) => d.unit === 'px').map((d) => d.key);
		expect(px.sort()).toEqual(['soft', 'terrace']);
		expect(bismuthLayer.params.some((d) => d.perArea || d.perPx)).toBe(false);
	});
});
