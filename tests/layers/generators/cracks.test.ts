// Cracks (type chips): the shader's loops, its controls and its sizes.

import { describe, expect, it } from 'vitest';
import { cracksLayer } from '@/layers/generators/cracks';

describe('cracks', () => {
	it('uses no continue in the shader (ANGLE / D3D11 can miscompile it)', () => {
		expect(/\bcontinue\s*;/.test(cracksLayer.glsl!)).toBe(false);
	});

	it('is stone damage only: the wood splits moved to the Splits filter', () => {
		const keys = cracksLayer.params.map((p) => p.key);
		for (const k of ['material', 'chips', 'corners', 'splits', 'interior', 'grain', 'nicks', 'merge'])
			expect(keys, k).not.toContain(k);
		expect(cracksLayer.shaderFeatures).toBeUndefined();
		expect(cracksLayer.glsl).not.toContain('CH_STONE');
	});

	it('sizes to the texture past 256 px and keeps the plain defaults up to it', () => {
		const def = (k: string) => cracksLayer.params.find((p) => p.key === k)!.default;
		const small = cracksLayer.fresh!({ width: 256, height: 256 });
		for (const [k, v] of Object.entries(small)) expect(v, k).toBe(def(k));
		const big = cracksLayer.fresh!({ width: 1024, height: 1024 });
		expect(big.stone_size).toBe(4 * Number(def('stone_size')));
		expect(big.crack_width).toBe(2 * Number(def('crack_width')));
	});
});
