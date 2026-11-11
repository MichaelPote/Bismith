// Ledges in the relief below — where the height drops going down the texture, as under a brick's lower edge or a
// moulding's lip — and the cells that find them, shared by the layers that hang things from them: Drips (the trails and
// Blisters' blisters start there) and Ice (its icicles hang there).
//
// The test reads the layer's `ledge` (the drop that counts), `ledge_reach` (how far below it is measured) and
// `ledge_soft` (ledgeParams). The cells pass finds, in every cell of a grid, its strongest ledge pixel — every pixel
// tried, so a ledge anywhere in a cell is found whatever the grid.

import type { Texture } from 'three';
import { P, type ParamDef, type ParamValues } from '@/core/params';
import type { FilterContext } from '@/render/materialPipeline';

/** The ledge test (GLSL, after the material prelude and the layer's uniforms). */
export const LEDGE_GLSL = /* glsl */ `
// The height drop from a pixel to the one the ledge reach below it (GL pixel c).
float ledgeDrop(ivec2 c) { return fetchT(tSurface, c).r - fetchT(tSurface, c - ivec2(0, int(u_ledge_reach + 0.5))).r; }
// How much a drop counts as a ledge, 0..1.
float ledgeOk(float drop) {
  return u_ledge > 0.0 ? smoothstep(u_ledge * (1.0 - max(u_ledge_soft, 0.01)), u_ledge, drop) : step(1e-4, drop);
}
`;

/** The cells pass: one texel per cell of a uLedgeCells grid — its strongest ledge pixel (user px) and its drop. */
const LEDGE_CELLS_GLSL =
	LEDGE_GLSL +
	/* glsl */ `
uniform vec2 uLedgeCells;
void main() {
  ivec2 l = ivec2(floor(gl_FragCoord.xy));
  vec2 csL = uRes / uLedgeCells;
  ivec2 lo = ivec2(ceil(vec2(l) * csL - 0.5));
  ivec2 hi = ivec2(ceil(vec2(l + 1) * csL - 0.5));
  int n = max(hi.x - lo.x, 1);
  int count = n * max(hi.y - lo.y, 0);
  float best = -1.0, bestS = -1.0;
  vec2 pos = (vec2(l) + 0.5) * csL;
  for (int i = 0; i < count; i++) {
    ivec2 pu = lo + ivec2(i - (i / n) * n, i / n);  // user px
    float dd = ledgeDrop(ivec2(pu.x, int(uRes.y) - 1 - pu.y));
    // (Pixels within a few % of the strongest are picked among at random: along an even ledge — a pipe, a moulding —
    // the first would win in every cell, lining the drips up a cell apart.)
    float sc = dd * (1.0 + 0.04 * hashI(pu, uSeed + 4049.0));
    if (sc > bestS) { bestS = sc; best = dd; pos = vec2(pu) + 0.5; }
  }
  oColor = vec4(pos, max(best, 0.0), 1.0);
}
`;

/**
 * A grid's ledge cells, run in a layer's prepare: texel (x, y) holds cell (x, y)'s strongest ledge pixel (user px, y
 * down) and its drop. `cells` across and down must match what the layer's shader works out; the target is a texel
 * larger each way, as the shader's float division may round the other way.
 */
export function ledgeCells(ctx: FilterContext, name: string, cells: [number, number]): Texture {
	const mat = ctx.material(`${ctx.layer.type}:ledge-cells`, LEDGE_CELLS_GLSL, { uLedgeCells: { value: [1, 1] } });
	mat.uniforms.uLedgeCells.value = cells;
	const target = ctx.scratch(name, cells[0] + 1, cells[1] + 1);
	ctx.run(mat, target);
	return target.texture;
}

/**
 * The ledge test's params, for a layer's ParamDefs (Drips and Blisters put them in their Ledges group, Ice in its
 * Icicles section). `short`: labels without the "Ledge" prefix, for a group that already says it.
 */
export function ledgeParams(
	extra: Partial<ParamDef> = {},
	showIf?: (p: ParamValues) => boolean,
	short = false
): ParamDef[] {
	const label = (s: string) => (short ? s[0].toUpperCase() + s.slice(1) : `Ledge ${s}`);
	return [
		P.float('ledge', label('threshold'), 0.15, 0, 8, {
			softMax: 1,
			step: 0.001,
			...extra,
			showIf,
			hint: 'Sets the height drop (in height units, over the reach below) that counts as a ledge. Raise it until shallow bumps stop sprouting'
		}),
		P.float('ledge_reach', label('reach'), 2, 1, 64, {
			softMax: 16,
			unit: 'px',
			axis: 'y',
			step: 0.5,
			...extra,
			showIf,
			hint: 'Sets how far below a point the drop is measured (short = only hard, sharp steps count; long = soft, gradual edges count too)'
		}),
		P.float('ledge_soft', label('softness'), 0.15, 0, 1, {
			step: 0.001,
			...extra,
			showIf,
			hint: 'Softens the threshold (0 = a hard cut-off; 1 = gradual, so weaker ledges sprout less often)'
		})
	];
}
