// Node-side PNG helpers for the harness: read/write, data URLs, Match targets and contact sheets.

import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { PNG } from 'pngjs';
import type { TargetInput } from '../src/headless';

export interface Rgba8 {
	width: number;
	height: number;
	data: Uint8Array;
}

export function decodePng(buf: Buffer): Rgba8 {
	const png = PNG.sync.read(buf);
	return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

export const readPng = (file: string): Rgba8 => decodePng(readFileSync(file));

function encodePng(img: Rgba8): Buffer {
	const png = new PNG({ width: img.width, height: img.height });
	png.data = Buffer.from(img.data);
	return PNG.sync.write(png);
}

export function writePng(file: string, img: Rgba8): void {
	writeFileSync(file, encodePng(img));
}

/** A base64 data URL's bytes (a page's PNG, written to a file as it is). */
export const dataUrlBytes = (url: string): Buffer => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

/** A PNG data URL (what the headless page returns for renders and maps), decoded. */
export const pngFromDataUrl = (url: string): Rgba8 => decodePng(dataUrlBytes(url));

/** RGBA8 pixels as a Match target for the headless page. */
export const rgbaTarget = (img: Rgba8): TargetInput => ({
	width: img.width,
	height: img.height,
	rgba: Buffer.from(img.data).toString('base64')
});

/**
 * An image file as a Match target: PNGs are decoded here (exact 8-bit); other formats (JPEG, WebP) go to the page as
 * data URLs, decoded there.
 */
export function targetInput(file: string): TargetInput {
	const ext = extname(file).toLowerCase();
	if (ext === '.png') return rgbaTarget(readPng(file));
	const type = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : `image/${ext.slice(1)}`;
	return `data:${type};base64,${readFileSync(file).toString('base64')}`;
}

export interface SheetOptions {
	/** Nearest-upscale factor (default 1). */
	scale?: number;
	/** Fit each image into a cell × cell square instead (aspect kept, centred). */
	cell?: number;
	/** Margin and space between images, px (default 8). */
	gap?: number;
	bg?: [number, number, number];
}

/**
 * Lay out rows of images on the Cinderforge ground, transparency over a checkerboard. Columns are as wide as their
 * widest image (or the cell), rows as tall as their tallest; a null leaves its place empty.
 */
export function gridSheet(
	rows: (Rgba8 | null)[][],
	{ scale = 1, cell, gap = 8, bg = [30, 33, 36] }: SheetOptions = {}
): Rgba8 {
	const factor = (im: Rgba8) => (cell ? Math.min(cell / im.width, cell / im.height) : scale);
	const size = (im: Rgba8 | null): [number, number] => {
		if (!im) return [0, 0];
		const s = factor(im);
		return [Math.max(1, Math.round(im.width * s)), Math.max(1, Math.round(im.height * s))];
	};
	const cols = Math.max(0, ...rows.map((r) => r.length));
	const colW = Array.from({ length: cols }, (_, c) => cell ?? Math.max(0, ...rows.map((r) => size(r[c] ?? null)[0])));
	const rowH = rows.map((r) => cell ?? Math.max(0, ...r.map((im) => size(im)[1])));
	const W = colW.reduce((a, w) => a + w + gap, gap);
	const H = rowH.reduce((a, h) => a + h + gap, gap);
	const data = new Uint8Array(W * H * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = bg[0];
		data[i + 1] = bg[1];
		data[i + 2] = bg[2];
		data[i + 3] = 255;
	}
	let y0 = gap;
	rows.forEach((row, r) => {
		let x0 = gap;
		row.forEach((im, c) => {
			if (im) {
				const s = factor(im);
				const [w, h] = size(im);
				const ox = x0 + (cell ? Math.floor((cell - w) / 2) : 0);
				const oy = y0 + (cell ? Math.floor((cell - h) / 2) : 0);
				for (let y = 0; y < h; y++) {
					const sy = Math.min(im.height - 1, Math.floor(y / s));
					for (let x = 0; x < w; x++) {
						const si = (sy * im.width + Math.min(im.width - 1, Math.floor(x / s))) * 4;
						const di = ((oy + y) * W + ox + x) * 4;
						const a = im.data[si + 3] / 255;
						const chk = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) === 0 ? 44 : 58;
						data[di] = Math.round(im.data[si] * a + chk * (1 - a));
						data[di + 1] = Math.round(im.data[si + 1] * a + chk * (1 - a));
						data[di + 2] = Math.round(im.data[si + 2] * a + chk * (1 - a));
					}
				}
			}
			x0 += colW[c] + gap;
		});
		y0 += rowH[r] + gap;
	});
	return { width: W, height: H, data };
}

/** `items` in rows of `n`. */
export const chunk = <T>(items: T[], n: number): T[][] =>
	Array.from({ length: Math.ceil(items.length / n) }, (_, i) => items.slice(i * n, (i + 1) * n));
