// Project previews (docs/features/fr8.20-project-previews.md): a small lossy thumbnail of the final render, stored in
// the project file as a data URL (`Project.preview`) so the new-project wizard can show a card without compiling and
// rendering it.

import type { Project } from '@/core/project';
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
 * The fewest path-traced samples a stored preview (a project's, a preset's) is rendered with: fewer leave soft shadows
 * and glossy highlights grainy on a card.
 */
export const PREVIEW_SAMPLES = 256;

/**
 * A preview to store with a project or preset: of `project` (rendered in place of the shown one), else of what the
 * engine shows. Reuses the best image the engine already has (Engine.bestFinal: the viewport, a recent export) when it
 * has PREVIEW_SAMPLES or more; otherwise traces exactly that many off-screen (Engine.renderExport: in chunks, so the
 * page stays responsive). Undefined without an engine or project.
 */
export async function renderPreview(
	engine: Engine | null | undefined,
	size: PreviewSize = PROJECT_PREVIEW,
	project?: Project
): Promise<string | undefined> {
	if (!engine) return undefined;
	const best = engine.bestFinal(project);
	if (best && best.samples >= PREVIEW_SAMPLES) return encodePreview(best.pixels, best.width, best.height, size);
	try {
		const opts = { samples: PREVIEW_SAMPLES, supersample: 1, exact: true, ...(project ? { project } : {}) };
		return (await engine.renderExport(opts, () => capturePreview(engine, size))) ?? undefined;
	} catch (e) {
		console.warn('[bismith] preview render failed', e);
		return undefined;
	}
}

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
	return webp.startsWith('data:image/webp') ? webp : onChecker(dst).toDataURL('image/jpeg', quality);
}

/**
 * `src` over the viewport's alpha checkerboard (display.ts: its two greys, 8 px cells, larger on big images), for formats
 * without alpha (the JPEG fallbacks): transparent texels show as the checkerboard instead of turning black. Browser only.
 */
export function onChecker(src: HTMLCanvasElement): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = src.width;
	c.height = src.height;
	const g = c.getContext('2d')!;
	const cell = Math.max(8, Math.round(Math.max(c.width, c.height) / 64));
	g.fillStyle = '#2b3036';
	g.fillRect(0, 0, c.width, c.height);
	g.fillStyle = '#3b4045';
	for (let y = 0; y * cell < c.height; y++)
		for (let x = y & 1; x * cell < c.width; x += 2) g.fillRect(x * cell, y * cell, cell, cell);
	g.drawImage(src, 0, 0);
	return c;
}

/**
 * A `w`×`h` crop from the middle of RGBA8 pixels at `zoom` (1 = a texel per pixel, 0.5 = two across each), as a PNG
 * data URL. A tileable texture smaller than the crop repeats to fill it; around another it stays transparent. Browser
 * only.
 */
export function encodeCrop(
	pixels: Uint8Array | Uint8ClampedArray,
	width: number,
	height: number,
	w: number,
	h: number,
	wrap: boolean,
	zoom = 1
): string {
	// The texels it covers, at their own size first.
	const tw = Math.round(w / zoom);
	const th = Math.round(h / zoom);
	const x0 = Math.floor((width - tw) / 2);
	const y0 = Math.floor((height - th) / 2);
	const texels = new Uint8ClampedArray(tw * th * 4);
	for (let y = 0; y < th; y++)
		for (let x = 0; x < tw; x++) {
			let sx = x0 + x;
			let sy = y0 + y;
			if (wrap) {
				sx = ((sx % width) + width) % width;
				sy = ((sy % height) + height) % height;
			} else if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
			const s = (sy * width + sx) * 4;
			texels.set(pixels.subarray(s, s + 4), (y * tw + x) * 4);
		}
	const src = document.createElement('canvas');
	src.width = tw;
	src.height = th;
	src.getContext('2d')!.putImageData(new ImageData(texels, tw, th), 0, 0);
	if (tw === w && th === h) return src.toDataURL('image/png');
	const dst = document.createElement('canvas');
	dst.width = w;
	dst.height = h;
	const ctx = dst.getContext('2d')!;
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(src, 0, 0, w, h);
	return dst.toDataURL('image/png');
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
