import { describe, expect, it } from 'vitest';
import type { Layer, Project } from '@/core/project';
import { createProject } from '@/core/serialize';
import type { MatchImage } from '@/match/image';
import { rng } from '@/match/testUtils';
import { analyzeTiling } from './analyze';
import { attributeTiling } from './attribute';
import { fixTiling, reseed } from './fix';

const S = 128;
const wd = (a: number, b: number) => Math.min(Math.abs(a - b), S - Math.abs(a - b));

const layer = (id: string, type: string, seed: number): Layer => ({
	id,
	type,
	name: id,
	enabled: true,
	params: { seed }
});

/** Even dots, plus a 'blob' layer whose seed sets its size: most seeds give a dot like the others, seed 7 a big blob. */
function render(p: Project): MatchImage {
	const blob = p.layers.find((l) => l.id === 'blob')!;
	const radius = Number(blob.params.seed) === 7 ? 12 : 3;
	const r = rng(3);
	const pts: [number, number, number][] = [];
	for (let gy = 0; gy < 8; gy++)
		for (let gx = 0; gx < 8; gx++) pts.push([gx * 16 + 4 + r() * 8, gy * 16 + 4 + r() * 8, 2.5 + r()]);
	const n = rng(7);
	const data = new Float32Array(S * S * 4);
	for (let y = 0; y < S; y++)
		for (let x = 0; x < S; x++) {
			let v = 0.6 + n() * 0.04;
			if (pts.some(([px, py, pr]) => Math.hypot(wd(x, px), wd(y, py)) < pr)) v = 0.25;
			if (blob.enabled && Math.hypot(wd(x, 40), wd(y, 88)) < radius) v = 0.2;
			data.set([v, v, v, 1], (y * S + x) * 4);
		}
	return { width: S, height: S, data };
}

describe('fixTiling', () => {
	const project = createProject({
		width: S,
		height: S,
		layers: [layer('dots', 'spots', 4), layer('blob', 'disc', 7), layer('blob2', 'disc', 7)]
	});

	it('reseeds the culprit (its pattern copies together) until the landmark is gone', async () => {
		const attribution = await attributeTiling(project, render);
		expect(attribution.layers[attribution.findings[0].layer].ids).toEqual(['blob', 'blob2']);
		const r = await fixTiling(project, attribution, (p) => ({ score: analyzeTiling(render(p)).score, drift: 0 }), {
			seeds: 4,
			culprits: 1
		});
		expect(r.after.score).toBeLessThan(r.before.score);
		expect(r.changes[0]).toMatchObject({ ids: ['blob', 'blob2'], key: 'seed', from: 7 });
		const seeds = r.project.layers.filter((l) => l.type === 'disc').map((l) => l.params.seed);
		expect(seeds[0]).toBe(seeds[1]);
		expect(seeds[0]).not.toBe(7);
	}, 60_000);

	it('keeps the project when no candidate helps', async () => {
		const attribution = await attributeTiling(project, render);
		const r = await fixTiling(
			project,
			attribution,
			(p) => ({ score: analyzeTiling(render(p)).score, drift: p === project ? 0 : 1 }),
			{
				seeds: 3,
				driftFree: 0.25,
				culprits: 1
			}
		);
		// Every candidate drifts past the given allowance: nothing is applied.
		expect(r.changes).toEqual([]);
		expect(r.project).toBe(project);
	}, 60_000);

	it('reseeds only the given layers', () => {
		const p = reseed(project, ['blob'], 11);
		expect(p.layers.map((l) => l.params.seed)).toEqual([4, 11, 7]);
	});
});
