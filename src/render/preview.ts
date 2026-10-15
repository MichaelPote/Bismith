// Project previews (docs/features/fr8.20-project-previews.md): a small lossy thumbnail of the final render, stored in
// the project file as a data URL (`Project.preview`) so the new-project wizard can show a card without compiling and
// rendering it.

import type { Engine } from './engine'
import { mapPixels } from './export'

/** Longest side of a preview (px); smaller textures keep their size. */
export const PREVIEW_MAX = 128
/** Lossy quality: medium-low keeps a 128 px preview at a few KB of base64. */
export const PREVIEW_QUALITY = 0.6

/**
 * Encode RGBA8 pixels as a preview: scaled down (smoothly) so the longest side is at most `max` px, as WebP — JPEG where
 * the browser can't encode WebP (it then hands back a PNG). Browser only.
 */
export function encodePreview(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, max = PREVIEW_MAX, quality = PREVIEW_QUALITY): string {
  const src = document.createElement('canvas')
  src.width = width
  src.height = height
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
  const k = Math.min(1, max / Math.max(width, height))
  const dst = document.createElement('canvas')
  dst.width = Math.max(1, Math.round(width * k))
  dst.height = Math.max(1, Math.round(height * k))
  const ctx = dst.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, dst.width, dst.height)
  const webp = dst.toDataURL('image/webp', quality)
  return webp.startsWith('data:image/webp') ? webp : dst.toDataURL('image/jpeg', quality)
}

/** A preview of what the engine shows now (its final, post-processed image); undefined before anything has rendered. */
export function capturePreview(engine: Engine | null | undefined): string | undefined {
  if (!engine) return undefined
  try {
    const { width, height, pixels } = mapPixels(engine, 'final')
    return width > 0 && height > 0 ? encodePreview(pixels, width, height) : undefined
  } catch {
    return undefined
  }
}

/** Decode a preview to RGBA8 pixels (for ImageCanvas). Browser only. */
export async function decodePreview(url: string): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> {
  const bmp = await createImageBitmap(await (await fetch(url)).blob())
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  return { pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height }
}
