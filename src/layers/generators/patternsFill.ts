// Fill-style pattern layers (FR2.4): fBm clouds, gradients (UI shading) and random scratches (metal wear).
// These are value generators (no SDF); see patterns.ts for the cell-based SDF patterns.

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'

// ------------------------------------------------------------------------------------------------ clouds

export const cloudsLayer: LayerDef = {
  type: 'clouds',
  noise: true,
  label: 'Clouds',
  category: 'noise',
  kind: 'generator',
  description: 'Classic fractal clouds with domain warp, contrast and coverage — grime, stains, soft variation.',
  params: [
    P.enum('basis', 'Basis', 'perlin', [['value', 'Value'], ['perlin', 'Perlin']]),
    P.enum('style', 'Style', 'fbm', [['fbm', 'Soft (fBm)'], ['billow', 'Billow (puffy)'], ['ridged', 'Ridged']]),
    P.float('scale', 'Scale', 4, 0.25, 256, { softMax: 32, step: 0.01, hint: 'Base cells across the texture width (rounded when tiling)' }),
    P.float('stretch', 'Stretch', 1, 0.05, 20, { softMin: 0.2, softMax: 8, step: 0.01, hint: '>1 elongates features horizontally' }),
    P.int('octaves', 'Octaves', 6, 1, 12),
    P.float('gain', 'Gain', 0.5, 0, 1, { step: 0.001, hint: 'Amplitude kept per octave (roughness)' }),
    P.float('warp', 'Warp', 0.15, 0, 8, { softMax: 2, step: 0.001, hint: 'Domain warp, in base cells' }),
    P.float('contrast', 'Contrast', 1.5, 0, 32, { softMax: 8, step: 0.01 }),
    P.float('coverage', 'Coverage', 0.5, 0, 1, { step: 0.001, hint: 'Share of the area above mid-grey' }),
    P.seed(),
  ],
  defaults: {
    dif_on: true,
    dif_blend: 'multiply',
    dif_opacity: 0.6,
    dif_grad: gradient('#5e554b', '#ffffff'),
    h_on: true,
    h_amount: 0.15,
  },
  glsl: /* glsl */ `
GenOut gen(vec2 p) {
  vec2 cells = cellsFor(u_scale, u_stretch);
  ivec2 per = uTile ? ivec2(cells) : NO_PERIOD;
  vec2 x = p / uRes * cells;
  if (u_warp > 0.0) x += warpOffset(x, per, uSeed + 7.0) * u_warp * 2.0;
  int mode = u_style == 1 ? 3 : u_style == 2 ? 2 : 1;
  float n = fractalNoise(u_basis, mode, x, per, u_octaves, 2.0, u_gain, uSeed);
  // Threshold so that roughly 'coverage' of the area lands above 0.5 (fBm spreads ~0.5 +- 0.2).
  float thr = 0.5 - (u_coverage - 0.5) * 0.4;
  float v = clamp((n - thr) * u_contrast + 0.5, 0.0, 1.0);
  return genOutSmooth(v, 1.0, n, 0.0);
}
`,
}

// ------------------------------------------------------------------------------------------------ gradient

export const gradientLayer: LayerDef = {
  type: 'gradient',
  label: 'Gradient',
  category: 'pattern',
  kind: 'generator',
  description: 'Linear, radial, angular or diamond ramp with repeat / mirror — UI shading, vignettes, sheens.',
  params: [
    P.enum('style', 'Type', 'linear', [['linear', 'Linear'], ['radial', 'Radial'], ['angular', 'Angular'], ['diamond', 'Diamond']]),
    P.float('angle', 'Angle', 270, -360, 360, { softMin: -180, softMax: 360, unit: '°', step: 0.1, hint: 'Direction from 0 to 1, clockwise from →; 270 runs bottom → top' }),
    P.float('cx', 'Centre X', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001 }),
    P.float('cy', 'Centre Y', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: '0..1 down' }),
    P.float('length', 'Length / radius', 0, 0, 8192, { softMax: 512, unit: 'px', step: 0.5, showIf: (p) => p.style !== 'angular', hint: '0 = fit the texture (linear spans it, radial / diamond reach the farthest corner)' }),
    P.enum('repeat', 'Repeat', 'clamp', [['clamp', 'None (clamp)'], ['repeat', 'Repeat'], ['mirror', 'Mirror']]),
  ],
  defaults: {
    dif_on: true,
    dif_grad: gradient('#3a3e43', '#9aa3ab'),
  },
  glsl: /* glsl */ `
GenOut gen(vec2 p) {
  vec2 c = userPx(vec2(u_cx, u_cy));
  vec2 d = p - c;
  // Radial-type gradients use the nearest periodic copy of the centre when tiling (seamless).
  if (uTile && u_style != 0) d = wrapDelta(d);
  vec2 q = unrotCW(d, u_angle);   // x along the gradient direction
  float t;
  if (u_style == 0) {
    float a = radians(u_angle);
    float L = u_length > 0.0 ? u_length : abs(uRes.x * cos(a)) + abs(uRes.y * sin(a));
    t = 0.5 + q.x / L;
  } else if (u_style == 2) {
    t = fract(-atan(q.y, q.x) / TAU);
  } else {
    float R = u_length;
    if (R <= 0.0) {
      // Farthest corner (of the texture, or of the wrap cell when tiling).
      vec2 lo = uTile ? -0.5 * uRes : -c;
      vec2 hi = uTile ? 0.5 * uRes : uRes - c;
      R = 0.0;
      for (int i = 0; i < 4; i++) {
        vec2 k = vec2(i == 0 || i == 2 ? lo.x : hi.x, i < 2 ? lo.y : hi.y);
        vec2 kq = unrotCW(k, u_angle);
        R = max(R, u_style == 1 ? length(k) : abs(kq.x) + abs(kq.y));
      }
    }
    R = max(R, 1e-3);
    t = u_style == 1 ? length(d) / R : (abs(q.x) + abs(q.y)) / R;
  }
  float v;
  if (u_repeat == 1) v = fract(t);
  else if (u_repeat == 2) { float m = mod(t, 2.0); v = m > 1.0 ? 2.0 - m : m; }
  else v = clamp(t, 0.0, 1.0);
  // Per-band random (each repeat of the ramp).
  float rnd = hashI(ivec2(int(floor(t)), 0), uSeed);
  return genOut(v, 1.0, rnd, 0.0);
}
`,
}

// ------------------------------------------------------------------------------------------------ scratches

export const scratchesLayer: LayerDef = {
  type: 'scratches',
  label: 'Scratches',
  category: 'pattern',
  kind: 'generator',
  description: 'Many short random line segments — metal wear, scuffs, scored stone. Coverage masks the outputs.',
  params: [
    P.float('density', 'Density', 12, 0, 512, { softMax: 64, step: 0.1, perArea: true, hint: 'Scratches per 64×64 px (saturates at very high values)' }),
    P.float('len_min', 'Min length', 6, 0, 1024, { softMax: 64, unit: 'px', step: 0.5 }),
    P.float('len_max', 'Max length', 20, 0, 1024, { softMax: 128, unit: 'px', step: 0.5 }),
    P.float('thickness', 'Thickness', 1, 0, 64, { softMax: 8, unit: 'px', step: 0.05 }),
    P.float('taper', 'Taper', 0.5, 0, 1, { step: 0.001, hint: 'Thin the ends of each scratch' }),
    P.float('angle', 'Angle', 30, -360, 360, { softMin: -180, softMax: 180, unit: '°', step: 0.1, hint: 'Clockwise from horizontal' }),
    P.float('angle_jitter', 'Angle jitter', 45, 0, 180, { unit: '°', step: 0.1, hint: '180 = any direction' }),
    P.float('fade', 'Strength jitter', 0.6, 0, 1, { step: 0.001, hint: 'Random strength per scratch (the value)' }),
    P.bool('hard', 'Hard edges', false, { hint: 'No anti-aliasing (pixel art)' }),
    P.seed(),
  ],
  defaults: {
    dif_on: true,
    dif_opacity: 0.8,
    dif_grad: gradient('#8f8a82', '#d9d4cb'),
    h_on: true,
    h_mode: 'subtract',
    h_amount: 0.2,
  },
  glsl: /* glsl */ `
GenOut gen(vec2 p) {
  float lmax = max(u_len_max, u_len_min);
  // Cells at least one scratch reach wide, so only the 3x3 neighbourhood can touch this pixel.
  float reach = 0.5 * lmax + 0.5 * u_thickness + 1.0;
  vec2 n = uTile ? max(floor(uRes / reach), vec2(1.0)) : max(uRes / reach, vec2(1.0));
  vec2 cs = uRes / n;
  float lambda = u_density * cs.x * cs.y / 4096.0;   // expected scratches per cell
  ivec2 ip = ivec2(floor(p / cs));
  float cov = 0.0, val = 0.0, score = 0.0, rnd = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec2 c = ip + ivec2(i, j);
    ivec2 cw = uTile ? imod(c, ivec2(n)) : c;
    for (int s = 0; s < 24; s++) {
      float fs = float(s);
      if (fs >= lambda) break;
      vec3 h = hash3I(cw, uSeed + fs * 7.0);
      vec3 g = hash3I(cw, uSeed + fs * 7.0 + 3.0);
      if (fs + 1.0 > lambda && g.z > lambda - fs) continue;   // fractional last slot
      vec2 ctr = (vec2(c) + h.xy) * cs;
      float len = mix(u_len_min, lmax, h.z);
      vec2 dir = rotCW(vec2(1.0, 0.0), u_angle + (g.x - 0.5) * 2.0 * u_angle_jitter);
      vec2 pa = p - (ctr - dir * 0.5 * len);
      float t = clamp(dot(pa, dir) / max(len, 1e-3), 0.0, 1.0);
      float dist = length(pa - dir * (t * len));
      float e = 2.0 * t - 1.0;
      float th = u_thickness * mix(1.0, sqrt(max(0.0, 1.0 - e * e)), u_taper);
      float cv = u_hard ? (dist <= max(0.5 * th, 0.5) ? 1.0 : 0.0) : clamp(0.5 * th + 0.5 - dist, 0.0, 1.0);
      float st = 1.0 - g.y * u_fade;
      if (cv * st > score) { score = cv * st; val = st; rnd = h.x; }
      cov = max(cov, cv);
    }
  }
  return genOut(val, cov, rnd, 0.0);
}
`,
}
