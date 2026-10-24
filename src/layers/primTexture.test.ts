import { describe, expect, it } from 'vitest';
import { PRIM_ROW, PrimWriter, TexelReader, binByReach, fitUnit, sizeRange } from './primTexture';
import { memoOn } from '@/core/memo';

describe('primitive textures', () => {
	it('fits the least power-of-two unit that keeps every value in range', () => {
		expect(fitUnit([4000, 4095], [500, sizeRange(64)])).toBe(1);
		expect(fitUnit([4100, 4095])).toBe(2);
		expect(fitUnit([100, 4095], [3000, sizeRange(64)])).toBe(4);
		expect(fitUnit()).toBe(1);
	});

	it('writes records that never straddle a row, values that read back in the unit, then the lists', () => {
		const bins = binByReach([], { width: 64, height: 64, tile: true });
		const w = new PrimWriter(5, 300, bins, 2);
		const r = new TexelReader({
			texture: { width: 0, height: 0, data: w.data },
			count: 300,
			unit: 2,
			grid: [1, 1],
			table: 0,
			list: 0
		});
		// 204 records a row (1020 texels): record 204 starts the second row.
		expect(w.rec(203)).toBe(203 * 5);
		expect(w.rec(204)).toBe(PRIM_ROW);
		expect(r.rec(204, 5)).toBe(PRIM_ROW);
		const t = w.rec(250);
		w.pos(t, 0, 7000.25);
		w.pos(t, 1, -8191);
		w.size(t + 1, 0, 100, 64);
		w.u32(t + 2, 123456789);
		w.u8(t + 3, 2, 300);
		expect([r.pos(t, 0), r.pos(t, 1)]).toEqual([7000.25, -8191]);
		expect((r.u16(t + 1, 0) / 64) * 2).toBe(100);
		expect(r.u32(t + 2)).toBe(123456789);
		expect(r.u8(t + 3, 2)).toBe(255);
		const tex = w.finish();
		// The table starts on the row after the last record's.
		expect(tex.table).toBe(2 * PRIM_ROW);
		expect(tex.texture.height).toBe(3);
	});

	it('lists every item within its reach of a cell, round the wrap when tiling', () => {
		let seed = 7;
		const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
		const W = 120;
		const H = 80;
		const items = Array.from({ length: 60 }, () => ({
			x: rand() * 160 - 20,
			y: rand() * 120 - 20,
			reach: 2 + 20 * rand() ** 2
		}));
		for (const tile of [true, false]) {
			const c = { width: W, height: H, tile };
			const bins = binByReach(items, c);
			const w = new PrimWriter(4, items.length, bins);
			const tex = w.finish();
			const r = new TexelReader(tex);
			expect(tex.grid[0] * tex.grid[1]).toBeGreaterThan(4);
			const wrap = (v: number, m: number) => (tile ? v - m * Math.round(v / m) : v);
			for (let y = -5.5; y < H + 5; y += 2.3)
				for (let x = -5.5; x < W + 5; x += 2.3) {
					const list = r.cellList(x, y, c);
					// In their order, each once.
					expect([...list].sort((a, b) => a - b)).toEqual(list);
					items.forEach((p, i) => {
						if (Math.hypot(wrap(x - p.x, W), wrap(y - p.y, H)) <= p.reach) expect(list).toContain(i);
					});
				}
		}
	});

	it('remembers a result per array by identity and key', () => {
		let calls = 0;
		const f = memoOn((a: number[], k: { s: number }) => (calls++, a.length * k.s));
		const a = [1, 2, 3];
		expect(f(a, { s: 2 })).toBe(6);
		expect(f(a, { s: 2 })).toBe(6);
		expect(calls).toBe(1);
		expect(f([1, 2, 3], { s: 2 })).toBe(6);
		expect(f(a, { s: 3 })).toBe(9);
		expect(calls).toBe(3);
	});
});
