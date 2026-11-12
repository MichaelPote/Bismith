// Cracks (type `chips`): stone damage taken out of its mask as it stands — big breaks and worn chips off its edges, flake
// scars struck in from them, cracks and faults running in. Works on whatever wrote the mask (blocks, bricks, panels,
// setts). (Splits along wood grain are the Splits filter's: filters/splits.ts.)
//
// Every feature is a cut c (px, > 0 inside it) and a depth f (0..1). Two outputs:
//   - Carve (default): value = how deep to carve (0 untouched … 1 the whole bevel, down to the shape's edge level),
//     covering only the damage, so Height › Subtract carves it out of the relief below and Diffuse › Multiply darkens
//     it. It is the bevel on the original less the bevel re-evaluated on the chipped shape (this layer's Bevel / Profile /
//     aspect): with those and Height › Amount matched to the layer that drew the relief, the subtract leaves exactly
//     that relief, its bevel following every break and crack. Flake scars, faults and a crack's lower side carve a share
//     of the height on top; hairline cracks add their thin-line coverage.
//   - Chipped shape: the mask minus the cuts as an SDF; a part-depth cut sinks (1 − f) × bevel below the surface
//     instead of reaching the edge, so the wrapper's bevel gives it a floor.
// Both write the chipped shape to the mask when it writes one (genOutOwn for Carve), for later limits.

import { P, gradient } from '@/core/params';
import type { LayerDef } from '../types';
import { flakeScarParams, flakeScarsGlsl } from './flakeScars';

type P_ = Record<string, unknown>;
const breaksOn = (p: P_) => Number(p.stone_chips) > 0 || Number(p.stone_corners) > 0 || Number(p.stone_wear) > 0;
const scarsOn = (p: P_) => Number(p.flakes) > 0;
const scarP = flakeScarParams(
	'flake',
	{ edge: 0.9, size: [40, 1024, 160], where: 'edges', edgeOf: 'the' },
	{ group: 'flakes', showIf: scarsOn }
);
const cracksOn = (p: P_) => Number(p.cracks) > 0;
const faultsOn = (p: P_) => Number(p.faults) > 0;

export const cracksLayer: LayerDef = {
	type: 'chips',
	label: 'Cracks',
	// In the menu with the filters: it damages the shape the layers before it drew.
	category: 'filter',
	kind: 'generator',
	sdf: true,
	readsMask: true,
	description:
		'Damaged edges: Breaks, flake scars and cracks carved into the shape the layers before it drew (the Shape mask by default). Makes broken masonry, weathered blocks and slabs.',
	params: [
		P.enum(
			'output',
			'Operate on',
			'carve',
			[
				[
					'carve',
					'Height below (carve it)',
					'carves the damage out of the relief of the layers below: Height › Subtract sinks it by how deep the damage goes (0 = untouched … 1 = cut down to the shape’s edge) and Diffuse › Multiply darkens it. Give this layer the same Bevel, Profile and Bevel aspect as the layer that drew the shape, and Height › Amount the same as its height, and the carve follows its bevel into every break and crack. Flake scars and faults sink the surface, so they need this'
				],
				[
					'shape',
					'Shape mask (redraw it chipped)',
					'redraws the mask’s shape with the damage taken out, as a shape with this layer’s bevel, so you build the relief from it instead of carving the layers below (flake scars and faults don’t apply)'
				]
			],
			{
				hint: 'Picks what the damage applies to: the height of the layers below, or the shape in the mask. Either way the chipped shape goes into the mask this layer writes (Mask › Write to), so later layers can be limited to it'
			}
		),
		P.float('stone_chips', 'Breaks', 0.25, 0, 1, {
			step: 0.001,
			section: 'Chips',
			hint: 'How likely each chunk along the edges is to break off (1 = every chunk). The edge splits into jagged chunks about the Break size across, and each broken one leaves flat break faces'
		}),
		P.float('stone_corners', 'Corner breaks', 0.6, 0, 1, {
			step: 0.001,
			section: 'Chips',
			hint: 'Makes the corners break more often'
		}),
		P.float('stone_size', 'Break size', 32, 1, 1024, {
			softMax: 128,
			unit: 'px',
			step: 0.1,
			section: 'Chips',
			showIf: breaksOn,
			hint: 'Sets the size of the chunks that break off the edges'
		}),
		P.float('stone_wear', 'Edge wear', 0.4, 0, 1, {
			step: 0.001,
			section: 'Chips',
			hint: 'Adds small, shallow chips (a quarter of the Break size) along every edge, so the edges between the big breaks look worn too'
		}),
		P.float('stone_rough', 'Break roughness', 0.5, 0, 32, {
			softMax: 6,
			unit: 'px',
			step: 0.05,
			section: 'Chips',
			showIf: breaksOn,
			hint: 'Roughens the rims of the breaks (the shape’s unbroken edges stay clean)'
		}),
		P.float('stone_depth', 'Break depth', 0.85, 0, 1, {
			step: 0.001,
			section: 'Chips',
			showIf: breaksOn,
			hint: 'How deep the breaks go. Each broken chunk drops sharply at its rim (Break rim drop), then slopes down to the edge as a flat face (Break face drop)'
		}),
		P.float('stone_face', 'Break face drop', 0.75, 0, 2, {
			step: 0.001,
			section: 'Chips',
			showIf: breaksOn,
			hint: 'How far below the top a broken face ends at the edge, as a share of the Break depth (below 1 = a lit chip sitting below the top). At corners it drops further and bites into the outline'
		}),
		P.float('stone_scarp', 'Break rim drop', 0.4, 0, 1, {
			step: 0.001,
			section: 'Chips',
			showIf: breaksOn,
			hint: 'How much of the Break depth a break drops straight down at its rim, as a crisp step, before its face slopes down to the edge'
		}),
		P.float('flakes', 'Flake scars', 0.85, 0, 1, {
			step: 0.001,
			group: 'flakes',
			hint: 'How much of the surface near the edges is knocked off in flake scars: shallow bowls whose rims meet in crisp ridges, between patches of the untouched face'
		}),
		scarP.edge,
		scarP.size,
		P.float('flake_depth', 'Scar depth', 1, 0, 2, {
			softMax: 1,
			step: 0.001,
			group: 'flakes',
			showIf: scarsOn,
			hint: 'How deep the deepest scars cut, as a share of the height below. They only sink the surface; the light shows them, not the Diffuse colour'
		}),
		scarP.stretch,
		scarP.detail,
		P.float('flake_jag', 'Scar raggedness', 0.5, 0, 1, {
			step: 0.001,
			group: 'flakes',
			showIf: scarsOn,
			hint: 'Makes the scars’ rims ragged instead of clean curves (0 = smooth ellipses)'
		}),
		P.float('cracks', 'Cracks', 0.35, 0, 1, {
			step: 0.001,
			group: 'cracks',
			hint: 'How likely a crack is at each spot along the edges (spots are about a Crack length apart). Each one runs in from the edge, jagged and tapering, and sometimes branches'
		}),
		P.float('crack_len', 'Crack length', 64, 4, 2048, {
			softMax: 256,
			unit: 'px',
			step: 0.1,
			group: 'cracks',
			showIf: cracksOn,
			hint: 'Sets the length of the longest crack (each one is 60–100 % of it)'
		}),
		P.float('crack_width', 'Crack width', 1.5, 0.1, 32, {
			softMax: 6,
			unit: 'px',
			step: 0.05,
			group: 'cracks',
			showIf: (p) => cracksOn(p) || faultsOn(p),
			hint: 'Sets how wide a crack is where it opens at the edge (each one is 50–100 % of it); it narrows to nothing at the tip'
		}),
		P.float('crack_depth', 'Crack depth', 0.9, 0, 1, {
			step: 0.001,
			group: 'cracks',
			showIf: (p) => cracksOn(p) || faultsOn(p),
			hint: 'How deep the cracks go (1 = right down to the level of the shape’s edge)'
		}),
		P.float('crack_wander', 'Crack wander', 0.6, 0, 1, {
			step: 0.001,
			group: 'cracks',
			showIf: cracksOn,
			hint: 'Makes cracks meander in slow, smooth bends along their length (0 = straight)'
		}),
		P.float('crack_jag', 'Crack jaggedness', 0.4, 0, 1, {
			step: 0.001,
			group: 'cracks',
			showIf: (p) => cracksOn(p) || faultsOn(p),
			hint: 'Adds finer, quicker turns on top of the Crack wander, and roughens a fault’s line (0 = smooth curves)'
		}),
		P.float('crack_branch', 'Crack branching', 0.5, 0, 1, {
			step: 0.001,
			group: 'cracks',
			showIf: cracksOn,
			hint: 'How likely a crack is to fork a third to half of the way along (and, less often, again further on). Each fork wanders separately'
		}),
		P.float('crack_offset', 'Crack side drop', 0.08, 0, 1, {
			step: 0.001,
			group: 'cracks',
			showIf: cracksOn,
			hint: 'Drops one side of a crack lower, as a share of the height below'
		}),
		P.float('crack_bevel', 'Crack bevel', 1, 0, 64, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			group: 'cracks',
			showIf: (p) => cracksOn(p) || faultsOn(p),
			hint: 'Rounds the shoulder either side of a crack over this width, shaped by Shaping › Profile (0 = a hard-edged crack)'
		}),
		P.float('faults', 'Faults', 0.12, 0, 1, {
			step: 0.001,
			group: 'faults',
			hint: 'How likely a fault is at each spot along the edges: a straight break running in from the edge, with the slab between it and the edge dropped down'
		}),
		P.float('fault_len', 'Fault length', 64, 4, 2048, {
			softMax: 256,
			unit: 'px',
			step: 0.1,
			group: 'faults',
			showIf: faultsOn,
			hint: 'Sets the length of the longest fault (each one is 60–100 % of it)'
		}),
		P.float('fault_step', 'Fault drop', 0.4, 0, 1, {
			step: 0.001,
			group: 'faults',
			showIf: faultsOn,
			hint: 'How far the surface drops at a fault, as a share of the height below'
		}),
		P.float('fault_fall', 'Fault slab width', 24, 0, 512, {
			softMax: 128,
			unit: 'px',
			step: 0.1,
			group: 'faults',
			showIf: faultsOn,
			hint: 'Sets how wide the dropped slab is where the fault meets the edge; it narrows towards the fault’s tip'
		}),
		P.seed()
	],
	groups: [
		{ id: 'flakes', label: 'Flake scars' },
		{ id: 'cracks', label: 'Cracks' },
		{ id: 'faults', label: 'Faults' }
	],
	defaults: {
		bevel: 1.5,
		profile: 'linear',
		h_on: true,
		h_mode: 'subtract',
		h_amount: 0.5,
		dif_on: true,
		dif_blend: 'multiply',
		dif_grad: gradient('#ffffff', '#3a3029')
	},
	// Stone's sizes follow the texture (a new layer; the plain defaults at 256 px), so a 1024 px wall breaks into chunks,
	// not crumbs, and a 64 px tile's blocks aren't one chunk each.
	fresh: ({ width, height }) => {
		const k = Math.max(0.25, Math.sqrt(width * height) / 256);
		const r1 = (v: number) => Math.round(v * 10) / 10;
		return {
			stone_size: r1(32 * k),
			flake_size: r1(40 * k),
			fault_len: r1(64 * k),
			fault_fall: r1(24 * k),
			crack_len: r1(64 * k),
			crack_width: r1(1.5 * Math.sqrt(k)),
			crack_bevel: r1(Math.sqrt(k))
		};
	},
	// Carve sinks what is beneath (by the shape layers' usual height); a chipped shape is drawn like any other shape.
	linkedDefaults: (p) =>
		p.output === 'shape'
			? { h_mode: 'add', h_amount: 0.4, dif_on: false, dif_blend: 'normal' }
			: { h_mode: 'subtract', h_amount: 0.5, dif_on: true, dif_blend: 'multiply' },
	glsl: /* glsl */ `
// The wrapper's offset and domain warp (gl_FragCoord − p): the mask is read where the pattern's point lies on screen,
// so the damage moves with them and stays on the mask's edges.
vec2 chDl;
// How much of the surface the flake scars leave (1 = none there): Height only.
float chScar = 1.0;

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

// A crack at x px across it, of width w, taper tau and depth f (r: its random): the distance from its side scaled so the
// layer's bevel spans the crack's bevel bev (narrowing with the crack, so tips stay sharp) and, for hairlines, its
// thin-line coverage (a pixel box filter, ≤ the width).
void ch_crack(float x, float w, float tau, float f, float K, float r, float bev, inout float cut, inout float cutB,
              inout float keep, inout float rnd) {
  float ax = abs(x) - 0.5 * w;
  float cc = -ax * K / max(bev * sqrt(tau), 0.25) - (1.0 - f) * K;
  if (cc > cut) { cut = cc; rnd = r; }
  cutB = max(cutB, cc);
  keep = min(keep, 1.0 - f * clamp(0.5 - ax, 0.0, min(w, 1.0)));
}

// Plates: a Worley partition (x in cells). Returns the distances to the nearest two borders (cells); the nearest cell
// (c0; r0 from x to its point) and the ones across those borders (c1, r1; c2, r2) — near a corner where three cells meet,
// both neighbours, so the surfaces can blend three ways instead of jumping where the nearest border changes.
vec2 ch_plates(vec2 x, ivec2 period, float seed, out ivec2 c0, out vec2 r0, out ivec2 c1, out vec2 r1, out ivec2 c2,
               out vec2 r2) {
  ivec2 ip = ivec2(floor(x));
  vec2 fp = fract(x);
  float F1 = 1e9, md = 1e9, md2 = 1e9;
  c0 = ip; c1 = ip; c2 = ip; r0 = vec2(0.0); r1 = vec2(1.0, 0.0); r2 = vec2(0.0, 1.0);
  for (int e = 0; e < 34 * UNI_1; e++) {
    bool near = e < 9;
    int f = near ? e : e - 9;
    ivec2 g = near ? ivec2(f % 3 - 1, f / 3 - 1) : c0 - ip + ivec2(f % 5 - 2, f / 5 - 2);
    vec2 r = vec2(g) + 0.5 + (cellPoint(imod(ip + g, period), seed) - 0.5) * 0.9 - fp;
    if (near) {
      float d = dot(r, r);
      if (d < F1) { F1 = d; r0 = r; c0 = ip + g; }
    } else {
      vec2 dr = r - r0;
      if (dot(dr, dr) > 1e-6) {
        float b = dot(0.5 * (r0 + r), normalize(dr));
        if (b < md) { md2 = md; c2 = c1; r2 = r1; md = b; c1 = ip + g; r1 = r; }
        else if (b < md2) { md2 = b; c2 = ip + g; r2 = r; }
      }
    }
  }
  return vec2(md, md2);
}

// A cell of a partition (r: from the pixel to its point, cells of cpx px; dn: the mask's distance and outward normal at
// its point), judged at its point. Break cells (set 0): 1 when it breaks away — its point within half
// a cell of the mask's edge, by the Breaks chance, more where the edge turns a corner — else 0; wear cells (set 1) the
// same by the Edge wear chance. One function for both partitions, called from one loop, so D3D compiles its mask reads
// once.
float ch_cell(int set, ivec2 cw, vec2 r, vec2 cpx, vec2 p, out vec3 dn) {
  vec2 s = p + r * cpx;
  dn = ch_regN(s);
  float cell = 0.5 * length(cpx);
  float h = hashI(cw, uSeed + 407.0 + 26.0 * float(set));
  if (abs(dn.x) > 0.55 * cell || dn.yz == vec2(0.0)) return 0.0;
  if (set == 1) return h < u_stone_wear ? 1.0 : 0.0;
  float corner = 0.0;
  if (u_stone_corners > 0.0) {
    vec2 tg = vec2(-dn.z, dn.y) * cell;
    corner = smoothstep(0.08, 0.3, (0.5 * (ch_reg(s + tg) + ch_reg(s - tg)) - dn.x) / length(tg));
  }
  // Broken: 1 + how much of a corner it is (its face falls further there).
  return h < u_stone_chips + u_stone_corners * corner ? 1.0 + corner : 0.0;
}

// Flake scars (flakeScars.ts), struck from the mask's nearest edge along its outward normal (with no edge in reach,
// dn.x is −1e4: no struck scar). Steeper walls than Stone blocks' (d⁸ − 1: its d⁴ read soft here, as a share of a
// shape's height is shallower than its scars). Each piece of the mask (fid ≥ 0: its feature random) reads the field at
// an offset of its own and keeps only the scars whose site lies on it, so scars never run on across a joint.
${flakeScarsGlsl({
	name: 'ch_scarField',
	args: ', bool pieces, float fid',
	prefix: 'flake',
	amount: 'u_flakes',
	seeds: [
		[493, 491],
		[499, 497],
		[509, 503],
		[523, 521],
		[547, 541]
	],
	wall: 8,
	edge: /* glsl */ `
    vec3 dn = ch_regN(sp);
    vec2 mf = maskInFeat(ivec2(floor(sp + chDl)));
    on = dn.x < 0.0 && (!pieces || (mf.y > 0.5 && abs(mf.x - fid) < 1e-6));
    canStrike = true;
    edgeD = -dn.x;`,
	angle: 'atan(-dn.z, -dn.y)'
})}
float ch_scars(vec2 p, float fid) {
  float scs = max(u_flake_size, 2.0);
  bool pieces = fid >= 0.0;
  vec2 so = pieces ? fract(vec2(fid * 13.71, fid * 71.37 + 0.5)) * uRes : vec2(0.0);
  // Ragged rims: the field warped by noise half a big scar across (±0.1 scar at the default raggedness).
  vec2 nw = cellsFor(uRes.x / (0.5 * scs), 1.0);
  vec2 xw = p / uRes * nw;
  vec2 wp = 0.4 * u_flake_jag * scs * (fbmPair(xw, xw + 17.3, periodOf(nw), 2, uSeed + 481.0, uSeed + 483.0, 2) - 0.5);
  return ch_scarField(p, wp, so, scs, pieces, fid);
}

// Breaks, flake scars, cracks and faults. Breaks are cuts (into cut / cutB: their surface as a distance the bevel
// reads); flake scars and faults sink the surface (keep, for Carve); cracks cut their line and drop one side a little.
void ch_stone(vec2 p, float reg0, float K, float fid, inout float cut, inout float cutB, inout float keep,
              inout float rnd) {
  bool brk = u_stone_chips > 0.0 || u_stone_corners > 0.0;
  // The pixel's own corner (0 on a straight edge, 1 at a right angle): a break falls further only right at a corner.
  // (The edge's direction by central differences on the mask, not dFdx / dFdy: those are per 2 × 2 pixels, and the
  // corner fall came out in 2 × 2 steps — dotted ridges across the faces.)
  vec3 dnp = ch_regN(p);
  vec2 tgp = vec2(-dnp.z, dnp.y) * 0.4 * u_stone_size;
  float cornerPx = dnp.yz == vec2(0.0) ? 0.0 : smoothstep(0.08, 0.3, (0.5 * (ch_reg(p + tgp) + ch_reg(p - tgp)) - reg0) / length(tgp));
  // ---- Partitions, each a jagged Worley (one call site — D3D inlines every call): set 0 the break cells, set 1 the
  // edge wear (a quarter of the Break size).
  for (int s = 0; s < 2 * UNI_1; s++) {
    if (s == 0 ? brk : u_stone_wear > 0.0) {
      float size = s == 0 ? u_stone_size : 0.25 * u_stone_size;
      vec2 nc = snapCells(uRes / max(size, 1.0));
      ivec2 per = periodOf(nc);
      vec2 cpx = uRes / nc;
      float cell = 0.5 * length(cpx);
      vec2 x = p / uRes * nc;
      // A smooth, low warp (one octave at the cell scale): the borders bend, but don't crenellate or fold into islands.
      vec2 wv = 0.3 * (fbmPair(x, x + 17.3, per, 1, uSeed + 403.0 + 18.0 * float(s), uSeed + 404.0 + 18.0 * float(s), 2) - 0.5);
      x += wv;
      ivec2 c0, c1, c2;
      vec2 r0, r1, r2;
      vec2 mds = ch_plates(x, per, uSeed + 405.0 + 26.0 * float(s), c0, r0, c1, r1, c2, r2) * 0.5 * (cpx.x + cpx.y);
      float md = mds.x;
      float st[3], hk[3];
      vec3 dn[3];
      // The pixel's cell and the two across its nearest borders: broken or not, then each one's surface.
      // (r is from the warped pixel to a point: with the warp added, from the pixel itself — the same screen point for
      // every pixel of the cell, so all of them judge it alike. Without it a cell broke for some of its pixels and not
      // others: walls no blend reached, combs, specks.)
      for (int k = 0; k < 3 * UNI_1; k++) {
        ivec2 ck = k == 0 ? c0 : k == 1 ? c1 : c2;
        vec2 r = (k == 0 ? r0 : k == 1 ? r1 : r2) + wv;
        st[k] = ch_cell(s, imod(ck, per), r, cpx, p, dn[k]);
      }
      for (int k = 0; k < 3 * UNI_1; k++) {
        ivec2 ck = k == 0 ? c0 : k == 1 ? c1 : c2;
        vec2 r = (k == 0 ? r0 : k == 1 ? r1 : r2) + wv;
        // The cell's surface at the pixel: a plane, as a height (1 the top).
        vec3 hf = hash3I(imod(ck, per), uSeed + 409.0 + float(s));
        vec2 nOut = dn[k].yz == vec2(0.0) ? vec2(cos(hf.x * 6.2832), sin(hf.x * 6.2832)) : dn[k].yz;
        vec2 tg = vec2(-nOut.y, nOut.x);
        vec2 q = (p - (p + r * cpx)) / cell;          // from the cell's point, in cells
        // A broken chunk: a scarp of the Break rim drop at its rim, then a flat face sloping on to Break face drop ×
        // Break depth below the top at the mask's edge (the plane's distance to the edge along the normal at its
        // point), leaning a little — a lit chip below the top, not a hole; right at a corner it falls ×1.8 as far,
        // biting the outline. Wear chips: half as deep, each its own depth. Where it meets an intact cell (across either
        // near border) the face rises to its rim within half a cell, so that border steps by the Break rim drop only.
        float dep = u_stone_depth * (s == 1 ? 0.3 + 0.5 * hf.z : 1.0);
        float ze = -(dn[k].x + dot(p - (p + r * cpx), nOut));
        float zr = max(-dn[k].x, 0.0) + cell;
        float lo = 1.0 - u_stone_face * dep * (1.0 + 0.8 * cornerPx);
        float rim = 1.0 - u_stone_scarp * dep;
        float face = mix(lo, rim, clamp(ze / zr, 0.0, 1.0)) + 0.12 * dep * (hf.y - 0.5) * dot(q, tg);
        float mdI = min(st[1] < 0.5 ? mds.x : 1e9, st[2] < 0.5 ? mds.y : 1e9);
        if (k == 0 && mdI < 1e8) face = max(face, rim - (rim - lo) * mdI / max(0.5 * cell, 2.0));
        hk[k] = st[k] > 0.5 ? face : 1.0;
      }
      // Across each near border the surfaces meet in a crisp, anti-aliased step (Break roughness: smooth noise on it): each
      // neighbour weighs 1 on its border (the two sides' mean there) to 0 a blend width in.
      vec2 nr = nc * 3.0;
      float jit = u_stone_rough * 2.0 * (valueNoise(p / uRes * nr, periodOf(nr), uSeed + 411.0) - 0.5);
      float w1 = 1.0 - smoothstep(0.0, 1.5, mds.x + jit), w2 = 1.0 - smoothstep(0.0, 1.5, mds.y + jit);
      float hv = (hk[0] + w1 * hk[1] + w2 * hk[2]) / (1.0 + w1 + w2);
      if (st[0] > 0.5 || st[1] > 0.5 || st[2] > 0.5) {
        // As a distance: −Bevel at the top, 0 at the edge level, beyond it outside — what the bevel reads back.
        float cc = -K * hv;
        cut = max(cut, cc);
        cutB = max(cutB, cc);
      }
    }
  }
  // ---- Flake scars: they sink the surface (Carve only; a chipped shape has no surface to sink).
  if (u_flakes > 0.0 && u_output == 0) chScar = clamp(1.0 + u_flake_depth * ch_scars(p, fid), 0.0, 1.0);
  // Where a break lowered the surface (0 … 1): cracks fade there, ending at its rim instead of dashing across its face.
  float broken = smoothstep(-0.97 * K, -0.8 * K, cut);

  // ---- Cracks and faults: one spot per cell of about the longer of Crack length and Fault length, moved onto the mask's edge along its normal.
  // A crack runs in from there as a jagged line of four kinks, tapering to its tip (under a pixel wide it fades in depth
  // instead of breaking into dashes), sometimes forking halfway, one side a little lower (Crack side drop); the nearest crack is
  // cut (ch_crack, once). A fault runs straight in and the slab between it and the edge drops by the Fault drop: a triangle
  // bounded by the fault, a line converging on its tip from Fault slab width along the edge, and the edge — crisp risers, a flat
  // floor, no groove.
  if (u_cracks > 0.0 || u_faults > 0.0) {
    float Lmax = max(u_cracks > 0.0 ? u_crack_len : 0.0, u_faults > 0.0 ? u_fault_len : 0.0);
    vec2 cells = snapCells(uRes / max(Lmax, 1.0));
    ivec2 per = periodOf(cells);
    vec2 cs = uRes / cells;
    ivec2 ip = ivec2(floor(p / cs));
    float bq = 1e9;                          // the nearest crack's |x| − half its width
    float bx = 1e3, bw = 0.0, btau = 1.0, bf = 0.0, bRnd = 0.5;
    for (int e = 0; e < 9 * UNI_1; e++) {
      ivec2 c = ip + ivec2(e % 3 - 1, e / 3 - 1);
      ivec2 cw = imod(c, per);
      vec4 h = vec4(hash3I(cw, uSeed + 461.0), hashI(cw, uSeed + 463.0));
      bool isCrack = h.z < u_cracks;
      bool isFault = !isCrack && h.z < u_cracks + u_faults;
      if (isCrack || isFault) {
        vec2 s = (vec2(c) + h.xy) * cs;
        vec3 dn = ch_regN(s);
        if (abs(dn.x) < 0.5 * cs.x && dn.yz != vec2(0.0)) {
          vec2 A = s - dn.x * dn.yz;
          float ang = atan(-dn.z, -dn.y) + (fract(h.w * 7.13) - 0.5) * (isFault ? 1.4 : 0.8);
          float L = (isFault ? u_fault_len : u_crack_len) * (0.6 + 0.4 * fract(h.w * 3.7));
          float w0 = u_crack_width * (0.5 + 0.5 * fract(h.w * 11.3));
          // A crack's lower side at random; a fault's slab on the side it leans towards along the edge (the acute side).
          vec2 dir = vec2(cos(ang), sin(ang)), tg = vec2(-dn.z, dn.y);
          vec2 ts = dot(dir, tg) >= 0.0 ? tg : -tg;
          float side = isFault ? sign(dir.x * ts.y - dir.y * ts.x) : (fract(h.w * 17.9) < 0.5 ? 1.0 : -1.0);
          // Forks: the first a third to a half of the way along, the second (rarer, shorter) further on.
          bool fork1 = isCrack && fract(h.w * 23.1) < u_crack_branch;
          bool fork2 = isCrack && fract(h.w * 31.7) < 0.6 * u_crack_branch;
          int at1 = 4 + int(fract(h.w * 13.9) * 2.0), at2 = 7 + int(fract(h.w * 19.3) * 2.0);
          // Segments: a fault one. A crack's path 12 (0–11), its first fork 6 more (12–17) from vertex at1 of the path,
          // its second 4 (18–21) from vertex at2. Each segment heads along the base direction bent by a slow meander
          // (1D value noise along the path, ~a wave per 4 segments: Crack wander) and a light finer octave (Crack jaggedness) — absolute
          // headings around the base, so a crack wanders without curling back or zig-zagging.
          vec2 P0 = A, B = A, fA1 = A, fA2 = A;
          float a = ang, a1 = ang, a2 = ang;
          float tau1 = 1.0, tau2 = 1.0;   // the path's taper where each fork leaves it
          float lower = 0.0;   // this line's drop (the most any of its segments asks)
          for (int j = 0; j < 22 * UNI_1; j++) {
            int part = j < 12 ? 0 : j < 18 ? 1 : 2;
            int idx = part == 0 ? j : part == 1 ? j - 12 : j - 18;
            float nseg = part == 0 ? 12.0 : part == 1 ? 6.0 : 4.0;
            bool br = part > 0;
            if (idx == 0 && br) P0 = part == 1 ? fA1 : fA2;
            bool on = isFault ? j == 0 : (part == 0 || (part == 1 && fork1) || (part == 2 && fork2));
            if (on) {
              float segL = isFault ? L : L * (part == 0 ? 1.0 / 12.0 : part == 1 ? 0.45 / 6.0 : 0.25 / 4.0);
              // Two noises, one pair of call sites for both kinds (D3D inlines each call): a crack's meander and finer
              // octave along its path, a fault's jag on its line and on its slab's far side (along the line at the pixel).
              float key = h.w * 37.0 + float(part) * 11.3;
              float tf = isFault ? dot(p - P0, vec2(cos(a), sin(a))) / 6.0 : 0.0;
              float n1 = 2.0 * valueNoise1(isFault ? tf + h.w * 53.0 : float(idx) / 4.0 + key, uSeed + (isFault ? 467.0 : 471.0)) - 1.0;
              float n2 = 2.0 * valueNoise1(isFault ? tf + h.w * 71.0 : float(idx) + key * 1.7, uSeed + (isFault ? 469.0 : 473.0)) - 1.0;
              if (!isFault) {
                // The fork leaves at 0.5–0.9 rad to either side of where the path was heading.
                float base = part == 0 ? ang : (part == 1 ? a1 : a2) + (fract(key * 3.1) < 0.5 ? 1.0 : -1.0) * (0.5 + 0.4 * fract(key * 7.7));
                // (At most ±0.9 rad on the path, ±0.55 on a fork: more doubles a crack back into a V, or a fork into its parent.)
                a = base + (br ? 0.55 : 0.9) * u_crack_wander * n1 + 0.35 * u_crack_jag * n2;
              }
              B = P0 + segL * vec2(cos(a), sin(a));
              vec2 v = B - P0;
              float tt = dot(p - P0, v) / dot(v, v);
              float tc = clamp(tt, 0.0, 1.0);
              float ss = side * (v.x * (p - P0).y - v.y * (p - P0).x) / length(v);   // across the line, + the lower side
              if (isFault) {
                // Jagged like a crack (and its far side too); each slab its own Fault drop (0.6–1.4×), deepest at the edge.
                float jag = (0.5 * u_crack_width + 0.04 * L) * u_crack_jag;
                ss += jag * n1;
                float W = max(u_fault_fall, 1.0) * (1.0 - tt) + jag * n2;
                float slab = smoothstep(-0.75, 0.75, ss) * smoothstep(0.75, -0.75, ss - W) * smoothstep(-0.3, 0.0, tt);
                lower = max(lower, u_fault_step * (0.6 + 0.8 * fract(h.w * 41.7)) * (1.0 - 0.4 * tc) * slab);
              } else {
                // The taper: the path 1 at its start … 0 at its tip; a fork from the path's taper where it leaves to 0.
                float along = (float(idx) + tc) / nseg;
                float tau = (part == 0 ? 1.0 : part == 1 ? tau1 : tau2) * (1.0 - along);
                float wr = w0 * sqrt(max(tau, 0.0)) * (br ? 0.8 : 1.0);
                float w = max(wr, 1.0);
                float x = length(p - P0 - v * tc);
                float q = x - 0.5 * w;
                if (q < bq) { bq = q; bx = x; bw = w; btau = max(tau, 1e-3); bf = u_crack_depth * pow(max(tau, 0.0), 0.35) * min(wr, 1.0) * (1.0 - broken); bRnd = h.x; }
                float fall = 3.0 * w0 + 2.0;
                float amt = u_crack_offset * tau * smoothstep(-0.25, 0.0, tt) * step(tt, 1.0);
                lower = max(lower, amt * smoothstep(-0.5, 0.5, ss) * (1.0 - smoothstep(0.6 * fall, fall, ss)));
              }
              if (part == 0 && idx == at1 - 1) { fA1 = B; a1 = a; tau1 = 1.0 - float(at1) / 12.0; }
              if (part == 0 && idx == at2 - 1) { fA2 = B; a2 = a; tau2 = 1.0 - float(at2) / 12.0; }
              P0 = B;
            }
          }
          keep *= 1.0 - lower;
        }
      }
    }
    // (The shoulder keeps at least 0.4 of its width at the tip, where the depth fades instead: a shoulder narrower than a
    // pixel aliases into dots.)
    if (bw > 0.0) ch_crack(bx, bw, max(btau, 0.4), bf, K, bRnd, u_crack_bevel, cut, cutB, keep, rnd);
  }
}

GenOut gen(vec2 p) {
  chDl = gl_FragCoord.xy - p;
  float reg0 = ch_reg(p);
  // The piece of the mask it damages (its feature random; −1: none there). The pieces keep their randoms in the mask it
  // writes, and the flake scars keep to the piece they lie on.
  vec2 mf = maskInFeat(ivec2(gl_FragCoord.xy));
  float fid = mf.y > 0.5 ? mf.x : -1.0;
  float K = max(u_bevel, 1.0);
  float cut = -1e9;    // the furthest-reaching cut, depth applied (Chipped shape)
  float keep = 1.0;    // how much of the surface is left (Carve)
  float rnd = 0.5;
  // Bevel aspect: the cuts measured in the space the aspect stretches (px of Bevel) — cutB, the furthest-reaching. Off
  // at aspect 1: the bevel from the distance's direction, unchanged.
  bool asp = bevelAspectOn();
  float cutB = -1e9;
  // (No continue in the loops: ANGLE / D3D11 can miscompile it.)
  ch_stone(p, reg0, K, fid, cut, cutB, keep, rnd);

  float d = max(reg0, cut);
  // Screen-space gradients for Bevel aspect, taken in uniform control flow.
  vec2 g0 = vec2(dFdx(reg0), dFdy(reg0)), g1 = vec2(dFdx(d), dFdy(d));
  // Bevel aspect: the mask's own part by its direction (no geometry here to measure it by) — as the original's bevel b0
  // below, so untouched parts carve nothing — the cuts measured in the stretched space.
  float dB = asp ? max(bevelLine(reg0, g0), cutB) : d;
  if (u_output == 1) {
    // The chipped shape: each piece varies by its own random.
    GenOut g = genOut(0.0, 1.0, fid, d);
    if (fid < 0.0) g = genOutSmooth(0.0, 1.0, 0.5, d);
    if (asp) g.bdist = dB;
    return g;
  }
  // Carve: the bevel on the original less what is left of it — the bevel on the chipped shape, sunk by the faults and
  // cracks (keep) — as a share of the shape's height, for Height › Subtract. Only the shape is carved: beyond its edge
  // there is nothing to take away. The flake scars sink it further in Height's value (hval) alone, so Diffuse › Multiply
  // darkens the breaks and cracks but leaves the scars to the light.
  float b0 = bevelAt(reg0, g0) * coverage(reg0, u_aa);
  float b1 = (asp ? bevelPlain(dB) : bevelAt(d, g1)) * coverage(d, u_aa);
  float depth = clamp(b0 - min(b0 * keep, b1), 0.0, 1.0);
  float hDepth = clamp(b0 - min(b0 * keep * chScar, b1), 0.0, 1.0);
  GenOut g = genOutOwn(depth, clamp(hDepth * 64.0, 0.0, 1.0), rnd, d);
  g.hval = hDepth;
  g.fid = fid;
  return g;
}
`
};
