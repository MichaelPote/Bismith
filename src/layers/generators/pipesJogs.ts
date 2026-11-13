// Pipes & conduits (greebleVents.ts): the jogs, planned on the CPU so that runs never clash. A run that jogs steps aside
// through two bends, runs on at the new level and steps back further along. Runs are planned one at a time in a random
// order, each candidate checked against every run planned so far, and kept only if pipes meet just where straight
// lengths cross at 45° or 90°: never on a bend, never side by side overlapping. Where something crosses a run or passes
// within reach of its fittings, the run lists a stretch the shader keeps its joints and clamps off (as on its own bends).
//
// The run layout (pp_run) is the shader's, bit for bit through the shared hashes; the geometry of a jog's steps is
// pp_jog's. All in the layer's local frame: x along the runs (W), y across them (H).

import { hash2I, hashI } from '@/core/hash';
import type { ParamValues } from '@/core/params';
import { floatTexture } from '../primTexture';
import type { CpuTexture, LayerCanvas } from '../types';

/** The most fitting-free stretches a run's record holds. */
export const JOG_KEEP = 12;
/** Floats per run: the jog (step, its two places, bends, bend radii), the stretch count, then (centre, half width) each. */
export const JOG_STRIDE = 8 + 2 * JOG_KEEP;
/** Candidate jogs tried per run before it runs straight. */
const TRIES = 16;

type Vec = [number, number];
/** A piece of a run's centre line: a straight (horizontal or a step's leg) or a bend. */
type Piece =
	| { bend: false; a: Vec; b: Vec; dir: Vec; lo: Vec; hi: Vec }
	| { bend: true; c: Vec; r: number; a0: number; a1: number; lo: Vec; hi: Vec };

export interface Run {
	k: number;
	kw: number;
	Ds: number;
	tot: number;
	bc: number;
	/** Half width of the run's solid part (pipes and clamp rings), and of its reach with joints and clamp feet. */
	hc: number;
	hf: number;
	jog: Jog | null;
	keep: Vec[];
	/** Its record is stored (a run on the tile; untiled, the runs past the edges are only obstacles). */
	stored: boolean;
}

export interface Jog {
	s: number;
	x: Vec;
	a: Vec;
	rf: Vec;
	w: Vec;
}

const snapC = (c: number, s: number) => Math.floor(c - 0.5 * s + 0.5) + 0.5 * s;

function seg(a: Vec, b: Vec): Piece {
	const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
	return {
		bend: false,
		a,
		b,
		dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l],
		lo: [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
		hi: [Math.max(a[0], b[0]), Math.max(a[1], b[1])]
	};
}

function arc(c: Vec, r: number, a0: number, a1: number): Piece {
	return { bend: true, c, r, a0, a1, lo: [c[0] - r, c[1] - r], hi: [c[0] + r, c[1] + r] };
}

/** A step at x xt from level y0, rising s (either sign), bends of angle a (0: 90°, 1: 45°) and radius rf: pp_jog's path. */
function stepPieces(xt: number, y0: number, s: number, a: number, rf: number): Piece[] {
	const sg = s < 0 ? -1 : 1;
	const as = Math.abs(s);
	const th = a ? Math.PI / 4 : Math.PI / 2;
	const cs: Vec = [Math.cos(th), Math.sin(th)];
	const tb = Math.tan(th / 2) * rf;
	const M: Vec = [0, 0.5 * as];
	const C: Vec = [-0.5 * as * a - tb, rf];
	const T: Vec = [-0.5 * as * a + tb * cs[0], tb * cs[1]];
	const w = (p: Vec): Vec => [xt + p[0], y0 + sg * p[1]];
	const turn = (p: Vec): Vec => [2 * M[0] - p[0], 2 * M[1] - p[1]];
	// Bend angles in the step's frame, flipped with it when it falls.
	const span = (b0: number, b1: number): Vec => (sg > 0 ? [b0, b1] : [-b1, -b0]);
	const h = Math.PI / 2;
	const s1 = span(-h, -h + th);
	const s2 = span(h, h + th);
	return [arc(w(C), rf, s1[0], s1[1]), seg(w(T), w(turn(T))), arc(w(turn(C)), rf, s2[0], s2[1])];
}

/** A run's centre line: straight, or with its jog (the new parts only: the jogged length and the two steps). */
function runPieces(r: Run, W: number, jog: Jog | null, onlyNew = false): Piece[] {
	if (!jog) return onlyNew ? [] : [seg([0, r.bc], [W, r.bc])];
	const y1 = r.bc + jog.s;
	const out = [
		seg([jog.x[0] + jog.w[0], y1], [jog.x[1] - jog.w[1], y1]),
		...stepPieces(jog.x[0], r.bc, jog.s, jog.a[0], jog.rf[0]),
		...stepPieces(jog.x[1], y1, -jog.s, jog.a[1], jog.rf[1])
	];
	if (!onlyNew) out.push(seg([jog.x[1] + jog.w[1], r.bc], [jog.x[0] + W - jog.w[0], r.bc]));
	return out;
}

/** Distance from p to a piece, with the piece's direction there (a bend's tangent). */
function near(p: Vec, q: Piece): { d: number; dir: Vec } {
	if (!q.bend) {
		const ab: Vec = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
		const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
		const t = Math.max(0, Math.min(1, ((p[0] - q.a[0]) * ab[0] + (p[1] - q.a[1]) * ab[1]) / l2));
		return { d: Math.hypot(p[0] - q.a[0] - t * ab[0], p[1] - q.a[1] - t * ab[1]), dir: q.dir };
	}
	let phi = Math.atan2(p[1] - q.c[1], p[0] - q.c[0]);
	while (phi < q.a0) phi += 2 * Math.PI;
	if (phi > q.a1) {
		// Past its ends: the nearer end.
		const e0: Vec = [q.c[0] + q.r * Math.cos(q.a0), q.c[1] + q.r * Math.sin(q.a0)];
		const e1: Vec = [q.c[0] + q.r * Math.cos(q.a1), q.c[1] + q.r * Math.sin(q.a1)];
		const d0 = Math.hypot(p[0] - e0[0], p[1] - e0[1]);
		const d1 = Math.hypot(p[0] - e1[0], p[1] - e1[1]);
		const a = d0 < d1 ? q.a0 : q.a1;
		return { d: Math.min(d0, d1), dir: [-Math.sin(a), Math.cos(a)] };
	}
	return { d: Math.abs(Math.hypot(p[0] - q.c[0], p[1] - q.c[1]) - q.r), dir: [-Math.sin(phi), Math.cos(phi)] };
}

/** Points along a piece about `step` px apart, each with the piece's direction there; a straight only within [lo, hi]. */
function samples(q: Piece, lo: Vec, hi: Vec, step: number): { p: Vec; dir: Vec }[] {
	const out: { p: Vec; dir: Vec }[] = [];
	if (!q.bend) {
		const d: Vec = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
		// The part of it inside the box (slab by slab).
		let t0 = 0;
		let t1 = 1;
		for (const i of [0, 1]) {
			if (Math.abs(d[i]) < 1e-9) {
				if (q.a[i] < lo[i] || q.a[i] > hi[i]) return out;
			} else {
				const u0 = (lo[i] - q.a[i]) / d[i];
				const u1 = (hi[i] - q.a[i]) / d[i];
				t0 = Math.max(t0, Math.min(u0, u1));
				t1 = Math.min(t1, Math.max(u0, u1));
			}
		}
		if (t1 < t0) return out;
		const n = Math.max(1, Math.ceil(((t1 - t0) * Math.hypot(d[0], d[1])) / step));
		for (let i = 0; i <= n; i++) {
			const t = t0 + ((t1 - t0) * i) / n;
			out.push({ p: [q.a[0] + t * d[0], q.a[1] + t * d[1]], dir: q.dir });
		}
		return out;
	}
	const n = Math.max(2, Math.ceil((q.r * (q.a1 - q.a0)) / step));
	for (let i = 0; i <= n; i++) {
		const a = q.a0 + ((q.a1 - q.a0) * i) / n;
		out.push({ p: [q.c[0] + q.r * Math.cos(a), q.c[1] + q.r * Math.sin(a)], dir: [-Math.sin(a), Math.cos(a)] });
	}
	return out;
}

const shift = (q: Piece, o: Vec): Piece =>
	q.bend
		? {
				...q,
				c: [q.c[0] + o[0], q.c[1] + o[1]],
				lo: [q.lo[0] + o[0], q.lo[1] + o[1]],
				hi: [q.hi[0] + o[0], q.hi[1] + o[1]]
			}
		: {
				...q,
				a: [q.a[0] + o[0], q.a[1] + o[1]],
				b: [q.b[0] + o[0], q.b[1] + o[1]],
				lo: [q.lo[0] + o[0], q.lo[1] + o[1]],
				hi: [q.hi[0] + o[0], q.hi[1] + o[1]]
			};

const horizontal = (q: Piece) => !q.bend && Math.abs(q.dir[1]) < 1e-6;
const parallel = (a: Vec, b: Vec) => Math.abs(a[0] * b[1] - a[1] * b[0]) < 0.2;

/**
 * Whether two runs' pieces clash; otherwise the stretches each must keep its fittings off (x in its own frame, as
 * [lo, hi]), added to keepA / keepB. qa belongs to run A, qb (already moved to its copy, by ox along) to run B.
 */
function clash(A: Run, qa: Piece, B: Run, qb: Piece, ox: number, keepA: Vec[], keepB: Vec[]): boolean {
	// Points a quarter of the thinner run's half width apart, every test widened by half that (so none slips between).
	const step = Math.max(1, 0.25 * Math.min(A.hc, B.hc));
	const e = step > 1 ? 0.5 * step : 0;
	const core = A.hc + B.hc + e;
	const reach = Math.max(A.hf + B.hc, A.hc + B.hf) + e;
	if (qa.lo[0] > qb.hi[0] + reach || qb.lo[0] > qa.hi[0] + reach) return false;
	if (qa.lo[1] > qb.hi[1] + reach || qb.lo[1] > qa.hi[1] + reach) return false;
	// Each piece's points against the other piece: overlapping solids only where two straights cross; fittings kept off
	// a straight length where the other run comes within their reach.
	for (const [P, Q, PR, QR, keepP, keepQ, oxP, oxQ] of [
		[qa, qb, A, B, keepA, keepB, 0, ox],
		[qb, qa, B, A, keepB, keepA, ox, 0]
	] as const) {
		const hP = horizontal(P);
		const hQ = horizontal(Q);
		const lo: Vec = [Q.lo[0] - reach, Q.lo[1] - reach];
		const hi: Vec = [Q.hi[0] + reach, Q.hi[1] + reach];
		for (const { p, dir } of samples(P, lo, hi, step)) {
			if (p[0] < lo[0] || p[0] > hi[0] || p[1] < lo[1] || p[1] > hi[1]) continue;
			const n = near(p, Q);
			if (n.d < core && (P.bend || Q.bend || parallel(dir, n.dir))) return true;
			// P's tube across x here (its normal's x), and Q's at its nearest point.
			const exP = PR.hc * Math.abs(dir[1]) + 1 + e;
			if (hQ && n.d < PR.hc + QR.hf + e) keepQ.push([p[0] - oxQ - exP, p[0] - oxQ + exP]);
			if (hP && n.d < PR.hf + QR.hc + e) keepP.push([p[0] - oxP - QR.hc - 1 - e, p[0] - oxP + QR.hc + 1 + e]);
		}
	}
	return false;
}

/** Stretches merged where they overlap (or nearly), x first brought into [0, W). */
function mergeKeep(list: Vec[], W: number): Vec[] {
	const s = list
		.map(([lo, hi]): Vec => {
			const o = W * Math.floor(lo / W);
			return [lo - o, hi - o];
		})
		.sort((a, b) => a[0] - b[0]);
	const out: Vec[] = [];
	for (const iv of s) {
		const last = out[out.length - 1];
		if (last && iv[0] <= last[1] + 1) last[1] = Math.max(last[1], iv[1]);
		else out.push([iv[0], iv[1]]);
	}
	return out;
}

/** The planned jogs as the shader reads them: JOG_STRIDE floats a row, one row per run. */
export function planJogs(q: ParamValues, ctx: LayerCanvas): CpuTexture {
	const plan = planJogRuns(q, ctx);
	const n = Math.max(1, Math.round(Number(q.count)));
	const out = new Float32Array(n * JOG_STRIDE);
	for (const r of plan?.runs ?? []) {
		if (!r.stored) continue;
		const o = r.kw * JOG_STRIDE;
		if (r.jog) out.set([r.jog.s, r.jog.x[0], r.jog.x[1], r.jog.a[0], r.jog.a[1], r.jog.rf[0], r.jog.rf[1]], o);
		const keep = r.keep.slice(0, JOG_KEEP);
		out[o + 7] = keep.length;
		keep.forEach(([lo, hi], i) => out.set([0.5 * (lo + hi), 0.5 * (hi - lo)], o + 8 + 2 * i));
	}
	return floatTexture(out, JOG_STRIDE);
}

/** The runs with their planned jogs (null when there are none to plan), in the local frame: W along, H across. */
export function planJogRuns(q: ParamValues, ctx: LayerCanvas): { runs: Run[]; W: number; H: number } | null {
	const n = Math.max(1, Math.round(Number(q.count)));
	const chance = Number(q.jog_chance);
	const amount = Number(q.jog_amount);
	if (!(chance > 0 && amount > 0)) return null;

	const vert = q.orient === 'vertical';
	const W = vert ? ctx.height : ctx.width;
	const H = vert ? ctx.width : ctx.height;
	const seed = ctx.seed;
	const tile = ctx.tileable;
	// The shader's run layout (gen() and pp_run), as float32 where it matters.
	const f = Math.fround;
	const b0 = Math.round(Number(q.bundle));
	const b1 = Math.round(Number(q.bundle_max ?? 1));
	const nbMax = Math.max(b0, b1, 1);
	const lo = Math.max(Math.min(b0, b1), 1);
	const span = nbMax - lo;
	const per = f(H / n);
	const gap = nbMax > 1 ? Math.max(Number(q.bundle_gap), 0) : 0;
	const D0 = Math.min(
		Math.max(Number(q.diameter), 1),
		Math.max(Math.floor(f(f(per - f(gap * (nbMax - 1))) / nbMax)), 1)
	);
	const diaVar = Number(q.dia_var);
	const jitter = Number(q.jitter);
	const offset = Number(q.offset);
	const clamps = Number(q.clamps) > 0;
	const lip0 = Math.max(Number(q.clamp_lip), 0);
	const foot0 = Math.max(Number(q.clamp_foot), 0);
	const js = Math.max(Number(q.joint_size), 0.05);
	const kinds: [unknown, number][] = [
		[q.j_coupling, 0.07],
		[q.j_flange, 0.28],
		[q.j_weld, 0.06]
	];
	const jk = Number(q.joints) > 0 ? Math.max(0, ...kinds.filter(([on]) => on === true).map(([, k]) => k * js)) : 0;

	const runAt = (k: number): Run => {
		const kw = tile ? ((k % n) + n) % n : k;
		const [hx, hy] = hash2I(kw, 0, seed);
		const Ds = diaVar > 0 ? Math.max(Math.floor(f(D0 * f(1 - f(diaVar * hx))) + 0.5), 1) : D0;
		const nb = lo + Math.min(Math.floor(f(hashI(kw, 9, seed) * (span + 1))), span);
		const tot = Ds * nb + gap * (nb - 1);
		const cy = (k + 0.5 + offset) * per + (hy - 0.5) * 2 * Math.min(jitter, 0.5 * Math.max(per - tot, 0));
		const y0 = snapC(cy, tot) - 0.5 * tot;
		const sc = q.clamp_rel !== false ? Ds / D0 : 1;
		const lip = clamps ? Math.max(lip0 * sc, Math.min(lip0, 1.5)) : 0;
		const foot = clamps ? Math.max(foot0 * sc, Math.min(foot0, 3)) : 0;
		return {
			k,
			kw,
			Ds,
			tot,
			bc: y0 + 0.5 * tot,
			hc: 0.5 * tot + lip + 0.5,
			hf: 0.5 * tot + Math.max(jk * Ds, lip + foot) + 0.5,
			jog: null,
			keep: [],
			stored: k >= 0 && k < n
		};
	};
	// Untiled, the runs past the edges are there too (straight, the shader's k outside 0 … n − 1); tiled, the copies
	// one tile up and down are the same runs.
	const reachRuns = Math.ceil((amount * H + per) / per) + 2;
	const runs: Run[] = [];
	for (let k = tile ? 0 : -reachRuns; k < (tile ? n : n + reachRuns); k++) runs.push(runAt(k));
	const copies = tile ? [-H, 0, H] : [0];

	const angle = q.jog_angle === '45' ? 1 : q.jog_angle === 'mixed' ? 2 : 0;
	const order = runs.filter((r) => r.stored).sort((a, b) => hashI(a.kw, 14, seed) - hashI(b.kw, 14, seed));
	for (const A of order) {
		if (!(hashI(A.kw, 10, seed) < chance)) continue;
		const rMax = 0.5 * A.tot + A.Ds;
		const rMin = 0.5 * A.tot + Math.max(1, 0.25 * A.Ds);
		const m = 2 * A.Ds + 2;
		// The free gaps across the runs (A's own place left out), as ranges of A's centre.
		const others = runs
			.filter((r) => r !== A)
			.flatMap((r) => copies.map((o) => ({ bc: r.bc + o, hc: r.hc })))
			.sort((a, b) => a.bc - b.bc);
		for (let t = 0; t < TRIES; t++) {
			const [r0, r1] = hash2I(A.kw, 100 + 3 * t, seed);
			const [r2, r3] = hash2I(A.kw, 101 + 3 * t, seed);
			const [r4, r5] = hash2I(A.kw, 102 + 3 * t, seed);
			const a: Vec = angle === 2 ? [r0 < 0.5 ? 1 : 0, r1 < 0.5 ? 1 : 0] : [angle, angle];
			const kt: Vec = [a[0] ? 0.2928932 : 1, a[1] ? 0.2928932 : 1];
			const tn: Vec = [a[0] ? 0.4142136 : 1, a[1] ? 0.4142136 : 1];
			const room = 0.5 * W - m - rMax * (tn[0] + tn[1]);
			if (room < 0) continue;
			const sMin = Math.ceil(2 * rMin * Math.max(kt[0], kt[1]));
			const sCap = a[0] + a[1] > 0 ? room / (0.5 * (a[0] + a[1])) : Infinity;
			const sHi = Math.min(Math.max(Math.floor(amount * H + 0.5), sMin), sCap);
			if (sHi < sMin) continue;
			// Half the tries aim at a free gap between other runs, half at any step up to the amount.
			let s = 0;
			if (t % 2 === 0) {
				const fits: Vec[] = [];
				for (let i = 0; i + 1 < others.length; i++) {
					const lo = others[i].bc + others[i].hc + A.hc;
					const hi = others[i + 1].bc - others[i + 1].hc - A.hc;
					for (const sg of [-1, 1]) {
						const u0 = Math.max(lo, sg > 0 ? A.bc + sMin : A.bc - sHi);
						const u1 = Math.min(hi, sg > 0 ? A.bc + sHi : A.bc - sMin);
						if (u1 >= u0) fits.push([u0, u1]);
					}
				}
				if (!fits.length) continue;
				const [u0, u1] = fits[Math.min(fits.length - 1, Math.floor(r2 * fits.length))];
				s = Math.round(u0 + r3 * (u1 - u0) - A.bc);
				if (Math.abs(s) < sMin) s = Math.sign(s || 1) * sMin;
			} else s = (r2 < 0.5 ? -1 : 1) * Math.round(sMin + r3 * (sHi - sMin));
			const as = Math.abs(s);
			// Bends as wide as the step allows; the later tries bend tight.
			const rf: Vec = [0, 1].map((i) =>
				t < TRIES / 2 ? Math.min(Math.max(as / (2 * kt[i]), rMin), rMax) : rMin
			) as Vec;
			const w: Vec = [0.5 * as * a[0] + tn[0] * rf[0], 0.5 * as * a[1] + tn[1] * rf[1]];
			const Lmin = w[0] + w[1] + m;
			const x0 = snapC(r4 * W, A.tot);
			const jog: Jog = { s, x: [x0, snapC(x0 + Lmin + r5 * (W - 2 * Lmin), A.tot)], a, rf, w };

			// Against every run planned so far (and A's own copies a tile away).
			const mine = runPieces(A, W, jog, true);
			// Their box, to pass over pieces of other runs (and copies) that can't come near before moving them.
			const mLo: Vec = [Math.min(...mine.map((p) => p.lo[0])), Math.min(...mine.map((p) => p.lo[1]))];
			const mHi: Vec = [Math.max(...mine.map((p) => p.hi[0])), Math.max(...mine.map((p) => p.hi[1]))];
			const keepA: Vec[] = [];
			const keepOf = new Map<Run, Vec[]>();
			let bad = false;
			for (const B of runs) {
				if (bad) break;
				for (const oy of copies) {
					if (B === A && oy === 0) continue;
					// (Only runs whose band across can reach A's.)
					const bJog = B === A ? jog : B.jog;
					const sB = bJog?.s ?? 0;
					const reach = A.hf + B.hf + 1;
					if (Math.max(B.bc, B.bc + sB) + oy < Math.min(A.bc, A.bc + s) - reach) continue;
					if (Math.min(B.bc, B.bc + sB) + oy > Math.max(A.bc, A.bc + s) + reach) continue;
					const keepB = keepOf.get(B) ?? [];
					keepOf.set(B, keepB);
					for (const qb0 of runPieces(B, W, bJog)) {
						for (const ox of [-W, 0, W]) {
							const r = reach + Math.max(A.hf, B.hf);
							if (qb0.lo[0] + ox > mHi[0] + r || qb0.hi[0] + ox < mLo[0] - r) continue;
							if (qb0.lo[1] + oy > mHi[1] + r || qb0.hi[1] + oy < mLo[1] - r) continue;
							const qb = shift(qb0, [ox, oy]);
							for (const qa of mine)
								if (clash(A, qa, B, qb, ox, keepA, B === A ? keepA : keepB)) {
									bad = true;
									break;
								}
							if (bad) break;
						}
						if (bad) break;
					}
					if (bad) break;
				}
			}
			if (bad) continue;
			// The fitting-free stretches must fit the records.
			const ownSteps: Vec[] = [
				[jog.x[0] - w[0], jog.x[0] + w[0]],
				[jog.x[1] - w[1], jog.x[1] + w[1]]
			];
			const nextA = mergeKeep([...A.keep, ...ownSteps, ...keepA], W);
			const next = new Map<Run, Vec[]>();
			for (const [B, kb] of keepOf) if (B !== A && kb.length) next.set(B, mergeKeep([...B.keep, ...kb], W));
			if (nextA.length > JOG_KEEP || [...next].some(([B, kb]) => B.stored && kb.length > JOG_KEEP)) continue;
			A.jog = jog;
			A.keep = nextA;
			for (const [B, kb] of next) B.keep = kb;
			break;
		}
	}
	return { runs, W, H };
}
