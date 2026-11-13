// Radial / emblem motifs (FR7.2c): rosettes (rings, spokes, stars, star polygons, petals, bead rings) and
// procedural glyphs (mirrored random strokes on a small node grid: runes, sigils, insignia). Both share a
// placement + repeat wrapper (MOT_REPEAT, on the shared Repeat of glsl/repeat.ts: the instances on the grid or along an
// outline that can reach the pixel, torus copies when tiling), with a bounding-circle test so far instances cost one
// length().

import { P, round1 as r1, type ParamDef } from '@/core/params';
import { placementParams } from '../commonParams';
import { GLSL_REPEAT } from '../glsl/repeat';
import { REPEAT_GROUP, repeatParams, withRepeat } from '../repeat';
import type { LayerDef } from '../types';
import { GLSL_MOT_COMMON, MOTIF_DEFAULTS } from './motifCommon';

/** The motif toolkit, and the height Rosette's motifSdf leaves for MOT_REPEAT (declared before motifSdf). */
const GLSL_MOT_INST =
	GLSL_MOT_COMMON +
	/* glsl */ `
// The sculpted height (0..1) motifSdf leaves for the output (Rosette); the repeat keeps the nearest instance's.
float gMotH = 0.0;
`;

const PLACEMENT: ParamDef[] = placementParams();

const REPEAT: ParamDef[] = repeatParams({
	grid: 'cells',
	softMax: 16,
	jitter: 'cell',
	scaleHint:
		'Shrinks each instance by a random amount (0 = all full size, 0.5 = anywhere from half to full size). Line widths and bevels shrink with it'
});

/**
 * Instancing wrapper. The layer supplies:
 *   float motifBound()                          — radius (px) enclosing the motif
 *   vec2  motifSnap(vec2 centre)                — pixel snapping of an instance centre
 *   float motifSdf(vec2 q, float inst)          — distance at q (px from the centre, y up, un-rotated)
 *   GenOut motifOut(float d, float rnd, vec2 nearQ, float h) — final output (nearQ = offset from the nearest
 *                                                 centre; h = gMotH as motifSdf left it for the nearest instance)
 *   MOT_TAPS, MOT_BLUR                          — (defines) taps and radius of the value's blur (Rosette's glow)
 *   MOT_EXACT                                   — (define) how far from the motif the output needs the exact
 *                                                 distance: past it, the bounding circle's lower bound does
 *   MOT_STRETCH                                 — (define) whether the output takes Bevel aspect's distance: then
 *                                                 the nearest instance is measured once more after the others, with
 *                                                 gMotStr set (motifSdf returns the distance in the space the aspect
 *                                                 stretches, gMotF its local axes on screen), into GenOut.bdist
 * Size variation evaluates an instance at q / s and scales its distance by s (s ≤ 1, so the bound still holds).
 */
const MOT_REPEAT =
	GLSL_REPEAT +
	/* glsl */ `
GenOut gen(vec2 p0) {
  ivec2 n = ivec2(max(u_rep_x, 1), max(u_rep_y, 1));
  // The step between instances (Column / Row spacing); X / Y place each within its step.
  RepFrame f = repFrame(n, vec2(repPitch(uRes.x, n.x, u_col_sp, uRes.x), repPitch(uRes.y, n.y, u_row_sp, uRes.y)), 0.5 * uRes);
  f.stagger = u_rep_stagger * f.pitch.x;
  f.mirror = bvec2(u_rep_mirror_x, u_rep_mirror_y);
  f.off = vec2(u_x - 0.5, 0.5 - u_y) * f.pitch;
  f.rot = u_rotation;
  f.jitStep = u_rep_jit;
  f.near = 1.5;
  float bound = motifBound();
  // MOT_TAPS > 1: the value averaged over taps on a Vogel disc of radius MOT_BLUR (Rosette's glow softness).
  int taps = max(MOT_TAPS, 1);
  // The instances to visit: every one whose motif can reach a tap (its bound, the blur, snapping), and at least those
  // within a step and a half — the neighbours either side, whose distance the output needs too.
  RepSrc s0 = repBegin(p0, f, vec2(bound + MOT_BLUR + 2.0));
  int nxy = max(repIters(s0), 1);
  GenOut g0 = genOut(0.0, 1.0, 0.0, NO_SDF);
  float acc = 0.0;
  float best = 1e9, bestRnd = 0.0, bestH = 0.0, nearR = 1e9;
  vec2 nearQ = vec2(1e9), p = p0;
  // Bevel aspect: the nearest instance (its frame kept here) is measured again in a last pass, in the stretched space
  // — the same motifSdf call, so the shader keeps one copy of it.
  bool str = (MOT_STRETCH) && bevelAspectOn();
  int its = nxy * taps;
  vec2 wQ = vec2(0.0), wFl = vec2(1.0);
  float wAng = 0.0, wSc = 1.0, bd = NO_SDF;
  MOT_SET_STR(false);
  RepSrc s = s0;
  // One flat loop over the taps × the instances, so D3D keeps a single copy of the body and of motifSdf (a loop of
  // taps round the instance loop made the compile much slower). The nearest instances come first on the grid, and an
  // instance is measured only when its bounding circle could beat the nearest distance so far (and lies within
  // MOT_EXACT): far ones cost one length(), and the distance stays exact (a fixed cut-off just past the bound left rings
  // in a bevel reading the mask).
  for (int e = 0; e < its + (str ? 1 : 0); e++) {
    bool fin = e == its;
    int k = e % nxy;
    if (k == 0 && !fin) {
      float t = float(e / nxy) + 0.5;
      p = p0 + (taps > 1 ? MOT_BLUR * sqrt(t / float(taps)) * vec2(cos(2.39996 * t), sin(2.39996 * t)) : vec2(0.0));
      best = 1e9; bestRnd = 0.0; bestH = 0.0; nearR = 1e9; nearQ = vec2(1e9);
      s = s0;
    }
    RepInst it = repNext(s);
    if (fin || it.kept) {
      float inst = it.rnd;
      vec2 centre = motifSnap(it.centre);
      float ang = it.ang;
      float sc = it.scale;
      vec2 fl = vec2(it.flip.x ? -1.0 : 1.0, it.flip.y ? -1.0 : 1.0);
      vec2 q = unrotCW(p - centre, ang) / sc * fl;
      if (fin) {
        // The last pass: the nearest instance, in its own frame (local axes on screen, flipped as it was).
        q = wQ; ang = wAng; sc = wSc; inst = bestRnd; fl = wFl;
        MOT_SET_STR(true);
        vec2 ax = rotCW(vec2(1.0, 0.0), ang);
        gMotF = mat2(ax * fl.x, vec2(-ax.y, ax.x) * fl.y);
      }
      float r = length(q);
      float d = (r - bound) * sc;
      if (fin || d < min(best, MOT_EXACT)) d = motifSdf(q, inst) * sc;
      if (fin) {
        if (best < 1e8) bd = d;
      } else {
        if (d < best) { best = d; bestRnd = inst; bestH = gMotH; wQ = q; wAng = ang; wSc = sc; wFl = fl; }
        if (r < nearR) { nearR = r; nearQ = q; }
      }
    }
    if (!fin && k == nxy - 1) {
      GenOut go = motifOut(best, bestRnd, nearQ, bestH);
      acc += go.value;
      if (e == nxy - 1) g0 = go;
    }
  }
  g0.value = acc / float(taps);
  if (str) g0.bdist = bd;
  return g0;
}
`;

const GLSL_TRAPEZOID = /* glsl */ `
// Isosceles trapezoid along y (after Inigo Quilez): half width r1 at y = -he, r2 at y = +he.
float mot_trapezoid(vec2 p, float r1, float r2, float he) {
  vec2 k1 = vec2(r2, he);
  vec2 k2 = vec2(r2 - r1, 2.0 * he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, (p.y < 0.0) ? r1 : r2), abs(p.y) - he);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / max(dot2(k2), 1e-8), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot2(ca), dot2(cb)));
}
// Fold q (at angle qa = atan(q.x, q.y), clockwise from up on screen) into the sector (2π/n wide) around 'up' rotated
// by off·step; returns the local point (y = radial).
vec2 mot_polarFold(vec2 q, float qa, int n, float off) {
  float s = TAU / float(max(n, 1));
  float a = qa - off * s;
  a -= s * floor(a / s + 0.5);
  return length(q) * vec2(sin(a), cos(a));
}
`;

// ------------------------------------------------------------------------------------------------ rosette

const STAR_MODES: [string, string][] = [
	['filled', 'Filled star'],
	['outline', 'Star outline'],
	['lines', 'Star polygon lines {n/k}']
];

const has = (key: string) => (p: Record<string, unknown>) => Number(p[key]) > 0;
/** A star needs two points: 0 and 1 draw none. */
const hasStar = (p: Record<string, unknown>) => Number(p.star) > 1;
/** A sculpted-height slider: shown for the Shape output's sculpted relief, when its element is there. */
const sculpted = (when: (p: Record<string, unknown>) => boolean) => (p: Record<string, unknown>) =>
	p.relief === 'sculpted' && p.output === 'shape' && when(p);
const heightHint = (what: string) =>
	`Sets how high ${what} in the sculpted relief, against the other elements (e.g. a raised rim over a lower star, with beads below both)`;
const isStrokes = (p: Record<string, unknown>) => p.style === 'strokes';

/**
 * Rosette's linked bevel: half its narrowest line (rings, spokes, star lines, bead rings, petal outlines), so every
 * element rises to the full height — the narrowest lines with a round, domed section, wider ones with rounded
 * shoulders; a fiftieth of the radius when it only has filled elements.
 */
export function rosetteBevel(p: Record<string, unknown>): number {
	const n = (k: string) => Number(p[k] ?? 0);
	const lines = [
		n('rings') > 0 ? n('ring_w') * (n('rings') > 1 ? Math.min(1, Number(p.ring_w_in ?? 1)) : 1) : 0,
		n('spokes') > 0 ? n('spoke_w') : 0,
		n('star') > 1 && p.star_mode !== 'filled' ? n('star_w') : 0,
		n('dots') > 0 ? n('dot_w') : 0,
		n('petals') > 0 ? n('petal_line') : 0
	].filter((w) => w > 0);
	return r1(Math.min(64, Math.max(0.5, lines.length ? 0.5 * Math.min(...lines) : 0.02 * n('radius'))));
}

export const rosetteLayer: LayerDef = withRepeat({
	type: 'rosette',
	label: 'Rosette',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Rosette: Radial motifs built from rings, spokes, stars, petals and beads, on their own or repeated. Makes teleporter discs, light fixtures, medallions.',
	params: [
		P.enum(
			'output',
			'Output',
			'shape',
			[
				['shape', 'Shape (SDF)'],
				['glow', 'Glow (falloff from shape)'],
				['radial', 'Radial (1 at centre → 0 at radius)']
			],
			{ hint: 'Picks what the layer puts out. Glow and Radial are plain values for emissive maps or gradient ramps' }
		),
		P.float('glow', 'Glow width', 6, 0.1, 256, {
			softMax: 64,
			unit: 'px',
			step: 0.1,
			showIf: (p) => p.output === 'glow'
		}),
		P.float('glow_soft', 'Glow softness', 0.6, 0, 1, {
			step: 0.001,
			showIf: (p) => p.output === 'glow',
			hint: 'Blurs the glow into a bloom (0 = the exact falloff from the shape, with creases where two elements are equally near; 1 = blurred across about half the glow width)'
		}),
		P.enum(
			'relief',
			'Relief',
			'sculpted',
			[
				['bevel', 'Bevel', 'the Edge bevel round the whole rosette, with every element at one height and one profile'],
				[
					'sculpted',
					'Sculpted',
					'each element gets its own profile and height: lines, beads and the hub are domed; rays, solid petals and filled stars are ridged along their spine (faceted)'
				]
			],
			{
				showIf: (p) => p.output === 'shape',
				hint: 'Picks how Height › Pattern shapes the rosette. Sculpted needs Mask › Mode set to Normal (or no mask written); combined with a mask, you get the Edge bevel instead'
			}
		),
		P.float('blend', 'Fillet', 0, 0, 256, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			showIf: (p) => p.output !== 'radial',
			hint: 'Rounds the joins between elements, filling the slivers and teeth where petals, rays, stars and the hub meet'
		}),
		P.float('radius', 'Radius', 28, 0, 4096, {
			softMax: 512,
			unit: 'px',
			step: 0.1,
			hint: 'Sets the outer radius; the elements below are placed in fractions of it'
		}),
		...PLACEMENT,
		P.float('hub', 'Hub', 0.1, 0, 1, {
			step: 0.001,
			hint: 'Fills a disc at the centre, this fraction of the radius (0 = none)'
		}),
		P.float('hub_gap', 'Hub clearance', 0, 0, 1024, {
			softMax: 64,
			unit: 'px',
			step: 0.1,
			hint: 'Clears a ring this wide round the hub (or a disc at the centre if there’s no hub). Spokes, star, petals and beads stop short of it, leaving a clean moat instead of a tangle where they converge'
		}),
		P.float('hub_h', 'Hub height', 0.9, 0, 1, {
			step: 0.001,
			showIf: sculpted((p) => Number(p.hub) > 0),
			hint: 'Sets how high the hub stands in the sculpted relief (a domed boss)'
		}),
		P.int('rings', 'Rings', 2, 0, 32, { softMax: 8, group: 'rings' }),
		P.float('ring_w', 'Ring width', 2, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			group: 'rings',
			showIf: has('rings')
		}),
		P.float('ring_in', 'Innermost ring', 0.8, 0, 1, {
			step: 0.001,
			group: 'rings',
			showIf: has('rings'),
			hint: 'Spreads the rings evenly from this fraction of the radius out to the rim'
		}),
		P.float('ring_h', 'Ring height', 1, 0, 1, {
			step: 0.001,
			group: 'rings',
			showIf: sculpted(has('rings')),
			hint: heightHint('the rings stand')
		}),
		P.float('ring_w_in', 'Innermost ring width', 1, 0, 8, {
			softMax: 3,
			step: 0.001,
			group: 'rings',
			showIf: (p) => Number(p.rings) > 1,
			hint: 'Sets the innermost ring’s width as a multiple of Ring width, grading the rings in between (0.3 = a heavy rim with fine inner rings, 2 = the reverse)'
		}),
		P.int('spokes', 'Spokes', 0, 0, 256, { softMax: 96, group: 'spokes' }),
		P.float('spoke_w', 'Spoke width', 2, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			group: 'spokes',
			showIf: has('spokes')
		}),
		P.float('spoke_taper', 'Spoke taper', 0, -1, 1, {
			step: 0.001,
			group: 'spokes',
			showIf: has('spokes'),
			hint: 'Narrows the spokes to a point (0 = even, 1 = sharp at the tip like rays, −1 = sharp at the centre)'
		}),
		P.float('spoke_in', 'Spoke start', 0.15, 0, 2, {
			softMax: 1,
			step: 0.001,
			group: 'spokes',
			showIf: has('spokes'),
			hint: 'Where the spokes start, as a fraction of the radius'
		}),
		P.float('spoke_out', 'Spoke end', 1, 0, 2, { softMax: 1.5, step: 0.001, group: 'spokes', showIf: has('spokes') }),
		P.float('spoke_off', 'Spoke angle', 0, 0, 1, {
			step: 0.001,
			group: 'spokes',
			showIf: has('spokes'),
			hint: 'Turns the spokes by this fraction of a step (0.5 puts them between the star points)'
		}),
		P.float('spoke_h', 'Spoke height', 0.55, 0, 1, {
			step: 0.001,
			group: 'spokes',
			showIf: sculpted(has('spokes')),
			hint: heightHint('the spokes stand')
		}),
		P.float('spoke_alt', 'Spoke alternation', 0, 0, 1, {
			step: 0.001,
			group: 'spokes',
			showIf: has('spokes'),
			hint: 'Shortens every other spoke by this share of its length, for compass roses and sunbursts (needs an even spoke count)'
		}),
		P.int('star', 'Star points', 8, 0, 32, {
			softMax: 16,
			group: 'star',
			hint: 'How many points the star has (0 or 1 = no star)'
		}),
		P.enum('star_mode', 'Star style', 'lines', STAR_MODES, { group: 'star', showIf: hasStar }),
		P.float('star_r', 'Star size', 0.77, 0, 2, {
			softMax: 1.2,
			step: 0.001,
			group: 'star',
			showIf: hasStar,
			hint: 'Sets the star’s size as a fraction of the radius'
		}),
		P.float('star_off', 'Star angle', 0, 0, 1, {
			step: 0.001,
			group: 'star',
			showIf: hasStar,
			hint: 'Turns the star by this fraction of a point step (0.5 puts its points between the spokes)'
		}),
		P.float('star_h', 'Star height', 0.65, 0, 1, {
			step: 0.001,
			group: 'star',
			showIf: sculpted(hasStar),
			hint: heightHint('the star stands')
		}),
		P.float('star_inner', 'Star inner radius', 0.45, 0.02, 1, {
			step: 0.001,
			group: 'star',
			showIf: (p) => hasStar(p) && p.star_mode !== 'lines'
		}),
		P.int('star_skip', 'Star skip', 3, 1, 15, {
			group: 'star',
			showIf: (p) => hasStar(p) && p.star_mode === 'lines',
			hint: 'Joins each point to the k-th next one (1 = a polygon; {5/2} = a pentagram; {7/3} = a heptagram)'
		}),
		P.bool('star_sharp', 'Sharp tips', true, {
			group: 'star',
			showIf: (p) => hasStar(p) && p.star_mode === 'lines',
			hint: 'Mitres the points to sharp tips. Off: the strokes end round'
		}),
		P.float('star_w', 'Star line width', 2, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			group: 'star',
			showIf: (p) => hasStar(p) && p.star_mode !== 'filled'
		}),
		P.int('petals', 'Petals', 0, 0, 64, { softMax: 24, group: 'petals' }),
		P.enum(
			'petal_shape',
			'Petal shape',
			'pointed',
			[
				['pointed', 'Pointed (vesica)'],
				['round', 'Round (ellipse)']
			],
			{ group: 'petals', showIf: has('petals') }
		),
		P.float('petal_pos', 'Petal position', 0.55, 0, 2, {
			softMax: 1,
			step: 0.001,
			group: 'petals',
			showIf: has('petals'),
			hint: 'Moves the petal centres in or out, as a fraction of the radius'
		}),
		P.float('petal_len', 'Petal length', 0.7, 0, 2, {
			softMax: 1,
			step: 0.001,
			group: 'petals',
			showIf: has('petals')
		}),
		P.float('petal_w', 'Petal width', 0.25, 0, 2, { softMax: 1, step: 0.001, group: 'petals', showIf: has('petals') }),
		P.float('petal_off', 'Petal angle', 0, 0, 1, {
			step: 0.001,
			group: 'petals',
			showIf: has('petals'),
			hint: 'Turns the petals by this fraction of a step'
		}),
		P.float('petal_line', 'Petal outline', 0, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			group: 'petals',
			showIf: has('petals'),
			hint: 'Draws the petals as outlines this wide (0 = solid). Overlapping outlines cross into a lattice, fused at one height with no over-and-under weave'
		}),
		P.float('petal_h', 'Petal height', 0.8, 0, 1, {
			step: 0.001,
			group: 'petals',
			showIf: sculpted(has('petals')),
			hint: heightHint('the petals stand')
		}),
		P.int('dots', 'Beads', 24, 0, 128, {
			softMax: 48,
			group: 'dots',
			hint: 'How many round beads or rivets go in the ring (0 = none)'
		}),
		P.float('dot_r', 'Bead radius', 1.5, 0, 1024, {
			softMax: 64,
			unit: 'px',
			step: 0.1,
			group: 'dots',
			showIf: has('dots')
		}),
		P.float('dot_w', 'Bead ring width', 0, 0, 256, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			group: 'dots',
			showIf: has('dots'),
			hint: 'Hollows the beads into rings this wide (0 = solid). Overlapping rings make flower-of-life rosettes'
		}),
		P.float('dot_pos', 'Bead position', 0.9, 0, 2, {
			softMax: 1.2,
			step: 0.001,
			group: 'dots',
			showIf: has('dots'),
			hint: 'Moves the bead ring in or out, as a fraction of the radius'
		}),
		P.float('dot_off', 'Bead angle', 0, 0, 1, {
			step: 0.001,
			group: 'dots',
			showIf: has('dots'),
			hint: 'Turns the beads by this fraction of a step'
		}),
		P.float('dot_h', 'Bead height', 0.8, 0, 1, {
			step: 0.001,
			group: 'dots',
			showIf: sculpted(has('dots')),
			hint: heightHint('the beads stand')
		}),
		...REPEAT
	],
	groups: [
		{ id: 'rings', label: 'Rings' },
		{ id: 'spokes', label: 'Spokes / rays', collapsed: true },
		{ id: 'star', label: 'Star' },
		{ id: 'petals', label: 'Petals', collapsed: true },
		{ id: 'dots', label: 'Beads', collapsed: true },
		REPEAT_GROUP
	],
	defaults: MOTIF_DEFAULTS,
	// The bevel follows the line widths (domed lines), and the glow / radial outputs are light: emissive, not paint
	// (Diffuse would paint the whole texture) nor relief.
	linkedDefaults: (p) => ({
		bevel: rosetteBevel(p),
		...(p.output === 'glow' || p.output === 'radial'
			? { dif_on: false, h_on: false, e_on: true }
			: { dif_on: true, h_on: true, e_on: false })
	}),
	// Added in the editor: the medallion (two rings with a bead ring between them, an {8/3} star whose tips end in
	// the inner ring, a hub) filling most of the texture, its lines in proportion.
	fresh: ({ width, height }) => {
		const R = r1(Math.max(4, 0.4 * Math.min(width, height)));
		const w = r1(Math.max(1, 0.035 * R));
		return {
			radius: R,
			ring_w: w,
			spoke_w: w,
			star_w: w,
			dot_r: r1(Math.max(1, 0.026 * R))
		};
	},
	glsl:
		GLSL_MOT_INST +
		GLSL_TRAPEZOID +
		/* glsl */ `
// An upper bound on every element's reach (MOT_REPEAT skips an instance by it): the innermost ring may be wider
// than the outer one; spokes end at the larger of their start / end; sharp {n/k} tips reach hw / cos(πk/n) past the size;
// a petal its half length or half width past its centre; a fillet a quarter of its width past the union.
float motifBound() {
  float R = u_radius, hw = 0.5 * u_ring_w;
  float b = R + max(hw, (u_rings > 1 ? hw * u_ring_w_in : hw) - hw);
  if (u_spokes > 0) b = max(b, max(u_spoke_in, u_spoke_out) * R + u_spoke_w);
  if (u_star > 1) {
    int k = clamp(u_star_skip, 1, 15);
    bool sharp = u_star_mode == 2 && u_star_sharp && 2 * k < u_star;
    float tip = 0.5 * u_star_w / max(cos(PI * float(k) / float(u_star)), 0.05);
    b = max(b, u_star_r * R + (sharp ? max(u_star_w, tip) : u_star_w));
  }
  if (u_petals > 0) b = max(b, (u_petal_pos + 0.5 * max(u_petal_len, u_petal_w)) * R);
  if (u_dots > 0) b = max(b, u_dot_pos * R + u_dot_r);
  return b + 0.25 * u_blend;
}
vec2 motifSnap(vec2 c) { return c; }

// Each element leaves its distance (E_D), its depth at full height (E_N: half its line width, its radius, or for
// ridges the half width / inradius) and its kind (E_K: 0 domed, 1 ridged — linear, faceted —, +2 cut by the hub
// clearance) in slot 0 hub, 1 rings, 2 spokes, 3 star, 4 petals, 5 beads; one loop then makes the union (smooth with
// Fillet), the sculpted height (the highest element at the point) and the nearest element's height and section
// (for the fillets' height) — one copy of that code.
float E_D[6], E_N[6];
int E_K[6];

// Spoke alternation: every other spoke (k) shortened from its outer end b (even counts, so the pattern closes).
float mot_spokeEnd(int k, float a, float b) {
  return u_spoke_alt > 0.0 && imod(u_spokes, 2) == 0 && imod(k, 2) == 1 ? max(b - (b - a) * u_spoke_alt, a + 1e-3) : b;
}

// Bevel aspect (gMotStr): each element's distance in the stretched space instead — straight edges and cuts across
// their own normals (so spokes, star points and clipped ends meet in clean mitres), circles round the centre exactly,
// rings, beads and petal arcs across their radius — and the same union.
float motifSdf(vec2 q, float inst) {
  float R = u_radius;
  float r = length(q), qa = atan(q.x, q.y);   // (the angle clockwise from up, for every polar element)
  for (int i = 0; i < 6; i++) { E_D[i] = 1e9; E_N[i] = 1.0; E_K[i] = 0; }
  if (u_hub > 0.0) { E_D[0] = r - u_hub * R; E_N[0] = u_hub * R; }
  float clipR = u_hub_gap > 0.0 ? max(u_hub, 0.0) * R + u_hub_gap : -1.0;
  float clipD = clipR - r;
  if (gMotStr) {
    // The hub and the clearance: circles round the centre (one call in a loop: one copy of it).
    for (int i = 0; i < 2 * UNI_1; i++) {
      float rr = i == 0 ? u_hub * R : clipR;
      if (rr > 0.0) {
        float e = mot_discS(q, rr);
        if (i == 0) E_D[0] = e; else clipD = -e;
      }
    }
  }
  if (u_rings > 0) {
    // Ring i (0 = outer) is centred at r1 − i·st; its half width runs from the outer ring's to the innermost's.
    // The two rings either side of r are tested (they may differ in width).
    float hw = 0.5 * u_ring_w, hwi = hw * u_ring_w_in;
    float n1 = float(u_rings - 1);
    float r1 = R - hw;                          // outer ring's outer edge sits on the radius
    float r0 = min(u_ring_in * R + hwi, r1);
    float st = u_rings > 1 ? (r1 - r0) / n1 : 0.0;
    float f = clamp(floor((r1 - r) / max(st, 1e-4)), 0.0, n1);
    float dr = 1e9, wr = hw;
    for (int j = 0; j < 2; j++) {
      float i = min(f + float(j), n1);
      float w = mix(hw, hwi, u_rings > 1 ? i / n1 : 0.0);
      float e = abs(r - (r1 - i * st)) - w;
      if (e < dr) { dr = e; wr = w; }
    }
    E_D[1] = gMotStr ? mot_bl(dr, q) : dr; E_N[1] = wr;
  }
  if (u_spokes > 0) {
    vec2 l = mot_polarFold(q, qa, u_spokes, u_spoke_off);
    float s = TAU / float(u_spokes);
    float a = u_spoke_in * R, b0 = max(u_spoke_out * R, a + 1e-3);
    int k = int(floor(qa / s - u_spoke_off + 0.5));
    float b = mot_spokeEnd(k, a, b0);
    float w0 = 0.5 * u_spoke_w * (1.0 - max(-u_spoke_taper, 0.0));
    float w1 = 0.5 * u_spoke_w * (1.0 - max(u_spoke_taper, 0.0));
    // Ridged along the spine: the depth at full height is the half width where the point is along the spoke.
    float wl = mix(w0, w1, clamp((l.y - a) / (b - a), 0.0, 1.0));
    E_D[2] = mot_trapezoid(l - vec2(0.0, 0.5 * (a + b)), w0, w1, 0.5 * (b - a)); E_N[2] = max(wl, 0.25); E_K[2] = 3;
    if (gMotStr) {
      // Each spoke a trapezoid of four half-planes: this one and those either side (their sector's edge would
      // otherwise jump between two measures).
      float ds = 1e9;
      for (int j = -UNI_1; j <= UNI_1; j++) {
        int kk = k + j;
        float th = (float(kk) + u_spoke_off) * s;
        vec2 u = vec2(sin(th), cos(th)), v = vec2(u.y, -u.x);
        float bb = mot_spokeEnd(kk, a, b0);
        float y = dot(q, u), x = dot(q, v);
        float sl = (w1 - w0) / (bb - a), ns = sqrt(1.0 + sl * sl), wy = w0 + sl * (y - a);
        ds = min(ds, max(max(mot_bl(y - bb, u), mot_bl(a - y, u)),
                         max(mot_bl((x - wy) / ns, v - sl * u), mot_bl((-x - wy) / ns, -v - sl * u))));
      }
      E_D[2] = ds;
    }
  }
  if (u_star > 1) {
    float Rs = u_star_r * R;
    vec2 qs = u_star_off != 0.0 ? unrotCW(q, u_star_off * 360.0 / float(u_star)) : q;
    // {n/k} lines: chords from vertex i to vertex i + k (vertex 0 points up). Sharp ones are bands along the chord
    // lines, clipped by the polygram outline grown by hw. The outline's edges all lie on lines tangent to one circle
    // (radius h), so growing it is a uniform scale (radius rad) with mitred tips. The outline is sdStar with divisor
    // 2n / (n − 2k + 2), i.e. inner ratio m = 1 − (divisor − 2) / (n − 2). eS: the outline every mode reads (the
    // star's own, or the grown polygram's), one sdStar call.
    int n = u_star, k = clamp(u_star_skip, 1, 15);
    float s = TAU / float(n), hw = 0.5 * u_star_w, w = u_star_w;
    bool lines = u_star_mode == 2, sharp = lines && u_star_sharp && 2 * k < n;
    float h = Rs * cos(PI * float(k) / float(n));
    float div = 2.0 * float(n) / float(n - 2 * k + 2);
    float rad = sharp ? Rs * (h + hw) / max(h, 1e-3) : Rs;
    float mr = sharp ? (n > 2 ? 1.0 - (div - 2.0) / float(n - 2) : 1.0) : u_star_inner;
    float an = PI / float(n), en = PI / mix(2.0, float(n), clamp(1.0 - mr, 0.0, 1.0));
    float eS = sdStar(qs, rad, n, mr);
    float ds = eS, nrm = hw;
    if (lines) {
      float dl = 1e9;
      if (sharp) {
        for (int i = 0; i < min(n, 32); i++) {
          float a = (float(i) + 0.5 * float(k)) * s;
          dl = min(dl, abs(dot(qs, vec2(sin(a), cos(a))) - h));
        }
        ds = max(dl - hw, eS);
      } else {
        for (int i = 0; i < min(n, 32); i++) {
          float a0 = float(i) * s, a1 = float(i + k) * s;
          dl = min(dl, sdSegment(qs, Rs * vec2(sin(a0), cos(a0)), Rs * vec2(sin(a1), cos(a1))));
        }
        ds = dl - hw;
      }
    } else if (u_star_mode == 1) {
      ds = abs(eS + 0.5 * w) - 0.5 * w;   // (not sdOnion: at Line width 0 the outline is no line at all)
    } else {
      // Filled: ridged, peaking at the centre — the depth there is the inradius (sdStar's distance at the centre,
      // worked out the way sdStar does).
      vec2 acs = vec2(cos(an), sin(an)), ecs = vec2(cos(en), sin(en));
      nrm = length(ecs * clamp(Rs * dot(acs, ecs), 0.0, Rs * acs.y / ecs.y) - Rs * acs);
    }
    if (gMotStr) {
      // In the star's own frame (turned by its offset). The outline (filled, outline, or clipping sharp lines) as its
      // segments tip – valley – tip, signed as sdStar (valleys are concave: pieces, not half-planes); the outline's
      // inner edge the same moved in by the line width, with arcs round the valleys; sharp lines as bands across
      // their own normals, round-ended ones round their chords.
      vec2 fx = rotCW(vec2(1.0, 0.0), u_star_off * 360.0 / float(n));
      mat2 F0 = gMotF;
      gMotF = F0 * mat2(fx, vec2(-fx.y, fx.x));
      mat2 M = bevelFrame(gMotF[0], gMotF[1]);
      vec2 ps = M * qs;
      float ri = rad * sin(en - an) / sin(en);
      float dO = 1e18, dH = 1e18, dL = 1e9;
      for (int i = 0; i < min(n, 32); i++) {
        float t0 = float(i) * s, t1 = t0 + s, tv = t0 + 0.5 * s;
        vec2 u0 = vec2(sin(t0), cos(t0)), u1 = vec2(sin(t1), cos(t1));
        vec2 T0 = rad * u0, T1 = rad * u1, V = ri * vec2(sin(tv), cos(tv));
        if (lines) {
          float a = (float(i) + 0.5 * float(k)) * s;
          vec2 nv = vec2(sin(a), cos(a));
          dL = min(dL, sharp ? mot_bl(abs(dot(qs, nv) - h) - hw, nv) : mot_segS(qs, Rs * u0, Rs * vec2(sin(float(i + k) * s), cos(float(i + k) * s)), hw));
        }
        if (!lines || sharp) dO = min(dO, min(bevelSeg2(ps, M * T0, M * V), bevelSeg2(ps, M * V, M * T1)));
        if (u_star_mode == 1) {
          // Inward normals of the edges either side of the valley, and the tips moved in along their axes.
          vec2 n0 = normalize(vec2(T0.y - V.y, V.x - T0.x)), n1 = normalize(vec2(V.y - T1.y, T1.x - V.x));
          n0 *= dot(n0, T0) > 0.0 ? -1.0 : 1.0;
          n1 *= dot(n1, T1) > 0.0 ? -1.0 : 1.0;
          vec2 I0 = T0 + u0 * w / min(dot(u0, n0), -1e-3), I1 = T1 + u1 * w / min(dot(u1, n1), -1e-3);
          dH = min(dH, min(bevelSeg2(ps, M * I0, M * (V + w * n0)), bevelSeg2(ps, M * (V + w * n1), M * I1)));
          dH = min(dH, bevelArc2(ps, M, V, w, n0, n1, normalize(n0 + n1 + vec2(1e-6))));
        }
      }
      float sO = eS < 0.0 ? -sqrt(dO) : sqrt(dO);
      ds = u_star_mode == 0 ? sO : u_star_mode == 1 ? max(sO, eS + w < 0.0 ? sqrt(dH) : -sqrt(dH)) : sharp ? max(dL, sO) : dL;
      gMotF = F0;
    }
    E_D[3] = ds; E_N[3] = nrm; E_K[3] = u_star_mode == 0 ? 3 : 2;
  }
  // Petals and beads may reach into the neighbouring sectors (overlapping rings / long petals): evaluate the
  // copies on either side too.
  if (u_petals > 0) {
    vec2 l0 = mot_polarFold(q, qa, u_petals, u_petal_off);
    float s = TAU / float(u_petals);
    float a = 0.5 * u_petal_len * R, b = 0.5 * u_petal_w * R;
    float dp = 1e9;
    for (int j = -UNI_1; j <= UNI_1; j++) {
      vec2 l = rot2(float(j) * s) * l0 - vec2(0.0, u_petal_pos * R);
      float e = u_petal_shape == 0 ? sdVesica(l, a, b) : sdEllipse(l, vec2(b, a));
      // Outlines: each petal's own band (inside its outline), so overlapping petals cross rather than merge.
      dp = min(dp, sdOnion(e, u_petal_line));
    }
    if (gMotStr) {
      // Each petal in its own frame (x across, y along): a vesica as the two discs it is the overlap of (an outline:
      // less the overlap of the discs shrunk by its width), each across its radius — side by side, or (wider than
      // long: sdVesica turns it) one above the other; an ellipse exactly, or (outlines) across its gradient.
      int k0 = int(floor(qa / s - u_petal_off + 0.5));
      float w = u_petal_line, bb = max(min(a, b), 1e-3), aa = max(max(a, b), bb), rv = 0.5 * (aa * aa / bb + bb);
      vec2 dd = (b > a ? vec2(0.0, 1.0) : vec2(1.0, 0.0)) * (rv - bb);
      dp = 1e9;
      for (int j = -UNI_1; j <= UNI_1; j++) {
        float th = (float(k0 + j) + u_petal_off) * s;
        vec2 u = vec2(sin(th), cos(th)), v = vec2(u.y, -u.x);
        vec2 l = vec2(dot(q, v), dot(q, u) - u_petal_pos * R);
        float e;
        if (u_petal_shape == 0) {
          vec2 v1 = l + dd, v2 = l - dd;
          vec2 n1 = v1.x * v + v1.y * u, n2 = v2.x * v + v2.y * u;
          float e1 = length(v1) - rv, e2 = length(v2) - rv;
          e = max(mot_bl(e1, n1), mot_bl(e2, n2));
          if (w > 0.0) e = max(e, -max(mot_bl(e1 + w, n1), mot_bl(e2 + w, n2)));
        } else if (w > 0.0) {
          vec2 g = l / vec2(b * b, a * a);
          e = mot_bl(sdOnion(sdEllipse(l, vec2(b, a)), w), g.x * v + g.y * u);
        } else {
          e = bevelEllipseS(l, bevelFrame(gMotF * v, gMotF * u), vec2(b, a));
        }
        dp = min(dp, e);
      }
    }
    // Solid petals: ridged along their length (the depth at full height is the half width, at the middle).
    E_D[4] = dp; E_N[4] = u_petal_line > 0.0 ? 0.5 * u_petal_line : min(a, b); E_K[4] = u_petal_line > 0.0 ? 2 : 3;
  }
  if (u_dots > 0) {
    vec2 l = mot_polarFold(q, qa, u_dots, u_dot_off);
    float s = TAU / float(u_dots);
    float pr = u_dot_pos * R;
    // The beads a bead can overlap, either side — at most 4 (larger beads lose their overlaps past the fourth).
    int reach = min(int(ceil((u_dot_r + 1.0) / max(pr * s, 1e-3))), 4);
    float db = 1e9;
    for (int j = -reach; j <= reach; j++) {
      float a = float(j) * s;
      db = min(db, sdOnion(length(l - pr * vec2(sin(a), cos(a))) - u_dot_r, u_dot_w));
    }
    if (gMotStr) {
      // Rings across their radius; solid beads exactly, the nearest one.
      int k0 = int(floor(qa / s - u_dot_off + 0.5));
      float nr = 1e9;
      vec2 nc = vec2(0.0);
      db = 1e9;
      for (int j = -reach; j <= reach; j++) {
        float th = (float(k0 + j) + u_dot_off) * s;
        vec2 c = pr * vec2(sin(th), cos(th)), v = q - c;
        float e = length(v) - u_dot_r;
        if (u_dot_w > 0.0) db = min(db, mot_bl(sdOnion(e, u_dot_w), v));
        if (e < nr) { nr = e; nc = c; }
      }
      if (u_dot_w <= 0.0) db = mot_discS(q - nc, u_dot_r);
    }
    // Domed rivets (or domed ring lines).
    E_D[5] = db; E_N[5] = u_dot_w > 0.0 ? 0.5 * u_dot_w : u_dot_r; E_K[5] = 2;
  }
  float H[6] = float[6](u_hub_h, u_ring_h, u_spoke_h, u_star_h, u_petal_h, u_dot_h);
  float d = 1e9, hv = 0.0, near = 1e9, nh = 0.0, nn = 1.0;
  bool nr = false;
  // A last pass (i = 6) gives the fillets their height: as high as the union is deep there, at the nearest
  // element's height and section.
  for (int i = 0; i < 7 * UNI_1; i++) {
    bool last = i == 6;
    int j = min(i, 5);
    float de = last ? d : E_D[j];
    if (!last && (E_K[j] & 2) != 0 && clipR > 0.0) de = max(de, clipD);
    float nrm = last ? nn : E_N[j], hgt = last ? nh : H[j];
    bool ridge = last ? nr : (E_K[j] & 1) != 0;
    float x = clamp(-de / max(nrm, 1e-3), 0.0, 1.0);
    if (last && u_blend <= 0.0) x = 0.0;
    hv = max(hv, hgt * (ridge ? x : sqrt(x * (2.0 - x))));
    if (last) break;
    if (de < near) { near = de; nh = hgt; nn = nrm; nr = ridge; }
    float k = max(u_blend, 1e-6), hb = max(k - abs(d - de), 0.0) / k;
    d = min(d, de) - (u_blend > 0.0 ? hb * hb * k * 0.25 : 0.0);
  }
  gMotH = hv;
  return d;
}

GenOut motifOut(float d, float rnd, vec2 nearQ, float h) {
  if (u_output == 1) {
    float g = d <= 0.0 ? 1.0 : 1.0 - clamp(d / max(u_glow, 1e-3), 0.0, 1.0);
    return genOut(g * g, 1.0, rnd, NO_SDF);
  }
  if (u_output == 2) return genOut(1.0 - clamp(length(nearQ) / max(u_radius, 1e-3), 0.0, 1.0), 1.0, rnd, NO_SDF);
  GenOut o = genOut(0.0, 1.0, rnd, d);
  // Sculpted: Height › Pattern takes the elements' own sections. Combined with its mask (Union, Subtract…)
  // the drawn shape isn't the rosette's alone, so the Edge bevel stays.
  if (u_relief == 1 && maskOp() <= 1) o.hval = h;
  return o;
}
// Glow softness: the glow averaged over a Vogel disc of taps (a blur), one copy of the repeat in the loop.
#define MOT_TAPS (u_output == 1 && u_glow_soft > 0.0 ? 16 : 1)
#define MOT_BLUR (0.5 * u_glow_soft * u_glow)
// The shape needs the exact distance everywhere (its mask), the glow out to its width, radial none at all.
#define MOT_EXACT (u_output == 1 ? u_glow : u_output == 2 ? -1e9 : 1e9)
// Bevel aspect applies to the shape only.
#define MOT_STRETCH (u_output == 0)
` +
		MOT_REPEAT
});

// ------------------------------------------------------------------------------------------------ glyph

/** Glyph's linked bevel: half the stroke width (domed strokes), or an eighth of a block cell (at least 1 px). */
export function glyphBevel(p: Record<string, unknown>): number {
	const n = (k: string, d: number) => Number(p[k] ?? d);
	if (p.style === 'blocks') return r1(Math.min(32, Math.max(1, (0.12 * n('size', 32)) / Math.max(2, n('rows', 5)))));
	return r1(Math.min(64, Math.max(0.5, 0.5 * n('width', 2))));
}

export const glyphLayer: LayerDef = withRepeat({
	type: 'glyph',
	label: 'Glyph / Sigil',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Glyph / Sigil: Random strokes or blocks on a small grid, mirrored left–right and / or top–bottom. Makes emblems, runes, sigils, and (repeated) rune borders and alien text.',
	params: [
		P.enum('style', 'Style', 'strokes', [
			['strokes', 'Strokes (runes, sigils)'],
			['blocks', 'Blocks (pixel insignia)']
		]),
		P.int('cols', 'Grid columns', 5, 2, 9, {
			hint: 'How many nodes (strokes) or cells (blocks) go across; odd counts give a centre column'
		}),
		P.int('rows', 'Grid rows', 5, 2, 9),
		P.float('size', 'Size', 32, 1, 4096, {
			softMax: 512,
			unit: 'px',
			step: 0.1,
			hint: 'Sets the glyph’s height (the node span for strokes, the cell span for blocks)'
		}),
		P.float('jitter', 'Node jitter', 0, 0, 1, {
			step: 0.001,
			showIf: isStrokes,
			hint: 'Moves each node randomly off the grid, up to half a node spacing at 1. Strokes that share a node still meet there'
		}),
		P.float('width', 'Stroke width', 2, 0, 256, {
			softMax: 48,
			unit: 'px',
			step: 0.1,
			showIf: isStrokes
		}),
		P.float('width_var', 'Width variation', 0, 0, 1, {
			step: 0.001,
			showIf: isStrokes,
			hint: 'Gives each stroke a random width, for bold main strokes and fine secondary ones (0 = all the same, 1 = anywhere from a tenth to full)'
		}),
		P.float('pen', 'Calligraphy', 0, 0, 1, {
			step: 0.001,
			showIf: isStrokes,
			hint: 'Draws like a broad-nib pen: strokes along the nib thin out, strokes across it stay full width (1 = hairlines along the nib)'
		}),
		P.float('pen_angle', 'Nib angle', 30, -180, 180, {
			softMin: -90,
			softMax: 90,
			unit: '°',
			step: 0.1,
			showIf: (p) => isStrokes(p) && (Number(p.pen) > 0 || p.cap === 'pen'),
			hint: 'Turns the pen’s thin stroke, anticlockwise from horizontal (it stays the same on both sides of a mirror, as a real pen would draw it)'
		}),
		P.float('taper', 'Taper', 0, 0, 1, {
			step: 0.001,
			showIf: isStrokes,
			hint: 'Thins each stroke towards its ends, keeping full width in the middle (0 = even, 1 = pointed tips)'
		}),
		P.enum(
			'cap',
			'Ends',
			'round',
			[
				['round', 'Round', 'round caps (pen, wire)'],
				['square', 'Square', 'cut square half a width past the end node (chiselled runes)'],
				['flat', 'Flat', 'cut square at the end node'],
				[
					'pen',
					'Pen',
					'cuts every stroke along the nib at its ends and joints, like a broad pen would (with Calligraphy)'
				]
			],
			{
				showIf: isStrokes,
				hint: 'Shapes the free stroke ends. Ends where strokes meet (or meet their mirror image) follow Joins'
			}
		),
		P.enum(
			'join',
			'Joins',
			'round',
			[
				['round', 'Round', 'round corners where segments meet'],
				[
					'mitre',
					'Mitre',
					'sharp corners: within a stroke and where a stroke meets its mirror image on the axis (turns sharper than about 133° stay round)'
				]
			],
			{
				showIf: (p) => isStrokes(p) && p.line !== 'spline' && p.cap !== 'pen',
				hint: 'Shapes the corners where segments meet at a node'
			}
		),
		P.int('strokes', 'Strokes', 4, 1, 8, {
			showIf: isStrokes,
			hint: 'How many random strokes make up each glyph'
		}),
		P.int('steps', 'Steps', 3, 1, 8, {
			showIf: isStrokes,
			hint: 'How many segments each stroke has'
		}),
		P.float('diag', 'Diagonals', 0.4, 0, 1, {
			step: 0.001,
			showIf: isStrokes,
			hint: 'Makes more of the turns go diagonal (0 = none at all: a boxed-in stroke stops rather than step diagonally)'
		}),
		P.float('straight', 'Straightness', 0.35, 0, 1, {
			step: 0.001,
			showIf: isStrokes,
			hint: 'Makes the strokes keep going straight more often instead of turning'
		}),
		P.float('overlap', 'Overlaps', 0.3, 0, 1, {
			step: 0.001,
			showIf: isStrokes,
			hint: 'Lets more steps land on a node that’s already drawn (by any stroke, or a mirror image). At 0 strokes never run back into the glyph, and stop early when boxed in. Splines never run back along a drawn line or turn back sharply'
		}),
		P.float('connect', 'Connected', 0.85, 0, 1, {
			step: 0.001,
			showIf: isStrokes,
			hint: 'Starts more strokes on a node that’s already drawn, so the glyph hangs together instead of falling apart into separate marks (1 = one connected figure). Above 0 the first stroke starts at the centre node, which joins the halves with Mirror X and an odd column count'
		}),
		P.enum(
			'line',
			'Lines',
			'straight',
			[
				['straight', 'Straight (and arcs)'],
				['spline', 'Splines (hand-drawn)']
			],
			{
				showIf: isStrokes,
				hint: 'Picks straight segments, or Splines, which draw each stroke as one smooth curve through its nodes'
			}
		),
		P.float('curve', 'Curves', 0, 0, 1, {
			step: 0.001,
			showIf: (p) => isStrokes(p) && p.line !== 'spline',
			hint: 'Bows more of the segments into arcs (0 = all straight)'
		}),
		P.float('roundness', 'Roundness', 1, 0, 2, {
			step: 0.001,
			showIf: (p) => isStrokes(p) && p.line === 'spline',
			hint: 'How far the splines swing through the nodes (0 = straight, 1 = natural, 2 = loopy)'
		}),
		P.float('dots', 'End dots', 0, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			showIf: isStrokes,
			hint: 'Puts a dot of this radius at each stroke end (0 = none)'
		}),
		P.float('dot_chance', 'Dot chance', 1, 0, 1, {
			step: 0.001,
			showIf: (p) => isStrokes(p) && Number(p.dots) > 0,
			hint: 'Gives only some stroke ends a dot or ring, leaving the rest plain (1 = all of them)'
		}),
		P.bool('dot_joins', 'Dots at joins', false, {
			showIf: (p) => isStrokes(p) && Number(p.dots) > 0,
			hint: 'Also puts dots on stroke ends that meet another stroke (or their mirror image). Off: only free ends get them'
		}),
		P.bool('dot_ring', 'Ring dots', false, {
			showIf: (p) => isStrokes(p) && Number(p.dots) > 0,
			hint: 'Draws the end dots as open rings that the strokes stop at, sigil style. The ring line is the stroke width, thinned to half the radius on small dots'
		}),
		P.float('density', 'Fill', 0.5, 0, 1, {
			step: 0.001,
			showIf: (p) => p.style === 'blocks',
			hint: 'Fills more of the cells (0 = none, 1 = all)'
		}),
		P.float('gap', 'Gap', 0, 0, 256, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			showIf: (p) => p.style === 'blocks',
			hint: 'Adds space between the cells (0 = neighbouring cells merge into one shape; more = separate tiles, like a mosaic or LED panel)'
		}),
		P.bool('mirror', 'Mirror X', true, { hint: 'Mirrors the glyph left–right' }),
		P.bool('mirror_y', 'Mirror Y', false, { hint: 'Mirrors the glyph top–bottom' }),
		P.bool('centre', 'Centre glyph', true, {
			hint: 'Centres the drawn glyph on its origin (placement point and rotation pivot) instead of the full node grid'
		}),
		P.bool('vary', 'Vary per instance', true, {
			hint: 'Gives each repeat a different glyph, like rune text. Off: repeats one emblem'
		}),
		P.bool('snap', 'Pixel snap', true, { hint: 'Puts nodes on the pixel grid so 1–2 px strokes stay crisp' }),
		...PLACEMENT,
		...REPEAT
	],
	groups: [REPEAT_GROUP],
	defaults: MOTIF_DEFAULTS,
	// The bevel follows the strokes (half their width: a round, domed section) or the blocks' cells.
	// The pen's strokes end as the pen leaves them.
	linkedDefaults: (p) => ({ bevel: glyphBevel(p), cap: Number(p.pen) > 0 ? 'pen' : 'round' }),
	// Added in the editor: one emblem across about half the texture, its strokes in proportion.
	fresh: ({ width, height }) => {
		const size = r1(Math.max(8, 0.45 * Math.min(width, height)));
		return { size, width: Math.max(1, Math.round(size / 18)) };
	},
	glsl:
		GLSL_MOT_INST +
		/* glsl */ `
const ivec2 MOT_DIRS[8] = ivec2[8](ivec2(1, 0), ivec2(1, 1), ivec2(0, 1), ivec2(-1, 1),
                                    ivec2(-1, 0), ivec2(-1, -1), ivec2(0, -1), ivec2(1, -1));

ivec2 mot_grid() { return ivec2(clamp(u_cols, 2, 9), clamp(u_rows, 2, 9)); }
// Node spacing (strokes) or cell size (blocks), whole px when snapping.
float mot_spacing() {
  ivec2 g = mot_grid();
  float sp = u_style == 0 ? u_size / float(g.y - 1) : u_size / float(g.y);
  return u_snap ? max(1.0, floor(sp + 0.5)) : sp;
}
float motifBound() {
  ivec2 g = mot_grid();
  float sp = mot_spacing();
  // Splines swing out from the nodes by at most a quarter of their tangent (≤ 0.36 · roundness · spacing).
  // Jitter moves a node up to half the jitter · spacing per axis.
  float swing = u_style == 0 && u_line == 1 ? 0.36 * u_roundness * (1.0 + u_jitter) * sp : 0.0;
  float jit = u_style == 0 ? 0.71 * u_jitter * sp : 0.0;
  return 0.5 * length(vec2(g)) * sp + swing + jit + u_width + 2.0 * u_dots + 1.0;
}
// Strokes: nodes on pixel centres for odd widths, on pixel corners for even ones (and for blocks).
vec2 motifSnap(vec2 c) {
  if (!u_snap) return c;
  ivec2 g = mot_grid();
  float sp = mot_spacing();
  // Offset of node 0 from the centre must be whole px: half-odd spans shift the centre by half a pixel.
  vec2 span = u_style == 0 ? vec2(g - 1) * sp : vec2(g) * sp;
  vec2 half_ = 0.5 * span - floor(0.5 * span);       // 0 or 0.5 per axis
  bool odd = u_style == 0 && mod(floor(u_width + 0.5), 2.0) == 1.0;
  vec2 base = floor(c + 0.5) + half_;
  if (odd) base = floor(c) + 0.5 + half_;
  return base;
}
vec2 mot_node(ivec2 n, ivec2 g, float sp) {
  return vec2(float(n.x) - 0.5 * float(g.x - 1), 0.5 * float(g.y - 1) - float(n.y)) * sp;
}
// Offset (px) from the grid centre to the centre of the drawn nodes / cells lo..hi (whole px when snapping).
vec2 mot_centreOff(ivec2 lo, ivec2 hi, ivec2 g, float sp) {
  vec2 o = vec2(0.5 * float(lo.x + hi.x - g.x + 1), 0.5 * float(g.y - 1 - lo.y - hi.y)) * sp;
  // A mirror image makes the drawing symmetric about that axis already.
  if (u_mirror) o.x = 0.0;
  if (u_mirror_y) o.y = 0.0;
  return u_snap ? floor(o + 0.5) : o;
}
bool mot_cellOn(int i, int j, ivec2 g, int gid) {
  int mi = u_mirror ? min(i, g.x - 1 - i) : i;
  int mj = u_mirror_y ? min(j, g.y - 1 - j) : j;
  return hashI(ivec2(mi + 16 * mj, gid), uSeed + 211.0) < u_density;
}
// Visited nodes for the overlap test: one bit per node (x + 9y < 81) over three words. Mirroring folds the node
// onto the top-left (x onto the left half, y onto the top half), so a node a mirror image has drawn counts as
// visited too.
int mot_nodeKey(ivec2 n, ivec2 g) {
  return (u_mirror ? min(n.x, g.x - 1 - n.x) : n.x) + 9 * (u_mirror_y ? min(n.y, g.y - 1 - n.y) : n.y);
}
// Node position with its jitter (one random offset per node and glyph, so strokes sharing a node still meet).
// Mirroring keys the offset by the folded node and mirrors it on the right / bottom half (zero across the axis on
// an axis node), so the mirror images land on the same moved nodes.
vec2 mot_pt(ivec2 n, ivec2 g, float sp, int gid) {
  vec2 p = mot_node(n, g, sp);
  if (u_jitter <= 0.0) return p;
  vec2 j = (hash2I(ivec2(mot_nodeKey(n, g), gid), uSeed + 503.0) - 0.5) * u_jitter * sp;
  if (u_snap) j = floor(j + 0.5);
  if (u_mirror) j.x *= float(sign(g.x - 1 - 2 * n.x));
  if (u_mirror_y) j.y *= float(sign(g.y - 1 - 2 * n.y));
  return p + j;
}
uvec3 mot_bit(int i) { return uvec3(equal(ivec3(i >> 5), ivec3(0, 1, 2))) << uint(i & 31); }
// Signed distance to segment k (of n) of a stroke, b → c, and to its mirror images when mirroring. Straight
// lines: one quadratic Bézier bowed sideways by 'bow' (a straight segment when 0). Splines: the Catmull-Rom curve
// through the nodes (tangents from the nodes a before and e after, scaled by roundness) as two quadratic Béziers
// that meet halfway with matching tangents. The half width tapers along the whole stroke (4u(1 − u), u = 0..1),
// times the stroke's own share wf (Width variation) and the broad-nib factor (Calligraphy; nib: the pen's thin
// direction). One Bézier call in one loop, so the shader holds a single copy of it.
float mot_segD(vec2 q, vec2 a, vec2 b, vec2 c, vec2 e, float bow, float k, float n, float wf, int caps, vec2 nib) {
  bool spline = u_line == 1;
  vec2 c0 = spline ? b + 0.125 * u_roundness * (c - a) : 0.5 * (b + c) + vec2(b.y - c.y, c.x - b.x) * bow;
  vec2 c1 = c - 0.125 * u_roundness * (e - b);
  vec2 m = spline ? 0.5 * (c0 + c1) : c;
  int pieces = spline ? 2 : 1;
  int copies = (u_mirror ? 2 : 1) * (u_mirror_y ? 2 : 1);
  float d = 1e9;
  for (int i = 0; i < pieces * copies; i++) {
    bool second = spline && (i & 1) == 1;
    int mi = i / pieces;                       // which image: bit 0 flips x (when mirroring x), then y
    vec2 fl = vec2(u_mirror && (mi & 1) == 1 ? -1.0 : 1.0, u_mirror_y && (u_mirror ? mi >= 2 : mi == 1) ? -1.0 : 1.0);
    vec2 qm = q * fl;
    // The pen is the same on both sides of a mirror: in this image's (mirrored) frame its nib is mirrored.
    vec2 nibM = nib * fl;
    vec2 A = second ? m : b, B = second ? c1 : c0, C = second ? c : m;
    // Nearly straight pieces: a plain segment (the Bézier solve loses precision as the curve flattens).
    vec2 ac = C - A, ab = B - A;
    if (abs(ac.x * ab.y - ac.y * ab.x) < 0.01 * length(ac)) B = 0.5 * (A + C);
    vec2 dt = sdBezierT(qm, A, B, C);
    float u = (k + (spline ? 0.5 * (float(second) + dt.y) : dt.y)) / max(n, 1.0);
    // Broad nib: the width follows |sin| of the angle between the curve's tangent there and the nib.
    vec2 tg = mix(B - A, C - B, dt.y);
    float pf = mix(1.0, max(abs(tg.x * nibM.y - tg.y * nibM.x) / max(length(tg), 1e-6), 0.08), u_pen);
    float hw = 0.5 * u_width * wf * pf * mix(1.0, 4.0 * u * (1.0 - u), u_taper);
    float de = dt.x - hw;
    // Bevel aspect: the band in the stretched space (mot_bandS: across the direction from its nearest point, past an
    // end no deeper than its sides), the cuts below across their own normals — directions back to q's frame through
    // this image's flips.
    float deS = 0.0;
    if (gMotStr) {
      vec2 vn = qm - (A + 2.0 * dt.y * (B - A) + dt.y * dt.y * (A - 2.0 * B + C));
      vec2 nl = vec2(-tg.y, tg.x) / max(length(tg), 1e-6);
      deS = mot_bandS(length(vn), vn * fl, abs(dot(vn, nl)), nl * fl, hw);
    }
    // Ends and joints, past a piece's end (t clamped there, with a little slack: the solve may stop just short of
    // 1) — caps bits 4 / 8: this is the stroke's first / last segment. Pen: a free stroke end (bits 1, 2) is cut
    // along the nib (into the stroke, past the node the band runs on straight up to the cut, so the end is the
    // nib's slanted edge; near-parallel strokes — hairlines — turn the cut square). Ends on another stroke and
    // joints within a stroke stay round: a cut there runs through the stroke it joins and leaves a crease in the
    // bevel (and pieces of unequal width would leave spurs).
    // Otherwise a free stroke end (bits 1, 2) takes the Ends rule — a box end half a width long (square) or none
    // (flat) —; with mitre joins, a joint within a stroke fills the corner where its band and the next one's cross,
    // and an end on a mirror axis (bits 16, 32 X, 64, 128 Y) the corner with its mirror image there.
    bool pen = u_cap == 3;
    bool atA = dt.y <= 1e-4 && !second, atC = dt.y >= 1.0 - 1e-4 && (second || !spline);
    bool endA = pen && (caps & 1) != 0 && !second && dt.y < 0.5, endC = pen && (caps & 2) != 0 && (second || !spline) && dt.y >= 0.5;
    bool sA = endA || atA;
    vec2 P = sA ? A : C;
    vec2 o = P - (dot2(B - P) > 1e-6 ? B : (sA ? C : A));
    o /= max(length(o), 1e-6);
    vec2 r = qm - P;
    float along = dot(r, o), lat = length(r - along * o);
    // w2: the way the band this end meets leaves P — the next / previous segment, or the mirror image on an axis.
    vec2 w2 = (caps & (sA ? 4 : 8)) == 0 && !spline ? normalize(sA ? a - b : e - c)
            : (caps & (sA ? 16 : 32)) != 0 ? vec2(o.x, -o.y) : (caps & (sA ? 64 : 128)) != 0 ? vec2(-o.x, o.y) : vec2(0.0);
    float cw = dot(o, w2), sw = abs(o.x * w2.y - o.y * w2.x);
    bool doPen = endA || endC;
    bool doCap = !pen && u_cap > 0 && (caps & (sA ? 1 : 2)) != 0 && (atA || atC);
    // Mitre: the corner both bands cover (their crossing, past this end, reaching hw · tan(turn / 2) along this
    // band) — exactly the mitre, and its distance stays a proper inside distance (cutting each band at the
    // bisector would leave a crack along it). Turns sharper than about 133° (cw ≤ −0.68) stay round (the crossing
    // would run out into a spike), as do straight continuations (nothing to fill).
    bool doMit = !pen && !doCap && u_join == 1 && (atA || atC) && dot(w2, w2) > 0.5 && cw > -0.68;
    if (doPen || doCap || doMit) {
      vec2 pn = vec2(-nibM.y, nibM.x);
      float cs = dot(pn, o);
      vec2 nX = doPen ? normalize(mix(o, cs < 0.0 ? -pn : pn, smoothstep(0.1, 0.35, abs(cs)))) : o;
      float eX = doCap ? (u_cap == 1 ? hw : 0.0) : doMit ? hw * sw / (1.0 + cw) : 0.0;
      float latN = doMit ? abs(r.x * w2.y - r.y * w2.x) - hw : -1e9;
      de = max(max(atA || atC ? lat - hw : de, latN), dot(r, nX) - eX);
      if (gMotStr)
        deS = max(max(atA || atC ? mot_bl(lat - hw, vec2(-o.y, o.x) * fl) : deS, doMit ? mot_bl(latN, vec2(-w2.y, w2.x) * fl) : -1e9),
                  mot_bl(dot(r, nX) - eX, nX * fl));
    }
    d = min(d, gMotStr ? deS : de);
  }
  return d;
}

float motifSdf(vec2 q, float inst) {
  ivec2 g = mot_grid();
  float sp = mot_spacing();
  int gid = u_vary ? int(inst * 65535.0) : 0;
  // Loop bounds below depend on uniforms (UNI_1), so D3D compiles each loop body once instead of unrolling it.
  if (u_style == 1) {
    // Blocks: exact distance to the union of filled cells (inside: distance to the nearest empty cell or the
    // grid's outside). One flat loop over the cells, twice when centring: first for the filled cells' bounds.
    int cells = g.x * g.y;
    ivec2 lo = g, hi = ivec2(-1), ci = ivec2(0);
    vec2 hs = vec2(max(0.5 * (sp - u_gap), 0.0));   // with a gap the tiles are apart: the nearest one is exact
    vec2 gh = 0.5 * vec2(g) * sp;
    bool inside = false;
    float dFill = 1e9, dEmpty = 0.0;
    // Bevel aspect: the blocks are boxes in the instance's frame — a filled one as its four sides' half-planes, an
    // empty one exactly from outside (a parallelogram, stretched), the grid's edge as its half-planes.
    mat2 M = bevelFrame(gMotF[0], gMotF[1]);
    for (int e = u_centre ? 0 : cells; e < 2 * cells; e++) {
      int c = e < cells ? e : e - cells;
      int i = c % g.x, j = c / g.x;
      bool on = mot_cellOn(i, j, g, gid);
      if (e < cells) {
        if (on) { lo = min(lo, ivec2(i, j)); hi = max(hi, ivec2(i, j)); }
      } else {
        if (c == 0) {
          if (u_centre && hi.x >= 0) q += mot_centreOff(lo, hi, g, sp);
          vec2 cq = (q + gh) / sp;
          ci = ivec2(floor(vec2(cq.x, 2.0 * gh.y / sp - cq.y)));
          dEmpty = max(-sdBox(q, gh), 0.0);
          if (gMotStr) dEmpty = max(-max(mot_bl(abs(q.x) - gh.x, vec2(1.0, 0.0)), mot_bl(abs(q.y) - gh.y, vec2(0.0, 1.0))), 0.0);
        }
        vec2 cc = vec2((float(i) + 0.5) * sp - gh.x, gh.y - (float(j) + 0.5) * sp);
        vec2 v = q - cc;
        float db = sdBox(v, hs);
        if (gMotStr) {
          if (on) db = max(mot_bl(abs(v.x) - hs.x, vec2(1.0, 0.0)), mot_bl(abs(v.y) - hs.y, vec2(0.0, 1.0)));
          else {
            vec2 X = M * vec2(hs.x, 0.0), Y = M * vec2(0.0, hs.y), pv = M * v;
            db = sqrt(min(min(bevelSeg2(pv, X + Y, X - Y), bevelSeg2(pv, -X + Y, -X - Y)),
                          min(bevelSeg2(pv, X + Y, -X + Y), bevelSeg2(pv, X - Y, -X - Y))));
          }
        }
        if (on) { dFill = min(dFill, db); if (ci == ivec2(i, j)) inside = true; }
        else dEmpty = min(dEmpty, max(db, 0.0));
      }
    }
    return inside && u_gap <= 0.0 ? -dEmpty : dFill;
  }
  // Strokes: random walks over the node grid; each step keeps going straight or turns (diagonals by chance),
  // never reverses, turns away from the grid edge and, unless an overlap is allowed, away from drawn nodes.
  // Splines also never turn back sharply (135°) or step from one drawn node to another (running back along a
  // drawn line): a curve can't retrace a line, so doubling back draws loops and lenses.
  // One flat loop walks all the strokes node by node. Each iteration arrives at a node (or, after a stroke's
  // last node, at a reflected point past its end) and draws the segment before the previous node, now that the
  // nodes on both sides of it are known (spline tangents need them). Centring, tapering, square / flat / pen ends
  // and dots only on free ends walk everything twice: the first pass only finds the bounds of the drawn nodes,
  // each stroke's length and the nodes arrived at more than once (joints, where an end stays round).
  float d = 1e9, dd = 1e9, dh = 1e9;
  float rw = min(u_width, 0.5 * u_dots);       // ring line: the stroke width, but leave a hole on small dots
  float nearDot = 1e9;                         // Bevel aspect: the nearest solid dot (its centre), measured once
  vec2 nearC = vec2(0.0);
  bool spline = u_line == 1;
  int strokes = clamp(u_strokes, 1, 8), steps = clamp(u_steps, 1, 8);
  bool draw = !u_centre && u_taper <= 0.0 && u_cap == 0 && (u_dots <= 0.0 || u_dot_joins);
  uint lens = 0u;                              // segments per stroke, 4 bits each (first pass)
  uvec3 seen = uvec3(0u), multi = uvec3(0u);   // multi: nodes arrived at more than once (first pass)
  ivec2 lo = g, hi = ivec2(-1);
  int w = 0, s = -1, dir = 0;                  // s: index of the node arrived at (-1: start the next stroke)
  bool ending = false, old = false;
  ivec2 pos = ivec2(0), nB = ivec2(0), nC = ivec2(0);
  vec2 pA = vec2(0.0), pB = vec2(0.0), pC = vec2(0.0), pStart = vec2(0.0);   // nodes s − 3, s − 2, s − 1
  float bowB = 0.0, bowC = 0.0;                // bows of the segments ending at nodes s − 1 and s
  bool fS = true, fE = true;                   // the stroke's first / last node free (dots, ends)
  bool mS = false, mE = false;                 // the stroke's first / latest node met more than once
  int cnt = 0;                                 // nodes stepped on from so far, and a random one of them (Connected)
  ivec2 pick = ivec2(0);
  vec2 nib = vec2(cos(radians(u_pen_angle)), sin(radians(u_pen_angle)));
  // Each pass: per stroke its nodes (at most steps + 1) and the iteration that ends it.
  for (int it = 0; it < 2 * strokes * (steps + 2); it++) {
    if (s < 0) {
      if (w >= strokes) {
        if (draw) break;
        if (u_centre) q += mot_centreOff(lo, hi, g, sp);
        draw = true;
        w = 0;
        seen = uvec3(0u);
        cnt = 0;
      }
      vec3 h0 = hash3I(ivec2(w * 16, gid), uSeed + 101.0);
      pos = min(ivec2(floor(h0.xy * vec2(g))), g - 1);
      // Connected: the first stroke starts at the centre node (on the mirror axes for odd counts), so the glyph
      // grows out from the middle; later ones on a drawn node.
      if (u_connect > 0.0) pos = w == 0 ? (g - 1) / 2 : fract(h0.x * 37.13 + h0.z * 11.31) < u_connect ? pick : pos;
      dir = int(h0.z * 8.0);
      s = 0;
      fS = true;
      fE = true;
    }
    vec2 pt = 2.0 * pC - pB;
    if (!ending) {
      // Arrive at pos. A node is old when drawn before (a node on a mirror axis always is: its mirror image
      // arrives with it).
      uvec3 pb = mot_bit(mot_nodeKey(pos, g));
      bool again = any(notEqual(seen & pb, uvec3(0u)));
      // Arrived at more than once over the whole glyph (known in the drawing pass): the start / latest node.
      bool mh = any(notEqual(multi & pb, uvec3(0u)));
      if (s == 0) mS = mh;
      mE = mh;
      old = again || (u_mirror && 2 * pos.x == g.x - 1) || (u_mirror_y && 2 * pos.y == g.y - 1);
      if (again && !draw) multi |= pb;
      seen |= pb;
      lo = min(lo, pos);
      hi = max(hi, pos);
      pt = mot_pt(pos, g, sp, gid);
      if (s == 0) { pStart = pt; pB = pt; pC = pt; }
    }
    // The segment from node s − 2 to s − 1; past either end of the stroke the missing neighbour is reflected. A
    // segment that is its own mirror image (along an axis, or across one between mirror nodes, or through the
    // centre when mirroring both ways) stays straight: as a curve it would split from its mirror into a lens.
    if (draw && s >= 2) {
      vec2 before = s > 2 ? pA : 2.0 * pB - pC, after = pt;
      ivec2 mB = g - 1 - nB, mC = g - 1 - nC;
      bvec2 along = bvec2(u_mirror && mB.x == nB.x && mC.x == nC.x, u_mirror_y && mB.y == nB.y && mC.y == nC.y);
      bool selfX = along.x || (u_mirror && ivec2(mB.x, nB.y) == nC);
      bool selfY = along.y || (u_mirror_y && ivec2(nB.x, mB.y) == nC);
      if (selfX || selfY || (u_mirror && u_mirror_y && mB == nC)) {
        before = 2.0 * pB - pC;
        after = 2.0 * pC - pB;
      }
      float wf = 1.0 - 0.9 * u_width_var * hashI(ivec2(w * 16 + 15, gid), uSeed + 601.0);
      // The ends' bits for mot_segD: first / last segment (4, 8); its first / last node free (1, 2) — no other
      // stroke meets it, nor the stroke itself, nor its mirror image: on a mirror axis it does, unless the segment
      // runs along the axis —, or else on an axis (16 / 32 on X, 64 / 128 on Y).
      bvec2 axS = bvec2(u_mirror && 2 * nB.x == g.x - 1 && !along.x, u_mirror_y && 2 * nB.y == g.y - 1 && !along.y);
      bvec2 axE = bvec2(u_mirror && 2 * nC.x == g.x - 1 && !along.x, u_mirror_y && 2 * nC.y == g.y - 1 && !along.y);
      if (s == 2) fS = !mS && !any(axS);
      if (ending) fE = !mE && !any(axE);
      int caps = (s == 2 ? 4 | (fS ? 1 : axS.x ? 16 : axS.y ? 64 : 0) : 0) | (ending ? 8 | (fE ? 2 : axE.x ? 32 : axE.y ? 128 : 0) : 0);
      d = min(d, mot_segD(q, before, pB, pC, after, bowB, float(s - 2), float((lens >> uint(4 * w)) & 15u), wf, caps, nib));
    }
    if (ending) {
      if (!draw) lens |= uint(s - 1) << uint(4 * w);
      if (draw && u_dots > 0.0) {
        for (int k = 0; k < 2 * UNI_1; k++) {
          // Dot chance: one draw per stroke end (its mirror images share it).
          bool on = (u_dot_joins || (k == 0 ? fS : fE)) &&
                    (u_dot_chance >= 1.0 || hashI(ivec2(w * 2 + k, gid), uSeed + 701.0) < u_dot_chance);
          if (on) {
            vec2 c = k == 0 ? pStart : pC;
            // Nearest of the dot and its mirror images: fold both onto the same side of each mirror axis.
            vec2 qf = q, cf = c;
            if (u_mirror) { qf.x = abs(qf.x); cf.x = abs(cf.x); }
            if (u_mirror_y) { qf.y = abs(qf.y); cf.y = abs(cf.y); }
            float l = length(qf - cf);
            if (gMotStr) {
              // The image nearest (the fold's), across its radius; solid dots exactly, after the walk.
              vec2 ci = vec2(u_mirror && q.x < 0.0 ? -cf.x : cf.x, u_mirror_y && q.y < 0.0 ? -cf.y : cf.y);
              vec2 v = q - (u_mirror || u_mirror_y ? ci : c);
              dd = min(dd, mot_bl(abs(l - u_dots + 0.5 * rw) - 0.5 * rw, v));
              dh = min(dh, mot_bl(l - u_dots + rw, v));
              if (l < nearDot) { nearDot = l; nearC = q - v; }
            } else {
              dd = min(dd, u_dot_ring ? abs(l - u_dots + 0.5 * rw) - 0.5 * rw : l - u_dots);
              dh = min(dh, l - u_dots + rw);
            }
          }
        }
      }
      ending = false;
      w++;
      s = -1;
    } else {
      // Choose the next node; a stroke ends after its last step, or when boxed in.
      bool moved = false;
      int nd = dir;
      float nbow = 0.0;
      if (s < steps) {
        int hid = w * 16 + s + 1;
        vec4 hs = vec4(hash3I(ivec2(hid, gid), uSeed + 101.0), hashI(ivec2(hid, gid), uSeed + 307.0));
        // Reservoir sample of the nodes a stroke steps on from: each replaces the pick with chance 1 / count.
        cnt++;
        if (fract(hs.x * 13.71 + hs.w * 3.17) * float(cnt) < 1.0) pick = pos;
        if (s == 0 || hs.x >= u_straight) {
          int k = int(hs.z * 4.0);
          nd = hs.y < u_diag ? 2 * k + 1 : 2 * k;
        }
        bool revisit = (u_overlap >= 1.0 || hashI(ivec2(hid, gid), uSeed + 409.0) < u_overlap) && !(spline && old);
        for (int t = 0; t < 8 * UNI_1; t++) {
          ivec2 np = pos + MOT_DIRS[nd];
          bool inGrid = all(greaterThanEqual(np, ivec2(0))) && all(lessThan(np, g));
          // Free: not drawn yet, or the step across an axis onto one of its own mirror nodes (even counts).
          ivec2 mp = g - 1 - pos;
          bool free_ = revisit || all(equal(seen & mot_bit(mot_nodeKey(np, g)), uvec3(0u))) ||
                       (u_mirror && np == ivec2(mp.x, pos.y)) || (u_mirror_y && np == ivec2(pos.x, mp.y)) ||
                       (u_mirror && u_mirror_y && np == mp);
          int turn = abs((nd - dir + 8) % 8 - 4);   // 0 = straight back, 1 = a 135° hairpin
          bool kind = u_diag > 0.0 || (nd & 1) == 0;  // Diagonals 0: no diagonal steps at all, not even when boxed in
          if (inGrid && free_ && kind && (s == 0 || turn > (spline ? 1 : 0))) { moved = true; break; }
          nd = (nd + 3) % 8;
        }
        nbow = hs.w < u_curve ? (fract(hs.w * 7.31) < 0.5 ? 0.35 : -0.35) : 0.0;
      }
      pA = pB; pB = pC; pC = pt;
      nB = nC; nC = pos;
      bowB = bowC; bowC = nbow;
      if (moved) { pos += MOT_DIRS[nd]; dir = nd; }
      else ending = true;
      s++;
    }
  }
  if (gMotStr && !u_dot_ring) dd = nearDot < 1e8 ? mot_discS(q - nearC, u_dots) : 1e9;
  // Ring dots are open: the strokes stop at the ring instead of running into its hole.
  if (u_dot_ring) d = max(d, -dh);
  return min(d, dd);
}

GenOut motifOut(float d, float rnd, vec2 nearQ, float h) { return genOut(0.0, 1.0, rnd, d); }
#define MOT_TAPS 1
#define MOT_BLUR 0.0
#define MOT_EXACT 1e9
#define MOT_STRETCH true
` +
		MOT_REPEAT
});
