// Rock (FR8.18): the CPU side — editor defaults sized to the texture, defaults that follow the output, and param ranges
// the shader relies on.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, linkedChanges } from '@/layers/registry';
import { imod } from '@/layers/derivedMath';
import { rockDerived, rockLayer } from '@/layers/generators/rock';
import { noiseFieldGlsl, noiseLayer } from '@/layers/generators/noise';
import { shaderKey } from '@/render/materialPipeline';

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

	it('compiles noise facets only for the layers that pick them, with the Noise layer’s controls', () => {
		const layer = createLayer('rock');
		expect(shaderKey(layer)).toBe('rock');
		const def = (key: string) => rockLayer.params.find((d) => d.key === key)!;
		expect(def('fn_noise').showIf!(layer.params)).toBe(false);
		const noisy = { ...layer.params, facet_src: 'noise' };
		expect(shaderKey({ type: 'rock', params: noisy })).toBe('rock~f:RK_FACET_NOISE');
		expect(def('fn_noise').showIf!(noisy)).toBe(true);
		expect(def('detail').showIf!(noisy)).toBe(false);
		// The controls' own conditions read their prefixed values.
		expect(def('fn_jitter').showIf!(noisy)).toBe(false);
		expect(def('fn_jitter').showIf!({ ...noisy, fn_noise: 'worley' })).toBe(true);
		// One shader whatever the type; single pixels are Surface grain's.
		expect(def('fn_noise').options!.map((o) => o.value)).not.toContain('white');
		expect(noiseLayer.params.find((d) => d.key === 'noise')!.options!.map((o) => o.value)).toContain('white');
		const glsl = noiseFieldGlsl('fn_');
		expect(glsl).toContain('u_fn_warp_scale');
		expect(glsl).not.toMatch(/\bu_(noise|fractal|warp_scale)\b/);
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
				}
		// Untiled, nothing is snapped.
		const u = rockDerived(base, { width: 100, height: 70, tileable: false, seed: 0 });
		expect(u.wrap0).toEqual([1, 1, 1]);
	});
});
