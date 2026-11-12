// Stone blocks: a wall of dressed, rock-faced stones (docs/features/fr8.22-stone-blocks.md). Courses of varying height
// hold blocks of varying length; a block may be split again, guillotine-wise, into stacked slabs and short pieces
// (random and broken ashlar). Each piece has its own height (a few set back), a slight tilt, a pitched margin falling to
// the joint, and a face knocked about by conchoidal flake scars: shallow bowls at two sizes whose rims meet in crisp
// ridges, between flat patches of the original face. Joints are thin; here and there one opens into a dark gap at a
// corner. Joints, gaps and scars are outputs of their own, for paint; the relief puts the stones in the mask it writes,
// and can write the joints, gaps and scars to masks of their own (extra passes of the same shader).

import { P, gradient, round1, type ParamValues } from '@/core/params';
import { MAX_WRITE_ROWS, PX_SCALE_PARAM, roughnessParams, rowKey } from '../commonParams';
import type { LayerDef } from '../types';
import { flakeScarParams, flakeScarsGlsl } from './flakeScars';
import { ORG_GLSL } from './organicShared';

const scarP = flakeScarParams(
	'scar',
	{ edge: 0.8, size: [68, 512, 96], where: 'faces', edgeOf: 'the stone’s' },
	{ section: 'Relief', showIf: (p) => Number(p.scars) > 0 }
);

// The relief's colour ramp (its default, and what switching back to it restores).
const reliefGrad = () => gradient('#a48a68', '#b8a07c', '#c6ae8a');

// Joint reach and Joint patchiness shape the Joints output, and a Joints row of the relief's Write to.
const jointsShown = (p: ParamValues) =>
	p.output === 'joints' ||
	(p.output === 'relief' &&
		Array.from({ length: MAX_WRITE_ROWS }, (_, i) => i + 1).some(
			(n) => p[rowKey('mk_src', n)] === 'out_joints' && String(p[rowKey('mk_target', n)] ?? '').trim() !== ''
		));

export const stoneBlocksLayer: LayerDef = {
	type: 'stone_blocks',
	label: 'Stone blocks',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	// Only the relief has a shape (the masks return no distance).
	sdfShowIf: (p) => p.output === 'relief',
	// Its joints, gaps and scars can go to masks of their own (Write to › Source), each as its plain coverage (the joints
	// a coverage Mask area › Inside paints solid), not the soft value of an output.
	maskSources: [
		{ value: 'layer', label: 'This layer', hint: 'the layer as drawn: the blocks, from the relief', params: {} },
		{
			value: 'out_joints',
			label: 'Joints',
			hint: 'the joints and open gaps (with Joint reach and Joint patchiness)',
			params: { output: 'joints' }
		},
		{ value: 'out_gaps', label: 'Gaps', hint: 'the open gaps alone', params: { output: 'gaps' } },
		{ value: 'out_scars', label: 'Scars', hint: 'how deep the scars cut', params: { output: 'scars' } }
	],
	description:
		'Rock-faced stone wall: Made from courses of blocks split into slabs and smaller pieces, with faces chipped into flake scars and thin joints that open into gaps here and there. Makes ashlar walls and rough-hewn masonry, plus masks of the joints and scars to paint.',
	params: [
		P.enum(
			'output',
			'Output',
			'relief',
			[
				[
					'relief',
					'Relief',
					'the wall: the faces with their scars, margins and joints, as a height (and a colour by height)'
				],
				[
					'joints',
					'Joints',
					'1 in the joints and open gaps, fading out over the Joint reach onto the faces. Use it for dirt, damp and moss along the joints'
				],
				[
					'scars',
					'Scars',
					'how deep the flake scars cut into each face (0 on the untouched face). Use it to paint the fresh, paler breaks or the shaded hollows'
				],
				['gaps', 'Gaps', '1 in the open gaps only, so you can paint them dark, damp or mossy apart from the joints']
			],
			{
				hint: 'Picks what the layer outputs. Every output uses the same wall (same settings and seed). Relief puts the stones in the mask it writes, and can write the joints, gaps and scars to masks of their own too (Masks); the others write what they paint to any mask but Shape, and leave Shape as it was'
			}
		),
		P.float('course', 'Course height', 40, 4, 512, {
			softMax: 128,
			unit: 'px',
			axis: 'y',
			step: 0.1,
			hint: 'Sets the height of a course before any splits (whole courses down the texture when tiling)'
		}),
		P.float('row_var', 'Course variation', 0.4, 0, 1, { step: 0.001, hint: 'How much the courses differ in height' }),
		P.float('length', 'Block length', 3.2, 0.5, 8, {
			softMax: 5,
			step: 0.01,
			hint: 'Sets the block length as a multiple of the course height, before splits'
		}),
		P.float('len_var', 'Length variation', 0.7, 0, 1, {
			step: 0.001,
			hint: 'Varies the block lengths, within a course and from course to course'
		}),
		P.float('bond', 'Bond', 0, 0, 1, {
			step: 0.001,
			hint: 'Lines the courses up into a running bond (0 = each course starts at a random place, 1 = every other course shifts half a block)'
		}),
		P.float('tall', 'Through stones', 0.25, 0, 1, {
			step: 0.001,
			hint: 'How often a block runs on through the course above it, making tall stones that break the course lines'
		}),
		P.float('split', 'Splits', 0.4, 0, 1, {
			step: 0.001,
			hint: 'How often a block (and then each of its parts) is split again, giving stacked slabs and short pieces among whole blocks, like random ashlar'
		}),
		P.int('levels', 'Split levels', 2, 0, 3, { hint: 'How many times a block can be split' }),
		P.float('slabs', 'Slabs', 0.6, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.levels) > 0,
			hint: 'How many of the splits run along the course (thin slabs stacked in it) rather than across it (short pieces)'
		}),
		P.float('min_size', 'Smallest piece', 16, 2, 256, {
			softMax: 48,
			unit: 'px',
			step: 0.1,
			showIf: (p) => Number(p.levels) > 0,
			hint: 'Stops any split from leaving a piece thinner than this'
		}),
		P.float('gap', 'Joint width', 1, 0, 32, {
			softMax: 6,
			unit: 'px',
			step: 0.05,
			hint: 'Sets the width of the joints between stones (whole px stay crisp)'
		}),
		P.float('joint_var', 'Joint variation', 0, 0, 1, {
			step: 0.001,
			hint: 'Gives each stone a random share of the joint: width, depth, edge rounding, its step from its neighbours and the Joints mask (0 = every joint as set, 1 = from fully shut to full width). Shut stones sit flush and share their scars, so two that meet look like one rock with a hairline between; next to an open stone, half a joint is left'
		}),
		P.float('corner', 'Corner rounding', 0.5, 0, 32, { softMax: 6, unit: 'px', step: 0.05 }),
		P.float('jag', 'Jaggedness', 0.8, 0, 8, {
			softMax: 3,
			unit: 'px',
			step: 0.01,
			hint: 'Makes the stones’ edges ragged'
		}),

		P.float('heights', 'Height variation', 0.1, 0, 2, {
			softMax: 1,
			step: 0.001,
			section: 'Relief',
			hint: 'How much the stones differ in height'
		}),
		P.float('recess', 'Set-back stones', 0.1, 0, 1, {
			step: 0.001,
			section: 'Relief',
			hint: 'How many of the stones are set back into the wall'
		}),
		P.float('recess_depth', 'Set-back depth', 0.5, 0, 2, {
			softMax: 1,
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.recess) > 0
		}),
		P.float('tilt', 'Face tilt', 0.15, 0, 1, {
			step: 0.001,
			section: 'Relief',
			hint: 'Tilts each face by a random slope'
		}),
		P.float('margin', 'Margin width', 6, 0, 64, {
			softMax: 24,
			unit: 'px',
			step: 0.05,
			section: 'Relief',
			hint: 'How far in from its edge a face starts to fall away to the joint (varied along the edge), like the pitched margin of a rock-faced stone'
		}),
		P.float('pitch', 'Margin drop', 0.8, 0, 2, {
			softMax: 1,
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.margin) > 0,
			hint: 'How far the face drops over the margin, in a rounded shoulder'
		}),
		P.float('scars', 'Flake scars', 0.95, 0, 1, {
			step: 0.001,
			section: 'Relief',
			hint: 'How much of the face is knocked off in flake scars: shallow bowls whose rims meet in crisp ridges, between flat patches of the original face'
		}),
		scarP.size,
		P.float('scar_depth', 'Scar depth', 3.2, 0, 8, {
			softMax: 4,
			step: 0.001,
			section: 'Relief',
			showIf: (p) => Number(p.scars) > 0,
			hint: 'How deep the scars cut, in proportion to their size, so bigger scars cut deeper at the same slopes'
		}),
		scarP.stretch,
		scarP.edge,
		scarP.detail,
		...roughnessParams(0.06, 3),
		P.float('joint_depth', 'Joint depth', 0.3, 0, 2, {
			softMax: 1,
			step: 0.001,
			section: 'Relief',
			hint: 'How deep the joints sink below the faces'
		}),

		P.float('gaps', 'Open gaps', 0.12, 0, 1, {
			step: 0.001,
			section: 'Gaps',
			hint: 'How many of the stones get a joint opened into a dark gap at one corner, along one or both of its edges'
		}),
		P.float('gap_w', 'Gap width', 3, 0.5, 32, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			section: 'Gaps',
			showIf: (p) => Number(p.gaps) > 0,
			hint: 'Sets how wide a gap opens at its corner; it tapers along the edge'
		}),
		P.float('gap_len', 'Gap length', 0.5, 0.05, 1, {
			step: 0.001,
			section: 'Gaps',
			showIf: (p) => Number(p.gaps) > 0,
			hint: 'How far along the stone’s edge a gap runs (each one 40–100 % of this)'
		}),

		P.float('reach', 'Joint reach', 3, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			showIf: jointsShown,
			hint: 'How far the joint mask fades out onto the faces'
		}),
		P.float('patch', 'Joint patchiness', 0.3, 0, 1, {
			step: 0.001,
			showIf: jointsShown,
			hint: 'Breaks the joint mask into patches a few stones across (0 = every joint, 1 = only here and there)'
		}),

		// Not a control: 1 px of the texture in shader px (supersampling scales the px params; joints snap to texture pixels).
		PX_SCALE_PARAM,
		P.enum(
			'rnd_mode',
			'Random value',
			'piece',
			[
				['piece', 'Per stone', 'a random value for each stone (after splits)'],
				['block', 'Per block', 'the pieces split from one block share a value'],
				['course', 'Per course', 'a random value for each course, for colour bands along the wall']
			],
			{ hint: 'Picks the random value that Diffuse › Random and Colour variation read' }
		),
		P.seed()
	],
	defaults: {
		bevel: 0,
		profile: 'round',
		aa: true,
		h_on: true,
		h_amount: 9,
		dif_on: true,
		dif_src: 'random',
		dif_grad: reliefGrad()
	},
	// Added in the editor: courses about a ninth of the texture's mean side; scars, margins, the smallest piece and the
	// relief in proportion.
	fresh: ({ width, height }) => {
		const course = round1(Math.min(96, Math.max(8, Math.sqrt(width * height) * 0.11)));
		return {
			course,
			scar_size: round1(course * 1.7),
			margin: round1(course * 0.15),
			min_size: round1(Math.max(3, course * 0.4)),
			h_amount: round1(Math.max(2, course * 0.22))
		};
	},
	// Relief is the height; joints and scars are masks for paint (their coverage is their value, so a colour lands only on
	// them): dark joints, scars a little paler than the faces.
	linkedDefaults: (p) =>
		p.output === 'joints'
			? { h_on: false, dif_src: 'value', dif_blend: 'multiply', dif_grad: gradient('#ffffff', '#4a4038') }
			: p.output === 'gaps'
				? { h_on: false, dif_src: 'value', dif_blend: 'normal', dif_grad: gradient('#1c201c', '#2e3428') }
				: p.output === 'scars'
					? { h_on: false, dif_src: 'value', dif_blend: 'screen', dif_grad: gradient('#000000', '#3a3428') }
					: { h_on: true, dif_src: 'random', dif_blend: 'normal', dif_grad: reliefGrad() },
	glsl:
		ORG_GLSL +
		// Flake scars struck from the stone's nearest side (lo, hi: its box) — none from a shut stone's own edges.
		flakeScarsGlsl({
			name: 'sb_scars',
			args: ', vec2 lo, vec2 hi, bool shut',
			prefix: 'scar',
			amount: 'u_scars',
			seeds: [
				[19, 23],
				[31, 29],
				[41, 37],
				[67, 59],
				[73, 71]
			],
			wall: 4,
			edge: /* glsl */ `
    vec4 de = vec4(sp.x - lo.x, hi.x - sp.x, sp.y - lo.y, hi.y - sp.y);
    edgeD = min(min(de.x, de.y), min(de.z, de.w));
    on = true;
    canStrike = !shut;`,
			angle: 'edgeD == de.x ? 0.0 : edgeD == de.y ? PI : edgeD == de.z ? 0.5 * PI : -0.5 * PI'
		}) +
		/* glsl */ `
float sb_px(float x, float s) { return floor(x / s + 0.5) * s; }
float sb_h(uint h, uint k) { return u2f(pcg(h + k * 0x9E3779B9u)); }
// Block i's key in course jw (n blocks across).
uint sb_bid(int i, int n, int jw) { return pcg3(uvec3(uint(wrapCell(i, n)), uint(jw), uint(uSeed) + 11u)); }
// How much of a pixel d px from a line a band hw px either side of it covers: an exact box filter, nothing as hw goes
// to 0.
float sb_lineCov(float d, float hw) { return clamp(min(d + hw, 0.5) - max(d - hw, -0.5), 0.0, 1.0); }

// Course j's lower edge (px, snapped to texture pixels); courses repeat every n when tiling.
float sb_rowY(int j, int n, float rh, float pxs) {
  return sb_px((float(j) + 0.8 * u_row_var * (hashI(ivec2(wrapCell(j, n), 0), uSeed + 3.0) - 0.5)) * rh, pxs);
}
// Block i's left edge in a course (jw: the course on the torus) of n blocks bw apart, shifted by off blocks.
float sb_colX(int i, int n, int jw, float bw, float off, float pxs) {
  return sb_px((float(i) + off + 0.8 * u_len_var * (hashI(ivec2(wrapCell(i, n), jw), uSeed + 7.0) - 0.5)) * bw, pxs);
}
// Course j's blocks: n across (whole blocks when tiling), bw apart, starting off blocks along; jw its key on the torus.
void sb_course(int j, int nR, float rh, out int jw, out int n, out float bw, out float off) {
  jw = wrapCell(j, nR);
  vec3 hr = hash3I(ivec2(jw, 1), uSeed + 5.0);
  float bl = max(u_length, 0.2) * rh * (1.0 + 0.6 * u_len_var * (hr.x - 0.5));
  float nB = snapCells(uRes.x / bl);
  n = int(nB);
  bw = uRes.x / nB;
  off = mix(hr.y, imod(j, 2) == 1 ? 0.5 : 0.0, u_bond);
}
// The block of a course holding x: its index (unwrapped) and edges (jitter under half a block: one step either side).
int sb_find(float x, int n, int jw, float bw, float off, float pxs, out float xa, out float xb) {
  int i = int(floor(x / bw - off));
  xa = sb_colX(i, n, jw, bw, off, pxs);
  xb = sb_colX(i + 1, n, jw, bw, off, pxs);
  if (x < xa) { i--; xb = xa; xa = sb_colX(i, n, jw, bw, off, pxs); }
  else if (x >= xb) { i++; xa = xb; xb = sb_colX(i + 1, n, jw, bw, off, pxs); }
  return i;
}
// Whether block i of course j runs on through the course above: only from even courses (pairs never overlap; with an
// odd number of courses on the torus, the last can't, as the course above it is course 0).
bool sb_tall(int j, int i, int n, int jw, int nR) {
  if (imod(j, 2) != 0 || (uTile && (nR & 1) == 1 && jw == nR - 1)) return false;
  return hashI(ivec2(wrapCell(i, n), jw), uSeed + 61.0) < u_tall;
}

GenOut gen(vec2 p) {
  float pxs = max(u_px_scale, 1.0);
  float g = max(u_gap, 0.0);
  // Odd joints: shift half a pixel so both joint edges land on pixel boundaries.
  p -= fract(0.5 * g / pxs) * pxs;

  // Course: rows of nominal height rh, each edge jittered (at most 0.4 rh, so a neighbour test either side suffices).
  float course = max(u_course, 2.0 * pxs);
  float nR = snapCells(uRes.y / course);
  int nRi = int(nR);
  float rh = uRes.y / nR;
  int j = int(floor(p.y / rh));
  float ya = sb_rowY(j, nRi, rh, pxs), yb = sb_rowY(j + 1, nRi, rh, pxs);
  if (p.y < ya) { j--; yb = ya; ya = sb_rowY(j, nRi, rh, pxs); }
  else if (p.y >= yb) { j++; ya = yb; yb = sb_rowY(j + 1, nRi, rh, pxs); }

  int jw, nBi;
  float bw, off, xa, xb;
  sb_course(j, nRi, rh, jw, nBi, bw, off);
  int i = sb_find(p.x, nBi, jw, bw, off, pxs, xa, xb);
  uint bid = sb_bid(i, nBi, jw);
  int jr = jw;

  // Through stones: a block of an even course may run on through the course above. Above (odd courses: an even one's
  // course below can't run on), the pixel belongs to such a block of the course below if one holds its x; otherwise its
  // own block stops short of the nearest ones either side.
  if (u_tall > 0.0) {
    if (sb_tall(j, i, nBi, jw, nRi)) yb = sb_rowY(j + 2, nRi, rh, pxs);
    else if (imod(j, 2) == 1) {
      int jd, nd;
      float bwd, offd, da, db;
      sb_course(j - 1, nRi, rh, jd, nd, bwd, offd);
      int id = sb_find(p.x, nd, jd, bwd, offd, pxs, da, db);
      if (sb_tall(j - 1, id, nd, jd, nRi)) {
        xa = da; xb = db; ya = sb_rowY(j - 1, nRi, rh, pxs);
        jr = jd;
        bid = sb_bid(id, nd, jd);
      } else {
        if (sb_tall(j - 1, id - 1, nd, jd, nRi) && da > xa) { xa = da; bid = pcg(bid + 101u); }
        if (sb_tall(j - 1, id + 1, nd, jd, nRi) && db < xb) { xb = db; bid = pcg(bid + 103u); }
      }
    }
  }

  // Splits: halve the piece holding p, guillotine-wise, at 30–70 % of its span — along the course (slabs) or across it.
  vec2 lo = vec2(xa, ya), hi = vec2(xb, yb);
  uint pid = bid;
  float minS = max(u_min_size, 2.0 * pxs);
  bool live = true;
  for (int k = 0; k < 3 * UNI_1; k++) {
    if (k >= u_levels) live = false;
    vec2 sz = hi - lo;
    live = live && sb_h(pid, 1u) < u_split * (1.0 - 0.15 * float(k));
    bool hz = sb_h(pid, 2u) < u_slabs;
    if (sz.y < 2.0 * minS) hz = false;
    if (sz.x < 2.0 * minS) hz = true;
    float L = hz ? sz.y : sz.x;
    live = live && L >= 2.0 * minS;
    if (live) {
      float at = (hz ? lo.y : lo.x) + sb_px(clamp((0.3 + 0.4 * sb_h(pid, 3u)) * L, minS, L - minS), pxs);
      bool up = (hz ? p.y : p.x) >= at;
      if (hz) { if (up) lo.y = at; else hi.y = at; }
      else { if (up) lo.x = at; else hi.x = at; }
      pid = pcg(pid + (up ? 17u : 29u));
    }
  }

  // The noise, in one flat loop (one copy of the fBm's code; D3D inlines every call): the ragged edges (~5 px across),
  // the margin's width (~3 margins), the scars' warp (x, y: half a big scar), the roughness and the joint mask's
  // patches (~3 blocks). Each only where the output reads it.
  float scs = max(u_scar_size, 2.0 * pxs);
  float jn = 0.0, mwN = 0.5, rn = 0.5, pn = 1.0;
  vec2 wn = vec2(0.5);
  for (int e = 0; e < 6 * UNI_1; e++) {
    float amt = e == 0 ? u_jag : e == 1 ? (u_output == 0 ? u_margin : 0.0)
              : e < 4 ? (u_output == 0 || u_output == 2 ? u_scars : 0.0) : e == 4 ? (u_output == 0 ? u_rough : 0.0)
              : (u_output == 1 ? u_patch : 0.0);
    if (amt > 0.0) {
      float cellPx = e == 0 ? 5.0 * pxs : e == 1 ? 3.0 * u_margin : e < 4 ? 0.5 * scs : e == 4 ? u_rough_scale
                   : 3.0 * u_length * rh;
      float seed = e == 0 ? 13.0 : e == 1 ? 17.0 : e == 2 ? 79.0 : e == 3 ? 83.0 : e == 4 ? 43.0 : 53.0;
      vec2 nc = cellsFor(uRes.x / cellPx, 1.0);
      float n = org_noiseFbm(1, false, p / uRes * nc, periodOf(nc), e < 4 ? 2 : 3, 0.5, uSeed + seed);
      if (e == 0) jn = n - 0.5;
      else if (e == 1) mwN = n;
      else if (e == 2) wn.x = n;
      else if (e == 3) wn.y = n;
      else if (e == 4) rn = n;
      else pn = n;
    }
  }

  vec2 c = 0.5 * (lo + hi), hs = 0.5 * (hi - lo);
  vec2 q = p - c;
  // This stone's share of the joint: it owns half of every joint round it, so where two shut stones meet the joint
  // closes, beside an open one it narrows to a half joint.
  float js = 1.0 - u_joint_var * sb_h(pid, 19u);
  // Nearly shut stones read as one rock: they share one scar field (no offset of their own, scars not struck from their
  // own edges), so a scar runs on across the hairline where two of them meet.
  bool shut = js < 0.3;
  // The stone, inset by half the joint either side, its corners rounded, its edges ragged (negative inside).
  float gs = g * js;
  float rc = clamp(u_corner * js, 0.0, max(min(hs.x, hs.y) - 0.5 * gs, 0.0));
  float sd = sdBox(q, hs - 0.5 * gs - rc) - rc + 2.0 * u_jag * js * jn;

  // ---- relief (0 = the original face; only the relief output reads it)
  // (A shut stone sits flush: its own height, set-back and tilt shrink with its share of the joint, so two shut stones
  // meet level.)
  float v = u_heights * (sb_h(pid, 5u) - 0.5);
  if (sb_h(pid, 6u) < u_recess) v -= u_recess_depth;
  v += u_tilt * dot(vec2(sb_h(pid, 7u), sb_h(pid, 8u)) * 2.0 - 1.0, q / rh);
  v *= js;

  // Pitched margin: a rounded shoulder over a width that wanders along the edge.
  float din = max(-sd, 0.0);
  if (u_margin > 0.0 && u_output == 0) {
    float mw = u_margin * (0.4 + 1.2 * mwN);
    float f = clamp(din / max(mw, 0.5), 0.0, 1.0);
    v -= u_pitch * js * (1.0 - sqrt(max(1.0 - (1.0 - f) * (1.0 - f), 0.0)));
  }

  // Flake scars: per scar a hollow below the face, 0 at its rim; the lowest wins, so rims meet in ridges and the face
  // stays flat outside them. Two sizes in one flat loop (16 cells each: the 4 × 4 around p, which holds every scar
  // reaching it — at most 1.45 cells — as sites stay 0.1 cells inside theirs). Each stone reads the field at its own
  // offset, so scars never run on across a joint.
  vec2 so = shut ? vec2(0.0) : vec2(sb_h(pid, 9u), sb_h(pid, 10u)) * uRes;
  float scar = 0.0;
  // (Ragged rims: the field is warped by up to ~0.1 of a big scar, in px.)
  if (u_scars > 0.0 && (u_output == 0 || u_output == 2)) scar = sb_scars(p, 0.2 * scs * (wn - 0.5), so, scs, lo, hi, shut);
  // Depth in proportion to the scar's size (relative to a course), so resizing the scars keeps their slopes.
  v += u_scar_depth * scar * scs / course;
  if (u_rough > 0.0 && u_output == 0) v += 2.0 * u_rough * (rn - 0.5);

  // Open gaps: at one corner, along one or both edges meeting there, tapering from Gap width to nothing.
  float gp = 0.0;
  if (sb_h(pid, 12u) < u_gaps) {
    vec2 sg = vec2(sb_h(pid, 13u) < 0.5 ? -1.0 : 1.0, sb_h(pid, 14u) < 0.5 ? -1.0 : 1.0);
    vec2 K = c + sg * hs;
    float both = sb_h(pid, 15u);
    vec2 len = 2.0 * hs * u_gap_len * (0.4 + 0.6 * vec2(sb_h(pid, 16u), sb_h(pid, 17u)));
    vec2 t = abs(p - K) / max(len, vec2(1.0));
    // Half-widths along the horizontal edge (y = K.y) and the vertical one (x = K.x), ragged by the edges' noise (less
    // as they taper out). Each edge's band on its own: past its taper it covers nothing.
    vec2 w = u_gap_w * max(1.0 - t * t, 0.0) * vec2(both < 0.7 ? 1.0 : 0.0, both > 0.4 ? 1.0 : 0.0);
    w -= 2.0 * u_jag * jn * min(w, vec2(1.0));
    gp = max(sb_lineCov(p.y - K.y, w.x), sb_lineCov(p.x - K.x, w.y));
  }

  // Joints: the floor of the joint sits below the face (and below a set-back stone); gaps sink deeper.
  float inside = coverage(sd, u_aa);
  float floorV = min(v, 0.0) - u_joint_depth * js;
  v = mix(floorV, v, inside);
  v = mix(v, floorV - 0.5 - u_joint_depth, gp);
  float val = (0.5 + 0.5 * tanh(0.5 * v)) * bevelPlain(sd);

  float rnd = u_rnd_mode == 1 ? u2f(bid) : u_rnd_mode == 2 ? hashI(ivec2(jr, 2), uSeed + 47.0) : u2f(pid);
  // The masks' coverage is their value, so any blend (a Normal paint too) lands only on them.
  float cov = 1.0;
  if (u_output == 1) {
    float m = max((1.0 - smoothstep(0.0, max(u_reach, 0.5), din)) * js, gp);
    float cut = 0.35 + 0.3 * u_patch;
    if (u_patch > 0.0) m *= smoothstep(cut - 0.05, cut + 0.05, pn);
    val = m;
    cov = m;
  } else if (u_output == 2) {
    val = clamp(-scar, 0.0, 1.0) * inside;
    cov = val;
  } else if (u_output == 3) {
    val = gp;
    cov = gp;
  }
  // Only the relief hands its stones to the mask; the other outputs write their coverage (any mask but Shape). Each
  // stone is a feature of the mask, whatever the colour's random follows.
  GenOut o = genOutOwn(clamp(val, 0.0, 1.0), cov, rnd, u_output == 0 ? sd : NO_SDF);
  o.fid = u2f(pid);
  return o;
}
`
};
