// Splits: the layers below pulled apart along their weakest lines. Wood splits along its rings and grain, where the
// latewood meets the earlywood; the dark lines (or light ones, or the edges) of the colour or height below stand in for
// those lines here (docs/features/fr8.29-splits.md).
//
// Pre-passes (prepare), all only inside the Keep inside mask's pieces (a distance: the mask itself, or a jump flood of
// its coverage):
//   - the weakness: the source blurred at the Line width less the same blurred wider (a dark line: positive along its
//     middle), or the slope (an edge); and the structure tensor (the wide blur's gradient², blurred again), whose main
//     axis runs across the lines and whose fourth component is the weakness² round about, so a line is judged against
//     those near it;
//   - along the lines (streamlines through each pixel, following the tensor, held near the Grain): the weakness averaged
//     a little way along (so a line is as weak all along it), the strain (noise about Split spacing across, averaged half
//     a Split length along: long streaks that curve with the rings), a finer noise (one random per line, near enough) and
//     how far the piece's end lies along the line;
//   - how far the strain exceeds the line's strength (Amount, Line strength, Splits from ends), eroded along the line by
//     a cone, so each split tapers to its ends and short stretches stay shut.
// Then each pixel looks across the lines for those that give way: each opens by up to the Width, wider the further its
// strain exceeds its strength, so a split tapers to a point where the strain runs out; a wider one beside it relieves it
// (Strain relief), so bunched lines don't all open. Everything is judged at the split's centre line, which both sides
// find alike. The material either side moves away from it by half the opening, fading out over Push apart px; the pixels
// in the opening read the line itself, darkened by the Gap colour, deeper and darker towards the middle, and a Bevel
// rounds each ragged lip down into it. Every channel is pulled apart, so the colour, height, roughness and glow below
// all split together.

import type * as THREE from 'three';
import { P, orientAxis, type ParamValues } from '@/core/params';
import { SHAPE_MASK, type Layer } from '@/core/project';
import type { FilterContext } from '@/render/materialPipeline';
import type { LayerDef } from '../types';
import { DISTANCE_SOURCE, jumpFlood } from '@/gpu/jfa';
import { blurTexture, GLSL_READ_STATE } from './shared';

// Splits run along the grain: their length along it, their width and spacing across it (core/pixelScale.ts). With Any
// direction neither axis.
const along = orientAxis('grain', { vertical: 'y', horizontal: 'x' });
const across = orientAxis('grain', { vertical: 'y', horizontal: 'x' }, true);

// prepare: the source's lightness (Diffuse, in sRGB as it looks) or its height, × where the Keep inside mask's pieces
// are (and that weight), so the blurs of it divided by the blurred weight see only the pieces: a dark gap doesn't bleed
// into the board beside it and hide its lines there.
const LUM_PASS = /* glsl */ `
uniform sampler2D tMask;
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  float l = u_source == 0 ? luma(linearToSrgb(texelFetch(tAlbedo, ip, 0).rgb)) : texelFetch(tSurface, ip, 0).r;
  float md = fetchT(tMask, ip).x;
  float m = maskEmpty(md) ? 1.0 : clamp(0.5 - md, 0.0, 1.0);
  oColor = vec4(l * m, m, 0.0, 0.0);
}
`;

// prepare: the weakness (uTensor false: in .r) or the raw structure tensor and weakness² (uTensor true), from the source
// blurred at the line width (tSmall) and wider (tBig). Only inside the Keep inside mask: its gaps and the shading along
// its edges are no lines of the material, and would turn the grain's direction along them near a board's end.
const FIELD_PASS = /* glsl */ `
uniform sampler2D tSmall;
uniform sampler2D tBig;
uniform sampler2D tMask;
uniform bool uTensor;
float sp_lum(sampler2D t, ivec2 c) { vec2 v = fetchT(t, c).rg; return v.x / max(v.y, 1e-4); }
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  // (Each blur over its weight: the pieces' own lightness.)
  float ls = sp_lum(tSmall, ip), lb = sp_lum(tBig, ip);
  vec2 gs = 0.5 * vec2(sp_lum(tSmall, ip + ivec2(1, 0)) - sp_lum(tSmall, ip - ivec2(1, 0)),
                       sp_lum(tSmall, ip + ivec2(0, 1)) - sp_lum(tSmall, ip - ivec2(0, 1)));
  vec2 gb = 0.5 * vec2(sp_lum(tBig, ip + ivec2(1, 0)) - sp_lum(tBig, ip - ivec2(1, 0)),
                       sp_lum(tBig, ip + ivec2(0, 1)) - sp_lum(tBig, ip - ivec2(0, 1)));
  // A dark line: its surroundings lighter than it; a light line the other way; an edge: the slope (× the line width, so
  // it compares like the others).
  float w = u_follow == 0 ? lb - ls : u_follow == 1 ? ls - lb : length(gs) * u_line;
  float md = fetchT(tMask, ip).x;
  if (!maskEmpty(md)) {
    // (Two line widths in: the shading along a board's edge and the dark joint beside it read as the strongest line
    // there, and splits ran along the joints.)
    w *= smoothstep(0.5, 0.5 + 2.0 * u_line, -md);
    gb *= smoothstep(0.5, 0.5 + 2.5 * u_line, -md);
  }
  oColor = uTensor ? vec4(gb.x * gb.x, gb.y * gb.y, gb.x * gb.y, w * w) : vec4(w, 0.0, 0.0, 0.0);
}
`;

// The lines' direction at q (the tensor's minor axis), held near the Grain (a board's shaded end turns the lines across
// it): on a streamline's first step `way` (±1) sets which way it goes, later (way 0) it keeps the way of the last, d.
const STREAM_DIR = /* glsl */ `
vec2 sp_dir(sampler2D tT, vec2 q, vec2 d, float way) {
  vec4 T = sampleT(tT, q);
  float th = 0.5 * atan(2.0 * T.z, T.x - T.y + 1e-9);
  vec2 t = vec2(-sin(th), cos(th));
  if (u_grain < 2) {
    vec2 gA = u_grain == 0 ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
    float a = dot(t, gA);
    t = normalize(mix(gA * sign(a + 1e-6), t, smoothstep(0.35, 0.65, abs(a))));
  }
  return t * (way != 0.0 ? way : sign(dot(t, d) + 1e-6));
}
`;

// prepare: along the lines. A streamline through each pixel follows the tensor's minor axis (the lines' direction) both
// ways; along it
//   r: the weakness averaged over uReach px (≤ 24, in steps of about a pixel), so a line is as weak all along it (the
//      fine grain crossing a ring no longer breaks its split into beads or specks);
//   g: the strain — noise about Split spacing across, averaged over uLength px (a line-integral convolution), so it
//      comes in long streaks that curve with the lines, spread back to about 0..1;
//   b: the same of a noise a third as fine: one value per line, near enough — which lines check at an end, and widths.
// A streamline ends where it leaves the Keep inside mask's piece — outside it, or within reach of an edge that faces
// along it (a step can jump a narrow gap) — so nothing carries across a gap; where the strain's does — the last step
// inside plus its distance to the edge, which moves smoothly with the pixel — is how far the piece's end lies along the
// line (a, ≤ uLength).
// One flat loop over both ways and both reaches (D3D inlines every call).
const ALONG_PASS = /* glsl */ `
${STREAM_DIR}
uniform sampler2D tField;
uniform sampler2D tTensor;
uniform sampler2D tMask;
uniform float uReach;
uniform float uLength;
void main() {
  vec2 p0 = gl_FragCoord.xy;
  vec2 cells = snapCells(uRes / max(u_spacing, 0.5));
  vec2 cellsF = snapCells(uRes / max(u_spacing / 3.0, 0.5));
  ivec2 per = periodOf(cells), perF = periodOf(cellsF);
  float sum = fetchT(tField, ivec2(p0)).r, ws = 1.0;
  vec2 sumN = vec2(0.0);
  float sumK = 0.0, thPrev = 0.0;   // the lines' curvature summed along the line (× w), the last step's line angle
  float wsN = 0.0;
  vec2 q = p0, d = vec2(0.0);
  bool alive = true;
  float md0 = sampleT(tMask, p0).x, prev = md0;
  float de = uLength;
  for (int e = 0; e < 96 * UNI_1; e++) {
    // 0–47 the weakness's reach, 48–95 the strain's; each half one way, then the other. (The weakness in steps of
    // about a pixel: coarser ones alias the fine grain into stripes across the splits.)
    bool weak = e < 48;
    int k = e % 24;
    bool back = weak ? e >= 24 : e >= 72;
    float steps = 24.0;
    float st = (weak ? uReach : uLength) / steps;
    if (k == 0) { q = p0; d = vec2(0.0); alive = true; prev = md0; }
    d = sp_dir(tTensor, q, d, k == 0 ? (back ? -1.0 : 1.0) : 0.0);
    vec2 q0 = q;
    q += d * st;
    float md = sampleT(tMask, q).x;
    bool gone = !maskEmpty(md) && md >= 0.0;
    if (!gone && !maskEmpty(prev) && -prev < st) {
      ivec2 c0 = ivec2(floor(q0));
      vec2 g = vec2(fetchT(tMask, c0 + ivec2(1, 0)).x - fetchT(tMask, c0 - ivec2(1, 0)).x,
                    fetchT(tMask, c0 + ivec2(0, 1)).x - fetchT(tMask, c0 - ivec2(0, 1)).x);
      gone = dot(g, d) > 0.7 * length(g);
    }
    if (!weak && alive && gone && prev < 0.0) de = min(de, float(k) * st - prev);
    alive = alive && !gone;
    prev = md;
    float w = alive ? 1.0 - float(k + 1) / (steps + 1.0) : 0.0;
    if (weak) {
      sum += w * sampleT(tField, q).r;
      ws += w;
    } else {
      vec2 x = q / uRes;
      sumN += w * vec2(valueNoise(x * cells, per, uSeed + 11.0), valueNoise(x * cellsF, perF, uSeed + 23.0));
      wsN += w;
      // How far the lines turn per px here (their own direction, not held to the Grain; a half turn is no turn) —
      // counted only while the streamline runs along them: where the Grain holds it straight across a bend (a cathedral
      // arch's tip) it crosses the lines instead, and one step's jump there saturated the strain out to a fixed
      // distance, cutting splits along a straight edge.
      vec4 Tq = sampleT(tTensor, q);
      float th = 0.5 * atan(2.0 * Tq.z, Tq.x - Tq.y + 1e-9);
      float a = th - thPrev;
      float follows = smoothstep(0.85, 0.97, abs(dot(vec2(-sin(th), cos(th)), d)));
      if (k > 0) sumK += w * follows * min(abs(a - 3.14159265 * floor(a / 3.14159265 + 0.5)) / st, 0.15);
      thPrev = th;
    }
  }
  // An average over n independent values varies √n less: spread it back (about Split length over Split spacing).
  vec2 n = 0.5 + (sumN / max(wsN, 1e-3) - 0.5) * clamp(sqrt(2.0 * uLength / max(u_spacing * vec2(1.0, 1.0 / 3.0), 0.5)), vec2(1.0), vec2(8.0));
  // Round knots: where the lines curve tightly (the rings round a knot, the grain parting round it) the wood is under
  // more strain — the curvature averaged along the line like the strain itself, so it fades smoothly along the line.
  n.x += u_knots * smoothstep(0.01, 0.05, sumK / max(wsN, 1e-3));
  oColor = vec4(sum / ws, n, de);
}
`;

// Across the lines at a pixel (T: the tensor there): the lines' own direction where they are clear (the tensor's main
// axis), else the Grain's — and the Grain's where the lines run nearly across it, where which way across them flips from
// row to row (those lines don't open, and the ones that do are found either way).
const SP_ACROSS = /* glsl */ `
vec2 sp_across(vec4 T) {
  vec2 nG = u_grain == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  float dxy = T.x - T.y, tr = T.x + T.y;
  float coh = tr > 1e-12 ? sqrt(dxy * dxy + 4.0 * T.z * T.z) / tr : 0.0;
  float th = tr > 1e-12 ? 0.5 * atan(2.0 * T.z, dxy) : 0.0;
  vec2 n = vec2(cos(th), sin(th));
  if (u_grain < 2) {
    float al = dot(n, nG);
    n = normalize(mix(nG, n * sign(al + 1e-6), smoothstep(0.15, 0.5, coh) * smoothstep(0.35, 0.65, abs(al))));
  }
  return n;
}
// How far strain relief reaches across the lines (px): a few lines' spacing.
float sp_reliefReach() { return 0.5 * u_width * (1.0 + u_width_var) + 2.0 + 5.0 * u_line; }
// A line's opening as a share of the Width (its own width variation by its random r), from its excess — linear, so
// its tips are points (a power under 1 rounded them, and magnified the noise in a fading tail into a comb of dashes).
float sp_share(float ex, float r) {
  return max(1.0 + u_width_var * 2.0 * (r - 0.5), 0.05) * clamp(ex / (0.03 + 0.15 * u_taper), 0.0, 1.0);
}
`;

// prepare: how far the strain on each line exceeds its strength (> 0: it gives way), as if a line ran through each pixel
// (what reads it reads it at the lines' centres) — the strain (along's g) plus Amount, less Line strength × how faint
// the line is here, plus each line's own random (so the Seed reorders which win), plus Splits from ends towards a
// piece's end on a few lines (by that random), so an end checks in one or two splits, widest at the end, not a comb.
const EXCESS_PASS = /* glsl */ `
${SP_ACROSS}
uniform sampler2D tAlong;
uniform sampler2D tTensor;
uniform sampler2D tMask;
float sp_excess(vec2 q) {
  vec4 F = sampleT(tAlong, q);
  float wk = F.r / (2.0 * sqrt(max(sampleT(tTensor, q).w, 0.0)) + 0.01);
  // (Each line's own random has a say too, so the Seed reorders which lines win, not only the strain's streaks.)
  float ex = F.g + u_amount - 1.0 - u_select * (1.0 - clamp(wk, 0.0, 1.0)) + 0.4 * (F.b - 0.5);
  // Where no split may run, the excess falls away, so the cone below tapers each split into it instead of the main pass
  // cutting it square: a line turned more than ~55–70° off the Grain (wood splits along its grain, and beside a board's
  // end its gap's shading turns the lines); within a margin of the piece's sides (whose own shading reads as a line) —
  // the margin shrinking to half a pixel at its ends, so end checks reach the end. (Not how faint the line is: the
  // streamline drifts a pixel off a narrow line, where it looks faint, and that shut nearly every split.)
  if (u_grain < 2) {
    vec4 T = sampleT(tTensor, q);
    float th = 0.5 * atan(2.0 * T.z, T.x - T.y + 1e-9);
    ex -= 1.0 - smoothstep(0.35, 0.6, abs(dot(vec2(-sin(th), cos(th)), u_grain == 0 ? vec2(0.0, 1.0) : vec2(1.0, 0.0))));
  }
  // A line fading out where it merges into its neighbour closes: by how far it stands above the lowest weakness 2 px to
  // 3 Line widths either side across it (the higher of the two: its prominence, in its neighbours' terms) — the peak
  // taken within 1.5 px, as the streamlines that erode this drift off a line. Here, before the cone, a fading line
  // tapers shut over a length; judged per pixel in the layer's pass it lasted a row or two, by sampling noise: a square
  // end.
  vec2 nq = sp_across(sampleT(tTensor, q));
  float pk = F.r;
  vec2 lo = vec2(1e9);
  for (int m = 0; m < 18 * UNI_1; m++) {
    bool near = m < 6;
    int j = near ? m : m - 6;
    float o = near ? 0.5 * float(j % 3 + 1) * (j < 3 ? -1.0 : 1.0)
                   : (2.0 + (3.0 * u_line - 2.0) * float(j % 6) / 5.0) * (j < 6 ? -1.0 : 1.0);
    float wm = sampleT(tAlong, q + nq * o).r;
    if (near) pk = max(pk, wm);
    else if (j < 6) lo.x = min(lo.x, wm);
    else lo.y = min(lo.y, wm);
  }
  ex -= 0.6 * (1.0 - smoothstep(0.0, 0.15, (pk - max(lo.x, lo.y)) / (2.0 * sqrt(max(sampleT(tTensor, q).w, 0.0)) + 0.01)));
  float md = sampleT(tMask, q).x;
  if (!maskEmpty(md)) {
    float nearEnd = 1.0 - smoothstep(1.0, 4.0 + u_line, F.a);
    float margin = mix(1.5 + u_line, 0.5, nearEnd);
    ex -= smoothstep(-margin - 1.0, -margin, md);
    ex += 1.5 * u_ends * smoothstep(0.55, 0.8, F.b) * (1.0 - smoothstep(0.0, 0.5 * u_length, F.a));
  }
  return ex;
}
void main() {
  oColor = vec4(sp_excess(gl_FragCoord.xy), 0.0, 0.0, 0.0);
}
`;

// prepare: an excess (tSrc's r) eroded along the line by a cone: the least, over the streamline, of the excess there plus
// slope × its distance (where the line stops — the piece's end, or a turn past ~80° — counts as −1), less uBias. So a
// split tapers linearly to wherever its line stops giving way, opening fully Ltip px in, and it is continuous
// everywhere. (Run lengths measured from the pixel jumped where the excess dipped to 0 at the pixel itself — a long run
// just above, none just below — and with them whole splits, cutting their neighbours.) Run twice: on the excess, with a
// bias so a stretch shorter than about 4 Widths never opens; then on the excess after strain relief, so a split relieved
// by a neighbour tapers out too.
const ERODE_PASS = /* glsl */ `
${STREAM_DIR}
uniform sampler2D tSrc;
uniform sampler2D tTensor;
uniform sampler2D tMask;
uniform float uReach;
uniform float uBias;
void main() {
  vec2 p0 = gl_FragCoord.xy;
  float st = uReach / 16.0;
  float tl = 0.03 + 0.15 * u_taper;
  float ltip = min(max(2.0, 3.0 * u_width * (0.3 + u_taper)), 0.8 * uReach);
  // (Lines give way by ~0.05–0.1 of excess: at a slope of tl / ltip they rose to it in 2–3 px — square ends. This slope
  // takes about Ltip to rise to the usual plateau.)
  float slope = 0.6 * tl / ltip;
  float ero = sampleT(tSrc, p0).r;
  vec2 q = p0, d = vec2(0.0), d0 = vec2(0.0);
  bool alive = true;
  for (int e = 0; e < 32 * UNI_1; e++) {
    // 0–15 one way, 16–31 the other.
    int k = e % 16 + 1;
    if (k == 1) { q = p0; d = vec2(0.0); alive = true; }
    d = sp_dir(tTensor, q, d, k == 1 ? (e < 16 ? 1.0 : -1.0) : 0.0);
    if (k == 1) d0 = d;
    q += d * st;
    float md = sampleT(tMask, q).x;
    alive = alive && (maskEmpty(md) || md < 0.0) && dot(d, d0) > 0.17;
    ero = min(ero, (alive ? sampleT(tSrc, q).r : -1.0) + slope * float(k) * st);
  }
  oColor = vec4(ero - uBias * slope * u_width, 0.0, 0.0, 0.0);
}
`;

// prepare: strain relief. A split that opens wider beside a line takes the strain off it: by 1.5 × its opening (as a
// share of the Width), less with distance across the lines (gone a few lines' spacing away), the reliefs adding up — so
// the widest split nearby all but closes the rest and lines bunched together don't open side by side. Wider is judged
// softly (over ±0.6 of the Width). Per pixel, as if a line ran through it, against the lines found either side across
// (local maxima of the weakness, as the layer's pass finds them), each judged by the once-eroded excess at its centre;
// the result goes back to an excess for the second erosion, which tapers a relieved split out where the stronger one
// takes over — in the layer's pass, the hand-over was a square head.
const RELIEF_PASS = /* glsl */ `
${SP_ACROSS}
uniform sampler2D tAlong;
uniform sampler2D tTensor;
uniform sampler2D tEx;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 n = sp_across(sampleT(tTensor, p));
  float own = sampleT(tEx, p).r;
  float fi = sp_share(own, sampleT(tAlong, p).b);
  float Dr = sp_reliefReach();
  int N = int(clamp(ceil(2.0 * Dr + 2.0), 4.0, 128.0));
  float st = (2.0 * Dr + 2.0) / float(N);
  float rel = 0.0;
  float wa = 0.0, wb = 0.0;
  for (int k = 0; k <= N; k++) {
    float t = -Dr - 1.0 + float(k) * st;
    float wc = sampleT(tAlong, p + n * t).r;
    if (k >= 2 && wb >= wa && wb > wc && wb > 0.0) {
      float den = wa - 2.0 * wb + wc;
      float tc = t + ((den < 0.0 ? clamp(0.5 * (wa - wc) / den, -0.5, 0.5) : 0.0) - 1.0) * st;
      // (The line through this pixel itself is no neighbour.)
      if (abs(tc) > 1.5) {
        vec2 c = p + n * tc;
        float fj = sp_share(sampleT(tEx, c).r, sampleT(tAlong, c).b);
        float dj = abs(tc) / Dr;
        rel += 1.5 * fj * max(1.0 - dj * dj, 0.0) * smoothstep(-0.6, 0.6, fj - fi);
      }
    }
    wa = wb;
    wb = wc;
  }
  // Back to an excess (0 where the share is 0, linear below), never above the unrelieved one.
  float fr = fi - rel;
  float r = max(1.0 + u_width_var * 2.0 * (sampleT(tAlong, p).b - 0.5), 0.05);
  float er = fr > 0.0 ? (0.03 + 0.15 * u_taper) * min(fr / r, 1.0) : fr * (0.03 + 0.15 * u_taper);
  oColor = vec4(min(own, er), 0.0, 0.0, 0.0);
}
`;

// prepare: the Keep inside mask as it stands (exact, or empty: MASK_EMPTY everywhere), for the passes that read it.
const MASK_COPY = /* glsl */ `
void main() {
  oColor = fetchT(tMaskSrc, ivec2(gl_FragCoord.xy));
}
`;

const APPLY = /* glsl */ `
${GLSL_READ_STATE}
${SP_ACROSS}
// A bevel's rise, t from the lip of the split (0) to where the surface is whole again (1).
float sp_prof(float t) {
  t = clamp(t, 0.0, 1.0);
  return u_profile == 0 ? t : u_profile == 1 ? t * t * (3.0 - 2.0 * t) : sqrt(t * (2.0 - t));
}

void applyFilter(inout vec4 A, inout vec4 S, inout vec4 E, ivec2 ip) {
  if (u_amount <= 0.0 || u_width <= 0.0) return;
  vec2 p = vec2(ip) + 0.5;
  vec2 n = sp_across(fetchT(t_tensor, ip));

  float tl = 0.03 + 0.15 * u_taper;
  // The ragged lips' noise: about 1.5 Widths a wave.
  vec2 cellsR = snapCells(uRes / max(1.5 * u_width, 2.0));
  ivec2 perR = periodOf(cellsR);
  float give = max(u_give, 1e-3);

  // Search across the lines, far enough to find any split that reaches this pixel: within R (its half width, bevel and
  // push) + its opening (≤ wMax), plus two samples for a line to show as a peak. (Strain relief is prepare's.)
  float wMax = u_width * (1.0 + u_width_var);
  float R = 0.5 * wMax + u_bevel + u_give + 1.0;
  float Rs = R + wMax + 2.0;
  int N = int(clamp(ceil(2.0 * Rs), 4.0, 160.0));
  float st = 2.0 * Rs / float(N);
  // The lines that give way: their centres along n and their openings (px).
  float cT[24], cO[24], cL[24], cR[24];
  // … and its own normal at its centre (sign along n): distances and the push are measured across the split itself, not
  // along the scan — measured along the scan, a diagonal split drew a short dash per row: combs on its thin tails.
  vec2 cNl[24];
  // … and its own depth.
  float cD[24];
  int nc = 0;
  float wa = 0.0, wb = 0.0;   // the weakness two samples back and one
  for (int k = 0; k <= N; k++) {
    float t = -Rs + float(k) * st;
    float wc = sampleT(t_field, p + n * t).r;
    if (k >= 2 && wb >= wa && wb > wc && wb > 0.0 && nc < 24) {
      // A line: its centre and strength from a parabola through the three samples.
      float den = wa - 2.0 * wb + wc;
      float o = den < 0.0 ? clamp(0.5 * (wa - wc) / den, -0.5, 0.5) : 0.0;
      float tc = t + (o - 1.0) * st;
      float wpk = wb - 0.25 * (wa - wc) * o;
      // Refined by a second parabola through samples half a pixel either side: the first is only as good as the
      // search's step, and its error, changing from row to row, notched the lips of wide splits into teeth.
      vec3 wr = vec3(sampleT(t_field, p + n * (tc - 0.5)).r, sampleT(t_field, p + n * tc).r, sampleT(t_field, p + n * (tc + 0.5)).r);
      float den2 = wr.x - 2.0 * wr.y + wr.z;
      if (den2 < 0.0) tc += 0.5 * clamp(0.5 * (wr.x - wr.z) / den2, -0.5, 0.5);
      vec2 c = p + n * tc;
      // Everything about the split is judged at its centre, so both its sides agree: how far the strain on it exceeds
      // its strength (prepare's, relieved by the wider splits beside it and tapered along it to wherever it may not run)
      // and its own random; it stays on its piece
      // of the mask (prepare tapered it shut short of the piece's sides and ends).
      vec4 Tc = sampleT(t_tensor, c);
      // (Hardly a line at all — the noise between lines — doesn't open.)
      float wk = wpk / (2.0 * sqrt(max(Tc.w, 0.0)) + 0.01);
      // (The most within ¾ px across it: the excess falls off steeply across a thin line, and each pixel's estimate of its
      // centre differs a little — read at the centre alone, a fading tail's opening jittered from pixel to pixel.)
      vec2 nlc = vec2(cos(0.5 * atan(2.0 * Tc.z, Tc.x - Tc.y + 1e-9)), sin(0.5 * atan(2.0 * Tc.z, Tc.x - Tc.y + 1e-9)));
      float ex = max(sampleT(t_open, c).r, max(sampleT(t_open, c - 0.75 * nlc).r, sampleT(t_open, c + 0.75 * nlc).r));
      float nzw = sampleT(t_field, c).b;
      float md = sampleT(t_mask, c).x;
      bool inside = maskEmpty(md) || md < 0.0;
      float O = inside ? smoothstep(0.1, 0.25, wk) * u_width * sp_share(ex, nzw) : 0.0;
      if (O > 0.01 && abs(tc) < R + wMax) {
        // Its own depth (Depth variation): from the line's random, through a sine so it doesn't follow its width.
        cD[nc] = 1.0 - u_depth_var * (0.5 + 0.5 * sin(nzw * 23.0 + 1.3));
        // Ragged lips: each side of the opening wanders by its own fibrous noise along the split.
        vec2 rx = c / uRes * cellsR;
        vec2 rn = u_ragged > 0.0 ? fbmPair(rx, rx + 17.3, perR, 2, uSeed + 31.0, uSeed + 37.0, 2) : vec2(0.5);
        cT[nc] = tc;
        float thn = 0.5 * atan(2.0 * Tc.z, Tc.x - Tc.y + 1e-9);
        vec2 nl = vec2(cos(thn), sin(thn));
        nl *= sign(dot(nl, n) + 1e-6);
        // (Never far off the scan: past ~70° the scan meets the split too obliquely to judge it.)
        cNl[nc] = dot(nl, n) > 0.35 ? nl : n;
        cO[nc] = O;
        cL[nc] = max(1.0 + 1.6 * u_ragged * (rn.x - 0.5), 0.0);
        cR[nc] = max(1.0 + 1.6 * u_ragged * (rn.y - 0.5), 0.0);
        nc++;
      }
    }
    wa = wb;
    wb = wc;
  }

  vec2 push = vec2(0.0);      // how far the material here moved (px; the source is p + push)
  float gapT = 0.0;           // the centre of the split whose opening holds this pixel (along n), if any
  bool inGap = false;
  float drop = 0.0;           // how far the surface sinks (height)
  float shade = 0.0;          // how much of the Gap colour it takes
  float deep = 0.0;           // how far into a split's depths (darker still)
  for (int i = 0; i < nc; i++) {
    float tc = cT[i];
    float O = cO[i];
    if (O > 0.01 && abs(tc) < R + O) {
      float u = -tc * dot(cNl[i], n);        // this pixel from the split's centre line, across it
      // Each side its own ragged half (cL below the line along n, cR above).
      float hL = 0.5 * O * cL[i], hR = 0.5 * O * cR[i];
      float h = u < 0.0 ? hL : hR;
      float ed = abs(u) - h;                 // px beyond its side (< 0: in the opening)
      float tau = clamp(O / u_width, 0.0, 1.0);
      float b = u_bevel * sqrt(tau);
      // The opening's share of this pixel (a pixel box filter, so hairlines fade instead of flickering), and the
      // bevel's fall (1 at the lip … 0 a Bevel out).
      // (The pixel's footprint across the split is |cos| + |sin| of its direction — up to 1.41 px on a diagonal; taken as
      // 1 px, pixel centres along a diagonal hairline alternated near and far from it, and it broke into dashes.)
      float wp = abs(cNl[i].x) + abs(cNl[i].y);
      float cov = max(0.0, min(u + 0.5 * wp, hR) - max(u - 0.5 * wp, -hL)) / wp;
      float bw = max(cov, ed <= 0.0 ? 1.0 : b > 0.0 ? 1.0 - sp_prof(ed / b) : 0.0);
      // Deeper towards its middle (a V under the bevelled lips), and darker with it.
      float mid = ed < 0.0 ? sqrt(clamp(-ed / max(h, 1e-3), 0.0, 1.0)) * cov : 0.0;
      if (u_style == 1) {
        // Dent: a soft dish across the whole width and bevel — deepest on the line, easing out to the surface by the
        // Profile — with no walls and no floor.
        float dish = 1.0 - sp_prof(abs(u) / max(h + b, 0.75));
        drop = max(drop, u_depth * cD[i] * sqrt(tau) * dish);
        shade = max(shade, u_wall * dish);
        mid = dish * dish;
      } else {
        drop = max(drop, u_depth * cD[i] * sqrt(tau) * (0.6 * bw + 0.4 * mid));
        shade = max(shade, max(cov, u_wall * bw));
      }
      deep = max(deep, mid * sqrt(tau));
      if (u_style == 1) {
        // Dent: the material stays where it is; only its surface dips.
      } else if (ed < 0.0) {
        inGap = true;
        gapT = tc;
      } else {
        // Pushed aside: the material here came from nearer the line, by half the opening at the lip, fading out over
        // Push apart px.
        push += cNl[i] * (sign(tc) * h * (1.0 - smoothstep(0.0, give, ed)));
      }
    }
  }
  if (!inGap && push == vec2(0.0) && drop <= 0.0) return;
  // Split open: the opening shows the line itself; elsewhere the material pushed aside. (A dent moves nothing.)
  if (inGap || push != vec2(0.0)) readState(inGap ? p + n * gapT : p + push, u_nearest, A, S, E);
  // Darken: how far the Gap colour (multiplied in sRGB, as a layer's Diffuse blends) and the depths darken it — at 0
  // the material keeps its own colour and only the relief shows the split.
  float dk = shade * u_darken;
  A.rgb = srgbToLinear(linearToSrgb(A.rgb) * mix(vec3(1.0), linearToSrgb(u_gap_color), dk) * (1.0 - 0.6 * deep * u_darken));
  S.r -= drop;
  S.g = clamp(S.g + u_gap_rough * shade, 0.0, 1.0);
}
`;

/**
 * The weakness (`t_field`) and the structure tensor with the local weakness² (`t_tensor`): the source's lightness or
 * height, blurred at the line width and wider. The blur's scratch targets are shared, so the narrow blur is copied out
 * before the wide one, and the tensor's blur (the last) is what the layer's pass reads.
 */
function prepareSplits(ctx: FilterContext, layer: Layer): Record<string, THREE.Texture> {
	const line = Math.max(0.25, Number(layer.params.line ?? 2));
	// The Keep inside mask as a distance: as it is where only shapes wrote it (or nothing did), else found by jump flood
	// from its coverage (a feathered or painted mask holds no distance).
	const src = ctx.maskSource;
	let mask: THREE.Texture;
	if (src && !src.exact) {
		mask = jumpFlood(ctx, {
			source: DISTANCE_SOURCE.mask,
			threshold: 0.5,
			mask: src.texture,
			name: 'splits:jfa'
		}).texture;
	} else {
		const copy = ctx.scratch('splits:mask');
		ctx.run(ctx.material('splits-mask', MASK_COPY), copy);
		mask = copy.texture;
	}
	const lum = ctx.scratch('splits:lum');
	const lumMat = ctx.material('splits-lum', LUM_PASS, { tMask: { value: null } });
	lumMat.uniforms.tMask.value = mask;
	ctx.run(lumMat, lum);
	const small = ctx.scratch('splits:small');
	ctx.gpu.copy(blurTexture(ctx, lum.texture, line).texture, small);
	const big = blurTexture(ctx, lum.texture, 3 * line);
	const field = ctx.scratch('splits:field');
	const raw = ctx.scratch('splits:raw');
	const mat = ctx.material('splits-field', FIELD_PASS, {
		tSmall: { value: null },
		tBig: { value: null },
		tMask: { value: null },
		uTensor: { value: false }
	});
	mat.uniforms.tMask.value = mask;
	mat.uniforms.tSmall.value = small.texture;
	mat.uniforms.tBig.value = big.texture;
	mat.uniforms.uTensor.value = false;
	ctx.run(mat, field);
	mat.uniforms.uTensor.value = true;
	ctx.run(mat, raw);
	const tensor = blurTexture(ctx, raw.texture, Math.max(8, 6 * line));
	const smooth = ctx.scratch('splits:along');
	const along = ctx.material('splits-along', ALONG_PASS, {
		tField: { value: null },
		tTensor: { value: null },
		tMask: { value: null },
		uReach: { value: 8 },
		uLength: { value: 48 }
	});
	along.uniforms.tField.value = field.texture;
	along.uniforms.tTensor.value = tensor.texture;
	along.uniforms.tMask.value = mask;
	const length = Number(layer.params.length ?? 160);
	along.uniforms.uReach.value = Math.min(24, Math.max(4, 0.15 * length));
	along.uniforms.uLength.value = Math.max(2, 0.5 * length);
	ctx.run(along, smooth);
	// The excess, eroded (with the minimum length), relieved by the wider splits beside each line, eroded again.
	const excess = ctx.scratch('splits:excess');
	const exMat = ctx.material('splits-excess', EXCESS_PASS, {
		tAlong: { value: null },
		tTensor: { value: null },
		tMask: { value: null }
	});
	exMat.uniforms.tAlong.value = smooth.texture;
	exMat.uniforms.tTensor.value = tensor.texture;
	exMat.uniforms.tMask.value = mask;
	ctx.run(exMat, excess);
	const erode = ctx.material('splits-erode', ERODE_PASS, {
		tSrc: { value: null },
		tTensor: { value: null },
		tMask: { value: null },
		uReach: { value: 8 },
		uBias: { value: 0 }
	});
	erode.uniforms.tTensor.value = tensor.texture;
	erode.uniforms.tMask.value = mask;
	erode.uniforms.uReach.value = Math.min(48, Math.max(8, 4 * Number(layer.params.width ?? 2.5) + 8));
	const eroded = ctx.scratch('splits:eroded');
	erode.uniforms.tSrc.value = excess.texture;
	erode.uniforms.uBias.value = 2;
	ctx.run(erode, eroded);
	const relieved = ctx.scratch('splits:relieved');
	const relief = ctx.material('splits-relief', RELIEF_PASS, {
		tAlong: { value: null },
		tTensor: { value: null },
		tEx: { value: null }
	});
	relief.uniforms.tAlong.value = smooth.texture;
	relief.uniforms.tTensor.value = tensor.texture;
	relief.uniforms.tEx.value = eroded.texture;
	ctx.run(relief, relieved);
	const open = ctx.scratch('splits:open');
	erode.uniforms.tSrc.value = relieved.texture;
	erode.uniforms.uBias.value = 0;
	ctx.run(erode, open);
	return { field: smooth.texture, tensor: tensor.texture, mask, open: open.texture };
}

const maskName = (p: ParamValues) => String(p.mask ?? '').trim() || null;

export const splitsLayer: LayerDef = {
	type: 'splits',
	channels: { diffuse: true, height: true },
	label: 'Splits',
	category: 'filter',
	kind: 'filter',
	description:
		'Pulls the layers below apart along their weakest lines — the dark lines between tree rings, the grain — into tapering splits that push the material aside, with a bevelled lip and a dark floor. Makes checked timber, split boards, weathered posts.',
	params: [
		P.enum(
			'source',
			'Source',
			'diffuse',
			[
				['diffuse', 'Diffuse', 'the lightness of the colour below'],
				['height', 'Height', 'the height below']
			],
			{ group: 'lines', hint: 'Picks what the lines that give way are found in' }
		),
		P.enum(
			'follow',
			'Gives way along',
			'dark',
			[
				['dark', 'Dark lines', 'the darker lines, such as the latewood of tree rings'],
				['light', 'Light lines', 'the lighter lines'],
				['edges', 'Edges', 'where it turns from dark to light, such as the outer edge of a ring']
			],
			{ group: 'lines', hint: 'Picks which lines in the source are weak, so the splits open along them' }
		),
		P.float('line', 'Line width', 2, 0.25, 64, {
			softMax: 12,
			unit: 'px',
			step: 0.05,
			group: 'lines',
			hint: 'Sets the width of the lines it looks for: about the width of a ring’s dark line. Finer detail is ignored'
		}),
		P.float('select', 'Line strength', 0.25, 0, 1, {
			step: 0.001,
			group: 'lines',
			hint: 'How much stronger a faint line is than a clear one: 0 = any line under strain gives way, 1 = mostly the clearest lines'
		}),
		P.enum(
			'grain',
			'Grain',
			'vertical',
			[
				['vertical', 'Vertical'],
				['horizontal', 'Horizontal'],
				['any', 'Any direction', 'the splits run whichever way the lines do, with no grain']
			],
			{
				group: 'splits',
				hint: 'Picks which way the splits run. They follow the lines where those are clear (round knots too), and the grain where they aren’t'
			}
		),
		P.float('amount', 'Amount', 0.5, 0, 1, {
			step: 0.001,
			group: 'splits',
			hint: 'How hard the material is pulled apart: more opens more and longer splits'
		}),
		P.float('length', 'Split length', 160, 4, 2048, {
			softMax: 384,
			unit: 'px',
			axis: along,
			step: 0.1,
			group: 'splits',
			hint: 'Sets the length of the strained stretches along the grain, so roughly how long the splits run'
		}),
		P.float('spacing', 'Split spacing', 48, 1, 512, {
			softMax: 96,
			unit: 'px',
			axis: across,
			step: 0.1,
			group: 'splits',
			hint: 'Sets how far apart the strained stretches are across the grain: less puts more lines side by side under strain'
		}),
		P.float('width', 'Width', 2.5, 0.1, 64, {
			softMax: 12,
			unit: 'px',
			axis: across,
			step: 0.05,
			group: 'splits',
			labelFor: (p) => (p.style === 'dent' ? 'Dent width' : 'Width'),
			hint: 'Sets how wide a split opens where the strain is greatest — or, with Style › Dent, how wide its dent is (the Bevel widens the dent’s soft edge further)'
		}),
		P.float('width_var', 'Width variation', 0.5, 0, 1, {
			step: 0.001,
			group: 'splits',
			hint: 'Varies the widest opening from split to split (0 = all open to the Width)'
		}),
		P.float('taper', 'Taper', 0.5, 0, 1, {
			step: 0.001,
			group: 'splits',
			hint: 'Sets how gradually a split narrows to its tips: 0 = it opens almost at once, 1 = long, fine points'
		}),
		P.float('give', 'Push apart', 6, 0, 256, {
			softMax: 64,
			unit: 'px',
			step: 0.1,
			group: 'splits',
			showIf: (p) => p.style !== 'dent',
			hint: 'Sets how far either side of a split the material moves aside to make room for it: the lines beside it bend away. 0 = the split cuts into the material instead'
		}),
		P.float('knots', 'Round knots', 0.5, 0, 1, {
			step: 0.001,
			group: 'splits',
			hint: 'Puts more strain where the lines curve tightly — the rings round a knot, the grain parting round it — so splits open there, following the curve'
		}),
		P.float('ends', 'Splits from ends', 0.4, 0, 1, {
			step: 0.001,
			group: 'splits',
			hint: 'Checks the ends of each piece of the Keep inside mask (its edges across the grain): a split or two from each end, widest there and tapering inward, as boards check at their ends'
		}),
		P.text('mask', 'Keep inside', SHAPE_MASK, {
			mask: 'read',
			group: 'splits',
			hint: 'Names the mask whose pieces the splits stay inside (Shape: what shape layers like Wood’s planks write). Empty, or with nothing written to it, they run anywhere'
		}),
		P.enum(
			'style',
			'Style',
			'split',
			[
				['split', 'Split open', 'the material either side is pushed apart and the split opens between them'],
				[
					'dent',
					'Dent',
					'the material stays whole: the split only dents its surface, a bevelled groove or dip in the height'
				]
			],
			{
				group: 'look',
				hint: 'Picks whether the splits open the material up or only dent it'
			}
		),
		P.float('depth', 'Depth', 0.45, 0, 8, {
			softMax: 2,
			step: 0.001,
			group: 'look',
			hint: 'How far the floor of a split sinks below the surface, in height (1 = the project’s Height depth). Narrow parts are shallower'
		}),
		P.float('depth_var', 'Depth variation', 0.5, 0, 1, {
			step: 0.001,
			group: 'look',
			hint: 'Varies how deep each split goes, apart from how wide it opens (0 = all as deep as the Depth, 1 = anywhere from flush to the full Depth), so some are shallow scratches and some deep checks'
		}),
		P.float('bevel', 'Bevel', 1, 0, 64, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			group: 'look',
			hint: 'Rounds the lips of a split down into it over this width, narrowing with the split so its tips stay sharp (0 = a sharp edge)'
		}),
		P.float('ragged', 'Raggedness', 0.4, 0, 1, {
			step: 0.001,
			group: 'look',
			hint: 'Makes the lips of a split wander, each side on its own, like torn fibres (0 = smooth, even sides)'
		}),
		P.enum(
			'profile',
			'Profile',
			'smooth',
			[
				['linear', 'Linear'],
				['smooth', 'Smooth'],
				['round', 'Round']
			],
			{ group: 'look', hint: 'Sets the shape of the bevel' }
		),
		P.float('darken', 'Darken', 0.35, 0, 1, {
			step: 0.001,
			group: 'look',
			hint: 'How dark a split goes: the Gap colour and the shadow of its depths (0 = the material keeps its colour and only the relief shows the split, 1 = full Gap colour, darker still in the middle)'
		}),
		P.color('gap_color', 'Gap colour', '#4a3a30', {
			group: 'look',
			hint: 'Multiplies the colour inside a split (white leaves it as the line’s own colour)'
		}),
		P.float('wall', 'Darken bevel', 0.6, 0, 1, {
			step: 0.001,
			group: 'look',
			hint: 'How far the Gap colour reaches up the bevel'
		}),
		P.float('gap_rough', 'Roughness Δ', 0.2, -1, 1, {
			step: 0.001,
			group: 'look',
			hint: 'Adds to the roughness inside a split'
		}),
		P.bool('nearest', 'Nearest pixel', false, {
			group: 'look',
			hint: 'No interpolation where material moves: keeps hard pixel-art edges'
		}),
		P.seed('seed', 'Seed', 1, { group: 'splits' })
	],
	groups: [
		{ id: 'lines', label: 'Weak lines' },
		{ id: 'splits', label: 'Splits' },
		{ id: 'look', label: 'Look' }
	],
	// Sizes follow the texture (a new layer; the plain defaults at 256 px).
	fresh: ({ width, height }) => {
		const k = Math.max(0.25, Math.sqrt(width * height) / 256);
		const r1 = (v: number) => Math.round(v * 10) / 10;
		return {
			line: r1(Math.max(0.5, 2 * Math.sqrt(k))),
			length: r1(160 * k),
			spacing: r1(48 * k),
			width: r1(2.5 * Math.sqrt(k)),
			give: r1(6 * Math.sqrt(k)),
			bevel: r1(Math.sqrt(k))
		};
	},
	// A dent is shallower and lighter than an opened split.
	linkedDefaults: (p) => (p.style === 'dent' ? { depth: 0.35, darken: 0.15 } : { depth: 0.45, darken: 0.35 }),
	maskSource: maskName,
	textures: ['field', 'tensor', 'mask', 'open'],
	prepare: prepareSplits,
	filterGlsl: APPLY
};
