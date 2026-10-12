// Small FFT for the spectrum metric: iterative radix-2 for power-of-two lengths, Bluestein's chirp-z for
// any other length (so images of any size get an exact periodic DFT), and a 2-D power spectrum.

const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>()

function radix2Tables(n: number) {
  let t = twiddleCache.get(n)
  if (!t) {
    const cos = new Float64Array(n / 2)
    const sin = new Float64Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n)
      sin[i] = Math.sin((2 * Math.PI * i) / n)
    }
    const bits = Math.round(Math.log2(n))
    const rev = new Uint32Array(n)
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      rev[i] = r
    }
    t = { cos, sin, rev }
    twiddleCache.set(n, t)
  }
  return t
}

export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/** In-place radix-2 FFT (forward: e^{-2πi kn/N}; inverse is unscaled). Length must be a power of two. */
export function fftRadix2(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  if (n <= 1) return
  if (!isPow2(n)) throw new Error(`fftRadix2: length ${n} is not a power of two`)
  const { cos, sin, rev } = radix2Tables(n)
  for (let i = 0; i < n; i++) {
    const j = rev[i]
    if (j > i) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  const sign = inverse ? 1 : -1
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = n / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]
        const wi = sign * sin[k * step]
        const a = start + k
        const b = a + half
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}

const bluesteinCache = new Map<number, { m: number; wr: Float64Array; wi: Float64Array; br: Float64Array; bi: Float64Array }>()

function bluesteinTables(n: number) {
  let t = bluesteinCache.get(n)
  if (!t) {
    const m = nextPow2(2 * n - 1)
    const wr = new Float64Array(n)
    const wi = new Float64Array(n)
    for (let k = 0; k < n; k++) {
      // k² mod 2n keeps the angle accurate for large k.
      const ang = (Math.PI * ((k * k) % (2 * n))) / n
      wr[k] = Math.cos(ang)
      wi[k] = -Math.sin(ang)
    }
    const br = new Float64Array(m)
    const bi = new Float64Array(m)
    br[0] = wr[0]
    bi[0] = -wi[0]
    for (let k = 1; k < n; k++) {
      br[k] = br[m - k] = wr[k]
      bi[k] = bi[m - k] = -wi[k]
    }
    fftRadix2(br, bi)
    t = { m, wr, wi, br, bi }
    bluesteinCache.set(n, t)
  }
  return t
}

/** In-place forward DFT of any length (radix-2 when possible, Bluestein otherwise). */
export function dft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (n <= 1) return
  if (isPow2(n)) {
    fftRadix2(re, im)
    return
  }
  const { m, wr, wi, br, bi } = bluesteinTables(n)
  const ar = new Float64Array(m)
  const ai = new Float64Array(m)
  for (let k = 0; k < n; k++) {
    ar[k] = re[k] * wr[k] - im[k] * wi[k]
    ai[k] = re[k] * wi[k] + im[k] * wr[k]
  }
  fftRadix2(ar, ai)
  for (let k = 0; k < m; k++) {
    const r = ar[k] * br[k] - ai[k] * bi[k]
    const i = ar[k] * bi[k] + ai[k] * br[k]
    ar[k] = r
    ai[k] = i
  }
  fftRadix2(ar, ai, true)
  for (let k = 0; k < n; k++) {
    const cr = ar[k] / m
    const ci = ai[k] / m
    re[k] = cr * wr[k] - ci * wi[k]
    im[k] = cr * wi[k] + ci * wr[k]
  }
}

/** |DFT|² of a real width × height image (row-major), same layout (DC at index 0). */
export function powerSpectrum2d(values: ArrayLike<number>, width: number, height: number): Float64Array {
  const re = new Float64Array(width * height)
  const im = new Float64Array(width * height)
  for (let i = 0; i < re.length; i++) re[i] = values[i]
  const rr = new Float64Array(width)
  const ri = new Float64Array(width)
  for (let y = 0; y < height; y++) {
    const o = y * width
    rr.set(re.subarray(o, o + width))
    ri.set(im.subarray(o, o + width))
    dft(rr, ri)
    re.set(rr, o)
    im.set(ri, o)
  }
  const cr = new Float64Array(height)
  const ci = new Float64Array(height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      cr[y] = re[y * width + x]
      ci[y] = im[y * width + x]
    }
    dft(cr, ci)
    for (let y = 0; y < height; y++) {
      re[y * width + x] = cr[y]
      im[y * width + x] = ci[y]
    }
  }
  const out = new Float64Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = re[i] * re[i] + im[i] * im[i]
  return out
}
