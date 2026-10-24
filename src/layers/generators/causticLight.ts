// Caustic light (FR8.9): light refracted through a wavy liquid surface and gathered on the floor below — the bright
// filaments, cusps and dark cells of lava, water, slime and nukage.
//
// Surface: a sum of plane waves with whole-number wave counts across the texture (so it tiles and its slope is exact
// and cheap), each with an in-phase second harmonic (a Stokes profile: sharper crests, flatter troughs). Light: each
// sample of a fine lattice under the pixel is displaced by the surface slope × strength (refraction) and splatted with
// a Gaussian; the pixel's intensity is the sum of the splats that land on it — additive
// light that piles up into filaments where refraction converges and thins out into dark cells where it diverges
// (1 = a flat surface). The value is 1 − exp(−exposure · intensity^contrast): soft, never clipping.
//
// Wave model Gerstner (trochoidal waves) makes the surface parametric instead: the point of parameter u sits at
// X(u) = u − Σ q_i k̂_i sin θ_i, height Z(u) = Σ a_i cos θ_i — the surface gathers towards the crests (sharp crests,
// broad flat troughs). The gather walks the parameter lattice: each sample lands at X(u) + strength · ∇z, where
// ∇z = J⁻ᵀ ∂Z/∂u (J = ∂X/∂u), and carries det J — the horizontal area of its patch, i.e. the light it catches.
//
// Phase animates the surface: each wave travels along its direction by a whole number of wavelengths per loop (coarse
// waves one, fine waves two — faster, as short water waves are), forwards or backwards, so 0 → 1 loops seamlessly.

import { hashI } from '@/core/hash';
import { P, type ParamValues } from '@/core/params';
import { PHASE_PARAM } from '../commonParams';
import { GLSL_PRIMTEX } from '../primTexture';
import type { CpuTexture, LayerDef } from '../types';

const LC_MAX = 16;

/**
 * The wave table, from the params, seed and canvas size (the same for every pixel, so worked out here once): float32s
 * as the bits of RGBA8 texels, 8 a row — rows 0–15 the waves (k.x, k.y, φ, a, q, w = a·|k|), rows 16–19 the meander
 * waves (k.x, k.y, φ, a), row 20 Gerstner's largest shift Σ q and the height normaliser Σ w (1 + c).
 */
function waveTable(
	p: ParamValues,
	ctx: { width: number; height: number; tileable: boolean; seed: number }
): CpuTexture {
	const W = ctx.width,
		H = ctx.height,
		seed = ctx.seed;
	const num = (k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
	const n = Math.max(1, Math.min(LC_MAX, Math.round(num('waves', 7))));
	const scale = num('scale', 4),
		spread = num('spread', 0.35),
		oct2 = num('octave2', 0.25),
		phase = num('phase', 0);
	const ger = p.model === 'gerstner';
	// c = 1/16 keeps the trough curvature at its maximum (1 − 4c) mid-trough — the sharpest crest without splitting cells.
	const c = ger ? 0 : 0.0625 * num('harmonic', 1);
	const f = new Float32Array(8 * 21);
	const K: [number, number][] = [];
	const A: number[] = [];
	let norm = 0;
	// Coarse and fine waves each take exactly evenly spaced directions (one random rotation per seed) — an uneven or
	// duplicated set of directions stretches the cells along the dominant ones.
	const nf = oct2 > 0 && n > 2 ? Math.max(1, Math.floor(n / 3)) : 0;
	const nc = n - nf;
	const rot = Math.PI * hashI(0, 9, seed);
	for (let i = 0; i < n; i++) {
		const h1 = hashI(i, 1, seed),
			h3 = hashI(i, 3, seed);
		const fine = i >= nc;
		const m = fine ? nf : nc;
		const th = rot + ((fine ? 0.5 : 0) * Math.PI) / m + (Math.PI * (fine ? i - nc : i)) / m;
		const r = Math.max(scale * (fine ? 2 : 1) * (1 + 0.6 * spread * (2 * h1 - 1)), 1);
		const ideal = [r * Math.cos(th), (r * Math.sin(th) * H) / W];
		let v = ideal;
		if (ctx.tileable) {
			// Whole wave counts (to tile), picked for the closest direction (modulo 180°), then the closest length.
			const ta = Math.atan2(ideal[1], ideal[0]);
			const il = Math.hypot(ideal[0], ideal[1]);
			let be = 1e9;
			for (let a = -1; a <= 2; a++)
				for (let b = -1; b <= 2; b++) {
					const cx = Math.floor(ideal[0]) + a,
						cy = Math.floor(ideal[1]) + b;
					if (cx * cx + cy * cy < 0.5) continue;
					const x = Math.atan2(cy, cx) - ta + Math.PI / 2;
					let e = Math.abs(x - Math.PI * Math.floor(x / Math.PI) - Math.PI / 2);
					e += (0.12 * Math.abs(Math.hypot(cx, cy) - il)) / il;
					if (e < be) {
						be = e;
						v = [cx, cy];
					}
				}
		}
		const k: [number, number] = [(2 * Math.PI * v[0]) / W, (2 * Math.PI * v[1]) / H];
		const kl = Math.hypot(k[0], k[1]);
		// Travel: a whole number of wavelengths per loop (fine waves twice as fast), forwards or backwards.
		const travel = (fine ? 2 : 1) * (hashI(i, 5, seed) < 0.5 ? -1 : 1);
		K.push(k);
		A.push((fine ? oct2 : 1) / kl);
		f.set([k[0], k[1], 2 * Math.PI * (h3 + travel * phase)], i * 8);
		// A wave's steepest slope is |k| (1 + 2c): normalise so the whole surface's slope stays ≤ 1.
		norm += A[i] * kl * (1 + 2 * c);
	}
	// Gerstner steepness: wave i gathers the surface towards its crests by s_i = S · w_i / λ (w_i = a_i |k_i|, its share
	// of the slope; q_i = s_i / |k_i| = S a_i / λ). λ, the largest eigenvalue of Σ w_i k̂_i k̂_iᵀ, bounds how far the
	// waves together compress the surface along any direction where all their crests meet — so it folds over nowhere
	// below S = 1, where the crests become cusps.
	let mxx = 0,
		mxy = 0,
		myy = 0,
		hn = 0,
		dmax = 0;
	for (let i = 0; i < n; i++) {
		A[i] /= Math.max(norm, 1e-6);
		const kl = Math.hypot(K[i][0], K[i][1]);
		const w = A[i] * kl;
		const [kx, ky] = [K[i][0] / kl, K[i][1] / kl];
		mxx += w * kx * kx;
		mxy += w * kx * ky;
		myy += w * ky * ky;
		hn += w * (1 + c);
		f.set([A[i]], i * 8 + 3);
		f.set([w], i * 8 + 5);
	}
	if (ger) {
		const hd = 0.5 * (mxx - myy);
		const lam = 0.5 * (mxx + myy) + Math.sqrt(hd * hd + mxy * mxy);
		for (let i = 0; i < n; i++) {
			const q = (num('steepness', 0.7) * A[i]) / Math.max(lam, 1e-6);
			f[i * 8 + 4] = q;
			dmax += q;
		}
	}
	// Meander waves: about two cells long, whole cycles across (tiles); each bends its axis by at most 0.35·meander of
	// slope, so the warped surface never folds over.
	const rw = Math.PI * hashI(0, 19, seed);
	for (let j = 0; j < 4; j++) {
		const th = rw + (Math.PI / 4) * j + 0.4 * (hashI(j, 11, seed) - 0.5);
		const r = Math.max(scale * (0.35 + 0.25 * hashI(j, 12, seed)), 0.75);
		let v = [r * Math.cos(th), (r * Math.sin(th) * H) / W];
		if (ctx.tileable) {
			let cv = [Math.floor(v[0] + 0.5), Math.floor(v[1] + 0.5)];
			if (cv[0] * cv[0] + cv[1] * cv[1] < 0.5)
				cv = Math.abs(v[0]) > Math.abs(v[1]) ? [Math.sign(v[0]), 0] : [0, Math.sign(v[1])];
			v = cv;
		}
		const k = [(2 * Math.PI * v[0]) / W, (2 * Math.PI * v[1]) / H];
		const a = (0.35 * num('meander', 0.5)) / Math.max(Math.hypot(k[0], k[1]), 1e-6);
		f.set([k[0], k[1], 2 * Math.PI * hashI(j, 13, seed), a], (16 + j) * 8);
	}
	f.set([dmax, hn], 20 * 8);
	return { width: 8, height: 21, data: new Uint8Array(f.buffer) };
}

export const causticLightLayer: LayerDef = {
	type: 'causticlight',
	label: 'Caustic light',
	category: 'pattern',
	kind: 'generator',
	description:
		'Light refracted through a wavy surface and gathered below: bright filaments and cusps around dark cells (lava, water, slime). Tileable.',
	params: [
		P.enum('output', 'Output', 'light', [
			['light', 'Gathered light'],
			['surface', 'Surface height']
		]),
		P.enum('model', 'Wave model', 'sines', [
			['sines', 'Sines', 'rolling sines, crests sharpened by a second harmonic (Crest sharpness)'],
			[
				'gerstner',
				'Gerstner',
				'trochoidal waves: the surface gathers towards the crests — sharp crests over broad, flat troughs, rolling as they travel'
			]
		]),
		P.float('scale', 'Cells across', 4, 0.5, 64, {
			softMax: 16,
			step: 0.01,
			hint: 'Wave count across the texture (rounded per wave to tile)'
		}),
		P.int('waves', 'Waves', 7, 1, 16, { hint: 'Plane waves summed; more = rounder, more irregular cells' }),
		P.float('spread', 'Wavelength spread', 0.35, 0, 1, {
			step: 0.001,
			hint: 'Variation of the wave counts around the scale'
		}),
		P.float('strength', 'Refraction', 5, 0, 256, {
			softMax: 12,
			unit: 'px',
			step: 0.05,
			hint: 'How far light is bent; higher = sharper filaments, darker cells'
		}),
		P.float('softness', 'Filament width', 0.8, 0.3, 8, {
			softMax: 3,
			unit: 'px',
			step: 0.05,
			hint: 'Blur of the gathered light: thin, sharp filaments when low'
		}),
		P.float('exposure', 'Exposure', 1, 0.05, 8, {
			softMax: 4,
			step: 0.01,
			hint: 'Intensity → value: 1 − exp(−exposure · light^contrast)'
		}),
		P.float('contrast', 'Contrast', 1.6, 0.5, 4, {
			step: 0.01,
			hint: 'Power on the gathered light before exposure: higher = darker cells, the filaments keep their brightness'
		}),
		P.float('octave2', 'Fine waves', 0.25, 0, 1, {
			step: 0.001,
			hint: 'A second band of waves at double frequency (breaks up the filaments)'
		}),
		P.float('meander', 'Meander', 0.5, 0, 4, {
			softMax: 2,
			step: 0.001,
			hint: 'Slow, tileable bending of the surface: curved walls, cells of varied size (organic rather than a lattice). Above about 1.4 the bends fold over into creases'
		}),
		P.float('steepness', 'Steepness', 0.7, 0, 1, {
			step: 0.001,
			showIf: (p) => p.model === 'gerstner',
			hint: 'How far the surface gathers towards the crests: 0 = plain sines, 1 = cusped crests (the most before the surface would fold over)'
		}),
		P.float('harmonic', 'Crest sharpness', 1, 0, 2, {
			step: 0.001,
			showIf: (p) => p.model !== 'gerstner',
			hint: 'A second, in-phase sine per wave (cos φ + c·cos 2φ, a Stokes profile): sharper crests focus thinner filaments. 1 is the sharpest that keeps the cells whole; above it the troughs flatten and the cells start to split'
		}),
		P.float('halo', 'Halo', 0, 0, 1, {
			step: 0.001,
			hint: "The same light spread wide, added where it is brighter: a glow around the filaments that keeps the cells' cores dark"
		}),
		P.float('halo_size', 'Halo radius', 3, 0.5, 16, { softMax: 8, unit: 'px', step: 0.05 }),
		{
			...PHASE_PARAM,
			hint: 'Moves the waves: 0 → 1 is one seamless loop (render frames at even steps); it repeats beyond 1'
		},
		P.seed()
	],
	defaults: {
		h_on: false,
		dif_on: true,
		dif_src: 'value',
		dif_grad: {
			stops: [
				{ pos: 0, color: '#000010' },
				{ pos: 0.5, color: '#0010a0' },
				{ pos: 1, color: '#80a0ff' }
			]
		}
	},
	textures: ['waves'],
	cpuData: (p, ctx) => ({ waves: waveTable(p, ctx) }),
	glsl: /* glsl */ `
${GLSL_PRIMTEX}
// The wave table (waveTable, cpuData): float32 bits in RGBA8 texels.
float lc_f(int x, int y) { return texF32(t_waves, ivec2(x, y)); }
const int LC_MAX = ${LC_MAX};
vec2 lcK[LC_MAX];
float lcPhi[LC_MAX];
float lcA[LC_MAX];
float lcW[LC_MAX]; // a |k|: the wave's share of the slope
float lcQ[LC_MAX]; // Gerstner: each wave's horizontal amplitude (px)
int lcN;
float lcC; // second-harmonic amplitude (sines)
float lcDmax; // Gerstner: the largest horizontal shift
float lcHn; // the height's normaliser, Σ a |k| (1 + c)
vec2 lcWk[4]; // meander: two slow sines per axis
float lcWp[4];
float lcWa[4];

void lc_init() {
  lcN = clamp(u_waves, 1, LC_MAX);
  lcC = u_model == 1 ? 0.0 : 0.0625 * u_harmonic;
  for (int i = 0; i < lcN; i++) {
    lcK[i] = vec2(lc_f(0, i), lc_f(1, i));
    lcPhi[i] = lc_f(2, i);
    lcA[i] = lc_f(3, i);
    lcQ[i] = lc_f(4, i);
    lcW[i] = lc_f(5, i);
  }
  for (int j = 0; j < 4 * UNI_1; j++) {
    lcWk[j] = vec2(lc_f(0, 16 + j), lc_f(1, 16 + j));
    lcWp[j] = lc_f(2, 16 + j);
    lcWa[j] = lc_f(3, 16 + j);
  }
  lcDmax = lc_f(0, 20);
  lcHn = lc_f(1, 20);
}

// Meander: the surface is read at q = p + w(p); the slope at p is then (I + J)^T ∇h(q) (chain rule).
vec2 lc_warp(vec2 p, out mat2 JT) {
  vec2 w = vec2(0.0);
  vec2 cx = vec2(0.0);
  vec2 cy = vec2(0.0);
  for (int j = 0; j < 4; j++) {
    float ph = dot(lcWk[j], p) + lcWp[j];
    float sw = lcWa[j] * sin(ph);
    vec2 dk = lcWa[j] * cos(ph) * lcWk[j];
    if (j < 2) { w.x += sw; cx += dk; } else { w.y += sw; cy += dk; }
  }
  JT = mat2(cx, cy);
  return p + w;
}

// Surface slope (∇h, |∇h| ≤ 1) and height.
vec2 lc_grad(vec2 p) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < lcN; i++) {
    float ph = dot(lcK[i], p) + lcPhi[i];
    // h_i = a (cos φ + c · cos 2φ) → ∇h_i = −a k (sin φ + 2c · sin 2φ)
    g -= lcA[i] * lcK[i] * (sin(ph) + 2.0 * lcC * sin(2.0 * ph));
  }
  return g;
}
vec2 lc_slope(vec2 p) {
  if (u_meander <= 0.0) return lc_grad(p);
  mat2 JT;
  vec2 g = lc_grad(lc_warp(p, JT));
  return g + JT * g;
}
float lc_height(vec2 p) {
  if (u_meander > 0.0) {
    mat2 JT;
    p = lc_warp(p, JT);
  }
  float h = 0.0;
  for (int i = 0; i < lcN; i++) {
    float ph = dot(lcK[i], p) + lcPhi[i];
    h += lcW[i] * (cos(ph) + lcC * cos(2.0 * ph));
  }
  return h / max(lcHn, 1e-6);
}

// Gerstner surface point of parameter u: its horizontal position x, the slope ∇z there, and (returned) the horizontal
// area its patch covers per unit of u, det ∂X/∂u — below 1 where the surface gathers towards a crest. θ_i reads the
// meander-warped parameter, κ_i = ∇θ_i is the local wave vector (its slow turning is neglected in J). The meander
// stretches and turns the waves, which could push the gathering past folding: where the compression with every crest
// met (the top eigenvalue of Σ q_i |κ_i| κ̂_i κ̂_iᵀ) would exceed the steepness, the gathering is scaled back.
float lc_gerstner(vec2 u, out vec2 x, out vec2 slope) {
  vec2 q = u;
  mat2 JT = mat2(0.0);
  if (u_meander > 0.0) q = lc_warp(u, JT);
  vec2 shift = vec2(0.0);
  vec2 gz = vec2(0.0);
  mat2 C = mat2(0.0);
  mat2 M = mat2(0.0);
  for (int i = 0; i < lcN; i++) {
    vec2 kap = lcK[i] + JT * lcK[i];
    float kl = max(length(kap), 1e-6);
    vec2 kh = kap / kl;
    float th = dot(lcK[i], q) + lcPhi[i];
    float sn = sin(th);
    mat2 P = (lcQ[i] * kl) * outerProduct(kh, kh);
    shift += lcQ[i] * sn * kh;
    gz -= lcA[i] * sn * kap;
    C += cos(th) * P;
    M += P;
  }
  float f = 1.0;
  if (u_meander > 0.0) {
    float hd = 0.5 * (M[0][0] - M[1][1]);
    float lam = 0.5 * (M[0][0] + M[1][1]) + sqrt(hd * hd + M[0][1] * M[0][1]);
    f = min(1.0, u_steepness / max(lam, 1e-6));
  }
  x = u - f * shift;
  mat2 J = mat2(1.0) - f * C;
  float det = determinant(J);
  // ∂Z/∂u = Jᵀ ∇z, so ∇z = J⁻ᵀ ∂Z/∂u (J is symmetric: adjugate / det). Near a cusp the slope grows without bound, but
  // the patch's area — the light it carries — goes to 0 with it.
  slope = mat2(J[1][1], -J[0][1], -J[1][0], J[0][0]) * gz / max(det, 1e-3);
  return max(det, 0.0);
}

// Gerstner height at horizontal position x: the parameter whose point lies there (u = x + Σ q_i κ̂_i sin θ_i(u), a
// contraction while the steepness is below 1), then Z(u) — lc_height, as c = 0.
float lc_gerstner_height(vec2 x) {
  vec2 u = x;
  for (int it = 0; it < 6 * UNI_1; it++) {
    vec2 X;
    vec2 sl;
    lc_gerstner(u, X, sl);
    u += x - X;
  }
  return lc_height(u);
}

// Light gathered at p: lattice samples (spacing ≤ dmax) displaced by the slope, splatted with a Gaussian of radius s.
// Gerstner: the lattice is in the surface's parameter, each sample shifted to its point and weighted by its area; the
// reach grows by the largest shift and by the steeper slopes near the crests. Near a cusp light can be thrown past the
// lattice window; it fades out by its own throw before the window's edge, so every pixel sees the same light (a hard
// cut-off would draw the window's straight edges). Sines' throw stays within the window unless its size is capped
// (high Refraction, supersampling): it fades only then.
float lc_gather(vec2 p, float s, float dmax) {
  bool ger = u_model == 1;
  float R = u_strength * (1.0 + 0.7 * u_meander) * (ger ? 1.0 + u_steepness : 1.0) + lcDmax + 3.0 * s;
  float d = clamp(0.6 * s, 0.3, dmax);
  int n = min(int(ceil(R / d)), 48);
  vec2 base = (floor(p / d) + 0.5) * d;
  float inv = 1.0 / (2.0 * s * s);
  float throwMax = float(n) * d - 3.0 * s;
  if (!ger && ceil(R / d) <= 48.0) throwMax = 1e9;
  float I = 0.0;
  for (int j = -n; j <= n; j++)
    for (int i = -n; i <= n; i++) {
      vec2 src = base + vec2(float(i), float(j)) * d;
      vec2 t;
      float area = 1.0;
      if (ger) {
        vec2 x;
        vec2 sl;
        area = lc_gerstner(src, x, sl);
        t = x + u_strength * sl;
      } else {
        t = src + u_strength * lc_slope(src);
      }
      vec2 dd = p - t;
      float fade = 1.0 - smoothstep(0.7 * throwMax, throwMax, length(t - src));
      I += area * fade * exp(-dot(dd, dd) * inv);
    }
  return I * d * d / (TAU * s * s);
}

// A smooth pattern without features: its "random" is the value itself.
GenOut gen(vec2 p) {
  lc_init();
  if (u_output == 1) {
    float v = 0.5 + 0.5 * (u_model == 1 ? lc_gerstner_height(p) : lc_height(p));
    return genOutSmooth(v, 1.0, v, NO_SDF);
  }
  // The sharp light, then the halo: the light spread wide, added only where it exceeds the sharp light — a glow around
  // the filaments that leaves the filaments and the cells' dark cores as they are. Its wide kernel tolerates a coarser
  // lattice. (One gather in a loop: D3D inlines each call.)
  float I = 0.0;
  int passes = 1 + int(u_halo > 0.0);
  for (int pass = 0; pass < passes; pass++) {
    bool halo = pass == 1;
    float s = halo ? max(u_halo_size, 0.5) : max(u_softness, 0.3);
    float g = lc_gather(p, s, halo ? 0.5 * s : 1.0);
    I = halo ? I + u_halo * max(g - I, 0.0) : g;
  }
  float v = 1.0 - exp(-u_exposure * pow(max(I, 0.0), u_contrast));
  return genOutSmooth(v, 1.0, v, NO_SDF);
}
`
};
