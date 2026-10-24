// Cable (FR7.5): the CPU side — editor defaults sized to the texture, plain defaults, stored layers loading, param
// ranges.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs, sanitizeLayer } from '../registry';
import { cableDerived, cableLayer } from './cable';

describe('cable', () => {
	ensureBuiltins();

	it('sizes a new layer’s rope to the texture', () => {
		const big = freshParams('cable', { width: 512, height: 512 });
		expect(big).toMatchObject({ thickness: 9, radius: 10.4, count: 5 });
		// Strands just touch round a core, with yarns about 6 px wide.
		expect(Number(big.radius) / Number(big.thickness)).toBeCloseTo(1.15, 1);
		expect(big.yarns).toBe(9);
		// Small textures keep a legible rope; a wide strip's rope follows its height and gets more turns.
		const small = freshParams('cable', { width: 32, height: 32 });
		expect(small.thickness).toBe(2.5);
		expect(Number(small.yarns)).toBeGreaterThanOrEqual(3);
		const strip = freshParams('cable', { width: 1024, height: 64 });
		expect(strip.thickness).toBe(2.5);
		expect(Number(strip.count)).toBeGreaterThan(Number(big.count));
	});

	it('is a laid rope out of the box that writes the Shape mask by Union', () => {
		const plain = createLayer('cable').params;
		expect(plain).toMatchObject({
			mk_target: 'Shape',
			mk_op: 'union',
			strands: 3,
			sink: 0.35,
			core: 0.6,
			irregular: 0.5
		});
		// The plain sizes are the editor's at 512 px.
		const fresh = freshParams('cable', { width: 512, height: 512 });
		for (const k of ['radius', 'thickness', 'count', 'yarns']) expect(plain[k], k).toBe(fresh[k]);
		// A stored cable from before the newer params still loads, with them at their defaults.
		const old = sanitizeLayer({
			id: 'ly1',
			type: 'cable',
			name: 'Rope',
			enabled: true,
			params: { axis: 'horizontal', pos: 0.29, count: 4, radius: 7, lean: 9, thickness: 3, strands: 1, back: 0.45 }
		});
		expect(old.params).toMatchObject({
			count: 4,
			radius: 7,
			lean: 9,
			thickness: 3,
			strands: 1,
			back: 0.45,
			angle: 0,
			sag: 0,
			start: 0,
			end: 1,
			rows: 1
		});
	});

	it('marks its lengths for supersampling, and has no `<< out`', () => {
		for (const k of ['radius', 'thickness', 'lean', 'sag'])
			expect(layerParamDefs('cable').find((d) => d.key === k)?.unit, k).toBe('px');
		// esbuild reads `<< out` as a TypeScript variance modifier (AGENTS.md).
		expect(cableLayer.glsl).not.toMatch(/<<\s*out\b/);
	});

	it('snaps its direction to one that closes on the torus when tiling (on the CPU)', () => {
		const base = createLayer('cable').params;
		for (const [width, height] of [
			[64, 64],
			[96, 96],
			[512, 512],
			[97, 61],
			[300, 200],
			[1, 1]
		])
			for (const axis of ['horizontal', 'vertical'])
				for (const angle of [0, 10, 26.6, 45, -60, 90, 170]) {
					const at = `${axis} ${angle}° ${width}×${height}`;
					const { frame, wrapU } = cableDerived({ ...base, axis, angle }, { width, height, tileable: true, seed: 0 });
					const [dx, dy, len, across] = frame;
					// One length along d is a whole number of tiles each way; the copies across fill the tile.
					for (const k of [(dx * len) / width, (dy * len) / height])
						expect(Math.abs(k - Math.round(k)), at).toBeLessThan(1e-6);
					expect(across * len, at).toBeCloseTo(width * height, 3);
					expect(Math.abs(wrapU), at).toBeLessThanOrEqual(len / 2 + 1e-6);
				}
		// Horizontal and vertical cables need no shift between copies; untiled, the angle is kept.
		expect(cableDerived(base, { width: 96, height: 64, tileable: true, seed: 0 }).wrapU).toBe(0);
		const [dx, dy] = cableDerived({ ...base, angle: 10 }, { width: 96, height: 64, tileable: false, seed: 0 }).frame;
		expect(Math.atan2(dy, dx) * (180 / Math.PI)).toBeCloseTo(10, 6);
	});
});
