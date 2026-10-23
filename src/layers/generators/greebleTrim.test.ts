import { describe, expect, it } from 'vitest';
import type { ParamValues } from '@/core/params';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs } from '../registry';
import { BAND_PROFILES, trimFresh, trimLayer } from './greebleTrim';

ensureBuiltins();

const options = (key: string) => trimLayer.params.find((d) => d.key === key)!.options!.map((o) => o.value);

describe('trim strip', () => {
	it('keeps the stored option order (the uniforms are option indices) and only appends', () => {
		expect(BAND_PROFILES.slice(0, 8).map(([v]) => v)).toEqual([
			'flat',
			'bead',
			'cove',
			'ridge',
			'groove',
			'step',
			'ramp_in',
			'ramp_out'
		]);
		expect(BAND_PROFILES.slice(8).map(([v]) => v)).toEqual([
			'round_in',
			'round_out',
			'ogee_in',
			'ogee_out',
			'cove_in',
			'cove_out'
		]);
		expect(options('output').slice(0, 5)).toEqual(['relief', 'blocks', 'dividers', 'elements', 'band']);
		expect(options('elem').slice(0, 7)).toEqual(['none', 'rivet', 'bolt', 'slot', 'vslot', 'hole', 'square']);
		expect(options('div_style')).toEqual(['groove', 'seam', 'bar']);
	});

	it('has the designed moulding as its plain defaults: fitted, joined bands; framed plates; seated rivets in band units', () => {
		const p = createLayer('trim').params;
		expect(p).toMatchObject({
			mask_shape: 'strip',
			band_fit: true,
			band_chain: true,
			div_prof: 'v',
			div_return: true,
			elem_layout: 'block',
			elem_fit: true,
			elem_ref: 'face'
		});
		expect(p).toMatchObject({ band1: 2, band2: 4, band3: 2, band4: 8, prof3: 'cove_in', fill: 4 });
		expect(p.look).toBeUndefined();
		// The heads fit under the relief's ceiling above the face.
		expect(Number(p.level4) + Number(p.elem_height)).toBeLessThanOrEqual(1);
	});

	it('sizes a new layer to the texture: one strip on a trim texture, a stacked sheet on a big one, vertical when tall', () => {
		const trim = trimFresh({ width: 256, height: 16 });
		expect(trim).toMatchObject({ orient: 'horizontal', strips: 1, bevel: 1, div_width: 1 });
		const sheet = trimFresh({ width: 512, height: 512 });
		expect(sheet).toMatchObject({ strips: 8, bevel: 3, div_width: 3 });
		expect(trimFresh({ width: 16, height: 256 })).toMatchObject({ orient: 'vertical', strips: 1 });
		expect(trimFresh({ width: 2048, height: 2048 }).strips).toBe(32);
		// Plates about three strip heights long, a whole number per tile.
		expect(sheet.div_count).toBe(3);
		expect(freshParams('trim', { width: 512, height: 512 })).toMatchObject({ r_src: 'shape', strips: 8 });
	});

	it('declares pixel lengths in px (supersampling scales them) and has generous slider ranges', () => {
		const defs = new Map(layerParamDefs('trim').map((d) => [d.key, d]));
		// (Exactly these: a new length has to be declared one way or the other.)
		const bands = [1, 2, 3, 4, 5, 6].map((n) => `band${n}`);
		const own = trimLayer.params.filter((d) => d.unit === 'px').map((d) => d.key);
		expect(own.sort()).toEqual(
			[
				...bands,
				'strip_h',
				'div_width',
				'div_inset',
				'elem_pitch',
				'elem_inset',
				'elem_size',
				'elem_len',
				'elem_row_gap',
				'elem_clear'
			].sort()
		);
		// Lengths along or across the strips scale with that side alone.
		const axis = (k: string, p: ParamValues) => {
			const a = defs.get(k)!.axis;
			return typeof a === 'function' ? a(p) : a;
		};
		expect(axis('band1', { orient: 'horizontal' })).toBe('y');
		expect(axis('elem_len', { orient: 'horizontal', elem: 'slot' })).toBe('x');
		expect(axis('elem_len', { orient: 'horizontal', elem: 'vslot' })).toBe('y');
		expect(defs.get('band1')!.softMax).toBeGreaterThanOrEqual(64);
		expect(defs.get('elem_size')!.softMax).toBeGreaterThanOrEqual(24);
		expect(defs.get('strip_h')!.max).toBeGreaterThanOrEqual(2048);
	});
});
