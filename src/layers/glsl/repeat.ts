// The shared Repeat (FR8.33, docs/features/fr8.33-repeat-around-mask.md): the instances a layer with a Repeat card draws
// — on a grid, or along the outline of a mask or of the texture — and their variation (position jitter, turns and their
// steps, random flips, size, drop-out, their own random), worked out once for every family: shapes, Rosette and Glyph,
// Stamp and Label, Path, Tabs & notches. A family says how its grid is laid out (RepFrame, from its own grid params) and
// walks the candidates that can reach the pixel:
//
//   RepFrame f = repFrame(n, pitch, centre);   … and its other fields
//   RepSrc s = repBegin(p, f, ext);            ext: how far one instance reaches from its centre on each axis (px), at
//                                              repCellMax(f)
//   int n = repIters(s);
//   for (int k = 0; k < n; k++) { RepInst it = repNext(s); if (it.kept) { … its own distance round it.centre … } }
//
// One flat loop whose bound comes from the pixel, so D3D keeps one copy of the family's body (AGENTS.md › compile time),
// and no `continue`. The params it reads are the shared variation rows every Repeat card has (repeat.ts:
// u_rep_drop, u_rep_scale, u_rep_rot, u_rep_rot_step, u_rep_flip); the rest come through the frame.
//
// The outline side is compiled only in the MASK_REPEAT variant (LayerDef.shaderFeatures, from withRepeat): its
// instances are placed on the CPU (outline.ts) and sorted into the buckets of a grid; a pixel walks the buckets its
// reach covers. t_rep_bucket: row 0 a header — (buckets across, down, bucket width, height), (largest step, instances,
// −, −) — and rows 1… a bucket each, (first instance, count). t_rep_inst: two texels per instance, INST_ROW to a row —
// (x, y, the edge's direction (clockwise °), step), (index along its outline, outline, odd, −).

import { INST_ROW } from '../outline';

export const GLSL_REPEAT = /* glsl */ `
// How a family lays out its grid.
struct RepFrame {
  ivec2 n;        // instances across, down
  vec2 pitch;     // the step between neighbours (px, > 0)
  vec2 centre;    // the grid's centre (px)
  vec2 cell;      // the cell that sizes an instance (shapes' Inset from edges)
  float stagger;  // odd rows (counted from the top) move this far right (px): Row offset
  float skew;     // each row moves this far right per row down from the middle (px): Stamp's Row shift (with
                  // #define REP_SKEW before GLSL_REPEAT: the window then takes the rows' shifts into account)
  bvec2 mirror;   // odd columns / rows mirror the offset
  vec2 off;       // each instance's offset from its place on the grid (px): X / Y within a step
  float rot;      // Rotation (clockwise °)
  vec2 jitPx;     // Position jitter (px either way, per axis)
  float jitStep;  // Position jitter as a share of a step (half a step either way at 1)
  float near;     // the least reach, in steps: the neighbours a family always visits (motifs: a step and a half)
};
RepFrame repFrame(ivec2 n, vec2 pitch, vec2 centre) {
  vec2 pc = max(pitch, vec2(1e-3));
  return RepFrame(max(n, ivec2(1)), pc, centre, pc, 0.0, 0.0, bvec2(false), vec2(0.0), 0.0, vec2(0.0), 0.0, 1.0);
}

// One candidate instance.
struct RepInst {
  ivec2 id;       // which (its random comes from it): the grid cell, or (index along its outline, outline)
  vec2 centre;    // where (px, the copy round the torus nearest the pixel)
  float ang;      // its turn, clockwise (°): Rotation, the edge's direction (Follow the edge), Rotation variation
  float scale;    // its size (≤ 1): Size variation
  bvec2 flip;     // Flip at random: its local x, y mirrored
  float rnd;      // its own random (Diffuse jitter, Per-feature variation)
  bool kept;      // a real instance, not dropped out
  vec2 cell;      // the cell that sizes it: the grid's, or a step along its outline
  bool edge;      // placed along an outline
  bool odd;       // odd along its side or outline, or a checkerboard's odd cell
};

struct RepSrc {
  RepFrame f;
  vec2 p;
  bool outline;
  RepGrid rg;
  int iters;
  int k;
  // Along an outline: the first bucket, the buckets covered across / down, the canvas's buckets, a bucket's size, and the
  // walk — the next bucket, the next instance and the end of its bucket's run.
  ivec2 b0;
  ivec2 nb;
  ivec2 nbAll;
  vec2 bsz;
  int bi;
  int e;
  int eEnd;
};

int repIters(RepSrc s) { return s.iters; }

#ifdef MASK_REPEAT
vec4 repHead(int i) { return texelFetch(t_rep_bucket, ivec2(i, 0), 0); }
// The cell to measure an instance's reach at: the grid's, or the longest step along the outlines.
vec2 repCellMax(RepFrame f) { return u_rep_place != 0 ? vec2(repHead(1).x) : f.cell; }
// The table texel of the i-th bucket the pixel covers (wrapped round a tiling canvas).
ivec2 repBucketTexel(RepSrc s, int i) {
  int nx = max(s.nb.x, 1);
  ivec2 b = s.b0 + ivec2(i % nx, i / nx);
  return ivec2(imod(b.x, s.nbAll.x), imod(b.y, s.nbAll.y) + 1);
}
#else
vec2 repCellMax(RepFrame f) { return f.cell; }
#endif

RepSrc repBegin(vec2 p, RepFrame f, vec2 ext) {
  RepSrc s;
  s.f = f;
  s.p = p;
  s.outline = false;
  s.k = 0;
  s.b0 = ivec2(0);
  s.nb = ivec2(0);
  s.nbAll = ivec2(1);
  s.bsz = vec2(1.0);
  s.bi = 0;
  s.e = 0;
  s.eEnd = 0;
#ifdef MASK_REPEAT
  if (u_rep_place != 0) {
    s.outline = true;
    vec4 h = repHead(0);
    s.nbAll = max(ivec2(h.xy), ivec2(1));
    s.bsz = max(h.zw, vec2(1e-3));
    vec2 r = ext + f.jitPx + 0.5 * f.jitStep * repHead(1).x;
    ivec2 lo = ivec2(floor((p - r) / s.bsz)), hi = ivec2(floor((p + r) / s.bsz));
    if (!uTile) { lo = max(lo, ivec2(0)); hi = min(hi, s.nbAll - 1); }
    s.b0 = lo;
    // (Round a tiling canvas, each bucket once.)
    s.nb = clamp(hi - lo + 1, ivec2(0), s.nbAll);
    int nbk = s.nb.x * s.nb.y;
    int total = 0;
    for (int i = 0; i < nbk; i++) total += int(texelFetch(t_rep_bucket, repBucketTexel(s, i), 0).y);
    // A step per bucket entered, and one per instance in it.
    s.iters = nbk + total;
    s.rg = repGrid(ivec2(1), vec2(1.0), vec2(0.0), uRes, uTile, p, p);
    return s;
  }
#endif
  vec2 jit = f.jitPx + 0.5 * f.jitStep * f.pitch;
  // How far an instance's place can be from p and still reach it, and at least f.near steps.
  vec2 reach = max(ext + jit, f.near * f.pitch) + abs(f.off);
  // The rows' shifts: the window reaches left by the most any row it covers moves right, and right by the least.
  vec2 sh = vec2(0.0, f.stagger);
#ifdef REP_SKEW
  if (f.skew != 0.0 && f.n.y > 1) {
    RepGrid ry = repGrid(ivec2(1, f.n.y), f.pitch, f.centre, uRes, uTile, p - reach, p + reach);
    vec2 r = vec2(1e9, -1e9);
    for (int k = 0; k < repCount(ry); k++) {
      ivec2 c;
      vec2 pos;
      repAt(ry, k, c, pos);
      float x = (float(f.n.y - 1 - c.y) - 0.5 * float(f.n.y - 1)) * f.skew;
      r = vec2(min(r.x, x), max(r.y, x));
    }
    sh = vec2(r.x, r.y + f.stagger);
  }
#endif
  s.rg = repGrid(f.n, f.pitch, f.centre, uRes, uTile, p - reach - vec2(sh.y, 0.0), p + reach - vec2(sh.x, 0.0));
  s.iters = repCount(s.rg);
  return s;
}

// The next candidate. Its place and identity come from the grid or the outline; the variation is the same for both.
RepInst repNext(inout RepSrc s) {
  RepInst it;
  it.kept = true;
  it.edge = false;
  it.ang = s.f.rot;
  it.cell = s.f.cell;
  vec2 place;
  vec2 jit;
#ifdef MASK_REPEAT
  if (s.outline) {
    if (s.e >= s.eEnd) {
      // Into the next bucket: no instance this step.
      vec4 b = texelFetch(t_rep_bucket, repBucketTexel(s, s.bi), 0);
      s.bi++;
      s.e = int(b.x);
      s.eEnd = s.e + int(b.y);
      it.kept = false;
      it.id = ivec2(0);
      it.odd = false;
      place = s.p + vec2(1e6);
      jit = vec2(0.0);
    } else {
      int i = 2 * s.e;
      s.e++;
      vec4 a = texelFetch(t_rep_inst, ivec2(i % ${INST_ROW}, i / ${INST_ROW}), 0);
      vec4 b = texelFetch(t_rep_inst, ivec2((i + 1) % ${INST_ROW}, (i + 1) / ${INST_ROW}), 0);
      it.id = ivec2(b.xy);
      it.odd = b.z > 0.5;
      it.edge = true;
      it.cell = vec2(a.w);
      if (u_rep_follow) it.ang += a.z;
      place = s.p + wrapDelta(a.xy - s.p);
      jit = s.f.jitPx + 0.5 * s.f.jitStep * a.w;
    }
  } else
#endif
  {
    ivec2 c;
    vec2 pos;
    repAt(s.rg, s.k, c, pos);
    s.k++;
    // Rows count from the top, on the instance (the same on every copy round the torus, so the copies across an edge
    // match).
    int row = s.f.n.y - 1 - c.y;
    pos.x += (imod(row, 2) == 1 ? s.f.stagger : 0.0) + (float(row) - 0.5 * float(s.f.n.y - 1)) * s.f.skew;
    vec2 off = s.f.off;
    if (s.f.mirror.x && imod(c.x, 2) == 1) off.x = -off.x;
    if (s.f.mirror.y && imod(row, 2) == 1) off.y = -off.y;
    it.id = c;
    it.odd = imod(c.x + c.y, 2) == 1;
    place = pos + off;
    jit = s.f.jitPx + 0.5 * s.f.jitStep * s.f.pitch;
  }
  // Drop out, jitter and size, its random, a turn (snapped to Rotation steps), flips.
  it.kept = it.kept && hashI(it.id, uSeed + 3.0) >= u_rep_drop;
  vec3 h = hash3I(it.id, uSeed);
  it.rnd = hashI(it.id, uSeed + 7.0);
  it.centre = place + (h.xy - 0.5) * 2.0 * jit;
  it.scale = 1.0 - h.z * u_rep_scale;
  float jr = (hashI(it.id, uSeed + 5.0) - 0.5) * 2.0 * u_rep_rot;
  if (u_rep_rot_step > 0.0) jr = floor(jr / u_rep_rot_step + 0.5) * u_rep_rot_step;
  it.ang += jr;
  vec2 hf = hash3I(it.id, uSeed + 11.0).xy;
  it.flip = bvec2((u_rep_flip == 1 || u_rep_flip == 3) && hf.x < 0.5, (u_rep_flip == 2 || u_rep_flip == 3) && hf.y < 0.5);
  return it;
}
`;
