import { describe, expect, it } from 'vitest';
import { RGBA_PRESETS, RGB_PRESETS, R_PRESETS, withOpacityRamp } from '@/core/gradientPresets';
import { MAX_GRADIENT_STOPS, P, sanitizeValue, type Gradient } from '@/core/params';

const names = (ps: { name: string }[]) => ps.map((p) => p.name);

describe('ramp presets', () => {
	it('colour ramps are valid and survive sanitising unchanged', () => {
		const def = P.gradient('g', 'G', { stops: [{ pos: 0, color: '#000000' }] }, { alpha: true });
		for (const p of [...RGB_PRESETS, ...RGBA_PRESETS]) {
			expect(p.gradient.stops.length, p.name).toBeLessThanOrEqual(MAX_GRADIENT_STOPS);
			expect(sanitizeValue(def, p.gradient), p.name).toEqual(p.gradient);
		}
	});

	it('RGB ramps are opaque and RGBA ones use their opacity', () => {
		for (const p of RGB_PRESETS)
			expect(
				p.gradient.stops.every((s) => s.alpha === undefined),
				p.name
			).toBe(true);
		for (const p of RGBA_PRESETS)
			expect(
				p.gradient.stops.some((s) => s.alpha !== undefined),
				p.name
			).toBe(true);
	});

	it('R ramps are ends within the range, none repeated', () => {
		for (const p of R_PRESETS) for (const v of [p.a, p.b]) expect(v >= 0 && v <= 1, p.name).toBe(true);
		expect(new Set(R_PRESETS.map((p) => `${p.a} ${p.b}`)).size).toBe(R_PRESETS.length);
	});

	it('cover the asked-for materials', () => {
		for (const list of [RGB_PRESETS, RGBA_PRESETS])
			expect(names(list)).toEqual(expect.arrayContaining(['Ice', 'Water', 'Fire', 'Rock', 'Moss', 'Sand']));
		expect(names(R_PRESETS)).toEqual(expect.arrayContaining(['Ice', 'Water', 'Rock', 'Moss', 'Sand']));
	});
});

describe('withOpacityRamp', () => {
	it('runs the opacity from a to b and keeps the colours', () => {
		const g: Gradient = {
			stops: [
				{ pos: 0, color: '#ff0000', alpha: 0.3 },
				{ pos: 0.5, color: '#00ff00' },
				{ pos: 1, color: '#0000ff' }
			]
		};
		const out = withOpacityRamp(g, 0, 1);
		expect(out.stops.map((s) => s.color)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
		expect(out.stops.map((s) => s.alpha ?? 1)).toEqual([0, 0.5, 1]);
		expect(withOpacityRamp(g, 1, 1).stops.every((s) => s.alpha === undefined)).toBe(true);
	});

	it('adds end stops where the ramp stops short of the ends', () => {
		const g: Gradient = {
			stops: [
				{ pos: 0.2, color: '#ff0000' },
				{ pos: 0.8, color: '#0000ff' }
			]
		};
		const out = withOpacityRamp(g, 1, 0);
		expect(out.stops.map((s) => [s.pos, s.color, s.alpha ?? 1])).toEqual([
			[0, '#ff0000', 1],
			[0.2, '#ff0000', 0.8],
			[0.8, '#0000ff', 0.2],
			[1, '#0000ff', 0]
		]);
	});
});
