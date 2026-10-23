// CPU-side hashes and random streams. pcg … hash3I are bit-exact ports of the shaders' (layers/glsl/common.ts), so
// CPU layouts (cpuData) and the shader agree where they need to; mulberry32 is a small seeded PRNG for layouts that
// only need to be deterministic.

/** The shaders' pcg(uint): a 32-bit integer hash. Takes any integer (wrapped to 32 bits), returns an unsigned one. */
export function pcg(v: number): number {
	const s = (Math.imul(v, 747796405) + 2891336453) >>> 0;
	const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
	return ((w >>> 22) ^ w) >>> 0;
}

/** pcg2(uvec2(x, y)). */
export const pcg2 = (x: number, y: number) => pcg((x >>> 0) ^ pcg(y >>> 0));

/** pcg3(uvec3(x, y, z)). */
export const pcg3 = (x: number, y: number, z: number) => pcg((x >>> 0) ^ pcg((y >>> 0) ^ pcg(z >>> 0)));

/** The shaders' u2f: the hash to [0, 1], rounded to float32 first as float(h) does (so it can reach 1.0). */
export const u2f = (h: number) => Math.fround(h) / 4294967296;

/**
 * The hash to [0, 1) without the float32 rounding: for CPU statistics that only need the shaders' distribution, not
 * their exact values (noise.ts's and the clouds' quantiles).
 */
export const u2d = (h: number) => h / 4294967296;

/** uint(seed) of a float seed uniform: rounded to float32, truncated, wrapped to 32 bits. */
const seedU = (seed: number) => Math.trunc(Math.fround(seed)) >>> 0;

/**
 * The shaders' hashI(ivec2(x, y), seed), bit for bit: uint() wraps negative coordinates, the seed is a float uniform
 * (uint(seed)), and u2f rounds to float32.
 */
export const hashI = (x: number, y: number, seed: number) => u2f(pcg3(x, y, seedU(seed)));

/** The shaders' hash2I(ivec2(x, y), seed). */
export function hash2I(x: number, y: number, seed: number): [number, number] {
	const h = pcg3(x, y, seedU(seed));
	return [u2f(h), u2f(pcg(h))];
}

/** The shaders' hash3I(ivec2(x, y), seed). */
export function hash3I(x: number, y: number, seed: number): [number, number, number] {
	const h = pcg3(x, y, seedU(seed));
	const h2 = pcg(h);
	return [u2f(h), u2f(h2), u2f(pcg(h2))];
}

/**
 * A small seeded PRNG (mulberry32), uniform in [0, 1). `state` is the starting state, wrapped to 32 bits: callers mix
 * their own seeds into it.
 */
export function mulberry32(state: number): () => number {
	let a = state >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Union-find over n items (path halving): `find` the set's root, `join` two sets. */
export function unionFind(n: number) {
	const parent = new Int32Array(n).map((_, i) => i);
	const find = (i: number): number => {
		while (parent[i] !== i) i = parent[i] = parent[parent[i]];
		return i;
	};
	return { find, join: (a: number, b: number) => (parent[find(a)] = find(b)) };
}
