// Helpers shared by the filter layers: the distance-source params (bevel / etch), a separable Gaussian
// blur into scratch targets (cavity, height-from-diffuse) and the matching GLSL.

import * as THREE from 'three'
import { P, type ParamDef, type ParamValues } from '@/core/params'
import { jumpFlood } from '@/gpu/jfa'
import type { FilterContext } from '@/render/materialPipeline'

/** Mask sources for distance-based filters; order matches DISTANCE_SOURCE in gpu/jfa.ts. */
export const DISTANCE_SOURCES: [string, string][] = [
  ['height', 'Height above threshold'],
  ['opacity', 'Opacity above threshold'],
  ['luminance', 'Luminance above threshold'],
  ['shape', 'Shape register (exact)'],
]

/** Contour relaxation for thresholded (jump-flood) sources; see DistanceFieldOptions.relax. */
export const SMOOTH_PARAM: ParamDef = P.float('smooth', 'Edge smoothing', 3, 0, 6, {
  unit: 'px',
  step: 0.01,
  showIf: (p) => p.source !== 'shape',
  hint: 'Fits the thresholded edge to a smooth line (keeps corners): hides faceting on wide bevels. 0 = follow pixel steps exactly',
})

export const SOURCE_PARAMS: ParamDef[] = [
  P.enum('source', 'Source', 'height', DISTANCE_SOURCES, {
    hint: 'What defines the edge: a thresholded channel (jump-flood distance) or the shape register written by SDF layers',
  }),
  P.float('threshold', 'Threshold', 0.5, -16, 16, {
    softMin: 0,
    softMax: 1,
    step: 0.001,
    showIf: (p) => p.source !== 'shape',
    hint: 'Inside = source value above this',
  }),
]

/** Gaussian σ for a blur "radius" (the kernel reaches ~1.5 × radius, i.e. 3σ). */
export const radiusToSigma = (radius: number) => Math.max(radius, 0) * 0.5
/** Hard cap on the taps either side of a separable blur pass. */
export const MAX_BLUR_TAPS = 192

/** GLSL: Gaussian weight and tap count for σ = uSigma (declared by the caller). */
export const GLSL_GAUSS = /* glsl */ `
int gaussTaps(float sigma) { return min(int(ceil(sigma * 3.0)), ${MAX_BLUR_TAPS}); }
float gaussK(float sigma) { return -0.5 / max(sigma * sigma, 1e-6); }
`

const BLUR4 = /* glsl */ `
${GLSL_GAUSS}
uniform sampler2D tSrc;
uniform vec2 uDir;
uniform float uSigma;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 dir = ivec2(uDir);
  int R = gaussTaps(uSigma);
  float k = gaussK(uSigma);
  vec4 sum = vec4(0.0);
  float ws = 0.0;
  for (int i = -R; i <= R; i++) {
    float w = exp(float(i * i) * k);
    sum += w * fetchT(tSrc, c + dir * i);
    ws += w;
  }
  oColor = sum / ws;
}
`

/**
 * Separable Gaussian blur of all four components of `src` (wrap-aware) into a scratch target, which is
 * returned. `name` prefixes the two scratch targets used.
 */
export function blurTexture(ctx: FilterContext, src: THREE.Texture, radius: number, name: string): THREE.WebGLRenderTarget {
  const sigma = radiusToSigma(radius)
  const h = ctx.scratch(`${name}:h`)
  const v = ctx.scratch(`${name}:v`)
  const mat = ctx.material('blur4', BLUR4, {
    tSrc: { value: null },
    uDir: { value: new THREE.Vector2(1, 0) },
    uSigma: { value: 1 },
  })
  mat.uniforms.uSigma.value = Math.max(sigma, 1e-3)
  mat.uniforms.tSrc.value = src
  ;(mat.uniforms.uDir.value as THREE.Vector2).set(1, 0)
  ctx.run(mat, h)
  mat.uniforms.tSrc.value = h.texture
  ;(mat.uniforms.uDir.value as THREE.Vector2).set(0, 1)
  ctx.run(mat, v)
  return v
}

export function sourceIndex(params: ParamValues): number {
  const i = DISTANCE_SOURCES.findIndex(([v]) => v === params.source)
  return i < 0 ? 0 : i
}

/**
 * Signed distance (px, negative inside) of the layer's `source`/`threshold` mask: a jump-flood field in a
 * scratch target, or null when the source is the shape register (read `S.a` directly — it is exact).
 */
export function sourceDistance(ctx: FilterContext, params: ParamValues, maxDistance: number, invert = false): THREE.Texture | null {
  const source = sourceIndex(params)
  if (source === 3) return null
  return jumpFlood(ctx, {
    source,
    threshold: Number(params.threshold ?? 0.5),
    invert,
    maxDistance,
    relax: Number(params.smooth ?? 0),
  }).texture
}

/** GLSL: the signed distance at a texel from `tDist` or the shape register (u_source == 3). */
export const GLSL_SOURCE_DIST = /* glsl */ `
uniform sampler2D tDist;
float sourceDist(ivec2 ip, vec4 S, bool invert) {
  if (u_source == 3) return invert ? -S.a : S.a;
  return texelFetch(tDist, ip, 0).r;
}
`
