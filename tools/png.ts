// Node-side PNG helpers for the harness: read/write, nearest upscale and contact sheets.

import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

export interface Rgba8 {
	width: number;
	height: number;
	data: Uint8Array;
}

export function readPng(file: string): Rgba8 {
	const png = PNG.sync.read(readFileSync(file));
	return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

export function decodePng(buf: Buffer): Rgba8 {
	const png = PNG.sync.read(buf);
	return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

function encodePng(img: Rgba8): Buffer {
	const png = new PNG({ width: img.width, height: img.height });
	png.data = Buffer.from(img.data);
	return PNG.sync.write(png);
}

export function writePng(file: string, img: Rgba8): void {
	writeFileSync(file, encodePng(img));
}

/** Lay images out in a row (nearest-upscaled by `scale`), composited over the Cinderforge ground. */
export function contactSheet(images: Rgba8[], scale = 2, gap = 8, bg: [number, number, number] = [30, 33, 36]): Rgba8 {
	const W = images.reduce((s, im) => s + im.width * scale, 0) + gap * (images.length + 1);
	const H = Math.max(...images.map((im) => im.height * scale)) + gap * 2;
	const data = new Uint8Array(W * H * 4);
	for (let i = 0; i < W * H; i++) {
		data[i * 4] = bg[0];
		data[i * 4 + 1] = bg[1];
		data[i * 4 + 2] = bg[2];
		data[i * 4 + 3] = 255;
	}
	let x0 = gap;
	for (const im of images) {
		for (let y = 0; y < im.height * scale; y++) {
			for (let x = 0; x < im.width * scale; x++) {
				const si = (Math.floor(y / scale) * im.width + Math.floor(x / scale)) * 4;
				const di = ((y + gap) * W + x0 + x) * 4;
				const a = im.data[si + 3] / 255;
				// Checkerboard under transparency.
				const chk = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) === 0 ? 44 : 58;
				data[di] = Math.round(im.data[si] * a + chk * (1 - a));
				data[di + 1] = Math.round(im.data[si + 1] * a + chk * (1 - a));
				data[di + 2] = Math.round(im.data[si + 2] * a + chk * (1 - a));
				data[di + 3] = 255;
			}
		}
		x0 += im.width * scale + gap;
	}
	return { width: W, height: H, data };
}
