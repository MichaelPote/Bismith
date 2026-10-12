// Symmetry / kaleidoscope filter (FR7.2c, docs/features/fr7.2c-motif-generators.md): re-maps the whole
// accumulated material state (albedo + opacity, height / roughness / shape register, emissive) through a
// symmetry fold, so earlier noise and shapes become ornaments. The fold is applied per cell of an N×M grid
// (optionally staggered / mirrored per cell) around a configurable centre; the source is read at the folded
// position with nearest (pixel-art) or bilinear sampling, wrapping when the project is tileable.

import { P } from '@/core/params'
import type { LayerDef } from '../types'

const MODES: [string, string][] = [
  ['mirror-x', 'Mirror X (left → right)'],
  ['mirror-y', 'Mirror Y (top → bottom)'],
  ['quad', 'Mirror XY (quad)'],
  ['diagonal', 'Diagonal mirror ╲'],
  ['antidiagonal', 'Diagonal mirror ╱'],
  ['square8', '8-fold square (XY + diagonals)'],
  ['rotate', 'Rotational (n-fold)'],
  ['kaleido', 'Kaleidoscope (n-fold + mirror)'],
  ['repeat', 'None (repeat cells only)'],
]

const polar = (p: Record<string, unknown>) => p.mode === 'rotate' || p.mode === 'kaleido'

export const symmetryLayer: LayerDef = {
  type: 'symmetry',
  label: 'Symmetry',
  category: 'filter',
  kind: 'filter',
  description: 'Kaleidoscope: folds every channel below (including the shape register) through mirror, rotational or kaleidoscope symmetry, per cell of a grid — turns noise and shapes into medallions and ornaments.',
  params: [
    P.enum('mode', 'Symmetry', 'square8', MODES),
    P.int('n', 'Folds', 6, 2, 12, { showIf: polar, hint: 'Rotational order (n copies around the centre)' }),
    P.float('angle', 'Angle', 0, -360, 360, { softMin: -180, softMax: 180, unit: '°', step: 0.1, hint: 'Rotates the mirror axes / wedges' }),
    P.bool('flip', 'Other side', false, { hint: 'Read the opposite half / wedge (the source is the left, top, top-left or up-left part by default); mirrors the result in rotational mode' }),
    P.float('cx', 'Centre X', 0.5, -1, 2, { softMin: 0, softMax: 1, step: 0.001, hint: 'Fold centre within each cell, 0..1 across' }),
    P.float('cy', 'Centre Y', 0.5, -1, 2, { softMin: 0, softMax: 1, step: 0.001, hint: 'Fold centre within each cell, 0..1 down' }),
    P.bool('nearest', 'Nearest pixel', true, { hint: 'No interpolation: exact pixel mirrors for pixel art (bilinear when off)' }),
    P.int('cells_x', 'Cells X', 1, 1, 64, { softMax: 16, group: 'grid', hint: 'Repeat the fold in a grid of cells (a tile of medallions)' }),
    P.int('cells_y', 'Cells Y', 1, 1, 64, { softMax: 16, group: 'grid' }),
    P.float('stagger', 'Row offset', 0, 0, 1, { step: 0.001, group: 'grid', hint: 'Shift odd rows by a fraction of a cell (use an even row count to tile)' }),
    P.bool('alt', 'Mirror alternate cells', false, { group: 'grid', hint: 'Mirror odd columns / rows so neighbouring cells meet seamlessly (wallpaper symmetry)' }),
    P.bool('shared', 'Same source for all cells', false, { group: 'source', hint: 'Every cell copies the top-left cell’s fold (identical medallions); off folds each cell’s own content' }),
    P.float('zoom', 'Zoom', 1, 0.05, 20, { softMin: 0.25, softMax: 4, step: 0.001, group: 'source', hint: 'Magnifies the sampled source (> 1 reads a smaller area)' }),
    P.float('src_x', 'Source offset X', 0, -1, 1, { step: 0.001, group: 'source', hint: 'Read the source from elsewhere, fraction of the texture' }),
    P.float('src_y', 'Source offset Y', 0, -1, 1, { step: 0.001, group: 'source' }),
    P.float('radius', 'Medallion radius', 0, 0, 2, { step: 0.001, group: 'blend', hint: 'Only fold inside this radius (fraction of half the cell); 0 = whole cell' }),
    P.float('soft', 'Edge softness', 0, 0, 256, { softMax: 16, unit: 'px', step: 0.1, group: 'blend', showIf: (p) => Number(p.radius) > 0 }),
    P.float('opacity', 'Opacity', 1, 0, 1, { step: 0.001, group: 'blend' }),
  ],
  groups: [
    { id: 'grid', label: 'Cells' },
    { id: 'source', label: 'Source', collapsed: true },
    { id: 'blend', label: 'Blend', collapsed: true },
  ],
  filterGlsl: /* glsl */ `
// Fold an offset v (px from the centre, GL y up, in the fold frame) into the source region.
vec2 sym_fold(vec2 v) {
  int m = u_mode;
  bool f = u_flip;
  if (m == 0) { v.x = f ? abs(v.x) : -abs(v.x); }                         // keep the left half
  else if (m == 1) { v.y = f ? -abs(v.y) : abs(v.y); }                    // keep the top half
  else if (m == 2) { v = vec2(f ? abs(v.x) : -abs(v.x), f ? -abs(v.y) : abs(v.y)); }   // top-left quadrant
  else if (m == 3) { bool o = (v.x + v.y < 0.0) != f; if (o) v = -v.yx; } // ╲ axis: keep the top-right side
  else if (m == 4) { bool o = (v.y < v.x) != f; if (o) v = v.yx; }        // ╱ axis: keep the top-left side
  else if (m == 5) {                                                       // D4: the wedge from up to up-left
    v = abs(v);
    if (v.x > v.y) v = v.yx;
    if (!f) v.x = -v.x;
  } else if (m == 6 || m == 7) {
    // Polar: the wedge centred on 'up' (rotational) or from up towards the left (kaleidoscope).
    float s = TAU / float(clamp(u_n, 2, 12));
    float a = atan(-v.x, v.y);                  // 0 = up, counter-clockwise (towards the left on screen)
    a -= s * floor(a / s + 0.5);
    if (m == 7) a = abs(a);
    if (f) a = -a;
    v = length(v) * vec2(-sin(a), cos(a));
  }
  return v;
}

void applyFilter(inout vec4 A, inout vec4 S, inout vec4 E, ivec2 ip) {
  vec2 p = vec2(ip) + 0.5;
  ivec2 n = ivec2(max(u_cells_x, 1), max(u_cells_y, 1));
  vec2 cs = uRes / vec2(n);
  int cy = int(floor(p.y / cs.y));
  int rowTop = n.y - 1 - cy;                       // rows counted from the top (user space)
  float shift = imod(rowTop, 2) == 1 ? u_stagger : 0.0;
  int cx = int(floor(p.x / cs.x - shift));
  vec2 origin = vec2((float(cx) + shift) * cs.x, float(cy) * cs.y);
  vec2 ctr = vec2(u_cx * cs.x, (1.0 - u_cy) * cs.y);
  vec2 v = p - origin - ctr;
  if (u_alt) {
    if (imod(cx, 2) == 1) v.x = -v.x;
    if (imod(rowTop, 2) == 1) v.y = -v.y;
  }
  float r = length(v);
  vec2 w = v;
  if (u_mode != 8) w = u_angle == 0.0 ? sym_fold(v) : rotCW(sym_fold(unrotCW(v, u_angle)), u_angle);
  w /= max(u_zoom, 1e-3);
  vec2 srcOrigin = u_shared ? vec2(0.0, uRes.y - cs.y) : origin;
  vec2 q = srcOrigin + ctr + w + vec2(u_src_x, -u_src_y) * uRes;
  vec4 A2, S2, E2;
  if (u_nearest) {
    ivec2 c = ivec2(floor(q));
    A2 = fetchT(tAlbedo, c);
    S2 = fetchT(tSurface, c);
    E2 = fetchT(tEmissive, c);
  } else {
    A2 = sampleT(tAlbedo, q);
    S2 = sampleT(tSurface, q);
    E2 = sampleT(tEmissive, q);
  }
  S2.a *= u_zoom;                                  // distances scale with the magnification
  float m = u_opacity;
  if (u_radius > 0.0) {
    float R = u_radius * 0.5 * min(cs.x, cs.y);
    m *= u_soft > 0.0 ? clamp((R - r) / u_soft + 0.5, 0.0, 1.0) : (r <= R ? 1.0 : 0.0);
  }
  A = mix(A, A2, m);
  S = mix(S, S2, m);
  E = mix(E, E2, m);
}
`,
}

export const SYMMETRY_FILTERS: LayerDef[] = [symmetryLayer]
