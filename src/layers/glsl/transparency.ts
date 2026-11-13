// Transparent media over the layers below — shared by Glass (a filter) and Ice (a generator), and by the generator
// wrapper's transmitted light (gGenTransmit): the background seen through a refracting surface, tinted by the path
// through the medium, its rims reflecting at grazing angles, the light it focuses, and the split of the result into
// lit albedo and transmitted light. Part of MATERIAL_PRELUDE (after GLSL_COMMON: sampleT, wrapping).

export const GLSL_TRANSPARENCY = /* glsl */ `
// The normal of a surface of slope g (height px per px).
vec3 slopeNormal(vec2 g) { return normalize(vec3(-g, 1.0)); }
// How far the view through a surface of normal n is bent (px): out along its tilt × strength, so a dome magnifies in
// its middle and squeezes towards its rims.
vec2 lensShift(vec3 n, float strength) { return n.xy * strength; }
// What the layers below show at px + shift (linear colour, bilinear).
vec3 seenThrough(vec2 px, vec2 shift) { return sampleT(tAlbedo, px + shift).rgb; }
// Light through a tinted medium: amount 0 = clear, 1 = multiplied by the tint.
vec3 absorbTint(vec3 c, vec3 tint, float amount) { return c * mix(vec3(1.0), tint, clamp(amount, 0.0, 1.0)); }
// How obliquely a surface of normal n is seen: 0 face-on … 1 edge-on (a dome's rims).
float grazing(vec3 n) { return clamp(1.0 - n.z, 0.0, 1.0); }
// The share a rim reflects instead of showing the background (Fresnel-like), at strength k.
float rimFresnel(float graze, float k) { return clamp(k * pow(graze, 1.5) * 1.6, 0.0, 1.0); }
// The bright line where a dome focuses light from screen direction L: on its far side, just inside the rim.
float innerGlint(vec3 n, vec2 L, float graze) {
  vec2 nd = n.xy / max(length(n.xy), 1e-4);
  return smoothstep(0.5, 0.9, dot(nd, -L)) * smoothstep(0.08, 0.3, graze) * (1.0 - smoothstep(0.55, 0.8, graze));
}
// The level a clear fill settles at over the relief below (Ice's Fill hollows, Snow's floor ice), and its slope: from
// the relief at px and on rings of 6 (as many as rings) round it (radii rOut, rOut / 2, …, each turned half a step on the last),
// their mean raised towards their highest by toMax — the highest a mean weighted by e^(h / tau) (tau in the surface's
// units), so the level stays smooth where a hard maximum would kink — and the same a pixel across and up, in one flat
// loop. Returns (level, its slope per px) in the surface's units: a slope the view can be bent by without the 2 × 2
// steps of a screen-space derivative.
vec3 fillLevel(vec2 px, float rOut, int rings, float toMax, float tau) {
  int n = 1 + 6 * rings;
  vec3 m = vec3(-1e9), sw = vec3(0.0), swh = vec3(0.0), sh = vec3(0.0);
  for (int e = 0; e < 3 * n * UNI_1; e++) {
    int k = e / n, i = e - k * n;
    int ring = max(i - 1, 0) / 6;
    float a = (float(i - 1) + 0.5 * float(ring)) * TAU / 6.0;
    vec2 o = i == 0 ? vec2(0.0) : rOut * exp2(-float(ring)) * vec2(cos(a), sin(a));
    float h = sampleT(tSurface, px + o + vec2(k == 1 ? 1.0 : 0.0, k == 2 ? 1.0 : 0.0)).r;
    vec3 sel = vec3(equal(ivec3(k), ivec3(0, 1, 2)));
    float mk = dot(m, sel);
    float mn = max(mk, h);
    // (A running weighted mean: the sums so far rescaled to the new highest, then this sample's weight.)
    float sc = exp((mk - mn) / tau), wh = exp((h - mn) / tau);
    sw = mix(sw, sw * sc + wh, sel);
    swh = mix(swh, swh * sc + wh * h, sel);
    m = mix(m, vec3(mn), sel);
    sh += sel * h;
  }
  vec3 lv = mix(sh / float(n), swh / max(sw, vec3(1e-6)), toMax);
  return vec3(lv.x, lv.yz - lv.x);
}
// Lays colour col (linear) over albedo A and emission E with weight m, its share tr as transmitted light: light that
// passes through the medium isn't shaded by its surface, so it is carried as emission and only the rest stays albedo,
// lit like a surface.
void layTransparent(inout vec3 A, inout vec3 E, vec3 col, float tr, float m) {
  A = mix(A, col * (1.0 - tr), m);
  E += m * col * tr;
}
`;
