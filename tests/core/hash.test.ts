// The CPU hashes match the shaders' bit for bit (values from the per-generator copies they replaced), and the PRNG
// and union-find behave.
import { describe, expect, it } from 'vitest';
import { hash2I, hash3I, hashI, mulberry32, pcg, pcg2, pcg3, u2d, u2f, unionFind } from '@/core/hash';

describe('core/hash', () => {
	it('pcg, pcg2, pcg3 give the known values', () => {
		expect([0, 1, 12345, 4294967295].map(pcg)).toEqual([129708002, 2831084092, 4099845390, 3861530882]);
		expect(pcg(-1)).toBe(pcg(4294967295));
		expect(pcg2(3, 7)).toBe(925619080);
		expect(pcg3(3, 7, 11)).toBe(2526308981);
		expect(pcg3(-1, -5, 99)).toBe(3647019771);
	});

	it('hashI / hash2I / hash3I round to float32 like the shaders', () => {
		expect(hashI(3, 7, 11)).toBe(0.5882021188735962);
		expect(hashI(-1, -5, 99)).toBe(0.8491379618644714);
		expect(hashI(0, 0, 0)).toBe(0.49947670102119446);
		expect(hash3I(2, 9, 41)).toEqual([0.8476142883300781, 0.005514637567102909, 0.08575807511806488]);
		expect(hash2I(2, 9, 41)).toEqual(hash3I(2, 9, 41).slice(0, 2));
		// uint(seed) of a float uniform: truncated.
		expect(hashI(3, 7, 11.75)).toBe(hashI(3, 7, 11));
		expect(u2f(4294967295)).toBe(1);
		expect(u2d(4294967295)).toBeLessThan(1);
	});

	it('mulberry32 is the known stream', () => {
		const r = mulberry32(42);
		expect([r(), r(), r()]).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
		const a = mulberry32(-7),
			b = mulberry32(4294967289);
		expect(a()).toBe(b());
	});

	it('unionFind joins sets', () => {
		const uf = unionFind(5);
		uf.join(0, 1);
		uf.join(3, 4);
		uf.join(1, 4);
		expect(uf.find(0)).toBe(uf.find(3));
		expect(uf.find(2)).toBe(2);
		expect(uf.find(2)).not.toBe(uf.find(0));
	});
});
