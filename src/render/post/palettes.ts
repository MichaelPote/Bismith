// Palettes for the Palette post filter (docs/features/fr4.2-palettisation.md) plus the pure-TS helpers behind
// it: hex-list parsing, a CPU reference of the GPU quantiser (nearest colour + ordered dithering) and k-means
// palette extraction for the UI's "Extract palette from render" button.
//
// Colours are sRGB hex strings ("#rrggbb"); quantisation happens in sRGB-encoded space.

import {
	clamp01,
	hexToRgb,
	linearToSrgb,
	linearToSrgb1,
	oklabToSrgb,
	rgbToHex,
	srgbToLinear,
	srgbToOklab,
	type RGB
} from '@/core/color';
import { mulberry32 } from '@/core/hash';

/** Upper bound on palette size (the GPU lookup texture is 256 entries wide). */
export const MAX_PALETTE = 256;

function hexRows(rows: string[]): string[] {
	return rows
		.join(' ')
		.trim()
		.split(/\s+/)
		.map((h) => '#' + h.toLowerCase());
}

/**
 * Quake (1996) `gfx/palette.lmp`, 256 entries. Copied byte-for-byte from `host_quakepal[768]` in DarkPlaces
 * `palette.c` (https://github.com/DarkPlacesEngine/darkplaces/blob/master/palette.c — "John Carmack said the
 * quake palette.lmp can be considered public domain") and cross-checked against SLADE's
 * `dist/res/palettes/Quake .pal` (https://github.com/sirjuddington/SLADE): identical.
 * Indices 224–255 are fullbrights (drawn unlit by the engine); 255 is the transparent index for `{` textures.
 */
export const QUAKE_PALETTE = hexRows([
	'000000 0f0f0f 1f1f1f 2f2f2f 3f3f3f 4b4b4b 5b5b5b 6b6b6b 7b7b7b 8b8b8b 9b9b9b ababab bbbbbb cbcbcb dbdbdb ebebeb',
	'0f0b07 170f0b 1f170b 271b0f 2f2313 372b17 3f2f17 4b371b 533b1b 5b431f 634b1f 6b531f 73571f 7b5f23 836723 8f6f23',
	'0b0b0f 13131b 1b1b27 272733 2f2f3f 37374b 3f3f57 474767 4f4f73 5b5b7f 63638b 6b6b97 7373a3 7b7baf 8383bb 8b8bcb',
	'000000 070700 0b0b00 131300 1b1b00 232300 2b2b07 2f2f07 373707 3f3f07 474707 4b4b0b 53530b 5b5b0b 63630b 6b6b0f',
	'070000 0f0000 170000 1f0000 270000 2f0000 370000 3f0000 470000 4f0000 570000 5f0000 670000 6f0000 770000 7f0000',
	'131300 1b1b00 232300 2f2b00 372f00 433700 4b3b07 574307 5f4707 6b4b0b 77530f 835713 8b5b13 975f1b a3631f af6723',
	'231307 2f170b 3b1f0f 4b2313 572b17 632f1f 733723 7f3b2b 8f4333 9f4f33 af632f bf772f cf8f2b dfab27 efcb1f fff31b',
	'0b0700 1b1300 2b230f 372b13 47331b 533723 633f2b 6f4733 7f533f 8b5f47 9b6b53 a77b5f b7876b c3937b d3a38b e3b397',
	'ab8ba3 9f7f97 937387 8b677b 7f5b6f 775363 6b4b57 5f3f4b 573743 4b2f37 43272f 371f23 2b171b 231313 170b0b 0f0707',
	'bb739f af6b8f a35f83 975777 8b4f6b 7f4b5f 734353 6b3b4b 5f333f 532b37 47232b 3b1f23 2f171b 231313 170b0b 0f0707',
	'dbc3bb cbb3a7 bfa39b af978b a3877b 977b6f 876f5f 7b6353 6b5747 5f4b3b 533f33 433327 372b1f 271f17 1b130f 0f0b07',
	'6f837b 677b6f 5f7367 576b5f 4f6357 475b4f 3f5347 374b3f 2f4337 2b3b2f 233327 1f2b1f 172317 0f1b13 0b130b 070b07',
	'fff31b efdf17 dbcb13 cbb70f bba70f ab970b 9b8307 8b7307 7b6307 6b5300 5b4700 4b3700 3b2b00 2b1f00 1b0f00 0b0700',
	'0000ff 0b0bef 1313df 1b1bcf 2323bf 2b2baf 2f2f9f 2f2f8f 2f2f7f 2f2f6f 2f2f5f 2b2b4f 23233f 1b1b2f 13131f 0b0b0f',
	'2b0000 3b0000 4b0700 5f0700 6f0f00 7f1707 931f07 a3270b b7330f c34b1b cf632b db7f3b e3974f e7ab5f efbf77 f7d38b',
	'a77b3b b79b37 c7c337 e7e357 7fbfff abe7ff d7ffff 670000 8b0000 b30000 d70000 ff0000 fff393 fff7c7 ffffff 9f5b53'
]);

/**
 * Doom (1993, id Software) PLAYPAL, first (normal) palette, 256 entries. From SLADE's `dist/res/palettes/Doom .pal`
 * (https://github.com/sirjuddington/SLADE, a full 14-palette PLAYPAL; first 768 bytes) and cross-checked against
 * omgifol's `default_colors` (https://github.com/devinacker/omgifol/blob/master/omg/palette.py): identical.
 */
export const DOOM_PALETTE = hexRows([
	'000000 1f170b 170f07 4b4b4b ffffff 1b1b1b 131313 0b0b0b 070707 2f371f 232b0f 171f07 0f1700 4f3b2b 473323 3f2b1b',
	'ffb7b7 f7abab f3a3a3 eb9797 e78f8f df8787 db7b7b d37373 cb6b6b c76363 bf5b5b bb5757 b34f4f af4747 a73f3f a33b3b',
	'9b3333 972f2f 8f2b2b 8b2323 831f1f 7f1b1b 771717 731313 6b0f0f 670b0b 5f0707 5b0707 530707 4f0000 470000 430000',
	'ffebdf ffe3d3 ffdbc7 ffd3bb ffcfb3 ffc7a7 ffbf9b ffbb93 ffb383 f7ab7b efa373 e79b6b df9363 d78b5b cf8353 cb7f4f',
	'bf7b4b b37347 ab6f43 a36b3f 9b633b 8f5f37 875733 7f532f 774f2b 6b4727 5f4323 533f1f 4b371b 3f2f17 332b13 2b230f',
	'efefef e7e7e7 dfdfdf dbdbdb d3d3d3 cbcbcb c7c7c7 bfbfbf b7b7b7 b3b3b3 ababab a7a7a7 9f9f9f 979797 939393 8b8b8b',
	'838383 7f7f7f 777777 6f6f6f 6b6b6b 636363 5b5b5b 575757 4f4f4f 474747 434343 3b3b3b 373737 2f2f2f 272727 232323',
	'77ff6f 6fef67 67df5f 5fcf57 5bbf4f 53af47 4b9f3f 439337 3f832f 37732b 2f6323 27531b 1f4317 17330f 13230b 0b1707',
	'bfa78f b79f87 af977f a78f77 9f876f 9b7f6b 937b63 8b735b 836b57 7b634f 775f4b 6f5743 67533f 5f4b37 574333 533f2f',
	'9f8363 8f7753 836b4b 775f3f 675333 5b472b 4f3b23 43331b 7b7f63 6f7357 676b4f 5b6347 53573b 474f33 3f472b 373f27',
	'ffff73 ebdb57 d7bb43 c39b2f af7b1f 9b5b13 874307 732b00 ffffff ffdbdb ffbbbb ff9b9b ff7b7b ff5f5f ff3f3f ff1f1f',
	'ff0000 ef0000 e30000 d70000 cb0000 bf0000 b30000 a70000 9b0000 8b0000 7f0000 730000 670000 5b0000 4f0000 430000',
	'e7e7ff c7c7ff ababff 8f8fff 7373ff 5353ff 3737ff 1b1bff 0000ff 0000e3 0000cb 0000b3 00009b 000083 00006b 000053',
	'ffffff ffebdb ffd7bb ffc79b ffb37b ffa35b ff8f3b ff7f1b f37317 eb6f0f df670f d75f0b cb5707 c34f00 b74700 af4300',
	'ffffff ffffd7 ffffb3 ffff8f ffff6b ffff47 ffff23 ffff00 a73f00 9f3700 932f00 872300 4f3b27 432f1b 372313 2f1b0b',
	'000053 000047 00003b 00002f 000023 000017 00000b 000000 ff9f43 ffe74b ff7bff ff00ff cf00cf 9f009b 6f006b a76b6b'
]);

/** PICO-8 (Lexaloffle), the 16 standard colours. */
export const PICO8_PALETTE = hexRows([
	'000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa'
]);

/** IBM EGA / CGA 16-colour RGBI palette (with the brown fix-up at index 6). */
export const EGA_PALETTE = hexRows([
	'000000 0000aa 00aa00 00aaaa aa0000 aa00aa aa5500 aaaaaa 555555 5555ff 55ff55 55ffff ff5555 ff55ff ffff55 ffffff'
]);

/** CGA 320×200 mode 4, palette 1 high intensity: black, light cyan, light magenta, white. */
export const CGA_PALETTE = hexRows(['000000 55ffff ff55ff ffffff']);

/** Original Game Boy (DMG) greens, dark → light (the widely used emulator approximation). */
export const GAMEBOY_PALETTE = hexRows(['0f380f 306230 8bac0f 9bbc0f']);

/** Commodore 64 VIC-II, Philip "Pepto" Timmermann's measured palette (VICE "pepto-pal"). */
export const C64_PALETTE = hexRows([
	'000000 ffffff 68372b 70a4b2 6f3d86 588d43 352879 b8c76f 6f4f25 433900 9a6759 444444 6c6c6c 9ad284 6c5eb5 959595'
]);

/** 8-bit truecolour: 3 bits red, 3 bits green, 2 bits blue (index = rrrgggbb). */
export const RGB332_PALETTE: string[] = Array.from({ length: 256 }, (_, i) =>
	rgbToHex([((i >> 5) & 7) / 7, ((i >> 2) & 7) / 7, (i & 3) / 3])
);

export function greyRamp(n: number): string[] {
	return Array.from({ length: n }, (_, i) => rgbToHex([i / (n - 1), i / (n - 1), i / (n - 1)]));
}

/** Example shown in the custom palette box: "Sweetie 16" by GrafxKid (free to use, via lospec.com). */
export const DEFAULT_CUSTOM_PALETTE =
	'#1a1c2c #5d275d #b13e53 #ef7d57 #ffcd75 #a7f070 #38b764 #257179\n#29366f #3b5dc9 #41a6f6 #73eff7 #f4f4f4 #94b0c2 #566c86 #333c57';

export interface PaletteInfo {
	id: string;
	label: string;
	colors: string[];
}

export const BUILTIN_PALETTES: PaletteInfo[] = [
	{ id: 'quake', label: 'Quake (256)', colors: QUAKE_PALETTE },
	{ id: 'quake_nofb', label: 'Quake, no fullbrights (224)', colors: QUAKE_PALETTE.slice(0, 224) },
	{ id: 'doom', label: 'Doom (256)', colors: DOOM_PALETTE },
	{ id: 'pico8', label: 'PICO-8 (16)', colors: PICO8_PALETTE },
	{ id: 'ega', label: 'EGA (16)', colors: EGA_PALETTE },
	{ id: 'cga', label: 'CGA mode 4, pal 1 (4)', colors: CGA_PALETTE },
	{ id: 'gameboy', label: 'Game Boy (4)', colors: GAMEBOY_PALETTE },
	{ id: 'c64', label: 'Commodore 64 (16)', colors: C64_PALETTE },
	{ id: 'rgb332', label: 'RGB332 (256)', colors: RGB332_PALETTE },
	{ id: 'grey4', label: 'Greyscale (4)', colors: greyRamp(4) },
	{ id: 'grey8', label: 'Greyscale (8)', colors: greyRamp(8) },
	{ id: 'grey16', label: 'Greyscale (16)', colors: greyRamp(16) }
];

/** Enum options for the filter's `palette` param (built-ins, then custom). */
export const PALETTE_OPTIONS: [string, string][] = [
	...BUILTIN_PALETTES.map((p): [string, string] => [p.id, p.label]),
	['custom', 'Custom (hex list)']
];

/** The colours for a palette id; `custom` parses `customText`. At most MAX_PALETTE entries. */
export function paletteColors(id: string, customText = ''): string[] {
	const builtin = BUILTIN_PALETTES.find((p) => p.id === id);
	const colors = builtin ? builtin.colors : id === 'custom' ? parsePaletteText(customText) : QUAKE_PALETTE;
	return colors.slice(0, MAX_PALETTE);
}

// ------------------------------------------------------------------ parsing

const HEX_TOKEN = /(#?)\b([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const RGB_TRIPLET = /^\s*(?:rgba?\s*\(\s*)?(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})(?![\d.])/i;

function byteHex(r: number, g: number, b: number): string | null {
	return r > 255 || g > 255 || b > 255 ? null : rgbToHex([r / 255, g / 255, b / 255]);
}

/**
 * Parse a pasted palette into "#rrggbb" strings (order and duplicates kept, so indices survive). Accepts:
 * - hex lists separated by spaces, commas, semicolons or newlines: `#ff8800`, `ff8800`, `#f80` (3-digit needs
 *   the `#`), `#ff8800cc` (CSS RGBA; alpha ignored), `ccff8800` (Paint.NET AARRGGBB, no `#`);
 * - decimal triplets one per line: `255 136 0`, `255,136,0`, `rgb(255, 136, 0)`;
 * - GIMP `.gpl` and JASC-PAL `.pal` files (headers skipped);
 * - comments: lines starting with `;` or `# `, and anything after `//`. Also `0xrrggbb`.
 */
export function parsePaletteText(text: string): string[] {
	const out: string[] = [];
	let lines = text.replace(/\r\n?/g, '\n').split('\n');
	const first = lines.find((l) => l.trim() !== '')?.trim() ?? '';
	let numericOnly = false;
	if (/^JASC-PAL$/i.test(first)) {
		const i = lines.findIndex((l) => l.trim() !== '');
		lines = lines.slice(i + 3); // JASC-PAL, version, count
		numericOnly = true;
	} else if (/^GIMP Palette$/i.test(first)) {
		const i = lines.findIndex((l) => l.trim() !== '');
		lines = lines.slice(i + 1).filter((l) => !/^\s*[A-Za-z][\w ]*:/.test(l)); // Name:, Columns:
		numericOnly = true;
	}
	for (const raw of lines) {
		let line = raw.replace(/^\s*;.*$/, '').replace(/\/\/.*$/, '');
		if (/^\s*#(\s|$)/.test(line)) continue; // "# comment"
		const trip = RGB_TRIPLET.exec(line);
		if (trip) {
			const hex = byteHex(Number(trip[1]), Number(trip[2]), Number(trip[3]));
			if (hex) out.push(hex);
			continue;
		}
		if (numericOnly) continue;
		line = line.replace(/rgba?\([^)]*\)/gi, ' ').replace(/\b0x(?=[0-9a-f]{6}\b)/gi, '#');
		for (const m of line.matchAll(HEX_TOKEN)) {
			const hash = m[1] === '#';
			let h = m[2].toLowerCase();
			if (h.length === 3) {
				if (!hash) continue; // bare 3-digit tokens are too ambiguous ("256", "100")
				h = h
					.split('')
					.map((c) => c + c)
					.join('');
			} else if (h.length === 8) {
				h = hash ? h.slice(0, 6) : h.slice(2); // #RRGGBBAA vs Paint.NET AARRGGBB
			}
			out.push('#' + h);
		}
	}
	return out;
}

// ------------------------------------------------------------------ CPU reference quantiser

export type PaletteMetric = 'oklab' | 'rgb';

/** A palette prepared for lookups: sRGB-encoded 0..1, OKLab and the exact linear values the shader outputs. */
export interface PreparedPalette {
	srgb: RGB[];
	oklab: RGB[];
	linear: RGB[];
	/** Ordered-dither amplitude (see paletteSpread). */
	spread: number;
}

export function preparePalette(colors: string[]): PreparedPalette {
	const srgb = colors.map(hexToRgb);
	return {
		srgb,
		oklab: srgb.map(srgbToOklab),
		linear: srgb.map(srgbToLinear),
		spread: paletteSpread(srgb)
	};
}

function dist2(a: RGB, b: RGB): number {
	const x = a[0] - b[0];
	const y = a[1] - b[1];
	const z = a[2] - b[2];
	return x * x + y * y + z * z;
}

/**
 * Index of the palette entry nearest to an sRGB-encoded colour (0..1). `oklab` measures in OKLab
 * (perceptual), `rgb` in sRGB-encoded RGB. Ties go to the lowest index (as on the GPU).
 */
export function nearestColorIndex(srgb: RGB, palette: PreparedPalette, metric: PaletteMetric = 'oklab'): number {
	const q: RGB = metric === 'oklab' ? srgbToOklab([clamp01(srgb[0]), clamp01(srgb[1]), clamp01(srgb[2])]) : srgb;
	const pts = metric === 'oklab' ? palette.oklab : palette.srgb;
	let best = 0;
	let bestD = Infinity;
	for (let i = 0; i < pts.length; i++) {
		const d = dist2(q, pts[i]);
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}

/** Ordered-dither threshold in (-0.5, 0.5) for an n×n Bayer matrix (n = 2, 4 or 8); x, y in image px (y down). */
export function bayerThreshold(x: number, y: number, n: number): number {
	const bits = Math.round(Math.log2(n));
	let v = 0;
	for (let i = 0; i < bits; i++) {
		const bx = (x >> i) & 1;
		const by = (y >> i) & 1;
		v += (((bx ^ by) << 1) | by) * Math.pow(4, bits - 1 - i);
	}
	return (v + 0.5) / (n * n) - 0.5;
}

/**
 * Ordered-dither amplitude for a palette (sRGB 0..1 colours): the mean per-channel step (Chebyshev distance, sRGB-encoded) from each
 * colour to its nearest neighbour. Exactly the step for evenly spaced grey ramps (1/3 for 4 greys).
 */
export function paletteSpread(s: RGB[]): number {
	if (s.length < 2) return 0;
	let sum = 0;
	for (let i = 0; i < s.length; i++) {
		let bestD = Infinity;
		let cheb = 0;
		for (let j = 0; j < s.length; j++) {
			if (j === i) continue;
			const d = dist2(s[i], s[j]);
			if (d > 0 && d < bestD) {
				bestD = d;
				cheb = Math.max(Math.abs(s[i][0] - s[j][0]), Math.abs(s[i][1] - s[j][1]), Math.abs(s[i][2] - s[j][2]));
			}
		}
		sum += cheb;
	}
	return sum / s.length;
}

export interface PalettizeOptions {
	metric?: PaletteMetric;
	/** 0 = none, else 2, 4 or 8. */
	bayer?: number;
	strength?: number;
}

/**
 * CPU reference of the Palette filter's colour path for one linear RGB pixel at image px (x, y; y down):
 * linear → sRGB, + Bayer offset × spread × strength, nearest entry. Returns the palette index.
 */
export function palettizePixel(
	linear: RGB,
	x: number,
	y: number,
	palette: PreparedPalette,
	opts: PalettizeOptions = {}
): number {
	let e = linearToSrgb([clamp01(linear[0]), clamp01(linear[1]), clamp01(linear[2])]);
	if (opts.bayer) {
		const t = bayerThreshold(x, y, opts.bayer) * palette.spread * (opts.strength ?? 1);
		e = [clamp01(e[0] + t), clamp01(e[1] + t), clamp01(e[2] + t)];
	}
	return nearestColorIndex(e, palette, opts.metric ?? 'oklab');
}

// ------------------------------------------------------------------ k-means palette extraction

export interface LinearImage {
	width: number;
	height: number;
	/** Linear RGBA float, rows top-down (Engine.readFinal()). */
	data: Float32Array;
}

const MAX_POINTS = 16384;

/**
 * Extract an `n`-colour palette from a rendered image: k-means in OKLab (k-means++ seeding, deterministic),
 * over a weighted colour histogram of the opaque pixels (8-bit sRGB, coarsened if it has too many distinct
 * colours). Returns sRGB hex colours sorted dark → light; fewer than `n` when the image has fewer distinct
 * colours.
 */
export function extractPalette(img: LinearImage, n: number): string[] {
	const k = Math.max(1, Math.min(MAX_PALETTE, Math.round(n)));
	const px = img.width * img.height;
	const d = img.data;
	let anyOpaque = false;
	for (let i = 0; i < px; i++)
		if (d[i * 4 + 3] >= 0.5) {
			anyOpaque = true;
			break;
		}

	// Histogram of 8-bit sRGB colours; coarsen (drop low bits) until it is small enough.
	const bytes = new Uint8Array(px * 3);
	const keep = new Uint8Array(px);
	for (let i = 0; i < px; i++) {
		if (anyOpaque && d[i * 4 + 3] < 0.5) continue;
		keep[i] = 1;
		for (let c = 0; c < 3; c++) bytes[i * 3 + c] = Math.round(linearToSrgb1(Math.min(1, d[i * 4 + c])) * 255);
	}
	let shift = 0;
	let bins: Map<number, { n: number; r: number; g: number; b: number }>;
	for (;;) {
		bins = new Map();
		for (let i = 0; i < px; i++) {
			if (!keep[i]) continue;
			const r = bytes[i * 3];
			const g = bytes[i * 3 + 1];
			const b = bytes[i * 3 + 2];
			const key = ((r >> shift) << 16) | ((g >> shift) << 8) | (b >> shift);
			let bin = bins.get(key);
			if (!bin) bins.set(key, (bin = { n: 0, r: 0, g: 0, b: 0 }));
			bin.n++;
			bin.r += r;
			bin.g += g;
			bin.b += b;
		}
		if (bins.size <= MAX_POINTS || shift >= 4) break;
		shift++;
	}

	const pts: RGB[] = [];
	const w: number[] = [];
	for (const bin of bins.values()) {
		pts.push(srgbToOklab([bin.r / bin.n / 255, bin.g / bin.n / 255, bin.b / bin.n / 255]));
		w.push(bin.n);
	}
	const sortLight = (cs: RGB[]) => cs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
	const toHex = (lab: RGB) => rgbToHex(oklabToSrgb(lab));
	if (pts.length === 0) return [];
	if (pts.length <= k && shift === 0) return [...new Set(sortLight(pts).map(toHex))];

	// Deterministic, so "Extract palette" gives the same answer for the same image.
	const rand = mulberry32(0x5eed + k);
	const m = pts.length;
	// k-means++ seeding (weighted by histogram counts).
	const centres: RGB[] = [];
	const nearD = new Float64Array(m).fill(Infinity);
	let total = 0;
	for (let i = 0; i < m; i++) total += w[i];
	let r = rand() * total;
	let first = 0;
	for (; first < m - 1; first++) if ((r -= w[first]) <= 0) break;
	centres.push([...pts[first]] as RGB);
	while (centres.length < Math.min(k, m)) {
		const c = centres[centres.length - 1];
		let sum = 0;
		for (let i = 0; i < m; i++) {
			const dd = dist2(pts[i], c);
			if (dd < nearD[i]) nearD[i] = dd;
			sum += nearD[i] * w[i];
		}
		if (sum <= 0) break; // fewer distinct colours than k
		r = rand() * sum;
		let pick = 0;
		for (; pick < m - 1; pick++) if ((r -= nearD[pick] * w[pick]) <= 0) break;
		centres.push([...pts[pick]] as RGB);
	}

	// Lloyd iterations.
	const kk = centres.length;
	const assign = new Int32Array(m).fill(-1);
	const maxIter = Math.max(4, Math.min(40, Math.floor(2e8 / (m * kk))));
	for (let iter = 0; iter < maxIter; iter++) {
		let changed = 0;
		for (let i = 0; i < m; i++) {
			let best = 0;
			let bestD = Infinity;
			for (let j = 0; j < kk; j++) {
				const dd = dist2(pts[i], centres[j]);
				if (dd < bestD) {
					bestD = dd;
					best = j;
				}
			}
			if (assign[i] !== best) {
				assign[i] = best;
				changed++;
			}
		}
		const acc = Array.from({ length: kk }, () => [0, 0, 0, 0]);
		for (let i = 0; i < m; i++) {
			const a = acc[assign[i]];
			a[0] += pts[i][0] * w[i];
			a[1] += pts[i][1] * w[i];
			a[2] += pts[i][2] * w[i];
			a[3] += w[i];
		}
		for (let j = 0; j < kk; j++) {
			const a = acc[j];
			if (a[3] > 0) {
				centres[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
			} else {
				// Empty cluster: move it to the point worst served by its centre.
				let worst = 0;
				let worstD = -1;
				for (let i = 0; i < m; i++) {
					const dd = dist2(pts[i], centres[assign[i]]) * w[i];
					if (dd > worstD) {
						worstD = dd;
						worst = i;
					}
				}
				centres[j] = [...pts[worst]] as RGB;
				changed++;
			}
		}
		if (changed === 0) break;
	}
	return [...new Set(sortLight(centres).map(toHex))];
}
