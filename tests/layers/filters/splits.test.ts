// Splits: the shader's loops, the lengths' axes for resizing the canvas, and the sizes of a new layer.

import { describe, expect, it } from 'vitest';
import { splitsLayer } from '@/layers/filters/splits';
import { getLayerDef } from '@/layers/registry';
import { ensureBuiltins } from '@/render/builtins';

describe('splits', () => {
	it('is a filter in the registry', () => {
		ensureBuiltins();
		expect(getLayerDef('splits')?.kind).toBe('filter');
	});

	it('uses no continue in the shader (ANGLE / D3D11 can miscompile it)', () => {
		expect(/\bcontinue\s*;/.test(splitsLayer.filterGlsl!)).toBe(false);
	});

	it('measures widths and spacing across the grain and lengths along it', () => {
		const axis = (key: string, grain: string) => {
			const a = splitsLayer.params.find((d) => d.key === key)!.axis;
			return typeof a === 'function' ? a({ grain }) : a;
		};
		for (const k of ['width', 'spacing']) expect(axis(k, 'vertical'), k).toBe('x');
		expect(axis('length', 'vertical')).toBe('y');
		expect(axis('width', 'horizontal')).toBe('y');
		expect(axis('length', 'any')).toBeNull();
	});

	it('reads the mask it keeps inside, and none when that is cleared', () => {
		expect(splitsLayer.maskSource!({ mask: 'Shape' })).toBe('Shape');
		expect(splitsLayer.maskSource!({ mask: ' ' })).toBeNull();
	});

	it('sizes to the texture past 256 px and keeps the plain defaults up to it', () => {
		const def = (k: string) => splitsLayer.params.find((p) => p.key === k)!.default;
		const small = splitsLayer.fresh!({ width: 256, height: 256 });
		for (const [k, v] of Object.entries(small)) expect(v, k).toBe(def(k));
		const big = splitsLayer.fresh!({ width: 1024, height: 1024 });
		expect(big.length).toBe(4 * Number(def('length')));
		expect(big.width).toBe(2 * Number(def('width')));
	});
});
