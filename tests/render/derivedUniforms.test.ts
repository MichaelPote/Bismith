import { describe, expect, it, vi } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { allLayerDefs, createLayer } from '@/layers/registry';
import type { DerivedUniforms, LayerCanvas } from '@/layers/types';
import { DerivedCache, createDerived, declareDerived, setDerived } from '@/render/derivedUniforms';

ensureBuiltins();

const canvas = (width: number, height: number, tileable = true): LayerCanvas => ({ width, height, tileable, seed: 0 });

const D: DerivedUniforms = {
	decl: { n: 'int', s: 'float', v: 'vec2', k: 'ivec3', w: 'float[3]', b: 'ivec2[2]' },
	compute: (p, c) => ({ n: c.width, s: Number(p.x), v: [1, 2], k: [1, 2, 3], w: [0.5, 1, 2], b: [1, 2, 3, 4] })
};

describe('derived uniforms', () => {
	it('declares each as a d_ uniform of its type', () => {
		expect(declareDerived(D)).toBe(
			'uniform int d_n;\nuniform float d_s;\nuniform vec2 d_v;\nuniform ivec3 d_k;\nuniform float d_w[3];\nuniform ivec2 d_b[2];\n'
		);
		expect(declareDerived(undefined)).toBe('');
		expect(() => declareDerived({ decl: { x: 'mat3' as 'int' }, compute: () => ({}) })).toThrow(/Unknown/);
	});

	it('creates zeroed uniforms and writes computed values into them', () => {
		const u = createDerived(D);
		expect(u.d_n.value).toBe(0);
		expect(u.d_v.value).toBeInstanceOf(Float32Array);
		expect(u.d_k.value).toBeInstanceOf(Int32Array);
		expect((u.d_b.value as Int32Array).length).toBe(4);
		setDerived(u, D, D.compute({ x: 0.25 }, canvas(96, 64)));
		expect(u.d_n.value).toBe(96);
		expect(u.d_s.value).toBe(0.25);
		expect([...(u.d_w.value as Float32Array)]).toEqual([0.5, 1, 2]);
		expect([...(u.d_b.value as Int32Array)]).toEqual([1, 2, 3, 4]);
	});

	it('rejects values that do not fit the declaration', () => {
		const u = createDerived(D);
		const ok = D.compute({ x: 1 }, canvas(8, 8));
		expect(() => setDerived(u, D, { ...ok, n: 1.5 })).toThrow(/integer/);
		expect(() => setDerived(u, D, { ...ok, v: [1] })).toThrow(/needs 2/);
		expect(() => setDerived(u, D, { ...ok, s: NaN })).toThrow(/finite/);
		const { k: _, ...missing } = ok;
		expect(() => setDerived(u, D, missing)).toThrow(/k \(ivec3\) needs 3/);
	});

	it('recomputes only when the params or canvas change', () => {
		const compute = vi.fn(D.compute);
		const d = { ...D, compute };
		const cache = new DerivedCache();
		cache.values('a', d, { x: 1 }, canvas(96, 64));
		cache.values('a', d, { x: 1 }, canvas(96, 64));
		expect(compute).toHaveBeenCalledTimes(1);
		cache.values('a', d, { x: 2 }, canvas(96, 64));
		cache.values('a', d, { x: 2 }, canvas(96, 64, false));
		cache.values('a', d, { x: 2 }, canvas(64, 64, false));
		expect(compute).toHaveBeenCalledTimes(4);
		// Slots are separate (a layer and its extra mask writes); pruning drops those of layers gone from the stack.
		cache.values('a#0', d, { x: 3 }, canvas(64, 64, false));
		cache.values('b', d, { x: 2 }, canvas(64, 64, false));
		expect(compute).toHaveBeenCalledTimes(6);
		cache.prune(new Set(['b']));
		cache.values('a', d, { x: 2 }, canvas(64, 64, false));
		cache.values('b', d, { x: 2 }, canvas(64, 64, false));
		expect(compute).toHaveBeenCalledTimes(7);
	});

	it('every layer type that has them declares valid ones its shader reads, and computes them', () => {
		const users = allLayerDefs().filter((d) => d.derivedUniforms);
		expect(users.map((d) => d.type)).toContain('stripes');
		for (const def of users) {
			const d = def.derivedUniforms!;
			const glsl = def.kind === 'generator' ? def.glsl : def.filterGlsl;
			for (const name of Object.keys(d.decl))
				expect(glsl, `${def.type}: d_${name}`).toMatch(new RegExp(`\\bd_${name}\\b`));
			const params = createLayer(def.type).params;
			for (const c of [canvas(96, 96), canvas(96, 64), canvas(80, 120, false), canvas(1, 1)]) {
				const u = createDerived(d);
				expect(() => setDerived(u, d, d.compute(params, c)), `${def.type} ${c.width}×${c.height}`).not.toThrow();
			}
		}
	});
});
