// Trim (FR7.2d): horizontal (or vertical) moulding strips built from up to six stacked profiled bands,
// optionally mirrored about the centre line, with repeating dividers and a row of rivets / bolts / slots /
// holes along the strip. Made for the many 256×16 / 256×32 trim textures, and — stacked several to a texture, or
// one band with a gap round it — for trim sheets and trim bands across larger walls. See greebleCommon.ts for the
// relief / SDF output convention.

import { P, gradient, halfPx, type ParamDef, type ParamValues } from '@/core/params';
import type { LayerDef } from '../types';
import { GRB_GLSL, ORIENT, ORIENT_ACROSS, ORIENT_ALONG } from './greebleCommon';

// Option order is the uniform's index (the GLSL tests it): only append.
export const BAND_PROFILES: [string, string][] = [
	['flat', 'Flat'],
	['bead', 'Bead (half round)'],
	['cove', 'Flute (concave channel)'],
	['ridge', 'Ridge (peak)'],
	['groove', 'Groove (V notch)'],
	['step', 'Step (bevelled plateau)'],
	['ramp_in', 'Chamfer rising inward'],
	['ramp_out', 'Chamfer falling inward'],
	['round_in', 'Quarter round rising inward'],
	['round_out', 'Quarter round falling inward'],
	['ogee_in', 'Ogee (S curve) rising inward'],
	['ogee_out', 'Ogee (S curve) falling inward'],
	['cove_in', 'Cove (concave quarter round) rising inward'],
	['cove_out', 'Cove (concave quarter round) falling inward']
];

// The default moulding, in a 16-unit half fitted to the strip (Fit bands) and joined (Join bands): a low lip, a bead
// rising from it, a cove up to a gently crowned face (the stretch band) with room above it for the heads.
const BAND_DEFAULTS: [number, string, number, number][] = [
	[2, 'flat', 0.2, 0],
	[4, 'bead', 0.82, 0.2],
	[2, 'cove_in', 0.42, 0.2],
	[8, 'bead', 0.54, 0.42],
	[0, 'flat', 0.5, 0],
	[0, 'flat', 0.5, 0]
];

const bandParams: ParamDef[] = BAND_DEFAULTS.flatMap(([h, prof, lvl, base], i) => {
	const n = i + 1;
	const on = (p: Record<string, unknown>) => Number(p[`band${n}`]) > 0 || Number(p.fill) === n;
	return [
		P.int(`band${n}`, `Band ${n}`, h, 0, 1024, {
			softMax: 64,
			unit: 'px',
			axis: ORIENT_ACROSS,
			group: 'bands',
			hint: n === 1 ? 'Band heights from the outer edge (top, or both edges when mirrored); 0 = unused' : undefined
		}),
		P.enum(`prof${n}`, `Band ${n} profile`, prof, BAND_PROFILES, { group: 'bands', showIf: on }),
		P.float(`level${n}`, `Band ${n} level`, lvl, 0, 1, {
			step: 0.001,
			group: 'bands',
			showIf: on,
			hint: n === 1 ? 'The profile’s high point (a flat band’s height)' : undefined
		}),
		P.float(`base${n}`, `Band ${n} base`, base, 0, 1, {
			step: 0.001,
			group: 'bands',
			showIf: (p) => on(p) && p[`prof${n}`] !== 'flat',
			hint:
				n === 1 || n === 2
					? 'The profile’s low point: it runs from Base up to Level. 0 sinks it to the bottom (a bead between dark creases); raise it to seat the profile on its neighbours'
					: undefined
		})
	];
});

const hasDiv = (p: Record<string, unknown>) => Number(p.div_count) > 0;
const hasElem = (p: Record<string, unknown>) => p.elem !== 'none';
const raisedElem = (p: Record<string, unknown>) =>
	['rivet', 'bolt', 'hex', 'screw', 'allen', 'cross', 'allen_sunk', 'hex_sunk'].includes(String(p.elem));
/** The situational note on element lengths while they scale with the bands. */
const fitNote = (p: Record<string, unknown>) =>
	p.elem_fit ? 'In the bands’ units: scaled with them (Scale with bands)' : undefined;
const holeElem = (p: Record<string, unknown>) => ['slot', 'vslot', 'hole', 'square'].includes(String(p.elem));

/** Default colour: worn brass, dark in the seams and creases, bright on the beads and heads. */
const TRIM_RAMP = gradient('#15110c', '#43372a', '#76623f', '#a68a58', '#d6bd86');

/**
 * What a Trim layer added in the editor starts with (LayerDef.fresh): the default moulding sized to the texture — one
 * strip across a trim texture (up to 96 px across), strips of about 64 px stacked on a larger one (a trim sheet; tall
 * textures run vertically), plates about three strip heights long, grooves and the Edge bevel in proportion.
 */
export function trimFresh({ width, height }: { width: number; height: number }): ParamValues {
	const vert = height > width;
	const along = vert ? height : width;
	const across = vert ? width : height;
	const strips = across <= 96 ? 1 : Math.max(1, Math.round(across / 64));
	const H = Math.max(1, Math.floor(across / strips));
	return {
		orient: vert ? 'vertical' : 'horizontal',
		strips,
		div_count: Math.max(1, Math.round(along / (3 * H))),
		div_width: halfPx(H / 20, 1),
		bevel: halfPx(H / 21, 1)
	};
}

export const trimLayer: LayerDef = {
	type: 'trim',
	label: 'Trim strip',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	// The relief writes its shape to the mask only when it is given one (mask_shape); the shape outputs always do.
	maskWrite: (p) => (p.output !== 'relief' || p.mask_shape !== 'none' ? 'shape' : false),
	description:
		'Moulding / trim strip: stacked profiled bands (bead, cove, ogee, groove, step…), dividers and a row of rivets, bolts, screws, slots or holes; one strip across the texture, several stacked, or a band with a gap round it. Tileable.',
	params: [
		P.enum(
			'output',
			'Output',
			'relief',
			[
				['relief', 'Relief (all, value)'],
				['blocks', 'Blocks between dividers (shape)'],
				['dividers', 'Dividers (shape)'],
				['elements', 'Rivets / slots (shape)'],
				['band', 'One band (shape)'],
				['strip', 'Strip material (shape)']
			],
			{
				hint: 'Relief composes bands, dividers and elements into one height value. Shapes give one element class as an SDF. Strip material: the strips less their holes and seams'
			}
		),
		P.enum(
			'mask_shape',
			'Shape for the mask',
			'strip',
			[
				['none', 'None (left as it was)'],
				['strip', 'Strip material'],
				['blocks', 'Blocks'],
				['dividers', 'Dividers'],
				['elements', 'Rivets / slots'],
				['band', 'One band']
			],
			{
				showIf: (p) => p.output === 'relief',
				hint: 'The shape the relief hands to the mask it writes (Mask › Write to), for later layers to be limited to or bevel from: Strip material is the strips less their holes and seams (chip their edges, dirt in the cuts); Rivets / slots, a band or the dividers let one layer’s colour or roughness land on just those — no second Trim layer needed'
			}
		),
		P.enum('orient', 'Direction', 'horizontal', ORIENT),
		P.bool('mirror', 'Mirror', true, { hint: 'Bands run from both edges to the centre line' }),
		P.int('fill', 'Stretch band', 4, 0, 6, {
			hint: "This band grows to fill the remaining height (0 = none: the last band's level continues)"
		}),
		P.int('sel_band', 'Band (output)', 1, 1, 6, {
			showIf: (p) => p.output === 'band' || (p.output === 'relief' && p.mask_shape === 'band')
		}),
		P.seed(),
		P.int('strips', 'Strips', 1, 1, 256, {
			softMax: 32,
			hint: 'Strips stacked across the texture, each a copy of the band stack in an equal share (a trim sheet, ribbed panelling)'
		}),
		P.int('strip_h', 'Strip height', 0, 0, 4096, {
			softMax: 256,
			unit: 'px',
			axis: ORIENT_ACROSS,
			hint: 'Height of each strip; 0 fills its share. Smaller leaves a gap round it that the layer leaves alone — a trim band across a wall'
		}),
		P.float('strip_pos', 'Strip position', 0.5, 0, 1, {
			step: 0.001,
			hint: 'Centre of the strips across, as a fraction of their share (0.5 = centred, 0 / 1 = on the top or left edge; wraps). Moves a lone trim band up or down the wall'
		}),
		P.float('strip_var', 'Strip variety', 0.6, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.strips) > 1,
			hint: 'Each strip by its own random halves or doubles its plates, runs plain (no dividers), goes without elements or takes other profiles for its shaped bands — more of them the higher this is, so a stack of strips reads as a trim sheet rather than one strip repeated'
		}),
		P.float('strip_alt', 'Alternate heights', 0.3, 0, 0.9, {
			step: 0.001,
			showIf: (p) => Number(p.strips) > 1,
			hint: 'Pairs of strips split their two shares unevenly — a broad strip, then a narrow one (0 = all the same). An even strip count tiles'
		}),
		P.float('strip_stagger', 'Stagger', 0.5, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.strips) > 1,
			hint: 'Alternate strips shift along by this share of a block (of the element spacing without dividers), like brick courses. An even strip count tiles'
		}),
		P.bool('band_fit', 'Fit bands to strip', true, {
			group: 'bands',
			hint: 'Scale the band stack so that it spans the strip (both halves when mirrored): the heights become proportions, and the moulding grows and shrinks with Strip height. Off: the heights are px (× Band scale)'
		}),
		P.float('band_scale', 'Band scale', 1, 0.05, 64, {
			softMin: 0.25,
			softMax: 8,
			step: 0.01,
			group: 'bands',
			showIf: (p) => !p.band_fit,
			hint: 'Multiplies every band height (rounded to whole px): a moulding designed small, made bold'
		}),
		P.bool('band_chain', 'Join bands', true, {
			group: 'bands',
			hint: 'Each band but a flat one starts where the band before it ends — its Base, or for flutes, grooves and the falling profiles its Level — keeping its own rise (Level − Base), so ridges, steps and grooves run on from their neighbours instead of jumping'
		}),
		...bandParams,
		P.int('div_count', 'Dividers', 3, 0, 256, {
			softMax: 32,
			group: 'dividers',
			hint: 'Dividers along the tile (blocks between them get their own random)'
		}),
		P.enum(
			'div_style',
			'Style',
			'groove',
			[
				['groove', 'Groove (bevelled blocks)'],
				['seam', 'Seam line'],
				['bar', 'Raised bar']
			],
			{ group: 'dividers', showIf: hasDiv }
		),
		P.enum(
			'div_prof',
			'Profile',
			'v',
			[
				[
					'bevel',
					'Edge bevel',
					'the blocks bevel down into a groove, a bar bevels up from its edges, by the layer’s Edge › Bevel'
				],
				['square', 'Square', 'straight walls'],
				['v', 'V', 'a V channel or ridge across the whole width'],
				['round', 'Round', 'a half-round channel or bar across the whole width']
			],
			{
				group: 'dividers',
				showIf: (p) => hasDiv(p) && p.div_style !== 'seam',
				hint: 'Cross-section of a groove or bar. V and Round keep the full Width whatever the Edge bevel'
			}
		),
		P.bool('div_return', 'Frame the blocks', true, {
			group: 'dividers',
			showIf: hasDiv,
			hint: 'The bands turn the corner at the dividers and run across the block ends too, mitred, so every block is a framed plate (the innermost band is its face)'
		}),
		P.float('div_width', 'Width', 1, 0, 256, {
			softMax: 16,
			unit: 'px',
			axis: ORIENT_ALONG,
			step: 0.5,
			group: 'dividers',
			showIf: hasDiv
		}),
		P.float('div_depth', 'Depth', 0.7, 0, 1, {
			step: 0.001,
			group: 'dividers',
			showIf: hasDiv,
			hint: 'How far a groove or seam sinks (1 = to the bottom), or how high a bar rises (1 = to the top)'
		}),
		P.float('div_inset', 'Inset', 0, 0, 2048, {
			softMax: 64,
			unit: 'px',
			axis: ORIENT_ACROSS,
			step: 0.5,
			group: 'dividers',
			showIf: hasDiv,
			hint: 'Gap between the divider ends and the strip edges'
		}),
		P.float('div_offset', 'Offset', 0, 0, 1, { step: 0.001, group: 'dividers', showIf: hasDiv }),
		P.float('div_var', 'Length variation', 0.25, 0, 1, {
			step: 0.001,
			group: 'dividers',
			showIf: hasDiv,
			hint: 'Moves each divider at random (by up to 45% of a block) so the blocks differ in length'
		}),
		P.enum(
			'elem',
			'Element',
			'rivet',
			[
				['none', 'None'],
				['rivet', 'Rivet'],
				['bolt', 'Bolt'],
				['slot', 'Slot (along)'],
				['vslot', 'Slot (across)'],
				['hole', 'Round hole'],
				['square', 'Square hole'],
				['hex', 'Hex head', 'a hex head, its corners chamfered'],
				['screw', 'Slotted screw'],
				['allen', 'Allen bolt', 'a round cap head with a hex socket'],
				['cross', 'Cross screw', 'a pan head with a cross slot'],
				['allen_sunk', 'Allen bolt (sunk)', 'an Allen bolt in a round counterbore'],
				['hex_sunk', 'Hex head (sunk)', 'a hex head in a round counterbore']
			],
			{
				group: 'elements',
				hint: 'Rivet, hex head, cross screw and the Allen bolts are the fastener heads the other greeble generators offer too'
			}
		),
		P.bool('elem_fit', 'Scale with bands', true, {
			group: 'elements',
			showIf: hasElem,
			hint: 'Element sizes, spacing, insets and fillet are in the bands’ units and scale with them (Fit bands, or Band scale), so the heads grow with the moulding'
		}),
		P.enum(
			'elem_layout',
			'Spacing',
			'block',
			[
				['even', 'Even along the tile'],
				['block', 'Within each block']
			],
			{
				group: 'elements',
				showIf: hasElem,
				hint: 'Within each block: Count elements from Inset to Inset between dividers'
			}
		),
		P.int('elem_count', 'Count', 8, 1, 512, {
			softMax: 64,
			group: 'elements',
			showIf: (p) => hasElem(p) && !(Number(p.elem_pitch) > 0),
			hint: 'Per row along the tile (or per block)'
		}),
		P.float('elem_pitch', 'Pitch', 14.5, 0, 2048, {
			softMax: 128,
			unit: 'px',
			axis: ORIENT_ALONG,
			step: 0.5,
			note: fitNote,
			group: 'elements',
			showIf: hasElem,
			hint: 'Spacing between elements instead of a Count (0 = use Count): within blocks, longer blocks get more'
		}),
		P.float('elem_inset', 'Inset', 3.5, 0, 2048, {
			softMax: 64,
			unit: 'px',
			axis: ORIENT_ALONG,
			step: 0.5,
			note: fitNote,
			group: 'elements',
			showIf: (p) => hasElem(p) && p.elem_layout === 'block',
			hint: 'Block edge (a framed block’s frame) to the first / last element centre. With a Pitch the row is centred and the inset is the least room left'
		}),
		P.float('elem_size', 'Radius', 2.25, 0.5, 256, {
			softMax: 24,
			unit: 'px',
			step: 0.5,
			note: fitNote,
			group: 'elements',
			showIf: hasElem,
			hint: 'Radius, or half the slot / square / hex width'
		}),
		P.float('elem_len', 'Slot length', 6, 1, 1024, {
			softMax: 64,
			unit: 'px',
			// (Slots across the strip run across it.)
			axis: (p) => (p.elem === 'vslot' ? ORIENT_ACROSS : ORIENT_ALONG)(p),
			step: 0.5,
			note: fitNote,
			group: 'elements',
			showIf: (p) => p.elem === 'slot' || p.elem === 'vslot'
		}),
		P.enum(
			'elem_ref',
			'Position on',
			'face',
			[
				['strip', 'The strip'],
				['face', 'The face (stretch band)']
			],
			{
				group: 'elements',
				showIf: hasElem,
				hint: 'What Position is a share of: the whole strip, or its face — the stretch band (else the innermost band), so the rows stay on it whatever the strip’s height'
			}
		),
		P.float('elem_y', 'Position', 0.5, 0, 1, {
			step: 0.001,
			group: 'elements',
			showIf: hasElem,
			hint: 'Centre of the rows across the strip (or the face), 0 = top (left) edge'
		}),
		P.int('elem_rows', 'Rows', 1, 1, 64, { softMax: 8, group: 'elements', showIf: hasElem }),
		P.float('elem_row_gap', 'Row spacing', 8, 0, 2048, {
			softMax: 64,
			unit: 'px',
			axis: ORIENT_ACROSS,
			step: 0.5,
			note: fitNote,
			group: 'elements',
			showIf: (p) => hasElem(p) && Number(p.elem_rows) > 1
		}),
		P.bool('elem_stagger', 'Stagger rows', false, {
			group: 'elements',
			showIf: (p) => hasElem(p) && Number(p.elem_rows) > 1 && p.elem_layout !== 'block',
			hint: 'Shift alternate rows half a step'
		}),
		P.float('elem_offset', 'Offset', 0, 0, 1, {
			step: 0.001,
			group: 'elements',
			showIf: (p) => hasElem(p) && p.elem_layout !== 'block'
		}),
		P.float('elem_height', 'Height', 0.46, 0, 1, {
			step: 0.001,
			group: 'elements',
			showIf: raisedElem,
			hint: 'Head height above the surface round it, in the relief’s 0…1 range, held under the room left above that surface (1 = all of it: up to the top) so a head stays round'
		}),
		P.float('elem_depth', 'Depth', 1, 0, 1, {
			step: 0.001,
			group: 'elements',
			showIf: holeElem,
			hint: 'How far the holes / slots sink below the surface round them (1 = to the bottom)'
		}),
		P.float('elem_turn', 'Turn', 1, 0, 1, {
			step: 0.001,
			group: 'elements',
			showIf: (p) => ['hex', 'screw', 'allen', 'cross', 'allen_sunk', 'hex_sunk'].includes(String(p.elem)),
			hint: 'Random turn of each hex head, screw slot or socket (0 = all aligned)'
		}),
		P.float('elem_clear', 'Divider clearance', 1, 0, 2048, {
			softMax: 32,
			unit: 'px',
			axis: ORIENT_ALONG,
			step: 0.5,
			note: fitNote,
			group: 'elements',
			showIf: (p) => hasElem(p) && hasDiv(p),
			hint: 'Keep the heads this far from the dividers — from the frame when the blocks are framed (0 = off: elements may sit on them). Evenly spaced ones that come closer are left out; within blocks the inset grows'
		}),
		P.float('elem_bevel', 'Fillet', 0.3, 0, 1, {
			softMax: 0.6,
			step: 0.01,
			group: 'elements',
			showIf: hasElem,
			hint: 'Rounds the walls of holes and slots, the seats round heads and the washers’ edges, as a share of the head’s radius (at least 1 px): the walls slope, floors dish and seats become countersinks, so they catch the light (0 = hard cuts)'
		}),
		P.float('elem_seat', 'Seat', 1, 0, 1, {
			step: 0.001,
			group: 'elements',
			showIf: raisedElem,
			hint: 'A fine sunken ring round each head (round a washer): the shadow line that makes small heads read'
		}),
		P.float('elem_missing', 'Missing', 0, 0, 1, {
			step: 0.001,
			group: 'elements',
			showIf: hasElem,
			hint: 'Share of the elements left out at random; rivets, bolts and screws leave their empty hole'
		}),
		P.float('elem_hole', 'Empty hole', 0.55, 0, 1, {
			step: 0.001,
			group: 'elements',
			showIf: (p) => raisedElem(p) && Number(p.elem_missing) > 0,
			hint: 'Radius of the hole a missing head leaves, as a share of the head’s radius (0 = no hole)'
		})
	],
	groups: [
		{ id: 'bands', label: 'Bands' },
		{ id: 'dividers', label: 'Dividers', collapsed: true },
		{ id: 'elements', label: 'Elements' }
	],
	defaults: {
		h_on: true,
		h_amount: 0.6,
		bevel: 3,
		profile: 'smooth',
		h_var: 0.3,
		dif_on: true,
		dif_src: 'value',
		dif_jitter: 0.08,
		dif_grad: TRIM_RAMP
	},
	fresh: trimFresh,
	glsl:
		GRB_GLSL +
		/* glsl */ `
// Band shape 0..1 at t (0 = outer edge, 1 = inner edge); y = px from the band's outer edge, h = band px.
float grb_bandShape(int prof, float t, float y, float h) {
  float x = 2.0 * t - 1.0;
  if (prof == 0) return 1.0;
  if (prof == 1) return sqrt(max(1.0 - x * x, 0.0));
  if (prof == 2) return 1.0 - sqrt(max(1.0 - x * x, 0.0));
  if (prof == 3) return 1.0 - abs(x);
  if (prof == 4) return min(abs(x) * 2.0, 1.0);
  if (prof == 5) return grb_rise(-min(y, h - y), u_bevel);
  if (prof == 6) return t;
  if (prof == 7) return 1.0 - t;
  // Quarter rounds (8, 9), ogees (10, 11) and coves (12, 13: concave quarter rounds), rising (even) or falling (odd)
  // inward.
  float r = (prof & 1) == 0 ? t : 1.0 - t;
  return prof < 10 ? sqrt(max(1.0 - (1.0 - r) * (1.0 - r), 0.0)) : prof < 12 ? r * r * (3.0 - 2.0 * r) : 1.0 - sqrt(max(1.0 - r * r, 0.0));
}

// Join bands: bit p set where profile p starts at its level (flute, groove, the falling ones), and where it ends there.
#define TRM_STARTS_HIGH 10901
#define TRM_ENDS_HIGH 5461

// The ring round a bolt head of radius r (its washer's width is twice this): 0.75 px up to r = 3, then a quarter of r.
float grb_ringW(float r) { return max(0.75, 0.25 * r); }

// Inside-ness of an element's cut at distance d with a fillet of w px: 0 outside, rising over w + 1 px into it, so the
// wall slopes and the floor rounds off (w = 0: the anti-aliased hard cut).
float grb_fil(float d, float w) { return w > 0.0 ? smoothstep(0.0, 1.0, (0.5 - d) / (w + 1.0)) : grb_cov(d); }

// Half size of element kind's footprint, radius r, slot length len: a slot's or a square's half box; else round — a
// bolt with its washer, an Allen bolt's cap, a sunk head's counterbore, the head or hole.
vec2 trm_elemHalf(int kind, float r, float len) {
  if (kind == 3) return vec2(0.5 * len, r);
  if (kind == 4) return vec2(r, 0.5 * len);
  return vec2(kind == 2 ? r + 2.0 * grb_ringW(r) : kind == 9 ? 0.95 * r : kind >= 11 ? GRB_SINK_R * r : r);
}
// Footprint of element kind at d (along, across) from its centre.
float grb_elemSdf(int kind, vec2 d, float r, float len) {
  vec2 h = trm_elemHalf(kind, r, len);
  if (kind == 3 || kind == 4) return sdRoundBox(d, h, vec4(r));
  if (kind == 6) return sdBox(d, h);
  return length(d) - h.x;
}

// The band stack of strip si (its heights, profiles, levels and bases are arrays beside it: trm_bands): the room for it
// (avail: the strip, each half when mirrored), the bands' scale bs, the stretch band (fill); its places across: the
// face fLo..fHi, the innermost band's start l0, the selected band bnd0..bnd1 (1e9: none). (No arrays in structs: ANGLE's
// D3D backend fails on them.)
struct TrmBands { int fill; float avail; float bs; float fLo; float fHi; float l0; float bnd0; float bnd1; };

// The dividers' layout round the pixel: the distance to the nearest divider (dDiv; dd along, span across: where the
// dividers stop short of the strip's edges), to its block's material (dBlk), the block's extent blo..bhi along, its
// index kbi and random; w: the divider width; bq: leading edges k0 - 1 … k0 + 2.
struct TrmDiv { float dDiv; float dBlk; float dd; float span; float rnd; float blo; float bhi; int kbi; float w; vec4 bq; };

// The nearest element: its footprint's distance dE, centre offset loc, turn ang and random; and the nearest missing
// one's hole (dMiss, mLoc).
struct TrmElem { float dE; vec2 loc; float ang; float rnd; float dMiss; vec2 mLoc; };

// The strip under the pixel (aT: across the texture from its top or left edge, AT: the texture across): each in an
// equal share of the texture (edges on whole px), Strip height px centred on the share's Position — Alternate heights
// splitting each pair's shares. a: across the strip, A: its height, si: its index.
void trm_strip(float aT, float AT, out float a, out float A, out int si) {
  int ns = max(u_strips, 1);
  float ps = AT / float(ns), po = u_strip_pos - 0.5;
  float kS = floor(aT / ps - po);
  float p0 = floor((kS + po) * ps + 0.5), p1 = floor((kS + 1.0 + po) * ps + 0.5);
  if (aT < p0) { kS -= 1.0; p1 = p0; p0 = floor((kS + po) * ps + 0.5); }
  else if (aT >= p1) { kS += 1.0; p0 = p1; p1 = floor((kS + 1.0 + po) * ps + 0.5); }
  if (u_strip_alt > 0.0 && ns > 1) {
    // Alternate heights: each pair of strips splits its two shares (1 + alt) : (1 - alt), edges on whole px.
    float kP = floor(0.5 * (aT / ps - po));
    float P0 = floor((2.0 * kP + po) * ps + 0.5);
    if (aT < P0) { kP -= 1.0; P0 = floor((2.0 * kP + po) * ps + 0.5); }
    float P1 = floor((2.0 * kP + 2.0 + po) * ps + 0.5);
    if (aT >= P1) { kP += 1.0; P0 = P1; P1 = floor((2.0 * kP + 2.0 + po) * ps + 0.5); }
    float S = floor((2.0 * kP + 1.0 + min(u_strip_alt, 0.9) + po) * ps + 0.5);
    bool second = aT >= S;
    kS = 2.0 * kP + (second ? 1.0 : 0.0);
    p0 = second ? S : P0;
    p1 = second ? P1 : S;
  }
  A = u_strip_h > 0 ? min(float(u_strip_h), p1 - p0) : p1 - p0;
  a = aT - p0 - floor(0.5 * (p1 - p0 - A));
  si = wrapCell(int(kS), ns);
}

// The band stack (TrmBands) of strip si, A across: heights bh (whole px) by Band scale or Fit, shrunk to the room, the
// stretch band filling what the others leave; profiles bp redrawn by Strip variation; levels bl and bases bb chained by
// Join bands.
TrmBands trm_bands(float A, int si, out float bh[6], out int bp[6], out float bl[6], out float bb[6]) {
  TrmBands B;
  int ns = max(u_strips, 1);
  // Band heights: Band scale, or Fit — the stack as given spans the strip (each half when mirrored). Whole px.
  bh = float[6](float(u_band1), float(u_band2), float(u_band3), float(u_band4), float(u_band5), float(u_band6));
  B.avail = u_mirror ? 0.5 * A : A;
  float tot = 0.0;
  for (int i = 0; i < 6 * UNI_1; i++) tot += max(bh[i], 0.0);
  B.bs = u_band_fit ? (tot > 0.0 ? B.avail / tot : 1.0) : u_band_scale;
  float t2 = 0.0;
  for (int i = 0; i < 6 * UNI_1; i++) {
    if (B.bs != 1.0) bh[i] = floor(max(bh[i], 0.0) * B.bs + 0.5);
    t2 += max(bh[i], 0.0);
  }
  // A stack taller than the strip (each half when mirrored) shrinks to fit, so a narrow strip still shows its whole
  // moulding and a face. (The bands but the stretch band summed on the way: it fills what they leave.)
  bool shrink = t2 > B.avail && t2 > 0.0;
  B.fill = u_fill - 1;
  float others = 0.0;
  for (int i = 0; i < 6 * UNI_1; i++) {
    if (shrink) bh[i] = floor(max(bh[i], 0.0) * B.avail / t2 + 0.5);
    if (i != B.fill) others += max(bh[i], 0.0);
  }
  if (shrink) B.bs *= B.avail / t2;
  bp = int[6](u_prof1, u_prof2, u_prof3, u_prof4, u_prof5, u_prof6);
  bl = float[6](u_level1, u_level2, u_level3, u_level4, u_level5, u_level6);
  bb = float[6](u_base1, u_base2, u_base3, u_base4, u_base5, u_base6);
  if (B.fill >= 0) bh[B.fill] = max(bh[B.fill], B.avail - others);

  // Join bands: each band but a flat one starts where the one before it ends — its base, or for the profiles that
  // start high (flute, groove, the falling ones) its level — and keeps its own rise, so the moulding runs on without
  // cliffs (TRM_STARTS_HIGH, TRM_ENDS_HIGH).
  // Strip variety also redraws the moulding of some strips: their shaped bands (not flat ones, nor the stretch band)
  // take another profile that starts and ends the same way (so the levels still join up): bead / ridge / step;
  // chamfer / quarter round / ogee / cove rising; flute / groove; the falling ones. Row t of pv: start high × 2 + end
  // high (TRM_STARTS_HIGH, TRM_ENDS_HIGH); pn: how many in the row.
  if (u_strip_var > 0.0 && ns > 1 && hashI(ivec2(si, 104), uSeed) < 0.5 * u_strip_var) {
    int pv[16] = int[16](1, 3, 5, 1, 6, 8, 10, 12, 7, 9, 11, 13, 2, 4, 2, 4);
    int pn[4] = int[4](3, 4, 4, 2);
    for (int i = 0; i < 6 * UNI_1; i++) {
      int pr = bp[i];
      int t = ((TRM_STARTS_HIGH >> pr) & 1) * 2 + ((TRM_ENDS_HIGH >> pr) & 1);
      if (pr != 0 && i != B.fill) bp[i] = pv[t * 4 + int(floor(hashI(ivec2(si, 110 + i), uSeed) * (float(pn[t]) - 0.001)))];
    }
  }

  if (u_band_chain) {
    float prevEnd = -1.0;
    for (int i = 0; i < 6 * UNI_1; i++) {
      if (bh[i] > 0.0) {
        int pr = bp[i];
        // Moved to start at the previous end, keeping its own rise (or depth): Level - Base.
        float rise = bl[i] - bb[i];
        if (pr != 0 && prevEnd >= 0.0) {
          if (((TRM_STARTS_HIGH >> pr) & 1) == 1) { bl[i] = prevEnd; bb[i] = clamp(prevEnd - rise, 0.0, 1.0); }
          else { bb[i] = prevEnd; bl[i] = clamp(prevEnd + rise, 0.0, 1.0); }
        }
        prevEnd = ((TRM_ENDS_HIGH >> pr) & 1) == 1 ? bl[i] : bb[i];
      }
    }
  }

  // The bands' places across, in one pass: the face — the stretch band (else the innermost band), across the strip from
  // fLo to fHi (both halves when mirrored and it reaches the centre line); the innermost band's start (l0: a framed
  // block's frame is the bands outside it); the selected band (Band output), bnd0..bnd1.
  int sel = u_sel_band - 1;
  float c0 = 0.0, f0 = 0.0, f1 = A, l1 = A;
  B.l0 = 0.0; B.bnd0 = 1e9; B.bnd1 = 1e9;
  for (int i = 0; i < 6 * UNI_1; i++) {
    if (bh[i] > 0.0) {
      if (i == B.fill) { f0 = c0; f1 = c0 + bh[i]; }
      if (i == sel) { B.bnd0 = c0; B.bnd1 = c0 + bh[i]; }
      B.l0 = c0; l1 = c0 + bh[i];
      c0 += bh[i];
    }
  }
  if (B.fill < 0 || bh[max(B.fill, 0)] <= 0.0) { f0 = B.l0; f1 = l1; }
  B.fLo = f0;
  B.fHi = u_mirror && f1 >= B.avail - 1e-3 ? A - f0 : f1;
  return B;
}

// The dividers of strip si (nd of them along LA; s: along, a: across the strip, A its height, dStrip: the distance to
// it). Leading edges on whole px.
TrmDiv trm_dividers(float s, float a, float A, float LA, int nd, int si, float dStrip) {
  TrmDiv D;
  D.dDiv = 1e4; D.dBlk = dStrip; D.dd = 1e4; D.span = 1.0;
  D.rnd = hashI(ivec2(0, 1 + 2 * si), uSeed);
  D.blo = 0.0; D.bhi = LA;   // extent of the block under the pixel (along)
  D.kbi = 0;   // the block's index (round the tile: a block across its edge is one)
  D.w = max(u_div_width, 0.0);
  float bq[4] = float[4](-1e5, -1e5, -1e5, -1e5);
  if (nd > 0) {
    float sp = LA / float(nd);
    float k0 = floor(s / sp - u_div_offset);
    // Divider leading edges k0 - 1 … k0 + 2, each moved by up to ±45% of a block (Length variation).
    for (int i = 0; i < 4 * UNI_1; i++) {
      float k = k0 - 1.0 + float(i);
      float j = 0.9 * u_div_var * (hashI(ivec2(wrapCell(int(k), nd), si), uSeed + 5.0) - 0.5);
      bq[i] = floor((k + u_div_offset + j) * sp + 0.5);
    }
    float kb = k0, b0 = bq[1], b1 = bq[2];
    if (s < bq[1]) { kb = k0 - 1.0; b0 = bq[0]; b1 = bq[1]; }
    else if (s >= bq[2]) { kb = k0 + 1.0; b0 = bq[2]; b1 = bq[3]; }
    D.dd = min(abs(s - (b0 + 0.5 * D.w)), abs(s - (b1 + 0.5 * D.w))) - 0.5 * D.w;
    D.span = abs(a - 0.5 * A) - (0.5 * A - u_div_inset);
    D.dDiv = max(D.dd, D.span);
    D.dBlk = max(max(b0 + D.w - s, s - b1), dStrip);
    D.blo = b0 + D.w; D.bhi = b1;
    D.kbi = wrapCell(int(kb), nd);
    // Blocks get their own random; the margins the dividers stop short of (Inset) run on as one piece.
    if (D.span <= 0.0) D.rnd = hashI(ivec2(D.kbi, 1 + 2 * si), uSeed);
  }
  D.bq = vec4(bq[0], bq[1], bq[2], bq[3]);
  return D;
}

// The moulding's height at y px in from the strip's edge (a: across the strip, A its height; wrapped: y runs round a
// framed block's end): the band under the pixel, or past the last band its level.
float trm_bandValue(float bh[6], int bp[6], float bl[6], float bb[6], float avail, float y, float a, float A, bool wrapped) {
  float y0 = 0.0, y1 = 0.0;
  int bi = -1, last = -1;
  for (int i = 0; i < 6 * UNI_1; i++) {
    if (bh[i] > 0.0 && bi < 0) {
      last = i;
      if (y < y0 + bh[i]) { bi = i; y1 = y0 + bh[i]; }
      else y0 += bh[i];
    }
  }
  float v;
  if (bi < 0) v = last >= 0 ? bl[last] : 0.0;   // past the last band: its level continues
  else {
    float h = y1 - y0, yy = y - y0;
    // Mirrored: a band reaching the centre line joins its mirror image into one band (a centre bead is
    // one half-round, a centre step has no seam), except the one-sided profiles (chamfers, quarter rounds,
    // ogees, coves), which make a roof / valley.
    if (u_mirror && !wrapped && y1 >= avail - 1e-3 && bp[bi] < 6) { h = A - 2.0 * y0; yy = a - y0; }
    // Averaged over the pixel (4 samples across it), so steep profile ends (a bead's or a cove's vertical tangent)
    // leave no one-pixel crease where they meet the next band.
    float sh = 0.0;
    for (int k = 0; k < 4 * UNI_1; k++) {
      float tt = clamp((yy + (float(k) - 1.5) * 0.25) / h, 0.0, 1.0);
      sh += 0.25 * grb_bandShape(bp[bi], tt, tt * h, h);
    }
    v = mix(bp[bi] == 0 ? bl[bi] : bb[bi], bl[bi], sh);
  }
  return v;
}

// The divider relief on v: gd 0..1 = how much of the groove's depth (bar's height) applies here.
float trm_divRelief(TrmDiv D, float v) {
  float gd;
  if (u_div_prof == 0) gd = u_div_style == 2 ? grb_rise(D.dDiv, u_bevel) : 1.0 - grb_rise(-D.dDiv, u_bevel);
  else if (u_div_prof == 1) gd = grb_cov(D.dDiv);
  else {
    // V / round across the divider's own width, its ends rounded off inside the strip (a capsule), so a bar or a
    // groove dies away at the strip's edge instead of stopping square against the next strip.
    float rad = length(vec2(D.dd + 0.5 * D.w, max(D.span + 0.5 * D.w, 0.0)));
    float xn = clamp(rad / max(0.5 * D.w, 0.5), 0.0, 1.0);
    gd = (u_div_prof == 2 ? 1.0 - xn : sqrt(max(1.0 - xn * xn, 0.0))) * grb_cov(rad - 0.5 * D.w);
  }
  if (u_div_style == 0) v *= 1.0 - u_div_depth * gd;
  else if (u_div_style == 1) v = mix(v, v * (1.0 - u_div_depth), grb_cov(D.dDiv));
  else v = mix(v, mix(v, 1.0, u_div_depth), gd);
  return v;
}

// The elements of kind ek nearest the pixel (s along, a across strip si, A its height; LA: the strip's length): rows
// along the strip, spaced evenly along the tile (neT per row) or within each block (D); es: their scale with the
// bands, r: their radius, fw: their fillet; B: the face they may be placed on; F: a framed block's frame width.
TrmElem trm_nearestElem(int ek, float s, float a, float A, float LA, int si, int nd, int neT, float ePitch, float es,
                        float r, float fw, TrmBands B, TrmDiv D, float F) {
  TrmElem E = TrmElem(1e4, vec2(1e4), 0.0, 0.0, 1e4, vec2(1e4));
  int ns = max(u_strips, 1);
  int nr = max(u_elem_rows, 1);
  bool raised = ek == 1 || ek == 2 || ek >= 7;
  float len = u_elem_len * es;
  // fp: the extent pixel snapping centres; ext: the head's whole extent along (spacing, clearance).
  vec2 fp = ek == 3 ? vec2(len, 2.0 * r) : ek == 4 ? vec2(2.0 * r, len) : vec2(2.0 * r);
  float ext = ek == 2 || ek >= 11 ? 2.0 * trm_elemHalf(ek, r, len).x : fp.x;
  float rg = u_elem_row_gap * es;
  float a0 = (u_elem_ref == 1 ? B.fLo + u_elem_y * (B.fHi - B.fLo) : u_elem_y * A) - 0.5 * float(nr - 1) * rg;
  int j0 = nr > 1 && rg > 0.0 ? int(clamp(floor((a - a0) / rg + 0.5), 0.0, float(nr - 1))) : 0;
  // Within blocks needs dividers: a strip without them spaces its elements evenly along the tile (so it tiles).
  bool perBlock = u_elem_layout == 1 && nd > 0;
  // Clearance (and, within blocks, the inset) count from a framed block's frame.
  float Fe = u_div_return && nd > 0 ? F : 0.0;
  float clr = u_elem_clear > 0.0 && nd > 0 ? u_elem_clear * es + Fe : 0.0;
  int ne = neT;
  float lo = 0.0, se = LA / float(ne);
  if (perBlock) {
    // Inside the frames, from Inset to Inset (at least the clearance from the dividers); heads stay ≥ 1 px apart.
    float L = D.bhi - D.blo - 2.0 * Fe;
    float insMin = u_elem_clear > 0.0 && nd > 0 ? 0.5 * ext + u_elem_clear * es : 0.0;
    float ins = max(u_elem_inset * es, insMin);
    float minSp = ext + 1.0;
    int n;   // gaps between the first and the last
    if (ePitch > 0.0) {
      // By Pitch: the spacing within 25% of it (one centred head where even one gap won't fit), the row centred.
      float room = L - 2.0 * ins;
      float pt = max(ePitch, minSp);
      n = room > 0.0 ? min(int(floor(room / pt + 0.25)), int(floor(room / minSp))) : 0;
      se = n > 0 ? min(pt, room / float(n)) : 0.0;
    } else {
      // By Count: in a short block the inset gives way (down to the clearance), then the count.
      n = min(max(u_elem_count, 1), max(int(floor((L - 2.0 * insMin) / minSp)) + 1, 1)) - 1;
      if (n > 0) ins = max(insMin, min(ins, 0.5 * (L - float(n) * minSp)));
      se = n > 0 ? (L - 2.0 * ins) / float(n) : 0.0;
    }
    ne = n + 1;
    lo = 0.5 * (D.blo + D.bhi) - 0.5 * float(n) * se;
  }
  // One flat loop over the 3 rows × (3 elements nearest the pixel + a block's fallback) — see UNI_1; no continue,
  // see AGENTS.md.
  float kb0 = ne > 1 ? clamp(floor((s - lo) / max(se, 1e-3) + 0.5), 0.0, float(ne - 1)) : 0.0;
  bool clear = !perBlock && clr > 0.0;
  float holeR = u_elem_hole * r;
  for (int c = 0; c < 12 * UNI_1; c++) {
    int row = j0 + c / 4 - 1;
    int ci = c % 4;
    float off = u_elem_offset + ((row & 1) == 1 && u_elem_stagger ? 0.5 : 0.0);
    float k = (perBlock ? kb0 : floor(s / se - off)) + float(ci - 1);
    float ay = grb_snapC(a0 + float(row) * rg, fp.y);
    // Slots and heads kept inside the strip (by the fillet + 1 px, and clear of an unmirrored strip's joint bevel).
    ay = clamp(ay, min(0.5 * fp.y + 1.0 + fw, 0.5 * A), max(A - 0.5 * fp.y - 1.0 - fw - (!u_mirror && ns > 1 ? u_bevel : 0.0), 0.5 * A));
    bool inDiv = abs(ay - 0.5 * A) - (0.5 * A - u_div_inset) < 0.5 * fp.y;
    bool ok = row >= 0 && row < nr && (ci < 3 ? (!perBlock || (k >= 0.0 && k <= float(ne - 1))) : clear && inDiv);
    float sx = grb_snapC(ci == 3 ? 0.5 * (D.blo + D.bhi) : perBlock ? lo + k * se : (k + off + 0.5) * se, fp.x);
    if (ok && ci == 3) {
      // Fallback: a block whose evenly spaced heads all fall too near its dividers gets one at its centre.
      float m = 0.5 * ext + clr;
      ok = floor((D.bhi - m) / se - off - 0.5) < ceil((D.blo + m) / se - off - 0.5) && D.bhi - D.blo >= ext + 2.0;
      k = 1000.0;
    } else if (ok && clear && inDiv) {
      // Evenly spaced heads too near a divider (where the dividers reach) are left out.
      float c0 = sx - 0.5 * D.w;
      float dv = min(min(abs(c0 - D.bq.x), abs(c0 - D.bq.y)), min(abs(c0 - D.bq.z), abs(c0 - D.bq.w)));
      ok = dv - 0.5 * D.w - 0.5 * ext >= clr;
    }
    if (ok) {
      vec2 dl = vec2(s - sx, a - ay);
      int ki = ci == 3 ? 100000 + D.kbi : perBlock ? D.kbi * 64 + int(k) : wrapCell(int(k), ne);
      ivec2 id = ivec2(ki, row + 64 * si);
      // Missing ones (a share at random): raised heads leave their empty hole.
      float hm = hashI(id, uSeed + 21.0);
      if (hm < u_elem_missing) { if (raised && holeR > 0.0 && length(dl) - holeR < E.dMiss) { E.dMiss = length(dl) - holeR; E.mLoc = dl; } }
      else {
        float d = grb_elemSdf(ek, dl, r, len);
        if (d < E.dE) { E.dE = d; E.loc = dl; E.ang = 3.14159265 * u_elem_turn * (fract(hm * 7.13) - 0.5); E.rnd = hashI(id, uSeed + 9.0); }
      }
    }
  }
  return E;
}

// The element E on the moulding v: raised heads (0..1) — a rivet's dome; a bolt's flat-topped head on a washer; a hex
// head on its washer (flat top, chamfered round towards the corners, steep flats); a slotted pan-head screw — their
// height under the relief's ceiling of 1, so a head on a high band keeps its round top; or cuts. A missing head leaves
// its hole.
float trm_elemRelief(int ek, TrmElem E, float r, float fw, float v) {
  bool raised = ek == 1 || ek == 2 || ek >= 7;
  float rw = grb_ringW(r);
  float lr = length(E.loc);
  vec2 q = rot2(E.ang) * E.loc;
  float x = lr / r;
  float eh = min(u_elem_height, max(1.0 - v, 0.0));
  bool washer = ek == 2;
  float rWash = r + 2.0 * rw;
  // Seat: a fine sunken ring round each head (round a washer) — the shadow line that makes a small head read.
  float ringW = 0.6 * rw;
  float ringR = (washer ? rWash : ek >= 11 ? GRB_SINK_R * r : r) + ringW;
  float ringK = 0.5 * u_elem_seat;
  // Filleted, the ring is a rounded V (a countersink) instead of a flat-floored channel.
  float ringV = clamp(1.0 - abs(lr - ringR) / (ringW + 0.5 * fw + 0.5), 0.0, 1.0);
  float ringP = fw > 0.0 ? ringV * ringV * (3.0 - 2.0 * ringV) : grb_cov(abs(lr - ringR) - ringW);
  if (raised && ringK > 0.0) v -= ringK * u_elem_height * ringP;
  float head = grb_dome(lr, r);
  if (ek == 2) head = grb_pan(x);
  if (ek == 8) head = sqrt(max(1.0 - x * x * x * x, 0.0)) * (1.0 - 0.7 * grb_fil(abs(q.y) - max(0.16 * r, 0.5), 0.5 * fw));
  // The shared heads (greebleCommon): a hex head, an Allen bolt, a cross screw, a sunk Allen bolt or hex head in its
  // counterbore.
  if (ek == 7 || ek >= 9) head = grb_fastener(ek == 7 ? 3 : ek == 9 ? 1 : ek == 10 ? 6 : ek == 11 ? 2 : 4, q, r, 0.6).x;
  // The washer: a ring a little higher at its hole than at its rim, its edge filleted.
  if (washer) head = max(head, (0.24 + 0.08 * clamp((rWash - lr) / max(rWash - r, 0.5), 0.0, 1.0)) * grb_fil(lr - rWash, max(fw, 0.5)));
  if (raised) v += eh * head;
  // Cuts: filleted, the walls slope and the floor dishes towards the middle (a lit far wall), else a hard cut.
  else v = mix(v, v * (1.0 - u_elem_depth), fw > 0.0 ? grb_fil(E.dE, fw) * (0.75 + 0.25 * clamp(-E.dE / r, 0.0, 1.0)) : grb_cov(E.dE));
  return v * (1.0 - 0.5 * grb_fil(E.dMiss, fw));
}

// Bevel aspect (greebleCommon): the output's shapes in the stretched space, k along (s) and across (a). Strips, blocks,
// dividers and bands are slabs and boxes along those axes (a band turning a framed block's end mitres across both:
// yA across, yE along from the block's end); the element (and a missing one's hole) a rounded box — one in the loop.
float trm_bdist(bool vert, float s, float dStrip, int nd, int ek, float r, float es, TrmDiv D, TrmElem E, TrmBands B, float yA, float yE, float dBand) {
  vec2 k = grb_bevK(vert);
  float sStrip = dStrip * k.y;
  float sBlk = nd > 0 ? max(max((D.blo - s) * k.x, (s - D.bhi) * k.x), sStrip) : sStrip;
  float sE = 1e4, sMiss = 1e4;
  for (int i = 0; i < (u_output == 5 ? 2 : u_output == 3 ? 1 : 0) * UNI_1; i++) {
    bool el = i == 0;
    vec2 hb = el ? trm_elemHalf(ek, r, u_elem_len * es) : vec2(u_elem_hole * r);
    float e = grb_bevRBox(el ? E.loc : E.mLoc, hb, !el || (ek != 6) ? min(hb.x, hb.y) : 0.0, k);
    if (el) sE = E.dE < 1e3 ? e : E.dE; else sMiss = E.dMiss < 1e3 ? e : E.dMiss;
  }
  float sMat = nd > 0 && u_div_style != 2 ? sBlk : sStrip;
  if (ek >= 3 && ek <= 6) sMat = max(sMat, -sE);
  sMat = max(sMat, -sMiss);
  return u_output == 1 ? sBlk : u_output == 2 ? (nd > 0 ? max(D.dd * k.x, D.span * k.y) : D.dDiv) : u_output == 3 ? sE
       : u_output == 4 ? (B.bnd0 < 1e8 ? max(max((B.bnd0 - yA) * k.y, (B.bnd0 - yE) * k.x), min((yA - B.bnd1) * k.y, (yE - B.bnd1) * k.x)) : dBand)
       : sMat;
}

GenOut gen(vec2 p) {
  bool vert = u_orient == 1;
  // s: along the strip (left → right, or top → bottom); aT: across the texture, from the top (or left) edge.
  float s = vert ? uRes.y - p.y : p.x;
  float aT = vert ? p.x : uRes.y - p.y;
  float LA = vert ? uRes.y : uRes.x;
  float AT = vert ? uRes.x : uRes.y;

  // ---- the strip across under the pixel (a: across it, A: its height).
  int ns = max(u_strips, 1);
  float a, A;
  int si;
  trm_strip(aT, AT, a, A, si);
  float dStrip = -min(a, A - a);

  // Strip variation: each strip by its own random halves or doubles its plates, runs plain (no dividers) or goes
  // without elements.
  int nd = u_div_count;
  int ek = u_elem;
  if (u_strip_var > 0.0 && ns > 1) {
    float hv = hashI(ivec2(si, 101), uSeed), hp = hashI(ivec2(si, 102), uSeed), he = hashI(ivec2(si, 103), uSeed);
    if (nd > 0) nd = hp < 0.25 * u_strip_var ? 0 : max(int(floor(float(nd) * (hv < 0.3 * u_strip_var ? 0.5 : hv > 1.0 - 0.3 * u_strip_var ? 2.0 : 1.0) + 0.5)), 1);
    if (he < 0.25 * u_strip_var) ek = 0;
  }

  // ---- the band stack.
  float bh[6], bl[6], bb[6];
  int bp[6];
  TrmBands B = trm_bands(A, si, bh, bp, bl, bb);
  // Element lengths in the bands' units when they scale with them.
  float es = u_elem_fit ? B.bs : 1.0;
  float ePitch = u_elem_pitch * es;
  // Elements per row along the tile (Pitch, or Count).
  int neT = ePitch > 0.0 ? max(int(floor(LA / ePitch + 0.5)), 1) : max(u_elem_count, 1);
  // Alternate strips shift along by whole px (dividers and elements together).
  if ((si & 1) == 1 && u_strip_stagger > 0.0) s += floor(u_strip_stagger * LA / float(nd > 0 ? nd : neT) + 0.5);

  // ---- dividers (their layout first: the bands can turn the corner at the block ends).
  TrmDiv D = trm_dividers(s, a, A, LA, nd, si, dStrip);

  // ---- bands
  float y = u_mirror ? min(a, A - a) : a;
  // Framed blocks: within the frame (the bands outside the innermost one) of a block end, the bands run across the
  // end too, meeting the long ones in a mitre.
  bool wrapped = false;
  float F = 0.0;   // frame width (0 unless framed)
  float yA = y, yE = 1e9;   // (Bevel aspect: y across, and along from a framed block's end where it can turn the corner)
  if (u_div_return && nd > 0) {
    F = B.l0;
    float dEnd = max(min(s - D.blo, D.bhi - s), 0.0);
    if (D.span <= 0.0 && dEnd < min(F, y)) { y = dEnd; wrapped = true; }
    if (D.span <= 0.0 && dEnd < F) yE = dEnd;
  }
  float v = trm_bandValue(bh, bp, bl, bb, B.avail, y, a, A, wrapped);

  // Unmirrored strips fall to 0 at their far edge over the Edge bevel, meeting the next strip without a cliff.
  if (!u_mirror && ns > 1) v *= grb_rise(a - A, u_bevel);

  // Selected band region (both mirrored copies, and its returns round framed block ends).
  float dBand = B.bnd0 < 1e8 ? max(B.bnd0 - y, y - B.bnd1) : 1e4;

  if (nd > 0) v = trm_divRelief(D, v);

  // ---- elements: rows along the strip, spaced evenly along the tile or within each block
  TrmElem E = TrmElem(1e4, vec2(1e4), 0.0, 0.0, 1e4, vec2(1e4));
  float r = es != 1.0 ? max(floor(u_elem_size * es * 2.0 + 0.5) * 0.5, 0.5) : max(u_elem_size, 0.5);
  float fw = u_elem_bevel > 0.0 ? max(u_elem_bevel * r, 1.0) : 0.0;   // fillet of cuts and head edges
  if (ek > 0) {
    E = trm_nearestElem(ek, s, a, A, LA, si, nd, neT, ePitch, es, r, fw, B, D, F);
    v = trm_elemRelief(ek, E, r, fw, v);
  }

  // The strip's material: the blocks (or the whole strip when dividers don't cut it) less holes and seams.
  float dMat = nd > 0 && u_div_style != 2 ? D.dBlk : dStrip;
  if (ek >= 3 && ek <= 6) dMat = max(dMat, -E.dE);
  dMat = max(dMat, -E.dMiss);

  if (u_output == 0) {
    int m = u_mask_shape;
    float dm = m == 1 ? dMat : m == 2 ? D.dBlk : m == 3 ? D.dDiv : m == 4 ? E.dE : dBand;
    float cov = grb_cov(dStrip);
    v = clamp(v, 0.0, 1.0);
    GenOut g;   // (no ternary on structs in WebGL)
    if (m == 0) g = genOut(v, cov, D.rnd, NO_SDF);
    else g = genOutOwn(v, cov, D.rnd, dm);
    // Unframed blocks: the mouldings run on through the dividers, so Per-feature variation lifts only the face and its
    // heads (fading in over a few px outside it), not the bands — no steps at the dividers.
    if (nd > 0 && !u_div_return) g.feat *= clamp(1.0 + min(a - B.fLo, B.fHi - a) / max(2.0, 0.15 * (B.fHi - B.fLo)), 0.0, 1.0);
    return g;
  }
  GenOut g = genOut(0.0, 1.0, u_output == 3 ? E.rnd : D.rnd,
                    u_output == 1 ? D.dBlk : u_output == 2 ? D.dDiv : u_output == 3 ? E.dE : u_output == 4 ? dBand : dMat);
  if (bevelAspectOn()) g.bdist = trm_bdist(vert, s, dStrip, nd, ek, r, es, D, E, B, yA, yE, dBand);
  return g;
}
`
};
