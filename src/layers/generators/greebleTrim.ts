// Trim (FR7.2d): horizontal (or vertical) moulding strips built from up to six stacked profiled bands,
// optionally mirrored about the centre line, with repeating dividers and a row of rivets / bolts / slots /
// holes along the strip. Made for the many 256×16 / 256×32 trim textures. See greebleCommon.ts for the
// relief / SDF output convention.

import { P, gradient, type ParamDef } from '@/core/params'
import type { LayerDef } from '../types'
import { GRB_GLSL, ORIENT } from './greebleCommon'

export const BAND_PROFILES: [string, string][] = [
  ['flat', 'Flat'],
  ['bead', 'Bead (half round)'],
  ['cove', 'Cove (concave channel)'],
  ['ridge', 'Ridge (peak)'],
  ['groove', 'Groove (V notch)'],
  ['step', 'Step (bevelled plateau)'],
  ['ramp_in', 'Chamfer rising inward'],
  ['ramp_out', 'Chamfer falling inward'],
]

const BAND_DEFAULTS: [number, string, number][] = [
  [1, 'flat', 0.1],
  [2, 'bead', 0.9],
  [1, 'flat', 0.45],
  [4, 'flat', 0.7],
  [0, 'flat', 0.5],
  [0, 'flat', 0.5],
]

const bandParams: ParamDef[] = BAND_DEFAULTS.flatMap(([h, prof, lvl], i) => {
  const n = i + 1
  const on = (p: Record<string, unknown>) => Number(p[`band${n}`]) > 0 || Number(p.fill) === n
  return [
    P.int(`band${n}`, `Band ${n}`, h, 0, 1024, { softMax: 32, unit: 'px', group: 'bands', hint: n === 1 ? 'Band heights from the outer edge (top, or both edges when mirrored); 0 = unused' : undefined }),
    P.enum(`prof${n}`, `Band ${n} profile`, prof, BAND_PROFILES, { group: 'bands', showIf: on }),
    P.float(`level${n}`, `Band ${n} level`, lvl, 0, 1, { step: 0.001, group: 'bands', showIf: on }),
  ]
})

const hasDiv = (p: Record<string, unknown>) => Number(p.div_count) > 0
const hasElem = (p: Record<string, unknown>) => p.elem !== 'none'

export const trimLayer: LayerDef = {
  type: 'trim',
  label: 'Trim strip',
  category: 'pattern',
  kind: 'generator',
  sdf: true,
  description: 'Moulding / trim strip: stacked profiled bands (bead, cove, groove, step…), dividers and a row of rivets, bolts, slots or holes. Tileable.',
  params: [
    P.enum('output', 'Output', 'relief', [
      ['relief', 'Relief (all, value)'],
      ['blocks', 'Blocks between dividers (shape)'],
      ['dividers', 'Dividers (shape)'],
      ['elements', 'Rivets / slots (shape)'],
      ['band', 'One band (shape)'],
    ], { hint: 'Relief composes bands, dividers and elements into one height value. Shapes give one element class as an SDF' }),
    P.enum('orient', 'Direction', 'horizontal', ORIENT),
    P.bool('mirror', 'Mirror', true, { hint: 'Bands run from both edges to the centre line' }),
    P.int('fill', 'Stretch band', 4, 0, 6, { hint: 'This band grows to fill the remaining height (0 = none: the last band\'s level continues)' }),
    P.int('sel_band', 'Band (output)', 1, 1, 6, { showIf: (p) => p.output === 'band' }),
    P.seed(),
    ...bandParams,
    P.int('div_count', 'Dividers', 0, 0, 256, { softMax: 32, group: 'dividers', hint: 'Dividers along the tile (blocks between them get their own random)' }),
    P.enum('div_style', 'Style', 'groove', [['groove', 'Groove (bevelled blocks)'], ['seam', 'Seam line'], ['bar', 'Raised bar']], { group: 'dividers', showIf: hasDiv }),
    P.float('div_width', 'Width', 1, 0, 64, { softMax: 8, unit: 'px', step: 0.5, group: 'dividers', showIf: hasDiv }),
    P.float('div_inset', 'Inset', 0, 0, 512, { softMax: 16, unit: 'px', step: 0.5, group: 'dividers', showIf: hasDiv, hint: 'Gap between the divider ends and the strip edges' }),
    P.float('div_offset', 'Offset', 0, 0, 1, { step: 0.001, group: 'dividers', showIf: hasDiv }),
    P.enum('elem', 'Element', 'rivet', [
      ['none', 'None'],
      ['rivet', 'Rivet'],
      ['bolt', 'Bolt (ringed)'],
      ['slot', 'Slot (along)'],
      ['vslot', 'Slot (across)'],
      ['hole', 'Round hole'],
      ['square', 'Square hole'],
    ], { group: 'elements' }),
    P.enum('elem_layout', 'Spacing', 'even', [['even', 'Even along the tile'], ['block', 'Within each block']], { group: 'elements', showIf: hasElem, hint: 'Within each block: Count elements from Inset to Inset between dividers' }),
    P.int('elem_count', 'Count', 8, 1, 512, { softMax: 64, group: 'elements', showIf: hasElem, hint: 'Per row along the tile (or per block)' }),
    P.float('elem_inset', 'Inset', 4, 0, 512, { softMax: 32, unit: 'px', step: 0.5, group: 'elements', showIf: (p) => hasElem(p) && p.elem_layout === 'block', hint: 'Block edge to the first / last element centre' }),
    P.float('elem_size', 'Radius', 1.5, 0.5, 64, { softMax: 8, unit: 'px', step: 0.5, group: 'elements', showIf: hasElem, hint: 'Radius, or half the slot / square width' }),
    P.float('elem_len', 'Slot length', 6, 1, 256, { softMax: 32, unit: 'px', step: 0.5, group: 'elements', showIf: (p) => p.elem === 'slot' || p.elem === 'vslot' }),
    P.float('elem_y', 'Position', 0.5, 0, 1, { step: 0.001, group: 'elements', showIf: hasElem, hint: 'Centre of the rows across the strip, 0 = top (left) edge' }),
    P.int('elem_rows', 'Rows', 1, 1, 64, { softMax: 8, group: 'elements', showIf: hasElem }),
    P.float('elem_row_gap', 'Row spacing', 8, 0, 512, { softMax: 32, unit: 'px', step: 0.5, group: 'elements', showIf: (p) => hasElem(p) && Number(p.elem_rows) > 1 }),
    P.bool('elem_stagger', 'Stagger rows', false, { group: 'elements', showIf: (p) => hasElem(p) && Number(p.elem_rows) > 1 && p.elem_layout !== 'block', hint: 'Shift alternate rows half a step' }),
    P.float('elem_offset', 'Offset', 0, 0, 1, { step: 0.001, group: 'elements', showIf: (p) => hasElem(p) && p.elem_layout !== 'block' }),
    P.float('elem_height', 'Height', 0.3, 0, 1, { step: 0.001, group: 'elements', showIf: hasElem, hint: 'Rivet / bolt dome height (relief)' }),
  ],
  groups: [
    { id: 'bands', label: 'Bands' },
    { id: 'dividers', label: 'Dividers', collapsed: true },
    { id: 'elements', label: 'Elements' },
  ],
  defaults: {
    h_on: true,
    h_amount: 0.6,
    bevel: 1,
    profile: 'linear',
    dif_on: true,
    dif_src: 'value',
    dif_jitter: 0.08,
    dif_grad: gradient('#14110e', '#3e352b', '#5d5141', '#7d6c55', '#a08b6c'),
  },
  glsl:
    GRB_GLSL +
    /* glsl */ `
// Band shape 0..1 at t (0 = outer edge, 1 = inner edge); y = px from the band's outer edge, h = band px.
float grb_bandShape(int prof, float t, float y, float h) {
  float x = 2.0 * t - 1.0;
  if (prof == 0) return 1.0;
  if (prof == 1) return sqrt(max(1.0 - x * x, 0.0));
  if (prof == 2) return 1.0 - sqrt(max(1.0 - x * x, 0.0));
  if (prof == 3) return 1.0 - abs(x);
  if (prof == 4) return min(abs(x) * 2.0, 1.0);
  if (prof == 5) return grb_rise(-min(y, h - y), u_bevel);
  if (prof == 6) return t;
  return 1.0 - t;
}

float grb_elemSdf(int kind, vec2 d, float r) {
  if (kind == 1 || kind == 5) return length(d) - r;
  if (kind == 2) return length(d) - (r + 1.5);
  if (kind == 3) return sdRoundBox(d, vec2(0.5 * u_elem_len, r), vec4(r));
  if (kind == 4) return sdRoundBox(d, vec2(r, 0.5 * u_elem_len), vec4(r));
  return sdBox(d, vec2(r));
}

GenOut gen(vec2 p) {
  bool vert = u_orient == 1;
  // s: along the strip (left → right, or top → bottom); a: across, from the top (or left) edge.
  float s = vert ? uRes.y - p.y : p.x;
  float a = vert ? p.x : uRes.y - p.y;
  float LA = vert ? uRes.y : uRes.x;
  float A = vert ? uRes.x : uRes.y;

  float bh[6] = float[6](float(u_band1), float(u_band2), float(u_band3), float(u_band4), float(u_band5), float(u_band6));
  int bp[6] = int[6](u_prof1, u_prof2, u_prof3, u_prof4, u_prof5, u_prof6);
  float bl[6] = float[6](u_level1, u_level2, u_level3, u_level4, u_level5, u_level6);

  float avail = u_mirror ? 0.5 * A : A;
  float y = u_mirror ? min(a, A - a) : a;
  int fill = u_fill - 1;
  float others = 0.0;
  for (int i = 0; i < 6; i++) if (i != fill) others += max(bh[i], 0.0);
  if (fill >= 0) bh[fill] = max(bh[fill], avail - others);

  // Band under the pixel.
  float y0 = 0.0, y1 = 0.0;
  int bi = -1, last = -1;
  for (int i = 0; i < 6; i++) {
    if (bh[i] <= 0.0 || bi >= 0) continue;
    last = i;
    if (y < y0 + bh[i]) { bi = i; y1 = y0 + bh[i]; }
    else y0 += bh[i];
  }
  float v;
  if (bi < 0) v = last >= 0 ? bl[last] : 0.0;   // past the last band: its level continues
  else {
    float h = y1 - y0, yy = y - y0;
    // Mirrored: a band reaching the centre line joins its mirror image into one band (a centre bead is
    // one half-round, a centre step has no seam), except the chamfers, which make a roof / valley.
    if (u_mirror && y1 >= avail - 1e-3 && bp[bi] < 6) { h = A - 2.0 * y0; yy = a - y0; }
    v = bl[bi] * grb_bandShape(bp[bi], yy / h, yy, h);
  }

  // Selected band region (both mirrored copies).
  float dBand = 1e4;
  {
    int sel = u_sel_band - 1;
    float b0 = 0.0;
    for (int i = 0; i < 6; i++) {
      if (bh[i] <= 0.0) continue;
      if (i == sel) { dBand = max(b0 - y, y - (b0 + bh[i])); break; }
      b0 += bh[i];
    }
  }

  // ---- dividers: leading edges on whole px, blocks between them
  float edgeD = -min(a, A - a);
  float dDiv = 1e4, dBlk = edgeD;
  float blkRnd = hashI(ivec2(0, 1), uSeed);
  float blo = 0.0, bhi = LA;   // extent of the block under the pixel (along)
  int kbi = 0;
  if (u_div_count > 0) {
    float sp = LA / float(u_div_count);
    float w = max(u_div_width, 0.0);
    float k0 = floor(s / sp - u_div_offset);
    float xa = floor((k0 + u_div_offset) * sp + 0.5);
    float xb = floor((k0 + 1.0 + u_div_offset) * sp + 0.5);
    float kb = k0, b0 = xa, b1 = xb;
    if (s < xa) { kb = k0 - 1.0; b0 = floor((k0 - 1.0 + u_div_offset) * sp + 0.5); b1 = xa; }
    else if (s >= xb) { kb = k0 + 1.0; b0 = xb; b1 = floor((k0 + 2.0 + u_div_offset) * sp + 0.5); }
    float dd = min(abs(s - (b0 + 0.5 * w)), abs(s - (b1 + 0.5 * w))) - 0.5 * w;
    float span = abs(a - 0.5 * A) - (0.5 * A - u_div_inset);
    dDiv = max(dd, span);
    dBlk = max(max(b0 + w - s, s - b1), edgeD);
    blo = b0 + w; bhi = b1;
    kbi = int(kb);
    blkRnd = hashI(ivec2(uTile ? imod(kbi, u_div_count) : kbi, 1), uSeed);
    if (u_div_style == 0) v *= grb_rise(-dDiv, u_bevel);
    else if (u_div_style == 1) v = mix(v, 0.0, grb_cov(dDiv));
    else v = mix(v, 1.0, grb_rise(dDiv, u_bevel));
  }

  // ---- elements: rows along the strip, spaced evenly along the tile or within each block
  float dE = 1e4, eRnd = 0.0;
  vec2 eLoc = vec2(1e4);
  if (u_elem > 0) {
    int ne = max(u_elem_count, 1);
    int nr = max(u_elem_rows, 1);
    float r = max(u_elem_size, 0.5);
    vec2 fp = u_elem == 3 ? vec2(u_elem_len, 2.0 * r) : u_elem == 4 ? vec2(2.0 * r, u_elem_len) : vec2(2.0 * r);
    float rg = u_elem_row_gap;
    float a0 = u_elem_y * A - 0.5 * float(nr - 1) * rg;
    int j0 = nr > 1 && rg > 0.0 ? int(clamp(floor((a - a0) / rg + 0.5), 0.0, float(nr - 1))) : 0;
    bool perBlock = u_elem_layout == 1;
    float lo = blo + u_elem_inset, hi = bhi - u_elem_inset;
    float se = perBlock ? (ne > 1 ? (hi - lo) / float(ne - 1) : 0.0) : LA / float(ne);
    for (int jj = -1; jj <= 1; jj++) {
      int row = j0 + jj;
      if (row < 0 || row >= nr) continue;
      float ay = grb_snapC(a0 + float(row) * rg, fp.y);
      float off = u_elem_offset + ((row & 1) == 1 && u_elem_stagger ? 0.5 : 0.0);
      float k0 = perBlock ? (ne > 1 ? clamp(floor((s - lo) / max(se, 1e-3) + 0.5), 0.0, float(ne - 1)) : 0.0) : floor(s / se - off);
      for (int i = -1; i <= 1; i++) {
        float k = k0 + float(i);
        float sx;
        if (perBlock) {
          if (k < 0.0 || k > float(ne - 1)) continue;
          sx = ne > 1 ? lo + k * se : 0.5 * (blo + bhi);
        } else sx = (k + off + 0.5) * se;
        sx = grb_snapC(sx, fp.x);
        vec2 dl = vec2(s - sx, a - ay);
        float d = grb_elemSdf(u_elem, dl, r);
        if (d < dE) {
          dE = d; eLoc = dl;
          int ki = perBlock ? kbi * 64 + int(k) : (uTile ? imod(int(k), ne) : int(k));
          eRnd = hashI(ivec2(ki, row), uSeed + 9.0);
        }
      }
    }
    if (u_elem == 1) v += u_elem_height * grb_dome(length(eLoc), r);
    else if (u_elem == 2) {
      float ring = abs(length(eLoc) - (r + 0.75)) - 0.75;
      v -= 0.5 * u_elem_height * grb_cov(ring);
      v += u_elem_height * grb_dome(length(eLoc), r);
    } else v = mix(v, 0.0, grb_cov(dE));
  }

  if (u_output == 0) return genOut(clamp(v, 0.0, 1.0), 1.0, blkRnd, NO_SDF);
  if (u_output == 1) return genOut(0.0, 1.0, blkRnd, dBlk);
  if (u_output == 2) return genOut(0.0, 1.0, blkRnd, dDiv);
  if (u_output == 3) return genOut(0.0, 1.0, eRnd, dE);
  return genOut(0.0, 1.0, blkRnd, dBand);
}
`,
}
