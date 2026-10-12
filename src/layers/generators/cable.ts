// Cable (FR7.5): a tube wound along a helix and seen side-on — coil springs (1 strand), twisted rope and cable
// mouldings (2–4 strands). Each strand point has a depth (front strands sit higher than the back of the loop),
// so the value is a height: the topmost tube surface at the pixel, normalised to 0..1 over the cable's depth.

import { P } from '@/core/params'
import type { LayerDef } from '../types'

export const cableLayer: LayerDef = {
  type: 'cable',
  label: 'Cable',
  category: 'pattern',
  kind: 'generator',
  description: 'Coil springs, twisted rope and cable mouldings: tubes wound on a helix seen from the side; front strands cross over the back of each loop.',
  params: [
    P.enum('axis', 'Axis', 'horizontal', [['horizontal', 'Horizontal'], ['vertical', 'Vertical']]),
    P.float('pos', 'Position', 0.5, -1, 2, { softMin: 0, softMax: 1, step: 0.001, hint: 'Centre line, 0..1 across the axis (down for horizontal cables)' }),
    P.float('count', 'Turns', 4, 0.25, 256, { softMax: 32, step: 0.01, hint: 'Turns along the texture (rounded when tiling)' }),
    P.float('radius', 'Radius', 6, 0, 512, { softMax: 32, unit: 'px', step: 0.1, hint: 'Helix radius: half the cable height, centre to centre of the tube' }),
    P.float('lean', 'Loop', 4, -512, 512, { softMin: -16, softMax: 16, unit: 'px', step: 0.1, hint: 'Side-on tilt: 0 gives a wave, larger values open the strands into loops; the sign sets the twist direction' }),
    P.float('thickness', 'Tube radius', 2, 0.25, 256, { softMax: 16, unit: 'px', step: 0.05 }),
    P.int('strands', 'Strands', 1, 1, 4),
    P.float('back', 'Back depth', 1, 0, 1, { step: 0.001, hint: 'How far the back of each loop sinks (0 = flat braid, 1 = full helix depth)' }),
  ],
  defaults: { h_on: true, h_amount: 0.6, dif_on: true },
  glsl: /* glsl */ `
const float CABLE_TAU = 6.28318530718;

GenOut gen(vec2 p) {
  bool vert = u_axis == 1;
  vec2 q = vec2(p.x, uRes.y - p.y);
  float len = vert ? uRes.y : uRes.x;
  float across = vert ? uRes.x : uRes.y;
  float turns = uTile ? max(1.0, floor(u_count + 0.5)) : u_count;
  float P = len / turns;
  float u = vert ? q.y : q.x;
  float v = (vert ? q.x : q.y) - u_pos * across;
  if (uTile) v -= across * floor(v / across + 0.5);
  float R = u_radius, L = u_lean, r = max(u_thickness, 0.25);
  // Quick reject outside the cable's band.
  if (abs(v) > R + r + 1.0) return genOut(0.0, 0.0, 0.0, 0.0);

  float bestH = -1e9, bestD = 1e9, bestS = 0.0;
  float edgeD = r + 1.0, edgeZ = 0.0, edgeS = 0.0;
  int n = clamp(u_strands, 1, 4);
  // One flat loop with a uniform-derived bound (strand-major): nested constant loops make D3D's compiler try to
  // unroll hundreds of iterations. Two turns either side of the pixel cover every loop that can reach it.
  const int SEG = 16;
  const int PER = SEG * 4 + 1;
  int total = n * PER;
  float th0 = CABLE_TAU * u / P;
  vec3 prev = vec3(0.0);
  for (int k = 0; k < total; k++) {
    int s = k / PER;
    int i = k - s * PER;
    float th = th0 - CABLE_TAU * 2.0 + CABLE_TAU * float(i) / float(SEG);
    float a = th + CABLE_TAU * float(s) / float(n);
    // Screen position along the axis, across it, and depth toward the viewer.
    vec3 c = vec3(P * th / CABLE_TAU + L * sin(a), R * cos(a), R * sin(a) * u_back);
    if (i > 0) {
      vec2 e = c.xy - prev.xy;
      vec2 w = vec2(u, v) - prev.xy;
      float t = clamp(dot(w, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
      float d = length(w - e * t);
      float z = mix(prev.z, c.z, t);
      if (d < r) {
        // Inside a tube: the topmost surface wins.
        float h = z + sqrt(r * r - d * d);
        if (h > bestH) { bestH = h; bestD = d; bestS = float(s); }
      } else if (d < edgeD) {
        // Anti-aliasing fringe: only used where no tube covers the pixel.
        edgeD = d; edgeZ = z; edgeS = float(s);
      }
    }
    prev = c;
  }
  if (bestH < -1e8) {
    if (edgeD >= r + 1.0) return genOut(0.0, 0.0, 0.0, 0.0);
    bestH = edgeZ;
    bestD = edgeD;
    bestS = edgeS;
  }
  float depth = R * u_back + r;
  float value = clamp(0.5 + 0.5 * bestH / max(depth, 1e-3), 0.0, 1.0);
  float cov = clamp(r - bestD + 0.5, 0.0, 1.0);
  return genOut(value, cov, n > 1 ? bestS / float(n - 1) : 0.0, 0.0);
}
`,
}
