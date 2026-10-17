// Crevices & high spots (FR8.13): a mask read from the surface the layers before it built — crevices (lower than the
// surface around them), high spots (higher), both, or slopes — written to a mask (Mask › Write to) so the layers after
// it (or a whole material) can be limited to it: grime and moss in the joints, wear and highlights on the edges. Like the
// Drips' relief drive and the Cavity filter, but as a reusable mask.

import { P } from '@/core/params'
import type { LayerDef } from '../types'

export const surfaceMaskLayer: LayerDef = {
  type: 'surfacemask',
  label: 'Crevices & high spots',
  category: 'pattern',
  kind: 'generator',
  description:
    'A mask from the surface so far: crevices (lower than around them), high spots, both, or slopes. Writes the Crevices mask by default for the layers after it — or paint with it directly (grime in crevices, wear on edges).',
  params: [
    P.enum('find', 'Find', 'crevices', [['crevices', 'Crevices'], ['high', 'High spots'], ['both', 'Both'], ['slopes', 'Slopes']]),
    P.float('radius', 'Radius', 3, 0.5, 64, { softMax: 16, unit: 'px', step: 0.1, hint: 'How far around each pixel the surface is compared: small = fine cracks and joints, large = broad dips and rises' }),
    P.float('depth', 'Depth', 0.5, 0.01, 64, { softMax: 4, unit: 'px', step: 0.01, hint: 'Height difference (px) that gives a full mask', showIf: (p) => p.find !== 'slopes' }),
    P.float('steep', 'Full at slope', 1, 0.05, 16, { softMax: 4, step: 0.01, hint: 'Slope (height px per px; 1 = 45°) that gives a full mask', showIf: (p) => p.find === 'slopes' }),
    P.float('level', 'Level', 0.1, 0, 1, { step: 0.001, hint: 'Ignore anything weaker than this' }),
    P.float('softness', 'Softness', 0.5, 0, 1, { step: 0.001, hint: 'How gradually the mask rises above the level (0 = hard edge)' }),
  ],
  defaults: { mk_target: 'Crevices', dif_on: false, h_on: false },
  glsl: /* glsl */ `
float sm_h(vec2 px) { return sampleT(tSurface, px).r * uDepth; }

GenOut gen(vec2 p) {
  float h0 = sm_h(p);
  float r = max(u_radius, 0.5);
  // The surface around the pixel: three rings of samples, weighted towards the centre (about a Gaussian).
  float sum = 0.0, wsum = 0.0;
  for (int ring = 1; ring <= 3; ring++) {
    float rr = r * float(ring) / 3.0;
    int n = 6 * ring;
    float w = exp(-0.5 * float(ring * ring) / 2.25);
    for (int i = 0; i < 18; i++) {
      if (i >= n) break;
      float a = 6.2831853 * (float(i) + 0.5 * float(ring & 1)) / float(n);
      sum += w * sm_h(p + vec2(cos(a), sin(a)) * rr);
      wsum += w;
    }
  }
  // > 0 in a crevice (the surroundings stand higher), < 0 on a high spot.
  float c = sum / wsum - h0;
  float raw;
  if (u_find == 3) {
    vec2 g = 0.5 * vec2(sm_h(p + vec2(1.0, 0.0)) - sm_h(p - vec2(1.0, 0.0)), sm_h(p + vec2(0.0, 1.0)) - sm_h(p - vec2(0.0, 1.0)));
    raw = length(g) / max(u_steep, 1e-3);
  } else {
    float d = max(u_depth, 1e-3);
    raw = u_find == 0 ? c / d : u_find == 1 ? -c / d : abs(c) / d;
  }
  raw = clamp(raw, 0.0, 1.0);
  float v = u_softness > 0.0 ? smoothstep(u_level, min(u_level + u_softness, 1.0 + 1e-3), raw) : step(u_level, raw) * step(1e-6, raw);
  return genOut(v, v, 0.0, NO_SDF);
}
`,
}
