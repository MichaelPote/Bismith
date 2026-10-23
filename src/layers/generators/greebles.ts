// Greebles (FR7.2d): recursive kd-style subdivision of the tile into machine panels, decorated at every level — each
// piece may get a border or edge strips (pipe runs, grilles, lamps) before what is left splits again — with cut lines
// that step at 45° (trapezoids, rhomboids, diamonds), octilinear plate outlines (corners cut at 45°, L / T / Z / cross /
// U shapes), rivets and details on the final plates, and 45° beams laid over the lot. See greebleCommon.ts for the
// relief / SDF output convention.

import { P, gradient, halfPx } from '@/core/params';
import { PX_SCALE_PARAM } from '../commonParams';
import type { LayerDef } from '../types';
import { FASTENER_HEADS, GRB_GLSL } from './greebleCommon';

const hasFrame = (p: Record<string, unknown>) => Number(p.frame_chance) > 0;
const hasEdges = (p: Record<string, unknown>) => Number(p.edge_chance) > 0;
const hasRivets = (p: Record<string, unknown>) => p.rivets !== 'none';
const hasDetails = (p: Record<string, unknown>) => Number(p.detail_chance) > 0;
const hasPocket = (p: Record<string, unknown>) => Number(p.pocket) > 0;
/** Detail kinds are drawn: on panels (Chance), in edge strips, or in dark pockets. */
const hasKinds = (p: Record<string, unknown>) => hasDetails(p) || hasEdges(p) || hasPocket(p);
const hasSlots = (p: Record<string, unknown>) => hasKinds(p) && (Boolean(p.det_vents) || Boolean(p.det_holes));
/** Slot pitch and width size vents, perforation, ribs, mesh grilles and heatsink fins. */
const hasPitch = (p: Record<string, unknown>) =>
	hasKinds(p) && ['det_vents', 'det_holes', 'det_ribs', 'det_fins', 'det_mesh'].some((k) => Boolean(p[k]));
const hasLight = (p: Record<string, unknown>) => hasKinds(p) && Boolean(p.det_light);
const hasShapes = (p: Record<string, unknown>) => Number(p.shape_chance) > 0;
const hasJogs = (p: Record<string, unknown>) => Number(p.jog) > 0;
const hasChan = (p: Record<string, unknown>) => Number(p.chan_chance) > 0 || Number(p.routes) > 0;
const hasBeams = (p: Record<string, unknown>) => Number(p.beams) > 0;
const isRelief = (p: Record<string, unknown>) => (p.output ?? 'relief') === 'relief';
const hasStep = (p: Record<string, unknown>) =>
	hasFrame(p) && ['recess', 'raise', 'mixed'].includes(String(p.frame_style));
const hasLine = (p: Record<string, unknown>) =>
	hasFrame(p) && ['groove', 'ridge', 'mixed'].includes(String(p.frame_style));

/**
 * The detail kinds' toggles by their GLSL kind: bit k of the shader's grb_kinds() (5, a small part's bolt, has none).
 * The kind-pick tables (GRB_KORDER) and masks (GRB_K_*) in the GLSL index the same kinds.
 */
const DETAIL_KEYS = [
	'det_vents',
	'det_light',
	'det_recess',
	'det_holes',
	'det_ribs',
	'',
	'det_pipes',
	'det_switch',
	'det_socket',
	'det_slider',
	'det_keypad',
	'det_fan',
	'det_mesh',
	'det_circuit',
	'det_fins'
];
/** The hardware kinds (7–11): their code is the GRB_HW shader variant. */
const HW_KEYS = DETAIL_KEYS.slice(7, 12);
/** The kinds a hero part may be. */
const HERO_KEYS = [
	'det_vents',
	'det_light',
	'det_holes',
	'det_pipes',
	'det_fan',
	'det_mesh',
	'det_circuit',
	'det_fins'
];
/** The bits of those kinds in grb_kinds(). */
const kindBits = (keys: string[]) => keys.reduce((m, k) => m | (1 << DETAIL_KEYS.indexOf(k)), 0);
const MIN_HINT =
	'Panels smaller than this get none, so small panels stay plain — measured as the square root of the area, so a long narrow strip still counts (0 = any that fit)';

/**
 * The pinwheel root (`root: windmill`): the tile as a 5 × 5 grid of cells in 15 pieces — 5 squares and 10 bars two cells
 * long, from the windmill tiling whose squares sit on the lattice (1, 2), (−2, 1), which repeats every 5 cells both
 * ways — so no seam runs straight across the tile. Cell (x, y) → piece, row by row; each piece's cells as x0, y0, x1, y1
 * (x0, y0 in 0..4; x1 or y1 past 5 wraps round the tile).
 */
const WINDMILL_CELLS = [0, 2, 10, 10, 11, 4, 4, 5, 9, 11, 14, 3, 5, 13, 13, 14, 7, 7, 8, 12, 1, 2, 6, 8, 1];
const WINDMILL_RECTS = [
	[0, 0, 1, 1],
	[4, 4, 6, 5],
	[1, 4, 2, 6],
	[1, 2, 2, 3],
	[0, 1, 2, 2],
	[2, 1, 3, 3],
	[2, 4, 3, 5],
	[1, 3, 3, 4],
	[3, 3, 4, 5],
	[3, 1, 4, 2],
	[2, 0, 4, 1],
	[4, 0, 5, 2],
	[4, 3, 5, 4],
	[3, 2, 5, 3],
	[0, 2, 1, 4]
];
export const WINDMILL = { cells: WINDMILL_CELLS, rects: WINDMILL_RECTS };

export const greeblesLayer: LayerDef = {
	type: 'greebles',
	label: 'Greebles',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	// The relief writes its shape to the mask unless Shape for the mask is None; the shape outputs always do.
	maskWrite: (p) => (!isRelief(p) || (p.mask ?? 'plates') !== 'none' ? 'shape' : false),
	// The shader's optional parts (#ifdef in the GLSL), compiled only into the variants of layers that use them: a plain
	// layer's cold compile on D3D11 is seconds shorter without pipe channels and routes, jogs, beams, dark pockets and
	// hardware details.
	shaderFeatures: (p) => {
		const f: string[] = [];
		if (hasChan(p)) f.push('GRB_CHAN');
		if (hasJogs(p)) f.push('GRB_JOG');
		if (hasBeams(p)) f.push('GRB_BEAMS');
		if (hasPocket(p)) f.push('GRB_POCKET');
		if ((hasDetails(p) || hasEdges(p)) && HW_KEYS.some((k) => Boolean(p[k]))) f.push('GRB_HW');
		return f;
	},
	description:
		'Machine greebles: a recursive subdivision into panels, each piece at any level maybe bordered or edged with strips (pipe runs, grilles, lamps) before it splits again; cut lines that step at 45° into trapezoids and diamonds; octilinear plate outlines; rivets, vents, lights, recesses, perforations and pipes on the final plates; and 45° beams laid over them. Tileable.',
	params: [
		P.enum(
			'output',
			'Output',
			'relief',
			[
				['relief', 'Relief (all, value)'],
				['panels', 'Panels (shape)'],
				['seams', 'Seams (shape)'],
				['frames', 'Inset frames (shape)'],
				['rivets', 'Rivets (shape)'],
				['details', 'Details (shape)'],
				['lights', 'Lights (shape)'],
				['beams', 'Beams (shape)']
			],
			{
				hint: 'Relief composes every element into one height value (uses the Edge bevel). The shape outputs give one element class as a shape — stack copies with the same seed for separate materials'
			}
		),
		P.enum(
			'mask',
			'Shape for the mask',
			'plates',
			[
				['none', 'None', 'the relief leaves its mask as it was'],
				[
					'plates',
					'Plate tops',
					'the panels less everything sunk into them: slots, holes, recesses, light housings, groove lines and recessed centres'
				],
				['panels', 'Panels', 'the whole panels: only the seams left out'],
				['seams', 'Seams', 'the gaps between the panels'],
				['frames', 'Inset frames', 'the frame lines, or the raised / recessed centres'],
				['rivets', 'Rivets'],
				['details', 'Details', 'vent slots, holes, recesses and light housings'],
				['lights', 'Lights', 'the lenses'],
				['beams', 'Beams']
			],
			{
				showIf: isRelief,
				hint: 'What the relief hands to the mask it writes (Mask › Write to), for later layers to be limited to (grime in the seams, paint on the plates only, glow in the lenses) or chip and bevel from — no second Greebles layer needed'
			}
		),
		P.enum(
			'root',
			'Layout',
			'pinwheel',
			[
				[
					'tile',
					'Whole tile',
					'the tile is the first panel, cut in two (or as a pinwheel, by Pinwheel splits); its border is a seam (Offset moves it)'
				],
				[
					'pinwheel',
					'Pinwheel',
					'the tile is first cut as a pinwheel, four panels round a centre one, so no seam runs straight across it; its border is a seam'
				],
				[
					'windmill',
					'Interlocked',
					'15 interlocking pieces (5 squares, 10 bars, at random widths) round the torus: no border seam either, so tiled copies show no grid at the tile size'
				]
			],
			{ hint: 'What the subdivision starts from' }
		),
		P.int('depth', 'Depth', 16, 0, 24, {
			softMax: 16,
			hint: 'Maximum number of recursive splits. It stops the splits first: if panels stay above Max panel, raise it'
		}),
		P.int('min_size', 'Min panel', 7, 1, 2048, {
			softMax: 128,
			unit: 'px',
			hint: 'No panel side is cut below this. Panels only get this small where cuts go on: with Split chance, Clustering, and a Max panel close to it (on a small tile, lower Max panel for busy zones)'
		}),
		P.int('max_size', 'Max panel', 40, 1, 8192, {
			softMax: 512,
			unit: 'px',
			hint: 'Sides longer than this are always cut (while Min panel and Depth allow)'
		}),
		P.float('split', 'Split chance', 0.65, 0, 1, {
			step: 0.001,
			hint: 'Chance to cut a panel that is between min and max size'
		}),
		P.float('cluster', 'Clustering', 0.45, 0, 1, {
			step: 0.001,
			hint: 'Regions decide together: busy zones of small panels next to calm, big plates. 0 = every panel decides alone. It works between Min and Max panel, so a Max panel near Min leaves it little to do'
		}),
		P.float('diag', 'Diagonal cuts', 0, 0, 1, {
			step: 0.001,
			hint: 'Chance a split runs at 45° instead of across or down: triangles, trapezoids and cut-off corners that split on in turn'
		}),
		P.float('seamless', 'Seamless splits', 1, 0, 1, {
			step: 0.001,
			hint: 'Every piece that splits stands on its parent with its own bevel and outline, its parts on it (the seams between them as deep as it stands): this is the chance a piece skips that and keeps its parent’s height, its parts carrying on. 1 = only the final panels draw, all down to the floor'
		}),
		P.float('pinwheel', 'Pinwheel splits', 0.3, 0, 1, {
			step: 0.001,
			hint: 'Chance a panel splits into five as a pinwheel (four round a centre) instead of in two, so seams stop at each other instead of running edge to edge'
		}),
		P.float('aspect', 'Panel aspect', 1, 0.05, 20, {
			softMin: 0.125,
			softMax: 8,
			step: 0.01,
			hint: 'Height ÷ width of the min and max panel (their geometric mean stays): above 1 tall panels and columns, below 1 wide panels and rows'
		}),
		P.float('bias', 'Cut bias', 0, -1, 1, {
			step: 0.001,
			hint: 'Optional cuts: −1 = vertical cuts (columns), +1 = horizontal cuts (rows), 0 = cut across the longer side. Sides above Max panel are cut anyway (Panel aspect stretches the max)'
		}),
		P.float('split_var', 'Cut randomness', 0.7, 0, 1, {
			step: 0.001,
			hint: '0 = always cut in the middle, 1 = anywhere'
		}),
		P.int('snap', 'Cut grid', 1, 1, 512, {
			softMax: 64,
			unit: 'px',
			hint: 'Cuts snap to multiples of this (from the tile origin)'
		}),
		P.float('gap', 'Seam', 1, 0, 128, {
			softMax: 12,
			unit: 'px',
			step: 0.5,
			hint: 'Seam along the left and top of each panel (whole px stays crisp)'
		}),
		P.float('seam_taper', 'Seam taper', 0.5, 0, 1, {
			step: 0.001,
			hint: 'Main seams wide, fine ones thin: each level of cuts narrows its seams by this fraction (to 1 px). 0 = every seam is Seam wide'
		}),
		P.float('edge_seam', 'Tile-edge seam', 0.34, 0, 1, {
			step: 0.001,
			showIf: (p) => p.root !== 'windmill',
			hint: 'The seam along the tile border as a share of Seam (whole px): low values keep tiled copies from showing a grid of wide seams at the tile size. 0 = the border panels meet with only their bevels'
		}),
		P.float('seam_max', 'Seam limit', 0.12, 0, 0.5, {
			step: 0.001,
			hint: 'No seam wider than this share of the shorter side of its panel (at least 1 px): the small panels of busy zones get thin seams instead of a waffle grid. 0 = no limit'
		}),
		P.float('round', 'Corner rounding', 0.5, 0, 128, { softMax: 24, unit: 'px', step: 0.1 }),
		P.int('levels', 'Height levels', 4, 1, 16, { hint: 'Distinct per-panel heights (relief)' }),
		P.float('height_var', 'Height variation', 0.35, 0, 1, {
			step: 0.001,
			hint: 'How far the lowest panel level sits below the highest: 1 = down at the seam floor unless Lowest level holds it up (relief)'
		}),
		P.float('min_level', 'Lowest level', 0.25, 0, 1, {
			step: 0.001,
			hint: 'The lowest panels never sink below this fraction of the highest, so their seams stay visible however large the Height variation; the levels spread evenly above it (relief)'
		}),
		P.float('bulge_spread', 'Bulge spread', 0.7, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.bulge) !== 0,
			hint: 'How far in from the edges the bulge keeps rising: 0 a cushion (rounded edges, flat top) … 1 a full dome'
		}),
		P.float('bulge', 'Bulge', 0.12, -0.75, 1, {
			softMin: -0.75,
			softMax: 0.75,
			step: 0.001,
			hint: 'Panels dome up towards their centre (pillowed plates) by this much on the highest level, lower ones in proportion; negative dishes them in, −0.75 down to the floor (relief)'
		}),
		P.float('inset_depth', 'Inset depth', 0.25, 0, 1, {
			step: 0.001,
			hint: 'Depth of grooves, recesses and light housings, and the rise of raised frames (relief)'
		}),
		P.float('offset_x', 'Offset X', 0, 0, 1, {
			step: 0.001,
			hint: 'Shift the layout (fraction of the width) so the tile edge is not a seam'
		}),
		P.float('offset_y', 'Offset Y', 0, 0, 1, { step: 0.001 }),
		P.seed(),

		P.float('jog', 'Amount', 0, 0, 1, {
			step: 0.001,
			group: 'jogs',
			hint: 'Cut lines step sideways at 45°: how far, as a share of the room each line has before it would meet its neighbours. Small values jog the seams; large ones turn boxes into trapezoids, rhomboids and diamonds. 0 = straight seams'
		}),
		P.float('jog_chance', 'Chance', 0.7, 0, 1, {
			step: 0.001,
			group: 'jogs',
			showIf: hasJogs,
			hint: 'Chance each stretch of a line steps'
		}),
		P.int('jog_layers', 'Steps', 2, 1, 4, {
			group: 'jogs',
			showIf: hasJogs,
			hint: 'Stretches along each line, each of which may step: more steps, more intricate borders'
		}),

		P.int('routes', 'Routes', 0, 0, 4, {
			group: 'chan',
			hint: 'Channels straight across the whole tile (each wraps onto itself, so tiled copies continue it), cutting through every panel they cross — long pipe runs; the settings below shape them too'
		}),
		P.enum(
			'route_dir',
			'Route direction',
			'vertical',
			[
				['vertical', 'Down', 'top to bottom'],
				['horizontal', 'Across', 'left to right'],
				['mixed', 'Mixed', 'each route one of the two (they may cross)']
			],
			{ group: 'chan', showIf: (p) => Number(p.routes) > 0 }
		),
		P.float('route_wander', 'Wander', 0.3, 0, 1, {
			step: 0.001,
			group: 'chan',
			showIf: (p) => Number(p.routes) > 0,
			hint: 'How far a route steps sideways at 45° on its way (Jogs › Steps, Chance; Bend radius), as a share of a fifth of the tile'
		}),
		P.enum(
			'junction',
			'Crossings',
			'over',
			[
				[
					'box',
					'Junction box',
					'a box over each crossing (Box size), the down route’s tubes passing over the other’s round it'
				],
				['over', 'Over and under', 'no box: the down route’s tubes pass over the across route’s']
			],
			{ group: 'chan', showIf: (p) => Number(p.routes) > 1 }
		),
		P.float('junction_size', 'Box size', 0.9, 0.2, 1.5, {
			step: 0.001,
			group: 'chan',
			showIf: (p) => Number(p.routes) > 1 && p.junction === 'box',
			hint: 'The junction box’s side as a share of the channel width (1: as wide as the channels; above, wider)'
		}),
		P.float('chan_chance', 'Chance', 0, 0, 1, {
			step: 0.001,
			group: 'chan',
			hint: 'Chance a cut in the top Levels of the splitting sinks into a channel carrying a pipe run: it runs the full length of the cut, across the pieces below, and follows its jogs round long-radius bends'
		}),
		P.int('chan_levels', 'Levels', 3, 1, 12, {
			group: 'chan',
			showIf: hasChan,
			hint: 'Only cuts this near the top of the splitting (the long ones) become channels'
		}),
		P.float('chan_width', 'Width', 12, 2, 1024, { softMax: 96, unit: 'px', step: 0.5, group: 'chan', showIf: hasChan }),
		P.float('chan_var', 'Width variation', 0.3, 0, 1, {
			step: 0.001,
			group: 'chan',
			showIf: hasChan,
			hint: 'Each channel its own width, down to (1 − this) × Width'
		}),
		P.float('chan_bend', 'Bend radius', 6, 0, 512, {
			softMax: 64,
			unit: 'px',
			step: 0.5,
			group: 'chan',
			showIf: hasChan,
			hint: 'How far a channel eases into and out of each 45° jog (Jogs › Amount)'
		}),
		P.float('chan_floor', 'Floor', 0.05, 0, 1, {
			step: 0.001,
			group: 'chan',
			showIf: hasChan,
			hint: 'Height of the channel floor as a share of the surface it cuts into (0 = the seam floor)'
		}),
		P.float('chan_surface', 'Laid on top', 0, 0, 1, {
			step: 0.001,
			group: 'chan',
			showIf: hasChan,
			hint: 'Share of the runs laid on top of the pieces instead of sunk in a channel: hoses crossing the panels below, a collar at each end'
		}),
		P.float('tube_lift', 'Pipe lift', 1, 0.2, 2, {
			step: 0.001,
			group: 'chan',
			showIf: hasChan,
			hint: 'How high the tubes stand, in proportion to their size: at 1 a thick pipe in a channel is level with the plates; above, they stand proud'
		}),
		P.int('tube_count', 'Tubes', 4, 1, 8, {
			group: 'chan',
			showIf: hasChan,
			hint: 'Up to this many tubes side by side (as many as fit)'
		}),
		P.float('tube_big', 'Pipe size', 4, 0.5, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.5,
			group: 'chan',
			showIf: hasChan,
			hint: 'Diameter of the thick pipes'
		}),
		P.float('tube_thin', 'Cable size', 1.5, 0.5, 256, {
			softMax: 16,
			unit: 'px',
			step: 0.5,
			group: 'chan',
			showIf: hasChan,
			hint: 'Diameter of the thin cables'
		}),
		P.float('tube_mix', 'Thick share', 0.4, 0, 1, {
			step: 0.001,
			group: 'chan',
			showIf: hasChan,
			hint: 'Chance each tube is a thick pipe rather than a cable'
		}),
		P.float('clamp_space', 'Clamp spacing', 24, 0, 2048, {
			softMax: 256,
			unit: 'px',
			group: 'chan',
			showIf: hasChan,
			hint: 'Clamps along the run (0 = none)'
		}),
		P.enum(
			'clamp_style',
			'Clamps',
			'mixed',
			[
				['bands', 'Bands', 'a strap over the whole bundle'],
				['couplings', 'Couplings', 'a ring round each thick pipe'],
				['mixed', 'Mixed', 'each channel one of the two']
			],
			{ group: 'chan', showIf: hasChan }
		),
		P.float('braid', 'Ribs', 0, 0, 1, {
			step: 0.001,
			group: 'chan',
			showIf: hasChan,
			hint: 'Ribs ringing the tubes square to their run, round the bends too: corrugated hoses'
		}),

		P.float('cut_chance', 'Cut corners', 0.2, 0, 1, {
			step: 0.001,
			group: 'outline',
			hint: 'Share of the plates’ outside corners cut off at 45°, each corner on its own: all four make an octagon, two side by side an arrow'
		}),
		P.float('cut_size', 'Cut size', 0.25, 0.05, 0.5, {
			step: 0.001,
			group: 'outline',
			showIf: (p) => Number(p.cut_chance) > 0,
			hint: 'Chamfer leg as a share of the shorter of the corner’s two edges: 0.5 meets the next chamfer at mid-edge (a diamond)'
		}),
		P.float('cut_var', 'Cut variation', 0.5, 0, 1, {
			step: 0.001,
			group: 'outline',
			showIf: (p) => Number(p.cut_chance) > 0,
			hint: 'Each chamfer its own size, down to (1 − this) × Cut size'
		}),
		P.float('shape_chance', 'Shaped panels', 0.15, 0, 1, {
			step: 0.001,
			group: 'outline',
			hint: 'Share of the panels (from Min panel) whose plate is an L, T, Z, cross or U instead of the whole panel; the floor or backing shows in the rest'
		}),
		P.enum(
			'shape_kind',
			'Shapes',
			'mixed',
			[
				['l', 'L', 'an arm along two sides'],
				['t', 'T', 'a bar along one side on a stem: a funnel'],
				['z', 'Step', 'two overlapping blocks in opposite corners'],
				['cross', 'Cross', 'a bar each way'],
				['u', 'Notch', 'one side notched in the middle'],
				['mixed', 'Mixed', 'each panel one of the five']
			],
			{ group: 'outline', showIf: hasShapes }
		),
		P.int('shape_min', 'Min panel', 20, 0, 2048, {
			softMax: 128,
			unit: 'px',
			group: 'outline',
			showIf: hasShapes,
			hint: MIN_HINT
		}),
		P.float('fillet', 'Inside corners', 0.35, 0, 0.5, {
			step: 0.001,
			group: 'outline',
			showIf: hasShapes,
			hint: 'The inside corners of shaped plates filled at 45°: leg as a share of the shorter of the corner’s two edges (0 = square)'
		}),
		P.float('empty', 'Empty panels', 0, 0, 1, {
			step: 0.001,
			group: 'outline',
			hint: 'Share of the panels left out: only their backing (or the floor) shows'
		}),
		P.enum(
			'fill',
			'Fill',
			'backing',
			[
				['floor', 'Floor', 'the seam floor shows'],
				['backing', 'Backing plate', 'a lower plate under the plate (Backing height)'],
				[
					'plates',
					'Plates',
					'plates of their own, a seam away from the plate and following its outline — the panels interlock'
				]
			],
			{
				group: 'outline',
				hint: 'What fills a panel where its plate leaves it: cut corners, the cut-away parts of shaped panels, empty panels'
			}
		),
		P.float('backing', 'Backing height', 0.5, 0, 1, {
			step: 0.001,
			group: 'outline',
			showIf: (p) => (p.fill ?? 'backing') === 'backing',
			hint: 'As a share of the panel’s height'
		}),

		P.float('frame_chance', 'Chance', 0.3, 0, 1, {
			step: 0.001,
			group: 'frame',
			hint: 'Chance a piece — at any level of the splitting, not only the final panels — gets a border round it; the splitting carries on inside it'
		}),
		P.int('frame_min', 'Min panel', 16, 0, 2048, {
			softMax: 128,
			unit: 'px',
			group: 'frame',
			showIf: hasFrame,
			hint: MIN_HINT
		}),
		P.enum(
			'frame_style',
			'Style',
			'mixed',
			[
				['groove', 'Groove line', 'a groove down the middle of the border'],
				['ridge', 'Raised line', 'a ridge down the middle of the border'],
				['recess', 'Recessed centre', 'the inside steps down from the border'],
				['raise', 'Raised centre', 'the inside steps up from the border'],
				['rivets', 'Rivets', 'a row of rivets along the border (Rivets › Radius, Spacing, Height)'],
				['mixed', 'Mixed', 'each border one of the five']
			],
			{ group: 'frame', showIf: hasFrame }
		),
		P.float('frame_var', 'Margin variation', 0, 0, 1, {
			step: 0.001,
			group: 'frame',
			showIf: hasFrame,
			hint: 'Each side of a border its own width (from flush to 2.5 × Width): with a raised centre, smaller plates stand anywhere on their pieces, and on theirs in turn'
		}),
		P.float('frame_inset', 'Width', 3.5, 1, 512, {
			softMax: 32,
			unit: 'px',
			step: 0.5,
			group: 'frame',
			showIf: hasFrame
		}),
		P.float('frame_lift', 'Step height', 1, 0, 3, {
			step: 0.001,
			group: 'frame',
			showIf: hasStep,
			hint: 'How far a raised centre climbs (or a recessed one sinks), × its usual share of Inset depth: bolder insets'
		}),
		P.float('frame_bevel', 'Step bevel', 0, 0, 512, {
			softMax: 32,
			unit: 'px',
			step: 0.5,
			group: 'frame',
			showIf: hasStep,
			hint: 'Bevel of the step in from a border to a raised or recessed centre: wide chamfered insets (0 = the Edge bevel)'
		}),
		P.float('frame_width', 'Line width', 1, 0.5, 128, {
			softMax: 8,
			unit: 'px',
			step: 0.5,
			group: 'frame',
			showIf: hasLine
		}),

		P.float('edge_chance', 'Chance', 0.15, 0, 1, {
			step: 0.001,
			group: 'edges',
			hint: 'Chance a piece (at any level, if it gets no border) gets a strip along one of its long sides holding a pipe run or a detail — a vent grille, lamps, ribs or perforation (the Details kinds that are on); the splitting carries on beside it'
		}),
		P.int('edge_min', 'Min panel', 24, 0, 2048, {
			softMax: 128,
			unit: 'px',
			group: 'edges',
			showIf: hasEdges,
			hint: MIN_HINT
		}),
		P.float('edge_width', 'Width', 5, 3, 512, {
			softMax: 48,
			unit: 'px',
			step: 0.5,
			group: 'edges',
			showIf: hasEdges,
			hint: 'At most 0.35 of the piece across'
		}),
		P.float('edge_two', 'Second strip', 0.4, 0, 1, {
			step: 0.001,
			group: 'edges',
			showIf: hasEdges,
			hint: 'Chance of a second strip along a short side, meeting the first in a corner: a pipe run then wraps round the inside'
		}),
		P.float('edge_pipes', 'Pipe runs', 0.5, 0, 1, {
			step: 0.001,
			group: 'edges',
			showIf: hasEdges,
			hint: 'Share of the strips holding a pipe run (Details › Pipes & handles on: its Pipe runs and Min tube), the rest a detail'
		}),

		P.enum(
			'rivets',
			'Rivets',
			'mixed',
			[
				['none', 'None'],
				['corners', 'Corners'],
				['edges', 'Along edges'],
				['sides', 'Along the long sides'],
				['mixed', 'Mixed', 'each panel corners, edges or long sides']
			],
			{
				group: 'rivets',
				hint: 'A panel too narrow for two rivets across gets one line of them down its middle (a strap)'
			}
		),
		P.float('rivet_chance', 'Chance', 0.6, 0, 1, { step: 0.001, group: 'rivets', showIf: hasRivets }),
		P.int('rivet_min', 'Min panel', 12, 0, 2048, {
			softMax: 128,
			unit: 'px',
			group: 'rivets',
			showIf: hasRivets,
			hint: MIN_HINT
		}),
		P.float('rivet_radius', 'Radius', 1, 0.5, 64, {
			softMax: 12,
			unit: 'px',
			step: 0.5,
			group: 'rivets',
			showIf: hasRivets,
			hint: 'Whole or half px: 1 → 2×2, 1.5 → 3×3'
		}),
		P.float('rivet_inset', 'Inset', 2, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.5,
			group: 'rivets',
			showIf: hasRivets,
			hint: 'Panel edge to rivet centre'
		}),
		P.float('rivet_spacing', 'Spacing', 8, 1, 512, {
			softMax: 64,
			unit: 'px',
			step: 0.5,
			group: 'rivets',
			showIf: (p) => hasRivets(p) && p.rivets !== 'corners'
		}),
		P.float('rivet_height', 'Height', 0.3, 0, 1, {
			step: 0.001,
			group: 'rivets',
			showIf: hasRivets,
			hint: 'Dome height above the panel; a hole’s depth (relief)'
		}),
		P.enum(
			'rivet_style',
			'Style',
			'dome',
			[...FASTENER_HEADS, ['mixed', 'Mixed', 'mostly sunk Allen bolts, some domes and sunk hex heads']],
			{
				group: 'rivets',
				showIf: hasRivets,
				hint: 'The sunk kinds stand in a round counterbore (Radius: the head)'
			}
		),

		P.float('detail_chance', 'Chance', 0.55, 0, 1, {
			step: 0.001,
			group: 'details',
			hint: 'Fraction of panels with a detail'
		}),
		P.int('det_min', 'Min panel', 12, 0, 2048, {
			softMax: 128,
			unit: 'px',
			group: 'details',
			showIf: hasDetails,
			hint: MIN_HINT
		}),
		P.bool('det_vents', 'Vent slots', true, { group: 'details', showIf: hasKinds }),
		P.bool('det_light', 'Light', true, { group: 'details', showIf: hasKinds }),
		P.bool('det_recess', 'Recess', true, { group: 'details', showIf: hasKinds }),
		P.bool('det_holes', 'Perforation', true, {
			group: 'details',
			showIf: hasKinds,
			hint: 'A grid of round holes (Slot pitch apart, Slot width across)'
		}),
		P.enum(
			'hole_bond',
			'Hole layout',
			'grid',
			[
				['grid', 'Grid', 'holes in line both ways'],
				['bond', 'Masonry bond', 'every second row shifted half the pitch, one hole fewer, like courses of bricks']
			],
			{ group: 'details', showIf: (p) => hasKinds(p) && p.det_holes !== false }
		),
		P.bool('det_ribs', 'Ribs', true, {
			group: 'details',
			showIf: hasKinds,
			hint: 'Rounded bars standing up from the plate, Slot pitch apart and Slot width wide (raised by 0.8 × Inset depth)'
		}),
		P.bool('det_switch', 'Switches', true, {
			group: 'details',
			showIf: hasKinds,
			hint: 'A row of toggle switches (hex nut, lever) or rocker switches'
		}),
		P.bool('det_socket', 'Plug sockets', true, {
			group: 'details',
			showIf: hasKinds,
			hint: 'A D-shell or round connector: a raised rim, a sunk face, pins'
		}),
		P.bool('det_slider', 'Sliders', true, {
			group: 'details',
			showIf: hasKinds,
			hint: 'A slot with tick marks and a ridged knob (long areas)'
		}),
		P.bool('det_keypad', 'Keypads', true, {
			group: 'details',
			showIf: hasKinds,
			hint: 'Rounded keys three across in a sunk bezel'
		}),
		P.bool('det_fan', 'Fans', true, {
			group: 'details',
			showIf: hasKinds,
			hint: 'Curved blades round a domed hub in a sunk round housing (squarish areas; also a hero part)'
		}),
		P.bool('det_mesh', 'Mesh grilles', true, {
			group: 'details',
			showIf: hasKinds,
			hint: 'A sunk panel behind a fine wire grid (half the Slot pitch)'
		}),
		P.bool('det_circuit', 'Circuit pockets', true, {
			group: 'details',
			showIf: hasKinds,
			hint: 'A deep dark pocket with chips of a few sizes and their pins'
		}),
		P.bool('det_fins', 'Heatsink fins', true, {
			group: 'details',
			showIf: hasKinds,
			hint: 'Bars across the area (Slot width thick, Slot pitch apart): a comb, also in edge strips'
		}),
		P.bool('det_pipes', 'Pipes & handles', true, {
			group: 'details',
			showIf: hasKinds,
			hint: 'A pipe run (a bundle of parallel tubes turning through round elbows) or a grab handle, standing on the plate (raised by Inset depth) between two flange plates'
		}),
		P.float('pipe_size', 'Pipe size', 0.15, 0.05, 0.4, {
			step: 0.001,
			group: 'details',
			showIf: (p) => hasKinds(p) && Boolean(p.det_pipes),
			hint: 'Tube diameter as a share of the detail area’s short side'
		}),
		P.float('pipe_min', 'Min tube', 2, 1, 64, {
			softMax: 12,
			unit: 'px',
			step: 0.5,
			group: 'details',
			showIf: (p) => hasKinds(p) && Boolean(p.det_pipes),
			hint: 'Thinnest tube diameter: areas too small for a tube this thick (with its flanges) get another kind of detail'
		}),
		P.int('pipe_runs', 'Pipe runs', 3, 1, 4, {
			group: 'details',
			showIf: (p) => hasKinds(p) && Boolean(p.det_pipes),
			hint: 'Up to this many tubes side by side in a run (each run picks 1…this, as many as fit)'
		}),
		P.float('pocket', 'Dark pockets', 0, 0, 1, {
			step: 0.001,
			group: 'details',
			hint: 'Chance a piece — at any level below the top, at least twice Min panel across — sinks nearly to the floor as a dark pocket and stops splitting, its floor packed with chips and their pins (mostly), heatsink fins or a mesh'
		}),
		P.float('pocket_max', 'Max pocket', 0, 0, 4096, {
			softMax: 512,
			unit: 'px',
			group: 'details',
			showIf: (p) => Number(p.pocket) > 0,
			hint: 'Only pieces no longer than this sink as dark pockets, so they stay busy recesses instead of voids (0 = any size)'
		}),
		P.float('pocket_part', 'Pocket parts', 0.06, 0, 1, {
			step: 0.001,
			group: 'details',
			showIf: (p) => Number(p.pocket) > 0,
			hint: 'How high the parts in a dark pocket stand from its floor (relief): low keeps them in the dark band of a height-driven colour ramp'
		}),
		P.float('hw_share', 'Hardware share', 0.3, 0, 1, {
			step: 0.001,
			group: 'details',
			showIf: hasDetails,
			hint: 'Chance a detail is hardware (switches, sockets, sliders, keypads, fans) when one fits, else one of the others'
		}),
		P.float('hero', 'Hero parts', 0.6, 0, 1, {
			step: 0.001,
			group: 'details',
			showIf: hasDetails,
			hint: 'Share of the panels at least 2.5 × the detail Min panel whose detail is a big one filling most of the panel: a recessed grille or perforation, a light panel or a pipe run'
		}),
		P.float('small_parts', 'Small parts', 0.5, 0, 1, {
			step: 0.001,
			group: 'details',
			showIf: hasDetails,
			hint: 'Share of the panels below the detail Min panel that get one small part — a bolt (Rivets › Radius and Height) or a short slot — so busy zones are not blank boxes. Off while Chance is 0'
		}),
		P.float('det_size', 'Size', 0.6, 0.05, 1, {
			step: 0.001,
			group: 'details',
			showIf: hasDetails,
			hint: 'Detail area as a fraction of the panel'
		}),
		P.float('det_var', 'Size variation', 0.4, 0, 1, {
			step: 0.001,
			group: 'details',
			showIf: hasDetails,
			hint: 'Each detail area its own size, down to (1 − this) × Size'
		}),
		P.enum(
			'det_anchor',
			'Placement',
			'mixed',
			[
				['centre', 'Centred'],
				['edge', 'Against an edge', 'pushed to a random side of the panel (clear of its frame and rivets)'],
				['corner', 'In a corner', 'pushed into a random corner'],
				['mixed', 'Mixed', 'each panel one of the three']
			],
			{ group: 'details', showIf: hasDetails }
		),
		P.float('det_pair', 'Paired details', 0.35, 0, 1, {
			step: 0.001,
			group: 'details',
			showIf: hasDetails,
			hint: 'Share of the detailed panels that get two details side by side along their length (a lamp beside a grille), each its own kind'
		}),
		P.float('det_scatter', 'Scattered details', 0, 0, 1, {
			step: 0.001,
			group: 'details',
			showIf: hasDetails,
			hint: 'Panels at least two Scatter cells long split their free area into cells, this share of which hold a small detail of their own (slot banks, dot rows, recesses spread over a big plate) instead of one large one'
		}),
		P.float('det_cell', 'Scatter cell', 48, 8, 1024, {
			softMax: 160,
			unit: 'px',
			step: 1,
			group: 'details',
			showIf: (p) => hasDetails(p) && (p.det_scatter as number) > 0,
			hint: 'The size of the cells a scattered panel is split into'
		}),
		P.float('recess_wall', 'Recess wall', 1.5, 0, 256, {
			softMax: 16,
			unit: 'px',
			step: 0.5,
			group: 'details',
			showIf: hasKinds,
			hint: 'How wide the walls of recesses slope down to their floor (0 = the Edge bevel)'
		}),
		P.float('det_bay', 'Recessed grilles', 0.5, 0, 1, {
			step: 0.001,
			group: 'details',
			showIf: hasSlots,
			hint: 'Share of the vent slots and perforations set in a recess of their own'
		}),
		P.float('vent_pitch', 'Slot pitch', 2, 2, 128, {
			softMax: 24,
			unit: 'px',
			step: 0.5,
			group: 'details',
			showIf: hasPitch,
			hint: 'Vent slots and perforation holes: centre to centre'
		}),
		P.float('vent_slot', 'Slot width', 1, 1, 64, {
			softMax: 12,
			unit: 'px',
			step: 0.5,
			group: 'details',
			showIf: hasPitch,
			hint: 'Vent slot width and hole diameter (a 1 px bar always stays between them)'
		}),
		P.enum(
			'light_style',
			'Light',
			'mixed',
			[
				['lens', 'One lens', 'Light size × Light length, centred'],
				['row', 'Row of lamps', 'round lamps of Light size along one long edge of the detail area'],
				['strip', 'Strip', 'Light size wide along one long edge of the detail area'],
				['window', 'Light panel', 'fills the detail area'],
				['mixed', 'Mixed', 'each panel one of the four']
			],
			{ group: 'details', showIf: hasLight }
		),
		P.float('light_size', 'Light size', 1.5, 1, 128, {
			softMax: 24,
			unit: 'px',
			step: 0.5,
			group: 'details',
			showIf: hasLight,
			hint: 'Short side of a lens or strip, a lamp’s diameter (at least: see Light scale)'
		}),
		P.float('light_rel', 'Light scale', 0.3, 0, 1, {
			step: 0.001,
			group: 'details',
			showIf: hasLight,
			hint: 'Lights grow with their detail area: at least this share of its short side (0 = Light size only)'
		}),
		P.float('light_len', 'Light length', 3, 1, 64, {
			softMax: 8,
			step: 0.1,
			group: 'details',
			showIf: (p) => hasLight(p) && ['lens', 'mixed'].includes(String(p.light_style ?? 'lens')),
			hint: 'One lens: long side ÷ short side (it stays inside the detail area)'
		}),
		P.float('light_rim', 'Housing', 1, 0, 64, {
			softMax: 8,
			unit: 'px',
			step: 0.5,
			group: 'details',
			showIf: hasLight,
			hint: 'Width of the recessed housing round the lens'
		}),
		P.float('light_dome', 'Lens dome', 0.35, 0, 1, {
			step: 0.001,
			group: 'details',
			showIf: hasLight,
			hint: 'The lens bulges up out of its housing like a glass cover (relief); 0 = a flat lens sunk in the housing'
		}),

		P.int('beams', 'Count', 0, 0, 8, {
			group: 'beams',
			hint: 'Long straps laid over everything, straight across the tile (they wrap round, so they tile) — at 45° or level'
		}),
		P.enum(
			'beam_dir',
			'Direction',
			'diagonal',
			[
				['diagonal', 'Diagonal', 'each beam rising or falling at 45°'],
				['rising', 'Rising', 'all at 45°, up to the right'],
				['falling', 'Falling', 'all at 45°, down to the right'],
				['straight', 'Level', 'each beam horizontal or vertical'],
				['mixed', 'Mixed', 'each beam any of the four']
			],
			{ group: 'beams', showIf: hasBeams }
		),
		P.float('beam_width', 'Width', 6, 1, 512, { softMax: 32, unit: 'px', step: 0.5, group: 'beams', showIf: hasBeams }),
		P.float('beam_var', 'Width variation', 0.3, 0, 1, {
			step: 0.001,
			group: 'beams',
			showIf: hasBeams,
			hint: 'Each beam its own width, down to (1 − this) × Width'
		}),
		P.float('beam_len', 'Length', 1, 0.05, 1, {
			step: 0.001,
			group: 'beams',
			showIf: hasBeams,
			hint: 'As a share of the tile’s shorter side (each beam 60–100 % of it); 1 = endless'
		}),
		P.float('beam_height', 'Height', 0.3, -1, 1, {
			step: 0.001,
			group: 'beams',
			showIf: hasBeams,
			hint: 'How far a beam stands up from what it lies on — it follows the relief under it; negative sinks a channel instead (relief)'
		}),
		P.enum(
			'beam_style',
			'Style',
			'strap',
			[
				['strap', 'Strap', 'a flat band with bevelled sides'],
				['rails', 'Rails', 'two thin bars along the band’s edges'],
				['grooved', 'Grooved', 'a band with a groove down its middle']
			],
			{ group: 'beams', showIf: hasBeams }
		),
		// Not a control: 1 px of the texture in shader px. Supersampling scales every px param by k, so this tells the shader
		// how big a texture pixel is — the sizes below which a part would not read (a lens, a switch, a chip) scale with it.
		PX_SCALE_PARAM
	],
	groups: [
		{ id: 'jogs', label: 'Jogs', collapsed: true },
		{ id: 'chan', label: 'Pipe channels', collapsed: true },
		{ id: 'outline', label: 'Plate outlines', collapsed: true },
		{ id: 'frame', label: 'Borders', collapsed: true },
		{ id: 'edges', label: 'Edge strips', collapsed: true },
		{ id: 'rivets', label: 'Rivets', collapsed: true },
		{ id: 'details', label: 'Details', collapsed: true },
		{ id: 'beams', label: 'Beams', collapsed: true }
	],
	defaults: {
		h_on: true,
		h_amount: 0.6,
		bevel: 1,
		profile: 'smooth',
		dif_on: true,
		dif_src: 'value',
		dif_jitter: 0.12,
		dif_grad: gradient('#0f1011', '#3a3d41', '#5d6166', '#7e8388', '#b6babe')
	},
	// Added in the editor: the plain defaults (a 128 px texture) scaled to the texture — panel sizes, seams, rivets, frames,
	// slots, lights and tubes; small textures get crisp pixel edges with a 1 px ramp.
	fresh: ({ width, height }) => {
		const k = Math.min(16, Math.max(0.125, Math.sqrt(width * height) / 128));
		const px = (v: number, lo = 1) => Math.max(lo, Math.round(v));
		const small = k <= 0.75;
		return {
			min_size: px(7 * k, 6),
			max_size: px(40 * k, 24),
			snap: px(k),
			gap: px(0.75 * k),
			round: halfPx(0.4 * k, 0),
			bevel: halfPx(0.6 * k, 1),
			profile: small ? 'linear' : 'smooth',
			aa: !small,
			frame_min: px(Math.max(16, 10 * k)),
			frame_inset: halfPx(3.5 * k, 2),
			frame_width: px(0.5 * k),
			rivet_min: px(Math.max(12, 10 * k)),
			rivet_radius: halfPx(0.75 * k),
			rivet_inset: halfPx(2 * k, 1),
			rivet_spacing: halfPx(8 * k, 2),
			det_min: px(Math.max(12, 8 * k)),
			pipe_min: px(Math.max(2, 1.25 * k)),
			recess_wall: halfPx(1.5 * k, 1),
			vent_pitch: halfPx(2 * k, 2),
			vent_slot: halfPx(k, 1),
			light_size: halfPx(1.5 * k, 1),
			light_rim: px(0.5 * k),
			shape_min: px(Math.max(20, 20 * k)),
			beam_width: px(6 * k, 2),
			edge_min: px(Math.max(24, 20 * k)),
			chan_width: halfPx(12 * k, 2),
			chan_bend: halfPx(6 * k, 0),
			tube_big: halfPx(4 * k, 1),
			tube_thin: halfPx(1.5 * k, 1),
			clamp_space: px(24 * k),
			edge_width: halfPx(5 * k, 3)
		};
	},
	glsl:
		GRB_GLSL +
		/* glsl */ `
// The detail kinds switched on: bit k for kind k (DETAIL_KEYS). The kinds a hero part may be, the hardware, the rest of
// a panel's kinds, a small part's (one slot, or the bolt, 5).
int grb_kinds() { return ${DETAIL_KEYS.map((k, i) => (k ? `(u_${k} ? ${1 << i} : 0)` : ''))
			.filter(Boolean)
			.join(' | ')}; }
#define GRB_K_HERO ${kindBits(HERO_KEYS)}
#define GRB_K_HW ${kindBits(HW_KEYS)}
#define GRB_K_PANEL ${kindBits(DETAIL_KEYS.filter(Boolean))}
#define GRB_K_SMALL ${kindBits(['det_vents']) | (1 << 5)}
// The order kinds are picked in (-1: none): a panel's (hardware last: Hardware share picks among those), a hero's, a
// small part's.
const int GRB_KORDER[42] = int[42](0, 1, 2, 3, 4, 6, 12, 13, 14, 7, 8, 9, 10, 11,
                                   0, 3, 1, 6, 11, 12, 13, 14, -1, -1, -1, -1, -1, -1,
                                   0, 5, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1);

// A panel's cell: its cuts as straight lines — lo..hi across and down, dlo..dhi along x + y (.x) and x − y (.y) for
// 45° cuts — and gap, the seam widths along its left, top, lower-left (x + y) and upper-left (x − y) edges. dS / dG: the
// distances in from its true (stepping) sides to the plate, seams taken off — left, right, bottom, top / the 45° sides
// (x + y low, high, x − y low, high); dL the distance out to the nearest seam line on its side. vb / hb: the surface the
// pieces above it leave, and that surface's height. kind: where
// the pixel stopped — 0 the final plate, 1 a piece's border (dw wide), 2 a piece's edge strip (dw wide, along side
// (0 left, 1 right, 2 bottom, 3 top) and maybe side2 round the corner; sel 1: the pixel is in side2's). ls: the step of a
// border round the final plate (1e9: none). dLk: dL in the space Bevel aspect stretches (greebleCommon; a jog's 45°
// stretches as if straight). kind 3: a pipe channel (dw wide) along a cut; ch: across it from its middle (signed) and
// along it; chl: 1 where the channel's (or laid run's) line is level, clamps allowed. pk: the piece sank as a dark pocket. ov / ovid / ovt: a pipe run laid on top that the pixel lies under (across, along, width; its id; its ends
// along the cut) — ov.z 0: none. jm4: how far each side's line steps off its straight course (left, right, bottom,
// top); hm: how far a hose laid across the pieces above reaches in from each side.
struct GrbCell { vec2 lo; vec2 hi; vec2 dlo; vec2 dhi; uint id; vec4 gap; vec4 dS; vec4 dG; float dL; float vb; float hb; int kind; float dw; int side; int side2; int sel; float ls; float dLk; vec2 ch; vec3 ov; uint ovid; vec2 ovt; bool pk; float chl; vec4 jm4; vec4 hm; vec2 arc; };

// A box from min / max corners (px).
float grb_box(vec2 p, vec2 lo, vec2 hi) { return sdBox(p - 0.5 * (lo + hi), 0.5 * (hi - lo)); }

// Random 0..1 for key k of a feature id.
float grb_rand(uint id, uint k) { return u2f(pcg(id + k * 0x9E3779B9u)); }
// Four randoms 0..1 (8 bits each) from one hash: key k of a feature id.
vec4 grb_rand4(uint id, uint k) {
  uint h = pcg(id + k * 0x9E3779B9u);
  return vec4(uvec4(h, h >> 8u, h >> 16u, h >> 24u) & 255u) / 256.0;
}

// Component i (0..3) of v, without indexing (D3D compiles a dynamic index into a slow indexable temporary).
float grb_pick(vec4 v, int i) { return dot(v, vec4(equal(ivec4(i), ivec4(0, 1, 2, 3)))); }

// The smallest and next-smallest of eight distances (a, b) — flat vector work, no loop (a tie gives the same twice).
vec2 grb_min8(vec4 a, vec4 b) {
  vec4 m = min(a, b);
  float m1 = min(min(m.x, m.y), min(m.z, m.w));
  vec4 ea = step(a, vec4(m1)), eb = step(b, vec4(m1));
  vec4 m2v = min(a + 1e9 * ea, b + 1e9 * eb);
  float m2 = min(min(m2v.x, m2v.y), min(m2v.z, m2v.w));
  return vec2(m1, dot(ea + eb, vec4(1.0)) > 1.5 ? m1 : m2);
}

// Distance from p to the arc of the circle round o (radius r) from a to b (the short way); 1e9 off its span (the
// pieces either side cover that).
float grb_arcD(vec2 p, vec2 o, float r, vec2 a, vec2 b) {
  vec2 v = p - o, va = a - o, vb = b - o;
  float c = va.x * vb.y - va.y * vb.x;
  bool inA = (va.x * v.y - va.y * v.x) * c >= 0.0 && (v.x * vb.y - v.y * vb.x) * c >= 0.0;
  return inA ? abs(length(v) - r) : 1e9;
}

// A piece of a line nearer than ds so far: it takes over ds and the length along the line at its nearest point (sN).
void grb_nearS(float d, float sv, inout float ds, inout float sN) { if (d < ds) { ds = d; sN = sv; } }
// The distance from p to segment a..b (x) and the share of it along to the nearest point (y).
vec2 grb_segH(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a, ap = p - a;
  float h = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return vec2(length(ap - ab * h), h);
}

// A cut line's steps at (t along it, u across it from the cut) over the piece's extent tlo..thi along it (grb_jog). It
// starts at a random offset f0 within ±a and in each of Steps stretches (L long) of the extent may step at 45° to another
// (whole px): a large Amount turns boxes into trapezoids, rhomboids and diamonds. b > 0 rounds each bend into a true
// circular arc of radius b (fitted to the room); b = 0 keeps crisp corners. ex: a stretch along the line kept level (no
// bend in it — where another route crosses; ex.x > ex.y: none). Step i, from offset off: how far it steps (x), where its
// 45° stretch starts (y) and its bends' tangent length (z).
vec3 grb_jogStep(int i, float off, float f0, float tlo, float L, bool wrap, uint id, float a, float b, vec2 ex) {
  vec4 r = grb_rand4(id, 78u + uint(i));
  bool last = wrap && i == u_jog_layers - 1;
  float tg = last ? f0 : floor(a * (2.0 * r.x - 1.0) + 0.5);
  // (A line across the whole tile steps at least half its reach each time, so it never runs dead straight.)
  if (wrap && !last && a >= 2.0) tg = off + (tg >= off ? 1.0 : -1.0) * max(abs(tg - off), floor(0.5 * a + 0.5));
  float st = clamp(tg - off, -floor(0.85 * L), floor(0.85 * L)) * (last ? 1.0 : step(r.y, u_jog_chance));
  float al = abs(st);
  // The bends' tangent length T (a 45° bend of radius R reaches R·tan 22.5° either side of its corner): at most
  // radius b, and short enough to leave a straight 45° stretch and level room either side.
  float T = b > 0.0 ? min(0.41421356 * b, min(0.35 * al, 0.45 * max(L - al, 0.0))) : 0.0;
  float t0 = tlo + float(i) * L + T + floor(r.z * max(L - al - 2.0 * T, 0.0));
  // (A step that would bend inside ex moves past it, or before it, if its stretch has room; else it is dropped — but the
  // closing step of a wrapping line stays.)
  if (ex.x <= ex.y && al >= 1.0 && t0 - T < ex.y && t0 + al + T > ex.x) {
    float s0 = tlo + float(i) * L, s1 = s0 + L, ta = ex.y + T, tb = ex.x - al - T;
    if (ta + al + T <= s1) t0 = ta;
    else if (tb - T >= s0) t0 = tb;
    else if (!last) st = 0.0;
    // (The closing step must stay: as far from the band's middle as its stretch allows — the band covers the crossing
    // route's whole reach, so its edge is usually clear.)
    else t0 = abs(s0 + T - 0.5 * (ex.x + ex.y)) > abs(s1 - al - T - 0.5 * (ex.x + ex.y)) ? s0 + T : s1 - al - T;
  }
  return vec3(st, t0, T);
}

// A step's bends and 45° stretch (grb_jogStep: st from off, starting at t0, tangent length T): level run, arc, 45°
// stretch, arc — the arcs' centres R off the level runs on the inside of each bend (T = 0: crisp corners, the arcs shrunk
// to the corner points). P1..P4: where the pieces meet; O1, O2: the arcs' centres.
void grb_jogBends(float off, float st, float t0, float T, out vec2 P1, out vec2 P2, out vec2 P3, out vec2 P4, out vec2 O1, out vec2 O2) {
  float sg = st < 0.0 ? -1.0 : 1.0;
  float R = T / 0.41421356;
  vec2 bd = vec2(0.70710678, 0.70710678 * sg);
  vec2 C1 = vec2(t0, off), C2 = vec2(t0 + abs(st), off + st);
  P1 = C1 - vec2(T, 0.0); P2 = C1 + bd * T; P3 = C2 - bd * T; P4 = C2 + vec2(T, 0.0);
  O1 = P1 + vec2(0.0, sg * R); O2 = P4 - vec2(0.0, sg * R);
}
// The line's offset at t past a step's bends (f: what it was before them), piece by piece.
float grb_jogF(float t, float f, float off, float st, float t0, float T) {
  vec2 P1, P2, P3, P4, O1, O2;
  grb_jogBends(off, st, t0, T, P1, P2, P3, P4, O1, O2);
  float sg = st < 0.0 ? -1.0 : 1.0, R = T / 0.41421356;
  if (t >= P1.x && t < P2.x) return O1.y - sg * sqrt(max(R * R - (t - O1.x) * (t - O1.x), 0.0));
  if (t >= P2.x && t < P3.x) return off + sg * (t - t0);
  if (t >= P3.x && t < P4.x) return O2.y + sg * sqrt(max(R * R - (t - O2.x) * (t - O2.x), 0.0));
  return t >= P4.x ? off + st : f;
}

// A cut line (grb_jogStep) at (t, u): its offset at t (x) and the distance from (t, u) to the line (y). The distance is
// exact — the line is straight runs and arcs — so lines parallel to it (the tubes of a pipe run) are concentric round the
// bends and stay parallel. z: 1 on a level run (clear of the bends by a few px), else 0 — where clamps may sit. w: the
// length along the line at the point nearest (t, u), for what repeats along it.
vec4 grb_jog(float t, float u, float tlo, float thi, float per, uint id, float a, float b, vec2 ex) {
  float L = (thi - tlo) / float(max(u_jog_layers, 1));
  float f = floor(a * (2.0 * grb_rand(id, 77u) - 1.0) + 0.5);
  float f0 = f, off = f, ds = 1e9;   // the start; the offset as the line goes; the distance so far
  vec2 p = vec2(t, u);
  float runT = tlo;                   // where the level run before the next bend starts
  float lvl = 1.0;
  float sa = 0.0, sN = 0.0;           // the length along the line to runT; at the point nearest (t, u)
  // A line across the whole tile comes back to where it started, so it meets itself across the wrap.
  bool wrap = thi - tlo >= per - 0.5;
  for (int i = 0; i < u_jog_layers; i++) {
    vec3 js = grb_jogStep(i, off, f0, tlo, L, wrap, id, a, b, ex);
    float st = js.x;
    if (abs(st) >= 1.0) {
      vec2 P1, P2, P3, P4, O1, O2;
      grb_jogBends(off, st, js.y, js.z, P1, P2, P3, P4, O1, O2);
      float R = js.z / 0.41421356;
      // Each piece's distance, and the length along the line at its nearest point: level run, arc (R · the angle from
      // its start), 45° stretch, arc.
      float La = 0.78539816 * R, Ld = length(P3 - P2), s1 = sa + (P1.x - runT);
      // (On an arc, the share along its chord: within a few % of the angle's over 45°.)
      vec2 h0 = grb_segH(p, vec2(runT, off), P1), h2 = grb_segH(p, P2, P3);
      grb_nearS(h0.x, sa + h0.y * (P1.x - runT), ds, sN);
      grb_nearS(grb_arcD(p, O1, R, P1, P2), s1 + La * grb_segH(p, P1, P2).y, ds, sN);
      grb_nearS(h2.x, s1 + La + h2.y * Ld, ds, sN);
      grb_nearS(grb_arcD(p, O2, R, P3, P4), s1 + La + Ld + La * grb_segH(p, P3, P4).y, ds, sN);
      sa = s1 + 2.0 * La + Ld;
      runT = P4.x;
      if (t > P1.x - 4.0 * u_px_scale && t < P4.x + 4.0 * u_px_scale) lvl = 0.0;
      f = grb_jogF(t, f, off, st, js.y, js.z);
    }
    off += st;
  }
  // The last level run, to the end. (Past the ends the level runs go on, so the length does too.)
  grb_nearS(sdSegment(p, vec2(runT, off), vec2(thi, off)), sa + t - runT, ds, sN);
  // (A line round the whole tile: scaled to the tile's length, so what repeats along it meets itself across the wrap.)
  if (wrap) sN *= (thi - tlo) / max(sa + (thi - runT), 1.0);
  return vec4(f, ds, lvl, sN);
}

// A cut line's offset at t alone: grb_jog's x, without the distances (no level stretch).
float grb_jogOff(float t, float tlo, float thi, float per, uint id, float a, float b) {
  float L = (thi - tlo) / float(max(u_jog_layers, 1));
  float f = floor(a * (2.0 * grb_rand(id, 77u) - 1.0) + 0.5), f0 = f, off = f;
  bool wrap = thi - tlo >= per - 0.5;
  for (int i = 0; i < u_jog_layers; i++) {
    vec3 js = grb_jogStep(i, off, f0, tlo, L, wrap, id, a, b, vec2(1.0, 0.0));
    if (abs(js.x) >= 1.0) f = grb_jogF(t, f, off, js.x, js.y, js.z);
    off += js.x;
  }
  return f;
}

// The bounding box (xy low, zw high) of the octagon lo..hi, x + y in dlo.x..dhi.x, x − y in dlo.y..dhi.y, and its corner
// cuts as legs k (x bottom-left, y bottom-right, z top-left, w top-right).
vec4 grb_octBox(vec2 lo, vec2 hi, vec2 dlo, vec2 dhi, out vec4 k) {
  for (int i = 0; i < 2; i++) {
    lo.x = max(lo.x, max(dlo.x - hi.y, dlo.y + lo.y));
    hi.x = min(hi.x, min(dhi.x - lo.y, dhi.y + hi.y));
    lo.y = max(lo.y, max(dlo.x - hi.x, lo.x - dhi.y));
    hi.y = min(hi.y, min(dhi.x - lo.x, hi.x - dlo.y));
  }
  vec2 s = max(hi - lo, vec2(0.0));
  k = clamp(vec4(dlo.x - (lo.x + lo.y), (hi.x - lo.y) - dhi.y, dlo.y - (lo.x - hi.y), (hi.x + hi.y) - dhi.x), 0.0, min(s.x, s.y));
  return vec4(lo, hi);
}

const int GRB_WM_CELL[25] = int[25](${WINDMILL_CELLS.join(', ')});
const vec4 GRB_WM_RECT[15] = vec4[15](${WINDMILL_RECTS.map((r) => `vec4(${r.map((v) => v.toFixed(1)).join(', ')})`).join(', ')});

// Cut positions (x and y at once) between a0 and a1 at fraction t of the allowed range, snapped to the cut grid
// (whole px as a fallback), keeping both children >= mn. -1 where no valid cut exists.
vec2 grb_cutPos(vec2 a0, vec2 a1, vec2 t, vec2 mn) {
  vec2 c = mix(a0 + mn, a1 - mn, t);
  float s = float(max(u_snap, 1));
  vec2 lo = a0 + mn - 1e-3, hi = a1 - mn + 1e-3;
  vec2 cs = floor(c / s + 0.5) * s;
  cs += s * vec2(lessThan(cs, lo));
  cs -= s * vec2(greaterThan(cs, hi));
  vec2 cr = floor(c + 0.5);
  vec2 r = mix(vec2(-1.0), cr, step(lo, cr) * step(cr, hi));
  return mix(r, cs, step(lo, cs) * step(cs, hi));
}

// Seam width of a cut at level L (0 = the first cuts and the tile edge): whole px below the top level, at least 1 px.
float grb_seamW(float L) {
  if (u_seam_taper <= 0.0 || L <= 0.0) return u_gap;
  return max(floor(u_gap * pow(1.0 - u_seam_taper, L) + 0.5), min(u_gap, 1.0));
}

// Below the root pinwheel, a cut (x and y) that lands on one of its seam lines (rl: x1, x2, y1, y2) moves off it, to the
// other side if it must, staying within clo..chi (else -1: no cut that way) — so it doesn't carry that seam on across
// the tile. "On" = closer than
// two seams and two bevels: a seam that close reads as the same line, jogged.
vec2 grb_offLines(vec2 c, vec4 rl, vec2 clo, vec2 chi, float sg) {
  float nd = ceil(max(2.0 * u_gap + 2.0 * u_bevel + 2.0, sg) / sg) * sg;
  vec2 o1 = c - rl.xz, o2 = c - rl.yw;
  vec2 n1 = step(abs(o1), abs(o2));
  vec2 o = mix(o2, o1, n1), base = mix(rl.yw, rl.xz, n1);
  vec2 near = step(abs(o), vec2(nd - 0.5)) * step(0.0, c);
  vec2 aw = mix(vec2(-1.0), vec2(1.0), step(0.0, o)) * nd;
  vec2 ca = base + aw, cb = base - aw;
  clo -= 1e-3;
  chi += 1e-3;
  // Neither side fits: no cut that way (the panel is cut the other way, or stays whole).
  vec2 moved = mix(mix(vec2(-1.0), cb, step(clo, cb) * step(cb, chi)), ca, step(clo, ca) * step(ca, chi));
  return mix(c, moved, near);
}

// Line j of the interlocked root's 5 × 5 grid (both ways), whole px: each a random share of a cell off the even
// spacing, the same in every period.
vec2 grb_wmLine(vec2 j, vec2 cw, uint id) {
  vec2 jm = j - 5.0 * floor(j / 5.0);
  vec2 r = vec2(grb_rand(id, 30u + uint(jm.x)), grb_rand(id, 40u + uint(jm.y)));
  return floor((j + 0.6 * (r - 0.5)) * cw + 0.5);
}

// The top plateau: the highest panel level, which the pieces' lifts, laid pipes and the junction lid measure from.
#define GRB_TOP 0.75

// A piece's height on the surface it stands on (hb): a share g (its level) of the headroom up to the top plateau (GRB_TOP),
// at least a quarter of the top's — so seams between pieces always cut down, finer and shallower deeper in.
float grb_lift(float hb, float g) { return hb + max(GRB_TOP - hb, 0.1875) * g; }

// The 45° cuts across the corners of the box lo..hi, legs k (x bottom-left, y bottom-right, z top-left, w top-right;
// 0 = none): the distance out past the nearest (-1e4 where none).
float grb_corners(vec2 p, vec2 lo, vec2 hi, vec4 k) {
  vec2 pc = p - 0.5 * (lo + hi), h = 0.5 * (hi - lo);
  vec4 dc = (vec4(-pc.x, pc.x, -pc.x, pc.x) + vec4(-pc.y, -pc.y, pc.y, pc.y) - (h.x + h.y) + k) * 0.70710678;
  dc = mix(vec4(-1e4), dc, step(0.5, k));
  return max(max(dc.x, dc.y), max(dc.z, dc.w));
}

// Bevel rises (grb_rise) of two distances, each over its own width, through one copy of the profile.
vec2 grb_rise2(vec2 d, vec2 w) {
  vec2 r = vec2(0.0);
  for (int i = 0; i < 2 * UNI_1; i++) r += grb_rise(i == 0 ? d.x : d.y, i == 0 ? w.x : w.y) * vec2(equal(ivec2(i), ivec2(0, 1)));
  return r;
}

// The meeting of the two nearest sides (distances in m.x ≤ m.y) rounded by r.
float grb_roundMin(vec2 m, float r) { return m.x < r && m.y < r ? r - length(vec2(r - m.x, r - m.y)) : m.x; }

// The Bevel aspect's stretch of a 45° side (greebleCommon: a jog's 45° stretches as if straight).
float grb_bevKD() { return u_bevel / bevelWidth(vec2(1.0)); }

// Pipe routes: Routes channels straight across the tile, down (or across), each a whole path that wraps onto itself
// and wanders at 45° (Wander, round bends of Bend radius), cutting through every panel it crosses. The nearest one's
// (across from its middle, along, half width, index); half width 0: none near.
// Route i's line: whether it runs down (x), where it sits across (y, px along its period), its half width (z), its
// wander's reach (w); rid: its id.
vec4 grb_routeLine(int i, out uint rid) {
  rid = pcg(uint(uSeed) * 0x9E3779B9u + uint(i) * 0x85EBCA6Bu + 0x7A3D2C11u);
  vec4 rr = grb_rand4(rid, 1u);
  bool vert = u_route_dir == 0 || (u_route_dir == 2 && rr.x < 0.5);
  float per = vert ? uRes.x : uRes.y;
  return vec4(vert ? 1.0 : 0.0, floor((float(i) + 0.2 + 0.6 * rr.y) / float(u_routes) * per),
              0.5 * u_chan_width * (1.0 - u_chan_var * rr.z), u_route_wander * 0.2 * per);
}

// A pipe run's tube i (of its id's bundle): a thick pipe (Thick share) or a thin cable, its diameter; the gap after it
// (laid on top: separate hoses, apart).
float grb_tubeDm(uint id, int i) { return grb_rand4(id, 120u + uint(i)).x < u_tube_mix ? u_tube_big : u_tube_thin; }
float grb_tubeGap(float dm, bool top) { return top ? max(1.5, 0.35 * dm) : max(0.5, 0.15 * dm); }

// The junction box's lid over two routes' crossing: just above the tallest tube the settings allow.
float grb_lidTop() { return max(GRB_TOP + u_inset_depth, (GRB_TOP + 0.75 * u_inset_depth) * 1.3 * u_tube_lift); }

// The id of route i's tubes.
uint grb_routeTubeId(float i) { return pcg(uint(uSeed) + uint(i) * 0x632BE5ABu + 0x2F1A5B3Du); }

vec4 grb_route(vec2 q, out float e2, out float lv, out vec4 sec, out float lv2, out vec2 sArc) {
  vec4 best = vec4(1e9, 0.0, 0.0, -1.0);
  float be = 1e9;
  e2 = 1e9;   // the next-nearest route's channel edge
  lv = 1.0;   // the nearest on a level run
  sec = vec4(1e9, 0.0, 0.0, -1.0);   // the next-nearest, as best
  lv2 = 1.0;
  sArc = vec2(0.0);   // the length along the nearest, the next-nearest
  // Where a route of the other direction crosses, kept level (the first such; its whole wander band and a margin), so
  // crossings are square: for the down routes (exV) and the across ones (exH).
  vec2 exV = vec2(1.0, 0.0), exH = vec2(1.0, 0.0);
  uint rid;
  for (int j = 0; j < u_routes; j++) {
    vec4 rj = grb_routeLine(j, rid);
    vec2 band = rj.y + vec2(-1.0, 1.0) * (rj.w + rj.z + 0.5 * u_chan_bend + 6.0 * u_px_scale);
    if (rj.x > 0.5) { if (exH.x > exH.y) exH = band; }
    else if (exV.x > exV.y) exV = band;
  }
  for (int i = 0; i < u_routes; i++) {
    vec4 rl = grb_routeLine(i, rid);
    bool vert = rl.x > 0.5;
    float per = vert ? uRes.x : uRes.y, len = vert ? uRes.y : uRes.x;
    float c = rl.y, hw = rl.z;
    vec2 ex = vert ? exV : exH;
    float t = vert ? q.y : q.x;
    float qu = (vert ? q.x : q.y) - c;
    qu -= per * floor(qu / per + 0.5);
    vec4 jg = grb_jog(t, qu, 0.0, len, len, rid, rl.w, u_chan_bend, ex);
    float sg = qu - jg.x;
    float dl = min(abs(sg), jg.y);
    // (Where two channels cross, the down route takes the pixel: its tubes pass over the across route's.)
    bool take = dl - hw < be;
    if (dl - hw < 0.0 && be < 0.0) take = vert;
    if (take) { e2 = be; sec = best; lv2 = lv; be = dl - hw; best = vec4(sg >= 0.0 ? dl : -dl, t, hw, float(i)); lv = jg.z; sArc = vec2(jg.w, sArc.x); }
    else if (dl - hw < e2) { e2 = dl - hw; sec = vec4(sg >= 0.0 ? dl : -dl, t, hw, float(i)); lv2 = jg.z; sArc.y = jg.w; }
  }
  return best;
}

// Bounded iterative descent of the kd-tree: every node's decisions hash only its path id, so each pixel walks the same
// tree. The root is the whole tile (its border is a seam; offset moves it) or one piece of the pinwheel. Each piece, from
// the top down: it may decorate itself first — an outer border, or a strip along one edge — and a pixel there stops in
// that decoration; in what is left the piece may split (across or down, the cut line stepping at 45°: Jogs; at 45°:
// Diagonal cuts; or as a pinwheel), and the pixel carries on into its part. Each piece that decorates or splits stands
// on its parent as a plate of its own (unless seamless): the surface it leaves is the base for what follows. The loop
// count is a uniform, so D3D keeps one copy of the body.
GrbCell grb_panelAt(vec2 q, float dRt) {
  vec2 lo = vec2(0.0), hi = uRes;
  vec2 dlo = vec2(-1e9), dhi = vec2(1e9);
  uint id = pcg(uint(uSeed) + 0x51ED27u);
  if (u_root == 2) {
    // The cell of the 5 × 5 grid (whole-px lines floor(j·size/5 + 0.5)) holding q; per seed a shift by whole cells and
    // a mirror image; its piece, unwrapped round q.
    vec2 cw = uRes / 5.0;
    vec2 j = floor(q / cw);
    j -= vec2(lessThan(q, grb_wmLine(j, cw, id)));
    j += vec2(greaterThanEqual(q, grb_wmLine(j + 1.0, cw, id)));
    vec2 sh = floor(vec2(grb_rand(id, 21u), grb_rand(id, 22u)) * 4.999);
    bool fl = grb_rand(id, 23u) < 0.5;
    vec2 c = j + sh;
    if (fl) c.x = -1.0 - c.x;
    vec2 cm = c - 5.0 * floor(c / 5.0);
    int k = GRB_WM_CELL[int(cm.y) * 5 + int(cm.x)];
    vec4 r = GRB_WM_RECT[k];
    vec2 rlo = r.xy + c - cm, rhi = r.zw + c - cm;
    if (rlo.x > c.x) { rlo.x -= 5.0; rhi.x -= 5.0; }
    if (rlo.y > c.y) { rlo.y -= 5.0; rhi.y -= 5.0; }
    if (fl) { float t = rlo.x; rlo.x = -rhi.x; rhi.x = -t; }
    lo = grb_wmLine(rlo - sh, cw, id);
    hi = grb_wmLine(rhi - sh, cw, id);
    id = pcg(id ^ (uint(k) * 0x2C1B3C6Du + 0x297A2D39u));
  }
  // Panel aspect: min and max sizes across (x) and down (y), trading around the set ones.
  float ar = sqrt(clamp(u_aspect, 0.01, 100.0));
  vec2 ak = vec2(1.0 / ar, ar);
  vec2 mn = float(max(u_min_size, 1)) * ak;
  vec2 mx = float(max(u_max_size, 1)) * ak;
  // Seam widths along the left, top and low 45° edges: the tile border's (Tile-edge seam), or a windmill piece's.
  vec4 gap = vec4(u_gap);
  if (u_root != 2 && u_edge_seam < 1.0) gap.xy = vec2(floor(u_gap * u_edge_seam + 0.5));
  // Distances in to the plate from each side (seams taken off): left, right, bottom, top; and the 45° sides (x + y low,
  // high, x − y low, high). How far each side's line jogs off its straight course.
  vec4 dS = vec4(q.x - lo.x - gap.x, hi.x - q.x, q.y - lo.y, hi.y - gap.y - q.y);
  // (A pipe route's channel edge counts as a side of every piece it crosses: dRt, in the first 45° slot.)
  vec4 dG = vec4(dRt, 1e9, 1e9, 1e9);
  vec4 jm = vec4(0.0);
  float dL = min(q.x - lo.x, hi.y - q.y);
  vec2 bk = grb_bevK(false);
  float bkd = grb_bevKD();
  float dLk = min((q.x - lo.x) * bk.x, (hi.y - q.y) * bk.y);
  vec4 rl = vec4(-1e9);   // the root pinwheel's seam lines: x1, x2, y1, y2
  float sg = float(max(u_snap, 1));
  // Clustering: how busy this region is, inherited down the tree and re-drawn (partly) near the top.
  float busy = 0.5;
  int nd = min(u_depth, 24);
  // A 45° cut leaves corner pieces with legs of at least twice the min panel.
  float md = 2.0 * sqrt(mn.x * mn.y);
  // Room a jogging line keeps from its parallel neighbours, so lines never cross.
  float jmar = max(0.4 * min(mn.x, mn.y), 2.0 * u_bevel + u_gap + 2.0);
  // The hierarchy's surface: its value here and the height of the piece it is on (the floor at the root).
  float vb = 0.0, hb = 0.0;
  int levels = max(u_levels, 1);
  float lowest = max(1.0 - u_height_var, u_min_level);
  int kind = 0, side = 0, side2 = -1, sel = 0;
  vec2 ch = vec2(0.0);
  vec3 ov = vec3(0.0);
  uint ovid = 0u;
  vec2 ovt = vec2(0.0);
  vec2 arc = vec2(0.0);   // the length along the channel's line (x), the laid hose's (y): for what runs along them
  // The deepest hose laid on top across the pixel's ancestors (its cut, jog reach, half width, flags: 1 the pixel's side
  // is above / right of it, 2 a horizontal cut; its parent's span along it, its id): how far it reaches into the final
  // box is measured at the end.
  vec4 hr = vec4(0.0);
  vec2 hbb = vec2(0.0);
  uint hid = 0u;
  bool pkz = false;
  float chl = 1.0;
  float dw = 0.0, ls = 1e9;
  // (No break in the loop: done skips the rest — FXC copes better with one plain loop.)
  bool done = false;
  for (int d = 0; d < nd; d++) {
   if (!done) {
    vec4 kk;
    vec4 bb = grb_octBox(lo, hi, dlo, dhi, kk);
    vec2 sz = bb.zw - bb.xy;
    // This piece's plate: the distance in from its nearest sides, the meeting of the two nearest rounded (Corner rounding).
    vec2 mm = grb_min8(dS, dG);
    float dNr = grb_roundMin(mm, u_round);
    vec4 rn = grb_rand4(id, 19u);
    float hN = grb_lift(hb, mix(1.0, lowest, levels > 1 ? floor(rn.y * float(levels)) / float(levels - 1) : 0.0));
    float bN = min(u_bevel, max(0.2 * min(sz.x, sz.y), 0.5));
    bool placed = false;   // its plate is in the surface already
    // Its rise, and a border's step in from the border's inner edge (one profile in the shader).
    // A border's margins, side by side (left, right, bottom, top): Width, varied by Margin variation — some sides flush —
    // so a smaller plate stands anywhere on its piece, not only centred. The distance in to its inside.
    vec4 mr = grb_rand4(id, 72u);
    vec4 insB = max(u_frame_inset * (1.0 + u_frame_var * (2.5 * mr - 1.0)), vec4(0.0)) * step(vec4(0.25 * u_frame_var), mr);
    float mB = min(min(insB.x, insB.y), min(insB.z, insB.w));
    vec4 dSi = dS - insB;
    float dIn = min(min(min(dSi.x, dSi.y), min(dSi.z, dSi.w)), min(min(dG.x, dG.y), min(dG.z, dG.w)) - mB);
    // (By Cut corners, a border's inside has its corners cut at 45° too: a large octagonal raised plate, its chamfered
    // step following the cuts.)
    if (grb_rand(id, 73u) < u_cut_chance) {
      vec2 ilo = bb.xy + insB.xz, ihi = bb.zw - insB.yw;
      float kc = floor(u_cut_size * min(ihi.x - ilo.x, ihi.y - ilo.y) + 0.5);
      if (kc >= 3.0) dIn = min(dIn, -grb_corners(q, ilo, ihi, vec4(kc)));
    }
    // (A border's step takes Borders › Step bevel if set: wide chamfered insets.)
    float bS = u_frame_bevel > 0.0 ? min(u_frame_bevel, max(0.45 * min(sz.x, sz.y) - u_frame_inset, 0.5)) : bN;
    vec2 rN = grb_rise2(vec2(-dNr, -dIn), vec2(bN, bS));

    // ---- a dark pocket (Dark pockets): the piece sinks nearly to the floor over its bevel and stops splitting; its
    // floor is packed with parts (gen).
#ifdef GRB_POCKET
    if (d > 0 && grb_rand(id, 97u) < u_pocket && min(sz.x, sz.y) >= 1.5 * min(mn.x, mn.y)
        && (u_pocket_max <= 0.0 || max(sz.x, sz.y) <= u_pocket_max)) {
      vb += (0.03 - hb) * rN.x;
      hb = 0.03;
      pkz = true;
      done = true;
    }
#endif
    // ---- its decoration (not the tile's own): an outer border, or a strip along one of its long sides — and maybe a
    // second along a short side, round the corner (a pipe run then wraps round the inside).
    if (!done && (d > 0 || u_root == 2)) {
      bool bord = rn.z < u_frame_chance && sqrt(sz.x * sz.y) >= float(u_frame_min)
               && min(sz.x - insB.x - insB.y, sz.y - insB.z - insB.w) >= max(min(mn.x, mn.y), 2.0 * u_bevel + 6.0 * u_px_scale);
      bool longX = sz.x >= sz.y;
      float ew = min(u_edge_width, 0.35 * (longX ? sz.y : sz.x));
      bool edge = !bord && rn.w < u_edge_chance && sqrt(sz.x * sz.y) >= float(u_edge_min) && ew >= 3.0 * u_px_scale;
      if (bord || edge) {
        // A decorated piece always stands as a plate of its own.
        vb += (hN - hb) * rN.x;
        hb = hN;
        placed = true;
        vec4 re = grb_rand4(id, 71u);
        int sk = (longX ? 2 : 0) + (re.x < 0.5 ? 0 : 1);   // the strip's side: bottom / top, or left / right
        int sk2 = edge && re.y < u_edge_two ? (longX ? 0 : 2) + (re.z < 0.5 ? 0 : 1) : -1;
        bool in1 = grb_pick(dS, sk) < ew, in2 = sk2 >= 0 && grb_pick(dS, sk2) < ew;
        if (bord ? dIn < 0.0 : in1 || in2) {
          // (Where two strips meet, the corner is the first's.)
          kind = bord ? 1 : 2;
          dw = bord ? u_frame_inset : ew;
          side = sk;
          side2 = sk2;
          sel = in1 ? 0 : 1;
          done = true;
        } else {
        // What is left: the plate grown in by the border (every side) or the strips (their sides); no seam there.
        vec4 ins = bord ? insB : ew * (vec4(equal(ivec4(sk), ivec4(0, 1, 2, 3))) + vec4(equal(ivec4(sk2), ivec4(0, 1, 2, 3))));
        dS -= ins;
        if (bord) { dG -= mB; dlo += mB * 1.41421356; dhi -= mB * 1.41421356; }
        lo += ins.xz;
        hi -= ins.yw;
        bb.xy += ins.xz;
        bb.zw -= ins.yw;
        sz = bb.zw - bb.xy;
        gap *= vec4(1.0 - step(0.5, ins.xw), vec2(bord ? 0.0 : 1.0));
        if (bord) {
          // The border's step in: raised or recessed centre (Style), taken by the parts or, if none follow, the final plate.
          int fs = u_frame_style == 5 ? int(floor(re.w * 4.999)) : u_frame_style;
          // A raised centre climbs a share of the headroom left (at least a quarter of Inset depth), so plates stack on
          // plates at every level and the stack stays under the top level and twice Inset depth; a recessed one sinks.
          float room2 = GRB_TOP + 2.0 * u_inset_depth - hb;
          ls = fs == 3 ? clamp(0.45 * room2, 0.25 * u_inset_depth, u_inset_depth) : fs == 2 ? -min(u_inset_depth, 0.5 * hb) : 0.0;
          ls = clamp(hb + ls * u_frame_lift, 0.05, GRB_TOP + 2.0 * u_inset_depth * max(u_frame_lift, 1.0)) - hb;
        }
        }
      }
    }
   if (!done) {
    // Extents along x + y and x − y.
    vec2 de = vec2(min(dhi.x, bb.z + bb.w) - max(dlo.x, bb.x + bb.y), min(dhi.y, bb.z - bb.y) - max(dlo.y, bb.x - bb.w));
    bool canX = sz.x >= 2.0 * mn.x - 1e-3;
    bool canY = sz.y >= 2.0 * mn.y - 1e-3;
    bvec2 canD = greaterThanEqual(de, vec2(2.0 * md));
    bool mustX = canX && sz.x > mx.x + 1e-3;
    bool mustY = canY && sz.y > mx.y + 1e-3;
    vec4 dr = grb_rand4(id, 1u), dr2 = grb_rand4(id, 2u);   // split, busyness, 45° cut, pinwheel; cut way, mirror, 45° axis, 45° place
    busy = mix(busy, dr.y, d < 4 ? 0.6 : 0.15);
    // (Capped below 1 unless Split chance is: busy zones still stop some panels early, not all at Min panel.)
    float ps = clamp(u_split + (busy - 0.5) * 3.0 * u_cluster, 0.0, max(u_split, 0.85));
    // Split, if it can, and must or by chance; else this is the final plate.
    if (!(canX || canY || any(canD)) || (!mustX && !mustY && dr.x >= ps)) done = true;
   if (!done) {
    // Seam width of this split's cuts: narrower the deeper (Seam taper), no wider than Seam limit of the piece.
    float sw = grb_seamW(float(d));
    if (u_seam_max > 0.0) sw = min(sw, max(floor(u_seam_max * min(sz.x, sz.y) + 0.5), min(u_gap, 1.0)));
    bool diag = any(canD) && dr.z < u_diag && !(d == 0 && u_root == 1);
    // A pinwheel: two cuts each way, four panels round a centre one (needs room for three panels each way).
    bool pin = !diag && (dr.w < u_pinwheel || (d == 0 && u_root == 1)) && sz.x >= 3.0 * mn.x - 1e-3 && sz.y >= 3.0 * mn.y - 1e-3;
    // The Pinwheel layout's root keeps its centre panel within the middle 30–70 % each way, so none of its seams spans
    // more than 70 % of the tile.
    bool rootPin = pin && d == 0 && u_root == 1;
    // The cuts: c1 (x and y at once), and a pinwheel's second pair c2 within c1..the far side — one loop, so the cut
    // helpers exist once in the shader.
    vec4 rt = grb_rand4(id, 3u);
    vec2 c1 = vec2(-1.0), c2 = vec2(-1.0);
    for (int k = 0; k < (pin ? 2 : 1) * UNI_1; k++) {
      bool sec = k == 1;
      vec2 e0 = rootPin ? lo + (sec ? 0.55 : 0.3) * sz - mn : sec ? c1 : bb.xy;
      vec2 e1 = rootPin ? lo + (sec ? 0.7 : 0.45) * sz + mn : bb.zw - (pin && !sec ? mn : vec2(0.0));
      vec2 c = grb_cutPos(e0, e1, 0.5 + ((sec ? rt.zw : pin ? rt.xy : rt.xx) - 0.5) * u_split_var, mn);
      if (rl.x > -1e8) c = grb_offLines(c, rl, e0 + mn, e1 - mn, sg);
      if (sec) c2 = c; else c1 = c;
    }
    float cx = c1.x, cy = c1.y;
    if (pin) {
      // No room for the pinwheel: cut in two instead.
      pin = cx >= 0.0 && cy >= 0.0 && all(greaterThanEqual(c2 - c1, mn - 1e-3));
      if (pin && rootPin) rl = vec4(cx, c2.x, cy, c2.y);
    }
    vec2 nlo = lo, nhi = hi, ndlo = dlo, ndhi = dhi;
    uint ck;
    if (diag) {
      // A 45° cut along x + y (or x − y: by chance, or where only that has room), at least md in from either end; its
      // seam lies above it.
      bool ax = canD.x && (!canD.y || dr2.z < 0.5);
      float e0 = ax ? max(dlo.x, bb.x + bb.y) : max(dlo.y, bb.x - bb.w);
      float e1 = e0 + (ax ? de.x : de.y);
      float c = mix(e0 + md, e1 - md, 0.5 + (dr2.w - 0.5) * u_split_var);
      c = clamp(floor(c / sg + 0.5) * sg, ceil(e0 + md), floor(e1 - md));
      float s = ((ax ? q.x + q.y : q.x - q.y) - c) * 0.70710678;
      bool upper = s >= 0.0;
      if (ax) { if (upper) ndlo.x = c; else ndhi.x = c; }
      else { if (upper) ndlo.y = c; else ndhi.y = c; }
      if (upper) { if (ax) gap.z = sw; else gap.w = sw; dL = min(dL, s); if (bevelAspectOn()) dLk = min(dLk, s * bkd); }
      dG = mix(dG, vec4(upper ? s - sw : -s), vec4(equal(ivec4(ax ? 0 : 2) + ivec4(upper ? 0 : 1), ivec4(0, 1, 2, 3))));
      ck = upper ? 0x2545F491u : 0x9E3779B1u;
    } else if (pin) {
      float x2 = c2.x, y2 = c2.y;
      // Children 0..3 wind round the centre (4); the mirror image swaps the sense of the winding.
      bool mir = dr2.y < 0.5;
      float xa = mir ? x2 : cx;   // where the bottom and top arms change over
      int ch = q.y < cy ? (q.x < (mir ? cx : x2) ? (mir ? 1 : 0) : (mir ? 0 : 1))
             : q.y < y2 ? (q.x < cx ? (mir ? 1 : 3) : q.x < x2 ? 4 : (mir ? 3 : 1))
             : (q.x < xa ? (mir ? 2 : 3) : (mir ? 3 : 2));
      vec4 r = ch == 4 ? vec4(cx, cy, x2, y2)
             : !mir ? (ch == 0 ? vec4(lo.x, lo.y, x2, cy) : ch == 1 ? vec4(x2, lo.y, hi.x, y2) : ch == 2 ? vec4(cx, y2, hi.x, hi.y) : vec4(lo.x, cy, cx, hi.y))
                    : (ch == 0 ? vec4(cx, lo.y, hi.x, cy) : ch == 1 ? vec4(lo.x, lo.y, cx, y2) : ch == 2 ? vec4(lo.x, y2, x2, hi.y) : vec4(x2, cy, hi.x, hi.y));
      // Its new edges (straight): the seams along the left and top.
      bvec4 nw = bvec4(r.x != lo.x, r.z != hi.x, r.y != lo.y, r.w != hi.y);
      vec4 nd4 = vec4(q.x - r.x - sw, r.z - q.x, q.y - r.y, r.w - sw - q.y);
      dS = mix(dS, nd4, vec4(nw));
      jm *= 1.0 - vec4(nw);
      if (nw.x) { gap.x = sw; dL = min(dL, q.x - r.x); if (bevelAspectOn()) dLk = min(dLk, (q.x - r.x) * bk.x); }
      if (nw.w) { gap.y = sw; dL = min(dL, r.w - q.y); if (bevelAspectOn()) dLk = min(dLk, (r.w - q.y) * bk.y); }
      nlo = r.xy;
      nhi = r.zw;
      ck = 0x1000193u * uint(ch + 1) + 0x7F4A7C15u;
    } else {
      bool cutY;   // true: a horizontal cut line (splits the height into rows)
      if (!canX) cutY = true;
      else if (!canY) cutY = false;
      else if (mustX != mustY) cutY = mustY;
      else {
        vec2 sa = sz / ak;   // the longer side in the aspect's terms
        float pref = sa.y > sa.x * 1.1 ? 0.8 : (sa.x > sa.y * 1.1 ? 0.2 : 0.5);
        cutY = dr2.x < clamp(pref + u_bias, 0.0, 1.0);
      }
      float c = cutY ? cy : cx;
      // (Below a root pinwheel, a cut dropped for lying on its seams goes the other way if it can.)
      if (c < 0.0 && rl.x > -1e8 && (cutY ? canX && cx >= 0.0 : canY && cy >= 0.0)) { cutY = !cutY; c = cutY ? cy : cx; }
      if (c < 0.0) done = true;
      else {
      // The cut line steps at 45° (Jogs) as far as its parallel sides' own steps leave room for: measured to its 45°
      // stretches as segments, so the corners stay crisp. Its seam lies right of it (x) or below it (y: GL y up).
      int a0i = cutY ? 2 : 0;   // the low side across the cut (bottom or left); a0i + 1 the high one
      float lo1 = cutY ? bb.y : bb.x, hi1 = cutY ? bb.w : bb.z;
      // A pipe channel: a cut in the top Levels may sink into a channel carrying a pipe run (Pipe channels), if the parts
      // keep half the min panel beside it.
      float hw = 0.5 * u_chan_width * (1.0 - u_chan_var * rt.z);
      bool chn = d < u_chan_levels && rt.w < u_chan_chance && min(c - lo1, hi1 - c) >= hw + 0.5 * min(mn.x, mn.y);
      // (Or laid on top of the pieces, crossing them: Laid on top. The first such run over the pixel is kept.)
#ifndef GRB_CHAN
      chn = false;
#endif
      bool surf = chn && grb_rand(id, 5u) < u_chan_surface;
      if (surf) chn = false;
      float jA = u_jog * max(min(c - lo1 - grb_pick(jm, a0i), hi1 - c - grb_pick(jm, a0i + 1)) - jmar - (chn ? hw : 0.0), 0.0);
      float qu = (cutY ? q.y : q.x) - c;
#if defined(GRB_JOG) || defined(GRB_CHAN)
      vec4 jg = jA >= 1.0 ? grb_jog(cutY ? q.x : q.y, qu, cutY ? bb.x : bb.y, cutY ? bb.z : bb.w, cutY ? uRes.x : uRes.y, id, jA, chn || surf ? u_chan_bend : 0.0, vec2(1.0, 0.0)) : vec4(0.0, 1e9, 1.0, cutY ? q.x : q.y);
#else
      vec4 jg = vec4(0.0, 1e9, 1.0, cutY ? q.x : q.y);
#endif
      float s = qu - jg.x;
      float dl = min(abs(s), jg.y);
      bool upper = s >= 0.0;
      bool seam = !chn && cutY != upper;
      if (surf && dl < hw && ov.z == 0.0) {
        ov = vec3(upper ? dl : -dl, cutY ? q.x : q.y, 2.0 * hw);
        chl = jg.z;
        ovid = id;
        ovt = cutY ? bb.xz : bb.yw;
        arc.y = jg.w;
      }
      if (surf) {
        hr = vec4(c, jA, hw, (upper ? 1.0 : 0.0) + (cutY ? 2.0 : 0.0));
        hbb = cutY ? bb.xz : bb.yw;
        hid = id;
      }
      if (chn && dl < hw) {
        // In the channel: across it from its middle, along it.
        kind = 3;
        dw = 2.0 * hw;
        ch = vec2(upper ? dl : -dl, cutY ? q.x : q.y);
        chl = jg.z;
        ovt = cutY ? bb.xz : bb.yw;   // its ends
        arc.x = jg.w;
        done = true;
      } else {
      if (chn) dl -= hw;
      if (cutY) { if (upper) nlo.y = c; else nhi.y = c; }
      else { if (upper) nlo.x = c; else nhi.x = c; }
      if (seam) { if (cutY) gap.y = sw; else gap.x = sw; dL = min(dL, dl); if (bevelAspectOn()) dLk = min(dLk, dl * (cutY ? bk.y : bk.x)); }
      // The child's new side: its low side if it is above / right of the cut, else its high side.
      int ns = a0i + (upper ? 0 : 1);
      vec4 m = vec4(equal(ivec4(ns), ivec4(0, 1, 2, 3)));
      dS = mix(dS, vec4(seam ? dl - sw : dl), m);
      jm = mix(jm, vec4(jA), m);
      ck = upper ? 0x68E31DA4u : 0xB5297A4Du;
      }
      }
    }
   if (!done) {
    // The piece that split, on its parent: unless seamless (or placed by its decoration), its rise carries the surface
    // to its height; a border's step in follows.
    if (!placed && d > 0 && rn.x >= u_seamless) {
      vb += (hN - hb) * rN.x;
      hb = hN;
    }
    if (ls < 1e8) {
      vb += ls * rN.y;
      hb += ls;
      ls = 1e9;
    }
    lo = nlo;
    hi = nhi;
    dlo = ndlo;
    dhi = ndhi;
    id = pcg(id ^ ck);
   }
   }
   }
   }
  }
  // The hose's reach into the final box, on the side facing it: its jog offset at the box's middle, which moves at most
  // 1 px per px along (45° stretches), so within half the box's length of it (and within the jog's reach).
  vec4 hm = vec4(0.0);
#ifdef GRB_CHAN
  if (hr.z > 0.0) {
    bool hY = hr.w >= 2.0, hU = mod(hr.w, 2.0) >= 1.0;
    float t0 = hY ? lo.x : lo.y, t1 = hY ? hi.x : hi.y, hL = 0.5 * (t1 - t0);
    float off = hr.y >= 1.0 ? grb_jogOff(t0 + hL, hbb.x, hbb.y, hY ? uRes.x : uRes.y, hid, hr.y, u_chan_bend) : 0.0;
    float e = hr.z + 1.0;
    float r = hU ? hr.x + min(off + hL, hr.y) + e - (hY ? lo.y : lo.x) : (hY ? hi.y : hi.x) - (hr.x + max(off - hL, -hr.y) - e);
    hm = max(r, 0.0) * vec4(equal(ivec4((hY ? 2 : 0) + (hU ? 0 : 1)), ivec4(0, 1, 2, 3)));
  }
#endif
  return GrbCell(lo, hi, dlo, dhi, id, gap, dS, dG, dL, vb, hb, kind, dw, side, side2, sel, ls, dLk, ch, ov, ovid, ovt, pkz, chl, jm, hm, arc);
}


// Plate outlines, anticlockwise: each corner as x + 4 y, indices into the panel's stops (0, x1, x2, 1 across and down) —
// box, L, T, Z (step), cross, U (notch). GRB_SH_MAIN: per outline two candidate parts (x0, y0, x1, y1 as stop indices),
// the larger of which carries the frame, rivets and details.
const int GRB_SH_OFF[7] = int[7](0, 4, 10, 18, 26, 38, 46);
const int GRB_SH_V[46] = int[46](
  0, 3, 15, 12,
  0, 3, 7, 5, 13, 12,
  1, 2, 6, 7, 15, 12, 4, 5,
  1, 3, 11, 10, 14, 12, 4, 5,
  1, 2, 6, 7, 11, 10, 14, 13, 9, 8, 4, 5,
  0, 3, 15, 14, 6, 5, 13, 12);
const ivec4 GRB_SH_MAIN[12] = ivec4[12](
  ivec4(0, 0, 3, 3), ivec4(0, 0, 3, 3), ivec4(0, 0, 1, 3), ivec4(0, 0, 3, 1), ivec4(0, 1, 3, 3), ivec4(0, 1, 3, 3),
  ivec4(0, 1, 2, 3), ivec4(1, 0, 3, 2), ivec4(0, 1, 3, 2), ivec4(1, 0, 2, 3), ivec4(0, 0, 3, 1), ivec4(0, 0, 3, 1));

// A stop point of the outline in px: unit coordinates u (turned: tf.x swaps the axes, tf.y / tf.z mirror x / y) over
// the panel lo..hi, whole px from lo (1 lands on hi).
vec2 grb_stop(vec2 u, bvec3 tf, vec2 lo, vec2 hi) {
  if (tf.x) u = u.yx;
  if (tf.y) u.x = 1.0 - u.x;
  if (tf.z) u.y = 1.0 - u.y;
  return mix(lo + floor(u * (hi - lo) + 0.5), hi, step(0.9995, u));
}


// One polygon edge a → b for the distance (d2: nearest squared) and the even-odd inside test (s).
void grb_edge(vec2 p, vec2 a, vec2 b, inout float d2, inout float s) {
  vec2 e = b - a, w = p - a;
  vec2 c = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
  d2 = min(d2, dot(c, c));
  bvec3 k = bvec3(p.y >= a.y, p.y < b.y, e.x * w.y > e.y * w.x);
  if (all(k) || all(not(k))) s = -s;
}

// Beams: each Direction's first direction (0 rising, 1 falling, 2 horizontal, 3 vertical) and how many follow it; each
// direction's normal.
const ivec2 GRB_BEAM_DIR[5] = ivec2[5](ivec2(0, 2), ivec2(0, 1), ivec2(1, 1), ivec2(2, 2), ivec2(0, 4));
const vec2 GRB_BEAM_N[4] = vec2[4](vec2(1.0, -1.0), vec2(1.0), vec2(0.0, 1.0), vec2(1.0, 0.0));

// Rivet centre distance from a panel edge: the near-edge margin is whole px, so rivets mirror exactly.
float grb_rivetM(float ins, float D) { return max(floor(ins - 0.5 * D + 0.5), 0.0) + 0.5 * D; }

GenOut gen(vec2 p) {
  vec2 shift = floor(vec2(u_offset_x, -u_offset_y) * uRes + 0.5);
  vec2 q = p - shift;
  if (uTile) q = fmod2(q, uRes);
  // A pipe route's channel takes the pixel whatever the panels; its edge is a side of the pieces it crosses.
  float rte2 = 1e9;
  float rteL = 1.0, rteL2 = 1.0;
  vec2 rteA = vec2(0.0);
  vec4 rteS = vec4(1e9, 0.0, 0.0, -1.0);
#ifdef GRB_CHAN
  vec4 rte = u_routes > 0 ? grb_route(q, rte2, rteL, rteS, rteL2, rteA) : vec4(1e9, 0.0, 0.0, -1.0);
#else
  vec4 rte = vec4(1e9, 0.0, 0.0, -1.0);
#endif
  float dRt = abs(rte.x) - rte.z;
  // (The pieces' side: the nearer edge of any route, so a second route's edge doesn't leave a ghost plate line.)
  GrbCell cell = grb_panelAt(q, min(dRt, rte2));
  uint chId = cell.id;
  if (dRt < 0.0) {
    cell.kind = 3;
    cell.ch = rte.xy;
    cell.chl = rteL;
    cell.dw = 2.0 * rte.z;
    cell.ovt = vec2(0.0);   // (a route runs on round the tile: no ends)
    cell.arc.x = rteA.x;
    chId = grb_routeTubeId(rte.w);
  }
  uint id = cell.id;
  float rnd = grb_rand(id, 7u);
  // Where the pixel stopped: on a final plate, or in a piece's border or edge strip (deco: that piece's plate, with its
  // decoration). The distances in from the cell's two nearest sides.
  bool deco = cell.kind != 0;
  vec2 cm = grb_min8(cell.dS, cell.dG);
  float cA = cm.x, cA2 = cm.y;

  // Panel: the cell's box from its cuts as straight lines, less the seams along its left, top (GL: high y) and low 45°
  // edges (pb; pk: its corner cuts where 45° cuts bound it) — for sizes, shapes and details. The plate itself is measured
  // from the cell's true, jogging edges: dCell, its corners rounded by Corner rounding.
  const float R2 = 1.41421356;
  vec2 clo = vec2(cell.lo.x + cell.gap.x, cell.lo.y), chi = vec2(cell.hi.x, cell.hi.y - cell.gap.y);
  vec4 pk;
  vec4 pb = grb_octBox(clo, chi, cell.dlo + cell.gap.zw * R2, cell.dhi, pk);
  bool diagCell = any(greaterThan(pk, vec4(0.5)));
  vec2 plo = pb.xy, phi = pb.zw;
  vec2 psz = max(phi - plo, vec2(0.0));
  // The box inside a 45°-cut cell: less half the corner cuts on each side (what sizes are measured on). The frame, rivets
  // and details go in it less the jogs' reach.
  vec2 ilo0 = plo + 0.5 * vec2(max(pk.x, pk.z), max(pk.x, pk.y)), ihi0 = phi - 0.5 * vec2(max(pk.y, pk.w), max(pk.z, pk.w));
  vec2 isz = max(ihi0 - ilo0, vec2(0.0));
  float side = min(isz.x, isz.y);
  float area = sqrt(isz.x * isz.y);   // what the Min panel gates compare
  // The final plate's randoms, packed: empty / shaped, shape kind, turn (3), fill plate's level, level, rivets, rivet mode.
  // (A plate's keys: 7 its random; 50–53 these; 60, 61 a plain plate's corner cuts, 160+ / 180+ a shaped one's per corner
  // (up to 12); 71–73 a border, 75 a strip's pipe run, 90–99 details; 140 a rivet's, by its place.)
  vec4 lr = grb_rand4(id, 50u), lr2 = grb_rand4(id, 51u);
  float rnd0 = lr.x;
  bool none = !deco && rnd0 < u_empty;   // an empty panel: only its backing shows
  float rc0 = u_round;
  float dCell = -grb_roundMin(cm, rc0);

  // ---- the plate's outline: the panel, or (Shaped panels) an L, T, Z, cross or U inside it; outside corners cut at 45°
  // by chance (Cut corners), inside ones filled at 45° (Inside corners). One polygon, measured in one loop.
  // Shaped arms are at least a quarter of the panel's short side: that must leave room for two bevels and some top.
  int shp = 0;
  if (!none && !deco && !cell.pk && !diagCell && (rnd0 - u_empty) / max(1.0 - u_empty, 1e-3) < u_shape_chance && area >= float(u_shape_min)
      && 0.25 * side >= max(2.0 * u_bevel + 3.0, 5.0))
    shp = u_shape_kind == 5 ? 1 + int(floor(lr.y * 4.999)) : 1 + u_shape_kind;
  vec4 r4 = grb_rand4(id, 52u);
  vec4 xs = vec4(0.0, 0.5, 0.5, 1.0), ys = xs;
  if (shp == 1) { xs.y = mix(0.35, 0.6, r4.x); ys.y = mix(0.35, 0.6, r4.y); }
  else if (shp == 2) {
    float a = mix(0.3, 0.5, r4.x), c = mix(0.5 * a + 0.12, 0.88 - 0.5 * a, r4.z);
    xs.yz = vec2(c - 0.5 * a, c + 0.5 * a);
    ys.y = 1.0 - mix(0.35, 0.6, r4.y);
  } else if (shp == 3) {
    vec2 a = mix(vec2(0.6), vec2(0.75), r4.xy);
    xs.yz = vec2(1.0 - a.x, a.x);
    ys.yz = vec2(1.0 - a.y, a.y);
  } else if (shp == 4) {
    vec2 a = mix(vec2(0.3), vec2(0.5), r4.xy), c = mix(vec2(0.4), vec2(0.6), r4.zw);
    xs.yz = c.x + vec2(-0.5, 0.5) * a.x;
    ys.yz = c.y + vec2(-0.5, 0.5) * a.y;
  } else if (shp == 5) {
    xs.yz = vec2(mix(0.25, 0.4, r4.x), 1.0 - mix(0.25, 0.4, r4.z));
    ys.y = mix(0.35, 0.55, r4.y);
  }
  bvec3 tf = lessThan(vec3(lr.zw, lr2.x), vec3(0.5));
  if (shp == 0) tf = bvec3(false);
  float ori = (tf.x != tf.y) != tf.z ? -1.0 : 1.0;   // mirrored once or thrice: clockwise
  // Corner rounding: the outline is built that much smaller and grown back, rounding every outside corner.
  float rr0 = clamp(u_round, 0.0, max(0.5 * side - 0.5, 0.0));
  vec2 olo = plo + rr0, ohi = phi - rr0;
  int s0 = GRB_SH_OFF[shp], nv = GRB_SH_OFF[shp + 1] - s0;
  float pd2 = 1e8, ps = 1.0, kmax = 0.0;
  // (A wedge needs room past its seam for its bevels to meet in a ridge at least.)
  float kWedge = ceil(1.4143 * max(max(cell.gap.x, cell.gap.y), max(cell.gap.z, cell.gap.w)) + 1.5 * min(u_bevel, 0.2 * side) + 2.0);
  // A plain panel: its corners cut by chance (legs by quadrant: bit 0 right, bit 1 top), unless the cell has 45° sides
  // of its own.
  vec4 kq = vec4(0.0);
  if (shp == 0 && !diagCell && !deco) {
    vec4 rc = grb_rand4(id, 60u), rs = grb_rand4(id, 61u);
    kq = min(floor(u_cut_size * side * (1.0 - u_cut_var * rs) + 0.5), vec4(floor(0.5 * side))) * (1.0 - step(vec4(u_cut_chance), rc));
    kq *= step(vec4(u_fill == 2 ? kWedge : 2.0), kq);
    kmax = max(max(kq.x, kq.y), max(kq.z, kq.w));
  }
  vec2 w1 = vec2(0.0), w2 = vec2(0.0), A1 = vec2(0.0), B1 = vec2(0.0);
  // Bevel aspect (greebleCommon) on the panels and seams: the shaped plate's outline in the stretched space (bk) — each
  // edge moved out by Corner rounding, an arc (two chords) round each turn of an outside corner, the moved edges meeting
  // at inside ones; cEnd: where the last corner left off.
  bool bevP = bevelAspectOn() && (u_output == 1 || u_output == 2);
  vec2 bk = grb_bevK(false), qk = q * bk, cEnd = vec2(0.0);
  float bkd = grb_bevKD();
  float pd2k = 1e18;
  // A shaped plate: a sliding window over its corners — corner j comes in, corner j - 1 gets its legs, the edges of corner
  // j - 2 are measured.
  for (int j = -2; j <= 12 * UNI_1; j++) {
    if (shp > 0 && j <= nv) {
      int code = GRB_SH_V[s0 + int(uint(j + nv) % uint(nv))];
      vec2 w3 = grb_stop(vec2(grb_pick(xs, code & 3), grb_pick(ys, code >> 2)), tf, olo, ohi);
      if (j >= 0) {
        vec2 ein = w2 - w1, eout = w3 - w2;
        float lin = length(ein), lout = length(eout), S = min(lin, lout);
        float cr = (ein.x * eout.y - ein.y * eout.x) * ori;
        uint vi = uint(j - 1 + nv) % uint(nv);
        float k = cr > 0.0
          ? (grb_rand(id, 160u + vi) < u_cut_chance ? u_cut_size * S * (1.0 - u_cut_var * grb_rand(id, 180u + vi)) : 0.0)
          : cr < 0.0 ? u_fillet * S : 0.0;
        k = min(floor(k + 0.5), floor(0.5 * S));
        // (Too short to read as a cut — or, with Fill › Plates, to leave a wedge past the seam.)
        if (k < (u_fill == 2 && cr > 0.0 ? kWedge : 2.0)) k = 0.0;
        if (cr > 0.0) kmax = max(kmax, k);
        vec2 A2 = w2 - k * ein / max(lin, 1e-3), B2 = w2 + k * eout / max(lout, 1e-3);
        if (j >= 1) {
          grb_edge(q, A1, B1, pd2, ps);
          grb_edge(q, B1, A2, pd2, ps);
        }
        if (bevP) {
          vec2 ui = ein / max(lin, 1e-3), uo = eout / max(lout, 1e-3);
          vec2 uc = k > 0.0 ? normalize(B2 - A2) : normalize(ui + uo + vec2(1e-6));   // the cut's direction (or half way)
          vec2 ni = ori * vec2(ui.y, -ui.x), no = ori * vec2(uo.y, -uo.x), nc = ori * vec2(uc.y, -uc.x);   // outward
          vec2 cc[6];
          if (cr > 0.0) {
            cc = vec2[6](A2 + rr0 * ni, A2 + rr0 * normalize(ni + nc), A2 + rr0 * nc, B2 + rr0 * nc, B2 + rr0 * normalize(nc + no), B2 + rr0 * no);
          } else {
            vec2 xa = k > 0.0 ? A2 + rr0 * (ni + nc) / max(1.0 + dot(ni, nc), 1e-3) : w2 + rr0 * (ni + no) / max(1.0 + dot(ni, no), 1e-3);
            vec2 xb = k > 0.0 ? B2 + rr0 * (nc + no) / max(1.0 + dot(nc, no), 1e-3) : xa;
            cc = vec2[6](xa, xa, xa, xb, xb, xb);
          }
          if (j >= 1) {
            float e2 = bevelSeg2(qk, cEnd * bk, cc[0] * bk);
            for (int i = 0; i < 5; i++) e2 = min(e2, bevelSeg2(qk, cc[i] * bk, cc[i + 1] * bk));
            pd2k = min(pd2k, e2);
          }
          cEnd = cc[5];
        }
        A1 = A2;
        B1 = B2;
      }
      w1 = w2;
      w2 = w3;
    }
  }
  // The plate: the cell, with its corner cuts or as its shape (both cut by the cell's jogging edges).
  float dPoly = none ? 1e4 : max(dCell, shp > 0 ? ps * sqrt(pd2) - rr0 : grb_corners(q, pb.xy, pb.zw, kq));
  if (shp > 0) kq = vec4(kmax);
  float dP = dPoly;
  // An empty panel: the plates are the neighbours, beyond the cell's edges.
  if (none) dP = max(cA, 0.5);
  // In the seam, the neighbouring panel starts at the seam line.
  if (dP > 0.0) dP = min(dP, max(cell.dL, 0.0));

  int levels = max(u_levels, 1);
  float lvl = levels > 1 ? floor(lr2.z * float(levels)) / float(levels - 1) : 0.0;
  // The plateau: evenly spaced levels from the top (GRB_TOP) down to the lowest (Height variation, held up by Lowest
  // level), domed (Bulge) by a smooth pillow that is 0 at the panel's edges and 1 at its centre — in proportion to the
  // plateau's height, so a dished low panel stays above the floor.
  float lowest = max(1.0 - u_height_var, u_min_level);
  // The pillow rises over the outer part of each half-width (Bulge spread: 0.3 of it, a cushion with a flat top, … all
  // of it, a full dome).
  vec2 pu = clamp((q - 0.5 * (plo + phi)) / max(0.5 * psz, vec2(1e-3)), -1.0, 1.0);
  float bw = mix(0.3, 1.0, u_bulge_spread);
  vec2 cg = 1.0 - min((1.0 - abs(pu)) / bw, 1.0);
  vec2 pw = 1.0 - cg * cg;
  // (A decoration's pixel is on its piece's plate, in the surface already; a final plate inside a border takes the
  // border's step.)
  float P = deco || cell.pk ? cell.hb : cell.ls < 1e8 ? cell.hb + cell.ls : grb_lift(cell.hb, mix(1.0, lowest, lvl)) * (1.0 + u_bulge / GRB_TOP * pw.x * pw.y);
  // A panel's bevel is at most a fifth of its shorter side (of a shaped plate's arms; 0.4 of the box inside a 45°-cut
  // cell, whose corners reach past it), so the small panels of busy zones keep flat tops.
  float bev = min(u_bevel, max((shp > 0 ? 0.06 : diagCell ? 0.4 : 0.2) * side, 0.5));
  // The plate stands on the surface the pieces above it leave (cell.vb, at height cell.hb: the floor unless they draw).
  // Where it leaves the panel (cut corners, shapes, empty panels): that surface, a lower backing plate, or plates of
  // their own a seam away from it (at their own level), which then count as plates for the shape outputs. (Their rises
  // are taken after the frame, with the plate's: one bevel profile in the shader, not two.)
  float dPl = dP;
  float dFill = max(dCell, max(cell.gap.x, cell.gap.y) - dPoly);
  float lf = levels > 1 ? floor(lr2.y * float(levels)) / float(levels - 1) : 0.0;
  if (u_fill == 2) dP = min(dP, dFill);
  float v = 0.0;   // what the frame adds; the plate joins it after

  // A shaped plate's frame, rivets and details go on its larger part.
  if (shp > 0) {
    // (Compared in unit space, scaled by the panel turned with the outline.)
    ivec4 m1 = GRB_SH_MAIN[2 * shp], m2 = GRB_SH_MAIN[2 * shp + 1];
    vec4 u1 = vec4(grb_pick(xs, m1.x), grb_pick(ys, m1.y), grb_pick(xs, m1.z), grb_pick(ys, m1.w));
    vec4 u2 = vec4(grb_pick(xs, m2.x), grb_pick(ys, m2.y), grb_pick(xs, m2.z), grb_pick(ys, m2.w));
    vec2 tz = tf.x ? psz.yx : psz;
    vec2 e1 = (u1.zw - u1.xy) * tz, e2 = (u2.zw - u2.xy) * tz;
    vec4 um = e2.x * e2.y > e1.x * e1.y ? u2 : u1;
    vec2 ma = grb_stop(um.xy, tf, plo, phi), mb = grb_stop(um.zw, tf, plo, phi);
    plo = min(ma, mb);
    phi = max(ma, mb);
    psz = phi - plo;
    side = min(psz.x, psz.y);
    area = sqrt(psz.x * psz.y);
  }
  else if (cell.kind == 2) {
    // An edge strip: its rect along the piece's side (the second strip leaves the corner to the first), clear of how far
    // the side steps.
    int sk = cell.sel == 0 ? cell.side : cell.side2, so = cell.sel == 0 ? cell.side2 : cell.side;
    vec4 sr = pb;
    float ew = cell.dw;
    if (sk == 0) sr.z = sr.x + ew; else if (sk == 1) sr.x = sr.z - ew; else if (sk == 2) sr.w = sr.y + ew; else sr.y = sr.w - ew;
    if (cell.sel == 1) { if (so == 0) sr.x += ew; else if (so == 1) sr.z -= ew; else if (so == 2) sr.y += ew; else sr.w -= ew; }
    float jr = max(max(cell.jm4.x, cell.jm4.y), max(cell.jm4.z, cell.jm4.w));   // (how far its sides step)
    vec2 jr2 = min(vec2(jr) * (sk < 2 ? vec2(1.0, 0.0) : vec2(0.0, 1.0)), 0.25 * (sr.zw - sr.xy));
    plo = sr.xy + jr2;
    phi = sr.zw - jr2;
    psz = max(phi - plo, vec2(0.0));
    side = min(psz.x, psz.y);
    area = sqrt(psz.x * psz.y);
  }
  else if (cell.kind == 0) {
    // (A dark pocket takes its whole box: its floor already follows the stepping sides.)
    // (Each side kept clear of how far its own line wanders — jm4: left, right, bottom, top — not the widest wander of
    // any: a module whose sides run straight keeps its whole area for its detail.)
    vec2 jl = min(cell.jm4.xz, 0.25 * isz), jh = min(cell.jm4.yw, 0.25 * isz);
    // (A dark pocket's parts are masked to its walls, so it takes its whole bounding box, corner cuts and all, grown by
    // how far its sides step out — its floor follows the stepping sides, not the straight box.)
    plo = cell.pk ? pb.xy - cell.jm4.xz : ilo0 + jl;
    phi = cell.pk ? pb.zw + cell.jm4.yw : ihi0 - jh;
    // (Clear of the hoses laid across it: its rivets and details shift off their path rather than vanish under them.)
    if (!cell.pk) { plo = max(plo, cell.lo + cell.hm.xz); phi = max(min(phi, cell.hi - cell.hm.yw), plo);
                    side = min(side, min(phi.x - plo.x, phi.y - plo.y)); area = min(area, sqrt((phi.x - plo.x) * (phi.y - plo.y))); }
    psz = phi - plo;
  }
  vec2 pcen = 0.5 * (plo + phi), phb = 0.5 * psz;
  float dSunk = 1e4;   // everything sunk into the plate (the Plate tops shape leaves it out)

  // ---- a border (the pixel stopped in a piece's border band): a groove or ridge line down its middle, or rivets
  // along it; a raised or recessed centre is the step in, taken by what is inside.
  float dF = 1e4;
  float keep = 0.0;   // the details stay this far inside the panel: clear of its rivets
  int fs = -1;
  if (cell.kind == 1) {
    fs = u_frame_style == 5 ? int(floor(grb_rand4(id, 71u).w * 4.999)) : u_frame_style;
    float dB = -dCell;   // in from the piece's edge
    dF = fs <= 1 ? abs(dB - 0.5 * cell.dw) - 0.5 * u_frame_width : dB - cell.dw;
    if (fs <= 1) v += (fs == 1 ? 1.0 : -1.0) * u_inset_depth * grb_cov(dF);
    if (fs == 0) dSunk = dF;
  }

  // (A final plate inside a border takes Borders › Step bevel for its step, if set.)
  float bevStep = cell.ls < 1e8 && u_frame_bevel > 0.0 ? min(u_frame_bevel, max(0.45 * side, 0.5)) : bev;
  vec2 r3 = grb_rise2(vec2(dPl, u_fill == 2 ? dFill : dCell), vec2(bevStep, bev));
  v += cell.vb + (P - cell.hb) * (u_fill == 1 ? max(r3.x, u_backing * r3.y) : r3.x);
  if (u_fill == 2) v += (grb_lift(cell.hb, mix(1.0, lowest, lf)) - cell.hb) * r3.y;

  // ---- a pipe channel (the pixel stopped in one): the surface falls over the walls to a dark floor (Floor); its tubes
  // are drawn with a run laid on top, after the details (below).
  float dChan = 1e4, dTube = 1e4;
  // The bundle under the pixel, if any: across from its middle, along, half width, id, the height it stands on, the
  // plate height its tubes measure against.
  bool bOn = false;
  float bU0 = 0.0, bT0 = 0.0, bHw0 = 1.0, bBase = 0.0, bTop = 0.0, bS0 = 0.0;   // (bS0: length along the line)
  uint bId0 = 0u;
#ifdef GRB_CHAN
  if (cell.kind == 3) {
    float hw = 0.5 * cell.dw, cu = cell.ch.x;
    // (The floor and the tubes' heights from the top plate level, not the panel under the channel — else its edges and
    // steps show through the floor and the bundle.)
    float top = GRB_TOP, fl = u_chan_floor * top;
    float ww = max(1.0, min(u_bevel, 0.35 * hw));
    // (Where a second route's channel crosses, its interior is floor too: the walls open.)
    float wf = (abs(cu) - hw + ww) / ww;
    if (dRt < 0.0 && rte2 < 0.0) wf = min(wf, (abs(rteS.x) - rteS.z + ww) / ww);
    v = mix(fl, max(cell.vb, fl), smoothstep(0.0, 1.0, wf));
    dChan = abs(cu) - hw;
    dP = -dChan;   // no plate in the channel
    bOn = true;
    bU0 = cu;
    bT0 = cell.ch.y;
    bS0 = cell.arc.x;
    bHw0 = hw - ww;
    bId0 = chId;
    bBase = fl;
    // (Measured against the plates beside the channel — a raised inset's step too — so a lifted pipe stands proud.)
    bTop = max(top, GRB_TOP + (u_frame_chance > 0.0 ? u_inset_depth * min(u_frame_lift, 1.5) * 0.5 : 0.0));
  } else if (cell.ov.z > 0.0) {
    // Laid on top: resting on the top plates, crossing whatever is lower.
    bOn = true;
    bU0 = cell.ov.x;
    bT0 = cell.ov.y;
    bS0 = cell.arc.y;
    bHw0 = 0.5 * cell.ov.z;
    bId0 = cell.ovid;
    bBase = GRB_TOP;
    bTop = GRB_TOP + 2.0 * u_inset_depth;
  }
#endif

  // ---- rivets: two rows (or columns) at least a rivet's width apart; an axis too short for that gets one line down
  // its middle (a strap), a panel short both ways none.
  float dR = 1e4;
  float rr = u_rivet_radius;
  // (A riveted border: one row along the middle of its band, round the piece's box.)
  bool rb = cell.kind == 1 && fs == 4;
  if (rb) { plo = pb.xy; phi = pb.zw; psz = phi - plo; pcen = 0.5 * (plo + phi); phb = 0.5 * psz; side = min(psz.x, psz.y); rr = min(rr, max(0.5 * cell.dw - 1.0, 0.5)); }
  if (rb || (!deco && !none && u_rivets > 0 && lr2.w < u_rivet_chance && area >= float(u_rivet_min))) {
    float D = 2.0 * rr;
    // (Far enough in that the whole head — a sunk kind's counterbore — stays on this module: a bolt crossing its edge is
    // cut off where the neighbour or an edge strip is drawn. Mixed: mostly sunk.)
    float m = rb ? grb_snapC(0.5 * cell.dw, D) : max(grb_rivetM(u_rivet_inset, D), grb_fastenerReach(u_rivet_style == 8 ? 2 : u_rivet_style, rr) + 1.5);
    vec2 a = plo + m, b = phi - m;   // rectangle of rivet centres
    bvec2 thin = lessThan(b - a, vec2(2.0 * D));
    int rm = rb ? 2 : u_rivets == 4 ? 1 + int(floor(grb_rand4(id, 53u).x * 2.999)) : u_rivets;   // 1 corners, 2 edges, 3 long sides
    if (!(thin.x && thin.y) && side >= D + 2.0) {
      keep = max(keep, ceil(m + rr) + 1.0);
      vec2 mid = vec2(grb_snapC(0.5 * (plo.x + phi.x), D), grb_snapC(0.5 * (plo.y + phi.y), D));
      if (thin.x) { a.x = mid.x; b.x = mid.x; }
      if (thin.y) { a.y = mid.y; b.y = mid.y; }
      // The nearest rivet centre: a corner, or the nearest along the rows (top / bottom edges) or columns (left / right).
      vec2 near = vec2(q.x < 0.5 * (a.x + b.x) ? a.x : b.x, q.y < 0.5 * (a.y + b.y) ? a.y : b.y);
      vec2 rc = near;
      if (rm != 1) {
        vec2 span = b - a;
        vec2 n = max(floor(span / max(u_rivet_spacing, 1.0) + 0.5), vec2(1.0));
        vec2 st = span / n;
        vec2 k = clamp(floor((q - a) / max(st, vec2(1e-3)) + 0.5), vec2(0.0), n);
        vec2 rowC = vec2(grb_snapC(a.x + k.x * st.x, D), near.y);
        vec2 colC = vec2(near.x, grb_snapC(a.y + k.y * st.y, D));
        bool useRow = rm == 3 ? psz.x >= psz.y : length(q - rowC) <= length(q - colC);
        rc = useRow ? rowC : colC;
      }
      // (None in a cut corner: its quadrant's chamfer, and the rivet within it plus a rivet's width.)
      vec2 rp = rc - pcen;
      float kr = grb_pick(kq, (rp.x >= 0.0 ? 1 : 0) + (rp.y >= 0.0 ? 2 : 0));
      vec2 dcr = phb - abs(rp);
      if (kr <= 0.0 || dcr.x + dcr.y >= kr + 1.5 * (rr + 1.0)) {
        // Its head (greebleCommon: FASTENER_HEADS), at its own turn; the sunk kinds in a counterbore. (Its randoms by its
        // place on the panel, which a wrapped piece keeps on either side of the tile's edge.)
        vec4 rsr = grb_rand4(id ^ pcg2(uvec2(ivec2(floor(rc - plo)))), 140u);
        int rst = u_rivet_style == 8 ? (rsr.x < 0.65 ? 2 : rsr.x < 0.85 ? 0 : 4) : u_rivet_style;
        vec3 fz = grb_fastener(rst, rot2(rsr.z * 1.0472) * (q - rc), rr, 0.6);
        v += u_rivet_height * fz.x;
        dR = fz.z;   // (the head's footprint: a hexagon, or a sunk kind's counterbore)
      }
    }
  }

  // ---- details: one per chosen panel, or two side by side (Paired details), each a vent grille, light, recess,
  // perforation, ribs or a pipe / handle in an area of Size (± Size variation) centred, against an edge or in a corner of
  // the free part of the panel (inside its frame line, rivets and cut corners, and a bevel and 2 px of plate in
  // from its edge). Big panels may get a hero part instead (Hero parts), small ones a small part (Small parts).
  float dD = 1e4, dL = 1e4;
  // A pipe run's tubes, from a detail or an edge strip: offset across the bundle, run spacing, runs, tube radius; whether
  // the pixel is along the run; its flanges' distance.
  vec4 tp = vec4(0.0, 1.0, 1.0, 1.0);
  bool tOn = false;
  float tM = 1e4;
  float dHole = 1e4;   // through-holes (slots, perforation): left out of every plate shape
  // Bevel aspect: the detail (dD, or the lens dL for Lights) as a rounded box — centre, half size, radius, in the swapped
  // frame (tSw) or not — and the tubes' normal on screen and the flanges' stretched distance.
  vec2 tC = vec2(1e4), tH = vec2(0.0), tN = vec2(0.0, 1.0);
  float tRad = 0.0, tMk = 1e4;
  bool tSw = false;
  int kinds = grb_kinds();
  // An edge strip holds a pipe run (Edge strips › Pipe runs: below) or one detail filling it.
  bool strip = cell.kind == 2;
  // (Packed: strip pipe, detail, small part, hero; size, anchor, side x, side y; edge axis, pair, pair cut.)
  vec4 da = grb_rand4(id, 90u), db = grb_rand4(id, 91u), dc = grb_rand4(id, 92u);
  bool sPipe = strip && u_det_pipes && da.x < u_edge_pipes;
  bool big = strip || area >= float(u_det_min);
  bool hasDet = strip ? !sPipe && (kinds & ~64) != 0 : !deco && !none && kinds != 0 && da.y < u_detail_chance;
  bool smallP = !deco && !none && !big && u_detail_chance > 0.0 && da.z < u_small_parts;
  bool hero = !deco && big && hasDet && area >= 1.6 * float(u_det_min) && da.w < u_hero && (kinds & GRB_K_HERO) != 0;
  // A dark pocket (the descent sank the piece): its floor packed with chips and their pins (mostly), heatsink fins or
  // a mesh, whatever else it would have had.
  float rpk = grb_rand(id, 96u);
  bool pkt = cell.pk && !deco && !none;
  if (pkt) { hasDet = true; hero = false; smallP = false; big = true; }
  if ((hasDet && big) || smallP) {
    // (Clear of the cut corners: a centred box misses a 45° cut of k when its margins across and along add up to k, so
    // the margin goes along the longer side, where there is room, rather than half of it on every side.)
    float m0 = min(ceil(bev) + 2.0, floor(0.25 * side));
    vec2 kk = vec2(max(keep, m0));
    if (kmax > 0.0) { float kl = max(kk.x, ceil(kmax) + 2.0 - kk.x); kk = psz.y > psz.x ? vec2(kk.x, kl) : vec2(kl, kk.x); }
    vec2 flo = plo + kk, fhi = phi - kk;
    vec2 fsz = max(fhi - flo, vec2(0.0));
    // A hardware module (Hardware share, rolled here, before the area is sized): the hardware fills nearly all of the
    // free area, centred, unpaired — a switch bank or socket sized to its module, not a speck on it.
    bool hwMod = !hero && !strip && !pkt && !smallP && grb_rand(id, 98u) < u_hw_share && (kinds & GRB_K_HW) != 0;
#ifndef GRB_HW
    hwMod = false;
#endif
    float sz = pkt ? 1.0 : hero ? 0.9 : strip ? 0.96 : hwMod ? 0.95 : u_det_size * (1.0 - u_det_var * db.x);
    vec2 asz = min(psz - 2.0 * floor(psz * (1.0 - sz) * 0.5 + 0.5), fsz);
    // Placement: 0 centred, 1 against a random edge, 2 in a random corner.
    int an = hero || strip || pkt || hwMod ? 0 : u_det_anchor == 3 ? int(floor(db.y * 2.999)) : u_det_anchor;
    vec2 slack = fsz - asz;
    vec2 sd = step(0.5, db.zw);   // which side, per axis
    bool ax = dc.x < 0.5;         // an edge across x (else y)
    vec2 pos = an == 0 ? vec2(0.5) : an == 2 ? sd : (ax ? vec2(sd.x, 0.5) : vec2(0.5, sd.y));
    vec2 rlo = flo + floor(slack * pos), rhi = rlo + asz;
    uint pid = id;
    // Scattered: the free area in cells about Scatter cell across, some holding a small detail at a size and spot of
    // their own (rolled per cell), the rest plain plate.
    bool scat = !smallP && !hero && !strip && !pkt && !hwMod && u_det_scatter > 0.0 && max(fsz.x, fsz.y) >= 2.0 * u_det_cell;
    if (scat) {
      vec2 nc = max(floor(fsz / u_det_cell + 0.3), vec2(1.0)), cs = fsz / nc;
      vec2 ci = clamp(floor((q - flo) / cs), vec2(0.0), nc - 1.0);
      pid = pcg(id ^ (uint(ci.x) * 0x9E3779B9u + uint(ci.y) * 0x85EBCA6Bu + 0x5BD1E995u));
      vec4 sr = grb_rand4(pid, 97u), sr2 = grb_rand4(pid, 99u);
      // (Long thin parts more often than squares: a slot bank or a dot row along the cell's longer way.)
      vec2 fr = sr2.x < 0.5 ? vec2(mix(0.55, 0.9, sr.y), mix(0.3, 0.55, sr.z)) : vec2(mix(0.3, 0.55, sr.z), mix(0.55, 0.9, sr.y));
      vec2 csz = max(floor((cs - 4.0) * fr), vec2(0.0));
      rlo = flo + floor(ci * cs + 2.0 + (cs - 4.0 - csz) * sr2.yz);
      rhi = sr.x < u_det_scatter ? rlo + csz : rlo;
      // (A part a 45° corner — the panel's own cut or its cell's — would clip is left out whole, as is a sliver.)
      vec4 kc = max(pk, kq);
      float km = ceil(bev) + 3.0;
      for (int i = 0; i < 4 * UNI_1; i++) {
        bvec2 hiC = bvec2((i & 1) == 1, (i & 2) == 2);
        vec2 dc4 = abs(mix(rlo, rhi, vec2(hiC)) - mix(pb.xy, pb.zw, vec2(hiC)));
        if (dc4.x + dc4.y < grb_pick(kc, i) + 1.5 * km) rhi = rlo;
      }
      if (min(csz.x, csz.y) < 8.0 * u_px_scale) rhi = rlo;
      // (Nor where a side's jogs could reach it: the free area caps their wander at a quarter of the panel, a part must
      // clear all of it.)
      vec2 ulo = ilo0 + cell.jm4.xz + 2.0, uhi = ihi0 - cell.jm4.yw - 2.0;
      if (any(lessThan(rlo, ulo)) || any(greaterThan(rhi, uhi))) rhi = rlo;
    }
    // Paired: split along the longer side, a gap between, the pixel's part decides.
    bool lx = asz.x >= asz.y;
    float L = lx ? asz.x : asz.y;
    if (!smallP && !hero && !strip && !pkt && !hwMod && !scat && dc.y < u_det_pair && L >= 12.0 * u_px_scale) {
      float g = max(2.0, floor(0.06 * L + 0.5));
      float cut = floor(L * mix(0.3, 0.5, dc.z) + 0.5);
      bool second = (lx ? q.x - rlo.x : q.y - rlo.y) >= cut + 0.5 * g;
      if (lx) { if (second) rlo.x += cut + g; else rhi.x = rlo.x + cut; }
      else { if (second) rlo.y += cut + g; else rhi.y = rlo.y + cut; }
      pid = pcg(id ^ (second ? 0x3C6EF372u : 0xA54FF53Au));
    }
    vec2 rs = rhi - rlo;
    if (all(greaterThanEqual(rs, vec2(smallP ? 2.0 : 3.0)))) {
      // Only the kinds that are switched on and fit the area (av, below), so a panel that gets a detail never stays blank.
      // Heroes: a recessed grille or perforation, a light panel, a pipe run, a fan, a mesh, a circuit pocket, fins.
      bool horiz = rs.x >= rs.y;
      vec2 sl0 = horiz ? rs : rs.yx;   // the area, long side first
      float wall = u_recess_wall > 0.0 ? u_recess_wall : bev;
      // (Packed: bay, kind pick, pipe or handle, elbow side; runs, light style, light edge.)
      vec4 pa = grb_rand4(pid, 93u), pb2 = grb_rand4(pid, 94u);
      bool bayRoll = !smallP && (hero || pa.x < u_det_bay);
      float pitch = max(u_vent_pitch, 2.0);
      float sw = clamp(u_vent_slot, 1.0, pitch - 1.0);
      vec2 nb = floor((sl0 - (bayRoll ? 2.0 * (ceil(wall) + 1.0) : 0.0) + pitch - sw) / pitch);   // in a bay if it gets one
      vec2 nrb = floor((sl0 + pitch - sw) / pitch);
      float tr = max(1.0, floor(0.5 * max(u_pipe_size * sl0.y, u_pipe_min) + 0.5));
      float fw = max(1.0, floor(0.4 * tr + 0.5));
      // The kinds that fit the area (bit k: kind k), of those switched on — 5, a small part's bolt, always fits:
      // 0 vents (three bars; a small part one slot), 1 a light (a 3 px lens), 2 a recess, 3 perforation (3 × 3 holes),
      // 4 ribs (three bars), 6 a pipe or handle (a tube of Min tube with its flanges, at least 4 diameters long: else it
      // reads as a letter); hardware: 7 a row of switches (smaller, a lever is a speck), 8 a plug socket, 9 a slider (a
      // long area), 10 a keypad, 11 a fan (a squarish one); 12 a sunk mesh grille, 13 a dark circuit pocket with chips, 14
      // heatsink fins across the area.
      float pxs = u_px_scale;
      int av = (kinds | 32) & (int(smallP ? sl0.y >= 4.0 * pxs : nb.y >= 3.0) | int(sl0.y >= 3.0 * pxs + 2.0 * u_light_rim) << 1 | 4
               | int(min(nb.x, nb.y) >= 3.0) << 3 | int(nrb.y >= 3.0) << 4 | 32
               | int(!strip && 2.0 * (tr + fw) <= sl0.y && sl0.x >= max(2.0 * tr + 16.0 * pxs, 8.0 * tr)) << 6
               | int(min(sl0.x, sl0.y) >= 14.0 * pxs) << 7 | int(sl0.y >= 6.0 * pxs && sl0.x >= 1.25 * sl0.y) << 8
               | int(sl0.y >= 5.0 * pxs && sl0.x >= 2.0 * sl0.y) << 9 | int(sl0.y >= 9.0 * pxs) << 10
               | int(sl0.y >= 12.0 * pxs && sl0.x <= 1.7 * sl0.y) << 11 | int(min(sl0.x, sl0.y) >= 8.0 * pxs) << 12
               | int(min(sl0.x, sl0.y) >= 10.0 * pxs) << 13 | int(sl0.x >= 8.0 * pxs && sl0.y >= 4.0 * pxs) << 14);
#ifndef GRB_HW
      av &= ~GRB_K_HW;
#endif
      // How many fit as a hero part, hardware, a panel's detail, a small part.
      ivec4 nk = ivec4(0);
      for (int i = 0; i < 15 * UNI_1; i++) nk += (ivec4(av & GRB_K_HERO, av & GRB_K_HW, av & GRB_K_PANEL, av & GRB_K_SMALL) >> i) & 1;
      bool hr = hero && nk.x > 0;
      int nf = smallP ? nk.w : hr ? nk.x : nk.z;
      int kind = -1, cnt = 0;
      // Hardware (switches, sockets, sliders, keypads, fans: the last in the list) takes Hardware share of the picks when
      // any fits.
      int nhw = nk.y;
      int nO = nf - nhw;
      bool useHw = !smallP && !hr && nhw > 0 && (nO == 0 || hwMod);
      int pick = useHw ? nO + int(floor(pa.y * float(nhw))) : int(floor(pa.y * float(max(nO, 1))));
      if (smallP || hr) pick = int(floor(pa.y * float(nf)));
      // The pick-th of the kinds that fit, in GRB_KORDER's order for a panel, a hero or a small part.
      int mode = smallP ? 2 : hr ? 1 : 0;
      for (int i = 0; i < 14 * UNI_1; i++) {
        int k = GRB_KORDER[mode * 14 + i];
        if (k >= 0 && ((av >> k) & 1) == 1) { if (cnt == pick) kind = k; cnt++; }
      }
      // A dark pocket: chips (mostly), fins or a mesh, deep.
      if (pkt) kind = rpk < 0.8 ? 13 : 14;
      bool slots = kind == 0 || kind == 3 || kind == 4;
      float hd = 2.0 * u_inset_depth;   // hardware's height
      // A recess, or the bay a recessed grille sits in: walls sloping over Recess wall (or the Edge bevel). It sinks at
      // most half of what stands under it, so a recess in a recessed centre stays a pocket, not a hole.
      bool bay = (kind == 0 || kind == 3) && bayRoll;
      if (kind == 2 || bay) {
        dD = grb_box(q, rlo, rhi);
        tC = 0.5 * (rlo + rhi); tH = 0.5 * (rhi - rlo); tRad = 0.0; tSw = false;
        dSunk = min(dSunk, dD);
        v -= min(u_inset_depth, 0.5 * v) * grb_ramp(dD, wall);
        if (bay) { float w = ceil(wall) + 1.0; rlo += w; rhi -= w; }
      }
      // Work along the area's longer side: x in ql.
      vec2 ql = horiz ? q : q.yx;
      vec2 lo2 = horiz ? rlo : rlo.yx, hi2 = horiz ? rhi : rhi.yx;
      vec2 sl = hi2 - lo2;
      if (slots && all(greaterThanEqual(sl, vec2(smallP ? 2.0 : 3.0)))) {
        // Slots (and ribs) run along the longer side, stacked across the shorter one; holes sit on a grid of the same
        // pitch. All centre their rows in the area and measure to the nearest one.
        vec2 n = smallP ? vec2(1.0) : max(floor((sl + pitch - sw) / pitch), vec2(1.0));
        if (smallP) sw = min(sw, max(sl.y - 2.0, 2.0));
        vec2 o = lo2 + floor((sl - (n * pitch - (pitch - sw))) * 0.5);
        vec2 j = clamp(floor((ql - o - 0.5 * sw) / pitch + 0.5), vec2(0.0), n - 1.0);
        // (Masonry bond: every second row of holes half a pitch along, one fewer, so it stays in the area.)
        bool bond = kind == 3 && u_hole_bond == 1 && mod(j.y, 2.0) > 0.5 && n.x >= 2.0;
        if (bond) j.x = clamp(floor((ql.x - o.x - 0.5 * sw) / pitch), 0.0, n.x - 2.0);
        vec2 s0 = o + j * pitch + (bond ? vec2(0.5 * pitch, 0.0) : vec2(0.0));
        // A perforation needs at least 3 × 3 holes (fewer read as dice), a grille or ribs three bars (fewer read as
        // scratches) — the kind choice above sees to that, but a bay's walls may still take the room.
        if ((kind == 3 && min(n.x, n.y) < 3.0) || (!smallP && kind != 3 && n.y < 3.0)) s0 = vec2(-1e4);
        dD = kind == 3 ? length(ql - s0 - 0.5 * sw) - 0.5 * sw : grb_rbox(ql, vec2(lo2.x, s0.y), vec2(hi2.x, s0.y + sw), 0.5 * sw);
        tC = kind == 3 ? s0 + 0.5 * sw : vec2(0.5 * (lo2.x + hi2.x), s0.y + 0.5 * sw);
        tH = kind == 3 ? vec2(0.5 * sw) : max(vec2(0.5 * (hi2.x - lo2.x), 0.5 * sw), vec2(0.0));
        tRad = 0.5 * sw; tSw = !horiz;
        if (kind == 4) {
          // Ribs: rounded bars standing up from the plate.
          v += 0.8 * u_inset_depth * grb_ramp(dD, 0.5 * sw);
        } else {
          dHole = dD;
          dSunk = min(dSunk, dD);
          // The plate slopes down into each opening over a px or two, a wall rather than a cliff.
          float rim = smallP ? 1.0 : max(1.0, min(bev, 0.4 * (pitch - sw)));
          v *= smoothstep(0.0, 1.0, dD / rim);
        }
      } else if (kind == 5) {
        // A bolt: one dome, as big as the part's area allows (up to 1.5 × the rivet radius).
        float br = max(min(1.5 * u_rivet_radius, 0.5 * min(sl.x, sl.y)), 0.5);
        vec2 c = vec2(grb_snapC(0.5 * (lo2.x + hi2.x), 2.0 * br), grb_snapC(0.5 * (lo2.y + hi2.y), 2.0 * br));
        dD = length(ql - c) - br;
        tC = c; tH = vec2(br); tRad = br; tSw = !horiz;
        v += u_rivet_height * grb_dome(dD + br, br);
      } else if (kind == 6) {
        // Pipes: a bundle of up to Pipe runs parallel tubes along the area that turn through concentric round elbows off
        // one long edge; handles: one straight tube (none under 12 px long, at least 3 px thick). Each tube a true
        // half-round, Pipe size × the area's short side across (at least Min tube: tr, fw above), standing on what is
        // under it (a raised centre too) and butting a flange plate across the bundle at each end. The runs are measured
        // as an offset from the innermost one (along, round the elbow, up the leg), so one evaluation covers the bundle.
        // (A pipe run with its elbow needs 8 diameters along the area; shorter areas get a handle.)
        bool pipe = hero || (pa.z < 0.6 && sl.x >= 16.0 * tr);
        float fl = max(2.0, floor(0.5 * tr + 0.5));              // flange thickness, along the run
        float R = max(2.0 * tr, floor(0.12 * sl.y + 0.5));
        // Room across for the bundle and its elbow and leg: else fewer runs, or a handle.
        float room = sl.y - (fw + 3.0 * tr + R + fl);
        if (room < 0.0) pipe = false;
        if (!pipe) tr = max(tr, 1.5);
        float sp = 2.0 * tr + max(1.0, floor(0.6 * tr + 0.5));   // run spacing
        float nr = pipe ? 1.0 + floor(pb2.x * float(max(u_pipe_runs, 1)) * 0.999) : 1.0;
        nr = clamp(nr, 1.0, max(floor(room / sp) + 1.0, 1.0));
        float band = (nr - 1.0) * sp;
        float sy = pa.w < 0.5 ? 1.0 : -1.0;   // the elbow turns towards +y or -y
        float y0 = floor(pipe ? (sy > 0.0 ? lo2.y + fw + tr + band : hi2.y - fw - tr - band) : 0.5 * (lo2.y + hi2.y)) + 0.5;
        float x0 = lo2.x + fl;
        float xe = pipe ? hi2.x - fw - tr - band - R : hi2.x - fl;
        float y1 = sy > 0.0 ? hi2.y - fl : lo2.y + fl;
        vec2 E = vec2(xe, y0 + sy * R);
        bool fits = xe - x0 >= (pipe ? 2.0 * tr : 12.0) && (!pipe || sy * (y1 - E.y) >= tr);
        float off = sy * (y0 - ql.y);
        bool inRun = ql.x >= x0 && ql.x <= xe;
        tN = vec2(0.0, 1.0);   // across the tubes, along the area
        if (pipe && ql.x > xe) {
          bool leg = sy * (ql.y - E.y) > 0.0;
          off = leg ? ql.x - (xe + R) : length(ql - E) - R;
          inRun = !leg || sy * (y1 - ql.y) >= 0.0;
          tN = leg ? vec2(1.0, 0.0) : ql - E;
        }
        if (!horiz) tN = tN.yx;
        vec2 f1c = vec2(x0 - 0.5 * fl, y0 - sy * 0.5 * band), f1h = vec2(0.5 * fl, 0.5 * band + tr + fw);
        vec2 f2c = pipe ? vec2(xe + R + 0.5 * band, y1 + sy * 0.5 * fl) : vec2(xe + 0.5 * fl, y0);
        vec2 f2h = pipe ? vec2(0.5 * band + tr + fw, 0.5 * fl) : f1h;
        // (Drawn below, with a strip's pipe run: one copy of the tubes in the shader.)
        tp = vec4(off, sp, nr, tr);
        tOn = fits && inRun;
        tM = fits ? min(sdBox(ql - f1c, f1h), sdBox(ql - f2c, f2h)) : 1e4;
        vec2 kl = grb_bevK(!horiz);
        tMk = fits ? min(sdBox((ql - f1c) * kl, f1h * kl), sdBox((ql - f2c) * kl, f2h * kl)) : 1e4;
      } else if (kind == 1) {
        int st = hero ? 3 : u_light_style == 4 ? int(floor(pb2.y * 3.999)) : u_light_style;
        float rel = (st == 1 ? 0.5 : 1.0) * u_light_rel;   // a row's lamps half the size, so a row has several
        float s = max(u_light_size, floor(rel * sl.y + 0.5));
        float rim = u_light_rim;
        bool low = pb2.z < 0.5;   // which long edge a row or strip runs along
        vec2 ls, c;
        if (st == 0) {
          // One lens, centred, its housing inside the area too.
          ls = min(vec2(s * max(u_light_len, 1.0), s), max(sl - 2.0 * rim, vec2(1.0)));
          c = 0.5 * (lo2 + hi2);
        } else if (st == 3) {
          // A light panel filling the area.
          ls = max(sl - 2.0 * rim, vec2(1.0));
          c = 0.5 * (lo2 + hi2);
        } else {
          // A row of round lamps, or one strip, along a long edge.
          ls = st == 1 ? vec2(min(s, sl.y)) : vec2(max(sl.x - 2.0 * rim, 1.0), min(s, sl.y));
          float lp = ls.x + 2.0 * rim + max(1.0, floor(0.5 * ls.x + 0.5));
          float n = st == 1 ? max(floor((sl.x - 2.0 * rim - ls.x) / lp) + 1.0, 1.0) : 1.0;
          float x0 = lo2.x + floor((sl.x - (n - 1.0) * lp - ls.x) * 0.5) + 0.5 * ls.x;
          float jx = clamp(floor((ql.x - x0) / lp + 0.5), 0.0, n - 1.0);
          c = vec2(x0 + jx * lp, low ? lo2.y + rim + 0.5 * ls.y : hi2.y - rim - 0.5 * ls.y);
        }
        // A lens thinner than 3 px reads as a scratch — none.
        if (min(ls.x, ls.y) >= 3.0 * u_px_scale) {
          c = vec2(grb_snapC(c.x, ls.x), grb_snapC(c.y, ls.y));
          float lensR = st == 1 ? 0.5 * ls.x : min(1.0, 0.25 * min(ls.x, ls.y));
          dL = grb_rbox(ql, c - 0.5 * ls, c + 0.5 * ls, lensR);
          dD = dL - rim;   // the housing round the lens
          // (Its Bevel aspect twin: the lens, or the housing — the lens grown by the rim.)
          bool lens = u_output == 6;
          tC = c; tH = 0.5 * ls + (lens ? 0.0 : rim); tRad = lensR + (lens ? 0.0 : rim); tSw = !horiz;
          dSunk = min(dSunk, max(dD, -dL));
          // (Sunk into what is under it, a raised centre too.)
          float vh = v;
          v = mix(v, vh - u_inset_depth, grb_cov(dD));
          float lensH = 0.5 * min(ls.x, ls.y);
          v = mix(v, vh - 0.4 * u_inset_depth + u_light_dome * grb_dome(lensH + dL, lensH), grb_cov(dL));
        }
#ifdef GRB_HW
      } else if (kind == 7) {
        // (Hardware stands proud: twice Inset depth, hd.)
        // A row of switches along the area: toggles (a hex nut, a lever leaning up or down with a ball tip) or rockers
        // (a sunk bezel, a paddle tilted one way).
        bool rock = pb2.w < 0.4;
        // (A bank: 2–5 across, so even a squarish module gets a row, not one lonely switch.)
        float n = clamp(floor(sl.x / max(0.8 * sl.y, 4.0)), 2.0, 5.0);
        float pit = sl.x / n;
        float jx = clamp(floor((ql.x - lo2.x) / pit), 0.0, n - 1.0);
        float u0 = min(pit, sl.y);
        vec2 lp = ql - vec2(lo2.x + (jx + 0.5) * pit, 0.5 * (lo2.y + hi2.y));
        float sg2 = fract(jx * 0.618 + pa.w) < 0.5 ? 1.0 : -1.0;   // which way it is thrown
        // Each on its own pad, a step up from the module, so the bank reads as a row of parts.
        vec2 phb = vec2(0.45 * pit - 0.5, 0.47 * sl.y - 0.5);
        float dPad = grb_rbox(lp, -phb, phb, 0.15 * min(phb.x, phb.y));
        v += 0.15 * hd * smoothstep(0.0, 1.0, -dPad);
        float vh = v;
        if (rock) {
          // A rocker: a bezel round a paddle in two halves — the thrown half high, the other low, a dark split between.
          vec2 hb2 = vec2(0.27, 0.42) * u0;
          float dz = grb_rbox(lp, -hb2, hb2, 0.1 * u0);
          float dpad = dz + max(1.5, 0.12 * u0);
          dD = dz;
          // (A raised bezel, a dark well inside it round the paddle.)
          v = mix(v, vh + 0.35 * hd, grb_cov(dz));
          v = mix(v, vh - 0.6 * hd, grb_cov(dz + max(1.0, 0.06 * u0)));
          float hi = step(0.0, lp.y * sg2);
          float pv = vh + hd * mix(0.2, 0.75, hi) * (1.0 - 0.25 * hi * clamp(abs(lp.y) / hb2.y, 0.0, 1.0));
          v = mix(v, pv - 0.3 * hd * grb_cov(abs(lp.y) - 0.5), smoothstep(0.0, 1.0, -dpad));
        } else {
          // A toggle: a round washer, a hex nut, a lever thrown up or down rising to a ball tip (it leans out of the plate),
          // on some banks a U-guard round each lever.
          float wash = length(lp) - 0.2 * u0;
          float nut = grb_hexagon(lp, 0.13 * u0);
          float lr = max(0.11 * u0, 1.2);
          vec2 tipc = vec2(0.0, 0.44 * u0 * sg2);
          float tl = clamp(lp.y * sg2 / (0.44 * u0), 0.0, 1.0);
          float lev = min(sdSegment(lp, vec2(0.0), tipc) - lr, length(lp - tipc) - 1.5 * lr);
          float gw = max(0.06 * u0, 0.8), gy = 0.47 * u0;
          // (A pilot lamp on the pad behind the lever, on banks without a guard.)
          float lmp = length(lp + vec2(0.0, 0.36 * u0 * sg2)) - max(0.08 * u0, 1.0);
          float grd = pb2.z < 0.5 ? max(min(abs(abs(lp.x) - 0.3 * u0) - gw, abs(lp.y * sg2 - gy) - gw), max(abs(lp.x) - 0.3 * u0 - gw, abs(lp.y * sg2 - 0.5 * gy) - 0.5 * gy - gw)) : 1e4;
          dD = min(min(wash, lev), grd);
          // (In a dark well round the nut, as the panel's toggles are: the lever reads light against it.)
          v = mix(v, vh - 0.9 * hd, grb_cov(wash));
          v = mix(v, vh + 0.3 * hd, smoothstep(0.0, 1.0, -nut / max(0.06 * u0, 0.6)));
          v = max(v, mix(v, vh + 0.6 * hd, grb_cov(grd)));
          if (pb2.z >= 0.5) { v = mix(v, vh - 0.3 * hd, grb_cov(lmp - 1.0)); v = mix(v, vh + 0.35 * hd * grb_dome(max(lmp + max(0.08 * u0, 1.0), 0.0), max(0.08 * u0, 1.0)), grb_cov(lmp)); dD = min(dD, lmp); }
          v = mix(v, vh + hd * (0.55 + 0.55 * tl + 0.25 * grb_dome(max(lev + 1.5 * lr, 0.0), 1.5 * lr)), grb_cov(lev));
        }
      } else if (kind == 8) {
        // A plug socket: a raised rim round a sunk face with pins — a D-shell (narrower at one side, two rows of pins)
        // or a round connector (a ring of pins round a centre one).
        bool roundC = pb2.w < 0.35;
        // A long area holds a bank of 2–4 of them side by side, a small gap between.
        float nbk = clamp(floor(sl.x / ((roundC ? 1.15 : 1.5) * sl.y)), 1.0, 4.0);
        float bankW = sl.x / nbk;
        float jb2 = clamp(floor((ql.x - lo2.x) / bankW), 0.0, nbk - 1.0);
        vec2 lp = ql - vec2(lo2.x + (jb2 + 0.5) * bankW, 0.5 * (lo2.y + hi2.y));
        vec2 hs = max(0.5 * vec2(bankW, sl.y) - vec2(nbk > 1.0 ? 1.5 : 1.0, 1.0), vec2(1.0));
        float R = min(hs.x, hs.y);
        float dout = roundC ? length(lp) - R : max(grb_rbox(lp, -hs, hs, 0.3 * hs.y), abs(lp.x) - hs.x + 0.25 * (hs.y - lp.y));
        float rim = max(1.0, 0.16 * R);
        float vh = v;
        v += 0.45 * hd * grb_cov(dout) - 1.0 * hd * grb_cov(dout + rim);
        float pr = max(0.6, 0.11 * R);
        vec2 pc;
        if (roundC) {
          float an = 6.2832 / 6.0;
          float a0 = floor(atan(lp.y, lp.x) / an + 0.5) * an;
          pc = length(lp) < 0.3 * R ? vec2(0.0) : 0.55 * R * vec2(cos(a0), sin(a0));
        } else {
          float np = clamp(floor(1.4 * hs.x / max(3.0 * pr, 1.0)), 2.0, 9.0), pp = 1.4 * hs.x / np;
          float row = lp.y > 0.0 ? 1.0 : -1.0;
          float off = row > 0.0 ? 0.0 : 0.5 * pp;
          pc = vec2(clamp(floor((lp.x + 0.7 * hs.x - off) / pp + 0.5), 0.0, np - (row > 0.0 ? 0.0 : 1.0)) * pp - 0.7 * hs.x + off, 0.38 * hs.y * row);
        }
        float dpin = length(lp - pc) - pr;
        v += 0.55 * hd * grb_dome(max(dpin + pr, 0.0), pr) * grb_cov(dout + rim);
        dD = dout;
      } else if (kind == 9) {
        // A slider: a slot along the area, tick marks beside it, a ridged knob somewhere on it.
        float cy = 0.5 * (lo2.y + hi2.y);
        float sw2 = max(1.0, 0.16 * sl.y);
        vec2 slo = vec2(lo2.x + 0.06 * sl.x, cy - sw2), shi = vec2(hi2.x - 0.06 * sl.x, cy + sw2);
        float dsl = grb_rbox(ql, slo, shi, sw2);
        float tickP = max(3.0, 0.1 * sl.x);
        float dtk = max(abs(fract((ql.x - slo.x) / tickP + 0.5) - 0.5) * tickP - 0.5, abs(ql.y - (cy + 0.33 * sl.y)) - 0.12 * sl.y);
        vec2 kh = vec2(max(1.5, 0.2 * sl.y), max(2.0, 0.42 * sl.y));
        float kx = mix(slo.x + kh.x, shi.x - kh.x, pa.w);
        float dk = grb_rbox(ql, vec2(kx, cy) - kh, vec2(kx, cy) + kh, 0.5 * kh.x);
        float vh = v;
        v -= 0.8 * hd * grb_cov(dsl) + 0.25 * hd * grb_cov(dtk);
        float grip = 0.08 * smoothstep(0.3, 0.7, abs(fract((ql.y - cy) / max(1.5, 0.3 * kh.y)) - 0.5) * 2.0);
        v = mix(v, vh + hd * (0.7 - grip), grb_cov(dk));
        dD = min(dsl, dk);
      } else if (kind == 10) {
        // A keypad: rounded keys three across, standing in a sunk bezel.
        float kp = sl.y / 3.0;
        float rows = max(floor(sl.x / kp), 1.0);
        vec2 klo = vec2(lo2.x + 0.5 * (sl.x - rows * kp), lo2.y);
        float dbz = grb_box(ql, klo, klo + vec2(rows * kp, sl.y));
        vec2 kc = klo + (clamp(floor((ql - klo) / kp), vec2(0.0), vec2(rows - 1.0, 2.0)) + 0.5) * kp;
        float dk = grb_rbox(ql, kc - 0.36 * kp, kc + 0.36 * kp, 0.12 * kp);
        float vh = v;
        v -= 0.5 * hd * grb_cov(dbz);
        v = mix(v, vh + hd * (0.2 + 0.1 * smoothstep(0.0, 1.0, -dk / max(0.15 * kp, 0.6))), grb_cov(dk));
        dD = dbz;
      } else if (kind == 11) {
        // A fan: a round housing sunk into the plate, a ring round it, curved blades round a domed hub.
        vec2 lp = ql - 0.5 * (lo2 + hi2);
        float R = 0.5 * min(sl.x, sl.y) - 1.0;
        float rho = length(lp);
        float dh = rho - R;
        float bf = fract((atan(lp.y, lp.x) / 6.2832 + 0.2 * rho / R) * 9.0);
        float blade = step(0.3 * R, rho) * step(rho, 0.9 * R) * smoothstep(0.0, 0.08, bf) * (1.0 - smoothstep(0.42, 0.5, bf));
        float rw = max(1.0, 0.07 * R);
        float vh = v;
        v -= 0.9 * hd * grb_cov(dh);
        v += 0.35 * hd * grb_cov(abs(dh + rw) - rw);
        v += 0.8 * hd * blade * (1.0 - 1.4 * bf) * grb_cov(dh);
        // (The hub only at the centre: a max over the whole housing flattened the blades.)
        if (rho < 0.28 * R) v = max(v, vh - 0.2 * hd + 0.8 * hd * grb_dome(rho, 0.26 * R));
        dD = dh;
#endif
      } else if (kind == 12) {
        // A mesh grille: a sunk panel (walls over Recess wall) behind a fine grid of wires.
        float dg = grb_box(ql, lo2, hi2);
        float mp = max(2.0, 0.5 * u_vent_pitch);
        vec2 mf = abs(fract((ql - lo2) / mp) - 0.5) * mp;
        float wire = 1.0 - smoothstep(0.25, 0.75, min(mf.x, mf.y));
        if (pkt) v += u_pocket_part * wire * smoothstep(0.0, 1.0, (cA - 2.0) / max(u_bevel, 1.0));
        else v -= min(u_inset_depth, 0.5 * v) * grb_ramp(dg, wall) * (1.0 - 0.6 * wire);
        dD = dg;
        dSunk = min(dSunk, dg);
      } else if (kind == 13) {
        // A circuit pocket: sunk deep (dark), packed with parts edge to edge on a grid of cells — chips of mixed size
        // (some two cells long) with pin rows along their long sides, round capacitors, pin headers (a row of square
        // pins) — and fine traces between them on the floor. In a dark pocket the parts stand Pocket parts high.
        float dg = grb_box(ql, lo2, hi2);
        float cp = pkt ? clamp(0.14 * min(sl.x, sl.y), 9.0 * u_px_scale, 26.0 * u_px_scale) : max(5.0 * u_px_scale, 0.3 * sl.y);
        // A cable bundle from a header in every dark pocket ≥ 60 × 24 px (laid out here: the chips keep its lane clear).
        // (Measured and placed in the straight box — the grown one reaches past the walls.)
        vec4 cw4 = grb_rand4(pid, 152u);
        vec2 sbl = horiz ? pb.xy : pb.yx, sbh = horiz ? pb.zw : pb.wz, sbs = sbh - sbl;
        bool wOn = pkt && sbs.x >= 60.0 * u_px_scale && sbs.y >= 24.0 * u_px_scale;
#ifndef GRB_POCKET
        wOn = false;
#endif
        float cy = 0.5 * (sbl.y + sbh.y);
        bool atLo = cw4.y < 0.5;
        float cl = max(10.0, 0.14 * sbs.x);
        float x0 = atLo ? sbl.x + 0.12 * sbs.x : sbh.x - 0.12 * sbs.x - cl, x1 = x0 + cl;
        float nw = 2.0 + floor(cw4.z * 2.999);
        float wr = clamp(0.026 * sbs.y, 1.5 * u_px_scale, 3.5 * u_px_scale), wsp = max(4.6 * wr, 6.0 * u_px_scale);   // (grommets 2.2 wr: clear of each other even level)
        // (Ends and their grommets — 2.2 wire radii — clear of the walls along and across: the pocket's sides may step in.)
        float wm = 3.0 * wr + 4.0 + max(u_bevel, 1.0);
        float xs = atLo ? x1 : x0, xe = atLo ? min(sbh.x - 0.1 * sbs.x, sbh.x - wm) : max(sbl.x + 0.1 * sbs.x, sbl.x + wm), dir = atLo ? 1.0 : -1.0;
        float o = (cw4.w < 0.5 ? -1.0 : 1.0) * clamp(0.5 * sbs.y - 0.5 * nw * wsp - wm, 0.0, 0.2 * sbs.y);
        // (The jog far enough from the header that no wire's shifted corner comes before its start.)
        float xj = xs + dir * max(abs(mix(xs, xe, 0.3 + 0.3 * fract(cw4.w * 7.0)) - xs), 0.414 * 0.5 * nw * wsp + 3.0 * wr);
        // (And early enough that every wire's last run — a grommet long — still ends inside the pocket: in a short pocket
        // the bend moves towards the header rather than the ends past the wall.)
        float xjl = xe - dir * (abs(o) + 4.5 * wr + 0.41421356 * 0.5 * (nw - 1.0) * wsp);
        xj = dir > 0.0 ? min(xj, xjl) : max(xj, xjl);
        // (But never so early that a wire's corner comes before the header's face: none leaves it sideways.)
        float xjh = xs + dir * (0.41421356 * 0.5 * (nw - 1.0) * wsp + wr);
        xj = dir > 0.0 ? max(xj, xjh) : min(xj, xjh);
        // The bundle's lane, as its middle line and half width (plus the header).
        float lane = 0.5 * nw * wsp + 2.0 * wr + 2.0;
        vec2 cc = floor((ql - lo2) / cp);
        // A board, not a lattice: one hero chip (3 × 2 or 2 × 2 cells) somewhere in a dark pocket; every other cell along
        // x may join its right neighbour into a long chip; the rest are chips, capacitors, headers or a pair of small
        // surface parts.
        vec2 ncl = max(floor(sl / cp), vec2(1.0));
        vec4 heroR = grb_rand4(pid, 153u);
        vec2 hn = heroR.x < 0.5 ? vec2(3.0, 2.0) : vec2(2.0);
        vec2 hp = floor(heroR.yz * max(ncl - hn + 1.0, vec2(1.0)));
        bool hero2 = pkt && all(greaterThanEqual(ncl, hn + 1.0)) && all(greaterThanEqual(cc, hp)) && all(lessThan(cc, hp + hn));
        vec4 cr0 = grb_rand4(pid ^ uint(floor(cc.x * 0.5) * 17.0 + cc.y * 131.0), 151u);
        bool pair = !hero2 && cr0.x < 0.3;
        vec2 c0 = hero2 ? hp : pair ? vec2(floor(cc.x * 0.5) * 2.0, cc.y) : cc;
        vec2 csz = hero2 ? hn * cp : pair ? vec2(2.0, 1.0) * cp : vec2(cp);
        vec4 cr = grb_rand4(pid ^ uint(c0.x * 17.0 + c0.y * 131.0), 150u);
        vec2 ccen = lo2 + c0 * cp + 0.5 * csz;
        // 0 chip, 1 capacitor, 2 header, 3 none, 4 two small surface parts
        int pt = hero2 || pair ? 0 : cr.z > 0.82 ? 1 : cr.z > 0.7 ? 2 : cr.z < 0.05 ? 3 : cr.z < 0.3 ? 4 : 0;
        if (hero2) cr.xy *= 0.3;
        bool off = pt == 3 || grb_box(ccen, lo2 + 0.5 * csz, hi2 - 0.5 * csz) > 0.0;
        vec2 ch2 = 0.5 * csz - max(1.0, 0.08 * cp) - cp * vec2(0.12, 0.2) * cr.xy;
        float dc2 = pt == 1 ? length(ql - ccen) - 0.38 * cp : grb_rbox(ql, ccen - ch2, ccen + ch2, 0.6);
        // Pin rows along a chip's long sides; a header is a row of square pins.
        float pinp = max(1.6, 0.14 * cp);
        bool px = ch2.x >= ch2.y;
        vec2 lq = px ? ql - ccen : (ql - ccen).yx, lh = px ? ch2 : ch2.yx;
        float pin = max(abs(abs(lq.y) - lh.y - 0.8) - 0.8, abs(fract(lq.x / pinp) - 0.5) * pinp - 0.4);
        pin = max(pin, abs(lq.x) - lh.x + 0.5);
        if (pt == 2) { dc2 = max(abs(lq.y) - 0.25 * cp, abs(fract(lq.x / pinp) - 0.5) * pinp - 0.45); dc2 = max(dc2, abs(lq.x) - lh.x); pin = 1e3; }
        if (pt == 4) {
          // Two small parts, one above the other, each with a pad at both ends.
          vec2 sq = ql - ccen;
          sq.y = abs(sq.y) - 0.25 * cp;
          dc2 = grb_rbox(sq, -vec2(0.32, 0.11) * cp, vec2(0.32, 0.11) * cp, 0.4);
          pin = max(abs(abs(sq.x) - 0.36 * cp) - 0.07 * cp, abs(sq.y) - 0.12 * cp);
        }
        if (off || pt == 1) pin = 1e3;
        // (In a dark pocket, a part that would cross a 45° wall is left out, not cut into a triangle.)
        if (pkt && !off) {
          // (Corners in the screen's axes: the detail runs along its longer side, ql, maybe swapped.)
          vec2 e2c = (pt == 1 ? vec2(0.38 * cp) : ch2) + 1.5;
          float cw = -1e4;
          for (int k = 0; k < 4 * UNI_1; k++) {
            vec2 cq = ccen + e2c * vec2(k == 1 || k == 3 ? 1.0 : -1.0, k >= 2 ? 1.0 : -1.0);
            cw = max(cw, grb_corners(horiz ? cq : cq.yx, pb.xy, pb.zw, pk));
          }
          if (cw > -1.0 - max(u_bevel, 1.0)) off = true;
        }
        // (Chips in the cable lane or under the header are left out: the bundle lies on clear floor.)
        if (wOn && !off) {
          vec2 he = 0.5 * csz;
          float dl = min(min(sdSegment(ccen, vec2(xs, cy), vec2(xj, cy)), sdSegment(ccen, vec2(xj, cy), vec2(xj + dir * abs(o), cy + o))),
                         sdSegment(ccen, vec2(xj + dir * abs(o), cy + o), vec2(xe + dir * 2.0 * wr, cy + o)));
          if (dl < lane + length(he) * 0.8 || grb_box(ccen, vec2(min(x0, x1), cy - lane), vec2(max(x0, x1), cy + lane)) < length(he)) off = true;
        }
        if (off) { dc2 = 1e3; pin = 1e3; }
        // (In a dark pocket: none on its walls.)
        if (pkt) { dc2 = max(dc2, 2.0 + max(u_bevel, 1.0) - cA); pin = max(pin, 2.0 + max(u_bevel, 1.0) - cA); }
        // Traces: thin lines along the cell gaps.
        vec2 gf = abs(fract((ql - lo2) / cp) - 0.5) * cp;
        float tr2 = (0.5 * cp - max(gf.x, gf.y)) - 0.5;
        float vh = v;
        // (A dark pocket's floor is sunk already, by the descent.)
        if (!pkt) v = mix(v, max(vh - 1.2 * u_inset_depth, 0.0), grb_ramp(dg, wall));
        float flr = v;
        float ph = pkt ? u_pocket_part : 0.35 * u_inset_depth;
        v += 0.25 * ph * grb_cov(tr2) * step(1.5, cA);
        // A chip's rim stands a little higher than its face: a dark part with a lit edge under a height-driven ramp.
        float rim = pt == 0 || pt == 4 ? grb_cov(abs(dc2 + 0.9) - 0.9) : 0.0;
        v = mix(v, flr + ph * (pt == 1 ? grb_dome(length(ql - ccen), 0.38 * cp) : pt == 2 ? 1.3 : (hero2 ? 1.3 : 1.0) + 1.0 * rim), grb_cov(dc2));
        v = mix(v, flr + 0.4 * ph, grb_cov(pin) * (1.0 - grb_cov(dc2)));
        // In a dark pocket at least 60 px long: a connector block near one end with 2–4 wires fanning out along the
        // floor, each stepping aside at 45° somewhere along the way.
#ifdef GRB_POCKET
        if (wOn) {
          // The cable bundle: from the header's face, along, a 45° jog (each wire's corners shifted by 0.414 × its offset,
          // so the spacing holds through the bend), along again, each wire ending a little short of the last (a staggered
          // row of ends) where it dives into the floor through a raised grommet. One flat loop over all segments.
          // (Each wire's nose dips by its own end — aE from the wire nearest the pixel, not from the nearest end of any
          // wire, or a wire passing a neighbour's end dips there too. dw1: the wire's own distance, over its 3 segments.)
          float dW = 1e4, dE = 1e4, aE = 1e4, dw1 = 1e4;
          for (int k = 0; k < 12 * UNI_1; k++) {
            float kw2 = floor(float(k) / 3.0), sk = float(k) - 3.0 * kw2;
            if (kw2 < nw) {
              float yo = (kw2 - 0.5 * (nw - 1.0)) * wsp, y0 = cy + yo;
              float xjk = xj - dir * 0.41421356 * sign(o) * yo;
              // (Staggered ends, but never before the wire's own last bend, and its last run at least a grommet long, so
              // the wire meets its grommet head on: no wire doubles back or enters its ring off centre.)
              float xek = xe - dir * kw2 * 1.6 * wsp;
              xek = dir > 0.0 ? max(xek, xjk + abs(o) + 4.5 * wr) : min(xek, xjk - abs(o) - 4.5 * wr);
              vec2 A = sk < 0.5 ? vec2(xs, y0) : sk < 1.5 ? vec2(xjk, y0) : vec2(xjk + dir * abs(o), y0 + o);
              vec2 B2 = sk < 0.5 ? vec2(xjk, y0) : sk < 1.5 ? vec2(xjk + dir * abs(o), y0 + o) : vec2(xek, y0 + o);
              float ds = sdSegment(ql, A, B2) - wr;
              dw1 = sk < 0.5 ? ds : min(dw1, ds);
              if (sk > 1.5) {
                float e = length(ql - B2);
                dE = min(dE, e);
                if (dw1 < dW) { dW = dw1; aE = dir * (B2.x - ql.x); }
              }
            }
          }
          // (Kept off the walls, except the end in its grommet, which is drawn whole like the ring round it.)
          if (dE > 2.2 * wr) dW = max(dW, 2.0 + max(u_bevel, 1.0) - cA);
          // The header: a raised block, a dark gap round its foot, a socket per wire in its face.
          float dCn = grb_rbox(ql, vec2(x0, cy - 0.5 * nw * wsp - 1.5), vec2(x1, cy + 0.5 * nw * wsp + 1.5), 1.0);
          dCn = max(dCn, 2.0 + max(u_bevel, 1.0) - cA);
          v -= 0.4 * ph * grb_cov(abs(dCn - 1.0) - 0.8);
          // Round cables, their noses dipping into the grommets (aE: along, from the end back up the wire).
          // (Its round end whole, only a little lower, in the middle of its grommet: dimmed to the floor past the end it read
          // as a wire cut off halfway through the ring.)
          float nose = smoothstep(-wr, 0.0, aE);
          v = mix(v, flr + 0.6 * ph + 2.4 * ph * grb_dome(max(dW + wr, 0.0), wr) * mix(0.8, 1.0, nose), grb_cov(dW));
          float gr = abs(dE - 1.6 * wr) - 0.55 * wr;   // the grommet ring round each end
          v = max(v, mix(v, flr + 1.1 * ph * grb_dome(abs(dE - 1.6 * wr), 0.6 * wr), grb_cov(gr) * (1.0 - grb_cov(dW + 0.3))));
          // (Stepped: a shell, a raised top 2 px in from its sides; at the face the wires plug into, a dark square socket
          // per wire, cut down to the shell's foot.)
          float dTp = grb_rbox(ql, vec2(x0 + 2.0, cy - 0.5 * nw * wsp + 0.5), vec2(x1 - 2.0, cy + 0.5 * nw * wsp - 0.5), 1.0);
          vec2 sp = vec2(ql.x - (atLo ? x1 - wr - 1.5 : x0 + wr + 1.5), fract((ql.y - cy) / wsp + 0.5 * nw + 0.5) * wsp - 0.5 * wsp);
          float dSo = max(max(abs(sp.x) - wr - 0.5, abs(sp.y) - 0.85 * wr), abs(ql.y - cy) - 0.5 * nw * wsp);
          float hh = flr + 2.2 * ph + 0.9 * ph * smoothstep(0.0, 1.0, -dTp) - 2.4 * ph * grb_cov(dSo);
          v = mix(v, hh, smoothstep(0.0, 1.0, -dCn / 1.5));
        }
#endif
        dD = dg;
        dSunk = min(dSunk, dg);
      } else if (kind == 14) {
        // Heatsink fins: bars across the area, Slot width thick, Slot pitch apart, standing up from the plate.
        float fp = max(u_vent_pitch, 2.0);
        float fw2 = clamp(u_vent_slot, 1.0, fp - 1.0);
        float df = max(abs(fract((ql.x - lo2.x) / fp) - 0.5) * fp - 0.5 * fw2, grb_box(ql, lo2, hi2));
        // (In a dark pocket: the floor sunk deep, the fins standing from it.)
        if (pkt) df = max(df, 2.0 + max(u_bevel, 1.0) - cA);
        v += (pkt ? 2.5 * u_pocket_part : 0.8 * u_inset_depth) * grb_ramp(df, 0.5 * fw2);
        dD = df;
      }
    }
  }

  // ---- a pipe run's tubes (a channel's, or one laid on top): up to Tubes side by side — thick pipes and thin cables
  // (Thick share), the thick ones standing nearly to the plates (in a channel) or highest (on top) — centred or against a
  // side, clamped by bands or ringed by couplings every Clamp spacing, braided by Braid; a run laid on top ends in a collar
  // at each end. Measured across from its middle, so the tubes follow its bends.
  // Pipes are solid: everything they meet joins them (max), nothing cuts into them. vPre: the surface before any pipe
  // run is laid on it — what later tubes stand on, and the only thing contact lines and holes may lower.
  float vPre = v;
#ifdef GRB_CHAN
  // (Where two routes' channels cross, both bundles: pass 0 the down route's, pass 1 the across route's, a little lower
  // so it passes under.)
  bool bOn2 = cell.kind == 3 && dRt < 0.0 && rte2 < 0.0 && rteS.w >= 0.0;
  float cov0 = 0.0;   // the over bundle's tube coverage (the under one stays beneath it)
  for (int pass = 0; pass < 2 * UNI_1; pass++) {
   if (pass == 0 ? bOn : bOn2) {
    bool p2 = pass == 1;
    float bU = p2 ? rteS.x : bU0, bT = p2 ? rteS.y : bT0, bHw = p2 ? rteS.z - (0.5 * cell.dw - bHw0) : bHw0;
    uint bId = p2 ? grb_routeTubeId(rteS.w) : bId0;
    float chlP = p2 ? rteL2 : cell.chl;
    float bS = p2 ? rteA.y : bS0;
    // (In a crossing the over bundle stands clearly higher, the under one dips: no woven look.)
    // (Ramped over about a pipe's width in from the other channel's wall, not a step at it.)
    float rmp = smoothstep(0.0, max(u_tube_big, 3.0), -(p2 ? dRt : rte2));
    float sink = bOn2 ? mix(1.0, p2 ? 0.6 : 1.15, rmp) : 1.0;
    float inner = 2.0 * bHw - 2.0, tot = 0.0;
    // A run laid on top connects the panels at its ends: it plugs into a connector block on each (a raised box across the
    // bundle), through a collar. It rests on the top plates (riding up only over higher ones), so the seams and steps it
    // crosses don't print through. Its hoses lie apart, with gaps.
    bool top2 = cell.kind != 3 && !p2;
    // (The bundle's width first, to place it.)
    for (int i = 0; i < u_tube_count; i++) {
      float dm = grb_tubeDm(bId, i);
      if (tot + dm <= inner) tot += dm + grb_tubeGap(dm, top2);
    }
    vec4 rc = grb_rand4(bId, 119u);
    float x0 = rc.x < 0.6 ? -0.5 * tot : rc.y < 0.5 ? -bHw + 1.0 : bHw - 1.0 - tot;   // centred, or against a side
    int cs = u_clamp_style == 2 ? (rc.z < 0.5 ? 0 : 1) : u_clamp_style;
    float pc = max(u_clamp_space, 1.0);
    // Along, from the nearest clamp: one per Clamp spacing, each shifted a little (not a ladder).
    float ck2 = floor((bT + rc.w * pc) / pc);
    float cph = abs(bT + rc.w * pc - (ck2 + 0.5 + 0.6 * (grb_rand(bId ^ uint(ck2 + 4096.0), 121u) - 0.5)) * pc);
    float cw = clamp(0.3 * bHw, 1.5 * u_px_scale, 6.0 * u_px_scale);
    // (Only on level runs: across a bend or a 45° stretch a band would cut the bundle at a slant.)
    float atC = u_clamp_space > 0.0 ? (1.0 - smoothstep(0.5 * cw - 1.0, 0.5 * cw, cph)) * chlP * (bOn2 ? 0.0 : 1.0) : 0.0;
    // (A channel's bundle ends where its cut does: diving into the channel floor, never cut off square.)
    bool ends = !p2 && cell.ovt.y > cell.ovt.x;
    // (A laid run stops a seam short of its parent's box, which takes in the seam at its far side: nothing of it lies in
    // the seam to be cut off by the next piece.)
    float ce = ends ? min(bT - cell.ovt.x, cell.ovt.y - bT) - (top2 ? u_gap : 0.0) : 1e4;
    float bl = max(4.0, 1.4 * u_tube_big), fe = max(2.0, 0.7 * u_tube_big);
    // How the run ends here (each end its own): diving into the panel below — the tubes' rounded noses going down
    // through a raised grommet — or into the side of a module — a collar on each tube seated in a socket boss.
    bool dive = ends && (!top2 || grb_rand(bId, bT - cell.ovt.x < cell.ovt.y - bT ? 131u : 132u) < 0.55);
    float atE = top2 && !dive ? 1.0 - smoothstep(bl - 1.0, bl, ce) : 0.0;
    float rcap = 0.0, grom = 0.0, hole = 0.0;   // a dive's nose centre (along, from the end); the grommet height
    // (Laid on top: on the top plate level, covering what is under them — the panels' detail doesn't print through.)
    // (One level across the hose — it runs along a cut, the plates either side may differ — at the highest a plate can
    // stand, a raised border's step included, so it lies on top of raised modules rather than under them.)
    float base = top2 ? bBase + (u_frame_chance > 0.0 ? u_inset_depth * min(u_frame_lift, 1.5) * 0.45 : 0.0) : bBase;
    float cov2 = 0.0;   // how much the tubes cover here
    float pos = x0, env = 0.0, mtop = base, used = 0.0, xe = x0;
    for (int i = 0; i < u_tube_count; i++) {
      float dm = grb_tubeDm(bId, i);
      if (used + dm <= inner) {
        used += dm + grb_tubeGap(dm, top2);
        float r = 0.5 * dm;
        float tc = pos + r;
        // (Couplings: a ring a fifth wider on the thick tubes; collars a quarter wider.)
        float rr2 = r * (1.0 + (cs == 1 && dm >= u_tube_big ? 0.2 * atC : 0.0) + 0.3 * atE);
        float x = abs(bU - tc);
        // (Diving: the tube ends in a hemispherical nose rcap from the end, a grommet ring round it.)
        float fall = 1.0;
        if (ce < 0.0) x = 1e4;
        if (dive) {
          // (Far enough in that the grommet ring stays whole on the plate.)
          rcap = max(1.6 * r + 2.0, r + 5.5 * u_px_scale);
          float dEn = length(vec2(x, max(rcap - ce, 0.0)));
          x = ce < rcap ? dEn : x;
          // The tube turns down: its height falls over its last diameter into the hole.
          fall = mix(0.25, 1.0, smoothstep(rcap - 0.2 * r, rcap + 2.0 * r, ce));
          // A thick tube's hole: a dark gap round its end, then a raised lip (thin cables just end, capped).
          if (dm >= u_tube_big) {
            float de = length(vec2(bU - tc, rcap - ce));
            hole = max(hole, (1.0 - smoothstep(r + 1.0, r + 2.0, de)) * step(r - 0.5, de) * step(ce, rcap + r));
            grom = max(grom, grb_dome(abs(de - (r + 3.0)), 1.2) * step(ce, rcap + r + 4.0));
          }
        }
        // Its height in proportion to its radius (round cables, Pipe lift: a thick pipe level with the plates at 1).
        float rk = clamp(rr2 / max(0.5 * u_tube_big, 0.5), 0.15, 1.3) * u_tube_lift;
        float ht = top2 ? base + 2.0 * u_inset_depth * rk : bBase + (bTop - bBase) * 0.97 * rk * sink;
        // Ribs: crisp grooves across the tube every 1.4 radii along its line (bS, the length along the bends), so they
        // ring the hose square to it round every bend and on the 45° stretches.
        float rp = max(1.4 * r, 3.0);
        float rd = abs(fract(bS / rp + 0.5) - 0.5) * rp;
        float br = u_braid * (1.0 - atE) * 0.2 * (1.0 - smoothstep(0.22 * rp - 0.5, 0.22 * rp + 0.5, rd));
        float dmh = grb_dome(x, rr2) * fall;
        // (A collar keeps the tube's round profile, wider; a fine groove rings it halfway along.)
        dmh *= 1.0 - 0.25 * atE * (1.0 - smoothstep(0.4, 1.2, abs(ce - 0.5 * bl)));
        // (Only under the tube itself: no flat bed beside it.)
        env = max(env, (base + (ht - base) * dmh * (1.0 - br)) * step(x, rr2 + 0.5));
        cov2 = max(cov2, 1.0 - smoothstep(rr2 - 0.5, rr2 + 0.5, x));
        mtop = max(mtop, ht);
        dTube = min(dTube, x - rr2);
        xe = pos + dm;
        pos += dm + grb_tubeGap(dm, top2);
      }
    }
    // Clamp bands: a strap just over the bundle, a hair above its tallest tube.
    float onB = 1.0 - smoothstep(0.0, 1.0, max(x0 - 0.5 - bU, bU - xe - 0.5));
    if (cs == 0) env = max(env, (mtop + 0.04 * (bTop - bBase)) * atC * onB * step(top2 ? bl + fe : -1.0, ce));
    // Into a module's side: a socket boss across the bundle's end, the collars seated in it.
    if (top2 && !dive) {
      float dB = max(max(max(x0 - 3.0 - bU, bU - xe - 3.0), ce - 0.7 * bl), -ce);
      env = max(env, mix(0.0, mtop + 0.2 * u_inset_depth, smoothstep(0.0, 1.0, -dB / 1.5)));
      cov2 = max(cov2, 1.0 - smoothstep(-0.5, 0.5, dB));
      dTube = min(dTube, dB);
    }
    // Diving: the grommet rings, low on the plate.
    if (dive) {
      env = max(env, (base + 0.5 * u_inset_depth * grom) * step(0.01, grom));
      cov2 = max(cov2, step(0.01, grom));
    }
    // Laid on top: the tubes replace the surface under them (and a dark contact groove lies between and beside them);
    // in a channel they stand on its floor.
    if (top2) {
      // (A soft contact line 1–2 px beside each tube, a little below the surface — not a trench.)
      // (Both only on the bare plate: never into another solid.)
      float bare = step(v, vPre + 0.001) * step(v, base + 0.01);
      v -= 0.06 * base * (1.0 - smoothstep(0.5, 2.5, dTube)) * (1.0 - cov2) * bare;
      // A diving tube's hole: dark, below the plate, where no tube covers it.
      v = mix(v, min(v, base - 0.35 * u_inset_depth), hole * bare * step(env, base + 0.01));
      v = max(v, env * cov2);
    } else v = max(v, env * (p2 ? 1.0 - cov0 : 1.0));
    if (!p2) cov0 = cov2;
    dD = min(dD, dTube);
   }
  }

  // ---- where two routes cross: a junction box over the crossing, covering both channels and a margin round them (so no
  // stub of either sticks out of it) — a rounded block standing a little above the tubes, drawn over everything.
  // (Its half side: Box size × half the channel width, from the middle of each channel.)
  float jm2 = (u_junction_size - 1.0) * 0.5 * u_chan_width;
  if (u_routes > 1 && u_junction == 0 && max(dRt, rte2) < jm2 + 6.0) {
    float dJ = max(dRt, rte2) - jm2;
    float jtop = grb_lidTop() + 0.1 * u_inset_depth;
    float jb = max(1.0, min(u_bevel + 1.0, 5.0 * u_px_scale));
    // (A flat lid replacing what is under it, just above the tallest tube the settings allow, so none prints through.)
    v = max(v, mix(v, jtop, smoothstep(0.0, 1.0, -dJ / jb)));
    // A screw in each corner of the lid (the shared heads: an Allen bolt), and a fine lid seam inset from its edge.
    // The box's half sides, from the crossing's middle: each channel's own half width (Width variation) and the margin.
    vec2 hsJ = vec2(rte.z, rteS.z) + jm2;
    float sr = clamp(0.1 * min(hsJ.x, hsJ.y), 1.5 * u_px_scale, 5.0 * u_px_scale);
    v -= 0.15 * u_inset_depth * grb_cov(abs(dJ + jb + 1.5) - 0.5) * step(dJ, 0.0);
    if (dJ < -jb && rteS.w >= 0.0) v += 0.4 * u_inset_depth * grb_fastener(1, vec2(rte.x, rteS.x) - sign(vec2(rte.x, rteS.x)) * (hsJ - jb - sr - 1.0), sr, 0.0).x;
    dD = min(dD, dJ);
    if (dJ < 0.0) dP = min(dP, dJ);
  }
#endif

  // ---- a pipe run in an edge strip: up to Pipe runs half-round tubes side by side along the strip, measured in from the
  // piece's side (so they follow its steps); with a second strip they turn its corner in a round elbow, wrapping round the
  // inside. They butt flange plates where the strip meets the piece's other sides.
  if (sPipe) {
    float ew = cell.dw;
    int sk = cell.sel == 0 ? cell.side : cell.side2, so = cell.sel == 0 ? cell.side2 : cell.side;
    float da = grb_pick(cell.dS, cell.side), db = cell.side2 >= 0 ? grb_pick(cell.dS, cell.side2) : 1e9;
    float dI2 = da < ew && db < ew ? ew - length(vec2(ew - da, ew - db)) : min(da, db);   // in from the strips' sides, the corner rounded
    float fw = max(1.0, floor(0.15 * ew + 0.5));
    float use = ew - 2.0 * fw;
    float nr = clamp(1.0 + floor(grb_rand(id, 75u) * float(max(u_pipe_runs, 1)) * 0.999), 1.0, max(floor((use + 1.0) / (2.0 * u_pipe_min + 1.0)), 1.0));
    float tr = max(0.5 * floor((use - (nr - 1.0)) / nr), 0.5);
    float sp = 2.0 * tr + 1.0;
    // Flanges where the strip meets the piece's sides across it (not the corner the run turns).
    ivec2 pp = sk < 2 ? ivec2(2, 3) : ivec2(0, 1);
    float flw = max(2.0, floor(0.5 * ew));
    tp = vec4(dI2 - fw - tr, sp, nr, tr);
    tOn = true;
    tM = min(pp.x == so ? 1e4 : grb_pick(cell.dS, pp.x) - flw, pp.y == so ? 1e4 : grb_pick(cell.dS, pp.y) - flw);
    // (Bevel aspect: across the tubes, the strip's side's normal, or round the corner the radius'; the flanges' sides.)
    vec2 ax1 = cell.side < 2 ? vec2(1.0, 0.0) : vec2(0.0, 1.0), ax2 = cell.side2 < 2 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    tN = da < ew && db < ew ? (ew - da) * ax1 + (ew - db) * ax2 : da <= db ? ax1 : ax2;
    tMk = tM * (sk < 2 ? bk.y : bk.x);
  }
  // The tubes (half-rounds standing on what is under them) butting their flange plates, with a 1 px contact line where
  // a tube meets the plate, so its edge reads.
  if (tOn || tM < 1e3) {
    float kr = clamp(floor(tp.x / tp.y + 0.5), 0.0, tp.z - 1.0);
    float dl = abs(tp.x - kr * tp.y);
    float dT = tOn ? dl - tp.w : 1e4;
    dD = min(dT, tM);
    tMk = min(tOn ? bevelLine(dT, tN) : 1e4, tMk);
    tC = vec2(-1e5);   // (the tubes: tMk)
    // (They stand on the surface under the pipe runs, and join whatever is there; the contact line only on bare plate.)
    float vh = min(v, vPre);
    v -= 0.3 * u_inset_depth * grb_cov(abs(dT - 0.5) - 0.5) * grb_cov(-tM) * step(v, vPre + 0.001);
    // (Thicker tubes stand taller, so they read round.)
    v = max(v, max(mix(v, vh + u_inset_depth * clamp(tp.w / 2.5, 1.0, 2.5) * grb_dome(dl, tp.w), grb_cov(dT)), mix(v, vh + 0.6 * u_inset_depth, grb_cov(tM))));
  }

  // ---- beams: long straps across everything, along lines that wrap round the tile (45° lines repeat every gcd of the
  // sides), or segments of up to the tile's short side (measured to the nearest copy). They follow the relief under
  // them: added on top (or, at a negative height, sunk in).
  float dBm = 1e4, bPerp = 0.0, bW = 1.0, bAl = -1e9;
  vec2 bNk = vec2(0.0, 1.0);   // (Bevel aspect: the nearest beam's normal and distance past its ends)
#ifdef GRB_BEAMS
  if (u_beams > 0) {
    float g = float(igcd(int(uRes.x + 0.5), int(uRes.y + 0.5)));   // the period of 45° lines that tile
    float nb = float(u_beams);
    for (int i = 0; i < u_beams; i++) {
      uint b = pcg(uint(uSeed) * 0x2C1B3C6Du + uint(i) * 0x85EBCA6Bu + 0x5BD1E995u);
      // The direction, 0 rising, 1 falling, 2 horizontal, 3 vertical: Direction gives the first and how many to pick from.
      ivec2 dr = GRB_BEAM_DIR[u_beam_dir];
      int dir = dr.x + int(grb_rand(b, 1u) * (float(dr.y) - 0.001));
      vec2 n = GRB_BEAM_N[dir];
      float sc = 1.0 / length(n);
      float per = dir < 2 ? g : dir == 2 ? uRes.y : uRes.x;
      float c = floor((float(i) + grb_rand(b, 2u)) / nb * per);
      float w = max(u_beam_width * (1.0 - u_beam_var * grb_rand(b, 3u)), 1.0);
      float u = dot(n, q) - c;
      float perp = (u - per * floor(u / per + 0.5)) * sc;
      float d = abs(perp) - 0.5 * w;
      float along = -1e9;   // past the ends (segments)
      if (u_beam_len < 1.0) {
        vec2 p0 = vec2(grb_rand(b, 4u), grb_rand(b, 5u)) * uRes;
        vec2 C = p0 - n * (dot(n, p0) - c) / dot(n, n);
        vec2 dq = q - C;
        dq -= uRes * floor(dq / uRes + 0.5);
        float h = 0.5 * u_beam_len * min(uRes.x, uRes.y) * mix(0.6, 1.0, grb_rand(b, 6u));
        perp = dot(dq, n) * sc;
        along = abs(dot(dq, vec2(-n.y, n.x))) * sc - h;
        d = max(abs(perp) - 0.5 * w, along);
      }
      if (d < dBm) { dBm = d; bPerp = perp; bW = w; bNk = n * sc; bAl = along; }
    }
    // Rails: two bars a quarter of the width along the edges; grooved: a fifth-wide groove down the middle.
    float rw = max(1.0, floor(0.25 * bW + 0.5));
    float dBe = u_beam_style == 1 ? abs(dBm + 0.5 * rw) - 0.5 * rw : dBm;
    float bb = min(u_bevel, u_beam_style == 1 ? 0.5 * rw : 0.3 * bW);
    // (A plain smooth ramp, not the Edge profile: each profile call site costs D3D compile time.)
    v += u_beam_height * (bb > 0.0 ? smoothstep(0.0, 1.0, -dBe / bb) : grb_cov(dBe));
    if (u_beam_style == 2) v -= 0.6 * u_beam_height * grb_cov(abs(bPerp) - 0.5 * max(1.0, floor(0.2 * bW + 0.5))) * grb_cov(dBm);
    dBm = dBe;
  }
#endif


  if (u_output == 0) {
    // The stack is scaled so its peak fits under 1 — the top plateau with its bulge plus the highest thing that can stand
    // on it (a raised frame, with rivets, a pipe or ribs on it; a rivet or bolt; a lens dome) — so every level, dome and
    // raised centre keeps its shape instead of clipping.
    bool riv = u_rivets > 0 && u_rivet_chance > 0.0;
    float raise = u_frame_chance > 0.0 && u_frame_style != 0 && u_frame_style != 2 ? u_inset_depth * (1.0 + max(u_bulge, 0.0) / GRB_TOP) : 0.0;
    float ribs = u_detail_chance > 0.0 || u_edge_chance > 0.0 ? (u_det_pipes || u_hero > 0.0 ? u_inset_depth : u_det_ribs ? 0.8 * u_inset_depth : 0.0) : 0.0;
    float bolt = u_small_parts > 0.0 ? u_rivet_height : 0.0;
    float onRaise = raise + max(riv && u_rivet_inset + u_rivet_radius > u_frame_inset ? u_rivet_height : 0.0, ribs);
    float lens = u_det_light && u_detail_chance > 0.0 ? u_light_dome - 0.4 * u_inset_depth : 0.0;
    // (Hardware — switches, sockets, sliders, keypads, fans — stands up to twice Inset depth.)
    // (On panels or in edge strips.)
    if ((u_detail_chance > 0.0 || u_edge_chance > 0.0) && (kinds & GRB_K_HW) != 0) ribs = max(ribs, 2.3 * u_inset_depth);
    // (Nested pieces — under borders, strips or drawn splits — may stand up to a raised border and a quarter of the top
    // above it.)
    float nest = u_frame_chance > 0.0 || u_edge_chance > 0.0 || u_seamless < 1.0 ? 2.0 * u_inset_depth + 0.1875 : 0.0;
    float peak = GRB_TOP + nest + max(u_bulge, 0.0) + max(max(onRaise, riv ? u_rivet_height : bolt), max(lens, ribs)) + (u_beams > 0 ? max(u_beam_height, 0.0) : 0.0);
    // (Pipe runs laid on top stand up to twice Inset depth above the top plates.)
    if (u_chan_chance > 0.0 && u_chan_surface > 0.0) peak = max(peak, 0.8 + 2.6 * u_inset_depth * u_tube_lift);
    if (u_chan_chance > 0.0 || u_routes > 0) peak = max(peak, GRB_TOP * 1.3 * u_tube_lift);
    // (The junction lid, and its screws standing on it.)
    if (u_routes > 1 && u_junction == 0) peak = max(peak, grb_lidTop() + 0.55 * u_inset_depth);
    v = clamp(v / max(peak, 1.0), 0.0, 1.0);
    if (u_mask == 0) return genOut(v, 1.0, rnd, NO_SDF);
    float dm = u_mask == 1 ? max(max(dP, -dHole), -dSunk) : u_mask == 2 ? dP : u_mask == 3 ? -dP : u_mask == 4 ? dF
             : u_mask == 5 ? dR : u_mask == 6 ? dD : u_mask == 7 ? dL : dBm;
    return genOutOwn(v, 1.0, rnd, dm);
  }
  float d = u_output == 1 ? dP : u_output == 2 ? -dP : u_output == 3 ? dF : u_output == 4 ? dR : u_output == 5 ? dD : u_output == 6 ? dL : dBm;
  GenOut g = genOut(0.0, 1.0, rnd, d);
  // Bevel aspect (greebleCommon): the output's shape again in the stretched space. Panels: the cell's sides as lines
  // (each side's distance × its k; a jog's 45° stretches as if straight), their corner rounded there, cut by the corner
  // cuts or the shaped outline (above); a border's line or step: the sides moved in; a detail or light: its rounded box,
  // or the tubes (across them) and their flanges; a beam: its sides and ends. (Rivets are round: no mitre to step.)
  if (bevelAspectOn() && u_output != 4) {
    float e = d;
    vec4 kS = vec4(bk.xx, bk.yy);
    if (u_output <= 2) {
      vec2 cmK = grb_min8(cell.dS * kS, cell.dG * bkd);
      float dCellK = -grb_roundMin(cmK, rc0);
      float polyK = (ps * sqrt(pd2) - rr0 < 0.0 ? -1.0 : 1.0) * sqrt(pd2k);
      float dPolyK = none ? 1e4 : max(dCellK, shp > 0 ? polyK : grb_corners(q, pb.xy, pb.zw, kq) * bkd);
      float dPK = none ? max(cmK.x, 0.5) : dPolyK;
      if (dPK > 0.0) dPK = min(dPK, max(cell.dLk, 0.0));
      if (u_fill == 2) dPK = min(dPK, max(dCellK, max(cell.gap.x, cell.gap.y) - dPolyK));
      e = u_output == 1 ? dPK : -dPK;
    } else if (u_output == 3) {
      if (cell.kind == 1) {
        // A line: the band between its sides moved in by t0 and t1; a step: the sides moved in by the width.
        float t1 = fs <= 1 ? 0.5 * (cell.dw + u_frame_width) : cell.dw, t0 = 0.5 * (cell.dw - u_frame_width);
        vec4 mi = min((cell.dS - t1) * kS, (cell.dG - t1) * bkd), mo = max((t0 - cell.dS) * kS, (t0 - cell.dG) * bkd);
        e = max(min(min(mi.x, mi.y), min(mi.z, mi.w)), fs <= 1 ? max(max(mo.x, mo.y), max(mo.z, mo.w)) : -1e9);
      }
    } else if (u_output <= 6) {
      bool tubes = u_output == 5 && tC.x < -1e4;
      e = tubes ? tMk : d < 1e3 ? grb_bevRBox((tSw ? q.yx : q) - tC, tH, tRad, grb_bevK(tSw)) : d;
    } else if (dBm < 1e3) {
      float ka = u_bevel / bevelWidth(bNk), kb = u_bevel / bevelWidth(vec2(-bNk.y, bNk.x));
      float aa = abs(bPerp) - 0.5 * bW;
      e = max(aa * ka, bAl * kb);
      // Rails: the band less its middle, Rails' width in from its sides.
      if (u_beam_style == 1) { float rw = max(1.0, floor(0.25 * bW + 0.5)); e = max(e, min((-aa - rw) * ka, (-bAl - rw) * kb)); }
    }
    g.bdist = e;
  }
  return g;
}
`
};
