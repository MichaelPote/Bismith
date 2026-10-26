// Mask area (FR8.23; was Crevices & high spots, FR8.13): a generator that only selects areas — it draws no layout of its
// own, it picks parts of what is already there, and writes them to a mask (Mask › Write to) for the layers after it to
// be limited to, or paints them directly.
//   Select › The surface: from the relief the layers above built — crevices (lower than around them), high spots, both,
//     slopes, slopes facing a direction (every bottom edge), or a height range.
//   Select › Features of a mask: from the shapes a mask holds — Inside (the mask's shape itself, with each feature's
//     random, so Source › Random and Per-feature variation work per brick), or a Gradient across each feature along a
//     direction (bottom to top of every block), or a band in from its edge on that side.
// Breakup pulls any selection down by fBm noise before Shaping, so its edge ends raggedly (edge wear, uneven grime).

import { P, type ParamValues } from '@/core/params';
import { SHAPE_MASK } from '@/core/project';
import type { LayerDef } from '../types';

const features = (p: ParamValues) => p.select === 'features';
const surface = (p: ParamValues) => !features(p);
const find =
	(...modes: string[]) =>
	(p: ParamValues) =>
		surface(p) && modes.includes(String(p.find ?? 'crevices'));
const gradient = (p: ParamValues) => features(p) && p.area === 'gradient';
/** The mask's own shape, as a distance (Inside without Breakup): the Edge controls apply and a write is a shape. */
const inside = (p: ParamValues) => features(p) && (p.area ?? 'inside') === 'inside' && !(Number(p.bk_amount ?? 0) > 0);

export const surfaceMaskLayer: LayerDef = {
	type: 'surfacemask',
	label: 'Mask area',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	sdfShowIf: (p) => inside(p),
	// Unlike maskWriteKind's rule for shape layers, a coverage selection may go into the Shape mask too, when asked.
	maskWrite: (p) => (inside(p) ? 'shape' : 'coverage'),
	maskSource: (p) => (features(p) ? String(p.src_mask ?? '').trim() || SHAPE_MASK : null),
	// Inside a plain coverage (no distance to bevel) its value is that coverage: 1 but at the edges.
	coverageOnly: (p, src) => inside(p) && src?.plain === true,
	description:
		'Selects areas, to write to a mask or paint directly: from the surface so far (crevices, high spots, slopes, slopes facing a direction, a height range) or from the features of a mask (inside each one with its own random, or a gradient across each). Breakup frays the selection with noise.',
	params: [
		P.enum('select', 'Select', 'surface', [
			['surface', 'The surface', 'from the relief the layers above built'],
			['features', 'Features of a mask', 'from the shapes a mask holds: each brick, cell or plate']
		]),
		P.enum(
			'find',
			'Find',
			'crevices',
			[
				['crevices', 'Crevices', 'lower than the surface around them'],
				['high', 'High spots', 'higher than the surface around them'],
				['both', 'Both'],
				['slopes', 'Slopes', 'steep anywhere'],
				[
					'facing',
					'Facing a direction',
					'slopes turned towards Direction: every bottom edge, the lit side of each bump'
				],
				['height', 'Height range', 'above or below a level']
			],
			{ showIf: surface }
		),
		P.float('radius', 'Radius', 8, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			showIf: find('crevices', 'high', 'both', 'slopes', 'facing'),
			hint: 'How far around each pixel the surface is looked at: crevices and high spots look out to 3× this (a gap up to about 6× as wide fills), slopes are measured across half of it (grain finer than that doesn’t count)'
		}),
		P.float('wall', 'Wall slope', 0.06, 0.005, 4, {
			softMax: 0.5,
			step: 0.001,
			hint: 'How steeply the surface must rise to the walls on both sides of a crevice (or fall away all round a high spot) for a full mask, in height px per px: mortar a pixel deep between bricks a few px across is about 0.1; soft noise wants 0.01–0.02. Lower finds shallower dips',
			showIf: find('crevices', 'high', 'both')
		}),
		P.float('steep', 'Full at slope', 0.2, 0.02, 16, {
			softMax: 2,
			step: 0.01,
			hint: 'Slope (height px per px; 1 = 45°) that gives a full mask: fine relief rises a pixel or two over several, so a fifth is steep here',
			showIf: find('slopes', 'facing')
		}),
		P.float('hlevel', 'Height level', 0.5, -16, 16, {
			softMin: 0,
			softMax: 1,
			step: 0.001,
			showIf: find('height'),
			hint: 'The height that divides above from below, in height units (1 = the project’s Height depth in px)'
		}),
		P.enum(
			'hside',
			'Side',
			'above',
			[
				['above', 'Above'],
				['below', 'Below']
			],
			{ showIf: find('height') }
		),
		P.text('src_mask', 'Mask', SHAPE_MASK, {
			mask: 'read',
			showIf: features,
			hint: 'The mask whose features this selects, by name (Shape: the one shape layers write)'
		}),
		P.enum(
			'area',
			'Area',
			'inside',
			[
				[
					'inside',
					'Inside',
					'the mask’s shape itself, each feature with its own random (Source › Random, Per-feature variation); a mask no shape wrote (noise with a cutoff, Stone blocks’ joints) paints its coverage as the value too, as its writer would'
				],
				[
					'gradient',
					'Gradient',
					'a ramp across each feature along Direction: 1 at the side it faces, 0 at the far side'
				]
			],
			{ showIf: features }
		),
		P.enum(
			'across',
			'Across',
			'whole',
			[
				['whole', 'The whole feature', 'from the far side to the near one'],
				['edge', 'A band at the edge', 'only Width px in from the side Direction faces']
			],
			{ showIf: gradient }
		),
		P.float('width', 'Width', 4, 0.5, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			showIf: (p) => gradient(p) && p.across === 'edge',
			hint: 'How far in from the mask’s outline the band reaches (a bevel inside the outline is part of it)'
		}),
		P.float('band_soft', 'Band softness', 0.5, 0, 1, {
			step: 0.001,
			showIf: (p) => gradient(p) && p.across === 'edge',
			hint: 'The share of the band that fades out towards its inner end: 0 a crisp band, 1 a ramp all the way from the edge'
		}),
		P.float('dir', 'Direction', 180, 0, 360, {
			step: 1,
			unit: '°',
			showIf: (p) => find('facing')(p) || gradient(p),
			hint: 'Which way, in degrees round the texture: 0 top, 90 right, 180 bottom, 270 left'
		}),
		P.float('spread', 'Spread', 60, 1, 180, {
			step: 1,
			unit: '°',
			showIf: find('facing'),
			hint: 'How far round from Direction a slope may face and still count (degrees, fading to its edge)'
		}),
		P.float('reach', 'Max feature size', 128, 8, 1024, {
			softMax: 256,
			unit: 'px',
			step: 1,
			showIf: gradient,
			hint: 'How far the gradient looks for a feature’s edge: features longer than this ramp over this length only'
		}),
		P.float('level', 'Level', 0.2, 0, 1, {
			step: 0.001,
			showIf: (p) => surface(p) && !find('height')(p),
			hint: 'Ignore anything weaker than this'
		}),
		P.float('softness', 'Softness', 0.5, 0, 1, {
			step: 0.001,
			showIf: surface,
			hint: 'How gradually the mask rises above the level (0 = hard edge). For a Height range: how far either side of the Height level it fades, in height units'
		}),
		P.float('bk_amount', 'Breakup', 0, 0, 1, {
			step: 0.001,
			section: 'Breakup',
			hint: 'Pulls the selection down by noise, so its edge ends raggedly — in patches and flecks with a Cutoff (Shaping), mottled without: chipped edge wear, grime that stops unevenly'
		}),
		P.float('bk_scale', 'Breakup size', 16, 1, 1024, {
			softMax: 64,
			unit: 'px',
			step: 0.1,
			section: 'Breakup',
			showIf: (p) => Number(p.bk_amount ?? 0) > 0,
			hint: 'Size of the noise’s blotches'
		}),
		P.seed('bk_seed', 'Breakup seed', 1, { section: 'Breakup', showIf: (p) => Number(p.bk_amount ?? 0) > 0 })
	],
	defaults: { mk_target: 'Crevices', dif_on: false, h_on: false, bevel: 0, profile: 'flat' },
	glsl: /* glsl */ `
float sm_h(vec2 px) { return sampleT(tSurface, px).r * uDepth; }
vec4 ma_src(vec2 q) { return fetchT(tMaskSrc, ivec2(floor(q))); }

// Breakup: fBm noise in 0..1, Breakup size px blotches (periodic when tiling); shifted by a feature's random, so each
// brick frays its own way.
float ma_breakup(vec2 p, float fid) {
  vec2 cells = cellsFor(uRes.x / max(u_bk_scale, 1.0), 1.0);
  vec2 shift = fid >= 0.0 ? vec2(fid * 37.0, fract(fid * 91.7) * 23.0) : vec2(0.0);
  return fbm(p / uRes * cells + shift, periodOf(cells), 4, float(u_bk_seed) * 7.31 + 3.0);
}

// Direction (degrees round the texture, 0 = top, 90 = right) as a GL vector (y up).
vec2 ma_dir() { float a = radians(u_dir); return vec2(sin(a), cos(a)); }

// Surface modes: the selection's strength before Level / Softness, 0..1.
float ma_surface(vec2 p) {
  if (u_find == 5) {
    // Height range: Softness either side of the level, in height units.
    float s = max(u_softness, 1e-3);
    float hm = smoothstep(u_hlevel - s, u_hlevel + s, sampleT(tSurface, p).r);
    return u_hside == 0 ? hm : 1.0 - hm;
  }
  float h0 = sm_h(p);
  if (u_find >= 3) {
    // The slope across half the Radius (bilinear samples): grain finer than that averages out.
    float r = max(0.5 * u_radius, 1.0);
    vec2 g = vec2(sm_h(p + vec2(r, 0.0)) - sm_h(p - vec2(r, 0.0)), sm_h(p + vec2(0.0, r)) - sm_h(p - vec2(0.0, r))) / (2.0 * r);
    float slope = length(g) / max(u_steep, 1e-3);
    if (u_find == 3) return slope;
    // Facing: the slope's downhill side (its face's outward direction) against Direction, fading over Spread.
    float c = length(g) > 1e-6 ? dot(-g / length(g), ma_dir()) : -1.0;
    float c0 = cos(radians(u_spread));
    return slope * smoothstep(c0, mix(c0, 1.0, 0.5), c);
  }
  // Crevices: how walled in the pixel is — in each of 8 directions the steepest rise from it to the surface out to 3×
  // the Radius (at distances doubling from an eighth of it), over Wall slope; each opposite pair counts the lesser of
  // its two (walls on both sides — a plane, rising one way and falling the other, gives nothing), the mean over the four
  // pairs. A joint or a wide gap fills; a low spot on a slope doesn't. High spots: the steepest drop instead. One flat
  // loop over all 48 samples (nested loops of samples compile slowly on D3D).
  float reach = 3.0 * max(u_radius, 0.5);
  float st = max(u_wall, 1e-3);
  float up = 0.0, dn = 0.0;
  vec4 u4 = vec4(0.0), d4 = vec4(0.0), u4b = vec4(0.0), d4b = vec4(0.0);
  for (int j = 0; j < 48 * UNI_1; j++) {
    int dir = j / 6, k = j - dir * 6;
    float a = 0.7853982 * float(dir);
    float dist = reach * exp2(float(k) - 5.0);
    float dh = (sm_h(p + vec2(cos(a), sin(a)) * dist) - h0) / dist;
    up = k == 0 ? dh : max(up, dh);
    dn = k == 0 ? -dh : max(dn, -dh);
    if (k == 5) {
      vec4 sel = vec4(equal(ivec4(dir & 3), ivec4(0, 1, 2, 3)));
      float cu = clamp(up / st, 0.0, 1.0), cd = clamp(dn / st, 0.0, 1.0);
      if (dir < 4) { u4 += sel * cu; d4 += sel * cd; } else { u4b += sel * cu; d4b += sel * cd; }
    }
  }
  // (A pair is walled only if both its sides rise; the high-spot pairs, both sides falling. A spot that falls on one side
  // and rises on the other — the shoulder of a slope — gives neither.)
  vec4 pu = min(u4, u4b), pd = min(d4, d4b);
  float crev = dot(pu, vec4(0.25)), high = dot(pd, vec4(0.25));
  float best = u_find == 0 ? crev : u_find == 1 ? high : max(crev, high);
  return best;
}

// Gradient: how far the feature at p reaches ahead along Direction and behind it (px), up to Max feature size. One flat
// loop over both sides: steps of the stored distance (at most 8 px, so a neighbour that touches isn't jumped) while
// inside the feature — the same mask inside, the same random where it has features — then bisection onto the edge.
// "Inside" reaches 0.75 px past the outline, so a ray along an edge skims past notches a pixel deep instead of stopping
// in them (which put specks of the far side's band along the long edges).
vec2 ma_extent(vec2 p, vec4 m0) {
  vec2 v = ma_dir();
  float reach = max(u_reach, 1.0);
  vec2 res = vec2(reach);
  int side = 0;
  float lo = 0.0, hi = -1.0, st = clamp(abs(m0.x), 1.0, 8.0);
  int kmax = min(2 * (int(reach) + 12), 4096) * UNI_1;
  for (int k = 0; k < kmax && side <= 1; k++) {
    float t = hi < 0.0 ? min(lo + st, reach) : 0.5 * (lo + hi);
    vec4 m = ma_src(p + (side == 0 ? v : -v) * t);
    bool in_ = m.x < 0.75 && (m0.z < 0.5 || m.z < 0.5 || abs(m.y - m0.y) < 1e-4);
    if (in_) { lo = t; st = clamp(abs(m.x), 1.0, 8.0); } else hi = t;
    if ((hi >= 0.0 && hi - lo < 0.25) || (hi < 0.0 && lo >= reach)) {
      float r = hi < 0.0 ? reach : 0.5 * (lo + hi);
      if (side == 0) res.x = r; else res.y = r;
      side++;
      lo = 0.0;
      hi = -1.0;
      st = clamp(abs(m0.x), 1.0, 8.0);
    }
  }
  return res;
}

// A selection of a mask's features: the feature's random (fid −1: none) is the layer's random and the one its mask
// write records.
GenOut ma_out(float v, float cov, float sdf, float fid) {
  GenOut o = genOut(v, cov, max(fid, 0.0), sdf);
  o.feat = fid >= 0.0 ? 1.0 : 0.0;
  o.fid = fid;
  return o;
}

GenOut gen(vec2 p) {
  // The feature here (Select › Features): its random where the mask has features, none (fid −1) where it doesn't.
  vec4 m0 = ma_src(p);
  float fid = u_select == 1 && m0.z > 0.5 ? m0.y : -1.0;
  // Breakup, once for either selection; per feature it pulls between 0.4× and 1.6× as hard: some bricks stay nearly
  // whole, others go nearly bare.
  float bkAmt = u_bk_amount * (fid >= 0.0 ? mix(0.4, 1.6, fract(fid * 13.37 + 0.31)) : 1.0);
  float bk = u_bk_amount > 0.0 ? max(1.0 - bkAmt * ma_breakup(p, fid), 0.0) : 1.0;
  if (u_select == 0) {
    float raw = clamp(ma_surface(p) * bk, 0.0, 1.0);
    float v = u_find == 5 ? raw
            : u_softness > 0.0 ? smoothstep(u_level, min(u_level + u_softness, 1.0 + 1e-3), raw) : step(u_level, raw) * step(1e-6, raw);
    return genOutSmooth(v, v, 0.0, NO_SDF);
  }
  if (u_area == 0) {
    // A shape's mask: its distance, through the Edge card. A coverage (noise with a cutoff, Stone blocks' joints) has
    // none: its coverage is the value and the coverage both, painted as the layer that wrote it would have — and,
    // without Breakup, the same coverage (stored as 0.5 − coverage) is the shape it writes.
    if (u_bk_amount <= 0.0 && uMaskSrcExact) return ma_out(0.0, 1.0, m0.x, fid);
    float v = clamp(0.5 - m0.x, 0.0, 1.0) * bk;
    GenOut o = ma_out(v, v, u_bk_amount <= 0.0 ? m0.x : NO_SDF, fid);
    o.own = 1;   // (genOutOwn: the value and coverage stay as painted, the shape only goes to the mask)
    return o;
  }
  if (m0.x >= 0.0) return genOutSmooth(0.0, 0.0, 0.0, NO_SDF);
  vec2 e = ma_extent(p, m0);
  float w = max(u_width, 0.5);
  float v = u_across == 1 ? 1.0 - smoothstep(w * (1.0 - u_band_soft) - 0.5, w + 0.5, e.x) : e.y / max(e.x + e.y, 1e-3);
  return ma_out(v * bk, v * bk, NO_SDF, fid);
}
`
};
