// Mask area (FR8.23; was Crevices & high spots, FR8.13): a generator that only selects areas — it draws no layout of its
// own, it picks parts of what is already there, and writes them to a mask (Mask › Write to) for the layers after it to
// be limited to, or paints them directly.
//   Select › The surface: from the relief the layers above built — crevices (lower than around them), high spots, both,
//     slopes, slopes facing a direction (every bottom edge), or a height range.
//   Select › Features of a mask: from the shapes a mask holds — Inside (the mask's shape itself, with each feature's
//     random, so Source › Random and Per-feature variation work per brick), or a Gradient across each feature along a
//     direction (bottom to top of every block), or a band in from its edge on that side.
// Breakup pulls any selection down by fBm noise before Shaping, so its edge ends raggedly (edge wear, uneven grime).

import { P, type ParamValues } from '@/core/params'
import { SHAPE_MASK } from '@/core/project'
import type { LayerDef } from '../types'

const features = (p: ParamValues) => p.select === 'features'
const surface = (p: ParamValues) => !features(p)
const find = (...modes: string[]) => (p: ParamValues) => surface(p) && modes.includes(String(p.find ?? 'crevices'))
const gradient = (p: ParamValues) => features(p) && p.area === 'gradient'
/** The mask's own shape, as a distance (Inside without Breakup): the Edge controls apply and a write is a shape. */
const inside = (p: ParamValues) => features(p) && (p.area ?? 'inside') === 'inside' && !(Number(p.bk_amount ?? 0) > 0)

export const surfaceMaskLayer: LayerDef = {
  type: 'surfacemask',
  label: 'Mask area',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  sdfShowIf: (p) => inside(p),
  maskWrite: (p) => (inside(p) ? 'shape' : 'coverage'),
  maskSource: (p) => (features(p) ? String(p.src_mask ?? '').trim() || SHAPE_MASK : null),
  description:
    'Selects areas, to write to a mask or paint directly: from the surface so far (crevices, high spots, slopes, slopes facing a direction, a height range) or from the features of a mask (inside each one with its own random, or a gradient across each). Breakup frays the selection with noise.',
  params: [
    P.enum('select', 'Select', 'surface', [
      ['surface', 'The surface', 'from the relief the layers above built'],
      ['features', 'Features of a mask', 'from the shapes a mask holds: each brick, cell or plate'],
    ]),
    P.enum('find', 'Find', 'crevices', [
      ['crevices', 'Crevices', 'lower than the surface around them'],
      ['high', 'High spots', 'higher than the surface around them'],
      ['both', 'Both'],
      ['slopes', 'Slopes', 'steep anywhere'],
      ['facing', 'Facing a direction', 'slopes turned towards Direction: every bottom edge, the lit side of each bump'],
      ['height', 'Height range', 'above or below a level'],
    ], { showIf: surface }),
    P.float('radius', 'Radius', 8, 0.5, 64, { softMax: 16, unit: 'px', step: 0.1, showIf: find('crevices', 'high', 'both', 'slopes', 'facing'), hint: 'How far around each pixel the surface is compared: small = fine cracks and joints, large = broad dips and rises. Slopes are measured across half of it, so surface grain finer than that doesn’t count' }),
    P.float('depth', 'Depth', 0.5, 0.01, 64, { softMax: 4, unit: 'px', step: 0.01, hint: 'Height difference (px) that gives a full mask', showIf: find('crevices', 'high', 'both') }),
    P.float('steep', 'Full at slope', 0.2, 0.02, 16, { softMax: 2, step: 0.01, hint: 'Slope (height px per px; 1 = 45°) that gives a full mask: fine relief rises a pixel or two over several, so a fifth is steep here', showIf: find('slopes', 'facing') }),
    P.float('hlevel', 'Height level', 0.5, -16, 16, { softMin: 0, softMax: 1, step: 0.001, showIf: find('height'), hint: 'The height that divides above from below, in height units (1 = the project’s Height depth in px)' }),
    P.enum('hside', 'Side', 'above', [['above', 'Above'], ['below', 'Below']], { showIf: find('height') }),
    P.text('src_mask', 'Mask', SHAPE_MASK, { mask: 'read', showIf: features, hint: 'The mask whose features this selects, by name (Shape: the one shape layers write)' }),
    P.enum('area', 'Area', 'inside', [
      ['inside', 'Inside', 'the mask’s shape itself, each feature with its own random (Source › Random, Per-feature variation)'],
      ['gradient', 'Gradient', 'a ramp across each feature along Direction: 1 at the side it faces, 0 at the far side'],
    ], { showIf: features }),
    P.enum('across', 'Across', 'whole', [
      ['whole', 'The whole feature', 'from the far side to the near one'],
      ['edge', 'A band at the edge', 'only Width px in from the side Direction faces'],
    ], { showIf: gradient }),
    P.float('width', 'Width', 4, 0.5, 256, { softMax: 32, unit: 'px', step: 0.1, showIf: (p) => gradient(p) && p.across === 'edge', hint: 'How far in from the mask’s outline the band reaches (a bevel inside the outline is part of it)' }),
    P.float('band_soft', 'Band softness', 0.5, 0, 1, { step: 0.001, showIf: (p) => gradient(p) && p.across === 'edge', hint: 'The share of the band that fades out towards its inner end: 0 a crisp band, 1 a ramp all the way from the edge' }),
    P.float('dir', 'Direction', 180, 0, 360, {
      step: 1,
      showIf: (p) => find('facing')(p) || gradient(p),
      hint: 'Which way, in degrees round the texture: 0 top, 90 right, 180 bottom, 270 left',
    }),
    P.float('spread', 'Spread', 60, 1, 180, { step: 1, showIf: find('facing'), hint: 'How far round from Direction a slope may face and still count (degrees, fading to its edge)' }),
    P.float('reach', 'Max feature size', 128, 8, 1024, { softMax: 256, unit: 'px', step: 1, showIf: gradient, hint: 'How far the gradient looks for a feature’s edge: features longer than this ramp over this length only' }),
    P.float('level', 'Level', 0.2, 0, 1, { step: 0.001, showIf: surface, hint: 'Ignore anything weaker than this' }),
    P.float('softness', 'Softness', 0.5, 0, 1, { step: 0.001, showIf: surface, hint: 'How gradually the mask rises above the level (0 = hard edge)' }),
    P.float('bk_amount', 'Breakup', 0, 0, 1, { step: 0.001, section: 'Breakup', hint: 'Pulls the selection down by noise, so its edge ends raggedly — in patches and flecks with a Cutoff (Shaping), mottled without: chipped edge wear, grime that stops unevenly' }),
    P.float('bk_scale', 'Breakup size', 16, 1, 1024, { softMax: 64, unit: 'px', step: 0.1, section: 'Breakup', showIf: (p) => Number(p.bk_amount ?? 0) > 0, hint: 'Size of the noise’s blotches' }),
    P.seed('bk_seed', 'Breakup seed', 1, { section: 'Breakup', showIf: (p) => Number(p.bk_amount ?? 0) > 0 }),
  ],
  defaults: { mk_target: 'Crevices', dif_on: false, h_on: false, bevel: 0, profile: 'flat' },
  glsl: /* glsl */ `
// 1, read from a uniform: loops bounded by it are not unrolled by D3D (see ORG_1 in organicShared).
#define MA_1 (uRes.x > 0.0 ? 1 : 0)

float sm_h(vec2 px) { return sampleT(tSurface, px).r * uDepth; }
vec4 ma_src(vec2 q) { return fetchT(tMaskSrc, ivec2(floor(q))); }

// Breakup: fBm noise in 0..1, Breakup size px blotches (periodic when tiling); shifted by a feature's random, so each
// brick frays its own way.
float ma_breakup(vec2 p, float fid) {
  vec2 cells = cellsFor(uRes.x / max(u_bk_scale, 1.0), 1.0);
  vec2 shift = fid >= 0.0 ? vec2(fid * 37.0, fract(fid * 91.7) * 23.0) : vec2(0.0);
  return fractalNoise(1, 1, p / uRes * cells + shift, uTile ? ivec2(cells) : NO_PERIOD, 4, 2.0, 0.5, float(u_bk_seed) * 7.31 + 3.0);
}

// Direction (degrees round the texture, 0 = top, 90 = right) as a GL vector (y up).
vec2 ma_dir() { float a = radians(u_dir); return vec2(sin(a), cos(a)); }

// Surface modes: the selection's strength before Level / Softness, 0..1.
float ma_surface(vec2 p) {
  float h0 = sm_h(p);
  if (u_find == 5) {
    float s = max(u_softness, 1e-3);
    float hm = smoothstep(u_hlevel - s, u_hlevel + s, h0 / max(uDepth, 1e-6));
    return u_hside == 0 ? hm : 1.0 - hm;
  }
  if (u_find >= 3) {
    // The slope across half the Radius (bilinear samples): grain finer than that averages out.
    float r = max(0.5 * u_radius, 1.0);
    vec2 g = vec2(sm_h(p + vec2(r, 0.0)) - sm_h(p - vec2(r, 0.0)), sm_h(p + vec2(0.0, r)) - sm_h(p - vec2(0.0, r))) / (2.0 * r);
    float slope = length(g) / max(u_steep, 1e-3);
    if (u_find == 3) return slope;
    // Facing: the slope's downhill side (its face's outward direction) against Direction, fading over Spread.
    float c = length(g) > 1e-6 ? dot(-g / length(g), ma_dir()) : -1.0;
    float c0 = cos(radians(u_spread));
    return slope * smoothstep(c0, mix(c0, 1.0, 0.5), c);
  }
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
  float d = max(u_depth, 1e-3);
  return u_find == 0 ? c / d : u_find == 1 ? -c / d : abs(c) / d;
}

// Gradient: how far the feature at p reaches ahead along Direction and behind it (px), up to Max feature size. One flat
// loop over both sides: steps of the stored distance (at most 8 px, so a neighbour that touches isn't jumped) while
// inside the feature — the same mask inside, the same random where it has features — then bisection onto the edge.
// "Inside" reaches 0.75 px past the outline, so a ray along an edge skims past notches a pixel deep instead of stopping
// in them (which put specks of the far side's band along the long edges).
vec2 ma_extent(vec2 p, vec4 m0) {
  vec2 v = ma_dir();
  float reach = max(u_reach, 1.0);
  vec2 res = vec2(reach);
  int side = 0;
  float lo = 0.0, hi = -1.0, st = clamp(abs(m0.x), 1.0, 8.0);
  int kmax = min(2 * (int(reach) + 12), 4096) * MA_1;
  for (int k = 0; k < 4096; k++) {
    if (k >= kmax || side > 1) break;
    float t = hi < 0.0 ? min(lo + st, reach) : 0.5 * (lo + hi);
    vec4 m = ma_src(p + (side == 0 ? v : -v) * t);
    bool in_ = m.x < 0.75 && (m0.z < 0.5 || m.z < 0.5 || abs(m.y - m0.y) < 1e-4);
    if (in_) { lo = t; st = clamp(abs(m.x), 1.0, 8.0); } else hi = t;
    if ((hi >= 0.0 && hi - lo < 0.25) || (hi < 0.0 && lo >= reach)) {
      float r = hi < 0.0 ? reach : 0.5 * (lo + hi);
      if (side == 0) res.x = r; else res.y = r;
      side++;
      lo = 0.0;
      hi = -1.0;
      st = clamp(abs(m0.x), 1.0, 8.0);
    }
  }
  return res;
}

GenOut gen(vec2 p) {
  if (u_select == 0) {
    float bk = u_bk_amount > 0.0 ? 1.0 - u_bk_amount * ma_breakup(p, -1.0) : 1.0;
    float raw = clamp(ma_surface(p) * bk, 0.0, 1.0);
    float v = u_softness > 0.0 ? smoothstep(u_level, min(u_level + u_softness, 1.0 + 1e-3), raw) : step(u_level, raw) * step(1e-6, raw);
    if (u_find == 5) v = raw;
    return genOutSmooth(v, v, 0.0, NO_SDF);
  }
  vec4 m0 = ma_src(p);
  // The feature here: its random where the mask has features, none (fid −1) where it doesn't.
  float fid = m0.z > 0.5 ? m0.y : -1.0;
  // Per feature, Breakup pulls between 0.4× and 1.6× as hard: some bricks stay nearly whole, others go nearly bare.
  float bkAmt = u_bk_amount * (fid >= 0.0 ? mix(0.4, 1.6, fract(fid * 13.37 + 0.31)) : 1.0);
  float bk = u_bk_amount > 0.0 ? max(1.0 - bkAmt * ma_breakup(p, fid), 0.0) : 1.0;
  if (u_area == 0) {
    if (u_bk_amount <= 0.0) {
      GenOut o = genOut(0.0, 1.0, max(fid, 0.0), m0.x);
      o.feat = fid >= 0.0 ? 1.0 : 0.0;
      o.fid = fid;
      return o;
    }
    float v = clamp(0.5 - m0.x, 0.0, 1.0) * bk;
    GenOut o = genOut(v, v, max(fid, 0.0), NO_SDF);
    o.feat = fid >= 0.0 ? 1.0 : 0.0;
    o.fid = fid;
    return o;
  }
  if (m0.x >= 0.0) return genOutSmooth(0.0, 0.0, 0.0, NO_SDF);
  vec2 e = ma_extent(p, m0);
  float w = max(u_width, 0.5);
  float v = u_across == 1 ? 1.0 - smoothstep(w * (1.0 - u_band_soft) - 0.5, w + 0.5, e.x) : e.y / max(e.x + e.y, 1e-3);
  v *= bk;
  GenOut o = genOut(v, v, max(fid, 0.0), NO_SDF);
  o.feat = fid >= 0.0 ? 1.0 : 0.0;
  o.fid = fid;
  return o;
}
`,
}
