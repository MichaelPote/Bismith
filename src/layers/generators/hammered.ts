// Hammered (FR7.7): hand-hammered metal — dents laid on concentric rings around a few hammering centres. Each pixel
// belongs to one centre (a multiplicatively weighted Voronoi partition, so regions meet along interlocking *arcs*,
// never overlapping); within its region the dents sit on rings `ring` px apart, as many per ring as fit at `spacing`,
// with a random rotation per ring and positional jitter. The value is the dent's profile — 0 at the dent's centre
// rising to 1 at its rim (Dent shape: higher = flatter floor, sharper rim) — for height and colour.

import { P } from '@/core/params'
import type { LayerDef } from '../types'

export const hammeredLayer: LayerDef = {
  type: 'hammered',
  label: 'Hammered',
  category: 'pattern',
  kind: 'generator',
  description: 'Hand-hammered metal: dents on concentric rings around a few centres whose regions interlock along arcs.',
  params: [
    P.int('centres', 'Centres', 3, 1, 16, { hint: 'Hammering centres; each owns a region of concentric rings' }),
    P.float('weight_var', 'Arc boundaries', 0.5, 0, 0.95, { step: 0.001, hint: 'Weight variation between centres: 0 = straight region edges, higher = curved, interlocking arcs' }),
    P.float('ring', 'Ring spacing', 5, 1, 256, { softMax: 16, unit: 'px', step: 0.05 }),
    P.float('spacing', 'Dent spacing', 5, 1, 256, { softMax: 16, unit: 'px', step: 0.05, hint: 'Distance between dents along a ring' }),
    P.float('jitter', 'Jitter', 0.6, 0, 16, { softMax: 3, unit: 'px', step: 0.05, hint: 'Random offset of each dent (slightly irregular dots)' }),
    P.float('size', 'Dent size', 1, 0.3, 2, { step: 0.001, hint: 'Dent radius relative to the spacing (≥ 1: dents touch and leave rims)' }),
    P.float('shape', 'Dent shape', 3, 1, 8, { step: 0.01, hint: '1 = cone, 2 = dish, higher = flat-bottomed facets with thin, sharp rims' }),
    P.seed(),
  ],
  defaults: {
    h_on: true,
    h_amount: 0.6,
    dif_on: true,
    dif_grad: { stops: [{ pos: 0, color: '#3a1c10' }, { pos: 1, color: '#7a4224' }] },
  },
  glsl: /* glsl */ `
vec2 hmCentre(int i) { return hash2I(ivec2(i, 3), uSeed) * uRes; }
float hmWeight(int i) { return 1.0 - u_weight_var * hashI(ivec2(i, 5), uSeed); }

GenOut gen(vec2 p) {
  // Owning centre: smallest distance / weight (weighted Voronoi → arc-shaped region edges).
  int own = 0;
  float best = 1e20;
  vec2 rel = vec2(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= u_centres) break;
    vec2 d = wrapDelta(p - hmCentre(i));
    float s = length(d) / hmWeight(i);
    if (s < best) { best = s; own = i; rel = d; }
  }
  float r = length(rel);
  float th = atan(rel.y, rel.x);
  float ringW = max(u_ring, 0.5);
  float sp = max(u_spacing, 0.5);
  int k0 = int(floor(r / ringW + 0.5));
  float nearest = 1e9;
  float dentRnd = 0.0;
  // Rings k0−1..k0+1, three dents each around the pixel's angle: the nearest dent centre.
  for (int t = 0; t < 9; t++) {
    int k = k0 + t / 3 - 1;
    if (k < 0) continue;
    float rk = float(k) * ringW;
    float n = max(1.0, floor(TAU * rk / sp + 0.5));
    float stepA = TAU / n;
    float off = hashI(ivec2(own, k), uSeed + 11.0) * stepA;
    float j = floor((th - off) / stepA + 0.5) + float(t - (t / 3) * 3 - 1);
    float a = off + j * stepA;
    ivec2 id = ivec2(own * 4096 + k, int(mod(j, n)));
    vec2 jit = (hash2I(id, uSeed + 17.0) - 0.5) * 2.0 * u_jitter;
    vec2 c = vec2(cos(a), sin(a)) * rk + jit;
    float dd = length(rel - c);
    if (dd < nearest) { nearest = dd; dentRnd = hashI(id, uSeed + 23.0); }
  }
  // Dish: 0 at the dent's centre, 1 at its rim (radius = size × half the spacing between dents).
  float rad = 0.5 * u_size * min(ringW, sp);
  float v = clamp(nearest / max(rad, 0.25), 0.0, 1.0);
  return genOut(pow(v, u_shape), 1.0, dentRnd, 0.0);
}
`,
}
