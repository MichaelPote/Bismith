import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createProject } from '@/core/serialize';
import type { Layer } from '@/core/project';
import type { ParamValues } from '@/core/params';
import { createLayer, layerParamDefs, maskSourcesOf, sanitizeLayer } from '@/layers/registry';
import {
	foldLimit,
	layerLimit,
	limitLabel,
	limitParams,
	limitTo,
	layerWrites,
	maskChain,
	maskChainLabel,
	maskLinks,
	maskWriteKind,
	masksAbove,
	planMasks,
	sanitizeLimit,
	solidSources
} from '@/layers/masks';
import { getLayerDef } from '@/layers/registry';

ensureBuiltins();

const project = (layers: Layer[]) => createProject({ width: 32, height: 32, layers });

describe('mask writers and labels', () => {
	it('names the layers a mask holds, back to the last Normal writer', () => {
		const old = createLayer('rect', {}, 'Old');
		const panel = createLayer('rect', {}, 'Panel');
		const grain = createLayer('noise', {}, 'Grain');
		const vent = createLayer('circle', { mk_op: 'subtract' }, 'Vent');
		const off = createLayer('rect', { mk_target: '' }, 'Ignored');
		const other = createLayer('rect', { mk_target: 'Opening' }, 'Hatch');
		const hidden = { ...createLayer('rect', { mk_op: 'union' }, 'Hidden'), enabled: false };
		const grime = createLayer('noise', {}, 'Grime');
		const p = project([old, panel, grain, vent, off, other, hidden, grime]);
		expect(maskChain(p, grime.id, 'Shape')).toEqual([
			{ name: 'Panel', op: 'replace' },
			{ name: 'Vent', op: 'subtract' }
		]);
		expect(maskChainLabel(maskChain(p, grime.id, 'Shape'))).toBe('Panel − Vent');
		expect(maskChainLabel(maskChain(p, grain.id, 'Shape'))).toBe('Panel');
		expect(maskChain(p, old.id, 'Shape')).toEqual([]);
		expect(maskChainLabel(maskChain(p, grime.id, 'Opening'))).toBe('Hatch');
		expect(masksAbove(p, grime.id)).toEqual(['Shape', 'Opening']);
		expect(masksAbove(p, grain.id)).toEqual(['Shape']);
	});

	it('shortens long chains to the last three writers', () => {
		const layers = ['A', 'B', 'C', 'D'].map((n) => createLayer('rect', { mk_op: 'union' }, n));
		const last = createLayer('noise');
		expect(maskChainLabel(maskChain(project([...layers, last]), last.id, 'Shape'))).toBe('… + B + C + D');
	});

	it('writes shapes from shape layers, coverage from others — and never coverage into Shape from a shape layer', () => {
		const def = (t: string) => getLayerDef(t);
		expect(maskWriteKind(def('rect'), createLayer('rect').params)).toBe('shape');
		expect(maskWriteKind(def('noise'), createLayer('noise').params)).toBe(false);
		expect(maskWriteKind(def('noise'), { ...createLayer('noise').params, mk_target: 'Moss' })).toBe('coverage');
		const joints = createLayer('stone_blocks', { output: 'joints' }).params;
		expect(maskWriteKind(def('stone_blocks'), joints)).toBe(false);
		expect(maskWriteKind(def('stone_blocks'), { ...joints, mk_target: 'Joints' })).toBe('coverage');
		expect(maskWriteKind(def('bevel'), { mk_target: 'Shape' })).toBe(false);
	});
});

describe('limit expressions', () => {
	it('round-trips through the flat params', () => {
		const e = {
			terms: [
				{ mask: 'Shape', op: 'and' as const },
				{ mask: 'Opening', op: 'minus' as const },
				{ mask: 'Wet', op: 'or' as const }
			],
			outside: true
		};
		expect(layerLimit(limitParams(e))).toEqual(e);
		expect(layerLimit(limitParams(null))).toBeNull();
		expect(layerLimit(limitTo(['Shape', '−', 'Opening', '∪', 'Wet'], { outside: true }))).toEqual(e);
		expect(limitLabel(e)).toBe('outside Shape − Opening ∪ Wet');
		// A gap ends the expression: terms after an empty name are ignored.
		expect(layerLimit({ lim_1: 'A', lim_2: '', lim_op3: 'or', lim_3: 'C' })!.terms.map((t) => t.mask)).toEqual(['A']);
	});

	it('folds Outside into the terms (De Morgan), so the combine never inverts a partial result', () => {
		const a = createLayer('rect', { mk_target: 'A' });
		const b = createLayer('rect', { mk_target: 'B' });
		const at = (limit: ParamValues) => {
			const l = createLayer('noise', limit);
			return planMasks(project([a, b, l]))
				.layers.get(l.id)!
				.limit!.map((t) => [t.ref.mask, t.op, t.neg]);
		};
		expect(at(limitTo(['A', '∪', 'B'], { outside: true }))).toEqual([
			['A', 'first', true],
			['B', 'and', true]
		]);
		expect(at(limitTo(['A', '∩', 'B'], { outside: true }))).toEqual([
			['A', 'first', true],
			['B', 'or', true]
		]);
		expect(at(limitTo(['A', '−', 'B'], { outside: true }))).toEqual([
			['A', 'first', true],
			['B', 'or', false]
		]);
		expect(at(limitTo(['A', '−', 'B']))).toEqual([
			['A', 'first', false],
			['B', 'minus', false]
		]);
	});

	it('folds a material limit into a member’s own when unpacking, where one expression can hold both', () => {
		const own = { terms: [{ mask: 'Shape', op: 'and' as const }], outside: false };
		const out = { terms: [{ mask: 'Shape', op: 'and' as const }], outside: true };
		const hole = { terms: [{ mask: 'Opening', op: 'and' as const }], outside: true };
		const inHole = { terms: [{ mask: 'Opening', op: 'and' as const }], outside: false };
		expect(foldLimit(null, hole)).toEqual(hole);
		expect(foldLimit(own, hole)).toEqual({
			terms: [
				{ mask: 'Shape', op: 'and' },
				{ mask: 'Opening', op: 'minus' }
			],
			outside: false
		});
		expect(foldLimit(out, hole)).toEqual({
			terms: [
				{ mask: 'Shape', op: 'and' },
				{ mask: 'Opening', op: 'or' }
			],
			outside: true
		});
		expect(foldLimit(out, inHole)).toEqual({
			terms: [
				{ mask: 'Opening', op: 'and' },
				{ mask: 'Shape', op: 'minus' }
			],
			outside: false
		});
	});

	it('sanitises stored material limits', () => {
		expect(sanitizeLimit({ terms: [{ mask: ' Opening ', op: 'nope' }, { mask: '' }], outside: 1 })).toEqual({
			terms: [{ mask: 'Opening', op: 'and' }],
			outside: false
		});
		expect(sanitizeLimit({ terms: [] })).toBeUndefined();
		expect(sanitizeLimit('x')).toBeUndefined();
	});
});

describe('mask plan', () => {
	it('gives a slot only to versions read later, and reuses it once its last reader has run', () => {
		// Shape is written three times; only the second is read (by the grime) — and the last stays for the Masks view.
		const s1 = createLayer('rect', {}, 's1');
		const s2 = createLayer('rect', {}, 's2');
		const grime = createLayer('noise', limitTo('Shape'), 'grime');
		const s3 = createLayer('rect', {}, 's3');
		const plan = planMasks(project([s1, s2, grime, s3]));
		const w = (l: Layer) => plan.layers.get(l.id)!.write!;
		// s1's version is read last by s2 (a writer reads what it writes over), s2's by s3; each next write takes the slot
		// its last reader frees (the copy happens after that layer has run), so one slot serves all three.
		expect([w(s1).slot, w(s2).slot, w(s3).slot]).toEqual([0, 0, 0]);
		expect(plan.slots).toBe(1);
		expect(plan.layers.get(grime.id)!.limit![0].ref).toMatchObject({ mask: 'Shape', version: 2, slot: 0 });
		expect(plan.final.get('Shape')).toMatchObject({ version: 3, slot: 0 });
		// A second mask alive at the same time needs a second slot.
		const hatch = createLayer('rect', { mk_target: 'Hatch' });
		expect(planMasks(project([s1, hatch, grime, s3])).slots).toBe(2);
	});

	it('needs no slot for a mask nothing reads but the view, and none at all for an empty one', () => {
		const noise = createLayer('noise', limitTo('Nothing'));
		const plan = planMasks(project([noise]));
		expect(plan.slots).toBe(0);
		expect(plan.layers.get(noise.id)!.limit![0].ref).toMatchObject({ version: 0, slot: -1 });
	});

	it('tracks exact distances: shapes are, coverage and Feather aren’t', () => {
		const shape = createLayer('rect');
		const feathered = createLayer('rect', { mk_target: 'Soft', mk_feather: 4 });
		const moss = createLayer('noise', { mk_target: 'Moss' });
		const plan = planMasks(project([shape, feathered, moss]));
		expect([plan.final.get('Shape')!.exact, plan.final.get('Soft')!.exact, plan.final.get('Moss')!.exact]).toEqual([
			true,
			false,
			false
		]);
	});

	it('plans Write to’s further rows (Stone blocks: its joints, its gaps) as passes of their own before the layer’s', () => {
		// The wall reads Joints and Shape (its limit) as they were before it: its other writes can't take that slot.
		const old = createLayer('noise', { mk_target: 'Joints' }, 'old');
		const wall = createLayer(
			'stone_blocks',
			{
				mk_src_2: 'out_joints',
				mk_target_2: 'Joints',
				mk_src_3: 'out_gaps',
				mk_target_3: 'Gaps',
				...limitTo('Joints')
			},
			'wall'
		);
		const moss = createLayer('noise', limitTo('Joints'), 'moss');
		const dark = createLayer('noise', limitTo(['Gaps', '∪', 'Shape']), 'dark');
		const p = project([old, wall, moss, dark]);
		const plan = planMasks(p);
		const w = plan.layers.get(wall.id)!;
		expect(w.extra.map((e) => [e.write.mask, e.write.version, e.write.kind, e.params.output, e.soft])).toEqual([
			['Joints', 2, 'coverage', 'joints', false],
			['Gaps', 1, 'coverage', 'gaps', false]
		]);
		expect(w.limit![0].ref).toMatchObject({ mask: 'Joints', version: 1 });
		expect(w.extra[0].input).toMatchObject({ mask: 'Joints', version: 1 });
		const busy = w.limit![0].ref.slot;
		expect(w.extra.map((e) => e.write.slot)).not.toContain(busy);
		expect(w.write).toMatchObject({ mask: 'Shape', version: 1, kind: 'shape' });
		expect(plan.layers.get(moss.id)!.limit![0].ref).toMatchObject({ version: 2, slot: w.extra[0].write.slot });
		expect(masksAbove(p, moss.id)).toEqual(['Shape', 'Joints', 'Gaps']);
		expect(maskChain(p, moss.id, 'Gaps')).toEqual([{ name: 'wall', op: 'replace' }]);
		// Shape never takes a coverage.
		const bad = createLayer('stone_blocks', { mk_src_2: 'out_joints', mk_target_2: 'Shape' });
		expect(planMasks(project([bad])).layers.get(bad.id)!.extra).toEqual([]);
	});

	it('gives each row its own Mode, Smoothness and Feather, and stops at the first empty row', () => {
		const def = getLayerDef('rock');
		const l = createLayer('rock', {
			mk_target: 'Rock',
			mk_src_2: 'out_crevices',
			mk_target_2: 'Rock',
			mk_op_2: 'smooth-union',
			mk_smooth_2: 9,
			mk_feather_2: 2,
			mk_src_4: 'out_scarps',
			mk_target_4: 'Lost'
		});
		const ws = layerWrites(def, l.params);
		expect(ws.map((w) => [w.target, w.op, w.params.mk_smooth, w.params.mk_feather, w.extra])).toEqual([
			['Rock', 'smooth-union', 9, 2, true],
			['Rock', 'replace', 4, 0, false]
		]);
	});

	it('runs a part source of the first row in the layer’s own pass, other rows as passes of their own', () => {
		const def = getLayerDef('greebles');
		const l = createLayer('greebles', { mk_src: 'seams', mk_target: 'Seams', mk_src_2: 'lights', mk_target_2: 'Glow' });
		const ws = layerWrites(def, l.params);
		expect(ws.map((w) => [w.target, w.params.mask, w.extra, w.kind])).toEqual([
			['Glow', 'lights', true, 'shape'],
			['Seams', 'seams', false, 'shape']
		]);
		expect(planMasks(project([l])).layers.get(l.id)!.params.mask).toBe('seams');
	});

	it('folds the old mask fields into rows', () => {
		const stone = sanitizeLayer({ ...createLayer('stone_blocks'), params: { mk_joints: 'J', mk_scars: '' } });
		expect(stone.params).toMatchObject({ mk_src_2: 'out_joints', mk_target_2: 'J' });
		expect('mk_joints' in stone.params).toBe(false);
		const grb = sanitizeLayer({ ...createLayer('greebles'), params: { mask: 'seams', mk_lights: 'Glow' } });
		expect(grb.params).toMatchObject({ mk_src: 'seams', mk_src_2: 'lights', mk_target_2: 'Glow' });
		const none = sanitizeLayer({ ...createLayer('vents'), params: { mask: 'none' } });
		expect(none.params.mk_target).toBe('');
		const area = sanitizeLayer({
			...createLayer('surfacemask'),
			params: { find: 'high', mk_sdf: 'distance', mk_crev: 'Crev' }
		});
		expect(area.params).toMatchObject({ mk_src: 'high_sdf', mk_src_2: 'crevices_sdf', mk_target_2: 'Crev' });
		const cry = sanitizeLayer({ ...createLayer('crystal'), params: { mask_feat: 'facets' } });
		expect(cry.params.mk_src).toBe('facets');
	});

	it('skips disabled layers and reads Shape for layers that read a mask without writing one', () => {
		const shape = createLayer('rect');
		const off = { ...createLayer('rect', { mk_target: 'Shape' }), enabled: false };
		const chips = createLayer('chips', { mk_target: '' });
		const plan = planMasks(project([shape, off, chips]));
		expect(plan.layers.has(off.id)).toBe(false);
		expect(plan.layers.get(chips.id)!.input).toMatchObject({ mask: 'Shape', version: 1 });
		expect(plan.layers.get(chips.id)!.write).toBeNull();
	});
});

describe('Mask area', () => {
	it('writes the feature shape from Inside, coverage from everything else (and from Inside with Breakup)', () => {
		const def = getLayerDef('surfacemask');
		const at = (p: ParamValues) => maskWriteKind(def, { ...createLayer('surfacemask').params, mk_target: 'M', ...p });
		expect(at({})).toBe('coverage');
		expect(at({ select: 'features' })).toBe('shape');
		expect(at({ select: 'features', bk_amount: 0.5 })).toBe('coverage');
		expect(at({ select: 'features', area: 'gradient' })).toBe('coverage');
		// Crevices and high spots: a coverage, or a distance from their SDF sources.
		expect(at({ find: 'crevices', mk_sdf: 'distance' })).toBe('shape');
		expect(at({ find: 'slopes', mk_sdf: 'distance' })).toBe('coverage');
		expect(def!.maskSource!({ select: 'features', src_mask: 'Opening' })).toBe('Opening');
		expect(def!.maskSource!({ select: 'surface' })).toBeNull();
		// Reading features plans a source for the layer.
		const shape = createLayer('rect');
		const area = createLayer('surfacemask', { select: 'features' });
		expect(planMasks(project([shape, area])).layers.get(area.id)!.source).toMatchObject({ mask: 'Shape', version: 1 });
	});
});

describe('Mask area sources', () => {
	it('writes crevices and high spots, as distances, from any row', () => {
		const def = getLayerDef('surfacemask');
		const l = createLayer('surfacemask', {
			mk_src_2: 'crevices_sdf',
			mk_target_2: 'Crev',
			mk_src_3: 'high_sdf',
			mk_target_3: 'High'
		});
		const extra = layerWrites(def, l.params).filter((w) => w.extra);
		expect(extra.map((w) => [w.target, w.kind, w.params.find])).toEqual([
			['Crev', 'shape', 'crevices'],
			['High', 'shape', 'high']
		]);
		// The selection as painted stays a coverage.
		expect(layerWrites(def, l.params).find((w) => !w.extra)).toMatchObject({ target: 'Crevices', kind: 'coverage' });
	});
});

describe('mask links (the outliner lane)', () => {
	it('links each limited layer to the writers of what it reads, and a material’s limit from the material', () => {
		const panel = createLayer('rect', {}, 'Panel');
		const vent = createLayer('circle', { mk_op: 'subtract' }, 'Vent');
		const moss = createLayer('noise', { mk_target: 'Moss' }, 'Moss');
		const grime = createLayer('noise', limitTo(['Shape', '∩', 'Moss']), 'Grime');
		const late = createLayer('rect', {}, 'Late');
		const p = project([panel, vent, moss, grime, late]);
		expect(maskLinks(p).map((l) => [l.reader, l.writer, l.mask])).toEqual([
			[grime.id, panel.id, 'Shape'],
			[grime.id, vent.id, 'Shape'],
			[grime.id, moss.id, 'Moss']
		]);
		p.groups = [
			{ id: 'g1', name: 'G', members: [late.id], limit: { terms: [{ mask: 'Moss', op: 'and' }], outside: false } }
		];
		expect(
			maskLinks(p)
				.filter((l) => l.reader === 'group:g1')
				.map((l) => l.writer)
		).toEqual([moss.id]);
	});
});

describe('outputs as sources', () => {
	it('offers each output of an Output enum as a Write to source, written as a soft coverage', () => {
		ensureBuiltins();
		const opts = layerParamDefs('pipework')
			.find((d) => d.key === 'mk_src_2')!
			.options!.map((o) => o.value);
		for (const o of ['height', 'cover', 'fittings', 'underside', 'tubes', 'facing', 'liquid'])
			expect(opts).toContain(`out_${o}`);
		// Short labels: the parenthesis goes to the hint.
		expect(maskSourcesOf('voronoi').find((s) => s.value === 'out_edges')!.label).toBe('Edges');
		const pipes = createLayer('pipework', {
			mk_src_2: 'out_fittings',
			mk_target_2: 'Fittings',
			mk_src_3: 'out_underside',
			mk_target_3: 'Under'
		});
		const writes = layerWrites(getLayerDef('pipework'), pipes.params).filter((w) => w.extra);
		expect(writes.map((w) => [w.target, w.kind, w.soft, w.params.output])).toEqual([
			['Fittings', 'coverage', true, 'fittings'],
			['Under', 'coverage', true, 'underside']
		]);
		// Never a coverage into the Shape mask of a shape layer.
		expect(
			layerWrites(getLayerDef('pipework'), { ...pipes.params, mk_target_3: 'Shape' }).some(
				(w) => w.extra && w.target === 'Shape'
			)
		).toBe(false);
	});
});

describe('coverage-only masks', () => {
	it('tells a plain coverage from a shape or an output’s value, and Mask area › Inside on it', () => {
		const joints = createLayer('stone_blocks', { mk_src_2: 'out_joints', mk_target_2: 'Joints' }, 'Blocks');
		const pipes = createLayer('pipework', { mk_src_2: 'out_underside', mk_target_2: 'Under' }, 'Pipes');
		const grime = createLayer('noise', { mk_target: 'Grime' }, 'Grime');
		const inside = (mask: string, extra: ParamValues = {}) =>
			createLayer('surfacemask', { select: 'features', src_mask: mask, area: 'inside', mk_target: '', ...extra });
		const readers = {
			joints: inside('Joints'),
			grime: inside('Grime'),
			under: inside('Under'),
			shape: inside('Shape'),
			frayed: inside('Grime', { bk_amount: 0.5 }),
			gradient: inside('Grime', { area: 'gradient' })
		};
		const p = project([joints, pipes, grime, ...Object.values(readers)]);
		const plan = planMasks(p);
		const only = Object.fromEntries(Object.entries(readers).map(([k, l]) => [k, plan.layers.get(l.id)!.coverageOnly]));
		expect(only).toEqual({ joints: true, grime: true, under: false, shape: false, frayed: false, gradient: false });
		expect(plan.final.get('Joints')!.plain).toBe(true);
		expect(plan.final.get('Under')!.plain).toBe(false);
	});

	it('switches only Pattern sources to Solid', () => {
		expect(solidSources({ dif_src: 'value', h_src: 'random', r_src: 'shape', s_src: 'value' })).toEqual({
			dif_src: 'flat',
			s_src: 'flat',
			mt_src: 'flat',
			e_src: 'flat'
		});
	});
});
