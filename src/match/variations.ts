// Variations (docs/features/fr8.4-from-reference.md): a handful of perturbed versions of a project for picking by
// eye — the step where the metric is least trustworthy. Each variation moves a few random tunable params by a sizeable
// step (and occasionally re-rolls a seed).

import type { Project } from '@/core/project'
import { Rng, applyParams, extractParams, type ParamEntry } from './optimizer'

export interface VariationOptions {
  /** How far each changed param moves, as a fraction of its range (default 0.2). */
  strength?: number
  /** Params changed per variation (default 4). */
  changes?: number
  /** Chance per variation of re-rolling one seed (default 0.35). */
  reseed?: number
  seed?: number
}

export interface Variation {
  project: Project
  /** Labels of the params changed. */
  changed: string[]
}

export function variations(project: Project, count: number, opts: VariationOptions = {}): Variation[] {
  const rng = new Rng(opts.seed ?? Date.now() % 100000)
  const space = extractParams(project, { layers: true, base: true, enums: false, seeds: true })
  const tunable = space.entries.filter((e) => e.kind !== 'seed' && e.kind !== 'enum')
  const seeds = space.entries.filter((e) => e.kind === 'seed')
  const strength = opts.strength ?? 0.2
  const out: Variation[] = []
  for (let n = 0; n < count; n++) {
    const v = Float64Array.from(space.initial)
    const changed: string[] = []
    const picks = new Set<ParamEntry>()
    for (let i = 0; i < (opts.changes ?? 4) && tunable.length; i++) picks.add(rng.pick(tunable))
    for (const e of picks) {
      // Colours move less (a 0.2 step in OKLab lightness is a different material, not a variation).
      const step = e.kind === 'color' || e.kind === 'stop-color' ? strength * 0.35 : strength
      for (let d = 0; d < e.dims; d++) v[e.offset + d] = Math.min(1, Math.max(0, v[e.offset + d] + rng.normal() * step))
      changed.push(e.label)
    }
    if (seeds.length && rng.next() < (opts.reseed ?? 0.35)) {
      const e = rng.pick(seeds)
      v[e.offset] = 1 + rng.int(99998)
      changed.push(e.label)
    }
    out.push({ project: applyParams(project, space, v), changed })
  }
  return out
}
