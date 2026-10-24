import { describe, expect, it } from 'vitest';
import { hexToRgb, linearToSrgb1, srgbToLinear1, type RGB } from '@/core/color';
import {
	BUILTIN_PALETTES,
	C64_PALETTE,
	DOOM_PALETTE,
	QUAKE_PALETTE,
	RGB332_PALETTE,
	bayerThreshold,
	extractPalette,
	greyRamp,
	nearestColorIndex,
	paletteColors,
	palettizePixel,
	parsePaletteText,
	preparePalette,
	type LinearImage
} from '@/render/post/palettes';

const HEX = /^#[0-9a-f]{6}$/;

describe('built-in palettes', () => {
	it('have the documented sizes and valid hex', () => {
		const sizes: Record<string, number> = {
			quake: 256,
			quake_nofb: 224,
			doom: 256,
			pico8: 16,
			ega: 16,
			cga: 4,
			gameboy: 4,
			c64: 16,
			rgb332: 256,
			grey4: 4,
			grey8: 8,
			grey16: 16
		};
		for (const p of BUILTIN_PALETTES) {
			expect(p.colors.length, p.id).toBe(sizes[p.id]);
			for (const c of p.colors) expect(c).toMatch(HEX);
		}
	});

	it('Quake palette matches known entries', () => {
		expect(QUAKE_PALETTE[0]).toBe('#000000');
		expect(QUAKE_PALETTE[15]).toBe('#ebebeb');
		expect(QUAKE_PALETTE[16]).toBe('#0f0b07');
		expect(QUAKE_PALETTE[254]).toBe('#ffffff');
		expect(QUAKE_PALETTE[255]).toBe('#9f5b53');
	});

	it('Doom palette matches known entries', () => {
		expect(DOOM_PALETTE.slice(0, 5)).toEqual(['#000000', '#1f170b', '#170f07', '#4b4b4b', '#ffffff']);
		expect(DOOM_PALETTE[255]).toBe('#a76b6b');
	});

	it('RGB332 has 256 distinct colours covering the corners', () => {
		expect(new Set(RGB332_PALETTE).size).toBe(256);
		expect(RGB332_PALETTE[0]).toBe('#000000');
		expect(RGB332_PALETTE[255]).toBe('#ffffff');
		expect(RGB332_PALETTE[0b11100000]).toBe('#ff0000');
		expect(RGB332_PALETTE[0b00000011]).toBe('#0000ff');
	});

	it('C64 and grey ramps', () => {
		expect(C64_PALETTE[1]).toBe('#ffffff');
		expect(greyRamp(4)).toEqual(['#000000', '#555555', '#aaaaaa', '#ffffff']);
	});

	it('paletteColors resolves built-ins and custom text', () => {
		expect(paletteColors('pico8')).toHaveLength(16);
		expect(paletteColors('custom', '#ff0000 #00ff00')).toEqual(['#ff0000', '#00ff00']);
		expect(paletteColors('custom', '')).toEqual([]);
		expect(paletteColors('nonsense')).toEqual(QUAKE_PALETTE);
	});

	it('every palette colour survives the linear float32 round trip of the export exactly', () => {
		// The shader writes srgbToLinear(byte/255) as float32; export does round(linearToSrgb(v) * 255).
		for (let b = 0; b < 256; b++) {
			const v = Math.fround(srgbToLinear1(b / 255));
			expect(Math.round(linearToSrgb1(Math.min(1, v)) * 255)).toBe(b);
		}
	});
});

describe('parsePaletteText', () => {
	it('parses hex lists with assorted separators', () => {
		expect(parsePaletteText('#FF8800, 00ff00;#00F\n  123456  ')).toEqual(['#ff8800', '#00ff00', '#0000ff', '#123456']);
	});

	it('keeps order and duplicates', () => {
		expect(parsePaletteText('#000000 #ffffff #000000')).toEqual(['#000000', '#ffffff', '#000000']);
	});

	it('handles 8-digit forms and 0x', () => {
		expect(parsePaletteText('#ff880080')).toEqual(['#ff8800']);
		expect(parsePaletteText('FFFF8800')).toEqual(['#ff8800']); // Paint.NET AARRGGBB
		expect(parsePaletteText('0xff8800')).toEqual(['#ff8800']);
	});

	it('ignores comments and junk', () => {
		expect(
			parsePaletteText('; paint.net palette\n# a comment line\n#ff0000 // red\nhello world\n#00ff00 ; green')
		).toEqual(['#ff0000', '#00ff00']);
		expect(parsePaletteText('')).toEqual([]);
	});

	it('parses decimal triplets', () => {
		expect(parsePaletteText('255 136 0\n0,255,0\nrgb(0, 0, 255)\n300 0 0')).toEqual(['#ff8800', '#00ff00', '#0000ff']);
	});

	it('parses GIMP .gpl', () => {
		const gpl = 'GIMP Palette\nName: Test\nColumns: 4\n#\n  0   0   0\tBlack\n255 255 255\tWhite\n';
		expect(parsePaletteText(gpl)).toEqual(['#000000', '#ffffff']);
	});

	it('parses JASC-PAL', () => {
		const pal = 'JASC-PAL\r\n0100\r\n3\r\n255 0 0\r\n0 255 0\r\n0 0 255\r\n';
		expect(parsePaletteText(pal)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
	});
});

describe('nearest colour (CPU reference)', () => {
	it('maps every palette colour to an identical entry', () => {
		for (const p of BUILTIN_PALETTES) {
			const prep = preparePalette(p.colors);
			for (const metric of ['oklab', 'rgb'] as const) {
				for (let i = 0; i < p.colors.length; i++) {
					const j = nearestColorIndex(prep.srgb[i], prep, metric);
					expect(p.colors[j], `${p.id} ${metric} #${i}`).toBe(p.colors[i]);
				}
			}
		}
	});

	it('picks the closest grey', () => {
		const prep = preparePalette(greyRamp(4));
		expect(nearestColorIndex([0.3, 0.3, 0.3], prep, 'rgb')).toBe(1);
		expect(nearestColorIndex([0.9, 0.9, 0.9], prep, 'rgb')).toBe(3);
		expect(nearestColorIndex([0.1, 0.1, 0.1], prep, 'oklab')).toBe(0);
	});

	it('OKLab and RGB can disagree (perceptual vs encoded distance)', () => {
		// Saturated blue vs a dark grey / a light grey: RGB distance and OKLab distance rank them differently.
		const prep = preparePalette(['#000000', '#7f7f7f', '#0000ff']);
		let differs = false;
		for (let b = 0; b <= 1; b += 0.05) {
			const c: RGB = [0.3, 0.3, b];
			if (nearestColorIndex(c, prep, 'oklab') !== nearestColorIndex(c, prep, 'rgb')) differs = true;
		}
		expect(differs).toBe(true);
	});

	it('spread equals the step of an even grey ramp', () => {
		expect(preparePalette(greyRamp(4)).spread).toBeCloseTo(1 / 3, 6);
		expect(preparePalette(greyRamp(16)).spread).toBeCloseTo(1 / 15, 6);
		expect(preparePalette(['#123456']).spread).toBe(0);
	});
});

describe('Bayer dithering', () => {
	it.each([2, 4, 8])('%i×%i matrix is a permutation with zero mean', (n) => {
		const seen = new Set<number>();
		let sum = 0;
		for (let y = 0; y < n; y++)
			for (let x = 0; x < n; x++) {
				const t = bayerThreshold(x, y, n);
				expect(t).toBeGreaterThan(-0.5);
				expect(t).toBeLessThan(0.5);
				seen.add(Math.round((t + 0.5) * n * n - 0.5));
				sum += t;
			}
		expect(seen.size).toBe(n * n);
		expect(sum).toBeCloseTo(0, 9);
		expect(bayerThreshold(n, 0, n)).toBe(bayerThreshold(0, 0, n)); // tiles with period n
	});

	it('2×2 is the classic [[0,2],[3,1]]', () => {
		const idx = (x: number, y: number) => Math.round((bayerThreshold(x, y, 2) + 0.5) * 4 - 0.5);
		expect([idx(0, 0), idx(1, 0), idx(0, 1), idx(1, 1)]).toEqual([0, 2, 3, 1]);
	});

	it('dithers a mid grey between two greys in the right proportion', () => {
		const prep = preparePalette(['#000000', '#ffffff']);
		const lin = srgbToLinear1(0.25);
		let white = 0;
		for (let y = 0; y < 4; y++)
			for (let x = 0; x < 4; x++)
				if (palettizePixel([lin, lin, lin], x, y, prep, { bayer: 4, metric: 'rgb' }) === 1) white++;
		expect(white).toBe(4); // 25% of 16
		// Without dithering everything snaps to black.
		expect(palettizePixel([lin, lin, lin], 0, 0, prep, { metric: 'rgb' })).toBe(0);
	});
});

describe('extractPalette', () => {
	function image(colors: string[], counts: number[], jitter = 0): LinearImage {
		const total = counts.reduce((a, b) => a + b, 0);
		const data = new Float32Array(total * 4);
		let k = 0;
		let seed = 1;
		const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * jitter;
		colors.forEach((hex, ci) => {
			const c = hexToRgb(hex);
			for (let i = 0; i < counts[ci]; i++, k++) {
				for (let ch = 0; ch < 3; ch++) data[k * 4 + ch] = srgbToLinear1(Math.min(1, Math.max(0, c[ch] + rnd())));
				data[k * 4 + 3] = 1;
			}
		});
		return { width: total, height: 1, data };
	}

	it('returns the exact colours when the image has no more than n', () => {
		const img = image(['#ff0000', '#00ff00', '#202020'], [10, 5, 3]);
		expect(new Set(extractPalette(img, 3))).toEqual(new Set(['#ff0000', '#00ff00', '#202020']));
		expect(extractPalette(img, 3)[0]).toBe('#202020'); // darkest first
		expect(extractPalette(img, 8)).toHaveLength(3);
	});

	it('finds cluster centres of noisy colours', () => {
		const img = image(['#c03020', '#2040c0', '#e0e0a0'], [400, 300, 200], 0.06);
		const pal = extractPalette(img, 3);
		expect(pal).toHaveLength(3);
		const targets = ['#c03020', '#2040c0', '#e0e0a0'].map(hexToRgb);
		for (const t of targets) {
			const best = Math.min(...pal.map((h) => Math.max(...hexToRgb(h).map((v, i) => Math.abs(v - t[i])))));
			expect(best).toBeLessThan(0.03);
		}
	});

	it('is deterministic and sorted dark → light', () => {
		const img = image(['#101010', '#808080', '#f0f0f0', '#ff0000'], [50, 50, 50, 50], 0.1);
		const a = extractPalette(img, 4);
		expect(extractPalette(img, 4)).toEqual(a);
		expect(a[0]).toBe(extractPalette(img, 4)[0]);
		const L = a.map((h) => preparePalette([h]).oklab[0][0]);
		expect([...L].sort((x, y) => x - y)).toEqual(L);
	});

	it('ignores transparent pixels unless everything is transparent', () => {
		const img = image(['#ff0000', '#0000ff'], [4, 4]);
		for (let i = 4; i < 8; i++) img.data[i * 4 + 3] = 0;
		expect(extractPalette(img, 4)).toEqual(['#ff0000']);
		for (let i = 0; i < 4; i++) img.data[i * 4 + 3] = 0;
		expect(extractPalette(img, 4)).toHaveLength(2);
	});

	it('copes with many distinct colours and n = 256', () => {
		const w = 128;
		const h = 128;
		const data = new Float32Array(w * h * 4);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				const i = (y * w + x) * 4;
				data[i] = x / (w - 1);
				data[i + 1] = y / (h - 1);
				data[i + 2] = ((x * 7 + y * 13) % 97) / 96;
				data[i + 3] = 1;
			}
		const pal = extractPalette({ width: w, height: h, data }, 256);
		expect(pal.length).toBeGreaterThan(200);
		expect(pal.length).toBeLessThanOrEqual(256);
		for (const c of pal) expect(c).toMatch(HEX);
	});
});
