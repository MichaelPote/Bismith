// Vents and pipes (FR7.2d). Vents: grilles of slots / louvre fins / perforated holes, optionally inside a
// framed field. Pipes: runs of parallel cylinders or conduits with clamp straps. See greebleCommon.ts for the
// relief / SDF output convention.

import { P, gradient, round1 as r1, type ParamValues } from '@/core/params';
import { maskParts, spacingParams } from '../commonParams';
import type { LayerDef } from '../types';
import { FASTENER_HEADS, GRB_GLSL, ORIENT, ORIENT_ACROSS, ORIENT_ALONG } from './greebleCommon';
import { GLSL_PRIMTEX } from '../primTexture';
import { memoReads } from '@/core/memo';
import { planJogs } from './pipesJogs';

// Slot length runs along the slots, slot width across them (holes: a diameter, both axes).
const slotAcross = (p: ParamValues) => (p.mode === 'holes' ? null : ORIENT_ACROSS(p));

const isFins = (p: ParamValues) => p.mode === 'louvers' || p.mode === 'hoods';
const framed = (p: ParamValues) => Number(p.margin) > 0;
/** The largest fastener radius the frame takes: 0.3 × its flat (as the shader clamps it). */
const fastenerCap = (p: ParamValues) => {
	const m = Number(p.margin);
	const flat = Math.max(
		m - Math.min(Math.max(Number(p.outer ?? 1), 0), 0.5 * m) - Math.min(Math.max(Number(p.bevel ?? 1), 0), 0.5 * m),
		1
	);
	return Math.max(0.3 * flat, 1.25);
};
const isConduit = (p: ParamValues) => p.shape === 'conduit';
const pipesMax = (p: ParamValues) => Math.max(Number(p.bundle ?? 1), Number(p.bundle_max ?? 1));
const jointsOn = (p: ParamValues) => Number(p.joints) > 0;
const jogsOn = (p: ParamValues) => Number(p.jog_chance) > 0;

// ------------------------------------------------------------------------------------------------ vents

// The parts each relief can hand to a mask (Write to › Source), the default first.
const VENT_PARTS = maskParts('mask', 'plate', [
	['plate', 'Plate', 'the metal (plate, frame and fasteners) with the openings cut out'],
	['slots', 'Openings', 'the slots or holes'],
	['frame', 'Frame', 'the border frame (needs a Frame width)']
]);
const PIPE_PARTS = maskParts('mask', 'all', [
	['pipes', 'Pipes', 'the pipes with their joints'],
	['clamps', 'Clamps'],
	['all', 'Pipes + clamps', 'the pipes with their joints, and the clamps']
]);

export const ventsLayer: LayerDef = {
	type: 'vents',
	label: 'Vents & grilles',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Vents & grilles: Made from a grid of slots, louvres or perforated holes in a plate, optionally staggered or set in a framed panel with fasteners. Makes vents, grilles, louvred panels and perforated metal.',
	params: [
		P.enum(
			'output',
			'Output',
			'relief',
			[
				['relief', 'Relief (all, value)'],
				['slots', 'Slots / holes (shape)'],
				['plate', 'Plate between slots (shape)'],
				['frame', 'Border frame (shape)']
			],
			{
				hint: 'Relief combines the plate, its openings, louvres, frame and fasteners into one height value (the Edge bevel and profile shape the frame step, Slot rim the openings). The shape outputs give you one part as a shape'
			}
		),
		P.enum('mode', 'Opening type', 'slots', [
			['slots', 'Slots'],
			[
				'louvers',
				'Louvres (sunken fins / blades)',
				'angled fins inside each opening, below the plate; several Fins per opening make a blade grille'
			],
			['holes', 'Holes'],
			[
				'hoods',
				'Pressed louvres (hoods)',
				'a hood pressed up out of the plate over each opening, a dark slit under its lip'
			]
		]),
		P.int('cols', 'Columns', 2, 1, 256, {
			softMax: 64,
			hint: 'How many cells go across the field (one slot or hole each)'
		}),
		P.int('rows', 'Rows', 8, 1, 256, {
			softMax: 128,
			hint: 'How many cells go down the field (use an even count with Stagger so it tiles)'
		}),
		...spacingParams(),
		P.enum('orient', 'Slot direction', 'horizontal', ORIENT, { showIf: (p) => p.mode !== 'holes' }),
		P.float('length', 'Slot length', 24, 1, 4096, {
			softMax: 512,
			unit: 'px',
			axis: ORIENT_ALONG,
			step: 0.5,
			showIf: (p) => p.mode !== 'holes',
			hint: 'Sets the slot length, up to the cell’s length. At the full cell length (or more) the slots join into continuous bars. Whole px stay crisp'
		}),
		P.float('width', 'Slot width', 3, 0.5, 1024, {
			softMax: 64,
			unit: 'px',
			axis: slotAcross,
			step: 0.5,
			hint: 'Sets the slot thickness or hole diameter (for hex holes, across the flats). Always keeps at least a 1 px bar to the next row'
		}),
		P.enum(
			'ends',
			'Slot ends',
			'round',
			[
				['round', 'Round'],
				['square', 'Square'],
				['pointed', 'Pointed (both sides)'],
				['angled', 'Angled (one diagonal cut)'],
				['hex', 'Hex (60° points)']
			],
			{
				hint: 'Shapes the slot ends. Pointed ends taper to a point (Point length) and leave bow-tie tabs when staggered. Angled ends cut both ends on the same diagonal; hex ends make long hexagons. For holes, picks round, square or hex (hex stands on a point: with Stagger 0.5 and rows ≈ 0.87 × the column spacing they pack into a honeycomb)'
			}
		),
		P.float('tip', 'Point length', 1.5, 0.1, 8, {
			softMax: 4,
			step: 0.01,
			showIf: (p) => p.mode !== 'holes' && (p.ends === 'pointed' || p.ends === 'angled'),
			hint: 'Sets the length of the pointed or angled ends, in slot widths (0.5 = 45°, 2 = long tapers)'
		}),
		P.float('stagger', 'Stagger', 0, 0, 1, {
			step: 0.001,
			hint: 'Shifts every other row along the slots by a fraction of a cell (0.5 = brick / hex packing)'
		}),
		P.float('louver', 'Fin slant', 0.8, -1, 1, {
			step: 0.001,
			showIf: isFins,
			hint: 'Slants the fins: the sign picks which side they open to, and the size how straight they are (0 = rounded bars or domed hoods, 1 = straight ramps)'
		}),
		P.int('blades', 'Fins per opening', 1, 1, 16, {
			showIf: isFins,
			hint: 'How many fins (or hoods) sit side by side in each opening. Two or more sunken fins make a blade grille: slats with their top edge just under the plate, a rounded lip and a dark gap behind'
		}),
		P.float('rise', 'Hood rise', 0.3, 0, 1, {
			step: 0.001,
			showIf: (p) => p.mode === 'hoods',
			hint: 'Raises the hoods above the plate at their lip (1 = as high as the frame stands above 0)'
		}),
		P.float('depth', 'Opening depth', 1, 0, 1, {
			step: 0.001,
			hint: 'Sinks the openings below the plate (1 = right through, with the darkest colour inside; lower = shallow pressed recesses)'
		}),
		P.float('rim', 'Slot rim', 1, 0, 256, {
			softMax: 16,
			unit: 'px',
			step: 0.25,
			hint: 'Adds a bevel around each opening, sloping the plate down into it over this width with the Edge profile (the opening keeps its width). 0 = cut sharp'
		}),
		P.float('bead', 'Rim bead', 0, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.rim) > 0,
			hint: 'Raises an embossed bead on the rim around each opening (0 = none, 1 = as high as the frame stands)'
		}),
		VENT_PARTS.param,

		P.seed(),
		P.float('margin', 'Frame width', 0, 0, 1024, {
			softMax: 128,
			unit: 'px',
			step: 0.5,
			group: 'frame',
			hint: 'Adds a border with no slots around the tile (0 = an endless grille). The Edge bevel slopes it down to the field'
		}),
		P.float('field_level', 'Field level', 0.8, 0, 1, {
			step: 0.001,
			group: 'frame',
			hint: 'Sets the height of the plate inside the frame (the frame is 1), so how deep the field sits and how much headroom hoods and beads get. Later layers that read heights (Height mask, cavity) see these levels'
		}),
		P.float('clear', 'Edge clearance', 0, 0, 512, {
			softMax: 64,
			unit: 'px',
			step: 0.5,
			group: 'frame',
			showIf: framed,
			hint: 'Keeps a strip inside the field’s edge clear and lays the openings out over the rest, so the outermost bars are as wide as the others (or wider)'
		}),
		P.float('outer', 'Outer bevel', 1, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.25,
			group: 'frame',
			showIf: framed,
			hint: 'Slopes the frame down to the wall at the tile edge over this width (Edge profile), so the panel stands on its own and tiled panels meet in a groove. 0 = the frame runs flat to the edge'
		}),
		P.float('round', 'Corner radius', 2, 0, 512, {
			softMax: 64,
			unit: 'px',
			step: 0.5,
			group: 'frame',
			showIf: framed,
			hint: 'Rounds the field’s corners, and the panel’s outer corners to match, a frame’s width further out'
		}),
		P.enum(
			'fasteners',
			'Fasteners',
			'none',
			[
				['none', 'None'],
				['corners', 'Corners'],
				['sides', 'Corners and sides']
			],
			{ group: 'frame', showIf: framed, hint: 'Adds screw or rivet heads to the frame' }
		),
		P.float('fast_size', 'Fastener radius', 3, 0.5, 128, {
			softMax: 24,
			unit: 'px',
			step: 0.25,
			group: 'frame',
			showIf: (p) => framed(p) && (p.fasteners ?? 'none') !== 'none',
			note: (p) => {
				const cap = fastenerCap(p);
				return Number(p.fast_size) > cap ? `capped at ${r1(cap)} px: 0.3 × the frame’s flat` : undefined;
			},
			hint: 'Sets the head radius, up to 0.3 × the frame’s flat part (Frame width minus the outer bevel and the step down to the field)'
		}),
		P.enum('fast_style', 'Fastener head', 'slotted', FASTENER_HEADS, {
			group: 'frame',
			showIf: (p) => framed(p) && (p.fasteners ?? 'none') !== 'none',
			hint: 'Picks the kind of head. Heads get a random turn (from the seed); the sunk kinds sit in a round counterbore'
		}),
		P.float('depth_var', 'Depth variation', 0, 0, 1, {
			step: 0.001,
			group: 'wear',
			hint: 'Gives each opening a random depth (0 = all the same, 1 = anywhere from full to none). Partly filled ones dish like dents'
		}),
		P.float('missing', 'Missing openings', 0, 0, 1, {
			step: 0.001,
			group: 'wear',
			hint: 'Leaves out a share of the openings at random, for broken bars and gappy perforation'
		}),
		P.bool('plugs', 'Blanking plugs', true, {
			group: 'wear',
			showIf: (p) => Number(p.missing) > 0,
			hint: 'Shows missing openings as blanking plugs, a fine seam around a slightly sunk patch. Off = no trace'
		})
	],
	groups: [
		{ id: 'frame', label: 'Frame' },
		{ id: 'wear', label: 'Wear' }
	],
	maskWrite: VENT_PARTS.write,
	// What of the relief goes to a mask (Write to › Source).
	maskSources: VENT_PARTS.sources,
	defaults: {
		h_on: true,
		h_amount: 1,
		bevel: 1,
		profile: 'smooth',
		dif_on: true,
		dif_src: 'value',
		// Black through the openings, dark walls, the field and frame as mid metal.
		dif_grad: {
			stops: [
				{ pos: 0, color: '#11110f' },
				{ pos: 0.3, color: '#413e3b' },
				{ pos: 0.6, color: '#8c867a' },
				{ pos: 1, color: '#b2aa9a' }
			]
		},
		// Metal: the plate, its louvre blades and hoods (the openings are dark enough to show nothing).
		r_on: true,
		r_src: 'flat',
		r_b: 0.5,
		mt_on: true,
		mt_src: 'flat'
	},
	// A new layer in the editor: a framed panel sized to the texture (cells about 1/20 of it tall, slots 80 % × 40 % of
	// the cell) with a stepped-down field, edge clearance, rounded corners, an outer bevel, corner screws and chamfered
	// slot rims in proportion.
	fresh: ({ width, height }) => {
		const s = Math.min(width, height);
		const margin = s >= 128 ? Math.round(s / 16) : 0;
		// Cells about 1/20 of the texture tall (8…48 px); on strips and small panels (from 100 px) never below ~22 px, so a
		// short side still gets a few bold rows rather than many hairlines.
		const cy = Math.min(48, Math.max(8, height / 20, s >= 100 ? Math.min(s / 5.5, 22) : 0));
		const rows = Math.max(1, Math.round((height - 2 * margin) / cy));
		const cols = Math.max(1, Math.round((width - 2 * margin) / (cy * 5)));
		const bevel = Math.max(1, Math.round(s / 128));
		const w = Math.max(1, Math.round(((height - 2 * margin) / rows) * 0.4));
		// Clear of the frame step by the bevel and half a bar more, so the outer bars match the inner ones.
		const clear = margin > 0 ? Math.round(bevel + 0.5 * ((height - 2 * margin) / rows - w)) : 0;
		const cellX = (width - 2 * margin - 2 * clear) / cols;
		return {
			cols,
			rows,
			length: Math.max(1, Math.round(cellX * 0.8)),
			width: w,
			rim: r1(Math.max(1, w * 0.3)),
			margin,
			clear,
			field_level: margin > 0 ? 0.6 : 0.8,
			outer: margin > 0 ? Math.max(1, Math.round(s / 170)) : 0,
			round: margin > 0 ? Math.round(s / 64) : 0,
			fasteners: margin >= 6 ? 'corners' : 'none',
			fast_size: r1(Math.max(1.5, margin * 0.2)),
			bevel
		};
	},
	glsl:
		GRB_GLSL +
		/* glsl */ `
// One slot centred at the origin (x along it): round / square ends, pointed (tapering to a point Point length × W long:
// 0.5 = 45°), angled (both ends cut on the same diagonal) or hex (60° points). Holes (L across x, W across y): round,
// square, or a hexagon standing on a point (L across the flats, W point to point).

// Pointed, angled or hex ends (else round or square ones, a rounded box).
bool vent_ends() { return u_ends == 4 || (u_mode != 2 && (u_ends == 2 || u_ends == 3)); }
// The pointed, angled and hex slots' sides as lines, here in the space Bevel aspect stretches (greebleCommon: k along
// the local axes; k = 1, the slot itself) — exact inside.
float vent_slotK(vec2 d, float L, float W, vec2 k) {
  vec2 a = abs(d);
  if (u_ends == 4) {
    bool hole = u_mode == 2;
    vec2 b = hole ? a.yx : a;
    vec2 s = hole ? vec2(W, L) : vec2(L, W);
    vec2 kb = hole ? k.yx : k;
    return max((b.y - 0.5 * s.y) * kb.y, (b.x * 0.8660254 + b.y * 0.5 - 0.4330127 * s.x) / length(vec2(0.8660254, 0.5) / kb));
  }
  float t = 2.0 * max(u_tip, 0.01);
  float e = u_ends == 2 ? a.x + t * a.y - 0.5 * L : abs(d.x + t * d.y) - 0.5 * L + 0.5 * t * W;
  return max((a.y - 0.5 * W) * k.y, e / length(vec2(1.0, t) / k));
}
float vent_slot(vec2 d, float L, float W, float rad) {
  return vent_ends() ? vent_slotK(d, L, W, vec2(1.0)) : sdRoundBox(d, 0.5 * vec2(L, W), vec4(rad));
}

GenOut gen(vec2 p) {
  // Local frame: x along the slots, y across them.
  bool holes = u_mode == 2;
  bool fins = u_mode == 1 || u_mode == 3;
  bool vert = u_orient == 1 && !holes;
  vec2 res = vert ? uRes.yx : uRes;
  vec2 q = vert ? p.yx : p;
  ivec2 n = max(vert ? ivec2(u_rows, u_cols) : ivec2(u_cols, u_rows), ivec2(1));
  float m = u_margin;
  vec2 flo = vec2(m), fhi = res - m;
  // The step between slots: the field over the count, plus Column / Row spacing (in the slots' frame: swapped when
  // vertical). The slots' size keeps to it.
  vec2 sp = vert ? vec2(u_row_sp, u_col_sp) : vec2(u_col_sp, u_row_sp);
  // Edge clearance (framed): the openings are laid out over the field less that border.
  float gin = m > 0.0 ? 2.0 * max(u_clear, 0.0) : 0.0;
  vec2 cs = vec2(repPitch(max(fhi.x - flo.x - gin, 1.0), n.x, sp.x, res.x), repPitch(max(fhi.y - flo.y - gin, 1.0), n.y, sp.y, res.y));
  bool wrap = uTile && m <= 0.0;
  float rr = m > 0.0 ? max(u_round, 0.0) : 0.0;
  float dField = grb_rbox(q, flo, fhi, rr);
  // A framed panel's outline, its corners concentric with the field's.
  bool shaped = m > 0.0;
  float dO = shaped ? grb_rbox(q, vec2(0.0), res, rr > 0.0 ? rr + m : 0.0) : -1e4;
  // Slots and holes keep at least a 1 px bar between neighbours (sunken fins may fill the cell). Hex holes stand on a
  // point: the width is across their flats (x), point to point is 2/√3 of it.
  float W = holes && u_ends == 4 ? min(u_width * 1.1547005, max(2.0 * cs.y - 1.0, 1.0))   // points reach between staggered rows
                                 : min(u_width, u_mode == 1 ? cs.y : max(cs.y - 1.0, 1.0));
  float L = holes ? min(u_width, max(cs.x - 1.0, 1.0)) : min(u_length, cs.x);
  float rad = u_ends == 0 ? 0.5 * min(L, W) : 0.0;
  bool full = !holes && u_length >= cs.x;

  // The slots' area: the field, less the edge clearance.
  float ci = 0.5 * gin;
  float dClip = ci > 0.0 ? grb_rbox(q, flo + ci, fhi - ci, max(rr - ci, 0.0)) : dField;
  float best = 1e9, bestRnd = 0.0, bestDep = 1.0, plug = 1e9, best2 = 1e9;
  vec2 bestC = vec2(0.0), bestC2 = vec2(0.0);   // (and the next nearest, for the plate's Bevel aspect)
  // The slots within a step of the pixel (repGrid), centred on the field, with copies round the torus when wrapping;
  // unwrapped, each row has a slot past either end that the stagger can bring into the field. One flat loop with a
  // pixel-dependent bound: D3D unrolls constant bounds, and every unrolled copy of the slot's distance costs compile
  // time.
  vec2 mid = 0.5 * (flo + fhi), reach = cs + 1.0;
  RepGrid rg = repGrid(wrap ? n : n + ivec2(2, 0), cs, mid, res, wrap, q - reach - vec2(u_stagger * cs.x, 0.0), q + reach);
  for (int e = 0; e < repCount(rg); e++) {
    ivec2 id;
    vec2 ctr;
    repAt(rg, e, id, ctr);
    if (!wrap) id.x -= 1;
    // Alternate rows shift along the slots (rows counted from the top, or from the left when vertical).
    int par = vert ? id.y : n.y - 1 - id.y;
    if ((par & 1) == 1) ctr.x += u_stagger * cs.x;
    vec3 hv = hash3I(id, uSeed + 71.0);
    ctr = vec2(grb_snapC(ctr.x, L), grb_snapC(ctr.y, W));
    // Slots as long as the cell run on as continuous bars (no end caps at the cell / tile edge).
    float d = full ? abs(q.y - ctr.y) - 0.5 * W : vent_slot(q - ctr, L, W, rad);
    if (!wrap) d = max(d, dClip);   // staggered slots (and the spares past the row ends) are clipped by the field
    // Left out (Missing openings): a plug, if shown. (No continue: ANGLE / D3D can miscompile it in a loop.)
    if (hv.x < u_missing) plug = min(plug, d);
    else if (d < best) { best2 = best; bestC2 = bestC; best = d; bestRnd = hashI(id, uSeed); bestC = ctr; bestDep = 1.0 - u_depth_var * hv.y; }
    else if (d < best2) { best2 = d; bestC2 = ctr; }
  }
  // (None in reach — a row or more beyond a frame's field, or all missing: far, but above NO_SDF, which would read as "no
  // shape".)
  best = min(best, 1e4);
  best2 = min(best2, 1e4);

  float dFrame = m > 0.0 ? max(-dField, dO) : 1e4;
  if (u_output > 0) {
    GenOut g = genOut(0.0, 1.0, bestRnd, u_output == 1 ? best : u_output == 2 ? (wrap ? -best : max(-best, dField)) : dFrame);
    if (bevelAspectOn()) {
      // Bevel aspect: the same shapes in the stretched space — the nearest slot (and the next, round which the plate
      // also bevels), the slots' clip, the field and the panel's outline — one rounded box in the loop, the pointed /
      // angled / hex slots as lines.
      vec2 k = grb_bevK(vert);
      float sS = 1e9, sS2 = 1e9, sClip = -1e4, sField = -1e4, sO = -1e4;
      for (int i = 0; i < 5 * UNI_1; i++) {
        bool slot = i < 2;
        vec2 dc = q - (i == 0 ? bestC : i == 1 ? bestC2 : i == 4 ? 0.5 * res : mid);
        vec2 hb = slot ? 0.5 * vec2(L, W) : i == 4 ? 0.5 * res : 0.5 * (fhi - flo) - (i == 2 ? ci : 0.0);
        float rb = slot ? rad : i == 2 ? max(rr - ci, 0.0) : i == 3 ? rr : (rr > 0.0 ? rr + m : 0.0);
        float e = grb_bevRBox(dc, hb, rb, k);
        if (slot && full) e = (abs(dc.y) - 0.5 * W) * k.y;
        else if (slot && vent_ends()) e = vent_slotK(dc, L, W, k);
        if (i == 0) sS = e; else if (i == 1) sS2 = e; else if (i == 2) sClip = e; else if (i == 3) sField = e; else sO = e;
      }
      if (!wrap) { sS = max(sS, sClip); sS2 = max(sS2, sClip); }
      sS = best < 1e4 ? sS : best;
      sS2 = best2 < 1e4 ? sS2 : best2;
      g.bdist = u_output == 1 ? sS : u_output == 2 ? (wrap ? -min(sS, sS2) : max(-min(sS, sS2), sField))
              : m > 0.0 ? max(-sField, sO) : 1e4;
    }
    return g;
  }

  // The plate: the frame (1) stepping down to the field over the Edge bevel, sloping to the wall at the outline over
  // the outer bevel. Heights above 1 (hoods, beads, fasteners) are normalised by the highest reachable (top).
  float plate = m > 0.0 ? mix(1.0, u_field_level, grb_rise(dField, u_bevel)) : u_field_level;
  if (shaped) plate *= u_outer > 0.0 ? grb_rise(dO, u_outer) : grb_cov(dO);
  float top = 1.0;
  float dep = clamp(u_depth, 0.0, 1.0) * bestDep;
  // Partly filled openings (Depth variation) dish toward their middle, like dents.
  float floorV = plate * (1.0 - dep - 0.35 * u_depth * (1.0 - bestDep) * clamp(-best / max(0.5 * W, 1.0), 0.0, 1.0));
  // Recesses (openings not cut right through) meet their walls in a fillet: the floor curves up toward the edge.
  float fil = 1.0 - clamp(-best / clamp(0.3 * W, 1.0, 4.0), 0.0, 1.0);
  if (dep < 0.999) floorV = mix(floorV, 0.5 * (floorV + plate), fil * fil);
  float inner = floorV;
  float innerP = -1.0;   // the paint inside, where it isn't the height (blade faces)
  if (fins) {
    float B = float(max(u_blades, 1));
    float Wb = W / B;
    float t = clamp((q.y - (bestC.y - 0.5 * W)) / max(W, 1e-3), 0.0, 1.0);
    float kb = min(floor(t * B), B - 1.0);
    float tb = t * B - kb;   // across this blade, 0..1
    bool up = u_louver >= 0.0;
    float s = up ? tb : 1.0 - tb;   // 0 at the blade's open side
    float sl = abs(u_louver);
    float hi, f;
    if (u_mode == 1 && B > 1.0) {
      // Blade grille: a dark gap (the first 22 % of each blade's pitch), then the slat's face rising to its top edge a
      // step under the plate (so the opening keeps an edge), rounding over in a lip 1.5–3 px wide; the face paints as
      // metal, the gap dark.
      float g = 0.22;
      float uf = clamp((s - g) / (1.0 - g), 0.0, 1.0);
      float lowF = plate * (1.0 - 0.75 * dep), topF = plate * (1.0 - 0.18 * dep);
      float face = mix(lowF, topF, 1.0 - (1.0 - uf) * (1.0 - uf));
      float lr = clamp(0.15 * Wb, 1.5, 3.0), nd = 0.3 * (topF - floorV);
      float el = clamp(1.0 - (1.0 - s) * Wb / lr, 0.0, 1.0);   // into the lip, 0 → 1 at the blade's top end
      face -= nd * (1.0 - sqrt(max(1.0 - el * el, 0.0)));
      float k = clamp((s - g) * Wb + 0.5, 0.0, 1.0);
      f = mix(floorV, face, k);
      innerP = mix(floorV, plate * mix(0.7, 1.0, uf) * (1.0 - 0.35 * el * el), k);
      hi = topF - nd;
    } else if (u_mode == 1) {
      // Sunken fin: from the floor at its open side up toward the plate (0 = a rounded bar).
      float x = 2.0 * tb - 1.0;
      f = plate * (1.0 - dep * (1.0 - mix(sqrt(max(1.0 - x * x, 0.0)), s, sl)));
      hi = plate * (1.0 - dep * (1.0 - sl));
    } else {
      // Pressed hood: a narrow dark slit under its lip (the first 25 % of the blade), then the hood from the lip, Hood
      // rise above the plate, down to the plate at its hinge in a crease (slant 0 = domed, 1 = straight). Towards its
      // ends the shell curves down to the plate (a quarter round over about half the blade's width), meeting it at the
      // opening's outline.
      float hu = clamp((s - 0.25) / 0.75, 0.0, 1.0);
      float hood = mix(1.0 - hu * hu, 1.0 - hu, sl);
      float ew = max(min(0.6 * Wb, 0.25 * L), 1.0);
      float ee = full ? 1.0 : clamp((0.5 * L - abs(q.x - bestC.x)) / ew, 0.0, 1.0);
      hood *= sqrt(max(1.0 - (1.0 - ee) * (1.0 - ee), 0.0));
      f = mix(floorV, plate + max(u_rise, 0.0) * hood, clamp((s - 0.25) * Wb + 0.5, 0.0, 1.0));
      hi = plate;
      top = max(top, u_field_level + max(u_rise, 0.0));
    }
    // Where one blade meets the next the profile jumps from one end to the other: blend that step over a pixel.
    if (B > 1.0) {
      float a0 = kb > 0.0 ? clamp(tb * Wb + 0.5, 0.0, 1.0) : 1.0;
      float a1 = kb < B - 1.0 ? clamp((1.0 - tb) * Wb + 0.5, 0.0, 1.0) : 1.0;
      f = mix(up ? floorV : hi, mix(up ? hi : floorV, f, a0), a1);
      if (innerP >= 0.0) innerP = mix(up ? floorV : plate, mix(up ? plate : floorV, innerP, a0), a1);
    }
    inner = f;
  }
  // Slot rim, on the plate outside the opening: a chamfer from the opening's edge up to the plate (with a bead: in its
  // first third, the bead rising on the rest).
  float outV = plate;
  float rim = max(u_rim, 0.0);
  if (rim > 0.0 && u_profile != 0) {
    float xo = clamp(best / rim, 0.0, 1.0);
    float bead = max(u_bead, 0.0);
    outV = mix(inner, plate, profileCurve(u_profile, bead > 0.0 ? min(xo / 0.35, 1.0) : xo));
    if (bead > 0.0) {
      outV += bead * smoothstep(0.0, 0.35, xo) * (1.0 - smoothstep(0.35, 1.0, xo));
      top = max(top, u_field_level + bead);
    }
  }
  float cov = grb_cov(best);
  float v = mix(outV, inner, cov);
  // The paint: the height, but for blade faces (metal) and fasteners; hoods and beads above 1 paint as the frame.
  float pv = innerP >= 0.0 ? mix(outV, innerP, cov) : v;
  if (u_plugs && plug < 1e8) {
    // Missing openings as blanking plugs: flush but for a slight dip, their outline a fine seam.
    float sw = max(1.0, 0.1 * W);
    float dip = plate * (0.04 * grb_cov(plug) + 0.2 * grb_cov(abs(plug) - 0.5 * sw)) * (1.0 - cov);
    v -= dip;
    pv -= dip;
  }
  if (m > 0.0 && u_fasteners > 0) {
    // Fasteners on the centre line of the frame's flat (between the outer bevel and the step to the field): at the
    // corners (round the bend of rounded ones), and the middle of each side. Their radius keeps to 0.3 × the flat (at
    // least 1.25 px, so narrow frames keep small heads).
    float fo = shaped ? min(max(u_outer, 0.0), 0.5 * m) : 0.0;
    float fw = max(m - fo - min(max(u_bevel, 0.0), 0.5 * m), 1.0);   // the flat's width ('flat' is a GLSL keyword)
    float bm = fo + 0.5 * fw;   // the flat's centre line, from the tile edge
    float c = rr > 0.0 ? m + rr - (rr + m - bm) * 0.70710678 : bm;
    bool lx = q.x < 0.5 * res.x, ly = q.y < 0.5 * res.y;
    vec2 F = vec2(lx ? c : res.x - c, ly ? c : res.y - c);
    if (u_fasteners == 2) {
      vec2 Fx = vec2(0.5 * res.x, ly ? bm : res.y - bm);
      vec2 Fy = vec2(lx ? bm : res.x - bm, 0.5 * res.y);
      if (distance(q, Fx) < distance(q, F)) F = Fx;
      if (distance(q, Fy) < distance(q, F)) F = Fy;
    }
    float fr = clamp(u_fast_size, 0.5, max(0.3 * fw, 1.25));
    F = vec2(grb_snapC(F.x, 2.0 * fr), grb_snapC(F.y, 2.0 * fr));
    vec2 fd = q - F;
    // The head (greebleCommon: FASTENER_HEADS), turned at random per fastener; the sunk kinds in a counterbore.
    float a = hashI(ivec2(floor(F)), uSeed + 13.0) * 3.1415927;
    vec3 fz = grb_fastener(u_fast_style, rot2(a) * fd, fr, 0.5);
    float head = max(fz.x, 0.0);
    // Steel heads shaded by their height, slots, sockets and holes dark.
    pv = mix(pv, 0.5 + 0.45 * head - 0.4 * fz.y, grb_cov(fz.z));
    // A dark seat ring round each head, slightly sunk.
    float seat = grb_cov(abs(fz.z - 0.5) - 0.6) * (1.0 - grb_cov(fz.z));   // (round the head, or its counterbore)
    pv = mix(pv, 0.3, seat);
    v -= 0.06 * seat;
    v = fz.x > 0.0 ? max(v, plate + 0.6 * fz.x) : v + 0.6 * fz.x;
    top = max(top, 1.6);
  }
  // Height: normalised by the highest the relief can reach; the paint keeps the frame at 1 whatever rises above it.
  float hgt = clamp(v / top, 0.0, 1.0);
  v = clamp(pv, 0.0, 1.0);
  // One random per slot inside it; the plate is one piece (so Diffuse's Colour variation and Random don't tile it per slot).
  float rnd = best < 0.0 ? bestRnd : 0.5;
  GenOut o;
  if (u_mask == 0) o = genOut(v, 1.0, rnd, NO_SDF);
  else o = genOutOwn(v, 1.0, rnd, u_mask == 1 ? max(-best, dO) : u_mask == 2 ? best : dFrame);
  o.hval = hgt;
  // The relief's random belongs to the slots but its value spans the plate: Per-feature variation would step the plate
  // per slot (Depth variation varies the slots instead).
  o.feat = 0.0;
  return o;
}
`
};

// ------------------------------------------------------------------------------------------------ pipes

/** The planned jogs (pipesJogs.ts), memoised by the params they read: a colour or Height slider keeps the texture. */
const jogTexture = memoReads(planJogs);

export const pipesLayer: LayerDef = {
	type: 'pipes',
	label: 'Pipes & conduits',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Pipes & conduits: Made from runs of parallel round pipes or flat conduits, optionally bundled, with couplings, flanges or welds, clamp straps and jogs. Paints only the pipes and clamps, so the wall comes from the layers below. Makes pipework, cable trunking and industrial walls.',
	params: [
		P.enum('orient', 'Direction', 'horizontal', ORIENT),
		P.enum('shape', 'Pipe shape', 'round', [
			['round', 'Round pipe'],
			['conduit', 'Flat conduit (bevel)']
		]),
		P.float('crown', 'Crown', 0.4, 0, 1, {
			step: 0.001,
			showIf: isConduit,
			hint: 'Domes the conduit’s top (0 = flat, 1 = 30 % higher in the middle than at its edges)'
		}),
		P.bool('lid', 'Lid seams', true, {
			showIf: isConduit,
			hint: 'Adds a seam along each side of the conduit’s top, where its lid sits'
		}),
		P.int('count', 'Runs across', 3, 1, 256, { softMax: 64, hint: 'How many pipes (or bundles) go across the tile' }),
		P.int('bundle', 'Fewest pipes per run', 1, 1, 8, {
			join: { with: 'bundle_max', as: 'pair', label: 'Pipes per run · min · max' },
			hint: 'How many pipes run side by side in each run: each run takes a random number from min to max'
		}),
		P.int('bundle_max', 'Most pipes per run', 1, 1, 8),
		P.float('bundle_gap', 'Bundle gap', 0, 0, 256, {
			softMax: 32,
			unit: 'px',
			axis: ORIENT_ACROSS,
			step: 0.5,
			showIf: (p) => pipesMax(p) > 1,
			hint: 'Leaves space between the pipes of a bundle (0 = touching)'
		}),
		P.float('diameter', 'Diameter', 8, 1, 1024, {
			softMax: 256,
			unit: 'px',
			axis: ORIENT_ACROSS,
			step: 0.5,
			hint: 'Sets the pipe diameter, capped so the runs (with the most pipes per run) fit side by side in their spacing (tile ÷ Runs across)'
		}),
		P.float('dia_var', 'Diameter variation', 0.35, 0, 0.9, {
			step: 0.001,
			hint: 'Makes some runs thinner at random (0 = all the same, 0.9 = some runs a tenth as thick)'
		}),
		P.float('pipe_var', 'Per-pipe variation', 0, 0, 0.9, {
			step: 0.001,
			showIf: (p) => pipesMax(p) > 1,
			hint: 'Makes each pipe in a bundle a random amount thinner, kept centred in its place'
		}),
		P.float('jitter', 'Position jitter', 2, 0, 256, {
			softMax: 64,
			unit: 'px',
			axis: ORIENT_ACROSS,
			step: 0.5,
			hint: 'Shifts each run across by a random amount, at most into the free space beside it, so runs may touch but never overlap'
		}),
		P.float('offset', 'Run offset', 0, 0, 1, {
			step: 0.001,
			hint: 'Shifts all the runs across, as a fraction of their spacing'
		}),
		P.enum(
			'scale',
			'Relief height',
			'true',
			[
				[
					'unit',
					'Tallest pipe = Amount',
					'the relief runs 0..1: the tallest pipe (with its clamps) rises by the Height amount, whatever its size. Levels and Gamma don’t apply'
				],
				[
					'true',
					'True to size',
					'heights in px, from each pipe’s radius: Height amount 1 = round pipes as tall as their radius (the project’s Height depth converts it), 0.5 = half as tall, so big pipes stay round at any size. Levels and Gamma don’t apply'
				]
			],
			{
				hint: 'Picks how the relief’s heights are scaled'
			}
		),
		PIPE_PARTS.param,

		P.seed(),
		P.int('joints', 'Joints', 1, 0, 64, {
			softMax: 16,
			group: 'joints',
			hint: 'Places this many joints on each pipe along the tile (0 = none), at a random spot on each run'
		}),
		P.bool('j_coupling', 'Couplings', true, {
			group: 'joints',
			showIf: jointsOn,
			hint: 'Sleeves about 0.7 diameters long: chamfered shoulders, a groove near each end. Tick more than one kind to mix them: each joint takes one of the ticked kinds at random'
		}),
		P.bool('j_flange', 'Flanges', false, {
			group: 'joints',
			showIf: jointsOn,
			hint: 'Pairs of discs standing well proud, a seam between. Tick more than one kind to mix them: each joint takes one of the ticked kinds at random'
		}),
		P.bool('j_weld', 'Welds', false, {
			group: 'joints',
			showIf: jointsOn,
			hint: 'Raised, rippled beads round the pipe. Tick more than one kind to mix them: each joint takes one of the ticked kinds at random'
		}),
		P.bool('flange_bolts', 'Flange bolts', true, {
			group: 'joints',
			showIf: (p) => jointsOn(p) && p.j_flange === true,
			hint: 'Adds bolts through the flanges, seen from the side: each stands out of the flange pair along the pipe, its rounded head on one side'
		}),
		P.float('joint_size', 'Joint size', 1, 0.25, 4, {
			step: 0.01,
			group: 'joints',
			showIf: jointsOn,
			hint: 'Scales the joint, which is already sized in proportion to its pipe'
		}),
		P.float('joint_jitter', 'Joint shift variation', 1, 0, 1, {
			step: 0.001,
			group: 'joints',
			showIf: jointsOn,
			hint: 'Shifts the joints of each run along by a random amount, as a fraction of their spacing (0 = all in line). In a bundle the joints are staggered: each pipe’s joint sits a joint’s length plus a gap along from its neighbour’s. Joints keep clear of the clamps (centred between two when the gap is short) and are left off the jogs'
		}),
		P.float('joint_spread', 'Joint pitch variation', 0.5, 0, 1, {
			step: 0.001,
			group: 'joints',
			showIf: (p) => Number(p.joints) > 1,
			hint: 'Moves each joint along the pipe by a random amount, so they aren’t evenly spaced (1 = up to ± 0.3 of their spacing)'
		}),
		P.int('clamps', 'Clamps', 2, 0, 256, {
			softMax: 32,
			group: 'clamps',
			hint: 'Places this many clamp straps on each pipe along the tile (0 = none)'
		}),
		P.float('clamp_width', 'Clamp width', 3, 1, 256, {
			softMax: 64,
			unit: 'px',
			axis: ORIENT_ALONG,
			step: 0.5,
			group: 'clamps'
		}),
		P.float('clamp_lip', 'Clamp thickness', 1, 0, 64, {
			softMax: 24,
			unit: 'px',
			step: 0.5,
			group: 'clamps',
			hint: 'Sets how far the strap stands proud of the pipe (its thickness)'
		}),
		P.float('clamp_foot', 'Clamp feet', 2, 0, 256, {
			softMax: 64,
			unit: 'px',
			axis: ORIENT_ACROSS,
			step: 0.5,
			group: 'clamps',
			hint: 'Adds flat tabs where the strap meets the wall, reaching this far past the run’s sides (0 = a plain ring)'
		}),
		P.bool('bolts', 'Clamp bolts', true, {
			group: 'clamps',
			showIf: (p) => Number(p.clamp_foot) > 0,
			hint: 'Adds a bolt head on each foot'
		}),
		P.float('clamp_offset', 'Clamp offset', 0, 0, 1, {
			step: 0.001,
			group: 'clamps',
			hint: 'Shifts the straps along the pipes, as a fraction of their spacing'
		}),
		P.float('clamp_jitter', 'Clamp shift variation', 0, 0, 1, {
			step: 0.001,
			group: 'clamps',
			hint: 'Shifts the straps of each run along by a random amount, as a fraction of their spacing (0 = all in line, as on shared supports). Straps are left off the jogs'
		}),
		P.bool('clamp_seeded', 'Shift with the seed', true, {
			group: 'clamps',
			hint: 'Lets the seed move all the straps along the pipes too, so each seed puts the supports somewhere else'
		}),
		P.bool('clamp_rel', 'Scale with each pipe', true, {
			group: 'clamps',
			hint: 'Shrinks the clamps on thinner runs (Diameter variation) to match. Clamp width, Clamp thickness and Clamp feet are set for a pipe of the full Diameter'
		}),
		P.float('jog_chance', 'Jog chance', 0, 0, 1, {
			step: 0.001,
			group: 'jogs',
			hint: 'The share of runs that jog: step aside through a pair of bends, run on, and step back further along (0 = none, 1 = every run)'
		}),
		P.enum(
			'jog_angle',
			'Jog bends',
			'90',
			[
				['90', '90°', 'square bends: the run steps straight across'],
				['45', '45°', 'the run crosses over on a diagonal'],
				['mixed', 'Mixed', 'each jog 90° or 45° at random']
			],
			// (Read by the jog planner on the CPU: pipesJogs.ts.)
			{ group: 'jogs', showIf: jogsOn, uniform: false }
		),
		P.float('jog_amount', 'Jog amount', 0.2, 0, 0.5, {
			step: 0.001,
			group: 'jogs',
			showIf: jogsOn,
			hint: 'The most a run steps aside, as a fraction of the tile across the runs: each jog moves a random amount up to this (but at least enough to fit its bends), and the run steps back by as much further along'
		})
	],
	groups: [
		{ id: 'joints', label: 'Joints' },
		{ id: 'clamps', label: 'Clamps' },
		{ id: 'jogs', label: 'Jogs' }
	],
	maskWrite: PIPE_PARTS.write,
	// What of the relief goes to a mask (Write to › Source).
	maskSources: PIPE_PARTS.sources,
	defaults: {
		h_on: true,
		h_amount: 0.5,
		bevel: 2,
		profile: 'round',
		dif_on: true,
		dif_src: 'value',
		// Dark at the pipes' edges, brighter metal on top (the layer paints only the pipes and clamps).
		dif_grad: gradient('#29251d', '#5d5448', '#8f826b', '#cbb693'),
		// Satin metal, by Source › Shape.
		r_on: true,
		r_src: 'shape',
		r_a: 0.75,
		r_b: 0.4,
		mt_on: true,
		mt_src: 'shape'
	},
	// A new layer in the editor: runs about 110 px apart (at least three) with a jitter of 12 % of the spacing, pipes
	// half the spacing thick, clamps and joints in proportion.
	fresh: ({ height }) => {
		const count = Math.min(24, Math.max(height < 48 ? 2 : 3, Math.round(height / 110)));
		const per = height / count;
		const d = Math.max(3, Math.round(per * 0.5));
		return {
			count,
			diameter: d,
			jitter: Math.round(per * 0.12),
			joints: d >= 8 ? 1 : 0,
			clamp_width: Math.max(2, Math.round(d * 0.25)),
			clamp_lip: r1(Math.max(1, d * 0.08)),
			clamp_foot: d >= 8 ? Math.round(d * 0.3) : 0, // no feet on tiny pipes (they'd crowd the strap)
			bevel: Math.max(2, Math.round(d * 0.15))
		};
	},
	textures: ['jogs'],
	cpuData: (q, ctx) => ({ jogs: jogTexture(q, ctx) }),
	glsl:
		GRB_GLSL +
		GLSL_PRIMTEX +
		/* glsl */ `
// Cross-section height (px) at y across a pipe of radius R: a half-cylinder, or a bevelled slab (conduit) with a crown.
float pp_sec(float R, float y) {
  if (u_shape == 0) return sqrt(max(R * R - y * y, 0.0));
  // The crown domes the top from the bevel's inner edge (1 there) to 1 + 0.3 × Crown in the middle.
  float yy = min(abs(y) / max(R - u_bevel, 1.0), 1.0);
  return R * grb_rise(abs(y) - R, u_bevel) * (1.0 + 0.3 * u_crown * (1.0 - yy * yy));
}

// A run k's place across: its pipes' place (Diameter variation), the start of its bundle (shifted by the jitter within
// its spacing), the bundle's width and its number of pipes (Pipes per run, min to max at random).
vec4 pp_run(int k, int n, float per, float D0, float gap) {
  int kw = wrapCell(k, n);
  vec2 h = hash2I(ivec2(kw, 0), uSeed);
  float Ds = u_dia_var > 0.0 ? max(floor(D0 * (1.0 - u_dia_var * h.x) + 0.5), 1.0) : D0;
  int lo = max(min(u_bundle, u_bundle_max), 1), span = max(max(u_bundle, u_bundle_max), 1) - lo;
  float nb = float(lo) + min(floor(hashI(ivec2(kw, 9), uSeed) * float(span + 1)), float(span));
  float tot = Ds * nb + gap * (nb - 1.0);
  float cy = (float(k) + 0.5 + u_offset) * per + (h.y - 0.5) * 2.0 * min(u_jitter, 0.5 * max(per - tot, 0.0));
  return vec4(Ds, grb_snapC(cy, tot) - 0.5 * tot, tot, nb);
}

// Pipe jj of run kw's bundle of nb (its pipes' place Ds, the bundle from y0, pitch apart): its diameter (Per-pipe
// variation) and its centre across.
vec2 pp_pipe(int kw, float jj, float nb, float Ds, float y0, float pitch) {
  float D = Ds;
  if (u_pipe_var > 0.0 && nb > 1.0) D = max(floor(Ds * (1.0 - u_pipe_var * hashI(ivec2(kw * 8 + int(jj), 5), uSeed)) + 0.5), 1.0);
  float c = y0 + jj * pitch + 0.5 * Ds;
  return vec2(D, D < Ds ? grb_snapC(c, D) : c);
}

// Joint kinds (Couplings, Flanges, Welds): 0 a coupling sleeve, 1 a flange pair, 2 a weld bead.
bool pp_kindOn(int st) { return st == 0 ? u_j_coupling : st == 1 ? u_j_flange : u_j_weld; }
// A joint's kind, picked by h among the ticked ones (-1: none ticked).
int pp_kind(float h) {
  int nk = int(u_j_coupling) + int(u_j_flange) + int(u_j_weld);
  int pick = min(int(h * float(nk)), nk - 1), st = -1, c = 0;
  for (int t = 0; t < 3; t++) {
    if (pp_kindOn(t)) {
      if (c == pick) st = t;
      c++;
    }
  }
  return st;
}
// A joint's lip ÷ its pipe's diameter (Joint size js).
float pp_jk(int st, float js) { return (st == 0 ? 0.07 : st == 1 ? 0.28 : 0.06) * js; }
// A joint's half length along a pipe D px thick: a coupling's sleeve, the two flange discs, a weld bead.
float pp_jointLen(int st, float D, float js) {
  return st == 0 ? 0.35 * js * D : st == 1 ? max(0.12 * js * D, 1.0) + 0.5 : 0.5 * max(0.12 * js * D, 2.0);
}
// A flange bolt's radius on a pipe D px thick, and how far it stands out past the flanges' faces.
float pp_boltR(float D) { return max(1.0, 0.07 * D); }
float pp_boltL(float D) { return 2.0 * pp_boltR(D); }

// Run kw's record i (pipesJogs.ts: JOG_STRIDE floats a row).
float pp_rec(int kw, int i) { return texF32(t_jogs, ivec2(i, kw)); }
// Whether a fitting at x along run kw, reaching e px each way, would stand on one of its nk fitting-free stretches.
bool pp_keptOff(int kw, int nk, float x, float e, float W) {
  bool off = false;
  for (int i = 0; i < nk; i++) {
    float dx = x - pp_rec(kw, 8 + 2 * i);
    dx -= W * floor(dx / W + 0.5);
    off = off || abs(dx) < pp_rec(kw, 9 + 2 * i) + e;
  }
  return off;
}

// A jog's step (seen from its centre at x 0, the run's level before it at y 0): the run rises s px (either sign) through
// two bends of a (0: 90°, 1: 45°), bend radius rf. Returns the signed distance to the run's centre line (+ toward +y),
// the x of its nearest point, and the plain distance. The step is symmetric about its middle M, so one half (the
// straight in, the first bend, half the leg) gives the distance, from p and from p turned about M (one loop).
vec3 pp_jog(vec2 p, float s, float a, float rf) {
  float sg = s < 0.0 ? -1.0 : 1.0;
  s = abs(s);
  p.y *= sg;
  vec2 cs = a > 0.5 ? vec2(0.7071068) : vec2(0.0, 1.0);   // the leg's direction
  float tb = (a > 0.5 ? 0.4142136 : 1.0) * rf;            // the bend's tangent length, rf · tan(θ / 2)
  vec2 M = vec2(0.0, 0.5 * s);
  vec2 C = vec2(-0.5 * s * a - tb, rf);                    // the first bend's centre (cot θ = a)
  vec2 T = vec2(-0.5 * s * a, 0.0) + tb * cs;              // where it meets the leg
  float len = max(dot(M - T, cs), 0.0);
  vec3 best = vec3(0.0, 0.0, 1e9);
  for (int h = 0; h < 2; h++) {
    vec2 q = h == 0 ? p : 2.0 * M - p;
    // The straight in, before the bend.
    vec3 r = vec3(q.y, min(q.x, C.x), length(vec2(max(q.x - C.x, 0.0), q.y)));
    // The bend: from straight down of its centre round to the leg's direction.
    vec2 w = q - C;
    float rho = max(length(w), 1e-4);
    if (w.x >= 0.0 && -w.x * cs.x - w.y * cs.y >= 0.0 && abs(rho - rf) < r.z)
      r = vec3(rf - rho, C.x + rf * w.x / rho, abs(rho - rf));
    // The leg, to the middle.
    float tau = clamp(dot(q - T, cs), 0.0, len);
    vec2 cp = T + tau * cs;
    float dd = length(q - cp);
    if (dd < r.z) r = vec3(dot(q - T, vec2(-cs.y, cs.x)), cp.x, dd);
    if (h == 1) r.xy = -r.xy;   // turned back: the other side, and x mirrored about M (x 0)
    if (r.z < best.z) best = r;
  }
  best.x *= sg;
  return best;
}

GenOut gen(vec2 p) {
  // Local frame: x along the pipes, y across.
  bool vert = u_orient == 1;
  vec2 res = vert ? uRes.yx : uRes;
  vec2 q = vert ? p.yx : p;
  int n = max(u_count, 1);
  int nbMax = max(max(u_bundle, u_bundle_max), 1);
  float per = res.y / float(n);
  float gap = nbMax > 1 ? max(u_bundle_gap, 0.0) : 0.0;
  float D0 = clamp(u_diameter, 1.0, max(floor((per - gap * float(nbMax - 1)) / float(nbMax)), 1.0));   // runs fit their spacing
  float lip0 = max(u_clamp_lip, 0.0);
  float foot0 = max(u_clamp_foot, 0.0);
  float sp = res.x / float(max(u_clamps, 1));
  // Joints in proportion to each pipe; the biggest of the ticked kinds sets the reach and the relief's scale.
  float js = max(u_joint_size, 0.05);
  float jkMax = 0.0;
  for (int t = 0; t < 3; t++) if (pp_kindOn(t)) jkMax = max(jkMax, pp_jk(t, js));
  bool jOn = u_joints > 0 && jkMax > 0.0;
  float jLip0 = jOn ? jkMax * D0 : 0.0;
  float Rmax = (0.5 * D0 + max(lip0, jLip0)) * (u_shape == 1 ? 1.0 + 0.3 * u_crown : 1.0);
  bool trunk = u_shape == 1;   // conduits are trunking: saddle-band straps painted like them, lipped covers
  // The straps shifted as a whole by the seed (Shift with the seed).
  float phS = u_clamp_offset + (u_clamp_seeded ? hashI(ivec2(7, 7), uSeed) : 0.0);
  // Jogs: the most a run can step aside (Jog amount, or the least step its bends need).
  bool jogs = u_jog_chance > 0.0 && u_jog_amount > 0.0;
  float jogReach = jogs ? max(floor(u_jog_amount * res.y + 0.5), ceil(per + max(2.0, 0.5 * D0))) + 1.0 : 0.0;
  // Runs whose pipes, joints, straps, feet and jogs can reach this pixel: the neighbours (K0), more for wide feet or
  // flanges, and further for jogs (a bound from uniforms keeps the loop rolled). Past K0 only a run whose jog reaches the
  // pixel is evaluated: reach0 past its bundle's sides, either side of its levels.
  int K0 = 1 + int(min(ceil((lip0 + foot0 + jLip0) / per), 3.0));
  int K = K0 + int(ceil(jogReach / per));
  float reach0 = max(lip0 + foot0, jLip0) + 2.0;

  int k0 = int(floor(q.y / per - u_offset));
  float dP = 1e9, dC = 1e4, dJ = 1e4, hBest = 0.0, pBest = 0.0, dSel = 1e9, rnd = 0.0;
  // The runs k0 - K … k0 + K, each between its neighbours (whose room limits its feet): a sliding window over the runs,
  // each placed once (one copy of pp_run in the shader).
  vec4 runP = vec4(0.0), run = vec4(0.0), runN = vec4(0.0);
  for (int i = -K - 1; i <= K + 1; i++) {
    runP = run;
    run = runN;
    runN = pp_run(k0 + i, n, per, D0, gap);
   if (i > -K) {
    int k = k0 + i - 1;
    int kw = wrapCell(k, n);
    float Ds = run.x, y0 = run.y, tot = run.z, nb = run.w;
    float pitch = Ds + gap;
    float bc = y0 + 0.5 * tot;

    // The run's jog and fitting-free stretches, planned on the CPU (pipesJogs.ts) so that runs only meet where straight
    // lengths cross: it steps aside by sj px at xj.x and back at xj.y, each step through two bends of 90° or 45° (ja: 0 /
    // 1), bend radius rf. nk stretches keep its joints and clamps off (its bends, and where others cross or pass close).
    bool rec = jogs && kw >= 0 && kw < n;
    float sj = rec ? pp_rec(kw, 0) : 0.0;
    float band = 0.5 * tot + reach0;
   if (abs(k - k0) <= K0 || (sj != 0.0 && q.y > min(bc, bc + sj) - band && q.y < max(bc, bc + sj) + band)) {
    vec2 xj = vec2(0.0), ja = vec2(0.0), rf = vec2(0.0);
    int nk = 0;
    if (rec) {
      xj = vec2(pp_rec(kw, 1), pp_rec(kw, 2));
      ja = vec2(pp_rec(kw, 3), pp_rec(kw, 4));
      rf = vec2(pp_rec(kw, 5), pp_rec(kw, 6));
      nk = int(pp_rec(kw, 7));
    }
    // This pixel in the run's frame (fq): along it, and across it as if it ran straight at its own level. On a jog the
    // nearer step (round the tile) gives both, from the distance to its centre line.
    vec2 fq = q;
    if (sj != 0.0) {
      vec2 X = q.x - xj;
      X -= res.x * floor(X / res.x + 0.5);
      bool a = abs(X.x) <= abs(X.y);
      float Xs = a ? X.x : X.y;
      vec3 f = pp_jog(vec2(Xs, q.y - (a ? bc : bc + sj)), a ? sj : -sj, a ? ja.x : ja.y, a ? rf.x : rf.y);
      fq = vec2(q.x + f.y - Xs, bc + f.x);
    }

    float jj = clamp(floor((fq.y - y0 + 0.5 * gap) / pitch), 0.0, nb - 1.0);
    int pid = kw * 8 + int(jj);
    vec2 pc = pp_pipe(kw, jj, nb, Ds, y0, pitch);
    float D = pc.x, c = pc.y;
    float y = fq.y - c;
    float r = 0.5 * D;
    float d = abs(y) - r;
    // The run's clamps (Scale with each pipe: in proportion to its pipes, but never below 3 px wide, 1.5 px proud and
    // 3 px feet, and none on runs thinner than 10 px, or than the Diameter if that is less).
    float sc = u_clamp_rel ? Ds / D0 : 1.0;
    float lip = max(lip0 * sc, min(lip0, 1.5)), cw = max(max(u_clamp_width * sc, min(u_clamp_width, 3.0)), 1.0);
    bool clamped = u_clamps > 0 && (!u_clamp_rel || Ds >= min(10.0, D0));
    float R = r + lip;
    float by = abs(fq.y - bc) - 0.5 * tot;   // past the bundle's sides (< 0 within it)
    // Clamp feet reach at most half way to the next run on their side, and are left off where that is too little.
    float foot = max(foot0 * sc, min(foot0, 3.0));
    if (foot > 0.0) {
      vec4 nr = fq.y < bc ? runP : runN;
      float room = fq.y < bc ? y0 - (nr.y + nr.z) : nr.y - (y0 + tot);
      float fit = 0.5 * room - lip - 1.0;
      foot = fit >= max(2.0, 0.4 * foot) ? min(foot, fit) : 0.0;
    }
    float fh = foot > 0.0 ? max(lip, 1.0) : 0.0;   // the feet: flat tabs as thick as the strap

    // Clamp straps: whole-px bands along the run, phase random per run (bundles share straps, feet beyond their sides),
    // none on a jog's bends.
    float da = 1e4, xs = 0.0, ph = phS;
    if (clamped) {
      ph += hashI(ivec2(kw, 3), uSeed) * u_clamp_jitter;
      float i0 = floor(fq.x / sp - ph);
      for (int i = -1; i <= 1; i++) {
        float x0 = floor((i0 + float(i) + ph) * sp + 0.5);
        float di = abs(fq.x - (x0 + 0.5 * cw)) - 0.5 * cw;
        if (di < da && !pp_keptOff(kw, nk, x0 + 0.5 * cw, 0.5 * cw + 1.0, res.x)) { da = di; xs = x0 + 0.5 * cw; }
      }
      dC = min(dC, max(da, by - lip - foot));
    }
    dP = min(dP, d);

    // Joints: on this pixel's pipe and, in a bundle, its neighbours (a sleeve stands over the pipe beside it, each joint
    // its own circle, combined by height); per pipe the two nearest joints (Joint pitch variation can push one across). A
    // bundle's joints are a staggered group: one place per run (Joint shift variation, Joint pitch variation), each pipe a
    // joint's length plus a gap further along, so neighbours never clash; the group keeps clear of the clamps (centred
    // between two where the gap is short). Each joint's kind at random among the ticked; none on a jog's bends. Whole px.
    // One flat loop with a bound from uniforms.
    float hj = 0.0;
    if (jOn) {
      int nl = nb > 1.0 ? 3 : 1;
      float spj = res.x / float(u_joints);
      // The group's step from pipe to pipe, by the run's largest joint (its pipes' place Ds), its direction at random.
      float extS = 0.0;
      for (int t = 0; t < 3; t++)
        if (pp_kindOn(t)) extS = max(extS, pp_jointLen(t, Ds, js) + (t == 1 && u_flange_bolts ? pp_boltL(Ds) : 0.0));
      float stg = nb > 1.0 ? (2.0 * extS + max(3.0, 0.3 * Ds)) * (hashI(ivec2(kw, 6), uSeed) < 0.5 ? -1.0 : 1.0) : 0.0;
      float G = stg * (nb - 1.0);   // from the first pipe's joint to the last's
      float phj = hashI(ivec2(kw, 4), uSeed) * u_joint_jitter;
      for (int e = 0; e < 2 * nl; e++) {
        float jl_ = jj + float(e / 2) - float(nl / 2);
        bool inB = jl_ >= 0.0 && jl_ <= nb - 1.0;   // (a bundle's end pipe has one neighbour)
        jl_ = clamp(jl_, 0.0, nb - 1.0);
        int pl = kw * 8 + int(jl_);
        vec2 pcl = pp_pipe(kw, jl_, nb, Ds, y0, pitch);
        float Dl = pcl.x;
        float yl = fq.y - pcl.y, rl = 0.5 * Dl;
        // A neighbour's joints only where they can reach the pixel, or lie nearer than its own pipe (for the distance).
        bool look = inB && (jl_ == jj || abs(yl) - rl - jkMax * Dl <= max(d, 0.0) + 1.0);
       if (look) {
        // This pipe's joint: the group's centre (nearest group, or the next one), less half the group, plus its step.
        float lo = (jl_ - 0.5 * (nb - 1.0)) * stg;
        float uj = (fq.x - lo) / spj - phj;
        float ij = floor(uj + 0.5) + ((e & 1) == 0 ? 0.0 : (uj > floor(uj + 0.5) ? 1.0 : -1.0));
        // (Its randoms by its index round the tile: the joint past one end is the one at the other.)
        int ijw = wrapCell(int(ij), u_joints);
        int st = pp_kind(hashI(ivec2(pl, ijw + 51), uSeed));
        bool nuts = st == 1 && u_flange_bolts;
        float jl0 = pp_jk(st, js) * Dl;
        float Lh = pp_jointLen(st, Dl, js);
        float ns = pp_boltR(Dl), bl = pp_boltL(Dl);
        // Between dense clamps a coupling shortens to fit the gap (flange discs and welds keep their size).
        if (clamped && st == 0 && nb == 1.0) Lh = min(Lh, max(0.5 * (sp - cw) - max(2.0, 0.1 * Dl), 1.0));
        float ext = nuts ? Lh + bl : Lh;
        float amp = min(0.3 * u_joint_spread, max(0.5 - (0.5 * abs(G) + extS + 1.0) / spj, 0.0));
        float xg = (ij + phj + amp * 2.0 * (hashI(ivec2(kw, ijw + 4099), uSeed) - 0.5)) * spj;
        if (clamped) {
          float xc = floor((floor((xg - 0.5 * cw) / sp - ph + 0.5) + ph) * sp + 0.5) + 0.5 * cw;
          float keep = 0.5 * abs(G) + extS + 0.5 * cw + max(3.0, 0.6 * Ds);   // a clear stretch of pipe between
          if (abs(xg - xc) < keep) xg = xc + (xg < xc ? -1.0 : 1.0) * min(keep, 0.5 * sp);
        }
        float xjn = floor(xg + lo + 0.5);
        if (!pp_keptOff(kw, nk, xjn, ext + 1.0, res.x)) {
          float dx = abs(fq.x - xjn);
          float jl = jl0;
          if (st == 0) {
            // A sleeve: chamfered shoulders, a fine groove near each end.
            jl *= clamp((Lh - dx) / max(0.6 * jl0, 1.0), 0.0, 1.0);
            jl *= 1.0 - 0.35 * grb_cov(abs(dx - 0.72 * Lh) - 0.5) * step(4.0, Lh);
            if (trunk) jl *= mix(0.7, 1.0, grb_cov(Lh - dx - max(1.5, 0.06 * Dl)));   // a cover with a lip at each end
          } else if (st == 1) {
            jl *= 1.0 - grb_cov(dx - 0.5);   // the seam between the two discs
          } else {
            // A rounded bead, rippled round the pipe, unevenly (two ripples, their phases per weld).
            vec2 wph = 6.2831853 * vec2(hashI(ivec2(pl, ijw + 77), uSeed), hashI(ivec2(pl, ijw + 78), uSeed));
            float wa = 6.2831853 * yl / max(1.6 * Lh, 2.0);
            jl *= sqrt(max(1.0 - dx * dx / (Lh * Lh), 0.0)) * (0.85 + 0.1 * sin(wa + wph.x) + 0.05 * sin(2.7 * wa + wph.y));
          }
          float h = pp_sec(rl + jl, yl) * grb_cov(dx - Lh);
          if (nuts) {
            // Bolts through the flange pair on the front of the bolt circle (centre and ± 45°), seen from the side: each a
            // cylinder lying along the pipe, standing out past both faces, its head (on a side at random per joint)
            // rounded over, its other end cut square. Over the discs they're hidden.
            float rb = rl + 0.55 * jl0, yb = 0.7071 * rb;
            float yn = abs(yl) < 0.5 * yb ? 0.0 : sign(yl) * yb;
            float zn = sqrt(max(rb * rb - yn * yn, 0.0));   // the bolt's axis height
            bool head = (fq.x - xjn) * (hashI(ivec2(pl, ijw + 79), uSeed) < 0.5 ? -1.0 : 1.0) > 0.0;
            float u = dx - Lh;   // past the face
            float bL = head ? bl : 0.8 * bl, rc = head ? ns : 0.0;
            vec2 bd = vec2(max(u - (bL - rc), 0.0), yl - yn);
            float db = max(max(length(bd) - ns, u - bL), -u - Lh);
            h = max(h, (zn + sqrt(max(ns * ns - dot(bd, bd), 0.0))) * grb_cov(db));
          }
          hj = max(hj, h);
          dJ = min(dJ, max(dx - ext, abs(yl) - rl - jl0));
        }
       }
      }
    }

    // Heights in px: the pipe (with a trunking lid's seams), the strap hugging it with a fillet into its feet, and the
    // feet's bolts on the wall.
    float hp = pp_sec(r, y);
    if (u_shape == 1 && u_lid) hp -= 0.08 * r * grb_cov(abs(abs(y) - 0.72 * r) - 0.5 * max(1.0, 0.05 * D));
    hp *= grb_cov(d);
    // On trunking (conduits) the strap is a flat saddle band, its edges rounded over.
    float lipS = trunk && clamped ? lip * smoothstep(0.0, max(min(1.5, 0.25 * cw), 0.5), 0.5 * cw - abs(fq.x - xs)) : lip;
    float hc = pp_sec(r + lipS, y);
    float fc = grb_cov(by - lip - foot);
    float feet = fh * fc;
    float bolt = 0.0;
    if (u_bolts && foot >= 3.0 && clamped) {
      float br = max(0.3 * min(foot, cw), 1.25);
      float bl = length(vec2(fq.x - xs, by - lip - 0.5 * foot));
      bolt = (fh + 0.7 * br * grb_dome(bl, br)) * grb_cov(bl - br);
    }
    // (The fillet only where ring and feet meet: a smooth max of the two, on the feet.)
    float kf = max(lip, 1.0);
    float hh = fh > 0.0 ? max(kf - abs(hc - feet), 0.0) / kf : 0.0;
    float strap = max(max(hc, feet) + 0.25 * kf * hh * hh * fc, bolt);
    float ca = clamped ? grb_cov(da) : 0.0;
    float body = max(hp, hj);
    float hr = max(body, strap * ca);
    // The paint follows the height, except on the clamps: with feet the whole strap paints as metal down to the wall
    // (not as wall), its bolts brighter; on trunking (conduits) the straps paint like the
    // conduit, not brighter.
    float sP = foot > 0.0 ? max(hc, bolt > feet ? 0.9 * Rmax : 0.75 * Rmax * fc) : hc;
    if (trunk) sP *= r / max(R, 1e-3);
    float pr = max(body, sP * ca);
    // The highest run shows; off the pipes, the nearest one owns the pixel.
    if (hr > hBest || (hr == hBest && d < dSel)) {
      hBest = hr; pBest = pr; dSel = d;
      rnd = hashI(ivec2(pid, 1), uSeed);
    }
   }
   }
  }

  // The part's shape for the relief's mask (Write to › Source: PIPE_PARTS).
  float dPJ = min(dP, dJ);
  float dSh = u_mask == 1 ? dPJ : u_mask == 2 ? dC : min(dPJ, dC);
  float v = clamp(pBest / Rmax, 0.0, 1.0);
  // The layer paints only the pipes with their joints and the clamps with their feet (anti-aliased): every output, and
  // the opacity, leaves the wall between them to the layers below.
  float cov = grb_cov(min(dPJ, dC));
  GenOut o;
  if (u_mask == 0) o = genOut(v, cov, rnd, NO_SDF);
  else o = genOutOwn(v, cov, rnd, dSh);
  // Height follows the height where the paint doesn't (feet, conduit straps), as the layer's own height: 0 on the wall,
  // so Height's mode (Max, Min, Replace…) and Offset apply on the pipes and clamps alone. True to size: px in
  // Height-depth units; else 0..1, the tallest pipe 1.
  o.height = u_scale == 1 ? hBest / max(uDepth, 1e-3) : clamp(hBest / Rmax, 0.0, 1.0);
  return o;
}
`
};
