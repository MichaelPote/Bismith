import { describe, expect, it } from 'vitest';
import type { Layer, Project } from '@/core/project';
import { createProject } from '@/core/serialize';
import type { MatchImage } from '@/match/image';
import { rng } from '../match/testUtils';
import { analyzeTiling } from '@/tiling/analyze';
import { attributeTiling } from '@/tiling/attribute';
import { fixTiling, reseed } from '@/tiling/fix';

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

	it('leaves locked layers alone', async () => {
		const attribution = await attributeTiling(project, render);
		const evaluate = (p: Project) => ({ score: analyzeTiling(render(p)).score, drift: 0 });
		const lock = (ids: string[]) => ({
			...project,
			layers: project.layers.map((l) => (ids.includes(l.id) ? { ...l, locked: true } : l))
		});
		// The whole culprit locked: nothing to fix.
		const all = await fixTiling(lock(['blob', 'blob2']), attribution, evaluate, { seeds: 2, culprits: 1 });
		expect(all.evaluations).toBe(1);
		// One copy locked: only the other is reseeded.
		const one = await fixTiling(lock(['blob']), attribution, evaluate, { seeds: 2, culprits: 1 });
		expect(one.trials.length).toBeGreaterThan(0);
		for (const t of one.trials) expect(t.name).toBe('blob (+1 copies)');
		const seeds = one.project.layers.map((l) => l.params.seed);
		expect(seeds[1]).toBe(7);
	}, 60_000);

	it('skips the drift only of candidates that lose on their score, and never keeps one', async () => {
		const attribution = await attributeTiling(project, render);
		// The blob stays with seed 7 and a third of the others (they lose on their score); the drift differs per seed, so it picks.
		const seedOf = (p: Project) => Number(p.layers[1].params.seed);
		const scoreOf = (p: Project) =>
			analyzeTiling(render(reseed(p, ['blob', 'blob2'], seedOf(p) === 7 || seedOf(p) % 3 === 0 ? 7 : 1))).score;
		const drift = (p: Project) => (seedOf(p) % 7) / 100;
		const full = await fixTiling(project, attribution, (p) => ({ score: scoreOf(p), drift: drift(p) }), {
			seeds: 9,
			culprits: 1,
			driftFree: 0.02
		});
		let skipped = 0;
		const r = await fixTiling(
			project,
			attribution,
			(p, bar) => {
				const score = scoreOf(p);
				if (bar !== undefined && !(score < bar)) {
					skipped++;
					return { score, drift: NaN };
				}
				return { score, drift: drift(p) };
			},
			{ seeds: 9, culprits: 1, driftFree: 0.02 }
		);
		expect(skipped).toBeGreaterThan(0);
		expect(r.changes).toEqual(full.changes);
		expect(r.after.score).toBe(full.after.score);
		expect(r.changes.length).toBe(1);
		expect(r.after.drift).not.toBeNaN();
	}, 60_000);

	it('picks up an interrupted run from its recorded evaluations', async () => {
		const attribution = await attributeTiling(project, render);
		const drift = (p: Project) => (Number(p.layers[1].params.seed) % 5) / 40;
		const opts = { seeds: 6, culprits: 1, driftFree: 0.05 };
		const records: { score: number; drift: number }[] = [];
		const evaluate = (p: Project, bar?: number) => {
			const score = analyzeTiling(render(p)).score;
			const e = { score, drift: bar !== undefined && !(score < bar) ? NaN : drift(p) };
			records.push(e);
			return e;
		};
		const whole = await fixTiling(project, attribution, evaluate, opts);
		const all = records.splice(0);
		const k = 4;
		await fixTiling(project, attribution, evaluate, { ...opts, shouldStop: () => records.length >= k });
		const first = records.splice(0);
		expect(first.length).toBe(k);
		let calls = 0;
		const resumed = await fixTiling(
			project,
			attribution,
			(p, bar) => {
				calls++;
				return evaluate(p, bar);
			},
			{ ...opts, replay: first }
		);
		expect(calls).toBe(all.length - k);
		expect(records).toEqual(all.slice(k));
		const strip = (r: typeof whole) => ({ ...r, before: r.before.score, after: r.after.score, project: r.project });
		expect(strip(resumed)).toEqual(strip(whole));
	}, 60_000);

	it('reseeds only the given layers', () => {
		const p = reseed(project, ['blob'], 11);
		expect(p.layers.map((l) => l.params.seed)).toEqual([4, 11, 7]);
	});
});
