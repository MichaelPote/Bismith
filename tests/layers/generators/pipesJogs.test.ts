// Pipes & conduits' jogs (pipesJogs.ts): planned so that runs meet only where straight lengths cross at 45° or 90°.
// Checked here from the plan's own numbers, without its clash test: no two straight lengths along the runs overlap side
// by side, and nothing along the runs passes through a jog's bends.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer } from '@/layers/registry';
import { JOG_KEEP, planJogRuns, planJogs, type Run } from '@/layers/generators/pipesJogs';

ensureBuiltins();

const params = (extra: Record<string, unknown>) => ({ ...createLayer('pipes').params, ...extra });
const ctx = (seed: number) => ({ width: 512, height: 512, tileable: true, seed });

const CASES: Record<string, unknown>[] = [
	{ count: 5, diameter: 50, jog_chance: 1, jog_angle: '90', jog_amount: 0.3 },
	{ count: 6, diameter: 24, bundle_max: 2, jog_chance: 1, jog_angle: 'mixed', jog_amount: 0.3 },
	{ count: 12, diameter: 14, clamp_foot: 4, jog_chance: 1, jog_angle: '45', jog_amount: 0.4 },
	{ count: 24, diameter: 8, clamp_lip: 1, clamp_foot: 2, jog_chance: 1, jog_angle: 'mixed', jog_amount: 0.4 }
];

/** A run's straight lengths along it: [x from, x to, level]. */
function lengths(r: Run, W: number): [number, number, number][] {
	const j = r.jog;
	if (!j) return [[0, W, r.bc]];
	return [
		[j.x[1] + j.w[1], j.x[0] + W - j.w[0], r.bc],
		[j.x[0] + j.w[0], j.x[1] - j.w[1], r.bc + j.s]
	];
}

/** Whether x ranges [a0, a1] and [b0, b1] overlap on a loop W around (by more than eps). */
function overlapX(a0: number, a1: number, b0: number, b1: number, W: number, eps = 0.5): boolean {
	for (const o of [-W, 0, W]) if (Math.min(a1, b1 + o) - Math.max(a0, b0 + o) > eps) return true;
	return false;
}

describe('pipes jogs', () => {
	it('plans nothing without a jog chance or amount', () => {
		expect(planJogRuns(params({ jog_chance: 0 }), ctx(1))).toBeNull();
		expect(planJogRuns(params({ jog_chance: 1, jog_amount: 0 }), ctx(1))).toBeNull();
		expect(Array.from(planJogs(params({ jog_chance: 0 }), ctx(1)).data).every((v) => v === 0)).toBe(true);
	});

	it('jogs most runs where there is room, the same way every time', () => {
		const p = params(CASES[1]);
		const a = planJogRuns(p, ctx(3))!;
		expect(a.runs.filter((r) => r.jog).length).toBeGreaterThanOrEqual(4);
		expect(planJogs(p, ctx(3)).data).toEqual(planJogs(p, ctx(3)).data);
		for (const r of a.runs) expect(r.keep.length).toBeLessThanOrEqual(JOG_KEEP);
	});

	it('never lays straight lengths over each other, nor across a bend', () => {
		for (const c of CASES)
			for (const seed of [1, 2, 3, 4]) {
				const { runs, W, H } = planJogRuns(params(c), ctx(seed))!;
				const label = `${JSON.stringify(c)} seed ${seed}`;
				for (const A of runs)
					for (const B of runs)
						for (const oy of [-H, 0, H]) {
							if (A === B && oy === 0) continue;
							const gap = 0.5 * (A.tot + B.tot);
							for (const [a0, a1, ya] of lengths(A, W)) {
								// Side by side: apart by both runs' half widths wherever they run alongside.
								for (const [b0, b1, yb] of lengths(B, W))
									if (overlapX(a0, a1, b0, b1, W))
										expect(Math.abs(ya - yb - oy), label).toBeGreaterThanOrEqual(gap - 0.01);
								// A's bends: the stretch of a step from each level to the bend's end, across its x span.
								const j = A.jog;
								if (!j) continue;
								for (const [i, xt, y0, s] of [
									[0, j.x[0], A.bc, j.s],
									[1, j.x[1], A.bc + j.s, -j.s]
								] as const) {
									const rise = j.rf[i] * (j.a[i] ? 1 - Math.SQRT1_2 : 1);
									// (The bend at the step's start level ends its first rf · sin θ along, the other starts
									// that far before its end.)
									const run = j.rf[i] * (j.a[i] ? Math.SQRT1_2 : 1);
									const pad = 0.5 * A.tot;
									for (const [yl, dir, x0, x1] of [
										[y0, Math.sign(s), xt - j.w[i] - pad, xt - j.w[i] + run + pad],
										[y0 + s, -Math.sign(s), xt + j.w[i] - run - pad, xt + j.w[i] + pad]
									]) {
										const lo = Math.min(yl, yl + dir * rise);
										const hi = Math.max(yl, yl + dir * rise);
										for (const [b0, b1, yb] of lengths(B, W)) {
											const y = yb + oy;
											if (!overlapX(x0, x1, b0, b1, W)) continue;
											const d = y < lo ? lo - y : y > hi ? y - hi : 0;
											expect(d, `${label}: run ${B.kw} through run ${A.kw}'s bend`).toBeGreaterThanOrEqual(gap - 0.01);
										}
									}
								}
							}
						}
			}
	});
});
