// Fill-style pattern layers (FR2.4): fBm clouds, gradients (UI shading) and random scratches (metal wear).
// Clouds and gradients are value generators (no SDF); scratches also hand their outline to the Shape Mask
// (sdf: 'mask'). See patterns.ts for the cell-based SDF patterns.

import { P, gradient, type ParamValues } from '@/core/params'
import type { LayerDef } from '../types'
import { NZ_SHARED_GLSL, quantileTexture, quantilesOf } from './noise'

// ------------------------------------------------------------------------------------------------ clouds

// ---- The clouds' raw value on the CPU: the shader's gen() ported line for line (the same PCG hashes, lattices, warp,
// decorrelation and octave loop), so Coverage measures this very texture's quantiles — a texture a few cells
// across holds few lumps, and its share above any level strays from the population's by several percent. Not ported:
// the animation phase and the layer's own domain warp / offset (they move the pattern; its statistics barely change).

const pcgU = (v: number) => {
  const st = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0
  const w = Math.imul(((st >>> ((st >>> 28) + 4)) ^ st) >>> 0, 277803737) >>> 0
  return ((w >>> 22) ^ w) >>> 0
}
const hashI = (x: number, y: number, s: number) => pcgU((x >>> 0) ^ pcgU((y >>> 0) ^ pcgU(s >>> 0))) / 4294967296
const imod = (a: number, m: number) => ((a % m) + m) % m
const quint = (f: number) => f * f * f * (f * (f * 6 - 15) + 10)
const NO_PER = 1 << 20

function cvNoise(basis: number, x: number, y: number, px: number, py: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const corner = (ox: number, oy: number) => {
    const cx = imod(ix + ox, px), cy = imod(iy + oy, py)
    if (basis === 0) return hashI(cx, cy, s)
    const a = hashI(cx, cy, s) * Math.PI * 2
    return Math.cos(a) * (fx - ox) + Math.sin(a) * (fy - oy)
  }
  const ux = quint(fx), uy = quint(fy)
  const a = corner(0, 0), b = corner(1, 0), c = corner(0, 1), d = corner(1, 1)
  const v = (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy
  return basis === 0 ? v : Math.min(1, Math.max(0, v * 1.2 + 0.5))
}

// rl_noise / rl_reduce / rl_lattice (NZ_SHARED_GLSL).
function rlNoise(basis: number, y0: number, y1: number, c1: number[], c2: number[], s: number): number {
  const D = c1[0] * c2[1] - c2[0] * c1[1]
  const ix = Math.floor(y0), iy = Math.floor(y1), fx = y0 - ix, fy = y1 - iy
  const corner = (ox: number, oy: number) => {
    const kx = ix + ox, ky = iy + oy
    const a = Math.floor((c2[1] * kx - c2[0] * ky) / D), b = Math.floor((c1[0] * ky - c1[1] * kx) / D)
    const rx = kx - a * c1[0] - b * c2[0], ry = ky - a * c1[1] - b * c2[1]
    if (basis === 0) return hashI(rx, ry, s)
    const g = hashI(rx, ry, s) * Math.PI * 2
    return Math.cos(g) * (fx - ox) + Math.sin(g) * (fy - oy)
  }
  const ux = quint(fx), uy = quint(fy)
  const a = corner(0, 0), b = corner(1, 0), c = corner(0, 1), d = corner(1, 1)
  const v = (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy
  return basis === 0 ? v : Math.min(1, Math.max(0, v * 1.2 + 0.5))
}

/** The clouds' raw value (before the coverage threshold and contrast) at 4096 points of the texture. */
export function cloudsSamples(p: ParamValues, ctx: { width: number; height: number; tileable: boolean; seed: number }): number[] {
  const W = ctx.width, H = ctx.height, tile = ctx.tileable, seed = ctx.seed
  const scale = Number(p.scale), stretch = Math.max(Number(p.stretch ?? 1), 1e-3)
  let cx = scale / stretch, cy = (scale * H) / W
  if (tile) { cx = Math.max(1, Math.floor(cx + 0.5)); cy = Math.max(1, Math.floor(cy + 0.5)) } else { cx = Math.max(cx, 1e-3); cy = Math.max(cy, 1e-3) }
  const per0x = tile ? cx : NO_PER, per0y = tile ? cy : NO_PER
  const basis = p.basis === 'value' ? 0 : 1
  const style = ({ fbm: 0, billow: 1, ridged: 2, cumulus: 3 } as Record<string, number>)[String(p.style)] ?? 0
  const oct = Math.max(1, Math.min(12, Math.round(Number(p.octaves))))
  const gain = Number(p.gain), lac = Number(p.lacunarity ?? 2), ilac = Math.floor(lac + 0.5)
  const crease = Number(p.crease ?? 0), hier = Number(p.hier ?? 0), ridge = Number(p.ridge ?? 0)
  const warp = Number(p.warp ?? 0), wdetail = Number(p.wdetail ?? 1)
  const turned = tile && per0x === per0y
  const ro = 1 + ridge
  // warpOffset(x, per, seed + 7): fractalNoise(perlin, fBm, 3 octaves, lacunarity 2, gain 0.5), twice.
  const fbm3 = (x: number, y: number, sd: number) => {
    let sum = 0, amp = 1, norm = 0, px = per0x, py = per0y
    for (let o = 0; o < 3; o++) {
      sum += cvNoise(1, x, y, px, py, sd + o * 31) * amp
      norm += amp
      amp *= 0.5
      x *= 2; y *= 2
      if (tile) { px *= 2; py *= 2 }
    }
    return sum / norm
  }
  const out: number[] = []
  const G = 64
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    // Pixel centres spread over the texture.
    const pxl = Math.floor(((gx + 0.5) / G) * W) + 0.5, pyl = Math.floor(((gy + 0.5) / G) * H) + 0.5
    let x = (pxl / W) * cx, y = (pyl / H) * cy
    let offx = 0, offy = 0
    if (warp > 0) {
      const wx = (fbm3(x, y, seed + 7 + 101) - 0.5) * warp * 2, wy = (fbm3(x + 17.3, y + 17.3, seed + 7 + 211) - 0.5) * warp * 2
      if (wdetail >= 1) { x += wx; y += wy } else { offx = wx; offy = wy }
    }
    let sum = 0, amp = 1, norm = 0, weight = 1, f0 = 1, cut = 1
    let px = per0x, py = per0y
    for (let o = 0; o < oct; o++) {
      const s = seed + o * 31
      let xo = x + offx, yo = y + offy
      const shx = hashI(o, 3, seed) + 0.37 * o, shy = hashI(o, 5, seed) + 0.37 * o
      if (o > 0) { xo += shx; yo += shy }
      if (!tile) { const a = 0.5 + 2.4 * o, c = Math.cos(a), sn = Math.sin(a); const tx = c * xo - sn * yo; yo = sn * xo + c * yo; xo = tx }
      const dual = basis === 0
      let n = 0
      for (let j = 0; j < (dual ? 2 : 1); j++) {
        const sj = s + 13 * j
        if (turned) {
          let m = Math.max(1, Math.floor(cx / 2.236068 + 0.5))
          for (let q = 0; q < o; q++) m *= ilac
          let c1 = o % 2 === 0 ? [2 * m, m] : [m, 2 * m], c2 = o % 2 === 0 ? [-m, 2 * m] : [-2 * m, m]
          if (j === 1) { c1 = [c1[1], c1[0]]; c2 = [-c2[1], -c2[0]] }
          const k = px / per0x
          const ux = (x + offx) / (cx * k), uy = (y + offy) / (cy * k)
          n += rlNoise(basis, c1[0] * ux + c2[0] * uy + shx + 0.5 * j, c1[1] * ux + c2[1] * uy + shy + 0.5 * j, c1, c2, sj)
        } else {
          let xj = xo, yj = yo
          if (j === 1) {
            if (!tile) { const c = Math.cos(1.1), sn = Math.sin(1.1); const tx = c * xj - sn * yj; yj = sn * xj + c * yj; xj = tx }
            xj += 0.5; yj += 0.5
          }
          n += cvNoise(basis, xj, yj, px, py, sj)
        }
      }
      if (dual) n = Math.min(1, Math.max(0, 0.5 + (n - 1) * 0.70711))
      const ce = 0.25 * crease * (style === 1 ? 1 + 0.5 * o : 1 + o) * (style === 2 ? 2 : 1) + (style === 2 ? 0.15 * hier * Math.max(o - 1, 0) : 0)
      const ha = style !== 2 || o === 0 ? 1 : o === 1 ? 1 + 0.6 * hier : Math.pow(1 - 0.35 * hier, o - 1)
      const t = 2 * n - 1
      const fold = ce > 0 ? (Math.sqrt(t * t + ce * ce) - ce) / (Math.sqrt(1 + ce * ce) - ce) : Math.abs(t)
      let wn = 1
      if (style === 2) {
        const c = (ro - fold) / ro
        const hp = o === 0 ? RIDGE_SHARP(hier) : 0, hg = o === 0 ? -hier : 2 * hier
        let r = c * c * (hp > 0 ? Math.pow(Math.max(c, 1e-6), hp) : 1)
        const gt = c * c * (hg !== 0 ? Math.pow(Math.max(c, 1e-6), hg) : 1)
        wn = 1 + (weight - 1) * hier
        r *= weight
        weight = Math.max(Math.min(1, Math.max(0, 2 * gt * weight)), Math.min(ridge, 1))
        n = r
      } else if (style === 1 || (style === 3 && o > 0)) {
        n = style === 1 ? (crease > 0 ? Math.pow(fold, 1 - 0.5 * crease) : fold) : fold + (n - fold) * (o >= 3 ? 1 : 0)
      }
      let bg = 1
      if (style === 1 && crease > 0) {
        if (o === 0) f0 = fold
        else { const e = Math.min(1, Math.max(0, f0 / 0.6)); bg = 1 + (e * e * (3 - 2 * e) - 1) * crease }
        if (o === 1 || o === 2) { const e = Math.min(1, Math.max(0, fold / 0.6)); cut *= 1 + (0.45 + 0.55 * e * e * (3 - 2 * e) - 1) * crease * (o === 1 ? 1 : 0.3) }
      }
      sum += n * amp * ha * bg
      norm += amp * ha * wn
      amp *= gain
      const lm = tile ? ilac : lac
      if (tile) { x *= ilac; y *= ilac; px *= ilac; py *= ilac } else { x *= lac; y *= lac }
      offx *= lm * wdetail; offy *= lm * wdetail
    }
    out.push((sum / Math.max(norm, 1e-6)) * cut)
  }
  return out
}

/** Ridge hierarchy: the main crest's extra sharpening exponent (shader: the same expression). */
const RIDGE_SHARP = (h: number) => 6 * h * h

export const cloudsLayer: LayerDef = {
  type: 'clouds',
  noise: true,
  label: 'Clouds',
  category: 'noise',
  kind: 'generator',
  description: 'Classic fractal clouds with domain warp, contrast and coverage — grime, stains, soft variation.',
  params: [
    P.enum('basis', 'Basis', 'perlin', [['value', 'Value'], ['perlin', 'Perlin']]),
    P.enum('style', 'Style', 'cumulus', [
      ['fbm', 'Soft', 'fractal clouds: soft smoke, stains, grime'],
      ['billow', 'Billow (puffy)', 'every octave folded: lumps between a network of dark creases'],
      ['ridged', 'Ridged', 'sharp crests round dark basins: veins, erosion, lightning'],
      ['cumulus', 'Cumulus', 'soft masses built of puffy sub-lumps: the first octave smooth, the finer ones folded — cauliflower clouds, foam, moss'],
    ]),
    P.float('scale', 'Scale', 4, 0.25, 512, { softMax: 48, step: 0.01, hint: 'Base cells across the texture width (rounded when tiling)' }),
    P.float('stretch', 'Stretch', 1, 0.02, 100, { softMin: 0.1, softMax: 16, step: 0.01, hint: '>1 elongates features horizontally (streaks, strata), <1 vertically (rain marks)' }),
    P.int('octaves', 'Octaves', 6, 1, 12),
    P.float('lacunarity', 'Lacunarity', 2, 1, 8, { softMin: 1.5, softMax: 6, step: 0.01, hint: 'Frequency step per octave (rounded to a whole number when tiling: 2, 3, 4 …)' }),
    P.float('gain', 'Gain', 0.45, 0, 1, { step: 0.001, hint: 'Amplitude kept per octave (roughness)' }),
    P.float('crease', 'Crease softness', 0.6, 0, 1, {
      step: 0.001,
      showIf: (p) => p.style !== 'fbm',
      hint: 'Rounds the sharp folds of Billow, Cumulus and Ridged (their dark creases and bright crests; at 0 the fine ones turn to hairlines). Billow: also domes the lumps and lets the second octave’s creases split them into sub-lumps. 0 = knife-sharp, 1 = soft',
    }),
    P.float('ridge', 'Ridge offset', 0.35, 0, 2, {
      softMax: 1,
      step: 0.001,
      showIf: (p) => p.style === 'ridged',
      hint: 'Lifts the valleys between the ridges and lets the finer octaves into them (at least this share of each): 0 = classic ridged (basins fall to flat black), 0.5 = shallower basins with half the fine detail, 1 = the detail everywhere',
    }),
    P.float('hier', 'Ridge hierarchy', 0.7, 0, 1, {
      step: 0.001,
      showIf: (p) => p.style === 'ridged',
      hint: 'Ridged: main ridgelines with smaller ridges branching off them — the finer octaves only near the crests of the coarser ones (and wider), the flanks between left smooth (0: every scale at once, the classic ridged multifractal)',
    }),
    P.float('warp', 'Warp', 0.1, 0, 16, { softMax: 3, step: 0.001, hint: 'Domain warp, in base cells' }),
    P.float('wdetail', 'Warp detail', 0.4, 0, 1, {
      step: 0.001,
      showIf: (p) => Number(p.warp) > 0,
      hint: 'How much of the warp the finer octaves take: 1 = all of it (fine detail drawn out into streaks and strands), 0.5 = the large shapes swirl, fine detail stays even, 0 = only the first octave warps',
    }),
    P.float('contrast', 'Contrast', 1.5, 0, 64, { softMax: 12, step: 0.01 }),
    P.float('coverage', 'Coverage', 0.5, 0, 1, { step: 0.001, hint: 'Share of the area above mid-grey — measured on this very texture, for every style, seed and size' }),
    P.float('soft', 'Softness', 1, 0, 1, { step: 0.001, hint: 'Rounds where Contrast clips to black and white, the mid-tones untouched: 0 = a hard cut (a crease round every flat plateau), 0.5 = shoulders that meet at mid-grey, 1 = a sigmoid that never quite reaches black or white (domed lumps)' }),
    P.seed(),
  ],
  // Coverage and Contrast act on this texture's own measured value spread (see cloudsSamples).
  textures: ['calib'],
  cpuData: (p, ctx) => quantileTexture(quantilesOf(cloudsSamples(p, ctx))),
  // An Overlay ramp that both darkens and lightens what is beneath.
  defaults: {
    dif_on: true,
    dif_blend: 'overlay',
    dif_opacity: 0.85,
    dif_grad: gradient('#2a241e', '#fbf6ee'),
    h_on: true,
    h_amount: 0.15,
  },
  glsl: /* glsl */ `
// 1, read from a uniform: a loop bound written with it can't be unrolled, so D3D keeps one copy of the body.
#define CL_1 (uRes.x > 0.0 ? 1 : 0)

${NZ_SHARED_GLSL}
// The integral of clamp(x, 0, 1): differences of it give the clamp box-filtered over a width (soft shoulders).
float cl_clampInt(float x) { return x < 0.0 ? 0.0 : x < 1.0 ? 0.5 * x * x : x - 0.5; }

GenOut gen(vec2 p) {
  vec2 cells = cellsFor(u_scale, u_stretch);
  ivec2 per = uTile ? ivec2(cells) : NO_PERIOD;
  vec2 x = p / uRes * cells;
  // The warp: added to x (every octave takes all of it), or carried separately and scaled down per octave
  // (Warp detail < 1). off stays 0 in the first case, so x + off is x exactly.
  vec2 off = vec2(0.0);
  if (u_warp > 0.0) {
    vec2 w = warpOffset(x, per, uSeed + 7.0) * u_warp * 2.0;
    if (u_wdetail >= 1.0) x += w; else off = w;
  }
  // fractalNoise(basis, fbm | billow | ridged, …) in one flat loop with a runtime bound and only value / Perlin in it:
  // the same values, a much smaller shader than the library's generic dispatch.
  float sum = 0.0, amp = 1.0, norm = 0.0, weight = 1.0, f0 = 1.0, cut = 1.0;
  float ro = 1.0 + u_ridge;   // ridged: the offset the crest is measured from (1 = classic)
  int ilac = int(u_lacunarity + 0.5);
  // Tiling, on a square grid of cells: value / Perlin on the turned tileable lattice (rl_noise), each octave its own.
  bool turned = uTile && per.x == per.y;
  ivec2 per0 = per;
  for (int o = 0; o < 12 * CL_1; o++) {
    if (o >= u_octaves) break;
    float s = uSeed + float(o) * 31.0;
    vec2 xo = x + off;
    vec2 sh = vec2(hashI(ivec2(o, 3), uSeed), hashI(ivec2(o, 5), uSeed)) + 0.37 * float(o);
    if (o > 0) xo += sh;
    if (!uTile) xo = rot2(0.5 + 2.4 * float(o)) * xo;
    // Value noise: two lattices (the second turned the other way, or by an irrational angle when not
    // tiling, and shifted half a cell) averaged at the spread of one — value noise's straight cell-edge contours,
    // which a fold turns into crease segments on a grid, cancel out.
    bool dual = u_basis == 0;
    float n = 0.0;
    for (int j = 0; j < (dual ? 2 : 1) * CL_1; j++) {
      float sj = s + 13.0 * float(j);
      float nj;
      if (turned) {
        ivec2 c1, c2;
        rl_lattice(o, cells.x, ilac, c1, c2);
        if (j == 1) { c1 = ivec2(c1.y, c1.x); c2 = ivec2(-c2.y, -c2.x); }
        nj = rl_noise(u_basis, mat2(vec2(c1), vec2(c2)) * ((x + off) / (cells * float(per.x / per0.x))) + sh + 0.5 * float(j), c1, c2, sj);
      } else {
        vec2 xj = j == 0 ? xo : (uTile ? xo : rot2(1.1) * xo) + 0.5;
        nj = u_basis == 0 ? valueNoise(xj, per, sj) : perlinNoise(xj, per, sj);
      }
      n += nj;
    }
    if (dual) n = clamp(0.5 + (n - 1.0) * 0.70711, 0.0, 1.0);
    // Billow's |2n - 1| (and Ridged's crest) with the fold rounded over Crease softness, more on each finer octave
    // (whose thin creases are what reads as hair), still 0..1.
    // (Billow: the same rounding on every octave, so the finer octaves crease too, their creases as much narrower as
    // they are finer.)
    float ce = 0.25 * u_crease * (u_style == 1 ? 1.0 + 0.5 * float(o) : float(1 + o)) * (u_style == 2 ? 2.0 : 1.0) + (u_style == 2 ? 0.15 * u_hier * float(max(o - 1, 0)) : 0.0);
    // Ridge hierarchy's octave amplitudes (as Noise's): the second octave louder, the finer ones quieter.
    float ha = u_style != 2 || o == 0 ? 1.0 : o == 1 ? 1.0 + 0.6 * u_hier : pow(1.0 - 0.35 * u_hier, float(o - 1));

    float fold = ce > 0.0 ? (sqrt((2.0 * n - 1.0) * (2.0 * n - 1.0) + ce * ce) - ce) / (sqrt(1.0 + ce * ce) - ce) : abs(2.0 * n - 1.0);
    float wn = 1.0;   // this octave's share of the normalisation
    if (u_style == 2) {
      // Ridge hierarchy (as Noise's, sharper): the main crest (first octave) sharpened to a ridgeline (c^(2 + 6h²)) and gating the second
      // octave wide (c^(2 - h): its ridgelets reach down the flanks, attached to the main crest), the finer octaves
      // gated only near the crests of the one before (c^(2 + 2h)) — main ridgelines, ridgelets branching off them,
      // fine detail along those — and an octave counts in the normalisation only as far as it's weighted. At 0 the
      // classic ridged multifractal (c², weight 2r).
      float c = (ro - fold) / ro;
      float hp = o == 0 ? 6.0 * u_hier * u_hier : 0.0;   // RIDGE_SHARP
      float hg = o == 0 ? -u_hier : 2.0 * u_hier;
      float r = c * c * (hp > 0.0 ? pow(max(c, 1e-6), hp) : 1.0);
      float gt = c * c * (hg != 0.0 ? pow(max(c, 1e-6), hg) : 1.0);
      wn = mix(1.0, weight, u_hier);
      r *= weight;
      weight = clamp(2.0 * gt * weight, 0.0, 1.0);
      // Ridge offset: the basins keep this share of every octave's detail too.
      weight = max(weight, min(u_ridge, 1.0));
      n = r;
    } else if (u_style == 1 || (u_style == 3 && o > 0)) {
      // Billow: every octave folds (lumps at every scale), domed with Crease softness (fold^(1 - 0.5 crease):
      // rounded tops, the crease a clean V). Cumulus: the first octave stays smooth (the masses), the next two fold
      // into sub-lumps, the finer ones stay plain noise (texture on the lumps, no hairline creases).
      n = u_style == 1 ? (u_crease > 0.0 ? pow(fold, 1.0 - 0.5 * u_crease) : fold) : mix(fold, n, o >= 3 ? 1.0 : 0.0);
    }
    // Billow with Crease softness: the finer octaves fade out inside the first octave's creases (by its fold), so the
    // creases stay clean folds while the lumps carry the detail (cauliflower), instead of grainy bands.
    float bg = 1.0;
    if (u_style == 1 && u_crease > 0.0) {
      if (o == 0) f0 = fold;
      else bg = mix(1.0, smoothstep(0.0, 0.6, f0), u_crease);
      // The second octave's creases (and faintly the third's) also cut into the lumps, multiplied in: each lump split
      // into sub-lumps — creases at two scales, not one maze.
      if (o == 1 || o == 2) cut *= mix(1.0, 0.45 + 0.55 * smoothstep(0.0, 0.6, fold), u_crease * (o == 1 ? 1.0 : 0.3));
    }
    sum += n * amp * ha * bg;
    norm += amp * ha * wn;
    amp *= u_gain;
    float lm = uTile ? float(ilac) : u_lacunarity;
    if (uTile) { x *= float(ilac); per *= ilac; } else { x *= u_lacunarity; }
    off *= lm * u_wdetail;
  }
  float n = sum / max(norm, 1e-6) * cut;
  // Coverage, exactly: the value evened out by this texture's measured quantiles (eq_value), the threshold its measured
  // (1 - coverage) quantile, evened out the same way.
  float nv = eq_value(n);
  float thr = eq_value(eq_quant(1.0 - u_coverage));
  float v = (nv - thr) * u_contrast + 0.5;
  // Clip to 0..1 with Softness: up to 0.5 the clamp box-filtered over 2 × Softness (quadratic shoulders); from 0.5 to
  // 1 blended into a sigmoid (0.5 + tanh(2 (v - 0.5)) / 2) that never flattens — domes, not plateaus. The mid-tone
  // slope is kept throughout (0 = the plain clamp).
  float sw = min(2.0 * u_soft, 1.0);
  float vb = sw > 0.0 ? (cl_clampInt(v + 0.5 * sw) - cl_clampInt(v - 0.5 * sw)) / sw : clamp(v, 0.0, 1.0);
  v = mix(vb, 0.5 + 0.5 * tanh(2.0 * (v - 0.5)), clamp(2.0 * u_soft - 1.0, 0.0, 1.0));
  return genOutSmooth(clamp(v, 0.0, 1.0), 1.0, n, 0.0);
}
`,
}

// ------------------------------------------------------------------------------------------------ gradient

const radialish = (p: Record<string, unknown>) => p.style !== 'linear'
const repeating = (p: Record<string, unknown>) => p.repeat !== 'clamp'

export const gradientLayer: LayerDef = {
  type: 'gradient',
  label: 'Gradient',
  category: 'pattern',
  kind: 'generator',
  description: 'Linear, radial, angular, diamond or square ramp with repeat / mirror and a falloff curve — UI shading, vignettes, sheens, domes.',
  params: [
    P.enum('style', 'Type', 'linear', [
      ['linear', 'Linear'],
      ['radial', 'Radial'],
      ['angular', 'Angular'],
      ['diamond', 'Diamond'],
      ['square', 'Square', 'rectangular rings: inner glows and bevels of buttons and panels'],
    ]),
    P.float('angle', 'Angle', 270, -360, 360, { softMin: -180, softMax: 360, unit: '°', step: 0.1, hint: 'Direction from 0 to 1, clockwise from →; 270 runs bottom → top. Turns radial-type shapes (their Stretch axis) and where an angular sweep starts' }),
    P.float('cx', 'Centre X', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: 'Where the ramp is at its middle (linear) or starts (the others)' }),
    P.float('cy', 'Centre Y', 0.5, -2, 3, { softMin: 0, softMax: 1, step: 0.001, hint: '0..1 down' }),
    P.float('length', 'Length / radius', 0, 0, 8192, { softMax: 512, unit: 'px', step: 0.5, showIf: (p) => p.style !== 'angular', hint: '0 = fit the texture (linear spans it, the others reach the farthest corner). Shorter, with Repeat or Mirror: bands of this width' }),
    P.float('stretch', 'Stretch', 1, 0.02, 50, { softMin: 0.2, softMax: 5, step: 0.01, showIf: radialish, hint: 'Elongates the rings along the Angle direction (> 1) or across it (< 1): ellipses, long diamonds, rectangles. Tiling with Centre › Wrap, long rings run into their neighbouring copies’ (Seam rounding bends them together); Single keeps one clean ellipse' }),
    P.float('round', 'Roundness', 0, 0, 1, { step: 0.001, showIf: (p) => p.style === 'diamond' || p.style === 'square', hint: 'Rounds the corners of diamond and square rings (superellipses), so they meet without a crease on the diagonals: 0 = sharp, 1 = round' }),
    P.int('turns', 'Ramps', 1, 1, 256, { softMax: 32, showIf: (p) => p.style === 'angular', hint: 'Ramps around the centre: a fan of rays (Repeat); with Mirror two ramps make one up-and-down wedge (16 → an 8-pointed star). Tiling with Centre › Wrap, an even count bends round the tile and repeats seamlessly; an odd count starts on a single centre (one sweep can’t tile round its centre: Wrap then bends the rays towards a diagonal)' }),
    P.float('twist', 'Twist', 0, -32, 32, { softMin: -4, softMax: 4, step: 0.001, showIf: (p) => p.style === 'angular', hint: 'Winds the sweep into a spiral: turns from the centre to half the texture width' }),
    P.enum('repeat', 'Repeat', 'clamp', [
      ['clamp', 'None (clamp)', 'one ramp, flat beyond it — a linear one can’t tile (its top meets its bottom)'],
      ['repeat', 'Repeat', 'sawtooth: the ramp starts over at every band'],
      ['mirror', 'Mirror', 'up and down: bands without a step'],
    ]),
    P.float('band_jit', 'Band width jitter', 0, 0, 1, { step: 0.001, showIf: repeating, hint: 'Each band its own width (Repeat, Mirror): 1 = from a tenth to nearly twice the Length — strata, planks, siding. Still tiles with Fit the tile' }),
    P.float('shift', 'Band offset', 0, -100, 100, { softMin: -1, softMax: 1, step: 0.001, hint: 'Moves the ramp along itself, in ramps: 0.5 puts the band edges where their middles were' }),
    P.bool('fit', 'Fit the tile', true, {
      showIf: (p) => p.style !== 'angular' && repeating(p),
      hint: 'Tiling projects: rounds the band length so a whole number of bands fits across the tile — the bands run on seamlessly over its edges (a linear ramp’s angle snaps a little, like Stripes)',
    }),
    P.enum('wrap', 'Centre', 'wrap', [
      ['wrap', 'Wrap (seamless)', 'tiling projects: the nearest copy of the centre in the neighbouring tiles — seamless, with a crease where the copies meet'],
      ['single', 'Single', 'only this centre: a plain spotlight or vignette (not seamless across the tile’s edges)'],
    ], { showIf: radialish, hint: 'Tiling projects: Wrap repeats the centre in every neighbouring tile, so the texture tiles; Single draws only this centre (a spotlight or vignette — it does not tile)' }),
    P.float('seam', 'Seam rounding', 0, 0, 1024, { softMax: 48, unit: 'px', step: 0.1, showIf: (p) => radialish(p) && p.style !== 'angular' && p.wrap !== 'single', hint: 'Where the copies of the centre meet (Wrap, tiling projects): over about this width their rings bend from one copy’s into the next’s instead of meeting in a crease or a seam (a clamped ramp: a rounded ridge)' }),
    P.enum('falloff', 'Falloff', 'linear', [
      ['linear', 'Linear', 'an even ramp'],
      ['smooth', 'Smooth', 'S-curve: eases out of 0 and into 1 — no crease at the ends, a rounded tip at a radial centre'],
      ['round', 'Round', 'quarter circle: rises fast, flattens towards 1'],
      ['cove', 'Cove', 'concave: stays low, then rises steeply — with Invert, a radial cove is a hemisphere'],
    ], { hint: 'The curve along each ramp (applied after Repeat / Mirror); Shaping › Gamma bends it continuously' }),
    P.bool('aa', 'Anti-alias', true, { showIf: (p) => repeating(p) || p.style === 'angular', hint: 'Smooths the step where a ramp wraps from 1 back to 0 (Repeat, the start of an angular sweep) and the folds of Mirror; bands finer than a pixel fade to grey. Off for hard pixel steps' }),
    P.seed('seed', 'Seed', 1, { hint: 'The per-band random (each repeat of the ramp: Source › Random, Diffuse jitter, Per-feature variation)' }),
  ],
  // Added in the editor: repeats fit the tile, and the creases where copies of a centre meet are rounded.
  // Added in the editor: the creases where copies of a centre meet rounded by 5 % of the texture.
  fresh: ({ width, height }) => ({ seam: Math.round(0.05 * Math.min(width, height) * 10) / 10 }),
  // One ramp (or any odd count) can't sweep round a tiling centre: an angular gradient with an odd count starts with a
  // single centre (Wrap tiles it, bent); an even count with the centre repeated, seamless.
  linkedDefaults: (p) => ({ wrap: p.style === 'angular' && Number(p.turns ?? 1) % 2 === 1 ? 'single' : 'wrap' }),
  defaults: {
    dif_on: true,
    dif_grad: gradient('#3a3e43', '#9aa3ab'),
  },
  glsl: /* glsl */ `
// 1, read from a uniform: a loop bound written with it can't be unrolled, so D3D keeps one copy of the body.
#define GR_1 (uRes.x > 0.0 ? 1 : 0)

// Ring metric of the radial-type styles: radial (1) round, diamond (3) L1, square (4) L∞. Roundness turns diamond and
// square into superellipses (p 1 → 2, ∞ → 2): rings without creases on the diagonals.
float gr_metric(vec2 v) {
  vec2 a = abs(v);
  if (u_style == 1) return length(v);
  if (u_round <= 0.0) return u_style == 3 ? a.x + a.y : max(a.x, a.y);
  float pw = u_style == 3 ? 1.0 + u_round : 2.0 / u_round;
  float mx = max(max(a.x, a.y), 1e-20);
  vec2 r = a / mx;
  return mx * pow(pow(r.x, pw) + pow(r.y, pw), 1.0 / pw);
}

// The argument of the Jacobi theta function θ1(x | q = e^(-π T)) at complex x (|Im x| ≤ π T): four terms of
// 2 Σ (-1)^n q^((n+½)²) sin((2n+1) x), each scaled by e^(-|Im x|) (a positive factor: the argument is unchanged) so
// nothing overflows.
float gr_thetaArg(vec2 x, float T) {
  float b = abs(x.y), sg = x.y < 0.0 ? -1.0 : 1.0;
  vec2 acc = vec2(0.0);
  for (int n = 0; n < 4 * GR_1; n++) {
    float m = float(2 * n + 1);
    float c = (n % 2 == 0 ? 1.0 : -1.0) * exp(-PI * T * (float(n) + 0.5) * (float(n) + 0.5));
    float ep = exp((m - 1.0) * b), em = exp(-(m + 1.0) * b);
    // sin(m x) e^(-b): (sin(m a) cosh(m b), cos(m a) sinh(m b)) · e^(-b)
    acc += c * vec2(sin(m * x.x) * 0.5 * (ep + em), cos(m * x.x) * sg * 0.5 * (ep - em));
  }
  return atan(acc.y, acc.x);
}

// Polynomial smooth minimum over k (the crease where two copies meet, rounded).
float gr_smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }

// fract(t) box-filtered over w (the footprint of a pixel, in t): the wrap from 1 back to 0 is anti-aliased, and bands
// finer than a pixel fade to their mean. Uses the integral of fract, floor(x) / 2 + fract(x)² / 2.
float gr_fractAA(float t, float w) {
  if (w < 1e-6) return fract(t);
  float a = t - 0.5 * w, b = t + 0.5 * w;
  float fa = fract(a), fb = fract(b);
  return clamp((0.5 * (floor(b) - floor(a)) + 0.5 * (fb * fb - fa * fa)) / w, 0.0, 1.0);
}

// Mirror's triangle wave (0 at even t, 1 at odd), and its integral for the box-filtered version.
float gr_tri(float t) { float m = mod(t, 2.0); return m > 1.0 ? 2.0 - m : m; }
float gr_triInt(float x) { float m = mod(x, 2.0); return floor(x / 2.0) + (m <= 1.0 ? 0.5 * m * m : 1.0 - 0.5 * (2.0 - m) * (2.0 - m)); }
float gr_triAA(float t, float w) { return w < 1e-6 ? gr_tri(t) : clamp((gr_triInt(t + 0.5 * w) - gr_triInt(t - 0.5 * w)) / w, 0.0, 1.0); }

int gr_gcd(int a, int b) {
  for (int i = 0; i < 64 * GR_1; i++) { if (b == 0) break; int r = a % b; a = b; b = r; }
  return max(a, 1);
}

// The ramp's t from an offset d to a centre (radial-type: ring metric / R; angular: the sweep, twisted).
float gr_t(vec2 d, float R, float st) {
  vec2 q = unrotCW(d, u_angle);
  vec2 qs = vec2(q.x / st, q.y);
  if (u_style == 2) return fract(-atan(qs.y, qs.x) / TAU + u_twist * length(qs) / (0.5 * uRes.x)) * float(u_turns);
  return gr_metric(qs) / R;
}

// t's rate per pixel, for the anti-aliasing; an angular sweep's t jumps at its start, so take the rate from a copy
// that jumps on the opposite side wherever that is smaller.
float gr_w(float t) {
  float w = fwidth(t);
  if (u_style == 2) w = min(w, fwidth(fract(t / float(u_turns) + 0.5)) * float(u_turns));
  return w;
}

// The value at t: Repeat / Mirror (anti-aliased over w), faded to the mean where the bands get finer than about a
// pixel (the knot at an angular centre), then the falloff curve.
float gr_value(float t, float w, int rep) {
  float v;
  if (rep == 1) v = u_aa ? gr_fractAA(t, w) : fract(t);
  else if (rep == 2) v = u_aa ? gr_triAA(t, w) : gr_tri(t);
  else v = clamp(t, 0.0, 1.0);
  if (u_aa && rep != 0) v = mix(v, 0.5, smoothstep(0.75, 2.0, w));
  return profileCurve(u_falloff + 1, v);
}

// Band width jitter: boundary k of the ramps sits at k + δ(k), |δ| < 0.45 × jitter (wrapped with the band count, so
// the bands still tile). Returns t in the jittered bands (the band index + the fraction across it) and scales w (the
// AA width) by the band's stretch.
float gr_bd(float k, int bands) {
  int kk = int(k);
  if (bands > 0) kk = imod(kk, bands);
  return (hashI(ivec2(kk, 1), uSeed + 5.0) - 0.5) * 0.9 * u_band_jit;
}
float gr_jit(float t, int bands, inout float w) {
  if (u_band_jit <= 0.0) return t;
  float i = floor(t);
  float b0 = i + gr_bd(i, bands), b1 = i + 1.0 + gr_bd(i + 1.0, bands);
  float k = t < b0 ? i - 1.0 : t >= b1 ? i + 1.0 : i;
  float lo = t < b0 ? i - 1.0 + gr_bd(i - 1.0, bands) : t >= b1 ? b1 : b0;
  float hi = t < b0 ? b0 : t >= b1 ? i + 2.0 + gr_bd(i + 2.0, bands) : b1;
  float wd = max(hi - lo, 1e-4);
  w /= wd;
  return k + (t - lo) / wd;
}

GenOut gen(vec2 p) {
  vec2 c = userPx(vec2(u_cx, u_cy));
  vec2 d = p - c;
  // Radial-type gradients use the nearest periodic copy of the centre when tiling (seamless), unless Single.
  bool wrap = uTile && u_wrap == 0;
  if (wrap && u_style != 0) d = wrapDelta(d);
  float st = max(u_stretch, 1e-3);
  // An angular sweep has no clamp: past 1 it repeats (one sweep: the same either way).
  int rep = u_style == 2 && u_repeat == 0 ? 1 : u_repeat;
  float t, v, w;   // the ramp position, its value, its AA width (rate per pixel)
  int bands = 0;   // bands per tile (> 0: the band index wraps, so per-band randoms tile too)
  if (u_style == 0) {
    vec2 q = unrotCW(d, u_angle);   // x along the gradient direction
    float a = radians(u_angle);
    float span = abs(uRes.x * cos(a)) + abs(uRes.y * sin(a));
    float L = u_length > 0.0 ? u_length : span;
    if (u_fit && uTile && u_repeat != 0) {
      // Whole periods across the tile on both axes: the frequency snapped per axis (the angle moves a little).
      float P = u_repeat == 2 ? 2.0 * L : L;
      vec2 dir = rotCW(vec2(1.0, 0.0), u_angle);
      vec2 cyc = floor(dir * uRes / P + 0.5);
      if (cyc.x == 0.0 && cyc.y == 0.0) {
        if (abs(dir.x) * uRes.x >= abs(dir.y) * uRes.y) cyc.x = dir.x < 0.0 ? -1.0 : 1.0; else cyc.y = dir.y < 0.0 ? -1.0 : 1.0;
      }
      int rpp = u_repeat == 2 ? 2 : 1;   // ramps per period
      t = 0.5 + dot(d, cyc / uRes) * float(rpp);
      bands = rpp * gr_gcd(int(abs(cyc.x)), int(abs(cyc.y)));
    } else {
      t = 0.5 + q.x / L;
      float nb = span / L;
      if (uTile && abs(nb - floor(nb + 0.5)) < 1e-3) bands = int(floor(nb + 0.5));
    }
    t += u_shift;
    w = gr_w(t);
  } else {
    float R = 1.0;
    if (u_style != 2) {
      R = u_length;
      if (R <= 0.0) {
        // Farthest corner (of the texture, or of the wrap cell when tiling).
        vec2 lo = wrap ? -0.5 * uRes : -c;
        vec2 hi = wrap ? 0.5 * uRes : uRes - c;
        R = 0.0;
        for (int i = 0; i < 4; i++) {
          vec2 k = vec2(i == 0 || i == 2 ? lo.x : hi.x, i < 2 ? lo.y : hi.y);
          vec2 kq = unrotCW(k, u_angle);
          R = max(R, gr_metric(vec2(kq.x / st, kq.y)));
        }
      } else if (u_fit && wrap && u_repeat != 0) {
        // A whole number of bands from the centre to the tile's edge, where the copies meet: no fold mid-slope.
        vec2 hq = unrotCW(vec2(0.5 * uRes.x, 0.0), u_angle);
        float hw = gr_metric(vec2(hq.x / st, hq.y));
        R = hw / max(floor(hw / R + 0.5), 1.0);
      }
      R = max(R, 1e-3);
    }
    if (u_style == 2) bands = u_turns;
    // Tiling: the copies of the centre among the 5 × 5 round it, each weighted by how near it is — by the rings' own
    // metric (turned, stretched; the per-axis nearest copy only matches it for upright round, diamond and square
    // rings) or, for an angular sweep, by plain distance — e^(-(m - m_min) / τ), τ = Seam rounding / 4 (0: the
    // nearest copy only). Repeating ramps blend their phase (the unit vector of the angle 2π t / period), so the bands
    // and rays bend from one copy's into the next and stay sharp — no smear, no lobes; a clamped ramp blends t (a
    // rounded ridge where the copies meet). The weights depend on the distances only, so they are continuous
    // everywhere: no notch where the nearest copy changes.
    // A tiling angular sweep (unstretched, tiles up to 3:1): the angle of a ratio of Jacobi thetas with a zero at the
    // centre and a pole at the tile's corner — exactly doubly periodic, so the rays bend smoothly across the whole tile
    // and meet themselves at its edges, gathering again at one counter-whirl at the corners. Otherwise (stretched, or
    // a long tile): the nearest copy of the centre.
    float T = max(uRes.x, uRes.y) / min(uRes.x, uRes.y);
    if (u_style == 2 && wrap && abs(st - 1.0) < 1e-3 && T <= 3.0) {
      // z in units of the shorter side, its real axis along it (the theta series converges fast for Im τ = T ≥ 1).
      bool rot = uRes.x > uRes.y;
      vec2 z = rot ? vec2(d.y, -d.x) / uRes.y : d / uRes.x;
      // The pole at the tile's corner. arg f + π Re z is the phase of the one doubly periodic |f|: it turns by π
      // across a tile either way and keeps the tile's symmetry (rays evenly spread round the centre at every radius)
      // — seamless for an even count of ramps (a multiple of 4 with Mirror, whose period is two ramps). Other
      // counts take -π Im z / T instead: no turn across the tile, so any count tiles, but the rays crowd towards
      // one diagonal. A = the argument offset at the centre (arg f ≈ arg(z - a) - A).
      vec2 bo = vec2(0.5, 0.5 * T);
      float A = gr_thetaArg(-PI * bo, T);
      bool even = rep == 2 ? u_turns % 4 == 0 : u_turns % 2 == 0;
      float ph = gr_thetaArg(PI * z, T) - gr_thetaArg(PI * (z - bo), T) + A + (even ? PI * z.x : -PI * z.y / T) + (rot ? 0.5 * PI : 0.0);
      // Twist: a smooth periodic stand-in for the distance to the centre (|d| near it).
      vec2 sn = uRes / PI * sin(PI * d / uRes);
      t = fract(-(ph + radians(u_angle)) / TAU + u_twist * length(sn) / (0.5 * uRes.x)) * float(u_turns) + u_shift;
      // The AA width from the phase's own rate (the centre's and the corner whirl's 1 / (2π r)) rather than from
      // quad derivatives, which zigzag pixel to pixel along the rays.
      float dcn = length(wrapDelta(d - 0.5 * uRes));
      w = float(u_turns) * ((1.0 / max(length(d), 0.5) + 1.0 / max(dcn, 0.5)) / TAU + abs(u_twist) / (0.5 * uRes.x));
    } else {
    float per = rep == 2 ? 2.0 : 1.0;
    float tau = 0.25 * u_seam;
    bool blend = wrap && tau > 0.0 && u_style != 2;
    float m1 = 1e20, t1 = 0.0, wsum = 0.0, tsum = 0.0;
    vec2 acc = vec2(0.0);
    for (int e = 0; e < (wrap ? 25 : 1) * GR_1; e++) {
      vec2 de = wrap ? d + vec2(float(e % 5 - 2), float(e / 5 - 2)) * uRes : d;
      vec2 kq = unrotCW(de, u_angle);
      float me = u_style == 2 ? length(de) : gr_metric(vec2(kq.x / st, kq.y));
      float te = gr_t(de, R, st) + u_shift;
      if (me < m1) {
        // A new nearest copy: rescale what's summed to its weight (running minimum).
        float k = blend ? exp((me - m1) / tau) : 0.0;
        acc *= k; wsum *= k; tsum *= k;
        m1 = me; t1 = te;
      }
      float we = blend ? exp((m1 - me) / tau) : (me == m1 ? 1.0 : 0.0);
      float ph = TAU * te / per;
      acc += we * vec2(cos(ph), sin(ph));
      wsum += we;
      tsum += we * te;
    }
    if (!blend) {
      t = t1;
      // An unstretched angular sweep: the AA width from its own rate, 1 / (2π r) per px (+ the twist's), rather than
      // from quad derivatives (which zigzag pixel to pixel along the rays).
      w = u_style == 2 && abs(st - 1.0) < 1e-3 ? float(u_turns) * (1.0 / (TAU * max(m1, 0.5)) + abs(u_twist) / (0.5 * uRes.x)) : gr_w(t);
    } else if (rep == 0) {
      t = tsum / max(wsum, 1e-20);
      w = gr_w(t);
    } else {
      // The blended phase, unwrapped next to the nearest copy's t; its rate per pixel from the unit vector's (|du| =
      // |dφ|), which has no jump where the nearest copy changes.
      vec2 u = acc / max(length(acc), 1e-20);
      float dp = atan(u.y, u.x) - TAU * t1 / per;
      dp -= TAU * floor(dp / TAU + 0.5);
      t = t1 + per * dp / TAU;
      w = per / TAU * (length(dFdx(u)) + length(dFdy(u)));
    }
    }
  }
  // One call site each (D3D inlines every call): the band width jitter, then the value.
  if (rep != 0) t = gr_jit(t, bands, w);
  v = gr_value(t, w, rep);
  // Per-band random (each repeat of the ramp).
  int band = int(floor(t));
  if (bands > 0) band = imod(band, bands);
  float rnd = hashI(ivec2(band, 0), uSeed);
  return genOut(v, 1.0, rnd, 0.0);
}
`,
}

// ------------------------------------------------------------------------------------------------ scratches

/** Whether a scratches layer's density gets near its per-cell limit (the shader's cells are about a reach wide). */
const nearCap = (p: Record<string, unknown>): boolean => {
  const lmax = Math.max(Number(p.len_max), Number(p.len_min))
  const reach = 0.5 * lmax * (1 + 0.25 * Number(p.bend ?? 0)) + 0.5 * Number(p.thickness) + 1
  return (Number(p.density) * reach * reach * (1 + Number(p.clump ?? 0))) / 4096 > 0.5 * Number(p.cap ?? 64)
}

export const scratchesLayer: LayerDef = {
  type: 'scratches',
  label: 'Scratches',
  category: 'pattern',
  kind: 'generator',
  description: 'Random scratches and gouges — metal wear, scuffs, scored stone: tapered, broken up, wobbly or swept, in clumps, V- or U-cut with a raised burr. Coverage masks the outputs; the outline can go to the Shape Mask.',
  params: [
    P.float('density', 'Density', 24, 0, 1024, { softMax: 256, step: 0.1, perArea: true, section: 'Layout', hint: 'Scratches per 64×64 px (long, dense ones saturate at the Density limit). Brushed metal: 150+ with Density limit 256, 100–400 px long, under 0.6 px wide with Shallow hairlines, Angle jitter 1–3°, Clumping 0, Breakup under 0.2, a low Height amount' }),
    P.int('cap', 'Density limit', 64, 1, 256, {
      section: 'Layout',
      showIf: nearCap,
      hint: 'Most scratches in one cell (a square about a scratch long): long, dense scratches — brushing — stop getting denser past it. Up to 256 for dense brushing (slower to render)',
    }),
    P.float('angle', 'Angle', 30, -360, 360, { softMin: -180, softMax: 180, unit: '°', step: 0.1, section: 'Layout', hint: 'Clockwise from horizontal' }),
    P.int('dirs', 'Directions', 2, 1, 4, { section: 'Layout', hint: 'Headings the scratches take, spread over 180° from Angle (each with Angle jitter): 2 = cross-hatched, 3 = wear from three ways' }),
    P.float('dir_bal', 'Direction balance', 0.45, 0, 1, { step: 0.001, section: 'Layout', showIf: (p) => Number(p.dirs) > 1, hint: 'The first heading’s share of the scratches: 0 = all headings alike, 1 = only the first' }),
    P.float('dir_spread', 'Direction spread', 30, 0, 90, { unit: '°', step: 0.1, section: 'Layout', showIf: (p) => Number(p.dirs) > 1, hint: 'Turns each further heading off the even spread by a random angle up to this: irregular crossings instead of a regular hatch' }),
    P.float('angle_jitter', 'Angle jitter', 25, 0, 180, { unit: '°', step: 0.1, section: 'Layout', hint: '180 = any direction' }),
    P.float('clump', 'Clumping', 0.75, 0, 1, { step: 0.001, section: 'Layout', hint: 'Gathers the scratches into worn patches with bare areas between (the same count overall): 0 = evenly spread' }),
    P.float('clump_scale', 'Clump scale', 3, 0.25, 64, { softMax: 16, step: 0.01, section: 'Layout', showIf: (p) => Number(p.clump) > 0 || Number(p.bend_coh) > 0, hint: 'Patches (and Swirl’s circles) across the texture (rounded when tiling)' }),
    P.float('len_min', 'Min length', 5, 0, 2048, { softMax: 128, unit: 'px', step: 0.5, section: 'Shape' }),
    P.float('len_max', 'Max length', 30, 0, 2048, { softMax: 256, unit: 'px', step: 0.5, section: 'Shape' }),
    P.float('len_bias', 'Length bias', 0.5, 0, 1, { step: 0.001, section: 'Shape', hint: 'Favours short scratches: 0 = lengths spread evenly from min to max, 1 = mostly short with a few long ones' }),
    P.float('thickness', 'Thickness', 1, 0, 64, { softMax: 8, unit: 'px', step: 0.05, section: 'Shape', hint: 'Width of the widest scratches' }),
    P.float('th_len', 'Width by length', 0.8, 0, 1, { step: 0.001, section: 'Shape', hint: 'Ties width to length: short scratches thin, the long ones up to full Thickness, none wider than an eighth of its length (no rice grains)' }),
    P.float('th_var', 'Thickness jitter', 0.6, 0, 1, { step: 0.001, section: 'Shape', hint: 'Each scratch its own width: 1 = anywhere from a faint hairline to full Thickness, most of them fine. The weaker scratches (Strength jitter) are the thinner ones' }),
    P.float('fade', 'Strength jitter', 0.6, 0, 1, { step: 0.001, section: 'Shape', hint: 'Random strength per scratch (the value): some faint, some deep' }),
    P.float('taper', 'Taper', 0.8, 0, 1, { step: 0.001, section: 'Shape', hint: 'Thin the ends of each scratch' }),
    P.float('taper_len', 'Taper length', 0.35, 0.02, 1, { step: 0.001, section: 'Shape', showIf: (p) => Number(p.taper) > 0, hint: 'How much of each half narrows: 1 = the whole scratch (a spindle, widest in the middle), 0.2 = only the last fifth at each end (a gouge)' }),
    P.float('blunt', 'Blunt start', 0.5, 0, 1, { step: 0.001, section: 'Shape', showIf: (p) => Number(p.taper) > 0, hint: 'Less taper where each scratch starts (the end the Angle points from): a blunt entry and a sharp exit, like a tool dragged across' }),
    P.float('bend_bias', 'Bend bias', 0, 0, 1, { step: 0.001, section: 'Shape', showIf: (p) => Number(p.bend) > 0, hint: 'Leans the bends one way: 0 = each scratch bows to a random side, 1 = all bow the same way (a sweeping hand)' }),
    P.float('bend', 'Bend', 0, 0, 2, { softMax: 1, step: 0.001, section: 'Shape', hint: 'Curves the scratches into arcs, the long ones most (one curvature for all: at 1 the longest bow a quarter of their length). With Swirl, how closely they follow its circles' }),
    P.float('bend_coh', 'Swirl', 0, 0, 1, { step: 0.001, section: 'Shape', hint: 'Lines the scratches up along circles round a few centres (one per Clump scale cell), as wiping and polishing leave: their direction follows the circles, and Bend curves them round the centre. 0 = Angle and Angle jitter only' }),
    P.float('wobble', 'Wobble', 0.35, 0, 64, { softMax: 8, unit: 'px', step: 0.01, section: 'Shape', hint: 'Lateral waver along each scratch (a few waves per scratch: S-curves, chatter); cuts wider than 2 px waver more, by half their width' }),
    P.float('breakup', 'Breakup', 0.5, 0, 1, { step: 0.001, section: 'Shape', hint: 'Varies each scratch along its length — deeper and shallower, wider and narrower — and breaks it into pieces: 0 = even capsules, 1 = broken, skipping strokes' }),
    P.float('groove', 'Groove shape', 0.8, 0, 2, { softMax: 1, step: 0.001, section: 'Relief', hint: 'Cross-section of the cut, in Height: 0 = flat-bottomed, 0.5 = rounded U, 1 = V, 2 = needle-sharp. Scratches under 2 px wide stay flat' }),
    P.float('burr', 'Burr', 0.3, 0, 2, { softMax: 1, step: 0.001, section: 'Relief', hint: 'A raised lip of pushed-up material beside the cut, as high as this share of the depth — uneven between the sides, broken, none where the scratch starts, rising towards its end, wiped out where another cut crosses, faint on hairlines (none under half a pixel wide; Height › Pattern, Height then skips Shaping’s value controls)' }),
    P.float('heap', 'Exit heap', 0.5, 0, 2, { softMax: 1, step: 0.001, section: 'Relief', hint: 'The material pushed out ahead of each scratch’s end: a crescent round the tip, its size varying per scratch (some none), bigger for the strong, wide cuts (Height › Pattern, like Burr)' }),
    P.float('burr_width', 'Burr width', 1, 0.25, 32, { softMax: 6, unit: 'px', step: 0.05, section: 'Relief', showIf: (p) => Number(p.burr) > 0 || Number(p.heap) > 0, hint: 'How far the lip (and the exit heap, past the cut’s own width) spreads from the edge of the cut' }),
    P.bool('fine', 'Shallow hairlines', true, { section: 'Relief', hint: 'Scratches under a pixel wide cut as much shallower in Height and cover as much less (their area), so fine brushing reads as a sheen, not per-pixel trenches, and thin ends fade out (off: every scratch its full depth and a pixel of coverage)' }),
    P.float('mask_min', 'Mask strength', 0, 0, 1, {
      step: 0.001,
      group: 'mask',
      section: 'Write to',
      showIf: (p) => String(p.mk_target ?? '').trim() !== '',
      hint: 'Only scratches at least this strong (Strength jitter) go to the mask: faint scuffs left out of what later layers are limited to (rust in the deep cuts only)',
    }),
    P.bool('hard', 'Hard edges', false, { hint: 'No anti-aliasing (pixel art)' }),
    P.seed(),
  ],
  // The scratches' outline (a signed distance to the nearest one) goes to a mask when given one: later layers are limited
  // to the scratches (rust in them) or, in Subtract mode, to what's around them (paint that skips them).
  sdf: 'mask',
  // Added in the editor: lengths, density and widths sized to the texture (the plain defaults suit about 128 px).
  fresh: ({ width, height }) => {
    const k = Math.max(1, Math.min(width, height) / 128)
    const r1 = (v: number) => Math.round(v * 10) / 10
    return {
      density: r1(24 / k), len_min: r1(5 * k), len_max: r1(30 * k), thickness: r1(Math.min(3, Math.sqrt(k))),
      wobble: r1(0.35 * Math.sqrt(k)), burr_width: r1(Math.max(1, 0.75 * Math.sqrt(k))),
    }
  },
  defaults: {
    mk_target: '',
    dif_on: true,
    dif_opacity: 0.8,
    dif_grad: gradient('#8f8a82', '#d9d4cb'),
    h_on: true,
    h_mode: 'subtract',
    h_amount: 0.2,
  },
  glsl: /* glsl */ `
// 1, read from a uniform: a loop bound written with it can't be unrolled, so D3D keeps one copy of the body.
#define SC_1 (uRes.x > 0.0 ? 1 : 0)

// Smooth 1D value noise (0..1, cells of 1) along a scratch.
float sc_noise1(float x, float seed) {
  float i = floor(x), f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash1(i, seed), hash1(i + 1.0, seed), f);
}

GenOut gen(vec2 p) {
  float lmax = max(u_len_max, u_len_min);
  float bendMax = 0.25 * u_bend;   // the most curved scratch's sagitta, as a share of its length
  // Cells at least one scratch reach wide, so only the 3x3 neighbourhood can touch this pixel.
  float reach = 0.5 * lmax + 0.5 * u_thickness + 1.0 + 0.5 * lmax * max(bendMax, u_bend_coh > 0.0 ? 0.35 * u_bend : 0.0)
              + (u_burr > 0.0 || u_heap > 0.0 ? 2.0 * u_burr_width + 1.2 * u_thickness : 0.0) + u_wobble * max(1.0, 0.5 * u_thickness);
  vec2 n = uTile ? max(floor(uRes / reach), vec2(1.0)) : max(uRes / reach, vec2(1.0));
  vec2 cs = uRes / n;
  // Expected scratches per cell; Clumping draws more and keeps each by the patch noise at its centre.
  float lambda = u_density * cs.x * cs.y / 4096.0 * (1.0 + u_clump);
  int slots = min(int(ceil(lambda)), u_cap);
  vec2 cc = cellsFor(u_clump_scale, 1.0);
  ivec2 cper = uTile ? ivec2(cc) : NO_PERIOD;
  ivec2 ip = ivec2(floor(p / cs));
  float cov = 0.0, val = 0.0, score = 0.0, rnd = 0.0;
  float sd = 1e4;          // signed distance to the nearest scratch (px, < 0 inside)
  float hv = 0.0;          // deepest groove here (× coverage)
  float lip = 0.0;         // highest burr here
  // One flat loop over the 3x3 cells (one copy of the body), each with its slots.
  for (int e = 0; e < 9 * SC_1; e++) {
    ivec2 c = ip + ivec2(e % 3 - 1, e / 3 - 1);
    ivec2 cw = uTile ? imod(c, ivec2(n)) : c;
    for (int s = 0; s < slots; s++) {
      float fs = float(s);
      vec3 h = hash3I(cw, uSeed + fs * 7.0);
      vec3 g = hash3I(cw, uSeed + fs * 7.0 + 3.0);
      vec3 k3 = hash3I(cw, uSeed + fs * 7.0 + 5.0);
      // The fractional last slot, and Clumping's thinning. No 'continue': in this loop D3D11 (ANGLE) miscompiles one
      // that some pixels take and their neighbours don't — scratches came out thinned and cut off at cell borders.
      bool skip = fs + 1.0 > lambda && g.z > lambda - fs;
      vec2 pc = (vec2(cw) + h.xy) * cs / uRes * cc;   // the scratch's centre in the patch field
      if (u_clump > 0.0) {
        float pn = 0.0;
        for (int o = 0; o < 2 * SC_1; o++) pn += (o == 0 ? 0.6 : 0.4) * perlinNoise(pc * float(1 + o), cper * (1 + o), uSeed + 61.0 + 6.0 * float(o));
        float m = mix(1.0, 2.0 * smoothstep(0.3, 0.7, pn), u_clump);
        skip = skip || k3.y * (1.0 + u_clump) > m;
      }
      if (!skip) {
        vec3 k4 = hash3I(cw, uSeed + fs * 7.0 + 1.0);
        vec2 ctr = (vec2(c) + h.xy) * cs;
        float len = mix(u_len_min, lmax, u_len_bias > 0.0 ? pow(h.z, 1.0 + 3.0 * u_len_bias) : h.z);
        // Directions: each scratch takes one of 1–4 headings spread over 180° (cross-hatched wear) — the first
        // taking Direction balance more of them, the others each turned off the even spread by up to Direction spread.
        float head = 0.0;
        if (u_dirs > 1) {
          float nd = float(u_dirs);
          float s0 = mix(1.0 / nd, 1.0, u_dir_bal);
          float hi = k3.z < s0 ? 0.0 : 1.0 + min(floor((k3.z - s0) / max(1.0 - s0, 1e-4) * (nd - 1.0)), nd - 2.0);
          head = hi * 180.0 / nd + (hi > 0.0 ? (hashI(ivec2(int(hi), 9), uSeed) - 0.5) * 2.0 * u_dir_spread : 0.0);
        }
        vec2 dir = rotCW(vec2(1.0, 0.0), u_angle + head + (g.x - 0.5) * 2.0 * u_angle_jitter);
        // Bend: a random arc whose sagitta grows with the square of the length (one curvature: long scratches bend,
        // short ones stay nearly straight). Swirl: the scratches follow circles round a centre per Clump scale cell —
        // their direction the circle's tangent, their arc concentric with it (× Bend) — as wiping and polishing leave.
        vec3 k5 = hash3I(cw, uSeed + fs * 7.0 + 2.0);
        // Bend: random size per scratch, its side random too unless Bend bias leans them all one way.
        float S = bendMax * len * (len / max(lmax, 1e-3)) * abs(2.0 * k3.x - 1.0) * (k5.y < 0.5 + 0.5 * u_bend_bias ? 1.0 : -1.0);
        if (u_bend_coh > 0.0) {
          // Each scratch circles its own centre — the cell's swirl centre moved by up to 0.3 × its distance, so the
          // arcs overlap in loops instead of nesting in a bullseye — drifting off the circle by up to ±12° (spiralling
          // in or out). Within a minimum radius of the centre the scratches keep their own direction: no tight hooks.
          vec2 sc = floor(pc);
          vec2 sw = (sc + 0.5 + (hash2I(imod(ivec2(sc), cper), uSeed + 73.0) - 0.5) * 0.8) / cc * uRes;
          vec2 rv0 = wrapDelta(ctr - sw);
          vec2 rv = rv0 - (k5.xy - 0.5) * 0.6 * length(rv0);
          float rmin = 0.12 * min(uRes.x / cc.x, uRes.y / cc.y);
          float rho = max(length(rv), rmin);
          // An arc stops at three quarters of its circle: no compass-drawn rings.
          len = mix(len, min(len, 4.7 * rho), u_bend_coh);
          vec2 tg = rot2((k5.z - 0.5) * 0.42) * vec2(-rv.y, rv.x) / max(length(rv), 1e-3);
          if (dot(tg, dir) < 0.0) tg = -tg;
          float coh = u_bend_coh * smoothstep(0.5 * rmin, rmin, length(rv));
          dir = normalize(mix(dir, tg, coh) + 1e-6);
          vec2 nr = vec2(-dir.y, dir.x);
          float Sf = sign(dot(nr, rv)) * min(len * len / (8.0 * rho), 0.35 * len) * u_bend;
          S = mix(S, Sf, coh);
        }
        float wgt = 1.0 - g.y;   // the scratch's weight: 1 = the strongest
        // Width: jittered by weight, and (Width by length) narrower for the shorter scratches, never wider than an
        // eighth of the length — no rice grains.
        float thw = u_thickness * mix(1.0, 0.08 + 0.92 * wgt * wgt, u_th_var);
        if (u_th_len > 0.0) thw *= mix(1.0, min(pow(clamp(len / max(lmax, 1e-3), 0.0, 1.0), 0.7), len / (8.0 * max(thw, 1e-3))), u_th_len);
        vec2 nrm = vec2(-dir.y, dir.x);
        // In the scratch's frame: x along it (0 at its middle), y across. Bent: y = S (1/2 - 4 x² / L²), an arc of
        // sagitta S through the middle, the distance taken across it (divided by its slope's secant); Wobble adds a
        // smooth waver to y.
        vec2 r = p - ctr;
        float L = max(len, 1e-3);
        float x = dot(r, dir);
        float xc = clamp(x, -0.5 * len, 0.5 * len);
        float t = xc / L + 0.5;   // 0 at the start, 1 at the end
        float slope = -8.0 * S * xc / (L * L);
        float yc = S * (0.5 - 4.0 * xc * xc / (L * L));
        float nseed = floor(k4.y * 65536.0);
        // Wobble, in px — wider cuts waver more (× half their width past 2 px), but never more than 3 % of the length,
        // in one to three waves along it: no worms.
        if (u_wobble > 0.0) {
          float wa = min(u_wobble * max(1.0, 0.5 * thw), max(0.03 * len, 0.25 * u_wobble));
          yc += wa * (2.0 * sc_noise1(xc / max(0.35 * len, 4.0) + 7.0 * k4.z, nseed) - 1.0);
        }
        float dy = dot(r, nrm) - yc;
        float dist = sqrt((x - xc) * (x - xc) + dy * dy / (1.0 + slope * slope));
        // Taper over the last Taper length of each half (all of it: a spindle, widest in the middle), less at a blunt start.
        float u = abs(2.0 * t - 1.0);
        float tl = max(u_taper_len, 1e-3);
        float sx = clamp((u - (1.0 - tl)) / tl, 0.0, 1.0);
        float tap = t < 0.5 ? u_taper * (1.0 - u_blunt) : u_taper;
        float th = thw * mix(1.0, sqrt(max(0.0, 1.0 - sx * sx)), tap);
        // Breakup: a noise along the scratch varies its depth and width and opens gaps; the burr is broken by it too.
        // (its waves at least half the scratch long under ~25 px: a short stroke swells once at most, no peanuts)
        float nb = u_breakup > 0.0 || u_burr > 0.0 ? sc_noise1(xc / max(0.15 * len, min(0.5 * len, 12.0)) + 13.0 * k4.z, nseed + 1.0) : 1.0;
        float f = 1.0;
        if (u_breakup > 0.0) f = mix(1.0, smoothstep(0.6 * u_breakup - 0.2, 0.6 * u_breakup + 0.2, nb) * (0.4 + 0.6 * nb), u_breakup);
        th *= sqrt(f);
        float gap = u_breakup > 0.0 ? (u_hard ? step(0.1, f) : smoothstep(0.0, 0.2, f)) : 1.0;
        float rad = u_hard ? max(0.5 * th, 0.5) : 0.5 * th;
        // Coverage: anti-aliased over a pixel; Shallow hairlines: a cut under a pixel wide covers as much less (its
        // area), so thin lines and their tapered ends fade out instead of ending in dashes.
        float cv = u_hard ? (dist <= rad ? 1.0 : 0.0) : (u_fine && th < 1.0 ? th * clamp(1.0 - dist, 0.0, 1.0) : clamp(rad + 0.5 - dist, 0.0, 1.0));
        cv *= gap;
        float st0 = 1.0 - g.y * u_fade;
        float st = st0 * f;
        if (cv * st > score) { score = cv * st; val = st; rnd = h.x; }
        cov = max(cov, cv);
        if (st0 >= u_mask_min) sd = min(sd, dist - rad + (1.0 - gap));
        // Relief: the groove's cross-section (flat for scratches under ~2 px), and the burr beside the cut.
        float gk = u_groove > 0.0 ? clamp(th - 1.0, 0.0, 1.0) : 0.0;
        float gp = 1.0 - gk * pow(clamp(dist / max(0.5 * th, 1e-3), 0.0, 1.0), 1.0 / max(u_groove, 1e-3));
        // Shallow hairlines: a cut under a pixel wide is as much shallower (its depth spread over the pixel).
        hv = max(hv, cv * st * gp * (u_fine ? min(1.0, th) : 1.0));
        if (u_burr > 0.0) {
          float bx = (dist - rad) / u_burr_width;
          float bb = bx > 0.0 && bx < 1.0 ? sin(3.14159265 * bx) : 0.0;
          // Along the sides: uneven (a share per side, per scratch), broken, none at the start, rising towards the end,
          // none round the caps.
          float side = dy > 0.0 ? k4.x : 1.0 - k4.x;
          float along = (0.3 + 0.7 * nb) * smoothstep(0.0, 0.3, t) * (0.6 + 0.8 * t) * (1.0 - smoothstep(0.0, 0.5 * u_burr_width, abs(x - xc)));
          lip = max(lip, u_burr * st * clamp((thw - 0.5) / 1.5, 0.0, 1.0) * bb * bb * (0.4 + 1.2 * side) * along);
        }
        if (u_heap > 0.0 && x > 0.5 * len) {
          // Exit heap: the material pushed out ahead of the end — a crescent round the cap, as big as the cut is
          // strong and wide, its own size per scratch (some none).
          // Centred a little behind the tip, past the cut's full width, so it bows round the end as a ridge rather
          // than a knob on the (tapered) point.
          vec2 re = vec2(x - 0.5 * len + 0.5 * thw, dy);
          float de = length(re);
          float hw = 0.5 * thw + u_burr_width;
          float hx = clamp((de - 0.5 * thw) / hw, 0.0, 1.0);
          float fwd = smoothstep(0.2, 0.9, re.x / max(de, 1e-3));
          float sz = smoothstep(0.2, 1.0, k5.x) * (0.4 + 0.8 * k5.y);
          float hb = sin(3.14159265 * hx);
          lip = max(lip, 0.6 * u_heap * st * min(1.0, thw) * sz * hb * hb * fwd);
        }
      }
    }
  }
  // Hard edges: snap the distance off ±0.5, so the shape-mask coverage is as hard as the scratches.
  if (u_hard) sd = sd <= 0.0 ? min(sd, -0.5) : max(sd, 0.5);
  // Height reads the deepest groove (hval, shaped like the value); with a burr or heap, a signed profile of its own: the
  // cut down, the lip up (Height's default Subtract mode sinks the first and raises the second) — no lip inside another
  // scratch's cut.
  float hval = cov > 0.0 ? clamp(hv / cov, 0.0, 1.0) : 0.0;
  float height = u_burr > 0.0 || u_heap > 0.0 ? hv - lip * (1.0 - cov) : NO_SDF;
  return GenOut(val, cov, rnd, sd, 1.0, height, 0, hval, NO_SDF, rnd);
}
`,
}
