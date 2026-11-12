// Tabs & notches (FR8.8): small greeble details with diagonal cuts — the clip notches on a grate frame,
// chevrons, bow-tie bridges, diagonal slits, chamfered plates, scallops — placed along the edges of its mask (the
// panels, planks or plates below), along the texture's edges, on a grid or scattered. A crisp SDF shape (value 1
// inside), meant for small relief (a lit 1–2 px chamfer) and colour.
//
// Local frame per element: u along its edge (centred), v inward from the edge (≥ 0 inside). Grid and scatter elements
// use the same frame centred on their cell.
//
// Along the mask: each pixel takes the nearest edge of the mask (its distance and normal from
// maskIn()), finds how far that edge runs straight both ways (to a corner, a gap, the texture's border) and spreads
// the side's elements evenly over it — as many as asked for, fewer where the side is too short for them to clear its
// corners. Exact distances read ~0 all along a straight side, so a tight threshold finds its ends; curved edges never
// stay straight long enough to hold an element. The lengths come from passes before the layer (prepare): every texel
// on an edge learns how far its side runs on either side of it by doubling (each pass joins the run that starts 1 px
// past its own end, as in jump flooding: log₂ of the texture's size passes), and a pixel only refines its side's two
// ends from there, a few px each.

import type { Texture } from 'three';
import { P, gradient, halfPx } from '@/core/params';
import { spacingParams } from '../commonParams';
import type { LayerDef } from '../types';

// Along the mask, shared by the side passes and the layer: a side's direction from its normal (n, outward) — down left
// and right sides, rightward along top and bottom ones —, the length after which a side counts as endless (once round a
// tiling texture), and whether a point is on an edge: |mask| ~0 there (and inside the texture unless tiling).
const TB_SIDE = /* glsl */ `
const float TB_EPS = 0.02;
vec2 tb_tan(vec2 n) {
  vec2 t = vec2(-n.y, n.x);
  return (abs(n.x) + 1e-3 >= abs(n.y) ? t.y > 0.0 : t.x < 0.0) ? -t : t;
}
float tb_cap(vec2 t) {
  return uTile ? (abs(t.x) > 0.999 ? uRes.x : abs(t.y) > 0.999 ? uRes.y : uRes.x + uRes.y) : 2.0 * (uRes.x + uRes.y);
}
bool tb_on(vec2 x) {
  return abs(sampleT(tMaskIn, x).x) < TB_EPS && (uTile || (x.x >= 0.0 && x.y >= 0.0 && x.x <= uRes.x && x.y <= uRes.y));
}
// The edge texel holding a point of a side (nudged inward off a texel border, so both ends of a side agree).
ivec2 tb_texel(vec2 x, vec2 n) { return texelCoord(ivec2(floor(x - 0.01 * n))); }
`;

/**
 * Side pass 1: each edge texel (|mask| < 0.75 holds a point of the edge; the gradient clean, not a corner's or a
 * ridge's): its foot on the edge (xy) and the edge's outward normal (zw); zeros elsewhere.
 */
const TB_FOOT = /* glsl */ `
void main() {
  ivec2 ic = ivec2(gl_FragCoord.xy);
  float d0 = maskIn(ic);
  vec2 g = 0.5 * vec2(maskIn(ic + ivec2(1, 0)) - maskIn(ic - ivec2(1, 0)), maskIn(ic + ivec2(0, 1)) - maskIn(ic - ivec2(0, 1)));
  float gl = length(g);
  vec2 n = g / max(gl, 1e-6);
  bool on = !maskEmpty(d0) && abs(d0) < 0.75 && abs(gl - 1.0) < 0.1;
  oColor = on ? vec4(gl_FragCoord.xy - d0 * n, n) : vec4(0.0);
}
`;

/**
 * Side passes 2…: where each edge texel's side is known to run to from its foot, along its direction (xy) and against
 * it (zw): the furthest points on the edge reached, as offsets from the foot (not wrapped); zeros off the edges. A pass
 * steps 1 px past each end: still on the edge there, it takes on the end of the edge texel at that point when that
 * texel is on the same line and its end stays on this texel's line (a curve's texels each lie on a line of their own),
 * else the step. A run stops growing past the cap (endless).
 */
const TB_RUN = /* glsl */ `
uniform sampler2D tFoot;
uniform sampler2D tRun;
uniform bool uInit;
void main() {
  ivec2 ic = ivec2(gl_FragCoord.xy);
  vec4 f = texelFetch(tFoot, ic, 0);
  vec4 r = uInit ? vec4(0.0) : texelFetch(tRun, ic, 0);
  vec2 n = f.zw, t = tb_tan(n);
  float cap = tb_cap(t);
  for (int k = 0; k < 2 * UNI_1; k++) {
    float sg = k == 0 ? 1.0 : -1.0;
    vec2 o = k == 0 ? r.xy : r.zw;
    vec2 x = f.xy + o + sg * t;
    if (n != vec2(0.0) && sg * dot(o, t) < cap && tb_on(x)) {
      ivec2 cq = tb_texel(x, n);
      vec4 fq = texelFetch(tFoot, cq, 0);
      vec4 rq = uInit ? vec4(0.0) : texelFetch(tRun, cq, 0);
      // (Its end the same way: its direction may be the opposite one, where a side's direction is a tie.)
      vec2 j = o + sg * t + wrapDelta(fq.xy - x) + ((dot(tb_tan(fq.zw), t) > 0.0) == (k == 0) ? rq.xy : rq.zw);
      // (The tolerance grows a little with the distance, for the error in the side's direction.)
      bool join = dot(fq.zw, n) > 0.999 && abs(dot(j, n)) < TB_EPS + 1e-4 * abs(dot(j, t));
      o = join ? j : o + sg * t;
    }
    if (k == 0) r.xy = o; else r.zw = o;
  }
  oColor = r;
}
`;

const EDGES: [string, string][] = [
	['sides', 'Left + right'],
	['ends', 'Top + bottom'],
	['all', 'All four'],
	['left', 'Left'],
	['right', 'Right'],
	['top', 'Top'],
	['bottom', 'Bottom']
];

const onEdges = (p: Record<string, unknown>) => p.place === 'border' || p.place === 'shape';
const onCells = (p: Record<string, unknown>) => p.place === 'grid' || p.place === 'scatter';

export const tabsLayer: LayerDef = {
	type: 'tabs',
	label: 'Tabs & notches',
	category: 'shape',
	kind: 'generator',
	sdf: true,
	// Along the mask's edges: it reads the mask before it (the one it writes, or Shape).
	readsMask: true,
	description:
		'Tabs & notches: Small cut-out details placed along the edges of a mask (Shape by default) or the texture, on a grid or scattered. Makes tabs, notches, chevrons, bow-ties, slits, chamfered plates, scallops.',
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
		P.enum('place', 'Placement', 'shape', [
			['border', 'Along the texture edges'],
			['grid', 'Grid'],
			['scatter', 'Scattered'],
			[
				'shape',
				'Along the mask’s edges',
				'spreads elements evenly along every straight side of the mask below (the one this layer writes, or Shape: panels, planks, plates); if the mask’s empty, uses the texture’s edges'
			]
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
				showIf: (p) => p.place === 'shape',
				hint: 'Into the shape cuts the notches and tabs in from its edges; Out of the shape makes them stick out from its edges into the gaps'
			}
		),
		P.enum('edges', 'Edges', 'all', EDGES, {
			showIf: onEdges,
			hint: 'Picks which edges get elements (along the mask, its sides are picked by the way they face)'
		}),
		P.enum(
			'distribute',
			'Spread',
			'spacing',
			[
				['count', 'Count per edge'],
				['spacing', 'Spacing']
			],
			{
				showIf: onEdges,
				hint: 'Count per edge puts the same number on every edge; Spacing puts one about every Spacing px, so long sides get more than short ones'
			}
		),
		P.int('count', 'Elements', 3, 1, 256, {
			softMax: 24,
			showIf: (p) => !onEdges(p) || p.distribute !== 'spacing',
			hint: 'How many elements go on each edge, or across the texture on a grid or scatter (sides of the mask too short for that many get fewer)'
		}),
		P.float('spacing', 'Spacing', 64, 1, 8192, {
			softMax: 256,
			unit: 'px',
			step: 0.5,
			showIf: (p) => onEdges(p) && p.distribute === 'spacing',
			hint: 'Roughly how far apart the elements are, centre to centre. Each edge gets a whole number of them, evenly spread (sides too short to hold one get none)'
		}),
		P.float('clearance', 'Corner clearance', 6, 0, 1024, {
			softMax: 64,
			unit: 'px',
			step: 0.5,
			showIf: (p) => p.place === 'shape',
			hint: 'Keeps the elements at least this far from the ends of a side, on top of what their shape needs to clear the corner. Sides too short for the count or spacing get fewer, or none'
		}),
		P.int('rows', 'Rows', 3, 1, 256, { softMax: 24, showIf: onCells }),
		...spacingParams({ showIf: (p) => p.place === 'grid' }),
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
		P.float('offset', 'Offset along', 0, -1, 1, {
			step: 0.001,
			hint: 'Slides the elements along, as a fraction of the spacing'
		}),
		P.float('rotation', 'Rotation', 0, -180, 180, { unit: '°', step: 1, showIf: onCells, hint: 'Turns every element' }),
		P.float('rot_jitter', 'Rotation variation', 0, 0, 180, {
			unit: '°',
			step: 1,
			showIf: onCells,
			hint: 'Turns each element by a random amount, up to this either way'
		}),
		P.bool('alternate', 'Flip every other', false, {
			showIf: (p) => p.place !== 'scatter',
			hint: 'Flips every other element end for end, so a tab’s wide side faces in or a chevron points out (on a grid, in a checkerboard)'
		}),
		P.float('size_var', 'Size variation', 0, 0, 1, {
			step: 0.001,
			hint: 'Shrinks each element by a random amount, up to this share of its size (0 = all the same)'
		}),
		P.float('drop', 'Drop out', 0, 0, 1, {
			step: 0.001,
			showIf: (p) => p.place !== 'scatter',
			hint: 'Leaves out elements at random (0 = none, 1 = all)'
		}),
		P.float('jitter', 'Jitter', 0.5, 0, 1, {
			step: 0.001,
			showIf: (p) => p.place === 'scatter',
			hint: 'Moves each element randomly within its cell'
		}),
		P.float('density', 'Density', 0.6, 0, 1, { step: 0.001, showIf: (p) => p.place === 'scatter' }),
		P.seed()
	],
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
	// Along the mask: its edge texels' feet and normals, and how far each one's side runs both ways.
	textures: ['foot', 'run'],
	prepare(ctx, layer): Record<string, Texture> {
		if (layer.params.place !== 'shape') return {};
		const foot = ctx.scratch('tabs-foot');
		ctx.run(ctx.sharedMaterial('tabs:foot', TB_SIDE + TB_FOOT), foot);
		const mat = ctx.sharedMaterial('tabs:run', TB_SIDE + TB_RUN, {
			tFoot: { value: null },
			tRun: { value: null },
			uInit: { value: true }
		});
		mat.uniforms.tFoot.value = foot.texture;
		let src = ctx.scratch('tabs-run:a');
		let dst = ctx.scratch('tabs-run:b');
		// Each pass at least doubles a run (less up to 0.7 px a join on a slanted side), up to the longest: once round a
		// tiling texture's width plus height, or across one that doesn't tile.
		const passes = Math.ceil(Math.log2(ctx.width + ctx.height + 1)) + 2;
		for (let k = 0; k < passes; k++) {
			mat.uniforms.tRun.value = src.texture;
			mat.uniforms.uInit.value = k === 0;
			ctx.run(mat, dst);
			[src, dst] = [dst, src];
		}
		return { foot: foot.texture, run: src.texture };
	},
	// A new layer in the editor: the defaults (a tab every ~64 px of each side, 20 × 6 px with a flat end 8 px wide, as at
	// 512) sized to the texture.
	fresh: ({ width, height }) => {
		const s = Math.min(width, height) / 512;
		return {
			spacing: halfPx(64 * s, 8),
			length: halfPx(20 * s, 4),
			depth: halfPx(6 * s, 1.5),
			clearance: halfPx(6 * s, 1),
			thickness: halfPx(2 * s, 1),
			bevel: halfPx(1.5 * s, 1)
		};
	},
	glsl: /* glsl */ `
const float TB_R2 = 0.70710678;
${TB_SIDE}

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

// How far in from a side's end an element must stay to clear a right-angled corner: the most any of its points reaches
// past the 45° line from the corner (max of v + |u|, less half its length) — 0 for a 45° tab, its depth for a square one.
float tb_clear() {
  float hl = 0.5 * u_length, d = u_depth, th = 0.5 * u_thickness;
  // (The base corners, at the edge, never reach past it: hence the max with 0.)
  float g = u_shape == 0 ? d * (1.0 - u_cut)
          : u_shape == 1 ? d - hl
          : u_shape == 2 ? max(d - hl, 0.0) + th * 1.4142
          : u_shape == 3 ? d
          : u_shape == 4 ? 0.5 * d + (hl + th) * 1.4142 - hl
          : u_shape == 6 ? sqrt(hl * hl + d * d) - hl
          : d - min(hl, 0.5 * d) * clamp(u_cut, 0.0, 1.0);
  return max(max(g, 0.0) + u_inset, 0.0);
}

// Elements on an edge of a given length: the count asked for, or one per Spacing.
float tb_count(float span) {
  return u_distribute == 1 ? max(floor(span / max(u_spacing, 1e-3) + 0.5), 1.0) : float(max(u_count, 1));
}

bool tb_edgeOn(int e) {
  // Edges: 0 sides, 1 ends, 2 all, 3 left, 4 right, 5 top, 6 bottom; e: 0 left, 1 right, 2 top, 3 bottom.
  return u_edges == 2 || (e < 2 ? u_edges == 0 : u_edges == 1) || u_edges == 3 + e;
}

GenOut gen(vec2 p) {
  int place = u_place;

  // ---- Along the mask: this pixel's element frame (u along, v in) from the nearest straight side.
  vec2 sQ = vec2(0.0), sAx = vec2(1.0, 0.0), sAy = vec2(0.0, 1.0);  // (sAx, sAy: the frame's axes on screen)
  float sPar = 0.0, sFb = 1.0;
  ivec2 sKey = ivec2(0);
  bool sOk = false;
  if (place == 3) {
    ivec2 ic = ivec2(gl_FragCoord.xy);
    vec2 fc = gl_FragCoord.xy;
    float d0 = maskIn(ic);
    vec2 g = 0.5 * vec2(maskIn(ic + ivec2(1, 0)) - maskIn(ic - ivec2(1, 0)), maskIn(ic + ivec2(0, 1)) - maskIn(ic - ivec2(0, 1)));
    if (maskEmpty(d0)) place = 0;  // nothing in the mask: the texture is the shape, its edges the edges
    else {
      // The wrapper's offset and domain warp, carried into the frame (the elements move and wobble, the sides stay).
      vec2 dl = p - fc;
      float hl = 0.5 * u_length;
      bool outward = u_side == 1;
      float v0 = outward ? d0 : -d0;
      float ext = 1.0 + length(dl) + (u_shape == 2 ? 0.5 * u_thickness : u_shape == 4 ? max(hl + 0.5 * u_thickness - 0.5 * u_depth, 0.0) : 0.0);
      float vlo = u_inset - ext, vhi = u_inset + u_depth + ext;
      sFb = max(max(vlo - v0, v0 - vhi), 1.0);
      float gl = length(g);
      vec2 n = g / max(gl, 1e-6);
      vec2 e = fc - d0 * n;
      // In the band the elements reach, on a clean gradient (not a corner's or a ridge's), whose foot is on the edge.
      bool ok = v0 >= vlo && v0 <= vhi && abs(gl - 1.0) < 0.1 && abs(sampleT(tMaskIn, e).x) < 0.25;
      // The side's class (by the way it faces) and direction: down left / right sides, rightward along top / bottom.
      int cls = abs(n.x) + 1e-3 >= abs(n.y) ? (n.x < 0.0 ? 0 : 1) : (n.y > 0.0 ? 2 : 3);
      ok = ok && tb_edgeOn(cls);
      vec2 t = tb_tan(n);
      // Its ends: where the side runs to from the edge texel at the foot (prepare), refined onto them — from just short
      // of each, 1 px steps while on the edge (more only where the passes ran short), then halving onto its end. The
      // steps fall where a walk from the foot would take them, but on the line through an edge texel's foot 3 px short
      // of the end: the side's direction (from the gradient) is slightly off, which tells far from the foot, and the end
      // itself may sit on a rounded corner's start. (Without a usable texel at the foot, all from the foot.)
      float cap = tb_cap(t);
      ivec2 cq = tb_texel(e, n);
      vec4 fq = texelFetch(t_foot, cq, 0);
      vec4 rq = texelFetch(t_run, cq, 0);
      vec2 dq = wrapDelta(fq.xy - e);
      bool known = dot(fq.zw, n) > 0.999 && abs(dot(dq, n)) < 0.1;
      if (dot(tb_tan(fq.zw), t) < 0.0) rq = rq.zwxy;
      bool endless = known && dot(rq.xy, t) >= cap;
      vec4 an = vec4(0.0);  // the two anchors, from e
      for (int k = 0; k < 2 * UNI_1; k++) {
        vec2 x = e + dq + (k == 0 ? rq.xy - 3.0 * t : rq.zw + 3.0 * t);
        vec4 fa = texelFetch(t_foot, tb_texel(x, n), 0);
        vec2 da = wrapDelta(fa.xy - x);
        // (No edge texel there, as where an acute corner's ridge comes near: the end itself.)
        vec2 aa = dot(fa.zw, n) > 0.999 && abs(dot(da, n)) < 0.1 ? x + da - e : x - e + (k == 0 ? 3.0 : -3.0) * t;
        aa = known ? aa : vec2(0.0);
        if (k == 0) an.xy = aa; else an.zw = aa;
      }
      vec2 a = an.xy;
      float sg = 1.0, lo = max(floor(dot(a, t)) - 1.0, 0.0), st = 1.0, s1 = 0.0, s0 = 0.0;
      bool refine = false, found = endless;
      for (int k = 0; k < 48 * UNI_1; k++) {
        if (!ok || found) break;
        float s = lo + st;
        if (tb_on(e + a + sg * (s - sg * dot(a, t)) * t)) lo = s; else refine = true;
        if (refine) st *= 0.5;
        if (st < 0.004) {
          if (sg < 0.0) { s0 = -lo; found = true; }
          s1 = sg > 0.0 ? lo : s1;
          a = an.zw; sg = -1.0; lo = max(floor(-dot(a, t)) - 1.0, 0.0); st = 1.0; refine = false;
        }
      }
      if (ok && found) {
        float L, a, nEl;
        if (endless) {
          // A side that runs all the way round a tiling texture: spaced like a texture edge, from the origin.
          L = cap;
          a = mod(dot(e, t), cap);
          nEl = tb_count(L);
        } else {
          L = s1 - s0;
          a = -s0;
          // (Outward, only a stroke's thickness reaches past the corner.)
          float clr = outward ? (u_shape == 2 || u_shape == 4 ? 0.5 * u_thickness : 0.0) : tb_clear();
          nEl = min(tb_count(L), floor(L / (u_length + 2.0 * (u_clearance + clr))));
        }
        if (nEl >= 1.0) {
          float sp = L / nEl;
          float tt = (a + dot(dl, t)) / sp - 0.5 - u_offset;
          float i = floor(tt + 0.5);
          i = endless ? i : clamp(i, 0.0, nEl - 1.0);
          float v = v0 + (outward ? 1.0 : -1.0) * dot(dl, n);
          sQ = vec2((tt - i) * sp, v - u_inset);
          sAx = t;
          sAy = outward ? n : -n;
          float iw = endless ? mod(i, nEl) : i;
          sPar = mod(iw, 2.0);
          // Its identity: the side (class, its line) and the element's centre (or index round an endless side), on a
          // 2 px grid offset off the half pixels geometry usually sits on, wrapped with the tile.
          vec2 c = endless ? vec2(iw, dot(e, n)) : e + ((i + 0.5 + u_offset) * sp - a) * t;
          ivec2 kc = ivec2(floor(c * 0.5 + 0.31));
          kc = wrapCell(kc, ivec2(snapCells(uRes * 0.5)));
          if (endless) kc.x = int(iw);
          sKey = ivec2(kc.x * 4 + cls, kc.y);
          sOk = true;
        }
      }
    }
  }

  // ---- One element per candidate: the four texture edges, the cells that can reach the pixel, or the mask's
  // side. Cells: a grid centred on the texture, shifted by Offset along, its step growing with Column / Row spacing (on the
  // grid; scatter keeps its cells), with copies round the torus when tiling (repGrid) — at least the neighbours
  // either side, more for elements larger than their step.
  float best = 1e4;
  float brnd = 0.5;
  // The winner's local frame for Bevel aspect: its point (before size), size, and local axes on screen.
  vec2 bQ = vec2(0.0), bAx = vec2(1.0, 0.0), bAy = vec2(0.0, 1.0);
  float bSc = 1.0;
  float top = uRes.y - p.y;
  ivec2 gn = ivec2(max(u_count, 1), max(u_rows, 1));
  vec2 cs = place == 1 ? vec2(repPitch(uRes.x, gn.x, u_col_sp, uRes.x), repPitch(uRes.y, gn.y, u_row_sp, uRes.y))
                       : uRes / vec2(gn);
  // An element's reach from its centre: a dovetail's flared top and a stroke's half thickness included.
  float ext = length(vec2(0.5 * u_length + max(-u_cut, 0.0) * u_depth, 0.5 * u_depth)) + 0.5 * u_thickness + abs(u_inset) + 2.0;
  RepGrid rg;
  int nc = place == 0 ? 4 : 1;
  if (place == 1 || place == 2) {
    vec2 reach = max(cs, vec2(ext) + (place == 2 ? 0.5 * u_jitter * cs : vec2(0.0)));
    rg = repGrid(gn, cs, 0.5 * uRes + vec2(u_offset * cs.x, 0.0), uRes, uTile, p - reach, p + reach);
    nc = repCount(rg);
  }
  for (int k = 0; k < nc; k++) {
    vec2 q = vec2(0.0);  // the element's frame, before size and mirroring
    ivec2 key = ivec2(0); // its identity, for its size, drop-out and random
    bool flip = false;   // mirrored end for end
    bool centred = false;
    bool skip = false;   // no element from this candidate (ANGLE / D3D11 can miscompile continue)
    vec2 ax = vec2(1.0, 0.0), ay = vec2(0.0, 1.0);  // the frame's u and v axes on screen (p.y up)
    if (place == 0) {
      // Texture edge k: 0 left, 1 right, 2 top, 3 bottom (p.y = 0 is the bottom of the image).
      skip = !tb_edgeOn(k);
      float along = k < 2 ? top : p.x;
      float inward = k == 0 ? p.x : k == 1 ? uRes.x - p.x : k == 2 ? top : p.y;
      float span = k < 2 ? uRes.y : uRes.x;
      float n = tb_count(span);
      float sp = span / n;
      float t = along / sp - 0.5 - u_offset;
      float i = floor(t + 0.5);
      float id = uTile ? mod(i, n) : i;
      skip = skip || (!uTile && (i < 0.0 || i > n - 1.0));
      q = vec2((t - i) * sp, inward - u_inset);
      ax = k < 2 ? vec2(0.0, -1.0) : vec2(1.0, 0.0);
      ay = k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(-1.0, 0.0) : k == 2 ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
      key = ivec2(int(id), k);
      flip = u_alternate && mod(id, 2.0) == 1.0;
    } else if (place == 3) {
      skip = !sOk;
      q = sQ;
      ax = sAx;
      ay = sAy;
      key = sKey;
      flip = u_alternate && sPar == 1.0;
    } else {
      ivec2 cw;
      vec2 ctr;
      repAt(rg, k, cw, ctr);
      flip = u_alternate && ((cw.x + cw.y) & 1) == 1;
      if (place == 2) {
        skip = hashI(cw, uSeed + 3.0) > u_density;
        ctr += (hash2I(cw, uSeed) - 0.5) * cs * u_jitter;
        flip = hashI(cw, uSeed + 7.0) > 0.5;
      }
      vec2 r = p - ctr;
      float rot = u_rotation + u_rot_jitter * (2.0 * hashI(cw, uSeed + 11.0) - 1.0);
      if (rot != 0.0) r = unrotCW(r, rot);
      q = vec2(r.x, flip ? r.y : -r.y);
      ax = rotCW(vec2(1.0, 0.0), rot);
      ay = rotCW(vec2(0.0, flip ? 1.0 : -1.0), rot);
      key = cw;
      centred = true;
    }
    // Its size (x), drop-out (y) and random (z: Height's per-feature variation).
    vec3 kh = hash3I(key, uSeed + 41.0);
    skip = skip || (place != 2 && kh.y < u_drop);
    // Size: about the element's centre on a grid, about its edge along an edge (it stays on the edge).
    float sc = 1.0 - u_size_var * kh.x;
    vec2 qs = q / sc;
    if (centred) qs.y += 0.5 * u_depth - u_inset;
    else if (flip) {
      qs.y = u_depth - qs.y;
      ay = -ay;
    }
    float d = skip ? 1e4 : tb_shape(qs) * sc;
    if (d < best) { best = d; brnd = kh.z; bQ = qs; bSc = sc; bAx = ax; bAy = ay; }
  }
  // Away from every element: a lower bound on the distance (the mask must not read 'nothing written').
  if (place == 3 && !sOk) best = sFb;
  GenOut g = genOut(1.0, 1.0, brnd, min(best, 4e3));
  // Bevel aspect: the winner's bevel measured in the stretched space, so its mitres don't step where the distance's
  // direction turns (at aspect 1 the wrapper's own bevel, unchanged).
  if (bevelAspectOn() && best < 0.0) g.bdist = tb_bevel(bQ, bAx, bAy) * bSc;
  return g;
}
`
};
