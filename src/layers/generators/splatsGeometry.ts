// Liquid splats (docs/features/fr8.24-liquid-splats.md): the CPU half. Every splat is built from the seed as a list of
// primitives — circles / ellipses and tapered capsules — that the shader unions (smoothly within a splat's body, so
// lobes, jets and runs flow into one another) and turns into a thickness. Positions are user px (y down); tiling is
// the shader's (each primitive is measured around the wrap from its own anchor, so pieces stay under half the tile).
//
// A splat: an irregular core of overlapping lobes; jets thrown out of it, long, thin and tapering, some ending in a
// drop; satellite droplets, mostly tiny, a few big, the far ones elongated along their flight with a short tail; with
// gravity, runs from the core's downhill edge (and from the bigger drops) that wobble down and end in a bead, and the
// core sagging that way. The spray can be thrown all round or to one side.

export const SPLAT_ELLIPSE = 0;
export const SPLAT_CAPSULE = 1;
/** An ellipse cut out of what came before it: a bite out of a core's rim. */
export const SPLAT_BITE = 2;

export interface SplatPrim {
	kind: typeof SPLAT_ELLIPSE | typeof SPLAT_CAPSULE | typeof SPLAT_BITE;
	/** Anchor (user px): the centre of an ellipse, the start of a capsule. */
	x: number;
	y: number;
	/** Capsule: end minus start (px). Ellipse: its major axis direction (unit). */
	dx: number;
	dy: number;
	/** Ellipse: radii along / across the axis. Capsule: radius at the start and at the end. */
	r0: number;
	r1: number;
	/** Smooth-union radius (px) with what it joins. */
	k: number;
	/** Thickness factor: a bead is fuller than the run above it, a jet thinner than the core. */
	swell: number;
	/** The splat's own random (0..1): per-feature variation. */
	rnd: number;
}

export interface SplatOptions {
	width: number;
	height: number;
	tile: boolean;
	seed: number;
	/** Splats in the texture. */
	count: number;
	/** Core radius (px) and its variation (0..1). */
	size: number;
	sizeVar: number;
	/** 0 a poured pool (no spray) … 1 a hard impact. */
	splash: number;
	/** Irregular core: lobes, bites out of its rim and clumps breaking off it (0..1). */
	ragged: number;
	/** Jets per splat at full splash, and their length (× core radius). */
	jets: number;
	jetLength: number;
	/** Satellite droplets (0..3 — about 60 per splat at 1 and full splash) and how far they fly (× core radius). */
	drops: number;
	reach: number;
	/** Fine mist: specks of a px or two (0..3 — about 150 per splat at 1 and full splash). */
	mist: number;
	/** Spray direction (degrees, 0 = up, clockwise) and how one-sided it is (0 all round … 1 a narrow fan). */
	aim: number;
	oneSided: number;
	/** 0 lying flat (pools) … 1 running. Direction: degrees, 0 = straight down, clockwise. */
	gravity: number;
	gravityAngle: number;
	/** Runs per splat at full gravity, their length (× core radius), and the bead at their end (0..1). */
	runs: number;
	runLength: number;
	bead: number;
}

/** Small seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Most primitives the shader loops over. */
export const MAX_SPLAT_PRIMS = 4000;

/** What a random stream is for (with the splat and the part's index): every part draws from its own. */
const GRID = 1;
const SPLAT = 2;
const LOBE = 3;
const BITE = 4;
const CLUMP = 5;
const PUDDLE = 6;
const SPIKE = 7;
const JET = 8;
const DROP = 9;
const MIST = 10;
const RUN = 11;

export function buildSplats(o: SplatOptions): SplatPrim[] {
	// Every splat, and every part of one (a lobe, a jet, a droplet, a run), draws from a stream of its own, keyed by the
	// seed, what it is and its index: changing a count adds or drops parts without moving the others, and the layout
	// (where the splats sit, how big they are) changes only with the seed and the number of splats.
	const stream = (kind: number, a = 0, b = 0) => {
		let h = Math.imul(o.seed * 7919 + 13, 0x9e3779b1) ^ Math.imul(kind, 0x85ebca6b);
		h = Math.imul(h ^ (h >>> 15) ^ Math.imul(a + 1, 0xc2b2ae35), 0x27d4eb2f);
		h = Math.imul(h ^ (h >>> 13) ^ Math.imul(b + 1, 0x165667b1), 0x9e3779b1);
		return rng(h ^ (h >>> 16));
	};
	const prims: SplatPrim[] = [];
	const W = o.width;
	const H = o.height;
	// A piece longer than this is cut into segments, each anchored on its own (the shader wraps per anchor).
	const maxSeg = o.tile ? Math.max(4, 0.4 * Math.min(W, H)) : Infinity;
	const splash = Math.max(0, o.splash);
	const g = Math.max(0, Math.min(1, o.gravity));
	// Gravity pulls this way (user px, y down): 0° = down, clockwise.
	const ga = (o.gravityAngle * Math.PI) / 180;
	const gx = -Math.sin(ga);
	const gy = Math.cos(ga);
	const aim = (o.aim * Math.PI) / 180;
	const n = Math.max(0, Math.round(o.count));

	const ellipse = (
		x: number,
		y: number,
		ax: number,
		ay: number,
		ra: number,
		rb: number,
		k: number,
		swell: number,
		rnd: number
	) => prims.push({ kind: SPLAT_ELLIPSE, x, y, dx: ax, dy: ay, r0: ra, r1: rb, k, swell, rnd });
	const bite = (x: number, y: number, ax: number, ay: number, ra: number, rb: number, k: number) =>
		prims.push({ kind: SPLAT_BITE, x, y, dx: ax, dy: ay, r0: ra, r1: rb, k, swell: 1, rnd: 0 });
	/** A tapered capsule from (x, y) by (dx, dy), cut into segments under maxSeg. */
	const capsule = (
		x: number,
		y: number,
		dx: number,
		dy: number,
		ra: number,
		rb: number,
		k: number,
		swell: number,
		rnd: number
	) => {
		const len = Math.hypot(dx, dy);
		const parts = Math.max(1, Math.ceil(len / maxSeg));
		for (let i = 0; i < parts; i++) {
			const t0 = i / parts;
			const t1 = (i + 1) / parts;
			prims.push({
				kind: SPLAT_CAPSULE,
				x: x + dx * t0,
				y: y + dy * t0,
				dx: dx / parts,
				dy: dy / parts,
				r0: ra + (rb - ra) * t0,
				r1: ra + (rb - ra) * t1,
				k,
				swell,
				rnd
			});
		}
	};
	/**
	 * A direction for spray from a part's stream: all round, or towards the aim (a fan narrowing with One-sided). Always
	 * three draws, so One-sided bends the spray rather than reshuffling what follows.
	 */
	const sprayAngle = (r: () => number) => {
		const pick = r();
		const u = r();
		const v = r();
		const spread = Math.PI * (1 - 0.85 * Math.min(1, o.oneSided));
		return o.oneSided > 0 && pick < 0.6 + 0.4 * o.oneSided ? aim + (u + v - 1) * spread : u * 2 * Math.PI;
	};
	/**
	 * A run: from a neck inside its source (x, y), wobbling down, width w narrowing a little as it leaves liquid behind,
	 * a bead at its end.
	 */
	const run = (r: () => number, x: number, y: number, w: number, len: number, rnd: number, neck = 0) => {
		if (neck > 0)
			capsule(x - gx * neck, y - gy * neck, gx * neck * 1.6, gy * neck * 1.6, w * 1.9, w, 0.8 * w, 0.85, rnd);
		const step = Math.max(3, 3 * w);
		const parts = Math.max(1, Math.ceil(len / step));
		let px = x;
		let py = y;
		let lat = 0;
		let wa = w;
		for (let i = 0; i < parts; i++) {
			const seg = len / parts;
			// The run wanders sideways and narrows as it goes.
			const nlat = Math.max(-1, Math.min(1, lat + (r() - 0.5) * 0.9));
			const off = (nlat - lat) * 0.14 * seg;
			lat = nlat;
			const ex = gx * seg - gy * off;
			const ey = gy * seg + gx * off;
			const wb = Math.max(0.5, wa * (0.9 + 0.08 * r()));
			capsule(px, py, ex, ey, wa, wb, 0.6 * wa, 0.75, rnd);
			px += ex;
			py += ey;
			wa = wb;
		}
		if (o.bead > 0) {
			// From the run's starting width: the liquid it carried collects there.
			const br = Math.max(wa, w * (0.9 + 1.4 * o.bead)) * (0.85 + 0.3 * r());
			// Elongated along the fall, sitting just below the run's end.
			ellipse(
				px + gx * br * 0.4,
				py + gy * br * 0.4,
				gx,
				gy,
				br * (1 + 0.3 * o.bead),
				br,
				0.8 * wa,
				1 + 0.6 * o.bead,
				rnd
			);
		}
	};

	// Splats on a jittered grid, so they spread over the texture without clumping (which the tiling would show) — by the
	// number of splats and the texture's shape only.
	const cols = Math.max(1, Math.round(Math.sqrt((n * W) / H)));
	const rows = Math.max(1, Math.ceil(n / cols));
	const cells = Array.from({ length: cols * rows }, (_, i) => i);
	const rg = stream(GRID);
	for (let i = cells.length - 1; i > 0; i--) {
		const j = Math.floor(rg() * (i + 1));
		[cells[i], cells[j]] = [cells[j], cells[i]];
	}
	for (let s = 0; s < n && prims.length < MAX_SPLAT_PRIMS; s++) {
		// The splat's own draws, in a fixed order: where it sits, its random, its size, then how many of each part.
		const r = stream(SPLAT, s);
		const cell = cells[s % cells.length];
		const cx = ((cell % cols) + 0.15 + 0.7 * r()) * (W / cols);
		const cy = (Math.floor(cell / cols) + 0.15 + 0.7 * r()) * (H / rows);
		const rnd = r();
		// Sizes spread log-normally-ish: most near Size, a few much bigger or smaller.
		const R = Math.max(0.75, o.size * Math.exp((r() + r() - 1) * 1.2 * o.sizeVar));
		const k = 0.2 * R;
		const nLobe = r();
		const nBite = r();
		const nClump = r();
		const nPuddle = r();
		const nSpike = r();
		const nJet = r();
		const nDrop = r();
		const nMist = r();
		const nRun = r();
		const runOffset = r();
		// Its share of the primitives left: with many splats each gets fewer runs, jets, spikes, droplets and specks (in
		// that order) instead of the last splats going missing.
		const end = prims.length + Math.floor((MAX_SPLAT_PRIMS - prims.length) / (n - s));

		// The core: a body and lobes around it, sagging downhill with gravity; with Ragged core, clumps breaking off it.
		const sag = 0.5 * g * R;
		ellipse(cx + gx * sag * 0.5, cy + gy * sag * 0.5, gx, gy, R * 0.75 * (1 + 0.6 * g), R * 0.75, k, 1, rnd);
		const lobes = 4 + Math.round(10 * o.ragged * (0.5 + nLobe));
		for (let l = 0; l < lobes; l++) {
			const r = stream(LOBE, s, l);
			const a = r() * 2 * Math.PI;
			const dist = R * (0.25 + (0.75 + 0.35 * o.ragged) * o.ragged * r());
			const lr = R * (0.15 + 0.4 * r() ** 1.5) * (1 - 0.35 * o.ragged * r());
			const ax = Math.cos(a);
			const ay = Math.sin(a);
			ellipse(cx + ax * dist + gx * sag, cy + ay * dist + gy * sag, ax, ay, lr * (1 + 0.5 * r()), lr, k, 1, rnd);
		}
		// Bites out of the rim: concave notches between the lobes.
		const bites = Math.round(7 * o.ragged * (0.4 + nBite));
		for (let l = 0; l < bites; l++) {
			const r = stream(BITE, s, l);
			const a = r() * 2 * Math.PI;
			const br = R * (0.12 + 0.22 * r());
			const dist = R * (0.85 + 0.35 * o.ragged * r()) + br * 0.6;
			const ax = Math.cos(a);
			const ay = Math.sin(a);
			bite(cx + ax * dist + gx * sag, cy + ay * dist + gy * sag, -ay, ax, br * (1 + r()), br, 0.3 * br);
		}
		const clumps = Math.round(8 * o.ragged * splash * (0.3 + nClump));
		for (let l = 0; l < clumps; l++) {
			const r = stream(CLUMP, s, l);
			const a = sprayAngle(r);
			const ax = Math.sin(a);
			const ay = -Math.cos(a);
			const lr = R * (0.12 + 0.22 * r());
			const dist = R * (0.95 + 0.5 * r()) + lr;
			ellipse(cx + ax * dist, cy + ay * dist, ax, ay, lr * (1.2 + 0.6 * r()), lr, 0.4 * lr, 1, rnd);
		}

		// A pour spreads into a few satellite puddles at its rim.
		const puddles = Math.round(4 * o.ragged * (1 - Math.min(1, splash)) * (0.3 + nPuddle));
		for (let l = 0; l < puddles; l++) {
			const r = stream(PUDDLE, s, l);
			const a = r() * 2 * Math.PI;
			const ax = Math.cos(a);
			const ay = Math.sin(a);
			const lr = R * (0.1 + 0.2 * r());
			// A gap away from the rim, so they read as puddles of their own.
			const dist = R * (1.05 + 0.3 * r()) + lr * 1.3;
			ellipse(
				cx + ax * dist + gx * sag,
				cy + ay * dist + gy * sag,
				ax,
				ay,
				lr * (1.1 + 0.5 * r()),
				lr,
				0.5 * lr,
				1,
				rnd
			);
		}

		// Gravity: runs from the core's downhill edge and from the bigger drops.
		if (g > 0) {
			const runs = Math.round(o.runs * g * (0.4 + 0.8 * nRun));
			for (let u = 0; u < runs && prims.length < end; u++) {
				const r = stream(RUN, s, u);
				// Spread along the downhill edge, the first near the middle, the others by the golden ratio — so runs don't
				// fall on one line, and one more doesn't move the rest.
				const jit = r();
				const across =
					u === 0 ? (jit - 0.5) * 0.4 * R : (((runOffset + u * 0.618034 + 0.15 * (jit - 0.5)) % 1) - 0.5) * 1.5 * R;
				const edge = Math.sqrt(Math.max(0, 1 - (across / (0.9 * R)) ** 2));
				const x = cx + gx * (0.7 * R * edge + sag) - gy * across;
				const y = cy + gy * (0.7 * R * edge + sag) + gx * across;
				const w = R * (0.08 + 0.08 * r()) * (u === 0 ? 1.25 : 1);
				const len = R * o.runLength * g * (u === 0 ? 1 : 0.25 + 0.65 * r());
				run(r, x, y, Math.max(0.5, w), len, rnd, 0.25 * R);
			}
		}

		/** A streak from the core's edge outwards: tapering to a point, slightly bent, maybe a drop beyond its tip. */
		const streak = (r: () => number, a: number, len: number, w0: number, tipDrop: number) => {
			const ax = Math.sin(a);
			const ay = -Math.cos(a);
			const sx = cx + ax * R * 0.5;
			const sy = cy + ay * R * 0.5;
			// A stream thinner than a pixel or so breaks up into drops (as a thin jet of liquid does).
			if (w0 < 0.9) {
				for (let t = 2 * w0 + 1.5 * r(); t < len; t += 2.5 + 3 * r()) {
					const dr = Math.max(0.5, w0 * (0.8 + 0.6 * r()));
					ellipse(sx + ax * t, sy + ay * t, ax, ay, dr * 1.3, dr, 0.3 * dr, 1, rnd);
				}
				return;
			}
			const w1 = Math.max(0.5, w0 * (0.12 + 0.2 * r()));
			const bend = (r() - 0.5) * 0.2 * len;
			const mx = ax * len * 0.5 - ay * bend;
			const my = ay * len * 0.5 + ax * bend;
			const wm = Math.max(0.6, w0 * 0.55 + w1 * 0.45);
			capsule(sx, sy, mx, my, w0, wm, 0.6 * w0, 0.8, rnd);
			const ex = ax * len * 0.5 + ay * bend;
			const ey = ay * len * 0.5 - ax * bend;
			capsule(sx + mx, sy + my, ex, ey, wm, w1, 0.5 * wm, 0.7, rnd);
			// Drops strung out beyond the tip, along the jet's line, smaller as they go.
			let tx = sx + mx + ex;
			let ty = sy + my + ey;
			let dr = Math.max(0.5, w0 * (0.5 + 0.9 * r()));
			for (let q = 0; q < tipDrop && dr >= 0.5; q++) {
				const gap = dr * (1.5 + 3 * r());
				tx += ax * gap + (r() - 0.5) * dr;
				ty += ay * gap + (r() - 0.5) * dr;
				ellipse(tx, ty, ax, ay, dr * (1.2 + 0.5 * r()), dr, 0.4 * dr, 1, rnd);
				dr *= 0.5 + 0.35 * r();
			}
		};
		// A few long jets — the longest few much longer than the rest.
		const jets = Math.round(o.jets * splash * (0.5 + nJet));
		for (let j = 0; j < jets && prims.length < end; j++) {
			const r = stream(JET, s, j);
			const a = sprayAngle(r);
			const len = R * o.jetLength * splash * (0.3 + 2.4 * r() ** 3);
			const w0 = R * (0.06 + 0.12 * r());
			const tip = r();
			const tips = r();
			streak(r, a, len, w0, tip < 0.6 ? 1 + Math.floor(3 * tips) : 0);
		}
		// A crown of short spikes round the rim.
		const spikes = Math.round(2 * o.jets * splash * (0.5 + nSpike));
		for (let j = 0; j < spikes && prims.length < end; j++) {
			const r = stream(SPIKE, s, j);
			const a = sprayAngle(r);
			const len = R * splash * (0.25 + 0.6 * r());
			const w0 = R * (0.07 + 0.12 * r());
			streak(r, a, len, w0, r() < 0.3 ? 1 : 0);
		}

		// Satellite droplets: many tiny, a few big; the far ones stretched along their flight with a short tail.
		const drops = Math.round(60 * o.drops * splash * (0.6 + 0.8 * nDrop));
		for (let d = 0; d < drops && prims.length < end; d++) {
			const r = stream(DROP, s, d);
			const a = sprayAngle(r);
			const ax = Math.sin(a);
			const ay = -Math.cos(a);
			const f = r() ** 1.3;
			const dist = R * (0.85 + o.reach * f);
			const dr = Math.max(0.6, R * 0.22 * r() ** 5 * (1 - 0.5 * f));
			const slide = r();
			const runs = r();
			const runLen = r();
			const stretch = 1 + 1.2 * f * Math.min(1, dr / 1.5);
			const x = cx + ax * dist;
			const y = cy + ay * dist;
			// Under gravity the bigger drops run (some), and one near the core slides: stretched downhill.
			if (g > 0 && dr > 1.5 && runs < g * 0.6)
				run(
					r,
					x + gx * dr * 0.6,
					y + gy * dr * 0.6,
					dr * 0.55,
					R * o.runLength * g * 0.35 * (dr / R) * (0.5 + runLen),
					rnd
				);
			if (g > 0 && dr > 0.12 * R && f < 0.5 && slide < 0.8 * g) {
				ellipse(x, y, gx, gy, dr * (1 + g), dr * 0.85, 0.3 * dr, 0.8, rnd);
				continue;
			}
			// The bigger drops a little lower than the core, and with a tail along their flight.
			ellipse(x, y, ax, ay, dr * stretch, dr, 0.3 * dr, dr > 0.15 * R ? 0.8 : 1, rnd);
			if ((f > 0.4 || dr > 0.15 * R) && dr > 0.8)
				capsule(
					x + ax * dr * stretch * 0.6,
					y + ay * dr * stretch * 0.6,
					ax * dr * 2 * f,
					ay * dr * 2 * f,
					dr * 0.45,
					0.3,
					0.3 * dr,
					0.7,
					rnd
				);
		}
		// Fine mist: specks of a px or two, flying furthest.
		// As many as a splat this size can throw (fewer on small ones), thinning out with distance.
		const mist = Math.round(150 * o.mist * splash * Math.min(1, (R / 15) ** 1.5) * (0.6 + 0.8 * nMist));
		for (let d = 0; d < mist && prims.length < end; d++) {
			const r = stream(MIST, s, d);
			const a = sprayAngle(r);
			const dist = R * (0.9 + 1.3 * o.reach * r() ** 1.6);
			const dr = Math.max(0.6, R * (0.025 + 0.05 * r() ** 2));
			ellipse(cx + Math.sin(a) * dist, cy - Math.cos(a) * dist, 1, 0, dr, dr, 0.2 * dr, 1, rnd);
		}
	}
	return prims.slice(0, MAX_SPLAT_PRIMS);
}

/**
 * The primitive texture, up to 1024 texels a row: texel 0 = header (count); then 4 texels per primitive, two 16-bit
 * values each (high byte first): [x, y] [dx, dy] [r0, r1] [kind · k, swell, rnd]. Positions and capsule offsets are
 * (v + 4096) × 8; an ellipse's (or bite's) axis is its angle (−π..π onto 0..65535) in dx; radii × 64; k × 32 in the
 * low 14 bits with the kind (0 ellipse, 1 capsule, 2 bite) in the top two; then swell × 100 and rnd × 255 a byte each.
 */
export function encodeSplats(prims: SplatPrim[]): { width: number; height: number; data: Uint8Array } {
	const n = prims.length;
	// Up to 1024 texels a row.
	const texels = 1 + 4 * n;
	const width = Math.min(1024, texels);
	const height = Math.ceil(texels / width);
	const data = new Uint8Array(width * height * 4);
	const put16 = (texel: number, slot: number, v: number) => {
		const q = Math.max(0, Math.min(65535, Math.round(v)));
		data[texel * 4 + slot * 2] = q >> 8;
		data[texel * 4 + slot * 2 + 1] = q & 255;
	};
	const pos = (v: number) => (Math.max(-4096, Math.min(4095, v)) + 4096) * 8;
	put16(0, 0, n);
	prims.forEach((p, i) => {
		const t = 1 + 4 * i;
		put16(t, 0, pos(p.x));
		put16(t, 1, pos(p.y));
		if (p.kind === SPLAT_CAPSULE) {
			put16(t + 1, 0, pos(p.dx));
			put16(t + 1, 1, pos(p.dy));
		} else put16(t + 1, 0, (Math.atan2(p.dy, p.dx) / Math.PI) * 0.5 * 65535 + 32767.5);
		put16(t + 2, 0, p.r0 * 64);
		put16(t + 2, 1, p.r1 * 64);
		put16(t + 3, 0, Math.min(16383, p.k * 32) + p.kind * 16384);
		data[(t + 3) * 4 + 2] = Math.max(0, Math.min(255, Math.round(p.swell * 100)));
		data[(t + 3) * 4 + 3] = Math.max(0, Math.min(255, Math.round(p.rnd * 255)));
	});
	return { width, height, data };
}
