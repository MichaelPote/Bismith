// Rock (FR8.18): the CPU side — editor defaults sized to the texture, defaults that follow the output, and param ranges
// the shader relies on.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, linkedChanges } from '../registry';
import { imod } from '../derivedMath';
import { rockDerived, rockLayer } from './rock';

describe('rock', () => {
	ensureBuiltins();

	it('sizes a new layer’s blocks and relief to the texture', () => {
		const small = freshParams('rock', { width: 32, height: 32 });
		const big = freshParams('rock', { width: 512, height: 512 });
		expect(small.size).toBe(6);
		expect(big.size).toBe(48);
		expect(Number(big.h_amount)).toBeCloseTo(Number(big.size) * 0.32, 1);
		// Facets under ~8 px fade out, so small blocks get two levels, big ones three.
		expect(small.detail).toBe(2);
		expect(big.detail).toBe(3);
		// A wide texture's blocks follow its mean side, not its width.
		expect(Number(freshParams('rock', { width: 512, height: 32 }).size)).toBeLessThan(Number(big.size));
	});

	it('switches the paint defaults with the output, and back', () => {
		const relief = createLayer('rock');
		expect(relief.params).toMatchObject({ output: 'relief', h_on: true, dif_blend: 'normal' });
		for (const output of ['scarps', 'crevices', 'streaks']) {
			const changes = linkedChanges('rock', relief.params, 'output', output);
			expect(changes.h_on, output).toBe(false);
			// The paint ramp follows too (a gradient: compared by value, not as the same object).
			expect(changes.dif_grad, output).toBeDefined();
			const back = linkedChanges(
				'rock',
				JSON.parse(JSON.stringify({ ...relief.params, ...changes })),
				'output',
				'relief'
			);
			expect(back.h_on, output).toBe(true);
			expect(back.dif_grad, output).toEqual(relief.params.dif_grad);
		}
	});

	it('switches the shape with the style, keeps what the user changed, and goes back', () => {
		const base = createLayer('rock').params;
		const cols = linkedChanges('rock', base, 'style', 'columns');
		expect(cols).toMatchObject({ angle: 90, crest: 'hex', bulge: 1 });
		// Block size, Height and paint aren't the style's.
		for (const k of ['size', 'h_amount', 'dif_grad', 'output']) expect(k in cols, k).toBe(false);
		// A param the user set stays; untouched ones follow the next style, and Default restores them.
		const user = { ...base, ...cols, angle: 80 };
		const rubble = linkedChanges('rock', user, 'style', 'rubble');
		expect(rubble.angle).toBeUndefined();
		expect(rubble).toMatchObject({ crest: 'dome', weather: 3, proud: 0.4 });
		const back = linkedChanges('rock', { ...user, ...rubble }, 'style', 'default');
		for (const d of rockLayer.params)
			if (d.key in back && d.key !== 'style') expect(back[d.key], d.key).toEqual(d.default);
	});

	it('keeps defaults inside their ranges', () => {
		for (const d of rockLayer.params) {
			if (d.type !== 'float' && d.type !== 'int') continue;
			expect(Number(d.default), d.key).toBeGreaterThanOrEqual(d.min ?? -Infinity);
			expect(Number(d.default), d.key).toBeLessThanOrEqual(d.max ?? Infinity);
		}
	});

	it('works out a strata lattice that tiles, at any size and angle', () => {
		const base = createLayer('rock').params;
		// rk_wrap: a cell reduced by the basis (g, B, C).
		const wrap = (x: number, y: number, [g, B, C]: number[]) => {
			const i = imod(x, g);
			return [i, imod(y - ((x - i) / g) * B, C)];
		};
		const sizes = [
			[64, 64],
			[96, 96],
			[128, 128],
			[256, 256],
			[512, 512],
			[97, 61],
			[300, 200],
			[1, 1]
		];
		for (const [width, height] of sizes)
			for (const angle of [-15, 0, 20, 45, -60, 80, 90])
				for (const extra of <Record<string, number>[]>[
					{},
					{ cross: 15, stagger: 1 },
					{ size: 40, elong: 3, cross: -30 }
				]) {
					const p = { ...base, angle, ...extra };
					const at = `${width}×${height} ${angle}° ${JSON.stringify(extra)}`;
					const d = rockDerived(p, { width, height, tileable: true, seed: 0 });
					const [H, W, s, t] = d.frame;
					const [sx, sy] = d.vert ? [height, width] : [width, height];
					// Whole cells along and across the bedding, a whole shear and cross-joint lean over the tile.
					const nu = sx / W,
						nv = sy / H,
						ks = (t * sx) / H,
						kU = (s * sy) / W;
					for (const k of [nu, nv, ks, kU]) expect(Math.abs(k - Math.round(k)), at).toBeLessThan(1e-3);
					// The basis reduces both of the tile's periods to the origin, and spans the same area: the same lattice.
					const [u, v, sh, ku] = [nu, nv, ks, kU].map(Math.round);
					expect(wrap(u, sh, d.wrap0), at).toEqual([0, 0]);
					expect(wrap(-ku, v, d.wrap0), at).toEqual([0, 0]);
					expect(d.wrap0[0] * d.wrap0[2], at).toBe(Math.abs(u * v + ku * sh));
					// The merge domain, by the rows first (transposed), likewise.
					expect(wrap(sh, u, d.wrapT), at).toEqual([0, 0]);
					expect(wrap(v, -ku, d.wrapT), at).toEqual([0, 0]);
					// Rows repeat every gR beds: a divisor of the beds that the shear carries across the tile.
					expect(v % d.gR, at).toBe(0);
					expect(Math.abs(sh % d.gR), at).toBe(0);
					// Long fractures: whole lanes across the tile and whole segments along it.
					const [fx, fy, lane, segL] = d.frac;
					const [nL, nS] = d.frac2;
					expect(Math.hypot(fx, fy), at).toBeCloseTo(1, 5);
					expect(Number.isInteger(nL) && Number.isInteger(nS) && nL >= 1 && nS >= 1, at).toBe(true);
					const Lp = nS * segL;
					expect(nL * lane * Lp, at).toBeCloseTo(width * height, 2);
				}
		// Untiled, nothing is snapped.
		const u = rockDerived(base, { width: 100, height: 70, tileable: false, seed: 0 });
		expect(u.frac2[0]).toBe(1e6);
		expect(u.wrap0).toEqual([1, 1, 1]);
	});
});
