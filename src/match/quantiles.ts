// Sorting and quantiles of float samples, shared by the metric terms (metrics.ts, windows.ts).

/**
 * Ascending sort of float32 values, exactly as Float32Array#sort orders them (−0 before +0, NaN last), by an LSD radix
 * sort on their bit patterns — three passes of 11 bits, O(n). The metric sorts tens of thousands of values per
 * evaluation (32 colour projections, local contrast), where a comparison sort was two thirds of the scoring time.
 */
export function sortFloat32(values: Float32Array): Float32Array {
  const n = values.length
  if (n < 512) return Float32Array.from(values).sort()
  const bits = new Uint32Array(values.buffer, values.byteOffset, n)
  // Order-preserving keys: flip every bit of negatives, set the sign bit of positives.
  let a = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    const x = bits[i]
    a[i] = x & 0x80000000 ? ~x >>> 0 : (x | 0x80000000) >>> 0
  }
  let b = new Uint32Array(n)
  const count = new Uint32Array(2048)
  for (let shift = 0; shift < 32; shift += 11) {
    count.fill(0)
    for (let i = 0; i < n; i++) count[(a[i] >>> shift) & 2047]++
    let sum = 0
    for (let k = 0; k < 2048; k++) {
      const c = count[k]
      count[k] = sum
      sum += c
    }
    for (let i = 0; i < n; i++) b[count[(a[i] >>> shift) & 2047]++] = a[i]
    const t = a
    a = b
    b = t
  }
  for (let i = 0; i < n; i++) {
    const k = a[i]
    a[i] = k & 0x80000000 ? (k ^ 0x80000000) >>> 0 : ~k >>> 0
  }
  return new Float32Array(a.buffer, 0, n)
}

/** Sorted quantiles (Q evenly spaced, linear interpolation) of `values`. */
export function quantiles(values: ArrayLike<number>, q = 128): Float32Array {
  const n = values.length
  const out = new Float32Array(q)
  if (n === 0) return out
  const sorted = sortFloat32(values instanceof Float32Array ? values : Float32Array.from(values as ArrayLike<number>))
  for (let k = 0; k < q; k++) {
    const pos = ((k + 0.5) / q) * n - 0.5
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(pos)))
    const i1 = Math.min(n - 1, i0 + 1)
    const f = Math.max(0, Math.min(1, pos - i0))
    out[k] = sorted[i0] * (1 - f) + sorted[i1] * f
  }
  return out
}
