// Bands: thick bands with mitred bends that run across the tile in lanes — diagonal bars, a zig-zag band,
// nested chevrons, and tech-wall Z steps (low run → rise → high run, chamfered ends), optionally with rails along
// the lane edges. Exact distances (px) so bevels, profiles and masks work; rnd per bar / piece / lane.

import { P, gradient, orientAxis } from '@/core/params';
import type { LayerDef } from '../types';
import { geoGlsl } from './geometricCommon';

// Band thickness, margins and rails are across the bands, the chamfer along them; diagonals scale with both.
const BAND_AXIS: Record<string, 'x' | 'y'> = { '0': 'x', '180': 'x', '90': 'y', '270': 'y' };
const bandsAlong = orientAxis('orient', BAND_AXIS);
const bandsAcross = orientAxis('orient', BAND_AXIS, true);

const modeIs =
	(...m: string[]) =>
	(p: Record<string, unknown>) =>
		m.includes(String(p.mode));

/** Directions in 45° steps; the index is the frame rotation (steps clockwise). */
const DIRECTIONS: [string, string][] = [
	['0', 'Horizontal'],
	['45', 'Diagonal 45°'],
	['90', 'Vertical'],
	['135', 'Diagonal 135°'],
	['180', 'Horizontal (flipped)'],
	['225', 'Diagonal 225°'],
	['270', 'Vertical (flipped)'],
	['315', 'Diagonal 315°']
];

export const bandsLayer: LayerDef = {
	type: 'bands',
	label: 'Bands',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Thick diagonal / zig-zag / chevron / Z-step bands in lanes between horizontal strips (tech-wall look), seamless, with mitred bends, chamfered or rounded ends, optional rails and per-piece variation.',
	params: [
		P.enum('mode', 'Shape', 'z', [
			['diagonal', 'Diagonal bars'],
			['zigzag', 'Zig-zag band'],
			['chevron', 'Chevrons'],
			['z', 'Z steps']
		]),
		P.int('count', 'Count', 2, 1, 128, { softMax: 32, hint: 'Repeats along the band direction' }),
		P.int('rows', 'Rows', 3, 1, 128, {
			softMax: 32,
			hint: 'Lanes stacked across the band direction (chevrons: stripe spacing)'
		}),
		P.float('width', 'Band width', 32, 0.5, 2048, {
			softMax: 128,
			unit: 'px',
			axis: bandsAcross,
			step: 0.1,
			hint: 'Thickness across the band'
		}),
		P.float('width_var', 'Width variation', 0, 0, 1, {
			step: 0.001,
			hint: 'Each piece (bar, Z piece) or lane (zig-zag, chevron) gets its own thickness, down to (1 − 0.8 × this) × Band width; its bevel, chamfer and rounding scale with it'
		}),
		P.float('margin_top', 'Top margin', 20, 0, 1024, {
			softMax: 128,
			unit: 'px',
			axis: bandsAcross,
			step: 0.1,
			showIf: modeIs('diagonal', 'zigzag', 'z'),
			hint: 'Clear strip along the top of each lane (in the band frame). Diagonal bars with both margins 0 run through as seamless stripes'
		}),
		P.float('margin_bottom', 'Bottom margin', 20, 0, 1024, {
			softMax: 128,
			unit: 'px',
			axis: bandsAcross,
			step: 0.1,
			showIf: modeIs('diagonal', 'zigzag', 'z'),
			hint: 'Clear strip along the bottom of each lane'
		}),
		P.float('rail', 'Rails', 17, 0, 1024, {
			softMax: 64,
			unit: 'px',
			axis: bandsAcross,
			step: 0.1,
			showIf: modeIs('diagonal', 'zigzag', 'z'),
			hint: 'Strips this thick along the lane edges, shared by neighbouring lanes (centred on the edge, so they eat half into each margin): the horizontal rails of a tech wall. 0 = none'
		}),
		P.float('rail_h', 'Rail height', 0.7, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.rail) > 0 && p.mode !== 'chevron',
			hint: 'The rails’ level against the bands (1 = as high; lower sets the bands off from their frame). Also scales their Pattern value, so it shades them in Diffuse › Pattern'
		}),
		P.float('angle', 'Angle', 45, -90, 90, {
			unit: '°',
			step: 0.1,
			hint: 'Slope of the rising parts (negative mirrors). Diagonal bars with 0 margin snap to a seamless slope. A zig-zag that can’t climb its lane within a repeat at this angle gets steeper, unless Keep angle is on'
		}),
		P.float('amp', 'Amplitude', 1, 0, 1, {
			step: 0.001,
			showIf: modeIs('zigzag'),
			hint: 'How much of the lane the zig-zag climbs, centred (1 = margin to margin). With Keep angle it is lowered further when the slope needs it'
		}),
		P.bool('keep_angle', 'Keep angle', true, {
			showIf: modeIs('zigzag'),
			hint: 'Zig-zag: when the slope can’t climb the whole lane within a repeat, lower the zig-zag (centred in the lane) instead of steepening it. Off: it always spans the lane, the slope steepening as needed'
		}),
		P.float('run', 'Run', 0.4, 0, 1, {
			step: 0.001,
			showIf: modeIs('z', 'zigzag', 'chevron'),
			hint: 'Z: flat run length (fraction of the repeat). Zig-zag: share of the flats on the high side (there are flats only when the slope leaves room: a steeper angle or fewer repeats). Chevron: flat top/bottom fraction (0 = pointed)'
		}),
		P.float('run_var', 'Run variation', 0.5, 0, 1, {
			step: 0.001,
			showIf: modeIs('z'),
			hint: 'Each Z piece gets its own low and high run lengths (at 1: 0.25 to 1.75 × Run): short and long steps'
		}),
		P.float('rise_var', 'Rise variation', 0.6, 0, 1, {
			step: 0.001,
			showIf: modeIs('z'),
			hint: 'Each Z piece climbs only part of the lane from its low run (at 1: down to a fifth, mostly well below full): low steps among full ones. Not in the fill modes, whose panels need full-height pieces'
		}),
		P.float('chamfer', 'End chamfer', 9, 0, 1024, {
			softMax: 64,
			unit: 'px',
			axis: bandsAlong,
			step: 0.1,
			showIf: modeIs('z'),
			hint: '45° chamfer on the band ends (up to half the band width: a pointed end)'
		}),
		P.float('round', 'Corner rounding', 0, 0, 1024, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			hint: 'Rounds convex corners (outer bends, ends); half the band width gives round ends and bends'
		}),
		P.float('outline', 'Outline', 0, 0, 1024, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			hint: '> 0 turns the shape into an inner outline this thick'
		}),
		P.enum(
			'fill',
			'Fill',
			'band',
			[
				['band', 'Band'],
				['between', 'Between bands'],
				['above', 'Above the band'],
				['below', 'Below the band']
			],
			{
				hint: 'Between: the lane interior minus the bands. Above / below (zig-zag only): just the panels on one side, e.g. a row of trapezoids. The panels are the shape (raised); Height › Subtract sinks them'
			}
		),
		P.bool('even', 'Even panel edges', true, {
			showIf: (p) => p.fill !== 'band' && (p.mode === 'z' || p.mode === 'zigzag'),
			hint: 'Fill modes: the runs lie against the rails (on the lane edges without rails) and the panels keep one band width from them, so every joint is one band width and the panel edges are straight. The margins are not used'
		}),
		P.float('phase', 'Phase', 0, 0, 1, { step: 0.001, hint: 'Shift along the band, fraction of a repeat' }),
		P.float('jitter', 'Shift jitter', 0, 0, 1, {
			step: 0.001,
			hint: 'Slides each lane along the band by its own random amount (1 = up to ± half a repeat): staggered, less regular rows'
		}),
		P.float('stagger', 'Lane stagger', 0.7, 0, 1, {
			step: 0.001,
			showIf: modeIs('diagonal', 'z'),
			hint: 'Z steps and bars between margins: each lane starts at its own random point along the band (1 = up to ± half a repeat). Like Shift jitter, but ignored where the lanes must line up (zig-zags, chevrons, through stripes), so switching Shape keeps those intact'
		}),
		P.float('jitter_piece', 'Spacing jitter', 0, 0, 1, {
			step: 0.001,
			showIf: modeIs('diagonal', 'z'),
			hint: 'Slides each bar / Z piece along the band by its own random amount (1 = up to ± half a repeat): uneven spacing, pieces may touch or overlap'
		}),
		P.float('skip', 'Missing pieces', 0, 0, 1, {
			step: 0.001,
			hint: 'Share of pieces left out at random (bars, Z pieces; whole lanes for zig-zags and chevrons)'
		}),
		P.bool('mirror', 'Mirror alternate rows', false, {
			hint: 'Flip every other lane across the band (hourglass / symmetric panels); rows are made even when tiling. Not for chevrons'
		}),
		P.enum('orient', 'Direction', '0', DIRECTIONS, {
			hint: 'Which way the bands run. Diagonal directions repeat over the texture’s diagonal, so counts are rounded to fit it'
		}),
		P.seed()
	],
	// A tech wall: three lanes of staggered Z steps between lower rails, each piece its own run lengths, climb, height
	// and shade of metal; crowned (the custom curve's steep edge and gentle rise over half the band).
	defaults: {
		h_on: true,
		h_amount: 0.4,
		h_var: 0.3,
		bevel: 16,
		profile: 'custom',
		dif_on: true,
		dif_src: 'random',
		dif_grad: gradient('#776d5f', '#a79d8d')
	},
	// Added in the editor: the sizes follow the texture — three lanes (fewer on wide trims), band, margins, rails, chamfer
	// and bevel scaled to the lane height, rounded to whole px (half px on tiny textures).
	fresh: ({ width, height }) => {
		const rows = Math.max(1, Math.round(3 * Math.min(1, height / width)));
		const lane = height / rows;
		const px = (v: number) => (v >= 8 ? Math.round(v) : Math.max(0.5, Math.round(v * 2) / 2));
		const w = px(0.19 * lane);
		return {
			count: Math.max(1, Math.round(width / (1.5 * lane))),
			rows,
			width: w,
			margin_top: px(0.12 * lane),
			margin_bottom: px(0.12 * lane),
			rail: px(0.1 * lane),
			chamfer: px(0.055 * lane),
			bevel: px(Math.max(1, 0.5 * w))
		};
	},
	glsl:
		geoGlsl(8) +
		/* glsl */ `
#define BND_1 (uRes.x > 0.0 ? 1 : 0)   // 1, from a uniform: a loop bound D3D can't unroll
#define BND_MITRE 4.0                 // mitre tips are clipped this many half widths from the bend
#define BND_EPS 1e-3

// The band being measured: half width less the corner rounding, and the end chamfer less the rounding's share (px).
float bnd_h, bnd_c;

// Bevel aspect (GLSL_BEVEL): with bnd_asp, each piece also leaves in bnd_s its distance in px of Bevel — every edge's
// distance over its own bevel width (bevelLine), combined as the distance is (max at a mitre, min across pieces), so the
// bevels of edges at different angles meet in a clean mitre. The rounding bnd_rc is taken off each edge there (the
// distance takes it off at the end); past a corner of the core, its rounding's arc counts too (along the way out of the
// corner: its tangent there), so the edges' terms carry on across into the corner without a seam.
// bnd_L: a local direction (along / across the band) on screen.
bool bnd_asp;
float bnd_s, bnd_rc;
mat2 bnd_L;
float bnd_ln(float d, vec2 n) { return bevelLine(d, bnd_L * n); }

// Exact signed distance to a half-strip |s| <= bnd_h, t >= 0 whose end (t = 0) has its corners chamfered by bnd_c
// (t along the strip from its end, v = |s|): the end line, the chamfers and the side, with the corner regions. te, ve:
// the local directions of t and v (Bevel aspect).
float bnd_end(float t, float v, vec2 te, vec2 ve) {
  vec2 w1 = vec2(t, v - bnd_h + bnd_c), w2 = vec2(t - bnd_c, v - bnd_h);
  bool c1 = w1.y >= 0.0 && w1.x + w1.y <= 0.0;
  bool c2 = !c1 && w2.x <= 0.0 && w2.x + w2.y >= 0.0;
  float ch = (v - t - bnd_h + bnd_c) * 0.70710678;
  if (bnd_asp) {
    vec2 wc = c1 ? w1 : w2;
    bnd_s = max(max(bnd_ln(-t - bnd_rc, te), bnd_ln(v - bnd_h - bnd_rc, ve)), bnd_ln(ch - bnd_rc, ve - te));
    if (c1 || c2) bnd_s = max(bnd_s, bnd_ln(length(wc) - bnd_rc, wc.x * te + wc.y * ve));
  }
  if (c1) return length(w1);
  if (c2) return length(w2);
  return max(max(-t, v - bnd_h), ch);
}

// The band along one centre-line segment from a (unit direction e, length l): a capsule — the neighbouring segments
// and the bend (bnd_joint) complete it there — or, where fa / fb, a flat chamfered end. The band is the union (min) of
// its segments and bends: the capsules' min is the distance to the centre line, exact but for the mitres and the inner
// corners, which bnd_joint supplies.
float bnd_seg(vec2 q, vec2 a, vec2 e, float l, bool fa, bool fb) {
  vec2 w = q - a;
  float cr = e.x * w.y - e.y * w.x;
  float t = dot(w, e), v = abs(cr);
  vec2 ve = (cr < 0.0 ? -1.0 : 1.0) * vec2(-e.y, e.x);
  bool useA = fa && (!fb || t < 0.5 * l);
  bool useB = fb && !useA;
  bool endA = useA && t <= l;
  if (endA || (useB && t >= 0.0)) return bnd_end(endA ? t : l - t, v, endA ? e : -e, ve);
  float tt = max(max(-t, t - l), 0.0);
  float d = length(vec2(tt, v)) - bnd_h;
  // (Bevel aspect: the strip's sides only — past its ends the bends (or the next segment) cover the band, and a round
  // end's distance along its radius would bevel deeper than theirs where the widths differ.)
  if (bnd_asp) bnd_s = tt > 0.0 ? 1e9 : bnd_ln(d - bnd_rc, ve);
  return d;
}

// A bend at c from direction ea into eb (la, lb: how much of the segments either side is free for its inner corner):
// exact signed distance where q lies between the inner corner and the mitred outer corner — the two outer side lines,
// the mitre's apex, and the inner corner point — else 1e9. Robust where a plain offset polygon would fold over itself
// (sharp peaks, bands wider than their segments): there the inner corner isn't used, and the mitre tip is clipped
// flat at BND_MITRE half widths.
float bnd_joint(vec2 q, vec2 c, vec2 ea, vec2 eb, float la, float lb) {
  float cr = ea.x * eb.y - ea.y * eb.x;
  if (abs(cr) < 1e-5) return 1e9;
  float sg = cr > 0.0 ? 1.0 : -1.0;
  vec2 oa = sg * vec2(ea.y, -ea.x), ob = sg * vec2(eb.y, -eb.x);   // outer normals
  float k = 1.0 / max(1.0 + dot(oa, ob), 1e-6);
  vec2 mo = bnd_h * (oa + ob) * k;                                 // outer mitre apex (the inner corner is -mo)
  bool inner = bnd_h * abs(cr) * k <= min(la, lb);
  vec2 w = q - c;
  vec2 wb = inner ? w + mo : w;
  bnd_s = 1e9;
  if (dot(wb, ea) < 0.0 || dot(wb, eb) > 0.0) return 1e9;
  vec2 wm = w - mo;
  bool apex = dot(wm, ea) >= 0.0 && dot(wm, eb) <= 0.0;
  vec2 nm = normalize(oa + ob);
  float d = apex ? length(wm) : max(dot(w, oa), dot(w, ob)) - bnd_h;
  d = max(d, dot(w, nm) - BND_MITRE * bnd_h);
  if (bnd_asp) {
    float s = max(max(bnd_ln(dot(w, oa) - bnd_h - bnd_rc, oa), bnd_ln(dot(w, ob) - bnd_h - bnd_rc, ob)),
                  bnd_ln(dot(w, nm) - BND_MITRE * bnd_h - bnd_rc, nm));
    if (apex) s = max(s, bnd_ln(length(wm) - bnd_rc, wm));
    // The inner corner along the way out of it (where it takes over from a side, that side's normal).
    bnd_s = inner ? max(s, bnd_ln(-length(wb) - bnd_rc, wb)) : s;
  }
  return inner ? max(d, -length(wb)) : d;
}

// Bevel aspect: a box's distance (r from its centre, half size hs, local axes) in px of Bevel, as bnd_s.
float bnd_boxS(vec2 r, vec2 hs) {
  vec2 bq = abs(r) - hs;
  return bq.x > 0.0 && bq.y > 0.0 ? bnd_ln(length(bq), bq * sign(r))
       : max(bnd_ln(bq.x, vec2(1.0, 0.0)), bnd_ln(bq.y, vec2(0.0, 1.0)));
}

// A Z piece as drawn before its runs are fitted to its neighbours: the rise starts at R (at height y1, climbing Dk to
// y2), the low and high runs want L1 / L2. kk: its key, x0: where its repeat starts. Spacing jitter moves it by up to
// ± pj / 2; Run variation spreads the rises by up to ± J / 2 and the runs over 0.25…1.75 × L; Rise variation (sv) climbs
// only a share f of the lane, from the low run up.
void bnd_zpiece(ivec2 kk, float x0, float L, float J, float pj, float rv, float sv, float fmin, float Rr, float yl, float D,
                out float R, out float L1, out float L2, out float y1, out float y2, out float Dk) {
  // One hash chain per piece (cheap to compile): runs, climb, rise jitter, spacing jitter.
  uint h = pcg3(uvec3(uint(kk.x), uint(kk.y), uint(uSeed + 11.0)));
  float h1 = u2f(h); h = pcg(h);
  float h2 = u2f(h); h = pcg(h);
  float h3 = u2f(h); h = pcg(h);
  float h5 = u2f(h); h = pcg(h);
  L1 = L * (1.0 + rv * (1.5 * h1 - 0.75));
  L2 = L * (1.0 + rv * (1.5 * h2 - 0.75));
  R = x0 + (u2f(h) - 0.5) * pj + L + J * (h5 - 0.5);
  float f = max(1.0 - sv * sqrt(h3), fmin);   // mostly clearly lower than full, never below fmin
  y1 = yl;
  y2 = y1 + Rr * f;
  Dk = D * f;
}

GenOut gen(vec2 p) {
  int mode = u_mode;
  geo_frame(p, u_orient);
  float kx = geo_count(float(u_count), 1);
  float ky = geo_count(float(u_rows), u_mirror ? 2 : 1);
  geo_periods(vec2(kx, ky));
  float P = geo_cs.x, Hl = geo_cs.y;
  float fy = geo_f.y;
  int lane = int(floor(fy / Hl));
  float ly = fy - float(lane) * Hl;
  if (u_mirror && mode != 2 && (lane & 1) == 1) ly = Hl - ly;   // (chevrons overlap lanes: no mirroring)
  float sgn = u_angle < 0.0 ? -1.0 : 1.0;
  float x = (geo_f.x - u_phase * P) * sgn;   // negative angles mirror along the band
  // Bevel aspect (not on an outline: its inner edge keeps the distance's direction).
  bnd_asp = bevelAspectOn() && u_outline <= 0.0;
  bnd_L = mat2(geo_toScreen(vec2(sgn, 0.0)), geo_toScreen(vec2(0.0, u_mirror && mode != 2 && (lane & 1) == 1 ? -1.0 : 1.0)));
  float bestS = 1e9;
  vec2 barV[4];   // the winning bar (its polygon, anchor and rounding), measured after the search
  float barA = 0.0, barR = 0.0;
  float ang = clamp(abs(u_angle), 1.0, 90.0);
  float s = ang >= 89.99 ? 1e6 : tan(radians(ang));
  float hw = 0.5 * u_width;
  float mt = u_margin_top, mb = u_margin_bottom;
  // Even panel edges (fill modes, Z / zig-zag): the runs lie against the rails, or on the lane edges without rails,
  // and the panels keep one band width from them — every joint is one band width (the margins aren't used).
  if (u_even && u_fill >= 1 && (mode == 1 || mode == 3)) { mt = u_rail > 0.0 ? 0.5 * u_rail : -0.5 * u_width; mb = mt; }
  float r = clamp(u_round, 0.0, hw);
  int kxi = int(kx + 0.5), kyi = int(ky + 0.5);
  int laneW = uTile ? imod(lane, kyi) : lane;
  float yl = mb + hw, yh = Hl - mt - hw;
  float Rr = max(yh - yl, 0.0);
  geo_s = vec2(1.0);
  geo_reset();

  // Per-mode layout. Waves (zig-zag, chevrons): low flat Fl, rise D, high flat Fh, fall D per repeat, between lo and hi.
  float D = 0.0, Fl = 0.0, Fh = 0.0, lo = yl, hi = yh;
  int nPer = 1, nL = 0, nIt = 3;
  // Diagonal bars: parallelograms spanning the lane interior (perpendicular thickness = width).
  float Hi = Hl - mt - mb;
  float sinA = sin(radians(ang));
  bool through = mt <= 0.0 && mb <= 0.0;
  float slope = 0.0;
  int nRun = 0, kThr = kxi, kd0 = 0;
  // Z pieces: low run L, rise D, high run L.
  float L = 0.0, span = 0.0;
  int kLo = 0;
  if (mode == 0) {
    float run = Hi / s;
    if (through && uTile) {
      nRun = int(floor(run / P + 0.5));
      run = float(nRun) * P;
      // A stripe crosses all lanes, advancing nRun repeats per lane, so stripes are only told apart modulo this.
      kThr = geo_gcd(kxi, nRun * kyi);
    }
    slope = Hi > 0.0 ? run / Hi : 0.0;   // x shift per px of height
    nIt = Hi > 0.0 ? 3 : 0;
  } else if (mode == 1 || mode == 2) {
    float A;
    if (mode == 1) {
      // One band per lane between the margins (Amplitude: part of the lane, centred); run splits the flats between
      // the high and low runs. A slope that can't climb within a repeat steepens, or with Keep angle is lowered.
      A = clamp(u_amp, 0.0, 1.0) * Rr;
      if (u_keep_angle) A = min(A, 0.5 * s * P);
      lo = yl + 0.5 * (Rr - A);
      hi = lo + A;
      D = A / s;
      if (2.0 * D > P) D = 0.5 * P;
      Fh = (P - 2.0 * D) * clamp(u_run, 0.0, 1.0);
    } else {
      // Nested chevrons: amplitude from the slope, stacked every lane height; lanes searched as far as they reach.
      D = 0.5 * (1.0 - clamp(u_run, 0.0, 0.98)) * P;
      Fh = 0.5 * (P - 2.0 * D);
      A = min(s * D, 2.0 * (7.5 * Hl - BND_MITRE * hw));
      A = max(A, 0.0);
      lo = 0.5 * (Hl - A);
      hi = lo + A;
      nL = clamp(int(ceil((0.5 * A + BND_MITRE * hw) / Hl + 0.5)), 2, 8);
    }
    Fl = P - 2.0 * D - Fh;
    // Repeats either side: as far as the band (and its mitre tips) reaches.
    float reach = hw * (1.0 + min(BND_MITRE, sqrt(1.0 + A * A / max(D * D, 1e-6))));
    nPer = clamp(int(ceil(reach / P)), 1, 4);
    nIt = 4 * (2 * nPer + 1) * (2 * nL + 1);
  } else {
    D = min(Rr / s, 8.0 * P);
    L = max(clamp(u_run, 0.0, 1.0) * P, 0.01);
    span = 2.0 * L + D;
  }
  float Ls = length(vec2(D, hi - lo));
  vec2 rise = Ls > BND_EPS ? vec2(D, hi - lo) / Ls : vec2(1.0, 0.0);
  vec2 fall = vec2(rise.x, -rise.y);

  // This lane's shift along the band (Shift jitter), and where that puts the pixel. Spacing jitter moves each bar /
  // Z piece by up to ± pj / 2, so one more candidate either side is searched.
  float jit = u_jitter * P;
  float stg = mode == 3 || (mode == 0 && !through) ? clamp(u_stagger, 0.0, 1.0) * P : 0.0;   // Lane stagger
  float xs = x - (jit + stg > 0.0 ? (hashI(ivec2(laneW, 7), uSeed + 13.0) - 0.5) * (jit + stg) : 0.0);
  float pj = mode == 0 || mode == 3 ? clamp(u_jitter_piece, 0.0, 1.0) * P : 0.0;
  int pe = pj > 0.0 ? 1 : 0;
  if (mode == 0) {
    kd0 = int(floor((xs - (ly - mb) * slope) / P)) - pe;
    nIt = Hi > 0.0 ? 3 + 2 * pe : 0;
  }
  // Run variation (Z): each rise moves by up to ± J / 2, consecutive rises staying a band and a joint (one band width)
  // apart; the runs are fitted to the neighbours in the loop.
  float rv = mode == 3 ? clamp(u_run_var, 0.0, 1.0) : 0.0;
  float sinR = max(rise.y, 0.05);
  // The rises spread only as far as leaves every run its shortest flat beside an even neighbour: a rise, a joint and
  // the flat between consecutive rises (and at least a band and a joint between the rises themselves).
  float mfz = min(u_width + u_chamfer, L);
  float J = rv * max(P - max(2.0 * u_width / sinR, hw * rise.x / sinR + (hw + u_width) / sinR + mfz), 0.0);
  // Rise variation only off the fill modes (their panels need full-height pieces); with Even panel edges the runs lie
  // in the frame's joint, so they keep their lengths unfitted (the rises still spread).
  float sv = mode == 3 && u_fill == 0 ? 0.8 * clamp(u_rise_var, 0.0, 1.0) : 0.0;
  bool vary = (rv > 0.0 || sv > 0.0) && !(u_even && u_fill >= 1);
  // The lowest climb keeps a high run clear of the low runs beside it (a band and a half above them).
  float fmin = min(1.5 * u_width / max(Rr, 1e-4), 1.0);
  if (mode == 3) {
    kLo = int(floor((xs - span - 1.5 * rv * L - 0.5 * J - u_width) / P)) - pe;
    nIt = 6 * clamp(int(floor((xs + u_width + 0.75 * rv * L + 0.5 * J) / P)) + pe - kLo + 1, 0, 18);
  }
  bool fillM = u_fill >= 1;
  float wv = 0.8 * clamp(u_width_var, 0.0, 1.0);
  // The bands touch the margins (zig-zag: unless Keep angle lowered it). In the fill modes a band's ends and outer
  // corners there are squared off ("feet"), so a panel never wraps a chamfer or rounding into the margin.
  bool touch = mode == 3 || (mode == 1 && lo <= yl + 0.01);
  float tq = rise.y > 1e-4 ? (1.0 - rise.x) / rise.y : 0.0;   // tan of half the slope angle
  // Fill modes, bars and Z pieces: the piece left of the pixel names the panel it lies in.
  float leftX = -1e9;
  ivec2 leftKey = ivec2(0);
  // The current Z piece, set on its first segment and kept for the other two: low run zL1 from zx0 at zy1, rise zDk
  // (the same slope, length zLk) to zy2, high run zL2.
  float zx0 = 0.0, zL1 = L, zL2 = L, zy1 = yl, zy2 = yh, zDk = D, zLk = Ls;
  // The Z pieces k − 1, k, k + 1 as drawn before fitting (p, c, n): rise start R, wanted runs, heights, climb.
  float cR = 0.0, cL1 = L, cL2 = L, cy1 = yl, cy2 = yh, cD = D;
  float pR = 0.0, pL2 = L, py1 = yl, py2 = yh, pD = D, nR = 0.0, nL1 = L, ny1 = yl, ny2 = yh, nD = D;

  // One flat loop over every candidate piece (diagonal: bars; Z: piece × segment; waves: lane × repeat × segment),
  // so each helper exists once in the shader. No continue (ANGLE / D3D can miscompile it): guarded bodies instead.
  for (int it = 0; it < 640 * BND_1; it++) {
    if (it >= nIt) break;
    int m = it - 4 * (it / 4);   // segment of a wave repeat
    int j = it / 4;
    int per = 2 * nPer + 1;
    int dl = mode == 2 ? j / per - nL : 0;
    int lc = lane + dl;
    int lcW = uTile ? imod(lc, kyi) : lc;
    float xc = xs;
    if (dl != 0 && jit > 0.0) xc = x - (hashI(ivec2(lcW, 7), uSeed + 13.0) - 0.5) * jit;
    int k = mode == 0 ? kd0 + it - 1 : mode == 3 ? kLo + it / 6 : int(floor(xc / P)) + j - (j / per) * per - nPer;
    int id = mode == 0 && through ? k - nRun * lane : k;
    ivec2 key = mode == 0 ? (through ? ivec2(imod(id, kThr), 0) : ivec2(imod(id, kxi), laneW))
              : mode == 3 ? ivec2(imod(k, kxi), laneW) : ivec2(lcW, 0);
    vec3 hv = hash3I(key, uSeed + 7.0);   // width, missing, spacing
    bool on = hv.y >= u_skip;
    bool footOn = on;
    float hc = hw * (1.0 - wv * hv.x);
    float sc = hc / max(hw, 1e-4);   // the piece's scale: its rounding and chamfer follow its width
    float x0 = float(k) * P + (hv.z - 0.5) * pj;
    vec2 q = vec2(xc, ly);
    if (mode == 0) {
      if (on) {
        float rc = min(r * sc, hc - 0.01);
        float wx = 2.0 * hc / max(sinA, 1e-3);
        float xo = (hw - hc) / max(sinA, 1e-3);   // thinner bars stay centred
        // Through stripes, and bars in the fill modes, run past the margins (cut there), so no rounded corner shows.
        float ext = through || fillM ? hw + r + 2.0 : 0.0;
        float yb = mb - ext, yt = Hl - mt + ext;
        geo_f = q;
        geo_in = rc;
        geo_r = rc;
        geo_begin();
        geo_addPx(vec2((yb - mb) * slope + xo, yb));
        geo_addPx(vec2((yb - mb) * slope + xo + wx, yb));
        geo_addPx(vec2((yt - mb) * slope + xo + wx, yt));
        geo_addPx(vec2((yt - mb) * slope + xo, yt));
        geo_finish();
        float pd = geo_bestD;
        geo_try(vec2(x0, 0.0), 0, key);
        if (bnd_asp && geo_bestD < pd) {
          for (int i = 0; i < 4; i++) barV[i] = geo_V[i];
          barA = x0;
          barR = rc;
        }
        float xb = x0 + xo + (ly - mb) * slope;   // the bar's left edge at this height
        if (xb <= xs && xb > leftX) { leftX = xb; leftKey = key; }
      }
    } else {
      // A centre-line segment a → (direction e, length l), the direction ep coming into a, and flat ends. lp / ln:
      // room for the inner corner of the bend at a on the segments before and after it — half of each (a bend at its
      // other end needs the rest), or all of a Z run less a half width (its other end is flat).
      vec2 a, e, ep;
      float l, lp, ln;
      bool fa = false, fb = false, joint = true, zLow = false, zHigh = false;
      float yo = float(dl) * Hl;
      if (mode == 3) {
        // Six steps per Z piece, one flat loop: 0–2 draw the pieces k − 1, k, k + 1 (the neighbours only with Run /
        // Rise variation), 3–5 its segments.
        int sub = it - 6 * (it / 6);
        int sz = sub - 3;
        if (sub < 3) {
          on = false;
          footOn = false;
          if (vary || sub == 1) {
            int kk = k + sub - 1;
            ivec2 kq = ivec2(imod(kk, kxi), laneW);
            float R_, a1, a2, b1, b2, dk;
            bnd_zpiece(kq, float(kk) * P, L, J, pj, rv, sv, fmin, Rr, yl, D, R_, a1, a2, b1, b2, dk);
            if (sub == 0) { pR = R_; pL2 = a2; py1 = b1; py2 = b2; pD = dk; }
            else if (sub == 1) { cR = R_; cL1 = a1; cL2 = a2; cy1 = b1; cy2 = b2; cD = dk; }
            else { nR = R_; nL1 = a1; ny1 = b1; ny2 = b2; nD = dk; }
          }
        } else if (sz == 0) {
          // Fit the runs to the neighbours: a run stops a joint (one band width, across the rise) short of the
          // neighbour's rise at the run's height, or short of a neighbour's run lying at a similar height (bands closer
          // than a quarter band width). It is at least a band width and the chamfer long (never more than Run) when it
          // fits, shorter runs are left out.
          float l1 = cL1, l2 = cL2;
          if (vary) {
            float cotR = rise.x / sinR, clr = (hw + u_width) / sinR, reach = 1.25 * u_width;
            float mf = min(2.0 * hc + u_chamfer * sc, L);
            float S = -1e9;   // the low run's leftmost start
            if (py1 - reach < cy1 && cy1 < py2 + reach) S = pR + (clamp(cy1 + hw, py1, py2) - py1) * cotR + clr;
            if (abs(py2 - cy1) < reach) S = max(S, pR + pD + max(pL2, mf) + u_width);
            float E = 1e9;    // the high run's rightmost end
            if (ny1 - reach < cy2 && cy2 < ny2 + reach) E = nR + (clamp(cy2 - hw, ny1, ny2) - ny1) * cotR - clr;
            if (abs(ny1 - cy2) < reach) E = min(E, nR - max(nL1, mf) - u_width);
            // A high run just above the next piece's lower top is short of room: climb only to that top first (not so
            // low that the next low run would meet it), which gives it the room it has beside an even neighbour.
            if (E - cR - cD < mf && cy2 - hw > ny2 && cy2 < ny2 + reach) {
              float t = max(ny2 + hw, yl + reach + 1.0);
              if (t < cy2) {
                cD *= (t - cy1) / max(cy2 - cy1, 1e-4);
                cy2 = t;
                E = nR + (clamp(cy2 - hw, ny1, ny2) - ny1) * cotR - clr;
              }
            }
            // A run with no room for a proper flat is left out: the rise ends there in a chamfered cut of its own.
            l1 = min(max(l1, mf), cR - S);
            l2 = min(max(l2, mf), E - cR - cD);
            if (l1 < mf - 0.01) l1 = 0.0;
            if (l2 < mf - 0.01) l2 = 0.0;
          }
          zL1 = l1 > 0.0 ? max(l1, 0.01) : 0.0;
          zL2 = l2 > 0.0 ? max(l2, 0.01) : 0.0;
          zx0 = cR - zL1;
          zy1 = cy1;
          zy2 = cy2;
          zDk = cD;
          zLk = Ls * (cy2 - cy1) / max(Rr, 1e-4);
        }
        float x0 = zx0, L1 = zL1, L2 = zL2, y1 = zy1, y2 = zy2, Dk = zDk, Lk = zLk;
        a = sz == 0 ? vec2(x0, y1) : sz == 1 ? vec2(x0 + L1, y1) : vec2(x0 + L1 + Dk, y2);
        e = sz == 1 ? rise : vec2(1.0, 0.0);
        ep = sz == 2 ? rise : vec2(1.0, 0.0);
        l = sz == 1 ? Lk : sz == 0 ? L1 : L2;
        // A left-out run: its segment is skipped and the rise gets the flat end instead.
        fa = sz == 0 || (sz == 1 && L1 <= 0.0);
        fb = sz == 2 || (sz == 1 && L2 <= 0.0);
        joint = sz == 2 || (sz == 1 && L1 > 0.0);
        zLow = sz == 1;
        zHigh = sz == 2;
        if ((sz == 0 && L1 <= 0.0) || (sz == 2 && L2 <= 0.0)) on = false;   // (its foot stays, footOn)
        lp = zHigh ? 0.5 * Lk : L1;
        ln = zLow ? 0.5 * Lk : L2;
      } else {
        a = vec2(x0 + (m == 0 ? 0.0 : m == 1 ? Fl : m == 2 ? Fl + D : Fl + D + Fh), (m < 2 ? lo : hi) + yo);
        e = m == 0 || m == 2 ? vec2(1.0, 0.0) : m == 1 ? rise : fall;
        ep = m == 0 ? fall : m == 1 ? (Fl > BND_EPS ? vec2(1.0, 0.0) : fall) : m == 2 ? rise : (Fh > BND_EPS ? vec2(1.0, 0.0) : rise);
        l = m == 0 ? Fl : m == 2 ? Fh : Ls;
        lp = 0.5 * (m == 1 && Fl > BND_EPS ? Fl : m == 3 && Fh > BND_EPS ? Fh : Ls);
        ln = 0.5 * l;
      }
      if (on && (l > BND_EPS || fa || fb)) {
        float rc = min(r * sc, hc);
        bnd_h = hc - rc;
        bnd_c = clamp(u_chamfer * sc - 0.4142 * rc, 0.0, bnd_h);
        bnd_rc = rc;
        float dc = bnd_seg(q, a, e, l, fa, fb);
        float dcS = bnd_s;
        if (joint) {
          dc = min(dc, bnd_joint(q, a, ep, e, zLow ? lp - bnd_h : lp, zHigh ? ln - bnd_h : ln));
          dcS = min(dcS, bnd_s);
        }
        dc -= rc;
        if (bnd_asp) bestS = min(bestS, dcS);
        if (dc < geo_bestD) { geo_bestD = dc; geo_bestKey = key; geo_bestCls = 0; }
      }
      // Feet: a box from the margin to the centre line under a low run / flat (over a high one), out to where the
      // band's outer corners meet the margin (half the bend's turn: hc · tan(slope / 2) beyond the flat).
      bool low = mode == 3 ? !joint : m == 0;
      // A left-out run keeps its foot, under / over the rise's end, so the panels either side stay apart.
      bool foot = mode == 3 ? !zLow && (low ? zy1 <= yl + 0.01 : zy2 >= yh - 0.01) : m == 0 || m == 2;
      if (footOn && fillM && touch && foot) {
        float bx1 = mode == 3 ? (low ? zx0 - (zL1 > 0.0 ? 0.0 : hc / sinR) : zx0 + zL1 + zDk - hc * tq) : a.x - hc * tq;
        float bx2 = mode == 3 ? (low ? zx0 + zL1 + hc * tq : zx0 + zL1 + zDk + (zL2 > 0.0 ? zL2 : hc / sinR)) : a.x + l + hc * tq;
        float by1 = low ? mb - 1.0 : a.y, by2 = low ? a.y : Hl - mt + 1.0;
        vec2 bc = q - 0.5 * vec2(bx1 + bx2, by1 + by2), bh = 0.5 * vec2(bx2 - bx1, by2 - by1);
        vec2 bq = abs(bc) - bh;
        float df = length(max(bq, 0.0)) + min(max(bq.x, bq.y), 0.0);
        if (bnd_asp) bestS = min(bestS, bnd_boxS(bc, bh));
        if (df < geo_bestD) { geo_bestD = df; geo_bestKey = key; geo_bestCls = 0; }
      }
      // Z: the piece whose rise lies left of the pixel names its panel.
      if (on && mode == 3 && zLow) {
        float xr = zx0 + zL1 + zDk * (clamp(ly, zy1, zy2) - zy1) / max(zy2 - zy1, 1e-4);
        if (xr <= xs && xr > leftX) { leftX = xr; leftKey = key; }
      }
    }
  }

  float d = min(geo_bestD, 1e4);
  ivec2 pieceKey = geo_bestKey;
  // Bevel aspect, bars: the winning bar's outline in the stretched space (one polygon, so measured once, here).
  if (bnd_asp && mode == 0 && d < 1e4) {
    for (int i = 0; i < 4; i++) geo_V[i] = barV[i];
    geo_n = 4;
    float e = sqrt(geo_edges2(vec2(xs - barA, ly), barR, bevelFrame(bnd_L[0], bnd_L[1])));
    bestS = d < 0.0 ? -e : e;
  }
  float ds = min(bestS, 1e4);
  float dint = mode == 2 ? -1e4 : max(mb - ly, ly - (Hl - mt));
  // (Bevel aspect: the margins' lines, in px of Bevel.)
  vec2 Y = vec2(0.0, 1.0);
  // A zig-zag stays inside its lane: the mitre tips of sharp peaks are cut at the margins (no change where the peaks
  // have flats, whose edges lie on the margins). Not in the fill modes, whose panels stop at the margins anyway — the
  // cut would pull the feet back to the margin line and leave a sliver of panel there.
  if (mode == 1 && !fillM) {
    d = max(d, dint);
    if (bnd_asp) ds = max(ds, bnd_ln(dint, Y));
  }
  if (fillM) {
    // Even panel edges: the panels also keep a band width from the (moved) margins, where the runs lie (Z, zig-zag).
    float ew = u_even && (mode == 1 || mode == 3) ? u_width : 0.0;
    d = max(-d, mode == 2 ? -1e4 : max(mb + ew - ly, ly - (Hl - mt - ew)));
    if (bnd_asp) ds = max(-ds, mode == 2 ? -1e4 : bnd_ln(max(mb + ew - ly, ly - (Hl - mt - ew)), Y));
    // The wave's centre line at the pixel (zig-zag, chevrons).
    float xm = xs - P * floor(xs / P);
    float yc = xm < Fl ? lo : xm < Fl + D ? lo + (xm - Fl) / max(D, 1e-4) * (hi - lo)
             : xm < Fl + D + Fh ? hi : hi - (xm - Fl - D - Fh) / max(D, 1e-4) * (hi - lo);
    // Above / below: drop the panels on the other side of the zig-zag centre line (the cut lies inside the
    // band, so it never shows).
    if (mode == 1 && u_fill >= 2) {
      d = max(d, u_fill == 2 ? yc - ly : ly - yc);
      if (bnd_asp) ds = max(ds, bnd_ln(u_fill == 2 ? yc - ly : ly - yc, Y));
    }
    // Each panel its own random (not the nearest band's, which would split a panel along curves): the piece left
    // of it (bars, Z), else the repeat between the two bands that bound it.
    int pi;
    int py = -2 - laneW;
    if (mode == 0) {
      pi = int(floor((xs - (ly - mb) * slope) / P));
      pi = leftX > -1e8 ? leftKey.x : through ? imod(pi - nRun * lane, kThr) : imod(pi, kxi);
      if (through) py = -2;
    } else if (mode == 1) {
      bool up = ly > yc;   // panels above the band lie between high flats, those below between low flats
      pi = 2 * imod(int(floor((xs - (up ? Fl + D + Fh : Fl)) / P)), kxi) + (up ? 1 : 0);
    } else if (mode == 2) {
      pi = 0;
      int lb = lane + int(floor((ly - yc) / Hl));   // the chevron below
      py = -2 - (uTile ? imod(lb, kyi) : lb);
    } else {
      // Between Z pieces: right of one piece's rise, left of the next one's.
      float xr = L + D * (clamp(ly, yl, yh) - yl) / max(Rr, 1e-4);
      pi = leftX > -1e8 ? leftKey.x : imod(int(floor((xs - xr) / P)), kxi);
    }
    geo_bestKey = ivec2(pi, py);
  }
  // Rails along the lane edges (straight frame y, so mirrored lanes share them).
  bool rail = false;
  if (u_rail > 0.0 && mode != 2) {
    float edge = floor(fy / Hl + 0.5);
    float dr = abs(fy - edge * Hl) - 0.5 * u_rail;
    if (bnd_asp) ds = min(ds, bnd_ln(dr, Y));
    if (dr < d) {
      d = dr;
      rail = true;
      int ei = int(edge);
      geo_bestKey = ivec2(uTile ? imod(ei, kyi) : ei, -1);
    }
  }
  if (u_outline > 0.0) d = abs(d + 0.5 * u_outline) - 0.5 * u_outline;
  float rnd = hashI(geo_bestKey, uSeed);

  // Width variation: a thinner piece bevels as a scaled copy of a full one — its bevel measured in the piece's own
  // scale (bdist, the Bevel aspect applied from the distance's direction as the wrapper does), while the distance the
  // mask gets stays exact. Derivatives taken outside any branch.
  // With Bevel aspect, the distance in px of Bevel tracked alongside (bnd_s), scaled the same way.
  vec2 gd = vec2(dFdx(d), dFdy(d));
  float bd = bnd_asp ? ds : NO_SDF;
  if (wv > 0.0 && !fillM && !rail) {
    float hb = hw * (1.0 - wv * hashI(pieceKey, uSeed + 7.0));   // = hash3I(…).x, cheaper
    float gg = dot(gd, gd);
    vec2 n2 = gg > 1e-12 ? gd * gd / gg : vec2(0.5);
    vec2 W = bevelWidths();
    bd = bnd_asp ? ds * (hw / max(hb, 1e-4)) : d * (hw / max(hb, 1e-4)) * u_bevel / max(sqrt(dot(n2, W * W)), 1e-4);
  }
  // Rails lower than the bands: the level × the bevel (genOutShaded-style), with the coverage drawn here.
  if (u_rail > 0.0 && u_rail_h < 1.0 && mode != 2)
    return GenOut(rail ? u_rail_h : 1.0, coverage(d, u_aa), rnd, d, 1.0, NO_SDF, 2, -1.0, bd, rnd);
  GenOut o = genOut(0.0, 1.0, rnd, d);
  o.bdist = bd;
  return o;
}
`
};
