// Carving (FR8.30, docs/features/fr8.30-carved-relief.md): organic carved relief as height — cells with curved
// outlines (fish scales, ogee lenses, wave bands, overlapping circles, diamonds, spirals) each with a body (pillowed,
// domed, tilted like shingles) and a motif of flowing grooves: lines following the outline, parallel lines, a fan, leaf
// veins, a spiral, crescents or petals. Grooves are the isolines of a field in the cell's own coordinates, their width
// kept in px by the field's gradient (worked out per motif, not by screen derivatives, so cell edges and the spiral's
// seam don't upset it). The value is the height (0 = deepest, 1 = highest), so Diffuse is a plain ramp from low to high.

import { P, gradient, type ParamValues } from '@/core/params';
import type { LayerCanvas, LayerDef } from '../types';

const LAYOUTS: [string, string, string][] = [
	['scales', 'Scales', 'Rows of round (or pointed) scales, each row lying over the one above'],
	['ogee', 'Ogee', 'Onion-shaped (or pointed lens) cells in staggered rows, fitting together'],
	['waves', 'Wave bands', 'Bands between parallel wavy lines'],
	['circles', 'Overlapping circles', 'Circles on a square grid overlapping into lenses, with concave squares between'],
	['diamonds', 'Diamonds', 'A square grid turned 45°'],
	['squares', 'Squares', 'A square grid'],
	['spirals', 'Discs', 'Round discs in staggered rows, with concave gaps between']
];

const MOTIFS: [string, string, string][] = [
	['none', 'None', 'A plain body'],
	['concentric', 'Following the outline', 'Lines stepping in from the outline: nested arches, chevrons, rings'],
	['parallel', 'Parallel', 'Lines across the cell (along a wave band)'],
	['fan', 'Fan', 'Lines fanning out from the bottom of the cell, curling with Curl'],
	['leaf', 'Leaf', 'A midrib down the cell and veins curving up from it'],
	['spiral', 'Spiral', 'A spiral from the centre'],
	['crescents', 'Crescents', 'Arcs nested round a point below the centre'],
	['petals', 'Petals', 'A flower: petals round a button'],
	['edge', 'Following the free edge', 'Copies of a scale’s lower edge stacked upward: chevrons on pointed scales'],
	[
		'blades',
		'Blades',
		'A fan of raised curved blades from one root, like fronds: each leaves the root thin and curls over, ending blunt'
	]
];

/** Cells across and down: whole when tiling, the layout's natural height × Aspect. */
function cells(p: ParamValues, c: LayerCanvas): [number, number] {
	const lay = String(p.layout);
	const across = Math.max(0.5, Number(p.cols) || 4);
	const kx = c.tileable ? Math.max(1, Math.round(across)) : across;
	const w = c.width / kx;
	// The layout's row pitch in widths: scales overlap by half, ogee cells (two rows tall) by 0.75, discs by √3/2.
	const natural =
		lay === 'scales'
			? 0.5
			: lay === 'ogee'
				? 0.75
				: lay === 'waves'
					? 0.35
					: lay === 'spirals' && p.pack !== 'square'
						? 0.866
						: 1;
	const hRow = w * natural * (Number(p.aspect) || 1);
	// Staggered layouts repeat every two rows.
	const pair = lay === 'scales' || lay === 'ogee' || (lay === 'spirals' && p.pack !== 'square') ? 2 : 1;
	const ky = c.tileable ? Math.max(pair, Math.round(c.height / hRow / pair) * pair) : c.height / hRow;
	return [kx, ky];
}

const hasMotif = (p: ParamValues) => p.motif !== 'none' || p.motif2 !== 'none';
const twoKinds = (p: ParamValues) => ['ogee', 'circles', 'spirals'].includes(String(p.layout));

const CARVE_RAMP = gradient('#22150c', '#6e4527', '#c8955f');

export const carvingLayer: LayerDef = {
	type: 'carving',
	label: 'Carving',
	category: 'pattern',
	kind: 'generator',
	area: true,
	sdf: true,
	sdfShowIf: (p, key) => key === undefined || (p.output !== 'relief' && key === 'aa'),
	description:
		'Organic carving as height: Cells with curved outlines — scales, ogee lenses, wave bands, overlapping circles, diamonds, discs — each pillowed and carved with flowing grooves: lines following the outline, a fan, leaf veins, a spiral, crescents or petals.',
	params: [
		P.enum(
			'output',
			'Output',
			'relief',
			[
				['relief', 'Relief (value)'],
				['cells', 'Cells (shape)'],
				['grooves', 'Grooves (shape)']
			],
			{
				hint: 'Relief is the whole carving as height. Cells and Grooves give one part as a shape, to paint or write to a mask'
			}
		),
		P.seed(),
		P.enum('layout', 'Layout', 'scales', LAYOUTS, { hint: 'Picks how the cells are laid out' }),
		P.float('cols', 'Cells across', 6, 0.5, 64, {
			softMax: 16,
			step: 0.01,
			uniform: false,
			hint: 'Sets how many cells fit across the texture (whole when tiling)'
		}),
		P.float('aspect', 'Aspect', 1, 0.25, 4, {
			step: 0.01,
			uniform: false,
			hint: 'Stretches the cells vertically (for wave bands: their number down the texture, Cells across × Aspect sets it)'
		}),
		P.float('point', 'Pointed tips', 0, 0, 1, {
			step: 0.001,
			showIf: (p) => p.layout === 'scales',
			hint: 'Draws the scales to a point (0 = round)'
		}),
		P.float('amp', 'Wave height', 0.35, 0, 1.5, {
			step: 0.001,
			showIf: (p) => p.layout === 'waves',
			hint: 'Sets how far the bands swing, a share of a band'
		}),
		P.float('overlap', 'Overlap', 1, 0.5, 1.4, {
			step: 0.001,
			showIf: (p) => p.layout === 'circles' || p.layout === 'spirals',
			hint: 'Sets the circles’ size: at 1 each circle passes through its neighbours’ centres; discs just touch'
		}),
		P.float('wave_var', 'Wave variation', 0, 0, 1, {
			step: 0.001,
			showIf: (p) => p.layout === 'waves',
			hint: 'Gives each band its own swell and phase, so the bands swell and narrow'
		}),
		P.float('pinch', 'Pinch', 0, 0, 1, {
			step: 0.001,
			showIf: (p) => p.layout === 'waves' && Number(p.wave_var) > 0,
			hint: 'Lets the narrowest bands pinch to nothing, so their two lines meet and merge'
		}),
		P.enum(
			'pack',
			'Packing',
			'staggered',
			[
				['staggered', 'Staggered rows'],
				['square', 'Square grid']
			],
			{ showIf: (p) => p.layout === 'spirals', hint: 'Lays the discs in staggered rows or on a square grid' }
		),
		P.float('waist', 'Waist', 1, 0.3, 1, {
			step: 0.001,
			showIf: (p) => p.layout === 'ogee',
			hint: 'Sets how wide the cells swell (1 = neighbours touch; below, the gaps between them are a second kind)'
		}),
		P.float('onion', 'Onion', 0.6, 0, 1, {
			step: 0.001,
			showIf: (p) => p.layout === 'ogee',
			hint: 'Shapes the cells from pointed lenses (0) to onions (1): a broad belly low down and a long drawn-out tip'
		}),
		P.enum(
			'body',
			'Body',
			'pillow',
			[
				['flat', 'Flat'],
				['pillow', 'Pillowed', 'Rounded over at the outline, flat across the middle'],
				['dome', 'Domed', 'Rounded right up to the middle'],
				['tilted', 'Tilted (shingled)', 'Rising toward the bottom edge, so each lies over the one below it'],
				['chamfer', 'Chamfered', 'A straight slope up from the outline']
			],
			{ group: 'cell', hint: 'Shapes each cell’s body' }
		),
		P.float('body_w', 'Body edge', 8, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.25,
			group: 'cell',
			showIf: (p) => p.body === 'pillow' || p.body === 'chamfer',
			hint: 'Sets how wide the rounding or slope at the outline is'
		}),
		P.float('body_lvl', 'Body level', 0.75, 0, 1, {
			step: 0.001,
			group: 'cell',
			hint: 'Sets the height of the cells’ bodies (Petals: the height of the flower’s edge)'
		}),
		P.float('floor_lvl', 'Floor level', 0.2, 0, 1, {
			step: 0.001,
			group: 'cell',
			hint: 'Sets the height at the outline (and round a flower’s petals)'
		}),
		P.float('outline_w', 'Outline width', 3, 0, 16, {
			softMax: 6,
			unit: 'px',
			step: 0.25,
			group: 'cell',
			hint: 'Sets the width of the groove (or rib) along each outline'
		}),
		P.float('outline_d', 'Outline depth', 0.2, -1, 1, {
			step: 0.001,
			group: 'cell',
			hint: 'Sets how deep the outline groove is (below 0: a raised rib)'
		}),
		P.enum('motif', 'Motif', 'concentric', MOTIFS, { group: 'motif', hint: 'Picks the grooves carved into each cell' }),
		P.enum('motif2', 'Second kind', 'none', MOTIFS, {
			group: 'motif',
			showIf: twoKinds,
			hint: 'Picks the motif of the second kind of cell (the gaps between ogee lenses, circles or discs)'
		}),
		P.float('lvl2', 'Second kind level', -0.15, -1, 1, {
			step: 0.001,
			group: 'motif',
			showIf: twoKinds,
			hint: 'Raises or lowers the second kind of cell'
		}),
		P.float('spacing', 'Line spacing', 7, 1, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.25,
			group: 'motif',
			showIf: hasMotif,
			hint: 'Sets the distance between neighbouring grooves (leaf veins: measured along the midrib; blades: the step between them)'
		}),
		P.float('groove_w', 'Groove width', 3, 0.5, 16, {
			softMax: 6,
			unit: 'px',
			step: 0.25,
			group: 'motif',
			showIf: hasMotif
		}),
		P.float('groove_d', 'Groove depth', 0.35, 0, 1, {
			step: 0.001,
			group: 'motif',
			showIf: hasMotif,
			hint: 'Sets how deep the grooves cut (Blades: how high the blades stand)'
		}),
		P.bool('reed', 'Reeded', true, {
			group: 'motif',
			showIf: hasMotif,
			hint: 'Rounds the strips between the grooves over, like reeds, instead of leaving them flat'
		}),
		P.float('margin', 'Margin', 2, 0, 32, {
			softMax: 12,
			unit: 'px',
			step: 0.25,
			group: 'motif',
			showIf: hasMotif,
			hint: 'Stops the grooves this far short of the outline'
		}),
		P.enum(
			'fan_from',
			'Fan from',
			'point',
			[
				['point', 'A point', 'Lines radiate from the bottom of the cell'],
				['edge', 'One edge', 'Lines start spread along one edge and comb across the cell']
			],
			{
				group: 'motif',
				showIf: (p) => p.motif === 'fan' || p.motif2 === 'fan',
				hint: 'Picks where the fan’s lines start'
			}
		),
		P.float('fan_end', 'Closing', 0.55, 0.3, 1, {
			step: 0.001,
			group: 'motif',
			showIf: (p) => (p.motif === 'fan' || p.motif2 === 'fan') && p.fan_from === 'edge',
			hint: 'Sets how close the combed lines draw together at the far edge, a share of Line spacing (1 = parallel)'
		}),
		P.float('hook', 'Hook', 1, 0, 4, {
			step: 0.01,
			group: 'motif',
			showIf: (p) => (p.motif === 'fan' || p.motif2 === 'fan') && p.fan_from === 'edge',
			hint: 'Curls the combed lines’ ends over into tongues, with Curl'
		}),
		P.float('sbend', 'S-bend', 0, -3, 3, {
			step: 0.01,
			group: 'motif',
			showIf: (p) => p.motif === 'fan' || p.motif2 === 'fan',
			hint: 'Bends the fan’s lines back the other way further out, into S curves like flames'
		}),
		P.float('curl', 'Curl', 1.2, -3, 3, {
			step: 0.01,
			group: 'motif',
			showIf: (p) => p.motif === 'fan' || p.motif === 'leaf' || p.motif2 === 'fan',
			hint: 'Bends the fan’s lines (or the leaf’s veins) into curves'
		}),
		P.int('lines_n', 'Line count', 0, 0, 32, {
			group: 'motif',
			showIf: (p) => p.motif === 'concentric' || p.motif === 'edge',
			hint: 'Draws only this many lines in from the outline (0 = all the way in)'
		}),
		P.float('straight', 'Straighten', 0, 0, 1, {
			step: 0.001,
			group: 'motif',
			showIf: (p) => p.motif === 'edge',
			hint: 'Straightens the copies of the edge into V’s (1 = straight chevrons)'
		}),
		P.float('blade_off', 'Blade jitter', 0.5, 0, 1, {
			step: 0.001,
			group: 'motif',
			showIf: (p) => p.motif === 'blades',
			hint: 'Gives each blade in each cell its own curl and length (0 = every fan alike)'
		}),
		P.float('blade_tilt', 'Blade lean', 15, -60, 60, {
			step: 0.1,
			group: 'motif',
			showIf: (p) => p.motif === 'blades',
			hint: 'Leans the blades as they leave the root, in degrees right of straight up'
		}),
		P.float('blade_w', 'Blade width', 6, 1, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.25,
			group: 'motif',
			showIf: (p) => p.motif === 'blades',
			hint: 'Sets how wide the blades are at their widest (Line spacing sets how far apart they lie)'
		}),
		P.float('sweep', 'Sweep', 110, 30, 180, {
			step: 0.1,
			group: 'motif',
			showIf: (p) => p.motif === 'blades',
			hint: 'Sets how far round the blades curl, in degrees'
		}),
		P.float('petal_len', 'Petal length', 0.62, 0.1, 1, {
			step: 0.001,
			group: 'motif',
			showIf: (p) => p.motif === 'petals',
			hint: 'Sets how far the petals reach, a share of the cell'
		}),
		P.float('petal_w', 'Petal slenderness', 1, 0.3, 6, {
			step: 0.01,
			group: 'motif',
			showIf: (p) => p.motif === 'petals',
			hint: 'Narrows the petals (higher) or broadens them (lower)'
		}),
		P.float('petal_tip', 'Petal tips', 0, 0, 1, {
			step: 0.001,
			group: 'motif',
			showIf: (p) => p.motif === 'petals',
			hint: 'Draws the petals’ tips to a point (0 = round)'
		}),
		P.float('petal2', 'Second petals', 0, 0, 1, {
			step: 0.001,
			group: 'motif',
			showIf: (p) => p.motif === 'petals',
			hint: 'Adds a ring of shorter petals between the main ones, this share of their length (0 = none)'
		}),
		P.float('petal_h', 'Petal height', 0, 0, 1, {
			step: 0.001,
			group: 'motif',
			showIf: (p) => p.motif === 'petals',
			hint: 'Raises the petals’ crowns above Body level, into the headroom above it (1 = to the top)'
		}),
		P.int('arms', 'Count', 6, 1, 24, {
			group: 'motif',
			showIf: (p) => (p.motif === 'fan' && p.fan_from !== 'edge') || ['spiral', 'petals'].includes(String(p.motif)),
			hint: 'Sets how many lines fan out from a point, spiral arms turn, or petals ring the flower'
		}),
		P.enum(
			'turn',
			'Turn cells',
			'none',
			[
				['none', 'Off'],
				['rows', 'Every other row'],
				['cols', 'Every other column'],
				['checker', 'Checkerboard']
			],
			{ group: 'motif', hint: 'Turns every other cell’s motif a quarter turn' }
		),
		P.float('boss', 'Node bosses', 0, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.25,
			group: 'cell',
			showIf: (p) => p.layout === 'diamonds' || p.layout === 'squares',
			hint: 'Sets the radius of a domed boss where the cells’ corners meet (0 = none)'
		})
	],
	groups: [
		{ id: 'cell', label: 'Cells' },
		{ id: 'motif', label: 'Motif' }
	],
	defaults: {
		bevel: 0,
		h_on: true,
		h_amount: 0.6,
		dif_on: true,
		dif_src: 'value',
		dif_grad: CARVE_RAMP
	},
	derivedUniforms: {
		decl: { k: 'vec2' },
		compute: (p, c) => ({ k: cells(p, c) })
	},
	glsl: /* glsl */ `
const float CRV_PI = 3.14159265;

// One cell under the pixel: distance in from its outline (px), local coordinates (px, y down, its "up" toward −y), its
// half size (px), kind (0 / 1) and id.
struct Cell {
  float e;
  vec2 lp;
  float S;
  int kind;
  ivec2 id;
  // Scales: how far outside the nearest scale lying over this one the pixel is (its edge's shadow).
  float over;
  // Diamonds and squares: the distance to the nearest lattice node (where the cells' corners meet).
  float nd;
};

// Pointed scale: two circles' lens of half width R (round when pt = 0).
float crv_scale(vec2 lp, float R, float pt) {
  float o = pt * R;
  return max(length(lp - vec2(o, 0.0)), length(lp + vec2(o, 0.0))) - (R + o);
}

Cell crv_cell(vec2 q, vec2 cell) {
  Cell C;
  C.kind = 0;
  C.over = 1e4;
  C.nd = 1e4;
  float w = cell.x, h = cell.y;
  if (u_layout == 0) {
    // Scales: rows h apart, staggered; each row lies over the one below, so a scale's free edge (and its point) shows.
    // Front first: the rows above, nearest first; in each, the two scales either side of the pixel. Pointed scales
    // reach further, so four rows are searched.
    float R = 0.5 * w;
    int j0 = int(floor(q.y / h));
    C.e = -1e4;
    C.over = 1e4;
    for (int k = 0; k < 8 * UNI_1; k++) {
      int j = j0 - 2 + k / 2;
      float sx = (j & 1) == 1 ? 0.5 : 0.0;
      int ii = int(floor(q.x / w - sx)) + (k & 1);
      {
        vec2 c = vec2((float(ii) + sx) * w, float(j) * h);
        float d = crv_scale(q - c, R, u_point);
        if (C.e < 0.0 && d < 0.0) {
          C.e = -d;
          C.lp = q - c;
          C.id = ivec2(ii, j);
        }
        // A scale in front that doesn't hold the pixel: how close its edge is.
        if (C.e < 0.0 && d >= 0.0) C.over = min(C.over, d);
      }
    }
    if (C.e < 0.0) { C.e = 0.0; C.lp = vec2(0.0); C.id = ivec2(0); }
    C.S = R;
  } else if (u_layout == 1) {
    // Ogee: cells 2h tall in staggered rows h apart, fitting together. A cell's half width at height u (0 = bottom tip,
    // 1 = top tip) is W(u) = ½·w·Waist·sin²(π·φ(u)); φ warps each half alike (φ(u + ½) = φ(u) + ½), so W(u) + W(u + ½)
    // = ½w and neighbours meet exactly. Onion: φ runs fast after each tip and slow before the next — a broad belly low
    // down, then a long drawn-out tip with concave sides; Onion 0 gives pointed lenses.
    float pw = 1.0 + 1.5 * u_onion;
    int n0 = int(floor(q.y / h));
    C.e = -1e4;
    for (int k = 0; k < 2 * UNI_1; k++) {
      int n = n0 - k;
      float sx = (n & 1) == 1 ? 0.5 : 0.0;
      float i = floor(q.x / w - sx + 0.5);
      float dx = q.x - (i + sx) * w;
      // u from the bottom tip on the sheet (q.y runs down it).
      float u = (float(n + 2) * h - q.y) / (2.0 * h);
      float f = fract(2.0 * u);
      float om = pow(1.0 - f, pw - 1.0);
      float ph = 0.5 * (floor(2.0 * u) + 1.0 - om * (1.0 - f));
      float sn = sin(CRV_PI * ph);
      float W = 0.5 * w * u_waist * sn * sn;
      // dW/dy = ½·w·Waist·π·sin(2πφ)·φ′(u) / 2h, φ′(u) = pw·(1 − f)^(pw − 1).
      float dW = 0.5 * w * u_waist * CRV_PI * sin(2.0 * CRV_PI * ph) * pw * om / (2.0 * h);
      float ek = (W - abs(dx)) / sqrt(1.0 + dW * dW);
      if (ek > C.e) {
        C.e = ek;
        C.lp = vec2(dx, q.y - (float(n) + 1.0) * h);
        C.id = ivec2(int(i), n);
      }
    }
    // Narrower than the gaps (Waist below 1): the gaps between the cells are the second kind.
    if (C.e < 0.0) {
      C.e = -C.e;
      C.kind = 1;
      C.lp = vec2(C.lp.x - sign(C.lp.x) * 0.5 * w, C.lp.y);
    }
    C.S = h;
  } else if (u_layout == 2) {
    // Wave bands: nb bands repeating down the texture. Each wave line j has its own deviation dv_j(x) = a_j·sin(kx·x + φ_j)
    // (in bands; a seeded swing up to 0.45 × Wave variation × (1 + 0.8·Pinch) and phase), so band j is T_j = 1 + dv_(j+1)
    // − dv_j thick — smoothly clamped at 0, and the lines placed at the running sums scaled to fill the repeat. The bands
    // swell and narrow and never cross; with Pinch the narrowest thin to nothing and their two lines merge. Wave height
    // swings all of them together.
    float A = u_amp * h;
    float kx = 2.0 * CRV_PI / w;
    int nb = clamp(int(d_k.y + 0.5), 1, 64);
    float P = float(nb) * h;
    float sn = sin(kx * q.x), cn = cos(kx * q.x);
    float yy = q.y - A * sn;
    float amax = 0.45 * u_wave_var * (1.0 + 0.8 * u_pinch);
    vec2 r0 = hash2I(ivec2(0, 17), uSeed);
    float a0 = amax * sqrt(r0.y);
    float dv0 = a0 * sin(kx * q.x + 6.2831853 * r0.x), dd0 = a0 * kx * cos(kx * q.x + 6.2831853 * r0.x);
    float tot = 0.0, dtot = 0.0;
    float target = 0.0, rep = 0.0, acc = 0.0, dacc = 0.0;
    float t0 = 0.0, t1 = 0.0, d0 = 0.0, d1 = 0.0;
    int j = nb - 1;
    bool found = false;
    // Two passes: the total first, then the band holding the pixel.
    for (int it = 0; it < 128 * UNI_1; it++) {
      int pass = it >= nb ? 1 : 0;
      int k = it - pass * nb;
      if (pass == 1 && k >= nb) break;
      if (pass == 1 && k == 0) {
        tot = max(tot, 1e-3);
        rep = floor(yy / P);
        target = (yy / P - rep) * tot;
      }
      vec2 r = hash2I(ivec2((k + 1) % nb, 17), uSeed);
      float a = amax * sqrt(r.y);
      float arg = kx * q.x + 6.2831853 * r.x;
      float dv1 = a * sin(arg), dd1 = a * kx * cos(arg);
      // A smooth max(T, 0) (no kink where a band pinches out: its lines' slopes stay continuous).
      float T = 1.0 + dv1 - dv0;
      float sq = sqrt(T * T + 0.01);
      float dT = 0.5 * (1.0 + T / sq) * (dd1 - dd0);
      T = 0.5 * (T + sq);
      if (pass == 0) {
        tot += T;
        dtot += dT;
      } else {
        if (!found && target < acc + T) {
          found = true;
          j = k;
          t0 = acc;
          t1 = acc + T;
          d0 = dacc;
          d1 = dacc + dT;
        }
        acc += T;
        dacc += dT;
      }
      dv0 = dv1;
      dd0 = dd1;
    }
    // The band's lines (px) and their slopes: P·t/tot (+ the common wave), d/dx = P·(t′·tot − t·tot′)/tot².
    float c0 = rep * P + P * t0 / tot + A * sn;
    float c1 = rep * P + P * t1 / tot + A * sn;
    float s0 = P * (d0 * tot - t0 * dtot) / (tot * tot) + A * kx * cn;
    float s1 = P * (d1 * tot - t1 * dtot) / (tot * tot) + A * kx * cn;
    float bh = max(c1 - c0, 1e-3);
    float fv = clamp((q.y - c0) / bh, 0.0, 1.0);
    C.e = max(min((q.y - c0) / sqrt(1.0 + s0 * s0), (c1 - q.y) / sqrt(1.0 + s1 * s1)), 0.0);
    C.lp = vec2(q.x, (fv - 0.5) * bh);
    C.id = ivec2(0, j + nb * int(rep));
    C.S = 0.5 * bh;
  } else if (u_layout == 3 || u_layout == 6) {
    // Circles on a square grid (overlapping: lenses and concave squares), or discs in staggered rows (touching, gaps
    // between).
    bool disc = u_layout == 6;
    // Discs: touching their nearest neighbours at Overlap 1 (across, or diagonally when the rows are close).
    float r = disc ? 0.5 * u_overlap * min(min(w, u_pack == 1 ? h : 1e9), u_pack == 0 ? sqrt(0.25 * w * w + h * h) : 1e9) : 0.70710678 * w * u_overlap;
    float best = 1e4;
    int inside = 0;
    vec2 c1 = vec2(0.0), c2 = vec2(0.0);
    vec2 base = floor(q / vec2(w, h));
    for (int k = 0; k < 9 * UNI_1; k++) {
      vec2 g = base + vec2(float(k % 3 - 1), float(k / 3 - 1));
      vec2 c = vec2((g.x + (disc && u_pack == 0 && mod(g.y, 2.0) > 0.5 ? 0.5 : 0.0)) * w, g.y * h);
      float l = length(q - c);
      best = min(best, abs(l - r));
      if (l < r) {
        if (inside == 0) c1 = c; else c2 = c;
        inside++;
      }
    }
    C.e = best;
    if (!disc && inside >= 2) {
      vec2 m = 0.5 * (c1 + c2);
      vec2 ax = normalize(c2 - c1);
      C.lp = vec2(dot(q - m, ax), dot(q - m, vec2(-ax.y, ax.x)));
      C.id = ivec2(floor(m * 2.0 / vec2(w, h) + 0.5));
    } else if (inside >= 1) {
      C.lp = q - c1;
      C.id = ivec2(floor(c1 / vec2(w, h) + 0.5));
      C.kind = 0;
      if (!disc) C.kind = 1;
    } else {
      vec2 g = floor(q / vec2(w, h)) + 0.5;
      C.lp = q - g * vec2(w, h);
      C.id = ivec2(floor(g)) + ivec2(1000);
      C.kind = 1;
    }
    C.S = disc ? r : 0.5 * w;
  } else {
    // Diamonds (a square grid turned 45°) or squares.
    bool dia = u_layout == 4;
    vec2 r = dia ? vec2(q.x / w + q.y / h, q.y / h - q.x / w) : q / vec2(w, h);
    vec2 g = floor(r);
    vec2 fr = r - g;
    float e01 = min(min(fr.x, 1.0 - fr.x), min(fr.y, 1.0 - fr.y));
    C.e = e01 * (dia ? 0.70710678 * w : min(w, h));
    vec2 cr = dia ? vec2((g.x - g.y) * 0.5, (g.x + g.y + 1.0) * 0.5) * vec2(w, h) : (g + 0.5) * vec2(w, h);
    C.lp = q - cr;
    C.id = ivec2(g);
    C.S = dia ? 0.5 * w : 0.5 * min(w, h);
    vec2 rn = floor(r + 0.5);
    C.nd = length(q - (dia ? vec2(rn.x - rn.y, rn.x + rn.y) * 0.5 : rn) * vec2(w, h));
  }
  return C;
}

GenOut gen(vec2 p) {
  vec2 q = vec2(p.x, uRes.y - p.y);
  vec2 cell = uRes / d_k;
  Cell C = crv_cell(q, cell);
  // Ids wrap with the texture when the counts are whole (tiling), so per-cell randomness repeats across the seams.
  // (Overlapping circles' lens ids count half cells; they keep theirs.)
  ivec2 idw = C.id;
  if (u_layout != 3 && fract(d_k.x) == 0.0 && fract(d_k.y) == 0.0) idw = ivec2(mod(vec2(C.id), d_k));
  float rnd = hashI(idw + ivec2(C.kind * 7919), uSeed);
  // Turned cells: a quarter turn for every other row / column / both.
  bool odd = u_turn == 1 ? (C.id.y & 1) == 1 : u_turn == 2 ? (C.id.x & 1) == 1 : u_turn == 3 ? ((C.id.x + C.id.y) & 1) == 1 : false;
  vec2 lp = odd ? vec2(-C.lp.y, C.lp.x) : C.lp;
  float S = max(C.S, 1.0);
  int mk = C.kind == 0 ? u_motif : u_motif2;

  // The body: from the floor at the outline up to the body level.
  float e = C.e;
  float body;
  // Petals: which ring the pixel's petal belongs to (1 = the shorter petals between the main ones).
  float ring = 0.0;
  if (mk == 7) {
    // Petals: the flower's outline is the body's — the main ring, and with Second petals a shorter ring turned half a
    // petal between them. Each petal lies along its own axis, lanceolate: widest about two fifths out, pointed at the
    // tip (rounded with Petal tips 0), its width set by Petal slenderness.
    float th = atan(lp.y, lp.x);
    float n = float(u_arms);
    float ef = -1e4;
    for (int k = 0; k < 2 * UNI_1; k++) {
      float fk = float(k);
      float L = (k == 0 ? u_petal_len : u_petal_len * u_petal2) * S;
      float ax = (floor(th * n / (2.0 * CRV_PI) - 0.5 * fk + 0.5) + 0.5 * fk) * 2.0 * CRV_PI / n;
      vec2 dir = vec2(cos(ax), sin(ax));
      float a = dot(lp, dir);
      float b = abs(dot(lp, vec2(-dir.y, dir.x)));
      float t = clamp(a / max(L, 1.0), 0.0, 1.0);
      float Wm = 0.7 * L * CRV_PI / (n * u_petal_w);
      float tp = pow(max(t, 1e-3), 0.75);
      float sw = sin(CRV_PI * tp);
      float hw = Wm * mix(sqrt(sw), sw, u_petal_tip);
      // The outline's slope along the axis, so the distance in is measured square to it (no cliff sides).
      float dhw = Wm * CRV_PI * cos(CRV_PI * tp) * 0.75 / pow(max(t, 0.02), 0.25) / max(L, 1.0);
      dhw *= mix(0.5 / sqrt(max(sw, 0.05)), 1.0, u_petal_tip);
      float ek = L > 0.0 ? min((hw - b) / sqrt(1.0 + dhw * dhw), min(a, L - a)) : -1e4;
      if (ek > ef) {
        ef = ek;
        ring = fk;
      }
    }
    e = min(e, ef);
  }
  // Domed bodies over the cell (the second kind — gaps between discs, circles — would crease into pyramids along
  // their ridges, so they are pillowed instead).
  bool domed = u_body == 2 && C.kind == 0;
  float t = domed ? clamp(e / S, 0.0, 1.0) : clamp(e / max(u_body_w, 0.5), 0.0, 1.0);
  body = u_body == 0 ? clamp(e + 0.5, 0.0, 1.0)
    : u_body == 4 ? t
    : sqrt(max(1.0 - (1.0 - t) * (1.0 - t), 0.0));
  float lvl = u_body_lvl + (C.kind == 1 ? u_lvl2 : 0.0);
  // Scales lie on one another: their edges drop only partway, onto the scale below.
  float floorLvl = u_layout == 0 ? mix(u_floor_lvl, lvl, 0.5) : u_floor_lvl;
  // Wave bands: a band pinched narrower than its share stands lower (no knife ridges at the pinches).
  if (u_layout == 2) lvl = mix(floorLvl, lvl, sqrt(clamp(2.0 * S / cell.y, 0.0, 1.0)));
  // Petals: the crowns rise above Body level by Petal height, further in from the petal's edge.
  float crown = mk == 7 ? u_petal_h * (1.0 - lvl) * clamp(e / max(2.0 * u_body_w, 1.0), 0.0, 1.0) : 0.0;
  float h = mix(floorLvl, lvl + crown, body);
  if (u_body == 3) h = mix(floorLvl, lvl, clamp(e / max(u_body_w, 0.5), 0.0, 1.0)) * (0.6 + 0.4 * clamp(0.5 + lp.y / S * 0.5, 0.0, 1.0));
  // A scale runs down under the edge of the one lying on it: low right at that edge, up to its body a Body edge away.
  if (u_layout == 0) h = mix(u_floor_lvl, h, clamp(C.over / max(u_body_w, 0.5), 0.0, 1.0));
  if (mk == 7 && e < 0.0) h = u_floor_lvl;

  // The motif: grooves along the isolines of a field φ (spacing 1 between lines), |∇φ| per px worked out per motif.
  float phi = 0.0, grad = 1.0;
  float sp = max(u_spacing, 1.0);
  // Blades: the distance from the blade's centre line (in half widths; > 1 outside it) and its half width (px).
  float bladeE = 2.0, bladeHw = 1.0;
  if (mk == 1) {
    phi = e / sp;
    grad = 1.0 / sp;
  } else if (mk == 2) {
    phi = lp.y / sp;
    grad = 1.0 / sp;
  } else if (mk == 3 && u_fan_from == 1) {
    // Combed: lines starting along one edge (y = S) and running across the cell, swept sideways by Curl (t²) and waved by
    // S-bend (a full sine up the cell): x = c + D(t), t = 0 at the bottom, 1 at the top.
    // The lines close in toward the far edge (m: their spacing, 1 → Closing) and hook over at their ends with Curl (t⁶),
    // like flame tips.
    float t = clamp((S - lp.y) / (2.0 * S), 0.0, 1.0);
    float D = S * (0.35 * u_curl * t * t + 0.25 * u_sbend * sin(2.0 * CRV_PI * t) + 0.25 * u_hook * u_curl * pow(t, 6.0));
    float dDt = S * (0.7 * u_curl * t + 0.5 * CRV_PI * u_sbend * cos(2.0 * CRV_PI * t) + 1.5 * u_hook * u_curl * pow(t, 5.0));
    // The spacing closes from 1 to Closing, but never below a 3 px pitch.
    float mt = u_fan_end - 1.0;
    float m = 1.0 + mt * t;
    if (sp * m < 3.0) { m = 3.0 / sp; mt = 0.0; }
    phi = (lp.x - D) / (sp * m);
    // ∂φ/∂y through t (dt/dy = −1 / 2S): −(D'·m + (x − D)·m') / (sp·m²).
    float dy = (dDt * m + (lp.x - D) * mt) / (2.0 * S * sp * m * m);
    grad = length(vec2(1.0 / (sp * m), dy));
  } else if (mk == 3) {
    // Fan from the bottom of the cell; Curl bends the lines with the distance.
    vec2 v = lp - vec2(0.0, 0.9 * S);
    float r = max(length(v), 0.5);
    float th = atan(v.x, -v.y);
    // Curl bends the lines; S-bend bends them back the other way further out (flame-like S curves).
    phi = th / CRV_PI * float(u_arms) + u_curl * r / S - 3.0 * u_sbend * r * r / (S * S);
    grad = sqrt(pow(float(u_arms) / (CRV_PI * r), 2.0) + pow(u_curl / S - 6.0 * u_sbend * r / (S * S), 2.0));
  } else if (mk == 4) {
    // Leaf: a midrib up the middle and veins leaving it toward the tip (−y, up the sheet), y = c + S·(0.6·x + 1.5·Curl·x²) (x from the
    // midrib in half heights): straight at Curl 0, sweeping up with it. Spaced along the midrib; they run on into the
    // outline (clipped by Margin) rather than turning along it.
    float ax = abs(lp.x) / S;
    float sl = 0.6 + 3.0 * u_curl * ax;
    phi = (-lp.y - S * (0.6 * ax + 1.5 * u_curl * ax * ax)) / sp;
    grad = sqrt(1.0 + sl * sl) / sp;
  } else if (mk == 5) {
    float r = max(length(lp), 0.5);
    phi = float(u_arms) * atan(lp.y, lp.x) / (2.0 * CRV_PI) + r / sp;
    grad = sqrt(pow(1.0 / sp, 2.0) + pow(float(u_arms) / (2.0 * CRV_PI * r), 2.0));
  } else if (mk == 6) {
    // Circles all touching at the bottom of the cell (centre (0, S − r), radius r): between them nested crescents, thick
    // at the bottom, their horns tapering up both sides. r for the pixel: (x² + Y²) / 2Y, Y = S − y.
    float Y = max(S - lp.y, 0.5);
    float r = (lp.x * lp.x + Y * Y) / (2.0 * Y);
    phi = r / sp;
    grad = length(vec2(lp.x / Y, 0.5 - 0.5 * lp.x * lp.x / (Y * Y))) / sp;
  } else if (mk == 8) {
    // Following the free edge: copies of the scale's lower edge stacked upward (chevrons on a pointed scale). The lower
    // edge of the lens: y = √((R + o)² − (|x| + o)²), o = Pointed tips × R; other layouts: the cell's bottom (y = S).
    float o = u_layout == 0 ? u_point * S : 0.0;
    float Rr = S + o;
    float ax = min(abs(lp.x) + o, Rr - 0.01);
    float yb = u_layout == 0 ? sqrt(Rr * Rr - ax * ax) : S;
    float slope = u_layout == 0 ? ax / max(yb, 0.01) : 0.0;
    // Straighten: toward a V from the bottom point to the cell's sides at its middle, its tip slightly rounded.
    float yb0 = u_layout == 0 ? sqrt(max(Rr * Rr - o * o, 0.0)) : S;
    float kr = 0.12 * S * (1.0 - u_straight) + 0.3;
    float sax = sqrt(lp.x * lp.x + kr * kr) - kr;
    yb = mix(yb, yb0 * (1.0 - sax / S), u_straight);
    slope = mix(slope, yb0 / S * abs(lp.x) / (sax + kr), u_straight);
    phi = (yb - lp.y) / sp;
    grad = sqrt(1.0 + slope * slope) / sp;
  } else if (mk == 7) {
    // Petals: a groove down each petal's middle (half a step round on the second ring) and a button at the centre.
    float r = max(length(lp), 0.5);
    phi = float(u_arms) * atan(lp.y, lp.x) / (2.0 * CRV_PI) + 0.5 * ring;
    grad = float(u_arms) / (2.0 * CRV_PI * r);
  } else if (mk == 9) {
    // Blades: a fan of curved blades from one root low in the cell. Blade k leaves the root in its own direction (the fan
    // centred on Blade lean, right of up; neighbours a Line spacing apart half a cell out) and curls clockwise round a
    // circle — the steeper ones wider, so each arches over the next. A blade's half width grows with the room between it
    // and its neighbours (≈ the arc length × the angle between them) up to Blade width, and it ends blunt after Sweep.
    // Blade jitter gives each blade in each cell its own direction, curl and length.
    grad = 1.0 / sp;
    // (y up here: lp's y runs down the sheet.)
    vec2 v0 = vec2(lp.x, -lp.y) - vec2(-0.35, -0.6) * S;
    float dA = clamp(sp / (0.45 * S), 0.1, 1.2);
    int nbl = int(clamp(floor(1.6 / dA) + 1.0, 1.0, 8.0));
    for (int k = 0; k < 8 * UNI_1; k++) {
      if (k >= nbl) break;
      float fk = float(k) - 0.5 * float(nbl - 1);
      float j1 = fract(float(k) * 0.618 + 7.31 * rnd);
      float j2 = fract(float(k) * 0.382 + 3.17 * rnd + 0.5);
      float a = radians(u_blade_tilt) + (fk + 0.3 * u_blade_off * (j1 - 0.5)) * dA;
      vec2 t0 = vec2(sin(a), cos(a));
      vec2 nn = vec2(cos(a), -sin(a));
      float rho = S * max(0.85 - 0.15 * fk, 0.25) * (1.0 + 0.3 * u_blade_off * (j2 - 0.5));
      vec2 v = v0 - nn * rho;
      float r = length(v);
      float th = atan(dot(v, t0), -dot(v, nn));
      float th1 = radians(u_sweep) * (1.0 - 0.3 * u_blade_off * fract(j1 + j2));
      // Thin toward the cell's outline rather than cut off by it.
      float hw = min(min(0.5 * u_blade_w, 0.4 * rho * max(th, 0.0) * dA + 0.3), 0.7 * max(C.e - 1.0, 0.0));
      float el = r * (th1 - th);
      float bk = th > 0.0 && hw > 0.25 ? length(vec2(abs(r - rho), max(hw - el, 0.0))) / hw : 2.0;
      if (bk < bladeE) {
        bladeE = bk;
        bladeHw = hw;
      }
    }
  }
  float grooveCov = 0.0;
  if (mk != 0) {
    float dist = abs(phi - floor(phi + 0.5)) / max(grad, 1e-4);
    // Lines closer than ~2 px fade out instead of aliasing (fans and crescents converge; spirals wind in).
    float room = clamp((1.0 / max(grad, 1e-4) - 2.0) / 1.5, 0.0, 1.0);
    // A limited count of lines in from the outline (Following the outline).
    float nth = floor(phi + 0.5);
    if ((mk == 1 || mk == 8) && u_lines_n > 0 && (nth < 1.0 || nth > float(u_lines_n))) room = 0.0;
    // Following the outline: no innermost ring closing to a dot (it must enclose at least ¾ of a spacing).
    if (mk == 1 && nth > S / sp - 0.75) room = 0.0;
    float half_ = 0.5 / max(grad, 1e-4);
    float fade = clamp((e - u_margin) / 1.5, 0.0, 1.0);
    // Scales: grooves fade out in the shadow where a scale runs down under the edge of the one lying on it (no ring
    // cutting a second step into that slope).
    // Blades tuck under that edge the same way.
    if (u_layout == 0) fade *= clamp(C.over / max(mk == 9 ? bladeHw + 1.0 : 0.5 * u_body_w, 0.5), 0.0, 1.0);
    // Petals: the midribs fade out well before the centre, under its boss (they would alias where they converge).
    if (mk == 7) fade *= smoothstep(0.26 * S, 0.4 * S, length(lp));
    // A spiral's eye: the arms fade out round the centre into a small round boss (no 1-px spike where they meet).
    if (mk == 5) fade *= smoothstep(0.25 * sp, 0.75 * sp, length(lp));
    float g;
    if (mk == 9) {
      // A blade stands up from the ground with a round cross-section (falling to the ground on both sides, no flat top),
      // meeting the ground in a fillet a pixel past its edge, lower where it tapers.
      g = (1.0 - smoothstep(0.0, 1.0 + 1.0 / max(bladeHw, 0.5), bladeE)) * clamp(bladeHw / max(0.5 * u_blade_w, 0.5), 0.3, 1.0);
    } else if (u_reed && mk != 7) {
      // The groove's floor rounded over ~1.5 px (a sharp V cusp aliases into beads along diagonals).
      float s = clamp((sqrt(dist * dist + 2.25) - 1.5) / max(half_ - 1.5, 0.5), 0.0, 1.0);
      g = 1.0 - sqrt(max(1.0 - (1.0 - s) * (1.0 - s), 0.0));
    } else {
      // A petal's midrib is a fine line whatever the groove width (a wide one would eat a slender petal).
      // Elsewhere no wider than 0.7 of the local pitch (where the lines close in).
      float gw = mk == 7 ? min(u_groove_w, 1.2) : min(u_groove_w, 0.7 / max(grad, 1e-4));
      float s = clamp(dist / (0.5 * gw + 0.35), 0.0, 1.0);
      g = sqrt(max(1.0 - s * s, 0.0));
    }
    // A spiral's outer arm runs into the outline: the last band (no groove left between it and the outline) sinks into
    // the groove as it narrows below one spacing (fully below half a spacing), instead of leaving a thin crescent.
    // (Not held back by Margin: it reaches the outline groove.)
    float sink = 0.0;
    if (mk == 5) {
      float f = fract(phi);
      if (e < (1.0 - f) * sp) sink = clamp((sp - f * sp - e) / (0.5 * sp), 0.0, 1.0);
    }
    // The leaf's midrib, stopping short of the lens's tips.
    if (mk == 4) g = max(g, clamp(1.0 - abs(lp.x) / (0.5 * u_groove_w + 0.5), 0.0, 1.0) * clamp((e - max(u_margin, 0.12 * S)) / 3.0, 0.0, 1.0));
    // A petal's midrib is a shallow vein, not a channel.
    grooveCov = max(g * fade * room * (mk == 7 ? 0.45 : 1.0), sink);
    h += (mk == 9 ? 1.0 : -1.0) * u_groove_d * grooveCov;
    if (mk == 7) h = max(h, mix(h, lvl + crown + 0.08, sqrt(max(1.0 - pow(length(lp) / (0.26 * S), 2.0), 0.0))));
  }
  // The outline: a groove (or a raised rib) along it.
  if (u_outline_w > 0.0) {
    float ol = clamp(1.0 - C.e / (0.5 * u_outline_w + 0.35), 0.0, 1.0);
    // A groove cuts down from the surface — where a motif groove runs into it, only the deeper of the two (no pit); a
    // rib (negative depth) stands up from the body's top, rounded.
    float cutG = mk == 9 ? 0.0 : u_groove_d * grooveCov;
    if (u_outline_d >= 0.0) h += cutG - max(cutG, u_outline_d * ol);
    // A rib: rounded, standing from the surface into the headroom above the body (Outline depth −1 = to the top).
    // Flat-topped: 1 − (1 − ol)³ (level across its middle, sloping at its sides).
    else if (ol > 0.0) h = max(h, mix(h, lvl + (-u_outline_d) * (1.0 - lvl), 1.0 - pow(1.0 - ol, 3.0)));
  }

  // Bosses where the lattice's corners meet: domes rising from the floor a little above the ribs (or the bodies).
  float bossTop = lvl + max(-u_outline_d, 0.0) * (1.0 - lvl);
  bossTop += 0.4 * (1.0 - bossTop);
  if (u_boss > 0.0) h = max(h, mix(u_floor_lvl, bossTop, sqrt(max(1.0 - pow(C.nd / u_boss, 2.0), 0.0))) - (C.nd < u_boss ? 0.0 : 1.0));

  if (u_output == 1) return genOut(1.0, 1.0, rnd, -C.e + 0.5 * u_outline_w);
  if (u_output == 2) return genOut(1.0, 1.0, rnd, 0.5 - grooveCov);
  GenOut o = genOutOwn(clamp(h, 0.0, 1.0), 1.0, rnd, -C.e + 0.5 * u_outline_w);
  o.feat = 0.0;
  return o;
}
`
};
