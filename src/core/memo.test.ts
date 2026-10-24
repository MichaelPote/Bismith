// The memos rerun a computation only when an input it read changes, and keep the last few results.
import { describe, expect, it } from 'vitest';
import { Lru, memoize, memoKey, memoReads } from './memo';

describe('core/memo', () => {
	it('memoKey tells values apart', () => {
		expect(memoKey([1, 'a', { b: [true] }])).toBe(memoKey([1, 'a', { b: [true] }]));
		expect(memoKey([Infinity])).not.toBe(memoKey([null]));
		expect(memoKey([NaN])).not.toBe(memoKey([-Infinity]));
		expect(memoKey(undefined)).toBe('undefined');
	});

	it('Lru keeps the most recently used', () => {
		const lru = new Lru<number>(2);
		let runs = 0;
		const get = (k: string) => lru.get(k, () => ++runs);
		get('a');
		get('b');
		get('a'); // a is now the most recent
		get('c'); // evicts b
		expect(runs).toBe(3);
		get('a');
		expect(runs).toBe(3);
		get('b');
		expect(runs).toBe(4);
	});

	it('memoize keys on the arguments’ values', () => {
		let runs = 0;
		const f = memoize((a: number, o: { x: number }) => (runs++, a + o.x), 4);
		expect(f(1, { x: 2 })).toBe(3);
		expect(f(1, { x: 2 })).toBe(3);
		expect(runs).toBe(1);
		expect(f(1, { x: 3 })).toBe(4);
		expect(runs).toBe(2);
	});

	it('memoReads reruns only when a param it read changes', () => {
		let runs = 0;
		const f = memoReads((p: Record<string, unknown>, ctx: { w: number }) => {
			runs++;
			return p.mode === 'a' ? Number(p.size) * ctx.w : Number(p.other ?? 7);
		});
		expect(f({ mode: 'a', size: 2, colour: 'red' }, { w: 3 })).toBe(6);
		// An unread param (colour, other in mode a) changes: no rerun.
		expect(f({ mode: 'a', size: 2, colour: 'blue', other: 1 }, { w: 3 })).toBe(6);
		expect(runs).toBe(1);
		// A read one, or the rest, changes: rerun.
		expect(f({ mode: 'a', size: 3 }, { w: 3 })).toBe(9);
		expect(f({ mode: 'a', size: 3 }, { w: 4 })).toBe(12);
		expect(runs).toBe(3);
		// Mode b reads `other` and not `size`; a missing param is keyed as missing.
		expect(f({ mode: 'b', size: 1 }, { w: 4 })).toBe(7);
		expect(f({ mode: 'b', size: 5 }, { w: 4 })).toBe(7);
		expect(f({ mode: 'b', size: 5, other: 2 }, { w: 4 })).toBe(2);
		expect(runs).toBe(5);
		// Nested values compare by value.
		const g = memoReads((p: { pts: number[] }) => (runs++, p.pts.length));
		g({ pts: [1, 2] });
		g({ pts: [1, 2] });
		g({ pts: [1, 3] });
		expect(runs).toBe(7);
	});

	it('memoReads keys on every param when the call lists them', () => {
		let runs = 0;
		const f = memoReads((p: Record<string, unknown>) => (runs++, Object.keys(p).length));
		f({ a: 1 });
		f({ a: 1 });
		expect(runs).toBe(1);
		f({ a: 1, b: 2 });
		expect(runs).toBe(2);
	});

	it('memoReads forgets the least recently used', () => {
		let runs = 0;
		const f = memoReads((p: { v: number }) => (runs++, p.v), 2);
		f({ v: 1 });
		f({ v: 2 });
		f({ v: 1 });
		f({ v: 3 }); // evicts 2
		expect(runs).toBe(3);
		f({ v: 1 });
		expect(runs).toBe(3);
		f({ v: 2 });
		expect(runs).toBe(4);
	});
});
