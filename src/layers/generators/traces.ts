// Traces & mazes (FR8.8): circuit-board traces and diagonal mazes on a grid of nodes. The diagonal angle sets the
// cell aspect (45° = square cells), so diagonals can be any angle and still tile.
//   Route: every node has at most one outgoing link (straight on, or a 45° turn from its block's direction) and accepts
//          at most one incoming link (a fixed per-node priority among its neighbours) — so traces are paths: no
//          junctions, no crossings (crossing diagonals in one grid square: the square keeps one), a pad at each end.
//          Blocks of cells hold different directions, so paths bend where blocks meet: routed buses.
//   Maze:  independent links east / north and, by chance, diagonally — junctions allowed (a maze / lattice).
//   Fill:  space-filling routing computed on the CPU (router.ts): seed walks bending one step within one direction set
//          (8 / 6 / 4), then traces that fill the rest without touching, preferring to run alongside — read here from a
//          per-node texture.
// Pads on ends, vias; the result is an SDF (traces, pads and vias), value 1 inside.

import { P } from '@/core/params'
import type { LayerDef } from '../types'
import { ROUTE_DIRS, routeTraces } from './router'

export const tracesLayer: LayerDef = {
  type: 'traces',
  label: 'Traces & mazes',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Circuit traces or a maze with diagonals: a grid of nodes linked straight or diagonally (any angle), pads on dead ends, vias. Tileable.',
  params: [
    P.enum('mode', 'Mode', 'route', [['route', 'Route (paths, no junctions)'], ['maze', 'Maze (links, junctions)'], ['fill', 'Fill (routed, space-filling)']]),
    P.int('cells', 'Cells across', 12, 1, 256, { softMax: 48 }),
    P.float('angle', 'Diagonal angle', 45, 10, 80, { unit: '°', step: 0.5, hint: 'Slope of the diagonals; sets the row spacing (45° = square cells; rows are rounded to tile)' }),
    P.float('density', 'Density', 0.6, 0, 1, { step: 0.001, hint: 'Chance of each link' }),
    P.float('diagonal', 'Diagonals', 0.4, 0, 1, { step: 0.001, hint: 'Share of diagonal links (0 = a right-angle maze)' }),
    P.float('bias', 'Horizontal bias', 0.5, 0, 1, { step: 0.001, hint: 'Straight links: 0 = mostly vertical, 1 = mostly horizontal' }),
    P.float('straight', 'Straightness', 0.8, 0, 1, { step: 0.001, showIf: (p) => p.mode !== 'maze', hint: 'Route: chance a trace carries straight on (else it turns 45°)' }),
    P.float('grouping', 'Grouping', 0.7, 0, 1, { step: 0.001, showIf: (p) => p.mode === 'maze', hint: 'Links in a block follow its dominant direction — parallel bus runs instead of a tangle' }),
    P.int('block', 'Block size', 4, 1, 64, { softMax: 16, hint: 'Cells per block: a block shares one direction (route) / dominant direction (maze)' }),
    P.int('seeds', 'Seed traces', 3, 0, 64, { softMax: 16, group: 'fill', hint: 'Long random walks laid first' }),
    P.int('seed_length', 'Seed length', 80, 2, 4096, { softMax: 400, group: 'fill', hint: 'Steps' }),
    P.int('max_length', 'Fill length', 40, 2, 4096, { softMax: 200, group: 'fill', hint: 'Longest fill trace (steps)' }),
    P.int('min_length', 'Shortest trace', 4, 1, 64, { softMax: 16, group: 'fill', hint: 'Fill traces shorter than this are dropped' }),
    P.int('gap', 'Clearance', 0, 0, 4, { group: 'fill', hint: 'Free nodes kept between traces (0 = neighbouring nodes; traces still never touch or cross)' }),
    P.enum('directions', 'Directions', '8', [['8', '8 (straight + diagonals)'], ['6', '6 (no verticals; hexagonal at a 60° diagonal angle)'], ['4', '4 (right angles)']], { group: 'fill', hint: 'One fixed set — traces only bend between neighbouring directions of it' }),
    P.float('hug', 'Run alongside', 0.6, 0, 1, { step: 0.001, group: 'fill', hint: 'Preference for following a neighbouring trace (buses)' }),
    P.float('fill', 'Fill', 1, 0, 1, { step: 0.001, group: 'fill', hint: 'Share of the empty board new traces may start in' }),
    P.float('pins', 'Pin pads', 0.15, 0, 0.5, { step: 0.001, group: 'fill', hint: 'Chance each link breaks into two traces ending in pads — more pads, shorter traces' }),
    P.float('width', 'Trace width', 1, 0.25, 64, { softMax: 6, unit: 'px', step: 0.25 }),
    P.float('pads', 'Pads on ends', 0.7, 0, 1, { step: 0.001 }),
    P.float('pad_size', 'Pad radius', 1.5, 0, 64, { softMax: 6, unit: 'px', step: 0.25 }),
    P.enum('pad_shape', 'Pad shape', 'round', [['round', 'Round'], ['square', 'Square']]),
    P.float('vias', 'Vias', 0.1, 0, 1, { step: 0.001, hint: 'Chance of a ring at any linked node' }),
    P.float('via_size', 'Via radius', 1.5, 0, 64, { softMax: 6, unit: 'px', step: 0.25 }),
    P.seed(),
  ],
  groups: [{ id: 'fill', label: 'Fill routing' }],
  defaults: { h_on: true, h_amount: 0.15, bevel: 0.5, profile: 'linear', aa: false, dif_on: true, dif_src: 'flat' },
  textures: ['route'],
  // Fill mode: the router runs on the CPU; R = outgoing direction + 1 (0 none), G = flags (1 pad, 2 via, 4 on a trace).
  cpuData(q, ctx) {
    if (q.mode !== 'fill') return { route: { width: 1, height: 1, data: new Uint8Array(4) } }
    const nx = Math.max(1, Math.round(Number(q.cells ?? 12)))
    const cw = ctx.width / nx
    const ch = cw * Math.tan((Math.min(80, Math.max(10, Number(q.angle ?? 45))) * Math.PI) / 180)
    const ny = Math.max(1, Math.round(ctx.height / ch))
    const r = routeTraces({
      nx, ny, wrap: ctx.tileable, seed: Math.floor(ctx.seed * 7919) + 1, seeds: Math.round(Number(q.seeds ?? 3)), seedLength: Math.round(Number(q.seed_length ?? 80)),
      minLength: Math.round(Number(q.min_length ?? 4)), maxLength: Math.round(Number(q.max_length ?? 40)), gap: Math.round(Number(q.gap ?? 0)),
      straight: Number(q.straight ?? 0.8), directions: (Number(q.directions ?? 8) === 4 ? 4 : Number(q.directions ?? 8) === 6 ? 6 : 8) as 4 | 6 | 8, hug: Number(q.hug ?? 0.6), fill: Number(q.fill ?? 1), vias: Number(q.vias ?? 0.1), pins: Number(q.pins ?? 0.15),
    })
    const data = new Uint8Array(nx * ny * 4)
    for (let i = 0; i < nx * ny; i++) {
      data[i * 4] = r.out[i] + 1
      data[i * 4 + 1] = r.flags[i]
      data[i * 4 + 3] = 255
    }
    return { route: { width: nx, height: ny, data } }
  },
  glsl: /* glsl */ `
const ivec2 RT16[16] = ivec2[16](${ROUTE_DIRS.map(([x, y]) => `ivec2(${x}, ${y})`).join(', ')});
ivec2 tr_n;
vec2 tr_cs;

ivec2 tr_w(ivec2 k) { return uTile ? imod(k, tr_n) : k; }
float tr_h(ivec2 k, float salt) { return hashI(tr_w(k), uSeed + salt); }
bool tr_in(ivec2 k) { return uTile || (k.x >= 0 && k.y >= 0 && k.x < tr_n.x && k.y < tr_n.y); }

// Links stored once per node: 0 east, 1 north, 2 north-east, 3 south-east.
bool tr_raw(ivec2 k, int dir) {
  if (!tr_in(k)) return false;
  float d = clamp(u_diagonal, 0.0, 1.0);
  float pStraight = u_density * (1.0 - d);
  float pDiag = u_density * d;
  float p = dir == 0 ? pStraight * 2.0 * u_bias : dir == 1 ? pStraight * 2.0 * (1.0 - u_bias) : pDiag;
  // Grouping: each block of cells has a dominant direction (chosen with the same weights); its links mostly follow it.
  ivec2 bn = max(tr_n / max(u_block, 1), ivec2(1));
  ivec2 b = ivec2(floor(vec2(tr_w(k)) / float(max(u_block, 1))));
  b = uTile ? imod(b, bn) : b;
  float r = hashI(b, uSeed + 41.0) * (2.0 * (1.0 - d) + 2.0 * d);
  int dom = r < 2.0 * (1.0 - d) * u_bias ? 0 : r < 2.0 * (1.0 - d) ? 1 : r < 2.0 * (1.0 - d) + d ? 2 : 3;
  p = mix(p, dir == dom ? u_density : u_density * 0.08, clamp(u_grouping, 0.0, 1.0));
  return tr_h(k, 1.0 + float(dir)) < p;
}
// The two diagonals of the square [k, k + (1,1)] cross: the square picks one.
bool tr_pickNE(ivec2 k) { return tr_h(k, 9.0) < 0.5; }
bool tr_link(ivec2 k, int dir) {
  if (dir == 2) return tr_raw(k, 2) && tr_pickNE(k) && tr_in(k + ivec2(1, 1));
  if (dir == 3) return tr_raw(k, 3) && !tr_pickNE(k - ivec2(0, 1)) && tr_in(k + ivec2(1, -1));
  if (dir == 0) return tr_raw(k, 0) && tr_in(k + ivec2(1, 0));
  return tr_raw(k, 1) && tr_in(k + ivec2(0, 1));
}
ivec2 tr_step(int dir) { return dir == 0 ? ivec2(1, 0) : dir == 1 ? ivec2(0, 1) : dir == 2 ? ivec2(1, 1) : ivec2(1, -1); }
int tr_degree(ivec2 k) {
  int n = 0;
  for (int dir = 0; dir < 4; dir++) {
    if (tr_link(k, dir)) n++;
    if (tr_link(k - tr_step(dir), dir)) n++;
  }
  return n;
}
// Node centres snapped to pixel centres, so 1 px traces stay 1 px (a centre on a pixel edge smears into two).
vec2 tr_node(ivec2 k) { return floor((vec2(k) + 0.5) * tr_cs) + 0.5; }

// ---------------------------------------------------------------- route mode (8 directions, E then counter-clockwise)
ivec2 rt_step(int d) {
  d = ((d % 8) + 8) % 8;
  return d == 0 ? ivec2(1, 0) : d == 1 ? ivec2(1, 1) : d == 2 ? ivec2(0, 1) : d == 3 ? ivec2(-1, 1)
       : d == 4 ? ivec2(-1, 0) : d == 5 ? ivec2(-1, -1) : d == 6 ? ivec2(0, -1) : ivec2(1, -1);
}
// The block's direction: straight (E / W by the horizontal bias, N / S) or diagonal, by the Diagonals share.
int rt_blockDir(ivec2 k) {
  ivec2 bn = max(tr_n / max(u_block, 1), ivec2(1));
  ivec2 b = ivec2(floor(vec2(tr_w(k)) / float(max(u_block, 1))));
  b = uTile ? imod(b, bn) : b;
  float h = hashI(b, uSeed + 41.0);
  float h2 = hashI(b, uSeed + 43.0);
  float dg = clamp(u_diagonal, 0.0, 1.0);
  if (h < dg) return 1 + 2 * int(floor(h2 * 4.0));          // NE, NW, SW, SE
  bool horiz = hashI(b, uSeed + 47.0) < u_bias;
  return (horiz ? 0 : 2) + (h2 < 0.5 ? 0 : 4);            // E / W or N / S
}
// The node's one outgoing direction, or -1.
int rt_out(ivec2 k) {
  if (!tr_in(k) || tr_h(k, 31.0) > u_density) return -1;
  int d = rt_blockDir(k);
  float t = tr_h(k, 33.0);
  float s = clamp(u_straight, 0.0, 1.0);
  int o = t < s ? d : t < s + 0.5 * (1.0 - s) ? d + 1 : d + 7;
  o = o % 8;
  return tr_in(k + rt_step(o)) ? o : -1;
}
// The one incoming direction a node accepts (its first predecessor, in a per-node priority order), or -1.
int rt_acc(ivec2 k) {
  int start = int(floor(tr_h(k, 37.0) * 8.0));
  for (int t = 0; t < 8; t++) {
    int a = (start + t) % 8;
    if (rt_out(k - rt_step(a)) == a) return a;
  }
  return -1;
}
bool rt_raw(ivec2 k, int d) { return rt_out(k) == d && rt_acc(k + rt_step(d)) == d; }
// A diagonal link and the other diagonal of its grid square: the square keeps only one of the two.
bool rt_link(ivec2 k, int d) {
  if (d < 0 || !rt_raw(k, d)) return false;
  if ((d & 1) == 0) return true;
  bool slash = d == 1 || d == 5;
  ivec2 c = d == 1 ? k : d == 5 ? k - ivec2(1, 1) : d == 3 ? k + ivec2(-1, 0) : k + ivec2(0, -1);
  bool keepSlash = tr_h(c, 51.0) < 0.5;
  if (slash == keepSlash) return true;
  bool other = slash ? (rt_raw(c + ivec2(1, 0), 3) || rt_raw(c + ivec2(0, 1), 7)) : (rt_raw(c, 1) || rt_raw(c + ivec2(1, 1), 5));
  return !other;
}
int rt_degree(ivec2 k) {
  int n = rt_link(k, rt_out(k)) ? 1 : 0;
  int a = rt_acc(k);
  if (a >= 0 && rt_link(k - rt_step(a), a)) n++;
  return n;
}

GenOut gen(vec2 p) {
  int nx = max(u_cells, 1);
  float cw = uRes.x / float(nx);
  float ch = cw * tan(radians(clamp(u_angle, 10.0, 80.0)));
  int ny = max(1, int(floor(uRes.y / ch + 0.5)));
  tr_n = ivec2(nx, ny);
  tr_cs = uRes / vec2(tr_n);
  ivec2 c0 = ivec2(floor(p / tr_cs - 0.5));
  float best = 1e4;
  float bestId = 0.0;
  float hw = 0.5 * u_width;
  bool route = u_mode == 0;
  if (u_mode == 2) {
    // Fill: links and flags from the router.
    for (int j = -2; j <= 3; j++)
      for (int i = -2; i <= 3; i++) {
        ivec2 k = c0 + ivec2(i, j);
        if (!tr_in(k)) continue;
        vec4 t = texelFetch(t_route, tr_w(k), 0);
        int dir = int(t.r * 255.0 + 0.5) - 1;
        int fl = int(t.g * 255.0 + 0.5);
        vec2 a = tr_node(k);
        if (dir >= 0) {
          float d = sdSegment(p, a, tr_node(k + RT16[dir])) - hw;
          if (d < best) { best = d; bestId = float(tr_w(k).x + tr_w(k).y * 911); }
        }
        if ((fl & 1) != 0 && u_pads > 0.0 && tr_h(k, 21.0) < u_pads) {
          vec2 q = p - a;
          float d = u_pad_shape == 1 ? sdBox(q, vec2(u_pad_size)) : length(q) - u_pad_size;
          if (d < best) { best = d; bestId = float(tr_w(k).x + tr_w(k).y * 911); }
        }
        if ((fl & 2) != 0) {
          float r = length(p - a);
          float d = max(r - u_via_size, -(r - max(u_via_size - max(u_width, 0.75), 0.0)));
          if (d < best) { best = d; bestId = float(tr_w(k).x + tr_w(k).y * 911); }
        }
      }
    return genOut(1.0, 1.0, hashI(ivec2(int(bestId), 5), uSeed), best);
  }
  for (int j = -1; j <= 2; j++)
    for (int i = -1; i <= 2; i++) {
      ivec2 k = c0 + ivec2(i, j);
      if (!tr_in(k)) continue;
      vec2 a = tr_node(k);
      if (route) {
        int o = rt_out(k);
        if (rt_link(k, o)) {
          float d = sdSegment(p, a, tr_node(k + rt_step(o))) - hw;
          if (d < best) { best = d; bestId = float(tr_w(k).x + tr_w(k).y * 911); }
        }
      } else {
        for (int dir = 0; dir < 4; dir++) {
          if (!tr_link(k, dir)) continue;
          float d = sdSegment(p, a, tr_node(k + tr_step(dir))) - hw;
          if (d < best) { best = d; bestId = float(tr_w(k).x + tr_w(k).y * 911); }
        }
      }
      int deg = route ? rt_degree(k) : tr_degree(k);
      if (deg == 1 && tr_h(k, 21.0) < u_pads) {
        vec2 q = p - a;
        float d = u_pad_shape == 1 ? sdBox(q, vec2(u_pad_size)) : length(q) - u_pad_size;
        if (d < best) { best = d; bestId = float(tr_w(k).x + tr_w(k).y * 911); }
      }
      if (deg >= 1 && tr_h(k, 23.0) < u_vias) {
        float r = length(p - a);
        float d = max(r - u_via_size, -(r - max(u_via_size - max(u_width, 0.75), 0.0)));
        if (d < best) { best = d; bestId = float(tr_w(k).x + tr_w(k).y * 911); }
      }
    }
  return genOut(1.0, 1.0, hashI(ivec2(int(bestId), 5), uSeed), best);
}
`,
}
