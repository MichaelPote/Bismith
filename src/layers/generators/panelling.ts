// Panelling (FR8.30, docs/features/fr8.30-carved-relief.md): frame-and-panel joinery as height. The panels are the
// cells of the layer's Area grid (core/grid.ts) — sized, merged and switched off on the canvas with the grid gizmo —
// set in a frame of stiles and rails. From each panel's outline a moulding of up to four steps runs inward (each a
// width, a profile and the level it reaches), repeated to nest frames inside frames, then the field: flat, raised on a
// chamfer, domed or a pyramid, optionally fluted, reeded or hatched, with bosses in its corners. The first and last rows
// can be rails of their own (a cornice with dentils, a skirting), alternate columns pilasters; the frame can be boards
// with V joints; alternate columns or rows can be staggered, and cells merged at random. The value is the height
// (0 = deepest, 1 = highest), so Diffuse is a plain ramp from low to high.

import { P, gradient, type ParamDef, type ParamValues } from '@/core/params';
import { MAX_GRID, edgesPx, gridOf, layoutGrid, panelAt, randomMerges, staggerAlong } from '@/core/grid';
import { GLSL_MOULD } from '../glsl/mould';
import type { LayerDef } from '../types';

/** Moulding step profiles. Option order is the uniform's index (the GLSL tests it): only append. */
const STEP_PROFILES: [string, string, string][] = [
	['flat', 'Step (hard edge)', 'Drops or rises straight to the level, a crisp edge'],
	['chamfer', 'Chamfer', 'A straight slope to the level'],
	['round', 'Round (ovolo)', 'A convex quarter round to the level, rounded over at the top'],
	['cove', 'Cove', 'A concave quarter round to the level, hollow at the bottom'],
	['ogee', 'Ogee (S curve)', 'An S curve to the level'],
	['bead', 'Bead / flute (and back)', 'A half round out to the level and back: a bead above, a flute below'],
	['vee', 'Ridge / V groove (and back)', 'A straight-sided ridge or V groove to the level and back']
];
const STEPS = 4;
/** The default moulding, a staircase: an ovolo off the frame, a fillet, a cove down, a fillet, then the field. */
const STEP_DEFAULTS: [number, string, number][] = [
	[2, 'round', 0.56],
	[2, 'flat', 0.52],
	[3, 'cove', 0.36],
	[2, 'flat', 0.32]
];

const FIELDS: [string, string, string][] = [
	['flat', 'Flat', 'The field stays at the moulding’s last level'],
	['raised', 'Raised (fielded)', 'A slope of the Field width up (or down) to the Field level, then a flat face'],
	['domed', 'Domed', 'Rounds over the whole field to the Field level at its centre (below the moulding: a dish)'],
	['pyramid', 'Pyramid', 'Straight slopes from every edge to a ridge or point at the centre']
];

const FILLS: [string, string][] = [
	['none', 'None'],
	['flutes', 'Flutes (vertical grooves)'],
	['reeds', 'Reeds (rounded strips)'],
	['horizontal', 'Horizontal grooves'],
	['diagonal', 'Diagonal grooves'],
	['crosshatch', 'Crosshatch'],
	['diagonal2', 'Diagonal grooves (the other way)']
];

/** Panel shapes. Option order is the uniform's index: only append. */
const SHAPES: ([string, string] | [string, string, string])[] = [
	['square', 'Square'],
	['chamfer', 'Cut (chamfered)'],
	['round', 'Rounded'],
	['notch', 'Notched (concave quarter round)'],
	['arch', 'Arched top', 'A round top as wide as the panel'],
	['arch2', 'Rounded both ends'],
	['pointed', 'Pointed arch', 'Two arcs meeting in a point at the top'],
	['cusped', 'Cusped', 'A round bottom, and a dip in the top between two points'],
	['oval', 'Oval']
];
/** Rail row profiles across their height, from the panels out to the area's edge: none, then the step profiles. */
const RAIL_PROFILES: ([string, string] | [string, string, string])[] = [
	['none', 'None'],
	...STEP_PROFILES.slice(0, 5),
	['cornice', 'Cornice (members)', 'A bead and fillet off the panels, a cove, a fillet and an ogee out to the edge'],
	['skirting', 'Skirting (members)', 'An ogee and a bead off the panels, then a tall plain plinth']
];

const hasFill = (p: ParamValues) => p.fill !== 'none' || (p.fill_alt !== 'none' && p.fill2 !== 'none');

const stepParams: ParamDef[] = STEP_DEFAULTS.flatMap(([w, prof, lvl], i) => {
	const n = i + 1;
	const on = (p: ParamValues) => i === 0 || Number(p[`m${i}_w`]) > 0;
	return [
		P.float(`m${n}_w`, `Step ${n} width`, w, 0, 256, {
			softMax: 24,
			unit: 'px',
			step: 0.5,
			group: 'moulding',
			showIf: on,
			hint:
				n === 1
					? 'Sets how far the first step of the moulding runs in from the panel’s edge (0 = no moulding)'
					: 'Sets this step’s width (0 = the moulding ends before it)'
		}),
		P.enum(`m${n}_prof`, `Step ${n} profile`, prof, STEP_PROFILES, {
			group: 'moulding',
			showIf: (p) => on(p) && Number(p[`m${n}_w`]) > 0
		}),
		P.float(`m${n}_lvl`, `Step ${n} level`, lvl, 0, 1, {
			step: 0.001,
			group: 'moulding',
			showIf: (p) => on(p) && Number(p[`m${n}_w`]) > 0,
			hint: 'Sets the height this step reaches (the frame stands at Frame level). A bead or groove goes to it and comes back'
		})
	];
});

const PANEL_RAMP = gradient('#22150c', '#6e4527', '#c8955f');

export const panellingLayer: LayerDef = {
	type: 'panelling',
	label: 'Panelling',
	category: 'pattern',
	kind: 'generator',
	area: 'layout',
	sdf: true,
	// The Edge card doesn't apply to the relief (the moulding is its edge; the panels still go to the mask); a part shape
	// keeps Anti-alias.
	sdfShowIf: (p, key) => key === undefined || (p.output !== 'relief' && key === 'aa'),
	description:
		'Frame-and-panel joinery as height: Panels in a frame of stiles and rails, each with a stepped moulding and a flat, raised, domed or fluted field. Size, merge and switch off the panels on the canvas with the grid gizmo.',
	params: [
		P.enum(
			'output',
			'Output',
			'relief',
			[
				['relief', 'Relief (value)'],
				['fields', 'Fields (shape)'],
				['frame', 'Frame (shape)'],
				['bosses', 'Bosses and ornament (shape)']
			],
			{
				hint: 'Relief is the whole carving as height. The shape outputs give one part as a shape, to paint or to write to a mask: the fields inside the mouldings, the frame round the panels, or the bosses, carvings and pilaster capitals'
			}
		),
		P.seed(),
		P.float('frame', 'Frame level', 0.62, 0, 1, {
			step: 0.001,
			hint: 'Sets the height of the frame the panels are set in'
		}),
		P.float('stile', 'Stile width', 8, 0, 512, {
			softMax: 48,
			unit: 'px',
			axis: 'x',
			step: 0.5,
			hint: 'Sets the width of the frame between panels side by side'
		}),
		P.float('rail', 'Rail width', 8, 0, 512, {
			softMax: 48,
			unit: 'px',
			axis: 'y',
			step: 0.5,
			hint: 'Sets the width of the frame between panels one above the other'
		}),
		P.float('border', 'Outer frame (sides)', 4, 0, 512, {
			softMax: 48,
			unit: 'px',
			step: 0.5,
			hint: 'Sets the width of the frame down the left and right edges. Half the stile width tiles seamlessly'
		}),
		P.float('border_tb', 'Outer frame (top, bottom)', 4, 0, 512, {
			softMax: 48,
			unit: 'px',
			axis: 'y',
			step: 0.5,
			hint: 'Sets the width of the frame along the top and bottom edges. Half the rail width tiles seamlessly'
		}),
		P.enum('shape', 'Panel shape', 'square', SHAPES, {
			hint: 'Shapes every panel; the moulding follows its outline'
		}),
		P.float('corner', 'Corner size', 6, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.5,
			showIf: (p) => ['chamfer', 'round', 'notch', 'cusped'].includes(String(p.shape)),
			hint: 'Sets the size of the cut, rounding or notch at each corner (cusped: how deep the dip between the points is)'
		}),
		P.int('shape_from', 'Shape from step', 1, 1, 4, {
			showIf: (p) => p.shape !== 'square',
			hint: 'Starts the panel shape at this step of the moulding: the steps before it stay square, so a notched or rounded inner moulding sits inside a square outer one'
		}),
		P.float('merge_rnd', 'Random merges', 0, 0, 1, {
			step: 0.001,
			uniform: false,
			hint: 'Merges a share of the single cells with a neighbour at random (2 × 1, 1 × 2 or 2 × 2), on top of the ones drawn on the canvas'
		}),
		P.float('stagger', 'Stagger', 0, 0, 1, {
			step: 0.001,
			hint: 'Shifts every other column (or row) by this share of a cell, like boards or brick courses. Panels pushed past the edge come back on the other side'
		}),
		P.enum(
			'stag_by',
			'Stagger by',
			'cols',
			[
				['cols', 'Columns (panels shift down)'],
				['rows', 'Rows (panels shift across)']
			],
			{ bare: true, showIf: (p) => Number(p.stagger) > 0 }
		),
		P.enum(
			'boards',
			'Boards',
			'none',
			[
				['none', 'None'],
				['vertical', 'Vertical'],
				['horizontal', 'Horizontal']
			],
			{ hint: 'Splits the frame into boards with grooved joints between them' }
		),
		P.float('board_w', 'Board width', 0, 0, 512, {
			softMax: 64,
			unit: 'px',
			step: 0.5,
			showIf: (p) => p.boards !== 'none',
			hint: 'Sets the width of each board (0 = one board per column or row, the joints on the grid lines)'
		}),
		P.float('joint_w', 'Joint width', 2, 0.5, 32, {
			softMax: 8,
			unit: 'px',
			step: 0.25,
			showIf: (p) => p.boards !== 'none',
			hint: 'Sets how wide the V of each joint is'
		}),
		P.float('joint_d', 'Joint depth', 0.15, 0, 1, {
			step: 0.001,
			showIf: (p) => p.boards !== 'none',
			hint: 'Sets how deep the joints cut'
		}),
		P.float('quirk', 'Quirks', 0.12, 0, 0.5, {
			step: 0.001,
			group: 'moulding',
			hint: 'Cuts a fine groove between the members of the mouldings and rails (0 = none), the crisp line that separates them'
		}),
		P.int('m_rep', 'Repeat moulding', 1, 1, 4, {
			group: 'moulding',
			hint: 'Runs the whole moulding again further in, for frames nested inside frames. Steps that end where they began nest cleanly'
		}),
		...stepParams,
		P.enum('field', 'Field', 'raised', FIELDS, {
			group: 'field',
			hint: 'Shapes the panel inside the moulding'
		}),
		P.float('field_lvl', 'Field level', 0.5, 0, 1, {
			step: 0.001,
			group: 'field',
			showIf: (p) => p.field !== 'flat',
			hint: 'Sets the height of the field’s face (or its centre, domed and pyramid)'
		}),
		P.float('field_w', 'Field slope', 6, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.5,
			group: 'field',
			showIf: (p) => p.field === 'raised',
			hint: 'Sets how wide the slope up to the raised face is'
		}),
		P.enum(
			'field_prof',
			'Slope profile',
			'chamfer',
			STEP_PROFILES.slice(0, 5).map(([v, l, h]) => [v, l, h]),
			{ group: 'field', showIf: (p) => p.field === 'raised' }
		),
		P.float('field_var', 'Field variation', 0, 0, 0.5, {
			step: 0.001,
			group: 'field',
			showIf: (p) => p.field !== 'flat',
			hint: 'Raises or lowers each panel’s field a little at random, as hand-fitted panels sit'
		}),
		P.enum('fill', 'Fill', 'none', FILLS, {
			group: 'field',
			hint: 'Carves a pattern into the field’s face'
		}),
		P.enum(
			'fill_alt',
			'Alternate fill',
			'none',
			[
				['none', 'Off'],
				['rows', 'Every other row'],
				['cols', 'Every other column'],
				['checker', 'Checkerboard']
			],
			{ group: 'field', hint: 'Gives every other panel the second fill instead' }
		),
		P.enum('fill2', 'Second fill', 'diagonal', FILLS, {
			group: 'field',
			showIf: (p) => p.fill_alt !== 'none'
		}),
		P.float('fill_sp', 'Fill spacing', 6, 1, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.25,
			group: 'field',
			showIf: hasFill,
			hint: 'Sets the distance between neighbouring grooves or reeds'
		}),
		P.float('fill_w', 'Groove width', 2, 0.5, 64, {
			softMax: 12,
			unit: 'px',
			step: 0.25,
			group: 'field',
			showIf: hasFill,
			hint: 'Sets how wide each groove is (reeds fill their spacing)'
		}),
		P.float('fill_d', 'Fill depth', 0.12, 0, 1, {
			step: 0.001,
			group: 'field',
			showIf: hasFill,
			hint: 'Sets how deep the grooves cut (or how far the reeds round down)'
		}),
		P.float('fill_m', 'Fill margin', 2, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.5,
			group: 'field',
			showIf: hasFill,
			hint: 'Stops the fill this far short of the field’s edge'
		}),
		P.enum(
			'boss',
			'Corner bosses',
			'none',
			[
				['none', 'None'],
				['disc', 'Domed discs'],
				['square', 'Square blocks'],
				['rosette', 'Rosettes']
			],
			{
				group: 'ornament',
				section: 'Bosses',
				hint: 'Sets a boss in each corner of every panel, where the moulding turns'
			}
		),
		P.enum(
			'orn',
			'Running ornament',
			'none',
			[
				['none', 'None'],
				['bead_reel', 'Bead and reel'],
				['egg_dart', 'Egg and dart'],
				['rope', 'Rope'],
				['nailhead', 'Nailheads'],
				['leaf', 'Leaf tips']
			],
			{
				group: 'ornament',
				section: 'Carving',
				hint: 'Carves a repeating ornament along one step of the moulding, turning the corners. Widen that step to give it room'
			}
		),
		P.int('orn_step', 'On step', 2, 1, 4, {
			group: 'ornament',
			section: 'Carving',
			showIf: (p) => p.orn !== 'none',
			hint: 'Picks the moulding step the ornament runs along'
		}),
		P.float('orn_len', 'Unit length', 6, 1, 128, {
			softMax: 24,
			unit: 'px',
			step: 0.25,
			group: 'ornament',
			section: 'Carving',
			showIf: (p) => p.orn !== 'none',
			hint: 'Sets the length of one unit (an egg and its dart, a bead and its reels); each side fits a whole number'
		}),
		P.float('orn_d', 'Ornament height', 0.2, -1, 1, {
			step: 0.001,
			group: 'ornament',
			section: 'Carving',
			showIf: (p) => p.orn !== 'none',
			hint: 'Sets how far the ornament stands out of the step (below 0: carved in)'
		}),
		P.enum(
			'co',
			'Corner carving',
			'none',
			[
				['none', 'None'],
				['leaves', 'Leaf spray'],
				['fan', 'Fan'],
				['rosette', 'Rosette']
			],
			{
				group: 'ornament',
				section: 'Carving',
				hint: 'Carves a piece into each corner of the field, mirrored to all four'
			}
		),
		P.float('co_size', 'Corner size', 12, 1, 256, {
			hint: 'Sets how far the corner carving reaches into the field',
			softMax: 48,
			unit: 'px',
			step: 0.25,
			group: 'ornament',
			section: 'Carving',
			showIf: (p) => p.co !== 'none'
		}),
		P.float('co_aspect', 'Corner spread', 1, 0.25, 4, {
			step: 0.01,
			group: 'ornament',
			section: 'Carving',
			showIf: (p) => p.co !== 'none',
			hint: 'Stretches the corner carving along the top and bottom (above 1) or down the sides (below 1)'
		}),
		P.float('co_in', 'Corner inset', 1, -64, 128, {
			softMin: -8,
			softMax: 24,
			unit: 'px',
			step: 0.25,
			group: 'ornament',
			section: 'Carving',
			showIf: (p) => p.co !== 'none',
			hint: 'Sets how far in from the field’s corner the carving starts'
		}),
		P.float('co_d', 'Corner height', 0.25, -1, 1, {
			step: 0.001,
			group: 'ornament',
			section: 'Carving',
			showIf: (p) => p.co !== 'none',
			hint: 'Sets how far the corner carving stands out of the field (below 0: carved in)'
		}),
		P.enum(
			'med',
			'Medallion',
			'none',
			[
				['none', 'None'],
				['lozenge', 'Lozenge'],
				['roundel', 'Roundel'],
				['quatrefoil', 'Quatrefoil']
			],
			{ group: 'ornament', section: 'Carving', hint: 'Sets a medallion with a beaded rim in the middle of every field' }
		),
		P.float('med_size', 'Medallion size', 0.45, 0.05, 1, {
			step: 0.001,
			group: 'ornament',
			section: 'Carving',
			showIf: (p) => p.med !== 'none',
			hint: 'Sets the medallion’s size, a share of the field (a lozenge stretches with it)'
		}),
		P.float('med_d', 'Medallion height', 0.25, -1, 1, {
			step: 0.001,
			group: 'ornament',
			section: 'Carving',
			showIf: (p) => p.med !== 'none',
			hint: 'Sets how far the medallion stands out of the field (below 0: sunk in)'
		}),
		P.bool('med_dome', 'Domed face', true, {
			group: 'ornament',
			section: 'Carving',
			showIf: (p) => p.med !== 'none'
		}),
		P.enum(
			'pil_orn',
			'Capital',
			'plain',
			[
				['plain', 'Plain block'],
				['leaves', 'Leaves'],
				['volutes', 'Volutes']
			],
			{
				group: 'ornament',
				section: 'Pilasters',
				showIf: (p) => p.pilaster !== 'none' && Number(p.pil_cap) > 0,
				hint: 'Carves the capital at the top of each pilaster: a row of upright leaves, or a pair of scrolls over a bead'
			}
		),
		P.float('boss_r', 'Boss size', 4, 0.5, 128, {
			softMax: 24,
			unit: 'px',
			step: 0.25,
			group: 'ornament',
			section: 'Bosses',
			showIf: (p) => p.boss !== 'none',
			hint: 'Sets the radius (or half width) of each boss'
		}),
		P.float('boss_in', 'Boss inset', 5, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.25,
			group: 'ornament',
			section: 'Bosses',
			showIf: (p) => p.boss !== 'none',
			hint: 'Sets how far in from the corner of the shaped outline each boss sits (0 = on the corner: in a notch, its centre)'
		}),
		P.float('boss_lvl', 'Boss level', 0.75, 0, 1, {
			step: 0.001,
			group: 'ornament',
			section: 'Bosses',
			showIf: (p) => p.boss !== 'none',
			hint: 'Sets the height of the bosses'
		}),
		P.enum('band_top', 'Top rail', 'none', RAIL_PROFILES, {
			group: 'ornament',
			section: 'Rails',
			hint: 'Turns the first row into a rail across the whole width, a cornice, shaped by this profile out to the top edge'
		}),
		P.enum('band_bot', 'Bottom rail', 'none', RAIL_PROFILES, {
			group: 'ornament',
			section: 'Rails',
			hint: 'Turns the last row into a rail across the whole width, a skirting or dado, shaped by this profile out to the bottom edge'
		}),
		P.float('band_lvl', 'Top rail level', 0.8, 0, 1, {
			step: 0.001,
			group: 'ornament',
			section: 'Rails',
			showIf: (p) => p.band_top !== 'none',
			hint: 'Sets the height the top rail reaches'
		}),
		P.float('band_lvl2', 'Bottom rail level', 0.8, 0, 1, {
			step: 0.001,
			group: 'ornament',
			section: 'Rails',
			showIf: (p) => p.band_bot !== 'none',
			hint: 'Sets the height the bottom rail reaches. The same as the top rail’s, the two meet without a step when the texture tiles'
		}),
		P.bool('dentils', 'Dentils', false, {
			group: 'ornament',
			section: 'Rails',
			showIf: (p) => p.band_top !== 'none',
			hint: 'Sets a row of small blocks along the top rail’s lower edge'
		}),
		P.float('dentil_w', 'Dentil width', 4, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			axis: 'x',
			step: 0.25,
			group: 'ornament',
			section: 'Rails',
			showIf: (p) => p.band_top !== 'none' && Boolean(p.dentils)
		}),
		P.float('dentil_gap', 'Dentil gap', 2, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			axis: 'x',
			step: 0.25,
			group: 'ornament',
			section: 'Rails',
			showIf: (p) => p.band_top !== 'none' && Boolean(p.dentils)
		}),
		P.float('dentil_h', 'Dentil depth', 0.4, 0.05, 1, {
			step: 0.001,
			group: 'ornament',
			section: 'Rails',
			showIf: (p) => p.band_top !== 'none' && Boolean(p.dentils),
			hint: 'Sets how far up the rail the dentils reach, a share of its height'
		}),
		P.float('dentil_lvl', 'Dentil level', 0.9, 0, 1, {
			hint: 'Sets the height of the dentils’ faces',
			step: 0.001,
			group: 'ornament',
			section: 'Rails',
			showIf: (p) => p.band_top !== 'none' && Boolean(p.dentils)
		}),
		P.enum(
			'pilaster',
			'Pilasters',
			'none',
			[
				['none', 'None'],
				['odd', 'Every other column, from the 2nd'],
				['even', 'Every other column, from the 1st']
			],
			{
				group: 'ornament',
				section: 'Pilasters',
				hint: 'Turns alternate columns into pilasters standing proud of the frame. Make those columns narrow on the canvas'
			}
		),
		P.float('pil_lvl', 'Pilaster level', 0.7, 0, 1, {
			step: 0.001,
			group: 'ornament',
			section: 'Pilasters',
			showIf: (p) => p.pilaster !== 'none'
		}),
		P.int('pil_flutes', 'Pilaster flutes', 3, 0, 16, {
			group: 'ornament',
			section: 'Pilasters',
			showIf: (p) => p.pilaster !== 'none',
			hint: 'Sets how many flutes run down each pilaster (0 = plain)'
		}),
		P.float('pil_fd', 'Flute depth', 0.18, 0, 1, {
			step: 0.001,
			group: 'ornament',
			section: 'Pilasters',
			showIf: (p) => p.pilaster !== 'none' && Number(p.pil_flutes) > 0
		}),
		P.float('pil_cap', 'Capital height', 10, 0, 256, {
			softMax: 48,
			unit: 'px',
			axis: 'y',
			step: 0.5,
			group: 'ornament',
			section: 'Pilasters',
			showIf: (p) => p.pilaster !== 'none',
			hint: 'Sets the height of the plain block at each end of a pilaster, its capital and base (0 = none)'
		})
	],
	groups: [
		{ id: 'moulding', label: 'Moulding' },
		{ id: 'field', label: 'Field' },
		{ id: 'ornament', label: 'Rails & ornament', collapsed: true }
	],
	defaults: {
		grid_cols: '0.3333 0.3333 0.3334',
		grid_rows: '0.5 0.5',
		bevel: 0,
		h_on: true,
		h_amount: 0.6,
		dif_on: true,
		dif_src: 'value',
		dif_grad: PANEL_RAMP
	},
	derivedUniforms: {
		decl: { cx: `float[${MAX_GRID + 1}]`, ry: `float[${MAX_GRID + 1}]`, n: 'ivec2' },
		compute: (p, c) => {
			const g = gridOf(p);
			const fill = (a: number[], total: number) => [...a, ...Array<number>(MAX_GRID + 1 - a.length).fill(total)];
			return {
				cx: fill(edgesPx(g.cols, c.width), c.width),
				ry: fill(edgesPx(g.rows, c.height), c.height),
				n: [g.cols.length, g.rows.length]
			};
		}
	},
	textures: ['cells'],
	// Per cell, its panel: first column, first row, width and height in cells.
	cpuData(p, ctx) {
		// Merged after staggering: with Stagger the merges keep to the rows (columns) that slide, so no panel is cut where
		// they part; nor are the rails and pilasters merged into panels.
		const base = layoutGrid(p);
		const nr = base.rows.length;
		const top = nr > 1 && p.band_top !== 'none';
		const bot = nr > 1 && p.band_bot !== 'none';
		const pil = p.pilaster === 'none' ? -1 : p.pilaster === 'odd' ? 1 : 0;
		const g = randomMerges(base, Number(p.merge_rnd) || 0, ctx.seed, {
			along: staggerAlong(p),
			blocked: (c, r) => (top && r === 0) || (bot && r === nr - 1) || (c & 1) === pil
		});
		const data = new Uint8Array(MAX_GRID * MAX_GRID * 4);
		for (let r = 0; r < g.rows.length; r++)
			for (let c = 0; c < g.cols.length; c++) {
				const s = panelAt(g, c, r);
				data.set([s.c, s.r, s.w, s.h], (r * MAX_GRID + c) * 4);
			}
		return { cells: { width: MAX_GRID, height: MAX_GRID, data } };
	},
	glsl:
		GLSL_MOULD +
		/* glsl */ `
// The panel's outline: q from its centre (y down), b its half size, r the corner size. Square, cut, rounded, notched;
// arched top, rounded both ends, pointed arch, cusped (round bottom, a dip between two points on top), oval.
float pnl_shape(vec2 q, vec2 b, float r, int kind) {
  vec2 a = abs(q);
  float rr = min(r, min(b.x, b.y));
  if (kind == 8) return (length(q / b) - 1.0) * min(b.x, b.y);
  if (kind >= 4) {
    // The round (or pointed) end at the top, y < 0: cusped turns the panel over (its round end at the bottom), rounded
    // both ends folds the bottom onto the top.
    vec2 f = kind == 5 ? vec2(q.x, -abs(q.y)) : kind == 7 ? vec2(q.x, -q.y) : q;
    float ra = min(b.x, b.y);
    float d;
    if (kind == 6) {
      // Two arcs of radius R from the springing line ys, meeting at the top (equilateral when there's room).
      float h = min(1.7320508 * b.x, b.y);
      float R = (h * h + b.x * b.x) / (2.0 * b.x);
      float ys = h - b.y;
      float lens = max(length(f - vec2(R - b.x, ys)) - R, length(f - vec2(b.x - R, ys)) - R);
      d = min(sdBox(f - vec2(0.0, 0.5 * (ys + b.y)), vec2(b.x, 0.5 * (b.y - ys))), lens);
    } else {
      float yc = b.y - ra;
      float box = kind == 5 ? sdBox(f, vec2(b.x, yc)) : sdBox(f - vec2(0.0, 0.5 * ra), vec2(b.x, b.y - 0.5 * ra));
      d = min(box, length(f - vec2(0.0, -yc)) - ra);
    }
    if (kind == 7) {
      // A dip in the top between two ears; the outer corners trimmed by a wide arc so the ears come to points.
      float rc = 0.55 * b.x;
      d = max(d, rc - length(f - vec2(0.0, b.y + rc - max(rr, 0.5))));
      d = max(d, length(f) - length(vec2(0.9 * b.x, b.y)));
    }
    return d;
  }
  if (kind == 1) return sdChamferBox(q, b, rr);
  float k2 = kind == 2 ? rr : 0.0;
  float box = sdBox(q, b - k2) - k2;
  return kind == 3 ? max(box, rr - length(a - b)) : box;
}

// An ellipsoid cap of radii r at p: 1 at its centre, 0 at its rim.
float pnl_ell(vec2 p, vec2 r) {
  vec2 q = p / r;
  return sqrt(max(1.0 - dot(q, q), 0.0));
}

// Running ornament, one unit: p from the unit's centre (x along, y across, + inward), hh its half length and half
// width; 0..1 of the carving's height. 1 bead and reel, 2 egg and dart, 3 rope, 4 nailheads, 5 leaf tips.
float pnl_run(int k, vec2 p, vec2 hh) {
  vec2 n = p / hh;
  if (k == 1) return max(pnl_ell(p, vec2(0.62, 0.95) * hh), 0.85 * pnl_ell(vec2(abs(p.x) - 0.86 * hh.x, p.y), vec2(0.1, 0.72) * hh));
  if (k == 2) {
    // An egg in an open shell, a dart between eggs pointing inward.
    float egg = pnl_ell(p - vec2(0.0, 0.12 * hh.y), vec2(0.46, 0.7) * hh);
    float ring = length((p - vec2(0.0, 0.1 * hh.y)) / (vec2(0.72, 0.98) * hh));
    float shell = n.y > -0.7 ? pnl_ell(vec2(ring - 0.88, 0.0), vec2(0.12)) * 0.8 : 0.0;
    float dx = abs(abs(p.x) - hh.x);
    float wd = 0.24 * hh.x * clamp(0.62 - 0.62 * n.y, 0.0, 1.0);
    float dart = dx < wd ? (1.0 - dx / wd) * 0.85 : 0.0;
    return max(max(egg, shell), dart);
  }
  if (k == 3) {
    // Strands twisting round a round bead.
    float f = fract(0.5 * n.x + 0.32 * n.y);
    return sqrt(max(1.0 - n.y * n.y, 0.0)) * (0.35 + 0.65 * sqrt(sin(3.1415927 * f)));
  }
  if (k == 4) return max(0.0, 1.0 - max(abs(n.x), abs(n.y)) * 1.08);
  // A pointed leaf per unit, its tip at the outer edge, with a midrib; a tongue between leaves.
  float y01 = 0.5 * n.y + 0.5;
  float w = max(0.86 * sqrt(clamp(y01, 0.0, 1.0)) * (1.0 - 0.25 * y01), 1e-3);
  // Highest a little below the tip, where a carved leaf curls forward; lower at its foot.
  float leaf = abs(n.x) < w ? sqrt(1.0 - (n.x / w) * (n.x / w)) * (0.45 + 0.55 * (1.0 - abs(y01 - 0.3) / 0.7)) - 0.25 * max(0.0, 1.0 - abs(n.x) / 0.08) : 0.0;
  float tg = abs(abs(n.x) - 1.0);
  float tongue = tg < 0.1 && y01 > 0.35 ? (1.0 - tg / 0.1) * 0.45 : 0.0;
  return max(leaf, tongue);
}

// A corner piece: o from its anchor near the field's corner (the field's centre toward −x, −y), S its size; 0..1.
// 1 leaf spray (a leaf along the diagonal and one curling out to each side, from a bud), 2 fan, 3 rosette.
float pnl_corner(int k, vec2 o, float S) {
  float u = -(o.x + o.y) * 0.70710678;
  float v = (o.x - o.y) * 0.70710678;
  if (k == 2) {
    // A quarter sunburst: ribs fanning between the two edges, a scalloped rim, a hub at the anchor.
    float r = length(o);
    float th = atan(v, max(u, 1e-4));
    float hub = pnl_ell(o, vec2(0.22 * S));
    if (u <= 0.0 || abs(th) > 0.7854) return hub;
    // Ribs fade out toward the hub, where they come closer than a pixel and a half.
    float rib = mix(0.5, abs(fract((th / 1.5707963 + 0.5) * 7.0) - 0.5) * 2.0, clamp((r * 0.2244 - 1.5) / 1.5, 0.0, 1.0));
    float R = S * (0.86 + 0.14 * sqrt(max(1.0 - rib, 0.0)));
    return r < R ? max(sqrt(1.0 - (r / R) * (r / R)) * (0.55 + 0.45 * (1.0 - rib * rib)) * 0.85, hub) : hub;
  }
  if (k == 3) {
    // Six petals round a button, set in along the diagonal.
    vec2 c = vec2(u - 0.75 * S, v);
    float r = length(c);
    float pet = pow(abs(cos(3.0 * atan(c.y, c.x))), 0.7);
    float R = 0.75 * S * (0.62 + 0.38 * pet);
    float hp = r < R ? sqrt(1.0 - (r / R) * (r / R)) * (0.6 + 0.4 * pet) : 0.0;
    return max(hp, 1.1 * pnl_ell(c, vec2(0.2 * S)));
  }
  float best = 0.0;
  for (int i = 0; i < 3 * UNI_1; i++) {
    // Three leaves fanning out of the corner with gaps between them, the side ones curling out a little; lobed edges.
    float a = float(i - 1) * 0.66;
    float ca = cos(a), sa = sin(a);
    vec2 l = vec2(ca * u + sa * v, ca * v - sa * u);
    float len = S * (i == 1 ? 1.0 : 0.78);
    float x = l.x / len;
    float y = l.y + float(i - 1) * 0.2 * len * x * x;
    float w = 0.2 * len * pow(max(sin(3.1415927 * clamp(x, 0.0, 1.0)), 0.0), 0.7) * (0.82 + 0.18 * cos(x * 31.4159));
    if (x > 0.0 && x < 1.0 && abs(y) < w) {
      float s = abs(y) / w;
      float hl = sqrt(1.0 - s * s) * (0.65 + 0.35 * (1.0 - x)) - 0.3 * max(1.0 - abs(y) / max(0.12 * w, 0.4), 0.0);
      // Veins slanting toward the tip, where they are far enough apart to draw.
      if (len > 24.0) hl -= 0.12 * max(0.0, 1.0 - abs(fract(x * 5.0 - s * 0.8) - 0.5) * 6.0) * step(0.25, s);
      best = max(best, hl);
    }
    // The side leaves end in a scroll curling back toward the middle one.
    if (i != 1) {
      vec2 cc = vec2(l.x - 1.02 * len, y - float(i - 1) * 0.16 * len);
      float rc = 0.2 * len;
      float rr = length(cc);
      if (rr < rc) {
        float ridge = 1.0 - abs(fract(rr / (rc / 1.8) + float(i - 1) * atan(cc.y, cc.x) / 6.2831853) - 0.5) * 2.0;
        best = max(best, (0.45 + 0.4 * ridge) * sqrt(1.0 - (rr / rc) * (rr / rc)));
      }
    }
  }
  return max(best, 0.9 * pnl_ell(vec2(u - 0.06 * S, v), vec2(0.16 * S)));
}

// A medallion at the field's centre, half size m: 1 lozenge, 2 roundel, 3 quatrefoil — a bead round its rim and a
// face inside it, flat or domed; 0..1.
float pnl_medal(int k, vec2 q, vec2 m, bool domed) {
  float mm = min(m.x, m.y);
  vec2 a = abs(q);
  float d = k == 1 ? (a.x * m.y + a.y * m.x - m.x * m.y) / length(m)
    : k == 2 ? length(q) - mm
    : min(length(a - vec2(0.5 * mm, 0.0)), length(a - vec2(0.0, 0.5 * mm))) - 0.5 * mm;
  if (d > 0.5) return 0.0;
  float rw = max(1.25, 0.11 * mm);
  // Beads strung round the rim, about their own width apart (by the angle round the centre).
  float nb = max(8.0, floor(6.2831853 * (mm - rw) / (2.3 * rw)));
  float along = (fract(atan(q.y, q.x) / 6.2831853 * nb) - 0.5) * 6.2831853 * (mm - rw) / nb;
  float bead = pnl_ell(vec2(d + rw, along), vec2(rw, 1.1 * rw)) * clamp(0.5 - d, 0.0, 1.0);
  float inner = -d - 2.0 * rw;
  float face = (0.55 + (domed ? 0.45 * sqrt(clamp(inner / max(mm - 2.0 * rw, 1.0), 0.0, 1.0)) : 0.0)) * clamp(inner / 1.5, 0.0, 1.0);
  return max(bead, face);
}

// Distance to the nearest of the lines across direction n, sp apart, one through the centre.
float pnl_lines(vec2 q, vec2 n, float sp) { return abs(fract(dot(q, n) / sp + 0.5) - 0.5) * sp; }

GenOut gen(vec2 p) {
  // From the area's top-left (y down).
  vec2 q0 = vec2(p.x, uRes.y - p.y);
  vec2 q = q0;
  int nc = d_n.x, nr = d_n.y;
  int c0 = 0, r0 = 0;
  for (int i = 1; i < ${MAX_GRID}; i++) {
    if (i < nc && q.x >= d_cx[i]) c0 = i;
    if (i < nr && q.y >= d_ry[i]) r0 = i;
  }
  bool topB = u_band_top != 0 && nr > 1;
  bool botB = u_band_bot != 0 && nr > 1;
  bool band = (topB && r0 == 0) || (botB && r0 == nr - 1);
  // Stagger: alternate columns' rows (within the rows between the rails), or alternate rows' columns, shifted and
  // wrapped round.
  bool stagC = u_stagger > 0.0 && u_stag_by == 0;
  bool stagR = u_stagger > 0.0 && u_stag_by == 1;
  int c = c0, r = r0;
  if (!band && stagC && (c0 & 1) == 1) {
    float lo = topB ? d_ry[1] : 0.0;
    float hi = botB ? d_ry[nr - 1] : uRes.y;
    int n = nr - (topB ? 1 : 0) - (botB ? 1 : 0);
    q.y = lo + mod(q.y - lo - u_stagger * (hi - lo) / float(max(n, 1)), hi - lo);
    r = 0;
    for (int i = 1; i < ${MAX_GRID}; i++) if (i < nr && q.y >= d_ry[i]) r = i;
  }
  if (!band && stagR && (r0 & 1) == 1) {
    q.x = mod(q.x - u_stagger * uRes.x / float(nc), uRes.x);
    c = 0;
    for (int i = 1; i < ${MAX_GRID}; i++) if (i < nc && q.x >= d_cx[i]) c = i;
  }
  bool pil = !band && u_pilaster != 0 && (c0 & 1) == (u_pilaster == 1 ? 1 : 0);

  float h = u_frame;
  float d = 1.0;     // the panel's outline (the mask): positive off the panels
  float fd = 1e4;    // the fields' outline
  float bd = 1e4;    // bosses and capitals
  float rnd = 0.0;
  bool onFrame = false;
  // Running ornament or a pilaster's leaf capital, drawn once below: its kind, place, unit half size and height.
  int runK = 0;
  vec2 runP = vec2(0.0);
  vec2 runH = vec2(1.0);
  float runA = 0.0;

  if (band) {
    // A rail across the row: its profile from the panels' side out to the area's edge, dentils along its inner edge.
    bool top = topB && r0 == 0;
    float y0 = d_ry[r0], y1 = d_ry[r0 + 1];
    float px = top ? y1 - q0.y : q0.y - y0;
    float t = px / max(y1 - y0, 1.0);
    int bk = top ? u_band_top : u_band_bot;
    float blvl = top ? u_band_lvl : u_band_lvl2;
    float H = max(y1 - y0, 1.0);
    if (bk < 6) {
      h = mix(u_frame, blvl, bk == 1 ? clamp(px, 0.0, 1.0) : mouldEase(bk - 1, t, blvl > u_frame));
    } else {
      // Members from the panels' side to the edge: where each ends (share of the rail), its profile and the share of
      // the way from the frame to the rail level it reaches (a bead goes there and back).
      const float RT[12] = float[12](0.06, 0.16, 0.5, 0.56, 0.86, 1.0, 0.1, 0.22, 0.3, 0.36, 0.86, 1.0);
      const int RK[12] = int[12](0, 5, 3, 0, 4, 0, 1, 4, 5, 0, 0, 2);
      // Both end at the rail level at the edge, so a cornice meets a skirting without a step when the texture tiles.
      const float RF[12] = float[12](0.2, 0.45, 0.75, 0.8, 0.92, 1.0, 0.35, 0.75, 0.9, 0.62, 0.62, 1.0);
      int b0 = bk == 6 ? 0 : 6;
      float t0 = 0.0, f0 = 0.0, f = 0.0;
      float qd = 1e4;
      for (int i = 0; i < 6 * UNI_1; i++) {
        float t1 = RT[b0 + i];
        int k = RK[b0 + i];
        float fe = RF[b0 + i];
        if (t >= t0 && (t < t1 || i == 5)) {
          float tt = (t - t0) / max(t1 - t0, 1e-4);
          f = k == 0 ? mix(f0, fe, clamp((t - t0) * H, 0.0, 1.0))
            : k == 5 ? mix(f0, fe, mouldBead(tt))
            : mix(f0, fe, mouldEase(k, tt, fe > f0));
        }
        if (i < 5) qd = min(qd, abs(t - t1) * H);
        if (k != 5) f0 = fe;
        t0 = t1;
      }
      h = mix(u_frame, blvl, f) - u_quirk * clamp(1.0 - qd / 0.75, 0.0, 1.0);
    }
    if (top && u_dentils) {
      float span = (y1 - y0) * u_dentil_h;
      float per = u_dentil_w + u_dentil_gap;
      float xm = mod(q0.x - 0.5 * u_dentil_gap, per);
      float inside = min(min(xm, u_dentil_w - xm), min(px, span - px));
      h = mix(h, u_dentil_lvl, clamp(inside + 0.5, 0.0, 1.0));
    }
    rnd = hashI(ivec2(-1, r0), uSeed);
  } else if (pil) {
    // A pilaster: a shaft standing proud of the frame, rounded over at its edges, a plain block at each end (capital and
    // base) and flutes between.
    float x0 = d_cx[c0] + 0.5 * u_stile, x1 = d_cx[c0 + 1] - 0.5 * u_stile;
    float ya = topB ? d_ry[1] + 0.5 * u_rail : u_border_tb;
    float yb = botB ? d_ry[nr - 1] - 0.5 * u_rail : uRes.y - u_border_tb;
    vec2 ctr = 0.5 * vec2(x0 + x1, ya + yb);
    vec2 hb = max(0.5 * vec2(x1 - x0, yb - ya), vec2(0.5));
    vec2 lq = q0 - ctr;
    float dp = sdBox(lq, hb);
    float ey = hb.y - abs(lq.y);
    if (dp < 0.0) {
      h = mix(u_frame, u_pil_lvl, mouldEase(2, -dp / 1.5, u_pil_lvl > u_frame));
      if (u_pil_cap > 0.0) h += 0.06 * clamp(u_pil_cap - ey + 0.5, 0.0, 1.0) * clamp(-dp / 1.5, 0.0, 1.0);
      float m = 2.0;
      if (u_pil_flutes > 0 && ey > u_pil_cap + m) {
        float w = 2.0 * (hb.x - m);
        float sp = w / float(u_pil_flutes);
        float u = lq.x + hb.x - m;
        if (u > 0.0 && u < w) {
          float dist = abs(fract(u / sp) - 0.5) * sp;
          float s = clamp(dist / max(0.33 * sp, 0.25), 0.0, 1.0);
          h -= u_pil_fd * sqrt(max(1.0 - s * s, 0.0)) * clamp(ey - u_pil_cap - m, 0.0, 1.0);
        }
      }
      // A leaf capital's drop: a leaf hanging from its middle down the shaft.
      if (u_pil_orn == 1 && u_pil_cap > 0.0 && lq.y < 0.0 && ey >= u_pil_cap && ey < 1.7 * u_pil_cap) {
        float t = (ey - u_pil_cap) / (0.7 * u_pil_cap);
        float w = max(0.32 * hb.x * pow(1.0 - t, 0.7), 0.5);
        if (abs(lq.x) < w) h += 0.13 * sqrt(1.0 - (lq.x / w) * (lq.x / w)) * (1.0 - 0.5 * t);
      }
      // The capital (the top block): a row of upright leaves, or a pair of volutes over a bead.
      if (u_pil_orn != 0 && u_pil_cap > 0.0 && lq.y < 0.0 && ey < u_pil_cap) {
        if (u_pil_orn == 1) {
          // An abacus slab on top, a row of leaves under it, a bead at the neck.
          float ab = 0.24 * u_pil_cap;
          float lh = u_pil_cap - ab - 1.5;
          h += 0.05 * clamp(ab - ey + 0.5, 0.0, 1.0) - u_quirk * clamp(1.0 - abs(ey - ab) / 0.75, 0.0, 1.0);
          float n = max(1.0, floor(2.0 * hb.x / max(0.42 * u_pil_cap, 3.0) + 0.5));
          float per = 2.0 * hb.x / n;
          if (ey > ab) {
            runK = 5;
            runP = vec2(mod(lq.x + hb.x, per) - 0.5 * per, ey - ab - 0.5 * lh);
            runH = vec2(0.5 * per, 0.5 * lh);
            runA = 0.2;
          }
          h += 0.07 * pnl_ell(vec2(0.0, ey - u_pil_cap + 0.75), vec2(1.0, 1.1));
        } else {
          float R = 0.34 * u_pil_cap;
          vec2 rel = vec2(abs(lq.x), ey) - vec2(hb.x - 0.36 * u_pil_cap, 0.38 * u_pil_cap);
          float rr = length(rel);
          float ridge = 1.0 - abs(fract(rr / (R / 2.6) + atan(rel.y, rel.x) / 6.2831853) - 0.5) * 2.0;
          if (rr < R) h += 0.16 * (0.5 + 0.5 * ridge) * sqrt(1.0 - (rr / R) * (rr / R));
          h += 0.08 * pnl_ell(vec2(0.0, ey - 0.8 * u_pil_cap), vec2(1.0, 0.12 * u_pil_cap));
        }
      }
    }
    if (u_pil_cap > 0.0) bd = max(dp, ey - u_pil_cap);
    onFrame = dp >= 0.0;
    rnd = hashI(ivec2(c0, -1), uSeed);
  } else {
    ivec4 P = ivec4(texelFetch(t_cells, ivec2(c, r), 0) * 255.0 + 0.5);
    // Frame round the panel: half a stile / rail inside, the outer frame at the area's edges (none where the panels
    // wrap round, staggered).
    float il = P.x == 0 && !stagR ? u_border : 0.5 * u_stile;
    float ir = P.x + P.z >= nc && !stagR ? u_border : 0.5 * u_stile;
    float it = P.y == 0 && !stagC ? u_border_tb : 0.5 * u_rail;
    float ib = P.y + P.w >= nr && !stagC ? u_border_tb : 0.5 * u_rail;
    vec2 lo = vec2(d_cx[P.x] + il, d_ry[P.y] + it);
    vec2 hi = vec2(d_cx[P.x + P.z] - ir, d_ry[P.y + P.w] - ib);
    vec2 ctr = 0.5 * (lo + hi);
    vec2 hb = max(0.5 * (hi - lo), vec2(0.5));
    vec2 lq = q - ctr;
    // A side with no frame (no stile, no outer frame) stays open: the moulding runs on along it, not round its end.
    vec2 lo2 = lo - vec2(il <= 0.0 ? 1e3 : 0.0, it <= 0.0 ? 1e3 : 0.0);
    vec2 hi2 = hi + vec2(ir <= 0.0 ? 1e3 : 0.0, ib <= 0.0 ? 1e3 : 0.0);
    vec2 hb2 = max(0.5 * (hi2 - lo2), vec2(0.5));
    vec2 sq = q - 0.5 * (lo2 + hi2);
    // The shape may start from a later step (Shape from): the steps before it are square, the ones from it follow the
    // shape inset by their start — a notch round a carving inside a square outer moulding.
    float sStart = (u_shape_from > 1 ? u_m1_w : 0.0) + (u_shape_from > 2 ? u_m2_w : 0.0) + (u_shape_from > 3 ? u_m3_w : 0.0);
    float dRect = sdBox(sq, hb2);
    float ds = pnl_shape(sq, hb2 - sStart, u_corner, u_shape);
    d = sStart > 0.0 ? dRect : ds;
    // Inside the shaped step's square, the distance to its shape (outside it — in a notch — the steps before it run on
    // round the notch instead of stopping at its edge).
    float e = sStart > 0.0 && -dRect > sStart ? sStart - ds : -d;
    rnd = hashI(P.xy, uSeed);
    onFrame = e <= 0.0;

    // The moulding, from the outline in: each step from the level before it to its own (a bead or groove comes back).
    float W[${STEPS}] = float[${STEPS}](${Array.from({ length: STEPS }, (_, i) => `u_m${i + 1}_w`).join(', ')});
    int K[${STEPS}] = int[${STEPS}](${Array.from({ length: STEPS }, (_, i) => `u_m${i + 1}_prof`).join(', ')});
    float L[${STEPS}] = float[${STEPS}](${Array.from({ length: STEPS }, (_, i) => `u_m${i + 1}_lvl`).join(', ')});
    float lvl = u_frame;
    float pos = 0.0;
    bool done = onFrame;
    bool stop = false;
    // The step the pixel is in (for the running ornament): index, pass, where it starts and its width.
    int hitI = -1;
    // Distance to the nearest boundary between members (the quirks), and where the steps have got to.
    float qd = 1e4;
    float qpos = 0.0;
    int hitRep = 0;
    float hitPos = 0.0;
    float hitW = 1.0;
    for (int k = 0; k < ${4 * STEPS} * UNI_1; k++) {
      int rep = k / ${STEPS};
      int i = k - rep * ${STEPS};
      // A zero width ends the moulding (the steps after it are hidden too).
      if (W[i] <= 0.0) stop = true;
      if (!stop && rep < u_m_rep) {
        float w = W[i];
        int kind = K[i];
        float end = L[i];
        if (!done && e < pos + w) {
          float t = (e - pos) / w;
          h = kind == 0 ? mix(lvl, end, clamp(e - pos, 0.0, 1.0))
            : kind == 5 ? mix(lvl, end, mouldBead(t))
            : kind == 6 ? mix(lvl, end, mouldRidge(t))
            : mix(lvl, end, mouldEase(kind, t, end > lvl));
          hitI = i;
          hitRep = rep;
          hitPos = pos;
          hitW = w;
          done = true;
        }
        if (!done) {
          pos += w;
          if (kind < 5) lvl = end;
        }
        qpos += w;
        qd = min(qd, abs(e - qpos));
      }
      if (i == ${STEPS - 1}) stop = false;
    }
    fd = pos - e;
    if (e > 0.0) h -= u_quirk * clamp(1.0 - qd / 0.75, 0.0, 1.0);

    // Running ornament along one step of the moulding (its first pass): units fitted to each side so they meet in the
    // corner mitres, measured along the side's centre line.
    if (u_orn != 0 && hitI == u_orn_step - 1 && hitRep == 0) {
      float inset = hitPos + 0.5 * hitW;
      vec2 a = abs(lq);
      bool side = hb.x - a.x < hb.y - a.y;
      float L = max((side ? hb.y : hb.x) - inset, 0.5);
      float n = max(1.0, floor(2.0 * L / max(u_orn_len, 1.0) + 0.5));
      float per = 2.0 * L / n;
      runK = u_orn;
      runP = vec2(mod((side ? lq.y : lq.x) + L, per) - 0.5 * per, e - hitPos - 0.5 * hitW);
      runH = vec2(0.5 * per, 0.5 * hitW);
      runA = u_orn_d;
    }

    if (!done) {
      // The field.
      float f = e - pos;
      float span = max(min(hb.x, hb.y) - pos, 1.0);
      float top = clamp(u_field_lvl + (rnd - 0.5) * u_field_var, 0.0, 1.0);
      float face = 0.0;
      h = lvl;
      if (u_field == 1) {
        h = mix(lvl, top, u_field_prof == 0 ? clamp(f, 0.0, 1.0) : mouldEase(u_field_prof, f / max(u_field_w, 0.5), top > lvl));
        face = u_field_w;
      } else if (u_field == 2) {
        float t = clamp(f / span, 0.0, 1.0);
        h = mix(lvl, top, mouldRound(t));
      } else if (u_field == 3) {
        h = mix(lvl, top, clamp(f / span, 0.0, 1.0));
      }
      // The fill, on the face, from the panel's centre so it sits symmetrically.
      bool odd = u_fill_alt == 1 ? (P.y & 1) == 1 : u_fill_alt == 2 ? (P.x & 1) == 1 : u_fill_alt == 3 ? ((P.x + P.y) & 1) == 1 : false;
      int fk = odd ? u_fill2 : u_fill;
      if (fk != 0) {
        float sp = max(u_fill_sp, 1.0);
        vec2 n = fk <= 2 ? vec2(1.0, 0.0) : fk == 3 ? vec2(0.0, 1.0) : fk == 6 ? vec2(0.70710678, -0.70710678) : vec2(0.70710678);
        // Reeds: strips centred on the lines between grooves.
        float dist = pnl_lines(lq + (fk == 2 ? n * 0.5 * sp : vec2(0.0)), n, sp);
        if (fk == 5) dist = min(dist, pnl_lines(lq, vec2(0.70710678, -0.70710678), sp));
        float fade = clamp(f - face - u_fill_m, 0.0, 1.0);
        // Grooves at least 1.5 px across and softened by half a pixel, so thin ones don't stair-step.
        float hw = fk == 2 ? 0.5 * sp : max(0.5 * u_fill_w, 0.75) + 0.35;
        float s = clamp(dist / hw, 0.0, 1.0);
        float g = fk == 2 ? 1.0 - sqrt(max(1.0 - (1.0 - s) * (1.0 - s), 0.0)) : sqrt(max(1.0 - s * s, 0.0));
        h -= u_fill_d * g * fade;
      }
      // Carving on the field: a piece in each corner, a medallion at the centre.
      vec2 fh = max(hb - pos, vec2(0.5));
      if (u_co != 0) {
        vec2 anchor = max(fh - u_co_in, vec2(0.0));
        bool inside = u_shape < 4 || pnl_shape(sign(lq) * anchor, hb, u_corner, u_shape) < -pos;
        // Stretched along the top and bottom (Corner spread > 1) or down the sides.
        vec2 sp2 = vec2(sqrt(u_co_aspect), 1.0 / sqrt(u_co_aspect));
        float cv = inside ? pnl_corner(u_co, (abs(lq) - anchor) / sp2, u_co_size) : 0.0;
        h += u_co_d * cv;
        if (cv > 0.0) bd = min(bd, -0.5);
      }
      if (u_med != 0) {
        float mv = pnl_medal(u_med, lq, fh * u_med_size, u_med_dome);
        h += u_med_d * mv;
        if (mv > 0.0) bd = min(bd, -0.5);
      }
    }

    // Corner bosses, where the moulding turns: domed discs or square blocks.
    if (u_boss != 0) {
      // From the corner of the shaped outline (its step's inset with Shape from), so a boss can sit in the notch.
      vec2 bc = max(hb - sStart - u_boss_in, vec2(0.0));
      vec2 ba = abs(lq) - bc;
      float pet = pow(abs(cos(3.0 * atan(ba.y, ba.x))), 0.7);
      float db = u_boss == 2 ? sdBox(ba, vec2(u_boss_r)) : length(ba) - u_boss_r * (u_boss == 3 ? 0.72 + 0.28 * pet : 1.0);
      // Only where the corner is the panel's (an arch's top corners are frame): its centre inside the outline, or in a
      // notch.
      if (u_shape >= 4 && pnl_shape(sign(lq) * bc, hb, u_corner, u_shape) > 0.0) db = 1e4;
      bd = min(bd, db);
      if (db < 0.5) {
        float t = clamp(-db / max(u_boss == 2 ? 1.5 : 0.8 * u_boss_r, 0.5), 0.0, 1.0);
        float prof = u_boss == 2 ? t : mouldRound(t);
        // A rosette's petals rise toward their middles, round a button.
        if (u_boss == 3) prof = max(prof * (0.7 + 0.3 * pet), pnl_ell(ba, vec2(0.3 * u_boss_r)));
        h = mix(h, mix(h, u_boss_lvl, prof), clamp(0.5 - db, 0.0, 1.0));
      }
    }
  }

  if (runK > 0) h += runA * pnl_run(runK, runP, runH);

  // Boards: grooved joints across the frame, every Board width or on the grid lines.
  if (onFrame && u_boards != 0) {
    bool vert = u_boards == 1;
    float jd = u_board_w > 0.0
      ? abs(fract((vert ? q0.x : q0.y) / u_board_w + 0.5) - 0.5) * u_board_w
      : vert ? min(q.x - d_cx[c], d_cx[c + 1] - q.x) : min(q.y - d_ry[r], d_ry[r + 1] - q.y);
    h -= u_joint_d * clamp(1.0 - jd / max(0.5 * u_joint_w, 0.25), 0.0, 1.0);
  }

  // A part as a shape (Output).
  if (u_output == 1) return genOut(1.0, 1.0, rnd, fd);
  if (u_output == 2) return genOut(1.0, 1.0, rnd, band || pil ? -1.0 : -d);
  if (u_output == 3) return genOut(1.0, 1.0, rnd, bd);

  GenOut o = genOutOwn(clamp(h, 0.0, 1.0), 1.0, rnd, band || pil ? 1.0 : d);
  // Heights are the moulding's own: Height's per-feature variation would tear the frame between panels.
  o.feat = 0.0;
  return o;
}
`
};
