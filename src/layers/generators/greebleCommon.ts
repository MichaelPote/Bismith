// Shared GLSL for the tech / greeble generators (FR7.2d): panels, vents, pipes, trim.
//
// Every greeble layer is an SDF generator with an `output` enum. Its "relief" output composes a complete
// multi-level height value (0..1) from all of the layer's elements — using the layer's own Shape params
// (bevel width + profile, anti-alias) for the main edges — and opts out of SDF handling (NO_SDF). The other
// outputs return the signed distance of one element class (panels, rivets, slots, clamps…) so the common
// bevel / profile / mask-combine / limit params apply to it. Stacking several instances of the same layer with
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

// Hexagon of inradius r (flat top and bottom).
float grb_hexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

// A fastener head (FASTENER_HEADS: 0 dome, 1 Allen bolt, 2 Allen bolt sunk, 3 hex head, 4 hex head sunk, 5 slotted
// screw, 6 cross screw, 7 screw hole) at d from its centre — d already turned to the head's own angle — head radius r;
// the sunk kinds stand in a round counterbore pk deep (in head heights; the caller's choice). Returns x: height relative to the surface round it, in head heights (1
// the head's top; negative where sunk: the counterbore, a socket, slot or hole); y: how dark to paint it (sockets,
// slots, holes, the counterbore's floor); z: the footprint's distance (the head, or its counterbore), for shape outputs.
vec3 grb_fastener(int kind, vec2 d, float r, float pk) {
  r = max(r, 0.5);
  // The sunk kinds: the plain head (Allen 1, hex 2 below) in its counterbore; the rest none.
  if (kind == 2 || kind == 4) { kind = kind == 2 ? 1 : 3; pk = max(pk, 0.0); }
  else pk = 0.0;
  kind = kind == 3 ? 2 : kind >= 5 ? kind - 2 : kind;   // to 0 dome, 1 Allen, 2 hex, 3 slotted, 4 cross, 5 hole
  float l = length(d);
  float e = max(0.6, 0.12 * r);   // edge softness
  if (kind == 5) {
    // A screw hole: walls sloping over e to a dark floor.
    float h = 1.0 - smoothstep(r - e, r + 0.5, l);
    return vec3(-h, h, l - r);
  }
  float pr = 1.55 * r;
  float pocket = pk > 0.0 ? 1.0 - smoothstep(pr - 1.0, pr, l) : 0.0;
  float head, dark = 0.0;
  if (kind == 2) {
    // A hex head: steep flats, its corners chamfered towards a flat top.
    float side = smoothstep(0.0, 1.0, -grb_hexagon(d, 0.87 * r) / max(0.2 * r, 0.7));
    head = side * mix(0.75, 1.0, clamp((1.0 * r - l) / max(0.3 * r, 0.5), 0.0, 1.0));
  } else if (kind == 1) {
    // An Allen bolt: a flat cap with a rounded rim and a hex socket sunk deep in it.
    head = smoothstep(0.0, 1.0, (0.95 * r - l) / max(0.18 * r, 0.7));
    float sock = 1.0 - smoothstep(-0.35, 0.35, grb_hexagon(d, max(0.5 * r, 1.0)));
    head -= 1.0 * sock;
    dark = sock;
  } else if (kind >= 3) {
    // A pan-head screw, a slot (or two, crossed) across it.
    float x = clamp(l / r, 0.0, 1.0);
    head = 0.85 * sqrt(max(1.0 - x * x * x * x, 0.0));
    float gw = max(0.5, 0.11 * r);
    float g = 1.0 - smoothstep(gw - 0.5, gw + 0.5, abs(d.y));
    if (kind == 4) g = max(g, 1.0 - smoothstep(gw - 0.5, gw + 0.5, abs(d.x)));
    g *= 1.0 - smoothstep(0.75 * r, 0.8 * r, l);
    head *= 1.0 - 0.7 * g;
    dark = g;
  } else {
    head = grb_dome(l, r);
  }
  // In a counterbore the head rises from its floor; outside the pocket's ring the floor shows, darker.
  float x = -pk * pocket + (1.0 + pk) * head;
  dark = max(dark, 0.5 * pocket * (1.0 - smoothstep(0.0, 0.2, head)));
  // (The footprint: the counterbore, the hexagon itself, or the round head.)
  return vec3(x, dark, pk > 0.0 ? l - pr : kind == 2 ? grb_hexagon(d, 0.87 * r) : l - r);
}

// ---- Bevel aspect (Shaping › Edge) on the shape outputs. The wrapper takes a bevel's width from the distance's
// direction, which flips on the mitre where two straight edges meet: the bevel steps there. So the shape outputs also
// pass their distance in the space the aspect stretches (GenOut.bdist, px of Bevel; GLSL_BEVEL), built from the same
// pieces as the shape's own. The greebles are laid out along the screen's axes (some swapped), so that stretch is a
// scale along each local axis: k (Bevel ÷ the bevel's width across that axis). Only while the aspect isn't 1, which
// keeps the plain distance.
bool grb_bevOn() { return bevelAspectOn(); }
// The stretch along the local axes (swap: local x runs along the screen's y).
vec2 grb_bevK(bool swap) { vec2 k = u_bevel / max(bevelWidths(), vec2(1e-6)); return swap ? k.yx : k; }
// A box with corners rounded by r (half size b round d's origin), stretched by k: the stretch is symmetric about the
// box's axes, so one quadrant's side, top and corner arc give the distance (exact; the arc as chords, bevelArc2),
// signed by the box's own distance. r = 0: still a box, exact as one; r = the half width: a stadium, or a circle.
float grb_bevRBox(vec2 d, vec2 b, float r, vec2 k) {
  b = max(b, vec2(0.0));
  r = clamp(r, 0.0, min(b.x, b.y));
  if (r <= 0.0) return sdBox(d * k, b * k);
  vec2 ps = abs(d) * k, c = b - r;
  float d2 = min(bevelSeg2(ps, vec2(0.0, b.y) * k, vec2(c.x, b.y) * k), bevelSeg2(ps, vec2(b.x, 0.0) * k, vec2(b.x, c.y) * k));
  d2 = min(d2, bevelArc2(ps, mat2(k.x, 0.0, 0.0, k.y), c, r, vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(0.70710678)));
  return sdRoundBox(d, b, vec4(r)) < 0.0 ? -sqrt(d2) : sqrt(d2);
}
`;

/**
 * Fastener heads shared by the greeble generators (Greebles' rivets, Vents' frame fasteners; Trim's elements carry the
 * same kinds). The order is the GLSL kind of grb_fastener: keep it.
 */
export const FASTENER_HEADS: [string, string, string][] = [
	['dome', 'Dome', 'a round rivet head'],
	['allen', 'Allen bolt', 'a round cap head with a hex socket sunk in it, standing on the surface'],
	['allen_sunk', 'Allen bolt (sunk)', 'an Allen bolt standing in a round counterbore'],
	['hex', 'Hex head', 'a hex head, its corners chamfered, standing on the surface'],
	['hex_sunk', 'Hex head (sunk)', 'a hex head standing in a round counterbore'],
	['slotted', 'Slotted screw', 'a pan head with a slot across it'],
	['cross', 'Cross screw', 'a pan head with a cross slot'],
	['hole', 'Screw hole', 'a small sunk hole']
];

/** Orientation enum shared by the strip-like layers. */
export const ORIENT: [string, string][] = [
	['horizontal', 'Horizontal'],
	['vertical', 'Vertical']
];
