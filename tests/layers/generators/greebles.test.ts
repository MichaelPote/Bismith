// Greebles (FR7.2d): the CPU side — plain defaults, editor defaults sized to the texture, the pinwheel root's
// table and the param table the shader reads.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs } from '@/layers/registry';
import { greeblesLayer, WINDMILL } from '@/layers/generators/greebles';

describe('greebles', () => {
	ensureBuiltins();

	it('has the full look as its plain defaults (a 128 px texture), with the editor only scaling the sizes', () => {
		const plain = createLayer('greebles').params;
		expect(plain).toMatchObject({
			mask: 'plates',
			root: 'pinwheel',
			depth: 16,
			cluster: 0.45,
			pinwheel: 0.3,
			seam_taper: 0.5,
			frame_style: 'mixed',
			rivets: 'mixed',
			det_holes: true,
			det_ribs: true,
			det_pipes: true,
			hero: 0.6,
			small_parts: 0.5,
			light_style: 'mixed',
			// The machine-panel look: straight seams, no 45° cuts, only the final panels drawn, a backing plate in the cut corners.
			jog: 0,
			diag: 0,
			seamless: 1,
			fill: 'backing',
			beams: 0
		});
		// At 128 px the editor's sizes are the plain ones.
		const at128 = freshParams('greebles', { width: 128, height: 128 });
		for (const [k, v] of Object.entries(at128)) if (!['r_src', 's_src'].includes(k)) expect(plain[k], k).toEqual(v);
	});

	it('sizes a new layer to the texture', () => {
		const at = (n: number) => freshParams('greebles', { width: n, height: n });
		const big = at(512);
		expect(big).toMatchObject({ min_size: 28, max_size: 160, gap: 3, rivet_radius: 3, vent_pitch: 8, vent_slot: 4 });
		expect(Number(at(2048).max_size)).toBe(640);
		for (const n of [16, 32, 64, 128, 512, 2048]) {
			const p = at(n);
			// Whole-px seams, frame lines and housings, and a bevel of at least a pixel.
			for (const k of [
				'gap',
				'frame_width',
				'light_rim',
				'min_size',
				'max_size',
				'snap',
				'frame_min',
				'rivet_min',
				'det_min'
			])
				expect(Number.isInteger(p[k]), `${n}: ${k}`).toBe(true);
			expect(Number(p.bevel), `${n}`).toBeGreaterThanOrEqual(1);
			expect(Number(p.max_size), `${n}`).toBeGreaterThan(2 * Number(p.min_size));
			// Rivets sit outside the inset frame; the smallest panels stay plain.
			expect(Number(p.rivet_inset) + Number(p.rivet_radius), `${n}`).toBeLessThanOrEqual(Number(p.frame_inset));
			for (const k of ['frame_min', 'rivet_min', 'det_min'])
				expect(Number(p[k]), `${n}: ${k}`).toBeGreaterThan(Number(p.min_size));
		}
		// Only known params, within their hard limits.
		const defs = new Map(layerParamDefs('greebles').map((d) => [d.key, d]));
		for (const [k, v] of Object.entries(big)) {
			const d = defs.get(k);
			expect(d, k).toBeDefined();
			if (typeof v === 'number') {
				expect(v, k).toBeGreaterThanOrEqual(d!.min ?? -Infinity);
				expect(v, k).toBeLessThanOrEqual(d!.max ?? Infinity);
			}
			if (d!.type === 'enum')
				expect(
					d!.options!.map((o) => o.value),
					k
				).toContain(v);
		}
	});

	it('has a pinwheel root that covers the tile once, with no seam straight across it', () => {
		const { cells, rects } = WINDMILL;
		const owner: number[] = Array(25).fill(-1);
		rects.forEach(([x0, y0, x1, y1], k) => {
			for (let x = x0; x < x1; x++)
				for (let y = y0; y < y1; y++) {
					const i = (y % 5) * 5 + (x % 5);
					expect(owner[i], `cell ${i}`).toBe(-1);
					owner[i] = k;
				}
		});
		expect(owner).toEqual(cells);
		expect(rects.filter(([x0, y0, x1, y1]) => x1 - x0 === 1 && y1 - y0 === 1)).toHaveLength(5);
		// Every grid line, both ways, passes through some piece.
		for (let l = 0; l < 5; l++) {
			expect(
				[0, 1, 2, 3, 4].some((t) => cells[t * 5 + l] === cells[t * 5 + ((l + 4) % 5)]),
				`x = ${l}`
			).toBe(true);
			expect(
				[0, 1, 2, 3, 4].some((t) => cells[l * 5 + t] === cells[((l + 4) % 5) * 5 + t]),
				`y = ${l}`
			).toBe(true);
		}
	});

	it('marks pixel lengths for supersampling', () => {
		const px = [
			'min_size',
			'max_size',
			'snap',
			'gap',
			'round',
			'frame_inset',
			'frame_width',
			'frame_min',
			'rivet_min',
			'det_min',
			'rivet_radius',
			'rivet_inset',
			'rivet_spacing',
			'vent_pitch',
			'vent_slot',
			'light_size',
			'light_rim',
			'recess_wall',
			'pipe_min',
			'shape_min',
			'beam_width',
			'edge_min',
			'edge_width',
			'chan_width',
			'chan_bend',
			'tube_big',
			'tube_thin',
			'clamp_space',
			'frame_bevel',
			'pocket_max',
			'det_cell',
			'px_scale'
		];
		// (Exactly these: a new length has to be declared one way or the other.)
		const own = greeblesLayer.params.filter((d) => d.unit === 'px').map((d) => d.key);
		expect(own.sort()).toEqual(px.sort());
	});

	it('writes the plate tops to the Shape mask from the relief, unless told None', () => {
		const relief = createLayer('greebles').params;
		expect(greeblesLayer.maskWrite!(relief)).toBe('shape');
		expect(greeblesLayer.maskWrite!({ ...relief, mask: 'none' })).toBe(false);
		expect(greeblesLayer.maskWrite!({ ...relief, mask: 'none', output: 'rivets' })).toBe('shape');
		expect(greeblesLayer.glsl).toMatch(/u_mask == 0\) return genOut\([^;]*NO_SDF\)/);
		expect(greeblesLayer.glsl).toMatch(/max\(dP, -D\.dHole\)/);
	});
});
