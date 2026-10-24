// Pattern layers (FR2.4): the CPU side — the defaults (the finished looks), editor defaults sized to the texture,
// and which outputs have a shape.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, linkedChanges } from '@/layers/registry';
import { bricksLayer, stripesDerived, stripesLayer, voronoiLayer } from '@/layers/generators/patterns';

describe('pattern layers', () => {
	ensureBuiltins();

	it('lay every joint as set by default (Joint variation off)', () => {
		expect(bricksLayer.params.find((d) => d.key === 'joint_var')!.default).toBe(0);
	});

	it('default to the finished looks: weathered bricks, hand-set tiles, cobbles, soft value edges', () => {
		expect(createLayer('bricks').params).toMatchObject({
			rows: 12,
			mortar_level: 0.2,
			crease: true,
			close: true,
			chips: 0.4,
			chip_dust: 0.45,
			face: 0.35,
			face_tilt: 0.5,
			h_var: 0.3,
			len_var: 0.25,
			min_size: 0.5
		});
		expect(createLayer('hex').params).toMatchObject({
			round_bevel: true,
			grout_level: 0.2,
			crown: 1.2,
			chips: 0.3,
			chip_size: 0.25
		});
		expect(createLayer('voronoi').params).toMatchObject({
			size_var: 0.5,
			round_bevel: true,
			min_bevel: 0.5,
			grout_level: 0.2,
			facet_fit: true,
			crack_var: 0.6,
			crack_scale: 0.6,
			crack_tone: 0.7,
			h_mode: 'add'
		});
		expect(createLayer('grid').params).toMatchObject({ snap: true, profile: 'smooth' });
		expect(createLayer('stripes').params).toMatchObject({
			fit_bevel: true,
			soft: 3,
			soft_profile: 'smooth',
			profile: 'smooth'
		});
	});

	it('start a new brick wall at about 3:1 bricks with relief sized to the courses', () => {
		const big = freshParams('bricks', { width: 512, height: 512 });
		expect(big.rows).toBe(12);
		expect(Number(big.rows) % 2).toBe(0);
		const course = 512 / Number(big.rows);
		expect(512 / Number(big.columns) / course).toBeCloseTo(3, 0);
		expect(Number(big.bevel)).toBeCloseTo(course * 0.2, 0);
		expect(Number(big.wobble)).toBeGreaterThan(0);
		// Small textures get proportionally small (but not zero) bevels; wide ones keep the bricks' proportions.
		const small = freshParams('bricks', { width: 64, height: 64 });
		expect(Number(small.bevel)).toBeGreaterThanOrEqual(1);
		expect(Number(small.bevel)).toBeLessThan(Number(big.bevel));
		const wide = freshParams('bricks', { width: 1024, height: 256 });
		expect(Number(wide.rows) % 2).toBe(0);
		expect(1024 / Number(wide.columns) / (256 / Number(wide.rows))).toBeGreaterThan(2);
	});

	it('size the other new layers’ bevels to their features', () => {
		for (const type of ['hex', 'voronoi', 'stripes']) {
			const small = Number(freshParams(type, { width: 64, height: 64 }).bevel);
			const big = Number(freshParams(type, { width: 1024, height: 1024 }).bevel);
			expect(small, type).toBeGreaterThanOrEqual(1);
			expect(big, type).toBeGreaterThan(small);
		}
		// Grid lines: grooves, not ink lines — 5 px with a 1.8 px bevel (a flat floor) at 512, thinner on small textures.
		expect(freshParams('grid', { width: 512, height: 512 })).toMatchObject({ width: 5, bevel: 1.8 });
		expect(Number(freshParams('grid', { width: 64, height: 64 }).width)).toBe(1);
	});

	it('cuts Voronoi crackle in as grooves, and switches back for the other outputs', () => {
		expect(createLayer('voronoi', { output: 'crackle' }).params.h_mode).toBe('subtract');
		expect(createLayer('voronoi', { output: 'crackle', h_mode: 'max' }).params.h_mode).toBe('max');
		const crackle = createLayer('voronoi', { output: 'crackle' }).params;
		expect(linkedChanges('voronoi', crackle, 'output', 'cells').h_mode).toBe('add');
	});

	it('paint shape stripes by their shape, so their bevels don’t frame them in dark', () => {
		expect(createLayer('stripes', { mode: 'shape' }).params.dif_src).toBe('shape');
		expect(createLayer('stripes', { mode: 'sine' }).params.dif_src).toBe('value');
	});

	it('offer their shape and Edge only for the outputs that have a shape', () => {
		expect(stripesLayer.sdfShowIf!({ mode: 'sine' })).toBe(false);
		expect(stripesLayer.sdfShowIf!({ mode: 'shape' })).toBe(true);
		expect(voronoiLayer.sdfShowIf!({ output: 'facets' })).toBe(false);
		expect(voronoiLayer.sdfShowIf!({ output: 'cells' })).toBe(true);
	});

	it('snap Stripes to whole cycles across each axis on the CPU when tiling', () => {
		const c = (width: number, height: number, tileable = true) => ({ width, height, tileable, seed: 0 });
		const s = (count: number, angle: number, cv = c(96, 96)) => stripesDerived({ count, angle }, cv);
		// 12 at 45° crosses each edge 8 times; the stripes then repeat every 8.
		const d = s(12, 45);
		expect(d.k[0] * 96).toBeCloseTo(-8, 6);
		expect(d.k[1] * 96).toBeCloseTo(8, 6);
		expect(d.g).toBe(8);
		// Horizontal on a 96 × 64 tile: 8 per width is 5.33 down, rounded to 5.
		expect(s(8, 0, c(96, 64)).k[1] * 64).toBeCloseTo(5, 6);
		expect(s(8, 0, c(96, 64)).g).toBe(5);
		// Too few to cross an edge: one cycle down.
		expect(s(0.25, 10).k[1] * 96).toBeCloseTo(1, 6);
		// Not tiling: the plain normal, count per width.
		const f = s(8, 30, c(96, 64, false));
		expect(f.k[0] * 96).toBeCloseTo(-4, 5);
		expect(f.k[1] * 96).toBeCloseTo(8 * Math.cos(Math.PI / 6), 5);
		expect(stripesLayer.glsl).not.toMatch(/igcd|u_count|u_angle/);
	});
});
