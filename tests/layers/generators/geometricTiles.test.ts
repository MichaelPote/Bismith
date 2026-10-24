// Tiles (FR7.2b): the CPU side — defaults (editor ones sized to the texture, linked ones following the tiling
// and the shift), the Tiles recipe's level tiles, and the param ranges the shader's fixed loop and clamps rely on.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import type { ParamValues } from '@/core/params';
import { createLayer, freshParams, layerParamDefs, linkedChanges } from '@/layers/registry';
import { TILE_MODES, tilesDerived, tilesLayer } from '@/layers/generators/geometricTiles';

describe('tiles', () => {
	ensureBuiltins();
	const glsl = tilesLayer.glsl!;
	const def = (key: string) => layerParamDefs('tiles').find((d) => d.key === key)!;

	it('sizes a new layer’s joints and bevel to the texture', () => {
		expect(freshParams('tiles', { width: 512, height: 512 })).toMatchObject({ gap: 2, bevel: 3, laid: 0.8 });
		expect(freshParams('tiles', { width: 2048, height: 2048 })).toMatchObject({ gap: 8, bevel: 12 });
		// Never below a pixel; a trim follows its short side.
		expect(freshParams('tiles', { width: 32, height: 32 })).toMatchObject({ gap: 1, bevel: 1, laid: 0.3 });
		expect(freshParams('tiles', { width: 1024, height: 128 })).toMatchObject({ gap: 1, bevel: 1 });
	});

	it('starts as solid, regular, raised blocks', () => {
		// Scale 7 on a square texture: 7 / √3 ≈ 4.04 rows, so with Keep tile shape the blocks come out regular.
		expect(createLayer('tiles').params).toMatchObject({
			mode: 'rhombille',
			scale: 7,
			fit: true,
			block_j: 0,
			crease: 0.25,
			block_iso: 0.5,
			bevel: 3,
			h_var: 0.3,
			tilt: 0.5,
			crown: 0.3,
			laid: 0,
			laid_turn: 0,
			size_var: 0,
			missing: 0,
			only: 'all',
			only_inv: false,
			kind_w: 1
		});
	});

	it('turns tiles as far as it shifts them until the turn is set by hand', () => {
		expect(createLayer('tiles', { laid: 2 }).params.laid_turn).toBe(2);
		expect(createLayer('tiles', freshParams('tiles', { width: 512, height: 512 })).params.laid_turn).toBe(0.8);
		const p = createLayer('tiles', { laid: 2 }).params;
		expect(linkedChanges('tiles', p, 'laid', 0).laid_turn).toBe(0);
		expect(linkedChanges('tiles', { ...p, laid_turn: 5 }, 'laid', 0).laid_turn).toBeUndefined();
	});

	it('weighs the tile kind by tiling until Kind contrast is set by hand', () => {
		// Kinds that make the motif keep their tones; checker squares are per tile, H / V bricks lean slightly by kind.
		expect(createLayer('tiles', { mode: 'octagon' }).params.kind_w).toBe(0.8);
		expect(createLayer('tiles', { mode: 'squares' }).params.kind_w).toBe(0);
		const blocks = createLayer('tiles').params;
		expect(linkedChanges('tiles', blocks, 'mode', 'herringbone').kind_w).toBe(0.35);
		expect(linkedChanges('tiles', { ...blocks, kind_w: 0.5 }, 'mode', 'herringbone').kind_w).toBeUndefined();
		for (const o of def('mode').options!)
			expect(tilesLayer.linkedDefaults!({ mode: o.value }).kind_w, o.value).toBeTypeOf('number');
	});

	it('has no continue in its shader (ANGLE / D3D11 has miscompiled it in loops)', () => {
		expect(/\bcontinue\s*;/.test(glsl)).toBe(false);
	});

	it('fits the longest herringbone in the shader’s loop, and clamps the ratio where the param ends', () => {
		const max = def('ratio').max!;
		expect(Number(/clamp\(u_ratio, 1, (\d+)\)/.exec(glsl)![1])).toBe(max);
		const bound = Number(/it < (\d+) \* UNI_1/.exec(glsl)![1]);
		// Two shapes (horizontal, vertical brick) of 3 × (n / 2 + 4) anchors, one step per shape change and the last check.
		const steps = 2 * 3 * (Math.floor(max / 2) + 4) + 3;
		expect(steps).toBeLessThanOrEqual(bound);
	});

	it('offers a kind filter for every kind a tiling has (plus: five)', () => {
		expect(def('only').options!.map((o) => o.value)).toEqual(['all', '1', '2', '3', '4', '5']);
	});

	it('paints tiles by their random and tones by their value, switching back', () => {
		expect(createLayer('tiles').params.dif_src).toBe('random');
		const tones = createLayer('tiles', { mode: 'squares', output: 'value' }).params;
		expect(tones).toMatchObject({ dif_src: 'value', soft: 1.5, vary: 0.3, joint_tone: 1 });
		expect(linkedChanges('tiles', tones, 'output', 'tiles').dif_src).toBe('random');
	});

	it('has a shape only as tiles: tones keep Anti-alias but not the Bevel or a shape to write', () => {
		expect(tilesLayer.sdfShowIf!({ output: 'tiles' })).toBe(true);
		expect(tilesLayer.sdfShowIf!({ output: 'value' })).toBe(false);
		expect(tilesLayer.sdfShowIf!({ output: 'value' }, 'aa')).toBe(true);
		expect(tilesLayer.sdfShowIf!({ output: 'value' }, 'bevel')).toBe(false);
	});

	it('builds every tiling’s shapes from its packed table (shapes in order, within the polygon capacity)', () => {
		const table = /const \w+ (\w+)\[(\d+)\] = \w+\[\d+\]\(([^;]*)\);/g;
		const arrays = new Map([...glsl.matchAll(table)].map((m) => [m[1], { n: Number(m[2]), body: m[3] }]));
		const head = [...arrays.get('TILE_SHAPE')!.body.matchAll(/ivec3\((\d+), (\d+), ([01])\)/g)].map((m) =>
			m.slice(1).map(Number)
		);
		const first = arrays.get('TILE_MODE0')!.body.split(',').map(Number);
		expect(first.length).toBe(def('mode').options!.length);
		const capacity = Number(/#define GEO_NV (\d+)/.exec(glsl)![1]);
		let next = 0;
		for (const [start, count] of head) {
			expect(start).toBe(next);
			expect(count).toBeGreaterThanOrEqual(3);
			expect(count).toBeLessThanOrEqual(capacity);
			next += count;
		}
		expect(arrays.get('TILE_V')!.n).toBe(next);
		// Shapes per tiling (in the shader's loop): squares 2 (whole, quarter), diamonds 1, rhombille 3 faces + the whole block, herringbone,
		// basketweave 2, crosses 1, plus 1, octagon 2, triangles 2, hopscotch 2, pinwheel 5, Cairo 4.
		const per = first.map((f, i) => (first[i + 1] ?? head.length) - f);
		expect(per).toEqual([2, 1, 4, 2, 2, 1, 1, 2, 2, 2, 5, 4]);
	});

	it('offers split squares on the squares tiling, their band controls only for band rules', () => {
		const show = (key: string, p: ParamValues) => def(key).showIf!(p);
		expect(createLayer('tiles').params.split).toBe(0);
		expect(show('split', { mode: 'squares' })).toBe(true);
		expect(show('split', { mode: 'rhombille' })).toBe(false);
		expect(show('split_rule', { mode: 'squares', split: 0 })).toBe(false);
		expect(show('split_rule', { mode: 'squares', split: 1 })).toBe(true);
		expect(show('split_every', { mode: 'squares', split: 1, split_rule: 'any' })).toBe(false);
		expect(show('split_every', { mode: 'squares', split: 1, split_rule: 'crossings' })).toBe(true);
		expect(show('split_x', { mode: 'squares', split: 1, split_rule: 'rows' })).toBe(false);
		expect(show('split_y', { mode: 'squares', split: 1, split_rule: 'columns' })).toBe(false);
		expect(def('split_rule').options!.map((o) => o.value)).toEqual(['any', 'columns', 'rows', 'crossings']);
		expect(def('split_kinds').options!.map((o) => o.value)).toEqual(['both', 'size']);
	});

	it("keeps the split rule's option order the shader reads (any 0, columns 1, rows 2, crossings 3)", () => {
		expect(glsl).toContain(
			'(u_split_rule == 1 && col) || (u_split_rule == 2 && row) || (u_split_rule == 3 && col && row)'
		);
	});

	it('fits whole periods that keep the tile shape, at any size and rotation (on the CPU)', () => {
		const base = createLayer('tiles').params;
		for (const [width, height] of [
			[64, 64],
			[96, 96],
			[512, 512],
			[97, 61],
			[300, 200],
			[1, 1]
		])
			for (const [mode] of TILE_MODES)
				for (const orient of ['0', '45', '90', '135']) {
					const at = `${mode} ${orient} ${width}×${height}`;
					const c = { width, height, tileable: true, seed: 0 };
					const { U, k } = tilesDerived({ ...base, mode, orient }, c);
					expect(U[0] >= 1 && U[1] >= 1, at).toBe(true);
					for (const x of k) expect(Number.isInteger(x) && x >= 1, at).toBe(true);
					// Off: exactly Scale across (rounded), the rows rounded.
					const off = tilesDerived({ ...base, mode, orient, fit: false }, c).k;
					expect(
						off.every((x) => Number.isInteger(x) && x >= 1),
						at
					).toBe(true);
				}
		// Squares at 512 px, Aspect 1.3: Keep tile shape moves the count across so whole rows keep the shape (within 3 %);
		// a checkerboard keeps even counts.
		const c = { width: 512, height: 512, tileable: true, seed: 0 };
		const sq = { ...base, mode: 'squares', scale: 7, aspect: 1.3, rnd_mode: 'class' };
		const [kx, ky] = tilesDerived(sq, c).k;
		expect(kx % 2 === 0 && ky % 2 === 0).toBe(true);
		expect(Math.abs(kx / ky / 1.3 - 1)).toBeLessThan(0.03);
		// Untiled: Scale across exactly.
		expect(tilesDerived(sq, { ...c, tileable: false }).k[0]).toBeCloseTo(7, 6);
	});
});
