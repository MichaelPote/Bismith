import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { createLayer, freshParams } from '@/layers/registry';
import { dropShort, markCrowdedEnds, spaceVias, traceIds, tracesLayer } from '@/layers/generators/traces';

describe('traces layer', () => {
	it('numbers each connected trace (wrapping) and leaves free nodes 0', () => {
		// 4×2 nodes: a trace 0 → 1 → 2 along row 0, and a separate one from node 7 east across the seam to node 4.
		const links = new Uint8Array(8);
		links[0] = 1 << 0; // east
		links[1] = 1 << 0;
		links[7] = 1 << 0; // east from x = 3 wraps to x = 0 of row 1 (node 4)
		const id = traceIds(links, 4, 2);
		expect(id[0]).toBe(id[1]);
		expect(id[1]).toBe(id[2]);
		expect(id[7]).toBe(id[4]);
		expect(id[4]).not.toBe(id[0]);
		expect(id[3]).toBe(0);
		expect(id[5]).toBe(0);
	});

	it('drops a via linked to one already kept', () => {
		const links = new Uint8Array(4);
		links[0] = 1 << 0;
		links[1] = 1 << 0;
		const flags = new Uint8Array([2, 2, 2, 2]);
		spaceVias(links, flags, 4, 1);
		expect(Array.from(flags)).toEqual([2, 0, 2, 2]);
	});

	it('drops traces shorter than the shortest trace, with their pads', () => {
		const links = new Uint8Array(8);
		links[0] = 1 << 0; // a 1-link stub in row 0
		links[4] = 1 << 0; // a 2-link trace in row 1
		links[5] = 1 << 0;
		const flags = new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0]);
		const id = dropShort(links, flags, 4, 2, 2);
		expect(Array.from(links)).toEqual([0, 0, 0, 0, 1, 1, 0, 0]);
		expect(Array.from(flags)).toEqual([0, 0, 0, 0, 1, 0, 1, 0]);
		// The ids of what is left, numbered as afresh.
		expect(Array.from(id)).toEqual(Array.from(traceIds(links, 4, 2)));
	});

	it('marks the ends the router left without a pad as crowded', () => {
		const links = new Uint8Array(4);
		links[0] = 1 << 0;
		links[1] = 1 << 0;
		const flags = new Uint8Array([1, 0, 0, 0]);
		markCrowdedEnds(links, flags, 4, 1);
		expect(Array.from(flags)).toEqual([1, 0, 4, 0]);
	});

	it('sizes fresh layers to the texture: pixel art at 64 px, the plain defaults at 512 px', () => {
		ensureBuiltins();
		expect(freshParams('traces', { width: 64, height: 64 })).toMatchObject({ cells: 32, width: 1, aa: false });
		const at512 = freshParams('traces', { width: 512, height: 512 });
		const plain = createLayer('traces').params;
		for (const k of ['cells', 'width', 'pad_size', 'via_size', 'via_ring', 'aa', 'bevel'])
			expect(at512[k], k).toEqual(plain[k]);
		const big = freshParams('traces', { width: 2048, height: 2048 });
		expect(Number(big.width)).toBeGreaterThan(8);
		expect(Number(big.pad_size)).toBeGreaterThan(Number(big.width) / 2);
	});

	it('writes trace ids and crowded ends into the route texture', () => {
		const t = tracesLayer.cpuData!(freshParams('traces', { width: 256, height: 256 }), {
			width: 256,
			height: 256,
			tileable: true,
			seed: 5
		}).route;
		const ids = new Set<number>();
		let crowded = 0;
		for (let i = 0; i < t.width * t.height; i++) {
			ids.add(t.data[i * 4 + 2] + 256 * t.data[i * 4 + 3]);
			if (t.data[i * 4 + 1] & 4) crowded++;
		}
		expect(ids.size).toBeGreaterThan(10);
		expect(crowded).toBeGreaterThan(0);
	});

	it('keeps the shader to one evaluation per feature, without continue', () => {
		const glsl = tracesLayer.glsl!;
		// D3D inlines every call: traces, one pad-or-via feature (its outline and hole) and the hole cut.
		expect(glsl.match(/\b(bevelLine|bevelCapsule)\(/g)!.length).toBe(4);
		expect(/\bcontinue\s*;/.test(glsl)).toBe(false);
		expect(glsl).not.toMatch(/<<\s*out\b/);
	});
});
