// Rosette and Glyph (FR7.2c): the CPU side — editor defaults sized to the texture, the bevel that follows the line
// widths, the outputs that switch the channels, and param ranges.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, linkedChanges } from '../registry';
import { glyphBevel, rosetteBevel } from './motifRadial';

describe('rosette and glyph', () => {
	ensureBuiltins();

	it('builds the medallion and the connected emblem from the plain defaults', () => {
		// Layers built in code get the same design as new ones, at the plain size (the bevel linked to the widths).
		expect(createLayer('rosette').params).toMatchObject({
			radius: 28,
			bevel: 1,
			relief: 'sculpted',
			hub: 0.1,
			dots: 24,
			star_r: 0.77,
			glow_soft: 0.6,
			e_on: false
		});
		expect(createLayer('glyph').params).toMatchObject({
			size: 32,
			width: 2,
			bevel: 1,
			centre: true,
			connect: 0.85,
			overlap: 0.3,
			dot_joins: false,
			cap: 'round'
		});
		expect(createLayer('glyph', { style: 'blocks' }).params.bevel).toBe(1);
	});

	it('sizes a new layer to the texture', () => {
		const r = freshParams('rosette', { width: 512, height: 512 });
		expect(Number(r.radius)).toBeCloseTo(204.8, 1);
		expect(Number(r.ring_w)).toBeCloseTo(7.2, 1);
		const small = freshParams('rosette', { width: 16, height: 16 });
		expect(Number(small.ring_w)).toBeGreaterThanOrEqual(1);
		// A wide texture follows its short side.
		expect(Number(freshParams('rosette', { width: 1024, height: 64 }).radius)).toBeCloseTo(25.6, 1);
		const g = freshParams('glyph', { width: 512, height: 512 });
		expect(g).toMatchObject({ size: 230.4, width: 13 });
		expect(Number(freshParams('glyph', { width: 16, height: 16 }).width)).toBe(1);
		// The fresh layer's bevel follows its widths (half the line: domed).
		expect(createLayer('rosette', r).params.bevel).toBe(3.6);
		expect(createLayer('glyph', g).params.bevel).toBe(6.5);
	});

	it('moves the bevel with the line width until it is set by hand', () => {
		const g = createLayer('glyph').params;
		expect(linkedChanges('glyph', g, 'width', 8)).toEqual({ width: 8, bevel: 4 });
		expect(linkedChanges('glyph', { ...g, bevel: 2 }, 'width', 8)).toEqual({ width: 8 });
		// The pen's strokes end as the pen leaves them, unless the ends were set by hand.
		expect(linkedChanges('glyph', g, 'pen', 1)).toEqual({ pen: 1, cap: 'pen' });
		expect(linkedChanges('glyph', { ...g, cap: 'square' }, 'pen', 1)).toEqual({ pen: 1 });
		// Blocks: about an eighth of a cell.
		expect(glyphBevel({ style: 'blocks', size: 320, rows: 8 })).toBe(4.8);
		const r = createLayer('rosette').params;
		expect(linkedChanges('rosette', r, 'ring_w', 6)).toEqual({ ring_w: 6 }); // the star lines (2 px) stay the narrowest
		expect(linkedChanges('rosette', { ...r, star_w: 6 }, 'ring_w', 6)).toEqual({ ring_w: 6, bevel: 3 });
		// Graded rings: the innermost counts; filled elements alone: a fiftieth of the radius.
		expect(rosetteBevel({ rings: 3, ring_w: 10, ring_w_in: 0.4, radius: 100 })).toBe(2);
		expect(rosetteBevel({ star: 8, star_mode: 'filled', radius: 100 })).toBe(2);
	});

	it('turns the glow and radial outputs into light, and back', () => {
		const r = createLayer('rosette').params;
		for (const output of ['glow', 'radial']) {
			const ch = linkedChanges('rosette', r, 'output', output);
			expect(ch, output).toMatchObject({ dif_on: false, h_on: false, e_on: true });
			expect(linkedChanges('rosette', { ...r, ...ch }, 'output', 'shape')).toMatchObject({
				dif_on: true,
				h_on: true,
				e_on: false
			});
		}
		// Set explicitly (the glowing-disc template does), they stay.
		expect(createLayer('rosette', { output: 'glow', dif_on: true, h_on: true }).params).toMatchObject({
			dif_on: true,
			h_on: true,
			e_on: true
		});
	});
});
