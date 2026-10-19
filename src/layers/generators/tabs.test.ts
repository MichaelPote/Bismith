// Tabs & notches: the CPU side — defaults, the editor's texture-sized defaults, the param table the shader reads.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs } from '../registry';
import { tabsLayer } from './tabs';

describe('tabs', () => {
	ensureBuiltins();

	it('starts along the shape mask, spread by spacing, cut in with a chamfer', () => {
		expect(createLayer('tabs').params).toMatchObject({
			place: 'shape',
			side: 'in',
			edges: 'all',
			distribute: 'spacing',
			spacing: 64,
			length: 20,
			depth: 6,
			clearance: 6,
			h_mode: 'subtract',
			bevel: 1.5,
			profile: 'linear',
			aa: true
		});
	});

	it('sizes a new layer to the texture (the plain defaults at 512)', () => {
		const at = (n: number) => freshParams('tabs', { width: n, height: n });
		expect(at(512)).toMatchObject({ spacing: 64, length: 20, depth: 6, clearance: 6, bevel: 1.5 });
		expect(at(2048)).toMatchObject({ spacing: 256, length: 80, depth: 24 });
		const defs = new Map(layerParamDefs('tabs').map((d) => [d.key, d]));
		for (const n of [16, 64, 512, 2048])
			for (const [k, v] of Object.entries(at(n))) {
				const d = defs.get(k)!;
				expect(d, k).toBeDefined();
				if (typeof v === 'number')
					expect(v >= (d.min ?? -Infinity) && v <= (d.max ?? Infinity), `${n}: ${k}`).toBe(true);
			}
	});

	it('uses every param it declares, marks pixel lengths, and keeps one call of each costly helper', () => {
		const glsl = tabsLayer.glsl!;
		for (const d of tabsLayer.params)
			if (d.key !== 'seed' && !d.key.endsWith('_sp'))
				expect(glsl.includes(`u_${d.key}`), `u_${d.key} unused`).toBe(true);
		for (const k of ['spacing', 'clearance', 'length', 'depth', 'thickness', 'inset'])
			expect(tabsLayer.params.find((d) => d.key === k)!.unit, k).toBe('px');
		// D3D inlines every call: one element evaluation per pixel loop, and no continue in shader loops.
		expect(glsl.match(/tb_shape\(/g)!.length).toBe(2);
		expect(/\bcontinue\s*;/.test(glsl)).toBe(false);
	});
});
