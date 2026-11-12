// Sorting and quantiles of float samples, shared by the metric terms, the colour fit and the tiling analysis.

/**
 * Ascending sort of float32 values, exactly as Float32Array#sort orders them (−0 before +0, NaN last), by an LSD radix
 * sort on their bit patterns — three passes of 11 bits, O(n). The metric sorts tens of thousands of values per
 * evaluation (32 colour projections, local contrast), where a comparison sort was two thirds of the scoring time.
 */
export function sortFloat32(values: Float32Array): Float32Array {
	const n = values.length;
	if (n < 512) return Float32Array.from(values).sort();
	const bits = new Uint32Array(values.buffer, values.byteOffset, n);
	// Order-preserving keys: flip every bit of negatives, set the sign bit of positives.
	let a = new Uint32Array(n);
	for (let i = 0; i < n; i++) {
		const x = bits[i];
		a[i] = x & 0x80000000 ? ~x >>> 0 : (x | 0x80000000) >>> 0;
	}
	let b = new Uint32Array(n);
	const count = new Uint32Array(2048);
	for (let shift = 0; shift < 32; shift += 11) {
		count.fill(0);
		for (let i = 0; i < n; i++) count[(a[i] >>> shift) & 2047]++;
		let sum = 0;
		for (let k = 0; k < 2048; k++) {
			const c = count[k];
			count[k] = sum;
			sum += c;
		}
		for (let i = 0; i < n; i++) b[count[(a[i] >>> shift) & 2047]++] = a[i];
		const t = a;
		a = b;
		b = t;
	}
	for (let i = 0; i < n; i++) {
		const k = a[i];
		a[i] = k & 0x80000000 ? (k ^ 0x80000000) >>> 0 : ~k >>> 0;
	}
	return new Float32Array(a.buffer, 0, n);
}

/**
 * The indices that sort `values` ascending, ties in index order: the order a stable comparison sort by `a − b` gives
 * (−0 and +0 tie). An LSD radix sort on the bit patterns, as sortFloat32.
 */
export function argsortFloat32(values: Float32Array): Uint32Array {
	const n = values.length;
	const folded = new Float32Array(n);
	for (let i = 0; i < n; i++) folded[i] = values[i] + 0; // −0 → +0
	const bits = new Uint32Array(folded.buffer);
	let a = new Uint32Array(n);
	let o = new Uint32Array(n);
	for (let i = 0; i < n; i++) {
		const x = bits[i];
		a[i] = x & 0x80000000 ? ~x >>> 0 : (x | 0x80000000) >>> 0;
		o[i] = i;
	}
	let b = new Uint32Array(n);
	let p = new Uint32Array(n);
	const count = new Uint32Array(2048);
	for (let shift = 0; shift < 32; shift += 11) {
		count.fill(0);
		for (let i = 0; i < n; i++) count[(a[i] >>> shift) & 2047]++;
		let sum = 0;
		for (let k = 0; k < 2048; k++) {
			const c = count[k];
			count[k] = sum;
			sum += c;
		}
		for (let i = 0; i < n; i++) {
			const d = count[(a[i] >>> shift) & 2047]++;
			b[d] = a[i];
			p[d] = o[i];
		}
		[a, b] = [b, a];
		[o, p] = [p, o];
	}
	return o;
}

/**
 * Sorted quantiles (q evenly spaced, linear interpolation) of `values`: the midpoints of q equal parts, or with `ends`
 * from the minimum to the maximum (a quantile map then reaches the whole range).
 */
export function quantiles(values: ArrayLike<number>, q = 128, ends = false): Float32Array {
	const n = values.length;
	const out = new Float32Array(q);
	if (n === 0) return out;
	const sorted = sortFloat32(values instanceof Float32Array ? values : Float32Array.from(values as ArrayLike<number>));
	for (let k = 0; k < q; k++) {
		const pos = ends ? (k / (q - 1)) * (n - 1) : ((k + 0.5) / q) * n - 0.5;
		const i0 = Math.max(0, Math.min(n - 1, Math.floor(pos)));
		const i1 = Math.min(n - 1, i0 + 1);
		const f = Math.max(0, Math.min(1, pos - i0));
		out[k] = sorted[i0] * (1 - f) + sorted[i1] * f;
	}
	return out;
}

/** The q-quantile (0..1) of values already sorted ascending: the value at index ⌊n·q⌋ (0 when empty). */
export function quantileOfSorted(sorted: ArrayLike<number>, q: number): number {
	const n = sorted.length;
	return n ? sorted[Math.min(n - 1, Math.max(0, Math.floor(n * q)))] : 0;
}

/**
 * quantileOfSorted(sortFloat32(values), q) without sorting: a selection of that index on a copy, O(n) — for reading one
 * quantile of a large array. Not for NaNs.
 */
export function quantileOf(values: Float32Array, q: number): number {
	const n = values.length;
	return n ? selectFloat32(Float32Array.from(values), Math.min(n - 1, Math.max(0, Math.floor(n * q)))) : 0;
}

/**
 * The k-th smallest of `a` (0-based), which it reorders: a quickselect, Hoare partitions around a median of three.
 * Not for NaNs.
 */
export function selectFloat32(a: Float32Array, k: number): number {
	let lo = 0;
	let hi = a.length - 1;
	while (hi > lo) {
		const p = a[lo];
		const m = a[(lo + hi) >> 1];
		const r = a[hi];
		const x = p < m ? (m < r ? m : p < r ? r : p) : p < r ? p : m < r ? r : m;
		let i = lo;
		let j = hi;
		while (i <= j) {
			while (a[i] < x) i++;
			while (x < a[j]) j--;
			if (i <= j) {
				const t = a[i];
				a[i++] = a[j];
				a[j--] = t;
			}
		}
		if (k <= j) hi = j;
		else if (k >= i) lo = i;
		else break;
	}
	return a[k];
}
