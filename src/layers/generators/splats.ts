// Liquid splats (docs/features/fr8.24-liquid-splats.md): blood, water or oil thrown, poured or running down. The
// splats are built on the CPU (splatsGeometry.ts) as circles, ellipses and tapered capsules; the shader unions them
// into one distance (smoothly within a splat's body, so lobes, jets and runs flow together) and turns the depth inside
// into the liquid's thickness — rising over a meniscus at the edge to a flat top where the pool is deep, as surface
// tension holds a real one: small drops stay domed and low, big pools flat. Value = thickness (0..1) for the ramp and
// Height; the outline goes to the mask it writes.

import { P, defaultParams, gradient, type ParamDef } from '@/core/params';
import type { LayerDef } from '../types';
import { buildSplats, encodeSplats, parseSplatPoints } from './splatsGeometry';

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
		hint: 'Splats in the texture (on a jittered grid, so they spread out)'
	}),
	P.bitmap('points', 'Splats', '20,20 44,40', 'lines', {
		hint: 'A splat on every point (x,y px from the top-left, or 0..1 with Units = fraction) — place them with the shape editor; the lines between points mean nothing',
		showIf: isPlaced,
		uniform: false
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
		hint: 'Radius of a splat’s core'
	}),
	P.float('size_var', 'Size variation', 0.5, 0, 1, { step: 0.001, hint: 'How much the splats differ in size' }),
	P.float('ragged', 'Ragged core', 0.5, 0, 1, {
		step: 0.001,
		hint: 'The core’s outline: 0 a round pool, 1 many lobes straying out, bites out of its rim and clumps breaking off'
	}),
	P.float('tear', 'Tear', 0.5, 0, 1, {
		step: 0.001,
		hint: 'Warps every outline at the splats’ own scale, so cores tear into fingers and bays instead of round lobes'
	}),
	P.float('edge', 'Edge roughness', 0.6, 0, 4, {
		softMax: 2,
		unit: 'px',
		step: 0.01,
		hint: 'Fine irregularity of every edge'
	}),
	P.float('splash', 'Splash', 0.7, 0, 1, {
		step: 0.001,
		section: 'Spray',
		hint: '0 a poured pool, no spray · 1 a hard impact: jets and droplets thrown out of the core'
	}),
	P.int('jets', 'Jets', 8, 0, 48, {
		softMax: 24,
		section: 'Spray',
		showIf: sprayed,
		hint: 'Long jets thrown out of a splat at full Splash, tapering to a point, often with drops strung out beyond their tip — and twice as many short spikes round the rim'
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
		hint: 'Satellite droplets: mostly tiny, a few big (1 ≈ 60 per splat at full Splash)'
	}),
	P.float('reach', 'Droplet reach', 2.5, 0, 12, {
		softMax: 6,
		step: 0.01,
		section: 'Spray',
		showIf: sprayed,
		hint: 'How far the droplets fly, in core radii; the far ones are stretched along their flight'
	}),
	P.float('mist', 'Fine mist', 1, 0, 3, {
		softMax: 3,
		step: 0.01,
		section: 'Spray',
		showIf: sprayed,
		hint: 'A dust of specks a px or two across, flying furthest (1 ≈ 150 per splat at full Splash)'
	}),
	P.float('aim', 'Spray direction', 0, -180, 180, {
		step: 0.1,
		unit: '°',
		section: 'Spray',
		showIf: (p) => sprayed(p) && Number(p.one_sided) > 0,
		hint: 'Where a one-sided spray is thrown: 0 up, 90 right'
	}),
	P.float('one_sided', 'One-sided', 0, 0, 1, {
		step: 0.001,
		section: 'Spray',
		showIf: sprayed,
		hint: '0 sprayed all round · 1 thrown to one side in a narrow fan (an impact at an angle)'
	}),
	P.float('gravity', 'Gravity', 0, 0, 1, {
		step: 0.001,
		section: 'Gravity',
		hint: '0 lying flat (pools) · 1 on a wall: the core sags and runs fall from its lower edge and the bigger drops'
	}),
	P.float('grav_angle', 'Direction', 0, -180, 180, {
		step: 0.1,
		unit: '°',
		section: 'Gravity',
		showIf: running,
		hint: 'Which way the runs fall: 0 straight down, 90 to the left, −90 to the right'
	}),
	P.int('runs', 'Runs', 3, 0, 12, {
		section: 'Gravity',
		showIf: running,
		hint: 'Runs from a splat’s core at full Gravity (the first the longest)'
	}),
	P.float('run_len', 'Run length', 4, 0, 40, {
		softMax: 12,
		step: 0.01,
		section: 'Gravity',
		showIf: running,
		hint: 'How far the runs fall, in core radii'
	}),
	P.float('bead', 'Bead', 0.6, 0, 1, {
		step: 0.001,
		section: 'Gravity',
		showIf: running,
		hint: 'The drop collecting at the end of a run'
	}),
	P.float('meniscus', 'Meniscus', 2, 0.25, 64, {
		softMax: 16,
		unit: 'px',
		step: 0.05,
		section: 'Liquid',
		hint: 'How far in from the edge the liquid rises to its full thickness: drops smaller than this stay domed and low, bigger pools flat on top'
	}),
	P.float('rim', 'Dried rim', 0, 0, 1, {
		step: 0.001,
		section: 'Liquid',
		hint: 'A darker, raised ring along the edge, where the liquid dried first'
	}),
	// Not a control: 1 px of the texture in shader px. Supersampling scales every px param by k, so this scales the few
	// lengths fixed in px (the finest specks, a stream too thin to hold together, the rim's least width) with them.
	P.float('px_scale', 'Pixel scale', 1, 1, 8, {
		unit: 'px',
		outputPx: true,
		step: 1,
		optimize: false,
		showIf: () => false
	}),
	P.seed()
];
const DEFAULTS = defaultParams(PARAMS);

export const splatsLayer: LayerDef = {
	type: 'splats',
	label: 'Liquid splats',
	category: 'pattern',
	kind: 'generator',
	description:
		'Blood, water or oil: splats thrown with jets and droplets, or poured pools, lying flat or running down in runs that end in a bead. Value = how thick the liquid is (pools rise to a flat top over a rounded edge).',
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
		s_b: 0.6
	},
	fresh: ({ width, height }) => {
		const s = Math.sqrt(width * height) / 128;
		const at = (fx: number, fy: number) => `${Math.round(fx * width)},${Math.round(fy * height)}`;
		return {
			size: Math.max(1, Math.round(10 * s * 2) / 2),
			meniscus: Math.max(0.5, Math.round(2 * s * 4) / 4),
			points: `${at(0.3, 0.3)} ${at(0.7, 0.6)}`
		};
	},
	// The outline goes to the mask it writes; Splats shapes its own value (the thickness) and coverage. Edge › Bevel
	// shapes the thickness further, Anti-alias its coverage (off: pixel art).
	sdf: 'mask',
	textures: ['splats'],
	cpuData(q, ctx) {
		const v = (key: string) => Number(q[key] ?? DEFAULTS[key]);
		const prims = buildSplats({
			width: ctx.width,
			height: ctx.height,
			tile: ctx.tileable,
			seed: Math.floor(ctx.seed * 7919) + v('seed'),
			count: v('count'),
			at:
				q.layout === 'drawn'
					? parseSplatPoints(String(q.points ?? DEFAULTS.points), q.units === 'fraction', ctx.width, ctx.height)
					: undefined,
			size: v('size'),
			sizeVar: v('size_var'),
			splash: v('splash'),
			ragged: v('ragged'),
			jets: v('jets'),
			jetLength: v('jet_len'),
			drops: v('drops'),
			reach: v('reach'),
			mist: v('mist'),
			aim: v('aim'),
			oneSided: v('one_sided'),
			gravity: v('gravity'),
			gravityAngle: v('grav_angle'),
			runs: v('runs'),
			runLength: v('run_len'),
			bead: v('bead'),
			pxScale: v('px_scale')
		});
		// The distance must be right as far as anything reads it: the thickness's meniscus, the dried rim, the Edge card
		// (Bevel, Soft edge, Dilate, Edge roughness on top) and, for whatever reads the mask (Bevel, Etch), at least 8 px.
		const card = (key: string) => Number(q[key] ?? 0);
		const reads = Math.max(card('bevel'), card('soft_edge'), v('meniscus'), 8 * v('px_scale'));
		const margin = reads + card('dilate') + v('edge') + 1;
		return {
			splats: encodeSplats(prims, { width: ctx.width, height: ctx.height, tile: ctx.tileable, margin })
		};
	},
	glsl: /* glsl */ `
float sp_u16(vec2 b) { return floor(b.x * 255.0 + 0.5) * 256.0 + floor(b.y * 255.0 + 0.5); }
int sp_u32(vec4 t) { return int(sp_u16(t.rg)) * 65536 + int(sp_u16(t.ba)); }
vec4 sp_fetch(int t, int w) { return texelFetch(t_splats, ivec2(t % w, t / w), 0); }
vec2 sp_pos(vec4 t) { return vec2(sp_u16(t.rg), sp_u16(t.ba)) / 8.0 - 4096.0; }
// Value noise's lattice at q for cells of about cell px: whole cells across the texture when tiling (period per).
vec2 sp_lattice(vec2 q, float cell, out ivec2 per) {
  per = uTile ? ivec2(max(vec2(1.0), floor(uRes / cell + 0.5))) : NO_PERIOD;
  return uTile ? q / uRes * vec2(per) : q / cell;
}

GenOut gen(vec2 p) {
  float pxs = max(u_px_scale, 1.0);
  // User px (y down).
  vec2 q = vec2(p.x, uRes.y - p.y);
  // Tear: three octaves of warp at the splats' own scale (wrapping with the texture) — lobes, bays, and the scallops of
  // a pool's rim.
  if (u_tear > 0.0) {
    for (int o = 0; o < 3 * UNI_1; o++) {
      float cell = max(2.0 * pxs, u_size * (o == 0 ? 0.7 : o == 1 ? 0.28 : 0.12));
      ivec2 per;
      vec2 x = sp_lattice(q, cell, per);
      float s = uSeed + 31.0 + 7.0 * float(o);
      q += u_tear * cell * (o == 2 ? 0.6 : 0.4) * (vec2(valueNoise(x, per, s), valueNoise(x + 17.3, per, s + 3.0)) * 2.0 - 1.0);
    }
  }
  // The primitives (splatsGeometry.ts encodeSplats): 4 texels each from texel 4, on one row; only those listed for the
  // grid cell q is in, which are all that can come within the margin of it (the cells wrap with the texture).
  int w = textureSize(t_splats, 0).x;
  vec4 h0 = texelFetch(t_splats, ivec2(0), 0);
  ivec2 G = ivec2(int(sp_u16(h0.ba)), int(sp_u16(texelFetch(t_splats, ivec2(1, 0), 0).rg)));
  int table = sp_u32(texelFetch(t_splats, ivec2(2, 0), 0));
  int list = sp_u32(texelFetch(t_splats, ivec2(3, 0), 0));
  ivec2 ci = ivec2(floor(q / (uRes / vec2(G))));
  ci = uTile ? imod(ci, G) : clamp(ci, ivec2(0), G - 1);
  int cell = table + ci.x + ci.y * G.x;
  int e0 = sp_u32(sp_fetch(cell, w)), e1 = sp_u32(sp_fetch(cell + 1, w));
  float d = 1e4;
  float best = 1e4;
  float swell = 1.0;
  float rnd = 0.0;
  for (int e = e0; e < e1; e++) {
    vec4 l = sp_fetch(list + e / 2, w);
    int t = 4 + 4 * int(sp_u16((e & 1) == 0 ? l.rg : l.ba));
    ivec2 c = ivec2(t % w, t / w);
    vec4 t0 = texelFetch(t_splats, c, 0), t1 = texelFetch(t_splats, c + ivec2(1, 0), 0);
    vec4 t2 = texelFetch(t_splats, c + ivec2(2, 0), 0), t3 = texelFetch(t_splats, c + ivec2(3, 0), 0);
    vec2 v = wrapDelta(q - sp_pos(t0));
    float r0 = sp_u16(t2.rg) / 64.0, r1 = sp_u16(t2.ba) / 64.0;
    float kk = sp_u16(t3.rg);
    int kind = int(kk / 16384.0);
    float k = (kk - float(kind) * 16384.0) / 32.0;
    float di;
    if (kind == 1) {
      // Tapered capsule: radius r0 at the anchor to r1 at its end.
      vec2 e = sp_pos(t1);
      float h = clamp(dot(v, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
      di = length(v - e * h) - mix(r0, r1, h);
    } else {
      // Ellipse r0 × r1 along its axis (a close distance near the outline).
      vec2 ax = vec2(sp_u16(t1.rg), sp_u16(t1.ba)) / 32767.5 - 1.0;
      di = sdEllipse(vec2(dot(v, ax), dot(v, vec2(-ax.y, ax.x))), max(vec2(r0, r1), vec2(0.05)));
    }
    if (kind != 2 && di < best) {
      best = di;
      swell = t3.b * 2.55;
      rnd = t3.a;
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
