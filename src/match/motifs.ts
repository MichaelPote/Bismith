// Motifs term: are the reference's small laid-out features — rivets, bolts, studs, holes — where it has them, as
// strong as it has them? (docs/features/fr8.27-laid-out-matching.md). Pure TypeScript, no DOM.
//
// The other terms give a feature credit only once everything around it matches: on a render whose tone or grain is
// still off, correct rivets were worth ≈0.01 of the total over none, so a long run traded them for anything cheaper
// and they faded to specks. Here every reference blob is charged on its own:
//
// - Blobs: extrema of a difference of Gaussians (σ 0.8 − 2 px at the comparison size) of OKLab L, of either sign,
//   above a quarter of the reference's 99th-percentile response; points on a ridge (a seam, a plate edge) are
//   dropped by the edge-ratio test of their Hessian.
// - Forward: each reference blob looks for the render's response of its sign within ±2 px of where it belongs (at
//   the best wrap-around shift), falling off with distance; the cost is |ln(response / amplitude)| / 2, capped at 1 —
//   so a blob that fades or drifts costs gradually, and a missing one fully.
// - Reverse: the render's own blobs that the reference lacks, the same way, phased in by their amplitude so a blob
//   growing past the threshold doesn't make the loss jump.
// - Layout: how much the reference's blob pattern repeats under a shift other than none. A riveted plate (every row
//   alike) scores ≈1; on stone, wood or grass the blobs fall at random, nothing repeats, and the term's weight goes
//   to 0 — there it would only push towards blobs at random places, and the other terms already judge the material.

export interface MotifPlane {
	width: number;
	height: number;
	wrap: boolean;
	/** Difference-of-Gaussians response of lightness. */
	dog: Float32Array;
	/** Median |response|: the level of the fine texture around the blobs (a few rivets don't move it). */
	level: number;
}

export interface MotifPoint {
	x: number;
	y: number;
	/** +1 a bright blob, −1 a dark one. */
	sign: number;
	/** |response| at the point. */
	amp: number;
	/** min(1, amp / threshold): faint blobs count less. */
	weight: number;
}

export interface MotifTarget extends MotifPlane {
	threshold: number;
	points: MotifPoint[];
	/** 0..1: how laid out the reference is (scales the term's weight). */
	layout: number;
}

const SIGMA_FINE = 0.8;
const SIGMA_COARSE = 2;
/** Blobs count from this share of the reference's 99th-percentile response. */
const DETECT = 0.4;
/** Edge-ratio test: principal curvatures further apart than this are a ridge, not a blob. */
const EDGE_RATIO = 6;
/** Search radius (px) around where a blob belongs, and the distance falloff's σ. */
const REACH = 3;
const FALLOFF = 1.5;
/** At most this many reference blobs (the strongest), to bound the cost per evaluation. */
const MAX_POINTS = 400;
/** ln of the response ratio that counts as missing (¼). */
const MISSING = Math.log(4);
/** The strongest blobs that pick the shift (each shift costs one read per blob). */
const SHIFT_POINTS = 64;

function blur(src: Float32Array, w: number, h: number, sigma: number, wrap: boolean): Float32Array {
	const r = Math.max(1, Math.ceil(sigma * 3));
	const k = new Float32Array(2 * r + 1);
	let s = 0;
	for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
	for (let i = 0; i < k.length; i++) k[i] /= s;
	const at = (i: number, n: number) => (wrap ? ((i % n) + n) % n : i < 0 ? 0 : i >= n ? n - 1 : i);
	const tmp = new Float32Array(w * h);
	const out = new Float32Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			let v = 0;
			for (let i = -r; i <= r; i++) v += k[i + r] * src[y * w + at(x + i, w)];
			tmp[y * w + x] = v;
		}
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			let v = 0;
			for (let i = -r; i <= r; i++) v += k[i + r] * tmp[at(y + i, h) * w + x];
			out[y * w + x] = v;
		}
	return out;
}

/** The DoG plane of a lightness plane at the comparison size. */
export function motifPlane(L: Float32Array, width: number, height: number, wrap: boolean): MotifPlane {
	const a = blur(L, width, height, SIGMA_FINE, wrap);
	const b = blur(L, width, height, SIGMA_COARSE, wrap);
	for (let i = 0; i < a.length; i++) a[i] -= b[i];
	const abs = Float32Array.from(a, Math.abs).sort();
	return { width, height, wrap, dog: a, level: abs[abs.length >> 1] };
}

function index(p: MotifPlane, x: number, y: number): number {
	const { width: w, height: h } = p;
	if (p.wrap) return (((y % h) + h) % h) * w + (((x % w) + w) % w);
	return (y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x);
}

/** Blobs of `p` stronger than `min` (local extrema of either sign that pass the edge-ratio test). */
function detect(p: MotifPlane, min: number, threshold: number): MotifPoint[] {
	const { width: w, height: h, dog: d } = p;
	const pts: MotifPoint[] = [];
	const lo = p.wrap ? 0 : 1;
	for (let y = lo; y < h - lo; y++)
		for (let x = lo; x < w - lo; x++) {
			const c = d[y * w + x];
			const sign = c >= 0 ? 1 : -1;
			const e = sign * c;
			if (e <= min) continue;
			let peak = true;
			for (let j = -1; j <= 1 && peak; j++)
				for (let i = -1; i <= 1; i++) {
					if (!i && !j) continue;
					if (sign * d[index(p, x + i, y + j)] >= e) {
						peak = false;
						break;
					}
				}
			if (!peak) continue;
			const dxx = d[index(p, x + 1, y)] + d[index(p, x - 1, y)] - 2 * c;
			const dyy = d[index(p, x, y + 1)] + d[index(p, x, y - 1)] - 2 * c;
			const dxy =
				(d[index(p, x + 1, y + 1)] -
					d[index(p, x - 1, y + 1)] -
					d[index(p, x + 1, y - 1)] +
					d[index(p, x - 1, y - 1)]) /
				4;
			const det = dxx * dyy - dxy * dxy;
			const tr = dxx + dyy;
			if (det <= 0 || (tr * tr) / det >= (EDGE_RATIO + 1) ** 2 / EDGE_RATIO) continue;
			pts.push({ x, y, sign, amp: e, weight: Math.min(1, e / threshold) ** 2 });
		}
	return pts;
}

/** Correlation of the points' signed weights with `p`'s response, at every shift (or only none without wrap). */
function correlations(points: MotifPoint[], p: MotifPlane): Float32Array {
	const { width: w, height: h, dog: d } = p;
	const n = p.wrap ? w * h : 1;
	const out = new Float32Array(n);
	for (let s = 0; s < n; s++) {
		const sx = s % w;
		const sy = (s / w) | 0;
		let c = 0;
		for (const q of points) c += q.weight * q.sign * d[index(p, q.x + sx, q.y + sy)];
		out[s] = c;
	}
	return out;
}

/** The reference side of the term: its blobs and how laid out it is. */
export function motifTarget(plane: MotifPlane): MotifTarget {
	const abs = Float32Array.from(plane.dog, Math.abs).sort();
	const threshold = Math.max(1e-4, abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.99))]);
	const points = detect(plane, DETECT * threshold, threshold)
		.sort((a, b) => b.amp - a.amp)
		.slice(0, MAX_POINTS);
	let layout = 0;
	if (plane.wrap && points.length >= 2) {
		// The best repeat away from no shift, relative to no shift: the blob pattern matching itself elsewhere.
		const c = correlations(points, plane);
		const { width: w, height: h } = plane;
		let best = 0;
		for (let s = 1; s < c.length; s++) {
			const sx = s % w;
			const sy = (s / w) | 0;
			if (Math.min(sx, w - sx) <= REACH && Math.min(sy, h - sy) <= REACH) continue;
			best = Math.max(best, c[s]);
		}
		const r = c[0] > 0 ? best / c[0] : 0;
		// Random blobs repeat to ≈0.3–0.4 of themselves; a laid-out pattern to ≳0.8.
		layout = Math.min(1, Math.max(0, (r - 0.45) / 0.3));
	}
	return { ...plane, threshold, points, layout };
}

/**
 * A blob answered by `response` where it wanted `amp`: 0 when they agree, 1 when the answer is a quarter of it or less
 * (what speckle nearby gives — the blob is missing), and at most ½ when the answer is too strong (a rivet in place that
 * is too bold is still a rivet; contrast is the other terms' job).
 */
function cost(response: number, amp: number): number {
	const q = response / amp;
	return q >= 1 ? Math.min(0.5, Math.log(q) / (2 * MISSING)) : Math.min(1, -Math.log(Math.max(q, 1e-6)) / MISSING);
}

/** The strongest response of `sign` near (x, y) in `p`, falling off with distance. */
function respond(p: MotifPlane, x: number, y: number, sign: number): number {
	let best = 0;
	for (let j = -REACH; j <= REACH; j++)
		for (let i = -REACH; i <= REACH; i++) {
			const v = sign * p.dog[index(p, x + i, y + j)] * Math.exp(-(i * i + j * j) / (2 * FALLOFF * FALLOFF));
			if (v > best) best = v;
		}
	return best;
}

/** The term's parts at its shift. */
export interface MotifDetail {
	/** Reference blobs missing or off in the render. */
	forward: number;
	/** Render blobs the reference lacks. */
	reverse: number;
	shift: [number, number];
}

function costAt(render: MotifPlane, rpts: MotifPoint[], t: MotifTarget, sx: number, sy: number): MotifDetail {
	let f = 0;
	let wsum = 0;
	for (const q of t.points) {
		f += q.weight * cost(respond(render, q.x + sx, q.y + sy, q.sign), q.amp);
		wsum += q.weight;
	}
	// Render blobs the reference lacks, phased in from half the detection threshold to 1.5×. Only whether the reference
	// has a blob there counts (up to its strongest), not how much bolder the render's is — the forward part prices that.
	const det = DETECT * t.threshold;
	let r = 0;
	let rsum = 0;
	for (const q of rpts) {
		const u = Math.min(1, Math.max(0, (q.amp - 0.5 * det) / det));
		const wt = u * u * (3 - 2 * u) * q.weight;
		const support = respond(t, q.x - sx, q.y - sy, q.sign) / Math.min(q.amp, t.threshold);
		r += wt * (support >= 1 ? 0 : cost(support, 1));
		rsum += wt;
	}
	return { forward: f / Math.max(wsum, 1e-9), reverse: r / Math.max(rsum, wsum, 1e-9), shift: [sx, sy] };
}

const total = (d: MotifDetail) => 0.5 * d.forward + 0.5 * d.reverse;

/** The term's raw value, 0..1: 0 when every reference blob is matched in place and the render adds none. */
export function motifDistance(render: MotifPlane, t: MotifTarget): number {
	const d = motifDetail(render, t);
	return d ? total(d) : 0;
}

/** The term's parts (null when the reference has no blobs). */
export function motifDetail(plane: MotifPlane, t: MotifTarget): MotifDetail | null {
	if (!t.points.length) return null;
	// Blobs are judged against their own texture: a render whose speckle is twice as contrasty as the reference's has
	// every blob twice as strong, which the contrast terms price; here only the blobs' strength relative to it counts.
	const k = plane.level > 0 ? Math.min(4, Math.max(0.25, t.level / plane.level)) : 1;
	const render = k === 1 ? plane : { ...plane, dog: plane.dog.map((v) => v * k), level: plane.level * k };
	const rpts = detect(render, 0.5 * DETECT * t.threshold, t.threshold);
	if (!t.wrap) return costAt(render, rpts, t, 0, 0);
	// The shifts where the reference's strongest blobs best meet the render's response; the cheapest of the top few.
	const c = correlations(t.points.slice(0, SHIFT_POINTS), render);
	const top = [0, 0, 0];
	for (let s = 1; s < c.length; s++) {
		if (c[s] <= c[top[2]]) continue;
		top[2] = s;
		if (c[top[2]] > c[top[1]]) [top[1], top[2]] = [top[2], top[1]];
		if (c[top[1]] > c[top[0]]) [top[0], top[1]] = [top[1], top[0]];
	}
	let best: MotifDetail | null = null;
	for (const s of top) {
		const d = costAt(render, rpts, t, s % t.width, (s / t.width) | 0);
		if (!best || total(d) < total(best)) best = d;
	}
	return best;
}
