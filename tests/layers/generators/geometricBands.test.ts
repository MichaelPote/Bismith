// Bands (FR7.2b): the editor's fresh layer stays within the params' ranges at every texture size, the Direction
// options map to frame rotations in 45° steps (the shader passes the option index straight to geo_frame), and a plain
// layer is the tech-wall look (staggered, varied Z steps between lower rails); the shader uses every param and has no
// continue.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs } from '@/layers/registry';
import { bandsDerived, bandsLayer } from '@/layers/generators/geometricBands';

ensureBuiltins();
const defs = new Map(layerParamDefs('bands').map((d) => [d.key, d]));

describe('bands', () => {
	it('sizes a fresh layer to the texture within the param ranges', () => {
		for (const [width, height] of [
			[16, 16],
			[64, 64],
			[512, 512],
			[2048, 2048],
			[256, 64],
			[64, 256],
			[1024, 32]
		]) {
			const p = freshParams('bands', { width, height });
			for (const [k, v] of Object.entries(p)) {
				const d = defs.get(k);
				expect(d, `${k} is a bands param`).toBeDefined();
				if (typeof v === 'number') {
					if (d!.min !== undefined) expect(v, `${k} at ${width}×${height}`).toBeGreaterThanOrEqual(d!.min);
					if (d!.max !== undefined) expect(v, `${k} at ${width}×${height}`).toBeLessThanOrEqual(d!.max);
				}
			}
			// The band and its margins fit a lane, leaving room for the rise.
			const lane = height / Number(p.rows);
			expect(Number(p.width) + Number(p.margin_top) + Number(p.margin_bottom)).toBeLessThan(lane);
		}
		expect(freshParams('bands', { width: 512, height: 512 })).toMatchObject({ rows: 3, count: 2, width: 32, rail: 17 });
		expect(freshParams('bands', { width: 256, height: 64 }).rows).toBe(1);
	});

	it('maps every Direction option to its rotation in 45° steps', () => {
		const opts = defs.get('orient')!.options!.map((o) => o.value);
		opts.forEach((v, i) => expect(Number(v)).toBe(i * 45));
		for (const v of ['0', '90', '180', '270']) expect(opts).toContain(v);
	});

	it('has no continue (ANGLE / D3D11 has miscompiled it in loops)', () => {
		expect(/\bcontinue\s*;/.test(bandsLayer.glsl!)).toBe(false);
	});

	it('makes the tech-wall look by default, the same as a fresh 512 px layer', () => {
		const p = createLayer('bands').params;
		expect(p).toMatchObject({
			mode: 'z',
			rail_h: 0.7,
			keep_angle: true,
			even: true,
			run_var: 0.5,
			rise_var: 0.6,
			stagger: 0.7,
			profile: 'custom',
			dif_src: 'random'
		});
		expect(p).toMatchObject({ width_var: 0, jitter: 0, jitter_piece: 0, skip: 0, amp: 1, fill: 'band', orient: '0' });
		const { r_src, s_src, ...sized } = freshParams('bands', { width: 512, height: 512 });
		expect(r_src).toBe('shape');
		expect(s_src).toBe('shape');
		expect(p).toMatchObject(sized);
	});

	it('counts whole periods on the torus, and how many through bars are told apart (on the CPU)', () => {
		const base = createLayer('bands').params;
		for (const [width, height] of [
			[64, 64],
			[96, 96],
			[512, 512],
			[97, 61],
			[300, 200],
			[1, 1]
		])
			for (const orient of ['0', '45', '90', '135'])
				for (const mirror of [false, true]) {
					const at = `${orient} ${width}×${height} ${mirror}`;
					const c = { width, height, tileable: true, seed: 0 };
					const [kx, ky] = bandsDerived({ ...base, orient, mirror }, c).k;
					expect(Number.isInteger(kx) && Number.isInteger(ky) && kx >= 1, at).toBe(true);
					if (mirror) expect(ky % 2, at).toBe(0);
				}
		// Diagonal bars at 45° through every lane (no margins) on a 96 px square: 2 repeats across, 3 lanes, a bar
		// advancing (96 / 3) / (96 / 2) → 1 repeat per lane: gcd(2, 3) = 1 bar told apart.
		const bars = { ...base, mode: 'diagonal', count: 2, rows: 3, angle: 45, margin_top: 0, margin_bottom: 0 };
		expect(bandsDerived(bars, { width: 96, height: 96, tileable: true, seed: 0 }).thr).toEqual([1, 1]);
		expect(
			bandsDerived({ ...bars, count: 4, rows: 2 }, { width: 96, height: 96, tileable: true, seed: 0 }).thr
		).toEqual([2, 4]);
		// Diagonal frames count per untiled span: a 45° frame on a 96 px square keeps Count across 96 / √2.
		const diag = bandsDerived(
			{ ...base, orient: '45', count: 4, rows: 3 },
			{ width: 96, height: 96, tileable: true, seed: 0 }
		);
		expect(diag.k).toEqual([4, 3]);
	});
});
