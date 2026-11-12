import { describe, expect, it } from 'vitest';
import { TILINGS, buildNet, diagonal, makeTiling, type BuildOpts } from '@/layers/generators/strapNet';

const opts = (o: Partial<BuildOpts>): BuildOpts => ({
	tiling: 'octagon',
	construct: 'stars',
	angle: 67.5,
	offset: 0,
	ringScale: 1.3,
	ringRound: 0.5,
	...o
});

describe('strapwork network', () => {
	it('builds every tiling with every construction', () => {
		for (const tiling of TILINGS)
			for (const construct of ['edges', 'stars', 'rings', 'edges_stars', 'edges_rings'] as const) {
				const n = buildNet(opts({ tiling, construct, angle: 60 }), 64);
				expect(n.pieces.length, `${tiling} ${construct}`).toBeGreaterThan(0);
				expect(n.regions.length, `${tiling} ${construct}`).toBeGreaterThan(1);
			}
	});
	it('makes star patterns that cross and weave consistently', () => {
		for (const [tiling, angle] of [
			['octagon', 67.5],
			['hexagon', 60],
			['dodecagon', 70],
			['square', 45]
		] as const) {
			const n = buildNet(opts({ tiling, angle }));
			expect(n.conflicts, tiling).toBe(0);
			const ends = n.pieces.flatMap((p) => [p.endA, p.endB]).filter((e) => e > 0);
			expect(ends.length, tiling).toBeGreaterThan(0);
			// Every crossing has two strands on top and two beneath (pieces meet it from both sides).
			expect(ends.filter((e) => e === 1).length, tiling).toBe(ends.filter((e) => e === 2).length);
		}
	});
	it('doubles the period when one period cannot be two-coloured', () => {
		const n = buildNet(opts({ tiling: 'hexagon', angle: 60 }));
		expect(n.rep[0] * n.rep[1]).toBeGreaterThan(1);
		expect(n.conflicts).toBe(0);
	});
	it('sorts fields into kinds by size and orientation', () => {
		const rh = buildNet(opts({ tiling: 'rhombille', construct: 'edges' }));
		expect(new Set(rh.regions.slice(1).map((r) => r.kind)).size).toBe(3);
		const oct = buildNet(opts({ tiling: 'octagon', construct: 'edges' }));
		expect(new Set(oct.regions.slice(1).map((r) => r.kind)).size).toBe(2);
	});
	it('turns a square-period tiling 45° on a √2 period', () => {
		const t = diagonal(makeTiling('square'));
		expect(t.period[0]).toBeCloseTo(Math.SQRT2);
		expect(t.polys).toHaveLength(2);
		expect(buildNet(opts({ tiling: 'square', construct: 'rings', diagonal: true })).pieces.length).toBeGreaterThan(0);
	});
});
