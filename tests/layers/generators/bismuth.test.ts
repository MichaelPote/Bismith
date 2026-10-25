// Bismuth: the CPU side — editor defaults sized to the texture, supersampling units.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams } from '@/layers/registry';
import { bismuthLayer } from '@/layers/generators/bismuth';
import { FACE_TEMPLATES, faceTexture, growFace } from '@/layers/generators/bismuthGrowth';
import { mulberry32 } from '@/core/hash';

describe('bismuth', () => {
	ensureBuiltins();

	it('is registered and paints a metal and raises by default', () => {
		expect(createLayer('bismuth').params).toMatchObject({ dif_on: true, h_on: true, mt_on: true, mk_target: '' });
	});

	it('sizes a new layer’s terraces and height to the texture', () => {
		const small = freshParams('bismuth', { width: 64, height: 64 });
		const big = freshParams('bismuth', { width: 512, height: 512 });
		expect(Number(small.terraces)).toBeGreaterThanOrEqual(4);
		expect(Number(big.terraces)).toBeGreaterThan(Number(small.terraces));
		expect(Number(small.gens)).toBeLessThan(Number(big.gens));
		expect(Number(small.h_amount)).toBeLessThan(Number(big.h_amount));
	});

	it('scales its lengths with supersampling, not its counts', () => {
		const px = bismuthLayer.params.filter((d) => d.unit === 'px').map((d) => d.key);
		expect(px).toEqual(['soft']);
		expect(bismuthLayer.params.some((d) => d.perArea || d.perPx)).toBe(false);
	});

	describe('grown faces', () => {
		const n = 20;
		const faces = [0.12, 0.6].flatMap((turn) => [1, 2, 3].map((s) => growFace(n, turn, 0.1, 0.2, mulberry32(s))));
		const wall = (f: ReturnType<typeof growFace>, x: number, y: number, bit: number) =>
			(f.walls[y * n + x] & bit) !== 0;

		it('reaches every cell, levels rising one per turn at most', () => {
			for (const f of faces) {
				expect(f.maxLevel).toBeGreaterThan(8);
				for (let y = 0; y < n; y++)
					for (let x = 0; x < n; x++) {
						// Joined neighbours (no wall between) differ by at most one level: a facet steps, it never jumps.
						if (x < n - 1 && !wall(f, x, y, 1))
							expect(Math.abs(f.level[y * n + x] - f.level[y * n + x + 1])).toBeLessThanOrEqual(1);
						if (y < n - 1 && !wall(f, x, y, 2))
							expect(Math.abs(f.level[y * n + x] - f.level[(y + 1) * n + x])).toBeLessThanOrEqual(1);
					}
			}
		});

		it('walls the rim and joins the cells as a tree (n² − 1 openings)', () => {
			for (const f of faces) {
				let open = 0;
				for (let y = 0; y < n; y++) {
					expect(wall(f, n - 1, y, 1)).toBe(true);
					expect(wall(f, y, n - 1, 2)).toBe(true);
					for (let x = 0; x < n; x++)
						open += (x < n - 1 && !wall(f, x, y, 1) ? 1 : 0) + (y < n - 1 && !wall(f, x, y, 2) ? 1 : 0);
				}
				expect(open).toBe(n * n - 1);
			}
		});

		it('packs the templates side by side', () => {
			const t = faceTexture(n, 0.12, 0.1, 0.2, 7);
			expect([t.width, t.height]).toEqual([n * FACE_TEMPLATES, n]);
		});
	});
});
