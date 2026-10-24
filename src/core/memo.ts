// Small LRU memos for CPU work. A generator's cpuData reruns whenever any param of its layer changes (the pipeline
// caches by all of them), so a colour or Height slider would redo its routing, cell layout or quantile measurement:
// these keep the last few results, keyed by exactly the inputs the work reads. Results are shared between the calls
// that hit them — don't mutate them.

/** A key of plain values (JSON, with non-finite numbers kept apart from null). */
export function memoKey(v: unknown): string {
	return JSON.stringify(v, (_, x) => (typeof x === 'number' && !Number.isFinite(x) ? `#${x}` : x)) ?? 'undefined';
}

/** The last `size` results by key: get() returns the stored one or computes and stores it. */
export class Lru<V> {
	private map = new Map<string, V>();

	constructor(readonly size: number) {}

	get(key: string, compute: () => V): V {
		const hit = this.map.has(key);
		const v = hit ? this.map.get(key)! : compute();
		// Map order is the recency order: the first key is the least recently used.
		if (hit) this.map.delete(key);
		this.map.set(key, v);
		if (this.map.size > this.size) this.map.delete(this.map.keys().next().value!);
		return v;
	}
}

/** fn, remembering its last `size` results by its arguments' values (memoKey). */
export function memoize<A extends unknown[], R>(fn: (...args: A) => R, size = 8): (...args: A) => R {
	const lru = new Lru<R>(size);
	return (...args) => lru.get(memoKey(args), () => fn(...args));
}

/**
 * fn(params, ...rest), remembering its last `size` results by the params it read: a call whose params agree with an
 * earlier call's on every key that call read (and whose rest is the same) gets its result. The reads are recorded
 * through a proxy, so no key list has to be kept in step with the code — a param it reads only in one mode keys only
 * that mode. Listing the params (a spread, Object.keys) keys on all of them.
 */
export function memoReads<P extends object, A extends unknown[], R>(
	fn: (p: P, ...rest: A) => R,
	size = 8
): (p: P, ...rest: A) => R {
	// reads: key → its value's memoKey ('-' absent); null: the call listed the params, so `all` keys on every one.
	type Entry = { rest: string; reads: Map<PropertyKey, string> | null; all: string; value: R };
	const entries: Entry[] = []; // most recent first
	const snap = (p: P, k: PropertyKey) => (k in p ? memoKey((p as Record<PropertyKey, unknown>)[k]) : '-');
	const matches = (e: Entry, p: P) =>
		e.reads ? [...e.reads].every(([k, v]) => snap(p, k) === v) : e.all === memoKey(p);
	return (p, ...rest) => {
		const r = memoKey(rest);
		const i = entries.findIndex((e) => e.rest === r && matches(e, p));
		if (i >= 0) {
			const [e] = entries.splice(i, 1);
			entries.unshift(e);
			return e.value;
		}
		let reads: Map<PropertyKey, string> | null = new Map();
		const note = (t: P, k: PropertyKey) => {
			if (reads && !reads.has(k)) reads.set(k, snap(t, k));
		};
		const proxy = new Proxy(p, {
			get(t, k) {
				note(t, k);
				return Reflect.get(t, k);
			},
			has(t, k) {
				note(t, k);
				return Reflect.has(t, k);
			},
			ownKeys(t) {
				reads = null;
				return Reflect.ownKeys(t);
			}
		});
		const value = fn(proxy, ...rest);
		entries.unshift({ rest: r, reads, all: reads ? '' : memoKey(p), value });
		if (entries.length > size) entries.pop();
		return value;
	};
}
