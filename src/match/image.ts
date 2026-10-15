// Image type and pixel helpers for reference matching (docs/features/fr6.1-similarity-metrics.md).
// Pure TypeScript, no DOM — usable from the app, the headless page, Node tools and unit tests.
//
// MatchImage convention:
//   - data is RGBA Float32Array, 4 floats per pixel, rows top-to-bottom (same row order as the engine's
//     readFinal()/readRender() and as PNG files);
//   - RGB is **sRGB-encoded** (display-referred, gamma-encoded) in 0..1 — i.e. what an 8-bit PNG stores
//     divided by 255. NOT linear light. Use fromLinear() for engine output (ImageData32 is linear) and
//     fromRgba8() for decoded PNG / canvas pixels;
//   - alpha is straight (not premultiplied), 0..1.

import { linearToSrgb1, srgbToLinear1 } from '../core/color'

export interface MatchImage {
  width: number
  height: number
  /** RGBA, sRGB-encoded 0..1, straight alpha, rows top-down. */
  data: Float32Array
}

/** Anything shaped like the engine's ImageData32 (linear float RGBA, rows top-down). */
export interface LinearImage {
  width: number
  height: number
  data: Float32Array
}

export function createImage(width: number, height: number, fill: [number, number, number, number] = [0, 0, 0, 1]): MatchImage {
  const data = new Float32Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]
    data[i + 1] = fill[1]
    data[i + 2] = fill[2]
    data[i + 3] = fill[3]
  }
  return { width, height, data }
}

export function cloneImage(img: MatchImage): MatchImage {
  return { width: img.width, height: img.height, data: new Float32Array(img.data) }
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Engine output (linear float, possibly HDR) → MatchImage (sRGB-encoded, clamped 0..1). */
export function fromLinear(img: LinearImage): MatchImage {
  const n = img.width * img.height * 4
  const out = new Float32Array(n)
  const d = img.data
  for (let i = 0; i < n; i += 4) {
    out[i] = linearToSrgb1(clamp01(d[i]))
    out[i + 1] = linearToSrgb1(clamp01(d[i + 1]))
    out[i + 2] = linearToSrgb1(clamp01(d[i + 2]))
    out[i + 3] = clamp01(d[i + 3])
  }
  return { width: img.width, height: img.height, data: out }
}

/** 8-bit RGBA (PNG / canvas ImageData, sRGB) → MatchImage. */
export function fromRgba8(data: ArrayLike<number>, width: number, height: number): MatchImage {
  const n = width * height * 4
  if (data.length < n) throw new Error(`fromRgba8: expected ${n} bytes, got ${data.length}`)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = data[i] / 255
  return { width, height, data: out }
}

/** MatchImage → 8-bit RGBA (for PNG encoding / canvas). */
export function toRgba8(img: MatchImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(img.width * img.height * 4)
  for (let i = 0; i < out.length; i++) out[i] = Math.round(clamp01(img.data[i]) * 255)
  return out
}

/** True when every pixel has alpha ≥ 0.999. */
export function isOpaque(img: MatchImage): boolean {
  const d = img.data
  for (let i = 3; i < d.length; i += 4) if (d[i] < 0.999) return false
  return true
}

/** Largest size with the same aspect ratio whose long side is ≤ maxSize (never upscales). */
export function fitSize(width: number, height: number, maxSize: number): [number, number] {
  const long = Math.max(width, height)
  if (long <= maxSize) return [width, height]
  const s = maxSize / long
  return [Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s))]
}

// ------------------------------------------------------------------------------------------------ resample

export type ResampleMode = 'auto' | 'box' | 'bilinear'

interface Taps {
  start: Int32Array
  count: Int32Array
  index: Int32Array
  weight: Float32Array
}

/** 1-D resampling taps (box = area average for shrinking; bilinear with clamped edges otherwise). */
function axisTaps(src: number, dst: number, mode: ResampleMode): Taps {
  const scale = src / dst
  const box = mode === 'box' || (mode === 'auto' && dst < src)
  const idx: number[] = []
  const wts: number[] = []
  const start = new Int32Array(dst)
  const count = new Int32Array(dst)
  for (let i = 0; i < dst; i++) {
    start[i] = idx.length
    if (box && scale > 1) {
      const a = i * scale
      const b = (i + 1) * scale
      let sum = 0
      for (let s = Math.floor(a); s < Math.ceil(b); s++) {
        const w = Math.min(b, s + 1) - Math.max(a, s)
        if (w <= 0) continue
        idx.push(Math.min(src - 1, s))
        wts.push(w)
        sum += w
      }
      for (let k = start[i]; k < idx.length; k++) wts[k] /= sum
    } else {
      const x = (i + 0.5) * scale - 0.5
      const x0 = Math.floor(x)
      const f = x - x0
      const i0 = Math.min(src - 1, Math.max(0, x0))
      const i1 = Math.min(src - 1, Math.max(0, x0 + 1))
      if (i0 === i1 || f === 0) {
        idx.push(i0)
        wts.push(1)
      } else {
        idx.push(i0, i1)
        wts.push(1 - f, f)
      }
    }
    count[i] = idx.length - start[i]
  }
  return { start, count, index: Int32Array.from(idx), weight: Float32Array.from(wts) }
}

/**
 * Resample to width × height. 'auto' area-averages (box) along axes that shrink and uses bilinear along
 * axes that grow. Filtering happens in linear light on premultiplied alpha, so it matches what a
 * lower-resolution render of the same scene would produce.
 */
export function resample(img: MatchImage, width: number, height: number, mode: ResampleMode = 'auto'): MatchImage {
  if (img.width === width && img.height === height) return img
  return resampleLinear(toLinearPremul(img), width, height, mode)
}

/** An image in linear light with premultiplied alpha — what resample filters (convert once, resample to several sizes). */
export interface LinearPremul {
  width: number
  height: number
  data: Float32Array
}

export function toLinearPremul(img: MatchImage): LinearPremul {
  const lin = new Float32Array(img.width * img.height * 4)
  for (let i = 0; i < lin.length; i += 4) {
    const a = img.data[i + 3]
    lin[i] = srgbToLinear1(img.data[i]) * a
    lin[i + 1] = srgbToLinear1(img.data[i + 1]) * a
    lin[i + 2] = srgbToLinear1(img.data[i + 2]) * a
    lin[i + 3] = a
  }
  return { width: img.width, height: img.height, data: lin }
}

/** resample() of an image already converted by toLinearPremul (the same result, bit for bit). */
export function resampleLinear(src: LinearPremul, width: number, height: number, mode: ResampleMode = 'auto'): MatchImage {
  const tmp = horizontalPass(src, width, mode)
  const ty = axisTaps(src.height, height, mode)
  // Vertical pass + back to straight sRGB.
  const out = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let k = ty.start[y], e = k + ty.count[y]; k < e; k++) {
        const si = (ty.index[k] * width + x) * 4
        const w = ty.weight[k]
        r += tmp[si] * w
        g += tmp[si + 1] * w
        b += tmp[si + 2] * w
        a += tmp[si + 3] * w
      }
      const di = (y * width + x) * 4
      const inv = a > 1e-6 ? 1 / a : 0
      out[di] = linearToSrgb1(clamp01(r * inv))
      out[di + 1] = linearToSrgb1(clamp01(g * inv))
      out[di + 2] = linearToSrgb1(clamp01(b * inv))
      out[di + 3] = clamp01(a)
    }
  }
  return { width, height, data: out }
}

/**
 * Resample straight to OKLab planes — toOklab(resample(…)) without the round trip through sRGB (equal to float
 * rounding). Transparent pixels are composited over `background` (sRGB) as toOklab does.
 */
export function resampleLinearToOklab(src: LinearPremul, width: number, height: number, background: [number, number, number] = [0.5, 0.5, 0.5], mode: ResampleMode = 'auto'): LabPlanes {
  const sameSize = src.width === width && src.height === height
  const tmp = sameSize ? src.data : horizontalPass(src, width, mode)
  const ty = sameSize ? null : axisTaps(src.height, height, mode)
  const bg = background.map(srgbToLinear1)
  const n = width * height
  const L = new Float32Array(n)
  const A = new Float32Array(n)
  const B = new Float32Array(n)
  const alpha = new Float32Array(n)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0
      if (ty) {
        for (let k = ty.start[y], e = k + ty.count[y]; k < e; k++) {
          const si = (ty.index[k] * width + x) * 4
          const w = ty.weight[k]
          r += tmp[si] * w
          g += tmp[si + 1] * w
          b += tmp[si + 2] * w
          a += tmp[si + 3] * w
        }
      } else {
        const si = (y * width + x) * 4
        r = tmp[si]
        g = tmp[si + 1]
        b = tmp[si + 2]
        a = tmp[si + 3]
      }
      const al = clamp01(a)
      const inv = a > 1e-6 ? 1 / a : 0
      r = clamp01(r * inv)
      g = clamp01(g * inv)
      b = clamp01(b * inv)
      if (al < 1) {
        r = r * al + bg[0] * (1 - al)
        g = g * al + bg[1] * (1 - al)
        b = b * al + bg[2] * (1 - al)
      }
      const p = y * width + x
      oklabInto(r, g, b, p, L, A, B)
      alpha[p] = al
    }
  }
  return { width, height, L, A, B, alpha }
}

function horizontalPass(src: LinearPremul, width: number, mode: ResampleMode): Float32Array {
  const { width: sw, height: sh, data: lin } = src
  const tx = axisTaps(sw, width, mode)
  // Horizontal pass: sh rows × width.
  const tmp = new Float32Array(width * sh * 4)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let k = tx.start[x], e = k + tx.count[x]; k < e; k++) {
        const si = (y * sw + tx.index[k]) * 4
        const w = tx.weight[k]
        r += lin[si] * w
        g += lin[si + 1] * w
        b += lin[si + 2] * w
        a += lin[si + 3] * w
      }
      const di = (y * width + x) * 4
      tmp[di] = r
      tmp[di + 1] = g
      tmp[di + 2] = b
      tmp[di + 3] = a
    }
  }
  return tmp
}

// ------------------------------------------------------------------------------------------------ OKLab

export interface LabPlanes {
  width: number
  height: number
  /** OKLab L (≈0..1), a, b (≈−0.4..0.4) per pixel, after compositing over the background. */
  L: Float32Array
  A: Float32Array
  B: Float32Array
  /** Straight alpha per pixel. */
  alpha: Float32Array
}

/**
 * Convert to OKLab planes. Semi-transparent pixels are composited (in linear light) over `background`
 * (sRGB 0..1, default mid grey) so transparency reads as a colour; alpha is kept separately.
 */
export function toOklab(img: MatchImage, background: [number, number, number] = [0.5, 0.5, 0.5]): LabPlanes {
  const n = img.width * img.height
  const L = new Float32Array(n)
  const A = new Float32Array(n)
  const B = new Float32Array(n)
  const alpha = new Float32Array(n)
  const bg = background.map(srgbToLinear1)
  const d = img.data
  for (let p = 0; p < n; p++) {
    const i = p * 4
    const al = clamp01(d[i + 3])
    let r = srgbToLinear1(clamp01(d[i]))
    let g = srgbToLinear1(clamp01(d[i + 1]))
    let b = srgbToLinear1(clamp01(d[i + 2]))
    if (al < 1) {
      r = r * al + bg[0] * (1 - al)
      g = g * al + bg[1] * (1 - al)
      b = b * al + bg[2] * (1 - al)
    }
    oklabInto(r, g, b, p, L, A, B)
    alpha[p] = al
  }
  return { width: img.width, height: img.height, L, A, B, alpha }
}

/** Linear sRGB → OKLab, written to pixel p of the planes. */
function oklabInto(r: number, g: number, b: number, p: number, L: Float32Array, A: Float32Array, B: Float32Array): void {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  L[p] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  A[p] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  B[p] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
}

// ------------------------------------------------------------------------------------------------ misc

/**
 * Per-pixel absolute difference |a − b| (RGB and alpha folded in), scaled by `gain`, as an opaque image —
 * the third panel of the harness contact sheet. Sizes must match (resample first).
 */
export function absDiff(a: MatchImage, b: MatchImage, gain = 1): MatchImage {
  if (a.width !== b.width || a.height !== b.height) throw new Error('absDiff: size mismatch')
  const out = new Float32Array(a.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const da = Math.abs(a.data[i + 3] - b.data[i + 3])
    out[i] = clamp01((Math.abs(a.data[i] - b.data[i]) + da) * gain)
    out[i + 1] = clamp01((Math.abs(a.data[i + 1] - b.data[i + 1]) + da) * gain)
    out[i + 2] = clamp01((Math.abs(a.data[i + 2] - b.data[i + 2]) + da) * gain)
    out[i + 3] = 1
  }
  return { width: a.width, height: a.height, data: out }
}

/** Circularly shift an image by (dx, dy) pixels (tests, tiling checks). */
export function circularShift(img: MatchImage, dx: number, dy: number): MatchImage {
  const { width: w, height: h } = img
  const out = new Float32Array(img.data.length)
  for (let y = 0; y < h; y++) {
    const sy = (((y - dy) % h) + h) % h
    for (let x = 0; x < w; x++) {
      const sx = (((x - dx) % w) + w) % w
      out.set(img.data.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4)
    }
  }
  return { width: w, height: h, data: out }
}
