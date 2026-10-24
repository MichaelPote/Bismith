import { describe, expect, it } from 'vitest';
import { hexToRgb, linearToOklab, linearToSrgb1, oklabToLinear, rgbToHex, srgbToLinear1 } from '@/core/color';
import { P, evalCurve, sanitizeParams, sanitizeValue } from '@/core/params';
import { createProject, normalizeProject, projectFromJSON, projectToJSON } from '@/core/serialize';
import { groupMaterials, layerUnits } from '@/core/project';
import { crc32, zipStore } from '@/core/zip';

describe('color', () => {
	it('round-trips hex', () => {
		expect(rgbToHex(hexToRgb('#7a7570'))).toBe('#7a7570');
		expect(hexToRgb('#fff')).toEqual([1, 1, 1]);
		expect(hexToRgb('nope')).toEqual([0, 0, 0]);
	});
	it('round-trips sRGB transfer for every 8-bit level', () => {
		for (let i = 0; i < 256; i++) {
			const v = i / 255;
			expect(Math.round(linearToSrgb1(srgbToLinear1(v)) * 255)).toBe(i);
		}
	});
	it('round-trips OKLab', () => {
		const c: [number, number, number] = [0.2, 0.5, 0.8];
		const back = oklabToLinear(linearToOklab(c));
		back.forEach((v, i) => expect(v).toBeCloseTo(c[i], 5));
		expect(linearToOklab([1, 1, 1])[0]).toBeCloseTo(1, 4);
	});
});

describe('params', () => {
	const defs = [
		P.float('a', 'A', 0.5, 0, 1),
		P.int('n', 'N', 3, 1, 8),
		P.enum('e', 'E', 'x', [
			['x', 'X'],
			['y', 'Y']
		]),
		P.color('c', 'C', '#ff0000'),
		P.gradient('g', 'G', { stops: [{ pos: 0, color: '#000000' }] })
	];
	it('clamps, rounds and defaults', () => {
		expect(sanitizeValue(defs[0], 4)).toBe(1);
		expect(sanitizeValue(defs[1], 2.6)).toBe(3);
		expect(sanitizeValue(defs[2], 'z')).toBe('x');
		expect(sanitizeValue(defs[3], '#ABCDEF')).toBe('#abcdef');
		const p = sanitizeParams(defs, { a: 'bad' as unknown as number, extra: 1 });
		expect(p).toEqual({ a: 0.5, n: 3, e: 'x', c: '#ff0000', g: { stops: [{ pos: 0, color: '#000000' }] } });
	});
	it('sorts and limits gradient stops', () => {
		const g = sanitizeValue(defs[4], {
			stops: [
				{ pos: 0.8, color: '#111111' },
				{ pos: 0.2, color: '#222222' }
			]
		});
		expect(g).toEqual({
			stops: [
				{ pos: 0.2, color: '#222222' },
				{ pos: 0.8, color: '#111111' }
			]
		});
	});
});

describe('curves', () => {
	const steep = {
		points: [
			{ x: 0, y: 0 },
			{ x: 0.15, y: 0.55 },
			{ x: 0.45, y: 0.82 },
			{ x: 1, y: 1 }
		]
	};
	it('passes through its points and never overshoots a rising curve', () => {
		expect(evalCurve(steep, 0)).toBeCloseTo(0);
		expect(evalCurve(steep, 0.15)).toBeCloseTo(0.55);
		expect(evalCurve(steep, 1)).toBeCloseTo(1);
		let prev = -1;
		for (let i = 0; i <= 200; i++) {
			const y = evalCurve(steep, i / 200);
			expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
			expect(y).toBeLessThanOrEqual(1 + 1e-9);
			prev = y;
		}
	});
	it('allows rims and dishes: peaks and valleys sit exactly on their points, with no overshoot', () => {
		const rimDish = {
			points: [
				{ x: 0, y: 0 },
				{ x: 0.2, y: 1 },
				{ x: 0.6, y: 0.3 },
				{ x: 1, y: 0.5 }
			]
		};
		let max = 0;
		let min = 1;
		for (let i = 0; i <= 400; i++) {
			const y = evalCurve(rimDish, i / 400);
			if (i / 400 > 0.05) min = Math.min(min, y);
			max = Math.max(max, y);
		}
		expect(max).toBeCloseTo(1, 6);
		expect(min).toBeCloseTo(0.3, 6);
		expect(evalCurve(rimDish, 0.2)).toBeCloseTo(1);
		expect(evalCurve(rimDish, 0.6)).toBeCloseTo(0.3);
	});
	it('sanitises: clamps, sorts, drops duplicates, needs two points', () => {
		const d = P.curve('c', 'C', steep);
		expect(
			sanitizeValue(d, {
				points: [
					{ x: 1.5, y: 2 },
					{ x: -1, y: 0 },
					{ x: 0.5, y: 0.5 },
					{ x: 0.5, y: 0.6 }
				]
			})
		).toEqual({
			points: [
				{ x: 0, y: 0 },
				{ x: 0.5, y: 0.5 },
				{ x: 1, y: 1 }
			]
		});
		expect(sanitizeValue(d, { points: [{ x: 0.2, y: 0.2 }] })).toEqual(steep);
	});
});

describe('serialize', () => {
	it('round-trips a default project', () => {
		const p = createProject();
		const back = projectFromJSON(projectToJSON(p));
		expect(back).toEqual(p);
	});
	it('fills defaults and drops unknown types', () => {
		const p = normalizeProject({
			width: 99999,
			layers: [{ type: 'noise' }, { type: 'does-not-exist' }],
			post: [{ type: 'tonemap' }]
		});
		expect(p.width).toBe(2048);
		expect(p.layers).toHaveLength(1);
		expect(p.layers[0].params.noise).toBe('perlin');
		expect(p.layers[0].params.h_on).toBe(true);
		expect(p.post[0].params.operator).toBe('aces');
		expect(p.lighting.sky.enabled).toBe(true);
	});
	it("keeps a point light's reference distance when valid", () => {
		const p = normalizeProject({
			lighting: {
				lights: [
					{ type: 'point', refDist: 128 },
					{ type: 'point', refDist: -1 },
					{ type: 'point', refDist: 'x' },
					{ type: 'directional', refDist: 128 }
				]
			}
		});
		expect(p.lighting.lights.map((l) => l.refDist)).toEqual([128, undefined, undefined, undefined]);
	});
	it('puts a legacy relief stack first in the one list, with its colour outputs off', () => {
		const p = normalizeProject({
			relief: [
				{ type: 'bricks', params: { dif_on: true, h_on: true, e_on: true } },
				{ type: 'blur', params: { diffuse: true, height: true } }
			],
			layers: [{ type: 'noise', params: { dif_on: true } }]
		});
		expect(p.layers.map((l) => l.type)).toEqual(['bricks', 'blur', 'noise']);
		expect([p.layers[0].params.dif_on, p.layers[0].params.e_on, p.layers[0].params.h_on]).toEqual([false, false, true]);
		expect([p.layers[1].params.diffuse, p.layers[1].params.height]).toEqual([false, true]);
		expect(p.layers[2].params.dif_on).toBe(true);
		expect('relief' in p).toBe(false);
	});
	it("gathers each smart material's members into one block where its last member is", () => {
		const p = normalizeProject({
			relief: [
				{ id: 'a1', type: 'bricks' },
				{ id: 'b1', type: 'bricks' },
				{ id: 'x', type: 'noise' }
			],
			layers: [
				{ id: 'y', type: 'noise' },
				{ id: 'a2', type: 'noise' },
				{ id: 'b2', type: 'noise' }
			],
			materials: [
				{ id: 'ma', recipe: 'tiles', members: { r: 'a1', p: 'a2' } },
				{ id: 'mb', recipe: 'tiles', members: { r: 'b1', p: 'b2' } }
			]
		});
		// Colour layers keep their order (y, a2, b2); the relief members join their material.
		expect(p.layers.map((l) => l.id)).toEqual(['x', 'y', 'a1', 'a2', 'b1', 'b2']);
		const units = layerUnits(p.layers, p.materials);
		expect(units.map((u) => (u.material ? u.material.id : u.layer.id))).toEqual(['x', 'y', 'ma', 'mb']);
		expect(groupMaterials(p.layers, p.materials)).toEqual(p.layers);
	});
	it('migrates the old single specular setting to base level × render scale with the same F0', () => {
		const old = normalizeProject({ base: { color: '#806040' }, render: { specular: 0.8 } });
		expect(old.base.specular).toBe(0.5);
		expect(0.08 * old.base.specular * old.render.specular).toBeCloseTo(0.08 * 0.8);
		const off = normalizeProject({ render: { specular: 0 } });
		expect(off.base.specular * off.render.specular).toBe(0);
		const cur = normalizeProject({ base: { specular: 0.2 }, render: { specular: 1.5 } });
		expect([cur.base.specular, cur.render.specular]).toEqual([0.2, 1.5]);
	});
});

describe('zip', () => {
	it('computes the standard CRC-32', () => {
		expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
	});
	it('writes a valid end-of-central-directory record', () => {
		const z = zipStore([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]);
		const v = new DataView(z.buffer);
		expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
		expect(v.getUint16(z.length - 22 + 10, true)).toBe(1);
	});
});

describe('supersampling', () => {
	it('scales pixel-unit params, point lists, height depth and AO radius; leaves counts and fractions alone', async () => {
		const { scaleProject, supersampleFactor } = await import('@/core/supersample');
		const { createLayer, createLight, createProject } = await import('@/core/serialize');
		const p = createProject({
			width: 64,
			height: 32,
			heightDepth: 2.5,
			layers: [
				createLayer('bricks', { columns: 4, mortar: 1.5, bevel: 2 }),
				createLayer('path', { points: '8,16 24,8 56,8' }),
				createLayer('noise', { noise: 'white', block: 1, scale: 6 }),
				createLayer('scratches', { density: 18 })
			]
		});
		p.render.supersample = 3;
		expect(supersampleFactor(p)).toBe(3);
		const q = scaleProject(p, 3);
		expect([q.width, q.height, q.heightDepth]).toEqual([192, 96, 7.5]);
		expect(q.layers[0].params.columns).toBe(4);
		expect(q.layers[0].params.mortar).toBe(4.5);
		expect(q.layers[0].params.bevel).toBe(6);
		expect(q.layers[1].params.points).toBe('24,48 72,24 168,24');
		expect(q.layers[2].params.block).toBe(3);
		expect(q.layers[2].params.scale).toBe(6);
		// Scratches per 64×64 px: 9× the pixels at 3× → a ninth of the density, the same scratches in the texture.
		expect(q.layers[3].params.density).toBe(2);
		expect(q.render.aoRadius).toBe(p.render.aoRadius * 3);
		p.lighting.lights.push(createLight('point', { z: 48 }));
		const lit = scaleProject(p, 3).lighting.lights.at(-1)!;
		expect([lit.params.z, lit.refDist]).toEqual([144, 192]);
		expect(p.width).toBe(64); // input untouched
	});
});

describe('canvas resize', () => {
	it('scales pixel-measured values with the canvas: lengths by the side, positions per axis, counts per area', async () => {
		const { resizeProject } = await import('@/core/pixelScale');
		const { createLayer, createLight, createPostFilter } = await import('@/core/serialize');
		const { addMaterial } = await import('@/recipes');
		const p = createProject({
			width: 64,
			height: 64,
			heightDepth: 2,
			layers: [
				createLayer('bricks', { columns: 4, mortar: 1.5, bevel: 2, ofs_x: 4, ofs_y: 2 }),
				createLayer('path', { points: '8,16 24,8 56,8' }),
				createLayer('scratches', { density: 16 }),
				createLayer('cavity', { radius: 3, sensitivity: 0.5 }),
				createLayer('rock', { px_scale: 1 })
			],
			post: [createPostFilter('pixelate', { size: 3 })]
		});
		p.lighting.lights.push(createLight('point', { z: 48 }));
		const m = addMaterial(p, 'tiles', { size: 16 });
		const q = resizeProject(p, 128, 128);
		expect([q.width, q.height, q.heightDepth, q.render.aoRadius]).toEqual([128, 128, 4, p.render.aoRadius * 2]);
		expect([q.layers[0].params.columns, q.layers[0].params.mortar, q.layers[0].params.bevel]).toEqual([4, 3, 4]);
		expect(q.layers[1].params.points).toBe('16,32 48,16 112,16');
		expect(q.layers[2].params.density).toBe(4);
		expect(q.post[0].params.size).toBe(6);
		// Per-px gains shrink; one output pixel stays one pixel (it grows only under supersampling).
		expect([q.layers[3].params.radius, q.layers[3].params.sensitivity]).toEqual([6, 0.25]);
		expect(q.layers[4].params.px_scale).toBe(1);
		const { scaleProject } = await import('@/core/supersample');
		expect(scaleProject(p, 2).layers[4].params.px_scale).toBe(2);
		expect(q.lighting.lights.at(-1)!.params.z).toBe(96);
		// The point light's falloff reference grows with its distances, so it lights the surface as brightly.
		expect(q.lighting.lights.at(-1)!.refDist).toBe(128);
		expect(q.lighting.lights[0].refDist).toBeUndefined(); // directional
		expect(q.materials!.find((x) => x.id === m.id)!.params.size).toBe(32);
		expect(p.width).toBe(64); // input untouched
		// Wider only: offsets and vertices follow their axis, lengths the side of the area (√2 here).
		const w = resizeProject(p, 128, 64);
		expect([w.layers[0].params.ofs_x, w.layers[0].params.ofs_y]).toEqual([8, 2]);
		expect(w.layers[1].params.points).toBe('16,16 48,8 112,8');
		expect(w.layers[0].params.bevel).toBeCloseTo(2 * Math.SQRT2, 4);
		expect(resizeProject(w, 128, 128).layers[0].params.bevel).toBeCloseTo(4, 4);
		// Lengths tied to an axis follow that side: drips fall down (length by the height, width by the width); a cable's
		// radius is across it, so a horizontal cable takes the height's factor and a vertical one the width's.
		const a = createProject({
			width: 64,
			height: 64,
			layers: [
				createLayer('drips', { len_max: 20, width: 2 }),
				createLayer('cable', { axis: 'horizontal', radius: 10 }),
				createLayer('cable', { axis: 'vertical', radius: 10 })
			]
		});
		const aw = resizeProject(a, 128, 64).layers.map((l) => l.params);
		expect([aw[0].len_max, aw[0].width, aw[1].radius, aw[2].radius]).toEqual([20, 4, 10, 20]);
		// Orientation picks the axis: vertical bands' width is across them (x); a horizontal rect's height is y.
		const b = createProject({
			width: 64,
			height: 64,
			layers: [
				createLayer('bands', { orient: '90', width: 10, chamfer: 4 }),
				createLayer('bands', { orient: '45', width: 10 }),
				createLayer('rect', { width: 20, height: 10 })
			]
		});
		const bw = resizeProject(b, 128, 64).layers.map((l) => l.params);
		expect([bw[0].width, bw[0].chamfer, bw[2].width, bw[2].height]).toEqual([20, 4, 40, 10]);
		expect(bw[1].width).toBeCloseTo(10 * Math.SQRT2, 3);
		// Ints round, values clamp to their hard limits.
		expect(resizeProject(p, 80, 80).post[0].params.size).toBe(4);
		expect(resizeProject(p, 1, 1).post[0].params.size).toBe(1);
	});

	it('fits a fresh light to the canvas as a resize from the 128 px reference would', async () => {
		const { fitLight, resizeProject } = await import('@/core/pixelScale');
		const { createLight } = await import('@/core/serialize');
		const { LIGHT_DEFS, LIGHT_REF_SIZE, POINT_LIGHT_REF_DIST } = await import('@/core/lights');
		const def = (k: string) => Number(LIGHT_DEFS.point.params.find((d) => d.key === k)!.default);
		const at = (width: number, height: number) => fitLight(createLight('point'), { width, height });
		const ref = at(LIGHT_REF_SIZE, LIGHT_REF_SIZE);
		expect([ref.params.z, ref.params.radius, ref.refDist]).toEqual([def('z'), def('radius'), POINT_LIGHT_REF_DIST]);
		const big = at(1024, 1024);
		expect([big.params.z, big.params.radius, big.refDist]).toEqual([8 * def('z'), 8 * def('radius'), 512]);
		const small = at(64, 64);
		expect([small.params.z, small.refDist]).toEqual([def('z') / 2, 32]);
		// Fractions, range 0 and colour stay; non-square canvases take √(w·h), like resizing.
		expect([big.params.x, big.params.y, big.params.range, big.params.color]).toEqual([0.3, 0.3, 0, '#fff4e0']);
		const wide = at(512, 128);
		expect([wide.params.z, wide.refDist]).toEqual([2 * def('z'), 128]);
		const p = createProject({ width: 128, height: 128 });
		p.lighting.lights = [fitLight(createLight('point'), p)];
		const q = resizeProject(p, 512, 256).lighting.lights[0];
		const direct = at(512, 256);
		expect([q.params.z, q.params.radius, q.refDist]).toEqual([direct.params.z, direct.params.radius, direct.refDist]);
		// A directional light has nothing in px.
		expect(fitLight(createLight('directional'), { width: 1024, height: 1024 })).toMatchObject({
			params: createLight('directional').params
		});
	});
});

describe('shape mask (the register)', () => {
	it('writes the Shape mask from shape layers by default; old mask keys drop on load (FR8.23)', async () => {
		const { createLayer } = await import('@/core/serialize');
		const { layerParamDefs } = await import('@/layers/registry');
		// Shape layers write the Shape mask in Normal mode; other generators write none until given one.
		expect([createLayer('rect').params.mk_target, createLayer('rect').params.mk_op]).toEqual(['Shape', 'replace']);
		expect(createLayer('noise').params.mk_target).toBe('');
		expect(layerParamDefs('rect').find((d) => d.key === 'mk_target')?.group).toBe('mask');
		expect(layerParamDefs('noise').find((d) => d.key === 'lim_1')?.group).toBe('mask');
		// No migration (nothing released): an old file loads, its old keys gone and the new ones at their defaults.
		const p = createProject({ width: 32, height: 32, layers: [] });
		p.layers.push({
			...createLayer('rect'),
			params: { ...createLayer('rect').params, sm_on: false, m_clip: 'inside', mk_write: '2' } as never
		});
		const loaded = normalizeProject(JSON.parse(JSON.stringify(p))).layers[0].params;
		expect(['sm_on', 'm_clip', 'mk_write'].filter((k) => k in loaded)).toEqual([]);
		expect([loaded.mk_target, loaded.lim_1]).toEqual(['Shape', '']);
	});
});
