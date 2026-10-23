// Liquid splats (docs/features/fr8.24-liquid-splats.md): blood, water or oil thrown, poured or running down. The
// splats are built on the CPU (splatsGeometry.ts) as circles, ellipses and tapered capsules; the shader unions them
// into one distance (smoothly within a splat's body, so lobes, jets and runs flow together) and turns the depth inside
// into the liquid's thickness — rising over a meniscus at the edge to a flat top where the pool is deep, as surface
// tension holds a real one: small drops stay domed and low, big pools flat. Value = thickness (0..1) for the ramp and
// Height; the outline goes to the mask it writes.

import { P, gradient } from '@/core/params';
import type { LayerDef } from '../types';
import { buildSplats, encodeSplats } from './splatsGeometry';

const sprayed = (p: Record<string, unknown>) => Number(p.splash) > 0;
const running = (p: Record<string, unknown>) => Number(p.gravity) > 0;

export const splatsLayer: LayerDef = {
	type: 'splats',
	label: 'Liquid splats',
	category: 'pattern',
	kind: 'generator',
	description:
		'Blood, water or oil: splats thrown with jets and droplets, or poured pools, lying flat or running down in runs that end in a bead. Value = how thick the liquid is (pools rise to a flat top over a rounded edge).',
	params: [
		P.int('count', 'Splats', 3, 0, 200, {
			softMax: 24,
			hint: 'Splats in the texture (on a jittered grid, so they spread out)'
		}),
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
		P.seed()
	],
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
		return { size: Math.max(1, Math.round(10 * s * 2) / 2), meniscus: Math.max(0.5, Math.round(2 * s * 4) / 4) };
	},
	// The outline goes to the mask it writes; Splats shapes its own value (the thickness) and coverage. Edge › Bevel
	// shapes the thickness further, Anti-alias its coverage (off: pixel art).
	sdf: 'mask',
	// Hard edges became the Edge card's Anti-alias.
	migrate: (p) => {
		if (p.hard === undefined) return p;
		const { hard, ...rest } = p;
		return { aa: hard !== true, ...rest };
	},
	textures: ['splats'],
	cpuData(q, ctx) {
		const prims = buildSplats({
			width: ctx.width,
			height: ctx.height,
			tile: ctx.tileable,
			seed: Math.floor(ctx.seed * 7919) + Number(q.seed ?? 0),
			count: Number(q.count ?? 3),
			size: Number(q.size ?? 10),
			sizeVar: Number(q.size_var ?? 0.5),
			splash: Number(q.splash ?? 0.7),
			ragged: Number(q.ragged ?? 0.5),
			jets: Number(q.jets ?? 8),
			jetLength: Number(q.jet_len ?? 2.2),
			drops: Number(q.drops ?? 1),
			reach: Number(q.reach ?? 2.5),
			mist: Number(q.mist ?? 1),
			aim: Number(q.aim ?? 0),
			oneSided: Number(q.one_sided ?? 0),
			gravity: Number(q.gravity ?? 0),
			gravityAngle: Number(q.grav_angle ?? 0),
			runs: Number(q.runs ?? 3),
			runLength: Number(q.run_len ?? 4),
			bead: Number(q.bead ?? 0.6)
		});
		return { splats: encodeSplats(prims) };
	},
	glsl: /* glsl */ `
float sp_u16(vec2 b) { return floor(b.x * 255.0 + 0.5) * 256.0 + floor(b.y * 255.0 + 0.5); }
vec2 sp_pos(vec4 t) { return vec2(sp_u16(t.rg), sp_u16(t.ba)) / 8.0 - 4096.0; }
vec4 sp_fetch(int t, int w) { return texelFetch(t_splats, ivec2(t % w, t / w), 0); }

GenOut gen(vec2 p) {
  // User px (y down).
  vec2 q = vec2(p.x, uRes.y - p.y);
  // Tear: two octaves of warp at the splats' own scale (wrapping with the texture).
  if (u_tear > 0.0) {
    // Three octaves: lobes, bays, and the scallops of a pool's rim.
    for (int o = 0; o < 3; o++) {
      float cell = max(2.0, u_size * (o == 0 ? 0.7 : o == 1 ? 0.28 : 0.12));
      ivec2 per = uTile ? ivec2(max(vec2(1.0), floor(uRes / cell + 0.5))) : ivec2(4096);
      vec2 x = uTile ? q / uRes * vec2(per) : q / cell;
      float s = uSeed + 31.0 + 7.0 * float(o);
      q += u_tear * cell * (o == 0 ? 0.4 : o == 1 ? 0.4 : 0.6) * (vec2(valueNoise(x, per, s), valueNoise(x + 17.3, per, s + 3.0)) * 2.0 - 1.0);
    }
  }
  int w = textureSize(t_splats, 0).x;
  int n = int(sp_u16(sp_fetch(0, w).rg));
  float d = 1e4;
  float best = 1e4;
  float swell = 1.0;
  float rnd = 0.0;
  for (int i = 0; i < 4000; i++) {
    if (i >= n) break;
    int t = 1 + 4 * i;
    vec4 t0 = sp_fetch(t, w), t1 = sp_fetch(t + 1, w), t2 = sp_fetch(t + 2, w), t3 = sp_fetch(t + 3, w);
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
      float a = (sp_u16(t1.rg) / 65535.0 * 2.0 - 1.0) * 3.14159265;
      vec2 ax = vec2(cos(a), sin(a));
      vec2 l = vec2(dot(v, ax), dot(v, vec2(-ax.y, ax.x)));
      vec2 rr = vec2(max(r0, 0.05), max(r1, 0.05));
      float k0 = length(l / rr), k1 = length(l / (rr * rr));
      di = k1 > 1e-6 ? k0 * (k0 - 1.0) / k1 : -min(rr.x, rr.y);
    }
    float hk = max(k - abs(d + di), 0.0) / max(k, 1e-4);
    if (kind == 2) {
      // A bite out of what came before: smooth subtraction.
      d = max(d, -di) + hk * hk * k * 0.25;
    } else {
      if (di < best) {
        best = di;
        swell = t3.b * 2.55;
        rnd = t3.a;
      }
      // Smooth union: a splat's pieces flow into one another.
      hk = max(k - abs(d - di), 0.0) / max(k, 1e-4);
      d = min(d, di) - hk * hk * k * 0.25;
    }
  }
  // Ragged edges: fine value noise on the distance (wrapping with the texture).
  if (u_edge > 0.0) {
    float cell = max(1.5, 2.0 * u_edge);
    ivec2 per = uTile ? ivec2(max(vec2(1.0), floor(uRes / cell + 0.5))) : ivec2(4096);
    vec2 x = uTile ? q / uRes * vec2(per) : q / cell;
    d += u_edge * (valueNoise(x, per, uSeed + 17.0) * 2.0 - 1.0);
  }
  float cov = !u_aa ? (d <= 0.0 ? 1.0 : 0.0) : clamp(0.5 - d, 0.0, 1.0);
  // Thickness: rising over the meniscus from the edge to a flat top (surface tension), steepest at the edge (the
  // contact angle), × the piece's swell.
  float inside = max(-d, 0.0);
  // Scaled by the coverage, so a speck smaller than a pixel doesn't raise a glint brighter than its colour.
  float m = clamp(inside / max(u_meniscus, 0.25), 0.0, 1.0);
  float value = clamp((1.0 - (1.0 - m) * (1.0 - m)) * swell, 0.0, 1.0) * (!u_aa ? 1.0 : cov);
  // Dried rim: the edge darker and raised, over a px or so.
  if (u_rim > 0.0) value = max(value, u_rim * (1.0 - clamp(inside / max(1.5, 0.35 * u_meniscus), 0.0, 1.0)));
  return genOut(value, cov, rnd, d);
}
`
};
