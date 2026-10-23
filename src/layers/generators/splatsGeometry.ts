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

export function buildSplats(o: SplatOptions): SplatPrim[] {
	const r = rng(o.seed * 7919 + 13);
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
	/** A direction for spray: all round, or towards the aim (a fan narrowing with One-sided). */
	const sprayAngle = () => {
		const spread = Math.PI * (1 - 0.85 * Math.min(1, o.oneSided));
		return o.oneSided > 0 && r() < 0.6 + 0.4 * o.oneSided ? aim + (r() + r() - 1) * spread : r() * 2 * Math.PI;
	};
	/**
	 * A run: from a neck inside its source (x, y), wobbling down, width w narrowing a little as it leaves liquid behind,
	 * a bead at its end.
	 */
	const run = (x: number, y: number, w: number, len: number, rnd: number, neck = 0) => {
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

	// Splats on a jittered grid, so they spread over the texture without clumping (which the tiling would show).
	// With gravity, wider than tall, so runs don't fall into the splat below.
	const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * W) / H) * (1 + g))));
	const rows = Math.max(1, Math.ceil(n / cols));
	const cells = Array.from({ length: cols * rows }, (_, i) => i);
	for (let i = cells.length - 1; i > 0; i--) {
		const j = Math.floor(r() * (i + 1));
		[cells[i], cells[j]] = [cells[j], cells[i]];
	}
	for (let s = 0; s < n && prims.length < MAX_SPLAT_PRIMS; s++) {
		const cell = cells[s % cells.length];
		const cx = ((cell % cols) + 0.15 + 0.7 * r()) * (W / cols);
		const cy = (Math.floor(cell / cols) + 0.15 + 0.7 * r()) * (H / rows);
		const rnd = r();
		// Sizes spread log-normally-ish: most near Size, a few much bigger or smaller.
		const R = Math.max(0.75, o.size * Math.exp((r() + r() - 1) * 1.2 * o.sizeVar));
		const k = 0.2 * R;

		// The core: a body and lobes around it, sagging downhill with gravity; with Ragged core, clumps breaking off it.
		const sag = 0.5 * g * R;
		ellipse(cx + gx * sag * 0.5, cy + gy * sag * 0.5, gx, gy, R * 0.75 * (1 + 0.6 * g), R * 0.75, k, 1, rnd);
		const lobes = 4 + Math.round(10 * o.ragged * (0.5 + r()));
		for (let l = 0; l < lobes; l++) {
			const a = r() * 2 * Math.PI;
			const dist = R * (0.25 + (0.75 + 0.35 * o.ragged) * o.ragged * r());
			const lr = R * (0.15 + 0.4 * r() ** 1.5) * (1 - 0.35 * o.ragged * r());
			const ax = Math.cos(a);
			const ay = Math.sin(a);
			ellipse(cx + ax * dist + gx * sag, cy + ay * dist + gy * sag, ax, ay, lr * (1 + 0.5 * r()), lr, k, 1, rnd);
		}
		// Bites out of the rim: concave notches between the lobes.
		const bites = Math.round(7 * o.ragged * (0.4 + r()));
		for (let l = 0; l < bites; l++) {
			const a = r() * 2 * Math.PI;
			const br = R * (0.12 + 0.22 * r());
			const dist = R * (0.85 + 0.35 * o.ragged * r()) + br * 0.6;
			const ax = Math.cos(a);
			const ay = Math.sin(a);
			bite(cx + ax * dist + gx * sag, cy + ay * dist + gy * sag, -ay, ax, br * (1 + r()), br, 0.3 * br);
		}
		const clumps = Math.round(8 * o.ragged * splash * (0.3 + r()));
		for (let l = 0; l < clumps; l++) {
			const a = sprayAngle();
			const ax = Math.sin(a);
			const ay = -Math.cos(a);
			const lr = R * (0.12 + 0.22 * r());
			const dist = R * (0.95 + 0.5 * r()) + lr;
			ellipse(cx + ax * dist, cy + ay * dist, ax, ay, lr * (1.2 + 0.6 * r()), lr, 0.4 * lr, 1, rnd);
		}

		// A pour spreads into a few satellite puddles at its rim.
		const puddles = Math.round(4 * o.ragged * (1 - Math.min(1, splash)) * (0.3 + r()));
		for (let l = 0; l < puddles; l++) {
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

		/** A streak from the core's edge outwards: tapering to a point, slightly bent, maybe a drop beyond its tip. */
		const streak = (a: number, len: number, w0: number, tipDrop: number) => {
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
		// A crown of short spikes round the rim, and a few long jets — the longest few much longer than the rest.
		const spikes = Math.round(2 * o.jets * splash * (0.5 + r()));
		for (let j = 0; j < spikes; j++)
			streak(sprayAngle(), R * splash * (0.25 + 0.6 * r()), R * (0.07 + 0.12 * r()), r() < 0.3 ? 1 : 0);
		const jets = Math.round(o.jets * splash * (0.5 + r()));
		for (let j = 0; j < jets; j++) {
			const len = R * o.jetLength * splash * (0.3 + 2.4 * r() ** 3);
			streak(sprayAngle(), len, R * (0.06 + 0.12 * r()), r() < 0.6 ? 1 + Math.floor(3 * r()) : 0);
		}

		// Satellite droplets: many tiny, a few big; the far ones stretched along their flight with a short tail.
		const drops = Math.round(60 * o.drops * splash * (0.6 + 0.8 * r()));
		const big: [number, number, number][] = [];
		for (let d = 0; d < drops && prims.length < MAX_SPLAT_PRIMS; d++) {
			const a = sprayAngle();
			const ax = Math.sin(a);
			const ay = -Math.cos(a);
			const f = r() ** 1.3;
			const dist = R * (0.85 + o.reach * f);
			const dr = Math.max(0.6, R * 0.22 * r() ** 5 * (1 - 0.5 * f));
			const stretch = 1 + 1.2 * f * Math.min(1, dr / 1.5);
			const x = cx + ax * dist;
			const y = cy + ay * dist;
			// Under gravity a big drop near the core slides: stretched downhill, often running on.
			if (g > 0 && dr > 0.12 * R && f < 0.5 && r() < 0.8 * g) {
				ellipse(x, y, gx, gy, dr * (1 + g), dr * 0.85, 0.3 * dr, 0.8, rnd);
				big.push([x, y, dr]);
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
			if (dr > 1.5) big.push([x, y, dr]);
		}
		// Fine mist: specks of a px or two, flying furthest.
		// As many as a splat this size can throw (fewer on small ones), thinning out with distance.
		const mist = Math.round(150 * o.mist * splash * Math.min(1, (R / 15) ** 1.5) * (0.6 + 0.8 * r()));
		for (let d = 0; d < mist && prims.length < MAX_SPLAT_PRIMS; d++) {
			const a = sprayAngle();
			const dist = R * (0.9 + 1.3 * o.reach * r() ** 1.6);
			const dr = Math.max(0.6, R * (0.025 + 0.05 * r() ** 2));
			ellipse(cx + Math.sin(a) * dist, cy - Math.cos(a) * dist, 1, 0, dr, dr, 0.2 * dr, 1, rnd);
		}

		// Gravity: runs from the core's downhill edge and from the bigger drops.
		if (g > 0) {
			const runs = Math.round(o.runs * g * (0.4 + 0.8 * r()));
			for (let u = 0; u < runs; u++) {
				// Across the downhill edge, mostly near its middle.
				// Spread along the downhill edge (stratified, so runs don't fall on one line), the first near the middle.
				const across =
					u === 0 ? (r() - 0.5) * 0.4 * R : ((u - 0.5 + r()) / runs - 0.5) * 1.5 * R * (r() < 0.5 ? -1 : 1);
				const edge = Math.sqrt(Math.max(0, 1 - (across / (0.9 * R)) ** 2));
				const x = cx + gx * (0.7 * R * edge + sag) - gy * across;
				const y = cy + gy * (0.7 * R * edge + sag) + gx * across;
				const w = R * (0.08 + 0.08 * r()) * (u === 0 ? 1.25 : 1);
				const len = R * o.runLength * g * (u === 0 ? 1 : 0.25 + 0.65 * r());
				run(x, y, Math.max(0.5, w), len, rnd, 0.25 * R);
			}
			for (const [x, y, dr] of big)
				if (r() < g * 0.6)
					run(
						x + gx * dr * 0.6,
						y + gy * dr * 0.6,
						dr * 0.55,
						R * o.runLength * g * 0.35 * (dr / R) * (0.5 + r()),
						rnd
					);
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
