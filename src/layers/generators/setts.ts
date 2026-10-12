// Setts (FR8.11): small paving stones laid in concentric arcs — fan paving and ring rosettes.
//
// Fans: disks of radius R on an offset-row lattice (W apart in a row, rows H apart, alternate rows shifted W/2), each
// row lying on top of the row above it. With R = √(W²/4 + H²) the two disks below a fan pass exactly through its
// centre, so they hide its lower half: each fan shows as a scale — a round rim on top, two arcs meeting at a point at
// the bottom — with its courses concentric about that point, the classic fan (H = W/2). Rings: one rosette per
// rectangular cell, cut by the cell. Each sett is an annular sector of its course — even joints, cut where fans meet —
// with a little hand-laid irregularity (size, position). Exact radial distances, near-exact tangential ones: crisp
// joints, working bevels.

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { geoGlsl, rndModeParam } from './geometricCommon'

export const settsLayer: LayerDef = {
  type: 'setts',
  label: 'Setts (fans & rings)',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Small paving stones laid in concentric arcs: fan (scale) paving in offset rows, or ring rosettes per cell. Even joints, setts cut where fans meet, hand-laid irregularity. Tileable.',
  params: [
    P.enum('layout', 'Layout', 'fan', [['fan', 'Fans (scales)'], ['rings', 'Rings (rosettes)']]),
    P.float('scale', 'Fans across', 2, 0.5, 32, { softMax: 8, step: 0.01, hint: 'Fans (or rosettes) across the width — whole counts when tiling' }),
    P.float('aspect', 'Row height', 1, 0.5, 2, { step: 0.01, hint: 'Fans: row spacing × half a fan width (1 = the classic fan). Rings: cell height ÷ width' }),
    P.float('courses', 'Courses', 6, 1, 32, { softMax: 16, step: 0.01, hint: 'Arcs of setts from a fan’s point to its rim (sets the sett size)' }),
    P.float('length', 'Sett length', 1, 0.4, 4, { step: 0.01, hint: 'Along the arc, in course widths (1 = square setts)' }),
    P.float('stagger', 'Joint stagger', 1, 0, 1, { step: 0.001, hint: 'Random turn of each course: 0 = joints line up along the radii' }),
    P.float('irregular', 'Irregularity', 0.2, 0, 1, { step: 0.001, hint: 'Hand-laid look: setts vary in size and sit slightly off their place' }),
    P.enum('dir', 'Direction', 'up', [['up', 'Up'], ['right', 'Right'], ['down', 'Down'], ['left', 'Left']], { hint: 'Which way the fans open (their round rims face)' }),
    P.float('gap', 'Gap', 1, 0, 32, { softMax: 4, unit: 'px', step: 0.1, hint: 'Joint width (whole px stay crisp)' }),
    P.float('round', 'Corner rounding', 0.5, 0, 16, { softMax: 3, unit: 'px', step: 0.1 }),
    rndModeParam(['Per sett', 'Per course', 'Per fan'], 'Random value per sett, per course (rings outward 0 → 1) or per fan. Use with Diffuse source = random'),
    P.seed(),
  ],
  defaults: {
    h_on: true,
    h_amount: 0.4,
    bevel: 1,
    profile: 'smooth',
    dif_on: true,
    dif_src: 'random',
    dif_grad: gradient('#3c3a36', '#5a5650', '#76716a'),
  },
  glsl:
    geoGlsl(4) +
    /* glsl */ `
GenOut gen(vec2 p) {
  bool rings = u_layout == 1;
  // Odd gaps: shift half a pixel so both joint edges land on pixel boundaries.
  float sh = fract(0.5 * u_gap);
  geo_frame(p - sh, 2 * clamp(u_dir, 0, 3));
  float kx = geo_count(u_scale * geo_span.x / uRes.x, 1);
  float W0 = geo_span.x / kx;
  float a = max(u_aspect, 0.05);
  float ky = rings ? geo_count(geo_span.y / (W0 * a), 1) : geo_count(geo_span.y / (0.5 * W0 * a), 2);
  geo_periods(vec2(kx, ky));
  float W = geo_cs.x, H = geo_cs.y;
  vec2 f = geo_f;

  // The fan holding f: its centre, key and region distance (negative inside).
  vec2 c = vec2(0.0);
  ivec2 key = ivec2(0);
  float dReg, pitch;
  float R = 0.0;
  if (rings) {
    ivec2 cell = ivec2(floor(f / vec2(W, H)));
    c = (vec2(cell) + 0.5) * vec2(W, H);
    key = geo_wrapCell(cell);
    vec2 q = abs(f - c) - 0.5 * vec2(W, H);
    dReg = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    pitch = 0.5 * min(W, H) / max(u_courses, 1.0);
  } else {
    // Disks below pass through the centre; at least the covering radius (squat rows) so the scales fill the plane.
    float hw2 = 0.25 * W * W + H * H;
    R = max(sqrt(hw2), hw2 / (2.0 * H));
    int j0 = int(floor(f.y / H));
    int bj = 1000000;
    for (int dj = -3; dj <= 2; dj++) {
      int j = j0 + dj;
      float o = (j & 1) == 1 ? 0.5 * W : 0.0;
      int i0 = int(floor((f.x - o) / W + 0.5));
      for (int di = -1; di <= 1; di++) {
        vec2 cc = vec2(float(i0 + di) * W + o, float(j) * H);
        if (j < bj && length(f - cc) < R) { bj = j; c = cc; key = ivec2(i0 + di, j); }
      }
    }
    key = geo_wrapCell(key);
    // Inside its own disk, outside every disk of the rows below (they lie on top).
    dReg = length(f - c) - R;
    for (int dj = 1; dj <= 3; dj++) {
      int j = bj - dj;
      float o = (j & 1) == 1 ? 0.5 * W : 0.0;
      int i0 = int(floor((f.x - o) / W + 0.5));
      for (int di = -1; di <= 1; di++) {
        vec2 cc = vec2(float(i0 + di) * W + o, float(j) * H);
        dReg = max(dReg, R - length(f - cc));
      }
    }
    pitch = R / max(u_courses, 1.0);
  }

  // The sett: course k (a ring of setts; k = 0 the centre stone), sett s along it.
  vec2 d = f - c;
  float r = length(d);
  float ins = 0.5 * u_gap + u_round;
  int fk = key.x * 7919 + key.y * 104729;
  int k = int(floor(r / pitch));
  int s = 0;
  float sd;
  if (k == 0) {
    float h = hashI(ivec2(fk, 0), uSeed);
    sd = r - (pitch - ins - u_irregular * 0.2 * pitch * h);
  } else {
    float rk = (float(k) + 0.5) * pitch;
    int n = max(3, int(floor(6.2831853 * rk / (max(u_length, 0.1) * pitch) + 0.5)));
    float fn = float(n);
    float o = u_stagger * hashI(ivec2(k, fk), uSeed);
    float t = atan(d.y, d.x) / 6.2831853;
    float sf = floor(t * fn + o);
    s = imod(int(sf), n);
    vec3 h = vec3(hashI(ivec2(s, k + fk), uSeed + 1.0), hashI(ivec2(s, k + fk), uSeed + 2.0), hashI(ivec2(s, k + fk), uSeed + 3.0));
    float irr = u_irregular;
    // Half the angular span, turned and shrunk a little per sett.
    float hd = 3.14159265 / fn;
    float tm = (sf + 0.5 - o) / fn * 6.2831853 + irr * 0.25 * hd * (2.0 * h.x - 1.0);
    float rc = rk + irr * 0.1 * pitch * (2.0 * h.y - 1.0);
    float shrink = irr * 0.2 * pitch * h.z;
    // Radial: distance to the course band; tangential: to the sett's two radial edges (px, perpendicular).
    float dr = abs(r - rc) - (0.5 * pitch - ins - 0.5 * shrink);
    vec2 n1 = vec2(-sin(tm + hd), cos(tm + hd));
    vec2 n2 = vec2(sin(tm - hd), -cos(tm - hd));
    float dt = max(dot(d, n1), dot(d, n2)) + ins + 0.5 * shrink;
    // Behind the centre the two edge lines cross: keep the sett on its own side.
    dt = max(dt, -dot(d, vec2(cos(tm), sin(tm))));
    vec2 e = vec2(dt, dr);
    sd = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
  }
  sd = max(sd - u_round, dReg + 0.5 * u_gap);

  float nCourses = max(u_courses, 1.0) + 1.0;
  float rnd;
  if (u_rnd_mode == 1) rnd = min((float(k) + 0.5) / nCourses, 1.0);
  else if (u_rnd_mode == 2) rnd = hashI(ivec2(fk, 7), uSeed);
  else rnd = hashI(ivec2(s * 64 + k, fk), uSeed + 5.0);
  return genOut(0.0, 1.0, rnd, min(sd, 1e4));
}
`,
}
