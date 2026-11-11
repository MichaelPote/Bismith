// A layer's cpuData runs on every param change; the pipeline keeps the uploaded texture only when it hands back the same
// arrays (materialPipeline cpuTextures). A colour change must not rebuild them.
import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams, getLayerDef } from '@/layers/registry';
import type { ParamValues } from '@/core/params';

ensureBuiltins();
const ctx = { width: 128, height: 128, tileable: true, seed: 3 };
const recolour = (p: ParamValues): ParamValues => ({
	...p,
	dif_grad: {
		stops: [
			{ pos: 0, color: '#123456' },
			{ pos: 1, color: '#abcdef' }
		]
	}
});

describe('cpuData keeps its arrays when a param it does not read changes', () => {
	const cases: [string, ParamValues][] = [
		['noise', { ...createLayer('noise').params, even: true, fractal: 'fbm' }],
		['traces', freshParams('traces', ctx)],
		['path', freshParams('path', ctx)],
		['polyline', freshParams('polyline', ctx)]
	];
	for (const [type, base] of cases)
		it(type, () => {
			const def = getLayerDef(type)!;
			const p = { ...createLayer(type).params, ...base };
			const a = def.cpuData!(p, ctx);
			const b = def.cpuData!(recolour(p), ctx);
			expect(Object.keys(a).length).toBeGreaterThan(0);
			for (const k of Object.keys(a)) expect(b[k].data, `${type}.${k}`).toBe(a[k].data);
		});
});
