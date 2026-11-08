// Liquid splats (docs/features/fr8.24-liquid-splats.md): blood, water or oil thrown, poured or running down. The
// splats are built on the CPU (splatsGeometry.ts) as circles, ellipses and tapered capsules; the shader unions them
// into one distance (smoothly within a splat's body, so lobes, jets and runs flow together) and turns the depth inside
// into the liquid's thickness — rising over a meniscus at the edge to a flat top where the pool is deep, as surface
// tension holds a real one: small drops stay domed and low, big pools flat. Value = thickness (0..1) for the ramp and
// Height; the outline goes to the mask it writes.

import { memoReads } from '@/core/memo';
import { P, defaultParams, gradient, halfPx, type ParamDef, type ParamValues } from '@/core/params';
import { PX_SCALE_PARAM } from '../commonParams';
import { GLSL_PRIMTEX, PRIM_UNIFORMS, primUniforms } from '../primTexture';
import { memoOn } from '@/core/memo';
import type { LayerCanvas, LayerDef } from '../types';
import {
	SPLAT_STRIDE,
	buildSplats,
	encodeSplats,
	parseSplatPoints,
	type SplatGrid,
	type SplatPrim
} from './splatsGeometry';

const sprayed = (p: Record<string, unknown>) => Number(p.splash) > 0;
const isPlaced = (p: Record<string, unknown>) => p.layout === 'drawn';
const running = (p: Record<string, unknown>) => Number(p.gravity) > 0;

const PARAMS: ParamDef[] = [
	P.enum('layout', 'Layout', 'random', [
		['random', 'Random'],
		['drawn', 'Placed by hand']
	]),
	P.int('count', 'Splats', 3, 0, 200, {
		softMax: 24,
		showIf: (p) => !isPlaced(p),
		hint: 'How many splats to throw across the texture (they’re placed on a jittered grid, so they spread out)'
	}),
	P.bitmap('points', 'Splat points', '20,20 44,40', 'lines', {
		hint: 'Puts a splat on every point (x,y px from the top-left, or 0…1 with Units = fraction). Place them with the shape editor; the lines between points don’t matter',
		showIf: isPlaced,
		uniform: false,
		shapeEdit: { adds: 'Splats', hint: 'a splat on each point', min: 1, budget: 512, dots: true }
	}),
	P.enum(
		'units',
		'Units',
		'px',
		[
			['px', 'Pixels'],
			['fraction', 'Fraction of the texture']
		],
		{ showIf: isPlaced }
	),
	P.float('size', 'Size', 10, 0.5, 512, {
		softMax: 64,
		unit: 'px',
		step: 0.1,
		hint: 'Sets the radius of each splat’s core'
	}),
	P.float('size_var', 'Size variation', 0.5, 0, 1, {
		step: 0.001,
		hint: 'Makes the splats differ in size (0 = all the same)'
	}),
	P.float('ragged', 'Ragged core', 0.5, 0, 1, {
		step: 0.001,
		hint: 'Roughens the core’s outline (0 = a round pool, 1 = lots of lobes straying out, with bites out of the rim and clumps breaking off)'
	}),
	P.float('tear', 'Tear', 0.5, 0, 1, {
		step: 0.001,
		hint: 'Warps the outlines at the size of the splats, so the cores tear into fingers and bays instead of round lobes'
	}),
	P.float('edge', 'Edge roughness', 0.6, 0, 4, {
		softMax: 2,
		unit: 'px',
		step: 0.01,
		hint: 'Adds fine wobbles to every edge'
	}),
	P.float('splash', 'Splash', 0.7, 0, 1, {
		step: 0.001,
		section: 'Spray',
		hint: 'Throws jets and droplets out of the core (0 = a poured pool with no spray, 1 = a hard impact)'
	}),
	P.int('jets', 'Jets', 8, 0, 48, {
		softMax: 24,
		section: 'Spray',
		showIf: sprayed,
		hint: 'How many long jets each splat throws out at full Splash. They taper to a point, often with drops strung out past the tip, and twice as many short spikes show up round the rim'
	}),
	P.float('jet_len', 'Jet length', 2.2, 0, 12, {
		softMax: 6,
		step: 0.01,
		section: 'Spray',
		showIf: sprayed,
		hint: 'How far the jets reach, in core radii (the longest few go much further than the rest)'
	}),
	P.float('drops', 'Droplets', 1, 0, 3, {
		softMax: 3,
		step: 0.01,
		section: 'Spray',
		showIf: sprayed,
		hint: 'Scatters droplets round each splat, mostly tiny with a few big ones (1 ≈ 60 per splat at full Splash)'
	}),
	P.float('reach', 'Droplet reach', 2.5, 0, 12, {
		softMax: 6,
		step: 0.01,
		section: 'Spray',
		showIf: sprayed,
		hint: 'How far the droplets fly, in core radii. The far ones get stretched along their flight'
	}),
	P.float('mist', 'Fine mist', 1, 0, 3, {
		softMax: 3,
		step: 0.01,
		section: 'Spray',
		showIf: sprayed,
		hint: 'Adds a dust of specks a px or two across that fly furthest of all (1 ≈ 150 per splat at full Splash)'
	}),
	P.float('aim', 'Spray direction', 0, -180, 180, {
		step: 0.1,
		unit: '°',
		section: 'Spray',
		showIf: (p) => sprayed(p) && Number(p.one_sided) > 0,
		hint: 'Points a one-sided spray (0 = up, 90 = right)'
	}),
	P.float('one_sided', 'One-sided', 0, 0, 1, {
		step: 0.001,
		section: 'Spray',
		showIf: sprayed,
		hint: 'Throws the spray to one side, like an impact at an angle (0 = sprayed all round, 1 = a narrow fan to one side)'
	}),
	P.float('gravity', 'Gravity', 0, 0, 1, {
		step: 0.001,
		section: 'Gravity',
		hint: 'Makes the liquid run down as if on a wall (0 = lying flat in pools, 1 = the core sags and runs drip from its lower edge and the bigger drops)'
	}),
	P.float('grav_angle', 'Gravity direction', 0, -180, 180, {
		step: 0.1,
		unit: '°',
		section: 'Gravity',
		showIf: running,
		hint: 'Points the runs (0 = straight down, 90 = to the left, −90 = to the right)'
	}),
	P.int('runs', 'Runs', 3, 0, 12, {
		section: 'Gravity',
		showIf: running,
		hint: 'How many runs drip from each splat’s core at full Gravity (the first one’s the longest)'
	}),
	P.float('run_len', 'Run length', 4, 0, 40, {
		softMax: 12,
		step: 0.01,
		section: 'Gravity',
		showIf: running,
		hint: 'How far the runs fall, in core radii'
	}),
	P.float('bead', 'Run beads', 0.6, 0, 1, {
		step: 0.001,
		section: 'Gravity',
		showIf: running,
		hint: 'Grows a drop at the end of each run'
	}),
	P.float('meniscus', 'Meniscus width', 2, 0.25, 64, {
		softMax: 16,
		unit: 'px',
		step: 0.05,
		section: 'Liquid',
		hint: 'How far in from the edge the liquid takes to reach full thickness. Drops smaller than this stay low and domed; bigger pools go flat on top'
	}),
	P.float('rim', 'Dried rim', 0, 0, 1, {
		step: 0.001,
		section: 'Liquid',
		hint: 'Adds a darker, raised ring along the edge, where the liquid dried first'
	}),
	// The few lengths fixed in px (the finest specks, a stream too thin to hold together, the rim's least width) scale
	// with supersampling.
	PX_SCALE_PARAM,
	P.seed()
];
const DEFAULTS = defaultParams(PARAMS);
const num = (q: ParamValues, key: string) => Number(q[key] ?? DEFAULTS[key]);

/** The splats' primitives, by the params they read: a colour, Height or Edge change leaves them as they are. */
const splatPrims = memoReads(
	(q: ParamValues, ctx: LayerCanvas): SplatPrim[] =>
		buildSplats({
			width: ctx.width,
			height: ctx.height,
			tile: ctx.tileable,
			seed: Math.floor(ctx.seed * 7919) + num(q, 'seed'),
			count: num(q, 'count'),
			at: isPlaced(q)
				? parseSplatPoints(String(q.points ?? DEFAULTS.points), q.units === 'fraction', ctx.width, ctx.height)
				: undefined,
			size: num(q, 'size'),
			sizeVar: num(q, 'size_var'),
			splash: num(q, 'splash'),
			ragged: num(q, 'ragged'),
			jets: num(q, 'jets'),
			jetLength: num(q, 'jet_len'),
			drops: num(q, 'drops'),
			reach: num(q, 'reach'),
			mist: num(q, 'mist'),
			aim: num(q, 'aim'),
			oneSided: num(q, 'one_sided'),
			gravity: num(q, 'gravity'),
			gravityAngle: num(q, 'grav_angle'),
			runs: num(q, 'runs'),
			runLength: num(q, 'run_len'),
			bead: num(q, 'bead'),
			pxScale: num(q, 'px_scale')
		}),
	4
);
/** Their texture, by the primitives (the same array while they stand) and the grid. */
const splatTexture = memoOn((prims: SplatPrim[], grid: SplatGrid) => encodeSplats(prims, grid), 4);

function splatData(q: ParamValues, ctx: LayerCanvas) {
	// The distance must be right as far as anything reads it: the thickness's meniscus, the dried rim, the Edge card
	// (Bevel — its wider side with Bevel aspect —, Soft edge, Dilate, Edge roughness on top) and, for whatever reads the
	// mask (Bevel, Etch), at least 8 px. Rounded up to 4 px, so dragging one of them re-encodes only now and then.
	const card = (key: string) => Number(q[key] ?? 0);
	const aspect = q.bevel_aspect_on ? Math.max(Number(q.bevel_aspect ?? 1), 1e-3) : 1;
	const bevel = card('bevel') * Math.sqrt(Math.max(aspect, 1 / aspect));
	const reads = Math.max(bevel, card('soft_edge'), num(q, 'meniscus'), 8 * num(q, 'px_scale'));
	const margin = Math.ceil((reads + card('dilate') + num(q, 'edge') + 1) / 4) * 4;
	return splatTexture(splatPrims(q, ctx), { width: ctx.width, height: ctx.height, tile: ctx.tileable, margin });
}

export const splatsLayer: LayerDef = {
	type: 'splats',
	label: 'Liquid splats',
	category: 'pattern',
	kind: 'generator',
	description:
		'Liquid splats: Splashes thrown with jets and droplets, or poured pools, lying flat or running down a wall. Value is how thick the liquid is. Makes blood, spilt water, oil, paint.',
	params: PARAMS,
	defaults: {
		dif_on: true,
		dif_grad: gradient('#c0160f', '#7d0807'),
		h_on: true,
		h_amount: 1,
		r_on: true,
		r_a: 0.25,
		r_b: 0.06,
		s_on: true,
		s_a: 0.5,
		s_b: 0.6,
		// A liquid is not metal: on a metal floor the splat reflects like the liquid, not the metal.
		mt_on: true,
		mt_src: 'flat',
		mt_b: 0
	},
	fresh: ({ width, height }) => {
		const s = Math.sqrt(width * height) / 128;
		const at = (fx: number, fy: number) => `${Math.round(fx * width)},${Math.round(fy * height)}`;
		return {
			size: halfPx(10 * s, 1),
			meniscus: Math.max(0.5, Math.round(2 * s * 4) / 4),
			points: `${at(0.3, 0.3)} ${at(0.7, 0.6)}`
		};
	},
	// The outline goes to the mask it writes; Splats shapes its own value (the thickness) and coverage. Edge › Bevel
	// shapes the thickness further, Anti-alias its coverage (off: pixel art).
	sdf: 'mask',
	textures: ['splats'],
	cpuData: (q, ctx) => ({ splats: splatData(q, ctx).texture }),
	derivedUniforms: { decl: PRIM_UNIFORMS, compute: (q, ctx) => primUniforms(splatData(q, ctx)) },
	glsl: /* glsl */ `
${GLSL_PRIMTEX}
const float SP_OCT[3] = float[3](0.7, 0.28, 0.12);
// Value noise's lattice at q for cells of about cell px: whole cells across the texture when tiling (period per).
vec2 sp_lattice(vec2 q, float cell, out ivec2 per) {
  vec2 c = snapCells(uRes / cell);
  per = periodOf(c);
  return q / uRes * c;
}

GenOut gen(vec2 p) {
  float pxs = max(u_px_scale, 1.0);
  // User px (y down).
  vec2 q = vec2(p.x, uRes.y - p.y);
  // Tear: three octaves of warp at the splats' own scale (wrapping with the texture) — lobes, bays, and the scallops of
  // a pool's rim. One noise call site for the six draws: x then y of each octave, both at the octave's q.
  if (u_tear > 0.0) {
    float nx = 0.0;
    for (int i = 0; i < 6 * UNI_1; i++) {
      int o = i >> 1;
      float comp = float(i & 1);
      float cell = max(2.0 * pxs, u_size * SP_OCT[o]);
      ivec2 per;
      vec2 x = sp_lattice(q, cell, per);
      float n = valueNoise(x + 17.3 * comp, per, uSeed + 31.0 + 7.0 * float(o) + 3.0 * comp);
      if ((i & 1) == 0) nx = n;
      else q += u_tear * cell * (o == 2 ? 0.6 : 0.4) * (vec2(nx, n) * 2.0 - 1.0);
    }
  }
  // The primitives (splatsGeometry.ts encodeSplats), only those listed for the grid cell q is in: all that can come
  // within the margin of it (the cells wrap with the texture).
  float un = d_unit;
  ivec2 range = cellRange(t_splats, q, d_grid, d_table);
  float d = 1e4;
  float best = 1e4;
  float swell = 1.0;
  float rnd = 0.0;
  for (int e = range.x; e < range.y; e++) {
    ivec2 c = recAt(listItem(t_splats, d_list, e), ${SPLAT_STRIDE});
    vec4 t0 = texelFetch(t_splats, c, 0), t1 = texelFetch(t_splats, c + ivec2(1, 0), 0);
    vec4 t2 = texelFetch(t_splats, c + ivec2(2, 0), 0), t3 = texelFetch(t_splats, c + ivec2(3, 0), 0);
    vec2 v = wrapDelta(q - texPos(t0, un));
    vec2 r = texU16x2(t2) / 64.0 * un;
    int kk = int(texU16(t3.rg));
    int kind = kk >> 14;
    float k = float(kk & 16383) / 32.0 * un;
    float di;
    if (kind == 1) {
      // Tapered capsule: radius r0 at the anchor to r1 at its end.
      vec2 e = texPos(t1, un);
      float h = clamp(dot(v, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
      di = length(v - e * h) - mix(r.x, r.y, h);
    } else {
      // Ellipse r0 × r1 along its axis (a close distance near the outline).
      vec2 ax = texUnitVec(t1);
      di = sdEllipse(vec2(dot(v, ax), dot(v, vec2(-ax.y, ax.x))), max(r, vec2(0.05)));
    }
    if (kind != 2) {
      // The thickness's swell blends as the smooth union does (sdfCombine's weight), so a run or jet thins into the
      // core without a step; the random is the nearest piece's.
      swell = mix(texU8(t3.b) / 100.0, swell, clamp(0.5 + 0.5 * (di - d) / max(k, 1e-4), 0.0, 1.0));
      if (di < best) {
        best = di;
        rnd = t3.a;
      }
    }
    // A splat's pieces flow into one another (smooth union); a bite is cut out of what came before (smooth subtraction).
    d = sdfCombine(kind == 2 ? 6 : 5, d, di, k);
  }
  // Ragged edges: fine value noise on the distance (wrapping with the texture).
  if (u_edge > 0.0) {
    ivec2 per;
    vec2 x = sp_lattice(q, max(1.5 * pxs, 2.0 * u_edge), per);
    d += u_edge * (valueNoise(x, per, uSeed + 17.0) * 2.0 - 1.0);
  }
  float cov = coverage(d, u_aa);
  // Thickness: rising over the meniscus from the edge to a flat top (surface tension), steepest at the edge (the
  // contact angle), × the piece's swell.
  float inside = max(-d, 0.0);
  // Scaled by the coverage, so a speck smaller than a pixel doesn't raise a glint brighter than its colour.
  float m = clamp(inside / max(u_meniscus, 0.25), 0.0, 1.0);
  float value = clamp((1.0 - (1.0 - m) * (1.0 - m)) * swell, 0.0, 1.0) * (!u_aa ? 1.0 : cov);
  // Dried rim: the edge darker and raised, over a px or so.
  if (u_rim > 0.0) value = max(value, u_rim * (1.0 - clamp(inside / max(1.5 * pxs, 0.35 * u_meniscus), 0.0, 1.0)));
  return genOut(value, cov, rnd, d);
}
`
};
