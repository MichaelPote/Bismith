import { pcg3, u2d } from '@/core/hash';
import { memoize } from '@/core/memo';
import { P, type ParamDef, type ParamValues } from '@/core/params';
import type { CpuTexture, LayerDef } from '../types';

export const NOISE_TYPES: ([string, string] | [string, string, string])[] = [
	['value', 'Value'],
	['perlin', 'Perlin'],
	['simplex', 'Simplex (Perlin when tiling)', 'simplex noise can’t tile, so tileable projects use Perlin instead'],
	['worley', 'Worley F1'],
	['worley2', 'Worley F2'],
	['cells', 'Worley edges (F2−F1)'],
	['white', 'White / pixel']
];

export const FRACTAL_MODES: [string, string][] = [
	['none', 'Single octave'],
	['fbm', 'Clouds'],
	['ridged', 'Ridged'],
	['billow', 'Billow'],
	['turbulence', 'Turbulence']
];

/** Worley cell profiles: the curve over the cell value (the option index + 1 is profileCurve's). */
export const CELL_PROFILES: [string, string, string][] = [
	['linear', 'Linear', 'uses the raw distance: cones round the points (F1), pyramids on the cells (edges)'],
	[
		'smooth',
		'Smooth',
		'soft round-bottomed dimples packed edge to edge with soft rims (a parabolic dish with F1 and Even cells), cushions on the cells'
	],
	['round', 'Round', 'wide dished dimples with sharp ridges between (hammered metal), pillows on the cells'],
	['cove', 'Cove', 'narrow pits in broad flats (F1), peaked cells']
];

// ---- Even levels / Even coverage (Noise, Clouds): the measured distribution of a fractal sum

/** The settings of the octave loop the quantiles are measured for (the shaders' loops, ported). */
export interface FractalStats {
	/** 0 value, 1 Perlin (simplex: Perlin's statistics). */
	basis: number;
	/** 0 single octave, 1 fBm, 2 ridged, 3 billow, 4 turbulence (FRACTAL_MODES order). */
	mode: number;
	octaves: number;
	gain: number;
	lacunarity: number;
	crease: number;
	/** Ridged: 1 + Ridge offset (1 = classic). */
	ridgeOffset: number;
	hier: number;
}

/** The shaders' hashI, unrounded: the quantiles need only its distribution. */
const fsHash = (x: number, y: number, s: number) => u2d(pcg3(x, y, s));

function fsNoise(basis: number, x: number, y: number, s: number): number {
	const ix = Math.floor(x),
		iy = Math.floor(y),
		fx = x - ix,
		fy = y - iy;
	const fade = (f: number) => f * f * f * (f * (f * 6 - 15) + 10);
	const ux = fade(fx),
		uy = fade(fy);
	const c = (cx: number, cy: number, dx: number, dy: number) => {
		if (basis === 0) return fsHash(cx, cy, s);
		const a = fsHash(cx, cy, s) * Math.PI * 2;
		return Math.cos(a) * dx + Math.sin(a) * dy;
	};
	const a = c(ix, iy, fx, fy),
		b = c(ix + 1, iy, fx - 1, fy),
		cc = c(ix, iy + 1, fx, fy - 1),
		d = c(ix + 1, iy + 1, fx - 1, fy - 1);
	const v = (a + (b - a) * ux) * (1 - uy) + (cc + (d - cc) * ux) * uy;
	return basis === 0 ? v : Math.min(1, Math.max(0, v * 1.2 + 0.5));
}

const STATS_N = 8192;

/** measureQuantiles' recent results, by their settings: cpuData runs on every param change (Levels, colours, …). */
const measured = memoize(measureQuantiles, 16);

/** The 17 quantiles (1 % … 99 %) of the fractal sum's value for these settings (the shaders' octave loop on the CPU). */
export function fractalQuantiles(o: FractalStats): number[] {
	return measured(o).slice();
}

function measureQuantiles(o: FractalStats): number[] {
	const oct = o.mode === 0 ? 1 : Math.max(1, Math.min(12, Math.round(o.octaves)));
	let rs = 12345;
	const rnd = () => (rs = (Math.imul(rs, 1103515245) + 12345) >>> 0) / 4294967296;
	const vals = new Float64Array(STATS_N);
	for (let i = 0; i < STATS_N; i++) {
		let x = rnd() * 256,
			y = rnd() * 256;
		let sum = 0,
			amp = 1,
			norm = 0,
			weight = 1,
			f0 = 1;
		for (let k = 0; k < oct; k++) {
			let n = fsNoise(o.basis, x, y, 1 + (i % 7) * 977 + k * 31);
			const ce = 0.25 * o.crease * (1 + k) + (o.mode === 2 ? 0.15 * o.hier * Math.max(k - 1, 0) : 0);
			const ha = o.mode !== 2 || k === 0 ? 1 : k === 1 ? 1 + 0.6 * o.hier : Math.pow(1 - 0.35 * o.hier, k - 1);
			const t = 2 * n - 1;
			const fold = ce > 0 ? (Math.sqrt(t * t + ce * ce) - ce) / (Math.sqrt(1 + ce * ce) - ce) : Math.abs(t);
			let wn = 1;
			if (o.mode === 2) {
				const c = (o.ridgeOffset - fold) / o.ridgeOffset;
				const hp = k === 0 ? 3 * o.hier : 0,
					hg = k === 0 ? -o.hier : 2 * o.hier;
				let r = c * c * (hp > 0 ? Math.pow(Math.max(c, 1e-6), hp) : 1);
				const gt = c * c * (hg !== 0 ? Math.pow(Math.max(c, 1e-6), hg) : 1);
				wn = 1 + (weight - 1) * o.hier;
				r *= weight;
				weight = Math.max(Math.min(1, Math.max(0, 2 * gt * weight)), Math.min(o.ridgeOffset - 1, 1));
				n = r;
			} else if (o.mode === 3) {
				n = fold;
			} else if (o.mode === 4) {
				x += (n - 0.5) * 0.6;
				y += (n - 0.5) * 0.6;
			}
			let bg = 1;
			if (o.mode === 3 && o.crease > 0) {
				if (k === 0) f0 = fold;
				else {
					const e = Math.min(1, Math.max(0, f0 / 0.6));
					bg = 1 + (e * e * (3 - 2 * e) - 1) * o.crease;
				}
			}
			sum += n * amp * ha * bg;
			norm += amp * ha * wn;
			amp *= o.gain;
			x *= o.lacunarity;
			y *= o.lacunarity;
		}
		vals[i] = o.mode === 0 ? sum : sum / Math.max(norm, 1e-6);
	}
	return quantilesOf(vals);
}

/** The 17 quantiles (1 % … 99 %) of a set of values (sorted in place). */
export function quantilesOf(vals: number[] | Float64Array): number[] {
	if (Array.isArray(vals)) vals.sort((a, b) => a - b);
	else vals.sort();
	return Array.from({ length: 17 }, (_, k) => vals[Math.round((0.01 + (0.98 * k) / 16) * (vals.length - 1))]);
}

/**
 * Quantiles as a 17 × 1 data texture (16 bits each in r, g): measured for the stats, given, or zeros when not wanted.
 * The same stats give the same arrays, so the pipeline keeps the uploaded texture while other params change.
 */
export const quantileTexture: (stats: FractalStats | number[] | null) => Record<string, CpuTexture> = memoize(
	buildQuantileTexture,
	16
);

function buildQuantileTexture(stats: FractalStats | number[] | null): Record<string, CpuTexture> {
	const data = new Uint8Array(17 * 4);
	if (stats) {
		(Array.isArray(stats) ? stats : fractalQuantiles(stats)).forEach((q, k) => {
			const v = Math.round(Math.min(1, Math.max(0, q)) * 65535);
			data.set([v >> 8, v & 255, 0, 255], k * 4);
		});
	}
	return { calib: { width: 17, height: 1, data } };
}

/** Lacunarity as the shader uses it: whole numbers when tiling. */
export const effLacunarity = (p: ParamValues, tileable: boolean) => {
	const l = Number(p.lacunarity ?? 2);
	return tileable ? Math.max(1, Math.round(l)) : l;
};

/**
 * GLSL shared with Clouds. rl_noise: value (basis 0) or Perlin (1) noise on a turned lattice that still tiles — the
 * lattice of y = W u (u the 0..1 texture position, W an integer matrix with columns c1, c2: a turn by atan(1/2) and a
 * scale), its corners hashed modulo the lattice W Z², so the unit square holds det W different cells and the noise
 * repeats with the texture. Same values and animation as valueNoise / perlinNoise, just no axis-aligned lattice.
 */
export const NZ_SHARED_GLSL = /* glsl */ `
// Even: a fractal value n evened out by its measured quantiles (t_calib: 17, 1 % … 99 %, cpuData) — its median to
// mid-grey and its 7 % / 93 % quantiles to where 6-octave fBm has them (± 0.21), through the one quadratic (monotone,
// C1; straight beyond those quantiles) that passes the three. A smooth, near-affine remap: the darks and lights
// balance, a level or coverage means the same share of the area for every style, and the shape within (Ridged's
// dark flanks, Billow's creases) isn't stretched the way a full histogram match would.
float eq_q(int k) { vec4 t = texelFetch(t_calib, ivec2(k, 0), 0); return (t.r * 65280.0 + t.g * 255.0) / 65535.0; }
// The p-quantile of the raw value (p 0.01 … 0.99, interpolated between the measured ones).
float eq_quant(float p) {
  float kf = clamp((p - 0.01) / 0.98 * 16.0, 0.0, 16.0);
  int k = int(min(floor(kf), 15.0));
  return mix(eq_q(k), eq_q(k + 1), kf - float(k));
}
float eq_value(float n) {
  const float Y = 0.2095;   // 0.0816 · logit(0.929): a logistic of fBm's sd at the 7.1 % / 92.9 % knots
  float m = eq_q(8);
  float dl = min(eq_q(1) - m, -1e-4), dh = max(eq_q(15) - m, 1e-4);
  // A three-point quadratic is monotone while one side is at most 3× the other.
  dh = clamp(dh, -dl / 2.8, -dl * 2.8);
  dl = clamp(dl, -dh * 2.8, -dh / 2.8);
  float qb = Y * (dl + dh) / (dl * dh * (dh - dl));
  float qa = (Y - qb * dh * dh) / dh;
  float x = n - m;
  if (x < dl) return 0.5 - Y + (qa + 2.0 * qb * dl) * (x - dl);
  if (x > dh) return 0.5 + Y + (qa + 2.0 * qb * dh) * (x - dh);
  return 0.5 + qa * x + qb * x * x;
}
ivec2 rl_reduce(ivec2 k, ivec2 c1, ivec2 c2) {
  float D = float(c1.x * c2.y - c2.x * c1.y);
  float a = floor(float(c2.y * k.x - c2.x * k.y) / D);
  float b = floor(float(c1.x * k.y - c1.y * k.x) / D);
  return k - int(a) * c1 - int(b) * c2;
}
float rl_noise(int basis, vec2 y, ivec2 c1, ivec2 c2, float seed) {
  ivec2 i = ivec2(floor(y));
  vec2 f = fract(y);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec4 cv;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 r = rl_reduce(i + o, c1, c2);
    cv[k] = basis == 0 ? animValue(hashI(r, seed), r, seed) : dot(gradDir(r, seed), f - vec2(o));
  }
  float v = mix(mix(cv.x, cv.y, u.x), mix(cv.z, cv.w, u.x), u.y);
  return basis == 0 ? v : clamp(v * 1.2 + 0.5, 0.0, 1.0);
}
// The turned lattice of octave o for a square grid of about 'cells' cells: n·(2, 1) and n·(-1, 2), turning the other
// way on odd octaves, n·ilac^o with n·√5 ≈ cells.
void rl_lattice(int o, float cells, int ilac, out ivec2 c1, out ivec2 c2) {
  int n = max(1, int(floor(cells / 2.2360680 + 0.5)));
  for (int j = 0; j < o; j++) n *= ilac;
  c1 = (o % 2 == 0) ? ivec2(2 * n, n) : ivec2(n, 2 * n);
  c2 = (o % 2 == 0) ? ivec2(-n, 2 * n) : ivec2(-2 * n, n);
}
`;

/** Every control but Pixel size: White hides them. */
const notWhite = (p: Record<string, unknown>) => p.noise !== 'white';
const isFractal = (p: Record<string, unknown>) => p.noise !== 'white' && p.fractal !== 'none';
const isWorley = (p: Record<string, unknown>) => p.noise === 'worley' || p.noise === 'worley2' || p.noise === 'cells';

/** The noise's controls, but for White's Pixel size. */
const NOISE_CONTROLS: ParamDef[] = [
	P.enum('noise', 'Type', 'perlin', NOISE_TYPES),
	P.enum('fractal', 'Fractal', 'fbm', FRACTAL_MODES, { showIf: notWhite }),
	P.float('scale', 'Cells across', 6, 0.25, 1024, {
		softMax: 128,
		step: 0.01,
		showIf: notWhite,
		hint: 'Sets how many cells fit across the texture width (rounded when tiling)'
	}),
	P.float('stretch', 'Stretch', 1, 0.02, 100, {
		softMin: 0.1,
		softMax: 16,
		step: 0.01,
		showIf: notWhite,
		hint: 'Stretches the features horizontally above 1 (brushed metal, wood fibre: 8–30) and vertically below 1'
	}),
	P.float('jitter', 'Jitter', 1, 0, 1, {
		step: 0.001,
		showIf: isWorley,
		hint: 'Moves each cell’s point randomly away from a regular grid (0 = a square lattice of identical cells, 1 = fully random)'
	}),
	P.enum(
		'metric',
		'Distance',
		'euclidean',
		[
			['euclidean', 'Euclidean', 'makes round cells and dimples'],
			[
				'manhattan',
				'Manhattan',
				'makes a rounded-diamond falloff and angular cell walls (a 1.3-norm, so no flat patches where two points tie)'
			],
			[
				'chebyshev',
				'Chebyshev',
				'makes a rounded-square falloff and boxy cell walls (a 4-norm, so no flat patches where two points tie)'
			]
		],
		{ showIf: isWorley }
	),
	P.bool('w_even', 'Even cells', true, {
		showIf: (p) => p.noise === 'worley' || p.noise === 'cells',
		hint: 'Measures each cell from its true borders, so big and small cells look alike. Worley edges rise over the Wall width from every wall, and each Worley F1 dimple runs from its point to its border, so it reaches full depth (off = the raw distance: big cells clip to flat white, small ones stay dark)'
	}),
	P.float('w_wall', 'Wall width', 0.15, 0.01, 2, {
		softMax: 0.6,
		step: 0.001,
		showIf: (p) => p.noise === 'cells' && p.w_even === true,
		hint: 'Sets how far in from each wall the cells rise, in cells (Even cells). Big and small cells get the same width, with level middles'
	}),
	P.enum('w_profile', 'Cell profile', 'smooth', CELL_PROFILES, {
		showIf: isWorley,
		hint: 'Shapes the curve across each cell from its point to its border (F1 the other way up). Round and Smooth turn the cone at every point into a dimple'
	}),
	P.int('octaves', 'Octaves', 5, 1, 12, { showIf: isFractal }),
	P.float('lacunarity', 'Lacunarity', 2, 1, 8, {
		softMin: 1.5,
		softMax: 6,
		step: 0.01,
		showIf: isFractal,
		hint: 'Sets how much finer each octave is than the one before (rounded to a whole number when tiling: 2, 3, 4 …)'
	}),
	P.float('gain', 'Gain', 0.5, 0, 1, {
		step: 0.001,
		showIf: isFractal,
		hint: 'Sets how much strength each octave keeps from the one before (low = smooth, high = rough and grainy)'
	}),
	P.float('ridge', 'Ridge offset', 0.4, 0, 2, {
		softMax: 1,
		step: 0.001,
		showIf: (p) => notWhite(p) && p.fractal === 'ridged',
		hint: 'Lifts the valleys between the ridges and lets at least this share of the finer octaves into them (0 = classic ridged multifractal, with flat black basins and detail only on the crests; 0.5 = shallower basins with half the fine detail; 1 = detail everywhere)'
	}),
	P.float('crease', 'Crease softness', 0.5, 0, 1, {
		step: 0.001,
		showIf: (p) => notWhite(p) && (p.fractal === 'ridged' || p.fractal === 'billow'),
		hint: 'Rounds off the knife-sharp crests of Ridged and creases of Billow, more so on the finer octaves, whose thin crests look like wiry hair (0 = sharp)'
	}),
	P.float('hier', 'Ridge hierarchy', 0.7, 0, 1, {
		step: 0.001,
		showIf: (p) => notWhite(p) && p.fractal === 'ridged',
		hint: 'Branches smaller ridges off the main ridgelines by keeping the finer octaves near (and a bit wider than) the crests of the coarser ones, leaving the flanks smooth (0 = every scale at once, a tangle of crests like the classic ridged multifractal)'
	}),
	P.float('warp', 'Warp', 0, 0, 16, {
		softMax: 3,
		step: 0.001,
		showIf: notWhite,
		hint: 'Swirls the noise around with a domain warp this strong, in cells. Good for swirls and marbling'
	}),
	P.float('warp_scale', 'Warp scale', 4, 0.25, 128, {
		softMax: 32,
		step: 0.01,
		showIf: (p) => notWhite(p) && Number(p.warp) > 0,
		hint: 'Sets how many warp swirls fit across the texture (rounded when tiling)'
	}),
	P.bool('even', 'Even levels', true, {
		section: 'Levels',
		showIf: (p) => notWhite(p) && !isWorley(p),
		hint: 'Measures the spread of values for these settings and evens it out, so mid-grey is the median and the darks and lights balance in every fractal mode. Billow and Ridged don’t come out dark, and Contrast and Brightness work the same on all of them (off = the raw values)'
	}),
	P.float('contrast', 'Contrast', 1, 0, 64, {
		softMax: 8,
		step: 0.01,
		section: 'Levels',
		showIf: notWhite,
		hint: 'Spreads the values out from mid-grey, clipping at black and white (1 = the noise as it comes)'
	}),
	P.float('bias', 'Brightness', 0, -1, 1, {
		step: 0.001,
		section: 'Levels',
		showIf: notWhite,
		hint: 'Shifts the values up or down after Contrast. Together with Contrast, it sets how much of the area clips to white'
	}),
	P.float('soft', 'Clip softness', 0, 0, 1, {
		step: 0.001,
		section: 'Levels',
		showIf: (p) => notWhite(p) && (Number(p.contrast) !== 1 || Number(p.bias) !== 0),
		hint: 'Rounds off where the values clip to black and white, leaving the mid-tones alone (0 = a hard cut with a crease round every flat plateau, 1 = soft shoulders that meet at mid-grey)'
	})
];

/** p's noise controls, stored under a prefix, by their plain keys. */
const unprefixed = (p: ParamValues, prefix: string): ParamValues =>
	Object.fromEntries(NOISE_CONTROLS.map((d) => [d.key, p[prefix + d.key]]));

/**
 * The noise's controls for another generator, under a key prefix and a section heading (noiseFieldGlsl is their shader).
 * `show` hides them all; `defaults` are by the plain keys. No White: single pixels are that generator's grain to add.
 */
export function noiseControlsAs(
	prefix: string,
	section: string,
	show: (p: ParamValues) => boolean,
	defaults: ParamValues = {}
): ParamDef[] {
	return NOISE_CONTROLS.map((d) => ({
		...d,
		key: prefix + d.key,
		section,
		default: defaults[d.key] ?? d.default,
		...(d.key === 'noise' ? { options: d.options!.filter((o) => o.value !== 'white') } : {}),
		showIf: (p) => show(p) && (!d.showIf || d.showIf(unprefixed(p, prefix)))
	}));
}

/** The measured levels Even levels needs (t_calib), for controls stored under `prefix`. */
export function noiseCalib(params: ParamValues, tileable: boolean, prefix = ''): Record<string, CpuTexture> {
	const p = prefix ? unprefixed(params, prefix) : params;
	// Value, Perlin and simplex: Worley isn't levelled.
	if (p.even !== true || !notWhite(p) || isWorley(p)) return quantileTexture(null);
	const mode = Math.max(
		0,
		FRACTAL_MODES.findIndex(([v]) => v === p.fractal)
	);
	return quantileTexture({
		basis: p.noise === 'value' ? 0 : 1,
		mode,
		octaves: Number(p.octaves),
		gain: Number(p.gain),
		lacunarity: effLacunarity(p, tileable),
		crease: Number(p.crease ?? 0),
		ridgeOffset: 1 + Number(p.ridge ?? 0),
		hier: Number(p.hier ?? 0)
	});
}

/** The noise's shader: nz_worley and the rest of what nz_field needs, then nz_field. */
const NZ_FIELD_GLSL = /* glsl */ `
// worleyNoise() — the same F1, F2 and cell random — in one flat loop with a runtime bound: 9 cells for the nearest
// points, then the 25 round the nearest one for its border. w = the distance to the nearest cell's border (cell units):
// a soft minimum ((Σ d⁻³)^(-1/3), which rounds the creases from the point to the corners yet stays exactly 0 on the
// border and positive inside — no flat bands along the borders) over the exact bisector distances (Euclidean) or, for
// the other metrics, over g / |∇g| with g = d(x, b) - d(x, a) (exact at the border). Manhattan and Chebyshev are the 1.3- and 4-norms: strictly convex, so their cells have real borders — the
// 1- and ∞-norms share whole regions between two points (F1 = F2: flat ties, broken walls).
// |r| softened over 0.05 cells (sqrt(r² + ε²)), so the norm's gradient turns smoothly across the axes through each
// point — g / |∇g| then has no kinks (straight lines across the cells).
float nz_norm(vec2 r, float pw) { vec2 a = sqrt(r * r + 0.0025); return pow(pow(a.x, pw) + pow(a.y, pw), 1.0 / pw); }
// The norm (x) and its gradient (yz).
vec3 nz_normGrad(vec2 r, float pw) {
  vec2 a = sqrt(r * r + 0.0025);
  float nm = pow(pow(a.x, pw) + pow(a.y, pw), 1.0 / pw);
  return vec3(nm, (r / a) * pow(a, vec2(pw - 1.0)) / pow(nm, pw - 1.0));
}
vec4 nz_worley(vec2 x, ivec2 period, float jitter, int metric, float seed) {
  ivec2 ip = ivec2(floor(x));
  vec2 fp = fract(x);
  float pw = metric == 1 ? 1.3 : 4.0;
  float F1 = 1e9, F2 = 1e9, acc = 0.0, na = 0.0;
  vec2 mr = vec2(0.0), ga = vec2(0.0);
  ivec2 mc = ip;
  for (int e = 0; e < 34 * UNI_1; e++) {
    bool near = e < 9;
    int f = near ? e : e - 9;
    ivec2 g = near ? ivec2(f % 3 - 1, f / 3 - 1) : mc - ip + ivec2(f % 5 - 2, f / 5 - 2);
    vec2 o = 0.5 + (cellPoint(imod(ip + g, period), seed) - 0.5) * jitter;
    vec2 r = vec2(g) + o - fp;
    if (near) {
      float d = metric == 0 ? dot(r, r) : nz_norm(r, pw);
      if (d < F1) { F2 = F1; F1 = d; mr = r; mc = ip + g; }
      else if (d < F2) { F2 = d; }
    } else {
      if (e == 9 && metric != 0) { vec3 ng = nz_normGrad(mr, pw); na = ng.x; ga = ng.yz; }
      vec2 dr = r - mr;
      float l2 = dot(dr, dr);
      if (l2 > 1e-6) {
        vec3 ng = metric == 0 ? vec3(0.0) : nz_normGrad(r, pw);
        float d = metric == 0 ? dot(0.5 * (mr + r), dr * inversesqrt(l2)) : (ng.x - na) / max(length(ga - ng.yz), 1e-3);
        acc += pow(max(d, 1e-4), -3.0);
      }
    }
  }
  if (metric == 0) { F1 = sqrt(F1); F2 = sqrt(F2); }
  return vec4(F1, F2, hashI(imod(mc, period), seed + 17.0), acc > 0.0 ? pow(acc, -1.0 / 3.0) : 1.0);
}

// The integral of clamp(x, 0, 1): differences of it give the clamp box-filtered over a width (soft shoulders).
float nz_clampInt(float x) { return x < 0.0 ? 0.0 : x < 1.0 ? 0.5 * x * x : x - 0.5; }

// The noise at p (px), by the layer's controls; rnd: a Worley noise's cell random (first octave).
float nz_field(vec2 p, float seed, out float rnd) {
  vec2 cells = cellsFor(u_scale, u_stretch);
  ivec2 period = periodOf(cells);
  vec2 x = p / uRes * cells;
  if (u_warp > 0.0) {
    vec2 wc = cellsFor(u_warp_scale, 1.0);
    ivec2 wper = periodOf(wc);
    x += warpOffset(p / uRes * wc, wper, seed + 7.0) * u_warp * 2.0;
  }
  // The fractal sum in one flat loop with a runtime bound, so each base noise is compiled once (a generic dispatch
  // would inline Worley in every unrolled octave), and Worley takes the layer's jitter, metric and cell profile.
  // Worley's cell random (the per-feature rnd) comes from the first octave.
  bool worley = u_noise >= 3;
  int oct = u_fractal == 0 ? 1 : u_octaves;
  float sum = 0.0, amp = 1.0, norm = 0.0, weight = 1.0, f0 = 1.0;
  rnd = 0.0;
  vec2 q = x;
  ivec2 per = period;
  int ilac = int(u_lacunarity + 0.5);
  float ro = 1.0 + u_ridge;   // ridged: the offset the crest is measured from (1 = classic)
  // Value / Perlin on the turned tileable lattice: tiling, on a square grid of cells.
  bool turned = uTile && !worley && period.x == period.y;
  for (int o = 0; o < 12 * UNI_1; o++) {
    if (o >= oct) break;
    float s = seed + float(o) * 31.0;
    // Decorrelated octaves: each octave's lattice shifted off the others (any shift keeps the period; the first octave
    // stays put on the axis-aligned lattice, while the turned one shifts every octave) and turned —
    // freely when the project doesn't tile; value and Perlin on a turned lattice that tiles (rl_noise) on a square
    // grid — so no grid lines, crests or octaves line up along the axes.
    vec2 qo = q;
    vec2 sh = vec2(hashI(ivec2(o, 3), seed), hashI(ivec2(o, 5), seed)) + 0.37 * float(o);
    if (o > 0) qo += sh;
    if (!uTile) qo = rot2(0.5 + 2.4 * float(o)) * qo;
    float n;
    if (worley) {
      // Even F1 keeps its points within the middle 70 % of their cells (at least 0.3 cells apart): no sliver cells,
      // whose walls would run through the dimples as needles.
      vec4 w = nz_worley(qo, per, u_w_even && u_noise == 3 ? 0.7 * u_jitter : u_jitter, u_metric, s);
      if (o == 0) rnd = w.z;
      n = clamp(u_noise == 3 ? w.x : u_noise == 4 ? w.y : (w.y - w.x) * 1.5, 0.0, 1.0);
      // The cell's inside: 0 at its border … 1 inside, from the true border distance with Even cells — Worley edges
      // rising over the Wall width (1 - e^(-d / wall): the same walls for big and small cells, middles level), F1
      // dimples running from each point to its own border (below). The profile shapes it; F1
      // is its inverse, so a round cell is a dished dimple in F1 and a pillow in the edges.
      bool f1 = u_noise == 3;
      float b = f1 ? 1.0 - n : n;
      if (u_w_even && u_noise == 5) b = 1.0 - exp(-w.w / max(u_w_wall, 1e-3));
      if (u_w_even && f1) {
        // F1 dimples: the distance to the point (soft-min'd with the next one, 0.12 cells, so the crest where two
        // cells meet is rounded, not a knife line) over the cell's reach in this direction (to the point plus to the
        // border): every dimple runs from its point to its own border, big or small.
        float kf = 0.12;
        float hf = max(kf - abs(w.y - w.x), 0.0) / kf;
        float fs = min(w.x, w.y) - hf * hf * kf * 0.25;
        b = 1.0 - clamp(fs / max(w.x + w.w, 0.15), 0.0, 1.0);
        // Even F1's profiles are dish shapes over u (0 at the point, 1 at the rim): Linear a cone, Smooth a parabolic
        // dish (round bottom, the rim rounded by the soft-min — dimples packed edge to edge), Round a spherical dish
        // (sharp rims: hammered), Cove narrow pits in broad flats.
        float u = 1.0 - b;
        n = u_w_profile == 1 ? u * u : u_w_profile == 2 ? 1.0 - sqrt(max(1.0 - u * u, 0.0)) : u_w_profile == 3 ? u * u * (3.0 - 2.0 * u) : u;
      } else {
        if (u_w_profile > 0) b = profileCurve(u_w_profile + 1, b);
        if (u_w_even || u_w_profile > 0) n = f1 ? 1.0 - b : b;
      }
    } else {
      if (turned) {
        ivec2 c1, c2;
        rl_lattice(o, cells.x, ilac, c1, c2);
        n = rl_noise(u_noise == 0 ? 0 : 1, mat2(vec2(c1), vec2(c2)) * (q / (cells * float(per.x / period.x))) + sh, c1, c2, s);
      } else {
        n = u_noise == 0 ? valueNoise(qo, per, s) : (u_noise == 1 || uTile) ? perlinNoise(qo, per, s) : simplexNoise(qo, s);
      }
    }
    // Ridged's crest and Billow's crease, |2n - 1|, rounded over Crease softness — more on each finer octave.
    float ce = 0.25 * u_crease * float(1 + o) + (u_fractal == 2 ? 0.15 * u_hier * float(max(o - 1, 0)) : 0.0);
    // Ridge hierarchy's octave amplitudes: the second octave louder (its ridgelets read), the finer ones quieter.
    float ha = u_fractal != 2 || o == 0 ? 1.0 : o == 1 ? 1.0 + 0.6 * u_hier : pow(1.0 - 0.35 * u_hier, float(o - 1));
    float fold = ce > 0.0 ? (sqrt((2.0 * n - 1.0) * (2.0 * n - 1.0) + ce * ce) - ce) / (sqrt(1.0 + ce * ce) - ce) : abs(2.0 * n - 1.0);
    float wn = 1.0;   // this octave's share of the normalisation
    if (u_fractal == 2) {
      // Ridge hierarchy: the main crest (first octave) sharpened to a ridgeline (c^(2 + 3h)) and gating the second
      // octave wide (c^(2 - h): its ridgelets reach down the flanks, attached to the main crest), the finer octaves
      // gated only near the crests of the one before (c^(2 + 2h)) — main ridgelines, ridgelets branching off them,
      // fine detail along those — and an octave counts in the normalisation only as far as it's weighted. At 0 the
      // classic ridged multifractal (c², weight 2r).
      float c = (ro - fold) / ro;
      float hp = o == 0 ? 3.0 * u_hier : 0.0;
      float hg = o == 0 ? -u_hier : 2.0 * u_hier;
      float r = c * c * (hp > 0.0 ? pow(max(c, 1e-6), hp) : 1.0);
      float gt = c * c * (hg != 0.0 ? pow(max(c, 1e-6), hg) : 1.0);
      wn = mix(1.0, weight, u_hier);
      r *= weight;
      weight = clamp(2.0 * gt * weight, 0.0, 1.0);
      // Ridge offset: the basins keep this share of every octave's detail too.
      weight = max(weight, min(u_ridge, 1.0));
      n = r;
    } else if (u_fractal == 3) {
      n = fold;
    } else if (u_fractal == 4) {
      q += (n - 0.5) * 0.6;
    }
    // Billow with Crease softness: the finer octaves fade out inside the first octave's creases (by its fold), so the
    // creases stay clean folds while the lumps carry the detail (cauliflower), instead of grainy bands.
    float bg = 1.0;
    if (u_fractal == 3 && u_crease > 0.0) {
      if (o == 0) f0 = fold;
      else bg = mix(1.0, smoothstep(0.0, 0.6, f0), u_crease);
    }
    sum += n * amp * ha * bg;
    norm += amp * ha * wn;
    amp *= u_gain;
    if (uTile) { q *= float(ilac); per *= ilac; } else { q *= u_lacunarity; }
  }
  float v = u_fractal == 0 ? sum : sum / max(norm, 1e-6);
  if (u_even && !worley) v = eq_value(v);
  // Levels: contrast about mid-grey, then brightness; the clip box-filtered over Clip softness (≤ 1: mid-tones untouched).
  if (u_contrast != 1.0 || u_bias != 0.0 || u_even) {
    float l = (v - 0.5) * u_contrast + 0.5 + u_bias;
    float sw = u_soft;
    v = sw > 0.0 ? (nz_clampInt(l + 0.5 * sw) - nz_clampInt(l - 0.5 * sw)) / sw : clamp(l, 0.0, 1.0);
  }
  return v;
}
`;

const CONTROL_UNIFORMS = new RegExp(`\\bu_(?=(?:${NOISE_CONTROLS.map((d) => d.key).join('|')})\\b)`, 'g');

/** nz_field for controls stored under a key prefix (it needs NZ_SHARED_GLSL before it, and t_calib: noiseCalib). */
export const noiseFieldGlsl = (prefix: string) => NZ_FIELD_GLSL.replace(CONTROL_UNIFORMS, `u_${prefix}`);

export const noiseLayer: LayerDef = {
	type: 'noise',
	noise: true,
	label: 'Noise',
	category: 'noise',
	kind: 'generator',
	description:
		'Noise: Lattice, cellular and white noise, with optional fractal layering, domain warp and contrast. Makes clouds, grain, stone, marbling, hammered metal.',
	maskSources: [
		{
			value: 'layer',
			label: 'This layer',
			hint: 'where the layer covers: everywhere, or down to its Cutoff',
			params: {}
		},
		{
			value: 'value',
			label: 'Value',
			hint: 'the noise’s value after Value shaping, the grey that Diffuse’s gradient and Height read, as a soft mask',
			params: {},
			soft: true
		}
	],
	params: [
		...NOISE_CONTROLS,
		P.int('block', 'Pixel size', 1, 1, 256, { softMax: 32, unit: 'px', showIf: (p) => p.noise === 'white' }),
		P.seed()
	],
	// Added in the editor: a little more contrast, rolling off without a clip. Code-built layers keep neutral levels: they
	// are usually thresholded (Cutoff, height masks), where a roll-off would move the cut.
	fresh: () => ({ contrast: 1.1, soft: 1 }),
	textures: ['calib'],
	cpuData: (p, ctx) => noiseCalib(p, ctx.tileable),
	defaults: { h_on: true, h_amount: 0.25 },
	glsl: /* glsl */ `
${NZ_SHARED_GLSL}
${NZ_FIELD_GLSL}
GenOut gen(vec2 p) {
  if (u_noise == 6) {
    float b = float(u_block);
    ivec2 c = ivec2(floor(p / b));
    c = wrapCell(c, ivec2(snapCells(uRes / b)));
    float v = animValue(hashI(c, uSeed), c, uSeed);
    return genOut(v, 1.0, v, 0.0);
  }
  float rnd;
  float v = nz_field(p, uSeed, rnd);
  // Worley types have cells (features); value / perlin / simplex are smooth — their "random" is the value itself.
  if (u_noise >= 3) return genOut(v, 1.0, rnd, 0.0);
  return genOutSmooth(v, 1.0, v, 0.0);
}
`
};
