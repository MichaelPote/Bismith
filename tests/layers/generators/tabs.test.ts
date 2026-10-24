// Tabs & notches: the CPU side — defaults, the editor's texture-sized defaults, the param table the shader reads.

import { describe, expect, it } from 'vitest';
import type { FilterContext } from '@/render/materialPipeline';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs } from '@/layers/registry';
import { tabsLayer } from '@/layers/generators/tabs';

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

	it('marks pixel lengths, and keeps one call of each costly helper', () => {
		const glsl = tabsLayer.glsl!;
		for (const k of ['spacing', 'clearance', 'length', 'depth', 'thickness', 'inset'])
			expect(tabsLayer.params.find((d) => d.key === k)!.unit, k).toBe('px');
		// D3D inlines every call: one element evaluation per pixel loop, and no continue in shader loops.
		expect(glsl.match(/tb_shape\(/g)!.length).toBe(2);
		expect(/\bcontinue\s*;/.test(glsl)).toBe(false);
		// Along the mask: one edge test in the pixel's refine (the definition, then its call), and no long walks.
		expect(glsl.match(/\btb_on\(/g)!.length).toBe(2);
		for (const m of glsl.matchAll(/< (\d+) \* UNI_1/g)) expect(Number(m[1]), m[0]).toBeLessThanOrEqual(48);
	});

	it('finds the sides along the mask in log₂(size) passes before the layer, and only along the mask', () => {
		const runs: string[] = [];
		const bodies: string[] = [];
		const ctx = {
			width: 512,
			height: 256,
			scratch: (name: string) => ({ texture: { name } }),
			sharedMaterial: (key: string, body: string, extra = {}) => {
				bodies.push(body);
				return { key, uniforms: extra };
			},
			run: (mat: { key: string }) => runs.push(mat.key)
		} as unknown as FilterContext;
		const layer = (place: string) => ({ ...createLayer('tabs'), params: { ...createLayer('tabs').params, place } });
		expect(tabsLayer.prepare!(ctx, layer('grid'))).toEqual({});
		expect(runs).toEqual([]);
		const tex = tabsLayer.prepare!(ctx, layer('shape'));
		expect(Object.keys(tex).sort()).toEqual([...tabsLayer.textures!].sort());
		// The edge texels, then enough doubling passes for a run once round the tile's width plus height.
		expect(runs).toEqual(['tabs:foot', ...Array(Math.ceil(Math.log2(512 + 256 + 1)) + 2).fill('tabs:run')]);
		for (const b of bodies) expect(/\bcontinue\s*;/.test(b)).toBe(false);
	});
});
