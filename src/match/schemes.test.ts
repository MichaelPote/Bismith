import { describe, expect, it } from 'vitest';
import { hexToRgb, linearToOklab, srgbToLinear1, type RGB } from '@/core/color';
import { layerParamDefs } from '@/layers/registry';
import { ensureBuiltins } from '@/render/builtins';
import { LOOKS, TEMPLATE_LOOKS, lookScheme, rng, schemeAnalysis, templateScheme } from './schemes';
import { availableTemplates } from './templates';

const lab = (hex: string) => linearToOklab(hexToRgb(hex).map(srgbToLinear1) as RGB);
const hueDeg = (hex: string) => {
	const [, a, b] = lab(hex);
	return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
};
const chroma = (hex: string) => Math.hypot(lab(hex)[1], lab(hex)[2]);

describe('material schemes', () => {
	it('are valid colours, dark → light, deterministic per seed, for every look', () => {
		for (const look of Object.keys(LOOKS)) {
			for (let seed = 1; seed <= 40; seed++) {
				const s = lookScheme(look, rng(seed));
				expect(s.palette.length, look).toBeGreaterThanOrEqual(5);
				for (const c of s.palette) expect(c).toMatch(/^#[0-9a-f]{6}$/);
				for (let i = 1; i < s.palette.length; i++)
					expect(lab(s.palette[i])[0]).toBeGreaterThanOrEqual(lab(s.palette[i - 1])[0]);
				expect(s.palette).toContain(s.accent);
				expect(lookScheme(look, rng(seed))).toEqual(s);
			}
		}
	});

	it('keep materials in their colours: stone never green or blue-saturated, lava never blue', () => {
		for (let seed = 1; seed <= 200; seed++) {
			for (const c of lookScheme('stone', rng(seed)).palette) {
				if (chroma(c) > 0.025) expect(hueDeg(c) < 100 || hueDeg(c) > 215, `stone ${c}`).toBe(true);
				expect(chroma(c), `stone ${c}`).toBeLessThan(0.07);
			}
			// A lava scheme (its accent red-orange) keeps every coloured value red to yellow — its cores included.
			const liquid = lookScheme('liquid', rng(seed));
			if (hueDeg(liquid.accent) >= 20 && hueDeg(liquid.accent) <= 60)
				for (const c of liquid.palette)
					if (chroma(c) > 0.03) expect(hueDeg(c) >= 10 && hueDeg(c) <= 115, `lava ${c}`).toBe(true);
		}
	});

	it('give every template a look and a buildable project with known params', () => {
		ensureBuiltins();
		for (const t of availableTemplates()) {
			expect(TEMPLATE_LOOKS[t.id], `${t.id} has a look`).toBeDefined();
			const p = t.build(schemeAnalysis(templateScheme(t.id, rng(7)), 64, 64, 0.02), { palette: '' });
			expect(p.width).toBe(64);
			for (const l of p.layers) {
				const keys = new Set(layerParamDefs(l.type).map((d) => d.key));
				for (const k of Object.keys(l.params)) expect(keys.has(k), `${t.id}/${l.name}: unknown param ${k}`).toBe(true);
			}
		}
	});
});
