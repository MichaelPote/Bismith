// Images that layers use (Stamp › Image file), by file name — the "path" a project saves (a browser page sees a file's
// name, not where it lives). The pixels stay in this browser: a data URL per name, kept in memory and in localStorage,
// decoded to RGBA8 for the layers' CPU textures. A project file saves only the name; opened where that image isn't
// stored, its layer draws nothing and the inspector asks for the file again. Loading a file under a name already used
// replaces it everywhere, as a path pointing at a new file would. (Embedding the images in the project file is for
// later.) Decoding is asynchronous: until an image is ready its layer draws nothing, and onImageReady listeners (the
// engine) re-render when it is; pendingImages() resolves once every image asked for is decoded (headless renders).

export interface DecodedImage {
	width: number;
	height: number;
	/** RGBA8, sRGB, straight alpha, rows top-down. */
	data: Uint8Array;
}

/** Longest side an imported image is scaled down to, at most (see fitImage). */
export const IMAGE_MAX = 1024;
const URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const STORE_PREFIX = 'bismith:image:';

const urls = new Map<string, string>();
const decoded = new Map<string, DecodedImage>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

/** Bumped whenever an image finishes decoding or is replaced (part of the layers' texture cache keys). */
export function imagesVersion(): number {
	return version;
}

/** Call `fn` whenever an image finishes decoding; returns the unsubscribe. */
export function onImageReady(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

/** Resolves when every image asked for so far has decoded (or failed). */
export async function pendingImages(): Promise<void> {
	while (pending.size) await Promise.all([...pending.values()]);
}

/** Keep an image (a PNG / JPEG / WebP data URL) under a file name, replacing any before it, and start decoding it. */
export function putImage(name: string, url: string, persist = true): void {
	if (!name || !URL_PATTERN.test(url) || urls.get(name) === url) return;
	urls.set(name, url);
	decoded.delete(name);
	version++;
	if (persist) {
		try {
			localStorage.setItem(STORE_PREFIX + name, url);
		} catch {
			/* storage unavailable or full: kept for this session only */
		}
	}
	decode(name);
}

/** The data URL kept under a name (from memory, else this browser's store), or undefined. */
export function imageUrl(name: string): string | undefined {
	let url = urls.get(name);
	if (url === undefined && name) {
		try {
			url = localStorage.getItem(STORE_PREFIX + name) ?? undefined;
		} catch {
			url = undefined;
		}
		if (url && URL_PATTERN.test(url)) urls.set(name, url);
		else url = undefined;
	}
	return url;
}

/** Whether this browser has the image (decoded or not). */
export function hasImage(name: string): boolean {
	return imageUrl(name) !== undefined;
}

/** The decoded image, or null while it decodes (that starts it) or when this browser doesn't have it. */
export function getImage(name: string): DecodedImage | null {
	const hit = decoded.get(name);
	if (hit) return hit;
	if (imageUrl(name)) decode(name);
	return null;
}

function decode(name: string): void {
	if (decoded.has(name) || pending.has(name)) return;
	const url = urls.get(name);
	if (!url || typeof createImageBitmap !== 'function') return;
	const job = (async () => {
		try {
			const blob = await (await fetch(url)).blob();
			const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
			const c = new OffscreenCanvas(bmp.width, bmp.height);
			const ctx = c.getContext('2d', { colorSpace: 'srgb' })!;
			ctx.drawImage(bmp, 0, 0);
			const px = ctx.getImageData(0, 0, bmp.width, bmp.height);
			bmp.close();
			// Replaced meanwhile: the newer one decodes on its own.
			if (urls.get(name) !== url) return;
			decoded.set(name, { width: px.width, height: px.height, data: new Uint8Array(px.data.buffer.slice(0)) });
			version++;
			for (const fn of listeners) fn();
		} catch {
			/* not an image after all: the layer draws nothing */
		} finally {
			pending.delete(name);
		}
	})();
	pending.set(name, job);
}

/**
 * An image file as the library keeps it: scaled down (keeping its aspect) so its longest side is at most `max` px,
 * as PNG (lossless, keeps alpha). Browser only.
 */
export async function fitImage(file: Blob, max: number): Promise<{ url: string; width: number; height: number }> {
	const bmp = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
	const k = Math.min(1, Math.max(1, Math.round(max)) / Math.max(bmp.width, bmp.height));
	const width = Math.max(1, Math.round(bmp.width * k));
	const height = Math.max(1, Math.round(bmp.height * k));
	const c = document.createElement('canvas');
	c.width = width;
	c.height = height;
	const ctx = c.getContext('2d')!;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bmp, 0, 0, width, height);
	bmp.close();
	return { url: c.toDataURL('image/png'), width, height };
}
