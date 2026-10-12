// Motif & ornament generators (FR7.2c, docs/features/fr7.2c-motif-generators.md): tile-based line networks
// (truchet arcs, 10-PRINT diagonals, mazes, polyomino rooms, Greek-key meanders, circuit traces) in this file,
// radial rosettes and procedural glyphs / sigils in motifRadial.ts. All are SDF generators (distance in px,
// negative inside) so the common bevel / etch / emissive machinery applies; every lattice wraps when the
// project is tileable.

import { P } from '@/core/params'
import type { LayerDef } from '../types'
import { GLSL_MOT_SEED, glyphLayer, rosetteLayer } from './motifRadial'

// ------------------------------------------------------------------------------------------------ truchet

const STYLES: [string, string][] = [
  ['arcs', 'Truchet arcs'],
  ['diagonal', 'Diagonal (10 PRINT)'],
  ['maze', 'Maze walls'],
  ['rooms', 'Rooms (polyomino walls)'],
  ['meander', 'Greek key / meander'],
  ['circuit', 'Circuit traces'],
]

const isStyle = (...s: string[]) => (p: Record<string, unknown>) => s.includes(String(p.style))

export const truchetLayer: LayerDef = {
  type: 'truchet',
  label: 'Truchet / Lines',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Tile-based line networks: truchet arcs, 10-PRINT diagonals, maze walls, polyomino rooms, Greek-key meanders and circuit-board traces with pads, buses and chips.',
  params: [
    P.enum('style', 'Style', 'arcs', STYLES),
    P.int('cells', 'Cells across', 8, 1, 256, { softMax: 64, hint: 'Grid cells across the width. Meanders round to a multiple of the key period when tiling' }),
    P.int('cells_y', 'Cells down', 0, 0, 256, { softMax: 64, hint: '0 = follow the aspect ratio (square cells)' }),
    P.float('width', 'Line width', 1, 0, 256, { softMax: 16, unit: 'px', step: 0.1, hint: 'Whole-pixel widths on whole-pixel cells give crisp lines with anti-aliasing off' }),
    P.float('offset_x', 'Offset X', 0, 0, 1, { step: 0.001, hint: 'Shift the lattice, fraction of a cell' }),
    P.float('offset_y', 'Offset Y', 0, 0, 1, { step: 0.001 }),
    P.float('density', 'Density', 1, 0, 1, {
      step: 0.001,
      showIf: isStyle('arcs', 'diagonal', 'maze', 'rooms'),
      hint: 'Arcs / diagonal: fraction of tiles drawn. Maze: fraction of grid nodes that grow a wall. Rooms: merging of cells into bigger rooms (1 = rooms of ~3 cells)',
    }),
    P.int('key', 'Key size', 2, 1, 6, { showIf: isStyle('meander'), hint: 'Spiral turns of each key; the period is key + 1 cells' }),
    P.bool('borders', 'Border lines', true, { showIf: isStyle('meander'), hint: 'The rail every key hangs from (also the next band’s top)' }),
    P.bool('vertical', 'Vertical', false, { showIf: isStyle('meander'), hint: 'Run the bands down instead of across' }),
    P.float('regions', 'Bus regions', 6, 0, 64, {
      softMax: 16,
      step: 0.1,
      showIf: isStyle('circuit'),
      hint: 'Size (cells) of regions whose traces run parallel — horizontal, vertical or diagonal buses that bend together. 0 = independent random traces',
    }),
    P.float('traces', 'Trace density', 0.85, 0, 1, { step: 0.001, showIf: isStyle('circuit'), hint: 'Chance that a trace continues across each cell edge (lower = shorter traces, more pads)' }),
    P.float('bend', 'Diagonals', 0.5, 0, 1, {
      step: 0.001,
      showIf: isStyle('circuit'),
      hint: 'With regions: share of diagonal buses. Without: chance a turn cuts the corner at 45° (else a right angle)',
    }),
    P.float('pad', 'Pad radius', 1, 0, 64, { softMax: 8, unit: 'px', step: 0.1, showIf: isStyle('circuit'), hint: 'Round pads at trace ends and vias' }),
    P.float('vias', 'Vias', 0.3, 0, 1, { step: 0.001, showIf: isStyle('circuit'), hint: 'Chance of a lone via in an empty cell' }),
    P.float('chips', 'Chips', 0, 0, 1, { step: 0.001, showIf: isStyle('circuit'), hint: 'Chance of a 2×2-cell chip (with pins) in each 4×4 block' }),
    P.seed(),
  ],
  defaults: {
    h_on: true,
    h_amount: 0.4,
    bevel: 1,
    profile: 'round',
    dif_on: true,
    dif_src: 'flat',
    dif_grad: { stops: [{ pos: 0, color: '#c8a85a' }] },
  },
  glsl:
    GLSL_MOT_SEED +
    /* glsl */ `
ivec2 mot_wrap(ivec2 c, ivec2 n) { return uTile ? imod(c, n) : c; }

// Cells per axis (whole counts); rounded to a multiple of 'mult' (the meander period) when tiling.
ivec2 mot_cellCount(int mult) {
  float nx = float(max(u_cells, 1));
  float ny = u_cells_y > 0 ? float(u_cells_y) : nx * uRes.y / uRes.x;
  vec2 n = max(vec2(1.0), floor(vec2(nx, ny) + 0.5));
  if (mult > 1 && uTile) n = max(vec2(float(mult)), floor(n / float(mult) + 0.5) * float(mult));
  return ivec2(n);
}

const ivec2 MOT_D4[4] = ivec2[4](ivec2(1, 0), ivec2(0, 1), ivec2(-1, 0), ivec2(0, -1));

// Exact distance to a quarter circle of radius r centred at c, spanning the quadrant towards signs s.
float mot_quarterArc(vec2 p, vec2 c, float r, vec2 s) {
  vec2 d = p - c;
  if (d.x * s.x >= 0.0 && d.y * s.y >= 0.0) return abs(length(d) - r);
  return min(length(d - vec2(s.x * r, 0.0)), length(d - vec2(0.0, s.y * r)));
}

// Rooms: every cell links to one random neighbour (with probability density); walls sit on cell edges between
// cells that are not directly linked, so rooms are small polyominoes. A wall that would be the only one at
// either of its end nodes (a stub poking into a room that wraps around the node) is dropped, so the walls
// form a closed net like a tiling of tetromino-ish rooms.
int mot_link(ivec2 cw) {
  vec2 h = hash2I(cw, MOT_SEED + 3.0);
  return h.x < 0.6 * u_density ? int(h.y * 4.0) : -1;   // beyond ~0.6, stubby dead-end walls appear
}
// Cells a and a + D4[axis] (axis 0: +x, 1: +y) are linked.
bool mot_linked(ivec2 a, int axis, ivec2 n) {
  return mot_link(mot_wrap(a, n)) == axis || mot_link(mot_wrap(a + MOT_D4[axis], n)) == axis + 2;
}
// The edge leaving lattice node x in direction dir (0 +x, 1 +y, 2 −x, 3 −y) is open (its cells are linked).
bool mot_nodeOpen(ivec2 x, int dir, ivec2 n) {
  if (dir == 0) return mot_linked(x + ivec2(0, -1), 1, n);
  if (dir == 1) return mot_linked(x + ivec2(-1, 0), 0, n);
  if (dir == 2) return mot_linked(x + ivec2(-1, -1), 1, n);
  return mot_linked(x + ivec2(-1, -1), 0, n);
}
bool mot_lonely(ivec2 x, int dir, ivec2 n) {
  for (int k = 1; k < 4; k++) if (!mot_nodeOpen(x, (dir + k) % 4, n)) return false;
  return true;
}
// The +x (axis 0) or +y (axis 1) wall of cell c (which spans lattice [c, c + 1]).
bool mot_wall(ivec2 c, int axis, ivec2 n) {
  if (mot_linked(c, axis, n)) return false;
  int da = axis == 0 ? 1 : 0;
  return !mot_lonely(c + (axis == 0 ? ivec2(1, 0) : ivec2(0, 1)), da, n) && !mot_lonely(c + 1, da + 2, n);
}

// ---- circuit. Tiles are centred on lattice nodes; traces cross tile edges at their midpoints. Each tile has a
// bus direction (-1 random, 0 horizontal, 1 vertical, 2 / 3 the two diagonals) from a coarse Voronoi region;
// an edge carries a trace when both tiles want it (and a random draw passes). Directions and chip flags of the
// 5×5 tiles around the pixel are cached once.
int mot_dir[25];
bool mot_chp[25];
float mot_rr[25];   // per-bus (region) random, or per-tile without regions
ivec2 mot_c0;
int mot_idx(ivec2 c) { ivec2 d = clamp(c - mot_c0 + 2, ivec2(0), ivec2(4)); return d.y * 5 + d.x; }

int mot_regionDir(ivec2 cw, ivec2 n, out float rr) {
  rr = hashI(cw, MOT_SEED);
  if (u_regions <= 0.0) return -1;
  vec2 cnt = max(vec2(1.0), floor(vec2(n) / u_regions + 0.5));
  ivec2 per = uTile ? ivec2(cnt) : NO_PERIOD;
  vec2 x = (vec2(cw) + 0.5) / vec2(n) * cnt;
  ivec2 ip = ivec2(floor(x));
  float best = 1e9, rnd = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec2 g = imod(ip + ivec2(i, j), per);
    vec2 r = vec2(ip + ivec2(i, j)) + 0.5 + (hash2I(g, MOT_SEED + 31.0) - 0.5) * 0.9 - x;
    float d = dot(r, r);
    if (d < best) { best = d; rnd = hashI(g, MOT_SEED + 37.0); }
  }
  rr = fract(rnd * 7.13);
  if (rnd < u_bend) return rnd < 0.5 * u_bend ? 2 : 3;
  return (rnd - u_bend) < 0.5 * (1.0 - u_bend) ? 0 : 1;
}

bool mot_chip(ivec2 cw, ivec2 n) {
  if (u_chips <= 0.0) return false;
  ivec2 m = ivec2(floor(vec2(cw) / 4.0));
  ivec2 r = cw - m * 4;
  if (r.x < 1 || r.x > 2 || r.y < 1 || r.y > 2) return false;
  if (uTile && ((m.x + 1) * 4 > n.x || (m.y + 1) * 4 > n.y)) return false;   // partial block at the seam
  return hashI(m, MOT_SEED + 71.0) < u_chips;
}

// Whether a tile with bus direction dir uses its edge on side (0 R, 1 U, 2 L, 3 D). Diagonal buses use one
// chamfer pair per tile, alternating with tile parity, so their lines run every other diagonal (the same
// 2-cell pitch as straight buses at 45°) and chain across tiles.
bool mot_wants(int dir, ivec2 c, int side) {
  if (dir < 0) return true;
  if (dir == 0) return side == 0 || side == 2;
  if (dir == 1) return side == 1 || side == 3;
  bool even = ((c.x + c.y) & 1) == 0;
  if (dir == 2) return even ? (side == 2 || side == 1) : (side == 0 || side == 3);
  return even ? (side == 2 || side == 3) : (side == 0 || side == 1);
}

// Edge between tile a and its +x (axis 0) or +y (axis 1) neighbour.
bool mot_edge(ivec2 a, int axis, ivec2 n) {
  int ia = mot_idx(a), ib = mot_idx(a + MOT_D4[axis]);
  bool ca = mot_chp[ia], cb = mot_chp[ib];
  if (ca && cb) return false;
  float h = hashI(mot_wrap(a, n), MOT_SEED + (axis == 0 ? 11.0 : 13.0));
  if (ca || cb) return h < 0.85;   // chip pins
  return mot_wants(mot_dir[ia], a, axis) && mot_wants(mot_dir[ib], a + MOT_D4[axis], axis + 2) && h < u_traces;
}

// Diagonal-bus pair: a chamfer when both ends are live, a stub ending in a pad mid-chamfer when one is.
vec2 mot_pair(vec2 l, bool A, bool B, vec2 ea, vec2 eb) {
  if (A && B) return vec2(sdSegment(l, ea, eb), 1e9);
  if (!A && !B) return vec2(1e9);
  vec2 m = 0.5 * (ea + eb);
  return vec2(sdSegment(l, A ? ea : eb, m), length(l - m) - u_pad);
}

// Line-centre distance (x) and solid distance (y) of circuit tile c at offset l (px from the tile centre).
vec2 mot_circuitTile(ivec2 c, vec2 l, vec2 cs, ivec2 n) {
  ivec2 cw = mot_wrap(c, n);
  vec2 h = 0.5 * cs;
  vec2 eR = vec2(h.x, 0.0), eL = vec2(-h.x, 0.0), eU = vec2(0.0, h.y), eD = vec2(0.0, -h.y);
  bool R = mot_edge(c, 0, n), L = mot_edge(c - ivec2(1, 0), 0, n);
  bool U = mot_edge(c, 1, n), D = mot_edge(c - ivec2(0, 1), 1, n);
  float dl = 1e9, ds = 1e9;
  int ci = mot_idx(c);
  if (mot_chp[ci]) {
    // Body: the 2×2-tile block inset by a third of a tile; pins run from each live edge to the body.
    ivec2 r = cw - ivec2(floor(vec2(cw) / 4.0)) * 4;
    vec2 bc = (1.5 - vec2(r)) * cs;
    ds = sdBox(l - bc, max(cs - max(cs / 3.0, vec2(u_width)), vec2(0.5)));
    if (R) dl = min(dl, sdSegment(l, eR, vec2(0.0)));
    if (L) dl = min(dl, sdSegment(l, eL, vec2(0.0)));
    if (U) dl = min(dl, sdSegment(l, eU, vec2(0.0)));
    if (D) dl = min(dl, sdSegment(l, eD, vec2(0.0)));
    return vec2(dl, ds);
  }
  int k = int(R) + int(L) + int(U) + int(D);
  vec3 hh = hash3I(cw, MOT_SEED + 5.0);
  float pad = length(l) - u_pad;
  int dir = mot_dir[ci];
  if (k == 0) return vec2(1e9, hh.x < u_vias ? pad : 1e9);
  if ((dir == 0 && !U && !D) || (dir == 1 && !R && !L)) {
    // Straight bus: through, or a trace end with a pad.
    bool a = dir == 0 ? R : U, b = dir == 0 ? L : D;
    vec2 ea = dir == 0 ? eR : eU, eb = dir == 0 ? eL : eD;
    if (a && b) return vec2(sdSegment(l, ea, eb), 1e9);
    return vec2(sdSegment(l, a ? ea : eb, vec2(0.0)), pad);
  }
  if (dir >= 2) {
    // Diagonal bus: one chamfer per tile (see mot_wants); chained, they form 45° lines.
    vec2 p1 = dir == 2 ? mot_pair(l, L, U, eL, eU) : mot_pair(l, L, D, eL, eD);
    vec2 p2 = dir == 2 ? mot_pair(l, R, D, eR, eD) : mot_pair(l, R, U, eR, eU);
    return min(p1, p2);
  }
  // Random traces (and any tile whose edges do not fit its bus).
  if (k == 1) {
    dl = sdSegment(l, R ? eR : L ? eL : U ? eU : eD, vec2(0.0));
    ds = pad;
  } else if (k == 2) {
    if (R && L) dl = sdSegment(l, eR, eL);
    else if (U && D) dl = sdSegment(l, eU, eD);
    else {
      vec2 a = R ? eR : eL, b = U ? eU : eD;
      dl = hh.y < u_bend ? sdSegment(l, a, b) : min(sdSegment(l, a, vec2(0.0)), sdSegment(l, vec2(0.0), b));
    }
  } else if (k == 3) {
    // The odd edge either tees into the through trace, or the corner pair is chamfered and the remaining edge
    // ends in a pad part-way in.
    bool horiz = R && L;
    vec2 a1 = horiz ? eR : eU, a2 = horiz ? eL : eD;
    vec2 o = horiz ? (U ? eU : eD) : (R ? eR : eL);
    if (hh.y < u_bend * 0.5) {
      vec2 keep = hh.z < 0.5 ? a1 : a2, lone = hh.z < 0.5 ? a2 : a1;
      dl = min(sdSegment(l, keep, o), sdSegment(l, lone, lone * 0.4));
      ds = length(l - lone * 0.4) - u_pad;
    } else {
      dl = min(sdSegment(l, a1, a2), sdSegment(l, o, vec2(0.0)));
    }
  } else {
    if (hh.y < u_bend) {
      dl = hh.z < 0.5 ? min(sdSegment(l, eR, eU), sdSegment(l, eL, eD)) : min(sdSegment(l, eR, eD), sdSegment(l, eL, eU));
    } else {
      dl = min(sdSegment(l, eR, eL), sdSegment(l, eU, eD));
      ds = pad;
    }
  }
  return vec2(dl, ds);
}

GenOut gen(vec2 p) {
  int style = u_style;
  int key = clamp(u_key, 1, 6);
  int P = key + 1;
  ivec2 n = mot_cellCount(style == 4 ? P : 1);
  // User space (y down), shifted by half the line width so a line on lattice line k covers [k·cell, k·cell + w):
  // whole-pixel cells and widths put every straight edge on a pixel boundary.
  vec2 u = vec2(p.x, uRes.y - p.y) - 0.5 * u_width - vec2(u_offset_x, u_offset_y) * uRes / vec2(n);
  vec2 res = uRes;
  if (style == 4 && u_vertical) { u = u.yx; n = n.yx; res = res.yx; }
  vec2 cs = res / vec2(n);
  float hw = 0.5 * u_width;
  float best = 1e9, solid = 1e9;
  float rnd = 0.0;

  if (style <= 1) {
    // Truchet arcs / diagonals: one random orientation bit per tile.
    ivec2 c0 = ivec2(floor(u / cs));
    float m = min(cs.x, cs.y);
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      ivec2 c = c0 + ivec2(i, j);
      ivec2 cw = mot_wrap(c, n);
      vec3 h = hash3I(cw, MOT_SEED);
      if (h.x >= u_density) continue;
      vec2 l = u - vec2(c) * cs;
      float d;
      if (style == 0) {
        vec2 L = l * (m / cs);   // square frame (non-square cells squash the arcs)
        float r = 0.5 * m;
        d = h.y < 0.5
          ? min(mot_quarterArc(L, vec2(0.0), r, vec2(1.0)), mot_quarterArc(L, vec2(m), r, vec2(-1.0)))
          : min(mot_quarterArc(L, vec2(m, 0.0), r, vec2(-1.0, 1.0)), mot_quarterArc(L, vec2(0.0, m), r, vec2(1.0, -1.0)));
      } else {
        d = h.y < 0.5 ? sdSegment(l, vec2(0.0), cs) : sdSegment(l, vec2(cs.x, 0.0), vec2(0.0, cs.y));
      }
      if (d < best) { best = d; rnd = h.z; }
    }
  } else if (style == 2) {
    // Maze: walls on lattice lines; each node grows one wall towards a random neighbour.
    ivec2 c0 = ivec2(floor(u / cs));
    for (int j = -1; j <= 2; j++)
    for (int i = -1; i <= 2; i++) {
      ivec2 c = c0 + ivec2(i, j);
      vec3 h = hash3I(mot_wrap(c, n), MOT_SEED + 3.0);
      if (h.x >= u_density) continue;
      float d = sdSegment(u, vec2(c) * cs, vec2(c + MOT_D4[int(h.y * 4.0)]) * cs);
      if (d < best) { best = d; rnd = h.z; }
    }
  } else if (style == 3) {
    // Rooms: the +x and +y walls of the 3×3 cells around the pixel (cell c spans lattice [c, c + 1]).
    ivec2 c0 = ivec2(floor(u / cs));
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      ivec2 c = c0 + ivec2(i, j);
      vec2 o = vec2(c + 1) * cs;
      if (mot_wall(c, 0, n)) best = min(best, sdSegment(u, o, vec2(o.x, o.y - cs.y)));
      if (mot_wall(c, 1, n)) best = min(best, sdSegment(u, o, vec2(o.x - cs.x, o.y)));
    }
    rnd = hashI(mot_wrap(c0, n), MOT_SEED);
  } else if (style == 4) {
    // Meander: a spiral key of 2·key moves (lengths key, key, key−1, key−1, … 1, 1) hangs from a rail every
    // P = key + 1 cells; bands repeat every P cells down, so each rail is also the next band's top.
    vec2 g = u / cs;
    ivec2 k0 = ivec2(floor(g / float(P)));
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      ivec2 k = k0 + ivec2(i, j);
      vec2 lq = g - vec2(k * P);
      lq.y = float(P) - lq.y;   // the key grows up from its rail (bottom of the band)
      vec2 lp = lq * cs;
      float d = u_borders ? sdSegment(lp, vec2(0.0), vec2(float(P), 0.0) * cs) : 1e9;
      vec2 pt = vec2(0.0);
      for (int s = 0; s < 12; s++) {
        if (s >= 2 * key) break;
        vec2 nx = pt + vec2(MOT_D4[(5 - s % 4) % 4]) * float(key - s / 2);   // up, right, down, left, …
        d = min(d, sdSegment(lp, pt * cs, nx * cs));
        pt = nx;
      }
      if (d < best) { best = d; rnd = hashI(mot_wrap(k, max(n / P, ivec2(1))), MOT_SEED); }
    }
  } else {
    // Circuit: tiles centred on lattice nodes (traces run along lattice lines).
    ivec2 c0 = ivec2(floor(u / cs + 0.5));
    mot_c0 = c0;
    for (int j = -2; j <= 2; j++)
    for (int i = -2; i <= 2; i++) {
      ivec2 cw = mot_wrap(c0 + ivec2(i, j), n);
      int idx = (j + 2) * 5 + i + 2;
      mot_dir[idx] = mot_regionDir(cw, n, mot_rr[idx]);
      mot_chp[idx] = mot_chip(cw, n);
    }
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      ivec2 c = c0 + ivec2(i, j);
      vec2 t = mot_circuitTile(c, u - vec2(c) * cs, cs, n);
      if (min(t.x - hw, t.y) < min(best - hw, solid)) rnd = mot_rr[mot_idx(c)];
      best = min(best, t.x);
      solid = min(solid, t.y);
    }
  }
  return genOut(0.0, 1.0, rnd, min(best - hw, solid));
}
`,
}

/** Motif-family layers, in add-menu order. */
export const MOTIF_LAYERS: LayerDef[] = [truchetLayer, rosetteLayer, glyphLayer]
