// GLSL helpers shared by the organic generators (marble, caustics, wood, scales, cracks) and by rock, grass and stone
// blocks. Every name is prefixed `org_`; each layer compiles its own copy (one shader per layer type).

export const ORG_GLSL = /* glsl */ `
// Fractal sum of value (kind 0) or Perlin (kind 1) noise, optionally billowed (|2n - 1|), lacunarity 2.
// Perlin, gain 0.5, no billow is fbm(); one rolled loop, so the organic shaders stay small and compile fast.
float org_noiseFbm(int kind, bool billow, vec2 x, ivec2 per, int oct, float gain, float seed) {
  float sum = 0.0, amp = 1.0, norm = 0.0;
  for (int o = 0; o < 8 * UNI_1; o++) {
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

// Line of core width w px around a feature at distance d px (d >= 0 on both sides), with a soft falloff of
// s px beyond the core. s = 0 gives a crisp, 1 px anti-aliased edge.
float org_line(float d, float w, float s) {
  return 1.0 - smoothstep(-0.5, 0.5 + max(s, 0.0), d - 0.5 * w);
}

// Power-weighted Voronoi (the cells of liquids and cracked plates): cell c's site, jittered inside its cell of a grid
// of cs px cells, and its weight (xy, z), from the hash of its wrapped id. wScale spreads the weights (cell sizes).
vec3 org_powerSite(ivec2 c, ivec2 per, vec2 cs, float jitter, float wScale, float seed) {
  vec3 h = hash3I(imod(c, per), seed);
  return vec3((vec2(c) + 0.5 + (h.xy - 0.5) * jitter) * cs, (h.z - 0.5) * wScale);
}

// The power bisector between the pixel's cell (site bs, weight bw) and another (s, w), sites L px apart:
// (pow_b - pow_a) / (2 |b - a|) is the signed px distance, positive on the pixel's side; clamped at 0.
float org_powerBisector(vec2 p, vec2 s, float w, vec2 bs, float bw, float L) {
  return max((dot2(p - s) - w - dot2(p - bs) + bw) / (2.0 * L), 0.0);
}
`;
