// Bismuth: hopper crystals as grown in a crucible and seen from above — faces sunk in stair-stepped terraces that spiral,
// hook and dead-end as real hoppers do, crystals shingled over one another with daughters on their corners (or cubes
// standing on a corner, three faces each sunk in its own stair steps), all coloured by the thin film of oxide on them.
//
// Crystals sit one per cell of a grid (Crystals across), scattered, sized, turned and leaning a little each, a few
// generations deep: each generation has cells half the size of the last, is sparser (Small crystals) and lower (Small
// crystal height). A large crystal may grow daughters out of its corners (Daughters: one on the tip corner — the one the
// Stack direction points to — or a mirrored pair on the two beside it, Pairs; Daughter size; Daughter depth: each on the
// same corner of the last), in front and a step taller; Core stands smaller crystals up out of the middle.
//
// Two passes. The first, one flat loop over the generations × the cells round the pixel × each crystal's chain (the
// crystal, its cores, its daughters — the pixel follows the daughter on the corner nearest it), computes only the
// outline, coverage and depth key of each, keeping the front two: larger generations in front, then along the Stack
// direction (Stacking: crystals shingle one way, so most show two or three sides as chevrons) or else by height, a
// core or daughter in front of its crystal. The second draws the facets of those two only, the front over the one
// behind by its coverage.
//
// A crystal is a square (Habit › Hopper squares) or a cube standing on its corner (Habit › Cube corners: a hexagon
// whose three rhombic faces slope away from the corner, as an isometric cube looks). Each face is one of the templates
// grown on the CPU by rules (bismuthGrowth.ts: a path through a grid of cells, a terrace wide, whose straight runs — the
// facets — each step a level lower; walls where the path doesn't join), picked by the face's hash and read in its
// frame: the cell's height stepping to joined neighbours over the softness, ribs on the walls and posts where walls
// meet, a little over the higher floor beside them, more round the rim (Rim ridge).
//
// The value is the oxide's thickness — by crystal, facet, face, sub-crystal, a sweep across the crystal and mottling —
// walked along the ramp from its second stop and back (the first stop is the bare ground), so any ramp stays seamless;
// Band contrast shades each facet by its depth (gGenShade) without moving the hue, and
// where two crystals meet in a pixel their colours mix (gGenAlt). Height (hval) is the crystal's own height. The
// crystals' union goes to the mask it writes (Mask › Write to), with each crystal's random.

import { P, gradient, round1, type ParamValues } from '@/core/params';
import type { LayerDef } from '../types';
import { FACE_TEMPLATES, faceTexture } from './bismuthGrowth';

const isCube = (p: Record<string, unknown>) => p.habit === 'cube';
const hasDaughters = (p: Record<string, unknown>) => Number(p.daughters) > 0;
const num = (p: ParamValues, key: string) => Number(p[key] ?? bismuthLayer.params.find((d) => d.key === key)!.default);

export const bismuthLayer: LayerDef = {
	type: 'bismuth',
	label: 'Bismuth',
	category: 'pattern',
	kind: 'generator',
	description:
		'Bismuth hopper crystals: ribbed terraces stepping down to an off-centre hollow with a square whorl, crystals shingled over one another with daughters on their corners (or isometric cube corners), iridescent oxide colours. Tileable.',
	params: [
		P.enum(
			'habit',
			'Habit',
			'square',
			[
				['square', 'Hopper squares', 'square frames seen from above, stepping down to a hollow'],
				[
					'cube',
					'Cube corners',
					'cubes standing on a corner, as an isometric drawing shows them: a hexagon of three rhombic faces sloping away from the corner, ringed by hexagonal terraces'
				]
			],
			{ hint: 'The shape each crystal grows in' }
		),
		P.float('scale', 'Crystals across', 3, 0.5, 32, {
			softMax: 12,
			step: 0.01,
			section: 'Crystals',
			hint: 'Large crystals across the width (whole counts when tiling); 1 with Scatter 0 puts one in the middle'
		}),
		P.float('size', 'Size', 1.05, 0.1, 2, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Crystal width as a share of its cell: below 1 leaves room between them, above 1 they grow into one another'
		}),
		P.float('size_var', 'Size variation', 0.35, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Each crystal its own size: 1 = from half to twice the Size'
		}),
		P.float('scatter', 'Scatter', 0.75, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'How far a crystal may sit from the middle of its cell, as a share of the cell: 0 = a strict grid'
		}),
		P.float('angle', 'Rotation', 0, -180, 180, {
			unit: '°',
			step: 0.1,
			section: 'Crystals',
			hint: 'Turn of every crystal, clockwise'
		}),
		P.float('angle_var', 'Rotation variation', 0.08, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Each crystal turned its own way (1 = any way at all): bismuth grown in one melt mostly lines up'
		}),
		P.float('stack', 'Stacking', 0.7, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'How much the crystals shingle one way — each in front of its neighbours behind it along the Stack direction — so most show two or three sides, as chevrons; 0 = the taller in front'
		}),
		P.float('stack_angle', 'Stack direction', 90, -180, 180, {
			unit: '°',
			step: 0.1,
			section: 'Crystals',
			hint: 'The corner the crystals shingle towards and grow their tip daughter on, measured in the crystal from its right side anticlockwise (snapped to a corner: a square’s nearest diagonal, a cube’s nearest point). It is also the crystal’s mirror axis'
		}),
		P.float('rise_var', 'Height variation', 0.4, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Each crystal its own height: 1 = from nothing to full'
		}),
		P.float('lean', 'Lean', 0.4, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Each crystal tilted its own way (1 = a quarter of its height across it), so its terraces catch the light differently from its neighbours’'
		}),
		P.float('daughters', 'Daughters', 0.8, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Share of the large crystals that grow daughter crystals out of their corners, in front and a step taller: one on the tip corner, or a mirrored pair (Pairs). 0 = none'
		}),
		P.float('pairs', 'Pairs', 0.5, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			showIf: hasDaughters,
			hint: 'Share of those that grow a mirrored pair on the two corners beside the tip, instead of one on the tip'
		}),
		P.float('daughter', 'Daughter size', 0.55, 0.1, 0.9, {
			step: 0.001,
			section: 'Crystals',
			showIf: hasDaughters,
			hint: 'A daughter’s size as a share of the crystal it grew from'
		}),
		P.int('daughter_depth', 'Daughter depth', 2, 1, 3, {
			section: 'Crystals',
			showIf: hasDaughters,
			hint: 'Daughters on the daughters, each on the same corner of the last: a spike of crystals along the diagonal'
		}),
		P.float('core', 'Core', 0, 0, 0.8, {
			step: 0.001,
			section: 'Crystals',
			hint: 'A smaller crystal standing up out of the middle of each one, this share of its size (in front of a cube’s corner). 0 = none'
		}),
		P.int('cores', 'Core stack', 1, 1, 3, {
			section: 'Crystals',
			showIf: (p) => Number(p.core) > 0,
			hint: 'Cores within cores: each in the last, Core times its size'
		}),
		P.int('gens', 'Generations', 3, 1, 4, {
			section: 'Crystals',
			hint: 'Sizes of crystal: each generation half the size of the last, filling the gaps between the bigger ones'
		}),
		P.float('fill', 'Small crystals', 0.7, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			showIf: (p) => Number(p.gens) > 1,
			hint: 'Share of the cells of the smaller generations that grow a crystal'
		}),
		P.float('gen_h', 'Small crystal height', 0.6, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			showIf: (p) => Number(p.gens) > 1,
			hint: 'Height of each smaller generation relative to the one before'
		}),
		P.bool('ground', 'Ground', true, {
			section: 'Crystals',
			hint: 'Cover the ground between the crystals (bare metal at height 0); off, only the crystals cover and the layers below show between them'
		}),
		P.int('terraces', 'Terraces', 10, 2, 24, {
			section: 'Terraces',
			hint: 'Terraces from a crystal’s rim to its hollow, whatever its size: each face is grown as a path through a grid twice this many cells across'
		}),
		P.float('depth', 'Hopper depth', 0.7, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			hint: 'How far the terraces step down to the hollow, as a share of the crystal’s height: 0 = flat-topped crystals'
		}),
		P.float('turns', 'Turns', 0.03, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			// Read by the growth on the CPU only.
			uniform: false,
			hint: 'How readily a growing terrace leaves its ring (inward mostly, at a third of that outward) instead of running on along it: the hooks, Greek keys and dead ends. 0 = closed frames spiralling in'
		}),
		P.float('branch', 'Branching', 0.02, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			// Read by the growth on the CPU only.
			uniform: false,
			hint: 'How often growth branches off an earlier terrace rather than going on from the newest: more, shorter facets'
		}),
		P.float('hollow', 'Hollow offset', 0.2, 0, 0.6, {
			step: 0.001,
			section: 'Terraces',
			// Read by the growth on the CPU only.
			uniform: false,
			hint: 'How far the rings’ centre sits off the middle along a diagonal (as a share of the half-width), so the terraces run wide on one side and close on the other'
		}),
		P.float('rib', 'Rib width', 0.25, 0.05, 0.9, {
			step: 0.001,
			section: 'Terraces',
			hint: 'Each wall between terraces stands as a raised rib over the floors on either side: its share of a terrace'
		}),
		P.float('ridge', 'Rim ridge', 1, 0, 4, {
			softMax: 2,
			step: 0.001,
			section: 'Terraces',
			hint: 'Extra height on the ribs round each face’s rim, in steps: a cube’s three edges from its corner stand out as bright ridges'
		}),
		P.float('soft', 'Step softness', 1, 0.05, 16, {
			softMax: 4,
			unit: 'px',
			step: 0.05,
			section: 'Terraces',
			hint: 'Width of each step’s rise and of the crystals’ outer walls: about 1 px is crisp but anti-aliased'
		}),
		P.float('slope', 'Face slope', 0.6, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			showIf: isCube,
			hint: 'How far each face of a cube falls away from its corner: 1 = the full drop of a cube seen on its corner, 0 = a flat hexagon'
		}),
		P.float('col_ofs', 'Colour offset', 0, 0, 2, {
			step: 0.001,
			section: 'Colour',
			hint: 'Moves every crystal along the ramp (and back: 1 = its far end, 2 = round to the start). The crystals use the ramp from its second stop on; the first is the bare ground'
		}),
		P.float('col_var', 'Colour per crystal', 1, 0, 2, {
			step: 0.001,
			section: 'Colour',
			hint: 'Each crystal starts at its own place on the ramp (1 = anywhere along it, going either way, so every colour is as likely whatever the other shifts add): a gold crystal beside a blue one'
		}),
		P.float('contrast', 'Band contrast', 0.8, 0, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'Each facet darker the deeper it lies, as the height map shows it: solid steps of shade down the hopper. 0 = flat colour'
		}),
		P.float('col_step', 'Colour per terrace', 0.03, -1, 1, {
			softMin: -0.25,
			softMax: 0.25,
			step: 0.001,
			section: 'Colour',
			hint: 'How far along the ramp each lap of the terraces moves from the next (1 = the whole ramp): the oxide is thicker on the older, outer steps; below 0 the hollows are further along'
		}),
		P.float('band', 'Terrace colours', 0.4, 0, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'Each facet shifted along the ramp by its own random amount (1 = up to half the ramp either way), so the colour changes at the steps'
		}),
		P.float('sweep', 'Colour sweep', 0.5, 0, 4, {
			softMax: 2,
			step: 0.001,
			section: 'Colour',
			hint: 'How far along the ramp the colour runs across a large crystal (smaller ones in proportion), as the oxide thickens from one side'
		}),
		P.float('sweep_angle', 'Sweep direction', 0, -180, 180, {
			unit: '°',
			step: 0.1,
			section: 'Colour',
			showIf: (p) => Number(p.sweep) > 0,
			hint: 'The way the colour sweep runs, clockwise from left to right'
		}),
		P.float('face_col', 'Colour per face', 0.25, 0, 1, {
			step: 0.001,
			section: 'Colour',
			showIf: isCube,
			hint: 'How far along the ramp each of a cube’s three faces moves from the next, going round from the right face to the top and the left'
		}),
		P.float('sub_col', 'Sub-crystal colour', 0.3, -1, 1, {
			step: 0.001,
			section: 'Colour',
			showIf: (p) => Number(p.core) > 0 || Number(p.daughters) > 0,
			hint: 'How far along the ramp each core and daughter moves from the crystal it grew from'
		}),
		P.float('mottle', 'Mottling', 0.12, 0, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'Colour drifting across the crystals in soft patches, as the oxide grew unevenly'
		}),
		P.seed()
	],
	// The crystals' union goes to a mask (opt-in); the generator shapes its own value.
	sdf: 'mask',
	// Anti-alias only matters where the crystals alone cover.
	sdfShowIf: (p, key) => key !== 'aa' || p.ground === false,
	defaults: {
		mk_target: '',
		h_on: true,
		h_amount: 4,
		dif_on: true,
		// Dark bare metal (the ground: the crystals use the rest), then the thin-film oxide colours in the order they grow
		// on bismuth — fiery gold, pink, violet, blue, cyan, mint and the second-order yellow — bright and only moderately
		// saturated, as polished metal is (Band contrast darkens them into the recesses).
		dif_grad: gradient('#3a3542', '#ffa848', '#ff70b8', '#a87cff', '#5a86ff', '#48d8ea', '#9ae890', '#ffe066'),
		r_on: true,
		r_src: 'flat',
		r_b: 0.2,
		mt_on: true,
		mt_src: 'flat'
	},
	// Added in the editor: fewer terraces on small textures (each at least about 4 px wide on a large crystal), fewer
	// generations on small textures (where the smallest crystals would be a pixel or two), crystals about 8 px tall at
	// 512 px (lower on small textures, so their walls don't shadow whole crystals) and gentler mottling there (a crystal
	// of few terraces would carry its patches as smears).
	fresh: ({ width, height }) => {
		const side = Math.sqrt(width * height);
		return {
			terraces: Math.round(Math.min(10, Math.max(4, side / 52))),
			gens: side >= 384 ? 3 : side >= 128 ? 2 : 1,
			scale: side >= 192 ? 3 : 2,
			h_amount: round1(4 * Math.sqrt(Math.min(1, side / 512))),
			mottle: side >= 256 ? 0.12 : 0.06
		};
	},
	textures: ['facets'],
	// The faces' facets, grown by the rules (bismuthGrowth.ts), FACE_TEMPLATES of them side by side.
	cpuData: (p, ctx) => ({
		facets: faceTexture(2 * num(p, 'terraces'), num(p, 'turns'), num(p, 'branch'), num(p, 'hollow'), ctx.seed)
	}),
	glsl: /* glsl */ `
// Pointy-topped hexagon of circumradius r (IQ's hexagon, x and y swapped so it stands on a point).
float bsHex(vec2 p, float r) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.5773503);
  p = abs(p.yx);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  float ap = 0.8660254 * r;
  p -= vec2(clamp(p.x, -k.z * ap, k.z * ap), ap);
  return length(p) * sign(p.y);
}

// x to a whole power n ≥ 0 (GLSL's pow is undefined for 0⁰).
float bsPow(float x, int n) { return n == 0 ? 1.0 : pow(x, float(n)); }

// The oxide's thickness along the ramp and back.
float bsRamp(float t) { return 1.0 - abs(1.0 - 2.0 * fract(0.5 * t)); }

GenOut gen(vec2 p) {
  bool cube = u_habit == 1;
  int ns = cube ? 6 : 4;
  float nsf = float(ns);
  vec2 cells0 = cellsFor(u_scale, 1.0);
  float soft = max(u_soft, 0.05);
  int G = clamp(u_gens, 1, 4);
  int nC = u_core > 0.0 ? clamp(u_cores, 1, 3) : 0;
  int nD = u_daughters > 0.0 ? clamp(u_daughter_depth, 1, 3) : 0;
  float rho = clamp(u_daughter, 0.1, 0.9);

  // The crystal's frame: its tip (a square's corner on the Stack direction, a cube's point), the pair of corners beside
  // it, its mirror axis and the side index that mirrors side j (mIdx − j, the sides' normals j·360°/ns apart).
  float sa = radians(u_stack_angle);
  float tipA = cube ? radians(30.0 + 60.0 * floor((u_stack_angle - 30.0) / 60.0 + 0.5)) : 0.0;
  vec2 tip = cube ? vec2(cos(tipA), sin(tipA)) : vec2(cos(sa) >= 0.0 ? 1.0 : -1.0, sin(sa) >= 0.0 ? 1.0 : -1.0);
  vec2 pairA = cube ? rot2(radians(120.0)) * tip : vec2(tip.x, -tip.y);
  vec2 pairB = cube ? rot2(radians(-120.0)) * tip : vec2(-tip.x, tip.y);
  vec2 axis = normalize(tip);
  int mIdx = int(floor(2.0 * mod(degrees(atan(axis.y, axis.x)), 360.0) / (360.0 / nsf) + 0.5));
  vec2 sdirS = rotCW(axis, u_angle);

  // Heights: a core stands up out of its crystal's hollow (in front of a cube's corner), a daughter a step over the
  // crystal it grew from; scaled so the tallest chain is at most 1.
  float coreH = 1.0 + 0.5 * u_core;
  float dauH = 1.08;
  float norm = 1.0 / max(bsPow(coreH, nC), bsPow(dauH, nD));

  // Per generation: the cells a crystal reaches from (its half-diagonal at the largest size, its daughters' reach on the
  // largest generation, its scatter, and room for the mask's distance out to the bevel) and the chain's length.
  float rmax = 0.5 * u_size * exp2(u_size_var) * (cube ? 1.0 : 1.4143);
  float extD = nD > 0 ? 1.0 + (0.85 + rho) * (1.0 - bsPow(rho, nD)) / (1.0 - rho) : 1.0;
  int KRg[4];
  int Lg[4];
  int cnt[4];
  int total = 0;
  for (int g = 0; g < 4; g++) {
    vec2 cpx = uRes / (cells0 * exp2(float(g)));
    float reach = rmax * (g == 0 ? extD : 1.0) + 0.5 * u_scatter + (u_bevel + soft + 1.0) / min(cpx.x, cpx.y);
    KRg[g] = clamp(int(floor(reach + 0.5)), 1, 3);
    Lg[g] = 1 + nC + (g == 0 ? nD : 0);
    cnt[g] = g < G ? (2 * KRg[g] + 1) * (2 * KRg[g] + 1) * Lg[g] : 0;
    total += cnt[g];
  }

  // Pass 1: the front two crystals (by depth key) with their frames — A (q, R, the crystal's radius), B (offset from the
  // crystal's centre, generation, chain level), C (colour random, feature random, height), cell key, coverage.
  float k1 = -1e9, k2 = -1e9;
  vec4 A[2], B[2], C[2];
  ivec2 K[2];
  float cv[2];
  for (int i = 0; i < 2; i++) { A[i] = vec4(0.0, 0.0, 1.0, 1.0); B[i] = vec4(0.0); C[i] = vec4(0.0); K[i] = ivec2(0); cv[i] = 0.0; }
  float sdU = 1e4;
  // The chain's current crystal: centre in the crystal's frame, radius, and the daughters' corner (carried from one level
  // to the next).
  vec2 cl = vec2(0.0);
  float cR = 1.0;
  vec2 dc = tip;
  // (No continue in this loop: ANGLE / D3D11 can miscompile it.)
  for (int e = 0; e < total; e++) {
    int g = 0;
    int r = e;
    if (r >= cnt[0]) { r -= cnt[0]; g = 1; if (r >= cnt[1]) { r -= cnt[1]; g = 2; if (r >= cnt[2]) { r -= cnt[2]; g = 3; } } }
    int L = Lg[g];
    int KR = KRg[g];
    int side = 2 * KR + 1;
    int lvl = r % L;
    int o = r / L;
    vec2 cells = cells0 * exp2(float(g));
    vec2 cpx = uRes / cells;
    ivec2 cell = ivec2(floor(p / cpx)) + ivec2(o % side, o / side) - KR;
    ivec2 key = wrapCell(cell, ivec2(cells + 0.5));
    float sg = uSeed + float(g) * 101.0;
    vec4 hA = vec4(hash2I(key, sg), hash2I(key, sg + 7.0));
    vec4 hB = vec4(hash2I(key, sg + 13.0), hash2I(key, sg + 19.0));
    vec4 hC = vec4(hash2I(key, sg + 31.0), hash2I(key, sg + 37.0));
    bool isD = lvl > nC;
    // Daughters: none, one on the tip, or a mirrored pair.
    int dmode = hC.z < u_daughters ? (hC.w < u_pairs ? 2 : 1) : 0;
    if ((g == 0 || hA.x < u_fill) && (!isD || dmode > 0)) {
      vec2 ctr = (vec2(cell) + 0.5 + (hA.yz - 0.5) * u_scatter) * cpx;
      float Rc = 0.5 * u_size * min(cpx.x, cpx.y) * exp2(u_size_var * (2.0 * hA.w - 1.0));
      vec2 d = p - ctr;
      vec2 qc = unrotCW(d, u_angle + u_angle_var * (hB.x - 0.5) * (cube ? 120.0 : 90.0));
      // The chain: cores in the middle, each in the last; a daughter on the corner of the last (the crystal, for the
      // first: the tip, or the nearer of the pair), each further one on the same corner.
      if (lvl == 0 || lvl == nC + 1) { cl = vec2(0.0); cR = Rc; }
      if (lvl > 0 && !isD) cR = Rc * bsPow(u_core, lvl);
      if (isD) {
        if (lvl == nC + 1) dc = dmode == 1 ? tip : (dot(qc, pairA - pairB) > 0.0 ? pairA : pairB);
        cl += 0.85 * cR * dc;
        cR *= rho;
      }
      vec2 q = qc - cl;
      float ds = cube ? bsHex(q, cR) : sdBox(q, vec2(cR));
      sdU = min(sdU, ds);
      // The outer wall falls over half as much again as a step's rise: a cliff of the crystal's whole height.
      float cov = smoothstep(0.0, 1.0, clamp(0.5 - ds / (1.5 * soft), 0.0, 1.0));
      if (cov > 0.0) {
        float base = (1.0 - u_rise_var * hB.z) * bsPow(u_gen_h, g) * (1.0 - u_h_var * featVar(hB.w)) * norm;
        float kd = float(G - g) * 8.0 + u_stack * dot(ctr - p, sdirS) / min(cpx.x, cpx.y) + (1.0 - u_stack) * base
                 + 1e-3 * float(lvl);
        vec4 a = vec4(q, cR, Rc), b = vec4(d, float(g), float(lvl)), cc = vec4(hB.y, hB.w, base, 0.0);
        if (kd > k1) {
          k2 = k1; A[1] = A[0]; B[1] = B[0]; C[1] = C[0]; K[1] = K[0]; cv[1] = cv[0];
          k1 = kd; A[0] = a; B[0] = b; C[0] = cc; K[0] = key; cv[0] = cov;
        } else if (kd > k2) { k2 = kd; A[1] = a; B[1] = b; C[1] = cc; K[1] = key; cv[1] = cov; }
      }
    }
  }

  // Pass 2: the facets of the front crystal and the one behind it — height, ramp position, shade.
  float R0 = 0.5 * u_size * min(uRes.x / cells0.x, uRes.y / cells0.y);
  vec2 sdir = rotCW(vec2(1.0, 0.0), u_sweep_angle);
  vec2 nc = cells0 * 3.0;
  float mot = u_mottle * (fbm(p / uRes * nc, periodOf(nc), 3, uSeed + 5.0) - 0.5);
  int tn = 2 * u_terraces;
  float ribW = 0.5 * u_rib;
  float Hs[2], Ts[2], Ss[2];
  for (int i = 0; i < 2 * UNI_1; i++) {
    Hs[i] = 0.0; Ts[i] = 0.0; Ss[i] = 1.0;
    if ((i == 0 ? k1 : k2) > -1e8) {
      vec2 q = A[i].xy;
      float R = A[i].z, Rc = A[i].w;
      vec2 d = B[i].xy;
      int g = int(B[i].z), lvl = int(B[i].w);
      bool isD = lvl > nC;
      int sub = isD ? lvl - nC : lvl;
      ivec2 key = K[i];
      float sg = uSeed + float(g) * 101.0;
      int hk = key.x * 64 + lvl * 8;
      // The face and its frame uv (0..1): a square crystal is one face; a cube's three rhombi (right, top, left,
      // anticlockwise from its bottom point) are each turned to the top one, whose edges run from the corner at 30° and
      // 150°, and measured along them — with its fall from the corner and its colour shift blended into the neighbours'
      // over a pixel either side of the edges between them (r sin of the angle from each edge).
      float ang = atan(q.y, q.x);
      float am = mod(degrees(ang) + 90.0, 360.0);
      float face = cube ? floor(am / 120.0) : 0.0;
      am -= 120.0 * face;
      vec2 qf = rot2(-radians(120.0 * face - 120.0)) * q;
      vec2 uv = cube ? vec2(2.0 * qf.y + 1.1547005 * qf.x, 2.0 * qf.y - 1.1547005 * qf.x) / (2.0 * R) : 0.5 + 0.5 * q / R;
      float tilt = cube ? qf.y / R : 0.0;
      float rq = length(q);
      float wp = cube ? clamp(0.5 - rq * sin(radians(am)), 0.0, 0.5) : 0.0;
      float wn = cube ? clamp(0.5 - rq * sin(radians(120.0 - am)), 0.0, 0.5) : 0.0;
      float fo = face + wp * (mod(face + 2.0, 3.0) - face) + wn * (mod(face + 1.0, 3.0) - face);
      // The face's grown facets (one of the templates, by the face's hash): the cell and the 8 round it — each cell's
      // height (1 on the rim's path, 0 the deepest; outside the face the rim's) and walls (bit 0 east, 1 north).
      int tpl = int(hashI(ivec2(hk + int(face), key.y), sg + 53.0) * ${FACE_TEMPLATES}.0);
      vec2 gc = clamp(uv, 0.0, 0.99999) * float(tn);
      ivec2 ic = ivec2(floor(gc));
      vec2 fr = gc - vec2(ic);
      float cpx = (cube ? 0.8660254 : 2.0) * R / float(tn);
      float fh[9];
      int fw[9];
      float maxL = 1.0;
      for (int t9 = 0; t9 < 9; t9++) {
        ivec2 cc = ic + ivec2(t9 % 3 - 1, t9 / 3 - 1);
        bool inside = cc.x >= 0 && cc.y >= 0 && cc.x < tn && cc.y < tn;
        vec4 tx = texelFetch(t_facets, ivec2(tpl * tn + clamp(cc.x, 0, tn - 1), clamp(cc.y, 0, tn - 1)), 0);
        fh[t9] = inside ? 1.0 - (tx.r * 65280.0 + tx.g * 255.0) / 65535.0 : 1.0;
        fw[t9] = inside ? int(tx.b * 255.0 + 0.5) : 3;
        if (t9 == 4) maxL = max(tx.a * 255.0, 1.0);
      }
      float h0 = fh[4];
      // The floor: the cell's own height, stepping to a joined neighbour's over the softness at the edge between them.
      bool wE = (fw[4] & 1) != 0, wN = (fw[4] & 2) != 0, wW = (fw[3] & 1) != 0, wS = (fw[1] & 2) != 0;
      bool ex = fr.x > 0.5, ey = fr.y > 0.5;
      float hx = (ex ? wE : wW) ? h0 : mix(h0, fh[ex ? 5 : 3], 0.5 - 0.5 * smoothstep(0.0, soft, (ex ? 1.0 - fr.x : fr.x) * cpx));
      float hy = (ey ? wN : wS) ? h0 : mix(h0, fh[ey ? 7 : 1], 0.5 - 0.5 * smoothstep(0.0, soft, (ey ? 1.0 - fr.y : fr.y) * cpx));
      float hfl = hx + hy - h0;
      // The ribs: the cell's walled edges and the posts at its corners (where any wall meets the node, so walls join and a
      // neighbour's wall ends square), the nearest one's top a little over the higher floor beside it — more on the rim.
      bool pNE = wE || wN || (fw[7] & 1) != 0 || (fw[5] & 2) != 0;
      bool pNW = wW || wN || (fw[6] & 1) != 0 || (fw[3] & 2) != 0;
      bool pSE = wE || wS || (fw[1] & 1) != 0 || (fw[2] & 2) != 0;
      bool pSW = wW || wS || (fw[0] & 1) != 0 || (fw[0] & 2) != 0;
      float rd = 9.0, top = h0;
      if (wE && 1.0 - fr.x < rd) { rd = 1.0 - fr.x; top = max(h0, fh[5]); }
      if (wW && fr.x < rd) { rd = fr.x; top = max(h0, fh[3]); }
      if (wN && 1.0 - fr.y < rd) { rd = 1.0 - fr.y; top = max(h0, fh[7]); }
      if (wS && fr.y < rd) { rd = fr.y; top = max(h0, fh[1]); }
      float dNE = max(1.0 - fr.x, 1.0 - fr.y), dNW = max(fr.x, 1.0 - fr.y), dSE = max(1.0 - fr.x, fr.y), dSW = max(fr.x, fr.y);
      if (pNE && dNE < rd) { rd = dNE; top = max(max(h0, fh[5]), max(fh[7], fh[8])); }
      if (pNW && dNW < rd) { rd = dNW; top = max(max(h0, fh[3]), max(fh[7], fh[6])); }
      if (pSE && dSE < rd) { rd = dSE; top = max(max(h0, fh[5]), max(fh[1], fh[2])); }
      if (pSW && dSW < rd) { rd = dSW; top = max(max(h0, fh[3]), max(fh[1], fh[0])); }
      float rimD = min(min(gc.x, float(tn) - gc.x), min(gc.y, float(tn) - gc.y));
      float ribTop = top + (1.5 + 1.5 * u_ridge * (1.0 - smoothstep(ribW, ribW + 1.0, rimD))) / maxL;
      float ribC = smoothstep(0.0, 1.0, clamp(0.5 - (rd - ribW) * cpx / soft, 0.0, 1.0));
      float hf = mix(hfl, ribTop, ribC);
      // Height: the crystal's (each core or daughter its step over the one it grew from), its hopper and the lean.
      float base = C[i].z;
      vec2 hl2 = hash2I(key, sg + 41.0);
      vec2 lean = hl2.y * vec2(cos(TAU * hl2.x), sin(TAU * hl2.x));
      Hs[i] = base * (bsPow(isD ? dauH : coreH, sub) * (1.0 - u_slope * tilt) * (1.0 - u_depth * (1.0 - hf))
                      + 0.125 * u_lean * dot(d / Rc, lean));
      // Colour: the crystal's own place (over the ramp's whole cycle there and back, so no shift favours one end), its
      // laps (four turns each), each facet's own shift, the sweep across it, its sub-crystals and its face.
      float fl = (1.0 - h0) * maxL;
      float bk = hashI(ivec2(hk + 2 + int(face), int(floor(fl + 0.5))), sg + 37.0);
      Ts[i] = u_col_ofs + 2.0 * u_col_var * fract(13.7 * C[i].x) + 0.25 * u_col_step * fl + u_band * (bk - 0.5)
            + u_sweep * dot(d, sdir) / (2.0 * R0) + u_sub_col * float(sub) + u_face_col * fo + mot;
      // Shade: each facet by its depth, solid as the height map shows it (the floor's, stepping with it at the edges;
      // the ribs show in the relief only).
      Ss[i] = 1.0 - 0.6 * u_contrast * (1.0 - hfl);
    }
  }
  // The front crystal over what is behind it, by its coverage. The ramp's first stop is the bare ground (value 0); the
  // crystals walk the rest of it, from its second stop on, and back.
  float c1 = cv[0];
  float g0 = u_dif_grad_count > 1 ? u_dif_grad_stops[1].a : 0.0;
  float v1 = k1 < -1e8 ? 0.0 : g0 + (1.0 - g0) * bsRamp(Ts[0]);
  float v2 = k2 < -1e8 ? 0.0 : g0 + (1.0 - g0) * bsRamp(Ts[1]);
  GenOut g = genOut(v1, u_ground ? 1.0 : coverage(sdU, u_aa), C[0].y, sdU);
  gGenAlt = vec2(v2, 1.0 - c1);
  gGenShade = mix(Ss[1], Ss[0], c1);
  // Per-feature variation is each crystal's height (above), not a scale of the whole value.
  g.feat = 0.0;
  g.hval = clamp(mix(Hs[1] * cv[1], Hs[0], c1), 0.0, 1.0);
  return g;
}
`
};
