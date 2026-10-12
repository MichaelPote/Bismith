// Supersampling (render.supersample, FR8.7): the material stack and the path tracer run at k× the texture size and
// the traced image is box-filtered down before the post stack — fine features (1 px highlights, thin joints, small
// holes) are computed at k× and averaged instead of being decided by a single sample per texel.
//
// scaleProject builds the k× project: every pixel-unit parameter (ParamDef unit 'px': bevels, joints, radii, widths,
// white-noise block sizes, stamp pixel sizes …) is multiplied by k, so the pattern keeps its size in texture pixels;
// world height per height unit (heightDepth) scales too, so slopes stay the same. Post filters run after the
// downsample, at the real size, and are left alone.

import type { Project } from './project'
import { layerParamDefs } from '@/layers/registry'
import { LIGHT_DEFS } from './lights'

export const MAX_SUPERSAMPLE = 4

export function supersampleFactor(p: Project): number {
  const k = Math.round(Number(p.render.supersample ?? 1))
  return Number.isFinite(k) ? Math.min(MAX_SUPERSAMPLE, Math.max(1, k)) : 1
}

/** Scale the numbers of a vertex list ("x,y x,y …") by k. */
function scalePoints(src: string, k: number): string {
  return src.replace(/-?\d*\.?\d+(?:e-?\d+)?/gi, (n) => String(Number(n) * k))
}

/** The project at k× resolution (a copy; k = 1 returns the input). */
export function scaleProject(p: Project, k: number): Project {
  if (k <= 1) return p
  const q: Project = JSON.parse(JSON.stringify(p))
  q.width *= k
  q.height *= k
  q.heightDepth *= k
  q.render.aoRadius *= k
  q.render.supersample = 1
  for (const l of q.layers) {
    for (const d of layerParamDefs(l.type)) {
      const v = l.params[d.key]
      if (typeof v === 'number' && d.unit === 'px') l.params[d.key] = v * k
      else if (typeof v === 'string' && d.bitmap === 'points' && l.params.units !== 'fraction') l.params[d.key] = scalePoints(v, k)
    }
  }
  for (const light of q.lighting.lights) {
    for (const d of LIGHT_DEFS[light.type].params) {
      const v = light.params[d.key]
      if (typeof v === 'number' && d.unit === 'px') light.params[d.key] = v * k
    }
  }
  return q
}
