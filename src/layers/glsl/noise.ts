// Tileable noise library. Every lattice noise takes an integer `period` (in cells); lattice coordinates are
// wrapped by it before hashing, so a texture whose cell count is an integer repeats seamlessly.
// Non-tiling projects pass a huge period. Values are returned in 0..1 unless noted.
//
// Animation: `gPhase` (set from a layer's Phase param) moves every noise through one seamless loop as it goes 0 → 1;
// phase 0 is the still noise exactly. Gradients turn a whole revolution (Perlin, simplex); lattice values and cellular
// feature points travel up or down and bounce off the ends of their range, which keeps them uniformly distributed at
// every phase (value, white, Worley and the cell points of other generators, see cellPoint).

export const GLSL_NOISE = /* glsl */ `
const ivec2 NO_PERIOD = ivec2(1 << 20);

// A cell count made whole (at least 1) when tiling, so a lattice of that many cells repeats over the texture.
vec2 snapCells(vec2 c) { return uTile ? max(floor(c + 0.5), vec2(1.0)) : c; }
float snapCells(float c) { return uTile ? max(floor(c + 0.5), 1.0) : c; }
// The lattice period for a cell count that is whole when tiling (cellsFor, snapCells): effectively infinite otherwise.
ivec2 periodOf(vec2 cells) { return uTile ? ivec2(cells + 0.5) : NO_PERIOD; }

/** Animation phase: 0 → 1 is one seamless loop. The generator wrapper (and filters that animate) set it from u_phase. */
float gPhase = 0.0;

/** A lattice value h (0..1) at the current phase: it travels 2 per loop, up or down by a second hash, reflected at
 * 0 and 1 — h at phase 0 and 1, and uniformly distributed over the lattice at every phase. */
float animValue(float h, ivec2 c, float seed) {
  if (gPhase == 0.0) return h;
  float dir = hashI(c, seed + 7.31) < 0.5 ? -1.0 : 1.0;
  return 1.0 - abs(1.0 - mod(h + 2.0 * dir * gPhase, 2.0));
}

/** A cell's feature point (0..1 within the cell) at the current phase; hash2I(c, seed) when still. */
vec2 cellPoint(ivec2 c, float seed) {
  vec2 h = hash2I(c, seed);
  if (gPhase == 0.0) return h;
  return vec2(animValue(h.x, c, seed + 41.0), animValue(h.y, c, seed + 43.0));
}

// A lattice cell's corners i and i + 1, wrapped by the period: one imod (the +1 wraps by a compare).
void latticeWrap(ivec2 i, ivec2 period, out ivec2 i0, out ivec2 i1) {
  i0 = imod(i, period);
  i1 = i0 + 1;
  i1 -= period * ivec2(greaterThanEqual(i1, period));
}

float valueNoise(vec2 x, ivec2 period, float seed) {
  ivec2 i = ivec2(floor(x));
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 i0, i1;
  latticeWrap(i, period, i0, i1);
  ivec2 i10 = ivec2(i1.x, i0.y), i01 = ivec2(i0.x, i1.y);
  float a = animValue(hashI(i0, seed), i0, seed);
  float b = animValue(hashI(i10, seed), i10, seed);
  float c = animValue(hashI(i01, seed), i01, seed);
  float d = animValue(hashI(i1, seed), i1, seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 gradDir(ivec2 c, float seed) {
  float a = hashI(c, seed) * TAU;
  // Animated: each gradient turns one whole revolution per loop, clockwise or not by a second hash.
  if (gPhase != 0.0) a += (hashI(c, seed + 3.7) < 0.5 ? -TAU : TAU) * gPhase;
  return vec2(cos(a), sin(a));
}

float perlinNoise(vec2 x, ivec2 period, float seed) {
  ivec2 i = ivec2(floor(x));
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 i0, i1;
  latticeWrap(i, period, i0, i1);
  float a = dot(gradDir(i0, seed), f);
  float b = dot(gradDir(ivec2(i1.x, i0.y), seed), f - vec2(1.0, 0.0));
  float c = dot(gradDir(ivec2(i0.x, i1.y), seed), f - vec2(0.0, 1.0));
  float d = dot(gradDir(i1, seed), f - vec2(1.0, 1.0));
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
// metric: 0 euclidean, 1 manhattan, 2 chebyshev. One flat loop with a runtime bound (each cellPoint compiled once): the
// 3×3 cells for the two nearest points, then the 5×5 round the nearest point's cell (not the pixel's, or bisectors two
// cells off it are missed) for its border.
vec4 worleyNoise(vec2 x, ivec2 period, float jitter, int metric, float seed) {
  ivec2 ip = ivec2(floor(x));
  vec2 fp = fract(x);
  float F1 = 1e9, F2 = 1e9, md = 1e9;
  vec2 mr = vec2(0.0);
  ivec2 mc = ip;
  for (int e = 0; e < 34 * UNI_1; e++) {
    bool near = e < 9;
    int f = near ? e : e - 9;
    ivec2 g = near ? ivec2(f % 3 - 1, f / 3 - 1) : mc - ip + ivec2(f % 5 - 2, f / 5 - 2);
    vec2 o = 0.5 + (cellPoint(imod(ip + g, period), seed) - 0.5) * jitter;
    vec2 r = vec2(g) + o - fp;
    if (near) {
      float d = metric == 1 ? abs(r.x) + abs(r.y) : metric == 2 ? max(abs(r.x), abs(r.y)) : dot(r, r);
      if (d < F1) { F2 = F1; F1 = d; mr = r; mc = ip + g; }
      else if (d < F2) { F2 = d; }
    } else {
      vec2 dr = r - mr;
      if (dot(dr, dr) > 1e-6) md = min(md, dot(0.5 * (mr + r), normalize(dr)));
    }
  }
  if (metric == 0) { F1 = sqrt(F1); F2 = sqrt(F2); }
  return vec4(F1, F2, hashI(imod(mc, period), seed + 17.0), md);
}

// Perlin fBm (0..1) at one point (n = 1) or two (n = 2: xb with seed sb in .y): octaves of perlinNoise, each at twice the
// frequency (tiling: twice the period, so it still wraps), half the amplitude and seed + 31 of the last. One flat loop
// with a runtime bound over all n × octaves samples, so D3D compiles perlinNoise once per call site.
vec2 fbmPair(vec2 xa, vec2 xb, ivec2 period, int octaves, float sa, float sb, int n) {
  vec2 sum = vec2(0.0), x = xa;
  float amp = 1.0, norm = 0.0;
  ivec2 per = period;
  for (int e = 0; e < n * octaves * UNI_1; e++) {
    bool a = e < octaves;
    if (e == octaves) { x = xb; per = period; amp = 1.0; }
    float v = perlinNoise(x, per, (a ? sa : sb) + float(a ? e : e - octaves) * 31.0) * amp;
    sum += a ? vec2(v, 0.0) : vec2(0.0, v);
    if (a) norm += amp;
    amp *= 0.5;
    x *= 2.0;
    if (uTile) per *= 2;
  }
  return sum / max(norm, 1e-6);
}
float fbm(vec2 x, ivec2 period, int octaves, float seed) { return fbmPair(x, x, period, octaves, seed, seed, 1).x; }

// Domain warp: returns the displacement (in cells) to add to x. Periodic when period is.
vec2 warpOffset(vec2 x, ivec2 period, float seed) {
  return fbmPair(x, x + 17.3, period, 3, seed + 101.0, seed + 211.0, 2) - 0.5;
}

// 1D value noise (0..1, smoothstep between integer lattice values; not animated), repeating every period cells; key
// picks an independent row of values (one per board, crack, …). −1..1: 2 · valueNoise1 − 1.
float valueNoise1(float x, int period, ivec2 key, float seed) {
  float i = floor(x), f = x - i;
  int k = key.x * 4099 + key.y;
  int i0 = imod(int(i), period), i1 = i0 + 1 == period ? 0 : i0 + 1;
  return mix(hashI(ivec2(i0, k), seed), hashI(ivec2(i1, k), seed), f * f * (3.0 - 2.0 * f));
}
float valueNoise1(float x, float seed) { return valueNoise1(x, NO_PERIOD.x, ivec2(0), seed); }
`;
