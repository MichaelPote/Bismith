import { describe, expect, it } from 'vitest';
import { createLayer, createProject, normalizeProject, projectFromJSON, projectToJSON } from '@/core/serialize';
import {
	activeVariant,
	addVariant,
	copyItemSettings,
	deleteVariant,
	extractSettings,
	forEachVariant,
	makeBase,
	makeBaseValue,
	materialise,
	moveVariant,
	renameVariant,
	resetToBase,
	resetVariant,
	switchVariant,
	syncVariants,
	variantSettings,
	variantsOf
} from '@/core/variants';
import { resizeProject } from '@/core/pixelScale';
import type { Project } from '@/core/project';

function bricks(): Project {
	return createProject({
		width: 64,
		height: 64,
		layers: [createLayer('bricks', {}, 'Bricks'), createLayer('noise', {}, 'Grime')]
	});
}

const key = (p: Project, i: number, param: string) => `layer.${p.layers[i].id}.p.${param}`;

describe('variants: settings', () => {
	it('round-trips every per-variant setting and leaves structure out', () => {
		const p = bricks();
		const s = extractSettings(p);
		expect(s[`layer.${p.layers[0].id}.on`]).toBe(true);
		expect(s['base.roughness']).toBe(p.base.roughness);
		expect(s['render.ao']).toBe(p.render.ao);
		expect('render.maxSamples' in s).toBe(false);
		expect('width' in s).toBe(false);
	});
});

describe('variants: editing', () => {
	it('keeps a variant’s own settings and lets the others follow the base', () => {
		const p = bricks();
		const dry = variantsOf(p).baseId;
		const wet = addVariant(p, undefined, 'Wet');
		p.base.roughness = 0.2;
		p.layers[0].enabled = false;
		syncVariants(p);
		expect(Object.keys(activeVariant(p).changes).sort()).toEqual(
			['base.roughness', `layer.${p.layers[0].id}.on`].sort()
		);

		switchVariant(p, dry);
		expect(p.base.roughness).toBe(0.75);
		expect(p.layers[0].enabled).toBe(true);
		// A base edit reaches the variant unless it changes that setting.
		p.base.roughness = 0.9;
		p.base.metalness = 0.5;
		switchVariant(p, wet.id);
		expect([p.base.roughness, p.base.metalness]).toEqual([0.2, 0.5]);
	});

	it('drops a change set back to the base value', () => {
		const p = bricks();
		addVariant(p);
		p.base.roughness = 0.2;
		syncVariants(p);
		p.base.roughness = 0.75;
		syncVariants(p);
		expect(activeVariant(p).changes).toEqual({});
	});

	it('adds a layer made on a variant to every variant, and removing one drops its changes', () => {
		const p = bricks();
		const dry = variantsOf(p).baseId;
		const wet = addVariant(p);
		p.layers.push(createLayer('noise', { scale: 9 }, 'Moss'));
		syncVariants(p);
		switchVariant(p, dry);
		expect(p.layers.at(-1)!.params.scale).toBe(9);
		switchVariant(p, wet.id);
		p.layers[0].params.mortar = 0.3;
		syncVariants(p);
		const id = p.layers[0].id;
		p.layers.splice(0, 1);
		syncVariants(p);
		expect(Object.keys(wet.changes).some((k) => k.includes(id))).toBe(false);
		expect(Object.keys(variantsOf(p).baseValues!).some((k) => k.includes(id))).toBe(false);
	});

	it('resets one setting or a whole variant to the base, and promotes a value to the base', () => {
		const p = bricks();
		const dry = variantsOf(p).baseId;
		addVariant(p);
		p.base.roughness = 0.2;
		p.base.metalness = 0.4;
		syncVariants(p);
		resetToBase(p, 'base.roughness');
		expect(p.base.roughness).toBe(0.75);
		makeBaseValue(p, 'base.metalness');
		expect(activeVariant(p).changes).toEqual({});
		expect(variantSettings(p, dry)['base.metalness']).toBe(0.4);
		p.seed = 7;
		resetVariant(p, activeVariant(p).id);
		expect(p.seed).toBe(1);
	});

	it('makes another variant the base, first in the list, without changing any variant’s look', () => {
		const p = bricks();
		const dry = variantsOf(p).baseId;
		const wet = addVariant(p);
		p.base.roughness = 0.2;
		const soot = addVariant(p, dry);
		p.seed = 9;
		syncVariants(p);
		const looks = () => Object.fromEntries(variantsOf(p).list.map((v) => [v.id, variantSettings(p, v.id)]));
		const before = looks();
		makeBase(p, wet.id);
		expect(variantsOf(p).baseId).toBe(wet.id);
		expect(variantsOf(p).list.map((v) => v.id)).toEqual([wet.id, dry, soot.id]);
		expect(looks()).toEqual(before);
		expect(variantsOf(p).list.find((v) => v.id === dry)!.changes).toEqual({ 'base.roughness': 0.75 });
		expect(soot.changes).toEqual({ seed: 9, 'base.roughness': 0.75 });
	});

	it('keeps the base first when reordering: a variant moved to the top becomes the base', () => {
		const p = bricks();
		const dry = variantsOf(p).baseId;
		const wet = addVariant(p);
		p.base.roughness = 0.2;
		const soot = addVariant(p);
		syncVariants(p);
		const ids = () => variantsOf(p).list.map((v) => v.id);
		moveVariant(p, dry, 2);
		expect(ids()).toEqual([dry, wet.id, soot.id]);
		moveVariant(p, soot.id, 1);
		expect(ids()).toEqual([dry, soot.id, wet.id]);
		moveVariant(p, wet.id, 0);
		expect(ids()).toEqual([wet.id, dry, soot.id]);
		expect(variantsOf(p).baseId).toBe(wet.id);
		expect(variantsOf(p).list.find((v) => v.id === dry)!.changes).toEqual({ 'base.roughness': 0.75 });
	});

	it('deletes a variant (never the base), showing the base when it was shown', () => {
		const p = bricks();
		const dry = variantsOf(p).baseId;
		const wet = addVariant(p);
		p.seed = 5;
		expect(deleteVariant(p, dry)).toBe(false);
		expect(deleteVariant(p, wet.id)).toBe(true);
		expect(variantsOf(p).activeId).toBe(dry);
		expect(p.seed).toBe(1);
	});

	it('copies each variant’s settings to a duplicated layer', () => {
		const p = bricks();
		const dry = variantsOf(p).baseId;
		addVariant(p);
		p.layers[0].params.mortar = 0.3;
		syncVariants(p);
		const copy = { ...JSON.parse(JSON.stringify(p.layers[0])), id: 'ly_copy' };
		p.layers.splice(1, 0, copy);
		copyItemSettings(p, `layer.${p.layers[0].id}`, 'layer.ly_copy');
		syncVariants(p);
		expect(materialise(p, dry).layers[1].params.mortar).toBe(materialise(p, dry).layers[0].params.mortar);
		expect(p.layers[1].params.mortar).toBe(0.3);
	});

	it('runs a structural edit on every variant', () => {
		const p = bricks();
		const dry = variantsOf(p).baseId;
		addVariant(p);
		const k = key(p, 0, 'mortar');
		p.layers[0].params.mortar = 4;
		syncVariants(p);
		const dryMortar = Number(variantSettings(p, dry)[k]);
		forEachVariant(p, (q) => Object.assign(q, resizeProject(q, 128, 128)));
		expect(p.width).toBe(128);
		expect(Number(p.layers[0].params.mortar)).toBeCloseTo(8);
		expect(Number(variantSettings(p, dry)[k])).toBeCloseTo(dryMortar * 2);
	});
});

describe('variants: files', () => {
	it('writes the base at the top level and reads the active variant back', () => {
		const p = bricks();
		const wet = addVariant(p, undefined, 'Wet');
		p.base.roughness = 0.2;
		const file = JSON.parse(projectToJSON(p));
		expect(file.version).toBe(2);
		expect(file.base.roughness).toBe(0.75);
		expect(file.variants.active).toBe(wet.id);
		expect(file.variants.list[0].changes).toEqual({ 'base.roughness': 0.2 });
		const q = projectFromJSON(projectToJSON(p));
		expect(q.base.roughness).toBe(0.2);
		expect(activeVariant(q).name).toBe('Wet');
		syncVariants(p);
		expect(JSON.stringify(normalizeProject(p))).toBe(JSON.stringify(p));
	});

	it('names a lone variant after the project until it is renamed or read from a file with variants', () => {
		const p = bricks();
		p.name = 'Wall';
		expect(variantsOf(p).list[0].name).toBe('Wall');
		const v = addVariant(p);
		deleteVariant(p, v.id);
		p.name = 'Old wall';
		syncVariants(p);
		expect(variantsOf(p).list[0].name).toBe('Old wall');
		// Saved alone and unnamed, it writes no block and goes on following the project.
		const q = projectFromJSON(projectToJSON(p));
		expect(q.variants).toBeUndefined();
		expect(variantsOf(normalizeProject(p)).list[0].auto).toBe(true);
		// A second variant keeps it as it is; a file with variants keeps its names.
		addVariant(p);
		p.name = 'Wall';
		syncVariants(p);
		expect(variantsOf(p).list[0].name).toBe('Old wall');
		const r = projectFromJSON(projectToJSON(p));
		deleteVariant(r, variantsOf(r).list[1].id);
		r.name = 'Renamed';
		syncVariants(r);
		expect(variantsOf(r).list[0].name).toBe('Old wall');
		// Renamed by the user: never follows.
		const s = bricks();
		renameVariant(s, variantsOf(s).baseId, 'Dry');
		s.name = 'Wall';
		syncVariants(s);
		expect(variantsOf(s).list[0].name).toBe('Dry');
	});

	it('loads a file without variants as one, and drops changes it can’t use', () => {
		const p = projectFromJSON(projectToJSON(bricks()));
		expect(p.variants).toBeUndefined();
		const file = JSON.parse(projectToJSON(bricks()));
		file.variants = {
			base: { id: 'a', name: 'Dry' },
			active: 'b',
			list: [{ id: 'b', name: 'Dry', changes: { 'layer.gone.p.scale': 3, 'base.roughness': 9, seed: 1 } }]
		};
		const q = normalizeProject(file);
		expect(variantsOf(q).list.map((v) => v.name)).toEqual(['Dry', 'Dry 2']);
		// Clamped like the base; equal to the base (the seed) or for a missing layer: dropped.
		expect(activeVariant(q).changes).toEqual({ 'base.roughness': 1 });
	});
});
