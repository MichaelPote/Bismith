import { describe, expect, it } from 'vitest';
import { Matcher, compareImages, toOklab, type MatchImage } from '@/match/metrics';
import { motifPlane, motifTarget } from '@/match/motifs';
import { colourise, noiseField, testTexture } from './testUtils';

/**
 * A riveted plate: fine speckle (its own seed) with rivets — a highlight and a shadow 2 px below — on a grid every
 * `period` px from (x0, y0). gain 0 leaves them out.
 */
function riveted(o: { seed?: number; gain?: number; x0?: number; y0?: number; period?: number } = {}): MatchImage {
	const { seed = 1, gain = 1, x0 = 4, y0 = 3, period = 8 } = o;
	const w = 64;
	const f = noiseField(w, w, seed);
	for (let i = 0; i < f.length; i++) f[i] = 0.45 + (f[i] - 0.5) * 0.15;
	const bump = (cx: number, cy: number, a: number) => {
		for (let y = -3; y <= 3; y++)
			for (let x = -3; x <= 3; x++) {
				const i = (((cy + y) % w) + w) % w;
				const j = (((cx + x) % w) + w) % w;
				f[i * w + j] += a * Math.exp(-(x * x + y * y) / (2 * 0.7 * 0.7));
			}
	};
	for (let y = y0; y < w; y += period)
		for (const x of [x0, x0 + 23, x0 + 32, x0 + 55]) {
			bump(x, y, 0.35 * gain);
			bump(x + 1, y + 2, -0.35 * gain);
		}
	return colourise(f, w, w, [0.05, 0.05, 0.05], [0.7, 0.68, 0.66]);
}

const motifs = (render: MatchImage, ref: MatchImage) =>
	compareImages(render, ref, { preset: 'tilemotif', wrap: true }).raw.motifs;

const layoutOf = (img: MatchImage) => motifTarget(motifPlane(toOklab(img).L, img.width, img.height, true)).layout;

describe('motifs term', () => {
	const ref = riveted();

	it('sees a laid-out reference as laid out and random texture as not', () => {
		expect(layoutOf(ref)).toBeGreaterThan(0.9);
		expect(layoutOf(testTexture(64, 64, 3))).toBe(0);
	});

	it('scores the same rivets over other speckle low, and missing or misplaced rivets high', () => {
		const reseed = motifs(riveted({ seed: 2 }), ref);
		const moved = motifs(riveted({ seed: 2, x0: 5 }), ref);
		const none = motifs(riveted({ seed: 2, gain: 0 }), ref);
		const rows = motifs(riveted({ seed: 2, period: 16 }), ref);
		expect(motifs(ref, ref)).toBeLessThan(1e-6);
		expect(moved, 'a 1 px move is tolerated').toBeLessThan(reseed + 0.1);
		expect(none).toBeGreaterThan(reseed + 0.15);
		expect(rows).toBeGreaterThan(reseed + 0.1);
	});

	it('charges rivets that are too bold less than missing ones', () => {
		const bold = motifs(riveted({ seed: 2, gain: 2 }), ref);
		const none = motifs(riveted({ seed: 2, gain: 0 }), ref);
		expect(bold).toBeLessThan(none);
	});

	it('counts only in its own preset, and not at all on a stochastic reference', () => {
		const m = new Matcher(ref, { preset: 'tilewin', wrap: true });
		expect(m.targetFeatures.motif).toBeNull();
		expect(m.score(riveted({ gain: 0 })).weights.motifs).toBe(0);
		const noisy = testTexture(64, 64, 3);
		const r = compareImages(testTexture(64, 64, 4), noisy, { preset: 'tilemotif', wrap: true });
		expect(r.weights.motifs).toBe(0);
	});
});
