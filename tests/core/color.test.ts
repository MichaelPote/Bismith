import { describe, expect, it } from 'vitest';
import { hexToRgb, maxSrgbChroma, oklchToSrgb, rgbToHex, srgbCusp, srgbToOklch } from '@/core/color';

describe('oklch', () => {
	it('round-trips hex', () => {
		for (const hex of ['#bf7030', '#2e2925', '#7f8b97', '#00ff00', '#ffffff', '#000000']) {
			expect(rgbToHex(oklchToSrgb(srgbToOklch(hexToRgb(hex))))).toBe(hex);
		}
	});
	it('puts the primaries on the gamut boundary', () => {
		for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ff00ff']) {
			const [L, C, h] = srgbToOklch(hexToRgb(hex));
			expect(Math.abs(maxSrgbChroma(L, h) - C)).toBeLessThan(2e-3);
		}
	});
	it('has no chroma at black and white, some in between', () => {
		expect(maxSrgbChroma(0, 120)).toBe(0);
		expect(maxSrgbChroma(1, 120)).toBe(0);
		expect(maxSrgbChroma(0.5, 120)).toBeGreaterThan(0.05);
	});
	it('finds the cusp of a primary hue at the primary', () => {
		const [L, C, h] = srgbToOklch(hexToRgb('#0000ff'));
		const [cl, cc] = srgbCusp(h);
		expect(Math.abs(cl - L)).toBeLessThan(0.01);
		expect(Math.abs(cc - C)).toBeLessThan(2e-3);
	});
});
