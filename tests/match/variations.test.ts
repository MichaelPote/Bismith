import { describe, expect, it } from 'vitest';
import { builtinPresets } from '@/presets';
import { variations } from '@/match/variations';

describe('variations', () => {
	it('perturbs a few params per variation, keeps linked copies in step and leaves the input alone', () => {
		const p = builtinPresets()
			.find((e) => e.key === 'builtin:group/stone-wall')!
			.project();
		const before = JSON.stringify(p);
		const vs = variations(p, 8, { seed: 5, strength: 0.3 });
		expect(vs).toHaveLength(8);
		expect(JSON.stringify(p)).toBe(before);
		for (const v of vs) {
			expect(v.changed.length).toBeGreaterThan(0);
			expect(JSON.stringify(v.project)).not.toBe(before);
			// The bricks copies (relief + paint) still share their layout.
			const bricks = v.project.layers.filter((l) => l.type === 'bricks');
			for (const k of ['columns', 'rows', 'stagger', 'mortar', 'seed'])
				expect(new Set(bricks.map((l) => JSON.stringify(l.params[k]))).size).toBe(1);
		}
	});
});
