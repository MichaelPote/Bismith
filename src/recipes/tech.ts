// Tech lumps tuned against references (FR8.6): grates and vents, metal plate (incl. tread plate), light panels and
// circuit boards. Crisp edges, minimal relief.

import { P, type Gradient, type ParamValues } from '@/core/params';
import { L, across, clamp, crisp, gradient, lerp, metalGradient, num, r2, shade } from './parts';
import type { RecipeDef, RecipeLayer } from './types';
import { BRICKS_REGULAR } from '@/layers/generators/patterns';

const rustRamp = (hex: string) => shade(hex, 0.6);

export const grate: RecipeDef = {
	id: 'grate',
	label: 'Grate & vents',
	description:
		'A grid of slots, holes or louvres in a plate, optionally framed and bolted: floor grates, wall vents, grilles.',
	groups: [
		{ id: 'holes', label: 'Holes' },
		{ id: 'frame', label: 'Frame' },
		{ id: 'colour', label: 'Colour' }
	],
	params: [
		P.enum(
			'mode',
			'Openings',
			'slots',
			[
				['slots', 'Slots'],
				['holes', 'Holes'],
				['louvers', 'Louvres']
			],
			{ group: 'holes' }
		),
		P.int('cols', 'Columns', 5, 1, 64, { group: 'holes', softMax: 16 }),
		P.int('rows', 'Rows', 10, 1, 128, { group: 'holes', softMax: 32 }),
		P.enum(
			'orient',
			'Direction',
			'horizontal',
			[
				['horizontal', 'Horizontal'],
				['vertical', 'Vertical']
			],
			{ group: 'holes' }
		),
		P.float('fill', 'Opening length', 0.8, 0.1, 1, {
			group: 'holes',
			step: 0.01,
			hint: 'Share of the cell along the slot'
		}),
		P.float('width', 'Opening width', 3, 0.5, 32, { group: 'holes', softMax: 12, unit: 'px', step: 0.5 }),
		P.enum(
			'ends',
			'Ends',
			'square',
			[
				['square', 'Square'],
				['round', 'Round'],
				['pointed', 'Pointed (45°)'],
				['angled', 'Angled (45° cut)']
			],
			{ group: 'holes' }
		),
		P.float('stagger', 'Stagger', 0, 0, 1, { group: 'holes', step: 0.01 }),
		P.float('frame', 'Frame width', 6, 0, 64, {
			group: 'frame',
			softMax: 16,
			unit: 'px',
			step: 0.5,
			hint: '0 = an endless grille'
		}),
		P.bool('seam', 'Border seam', true, {
			group: 'frame',
			hint: 'A 1 px seam at the tile edge, the frame lit along it'
		}),
		P.int('tabs', 'Edge tabs', 0, 0, 16, {
			group: 'frame',
			hint: 'Clip notches cut into each side of the frame (0 = none)'
		}),
		P.enum(
			'tab_shape',
			'Tab shape',
			'trapezoid',
			[
				['trapezoid', 'Trapezoid (45°)'],
				['notch', 'Notch'],
				['chevron', 'Chevron']
			],
			{ group: 'frame' }
		),
		P.float('tab_length', 'Tab length', 8, 1, 64, { group: 'frame', softMax: 24, unit: 'px', step: 0.5 }),
		P.float('tab_depth', 'Tab depth', 4, 0.5, 32, { group: 'frame', softMax: 12, unit: 'px', step: 0.5 }),
		P.bool('bolts', 'Corner bolts', false, { group: 'frame' }),
		P.gradient('metal', 'Plate colours', metalGradient('#3a3836', '#464442', '#52504e'), {
			group: 'colour',
			hint: 'The plate is metal and reflects in these colours'
		}),
		P.gradient('frame_colour', 'Frame colours', metalGradient('#262422', '#2e2c2a', '#363432'), { group: 'colour' }),
		P.color('hole', 'Openings', '#050505', { group: 'colour' }),
		P.float('dirt', 'Dirt', 0.4, 0, 1, { group: 'colour', step: 0.01 }),
		P.seed('seed', 'Seed', 41, { group: 'holes' })
	],
	render: { ao: 0.8, aoRadius: 1 },
	build(m, ctx) {
		const seed = num(m.seed, 41);
		const frame = num(m.frame, 6);
		const cols = Math.max(1, Math.round(num(m.cols, 5)));
		const rows = Math.max(1, Math.round(num(m.rows, 10)));
		const horiz = m.orient !== 'vertical';
		const cell = horiz ? (ctx.width - 2 * frame) / cols : (ctx.height - 2 * frame) / rows;
		const v: ParamValues = {
			mode: m.mode ?? 'slots',
			cols,
			rows,
			orient: horiz ? 'horizontal' : 'vertical',
			length: r2(Math.max(1, cell * num(m.fill, 0.8))),
			width: num(m.width, 3),
			ends: m.ends ?? 'square',
			stagger: num(m.stagger, 0),
			louver: 0.8,
			margin: frame,
			field_level: 0.6,
			aa: false,
			seed,
			// A square frame (the border seam and tabs are drawn to it) and true 45° pointed / angled ends.
			round: 0,
			outer: 0,
			tip: 0.5
		};
		const hole = String(m.hole ?? '#050505');
		const metal = m.metal ?? metalGradient('#2c2a28', '#4a4846');
		const frameCol = m.frame_colour ?? metalGradient('#55524e', '#7c7975');
		const bolt = {
			radius: 1.2,
			x: r2(Math.min(0.45, (frame / 2 + 0.5) / (ctx.width / 2))),
			y: r2(Math.min(0.45, (frame / 2 + 0.5) / (ctx.height / 2))),
			rep_x: 2,
			rep_y: 2,
			rep_mirror: true,
			aa: false,
			mk_target: '',
			seed: seed + 5
		};
		const tabs = Math.max(0, Math.round(num(m.tabs, 0)));
		const tab = {
			shape: m.tab_shape ?? 'trapezoid',
			place: 'border',
			edges: horiz ? 'sides' : 'ends',
			distribute: 'count',
			count: Math.max(1, tabs),
			length: num(m.tab_length, 8),
			depth: num(m.tab_depth, 4),
			cut: 1,
			thickness: 1.5,
			inset: 0,
			aa: false,
			seed: seed + 7
		};
		// The openings are painted black only in a core one pixel in, so the slot walls keep the metal colour and show the
		// light: lit on the walls facing it (bottom / right under a top-left light), dark on the others.
		const core = {
			...v,
			width: r2(Math.max(0.5, num(m.width, 3) - 1)),
			length: r2(Math.max(0.5, Number(v.length) - 1))
		};
		const out: RecipeLayer[] = [
			{
				role: 'frame',
				stack: 'relief',
				layer: L(
					'vents',
					'Frame',
					{
						...v,
						output: 'frame',
						bevel: 0.75,
						profile: 'linear',
						mk_target: '',
						h_on: true,
						h_amount: 0.25,
						dif_on: false,
						s_on: true,
						s_mode: 'replace',
						s_src: 'flat',
						s_a: 0.35,
						s_b: 0.35
					},
					frame > 0
				)
			},
			{
				role: 'seam',
				stack: 'relief',
				layer: L(
					'bricks',
					'Border seam',
					{
						...BRICKS_REGULAR,
						columns: 1,
						rows: 1,
						stagger: 0,
						mortar: 1,
						round: 0,
						aa: false,
						seed: seed + 6,
						bevel: 0.75,
						profile: 'linear',
						mk_target: '',
						h_on: true,
						h_amount: 0.2,
						dif_on: false
					},
					frame > 0 && m.seam !== false
				)
			},
			{
				role: 'tabs',
				stack: 'relief',
				layer: L(
					'tabs',
					'Edge tabs',
					{
						...tab,
						bevel: 0.5,
						profile: 'linear',
						mk_target: '',
						h_on: true,
						h_mode: 'subtract',
						h_amount: 0.2,
						dif_on: false
					},
					tabs > 0 && frame > 0
				)
			},
			{
				role: 'slots',
				stack: 'relief',
				layer: L('vents', 'Slot walls', {
					...v,
					output: 'slots',
					bevel: 1,
					profile: 'linear',
					mk_op: 'replace',
					h_on: true,
					h_mode: 'subtract',
					h_amount: 0.35,
					dif_on: false
				})
			},
			{
				role: 'bolts',
				stack: 'relief',
				layer: L(
					'circle',
					'Bolts',
					{ ...bolt, bevel: 1, profile: 'round', h_on: true, h_amount: 0.2, dif_on: false },
					m.bolts === true && frame > 0
				)
			},
			// Fine grain, not blotches (a colour fit stretches broad mottle into patches).
			{
				role: 'plate',
				stack: 'paint',
				layer: L('noise', 'Plate', {
					noise: 'value',
					fractal: 'fbm',
					scale: across(ctx, 2.5),
					octaves: 2,
					seed: seed + 1,
					sh_lo: 0.15,
					sh_hi: 0.85,
					h_on: false,
					dif_on: true,
					dif_grad: metal,
					mt_on: true,
					mt_src: 'flat'
				})
			},
			{
				role: 'frame-colour',
				stack: 'paint',
				layer: L(
					'vents',
					'Frame colour',
					{
						...v,
						output: 'frame',
						bevel: 0,
						profile: 'flat',
						mk_target: '',
						h_on: false,
						dif_on: true,
						dif_src: 'value',
						dif_grad: frameCol
					},
					frame > 0
				)
			},
			{
				role: 'tab-colour',
				stack: 'paint',
				layer: L(
					'tabs',
					'Tab shade',
					{
						...tab,
						mk_target: '',
						h_on: false,
						dif_on: true,
						dif_src: 'flat',
						dif_blend: 'multiply',
						dif_opacity: 0.6,
						dif_grad: gradient('#6a6a6a')
					},
					tabs > 0 && frame > 0
				)
			},
			{
				role: 'bolt-colour',
				stack: 'paint',
				layer: L(
					'circle',
					'Bolt colour',
					{
						...bolt,
						h_on: false,
						dif_on: true,
						dif_src: 'flat',
						dif_grad: metalGradient('#8a8784'),
						mt_on: true,
						mt_src: 'flat'
					},
					m.bolts === true && frame > 0
				)
			},
			{
				role: 'speckle',
				stack: 'paint',
				layer: L('noise', 'Speckle', {
					noise: 'white',
					seed: seed + 2,
					h_on: false,
					dif_on: true,
					dif_blend: 'overlay',
					dif_opacity: 0.12,
					dif_grad: gradient('#000000', '#ffffff')
				})
			},
			{
				role: 'grime',
				stack: 'paint',
				layer: L('cavity', 'Dirt', {
					radius: 1.5,
					threshold: 0.05,
					sensitivity: 0.8,
					wear_amount: 0.15,
					wear_color: '#9a9690',
					dirt_amount: r2(num(m.dirt, 0.4)),
					dirt_color: '#0c0b0a',
					noise_scale: 8
				})
			},
			// Last, so the openings stay black whatever the grime does around them.
			{
				role: 'holes',
				stack: 'paint',
				layer: L('vents', 'Openings', {
					...core,
					output: 'slots',
					bevel: 0,
					profile: 'flat',
					mk_target: '',
					h_on: false,
					dif_on: true,
					dif_src: 'flat',
					dif_grad: gradient(hole),
					// Holes, not metal.
					mt_b: 0
				})
			}
		];
		return out;
	}
};

export const metalPlate: RecipeDef = {
	id: 'metal-plate',
	label: 'Metal plate',
	description:
		'Iron or steel plate: fine mottle, rust patches and scratches; optional tread pattern, seams and rivets.',
	groups: [
		{ id: 'surface', label: 'Surface' },
		{ id: 'pattern', label: 'Pattern' },
		{ id: 'colour', label: 'Colour' }
	],
	params: [
		P.float('mottle', 'Mottle', 0.5, 0, 1, { group: 'surface', step: 0.01 }),
		P.float('grain', 'Grain size', 3, 1, 32, { group: 'surface', softMax: 12, unit: 'px', step: 0.5 }),
		P.float('rust', 'Rust', 0.3, 0, 1, { group: 'surface', step: 0.01 }),
		P.float('scratches', 'Scratches', 0.2, 0, 1, { group: 'surface', step: 0.01 }),
		P.float('speckle', 'Speckle', 0.15, 0, 1, { group: 'surface', step: 0.01 }),
		P.enum(
			'tread',
			'Tread',
			'none',
			[
				['none', 'None'],
				['lozenge', 'Diamond plate'],
				['capsule', 'Capsules'],
				['bars', 'Bars'],
				['stud', 'Studs']
			],
			{ group: 'pattern' }
		),
		P.int('tread_count', 'Tread cells across', 8, 1, 64, { group: 'pattern', softMax: 24 }),
		P.int('seams', 'Plates across', 0, 0, 16, { group: 'pattern', hint: '0 = one plate' }),
		P.enum(
			'rivets',
			'Rivets',
			'none',
			[
				['none', 'None'],
				['corners', 'Corners'],
				['grid', 'Grid']
			],
			{ group: 'pattern' }
		),
		P.int('rivet_count', 'Rivets across', 4, 1, 32, { group: 'pattern', showIf: (p) => p.rivets === 'grid' }),
		P.gradient('metal', 'Metal colours', metalGradient('#241a12', '#2e2218', '#3a2c20'), {
			group: 'colour',
			hint: 'The plate reflects in these colours (metalness 1), so they are brighter than it looks in shade'
		}),
		P.color('rust_colour', 'Rust colour', '#5a3418', { group: 'colour' }),
		P.float('dirt', 'Dirt', 0.3, 0, 1, { group: 'colour', step: 0.01 }),
		P.seed('seed', 'Seed', 51, { group: 'surface' })
	],
	render: { ao: 0.6, aoRadius: 2 },
	build(m, ctx) {
		const seed = num(m.seed, 51);
		const metal = m.metal ?? metalGradient('#241a12', '#3a2c20');
		const mot = num(m.mottle, 0.5);
		const rust = num(m.rust, 0.3);
		const tread = String(m.tread ?? 'none');
		const tc = Math.max(1, Math.round(num(m.tread_count, 8)));
		const seams = Math.max(0, Math.round(num(m.seams, 0)));
		const rivets = String(m.rivets ?? 'none');
		const rn = rivets === 'grid' ? Math.max(1, Math.round(num(m.rivet_count, 4))) : 2;
		const riv = {
			radius: 1.1,
			x: rivets === 'grid' ? 0.5 : 0.12,
			y: rivets === 'grid' ? 0.5 : 0.12,
			rep_x: rn * Math.max(1, seams),
			rep_y: rivets === 'grid' ? Math.max(1, Math.round((rn * ctx.height) / ctx.width)) : 2,
			rep_mirror: rivets !== 'grid',
			aa: false,
			mk_target: '',
			seed: seed + 6
		};
		// Each tread style brings its own arrangement and proportions (the treadplate's style-linked defaults).
		const tp = {
			style: tread === 'none' ? 'lozenge' : tread,
			count_x: tc,
			count_y: Math.max(1, Math.round((tc * ctx.height) / ctx.width)),
			aa: false,
			seed: seed + 7
		};
		const out: RecipeLayer[] = [
			{
				role: 'seams',
				stack: 'relief',
				layer: L(
					'bricks',
					'Plates',
					{
						...BRICKS_REGULAR,
						columns: Math.max(1, seams),
						rows: 1,
						stagger: 0,
						mortar: 1,
						round: 0,
						aa: false,
						seed: seed + 8,
						bevel: 1,
						profile: 'custom',
						bevel_curve: crisp(),
						mk_op: 'replace',
						h_on: true,
						h_amount: 0.25,
						dif_on: false
					},
					seams > 0
				)
			},
			{
				role: 'tread',
				stack: 'relief',
				layer: L(
					'treadplate',
					'Tread',
					{
						...tp,
						bevel: 0.75,
						profile: 'linear',
						mk_target: '',
						h_on: true,
						h_amount: 0.22,
						dif_on: false
					},
					tread !== 'none'
				)
			},
			{
				role: 'rivets',
				stack: 'relief',
				layer: L(
					'circle',
					'Rivets',
					{ ...riv, bevel: 1, profile: 'round', h_on: true, h_amount: 0.2, dif_on: false },
					rivets !== 'none'
				)
			},
			{
				role: 'dents',
				stack: 'relief',
				layer: L('noise', 'Dents', {
					noise: 'perlin',
					fractal: 'fbm',
					scale: across(ctx, 12),
					octaves: 2,
					seed: seed + 9,
					h_on: true,
					h_amount: 0.06,
					dif_on: false,
					// The plate's finish, rougher in the dents so the glints come and go.
					r_on: true,
					r_mode: 'replace',
					r_src: 'value',
					r_a: 0.7,
					r_b: 0.5
				})
			},
			{
				role: 'metal',
				stack: 'paint',
				layer: L('noise', 'Metal', {
					noise: 'value',
					fractal: 'fbm',
					scale: across(ctx, num(m.grain, 3) * 3),
					octaves: 4,
					seed: seed + 1,
					sh_lo: r2(0.5 - 0.5 * mot),
					sh_hi: r2(0.5 + 0.5 * mot),
					h_on: false,
					dif_on: true,
					dif_grad: metal,
					mt_on: true,
					mt_src: 'flat'
				})
			},
			{
				role: 'rust',
				stack: 'paint',
				layer: L(
					'noise',
					'Rust',
					{
						noise: 'perlin',
						fractal: 'fbm',
						scale: across(ctx, 14),
						octaves: 4,
						seed: seed + 2,
						sh_cut: r2(lerp(0.85, 0.45, rust)),
						sh_cut_soft: 0.12,
						h_on: false,
						dif_on: true,
						dif_opacity: 0.85,
						dif_grad: rustRamp(String(m.rust_colour ?? '#5a3418')),
						// Rust is not metal, and rough.
						r_on: true,
						r_src: 'flat',
						r_b: 0.85,
						r_opacity: 0.85,
						mt_on: true,
						mt_src: 'flat',
						mt_b: 0,
						mt_opacity: 0.85
					},
					rust > 0
				)
			},
			{
				role: 'tread-colour',
				stack: 'paint',
				layer: L(
					'treadplate',
					'Tread highlights',
					{
						...tp,
						bevel: 1,
						profile: 'linear',
						crown: 0,
						crest: 0,
						mk_target: '',
						h_on: false,
						r_on: false,
						s_on: false,
						dif_on: true,
						dif_blend: 'screen',
						dif_opacity: 0.55,
						dif_src: 'value',
						dif_grad: gradient('#000000', '#7a6a58')
					},
					tread !== 'none'
				)
			},
			{
				role: 'scratches',
				stack: 'paint',
				layer: L(
					'scratches',
					'Scratches',
					{
						density: r2(4 + 30 * num(m.scratches, 0.2)),
						len_min: 3,
						len_max: 12,
						thickness: 1,
						taper: 0.6,
						angle: 15,
						angle_jitter: 50,
						fade: 0.6,
						aa: false,
						seed: seed + 3,
						h_on: false,
						dif_on: true,
						dif_blend: 'screen',
						dif_opacity: 0.45,
						dif_grad: gradient('#000000', '#6a625a')
					},
					num(m.scratches, 0.2) > 0
				)
			},
			{
				role: 'speckle',
				stack: 'paint',
				layer: L(
					'noise',
					'Speckle',
					{
						noise: 'white',
						seed: seed + 4,
						h_on: false,
						dif_on: true,
						dif_blend: 'overlay',
						dif_opacity: r2(num(m.speckle, 0.15)),
						dif_grad: gradient('#000000', '#ffffff')
					},
					num(m.speckle, 0.15) > 0
				)
			},
			{
				role: 'rivet-colour',
				stack: 'paint',
				layer: L(
					'circle',
					'Rivet colour',
					{
						...riv,
						bevel: 1,
						profile: 'linear',
						h_on: false,
						dif_on: true,
						dif_src: 'value',
						dif_grad: metalGradient('#3a3028', '#7a7068'),
						mt_on: true,
						mt_src: 'flat'
					},
					rivets !== 'none'
				)
			},
			{
				role: 'grime',
				stack: 'paint',
				layer: L('cavity', 'Dirt', {
					radius: 1.5,
					threshold: 0.05,
					sensitivity: 0.8,
					wear_amount: 0.25,
					wear_color: '#7a6e64',
					dirt_amount: r2(num(m.dirt, 0.3)),
					dirt_color: '#0c0908',
					noise_scale: 8
				})
			}
		];
		return out;
	}
};

export const lightPanel: RecipeDef = {
	id: 'light-panel',
	label: 'Light panel',
	fit: 'lightness',
	description: 'Glowing tubes in dark recessed housings on a metal panel (fluorescent strips, tech lights).',
	groups: [
		{ id: 'tubes', label: 'Tubes' },
		{ id: 'colour', label: 'Colour' }
	],
	params: [
		P.int('housings', 'Housings', 4, 1, 16, { group: 'tubes' }),
		P.int('tubes', 'Tubes per housing', 2, 1, 4, { group: 'tubes' }),
		P.enum(
			'orient',
			'Direction',
			'vertical',
			[
				['vertical', 'Vertical'],
				['horizontal', 'Horizontal']
			],
			{ group: 'tubes' }
		),
		P.float('tube', 'Tube width', 3, 1, 16, { group: 'tubes', unit: 'px', step: 0.5 }),
		P.float('margin', 'End margin', 4, 0, 32, { group: 'tubes', unit: 'px', step: 0.5 }),
		P.float('rim', 'Housing rim', 2, 0, 8, { group: 'tubes', unit: 'px', step: 0.5 }),
		P.gradient('glow', 'Tube colours', gradient('#9a5a08', '#e8b020', '#f8e070'), {
			group: 'colour',
			hint: 'Edge → core'
		}),
		P.float('intensity', 'Glow', 0.35, 0, 4, { group: 'colour', step: 0.01 }),
		P.gradient('panel', 'Panel colours', metalGradient('#141210', '#201c18', '#2c2620'), {
			group: 'colour',
			hint: 'The panel is metal and reflects in these colours'
		}),
		P.color('housing', 'Housing', '#060504', { group: 'colour' }),
		P.seed('seed', 'Seed', 61, { group: 'tubes' })
	],
	render: { ao: 0.6, aoRadius: 2 },
	build(m, ctx) {
		const seed = num(m.seed, 61);
		const n = Math.max(1, Math.round(num(m.housings, 4)));
		const k = Math.max(1, Math.round(num(m.tubes, 2)));
		const vert = m.orient !== 'horizontal';
		const span = vert ? ctx.width : ctx.height;
		const cellW = span / n;
		const rim = num(m.rim, 2);
		const tube = num(m.tube, 3);
		const margin = num(m.margin, 4);
		const along = (vert ? ctx.height : ctx.width) - 2 * margin;
		const houseW = clamp(cellW - 2 * rim, 2, cellW);
		const size = (w: number, l: number) => (vert ? { width: r2(w), height: r2(l) } : { width: r2(l), height: r2(w) });
		const reps = (nx: number) => (vert ? { rep_x: nx, rep_y: 1 } : { rep_x: 1, rep_y: nx });
		const house = {
			size_mode: 'size',
			...size(houseW, along),
			x: 0.5,
			y: 0.5,
			radius: 1,
			...reps(n),
			aa: false,
			seed: seed + 1
		};
		// Tubes: k per housing, evenly spread across it — one layer per tube position (up to 4), repeated per housing.
		const tubeCell = houseW / k;
		const tubeAt = (i: number) => {
			const centre = r2((rim + tubeCell * (i + 0.5)) / cellW);
			return {
				size_mode: 'size',
				...size(tube, along - 2),
				x: vert ? centre : 0.5,
				y: vert ? 0.5 : centre,
				radius: r2(tube / 2),
				...reps(n),
				aa: false,
				seed: seed + 2
			};
		};
		const glowGrad = (m.glow ?? gradient('#9a5a08', '#f8e070')) as Gradient;
		const glow = {
			dif_on: true,
			dif_src: 'value',
			dif_grad: glowGrad,
			// Glass tubes, not metal.
			mt_on: true,
			mt_src: 'flat',
			mt_b: 0,
			e_on: num(m.intensity, 0.35) > 0,
			e_src: 'value',
			e_color: glowGrad.stops.at(-1)?.color ?? '#f8e070',
			e_intensity: r2(num(m.intensity, 0.35))
		};
		const out: RecipeLayer[] = [
			{
				role: 'housing',
				stack: 'relief',
				layer: L('rect', 'Housings', {
					...house,
					bevel: 1,
					profile: 'linear',
					mk_target: '',
					h_on: true,
					h_mode: 'subtract',
					h_amount: 0.2,
					dif_on: false
				})
			}
		];
		for (let i = 0; i < 4; i++)
			out.push({
				role: `tube-${i}`,
				stack: 'relief',
				layer: L(
					'rect',
					`Tube ${i + 1}`,
					{
						...tubeAt(i),
						bevel: r2(tube / 2),
						profile: 'round',
						mk_target: '',
						h_on: true,
						h_amount: 0.15,
						dif_on: false
					},
					i < k
				)
			});
		out.push(
			{
				role: 'panel',
				stack: 'paint',
				layer: L('noise', 'Panel', {
					noise: 'value',
					fractal: 'fbm',
					scale: across(ctx, 6),
					octaves: 3,
					seed: seed + 3,
					h_on: false,
					dif_on: true,
					dif_grad: m.panel ?? metalGradient('#141210', '#2c2620'),
					mt_on: true,
					mt_src: 'flat'
				})
			},
			{
				role: 'housing-colour',
				stack: 'paint',
				layer: L('rect', 'Housing colour', {
					...house,
					mk_target: '',
					h_on: false,
					dif_on: true,
					dif_src: 'flat',
					dif_grad: gradient(String(m.housing ?? '#060504')),
					mt_on: true,
					mt_src: 'flat',
					mt_b: 0
				})
			}
		);
		for (let i = 0; i < 4; i++)
			out.push({
				role: `tube-colour-${i}`,
				stack: 'paint',
				layer: L(
					'rect',
					`Tube ${i + 1} glow`,
					{ ...tubeAt(i), bevel: r2(tube / 2), profile: 'round', mk_target: '', h_on: false, ...glow },
					i < k
				)
			});
		out.push({
			role: 'speckle',
			stack: 'paint',
			layer: L('noise', 'Speckle', {
				noise: 'white',
				seed: seed + 4,
				h_on: false,
				dif_on: true,
				dif_blend: 'overlay',
				dif_opacity: 0.12,
				dif_grad: gradient('#000000', '#ffffff')
			})
		});
		return out;
	}
};

export const circuit: RecipeDef = {
	id: 'circuit',
	label: 'Circuit board',
	fit: 'lightness',
	description:
		'Circuit traces routed straight and diagonally (any angle), pads on the dead ends and vias, on a board; optionally glowing.',
	groups: [
		{ id: 'traces', label: 'Traces' },
		{ id: 'colour', label: 'Colour' }
	],
	params: [
		P.int('cells', 'Cells across', 32, 2, 128, {
			group: 'traces',
			softMax: 64,
			hint: 'Node pitch: width / cells (2 px pitch = 1 px traces with 1 px gaps)'
		}),
		P.float('angle', 'Diagonal angle', 45, 10, 80, { group: 'traces', unit: '°', step: 0.5 }),
		P.float('density', 'Density', 0.7, 0, 1, { group: 'traces', step: 0.01 }),
		P.float('diagonal', 'Diagonals', 0.45, 0, 1, { group: 'traces', step: 0.01 }),
		P.float('bias', 'Horizontal bias', 0.5, 0, 1, { group: 'traces', step: 0.01 }),
		P.enum(
			'mode',
			'Routing',
			'fill',
			[
				['fill', 'Space-filling (routed)'],
				['route', 'Paths (local)'],
				['maze', 'Maze']
			],
			{ group: 'traces' }
		),
		P.enum(
			'directions',
			'Directions',
			'8',
			[
				['8', '8 (straight + diagonals)'],
				['6', '6 (hexagonal at 60°)'],
				['4', '4 (right angles)']
			],
			{ group: 'traces' }
		),
		P.float('hug', 'Run alongside', 0.6, 0, 1, {
			group: 'traces',
			step: 0.01,
			hint: 'Buses: traces following their neighbours'
		}),
		P.float('straight', 'Straightness', 0.8, 0, 1, { group: 'traces', step: 0.01 }),
		P.float('grouping', 'Grouping', 0.75, 0, 1, {
			group: 'traces',
			step: 0.01,
			hint: 'Maze: parallel bus runs instead of a tangle'
		}),
		P.int('block', 'Bus block', 5, 1, 32, { group: 'traces' }),
		P.float('width', 'Trace width', 1, 0.5, 6, { group: 'traces', unit: 'px', step: 0.25 }),
		P.float('pads', 'Pads', 0.9, 0, 1, { group: 'traces', step: 0.01, hint: 'Chance a trace end gets a pad' }),
		P.float('pins', 'Pin pads', 0.15, 0, 0.5, {
			group: 'traces',
			step: 0.01,
			hint: 'How often traces break into pad-ended pieces'
		}),
		P.float('vias', 'Vias', 0.08, 0, 1, { group: 'traces', step: 0.01 }),
		P.gradient('board', 'Board colours', gradient('#120612', '#1c0a1c', '#240e24'), { group: 'colour' }),
		P.color('trace', 'Trace colour', '#e020e0', { group: 'colour' }),
		P.float('glow', 'Glow', 0.3, 0, 2, { group: 'colour', step: 0.01 }),
		P.seed('seed', 'Seed', 71, { group: 'traces' })
	],
	build(m, ctx) {
		const seed = num(m.seed, 71);
		const w = num(m.width, 1);
		const tr = {
			cells: Math.max(2, Math.round(num(m.cells, 32))),
			angle: num(m.angle, 45),
			density: num(m.density, 0.7),
			diagonal: num(m.diagonal, 0.45),
			bias: num(m.bias, 0.5),
			mode: m.mode ?? 'fill',
			directions: m.directions ?? '8',
			hug: num(m.hug, 0.6),
			seeds: 3,
			seed_length: 160,
			max_length: 80,
			min_length: 3,
			gap: 0,
			fill: 1,
			pins: num(m.pins, 0.15),
			straight: num(m.straight, 0.8),
			grouping: num(m.grouping, 0.75),
			block: Math.max(1, Math.round(num(m.block, 5))),
			width: w,
			pads: num(m.pads, 0.9),
			pad_size: r2(w + 0.5),
			pad_shape: 'round',
			vias: num(m.vias, 0.08),
			via_size: r2(w + 1),
			aa: false,
			seed,
			// Pixel-art traces: one width, a ring as wide as the trace, crowded ends bare, short route pieces kept.
			via_ring: w,
			wide: 0,
			tight_pads: 0,
			min_links: 2
		};
		const trace = String(m.trace ?? '#e020e0');
		return [
			{
				role: 'relief',
				stack: 'relief',
				layer: L('traces', 'Trace relief', {
					...tr,
					bevel: 0.5,
					profile: 'linear',
					mk_op: 'replace',
					h_on: true,
					h_amount: 0.12,
					dif_on: false,
					s_on: true,
					s_mode: 'replace',
					s_src: 'flat',
					s_a: 0.4,
					s_b: 0.4
				})
			},
			{
				role: 'board',
				stack: 'paint',
				layer: L('noise', 'Board', {
					noise: 'value',
					fractal: 'fbm',
					scale: across(ctx, 3),
					octaves: 2,
					seed: seed + 1,
					h_on: false,
					dif_on: true,
					dif_grad: m.board ?? gradient('#120612', '#240e24')
				})
			},
			{
				role: 'traces',
				stack: 'paint',
				layer: L('traces', 'Traces', {
					...tr,
					mk_target: '',
					h_on: false,
					dif_on: true,
					dif_src: 'flat',
					dif_grad: gradient(trace),
					e_on: num(m.glow, 0.3) > 0,
					e_src: 'flat',
					e_color: trace,
					e_intensity: r2(num(m.glow, 0.3))
				})
			},
			{
				role: 'speckle',
				stack: 'paint',
				layer: L('noise', 'Speckle', {
					noise: 'white',
					seed: seed + 2,
					h_on: false,
					dif_on: true,
					dif_blend: 'overlay',
					dif_opacity: 0.1,
					dif_grad: gradient('#000000', '#ffffff')
				})
			}
		];
	}
};
