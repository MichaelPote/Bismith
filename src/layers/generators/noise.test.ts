// Noise (FR2.2): the CPU side — defaults, Even levels' measured spread, and option orders the shader relies on.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs } from '../registry';
import { fractalQuantiles, noiseLayer } from './noise';

describe('noise', () => {
	ensureBuiltins();

	it('defaults to even levels and even cells; code-built layers keep neutral levels for their cutoffs', () => {
		expect(createLayer('noise').params).toMatchObject({
			even: true,
			w_even: true,
			w_profile: 'smooth',
			contrast: 1,
			bias: 0,
			soft: 0
		});
		expect(Number(createLayer('noise').params.hier)).toBeGreaterThan(0);
		// Added in the editor: a little more contrast, rolling off without a clip.
		expect(Number(freshParams('noise', { width: 512, height: 512 }).contrast)).toBeGreaterThan(1);
	});

	it('maps the cell profiles to profileCurve (index + 1: linear, smooth, round, cove)', () => {
		const prof = layerParamDefs('noise').find((d) => d.key === 'w_profile')!;
		expect(prof.options!.map((o) => o.value)).toEqual(['linear', 'smooth', 'round', 'cove']);
		expect(noiseLayer.glsl).toContain('profileCurve(u_w_profile + 1, b)');
	});

	it('orders the metric as worleyNoise() numbers it (0 euclidean, 1 manhattan, 2 chebyshev)', () => {
		const metric = layerParamDefs('noise').find((d) => d.key === 'metric')!;
		expect(metric.options!.map((o) => o.value)).toEqual(['euclidean', 'manhattan', 'chebyshev']);
		expect(noiseLayer.glsl).toContain('u_jitter, u_metric, s)');
	});

	it('measures the value spread for Even levels only when it’s on (and only for the lattice types)', () => {
		const ctx = { width: 64, height: 64, tileable: true, seed: 1 };
		const zero = (p: Record<string, unknown>) =>
			[...noiseLayer.cpuData!({ ...createLayer('noise').params, ...p } as never, ctx).calib.data].every(
				(v, i) => i % 4 === 3 || v === 0
			);
		expect(zero({ even: false })).toBe(true);
		expect(zero({ noise: 'cells' })).toBe(true);
		expect(zero({ fractal: 'billow' })).toBe(false);
		// Billow sits darker than fBm: its measured median is lower.
		const median = (fractal: number) =>
			fractalQuantiles({
				basis: 1,
				mode: fractal,
				octaves: 6,
				gain: 0.5,
				lacunarity: 2,
				crease: 0,
				ridgeOffset: 1,
				hier: 0
			})[8];
		expect(median(1)).toBeCloseTo(0.5, 1);
		expect(median(3)).toBeLessThan(median(1) - 0.05);
	});

	it('measures each setting once: other params (Levels, colours) leave the spread cached', () => {
		const stats = {
			basis: 0,
			mode: 2,
			octaves: 7,
			gain: 0.55,
			lacunarity: 2,
			crease: 0.5,
			ridgeOffset: 1.4,
			hier: 0.7
		};
		const a = fractalQuantiles(stats);
		const t = performance.now();
		const b = fractalQuantiles({ ...stats });
		expect(performance.now() - t).toBeLessThan(5);
		expect(b).toEqual(a);
		// Each caller gets its own copy.
		b[0] = -1;
		expect(fractalQuantiles(stats)[0]).toBe(a[0]);
	});

	it('shows Worley’s controls only on the Worley types', () => {
		const jitter = layerParamDefs('noise').find((d) => d.key === 'jitter')!;
		expect(['worley', 'worley2', 'cells'].map((noise) => jitter.showIf!({ noise }))).toEqual([true, true, true]);
		expect(['value', 'perlin', 'white'].map((noise) => jitter.showIf!({ noise }))).toEqual([false, false, false]);
	});
});
