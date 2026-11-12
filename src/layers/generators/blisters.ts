// Blisters (FR7.7): peeling paint giving way to the rust beneath — ragged holes in the paint that grow with the Blister
// radius from specks to patches that merge into whole areas, at sources scattered over a grid and along the ledges of
// the relief beneath (placed as Drips places its drips, layers/dripSources.ts: with the same seed and placement settings
// a Drips layer's stains run down from these blisters), and as bands along every ledge (Ledge bands). Their outline
// goes to the mask it writes (limit the rust beneath to inside it, the paint to outside); their height is the peel —
// the paint lifts towards the torn edge, steepening as it curls, then falls into the hole, below the surface; the value
// is the floor's roughness, for a ramp to shade the rust by. Wraps on tileable projects.
//
// Passes run before the layer (prepare): the source pass (dripSources.ts) and, with Ledge bands, the distance to every
// ledge pixel, flooded from the heights beneath.

import type { Texture } from 'three';
import { P, round1 as r1, type ParamValues } from '@/core/params';
import { DISTANCE_SOURCE, jumpFlood } from '@/gpu/jfa';
import { f32 } from '../derivedMath';
import type { LayerDef } from '../types';
import { LEDGE_GLSL } from '../ledges';
import {
	SOURCE_READ_GLSL,
	placementFresh,
	placementParams,
	sourceCells,
	sourceGridGlsl,
	type SourceSpacing
} from '../dripSources';

/** Set B's spacing: Ledge spacing, but blisters at least half a radius apart. */
const GAP: SourceSpacing = {
	glsl: 'max(u_ledge_gap, 0.5 * u_blister)',
	px: (p) => Math.max(Number(p.ledge_gap), 0.5 * Number(p.blister))
};

/**
 * The blisters' raggedness, the same at every pixel (derived uniforms, and blisterReach): the lobes' octaves nL from
 * lam0 (half a grid cell) down to ~4 px (at least one), each as deep as the radius allows (lobeAmp in all), the tear's
 * depth, and sat — past sat px the peel draws nothing (its lift, hole and ramp are spent, whatever the lobes, tear and
 * the smooth union add).
 */
function blisterShape(p: ParamValues, w: number, h: number) {
	const r = Number(p.blister);
	const ragged = Number(p.ragged);
	const lam0 = f32(0.5 * Math.min(f32(w / Number(p.cols)), f32(h / Number(p.rows))));
	const nL = Math.min(6, Math.max(1, Math.floor(Math.log2(Math.max(lam0, 1) / 4)) + 1));
	const ks = Math.max(0.35 * r, 0.25);
	const lobeAmp = ragged * Math.min(r * nL, 1.6 * lam0);
	const tearAmp = 2.4 * ragged * Math.min(1, r / 2.5);
	const sat = lobeAmp + tearAmp + Math.max(1.6 * Number(p.lift_width), 1.5) + 1 + 1.5 * ks;
	return { lam0, nL, lobeAmp, tearAmp, sat };
}

/**
 * How far from a ledge its blisters reach (px): the ledge flood's range — the band's growth along the ledge (up to
 * 2.2 × radius × Ledge bands with Raggedness, as bl_peel grows it) and sat, plus a px for float rounding.
 */
function blisterReach(p: ParamValues, w: number, h: number) {
	const r = Number(p.blister);
	const ragged = Number(p.ragged);
	return blisterShape(p, w, h).sat + r * Number(p.ledge_mix) * (1 + 1.2 * Math.min(1, 2 * ragged)) + 1;
}

/** The ledge flood's source (gpu/jfa.ts, custom): inside where the drop counts as a ledge. */
const LEDGE_FLOOD =
	LEDGE_GLSL +
	/* glsl */ `
float jfaCustom(ivec2 c) { return ledgeOk(ledgeDrop(c)) - 0.5; }
`;

const placement = placementParams('blister', {
	ledgeLabel: 'Ledge blisters',
	gapHint: ' (at least half the blister radius)'
});

export const blistersLayer: LayerDef = {
	type: 'blisters',
	label: 'Blisters',
	category: 'pattern',
	kind: 'generator',
	description:
		'Blisters: Made from ragged holes torn in paint, scattered and along ledges, with the paint lifting at the torn edge and a pit below the surface (a mask for the rust beneath). Makes peeling paint, rust spots, flaking coatings.',
	params: [
		...placement.grid,
		P.float('blister', 'Blister radius', 2, 0, 512, {
			softMax: 48,
			unit: 'px',
			step: 0.05,
			hint: 'Grows the blisters from specks (and the ledge bands from thin lines) to patches that merge into whole areas'
		}),
		P.float('blister_var', 'Size variation', 0.5, 0, 1, {
			step: 0.001,
			hint: 'Gives each blister a random share of the radius (1 = anywhere from none to full)'
		}),
		P.float('ragged', 'Raggedness', 0.8, 0, 1, {
			step: 0.001,
			hint: "Tears the blister edge, with lobes from the blister's own size down to bays a few px across, a fine tear along it and paint lifting unevenly"
		}),
		P.float('lift', 'Edge lift', 0.8, 0, 8, {
			softMax: 3,
			step: 0.01,
			hint: 'Curls the paint up at the torn edge by this much (× the Height amount)'
		}),
		P.float('lift_width', 'Edge lift width', 2, 0, 128, {
			softMax: 24,
			unit: 'px',
			step: 0.05,
			hint: 'Sets how far out from the edge the paint lifts; it rises steeply only near the edge'
		}),
		P.float('depth', 'Hole depth', 1, 0, 8, {
			softMax: 3,
			step: 0.01,
			hint: 'Sinks the hole below the surface by this much (× the Height amount), showing the rough rust beneath'
		}),
		...placement.ledges,
		P.float('ledge_mix', 'Ledge bands', 0.5, 0, 1, {
			step: 0.001,
			group: 'relief',
			hint: 'Grows blisters along every ledge too, as bands that open up along it (the lower edges of raised features, found by the Threshold, Reach and Softness above), growing with the radius (0 = only at the sources, 1 = as fast as the blisters at the sources)'
		}),
		P.seed()
	],
	groups: [{ id: 'relief', label: 'Ledges' }],
	// The outline goes to its mask; Blisters shapes the peel itself.
	sdf: 'mask',
	textures: ['ledges', 'cells'],
	prepare(ctx, layer): Record<string, Texture> {
		const p = layer.params;
		const out: Record<string, Texture> = { cells: sourceCells(ctx, p, GAP) };
		// Blisters along the ledges: the distance to every ledge pixel, flooded from the heights beneath.
		if (Number(p.blister) > 0 && Number(p.ledge_mix) > 0) {
			out.ledges = jumpFlood(ctx, {
				source: DISTANCE_SOURCE.custom,
				custom: LEDGE_FLOOD,
				threshold: 0,
				maxDistance: blisterReach(p, ctx.width, ctx.height),
				name: 'blisters-ledges'
			}).texture;
		}
		return out;
	},
	// Added in the editor: placed as a new Drips layer is (so the two line up), the blisters and lift sized to the
	// texture; below 128 px crisp.
	fresh: ({ width }): ParamValues => {
		const k = Math.max(0.5, width / 128);
		if (width < 128) return placementFresh(width);
		return {
			...placementFresh(width),
			aa: true,
			blister: r1(1.5 * k),
			lift_width: r1(1.2 * k)
		};
	},
	defaults: {
		// Pixel-crisp by default (Edge › Anti-alias).
		aa: false,
		// Relief first: the peel is the height.
		h_on: true,
		dif_on: true,
		dif_grad: {
			stops: [
				{ pos: 0, color: '#4a2412' },
				{ pos: 1, color: '#8a4a22' }
			]
		},
		// Rust is not metal: where it lies on a metal, it stops reflecting like one.
		mt_on: true,
		mt_src: 'flat',
		mt_b: 0
	},
	derivedUniforms: {
		decl: { shape: 'vec4', octaves: 'int' },
		compute: (p, c) => {
			const s = blisterShape(p, c.width, c.height);
			return { shape: [s.lam0, s.lobeAmp, s.tearAmp, s.sat], octaves: s.nL };
		}
	},
	glsl: /* glsl */ `
${sourceGridGlsl(GAP)}
${SOURCE_READ_GLSL}
// Blisters' ragged-edge noises, all through one valueNoise call (D3D inlines every call site): first the lobes, an
// fBm from half a source cell down to ~4 px (fixed in place, so they stay put as the radius grows, and tile), each
// octave as deep as the blister allows (u_ragged × min(R, 0.8 × its wavelength)) — big blisters get bays and
// peninsulas, specks only wobble; then 0–2 the tear's octaves from ~2.5 px down to single pixels (weights BL_TEARW,
// so the tear spans −1..1) and 3 the lift's unevenness along the edge (flaps).
const float BL_NSCALE[3] = float[3](1.0, 2.0, 4.0);
const float BL_TEARW[3] = float[3](1.0, 0.6, 0.4);
const float BL_NSEED[4] = float[4](307.0, 311.0, 317.0, 313.0);

// The blisters, finished: d is the spots' smooth union (gen's cell loop). Adds the ledges (t_ledges: the distance to
// them, flooded before the layer runs; the band grows unevenly along them) and the raggedness — lobes (nL octaves from
// lam0 px down), a tear that small specks keep little of — then the peel: the paint lifts towards the torn edge,
// steepening as it curls, in flaps of their own heights and widths, and falls into the hole, Depth below the surface,
// onto a floor eaten deeper towards the middle, broadly uneven and rough.
GenOut bl_peel(vec2 p, vec2 q, float d, float rnd, float lam0, int nL, float tearAmp, float ks, float sat) {
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
    vec2 per = lobe ? snapCells(uRes / lam) : k == 3 ? tu : tc * BL_NSCALE[min(k, 2)];
    float n = valueNoise(q / uRes * per, periodOf(per), uSeed + (lobe ? 301.0 + 100.0 * float(i) : BL_NSEED[k]));
    if (i == 0) n0 = n;
    if (i == min(1, nL - 1)) n1 = n;
    if (lobe) lobes += u_ragged * min(R, 0.8 * lam) * (n * 2.0 - 1.0);
    else if (k == 3) nU = n;
    else tear += BL_TEARW[min(k, 2)] * (n - 0.5);
  }
  if (R > 0.0) {
    // Ledge bands: the band of ledge pixels (about the reach tall) opens from its middle as the radius grows — by none
    // to 2.2 × of it along the ledge (with raggedness), so stretches of sound paint break the chain.
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

GenOut gen(vec2 p) {
  vec2 q = vec2(p.x, uRes.y - p.y);  // user space, y down
  // Two sets of source cells: A the grid, B the ledges (whose spots sit up to dr_shiftB px below their cells). Every
  // source whose blister (ragged, with its lifted lip) can reach this pixel: for each set, columns either side (cr) and
  // rows from rs (nr of them). A big radius on a fine grid is cut short at 5 cells each way (8 without the ledge
  // sources): by then the blisters have merged into areas.
  vec2 cellsA = vec2(float(u_cols), float(u_rows));
  vec2 csA = uRes / cellsA;
  vec2 cellsB = dr_cellsB();
  vec2 csB = uRes / cellsB;
  float R = u_blister, ks = max(0.35 * R, 0.25);
  // The lobes (nL octaves from lam0 px down) and the tear, as deep as the radius allows; sat (blisterShape).
  float lam0 = d_shape.x, lobeAmp = d_shape.y, tearAmp = d_shape.z, sat = d_shape.w;
  int nL = d_octaves;
  float reach = R + lobeAmp + tearAmp + 1.6 * u_lift_width + 1.0;
  int most = u_ledge_density > 0.0 ? 5 : 8;
  int crA = clamp(int(ceil(reach / csA.x)), 1, most);
  int ryA = clamp(int(ceil(reach / csA.y)), 1, most);
  int crB = clamp(int(ceil(reach / csB.x)), 1, 6);
  int ryB = clamp(int(ceil(reach / csB.y)), 1, 6);
  // (Set B's spots may sit lower than their cells, down at the ledge's foot: its rows reach that much further up.)
  int upB = int(ceil(dr_shiftB() / csB.y));
  int nrA = R > 0.0 ? 2 * ryA + 1 : 0;
  int nrB = R > 0.0 ? 2 * ryB + 1 + upB : 0;
  int rsA = -ryA, rsB = -ryB - upB;
  // Past sat px the peel draws nothing, so its distance — the mask's — can saturate there instead of jumping where the
  // search or the ledge flood ends (the flood reaches past it, blisterReach). The spots' is exact out to the search
  // window (less a radius; set B's spots sit up to 2 px below their cells).
  float win = min(u_density > 0.0 ? min(float(crA) * csA.x, float(ryA) * csA.y) : 1e4,
                  u_ledge_density > 0.0 ? min(float(crB) * csB.x, float(ryB) * csB.y - 2.0) : 1e4);
  float bdCap = max(win - R - ks, sat);
  int ncA = 2 * crA + 1, ncB = 2 * crB + 1;
  int totA = u_density > 0.0 ? ncA * nrA : 0;
  int totB = u_ledge_density > 0.0 ? ncB * nrB : 0;
  float bestRnd = 0.0, bd = 1e4, nearest = 1e4;
  // One flat loop over the cells of both sets, with a uniform-derived count and the arguments picked per iteration:
  // nested or constant loops make D3D's compiler unroll, and each call site is inlined. (No continue: ANGLE can
  // miscompile it.)
  for (int n = 0; n < totA + totB; n++) {
    bool isB;
    ivec2 cw;
    vec2 src;
    float cseed, rnd, drop, lcov;
    if (dr_visit(n, totA, q, ivec2(ncA, ncB), ivec2(crA, crB), ivec2(rsA, rsB), 1, cellsA, cellsB, isB, cseed, cw, src, rnd, drop, lcov)) {
      // (Blisters that Size variation leaves under 2 px — or half the radius — are dropped: they read as specks.)
      float rr = R * (1.0 - u_blister_var * hashI(cw, cseed + 19.0));
      if (rr >= min(2.0, 0.5 * R)) {
        float ds = length(q - src) - rr;
        if (ds < nearest) { nearest = ds; bestRnd = rnd; }
        bd = sdfCombine(5, bd, ds, ks);
      }
    }
  }
  return bl_peel(p, q, R > 0.0 ? min(bd, bdCap) : bd, bestRnd, lam0, nL, tearAmp, ks, sat);
}
`
};
