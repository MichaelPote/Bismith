// Pipework (FR8.12): runs of pipe on a wall — straight lengths, filleted elbows, tees, crossings, collars and bolted
// flanges — as true cylinders: the value is the surface height (the light shades them round and they cast shadows).
// The network is built on the CPU (pipesGeometry.ts) from drawn polylines or a random tileable layout and handed over
// as a primitive list; the shader keeps the highest surface over each pixel. Surface height is normalised to 4 × the
// pipe radius (value 1); Coverage writes the pipes' outline to the shape register (signed distance) so later layers
// can clip to them.

import { P } from '@/core/params'
import type { ParamValues } from '@/core/params'
import type { LayerDef } from '../types'
import { buildPrims, encodePrims, parseRuns, randomRuns, stackHeight, type PipeOptions, type PipeRun } from './pipesGeometry'

const isRandom = (p: Record<string, unknown>) => (p.layout ?? 'random') === 'random'
const isDrawn = (p: Record<string, unknown>) => p.layout === 'drawn'

/** The runs of a layer (drawn or random) at a texture size. */
export function pipeRuns(q: ParamValues, o: PipeOptions): PipeRun[] {
  const radius = Number(q.radius ?? 6)
  const variety = Number(q.variety ?? 0.3)
  if (q.layout === 'drawn') {
    const lines = parseRuns(String(q.points ?? ''), q.units === 'fraction', o.width, o.height)
    const inside = ([x, y]: [number, number]) => x > 0 && y > 0 && x < o.width && y < o.height
    const runs: PipeRun[] = lines.map((pts, i) => ({
      points: pts,
      radius: Math.max(1, radius * (1 + variety * 0.8 * (((i * 0.618034) % 1) - 0.5))),
      depth: 0,
      capStart: inside(pts[0]),
      capEnd: inside(pts[pts.length - 1]),
    }))
    // An end on another run tees into it.
    const onRun = (pt: [number, number], self: number): { r: number; j: number } | undefined => {
      for (let j = 0; j < runs.length; j++) {
        if (j === self) continue
        const ps = runs[j].points
        for (let k = 0; k + 1 < ps.length; k++) {
          const [ax, ay] = ps[k]
          const [bx, by] = ps[k + 1]
          const ex = bx - ax
          const ey = by - ay
          const t = Math.max(0, Math.min(1, ((pt[0] - ax) * ex + (pt[1] - ay) * ey) / Math.max(ex * ex + ey * ey, 1e-9)))
          if (Math.hypot(pt[0] - ax - ex * t, pt[1] - ay - ey * t) <= runs[j].radius) return { r: runs[j].radius, j }
        }
      }
      return undefined
    }
    runs.forEach((run, i) => {
      const a = onRun(run.points[0], i)
      const b = onRun(run.points[run.points.length - 1], i)
      run.teeStart = a?.r
      run.teeEnd = b?.r
      run.joins = [a?.j, b?.j].filter((j): j is number => j !== undefined)
      if (run.teeStart !== undefined) run.capStart = false
      if (run.teeEnd !== undefined) run.capEnd = false
      // A branch a little narrower than the pipe it joins meets it in a curved saddle (equal sizes show a sharp V).
      const joins = Math.min(run.teeStart ?? Infinity, run.teeEnd ?? Infinity)
      if (Number.isFinite(joins)) run.radius = Math.min(run.radius, joins * 0.85)
    })
    return runs
  }
  return randomRuns(o, {
    runs: Math.round(Number(q.runs ?? 3)),
    drops: Math.round(Number(q.drops ?? 2)),
    radius,
    variety,
    jogs: Number(q.jogs ?? 0.5),
    tees: Number(q.tees ?? 0.5),
    density: Number(q.density ?? 0),
  })
}

export const pipeworkLayer: LayerDef = {
  type: 'pipework',
  label: 'Pipework',
  category: 'shape',
  kind: 'generator',
  sdf: true,
  description: 'Pipe runs on a wall: straight lengths, rounded elbows, tees and crossings, collars and bolted flanges — round, lit, shadow-casting. Drawn runs or a random tileable layout.',
  params: [
    P.enum('output', 'Output', 'height', [['height', 'Surface height'], ['cover', 'Coverage'], ['fittings', 'Fittings'], ['underside', 'Underside'], ['tubes', 'Tubes only'], ['facing', 'Facing the light'], ['liquid', 'Liquid']], {
      hint: 'Surface height: the round pipes (for relief; 1 = 4 × the pipe radius). Coverage: the pipes\' outline (writes the shape mask, so later layers can clip to the pipes). Fittings: 1 on collars and flanges. Underside: 0 on top of a pipe → 1 underneath (rust, grime). Tubes only: the outline of the tubes without their fittings (writes the shape mask — e.g. glass tubes with metal collars). Facing the light: across each pipe, 1 on the side towards the top-left → 0 away (reflection bands on chrome). Liquid: 1 below each run\'s liquid surface (Liquid level)',
    }),
    P.enum('layout', 'Layout', 'random', [['random', 'Random (tileable)'], ['drawn', 'Drawn runs']]),
    P.bitmap('points', 'Runs', '0,24 40,24 40,48 64,48 | 20,0 20,24', 'lines', {
      hint: 'x,y centre-line points (px from the top-left, or 0..1 with Units = fraction); one run per line or "|". Ends inside the texture get a flange; an end on another run tees into it',
      showIf: isDrawn,
      uniform: false,
    }),
    P.enum('units', 'Units', 'px', [['px', 'Pixels'], ['fraction', 'Fraction of the texture']], { showIf: isDrawn }),
    P.int('runs', 'Horizontal runs', 3, 0, 64, { softMax: 16, showIf: isRandom, hint: 'Runs keep clear of each other while there is room; beyond that they lie over the ones they overlap' }),
    P.int('drops', 'Vertical runs', 2, 0, 64, { softMax: 16, showIf: isRandom, hint: 'In front of the horizontal runs; beyond the room for them they lie over the ones they overlap' }),
    P.float('jogs', 'Jogs', 0.5, 0, 1, { step: 0.01, showIf: isRandom, hint: 'Chance a horizontal run steps up or down and back (two pairs of elbows)' }),
    P.float('tees', 'Tees', 0.5, 0, 1, { step: 0.01, showIf: isRandom, hint: 'Chance a vertical run tees between two horizontal runs instead of passing in front of them' }),
    P.float('density', 'Density', 0, 0, 1, {
      step: 0.01,
      showIf: isRandom,
      hint: 'Stack more pipes in front of these — horizontal, vertical, horizontal … each layer resting on the one behind — until this share of the bare wall is covered (1 = none left). A stack taller than four pipe radii is scaled to fit the height range: raise the height amount for rounder pipes',
    }),
    P.float('radius', 'Pipe radius', 6, 0.5, 256, { softMax: 32, unit: 'px', step: 0.1 }),
    P.float('variety', 'Radius variety', 0.3, 0, 1, { step: 0.01 }),
    P.float('bend', 'Bend radius', 2, 1, 8, { step: 0.01, hint: 'Elbow centre-line radius in pipe radii' }),
    P.float('spacing', 'Coupling spacing', 48, 0, 4096, { softMax: 256, unit: 'px', step: 1, hint: 'Collars along straight lengths (0 = none)' }),
    P.float('flanges', 'Flanges', 0.3, 0, 1, { step: 0.01, hint: 'Chance a coupling is a bolted flange' }),
    P.float('collar', 'Collar size', 0.15, 0, 1, { step: 0.01, hint: 'How far collars stand proud (flanges twice that), in pipe radii' }),
    P.bool('elbow_fittings', 'Elbow collars', true),
    P.float('fill', 'Liquid level', 0.5, 0, 1, { step: 0.01, hint: 'For the Liquid output: how full each run\'s lowest horizontal pipe is; the surface stays level through bends and drops' }),
    P.seed(),
  ],
  defaults: { h_on: true, h_amount: 1, dif_on: true, bevel: 0, profile: 'flat' },
  textures: ['pipes'],
  cpuData(q, ctx) {
    const o: PipeOptions = {
      width: ctx.width,
      height: ctx.height,
      tile: ctx.tileable,
      seed: Math.floor(ctx.seed * 7919) + Number(q.seed ?? 0),
      bend: Number(q.bend ?? 2),
      spacing: Number(q.spacing ?? 48),
      flanges: Number(q.flanges ?? 0.3),
      collar: Number(q.collar ?? 0.15),
      elbowFittings: q.elbow_fittings !== false,
      fill: Number(q.fill ?? 0.5),
    }
    const prims = buildPrims(pipeRuns(q, o), o)
    // A stack taller than the default 4 × radius (density, runs lying over runs) is scaled to fit rather than having its
    // front pipes clipped flat; one that fits keeps the default (0 in the header).
    const top = stackHeight(prims)
    return { pipes: encodePrims(prims, top > 4 * Math.max(Number(q.radius ?? 6), 0.5) ? top : 0) }
  },
  glsl: /* glsl */ `
float pp_u16(vec2 b) { return floor(b.x * 255.0 + 0.5) * 256.0 + floor(b.y * 255.0 + 0.5); }
vec2 pp_pos(vec4 t) { return vec2(pp_u16(t.rg), pp_u16(t.ba)) / 8.0 - 4096.0; }
float pp_ang(vec2 b, float range) { return (pp_u16(b) / 65535.0 * 2.0 - 1.0) * range; }

GenOut gen(vec2 p) {
  vec2 q = vec2(p.x, uRes.y - p.y);
  vec4 head = texelFetch(t_pipes, ivec2(0, 0), 0);
  int n = int(pp_u16(head.rg));
  // Height for a value of 1: from the header when the layout set one (a dense stack), else 4 × the pipe radius.
  float hn = pp_u16(head.ba) / 16.0;
  float hnorm = hn > 0.0 ? hn : 4.0 * max(u_radius, 0.5);
  float sd = 1e4;
  float sdFit = 1e4;
  float sdTube = 1e4;
  float best = -1.0;
  float cover = 0.0;
  float fit = 0.0;
  float under = 0.5;
  float liq = 0.0;
  float facing = 0.5;
  // Towards the (top-left) light, y down.
  const vec2 PP_D = vec2(-0.70710678, -0.70710678);
  float pid = 0.0;
  for (int i = 0; i < 4096; i++) {
    if (i >= n) break;
    int t = 1 + 5 * i;
    vec4 t0 = texelFetch(t_pipes, ivec2(t, 0), 0);
    vec4 t1 = texelFetch(t_pipes, ivec2(t + 1, 0), 0);
    vec4 t2 = texelFetch(t_pipes, ivec2(t + 2, 0), 0);
    vec4 t3 = texelFetch(t_pipes, ivec2(t + 3, 0), 0);
    vec4 t4 = texelFetch(t_pipes, ivec2(t + 4, 0), 0);
    int kind = int(t3.r * 255.0 + 0.5);
    float r = pp_u16(t3.ba) / 64.0;
    float depth = pp_u16(t4.rg) / 16.0;
    float level = pp_u16(t4.ba) / 8.0 - 4096.0;
    vec2 a = pp_pos(t0);
    float h = -1.0, cv = 0.0, ny = 0.0;
    // Cross-section: offset from the axis over the radius (2D) and the axis normal, for Facing.
    vec2 off = vec2(0.0), an = vec2(0.0, 1.0);
    if (kind == 0) {
      // Straight length: distance to the centre line.
      vec2 b = pp_pos(t1);
      vec2 e = b - a;
      vec2 c = a + e * clamp(dot(q - a, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
      vec2 dv = q - c;
      float d = length(dv);
      sd = min(sd, d - r);
      sdTube = min(sdTube, d - r);
      if (d > r + 1.0) continue;
      cv = clamp(r - d + 0.5, 0.0, 1.0);
      if (d < r) h = depth + sqrt(r * r - d * d);
      ny = dv.y / max(r, 1e-3);
      off = dv / max(r, 1e-3);
      an = normalize(vec2(-e.y, e.x));
    } else if (kind == 1) {
      // Elbow: an arc of the bend radius around its centre.
      float rb = pp_u16(t1.rg) / 8.0;
      float a0 = pp_ang(t1.ba, 3.14159265);
      float sw = pp_ang(t2.rg, 6.28318531);
      vec2 dv = q - a;
      float l = length(dv);
      if (abs(l - rb) > r + 1.0) continue;
      float ph = atan(dv.y, dv.x);
      float rel = sw >= 0.0 ? mod(ph - a0, 6.28318531) : mod(a0 - ph, 6.28318531);
      if (rel > abs(sw)) continue;
      float d = abs(l - rb);
      sd = min(sd, d - r);
      sdTube = min(sdTube, d - r);
      cv = clamp(r - d + 0.5, 0.0, 1.0);
      if (d < r) h = depth + sqrt(r * r - d * d);
      ny = (dv.y / max(l, 1e-3)) * sign(l - rb) * d / max(r, 1e-3);
      an = dv / max(l, 1e-3);
      off = an * (l - rb) / max(r, 1e-3);
    } else {
      // Collar / flange: a short, wider cylinder around the axis. A flange is two plates (a groove between them)
      // with bolt heads standing on the rim.
      float ax = pp_ang(t1.rg, 3.14159265);
      float hw = pp_u16(t1.ba) / 64.0;
      float ro = pp_u16(t2.rg) / 64.0;
      vec2 tx = vec2(cos(ax), sin(ax));
      vec2 nx = vec2(-tx.y, tx.x);
      vec2 dv = q - a;
      float u = dot(dv, tx), v = dot(dv, nx);
      vec2 bx = abs(vec2(u, v)) - vec2(hw, ro);
      float sb = length(max(bx, 0.0)) + min(max(bx.x, bx.y), 0.0);
      sd = min(sd, sb);
      sdFit = min(sdFit, sb);
      if (bx.x > 1.0 || bx.y > 1.0) continue;
      cv = clamp(min(hw - abs(u), ro - abs(v)) + 0.5, 0.0, 1.0);
      if (abs(u) <= hw && abs(v) <= ro) {
        h = depth + sqrt(max(ro * ro - v * v, 0.0)) * (0.88 + 0.12 * clamp(hw - abs(u), 0.0, 1.0));
        if (kind == 3) {
          h -= 0.1 * ro * (1.0 - clamp(abs(u) * 1.5, 0.0, 1.0));
          // Bolt heads around the rim, seen edge-on: a row of small bumps — a ridged ring.
          float bs = max(0.7, min(0.15 * ro, 0.8 * hw));
          for (int k = -2; k <= 2; k++) {
            float vb = float(k) * 0.38 * ro;
            float dd = length(vec2(u, v - vb)) / bs;
            if (dd < 1.0) h = max(h, depth + sqrt(max(ro * ro - vb * vb, 0.0)) + 0.4 * bs * sqrt(1.0 - dd * dd));
          }
        }
      }
      if (cv <= 0.0) continue;
      ny = v * nx.y / max(ro, 1e-3);
      an = nx;
      off = nx * v / max(ro, 1e-3);
    }
    cover = max(cover, cv);
    if (h > best) {
      best = h;
      fit = kind >= 2 ? 1.0 : 0.0;
      under = 0.5 + 0.5 * clamp(ny, -1.0, 1.0);
      liq = clamp(q.y - level + 0.5, 0.0, 1.0);
      facing = 0.5 + 0.5 * clamp(dot(off, PP_D) / max(abs(dot(an, PP_D)), 0.3), -1.0, 1.0);
      pid = pp_u16(t2.ba);
    }
  }
  float rnd = hashI(ivec2(int(pid), 3), uSeed);
  if (u_output == 1) return genOut(1.0, 1.0, rnd, sd);
  if (u_output == 4) {
    // Tubes: the straight lengths and elbows, less the fittings over them.
    return genOut(1.0, 1.0, rnd, max(sdTube, -sdFit));
  }
  if (cover <= 0.0) return genOut(0.0, 0.0, 0.0, NO_SDF);
  if (u_output == 2) return genOut(fit, cover, rnd, NO_SDF);
  if (u_output == 3) return genOut(under, cover, rnd, NO_SDF);
  if (u_output == 5) return genOut(facing, cover, rnd, NO_SDF);
  if (u_output == 6) return genOut(liq, cover, rnd, NO_SDF);
  return genOut(clamp(max(best, 0.0) / hnorm, 0.0, 1.0), cover, rnd, NO_SDF);
}
`,
}
