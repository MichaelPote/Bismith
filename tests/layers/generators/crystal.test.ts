// Crystal: the CPU side — defaults, editor defaults sized to the texture, supersampling units.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, getLayerDef } from '@/layers/registry';
import { maskWriteKind } from '@/layers/masks';
import { SHAPE_MASK } from '@/core/project';
import { crystalLayer } from '@/layers/generators/crystal';

describe('crystal', () => {
	ensureBuiltins();

	it('is registered, paints and raises, and writes its crystals to the Shape mask by default', () => {
		expect(createLayer('crystal').params).toMatchObject({
			dif_on: true,
			h_on: true,
			mk_target: SHAPE_MASK,
			mask_feat: 'crystals'
		});
		expect(maskWriteKind(getLayerDef('crystal')!, createLayer('crystal').params)).toBe('shape');
	});

	it('can leave out its first layer and stack its layers, as large as the first', () => {
		const d = (k: string) => crystalLayer.params.find((p) => p.key === k)!;
		expect(d('skip_first').default).toBe(false);
		expect(d('layer_mode').options!.map((o) => o.value)).toEqual(['max', 'add']);
		expect(Number(d('layer_scale').min)).toBeLessThan(1);
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
