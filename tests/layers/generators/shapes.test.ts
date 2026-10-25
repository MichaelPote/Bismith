// Shape layers (FR2.3): the editor's fresh layers are sized to the texture, and the
// plain defaults are the clean ones (Diffuse from the shape, scaled bevels, the centred arc).

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs, sanitizeLayer } from '@/layers/registry';
import { SHAPE_LAYERS } from '@/layers/generators/shapes';

describe('shape layers', () => {
	ensureBuiltins();

	it('give fresh editor layers a size and bevel that follow the texture', () => {
		for (const def of SHAPE_LAYERS) {
			const keys = new Set(layerParamDefs(def.type).map((d) => d.key));
			const small = freshParams(def.type, { width: 64, height: 64 });
			const big = freshParams(def.type, { width: 1024, height: 512 });
			for (const k of Object.keys(big)) expect(keys.has(k), `${def.type}: fresh key ${k}`).toBe(true);
			expect(Number(small.bevel), def.type).toBeGreaterThanOrEqual(1);
			expect(Number(big.bevel), def.type).toBeGreaterThan(Number(small.bevel));
		}
		expect(freshParams('circle', { width: 512, height: 512 }).radius).toBe(102);
		expect(freshParams('rect', { width: 512, height: 256 })).toMatchObject({ inset_x: 16, inset_y: 16 });
	});

	it('default to a clean fill, scaled bevels and the centred arc', () => {
		for (const def of SHAPE_LAYERS)
			expect(createLayer(def.type).params, def.type).toMatchObject({ dif_src: 'shape', rep_scale_bevel: true });
		expect(createLayer('curve').params).toMatchObject({ kind: 'arc', pivot: 'middle' });
	});

	it('load layers saved with params that have gone (they fall back to the defaults)', () => {
		expect(sanitizeLayer(createLayer('polygon', { star: true, inner: 0.4 })).params).toMatchObject({
			star: true,
			inner_r: 0.5
		});
		expect(sanitizeLayer(createLayer('polygon', { star: true, inner: 0.4 })).params.inner).toBeUndefined();
		expect(sanitizeLayer(createLayer('cross', { size: 16, arm: 4, round: 2 })).params).toMatchObject({
			size: 16,
			arm: 4,
			corner: 0
		});
	});

	it('share the placement and repeat controls, with px lengths marked for supersampling', () => {
		for (const def of SHAPE_LAYERS) {
			const keys = def.params.map((d) => d.key);
			for (const k of [
				'x',
				'y',
				'rotation',
				'outline',
				'rep_x',
				'rep_y',
				'rep_jitter',
				'rep_rot',
				'rep_rot_step',
				'rep_flip',
				'rep_scale',
				'rep_drop',
				'rep_mirror_x',
				'rep_mirror_y',
				'seed'
			]) {
				expect(keys, def.type).toContain(k);
			}
			for (const d of def.params)
				if (
					[
						'outline',
						'rep_jitter',
						'radius',
						'length',
						'thickness',
						'size',
						'arm',
						'width',
						'height',
						'inset_x',
						'inset_y',
						'bend',
						'round',
						'round_in',
						'corner',
						'fillet',
						'stem'
					].includes(d.key)
				) {
					expect(d.unit, `${def.type}.${d.key}`).toBe('px');
				}
		}
	});
});
