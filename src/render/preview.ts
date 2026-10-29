// Project previews (docs/features/fr8.20-project-previews.md): a small lossy thumbnail of the final render, stored in
// the project file as a data URL (`Project.preview`) so the new-project wizard can show a card without compiling and
// rendering it.

import type { Engine } from './engine';
import { mapPixels } from './export';

/** A preview's longest side (px; smaller textures keep their size) and lossy quality. */
export interface PreviewSize {
	max: number;
	quality: number;
}

/** A preset tile's (the preset menus, ~76 px): a few KB of base64. */
export const TILE_PREVIEW: PreviewSize = { max: 128, quality: 0.6 };
/**
 * A project's (its file, a template's card in the new-project wizard: 150 px and up, on 2× screens too): sharp at that
 * size, 10–35 KB of base64.
 */
export const PROJECT_PREVIEW: PreviewSize = { max: 256, quality: 0.8 };

/**
 * Encode RGBA8 pixels as a preview: scaled down (smoothly) so the longest side is at most `max` px, as WebP — JPEG where
 * the browser can't encode WebP (it then hands back a PNG). Browser only.
 */
export function encodePreview(
	pixels: Uint8Array | Uint8ClampedArray,
	width: number,
	height: number,
	{ max, quality }: PreviewSize = TILE_PREVIEW
): string {
	const src = document.createElement('canvas');
	src.width = width;
	src.height = height;
	// A view of the pixels, not a copy (readbacks are never shared buffers).
	const clamped = new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.length);
	src.getContext('2d')!.putImageData(new ImageData(clamped, width, height), 0, 0);
	const k = Math.min(1, max / Math.max(width, height));
	const dst = document.createElement('canvas');
	dst.width = Math.max(1, Math.round(width * k));
	dst.height = Math.max(1, Math.round(height * k));
	const ctx = dst.getContext('2d')!;
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(src, 0, 0, dst.width, dst.height);
	const webp = dst.toDataURL('image/webp', quality);
	return webp.startsWith('data:image/webp') ? webp : dst.toDataURL('image/jpeg', quality);
}

/** A preview of what the engine shows now (its final, post-processed image); undefined before anything has rendered. */
export function capturePreview(
	engine: Engine | null | undefined,
	size: PreviewSize = TILE_PREVIEW
): string | undefined {
	if (!engine) return undefined;
	try {
		const { width, height, pixels } = mapPixels(engine, 'final');
		return width > 0 && height > 0 ? encodePreview(pixels, width, height, size) : undefined;
	} catch (e) {
		console.warn('[bismith] preview capture failed', e);
		return undefined;
	}
}
