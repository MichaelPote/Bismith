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
	['ogee', 'Ogee', 'Pointed lenses between crossing waves, in staggered columns, with the gaps between them'],
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
	['edge', 'Following the free edge', 'Copies of a scale’s lower edge stacked upward: chevrons on pointed scales']
];

/** Cells across and down: whole when tiling, the layout's natural height × Aspect. */
function cells(p: ParamValues, c: LayerCanvas): [number, number] {
	const lay = String(p.layout);
	const across = Math.max(0.5, Number(p.cols) || 4);
	const kx = c.tileable ? Math.max(1, Math.round(across)) : across;
	const w = c.width / kx;
	// The layout's row pitch in widths: scales overlap by half, ogee lenses and discs stagger by √3/2.
	const natural =
		lay === 'scales'
			? 0.5
			: lay === 'ogee'
				? 0.9
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
			hint: 'Stretches the cells vertically'
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
			hint: 'Gives each wave its own phase and swing, so the bands swell and narrow'
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
			hint: 'Sets how wide the lenses swell (1 = neighbours touch)'
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
			hint: 'Sets the height of the cells’ bodies'
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
			hint: 'Sets the distance between neighbouring grooves'
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
			hint: 'Sets how deep the grooves cut'
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
		P.float('sbend', 'S-bend', 0, -3, 3, {
			step: 0.01,
			group: 'motif',
			showIf: (p) => p.motif === 'fan',
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
		P.float('petal_len', 'Petal length', 0.62, 0.1, 1, {
			step: 0.001,
			group: 'motif',
			showIf: (p) => p.motif === 'petals',
			hint: 'Sets how far the petals reach, a share of the cell'
		}),
		P.float('petal_w', 'Petal slenderness', 1.4, 0.3, 6, {
			step: 0.01,
			group: 'motif',
			showIf: (p) => p.motif === 'petals',
			hint: 'Narrows the petals (higher) or broadens them (lower)'
		}),
		P.int('arms', 'Count', 6, 1, 24, {
			group: 'motif',
			showIf: (p) => ['fan', 'spiral', 'petals'].includes(String(p.motif)),
			hint: 'Sets how many lines fan out, spiral arms turn, or petals ring the flower'
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
		)
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
    // Ogee: crossing waves x = i·w ± A·sin(πy/h) make pointed lenses down each column; their gaps the second kind.
    float A = 0.5 * w * u_waist;
    float s = sin(CRV_PI * q.y / h);
    float nrm = sqrt(1.0 + pow(A * CRV_PI / h * cos(CRV_PI * q.y / h), 2.0));
    float i = floor(q.x / w + 0.5);
    float dx = q.x - i * w;
    float n = floor(q.y / h);
    if (abs(dx) < A * abs(s)) {
      C.e = (A * abs(s) - abs(dx)) / nrm;
      C.lp = vec2(dx, q.y - (n + 0.5) * h);
      C.id = ivec2(int(i), int(n));
    } else {
      float sg = dx < 0.0 ? -1.0 : 1.0;
      float other = w - abs(dx);
      C.e = min(abs(dx) - A * abs(s), other - A * abs(s)) / nrm;
      float ny = floor(q.y / h + 0.5);
      C.lp = vec2(dx - sg * 0.5 * w, q.y - ny * h);
      C.kind = 1;
      C.id = ivec2(int(i) * 2 + int(sg), int(ny));
    }
    C.S = 0.5 * h;
  } else if (u_layout == 2) {
    // Wave bands: band j lies between waves j and j + 1; with Wave variation each wave has its own phase and swing,
    // so the bands swell and narrow (per wave, repeating down the texture).
    float A = u_amp * h;
    float kx = 2.0 * CRV_PI / w;
    int nb = max(int(d_k.y + 0.5), 1);
    int j = int(floor((q.y - A * sin(kx * q.x)) / h));
    float c0 = 0.0, c1 = 0.0, s0 = 0.0, s1 = 0.0;
    for (int it = 0; it < 3 * UNI_1; it++) {
      // The two waves round band j; step j until the pixel lies between them.
      vec2 r0 = vec2(hashI(ivec2(((j % nb) + nb) % nb, 3), uSeed), hashI(ivec2(((j % nb) + nb) % nb, 4), uSeed));
      vec2 r1 = vec2(hashI(ivec2((((j + 1) % nb) + nb) % nb, 3), uSeed), hashI(ivec2((((j + 1) % nb) + nb) % nb, 4), uSeed));
      // At variation 1: swings from 0 to twice the height, phases anywhere.
      float a0 = A * (1.0 + 2.0 * u_wave_var * (r0.y - 0.5)), a1 = A * (1.0 + 2.0 * u_wave_var * (r1.y - 0.5));
      float p0 = u_wave_var * 6.2831853 * (r0.x - 0.5), p1 = u_wave_var * 6.2831853 * (r1.x - 0.5);
      c0 = float(j) * h + a0 * sin(kx * q.x + p0);
      c1 = float(j + 1) * h + a1 * sin(kx * q.x + p1);
      s0 = a0 * kx * cos(kx * q.x + p0);
      s1 = a1 * kx * cos(kx * q.x + p1);
      if (q.y < c0) j -= 1;
      else if (q.y >= c1) j += 1;
    }
    float bh = max(c1 - c0, 1.0);
    float fv = clamp((q.y - c0) / bh, 0.0, 1.0);
    C.e = min((q.y - c0) / sqrt(1.0 + s0 * s0), (c1 - q.y) / sqrt(1.0 + s1 * s1));
    C.e = max(C.e, 0.0);
    C.lp = vec2(q.x, (fv - 0.5) * bh);
    C.id = ivec2(0, j);
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
  }
  return C;
}

GenOut gen(vec2 p) {
  vec2 q = vec2(p.x, uRes.y - p.y);
  vec2 cell = uRes / d_k;
  Cell C = crv_cell(q, cell);
  float rnd = hashI(C.id + ivec2(C.kind * 7919), uSeed);
  // Turned cells: a quarter turn for every other row / column / both.
  bool odd = u_turn == 1 ? (C.id.y & 1) == 1 : u_turn == 2 ? (C.id.x & 1) == 1 : u_turn == 3 ? ((C.id.x + C.id.y) & 1) == 1 : false;
  vec2 lp = odd ? vec2(-C.lp.y, C.lp.x) : C.lp;
  float S = max(C.S, 1.0);
  int mk = C.kind == 0 ? u_motif : u_motif2;

  // The body: from the floor at the outline up to the body level.
  float e = C.e;
  float body;
  if (mk == 7) {
    // Petals: the flower's outline is the body's.
    float th = atan(lp.y, lp.x);
    float n2 = float(u_arms) * 0.5;
    float cs = abs(cos(n2 * th));
    float R = u_petal_len * S * (0.25 + 0.75 * pow(cs, u_petal_w));
    // The distance in from the petal's outline, not its radial depth (slender petals would get cliff sides): the radial
    // difference over the outline's slope, dR/dθ = L·S·0.75·w·c^(w−1)·n/2·|sin|.
    float r = max(length(lp), 0.5);
    float dR = u_petal_len * S * 0.75 * u_petal_w * pow(max(cs, 1e-3), u_petal_w - 1.0) * n2 * abs(sin(n2 * th));
    e = min(e, (R - r) / sqrt(1.0 + pow(dR / r, 2.0)));
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
  float h = mix(floorLvl, lvl, body);
  if (u_body == 3) h = mix(floorLvl, lvl, clamp(e / max(u_body_w, 0.5), 0.0, 1.0)) * (0.6 + 0.4 * clamp(0.5 + lp.y / S * 0.5, 0.0, 1.0));
  // A scale runs down under the edge of the one lying on it: low right at that edge, up to its body a Body edge away.
  if (u_layout == 0) h = mix(u_floor_lvl, h, clamp(C.over / max(u_body_w, 0.5), 0.0, 1.0));
  if (mk == 7 && e < 0.0) h = u_floor_lvl;

  // The motif: grooves along the isolines of a field φ (spacing 1 between lines), |∇φ| per px worked out per motif.
  float phi = 0.0, grad = 1.0;
  float sp = max(u_spacing, 1.0);
  if (mk == 1) {
    phi = e / sp;
    grad = 1.0 / sp;
  } else if (mk == 2) {
    phi = lp.y / sp;
    grad = 1.0 / sp;
  } else if (mk == 3) {
    // Fan from the bottom of the cell; Curl bends the lines with the distance.
    vec2 v = lp - vec2(0.0, 0.9 * S);
    float r = max(length(v), 0.5);
    float th = atan(v.x, -v.y);
    // Curl bends the lines; S-bend bends them back the other way further out (flame-like S curves).
    phi = th / CRV_PI * float(u_arms) + u_curl * r / S - 3.0 * u_sbend * r * r / (S * S);
    grad = sqrt(pow(float(u_arms) / (CRV_PI * r), 2.0) + pow(u_curl / S - 6.0 * u_sbend * r / (S * S), 2.0));
  } else if (mk == 4) {
    // Leaf: veins rising from a midrib down the middle, curving up toward the tip (−y).
    // Veins y = c − 0.6·x − 1.5·curl·x² (x from the midrib, in half widths): straight at Curl 0, sweeping up with it.
    float ax = abs(lp.x) / S;
    // Rising from the midrib toward the tip (−y); spacing measured across the veins.
    float sl = 0.6 + 3.0 * u_curl * ax;
    phi = (-lp.y - S * (0.6 * ax + 1.5 * u_curl * ax * ax)) / sp * sqrt(1.0 + 0.36);
    grad = sqrt(1.0 + sl * sl) / sp * sqrt(1.0 + 0.36);
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
    phi = (yb - lp.y) / sp;
    grad = sqrt(1.0 + slope * slope) / sp;
  } else if (mk == 7) {
    // Petals: a groove down each petal's middle and a button at the centre.
    float r = max(length(lp), 0.5);
    phi = float(u_arms) * atan(lp.y, lp.x) / (2.0 * CRV_PI);
    grad = float(u_arms) / (2.0 * CRV_PI * r);
  }
  float grooveCov = 0.0;
  if (mk != 0) {
    float dist = abs(phi - floor(phi + 0.5)) / max(grad, 1e-4);
    // Lines closer than ~2 px fade out instead of aliasing (fans and crescents converge; spirals wind in).
    float room = clamp((1.0 / max(grad, 1e-4) - 2.0) / 1.5, 0.0, 1.0);
    // A limited count of lines in from the outline (Following the outline).
    float nth = floor(phi + 0.5);
    if ((mk == 1 || mk == 8) && u_lines_n > 0 && (nth < 1.0 || nth > float(u_lines_n))) room = 0.0;
    float half_ = 0.5 / max(grad, 1e-4);
    float fade = clamp((e - u_margin) / 1.5, 0.0, 1.0);
    if (mk == 7) fade *= clamp((length(lp) - 0.22 * S) / 1.5, 0.0, 1.0);
    float g;
    if (u_reed && mk != 7) {
      float s = clamp(dist / max(half_, 0.5), 0.0, 1.0);
      g = 1.0 - sqrt(max(1.0 - (1.0 - s) * (1.0 - s), 0.0));
    } else {
      // A petal's midrib is a fine line whatever the groove width (a wide one would eat a slender petal).
      float gw = mk == 7 ? min(u_groove_w, 1.2) : u_groove_w;
      float s = clamp(dist / (0.5 * gw + 0.35), 0.0, 1.0);
      g = sqrt(max(1.0 - s * s, 0.0));
    }
    // The leaf's midrib.
    if (mk == 4) g = max(g, clamp(1.0 - abs(lp.x) / (0.5 * u_groove_w + 0.5), 0.0, 1.0));
    // A petal's midrib is a shallow vein, not a channel.
    grooveCov = g * fade * room * (mk == 7 ? 0.45 : 1.0);
    h -= u_groove_d * grooveCov;
    if (mk == 7) h = max(h, mix(h, lvl + 0.08, sqrt(max(1.0 - pow(length(lp) / (0.22 * S), 2.0), 0.0))));
  }
  // The outline: a groove (or a raised rib) along it.
  if (u_outline_w > 0.0) {
    float ol = clamp(1.0 - C.e / (0.5 * u_outline_w + 0.35), 0.0, 1.0);
    // A groove cuts down from the surface; a rib (negative depth) stands up from the body's top, rounded.
    if (u_outline_d >= 0.0) h -= u_outline_d * ol;
    // A rib: rounded, standing from the surface into the headroom above the body (Outline depth −1 = to the top).
    else if (ol > 0.0) h = max(h, mix(h, lvl + (-u_outline_d) * (1.0 - lvl), sqrt(ol)));
  }

  if (u_output == 1) return genOut(1.0, 1.0, rnd, -C.e + 0.5 * u_outline_w);
  if (u_output == 2) return genOut(1.0, 1.0, rnd, 0.5 - grooveCov);
  GenOut o = genOutOwn(clamp(h, 0.0, 1.0), 1.0, rnd, -C.e + 0.5 * u_outline_w);
  o.feat = 0.0;
  return o;
}
`
};
