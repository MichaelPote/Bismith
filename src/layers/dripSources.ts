// Where drips and blisters start, shared by Drips (the stains running down from them) and Blisters (the peeling paint
// they bleed from), so the two line up: with the same seed and placement settings they start in the same places.
//
// Two independent sets of sources. Set A is scattered over the Columns × Rows grid, one per cell by Density, anywhere
// in it. Set B lies along the ledges of the relief beneath (layers/ledges.ts): cells of Ledge spacing px, each holding
// its strongest ledge pixel — anywhere along every ledge, whatever the grid — by Ledge drips (or Ledge spots) × how
// much its drop counts; Start at moves it from the lip down to the foot of the drop. Clustering gathers both into runs
// with bare stretches between.
//
// The source pass (prepare) works out every cell's source once — texel (c + margins) of one texture, set B below set
// A — and the layer's gen() reads it (`SOURCE_READ_GLSL`).

import type { Texture } from 'three';
import { P, type ParamDef, type ParamValues } from '@/core/params';
import type { FilterContext } from '@/render/materialPipeline';
import { LEDGE_GLSL, ledgeCells, ledgeParams } from './ledges';

/**
 * Margins of the per-cell source texture: DR_MX columns either side and rows below, DR_ROWS rows above (the most a
 * search looks up).
 */
export const DR_MX = 8;
export const DR_ROWS = 96;

/** The set B spacing a layer uses: a GLSL expression and its TS mirror (the ledge cells must match). */
export interface SourceSpacing {
	glsl: string;
	px: (p: ParamValues) => number;
}

/** The two sets' layout in the source texture, shared by the source pass and gen(). */
export const sourceGridGlsl = (gap: SourceSpacing) => /* glsl */ `
const int DR_MX = ${DR_MX};
const int DR_MY = ${DR_ROWS};
// Set B's cells across and down (whole numbers, so they tile). (ledgeGrid mirrors it.)
vec2 dr_cellsB() { return max(vec2(1.0), floor(uRes / (${gap.glsl}) + 0.5)); }
// Set B's first texel row in the source texture (set A's cells and margins come first).
int dr_rowB0() { return u_rows + DR_MY + DR_MX; }
// How far below its lip a ledge source may sit (Start at: its foot, dr_foot), at most — the searches reach that much
// further up for set B.
int dr_footMax() { return int(min(6.0 * u_ledge_reach + 8.0, 96.0)); }
float dr_shiftB() { return u_ledge_start * float(dr_footMax()); }
`;

/**
 * The source pass: texel (c + margins) holds cell c's source — (position, user px; its ledge drop; 0 none, else 0.5 +
 * half the ledge's span). `span`: a GLSL width (px) to measure how far each ledge runs against (Drips: the stain's
 * width — less water runs off a short ledge); without one every span is 1.
 */
const sourceCellsGlsl = (gap: SourceSpacing, span?: string) =>
	sourceGridGlsl(gap) +
	LEDGE_GLSL +
	/* glsl */ `
uniform sampler2D tLedgeB;  // set B's ledge cells
// Clustering: the chance at pos (user px) swells and fades over patches a few grid cells (cs; at least 1/8 of the
// texture) across — the same patches for the grid and the ledges; at 1 about half the area is bare.
float dr_cluster(vec2 pos, vec2 cs) {
  if (u_cluster <= 0.0) return 1.0;
  float lc = max(3.0 * max(cs.x, cs.y), min(uRes.x, uRes.y) / 8.0);
  vec2 per = max(vec2(1.0), floor(uRes / lc + 0.5));
  float n = valueNoise(pos / uRes * per, periodOf(per), uSeed + 43.0);
  return mix(1.0, 2.0 * smoothstep(0.45, 0.7, n), u_cluster);
}
// Ledge cell l (unwrapped) of set B: its strongest ledge pixel and its drop (z; -1 outside an untiled texture).
vec4 dr_ledgeCell(ivec2 l, vec2 cellsL) {
  ivec2 lw = wrapCell(l, ivec2(cellsL));
  if (!uTile && (l.x < 0 || l.y < 0 || l.x >= int(cellsL.x) || l.y >= int(cellsL.y))) return vec4(0.0, 0.0, -1.0, 0.0);
  vec4 s = texelFetch(tLedgeB, lw, 0);
  return vec4(s.xy + vec2(l - lw) * (uRes / cellsL), s.zw);
}
// The foot of the ledge at lp (user px; its drop over the Ledge reach): how far below lp the height stops falling —
// past the steep part, where the fall per px drops under a fifth of the ledge's average. Under a hard step that is
// the reach or so; under a pipe or a rounded lip, the crease where it meets the surface behind. (At most dr_footMax.)
float dr_foot(vec2 lp, float drop) {
  ivec2 g = ivec2(int(floor(lp.x)), int(uRes.y) - 1 - int(floor(lp.y)));  // GL px
  float thr = max(0.2 * drop / max(u_ledge_reach, 1.0), 1e-3);
  float foot = 0.0, h = fetchT(tSurface, g).r;
  bool started = false, done = false;
  int n = dr_footMax();  // uniform-derived, so D3D keeps it a loop
  for (int i = 0; i < n; i++) {
    if (!done) {
      float h1 = fetchT(tSurface, g - ivec2(0, i + 1)).r;
      // (A soft ledge's window may start above its steep part: up to the reach in, a gentle step doesn't end it.)
      if (h - h1 >= thr) { started = true; foot = float(i + 1); }
      else if (started || float(i) >= u_ledge_reach) done = true;
      h = h1;
    }
  }
  return foot;
}
${
	span
		? /* glsl */ `
// How far the ledge at pos (user px) runs either side, against the span width: about 0.3 for a rivet's lower edge, 1 for
// a lip that runs on past it.
const float DR_SPAN[8] = float[8](-1.5, -1.0, -0.5, -0.25, 0.25, 0.5, 1.0, 1.5);
float dr_span(vec2 pos) {
  float n = 0.0;
  int gy = int(uRes.y) - 1 - int(floor(pos.y));
  for (int i = 0; i < 8; i++) {
    ivec2 g = ivec2(int(floor(pos.x + DR_SPAN[i] * max(4.0, ${span}))), gy);
    n += max(ledgeOk(ledgeDrop(g)), max(ledgeOk(ledgeDrop(g + ivec2(0, 1))), ledgeOk(ledgeDrop(g - ivec2(0, 1)))));
  }
  return n / 8.0;
}`
		: `float dr_span(vec2 pos) { return 1.0; }`
}

// Set A: the source of grid cell c (unwrapped, so it lies near the caller), scattered anywhere in it: false when the
// cell holds none. cw: the cell wrapped (for its hashes).
bool dr_source(ivec2 c, vec2 cells, vec2 cs, out ivec2 cw, out vec2 src, out float drop, out bool onLedge, out vec2 lpos) {
  cw = wrapCell(c, ivec2(cells));
  src = (vec2(c) + hash2I(cw, uSeed + 9.0)) * cs;
  drop = 0.0;
  onLedge = false;
  lpos = src;
  float dens = u_density * dr_cluster((vec2(cw) + 0.5) * cs, cs);
  if (hashI(cw, uSeed + 5.0) >= dens) return false;
  if (!u_aa) src = floor(src) + 0.5;  // pixel centres, so 1 px trails and heads hit whole pixels
  return true;
}

// Set B: ledge cell c (unwrapped) — its strongest ledge pixel, moved down towards the ledge's foot by Start at, and a
// px or two lower now and then so the sources along a lip don't all sit on one line; csA: the grid's cells (for the
// clustering's scale). Its own hashes (seed + 7919), so it is independent of the grid.
bool dr_ledgeSource(ivec2 c, vec2 cellsB, vec2 csA, out ivec2 cw, out vec2 src, out float drop, out bool onLedge, out vec2 lpos) {
  cw = wrapCell(c, ivec2(cellsB));
  vec4 b = dr_ledgeCell(c, cellsB);
  drop = max(b.z, 0.0);
  onLedge = b.z >= 0.0;
  lpos = b.xy;
  float dens = u_ledge_density * ledgeOk(drop) * dr_cluster((vec2(cw) + 0.5) * (uRes / cellsB), csA);
  bool ok = onLedge && hashI(cw, uSeed + 7924.0) < dens;
  float foot = ok && u_ledge_start > 0.0 ? dr_foot(b.xy, drop) : 0.0;
  src = b.xy + vec2(0.0, floor(u_ledge_start * foot + 0.5) + floor(2.5 * hashI(cw, uSeed + 7929.0)));
  if (!u_aa) src = floor(src) + 0.5;
  return ok;
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
  // (One dr_span call site: D3D inlines each.)
  float cov = ok && onLedge ? dr_span(lpos) : 1.0;
  oColor = vec4(src, drop, ok ? 0.5 + 0.5 * cov : 0.0);
}
`;

/** Reading the source pass in gen() (the layer's `cells` texture), after `sourceGridGlsl`. */
export const SOURCE_READ_GLSL = /* glsl */ `
// Cell c's source, from the source pass (unwrapped, so it lies near the caller): false when the cell holds none. cells:
// its set's cells across and down, row0: the set's first texel row, cseed: the set's seed. cw: the cell wrapped (for
// its hashes), rnd: its random, drop: the ledge it sits on, cov: how far that ledge runs (1 off a ledge).
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
`;

/** Set B's ledge cells across and down, as the shader works them out (dr_cellsB). */
export function ledgeGrid(p: ParamValues, w: number, h: number, gap: SourceSpacing) {
	const g = gap.px(p);
	return [w, h].map((r) => Math.max(1, Math.floor(r / g + 0.5))) as [number, number];
}

/**
 * Runs the ledge cells and the source pass (a layer's prepare) and returns the source texture, its `cells`. Every
 * cell's source once, cells beyond the texture too (for what runs in from outside it); set A first, then (with ledge
 * sources) set B, each with its margins. (Each ledge cell count + 1: the shader's float division may round the other
 * way.)
 */
export function sourceCells(ctx: FilterContext, p: ParamValues, gap: SourceSpacing, span?: string): Texture {
	const type = ctx.layer.type;
	const ledges = Number(p.ledge_density) > 0;
	const cellsB = ledgeGrid(p, ctx.width, ctx.height, gap);
	const [bx, by] = ledges ? [cellsB[0] + 1, cellsB[1] + 1] : [0, 0];
	const cells = ctx.scratch(
		`${type}-cells`,
		Math.max(Number(p.cols), bx) + 2 * DR_MX,
		Number(p.rows) + DR_ROWS + DR_MX + (ledges ? by + DR_ROWS + DR_MX : 0)
	);
	// The ledge cells first (each one's strongest ledge pixel, layers/ledges.ts).
	const lb = ledges ? ledgeCells(ctx, `${type}-lcells`, cellsB) : ctx.scratch(`${type}-lcells`, 1, 1).texture;
	const mat = ctx.material(`${type}:cells`, sourceCellsGlsl(gap, span), { tLedgeB: { value: null } });
	mat.uniforms.tLedgeB.value = lb;
	ctx.run(mat, cells);
	return cells.texture;
}

const ledgeSources = (p: ParamValues) => Number(p.ledge_density) > 0;

/**
 * The placement params: `grid` for the top of the layer (Columns, Rows, Density, Clustering) and `ledges` for its
 * Ledges group (the ledge sources, their spacing and start, and the ledge test). `noun`: what starts there ('drip').
 */
export function placementParams(noun: string, o: { ledgeLabel: string; gapHint?: string }) {
	const grid: ParamDef[] = [
		P.int('cols', 'Columns', 12, 1, 1024, {
			softMax: 128,
			hint: `How many grid cells fit across the texture for the scattered ${noun}s, each holding at most one, anywhere in it`
		}),
		P.int('rows', 'Rows', 6, 1, 1024, { softMax: 128, hint: 'How many grid cells fit down the texture' }),
		P.float('density', 'Density', 0.5, 0, 1, {
			step: 0.001,
			hint: `Sets the chance that a grid cell gets a scattered ${noun} (0 = none: only the ${o.ledgeLabel}, under Ledges)`
		}),
		P.float('cluster', 'Clustering', 0.35, 0, 1, {
			step: 0.001,
			hint: `Gathers the ${noun}s into groups with bare stretches between (along a ledge: runs of them and gaps; 0 = evenly scattered)`
		})
	];
	const ledges: ParamDef[] = [
		P.float('ledge_density', o.ledgeLabel, 0, 0, 1, {
			step: 0.001,
			group: 'relief',
			hint: `Starts ${noun}s along the ledges beneath as well as the scattered ones: the chance that each spot along a ledge (one per Ledge spacing px) gets one, so a base full of lips and rivets gets more. Ledges are the lower edges of raised features like rivets, lips, pipes and seams, picked by the Threshold, Reach and Softness below (0 = none)`
		}),
		P.float('ledge_gap', 'Ledge spacing', 4, 1, 512, {
			softMax: 128,
			unit: 'px',
			step: 0.5,
			group: 'relief',
			showIf: ledgeSources,
			hint: `Sets how far apart ${noun}s can start along a ledge; ${o.ledgeLabel} picks among those spots${o.gapHint ?? ''}`
		}),
		P.float('ledge_start', 'Start at', 1, 0, 1, {
			step: 0.001,
			group: 'relief',
			showIf: ledgeSources,
			hint: `Picks where on a ledge's drop its ${noun}s start: 0 at the lip, where the height begins to fall; 1 at the foot, where it stops falling — under a pipe or a rounded edge, the crease where it meets the surface behind`
		}),
		...ledgeParams({ group: 'relief' }, undefined, true)
	];
	return { grid, ledges };
}
