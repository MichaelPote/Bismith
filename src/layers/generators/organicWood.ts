// Organic structured generators (FR7.2a): wooden planks with grain, and overlapping scales.
//
// Both are SDF layers with an Output switch, because the generator wrapper replaces the value of an SDF
// pixel with the bevel profile:
//   - "combined" (default): the pattern value (grain / scale shading) with the layer's own bevel — gaps and outlines
//     read low. Wood returns its grain with genOutShaded: the wrapper applies the bevel of the combined shape and writes
//     the plank outline to its mask, so chips and limits can follow it. Lapped scales bevel their rims onto the
//     scale beneath themselves (genOutOwn) and Grooved ones use genOutShaded; both write their outline.
//   - "shape": the plank / scale SDF for its mask (bevel, limit, etch); value = wrapper profile.
//   - wood only, "grain": the grain value without gaps or edges (stack it over a "shape" layer).

import { P, gradient, orientAxis } from '@/core/params';
import type { LayerDef } from '../types';
import { ORG_GLSL, ORG_GLSL_SDF, ORG_NO_SDF } from './organicShared';

// Grain and ring spacing are across the planks.
const woodAcross = orientAxis('direction', { vertical: 'y', horizontal: 'x' }, true);

// ------------------------------------------------------------------------------------------------ wood

const planksOn = (p: Record<string, unknown>) => p.planks !== false;
const jointsOn = (p: Record<string, unknown>) => p.planks !== false && Number(p.joints) > 0;
const ringsOn = (p: Record<string, unknown>) => Number(p.rings) > 0;

export const woodLayer: LayerDef = {
	type: 'wood',
	noise: true,
	label: 'Wood planks',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	// The plank outline goes to its mask from the Wood and Plank shapes outputs (not Grain only, nor one slab).
	sdfShowIf: (p) => p.planks !== false && p.output !== 'grain',
	description:
		'Wooden planks with staggered end joints and grain: fine streaks, ring figure (cathedral arches) and knots.',
	params: [
		P.enum(
			'output',
			'Output',
			'wood',
			[
				['wood', 'Wood (grain × plank edges)'],
				['shape', 'Plank shapes (SDF)'],
				['grain', 'Grain only']
			],
			{
				hint: 'Wood: grain value with gaps = 0 and the Shape bevel darkening plank edges. Shape: the outline of the planks for the mask it writes (bevel / limit). Grain: per-board grain without gaps'
			}
		),
		P.bool('planks', 'Planks', true, { hint: 'Off: one continuous piece of wood (no gaps, joints or boards)' }),
		P.enum(
			'direction',
			'Direction',
			'vertical',
			[
				['vertical', 'Vertical'],
				['horizontal', 'Horizontal']
			],
			{ hint: 'Which way the planks (and grain) run' }
		),
		P.int('count', 'Planks', 4, 1, 128, { softMax: 16, showIf: planksOn, hint: 'Planks across the texture' }),
		P.float('gap', 'Gap X', 1, 0, 64, {
			softMax: 8,
			unit: 'px',
			axis: 'x',
			step: 0.1,
			showIf: planksOn,
			join: { with: 'gap_y', as: 'pair', label: 'Gap X · Y' },
			hint: 'Width of the gaps across the texture (X: the up-and-down gaps — between vertical planks, at the ends of horizontal ones) and down it (Y: the gaps that run across)'
		}),
		P.float('gap_y', 'Gap Y', 1, 0, 64, { softMax: 8, unit: 'px', axis: 'y', step: 0.1, showIf: planksOn }),
		P.float('joint_var', 'Joint variation', 0, 0, 1, {
			step: 0.001,
			showIf: planksOn,
			hint: 'Each board gets its own share of the gaps it carries (along its left / top side and at its start), of its bevel, crown and height variation: 0 = every gap as set, 1 = from fully shut to full width. Shut boards butt tight against the next, flush, with hardly any edge'
		}),
		P.int('joints', 'End joints', 1, 0, 32, {
			softMax: 8,
			showIf: planksOn,
			hint: 'Board ends per plank along the texture (0 = full-length boards)'
		}),
		P.float('stagger', 'Stagger', 0.5, 0, 1, {
			step: 0.001,
			showIf: jointsOn,
			hint: 'Regular joint offset from one plank to the next (fraction of a board)'
		}),
		P.float('joint_rand', 'Joint randomness', 0.6, 0, 1, {
			step: 0.001,
			showIf: jointsOn,
			hint: 'Random joint offset per plank'
		}),
		P.float('width_var', 'Width variation', 0, 0, 1, { step: 0.001, showIf: planksOn, hint: 'Uneven plank widths' }),
		P.float('end_wobble', 'End wobble', 0, 0, 64, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			showIf: jointsOn,
			hint: 'Board ends — the cuts across the grain — wander by up to this much, as if sawn by hand. Both sides of a joint follow the same line (mostly), so the gap keeps its width; the long edges stay straight'
		}),
		P.float('end_wobble_px', 'Wobble size', 32, 2, 1024, {
			softMax: 128,
			unit: 'px',
			step: 0.1,
			showIf: (p) => jointsOn(p) && Number(p.end_wobble) > 0,
			hint: "Distance between the wobble's bends along a board end (long: gently slanted cuts; short: wavy ones)"
		}),
		P.float('end_var', 'End fit', 0.1, 0, 1, {
			step: 0.001,
			showIf: (p) => jointsOn(p) && Number(p.end_wobble) > 0,
			hint: 'How much each side of a joint wanders on its own, opening and closing the end gap: 0 the two ends fit exactly (the gap keeps its width), 1 each side wanders as much as the shared line'
		}),
		P.float('crown', 'Crown', 0.25, -1, 1, {
			step: 0.001,
			showIf: planksOn,
			hint: 'Height only: boards domed across their width (> 0: the edges sink by this share of the height) or cupped (< 0: the middle sinks)'
		}),
		P.float('grain_px', 'Grain spacing', 2, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			axis: woodAcross,
			step: 0.05,
			group: 'grain',
			hint: 'Distance between fine grain streaks'
		}),
		P.float('grain_stretch', 'Grain length', 24, 1, 64, {
			softMax: 32,
			step: 0.1,
			group: 'grain',
			hint: 'How elongated the fine grain is along the plank'
		}),
		P.float('grain_depth', 'Grain depth', 0.35, 0, 1, {
			step: 0.001,
			group: 'grain',
			hint: "How deep the grain cuts in Height, as a share of the layer's height: the plank surface is (1 − depth) + depth × grain, so at 1 dark grain sinks as low as the gaps, at 0.2 it is a fine texture on a full-height board, at 0 the boards are smooth. The gaps and bevels always span the full height; colours keep the full grain"
		}),
		P.float('fine', 'Fine grain', 0.6, 0, 1, { step: 0.001, group: 'grain' }),
		P.float('rings', 'Rings', 0.6, 0, 1, { step: 0.001, group: 'grain', hint: 'Strength of the growth-ring lines' }),
		P.float('ring_px', 'Ring spacing', 4, 1, 256, {
			softMax: 32,
			unit: 'px',
			axis: woodAcross,
			step: 0.05,
			group: 'grain'
		}),
		P.float('ring_line', 'Latewood', 0.4, 0.02, 1, {
			step: 0.001,
			group: 'grain',
			hint: 'Width of the dark part of each ring (fraction of the spacing)'
		}),
		P.float('ring_ramp', 'Earlywood fade', 0.6, 0, 1, {
			step: 0.001,
			group: 'grain',
			showIf: (p) => ringsOn(p),
			hint: 'How each ring darkens: 0 the latewood rises evenly across its width; 1 it fades in slowly from deep in the light earlywood and darkens steeply towards its sharp outer edge. Each ring also gets its own latewood width and darkness'
		}),
		P.float('grain_soft', 'Softness', 0.4, 0, 1, {
			step: 0.001,
			group: 'grain',
			showIf: (p) => ringsOn(p) || Number(p.fine) > 0,
			hint: 'How soft the rings and grain streaks are — in Height above all. 0: crisp (ring edges anti-aliased to the pixel unless Anti-alias is off, then hard pixel-art steps); 1: soft, rounded bands that rise and fall gently instead of little cliffs'
		}),
		P.enum(
			'cut',
			'Figure',
			'cathedral',
			[
				['ovals', 'Ovals'],
				['cathedral', 'Cathedral arches']
			],
			{
				group: 'grain',
				hint: 'How the rings show on a board cut near the heart. Ovals: rings closed round a point once per board (and, with no planks, lines folded by a broad wobble). Cathedral arches: the heart dives into the board along it, so the rings open into nested arches that point one way, with a swell or two; one slab gets a heart of its own'
			}
		),
		P.float('figure', 'Arches', 0.5, 0, 1, {
			step: 0.001,
			group: 'grain',
			hint: 'Planks: fraction of boards sawn through the heart (arches / ovals); the rest show straight lines. No planks: how strongly the lines fold into arches (Ovals) or how wide the arched middle is (Cathedral)'
		}),
		P.float('ring_stretch', 'Arch length', 6, 1, 64, {
			softMax: 16,
			step: 0.1,
			group: 'grain',
			hint: 'Elongation of the rings along the board: how far apart the nested arch tips are'
		}),
		P.float('ring_var', 'Ring irregularity', 0.5, 0, 1, {
			step: 0.001,
			group: 'grain',
			showIf: ringsOn,
			hint: 'Growth rings of uneven width — wide years and narrow ones, and bands of several tight years between runs of wide ones — instead of an even spacing'
		}),
		P.float('grain_group', 'Streak grouping', 0.6, 0, 1, {
			step: 0.001,
			group: 'grain',
			showIf: (p) => Number(p.fine) > 0,
			hint: 'The fine streaks bunch into bands of tight lines with sparser stretches between, instead of an even comb'
		}),
		P.float('board_var', 'Board variety', 0.6, 0, 1, {
			step: 0.001,
			group: 'grain',
			showIf: planksOn,
			hint: 'How much the grain differs from board to board: streak contrast and density, ring spacing, and a slight slant of the grain (boards with end joints)'
		}),
		P.float('ring_warp', 'Ring warp', 0.5, 0, 4, {
			softMax: 2,
			step: 0.001,
			group: 'grain',
			hint: 'Wobble of the ring lines'
		}),
		P.float('knots', 'Knots', 0.15, 0, 4, {
			softMax: 2,
			step: 0.001,
			group: 'grain',
			hint: 'Knots per board: up to 1 the chance of one; above, that many on average (2.5: two on every board, a third on half of them; at most 4). No planks: per texture-sized piece'
		}),
		P.float('knot_size', 'Knot size', 3, 0.5, 128, {
			softMax: 32,
			unit: 'px',
			step: 0.05,
			group: 'grain',
			showIf: (p) => Number(p.knots) > 0,
			hint: 'Knot radius across the grain (it is ~1.7× longer along it); clamped to the board'
		}),
		P.seed()
	],
	groups: [{ id: 'grain', label: 'Grain' }],
	// Added in the editor: px sizes that grow with the texture — the plain defaults up to 128 px (pixel art), at 512 px 2 px
	// gaps, a 5 px bevel, 8 px rings and knots that read on 128 px boards instead of hairlines and pinholes.
	fresh: ({ width, height }) => {
		const k = Math.max(1, Math.sqrt(width * height) / 128);
		const r1 = (x: number) => Math.round(x * 10) / 10;
		const gap = Math.round(Math.sqrt(k));
		// On big textures the many fine streaks would drown the ring figure: rings up, streaks down (from 512 px on).
		const big = Math.min(1, (k - 1) / 3);
		return {
			rings: Math.round((0.6 + 0.2 * big) * 100) / 100,
			fine: Math.round((0.6 - 0.15 * big) * 100) / 100,
			gap,
			gap_y: gap,
			bevel: Math.max(1, Math.round(2.2 * k ** 0.75 - 1.2)),
			grain_px: r1(2 * k ** 0.35),
			ring_px: r1(4 * Math.sqrt(k)),
			knot_size: r1(3 * k ** 0.95),
			end_wobble_px: Math.round(32 * Math.sqrt(k))
		};
	},
	// One gap for both directions before Gap Y: an older (or recipe-built) layer's gap keeps applying to both.
	migrate: (p) => (p.gap !== undefined && p.gap_y === undefined ? { ...p, gap_y: p.gap } : p),
	defaults: {
		bevel: 1,
		profile: 'smooth',
		// Boards a little uneven in height.
		h_var: 0.25,
		h_on: true,
		h_amount: 0.3,
		dif_on: true,
		dif_grad: gradient('#24140a', '#4f321b', '#7a5530', '#9c7343', '#b48a55'),
		dif_jitter: 0.2
	},
	glsl:
		ORG_GLSL +
		ORG_GLSL_SDF +
		/* glsl */ `
// Plank boundary k across the texture (px, whole pixels). Width variation moves boundaries randomly.
float org_plankEdge(int k, int n, float pw) {
  float j = 0.0;
  if (u_width_var > 0.0) {
    int kw = uTile ? imod(k, n) : k;
    j = (hashI(ivec2(kw, 5), uSeed + 23.0) - 0.5) * 0.9 * u_width_var;
  }
  return floor((float(k) + j) * pw + 0.5);
}

// Smooth 1D noise in -1..1 along a board end (x in wobble cells across the plank; key = plank column, joint).
float org_endWob(float x, int col, int joint, float seed) {
  float i = floor(x), f = x - i;
  ivec2 k = ivec2(int(i), col * 4099 + joint);
  return 2.0 * mix(hashI(k, seed), hashI(k + ivec2(1, 0), seed), f * f * (3.0 - 2.0 * f)) - 1.0;
}

// Smooth 1D noise in -1..1 with a period of per cells (for seamless wraps), keyed per board.
float wd_n1(float x, int per, ivec2 key, float seed) {
  float i = floor(x), f = x - i;
  int k = key.x * 4099 + key.y;
  float h0 = hashI(ivec2(imod(int(i), per), k), seed), h1 = hashI(ivec2(imod(int(i) + 1, per), k), seed);
  return 2.0 * mix(h0, h1, f * f * (3.0 - 2.0 * f)) - 1.0;
}

GenOut gen(vec2 p) {
  bool horiz = u_direction == 1;
  // Plank frame: a runs across the planks, l along them (px, from the top / left on screen).
  float A = horiz ? uRes.y : uRes.x;
  float Lr = horiz ? uRes.x : uRes.y;
  float a = horiz ? uRes.y - p.y : p.x;
  float l = horiz ? p.x : uRes.y - p.y;

  int n = u_planks ? max(u_count, 1) : 1;
  int nj = u_planks ? max(u_joints, 0) : 0;
  // Gaps in the plank frame: gA between planks (along their sides), gL at the board ends. X / Y are screen axes.
  float gA = u_planks ? (horiz ? u_gap_y : u_gap) : 0.0;
  float gL = u_planks ? (horiz ? u_gap : u_gap_y) : 0.0;
  float pw = A / float(n);
  float bl = nj > 0 ? Lr / float(nj) : Lr;

  // Nearest board (like bricks): the gap runs along the left / top edge so whole-pixel sizes stay crisp.
  int c0 = int(floor(a / pw));
  float best = 1e9;
  // The nearest board's distance in the space Bevel aspect stretches (x by √a, y by 1/√a: left / right bevels Bevel / √a,
  // top / bottom Bevel · √a), in px of Bevel — its bevel (GenOut.bdist), exact, so the bevels meet in a clean mitre.
  float bestA = 1e9;
  float ra = sqrt(max(u_bevel_aspect, 1e-3));
  vec2 asp = horiz ? vec2(ra, 1.0 / ra) : vec2(1.0 / ra, ra);
  ivec2 bid = ivec2(0);
  vec4 box = vec4(0.0, A, 0.0, Lr);
  float bestJs = 1.0;
  for (int i = -1; i <= 1; i++) {
    int c = c0 + i;
    int cw = uTile ? imod(c, n) : c;
    float a0 = org_plankEdge(c, n, pw);
    float a1 = org_plankEdge(c + 1, n, pw);
    float off = float(cw) * u_stagger + hashI(ivec2(cw, 9), uSeed + 29.0) * u_joint_rand;
    // End wobble: the board ends move along the plank by a noise of the across position, one line per joint (shared by
    // the boards either side, so the gap keeps its width) plus a little of each side's own. Shifting l by the nearest
    // joint's offset bends only the ends: the long edges don't depend on l.
    float lw = l;
    if (nj > 0 && u_end_wobble > 0.0) {
      int bj = int(floor(l / bl - off + 0.5));
      int bjw = uTile ? imod(bj, nj) : bj;
      float x = (a - a0) / max(u_end_wobble_px, 1.0);
      float sh = u_end_wobble * org_endWob(x, cw, bjw, uSeed + 71.0);
      bool below = l > floor((float(bj) + off) * bl + 0.5) + 0.5 * gL + sh;
      lw = l - sh - u_end_var * u_end_wobble * org_endWob(x + 0.5, cw, 2 * bjw + (below ? 1 : 0), uSeed + 73.0);
    }
    int b0 = nj > 0 ? int(floor(lw / bl - off)) : 0;
    // (Full-length boards: the three boxes are the same, so the first one stays the nearest — no continue, which ANGLE
    // can miscompile.)
    for (int j = -1; j <= 1; j++) {
      int b = b0 + j;
      float l0 = nj > 0 ? floor((float(b) + off) * bl + 0.5) : l - 1e4;
      float l1 = nj > 0 ? floor((float(b + 1) + off) * bl + 0.5) : l + 1e4;
      ivec2 key = ivec2(cw, nj > 0 ? (uTile ? imod(b, nj) : b) : 0);
      // Joint variation: the board carries its own share of its gaps (along its side and at its start).
      float js = u_planks ? 1.0 - u_joint_var * hashI(key, uSeed + 191.0) : 1.0;
      vec2 lo = vec2(a0 + gA * js, l0 + (nj > 0 ? gL * js : 0.0));
      vec2 hi = vec2(a1, l1);
      vec2 hs = max(0.5 * (hi - lo), vec2(0.0));
      float d = sdBox(vec2(a, lw) - 0.5 * (lo + hi), hs);
      if (d < best) {
        best = d;
        bestA = sdBox((vec2(a, lw) - 0.5 * (lo + hi)) / asp, hs / asp);
        bid = key;
        box = vec4(a0, a1, l0, l1);
        bestJs = js;
      }
    }
  }
  float rnd = hashI(bid, uSeed);
  // A shut board has hardly any bevel (its bevel distance stretched by 1 / its share).
  bestA /= max(bestJs, 0.05);
  if (u_output == 1 && u_planks) {
    GenOut sh = genOut(0.0, 1.0, rnd, best);
    sh.bdist = bestA;
    sh.feat *= bestJs;
    return sh;
  }

  // Board-local coordinates: la across from the board centre, ll along from its start (period Lb).
  float pwB = max(box.y - box.x, 1.0);
  float la = a - 0.5 * (box.x + box.y);
  float Lb = nj > 0 ? max(box.w - box.z, 1.0) : Lr;
  float ll = nj > 0 ? l - box.z : l;
  vec4 hb = vec4(hash3I(bid, uSeed + 31.0), hashI(bid, uSeed + 37.0));

  // Knot: grain lines flow around it like potential flow around a cylinder (isolines of the across
  // coordinate bend and bunch up at its rim); inside, dark concentric rings.
  // Up to four per board (Knots above 1): knot s is there when its random is below Knots − s, so the first is the one
  // knot of before. Their bends add up; inside, the strongest knot paints.
  float bend = 0.0;
  float knotMask = 0.0;
  float knotDark = 0.0;
  // The grain flows round over a longer wake along it, the rim is irregular, the knot is darker wood with a dark pith and
  // rim and faint rings (not a bullseye), dark tails run along the grain from it, and further knots on a board are spread
  // along it instead of side by side.
  float hz0 = hash3I(bid, uSeed + 61.0).z;
  float knotTail = 0.0;
  float knotKr = 1.0;
  float knotSink = 0.0;
  for (int s = 0; s < 4 * ORG_1; s++) {
    float fs = float(s);
    if (fs >= u_knots) break;
    vec3 hk = hash3I(bid, uSeed + 61.0 + 13.0 * fs);
    if (hk.x < u_knots - fs) {
      float rk = min(max(u_knot_size * (0.7 + 0.6 * hashI(bid, uSeed + 67.0 + 13.0 * fs)), 0.75), max(0.4 * pwB, 0.75));
      float ka = (hk.y - 0.5) * pwB * 0.6;
      float da = la - ka;
      if (!u_planks) da -= A * floor(da / A + 0.5);   // one continuous piece wraps across too
      // (Boards with ends: kept off the last eighth at either end, where a knot would be cut by the joint.)
      float kz = s > 0 ? fract(hz0 + 0.38 * fs + 0.25 * (hk.z - 0.5)) : hk.z;
      float dl = ll - (nj > 0 ? 0.12 + 0.76 * kz : kz) * Lb;
      dl -= Lb * floor(dl / Lb + 0.5);
      float rr = length(vec2(da, dl * 0.6));
      // Windowed so the bend stays local (and seamless): fades out between 2.5 and 5 knot radii, over a wake longer
      // downstream (a random way along the board) than up; the lines bend round a cylinder a little wider than the knot,
      // so they part before its rim instead of running into it.
      vec3 hs = hash3I(bid, uSeed + 107.0 + 13.0 * fs);
      float wk = dl * (hs.z < 0.5 ? 1.0 : -1.0) > 0.0 ? 0.15 : 0.35;
      float win = 1.0 - smoothstep(2.5 * rk, 5.0 * rk, length(vec2(da, dl * wk)));
      float rb = 1.2 * rk;
      bend += da * win * rb * rb / max(rr * rr, rb * rb);
      float kr = rr / rk;
      float th = atan(dl * 0.6, da);
      // A smooth, slightly lumpy oval rim (two low harmonics), not a polygon.
      kr *= 1.0 + 0.07 * sin(2.0 * th + TAU * hk.y) + 0.035 * sin(3.0 * th + TAU * hk.z);
      knotTail = max(knotTail, (1.0 - smoothstep(0.25, 0.9, abs(da) / rk)) * (1.0 - smoothstep(1.0, 4.0, abs(dl) / rk)) * smoothstep(0.9, 1.2, kr));
      float km = 1.0 - smoothstep(0.88, 1.04, kr);
      if (km > knotMask) {
        knotMask = km;
        knotKr = kr;
        knotSink = hashI(bid, uSeed + 101.0 + 13.0 * fs);
        // Per knot: its eye (dark core) size, ring count and contrast, rim darkness and overall tone.
        float eye = 0.1 + 0.3 * hs.x;
        knotDark = clamp(0.4 + 0.25 * hs.y + 0.4 * (1.0 - smoothstep(0.4 * eye, eye, kr)) + (0.1 + 0.35 * hs.z) * smoothstep(0.7, 0.95, kr)
                         + (0.04 + 0.12 * hs.x) * sin(TAU * ((1.5 + 3.0 * hs.y) * kr + 0.15 * sin(2.0 * th + TAU * hk.z))), 0.0, 1.0);
      }
    }
  }
  float aEff = la - bend;
  float aAbs = aEff + 0.5 * (box.x + box.y);

  // One continuous piece: its lines fold where a broad wobble bends them back (see the ring figure); worked out first, so
  // the fine grain can follow the folds.
  bool cath = u_cut == 1;
  float slabFold = 0.0;
  float fineBend = 0.0;
  // Cathedral slab: the heart wanders sideways a little once along the texture (the fine streaks with it), so the saddle
  // between two arch systems is lopsided.
  vec3 hwd = hash3I(bid, uSeed + 47.0);
  float wander = !u_planks && cath ? A * (0.12 * sin(TAU * (l / Lr + hwd.z)) + 0.05 * sin(TAU * (2.0 * l / Lr + hwd.x))) : 0.0;
  fineBend += wander;
  if (!u_planks && !cath) {
    vec2 fc = vec2(2.0, 2.0 * (Lr / A) / max(u_ring_stretch * 0.25, 1.0));
    if (uTile) fc = max(floor(fc + 0.5), vec2(1.0));
    // Fold strength: gentle waves up to Arches 0.5, then steeply stronger, so the lines really turn back into arches and
    // ovals towards 1 — with the finer octaves fading out, so the folds are a few broad arches, not a contour map of
    // little loops.
    float fhi = clamp(2.0 * u_figure - 1.0, 0.0, 1.0);
    float fold = u_figure <= 0.5 ? 0.25 * u_figure : 0.125 + 1.75 * (u_figure - 0.5);
    float fn = org_noiseFbm(1, false, vec2(a / A, l / Lr) * fc, org_per(fc), 3, 0.5 - 0.4 * fhi, uSeed + 17.0) - 0.5;
    slabFold = fold * A * fn;
    // The fold beyond those gentle waves bends the fine streaks too, so they run with the arches instead of across them.
    fineBend = (fold - 0.25 * min(u_figure, 0.5)) * A * fn;
  }

  // Board variety: per board, the streaks' contrast and density, the ring spacing and (boards with end joints, which
  // needn't repeat along the texture) a slight slant of the grain — measured from the board's middle, so it's seamless.
  vec3 hv3 = hash3I(bid, uSeed + 53.0);
  float bv = u_planks ? u_board_var : 0.0;
  float fineK = u_fine * max(1.0 + 3.0 * bv * (hv3.x - 0.5), 0.1);
  float fineTh = 0.6 * bv * (hv3.y - 0.5);
  float run = nj > 0 ? 0.12 * bv * (hb.w - 0.5) * (ll - 0.5 * Lb) : 0.0;

  // Ring figure. Low-frequency wobble: about one warp cell per plank across, a few along the texture.
  vec2 rc = vec2(float(n), float(n) * (Lr / A) * 0.75);
  if (uTile) rc = max(floor(rc + 0.5), vec2(1.0));
  ivec2 rper = uTile ? ivec2(rc + 0.5) : NO_PERIOD;
  // (Cathedral: sampled at an offset per board, so a board's wobble doesn't carry on into the next one.)
  float wn = org_noiseFbm(1, false, vec2(a / A, l / Lr) * rc + (cath ? hb.yx * vec2(17.0, 23.0) : vec2(0.0)), rper, 2, 0.5, uSeed + 13.0) - 0.5;
  float spacing = u_ring_px * (u_planks ? 1.0 + bv * (hv3.z - 0.5) : 1.0);
  float st = max(u_ring_stretch, 1.0);
  float r;
  // Cathedral: the ring field's gradient in the plank frame (across, along), exact (see below).
  vec2 gRa = vec2(1.0, 0.0);
  int nRings = 1 << 20;
  if (cath) {
    // Cathedral arches: rings are cylinders round a heart (pith) that runs along the board at depth D below the face, so a
    // ring of radius ρ shows where D < ρ, as two lines that meet in an arch tip where D = ρ. D grows along the board (by
    // 1 / Arch length) with a swell or two, so the arches nest, point one way and stay open.
    vec3 hc = hash3I(bid, uSeed + 47.0);
    float dx;
    float D;
    // d(dx)/dl and dD/dl, for the ring field's gradient worked out exactly (the warp's is small): screen derivatives are
    // one per 2×2 pixels, so anything drawn from them steps in 2 px blocks along a sloping flank.
    float dxl = 0.0;
    float Dl;
    if (u_planks) {
      float hh = hashI(bid, uSeed + 41.0);
      bool heart = hashI(bid, uSeed + 43.0) < u_figure;
      // (A heart board's heart stays well inside it, so its arch tips are on the board.)
      float cx = (hb.z < 0.5 ? -1.0 : 1.0) * pwB * (heart ? 0.05 + 0.25 * hh : 1.5 + 2.5 * hh);
      dx = aEff + run - cx;
      dxl = nj > 0 ? 0.12 * bv * (hb.w - 0.5) : 0.0;
      if (nj > 0) {
        float u = hc.x < 0.5 ? ll : Lb - ll;
        D = (0.15 * Lb * hc.z + u + Lb * (0.1 * sin(TAU * (ll / Lb + hc.y)) + 0.05 * sin(TAU * (2.3 * ll / Lb + hc.z)))) / st;
        Dl = ((hc.x < 0.5 ? 1.0 : -1.0) + TAU * (0.1 * cos(TAU * (ll / Lb + hc.y)) + 0.115 * cos(TAU * (2.3 * ll / Lb + hc.z)))) / st;
      } else {
        // A full-length board repeats along the texture: the depth rises and falls (once, with a swell at twice that).
        D = (Lr / (TAU * st)) * (1.0 - cos(TAU * (ll / Lr - hb.w)) + 0.4 * (1.0 - cos(TAU * (2.0 * ll / Lr - hc.y))));
        Dl = (sin(TAU * (ll / Lr - hb.w)) + 0.8 * sin(TAU * (2.0 * ll / Lr - hc.y))) / st;
      }
    } else {
      // One slab: a heart of its own, the across distance wrapped (the far side mirrors, as in a book-matched slab, where
      // the rings run parallel to the seam), the depth rising and falling along the texture; Arches scales the depth's
      // rise (0: straight lines, 1: twice a board's).
      dx = aAbs - hb.x * A - wander;
      dx -= A * floor(dx / A + 0.5);
      D = 2.0 * u_figure * (Lr / (TAU * st)) * (1.0 - cos(TAU * (l / Lr - hb.w)) + 0.2 * (1.0 - cos(TAU * (2.0 * l / Lr - hc.y))));
      Dl = 2.0 * u_figure / st * (sin(TAU * (l / Lr - hb.w)) + 0.4 * sin(TAU * (2.0 * l / Lr - hc.y)));
      dxl = -A * TAU / Lr * (0.12 * cos(TAU * (l / Lr + hwd.z)) + 0.1 * cos(TAU * (2.0 * l / Lr + hwd.x)));
    }
    dx += u_ring_warp * spacing * 2.0 * wn;
    r = length(vec2(dx, D));
    gRa = vec2(dx, dx * dxl + D * Dl) / max(r, 1e-3);
  } else if (u_planks) {
    // Elongated rings around a heart per board (periodic along the board, so full-length boards tile). The
    // nearer the heart sits to the board, the more arches / ovals show.
    // Arches = the fraction of boards sawn near the heart; the others show straight, wobbly lines.
    float hh = hashI(bid, uSeed + 41.0);
    bool heart = hashI(bid, uSeed + 43.0) < u_figure;
    float side = hb.z < 0.5 ? -1.0 : 1.0;
    float cx = side * pwB * (heart ? 0.05 + 0.4 * hh : 1.5 + 2.5 * hh);
    float rl = (Lb / PI) * sin(PI * (ll - hb.w * Lb) / Lb);
    r = length(vec2(aEff - cx, rl / max(u_ring_stretch, 1.0))) + u_ring_warp * spacing * 2.0 * wn;
  } else {
    // One continuous piece: lines along the grain, folded into arches where the (stronger, with Arches)
    // wobble bends them back. Whole rings across the tile.
    if (uTile) { float nr = max(floor(A / spacing + 0.5), 1.0); spacing = A / nr; nRings = int(nr); }
    r = aAbs + u_ring_warp * spacing * 2.0 * wn + slabFold;
  }
  // How fast the ring field changes (rings per px × spacing): small at arch tips and round the heart.
  float gradR = cath ? length(gRa) : length(vec2(dFdx(r), dFdy(r)));

  // Fine grain: value noise stretched along the plank, tileable on the texture lattice, offset per board.
  vec2 gc = vec2(A / u_grain_px, 0.0);
  gc.y = A / u_grain_px * (Lr / A) / u_grain_stretch;
  if (uTile) gc = max(floor(gc + 0.5), vec2(1.0));
  ivec2 gper = uTile ? ivec2(gc + 0.5) : NO_PERIOD;
  // Cathedral: the streaks run in the rings' own flow (their across coordinate is the ring field, warp and all), as the
  // pores of each year's earlywood do — so they bow round the arches instead of crossing the rings.
  float fineX = cath ? r : aAbs + fineBend + run;
  // Streak grouping: the across coordinate through a slow monotonic remap (slope ≤ 0.75), so the streaks bunch.
  bool wrapC = !u_planks && !cath;
  if (u_grain_group > 0.0) {
    float ng = max(floor(A / (6.4 * u_grain_px) + 0.5), 1.0);
    float xg = wrapC ? fineX / A * ng : fineX / (6.4 * u_grain_px);
    fineX += u_grain_group * 3.2 * u_grain_px * wd_n1(xg, wrapC && uTile ? int(ng) : 1 << 20, bid + ivec2(0, 13), uSeed + 89.0);
  }
  vec2 gx = vec2(fineX / A, l / Lr) * gc + hb.xy * vec2(57.0, 31.0);
  // Billowed (|2n − 1|), so the streaks are thin wavy lines where the noise crosses its mean — pores, not dark blotches —
  // and Softness widens their rounded profile instead of blurring the noise. No octave finer than ~2.5 px across: a
  // finer one's creases alias into a grid of dots.
  int fo = clamp(int(floor(log2(max(u_grain_px, 0.6) / 2.5))) + 1, 1, 3);
  float g = org_noiseFbm(0, true, gx, gper, fo, 0.55, uSeed + 11.0);
  // The streaks cluster — a slow noise across the grain thickens and darkens them in some bands, thins others.
  // (Board-local across boards; one slab wraps it round the tile.)
  float nc = max(floor(A / (5.0 * u_grain_px) + 0.5), 1.0);
  float xc = wrapC ? (aAbs + fineBend) / A * nc : (cath ? r : aEff + run) / (5.0 * u_grain_px);
  float cl = wd_n1(xc, wrapC && uTile ? int(nc) : 1 << 20, bid + ivec2(0, 11), uSeed + 83.0);
  // Each streak its own width and darkness (a noise at about the streak spacing), and anti-aliased by the noise's screen
  // derivative — a line thinner than a pixel fades instead of breaking into stair-steps and dots.
  float ns = max(floor(A / (1.7 * u_grain_px) + 0.5), 1.0);
  float xs = wrapC ? (aAbs + fineBend) / A * ns : fineX / (1.7 * u_grain_px);
  float sv = wd_n1(xs, wrapC && uTile ? int(ns) : 1 << 20, bid + ivec2(0, 19), uSeed + 109.0);
  // (At least the noise's typical slope per px: a billowed noise's own derivative vanishes at its crease, right on the
  // streak, and is one per 2×2 pixels — alone it leaves dotted stair-steps.)
  float gfw = max(fwidth(g), 1.5 * (cath ? gradR : 1.0) / u_grain_px);
  float flo = 0.02 + 0.04 * u_grain_soft - 0.4 * fineTh + 0.05 * cl;
  float fhi = flo + (0.14 + 0.1 * u_grain_soft) * (1.0 + 0.6 * sv);
  float fineDark = (1.0 - smoothstep(flo - 0.5 * gfw, fhi + 0.5 * gfw, g)) * (0.75 + 0.25 * cl) * (0.7 + 0.3 * sv);
  // Cathedral: where the ring field changes slowly (arch tips, round the heart: under 3/4 of a px per px) the streaks,
  // which follow it, would widen and smear into blots — they fade out there, leaving the tips clean; and where the flow
  // runs steeply across the board (arch flanks near the tips) the streaks, stretched along the board, would turn into
  // short dashes: they soften there (to 35 %), keeping the clean ring lines.
  if (cath) fineDark *= smoothstep(0.3, 0.75, gradR) * mix(0.35, 1.0, smoothstep(0.55, 0.9, abs(gRa.x) / max(gradR, 1e-4)));

  // Ring irregularity: wide years and narrow ones — r through a smooth monotonic remap (slope 1 ± Ring irregularity).
  // Smooth 1D noise over 2.5 rings: the rings stay in order, typically 3:1 in width.
  // (One slab tiled: a whole number of noise cells round its whole number of rings.)
  // Plus a slow one over 9 rings (bands of tight years between runs of wide ones); together slope ≤ 0.85.
  if (u_ring_var > 0.0) {
    bool wrapR = !u_planks && uTile && !cath;
    float nv = max(floor(float(nRings) / 2.5 + 0.5), 1.0);
    float xr = wrapR ? r / spacing * nv / float(nRings) : r / (2.5 * spacing);
    float nv2 = max(floor(float(nRings) / 9.0 + 0.5), 1.0);
    float xr2 = wrapR ? r / spacing * nv2 / float(nRings) : r / (9.0 * spacing);
    float n2 = wd_n1(xr2, wrapR ? int(nv2) : 1 << 20, bid + ivec2(0, 17), uSeed + 97.0);
    r += u_ring_var * spacing * (0.45 * wd_n1(xr, wrapR ? int(nv) : 1 << 20, bid + ivec2(0, 7), uSeed + 79.0) + 3.5 * n2);
  }
  float t = fract(r / spacing);
  int ri = int(floor(r / spacing));
  int rp = ri - 1;
  if (!u_planks && uTile && !cath) { ri = imod(ri, nRings); rp = imod(rp, nRings); }
  // Rings per pixel.
  float density = length(vec2(dFdx(r), dFdy(r))) / spacing;
  // Each ring darkens through its latewood and stops where the next ring starts. That edge is softened over e (in rings:
  // up to half a ring with Softness, at least a pixel when anti-aliased) centred on the boundary, so the end of the
  // previous ring spills into the start of this one.
  // The darkening widens with it too (to at least half a ring), so a soft ring is a rounded band, not a fainter line.
  // Where the face runs nearly along a ring (arch tips, oval centres: the ring field's gradient g ≪ 1) a ring is many px
  // wide, so its latewood and soft edge would spread into a blot — they keep at most 1.5× their usual px width.
  // (Cathedral: from the exact gradient, so the cap doesn't step in 2 px blocks.)
  float gr = min(1.0, 1.5 * (cath ? gradR : density * spacing));
  float he = 0.5 * clamp(max(0.5 * u_grain_soft * gr, u_aa ? density : 0.0), 2e-4, 1.0);
  float rw = mix(u_ring_line, max(u_ring_line, 0.5), u_grain_soft) * gr;
  // Each ring its own latewood width and darkness; the dark part fades in from deep in the earlywood (Earlywood fade)
  // along a convex ramp, steepest at the ring's sharp outer edge. Height takes the same rings with that edge eased over
  // at least 2 px — lit, a sub-pixel cliff would alias into stair-steps along every sloping ring.
  vec2 hr = hash3I(ivec2(ri, bid.x * 131 + bid.y), uSeed + 19.0).xy;
  float ap = 0.25 + 0.75 * hash3I(ivec2(rp, bid.x * 131 + bid.y), uSeed + 19.0).x;
  float wi = min(rw * (0.4 + 1.2 * hr.y), 0.9);
  float a0 = (1.0 - wi) * (1.0 - 0.8 * u_ring_ramp * gr);
  float ramp = pow(clamp((t - a0) / max(1.0 - a0, 1e-3), 0.0, 1.0), 1.0 + 2.0 * u_ring_ramp);
  float ringDark = ramp * (1.0 - smoothstep(1.0 - he, 1.0 + he, t)) * (0.25 + 0.75 * hr.x) + (1.0 - smoothstep(-he, he, t)) * ap;
  float hH = max(he, min(density, 0.5));
  float ringDarkH = ramp * (1.0 - smoothstep(1.0 - hH, 1.0 + hH, t)) * (0.25 + 0.75 * hr.x) + (1.0 - smoothstep(-hH, hH, t)) * ap;
  // Fade rings that crowd closer than ~2 px (they would alias into moiré).
  ringDark *= 1.0 - smoothstep(0.35, 0.6, density);
  ringDarkH *= 1.0 - smoothstep(0.35, 0.6, density);

  // The pores show most in the earlywood (the light part of each ring), so the streaks band with the rings.
  fineDark *= 1.0 - 0.6 * u_rings * smoothstep(1.0 - rw, 1.0, t);
  float v = 1.0 - 0.85 * clamp(fineK * fineDark + u_rings * ringDark, 0.0, 1.0);
  v = clamp(mix(v, 1.0 - knotDark, knotMask) * (1.0 - 0.4 * knotTail), 0.0, 1.0);
  // Height: the grain at Grain depth on a full-height surface; edges and gaps keep the full range.
  // (From the eased rings.)
  float vH = clamp(mix(1.0 - 0.85 * clamp(fineK * fineDark + u_rings * ringDarkH, 0.0, 1.0), 1.0 - knotDark, knotMask) * (1.0 - 0.4 * knotTail), 0.0, 1.0);
  float hv = mix(1.0, vH, u_grain_depth);
  // A knot in Height: per knot it either stands proud (hard wood, a gentle dome) or has a sunken, shrunken core, with a
  // shallow groove at its rim and its rings showing — not a sunken flat disc.
  float kd = knotSink < 0.4 ? 0.2 + 0.4 * (1.0 - knotKr * knotKr) : 0.4 * knotKr * knotKr;
  kd += 0.25 * smoothstep(0.75, 1.0, knotKr) + 0.12 * (0.5 + 0.5 * sin(TAU * 2.6 * knotKr));
  hv = mix(hv, 1.0 - u_grain_depth * min(kd, 1.0), knotMask);
  // Broad, soft tone over each board (the ring wobble's noise, offset per board) — in colour only, not dents.
  v *= 1.0 - 0.22 * (wn + 0.5);
  // Crown (Height only): domed boards sink at their edges, cupped ones in the middle.
  if (u_planks && u_crown != 0.0) {
    float e2 = clamp(2.0 * la / pwB, -1.0, 1.0);
    e2 *= e2;
    hv *= 1.0 - abs(u_crown) * bestJs * (u_crown > 0.0 ? e2 : 1.0 - e2);
  }
  // Wood output: the grain on the planks — the wrapper multiplies it by their bevel (gaps = 0), from the combined shape.
  GenOut o;
  if (u_output == 0 && u_planks) { o = genOutShaded(v, 1.0, rnd, best); o.bdist = bestA; }
  else o = genOut(v, 1.0, rnd, ${ORG_NO_SDF});
  o.hval = hv;
  // A shut board sits flush: Height › Per-feature variation shrinks with its share (the grain stays).
  o.feat *= bestJs;
  return o;
}
`
};

// ------------------------------------------------------------------------------------------------ scales

export const scalesLayer: LayerDef = {
	type: 'scales',
	label: 'Scales',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Overlapping fish / dragon scales: rows of arches, each row offset by half and overlapping the row behind.',
	params: [
		P.enum(
			'output',
			'Output',
			'scales',
			[
				['scales', 'Scales (shading × edges)'],
				['shape', 'Scale shapes (SDF)']
			],
			{
				hint: 'Scales: the shading (Dome, Tilt, Keel) with bevelled rims and outlines; the outline of the scales goes to the mask it writes too. Shape: the outline of each visible scale for that mask, drawn as the bevel'
			}
		),
		P.int('columns', 'Columns', 4, 1, 128, { softMax: 24, hint: 'Scales per row' }),
		P.int('rows', 'Rows', 0, 0, 256, {
			softMax: 32,
			hint: "0 = auto (row spacing = the scale's length: classic fish scales). Rounded up to even when tiling"
		}),
		P.float('radius', 'Radius', 0.5, 0.25, 1.5, {
			step: 0.001,
			hint: 'Scale radius as a fraction of the column width (0.5 = neighbours touch; more and they lap over each other)'
		}),
		P.float('aspect', 'Aspect', 1, 0.3, 3, {
			softMin: 0.5,
			softMax: 2,
			step: 0.001,
			hint: "Length of a scale along the rows' direction over its width: below 1 broad, flat scales, above 1 long ones. Rows on auto follow it, so the scales still overlap"
		}),
		P.enum(
			'direction',
			'Direction',
			'up',
			[
				['up', 'Arches up'],
				['down', 'Arches down']
			],
			{ hint: 'Up: lower rows lie on top. Down: upper rows lie on top (roof tiles)' }
		),
		P.float('point', 'Point', 0, 0, 1, {
			step: 0.001,
			hint: 'Shape of the free edge: 0 round (fish scales, shingles), 1 a pointed arch (dragon, pine-cone or armour scales)'
		}),
		P.float('wobble', 'Edge wobble', 0.5, 0, 1, {
			step: 0.001,
			hint: "Each scale's outline bulges and flattens a little in its own way (up to ~10 % of its radius), and its dome sits a little off-centre: grown, not stamped"
		}),
		P.enum(
			'edges',
			'Edges',
			'lapped',
			[
				['lapped', 'Lapped'],
				['grooved', 'Grooved']
			],
			{
				hint: "Lapped: each scale's rim is bevelled down onto the scale beneath it and the outline is a crevice line there — scales lie on one another. Grooved: every visible edge, the hidden side too, is bevelled down into an outline gap (tiles in grout)"
			}
		),
		P.float('jitter', 'Irregularity', 0.35, 0, 1, {
			step: 0.001,
			hint: 'Hand-laid instead of stamped: each scale shifts (up to a quarter of a column across, 0.3 of a row along) and turns (up to 12°), growing a little so no holes open. 0 is exactly regular (Edge wobble, separate, still bends the outlines)'
		}),
		P.float('size_var', 'Size variation', 0.3, 0, 1, {
			step: 0.001,
			hint: 'Some scales grow larger than Radius (up to 1.5× at 1) and lap further over their neighbours'
		}),
		P.float('outline', 'Outline', 1, 0, 32, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			hint: 'Dark line along each visible scale edge (Lapped: the crevice just beyond each rim)'
		}),
		P.float('dome', 'Dome', 0.6, 0, 1, { step: 0.001, hint: 'Rounded bulge around each scale centre' }),
		P.float('tilt', 'Tilt', 0.4, 0, 1, {
			step: 0.001,
			hint: 'Scales rise from where they come out from under the row in front to their free edge (shingle-like): the hidden end sits at 1 − Tilt of the height, so each row steps up over the next'
		}),
		P.float('keel', 'Keel', 0, 0, 1, {
			step: 0.001,
			hint: 'A ridge down the middle of each scale (keeled snake scales, ridged tiles): two sloping flanks that fall to 30 % of the height at 1'
		}),
		P.float('keel_w', 'Keel width', 0.6, 0.05, 1, {
			step: 0.001,
			showIf: (p) => Number(p.keel) > 0,
			hint: "How far out the keel's flanks reach, as a share of the scale's radius: small a narrow ridge on a flat scale, 1 the whole scale one V"
		}),
		P.float('lip', 'Lip', 0.5, 0, 1, {
			step: 0.001,
			showIf: (p) => p.edges !== 'grooved',
			hint: "A rolled, slightly raised band just inside each free edge, the plate's thickness catching the light"
		}),
		P.float('growth', 'Growth lines', 0.15, 0, 1, {
			step: 0.001,
			showIf: (p) => p.edges !== 'grooved',
			hint: "Fine lines that follow each scale's edge, wavering and unevenly spaced, fading towards its centre (growth rings of fish scales, layered horn)"
		}),
		P.float('growth_sp', 'Growth spacing', 0.08, 0.03, 0.4, {
			step: 0.001,
			showIf: (p) => p.edges !== 'grooved' && Number(p.growth) > 0,
			hint: "Distance between growth lines as a share of the scale's radius (lines closer than ~2 px fade out)"
		}),
		P.seed()
	],
	defaults: {
		bevel: 2,
		profile: 'smooth',
		h_on: true,
		h_amount: 0.5,
		// A height per scale.
		h_var: 0.3,
		dif_on: true,
		// A light top: Dome × Tilt keep most of a scale below full value.
		dif_grad: gradient('#101412', '#2a3530', '#4a5a51', '#7a8a7e', '#a2b0a2'),
		dif_jitter: 0.15,
		// Rows curving gently.
		dw_amount: 2.5,
		dw_scale: 2
	},
	// Added in the editor: an outline, bevel and row curve that grow with the texture (the plain defaults up to 128 px).
	fresh: ({ width, height }) => {
		const k = Math.max(1, Math.sqrt(width * height) / 128);
		return {
			outline: Math.round(Math.sqrt(k)),
			bevel: Math.round(2 * k ** 0.3),
			dw_amount: Math.round(2.5 * Math.sqrt(k) * 10) / 10
		};
	},
	glsl:
		ORG_GLSL +
		ORG_GLSL_SDF +
		/* glsl */ `
#define SC_MAXW 24
// A scale's shape around its centre: u = q − centre in the scale's frame (user space, y down: the free edge up, u.y < 0),
// r across, s along (Aspect). Round: an ellipse; with Point its free half is a pointed arch — two arcs centred o px to
// either side, each half bounded by the far one — squashed to length s. The distance is divided by the squash's stretch
// along the normal, so bevels keep their width.
float sc_shape(vec2 u, float r, float s, float o) {
  bool pt = u.y < 0.0 && o > 0.0;
  float off = pt ? o : 0.0;
  float k = (pt ? sqrt(1.0 + 2.0 * o / r) : 1.0) * r / s;
  vec2 v = vec2(abs(u.x) + off, u.y * k);
  float L = length(v);
  vec2 n = v / max(L, 1e-6);
  return (L - r - off) / length(vec2(n.x, n.y * k));
}

// Its direction across the outline at u (the distance's gradient, unnormalised), in the scale's frame.
vec2 sc_shapeN(vec2 u, float r, float s, float o) {
  bool pt = u.y < 0.0 && o > 0.0;
  float off = pt ? o : 0.0;
  float k = (pt ? sqrt(1.0 + 2.0 * o / r) : 1.0) * r / s;
  vec2 v = vec2(abs(u.x) + off, u.y * k);
  return vec2((u.x < 0.0 ? -1.0 : 1.0) * v.x, v.y * k);
}
// For Bevel aspect (GLSL_BEVEL): px of Bevel per px across a scale's outline at u, turned by w (its turn) back to the
// screen.
float sc_stretch(vec2 u, float r, float s, float o, float w) {
  vec2 g = sc_shapeN(u, r, s, o);
  float cs = cos(w), sn = sin(w);
  return bevelLine(1.0, vec2(cs * g.x - sn * g.y, sn * g.x + cs * g.y));
}

// Polynomial smooth minimum (k px): the union of the rows in front without creases, for Tilt.
float sc_smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

GenOut gen(vec2 p) {
  int cols = max(u_columns, 1);
  float sw = uRes.x / float(cols);
  float asp = clamp(u_aspect, 0.2, 5.0);
  int rows = u_rows > 0 ? u_rows : max(int(floor(uRes.y / (u_radius * sw * asp) + 0.5)), 1);
  if (uTile) rows += rows & 1;
  float rh = uRes.y / float(rows);
  float R = min(u_radius * sw, 4.0 * rh / asp);
  float S = R * asp;
  // User space (y down) so rows count from the top; "down" mirrors, so front rows are always further down.
  vec2 q = vec2(p.x, u_direction == 1 ? p.y : uRes.y - p.y);
  // Irregularity: centres move by up to jit and turn by up to 12°; every scale grows by the most a centre can move, so the
  // scales still cover everything (no holes open where three meet). Size variation only grows them, for the same reason.
  vec2 jit = u_jitter * vec2(0.25 * sw, 0.3 * rh);
  // (Edge wobble can pull an edge in by up to 0.1 R: grown back by that, too.)
  float grow = length(jit) + u_jitter * 0.1 * abs(S - R) + 0.1 * R * u_wobble;
  float gmax = 1.0 + 0.5 * u_size_var;
  // (Irregularity also lengthens each scale by up to 30 %, so they differ in proportion as well as size.)
  float E = max(R, S * (1.0 + 0.3 * u_jitter)) * gmax + grow;
  // A scale's free edge stays at its row's line (± jitter): grown scales reach further down and sideways, under the row in
  // front, not up over the row behind (which would leave it a sliver). Rows that can reach the pixel: from the front one
  // whose top is above it (rotation can lift a top a little) back to the last whose grown bottom is below it.
  int iHi = int(floor((q.y + jit.y + 0.25 * E) / rh)) + 1;
  int nW = min(int(ceil((2.0 * E - S + 2.0 * jit.y + 0.25 * E) / rh)) + 3, SC_MAXW);
  // Columns round the pixel's in each row: those that can hold the visible scale (one either side, two once a scale
  // reaches past 1.5 columns), each with the three either side that may lap over it, which also keeps a shape coming into
  // the window as the pixel crosses a column too far out to change the smooth union below (Tilt would step there).
  int hw = (E + jit.x > 1.45 * sw ? 2 : 1) + 3;
  int nc = 2 * hw + 1;
  // Rows from the front (lowest) to the back, nc columns round the pixel's in each. A scale's visible part is its shape
  // minus every shape of the rows in front (a running union) and minus the scales of its own row, three columns either
  // side, that rank above it (a random rank per scale), so overlapping neighbours meet along the upper one's rim. One flat
  // loop: a scale is judged when the column three to its right comes in (a window of seven), so each shape is worked out
  // once.
  float ks = 0.25 * R;
  float frontMin = 1e9;
  float frontS = 1e9;
  float rowMin = 1e9;
  float rowS = 1e9;
  float best = 1e9;
  float bestFront = 1e9;
  float bestOcc = 1e9;
  float bestDc = 0.0;
  vec4 bestC = vec4(q, R, 0.0);
  ivec2 bestId = ivec2(0);
  // The window: shapes and stacking ranks of columns c − 6 … c − 1, centres of c − 3 … c − 1.
  vec3 dA = vec3(1e9);
  vec3 dB = vec3(1e9);
  vec3 zA = vec3(0.0);
  vec3 zB = vec3(0.0);
  vec4 cen4 = vec4(0.0);
  vec4 cen3 = vec4(0.0);
  vec4 cen2 = vec4(0.0);
  vec4 cen1 = vec4(0.0);
  // Bevel aspect: each shape's distance stretched (× Bevel / its bevel width across the outline there), the parts
  // combined alike — the visible part as the deeper of its own rim and the rims on top of it, each at its own stretch, so
  // their bevels meet in a clean mitre where they cross. fA / fB: the window's stretches; the occluders' terms carry the
  // Outline (it widens their side of the crevice), the own rim's too.
  bool bevAsp = bevelAspectOn();
  vec3 fA = vec3(1.0);
  vec3 fB = vec3(1.0);
  float frontMinS = 1e9;
  float rowMinS = 1e9;
  float bestS = 1e9;
  int i = 0;
  int c0 = 0;
  float shift = 0.0;
  for (int e = 0; e < SC_MAXW * 11 * ORG_1; e++) {
    int k = e / nc;
    int j = e - nc * k;
    if (k >= nW) break;
    if (j == 0) {
      i = iHi - k;
      shift = 0.5 * float(imod(i, 2));
      c0 = int(floor(q.x / sw - shift));
      rowMin = 1e9;
      rowS = 1e9;
      rowMinS = 1e9;
    }
    int c = c0 - hw + j;
    ivec2 key = uTile ? imod(ivec2(c, i), ivec2(cols, rows)) : ivec2(c, i);
    vec3 h = hash3I(key, uSeed + 5.0);
    // h2.x: the scale's rank in its row — of two that overlap, the higher lies on top. (Ties — a scale meeting its own
    // repeat when a few wide columns tile — go by column, so it laps over itself instead of splitting along a line.)
    vec2 h2 = vec2(hashI(key, uSeed + 7.0) + 1e-5 * float(c), hashI(key, uSeed + 9.0));
    float gi = 1.0 + 0.5 * u_size_var * h.z;
    float Si = S * gi * (1.0 + 0.3 * u_jitter * hashI(key, uSeed + 11.0)) + grow;
    // xy centre, z size factor, w turn (radians).
    vec4 cNew = vec4((float(c) + 0.5 + shift) * sw + (2.0 * h.x - 1.0) * jit.x, float(i) * rh + Si + (2.0 * h.y - 1.0) * jit.y, gi, u_jitter * 0.42 * (h2.y - 0.5));
    vec2 un = q - cNew.xy;
    float cs = cos(cNew.w), sn = sin(cNew.w);
    un = vec2(cs * un.x + sn * un.y, -sn * un.x + cs * un.y);
    float dNew = sc_shape(un, R * gi + grow, Si, 2.0 * u_point * (R * gi + grow));
    float fNew = bevAsp ? sc_stretch(un, R * gi + grow, Si, 2.0 * u_point * (R * gi + grow), cNew.w) : 1.0;
    // Edge wobble: the 2nd and 3rd harmonics of the angle, random per scale (cos 2θ, cos 3θ, sin 3θ from the direction).
    if (u_wobble > 0.0) {
      vec3 hw = 2.0 * hash3I(key, uSeed + 15.0) - 1.0;
      vec2 nu = un / max(length(un), 1e-3);
      dNew -= 0.04 * R * gi * u_wobble * (hw.x * (nu.x * nu.x - nu.y * nu.y) + hw.y * nu.x * (4.0 * nu.x * nu.x - 3.0) + hw.z * nu.y * (3.0 - 4.0 * nu.y * nu.y));
    }
    rowMin = min(rowMin, dNew);
    rowS = sc_smin(rowS, dNew, ks);
    rowMinS = min(rowMinS, (dNew - u_outline) * fNew);
    if (j >= 6) {
      // Column c − 3: covered by the rows in front and by any of the three columns either side that ranks above it.
      float z = zB.x;
      vec3 upA = vec3(zA.x > z ? dA.x : 1e9, zA.y > z ? dA.y : 1e9, zA.z > z ? dA.z : 1e9);
      vec3 upB = vec3(zB.y > z ? dB.y : 1e9, zB.z > z ? dB.z : 1e9, h2.x > z ? dNew : 1e9);
      float occ = min(frontMin, min(min(min(upA.x, upA.y), upA.z), min(min(upB.x, upB.y), upB.z)));
      vec3 sA = (vec3(upA.xy, upA.z) - u_outline) * fA;
      vec3 sB = (upB - u_outline) * vec3(fB.yz, fNew);
      float occS = min(frontMinS, min(min(min(sA.x, sA.y), sA.z), min(min(sB.x, sB.y), sB.z)));
      // Grooved: split from the row neighbours along the bisectors with their centres instead (the midlines
      // when regular), as tiles in grout.
      if (u_edges == 1) {
        vec2 L = cen4.xy - cen3.xy, Rn = cen2.xy - cen3.xy;
        float hL = -dot(q - cen3.xy - 0.5 * L, L) / max(length(L), 1e-3), hR = -dot(q - cen3.xy - 0.5 * Rn, Rn) / max(length(Rn), 1e-3);
        occ = min(frontMin, min(hL, hR));
        if (bevAsp) occS = min(frontMinS, min(bevelLine(hL - u_outline, L), bevelLine(hR - u_outline, Rn)));
      }
      float vis = max(dB.x, -occ);
      if (vis < best) { best = vis; bestS = max((dB.x + u_outline) * fB.x, -occS); bestC = cen3; bestFront = frontS; bestOcc = occ; bestDc = dB.x; bestId = ivec2(c - 3, i); }
    }
    if (j == nc - 1) {
      frontMin = min(frontMin, rowMin);
      frontS = sc_smin(frontS, rowS, ks);
      frontMinS = min(frontMinS, rowMinS);
    }
    dA = vec3(dA.yz, dB.x);
    dB = vec3(dB.yz, dNew);
    fA = vec3(fA.yz, fB.x);
    fB = vec3(fB.yz, fNew);
    zA = vec3(zA.yz, zB.x);
    zB = vec3(zB.yz, h2.x);
    cen4 = cen3;
    cen3 = cen2;
    cen2 = cen1;
    cen1 = cNew;
  }
  ivec2 id = uTile ? imod(bestId, ivec2(cols, rows)) : bestId;
  float rnd = hashI(id, uSeed);
  float d = best + u_outline;
  GenOut g = genOut(0.0, 1.0, rnd, d);
  if (bevAsp) g.bdist = bestS;
  if (u_output == 1) return g;
  vec2 u = q - bestC.xy;
  float cs = cos(bestC.w), sn = sin(bestC.w);
  u = vec2(cs * u.x + sn * u.y, -sn * u.x + cs * u.y);
  float Rb = R * bestC.z + grow;
  float Sb = S * bestC.z * (1.0 + 0.3 * u_jitter * hashI(id, uSeed + 11.0)) + grow;
  // The dome stays where an ungrown scale's would be (its centre a length below the free edge): grown scales grow under
  // the row in front.
  // (Edge wobble: the dome a little off-centre, per scale.)
  vec2 dofs = u_wobble * 0.15 * vec2(Rb, Sb) * (hash3I(id, uSeed + 17.0).xy - 0.5);
  float rr = length(vec2((u.x - dofs.x) / Rb, (u.y + Sb - S - dofs.y) / Sb));
  float dome = sqrt(max(1.0 - rr * rr, 0.0));
  // Tilt: 0 where the scale comes out from under the row in front, 1 at its free edge.
  // (Rising fastest from the hidden end, so less of each scale lies in the dark low end.)
  float tilt = pow(clamp(bestFront / max(bestFront - bestDc, 1e-3), 0.0, 1.0), 0.6);
  // Keel: a V across the scale, its crest rounded over a px or two, its flanks reaching Keel width × the radius.
  float kw = max(u_keel_w * Rb, 1.0);
  float kc = min(1.5, 0.3 * kw);
  float keelV = clamp((sqrt(u.x * u.x + kc * kc) - kc) / max(kw - kc, 1e-3), 0.0, 1.0);
  float shade = mix(1.0, dome, u_dome) * (1.0 - 0.7 * u_keel * keelV);
  float v = shade * mix(1.0, tilt, u_tilt);
  // Grooved: the wrapper multiplies the shading by the bevel of the (combined) shape, every edge into the outline.
  if (u_edges == 1) {
    GenOut o = genOutShaded(clamp(v, 0.0, 1.0), 1.0, rnd, d);
    o.bdist = g.bdist;
    return o;
  }
  // Lapped: the rim (the scale's own edge) is bevelled down to about where the scale beneath starts — the hidden end of a
  // scale sits at 1 − Tilt — and the outline is a crevice on the scale beneath, just beyond the rim of the one on top.
  // (Bevel aspect: across the rim's direction there, turned back to the screen.)
  float bev = 1.0;
  if (u_bevel > 0.0 && u_profile != 0) bev = profileCurve(u_profile, max(-bestDc, 0.0) * (bevAsp ? sc_stretch(u, Rb, Sb, 2.0 * u_point * Rb, bestC.w) : 1.0) / u_bevel);
  // Lip: a band just inside the rim, past the bevel, rises towards full height; the face behind it sinks a little.
  float din = max(-bestDc, 0.0);
  float lw = max(1.5, 0.07 * Rb);
  float lc = u_bevel + lw;
  float lipB = exp(-0.5 * (din - lc) * (din - lc) / (lw * lw));
  v = mix(v * (1.0 - 0.12 * u_lip * smoothstep(lc, lc + 3.0 * lw, din)), 1.0, 0.5 * u_lip * lipB);
  // Every rim comes down to one level (about a rim's own shading at the hidden end), so where a scale lies on another
  // both sides meet there: the covered side slopes down to it over a pixel or two — a clean crevice, never a step.
  float base = mix(1.0, 0.2, u_dome) * (1.0 - u_tilt) * 0.8;
  float hq = mix(base, v, bev);
  // The half pixel beside the rim of a scale lying on this one comes down to that rim's level: the step anti-aliased.
  hq = mix(base, hq, smoothstep(0.0, max(1.25, 0.4 * u_bevel), bestOcc));
  // Slivers: where the visible part is under ~3 px across (own edge to the scale on top), it reads as part of the crevice.
  hq = mix(hq, base, 1.0 - smoothstep(1.5, 3.5, bestOcc - bestDc));
  // Growth lines following the edge (dark in colour, faint grooves in Height): each wavers round the scale (two low
  // harmonics of the angle) and the spacing varies (a monotonic remap, slope ≤ 0.6), they fade towards the focus and
  // where they would crowd under ~2 px (screen derivative), and their strength varies per scale.
  vec3 hg = hash3I(id, uSeed + 13.0);
  float gsp = max(u_growth_sp * Rb, 1.0);
  float ang = atan(u.y, u.x);
  float dg = din + gsp * (0.35 * sin(2.0 * ang + TAU * hg.x) + 0.2 * sin(3.0 * ang + TAU * hg.y));
  dg += 0.3 * gsp * sin(TAU * dg / (3.1 * gsp) + TAU * hg.z);
  float gfw = length(vec2(dFdx(dg), dFdy(dg))) / gsp;
  float gl = pow(0.5 + 0.5 * cos(TAU * dg / gsp), 4.0) * smoothstep(0.5 * lc, lc, din) * smoothstep(0.12, 0.45, rr)
           * (1.0 - smoothstep(0.25, 0.5, gfw)) * (0.6 + 0.4 * hg.x) * u_growth;
  float crev = u_outline > 0.0 ? 1.0 - smoothstep(u_outline - 0.5, u_outline + 0.5, bestOcc) : 0.0;
  // Holes (rows set far apart): nothing covers the pixel.
  // (The union of every scale walked, not the visible part's own distance, which is ~0 along every lap.)
  float inside = clamp(0.5 - frontMin, 0.0, 1.0);
  GenOut o = genOutOwn(clamp(hq * (1.0 - 0.35 * gl) * (1.0 - crev) * inside, 0.0, 1.0), 1.0, rnd, d);
  float hh = hq * (1.0 - 0.15 * gl);
  // Per-feature variation (Height): only the relief above the level the rims come down to varies, so a scale lying on
  // another never ends up below it where they meet (the wrapper's own variation, a factor on everything, is off).
  hh = base + (hh - base) * (1.0 - u_h_var * fract(rnd * 61.37 + 0.123));
  o.hval = clamp(hh * (1.0 - 0.5 * crev) * inside, 0.0, 1.0);
  o.feat = 0.0;
  return o;
}
`
};
