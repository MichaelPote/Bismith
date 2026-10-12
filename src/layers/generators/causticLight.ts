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

import { P } from '@/core/params'
import type { LayerDef } from '../types'

export const causticLightLayer: LayerDef = {
  type: 'causticlight',
  label: 'Caustic light',
  category: 'pattern',
  kind: 'generator',
  description: 'Light refracted through a wavy surface and gathered below: bright filaments and cusps around dark cells (lava, water, slime). Tileable.',
  params: [
    P.enum('output', 'Output', 'light', [['light', 'Gathered light'], ['surface', 'Surface height']]),
    P.enum('model', 'Wave model', 'sines', [
      ['sines', 'Sines', 'rolling sines, crests sharpened by a second harmonic (Crest sharpness)'],
      ['gerstner', 'Gerstner', 'trochoidal waves: the surface gathers towards the crests — sharp crests over broad, flat troughs, rolling as they travel'],
    ]),
    P.float('scale', 'Cells across', 4, 0.5, 64, { softMax: 16, step: 0.01, hint: 'Wave count across the texture (rounded per wave to tile)' }),
    P.int('waves', 'Waves', 7, 1, 16, { hint: 'Plane waves summed; more = rounder, more irregular cells' }),
    P.float('spread', 'Wavelength spread', 0.35, 0, 1, { step: 0.001, hint: 'Variation of the wave counts around the scale' }),
    P.float('strength', 'Refraction', 5, 0, 256, { softMax: 12, unit: 'px', step: 0.05, hint: 'How far light is bent; higher = sharper filaments, darker cells' }),
    P.float('softness', 'Filament width', 0.8, 0.3, 8, { softMax: 3, unit: 'px', step: 0.05, hint: 'Blur of the gathered light: thin, sharp filaments when low' }),
    P.float('exposure', 'Exposure', 1, 0.05, 8, { softMax: 4, step: 0.01, hint: 'Intensity → value: 1 − exp(−exposure · light^contrast)' }),
    P.float('contrast', 'Contrast', 1.6, 0.5, 4, { step: 0.01, hint: 'Power on the gathered light before exposure: higher = darker cells, the filaments keep their brightness' }),
    P.float('octave2', 'Fine waves', 0.25, 0, 1, { step: 0.001, hint: 'A second band of waves at double frequency (breaks up the filaments)' }),
    P.float('meander', 'Meander', 0.5, 0, 4, { softMax: 2, step: 0.001, hint: 'Slow, tileable bending of the surface: curved walls, cells of varied size (organic rather than a lattice). Above about 1.4 the bends fold over into creases' }),
    P.float('steepness', 'Steepness', 0.7, 0, 1, { step: 0.001, showIf: (p) => p.model === 'gerstner', hint: 'How far the surface gathers towards the crests: 0 = plain sines, 1 = cusped crests (the most before the surface would fold over)' }),
    P.float('harmonic', 'Crest sharpness', 1, 0, 2, { step: 0.001, showIf: (p) => p.model !== 'gerstner', hint: 'A second, in-phase sine per wave (cos φ + c·cos 2φ, a Stokes profile): sharper crests focus thinner filaments. 1 is the sharpest that keeps the cells whole; above it the troughs flatten and the cells start to split' }),
    P.float('halo', 'Halo', 0, 0, 1, { step: 0.001, hint: 'The same light spread wide, added where it is brighter: a glow around the filaments that keeps the cells\' cores dark' }),
    P.float('halo_size', 'Halo radius', 3, 0.5, 16, { softMax: 8, unit: 'px', step: 0.05 }),
    P.float('phase', 'Phase', 0, -10000, 10000, { softMin: 0, softMax: 1, step: 0.001, optimize: false, hint: 'Moves the waves: 0 → 1 is one seamless loop (render frames at even steps); it repeats beyond 1' }),
    P.seed(),
  ],
  defaults: { h_on: false, dif_on: true, dif_src: 'value', dif_grad: { stops: [{ pos: 0, color: '#000010' }, { pos: 0.5, color: '#0010a0' }, { pos: 1, color: '#80a0ff' }] } },
  glsl: /* glsl */ `
const int LC_MAX = 16;
vec2 lcK[LC_MAX];
float lcPhi[LC_MAX];
float lcPsi[LC_MAX];
float lcA[LC_MAX];
int lcN;
float lcC; // second-harmonic amplitude (sines)
float lcQ[LC_MAX]; // Gerstner: each wave's horizontal amplitude (px)
float lcDmax; // Gerstner: the largest horizontal shift
vec2 lcWk[4]; // meander: two slow sines per axis
float lcWp[4];
float lcWa[4];

void lc_init() {
  lcN = clamp(u_waves, 1, LC_MAX);
  // c = 1/16 keeps the trough curvature at its maximum (1 − 4c) mid-trough — the sharpest crest without splitting cells.
  bool ger = u_model == 1;
  lcC = ger ? 0.0 : 0.0625 * u_harmonic;
  float norm = 0.0;
  // Coarse and fine waves each take exactly evenly spaced directions (one random rotation per seed) — an uneven or
  // duplicated set of directions stretches the cells along the dominant ones.
  int nf = u_octave2 > 0.0 && lcN > 2 ? max(1, lcN / 3) : 0;
  int nc = lcN - nf;
  float rot = 3.14159265 * hashI(ivec2(0, 9), uSeed);
  for (int i = 0; i < LC_MAX; i++) {
    if (i >= lcN) break;
    float h1 = hashI(ivec2(i, 1), uSeed);
    float h3 = hashI(ivec2(i, 3), uSeed);
    bool isFine = i >= nc;
    int m = isFine ? nf : nc;
    int ii = isFine ? i - nc : i;
    float th = rot + (isFine ? 0.5 : 0.0) * 3.14159265 / float(m) + 3.14159265 * float(ii) / float(m);
    float r = max(u_scale * (isFine ? 2.0 : 1.0) * (1.0 + 0.6 * u_spread * (2.0 * h1 - 1.0)), 1.0);
    vec2 ideal = vec2(r * cos(th), r * sin(th) * uRes.y / uRes.x);
    vec2 n = ideal;
    if (uTile) {
      // Whole wave counts (to tile), picked for the closest direction (modulo 180°), then the closest length.
      float ta = atan(ideal.y, ideal.x);
      float be = 1e9;
      for (int a = -1; a <= 2; a++)
        for (int b = -1; b <= 2; b++) {
          vec2 c = floor(ideal) + vec2(float(a), float(b));
          if (dot(c, c) < 0.5) continue;
          float e = abs(mod(atan(c.y, c.x) - ta + 1.5707963, 3.14159265) - 1.5707963);
          e += 0.12 * abs(length(c) - length(ideal)) / length(ideal);
          if (e < be) { be = e; n = c; }
        }
    }
    vec2 k = 6.28318531 * n / uRes;
    lcK[i] = k;
    // Travel: a whole number of wavelengths per loop (fine waves twice as fast), forwards or backwards.
    float travel = (isFine ? 2.0 : 1.0) * (hashI(ivec2(i, 5), uSeed) < 0.5 ? -1.0 : 1.0);
    lcPhi[i] = 6.28318531 * (h3 + travel * u_phase);
    lcPsi[i] = 0.0; // coherent with the fundamental: a crest-sharpening profile, not new cells
    lcA[i] = (isFine ? u_octave2 : 1.0) / length(k);
    // A wave's steepest slope is |k| (1 + 2c): normalise so the whole surface's slope stays ≤ 1.
    norm += lcA[i] * length(k) * (1.0 + 2.0 * lcC);
  }
  for (int i = 0; i < LC_MAX; i++) {
    if (i >= lcN) break;
    lcA[i] /= max(norm, 1e-6);
  }
  // Gerstner steepness: wave i gathers the surface towards its crests by s_i = S · w_i / λ (w_i = a_i |k_i|, its share
  // of the slope; q_i = s_i / |k_i| = S a_i / λ). λ, the largest eigenvalue of Σ w_i k̂_i k̂_iᵀ, bounds how far the
  // waves together compress the surface along any direction where all their crests meet — so it folds over nowhere
  // below S = 1, where the crests become cusps.
  lcDmax = 0.0;
  if (ger) {
    mat2 M = mat2(0.0);
    for (int i = 0; i < LC_MAX; i++) {
      if (i >= lcN) break;
      vec2 kh = normalize(lcK[i]);
      M += lcA[i] * length(lcK[i]) * outerProduct(kh, kh);
    }
    float hd = 0.5 * (M[0][0] - M[1][1]);
    float lam = 0.5 * (M[0][0] + M[1][1]) + sqrt(hd * hd + M[0][1] * M[0][1]);
    for (int i = 0; i < LC_MAX; i++) {
      if (i >= lcN) break;
      lcQ[i] = u_steepness * lcA[i] / max(lam, 1e-6);
      lcDmax += lcQ[i];
    }
  }
  // Meander waves: about two cells long, whole cycles across (tiles); each bends its axis by at most 0.35·meander of
  // slope, so the warped surface never folds over.
  float rw = 3.14159265 * hashI(ivec2(0, 19), uSeed);
  for (int j = 0; j < 4; j++) {
    float th = rw + 0.7853982 * float(j) + 0.4 * (hashI(ivec2(j, 11), uSeed) - 0.5);
    float r = max(u_scale * (0.35 + 0.25 * hashI(ivec2(j, 12), uSeed)), 0.75);
    vec2 n = vec2(r * cos(th), r * sin(th) * uRes.y / uRes.x);
    if (uTile) {
      vec2 c = floor(n + 0.5);
      if (dot(c, c) < 0.5) c = abs(n.x) > abs(n.y) ? vec2(sign(n.x), 0.0) : vec2(0.0, sign(n.y));
      n = c;
    }
    lcWk[j] = 6.28318531 * n / uRes;
    lcWp[j] = 6.28318531 * hashI(ivec2(j, 13), uSeed);
    lcWa[j] = 0.35 * u_meander / max(length(lcWk[j]), 1e-6);
  }
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
  for (int i = 0; i < LC_MAX; i++) {
    if (i >= lcN) break;
    float ph = dot(lcK[i], p) + lcPhi[i];
    // h_i = a (cos φ + c · cos(2φ + ψ)) → ∇h_i = −a k (sin φ + 2c · sin(2φ + ψ))
    g -= lcA[i] * lcK[i] * (sin(ph) + 2.0 * lcC * sin(2.0 * ph + lcPsi[i]));
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
  float m = 0.0;
  for (int i = 0; i < LC_MAX; i++) {
    if (i >= lcN) break;
    float ph = dot(lcK[i], p) + lcPhi[i];
    h += lcA[i] * length(lcK[i]) * (cos(ph) + lcC * cos(2.0 * ph + lcPsi[i]));
    m += lcA[i] * length(lcK[i]) * (1.0 + lcC);
  }
  return h / max(m, 1e-6);
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
  for (int i = 0; i < LC_MAX; i++) {
    if (i >= lcN) break;
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
// contraction while the steepness is below 1), then Z(u), normalised like lc_height.
float lc_gerstner_height(vec2 x) {
  vec2 u = x;
  for (int it = 0; it < 6; it++) {
    vec2 X;
    vec2 sl;
    lc_gerstner(u, X, sl);
    u += x - X;
  }
  if (u_meander > 0.0) {
    mat2 JT;
    u = lc_warp(u, JT);
  }
  float h = 0.0;
  float m = 0.0;
  for (int i = 0; i < LC_MAX; i++) {
    if (i >= lcN) break;
    h += lcA[i] * length(lcK[i]) * cos(dot(lcK[i], u) + lcPhi[i]);
    m += lcA[i] * length(lcK[i]);
  }
  return h / max(m, 1e-6);
}

// Light gathered at p: lattice samples (spacing ≤ dmax) displaced by the slope, splatted with a Gaussian of radius s.
// Gerstner: the lattice is in the surface's parameter, each sample shifted to its point and weighted by its area; the
// reach grows by the largest shift and by the steeper slopes near the crests. Near a cusp light can be thrown past the
// lattice window; it fades out by its own throw before the window's edge, so every pixel sees the same light (a hard
// cut-off would draw the window's straight edges).
float lc_gather(vec2 p, float s, float dmax) {
  bool ger = u_model == 1;
  float R = u_strength * (1.0 + 0.7 * u_meander) * (ger ? 1.0 + u_steepness : 1.0) + lcDmax + 3.0 * s;
  float d = clamp(0.6 * s, 0.3, dmax);
  int n = min(int(ceil(R / d)), 48);
  vec2 base = (floor(p / d) + 0.5) * d;
  float inv = 1.0 / (2.0 * s * s);
  float throwMax = float(n) * d - 3.0 * s;
  float I = 0.0;
  for (int j = -n; j <= n; j++)
    for (int i = -n; i <= n; i++) {
      vec2 src = base + vec2(float(i), float(j)) * d;
      if (ger) {
        vec2 x;
        vec2 sl;
        float area = lc_gerstner(src, x, sl);
        vec2 t = x + u_strength * sl;
        vec2 dd = p - t;
        float fade = 1.0 - smoothstep(0.7 * throwMax, throwMax, length(t - src));
        I += area * fade * exp(-dot(dd, dd) * inv);
      } else {
        vec2 t = src + u_strength * lc_slope(src);
        vec2 dd = p - t;
        I += exp(-dot(dd, dd) * inv);
      }
    }
  return I * d * d / (6.28318531 * s * s);
}

GenOut gen(vec2 p) {
  lc_init();
  if (u_output == 1) return genOut(0.5 + 0.5 * (u_model == 1 ? lc_gerstner_height(p) : lc_height(p)), 1.0, 0.0, NO_SDF);
  float I = lc_gather(p, max(u_softness, 0.3), 1.0);
  // Halo: the light spread wide, added only where it exceeds the sharp light — a glow around the filaments that leaves
  // the filaments and the cells' dark cores as they are. Its wide kernel tolerates a coarser lattice.
  if (u_halo > 0.0) I += u_halo * max(lc_gather(p, max(u_halo_size, 0.5), 0.5 * max(u_halo_size, 0.5)) - I, 0.0);
  return genOut(1.0 - exp(-u_exposure * pow(max(I, 0.0), u_contrast)), 1.0, 0.0, NO_SDF);
}
`,
}
