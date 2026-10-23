// Tread plate and Weave (FR7.2b): the CPU side — param ranges and option order, defaults, style-linked proportions,
// and params the shader uses.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, layerParamDefs, linkedChanges } from '../registry';
import { treadplateLayer, weaveLayer } from './geometricSurface';

const tex = { width: 512, height: 512 };

function freshKnown(type: string) {
	const defs = new Map(layerParamDefs(type).map((d) => [d.key, d]));
	for (const [k, v] of Object.entries(freshParams(type, tex))) {
		const d = defs.get(k);
		expect(d, `${type}: fresh sets unknown ${k}`).toBeDefined();
		if (d!.type === 'enum')
			expect(
				d!.options!.map((o) => o.value),
				k
			).toContain(v);
	}
}

describe('treadplate', () => {
	ensureBuiltins();

	it('keeps the option order', () => {
		const opts = (k: string) => treadplateLayer.params.find((d) => d.key === k)!.options!.map((o) => o.value);
		expect(opts('style').slice(0, 4)).toEqual(['lozenge', 'capsule', 'bars', 'stud']);
		expect(opts('layout').slice(0, 4)).toEqual(['checker', 'rows', 'cols', 'same']);
	});

	it('starts as domed, ridged, glinting diamond plate', () => {
		const l = createLayer('treadplate');
		expect(l.params).toMatchObject({
			layout: 'herringbone',
			crown: 1,
			crest: 0.5,
			r_on: true,
			s_on: true,
			r_src: 'value'
		});
		expect(Number(l.params.h_var)).toBeLessThan(0.1); // rolled plate: lugs nearly level
		// The plain defaults are the lozenge style's own look.
		expect(l.params).toMatchObject(treadplateLayer.linkedDefaults!({ style: 'lozenge' }));
		// In the editor, roughness and specular follow the relief rather than the registry's shape source.
		freshKnown('treadplate');
		expect(freshParams('treadplate', tex)).toMatchObject({ r_src: 'value', s_src: 'value' });
	});

	it('switches arrangement and proportions with the style, keeping what the user set', () => {
		const base = createLayer('treadplate').params;
		const bars = linkedChanges('treadplate', base, 'style', 'bars');
		expect(bars).toMatchObject({ layout: 'checker', angle: 0, width: 0.5 });
		const user = { ...base, ...bars, width: 0.4 };
		const back = linkedChanges('treadplate', user, 'style', 'lozenge');
		expect(back.angle).toBe(45);
		expect(back.width).toBeUndefined();
		// A recipe that sets the style and its arrangement keeps them.
		const set = createLayer('treadplate', { style: 'bars', layout: 'checker', angle: 45, length: 0.8, width: 0.26 });
		expect(set.params).toMatchObject({ layout: 'checker', angle: 45, length: 0.8, width: 0.26 });
	});
});

describe('weave', () => {
	ensureBuiltins();

	it('keeps the option order', () => {
		const opts = (k: string) => weaveLayer.params.find((d) => d.key === k)!.options!.map((o) => o.value);
		expect(opts('pattern').slice(0, 7)).toEqual(['plain', 'twill', 'twill21', 'twill31', 'basket', 'satin', 'lattice']);
		expect(opts('rnd_mode').slice(0, 3)).toEqual(['random', 'class', 'class_random']);
	});

	it('starts with arched floats, rounded strands, lower under-runs and a tone per strand', () => {
		expect(createLayer('weave').params).toMatchObject({
			arch: 0.6,
			crown: 0.6,
			under: 0.5,
			run_on: 0,
			rnd_mode: 'strand',
			profile: 'round',
			dif_src: 'value'
		});
		freshKnown('weave');
	});
});
