// Tabs & notches (FR8.8): small greeble details with diagonal cuts — the clip notches on a grate frame,
// chevrons, bow-tie bridges, diagonal slits, chamfered plates, scallops — placed along the edges of its mask (the
// panels, planks or plates below), along the texture's edges, on a grid or scattered. A crisp SDF shape (value 1
// inside), meant for small relief (a lit 1–2 px chamfer) and colour.
//
// Local frame per element: u along its edge (centred), v inward from the edge (≥ 0 inside). Grid and scatter elements
// use the same frame centred on their cell.
//
// Along the mask: each pixel takes the nearest edge of the mask (its distance and normal from
// maskIn()), follows that edge both ways to where it stops being straight (a corner, a gap, the texture's border) and
// spreads the side's elements evenly over it — as many as asked for, fewer where the side is too short for them to
// clear its corners. Exact distances read ~0 all along a straight side, so a tight threshold finds its ends; curved
// edges never stay straight long enough to hold an element.

import { P, gradient } from '@/core/params'
import { spacingParams } from '../commonParams'
import type { LayerDef } from '../types'

const EDGES: [string, string][] = [
  ['sides', 'Left + right'],
  ['ends', 'Top + bottom'],
  ['all', 'All four'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
]

const onEdges = (p: Record<string, unknown>) => p.place === 'border' || p.place === 'shape'
const onCells = (p: Record<string, unknown>) => p.place === 'grid' || p.place === 'scatter'

export const tabsLayer: LayerDef = {
  type: 'tabs',
  label: 'Tabs & notches',
  category: 'shape',
  kind: 'generator',
  sdf: true,
  // Along the mask's edges: it reads the mask before it (the one it writes, or Shape).
  readsMask: true,
  description: 'Small details with diagonal cuts — trapezoid tabs, notches, chevrons, bow-ties, slits, chamfered plates, scallops — along the edges of a mask (the Shape mask by default) or the texture, on a grid or scattered.',
  params: [
    P.enum('shape', 'Shape', 'trapezoid', [
      ['trapezoid', 'Trapezoid tab (45° sides)', 'full length at the edge, sides cut inward at the Diagonal cut slope (negative: a dovetail)'],
      ['notch', 'Notch (triangle)'],
      ['chevron', 'Chevron (V stroke)'],
      ['bowtie', 'Bow-tie'],
      ['slit', 'Diagonal slit'],
      ['plate', 'Chamfered plate'],
      ['round', 'Half-round (scallop)', 'a half ellipse on the edge: Length across, Depth deep'],
    ]),
    P.enum('place', 'Placement', 'shape', [
      ['border', 'Along the texture edges'],
      ['grid', 'Grid'],
      ['scatter', 'Scattered'],
      ['shape', 'Along the mask’s edges', 'every straight side of the mask below — the one this layer writes, or Shape (panels, planks, plates) — gets its own evenly spread elements; with nothing in it, the texture’s edges'],
    ]),
    P.enum('side', 'Side', 'in', [['in', 'Into the shape'], ['out', 'Out of the shape']], {
      showIf: (p) => p.place === 'shape',
      hint: 'Into the shape: notches and tabs cut in from its edges. Out of the shape: they stick out from its edges into the gaps',
    }),
    P.enum('edges', 'Edges', 'all', EDGES, { showIf: onEdges, hint: 'Which edges get elements — along the mask, its sides by the way they face' }),
    P.enum('distribute', 'Spread', 'spacing', [['count', 'Count per edge'], ['spacing', 'Spacing']], {
      showIf: onEdges,
      hint: 'Count per edge: the same number on every edge. Spacing: about one every Spacing px, so long sides get more than short ones',
    }),
    P.int('count', 'Count', 3, 1, 256, {
      softMax: 24,
      showIf: (p) => !onEdges(p) || p.distribute !== 'spacing',
      hint: 'Per edge (along the edges; sides of the mask too short for that many get fewer) or across (grid / scatter)',
    }),
    P.float('spacing', 'Spacing', 64, 1, 8192, {
      softMax: 256,
      unit: 'px',
      step: 0.5,
      showIf: (p) => onEdges(p) && p.distribute === 'spacing',
      hint: 'Centre to centre, roughly: each edge gets a whole number of elements, evenly spread (sides too short to hold one get none)',
    }),
    P.float('clearance', 'Corner clearance', 6, 0, 1024, {
      softMax: 64,
      unit: 'px',
      step: 0.5,
      showIf: (p) => p.place === 'shape',
      hint: 'Elements keep at least this far from the ends of a side (beyond what their shape needs to clear the corner); sides too short for the count or spacing get fewer, or none',
    }),
    P.int('rows', 'Rows', 3, 1, 256, { softMax: 24, showIf: onCells }),
    ...spacingParams({ showIf: (p) => p.place === 'grid' }),
    P.float('length', 'Length', 20, 0.5, 1024, { softMax: 96, unit: 'px', step: 0.5, hint: 'Along the edge (the wide side of a tab)' }),
    P.float('depth', 'Depth', 6, 0.5, 1024, { softMax: 48, unit: 'px', step: 0.5, hint: 'Inward from the edge' }),
    P.float('cut', 'Diagonal cut', 1, -4, 8, {
      softMin: -1,
      softMax: 3,
      step: 0.01,
      hint: 'Trapezoid: slope of the cut sides — 1 = 45°, 0 = square, steeper closes it to a point, negative flares it into a dovetail. Plate: share of the corners cut off, 0 … 1',
      showIf: (p) => p.shape === 'trapezoid' || p.shape === 'plate',
    }),
    P.float('thickness', 'Stroke', 2, 0.5, 64, { softMax: 16, unit: 'px', step: 0.5, showIf: (p) => p.shape === 'chevron' || p.shape === 'slit' }),
    P.float('angle', 'Slit angle', 45, -90, 90, { unit: '°', step: 1, showIf: (p) => p.shape === 'slit' }),
    P.float('inset', 'Inset', 0, -256, 1024, { softMin: -32, softMax: 64, unit: 'px', step: 0.5, hint: 'Shift away from the edge (negative straddles it)' }),
    P.float('offset', 'Offset', 0, -1, 1, { step: 0.001, hint: 'Shift along, fraction of the spacing' }),
    P.float('rotation', 'Rotation', 0, -180, 180, { unit: '°', step: 1, showIf: onCells, hint: 'Turn every element' }),
    P.float('rot_jitter', 'Random rotation', 0, 0, 180, { unit: '°', step: 1, showIf: onCells, hint: 'Each element turned by up to this either way' }),
    P.bool('alternate', 'Alternate', false, {
      showIf: (p) => p.place !== 'scatter',
      hint: 'Mirror every other element end for end (a tab’s wide side inward, a chevron pointing out); on a grid in a checkerboard',
    }),
    P.float('size_var', 'Size variation', 0, 0, 1, { step: 0.001, hint: 'Each element shrinks by a random share of up to this' }),
    P.float('drop', 'Drop out', 0, 0, 1, { step: 0.001, showIf: (p) => p.place !== 'scatter', hint: 'Chance of leaving each element out' }),
    P.float('jitter', 'Jitter', 0.5, 0, 1, { step: 0.001, showIf: (p) => p.place === 'scatter', hint: 'Random offset within the cell' }),
    P.float('density', 'Density', 0.6, 0, 1, { step: 0.001, showIf: (p) => p.place === 'scatter' }),
    P.seed(),
  ],
  defaults: {
    h_on: true,
    h_mode: 'subtract',
    h_amount: 0.15,
    bevel: 1.5,
    profile: 'linear',
    // Cut in, so a little darker inside: the chamfer keeps the surface colour, the floor shades down.
    dif_on: true,
    dif_src: 'value',
    dif_blend: 'multiply',
    dif_grad: gradient('#ffffff', '#767676'),
  },
  // A new layer in the editor: the defaults (a tab every ~64 px of each side, 20 × 6 px with a flat end 8 px wide, as at
  // 512) sized to the texture.
  fresh: ({ width, height }) => {
    const s = Math.min(width, height) / 512
    const half = (v: number, lo: number) => Math.max(lo, Math.round(v * 2) / 2)
    return {
      spacing: half(64 * s, 8),
      length: half(20 * s, 4),
      depth: half(6 * s, 1.5),
      clearance: half(6 * s, 1),
      thickness: half(2 * s, 1),
      bevel: half(1.5 * s, 1),
    }
  },
  glsl: /* glsl */ `
const float TB_R2 = 0.70710678;
// |mask| under this is on an edge: exact distances read ~0 all along a straight side.
const float TB_EPS = 0.02;
// 1, read from a uniform: loops bounded by it are not unrolled by D3D.
#define TB_1 (uRes.x > 0.0 ? 1 : 0)

// One element in its local frame: u along (centred), v inward (0 at the edge).
float tb_shape(vec2 q) {
  float u = q.x, v = q.y;
  float hl = 0.5 * u_length, d = u_depth;
  if (u_shape == 0) {
    // Trapezoid: full length at the edge, sides cut inward at the given slope.
    float k = u_cut;
    return max(max(-v, v - d), (abs(u) - (hl - v * k)) / sqrt(1.0 + k * k));
  }
  if (u_shape == 1) {
    float k = hl / max(d, 1e-3);
    return max(-v, (abs(u) - (hl - v * k)) / sqrt(1.0 + k * k));
  }
  if (u_shape == 2) {
    float s = min(sdSegment(q, vec2(-hl, 0.0), vec2(0.0, d)), sdSegment(q, vec2(0.0, d), vec2(hl, 0.0)));
    return s - 0.5 * u_thickness;
  }
  if (u_shape == 3) {
    // Bow-tie: two triangles meeting tip to tip at the middle of the depth.
    float k = d / max(2.0 * hl, 1e-3) * 2.0;
    float w = abs(v - 0.5 * d) - abs(u) * k;
    return max(abs(u) - hl, max(w / sqrt(1.0 + k * k), abs(v - 0.5 * d) - 0.5 * d));
  }
  if (u_shape == 4) {
    vec2 r = rotCW(vec2(u, v - 0.5 * d), u_angle);
    return sdBox(r, vec2(hl, 0.5 * u_thickness));
  }
  if (u_shape == 6) {
    // Half-round: half an ellipse on the edge, hl along it, d deep (the usual close-to-the-edge approximation).
    vec2 r = vec2(max(hl, 1e-3), max(d, 1e-3));
    float k0 = length(q / r), k1 = length(q / (r * r));
    return max(-v, k1 > 1e-6 ? k0 * (k0 - 1.0) / k1 : -min(r.x, r.y));
  }
  // Chamfered plate.
  vec2 c = vec2(abs(u), abs(v - 0.5 * d));
  vec2 b = vec2(hl, 0.5 * d);
  float ch = min(b.x, b.y) * clamp(u_cut, 0.0, 1.0);
  return max(sdBox(c, b), (c.x + c.y - (b.x + b.y - ch)) * TB_R2);
}

// Bevel aspect: plane i of a convex element in its local frame — its unit normal (xy) and offset (z): the plane is
// dot(xy, q) − z, < 0 inside; z = 1e9 for none. su: the side of a bow-tie (sign of u), whose two triangles are each convex.
vec3 tb_plane(int i, float su) {
  float hl = 0.5 * u_length, d = u_depth;
  if (i == 0 && u_shape != 4) return vec3(0.0, -1.0, 0.0);   // the edge (v = 0)
  if (u_shape <= 1) {
    // Trapezoid, notch: the cut sides at slope k, the top (trapezoid).
    float k = u_shape == 0 ? u_cut : hl / max(d, 1e-3), s = sqrt(1.0 + k * k);
    return i == 1 ? vec3(1.0, k, hl) / s : i == 2 ? vec3(-1.0, k, hl) / s : i == 3 && u_shape == 0 ? vec3(0.0, 1.0, d) : vec3(0.0, 0.0, 1e9);
  }
  if (u_shape == 3) {
    float k = d / max(hl, 1e-3), s = sqrt(1.0 + k * k);
    return i == 1 ? vec3(0.0, 1.0, d) : i == 2 ? vec3(su, 0.0, hl)
         : i == 3 ? vec3(-su * k, 1.0, 0.5 * d) / s : i == 4 ? vec3(-su * k, -1.0, -0.5 * d) / s : vec3(0.0, 0.0, 1e9);
  }
  if (u_shape == 4) {
    // Slit: the rotated box's four sides, its centre half the depth in.
    vec2 n = unrotCW(i < 2 ? vec2(i == 0 ? 1.0 : -1.0, 0.0) : vec2(0.0, i == 2 ? 1.0 : -1.0), u_angle);
    return i < 4 ? vec3(n, (i < 2 ? hl : 0.5 * u_thickness) + n.y * 0.5 * d) : vec3(0.0, 0.0, 1e9);
  }
  // Chamfered plate: the box's sides and the four cut corners.
  float ch = min(hl, 0.5 * d) * clamp(u_cut, 0.0, 1.0);
  float sg = (i & 1) == 0 ? 1.0 : -1.0, tg = (i & 2) == 0 ? 1.0 : -1.0;
  return i == 1 ? vec3(0.0, 1.0, d) : i < 4 ? vec3(i == 2 ? 1.0 : -1.0, 0.0, hl)
       : vec3(vec2(sg, tg), hl + 0.5 * d - ch + tg * 0.5 * d) * TB_R2;
}

// Bevel aspect: the element's bevel distance in the space the aspect stretches (px of Bevel, before its size scale), at
// local q with the local axes along screen directions ax, ay. Polygons: the most of their planes' (exact inside a convex
// one); the chevron: the nearer of its two strokes, each by its own direction (continuous where they meet); the
// half-round: the exact stretched ellipse and its base line.
float tb_bevel(vec2 q, vec2 ax, vec2 ay) {
  float hl = 0.5 * u_length, d = u_depth;
  if (u_shape == 2) {
    float m = 1e9;
    for (int k = 0; k < 2; k++) {
      vec2 a = vec2(k == 0 ? -hl : hl, 0.0), ba = vec2(0.0, d) - a, pa = q - a;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
      vec2 v = pa - ba * h;
      vec2 n = h > 0.0 && h < 1.0 ? vec2(-ba.y, ba.x) : v;
      m = min(m, bevelLine(length(v) - 0.5 * u_thickness, ax * n.x + ay * n.y));
    }
    return m;
  }
  if (u_shape == 6) {
    vec2 r = vec2(max(hl, 1e-3), max(d, 1e-3));
    mat2 M = bevelFrame(ax, ay);
    float e = bevelEllipse(M * q, M, r);
    return max(bevelLine(-q.y, ay), length(q / r) < 1.0 ? -e : e);
  }
  float m = -1e9;
  float su = q.x < 0.0 ? -1.0 : 1.0;
  for (int i = 0; i < 8; i++) {
    vec3 pl = tb_plane(i, su);
    if (pl.z < 1e8) m = max(m, bevelLine(dot(pl.xy, q) - pl.z, ax * pl.x + ay * pl.y));
  }
  return m;
}

// How far in from a side's end an element must stay to clear a right-angled corner: the most any of its points reaches
// past the 45° line from the corner (max of v + |u|, less half its length) — 0 for a 45° tab, its depth for a square one.
float tb_clear() {
  float hl = 0.5 * u_length, d = u_depth, th = 0.5 * u_thickness;
  // (The base corners, at the edge, never reach past it: hence the max with 0.)
  float g = u_shape == 0 ? d * (1.0 - u_cut)
          : u_shape == 1 ? d - hl
          : u_shape == 2 ? max(d - hl, 0.0) + th * 1.4142
          : u_shape == 3 ? d
          : u_shape == 4 ? 0.5 * d + (hl + th) * 1.4142 - hl
          : u_shape == 6 ? sqrt(hl * hl + d * d) - hl
          : d - min(hl, 0.5 * d) * clamp(u_cut, 0.0, 1.0);
  return max(max(g, 0.0) + u_inset, 0.0);
}

// Elements on an edge of a given length: the count asked for, or one per Spacing.
float tb_count(float span) {
  return u_distribute == 1 ? max(floor(span / max(u_spacing, 1e-3) + 0.5), 1.0) : float(max(u_count, 1));
}

bool tb_edgeOn(int e) {
  // Edges: 0 sides, 1 ends, 2 all, 3 left, 4 right, 5 top, 6 bottom; e: 0 left, 1 right, 2 top, 3 bottom.
  return u_edges == 2 || (e < 2 ? u_edges == 0 : u_edges == 1) || u_edges == 3 + e;
}

GenOut gen(vec2 p) {
  int place = u_place;

  // ---- Along the mask: this pixel's element frame (u along, v in) from the nearest straight side.
  vec2 sQ = vec2(0.0), sAx = vec2(1.0, 0.0), sAy = vec2(0.0, 1.0);  // (sAx, sAy: the frame's axes on screen)
  float sRnd = 0.5, sPar = 0.0, sFb = 1.0;
  ivec2 sKey = ivec2(0);
  bool sOk = false;
  if (place == 3) {
    ivec2 ic = ivec2(gl_FragCoord.xy);
    vec2 fc = gl_FragCoord.xy;
    float d0 = maskIn(ic);
    vec2 g = 0.5 * vec2(maskIn(ic + ivec2(1, 0)) - maskIn(ic - ivec2(1, 0)), maskIn(ic + ivec2(0, 1)) - maskIn(ic - ivec2(0, 1)));
    if (d0 > 5e3) place = 0;  // nothing in the mask: the texture is the shape, its edges the edges
    else {
      // The wrapper's offset and domain warp, carried into the frame (the elements move and wobble, the sides stay).
      vec2 dl = p - fc;
      float hl = 0.5 * u_length;
      bool outward = u_side == 1;
      float v0 = outward ? d0 : -d0;
      float ext = 1.0 + length(dl) + (u_shape == 2 ? 0.5 * u_thickness : u_shape == 4 ? max(hl + 0.5 * u_thickness - 0.5 * u_depth, 0.0) : 0.0);
      float vlo = u_inset - ext, vhi = u_inset + u_depth + ext;
      sFb = max(max(vlo - v0, v0 - vhi), 1.0);
      float gl = length(g);
      vec2 n = g / max(gl, 1e-6);
      vec2 e = fc - d0 * n;
      // In the band the elements reach, on a clean gradient (not a corner's or a ridge's), whose foot is on the edge.
      bool ok = v0 >= vlo && v0 <= vhi && abs(gl - 1.0) < 0.1 && abs(sampleT(tMaskIn, e).x) < 0.25;
      // The side's class (by the way it faces) and direction: down left / right sides, rightward along top / bottom.
      bool vert = abs(n.x) + 1e-3 >= abs(n.y);
      int cls = vert ? (n.x < 0.0 ? 0 : 1) : (n.y > 0.0 ? 2 : 3);
      ok = ok && tb_edgeOn(cls);
      vec2 t = vec2(-n.y, n.x);
      if (vert ? t.y > 0.0 : t.x < 0.0) t = -t;
      // Follow the side both ways from the foot: 1 px steps while it stays on the edge, then halve onto its end.
      float cap = uTile ? (abs(t.x) > 0.999 ? uRes.x : abs(t.y) > 0.999 ? uRes.y : uRes.x + uRes.y) : 2.0 * (uRes.x + uRes.y);
      float lo = 0.0, st = 1.0, s1 = 0.0, s0 = 0.0;
      bool refine = false, endless = false, found = false;
      int dir = 0;
      for (int k = 0; k < 65536 * TB_1; k++) {
        if (!ok) break;
        float s = lo + st;
        vec2 x = e + (dir == 0 ? s : -s) * t;
        bool on = abs(sampleT(tMaskIn, x).x) < TB_EPS && (uTile || (x.x >= 0.0 && x.y >= 0.0 && x.x <= uRes.x && x.y <= uRes.y));
        if (on) lo = s; else refine = true;
        if (refine) st *= 0.5;
        if (!refine && lo >= cap) { endless = true; found = true; break; }
        if (st < 0.004) {
          if (dir == 1) { s0 = -lo; found = true; break; }
          s1 = lo; dir = 1; lo = 0.0; st = 1.0; refine = false;
        }
      }
      if (ok && found) {
        float L, a, nEl;
        if (endless) {
          // A side that runs all the way round a tiling texture: spaced like a texture edge, from the origin.
          L = cap;
          a = mod(dot(e, t), cap);
          nEl = tb_count(L);
        } else {
          L = s1 - s0;
          a = -s0;
          nEl = min(tb_count(L), floor(L / (u_length + 2.0 * (u_clearance + (outward ? 0.5 * u_thickness : tb_clear())))));
        }
        if (nEl >= 1.0) {
          float sp = L / nEl;
          float tt = (a + dot(dl, t)) / sp - 0.5 - u_offset;
          float i = floor(tt + 0.5);
          i = endless ? i : clamp(i, 0.0, nEl - 1.0);
          float v = v0 + (outward ? 1.0 : -1.0) * dot(dl, n);
          sQ = vec2((tt - i) * sp, v - u_inset);
          sAx = t;
          sAy = outward ? n : -n;
          float iw = endless ? mod(i, nEl) : i;
          sPar = mod(iw, 2.0);
          // Its identity: the side (class, its line) and the element's centre (or index round an endless side), on a
          // 2 px grid offset off the half pixels geometry usually sits on, wrapped with the tile.
          vec2 c = endless ? vec2(iw, dot(e, n)) : e + ((i + 0.5 + u_offset) * sp - a) * t;
          ivec2 kc = ivec2(floor(c * 0.5 + 0.31));
          if (uTile) kc = imod(kc, ivec2(max(floor(uRes * 0.5 + 0.5), 1.0)));
          if (endless) kc.x = int(iw);
          sKey = ivec2(kc.x * 4 + cls, kc.y);
          sRnd = hashI(sKey, uSeed + 23.0);
          sOk = true;
        }
      }
    }
  }

  // ---- One element per candidate: the four texture edges, the cells that can reach the pixel, or the mask's
  // side. Cells: a grid centred on the texture, shifted by Offset, its step growing with Column / Row spacing (on the
  // grid; scatter keeps its cells), with copies round the torus when tiling (repGrid) — at least the neighbours
  // either side, more for elements larger than their step.
  float best = 1e4;
  float brnd = 0.5;
  // The winner's local frame for Bevel aspect: its point (before size), size, and local axes on screen.
  vec2 bQ = vec2(0.0), bAx = vec2(1.0, 0.0), bAy = vec2(0.0, 1.0);
  float bSc = 1.0;
  float top = uRes.y - p.y;
  ivec2 gn = ivec2(max(u_count, 1), max(u_rows, 1));
  vec2 cs = place == 1 ? vec2(repPitch(uRes.x, gn.x, u_col_sp, uRes.x), repPitch(uRes.y, gn.y, u_row_sp, uRes.y))
                       : uRes / vec2(gn);
  float ext = 0.5 * length(vec2(u_length, u_depth)) + abs(u_inset) + 2.0;
  vec2 reach = max(cs, vec2(ext) + (place == 2 ? 0.5 * u_jitter * cs : vec2(0.0)));
  RepGrid rg = repGrid(gn, cs, 0.5 * uRes + vec2(u_offset * cs.x, 0.0), uRes, uTile, p - reach, p + reach);
  int nc = place == 0 ? 4 : place == 3 ? 1 : repCount(rg);
  for (int k = 0; k < nc; k++) {
    vec2 q = vec2(0.0);  // the element's frame, before size and mirroring
    float rnd = 0.5;     // its random (Height's per-feature variation)
    ivec2 key = ivec2(0); // its identity, for its size and drop-out
    bool flip = false;   // mirrored end for end
    bool centred = false;
    bool skip = false;   // no element from this candidate (ANGLE / D3D11 can miscompile continue)
    vec2 ax = vec2(1.0, 0.0), ay = vec2(0.0, 1.0);  // the frame's u and v axes on screen (p.y up)
    if (place == 0) {
      // Texture edge k: 0 left, 1 right, 2 top, 3 bottom (p.y = 0 is the bottom of the image).
      skip = !tb_edgeOn(k);
      float along = k < 2 ? top : p.x;
      float inward = k == 0 ? p.x : k == 1 ? uRes.x - p.x : k == 2 ? top : p.y;
      float span = k < 2 ? uRes.y : uRes.x;
      float n = tb_count(span);
      float sp = span / n;
      float t = along / sp - 0.5 - u_offset;
      float i = floor(t + 0.5);
      float id = uTile ? mod(i, n) : i;
      skip = skip || (!uTile && (i < 0.0 || i > n - 1.0));
      q = vec2((t - i) * sp, inward - u_inset);
      ax = k < 2 ? vec2(0.0, -1.0) : vec2(1.0, 0.0);
      ay = k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(-1.0, 0.0) : k == 2 ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
      float bid = id + (k == 0 ? 0.0 : k == 1 ? 101.0 : k == 2 ? 211.0 : 307.0);
      rnd = hashI(ivec2(int(bid), 17), uSeed);
      key = ivec2(int(id), k);
      flip = u_alternate && mod(id, 2.0) == 1.0;
    } else if (place == 3) {
      skip = !sOk;
      q = sQ;
      ax = sAx;
      ay = sAy;
      rnd = sRnd;
      key = sKey;
      flip = u_alternate && sPar == 1.0;
    } else {
      ivec2 cw;
      vec2 ctr;
      repAt(rg, k, cw, ctr);
      flip = u_alternate && ((cw.x + cw.y) & 1) == 1;
      if (u_place == 2) {
        skip = hashI(cw, uSeed + 3.0) > u_density;
        ctr += (hash2I(cw, uSeed) - 0.5) * cs * u_jitter;
        flip = hashI(cw, uSeed + 7.0) > 0.5;
      }
      vec2 r = p - ctr;
      float rot = u_rotation + u_rot_jitter * (2.0 * hashI(cw, uSeed + 11.0) - 1.0);
      if (rot != 0.0) r = unrotCW(r, rot);
      q = vec2(r.x, flip ? r.y : -r.y);
      ax = rotCW(vec2(1.0, 0.0), rot);
      ay = rotCW(vec2(0.0, flip ? 1.0 : -1.0), rot);
      rnd = hashI(ivec2(cw.x + cw.y * 977, 17), uSeed);
      key = cw;
      centred = true;
    }
    vec2 kh = hash2I(key, uSeed + 41.0);
    skip = skip || (u_place != 2 && kh.y < u_drop);
    // Size: about the element's centre on a grid, about its edge along an edge (it stays on the edge).
    float sc = 1.0 - u_size_var * kh.x;
    vec2 qs = q / sc;
    if (centred) qs.y += 0.5 * u_depth - u_inset;
    else if (flip) {
      qs.y = u_depth - qs.y;
      ay = -ay;
    }
    float d = skip ? 1e4 : tb_shape(qs) * sc;
    if (d < best) { best = d; brnd = rnd; bQ = qs; bSc = sc; bAx = ax; bAy = ay; }
  }
  // Away from every element: a lower bound on the distance (the mask must not read 'nothing written').
  if (u_place == 3 && place == 3 && !sOk) best = sFb;
  GenOut g = genOut(1.0, 1.0, brnd, min(best, 4e3));
  // Bevel aspect: the winner's bevel measured in the stretched space, so its mitres don't step where the distance's
  // direction turns (at aspect 1 the wrapper's own bevel, unchanged).
  if (bevelAspectOn() && best < 0.0) g.bdist = tb_bevel(bQ, bAx, bAy) * bSc;
  return g;
}
`,
}
