// Surface lumps tuned against references (FR8.6): concrete and plaster (cast block panels and streaked walls).

import { P, type ParamValues } from '@/core/params';
import { L, ON_FACES, across, clamp, gradient, num, r2, shade, streaks } from './parts';
import type { RecipeDef, RecipeLayer } from './types';
import { BRICKS_REGULAR } from '@/layers/generators/patterns';
import { SHAPE_MASK, limitTo } from '@/layers/masks';

export const concrete: RecipeDef = {
	id: 'concrete',
	label: 'Concrete',
	description:
		'Soft mottled concrete or plaster: smudges, rain streaks, pits and speckle; optional cast panels with seams and bolt holes.',
	groups: [
		{ id: 'surface', label: 'Surface' },
		{ id: 'panels', label: 'Panels' },
		{ id: 'formwork', label: 'Formwork' },
		{ id: 'colour', label: 'Colour' }
	],
	params: [
		P.float('mottle', 'Mottle', 0.35, 0, 1, {
			group: 'surface',
			step: 0.01,
			hint: 'Contrast of the large soft blotches'
		}),
		P.float('mottle_size', 'Mottle size', 28, 4, 256, { group: 'surface', softMax: 64, unit: 'px' }),
		P.float('smudges', 'Smudges', 0.3, 0, 1, {
			group: 'surface',
			step: 0.01,
			hint: 'Dark trowel smears and hairline cracks'
		}),
		P.float('streaks', 'Rain streaks', 0, 0, 1, { group: 'surface', step: 0.01, hint: 'Vertical run-off streaks' }),
		P.float('pits', 'Pits', 0.2, 0, 1, { group: 'surface', step: 0.01 }),
		P.float('rough', 'Roughness', 0.25, 0, 1, { group: 'surface', step: 0.01, hint: 'Soft lumps in the relief' }),
		P.float('speckle', 'Speckle', 0.05, 0, 1, { group: 'surface', step: 0.01 }),
		P.int('panels_x', 'Panels across', 0, 0, 32, { group: 'panels', softMax: 8, hint: '0 = one seamless surface' }),
		P.int('panels_y', 'Panels down', 1, 1, 32, { group: 'panels', softMax: 8 }),
		P.float('seam', 'Seam width', 1, 0, 4, { group: 'panels', step: 0.1, unit: 'px' }),
		P.float('bevel', 'Panel bevel', 0.5, 0, 1, {
			group: 'panels',
			step: 0.01,
			hint: 'How much the panel edges round off into the seams'
		}),
		P.float('halo', 'Edge halo', 0.4, 0, 1, {
			group: 'panels',
			step: 0.01,
			hint: 'Darkened paint band just inside each panel edge (handling wear, damp)'
		}),
		P.float('halo_width', 'Halo width', 3, 0.5, 16, { group: 'panels', step: 0.5, unit: 'px' }),
		P.bool('bolts', 'Bolt holes', false, {
			group: 'panels',
			hint: 'Near each panel corner (or the texture corners without panels)'
		}),
		P.float('bolt_inset', 'Bolt inset', 0.22, 0.02, 0.48, {
			group: 'panels',
			step: 0.005,
			hint: 'From each panel corner, as a fraction of the panel'
		}),
		P.float('bolt_size', 'Bolt size', 1.1, 0.3, 4, { group: 'panels', step: 0.05, unit: 'px' }),
		P.enum(
			'formwork',
			'Formwork',
			'none',
			[
				['none', 'None'],
				['plywood', 'Plywood sheets'],
				['boards', 'Boards (vertical)']
			],
			{ group: 'formwork', hint: 'The imprint of the shuttering the concrete was cast in' }
		),
		P.int('form_count', 'Sheets / boards across', 2, 1, 32, { group: 'formwork', softMax: 12 }),
		P.float('form_seams', 'Seams', 0.5, 0, 1, { group: 'formwork', step: 0.01 }),
		P.float('form_tone', 'Tone per sheet', 0.3, 0, 1, { group: 'formwork', step: 0.01 }),
		P.float('form_grain', 'Board grain', 0.3, 0, 1, {
			group: 'formwork',
			step: 0.01,
			showIf: (p) => p.formwork === 'boards'
		}),
		P.enum(
			'ties',
			'Tie holes',
			'none',
			[
				['none', 'None'],
				['open', 'Open'],
				['plugged', 'Plugged'],
				['cone', 'Cone']
			],
			{ group: 'formwork', hint: 'Holes left by the form ties, in a grid on each sheet' }
		),
		P.int('ties_x', 'Ties across (per sheet)', 2, 1, 8, { group: 'formwork' }),
		P.int('ties_y', 'Ties down (per sheet)', 2, 1, 8, { group: 'formwork' }),
		P.float('tie_size', 'Tie size', 1.5, 0.5, 8, { group: 'formwork', step: 0.1, unit: 'px' }),
		P.gradient('colours', 'Concrete colours', gradient('#3a3a3a', '#474747', '#545454'), { group: 'colour' }),
		P.color('dark', 'Seams & holes', '#151515', { group: 'colour' }),
		P.float('stains', 'Water stains', 0, 0, 1, { group: 'colour', step: 0.01 }),
		P.float('dirt', 'Crevice dirt', 0.4, 0, 1, { group: 'colour', step: 0.01 }),
		P.seed('seed', 'Seed', 11, { group: 'surface' })
	],
	render: { ao: 0.6, aoRadius: 3 },
	build(m, ctx) {
		const seed = num(m.seed, 11);
		const px = Math.max(0, Math.round(num(m.panels_x, 0)));
		const py = Math.max(1, Math.round(num(m.panels_y, 1)));
		const panels = px > 0;
		const pw = panels ? ctx.width / px : ctx.width;
		const ph = panels ? ctx.height / py : ctx.height;
		const mot = num(m.mottle, 0.35);
		const smudge = num(m.smudges, 0.3);
		const streak = num(m.streaks, 0);
		const dark = String(m.dark ?? '#151515');
		const colours = m.colours ?? gradient('#3a3a3a', '#545454');
		const mottle = {
			noise: 'perlin',
			fractal: 'fbm',
			scale: across(ctx, num(m.mottle_size, 28)),
			octaves: 4,
			seed: seed + 1
		};
		// Classic ridged crests (no offset, hierarchy or crease, raw levels): Levels keep only the thin bright crest lines.
		const smear = {
			noise: 'perlin',
			fractal: 'ridged',
			scale: across(ctx, num(m.mottle_size, 28) * 1.4),
			octaves: 3,
			warp: 0.5,
			ridge: 0,
			hier: 0,
			crease: 0,
			even: false,
			seed: seed + 2,
			sh_lo: 0.72,
			sh_hi: 0.96
		};
		const shape = {
			...BRICKS_REGULAR,
			columns: Math.max(1, px),
			rows: py,
			stagger: 0,
			mortar: num(m.seam, 1),
			round: 0.5,
			aa: false,
			seed: seed + 3
		};
		// Two repeat cells per panel, mirrored: the inset (fraction of the panel) is twice that of a cell.
		const inset = num(m.bolt_inset, 0.22);
		const bolt = {
			radius: num(m.bolt_size, 1.1),
			x: r2(2 * inset),
			y: r2(2 * inset * Math.min(1, pw / ph)),
			rep_x: Math.max(1, px) * 2,
			rep_y: py * 2,
			rep_mirror: true,
			aa: false,
			mk_target: '',
			seed: seed + 4
		};
		const bolts = m.bolts === true;
		const out: RecipeLayer[] = [
			{
				role: 'panels',
				stack: 'relief',
				// Two levels: the face, a 1 px step lit along the top / left, the thin seam below.
				layer: L(
					'bricks',
					'Panels',
					{
						...shape,
						bevel: r2(clamp(0.5 + num(m.bevel, 0.5), 0.5, Math.min(pw, ph) / 4)),
						profile: 'linear',
						mk_op: 'replace',
						h_on: true,
						h_amount: 0.4,
						dif_on: false
					},
					panels
				)
			},
			{
				role: 'lumps',
				stack: 'relief',
				layer: L(
					'noise',
					'Lumps',
					{
						...mottle,
						octaves: 3,
						h_on: true,
						h_amount: r2(0.25 * num(m.rough, 0.25)),
						dif_on: false,
						s_on: true,
						s_mode: 'multiply',
						s_src: 'value',
						s_a: 0.3,
						s_b: 1
					},
					num(m.rough, 0.25) > 0
				)
			},
			{
				role: 'smear-relief',
				stack: 'relief',
				layer: L(
					'noise',
					'Smear relief',
					{ ...smear, h_on: true, h_mode: 'subtract', h_amount: r2(0.15 * smudge), dif_on: false },
					smudge > 0
				)
			},
			{
				role: 'pits',
				stack: 'relief',
				layer: L(
					'noise',
					'Pits',
					{
						noise: 'worley',
						fractal: 'none',
						w_even: false,
						w_profile: 'linear',
						scale: across(ctx, 4),
						seed: seed + 5,
						sh_invert: true,
						sh_cut: 0.95,
						sh_cut_soft: 0.03,
						h_on: true,
						h_mode: 'subtract',
						h_amount: r2(0.35 * num(m.pits, 0.2)),
						dif_on: false,
						...(panels ? ON_FACES : {})
					},
					num(m.pits, 0.2) > 0
				)
			},
			// A bevelled dip: its lower lip faces the light from above and catches a highlight.
			{
				role: 'bolts',
				stack: 'relief',
				layer: L(
					'circle',
					'Bolt holes',
					{
						...bolt,
						bevel: r2(num(m.bolt_size, 1.1) * 0.5),
						profile: 'linear',
						h_on: true,
						h_mode: 'subtract',
						h_amount: 0.6,
						dif_on: false,
						s_on: true,
						s_mode: 'replace',
						s_src: 'flat',
						s_a: 0.5,
						s_b: 0.5
					},
					bolts
				)
			},
			{
				role: 'mottle',
				stack: 'paint',
				layer: L('noise', 'Mottle', {
					...mottle,
					sh_lo: r2(0.5 - 0.5 * mot),
					sh_hi: r2(0.5 + 0.5 * mot),
					h_on: false,
					dif_on: true,
					dif_grad: colours
				})
			},
			{
				role: 'grain',
				stack: 'paint',
				layer: L('noise', 'Grain', {
					noise: 'value',
					fractal: 'fbm',
					scale: across(ctx, 4),
					octaves: 2,
					seed: seed + 6,
					h_on: false,
					dif_on: true,
					dif_blend: 'overlay',
					dif_opacity: 0.08,
					dif_grad: gradient('#000000', '#ffffff')
				})
			},
			{
				role: 'smudges',
				stack: 'paint',
				layer: L(
					'noise',
					'Smudges',
					{
						...smear,
						h_on: false,
						dif_on: true,
						dif_blend: 'multiply',
						dif_opacity: r2(smudge),
						dif_grad: gradient('#ffffff', '#5a5a5a')
					},
					smudge > 0
				)
			},
			{
				role: 'streaks',
				stack: 'paint',
				layer: L(
					'noise',
					'Streaks',
					{
						noise: 'value',
						fractal: 'fbm',
						...streaks(ctx, true, ctx.height * 0.5, 2),
						octaves: 2,
						seed: seed + 7,
						sh_lo: 0.35,
						sh_hi: 0.75,
						h_on: false,
						dif_on: true,
						dif_blend: 'multiply',
						dif_opacity: r2(streak),
						dif_grad: gradient('#ffffff', '#6a6a6a')
					},
					streak > 0
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
						seed: seed + 8,
						h_on: false,
						dif_on: true,
						dif_blend: 'overlay',
						dif_opacity: r2(num(m.speckle, 0.05)),
						dif_grad: gradient('#000000', '#ffffff')
					},
					num(m.speckle, 0.05) > 0
				)
			},
			{
				role: 'seams',
				stack: 'paint',
				layer: L(
					'noise',
					'Seams',
					{
						noise: 'white',
						seed: seed + 9,
						...limitTo(SHAPE_MASK, { outside: true }),
						h_on: false,
						dif_on: true,
						dif_grad: shade(dark, 0.7)
					},
					panels
				)
			},
			// Dark core only — the lit lower lip stays the concrete colour.
			{
				role: 'bolt-paint',
				stack: 'paint',
				layer: L(
					'circle',
					'Bolt hole colour',
					{
						...bolt,
						radius: r2(num(m.bolt_size, 1.1) * 0.7),
						h_on: false,
						dif_on: true,
						dif_src: 'flat',
						dif_grad: gradient(dark)
					},
					bolts
				)
			},
			{
				role: 'halo',
				stack: 'paint',
				// A ring that starts a pixel in: the lit edge stays bright, the band behind it darkens.
				layer: L(
					'bricks',
					'Edge halo',
					{
						...shape,
						bevel: num(m.halo_width, 3),
						profile: 'custom',
						bevel_curve: {
							points: [
								{ x: 0, y: 1 },
								{ x: 0.3, y: 0 },
								{ x: 1, y: 1 }
							]
						},
						mk_target: '',
						h_on: false,
						dif_on: true,
						dif_src: 'value',
						dif_blend: 'multiply',
						dif_opacity: r2(num(m.halo, 0.4)),
						dif_grad: gradient('#707070', '#ffffff')
					},
					panels && num(m.halo, 0.4) > 0
				)
			},
			{
				role: 'stains',
				stack: 'paint',
				layer: L(
					'drips',
					'Water stains',
					{
						output: 'stain',
						cols: Math.max(4, Math.round(ctx.width / 6)),
						rows: Math.max(2, Math.round(ctx.height / 12)),
						density: 0.4,
						len_min: 6,
						len_max: Math.round(ctx.height * 0.5),
						width: 3,
						width_var: 0.5,
						head: 0,
						start: 0.6,
						fade: 0.9,
						wobble: 0.3,
						hard: false,
						seed: seed + 10,
						h_on: false,
						dif_on: true,
						dif_blend: 'multiply',
						dif_opacity: r2(num(m.stains, 0)),
						dif_grad: gradient('#ffffff', '#4a4440')
					},
					num(m.stains, 0) > 0
				)
			},
			...formwork(m, ctx, seed, dark),
			{
				role: 'grime',
				stack: 'paint',
				layer: L('cavity', 'Dirt', {
					radius: 1.5,
					threshold: 0.05,
					sensitivity: 0.8,
					wear_amount: 0.15,
					wear_color: '#7a7a7a',
					dirt_amount: r2(num(m.dirt, 0.4) * (panels ? 0.4 : 1)),
					dirt_color: dark,
					noise_scale: 8
				})
			}
		];
		return out;
	}
};

/**
 * Formwork imprint (shuttering): shallow seams between plywood sheets or boards, a tone per sheet / board, board grain,
 * and the tie holes in a grid on each sheet — open pits with a lit lip, plugged flush discs in a groove, or cones.
 */
function formwork(
	m: Record<string, unknown>,
	ctx: { width: number; height: number },
	seed: number,
	dark: string
): RecipeLayer[] {
	const kind = String(m.formwork ?? 'none');
	const on = kind !== 'none';
	const boards = kind === 'boards';
	const nx = Math.max(1, Math.round(num(m.form_count, 2)));
	// Plywood sheets are 2:1 (taller than wide on a wall); boards run the full height.
	const ny = boards ? 1 : Math.max(1, Math.round((nx * ctx.height) / (2 * ctx.width)));
	const seams = num(m.form_seams, 0.5);
	const tone = num(m.form_tone, 0.3);
	const ties = String(m.ties ?? 'none');
	const tsz = num(m.tie_size, 1.5);
	const sheet = {
		...BRICKS_REGULAR,
		columns: nx,
		rows: ny,
		stagger: 0,
		mortar: 0,
		round: 0,
		aa: false,
		seed: seed + 20
	};
	const tie = {
		radius: tsz,
		x: 0.5,
		y: 0.5,
		rep_x: nx * Math.max(1, Math.round(num(m.ties_x, 2))),
		rep_y: ny * Math.max(1, Math.round(num(m.ties_y, 2))),
		aa: false,
		mk_target: '',
		seed: seed + 21
	};
	const seamShape: { type: string; p: ParamValues } = boards
		? {
				type: 'stripes',
				p: {
					mode: 'shape',
					count: nx,
					angle: 90,
					duty: r2(Math.min(0.5, 1 / (ctx.width / nx))),
					offset: 0,
					aa: false,
					seed: seed + 22
				}
			}
		: { type: 'grid', p: { count_x: nx, count_y: ny, width: 1, aa: false, seed: seed + 22 } };
	const tieOn = on && ties !== 'none';
	return [
		{
			role: 'form-seams',
			stack: 'relief',
			layer: L(
				seamShape.type,
				'Formwork seams',
				{
					...seamShape.p,
					bevel: 0.5,
					profile: 'linear',
					mk_target: '',
					h_on: true,
					h_mode: 'subtract',
					h_amount: r2(0.12 * seams),
					dif_on: false
				},
				on && seams > 0
			)
		},
		{
			role: 'ties',
			stack: 'relief',
			layer: L(
				'circle',
				'Tie holes',
				{
					...tie,
					radius: ties === 'cone' ? r2(tsz * 1.6) : tsz,
					bevel: ties === 'cone' ? r2(tsz * 1.6) : r2(tsz * 0.5),
					profile: 'linear',
					h_on: true,
					h_mode: 'subtract',
					h_amount: ties === 'plugged' ? 0.05 : 0.5,
					dif_on: false,
					s_on: true,
					s_mode: 'replace',
					s_src: 'flat',
					s_a: 0.4,
					s_b: 0.4
				},
				tieOn
			)
		},
		{
			role: 'tie-groove',
			stack: 'relief',
			layer: L(
				'circle',
				'Plug groove',
				{
					...tie,
					radius: r2(tsz + 0.5),
					outline: 0.75,
					bevel: 0.5,
					profile: 'linear',
					h_on: true,
					h_mode: 'subtract',
					h_amount: 0.15,
					dif_on: false
				},
				tieOn && ties === 'plugged'
			)
		},
		{
			role: 'form-tone',
			stack: 'paint',
			layer: L(
				'bricks',
				'Sheet tone',
				{
					...sheet,
					bevel: 0,
					profile: 'flat',
					mk_target: '',
					h_on: false,
					dif_on: true,
					dif_src: 'random',
					dif_blend: 'multiply',
					dif_opacity: r2(tone),
					dif_grad: gradient('#9a9a9a', '#ffffff')
				},
				on && tone > 0
			)
		},
		{
			role: 'form-grain',
			stack: 'paint',
			layer: L(
				'noise',
				'Board grain',
				{
					noise: 'value',
					fractal: 'fbm',
					...streaks(ctx, true, ctx.height * 0.4, 2),
					octaves: 2,
					seed: seed + 23,
					sh_lo: 0.3,
					sh_hi: 0.7,
					h_on: false,
					dif_on: true,
					dif_blend: 'multiply',
					dif_opacity: r2(0.6 * num(m.form_grain, 0.3)),
					dif_grad: gradient('#8a8a8a', '#ffffff')
				},
				boards && num(m.form_grain, 0.3) > 0
			)
		},
		{
			role: 'seam-colour',
			stack: 'paint',
			layer: L(
				seamShape.type,
				'Seam colour',
				{
					...seamShape.p,
					mk_target: '',
					h_on: false,
					dif_on: true,
					dif_src: 'flat',
					dif_blend: 'multiply',
					dif_opacity: r2(0.6 * seams),
					dif_grad: gradient('#707070')
				},
				on && seams > 0
			)
		},
		{
			role: 'tie-colour',
			stack: 'paint',
			layer: L(
				'circle',
				'Tie hole colour',
				{
					...tie,
					radius: ties === 'plugged' ? tsz : r2(tsz * 0.7),
					h_on: false,
					dif_on: true,
					dif_src: 'flat',
					dif_blend: ties === 'plugged' ? 'multiply' : 'normal',
					dif_grad: gradient(ties === 'plugged' ? '#c8c8c8' : dark)
				},
				tieOn
			)
		}
	];
}
