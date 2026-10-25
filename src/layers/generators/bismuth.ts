// Bismuth: hopper crystals as grown in a crucible and seen from above — square frames that step down in terraces
// towards a hollow centre, coloured by the thin film of oxide on them.
//
// Crystals sit one per cell of a grid (Crystals across), scattered, sized, turned and leaning a little each, and a few
// generations deep: each generation has cells half the size of the last, is sparser (Small crystals) and lower (Small
// crystal height), so small crystals crowd the gaps. A crystal may hold a stack of smaller ones at its centre (Core,
// Core stack), and a large one grows smaller ones out of its corners, behind and below it (Corner crystals, Corner
// depth: each from the corner of the last nearest the pixel), so its outline steps down like a ziggurat. One flat loop
// runs over the generations × the cells round the pixel × the crystal, its cores and its corner chain.
//
// A crystal is a square (Habit › Hopper squares) or a cube standing on its corner (Habit › Cube corners: a hexagon
// split into three rhombic faces that slope away from the corner, as an isometric cube looks). Crystals are painted in
// depth order — larger generations in front, then the taller crystal, cores in front of and corner crystals behind the
// crystal they grew from — each over what is behind it by its coverage, so one crystal grows whole through another
// instead of the two cutting each other along their terraces.
//
// On each face the hopper coordinate c runs from 0 at the hollow centre to 1 at the rim (Chebyshev distance in the
// face's frame), cut into terraces Terrace width apart: the outermost terrace is the rim, the others step down inwards
// by Hopper depth, each with a raised lip at its drop (Lip); the rim carries a crest (Rim ridge: a cube's bright
// edges). The ring boundaries s ∈ ℤ, s = c·N + ripples − arms·a: a monotone ripple spaces the terraces unevenly
// (Terrace variation), a ripple of each side's own (blended across the mitres) makes the frames jog at the corners
// (Corner jogs), and Spiral winds them into whorls, a square spiral staircase (a, the position round the square, wraps
// by whole steps, so s stays continuous). Meander cuts each ring into cells along each side and turns a share of them a
// step in or out: hooks and dead ends, the Greek key.
//
// The value is the oxide's thickness — by crystal, terrace, face, sub-crystal, a sweep across the crystal and mottling
// — walked along the ramp from its second stop and back (the first stop is the bare ground), so any ramp stays seamless;
// Band contrast shades it (gGenShade: dark terrace feet, bright lips, darker hollows) without moving the hue, and where
// two crystals meet in a pixel their colours mix (gGenAlt). Height (hval) is the crystal's own height. The crystals'
// union goes to the mask it writes (Mask › Write to), with each crystal's random.

import { P, gradient, halfPx, round1 } from '@/core/params';
import type { LayerDef } from '../types';

const isCube = (p: Record<string, unknown>) => p.habit === 'cube';

export const bismuthLayer: LayerDef = {
	type: 'bismuth',
	label: 'Bismuth',
	category: 'pattern',
	kind: 'generator',
	description:
		'Bismuth hopper crystals: square frames (or isometric cube corners) stepping down in terraces to a hollow centre, small crystals crowding the gaps, iridescent oxide colours. Tileable.',
	params: [
		P.enum(
			'habit',
			'Habit',
			'square',
			[
				['square', 'Hopper squares', 'square frames seen from above, stepping down to a hollow centre'],
				[
					'cube',
					'Cube corners',
					'cubes standing on a corner, as an isometric drawing shows them: a hexagon of three rhombic faces sloping away from the corner, each face a hopper of its own'
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
		P.float('core', 'Core', 0.3, 0, 0.8, {
			step: 0.001,
			section: 'Crystals',
			hint: 'A smaller crystal grown at the centre of each one, this share of its size: standing up out of a square’s hollow, or in front of a cube’s corner, each a step taller than the crystal it grew in. 0 = none'
		}),
		P.int('cores', 'Core stack', 1, 1, 3, {
			section: 'Crystals',
			showIf: (p) => Number(p.core) > 0,
			hint: 'Cores within cores: each grows at the centre of the last, Core times its size'
		}),
		P.float('corner', 'Corner crystals', 0.45, 0, 0.8, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Smaller crystals grown out of each large crystal’s corners, this share of its size, a step lower and behind it: its outline steps down at the corners like a ziggurat, in spikes along the diagonals. 0 = none'
		}),
		P.int('corners', 'Corner depth', 2, 1, 3, {
			section: 'Crystals',
			showIf: (p) => Number(p.corner) > 0,
			hint: 'Corner crystals on the corner crystals: each grows from the corner of the last nearest the pixel'
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
		P.float('terrace', 'Terrace width', 6, 0.5, 128, {
			softMin: 1.5,
			softMax: 24,
			unit: 'px',
			step: 0.05,
			section: 'Terraces',
			hint: 'Width of each step of the hopper: a crystal has as many terraces as fit from its rim to its centre, so small crystals have fewer'
		}),
		P.float('depth', 'Hopper depth', 0.7, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			hint: 'How far the terraces step down to the hollow centre, as a share of the crystal’s height: 0 = flat-topped crystals'
		}),
		P.float('jog', 'Corner jogs', 0.25, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			hint: 'Each side of a frame steps at its own place, so the terraces jog where the sides meet — L-shaped steps and broken corners, like a maze'
		}),
		P.float('meander', 'Meander', 0.35, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			hint: 'Share of each terrace’s stretches that turn a step in or out: hooks, whorls and dead ends where a terrace runs into its neighbour, like a Greek key'
		}),
		P.float('seg', 'Meander length', 5, 0.5, 32, {
			softMax: 12,
			step: 0.01,
			section: 'Terraces',
			showIf: (p) => Number(p.meander) > 0,
			hint: 'Length of those stretches along a side, in terrace widths'
		}),
		P.int('spiral', 'Spiral', 1, 0, 4, {
			section: 'Terraces',
			hint: 'Arms of a square spiral staircase the terraces wind down in: 0 = closed frames, 1 = one long winding step, more = interleaved spirals (reads best with Corner jogs low)'
		}),
		P.float('irregular', 'Terrace variation', 0.4, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			hint: 'Terraces of uneven width — some narrow, some broad — as the growth sped up and slowed down'
		}),
		P.float('lip', 'Lip', 0.35, 0, 2, {
			step: 0.001,
			section: 'Terraces',
			hint: 'A raised lip along the drop of each terrace, in steps: the hopper’s edges grow faster than its faces'
		}),
		P.float('ridge', 'Rim ridge', 1, 0, 4, {
			softMax: 2,
			step: 0.001,
			section: 'Terraces',
			hint: 'A crest along each crystal’s rim, in steps, rising to its edge: a cube’s three edges from its corner stand out as bright ridges'
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
			hint: 'Each terrace darkens towards the foot of the step above it and brightens along its lip, and the hollows go darker, as the walls shade them: bright lips over dark recesses. 0 = flat colour'
		}),
		P.float('col_step', 'Colour per terrace', 0.03, -1, 1, {
			softMin: -0.25,
			softMax: 0.25,
			step: 0.001,
			section: 'Colour',
			hint: 'How far along the ramp each terrace moves from the next (1 = the whole ramp): the oxide is thicker on the older, outer steps; below 0 the hollows are further along'
		}),
		P.float('band', 'Terrace colours', 0.25, 0, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'Each terrace shifted along the ramp by its own random amount (1 = up to half the ramp either way), so the colour changes in bands at the steps'
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
			showIf: (p) => Number(p.core) > 0 || Number(p.corner) > 0,
			hint: 'How far along the ramp each core and corner crystal moves from the crystal it grew from'
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
	// Added in the editor: terraces sized to the texture (about 85 across it at 512 px, never under 2 px), fewer
	// generations on small textures (where the smallest crystals would be a pixel or two), crystals about 8 px tall at
	// 512 px (lower on small textures, so their walls don't shadow whole crystals) and gentler mottling there (a crystal
	// of few terraces would carry its patches as smears).
	fresh: ({ width, height }) => {
		const side = Math.sqrt(width * height);
		return {
			terrace: halfPx(Math.max(2, side / 85), 2),
			gens: side >= 384 ? 3 : side >= 128 ? 2 : 1,
			scale: side >= 192 ? 3 : 2,
			h_amount: round1(4 * Math.sqrt(Math.min(1, side / 512))),
			mottle: side >= 256 ? 0.12 : 0.06
		};
	},
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

// Where q lies round the square about the origin: 0 → 1 anticlockwise from its (+x, −y) corner, even along each side.
float bsRound(vec2 q) {
  bool hx = abs(q.x) >= abs(q.y);
  float den = hx ? q.x : q.y;
  float r = (hx ? q.y : q.x) / (abs(den) < 1e-6 ? 1e-6 : den);
  return hx ? (q.x > 0.0 ? 0.0 : 0.5) + 0.125 * (r + 1.0) : (q.y > 0.0 ? 0.25 : 0.75) + 0.125 * (1.0 - r);
}

// x to a whole power n ≥ 0 (GLSL's pow is undefined for 0⁰).
float bsPow(float x, int n) { return n == 0 ? 1.0 : pow(x, float(n)); }

// The oxide's thickness along the ramp and back.
float bsRamp(float t) { return 1.0 - abs(1.0 - 2.0 * fract(0.5 * t)); }

GenOut gen(vec2 p) {
  bool cube = u_habit == 1;
  vec2 cells0 = cellsFor(u_scale, 1.0);
  float soft = max(u_soft, 0.05);
  float tw = max(u_terrace, 0.5);
  int G = clamp(u_gens, 1, 4);
  // The crystal, its cores and its chain of corner crystals.
  int nC = u_core > 0.0 ? clamp(u_cores, 1, 3) : 0;
  int nK = u_corner > 0.0 ? clamp(u_corners, 1, 3) : 0;
  int L = 1 + nC + nK;
  float kc = clamp(u_corner, 0.0, 0.8);
  // How far the corner crystals reach past the crystal, in its radii.
  float ext = 1.0 + kc * (1.0 - bsPow(kc, nK)) / (1.0 - kc);
  // The cells a crystal reaches from (in cells of its generation): its half-diagonal at the largest size, its scatter,
  // and room for the mask's distance out to the bevel. The finest generation's cells are the smallest, so its margin
  // counts most.
  vec2 cpxMin = uRes / (cells0 * exp2(float(G - 1)));
  float reach = 0.5 * u_size * exp2(u_size_var) * (cube ? 1.0 : 1.4143) * ext + 0.5 * u_scatter
              + (u_bevel + soft + 1.0) / min(cpxMin.x, cpxMin.y);
  int KR = clamp(int(floor(reach + 0.5)), 1, 3);
  int side = 2 * KR + 1;
  int per = side * side;
  // A large crystal's nominal radius (the colour sweep runs across it), the sweep's direction, the mottling.
  float R0 = 0.5 * u_size * min(uRes.x / cells0.x, uRes.y / cells0.y);
  vec2 sdir = rotCW(vec2(1.0, 0.0), u_sweep_angle);
  vec2 nc = cells0 * 3.0;
  float mot = u_mottle * (fbm(p / uRes * nc, periodOf(nc), 3, uSeed + 5.0) - 0.5);
  // Each core's height over the crystal it grew in (in front of a cube's corner, up out of a square's hollow; heights
  // scaled so the innermost is at most 1), and each corner crystal's under the one it grew from.
  float coreH = 1.0 + 0.5 * u_core;
  float cornerH = 1.0 - 0.3 * kc;
  float norm = 1.0 / bsPow(coreH, nC);
  float meander = clamp(u_meander, 0.0, 1.0);

  // The front surface (in depth order) and the one behind it: key, height over the ground, ramp position; the front
  // one's full height, coverage and random. The ground is key −1, height 0.
  float k1 = -1.0, k2 = -1.0, h2 = 0.0, t1 = 0.0, t2 = 0.0, H1 = 0.0, c1 = 0.0, rnd1 = 0.0, sh1 = 1.0, sh2 = 1.0;
  float sdU = 1e4;
  // The chain's current crystal: centre in the crystal's frame and radius (carried from one level to the next).
  vec2 cl = vec2(0.0);
  float cR = 1.0;
  // (No continue in this loop: ANGLE / D3D11 can miscompile it.)
  for (int e = 0; e < G * per * L; e++) {
    int lvl = e % L;
    int eo = e / L;
    int g = eo / per;
    int o = eo - g * per;
    vec2 cells = cells0 * exp2(float(g));
    vec2 cpx = uRes / cells;
    ivec2 cell = ivec2(floor(p / cpx)) + ivec2(o % side, o / side) - KR;
    ivec2 key = wrapCell(cell, ivec2(cells + 0.5));
    float sg = uSeed + float(g) * 101.0;
    vec4 hA = vec4(hash2I(key, sg), hash2I(key, sg + 7.0));
    vec4 hB = vec4(hash2I(key, sg + 13.0), hash2I(key, sg + 19.0));
    // (Corner crystals grow on the largest generation only: on the small ones they turn to grit.)
    if ((g == 0 || hA.x < u_fill) && (g == 0 || lvl <= nC)) {
      vec2 ctr = (vec2(cell) + 0.5 + (hA.yz - 0.5) * u_scatter) * cpx;
      float Rc = 0.5 * u_size * min(cpx.x, cpx.y) * exp2(u_size_var * (2.0 * hA.w - 1.0));
      vec2 d = p - ctr;
      vec2 qc = unrotCW(d, u_angle + u_angle_var * (hB.x - 0.5) * (cube ? 120.0 : 90.0));
      // Which crystal of the chain: the crystal itself, a core (at its centre), or a corner crystal — grown from the
      // corner of the last (the crystal, for the first) nearest the pixel: a square's corner, a hexagon's point.
      int sub = lvl <= nC ? lvl : lvl - nC;
      if (lvl == 0 || lvl == nC + 1) { cl = vec2(0.0); cR = Rc; }
      if (lvl > 0 && lvl <= nC) cR = Rc * bsPow(u_core, lvl);
      if (lvl > nC) {
        vec2 rel = qc - cl;
        float va = radians(30.0 + 60.0 * floor((degrees(atan(rel.y, rel.x)) - 30.0) / 60.0 + 0.5));
        cl += cR * (cube ? vec2(cos(va), sin(va)) : vec2(rel.x < 0.0 ? -1.0 : 1.0, rel.y < 0.0 ? -1.0 : 1.0));
        cR *= kc;
      }
      float R = cR;
      vec2 q = qc - cl;
      float ang = atan(q.y, q.x);
      // The face's frame: a square crystal is one face; a cube corner's three rhombi (right, top, left, anticlockwise)
      // are each turned to the top one, whose edges run from the corner at 30° and 150°, and measured along those edges
      // (uv 0..1). am: the angle into the face from its clockwise edge.
      float am = mod(degrees(ang) + 90.0, 360.0);
      float face = cube ? floor(am / 120.0) : 0.0;
      am -= 120.0 * face;
      vec2 qf = rot2(-radians(120.0 * face - 120.0)) * q;
      vec2 uv = vec2(2.0 * qf.y + 1.1547005 * qf.x, 2.0 * qf.y - 1.1547005 * qf.x) / (2.0 * R);
      vec2 fq = cube ? uv - 0.5 : q / R;
      // Hopper coordinate (0 centre … 1 rim), position round the face, fall from the corner, outline distance, and px per
      // unit of c across the terraces.
      float c = 2.0 * max(abs(fq.x), abs(fq.y)) * (cube ? 1.0 : 0.5);
      float a = bsRound(fq);
      float tilt = cube ? 0.5 * (uv.x + uv.y) : 0.0;
      float ds = cube ? bsHex(q, R) : sdBox(q, vec2(R));
      float pxc = cube ? 0.4330127 * R : R;
      sdU = min(sdU, ds);
      if (ds < 0.75 * soft) {
        // Terraces: N from rim to centre, the step boundaries s ∈ ℤ, each rising over the softness (in px: s's rate
        // across the face, the ripples' slope and the spiral's turn included), with a lip after its drop. Corner jogs:
        // the ripple of the side the pixel is on (by its sign along the dominant axis), blended into the neighbouring
        // side's over a pixel either way across the mitre.
        float N = clamp(floor(pxc / tw), 1.0, 64.0);
        float cn = c * N;
        int sk = key.x * 64 + int(face) * 8 + lvl * 2;
        float phH = TAU * hashI(ivec2(sk + (fq.x > 0.0 ? 0 : 1), key.y), sg + 23.0);
        float phV = TAU * hashI(ivec2(sk + (fq.y > 0.0 ? 0 : 1), key.y), sg + 29.0);
        float mb = smoothstep(-soft, soft, (abs(fq.x) - abs(fq.y)) * pxc * (cube ? 1.4142 : 0.7071));
        float pI = 2.3 * cn + TAU * hB.y;
        vec2 pJ = 1.3 * cn + vec2(phV, phH);
        float s = cn + 0.2 * u_irregular * sin(pI) + 0.6 * u_jog * mix(sin(pJ.x), sin(pJ.y), mb) - float(u_spiral) * a;
        float rate = abs(1.0 + 0.46 * u_irregular * cos(pI) + 0.78 * u_jog * mix(cos(pJ.x), cos(pJ.y), mb)) * N / pxc
                   + 0.125 * float(u_spiral) / max(c * pxc, 1.0);
        float sw = clamp(soft * rate, 0.0, 1.0);
        float k = floor(s), f = s - k;
        float rise = smoothstep(1.0 - sw, 1.0, f);
        // Meander: the terraces are cells — ring by stretches of Meander length along each side, each ring's stretches
        // set off by their own phase — and a share of the cells turn a step in or out (a hook into the next ring out,
        // or a dead end where the ring in runs on). The rings below, at and above the pixel's, on its side and on the
        // other side of the mitre (blended as the jogs are), each cell blended into the nearer neighbour over a softness
        // either side of their boundary.
        float pxf = cube ? 2.0 * pxc : pxc;
        float segPx = max(u_seg, 0.5) * pxc / N;
        vec3 offH = vec3(0.0), offV = vec3(0.0);
        for (int j = 0; j < 6 * UNI_1; j++) {
          bool sv = (j & 1) == 1;
          int ring = int(k) - 1 + j / 2;
          int sid = sv ? (fq.y > 0.0 ? 2 : 3) : (fq.x > 0.0 ? 0 : 1);
          int row = sk * 4 + sid;
          float al = (sv ? fq.x : fq.y) * pxf / segPx + hashI(ivec2(row, ring), sg + 41.0);
          float sx = floor(al), fr = al - sx;
          float hc = hashI(ivec2(row * 512 + int(sx), ring), sg + 43.0);
          float hn = hashI(ivec2(row * 512 + int(sx) + (fr < 0.5 ? -1 : 1), ring), sg + 43.0);
          vec2 tooth = vec2(hc < 0.5 * meander ? 1.0 : hc < meander ? -1.0 : 0.0,
                            hn < 0.5 * meander ? 1.0 : hn < meander ? -1.0 : 0.0);
          float o = mix(tooth.x, tooth.y, 0.5 - 0.5 * smoothstep(0.0, soft, min(fr, 1.0 - fr) * segPx));
          vec3 at = vec3(equal(ivec3(j / 2), ivec3(0, 1, 2))) * o;
          if (sv) offV += at; else offH += at;
        }
        vec3 lv = k + vec3(-1.0, 0.0, 1.0) + mix(offV, offH, mb);
        float hl = lv.y + (lv.z - lv.y) * rise
                 + u_lip * (max(lv.y - lv.x, 0.0) * (1.0 - smoothstep(0.0, max(0.35, 1.5 * sw), f)) + max(lv.z - lv.y, 0.0) * rise);
        // The outermost terrace is the rim, at the top whatever the ripples and the spiral do, its crest rising to the
        // edge.
        float rr = smoothstep(1.0 - 1.0 / N - soft / pxc, 1.0 - 1.0 / N, c);
        float rim = (N + u_lip) * rr + u_ridge * smoothstep(1.0 - 1.0 / N, 1.0, c);
        float lev = clamp(max(lv.y + (lv.z - lv.y) * rise, N * rr), 0.0, N);
        float hf = clamp(max(hl, rim), 0.0, N + u_lip + u_ridge) / (N + u_lip + u_ridge);
        float rnd = hB.w;
        // Its height: per crystal and generation, each core and corner crystal coreH / cornerH over the one it grew from.
        float base = (1.0 - u_rise_var * hB.z) * bsPow(u_gen_h, g) * (1.0 - u_h_var * featVar(rnd)) * norm;
        vec2 hl2 = hash2I(key, sg + 31.0);
        vec2 lean = hl2.y * vec2(cos(TAU * hl2.x), sin(TAU * hl2.x));
        // Lean tilts the whole crystal: its terraces stay flat but face their own way.
        float H = base * (bsPow(lvl > nC ? cornerH : coreH, sub) * (1.0 - u_slope * tilt) * (1.0 - u_depth * (1.0 - hf))
                          + 0.125 * u_lean * dot(d / Rc, lean));
        // The outer wall falls over half as much again as a step's rise: a cliff of the crystal's whole height.
        float cov = smoothstep(0.0, 1.0, clamp(0.5 - ds / (1.5 * soft), 0.0, 1.0));
        // Colour: the crystal's own place (over the ramp's whole cycle there and back, so no shift below favours one end),
        // its terraces (each with a random shift of its own, blended over the rise),
        // the sweep across it, its cores and its face — the faces' shifts blended into their neighbours' over a pixel
        // either side of the edges between them (r sin of the angle from each edge).
        float bk = mix(hashI(ivec2(sk + 2, int(k)), sg + 37.0), hashI(ivec2(sk + 2, int(k) + 1), sg + 37.0), rise);
        float rq = length(q);
        float wp = cube ? clamp(0.5 - rq * sin(radians(am)), 0.0, 0.5) : 0.0;
        float wn = cube ? clamp(0.5 - rq * sin(radians(120.0 - am)), 0.0, 0.5) : 0.0;
        float fo = face + wp * (mod(face + 2.0, 3.0) - face) + wn * (mod(face + 1.0, 3.0) - face);
        float t = u_col_ofs + 2.0 * u_col_var * fract(13.7 * hB.y) + u_col_step * lev + u_band * (bk - 0.5)
                + u_sweep * dot(d, sdir) / (2.0 * R0) + u_sub_col * float(sub) + u_face_col * fo + mot;
        // Shade: darker towards the foot of a step up, brighter along the lip after a drop (neither where the cell runs on
        // level), and darker down in the hollow.
        float foot = smoothstep(0.3, 1.0, f) * (1.0 - rise) * clamp(lv.z - lv.y, 0.0, 1.0) * (1.0 - rr);
        float lipZ = (1.0 - smoothstep(0.0, max(0.35, 1.5 * sw), f)) * clamp(lv.y - lv.x, 0.0, 1.0) * (1.0 - rr);
        float sh = (1.0 - 0.8 * u_contrast * foot + 0.25 * u_contrast * lipZ) * (1.0 - 0.45 * u_contrast * (1.0 - hf));
        // Depth order: cores in front of their crystal, corner crystals behind it.
        float kd = float(G - g) * 4.0 + base + 1e-3 * (lvl > nC ? -float(sub) : float(lvl));
        if (cov > 0.0 && kd > k1) {
          k2 = k1; h2 = H1 * c1; t2 = t1; sh2 = sh1;
          k1 = kd; t1 = t; H1 = H; c1 = cov; rnd1 = rnd; sh1 = sh;
        } else if (cov > 0.0 && kd > k2) { k2 = kd; h2 = H * cov; t2 = t; sh2 = sh; }
      }
    }
  }
  // The front crystal over what is behind it, by its coverage. The ramp's first stop is the bare ground (value 0); the
  // crystals walk the rest of it, from its second stop on, and back.
  float g0 = u_dif_grad_count > 1 ? u_dif_grad_stops[1].a : 0.0;
  float v1 = k1 < 0.0 ? 0.0 : g0 + (1.0 - g0) * bsRamp(t1);
  float v2 = k2 < 0.0 ? 0.0 : g0 + (1.0 - g0) * bsRamp(t2);
  GenOut g = genOut(v1, u_ground ? 1.0 : coverage(sdU, u_aa), rnd1, sdU);
  gGenAlt = vec2(v2, 1.0 - c1);
  gGenShade = mix(sh2, sh1, c1);
  // Per-feature variation is each crystal's height (above), not a scale of the whole value.
  g.feat = 0.0;
  g.hval = clamp(mix(h2, H1, c1), 0.0, 1.0);
  return g;
}
`
};
