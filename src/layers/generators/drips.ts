// Drips (FR7.7): water / rust / blood stains that run down from scattered sources — a tapering trail that fades as
// it goes, wobbling slightly. The value is the stain strength and the coverage is soft, so with a Normal or Multiply
// diffuse blend a drip stains whatever the layers beneath painted, in proportion to its strength.
// Output "Sources" gives the blisters the rust bleeds from instead (same seed → same places): ragged holes in the paint at
// the origins, and along the ledges below raised features, that grow with the Blister radius from specks to patches
// that merge into whole areas. Their outline goes to the mask it writes (limit the rust beneath to inside it, the paint to outside);
// their height is the peel — the paint lifts towards the torn edge, steepening as it curls, then falls into the hole,
// below the surface. Wraps on tileable projects.
//
// Two styles. Streak (pixel): the classic narrow trail, crisp at 1 px. Runnels (detailed), for higher resolutions and
// wide stains: water running down a wall — a wash from its seep (a point, or with Seep width a whole line, its lip
// ragged), widening over its first stretch (Fan-out: or all the way down, a straight V) and tapering after, its centre
// line wandering on smooth noise, tide marks along its sides, dry patches, fine streaks it breaks into further down
// (each running out at its own length), and inside it a few thin runnels of their own widths, each wandering on its
// own (Runnel braiding), ending at its own length, some in a bead. Sideways sways never steepen past ~20° from vertical (a
// wide wobble sways over a longer stretch). Stain softness blurs every edge; Strength and Shape variation make each stain
// its own. Surface flow makes the trails react to the relief beneath: they pool against grooves and raised features
// and run on weaker below them.
//
// Passes run before the layer (prepare): the ledge cells (each one's strongest ledge pixel, every pixel tried), each
// source cell's drip (where it sits, its ledge, whether it drips — worked out once per cell instead of per pixel),
// and, with Surface flow, the rises crossed going down every column, prefix-summed from the top.
// Drips added in the editor start as streaky runnels sized to the texture, hanging from the ledges (LayerDef.fresh;
// pixel streaks below 128 px); layers built in code keep the streak style unless they ask.

import type { Texture } from 'three';
import { P, round1 as r1, type Gradient } from '@/core/params';
import { DISTANCE_SOURCE, jumpFlood } from '@/gpu/jfa';
import type { LayerDef } from '../types';
import { LEDGE_GLSL, ledgeCells, ledgeParams } from '../ledges';

const stains = (p: Record<string, unknown>) => p.output !== 'source';
const sources = (p: Record<string, unknown>) => p.output === 'source';
const isRunnels = (p: Record<string, unknown>) => stains(p) && p.style === 'runnels';

/**
 * Margins of the per-cell source texture: DR_MX columns either side and rows below, DR_ROWS rows above (the most a
 * trail search looks up).
 */
const DR_MX = 8;
const DR_ROWS = 96;

/** The editor's paint for new stains (a brown multiply darkening) and for Sources switched to from them (rust). */
const FRESH_STAIN: Gradient = {
	stops: [
		{ pos: 0, color: '#7a6a58' },
		{ pos: 1, color: '#3e3024' }
	]
};
const FRESH_RUST: Gradient = {
	stops: [
		{ pos: 0, color: '#4a2412' },
		{ pos: 1, color: '#8a4a22' }
	]
};
const stopsKey = (g: unknown) =>
	g && typeof g === 'object' && Array.isArray((g as Gradient).stops)
		? (g as Gradient).stops.map((s) => `${s.pos}${s.color}`).join()
		: '';

/** The two sets of source cells and their layout in the source texture, shared by the source pass and `gen`. */
const DR_GRID_GLSL = /* glsl */ `
const int DR_MX = ${DR_MX};
const int DR_MY = ${DR_ROWS};
// Drips from (u_spawn): the grid's share of the drips (set A: the Columns × Rows cells, more and more of them dripping
// from the strongest ledge in them as it rises to 0.5, then thinning out to none at 1) and the ledges' (set B: cells
// of Ledge spacing px, each holding its strongest ledge pixel — anywhere along every ledge, whatever the grid —
// fading in from 0 as s^1.5, so the count of drips grows steadily; all of them at 1).
float dr_wA() { return u_spawn > 0.5 ? 2.0 - 2.0 * u_spawn : 1.0; }
float dr_wB() { return u_spawn * sqrt(u_spawn); }
// Set B's cells across and down (whole numbers, so they tile); blisters space them at least half a radius apart.
// (dripGrids mirrors it.)
vec2 dr_cellsB() { return max(vec2(1.0), floor(uRes / (u_output == 1 ? max(u_ledge_gap, 0.5 * u_blister) : u_ledge_gap) + 0.5)); }
// Set B's first texel row in the source texture (set A's cells and margins come first).
int dr_rowB0() { return u_rows + DR_MY + DR_MX; }
`;

/** The prepare passes' grid and ledge test, and the ledge cells the grid's search reads. */
const DR_PREP_GLSL =
	DR_GRID_GLSL +
	LEDGE_GLSL +
	/* glsl */ `
// The ledge cells the grid's search (set A) reads: no bigger than half a grid cell (nor than set B's), so every grid
// cell with a ledge finds it, however fine the grid. (dripGrids mirrors it.)
vec2 dr_cellsLA() {
  vec2 cs = uRes / vec2(float(u_cols), float(u_rows));
  return max(vec2(1.0), floor(uRes / max(vec2(1.0), min(uRes / dr_cellsB(), vec2(0.5 * min(cs.x, cs.y)))) + 0.5));
}
`;

/**
 * How far from a ledge its blisters reach (px): the ledge flood's range. Mirrors gen and dr_peel — the band's growth
 * along the ledge (up to 2.2 × radius × Ledge blisters with Raggedness) and sat, where the peel's lift and ramp are spent
 * (the lobes' and tear's depths, the lift's widest flaps, the smooth union) — plus a px for float rounding.
 */
function blisterReach(p: Record<string, unknown>, w: number, h: number) {
	const r = Number(p.blister);
	const ragged = Number(p.ragged);
	const lam0 = 0.5 * Math.min(w / Number(p.cols), h / Number(p.rows));
	const nL = Math.min(6, Math.max(1, Math.floor(Math.log2(Math.max(lam0, 1) / 4)) + 1));
	const ks = Math.max(0.35 * r, 0.25);
	const sat =
		ragged * Math.min(r * nL, 1.6 * lam0) +
		2.4 * ragged * Math.min(1, r / 2.5) +
		Math.max(1.6 * Number(p.lift_width), 1.5) +
		1 +
		1.5 * ks;
	return sat + r * Number(p.ledge_mix) * (1 + 1.2 * Math.min(1, 2 * ragged)) + 1;
}

/**
 * The ledge cell counts of the source pass, as the shader works them out (dr_cellsB, dr_cellsLA): set B's and the
 * grid's search cells, across and down.
 */
function dripGrids(p: Record<string, unknown>, w: number, h: number) {
	const gap = p.output === 'source' ? Math.max(Number(p.ledge_gap), 0.5 * Number(p.blister)) : Number(p.ledge_gap);
	const cellsB = [w, h].map((r) => Math.max(1, Math.floor(r / gap + 0.5)));
	const half = 0.5 * Math.min(w / Number(p.cols), h / Number(p.rows));
	const cellsLA = [w, h].map((r, i) => Math.max(1, Math.floor(r / Math.max(1, Math.min(r / cellsB[i], half)) + 0.5)));
	return { cellsB, cellsLA };
}

/** The ledge flood's source (gpu/jfa.ts, custom): inside where the drop counts as a ledge. */
const LEDGE_FLOOD =
	LEDGE_GLSL +
	/* glsl */ `
float jfaCustom(ivec2 c) { return ledgeOk(ledgeDrop(c)) - 0.5; }
`;

/**
 * The source pass: texel (c + margins) holds cell c's drip — (source position, user px; its ledge drop; 1 if it
 * drips). Stains and blisters both read it, so the same seed puts them in the same places.
 */
const CELLS_GLSL =
	DR_PREP_GLSL +
	/* glsl */ `
uniform sampler2D tLedgeA;  // the grid's search cells
uniform sampler2D tLedgeB;  // set B's
// Clustering: the drip chance at pos (user px) swells and fades over patches a few grid cells (cs; at least 1/8 of
// the texture) across — the same patches for the grid and the ledges; at 1 about half the area is bare.
float dr_cluster(vec2 pos, vec2 cs) {
  if (u_cluster <= 0.0) return 1.0;
  float lc = max(3.0 * max(cs.x, cs.y), min(uRes.x, uRes.y) / 8.0);
  vec2 per = max(vec2(1.0), floor(uRes / lc + 0.5));
  float n = valueNoise(pos / uRes * per, periodOf(per), uSeed + 43.0);
  return mix(1.0, 2.0 * smoothstep(0.45, 0.7, n), u_cluster);
}
// Ledge cell l (unwrapped) of the grid's search cells (b false) or set B's: its strongest ledge pixel and its drop (z;
// -1 outside an untiled texture).
vec4 dr_ledgeCell(ivec2 l, vec2 cellsL, bool b) {
  ivec2 lw = wrapCell(l, ivec2(cellsL));
  if (!uTile && (l.x < 0 || l.y < 0 || l.x >= int(cellsL.x) || l.y >= int(cellsL.y))) return vec4(0.0, 0.0, -1.0, 0.0);
  vec4 s = b ? texelFetch(tLedgeB, lw, 0) : texelFetch(tLedgeA, lw, 0);
  return vec4(s.xy + vec2(l - lw) * (uRes / cellsL), s.zw);
}
// How far the ledge at pos (user px) runs either side, against the stain's width: about 0.3 for a rivet's lower edge,
// 1 for a lip that runs on past the stain — less water runs off a short ledge.
const float DR_SPAN[8] = float[8](-1.5, -1.0, -0.5, -0.25, 0.25, 0.5, 1.0, 1.5);
float dr_span(vec2 pos) {
  float n = 0.0;
  int gy = int(uRes.y) - 1 - int(floor(pos.y));
  for (int i = 0; i < 8; i++) {
    ivec2 g = ivec2(int(floor(pos.x + DR_SPAN[i] * max(4.0, u_width))), gy);
    n += max(ledgeOk(ledgeDrop(g)), max(ledgeOk(ledgeDrop(g + ivec2(0, 1))), ledgeOk(ledgeDrop(g - ivec2(0, 1)))));
  }
  return n / 8.0;
}

// Set A: the drip source of grid cell c (unwrapped, so it lies near the caller): false when the cell holds none. cw:
// the cell wrapped (for its hashes), drop: the ledge it sits on; on a ledge, onLedge and lpos: where to measure its
// span (dr_span, once in main).
bool dr_source(ivec2 c, vec2 cells, vec2 cs, out ivec2 cw, out vec2 src, out float drop, out bool onLedge, out vec2 lpos) {
  cw = wrapCell(c, ivec2(cells));
  src = (vec2(c) + hash2I(cw, uSeed + 9.0)) * cs;
  drop = 0.0;
  onLedge = false;
  float rA = min(1.0, 2.0 * u_spawn);
  float bestDrop = -1.0;
  vec2 bestPos = src;
  float dens = u_density;
  if (hashI(cw, uSeed + 31.0) < rA) {
    // A share rA of the cells drips from the strongest ledge anywhere in it (the best ledge cell whose best pixel lies
    // in it); a cell without one stays scattered, by a chance that falls to none at 0.5. (Over 4096 ledge cells in
    // one grid cell, every so many.)
    vec2 cellsL = dr_cellsLA();
    vec2 csL = uRes / cellsL;
    vec2 lo = vec2(c) * cs;
    ivec2 l0 = ivec2(floor(lo / csL));
    ivec2 nl = max(ivec2(ceil((lo + cs) / csL)) - l0, ivec2(1));
    int stride = max(1, int(ceil(sqrt(float(nl.x * nl.y) / 4096.0))));
    ivec2 ns = (nl + stride - 1) / stride;
    for (int i = 0; i < ns.x * ns.y; i++) {
      vec4 b = dr_ledgeCell(l0 + ivec2(i - (i / ns.x) * ns.x, i / ns.x) * stride, cellsL, false);
      bool inCell = b.x >= lo.x && b.y >= lo.y && b.x < lo.x + cs.x && b.y < lo.y + cs.y;
      if (inCell && b.z > bestDrop) { bestDrop = b.z; bestPos = b.xy; }
    }
    float ok = ledgeOk(max(bestDrop, 0.0));
    if (hashI(cw, uSeed + 33.0) < ok) {
      drop = max(bestDrop, 0.0);
      src = bestPos;
      onLedge = true;
    } else {
      // (Off-ledge drips are for coarse grids: one per cell under a tenth of the texture across or so, fewer on finer
      // ones — a fine grid laid for ledges would otherwise fill with them.)
      float ref = 0.1 * min(uRes.x, uRes.y);
      dens *= max(1.0 - rA, u_bare * min(1.0, cs.x * cs.y / (ref * ref)));
    }
  }
  lpos = src;
  dens *= dr_wA() * dr_cluster((vec2(cw) + 0.5) * cs, cs);
  if (hashI(cw, uSeed + 5.0) >= dens) return false;
  if (!u_aa) src = floor(src) + 0.5;  // pixel centres, so 1 px trails and heads hit whole pixels
  return true;
}

// Set B: ledge cell c (unwrapped) — its strongest ledge pixel, a px or two lower now and then so the drips along a
// lip don't all start on one line; csA: the grid's cells (for the clustering's scale). Its own hashes (seed + 7919),
// so it is independent of the grid.
bool dr_ledgeSource(ivec2 c, vec2 cellsB, vec2 csA, out ivec2 cw, out vec2 src, out float drop, out bool onLedge, out vec2 lpos) {
  cw = wrapCell(c, ivec2(cellsB));
  vec4 b = dr_ledgeCell(c, cellsB, true);
  src = b.xy + vec2(0.0, floor(2.5 * hashI(cw, uSeed + 7929.0)));
  drop = max(b.z, 0.0);
  onLedge = b.z >= 0.0;
  lpos = b.xy;
  float dens = u_density * dr_wB() * ledgeOk(drop) * dr_cluster((vec2(cw) + 0.5) * (uRes / cellsB), csA);
  if (!u_aa) src = floor(src) + 0.5;
  return b.z >= 0.0 && hashI(cw, uSeed + 7924.0) < dens;
}

void main() {
  ivec2 t = ivec2(floor(gl_FragCoord.xy));
  vec2 cells = vec2(float(u_cols), float(u_rows));
  vec2 cs = uRes / cells;
  int r0B = dr_rowB0();
  ivec2 cw;
  vec2 src, lpos;
  float drop;
  bool onLedge;
  bool ok = t.y < r0B ? dr_source(t - ivec2(DR_MX, DR_MY), cells, cs, cw, src, drop, onLedge, lpos)
                      : dr_ledgeSource(t - ivec2(DR_MX, r0B + DR_MY), dr_cellsB(), cs, cw, src, drop, onLedge, lpos);
  // a: 0 no drip, else 0.5 + half the ledge's span (1 off a ledge). (One dr_span call site: D3D inlines each.)
  float cov = ok && onLedge ? dr_span(lpos) : 1.0;
  oColor = vec4(src, drop, ok ? 0.5 + 0.5 * cov : 0.0);
}
`;

/** Surface flow, first pass: the rise from each pixel to the one below it (user space), past a little grain. */
const FLOW_INIT = /* glsl */ `
void main() {
  ivec2 c = ivec2(floor(gl_FragCoord.xy));
  oColor = vec4(max(fetchT(tSurface, c - ivec2(0, 1)).r - fetchT(tSurface, c).r - 0.025, 0.0), 0.0, 0.0, 1.0);
}
`;
/** Then a prefix sum down each column from the top (Hillis–Steele: log2 H passes, each adding the texel uStep above). */
const FLOW_SCAN = /* glsl */ `
uniform sampler2D tFlow;
uniform int uStep;
void main() {
  ivec2 c = ivec2(floor(gl_FragCoord.xy));
  float a = texelFetch(tFlow, c, 0).r;
  if (c.y + uStep < int(uRes.y)) a += texelFetch(tFlow, c + ivec2(0, uStep), 0).r;
  oColor = vec4(a, 0.0, 0.0, 1.0);
}
`;

export const dripsLayer: LayerDef = {
	type: 'drips',
	label: 'Drips',
	category: 'pattern',
	kind: 'generator',
	description:
		'Drips: Made from stains running down from scattered sources or ledges, or the sources themselves as blisters of peeling paint (a mask, with a lifted, torn edge). Makes water, rust and blood stains, peeling paint.',
	params: [
		P.enum(
			'output',
			'Output',
			'stain',
			[
				['stain', 'Stains (trails)'],
				['source', 'Sources (blisters)']
			],
			{
				hint: 'Stains: the trails running down from each source. Sources: ragged blisters of peeling paint at the drip origins and along ledges, as a mask for the rust beneath, with the paint lifting at the torn edge and a hole below the surface as height'
			}
		),
		P.enum(
			'style',
			'Style',
			'streak',
			[
				['streak', 'Streak (pixel)', 'a narrow trail that tapers and fades, crisp at 1 px'],
				[
					'runnels',
					'Runnels (detailed)',
					'a wandering wash of water with tide-marked edges and thin runnels inside that split, merge and end in beads. Best for higher resolutions and wide stains'
				]
			],
			{ showIf: stains }
		),
		P.int('cols', 'Columns', 12, 1, 1024, {
			softMax: 128,
			hint: 'How many grid cells fit across the texture, each holding at most one drip (at Drips from 0.5, a fine grid puts a drip under nearly every ledge)'
		}),
		P.int('rows', 'Rows', 6, 1, 1024, { softMax: 128, hint: 'How many source cells fit down the texture' }),
		P.float('spawn', 'Drips from', 0, 0, 1, {
			step: 0.001,
			hint: 'Picks where drips start. 0: scattered over the grid (Columns × Rows). Towards 0.5, more and more grid cells drip from the strongest ledge inside them instead (cells without a ledge stay scattered, then go dry at 0.5), and drips start to appear along the ledges themselves. Towards 1, the grid drips give way to those, and at 1 drips start anywhere along every ledge, whatever the grid. How many: up to 0.5, about Density × the grid cells; ledge drips come at Density × one per Ledge spacing px of ledge, so a base full of lips and rivets gets more (widen Ledge spacing for fewer). Ledges are the lower edges of raised features like rivets, lips and seams (see Relief)'
		}),
		P.float('density', 'Density', 0.5, 0, 1, {
			step: 0.001,
			hint: 'Sets the chance that a grid cell (or a spot along a ledge) gets a drip'
		}),
		P.float('bare', 'Off-ledge drips', 0.4, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.spawn) > 0,
			hint: 'Lets grid cells with no ledge in them drip where they are, by this chance, even at Drips from 0.5 and up (below 0.5 more of them do anyway), so flat stretches are not left bare. Meant for coarse grids: on a fine one (cells under a tenth of the texture across) fewer cells do'
		}),
		P.float('cluster', 'Clustering', 0.35, 0, 1, {
			step: 0.001,
			hint: 'Gathers the sources into groups with bare stretches between (along a ledge: runs of drips and dry gaps; 0 = evenly scattered)'
		}),
		P.float('blister', 'Blister radius', 2, 0, 512, {
			softMax: 48,
			unit: 'px',
			step: 0.05,
			showIf: sources,
			section: 'Blisters',
			hint: 'Grows the blisters from specks (and the ledges from thin lines) to patches that merge into whole areas'
		}),
		P.float('blister_var', 'Size variation', 0.5, 0, 1, {
			step: 0.001,
			showIf: sources,
			section: 'Blisters',
			hint: 'Gives each blister a random share of the radius (1 = anywhere from none to full)'
		}),
		P.float('ragged', 'Raggedness', 0.8, 0, 1, {
			step: 0.001,
			showIf: sources,
			section: 'Blisters',
			hint: "Tears the blister edge, with lobes from the blister's own size down to bays a few px across, a fine tear along it and paint lifting unevenly"
		}),
		P.float('lift', 'Edge lift', 0.8, 0, 8, {
			softMax: 3,
			step: 0.01,
			showIf: sources,
			section: 'Blisters',
			hint: 'Curls the paint up at the torn edge by this much (× the Height amount)'
		}),
		P.float('lift_width', 'Edge lift width', 2, 0, 128, {
			softMax: 24,
			unit: 'px',
			step: 0.05,
			showIf: sources,
			section: 'Blisters',
			hint: 'Sets how far out from the edge the paint lifts; it rises steeply only near the edge'
		}),
		P.float('depth', 'Hole depth', 1, 0, 8, {
			softMax: 3,
			step: 0.01,
			showIf: sources,
			section: 'Blisters',
			hint: 'Sinks the hole below the surface by this much (× the Height amount), showing the rough rust beneath'
		}),
		P.float('len_min', 'Shortest trail', 4, 0, 4096, {
			softMax: 512,
			unit: 'px',
			axis: 'y',
			step: 0.5,
			showIf: stains
		}),
		P.float('len_max', 'Longest trail', 20, 0, 4096, {
			softMax: 512,
			unit: 'px',
			axis: 'y',
			step: 0.5,
			showIf: stains
		}),
		P.float('width', 'Trail width', 1, 0.25, 512, {
			softMax: 96,
			unit: 'px',
			axis: 'x',
			step: 0.05,
			showIf: stains,
			hint: 'Sets the trail width at the head (streaks taper to half; runnels: the width of the wash, see Wash taper)'
		}),
		P.float('width_var', 'Width variation', 0.65, 0, 1, { step: 0.001, showIf: stains }),
		P.float('head', 'Head size', 0, 0, 128, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			showIf: stains,
			hint: 'Adds a drop blob at the origin (0 = none; water and blood have none)'
		}),
		P.float('start', 'Trail strength', 0.8, 0, 1, {
			step: 0.001,
			showIf: stains,
			hint: 'Sets the strength where the trail starts (it fades to 0 along the trail)'
		}),
		P.float('str_var', 'Strength variation', 0.45, 0, 1, {
			step: 0.001,
			showIf: stains,
			hint: 'Gives each trail a random share of the strength (1 = anywhere from none to full), so faint old stains sit among fresh dark ones'
		}),
		P.float('fade', 'Trail fade', 1, 0.1, 8, {
			softMax: 4,
			step: 0.01,
			showIf: stains,
			hint: 'Sets how quickly the trail fades (1 = linear, below 1 = stays strong for longer, above 1 = fades early)'
		}),
		P.float('wobble', 'Wobble', 0.4, 0, 256, {
			softMax: 32,
			unit: 'px',
			axis: 'x',
			step: 0.05,
			showIf: stains,
			hint: 'Makes the trail meander sideways (runnels: how far the whole stain wanders)'
		}),
		P.float('soft', 'Stain softness', 0, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			showIf: (p) => stains(p) && p.aa !== false,
			hint: 'Blurs every edge of the stain over this many px: the trail, the wash, the runnels and their ends (0 = crisp, anti-aliased)'
		}),
		P.float('wander', 'Wobble length', 28, 2, 2048, {
			softMax: 512,
			unit: 'px',
			axis: 'y',
			step: 0.5,
			showIf: stains,
			hint: 'Sets the length of one sideways swing of the trail (streaks add a smaller swing a third as long; runnels swing about twice as often)'
		}),
		P.float('seep', 'Seep width', 0.8, 0.05, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Sets how wide the stain is where it seeps out, as a share of its width (low = a point, like a bolt or a hole; 1 = a whole line, like a crack or a lip, with a ragged edge)'
		}),
		P.float('fan', 'Fan-out', 0.1, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Sets how far down the stain widens from its seep to its full width (0 = within about its own width, 1 = all the way down, a straight V)'
		}),
		P.float('taper', 'Wash taper', 0.45, -1, 1, {
			step: 0.01,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Changes the width past the fan-out, down to the end (1 = narrows to a point, 0 = keeps its width, below 0 = spreads)'
		}),
		P.float('shape_var', 'Shape variation', 0.8, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Gives each stain a random seep width, fan-out and taper around the settings, so points and lines, Vs and columns sit side by side'
		}),
		P.float('feather', 'Wash feather', 0.4, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Fades the wash in from its sides (and down from its seep), as a share of its width (0 = an even sheet with crisp sides, 1 = darkest along its middle, fading out to its edges)'
		}),
		P.float('sheet', 'Wash', 1, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Adds the faint stain of the water sheet between the runnels'
		}),
		P.float('edge', 'Tide marks', 0.25, 0, 2, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: "Adds a darker deposit along the wash's sides, where it dried (wider on broad stains); above 1 it's a strong rim"
		}),
		P.float('breakup', 'Dry patches', 0.2, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Breaks the wash up into patches'
		}),
		P.float('streaks', 'Streaks', 0.55, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Adds fine, lighter and darker streaks running down through the wash, each ending at a random length for a ragged lower end'
		}),
		P.float('streak_w', 'Streak spacing', 2, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			axis: 'x',
			step: 0.05,
			showIf: (p) => isRunnels(p) && Number(p.streaks) > 0,
			section: 'Wash',
			hint: 'Sets how far apart the streaks run'
		}),
		P.int('runnels', 'Runnels', 3, 0, 16, {
			showIf: isRunnels,
			section: 'Runnels',
			hint: 'Sets the most runnels in one stain (each stain draws 1 to this many, narrow stains fewer; 0 = just the wash)'
		}),
		P.float('runnel_width', 'Runnel width', 1.5, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			axis: 'x',
			step: 0.05,
			showIf: isRunnels,
			section: 'Runnels',
			hint: 'Sets the width of each runnel where it starts; it thins to half'
		}),
		P.float('runnel_str', 'Runnel strength', 0.5, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Runnels',
			hint: 'Darkens the runnels and their beads, × the trail strength (low = faint trickles within the wash)'
		}),
		P.float('braid', 'Runnel braiding', 0.35, 0, 2, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Runnels',
			hint: 'Lets the runnels wander across the wash (0 = straight, side by side; 1 = across most of it, crossing and merging)'
		}),
		P.float('beads', 'Runnel beads', 0.15, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Runnels',
			hint: 'Sets the chance that a runnel ends in a drop'
		}),
		P.float('ledge_gap', 'Ledge spacing', 4, 1, 512, {
			softMax: 128,
			unit: 'px',
			step: 0.5,
			group: 'relief',
			showIf: (p) => Number(p.spawn) > 0,
			hint: 'Sets how far apart drips can start along a ledge; Density picks among those spots (Sources: at least half the blister radius)'
		}),
		...ledgeParams({ group: 'relief' }),
		P.float('relief_len', 'Length from height', 0, 0, 32, {
			softMax: 16,
			step: 0.01,
			group: 'relief',
			showIf: stains,
			hint: 'Lengthens trails with the height of the ledge they fall from: length × (1 + this × drop, in height units), so taller rivets get longer tails'
		}),
		P.float('flow', 'Surface flow', 0.6, 0, 1, {
			step: 0.001,
			group: 'relief',
			showIf: stains,
			hint: 'Makes trails react to the relief beneath, wherever they start: grooves and raised features (seams, rivets, lips) catch the water, which pools against them and runs on weaker below, leaving a dry shadow under each rivet'
		}),
		P.float('ledge_mix', 'Ledge blisters', 0.5, 0, 1, {
			step: 0.001,
			group: 'relief',
			showIf: sources,
			hint: 'Grows blisters along every ledge too (the lower edges of raised features, found by the ledge settings above), growing with the radius (0 = only at the sources, 1 = as fast as the blisters at the sources)'
		}),
		P.seed()
	],
	groups: [{ id: 'relief', label: 'Relief' }],
	// Sources: the blisters' outline goes to its mask; Drips shapes the peel itself.
	sdf: 'mask',
	// The Runnels style's stains (the ragged wash and its runnels) in a variant of their own: they were well over half of
	// the cold compile, and Streak and Sources don't need them.
	shaderFeatures: (p) => (isRunnels(p) ? ['DR_RUNNELS'] : []),
	sdfShowIf: sources,
	textures: ['ledges', 'cells', 'flow'],
	prepare(ctx, layer): Record<string, Texture> {
		const p = layer.params;
		const out: Record<string, Texture> = {};
		// Every cell's drip, once (cells beyond the texture too, for trails that run in from outside it).
		// Set A (the grid) first, then (Drips from above 0) set B, the ledge cells, each with its margins. (Each ledge
		// cell count + 1: the shader's float division may round the other way.)
		const ledges = Number(p.spawn) > 0;
		const { cellsB, cellsLA } = dripGrids(p, ctx.width, ctx.height);
		const [bx, by] = ledges ? [cellsB[0] + 1, cellsB[1] + 1] : [0, 0];
		const cells = ctx.scratch(
			'drips-cells',
			Math.max(Number(p.cols), bx) + 2 * DR_MX,
			Number(p.rows) + DR_ROWS + DR_MX + (ledges ? by + DR_ROWS + DR_MX : 0)
		);
		// The ledge cells first (each one's strongest ledge pixel, layers/ledges.ts): set B's, and the grid's search cells.
		const lb = ledges
			? ledgeCells(ctx, 'drips-lcells:b', [cellsB[0], cellsB[1]])
			: ctx.scratch('drips-lcells:b', 1, 1).texture;
		const la = ledges
			? ledgeCells(ctx, 'drips-lcells:a', [cellsLA[0], cellsLA[1]])
			: ctx.scratch('drips-lcells:a', 1, 1).texture;
		const cellMat = ctx.material('drips:cells', CELLS_GLSL, { tLedgeA: { value: null }, tLedgeB: { value: null } });
		cellMat.uniforms.tLedgeA.value = la;
		cellMat.uniforms.tLedgeB.value = lb;
		ctx.run(cellMat, cells);
		out.cells = cells.texture;
		// Surface flow: the rises crossed going down each column, summed from the top.
		if (p.output !== 'source' && Number(p.flow) > 0) {
			let src = ctx.scratch('drips-flow:a');
			let dst = ctx.scratch('drips-flow:b');
			ctx.run(ctx.material('drips:flow0', FLOW_INIT), src);
			const scan = ctx.material('drips:flow', FLOW_SCAN, { tFlow: { value: null }, uStep: { value: 1 } });
			for (let k = 1; k < ctx.height; k *= 2) {
				scan.uniforms.tFlow.value = src.texture;
				scan.uniforms.uStep.value = k;
				ctx.run(scan, dst);
				[src, dst] = [dst, src];
			}
			out.flow = src.texture;
		}
		// Blisters along the ledges: the distance to every ledge pixel, flooded from the heights beneath.
		const r = Number(p.blister);
		const mix = Number(p.ledge_mix);
		if (p.output === 'source' && r > 0 && mix > 0) {
			out.ledges = jumpFlood(ctx, {
				source: DISTANCE_SOURCE.custom,
				custom: LEDGE_FLOOD,
				threshold: 0,
				maxDistance: blisterReach(p, ctx.width, ctx.height),
				name: 'drips-ledges'
			}).texture;
		}
		return out;
	},
	// Sources are relief first: the peel is their height. A layer still on the editor's paint swaps it with the output:
	// the brown multiply darkening for stains, rust for the blisters.
	linkedDefaults: (p) => {
		const src = p.output === 'source';
		const g = stopsKey(p.dif_grad);
		const paired = g === stopsKey(FRESH_STAIN) || g === stopsKey(FRESH_RUST);
		return {
			h_on: src,
			...(paired ? { dif_blend: src ? 'normal' : 'multiply', dif_grad: src ? FRESH_RUST : FRESH_STAIN } : {})
		};
	},
	// Added in the editor: a detailed water stain sized to the texture — seeping from points and short lines, fanning
	// out, breaking into streaks, each stain its own — darkening what is beneath; below 128 px, crisp pixel streaks.
	fresh: ({ width, height }) => {
		// (Lengths down the texture follow its height.)
		const k = Math.max(0.5, width / 128);
		const ky = Math.max(0.5, height / 128);
		const stain = { dif_blend: 'multiply', dif_grad: FRESH_STAIN, spawn: 0.5 };
		if (width < 128)
			return {
				...stain,
				style: 'streak',
				density: 0.45,
				len_min: r1(height / 8),
				len_max: r1(height / 2.5),
				start: 0.8,
				fade: 1,
				wobble: 0.8
			};
		return {
			...stain,
			style: 'runnels',
			cols: 7,
			rows: 3,
			density: 0.75,
			ledge_gap: r1(14 * k),
			len_min: r1(14 * ky),
			len_max: r1(80 * ky),
			width: r1(10 * k),
			wobble: r1(1.2 * k),
			wander: r1(64 * ky),
			streak_w: r1(Math.max(1, 0.75 * k)),
			runnel_width: r1(Math.max(1, 0.8 * k)),
			soft: r1(0.75 * k),
			start: 0.9,
			fade: 1.1,
			aa: true,
			// Sources, should the output be switched: blisters sized to the texture too.
			blister: r1(1.5 * k),
			lift_width: r1(1.2 * k)
		};
	},
	defaults: {
		// Pixel-crisp by default (Edge › Anti-alias).
		aa: false,
		h_on: false,
		dif_on: true,
		dif_grad: {
			stops: [
				{ pos: 0, color: '#5a1e10' },
				{ pos: 1, color: '#7a2a14' }
			]
		},
		// Stains and paint are not metal: where they lie on a metal, it stops reflecting like one.
		mt_on: true,
		mt_src: 'flat',
		mt_b: 0
	},
	glsl: /* glsl */ `
${DR_GRID_GLSL}
// Cell c's drip, from the source pass (unwrapped, so it lies near the caller): false when the cell holds none. cells:
// its set's cells across and down, row0: the set's first texel row, cseed: the set's seed. cw: the cell wrapped (for
// its hashes), rnd: its random, drop: the ledge it sits on.
bool dr_cell(ivec2 c, vec2 cells, vec2 cs, int row0, float cseed, out ivec2 cw, out vec2 src, out float rnd, out float drop, out float cov) {
  cw = wrapCell(c, ivec2(cells));
  ivec2 t = cw + ivec2(DR_MX, DR_MY);
  bool ok = t.x >= 0 && t.y >= 0 && t.x < int(cells.x) + 2 * DR_MX && t.y < int(cells.y) + DR_MY + DR_MX;
  vec4 s = texelFetch(t_cells, clamp(t, ivec2(0), ivec2(int(cells.x) + 2 * DR_MX - 1, int(cells.y) + DR_MY + DR_MX - 1)) + ivec2(0, row0), 0);
  rnd = hashI(cw, cseed);
  src = s.xy + vec2(c - cw) * cs;
  drop = s.z;
  cov = clamp(2.0 * s.a - 1.0, 0.0, 1.0);
  return ok && s.a > 0.25;
}

// Blisters' ragged-edge noises, all through one valueNoise call (D3D inlines every call site): first the lobes, an
// fBm from half a source cell down to ~4 px (fixed in place, so they stay put as the radius grows, and tile), each
// octave as deep as the blister allows (u_ragged × min(R, 0.8 × its wavelength)) — big blisters get bays and
// peninsulas, specks only wobble; then 0–2 the tear's octaves from ~2.5 px down to single pixels (weights DR_TEARW,
// so the tear spans −1..1) and 3 the lift's unevenness along the edge (flaps).
const float DR_NSCALE[3] = float[3](1.0, 2.0, 4.0);
const float DR_TEARW[3] = float[3](1.0, 0.6, 0.4);
const float DR_NSEED[4] = float[4](307.0, 311.0, 317.0, 313.0);

// Blisters (Sources), finished: d is the spots' smooth union (gen's cell loop). Adds the ledges (t_ledges: the distance
// to them, flooded before the layer runs; the band grows unevenly along them) and the raggedness — lobes (nL octaves
// from lam0 px down), a tear that small specks keep little of — then the peel: the paint lifts towards the torn edge,
// steepening as it curls, in flaps of their own heights and widths, and falls into the hole, Depth below the surface,
// onto a floor eaten deeper towards the middle, broadly uneven and rough.
GenOut dr_peel(vec2 p, vec2 q, float d, float rnd, float lam0, int nL, float tearAmp, float ks, float sat) {
  float R = u_blister;
  vec2 tc = snapCells(uRes / 2.5);
  // The flaps along the edge are about as long as the lift is wide (at least 2.5 px).
  float lamU = max(2.5, 1.25 * u_lift_width);
  vec2 tu = snapCells(uRes / lamU);
  // (Accumulated as they come: an array indexed in the loop costs D3D compile time.)
  float lobes = 0.0, tear = 0.0, nU = 0.5, n0 = 0.5, n1 = 0.5;
  int count = nL + 4;  // uniform-derived, so D3D keeps it a loop
  for (int i = 0; i < count; i++) {
    bool lobe = i < nL;
    int k = max(i - nL, 0);
    float lam = lam0 / exp2(float(i));
    vec2 per = lobe ? snapCells(uRes / lam) : k == 3 ? tu : tc * DR_NSCALE[min(k, 2)];
    float n = valueNoise(q / uRes * per, periodOf(per), uSeed + (lobe ? 301.0 + 100.0 * float(i) : DR_NSEED[k]));
    if (i == 0) n0 = n;
    if (i == min(1, nL - 1)) n1 = n;
    if (lobe) lobes += u_ragged * min(R, 0.8 * lam) * (n * 2.0 - 1.0);
    else if (k == 3) nU = n;
    else tear += DR_TEARW[min(k, 2)] * (n - 0.5);
  }
  if (R > 0.0) {
    // Ledge blisters: the band of ledge pixels (about the reach tall) opens from its middle as the radius grows — by none to
    // 2.2 × of it along the ledge (with raggedness), so stretches of sound paint break the chain.
    float grow = R * u_ledge_mix * mix(1.0, 2.2 * smoothstep(0.35, 0.8, n0), min(1.0, 2.0 * u_ragged));
    // (Saturating at sat, within the flood's range — see gen — so it doesn't step where the flood ends.)
    if (u_ledge_mix > 0.0) d = sdfCombine(5, d, min(fetchT(t_ledges, ivec2(floor(p))).r + 0.5 * u_ledge_reach + 0.5 - grow, sat), ks);
    d += lobes + tearAmp * tear;
  }
  float flap = smoothstep(0.25, 0.75, nU);
  float lw = max(u_lift_width * mix(1.0, 0.4 + 1.2 * flap, u_ragged), 1e-3);
  float x = clamp(1.0 - max(d, 0.0) / lw, 0.0, 1.0);
  float lift = u_lift * x * x * x * mix(1.0, 0.1 + 1.5 * flap, u_ragged);
  // The floor: a step down at the edge, then deeper towards the middle (over half the radius), unevenly.
  float bowl = smoothstep(0.0, max(1.5, 0.5 * R), -d) * (0.4 + 1.2 * n1);
  float floorH = -u_depth * (0.62 + 0.3 * bowl + 0.15 * tear);
  float hole = !u_aa ? (d <= 0.0 ? 1.0 : 0.0) : clamp(0.5 - d / 1.5, 0.0, 1.0);
  // (The height ramps from the lifted lip down into the hole over a few px when anti-aliased — a slope, not a cliff.)
  float rampH = max(1.5, 0.4 * u_lift_width);
  float holeH = !u_aa ? hole : smoothstep(rampH, -rampH, d);
  // The value is the floor's roughness, for a ramp to shade the rust by (darker, eaten deeper); coverage, the hole.
  return genOutHeight(clamp(0.78 + 0.2 * tear + 0.12 * bowl, 0.0, 1.0), hole, rnd, d, mix(lift, floorH, holeH));
}

// The wavelength (at least lam) over which a sway of amplitude a px stays within ~20° of vertical: water cannot run
// further sideways, so a wide sway takes a longer stretch.
float dr_lam(float lam, float a) { return max(lam, 8.0 * a); }
// The runnel style's centre line (px across, at px down).
float dr_cx(float y, float lam, float rs) {
  float n1 = valueNoise1(y / dr_lam(lam, 0.65 * u_wobble), rs + 1.0);
  float n2 = valueNoise1(y / dr_lam(0.37 * lam, 0.35 * u_wobble), rs + 2.0);
  return u_wobble * (1.3 * n1 + 0.7 * n2 - 1.0);
}
float dr_hw(float w, float t, float taper) { return max(0.5 * w * (1.0 - taper * t), 0.5); }
// The stain's half width at px down. sh: its seep width, fan-out and taper. The water spreads from its seep: from seep
// × its width to all of it over its first stretch — about its own width, or (Fan-out) a share of its length, then as a
// straight V — and Wash taper narrows (or spreads) it from there to the end.
float dr_halfw(float y, float w, float len, vec3 sh) {
  float L = max(len, 1e-3);
  float t = clamp(y / L, 0.0, 1.0);
  float ta = sh.y > 0.0 ? clamp((y - sh.y * L) / max((1.0 - sh.y) * L, 1e-3), 0.0, 1.0) : t;
  float u = clamp(y / mix(max(3.0, 1.2 * w), L, sh.y), 0.0, 1.0);
  return dr_hw(w, ta, sh.z) * mix(sh.x, 1.0, mix(u * u * (3.0 - 2.0 * u), u, sh.y));
}
// Runnel j's place across the wash (−1..1) at px down: its lane, wandering by Runnel braiding (hwF: the full half width).
float dr_bj(float base, float y, float lam, float hwF, float rs, int j) {
  float s = rs + 10.0 + 2.0 * float(j);
  float a = u_braid * hwF;
  float n1 = valueNoise1(y / dr_lam(0.5 * lam, 0.5 * a), s);
  float n2 = valueNoise1(y / dr_lam(0.17 * lam, 0.2 * a), s + 1.0);
  return clamp(base + u_braid * (n1 + 0.4 * n2 - 0.7), -0.95, 0.95);
}

// Coverage of a signed distance (px, < 0 inside): stepped when hard, else anti-aliased over 1 + Softness px (eased
// when soft, so a blurred edge has no visible ramp ends).
float dr_cov(float dist) {
  if (!u_aa) return step(dist, 0.0);
  float c = clamp(0.5 - dist / (1.0 + u_soft), 0.0, 1.0);
  return u_soft > 0.0 ? c * c * (3.0 - 2.0 * c) : c;
}

// One runnel-style stain, d from its source (px, y down), length len, head width w, strength st, per-stain seed rs (a
// whole number; each noise adds a whole offset of its own, as hashI truncates its seed), shape sh (seep width, fan-out, taper), led 1 when it falls from a ledge: its strength here (already anti-aliased: the
// caller uses it as both value and coverage).
#ifdef DR_RUNNELS
float dr_runnels(vec2 d, float len, float w, float st, float rs, vec3 sh, float led) {
  float lam = max(u_wander, 2.0);
  float e = !u_aa ? 0.0 : u_soft;
  float hwF = 0.5 * w;
  if (d.y < -2.0 - u_runnel_width - e || d.y > len + 6.0 * u_runnel_width + 2.0 + e) return 0.0;
  if (abs(d.x) > u_wobble + hwF * (1.0 + max(-sh.z, 0.0)) + 3.0 * u_runnel_width + 2.0 + e) return 0.0;
  float t = clamp(d.y / max(len, 1e-3), 0.0, 1.0);
  // (The sway ramps in below the seep, so the stain starts right on its source, its seep centred there.)
  float x = d.x - dr_cx(d.y, lam, rs) * smoothstep(0.0, max(8.0, w), d.y);
  float hw = dr_halfw(d.y, w, len, sh);
  float hs = sh.x * dr_hw(w, 0.0, sh.z);  // the seep's half width
  float best = 0.0;
  // The seep's lip, its corners rounded. top: px below it. A free seep's lip is ragged; a drip from a ledge starts on
  // the ledge's own line, darkest against it.
  float lip1 = 2.0 * valueNoise1(x / max(3.0, 0.3 * hs), rs + 4.0) - 1.0;
  // (Only a broad seep's lip is ragged: on a narrow one the bumps would read as horns — it seeps from one rounded point.)
  float top = d.y - min(0.3 * hs, 6.0) * (1.0 - led) * smoothstep(4.0, 12.0, hs) * (lip1 + 1.0);
  // Wash feather: a free stain fades in down from its lip — unevenly along it, eased, from just above it so Stain softness
  // still blurs the edge — and, below, in from its sides.
  float soft0 = -0.5 * (1.0 + e);
  // (Its fade is longest at the sides, so the head rounds to one centred seep; only a broad seep's varies along the lip.)
  float broad = smoothstep(4.0, 12.0, hs);
  float xr = min(abs(x) / max(hs, 1.0), 1.5);
  float fTop = u_feather > 0.0 ? smoothstep(soft0, max(4.0, u_feather * max(4.0 * hs, 1.5 * hwF)) * (1.0 + 0.5 * lip1 * broad) * (1.0 + (1.0 - broad) * xr * xr), top) : 1.0;
  fTop = mix(fTop * fTop, 1.0, led);
  // Fan-out: the same water spread wider is fainter — darkest at the seep, fading as the stain widens.
  st *= sh.y > 0.0 ? pow(clamp(hs / max(hw, 1e-3), 0.05, 1.0), 0.6 * sh.y) : 1.0;
  // Wash: the water sheet, tide-marked sides, dry patches, streaks; its corners at the lip rounded.
  if (d.y >= -1.0 - 0.5 * e && d.y <= len) {
    float side = hw - abs(x);
    float r = mix(0.4 * hs, min(0.15 * hs, 2.0), led);
    float inEdge = side < r && top < r ? r - length(vec2(r - side, r - top)) : min(side, top);
    float inside = dr_cov(-inEdge);
    if (inside > 0.0) {
      // Tide marks along the sides only (not across the seep): about a px wide, wider on broad stains.
      float tw = (1.0 + 0.5 * e) * max(1.0, 0.08 * hwF) * mix(1.0, 1.6, clamp(u_edge - 1.0, 0.0, 1.0));
      float sd = max(side, 0.0);
      // (They come in after the head, and only on stains wide enough to have two sides — on a narrow one the two
      // would meet in a dark core, at a free stain's head in two dark horns.)
      float tide = exp(-sd * sd / (1.5 * tw * tw)) * smoothstep(0.0, 2.0 * r + 1.0, top) * fTop * fTop * smoothstep(1.5, 4.0, hw);
      // Its noises through one valueNoise call: 0 dry patches; 1, 2 the streaks (two octaves, stretched down the
      // stain); 3 where each streak runs out (across only). Accumulated as they come: an array indexed in the loop
      // costs D3D compile time.
      float sw = max(u_streak_w, 0.5);
      float sl = max(6.0 * sw, 0.3 * len);
      float nDry = 0.5, nStreak = 0.0, nEnd = 0.0;
      int count = u_breakup > 0.0 || u_streaks > 0.0 ? 4 : 0;
      // (The streaks' spacing wanders, so they are no comb.)
      float xs = x + 1.5 * sw * (2.0 * valueNoise1(x / (4.0 * sw), rs + 5.0) - 1.0);
      for (int i = 0; i < count; i++) {
        vec2 a = i == 0 ? vec2(x / max(6.0, 0.6 * hw), d.y / max(20.0, 2.0 * hw))
               : i == 3 ? vec2(xs / (1.7 * sw), 0.5)
               : vec2(xs / sw, d.y / sl) * (i == 1 ? 1.0 : 2.3);
        float n = valueNoise(a, NO_PERIOD, rs + 3.0 * float(i));
        if (i == 0) nDry = n;
        else if (i == 3) nEnd = n;
        else nStreak += (i == 1 ? 0.65 : 0.35) * n;
      }
      // (No dry patches in the seep, where they would read as holes.)
      // Dry patches: broad (at least 6 × 20 px), soft, never quite bare — no light specks in a dark stain.
      float dry = u_breakup <= 0.0 ? 1.0 : mix(1.0, mix(0.3, 1.0, smoothstep(u_breakup - 0.2, u_breakup + 0.2, nDry)), smoothstep(0.1, 0.35, t));
      // The wash is whole at its seep and breaks into streaks further down.
      float streak = 1.0 - 0.85 * u_streaks * smoothstep(0.0, 0.4, t) * (1.0 - smoothstep(0.25, 0.75, nStreak));
      float te = clamp(d.y / max(len * (1.0 - 0.6 * u_streaks * nEnd), 1e-3), 0.0, 1.0);
      // Wash feather: the sheet fades in from the sides and from the lip (the tide marks stay at the edge).
      float body = u_feather > 0.0 ? smoothstep(soft0, max(u_feather * hw, -soft0), side) * fTop : 1.0;
      // (The tide marks only lightly broken by the streaks, so a strong setting reads as a rim.)
      best = st * pow(1.0 - te, u_fade) * (u_sheet * dry * body * streak + u_edge * tide * mix(1.0, streak, 0.35)) * inside;
    }
  }
  // Runnels: 1 to u_runnels of them (narrow stains hold fewer), each of its own width, wandering on its own.
  int k = u_runnels > 0 ? 1 + int(floor(hashI(ivec2(1, 31), rs) * float(u_runnels))) : 0;
  // (A stain narrower than about 2.5 runnel widths is the wash alone — a runnel would only be a dark core.)
  k = clamp(min(k, int(w / max(2.5 * u_runnel_width, 0.75))), 0, 16);
  // A free stain's runnels leave its seep together and part below it, so its head is one seep, not side-by-side points.
  float gather = led < 0.5 ? smoothstep(0.0, max(6.0, 0.25 * len), d.y) : 1.0;
  for (int j = 0; j < k; j++) {
    vec3 hr = hash3I(ivec2(j, 33), rs);
    float hb = hashI(ivec2(j, 35), rs);
    float lj = len * (0.45 + 0.55 * hr.x);
    float base = k == 1 ? 0.0 : ((float(j) + 0.5) / float(k) * 2.0 - 1.0) * 0.8;
    float wj = u_runnel_width * (0.6 + 0.7 * hr.y);
    // A runnel keeps most of its strength to its end (fade: how much it loses), where it may stop in a bead.
    float s0 = st * u_runnel_str * (0.7 + 0.3 * hb);
    float endS = s0 * mix(1.0, 0.35, clamp(0.5 * u_fade, 0.0, 1.0));
    // Its place across here (at its end, below it), once for the runnel and its bead.
    float yc = clamp(d.y, 0.0, lj);
    float xj = x - dr_bj(base, yc, lam, hwF, rs, j) * hw * gather;
    if (d.y >= -0.5 - e && d.y <= lj + 0.5 + e) {
      float tj = yc / max(lj, 1e-3);
      float rw = max(wj * (1.0 - 0.5 * tj), 0.5);
      // Its ends: anti-aliased (or softened) like its sides, rather than cut; it starts below the lip, as the wash does.
      float dist = max(max(abs(xj) - 0.5 * rw, -min(d.y, lj - d.y)), -top);
      // (Off a ledge they start with the wash; a free stain's runnels gather a little after it, so its head is one
      // soft seep rather than separate dark points.)
      best = max(best, mix(s0, endS, tj) * dr_cov(dist) * mix(fTop * fTop, fTop, led));
    }
    // Bead: a drop (of its own size) where the runnel ends, a little stronger than the runnel there — an ellipse
    // narrower than it is tall, hanging from the runnel (a round one reads as a rivet).
    if (hb < u_beads) {
      vec2 rb = vec2(0.45, 0.85) * (wj * (0.6 + 0.9 * hr.z) + 0.6);
      float db = (length(vec2(xj, d.y - lj - 0.5 * rb.y) / rb) - 1.0) * rb.x;
      best = max(best, min(1.0, endS + 0.15 * u_runnel_str) * dr_cov(db));
    }
  }
  return best;
}
#endif

GenOut gen(vec2 p) {
  vec2 q = vec2(p.x, uRes.y - p.y);          // user space, y down (the direction drips run)
  bool blisters = u_output == 1;
#ifdef DR_RUNNELS
  bool runnels = !blisters && u_style == 1;
#else
  const bool runnels = false;  // (so Streak and Sources compile none of the Runnels code)
#endif
  float e = !u_aa ? 0.0 : u_soft;
  // Two sets of source cells (see dr_wA): A the grid, B the ledges. For each, the cells to visit: columns either side
  // (cr) and rows from rs in steps of rowStep (nr of them); and for stains the longest trail its search can reach.
  vec2 cellsA = vec2(float(u_cols), float(u_rows));
  vec2 csA = uRes / cellsA;
  vec2 cellsB = dr_cellsB();
  vec2 csB = uRes / cellsB;
  int crA, crB, nrA, nrB, rsA, rsB, rowStep, nL = 0;
  float R = u_blister, ks = max(0.35 * R, 0.25), lam0 = 0.0, tearAmp = 0.0, sat = 0.0, bdCap = 1e4;
  float capA = 1e9, capB = 1e9, tail = 0.0, yLo = 0.0, yHd = 0.0, xMax = 0.0;
  if (blisters) {
    // Every source whose blister (ragged, with its lifted lip) can reach this pixel. A big radius on a fine grid is
    // cut short at 5 cells each way (8 without the ledge search): by then the blisters have merged into areas.
    // The lobes: octaves from half a grid cell down to ~4 px (at least one), as deep as the radius allows.
    lam0 = 0.5 * min(csA.x, csA.y);
    nL = clamp(int(floor(log2(max(lam0, 1.0) / 4.0))) + 1, 1, 6);
    float lobeAmp = u_ragged * min(R * float(nL), 1.6 * lam0);
    tearAmp = 2.4 * u_ragged * min(1.0, R / 2.5);
    float reach = R + lobeAmp + tearAmp + 1.6 * u_lift_width + 1.0;
    int most = u_spawn > 0.0 ? 5 : 8;
    crA = clamp(int(ceil(reach / csA.x)), 1, most);
    int ryA = clamp(int(ceil(reach / csA.y)), 1, most);
    crB = clamp(int(ceil(reach / csB.x)), 1, 6);
    int ryB = clamp(int(ceil(reach / csB.y)), 1, 6);
    nrA = R > 0.0 ? 2 * ryA + 1 : 0;
    nrB = R > 0.0 ? 2 * ryB + 1 : 0;
    rsA = -ryA;
    rsB = -ryB;
    rowStep = 1;
    // Past sat px the peel draws nothing (its lift, hole and ramp are spent, whatever the lobes, tear and smoothing
    // add), so its distance — the mask's — can saturate there instead of jumping where the search or the ledge flood
    // ends. The spots' is exact out to the search window (less a radius; set B's spots sit up to 2 px below their
    // cells). blisterReach (TS) mirrors sat for the flood's range.
    sat = lobeAmp + tearAmp + max(1.6 * u_lift_width, 1.5) + 1.0 + 1.5 * ks;
    float win = min(dr_wA() > 0.0 ? min(float(crA) * csA.x, float(ryA) * csA.y) : 1e4,
                    dr_wB() > 0.0 ? min(float(crB) * csB.x, float(ryB) * csB.y - 2.0) : 1e4);
    bdCap = max(win - R - ks, sat);
  } else {
    // Stains: from the row below (heads straddling a cell edge) upward as far as a trail can run (at most 96 rows:
    // longer trails are shortened to what the search reaches, so they still fade out), and as many columns either
    // side as a stain can wander and spread.
    float L = u_len_max * (1.0 + u_relief_len);
    int upA = min(int(ceil(L / csA.y)) + 1, DR_MY);
    int upB = min(int(ceil(L / csB.y)) + 1, DR_MY);
    tail = runnels ? 6.0 * u_runnel_width + 2.0 + e : e;
    capA = max(float(upA) * csA.y - tail, float(upA - 1) * csA.y);
    capB = max(float(upB) * csB.y - tail, float(upB - 1) * csB.y);
    float reachX = 0.0;
#ifdef DR_RUNNELS
    if (runnels) reachX = u_wobble + 0.5 * u_width * (1.8 + max(-u_taper, 0.0) + 0.6 * u_shape_var) + 3.0 * u_runnel_width + 2.0 + e;
    else
#endif
    reachX = u_wobble + 0.5 * u_width + 0.5 * e + 0.5;
    crA = clamp(int(ceil(reachX / csA.x)), 1, 6);
    crB = clamp(int(ceil(reachX / csB.x)), 1, 12);
    // The farthest any stain reaches from its source — above it (yLo), below (its length + tail, or yHd for the head
    // blob) and either side (xMax: at the widest a ledge and Shape variation make it) — for the cheap test before a
    // cell's hashes. Bounds, not the search's reach: they must clip nothing.
    yHd = u_head + 1.0 + e;
    yLo = -max(2.0 + e + (runnels ? u_runnel_width : 0.0), yHd);
    xMax = max(yHd, runnels ? u_wobble + 0.75 * u_width * (1.0 + max(-u_taper, 0.0) + 0.6 * u_shape_var) + 3.0 * u_runnel_width + 2.0 + e
                            : u_wobble + 0.5 * max(u_width, 1.0) + 1.0 + e);
    nrA = upA + 2;
    nrB = upB + 2;
    rsA = 1;
    rsB = 1;
    rowStep = -1;
  }
  // Surface flow: the rises met going down this pixel's column, summed from the top (t_flow, prepare); and just below
  // it, where the water pools against them.
  ivec2 pc = ivec2(floor(p));
  float Ap = 0.0, Aps = 0.0, Atot = 0.0, pool = 1.0;
  if (u_flow > 0.0 && !blisters) {
    Ap = texelFetch(t_flow, pc, 0).r;
    // (Averaged with 4 and 8 px above, so a trail weakens over a few px below a rise instead of being cut there.)
    int Hm = int(uRes.y) - 1;
    Aps = (Ap + texelFetch(t_flow, ivec2(pc.x, min(pc.y + 4, Hm)), 0).r + texelFetch(t_flow, ivec2(pc.x, min(pc.y + 8, Hm)), 0).r) / 3.0;
    Atot = texelFetch(t_flow, ivec2(pc.x, 0), 0).r;
    pool = 1.0 + 0.8 * u_flow * smoothstep(0.03, 0.25, texelFetch(t_flow, ivec2(pc.x, max(pc.y - 3, 0)), 0).r - Ap);
  }
  int ncA = 2 * crA + 1, ncB = 2 * crB + 1;
  int totA = dr_wA() > 0.0 ? ncA * nrA : 0;
  int totB = dr_wB() > 0.0 ? ncB * nrB : 0;
  int rowB0 = dr_rowB0();
  float best = 0.0, bestCov = 0.0, bestRnd = 0.0, acc = 0.0;
  float bd = 1e4, nearest = 1e4;
  // Streaks: they sway once per Wobble length (two octaves: a third of it and about all of it), slower still for a
  // wide wobble, so the trail meanders instead of zig-zagging (0.7 and 0.23 rad per px at 28 px and a small wobble).
  float wf = min(1.0, 0.7 / max(u_wobble, 1e-3)) * 28.0 / max(u_wander, 2.0);
  // One flat loop over the cells of both sets, for both outputs, with a uniform-derived count and the arguments picked
  // per iteration: nested or constant loops make D3D's compiler unroll, and each call site is inlined. (No continue:
  // ANGLE can miscompile it.)
  for (int n = 0; n < totA + totB; n++) {
    bool isB = n >= totA;
    int m = isB ? n - totA : n;
    int nc = isB ? ncB : ncA;
    int cr = isB ? crB : crA;
    vec2 cellsX = isB ? cellsB : cellsA;
    vec2 csX = isB ? csB : csA;
    float cseed = uSeed + (isB ? 7919.0 : 0.0);
    int jj = m / nc;
    ivec2 c = ivec2(floor(q / csX)) + ivec2(m - jj * nc - cr, (isB ? rsB : rsA) + rowStep * jj);
    ivec2 cw;
    vec2 src;
    float rnd, drop, lcov;
    if (dr_cell(c, cellsX, csX, isB ? rowB0 : 0, cseed, cw, src, rnd, drop, lcov)) {
      if (blisters) {
        // (Blisters that Size variation leaves under 2 px — or half the radius — are dropped: they read as specks.)
        float rr = R * (1.0 - u_blister_var * hashI(cw, cseed + 19.0));
        if (rr >= min(2.0, 0.5 * R)) {
          float ds = length(q - src) - rr;
          if (ds < nearest) { nearest = ds; bestRnd = rnd; }
          bd = sdfCombine(5, bd, ds, ks);
        }
      } else {
        vec2 d = q - src;
        float cap = isB ? capB : capA;
        // (Fine ledge grids visit hundreds of cells: rule out the stains that can't reach this pixel before hashing.)
        if (d.y >= yLo && d.y <= max(cap + tail, yHd) && abs(d.x) <= xMax) {
        float len = min(mix(u_len_min, u_len_max, hashI(cw, cseed + 13.0)) * (1.0 + u_relief_len * drop), cap);
        float w = u_width * (1.0 - u_width_var * hashI(cw, cseed + 17.0));
        // (Less water runs off a short ledge — a rivet's lower edge — than off a whole lip.)
        float st = u_start * (1.0 - u_str_var * hashI(cw, cseed + 23.0)) * mix(0.45, 1.0, lcov);
        float v = 0.0, cov = 0.0;
        // Optional drop blob at the origin.
        if (u_head > 0.0) {
          float ch = dr_cov(length(d) - u_head);
          if (ch > 0.0) { v = 1.0; cov = ch; }
        }
#ifdef DR_RUNNELS
        if (runnels) {
          // Shape variation: each stain its own seep width (¼ to 4 ×), fan-out and taper (± 0.6) — at 1 point seeps and
          // wide Vs among the lines.
          vec3 sh = vec3(u_seep, u_fan, u_taper);
          vec3 hv = hash3I(cw, cseed + 29.0) - 0.5;
          if (u_shape_var > 0.0) {
            sh = clamp(vec3(u_seep * exp2(4.0 * u_shape_var * hv.x), u_fan + 1.2 * u_shape_var * hv.y, u_taper + 1.2 * u_shape_var * hv.z), vec3(0.05, 0.0, -1.0), vec3(1.0));
          }
          // A drip from a ledge starts on the ledge's own line (by how far it runs: a lip all the way, a rivet's short
          // lower edge only a little); its seep — Seep width × its width, centred on the ledge spot — fans out by
          // Fan-out like any stain's, and some are broader, so neighbours along a lip meet in one band under it.
          float led = drop > 1e-4 ? lcov : 0.0;
          w *= 1.0 + 0.5 * led * (hv.x + 0.5);
          // A drip off a short ledge (a rivet) runs on longer, faint, past the next rivet down rather than stopping.
          if (drop > 1e-4) len = min(len * mix(1.6, 1.0, lcov), cap);
          // Its seed: a full-width hash of its cell (whole, and exact as a float), so no two stains share their shape.
          float rs = float(pcg3(uvec3(uvec2(cw), uint(cseed) + 977u)) >> 9u);
          float sr = dr_runnels(d, len, w, st, rs, sh, led);
          if (sr > v * cov) { v = sr; cov = 1.0; }
        } else
#endif
        if (d.y >= -0.5 * e && d.y <= len) {
          // Trail below the source.
          float t = clamp(d.y / max(len, 1e-3), 0.0, 1.0);
          float cx = u_wobble * (sin(d.y * 0.7 * wf + rnd * 40.0) * 0.6 + sin(d.y * 0.23 * wf + rnd * 17.0) * 0.4);
          float hw = 0.5 * w * (1.0 - 0.5 * t);
          if (!u_aa) { cx = floor(cx + 0.5); hw = max(hw, 0.5); }
          float ct = dr_cov(abs(d.x - cx) - hw) * (e > 0.0 ? smoothstep(-0.5 * e, 0.5 * e, d.y) : 1.0);
          float vt = st * pow(1.0 - t, u_fade);
          if (ct > 0.0 && vt * ct > v * cov) { v = vt; cov = ct; }
        }
        // Surface flow: weaker for every rise crossed since the source (in this pixel's column — a rivet leaves a dry
        // shadow, a seam a break), stronger where it pools just above one.
        if (u_flow > 0.0 && v * cov > 0.0) {
          // (Counted from a few px below the source: a drip's own ledge — the groove under a lip — doesn't dim it.)
          int ys = int(floor(src.y)) + int(u_ledge_reach + 0.5) + 3;
          int H = int(uRes.y);
          float As = ys >= 0 ? texelFetch(t_flow, ivec2(pc.x, H - 1 - min(ys, H - 1)), 0).r
                   : uTile ? texelFetch(t_flow, ivec2(pc.x, clamp(-1 - ys, 0, H - 1)), 0).r - Atot : 0.0;
          // (Each trail its own: some pass a rivet or a seam that stops others.)
          float hf = hashI(cw, cseed + 37.0);
          float fs = u_flow * (0.1 + 1.9 * hf * hf);
          // (A rivet-sized rise — under about a quarter of a height unit — doesn't weaken it: the trail runs on past the
          // next rivet, gathering darker just above it.)
          v *= pool / (1.0 + 3.0 * fs * max(Aps - As - 0.25, 0.0));
        }
        if (v * cov > best * bestCov) { best = v; bestCov = cov; bestRnd = rnd; }
        // (Overlapping stains add up — water from a column of rivets darkens all the way down rather than restarting
        // at each one.)
        acc = 1.0 - (1.0 - acc) * (1.0 - clamp(v * cov, 0.0, 1.0));
        }
      }
    }
  }
  if (blisters) return dr_peel(p, q, R > 0.0 ? min(bd, bdCap) : bd, bestRnd, lam0, nL, tearAmp, ks, sat);
  // Soft coverage = strength (at most 1), so a Normal diffuse blend stains in proportion to it. No shape (only the
  // blisters have one).
  return genOut(acc, acc, bestRnd, NO_SDF);
}
`
};
