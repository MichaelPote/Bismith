// Tabs & notches: the CPU side — defaults, the editor's texture-sized defaults, the param table the shader reads, and
// how many fit along a side (the shared Repeat places them: tests/layers/outline.test.ts).

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs } from '@/layers/registry';
import { tabClearance, tabsLayer } from '@/layers/generators/tabs';
import { canvasOutline, placeInstances } from '@/layers/outline';

describe('tabs', () => {
	ensureBuiltins();

	it('starts along the sides of the shape mask, spread by spacing clear of the corners, cut in with a chamfer', () => {
		const p = createLayer('tabs').params;
		expect(p).toMatchObject({
			rep_place: 'mask',
			rep_mask: 'Shape',
			rep_along: 'side',
			rep_corners: 'clear',
			rep_count_by: 'spacing',
			rep_space: 64,
			rep_clear: 6,
			rep_faces: 'all',
			side: 'in',
			length: 20,
			depth: 6,
			h_mode: 'subtract',
			bevel: 1.5,
			profile: 'linear',
			aa: true
		});
		// The shared Repeat's outline side: the mask it follows, and the shader variant.
		expect(tabsLayer.maskSource!(p)).toBe('Shape');
		expect(tabsLayer.shaderFeatures!(p)).toContain('MASK_REPEAT');
		expect(tabsLayer.shaderFeatures!({ ...p, rep_place: 'grid' })).not.toContain('MASK_REPEAT');
	});

	it('sizes a new layer to the texture (the plain defaults at 512)', () => {
		const at = (n: number) => freshParams('tabs', { width: n, height: n });
		expect(at(512)).toMatchObject({ rep_space: 64, length: 20, depth: 6, rep_clear: 6, bevel: 1.5 });
		expect(at(2048)).toMatchObject({ rep_space: 256, length: 80, depth: 24 });
		const defs = new Map(layerParamDefs('tabs').map((d) => [d.key, d]));
		for (const n of [16, 64, 512, 2048])
			for (const [k, v] of Object.entries(at(n))) {
				const d = defs.get(k)!;
				expect(d, k).toBeDefined();
				if (typeof v === 'number')
					expect(v >= (d.min ?? -Infinity) && v <= (d.max ?? Infinity), `${n}: ${k}`).toBe(true);
			}
	});

	it('marks pixel lengths, and keeps one call of each costly helper', () => {
		const glsl = tabsLayer.glsl!;
		const defs = layerParamDefs('tabs');
		for (const k of ['rep_space', 'rep_clear', 'length', 'depth', 'thickness', 'inset'])
			expect(defs.find((d) => d.key === k)!.unit, k).toBe('px');
		// D3D inlines every call: one element evaluation per pixel loop, and no continue in shader loops.
		expect(glsl.match(/tb_shape\(/g)!.length).toBe(2);
		expect(/\bcontinue\s*;/.test(glsl)).toBe(false);
	});

	it('keeps clear of the corners by what its shape needs, and fits as many as its Length allows', () => {
		const p = createLayer('tabs').params;
		// A 45° trapezoid clears a right-angled corner on its own; a square-sided one needs its depth; outward, nothing.
		expect(tabClearance({ ...p, shape: 'trapezoid', cut: 1 })).toBeCloseTo(0);
		expect(tabClearance({ ...p, shape: 'trapezoid', cut: 0, depth: 6 })).toBeCloseTo(6);
		expect(tabClearance({ ...p, shape: 'trapezoid', cut: 0, side: 'out' })).toBe(0);
		// Along a 100 px square's sides: 20 px tabs with 6 px clearance fit 3 a side (100 / 32); by spacing 64, 2.
		const sq = canvasOutline(100, 100, 0);
		const opts = (o: object) => ({
			along: 'side' as const,
			countBy: 'spacing' as const,
			n: 3,
			spacing: 64,
			corners: 'clear' as const,
			clear: 6,
			angle: 30,
			round: 16,
			offset: 0,
			shift: 0,
			faces: 0,
			max: 4096,
			fit: (len: number) => Math.floor(len / (20 + 2 * (6 + tabClearance(p)))),
			...o
		});
		expect(placeInstances(sq, opts({}))).toHaveLength(8);
		expect(placeInstances(sq, opts({ countBy: 'repeats', n: 5 }))).toHaveLength(12);
	});
});
