// Rock: a natural rock face built from irregular fractured blocks — no strata lattice, no bricks. The building block
// is a power-weighted Voronoi diagram (blocks of widely different sizes, every site free in its cell), its edges made
// jagged by a noise offset, optionally elongated and leaned along a cleavage direction.
//
// Each block is a mesa: a face (its own height, tilt, a common dip across the cleavage and a dome or scoop) whose edges
// fall away by a chamfer of their own per border (drop and width hashed per block pair — so a face reads as a few flat
// facets meeting in ridges, or a rounded shoulder), and outside its cell a skirt that drapes over lower neighbours,
// falling one unit of relief per Ledge run px (optionally in flaky steps). The surface is the highest mesa, so tall
// blocks overhang their neighbours as ledges and equal ones meet in a V-shaped crevice. Splits cut a block by up to
// three straight chords (a chain: each splits one side of the one before), into pieces at slightly different heights
// that meet at the floor of a straight crack.
//
// Flakes repeat the same mesas at finer scales (Flake scale apart) on top, at Flake relief (fading with their size and
// by Facet breakup's patches): the crumpled, shingled look of most rock faces. Their creases can open as hairline Fractures.
// Surface grain and pits finish the faces. The relief is the value (0.5 + 0.5 tanh(height)); colour by height.
//
// What the layer can write to masks (Write to › Source, the hidden mask_feat): Blocks (each visible piece as a feature
// with its own random, parted at every crease: per-stone colour or bevels), and as plain coverages its Crevices (the
// creases and cracks, fading over Crevice reach), Fractures (the hairlines) and Ledges (the skirts hanging off taller
// blocks). The relief stays the layer's one output.
//
// Seamless: the frame is sheared (its rows lean by whole cells per tile) so any cleavage angle tiles; steep angles swap
// the axes. All counts are worked out on the CPU (rockDerived), per scale.

import { P, gradient } from '@/core/params';
import type { Curve, ParamValues } from '@/core/params';
import { DEFAULT_BEVEL_CURVE, PROFILES, PX_SCALE_PARAM, roughnessParams } from '../commonParams';
import { profileCurve } from '../shapingPreview';
import type { LayerCanvas, LayerDef } from '../types';
import { ORG_GLSL } from './organicShared';

const reliefGrad = () => gradient('#3a3631', '#77706a', '#a8a197', '#cdc7bd');

/** Most scales the shader evaluates: the blocks and up to three flake levels. */
const MAX_SCALES = 4;

const f32 = Math.fround;
const snap = (x: number) => Math.max(1, Math.floor(f32(x + 0.499)));

/**
 * The frame and the cells of every scale. The cleavage direction (Cleavage angle, clockwise on screen) runs along the
 * frame's x: within 45° of horizontal the frame is the screen, otherwise its axes are swapped. Rows lean by t = Δy / Δx;
 * when tiling, t is snapped so a row moves a whole m cells over the tile's width. Per scale: cell (w, h px, t, mean
 * side), counts (nx, ny, m), and the jaggedness noise's cells across the frame (x, y).
 */
export function rockDerived(p: ParamValues, c: LayerCanvas) {
	const ang = (Number(p.angle) * Math.PI) / 180;
	// The cleavage direction in GL px (y up; clockwise on screen is a negative angle).
	let dx = Math.cos(ang),
		dy = -Math.sin(ang);
	const steep = Math.abs(dy) > Math.abs(dx) + 1e-9;
	if (steep) [dx, dy] = [dy, dx];
	const W = steep ? c.height : c.width;
	const H = steep ? c.width : c.height;
	const tWant = dy / (Math.abs(dx) < 1e-9 ? 1e-9 : dx);
	const e = Math.min(Math.max(Number(p.elong) || 1, 0.1), 16);
	const base0 = c.width / Math.max(Number(p.scale) || 1, 0.25);
	const lac = Math.min(Math.max(Number(p.detail_scale) || 2.5, 1.5), 6);
	const cell: number[] = [];
	const per: number[] = [];
	const jag: number[] = [];
	const jagScale = Math.max(Number(p.jag_scale) || 0.5, 0.05);
	for (let o = 0; o < MAX_SCALES; o++) {
		const base = base0 / Math.pow(lac, o);
		let cw = base * Math.sqrt(e),
			ch = base / Math.sqrt(e);
		let nx = W / cw,
			ny = H / ch;
		let t = tWant,
			m = 0;
		if (c.tileable) {
			nx = snap(nx);
			ny = snap(ny);
			cw = W / nx;
			ch = H / ny;
			m = Math.round((tWant * W) / ch) + 0; // (no −0)
			t = (m * ch) / W;
		}
		cell.push(cw, ch, t, Math.sqrt(cw * ch));
		per.push(Math.round(nx), Math.round(ny), m, 0);
		// The jaggies' noise: cells about Jaggedness scale × the block across.
		const L = Math.sqrt(cw * ch) * jagScale;
		const jx = c.tileable ? snap(W / L) : W / L;
		const jy = c.tileable ? snap(H / L) : H / L;
		jag.push(jx, jy, 0, 0);
	}
	// The Edge card's Profile in nine samples, for the steps and ledges (a lookup in place of its branches at every call).
	const pi = Math.max(
		0,
		PROFILES.findIndex(([k]) => k === (p.profile ?? 'round'))
	);
	const curve = (p.bevel_curve as Curve | undefined) ?? DEFAULT_BEVEL_CURVE;
	const prof = Array.from({ length: 9 }, (_, i) => profileCurve(pi, i / 8, curve));
	return { steep: steep ? 1 : 0, cell, per, jag, prof };
}

export const rockLayer: LayerDef = {
	type: 'rock',
	label: 'Rock',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Natural rock face: Made from irregular fractured blocks of every size, each with its own height and tilt, faceted or rounded edges, ledges that overhang their neighbours, splits and crevices, with finer flakes, hairline fractures, grain and pits. Makes cliffs, boulders, crags and flaky strata, plus masks of the crevices, fractures and ledges to paint.',
	// Only the blocks and plates have a shape; the other sources write their coverage (never into Shape).
	sdfShowIf: (p) => p.mask_feat === undefined || p.mask_feat === 'blocks' || p.mask_feat === 'plates',
	maskSources: [
		{
			value: 'layer',
			label: 'Blocks',
			hint: 'each visible block (or piece of a split block) is one feature with its own random, parted at every crease and crack: per-stone colour, bevels from the joints',
			params: { mask_feat: 'blocks' },
			main: true
		},
		{
			value: 'plates',
			label: 'Plates',
			hint: 'each sheet of each block (Layers) is one feature with its own random, parted at every step, crease and crack: bevels and colour across the whole face',
			params: { mask_feat: 'plates' }
		},
		{
			value: 'crevices',
			label: 'Crevices',
			hint: 'the creases between blocks and the cracks, fading out over Crevice reach (open cracks strongest): dirt, moss, damp',
			params: { mask_feat: 'crevices' }
		},
		{
			value: 'fractures',
			label: 'Fractures',
			hint: 'the hairline fractures in the faces: fine dark or pale lines to paint',
			params: { mask_feat: 'fractures' }
		},
		{
			value: 'ledges',
			label: 'Ledges',
			hint: 'the skirts that taller blocks and flakes hang over their neighbours: the steep, shaded or weathered sides',
			params: { mask_feat: 'ledges' }
		}
	],
	params: [
		// ---------------------------------------------------------------- Blocks
		P.float('scale', 'Blocks across', 5, 0.5, 64, {
			softMax: 16,
			step: 0.01,
			uniform: false,
			section: 'Blocks',
			hint: 'How many blocks fit across the width (on average; whole counts when tiling)'
		}),
		P.float('size_var', 'Size variation', 0.7, 0, 1, {
			step: 0.001,
			section: 'Blocks',
			hint: 'Spreads the blocks’ sizes: 0 = all about alike, 1 = big blocks among small ones'
		}),
		P.float('elong', 'Elongation', 1, 0.1, 16, {
			softMin: 0.25,
			softMax: 8,
			step: 0.01,
			uniform: false,
			section: 'Blocks',
			hint: 'Stretches the blocks along the cleavage (above 1) or across it (below 1): slabs and flaky strata instead of chunky blocks'
		}),
		P.float('angle', 'Cleavage angle', 0, -90, 90, {
			step: 0.1,
			uniform: false,
			section: 'Blocks',
			hint: 'The direction the blocks stretch along and the ledges face across, clockwise from horizontal (snapped by a few degrees when tiling)'
		}),
		P.float('jag', 'Jaggedness', 0.3, 0, 1, {
			step: 0.001,
			section: 'Blocks',
			hint: 'Bends the blocks’ edges into ragged, wandering breaks instead of straight lines'
		}),
		P.float('jag_scale', 'Jaggedness scale', 0.5, 0.05, 2, {
			step: 0.001,
			uniform: false,
			section: 'Blocks',
			showIf: (p) => Number(p.jag) > 0,
			hint: 'The size of the wiggles, in blocks: small = fine teeth, 1 = long curving breaks'
		}),
		P.float('fuse', 'Fused joints', 0.35, 0, 1, {
			step: 0.001,
			section: 'Blocks',
			hint: 'The share of blocks whose edges hardly fall away: neighbouring ones read as one bigger mass, parted by a faint crease or a ledge (their joints never open). Gives big masses among small pieces instead of a paving of equal stones'
		}),
		P.float('splits', 'Splits', 0.4, 0, 1, {
			step: 0.001,
			section: 'Blocks',
			hint: 'The chance a block is split by straight cracks into two to four pieces at slightly different heights'
		}),
		P.float('rubble', 'Shattered blocks', 0.15, 0, 1, {
			step: 0.001,
			section: 'Blocks',
			hint: 'The share of blocks broken into rubble: their first flakes become separate pieces of their own heights, parted by cracks (needs Flake levels)'
		}),
		// ---------------------------------------------------------------- Relief
		P.float('heights', 'Height variation', 0.4, 0, 3, {
			softMax: 1.5,
			step: 0.001,
			section: 'Relief',
			hint: 'How much the blocks’ heights differ: taller blocks overhang their neighbours as ledges'
		}),
		P.float('tilt', 'Face tilt', 0.7, 0, 2, {
			step: 0.001,
			section: 'Relief',
			hint: 'Tilts each block’s face its own way (in relief per block)'
		}),
		P.float('dip', 'Ledge dip', 0, -2, 2, {
			step: 0.001,
			section: 'Relief',
			hint: 'Tilts every face the same way across the cleavage, so each block rises to one side and breaks off at the other: ledges that all face one way (shingled flakes, strata). Negative turns them round'
		}),
		P.float('dome', 'Face curvature', 0, -1.5, 1.5, {
			step: 0.001,
			section: 'Relief',
			hint: 'Domes the faces (above 0: boulders, pillows) or scoops them out (below 0: hollow, scalloped faces with sharp rims)'
		}),
		P.float('edge_w', 'Edge width', 0.08, 0, 1.5, {
			step: 0.001,
			section: 'Relief',
			hint: 'How far the edges fall away into each face, as a share of the block: small = flat tops with narrow chamfers, 1 = the whole face in facets rising to a ridge'
		}),
		P.float('edge_drop', 'Edge drop', 0.6, 0, 2, {
			step: 0.001,
			section: 'Relief',
			hint: 'How deep the edges fall (in relief): the depth of the V between neighbouring blocks'
		}),
		P.float('edge_round', 'Edge rounding', 0.1, 0, 1, {
			step: 0.001,
			section: 'Relief',
			hint: 'Shapes the edges: 0 = flat facets meeting in sharp ridges (split, angular stone), 1 = rounded, worn shoulders'
		}),
		P.float('scarp', 'Ledge run', 4, 0.5, 128, {
			softMax: 32,
			unit: 'px',
			step: 0.05,
			section: 'Relief',
			hint: 'How far a taller block’s side runs out over its neighbour per unit of height: small = sheer ledges, large = slopes'
		}),
		P.float('steps', 'Ledge steps', 0.35, 0, 1, {
			step: 0.001,
			section: 'Relief',
			hint: 'Breaks the ledges into thin stepped layers (flaky edges) instead of one slope'
		}),
		P.float('step_px', 'Step width', 2.5, 0.5, 32, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			section: 'Relief',
			showIf: (p) => Number(p.steps) > 0,
			hint: 'The run of each step of a ledge'
		}),
		// ---------------------------------------------------------------- Facets & layers
		P.float('facets', 'Facets', 0.6, 0, 1, {
			step: 0.001,
			section: 'Facets & layers',
			hint: 'The chance of each of up to three chipped planes cutting a block’s face at any angle: angular faces of a few planes meeting in ridges (0 = faces fall away only at their edges)'
		}),
		P.float('facet_slope', 'Facet slope', 1, 0, 4, {
			softMax: 2.5,
			step: 0.001,
			section: 'Facets & layers',
			showIf: (p) => Number(p.facets) > 0,
			hint: 'How steeply the facets fall away, in relief per block'
		}),
		P.float('facet_size', 'Facet size', 0.5, 0, 1, {
			step: 0.001,
			section: 'Facets & layers',
			showIf: (p) => Number(p.facets) > 0,
			hint: 'How much of a block each facet takes: small = chipped edges and corners, 1 = a few big planes meeting in ridges across the whole face'
		}),
		P.int('rims', 'Rim steps', 1, 0, 4, {
			section: 'Facets & layers',
			hint: 'Breaks each block’s top face back toward its edges in this many steps (0.6 × Layer thickness each), at wavering distances from them, bevelled like the sheets: big faces broken back at the rim'
		}),
		P.float('rim_w', 'Rim width', 0.22, 0.05, 1, {
			step: 0.001,
			section: 'Facets & layers',
			showIf: (p) => Number(p.rims) > 0,
			hint: 'How far in from a block’s edges its rim steps reach, as a share of the way to its middle (so small blocks keep their tops)'
		}),
		P.int('layers', 'Layers', 2, 0, 8, {
			section: 'Facets & layers',
			hint: 'How many levels of stacked sheets the faces are built from: broad plates at several heights, each stepping down to the next with a bevelled edge that takes the Edge card’s Bevel and Profile (0 = none)'
		}),
		P.float('layer_t', 'Layer thickness', 0.45, 0.02, 2, {
			softMax: 1,
			step: 0.001,
			section: 'Facets & layers',
			showIf: (p) => Number(p.layers) > 0,
			hint: 'How far each sheet stands above the next, in relief (Edge drop is about one block edge’s fall)'
		}),
		P.float('layer_scale', 'Sheets across a block', 1.3, 0.5, 12, {
			softMax: 6,
			step: 0.01,
			section: 'Facets & layers',
			showIf: (p) => Number(p.layers) > 0,
			hint: 'The size of the pieces the sheets are broken into (about this many across a block): neighbouring pieces at one level join into broad plates'
		}),
		P.float('layer_waver', 'Layer waver', 0.5, 0, 1.5, {
			step: 0.001,
			section: 'Facets & layers',
			showIf: (p) => Number(p.layers) > 0,
			hint: 'How far the sheets’ edges wander from straight lines: 0 = straight-sided pieces, 1 = ragged, wavering steps'
		}),
		P.float('layer_tilt', 'Sheet tilt', 1, 0, 4, {
			softMax: 2.5,
			step: 0.001,
			section: 'Facets & layers',
			showIf: (p) => Number(p.layers) > 0,
			hint: 'Tilts each sheet its own way, so the plates slope and their steps rise and fade along their edges (0 = level plates)'
		}),
		P.float('layer_cup', 'Sheet curvature', 0, -1.5, 3, {
			softMax: 1.5,
			step: 0.001,
			section: 'Facets & layers',
			showIf: (p) => Number(p.layers) > 0,
			hint: 'Scoops each sheet into a cup rising to sharp rims where it meets its neighbours (above 0: scalloped sandstone, honeycomb weathering), or domes it (below 0: pillowy plates); in layers'
		}),
		P.float('layer_break', 'Layer breakup', 0.2, 0, 1.5, {
			step: 0.001,
			section: 'Facets & layers',
			showIf: (p) => Number(p.layers) > 0,
			hint: 'Mixes each piece’s own random into its level: 0 = broad plates whose levels follow a smooth swell, 1 = a jumble of plates at their own levels'
		}),
		// ---------------------------------------------------------------- Flakes
		P.int('detail', 'Flake levels', 0, 0, 3, {
			section: 'Flakes',
			hint: 'Finer generations of the same fractured blocks laid over the faces: crumpled, shingled rock (0 = smooth blocks)'
		}),
		P.float('detail_scale', 'Flake scale', 2.6, 1.5, 6, {
			step: 0.01,
			uniform: false,
			section: 'Flakes',
			showIf: (p) => Number(p.detail) > 0,
			hint: 'How many times smaller each flake level is than the one before'
		}),
		P.float('detail_amt', 'Flake relief', 0.25, 0, 2, {
			step: 0.001,
			section: 'Flakes',
			showIf: (p) => Number(p.detail) > 0,
			hint: 'How strongly the flakes stand out (their relief follows their size)'
		}),
		P.float('flake_run', 'Flake ledge run', 16, 0.5, 128, {
			softMax: 32,
			unit: 'px',
			step: 0.05,
			section: 'Flakes',
			showIf: (p) => Number(p.detail) > 0,
			hint: 'How far a flake’s side runs out per unit of height: large = soft facets that meet in creases, small = sharp flaky steps that cast thin shadows (crumpled, shingled rock)'
		}),
		P.float('zones', 'Facet breakup', 0.5, 0, 1, {
			step: 0.001,
			section: 'Flakes',
			hint: 'Varies the flakes and grain over the rock: smooth, whole faces beside shattered, crumbly ones'
		}),
		// ---------------------------------------------------------------- Surface
		...roughnessParams(0.08, 2),
		P.float('pits', 'Pits', 0, 0, 1, {
			step: 0.001,
			section: 'Surface',
			hint: 'Small round pits and vugs over the faces, in three sizes, more of them in the broken patches (Facet breakup; porous, pitted rock; 1 = crowded)'
		}),
		P.float('pit_size', 'Pit size', 3, 0.5, 32, {
			softMax: 12,
			unit: 'px',
			step: 0.05,
			section: 'Surface',
			showIf: (p) => Number(p.pits) > 0,
			hint: 'The radius of the biggest pits (the others are a half and a quarter of it)'
		}),
		// ---------------------------------------------------------------- Cracks
		P.float('crack', 'Crack width', 2, 0, 32, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			section: 'Cracks',
			hint: 'The width of the open cracks between blocks and along splits'
		}),
		P.float('crack_open', 'Open cracks', 0.45, 0, 1, {
			step: 0.001,
			section: 'Cracks',
			hint: 'The share of the joints between blocks that open into a crack (the others meet in a closed crease)'
		}),
		P.float('crack_var', 'Crack variation', 0.6, 0, 1, {
			step: 0.001,
			section: 'Cracks',
			hint: 'Varies the cracks’ widths, from crack to crack and along each one'
		}),
		P.float('crack_depth', 'Crack depth', 0.4, 0, 2, {
			step: 0.001,
			section: 'Cracks',
			hint: 'How deep the cracks cut (in relief)'
		}),
		P.float('hair', 'Fractures', 0.12, 0, 1, {
			step: 0.001,
			section: 'Cracks',
			hint: 'The share of the flakes’ creases that open as hairline fractures across the faces (needs Flake levels)'
		}),
		P.float('hair_break', 'Fracture breakup', 0.5, 0, 1, {
			step: 0.001,
			section: 'Cracks',
			showIf: (p) => Number(p.hair) > 0,
			hint: 'Fades the fractures in and out along their length, so they end in points instead of running on'
		}),
		P.float('crev_reach', 'Crevice reach', 4, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			section: 'Cracks',
			hint: 'How far the Crevices mask (Write to › Source) fades out from the creases and cracks'
		}),
		// What goes to the mask: picked by Write to › Source, not shown.
		P.enum(
			'mask_feat',
			'Mask features',
			'blocks',
			[
				['blocks', 'Blocks'],
				['crevices', 'Crevices'],
				['fractures', 'Fractures'],
				['ledges', 'Ledges'],
				['plates', 'Plates']
			],
			{ showIf: () => false, optimize: false }
		),
		PX_SCALE_PARAM,
		P.seed()
	],
	defaults: {
		bevel: 0,
		aa: true,
		h_on: true,
		h_amount: 40,
		dif_on: true,
		dif_grad: reliefGrad()
	},
	// Added in the editor: relief that deepens with the blocks (40 at 512 px, five blocks across: rock relief is deep).
	fresh: ({ width, height }) => {
		const side = Math.sqrt(width * height);
		return {
			h_amount: Math.round(Math.max(3, Math.min(56, (40 * side) / 512)) * 10) / 10,
			detail: 0
		};
	},
	derivedUniforms: {
		decl: {
			steep: 'int',
			cell: 'vec4[4]',
			per: 'ivec4[4]',
			jag: 'vec4[4]',
			prof: 'float[9]'
		},
		compute: rockDerived
	},
	glsl:
		ORG_GLSL +
		/* glsl */ `
// A cell's seamless key. The frame's rows lean by m cells over the tile's width (pr = nx, ny, m): moving a whole width
// along x lands m rows further down, so cell (i + nx, j − m) is cell (i, j).
ivec2 rv_key(ivec2 c, ivec3 pr) {
  if (!uTile) return c;
  int I = c.x >= 0 ? c.x / pr.x : -((pr.x - 1 - c.x) / pr.x);
  return ivec2(c.x - I * pr.x, imod(c.y + I * pr.z, pr.y));
}

// How far a face has fallen d px in from a border whose edge is w px wide and drops by 'drop' there: linear (flat facets,
// whose maximum over the borders meets in sharp ridges) to quadratic (a rounded shoulder) by Edge rounding. y: its slope
// (relief per px), for the crease distance.
vec2 rv_edge(float d, float w, float drop, float r) {
  float iw = 1.0 / max(w, 1e-3);
  float x = clamp(1.0 - d * iw, 0.0, 1.0);
  return vec2(drop * mix(x, x * x, r), drop * iw * mix(1.0, 2.0 * x, r) * step(1e-6, x));
}

// px per unit of distance along the metric normal n (mt: the metric's x and y scales and the rows' lean; see gen).
float rv_px(vec2 n, vec3 mt) { return max(length(vec2(mt.x * n.x - mt.z * mt.y * n.y, mt.y * n.y)), 1e-4); }

// A block's splits and facets at x (metric px from its site; P its mean size). Splits: up to three straight chords, each
// through a point near the site at a random angle, a chain — only one side of each chord is split again. Returns the
// piece's height offset, the px distance to the nearest chord bounding the piece, and the piece's random (the block's
// when unsplit). Facets: up to three planes, each there by the Facets chance, chipping the face away beyond a line at a
// random angle near the site, falling Facet slope per block; the face is lowered by the deepest, so it reads as a few
// planes meeting in ridges at any angle (not only along its edges). chip: that depth and its slope (relief per px).
vec3 rv_split(ivec2 k, vec2 x, vec2 xf, float P, float chance, float fmul, vec3 mt, float seed, out vec2 chip) {
  // (x is taken with half the jaggies' warp: with all of it the chords and facet ridges bent into arcs, and a raised
  // piece between two of them stood as a pinched bow-tie; with none they read as ruled lines.)
  // On elongated blocks (strata) most chords run along the cleavage: an arrow-straight crack across the beds reads false.
  float eb = clamp(abs(log(mt.y / mt.x)) / 1.1, 0.0, 0.85);
  float off = 0.0, dmin = 1e4;
  float id = hashI(k, seed + 3.0);
  chip = vec2(0.0);
  bool live = chance > 0.0;
  float aP = 0.0;
  for (int i = 0; i < 3 * UNI_1; i++) {
    vec4 h = vec4(hash3I(k + ivec2(i * 131, 71), seed + 5.0), hashI(k + ivec2(i * 131, 71), seed + 9.0));
    // The first chord with the Splits chance, each next one a little less likely.
    live = live && fract(h.w * 13.7) < chance * (1.0 - 0.25 * float(i));
    if (live) {
      // (Spread over the block: chords kinked near its site all met there in a star.)
      vec2 c = (h.xy - 0.5) * 0.9 * P;
      // (Each next chord at least 30° off the one before: near-parallel chords stood as ladders.)
      float a = fract(h.w * 7.77) < eb ? (mt.y > mt.x ? 0.5 * PI : 0.0) + (h.z - 0.5) * 0.5
              : i == 0 ? h.z * PI : aP + (0.17 + 0.66 * h.z) * PI;
      aP = a;
      vec2 n = vec2(cos(a), sin(a));
      // Kinked at c into two runs 25–50° apart (the nearer of the two half-planes' borders), not a ruled line.
      float kk = (0.44 + 0.44 * fract(h.w * 3.31)) * 0.5;
      vec2 na = vec2(cos(a + kk), sin(a + kk)), nb = vec2(cos(a - kk), sin(a - kk));
      float sd = fract(h.w * 5.17) < 0.5 ? max(dot(x - c, na), dot(x - c, nb)) : min(dot(x - c, na), dot(x - c, nb));
      dmin = min(dmin, abs(sd) / rv_px(n, mt));
      bool side = sd > 0.0;
      id = fract(id * 7.13 + (side ? 0.37 : 0.71));
      off += (side ? 1.0 : -1.0) * (0.06 + 0.1 * h.w);
      // Only one side splits again.
      live = side == (h.w < 0.5);
    }
    vec4 hc = vec4(hash3I(k + ivec2(i * 131, 211), seed + 53.0), hashI(k + ivec2(i * 131, 211), seed + 57.0));
    if (hc.w < u_facets) {
      float a = TAU * hc.x;
      vec2 n = vec2(cos(a), sin(a));
      float s = u_facet_slope * (0.5 + hc.z) / P;
      // (Facet size: where the plane meets the face, from near the far edge to past the middle.)
      // (xf: without the jaggies' warp, so a facet is a true plane meeting the others in straight, crisp ridges.)
      float cut = s * (dot(xf, n) - (0.42 - 0.5 * u_facet_size + 0.25 * (hc.y - 0.5)) * P);
      if (fmul * cut > chip.x) chip = vec2(fmul * cut, fmul * s * rv_px(n, mt));
    }
  }
  return vec3(off, dmin, id);
}

// The Edge card's Profile at x (0 … 1) from nine samples (rockDerived): a lookup, not the profile's branches inlined at
// every call.
float rv_prof(float x) {
  float u = clamp(x, 0.0, 1.0) * 8.0;
  int i = min(int(u), 7);
  return mix(d_prof[i], d_prof[i + 1], u - float(i));
}

// Layers: the faces are stacked sheets. A second, finer power diagram (Sheets across a block, its edges wandering by
// Layer waver) whose cells are the sheets: each stands a whole number of Layer thickness down (one of Layers levels),
// picked by a smooth noise at its site — so neighbouring cells mostly share a level and join into broad plates whose
// outlines run along the cells' ragged edges — with the cell's own random mixed in by Layer breakup; each tilts a little
// its own way. Where a sheet stands over the one next to it, its edge falls to it in a step: the whole rise bevelled over
// the Edge card's Bevel in its Profile (else a chamfer about 0.3 × the rise, 3 px at least), never steeper than 2 px of rise per px; the lower sheet runs
// flat to the border, so the two meet there. Of the steps to the two cells across the nearest borders, the lower (a
// corner takes both). Not cut by level per pixel: slicing a curved face at equal depths drew contour rings. Returns the
// relief to add, the px distance to the nearest step (for Plates) and the sheet's level.
// The cells are laid in the blocks' frame (g: the pixel in sheet cells, csS their size in frame px, pr their counts and
// lean when tiling), so on elongated blocks the sheets stretch and lean along the cleavage too; their noises are taken on
// the screen (p), which tiles whatever the lean.
vec3 rv_sheets(vec2 p, vec2 g, vec2 csS, float t, ivec3 pr, bool steep, vec2 jb, float px) {
  // (Ragged at the sheets' own scale too: with the jaggies' noise alone they wandered only at a block's scale, and read
  // as straight-sided panels.)
  vec2 fc = snapCells(1.5 * uRes / sqrt(csS.x * csS.y));
  vec2 jf = fbmPair(p * fc / uRes, p * fc / uRes + 9.1, periodOf(fc), 2, uSeed + 713.0, uSeed + 717.0, 2) - 0.5;
  // (Not folded into kinks, |n|, as the rims are: sheets broke into bubbly fragments.)
  vec2 x = g + u_layer_waver * (0.8 * jb + 0.3 * jf);
  ivec2 ip = ivec2(floor(x));
  // (Sized like the blocks, by Size variation; the 5 × 5 search holds the weights. A 3 × 3 one missed the nearest site
  // where a weight or the waver reached past it: straight one-pixel cliffs along the grid.)
  // (Less spread than the blocks': tiny sheets stood as pimples and pits.)
  float wS = 0.3 * u_size_var;
  float b1 = 1e9, b2 = 1e9, b3 = 1e9, b4 = 1e9;
  vec2 s1 = vec2(0.0), s2 = s1, s3 = s1, s4 = s1;
  float z1 = 0.0, z2 = 0.0, z3 = 0.0, z4 = 0.0;
  for (int e = 0; e < 25 * UNI_1; e++) {
    ivec2 c = ip + ivec2(e % 5 - 2, e / 5 - 2);
    vec3 h = hash3I(rv_key(c, pr), uSeed + 701.0);
    vec2 st = vec2(c) + h.xy;
    vec2 r = st - x;
    float pw = dot(r, r) - (fract(h.z * 9.17) - 0.5) * wS;
    if (pw < b1) { b4 = b3; s4 = s3; z4 = z3; b3 = b2; s3 = s2; z3 = z2; b2 = b1; s2 = s1; z2 = z1; b1 = pw; s1 = st; z1 = h.z; }
    else if (pw < b2) { b4 = b3; s4 = s3; z4 = z3; b3 = b2; s3 = s2; z3 = z2; b2 = pw; s2 = st; z2 = h.z; }
    else if (pw < b3) { b4 = b3; s4 = s3; z4 = z3; b3 = pw; s3 = st; z3 = h.z; }
    else if (pw < b4) { b4 = pw; s4 = st; z4 = h.z; }
  }
  // Each of the three: its level (noise about two sheets across, its usual 0.2 … 0.8 stretched to 0 … 1, and the
  // breakup) and its height at the pixel with its tilt.
  vec2 nc = snapCells(0.5 * uRes / sqrt(csS.x * csS.y));
  float nl = float(max(u_layers, 1));
  float tau = u_layer_t;
  vec2 cpx = csS;
  bool prof = u_bevel > 0.0 && u_profile != 0;
  float capK = 2.0 * abs(u_h_amount) * uDepth * 0.125;
  // The borders with the second, third and fourth (cells → px). (Three of them: a step's bevel reaches a fifth of a
  // sheet in, and a sheet that only joined the nearest three partway through it made the surface jump.)
  vec3 dd;
  for (int j = 0; j < 3; j++) {
    vec2 dn = (j == 0 ? s2 : j == 1 ? s3 : s4) - s1;
    float ln = max(length(dn), 1e-6);
    dd[j] = ((j == 0 ? b2 : j == 1 ? b3 : b4) - b1) / (2.0 * ln) * length(dn / ln * cpx);
  }
  float d2 = dd.x, d3 = dd.y;
  float cell = sqrt(cpx.x * cpx.y);
  // Sheet curvature: a cup (or dome) over the sheet, rising to rims where it meets its neighbours — by the distance to
  // its nearest border against about half a piece; a neighbour's at its border, so the two meet there.
  float cup = u_layer_cup * tau;
  float uc = clamp(min(d2, d3) / (0.45 * length(cpx) * 0.7071), 0.0, 1.0);
  float S1 = 0.0, lv1 = 0.0, out1 = 0.0, dStep = 1e4;
  for (int j = 0; j < 4 * UNI_1; j++) {
    vec2 st = j == 0 ? s1 : j == 1 ? s2 : j == 2 ? s3 : s4;
    float z = j == 0 ? z1 : j == 1 ? z2 : j == 2 ? z3 : z4;
    // (The site on the screen: frame px from the sheared cells, axes swapped back on steep frames.)
    float fx = st.x * csS.x;
    vec2 sf = vec2(fx, st.y * csS.y + t * fx);
    float N = valueNoise((steep ? sf.yx : sf) * nc / uRes, periodOf(nc), uSeed + 709.0);
    float q = clamp((N - 0.2) / 0.6 + u_layer_break * (z - 0.5), 0.0, 0.999);
    float lv = floor(q * nl);
    // (Centred on the middle level, so more layers don't sink the whole face down the colour ramp.)
    // (Tilted enough that a step between two sheets can taper out along their border: steps end, plates aren't
    // closed cells.)
    // (Each sheet a little off its level, so the steps differ in height: equal ones cast a plaid of equal bars.)
    float S = -tau * (lv - 0.5 * (nl - 1.0) + 0.3 * (fract(z * 13.3) - 0.5))
            - max(tau, 0.3) * 2.0 * u_layer_tilt * dot(vec2(fract(z * 23.7), fract(z * 41.3)) - 0.5, x - st)
            + cup * ((j == 0 ? (1.0 - uc) * (1.0 - uc) : 1.0) - 0.33);
    if (j == 0) { S1 = S; lv1 = lv; out1 = S; }
    else {
      // The step down to it, if it is lower.
      float d = j == 1 ? dd.x : j == 2 ? dd.y : dd.z;
      float rise = S1 - S;
      // (The default chamfer about 0.3 × the step's rise in true px, 3 px at least — crisp, not a feathered smudge —
      // and never past a fifth of a sheet: see above.)
      float w = min(max(prof ? u_bevel : 3.0 * px, rise * capK * (prof ? 1.0 : 0.6)), max(0.2 * cell, 2.0 * px));
      float t = clamp(d / w, 0.0, 1.0);
      if (rise > 0.0) out1 = min(out1, S + rise * (prof ? rv_prof(t) : t));
      if (lv != lv1) dStep = min(dStep, d);
    }
  }
  // (Faded out where the sheets get small: under ~20 px they were a staircase noise over the whole texture.)
  return vec3(out1 * smoothstep(10.0 * px, 22.0 * px, cell), dStep, lv1);
}

// A ledge's fall D px out from its block's border: D / run, or with a Bevel its first Bevel px in the Profile (the same
// fall over them), so every ledge's top edge takes the bevel.
float rv_fall(float D, float run) {
  if (u_bevel <= 0.0 || u_profile == 0) return D / run;
  float b = u_bevel;
  return D < b ? b / run * (1.0 - rv_prof(1.0 - D / b)) : D / run;
}

// A crack's cut at d px from its middle, w px wide: a V reaching 1 at the middle, never narrower than 2 px across, and
// fading with its width under that (a 1 px V aliased into a staircase of single dark pixels on a diagonal: zippers).
float rv_cut(float d, float w, float px) {
  return clamp(1.0 - d / (0.5 * max(w, 2.0 * px) + 0.5 * px), 0.0, 1.0) * min(w / (2.0 * px), 1.0);
}

// A block's edge drop (relief at its border): Edge drop × 0.4–1.6 by its own hash; a fused block's (Fused joints, blocks
// only) 8 % of it; flakes 0.6 of it, rubble the full drop.
float rv_drop(ivec2 k, float so, bool first, bool rubble) {
  float h = hashI(k, so + 19.0);
  bool fused = first && fract(h * 7.31) < u_fuse;
  return u_edge_drop * (0.4 + 1.2 * h) * (first ? (fused ? 0.08 : 1.0) : rubble ? 1.0 : 0.6);
}

GenOut gen(vec2 p) {
  bool steep = d_steep != 0;
  vec2 R = steep ? uRes.yx : uRes;
  vec2 q0 = steep ? p.yx : p;
  float px = max(u_px_scale, 1.0);
  int nS = 1 + clamp(u_detail, 0, 3);

  // Facet breakup: patches from a broad value noise (about two blocks across) that scales the flakes and grain, 0 … 2.
  vec2 zc = snapCells(uRes / (2.0 * d_cell[0].w));
  float zone = mix(1.0, 2.0 * smoothstep(0.2, 0.8, valueNoise(p * zc / uRes, periodOf(zc), uSeed + 401.0)), u_zones);

  // The sheets (rv_sheets: relief, px to the nearest step, level), set with the blocks.
  vec3 sh = vec3(0.0, 1e4, 0.0);

  float H = 0.0;
  // From the blocks (scale 0): the crease distance and its open crack's half width, the chord crack's distance, the
  // visible piece's random; and the masks' coverages.
  float dMain = 1e4, wMain = 0.0, dChord = 1e4, rnd = 0.0;
  float crev = 0.0, frac = 0.0, ledge = 0.0;
  // The blocks' jaggies' noise: it breaks the hairlines up over stretches of a block or so (a flake's own broke them into
  // dotted chains).
  vec2 jo0 = vec2(0.0);

  for (int o = 0; o < nS; o++) {
    vec4 cl = d_cell[o];
    ivec3 pr = d_per[o].xyz;
    vec4 jg = d_jag[o];
    bool first = o == 0;
    float so = uSeed + float(o) * 101.0;
    vec2 cs = cl.xy;
    float t = cl.z, Pc = cl.w;
    // A scale's relief: the blocks 1, flakes Flake relief × their size against the blocks' (and the zones).
    // (Domed faces keep them faint: boulders are smooth, not cobbles within cobbles.)
    float amp = first ? 1.0 : u_detail_amt * pow(Pc / d_cell[0].w, 0.75) * zone * (1.0 - 0.6 * clamp(u_dome, 0.0, 1.0));
    // Shattered blocks: the first flakes of a block picked by Shattered blocks become rubble — angular pieces (planar
    // edges, the full drop, no dome) standing out further and parted by cracks like the blocks'; not under ~10 px.
    bool shat = o == 1 && fract(rnd * 53.17 + 0.31) < u_rubble * smoothstep(8.0 * px, 12.0 * px, Pc);
    if (shat) amp *= 2.5;
    // Flakes are facets: their edges stay mostly planar whatever the blocks' rounding.
    float eRound = first ? u_edge_round : shat ? 0.0 : 0.3 * u_edge_round;
    // Ledges: a block's run is Ledge run, a flake's Flake ledge run (per unit of its own relief, so smaller flakes have
    // gentler sides) — never steeper than about 4 px of world height per px (through the Height amount and the project's
    // depth, the value rising half as fast as the relief): a sheer one-pixel cliff aliases into a dotted lip under a low
    // light.
    float capK = abs(u_h_amount) * uDepth * 0.125 * amp;
    float run = max(first ? u_scarp : u_flake_run, capK);
    // Rim steps (the blocks only): how many, each's fall, all of them (a neighbour's face at its border).
    int nRim = first ? clamp(u_rims, 0, 4) : 0;
    float tauR = 0.6 * u_layer_t;
    float rimAll = tauR * float(nRim);
    bool prof = u_bevel > 0.0 && u_profile != 0;

    // Jagged edges: the pixel moves by a two-octave Perlin offset (frame px), about Jaggedness × a block's size.
    vec2 jx = q0 * jg.xy / R;
    vec2 jo = fbmPair(jx, jx + 17.3, periodOf(jg.xy), 2, so + 11.0, so + 23.0, 2) - 0.5;
    // (The ledges' run wanders along them with the jaggies' noise, ± a third: constant-width skirts read as fillets.)
    run = max(run * (1.0 + 0.9 * jo.y), capK);
    if (first) {
      jo0 = jo;
      // (The sheets' edges wander on the jaggies' noise: one noise call.)
      if (u_layers > 0) {
        // (Whole sheets per block when tiling, so their cells close round the tile with the blocks' lean.)
        int Ls = max(int(u_layer_scale + 0.5), 1);
        float ls = uTile ? float(Ls) : u_layer_scale;
        vec2 csS = cs / ls;
        sh = rv_sheets(p, vec2(q0.x / csS.x, (q0.y - t * q0.x) / csS.y), csS, t, ivec3(pr.xy * Ls, pr.z * Ls), steep, jo, px);
      }
    }
    vec2 q = q0 + u_jag * Pc * 0.8 * jo;
    vec2 g = vec2(q.x / cs.x, (q.y - t * q.x) / cs.y);
    ivec2 ig = ivec2(floor(g));
    // The diagram is plain (isotropic) in the cells' own metric — grid units × the mean size Pc — so elongated cells
    // come out elongated (jittered sites alone stay statistically round). mt: the metric's scales against the frame's px
    // and the rows' lean; a distance d along the metric normal n is d / rv_px(n, mt) px.
    vec3 mt = vec3(Pc / cs.x, Pc / cs.y, t);
    // The jaggies' warp in the metric (what moves a face point when the pixel moves from q0 to q).
    vec2 dq = q - q0;
    vec2 wq = vec2(dq.x / cs.x, (dq.y - t * dq.x) / cs.y) * Pc;
    // (Weights past about 0.7 of a cell² let a big block's neighbours fall outside the 5 × 5 round its site: shards.)
    float wS = u_size_var * Pc * Pc * (first ? 0.7 : 0.4);
    // The common dip: faces rise across the cleavage towards the frame's −y, so every block breaks off on that side.
    vec2 dipV = vec2(0.0, -u_dip);

    // The three nearest sites (power distance), then every cell round the nearest as a mesa.
    float b1 = 1e20, b2 = 1e20, b3 = 1e20;
    vec2 r1 = vec2(0.0), r2 = vec2(0.0), r3 = vec2(0.0);
    ivec2 c1 = ig, c2 = ig, c3 = ig, k1 = ig;
    // Own face: top plane, piece offset, chord distance, piece random; its edges' fall and slope; its depth below its
    // top from facets and curvature (and the slope).
    float T1 = 0.0, o1 = 0.0, dch1 = 1e4, fr1 = 0.0;
    vec2 cham = vec2(0.0), dep1 = vec2(0.0);
    ivec2 kOwn = ig;
    // The two highest neighbouring mesas: height, key, piece random.
    float mA = -1e9, mB = -1e9, rA = 0.0;
    ivec2 kA = ig, kB = ig;
    // The own block's two nearest borders (px): near both is a junction, where cracks open wider.
    float bd1 = 1e4, bd2 = 1e4, rhoE = 1e4;
    for (int e = 0; e < 50 * UNI_1; e++) {
      bool near = e < 25;
      int f = near ? e : e - 25;
      ivec2 c = (near ? ig : c1) + ivec2(f % 5 - 2, f / 5 - 2);
      ivec2 k = rv_key(c, pr);
      vec3 h = hash3I(k, so);
      vec2 dg = vec2(c) + h.xy - g;
      vec2 r = dg * Pc;
      float pw = dot(r, r) - (h.z - 0.5) * wS;
      if (near) {
        if (pw < b1) {
          b3 = b2; r3 = r2; c3 = c2;
          b2 = b1; r2 = r1; c2 = c1;
          b1 = pw; r1 = r; c1 = c; k1 = k;
        }
        else if (pw < b2) { b3 = b2; r3 = r2; c3 = c2; b2 = pw; r2 = r; c2 = c; }
        else if (pw < b3) { b3 = pw; r3 = r; c3 = c; }
      } else {
        bool own = c == c1;
        // A fused block (Fused joints) takes its height from its cluster (3 × 3 cells) and hardly tilts: fused
        // neighbours stand level as one big mass among the small pieces (with their own heights, a paving of equal
        // pillows).
        bool fz = first && fract(hashI(k, so + 19.0) * 7.31) < u_fuse;
        vec3 hb = hash3I(k, so + 7.0);
        if (fz) hb = vec3(hashI(ivec2(floor(vec2(k) / 3.0)), so + 7.5), hb.y, 0.12);
        float L1 = max(length(r - r1), 1e-4);
        // Distance to the border with the own block (> 0 on the pixel's side), and a lower bound on the distance to this
        // block's cell — the farthest of its borders with the three nearest sites, so it doesn't jump across their edges.
        vec2 n1 = (r - r1) / L1;
        float dm = own ? 0.0 : (pw - b1) / (2.0 * L1);
        float d1 = dm / rv_px(n1, mt);
        vec2 rr2 = r - r2, rr3 = r - r3;
        float L2 = max(length(rr2), 1e-4), L3 = max(length(rr3), 1e-4);
        // The distance to this block's cell: outside its borders with the nearest site and with the second (or
        // third), the distance to the wedge they bound — to a border where the pixel projects onto the wedge's side,
        // else to its corner — the larger of the two wedges' (each a lower bound, so the larger is continuous). The
        // larger of the line distances alone fell short off a corner: skirts spilled furthest there and drew tall
        // blocks as stars with concave sides.
        float Dm = dm;
        for (int w = 0; w < 2; w++) {
          bool use = !own && (w == 0 ? c != c2 : c != c3);
          float L = w == 0 ? L2 : L3;
          vec2 nw = (w == 0 ? rr2 : rr3) / L;
          float dw = (pw - (w == 0 ? b2 : b3)) / (2.0 * L);
          float cc = dot(n1, nw);
          float dk = use ? max(dm, dw) : dm;
          if (use && dm > 0.0 && dw > 0.0 && dm - cc * dw > 0.0 && dw - cc * dm > 0.0)
            dk = sqrt(max((dm * dm + dw * dw - 2.0 * cc * dm * dw) / max(1.0 - cc * cc, 1e-3), 0.0));
          Dm = max(Dm, dk);
        }
        float D = Dm / rv_px(n1, mt);
        // The own face at the pixel; a neighbour's at its border point nearest the pixel.
        vec2 x = own ? -r : n1 * dm - r;
        float ta = TAU * hb.y;
        // The dome's (or scoop's) middle sits off the site: a boulder bulges towards the side its face tilts down to,
        // a scooped face is deepest just under its high rim. The curve levels off far from its middle (bounded), or a
        // scoop's far corners stood as flat plateaus at the top of the range.
        vec2 xd = x + 0.3 * Pc * sign(u_dome) * vec2(cos(ta), sin(ta));
        // The curvature as a depth below the face's top (a dome falls away from its middle, a scoop towards it), so
        // the layers step down it too.
        float dmv = shat ? 0.0 : u_dome;
        float gx = exp(-2.2 * dot(xd, xd) / (Pc * Pc));
        vec2 dome = 0.9 * abs(dmv) * vec2(dmv > 0.0 ? 1.0 - gx : gx, 4.4 * length(xd) / (Pc * Pc) * gx);
        // (Flakes differ more by tilt than by height: facets rather than terraces.)
        float Tc = u_heights * (first ? 1.0 : 0.6) * (hb.x - 0.5)
                 + dot(u_tilt * (first ? 1.0 : 1.4) * hb.z * vec2(cos(ta), sin(ta)) + dipV, x) / Pc
                 + (dmv > 0.0 ? 0.5 : 0.4) * abs(dmv);
        vec2 chip;
        // (A fused block's facets a third as deep: they cut V's into the fused masses.)
        vec3 fr = rv_split(k, x - 0.5 * wq, x - wq, Pc, first ? u_splits : 0.0, fz ? 0.3 : 1.0, mt, so, chip);
        vec2 dep = chip + dome;
        if (own) {
          T1 = Tc; o1 = fr.x; dch1 = fr.y; fr1 = fr.z; kOwn = k; dep1 = dep;
        } else {
          // Each block's edges all drop by the block's own amount (a fused block's — Fused joints — hardly at all, so
          // clusters of them read as one mass parted by faint creases). So at any point of a block's border no other
          // edge of it falls further, and a neighbour's face there is exactly its plane less its drop: its skirt
          // starts where its face ends. (With a drop per pair of blocks, a corner's other edge could fall further and
          // the skirt stood above the face it hangs from: a bright bead along the border.) The edge's width is the
          // pair's.
          bool aLo;
          float ew = max(u_edge_w * Pc * (0.7 + 0.6 * hashI(pairKey(k1, k, aLo), so + 13.0)), px);
          if (d1 < bd1) { bd2 = bd1; bd1 = d1; } else if (d1 < bd2) bd2 = d1;
          // Rim steps: how far in, as a share of the way to the site, per edge — each edge its own inset (some steps
          // hug their edge, some reach deep), the lowest over the edges: angular, open runs, not a shrunk copy.
          float me = 0.45 + 5.0 * pow(hashI(pairKey(k1, k, aLo), so + 47.0), 3.0);
          float ds1 = length(vec2(r1.x / mt.x, r1.y / mt.y));
          rhoE = min(rhoE, d1 / max(d1 + ds1, 1e-3) * me);
          vec2 ed = rv_edge(d1, ew, rv_drop(k1, so, first, shat), eRound);
          if (ed.x > cham.x) cham = ed;
          float drop = rv_drop(k, so, first, shat);
          // Its skirt over the pixel, falling one unit per run px (in flaky steps by Ledge steps, each block its own
          // phase and step, measured from the border so the skirt starts at the face).
          float sp = u_step_px * (0.75 + 0.5 * hb.z);
          // (Wavering along the edge with the jaggies' noise: steps at an even distance from it read as contour lines.)
          float sx = D / sp + hb.y + 1.5 * jo.x;
          float sx0 = hb.y + 1.5 * jo.x;
          float st0 = floor(sx0) + smoothstep(0.65, 1.0, fract(sx0));
          // (Steps only where the ledge is steep: on a long, gentle run they drew contour rings.)
          float Ds = mix(D, sp * (floor(sx) + smoothstep(0.65, 1.0, fract(sx)) - st0), u_steps * smoothstep(16.0, 6.0, run));
          // A skirt steepens past about a fifth of a block from its border, so skirts closing in from every side
          // don't swallow a low block into a pinched, concave-sided star.
          Ds += max(D - 0.2 * Pc, 0.0) * max(D - 0.2 * Pc, 0.0) / (0.1 * Pc);
          // (And where a split of it meets the border, the split's own fall to its floor.)
          drop = max(drop, rv_edge(fr.y, max(u_edge_w * Pc * 0.4, px), u_edge_drop * 0.5 + fr.x, eRound).x);
          // Its face at the border point (facets, curvature and the edge's full drop below its top: the same as its
          // own face computes there, so the skirt starts where the face ends), less its skirt.
          // (A fused block has no rim steps: they dipped every fused joint into a V.)
          float M = Tc + fr.x - dep.x - drop - (fz ? 0.0 : rimAll) - rv_fall(Ds, run);
          if (M > mA) { mB = mA; kB = kA; mA = M; kA = k; rA = fr.z; }
          else if (M > mB) { mB = M; kB = k; }
        }
      }
    }
    // The own face: its splits fall to a common floor at each chord (the piece's offset in the drop), so the pieces meet
    // there whatever their heights; facets, curvature and chamfers below its top.
    vec2 chc = rv_edge(dch1, max(u_edge_w * Pc * 0.4, px), u_edge_drop * 0.5 + o1, eRound);
    if (chc.x > cham.x) cham = chc;
    // Rim steps: the block's outer band (Rim width) falls in Rim steps steps of a Layer thickness each toward its edges,
    // each step at its own distance from them, wavering along them with the jaggies' noise (each step its own mix of
    // its two parts) — a big top face broken back at its rim, not bands at an even distance. At the border all of them
    // are down, so a neighbour's face there (rimAll) is its plane less them all: its skirt starts where its face ends.
    // Measured as a share of the way in from the edge to the block's site (rho: 0 at the border, 1 at the site), so a
    // small block keeps its top (a fixed width in px sank small blocks whole: round pits). The waver adds a noise about
    // a quarter of a block across to the jaggies' (straight runs of shadow otherwise).
    float rim = 0.0;
    if (nRim > 0 && !(fract(hashI(kOwn, so + 19.0) * 7.31) < u_fuse)) {
      float ds = length(vec2(r1.x / mt.x, r1.y / mt.y));
      float span = max(bd1 + ds, 1e-3);
      float rho = rhoE;
      vec2 wc = snapCells(4.0 * uRes / Pc);
      float wv = valueNoise(p * wc / uRes, periodOf(wc), so + 31.0) - 0.5;
      float wr = min(max(prof ? u_bevel : 4.0 * px, tauR * capK * 3.0), 0.4 * u_rim_w * span / float(nRim)) / span;
      for (int i = 0; i < 4 * UNI_1; i++) {
        if (i < nRim) {
          float wa = 2.4 * float(i) + 1.3;
          float fk = u_rim_w * float(nRim - i) / float(nRim)
                   * (1.0 + 1.0 * ((2.0 * abs(jo.x) - 0.4) * cos(wa) + (2.0 * abs(jo.y) - 0.4) * sin(wa))
                        + 0.8 * (2.0 * abs(wv) - 0.5) * cos(1.7 * wa));
          float tr = clamp((rho - fk) / max(wr, 1e-4), 0.0, 1.0);
          rim += tauR * (1.0 - (prof ? rv_prof(tr) : tr));
        }
      }
    }
    float F1 = T1 + o1 - dep1.x - cham.x - rim;
    // The surface is the highest mesa. The crease: where the top two meet, (difference) / (their slopes) px away.
    float sK = 1.0 / run;
    float M1, M2, s1, s2;
    ivec2 kT, kS;
    bool ownTop = F1 >= mA;
    // (The own face's slope with its facets and curvature: without them the crease's distance came out too long near
    // a facet, and a crack there shrank to single dark pixels.)
    float sF = cham.y + dep1.y;
    if (ownTop) { M1 = F1; s1 = sF; M2 = mA; s2 = sK; kT = kOwn; kS = kA; }
    else if (F1 >= mB) { M1 = mA; s1 = sK; M2 = F1; s2 = sF; kT = kA; kS = kOwn; }
    else { M1 = mA; s1 = sK; M2 = mB; s2 = sK; kT = kA; kS = kB; }
    float dcr = (M1 - M2) / max(s1 + s2, 1e-4);
    H += amp * M1 + (first ? sh.x : 0.0);

    // The joint's own randoms (order-free): open or closed, width.
    bool aLo;
    vec3 hj = hash3I(pairKey(kT, kS, aLo), so + 29.0);
    // Crack widths: each joint its own (mostly narrow, a few wide), pinching and swelling along it with the jaggies'
    // noise, and opening into wedges where blocks meet three at a time.
    float pinch = clamp(1.0 + 2.5 * u_crack_var * jo.x, 0.2, 2.0)
                * mix(1.0, 0.25 + 1.6 * hj.y * hj.y, u_crack_var)
                * (1.0 + 2.5 * u_crack_var * exp(-bd2 / (0.1 * Pc)));
    if (first) {
      // (A joint between two fused blocks never opens.)
      bool fused = fract(hashI(kT, so + 19.0) * 7.31) < u_fuse && fract(hashI(kS, so + 19.0) * 7.31) < u_fuse;
      bool open = !fused && hj.x < u_crack_open;
      float jw = open ? u_crack * pinch : 0.0;
      dMain = dcr;
      wMain = jw;
      dChord = ownTop ? dch1 : 1e4;
      rnd = ownTop ? fr1 : rA;
      // (Open cracks at 0 closes them too.)
      // (Narrow: wide slots read as brick courses; the pieces' levels part them.)
      float cw = ownTop && u_splits > 0.0 ? u_crack * 0.35 * pinch * min(4.0 * u_crack_open, 1.0) : 0.0;
      // Cracks: a V as deep as Crack depth, a pixel wide at least (thinner ones fade with their width).
      float cutM = jw > 0.0 ? rv_cut(dcr, jw, px) : 0.0;
      float cutC = cw > 0.0 ? rv_cut(dChord, cw, px) : 0.0;
      // (Narrow cracks are shallower: a hairline gap, not a trench.)
      H -= u_crack_depth * max(cutM * clamp(jw / (4.0 * px), 0.3, 1.0), cutC * clamp(cw / (4.0 * px), 0.3, 1.0));
      float reach = u_crev_reach;
      crev = max((open ? 1.0 : fused ? 0.2 : 0.55) * (1.0 - smoothstep(0.0, reach + 0.5 * jw, dcr)),
                 cw > 0.0 ? 1.0 - smoothstep(0.0, reach + 0.5 * cw, dChord) : 0.0);
      ledge = ownTop ? 0.0 : smoothstep(0.0, px, dcr);
    } else if (shat) {
      bool open = hj.x < 0.4 + 0.6 * u_crack_open;
      float jw = open ? 0.7 * u_crack * pinch : 0.0;
      float cut = jw > 0.0 ? rv_cut(dcr, jw, px) : 0.0;
      H -= 0.8 * u_crack_depth * cut;
      if (dcr < dMain) { dMain = dcr; wMain = jw; }
      crev = max(crev, (open ? 1.0 : 0.55) * (1.0 - smoothstep(0.0, u_crev_reach + 0.5 * jw, dcr)));
      ledge = max(ledge, ownTop ? 0.0 : smoothstep(0.0, px, dcr));
    } else {
      // Hairline fractures along a share of the flakes' creases, fading in and out along them: thin and shallow, lines
      // in the face rather than trenches.
      float brk = mix(1.0, smoothstep(0.35, 0.65, 0.5 + 1.6 * jo0.y), u_hair_break);
      // (Faded out on flakes under ~12 px, where they would break into dotted speckle.)
      float hw = max(0.6 * px, 0.3 * u_crack) * brk * smoothstep(6.0 * px, 14.0 * px, Pc);
      float cut = hj.x < u_hair ? rv_cut(dcr, hw, px) : 0.0;
      H -= u_crack_depth * 0.15 * cut;
      frac = max(frac, cut);
      ledge = max(ledge, ownTop ? 0.0 : smoothstep(0.0, px, dcr) * min(1.0, 2.0 * amp));
    }
  }

  // Surface grain: Perlin fBm over the faces, its size Grain size px.
  if (u_rough > 0.0) {
    vec2 gc = snapCells(uRes / max(u_rough_scale, 0.5));
    H += u_rough * 0.3 * zone * (org_noiseFbm(1, false, p * gc / uRes, periodOf(gc), 3, 0.55, uSeed + 503.0) - 0.5);
  }
  float v = 0.5 + 0.5 * tanh(H);
  // Pits: Worley cells about 2.4 pit radii across, in three sizes (each half the last); each cell holds a pit with the
  // Pits chance (more of them in Facet breakup's broken patches), a bowl with a crisp rim, about as deep as it is wide in true px
  // (through the Height amount and the project's depth). At 1 they crowd into a porous, vuggy surface.
  if (u_pits > 0.0) {
    for (int i = 0; i < 3 * UNI_1; i++) {
      float rad = u_pit_size * exp2(-float(i));
      vec2 pc = snapCells(uRes / (2.4 * rad));
      vec4 wv = worleyNoise(p * pc / uRes, periodOf(pc), 1.0, 0, uSeed + 601.0 + float(i) * 17.0);
      float rr = rad * (0.35 + 0.65 * wv.z * wv.z);
      float dpx = wv.x * uRes.x / pc.x;
      float keep = fract(wv.z * 31.7) < u_pits * clamp(0.4 + 0.6 * zone, 0.0, 1.0) ? 1.0 : 0.0;
      float x = clamp(dpx / rr, 0.0, 1.0);
      v -= keep * 0.8 * rr / max(abs(u_h_amount) * uDepth, 0.5) * (1.0 - x * x) * smoothstep(1.0, 0.85, x);
    }
    v = max(v, 0.0);
  }

  if (u_mask_feat == 1) return genOutOwn(v, clamp(crev, 0.0, 1.0), rnd, NO_SDF);
  if (u_mask_feat == 2) return genOutOwn(v, clamp(frac, 0.0, 1.0), rnd, NO_SDF);
  if (u_mask_feat == 3) return genOutOwn(v, clamp(ledge, 0.0, 1.0), rnd, NO_SDF);
  // Blocks: every visible piece parted at its crease and chord cracks (open cracks by their half width).
  float sd = max(0.5 * wMain - dMain, 0.35 * u_crack - dChord);
  if (u_mask_feat == 4) {
    // Plates: each sheet of each block (Layers) a feature of its own, parted at every step too.
    sd = max(sd, -sh.y);
    rnd = fract(rnd + 0.618034 * sh.z);
  }
  return genOutOwn(v, 1.0, rnd, sd);
}
`
};
