// Float image → 8-bit PNG helpers shared by File ▸ Export and the headless harness API.

import { linearToSrgb1 } from '@/core/color';
import type { Engine, ImageData32 } from './engine';

export type MapKind =
	| 'final'
	| 'render'
	| 'diffuse'
	| 'height'
	| 'roughness'
	| 'specular'
	| 'metalness'
	| 'ao'
	| 'normal-gl'
	| 'normal-dx'
	| 'emissive'
	| 'opacity';

/** Encode linear float RGBA (rows top-down) to 8-bit sRGB RGBA. */
export function toSrgb8(img: ImageData32, alpha = true): Uint8ClampedArray {
	const out = new Uint8ClampedArray(img.width * img.height * 4);
	const d = img.data;
	for (let i = 0; i < out.length; i += 4) {
		out[i] = Math.round(linearToSrgb1(Math.min(1, d[i])) * 255);
		out[i + 1] = Math.round(linearToSrgb1(Math.min(1, d[i + 1])) * 255);
		out[i + 2] = Math.round(linearToSrgb1(Math.min(1, d[i + 2])) * 255);
		out[i + 3] = alpha ? Math.round(Math.min(1, Math.max(0, d[i + 3])) * 255) : 255;
	}
	return out;
}

/** Map one channel of a float image through `fn` to 8-bit grey/RGB without colour encoding. */
function toRaw8(
	img: ImageData32,
	fn: (d: Float32Array, i: number) => [number, number, number, number]
): Uint8ClampedArray {
	const out = new Uint8ClampedArray(img.width * img.height * 4);
	for (let i = 0; i < out.length; i += 4) {
		const [r, g, b, a] = fn(img.data, i);
		out[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
		out[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
		out[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
		out[i + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
	}
	return out;
}

/** Produce 8-bit RGBA for a map kind. The engine must have a rendered project. */
export function mapPixels(engine: Engine, kind: MapKind): { width: number; height: number; pixels: Uint8ClampedArray } {
	let img: ImageData32;
	let pixels: Uint8ClampedArray;
	switch (kind) {
		case 'final':
			img = engine.readFinal();
			pixels = toSrgb8(img);
			break;
		case 'render':
			img = engine.readRender();
			pixels = toSrgb8(img);
			break;
		case 'diffuse':
			img = engine.readMap(0);
			pixels = toSrgb8(img);
			break;
		case 'opacity':
			img = engine.readMap(0);
			pixels = toRaw8(img, (d, i) => [d[i + 3], d[i + 3], d[i + 3], 1]);
			break;
		case 'height': {
			img = engine.readMap(1);
			let min = Infinity;
			let max = -Infinity;
			for (let i = 0; i < img.data.length; i += 4) {
				min = Math.min(min, img.data[i]);
				max = Math.max(max, img.data[i]);
			}
			const span = max > min ? max - min : 1;
			pixels = toRaw8(img, (d, i) => {
				const v = (d[i] - min) / span;
				return [v, v, v, 1];
			});
			break;
		}
		case 'roughness':
			img = engine.readMap(1);
			pixels = toRaw8(img, (d, i) => [d[i + 1], d[i + 1], d[i + 1], 1]);
			break;
		case 'metalness':
			img = engine.readMap(1);
			pixels = toRaw8(img, (d, i) => [d[i + 2], d[i + 2], d[i + 2], 1]);
			break;
		case 'ao':
			img = engine.readAO();
			pixels = toRaw8(img, (d, i) => [d[i], d[i], d[i], 1]);
			break;
		case 'specular':
			img = engine.readMap(2);
			pixels = toRaw8(img, (d, i) => [d[i + 3], d[i + 3], d[i + 3], 1]);
			break;
		case 'normal-gl':
		case 'normal-dx': {
			img = engine.readMap(3);
			const flip = kind === 'normal-dx' ? -1 : 1;
			pixels = toRaw8(img, (d, i) => [d[i] * 0.5 + 0.5, d[i + 1] * flip * 0.5 + 0.5, d[i + 2] * 0.5 + 0.5, 1]);
			break;
		}
		case 'emissive':
			img = engine.readMap(2);
			pixels = toSrgb8({ ...img, data: img.data.map((v, i) => (i % 4 === 3 ? 1 : v)) });
			break;
	}
	return { width: img.width, height: img.height, pixels };
}

/** Nearest-neighbour integer upscale of 8-bit RGBA. */
export function upscale(pixels: Uint8ClampedArray, width: number, height: number, factor: number): Uint8ClampedArray {
	if (factor <= 1) return pixels;
	const W = width * factor;
	const out = new Uint8ClampedArray(W * height * factor * 4);
	for (let y = 0; y < height * factor; y++) {
		const sy = Math.floor(y / factor);
		for (let x = 0; x < W; x++) {
			const si = (sy * width + Math.floor(x / factor)) * 4;
			const di = (y * W + x) * 4;
			out[di] = pixels[si];
			out[di + 1] = pixels[si + 1];
			out[di + 2] = pixels[si + 2];
			out[di + 3] = pixels[si + 3];
		}
	}
	return out;
}

export function pixelsToCanvas(pixels: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d')!;
	ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
	return canvas;
}

export function pixelsToDataURL(pixels: Uint8ClampedArray, width: number, height: number): string {
	return pixelsToCanvas(pixels, width, height).toDataURL('image/png');
}

export function pixelsToBlob(pixels: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
	return new Promise((resolve, reject) =>
		pixelsToCanvas(pixels, width, height).toBlob(
			(b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))),
			'image/png'
		)
	);
}

export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** The File System Access API's Save As dialog — Chromium only, and not in TypeScript's DOM types. */
type SaveFilePicker = (options: {
	suggestedName?: string;
	id?: string;
	types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

/**
 * Save `blob` through the browser's Save As dialog where it has one (Chrome, Edge). Firefox and Safari offer no way
 * for a page to open it, so there the file is downloaded, which asks where only if the browser is set to ask.
 * Resolves to the saved file's name (null if it went to the downloads instead), or false if the dialog was cancelled.
 * `blob` may be a function that makes it: it is called once the dialog has been answered, since the browser only opens
 * the dialog right after the click — work that takes a while (rendering a preview) goes after it.
 */
export async function saveBlobAs(
	blob: Blob | (() => Promise<Blob>),
	filename: string,
	type: { description: string; extension: string; mime?: string }
): Promise<string | null | false> {
	const make = () => (blob instanceof Blob ? Promise.resolve(blob) : blob());
	const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
	if (!picker) {
		downloadBlob(await make(), filename);
		return null;
	}
	const mime = type.mime ?? (blob instanceof Blob ? blob.type : 'application/octet-stream');
	let handle: FileSystemFileHandle;
	try {
		// The id makes the dialog reopen in the folder last saved to.
		handle = await picker({
			suggestedName: filename,
			id: 'bismith-save',
			types: [{ description: type.description, accept: { [mime]: [type.extension] } }]
		});
	} catch (e) {
		if (e instanceof DOMException && e.name === 'AbortError') return false;
		downloadBlob(await make(), filename);
		return null;
	}
	const data = await make();
	const out = await handle.createWritable();
	await out.write(data);
	await out.close();
	return handle.name;
}
