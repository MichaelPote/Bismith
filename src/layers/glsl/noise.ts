// Tileable noise library. Every lattice noise takes an integer `period` (in cells); lattice coordinates are
// wrapped by it before hashing, so a texture whose cell count is an integer repeats seamlessly.
// Non-tiling projects pass a huge period. Values are returned in 0..1 unless noted.

export const GLSL_NOISE = /* glsl */ `
const ivec2 NO_PERIOD = ivec2(1 << 20);

float valueNoise(vec2 x, ivec2 period, float seed) {
  ivec2 i = ivec2(floor(x));
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hashI(imod(i, period), seed);
  float b = hashI(imod(i + ivec2(1, 0), period), seed);
  float c = hashI(imod(i + ivec2(0, 1), period), seed);
  float d = hashI(imod(i + ivec2(1, 1), period), seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 gradDir(ivec2 c, float seed) {
  float a = hashI(c, seed) * TAU;
  return vec2(cos(a), sin(a));
}

float perlinNoise(vec2 x, ivec2 period, float seed) {
  ivec2 i = ivec2(floor(x));
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(gradDir(imod(i, period), seed), f);
  float b = dot(gradDir(imod(i + ivec2(1, 0), period), seed), f - vec2(1.0, 0.0));
  float c = dot(gradDir(imod(i + ivec2(0, 1), period), seed), f - vec2(0.0, 1.0));
  float d = dot(gradDir(imod(i + ivec2(1, 1), period), seed), f - vec2(1.0, 1.0));
  return clamp(mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.2 + 0.5, 0.0, 1.0);
}

// 2D simplex noise (not periodic).
float simplexNoise(vec2 v, float seed) {
  const float F2 = 0.36602540378;
  const float G2 = 0.2113248654;
  vec2 i = floor(v + dot(v, vec2(F2)));
  vec2 x0 = v - i + dot(i, vec2(G2));
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 x1 = x0 - i1 + G2;
  vec2 x2 = x0 - 1.0 + 2.0 * G2;
  ivec2 ii = ivec2(i);
  vec3 w = max(0.5 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
  w = w * w * w * w;
  vec3 n = vec3(
    dot(gradDir(ii, seed), x0),
    dot(gradDir(ii + ivec2(i1), seed), x1),
    dot(gradDir(ii + ivec2(1), seed), x2));
  return clamp(dot(w, n) * 35.0 + 0.5, 0.0, 1.0);
}

// Worley / cellular. Returns (F1, F2, per-cell random, distance to the cell border) in cell units.
// metric: 0 euclidean, 1 manhattan, 2 chebyshev.
vec4 worleyNoise(vec2 x, ivec2 period, float jitter, int metric, float seed) {
  ivec2 ip = ivec2(floor(x));
  vec2 fp = fract(x);
  float F1 = 1e9, F2 = 1e9;
  vec2 mr = vec2(0.0);
  ivec2 mc = ip;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec2 g = ivec2(i, j);
    vec2 o = 0.5 + (hash2I(imod(ip + g, period), seed) - 0.5) * jitter;
    vec2 r = vec2(g) + o - fp;
    float d = metric == 1 ? abs(r.x) + abs(r.y) : metric == 2 ? max(abs(r.x), abs(r.y)) : dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; mr = r; mc = ip + g; }
    else if (d < F2) { F2 = d; }
  }
  if (metric == 0) { F1 = sqrt(F1); F2 = sqrt(F2); }
  float md = 1e9;
  for (int j = -2; j <= 2; j++)
  for (int i = -2; i <= 2; i++) {
    ivec2 g = ivec2(i, j);
    vec2 o = 0.5 + (hash2I(imod(ip + g, period), seed) - 0.5) * jitter;
    vec2 r = vec2(g) + o - fp;
    vec2 dr = r - mr;
    if (dot(dr, dr) > 1e-6) md = min(md, dot(0.5 * (mr + r), normalize(dr)));
  }
  return vec4(F1, F2, hashI(imod(mc, period), seed + 17.0), md);
}

// Base noise dispatch. type: 0 value, 1 perlin, 2 simplex, 3 worley F1, 4 worley F2, 5 worley F2-F1.
float baseNoise(int type, vec2 x, ivec2 period, float seed) {
  if (type == 0) return valueNoise(x, period, seed);
  if (type == 1) return perlinNoise(x, period, seed);
  if (type == 2) return uTile ? perlinNoise(x, period, seed) : simplexNoise(x, seed);
  vec4 w = worleyNoise(x, period, 1.0, 0, seed);
  if (type == 3) return clamp(w.x, 0.0, 1.0);
  if (type == 4) return clamp(w.y, 0.0, 1.0);
  return clamp((w.y - w.x) * 1.5, 0.0, 1.0);
}

// Fractal sum. mode: 0 single octave, 1 fBm, 2 ridged, 3 billow, 4 turbulence (self-warped fBm).
float fractalNoise(int type, int mode, vec2 x, ivec2 period, int octaves, float lac, float gain, float seed) {
  if (mode == 0) return baseNoise(type, x, period, seed);
  float sum = 0.0, amp = 1.0, norm = 0.0, weight = 1.0;
  vec2 q = x;
  ivec2 per = period;
  int ilac = int(lac + 0.5);
  for (int o = 0; o < 12; o++) {
    if (o >= octaves) break;
    float s = seed + float(o) * 31.0;
    float n = baseNoise(type, q, per, s);
    if (mode == 2) {
      float r = 1.0 - abs(2.0 * n - 1.0);
      r *= r;
      r *= weight;
      weight = clamp(r * 2.0, 0.0, 1.0);
      n = r;
    } else if (mode == 3) {
      n = abs(2.0 * n - 1.0);
    } else if (mode == 4) {
      q += (n - 0.5) * 0.6;
    }
    sum += n * amp;
    norm += amp;
    amp *= gain;
    if (uTile) { q *= float(ilac); per *= ilac; } else { q *= lac; }
  }
  return sum / max(norm, 1e-6);
}

// Domain warp: returns the displacement (in cells) to add to x. Periodic when period is.
vec2 warpOffset(vec2 x, ivec2 period, float seed) {
  return vec2(
    fractalNoise(1, 1, x, period, 3, 2.0, 0.5, seed + 101.0),
    fractalNoise(1, 1, x + 17.3, period, 3, 2.0, 0.5, seed + 211.0)) - 0.5;
}
`
