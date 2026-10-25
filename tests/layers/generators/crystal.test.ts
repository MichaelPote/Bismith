// Crystal: the CPU side — defaults, editor defaults sized to the texture, supersampling units.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams } from '@/layers/registry';
import { crystalLayer } from '@/layers/generators/crystal';

describe('crystal', () => {
	ensureBuiltins();

	it('is registered and paints and raises by default', () => {
		expect(createLayer('crystal').params).toMatchObject({ dif_on: true, h_on: true, mk_target: '' });
	});

	it('sizes a new layer’s edges, layers and height to the texture', () => {
		const small = freshParams('crystal', { width: 64, height: 64 });
		const big = freshParams('crystal', { width: 512, height: 512 });
		expect(Number(small.edge_w)).toBeGreaterThanOrEqual(0.75);
		expect(Number(small.layers)).toBeLessThan(Number(big.layers));
		expect(Number(small.h_amount)).toBeLessThan(Number(big.h_amount));
	});

	it('scales its lengths with supersampling, not its counts', () => {
		const px = crystalLayer.params.filter((d) => d.unit === 'px').map((d) => d.key);
		expect(px.sort()).toEqual(['edge_w', 'gap', 'vfill']);
		expect(crystalLayer.params.some((d) => d.perArea || d.perPx)).toBe(false);
	});
});
