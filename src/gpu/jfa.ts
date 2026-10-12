// Jump-flood signed distance field (docs/features/fr2.5-filter-layers.md).
//
// A mask is derived from the current material state (height / opacity / diffuse luminance above a threshold,
// or the sign of the shape register). Boundary texels seed the flood with a sub-pixel estimate of where the
// iso-line crosses between them and their opposite-mask 4-neighbours (linear interpolation of the source
// value, combined into the perpendicular foot when the edge crosses on both axes), so the result is smooth on
// diagonals and exact (±0.5 px) on hard pixel steps. ~log2(size) flood passes then find each texel's nearest
// boundary point; distances are toroidal on tileable projects (wrapDelta + wrapped fetches) and clamped
// otherwise. The sign comes from the mask: negative inside, like every SDF in the app.
//
// A thresholded hard edge (aliased, or anti-aliased by a generator) only pins each seed to ~±0.4 px, and that
// per-seed noise projects radially as faint facets on wide bevels of curves. An optional relax pass moves each
// seed onto a line fitted (PCA) to its neighbours along the contour, fading out at corners. The flood then
// finds the nearest seed, and the final pass measures the distance to the chords between that seed and its
// neighbouring texels' seeds (a piecewise-linear contour) rather than to the seed point alone.
//
// Output target (float RGBA): r = signed distance in px, gb = nearest boundary seed (GL px, possibly in a
// neighbouring torus copy), a = 1 if a boundary point was found (else r = ±1e4).

import * as THREE from 'three'
import type { FilterContext } from '@/render/materialPipeline'

/** Mask sources, in the order of the filters' `source` enum. */
export const DISTANCE_SOURCE = {
  height: 0,
  opacity: 1,
  luminance: 2,
  shape: 3,
} as const

export interface DistanceFieldOptions {
  /** 0 height, 1 opacity, 2 diffuse luminance (perceptual, sRGB), 3 shape register sign. */
  source: number
  /** Inside = value above this (ignored for the shape register, which is inside where < 0). */
  threshold: number
  /** Swap inside and outside. */
  invert?: boolean
  /**
   * Largest distance (px) the caller cares about. Fewer flood passes are run; texels farther than this
   * from any boundary get a distance ≥ maxDistance (possibly the ±1e4 sentinel), never a smaller one.
   */
  maxDistance?: number
  /**
   * Contour relaxation radius (px): fits a line through the boundary seeds within this radius and moves each
   * seed onto it (not at corners). Hides the faceting of hard-edged sources on wide bevels; 0 = off
   * (pixel-exact steps). 3–4 removes faceting on curves; capped at 6.
   */
  relax?: number
  /** Scratch-target name prefix (defaults to 'jfa'). */
  name?: string
}

/** GLSL: the thresholded source value at a texel (> 0 inside). Shared with filters that need the mask. */
export const GLSL_JFA_SOURCE = /* glsl */ `
uniform int uJfaSource;
uniform float uJfaThreshold;
uniform bool uJfaInvert;

float jfaValue(ivec2 c) {
  float v;
  if (uJfaSource == 0) v = fetchT(tSurface, c).r - uJfaThreshold;
  else if (uJfaSource == 1) v = fetchT(tAlbedo, c).a - uJfaThreshold;
  else if (uJfaSource == 2) v = luma(linearToSrgb(fetchT(tAlbedo, c).rgb)) - uJfaThreshold;
  else v = -fetchT(tSurface, c).a;
  return uJfaInvert ? -v : v;
}
`

const SEED = /* glsl */ `
${GLSL_JFA_SOURCE}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float s0 = jfaValue(c);
  bool in0 = s0 > 0.0;
  float tx = 2.0, ty = 2.0, sx = 0.0, sy = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 e = k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : ivec2(0, -1);
    // Without tiling, fetches clamp at the border, so the image edge never counts as a boundary.
    ivec2 n = c + e;
    if (!uTile && (n.x < 0 || n.y < 0 || n.x >= int(uRes.x) || n.y >= int(uRes.y))) continue;
    float sn = jfaValue(n);
    if ((sn > 0.0) == in0) continue;
    float t = clamp(s0 / (s0 - sn), 0.0, 1.0);
    if (e.x != 0) { if (t < tx) { tx = t; sx = float(e.x); } }
    else if (t < ty) { ty = t; sy = float(e.y); }
  }
  // Seeds: rg = boundary point (px), ba = the texel that produced it (-1 = no seed).
  if (tx > 1.0 && ty > 1.0) { oColor = vec4(0.0, 0.0, -1.0, -1.0); return; }
  vec2 foot;
  if (ty > 1.0) foot = vec2(sx * tx, 0.0);
  else if (tx > 1.0) foot = vec2(0.0, sy * ty);
  else if (tx < 1e-4 || ty < 1e-4) foot = vec2(0.0);
  else {
    // Foot of the perpendicular onto the line through both axis crossings.
    float a = sx * tx, b = sy * ty;
    float k = 1.0 / (1.0 / (a * a) + 1.0 / (b * b));
    foot = k * vec2(1.0 / a, 1.0 / b);
  }
  oColor = vec4(gl_FragCoord.xy + foot, vec2(c));
}
`

const STEP = /* glsl */ `
uniform sampler2D tJfa;
uniform float uJfaStep;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 p = gl_FragCoord.xy;
  vec4 best = texelFetch(tJfa, c, 0);
  float bd = 1e20;
  if (best.b >= 0.0) { vec2 d = wrapDelta(best.xy - p); bd = dot(d, d); }
  int k = int(uJfaStep);
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    vec4 s = fetchT(tJfa, c + ivec2(i, j) * k);
    if (s.b < 0.0) continue;
    vec2 d = wrapDelta(s.xy - p);
    float dd = dot(d, d);
    if (dd < bd) { bd = dd; best = s; }
  }
  oColor = best;
}
`

const FINAL = /* glsl */ `
${GLSL_JFA_SOURCE}
uniform sampler2D tJfa;
uniform sampler2D tSeed;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(tJfa, c, 0);
  float sgn = jfaValue(c) > 0.0 ? -1.0 : 1.0;
  if (s.b < 0.0) { oColor = vec4(sgn * 1e4, 0.0, 0.0, 0.0); return; }
  vec2 a = wrapDelta(s.xy - gl_FragCoord.xy);
  float d = length(a);
  // Distance to the chords from the nearest seed to its neighbouring texels' seeds (short ones only, so
  // seeds on the far side of a thin gap are not joined).
  ivec2 cs = ivec2(s.ba);
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    vec4 n = fetchT(tSeed, cs + ivec2(i, j));
    if (n.b < 0.0) continue;
    vec2 b = wrapDelta(n.xy - gl_FragCoord.xy);
    vec2 ab = b - a;
    if (dot(ab, ab) > 2.25) continue;
    d = min(d, sdSegment(vec2(0.0), a, b));
  }
  oColor = vec4(sgn * d, s.xy, 1.0);
}
`

const RELAX = /* glsl */ `
uniform sampler2D tSeed;
uniform float uRelax;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(tSeed, c, 0);
  if (s.b < 0.0) { oColor = s; return; }
  int R = int(ceil(uRelax));
  float r2 = uRelax * uRelax;
  vec2 m = vec2(0.0);
  vec3 m2 = vec3(0.0);
  float ws = 0.0;
  for (int j = -R; j <= R; j++)
  for (int i = -R; i <= R; i++) {
    vec4 n = fetchT(tSeed, c + ivec2(i, j));
    if (n.b < 0.0) continue;
    vec2 q = wrapDelta(n.xy - s.xy);
    float qq = dot(q, q);
    if (qq > r2 + 0.5) continue;
    float w = exp(-2.0 * qq / r2);
    m += w * q;
    m2 += w * vec3(q.x * q.x, q.x * q.y, q.y * q.y);
    ws += w;
  }
  m /= ws;
  vec3 C = m2 / ws - vec3(m.x * m.x, m.x * m.y, m.y * m.y);
  // Principal axis of the neighbours' covariance [[C.x, C.y], [C.y, C.z]] = the local contour direction.
  float tr = C.x + C.z;
  float disc = sqrt(max(0.25 * tr * tr - (C.x * C.z - C.y * C.y), 0.0));
  float l1 = 0.5 * tr + disc, l2 = 0.5 * tr - disc;
  vec2 t = abs(C.y) > 1e-8 ? normalize(vec2(l1 - C.z, C.y)) : (C.x >= C.z ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 nrm = vec2(-t.y, t.x);
  // Only where the neighbourhood is line-like (not at corners or around isolated specks).
  float lineness = 1.0 - smoothstep(0.08, 0.25, l2 / max(l1, 1e-6));
  s.xy += nrm * clamp(dot(m, nrm), -0.5, 0.5) * lineness;
  oColor = s;
}
`

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

function setSource(mat: THREE.RawShaderMaterial, opts: DistanceFieldOptions): void {
  const u = mat.uniforms
  u.uJfaSource.value = opts.source
  u.uJfaThreshold.value = opts.threshold
  u.uJfaInvert.value = Boolean(opts.invert)
}

const sourceUniforms = () => ({
  uJfaSource: { value: 0 },
  uJfaThreshold: { value: 0 },
  uJfaInvert: { value: false },
})

/**
 * Compute the signed distance field of the thresholded source into a scratch target and return it.
 * The target stays valid until the next jump flood with the same name (or a pipeline resize).
 */
export function jumpFlood(ctx: FilterContext, opts: DistanceFieldOptions): THREE.WebGLRenderTarget {
  const name = opts.name ?? 'jfa'
  const seeds = ctx.scratch(`${name}:seed`)
  const ping = ctx.scratch(`${name}:a`)
  const pong = ctx.scratch(`${name}:b`)
  const out = ctx.scratch(`${name}:dist`)

  const seedMat = ctx.material('jfa:seed', SEED, sourceUniforms())
  setSource(seedMat, opts)
  ctx.run(seedMat, seeds)

  let seedTex = seeds
  const relax = Math.min(6, Math.max(0, opts.relax ?? 0))
  if (relax > 0.25) {
    seedTex = ctx.scratch(`${name}:relax`)
    const relaxMat = ctx.material('jfa:relax', RELAX, { tSeed: { value: null }, uRelax: { value: 1 } })
    relaxMat.uniforms.tSeed.value = seeds.texture
    relaxMat.uniforms.uRelax.value = relax
    ctx.run(relaxMat, seedTex)
  }

  // Largest useful step: half the (power-of-two) texture size, or just enough to reach maxDistance.
  const full = Math.max(1, nextPow2(Math.max(ctx.width, ctx.height)) / 2)
  const limit = opts.maxDistance !== undefined ? nextPow2(Math.max(1, Math.ceil(opts.maxDistance))) : full
  const steps: number[] = []
  for (let k = Math.min(full, limit); k >= 1; k = Math.floor(k / 2)) steps.push(k)
  steps.push(1) // JFA+1: one extra unit step fixes most of the flood's rare misses.

  const stepMat = ctx.material('jfa:step', STEP, { tJfa: { value: null }, uJfaStep: { value: 1 } })
  let src = seedTex
  let dst = ping
  for (const k of steps) {
    stepMat.uniforms.tJfa.value = src.texture
    stepMat.uniforms.uJfaStep.value = k
    ctx.run(stepMat, dst)
    src = dst
    dst = dst === ping ? pong : ping
  }

  const finalMat = ctx.material('jfa:final', FINAL, { ...sourceUniforms(), tJfa: { value: null }, tSeed: { value: null } })
  setSource(finalMat, opts)
  finalMat.uniforms.tJfa.value = src.texture
  finalMat.uniforms.tSeed.value = seedTex.texture
  ctx.run(finalMat, out)

  return out
}
