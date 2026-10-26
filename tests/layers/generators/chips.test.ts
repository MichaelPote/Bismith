// Chips & splits: the shader's loops, and the lengths' axes for resizing the canvas.

import { describe, expect, it } from 'vitest';
import { chipsLayer } from '@/layers/generators/chips';

describe('chips', () => {
	it('uses no continue in the shader (ANGLE / D3D11 can miscompile it)', () => {
		expect(/\bcontinue\s*;/.test(chipsLayer.glsl!)).toBe(false);
	});

	it('measures the splits’ widths across the grain and their lengths along it', () => {
		const axis = (key: string, grain: string) => {
			const a = chipsLayer.params.find((d) => d.key === key)!.axis;
			return typeof a === 'function' ? a({ grain }) : a;
		};
		for (const k of ['split_width', 'split_wobble', 'split_space', 'nick_len'])
			expect(axis(k, 'vertical'), k).toBe('x');
		for (const k of ['split_len', 'nick_width']) expect(axis(k, 'vertical'), k).toBe('y');
		expect(axis('split_width', 'horizontal')).toBe('y');
	});

	it('compiles Stone as a variant of its own, so Wood layers leave its code out', () => {
		expect(chipsLayer.shaderFeatures!({ material: 'stone' })).toEqual(['CH_STONE']);
		expect(chipsLayer.shaderFeatures!({ material: 'wood' })).toEqual([]);
		expect(chipsLayer.shaderFeatures!({})).toEqual([]);
	});

	it('shows each material its own controls', () => {
		const shown = (key: string, material: string) => {
			const d = chipsLayer.params.find((p) => p.key === key)!;
			const params = Object.fromEntries(chipsLayer.params.map((p) => [p.key, p.default]));
			return !d.showIf || d.showIf({ ...params, material });
		};
		for (const k of ['chips', 'corners', 'chip_size', 'splits', 'interior', 'grain', 'nicks'])
			expect([shown(k, 'wood'), shown(k, 'stone')], k).toEqual([true, false]);
		for (const k of [
			'stone_chips',
			'stone_size',
			'stone_depth',
			'flakes',
			'flake_size',
			'cracks',
			'crack_len',
			'faults'
		])
			expect([shown(k, 'wood'), shown(k, 'stone')], k).toEqual([false, true]);
	});

	it('sizes Stone to the texture past 256 px and keeps the plain defaults up to it', () => {
		const def = (k: string) => chipsLayer.params.find((p) => p.key === k)!.default;
		const small = chipsLayer.fresh!({ width: 256, height: 256 });
		for (const [k, v] of Object.entries(small)) expect(v, k).toBe(def(k));
		const big = chipsLayer.fresh!({ width: 1024, height: 1024 });
		expect(big.stone_size).toBe(4 * Number(def('stone_size')));
		expect(big.crack_width).toBe(2 * Number(def('crack_width')));
	});
});
