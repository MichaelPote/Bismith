// Rock (FR8.18): the CPU side — editor defaults sized to the texture, defaults that follow the output, and param ranges
// the shader relies on.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs, linkedChanges } from '../registry';
import { rockLayer } from './rock';

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

	it('links only known params and uses every param it declares', () => {
		const keys = new Set(layerParamDefs('rock').map((d) => d.key));
		for (const output of ['relief', 'scarps', 'crevices', 'streaks']) {
			for (const k of Object.keys(rockLayer.linkedDefaults!({ output })))
				expect(keys.has(k), `${output}: ${k}`).toBe(true);
		}
		// (The seed reaches the shader mixed into uSeed; the style is UI-only, a set of linked defaults.)
		for (const d of rockLayer.params)
			if (d.key !== 'seed' && d.uniform !== false)
				expect(rockLayer.glsl!.includes(`u_${d.key}`), `u_${d.key} unused`).toBe(true);
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
});
