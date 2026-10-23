// Chips & splits: the shader's loops, and the lengths' axes for resizing the canvas.

import { describe, expect, it } from 'vitest';
import { chipsLayer } from './chips';

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
});
