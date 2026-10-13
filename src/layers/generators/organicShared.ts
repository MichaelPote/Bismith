// GLSL helpers shared by the organic generators (marble, caustics, wood, scales, cracks). Every name is
// prefixed `org_`; each layer compiles its own copy (one shader per layer type).

/** Value of GenOut.sdf meaning "no distance for this pixel" (the wrapper's NO_SDF is -9e4). */
export const ORG_NO_SDF = '-1e5'

export const ORG_GLSL = /* glsl */ `
// 1, read from a uniform: loop bounds written with it can't be unrolled. D3D (Chrome's default backend on Windows)
// unrolls constant loops and inlines every call, so each unrolled pass copies the whole body: compiles take
// seconds. A runtime bound keeps one copy.
#define ORG_1 (uRes.x > 0.0 ? 1 : 0)

float org_dot2(vec2 v) { return dot(v, v); }

// Lattice period for a cellsFor() cell count: whole cells when tiling, effectively infinite otherwise.
ivec2 org_per(vec2 cells) { return uTile ? ivec2(cells + 0.5) : NO_PERIOD; }

// Fractal sum of value (kind 0) or Perlin (kind 1) noise, optionally billowed (|2n - 1|), lacunarity 2.
// Same results as fractalNoise() for those modes, but without its generic dispatch (which inlines Worley
// at every call site), so the organic shaders stay small and compile fast.
float org_noiseFbm(int kind, bool billow, vec2 x, ivec2 per, int oct, float gain, float seed) {
  float sum = 0.0, amp = 1.0, norm = 0.0;
  for (int o = 0; o < 8 * ORG_1; o++) {
    if (o >= oct) break;
    float s = seed + float(o) * 31.0;
    float n = kind == 0 ? valueNoise(x, per, s) : perlinNoise(x, per, s);
    if (billow) n = abs(2.0 * n - 1.0);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    x *= 2.0;
    if (uTile) per *= 2;
  }
  return sum / max(norm, 1e-6);
}

// Tileable fBm (Perlin) over normalised texture coords u (0..1) with the given cell counts.
float org_fbm(vec2 u, vec2 cells, int oct, float seed) {
  return org_noiseFbm(1, false, u * cells, org_per(cells), oct, 0.5, seed);
}

int org_gcd(int a, int b) {
  a = abs(a); b = abs(b);
  for (int i = 0; i < 64; i++) { if (b == 0) break; int t = a % b; a = b; b = t; }
  return max(a, 1);
}

// Line of core width w px around a feature at distance d px (d >= 0 on both sides), with a soft falloff of
// s px beyond the core. s = 0 gives a crisp, 1 px anti-aliased edge.
float org_line(float d, float w, float s) {
  return 1.0 - smoothstep(-0.5, 0.5 + max(s, 0.0), d - 0.5 * w);
}

// Keep part of a mask where the noise n (0..1) is high: amount 0 keeps everything, 1 removes everything.
float org_breakup(float n, float amount) {
  float c = clamp((n - 0.5) * 2.5 + 0.5, 0.0, 1.0);
  return smoothstep(amount * 1.3 - 0.3, amount * 1.3, c);
}

// Wave vector (cycles per px, GL space) for bands that run at deg clockwise from horizontal on screen,
// count bands per texture width. Snapped to whole cycles per axis when tiling (seamless); g = number of
// distinct bands per tile (for per-band randoms).
vec2 org_waveK(float count, float deg, out int g) {
  float a = radians(deg);
  vec2 k = vec2(sin(a), cos(a)) * count / uRes.x;
  g = 1 << 20;
  if (uTile) {
    vec2 cyc = floor(k * uRes + 0.5);
    if (cyc.x == 0.0 && cyc.y == 0.0) cyc.y = 1.0;
    k = cyc / uRes;
    g = org_gcd(int(cyc.x), int(cyc.y));
  }
  return k;
}

// Power-weighted Voronoi cell boundary distance (px) — the cells of liquids and cracked plates.
// Sites jitter inside a cells grid; weights vary the cell sizes. Returns x = distance to the cell border
// rounded by a soft minimum over the bisectors (k px; junctions thicken, cells become blobs), y = exact
// distance to the nearest bisector, z = per-cell random, w = F1 / F2 (distance to the cell's site over the
// distance to the nearest other site: 0 at the site, ~1 at the border; its level sets are round, Apollonius
// circles, so it gives blob-shaped interiors).
vec4 org_cellDist(vec2 p, vec2 cells, float jitter, float sizeVar, float k, float seed) {
  ivec2 per = org_per(cells);
  vec2 cs = uRes / cells;
  ivec2 ip = ivec2(floor(p / cs));
  float wScale = sizeVar * cs.x * cs.y * 0.45;
  float best = 1e20;
  vec2 bs = p;
  float bw = 0.0;
  ivec2 bc = ip;
  float m = 1e9;
  float acc = 0.0;
  float f2 = 1e9;
  float kk = max(k, 0.05);
  // One flat loop (see ORG_1): the 5×5 cells around p for the nearest site, then the 5×5 around that site.
  for (int e = 0; e < 50 * ORG_1; e++) {
    bool near = e < 25;
    int f = near ? e : e - 25;
    ivec2 g = ivec2(f % 5 - 2, f / 5 - 2);
    if (!near && g == ivec2(0)) continue;
    ivec2 c = (near ? ip : bc) + g;
    vec3 h = hash3I(imod(c, per), seed);
    vec2 s = (vec2(c) + 0.5 + (h.xy - 0.5) * jitter) * cs;
    float w = (h.z - 0.5) * wScale;
    if (near) {
      float pd = org_dot2(s - p) - w;
      if (pd < best) { best = pd; bs = s; bw = w; bc = c; }
      continue;
    }
    float L = length(s - bs);
    if (L < 1e-4) continue;
    f2 = min(f2, length(p - s));
    // Power bisector: (pow_b - pow_a) / (2 |b - a|) is the signed px distance, positive on a's side.
    float d = max((org_dot2(p - s) - w - org_dot2(p - bs) + bw) / (2.0 * L), 0.0);
    // Running log-sum-exp soft minimum.
    if (d < m) { acc = acc * exp((d - m) / kk) + 1.0; m = d; }
    else acc += exp((m - d) / kk);
  }
  float dr = k > 0.0 ? m - kk * log(max(acc, 1.0)) : m;
  return vec4(dr, m, hashI(imod(bc, per), seed + 17.0), length(p - bs) / max(f2, 1e-4));
}
`

/** Extra helpers for SDF layers only (they read the Shape-group uniforms u_bevel / u_profile). */
export const ORG_GLSL_SDF = /* glsl */ `
// Bevel profile from a signed distance (px, negative inside) using the layer's own Shape params, for
// generators that fold the shape into their value instead of handing the wrapper an SDF.
float org_edgeProfile(float d) {
  if (u_bevel <= 0.0 || u_profile == 0) return 1.0;
  return profileCurve(u_profile, max(-d, 0.0) / u_bevel);
}
`
