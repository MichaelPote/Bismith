// Chips & splits: damage taken out of its mask as it stands — angular chips knocked off its edges (more at corners),
// splits that run along the grain from the edges that cross it, tapering as they go, the odd split in the open and short
// nicks across the grain. Works on whatever wrote the mask (planks, bricks, panels, setts); with nothing there the
// whole texture is one piece, which only gets the splits in the open and the nicks.
//
// Every feature is a cut c (px, > 0 inside it) and a depth f (0..1). Two outputs:
//   - Carve (default): value = how much of the surface is left (1 untouched … 0 cut away to the shape's edge level),
//     covering only the damage, so Height › Multiply carves it out of the relief below and Diffuse › Multiply darkens
//     it. It is the bevel re-evaluated on the chipped shape over the bevel on the original (this layer's Bevel / Profile /
//     aspect): with those matched to the layer that drew the relief, the multiply leaves exactly that relief, its bevel
//     following every chip and split. Hairline cracks add their thin-line coverage.
//   - Chipped shape: the mask minus the cuts as an SDF; a part-depth cut sinks (1 − f) × bevel below the surface
//     instead of reaching the edge, so the wrapper's bevel gives it a floor.
// Both write the chipped shape to the mask when it writes one (genOutOwn for Carve), for later limits.

import { P, gradient, orientAxis } from '@/core/params';
import type { LayerDef } from '../types';

// Splits run along the grain, their spacing, width and wobble across it, nicks across it (for resizing the canvas:
// core/pixelScale.ts).
const grainAlong = orientAxis('grain', { vertical: 'y', horizontal: 'x' });
const grainAcross = orientAxis('grain', { vertical: 'y', horizontal: 'x' }, true);

const chipsOn = (p: Record<string, unknown>) => Number(p.chips) > 0 || Number(p.corners) > 0;
const splitsOn = (p: Record<string, unknown>) => Number(p.splits) > 0 || Number(p.interior) > 0;
const nicksOn = (p: Record<string, unknown>) => Number(p.nicks) > 0;

export const chipsLayer: LayerDef = {
	type: 'chips',
	label: 'Chips & splits',
	category: 'shape',
	kind: 'generator',
	sdf: true,
	readsMask: true,
	description:
		'Damage to a mask (the Shape mask by default): chips knocked off its edges and corners, splits along the grain from the edges that cross it, nicks across it.',
	params: [
		P.enum(
			'output',
			'Output',
			'carve',
			[
				[
					'carve',
					'Carve what is below',
					'how much of the surface is left, 1 untouched … 0 cut away, over the damage only: Height › Multiply carves it out of the relief beneath, Diffuse › Multiply darkens it. Give this layer the Bevel, Profile and Bevel aspect of the layer that drew the relief and its bevel follows every chip and split'
				],
				[
					'shape',
					'Chipped shape (SDF)',
					'the mask with the damage taken out, drawn with this layer’s bevel: build the relief from it'
				]
			],
			{
				hint: 'Both outputs put the chipped shape in the mask this layer writes (Mask › Write to), so later layers can be limited to it'
			}
		),
		P.float('chips', 'Chips', 0.35, 0, 1, {
			step: 0.001,
			section: 'Chips',
			hint: 'Chance of a chip at each spot along the edges of the mask'
		}),
		P.float('corners', 'Corners', 0.5, 0, 1, {
			step: 0.001,
			section: 'Chips',
			hint: 'Extra chance of a chip where an edge turns a corner'
		}),
		P.float('chip_size', 'Size', 5, 0.5, 256, {
			softMax: 24,
			unit: 'px',
			step: 0.05,
			section: 'Chips',
			showIf: chipsOn,
			hint: 'Chip radius; spots are about 2.5 sizes apart'
		}),
		P.float('chip_var', 'Size variation', 0.6, 0, 1, { step: 0.001, section: 'Chips', showIf: chipsOn }),
		P.float('chip_depth', 'Depth', 0.8, 0, 1, {
			step: 0.001,
			section: 'Chips',
			showIf: chipsOn,
			hint: '1: chips go down to the level of the shape’s edge; less leaves a shallow flake with a floor'
		}),
		P.enum(
			'grain',
			'Grain',
			'vertical',
			[
				['vertical', 'Vertical'],
				['horizontal', 'Horizontal']
			],
			{ group: 'splits', hint: 'Which way splits run (and nicks cross)' }
		),
		P.float('splits', 'From edges', 0.5, 0, 1, {
			step: 0.001,
			group: 'splits',
			hint: 'Chance of a split at each lane where an edge crosses the grain (board ends): it opens at the edge and runs in, tapering'
		}),
		P.float('interior', 'In the open', 0.1, 0, 1, {
			step: 0.001,
			group: 'splits',
			hint: 'Chance of a split away from the edges, tapered at both ends'
		}),
		P.float('split_len', 'Length', 48, 2, 2048, {
			softMax: 192,
			unit: 'px',
			axis: grainAlong,
			step: 0.1,
			group: 'splits',
			showIf: splitsOn,
			hint: 'Longest split (each takes 45–100 % of it)'
		}),
		P.float('split_width', 'Width', 1.5, 0.1, 32, {
			softMax: 6,
			unit: 'px',
			axis: grainAcross,
			step: 0.05,
			group: 'splits',
			showIf: splitsOn,
			hint: 'Width where a split opens (on average); it narrows to nothing along the split'
		}),
		P.float('split_width_var', 'Width jitter', 0.3, 0, 1, {
			step: 0.001,
			group: 'splits',
			showIf: (p) => splitsOn(p) || nicksOn(p),
			hint: "How much each split's (and nick's) width varies around the Width: 0 all the same, 0.3 from 0.7× to 1.3×, 1 anywhere from a hairline to twice as wide"
		}),
		P.float('split_len_var', 'Length jitter', 0.55, 0, 1, {
			step: 0.001,
			group: 'splits',
			showIf: (p) => splitsOn(p) || nicksOn(p),
			hint: 'How much shorter than the Length (or Nick length) each one may be: 0 all full length, 1 anywhere from nothing to full'
		}),
		P.float('split_bevel', 'Bevel', 1, 0, 64, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			group: 'splits',
			showIf: (p) => splitsOn(p) || nicksOn(p),
			hint: 'Width of the rounded shoulder either side of a split or nick (shaped by Shaping › Profile): 0 a hard-edged crack, more a soft groove'
		}),
		P.float('split_space', 'Spacing', 10, 1, 512, {
			softMax: 48,
			unit: 'px',
			axis: grainAcross,
			step: 0.1,
			group: 'splits',
			showIf: splitsOn,
			hint: 'Distance between neighbouring split lanes across the grain'
		}),
		P.float('split_wobble', 'Wobble', 0.75, 0, 32, {
			softMax: 4,
			unit: 'px',
			axis: grainAcross,
			step: 0.05,
			group: 'splits',
			showIf: (p) => splitsOn(p) || nicksOn(p),
			hint: 'How far splits bend across the grain: they run straight between a few knots and deflect gently at each (nicks zigzag by it too)'
		}),
		P.float('merge', 'Merging', 0.3, 0, 1, {
			step: 0.001,
			group: 'splits',
			showIf: splitsOn,
			hint: 'Chance a split from an edge veers into the split beside it and ends there, the two joining into one'
		}),
		P.float('nicks', 'Nicks', 0, 0, 1, {
			step: 0.001,
			group: 'splits',
			hint: 'Chance of a short crack across the grain at each spot (spots are 1.5 nick lengths apart)'
		}),
		P.float('nick_len', 'Nick length', 14, 1, 512, {
			softMax: 64,
			unit: 'px',
			axis: grainAcross,
			step: 0.1,
			group: 'splits',
			showIf: nicksOn
		}),
		P.float('nick_width', 'Nick width', 1.5, 0.1, 32, {
			softMax: 6,
			unit: 'px',
			axis: grainAlong,
			step: 0.05,
			group: 'splits',
			showIf: nicksOn
		}),
		P.seed()
	],
	groups: [{ id: 'splits', label: 'Splits' }],
	defaults: {
		bevel: 1.5,
		profile: 'linear',
		h_on: true,
		h_mode: 'multiply',
		h_amount: 1,
		dif_on: true,
		dif_blend: 'multiply',
		dif_grad: gradient('#3a3029', '#ffffff')
	},
	// Carve multiplies what is beneath; a chipped shape is drawn like any other shape.
	linkedDefaults: (p) =>
		p.output === 'shape'
			? { h_mode: 'add', h_amount: 0.4, dif_on: false, dif_blend: 'normal' }
			: { h_mode: 'multiply', h_amount: 1, dif_on: true, dif_blend: 'multiply' },
	glsl: /* glsl */ `
// The wrapper's offset and domain warp (gl_FragCoord − p): the mask is read where the pattern's point lies on screen,
// so the damage moves with them and stays on the mask's edges.
vec2 chDl;

// The distance of the mask it damages (the one it writes, or Shape) at a pixel; with nothing written yet the whole
// texture is inside.
float ch_reg(vec2 s) {
  float d = maskIn(ivec2(floor(s + chDl)));
  return maskEmpty(d) ? -1e4 : d;
}

// Distance and outward normal (central differences; zero where the field is flat, e.g. no shape at all).
vec3 ch_regN(vec2 s) {
  ivec2 c = ivec2(floor(s + chDl));
  float d = maskIn(c);
  vec2 g = vec2(maskIn(c + ivec2(1, 0)) - maskIn(c - ivec2(1, 0)), maskIn(c + ivec2(0, 1)) - maskIn(c - ivec2(0, 1)));
  if (maskEmpty(d)) return vec3(-1e4, 0.0, 0.0);
  return vec3(d, dot(g, g) > 1e-6 ? normalize(g) : vec2(0.0));
}

// Cells of about size px per axis over extent px, whole when tiling (x: cell size, y: cell count).
vec2 ch_cells(float extent, float size) {
  float n = max(floor(extent / max(size, 1.0) + 0.5), 1.0);
  return uTile ? vec2(extent / n, n) : vec2(max(size, 1.0), 1e6);
}
// A grid of cells of about size px over ext px (ch_cells per axis): the cell size, and the cell counts in per.
vec2 ch_grid(vec2 ext, vec2 size, out ivec2 per) {
  vec2 cx = ch_cells(ext.x, size.x), cy = ch_cells(ext.y, size.y);
  per = ivec2(cx.y, cy.y);
  return vec2(cx.x, cy.x);
}

// A split in grain-frame px (x along the grain, y across): it opens at start and runs dir · len (open: tapered at both
// ends, centred on its spot); y is its lane position before any bend.
struct ChSplit { bool ok; bool open; float start; float dir; float len; float y; float w; float rnd; };

// The split lane cell c (cw: wrapped) holds, if any. A spot whose nearest edge crosses the grain starts one where that
// edge crosses the lane, running inward; a spot inside, away from such edges, may hold one in the open.
ChSplit ch_split(ivec2 c, ivec2 cw, vec2 cs, bool vert) {
  ChSplit S = ChSplit(false, false, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
  vec4 h = vec4(hash3I(cw, uSeed + 201.0), hashI(cw, uSeed + 203.0));
  if (h.z >= max(u_splits, u_interior)) return S;
  vec2 s = (vec2(c) + vec2(h.x, 0.15 + 0.7 * h.y)) * cs;
  vec3 dn = ch_regN(vert ? s.yx : s);
  float ng = vert ? dn.z : dn.y;
  S.len = cs.x * (1.0 - u_split_len_var * h.w);
  if (abs(dn.x) < cs.x && abs(ng) > 0.75) {
    if (h.z >= u_splits) return S;
    // Where the lane meets that edge: step along the grain by the distance (sphere tracing) until on it. Exact on bent
    // and wobbly ends, where dividing by the normal's grain component overshot — into the next board.
    float u = s.x, dd = dn.x, toward = dd < 0.0 ? sign(ng) : -sign(ng);
    for (int k = 0; k < 8 * UNI_1; k++) {
      if (abs(dd) < 0.35) break;
      u += toward * abs(dd);
      float nd = ch_reg(vert ? vec2(s.y, u) : vec2(u, s.y));
      if (sign(nd) != sign(dd)) toward = -toward;
      dd = nd;
    }
    if (abs(dd) > 1.5 || abs(u - s.x) > 1.5 * cs.x) return S;
    S.start = u;
    S.dir = -sign(ng);
  } else {
    if (dn.x > -2.0 || h.z >= u_interior) return S;
    S.start = s.x - 0.5 * S.len;
    S.open = true;
  }
  S.ok = true;
  S.y = s.y;
  S.w = u_split_width * (1.0 + u_split_width_var * (2.0 * fract(h.w * 13.7) - 1.0));
  S.rnd = h.y;
  return S;
}

// A split's bend across the grain at u px along it: straight runs between knots kn.x px apart (kn.y per texture), each
// knot offset by up to the Wobble — wood splits run straight with gentle deflections.
float ch_defl(ivec2 cw, float u, vec2 kn) {
  float i = floor(u / kn.x);
  int i0 = int(i), i1 = i0 + 1;
  if (uTile) { i0 = imod(i0, int(kn.y)); i1 = imod(i1, int(kn.y)); }
  int key = cw.x * 4099 + cw.y;
  return u_split_wobble * (2.0 * mix(hashI(ivec2(i0, key), uSeed + 221.0), hashI(ivec2(i1, key), uSeed + 221.0), u / kn.x - i) - 1.0);
}

// A crack (split or nick) at x px across it, of width w, taper tau, depth f, ends px from its nearer end (r: its
// random): the distance from its side scaled so the layer's bevel spans the split Bevel (narrowing with the crack, so
// tips stay sharp) — Bevel aspect's × kSide across it and kEnd along it — and, for hairlines, its thin-line coverage (a
// pixel box filter, ≤ the width).
void ch_crack(float x, float w, float tau, float f, float ends, float kSide, float kEnd, float K, float r,
              inout float cut, inout float cutB, inout float keep, inout float rnd) {
  float ax = abs(x) - 0.5 * w;
  float sx = -ax * K / max(u_split_bevel * sqrt(tau), 0.25);
  float cc = min(sx, ends) - (1.0 - f) * K;
  if (cc > cut) { cut = cc; rnd = r; }
  cutB = max(cutB, min(sx * kSide, ends * kEnd) - (1.0 - f) * K);
  keep = min(keep, 1.0 - f * clamp(0.5 - ax, 0.0, min(w, 1.0)) * clamp(ends + 0.5, 0.0, 1.0));
}

GenOut gen(vec2 p) {
  chDl = gl_FragCoord.xy - p;
  float reg0 = ch_reg(p);
  float K = max(u_bevel, 1.0);
  float cut = -1e9;    // the furthest-reaching cut, depth applied (Chipped shape)
  float keep = 1.0;    // how much of the surface is left (Carve)
  float rnd = 0.5;
  bool vert = u_grain == 0;
  // Grain frame: x along the grain, y across (px).
  vec2 q = vert ? p.yx : p;
  vec2 ext = vert ? uRes.yx : uRes;
  // Bevel aspect: the cuts measured in the space the aspect stretches (px of Bevel), feature by feature — a chip's facets
  // by their own normals (the flake's corners mitre without the step the distance's direction makes there), a split's
  // and a nick's sides across them and their tips along them — and the furthest-reaching taken, as cut. Their floors
  // ((1 − f) × bevel) stay in bevels. Off at aspect 1: the bevel from the distance's direction, unchanged.
  bool asp = bevelAspectOn();
  float cutB = -1e9;
  // × across the grain and along it (splits run along it, nicks across).
  float kAcr = asp ? u_bevel / bevelWidth(vert ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) : 1.0;
  float kAlg = asp ? u_bevel / bevelWidth(vert ? vec2(0.0, 1.0) : vec2(1.0, 0.0)) : 1.0;
  // (No continue in the loops: ANGLE / D3D11 can miscompile it.)

  // ---- Chips: one spot per cell near the edge, moved onto it along the field's normal, a flake cut around it.
  if (u_chips > 0.0 || u_corners > 0.0) {
    ivec2 per;
    vec2 cs = ch_grid(uRes, vec2(2.5 * u_chip_size), per);
    ivec2 ip = ivec2(floor(p / cs));
    for (int e = 0; e < 9 * UNI_1; e++) {
      ivec2 c = ip + ivec2(e % 3 - 1, e / 3 - 1);
      ivec2 cw = imod(c, per);
      vec4 h = vec4(hash3I(cw, uSeed + 101.0), hashI(cw, uSeed + 103.0));
      if (h.z < u_chips + u_corners) {
        vec2 s = (vec2(c) + h.xy) * cs;
        float R = u_chip_size * (1.0 - u_chip_var * h.w);
        vec3 dn = ch_regN(s);
        if (abs(dn.x) <= R && dn.yz != vec2(0.0)) {
          // Corner: how far the distance bends beside the spot — 0 along a straight edge, ~0.4 at a right angle.
          float corner = 0.0;
          if (u_corners > 0.0) {
            vec2 tg = vec2(-dn.z, dn.y) * max(abs(dn.x), 0.4 * R);
            corner = smoothstep(0.08, 0.3, (0.5 * (ch_reg(s + tg) + ch_reg(s - tg)) - dn.x) / length(tg));
          }
          vec3 g = hash3I(cw, uSeed + 107.0);
          // Centre on the edge (a little in or out), then an angular flake: five half-planes at uneven angles, in a frame
          // stretched along the edge (flakes come off wider than they are deep).
          float off = R * (g.x - 0.35) * 0.7;
          vec2 d = p - (s - dn.x * dn.yz + dn.yz * off);
          if (h.z < u_chips + u_corners * corner && dot(d, d) <= 4.0 * R * R) {
            vec2 tg = vec2(-dn.z, dn.y);
            float st = 1.0 + 0.6 * fract(g.x * 5.3);
            d = vec2(dot(d, tg) / st, dot(d, dn.yz));
            float a0 = g.y * 6.2832;
            // Only this side of the edge: a chip doesn't reach across a gap into the neighbouring piece.
            float dc = d.y + off - 0.5;
            float dcB = asp ? bevelLine(dc, dn.yz) : dc;
            for (int k = 0; k < 5; k++) {
              float jit = fract(g.z * float(17 * k + 5));
              float a = a0 + float(k) * 1.2566 + (jit - 0.5) * 0.7;
              vec2 fn = vec2(cos(a), sin(a));
              float pl = dot(d, fn) - R * (0.6 + 0.4 * fract(jit * 7.31));
              dc = max(dc, pl);
              // (The facet's normal on screen: the stretched frame's axes back.)
              if (asp) dcB = max(dcB, bevelLine(pl, tg * (fn.x / st) + dn.yz * fn.y));
            }
            float f = u_chip_depth * (0.6 + 0.4 * fract(g.z * 31.7));
            float cc = -dc - (1.0 - f) * K;
            if (cc > cut) { cut = cc; rnd = g.x; }
            cutB = max(cutB, -dcB - (1.0 - f) * K);
          }
        }
      }
    }
  }

  // ---- Splits: lanes across the grain, one spot per lane cell (ch_split). Each runs straight between knots along the
  // grain with a gentle bend at each; some veer into the split in the next lane and end there, the two merging into one.
  if (u_splits > 0.0 || u_interior > 0.0) {
    ivec2 per;
    vec2 cs = ch_grid(ext, vec2(u_split_len, u_split_space), per);
    vec2 kn = ch_cells(ext.x, max(0.4 * u_split_len, 8.0));
    ivec2 ip = ivec2(floor(q / cs));
    for (int e = 0; e < 15 * UNI_1; e++) {
      ivec2 c = ip + ivec2(e / 3 - 2, e % 3 - 1);
      ivec2 cw = imod(c, per);
      ChSplit A = ch_split(c, cw, cs, vert);
      float t = (q.x - A.start) * A.dir;
      if (A.ok && t >= -3.0 && t <= A.len) {
        float y = A.y + ch_defl(cw, q.x, kn);
        // Merging: the split ends on its neighbour's line if that split is there where this one ends and runs close by.
        bool merged = false;
        float hm = hashI(cw, uSeed + 231.0);
        if (!A.open && hm < u_merge) {
          ivec2 cb = c + ivec2(0, hm < 0.5 * u_merge ? -1 : 1);
          ivec2 cwb = imod(cb, per);
          ChSplit B = ch_split(cb, cwb, cs, vert);
          float um = A.start + A.dir * A.len;
          float tb = (um - B.start) * B.dir;
          float gap = B.y + ch_defl(cwb, um, kn) - A.y - ch_defl(cw, um, kn);
          if (B.ok && tb > 2.0 && tb < B.len - 2.0 && abs(gap) < 0.8 * cs.y) {
            merged = true;
            y = mix(y, B.y + ch_defl(cwb, q.x, kn), smoothstep(0.3, 1.0, t / A.len));
          }
        }
        // A thin line that narrows late (a merging one only halfway: it joins the other at width), flared where it opens.
        float tau = A.open ? 1.0 - abs(2.0 * t / A.len - 1.0) : 1.0 - (merged ? 0.5 : 1.0) * max(t, 0.0) / A.len;
        float w = A.w * pow(tau, 0.3) * (A.open ? 1.0 : 1.0 + 0.6 * exp(-max(t, 0.0) / max(A.w, 1.0)));
        float ends = min(t + 3.0, A.len - t + (merged ? 2.0 : 0.0));
        ch_crack(q.y - y, w, tau, pow(tau, 0.35), ends, kAcr, kAlg, K, A.rnd, cut, cutB, keep, rnd);
      }
    }
  }

  // ---- Nicks: short cracks across the grain, inside the shape.
  if (u_nicks > 0.0) {
    ivec2 per;
    vec2 cs = ch_grid(uRes, vec2(1.5 * u_nick_len), per);
    ivec2 ip = ivec2(floor(p / cs));
    for (int e = 0; e < 9 * UNI_1; e++) {
      ivec2 c = ip + ivec2(e % 3 - 1, e / 3 - 1);
      ivec2 cw = imod(c, per);
      vec4 h = vec4(hash3I(cw, uSeed + 301.0), hashI(cw, uSeed + 303.0));
      vec2 s = (vec2(c) + h.xy) * cs;
      if (h.z < u_nicks && ch_reg(s) <= -2.0) {
        vec2 sq = vert ? s.yx : s;
        float L = u_nick_len * (1.0 - u_split_len_var * h.w);
        float t = q.y - sq.y + 0.5 * L;
        if (t >= 0.0 && t <= L) {
          float tau = 1.0 - abs(2.0 * t / L - 1.0);
          float x = q.x - sq.x - (0.3 * u_nick_width + 0.6 * u_split_wobble) * (2.0 * valueNoise1(t / 6.0 + h.w * 37.0, uSeed + 311.0) - 1.0);
          float w = u_nick_width * (1.0 + u_split_width_var * (2.0 * fract(h.w * 9.1) - 1.0)) * pow(tau, 0.3);
          ch_crack(x, w, tau, pow(tau, 0.3), min(t, L - t), kAlg, kAcr, K, h.x, cut, cutB, keep, rnd);
        }
      }
    }
  }

  float d = max(reg0, cut);
  // Screen-space gradients for Bevel aspect, taken in uniform control flow.
  vec2 g0 = vec2(dFdx(reg0), dFdy(reg0)), g1 = vec2(dFdx(d), dFdy(d));
  // Bevel aspect: the mask's own part by its direction (no geometry here to measure it by) — as the original's bevel b0
  // below, so untouched parts carve nothing — the cuts measured in the stretched space.
  float dB = asp ? max(bevelLine(reg0, g0), cutB) : d;
  // The pieces of the mask it damages keep their feature randoms in the mask it writes (fid −1: none there).
  vec2 mf = maskInFeat(ivec2(gl_FragCoord.xy));
  float fid = mf.y > 0.5 ? mf.x : -1.0;
  if (u_output == 1) {
    // The chipped shape: each piece varies by its own random.
    GenOut g = genOut(0.0, 1.0, fid, d);
    if (fid < 0.0) g = genOutSmooth(0.0, 1.0, 0.5, d);
    if (asp) g.bdist = dB;
    return g;
  }
  // Carve: the bevel on the chipped shape over the bevel on the original. Only the shape is carved: beyond its edge
  // there is nothing to take away.
  float b0 = bevelAt(reg0, g0) * coverage(reg0, u_aa);
  float b1 = (asp ? bevelPlain(dB) : bevelAt(d, g1)) * coverage(d, u_aa);
  keep = min(keep, b0 > 1e-3 ? clamp(b1 / b0, 0.0, 1.0) : 1.0);
  keep = 1.0 - (1.0 - keep) * coverage(reg0, true);
  GenOut g = genOutOwn(keep, clamp((1.0 - keep) * 64.0, 0.0, 1.0), rnd, d);
  g.fid = fid;
  return g;
}
`
};
