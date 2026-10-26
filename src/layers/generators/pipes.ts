// Pipework (FR8.12): runs of pipe on a wall — straight lengths, filleted elbows, tees, crossings, collars and bolted
// flanges — as true cylinders: the value is the surface height (the light shades them round and they cast shadows).
// The network is built on the CPU (pipesGeometry.ts) from drawn polylines or a random tileable layout and handed over
// as a primitive list; the shader keeps the highest surface over each pixel. Surface height is normalised to 4 × the
// pipe radius (value 1); Coverage writes the pipes' outline to its mask (signed distance) so later layers
// can be limited to them.

import { memoReads } from '@/core/memo';
import { P, gradient } from '@/core/params';
import type { ParamDef, ParamValues } from '@/core/params';
import { GLSL_PRIMTEX, PRIM_UNIFORMS, primUniforms } from '../primTexture';
import type { LayerCanvas, LayerDef } from '../types';
import {
	FLANGE_PROUD,
	PIPE_STRIDE,
	PRIM_ARC,
	PRIM_COLLAR,
	PRIM_FLANGE,
	PRIM_LINE,
	buildPrims,
	drawnRuns,
	encodePrims,
	randomRuns,
	stackHeight,
	type PipeOptions,
	type PipeRun
} from './pipesGeometry';

const isRandom = (p: Record<string, unknown>) => (p.layout ?? 'random') === 'random';
const isDrawn = (p: Record<string, unknown>) => p.layout === 'drawn';
/** Outputs for paint over the pipes, not the metal itself (Metalness starts off for them). */
const NOT_METAL = new Set(['underside', 'tubes', 'liquid']);

/** The runs of a layer (drawn or random) at a texture size. */
export function pipeRuns(q: ParamValues, o: PipeOptions): PipeRun[] {
	const radius = Number(q.radius ?? 6);
	const variety = Number(q.variety ?? 0.3);
	if (q.layout === 'drawn') return drawnRuns(o, String(q.points ?? ''), q.units === 'fraction', radius, variety);
	return randomRuns(o, {
		runs: Math.round(Number(q.runs ?? 3)),
		drops: Math.round(Number(q.drops ?? 2)),
		radius,
		variety,
		jogs: Number(q.jogs ?? 0.5),
		tees: Number(q.tees ?? 0.5),
		density: Number(q.density ?? 0)
	});
}

/** The shape editor's Line tool on drawn runs (ParamDef.shapeEdit): it adds a run. */
export const PIPE_RUNS_EDIT: ParamDef['shapeEdit'] = {
	adds: 'Pipe run',
	hint: 'a new run of the selected pipes',
	budget: 512
};

/** The primitive texture, memoised by the params it reads: a colour or Height slider leaves the layout as it is. */
const pipeTexture = memoReads((q: ParamValues, ctx: LayerCanvas) => {
	const o: PipeOptions = {
		width: ctx.width,
		height: ctx.height,
		tile: ctx.tileable,
		seed: Math.floor(ctx.seed * 7919) + Number(q.seed ?? 0),
		bend: Number(q.bend ?? 2),
		spacing: Number(q.spacing ?? 48),
		flanges: Number(q.flanges ?? 0.3),
		collar: Number(q.collar ?? 0.15),
		elbowFittings: q.elbow_fittings !== false,
		fill: Number(q.fill ?? 0.5)
	};
	const prims = buildPrims(pipeRuns(q, o), o);
	// Height for a value of 1: 4 × the pipe radius, or a taller stack (density, runs lying over runs) whole, scaled to
	// fit rather than having its front pipes clipped flat.
	return encodePrims(prims, Math.max(stackHeight(prims), 4 * Math.max(Number(q.radius ?? 6), 0.5)), ctx);
});

export const pipeworkLayer: LayerDef = {
	type: 'pipework',
	label: 'Pipework',
	category: 'shape',
	kind: 'generator',
	sdf: true,
	description:
		'Pipework: Round pipe runs on a wall with elbows, tees, collars and bolted flanges, drawn by hand or laid out randomly. Makes plumbing, boiler rooms, industrial walls.',
	params: [
		P.enum(
			'output',
			'Output',
			'height',
			[
				['height', 'Surface height'],
				['cover', 'Coverage'],
				['fittings', 'Fittings'],
				['underside', 'Underside'],
				['tubes', 'Tubes only'],
				['facing', 'Facing the light'],
				['liquid', 'Liquid']
			],
			{
				hint: "Picks what the layer puts out. Surface height: the round pipes for relief (1 = 4 × the pipe radius). Coverage: the pipes' outline (writes its mask, so later layers can be limited to the pipes). Fittings: 1 on collars and flanges. Underside: 0 on top of a pipe → 1 underneath (rust, grime). Tubes only: the outline of the tubes without their fittings (writes its mask, e.g. for glass tubes with metal collars). Facing the light: 1 on the side of each pipe towards the top-left → 0 away from it (reflection bands on chrome). Liquid: 1 below each run's liquid surface (Liquid level)"
			}
		),
		P.enum('layout', 'Layout', 'random', [
			['random', 'Random (tileable)'],
			['drawn', 'Drawn runs']
		]),
		P.bitmap('points', 'Runs', '0,24 40,24 40,48 64,48 | 20,0 20,24', 'lines', {
			hint: 'Lists the centre-line points as x,y pairs (px from the top-left, or 0…1 with Units = fraction). Put each run on its own line or separate them with "|". Ends inside the texture get a flange, and an end on another run tees into it',
			showIf: isDrawn,
			uniform: false,
			shapeEdit: PIPE_RUNS_EDIT
		}),
		P.enum(
			'units',
			'Units',
			'px',
			[
				['px', 'Pixels'],
				['fraction', 'Fraction of the texture']
			],
			{ showIf: isDrawn }
		),
		P.int('runs', 'Horizontal runs', 3, 0, 64, {
			softMax: 16,
			showIf: isRandom,
			hint: 'Sets how many horizontal runs there are. They keep clear of each other while there’s room, then start lying over the ones they overlap'
		}),
		P.int('drops', 'Vertical runs', 2, 0, 64, {
			softMax: 16,
			showIf: isRandom,
			hint: 'Sets how many vertical runs there are, in front of the horizontal ones. Once they run out of room they lie over the ones they overlap'
		}),
		P.float('jogs', 'Jogs', 0.5, 0, 1, {
			step: 0.01,
			showIf: isRandom,
			hint: 'Sets the chance that a horizontal run steps up or down and back (two pairs of elbows)'
		}),
		P.float('tees', 'Tees', 0.5, 0, 1, {
			step: 0.01,
			showIf: isRandom,
			hint: 'Sets the chance that a vertical run tees between two horizontal runs instead of passing in front of them'
		}),
		P.float('density', 'Density', 0, 0, 1, {
			step: 0.01,
			showIf: isRandom,
			hint: 'Stacks more pipes in front of these (horizontal, vertical, horizontal …, each layer resting on the one behind) until this share of the bare wall is covered (0 = no extra pipes, 1 = no wall left). A stack taller than four pipe radii is scaled to fit the height range, so raise the height amount for rounder pipes'
		}),
		P.float('radius', 'Pipe radius', 6, 0.5, 256, { softMax: 32, unit: 'px', step: 0.1 }),
		P.float('variety', 'Radius variation', 0.3, 0, 1, { step: 0.01 }),
		P.float('bend', 'Bend radius', 2, 1, 8, {
			step: 0.01,
			hint: 'Sets how wide the elbows bend, measured along the centre line in pipe radii'
		}),
		P.float('spacing', 'Collar spacing', 48, 0, 4096, {
			softMax: 256,
			unit: 'px',
			step: 1,
			hint: 'Spaces collars this far apart along straight lengths (0 = none)'
		}),
		P.float('flanges', 'Flanges', 0.3, 0, 1, {
			step: 0.01,
			hint: 'Sets the chance that a collar is a bolted flange'
		}),
		P.float('collar', 'Collar size', 0.15, 0, 1, {
			step: 0.01,
			hint: `Sets how far collars stick out from the pipe, in pipe radii (flanges stick out ${FLANGE_PROUD} × as far)`
		}),
		P.bool('elbow_fittings', 'Elbow collars', true),
		P.float('fill', 'Liquid level', 0.5, 0, 1, {
			step: 0.01,
			hint: "Fills each run's lowest horizontal pipe this full, for the Liquid output. The surface stays level through bends and drops"
		}),
		P.seed()
	],
	// Metal pipes, bright as a metal reflects in its colour.
	defaults: {
		h_on: true,
		h_amount: 1,
		dif_on: true,
		dif_grad: gradient('#786f65', '#f9e8cf'),
		bevel: 0,
		profile: 'flat',
		// Satin metal.
		r_on: true,
		r_src: 'flat',
		r_b: 0.35,
		mt_src: 'flat'
	},
	linkedDefaults: (p) => ({ mt_on: !NOT_METAL.has(String(p.output)) }),
	textures: ['pipes'],
	cpuData: (q, ctx) => ({ pipes: pipeTexture(q, ctx).texture }),
	derivedUniforms: {
		decl: { ...PRIM_UNIFORMS, count: 'int', hnorm: 'float' },
		compute: (q, ctx) => {
			const t = pipeTexture(q, ctx);
			return { ...primUniforms(t), count: t.count, hnorm: t.heightNorm };
		}
	},
	glsl: /* glsl */ `
${GLSL_PRIMTEX}
vec4 pp_at(ivec2 c, int k) { return texelFetch(t_pipes, c + ivec2(k, 0), 0); }

GenOut gen(vec2 p) {
  vec2 q = vec2(p.x, uRes.y - p.y);
  // Lengths come in units of un px (a power of two: 1 unless the layout is very large).
  float un = d_unit;
  float sd = 1e4;
  float sdFit = 1e4;
  float sdTube = 1e4;
  float best = -1.0;
  float cover = 0.0;
  float fit = 0.0;
  float under = 0.5;
  float liq = 0.0;
  float facing = 0.5;
  // Towards the (top-left) light, y down.
  const vec2 PP_D = vec2(-0.70710678, -0.70710678);
  float pid = 0.0;
  // Coverage and Tubes only write the mask: its distances are needed all round the pipes, not only on them.
  bool wantSd = u_output == 1 || u_output == 4;
  // Bevel aspect (Coverage, Tubes only): the same outlines measured in the space the aspect stretches (px of Bevel),
  // piece by piece — a length's sides by their normal, its ends and elbows by their direction, a fitting by its box's
  // sides — so where a tube meets a fitting face or a fitting's sides meet, the bevel turns without the step the
  // distance's own direction makes. Off at aspect 1: the wrapper's bevel, unchanged.
  bool asp = bevelAspectOn() && wantSd;
  float sdTubeB = 1e4, sdFitB = 1e4;
  // The mask's distance is read far out, so it is measured to every primitive; the surface needs only those within a
  // pixel or so — the list of q's cell.
  ivec2 range = wantSd ? ivec2(0, d_count) : cellRange(t_pipes, q, d_grid, d_table);
  for (int e = range.x; e < range.y; e++) {
    ivec2 c = recAt(wantSd ? e : listItem(t_pipes, d_list, e), ${PIPE_STRIDE});
    vec4 t0 = pp_at(c, 0), t1 = pp_at(c, 1), t3 = pp_at(c, 3);
    vec4 t2 = vec4(0.0);
    int kind = int(texU8(t3.r));
    float r = texU16(t3.ba) / 64.0 * un;
    vec2 a = texPos(t0, un);
    // Cross-section: offset from the axis over the radius (2D) and the axis normal, for Underside and Facing.
    vec2 off = vec2(0.0), an = vec2(0.0, 1.0);
    float d = 1e4;                                // a tube: distance to its axis
    float u = 0.0, v = 0.0, hw = 0.0, ro = 0.0;   // a fitting: its frame, half width and outer radius
    if (kind <= ${PRIM_ARC}) {
      // A tube: the offset dv from its axis, and the bevel's direction nb.
      vec2 dv, nb;
      if (kind == ${PRIM_LINE}) {
        // Straight length: distance to the centre line.
        vec2 e = texPos(t1, un) - a;
        float hs = clamp(dot(q - a, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
        dv = q - (a + e * hs);
        d = length(dv);
        nb = hs > 0.0 && hs < 1.0 ? vec2(-e.y, e.x) : dv;
        an = normalize(vec2(-e.y, e.x));
      } else {
        // Elbow: an arc of the bend radius around its centre, within its sweep (the lengths' round ends close it).
        t2 = pp_at(c, 2);
        float rb = texU16(t1.rg) / 8.0 * un;
        float a0 = texAng(t1.ba, 3.14159265);
        float sw = texAng(t2.rg, 6.28318531);
        vec2 dl = q - a;
        float l = length(dl);
        if (!wantSd && abs(l - rb) > r + 1.0) continue;
        float ph = atan(dl.y, dl.x);
        float rel = sw >= 0.0 ? mod(ph - a0, 6.28318531) : mod(a0 - ph, 6.28318531);
        if (rel <= abs(sw)) d = abs(l - rb);
        nb = dl;
        an = dl / max(l, 1e-3);
        dv = an * (l - rb);
      }
      sd = min(sd, d - r);
      sdTube = min(sdTube, d - r);
      if (asp) sdTubeB = min(sdTubeB, bevelLine(d - r, nb));
      if (d > r + 1.0) continue;
      off = dv / max(r, 1e-3);
    } else {
      // Collar / flange: a short, wider cylinder around the axis. A flange is two plates (a groove between them)
      // with bolt heads standing on the rim.
      t2 = pp_at(c, 2);
      float ax = texAng(t1.rg, 3.14159265);
      hw = texU16(t1.ba) / 64.0 * un;
      ro = texU16(t2.rg) / 64.0 * un;
      vec2 tx = vec2(cos(ax), sin(ax));
      an = vec2(-tx.y, tx.x);
      vec2 dv = q - a;
      u = dot(dv, tx);
      v = dot(dv, an);
      vec2 bx = abs(vec2(u, v)) - vec2(hw, ro);
      float sb = length(max(bx, 0.0)) + min(max(bx.x, bx.y), 0.0);
      sd = min(sd, sb);
      sdFit = min(sdFit, sb);
      // (Its sides' planes: exact inside the box and off its faces, where tubes meet it.)
      if (asp) sdFitB = min(sdFitB, max(bevelLine(bx.x, tx), bevelLine(bx.y, an)));
      if (bx.x > 1.0 || bx.y > 1.0) continue;
      off = an * v / max(ro, 1e-3);
    }
    // Within a pixel of the piece: its coverage and surface.
    vec4 t4 = pp_at(c, 4);
    float depth = texU16(t4.rg) / 16.0 * un;
    float h = -1.0, cv;
    if (kind <= ${PRIM_ARC}) {
      cv = clamp(r - d + 0.5, 0.0, 1.0);
      if (d < r) h = depth + sqrt(r * r - d * d);
    } else {
      cv = clamp(min(hw - abs(u), ro - abs(v)) + 0.5, 0.0, 1.0);
      if (cv <= 0.0) continue;
      if (abs(u) <= hw && abs(v) <= ro) {
        h = depth + sqrt(max(ro * ro - v * v, 0.0)) * (0.88 + 0.12 * clamp(hw - abs(u), 0.0, 1.0));
        if (kind == ${PRIM_FLANGE}) {
          h -= 0.1 * ro * (1.0 - clamp(abs(u) * 1.5, 0.0, 1.0));
          // Bolt heads around the rim, seen edge-on: a row of small bumps — a ridged ring.
          float bs = max(0.7, min(0.15 * ro, 0.8 * hw));
          for (int k = -2; k <= 2; k++) {
            float vb = float(k) * 0.38 * ro;
            float dd = length(vec2(u, v - vb)) / bs;
            if (dd < 1.0) h = max(h, depth + sqrt(max(ro * ro - vb * vb, 0.0)) + 0.4 * bs * sqrt(1.0 - dd * dd));
          }
        }
      }
    }
    cover = max(cover, cv);
    if (h > best) {
      best = h;
      fit = kind >= ${PRIM_COLLAR} ? 1.0 : 0.0;
      under = 0.5 + 0.5 * clamp(off.y, -1.0, 1.0);
      liq = clamp(q.y - texPos(t4, un).y + 0.5, 0.0, 1.0);
      facing = 0.5 + 0.5 * clamp(dot(off, PP_D) / max(abs(dot(an, PP_D)), 0.3), -1.0, 1.0);
      pid = texU16((kind == ${PRIM_LINE} ? pp_at(c, 2) : t2).ba);
    }
  }
  float rnd = hashI(ivec2(int(pid), 3), uSeed);
  if (wantSd) {
    // Coverage; Tubes: the straight lengths and elbows, less the fittings over them.
    GenOut g = genOut(1.0, 1.0, rnd, u_output == 1 ? sd : max(sdTube, -sdFit));
    if (asp) g.bdist = u_output == 1 ? min(sdTubeB, sdFitB) : max(sdTubeB, -sdFitB);
    return g;
  }
  if (cover <= 0.0) return genOut(0.0, 0.0, 0.0, NO_SDF);
  if (u_output == 2) return genOut(fit, cover, rnd, NO_SDF);
  if (u_output == 3) return genOut(under, cover, rnd, NO_SDF);
  if (u_output == 5) return genOut(facing, cover, rnd, NO_SDF);
  if (u_output == 6) return genOut(liq, cover, rnd, NO_SDF);
  return genOut(clamp(max(best, 0.0) / d_hnorm, 0.0, 1.0), cover, rnd, NO_SDF);
}
`
};
