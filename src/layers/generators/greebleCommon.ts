// Shared GLSL for the tech / greeble generators (FR7.2d): panels, vents, pipes, trim.
//
// Every greeble layer is an SDF generator with an `output` enum. Its "relief" output composes a complete
// multi-level height value (0..1) from all of the layer's elements — using the layer's own Shape params
// (bevel width + profile, anti-alias) for the main edges — and opts out of SDF handling (NO_SDF). The other
// outputs return the signed distance of one element class (panels, rivets, slots, clamps…) so the common
// bevel / profile / SDF-combine / clip params apply to it. Stacking several instances of the same layer with
// the same seed and different outputs gives one layout with several materials (e.g. relief → height,
// rivets → brass diffuse, lights → emissive).

/** GLSL helpers (prefixed `grb_`). Needs the SDF-layer uniforms u_aa / u_profile. */
export const GRB_GLSL = /* glsl */ `
float grb_cov(float d) { return coverage(d, u_aa); }

// 0 at a shape edge rising to 1 inside over w px, using the layer's bevel profile. A flat profile or zero
// width gives the anti-aliased (or hard) coverage instead.
float grb_rise(float d, float w) {
  if (w <= 0.0 || u_profile == 0) return coverage(d, u_aa);
  return profileCurve(u_profile, max(-d, 0.0) / w);
}

// Boxes from min / max corners (px).
float grb_box(vec2 p, vec2 lo, vec2 hi) { return sdBox(p - 0.5 * (lo + hi), 0.5 * (hi - lo)); }
float grb_rbox(vec2 p, vec2 lo, vec2 hi, float r) {
  vec2 b = max(0.5 * (hi - lo), vec2(0.0));
  return sdRoundBox(p - 0.5 * (lo + hi), b, vec4(max(r, 0.0)));
}

// Random 0..1 for key k of a feature id.
float grb_rand(uint id, uint k) { return u2f(pcg(id + k * 0x9E3779B9u)); }

// Centre for a feature s px wide whose leading edge is snapped to a pixel boundary (so whole-pixel sizes
// give crisp edges: odd sizes centre on a pixel centre, even sizes on a pixel corner).
float grb_snapC(float c, float s) { return floor(c - 0.5 * s + 0.5) + 0.5 * s; }

// Hemispherical dome height (0..1) at distance d from the centre of a dome of radius r.
float grb_dome(float d, float r) {
  float x = clamp(d / max(r, 1e-3), 0.0, 1.0);
  return sqrt(max(1.0 - x * x, 0.0));
}
`

/** Orientation enum shared by the strip-like layers. */
export const ORIENT: [string, string][] = [
  ['horizontal', 'Horizontal'],
  ['vertical', 'Vertical'],
]
