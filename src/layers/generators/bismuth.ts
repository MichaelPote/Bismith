// Bismuth: hopper crystals as grown in a crucible and seen from above — faces sunk in stair-stepped terraces that spiral,
// hook and dead-end as real hoppers do, crystals shingled over one another with daughters on their corners (or cubes
// standing on a corner, three faces each sunk in its own stair steps), all coloured by the thin film of oxide on them.
//
// Crystals sit one per cell of a grid (Crystals across), scattered, sized, turned and leaning a little each, a few
// generations deep: each generation has cells half the size of the last, is sparser (Small crystals) and lower (Small
// crystal height). A large crystal may grow daughters out of its corners (Daughters: one on the tip corner — the one the
// Stack direction points to — or a mirrored pair on the two beside it, Daughter pairs; Daughter size; Daughter levels:
// each on the same corner of the last), in front and a step taller; Core size stands smaller crystals up out of the
// middle.
//
// Two passes. The first, one flat loop over the generations × the cells round the pixel × each crystal's chain (the
// crystal, its cores, its daughters — the pixel follows the daughter on the corner nearest it), computes only the
// outline, coverage and depth key of each, keeping the front two: larger generations in front, then along the Stack
// direction (Stacking: crystals shingle one way, so most show two or three sides as chevrons) or else by height, a
// core or daughter in front of its crystal. The second draws the facets of those two only, the front over the one
// behind by its coverage.
//
// A crystal is a square (Habit › Hopper squares) or a cube standing on its corner (Habit › Cube corners: a hexagon
// whose three rhombic faces slope away from the corner, as an isometric cube looks), and a stepped pyramid: its top
// face (Top face width of its width) is the hopper, its sides fall to the base in Side ledges. Each top face is one of the templates
// grown on the CPU by rules (bismuthGrowth.ts: a path through a grid of cells, a terrace wide, whose straight runs — the
// facets — each step a level lower; walls where the path doesn't join), picked by the face's hash and read in its
// frame: the cell's height stepping to joined neighbours over the softness, thin ribs on the walls and posts where walls
// meet, and the bars (the rim and its keys) standing at the rim's height with risers on both sides.
//
// The value is the oxide's thickness — by crystal, facet, face, sub-crystal, a sweep across the crystal and mottling —
// walked along the ramp from its second stop and back (the first stop is the bare ground), so any ramp stays seamless;
// Depth shading shades each facet by its depth (gGenShade) without moving the hue, and
// where two crystals meet in a pixel their colours mix (gGenAlt). Height (hval) is the crystal's own height. The
// crystals' union goes to the mask it writes (Mask › Write to), with each crystal's random.

import { P, round1, type ParamValues } from '@/core/params';
import type { LayerDef } from '../types';
import { FACE_TEMPLATES, faceTexture } from './bismuthGrowth';

const isCube = (p: Record<string, unknown>) => p.habit === 'cube';
const hasDaughters = (p: Record<string, unknown>) => Number(p.daughters) > 0;
const num = (p: ParamValues, key: string) => Number(p[key] ?? bismuthLayer.params.find((d) => d.key === key)!.default);

export const bismuthLayer: LayerDef = {
	type: 'bismuth',
	label: 'Bismuth',
	category: 'pattern',
	kind: 'generator',
	description:
		'Bismuth hopper crystals: Made from ribbed terraces stepping down to an off-centre hollow, with crystals overlapping like shingles and smaller ones growing from their corners, in iridescent oxide colours. Makes bismuth, stepped metal crystals, isometric cube clusters.',
	params: [
		P.enum(
			'habit',
			'Habit',
			'square',
			[
				['square', 'Hopper squares', 'square frames seen from above, stepping down to a hollow'],
				[
					'cube',
					'Cube corners',
					'cubes standing on a corner, like an isometric drawing: a hexagon of three rhombic faces sloping away from the corner, ringed by hexagonal terraces'
				]
			],
			{ hint: 'Picks the shape the crystals grow in' }
		),
		P.float('scale', 'Crystals across', 6, 0.5, 32, {
			softMax: 12,
			step: 0.01,
			section: 'Crystals',
			hint: 'How many large crystals fit across the width (whole counts when tiling); 1 with Jitter 0 puts one in the middle'
		}),
		P.float('size', 'Crystal size', 1.15, 0.1, 2, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Sets each crystal’s width as a share of its cell (below 1 leaves room between them, above 1 makes them grow into one another)'
		}),
		P.float('size_var', 'Size variation', 0.35, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Gives each crystal a random size (0 = all the same, 1 = from half to twice the Crystal size)'
		}),
		P.float('scatter', 'Jitter', 0.75, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Moves each crystal off-centre in its cell, by up to this share of the cell (0 = a strict grid)'
		}),
		P.float('angle', 'Rotation', 0, -180, 180, {
			unit: '°',
			step: 0.1,
			section: 'Crystals',
			hint: 'Turns every crystal, clockwise'
		}),
		P.float('angle_var', 'Rotation variation', 0.08, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Turns each crystal by a random angle (0 = all lined up, 1 = any way at all). Bismuth grown in one melt mostly lines up'
		}),
		P.float('stack', 'Stacking', 0.7, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'How much the crystals overlap one way like shingles, each in front of the neighbours behind it along the Stack direction, so most show two or three sides as chevrons (0 = the taller crystal goes in front)'
		}),
		P.float('stack_angle', 'Stack direction', 90, -180, 180, {
			unit: '°',
			step: 0.1,
			section: 'Crystals',
			hint: 'Picks the corner the crystals overlap towards and where the tip daughter grows, measured anticlockwise from the crystal’s right side (snapped to a corner: a square’s nearest diagonal, a cube’s nearest point). It’s also the crystal’s mirror axis'
		}),
		P.float('rise_var', 'Height variation', 0.4, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Gives each crystal a random height (0 = equal heights, 1 = from nothing to full)'
		}),
		P.float('lean', 'Lean', 0.4, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Tilts each crystal a random way (1 = a quarter of its height across it), so its terraces catch the light differently from its neighbours’'
		}),
		P.float('daughters', 'Daughters', 0.8, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'How many of the large crystals grow daughter crystals out of their corners, in front and a step taller: one on the tip corner, or a mirrored pair (Daughter pairs). 0 = none'
		}),
		P.float('pairs', 'Daughter pairs', 0.5, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			showIf: hasDaughters,
			hint: 'How many of those grow a mirrored pair on the two corners beside the tip, instead of one on the tip'
		}),
		P.float('daughter', 'Daughter size', 0.55, 0.1, 0.9, {
			step: 0.001,
			section: 'Crystals',
			showIf: hasDaughters,
			hint: 'Sets a daughter’s size as a share of the crystal it grew from'
		}),
		P.int('daughter_depth', 'Daughter levels', 2, 1, 3, {
			section: 'Crystals',
			showIf: hasDaughters,
			hint: 'How many levels of daughters to grow, each on the same corner as the last, so more makes a spike of crystals along the diagonal'
		}),
		P.float('core', 'Core size', 0, 0, 0.8, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Stands a smaller crystal up out of the middle of each one, at this share of its size (in front of a cube’s corner). 0 = none'
		}),
		P.int('cores', 'Core levels', 1, 1, 3, {
			section: 'Crystals',
			showIf: (p) => Number(p.core) > 0,
			hint: 'Stacks cores within cores, each inside the last at Core size times its size'
		}),
		P.int('gens', 'Generations', 3, 1, 4, {
			section: 'Crystals',
			hint: 'How many sizes of crystal to grow: each generation is half the size of the last and fills the gaps between the bigger ones'
		}),
		P.float('fill', 'Small crystals', 0.85, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			showIf: (p) => Number(p.gens) > 1,
			hint: 'How many of the cells in the smaller generations grow a crystal'
		}),
		P.float('gen_h', 'Small crystal height', 0.6, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			showIf: (p) => Number(p.gens) > 1,
			hint: 'Height of each smaller generation relative to the one before'
		}),
		P.bool('ground', 'Ground', true, {
			section: 'Crystals',
			hint: 'Covers the ground between the crystals in bare metal (at height 0); when off, only the crystals cover and the layers below show between them'
		}),
		P.float('top', 'Top face width', 0.85, 0.05, 1, {
			step: 0.001,
			section: 'Terraces',
			hint: 'How much of a crystal’s width is its top face (the hopper with its sunken terraces); the rest steps down to the base as ledged side faces, like a stepped pyramid. 1 = a flat-topped block (the sides show best with deep relief: raise Height › Amount or the project’s height depth)'
		}),
		P.int('ledges', 'Side ledges', 3, 1, 24, {
			section: 'Terraces',
			showIf: (p) => Number(p.top) < 1,
			hint: 'How many ledges the side faces step down in, from the top face to the base'
		}),
		P.int('terraces', 'Terraces', 6, 2, 24, {
			section: 'Terraces',
			hint: 'How many terraces step down from the top face’s rim to its hollow, whatever its size'
		}),
		P.float('depth', 'Hopper depth', 0.85, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			hint: 'How far the terraces step down to the hollow, as a share of the crystal’s height (0 = flat-topped crystals)'
		}),
		P.float('rim', 'Rim width', 1, 0, 1.5, {
			step: 0.5,
			section: 'Terraces',
			// Read by the growth on the CPU only.
			uniform: false,
			hint: 'Sets the width, in terraces, of the bright bar round each top face at its full height: the thick frame round the hollow (and a cube’s edges). 0 = none'
		}),
		P.float('keys', 'Keys', 0.85, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			hint: 'How many faces get a key in the hollow: a domed square spiral of bars winding 1.5–2 turns out from the centre, each lap a tier higher, like G and 9 shapes'
		}),
		P.float('key_size', 'Key size', 0.55, 0.1, 0.9, {
			step: 0.001,
			section: 'Terraces',
			showIf: (p) => Number(p.keys) > 0,
			hint: 'How far a key winds out from the hollow, as a share of the face’s half-width (varied randomly per face from 0.6× to 1.3× this)'
		}),
		P.float('key_w', 'Key width', 0.9, 0.3, 1.5, {
			step: 0.001,
			section: 'Terraces',
			showIf: (p) => Number(p.keys) > 0,
			hint: 'Sets the width of a key’s bars as a share of a terrace’s width; its arms are one bar apart'
		}),
		P.float('tilt', 'Tread tilt', 1, 0, 2, {
			step: 0.001,
			section: 'Terraces',
			hint: 'Slopes each tread down towards the hollow and tilts each facet a little at random, so a hopper’s walls catch the light differently; the rim bars get domed. 0 = level treads'
		}),
		P.float('grade', 'Terrace grading', 0.6, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			hint: 'Makes the terraces narrow near the rim and wider towards the hollow, as if the growth slowed (0 = all one width)'
		}),
		P.float('turns', 'Terrace turns', 0.08, 0, 1, {
			softMax: 0.15,
			step: 0.001,
			section: 'Terraces',
			// Read by the growth on the CPU only.
			uniform: false,
			hint: 'How often a terrace in the innermost rings turns off its ring (mostly inward, a third as often outward) instead of running on round it, making hooks and dead ends round the hollow; the outer frames stay closed. 0 = a plain spiral staircase, above about 0.15 a maze'
		}),
		P.float('branch', 'Terrace branching', 0.02, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			// Read by the growth on the CPU only.
			uniform: false,
			hint: 'How often the growth branches off an earlier terrace instead of carrying on from the newest one; more gives lots of shorter facets'
		}),
		P.float('hollow', 'Hollow offset', 0.3, 0, 0.6, {
			step: 0.001,
			section: 'Terraces',
			// Read by the growth on the CPU only.
			uniform: false,
			hint: 'Moves the rings’ centre off-centre along a diagonal (as a share of the half-width), so the terraces run wide on one side and close on the other'
		}),
		P.float('groove', 'Riser width', 0.45, 0.02, 0.9, {
			step: 0.001,
			section: 'Terraces',
			hint: 'How much of each terrace the sloped riser down from the upper tread takes up (at least 3 px). The risers stay lit and keep their colour'
		}),
		P.float('soft', 'Step softness', 1, 0.05, 16, {
			softMax: 4,
			unit: 'px',
			step: 0.05,
			section: 'Terraces',
			hint: 'Sets the width of each step’s rise and of the crystals’ outer walls (about 1 px is crisp but anti-aliased)'
		}),
		P.float('slope', 'Face slope', 0.3, 0, 1, {
			step: 0.001,
			section: 'Terraces',
			showIf: isCube,
			hint: 'How far each face of a cube falls away from its corner (0 = a flat hexagon, 1 = the full drop of a cube seen on its corner)'
		}),
		P.float('round', 'Corner rounding', 0.15, 0, 0.5, {
			step: 0.001,
			section: 'Outline',
			hint: 'Rounds each crystal’s corners, as a share of its half-width'
		}),
		P.float('edge', 'Edge bevel', 5, 0, 32, {
			softMax: 12,
			unit: 'px',
			step: 0.05,
			section: 'Outline',
			hint: 'Adds a rounded chamfer this wide along each crystal’s outer edge, down the whole wall, for worn edges that catch the light'
		}),
		P.float('notches', 'Notches', 0.5, 0, 1, {
			step: 0.001,
			section: 'Outline',
			hint: 'Notches the edge in a step at this share of the places along each side, giving the keyed outline of a hopper crystal’s rim'
		}),
		P.float('notch', 'Notch size', 0.12, 0.02, 0.4, {
			step: 0.001,
			section: 'Outline',
			showIf: (p) => Number(p.notches) > 0,
			hint: 'Sets how deep a notch goes as a share of the crystal’s half-width (each one a random size): a broad shallow cut through the outline, and a narrower part dropping to the tier below'
		}),
		P.float('edge_noise', 'Edge noise', 0, 0, 8, {
			softMax: 4,
			unit: 'px',
			step: 0.05,
			section: 'Outline',
			hint: 'Makes each side step in and out along its length in square jogs a terrace long, so no crystal is a perfect polygon'
		}),
		P.float('grain', 'Surface grain', 0, 0, 1, {
			step: 0.001,
			section: 'Outline',
			hint: 'Adds fine unevenness to the height of every surface (1 = about a pixel at the default height)'
		}),
		P.float('col_ofs', 'Colour offset', 0, 0, 2, {
			step: 0.001,
			section: 'Colour',
			hint: 'Moves every crystal along the gradient ramp (and back: 1 = its far end, 2 = round to the start). The crystals use the ramp from its second stop on; the first is the bare ground'
		}),
		P.float('col_var', 'Colour per crystal', 1, 0, 2, {
			step: 0.001,
			section: 'Colour',
			hint: 'Starts each crystal at a random place on the gradient ramp (1 = anywhere along it, going either way, so every colour is as likely whatever the other shifts add), so you get a gold crystal beside a blue one'
		}),
		P.float('contrast', 'Depth shading', 0.8, 0, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'Keeps the bars bright and darkens each facet the deeper it lies (in solid steps of shade down to a dark crater floor, as the height map shows it), and the sides too. 0 = flat colour'
		}),
		P.float('col_step', 'Colour per terrace', 0.18, -1, 1, {
			softMin: -0.25,
			softMax: 0.25,
			step: 0.001,
			section: 'Colour',
			hint: 'How far along the gradient ramp each lap of the terraces moves from the next (1 = the whole ramp), as the oxide is thicker on the older, outer steps; below 0 the hollows are further along'
		}),
		P.float('band', 'Colour per facet', 0.3, 0, 1, {
			softMax: 0.5,
			step: 0.001,
			section: 'Colour',
			hint: 'Shifts each facet along the gradient ramp by a random amount (1 = up to half the ramp either way); with Depth shading each one’s also a bit lighter or darker than the next. Keep it low for crystals of one colour family'
		}),
		P.float('sweep', 'Colour sweep', 0.12, 0, 4, {
			softMax: 2,
			step: 0.001,
			section: 'Colour',
			hint: 'How far along the gradient ramp the colour runs across a large crystal (smaller ones in proportion), as if the oxide thickens from one side'
		}),
		P.float('sweep_angle', 'Sweep direction', 0, -180, 180, {
			unit: '°',
			step: 0.1,
			section: 'Colour',
			showIf: (p) => Number(p.sweep) > 0,
			hint: 'Sets the direction the colour sweep runs, clockwise from left to right'
		}),
		P.float('face_col', 'Colour per face', 0.25, 0, 1, {
			step: 0.001,
			section: 'Colour',
			showIf: isCube,
			hint: 'How far along the gradient ramp each of a cube’s three faces moves from the next, going round from the right face to the top and the left'
		}),
		P.float('sub_col', 'Sub-crystal colour', 0.3, -1, 1, {
			step: 0.001,
			section: 'Colour',
			showIf: (p) => Number(p.core) > 0 || Number(p.daughters) > 0,
			hint: 'How far along the gradient ramp each core and daughter moves from the crystal it grew from'
		}),
		P.float('mottle', 'Mottling', 0.12, 0, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'Makes the colour drift across the crystals in soft patches, as if the oxide grew unevenly'
		}),
		P.seed()
	],
	// The crystals' union goes to a mask (opt-in); the generator shapes its own value.
	sdf: 'mask',
	parts:
		'Roughness: bars (the rim and the keys) at the left of the range, terraces and sides at the right, the ground roughest. Metalness: the crystals metal, the ground not',
	// Anti-alias only matters where the crystals alone cover; the crystals bevel themselves (Outline › Edge bevel), so
	// the Edge card's bevel — which would scale the colour's ramp position — is hidden.
	sdfShowIf: (p, key) =>
		key !== 'bevel' &&
		key !== 'profile' &&
		key !== 'bevel_aspect' &&
		key !== 'bevel_aspect_on' &&
		(key !== 'aa' || p.ground === false),
	defaults: {
		mk_target: '',
		h_on: true,
		h_amount: 16,
		dif_on: true,
		// Dark bare metal (the ground: the crystals use the rest), then the thin-film oxide colours in the order they grow
		// on bismuth, vivid: a long stretch of gold, then magenta, a short violet and blue, teal-mint and the second-order
		// yellow. Depth shading greys the deep treads, so the hollows stay quiet under bright rims.
		dif_grad: {
			stops: [
				{ pos: 0, color: '#3a3542' },
				{ pos: 0.143, color: '#f0c050' },
				{ pos: 0.38, color: '#f2a858' },
				{ pos: 0.52, color: '#e070b8' },
				{ pos: 0.66, color: '#b878e0' },
				{ pos: 0.76, color: '#70a0ec' },
				{ pos: 0.88, color: '#50d0b8' },
				{ pos: 1, color: '#e0d470' }
			]
		},
		// Glossy bars, satin terraces (Source › Parts).
		r_on: true,
		r_src: 'parts',
		r_a: 0.22,
		r_b: 0.25,
		mt_on: true,
		mt_src: 'parts'
	},
	// Added in the editor: fewer terraces on small textures (each at least about 4 px wide on a large crystal), fewer
	// generations and larger crystals on small textures (where the smallest crystals would be a pixel or two), crystals
	// about 24 px tall at 512 px — deep, so the top face and the stepped sides read apart — lower on small textures, and
	// gentler mottling there (a crystal of few terraces would carry its patches as smears).
	fresh: ({ width, height }) => {
		const side = Math.sqrt(width * height);
		return {
			terraces: Math.round(Math.min(6, Math.max(2, side / 85))),
			gens: side >= 384 ? 3 : side >= 128 ? 2 : 1,
			scale: side >= 384 ? 6 : side >= 192 ? 4 : 3,
			// Small textures: no keys (they would be blobs).
			...(side < 128 ? { keys: 0 } : {}),
			h_amount: round1(16 * Math.sqrt(Math.min(1, side / 512))),
			// Small textures: larger crystals, so no ground shows between the few there are.
			...(side < 192 ? { size: 1.25 } : {}),
			mottle: side >= 256 ? 0.12 : 0.06
		};
	},
	// A cube's three faces are its top and sides: no pyramid round it, a deeper hopper.
	linkedDefaults: (p) => (p.habit === 'cube' ? { top: 1, depth: 0.7 } : { top: 0.85, depth: 0.65 }),
	textures: ['facets'],
	// The faces' facets, grown by the rules (bismuthGrowth.ts), FACE_TEMPLATES of them side by side.
	cpuData: (p, ctx) => ({
		facets: faceTexture(
			2 * num(p, 'terraces'),
			num(p, 'turns'),
			num(p, 'branch'),
			num(p, 'hollow'),
			num(p, 'rim'),
			ctx.seed
		)
	}),
	glsl: /* glsl */ `
// Pointy-topped hexagon of circumradius r (IQ's hexagon, x and y swapped so it stands on a point).
float bsHex(vec2 p, float r) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.5773503);
  p = abs(p.yx);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  float ap = 0.8660254 * r;
  p -= vec2(clamp(p.x, -k.z * ap, k.z * ap), ap);
  return length(p) * sign(p.y);
}

// A crystal's outline at q, radius R: x the distance (px, < 0 inside) to a square or a pointy-topped hexagon with its
// corners rounded (Corner rounding), its sides stepped in and out along their length (Edge noise: 1D value noise along
// the nearest side, held flat over a terrace's length and stepping between, so the edge jogs square instead of
// wobbling), notched (Notches: cells along the side, none at the ends, each notched by its hash at its own place and
// depth — a broad shallow cut through the outline), less the dilation dl that closes hairline gaps; y the distance to
// each notch's narrower, deeper part (< 0 inside), which only drops the surface to the tier below.
vec2 bsOutline(vec2 q, float R, bool cube, int ns, ivec2 key, float sg, float tpx, float dl) {
  float ap = cube ? 0.8660254 * R : R;
  float rr = clamp(u_round, 0.0, 0.5) * ap;
  float ds = cube ? bsHex(q, R - rr / 0.8660254) - rr : sdBox(q, vec2(R - rr)) - rr;
  float sa = TAU / float(ns);
  float j = mod(floor(atan(q.y, q.x) / sa + 0.5), float(ns));
  vec2 n = vec2(cos(j * sa), sin(j * sa));
  float along = dot(q, vec2(-n.y, n.x));
  float inw = ap - dot(q, n);
  int row = key.x * 16 + int(j);
  float deep = 1e4;
  if (u_edge_noise > 0.0) {
    float sx = along / max(tpx, 1.0), s0 = floor(sx), fs = sx - s0;
    float a0 = hashI(ivec2(row, key.y * 512 + int(s0)), sg + 67.0);
    float a1 = hashI(ivec2(row, key.y * 512 + int(s0) + 1), sg + 67.0);
    float st = smoothstep(1.0 - 1.0 / max(tpx, 1.0), 1.0, fs);
    ds += u_edge_noise * (floor(mix(a0, a1, st) * 3.0 + 0.5) / 3.0 - 0.5) * 2.0;
  }
  float dn = clamp(u_notch, 0.02, 0.4) * ap;
  if (u_notches > 0.0 && dn >= 3.0) {
    float halfL = cube ? 0.5 * R : R;
    float cl = 2.2 * dn;
    float ci = floor((along + halfL) / cl);
    vec3 hn = hash3I(ivec2(row, key.y * 64 + int(ci)), sg + 61.0);
    float dd = dn * (0.6 + 0.8 * hn.z);
    float cpos = -halfL + (ci + 0.5) * cl + (hn.y - 0.5) * 0.4 * cl;
    bool on = hn.x < u_notches && abs(cpos) + 0.8 * dd < halfL - 0.6 * dn;
    float side = fract(hn.y * 13.1) < 0.5 ? -1.0 : 1.0;
    float u = along - cpos;
    if (on) {
      ds = max(ds, -sdBox(vec2(u, inw), vec2(0.8 * dd, 0.5 * dd)));
      deep = sdBox(vec2(u - side * 0.4 * dd, inw), vec2(0.4 * dd, 1.4 * dd));
    }
  }
  return vec2(ds - dl, deep);
}

// x to a whole power n ≥ 0 (GLSL's pow is undefined for 0⁰).
float bsPow(float x, int n) { return n == 0 ? 1.0 : pow(x, float(n)); }

// The oxide's thickness along the ramp and back.
float bsRamp(float t) { return 1.0 - abs(1.0 - 2.0 * fract(0.5 * t)); }

GenOut gen(vec2 p) {
  bool cube = u_habit == 1;
  int ns = cube ? 6 : 4;
  float nsf = float(ns);
  vec2 cells0 = cellsFor(u_scale, 1.0);
  float soft = max(u_soft, 0.05);
  int G = clamp(u_gens, 1, 4);
  int nC = u_core > 0.0 ? clamp(u_cores, 1, 3) : 0;
  int nD = u_daughters > 0.0 ? clamp(u_daughter_depth, 1, 3) : 0;
  float rho = clamp(u_daughter, 0.1, 0.9);

  // The crystal's frame: its tip (a square's corner on the Stack direction, a cube's point), the pair of corners beside
  // it, its mirror axis and the side index that mirrors side j (mIdx − j, the sides' normals j·360°/ns apart).
  float sa = radians(u_stack_angle);
  float tipA = cube ? radians(30.0 + 60.0 * floor((u_stack_angle - 30.0) / 60.0 + 0.5)) : 0.0;
  vec2 tip = cube ? vec2(cos(tipA), sin(tipA)) : vec2(cos(sa) >= 0.0 ? 1.0 : -1.0, sin(sa) >= 0.0 ? 1.0 : -1.0);
  vec2 pairA = cube ? rot2(radians(120.0)) * tip : vec2(tip.x, -tip.y);
  vec2 pairB = cube ? rot2(radians(-120.0)) * tip : vec2(-tip.x, tip.y);
  vec2 axis = normalize(tip);
  int mIdx = int(floor(2.0 * mod(degrees(atan(axis.y, axis.x)), 360.0) / (360.0 / nsf) + 0.5));
  vec2 sdirS = rotCW(axis, u_angle);

  // Heights: a core stands up out of its crystal's hollow (in front of a cube's corner), a daughter a step over the
  // crystal it grew from; scaled so the tallest chain is at most 1.
  float coreH = 1.0 + 0.5 * u_core;
  float dauH = 1.08;
  float norm = 1.0 / max(bsPow(coreH, nC), bsPow(dauH, nD));

  // Per generation: the cells a crystal reaches from (its half-diagonal at the largest size, its daughters' reach on the
  // largest generation, its scatter, and room for the mask's distance out to the bevel) and the chain's length.
  float rmax = 0.5 * u_size * exp2(u_size_var) * (cube ? 1.0 : 1.4143);
  float extD = nD > 0 ? 1.0 + (0.85 + rho) * (1.0 - bsPow(rho, nD)) / (1.0 - rho) : 1.0;
  int KRg[4];
  int Lg[4];
  int cnt[4];
  int total = 0;
  for (int g = 0; g < 4; g++) {
    vec2 cpx = uRes / (cells0 * exp2(float(g)));
    float reach = rmax * (g == 0 ? extD : 1.0) + 0.5 * u_scatter + (u_bevel + soft + 1.0) / min(cpx.x, cpx.y);
    KRg[g] = clamp(int(floor(reach + 0.5)), 1, 3);
    Lg[g] = 1 + nC + (g == 0 ? nD : 0);
    cnt[g] = g < G ? (2 * KRg[g] + 1) * (2 * KRg[g] + 1) * Lg[g] : 0;
    total += cnt[g];
  }

  // Outlines grow by a pixel, closing hairline gaps between crystals.
  float dil = 1.0;
  // Pass 1: the front two crystals (by depth key) with their frames — A (q, R, the crystal's radius), B (offset from the
  // crystal's centre, generation, chain level), C (colour random, feature random, height), cell key, coverage.
  float k1 = -1e9, k2 = -1e9;
  vec4 A[2], B[2], C[2];
  ivec2 K[2];
  float cv[2];
  for (int i = 0; i < 2; i++) { A[i] = vec4(0.0, 0.0, 1.0, 1.0); B[i] = vec4(0.0); C[i] = vec4(0.0); K[i] = ivec2(0); cv[i] = 0.0; }
  float sdU = 1e4;
  // The chain's current crystal: centre in the crystal's frame, radius, and the daughters' corner (carried from one level
  // to the next).
  vec2 cl = vec2(0.0);
  float cR = 1.0;
  vec2 dc = tip;
  // (No continue in this loop: ANGLE / D3D11 can miscompile it.)
  for (int e = 0; e < total; e++) {
    int g = 0;
    int r = e;
    if (r >= cnt[0]) { r -= cnt[0]; g = 1; if (r >= cnt[1]) { r -= cnt[1]; g = 2; if (r >= cnt[2]) { r -= cnt[2]; g = 3; } } }
    int L = Lg[g];
    int KR = KRg[g];
    int side = 2 * KR + 1;
    int lvl = r % L;
    int o = r / L;
    vec2 cells = cells0 * exp2(float(g));
    vec2 cpx = uRes / cells;
    ivec2 cell = ivec2(floor(p / cpx)) + ivec2(o % side, o / side) - KR;
    ivec2 key = wrapCell(cell, ivec2(cells + 0.5));
    float sg = uSeed + float(g) * 101.0;
    vec4 hA = vec4(hash2I(key, sg), hash2I(key, sg + 7.0));
    vec4 hB = vec4(hash2I(key, sg + 13.0), hash2I(key, sg + 19.0));
    vec4 hC = vec4(hash2I(key, sg + 31.0), hash2I(key, sg + 37.0));
    bool isD = lvl > nC;
    // Daughters: none, one on the tip, or a mirrored pair.
    int dmode = hC.z < u_daughters ? (hC.w < u_pairs ? 2 : 1) : 0;
    if ((g == 0 || hA.x < u_fill) && (!isD || dmode > 0)) {
      vec2 ctr = (vec2(cell) + 0.5 + (hA.yz - 0.5) * u_scatter) * cpx;
      float Rc = 0.5 * u_size * min(cpx.x, cpx.y) * exp2(u_size_var * (2.0 * hA.w - 1.0));
      vec2 d = p - ctr;
      vec2 qc = unrotCW(d, u_angle + u_angle_var * (hB.x - 0.5) * (cube ? 120.0 : 90.0));
      // The chain: cores in the middle, each in the last; a daughter on the corner of the last (the crystal, for the
      // first: the tip, or the nearer of the pair), each further one on the same corner.
      if (lvl == 0 || lvl == nC + 1) { cl = vec2(0.0); cR = Rc; }
      if (lvl > 0 && !isD) cR = Rc * bsPow(u_core, lvl);
      if (isD) {
        if (lvl == nC + 1) dc = dmode == 1 ? tip : (dot(qc, pairA - pairB) > 0.0 ? pairA : pairB);
        cl += 0.85 * cR * dc;
        cR *= rho;
      }
      vec2 q = qc - cl;
      float ds = bsOutline(q, cR, cube, cube ? 6 : 4, key + ivec2(lvl * 4099, 0), sg,
                           (cube ? 0.8660254 : 1.0) * cR * clamp(u_top, 0.05, 1.0) / float(u_terraces), dil).x;
      sdU = min(sdU, ds);
      // The outer wall falls over half as much again as a step's rise: a cliff of the crystal's whole height.
      float cov = smoothstep(0.0, 1.0, clamp(0.5 - ds / (1.5 * soft), 0.0, 1.0));
      if (cov > 0.0) {
        float base = (1.0 - u_rise_var * hB.z) * bsPow(u_gen_h, g) * (1.0 - u_h_var * featVar(hB.w)) * norm;
        float kd = float(G - g) * 8.0 + u_stack * dot(ctr - p, sdirS) / min(cpx.x, cpx.y) + (1.0 - u_stack) * base
                 + 1e-3 * float(lvl);
        vec4 a = vec4(q, cR, Rc), b = vec4(d, float(g), float(lvl)), cc = vec4(hB.y, hB.w, base, ds);
        if (kd > k1) {
          k2 = k1; A[1] = A[0]; B[1] = B[0]; C[1] = C[0]; K[1] = K[0]; cv[1] = cv[0];
          k1 = kd; A[0] = a; B[0] = b; C[0] = cc; K[0] = key; cv[0] = cov;
        } else if (kd > k2) { k2 = kd; A[1] = a; B[1] = b; C[1] = cc; K[1] = key; cv[1] = cov; }
      }
    }
  }

  // Pass 2: the facets of the front crystal and the one behind it — height, ramp position, shade.
  float R0 = 0.5 * u_size * min(uRes.x / cells0.x, uRes.y / cells0.y);
  vec2 sdir = rotCW(vec2(1.0, 0.0), u_sweep_angle);
  vec2 nc = cells0 * 3.0;
  float mot = u_mottle * (fbm(p / uRes * nc, periodOf(nc), 3, uSeed + 5.0) - 0.5);
  int tn = 2 * u_terraces;
  float grW = 0.5 * u_groove;
  float Hs[2], Ts[2], Ss[2], Bs[2], Ks[2], Gs[2];
  for (int i = 0; i < 2 * UNI_1; i++) {
    Hs[i] = 0.0; Ts[i] = 0.0; Ss[i] = 1.0; Bs[i] = 0.0; Ks[i] = 0.0; Gs[i] = 0.0;
    if ((i == 0 ? k1 : k2) > -1e8) {
      vec2 q = A[i].xy;
      float R = A[i].z, Rc = A[i].w;
      vec2 d = B[i].xy;
      int g = int(B[i].z), lvl = int(B[i].w);
      bool isD = lvl > nC;
      int sub = isD ? lvl - nC : lvl;
      ivec2 key = K[i];
      float sg = uSeed + float(g) * 101.0;
      int hk = key.x * 64 + lvl * 8;
      // The face and its frame uv (0..1): a square crystal is one face; a cube's three rhombi (right, top, left,
      // anticlockwise from its bottom point) are each turned to the top one, whose edges run from the corner at 30° and
      // 150°, and measured along them — with its fall from the corner and its colour shift blended into the neighbours'
      // over a pixel either side of the edges between them (r sin of the angle from each edge).
      float ang = atan(q.y, q.x);
      float am = mod(degrees(ang) + 90.0, 360.0);
      float face = cube ? floor(am / 120.0) : 0.0;
      am -= 120.0 * face;
      vec2 qf = rot2(-radians(120.0 * face - 120.0)) * q;
      // The top face: Top face width × the crystal's size; outside it (cOut, 0 at the centre, 1 at the outline) the sides.
      float topF = clamp(u_top, 0.05, 1.0);
      vec2 ol = bsOutline(q, R, cube, cube ? 6 : 4, key + ivec2(lvl * 4099, 0), sg,
                          (cube ? 0.8660254 : 1.0) * R * topF / float(u_terraces), dil);
      float dIn = -ol.x;
      float Rt = R * topF;
      float apO = cube ? 0.8660254 * R : R;
      float cOut = (cube ? max(max(abs(q.x), abs(dot(q, vec2(0.5, 0.8660254)))), abs(dot(q, vec2(-0.5, 0.8660254))))
                         : max(abs(q.x), abs(q.y))) / apO;
      vec2 uv = cube ? vec2(2.0 * qf.y + 1.1547005 * qf.x, 2.0 * qf.y - 1.1547005 * qf.x) / (2.0 * Rt) : 0.5 + 0.5 * q / Rt;
      float tilt = cube ? qf.y / R : 0.0;
      float rq = length(q);
      float wp = cube ? clamp(0.5 - rq * sin(radians(am)), 0.0, 0.5) : 0.0;
      float wn = cube ? clamp(0.5 - rq * sin(radians(120.0 - am)), 0.0, 0.5) : 0.0;
      float fo = face + wp * (mod(face + 2.0, 3.0) - face) + wn * (mod(face + 1.0, 3.0) - face);
      // The face's grown facets (one of the templates, by the face's hash): the cell and the 8 round it — each cell's
      // height (1 on the rim's path, 0 the deepest; outside the face the rim's) and walls (bit 0 east, 1 north).
      int tpl = int(hashI(ivec2(hk + int(face), key.y), sg + 53.0) * ${FACE_TEMPLATES}.0);
      // Terrace grading: the rings narrow near the rim (the face's Chebyshev radius raised to a power above 1), and px per
      // cell follows.
      vec2 uv0 = uv;
      float cR0 = max(2.0 * max(abs(uv.x - 0.5), abs(uv.y - 0.5)), 1e-4);
      float gp = 1.0 + u_grade;
      uv = 0.5 + (uv - 0.5) * pow(min(cR0, 1.0), gp - 1.0);
      float gradeK = gp * pow(min(cR0, 1.0), gp - 1.0);
      vec2 gc = clamp(uv, 0.0, 0.99999) * float(tn);
      ivec2 ic = ivec2(floor(gc));
      vec2 fr = gc - vec2(ic);
      float cpx = (cube ? 0.8660254 : 2.0) * Rt / float(tn) / max(gradeK, 0.25);
      float fh[9];
      int fw[9];
      float fb[9];
      float maxL = 1.0;
      for (int t9 = 0; t9 < 9; t9++) {
        ivec2 cc = ic + ivec2(t9 % 3 - 1, t9 / 3 - 1);
        bool inside = cc.x >= 0 && cc.y >= 0 && cc.x < tn && cc.y < tn;
        vec4 tx = texelFetch(t_facets, ivec2(tpl * tn + clamp(cc.x, 0, tn - 1), clamp(cc.y, 0, tn - 1)), 0);
        fh[t9] = inside ? 1.0 - (tx.r * 65280.0 + tx.g * 255.0) / 65535.0 : 1.0;
        fw[t9] = inside ? int(tx.b * 255.0 + 0.5) : 4;
        if (t9 == 4) maxL = max(tx.a * 255.0, 1.0);
      }
      // Bars (the rim, the keys, and outside the face) stand at the rim's height, a step and a half over the top
      // terrace; keys only on crystals big enough for them to read (3 px a cell), else they float as glyphs.
      float barTop = 1.0 + 1.5 / maxL;
      for (int t9 = 0; t9 < 9; t9++) {
        fb[t9] = (fw[t9] & 4) != 0 ? 1.0 : 0.0;
        fh[t9] = mix(fh[t9], barTop, fb[t9]);
      }
      float h0 = fh[4];
      // The floor: the cell's own height, stepping to a joined neighbour's over the softness at the edge between them.
      bool wE = (fw[4] & 1) != 0, wN = (fw[4] & 2) != 0, wW = (fw[3] & 1) != 0, wS = (fw[1] & 2) != 0;
      bool ex = fr.x > 0.5, ey = fr.y > 0.5;
      float bx = (ex ? wE : wW) ? 0.0 : 0.5 - 0.5 * smoothstep(0.0, soft, (ex ? 1.0 - fr.x : fr.x) * cpx);
      float by = (ey ? wN : wS) ? 0.0 : 0.5 - 0.5 * smoothstep(0.0, soft, (ey ? 1.0 - fr.y : fr.y) * cpx);
      float hfl = h0 + bx * (fh[ex ? 5 : 3] - h0) + by * (fh[ey ? 7 : 1] - h0);
      float barC = clamp(fb[4] + bx * (fb[ex ? 5 : 3] - fb[4]) + by * (fb[ey ? 7 : 1] - fb[4]), 0.0, 1.0);
      // The grooves: the cell's walled edges and the posts at its corners (where any wall meets the node, so walls join and
      // a neighbour's wall ends square), the nearest one sunk a little below the lower floor beside it.
      bool pNE = wE || wN || (fw[7] & 1) != 0 || (fw[5] & 2) != 0;
      bool pNW = wW || wN || (fw[6] & 1) != 0 || (fw[3] & 2) != 0;
      bool pSE = wE || wS || (fw[1] & 1) != 0 || (fw[2] & 2) != 0;
      bool pSW = wW || wS || (fw[0] & 1) != 0 || (fw[0] & 2) != 0;
      float rd = 9.0, low = h0;
      if (wE && 1.0 - fr.x < rd) { rd = 1.0 - fr.x; low = min(h0, fh[5]); }
      if (wW && fr.x < rd) { rd = fr.x; low = min(h0, fh[3]); }
      if (wN && 1.0 - fr.y < rd) { rd = 1.0 - fr.y; low = min(h0, fh[7]); }
      if (wS && fr.y < rd) { rd = fr.y; low = min(h0, fh[1]); }
      float dNE = max(1.0 - fr.x, 1.0 - fr.y), dNW = max(fr.x, 1.0 - fr.y), dSE = max(1.0 - fr.x, fr.y), dSW = max(fr.x, fr.y);
      if (pNE && dNE < rd) { rd = dNE; low = min(min(h0, fh[5]), min(fh[7], fh[8])); }
      if (pNW && dNW < rd) { rd = dNW; low = min(min(h0, fh[3]), min(fh[7], fh[6])); }
      if (pSE && dSE < rd) { rd = dSE; low = min(min(h0, fh[5]), min(fh[1], fh[2])); }
      if (pSW && dSW < rd) { rd = dSW; low = min(min(h0, fh[3]), min(fh[1], fh[0])); }
      // (At least 1.5 px wide, so a turned crystal's grooves don't break into dashes; none on a bar.)
      float gw = max(grW, 3.0 / cpx);
      float grC = fb[4] > 0.5 ? 0.0
                : smoothstep(0.0, 1.0, clamp(0.5 - (rd - gw) * cpx / soft, 0.0, 1.0)) * smoothstep(2.0, 4.0, cpx);
      // Small crystals (under 3 px a cell, where the facets would be mush): plain terraces as many as fit at 3 px each,
      // without grooves.
      float smallK = smoothstep(3.0, 1.5, cpx);
      if (smallK > 0.0) {
        float nEff = max(1.0, floor(0.5 * cpx * float(tn) / 3.0));
        float cH = 2.0 * max(abs(uv.x - 0.5), abs(uv.y - 0.5));
        float hs = 1.0 - floor((1.0 - clamp(cH, 0.0, 1.0)) * nEff) / nEff;
        hfl = mix(hfl, hs, smallK);
        grC *= 1.0 - smallK;
      }
      // Tread tilt: the steps blended with a smooth cone down to the hollow (a share Tilt × 0.4), so every tread slopes
      // towards the hollow, continuously across a facet (no seams where it crosses a ring); the bars domed.
      float stepH = 1.0 / max(0.5 * float(tn), 1.0);
      float cone = 2.0 * max(abs(uv.x - 0.5), abs(uv.y - 0.5));
      hfl = mix(hfl, mix(hfl, cone, clamp(0.4 * u_tilt, 0.0, 0.8)), 1.0 - barC);
      float dE = 9.0;
      if (fb[5] < 0.5) dE = min(dE, 1.0 - fr.x);
      if (fb[3] < 0.5) dE = min(dE, fr.x);
      if (fb[7] < 0.5) dE = min(dE, 1.0 - fr.y);
      if (fb[1] < 0.5) dE = min(dE, fr.y);
      hfl += u_tilt * 0.6 * stepH * barC * (sqrt(clamp(2.0 * dE, 0.0, 1.0)) - 1.0);
      // Each facet tilted its own small way (a plane across it, by its hash); one in six a mirror facet, glossy and lit
      // brighter across its whole area — the photo's broad flashes of colour.
      float fl = (1.0 - h0) * maxL;
      float bk = hashI(ivec2(hk + 2 + int(face), int(floor(fl + 0.5))), sg + 37.0);
      vec2 fd = vec2(cos(TAU * fract(bk * 3.71)), sin(TAU * fract(bk * 3.71)));
      float facetLit = fract(bk * 5.13) < 0.1667 ? 1.0 : 0.0;
      hfl += u_tilt * 0.35 * stepH * dot(gc / float(tn) - 0.5, fd) * (1.0 - barC);
      // The riser: from the upper tread down to the lower across the riser width (none on the lower side, where low is
      // its own height).
      float riser = grC * step(low + 1e-4, h0);
      float hf = mix(hfl, mix(low, hfl, clamp(rd / max(gw, 1e-3), 0.0, 1.0)), riser);
      // The key: a square spiral of bars winding out from the hollow (Keys of the faces, by hash), Key size of the half-width
      // (0.6–1.3× per face), bars Key width of a terrace, arms 1, 1, 2, 2, … pitches long, each lap a tier higher, domed.
      // In the face's own (ungraded) frame, so its bars are even.
      vec4 hkk = vec4(hash2I(ivec2(hk + 11 + int(face), key.y), sg + 79.0), hash2I(ivec2(hk + 13 + int(face), key.y), sg + 83.0));
      float keyC = 0.0, keyH = 0.0;
      float bw = 0.5 * clamp(u_key_w, 0.1, 1.0) / float(tn);
      float pitch = 4.0 * bw;
      float reachK = clamp(u_key_size, 0.1, 0.9) * 0.5 * mix(0.6, 1.3, hkk.y);
      vec2 kq = uv0 - 0.5 - (hkk.zw - 0.5) * 0.3;
      // (Only within the spiral's own reach: elsewhere the loop would find nothing.)
      if (hkk.x < u_keys && cpx >= 3.0 && max(abs(kq.x), abs(kq.y)) < reachK + 2.0 * pitch + bw) {
        float turnK = hkk.z < 0.5 ? 1.0 : -1.0;
        float a0 = floor(fract(hkk.w * 7.3) * 4.0) * 0.5 * PI;
        vec2 pos = vec2(0.0);
        float kd = 1e9, kl = 0.0;
        for (int sk = 0; sk < 10 * UNI_1; sk++) {
          float len = pitch * float(1 + sk / 2);
          if (max(abs(pos.x), abs(pos.y)) + len <= reachK + pitch) {
            float an = a0 + turnK * float(sk) * 0.5 * PI;
            vec2 dir = vec2(cos(an), sin(an));
            vec2 l = kq - pos;
            float sdk = sdBox(vec2(dot(l, dir) - 0.5 * len, dot(l, vec2(-dir.y, dir.x))), vec2(0.5 * len + bw, bw));
            if (sdk < kd) { kd = sdk; kl = float(sk); }
            pos += dir * len;
          }
        }
        float kpx = kd * float(tn) * cpx;
        keyC = smoothstep(0.0, 1.0, clamp(0.5 - kpx / soft, 0.0, 1.0));
        float dome = sqrt(clamp(-kd / bw, 0.0, 1.0));
        keyH = min(0.62 + 0.06 * kl + 0.15 * dome, barTop);
      }
      hf = mix(hf, max(hf, keyH), keyC);
      // The sides: ledges stepping down from the top face's rim to the base, each rising over the softness.
      // (At least 3 px a ledge.)
      float nl = clamp(floor((1.0 - topF) * apO / 3.0), 1.0, float(u_ledges));
      // The sides follow the real outline (rounded, stepped, notched): their ledges count in from it.
      float sideW = max((1.0 - topF) * apO, 1e-3);
      float sp = clamp(1.0 - dIn / sideW, 0.0, 1.0) * nl;
      float kl = min(floor(sp), nl - 1.0), flg = sp - kl;
      float swl = clamp(soft * nl / max((1.0 - topF) * apO, 1e-3), 0.0, 1.0);
      float hSide = 1.0 - (kl + smoothstep(1.0 - swl, 1.0, flg)) / nl;
      float sel = topF < 1.0 ? smoothstep(-0.5, 0.5, max((cOut - topF) * apO, sideW - dIn) / soft) : 0.0;
      // Height: the crystal's (each core or daughter its step over the one it grew from), its hopper and the lean.
      float base = C[i].z;
      vec2 hl2 = hash2I(key, sg + 41.0);
      vec2 lean = hl2.y * vec2(cos(TAU * hl2.x), sin(TAU * hl2.x));
      // The edge bevel: a rounded chamfer down the whole outer wall, from the full height Edge bevel in to the base at
      // the outline; and a notch's deeper part drops the surface to the tier below.
      float xb = u_edge > 0.0 ? clamp(dIn / u_edge, 0.0, 1.0) : 1.0;
      float bev = sqrt(max(1.0 - (1.0 - xb) * (1.0 - xb), 0.0));
      float notchLow = smoothstep(0.5, -0.5, ol.y / soft);
      Hs[i] = base * bev * (1.0 - 0.18 * notchLow)
            * (bsPow(isD ? dauH : coreH, sub) * (1.0 - u_slope * tilt) * mix(1.0 - u_depth * (1.0 - hf), hSide, sel)
               + 0.125 * u_lean * dot(d / Rc, lean));
      // Colour: the crystal's own place (over the ramp's whole cycle there and back, so no shift favours one end), its
      // laps (four turns each), each facet's own shift, the sweep across it, its sub-crystals and its face.
      // The sides are one chunk of the crystal's colour, a step cooler (their ledges show in the relief and the shade).
      Ts[i] = u_col_ofs + 2.0 * u_col_var * fract(13.7 * C[i].x) + u_sweep * dot(d, sdir) / (2.0 * R0)
            + u_sub_col * float(sub) + u_face_col * fo + mot
            + mix(0.25 * u_col_step * fl + u_band * (bk - 0.5), 0.15, sel);
      // Shade: each facet solid, darker the deeper it lies (a little lighter or darker than the next by Colour per facet's
      // second draw, the mirror facets brighter); the risers lit; the rim and the keys bright; the sides dark.
      float deep = mix(0.12, 1.0, pow(clamp(hfl, 0.0, 1.0), 1.8)) * (1.0 + min(u_band * 3.0, 1.0) * 0.3 * (fract(bk * 7.31) - 0.5));
      float tread = mix(deep * (1.0 + 0.8 * facetLit), mix(0.5, 1.2, clamp(hfl, 0.0, 1.0)), riser);
      Ss[i] = mix(1.0, mix(mix(mix(tread, 1.35, keyC), 1.35, barC), 0.3 * (0.6 + 0.4 * hSide), sel), u_contrast)
            * (1.0 - 0.35 * u_contrast * notchLow);
      // Greying (toward its own luminance): a metal's moderate chroma on the treads, more deep down and on the sides; the
      // risers, rim and keys keep their colour.
      Gs[i] = mix(0.3, 1.0, u_contrast)
            * mix(mix(mix(0.2 * (1.0 - clamp(hfl, 0.0, 1.0)) * (1.0 - riser) * (1.0 - facetLit), 0.1, keyC), 0.15, barC), 0.6, sel);
      // Glossy: the bars, the keys and the mirror facets.
      Bs[i] = max(max(barC, keyC), facetLit * (1.0 - riser)) * (1.0 - sel);
      // The skirt (sides and bevel) covers what is behind only where it stands at least as high.
      Ks[i] = max(sel, 1.0 - xb);
    }
  }
  // The front crystal over what is behind it, by its coverage — but over its sides (the skirt below its top face) only
  // where it stands at least as high, so the ledges of a crystal in front never cut a higher rim behind it. The ramp's
  // first stop is the bare ground (value 0); the crystals walk the rest of it, from its second stop on, and back.
  float hb = Hs[1] * cv[1];
  float c1 = cv[0] * mix(1.0, smoothstep(-0.01, 0.01, Hs[0] - hb), Ks[0]);
  float g0 = u_dif_grad_count > 1 ? u_dif_grad_stops[1].a : 0.0;
  float v1 = k1 < -1e8 ? 0.0 : g0 + (1.0 - g0) * bsRamp(Ts[0]);
  float v2 = k2 < -1e8 ? 0.0 : g0 + (1.0 - g0) * bsRamp(Ts[1]);
  GenOut g = genOut(v1, u_ground ? 1.0 : coverage(sdU, u_aa), C[0].y, sdU);
  gGenAlt = vec2(v2, 1.0 - c1);
  gGenShade = mix(Ss[1], Ss[0], c1);
  gGenGrey = mix(Gs[1], Gs[0], c1);
  // Parts: roughness — the bars glossy (0), the rest satin (1) and the ground rougher still (it reads as a matte gap,
  // not glinting dirt); metalness — the crystals metal, the ground not.
  float onCr = k1 < -1e8 ? 0.0 : clamp(c1 + (k2 > -1e8 ? 1.0 : 0.0), 0.0, 1.0);
  gGenLevel = vec4(mix(6.0, 1.0 - mix(Bs[1], Bs[0], c1), onCr), -1.0, onCr, -1.0);
  // Per-feature variation is each crystal's height (above), not a scale of the whole value.
  g.feat = 0.0;
  // Surface grain: fine unevenness over every surface.
  vec2 ncG = cells0 * 40.0;
  float grain = u_grain > 0.0 ? 0.08 * u_grain * (valueNoise(p / uRes * ncG, periodOf(ncG), uSeed + 73.0) - 0.5) : 0.0;
  g.hval = clamp(mix(hb, Hs[0], c1) + grain, 0.0, 1.0);
  return g;
}
`
};
