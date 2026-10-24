import { describe, expect, it } from 'vitest';
import { snapDivision, snapStep, snapTo } from '@/ui/snap';

describe('snapDivision', () => {
	it('picks the largest 1 / 5 step giving at least ten divisions', () => {
		expect(snapDivision(1)).toBeCloseTo(0.1);
		expect(snapDivision(2)).toBeCloseTo(0.1);
		expect(snapDivision(5)).toBeCloseTo(0.5);
		expect(snapDivision(10)).toBe(1);
		expect(snapDivision(50)).toBe(5);
		expect(snapDivision(100)).toBe(10);
		expect(snapDivision(360)).toBe(10);
		expect(snapDivision(0.5)).toBeCloseTo(0.05);
		expect(snapDivision(0.3)).toBeCloseTo(0.01);
	});

	it('keeps integer fields on whole steps and falls back to 1 without a range', () => {
		expect(snapDivision(4, true)).toBe(1);
		expect(snapDivision(1000, true)).toBe(100);
		expect(snapDivision(0)).toBe(1);
		expect(snapDivision(Infinity)).toBe(1);
	});
});

describe('snapTo / snapStep', () => {
	it('rounds to the nearest division and steps to the next one', () => {
		expect(snapTo(0.37, 0.1)).toBeCloseTo(0.4);
		expect(snapTo(-12, 5)).toBe(-10);
		expect(snapStep(0.37, 0.1, 1)).toBeCloseTo(0.4);
		expect(snapStep(0.4, 0.1, 1)).toBeCloseTo(0.5);
		expect(snapStep(0.4, 0.1, -1)).toBeCloseTo(0.3);
		expect(snapStep(0.37, 0.1, -1)).toBeCloseTo(0.3);
	});
});
