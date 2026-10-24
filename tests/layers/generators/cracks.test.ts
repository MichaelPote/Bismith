// Cracks (FR7.2a): the CPU side — old files load, editor defaults follow the texture size, and the params the shader
// relies on.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { normalizeProject } from '@/core/serialize';
import { createLayer, freshParams, layerParamDefs } from '@/layers/registry';
import { cracksLayer } from '@/layers/generators/organicCracks';

describe('cracks', () => {
	ensureBuiltins();

	it('loads an old sparse layer with the current behaviour (an unknown warp style falls back to Bend)', () => {
		const p = normalizeProject({
			layers: [{ type: 'cracks', params: { output: 'plates', scale: 5, width: 0.8, warp: 0.6, warp_mode: 'fold' } }]
		}).layers[0].params;
		expect(p).toMatchObject({
			scale: 5,
			width: 0.8,
			warp: 0.6,
			warp_mode: 'bend',
			mk_target: 'Shape',
			sub_connect: true,
			sub_shape: false
		});
		const fresh = createLayer('cracks', freshParams('cracks', { width: 512, height: 512 })).params;
		expect(fresh).toMatchObject({ warp_mode: 'bend', mk_target: 'Shape', sub_taper: 0.7, dome: 0.35, bevel: 2 });
		expect(normalizeProject({ layers: [{ type: 'cracks', params: fresh }] }).layers[0].params).toEqual(fresh);
	});

	it('sizes a new layer’s cracks to the texture', () => {
		const small = freshParams('cracks', { width: 64, height: 64 });
		const mid = freshParams('cracks', { width: 512, height: 512 });
		const big = freshParams('cracks', { width: 2048, height: 2048 });
		expect(mid).toMatchObject({ scale: 5, width: 2.5, sub_width: 1.25, zigzag: 0.6, bevel: 2 });
		expect(Number(big.width)).toBe(10);
		expect(Number(big.zigzag)).toBe(2.4);
		expect(small.scale).toBe(3);
		expect(Number(small.width)).toBe(1);
		expect(Number(small.sub)).toBeLessThan(Number(cracksLayer.params.find((d) => d.key === 'sub')!.default));
	});

	it('keeps the warp style order the shader reads (bend 0, squeeze 1)', () => {
		const d = layerParamDefs('cracks').find((x) => x.key === 'warp_mode')!;
		expect(d.options!.map((o) => o.value)).toEqual(['bend', 'squeeze']);
	});

	it('sizes px params', () => {
		for (const k of ['width', 'zigzag', 'jag', 'sub_width'])
			expect(cracksLayer.params.find((d) => d.key === k)!.unit, k).toBe('px');
	});
});
