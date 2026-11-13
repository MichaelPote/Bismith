// Tabs & notches (FR8.8): small greeble details with diagonal cuts — the clip notches on a grate frame,
// chevrons, bow-tie bridges, diagonal slits, chamfered plates, scallops — placed along the edges of a mask (the panels,
// planks or plates below), along the texture's edges, or on a grid (scattered by Position jitter). A crisp SDF shape
// (value 1 inside), meant for small relief (a lit 1–2 px chamfer) and colour.
//
// The elements are the shared Repeat's instances (repeat.ts, glsl/repeat.ts; FR8.33): on an outline, by default along
// each straight side of the mask, spread by spacing and clear of the corners (Tabs adds what its shape needs to clear a
// right-angled corner, tabClearance). Local frame per element: u along its edge (centred), v in from the edge (≥ 0
// inside; Side › Out of the shape turns it outward), Inset further in. Grid elements use the same frame centred on their
// cell.

import { P, gradient, halfPx, type ParamValues } from '@/core/params';
import { GLSL_REPEAT } from '../glsl/repeat';
import { onGrid, onOutline, REPEAT_GROUP, repeatParams, withRepeat } from '../repeat';
import type { LayerDef } from '../types';

const SHAPES = ['trapezoid', 'notch', 'chevron', 'bowtie', 'slit', 'plate', 'round'];

/**
 * How far in from a side's end an element must stay to clear a right-angled corner: the most any of its points reaches
 * past the 45° line from the corner (max of v + |u|, less half its length) — 0 for a 45° tab, its depth for a square one.
 * Outward, only a stroke's thickness reaches past the corner.
 */
export function tabClearance(p: ParamValues): number {
	const n = (k: string, d: number) => (Number.isFinite(Number(p[k])) ? Number(p[k]) : d);
	const hl = 0.5 * n('length', 20);
	const d = n('depth', 6);
	const th = 0.5 * n('thickness', 2);
	const cut = n('cut', 1);
	const shape = SHAPES.indexOf(String(p.shape ?? 'trapezoid'));
	if (p.side === 'out') return shape === 2 || shape === 4 ? th : 0;
	// (The base corners, at the edge, never reach past it: hence the max with 0.)
	const g =
		shape === 0
			? d * (1 - cut)
			: shape === 1
				? d - hl
				: shape === 2
					? Math.max(d - hl, 0) + th * Math.SQRT2
					: shape === 3
						? d
						: shape === 4
							? 0.5 * d + (hl + th) * Math.SQRT2 - hl
							: shape === 6
								? Math.sqrt(hl * hl + d * d) - hl
								: d - Math.min(hl, 0.5 * d) * Math.min(Math.max(cut, 0), 1);
	return Math.max(Math.max(g, 0) + n('inset', 0), 0);
}

export const tabsLayer: LayerDef = withRepeat(
	{
		type: 'tabs',
		label: 'Tabs & notches',
		category: 'shape',
		kind: 'generator',
		sdf: true,
		description:
			'Tabs & notches: Small cut-out details placed along the edges of a mask (Shape by default) or the texture, or on a grid. Makes tabs, notches, chevrons, bow-ties, slits, chamfered plates, scallops.',
		params: [
			P.enum('shape', 'Shape', 'trapezoid', [
				[
					'trapezoid',
					'Trapezoid tab (45° sides)',
					'full length at the edge, with the sides cut inward at the Diagonal cut slope (negative = a dovetail)'
				],
				['notch', 'Notch (triangle)'],
				['chevron', 'Chevron (V stroke)'],
				['bowtie', 'Bow-tie'],
				['slit', 'Diagonal slit'],
				['plate', 'Chamfered plate'],
				['round', 'Half-round (scallop)', 'a half ellipse on the edge, Length across and Depth deep']
			]),
			P.enum(
				'side',
				'Side',
				'in',
				[
					['in', 'Into the shape'],
					['out', 'Out of the shape']
				],
				{
					showIf: onOutline,
					hint: 'Into the shape cuts the notches and tabs in from its edges; Out of the shape makes them stick out from its edges into the gaps'
				}
			),
			P.float('length', 'Length', 20, 0.5, 1024, {
				softMax: 96,
				unit: 'px',
				step: 0.5,
				hint: 'How long each element is along the edge (the wide side of a tab)'
			}),
			P.float('depth', 'Depth', 6, 0.5, 1024, {
				softMax: 48,
				unit: 'px',
				step: 0.5,
				hint: 'How far each element reaches in from the edge'
			}),
			P.float('cut', 'Diagonal cut', 1, -4, 8, {
				softMin: -1,
				softMax: 3,
				step: 0.01,
				hint: 'On a trapezoid, sets the slope of the cut sides (0 = square, 1 = 45°, steeper closes it to a point, below 0 flares it into a dovetail). On a plate, cuts off the corners (0 = none, 1 = as much as fits)',
				showIf: (p) => p.shape === 'trapezoid' || p.shape === 'plate'
			}),
			P.float('thickness', 'Stroke width', 2, 0.5, 64, {
				softMax: 16,
				unit: 'px',
				step: 0.5,
				showIf: (p) => p.shape === 'chevron' || p.shape === 'slit'
			}),
			P.float('angle', 'Slit angle', 45, -90, 90, { unit: '°', step: 1, showIf: (p) => p.shape === 'slit' }),
			P.float('inset', 'Inset', 0, -256, 1024, {
				softMin: -32,
				softMax: 64,
				unit: 'px',
				step: 0.5,
				hint: 'Moves the elements away from the edge (below 0 they straddle it)'
			}),
			P.float('rotation', 'Rotation', 0, -180, 180, {
				unit: '°',
				step: 1,
				showIf: onGrid,
				hint: 'Turns every element'
			}),
			P.bool('alternate', 'Flip every other', false, {
				hint: 'Flips every other element end for end, so a tab’s wide side faces in or a chevron points out (on a grid, in a checkerboard)'
			}),
			...repeatParams({
				grid: 'cells',
				softMax: 24,
				jitter: 'cell',
				without: ['rep_off', 'rep_follow', 'rep_mirror_x', 'rep_mirror_y'],
				defaults: {
					rep_place: 'mask',
					rep_along: 'side',
					rep_corners: 'clear',
					rep_count_by: 'spacing',
					rep_space: 64,
					rep_n: 3,
					rep_clear: 6,
					rep_x: 3,
					rep_y: 3
				}
			})
		],
		groups: [{ ...REPEAT_GROUP, collapsed: false }],
		defaults: {
			h_on: true,
			h_mode: 'subtract',
			h_amount: 0.15,
			bevel: 1.5,
			profile: 'linear',
			// Cut in, so a little darker inside: the chamfer keeps the surface colour, the floor shades down.
			dif_on: true,
			dif_src: 'value',
			dif_blend: 'multiply',
			dif_grad: gradient('#ffffff', '#767676')
		},
		// A new layer in the editor: the defaults (a tab every ~64 px of each side, 20 × 6 px with a flat end 8 px wide, as at
		// 512) sized to the texture.
		fresh: ({ width, height }) => {
			const s = Math.min(width, height) / 512;
			return {
				rep_space: halfPx(64 * s, 8),
				length: halfPx(20 * s, 4),
				depth: halfPx(6 * s, 1.5),
				rep_clear: halfPx(6 * s, 1),
				thickness: halfPx(2 * s, 1),
				bevel: halfPx(1.5 * s, 1)
			};
		},
		glsl:
			GLSL_REPEAT +
			/* glsl */ `
const float TB_R2 = 0.70710678;

// One element in its local frame: u along (centred), v inward (0 at the edge).
float tb_shape(vec2 q) {
  float u = q.x, v = q.y;
  float hl = 0.5 * u_length, d = u_depth;
  if (u_shape <= 1) {
    // Trapezoid: full length at the edge, sides cut inward at the given slope, a flat top. Notch: the sides meet.
    float k = u_shape == 0 ? u_cut : hl / max(d, 1e-3);
    return max(max(-v, u_shape == 0 ? v - d : -1e4), (abs(u) - (hl - v * k)) / sqrt(1.0 + k * k));
  }
  if (u_shape == 2) {
    float s = min(sdSegment(q, vec2(-hl, 0.0), vec2(0.0, d)), sdSegment(q, vec2(0.0, d), vec2(hl, 0.0)));
    return s - 0.5 * u_thickness;
  }
  if (u_shape == 3) {
    // Bow-tie: two triangles meeting tip to tip at the middle of the depth.
    float k = d / max(hl, 5e-4);
    float w = abs(v - 0.5 * d) - abs(u) * k;
    return max(abs(u) - hl, max(w / sqrt(1.0 + k * k), abs(v - 0.5 * d) - 0.5 * d));
  }
  if (u_shape == 4) {
    vec2 r = rotCW(vec2(u, v - 0.5 * d), u_angle);
    return sdBox(r, vec2(hl, 0.5 * u_thickness));
  }
  if (u_shape == 6) {
    // Half-round: half an ellipse on the edge, hl along it, d deep.
    return max(-v, sdEllipse(q, vec2(hl, d)));
  }
  // Chamfered plate.
  vec2 b = vec2(hl, 0.5 * d);
  return sdChamferBox(vec2(u, v - 0.5 * d), b, min(b.x, b.y) * clamp(u_cut, 0.0, 1.0));
}

// Bevel aspect: plane i of a convex element in its local frame — its unit normal (xy) and offset (z): the plane is
// dot(xy, q) − z, < 0 inside; z = 1e9 for none. su: the side of a bow-tie (sign of u), whose two triangles are each convex.
vec3 tb_plane(int i, float su) {
  float hl = 0.5 * u_length, d = u_depth;
  if (i == 0 && u_shape != 4) return vec3(0.0, -1.0, 0.0);   // the edge (v = 0)
  if (u_shape <= 1) {
    // Trapezoid, notch: the cut sides at slope k, the top (trapezoid).
    float k = u_shape == 0 ? u_cut : hl / max(d, 1e-3), s = sqrt(1.0 + k * k);
    return i == 1 ? vec3(1.0, k, hl) / s : i == 2 ? vec3(-1.0, k, hl) / s : i == 3 && u_shape == 0 ? vec3(0.0, 1.0, d) : vec3(0.0, 0.0, 1e9);
  }
  if (u_shape == 3) {
    float k = d / max(hl, 1e-3), s = sqrt(1.0 + k * k);
    return i == 1 ? vec3(0.0, 1.0, d) : i == 2 ? vec3(su, 0.0, hl)
         : i == 3 ? vec3(-su * k, 1.0, 0.5 * d) / s : i == 4 ? vec3(-su * k, -1.0, -0.5 * d) / s : vec3(0.0, 0.0, 1e9);
  }
  if (u_shape == 4) {
    // Slit: the rotated box's four sides, its centre half the depth in.
    vec2 n = unrotCW(i < 2 ? vec2(i == 0 ? 1.0 : -1.0, 0.0) : vec2(0.0, i == 2 ? 1.0 : -1.0), u_angle);
    return i < 4 ? vec3(n, (i < 2 ? hl : 0.5 * u_thickness) + n.y * 0.5 * d) : vec3(0.0, 0.0, 1e9);
  }
  // Chamfered plate: the box's sides and the four cut corners.
  float ch = min(hl, 0.5 * d) * clamp(u_cut, 0.0, 1.0);
  float sg = (i & 1) == 0 ? 1.0 : -1.0, tg = (i & 2) == 0 ? 1.0 : -1.0;
  return i == 1 ? vec3(0.0, 1.0, d) : i < 4 ? vec3(i == 2 ? 1.0 : -1.0, 0.0, hl)
       : vec3(vec2(sg, tg), hl + 0.5 * d - ch + tg * 0.5 * d) * TB_R2;
}

// Bevel aspect: the element's bevel distance in the space the aspect stretches (px of Bevel, before its size scale), at
// local q with the local axes along screen directions ax, ay. Polygons: the most of their planes' (exact inside a convex
// one); the chevron: the nearer of its two strokes, each by its own direction (continuous where they meet); the
// half-round: the exact stretched ellipse and its base line.
float tb_bevel(vec2 q, vec2 ax, vec2 ay) {
  float hl = 0.5 * u_length, d = u_depth;
  if (u_shape == 2) {
    float m = 1e9;
    for (int k = 0; k < 2; k++) {
      vec2 a = vec2(k == 0 ? -hl : hl, 0.0);
      m = min(m, bevelCapsule(q - a, vec2(0.0, d) - a, 0.5 * u_thickness, mat2(ax, ay)).y);
    }
    return m;
  }
  if (u_shape == 6) {
    return max(bevelLine(-q.y, ay), bevelEllipseS(q, bevelFrame(ax, ay), vec2(max(hl, 1e-3), max(d, 1e-3))));
  }
  float m = -1e9;
  float su = q.x < 0.0 ? -1.0 : 1.0;
  for (int i = 0; i < 8 * UNI_1; i++) {
    vec3 pl = tb_plane(i, su);
    if (pl.z < 1e8) m = max(m, bevelLine(dot(pl.xy, q) - pl.z, ax * pl.x + ay * pl.y));
  }
  return m;
}

GenOut gen(vec2 p) {
  // The elements (the shared Repeat): along the outline of the mask or the texture, or on a grid of cells across the
  // texture (scattered by Position jitter), each with its turn, size, flips and random.
  ivec2 gn = ivec2(max(u_rep_x, 1), max(u_rep_y, 1));
  RepFrame f = repFrame(gn, vec2(repPitch(uRes.x, gn.x, u_col_sp, uRes.x), repPitch(uRes.y, gn.y, u_row_sp, uRes.y)), 0.5 * uRes);
  f.stagger = u_rep_stagger * f.pitch.x;
  // (No X / Y here for the mirrors to mirror: they stay off.)
  f.mirror = bvec2(u_rep_mirror_x, u_rep_mirror_y);
  f.rot = u_rep_place == 0 ? u_rotation : 0.0;
  f.jitStep = u_rep_jit;
  // An element's reach from its centre on a grid, or from its point on the edge: a dovetail's flared top and a stroke's
  // half thickness included.
  float ext = length(vec2(0.5 * u_length + max(-u_cut, 0.0) * u_depth, u_depth)) + 0.5 * u_thickness + abs(u_inset) + 2.0;
  RepSrc rs = repBegin(p, f, vec2(ext));
  int n = repIters(rs);
  float best = 1e4;
  float brnd = 0.5;
  // The winner's local frame for Bevel aspect: its point (before size), size, and local axes on screen.
  vec2 bQ = vec2(0.0), bAx = vec2(1.0, 0.0), bAy = vec2(0.0, 1.0);
  float bSc = 1.0;
  for (int k = 0; k < n; k++) {
    RepInst it = repNext(rs);
    // (No continue: ANGLE / D3D11 can miscompile it in a loop — dropped elements skip the body by a flag.)
    if (it.kept) {
      vec2 d = p - it.centre;
      // Its u axis along the edge (or across, upright, on a grid), and out of the mask (or up).
      vec2 ax = rotCW(vec2(1.0, 0.0), it.ang);
      vec2 up = vec2(-ax.y, ax.x);
      // Flip every other (a checkerboard on a grid) and Flip at random › Up / down turn it end for end.
      bool flip = (u_alternate && it.odd) != it.flip.y;
      if (it.flip.x) ax = -ax;
      float sc = it.scale;
      vec2 ay;
      vec2 qs;
      if (it.edge) {
        // Along an edge: v in from it (Side › Out of the shape: out), less the inset; sized about its point on the edge.
        ay = u_side == 1 ? up : -up;
        qs = vec2(dot(d, ax), dot(d, ay) - u_inset) / sc;
        if (flip) { qs.y = u_depth - qs.y; ay = -ay; }
      } else {
        // On a grid: centred on its place, sized about its centre.
        ay = flip ? up : -up;
        qs = vec2(dot(d, ax), dot(d, ay)) / sc;
        qs.y += 0.5 * u_depth - u_inset;
      }
      float e = tb_shape(qs) * sc;
      if (e < best) { best = e; brnd = it.rnd; bQ = qs; bSc = sc; bAx = ax; bAy = ay; }
    }
  }
  // (Away from every element: a lower bound on the distance — the mask must not read 'nothing written'.)
  GenOut g = genOut(1.0, 1.0, brnd, min(best, 4e3));
  // Bevel aspect: the winner's bevel measured in the stretched space, so its mitres don't step where the distance's
  // direction turns (at aspect 1 the wrapper's own bevel, unchanged).
  if (bevelAspectOn() && best < 0.0) g.bdist = tb_bevel(bQ, bAx, bAy) * bSc;
  return g;
}
`
	},
	{
		// Clear of the corners: as many as fit with their Length, the clearance and what their shape needs to clear a corner.
		fit: (p, len) =>
			Math.floor(len / Math.max(Number(p.length ?? 20) + 2 * (Number(p.rep_clear ?? 6) + tabClearance(p)), 1e-3))
	}
);
