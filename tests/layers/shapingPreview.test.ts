import { describe, expect, it } from 'vitest';
import type { ParamValue } from '@/core/params';
import { shapeValue, shapingSweep } from '@/layers/shapingPreview';

const vals = (p: Record<string, ParamValue>) => (k: string) => p[k];
const at = (s: ReturnType<typeof shapingSweep>, x: number) => s.output[Math.round(x * (s.xs.length - 1))];

describe('shaping preview', () => {
	it('shapes the value like the GLSL: levels, gamma, posterize, invert', () => {
		expect(shapeValue(0.5, vals({ sh_lo: 0.25, sh_hi: 0.75 }))).toBeCloseTo(0.5);
		expect(shapeValue(0.5, vals({ sh_gamma: 2 }))).toBeCloseTo(0.25);
		expect(shapeValue(0.6, vals({ sh_steps: 3 }))).toBeCloseTo(0.5);
		expect(shapeValue(0.2, vals({ sh_invert: true }))).toBeCloseTo(0.8);
	});

	it('rises across the bevel to the full height in the middle and is empty outside a shape', () => {
		const s = shapingSweep(vals({ h_on: true, h_amount: 0.5, bevel: 8, profile: 'linear' }), true);
		expect(at(s, 0.02)).toBe(0);
		expect(at(s, 0.5)).toBeCloseTo(0.5);
		expect(s.ramp).toBeGreaterThan(0);
		// Half-way up the linear ramp: half the amount.
		expect(at(s, s.edge[0] + s.ramp / 2)).toBeCloseTo(0.25, 1);
	});

	it('lifts the output by Offset where the layer covers', () => {
		const shape = shapingSweep(vals({ h_on: true, h_amount: 1, h_offset: 0.3 }), true);
		expect(at(shape, 0.5)).toBeCloseTo(1.3);
		expect(at(shape, 0.02)).toBe(0);
		const noise = shapingSweep(vals({ h_on: true, h_amount: 1, h_offset: 0.3 }), false);
		expect(at(noise, 0.02)).toBeCloseTo(0.3);
	});

	it('drops the output where the shaped value is under the cutoff', () => {
		const s = shapingSweep(vals({ h_on: true, h_amount: 1, sh_cut: 0.6 }), false);
		expect(s.cut).toBeCloseTo(0.6);
		expect(at(s, s.edge[0] + s.ramp * 0.3)).toBe(0);
		expect(at(s, 0.5)).toBeCloseTo(1);
	});

	it('shows the plain value when Height is off', () => {
		const s = shapingSweep(vals({ h_on: false, h_amount: 3, h_offset: 1 }), false);
		expect(s.amount).toBe(1);
		expect(at(s, 0.5)).toBeCloseTo(1);
	});
});
