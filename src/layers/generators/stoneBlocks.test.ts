// Stone blocks (FR8.22): the CPU side — editor defaults sized to the texture, paint defaults that follow the output, which
// outputs have a shape, and param ranges the shader relies on.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, linkedChanges } from '../registry';
import { stoneBlocksLayer } from './stoneBlocks';

describe('stone blocks', () => {
	ensureBuiltins();

	it('sizes a new layer’s courses, scars and relief to the texture', () => {
		const small = freshParams('stone_blocks', { width: 32, height: 32 });
		const big = freshParams('stone_blocks', { width: 512, height: 512 });
		expect(small.course).toBe(8);
		expect(Number(big.course)).toBeCloseTo(56.3, 1);
		// Scars, margins, the smallest piece and the relief follow the course.
		for (const p of [small, big]) {
			expect(Number(p.scar_size)).toBeCloseTo(Number(p.course) * 1.7, 0);
			expect(Number(p.min_size)).toBeLessThan(Number(p.course) / 2);
		}
		expect(Number(big.h_amount)).toBeGreaterThan(Number(small.h_amount));
		// A wide texture's courses follow its mean side, not its width.
		expect(Number(freshParams('stone_blocks', { width: 512, height: 32 }).course)).toBeLessThan(Number(big.course));
	});

	it('switches the paint defaults with the output, and back', () => {
		const relief = createLayer('stone_blocks');
		expect(relief.params).toMatchObject({ output: 'relief', h_on: true, dif_blend: 'normal' });
		for (const output of ['joints', 'scars', 'gaps']) {
			const changes = linkedChanges('stone_blocks', relief.params, 'output', output);
			expect(changes.h_on, output).toBe(false);
			expect(changes.dif_src, output).toBe('value');
			const back = linkedChanges(
				'stone_blocks',
				JSON.parse(JSON.stringify({ ...relief.params, ...changes })),
				'output',
				'relief'
			);
			expect(back.h_on, output).toBe(true);
			expect(back.dif_grad, output).toEqual(relief.params.dif_grad);
		}
	});

	it('puts only the relief’s stones in the Shape mask', () => {
		// (A shape write and the Edge card follow sdfShowIf; the other outputs return no distance in the shader.)
		const def = stoneBlocksLayer;
		expect(def.sdfShowIf!({ output: 'relief' })).toBe(true);
		for (const output of ['joints', 'scars', 'gaps']) expect(def.sdfShowIf!({ output }), output).toBe(false);
		expect(def.glsl!).toContain('u_output == 0 ? sd :');
	});

	it('keeps defaults inside their ranges, and the ranges the shader relies on', () => {
		for (const d of stoneBlocksLayer.params) {
			if (d.type !== 'float' && d.type !== 'int') continue;
			expect(Number(d.default), d.key).toBeGreaterThanOrEqual(d.min ?? -Infinity);
			expect(Number(d.default), d.key).toBeLessThanOrEqual(d.max ?? Infinity);
		}
		const def = (k: string) => stoneBlocksLayer.params.find((d) => d.key === k)!;
		// Course and joint jitter stay under half a step (0.8 × ±0.5), so one neighbour test either side finds the course
		// and the block; the guillotine loop runs at most three levels.
		expect(def('row_var').max).toBe(1);
		expect(def('len_var').max).toBe(1);
		expect(def('levels').max).toBe(3);
		// Joint variation is off by default: every joint as set.
		expect(def('joint_var').default).toBe(0);
		// Every length is in px, so supersampling scales it.
		for (const k of [
			'course',
			'min_size',
			'gap',
			'corner',
			'jag',
			'margin',
			'scar_size',
			'rough_scale',
			'gap_w',
			'reach'
		])
			expect(def(k).unit, k).toBe('px');
	});
});
