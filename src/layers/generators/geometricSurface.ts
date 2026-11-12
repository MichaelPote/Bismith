// Surface textures of the geometric family: tread plate (diamond plate lozenges, capsules, 5-bar groups, studs,
// teardrops, diamonds) and woven strands (plain / twill / basket / satin / herringbone weaves, chain-link-style meshes
// on a 45° frame).
//
// Both paint their own relief and coverage (genOutOwn) while the layer draws its own shape (no mask written, or
// Normal): the Profile applied over a distance that can reach across a whole lozenge (Dome) blended towards a ridge
// (Crest); for weaves, floats that arch down to a floor where they dive, flanks that rest on the strands beneath and
// lower under-runs. In the mask's combine modes they hand the wrapper their exact distance (its plain bevel).

import { P, gradient, type ParamValues } from '@/core/params';
import { f32 } from '../derivedMath';
import type { DerivedUniforms, LayerCanvas, LayerDef } from '../types';
import { GEO_FRAME_GLSL, geoAB, geoCount, geoSpan, orientParam, orientSteps, rndModeParam } from './geometricCommon';

/**
 * The cells across and down of a grid of Columns × Rows cells (derived uniforms; whole multiples of mx, my when tiling),
 * each R strands, on the turned frame. In float32 steps, as the shader had them.
 */
function gridCounts(p: ParamValues, c: LayerCanvas, mx: number, my: number, R = 1): number[] {
	const span = geoSpan(orientSteps(p.orient), c);
	const k = (n: unknown, s: number, res: number) => f32(f32(f32(Number(n) * s) / res) / R);
	return [
		geoCount(k(p.count_x, span[0], c.width), mx, c.tileable),
		geoCount(k(p.count_y, span[1], c.height), my, c.tileable)
	];
}

/** Tread plate's Orientation (the option index is the shader's u_layout). */
const TREAD_LAYOUTS: [string, string][] = [
	['checker', 'Alternate (checker)'],
	['rows', 'Alternate by row'],
	['cols', 'Alternate by column'],
	['same', 'All the same'],
	['herringbone', 'Herringbone (rows alternate, offset)']
];

/** Tread plate's derived uniforms: alternation and offset rows need even counts to tile. */
const TREAD_DERIVED: DerivedUniforms = {
	decl: { k: 'vec2', geo_AB: 'ivec2' },
	compute: (p, c) => {
		const lay = TREAD_LAYOUTS.findIndex(([v]) => v === p.layout);
		const ex = lay === 0 || lay === 2;
		const ey = lay === 0 || lay === 1 || lay === 4 || p.stagger === true;
		return { k: gridCounts(p, c, ex ? 2 : 1, ey ? 2 : 1), geo_AB: geoAB(c) };
	}
};

// ------------------------------------------------------------------------------------------------ tread plate

/**
 * Each style's own arrangement and proportions (linked defaults: they follow the style while left alone). Lozenges and
 * capsules: long slim lugs in a herringbone (rows alternating ±45°, offset half a cell), tip to flank; 5-bar groups sit
 * square in a checker (Rotation 45° turns the whole basket onto the diagonal); diamonds packed nearly tip to tip.
 * Width means bar spacing for bars and the diameter for studs.
 */
const TREAD_LOOKS: Record<string, ParamValues> = {
	lozenge: { layout: 'herringbone', angle: 45, length: 1.35, width: 0.15 },
	capsule: { layout: 'herringbone', angle: 45, length: 1.1, width: 0.2 },
	bars: { layout: 'checker', angle: 0, length: 0.85, width: 0.5 },
	stud: { layout: 'checker', angle: 45, length: 0.85, width: 0.45 },
	teardrop: { layout: 'checker', angle: 45, length: 0.85, width: 0.32 },
	diamond: { layout: 'same', angle: 0, length: 0.92, width: 0.92 }
};
const notStud = (p: ParamValues) => p.style !== 'stud';

export const treadplateLayer: LayerDef = {
	type: 'treadplate',
	label: 'Tread plate',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Tread plate: Raised lozenges, bars or studs in a grid, often turned in alternating directions, with domed tops. Makes diamond plate, 5-bar tread, studded floors, anti-slip metal.',
	params: [
		P.enum('style', 'Style', 'lozenge', [
			['lozenge', 'Lozenge (diamond plate)'],
			['capsule', 'Capsule'],
			['bars', 'Bar group (5-bar)'],
			['stud', 'Round studs'],
			['teardrop', 'Teardrop'],
			['diamond', 'Diamond (rhombus)']
		]),
		P.int('count_x', 'Columns', 8, 1, 256, {
			uniform: false,
			softMax: 48,
			hint: 'How many cells across (made even when tiling with alternating orientation)'
		}),
		P.int('count_y', 'Rows', 8, 1, 256, { uniform: false, softMax: 48, hint: 'How many cells down' }),
		orientParam(
			'Turns the whole grid in 45° steps (Lug angle turns each lozenge within its cell). At 45° with Lug angle 0, 5-bar groups or capsules lie on the diagonal. 45° grids repeat over gcd(width, height)'
		),
		P.enum('layout', 'Orientation', 'herringbone', TREAD_LAYOUTS, {
			showIf: notStud,
			hint: 'Turns alternate cells 90° from the Lug angle. Herringbone alternates the rows and offsets every other one by half a cell, so each lug points at the side of the next, like classic diamond plate'
		}),
		P.float('angle', 'Lug angle', 45, -180, 180, {
			softMin: -90,
			softMax: 90,
			unit: '°',
			step: 0.1,
			showIf: notStud,
			hint: 'Turns each lozenge, clockwise from the grid’s horizontal'
		}),
		P.float('length', 'Lug length', 1.35, 0.05, 1.5, {
			step: 0.001,
			showIf: notStud,
			hint: 'Sets the length as a fraction of the cell size (the geometric mean of its width and height); for bar groups, the group’s length and breadth'
		}),
		P.float('width', 'Lug width', 0.15, 0.02, 1, {
			step: 0.001,
			hint: 'Sets the width as a fraction of the cell (for bars, of the bar spacing; for studs, the diameter)'
		}),
		P.float('crown', 'Dome', 1, 0, 1, {
			step: 0.001,
			hint: 'How far in the bevel reaches (0 = flat tops with just the Bevel at the edges, 1 = domed all the way to the spine). The Profile shapes the dome (Round: steep sides, rounded top). Works without a Bevel too. (Bevel aspect only applies in the mask’s combine modes: Union, Subtract …)'
		}),
		P.float('crest', 'Crest', 0.5, 0, 1, {
			step: 0.001,
			hint: 'Sharpens the top into a ridge along the spine that catches the light (0 = the Profile’s rounded top, 1 = straight sides meeting in a ridge, pyramids on diamonds). Works with Dome'
		}),
		P.int('bars', 'Bars', 5, 1, 16, { showIf: (p) => p.style === 'bars' }),
		P.bool('stagger', 'Offset rows', false, {
			hint: 'Shifts alternate rows by half a cell (rows are made even when tiling; Herringbone already offsets them)'
		}),
		P.float('jitter', 'Angle variation', 1.5, 0, 90, {
			softMax: 45,
			unit: '°',
			step: 0.1,
			showIf: notStud,
			hint: 'Turns each lozenge by a random angle up to this, for worn or hand-made plate (90 = any direction)'
		}),
		P.float('pos_jitter', 'Position jitter', 0.015, 0, 0.3, {
			step: 0.001,
			hint: 'Moves each lozenge off its cell centre by a random amount, as a share of the cell'
		}),
		P.float('size_var', 'Size variation', 0, 0, 1, {
			softMax: 0.5,
			step: 0.001,
			hint: 'Shrinks each lozenge at random, its length by up to this share and its width by half as much (cast or hand-made plate)'
		}),
		P.seed()
	],
	// Domed lugs with a ridge and a hint of irregularity (each seed its own), nearly level (rolled plate), glossier and
	// brighter in specular towards the spine so the plate glints.
	defaults: {
		h_on: true,
		h_amount: 0.4,
		h_var: 0.06,
		bevel: 1.5,
		profile: 'round',
		dif_on: true,
		dif_src: 'value',
		dif_opacity: 0.6,
		dif_jitter: 0.12,
		dif_grad: gradient('#60656a', '#adb4bb'),
		r_on: true,
		r_a: 0.55,
		r_b: 0.25,
		// Steel lugs: they reflect in their colour (the plate between them is whatever lies below).
		mt_on: true,
		mt_src: 'flat'
	},
	// In the editor, roughness follows the lug's relief, not its shape (the registry's default for shapes).
	fresh: () => ({ r_src: 'value' }),
	linkedDefaults: (p) => TREAD_LOOKS[String(p.style)] ?? TREAD_LOOKS.lozenge,
	derivedUniforms: TREAD_DERIVED,
	glsl:
		GEO_FRAME_GLSL +
		/* glsl */ `
float tp_capsule(vec2 p, float hl, float hw) {
  p = abs(p);
  p.x = max(p.x - max(hl - hw, 0.0), 0.0);
  return length(p) - hw;
}

// Rhombus with half-diagonals b (after Inigo Quilez).
float tp_rhombus(vec2 p, vec2 b) {
  p = abs(p);
  b = max(b, vec2(1e-3));
  vec2 t = b - 2.0 * p;
  float h = clamp((t.x * b.x - t.y * b.y) / dot(b, b), -1.0, 1.0);
  float d = length(p - 0.5 * b * vec2(1.0 - h, 1.0 + h));
  return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);
}

// Teardrop along x: a round end of radius r1 at -hl, tapering to a small round tip of radius r2 at +hl
// (uneven capsule, after Inigo Quilez).
float tp_teardrop(vec2 q, float hl, float r1, float r2) {
  float h = max(2.0 * hl - r1 - r2, r1 - r2 + 1e-3);
  vec2 p = vec2(abs(q.y), q.x + hl - r1);
  float b = (r1 - r2) / h;
  float a = sqrt(max(1.0 - b * b, 0.0));
  float k = dot(p, vec2(-b, a));
  if (k < 0.0) return length(p) - r1;
  if (k > a * h) return length(p - vec2(0.0, h)) - r2;
  return dot(p, vec2(a, b)) - r1;
}

GenOut gen(vec2 p) {
  geo_frame(p, u_orient);
  // The cells across and down: even where alternation and offset rows need it to tile (TREAD_DERIVED).
  bool offs = u_stagger || u_layout == 4;
  geo_periods(d_k);
  vec2 cs = geo_cs;
  vec2 f = geo_f;
  float pitch = sqrt(cs.x * cs.y);           // non-square cells keep the lozenge proportions
  float hl0 = 0.5 * u_length * pitch;
  float hw0 = 0.5 * u_width * pitch;
  // Cells searched either way: as far as a lug reaches from its cell's centre (bar groups: their corners) and Position
  // jitter moves it, plus half a cell — more than ±1 only on long, narrow cells.
  float reach = u_style == 2 ? 1.4142136 * hl0 : length(vec2(hl0, hw0));
  ivec2 nr = clamp(ivec2(ceil(reach / cs + u_pos_jitter)), 1, 4);
  int nw = 2 * nr.x + 1;
  int j0 = int(floor(f.y / cs.y));
  float best = 1e9;
  float bestRnd = 0.0;
  float bestIn = 1.0;                        // the winner's largest inside distance (its half-width), for the dome
  for (int it = 0; it < 81 * UNI_1; it++) {
    if (it >= nw * (2 * nr.y + 1)) break;
    int j = j0 + it / nw - nr.y;
    float sh = (offs && (j & 1) == 1) ? 0.5 : 0.0;
    int i = int(floor(f.x / cs.x - sh)) + it % nw - nr.x;
    ivec2 id = geo_wrapCell(ivec2(i, j));
    int flip = u_layout == 0 ? ((i + j) & 1) : (u_layout == 1 || u_layout == 4) ? (j & 1) : u_layout == 2 ? (i & 1) : 0;
    float ang = u_angle + 90.0 * float(flip) + (u_jitter > 0.0 ? (hashI(id, uSeed + 11.0) - 0.5) * 2.0 * u_jitter : 0.0);
    float s = u_size_var > 0.0 ? 1.0 - u_size_var * hashI(id, uSeed + 23.0) : 1.0;
    float hl = hl0 * s, hw = hw0 * (0.5 + 0.5 * s);
    vec2 ctr = (vec2(float(i) + sh, float(j)) + 0.5) * cs;
    if (u_pos_jitter > 0.0) ctr += (vec2(hashI(id, uSeed + 37.0), hashI(id, uSeed + 41.0)) - 0.5) * 2.0 * u_pos_jitter * cs;
    vec2 q = unrotCW(f - ctr, ang);
    float d, ins;
    if (u_style == 0) { d = sdVesica(q.yx, hl, hw); ins = min(hw, hl); }
    else if (u_style == 1 || u_style == 2) {
      // Capsule, or the nearest of n parallel bars along the axis, spread over the lozenge length across it.
      vec2 cq = q;
      float cw = hw;
      if (u_style == 2) {
        float nb = float(u_bars);
        float sp = 2.0 * hl / nb;
        cw = 0.5 * u_width * sp;
        float kb = clamp(floor(q.y / sp + 0.5 * nb), 0.0, nb - 1.0);
        cq.y -= (kb + 0.5 - 0.5 * nb) * sp;
      }
      d = tp_capsule(cq, hl, cw);
      ins = cw;
    }
    else if (u_style == 3) { d = length(q) - hw; ins = hw; }
    else if (u_style == 4) { d = tp_teardrop(q, hl, hw, 0.15 * hw); ins = hw; }
    else { d = tp_rhombus(q, vec2(hl, hw)); ins = hl * hw / max(length(vec2(hl, hw)), 1e-3); }
    if (d < best) { best = d; bestRnd = hashI(id, uSeed); bestIn = ins; }
  }
  // In the mask's combine modes the wrapper bevels the combined shape.
  if (maskOp() > 1) return genOut(0.0, 1.0, bestRnd, best);
  // Dome: the Profile over max(Bevel, Dome × half-width) in, blended towards the straight ridge by Crest.
  float B = max(u_bevel, u_crown * bestIn);
  float x = B > 0.0 ? clamp(-best / B, 0.0, 1.0) : 1.0;
  float v = mix(u_profile == 0 || B <= 0.0 ? 1.0 : profileCurve(u_profile, x), x, u_crest);
  return genOutOwn(v, coverage(best, u_aa), bestRnd, best);
}
`
};

// ------------------------------------------------------------------------------------------------ weave

/** Each weave's repeat (Weave option order, herringbone left out: it reads the 2/2 twill's): whether the horizontal
 * strand j is over the vertical strand i. */
const WEAVES: [number, (i: number, j: number) => boolean][] = [
	[2, (i, j) => (i + j) % 2 === 0],
	[4, (i, j) => (i + j) % 4 < 2],
	[3, (i, j) => (i + j) % 3 < 2],
	[4, (i, j) => (i + j) % 4 < 3],
	[4, (i, j) => (Math.floor(i / 2) + Math.floor(j / 2)) % 2 === 0],
	[5, (i, j) => (i + 2 * j) % 5 !== 0],
	[1, () => true],
	[6, (i, j) => (Math.floor(i / 3) + Math.floor(j / 3)) % 2 === 0]
];

/** WEAVES as GLSL tables: each repeat's rows of bits (bit i of row j), where each weave's rows start, its repeat. A
 * lookup instead of a branch per weave, which D3D would inline at every call site. */
function weaveTable(): string {
	const rows: number[] = [],
		first: number[] = [],
		reps: number[] = [];
	for (const [r, over] of WEAVES) {
		first.push(rows.length);
		reps.push(r);
		for (let j = 0; j < r; j++) {
			let bits = 0;
			for (let i = 0; i < r; i++) if (over(i, j)) bits += 2 ** i;
			rows.push(bits);
		}
	}
	const arr = (name: string, a: number[]) => `const int ${name}[${a.length}] = int[${a.length}](${a.join(', ')});`;
	return [arr('WV_ROWS', rows), arr('WV_OFF', first), arr('WV_R', reps)].join('\n');
}

/** wv_repeat on the CPU: the weave's repeat in strands (Herringbone: 2 × Zig-zag width, 4 × when odd). */
function weaveRepeat(p: ParamValues): number {
	const m = WEAVE_PATTERNS.findIndex(([v]) => v === p.pattern);
	if (m === 8) {
		const hb = Math.min(Math.max(Math.round(Number(p.period)), 1), 64);
		return hb % 2 === 0 ? 2 * hb : 4 * hb;
	}
	return WEAVES[Math.min(Math.max(m, 0), 7)][0];
}
/** The weaves (WEAVES' order, then Herringbone: the option index is the shader's u_pattern). */
const WEAVE_PATTERNS: [string, string][] = [
	['plain', 'Plain (1/1)'],
	['twill', 'Twill 2/2'],
	['twill21', 'Twill 2/1'],
	['twill31', 'Twill 3/1'],
	['basket', 'Basket 2×2'],
	['satin', 'Satin 4/1'],
	['lattice', 'Lattice (horizontal on top)'],
	['basket3', 'Basket 3×3'],
	['herringbone', 'Herringbone twill']
];

export const weaveLayer: LayerDef = {
	type: 'weave',
	label: 'Weave',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Weave: Strands woven over and under each other, arching up between the crossings. Makes fabric, baskets, wire screen, lattices.',
	params: [
		P.enum('pattern', 'Weave', 'plain', WEAVE_PATTERNS, {
			hint: 'Lattice: no weaving, just one layer of strips lying over the other (trellis, strap grates). Herringbone: a 2/2 twill whose diagonal flips every few strands (zig-zag ribs)'
		}),
		P.int('period', 'Zig-zag width', 8, 2, 16, {
			showIf: (p) => p.pattern === 'herringbone',
			hint: 'How many strands each arm of the herringbone has (the weave repeats every 2 × this, 4 × when odd)'
		}),
		P.int('count_x', 'Strands across', 8, 1, 512, {
			uniform: false,
			softMax: 64,
			hint: 'How many vertical strands across (a multiple of the weave repeat when tiling)'
		}),
		P.int('count_y', 'Strands down', 8, 1, 512, {
			uniform: false,
			softMax: 64,
			hint: 'How many horizontal strands down'
		}),
		orientParam(
			'Turns the weave in 45° steps; 45° gives a diagonal, chain-link style mesh. Diagonal angles repeat over gcd(width, height)'
		),
		P.float('width', 'Strand width', 0.85, 0.05, 1, {
			step: 0.001,
			hint: 'Sets the strand width as a fraction of the strand spacing; lower values open up holes (mesh)'
		}),
		P.float('width_var', 'Width variation', 0.2, 0, 1, {
			step: 0.001,
			hint: 'Makes each strand thinner by a random amount, up to this share of its width (hand-split cane, uneven yarn)'
		}),
		P.float('gap', 'Gap', 1, 0, 64, {
			softMax: 4,
			unit: 'px',
			step: 0.1,
			hint: 'Adds clearance where a strand dives under another, and between neighbouring strands'
		}),
		P.float('arch', 'Over/under arch', 0.6, 0, 1, {
			step: 0.001,
			hint: 'How far each float (the visible stretch of a strand) dips towards where it dives under, in a smooth arch from its middle (0 = flat strips that just butt into the crossing strands, 0.6 = down to 40 % at the dive, 1 = down to the base)'
		}),
		P.float('crown', 'Strand roundness', 0.6, 0, 1, {
			step: 0.001,
			hint: 'Rounds the strands’ cross-section (0 = flat tops with the Bevel at their sides, like straps or splints; 1 = the Profile all the way across, like round wire, cord or yarn). A float’s sides only come down to the strand passing beneath it'
		}),
		P.float('under', 'Under depth', 0.5, 0, 1, {
			step: 0.001,
			hint: 'Lowers the strands where they run between two crossings they pass under, like the bottom layer of a lattice or the bits seen between the floats of a basket or twill (0 = as high as the floats, 1 = just above the holes, at 15 %)'
		}),
		P.float('run_on', 'Run on under', 0, 0, 1, {
			step: 0.001,
			hint: 'Runs the strips on under the crossing strands instead of ending them there, with no gap and no dip at their ends (lattices, strap grates)'
		}),
		P.float('round', 'Corner rounding', 1, 0, 64, { softMax: 8, unit: 'px', step: 0.1 }),
		P.float('stud', 'Crossing studs', 0, 0, 256, {
			softMax: 8,
			unit: 'px',
			step: 0.1,
			hint: 'Adds a rivet or stud of this radius at every crossing (0 = none; at most half the strand spacing)'
		}),
		P.float('stud_h', 'Stud height', 0.35, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.stud) > 0,
			hint: 'How far the stud heads stand above the strands; the strands drop by this share of the height to make room'
		}),
		P.float('stud_dome', 'Stud dome', 1, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.stud) > 0,
			hint: 'Shapes the stud heads (0 = flat with the Bevel at the rim, 1 = domed all over, like rivet heads)'
		}),
		rndModeParam(
			['Per float', 'Per direction (warp / weft)', 'Direction + random'],
			'Picks what gets a separate random value: each visible float, each direction (0.25 / 0.75 for horizontal / vertical strands), both, or each strand along its whole length (a tone per cane or thread)',
			[['strand', 'Per strand']],
			'strand'
		),
		P.seed()
	],
	// Floats that arch over the crossings and dip to 40 % where they dive, rounded strands, lower under-runs, domed
	// studs standing proud; colour by the relief (darker dives and flanks) shifted per strand, and per-strand heights.
	defaults: {
		h_on: true,
		h_amount: 0.5,
		h_var: 0.15,
		bevel: 3,
		profile: 'round',
		dif_on: true,
		dif_src: 'value',
		dif_jitter: 0.35,
		dif_grad: gradient('#5b4632', '#7d6246', '#9a7d5a')
	},
	// Uniform-only work on the CPU: the repeats across and down (each wv_repeat strands).
	derivedUniforms: {
		decl: { k: 'vec2', geo_AB: 'ivec2' },
		compute: (p, c) => ({ k: gridCounts(p, c, 1, 1, weaveRepeat(p)), geo_AB: geoAB(c) })
	},
	glsl:
		GEO_FRAME_GLSL +
		weaveTable() +
		/* glsl */ `

int wv_repeat() {
  int hb = clamp(u_period, 1, 64);
  return u_pattern == 8 ? ((hb & 1) == 0 ? 2 * hb : 4 * hb) : WV_R[clamp(u_pattern, 0, 7)];
}
// Is the horizontal strand j over the vertical strand i at their crossing? (Herringbone: the 2/2 twill mirrored every
// 'period' strands.)
bool wv_overH(int i, int j) {
  int m = clamp(u_pattern, 0, 7);
  if (u_pattern == 8) {
    int hb = clamp(u_period, 1, 64);
    int h = imod(i, 2 * hb);
    i = h < hb ? h : 2 * hb - 1 - h;
    m = 1;
  }
  int R = WV_R[m];
  return ((WV_ROWS[WV_OFF[m] + imod(j, R)] >> imod(i, R)) & 1) != 0;
}
// Strand 'line' of direction dir (0 = horizontal) is over the crossing strand 'c'.
bool wv_over(int dir, int c, int line) { return dir == 0 ? wv_overH(c, line) : !wv_overH(line, c); }

ivec2 wv_nS;   // strands per period span (x: vertical strands, y: horizontal), for seamless per-strand values

// Seamless key of strand idx of direction dir: strands repeat every nS on straight and diagonal frames alike.
int wv_strand(int dir, int idx) { return wrapCell(idx, dir == 0 ? wv_nS.y : wv_nS.x); }

// Half-width of a strand (px), thinned at random by Width variation.
float wv_hw(int dir, int idx, vec2 sp) {
  float v = u_width_var > 0.0 ? 1.0 - u_width_var * hashI(ivec2(wv_strand(dir, idx), dir), uSeed + 31.0) : 1.0;
  return max(0.5 * u_width * v * (dir == 0 ? sp.y : sp.x) - 0.5 * u_gap, 0.25);
}

GenOut gen(vec2 p) {
  int R = wv_repeat();
  geo_frame(p, u_orient);
  geo_periods(d_k);
  wv_nS = ivec2(geo_k + 0.5) * R;
  vec2 sp = geo_cs / float(R);           // strand pitch (px)
  ivec2 c = ivec2(floor(geo_f / sp));
  // The layer paints its own relief while it draws its own shape (no mask written, or Normal); in the combine modes the
  // wrapper bevels the combined shape. Ends that run on under the crossing strand close their gap, and slivers of
  // under-runs under 2 px long are left out (they would alias into hairlines).
  bool own = maskOp() <= 1;
  float gapEnd = u_gap * (1.0 - u_run_on);
  float best = 1e9, bestRnd = 0.0;
  int bestDir = 0, bestLine = 0, bestLo = 0, bestHi = 0;
  bool bestFloat = true, isStud = false;
  vec2 bestQ = vec2(0.0);
  float bestHx = 1.0, bestHw = 1.0, bestA = 0.0;
  // A float's ends: the nearest under-crossings either side, 1…8 out — within one repeat if the strand dives at all.
  int ns = 2 * min(R, 8);
  // Candidates: 2 directions × 3 neighbouring strands × the float over this crossing, or (where the strand is under
  // here) the floats or under-runs either side of it — one flat loop, one float evaluation.
  // (No 'continue' in these loops: ANGLE / D3D11 can miscompile it — skipped candidates are wrapped in ifs instead.)
  for (int it = 0; it < 12 * UNI_1; it++) {
    int dir = it / 6;
    int side = it & 1;
    int line = (dir == 0 ? c.y : c.x) + (it >> 1) % 3 - 1;
    int cr = dir == 0 ? c.x : c.y;
    float a = dir == 0 ? geo_f.x : geo_f.y;
    float pa = dir == 0 ? sp.x : sp.y;
    float bq = (dir == 0 ? geo_f.y : geo_f.x) - (float(line) + 0.5) * (dir == 0 ? sp.y : sp.x);
    float hwA = wv_hw(dir, line, sp);
    if (abs(bq) - hwA < best) {
      // Over here, and at the neighbouring crossing on this side (one wv_over call site: D3D inlines each).
      bool ovs[2];
      for (int e = 0; e < 2 * UNI_1; e++) ovs[e] = wv_over(dir, cr + e * (2 * side - 1), line);
      bool ov = ovs[0];
      if (!ov || side == 0) {
        // The float over c0 runs to the nearest under-crossings either side; between two under-crossings the strand
        // only shows in the holes (an under-run).
        int c0 = ov ? cr : cr + 2 * side - 1;
        bool isFloat = ov || ovs[1];
        int lo = min(cr, c0), hi = max(cr, c0);
        if (isFloat) {
          lo = c0 - 8;
          hi = c0 + 8;
          bool gl = false, gh = false;
          for (int s = 0; s < 16 * UNI_1; s++) {
            if (s >= ns) break;
            // Alternately below and above c0.
            bool down = (s & 1) == 0;
            int cs = down ? c0 - (s >> 1) - 1 : c0 + (s >> 1) + 1;
            if (!(down ? gl : gh) && !wv_over(dir, cs, line)) {
              if (down) { lo = cs; gl = true; } else { hi = cs; gh = true; }
            }
            if (gl && gh) break;
          }
        }
        float x0 = (float(lo) + 0.5) * pa + wv_hw(1 - dir, lo, sp) + gapEnd;
        float x1 = (float(hi) + 0.5) * pa - wv_hw(1 - dir, hi, sp) - gapEnd;
        if (x1 - x0 > (isFloat ? 0.0 : 2.0)) {   // else hidden under the crossing strands
          float hx = 0.5 * (x1 - x0);
          vec2 q = vec2(a - 0.5 * (x0 + x1), bq);
          float r = min(u_round, min(hx, hwA));
          float d = sdBox(q, vec2(hx, hwA) - r) - r;
          // Running on: inside, only the sides bound it, so the strand reads as running on under its neighbour.
          if (d < 0.0) d = mix(d, abs(q.y) - hwA, u_run_on);
          if (d < best) {
            best = d;
            bestDir = dir;
            bestLine = line;
            // A strand that never dives under (lattice) is one feature: key it by the strand alone.
            bool endless = hi - lo >= 16;
            ivec2 key = geo_keyI(dir == 0 ? ivec2(endless ? 0 : lo, line) : ivec2(line, endless ? 0 : lo), ivec2(R));
            bestRnd = hashI(ivec2(key.x * 2 + dir, key.y), uSeed);
            bestLo = lo;
            bestHi = hi;
            bestFloat = isFloat;
            bestQ = q;
            bestHx = hx;
            bestHw = hwA;
            bestA = a;
          }
        }
      }
    }
  }
  // Studs at the crossings: inside its radius a stud replaces the strands. Only the pixel's own crossing is tried, so
  // the radius stops at half a pitch.
  vec2 cc = (vec2(c) + 0.5) * sp;
  float rs = min(u_stud, 0.5 * min(sp.x, sp.y));
  float ds = length(geo_f - cc) - rs;
  bool inStud = u_stud > 0.0 && (ds < 0.0 || ds < best);
  float V = 0.0;
  if (own && best < 1e4) {
    // The winner's relief. Across: the Profile over max(Bevel, Roundness × half-width). Along a float: a sine arch from
    // 1 in the middle down to 1 − Arch where it dives (flat along a strand that never dives or whose ends run on), no
    // bevel at the dive — it butts into the strand on top. Its flanks come down only to the strand passing beneath (a
    // float end at 1 − Arch, or an under-run), and drop to the base only over the holes between those strands.
    // Under-runs lie at 1 − 0.85 × Under depth. A stud head rises from the strand it sits on (the strands lowered by
    // Stud height) to the top, domed by Stud dome.
    int dir = bestDir;
    float pa = dir == 0 ? sp.x : sp.y;
    float Bc = max(u_bevel, u_crown * bestHw), Bs = max(u_bevel, u_stud_dome * rs);
    float xc = Bc > 0.0 ? clamp((bestHw - abs(bestQ.y)) / Bc, 0.0, 1.0) : 1.0;
    float xs = Bs > 0.0 ? clamp(-ds / Bs, 0.0, 1.0) : 1.0;
    float pv[2];                                 // the profile across the strand and over the stud, one call site
    for (int e = 0; e < 2 * UNI_1; e++) pv[e] = profileCurve(u_profile, e == 0 ? xc : xs);
    float Pc = u_profile == 0 || Bc <= 0.0 ? 1.0 : pv[0];
    float U = 1.0 - 0.85 * u_under;
    if (!bestFloat) V = U * Pc;
    else {
      float t = bestHi - bestLo >= 16 ? 1.0 : clamp((bestHx - abs(bestQ.x)) / bestHx, 0.0, 1.0);
      t = mix(t, 1.0, u_run_on);
      float A = 1.0 - u_arch * (1.0 - sin(1.5707963 * t));
      int kc = clamp(int(floor(bestA / pa)), bestLo + 1, max(bestHi - 1, bestLo + 1));
      float dk = (float(kc) + 0.5) * pa - bestA;
      float lev = wv_over(1 - dir, bestLine + (bestQ.y >= 0.0 ? 1 : -1), kc) ? 1.0 - u_arch : U;
      float F = lev * clamp((wv_hw(1 - dir, kc, sp) + u_gap - abs(dk)) / max(u_bevel, 1.0) + 0.5, 0.0, 1.0);
      V = mix(F, max(A, F), Pc);
    }
    if (u_stud > 0.0) {
      V *= 1.0 - u_stud_h;
      if (inStud) V = mix(best < 0.0 ? V : 0.0, 1.0, u_profile == 0 || Bs <= 0.0 ? 1.0 : pv[1]);
    }
  }
  if (inStud) {
    best = min(best, ds);                        // joins the strand it sits on
    bestRnd = hashI(geo_keyI(c, ivec2(R)) + ivec2(7919, 0), uSeed);
    isStud = true;
  }
  float rnd = bestRnd;
  if (u_rnd_mode == 1) rnd = bestDir == 0 ? 0.25 : 0.75;
  else if (u_rnd_mode == 2) rnd = (float(bestDir) + 0.15 + 0.7 * bestRnd) * 0.5;
  else if (u_rnd_mode == 3 && !isStud) rnd = hashI(ivec2(wv_strand(bestDir, bestLine), bestDir), uSeed + 47.0);
  best = min(best, 1e4);
  if (own) return genOutOwn(V, coverage(best, u_aa), rnd, best);
  return genOut(0.0, 1.0, rnd, best);
}
`
};
