// Bands: thick bands with mitred bends that run across the tile in lanes — diagonal bars, a zig-zag band,
// nested chevrons, and tech-wall Z steps (low run → 45° rise → high run, chamfered ends). Exact polygon
// distances (px) so bevels, profiles and the shape register work; rnd per bar / piece / lane.

import { P, gradient } from '@/core/params'
import type { LayerDef } from '../types'
import { geoGlsl } from './geometricCommon'

const modeIs = (...m: string[]) => (p: Record<string, unknown>) => m.includes(String(p.mode))

export const bandsLayer: LayerDef = {
  type: 'bands',
  label: 'Bands',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description:
    'Thick diagonal / zig-zag / chevron / Z-step bands between horizontal strips (Quake tech-wall look), seamless, with chamfered or rounded ends.',
  params: [
    P.enum('mode', 'Shape', 'z', [
      ['diagonal', 'Diagonal bars'],
      ['zigzag', 'Zig-zag band'],
      ['chevron', 'Chevrons'],
      ['z', 'Z steps'],
    ]),
    P.int('count', 'Count', 1, 1, 128, { softMax: 16, hint: 'Repeats along the band direction' }),
    P.int('rows', 'Rows', 1, 1, 128, { softMax: 16, hint: 'Lanes stacked across the band direction (chevrons: stripe spacing)' }),
    P.float('width', 'Band width', 16, 0.5, 2048, { softMax: 64, unit: 'px', step: 0.1, hint: 'Thickness across the band' }),
    P.float('margin_top', 'Top margin', 6, 0, 1024, { softMax: 32, unit: 'px', step: 0.1, showIf: modeIs('diagonal', 'zigzag', 'z'), hint: 'Clear strip along the top of each lane (in the band frame). Diagonal bars with both margins 0 run through as seamless stripes' }),
    P.float('margin_bottom', 'Bottom margin', 6, 0, 1024, { softMax: 32, unit: 'px', step: 0.1, showIf: modeIs('diagonal', 'zigzag', 'z'), hint: 'Clear strip along the bottom of each lane' }),
    P.float('angle', 'Angle', 45, -90, 90, { unit: '°', step: 0.1, hint: 'Slope of the rising parts (negative mirrors). Diagonal bars with 0 margin snap to a seamless slope' }),
    P.float('run', 'Run', 0.5, 0, 1, { step: 0.001, showIf: modeIs('z', 'zigzag', 'chevron'), hint: 'Z: flat run length (fraction of the repeat). Zig-zag: share of the flats on the high side. Chevron: flat top/bottom fraction' }),
    P.float('chamfer', 'End chamfer', 4, 0, 1024, { softMax: 32, unit: 'px', step: 0.1, showIf: modeIs('z'), hint: '45° chamfer on the band ends' }),
    P.float('round', 'Corner rounding', 0, 0, 1024, { softMax: 16, unit: 'px', step: 0.1, hint: 'Rounds convex corners (outer bends, ends)' }),
    P.float('outline', 'Outline', 0, 0, 1024, { softMax: 16, unit: 'px', step: 0.1, hint: '> 0 turns the shape into an inner outline this thick' }),
    P.enum('fill', 'Fill', 'band', [['band', 'Band'], ['between', 'Between bands'], ['above', 'Above the band'], ['below', 'Below the band']], { hint: 'Between: the lane interior minus the bands. Above / below (zig-zag only): just the panels on one side, e.g. a row of trapezoids' }),
    P.float('phase', 'Phase', 0, 0, 1, { step: 0.001, hint: 'Shift along the band, fraction of a repeat' }),
    P.bool('mirror', 'Mirror alternate rows', false, { hint: 'Flip every other lane across the band (hourglass / symmetric panels); rows are made even when tiling. Not for chevrons' }),
    P.enum('orient', 'Direction', '0', [['0', 'Horizontal'], ['90', 'Vertical'], ['180', 'Horizontal (flipped)'], ['270', 'Vertical (flipped)']]),
    P.seed(),
  ],
  defaults: {
    h_on: true,
    h_amount: 0.4,
    bevel: 2,
    profile: 'smooth',
    dif_on: true,
    dif_src: 'value',
    dif_grad: gradient('#6d6458', '#9c9284'),
  },
  glsl:
    geoGlsl(40) +
    /* glsl */ `
// Centre line of the current band (open polyline, px).
#define GEO_NC 16
vec2 geo_C[GEO_NC];
int geo_nc;
void geo_cl(vec2 v) {
  if (geo_nc > 0 && length(v - geo_C[geo_nc - 1]) < 1e-3) return;   // skip duplicates
  if (geo_nc < GEO_NC) { geo_C[geo_nc] = v; geo_nc++; }
}
// Left offset of centre-line vertex i (mitred).
vec2 geo_miter(int i, float hw) {
  vec2 e1 = i > 0 ? normalize(geo_C[i] - geo_C[i - 1]) : normalize(geo_C[1] - geo_C[0]);
  vec2 e2 = i < geo_nc - 1 ? normalize(geo_C[i + 1] - geo_C[i]) : e1;
  vec2 n1 = vec2(-e1.y, e1.x), n2 = vec2(-e2.y, e2.x);
  return hw * (n1 + n2) / max(1.0 + dot(n1, n2), 0.05);
}
// Outline polygon of the band (half-width hw) around the centre line, CCW, with optional 45° end chamfers.
void geo_bandPoly(float hw, float ch) {
  geo_begin();
  if (geo_nc < 2) { geo_ok = false; return; }
  ch = clamp(ch, 0.0, hw - 1e-3);
  vec2 e0 = normalize(geo_C[1] - geo_C[0]), n0 = vec2(-e0.y, e0.x);
  vec2 e1 = normalize(geo_C[geo_nc - 1] - geo_C[geo_nc - 2]), n1 = vec2(-e1.y, e1.x);
  vec2 A = geo_C[0], B = geo_C[geo_nc - 1];
  // start, right side
  if (ch > 0.0) geo_addPx(A - n0 * (hw - ch));
  geo_addPx(A - n0 * hw + e0 * ch);
  for (int i = 1; i < GEO_NC - 1; i++) { if (i >= geo_nc - 1) break; geo_addPx(geo_C[i] - geo_miter(i, hw)); }
  geo_addPx(B - n1 * hw - e1 * ch);
  if (ch > 0.0) { geo_addPx(B - n1 * (hw - ch)); geo_addPx(B + n1 * (hw - ch)); }
  geo_addPx(B + n1 * hw - e1 * ch);
  for (int i = GEO_NC - 2; i >= 1; i--) { if (i >= geo_nc - 1) continue; geo_addPx(geo_C[i] + geo_miter(i, hw)); }
  geo_addPx(A + n0 * hw + e0 * ch);
  if (ch > 0.0) geo_addPx(A + n0 * (hw - ch));
  geo_finish();
}

// Trapezoid-wave centre line over periods k0-1 .. k0+1 (+ closing point): low flat Fl, rise D, high flat Fh,
// fall D; starts each period at the start of the low flat.
void geo_wave(int k0, float P, float yl, float yh, float D, float Fl, float Fh) {
  geo_nc = 0;
  for (int k = -1; k <= 1; k++) {
    float x0 = float(k0 + k) * P;
    geo_cl(vec2(x0, yl));
    geo_cl(vec2(x0 + Fl, yl));
    geo_cl(vec2(x0 + Fl + D, yh));
    geo_cl(vec2(x0 + Fl + D + Fh, yh));
  }
  geo_cl(vec2(float(k0 + 2) * P, yl));
}

GenOut gen(vec2 p) {
  int mode = u_mode;
  geo_frame(p, 2 * u_orient);
  float kx = geo_count(float(u_count), 1);
  float ky = geo_count(float(u_rows), u_mirror ? 2 : 1);
  geo_periods(vec2(kx, ky));
  float P = geo_cs.x, Hl = geo_cs.y;
  int lane = int(floor(geo_f.y / Hl));
  float ly = geo_f.y - float(lane) * Hl;
  if (u_mirror && mode != 2 && (lane & 1) == 1) ly = Hl - ly;   // (chevrons overlap lanes: no mirroring)
  float x = geo_f.x - u_phase * P;
  float sgn = u_angle < 0.0 ? -1.0 : 1.0;
  x *= sgn;                                  // negative angles mirror along the band
  float ang = clamp(abs(u_angle), 1.0, 90.0);
  float s = ang >= 89.99 ? 1e6 : tan(radians(ang));
  float hw = 0.5 * u_width;
  float mt = u_margin_top, mb = u_margin_bottom;
  float r = clamp(u_round, 0.0, hw - 0.01);
  geo_s = vec2(1.0);
  geo_in = 0.0;
  geo_r = r;
  geo_reset();
  // The pixel in lane-local px (x along the band, y from the lane bottom).
  geo_f = vec2(x, ly);
  int laneW = uTile ? imod(lane, int(ky + 0.5)) : lane;
  int kxi = int(kx + 0.5);
  float yl = mb + hw, yh = Hl - mt - hw;
  float side = 0.0;   // signed vertical offset of the pixel from the zig-zag centre line (above > 0)
  float Rr = max(yh - yl, 0.0);

  if (mode == 0) {
    // Parallelogram bars spanning the lane interior; perpendicular thickness = width.
    float Hi = Hl - mt - mb;
    float sinA = sin(radians(ang));
    float wx = u_width / max(sinA, 1e-3);
    float run = Hi / s;
    bool through = mt <= 0.0 && mb <= 0.0;
    int nRun = 0;
    if (through && uTile) { nRun = int(floor(run / P + 0.5)); run = float(nRun) * P; }
    float ext = through ? hw + r + 2.0 : 0.0;
    float slope = Hi > 0.0 ? run / Hi : 0.0;         // x shift per px of height
    float yb = mb - ext, yt = Hl - mt + ext;
    geo_in = r;
    geo_begin();
    geo_addPx(vec2((yb - mb) * slope, yb));
    geo_addPx(vec2((yb - mb) * slope + wx, yb));
    geo_addPx(vec2((yt - mb) * slope + wx, yt));
    geo_addPx(vec2((yt - mb) * slope, yt));
    geo_finish();
    if (Hi > 0.0) {
      int k0 = int(floor((x - (ly - mb) * slope) / P));
      for (int dk = -1; dk <= 1; dk++) {
        int k = k0 + dk;
        int id = through ? k - nRun * lane : k;
        geo_try(vec2(float(k) * P, 0.0), 0, ivec2(imod(id, kxi), through ? 0 : laneW));
      }
    }
  } else if (mode == 1 || mode == 2) {
    float D, F, lo, hi, Fh;
    if (mode == 1) {
      // One band per lane between the margins; run splits the flats between the high and low runs.
      D = Rr / s;
      if (2.0 * D > P) D = 0.5 * P;
      F = P - 2.0 * D;
      Fh = F * clamp(u_run, 0.0, 1.0);
      lo = yl; hi = yh;
    } else {
      // Nested chevrons: amplitude from the slope, stacked every lane height.
      D = 0.5 * (1.0 - clamp(u_run, 0.0, 0.98)) * P;
      F = P - 2.0 * D;
      Fh = 0.5 * F;
      float A = min(s * D, 1e5);
      lo = 0.5 * (Hl - A); hi = lo + A;
    }
    float Fl = F - Fh;
    int k0 = int(floor(x / P));
    {
      float xm = x - float(k0) * P;
      float yc = xm < Fl ? lo : xm < Fl + D ? lo + (xm - Fl) / max(D, 1e-4) * (hi - lo)
               : xm < Fl + D + Fh ? hi : hi - (xm - Fl - D - Fh) / max(D, 1e-4) * (hi - lo);
      side = ly - yc;
    }
    if (mode == 1) {
      geo_wave(k0, P, lo, hi, D, Fl, Fh);
      geo_bandPoly(hw - r, 0.0);
      geo_try(vec2(0.0), 0, ivec2(laneW, 0));
    } else {
      for (int dl = -2; dl <= 2; dl++) {
        geo_wave(k0, P, lo + float(dl) * Hl, hi + float(dl) * Hl, D, Fl, Fh);
        geo_bandPoly(hw - r, 0.0);
        geo_try(vec2(0.0), 0, ivec2(uTile ? imod(lane + dl, int(ky + 0.5)) : lane + dl, 0));
      }
    }
  } else {
    // Z pieces: low run, rise, high run; one per repeat, chamfered ends.
    float D = min(Rr / s, 8.0 * P);
    float L = max(clamp(u_run, 0.0, 1.0) * P, 0.01);
    float span = 2.0 * L + D;
    geo_nc = 0;
    geo_cl(vec2(0.0, yl));
    geo_cl(vec2(L, yl));
    geo_cl(vec2(L + D, yh));
    geo_cl(vec2(span, yh));
    geo_bandPoly(hw - r, max(u_chamfer - 0.4142 * r, 0.0));
    int kLo = int(floor((x - span - u_width) / P));
    for (int i = 0; i < 12; i++) {
      int k = kLo + i;
      if (float(k) * P > x + u_width) break;
      geo_try(vec2(float(k) * P, 0.0), 0, ivec2(imod(k, kxi), laneW));
    }
  }

  float d = min(geo_bestD, 1e4);
  if (u_fill >= 1) {
    float dint = mode == 2 ? -1e4 : max(mb - ly, ly - (Hl - mt));
    d = max(-d, dint);
    // Above / below: drop the panels on the other side of the zig-zag centre line (the cut lies inside the
    // band, so it never shows).
    if (mode == 1 && u_fill == 2) d = max(d, -side);
    if (mode == 1 && u_fill == 3) d = max(d, side);
  }
  if (u_outline > 0.0) d = abs(d + 0.5 * u_outline) - 0.5 * u_outline;
  float rnd = hashI(geo_bestKey, uSeed);
  return genOut(0.0, 1.0, rnd, d);
}
`,
}
