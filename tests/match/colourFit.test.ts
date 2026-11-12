import { describe, expect, it } from 'vitest';
import { createLayer, createProject } from '@/core/serialize';
import { gradient, type Gradient } from '@/core/params';
import { hexToRgb, srgbToOklab } from '@/core/color';
import type { Project } from '@/core/project';
import { applyColourMap, colourMap, fitColours } from '@/match/colourFit';
import { Matcher, fromRgba8, toLinearPremul, type MatchImage } from '@/match/metrics';

function flat(hex: string, w = 16, h = 16): MatchImage {
	const [r, g, b] = hexToRgb(hex);
	const px = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < w * h; i++) px.set([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255], i * 4);
	return fromRgba8(px, w, h);
}

const proj = (): Project =>
	createProject({
		width: 16,
		height: 16,
		base: { color: '#404040', roughness: 0.9, specular: 0, metalness: 0, height: 0, opacity: 1 },
		layers: [
			createLayer('noise', { dif_on: true, dif_grad: gradient('#202020', '#606060') }, 'Paint'),
			createLayer('noise', { dif_on: true, dif_blend: 'multiply', dif_grad: gradient('#ffffff', '#808080') }, 'Shade'),
			createLayer('noise', { dif_on: false, dif_grad: gradient('#000000', '#ffffff') }, 'Off'),
			createLayer('cavity', { dirt_color: '#101010' }, 'Dirt')
		]
	});

describe('colour fitting', () => {
	it('fits absolute colours only: base, normal-blend stops, colour params — not modulators or disabled channels', () => {
		const p = proj();
		const before = JSON.stringify(p.layers.map((l) => l.params));
		expect(applyColourMap(p, () => '#123456')).toBe(5); // base, Paint's two stops, Dirt
		expect(p.base.color).toBe('#123456');
		const [paint, shade, off, dirt] = p.layers.map((l) => l.params);
		expect((paint.dif_grad as Gradient).stops.map((s) => s.color)).toEqual(['#123456', '#123456']);
		expect(dirt.dirt_color).toBe('#123456');
		const was = JSON.parse(before) as Record<string, unknown>[];
		expect(shade).toEqual(was[1]);
		expect(off).toEqual(was[2]);
	});

	it("maps the render's lightness distribution monotonically onto the target's", () => {
		// Grey ramps: the render spans black to white, the target a darker, narrower band.
		const ramp = (lo: number, hi: number) =>
			fromRgba8(
				Uint8ClampedArray.from({ length: 64 * 4 }, (_, i) =>
					i % 4 === 3 ? 255 : Math.round(255 * (lo + ((hi - lo) * Math.floor(i / 4)) / 63))
				),
				64,
				1
			);
		const map = colourMap(ramp(0, 1), ramp(0.2, 0.6));
		const L = ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff'].map((h) => srgbToOklab(hexToRgb(map(h)))[0]);
		for (let i = 1; i < L.length; i++) expect(L[i]).toBeGreaterThan(L[i - 1]);
		const band = [0.2, 0.6].map((v) => srgbToOklab([v, v, v])[0]);
		expect(L[2]).toBeGreaterThan(band[0]);
		expect(L[2]).toBeLessThan(band[1]);
	});

	it('moves a flat render onto a flat target colour', () => {
		const map = colourMap(flat('#404040'), flat('#806040'));
		const p = proj();
		applyColourMap(p, map);
		expect(p.base.color).toBe('#806040');
	});

	it('converges with a renderer whose output follows the base colour', async () => {
		const target = flat('#7a5030');
		const matcher = new Matcher(target, { preset: 'texture' });
		const p = proj();
		p.layers = [];
		const r = await fitColours(p, matcher, (q) => toLinearPremul(flat(q.base.color)));
		expect(r.after).toBeLessThan(r.before);
		expect(r.project.base.color).toBe('#7a5030');
		expect(p.base.color).toBe('#404040'); // input untouched
	});
});
