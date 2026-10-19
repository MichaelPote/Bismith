// SDF shape layers. Every shape shares placement (position, rotation), an outline (onion) option, a repeat grid with
// per-instance randomness and a Bevel span (the bevel to the middle of the shape); each type supplies, in its local
// frame (q in px relative to the instance centre, y up, already un-rotated):
//   float shapeSdf(vec2 q, float rnd, vec2 cell)   its signed distance (px, < 0 inside)
//   float shapeExtent(vec2 cell)                   how far it can reach from its centre (px, a bound): the instancing
//                                                  visits every repeat cell whose instance can reach the pixel
//   float shapeInradius(vec2 cell)                 its greatest depth (px): Bevel span › To the middle spans it
// and optionally:
//   gShapeBevel = …           (in shapeSdf) a distance to measure the bevel in instead of the outline's — Cross: each
//                             arm on its own, so the arms don't rise where they cross
//   #define SHAPE_CUT         float shapeCut(vec2 q, float d, float outline): applied after the outline — Ellipse's sweep,
//                             so an outlined ellipse cut by it becomes an arc rather than the outline of a pie slice
//   #define SHAPE_DOME        float shapeDome(vec2 q, vec2 cell): a smooth 0..1 dome (1 in the middle) for Bevel span ›
//                             Pillow / Dome, or < 0 to fall back to the distance
//   #define SHAPE_EDGES       float shapeEdges(vec2 q, float rnd, vec2 cell, vec2 ax, vec2 ay, float d): for Bevel
//                             aspect, the distance to the outline in the space the aspect stretches (GLSL_BEVEL:
//                             bevelFrame(ax, ay) maps the local frame there; ax, ay are the local axes on screen), signed
//                             by d (shapeSdf's), in local units — so the mitres don't step. Set gShapeEdgesAll when it
//                             covers the whole outline; otherwise its max with the distance's direction is taken
//   #define SHAPE_RELIEF      void shapeRelief(inout GenOut g, vec2 q, float d): the nearest instance's own relief —
//                             e.g. a fastener head's height (GenOut.height) and shading — at q, d its distance (px)

import { P, type ParamDef, type ParamValues } from '@/core/params';
import { spacingParams } from '../commonParams';
import { FASTENER_HEADS, GRB_GLSL } from './greebleCommon';
import type { LayerDef } from '../types';

const PLACEMENT: ParamDef[] = [
	P.float('x', 'X', 0.5, -2, 3, {
		softMin: 0,
		softMax: 1,
		step: 0.001,
		hint: 'Centre, 0..1 across (within each repeat cell)'
	}),
	P.float('y', 'Y', 0.5, -2, 3, {
		softMin: 0,
		softMax: 1,
		step: 0.001,
		hint: 'Centre, 0..1 down (within each repeat cell)'
	}),
	P.float('rotation', 'Rotation', 0, -360, 360, { softMin: -180, softMax: 180, unit: '°', step: 0.1 }),
	P.float('outline', 'Outline', 0, 0, 1024, {
		softMax: 64,
		unit: 'px',
		step: 0.1,
		hint: '0 = solid; otherwise an inner stroke of this width'
	})
];

const REPEAT: ParamDef[] = [
	P.int('rep_x', 'Count X', 1, 1, 256, { softMax: 32, group: 'repeat' }),
	P.int('rep_y', 'Count Y', 1, 1, 256, { softMax: 32, group: 'repeat' }),
	...spacingParams({ group: 'repeat' }),
	P.float('rep_stagger', 'Row offset', 0, 0, 1, {
		step: 0.001,
		group: 'repeat',
		hint: 'Shift odd rows (use an even row count to tile)'
	}),
	P.float('rep_jitter', 'Position jitter', 0, 0, 1024, {
		softMax: 64,
		unit: 'px',
		step: 0.1,
		group: 'repeat',
		hint: 'Moves each instance up to this far from its place (each axis), at random'
	}),
	P.float('rep_rot', 'Rotation jitter', 0, 0, 180, {
		unit: '°',
		step: 0.1,
		group: 'repeat',
		hint: 'Turns each instance by up to this much either way, at random'
	}),
	P.float('rep_rot_step', 'Rotation steps', 0, 0, 180, {
		softMax: 90,
		unit: '°',
		step: 0.1,
		group: 'repeat',
		showIf: (p) => Number(p.rep_rot) > 0,
		hint: 'Snaps the random turns to multiples of this angle (0 = any angle): 90 with a Rotation jitter of 180 turns each instance by a random quarter turn — notched tiles, hooks facing every way'
	}),
	P.enum(
		'rep_flip',
		'Random flip',
		'none',
		[
			['none', 'None'],
			['x', 'Left / right'],
			['y', 'Up / down'],
			['both', 'Both']
		],
		{
			group: 'repeat',
			hint: 'Mirrors instances at random (each chosen axis for half of them), so asymmetric shapes — a hooked curve, a notched corner — face both ways'
		}
	),
	P.float('rep_scale', 'Scale jitter', 0, 0, 0.95, {
		step: 0.001,
		group: 'repeat',
		hint: 'Shrinks each instance by up to this fraction, at random'
	}),
	P.bool('rep_scale_bevel', 'Scale the bevel too', true, {
		group: 'repeat',
		showIf: (p) => Number(p.rep_scale) > 0,
		hint: 'Shrunk instances get a proportionally narrower bevel — scaled copies of one shape. Off: every instance keeps the Bevel width in px (small ones domed, large ones flat-topped)'
	}),
	P.float('rep_drop', 'Drop out', 0, 0, 1, {
		step: 0.001,
		group: 'repeat',
		hint: 'Fraction of instances removed at random'
	}),
	P.bool('rep_mirror', 'Mirror alternate cells', false, {
		group: 'repeat',
		hint: 'Mirror the position in odd columns/rows — e.g. 2×2 puts one instance in each corner'
	}),
	P.seed()
];

/** Bevel span: Edge › Bevel's width, or all the way to the middle (and, for some shapes, a smooth dome). */
const spanParam = (smooth?: [string, string]): ParamDef =>
	P.enum(
		'dome',
		'Bevel span',
		'off',
		[
			['off', 'Bevel width', 'the bevel is Edge › Bevel wide'],
			[
				'middle',
				'To the middle',
				'the bevel rises from the edge all the way to the middle, whatever the shape’s size — roofs, pyramids, rods, lenses (Edge › Profile still shapes the rise)'
			],
			...(smooth ? [['smooth', smooth[0], smooth[1]] as [string, string, string]] : [])
		],
		{
			hint: 'How far in the bevel reaches. The spans to the middle need a Bevel above 0 and apply with no mask written or in Mask › Mode Normal'
		}
	);

// Before the type's GLSL: what a shape may set while it measures itself.
const SHAPE_PRE = /* glsl */ `
float gShapeBevel = 1e9;   // a shape's own bevel distance (local units), 1e9 = the outline's
bool gShapeCutBevel = true;   // (shapeCut) the cut's edges bevel too; false = only the outline before it
bool gShapeEdgesAll = false;   // (shapeEdges) its pieces make up the whole outline: Bevel aspect needs nothing else
`;
// Stroke shapes: how much of the width the taper has taken at t (0 = full width … 1 = the thin end), and its slope.
// Taper curve c ≥ 1: t^c (wide for longer, rounded sides — leaves); c < 1: 1 − (1 − t)^(1/c) (narrowing early, hollow
// sides ending in a fine point — needles). c = 1: straight sides.
const TAPER_GLSL = /* glsl */ `
vec2 taperShape(float t) {
  float c = max(u_taper_curve, 0.05);
  if (c >= 1.0) return vec2(pow(t, c), c * pow(max(t, 1e-3), c - 1.0));
  float k = 1.0 / c;
  return vec2(1.0 - pow(1.0 - t, k), k * pow(max(1.0 - t, 1e-3), k - 1.0));
}
`;

// Instancing: the union of every repeat instance that can reach p — the shape's extent, the position jitter and the
// offset of X / Y decide how many that is (at least the neighbours either side, more for shapes larger than their
// step), with copies round the torus when tiling (repGrid; Column / Row spacing moves the instances, while their cells
// still size the shapes). One flat loop with uniform-derived bounds, so D3D compiles the shape once (and no "continue",
// which ANGLE can miscompile). The nearest instance also gives the bevel distance (GenOut.bdist): the outline's in px,
// the shape's own (Cross), scaled with the instance, or spanned to the middle.
const SHAPE_GEN = /* glsl */ `
GenOut gen(vec2 p) {
  ivec2 R = ivec2(u_rep_x, u_rep_y);
  vec2 cell = uRes / vec2(R);
  vec2 pitch = vec2(repPitch(uRes.x, R.x, u_col_sp, uRes.x), repPitch(uRes.y, R.y, u_row_sp, uRes.y));
  vec2 off0 = vec2(u_x - 0.5, 0.5 - u_y);
  // How far an instance's place can be from p and still reach it (+2 px for the anti-aliasing), and at least a step.
  vec2 reach = max(vec2(shapeExtent(cell) + u_rep_jitter + 2.0), pitch) + abs(off0) * pitch;
  float inr = shapeInradius(cell);
  float shift = u_rep_stagger * pitch.x;
  RepGrid rg = repGrid(R, pitch, 0.5 * uRes, uRes, uTile, p - reach - vec2(shift, 0.0), p + reach);
  int n = repCount(rg);
  float best = 1e9;
  float bestSolid = 1e9;   // the nearest instance's distance before the outline (px): its direction for Bevel aspect
  float bestRnd = 0.0;
  float bestBd = 0.0;
#if defined(SHAPE_EDGES) || defined(SHAPE_RELIEF)
  vec2 bestQ = vec2(1e9), bestAx = vec2(1.0, 0.0), bestAy = vec2(0.0, 1.0);
  float bestS = 1.0, bestDs = 1e9;
#endif
  for (int k = 0; k < n; k++) {
    ivec2 cw;
    vec2 centre;
    repAt(rg, k, cw, centre);
    // Rows and the mirror count from the top, on the instance (the same on every copy round the torus, so the copies
    // across an edge match).
    int rowFromTop = R.y - 1 - cw.y;
    if (imod(rowFromTop, 2) == 1) centre.x += shift;
    // Drop out: the body wrapped in a test rather than a "continue".
    if (hashI(cw, uSeed + 3.0) >= u_rep_drop) {
      vec3 h = hash3I(cw, uSeed);
      float rnd = hashI(cw, uSeed + 7.0);   // the instance's own random (Diffuse jitter, Per-feature variation), apart from its jitter
      vec2 off = off0;
      if (u_rep_mirror) {
        if (imod(cw.x, 2) == 1) off.x = -off.x;
        if (imod(rowFromTop, 2) == 1) off.y = -off.y;
      }
      centre += off * pitch + (h.xy - 0.5) * 2.0 * u_rep_jitter;
      float s = 1.0 - h.z * u_rep_scale;
      float jr = (hashI(cw, uSeed + 5.0) - 0.5) * 2.0 * u_rep_rot;
      if (u_rep_rot_step > 0.0) jr = floor(jr / u_rep_rot_step + 0.5) * u_rep_rot_step;
      vec2 q = unrotCW(p - centre, u_rotation + jr) / s;
      // The local axes' screen directions (with the flips), for Bevel aspect along the shape's edges.
      vec2 ax = rotCW(vec2(1.0, 0.0), u_rotation + jr);
      vec2 ay = vec2(-ax.y, ax.x);
      if (u_rep_flip > 0) {
        vec2 hf = hash3I(cw, uSeed + 11.0).xy;
        if ((u_rep_flip == 1 || u_rep_flip == 3) && hf.x < 0.5) { q.x = -q.x; ax = -ax; }
        if ((u_rep_flip == 2 || u_rep_flip == 3) && hf.y < 0.5) { q.y = -q.y; ay = -ay; }
      }
      // In the instance's own units (scaled), so the outline keeps its width in px.
      float ol = u_outline / s;
      gShapeBevel = 1e9;
      float dl = shapeSdf(q, rnd, cell);
      float ds = dl;
      float bl = gShapeBevel < 1e8 ? gShapeBevel : dl;
      dl = sdOnion(dl, ol);
      if (ol > 0.0) bl = dl;
#ifdef SHAPE_CUT
      dl = shapeCut(q, dl, ol);
      if (gShapeCutBevel) bl = max(bl, dl);
#endif
      float d = dl * s;
      if (d < best) {
        best = d;
        bestSolid = ds * s;
        bestRnd = rnd;
#if defined(SHAPE_EDGES) || defined(SHAPE_RELIEF)
        bestQ = q;
        bestAx = ax;
        bestAy = ay;
        bestS = s;
        bestDs = ds;
#endif
        if (u_dome > 0) {
          // Spanned to the middle: the depth over the shape's greatest depth (a ring's: half its width), as px of Bevel.
          float t = clamp(-bl / max(ol > 0.0 ? min(inr, ol * 0.5) : inr, 1e-3), 0.0, 1.0);
#ifdef SHAPE_DOME
          if (u_dome == 2 && ol <= 0.0) {
            float ts = shapeDome(q, cell);
            if (ts >= 0.0) t = min(ts, 2.5 * t);   // (the distance keeps it at 0 on corners the dome doesn't follow)
          }
#endif
          bestBd = -t * u_bevel;
        } else {
          bestBd = u_rep_scale_bevel ? bl : bl * s;
        }
      }
    }
  }
  GenOut g = genOut(0.0, 1.0, bestRnd, best);
  // Bevel aspect on the shape's own bevel distance, as the wrapper applies it to the outline's (not to the spans): from
  // the distance's direction, and from the edges that meet at the shape's corners (SHAPE_EDGES), so the bevels meet in a
  // clean mitre instead of stepping where that direction turns.
  // (The solid's: an outline's distance turns round along the middle of its band, where its gradient is noise.)
  vec2 gr = vec2(dFdx(bestSolid), dFdy(bestSolid));
  g.bdist = u_dome > 0 ? bestBd : bevelLine(bestBd, gr);
#ifdef SHAPE_EDGES
  if (u_dome == 0 && bevelAspectOn()) {
    float e = shapeEdges(bestQ, bestRnd, cell, bestAx, bestAy, bestDs);
    e = u_rep_scale_bevel ? e : e * bestS;
    // The distance's direction is only needed for what the pieces leave out (an outline's inner edge): at a mitre it
    // mixes the two sides' directions, a dotted line along the old 45° crease.
    g.bdist = gShapeEdgesAll && u_outline <= 0.0 ? e : max(g.bdist, e);
  }
#endif
#ifdef SHAPE_RELIEF
  shapeRelief(g, bestQ, best);
#endif
  return g;
}
`;

type ShapeDef = Omit<LayerDef, 'category' | 'kind' | 'sdf' | 'glsl' | 'groups'> & {
	sdfGlsl: string;
	/** When the shared Placement params show, per key (e.g. no Outline on a fastener head). */
	placementShowIf?: Record<string, ParamDef['showIf']>;
};

function shape(def: ShapeDef): LayerDef {
	const { sdfGlsl, params, placementShowIf, ...rest } = def;
	const placement = PLACEMENT.map((d) => (placementShowIf?.[d.key] ? { ...d, showIf: placementShowIf[d.key] } : d));
	return {
		...rest,
		category: 'shape',
		kind: 'generator',
		sdf: true,
		params: [...params, ...placement, ...REPEAT],
		groups: [{ id: 'repeat', label: 'Repeat', collapsed: true }],
		glsl: SHAPE_PRE + sdfGlsl + SHAPE_GEN,
		// Diffuse fills the shape (Source › Shape) rather than following the bevel's rise through the ramp.
		defaults: { h_on: true, h_amount: 0.5, dif_on: false, dif_src: 'shape', ...(def.defaults ?? {}) }
	};
}

/** Editor defaults sized to the texture: a shape that reads at any size, with a bevel wide enough to show. */
const half = (v: number) => Math.round(v * 2) / 2;
const short = (t: { width: number; height: number }) => Math.min(t.width, t.height);
const freshBevel = (t: { width: number; height: number }) => half(Math.min(Math.max(short(t) / 64, 1.5), 24));

const CORNERS: [string, string][] = [
	['all', 'All'],
	['top', 'Top'],
	['bottom', 'Bottom'],
	['left', 'Left'],
	['right', 'Right'],
	['tl', 'Top-left'],
	['tr', 'Top-right'],
	['br', 'Bottom-right'],
	['bl', 'Bottom-left'],
	['diag', 'TL + BR'],
	['antidiag', 'TR + BL']
];

export const rectLayer = shape({
	type: 'rect',
	label: 'Rectangle',
	description:
		'Rounded, chamfered, scooped or notched rectangle, sized directly or inset from the edges (panels, buttons, wells, pillows).',
	params: [
		P.enum('size_mode', 'Size by', 'inset', [
			['inset', 'Inset from edges'],
			['size', 'Width / height']
		]),
		P.float('inset_x', 'Inset X', 4, -1024, 2048, {
			softMin: 0,
			softMax: 128,
			unit: 'px',
			step: 0.5,
			showIf: (p) => p.size_mode === 'inset',
			hint: 'Margin left and right (from the texture, or from each repeat cell)'
		}),
		P.float('inset_y', 'Inset Y', 4, -1024, 2048, {
			softMin: 0,
			softMax: 128,
			unit: 'px',
			step: 0.5,
			showIf: (p) => p.size_mode === 'inset',
			hint: 'Margin top and bottom (from the texture, or from each repeat cell)'
		}),
		P.float('width', 'Width', 64, 0, 8192, {
			softMax: 1024,
			unit: 'px',
			step: 0.5,
			showIf: (p) => p.size_mode === 'size'
		}),
		P.float('height', 'Height', 32, 0, 8192, {
			softMax: 1024,
			unit: 'px',
			step: 0.5,
			showIf: (p) => p.size_mode === 'size'
		}),
		P.float('radius', 'Corner', 4, 0, 2048, {
			softMax: 512,
			unit: 'px',
			step: 0.1,
			hint: 'Size of the corner, up to half the shorter side (there: a stadium, or a circle)'
		}),
		P.enum('corner_style', 'Corner style', 'round', [
			['round', 'Round'],
			['chamfer', 'Chamfer', 'cut off at 45°'],
			['scoop', 'Scoop', 'a quarter circle cut into the corner'],
			['notch', 'Notch', 'a square cut out of the corner']
		]),
		P.enum('corners', 'Corners', 'all', CORNERS, {
			hint: 'Which corners get the corner style; the others stay square'
		}),
		spanParam([
			'Pillow',
			'a smooth cushion over the whole rectangle, highest in the middle, without the ridges a bevel makes where its sides meet'
		])
	],
	fresh: (t) => ({
		inset_x: Math.round(short(t) / 16),
		inset_y: Math.round(short(t) / 16),
		radius: Math.round(short(t) / 32),
		bevel: freshBevel(t)
	}),
	sdfGlsl: /* glsl */ `
// The corners each Corners option shapes: (top-right, bottom-right, top-left, bottom-left) in GL (y up).
const vec4 CORNER_SETS[11] = vec4[11](vec4(1.0), vec4(1, 0, 1, 0), vec4(0, 1, 0, 1), vec4(0, 0, 1, 1), vec4(1, 1, 0, 0),
  vec4(0, 0, 1, 0), vec4(1, 0, 0, 0), vec4(0, 1, 0, 0), vec4(0, 0, 0, 1), vec4(0, 1, 1, 0), vec4(1, 0, 0, 1));
vec2 rectHalf(vec2 cell) {
  return max(u_size_mode == 0 ? cell * 0.5 - vec2(u_inset_x, u_inset_y) : vec2(u_width, u_height) * 0.5, vec2(0.0));
}
float shapeExtent(vec2 cell) { return length(rectHalf(cell)); }
float shapeInradius(vec2 cell) { vec2 b = rectHalf(cell); return min(b.x, b.y); }
vec4 rectCorners(vec2 b) { return CORNER_SETS[clamp(u_corners, 0, 10)] * min(u_radius, min(b.x, b.y)); }
// Chamfers: a 45° half-plane per corner (normals (1, 1), (1, −1), (−1, 1), (−1, −1)), −1e9 where a corner has none.
vec4 rectChamfers(vec2 q, vec2 b, vec4 r) {
  vec4 pl = (vec4(q.x + q.y, q.x - q.y, q.y - q.x, -q.x - q.y) - (b.x + b.y) + r) * 0.70710678;
  vec4 on = step(1e-4, r);
  return pl * on - (1.0 - on) * 1e9;   // (not mix(-1e9, pl, on): that rounds pl to float steps of 1e9)
}
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  vec2 b = rectHalf(cell);
  vec4 r = rectCorners(b);
  if (u_corner_style == 0) return sdRoundBox(q, b, r);
  float d = sdBox(q, b);
  if (u_corner_style == 1) {
    // All four chamfers everywhere — exact inside even where one reaches past the middle.
    vec4 pl = rectChamfers(q, b, r);
    return max(d, max(max(pl.x, pl.y), max(pl.z, pl.w)));
  }
  // Scoop / notch: a disc or a square centred on the corner of q's quadrant, cut out.
  float rc = q.x > 0.0 ? (q.y > 0.0 ? r.x : r.y) : (q.y > 0.0 ? r.z : r.w);
  if (rc <= 0.0) return d;
  vec2 k = abs(q) - b;
  return max(d, -(u_corner_style == 2 ? length(k) - rc : sdBox(k, vec2(rc))));
}
// The outline piece by piece for Bevel aspect (GLSL_BEVEL): the sides between the corners, and each corner's piece —
// a round corner's or scoop's arc, a chamfer, a notch's two sides — in the stretched space.
#define SHAPE_EDGES
float shapeEdges(vec2 q, float rnd, vec2 cell, vec2 ax, vec2 ay, float dl) {
  gShapeEdgesAll = true;
  vec2 b = rectHalf(cell);
  vec4 r4 = rectCorners(b);
  // The corners anticlockwise (GL y up): top-right, top-left, bottom-left, bottom-right.
  float rs[4] = float[4](r4.x, r4.z, r4.w, r4.y);
  vec2 sg[4] = vec2[4](vec2(1.0), vec2(-1.0, 1.0), vec2(-1.0), vec2(1.0, -1.0));
  mat2 M = bevelFrame(ax, ay);
  vec2 ps = M * q;
  float d2 = 1e18;
  for (int i = 0; i < 4; i++) {
    vec2 s = sg[i], s1 = sg[(i + 1) % 4];
    float rc = rs[i], rc1 = rs[(i + 1) % 4];
    vec2 K = s * b;
    vec2 pv = K - vec2(0.0, s.y * rc), ph = K - vec2(s.x * rc, 0.0);   // where the corner leaves its sides
    // The side to the next corner: the top or bottom from a corner on the right, else the left or right.
    vec2 K1 = s1 * b;
    bool top = (i % 2) == 0;
    d2 = min(d2, bevelSeg2(ps, M * (top ? ph : pv), M * (top ? K1 - vec2(s1.x * rc1, 0.0) : K1 - vec2(0.0, s1.y * rc1))));
    if (rc > 0.0) {
      if (u_corner_style == 0 || u_corner_style == 2) {
        // Round: the arc round the inset centre; scoop: the arc round the corner itself, facing in.
        bool rnd = u_corner_style == 0;
        d2 = min(d2, bevelArc2(ps, M, rnd ? K - s * rc : K, rc, rnd ? vec2(s.x, 0.0) : vec2(0.0, -s.y),
                               rnd ? vec2(0.0, s.y) : vec2(-s.x, 0.0), normalize(s) * (rnd ? 1.0 : -1.0)));
      } else {
        vec2 n = u_corner_style == 1 ? pv : K - s * rc;   // a chamfer straight across, a notch via its inner corner
        d2 = min(d2, min(bevelSeg2(ps, M * pv, M * n), bevelSeg2(ps, M * n, M * ph)));
      }
    }
  }
  return dl < 0.0 ? -sqrt(d2) : sqrt(d2);
}
// Pillow: (1 − x²/a²)(1 − y²/b²) — smooth everywhere inside, 0 on the sides.
#define SHAPE_DOME
float shapeDome(vec2 q, vec2 cell) {
  vec2 u = q / max(rectHalf(cell), vec2(1e-3));
  vec2 v = clamp(1.0 - u * u, 0.0, 1.0);
  return v.x * v.y;
}
`
});

/** Circle / Bolt: the plain circle (the default) rather than a fastener head. */
const circleHead = (p: ParamValues) => (p.head ?? 'circle') === 'circle';

export const circleLayer = shape({
	type: 'circle',
	label: 'Circle / Bolt',
	description:
		'Circles, ellipses and (with an outline) rings; Sweep keeps a sector — pie slices, arcs, gauges. Or a fastener head — dome, Allen bolt, hex head, screws, a screw hole. Rivets, bolts, gems, domes, dials.',
	params: [
		P.enum(
			'head',
			'Head',
			'circle',
			[['circle', 'Circle', 'a disc or ellipse: Aspect, Sweep, Outline and the bevel as set'], ...FASTENER_HEADS],
			{
				hint: 'A plain circle, or a fastener head (the greebles’ shared heads): its own relief goes to Height (Source › Pattern; sunk parts below the surface), its sockets and slots darken the Pattern value, its footprint is the shape. Rotation turns it'
			}
		),
		P.float('radius', 'Radius', 24, 0, 4096, {
			softMax: 512,
			unit: 'px',
			step: 0.1,
			hint: 'Half the width (a fastener: its head)'
		}),
		P.float('sink', 'Counterbore depth', 0.5, 0, 2, {
			step: 0.001,
			showIf: (p) => p.head === 'allen_sunk' || p.head === 'hex_sunk',
			hint: 'How deep the round counterbore the head stands in is sunk, in head heights'
		}),
		P.float('squash', 'Aspect', 1, 0.01, 100, {
			softMin: 0.1,
			softMax: 10,
			step: 0.001,
			showIf: circleHead,
			hint: 'Height / width'
		}),
		P.float('sweep', 'Sweep', 360, 0, 360, {
			unit: '°',
			step: 0.1,
			showIf: circleHead,
			hint: 'How much of the ellipse is kept, centred on the top (turn it with Rotation): 360 = all of it, 180 = the top half, 270 = a gauge with a gap at the bottom. With an Outline, an arc'
		}),
		P.float('cut_from', 'Cut from', 0, 0, 1, {
			step: 0.001,
			showIf: (p) => circleHead(p) && Number(p.sweep ?? 360) < 360,
			hint: 'Where the cut starts, as a share of the radius: 0 = from the middle (a pie slice), higher = only a notch in the rim, the middle kept whole'
		}),
		P.bool('cut_bevel', 'Bevel the cut', true, {
			showIf: (p) => circleHead(p) && Number(p.sweep ?? 360) < 360,
			hint: 'Off: the cut edges stay sharp — the bevel follows only the ellipse’s own outline, so a thin slit doesn’t sink the middle'
		}),
		P.enum(
			'arc_caps',
			'Arc ends',
			'flat',
			[
				['flat', 'Flat'],
				['round', 'Round']
			],
			{
				showIf: (p) => circleHead(p) && Number(p.sweep ?? 360) < 360 && Number(p.outline) > 0,
				hint: 'The ends of an arc (an outlined ellipse cut by Sweep): cut square, or rounded off'
			}
		),
		{
			...spanParam([
				'Dome',
				'a smooth dome over the whole ellipse (1 − x²/a² − y²/b²), without the ridge a bevel makes along a long ellipse'
			]),
			showIf: circleHead
		}
	],
	placementShowIf: { outline: circleHead },
	fresh: (t) => ({ radius: Math.round(short(t) * 0.2), bevel: freshBevel(t) }),
	sdfGlsl:
		GRB_GLSL +
		/* glsl */ `
// Exact distance to an ellipse with semi-axes ab, at any aspect (iterative closest point after 0xfaded's trig-free method).
float sdEllipseExact(vec2 p, vec2 ab) {
  ab = max(ab, vec2(1e-3));
  if (abs(ab.x - ab.y) < 1e-4 * max(ab.x, ab.y)) return length(p) - ab.x;
  vec2 pa = abs(p);
  vec2 t = vec2(0.70710678);
  vec2 e2 = vec2(ab.x * ab.x - ab.y * ab.y, ab.y * ab.y - ab.x * ab.x) / ab;
  for (int i = 0; i < 4; i++) {
    vec2 e = e2 * t * t * t;
    vec2 qv = pa - e;
    t = clamp((qv * (length(ab * t - e) / max(length(qv), 1e-9)) + e) / ab, 0.0, 1.0);
    t /= max(length(t), 1e-9);
  }
  float d = length(pa - ab * t);
  return dot(pa / ab, pa / ab) > 1.0 ? d : -d;
}
vec2 ellipseAxes() { return vec2(u_radius, u_radius * u_squash); }
// Head: 0 the circle; else a fastener head (FASTENER_HEADS, grb_fastener's kind + 1) — round, the counterbore 1.55 ×.
bool fastener() { return u_head != 0; }
float shapeExtent(vec2 cell) { return fastener() ? 1.6 * u_radius : u_radius * max(1.0, u_squash); }
float shapeInradius(vec2 cell) {
  if (fastener()) return u_radius;
  // The deepest point: the middle (the minor semi-axis); a sector's: its inscribed circle, roughly.
  float r = min(u_radius, u_radius * u_squash);
  if (u_sweep >= 360.0) return r;
  float th = radians(max(u_sweep, 0.0)) * 0.5;
  return th <= 1.5707963 ? r * sin(th) / (1.0 + sin(th)) : r * (0.5 + 0.5 * (th - 1.5707963) / 1.5707963);
}
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  // A fastener head: its footprint (the head, or its counterbore).
  return fastener() ? grb_fastener(u_head - 1, q, u_radius, u_sink).z : sdEllipseExact(q, ellipseAxes());
}
// A fastener head's own relief: its height to Height (GenOut.height, in head heights; sunk parts below the surface),
// its sockets and slots darkening the value (× the bevel at the footprint's edge), its footprint the coverage.
#define SHAPE_RELIEF
void shapeRelief(inout GenOut g, vec2 q, float d) {
  if (!fastener()) return;
  vec3 f = grb_fastener(u_head - 1, q, u_radius, u_sink);
  g.own = 2;
  g.value = 1.0 - 0.85 * f.y;
  g.mask = coverage(d, u_aa);
  g.height = f.x;
}
// Sweep: keep the sector within ±sweep/2 of the top (after the outline, so an outlined ellipse becomes an arc).
#define SHAPE_CUT
float shapeCut(vec2 q, float d, float ol) {
  if (u_sweep >= 360.0 || fastener()) return d;
  float th = radians(max(u_sweep, 0.0)) * 0.5;
  vec2 c = vec2(sin(th), cos(th));
  vec2 w = vec2(abs(q.x), q.y);
  // The cut: the wedge outside the sector, from Cut from's circle out (radius a share of the minor semi-axis; 0 = from
  // the middle). Its distance, exact: to its sides (from the circle out) or, inside the wedge, to the circle's arc.
  float rf = u_cut_from * min(ellipseAxes().x, ellipseAxes().y);
  bool wedge = c.y * w.x - c.x * w.y > 0.0;
  float m = min(length(w - c * max(dot(w, c), rf)), wedge ? abs(length(w) - rf) : 1e9);
  float kept = wedge && length(w) >= rf ? m : -m;
  gShapeCutBevel = u_cut_bevel;
  float cut = max(d, kept);
  if (u_arc_caps == 0 || ol <= 0.0) return cut;
  // Round ends: a disc across the ring where the sweep cuts it (the ring's middle along the cut).
  float re = 1.0 / length(c / ellipseAxes());
  return min(cut, length(w - c * (re - ol * 0.5)) - ol * 0.5);
}
// The outline for Bevel aspect (GLSL_BEVEL): the whole ellipse exactly; cut by Sweep, the kept arc as chords (within
// 0.1 px) and the two cuts. (An outlined sweep — an arc — keeps the distance's direction; a ring's inner edge too.)
#define SHAPE_EDGES
float shapeEdges(vec2 q, float rnd, vec2 cell, vec2 ax, vec2 ay, float dl) {
  // (A fastener's footprint is round: the distance's direction is exact there.)
  if (fastener()) {
    gShapeEdgesAll = false;
    return -1e9;
  }
  bool cut = u_sweep < 360.0;
  gShapeEdgesAll = u_outline <= 0.0;
  if (cut && u_outline > 0.0) return -1e9;
  mat2 M = bevelFrame(ax, ay);
  vec2 ps = M * q;
  vec2 ab = ellipseAxes();
  float d;
  if (!cut || !u_cut_bevel) {
    d = bevelEllipse(ps, M, ab);
  } else {
    float th = radians(max(u_sweep, 0.0)) * 0.5;
    int n = int(clamp(ceil(2.0 * th / sqrt(0.8 / max(max(ab.x, ab.y), 1e-3))), 4.0, 96.0));
    vec2 c = vec2(sin(th), cos(th));
    vec2 c2 = vec2(-c.x, c.y);
    vec2 e0 = c2 / length(c2 / ab);
    vec2 a = M * e0;
    // The cuts, from the middle or from Cut from's circle (with its arc across the gap).
    float rf = min(u_cut_from * min(ab.x, ab.y), 1.0 / length(c / ab));
    float d2 = min(bevelSeg2(ps, M * (c2 * rf), a), bevelSeg2(ps, M * (c * rf), M * (c / length(c / ab))));
    if (rf > 0.0) d2 = min(d2, bevelArc2(ps, M, vec2(0.0), rf, c, c2, vec2(0.0, -1.0)));
    for (int i = 1; i <= n; i++) {
      float al = -th + 2.0 * th * float(i) / float(n);
      vec2 u = vec2(sin(al), cos(al));
      vec2 b = M * (u / length(u / ab));
      d2 = min(d2, bevelSeg2(ps, a, b));
      a = b;
    }
    d = sqrt(d2);
  }
  return dl < 0.0 ? -d : d;
}
#define SHAPE_DOME
float shapeDome(vec2 q, vec2 cell) {
  if (u_sweep < 360.0 || fastener()) return -1.0;
  vec2 u = q / max(ellipseAxes(), vec2(1e-3));
  return clamp(1.0 - dot(u, u), 0.0, 1.0);
}
`
});

const isStar = (p: ParamValues) => Boolean(p.star);

export const polygonLayer = shape({
	type: 'polygon',
	label: 'Polygon / Star',
	description:
		'Regular polygons and stars, with rounded tips and (stars) rounded inner corners, flat tips and valleys — badges, gems, cogs, flowers.',
	params: [
		P.int('sides', 'Sides', 6, 3, 64, { softMax: 16, hint: 'Sides of the polygon, points of the star' }),
		P.float('radius', 'Radius', 24, 0, 4096, {
			softMax: 512,
			unit: 'px',
			step: 0.1,
			hint: 'Centre to a corner (a star’s tips)'
		}),
		P.bool('star', 'Star', false),
		P.float('inner_r', 'Inner radius', 0.5, 0.02, 1, {
			step: 0.001,
			showIf: isStar,
			hint: 'Where the star’s inner corners sit, as a fraction of the radius: small = thin spikes, up to the polygon’s own edge (no points), past it = a polygon with twice the corners'
		}),
		P.float('tip_flat', 'Flat tips', 0, 0, 1, {
			step: 0.001,
			showIf: isStar,
			hint: 'Cuts the points off flat (on a circle) — this fraction of their length. With Flat valleys: a gear’s teeth'
		}),
		P.float('root_flat', 'Flat valleys', 0, 0, 1, {
			step: 0.001,
			showIf: isStar,
			hint: 'Fills the notches between the points up to a circle — this fraction of the way out — so they have flat bottoms'
		}),
		P.float('round', 'Rounding', 0, 0, 1024, {
			softMax: 128,
			unit: 'px',
			step: 0.1,
			hint: 'Rounds the corners (a star’s tips), keeping the radius'
		}),
		P.float('round_in', 'Inner rounding', 0, 0, 1024, {
			softMax: 128,
			unit: 'px',
			step: 0.1,
			showIf: isStar,
			hint: 'Rounds the star’s inner corners — fills the notches between the points with an arc of this radius'
		}),
		spanParam()
	],
	fresh: (t) => ({ radius: Math.round(short(t) * 0.22), round: Math.round(short(t) / 128), bevel: freshBevel(t) }),
	sdfGlsl: /* glsl */ `
// A star with n points, tips at radius r and inner corners at k·r (k = cos(π/n): the regular polygon), its inner corners
// filleted with radius f where they are concave. Exact: in the folded sector between an inner corner (on the x axis)
// and a tip the boundary is one edge, or a fillet arc and the rest of the edge.
float sdStarFillet(vec2 p, float r, int n, float k, float f) {
  float an = PI / float(n);
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  vec2 V = vec2(r * k, 0.0);
  vec2 T = r * vec2(cos(an), sin(an));
  vec2 e = normalize(T - V + vec2(0.0, 1e-6));
  // The fillet circle sits on the axis, tangent to the edge and its mirror image: f / sin α out from the corner, touching
  // the edge f / tan α along it (α: the edge's angle to the axis). Convex corners (α ≥ 90°) take none.
  f = e.x > 1e-4 ? min(f, length(T - V) * e.y / e.x) : 0.0;
  vec2 C = vec2(V.x + f / max(e.y, 1e-4), 0.0);
  vec2 Pt = V + e * (f * e.x / max(e.y, 1e-4));
  vec2 pt = p - Pt, te = T - Pt;
  float dEdge = length(pt - te * clamp(dot(pt, te) / max(dot(te, te), 1e-8), 0.0, 1.0));
  vec2 pf = p - C;
  float dArc = dot(pf, e) <= 0.0 ? abs(length(pf) - f) : 1e9;
  bool body = e.x * p.y - e.y * (p.x - V.x) >= 0.0;
  bool fill = pf.x < 0.0 && dot(pf, e) < 0.0 && length(pf) > f;
  float d = min(dEdge, dArc);
  return body || fill ? -d : d;
}
// Rounding: the star shrunk by it, then grown back (rounding the tips); its inner fillet grows by as much less.
float polyCore() { return max(u_radius - max(u_round, 0.0), 1e-4); }
float polyK() { return u_star ? u_inner_r : cos(PI / float(u_sides)); }
float shapeExtent(vec2 cell) { return max(u_radius, u_round); }
float shapeInradius(vec2 cell) {
  // From the middle to the nearest edge (or inner corner), then the flat valleys' circle, plus the rounding.
  float r = polyCore(), k = polyK(), an = PI / float(u_sides);
  vec2 e = normalize(r * vec2(cos(an), sin(an)) - vec2(r * k, 0.0) + vec2(0.0, 1e-6));
  float d = e.x > 1e-4 ? k * r : e.y * k * r;
  if (u_star && u_root_flat > 0.0) d = max(d, mix(k * r, r, u_root_flat));
  return d + max(u_round, 0.0);
}
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  float ro = max(u_round, 0.0);
  float r = polyCore(), k = polyK();
  float d = sdStarFillet(q, r, u_sides, k, u_star ? u_round_in + ro : 0.0);
  if (u_star) {
    // Flat tips: cut by a circle part way down the points; flat valleys: filled to a circle part way up.
    if (u_tip_flat > 0.0) d = max(d, length(q) - mix(r, k * r, u_tip_flat));
    if (u_root_flat > 0.0) d = min(d, length(q) - mix(k * r, r, u_root_flat));
  }
  return d - ro;
}
// Bevel aspect: the outline as a chain of segments (each arc as two), sector by sector in sdStarFillet's folded frame —
// V's valley (its fillet, the Flat valleys circle, or the corner itself), the edges, the tips (cut by the Flat tips
// circle, or the corners) — measured in the space the aspect stretches (screen axes × Bevel / their bevel width), where
// the bevel is the plain distance.
float polySegD2(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  vec2 v = pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return dot(v, v);
}
#define SHAPE_EDGES
float shapeEdges(vec2 q, float rnd, vec2 cell, vec2 ax, vec2 ay, float dl) {
  gShapeEdgesAll = true;
  float ro = max(u_round, 0.0);
  float r = polyCore(), k = polyK(), an = PI / float(u_sides);
  float th = atan(q.x, q.y);
  float bn = mod(th, 2.0 * an) - an;
  // The folded frame's axes in the local one: x to the sector's middle, y towards p's side of it.
  vec2 fx = vec2(sin(th - bn), cos(th - bn));
  vec2 fy = (bn < 0.0 ? -1.0 : 1.0) * vec2(fx.y, -fx.x);
  vec2 W = bevelWidths();
  mat2 st = mat2(u_bevel / W.x, 0.0, 0.0, u_bevel / W.y) * mat2(ax, ay) * mat2(fx, fy);
  vec2 p = length(q) * vec2(cos(bn), abs(sin(bn)));
  vec2 tip = vec2(cos(an), sin(an));
  float kr = k * r;
  vec2 V = vec2(kr, 0.0), T = r * tip;
  float L = length(T - V);
  vec2 e = normalize(T - V + vec2(0.0, 1e-6));
  float ex = kr * e.x;
  // Where the edge leaves the valley: V's fillet, or the Flat valleys circle (|V + s·e| = its radius).
  float f = u_star && e.x > 1e-4 ? min(u_round_in + ro, L * e.y / e.x) : 0.0;
  vec2 C = vec2(kr + f / max(e.y, 1e-4), 0.0);
  float sPt = f * e.x / max(e.y, 1e-4);
  float rootR = u_star && u_root_flat > 0.0 ? mix(kr, r, u_root_flat) : 0.0;
  float sX = rootR > 0.0 ? -ex + sqrt(max(ex * ex - kr * kr + rootR * rootR, 0.0)) : -1e9;
  vec2 P0 = V + e * min(max(sPt, sX), L);
  vec2 A = V, mV = V;
  if (f > 0.0 && sPt >= sX) {
    A = vec2(C.x - f, 0.0);
    mV = C + f * normalize(normalize(P0 - C) + vec2(-1.0, 0.0));
  } else if (rootR > 0.0) {
    A = vec2(rootR, 0.0);
    mV = rootR * normalize(normalize(P0) + vec2(1.0, 0.0));
  }
  // The tip: the Flat tips circle from where the edge meets it, or the corner.
  vec2 Y = T, mT = T, Tt = T;
  if (u_star && u_tip_flat > 0.0) {
    float tipR = mix(r, kr, u_tip_flat);
    Y = V + e * clamp(-ex + sqrt(max(ex * ex - kr * kr + tipR * tipR, 0.0)), length(P0 - V), L);
    Tt = tipR * tip;
    mT = tipR * normalize(normalize(Y) + tip);
  }
  // One sector's outline, tip to tip, anticlockwise (its first half mirrored across V's axis).
  vec2 c[11] = vec2[11](vec2(Tt.x, -Tt.y), vec2(mT.x, -mT.y), vec2(Y.x, -Y.y), vec2(P0.x, -P0.y), vec2(mV.x, -mV.y), A,
                        mV, P0, Y, mT, Tt);
  // Every sector within reach: a piece further away than the widest bevel can't be nearer in the stretched space than
  // one inside it (and beyond a bevel in, nothing changes). The stretch isn't symmetric about the fold, so both ways.
  float span = 2.0 * min(kr, r) * sin(an);
  int J = min(int(ceil(max(W.x, W.y) / max(span, 1e-3))) + 1, u_sides / 2 + 1);
  mat2 turn = mat2(cos(2.0 * an), sin(2.0 * an), -sin(2.0 * an), cos(2.0 * an));
  mat2 rotJ = mat2(cos(2.0 * an * float(J)), -sin(2.0 * an * float(J)), sin(2.0 * an * float(J)), cos(2.0 * an * float(J)));
  // Rounding grows the core: each segment moves out by it (the chain runs anticlockwise, so out is to the right), with an
  // arc (two segments) round each convex joint; at a concave one the moved segments cross. One flat loop over the
  // segments of every sector (nested loops compile slowly on D3D).
  vec2 ps = st * p;
  float best = 1e18;
  vec2 prevEnd = vec2(0.0), prevN = vec2(0.0);
  int segs = (2 * J + 1) * 10;
  for (int t = 0; t < segs; t++) {
    int i = t % 10;
    if (t > 0 && i == 0) rotJ = turn * rotJ;
    vec2 a = rotJ * c[i], b = rotJ * c[i + 1];
    vec2 dir = b - a;
    float len = length(dir);
    if (len > 1e-5) {
      vec2 n = vec2(dir.y, -dir.x) / len * ro;
      vec2 a2 = st * (a + n), b2 = st * (b + n);
      // The joint's arc from the previous segment (or, at a concave joint or none, just this segment's start).
      bool arc = ro > 0.0 && dot(prevN, prevN) > 0.0 && prevN.x * n.y - prevN.y * n.x > 0.0;
      vec2 m = arc ? st * (a + ro * normalize(prevN + n)) : a2;
      vec2 a1 = arc ? prevEnd : a2;
      best = min(best, min(polySegD2(ps, a1, m), min(polySegD2(ps, m, a2), polySegD2(ps, a2, b2))));
      prevEnd = b2;
      prevN = n;
    }
  }
  return dl < 0.0 ? -sqrt(best) : sqrt(best);
}
`
});

const TAPER_ENDS: [string, string, string][] = [
	['both', 'Both ends', 'full width in the middle, narrowing to both ends (a spindle, a leaf)'],
	['end', 'Towards the end', 'full width at the start, narrowing to the end (a wedge, a comet, a claw)']
];
const tapered = (p: ParamValues) => Number(p.taper) > 0;

/** Thickness, caps and taper of the stroke shapes (Line, Curve). */
const strokeParams = (): ParamDef[] => [
	P.float('thickness', 'Thickness', 2, 0, 2048, { softMax: 256, unit: 'px', step: 0.1 }),
	P.enum('caps', 'Caps', 'round', [
		['round', 'Round', 'a half disc past each end (reaching half the thickness beyond the length)'],
		['flat', 'Flat', 'cut square at the ends']
	]),
	P.float('taper', 'Taper', 0, 0, 1, {
		step: 0.001,
		hint: 'Narrows the stroke towards its ends: 0 = even, 1 = to a point'
	}),
	P.enum('taper_ends', 'Taper towards', 'both', TAPER_ENDS, { showIf: tapered }),
	P.float('taper_curve', 'Taper curve', 1, 0.1, 10, {
		softMin: 0.25,
		softMax: 4,
		step: 0.01,
		showIf: tapered,
		hint: 'How the width falls off: 1 = straight sides; above 1 = it stays wide, then narrows late (rounded sides — a leaf, a spindle); below 1 = it narrows early into a long fine point (hollow sides — a needle, a thorn)'
	}),
	P.float('len_jitter', 'Length jitter', 0, 0, 0.95, {
		step: 0.001,
		hint: 'Shortens each repeated instance by up to this fraction, at random — keeping the thickness (Scale jitter shrinks both)'
	})
];

export const lineLayer = shape({
	type: 'line',
	label: 'Line',
	description: 'Straight strokes, even or tapered: seams, grooves, light strips, scratches, spikes, leaves.',
	params: [
		P.float('length', 'Length', 96, 0, 8192, {
			softMax: 1024,
			unit: 'px',
			step: 0.5,
			hint: 'From end to end (round caps reach half the thickness further)'
		}),
		...strokeParams(),
		spanParam()
	],
	defaults: { bevel: 1 },
	fresh: (t) => {
		const th = Math.max(2, Math.round(short(t) / 64));
		return { length: Math.round(short(t) * 0.6), thickness: th, bevel: half(th / 2) };
	},
	sdfGlsl:
		TAPER_GLSL +
		/* glsl */ `
float shapeExtent(vec2 cell) { return (u_length + u_thickness) * 0.5; }
float shapeInradius(vec2 cell) { return u_thickness * 0.5; }
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  // p = (along, across) from where the width is r0 (the middle, folded, for a taper to both ends; else the start) to h,
  // where it is r1.
  float len = u_length * (1.0 - u_len_jitter * fract(rnd * 53.71 + 0.27));
  bool both = u_taper_ends == 0;
  float h = both ? len * 0.5 : len;
  vec2 p = vec2(both ? abs(q.x) : q.x + len * 0.5, abs(q.y));
  float r0 = u_thickness * 0.5;
  float tp = clamp(u_taper, 0.0, 1.0);
  float r1 = r0 * (1.0 - tp);
  if (tp > 0.0 && abs(u_taper_curve - 1.0) > 1e-3 && h > 1e-3) {
    // A curved taper (taperShape): the distance across, corrected for the slope of the side.
    vec2 f = taperShape(clamp(p.x / h, 0.0, 1.0));
    float r = r0 * (1.0 - tp * f.x);
    float dr = r0 * tp * f.y / h;
    float side = (p.y - r) / sqrt(1.0 + min(dr * dr, 100.0));
    if (u_caps == 0) {
      if (p.x > h) return length(p - vec2(h, 0.0)) - r1;
      if (!both && p.x < 0.0) return length(p) - r0;
      return side;
    }
    return max(side, max(p.x - h, both ? -1e9 : -p.x));
  }
  if (u_caps == 0) {
    // Round caps: the capsule tapering from r0 to r1 (exact).
    if (h <= r0 - r1 + 1e-4) return min(length(p) - r0, length(p - vec2(h, 0.0)) - r1);
    float b = (r0 - r1) / h;
    float a = sqrt(1.0 - b * b);
    float k = dot(p, vec2(a, -b));
    if (k < 0.0) return length(p) - r0;
    if (k > a * h) return length(p - vec2(h, 0.0)) - r1;
    return dot(p, vec2(b, a)) - r0;
  }
  // Flat caps: the bar narrowing from r0 to r1 — its slanted side, its end, and its start when that is an end too.
  vec2 sv = vec2(h, r1 - r0), ps = p - vec2(0.0, r0);
  float dSide = length(ps - sv * clamp(dot(ps, sv) / max(dot(sv, sv), 1e-8), 0.0, 1.0));
  float dEnd = length(p - vec2(h, min(p.y, r1)));
  float dStart = both ? 1e9 : length(p - vec2(0.0, min(p.y, r0)));
  bool inside = p.x <= h && (both || p.x >= 0.0) && (p.y - r0) * h <= (r1 - r0) * p.x;
  float d = min(dSide, min(dEnd, dStart));
  return inside ? -d : d;
}
// The outline for Bevel aspect (GLSL_BEVEL): with straight sides, the bar or tapered capsule from its start (half width
// r0) to its end (r1) — each side a segment, the caps segments or arcs — or, tapering to both ends, two of them from the
// middle, with the middle's arcs between their sides (round caps); with a curved taper, the sides sampled.
#define SHAPE_EDGES
float shapeEdges(vec2 q, float rnd, vec2 cell, vec2 ax, vec2 ay, float dl) {
  gShapeEdgesAll = true;
  float tp = clamp(u_taper, 0.0, 1.0);
  float len = u_length * (1.0 - u_len_jitter * fract(rnd * 53.71 + 0.27));
  bool both = u_taper_ends == 0;
  float r0 = u_thickness * 0.5, r1 = r0 * (1.0 - tp);
  float h = both ? len * 0.5 : len;
  mat2 M = bevelFrame(ax, ay);
  vec2 ps = M * q;
  if (tp > 0.0 && abs(u_taper_curve - 1.0) > 1e-3) {
    // A curved taper: each side sampled in 32 steps along the length, the ends' caps (circles of the end widths, as
    // shapeSdf rounds them; or straight across).
    float x0 = -len * 0.5;
    float r = both ? r1 : r0;
    vec2 a1 = M * vec2(x0, r), a2 = M * vec2(x0, -r);
    float d2 = u_caps == 0 ? bevelArc2(ps, M, vec2(x0, 0.0), r, vec2(0.0, 1.0), vec2(0.0, -1.0), vec2(-1.0, 0.0))
                           : bevelSeg2(ps, a1, a2);
    for (int i = 1; i <= 32; i++) {
      float x = x0 + len * float(i) / 32.0;
      r = r0 * (1.0 - tp * taperShape(clamp(both ? abs(x) / max(h, 1e-3) : (x - x0) / max(len, 1e-3), 0.0, 1.0)).x);
      vec2 b1 = M * vec2(x, r), b2 = M * vec2(x, -r);
      d2 = min(d2, min(bevelSeg2(ps, a1, b1), bevelSeg2(ps, a2, b2)));
      a1 = b1;
      a2 = b2;
    }
    d2 = min(d2, u_caps == 0 ? bevelArc2(ps, M, vec2(-x0, 0.0), r, vec2(0.0, 1.0), vec2(0.0, -1.0), vec2(1.0, 0.0))
                             : bevelSeg2(ps, a1, a2));
    return dl < 0.0 ? -sqrt(d2) : sqrt(d2);
  }
  // Round caps: the sides touch the circles where the normal tilts by the taper's slope.
  float sl = clamp((r0 - r1) / max(h, 1e-4), -1.0, 1.0), cs = sqrt(1.0 - sl * sl);
  float d2 = 1e18;
  for (int k = 0; k < (both ? 2 : 1); k++) {
    vec2 dir = vec2(k == 0 ? 1.0 : -1.0, 0.0);
    vec2 A = both ? vec2(0.0) : vec2(-len * 0.5, 0.0), B = A + dir * h;
    vec2 nrm = vec2(0.0, 1.0);
    vec2 u1 = u_caps == 0 ? sl * dir + cs * nrm : nrm, u2 = u_caps == 0 ? sl * dir - cs * nrm : -nrm;
    vec2 a1 = A + r0 * u1, a2 = A + r0 * u2, b1 = B + r1 * u1, b2 = B + r1 * u2;
    d2 = min(d2, min(bevelSeg2(ps, M * a1, M * b1), bevelSeg2(ps, M * a2, M * b2)));
    if (u_caps == 0) {
      d2 = min(d2, bevelArc2(ps, M, B, r1, u1, u2, dir));
      if (!both) d2 = min(d2, bevelArc2(ps, M, A, r0, u1, u2, -dir));
    } else {
      d2 = min(d2, bevelSeg2(ps, M * b1, M * b2));
      if (!both) d2 = min(d2, bevelSeg2(ps, M * a1, M * a2));
    }
  }
  if (both && u_caps == 0) {
    // Where the halves meet: the middle circle between their sides, above and below.
    d2 = min(d2, min(bevelArc2(ps, M, vec2(0.0), r0, vec2(sl, cs), vec2(-sl, cs), vec2(0.0, 1.0)),
                     bevelArc2(ps, M, vec2(0.0), r0, vec2(sl, -cs), vec2(-sl, -cs), vec2(0.0, -1.0))));
  }
  return dl < 0.0 ? -sqrt(d2) : sqrt(d2);
}
`
});

export const curveLayer = shape({
	type: 'curve',
	label: 'Curve',
	description:
		'A circular arc or a Bézier stroke, even or tapered — pipe elbows, horseshoes, arches, cables, hooks, claws.',
	params: [
		P.enum('kind', 'Shape', 'arc', [
			['bezier', 'Bézier', 'a parabola-like bow, which Bend position can push towards an end (hooks)'],
			[
				'arc',
				'Circular arc',
				'part of a circle through both ends — a semicircle when Bend is half the Length, a horseshoe beyond'
			]
		]),
		P.float('length', 'Length', 96, 0, 8192, {
			softMax: 1024,
			unit: 'px',
			step: 0.5,
			hint: 'From one end to the other, in a straight line'
		}),
		P.float('bend', 'Bend', 32, -4096, 4096, {
			softMin: -512,
			softMax: 512,
			unit: 'px',
			step: 0.5,
			hint: 'How far the middle of the curve bows out from the straight line between its ends (negative: the other way)'
		}),
		P.float('bend_at', 'Bend position', 0, -3, 3, {
			softMin: -2,
			softMax: 2,
			step: 0.001,
			showIf: (p) => p.kind !== 'arc',
			hint: 'Moves the bend towards the start (−) or the end (+): a hook instead of an arch; past ±1 the end curls back on itself'
		}),
		P.enum('pivot', 'Centre on', 'middle', [
			[
				'chord',
				'Between the ends',
				'X / Y, rotation and the repeat place the middle of the straight line between the ends'
			],
			[
				'middle',
				'Middle of the curve',
				'they place the middle of the curve’s bounds, so turned instances stay centred in their cells'
			]
		]),
		...strokeParams(),
		spanParam()
	],
	defaults: { thickness: 3, bevel: 1.5 },
	fresh: (t) => {
		const th = Math.max(2, Math.round(short(t) / 64));
		return {
			length: Math.round(short(t) * 0.6),
			bend: Math.round(short(t) * 0.12),
			thickness: th,
			bevel: half(th / 2)
		};
	},
	sdfGlsl:
		TAPER_GLSL +
		/* glsl */ `
// Quadratic Bézier A → B → C: the distance to it and the curve parameter (0..1) of the closest point (after Inigo Quilez).
vec2 sdBezierT(vec2 pos, vec2 A, vec2 B, vec2 C) {
  vec2 a = B - A;
  vec2 b = A - 2.0 * B + C;
  vec2 c = a * 2.0;
  vec2 d = A - pos;
  // Within 0.05 px of straight (|b| / 4 is how far the middle bows out): the segment, where the cubic is ill-conditioned.
  if (dot(b, b) < 0.04) {
    vec2 ca = C - A;
    float t = clamp(dot(pos - A, ca) / max(dot(ca, ca), 1e-8), 0.0, 1.0);
    return vec2(length(pos - A - ca * t), t);
  }
  float kk = 1.0 / dot(b, b);
  float kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float p = ky - kx * kx;
  float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p * p * p;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    return vec2(length(d + (c + b * t) * t), t);
  }
  float z = sqrt(-p);
  float v = acos(clamp(q / (p * z * 2.0), -1.0, 1.0)) / 3.0;
  float m = cos(v);
  float n = sin(v) * 1.732050808;
  vec2 t = clamp(vec2(m + m, -n - m) * z - kx, 0.0, 1.0);
  float d1 = dot2(d + (c + b * t.x) * t.x);
  float d2 = dot2(d + (c + b * t.y) * t.y);
  return d1 < d2 ? vec2(sqrt(d1), t.x) : vec2(sqrt(d2), t.y);
}
// The circle through (±L/2, 0) and (0, sag), sag > 0: its radius and the half angle of the arc (from the top).
vec2 arcGeom(float L, float sag) {
  float R = (L * L * 0.25 + sag * sag) / (2.0 * sag);
  return vec2(R, atan(L * 0.5 / R, (R - sag) / R));
}
bool curveIsArc(float bend) { return u_kind == 1 && abs(bend) > 0.05; }
// Where the curve's own middle (its bounds' centre) lies from the middle of its chord, for Centre on › Middle.
vec2 curvePivot(float L, float bend) {
  if (u_pivot == 0) return vec2(0.0);
  float bx = u_bend_at * L * 0.5;
  float x0 = -L * 0.5, x1 = L * 0.5;
  if (!curveIsArc(bend) && abs(bx) > L * 0.5) {
    // A control point past an end: the curve overshoots it (x' = 0 at t*).
    float t = (bx + L * 0.5) / (2.0 * bx);
    float x = (1.0 - t) * (1.0 - t) * x0 + 2.0 * t * (1.0 - t) * bx + t * t * x1;
    x0 = min(x0, x);
    x1 = max(x1, x);
  }
  return vec2((x0 + x1) * 0.5, bend * 0.5);
}
float shapeExtent(vec2 cell) {
  // Within its control triangle (Bézier; C mirrors A) or its bounds (arc), from the pivot.
  float L = u_length, bend = u_bend;
  float e;
  if (curveIsArc(bend)) {
    vec2 g = arcGeom(L, abs(bend));
    e = length(vec2(g.y > 1.5707963 ? g.x : L * 0.5, bend));
  } else {
    e = max(L * 0.5, length(vec2(u_bend_at * L * 0.5, bend * 2.0)));
  }
  return e + length(curvePivot(L, bend)) + u_thickness * 0.5;
}
float shapeInradius(vec2 cell) { return u_thickness * 0.5; }
// Half the width at curve parameter t: narrowing from the middle to both ends, or from the start to the end.
float curveR(float t) {
  float u = u_taper_ends == 0 ? abs(2.0 * t - 1.0) : t;
  return u_thickness * 0.5 * (1.0 - clamp(u_taper, 0.0, 1.0) * taperShape(u).x);
}
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  float f = 1.0 - u_len_jitter * fract(rnd * 53.71 + 0.27);
  float L = u_length * f, bend = u_bend * f;
  q += curvePivot(L, bend);
  vec2 A = vec2(-L * 0.5, 0.0), C = vec2(L * 0.5, 0.0);
  vec2 dt, tA, tC;   // distance and curve parameter; the outward tangents at the ends
  if (curveIsArc(bend)) {
    // Circular arc: in the frame where it bows upwards (the flip keeps the ends where they are).
    float sg = sign(bend);
    vec2 g = arcGeom(L, abs(bend));
    vec2 pc = vec2(q.x, q.y * sg) - vec2(0.0, abs(bend) - g.x);
    float phi = atan(pc.x, pc.y);
    if (abs(phi) <= g.y) dt = vec2(abs(length(pc) - g.x), 0.5 + phi / (2.0 * g.y));
    else { float da = length(q - A), dc = length(q - C); dt = da < dc ? vec2(da, 0.0) : vec2(dc, 1.0); }
    tA = vec2(-cos(g.y), -sin(g.y) * sg);
    tC = vec2(cos(g.y), -sin(g.y) * sg);
  } else {
    vec2 B = vec2(u_bend_at * L * 0.5, bend * 2.0);
    dt = sdBezierT(q, A, B, C);
    vec2 ta = A - B, tc = C - B;
    if (dot(ta, ta) < 1e-6) ta = A - C;   // the control point on an end: the chord's direction
    if (dot(tc, tc) < 1e-6) tc = C - A;
    tA = normalize(ta);
    tC = normalize(tc);
  }
  float d = dt.x - curveR(dt.y);
  if (u_caps == 0) return d;
  // Flat caps, square to the curve at each end: past an end (the closest point is the end itself) the distance to the
  // cap; elsewhere the stroke, cut by the cap's line near its end.
  bool atEnd = dt.y >= 0.5;
  vec2 E = atEnd ? C : A;
  vec2 tg = atEnd ? tC : tA;
  float rE = curveR(atEnd ? 1.0 : 0.0);
  float along = dot(q - E, tg);
  float across = abs(dot(q - E, vec2(-tg.y, tg.x))) - rE;
  if (dt.y <= 0.0 || dt.y >= 1.0) return length(max(vec2(along, across), 0.0)) + min(max(along, across), 0.0);
  return length(q - E) < 2.0 * rE + 1.0 ? max(d, along) : d;
}
// The outline for Bevel aspect (GLSL_BEVEL): the curve sampled in 32 steps, each side's edge (the curve ± its half width
// across it) a polyline, and the caps (arcs, or straight across) — in the stretched space.
vec2 curveAt(float t, float L, float bend, out vec2 tg) {
  if (curveIsArc(bend)) {
    float sg = sign(bend);
    vec2 g = arcGeom(L, abs(bend));
    float a = (2.0 * t - 1.0) * g.y;
    tg = vec2(cos(a), -sin(a) * sg);
    return vec2(g.x * sin(a), (g.x * cos(a) + abs(bend) - g.x) * sg);
  }
  vec2 A = vec2(-L * 0.5, 0.0), B = vec2(u_bend_at * L * 0.5, bend * 2.0), C = vec2(L * 0.5, 0.0);
  vec2 dv = 2.0 * (1.0 - t) * (B - A) + 2.0 * t * (C - B);
  tg = dot(dv, dv) > 1e-10 ? normalize(dv) : normalize(C - A);
  return (1.0 - t) * (1.0 - t) * A + 2.0 * t * (1.0 - t) * B + t * t * C;
}
#define SHAPE_EDGES
float shapeEdges(vec2 q, float rnd, vec2 cell, vec2 ax, vec2 ay, float dl) {
  gShapeEdgesAll = true;
  float f = 1.0 - u_len_jitter * fract(rnd * 53.71 + 0.27);
  float L = u_length * f, bend = u_bend * f;
  q += curvePivot(L, bend);
  mat2 M = bevelFrame(ax, ay);
  vec2 ps = M * q;
  vec2 t0;
  vec2 P0 = curveAt(0.0, L, bend, t0);
  float r = curveR(0.0);
  vec2 n0 = vec2(-t0.y, t0.x);
  vec2 l = M * (P0 + r * n0), rt = M * (P0 - r * n0);
  // The start's cap.
  float d2 = u_caps == 0 ? bevelArc2(ps, M, P0, r, n0, -n0, -t0) : bevelSeg2(ps, l, rt);
  vec2 t1 = t0, P1 = P0;
  for (int i = 1; i <= 32; i++) {
    float t = float(i) / 32.0;
    P1 = curveAt(t, L, bend, t1);
    r = curveR(t);
    vec2 n1 = vec2(-t1.y, t1.x);
    vec2 l1 = M * (P1 + r * n1), r1 = M * (P1 - r * n1);
    d2 = min(d2, min(bevelSeg2(ps, l, l1), bevelSeg2(ps, rt, r1)));
    l = l1;
    rt = r1;
  }
  // The end's cap.
  vec2 n1 = vec2(-t1.y, t1.x);
  d2 = min(d2, u_caps == 0 ? bevelArc2(ps, M, P1, r, n1, -n1, t1) : bevelSeg2(ps, l, rt));
  return dl < 0.0 ? -sqrt(d2) : sqrt(d2);
}
`
});

export const crossLayer = shape({
	type: 'cross',
	label: 'Cross',
	description:
		'Plus, cross, Y and asterisk shapes with rounded ends, filleted inner corners and an optional long stem — screws, markers, badges.',
	params: [
		P.int('arms', 'Arms', 4, 3, 16, {
			softMax: 8,
			hint: '4 = a plus (turn it 45° for an ×), 3 = a Y, 6 or 8 = an asterisk. Odd counts point one arm down'
		}),
		P.float('size', 'Arm length', 16, 0, 4096, {
			softMax: 256,
			unit: 'px',
			step: 0.1,
			hint: 'From the centre to the end of an arm'
		}),
		P.float('arm', 'Arm width', 4, 0, 2048, { softMax: 128, unit: 'px', step: 0.1 }),
		P.float('stem', 'Longer bottom arm', 0, 0, 4096, {
			softMax: 256,
			unit: 'px',
			step: 0.1,
			hint: 'Extends the arm pointing down by this much — a Latin cross, a sword, a signpost'
		}),
		P.float('corner', 'Rounding', 0, 0, 1024, {
			softMax: 128,
			unit: 'px',
			step: 0.1,
			hint: 'Rounds the arms’ outer corners, keeping their length and width (half the width = round ends)'
		}),
		P.float('fillet', 'Inner rounding', 0, 0, 1024, {
			softMax: 128,
			unit: 'px',
			step: 0.1,
			hint: 'Rounds the inside corners where the arms meet with an arc of this radius'
		}),
		spanParam()
	],
	fresh: (t) => ({
		size: Math.round(short(t) * 0.16),
		arm: Math.round(short(t) * 0.07),
		corner: Math.round(short(t) / 128),
		fillet: Math.round(short(t) / 128),
		bevel: freshBevel(t)
	}),
	sdfGlsl: /* glsl */ `
float crossW() { return clamp(u_arm * 0.5, 0.0, max(u_size, 0.0) * tan(PI / float(u_arms))); }
float shapeExtent(vec2 cell) { return length(vec2(u_size + max(u_stem, 0.0), u_arm * 0.5)); }
float shapeInradius(vec2 cell) { return crossW(); }
float shapeSdf(vec2 q, float rnd, vec2 cell) {
  // Odd counts point arm 0 down (a Y); fold into half an arm's sector: x along the arm, 0 <= y <= x·tan(π / arms)
  // across it. The boundary there: the arm's side (y = w) from the inner fillet to the outer corner, the corner's arc, the
  // end (x = s), the fillet.
  vec2 qa = imod(u_arms, 2) == 1 ? -q : q;
  float an = PI / float(u_arms);
  float bn = mod(atan(qa.x, qa.y) + an, 2.0 * an) - an;
  vec2 p = length(qa) * vec2(cos(bn), abs(sin(bn)));
  float s = max(u_size, 0.0);
  float tn = tan(an);
  float w = crossW();
  float ro = clamp(u_corner, 0.0, min(w, s));
  float rf = clamp(u_fillet, 0.0, max((s - ro) * tn - w, 0.0));
  vec2 c = vec2((w + rf) / tn, w + rf);    // the fillet's centre, on the line between this arm and the next
  vec2 o = vec2(s - ro, w - ro);           // the outer corner's centre
  vec2 po = p - o;
  vec2 pf = p - c;
  float dSide = length(p - vec2(clamp(p.x, c.x, max(o.x, c.x)), w));
  float dCorner = po.x > 0.0 && po.y > 0.0 ? abs(length(po) - ro) : 1e9;
  float dEnd = length(p - vec2(s, clamp(p.y, 0.0, w - ro)));
  float dFillet = pf.x <= 0.0 ? abs(length(pf) - rf) : 1e9;
  float d = min(min(dSide, dCorner), min(dEnd, dFillet));
  bool arm = p.x <= s && p.y <= w && !(po.x > 0.0 && po.y > 0.0 && length(po) > ro);
  bool fill = p.y > w && pf.x < 0.0 && length(pf) > rf;
  d = arm || fill ? -d : d;
  // The bevel, arm by arm: this arm's own (rounded) bar, so the arms keep their height where they cross instead of
  // rising to a peak; beside the junction it blends into the fillet's depth.
  vec2 kb = p - o;
  float armD = min(max(kb.x, kb.y), 0.0) + length(max(kb, 0.0)) - ro;
  float bev = armD + min(d - armD, 0.0) * clamp(1.0 - (w - p.y) / max(rf, 1e-3), 0.0, 1.0);
  if (u_stem > 0.0) {
    // The longer bottom arm: a bar from the centre down past the arm's end (its top end hides in the junction).
    float sl = s + u_stem;
    float stem = sdRoundBox(q - vec2(0.0, -sl * 0.5), vec2(w, sl * 0.5), vec4(ro));
    d = min(d, stem);
    bev = min(bev, stem);
  }
  gShapeBevel = bev;
  return d;
}
// Bevel aspect (GLSL_BEVEL): the arms' bevel as the shape measures it — the arms' own bars (the deepest, so the arms meet
// without a step), the fillet's blend, the stem — with each bar's distance in the stretched space. sb: the bar's centre, along-axis u (local), half sizes hb, corner r.
float crossBar(vec2 q, vec2 ps, mat2 M, vec2 c, vec2 u, vec2 hb, float r) {
  vec2 v = vec2(-u.y, u.x);
  vec2 bq = vec2(dot(q - c, u), dot(q - c, v));
  float d2 = 1e18;
  vec2 sg[4] = vec2[4](vec2(1.0), vec2(-1.0, 1.0), vec2(-1.0), vec2(1.0, -1.0));
  for (int i = 0; i < 4; i++) {
    vec2 s = sg[i], s1 = sg[(i + 1) % 4];
    vec2 k = s * hb, k1 = s1 * hb;
    bool top = (i % 2) == 0;
    // The side to the next corner, then this corner's arc (all in the bar's frame: u, v).
    vec2 a = top ? k - vec2(s.x * r, 0.0) : k - vec2(0.0, s.y * r);
    vec2 b = top ? k1 - vec2(s1.x * r, 0.0) : k1 - vec2(0.0, s1.y * r);
    d2 = min(d2, bevelSeg2(ps, M * (c + u * a.x + v * a.y), M * (c + u * b.x + v * b.y)));
    vec2 kc = k - s * r;
    d2 = min(d2, bevelArc2(ps, M, c + u * kc.x + v * kc.y, r, u * s.x, v * s.y, normalize(u * s.x + v * s.y)));
  }
  return sdRoundBox(bq, hb, vec4(r)) < 0.0 ? -sqrt(d2) : sqrt(d2);
}
#define SHAPE_EDGES
float shapeEdges(vec2 q, float rnd, vec2 cell, vec2 ax, vec2 ay, float dl) {
  gShapeEdgesAll = true;
  float sgo = imod(u_arms, 2) == 1 ? -1.0 : 1.0;
  vec2 qa = sgo * q;
  float an = PI / float(u_arms);
  float th = atan(qa.x, qa.y) + an;
  float bn = mod(th, 2.0 * an) - an;
  // The folded frame's axes in the local one (as shapeSdf folds): x along p's arm, y towards p's side of it.
  vec2 fx = sgo * vec2(sin(th - an - bn), cos(th - an - bn));
  vec2 fy = (bn < 0.0 ? -1.0 : 1.0) * vec2(fx.y, -fx.x);
  vec2 p = length(qa) * vec2(cos(bn), abs(sin(bn)));
  float s = max(u_size, 0.0);
  float w = crossW();
  float ro = clamp(u_corner, 0.0, min(w, s));
  float rf = clamp(u_fillet, 0.0, max((s - ro) * tan(an) - w, 0.0));
  mat2 M = bevelFrame(ax, ay);
  vec2 ps = M * q;
  // p's arm's bar, from its end through the middle to just past the junction (B: where the arms' sides meet, beyond
  // which shapeSdf never measures a bar), and every other arm's — any can be the deepest near the middle — as a plain
  // box (its rounded end is far from p).
  float B = w / tan(an) + w;
  float bev = crossBar(q, ps, M, 0.5 * (s - B) * fx, fx, vec2(0.5 * (s + B), w), ro);
  int own = imod(int(floor(th / (2.0 * an))), u_arms);
  for (int j = 0; j < u_arms; j++) {
    vec2 u = sgo * vec2(sin(2.0 * an * float(j)), cos(2.0 * an * float(j)));
    vec2 sv = mat2(ax, ay) * vec2(-u.y, u.x), su = mat2(ax, ay) * u;
    float al = dot(q, u);
    float b = max(max(bevelLine(al - s, su), bevelLine(-al - B, su)), bevelLine(abs(dot(q, vec2(-u.y, u.x))) - w, sv));
    bev = min(bev, j == own ? 1e9 : b);
  }
  // Beside the junction the bevel blends into the outline's depth there: every arm's sides and the fillets between them
  // (any can be the nearest, stretched), each arm in its own frame (x along it, y across; the next arm round lies on
  // its −y side, the fillet between them centred on the line halfway).
  float wgt = clamp(1.0 - (w - p.y) / max(rf, 1e-3), 0.0, 1.0);
  if (wgt > 0.0) {
    vec2 c = vec2((w + rf) / tan(an), -(w + rf));
    vec2 t = vec2(cos(an), -sin(an));
    vec2 k = vec2(0.0, 1.0);
    float dF2 = 1e18;
    for (int j = 0; j < u_arms; j++) {
      vec2 u = sgo * vec2(sin(2.0 * an * float(j)), cos(2.0 * an * float(j)));
      mat2 Ma = M * mat2(u, vec2(-u.y, u.x));
      dF2 = min(dF2, min(bevelSeg2(ps, Ma * vec2(c.x, w), Ma * vec2(s - ro, w)), bevelSeg2(ps, Ma * vec2(c.x, -w), Ma * vec2(s - ro, -w))));
      dF2 = min(dF2, bevelArc2(ps, Ma, c, rf, k, 2.0 * dot(k, t) * t - k, -t));
    }
    float dF = dl < 0.0 ? -sqrt(dF2) : sqrt(dF2);
    bev += min(dF - bev, 0.0) * wgt;
  }
  if (u_stem > 0.0) {
    float sl = s + u_stem;
    bev = min(bev, crossBar(q, ps, M, vec2(0.0, -sl * 0.5), vec2(0.0, 1.0), vec2(sl * 0.5, w), ro));
  }
  return bev;
}
`
});

export const SHAPE_LAYERS = [rectLayer, circleLayer, polygonLayer, lineLayer, curveLayer, crossLayer];
