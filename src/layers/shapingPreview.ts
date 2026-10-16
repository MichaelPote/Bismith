// CPU mirror of the generator wrapper's value chain (GLSL_GENERATOR_MAIN in commonParams.ts, profileCurve in
// glsl/common.ts) for the graph in Shaping › Value: a cross-section through one feature — nothing, the rise across the
// edge, the full value, the fall, nothing — run through bevel, levels, gamma, posterize, invert, cutoff and Offset Z.

import { evalCurve, type Curve, type ParamValue } from '@/core/params'
import { DEFAULT_BEVEL_CURVE, PROFILES } from './commonParams'

/** The bevel profile at x (0 = edge … 1 = a bevel in), as profileCurve() in the GLSL; type is the PROFILES index. */
export function profileCurve(type: number, x: number, curve: Curve = DEFAULT_BEVEL_CURVE): number {
  x = Math.min(1, Math.max(0, x))
  switch (type) {
    case 0: return x > 0 ? 1 : 0
    case 1: return x
    case 2: return x * x * (3 - 2 * x)
    case 3: return Math.sqrt(Math.max(0, 1 - (1 - x) * (1 - x)))
    case 4: return 1 - Math.sqrt(Math.max(0, 1 - x * x))
    case 5: return 1 - Math.abs(2 * x - 1)
    case 6: return Math.floor(x * 3.999) / 3
    case 7: return evalCurve(curve, x)
    default: return x
  }
}

type Get = (key: string) => ParamValue | undefined

/** shapeValue() of the GLSL: levels, gamma, posterize, invert. */
export function shapeValue(v: number, get: Get): number {
  const lo = Number(get('sh_lo') ?? 0)
  const hi = Number(get('sh_hi') ?? 1)
  const gamma = Number(get('sh_gamma') ?? 1)
  const steps = Number(get('sh_steps') ?? 0)
  v = Math.min(1, Math.max(0, (v - lo) / Math.max(hi - lo, 1e-5)))
  if (gamma !== 1) v = Math.pow(v, gamma)
  if (steps > 1) v = Math.min(Math.floor(v * steps), steps - 1) / (steps - 1)
  return get('sh_invert') === true ? 1 - v : v
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export interface ShapingSweep {
  /** x across the cross-section (0…1) and the layer's output there: the raw value (ghost) and the shaped result. */
  xs: number[]
  input: number[]
  output: number[]
  /** The output's scale: Amount (1 when Height is off) and Offset Z, in height units. */
  amount: number
  offset: number
  /** The cutoff as an output level (null when off). */
  cut: number | null
  /** Where the feature starts and ends, and the width of its bevel ramp (all in x). */
  edge: [number, number]
  ramp: number
}

/** Room either side of the feature (x), and how far in the plain ramp of a featureless layer rises. */
const PAD = 0.1
const PLAIN_RAMP = 0.85

/**
 * The cross-section for the current params. `sdf`: the layer has a shape and bevel (outside it the layer covers
 * nothing); without one, the value just sweeps 0 → 1 → 0 and the layer covers everywhere (so Offset Z lifts the
 * margins too). Bevel is drawn on a soft scale (b / (b + 8 px) of the half-width) so every width stays readable.
 */
export function shapingSweep(get: Get, sdf: boolean, n = 240): ShapingSweep {
  const height = get('h_on') === true
  const amount = height ? Number(get('h_amount') ?? 0.5) : 1
  const offset = height ? Number(get('sh_ofs_z') ?? 0) : 0
  const bevel = Math.max(0, Number(get('bevel') ?? 0))
  const profile = Math.max(0, PROFILES.findIndex(([k]) => k === (get('profile') ?? 'round')))
  const curve = (get('bevel_curve') as Curve | undefined) ?? DEFAULT_BEVEL_CURVE
  const cut = Number(get('sh_cut') ?? 0)
  const soft = Number(get('sh_cut_soft') ?? 0)

  const half = 0.5 - PAD
  const flat = bevel <= 0 || profile === 0
  const ramp = sdf ? (flat ? 0 : (half * bevel) / (bevel + 8)) : half * PLAIN_RAMP

  const xs: number[] = []
  const input: number[] = []
  const output: number[] = []
  for (let i = 0; i <= n; i++) {
    const x = i / n
    const t = Math.min(x - PAD, 1 - PAD - x)
    const inside = t >= 0
    const v = !inside ? 0 : sdf ? (flat ? 1 : profileCurve(profile, t / ramp, curve)) : Math.min(1, t / ramp)
    const cov = sdf && !inside ? 0 : 1
    const s = shapeValue(v, get)
    const k = cut > 0 ? (soft > 0 ? smoothstep(cut - soft, cut + soft, s) : s >= cut ? 1 : 0) : 1
    xs.push(x)
    input.push(v * amount * cov)
    output.push((s * amount + offset) * cov * k)
  }
  return { xs, input, output, amount, offset, cut: cut > 0 ? cut * amount + offset : null, edge: [PAD, 1 - PAD], ramp }
}
