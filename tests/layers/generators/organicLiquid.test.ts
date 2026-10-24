// Marble and caustics: the plain defaults are the current look (ridged marble, rounded nested caustics), the editor's
// sized params stay in range, and caustics' height mode follows its mode. Marble's derived uniforms tile.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, getLayerDef, layerParamDefs } from '@/layers/registry';
import type { ParamValues } from '@/core/params';
import type { LayerCanvas } from '@/layers/types';
import { marbleDerived, marbleLayer } from '@/layers/generators/organicLiquid';

describe('marble / caustics params', () => {
	ensureBuiltins();

	it('defaults to the current look', () => {
		expect(createLayer('marble').params).toMatchObject({
			style: 'ridges',
			stretch: 6,
			cull: 0.7,
			filter: true,
			fine_style: 'same',
			relief: 0.12,
			h_mode: 'subtract'
		});
		expect(createLayer('caustics').params).toMatchObject({
			dome: 0.8,
			cell_h: 0.4,
			rim_round: 1,
			octave2_nest: 1,
			mk_target: ''
		});
	});

	it('keeps the editor’s fresh params known and within their ranges at any texture size', () => {
		for (const type of ['marble', 'caustics']) {
			const defs = new Map(layerParamDefs(type).map((d) => [d.key, d]));
			for (const width of [16, 64, 512, 2048]) {
				for (const [k, v] of Object.entries(freshParams(type, { width, height: width }))) {
					const d = defs.get(k);
					expect(d, `${type}.${k}`).toBeTruthy();
					if (typeof v === 'number') {
						expect(v, `${type}.${k} at ${width}`).toBeGreaterThanOrEqual(d!.min ?? -Infinity);
						expect(v, `${type}.${k} at ${width}`).toBeLessThanOrEqual(d!.max ?? Infinity);
					}
				}
			}
		}
	});

	it('raises caustics blobs and sinks the net unless a height mode is given', () => {
		expect(createLayer('caustics').params.h_mode).toBe('subtract');
		expect(createLayer('caustics', { mode: 'blobs' }).params.h_mode).toBe('add');
		expect(createLayer('caustics', { mode: 'blobs', h_mode: 'max' }).params.h_mode).toBe('max');
	});

	it('fits marble’s wave vectors and turbulence lattices to the tile on the CPU', () => {
		const canvas = (width: number, height: number, tileable = true): LayerCanvas => ({
			width,
			height,
			tileable,
			seed: 0
		});
		for (const c of [canvas(96, 96), canvas(96, 64), canvas(97, 61), canvas(192, 64)])
			for (const style of ['streaks', 'ridges', 'network'])
				for (const [veins, angle] of [
					[2.5, 30],
					[7.3, 90],
					[0.4, 44.9],
					[12, -63]
				]) {
					const d = marbleDerived(createLayer('marble', { style, veins, angle, fine_style: 'streaks' }).params, c);
					const at = `${style} ${veins}/${angle}° ${c.width}×${c.height}`;
					// Whole cycles per texture, never none, and the distinct bands of each.
					for (const s of [0, 1]) {
						const cyc = [d.k[2 * s] * c.width, d.k[2 * s + 1] * c.height].map(Math.round);
						expect(Math.abs(d.k[2 * s] * c.width - cyc[0]), at).toBeLessThan(1e-3);
						expect(Math.abs(d.k[2 * s + 1] * c.height - cyc[1]), at).toBeLessThan(1e-3);
						expect(cyc[0] !== 0 || cyc[1] !== 0, at).toBe(true);
						expect(
							cyc.every((x) => x % d.g[s] === 0),
							at
						).toBe(true);
					}
					// Each lattice integer, its period lattice where the texture's repeats land (T's rows), not degenerate.
					for (let s = 0; s < 3; s++) {
						const T = d.T.slice(4 * s, 4 * s + 4);
						expect(T.every(Number.isInteger), at).toBe(true);
						expect(d.B.slice(4 * s, 4 * s + 4), at).toEqual([T[0], T[2], T[1], T[3]]);
						expect(T[0] * T[3] - T[1] * T[2], at).not.toBe(0);
					}
					expect(
						[...d.nc, ...d.wc, ...d.pc, d.bt[0], d.bt[1]].every((x) => Number.isInteger(x) && x >= 1),
						at
					).toBe(true);
				}
		// Untiled: unsnapped, the stretched lattice turned to the angle (along the veins and across them).
		const d = marbleDerived(
			createLayer('marble', { style: 'streaks', angle: 30, veins: 2.5 }).params,
			canvas(96, 64, false)
		);
		expect(d.k[0] * 96).toBeCloseTo(1.25, 5);
		expect(d.k[1] * 96).toBeCloseTo(2.5 * Math.cos(Math.PI / 6), 5);
		expect(d.T[0] * d.k[0] + (d.T[1] * d.k[1] * 96) / 64).toBeCloseTo(0, 4);
	});

	it('works marble’s wave vectors out per pixel only under Tiles’ vein turn', () => {
		const feats = (p: ParamValues) => marbleLayer.shaderFeatures!(createLayer('marble', p).params);
		expect(feats({})).toEqual([]);
		expect(feats({ tiles: 3 })).toEqual(['MB_TILE_ROT']);
		expect(feats({ tiles: 3, tile_rot: 0 })).toEqual([]);
		expect(feats({ tiles: 3, style: 'network', fine: 0 })).toEqual([]);
		expect(feats({ tiles: 3, style: 'network', fine_style: 'ridges' })).toEqual(['MB_TILE_ROT']);
		// The usual shader has none of that work: it reads the derived uniforms.
		const glsl = getLayerDef('marble')!.glsl!.replace(/#ifdef MB_TILE_ROT[\s\S]*?#(else|endif)/g, '');
		expect(glsl).not.toMatch(/igcd\(|mb_waveK\(|mb_turbDir\(|mb_turbFrame\(|cellsFor\(/);
		expect(glsl).toMatch(/d_T\[sys\]/);
	});
});
