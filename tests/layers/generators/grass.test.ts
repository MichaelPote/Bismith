// Grass (FR8.21): the CPU side — editor defaults sized to the texture, supersampling units and param ranges.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams } from '@/layers/registry';
import { grassLayer } from '@/layers/generators/grass';

describe('grass', () => {
	ensureBuiltins();

	it('is registered and paints and raises by default', () => {
		expect(createLayer('grass').params).toMatchObject({ dif_on: true, h_on: true });
	});

	it('sizes a new layer’s blades to the texture', () => {
		const small = freshParams('grass', { width: 64, height: 64 });
		const big = freshParams('grass', { width: 512, height: 512 });
		expect(small.length).toBe(5);
		expect(big.length).toBe(43);
		expect(Number(big.width)).toBeGreaterThan(Number(small.width));
		expect(Number(small.width)).toBeGreaterThanOrEqual(1);
	});

	it('scales its lengths with supersampling, not its density', () => {
		const px = grassLayer.params.filter((d) => d.unit === 'px').map((d) => d.key);
		expect(px.sort()).toEqual(['length', 'shadow_w', 'width']);
		// Density is relative to the blade size, so it stays put when the lengths scale.
		expect(grassLayer.params.find((d) => d.key === 'density')!.perArea).toBeFalsy();
	});
});
