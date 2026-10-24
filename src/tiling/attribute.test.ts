import { describe, expect, it } from 'vitest';
import type { Layer, Project } from '@/core/project';
import { createProject } from '@/core/serialize';
import type { MatchImage } from '@/match/image';
import { rng } from '@/match/testUtils';
import { attributeTiling, blameUnits } from './attribute';

const S = 128;
const wd = (a: number, b: number) => Math.min(Math.abs(a - b), S - Math.abs(a - b));

const layer = (id: string, type: string, seed?: number): Layer => ({
	id,
	type,
	name: id,
	enabled: true,
	params: seed === undefined ? {} : { seed }
});

/**
 * A stand-in renderer: a light ground, an even lift ('tint'), jittered dots ('dots'), one big blob ('blob') and a
 * height-only relief copy of the dots ('dots' again, same seed: darkens the dots a little more).
 */
function render(p: Project): MatchImage {
	const on = (id: string) => p.layers.some((l) => l.id === id && l.enabled);
	const r = rng(3);
	const pts: [number, number, number][] = [];
	for (let gy = 0; gy < 8; gy++)
		for (let gx = 0; gx < 8; gx++) pts.push([gx * 16 + 4 + r() * 8, gy * 16 + 4 + r() * 8, 2.5 + r()]);
	const n = rng(7);
	const data = new Float32Array(S * S * 4);
	for (let y = 0; y < S; y++)
		for (let x = 0; x < S; x++) {
			let v = 0.6 + n() * 0.04;
			if (on('tint')) v += 0.1;
			if (on('dots') && pts.some(([px, py, pr]) => Math.hypot(wd(x, px), wd(y, py)) < pr)) v = 0.25;
			if (on('relief') && pts.some(([px, py, pr]) => Math.hypot(wd(x, px), wd(y, py)) < pr)) v -= 0.05;
			if (on('blob') && Math.hypot(wd(x, 40), wd(y, 88)) < 11) v = 0.2;
			data.set([v, v, v, 1], (y * S + x) * 4);
		}
	return { width: S, height: S, data };
}

describe('attributeTiling', () => {
	const project = createProject({
		width: S,
		height: S,
		layers: [layer('tint', 'fill'), layer('dots', 'spots', 4), layer('relief', 'spots', 4), layer('blob', 'disc', 9)]
	});

	it('leaves pattern copies out together', () => {
		expect(blameUnits(project)).toEqual([['tint'], ['dots', 'relief'], ['blob']]);
	});

	it('blames the layer that made the unique patch, not the one that changes everything evenly', async () => {
		const r = await attributeTiling(project, render, { without: true });
		const blob = r.layers.find((l) => l.ids[0] === 'blob')!;
		const tint = r.layers.find((l) => l.ids[0] === 'tint')!;
		expect(tint.contribution).toBeGreaterThan(blob.contribution);
		expect(tint.blame.patches).toBeLessThan(blob.blame.patches / 5);
		expect(r.layers[r.findings[0].layer].ids).toEqual(['blob']);
		expect(blob.without!.terms.patches).toBeLessThan(r.analysis.terms.patches);
	}, 60_000);
});
