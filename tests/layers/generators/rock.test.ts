// Rock: the CPU side — the sheared frame that keeps any cleavage angle seamless, its mask sources, and the editor
// defaults sized to the texture.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, getLayerDef, maskSourcesOf } from '@/layers/registry';
import { layerWrites } from '@/layers/masks';
import { imod } from '@/layers/derivedMath';
import { rockDerived } from '@/layers/generators/rock';

/** The shader's rv_key: a cell's seamless key, its rows leaning by m cells over the tile's width. */
function key(c: [number, number], nx: number, ny: number, m: number): string {
	const I = Math.floor(c[0] / nx);
	return `${c[0] - I * nx},${imod(c[1] + I * m, ny)}`;
}

describe('rock', () => {
	ensureBuiltins();
	const canvas = (width: number, height: number) => ({ width, height, tileable: true, seed: 1 });

	it('snaps every scale to whole cells and whole row leans when tiling', () => {
		for (const angle of [-80, -33, -10, 0, 7, 25, 45, 60, 90]) {
			for (const [w, h] of [
				[512, 512],
				[256, 128],
				[96, 300]
			]) {
				const d = rockDerived({ angle, elong: 2.5, scale: 5, detail_scale: 2.6, jag_scale: 0.5 }, canvas(w, h));
				const W = d.steep ? h : w;
				const H = d.steep ? w : h;
				for (let o = 0; o < d.cell.length / 4; o++) {
					const [cw, ch, t] = d.cell.slice(4 * o, 4 * o + 3);
					const [nx, ny, m] = d.per.slice(4 * o, 4 * o + 3);
					expect(Number.isInteger(nx) && nx >= 1 && Number.isInteger(ny) && ny >= 1).toBe(true);
					expect(cw * nx).toBeCloseTo(W, 6);
					expect(ch * ny).toBeCloseTo(H, 6);
					// A whole width along the frame's x moves the rows by exactly m cells.
					expect((t * W) / ch).toBeCloseTo(m, 6);
					expect(Number.isInteger(d.jag[4 * o]) && Number.isInteger(d.jag[4 * o + 1])).toBe(true);
				}
			}
		}
	});

	it('scales each flake level by Flake scale, bigger below 1, and leaves out levels under 2 px', () => {
		const d = rockDerived({ angle: 0, elong: 1, scale: 5, detail_scale: 6, jag_scale: 0.5 }, canvas(512, 512));
		// Blocks about 102 px, flakes about 17, 2.8 and 0.5 px: two levels are worth evaluating.
		expect(d.cell[4 + 3] / d.cell[3]).toBeCloseTo(1 / 6, 2);
		expect(d.nlev).toBe(2);
		// Below 1 each level is bigger than the last (here up to the whole texture), and every level counts.
		const up = rockDerived({ angle: 0, elong: 1, scale: 16, detail_scale: 0.5, jag_scale: 0.5 }, canvas(512, 512));
		expect(up.cell[4 + 3]).toBeGreaterThan(1.9 * up.cell[3]);
		expect(up.nlev).toBe(5);
	});

	it('compiles merged masses only with Larger blocks ticked', () => {
		const def = getLayerDef('rock')!;
		expect(def.shaderFeatures?.({ size_var: 1, merge_amt: 1 })).toEqual([]);
		expect(def.shaderFeatures?.({ merge: true, merge_amt: 0.6 })).toEqual(['RV_MERGE']);
		const merge = def.params.find((p) => p.key === 'merge_amt');
		expect(merge?.gate).toEqual({ by: 'merge', off: 0 });
	});

	it('leans the rows by the cleavage angle, steep angles on swapped axes', () => {
		const flat = rockDerived({ angle: 0, elong: 1, scale: 5 }, canvas(512, 512));
		expect(flat.steep).toBe(0);
		expect(flat.per[2]).toBe(0);
		const tilted = rockDerived({ angle: -20, elong: 3, scale: 5 }, { ...canvas(512, 512), tileable: false });
		// Negative angles turn anticlockwise on screen: the rows rise to the right (GL y up, so t > 0).
		expect(tilted.cell[2]).toBeCloseTo(Math.tan((20 * Math.PI) / 180), 6);
		expect(rockDerived({ angle: 70, elong: 1, scale: 5 }, canvas(512, 512)).steep).toBe(1);
	});

	it('keys cells seamlessly: a tile’s width and height land on the same cells', () => {
		const d = rockDerived({ angle: -25, elong: 3, scale: 4 }, canvas(512, 384));
		const [cw, ch, t] = d.cell;
		const [nx, ny, m] = d.per;
		const W = 512,
			H = 384;
		// The site of cell (i, j) in frame px, before jitter: the rows lean by t.
		const site = (i: number, j: number) => [i * cw, j * ch + t * i * cw];
		for (let i = -3; i < nx + 3; i++)
			for (let j = -3; j < ny + 3; j++) {
				const [x, y] = site(i, j);
				// The cell whose site is this one moved by a whole width (and then by a whole height).
				const i2 = Math.round((x + W) / cw);
				const j2 = Math.round((y - t * (x + W)) / ch);
				expect(key([i2, j2], nx, ny, m)).toBe(key([i, j], nx, ny, m));
				expect(key([i, Math.round((y + H - t * x) / ch)], nx, ny, m)).toBe(key([i, j], nx, ny, m));
			}
	});

	it('writes its blocks and plates as shapes and its crevices, fractures and ledges as coverages, never into Shape', () => {
		expect(maskSourcesOf('rock').map((s) => s.value)).toEqual(['layer', 'plates', 'crevices', 'fractures', 'ledges']);
		const layer = createLayer('rock', {
			mk_target: 'Shape',
			mk_src_2: 'crevices',
			mk_target_2: 'Crev',
			mk_src_3: 'ledges',
			mk_target_3: 'Shape',
			mk_src_4: 'plates',
			mk_target_4: 'Plates'
		});
		const writes = layerWrites(getLayerDef('rock'), layer.params);
		// Row 3 (a coverage into Shape) writes nothing; the others ride in passes of their own.
		expect(writes.map((w) => [w.target, w.kind, w.extra, w.params.mask_feat])).toEqual([
			['Crev', 'coverage', true, 'crevices'],
			['Plates', 'shape', true, 'plates'],
			['Shape', 'shape', false, 'blocks']
		]);
	});

	it('sizes a new layer’s relief and flakes to the texture', () => {
		const small = freshParams('rock', { width: 64, height: 64 });
		const big = freshParams('rock', { width: 512, height: 512 });
		expect(big.h_amount).toBe(40);
		expect(Number(small.h_amount)).toBeLessThan(10);
		expect(small.detail).toBe(0);
		expect(big.detail).toBe(0);
	});
});
