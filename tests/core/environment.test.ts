import { describe, expect, it } from 'vitest';
import jpegJs from 'jpeg-js';
import {
	decodeUltraHdr,
	encodeUltraHdr,
	isUltraHdr,
	shrinkHdr,
	skySamplingTable,
	type HdrImage,
	type JpegCodec
} from '@/core/environment';

const codec: JpegCodec = {
	encode: async (img, quality) =>
		jpegJs.encode({ width: img.width, height: img.height, data: img.data }, Math.round(quality * 100)).data,
	decode: async (bytes) => {
		const d = jpegJs.decode(bytes, { useTArray: true, formatAsRGBA: true });
		return { width: d.width, height: d.height, data: d.data };
	}
};

/** A sky: a blue-to-white dome, dark ground, an orange glow and a sun 30× brighter than white. */
function sky(width = 64, height = 32): HdrImage {
	const data = new Float32Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const up = y < height / 2;
			let c = up ? [0.2 + 0.6 * (y / height), 0.35 + 0.5 * (y / height), 0.9] : [0.05, 0.04, 0.03];
			if (up && x > 40 && x < 50) c = [2.4, 1.1, 0.4];
			if (x >= 44 && x < 46 && y >= 12 && y < 14) c = [30, 28, 24];
			data.set([...c, 1], i);
		}
	return { width, height, data };
}

describe('environment images (Ultra HDR)', () => {
	it('round-trips HDR radiance through the stored JPEG with a gain map', async () => {
		const img = sky();
		const bytes = await encodeUltraHdr(img, codec, 0.95);
		expect(isUltraHdr(bytes)).toBe(true);
		const back = await decodeUltraHdr(bytes, codec);
		expect([back.width, back.height]).toEqual([64, 32]);
		const r = (im: HdrImage, x: number, y: number, c = 0) => im.data[(y * 64 + x) * 4 + c];
		// Smooth regions within a few per cent per channel: the sky, the glow, the dark ground.
		for (const [x, y] of [
			[10, 4],
			[42, 6],
			[10, 24]
		])
			for (let c = 0; c < 3; c++)
				expect(Math.abs(r(back, x, y, c) - r(img, x, y, c))).toBeLessThan(0.03 * r(img, x, y, c) + 0.01);
		// The tiny sun: JPEG rings round a 2 px spike, but its light (the sum round it) comes back.
		let a = 0;
		let b = 0;
		for (let y = 8; y < 18; y++)
			for (let x = 40; x < 50; x++) {
				a += r(img, x, y);
				b += r(back, x, y);
			}
		expect(Math.abs(b - a) / a).toBeLessThan(0.03);
		expect(r(back, 44, 12)).toBeGreaterThan(24);
	});

	it('reads a plain JPEG as linear SDR', async () => {
		const data = new Uint8Array(4 * 4 * 4).fill(255);
		for (let i = 0; i < 16; i++) data.set([188, 188, 188, 255], i * 4);
		const bytes = await codec.encode({ width: 4, height: 4, data }, 1);
		expect(isUltraHdr(bytes)).toBe(false);
		const back = await decodeUltraHdr(bytes, codec);
		expect(back.data[0]).toBeCloseTo(0.5, 1);
	});

	it('scales a big panorama down to 512 across, keeping its energy', () => {
		const big = sky(1024, 512);
		const small = shrinkHdr(big);
		expect([small.width, small.height]).toEqual([512, 256]);
		const sum = (im: HdrImage) => im.data.reduce((s, v, i) => (i % 4 === 0 ? s + v : s), 0) / (im.width * im.height);
		expect(sum(small)).toBeCloseTo(sum(big), 4);
	});

	it("builds the sky's sampling table: CDFs that end at 1, probabilities that sum to 1, a sun drawn in proportion", () => {
		const img = sky(64, 32);
		const { table, tableWidth, upper } = skySamplingTable(img);
		expect([tableWidth, upper]).toEqual([64, 16]);
		let sum = 0;
		for (let y = 0; y < upper; y++) {
			let prev = 0;
			for (let x = 0; x < 64; x++) {
				const cdf = table[(y * tableWidth + x) * 2];
				expect(cdf).toBeGreaterThanOrEqual(prev);
				prev = cdf;
				expect(table[(y * tableWidth + x) * 2 + 1]).toBeGreaterThan(0);
				sum += table[(y * tableWidth + x) * 2 + 1];
			}
			expect(prev).toBe(1);
		}
		expect(sum).toBeCloseTo(1, 5);
		expect(table[(upper * tableWidth + upper - 1) * 2]).toBe(1);
		// The sun (2×2 px at 30×) and its bilinear spill (±1 px) hold most of the draws; the rest of the sky the remainder.
		let sun = 0;
		for (let y = 11; y < 15; y++) for (let x = 43; x < 47; x++) sun += table[(y * tableWidth + x) * 2 + 1];
		expect(sun).toBeGreaterThan(0.5);
	});
});
