// A variant's final render as the gallery shows it: the full image at up to 1024 px on its longer side (a small
// texture upscaled by a whole factor, nearest neighbour, so pixel art stays crisp; a larger one scaled down), and a
// thumbnail at half that. WebP where the browser can encode it, else JPEG.

import { pixelsToCanvas, upscale } from '@/render/export';

export const GALLERY_IMAGE = 1024;
export const GALLERY_THUMB = 512;

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
	const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
	return encode('image/webp').then(async (b) => {
		if (b && b.type === 'image/webp') return b;
		const jpeg = await encode('image/jpeg');
		if (!jpeg) throw new Error('This browser could not encode the render.');
		return jpeg;
	});
}

/** `src` drawn to fit inside `side` × `side` (aspect kept), smoothed. */
function fit(src: HTMLCanvasElement, side: number): HTMLCanvasElement {
	const s = Math.min(1, side / Math.max(src.width, src.height));
	if (s === 1) return src;
	const c = document.createElement('canvas');
	c.width = Math.max(1, Math.round(src.width * s));
	c.height = Math.max(1, Math.round(src.height * s));
	const g = c.getContext('2d')!;
	g.imageSmoothingEnabled = true;
	g.imageSmoothingQuality = 'high';
	g.drawImage(src, 0, 0, c.width, c.height);
	return c;
}

export async function galleryImages(
	pixels: Uint8ClampedArray,
	width: number,
	height: number
): Promise<{ image: Blob; thumb: Blob }> {
	const k = Math.max(1, Math.floor(GALLERY_IMAGE / Math.max(width, height)));
	const full = fit(pixelsToCanvas(upscale(pixels, width, height, k), width * k, height * k), GALLERY_IMAGE);
	const [image, thumb] = await Promise.all([toBlob(full, 0.95), toBlob(fit(full, GALLERY_THUMB), 0.9)]);
	return { image, thumb };
}
