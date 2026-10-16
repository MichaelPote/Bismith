// Organic cracks (FR7.2a): dried mud / cracked rock / lava crust — plates split by a bent, jagged crack network whose
// cracks vary in width, with a finer, partial second generation of cracks that branch off the main ones and taper out
// inside the plates. Like wood it has a combined output (plate value × the bevel of its shape, cracks = 0; the plate
// outline goes to the shape mask, genOutShaded) and an SDF output for the register. Plates can dome, curl and tilt in
// Height (GenOut.hval).

import { P } from '@/core/params'
import type { ParamValues } from '@/core/params'
import type { LayerDef } from '../types'
import { ORG_GLSL } from './organicShared'

const fineOn = (p: ParamValues) => Number(p.sub) > 0

export const cracksLayer: LayerDef = {
  type: 'cracks',
  noise: true,
  label: 'Cracks',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Dried mud, cracked rock or lava crust: a bent, jagged network of cracks of varied widths, finer cracks branching off them, domed and tilted plates; the plates as a shape.',
  params: [
    P.enum('output', 'Output', 'plates', [
      ['plates', 'Plates (bevel × coverage)'],
      ['shape', 'Plate shapes (SDF)'],
    ], { hint: 'Plates: value 1 on the plates with the Shape bevel at their edges, 0 in the cracks (the cracks still paint: the low end of the ramps); the plate outline goes to the shape mask. Shape: the outline of the plates only — the cracks show what is below' }),
    P.float('scale', 'Scale', 5, 0.5, 256, { softMax: 32, step: 0.01, hint: 'Main plates across the texture width (rounded when tiling)' }),
    P.float('jitter', 'Jitter', 0.9, 0, 1, { step: 0.001, hint: 'How irregular the plates are: 0 a square grid, 1 fully random' }),
    P.float('size_var', 'Size variation', 0.3, 0, 2, { softMax: 1, step: 0.001, hint: 'Main plates of different sizes (weights of the cells: above 1 small plates get squeezed out between big ones)' }),
    P.float('width', 'Crack width', 2.5, 0, 64, { softMax: 12, unit: 'px', step: 0.05, section: 'Cracks' }),
    P.float('width_var', 'Width variation', 0.5, 0, 1, { step: 0.001, section: 'Cracks', hint: 'Some cracks wider than others (from one junction to the next), each one swelling and narrowing along its length' }),
    P.float('zigzag', 'Jaggedness', 1.25, 0, 64, { softMax: 16, unit: 'px', step: 0.05, section: 'Cracks', hint: 'How far the cracks zig-zag off their path (px): straight runs with sharp kinks a few times that apart, the broken course of a real crack. 0 = smooth' }),
    P.float('jag', 'Edge roughness', 0.25, 0, 8, { softMax: 3, unit: 'px', step: 0.01, section: 'Cracks', hint: 'Pixel-scale roughness of the crack edges. Above half the crack width the cracks break up into dashes' }),
    P.float('warp', 'Warp', 0.15, 0, 2, { softMax: 1, step: 0.001, section: 'Cracks', hint: 'Bends the cracks into curves, in plate sizes: up to 0.3 gently curved edges, at 1 they wander up to about a plate off their straight course' }),
    P.float('warp_scale', 'Warp scale', 1, 0.1, 16, { softMin: 0.25, softMax: 4, step: 0.01, section: 'Cracks', showIf: (p) => Number(p.warp) > 0, hint: 'Bends per plate: below 1 long sweeps that carry several plates along, above 1 cracks that wiggle between their junctions' }),
    P.enum('warp_mode', 'Warp style', 'bend', [
      ['bend', 'Bend', 'the cracks curve and meander and the plates keep their sizes; high values swirl them round eddies (flowing lava crust)'],
      ['squeeze', 'Squeeze', 'the plates bunch up in places and spread out in others; high values pack the cracks into parallel bands (sheared, compressed crust)'],
    ], { section: 'Cracks', showIf: (p) => Number(p.warp) > 0 }),
    P.float('sub', 'Fine cracks', 0.7, 0, 1, { step: 0.001, section: 'Fine cracks', hint: 'Fraction of the finer crack segments present (each segment between two fine plates is kept or dropped)' }),
    P.float('sub_scale', 'Fine scale', 2.5, 1, 16, { softMax: 6, step: 0.01, section: 'Fine cracks', showIf: fineOn, hint: 'Fine plates per main plate (across)' }),
    P.float('sub_width', 'Fine width', 1.25, 0, 32, { softMax: 6, unit: 'px', step: 0.05, section: 'Fine cracks', showIf: fineOn, hint: 'Width of the fine cracks where they leave a main crack' }),
    P.float('sub_taper', 'Taper', 0.7, 0, 1, { step: 0.001, section: 'Fine cracks', showIf: fineOn, hint: 'Fine cracks narrow away from the main cracks: 0 the same width everywhere, 1 they branch off the main cracks and run out to a point inside the plates' }),
    P.float('sub_depth', 'Fine depth', 0.55, 0, 1, { step: 0.001, section: 'Fine cracks', showIf: (p) => fineOn(p) && p.sub_shape !== true, hint: 'Height only: how deep the fine cracks are, a share of the main cracks\' depth — shallower grooves with the bevel\'s rounded shoulders, fading out along with the taper. Colour still draws them dark' }),
    P.bool('sub_connect', 'Connected only', true, { section: 'Fine cracks', showIf: fineOn, hint: 'Drop fine cracks that touch neither a main crack nor another fine crack (floating strokes), and let a fine crack that ends inside a plate run out to a point there rather than stop bluntly' }),
    P.bool('sub_shape', 'Fine cracks in the shape', false, { section: 'Fine cracks', showIf: fineOn, hint: 'On: the fine cracks cut the plates like the main ones — full depth, in the shape mask and the Shape output. Off: they are grooves of their own depth on the plates; the shape mask holds the main network' }),
    P.bool('sub_cross', 'Cross main cracks', false, { section: 'Fine cracks', showIf: fineOn, hint: 'On: one fine network over the whole texture, its cracks running straight across the main ones. Off: each plate cracks on its own, so fine cracks end at the main cracks (T-junctions), as cracks in drying mud do' }),
    P.bool('sub_vary', 'Fine plates vary', false, { section: 'Fine cracks', showIf: fineOn, hint: 'Each fine plate gets its own random (colour jitter, per-feature height), not just each main plate. Where a fine crack is missing the change shows without a crack, so it suits Fine cracks near 1' }),
    P.float('dome', 'Dome', 0.35, -1, 1, { step: 0.001, section: 'Plates', hint: 'Height only: above 0 the plates bulge (the edges fall away towards the cracks); below 0 their edges curl up into a lip, as drying mud does. A share of the layer\'s height' }),
    P.float('dome_edge', 'Dome reach', 0.5, 0.05, 1, { step: 0.001, section: 'Plates', showIf: (p) => Number(p.dome) !== 0, hint: 'How far in from the cracks the dome falls, or the curl rises: small = only a narrow rim (a flat plate with rounded-off or curled-up edges), 1 = all the way to the middle (a full dome, a deep dish)' }),
    P.float('tilt', 'Tilt', 0.3, 0, 1, { step: 0.001, section: 'Plates', hint: 'Height only: each plate tilts its own way by its own random share of this (a share of the layer\'s height) — heaved, settled plates' }),
    P.seed(),
  ],
  // Added in the editor: crack widths, zig-zag and bevel in proportion to the texture (the defaults suit 512 px); on
  // small textures fewer plates and fewer, longer fine cracks, which would otherwise turn to specks.
  fresh: (t) => {
    const k = Math.sqrt(t.width * t.height) / 512
    const r = (v: number) => Math.round(v * 20) / 20
    const small = k <= 0.25
    return {
      scale: k <= 0.125 ? 3 : small ? 4 : 5,
      width: r(Math.max(1, 2.5 * k)),
      sub_width: r(Math.max(0.75, 1.25 * k)),
      zigzag: r(Math.max(0.4, 1.25 * k)),
      bevel: r(Math.max(0.75, 2 * k)),
      ...(small ? { sub: 0.45, sub_taper: 0.4 } : {}),
    }
  },
  defaults: {
    bevel: 2,
    profile: 'smooth',
    h_on: true,
    h_amount: 0.3,
    h_var: 0.3,
    dif_on: true,
    // Crack colour only at the very bottom, so the bevel shades plate edges rather than widening cracks.
    dif_grad: { stops: [{ pos: 0, color: '#1e150d' }, { pos: 0.3, color: '#4a3624' }, { pos: 0.7, color: '#6b5038' }, { pos: 1, color: '#7a5e43' }] },
    dif_jitter: 0.15,
  },
  glsl:
    ORG_GLSL +
    /* glsl */ `
// Screen px per px of the warped plane across a border with unit normal n there: jx, jy are how the warped point moves
// per screen px right and up (its screen-space derivatives), so a crack keeps its width wherever the warp stretches or
// squeezes the plane.
float crk_scale(vec2 n, vec2 jx, vec2 jy) {
  return max(length(vec2(dot(jx, n), dot(jy, n))), 1e-3);
}

// The main plates: power-weighted Voronoi cells (org_cellDist without the soft minimum), each border a crack of its own
// width. halfW = half the crack width (px); wVar spreads the cracks' widths (one random per border segment, both sides
// agreeing). Returns x = distance (screen px) to the edge of the nearest crack band (> 0 on a plate), y = distance to
// the nearest border, z = per-plate random, w = y in the warped plane (smooth: no per-pixel-quad derivatives in it, for
// the plate surface); off = the pixel's offset from the plate's site (warped plane), nb = the nearest border's normal.
vec4 crk_plates(vec2 p, vec2 cells, float jitter, float sizeVar, float halfW, float wVar, vec2 jx, vec2 jy, float seed, out vec2 off, out vec2 nb) {
  ivec2 per = org_per(cells);
  vec2 cs = uRes / cells;
  ivec2 ip = ivec2(floor(p / cs));
  float wScale = sizeVar * cs.x * cs.y * 0.45;
  float best = 1e20;
  vec2 bs = p;
  float bw = 0.0;
  ivec2 bc = ip;
  float m = 1e9, band = 1e9, mq = 1e9;
  nb = vec2(1.0, 0.0);
  // One flat loop (see ORG_1): the 5×5 cells around p for the nearest site, then the 5×5 around that site. (No
  // \`continue\`: ANGLE / D3D11 can miscompile it; skipped passes are an if.)
  for (int e = 0; e < 50 * ORG_1; e++) {
    bool near = e < 25;
    int f = near ? e : e - 25;
    ivec2 g = ivec2(f % 5 - 2, f / 5 - 2);
    if (near || g != ivec2(0)) {
      ivec2 c = (near ? ip : bc) + g;
      ivec2 cw = imod(c, per);
      vec3 h = hash3I(cw, seed);
      vec2 s = (vec2(c) + 0.5 + (h.xy - 0.5) * jitter) * cs;
      float w = (h.z - 0.5) * wScale;
      float L = length(s - bs);
      if (near) {
        float pd = org_dot2(s - p) - w;
        if (pd < best) { best = pd; bs = s; bw = w; bc = c; }
      } else if (L >= 1e-4) {
        // Power bisector: (pow_b - pow_a) / (2 |b - a|) is the signed px distance, positive on a's side.
        vec2 n = (s - bs) / L;
        float dq = max((org_dot2(p - s) - w - org_dot2(p - bs) + bw) / (2.0 * L), 0.0);
        float d = dq / crk_scale(n, jx, jy);
        if (d < m) { m = d; nb = n; }
        mq = min(mq, dq);
        // This border's width: an order-independent hash of the cell pair, so both plates agree. Few wide, most narrower.
        ivec2 bwc = imod(bc, per);
        ivec2 lo = (bwc.x < cw.x || (bwc.x == cw.x && bwc.y < cw.y)) ? bwc : cw;
        ivec2 hi = (lo == bwc) ? cw : bwc;
        float r = hashI(lo * 7919 + hi, seed + 61.0);
        band = min(band, d - halfW * mix(1.0, 0.3 + 1.7 * r * r, wVar));
      }
    }
  }
  off = p - bs;
  return vec4(band, m, hashI(imod(bc, per), seed + 17.0), mq);
}

// Whether the fine segment between cells a and b (wrapped ids) is present: an order-independent pair hash (so both sides
// agree), x < keep; y = the segment's taper reach (random). A plate key (not 0) gives each main plate its own segments.
vec2 crk_segment(ivec2 a, ivec2 b, int key, float seed) {
  ivec2 lo = (a.x < b.x || (a.x == b.x && a.y < b.y)) ? a : b;
  ivec2 hi = (lo == a) ? b : a;
  return hash2I(lo * 7919 + hi + ivec2(key, 0), seed + 53.0);
}

// Fine cracks: Voronoi borders where each border segment (cell pair) is present with probability \`keep\` — partial
// cracks end at junctions instead of dotting out. halfW = their half width (px). With a plate key (not 0), each main
// plate draws its own segments, so a fine crack stops at a main crack (a T-junction) rather than crossing it. Taper:
// each segment narrows with mainD, the pixel's distance (px) from the main cracks, to nothing at its own reach (a random
// 0.1–0.6 of a plate size, mostly short, × 1 / taper) — branches off the main cracks, of different lengths. connect: the
// nearest segment is followed to its two ends (where its line leaves the fine cell): it is dropped when its end towards
// the main crack (normal mainN points at it) neither reaches that crack nor meets another present segment (a floating
// stroke), or when it runs close beside the main crack (doubling it); and it runs out to a point towards an inner end
// where nothing continues it. Returns x = distance (px) to the edge of the
// nearest fine crack, y = fine-cell rnd, z = that crack's strength (1 full width … 0 at its tip; scales its groove).
vec3 crk_fineCracks(vec2 p, vec2 cells, float jitter, float keep, float halfW, float taper, float mainD, vec2 mainN, float plate, int key, bool connect, vec2 jx, vec2 jy, float seed) {
  ivec2 per = org_per(cells);
  vec2 cs = uRes / cells;
  ivec2 ip = ivec2(floor(p / cs));
  float best = 1e20;
  vec2 bs = p;
  ivec2 bc = ip, bw = ip;
  // The nearest present segment (band b1: its distance d1, half width h1, strength t1, other cell's index i1 in the
  // 5×5 and site s1, normal n1) and the next nearest band (b2, t2), the fallback when the nearest is dropped.
  float b1 = 1e9, b2 = 1e9, d1 = 0.0, h1 = 0.0, t1 = 0.0, t2 = 0.0;
  int i1 = 12;
  vec2 s1 = p, n1 = vec2(1.0, 0.0);
  // The 5×5 sites around the nearest one, kept for following the nearest segment to its ends below.
  vec2 nbr[25];
  // One flat loop (see ORG_1): the 3×3 cells for the nearest site, then the 5×5 around it for the borders.
  for (int e = 0; e < 34 * ORG_1; e++) {
    bool near = e < 9;
    int f = near ? e : e - 9;
    ivec2 g = near ? ivec2(f % 3 - 1, f / 3 - 1) : ivec2(f % 5 - 2, f / 5 - 2);
    ivec2 c = (near ? ip : bc) + g;
    ivec2 cw = imod(c, per);
    vec2 s = (vec2(c) + 0.5 + (cellPoint(cw, seed) - 0.5) * jitter) * cs;
    if (near) {
      float d = org_dot2(s - p);
      if (d < best) { best = d; bs = s; bc = c; bw = cw; }
    } else nbr[f] = s;
    vec2 sh = crk_segment(bw, cw, key, seed);
    vec2 ab = s - bs;
    float L = length(ab);
    if (!near && g != ivec2(0) && sh.x < keep && L >= 1e-4) {
      vec2 n = ab / L;
      float dist = max((org_dot2(p - s) - org_dot2(p - bs)) / (2.0 * L), 0.0) / crk_scale(n, jx, jy);
      float h = halfW, st = 1.0, b;
      if (taper > 0.0) {
        // u: 0 at the main crack, 1 at this segment's tip.
        float u = taper * mainD / (plate * (0.1 + 0.5 * sh.y * sh.y));
        st = clamp(1.0 - u, 0.0, 1.0);
        h = halfW * st;
        // Under a pixel wide the crack fades instead of staying a half-dark 1 px line (anti-aliased): its band shrinks
        // below zero, so its darkest pixel goes as its width. Past the tip its distance climbs away, so a bevel (with
        // the fine cracks in the shape) runs out a little beyond the visible end instead of drawing the rest of it.
        b = dist + max(u - 1.0, 0.0) * 12.0 * (u_bevel + 1.0) - (h < 0.5 ? 2.0 * h - 0.5 : h);
      } else b = dist - halfW;
      if (b < b1) { b2 = b1; t2 = t1; b1 = b; d1 = dist; h1 = h; t1 = st; i1 = f; s1 = s; n1 = n; }
      else if (b < b2) { b2 = b; t2 = st; }
    }
  }
  if (connect && b1 < 1e8 && b1 < max(u_bevel, 1.0) + 2.0) {
    // The nearest segment's ends: its line through the pixel's foot p0, followed to the first other border of the cell
    // towards the main crack (tp, cell index ip_, vertex vP) and away from it (tm, im).
    vec2 dir = vec2(n1.y, -n1.x);
    if (dot(dir, mainN) < 0.0) dir = -dir;
    vec2 p0 = p - n1 * dot(p - 0.5 * (bs + s1), n1);
    float tp = 1e9, tm = 1e9;
    int jp = i1, jm = i1;
    for (int f = 0; f < 25 * ORG_1; f++) {
      vec2 nc = nbr[f] - bs;
      float lc = length(nc);
      if (f != 12 && f != i1 && lc >= 1e-4) {
        nc /= lc;
        float den = dot(dir, nc), num = dot(0.5 * (bs + nbr[f]) - p0, nc);
        if (den > 1e-4) { if (num / den < tp) { tp = num / den; jp = f; } }
        else if (den < -1e-4) { if (num / -den < tm) { tm = num / -den; jm = f; } }
      }
    }
    // The main crack's distance at the ends (its border taken as straight from here).
    vec2 vP = p0 + dir * tp;
    float mP = mainD - dot(vP - p, mainN), mM = mainD - dot(p0 - dir * tm - p, mainN);
    // Does a segment go on from each end — the cell's border there, or the far cell's — present and, tapering, not past
    // its tip there; at the crack-ward end also heading on towards the main crack (else two strokes meeting in a V
    // would keep each other)? Four pair tests in one loop.
    ivec2 w1 = imod(bc + ivec2(i1 % 5 - 2, i1 / 5 - 2), per);
    bool atP = false, atM = false;
    for (int i = 0; i < 4 * ORG_1; i++) {
      bool plus = i < 2, own = i % 2 == 0;
      int j = plus ? jp : jm;
      vec2 o = crk_segment(own ? bw : w1, imod(bc + ivec2(j % 5 - 2, j / 5 - 2), per), key, seed);
      bool on = o.x < keep && (taper <= 0.0 || taper * max(plus ? mP : mM, 0.0) < plate * (0.1 + 0.5 * o.y * o.y));
      if (plus && on) {
        // That border's way out of the vertex: along it, away from the third cell.
        vec2 dv = normalize(nbr[j] - (own ? bs : s1));
        dv = vec2(dv.y, -dv.x);
        if (dot(dv, (own ? s1 : bs) - vP) > 0.0) dv = -dv;
        on = dot(dv, mainN) > 0.0;
      }
      if (on) { if (plus) atP = true; else atM = true; }
    }
    // A segment running within ~30° of the main crack close beside it would double it: dropped too (judged at its
    // middle, so the whole segment goes).
    bool doubled = abs(dot(n1, mainN)) > 0.86 && 0.5 * (mP + mM) < 0.25 * plate;
    if ((mP > 1.0 && !atP) || doubled) { b1 = b2; t1 = t2; }
    else if (!atM && taper > 0.0) {
      // A dead end inside the plate: narrow to a point over the last stretch before it.
      float k = clamp(tm / max(min(0.5 * (tp + tm), 0.6 * cs.x), 1e-3), 0.0, 1.0);
      float h = h1 * sqrt(k);
      b1 = min(d1 - (h < 0.5 ? 2.0 * h - 0.5 : h), b2);
      t1 *= k;
    }
  }
  return vec3(b1, hashI(bw, seed + 17.0), t1);
}

// Steps of the Bend and Squeeze warps: the pixel flows along a fixed smooth noise field in small steps, so the cracks bend
// as far as a plain displacement would move them but don't fold over (each step stretches the plane only a little).
// Bend follows the field's curl (divergence-free: plates keep their areas, high values swirl round eddies), Squeeze the
// field itself (plates bunch up where it converges and spread where it diverges).
#define CRK_STEPS 8

GenOut gen(vec2 p) {
  vec2 cells = cellsFor(u_scale, 1.0);
  vec2 cs = uRes / cells;
  float L = sqrt(cs.x * cs.y);
  bool curl = u_warp_mode == 0;
  // The noise, in one flat loop (one copy of its code; see ORG_1), the arguments picked per pass:
  //   e <  3·STEPS  the warp of the main cracks, three passes per step at the flowing point q. Bend: the field there
  //                 and a small step right and up (its gradient), then q moves along the curl. Squeeze: two components
  //                 (x, y), then q moves by them.
  //   +0, +1        the warp of the fine cracks (x, y), a fraction of the main one
  //   +2            the edge roughness (a ~2 px value noise that nudges the crack distance)
  //   +3            the width variation along the cracks
  int E0 = 3 * CRK_STEPS;
  const float FD = 0.05;
  vec2 mc = cellsFor(u_scale * u_warp_scale, 1.0);
  vec2 fc = cellsFor(u_scale * u_sub_scale * 1.5, 1.0);
  // The zig-zag's kinks: about 5× its amplitude apart (at least 4 px), so it doesn't fold the cracks over.
  vec2 zc = cellsFor(uRes.x / max(4.0, 5.0 * u_zigzag), 1.0);
  vec2 jc = cellsFor(uRes.x / 2.0, 1.0);
  vec2 wc = cellsFor(u_scale * 3.0, 1.0);
  vec2 q = p;
  float n0 = 0.5, n1 = 0.5;
  vec2 wf = vec2(0.5);
  float jn = 0.0, wn = 0.5;
  for (int e = 0; e < (3 * CRK_STEPS + 4) * ORG_1; e++) {
    int k = e < E0 ? 0 : e - E0 + 1;   // 0 main warp, 1–2 fine warp, 3 roughness, 4 width
    int c = k == 0 ? e % 3 : (k + 1) % 2;
    bool skip = k == 0 ? u_warp <= 0.0 || (!curl && c == 2)
      : k <= 2 ? u_warp <= 0.0 || u_sub <= 0.0
      : k == 3 ? u_jag <= 0.0
      : u_width_var <= 0.0 || u_width <= 0.0;
    if (!skip) {
      vec2 nc = k == 0 ? mc : k <= 2 ? fc : k == 3 ? jc : wc;
      // Where: the main warp and the width samples the warped point q; the fine warp and roughness p.
      vec2 x = (k == 0 || k == 4 ? q : p) / uRes * nc;
      if (k == 0 && curl) x += c == 1 ? vec2(FD, 0.0) : c == 2 ? vec2(0.0, FD) : vec2(0.0);
      else if (c == 1) x += 17.3;
      float seed = k == 0 ? uSeed + 7.0 + (c == 1 && !curl ? 211.0 : 101.0)
                 : k <= 2 ? uSeed + 37.0 + (c == 0 ? 101.0 : 211.0)
                 : k == 3 ? uSeed + 29.0 : uSeed + 97.0;
      int oct = k == 4 ? 1 : 2;
      float gain = k <= 2 ? 0.4 : 0.5;
      float n = org_noiseFbm(k <= 2 ? 1 : 0, false, x, org_per(nc), oct, gain, seed);
      // (Components by branch, not by a dynamic index.)
      if (k == 0) {
        if (c == 0) n0 = n;
        else if (c == 1 && !curl) q += (vec2(n0, n) - 0.5) * 2.0 * u_warp * L / float(CRK_STEPS);
        else if (c == 1) n1 = n;
        else {
          // Bend: along the field's curl (its gradient turned a quarter), per noise cell → px.
          vec2 g = vec2(n1 - n0, n - n0) / FD;
          q += vec2(g.y, -g.x) * (u_warp * L * 0.35 / float(CRK_STEPS));
        }
      } else if (k == 1) wf.x = n;
      else if (k == 2) wf.y = n;
      else if (k == 3) jn = (n - 0.5) * 2.0 * u_jag;
      else wn = n;
    }
  }
  // The zig-zag (x, y): value noise with plain bilinear interpolation, 2 octaves — piecewise straight between its
  // lattice lines, so the cracks it displaces run straight and turn sharply (kinks) instead of wobbling. One flat loop
  // over component × octave × lattice corner (one hash call).
  vec2 zz = vec2(0.5);
  if (u_zigzag > 0.0) {
    zz = vec2(0.0);
    for (int e = 0; e < 16 * ORG_1; e++) {
      int comp = e / 8, oct = (e / 4) % 2, corner = e % 4;
      float fo = oct == 0 ? 1.0 : 2.0;
      vec2 x = p / uRes * zc * fo + (comp == 1 ? 17.3 : 0.0);
      vec2 fr = fract(x);
      ivec2 i = imod(ivec2(floor(x)) + ivec2(corner % 2, corner / 2), org_per(zc) * (oct + 1));
      float sd = uSeed + 83.0 + float(comp) * 57.0 + float(oct) * 31.0;
      float w = (corner % 2 == 0 ? 1.0 - fr.x : fr.x) * (corner / 2 == 0 ? 1.0 - fr.y : fr.y) * (oct == 0 ? 1.0 : 0.45) / 1.45;
      float v = w * animValue(hashI(i, sd), i, sd);
      if (comp == 0) zz.x += v;
      else zz.y += v;
    }
  }
  // The warp's screen-space derivatives (uniform control flow here), so crack widths stay true px. Taken before the
  // zig-zag: its kinks are too fine for derivatives over a pixel quad.
  vec2 jx = dFdx(q), jy = dFdy(q);
  // The zig-zag moves the main and fine cracks alike (it is the crack's course, not a plate's).
  q += (zz - 0.5) * 2.0 * u_zigzag;
  float wMul = mix(1.0, 0.35 + 1.3 * wn, u_width_var);
  vec2 off, nb;
  vec4 c1 = crk_plates(q, cells, u_jitter, u_size_var, 0.5 * u_width * wMul, u_width_var, jx, jy, uSeed, off, nb);
  // Distance (px) from the pixel to the edge of the crack bands: > 0 on a plate.
  float d = c1.x + jn;
  float rnd = c1.z;
  float fineInk = 0.0, fineGroove = 0.0;
  if (u_sub > 0.0) {
    vec2 c2s = cellsFor(u_scale * u_sub_scale, 1.0);
    vec2 fw = (wf - 0.5) * 0.25 * u_warp * L / u_sub_scale;
    // (Widths corrected by the main warp's derivatives: the fine warp is gentle.)
    vec3 c2 = crk_fineCracks(q + fw, c2s, u_jitter, u_sub, 0.5 * u_sub_width, u_sub_taper, c1.y, nb, L, u_sub_cross ? 0 : int(c1.z * 65536.0) + 1, u_sub_connect, jx, jy, uSeed + 3.0);
    // The edge roughness fades with the taper too (it would dot the thin ends out).
    float fd = c2.x + jn * clamp(1.0 - u_sub_taper * c1.y / (0.35 * L), 0.0, 1.0);
    if (u_sub_shape) d = min(d, fd);
    else {
      // Grooves of their own on the plates: dark in colour (anti-aliased like an edge), and in Height a groove of Fine
      // depth × the crack's strength, with rounded shoulders the bevel's width (at least 1 px) wide.
      fineInk = coverage(fd, u_aa);
      fineGroove = u_sub_depth * c2.z * (1.0 - smoothstep(-0.5, max(u_bevel, 1.0), fd));
    }
    if (u_sub_vary) rnd = fract(rnd + c2.y * 0.37);
  }
  float sdf = -d;
  if (u_output == 1) return genOut(0.0, 1.0, rnd, sdf);
  // Plate surface for Height: ti runs 0 at the plate's border to 1 at its site (polygonal near the edge, round inside);
  // the dome falls, or the curl rises, over the outer Dome reach of it: a = 1 at the edge … 0 from the reach inwards.
  float r = length(off);
  float ti = c1.w / max(c1.w + r, 1e-4);
  float a = max(1.0 - ti / u_dome_edge, 0.0);
  float sh = 1.0;
  if (u_dome > 0.0) sh = 1.0 - u_dome * a * a;
  else if (u_dome < 0.0) sh = 1.0 + u_dome * (1.0 - a * a);
  if (u_tilt > 0.0) {
    // Per main plate: a direction (a random point in the square, normalised) and a share of the tilt.
    vec3 th = hash3I(ivec2(floor(c1.z * 65536.0), 7), uSeed + 71.0);
    vec2 dir = th.xy - 0.5;
    float u = dot(off, dir) * inversesqrt(max(dot(dir, dir), 1e-6)) / max(c1.w + r, 1e-4);
    sh *= 1.0 - u_tilt * (0.25 + 0.75 * th.z) * 0.5 * (1.0 - u);
  }
  // Plates: value 1 (colour) less the fine cracks, the plate surface less their grooves in Height; the wrapper multiplies
  // both by the bevel of the combined shape.
  GenOut o = genOutShaded(1.0 - fineInk, 1.0, rnd, sdf);
  o.hval = clamp(sh * (1.0 - fineGroove), 0.0, 1.0);
  return o;
}
`,
}
