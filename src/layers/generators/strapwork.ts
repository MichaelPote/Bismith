// Strapwork (FR8.30, docs/features/fr8.30-carved-relief.md): geometric line networks carved as height — raised straps
// over sunken fields. The network comes from a periodic tiling (strapNet.ts, on the CPU): its edges (coffers, lattices),
// star patterns grown from each edge's midpoint (six-, eight-, twelve-pointed stars), or each tile's outline scaled and
// rounded into overlapping rings (chain links, overlapping circles) — or edges with stars or rings on them. Straps
// have a profile and up to three lines, and weave over and under at crossings; the fields between them are sunk, flat,
// a pyramid or a dome, and filled by kind (slats turned per kind, diaper, concentric insets). The value is the height
// (0 = deepest, 1 = highest), so Diffuse is a plain ramp from low to high.

import { P, gradient, type ParamValues } from '@/core/params';
import { memoize, memoReads } from '@/core/memo';
import type { LayerCanvas, LayerDef } from '../types';
import { TILINGS, buildNet, type BuildOpts, type Construction, type TilingName } from './strapNet';

/** Buckets across one period (each lists the pieces within reach of it). */
const MAX_BUCKETS = 32;
/** The most pieces a bucket may list (the shader's loop bound). */
const MAX_PER_BUCKET = 48;
/** Rows of the piece / index textures are this wide. */
const ROW = 256;

/** Tilings with a square period, which can be turned 45° (Diagonal). */
const SQUARE_PERIOD = ['square', 'octagon'];

const net = memoize((o: BuildOpts) => buildNet(o), 4);

const optsOf = (p: ParamValues): BuildOpts => ({
	tiling: (TILINGS as readonly string[]).includes(String(p.tiling)) ? (p.tiling as TilingName) : 'octagon',
	construct: String(p.construct) as Construction,
	angle: Number(p.angle) || 60,
	offset: Number(p.offset) || 0,
	ringScale: Number(p.ring_scale) || 1,
	ringRound: Number(p.ring_round) || 0,
	diagonal: Boolean(p.diagonal) && SQUARE_PERIOD.includes(String(p.tiling)),
	through: Boolean(p.through),
	starInset: Number(p.star_inset) || 1,
	edgeGap: Boolean(p.edge_gap),
	linkN: Number(p.link_n) || 2,
	linkW: Number(p.link_w) || 0.25
});

/** Periods across and down (whole when tiling), the net's period aspect kept × Aspect. */
function layout(p: ParamValues, c: LayerCanvas): { kx: number; ky: number } {
	const n = net(optsOf(p));
	const [px, py] = n.period;
	// Repeats count base tiling periods; the net's period may hold two (rep).
	const across = Math.max(0.25, Number(p.scale) || 4) / n.rep[0];
	const kx = c.tileable ? Math.max(1, Math.round(across)) : across;
	const cellW = c.width / kx;
	const natH = cellW * (py / px) * (Number(p.aspect) || 1);
	const ky = c.tileable ? Math.max(1, Math.round(c.height / natH)) : c.height / natH;
	return { kx, ky };
}

/** 16-bit fixed point of a coordinate in period fractions within [−1, 2). */
const enc = (v: number) => Math.max(0, Math.min(65535, Math.round(((v + 1) / 3) * 65535)));

const pack = memoReads((p: ParamValues, c: LayerCanvas) => {
	const n = net(optsOf(p));
	const [px, py] = n.period;
	const { kx, ky } = layout(p, c);
	// Reach of a piece, in period fractions: half the strap, the gap and a margin, in px over the cell.
	const reachPx = 0.5 * (Number(p.strap_w) || 4) + (Number(p.gap) || 0) + 3;
	const rx = reachPx / (c.width / kx);
	const ry = reachPx / (c.height / ky);
	const N = n.pieces.length;
	const G = Math.max(4, Math.min(MAX_BUCKETS, Math.ceil(Math.sqrt(N * 2))));
	// Pieces: three texels each — ax, ay, bx, by as 16 bits, then the ends' flags.
	const segW = ROW * 3;
	const segH = Math.max(1, Math.ceil(N / ROW));
	const seg = new Uint8Array(segW * segH * 4);
	n.pieces.forEach((q, i) => {
		const o = ((i / ROW) | 0) * segW * 4 + (i % ROW) * 12;
		const ax = enc(q.a[0] / px);
		const ay = enc(q.a[1] / py);
		const bx = enc(q.b[0] / px);
		const by = enc(q.b[1] / py);
		seg.set(
			[ax >> 8, ax & 255, ay >> 8, ay & 255, bx >> 8, bx & 255, by >> 8, by & 255, q.endA, q.endB, q.line & 255, q.cls],
			o
		);
	});
	// Buckets: every piece copy (shifted by −1…1 periods) whose reach box meets the bucket.
	const lists: number[][] = Array.from({ length: G * G }, () => []);
	n.pieces.forEach((q, i) => {
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) {
				const x0 = Math.min(q.a[0], q.b[0]) / px + dx - rx;
				const x1 = Math.max(q.a[0], q.b[0]) / px + dx + rx;
				const y0 = Math.min(q.a[1], q.b[1]) / py + dy - ry;
				const y1 = Math.max(q.a[1], q.b[1]) / py + dy + ry;
				if (x1 < 0 || y1 < 0 || x0 >= 1 || y0 >= 1) continue;
				const code = dx + 1 + (dy + 1) * 3;
				for (let by = Math.max(0, Math.floor(y0 * G)); by <= Math.min(G - 1, Math.floor(y1 * G)); by++)
					for (let bx = Math.max(0, Math.floor(x0 * G)); bx <= Math.min(G - 1, Math.floor(x1 * G)); bx++) {
						const l = lists[by * G + bx];
						if (l.length < MAX_PER_BUCKET) l.push(i * 9 + code);
					}
			}
	});
	const total = lists.reduce((s, l) => s + l.length, 0);
	const bkt = new Uint8Array(G * G * 4);
	const idxH = Math.max(1, Math.ceil(total / ROW));
	const idx = new Uint8Array(ROW * idxH * 4);
	let at = 0;
	lists.forEach((l, b) => {
		bkt.set([at >> 8, at & 255, l.length, 0], b * 4);
		for (const e of l) {
			const i = (e / 9) | 0;
			idx.set([i >> 8, i & 255, e % 9, 0], at * 4);
			at++;
		}
	});
	// Fields: the label raster, and per region its kind, colour and inradius (a share of the largest).
	const face = new Uint8Array(n.rw * n.rh * 4);
	for (let i = 0; i < n.rw * n.rh; i++) face.set([n.label[i] >> 8, n.label[i] & 255, 0, 0], i * 4);
	const R = n.regions.length;
	const maxInr = Math.max(...n.regions.map((r) => r.inr), 1e-6);
	const reg = new Uint8Array(ROW * Math.ceil(R / ROW) * 4);
	n.regions.forEach((r, i) => reg.set([r.kind, Math.max(0, r.colour), Math.round((r.inr / maxInr) * 255), 0], i * 4));
	return {
		tex: {
			seg: { width: segW, height: segH, data: seg },
			bkt: { width: G, height: G, data: bkt },
			idx: { width: ROW, height: idxH, data: idx },
			face: { width: n.rw, height: n.rh, data: face },
			reg: { width: ROW, height: Math.ceil(R / ROW), data: reg }
		},
		// The largest field's inradius in px (period units × px per unit, the smaller axis).
		maxInrPx: maxInr * Math.min(c.width / kx / px, c.height / ky / py),
		kinds: Math.max(1, ...n.regions.slice(1).map((r) => r.kind + 1)),
		k: [kx, ky]
	};
});

const isRings = (p: ParamValues) => String(p.construct).includes('rings');
const isFramed = (p: ParamValues) => String(p.construct).startsWith('edges_');
const isStars = (p: ParamValues) => String(p.construct).includes('stars');
const isLinks = (p: ParamValues) => p.construct === 'links';
const hasEdges = (p: ParamValues) => isFramed(p) || p.construct === 'edges';
const hasFill = (p: ParamValues) => p.fill !== 'none';

const STRAP_RAMP = gradient('#22150c', '#6e4527', '#c8955f');

export const strapworkLayer: LayerDef = {
	type: 'strapwork',
	label: 'Strapwork',
	category: 'pattern',
	kind: 'generator',
	area: true,
	sdf: true,
	sdfShowIf: (p, key) => key === undefined || (p.output !== 'relief' && key === 'aa'),
	description:
		'Geometric strapwork as height: Raised straps along a line network grown from a tiling (its edges, star patterns, or overlapping rings), weaving over and under where they cross, over sunken fields filled by kind.',
	params: [
		P.enum(
			'output',
			'Output',
			'relief',
			[
				['relief', 'Relief (value)'],
				['straps', 'Straps (shape)'],
				['fields', 'Fields (shape)'],
				['kinds', 'Field kinds (value)']
			],
			{
				hint: 'Relief is the whole carving as height. Straps and Fields give one part as a shape; Field kinds gives each kind of field its own tone along the ramp'
			}
		),
		P.seed(),
		P.enum(
			'tiling',
			'Tiling',
			'octagon',
			[
				['square', 'Squares'],
				['hexagon', 'Hexagons'],
				['triangle', 'Triangles'],
				['octagon', 'Octagons and squares'],
				['trihex', 'Hexagons and triangles'],
				['dodecagon', 'Dodecagons and triangles'],
				['rhombille', 'Rhombille (tumbling blocks)']
			],
			{ uniform: false, hint: 'Picks the tiling the network grows from' }
		),
		P.bool('diagonal', 'Diagonal', false, {
			uniform: false,
			showIf: (p) => SQUARE_PERIOD.includes(String(p.tiling)),
			hint: 'Turns the tiling 45°'
		}),
		P.enum(
			'construct',
			'Lines',
			'stars',
			[
				['edges', 'Edges', 'The tiling’s own edges: coffers, lattices, cube faces'],
				['stars', 'Stars', 'Two rays from each edge’s midpoint, cut where they meet the next: star patterns'],
				['rings', 'Rings', 'Each tile’s outline grown and rounded so neighbours overlap: chain links, circles'],
				['edges_stars', 'Edges and stars'],
				['edges_rings', 'Edges and rings'],
				['links', 'Links', 'Chained beads along the tile edges, each with an eye: chain links, beaded lattices'],
				[
					'rings_spokes',
					'Rings and spokes',
					'Each tile’s outline shrunk into a ring (a coffer), joined to the tile’s corners by spokes'
				]
			],
			{ uniform: false, hint: 'Picks how the lines are drawn on the tiling' }
		),
		P.float('angle', 'Star angle', 67.5, 10, 85, {
			uniform: false,
			step: 0.1,
			unit: '°',
			showIf: isStars,
			hint: 'Sets the rays’ angle to their edge: low angles give broad, shallow stars, high angles sharp ones (squares at 45° make the plain lattice)'
		}),
		P.float('star_inset', 'Star size', 1, 0.2, 1, {
			uniform: false,
			step: 0.001,
			showIf: isStars,
			hint: 'Grows each star on its tile shrunk to this size: below 1 a rosette inside each tile, tied to the tile’s edges by short spokes'
		}),
		P.bool('through', 'Rays through', false, {
			uniform: false,
			showIf: isStars,
			hint: 'Runs each ray on to the tile’s border instead of stopping where it meets the next: crossing bars, woven planks, lattices'
		}),
		P.float('offset', 'Star offset', 0, -0.9, 0.9, {
			uniform: false,
			step: 0.001,
			showIf: isStars,
			hint: 'Starts the two rays apart along the edge (a share of it), so each line becomes a pair: wider, open stars. Below 0 they start crossed, each heading over the other’s side — with Rays through, long crossing bars'
		}),
		P.int('link_n', 'Beads per edge', 2, 1, 4, {
			uniform: false,
			showIf: isLinks,
			hint: 'Sets how many beads chain along each tile edge'
		}),
		P.float('link_w', 'Bead width', 0.25, 0.05, 0.6, {
			uniform: false,
			step: 0.001,
			showIf: isLinks,
			hint: 'Sets how far each bead swells either side of its edge, a share of its length: wider beads, bigger eyes'
		}),
		P.bool('edge_gap', 'Open edges', false, {
			uniform: false,
			showIf: (p) => p.construct === 'edges_stars' && Math.abs(Number(p.offset) || 0) > 0,
			hint: 'Leaves each tile edge open between the starts of its ray pair, so the diamond the pair makes there stays whole'
		}),
		P.float('ring_scale', 'Ring size', 1.3, 0.5, 2, {
			uniform: false,
			step: 0.001,
			showIf: isRings,
			hint: 'Grows each tile’s outline about its centre; above 1 neighbouring rings overlap and cross'
		}),
		P.float('ring_round', 'Ring rounding', 0.5, 0, 1, {
			uniform: false,
			step: 0.001,
			showIf: isRings,
			hint: 'Rounds the rings’ corners (1 = circles)'
		}),
		P.float('scale', 'Repeats across', 3, 0.25, 64, {
			softMax: 12,
			step: 0.01,
			uniform: false,
			hint: 'Sets how many times the tiling repeats across the texture (whole when tiling)'
		}),
		P.float('aspect', 'Aspect', 1, 0.25, 4, {
			step: 0.01,
			uniform: false,
			hint: 'Stretches the pattern vertically'
		}),
		P.float('edge_wt', 'Edge weight', 1, 0.25, 4, {
			step: 0.01,
			group: 'straps',
			showIf: isFramed,
			hint: 'Makes the tile edges’ straps this many times as wide as the star lines or rings on them: a heavy frame round finer work'
		}),
		P.float('edge_lvl', 'Edge level', 0, -1, 1, {
			step: 0.001,
			group: 'straps',
			showIf: isFramed,
			hint: 'Raises (or lowers) the tile edges’ straps from Strap level, so the frame stands above the stars or rings on it'
		}),
		P.enum(
			'edge_prof',
			'Edge profile',
			'same',
			[
				['same', 'As Strap profile'],
				['flat', 'Flat (bevelled edges)'],
				['round', 'Round'],
				['ridge', 'Ridge'],
				['hollow', 'Hollow (concave)'],
				['stepped', 'Stepped'],
				['moulded', 'Moulded']
			],
			{
				group: 'straps',
				showIf: isFramed,
				hint: 'Gives the tile edges’ straps their own profile: a ridged frame round flat stars'
			}
		),
		P.int('edge_lines', 'Edge lines', 0, 0, 3, {
			group: 'straps',
			showIf: isFramed,
			hint: 'Gives the tile edges’ straps their own number of lines (0 = as Lines): a plain frame round double-line stars'
		}),
		P.float('strap_w', 'Strap width', 5, 0.5, 128, {
			softMax: 24,
			unit: 'px',
			step: 0.25,
			group: 'straps',
			hint: 'Sets the width of the straps'
		}),
		P.enum(
			'strap_prof',
			'Strap profile',
			'flat',
			[
				['flat', 'Flat (bevelled edges)'],
				['round', 'Round'],
				['ridge', 'Ridge'],
				['hollow', 'Hollow (concave)'],
				['stepped', 'Stepped', 'A raised face down the middle on a lower shoulder each side'],
				['moulded', 'Moulded', 'A round bead down the middle between flat shoulders']
			],
			{ group: 'straps', hint: 'Shapes the straps across their width' }
		),
		P.int('steps', 'Steps', 1, 1, 3, {
			group: 'straps',
			showIf: (p) => p.strap_prof === 'stepped' || p.edge_prof === 'stepped',
			hint: 'Sets how many flat fillets step down each side of a stepped strap’s face'
		}),
		P.float('strap_bevel', 'Edge bevel', 1, 0.5, 32, {
			softMax: 6,
			unit: 'px',
			step: 0.25,
			group: 'straps',
			showIf: (p) => ['flat', 'hollow', 'stepped', 'moulded'].includes(String(p.strap_prof)),
			hint: 'Sets how wide the slope at each edge of a flat strap is'
		}),
		P.int('lines', 'Lines', 1, 1, 3, {
			group: 'straps',
			hint: 'Splits each strap into two or three by fine grooves along it (the double-line strap)'
		}),
		P.float('line_w', 'Line width', 1.2, 0.5, 8, {
			unit: 'px',
			step: 0.05,
			group: 'straps',
			showIf: (p) => Number(p.lines) > 1,
			hint: 'Sets how wide the grooves between the lines are'
		}),
		P.float('line_d', 'Line depth', 0.35, 0, 1, {
			step: 0.001,
			group: 'straps',
			showIf: (p) => Number(p.lines) > 1,
			hint: 'Sets how deep the grooves between the lines are'
		}),
		P.float('strap_lvl', 'Strap level', 0.85, 0, 1, {
			step: 0.001,
			group: 'straps',
			hint: 'Sets the height of the straps’ faces'
		}),
		P.float('joint_w', 'Joint lines', 0, 0, 4, {
			unit: 'px',
			step: 0.05,
			group: 'straps',
			hint: 'Cuts a fine joint line this wide along every strap’s edge (0 = none): boards fitted flush against their fields'
		}),
		P.float('joint_d', 'Joint depth', 0.2, 0, 1, {
			step: 0.001,
			group: 'straps',
			showIf: (p) => Number(p.joint_w) > 0,
			hint: 'Sets how deep the joint lines cut'
		}),
		P.bool('frame_j', 'Frame joints', false, {
			group: 'straps',
			showIf: (p) => hasEdges(p) && Number(p.joint_w) > 0,
			hint: 'Cuts a joint down the middle of each tile edge’s strap and mitres at its corners, so each tile has its own frame of four boards'
		}),
		P.bool('weave', 'Weave', true, {
			group: 'straps',
			hint: 'Weaves the straps over and under where they cross, alternating along each strand. Off: crossings join flat'
		}),
		P.float('dip', 'Under dip', 0.25, 0, 1, {
			step: 0.001,
			group: 'straps',
			showIf: (p) => Boolean(p.weave),
			hint: 'Lowers a strap where it passes under another, sloping back up over half a strap width from the gap'
		}),
		P.float('gap', 'Under gap', 1.5, 0, 16, {
			softMax: 4,
			unit: 'px',
			step: 0.25,
			group: 'straps',
			showIf: (p) => Boolean(p.weave),
			hint: 'Cuts a gap this wide each side of the strap on top, a shadow line where the lower one goes under'
		}),
		P.enum(
			'field',
			'Field',
			'flat',
			[
				['flat', 'Flat'],
				['pyramid', 'Pyramid', 'Straight slopes up from the straps to a point or ridge in the middle'],
				['dome', 'Dome', 'Rounds up from the straps to the middle'],
				['dish', 'Dish', 'Hollows down from the straps to the middle']
			],
			{ group: 'fields', hint: 'Shapes the fields between the straps' }
		),
		P.float('field_lvl', 'Field level', 0.3, 0, 1, {
			step: 0.001,
			group: 'fields',
			hint: 'Sets the height of the fields (their edge, for a pyramid, dome or dish)'
		}),
		P.float('field_rise', 'Field rise', 0.3, 0, 1, {
			step: 0.001,
			group: 'fields',
			showIf: (p) => p.field !== 'flat',
			hint: 'Sets how far the middle of each field rises (or sinks, a dish) from its edge'
		}),
		P.float('field_top', 'Field top', 0, 0, 0.95, {
			step: 0.001,
			group: 'fields',
			showIf: (p) => p.field !== 'flat',
			hint: 'Flattens the top of a pyramid or dome (a share of the field): hipped panels'
		}),
		P.float('field_var', 'Field variation', 0, 0, 0.5, {
			step: 0.001,
			group: 'fields',
			hint: 'Raises or lowers each field a little at random'
		}),
		P.float('field_w', 'Field slope', 1, 0, 64, {
			softMax: 12,
			unit: 'px',
			step: 0.25,
			group: 'fields',
			hint: 'Sets how wide the slope from the straps down to the field is (0 = a sheer drop)'
		}),
		P.float('kind_d', 'Kind levels', 0, -0.5, 0.5, {
			step: 0.001,
			group: 'fields',
			hint: 'Raises each kind of field this much above the one before (stars, polygons, kites…), so they sit at different depths'
		}),
		P.enum(
			'fill',
			'Fill',
			'none',
			[
				['none', 'None'],
				['slats', 'Slats', 'Parallel grooves, turned for each kind of field'],
				['insets', 'Insets', 'Lines following the field’s outline, stepping in'],
				['diaper', 'Diaper', 'A small grid of pyramids'],
				['checks', 'Cut diaper', 'A small grid of sunk pyramids: cut checks (turn it 45° for sunk diamonds)']
			],
			{ group: 'fields', hint: 'Carves a pattern into the fields' }
		),
		P.float('fill_sp', 'Fill spacing', 4, 1, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.25,
			group: 'fields',
			showIf: hasFill,
			hint: 'Sets the distance between the fill’s grooves, insets or pyramids'
		}),
		P.float('fill_d', 'Fill depth', 0.12, -1, 1, {
			step: 0.001,
			group: 'fields',
			showIf: hasFill,
			hint: 'Sets how deep the fill cuts (below 0: it stands up instead — raised insets)'
		}),
		P.float('fill_jit', 'Slat jitter', 0, 0, 1, {
			step: 0.001,
			group: 'fields',
			showIf: (p) => p.fill === 'slats',
			hint: 'Shifts each slat’s groove and varies its depth a little, as cut by hand'
		}),
		P.enum(
			'fill_dir',
			'Slat direction',
			'turn',
			[
				['turn', 'Turned per kind', 'At Fill angle (slats also turned by Turn per kind for each kind of field)'],
				['edge', 'Along the straps', 'Parallel to the nearest strap, so each field’s slats follow its sides'],
				[
					'mixed',
					'Along the straps in the largest',
					'Along the straps in the largest kind of field, turned in the others'
				]
			],
			{
				group: 'fields',
				showIf: (p) => ['slats', 'diaper', 'checks'].includes(String(p.fill)),
				hint: 'Picks which way the slats (or the diaper grid) run'
			}
		),
		P.float('fill_gw', 'Slat groove', 0.5, 0.1, 1, {
			step: 0.001,
			group: 'fields',
			showIf: (p) => p.fill === 'slats',
			hint: 'Sets how wide the grooves between the slats are, a share of Fill spacing: low for fine cuts between broad boards'
		}),
		P.float('fill_angle', 'Fill angle', 0, -180, 180, {
			step: 0.1,
			unit: '°',
			group: 'fields',
			showIf: (p) => ['slats', 'diaper', 'checks'].includes(String(p.fill)),
			hint: 'Turns the slats or the diaper grid (0° runs the slats across, 90° down)'
		}),
		P.float('kind_turn', 'Turn per kind', 60, -180, 180, {
			step: 0.1,
			unit: '°',
			group: 'fields',
			showIf: (p) => p.fill === 'slats',
			hint: 'Turns the slats this much more for each kind of field (tumbling blocks: 60°)'
		}),
		P.int('inset_n', 'Insets', 2, 1, 12, {
			group: 'fields',
			showIf: (p) => p.fill === 'insets',
			hint: 'Sets how many inset lines step in from the field’s edge'
		})
	],
	groups: [
		{ id: 'straps', label: 'Straps' },
		{ id: 'fields', label: 'Fields' }
	],
	defaults: {
		bevel: 0,
		h_on: true,
		h_amount: 0.6,
		dif_on: true,
		dif_src: 'value',
		dif_grad: STRAP_RAMP
	},
	derivedUniforms: {
		decl: { k: 'vec2', inr: 'float', kinds: 'float', mixd: 'float' },
		compute: (p, c) => {
			const k = pack(p, c);
			return { k: k.k, inr: k.maxInrPx, kinds: k.kinds, mixd: isFramed(p) ? 1 : 0 };
		}
	},
	textures: ['seg', 'bkt', 'idx', 'face', 'reg'],
	cpuData: (p, c) => pack(p, c).tex,
	glsl: /* glsl */ `
// A 16-bit coordinate (period fractions in [−1, 2)) from two bytes.
float stw_dec(float hi, float lo) { return ((hi * 256.0 + lo) * 255.0 / 65535.0) * 3.0 - 1.0; }

// Distance from the origin to segment a–b, and how far along it the nearest point is.
vec2 stw_seg(vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(-dot(a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
  return vec2(length(a + ab * t), t);
}

// The strap's profile 0..1 at distance d from its centre line (half width hw), with n lines.
// The strap's profile 0..1 at distance d from its centre line (half width hw): profile pf, n lines.
float stw_prof(float d, float hw, int pf, int n, float lvl) {
  if (d >= hw + 0.5) return 0.0;
  float s = clamp(d / hw, 0.0, 1.0);
  float cov = clamp(hw + 0.5 - d, 0.0, 1.0);
  float bev = clamp((hw - d) / max(u_strap_bevel, 0.5), 0.0, 1.0);
  // Stepped: a flat face, then Steps flat fillets down each side, each at least 1 px wide, the risers 1 px. The face
  // keeps at least 40 % of the width: steps that don't fit are dropped (a narrow strap stays flat, not reeded).
  // Moulded: a round bead on one such fillet, a quirk at its foot.
  float sh = max(1.0, 0.22 * hw);
  int ns = pf == 4 ? clamp(u_steps, 0, max(int(floor((0.6 * hw - u_strap_bevel) / sh)), 0)) : 1;
  float fe = max(hw - u_strap_bevel - float(ns) * sh, 0.5);
  float drop = 0.0;
  for (int k = 0; k < 3 * UNI_1; k++) {
    if (k < ns) drop += clamp(d - fe - float(k) * sh + 0.5, 0.0, 1.0);
  }
  float quirk = clamp(1.0 - abs(d - fe - 0.6) / 0.6, 0.0, 1.0);
  float pr = pf == 1 ? sqrt(max(1.0 - s * s, 0.0))
    : pf == 2 ? 1.0 - s
    : pf == 4 ? bev * (1.0 - 0.5 / float(max(ns, 1)) * drop)
    : pf == 5 ? bev * (d < fe ? 0.55 + 0.45 * sqrt(max(1.0 - (d / fe) * (d / fe), 0.0)) : 0.72 - 0.18 * quirk)
    : bev;
  // Hollow: flat edges, a shallow channel down the middle.
  if (pf == 3) pr *= 0.7 + 0.3 * s * s;
  // Grooves between the lines (a double or triple strap), Line width wide.
  if (n > 1) {
    float at = n == 2 ? 0.0 : hw / 3.0;
    float lw = 0.5 * u_line_w + 0.35;
    float gq = clamp(1.0 - abs(d - at) / lw, 0.0, 1.0);
    pr -= u_line_d * sqrt(gq) / max(lvl - u_field_lvl, 0.05);
  }
  return max(pr, 0.0) * cov;
}

GenOut gen(vec2 p) {
  vec2 q = vec2(p.x, uRes.y - p.y);
  vec2 cell = uRes / d_k;
  vec2 f = fract(q / cell);
  ivec2 G = textureSize(t_bkt, 0);
  ivec4 hd = ivec4(texelFetch(t_bkt, clamp(ivec2(f * vec2(G)), ivec2(0), G - 1), 0) * 255.0 + 0.5);
  int start = hd.x * 256 + hd.y;
  int count = hd.z;
  float hw = 0.5 * u_strap_w;
  // Tile edges (with stars, rings on them) may have their own width, level and lines.
  bool mixd = d_mixd > 0.5;
  float hwE = mixd ? hw * u_edge_wt : hw;
  // Channels, each the nearest piece (by distance to its edge, so joins mitre and lines run on through them):
  // 0 / 1 on top (star lines or rings / tile edges), 2 passing under, 3 butting against another strap (a T).
  float ck[4] = float[4](1e4, 1e4, 1e4, 1e4);
  float cd[4] = float[4](1e4, 1e4, 1e4, 1e4);
  float ch[4] = float[4](1.0, 1.0, 1.0, 1.0);
  int ce[4] = int[4](0, 0, 0, 0);
  float uDip = 0.0;
  bool tEdge = false;
  float dmin = 1e4;        // to the nearest strap's edge (outside > 0), hidden or not: picks the strap the fills follow
  float nhw = hw;
  float nperp = 0.0;
  vec2 ndir = vec2(1.0, 0.0);
  // Away from the nearest strap (the fields' distance grows along it).
  vec2 nav = vec2(0.0, 1.0);
  // Frame joints: the nearest tile edge, and the nearest one not parallel to it (their equal distance is the mitre).
  float ed1 = 1e4, ed2 = 1e4;
  vec2 edir = vec2(1.0, 0.0);
  for (int i = 0; i < ${MAX_PER_BUCKET} * UNI_1; i++) {
    if (i < count) {
      int e = start + i;
      ivec4 en = ivec4(texelFetch(t_idx, ivec2(e % ${ROW}, e / ${ROW}), 0) * 255.0 + 0.5);
      int id = en.x * 256 + en.y;
      vec2 off = vec2(float(en.z % 3 - 1), float(en.z / 3 - 1));
      ivec2 base = ivec2((id % ${ROW}) * 3, id / ${ROW});
      vec4 t0 = texelFetch(t_seg, base, 0);
      vec4 t1 = texelFetch(t_seg, base + ivec2(1, 0), 0);
      ivec4 fl = ivec4(texelFetch(t_seg, base + ivec2(2, 0), 0) * 255.0 + 0.5);
      vec2 a = (vec2(stw_dec(t0.x, t0.y), stw_dec(t0.z, t0.w)) + off - f) * cell;
      vec2 b = (vec2(stw_dec(t1.x, t1.y), stw_dec(t1.z, t1.w)) + off - f) * cell;
      vec2 ab = b - a;
      float L = max(length(ab), 1e-4);
      vec2 dir = ab / L;
      // How far along the piece the pixel is from each end (unclamped), and its distance to the piece.
      float la = -dot(a, dir);
      float lb = L - la;
      float d = length(a + ab * clamp(la / L, 0.0, 1.0));
      if (fl.w == 1) {
        bool skew = abs(dir.x * edir.y - dir.y * edir.x) > 0.2;
        if (d < ed1) {
          if (skew) ed2 = ed1;
          ed1 = d;
          edir = dir;
        } else if (skew) ed2 = min(ed2, d);
      }
      bool edge = fl.w == 1 && mixd;
      float hwi = edge ? hwE : hw;
      if (d - hwi < dmin) {
        dmin = d - hwi;
        nhw = hwi;
        ndir = dir;
        nperp = abs(a.x * dir.y - a.y * dir.x);
        nav = -(a + ab * clamp(la / L, 0.0, 1.0)) / max(d, 1e-4);
      }
      // The nearer end decides (a short piece can pass under at one end and over at the other); a plain end (a join, a
      // star tip) never does, so a short tip past an under crossing stays under, not a bright knob.
      bool nearA = fl.y == 0 || (fl.x != 0 && la <= lb);
      int fe = nearA ? fl.x : fl.y;
      float le = nearA ? la : lb;
      // Under: near an end that passes beneath a crossing strap, rising back to full height over a ramp beyond.
      float reach = 1.6 * hwi + u_gap + 1.0;
      float ramp = max(hwi, 2.0);
      float uu = u_weave && fe == 2 ? clamp((reach + ramp - le) / ramp, 0.0, 1.0) : 0.0;
      // A T: near an end lying on another strap's side, it gives way to that strap (a butt joint).
      bool tee = fe >= 3 && le < 1.5 * (fe == 4 ? hwE : hw) + 1.0;
      int c = tee ? 3 : uu > 0.0 ? 2 : edge ? 1 : 0;
      // Past an end at a crossing the line runs on in its next piece: no cap (an under strand's would poke out beside a
      // short over piece).
      float k = (fe == 1 || fe == 2) && le < 0.0 ? 1e4 : d - hwi;
      for (int j = 0; j < 4 * UNI_1; j++) {
        if (j == c && k < ck[j]) {
          ck[j] = k;
          cd[j] = d;
          ch[j] = hwi;
          ce[j] = edge ? 1 : 0;
          if (j == 2) uDip = uu;
          if (j == 3) tEdge = fe == 4;
        }
      }
    }
  }
  // Clear of the straps on top (and the gap round them): where unders and Ts show.
  float edgeOver = min(ck[0], ck[1]);
  float strapLvl = u_strap_lvl;
  float hs[4];
  float lvls[4];
  for (int j = 0; j < 4 * UNI_1; j++) {
    lvls[j] = u_strap_lvl + (ce[j] == 1 ? u_edge_lvl : 0.0);
    int n = ce[j] == 1 && u_edge_lines > 0 ? u_edge_lines : u_lines;
    int pf = ce[j] == 1 && u_edge_prof > 0 ? u_edge_prof - 1 : u_strap_prof;
    hs[j] = cd[j] < 1e3 ? stw_prof(cd[j], ch[j], pf, n, lvls[j]) : 0.0;
  }
  float sUnder = hs[2] * clamp((edgeOver - u_gap) + 0.5, 0.0, 1.0);
  // A T strap shows up to where the strap it meets reaches full height (its bevel, or a ridge's flank), meeting it by
  // the higher of the two: no dark notch at the butt.
  int pfo = tEdge && u_edge_prof > 0 ? u_edge_prof - 1 : u_strap_prof;
  float bz = pfo == 1 || pfo == 2 ? (tEdge ? hwE : hw) : u_strap_bevel;
  float sTee = hs[3] * clamp(edgeOver + bz + 0.5, 0.0, 1.0);
  // The under strand is lowest at the gap line, rising back to full height a ramp away from it (never a knob beside the
  // strand on top), and only near its crossing.
  uDip *= clamp(1.0 - (edgeOver - u_gap) / max(0.5 * u_strap_w, 2.0), 0.0, 1.0);
  // The straps' visible outline (over, unders and Ts where they show): a joint line cut along it.
  float sv = min(edgeOver, min(max(ck[2], u_gap - edgeOver), max(ck[3], -edgeOver)));

  // The field under the pixel: its kind, colour and inradius; the distance from the strap edge.
  ivec2 R = textureSize(t_face, 0);
  ivec4 lb = ivec4(texelFetch(t_face, clamp(ivec2(f * vec2(R)), ivec2(0), R - 1), 0) * 255.0 + 0.5);
  int rid = lb.x * 256 + lb.y;
  ivec4 rg = ivec4(texelFetch(t_reg, ivec2(rid % ${ROW}, rid / ${ROW}), 0) * 255.0 + 0.5);
  float kind = float(rg.x);
  float rinr = float(rg.z) / 255.0 * d_inr;
  float inr = max(rinr - hw, 1.0);
  // From the straps' visible outline (a strand passing under, hidden, doesn't raise the field round it).
  float fd = sv;
  float rnd = hashI(ivec2(rid, 7), uSeed);

  float lvl = u_field_lvl + u_kind_d * kind + (rnd - 0.5) * u_field_var;
  // A flat top (Field top) on pyramids, domes and dishes.
  float t = clamp(fd / max(inr * (1.0 - u_field_top), 1.0), 0.0, 1.0);
  float fh = u_field == 1 ? lvl + u_field_rise * t
    : u_field == 2 ? lvl + u_field_rise * sqrt(max(1.0 - (1.0 - t) * (1.0 - t), 0.0))
    : u_field == 3 ? lvl - u_field_rise * sqrt(max(1.0 - (1.0 - t) * (1.0 - t), 0.0))
    : lvl;
  // The slope from the straps' foot down to the field.
  if (u_field_w > 0.0) fh = mix(strapLvl * 0.5 + 0.5 * fh, fh, clamp(fd / u_field_w, 0.0, 1.0));
  // Fills along the straps (Slat direction): everywhere, or in the largest kind of field.
  bool along = u_fill_dir == 1 || (u_fill_dir == 2 && kind < 0.5);
  if (u_fill != 0) {
    float sp = max(u_fill_sp, 1.0);
    // The slats' (and diaper's) direction: 0° runs them across, 90° down.
    float a = radians(u_fill_angle + (u_fill == 1 ? u_kind_turn * kind : 0.0));
    vec2 n = vec2(-sin(a), cos(a));
    float g;
    if (u_fill == 1) {
      // Slats: rounded grooves Slat groove × the spacing wide, softened by half a pixel; with Slat jitter each groove
      // shifts and varies its depth a little, as cut by hand.
      // Along the straps: grooves parallel to the nearest strap, a whole spacing apart from its edge on (the first a
      // whole slat in, so the strap doesn't get a double outline).
      float v = along ? (nperp - nhw) / sp + 0.5 : dot(q, n) / sp;
      float k = floor(v);
      vec2 jr = vec2(hashI(ivec2(int(k), rid), uSeed + 31.0), hashI(ivec2(int(k), rid), uSeed + 57.0));
      float dist = abs(fract(v) - 0.5 - u_fill_jit * 0.25 * (jr.x - 0.5)) * sp;
      float s = clamp(dist / (max(0.5 * u_fill_gw * sp, 0.5) + 0.35), 0.0, 1.0);
      g = sqrt(max(1.0 - s * s, 0.0)) * (1.0 - u_fill_jit * 0.6 * jr.y);
      // Along the straps, a groove whose loop would close into a pip (too near the field's middle) is left out.
      if (along) g *= clamp(nperp - nhw - 0.5 * sp, 0.0, 1.0) * clamp(inr - (nperp - nhw) - 0.6 * sp + 0.5, 0.0, 1.0);
    } else if (u_fill == 2) {
      // Insets: terraces stepping in from the edge, one Fill spacing wide each, a 1 px chamfer between.
      float k = clamp(fd / sp, 0.0, float(u_inset_n));
      g = floor(k) + clamp(fract(k) * sp - (sp - 1.0), 0.0, 1.0);
      g /= max(float(u_inset_n), 1.0);
    } else {
      // Diaper: faceted pyramids standing up from the field. Cut diaper: a checkerboard of flat-bottomed sunk squares
      // with crisp 1 px walls, inside a plain border a spacing wide. Along the straps the grid lines up with the nearest
      // strap, a row starting at its edge.
      vec2 r = along ? vec2(dot(q, ndir) / sp, (nperp - nhw) / sp) : vec2(dot(q, n), dot(q, vec2(-n.y, n.x))) / sp;
      vec2 cc = abs(fract(r) - 0.5) * 2.0;
      if (u_fill == 4) {
        vec2 ci = floor(r);
        float on = mod(ci.x + ci.y, 2.0) < 0.5 ? 1.0 : 0.0;
        // Whole checks only: the field's distance at the check's centre (from the pixel's, along the way away from the
        // nearest strap) must clear the border by the check's half diagonal, so no broken checks line the border.
        vec2 dr = (ci + 0.5 - r) * sp;
        vec2 bx = along ? ndir : n;
        vec2 by = along ? nav : vec2(-n.y, n.x);
        float fdc = fd + dot(dr.x * bx + dr.y * by, nav);
        g = on * clamp((1.0 - max(cc.x, cc.y)) * 0.5 * sp, 0.0, 1.0) * clamp(fdc - 1.2 * sp + 0.5, 0.0, 1.0);
      } else {
        g = max(cc.x, cc.y) - 1.0;
      }
    }
    // Fills finer than ~2.5 px fade out instead of aliasing into noise.
    float room = u_fill == 2 ? 1.0 : clamp((sp - 2.5) / 1.5, 0.0, 1.0);
    fh -= u_fill_d * g * clamp(fd - 0.5, 0.0, 1.0) * room;
  }

  // A sliver of field too small to be one (where four rings meet) fills to the straps' level instead of a pit.
  fh = mix(fh, strapLvl, clamp((hw + 2.0 - rinr) / 2.0, 0.0, 1.0));
  float h = max(max(fh, mix(fh, lvls[0], hs[0])), mix(fh, lvls[1], hs[1]));
  h = max(h, max(mix(fh, lvls[2] - u_dip * uDip, sUnder), mix(fh, lvls[3], sTee)));
  // Joint lines: a fine groove along every strap's visible outline (flush boards, frames against their fields).
  // Frame joints: one down the middle of each tile edge's strap and the mitres at its corners (where the nearest edge
  // gives way to the next), so each tile has its own frame.
  float jd = abs(sv);
  if (u_frame_j && ed1 < hwE) jd = min(jd, min(ed1, abs(ed1 - ed2) * 0.70710678));
  if (u_joint_w > 0.0) h -= u_joint_d * clamp(1.0 - jd / (0.5 * u_joint_w + 0.35), 0.0, 1.0);

  if (u_output == 1) return genOut(1.0, 1.0, rnd, sv);
  if (u_output == 2) return genOut(1.0, 1.0, rnd, -sv);
  if (u_output == 3) {
    GenOut ok = genOutOwn((kind + 0.5) / max(d_kinds, 1.0), 1.0, rnd, -sv);
    return ok;
  }
  GenOut o = genOutOwn(clamp(h, 0.0, 1.0), 1.0, rnd, sv);
  o.feat = 0.0;
  return o;
}
`
};
