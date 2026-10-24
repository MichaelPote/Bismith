import { describe, expect, it } from 'vitest';
import { createLayer, createProject } from '@/core/serialize';
import { gradient } from '@/core/params';
import { hexToRgb } from '@/core/color';
import type { Project } from '@/core/project';
import { applyColourMap, colourMap, colourSlots, fitColours, quantileMap } from '@/match/colourFit';
import { Matcher, fromRgba8, type MatchImage } from '@/match/metrics';

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
		const labels = colourSlots(proj()).map((s) => s.label);
		expect(labels).toContain('base');
		expect(labels).toContain('Paint › dif_grad #1');
		expect(labels).toContain('Dirt › dirt_color');
		expect(labels.some((l) => l.startsWith('Shade'))).toBe(false);
		expect(labels.some((l) => l.startsWith('Off'))).toBe(false);
	});

	it('maps quantiles monotonically', () => {
		const src = Float32Array.from({ length: 256 }, (_, i) => i / 255);
		const dst = Float32Array.from({ length: 256 }, (_, i) => 0.2 + (0.5 * i) / 255);
		const m = quantileMap(src, dst);
		expect(m(0)).toBeCloseTo(0.2, 5);
		expect(m(1)).toBeCloseTo(0.7, 5);
		expect(m(0.5)).toBeCloseTo(0.45, 2);
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
		const r = await fitColours(p, matcher, (q) => flat(q.base.color));
		expect(r.after).toBeLessThan(r.before);
		expect(r.project.base.color).toBe('#7a5030');
		expect(p.base.color).toBe('#404040'); // input untouched
	});
});
