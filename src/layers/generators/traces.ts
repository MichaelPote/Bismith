// Traces & mazes (FR8.8): circuit-board traces and diagonal mazes on a grid of nodes. The diagonal angle sets the
// cell aspect (45° = square cells), so diagonals can be any angle and still tile.
//   Route: paths with no junctions or crossings, bending where blocks of cells meet (routed buses).
//   Maze:  independent links east / north and, by chance, diagonally; junctions allowed.
//   Fill:  space-filling routing (router.ts): seed walks, then traces filling the rest without touching.
// Every mode's links are computed per node on the CPU (traceLinks.ts, router.ts) and read here from a per-node texture;
// the shader only draws them. Pads on ends, vias; the result is an SDF (traces, pads and vias), value 1 inside.

import { P } from '@/core/params'
import type { LayerDef } from '../types'
import { ROUTE_DIRS, routeTraces } from './router'
import { KING, traceLinks } from './traceLinks'

/** Router direction (a ROUTE_DIRS index) → link-mask bit. The router only takes king moves (even entries). */
const KING_BIT = ROUTE_DIRS.map(([x, y]) => 1 << KING.findIndex(([kx, ky]) => kx === x && ky === y))

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
  // R = link mask (bit d: a trace toward KING[d]), G = flags (1 trace end, 2 via).
  cpuData(q, ctx) {
    const nx = Math.max(1, Math.round(Number(q.cells ?? 12)))
    const cw = ctx.width / nx
    const ch = cw * Math.tan((Math.min(80, Math.max(10, Number(q.angle ?? 45))) * Math.PI) / 180)
    const ny = Math.max(1, Math.round(ctx.height / ch))
    let links: Uint8Array
    let flags: Uint8Array
    if (q.mode === 'fill') {
      const r = routeTraces({
        nx, ny, wrap: ctx.tileable, seed: Math.floor(ctx.seed * 7919) + 1, seeds: Math.round(Number(q.seeds ?? 3)), seedLength: Math.round(Number(q.seed_length ?? 80)),
        minLength: Math.round(Number(q.min_length ?? 4)), maxLength: Math.round(Number(q.max_length ?? 40)), gap: Math.round(Number(q.gap ?? 0)),
        straight: Number(q.straight ?? 0.8), directions: (Number(q.directions ?? 8) === 4 ? 4 : Number(q.directions ?? 8) === 6 ? 6 : 8) as 4 | 6 | 8, hug: Number(q.hug ?? 0.6), fill: Number(q.fill ?? 1), vias: Number(q.vias ?? 0.1), pins: Number(q.pins ?? 0.15),
      })
      links = new Uint8Array(nx * ny)
      for (let i = 0; i < nx * ny; i++) if (r.out[i] >= 0) links[i] = KING_BIT[r.out[i]]
      flags = r.flags
    } else {
      ;({ links, flags } = traceLinks({
        mode: q.mode === 'maze' ? 'maze' : 'route', nx, ny, wrap: ctx.tileable, seed: ctx.seed,
        density: Number(q.density ?? 0.6), diagonal: Number(q.diagonal ?? 0.4), bias: Number(q.bias ?? 0.5), straight: Number(q.straight ?? 0.8),
        grouping: Number(q.grouping ?? 0.7), block: Number(q.block ?? 4), vias: Number(q.vias ?? 0.1),
      }))
    }
    const data = new Uint8Array(nx * ny * 4)
    for (let i = 0; i < nx * ny; i++) {
      data[i * 4] = links[i]
      data[i * 4 + 1] = flags[i] & 3
      data[i * 4 + 3] = 255
    }
    return { route: { width: nx, height: ny, data } }
  },
  glsl: /* glsl */ `
const ivec2 KING[8] = ivec2[8](${KING.map(([x, y]) => `ivec2(${x}, ${y})`).join(', ')});
ivec2 tr_n;
vec2 tr_cs;

ivec2 tr_w(ivec2 k) { return uTile ? imod(k, tr_n) : k; }
float tr_h(ivec2 k, float salt) { return hashI(tr_w(k), uSeed + salt); }
bool tr_in(ivec2 k) { return uTile || (k.x >= 0 && k.y >= 0 && k.x < tr_n.x && k.y < tr_n.y); }
// Node centres snapped to pixel centres, so 1 px traces stay 1 px (a centre on a pixel edge smears into two).
vec2 tr_node(ivec2 k) { return floor((vec2(k) + 0.5) * tr_cs) + 0.5; }

GenOut gen(vec2 p) {
  tr_n = textureSize(t_route, 0);
  tr_cs = uRes / vec2(tr_n);
  ivec2 c0 = ivec2(floor(p / tr_cs - 0.5));
  float best = 1e4;
  float bestId = 0.0;
  float hw = 0.5 * u_width;
  // Nodes around the pixel: 4×4 (6×6 for fill, as it has always searched). The count comes from a uniform, so D3D's
  // compiler (ANGLE on Windows) keeps this a loop instead of unrolling it.
  int span = u_mode == 2 ? 6 : 4;
  for (int c = 0; c < span * span; c++) {
    ivec2 k = c0 + ivec2(c % span, c / span) - (span / 2 - 1);
    if (!tr_in(k)) continue;
    vec4 t = texelFetch(t_route, tr_w(k), 0);
    int links = int(t.r * 255.0 + 0.5);
    int fl = int(t.g * 255.0 + 0.5);
    vec2 a = tr_node(k);
    float id = float(tr_w(k).x + tr_w(k).y * 911);
    for (int d = 0; d < 8; d++) {
      if ((links & (1 << d)) == 0) continue;
      float dist = sdSegment(p, a, tr_node(k + KING[d])) - hw;
      if (dist < best) { best = dist; bestId = id; }
    }
    if ((fl & 1) != 0 && tr_h(k, 21.0) < u_pads) {
      vec2 q = p - a;
      float dist = u_pad_shape == 1 ? sdBox(q, vec2(u_pad_size)) : length(q) - u_pad_size;
      if (dist < best) { best = dist; bestId = id; }
    }
    if ((fl & 2) != 0) {
      float r = length(p - a);
      float dist = max(r - u_via_size, -(r - max(u_via_size - max(u_width, 0.75), 0.0)));
      if (dist < best) { best = dist; bestId = id; }
    }
  }
  return genOut(1.0, 1.0, hashI(ivec2(int(bestId), 5), uSeed), best);
}
`,
}
