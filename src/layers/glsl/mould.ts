// Moulding profiles shared by the generators that run mouldings across a width (Trim's bands, Panelling's steps and
// rails): 0..1 at t (0..1 across the member). Plain curves, not the Edge profile (profileCurve), whose custom-curve
// branch would come along with every call.

export const GLSL_MOULD = /* glsl */ `
// A quarter round, 0 → 1 over t: convex, quick at the start.
float mouldRound(float t) { return sqrt(max(1.0 - (1.0 - t) * (1.0 - t), 0.0)); }

// A member's progress from its start level to its end at t: 1 chamfer (straight), 2 round (ovolo: a convex quarter
// round, rounded over at the top), 3 cove (a concave quarter round, hollow at the bottom), 4 ogee (S curve). rising:
// the end is the higher, which sets which way round and cove turn.
float mouldEase(int k, float t, bool rising) {
  t = clamp(t, 0.0, 1.0);
  if (k == 1) return t;
  if (k == 4) return t * t * (3.0 - 2.0 * t);
  bool quick = (k == 2) == rising;
  return quick ? sqrt(max(1.0 - (1.0 - t) * (1.0 - t), 0.0)) : 1.0 - sqrt(max(1.0 - t * t, 0.0));
}

// Out and back across a member: a bead (half round) and a ridge (straight sides), 0 at both edges, 1 in the middle.
float mouldBead(float t) { float x = 2.0 * t - 1.0; return sqrt(max(1.0 - x * x, 0.0)); }
float mouldRidge(float t) { return 1.0 - abs(2.0 * t - 1.0); }
`;
