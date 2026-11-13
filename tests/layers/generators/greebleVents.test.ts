// Vents & pipes (FR7.2d): the CPU side — editor defaults sized to the texture, the plain defaults' look, the shape-mask
// writer rule, enum orders the shaders rely on, and px units for supersampling.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs } from '@/layers/registry';
import { pipesLayer, ventsLayer } from '@/layers/generators/greebleVents';

describe('vents & pipes', () => {
	ensureBuiltins();

	it('sizes a new vent to the texture: the plain grille at 64 px, a framed panel at 512 px', () => {
		expect(freshParams('vents', { width: 64, height: 64 })).toMatchObject({ cols: 2, rows: 8, width: 3, margin: 0 });
		const big = freshParams('vents', { width: 512, height: 512 });
		expect(big).toMatchObject({ cols: 4, rows: 18, width: 10, margin: 32, fasteners: 'corners' });
		expect(Number(big.clear)).toBeGreaterThan(0);
		expect(Number(big.outer)).toBeGreaterThan(0);
		expect(Number(big.round)).toBeGreaterThan(0);
		// Slots fill most of the cell, rims and the frame bevel grow with the texture.
		expect(Number(big.length)).toBeGreaterThan(80);
		expect(Number(big.rim)).toBeGreaterThan(1);
		expect(Number(big.bevel)).toBeGreaterThan(1);
		// A strip keeps whole cells along it.
		const strip = freshParams('vents', { width: 256, height: 16 });
		expect(Number(strip.rows)).toBeGreaterThanOrEqual(1);
		expect(Number(strip.cols)).toBeGreaterThanOrEqual(1);
	});

	it('writes the Shape mask from its relief by default, not when told None', () => {
		for (const def of [ventsLayer, pipesLayer]) {
			const relief = createLayer(def.type).params;
			expect(relief.mask, def.type).toBe(def.type === 'vents' ? 'plate' : 'all');
			expect(def.maskWrite!(relief), def.type).toBe('shape');
			expect(def.maskWrite!({ ...relief, mask: 'none' }), def.type).toBe(false);
		}
		expect(ventsLayer.maskWrite!({ ...createLayer('vents').params, mask: 'none', output: 'slots' })).toBe('shape');
	});

	it('sizes new pipes to the texture', () => {
		const small = freshParams('pipes', { width: 64, height: 64 });
		const big = freshParams('pipes', { width: 512, height: 512 });
		expect(small.count).toBe(3);
		expect(big.count).toBe(5);
		expect(Number(big.diameter)).toBeGreaterThan(40);
		expect(Number(big.clamp_foot)).toBeGreaterThan(0);
		// Clamps in proportion to the pipe, a jitter in proportion to the spacing, a joint per run.
		expect(Number(big.clamp_lip)).toBeGreaterThanOrEqual(Number(big.diameter) * 0.07);
		expect(Number(big.jitter)).toBeGreaterThan(0);
		expect(big.joints).toBe(1);
	});

	it('starts with the finished look: rims, long points, true-size pipes with joints, bolted feet, supports in line', () => {
		const v = createLayer('vents').params;
		expect(v).toMatchObject({
			depth: 1,
			tip: 1.5,
			fast_style: 'slotted',
			mask: 'plate',
			profile: 'smooth',
			h_amount: 1
		});
		expect(Number(v.rim)).toBeGreaterThan(0);
		const p = createLayer('pipes').params;
		expect(p).toMatchObject({
			scale: 'true',
			mask: 'all',
			bolts: true,
			joints: 1,
			lid: true,
			clamp_jitter: 0,
			clamp_seeded: true,
			clamp_rel: true,
			h_amount: 0.5
		});
		expect(Number(p.dia_var)).toBeGreaterThan(0);
		expect(Number(p.clamp_foot)).toBeGreaterThan(0);
	});

	it('keeps the enum orders the shaders index (new options appended)', () => {
		const opts = (type: string, key: string) =>
			layerParamDefs(type)
				.find((d) => d.key === key)!
				.options!.map((o) => o.value);
		expect(opts('vents', 'ends')).toEqual(['round', 'square', 'pointed', 'angled', 'hex']);
		expect(opts('vents', 'mode')).toEqual(['slots', 'louvers', 'holes', 'hoods']);
		expect(opts('vents', 'fasteners')).toEqual(['none', 'corners', 'sides']);
		expect(opts('vents', 'fast_style')).toEqual([
			'dome',
			'allen',
			'allen_sunk',
			'hex',
			'hex_sunk',
			'slotted',
			'cross',
			'hole'
		]);
		expect(opts('pipes', 'jog_angle')).toEqual(['90', '45', 'mixed']);
		expect(opts('vents', 'output')).toEqual(['relief', 'slots', 'plate', 'frame']);
		expect(opts('vents', 'mask')).toEqual(['none', 'plate', 'slots', 'frame']);
		// The shader reads the mask's part by its number: none, pipes, clamps, all.
		expect(opts('pipes', 'mask')).toEqual(['none', 'pipes', 'clamps', 'all']);
		expect(opts('pipes', 'scale')).toEqual(['unit', 'true']);
	});

	it('numbers each part the same in Output and the relief’s mask (one part pick in the shader)', () => {
		const opts = (type: string, key: string) =>
			layerParamDefs(type)
				.find((d) => d.key === key)!
				.options!.map((o) => o.value);
		for (const [type, mask] of [
			['greebles', 'mask'],
			['trim', 'mask_shape']
		]) {
			const out = opts(type, 'output');
			expect(opts(type, mask).slice(1, out.length), type).toEqual(out.slice(1));
		}
	});

	it('only sets known params in the editor defaults, and marks lengths as px', () => {
		for (const def of [ventsLayer, pipesLayer]) {
			const keys = new Set(layerParamDefs(def.type).map((d) => d.key));
			for (const k of Object.keys(def.fresh!({ width: 512, height: 512 })))
				expect(keys.has(k), `${def.type}.${k}`).toBe(true);
		}
		// (Exactly these: a new length has to be declared one way or the other.)
		const own = (def: typeof ventsLayer) =>
			def.params
				.filter((d) => d.unit === 'px')
				.map((d) => d.key)
				.sort();
		expect(own(ventsLayer)).toEqual(
			['length', 'width', 'rim', 'margin', 'clear', 'outer', 'round', 'fast_size'].sort()
		);
		expect(own(pipesLayer)).toEqual(
			['diameter', 'jitter', 'bundle_gap', 'clamp_width', 'clamp_lip', 'clamp_foot'].sort()
		);
	});
});
