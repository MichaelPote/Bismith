// Shared GLSL used by every pass: hashing, wrap-aware texel access, coordinate helpers, colour maths,
// gradient ramps, blend modes, bevel profiles and SDF combine operators.
//
// Conventions (docs/architecture.md §4): shaders work in GL pixel space (origin bottom-left, y up,
// pixel centres at .5). `uRes` is the texture size in px and `uTile` says whether to wrap.

import { MAX_GRADIENT_STOPS } from '@/core/params';

export const GLSL_HEADER = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** sRGB ↔ linear and linear → OKLab (also used outside the layer passes: the tiling analysis, src/tiling/gpu.ts). */
export const GLSL_COLOUR = /* glsl */ `
vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 linearToOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = pow(max(l, 0.0), 1.0 / 3.0); m = pow(max(m, 0.0), 1.0 / 3.0); s = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
`;

export const GLSL_COMMON = /* glsl */ `
#define PI 3.14159265358979
#define TAU 6.28318530717959

uniform vec2 uRes;
uniform bool uTile;

// 1, read from a uniform: a loop bound \`n * UNI_1\` keeps D3D from unrolling the loop (docs/shader-compilation.md).
// No ?: — ANGLE rewrites a loop whose condition has one.
#define UNI_1 int(uRes.x > 0.0)

// ---------------------------------------------------------------- hashing (PCG)
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
uint pcg2(uvec2 v) { return pcg(v.x ^ pcg(v.y)); }
uint pcg3(uvec3 v) { return pcg(v.x ^ pcg(v.y ^ pcg(v.z))); }
float u2f(uint h) { return float(h) * (1.0 / 4294967296.0); }

float hashI(ivec2 c, float seed) { return u2f(pcg3(uvec3(uint(c.x), uint(c.y), uint(seed)))); }
vec2 hash2I(ivec2 c, float seed) {
  uint h = pcg3(uvec3(uint(c.x), uint(c.y), uint(seed)));
  return vec2(u2f(h), u2f(pcg(h)));
}
vec3 hash3I(ivec2 c, float seed) {
  uint h = pcg3(uvec3(uint(c.x), uint(c.y), uint(seed)));
  uint h2 = pcg(h);
  return vec3(u2f(h), u2f(h2), u2f(pcg(h2)));
}

// ---------------------------------------------------------------- wrapping & texel access
// Euclidean modulo (m > 0). GLSL ES leaves % undefined for a negative operand, so a is first shifted up by a multiple
// of m to be non-negative — with ((a % m) + m) % m, renders could differ from run to run.
ivec2 imod(ivec2 a, ivec2 m) { return (a + m * (1 + abs(a) / m)) % m; }
int imod(int a, int m) { return (a + m * (1 + abs(a) / m)) % m; }
// A cell index wrapped into n cells when tiling, unchanged otherwise.
ivec2 wrapCell(ivec2 c, ivec2 n) { return uTile ? imod(c, n) : c; }
int wrapCell(int c, int n) { return uTile ? imod(c, n) : c; }
// Greatest common divisor of |a| and |b| (at least 1), in a loop D3D keeps rolled.
int igcd(int a, int b) {
  a = abs(a); b = abs(b);
  for (int i = 0; i < 64 * UNI_1; i++) { if (b == 0) break; int t = a % b; a = b; b = t; }
  return max(a, 1);
}
vec2 fmod2(vec2 a, vec2 m) { return a - m * floor(a / m); }

ivec2 texelCoord(ivec2 c) {
  ivec2 r = ivec2(uRes);
  return uTile ? imod(c, r) : clamp(c, ivec2(0), r - 1);
}
vec4 fetchT(sampler2D t, ivec2 c) { return texelFetch(t, texelCoord(c), 0); }

// Bilinear sample at a pixel-space position (centres at .5), wrap- or clamp-aware.
vec4 sampleT(sampler2D t, vec2 px) {
  vec2 q = px - 0.5;
  vec2 f = fract(q);
  ivec2 i = ivec2(floor(q));
  vec4 a = fetchT(t, i);
  vec4 b = fetchT(t, i + ivec2(1, 0));
  vec4 c = fetchT(t, i + ivec2(0, 1));
  vec4 d = fetchT(t, i + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Shortest offset between two pixel positions (toroidal when tiling).
vec2 wrapDelta(vec2 d) { return uTile ? d - uRes * floor(d / uRes + 0.5) : d; }

// Order-independent key of a cell pair (wrapped ids), so both cells agree on the pair's randoms; aLo: a sorts first.
ivec2 pairKey(ivec2 a, ivec2 b, out bool aLo) {
  aLo = a.x < b.x || (a.x == b.x && a.y < b.y);
  return aLo ? a * 7919 + b : b * 7919 + a;
}

// ---------------------------------------------------------------- Voronoi search
// A Voronoi diagram's cells, visited in one flat loop of 9 + 25 (e: the iteration): first the 3 × 3 cells round ip (the
// pixel's) for the nearest site, then the 5 × 5 round that nearest cell, which hold every neighbour it shares an edge
// with. vorCell is the cell to visit at e; vorSite a cell's site in cells, jittered from its middle by jit × (h − 0.5),
// h its random point (0..1).
ivec2 vorCell(int e, ivec2 ip, ivec2 nearest) {
  return e < 9 ? ip + ivec2(e % 3, e / 3) - 1 : nearest + ivec2((e - 9) % 5, (e - 9) / 5) - 2;
}
vec2 vorSite(ivec2 c, vec2 h, float jit) { return vec2(c) + 0.5 + (h - 0.5) * jit; }

// ---------------------------------------------------------------- coordinates
// User positions are fractions 0..1 with y DOWN; convert to GL pixel space.
vec2 userPx(vec2 u) { return vec2(u.x * uRes.x, (1.0 - u.y) * uRes.y); }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
// Rotate a vector clockwise on screen by deg (GL y is up, so clockwise is a negative angle).
vec2 rotCW(vec2 v, float deg) { return rot2(-radians(deg)) * v; }
// Undo a clockwise screen rotation (map world offset into a shape's local frame).
vec2 unrotCW(vec2 v, float deg) { return rot2(radians(deg)) * v; }

// Cells across the texture for a pattern: scale = cells across the width, y follows the aspect ratio;
// stretch > 1 elongates features horizontally. Integer per axis when tiling.
vec2 cellsFor(float scale, float stretch) {
  vec2 c = vec2(scale / max(stretch, 1e-3), scale * uRes.y / uRes.x);
  return uTile ? max(vec2(1.0), floor(c + 0.5)) : max(c, vec2(1e-3));
}

// ---------------------------------------------------------------- repeat grids (Column / Row spacing)
// The step between a grid's instances: the span over the count, plus the spacing as a share of the texture size (1 = a
// whole width more). Never quite 0: at −1 the instances stack up.
float repPitch(float span, int n, float spacing, float size) { return max(span / float(max(n, 1)) + spacing * size, 1e-3); }

// A grid of n instances 'pitch' apart, centred on g (instance i at g + (i − (n − 1) / 2) · pitch, per axis). With wrap
// the whole grid repeats every 'period' px (the texture, when tiling), so instances pushed past an edge come round the
// other side. The candidates are the instances centred in [lo, hi] (at most 25 pitches of it, round its middle); per
// axis:
//  - in order along the axis (no wrap, or the row fits in one period): a run of consecutive slots — instance c of copy
//    k is slot k·n + c — with at least the nearest instance either side of the window's middle (across a gap at the
//    seam, or the end instances for a pixel beyond the grid);
//  - otherwise (spacing pushes the row past a period, so its copies overlap) copy by copy, as many instances of each
//    as fit in the window (at most n, the window slid into the row where it overhangs an end), at most 9 copies.
// Both axes at once, so a loop over the candidates holds one copy of the arithmetic.
struct RepGrid { ivec2 n; vec2 pitch; vec2 first; vec2 period; vec2 lo; bvec2 run; ivec2 s0; ivec2 k0; ivec2 m; ivec2 cnt; };
// The first slot at or after x (in order along the axis).
ivec2 repSlot(RepGrid a, vec2 x, bool wrap) {
  vec2 k = wrap ? floor((x - a.first) / a.period) : vec2(0.0);
  return ivec2(k) * a.n + clamp(ivec2(ceil((x - a.first - k * a.period) / a.pitch)), ivec2(0), a.n);
}
RepGrid repGrid(ivec2 n, vec2 pitch, vec2 g, vec2 period, bool wrap, vec2 lo, vec2 hi) {
  RepGrid a;
  a.n = max(n, ivec2(1));
  a.pitch = pitch;
  a.first = g - 0.5 * vec2(a.n - 1) * pitch;
  a.period = period;
  vec2 mid = 0.5 * (lo + hi), hw = min(0.5 * (hi - lo), 12.0 * pitch);
  a.lo = mid - hw;
  a.run = bvec2(!wrap || float(a.n.x) * pitch.x <= 1.0001 * period.x, !wrap || float(a.n.y) * pitch.y <= 1.0001 * period.y);
  ivec2 sm = repSlot(a, mid, wrap);
  ivec2 s0 = min(repSlot(a, a.lo, wrap), sm - 1), s1 = max(repSlot(a, mid + hw, wrap) - 1, sm);
  if (!wrap) { s0 = clamp(s0, ivec2(0), a.n - 1); s1 = clamp(s1, ivec2(0), a.n - 1); }
  a.s0 = s0;
  a.m = min(ivec2(floor(2.0 * hw / pitch)) + 1, a.n);
  a.k0 = ivec2(ceil((a.lo - a.first - vec2(a.n - 1) * pitch) / period));
  ivec2 k1 = ivec2(floor((mid + hw - a.first) / period));
  ivec2 kc = (a.k0 + k1) / 2 - 4;
  a.k0 = ivec2(k1.x - a.k0.x >= 9 ? kc.x : a.k0.x, k1.y - a.k0.y >= 9 ? kc.y : a.k0.y);
  ivec2 laps = clamp(k1 - a.k0 + 1, 1, 9);
  a.cnt = ivec2(a.run.x ? s1.x - s0.x + 1 : laps.x * a.m.x, a.run.y ? s1.y - s0.y + 1 : laps.y * a.m.y);
  return a;
}
int repCount(RepGrid a) { return a.cnt.x * a.cnt.y; }
// Candidate e (0 ≤ e < repCount), each axis counted from the middle of the window outwards (the nearest instances
// first, for a search that prunes by distance). c: the instance (0 … n − 1, the same on every copy), pos: its centre,
// near the window (unwrapped).
void repAt(RepGrid a, int e, out ivec2 c, out vec2 pos) {
  ivec2 i = ivec2(e % a.cnt.x, e / a.cnt.x), odd = i & 1;
  ivec2 j = (a.cnt - 1) / 2 + odd * ((i + 1) / 2) - (1 - odd) * (i / 2);
  ivec2 s = a.s0 + j;
  ivec2 kr = ivec2(floor(vec2(s) / vec2(a.n)));
  ivec2 kl = a.k0 + j / a.m;
  ivec2 k = ivec2(a.run.x ? kr.x : kl.x, a.run.y ? kr.y : kl.y);
  ivec2 cl = clamp(ivec2(ceil((a.lo - a.first - vec2(kl) * a.period) / a.pitch)), ivec2(0), a.n - a.m) + j % a.m;
  c = ivec2(a.run.x ? s.x - kr.x * a.n.x : cl.x, a.run.y ? s.y - kr.y * a.n.y : cl.y);
  pos = a.first + vec2(k) * a.period + vec2(c) * a.pitch;
}

// ---------------------------------------------------------------- colour
${GLSL_COLOUR}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Gradient ramp: stops are (sRGB rgb, position), sorted by position. Returns sRGB.
vec3 gradientLookup(vec4 stops[${MAX_GRADIENT_STOPS}], int count, float t) {
  if (count <= 1) return stops[0].rgb;
  t = clamp(t, 0.0, 1.0);
  if (t <= stops[0].a) return stops[0].rgb;
  for (int i = 1; i < ${MAX_GRADIENT_STOPS}; i++) {
    if (i >= count) break;
    if (t <= stops[i].a) {
      float span = max(stops[i].a - stops[i - 1].a, 1e-6);
      return mix(stops[i - 1].rgb, stops[i].rgb, (t - stops[i - 1].a) / span);
    }
  }
  return stops[count - 1].rgb;
}

// The ramp with its stops' opacities (four to a vec4): (sRGB rgb, opacity). Colours mix weighted by their opacity, so a
// colour fading out keeps its hue rather than turning towards a transparent stop's.
vec4 gradientLookupA(vec4 stops[${MAX_GRADIENT_STOPS}], vec4 alpha[${MAX_GRADIENT_STOPS / 4}], int count, float t) {
  int i1 = 0;
  float f = 0.0;
  t = clamp(t, 0.0, 1.0);
  if (count > 1 && t > stops[0].a) {
    i1 = count - 1;
    for (int i = 1; i < ${MAX_GRADIENT_STOPS}; i++) {
      if (i >= count) break;
      if (t <= stops[i].a) { i1 = i; f = (t - stops[i - 1].a) / max(stops[i].a - stops[i - 1].a, 1e-6); break; }
    }
  }
  int i0 = max(i1 - (f > 0.0 ? 1 : 0), 0);
  float a0 = alpha[i0 / 4][i0 - 4 * (i0 / 4)], a1 = alpha[i1 / 4][i1 - 4 * (i1 / 4)];
  float a = mix(a0, a1, f);
  vec3 c = mix(stops[i0].rgb * a0, stops[i1].rgb * a1, f);
  return vec4(a > 1e-5 ? c / a : mix(stops[i0].rgb, stops[i1].rgb, f), a);
}

// ---------------------------------------------------------------- blend modes (sRGB space, 0..1)
// 0 normal, 1 multiply, 2 screen, 3 overlay, 4 add, 5 subtract, 6 darken, 7 lighten, 8 soft light
vec3 blendMode(int mode, vec3 b, vec3 t) {
  if (mode == 1) return b * t;
  if (mode == 2) return 1.0 - (1.0 - b) * (1.0 - t);
  if (mode == 3) return mix(2.0 * b * t, 1.0 - 2.0 * (1.0 - b) * (1.0 - t), step(0.5, b));
  if (mode == 4) return min(b + t, vec3(1.0));
  if (mode == 5) return max(b - t, vec3(0.0));
  if (mode == 6) return min(b, t);
  if (mode == 7) return max(b, t);
  if (mode == 8) return mix(b - (1.0 - 2.0 * t) * b * (1.0 - b),
                            b + (2.0 * t - 1.0) * (sqrt(b) - b), step(0.5, t));
  return t;
}

// ---------------------------------------------------------------- bevel profiles
// x = 0 at the shape edge → 1 at the bevel's inner limit.
// 0 flat, 1 linear, 2 smooth, 3 round (quarter circle, convex), 4 cove (concave), 5 ridge, 6 steps
#ifdef BEVEL_CURVE
float bevelCurve(float x);  // defined after the layer's uniforms (custom profile curve)
#endif
float profileCurve(int type, float x) {
  x = clamp(x, 0.0, 1.0);
#ifdef BEVEL_CURVE
  if (type == 7) return bevelCurve(x);
#endif
  if (type == 0) return x > 0.0 ? 1.0 : 0.0;
  if (type == 1) return x;
  if (type == 2) return x * x * (3.0 - 2.0 * x);
  if (type == 3) return sqrt(max(0.0, 1.0 - (1.0 - x) * (1.0 - x)));
  if (type == 4) return 1.0 - sqrt(max(0.0, 1.0 - x * x));
  if (type == 5) return 1.0 - abs(2.0 * x - 1.0);
  if (type == 6) return floor(x * 3.999) / 3.0;
  return x;
}

// ---------------------------------------------------------------- smooth min / max
// Polynomial smooth minimum / maximum over a blend width k (k <= 0: plain min / max). sminK is how far the minimum dips
// below min(a, b) (at most k / 4, where a = b).
float sminK(float a, float b, float k) {
  float h = k > 0.0 ? max(k - abs(a - b), 0.0) / k : 0.0;
  return h * h * k * 0.25;
}
float smin(float a, float b, float k) { return min(a, b) - sminK(a, b, k); }
float smax(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0);
  return max(a, b) + (k > 0.0 ? h * h / (4.0 * k) : 0.0);
}

// ---------------------------------------------------------------- SDF operators
// a = the mask's existing distance, b = this layer's distance. Negative inside.
// 0 none (ignore a), 1 replace, 2 union, 3 subtract (cut b out of a), 4 intersect,
// 5 smooth union, 6 smooth subtract, 7 smooth intersect
float sdfCombine(int op, float a, float b, float k) {
  k = max(k, 1e-4);
  if (op == 2) return min(a, b);
  if (op == 3) return max(a, -b);
  if (op == 4) return max(a, b);
  if (op == 5) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
  if (op == 6) { float h = clamp(0.5 - 0.5 * (a + b) / k, 0.0, 1.0); return mix(a, -b, h) + k * h * (1.0 - h); }
  if (op == 7) { float h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }
  return b;
}

// Anti-aliased coverage from a signed distance in px.
float coverage(float d, bool aa) { return aa ? clamp(0.5 - d, 0.0, 1.0) : (d <= 0.0 ? 1.0 : 0.0); }

// Height modes (commonParams HEIGHT_MODES order): add, subtract, max, min, replace, multiply — v meeting height h.
float heightCombine(int mode, float h, float v) {
  return mode == 0 ? h + v : mode == 1 ? h - v : mode == 2 ? max(h, v) : mode == 3 ? min(h, v) : mode == 4 ? v : h * v;
}

// Separable Gaussian of σ px: taps either side (3σ, at most cap) and k, the tap at offset i weighing exp(i² k).
int gaussTaps(float sigma, int cap) { return min(int(ceil(sigma * 3.0)), cap); }
float gaussK(float sigma) { return -0.5 / max(sigma * sigma, 1e-6); }
`;

/** Fixed vertex shader for every full-screen pass: one oversized triangle. */
export const FULLSCREEN_VERT = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
