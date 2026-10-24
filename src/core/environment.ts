// Environment images (Sky light › Environment): any HDR or plain image file in, a small Ultra HDR JPEG out. The project
// keeps a sky image as the image library keeps a Stamp's (core/images.ts: a file name and a data URL), so the pixels
// are stored as a JPEG with a gain map (ISO 21496-1 / Adobe hdrgm, "JPEG-R"): an 8-bit SDR picture any viewer shows —
// the library's thumbnail — and a gain map that recovers the HDR radiance from it. ENV_WIDTH px across is plenty for a
// sky that is mostly seen blurred. Decoding applies the gain map in full (scene-referred), not adapted to a display as
// a photo viewer does, so a bright sun lights the scene as brightly as in the source file.
//
// The JPEG codec is passed in: the browser's canvas in the app, jpeg-js in tools and tests.

import { encodeJPEGMetadata } from '@monogrid/gainmap-js/libultrahdr';
import { linearToSrgb1, srgbToLinear1 } from './color';

/** Width a loaded environment is scaled down to, at most (an equirectangular panorama: half as tall). */
export const ENV_WIDTH = 512;

/** Linear RGBA float pixels, rows top-down. */
export interface HdrImage {
	width: number;
	height: number;
	data: Float32Array;
}

/** RGBA8 pixels, rows top-down. */
export interface Rgba8 {
	width: number;
	height: number;
	data: Uint8Array | Uint8ClampedArray;
}

export interface JpegCodec {
	encode(img: Rgba8, quality: number): Promise<Uint8Array>;
	decode(bytes: Uint8Array): Promise<Rgba8>;
}

/** Offsets as the gain map metadata applies them (the Android / Adobe defaults). */
const OFFSET = 1 / 64;

// ------------------------------------------------------------------------------------------------- encoding

/** `img` scaled down (area average, keeping its aspect) so it is at most `maxWidth` across. */
export function shrinkHdr(img: HdrImage, maxWidth = ENV_WIDTH): HdrImage {
	if (img.width <= maxWidth) return img;
	const width = maxWidth;
	const height = Math.max(1, Math.round((img.height * maxWidth) / img.width));
	const data = new Float32Array(width * height * 4);
	const sx = img.width / width;
	const sy = img.height / height;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const x0 = Math.floor(x * sx);
			const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
			const y0 = Math.floor(y * sy);
			const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
			const acc = [0, 0, 0, 0];
			for (let v = y0; v < y1; v++)
				for (let u = x0; u < x1; u++) {
					const i = (v * img.width + u) * 4;
					for (let c = 0; c < 4; c++) acc[c] += img.data[i + c];
				}
			const n = (x1 - x0) * (y1 - y0);
			const o = (y * width + x) * 4;
			for (let c = 0; c < 4; c++) data[o + c] = acc[c] / n;
		}
	return { width, height, data };
}

/**
 * An Ultra HDR JPEG of `img`. The SDR picture is the HDR one scaled down (hue kept) wherever it passes 1; the gain map
 * holds, per channel, log2 of what brings it back, over one range shared by the channels (the XMP metadata keeps
 * single values).
 */
export async function encodeUltraHdr(img: HdrImage, jpeg: JpegCodec, quality = 0.9): Promise<Uint8Array> {
	const { width, height, data } = img;
	const n = width * height;
	const sdr = new Uint8Array(n * 4);
	const gain = new Float32Array(n * 3);
	let lo = 0;
	let hi = 0;
	for (let p = 0; p < n; p++) {
		const r = Math.max(0, data[p * 4]);
		const g = Math.max(0, data[p * 4 + 1]);
		const b = Math.max(0, data[p * 4 + 2]);
		const k = Math.min(1, 1 / Math.max(r, g, b, 1e-9));
		const rgb = [r, g, b];
		for (let c = 0; c < 3; c++) {
			sdr[p * 4 + c] = Math.round(linearToSrgb1(rgb[c] * k) * 255);
			// Against the SDR value before 8-bit rounding: exactly 0 wherever the image is within range, so the map is
			// flat (and compresses) but for the parts brighter than white.
			const gc = Math.log2((rgb[c] + OFFSET) / (rgb[c] * k + OFFSET));
			gain[p * 3 + c] = gc;
			lo = Math.min(lo, gc);
			hi = Math.max(hi, gc);
		}
		sdr[p * 4 + 3] = 255;
	}
	// A plain (SDR) image still gets a gain map, of a tiny range.
	hi = Math.max(hi, lo + 1e-3);
	const map = new Uint8Array(n * 4);
	for (let p = 0; p < n; p++) {
		for (let c = 0; c < 3; c++) map[p * 4 + c] = Math.round(((gain[p * 3 + c] - lo) / (hi - lo)) * 255);
		map[p * 4 + 3] = 255;
	}
	const [sdrJpeg, mapJpeg] = await Promise.all([
		jpeg.encode({ width, height, data: sdr }, quality),
		jpeg.encode({ width, height, data: map }, quality)
	]);
	const three = (v: number): [number, number, number] => [v, v, v];
	return encodeJPEGMetadata({
		sdr: { data: toBuffer(sdrJpeg), mimeType: 'image/jpeg', width, height },
		gainMap: { data: toBuffer(mapJpeg), mimeType: 'image/jpeg', width, height },
		gainMapMin: three(lo),
		gainMapMax: three(hi),
		gamma: three(1),
		offsetSdr: three(OFFSET),
		offsetHdr: three(OFFSET),
		hdrCapacityMin: 0,
		hdrCapacityMax: hi
	});
}

const toBuffer = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);

// ------------------------------------------------------------------------------------------------- sampling

/**
 * The table the path tracer draws sky directions from (importance sampling, docs/features/fr3.1-lighting.md): for each
 * texel of the upper half — the sky a ray can reach — `table` holds (RG) the CDF along its row and its probability, in
 * proportion to its luminance × sin θ (its solid angle); row `upper` holds the rows' CDF in R. `tableWidth` is the
 * image's width, or more if the upper half has more rows than that. Each texel counts with the brightest of it and its
 * neighbours: the sky is read bilinearly, so a bright sun spills into the texels round it, and they must be drawn as
 * often as their light deserves (else a rare hit is a firefly). A little probability everywhere keeps black skies and
 * dark corners sampleable.
 */
export function skySamplingTable(img: HdrImage): { table: Float32Array; tableWidth: number; upper: number } {
	const { width, height } = img;
	const upper = Math.max(1, Math.ceil(height / 2));
	const tableWidth = Math.max(width, upper);
	const lum = new Float32Array(width * height);
	for (let p = 0; p < width * height; p++) {
		const i = p * 4;
		lum[p] = Math.max(0, 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]);
	}
	const f = new Float64Array(width * upper);
	let total = 0;
	for (let y = 0; y < upper; y++) {
		const sin = Math.sin((Math.PI * (y + 0.5)) / height);
		for (let x = 0; x < width; x++) {
			let m = 0;
			for (let dy = -1; dy <= 1; dy++) {
				const yy = Math.min(height - 1, Math.max(0, y + dy));
				for (let dx = -1; dx <= 1; dx++) m = Math.max(m, lum[yy * width + ((x + dx + width) % width)]);
			}
			f[y * width + x] = (m + 1e-4) * sin;
			total += f[y * width + x];
		}
	}
	const table = new Float32Array(tableWidth * (upper + 1) * 2);
	let rowsSum = 0;
	for (let y = 0; y < upper; y++) {
		let row = 0;
		for (let x = 0; x < width; x++) row += f[y * width + x];
		let acc = 0;
		for (let x = 0; x < width; x++) {
			acc += f[y * width + x];
			const o = (y * tableWidth + x) * 2;
			table[o] = x === width - 1 ? 1 : acc / row;
			table[o + 1] = f[y * width + x] / total;
		}
		rowsSum += row;
		table[(upper * tableWidth + y) * 2] = y === upper - 1 ? 1 : rowsSum / total;
	}
	return { table, tableWidth, upper };
}

// ------------------------------------------------------------------------------------------------- decoding

interface GainMapInfo {
	min: number[];
	max: number[];
	gamma: number[];
	offsetSdr: number[];
	offsetHdr: number[];
}

/** A JPEG's APP1 XMP packets and the start of its gain map image (MPF's second entry), if it has one. */
function jpegParts(bytes: Uint8Array, start = 0): { xmp: string[]; gainMapAt: number } {
	const xmp: string[] = [];
	let gainMapAt = -1;
	if (bytes[start] !== 0xff || bytes[start + 1] !== 0xd8) return { xmp, gainMapAt };
	const text = new TextDecoder();
	let i = start + 2;
	while (i + 4 <= bytes.length && bytes[i] === 0xff) {
		const marker = bytes[i + 1];
		if (marker === 0xda || marker === 0xd9) break; // start of scan: no more metadata
		const len = (bytes[i + 2] << 8) | bytes[i + 3];
		const body = i + 4;
		if (marker === 0xe1) {
			const s = text.decode(bytes.subarray(body, i + 2 + len));
			if (s.startsWith('http://ns.adobe.com/xap/1.0/')) xmp.push(s);
		} else if (marker === 0xe2 && text.decode(bytes.subarray(body, body + 4)) === 'MPF\0') {
			const at = mpfSecondImage(bytes, body + 4);
			if (at > 0) gainMapAt = at;
		}
		i += 2 + len;
	}
	return { xmp, gainMapAt };
}

/** Where MPF's second image (the gain map) starts: its offset is from the MPF header (`base`, a TIFF header). */
function mpfSecondImage(bytes: Uint8Array, base: number): number {
	const le = bytes[base] === 0x49;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const u16 = (at: number) => view.getUint16(at, le);
	const u32 = (at: number) => view.getUint32(at, le);
	const ifd = base + u32(base + 4);
	const count = u16(ifd);
	for (let k = 0; k < count; k++) {
		const e = ifd + 2 + k * 12;
		if (u16(e) !== 0xb002) continue; // MP Entry: 16 bytes per image
		const entries = base + u32(e + 8);
		const n = u32(e + 4) / 16;
		if (n < 2) return -1;
		return base + u32(entries + 16 + 8);
	}
	return -1;
}

/** One hdrgm value from XMP, as an attribute or an element (a single value or an rdf:Seq of three). */
function hdrgm(xmp: string, key: string): number[] | undefined {
	const attr = new RegExp(`hdrgm:${key}="([^"]*)"`).exec(xmp);
	const el = attr ? undefined : new RegExp(`<hdrgm:${key}>([\\s\\S]*?)</hdrgm:${key}>`).exec(xmp);
	const raw = attr?.[1] ?? el?.[1];
	if (raw === undefined) return undefined;
	const nums = (raw.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
	if (!nums.length) return undefined;
	return nums.length >= 3 ? nums.slice(0, 3) : [nums[0], nums[0], nums[0]];
}

function gainMapInfo(xmps: string[]): GainMapInfo | undefined {
	const all = xmps.join('\n');
	const max = hdrgm(all, 'GainMapMax');
	if (!max) return undefined;
	return {
		min: hdrgm(all, 'GainMapMin') ?? [0, 0, 0],
		max,
		gamma: hdrgm(all, 'Gamma') ?? [1, 1, 1],
		offsetSdr: hdrgm(all, 'OffsetSDR') ?? [OFFSET, OFFSET, OFFSET],
		offsetHdr: hdrgm(all, 'OffsetHDR') ?? [OFFSET, OFFSET, OFFSET]
	};
}

/** Whether `bytes` is a JPEG with a gain map (Ultra HDR / JPEG-R). */
export function isUltraHdr(bytes: Uint8Array): boolean {
	const { xmp, gainMapAt } = jpegParts(bytes);
	if (gainMapAt < 0) return false;
	return gainMapInfo([...xmp, ...jpegParts(bytes, gainMapAt).xmp]) !== undefined;
}

/**
 * The HDR image of a JPEG: an Ultra HDR one's gain map applied in full; a plain one's sRGB pixels as linear.
 */
export async function decodeUltraHdr(bytes: Uint8Array, jpeg: JpegCodec): Promise<HdrImage> {
	const { xmp, gainMapAt } = jpegParts(bytes);
	const sdr = await jpeg.decode(gainMapAt > 0 ? bytes.subarray(0, gainMapAt) : bytes);
	const { width, height } = sdr;
	const out = new Float32Array(width * height * 4);
	const info = gainMapAt > 0 ? gainMapInfo([...xmp, ...jpegParts(bytes, gainMapAt).xmp]) : undefined;
	const map = info ? await jpeg.decode(bytes.subarray(gainMapAt)) : undefined;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const p = y * width + x;
			// The gain map may be smaller: nearest of its pixels.
			const q = map
				? Math.min(map.height - 1, Math.floor((y * map.height) / height)) * map.width +
					Math.min(map.width - 1, Math.floor((x * map.width) / width))
				: 0;
			for (let c = 0; c < 3; c++) {
				const s = srgbToLinear1(sdr.data[p * 4 + c] / 255);
				if (!map || !info) {
					out[p * 4 + c] = s;
					continue;
				}
				const g = map.data[q * 4 + c] / 255;
				const log = info.min[c] + (info.max[c] - info.min[c]) * (info.gamma[c] === 1 ? g : g ** (1 / info.gamma[c]));
				out[p * 4 + c] = Math.max(0, (s + info.offsetSdr[c]) * 2 ** log - info.offsetHdr[c]);
			}
			out[p * 4 + 3] = 1;
		}
	return { width, height, data: out };
}

// ------------------------------------------------------------------------------------------------- data URLs

export function bytesToDataUrl(bytes: Uint8Array, mime = 'image/jpeg'): string {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return `data:${mime};base64,${btoa(s)}`;
}

export function dataUrlToBytes(url: string): Uint8Array {
	const b = atob(url.slice(url.indexOf(',') + 1));
	const out = new Uint8Array(b.length);
	for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
	return out;
}

// ------------------------------------------------------------------------------------------------- in the browser

/** JPEG through the browser's canvas (decode sniffs the format, so PNG and WebP decode too). */
export const canvasJpeg: JpegCodec = {
	async encode(img, quality) {
		const c = new OffscreenCanvas(img.width, img.height);
		c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
		const blob = await c.convertToBlob({ type: 'image/jpeg', quality });
		return new Uint8Array(await blob.arrayBuffer());
	},
	async decode(bytes) {
		const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)]), {
			colorSpaceConversion: 'none',
			premultiplyAlpha: 'none'
		});
		const c = new OffscreenCanvas(bmp.width, bmp.height);
		const ctx = c.getContext('2d', { colorSpace: 'srgb' })!;
		ctx.drawImage(bmp, 0, 0);
		bmp.close();
		const d = ctx.getImageData(0, 0, c.width, c.height);
		return { width: d.width, height: d.height, data: d.data };
	}
};

/** A loader's float pixels (RGBA, or fewer channels) as RGBA, rows top-down. */
function fromLoader(t: { width: number; height: number; data: ArrayLike<number> }, bottomUp: boolean): HdrImage {
	const { width, height } = t;
	const ch = Math.round(t.data.length / (width * height));
	const data = new Float32Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const row = bottomUp ? height - 1 - y : y;
		for (let x = 0; x < width; x++) {
			const i = (row * width + x) * ch;
			const o = (y * width + x) * 4;
			const r = t.data[i];
			data[o] = r;
			data[o + 1] = ch > 1 ? t.data[i + 1] : r;
			data[o + 2] = ch > 2 ? t.data[i + 2] : r;
			data[o + 3] = 1;
		}
	}
	return { width, height, data };
}

/**
 * An image file as linear HDR, whatever it is: OpenEXR and Radiance HDR through three's loaders, an Ultra HDR JPEG
 * with its gain map applied, a plain JPEG, PNG or WebP as its sRGB pixels.
 */
export async function hdrFromFile(file: Blob): Promise<HdrImage> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const head = new TextDecoder().decode(bytes.subarray(0, 10));
	if (bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01) {
		const [{ EXRLoader }, { FloatType }] = await Promise.all([
			import('three/examples/jsm/loaders/EXRLoader.js'),
			import('three')
		]);
		// EXRLoader's rows run bottom-up (flipY false), as a texture's.
		return fromLoader(new EXRLoader().setDataType(FloatType).parse(bytes.buffer) as HdrTexData, true);
	}
	if (head.startsWith('#?')) {
		const [{ HDRLoader }, { FloatType }] = await Promise.all([
			import('three/examples/jsm/loaders/HDRLoader.js'),
			import('three')
		]);
		return fromLoader(new HDRLoader().setDataType(FloatType).parse(bytes.buffer) as HdrTexData, false);
	}
	return decodeUltraHdr(bytes, canvasJpeg);
}

type HdrTexData = { width: number; height: number; data: Float32Array };

/** An environment file as the library stores it: a data URL of an Ultra HDR JPEG at most ENV_WIDTH across. */
export async function environmentFromFile(file: Blob): Promise<string> {
	const hdr = shrinkHdr(await hdrFromFile(file));
	return bytesToDataUrl(await encodeUltraHdr(hdr, canvasJpeg));
}
