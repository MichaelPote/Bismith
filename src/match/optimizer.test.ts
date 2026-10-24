import { describe, expect, it } from 'vitest';
import { createLayer, createProject, normalizeProject } from '@/core/serialize';
import type { Gradient } from '@/core/params';
import { layerParamDefs } from '@/layers/registry';
import { hexToRgb } from '@/core/color';
import { mulberry32 } from '@/core/hash';
import { createImage } from './image';
import type { Project } from '@/core/project';
import {
	DEFAULT_LIBRARY,
	Optimizer,
	Rng,
	RunLimits,
	applyParams,
	driftedCopies,
	residualColours,
	entryTier,
	entryValue,
	extractParams,
	isEntryActive,
	type OptimizerOptions,
	type ParamSpace,
	type StepInfo
} from './optimizer';

const EXAMPLE = {
	width: 64,
	height: 64,
	tileable: true,
	heightDepth: 8,
	layers: [
		{
			id: 'noise1',
			type: 'noise',
			params: {
				scale: 4,
				h_on: true,
				h_amount: 0.5,
				dif_on: true,
				dif_grad: {
					stops: [
						{ pos: 0, color: '#3b342e' },
						{ pos: 1, color: '#9a8c7a' }
					]
				}
			}
		},
		{
			id: 'rect1',
			type: 'rect',
			params: {
				inset_x: 8,
				inset_y: 8,
				radius: 6,
				bevel: 4,
				h_on: true,
				h_amount: 1,
				dif_on: true,
				dif_src: 'flat',
				dif_grad: { stops: [{ pos: 0, color: '#6d7f8f' }] }
			}
		}
	],
	lighting: { lights: [{ id: 'sun', type: 'directional', params: { azimuth: 315, elevation: 35, intensity: 1.5 } }] },
	render: { maxSamples: 32 },
	post: [{ id: 'tm', type: 'tonemap' }]
};

const project = (): Project => normalizeProject(JSON.parse(JSON.stringify(EXAMPLE)));

function byId(space: ParamSpace, id: string) {
	const e = space.entries.find((x) => x.id === id);
	if (!e) throw new Error(`no entry ${id}: ${space.entries.map((x) => x.id).join(', ')}`);
	return e;
}

describe('parameter space', () => {
	it('extracts numbers, colours and gradient stops from unlocked enabled layers', () => {
		const p = project();
		const space = extractParams(p);
		expect(space.size).toBe(space.initial.length);
		const scale = byId(space, 'layer:noise1:scale');
		expect(scale.log).toBe(true); // its 0.25..softMax range is multiplicative
		expect(entryValue(scale, space.initial)).toBeCloseTo(4, 3);
		const stop = byId(space, 'layer:noise1:dif_grad:1:color');
		expect(stop.dims).toBe(3);
		expect(entryValue(stop, space.initial)).toBe('#9a8c7a');
		byId(space, 'layer:noise1:dif_grad:1:pos');
		// A single-stop ramp has no position entry.
		expect(space.entries.some((e) => e.id === 'layer:rect1:dif_grad:0:pos')).toBe(false);
		// Pixel params are limited to the texture size.
		expect(byId(space, 'layer:rect1:radius').hi).toBeLessThanOrEqual(64);
		// Seeds, enums and bools are off by default; lights and post too.
		expect(space.entries.some((e) => e.kind === 'enum' || e.kind === 'seed')).toBe(false);
		expect(space.entries.some((e) => e.scope !== 'layer')).toBe(false);
		for (const x of space.initial) expect(Number.isFinite(x)).toBe(true);
	});

	it('skips locked and disabled layers', () => {
		const p = project();
		p.layers[0].locked = true;
		expect(extractParams(p).entries.some((e) => e.owner === 'noise1')).toBe(false);
		const q = project();
		q.layers[1].enabled = false;
		expect(extractParams(q).entries.some((e) => e.owner === 'rect1')).toBe(false);
	});

	it('round-trips without changing the project and never mutates its input', () => {
		const p = project();
		const before = JSON.stringify(p);
		const space = extractParams(p, { lights: true, post: true, base: true, enums: true, seeds: true });
		const q = applyParams(p, space, space.initial);
		expect(JSON.stringify(p)).toBe(before);
		const again = extractParams(q, space.options);
		expect(again.entries.map((e) => e.id)).toEqual(space.entries.map((e) => e.id));
		for (let i = 0; i < space.entries.length; i++) {
			expect(entryValue(again.entries[i], again.initial)).toEqual(entryValue(space.entries[i], space.initial));
		}
		const a = p.layers[0].params;
		const b = q.layers[0].params;
		expect(b.scale).toBeCloseTo(a.scale as number, 3);
		expect(b.dif_grad).toEqual(a.dif_grad);
		expect(q.lighting.lights[0].params.azimuth).toBeCloseTo(315, 2);
		expect(q.base.color).toBe(p.base.color);
	});

	it('optionally includes lights, post, base, enums and seeds', () => {
		const space = extractParams(project(), { lights: true, post: true, base: true, enums: true, seeds: true });
		const az = byId(space, 'light:sun:azimuth');
		expect(az.wrap).toBe(true);
		byId(space, 'post:tm:exposure');
		byId(space, 'base::color');
		byId(space, 'lighting::sky.intensity');
		const noiseType = byId(space, 'layer:noise1:noise');
		expect(noiseType.kind).toBe('enum');
		expect(byId(space, 'layer:noise1:seed').kind).toBe('seed');
		// Channel enables are structural, never tuned.
		expect(space.entries.some((e) => e.key === 'dif_on' || e.key === 'h_on')).toBe(false);
		const v = Float64Array.from(space.initial);
		v[noiseType.offset] = noiseType.options!.indexOf('worley');
		expect(applyParams(project(), space, v).layers[0].params.noise).toBe('worley');
	});

	it('maps vectors back to clamped values and sorted stops', () => {
		const p = project();
		const space = extractParams(p);
		const v = Float64Array.from(space.initial);
		v[byId(space, 'layer:noise1:dif_grad:0:pos').offset] = 0.9;
		v[byId(space, 'layer:noise1:dif_grad:1:pos').offset] = 0.2;
		v[byId(space, 'layer:noise1:scale').offset] = 1.7; // out of range → clamped
		const q = applyParams(p, space, v);
		const g = q.layers[0].params.dif_grad as Gradient;
		expect(g.stops.map((s) => s.pos)).toEqual([0.2, 0.9]);
		expect(g.stops[0].color).toBe('#9a8c7a'); // colour travels with its stop
		// Clamped to the top of the slider (soft) range.
		expect(q.layers[0].params.scale).toBeCloseTo(layerParamDefs('noise').find((d) => d.key === 'scale')!.softMax!, 3);
	});

	it('knows which entries are inert', () => {
		const p = project();
		const space = extractParams(p);
		expect(isEntryActive(p, byId(space, 'layer:noise1:warp_scale'))).toBe(false); // warp = 0
		expect(isEntryActive(p, byId(space, 'layer:noise1:r_a'))).toBe(false); // roughness channel off
		expect(isEntryActive(p, byId(space, 'layer:noise1:h_amount'))).toBe(true);
		const v = Float64Array.from(space.initial);
		v[byId(space, 'layer:noise1:warp').offset] = 0.5;
		expect(isEntryActive(applyParams(p, space, v), byId(space, 'layer:noise1:warp_scale'))).toBe(true);
	});

	it('offers ambient occlusion as a lever: the strength always, the radius once occlusion is on', () => {
		const p = project();
		expect(extractParams(p).entries.some((e) => e.scope === 'render')).toBe(false);
		const space = extractParams(p, { shading: true });
		const ao = byId(space, 'render::ao');
		const radius = byId(space, 'render::aoRadius');
		expect(ao.lo).toBe(0);
		expect(ao.dormant).toBe(true); // off: switching it on is picked less often until it helps
		expect(isEntryActive(p, ao)).toBe(true);
		expect(isEntryActive(p, radius)).toBe(false);
		const v = Float64Array.from(space.initial);
		v[ao.offset] = 0.5;
		const q = applyParams(p, space, v);
		expect(q.render.ao).toBeGreaterThan(0);
		expect(p.render.ao).toBe(0);
		expect(isEntryActive(q, radius)).toBe(true);
	});

	it('ties the pattern params of same-type, same-seed copies and writes them together', () => {
		const shape = { columns: 4, rows: 8, mortar: 0.5, seed: 6 };
		const p = createProject({
			width: 64,
			height: 64,
			layers: [
				createLayer('bricks', { ...shape, bevel: 0, h_amount: 0.6 }, 'Pillow'),
				createLayer('bricks', { ...shape, bevel: 4, h_amount: 0.5 }, 'Edges'),
				createLayer('bricks', { ...shape, h_on: false, dif_on: true }, 'Stone colour'),
				createLayer('bricks', { ...shape, seed: 7, h_on: false }, 'Other pattern')
			]
		});
		const [pillow, edges, colour, other] = p.layers;
		const space = extractParams(p);
		const cols = space.entries.filter((e) => e.key === 'columns');
		// One tied entry for the three seed-6 copies, one for the seed-7 pattern.
		expect(cols.map((e) => e.owner).sort()).toEqual([pillow.id, other.id].sort());
		const tied = cols.find((e) => e.owner === pillow.id)!;
		expect(tied.tied).toEqual([edges.id, colour.id]);
		expect(tied.label).toContain('linked');
		// Params the copies differ in stay separate.
		expect(space.entries.filter((e) => e.key === 'h_amount').map((e) => e.owner)).toEqual(
			expect.arrayContaining([pillow.id, edges.id])
		);
		const v = Float64Array.from(space.initial);
		v[tied.offset] = 1;
		const q = applyParams(p, space, v);
		const after = q.layers.map((l) => l.params.columns);
		expect(after[0]).toBe(after[1]);
		expect(after[0]).toBe(after[2]);
		expect(after[0]).not.toBe(4);
		expect(after[3]).toBe(4);
	});
});

describe('Optimizer', () => {
	// Synthetic loss: distance to a hidden target in parameter space (cheap stand-in for render + metrics).
	function syntheticLoss() {
		const target = project();
		target.layers[0].params.scale = 9;
		target.layers[0].params.h_amount = 1.1;
		target.layers[1].params.inset_x = 14;
		(target.layers[0].params.dif_grad as Gradient).stops[1].color = '#c0a080';
		const space = extractParams(target);
		const goal = space.initial;
		const keys = [
			'layer:noise1:scale',
			'layer:noise1:h_amount',
			'layer:rect1:inset_x',
			'layer:noise1:dif_grad:1:color'
		];
		const entries = keys.map((k) => byId(space, k));
		return (p: Project) => {
			const v = extractParams(p).initial;
			let s = 0;
			for (const e of entries) for (let d = 0; d < e.dims; d++) s += (v[e.offset + d] - goal[e.offset + d]) ** 2;
			return Math.sqrt(s);
		};
	}

	it('reduces the loss and is deterministic for a seed', async () => {
		const loss = syntheticLoss();
		const run = async (seed: number) => {
			const opt = new Optimizer(project(), loss, { seed, lambda: 4 });
			const l0 = await opt.init();
			await opt.run(150);
			return { l0, opt };
		};
		const a = await run(3);
		console.log(`synthetic loss ${a.l0.toFixed(3)} → ${a.opt.best.loss.toFixed(3)}`);
		expect(a.opt.best.loss).toBeLessThan(a.l0 * 0.35);
		expect(a.opt.history.length).toBe(150);
		// λ per step, except sweeps of an integer with fewer other values than λ.
		expect(a.opt.evaluations).toBeGreaterThan(150 * 3);
		const curve = a.opt.lossCurve;
		for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeLessThanOrEqual(curve[i - 1]);
		const b = await run(3);
		expect(b.opt.lossCurve).toEqual(curve);
		expect(JSON.stringify(b.opt.best.project.layers.map((l) => l.params))).toBe(
			JSON.stringify(a.opt.best.project.layers.map((l) => l.params))
		);
		const c = await run(4);
		expect(c.opt.lossCurve).not.toEqual(curve);
	});

	it('never touches locked layers and keeps the input project intact', async () => {
		const p = project();
		p.layers[1].locked = true;
		const before = JSON.stringify(p);
		const opt = new Optimizer(p, syntheticLoss(), {
			seed: 1,
			structural: true,
			structuralWhen: 'always' as const,
			structuralRate: 0.3
		});
		await opt.run(40);
		expect(JSON.stringify(p)).toBe(before);
		const rect = opt.best.project.layers.find((l) => l.id === 'rect1')!;
		expect(JSON.stringify(rect)).toBe(JSON.stringify(p.layers[1]));
	});

	it('opens the next search tier at each stall, then restarts, and reports both', async () => {
		const opt = new Optimizer(project(), () => 1, { seed: 2, restartAfter: 3 });
		const steps = await opt.run(16);
		expect(steps.filter((s) => s.opened).map((s) => s.stage)).toEqual([1, 2]);
		const firstRestart = steps.findIndex((s) => s.restarted);
		expect(firstRestart).toBeGreaterThan(steps.findIndex((s) => s.stage === 2));
		// Neutral moves are accepted (drift) but never count as improvements.
		expect(steps.every((s) => !s.improved)).toBe(true);
	});

	it('applies structural mutations when they help', async () => {
		// Loss rewards an extra enabled layer and a "multiply" blend on the noise layer (found by id: relief snippets
		// are inserted beneath it).
		const loss = (p: Project) => {
			const enabled = p.layers.filter((l) => l.enabled);
			let s = Math.abs(enabled.length - 3);
			if (p.layers.find((l) => l.id === 'noise1')!.params.dif_blend !== 'multiply') s += 0.5;
			return s;
		};
		const opt = new Optimizer(project(), loss, {
			seed: 5,
			structural: true,
			structuralWhen: 'always' as const,
			structuralRate: 0.5
		});
		await opt.run(300);
		expect(opt.best.loss).toBe(0);
		expect(opt.history.some((h) => h.structural)).toBe(true);
		expect(opt.best.project.layers.length).toBeLessThanOrEqual(5);
	});

	it('tunes an inserted layer before judging it', async () => {
		// The probe hurts at its template opacity and helps once that is tuned at all; nothing else matters.
		const loss = (p: Project) => {
			const probe = p.layers.find((l) => l.name === 'Probe' && l.enabled);
			return !probe ? 1 : Math.abs(Number(probe.params.dif_opacity) - 0.9) < 0.01 ? 2 : 0.5;
		};
		const opts = {
			seed: 4,
			lambda: 2,
			structural: true,
			structuralWhen: 'always' as const,
			structuralRate: 1,
			library: [{ type: 'noise', name: 'Probe', params: { noise: 'perlin', dif_on: true, dif_opacity: 0.9 } }],
			space: { filter: (e: { key: string }) => e.key === 'dif_opacity' }
		};
		const judgedAsInserted = new Optimizer(project(), loss, { ...opts, incubation: 0 });
		await judgedAsInserted.run(20);
		expect(judgedAsInserted.history.some((h) => h.structural?.startsWith('insert'))).toBe(false);
		expect(judgedAsInserted.best.loss).toBe(1);
		const incubated = new Optimizer(project(), loss, opts);
		await incubated.run(20);
		expect(incubated.history.some((h) => h.structural?.startsWith('insert'))).toBe(true);
		expect(incubated.best.loss).toBe(0.5);
	});

	it('takes residual colours from where the render misses the reference', () => {
		const render = createImage(16, 16, [0.5, 0.5, 0.5, 1]);
		const target = createImage(16, 16, [0.5, 0.5, 0.5, 1]);
		// A red block (≥ 10 % of the pixels) the render lacks.
		for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) target.data.set([0.8, 0.1, 0.1], (y * 16 + x) * 4);
		expect(residualColours(render, target, 3, new Rng(1))).toEqual(['#cc1a1a', '#cc1a1a', '#cc1a1a']);
	});

	it('inserts relief snippets under the colour layers', async () => {
		const p = normalizeProject({
			width: 64,
			height: 64,
			layers: [
				createLayer('bricks', { mortar: 2, dif_on: false, h_on: true }),
				createLayer('noise', { noise: 'perlin', dif_on: true })
			]
		});
		const opt = new Optimizer(p, () => 1, {
			seed: 3,
			structural: true,
			structuralWhen: 'always' as const,
			structuralRate: 1,
			lambda: 6
		});
		for (let i = 0; i < 6; i++) await opt.step();
		const relief = new Set(DEFAULT_LIBRARY.filter((t) => t.stack === 'relief').map((t) => t.name));
		const c = opt.current.project;
		const firstPaint = c.layers.findIndex((l) => l.params.dif_on === true);
		c.layers.forEach((l, i) => {
			if (relief.has(l.name)) expect(i).toBeLessThan(firstPaint);
		});
	});

	it('duplicates a layer as a new instance right above it', async () => {
		// Rewards a second noise layer with its own seed; the library is empty, so only a duplicate can add one.
		const loss = (p: Project) => {
			const noise = p.layers.filter((l) => l.enabled && l.type === 'noise');
			return noise.length === 2 && noise[0].params.seed !== noise[1].params.seed ? 0 : 1;
		};
		const opt = new Optimizer(project(), loss, {
			seed: 3,
			structural: true,
			structuralWhen: 'always' as const,
			structuralRate: 1,
			library: []
		});
		await opt.run(40);
		expect(opt.best.loss).toBe(0);
		expect(opt.history.some((h) => h.move === 'structural:duplicate')).toBe(true);
		const layers = opt.best.project.layers;
		const i = layers.findIndex((l) => l.id === 'noise1');
		expect(layers[i + 1].type).toBe('noise');
		expect(layers[i + 1].id).not.toBe('noise1');
		expect(layers[i + 1].name).toContain('(copy)');
	});

	it("tries structure only once tuning has stalled (structuralWhen 'stalled')", async () => {
		const loss = (p: Project) => {
			const noise = p.layers.filter((l) => l.enabled && l.type === 'noise');
			return noise.length === 2 && noise[0].params.seed !== noise[1].params.seed ? 0 : 1;
		};
		const opts = { seed: 3, structural: true, structuralWhen: 'stalled' as const, restartAfter: 4, library: [] };
		const opt = new Optimizer(project(), loss, opts);
		await opt.run(40);
		expect(opt.best.loss).toBe(0);
		// Nothing structural until the two later tiers have opened and the search stalled again.
		const first = opt.history.findIndex((h) => h.moves.some((m) => m.startsWith('structural')));
		expect(first).toBeGreaterThanOrEqual(3 * opts.restartAfter - 1);
		expect(opt.history.slice(first).some((h) => h.structural?.startsWith('duplicate'))).toBe(true);
	});

	it('finds drifted pattern copies and re-aligns them when that helps', async () => {
		const copy = (name: string, over: Record<string, unknown>) => ({
			...createLayer('bricks', { columns: 4, rows: 8, mortar: 1, seed: 6, ...over }),
			name
		});
		const p = normalizeProject({
			width: 64,
			height: 64,
			layers: [
				copy('Pillow', {}),
				copy('Edges', { columns: 5, mortar: 2 }),
				copy('Colour', { rows: 6 }),
				{ ...createLayer('bricks', { seed: 9 }), name: 'Other' }
			]
		});
		const drifted = driftedCopies(p);
		expect(drifted).toHaveLength(1); // the seed-9 layer is no copy
		expect(drifted[0].keys.sort()).toEqual(['columns', 'mortar', 'rows']);
		// Loss: how far the copies' layouts are from agreeing.
		const loss = (q: Project) => {
			const ls = q.layers.filter((l) => l.params.seed === 6);
			return ['columns', 'rows'].reduce((s, k) => s + new Set(ls.map((l) => l.params[k])).size - 1, 0);
		};
		const opt = new Optimizer(p, loss, { seed: 2, relinkRate: 0.5, sweepRate: 0 });
		await opt.run(40);
		expect(opt.best.loss).toBe(0);
		expect(opt.history.some((h) => h.structural?.startsWith('align'))).toBe(true);
	});

	it('searches form before tone before colour', () => {
		const space = extractParams(project(), { base: true, shading: true, lights: true });
		const tier = (id: string) => entryTier(byId(space, id));
		expect(tier('layer:noise1:scale')).toBe(0); // pattern
		expect(tier('layer:noise1:h_amount')).toBe(0); // height
		expect(tier('light:sun:azimuth')).toBe(0);
		expect(tier('render::ao')).toBe(0);
		expect(tier('project::heightDepth')).toBe(0);
		expect(tier('layer:noise1:dif_opacity')).toBe(1); // a diffuse amount
		expect(tier('layer:noise1:dif_grad:1:color')).toBe(2);
		expect(tier('base::color')).toBe(2);
	});

	it('sweeps step over local dips to a far, narrow basin', async () => {
		// A shallow local minimum at the start (scale 4) and a better, narrow basin around scale 30.
		const loss = (p: Project) => {
			const sc = Number(p.layers[0].params.scale);
			return Math.min(0.5 + 0.01 * Math.abs(sc - 4), Math.abs(sc - 30) / 30);
		};
		const opt = new Optimizer(project(), loss, {
			seed: 3,
			sweepRate: 0.5,
			space: { filter: (e) => e.id === 'layer:noise1:scale' }
		});
		await opt.run(40);
		expect(opt.history.some((h) => h.sweep === 'Noise › Scale' && h.improved)).toBe(true);
		expect(Number(opt.best.project.layers[0].params.scale)).toBeGreaterThan(20);
		expect(opt.best.loss).toBeLessThan(0.3);
	});

	it('takes gradient steps along correlated directions', async () => {
		const loss = syntheticLoss();
		const opt = new Optimizer(project(), loss, { seed: 4, gradientRate: 1, sweepRate: 0 });
		const l0 = await opt.init();
		await opt.run(30);
		expect(opt.history.every((h) => h.moves.includes('gradient'))).toBe(true);
		expect(opt.history.some((h) => h.move === 'gradient')).toBe(true);
		expect(opt.best.loss).toBeLessThan(l0);
	});

	it('fits colours to the reference as one move when colour entries are out of the search', async () => {
		// The "render" is the noise layer's first ramp colour; the reference is one brown.
		const brown: [number, number, number, number] = [0.45, 0.25, 0.1, 1];
		const target = createImage(16, 16, brown);
		const render = (p: Project) => {
			const g = p.layers[0].params.dif_grad as Gradient;
			const [r, gr, b] = hexToRgb(g.stops[0].color);
			return createImage(16, 16, [r, gr, b, 1]);
		};
		const evaluate = (p: Project) => {
			const img = render(p);
			const d = Math.hypot(img.data[0] - brown[0], img.data[1] - brown[1], img.data[2] - brown[2]);
			return { loss: d, image: img };
		};
		const opt = new Optimizer(project(), evaluate, {
			seed: 2,
			target,
			colourFitRate: 0.5,
			space: { filter: (e) => e.kind !== 'stop-color' && e.kind !== 'color' }
		});
		const l0 = await opt.init();
		await opt.run(20);
		expect(opt.history.some((h) => h.move === 'colour')).toBe(true);
		expect(opt.best.loss).toBeLessThan(l0 * 0.2);
	});

	it('makes the same decisions when losses carry float noise below the tolerance', async () => {
		// The same project renders a hair differently in different pages; identical runs must still agree. Only three
		// entries matter, so every other mutation ties exactly — compared exactly, the noise would decide those.
		const goal = project();
		goal.layers[0].params.scale = 9;
		goal.layers[0].params.h_amount = 1.1;
		goal.layers[1].params.inset_x = 14;
		const keys: [number, string][] = [
			[0, 'scale'],
			[0, 'h_amount'],
			[1, 'inset_x']
		];
		const base = (p: Project) =>
			Math.hypot(...keys.map(([l, k]) => Number(p.layers[l].params[k]) - Number(goal.layers[l].params[k])));
		const noisy = (salt: number) => {
			let n = 0;
			return (p: Project) => base(p) + Math.sin(++n * 12.9898 + salt) * 5e-7;
		};
		const a = new Optimizer(project(), noisy(1), { seed: 7, lambda: 4 });
		const b = new Optimizer(project(), noisy(2), { seed: 7, lambda: 4 });
		await a.run(80);
		await b.run(80);
		expect(JSON.stringify(b.best.project.layers)).toBe(JSON.stringify(a.best.project.layers));
		expect(b.best.loss).toBeCloseTo(a.best.loss, 5);
	});

	it('runs islands with successive halving', async () => {
		const opt = new Optimizer(project(), syntheticLoss(), { seed: 1, islands: 4, islandSteps: 3 });
		const l0 = await opt.init();
		const steps = await opt.run(40);
		expect(new Set(steps.slice(0, 12).map((s) => s.island)).size).toBe(4);
		expect(steps[0].islands).toBe(4);
		expect(steps[steps.length - 1].islands).toBe(1);
		expect(opt.best.loss).toBeLessThan(l0);
		const again = new Optimizer(project(), syntheticLoss(), { seed: 1, islands: 4, islandSteps: 3 });
		await again.run(40);
		expect(again.lossCurve).toEqual(opt.lossCurve);
	});

	it('treats evaluation errors as infinitely bad', async () => {
		let n = 0;
		const opt = new Optimizer(
			project(),
			() => {
				n++;
				if (n > 1 && n % 2 === 0) throw new Error('boom');
				return 1 / n;
			},
			{ seed: 1 }
		);
		const info = await opt.step();
		expect(Number.isFinite(info.bestLoss)).toBe(true);
	});

	it('refuses an empty space', () => {
		const p = project();
		for (const l of p.layers) l.locked = true;
		expect(() => new Optimizer(p, () => 0)).toThrow(/Nothing to optimise/);
	});
});

describe('stop criteria', () => {
	it('stops at the target loss, a step budget or an evaluation budget', async () => {
		let n = 0;
		// Loss falls by 0.1 per evaluation: 1.0, 0.9, 0.8, …
		const falling = () => Math.max(0, 1 - 0.1 * n++);
		const opt = new Optimizer(project(), falling, { seed: 1, lambda: 2 });
		const out = await opt.runUntil({ targetLoss: 0.45, steps: 100 });
		expect(out.reason).toBe('target');
		expect(opt.best.loss).toBeLessThanOrEqual(0.45);
		expect((await opt.runUntil({ steps: 2 })).steps).toHaveLength(2);
		const e = opt.evaluations;
		expect((await opt.runUntil({ evaluations: e + 3 })).reason).toBe('evaluations');
		expect(opt.evaluations).toBeGreaterThanOrEqual(e + 3);
	});

	it('stops when stalled, on time, and does nothing when already at the target', async () => {
		const opt = new Optimizer(project(), () => 0.5, { seed: 1, lambda: 2 });
		const stalled = await opt.runUntil({ patience: 5, steps: 100 });
		expect(stalled.reason).toBe('stalled');
		expect(stalled.steps).toHaveLength(5);
		expect((await opt.runUntil({ timeMs: 0 })).steps).toHaveLength(0);
		expect((await opt.runUntil({ targetLoss: 0.6 })).reason).toBe('target');
		const ac = new AbortController();
		ac.abort();
		expect((await opt.runUntil({ steps: 10 }, { signal: ac.signal })).reason).toBe('aborted');
	});

	it('counts real progress only for patience', () => {
		const l = new RunLimits({ patience: 2, minImprovement: 0.01 }, 1);
		expect(l.after(0.995, 1)).toBe(null); // too small to count
		expect(l.after(0.95, 2)).toBe(null); // progress: resets
		expect(l.after(0.949, 3)).toBe(null);
		expect(l.after(0.948, 4)).toBe('stalled');
	});
});

describe('snapshot / restore', () => {
	it('Rng is mulberry32 and picks its sequence up from a saved state', () => {
		const a = new Rng(42);
		const m = mulberry32((42 >>> 0) ^ 0x9e3779b9);
		for (let i = 0; i < 5; i++) expect(a.next()).toBe(m());
		const b = new Rng(1);
		b.state = a.state;
		expect([a.next(), a.normal(), a.int(7)]).toEqual([b.next(), b.normal(), b.int(7)]);
	});

	it.each([
		['adaptive move mix', { colourFitRate: 0.3 }],
		['frequent colour fits', { colourFitRate: 0.5, adaptive: false }]
	] as [string, OptimizerOptions][])(
		'a restored optimiser takes exactly the steps the original would have (%s)',
		async (_, extra) => {
			// Every kind of state in play: islands, restarts and tiers, structural moves (inserts, removals), colour fits and
			// residual colours (both read the parent's render, made again on restore), momentum, adaptive move rates.
			const target = createImage(8, 8, [0.45, 0.25, 0.1, 1]);
			const goal = project();
			goal.layers[0].params.scale = 9;
			goal.layers[0].params.h_amount = 1.1;
			goal.layers[1].params.inset_x = 14;
			const keys: [number, string][] = [
				[0, 'scale'],
				[0, 'h_amount'],
				[1, 'inset_x']
			];
			let renders = 0;
			const evaluate = (p: Project) => {
				renders++;
				const g = p.layers.find((l) => l.id === 'noise1')!.params.dif_grad as Gradient;
				const [r, gr, b] = hexToRgb(g.stops[0].color);
				const image = createImage(8, 8, [r, gr, b, 1]);
				const shape = Math.hypot(
					...keys.map(([l, k]) => Number(p.layers[l].params[k]) - Number(goal.layers[l].params[k]))
				);
				const colour = Math.hypot(r - 0.45, gr - 0.25, b - 0.1);
				const layers = Math.abs(p.layers.filter((l) => l.enabled).length - 3) * 0.05;
				return { loss: shape * 0.1 + colour + layers, image, detail: { shape, colour } };
			};
			const opts: OptimizerOptions = {
				seed: 9,
				lambda: 3,
				islands: 2,
				islandSteps: 4,
				restartAfter: 4,
				structural: true,
				structuralWhen: 'always',
				structuralRate: 0.25,
				target,
				colourRange: 0.1,
				...extra
			};
			const strip = (h: StepInfo[]) => h.map(({ ms: _, ...rest }) => rest);
			const layers = (p: Project) => p.layers.map((l) => [l.type, l.name, l.enabled, l.params]);

			const original = new Optimizer(project(), evaluate, opts);
			await original.run(30);
			const snap = structuredClone(original.snapshot());
			// Snapshots are data only and stay small: each project once.
			expect(snap.bases.length).toBeLessThanOrEqual(snap.candidates.length + 2);
			const before = renders;
			const restored = new Optimizer(project(), evaluate, opts);
			await restored.restore(snap);
			const reRenders = renders - before;
			expect(reRenders).toBe(snap.candidates.filter((c) => c.image).length);
			expect(restored.evaluations).toBe(original.evaluations);
			expect(strip(restored.history)).toEqual(strip(original.history));

			const a = await original.run(40);
			const b = await restored.run(40);
			expect(strip(b)).toEqual(strip(a));
			expect(a.some((s) => s.moves.includes('colour'))).toBe(true);
			expect(a.some((s) => s.moves.some((m) => m.startsWith('structural')))).toBe(true);
			expect(a.some((s) => s.restarted || s.opened)).toBe(true);
			expect(restored.evaluations).toBe(original.evaluations);
			expect(restored.best.loss).toBe(original.best.loss);
			expect(restored.best.step).toBe(original.best.step);
			expect(restored.best.detail).toEqual(original.best.detail);
			expect(layers(restored.best.project)).toEqual(layers(original.best.project));
			expect(layers(restored.current.project)).toEqual(layers(original.current.project));
			expect(restored.entryStates().map(({ id: _, ...e }) => e)).toEqual(
				original.entryStates().map(({ id: _, ...e }) => e)
			);
		}
	);

	it('restores before the first step, and RunLimits carry on with what was left', async () => {
		const fresh = new Optimizer(project(), () => 1, { seed: 3 });
		const snap = structuredClone(fresh.snapshot());
		const again = new Optimizer(project(), () => 1, { seed: 3 });
		await again.restore(snap);
		expect(again.initialLoss).toBe(null);
		expect(strip(await again.run(3))).toEqual(strip(await fresh.run(3)));

		const l = new RunLimits({ steps: 5, patience: 2 }, 1);
		l.after(0.5, 1);
		l.after(0.5, 2);
		const r = RunLimits.restore(structuredClone(l.snapshot()));
		expect(r.after(0.5, 3)).toBe('stalled');
		const s = RunLimits.restore({ ...l.snapshot(), stop: { steps: 3 } });
		expect(s.after(0.1, 3)).toBe('steps');
		const t = RunLimits.restore({ ...l.snapshot(), stop: { timeMs: 1000 }, elapsed: 5000 });
		expect(t.check(1, 0)).toBe('time');

		function strip(h: StepInfo[]) {
			return h.map(({ ms: _, ...rest }) => rest);
		}
	});
});
