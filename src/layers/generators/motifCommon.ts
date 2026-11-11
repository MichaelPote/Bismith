// Shared by the motif family (motif.ts: Truchet / Lines; motifRadial.ts: Rosette, Glyph): the layer seed, the bevel
// aspect toolkit every motif's distances go through, and the family's starting material.

/** Every motif starts as raised gold: a flat diffuse, a round bevel, some height. */
export const MOTIF_DEFAULTS = {
	h_on: true,
	h_amount: 0.4,
	bevel: 1,
	profile: 'round',
	dif_on: true,
	dif_src: 'flat',
	dif_grad: { stops: [{ pos: 0, color: '#c8a85a' }] }
};

/** The Bevel aspect toolkit shared by the motif layers (gMotStr, gMotF, mot_bl, mot_bandS, mot_segS, mot_discS). */
export const GLSL_MOT_COMMON = /* glsl */ `
// Bevel aspect (GLSL_BEVEL; all motif layers are SDF layers): set, the distances are measured in the space the aspect
// stretches instead (px of Bevel), so the bevels meet in clean mitres rather than stepping where the distance's
// direction turns at a corner. gMotF: the local frame's axes on screen (columns). mot_bl: a distance d across an edge
// (or from a curve) with local normal n — one piece's share of a bevel, the same over its whole length.
#ifdef BEVEL_ASPECT
bool gMotStr = false;
#define MOT_SET_STR(v) gMotStr = (v)
#else
const bool gMotStr = false;   // (a constant, so the shader variant without Bevel aspect compiles none of its code)
#define MOT_SET_STR(v)
#endif
mat2 gMotF = mat2(1.0);
float mot_bl(float d, vec2 n) { return bevelLine(d, gMotF * n); }
// A band of half width w round a centre line: dist from its nearest point (direction n), its sides across nl at
// lat. Along the line both agree; past a round end the cap (across its own direction) goes no deeper than the sides
// would there, so a cap that runs on into the next piece can't poke through that piece's bevel (taken across the
// cap's direction, the depth along the line overshoots the stretched distance).
float mot_bandS(float dist, vec2 n, float lat, vec2 nl, float w) {
  float side = mot_bl(lat - w, nl);
  return dist > 1e-5 ? max(mot_bl(dist - w, n), side) : side;
}
// The same round a segment a–b (round caps).
float mot_segS(vec2 p, vec2 a, vec2 b, float w) {
  vec2 pa = p - a, ba = b - a;
  vec2 v = pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  vec2 nl = vec2(-ba.y, ba.x) / max(length(ba), 1e-6);
  return mot_bandS(length(v), v, abs(dot(pa, nl)), nl, w);
}
// A disc of radius r at offset v from its centre: exact (an ellipse, stretched) — taken across the direction from
// the centre, its depth would turn with that direction right at the centre.
float mot_discS(vec2 v, float r) { return bevelEllipseS(v, bevelFrame(gMotF[0], gMotF[1]), vec2(r)); }
`;
