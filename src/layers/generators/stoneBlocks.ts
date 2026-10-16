// Stone blocks: a wall of dressed, rock-faced stones (docs/features/fr8.22-stone-blocks.md). Courses of varying height
// hold blocks of varying length; a block may be split again, guillotine-wise, into stacked slabs and short pieces
// (random and broken ashlar). Each piece has its own height (a few set back), a slight tilt, a pitched margin falling to
// the joint, and a face knocked about by conchoidal flake scars: shallow bowls at two sizes whose rims meet in crisp
// ridges, between flat patches of the original face. Joints are thin; here and there one opens into a dark gap at a
// corner. Joints, gaps and scars are outputs of their own, for paint; the relief puts the stones in the Shape Mask.

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { ORG_GLSL, ORG_GLSL_SDF, ORG_NO_SDF } from './organicShared'

export const stoneBlocksLayer: LayerDef = {
  type: 'stone_blocks',
  label: 'Stone blocks',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  // Only the relief has a shape (the masks return no distance).
  sdfShowIf: (p) => p.output === 'relief',
  description: 'A wall of rock-faced stone blocks: courses of varying height, blocks of varying length split into slabs and smaller pieces, faces chipped into flake scars, thin joints that open into gaps here and there — plus masks of the joints and the scars to paint.',
  params: [
    P.enum('output', 'Output', 'relief', [
      ['relief', 'Relief', 'the wall: the faces with their scars, margins and joints, as a height (and a colour by height)'],
      ['joints', 'Joints', '1 in the joints and open gaps, fading over the Joint reach onto the faces: dirt, damp and moss along the joints'],
      ['scars', 'Scars', 'how deep the flake scars cut into each face (0 on the untouched face): paint the fresh, paler breaks or the shaded hollows'],
      ['gaps', 'Gaps', '1 in the open gaps only: paint them dark, damp or mossy apart from the joints'],
    ], { hint: 'Every output comes from the same wall (same settings, same seed). Relief puts the stones in the Shape Mask; the masks don’t, so Write to mask records what they paint' }),
    P.float('course', 'Course height', 40, 4, 512, { softMax: 128, unit: 'px', step: 0.1, hint: 'Height of a course before any splits (whole courses down the texture when tiling)' }),
    P.float('row_var', 'Course variation', 0.4, 0, 1, { step: 0.001, hint: 'How much the courses differ in height' }),
    P.float('length', 'Block length', 3.2, 0.5, 8, { softMax: 5, step: 0.01, hint: 'Block length ÷ course height, before splits' }),
    P.float('len_var', 'Length variation', 0.7, 0, 1, { step: 0.001, hint: 'Spread of block lengths, within a course and from course to course' }),
    P.float('bond', 'Bond', 0, 0, 1, { step: 0.001, hint: '0: each course starts at a random place; 1: every other course shifts half a block (a running bond)' }),
    P.float('tall', 'Through stones', 0.25, 0, 1, { step: 0.001, hint: 'Chance that a block runs on through the course above it: tall stones that break the course lines' }),
    P.float('split', 'Splits', 0.4, 0, 1, { step: 0.001, hint: 'Chance that a block (and then each of its parts) is split again: stacked slabs and short pieces among whole blocks — random ashlar' }),
    P.int('levels', 'Split levels', 2, 0, 3, { hint: 'How many times a block may be split' }),
    P.float('slabs', 'Slabs', 0.6, 0, 1, { step: 0.001, showIf: (p) => Number(p.levels) > 0, hint: 'Share of the splits that run along the course (thin slabs stacked in it) rather than across it (short pieces)' }),
    P.float('min_size', 'Smallest piece', 16, 2, 256, { softMax: 48, unit: 'px', step: 0.1, showIf: (p) => Number(p.levels) > 0, hint: 'No split leaves a piece thinner than this' }),
    P.float('gap', 'Joint width', 1, 0, 32, { softMax: 6, unit: 'px', step: 0.05, hint: 'Width of the joints between stones (whole px stay crisp)' }),
    P.float('joint_var', 'Joint variation', 0, 0, 1, { step: 0.001, hint: 'Each stone gets its own share of the joint (width, depth, edge rounding, its step from its neighbours, the Joints mask): 0 = every joint as set, 1 = from fully shut to full width. Shut stones sit flush and share their scars, so two meeting read as one rock with a hairline between; beside an open stone a half joint is left' }),
    P.float('corner', 'Corner rounding', 0.5, 0, 32, { softMax: 6, unit: 'px', step: 0.05 }),
    P.float('jag', 'Jaggedness', 0.8, 0, 8, { softMax: 3, unit: 'px', step: 0.01, hint: 'Raggedness of the stones’ edges' }),

    P.float('heights', 'Height variation', 0.1, 0, 2, { softMax: 1, step: 0.001, section: 'Relief', hint: 'How much the stones differ in height' }),
    P.float('recess', 'Set-back stones', 0.1, 0, 1, { step: 0.001, section: 'Relief', hint: 'Share of the stones set back into the wall' }),
    P.float('recess_depth', 'Set-back depth', 0.5, 0, 2, { softMax: 1, step: 0.001, section: 'Relief', showIf: (p) => Number(p.recess) > 0 }),
    P.float('tilt', 'Tilt', 0.15, 0, 1, { step: 0.001, section: 'Relief', hint: 'Random slope of each face' }),
    P.float('margin', 'Margin width', 6, 0, 64, { softMax: 24, unit: 'px', step: 0.05, section: 'Relief', hint: 'How far in from its edge a face starts to fall to the joint (varies along the edge): the pitched margin of a rock-faced stone' }),
    P.float('pitch', 'Margin drop', 0.8, 0, 2, { softMax: 1, step: 0.001, section: 'Relief', showIf: (p) => Number(p.margin) > 0, hint: 'How far the face falls over the margin, in a rounded shoulder' }),
    P.float('scars', 'Flake scars', 0.95, 0, 1, { step: 0.001, section: 'Relief', hint: 'How much of the face is knocked off in flake scars: shallow bowls whose rims meet in crisp ridges, between flat patches of the original face' }),
    P.float('scar_size', 'Scar size', 68, 2, 512, { softMax: 96, unit: 'px', step: 0.1, section: 'Relief', showIf: (p) => Number(p.scars) > 0, hint: 'Spacing of the big scars (each 0.55–0.95 of it across, stretched up to 1.6×)' }),
    P.float('scar_depth', 'Scar depth', 3.2, 0, 8, { softMax: 4, step: 0.001, section: 'Relief', showIf: (p) => Number(p.scars) > 0, hint: 'How deep the scars cut, in proportion to their size: bigger scars cut deeper, at the same slopes' }),
    P.float('scar_stretch', 'Scar stretch', 1, 0, 1, { step: 0.001, section: 'Relief', showIf: (p) => Number(p.scars) > 0, hint: 'How elongated the scars are along the direction they were struck (up to 2.4×)' }),
    P.float('scar_edge', 'Edge flaking', 0.8, 0, 1, { step: 0.001, section: 'Relief', showIf: (p) => Number(p.scars) > 0, hint: 'Share of the scars struck from the stone’s nearest edge — deep at the edge, running inward, as a mason pitches a rock face — rather than lying any which way' }),
    P.float('scar_detail', 'Small scars', 0.5, 0, 1, { step: 0.001, section: 'Relief', showIf: (p) => Number(p.scars) > 0, hint: 'Strength of a second, finer set of scars (under half the size) chipped into the faces and the big scars' }),
    P.float('rough', 'Roughness', 0.06, 0, 1, { step: 0.001, section: 'Relief', hint: 'Fine grainy unevenness over every face' }),
    P.float('rough_scale', 'Roughness size', 3, 1, 64, { softMax: 16, unit: 'px', step: 0.05, section: 'Relief', showIf: (p) => Number(p.rough) > 0 }),
    P.float('joint_depth', 'Joint depth', 0.3, 0, 2, { softMax: 1, step: 0.001, section: 'Relief', hint: 'How far the joints sink below the faces' }),

    P.float('gaps', 'Open gaps', 0.12, 0, 1, { step: 0.001, section: 'Gaps', hint: 'Share of the stones with a joint opened into a dark gap at one corner, along one or both of its edges' }),
    P.float('gap_w', 'Gap width', 3, 0.5, 32, { softMax: 8, unit: 'px', step: 0.05, section: 'Gaps', showIf: (p) => Number(p.gaps) > 0, hint: 'Widest a gap opens, at its corner, tapering along the edge' }),
    P.float('gap_len', 'Gap length', 0.5, 0.05, 1, { step: 0.001, section: 'Gaps', showIf: (p) => Number(p.gaps) > 0, hint: 'How far along the stone’s edge a gap runs (each 40–100 % of this)' }),

    P.float('reach', 'Joint reach', 3, 0.5, 64, { softMax: 16, unit: 'px', step: 0.05, showIf: (p) => p.output === 'joints', hint: 'How far the joint mask fades out onto the faces' }),
    P.float('patch', 'Patchiness', 0.3, 0, 1, { step: 0.001, showIf: (p) => p.output === 'joints', hint: 'Breaks the joint mask into patches a few stones across: 0 = every joint, 1 = only here and there' }),
    // Not a control: 1 px of the texture in shader px (supersampling scales the px params; joints snap to texture pixels).
    P.float('px_scale', 'Pixel scale', 1, 1, 8, { unit: 'px', step: 1, optimize: false, showIf: () => false }),
    P.enum('rnd_mode', 'Random value', 'piece', [
      ['piece', 'Per stone', 'each stone (after splits) its own value'],
      ['block', 'Per block', 'the pieces split from one block share a value'],
      ['course', 'Per course', 'each course its own value: colour bands along the wall'],
    ], { hint: 'The random value Diffuse › Random and Random jitter read' }),
    P.seed(),
  ],
  defaults: {
    bevel: 0,
    profile: 'round',
    aa: true,
    h_on: true,
    h_amount: 9,
    dif_on: true,
    dif_src: 'random',
    dif_grad: gradient('#a48a68', '#b8a07c', '#c6ae8a'),
  },
  // Added in the editor: courses about a ninth of the texture's mean side; scars, margins, the smallest piece and the
  // relief in proportion.
  fresh: ({ width, height }) => {
    const course = Math.round(Math.min(96, Math.max(8, Math.sqrt(width * height) * 0.11)) * 10) / 10
    const r = (x: number) => Math.round(x * 10) / 10
    return { course, scar_size: r(course * 1.7), margin: r(course * 0.15), min_size: r(Math.max(3, course * 0.4)), h_amount: r(Math.max(2, course * 0.22)) }
  },
  // Relief is the height; joints and scars are masks for paint (their coverage is their value, so a colour lands only on
  // them): dark joints, scars a little paler than the faces.
  linkedDefaults: (p) =>
    p.output === 'joints'
      ? { h_on: false, dif_src: 'value', dif_blend: 'multiply', dif_grad: gradient('#ffffff', '#4a4038') }
      : p.output === 'gaps'
        ? { h_on: false, dif_src: 'value', dif_blend: 'normal', dif_grad: gradient('#1c201c', '#2e3428') }
        : p.output === 'scars'
        ? { h_on: false, dif_src: 'value', dif_blend: 'screen', dif_grad: gradient('#000000', '#3a3428') }
        : { h_on: true, dif_src: 'random', dif_blend: 'normal', dif_grad: gradient('#a48a68', '#b8a07c', '#c6ae8a') },
  glsl:
    ORG_GLSL +
    ORG_GLSL_SDF +
    /* glsl */ `
float sb_px(float x, float s) { return floor(x / s + 0.5) * s; }
float sb_h(uint h, uint k) { return u2f(pcg(h + k * 0x9E3779B9u)); }

// Course j's lower edge (px, snapped to texture pixels); courses repeat every n when tiling.
float sb_rowY(int j, int n, float rh, float pxs) {
  int jw = uTile ? imod(j, n) : j;
  return sb_px((float(j) + 0.8 * u_row_var * (hashI(ivec2(jw, 0), uSeed + 3.0) - 0.5)) * rh, pxs);
}
// Block i's left edge in a course (jw: the course on the torus) of n blocks bw apart, shifted by off blocks.
float sb_colX(int i, int n, int jw, float bw, float off, float pxs) {
  int iw = uTile ? imod(i, n) : i;
  return sb_px((float(i) + off + 0.8 * u_len_var * (hashI(ivec2(iw, jw), uSeed + 7.0) - 0.5)) * bw, pxs);
}
// Course j's blocks: n across (whole blocks when tiling), bw apart, starting off blocks along; jw its key on the torus.
void sb_course(int j, int nR, float rh, out int jw, out int n, out float bw, out float off) {
  jw = uTile ? imod(j, nR) : j;
  vec3 hr = hash3I(ivec2(jw, 1), uSeed + 5.0);
  float bl = max(u_length, 0.2) * rh * (1.0 + 0.6 * u_len_var * (hr.x - 0.5));
  float nB = uTile ? max(1.0, floor(uRes.x / bl + 0.5)) : uRes.x / bl;
  n = int(nB);
  bw = uRes.x / nB;
  off = mix(hr.y, imod(j, 2) == 1 ? 0.5 : 0.0, u_bond);
}
// The block of a course holding x: its index (unwrapped) and edges (jitter under half a block: one step either side).
int sb_find(float x, int n, int jw, float bw, float off, float pxs, out float xa, out float xb) {
  int i = int(floor(x / bw - off));
  xa = sb_colX(i, n, jw, bw, off, pxs);
  xb = sb_colX(i + 1, n, jw, bw, off, pxs);
  if (x < xa) { i--; xb = xa; xa = sb_colX(i, n, jw, bw, off, pxs); }
  else if (x >= xb) { i++; xa = xb; xb = sb_colX(i + 1, n, jw, bw, off, pxs); }
  return i;
}
// Whether block i of course j runs on through the course above: only from even courses (pairs never overlap; with an
// odd number of courses on the torus, the last can't, as the course above it is course 0).
bool sb_tall(int j, int i, int n, int jw, int nR) {
  if (imod(j, 2) != 0 || (uTile && (nR & 1) == 1 && jw == nR - 1)) return false;
  return hashI(ivec2(uTile ? imod(i, n) : i, jw), uSeed + 61.0) < u_tall;
}

GenOut gen(vec2 p) {
  float pxs = max(u_px_scale, 1.0);
  float g = max(u_gap, 0.0);
  // Odd joints: shift half a pixel so both joint edges land on pixel boundaries.
  p -= fract(0.5 * g / pxs) * pxs;

  // Course: rows of nominal height rh, each edge jittered (at most 0.4 rh, so a neighbour test either side suffices).
  float course = max(u_course, 2.0 * pxs);
  float nR = uTile ? max(1.0, floor(uRes.y / course + 0.5)) : uRes.y / course;
  int nRi = int(nR);
  float rh = uRes.y / nR;
  int j = int(floor(p.y / rh));
  float ya = sb_rowY(j, nRi, rh, pxs), yb = sb_rowY(j + 1, nRi, rh, pxs);
  if (p.y < ya) { j--; yb = ya; ya = sb_rowY(j, nRi, rh, pxs); }
  else if (p.y >= yb) { j++; ya = yb; yb = sb_rowY(j + 1, nRi, rh, pxs); }

  int jw, nBi;
  float bw, off, xa, xb;
  sb_course(j, nRi, rh, jw, nBi, bw, off);
  int i = sb_find(p.x, nBi, jw, bw, off, pxs, xa, xb);
  int iw = uTile ? imod(i, nBi) : i;
  uint bid = pcg3(uvec3(uint(iw), uint(jw), uint(uSeed) + 11u));
  int jr = jw;

  // Through stones: a block of an even course may run on through the course above. Above, the pixel belongs to such a
  // block of the course below if one holds its x; otherwise its own block stops short of the nearest ones either side.
  if (u_tall > 0.0) {
    if (sb_tall(j, i, nBi, jw, nRi)) yb = sb_rowY(j + 2, nRi, rh, pxs);
    else {
      int jd, nd;
      float bwd, offd, da, db;
      sb_course(j - 1, nRi, rh, jd, nd, bwd, offd);
      int id = sb_find(p.x, nd, jd, bwd, offd, pxs, da, db);
      if (sb_tall(j - 1, id, nd, jd, nRi)) {
        xa = da; xb = db; ya = sb_rowY(j - 1, nRi, rh, pxs);
        jr = jd;
        bid = pcg3(uvec3(uint(uTile ? imod(id, nd) : id), uint(jd), uint(uSeed) + 11u));
      } else {
        if (sb_tall(j - 1, id - 1, nd, jd, nRi) && da > xa) { xa = da; bid = pcg(bid + 101u); }
        if (sb_tall(j - 1, id + 1, nd, jd, nRi) && db < xb) { xb = db; bid = pcg(bid + 103u); }
      }
    }
  }

  // Splits: halve the piece holding p, guillotine-wise, at 30–70 % of its span — along the course (slabs) or across it.
  vec2 lo = vec2(xa, ya), hi = vec2(xb, yb);
  uint pid = bid;
  float minS = max(u_min_size, 2.0 * pxs);
  bool live = true;
  for (int k = 0; k < 3 * ORG_1; k++) {
    if (k >= u_levels) live = false;
    vec2 sz = hi - lo;
    live = live && sb_h(pid, 1u) < u_split * (1.0 - 0.15 * float(k));
    bool hz = sb_h(pid, 2u) < u_slabs;
    if (sz.y < 2.0 * minS) hz = false;
    if (sz.x < 2.0 * minS) hz = true;
    float L = hz ? sz.y : sz.x;
    live = live && L >= 2.0 * minS;
    if (live) {
      float at = (hz ? lo.y : lo.x) + sb_px(clamp((0.3 + 0.4 * sb_h(pid, 3u)) * L, minS, L - minS), pxs);
      bool up = (hz ? p.y : p.x) >= at;
      if (hz) { if (up) lo.y = at; else hi.y = at; }
      else { if (up) lo.x = at; else hi.x = at; }
      pid = pcg(pid + (up ? 17u : 29u));
    }
  }

  vec2 c = 0.5 * (lo + hi), hs = 0.5 * (hi - lo);
  vec2 q = p - c;
  // This stone's share of the joint: it owns half of every joint round it, so where two shut stones meet the joint
  // closes, beside an open one it narrows to a half joint.
  float js = 1.0 - u_joint_var * sb_h(pid, 19u);
  // Nearly shut stones read as one rock: they share one scar field (no offset of their own, scars not struck from their
  // own edges), so a scar runs on across the hairline where two of them meet.
  bool shut = js < 0.3;
  // Ragged edges: smooth noise about 5 px across.
  vec2 jc = uTile ? max(vec2(1.0), floor(uRes / (5.0 * pxs) + 0.5)) : uRes / (5.0 * pxs);
  float jn = u_jag > 0.0 ? org_noiseFbm(1, false, p / uRes * jc, org_per(jc), 2, 0.5, uSeed + 13.0) - 0.5 : 0.0;
  // The stone, inset by half the joint either side, its corners rounded (negative inside).
  float gs = g * js;
  float rc = clamp(u_corner * js, 0.0, max(min(hs.x, hs.y) - 0.5 * gs, 0.0));
  vec2 qq = abs(q) - (hs - 0.5 * gs - rc);
  float sd = length(max(qq, 0.0)) + min(max(qq.x, qq.y), 0.0) - rc + 2.0 * u_jag * js * jn;

  // ---- relief (0 = the original face)
  // (A shut stone sits flush: its own height, set-back and tilt shrink with its share of the joint, so two shut stones
  // meet level.)
  float v = u_heights * (sb_h(pid, 5u) - 0.5);
  if (sb_h(pid, 6u) < u_recess) v -= u_recess_depth;
  v += u_tilt * dot(vec2(sb_h(pid, 7u), sb_h(pid, 8u)) * 2.0 - 1.0, q / rh);
  v *= js;

  // Pitched margin: a rounded shoulder over a width that wanders along the edge (noise ~3 margins across).
  float din = max(-sd, 0.0);
  if (u_margin > 0.0) {
    vec2 mc = uTile ? max(vec2(1.0), floor(uRes / (3.0 * u_margin) + 0.5)) : uRes / (3.0 * u_margin);
    float mw = u_margin * (0.4 + 1.2 * org_noiseFbm(1, false, p / uRes * mc, org_per(mc), 2, 0.5, uSeed + 17.0));
    float f = clamp(din / max(mw, 0.5), 0.0, 1.0);
    v -= u_pitch * js * (1.0 - sqrt(max(1.0 - (1.0 - f) * (1.0 - f), 0.0)));
  }

  // Flake scars: per scar a hollow below the face, 0 at its rim; the lowest wins, so rims meet in ridges and the face
  // stays flat outside them. Two sizes in one flat loop (16 cells each: the 4 × 4 around p, which holds every scar
  // reaching it — at most 1.45 cells — as sites stay 0.1 cells inside theirs). Each stone reads the field at its own
  // offset, so scars never run on across a joint.
  vec2 so = shut ? vec2(0.0) : vec2(sb_h(pid, 9u), sb_h(pid, 10u)) * uRes;
  float s1 = 0.0, s2 = 0.0;
  if (u_scars > 0.0) {
    // Ragged rims: the field is warped by noise about half a big scar across, by up to ~0.1 of one (in px, both sizes).
    float scs = max(u_scar_size, 2.0 * pxs);
    vec2 wc = uTile ? max(vec2(1.0), floor(2.0 * uRes / scs + 0.5)) : 2.0 * uRes / scs;
    vec2 wq = p / uRes * wc;
    vec2 wp = 0.2 * scs * (vec2(org_noiseFbm(1, false, wq, org_per(wc), 2, 0.5, uSeed + 79.0),
                                org_noiseFbm(1, false, wq, org_per(wc), 2, 0.5, uSeed + 83.0)) - 0.5);
    for (int e = 0; e < 32 * ORG_1; e++) {
      bool fine = e >= 16;
      int k = e & 15;
      float cs = max(u_scar_size, 2.0 * pxs) * (fine ? 0.42 : 1.0);
      vec2 cells = uTile ? max(vec2(1.0), floor(uRes / cs + 0.5)) : uRes / cs;
      vec2 fo = fine ? vec2(0.37, 0.71) * uRes : vec2(0.0);
      vec2 x = (p + wp + so + fo) / uRes * cells;
      ivec2 cc = ivec2(floor(x - 0.5)) - 1 + ivec2(k & 3, k >> 2);
      ivec2 cw = imod(cc, org_per(cells));
      vec4 h = vec4(hash2I(cw, uSeed + (fine ? 23.0 : 19.0)), hash2I(cw, uSeed + (fine ? 29.0 : 31.0)));
      vec4 h2 = vec4(hash2I(cw, uSeed + (fine ? 37.0 : 41.0)), hash2I(cw, uSeed + (fine ? 59.0 : 67.0)));
      vec2 site = vec2(cc) + 0.5 + 0.8 * (h.xy - 0.5);
      vec2 lq = x - site;
      // Struck from the stone's nearest edge (the deep end at the edge, running inward), or any which way.
      vec2 sp = site / cells * uRes - so - fo - wp;
      vec4 de = vec4(sp.x - lo.x, hi.x - sp.x, sp.y - lo.y, hi.y - sp.y);
      float m = min(min(de.x, de.y), min(de.z, de.w));
      float ae = m == de.x ? 0.0 : m == de.y ? PI : m == de.z ? 0.5 * PI : -0.5 * PI;
      bool struck = h2.w < u_scar_edge && !shut;
      float a = struck ? ae + 0.9 * (h.z - 0.5) : h.z * TAU;
      lq = vec2(cos(a) * lq.x + sin(a) * lq.y, -sin(a) * lq.x + cos(a) * lq.y);
      // Wider along the edge than inward (a scallop), up to 2.4×, shrunk to stay within reach of the 4 × 4 window
      // (1.5 cells).
      float st = 1.0 + 1.4 * u_scar_stretch * h.w;
      float R = min(0.55 + 0.4 * h2.x, 1.45 / st);
      vec2 e2 = vec2(lq.x * st, lq.y / st) / R;
      float d2 = dot(e2, e2);
      float depth = h2.z < u_scars ? 0.4 + 0.6 * h2.y : 0.0;
      // An edge flake starts at the edge: one whose struck end falls short of it fades out, leaving the middle of a big
      // stone its original face.
      if (struck) depth *= 1.0 - smoothstep(0.9, 1.4, m / (R / st * uRes.x / cells.x));
      // A flake's scar: a tilted plane, deepest at the struck end (−x) and running out at a grazing angle at the other,
      // walled in by the bowl wherever that is shallower — a steep, crisp wall round the struck end, curving up at the
      // sides. (Only inside the rim; outside it the plane would keep falling.)
      float plane = -0.5 * (1.0 - e2.x) * (0.7 + 1.0 * h2.x) + 0.4 * (hashI(cw, uSeed + (fine ? 71.0 : 73.0)) - 0.5) * e2.y;
      float s = d2 < 1.0 ? depth * max(d2 * d2 - 1.0, plane) : 0.0;
      if (fine) s2 = min(s2, s); else s1 = min(s1, s);
    }
  }
  // Depth in proportion to the scar's size (relative to a course), so resizing the scars keeps their slopes.
  float scar = s1 + u_scar_detail * 0.42 * s2;
  v += u_scar_depth * scar * max(u_scar_size, 2.0 * pxs) / course;
  if (u_rough > 0.0) {
    vec2 rcl = uTile ? max(vec2(1.0), floor(uRes / u_rough_scale + 0.5)) : uRes / u_rough_scale;
    v += 2.0 * u_rough * (org_noiseFbm(1, false, p / uRes * rcl, org_per(rcl), 3, 0.5, uSeed + 43.0) - 0.5);
  }

  // Open gaps: at one corner, along one or both edges meeting there, tapering from Gap width to nothing.
  float gp = 0.0;
  if (sb_h(pid, 12u) < u_gaps) {
    vec2 sg = vec2(sb_h(pid, 13u) < 0.5 ? -1.0 : 1.0, sb_h(pid, 14u) < 0.5 ? -1.0 : 1.0);
    vec2 K = c + sg * hs;
    float both = sb_h(pid, 15u);
    vec2 len = 2.0 * hs * u_gap_len * (0.4 + 0.6 * vec2(sb_h(pid, 16u), sb_h(pid, 17u)));
    vec2 t = abs(p - K) / max(len, vec2(1.0));
    // Along the horizontal edge (y = K.y) and the vertical one (x = K.x).
    vec2 w = u_gap_w * max(1.0 - t * t, 0.0) * vec2(both < 0.7 ? 1.0 : 0.0, both > 0.4 ? 1.0 : 0.0);
    float dg = min(abs(p.y - K.y) - w.x, abs(p.x - K.x) - w.y) + 2.0 * u_jag * jn;
    gp = clamp(0.5 - dg, 0.0, 1.0) * step(0.01, max(w.x, w.y));
  }

  // Joints: the floor of the joint sits below the face (and below a set-back stone); gaps sink deeper.
  float inside = u_aa ? clamp(0.5 - sd, 0.0, 1.0) : (sd <= 0.0 ? 1.0 : 0.0);
  float floorV = min(v, 0.0) - u_joint_depth * js;
  v = mix(floorV, v, inside);
  v = mix(v, floorV - 0.5 - u_joint_depth, gp);
  float val = (0.5 + 0.5 * tanh(0.5 * v)) * org_edgeProfile(sd);

  float rnd = u_rnd_mode == 1 ? u2f(bid) : u_rnd_mode == 2 ? hashI(ivec2(jr, 2), uSeed + 47.0) : u2f(pid);
  // The masks' coverage is their value, so any blend (a Normal paint too) lands only on them.
  float cov = 1.0;
  if (u_output == 1) {
    float m = max((1.0 - smoothstep(0.0, max(u_reach, 0.5), din)) * js, gp);
    if (u_patch > 0.0) {
      vec2 pc = uTile ? max(vec2(1.0), floor(uRes / (3.0 * u_length * rh) + 0.5)) : uRes / (3.0 * u_length * rh);
      float n = org_noiseFbm(1, false, p / uRes * pc, org_per(pc), 3, 0.5, uSeed + 53.0);
      float cut = 0.35 + 0.3 * u_patch;
      m *= smoothstep(cut - 0.05, cut + 0.05, n);
    }
    val = m;
    cov = m;
  } else if (u_output == 2) {
    val = clamp(-scar, 0.0, 1.0) * inside;
    cov = val;
  } else if (u_output == 3) {
    val = gp;
    cov = gp;
  }
  // Only the relief hands its stones to the Shape Mask; the masks opt out, so a named-mask write records what they paint.
  return genOutOwn(clamp(val, 0.0, 1.0), cov, rnd, u_output == 0 ? sd : ${ORG_NO_SDF});
}
`,
}
