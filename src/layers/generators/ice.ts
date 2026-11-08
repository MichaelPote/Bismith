// Ice (FR8.28): a sheet of ice over the layers below — what is under it seen through its rippled surface, bent and
// tinted by its thickness — with cracks at depth, trapped bubbles, feathers of frost and fringes of icicles.
//
// The view of what is below goes through GLSL_TRANSPARENCY like Glass's: the ripples (an fBm at Ripples across) and the
// icicles' round sections bend it (lensShift of their normals), each crack's veil offsets it, and a bubble turns it over.
// Thickness (an fBm at Patches across; Coverage below 1 cuts the sheet into patches along it, thinner and white at their
// edges) picks its colour along Depth colour (thin → deep), which tints what is seen through it and, with Subsurface
// scattering, glows from inside it in the deeper parts; Haze clouds it. Surface bumps add fine relief that catches the
// light, in patches. Part of the colour is transmitted light (gGenTransmit:
// carried as emission, not shaded by the surface), less wherever something white scatters it.
//
// Fill hollows levels the relief below: the ice's top rises from the mean of three rings round the pixel towards their
// highest, and the ice is that much thicker there.
//
// Cracks: a network along the edges of a jittered Voronoi diagram (Cracks across) laid on a warped position (Meander),
// a share of its edges cracked (Network), some only partway from one end, so cracks end against others; Long cracks
// run straight across the whole texture over it; a Star crack's cell bursts from its point in rays towards its
// neighbours. A crack is a plane going down into the ice at an angle: a crisp line of varying width where it meets the
// top, and on some a veil to one side, dimming as it goes deeper, streaked across by hackle marks. Bubbles: one
// per cell where Clustering lets one be — small ones clear beads with a rim and a highlight, large ones flat, frosty
// discs with lumpy outlines — and on Stacks smaller ones nearly behind; Specks are tiny ones. Every crack, bubble and
// speck lies at its own depth (Depth spread): deeper ones are softer, dimmer and bluer, and bubbles and specks move
// with the ripples as seen through them. Frost: patches of blades — one to three from a point, each a curving spine
// with barbs at 60° slanting towards its tip and barbs on the long barbs, longer in the thick of a patch — over a thin
// glaze. Icicles hang from the ledges in the relief below, found as Drips finds them (layers/ledges.ts), at a density
// along them: of random lengths, tapering to a drop, rippled, round in section (Height and refraction), with a milky
// core; the sheet's cracks and frost stay out of them.

import type { Texture } from 'three';
import { P, gradient, halfPx, round1, type ParamValues } from '@/core/params';
import { LEDGE_GLSL, ledgeCells, ledgeParams } from '../ledges';
import type { LayerDef } from '../types';

const icicles = (p: ParamValues) => p.icicles_on === true;
/** Ledge cells along a side of the canvas for Icicle spacing gap (whole numbers, so they tile; the shader mirrors it). */
const iceCells = (side: number, gap: number) => Math.max(1, Math.floor(side / gap + 0.5));

export const iceLayer: LayerDef = {
	type: 'ice',
	label: 'Ice',
	category: 'pattern',
	kind: 'generator',
	description:
		'Ice over the layers below: Made from a clear sheet that refracts and tints what is under it, with cracks at depth, trapped bubbles, frost feathers and hanging icicles. Makes frozen lakes, iced-over floors, frosted panes, icicle fringes.',
	params: [
		P.enum(
			'output',
			'Output',
			'ice',
			[
				[
					'ice',
					'Ice',
					'the layers below seen through the ice, with its cracks, bubbles and frost (Diffuse takes this colour instead of the gradient ramp)'
				],
				['cracks', 'Cracks', '1 on the cracks and their veils'],
				['bubbles', 'Bubbles', '1 on bubbles and specks'],
				['frost', 'Frost', '1 on frost feathers and rime'],
				['icicles', 'Icicles', 'the icicles and ledges, 1 along their middles'],
				['thickness', 'Thickness', 'how thick the ice is: 0 thin … 1 thickest']
			],
			{ hint: 'Picks what the layer puts out' }
		),
		P.bool('sheet', 'Sheet', true, {
			section: 'Ice',
			hint: 'Covers the surface in a sheet of ice; off, only the icicles and their ledges are ice'
		}),
		P.float('cover', 'Coverage', 1, 0, 1, {
			step: 0.001,
			section: 'Ice',
			showIf: (p) => p.sheet !== false,
			hint: 'Share of the surface the sheet covers: below 1 it breaks into patches that thin out and whiten at their edges'
		}),
		P.float('patches', 'Patches across', 3, 0.5, 64, {
			softMax: 16,
			step: 0.01,
			section: 'Ice',
			hint: 'Size of the thick and thin spots, haze clouds and patches: how many fit across the width'
		}),
		P.float('thick', 'Thickness', 0.55, 0, 1, {
			step: 0.001,
			section: 'Ice',
			hint: 'How deep the ice is: how far along Depth colour it goes, how strongly it tints what is below'
		}),
		P.float('thick_var', 'Thickness variation', 0.6, 0, 1, {
			step: 0.001,
			section: 'Ice',
			hint: 'Mixes thin, clear spots with thick, deep ones (0 = even)'
		}),
		P.gradient('depth_grad', 'Depth colour', gradient('#e2f6fb', '#9edfe9', '#45b6d0', '#1f7fb4', '#175c94'), {
			section: 'Ice',
			hint: 'The ice’s colour by its depth, along the gradient ramp from thin (left) to the deepest (right): it tints what is seen through it and, with Subsurface scattering, glows from inside'
		}),
		P.float('sss', 'Subsurface scattering', 0.6, 0, 1, {
			step: 0.001,
			section: 'Ice',
			hint: 'How much light the ice scatters inside instead of letting through: deeper ice shows less of what is below and more of its own Depth colour, glowing from within'
		}),
		P.color('white', 'White', '#eaf4ff', {
			section: 'Ice',
			hint: 'The colour of what scatters light: cracks, bubbles, frost and haze'
		}),
		P.float('haze', 'Haze', 0.3, 0, 1, {
			step: 0.001,
			section: 'Ice',
			hint: 'Milky clouds of fine bubbles inside the ice'
		}),
		P.float('depth', 'Depth spread', 0.6, 0, 1, {
			step: 0.001,
			section: 'Ice',
			hint: 'How deep cracks and bubbles lie: deeper ones are softer, dimmer and bluer, and shift with the ripples above them'
		}),
		P.float('transmit', 'Transmission', 0.6, 0, 1, {
			step: 0.001,
			section: 'Ice',
			hint: 'Share of the clear ice’s colour carried as light passing through it, not shaded by the ice surface; the rest is lit like a surface. Cracks, bubbles and frost are always lit'
		}),

		P.float('fill', 'Fill hollows', 0.9, 0, 1, {
			step: 0.001,
			section: 'Ice',
			hint: 'How far the ice fills the joints and hollows of the relief below to a level top (thicker and bluer there); 0 coats the relief evenly'
		}),
		P.float('fill_w', 'Fill width', 16, 0.5, 128, {
			softMax: 24,
			unit: 'px',
			step: 0.05,
			section: 'Ice',
			showIf: (p) => Number(p.fill) > 0,
			hint: 'Widest hollow the ice fills level'
		}),
		P.float('refraction', 'Refraction', 14, 0, 128, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			section: 'Surface',
			hint: 'How far the ripples and bumps bend the view of what is below where they are steepest'
		}),
		P.float('ripple', 'Ripples', 0.5, 0, 1, {
			step: 0.001,
			section: 'Surface',
			hint: 'How wavy the ice surface is: bends the view and adds gentle relief'
		}),
		P.float('ripple_scale', 'Ripples across', 5, 0.5, 64, {
			softMax: 24,
			step: 0.01,
			section: 'Surface',
			showIf: (p) => Number(p.ripple) > 0,
			hint: 'How many ripples fit across the width'
		}),
		P.float('bumps', 'Surface bumps', 0.5, 0, 1, {
			step: 0.001,
			section: 'Surface',
			hint: 'Fine bumps frozen into the surface, in patches: relief that catches the light in glints, and a fine wobble in the view below'
		}),
		P.float('bump_size', 'Bump size', 12, 1, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.05,
			section: 'Surface',
			showIf: (p) => Number(p.bumps) > 0,
			hint: 'Width of the surface bumps'
		}),
		P.float('light', 'Light from', -45, -180, 180, {
			unit: '°',
			step: 0.1,
			section: 'Surface',
			hint: 'Where the bubbles’ highlights and the icicles’ glints face, clockwise from the top (match the key light)'
		}),

		P.float('cracks', 'Cracks across', 5, 0, 64, {
			softMax: 16,
			step: 0.01,
			section: 'Cracks',
			hint: 'How many cells of the crack network fit across the width (0 = no cracks)'
		}),
		P.float('network', 'Network', 0.75, 0, 1, {
			step: 0.001,
			section: 'Cracks',
			showIf: (p) => Number(p.cracks) > 0,
			hint: 'Share of the network’s edges that crack: low, scattered cracks ending at the others; 1, every cell cracked off'
		}),
		P.float('meander', 'Meander', 0.3, 0, 1, {
			step: 0.001,
			section: 'Cracks',
			showIf: (p) => Number(p.cracks) > 0,
			hint: 'How far the cracks wander from straight lines'
		}),
		P.int('long_cracks', 'Long cracks', 3, 0, 8, {
			section: 'Cracks',
			showIf: (p) => Number(p.cracks) > 0,
			hint: 'Straight cracks running across the whole texture over the network, fading in and out along their length'
		}),
		P.float('crack_star', 'Star cracks', 0.15, 0, 1, {
			step: 0.001,
			section: 'Cracks',
			showIf: (p) => Number(p.cracks) > 0,
			hint: 'Share of the cells that burst out from one point in rays, as from a blow'
		}),
		P.float('crack_bright', 'Crack brightness', 0.9, 0, 2, {
			step: 0.001,
			section: 'Cracks',
			showIf: (p) => Number(p.cracks) > 0
		}),
		P.float('veil', 'Veil', 6, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			section: 'Cracks',
			showIf: (p) => Number(p.cracks) > 0,
			hint: 'Width of the white fracture plane beside each crack, seen at an angle as it goes down into the ice'
		}),
		P.float('crack_shift', 'Offset', 3, 0, 32, {
			softMax: 6,
			unit: 'px',
			step: 0.05,
			section: 'Cracks',
			showIf: (p) => Number(p.cracks) > 0,
			hint: 'How far the view of what is below jumps across a crack’s veil'
		}),

		P.float('bubbles', 'Bubbles', 2, 0, 64, {
			softMax: 16,
			step: 0.01,
			perArea: true,
			section: 'Bubbles',
			hint: 'Bubbles per 64 × 64 px (0 = none)'
		}),
		P.float('bub_size', 'Bubble size', 4, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			section: 'Bubbles',
			showIf: (p) => Number(p.bubbles) > 0,
			hint: 'Radius of the largest bubbles; most are smaller. Large ones are flat, milky discs'
		}),
		P.float('bub_stack', 'Stacks', 0.3, 0, 1, {
			step: 0.001,
			section: 'Bubbles',
			showIf: (p) => Number(p.bubbles) > 0,
			hint: 'Share of bubbles with smaller ones frozen in a column below them, as gas rising through a freezing lake'
		}),
		P.float('specks', 'Specks', 10, 0, 200, {
			softMax: 64,
			step: 0.1,
			perArea: true,
			section: 'Bubbles',
			hint: 'Tiny white specks per 64 × 64 px: fine bubbles and grains of snow (0 = none)'
		}),
		P.float('cluster', 'Clustering', 0.5, 0, 1, {
			step: 0.001,
			section: 'Bubbles',
			hint: 'Gathers bubbles and specks into clouds with clear ice between them'
		}),

		P.float('frost', 'Frost', 0.15, 0, 1, {
			step: 0.001,
			section: 'Frost',
			hint: 'How much of the surface frost feathers cover (0 = none)'
		}),
		P.float('frost_size', 'Feather length', 160, 2, 512, {
			softMax: 128,
			unit: 'px',
			step: 0.5,
			section: 'Frost',
			showIf: (p) => Number(p.frost) > 0,
			hint: 'Length of the longest frost blades; Frost grows them longer in the thick of a patch'
		}),
		P.float('frost_barb', 'Barb spacing', 5, 0.5, 32, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			section: 'Frost',
			showIf: (p) => Number(p.frost) > 0,
			hint: 'Distance between the barbs along each feather'
		}),
		P.float('frost_scale', 'Frost patches across', 3, 0.5, 64, {
			softMax: 16,
			step: 0.01,
			section: 'Frost',
			showIf: (p) => Number(p.frost) > 0 && Number(p.frost) < 1,
			hint: 'How many frosted patches fit across the width'
		}),

		P.bool('icicles_on', 'Icicles', false, {
			uniform: false,
			optimize: false,
			section: 'Icicles',
			hint: 'Grows icicles from the overhangs in the relief below. Needs a variant of the shader, compiled the first time'
		}),
		P.float('icicles', 'Icicle chance', 0.5, 0, 1, {
			gate: { by: 'icicles_on', off: 0 },
			step: 0.001,
			section: 'Icicles',
			showIf: icicles,
			hint: 'Chance that a spot along an overhang (a ledge, as Drips finds them) grows an icicle'
		}),
		P.float('ice_gap', 'Icicle spacing', 12, 1, 512, {
			softMax: 64,
			unit: 'px',
			step: 0.5,
			section: 'Icicles',
			showIf: icicles,
			hint: 'How far apart icicles can hang along a ledge; Icicles picks among those spots'
		}),
		P.float('ice_cluster', 'Icicle clustering', 0.35, 0, 1, {
			step: 0.001,
			section: 'Icicles',
			showIf: icicles,
			hint: 'Gathers the icicles into runs with bare stretches of ledge between (0 = evenly spread)'
		}),
		P.float('ice_len', 'Icicle length', 90, 1, 2048, {
			softMax: 256,
			unit: 'px',
			axis: 'y',
			step: 0.5,
			section: 'Icicles',
			showIf: icicles,
			hint: 'Length of the longest icicles'
		}),
		P.float('ice_len_var', 'Length variation', 0.7, 0, 1, {
			step: 0.001,
			section: 'Icicles',
			showIf: icicles,
			hint: 'Mixes short icicles in with the long ones (0 = all as long as Icicle length)'
		}),
		P.float('ice_w', 'Icicle width', 16, 1, 256, {
			softMax: 48,
			unit: 'px',
			axis: 'x',
			step: 0.05,
			section: 'Icicles',
			showIf: icicles,
			hint: 'Width of the widest icicles at their roots'
		}),
		P.float('ice_ripple', 'Icicle ripples', 0.4, 0, 1, {
			step: 0.001,
			section: 'Icicles',
			showIf: icicles,
			hint: 'Bulges down each icicle, where meltwater froze in rings'
		}),
		P.float('glint', 'Glint', 1, 0, 2, {
			step: 0.001,
			section: 'Icicles',
			showIf: icicles,
			hint: 'A bright line inside each icicle on the side away from the light, where it focuses the light'
		}),
		...ledgeParams({ section: 'Icicles' }, icicles),
		P.seed()
	],
	// The ledges' cells (layers/ledges.ts): each one's strongest ledge pixel, for the icicles to hang from.
	prepare(ctx, layer): Record<string, Texture> {
		const p = layer.params;
		if (!icicles(p)) return {};
		const gap = Math.max(Number(p.ice_gap), 1);
		return { ledges: ledgeCells(ctx, 'ice-ledges', [iceCells(ctx.width, gap), iceCells(ctx.height, gap)]) };
	},
	textures: ['ledges'],
	// Clear ice glossy, frost and haze matte (Roughness and Specular › Parts).
	// The icicles' code is in the shader only for layers with icicles.
	shaderFeatures: (p) => (icicles(p) ? ['ICE_ICICLES'] : []),
	parts: 'each part gets its own level: clear ice is glossy, frost and milky haze are matte',
	defaults: {
		dif_on: true,
		h_on: true,
		h_amount: 0.8,
		r_on: true,
		r_src: 'parts',
		r_a: 0,
		r_b: 1,
		s_on: true,
		s_src: 'parts',
		s_a: 0,
		s_b: 1
	},
	// Added in the editor: lengths sized to the texture (as at 512 px), never under a pixel or two.
	fresh: ({ width, height }) => {
		const k = Math.sqrt(width * height) / 512;
		return {
			refraction: round1(Math.max(2, 14 * k)),
			bump_size: halfPx(12 * k, 2),
			fill_w: halfPx(16 * k, 1.5),
			veil: halfPx(6 * k, 1.5),
			cracks: round1(Math.max(1.5, 5 * Math.min(1, (k * 512) / 320))),
			crack_shift: halfPx(3 * k),
			bub_size: halfPx(4 * k, 1.5),
			frost_size: halfPx(160 * k, 8),
			frost_barb: halfPx(5 * k, 2),
			ice_len: halfPx((90 * height) / 512, 6),
			ice_w: halfPx((16 * width) / 512, 3),
			ice_gap: halfPx((12 * width) / 512, 3)
		};
	},
	glsl:
		LEDGE_GLSL +
		/* glsl */ `
// Long cracks' laps when tiling: (a, b) widths and heights per lap, and (c, d) with a·c + b·d = 1.
const vec4 ICE_LAPS[12] = vec4[12](vec4(1, 0, 1, 0), vec4(0, 1, 0, 1), vec4(1, 1, 1, 0), vec4(1, -1, 1, 0), vec4(2, 1, 1, -1),
  vec4(1, 2, 1, 0), vec4(2, -1, 1, 1), vec4(1, -2, 1, 0), vec4(3, 1, 0, 1), vec4(1, 3, 1, 0), vec4(3, -1, 0, -1), vec4(3, 2, 1, -1));

// A crack's veil at d px from its line, vw wide: the fracture plane seen at an angle, dimming as it goes down, a soft
// shoulder, and a faint line where it ends.
float icVeil(float d, float vw) {
  float x = d / max(vw, 0.3);
  return mix(0.6, 0.2, clamp(x, 0.0, 1.0)) * (1.0 - smoothstep(0.5, 1.0, x)) + 0.2 * exp(-pow((x - 0.85) * vw / 0.8, 2.0));
}

GenOut gen(vec2 p) {
  float la = radians(u_light);
  vec2 L = vec2(sin(la), cos(la));
  // Four fBms (as fbm()): the body's thickness (and the patches it breaks into) and haze at Patches across, the ripples,
  // and the surface bumps (Bump size px across) — one flat loop over all their octaves, so the shader holds one copy of
  // perlinNoise (docs/shader-compilation.md).
  vec2 bc = cellsFor(u_patches, 1.0);
  vec2 rc = cellsFor(u_ripple_scale, 1.0);
  // (The bumps stretched across: melt pits and wind ripples, not orange peel.)
  vec2 kb = cellsFor(uRes.x / max(u_bump_size, 1.0), 1.6);
  vec4 nSum = vec4(0.0), nNorm = vec4(0.0);
  for (int e = 0; e < 11 * UNI_1; e++) {
    int j = e < 3 ? 0 : e < 6 ? 1 : e < 9 ? 2 : 3;
    int o = e < 9 ? e - 3 * j : e - 9;
    vec2 cells = j < 2 ? bc : j == 2 ? rc : kb;
    float f = exp2(float(o));
    float v = perlinNoise((p / uRes * cells + (j == 1 ? 17.31 : 0.0)) * f, uTile ? periodOf(cells) * (1 << o) : NO_PERIOD,
                          uSeed + (j == 0 ? 11.0 : j == 1 ? 23.0 : j == 2 ? 37.0 : 41.0) + float(o) * 31.0);
    vec4 w = vec4(equal(ivec4(j), ivec4(0, 1, 2, 3))) / f;
    nSum += v * w;
    nNorm += w;
  }
  nSum /= nNorm;
  vec2 body = nSum.xy;
  float rh = nSum.z, bn = nSum.w;
  // A ridged share in the ripples: sharper crests, so lines seen through them kink.
  rh = mix(rh, 1.0 - abs(2.0 * rh - 1.0), 0.35);
  float tn = clamp((body.x - 0.5) * 2.2 + 0.5, 0.0, 1.0);
  // The bumps come in patches (with the haze's noise), smooth glassy stretches between.
  float bk = u_bumps * smoothstep(0.45, 0.75, body.y);
  // (Sparse, smooth lenses: the bumps' noise cut off below its upper part.)
  bn = smoothstep(0.5, 0.8, bn);
  // (Derivatives before anything branches.) The ripples' slope, height px per px.
  // The ripples' per ripple (so Refraction is about how far the steeper ones bend the view, however wide they are), the
  // bumps' a finer wobble on top.
  vec2 rg = vec2(dFdx(rh), dFdy(rh)) * (uRes.x / rc.x) * u_ripple + vec2(dFdx(bn * bk), dFdy(bn * bk)) * (0.08 * uRes.x / kb.x);
  float tw = fwidth(tn);
  vec3 nR = slopeNormal(rg);
  // How far the ripples bend the view: deep features are seen this far off, × their depth.
  vec2 rShift = lensShift(nR, u_refraction);

  // The sheet, cut into patches by the thickness below Coverage: thinner towards a patch's edge, with white shore ice.
  bool whole = u_cover >= 1.0;
  float thr = 1.0 - u_cover;
  float sheetCov = !u_sheet ? 0.0 : whole ? 1.0 : clamp((tn - thr) / max(tw, 1e-4) + 0.5, 0.0, 1.0);
  float edgeK = whole ? 1.0 : smoothstep(thr, thr + 0.2, tn);
  float T = u_thick * (1.0 - u_thick_var * (1.0 - tn)) * (0.35 + 0.65 * edgeK);
  float hz = u_haze * smoothstep(0.3, 0.75, body.y) * (0.4 + 0.6 * tn) + (whole ? 0.0 : 0.5 * exp(-max(tn - thr, 0.0) / 0.04));

  // Icicles hang from the ledges in the relief below, as Drips' trails do: the ledge cells (prepare: each Icicle
  // spacing cell's strongest ledge pixel, user px) each grow one by the chance Icicles × how much its drop counts as a
  // ledge × the clustering. Per pixel the cells round its column, from its own row up as far as an icicle reaches. The
  // front one (the highest dome) gives the shape; the coverage is all of them.
  // (iH: the front icicle's height, px — round in section, half as tall as it is wide.)
  float iCov = 0.0, iDome = 0.0, iBest = 0.0, iCore = 0.0, iH = 0.0;
  vec2 iG = vec2(0.0);
#ifdef ICE_ICICLES
  if (u_icicles > 0.0) {
    vec2 cellsL = max(vec2(1.0), floor(uRes / max(u_ice_gap, 1.0) + 0.5));
    vec2 csL = uRes / cellsL;
    vec2 pu = vec2(p.x, uRes.y - p.y);
    ivec2 lc = ivec2(floor(pu / csL));
    int rx = clamp(int(ceil(0.8 * u_ice_w / csL.x)), 1, 3);
    int nxc = 2 * rx + 1;
    int up = clamp(int(ceil((u_ice_len + u_ice_w) / csL.y)), 1, 40);
    vec2 icl = cellsFor(4.0, 1.0);
    for (int e = 0; e < nxc * (up + 1) * UNI_1; e++) {
      ivec2 l = lc + ivec2(e % nxc - rx, -(e / nxc));
      ivec2 lw = wrapCell(l, ivec2(cellsL));
      bool inside = uTile || (l.x >= 0 && l.y >= 0 && float(l.x) < cellsL.x && float(l.y) < cellsL.y);
      vec4 b = texelFetch(t_ledges, lw, 0);
      vec2 src = b.xy + vec2(l - lw) * csL;
      vec4 h = vec4(hash3I(lw, uSeed + 61.0), hashI(lw, uSeed + 67.0));
      float len = u_ice_len * (1.0 - u_ice_len_var * (1.0 - h.x));
      // (Shorter ones are thinner.)
      float wid = u_ice_w * (0.55 + 0.45 * h.y) * mix(0.6, 1.0, h.x);
      // px below its root (user y is down).
      float q = pu.y - src.y;
      if (inside && len > 1.0 && q > -0.5 * wid && q < len + wid) {
        float cl = mix(1.0, 2.0 * smoothstep(0.4, 0.7, valueNoise(src / uRes * icl, periodOf(icl), uSeed + 69.0)), u_ice_cluster);
        float hx = hashI(lw, uSeed + 63.0), chance = u_icicles * ledgeOk(b.z) * cl;
        // A sheet that fills the hollows fills an overhang in by as much as it raises the ground just below it (as
        // Fill hollows does, from four taps Fill width round it) against the overhang's drop: no icicle hangs there.
        float gate = 1.0;
        if (hx < chance && u_sheet && u_fill > 0.0) {
          vec2 gb = vec2(src.x, uRes.y - src.y - u_ledge_reach);
          float hb0 = sampleT(tSurface, gb).r, mx = hb0, mn = 0.0;
          for (int t = 0; t < 4; t++) {
            float hh = sampleT(tSurface, gb + u_fill_w * vec2(t == 0 ? 1.0 : t == 1 ? -1.0 : 0.0, t == 2 ? 1.0 : t == 3 ? -1.0 : 0.0)).r;
            mx = max(mx, hh);
            mn += 0.25 * hh;
          }
          gate = 1.0 - smoothstep(0.3, 1.0, max(mix(mn, mx, u_fill) - hb0, 0.0) / max(b.z, 1e-3));
        }
        if (hx < chance * gate) {
          float f = clamp(q / len, 0.0, 1.0);
          float dx = pu.x - src.x - (h.w - 0.5) * 0.8 * wid * f * f;
          // Tapering to a drop at its tip, with rings of bulges down it; rounded over at its root.
          float rb = max(0.08 * wid, 0.6);
          float qt = max(len - rb, 0.0);
          float rT = max(rb, 0.5 * wid * pow(1.0 - qt / len, 0.65));
          // (The rings' spacing its own, and growing out of a smooth root.)
          float ring = (0.6 + 0.8 * fract(h.z * 7.3)) * (0.8 * wid + 3.0);
          float hw = 0.5 * wid * pow(1.0 - f, 0.65)
                   * (1.0 + u_ice_ripple * 0.45 * smoothstep(0.0, 0.25, f) * sin(q * TAU / ring + 6.0 * h.w) * (0.7 + 0.3 * sin(q * 1.7 / ring + h.y * 9.0)));
          float r = q < qt ? max(hw, rb) : rT;
          vec2 rel = vec2(dx, q < 0.0 ? 2.0 * q : max(q - qt, 0.0)) / max(r, 0.5);
          // (Above its root it fades into the overhang instead of ending in a cap.)
          float c = clamp(0.5 - (length(rel) - 1.0) * r, 0.0, 1.0) * smoothstep(-0.5 * wid, 0.0, q);
          float dm = sqrt(max(1.0 - dot(rel, rel), 0.0));
          // Thinner icicles are lower domes.
          float ws = clamp(r / (0.5 * u_ice_w), 0.25, 1.0);
          if (c * dm * ws > iBest) {
            iBest = c * dm * ws;
            iDome = dm * ws;
            // The round section's slope (height px per px; down the screen is −y), steep at the rims.
            iG = vec2(-rel.x, rel.y) / max(dm, 0.25);
            iCore = exp(-rel.x * rel.x / 0.04) * (1.0 - 0.6 * f) + 0.5 * exp(-q / max(0.3 * wid, 1.0)) * (q > 0.0 ? 1.0 : 0.0);
            // (Rising from nothing above its root, so it merges into the ledge instead of standing on it as a cap.)
            iH = 0.5 * r * dm * c * smoothstep(-0.2 * wid, 0.4 * wid, q);
          }
          iCov = max(iCov, c);
        }
      }
    }
  }
#endif
  float onI = clamp(iCov, 0.0, 1.0);

  // Cracks: a network along the edges of a jittered Voronoi diagram (Cracks across) laid on a meandering position — the
  // nearest site from the 3 × 3 cells, then its edges with the 5 × 5 round it. An edge cracks by its pair's own random
  // (Network), some only from one end partway along; along it the width and brightness vary. A crack is a plane going
  // down at an angle: a bright line and a glow on the edge, and a veil into one of its two cells (the same answer from
  // either side). The three nearest edges count — a bisector's line runs on past its edge, and only near ones are real.
  // A Star crack's cell bursts from its point in rays towards its neighbours, ending at or short of its edges, round a
  // bright core.
  float W = 0.0, Wsum = 0.0, Wd = 0.0, cDist = 1e4, pit = 0.0;
  vec2 shift = vec2(0.0);
  if (u_cracks > 0.0) {
    vec2 cc = cellsFor(u_cracks, 1.0);
    vec2 cpx = uRes / cc;
    ivec2 ncl = ivec2(cc + 0.5);
    float cmin = min(cpx.x, cpx.y);
    vec2 wc = 2.0 * cc;
    vec2 pw = p + warpOffset(p / uRes * wc, periodOf(wc), uSeed + 77.0) * u_meander * 0.6 * cpx;
    float vw0 = max(u_veil, 0.0);
    ivec2 c0 = ivec2(floor(pw / cpx));
    float bd = 1e20;
    ivec2 nc = c0, nk = ivec2(0);
    vec2 si = vec2(0.0);
    bool star = false;
    float starK = 1.0;
    // The cell's two nearest edges, cracked or not (distance, which neighbour); the three nearest cracked ones: distance,
    // line, veil, depth, the view's shift, which neighbour. A veil fades out before the cell's other edges (it is drawn
    // in this cell only), so the edge it goes from has to be known apart from the nearest.
    float dA = 1e4, dB = 1e4;
    int oA = -1;
    float d1 = 1e4, d2 = 1e4, d3 = 1e4, l1 = 0.0, l2 = 0.0, l3 = 0.0, q1 = 0.0, q2 = 0.0, q3 = 0.0, z1 = 0.0, z2 = 0.0, z3 = 0.0;
    vec2 v1 = vec2(0.0), v2 = vec2(0.0), v3 = vec2(0.0);
    int o1 = -1, o2 = -1, o3 = -1;
    // A star's rays: lines, and their veils (faded the same way after the loop).
    float rL = 0.0, rV = 0.0;
    for (int e = 0; e < 34 * UNI_1; e++) {
      if (e < 9) {
        ivec2 c = c0 + ivec2(e % 3, e / 3) - 1;
        ivec2 key = wrapCell(c, ncl);
        vec2 sc = (vec2(c) + 0.5 + (hash2I(key, uSeed + 81.0) - 0.5) * 0.9) * cpx;
        float dd = dot(pw - sc, pw - sc);
        if (dd < bd) { bd = dd; nc = c; nk = key; si = sc; }
        if (e == 8) {
          star = hashI(nk, uSeed + 87.0) < u_crack_star;
          // Each star its own size.
          starK = 0.35 + 0.65 * hashI(nk, uSeed + 88.0);
        }
      } else {
        int o = e - 9;
        ivec2 c = nc + ivec2(o % 5, o / 5) - 2;
        if (c != nc) {
          ivec2 key = wrapCell(c, ncl);
          vec2 sj = (vec2(c) + 0.5 + (hash2I(key, uSeed + 81.0) - 0.5) * 0.9) * cpx;
          float Ld = max(length(si - sj), 1e-4);
          vec2 n = (si - sj) / Ld;
          vec2 mid = 0.5 * (si + sj);
          // Distance to the edge's line (inside this cell ≥ 0), and along it — oriented the same from either side.
          float d = max(dot(pw - mid, n), 0.0);
          bool lo = nk.x < key.x || (nk.x == key.x && nk.y < key.y);
          ivec2 pk = (lo ? nk : key) * 1013 + (lo ? key : nk);
          vec4 hp = vec4(hash3I(pk, uSeed + 83.0), hashI(pk, uSeed + 85.0));
          float along = dot(pw - mid, lo ? vec2(-n.y, n.x) : vec2(n.y, -n.x));
          float dpt = u_depth * hp.w;
          float vwE = vw0 * (0.25 + 1.1 * fract(hp.w * 5.3)) * (1.0 + 0.5 * dpt);
          if (d < dA) { dB = dA; dA = d; oA = o; } else if (d < dB) dB = d;
          if (hp.x < u_network && d < 3.0 + 1.5 * vwE && d < d3) {
            // Partway: from one end, ending in a taper somewhere along the edge.
            float a0 = (fract(hp.z * 7.1) - 0.5) * 0.7 * Ld;
            float part = hp.y < 0.35 ? smoothstep(-0.15 * cmin, 0.15 * cmin, (hp.y < 0.175 ? 1.0 : -1.0) * (along - a0)) : 1.0;
            float vn = valueNoise1(along / (0.25 * cmin), NO_PERIOD.x, pk, uSeed + 89.0);
            // A crisp hairline (a faint glow round it), wider and softer deeper down.
            float wd = mix(0.45, 1.1, vn) * mix(1.0, 1.5, dpt) * mix(0.5, 1.0, part);
            float b = u_crack_bright * mix(1.0, 0.4, dpt) * (0.6 + 0.4 * vn);
            float ln = (exp(-d * d / (wd * wd)) + 0.1 * exp(-d / 2.0)) * part * b;
            // The veil, into one of the two cells, streaked across by hackle marks.
            float hack = 0.85 + 0.15 * sin(along * 0.71 + 20.0 * hp.x) * sin(along * 0.27 + 9.0 * hp.y);
            float vr = (hp.z < 0.5) == lo && fract(hp.x * 13.7) < 0.6 ? icVeil(d, vwE) * part : 0.0;
            float vl = vr * hack * b;
            vec2 sv = n * u_crack_shift * vr;
            if (d < d1) {
              d3 = d2; l3 = l2; q3 = q2; z3 = z2; v3 = v2; o3 = o2;
              d2 = d1; l2 = l1; q2 = q1; z2 = z1; v2 = v1; o2 = o1;
              d1 = d; l1 = ln; q1 = vl; z1 = dpt; v1 = sv; o1 = o;
            } else if (d < d2) {
              d3 = d2; l3 = l2; q3 = q2; z3 = z2; v3 = v2; o3 = o2;
              d2 = d; l2 = ln; q2 = vl; z2 = dpt; v2 = sv; o2 = o;
            } else { d3 = d; l3 = ln; q3 = vl; z3 = dpt; v3 = sv; o3 = o; }
            if (part > 0.5) cDist = min(cDist, d + 4.0 * dpt);
          }
          // A star's ray towards this neighbour (a near one), its own length, a veil to one side.
          if (star && Ld < 1.45 * cmin) {
            // (Straight: measured from the unwarped position.)
            vec2 hr = hash2I(pk, uSeed + 93.0);
            float rl = 0.5 * Ld * (0.15 + 0.85 * hr.x * hr.x) * starK;
            vec2 qs = p - si;
            float al = dot(qs, -n);
            float t = clamp(al / rl, 0.0, 1.0);
            float dr = length(qs + n * t * rl);
            float vr = dot(qs, vec2(-n.y, n.x)) * (hr.y < 0.5 ? -1.0 : 1.0);
            float taper = 1.0 - smoothstep(0.6, 1.0, t);
            float ray = clamp(exp(-dr * dr / 0.5) * mix(0.4, 1.0, taper) * u_crack_bright, 0.0, 1.0);
            rL = 1.0 - (1.0 - rL) * (1.0 - ray);
            // (A veil on two rays in five, only beside the ray, its inner edge soft.)
            if (al > 0.0 && al < rl && fract(hr.x * 7.3) < 0.4)
              rV = max(rV, icVeil(max(vr, 0.0), vw0) * smoothstep(-0.7, 0.7, vr) * taper * u_crack_bright);
            cDist = min(cDist, dr);
          }
        }
      }
    }
    // Each veil fades out over 4 px before the cell's other edges: the nearest one, or the next if it is its own.
    float f1 = smoothstep(0.0, 4.0, o1 == oA ? dB : dA), f2 = smoothstep(0.0, 4.0, o2 == oA ? dB : dA);
    float f3 = smoothstep(0.0, 4.0, o3 == oA ? dB : dA), fS = smoothstep(0.0, 4.0, dA);
    float w1 = clamp(max(l1, q1 * f1), 0.0, 1.0), w2 = clamp(max(l2, q2 * f2), 0.0, 1.0), w3 = clamp(max(l3, q3 * f3), 0.0, 1.0);
    W = 1.0 - (1.0 - W) * (1.0 - w1) * (1.0 - w2) * (1.0 - w3) * (1.0 - rL) * (1.0 - clamp(rV * fS, 0.0, 1.0));
    Wsum += w1 + w2 + w3 + rL;
    Wd += w1 * z1 + w2 * z2 + w3 * z3;
    shift += v1 * f1 + v2 * f2 + v3 * f3;
    // Long cracks: straight across the whole texture — when tiling at a slope that wraps (a widths, b heights per lap,
    // ICE_LAPS), so each is a family of parallel lines — fading in and out along their length. Along a lap they are
    // measured by c·x/W + d·y/H with a·c + b·d = 1: one turn per lap, the same at every copy of a texel.
    for (int e = 0; e < u_long_cracks * UNI_1; e++) {
      vec4 hl = vec4(hash3I(ivec2(e, 7), uSeed + 95.0), hashI(ivec2(e, 7), uSeed + 97.0));
      vec4 lap = ICE_LAPS[int(hl.x * 11.99)];
      vec2 dl = uTile ? lap.xy * uRes : vec2(cos(PI * hl.x), sin(PI * hl.x));
      float ll = length(dl);
      vec2 tg = dl / ll, nl = vec2(-tg.y, tg.x);
      // The spacing of the line's copies: the texture's area over one lap's length.
      float sp = uTile ? uRes.x * uRes.y / ll : 1e9;
      // (Barely meandering: a long crack runs nearly straight.)
      vec2 pl = mix(p, pw, 0.3);
      float dv = dot(pl - hl.yz * uRes, nl);
      float d = abs(dv - sp * floor(dv / sp + 0.5));
      float along = dot(pl, tg);
      float nOn = max(floor(ll / (0.6 * cmin) + 0.5), 1.0);
      float xOn = uTile ? dot(pl / uRes, lap.zw) * nOn : along / (0.6 * cmin);
      float on = smoothstep(0.25, 0.45, valueNoise1(xOn, uTile ? int(nOn) : NO_PERIOD.x, ivec2(e, 9), uSeed + 99.0));
      // Bolder than the network's: a wider line, a broader, brighter veil.
      float wd = mix(0.5, 1.0, 0.5 + 0.5 * sin(TAU * (floor(0.5 * nOn) + 1.0) * xOn / nOn + 7.0 * hl.x));
      float side = (dv - sp * floor(dv / sp + 0.5)) * (hl.w < 0.5 ? 1.0 : -1.0);
      float veil = side > 0.0 ? icVeil(side, 1.3 * vw0) : 0.0;
      float cw = clamp(max(1.3 * exp(-d * d / (wd * wd)) + 0.1 * exp(-d / 2.0), veil) * on * u_crack_bright, 0.0, 1.0);
      W = 1.0 - (1.0 - W) * (1.0 - cw);
      Wsum += cw;
      cDist = min(cDist, d + (1.0 - on) * 1e3);
    }
    // A star's crushed core: a small, dark impact pit.
    if (star) {
      float rs = length(p - si);
      W = 1.0 - (1.0 - W) * (1.0 - clamp(0.6 * u_crack_bright * exp(-rs / (1.5 * starK)), 0.0, 1.0));
      pit = 0.6 * exp(-rs * rs / (2.0 * starK));
    }
  }
  float crackDepth = Wd / max(Wsum, 1e-4);

  // Bubbles: one per cell where Clustering keeps one, and on Stacks (under a large one) up to two smaller ones in a
  // column going down, each clear of the one above and a little deeper.
  float Bv = 0.0, Bsum = 0.0, Bd = 0.0;
  vec2 bshift = vec2(0.0);
  vec2 kc = cellsFor(2.0 * u_patches, 1.0);
  if (u_bubbles > 0.0) {
    vec2 bcc = cellsFor(uRes.x * sqrt(u_bubbles) / 64.0, 1.0);
    vec2 bpx = uRes / bcc;
    ivec2 nb = ivec2(bcc + 0.5);
    float bmin = min(bpx.x, bpx.y);
    ivec2 b0 = ivec2(floor(p / bpx));
    for (int e = 0; e < 27 * UNI_1; e++) {
      int ce = e / 3, st = e - ce * 3;
      ivec2 c = b0 + ivec2(ce % 3, ce / 3) - 1;
      ivec2 key = wrapCell(c, nb);
      vec4 h = vec4(hash3I(key, uSeed + 91.0), hashI(key, uSeed + 93.0));
      vec3 hs = hash3I(key, uSeed + 97.0);
      vec2 cen = (vec2(c) + 0.5) * bpx;
      float cl = valueNoise(cen / uRes * kc, periodOf(kc), uSeed + 95.0);
      // (Stacks only under bubbles large enough to show them as discs.)
      float r0c = min(u_bub_size * (0.2 + 0.8 * h.z * h.z * h.z), 0.45 * bmin);
      if (h.w < mix(0.85, smoothstep(0.35, 0.75, cl), u_cluster) && (st == 0 || (hs.x < u_bub_stack && r0c > 3.0))) {
        float r0 = min(u_bub_size * (0.2 + 0.8 * h.z * h.z * h.z), 0.45 * bmin);
        float r = r0 * pow(0.85, float(st));
        float sa = (hs.y - 0.5) * 1.2 - 0.5 * PI;
        vec2 o = cen + (h.xy - 0.5) * max(bpx - 2.0 * r0, 0.0) + vec2(cos(sa), sin(sa)) * float(st) * r0 * 1.25;
        float dpt = clamp(u_depth * hs.z + 0.2 * float(st), 0.0, 1.0);
        vec2 q = p + rShift * dpt - o;
        float d = length(q);
        if (d < 1.3 * r + 3.0) {
          // Large bubbles are flat, frosty discs with lumpy outlines; small ones clear beads with a rim and a highlight.
          float big = smoothstep(2.5, 6.0, r);
          float th = atan(q.y, q.x + 1e-9);
          float rr = r * (1.0 + big * (0.02 * sin(3.0 * th + 6.0 * hs.x) + 0.015 * sin(7.0 * th + 9.0 * hs.y) + 0.012 * sin(11.0 * th + 3.0 * hs.z)));
          // (A rim only on bubbles large enough to show one: a small one is a filled dot.)
          float small = 1.0 - smoothstep(1.5, 3.0, r);
          float rim = exp(-pow((d - rr) / max(mix(0.6, 1.4, dpt), 0.1 * r), 2.0)) * (1.0 - small);
          float inside = clamp(rr - d + 0.5, 0.0, 1.0);
          // A grain across a disc, about a pixel and a third.
          float mottle = 0.65 + 0.35 * valueNoise(q / 1.3 + vec2(key) * 17.0, NO_PERIOD, uSeed + 99.0);
          float fill = inside * mix(mix(0.12, 0.5, big), 0.7, small) * mottle;
          vec2 hl = q - L * 0.4 * r;
          float spot = exp(-dot(hl, hl) / max(0.04 * r * r, 0.2)) * (1.0 - big) * smoothstep(2.5, 3.5, r);
          float b = clamp(max(0.95 * rim, fill) + spot, 0.0, 1.0) * mix(1.0, 0.25, dpt);
          Bv = 1.0 - (1.0 - Bv) * (1.0 - b);
          Bsum += b;
          Bd += b * dpt;
          // Seen through a clear bubble, what is below turns over.
          bshift -= q * 0.8 * inside * (1.0 - dpt) * (1.0 - big);
        }
      }
    }
  }
  if (u_specks > 0.0) {
    vec2 scc = cellsFor(uRes.x * sqrt(u_specks) / 64.0, 1.0);
    vec2 spx = uRes / scc;
    ivec2 c = ivec2(floor(p / spx));
    ivec2 key = wrapCell(c, ivec2(scc + 0.5));
    vec4 h = vec4(hash3I(key, uSeed + 101.0), hashI(key, uSeed + 103.0));
    float cl = valueNoise((vec2(c) + 0.5) * spx / uRes * kc, periodOf(kc), uSeed + 95.0);
    if (h.w < mix(0.8, smoothstep(0.3, 0.7, cl), u_cluster)) {
      float r = 0.3 + 1.4 * h.z * h.z * h.z;
      float dpt = u_depth * fract(h.z * 17.3);
      vec2 q = p + rShift * dpt - (vec2(c) * spx + 0.5 * spx + (h.xy - 0.5) * max(spx - 6.0, 0.0));
      Bv = 1.0 - (1.0 - Bv) * (1.0 - exp(-dot(q, q) / (r * r * mix(1.0, 2.5, dpt))) * mix(1.0, 0.3, dpt));
    }
  }

  // Frost: in patches (a slow noise over 1 − Frost), blades growing from a point — one to three, longer in the thick of
  // a patch — each a gently curving spine with barbs at 60° (ice grows in sixes) slanting towards its tip, from roots
  // about Barb spacing apart, each side its own, each barb its own length within the blade's outline (widest near its
  // base); long barbs grow barbs of their own. Every line is anti-aliased, tapering to its tip. A faint plate fills the
  // blade, and a thin glaze of rime covers the patch.
  float F = 0.0;
  if (u_frost > 0.0) {
    vec2 fc = cellsFor(uRes.x / max(u_frost_size, 1.0), 1.0);
    vec2 fpx = uRes / fc;
    ivec2 nf = ivec2(fc + 0.5);
    ivec2 f0 = ivec2(floor(p / fpx));
    vec2 pcc = cellsFor(u_frost_scale, 1.0);
    float sp = max(u_frost_barb, 0.5);
    float fth = 1.0 - u_frost;
    for (int e = 0; e < 28 * UNI_1; e++) {
      // (The last one is the patch at the pixel, for the glaze.)
      bool rime = e == 27;
      int ce = e / 3, k = e - ce * 3;
      ivec2 c = f0 + ivec2(ce % 3, ce / 3) - 1;
      ivec2 key = wrapCell(c, nf);
      vec3 h = hash3I(key, uSeed + 111.0);
      vec3 hk = hash3I(ivec2(key.x * 131 + k, key.y), uSeed + 113.0);
      vec2 cen = (vec2(c) + 0.5) * fpx;
      float pr = valueNoise((rime ? p : cen) / uRes * pcc, periodOf(pcc), uSeed + 115.0);
      float pres = smoothstep(fth, fth + 0.25, pr + 0.1);
      if (rime) {
        F = max(F, pres * (0.08 + 0.3 * smoothstep(0.4, 1.0, u_frost)) * (0.5 + hashI(wrapCell(ivec2(floor(p / 1.5)), ivec2(uRes / 1.5 + 0.5)), uSeed + 121.0)));
      } else if (pres > 0.35 && hk.z < pres * (k == 0 ? 1.0 : mix(0.35, 1.0, u_frost))) {
        vec2 o = cen + (h.xy - 0.5) * 0.8 * fpx + (hash2I(ivec2(key.x * 131 + k, key.y), uSeed + 119.0) - 0.5) * 0.3 * fpx;
        float a = TAU * (h.z + float(k) / 3.0) + (hk.x - 0.5) * 1.3;
        vec2 dir = vec2(cos(a), sin(a));
        float Lb = u_frost_size * (0.35 + 0.65 * hk.y) * mix(0.45, 1.0, pres);
        vec2 q = p - o;
        // (Its spine curves a little.)
        float u = dot(q, dir);
        float v = dot(q, vec2(-dir.y, dir.x)) - (hk.x - 0.5) * 0.6 * u * u / Lb;
        float av = abs(v);
        if (u > -1.0 && u < Lb + 1.0 && av < 0.45 * Lb + 1.5) {
          float f = clamp(u / Lb, 0.0, 1.0);
          float spine = clamp(mix(1.1, 0.35, f) + 0.5 - av, 0.0, 1.0) * smoothstep(-1.0, 0.5, u) * (1.0 - smoothstep(0.85 * Lb, Lb + 1.0, u));
          // The barbs on this side: each at its own angle (60° ± 10° to the spine) and curving a little towards the tip;
          // of the three roots round the pixel's slot, the nearest line.
          float kb = floor((u - av * 0.5774) / sp);
          int side = v < 0.0 ? 1 : 0;
          // (One side's barbs shorter: a lopsided frond.)
          float asym = side == 1 ? 0.45 + 0.55 * fract(hk.y * 9.7) : 1.0;
          float best = 1e4, bl = 0.0, u0 = 0.0, s = 0.0;
          for (int j = 0; j < 3; j++) {
            float kj = kb + float(j - 1);
            vec3 hb = hash3I(ivec2(int(kj) * 2 + side, key.x * 31 + key.y * 7 + k), uSeed + 117.0);
            float cj = 0.5774 + (hb.z - 0.5) * 0.4;
            float sj = u - av * cj - 0.12 * av * av / max(Lb, 1.0);
            float r0 = (kj + 0.2 + 0.6 * hb.x) * sp;
            float dd = abs(sj - r0) * inversesqrt(1.0 + cj * cj);
            if (dd < best) { best = dd; u0 = r0; s = sj; bl = 0.45 * Lb * pow(clamp(1.0 - r0 / Lb, 0.0, 1.0), 0.8) * smoothstep(0.0, 0.06, r0 / Lb) * (0.3 + 0.7 * hb.y) * asym; }
          }
          // Along the barb from the spine (w), and its share left (a line thinning to its tip).
          float w = av / 0.8660;
          float inB = u0 >= 0.0 && u0 <= Lb ? 1.0 - smoothstep(bl - 1.0, bl, w) : 0.0;
          float barb = clamp(mix(0.8, 0.3, w / max(bl, 1e-3)) + 0.5 - best, 0.0, 1.0) * inB;
          // Barbs of its own on a long barb, at 60° towards its tip, half as far apart.
          float sub = 0.0;
          if (bl > 3.0 * sp) {
            float z = (s - u0) * 0.8660;
            float s2 = w - abs(z) * 0.5774;
            float sp2 = 0.7 * sp;
            float w0 = floor(s2 / sp2 + 0.5) * sp2;
            float l2 = 0.3 * (bl - w0);
            sub = smoothstep(2.5, 4.0, sp2) * clamp(0.5 + 0.5 - abs(s2 - w0) * 0.8660, 0.0, 1.0) * (w0 > 0.0 && abs(z) < l2 ? 1.0 - smoothstep(0.6 * l2, l2, abs(z)) : 0.0) * inB;
          }
          float plate = 0.12 * (av < 0.45 * Lb * pow(1.0 - f, 0.8) ? 1.0 : 0.0);
          F = 1.0 - (1.0 - F) * (1.0 - clamp(max(max(spine, barb), max(sub, plate)), 0.0, 1.0) * (0.65 + 0.35 * hk.y));
        }
      }
    }
  }

  // What is below, seen through: bent by the ripples or an icicle's round section, offset across cracks, turned over
  // in bubbles; tinted by the thickness (an icicle's by its own), clouded by haze and an icicle's milky core.
  // (The sheet's cracks and frost stay out of the icicles.)
  W *= 1.0 - onI;
  F *= 1.0 - onI;
  shift *= 1.0 - onI;
  // Fill hollows: the ice's top levels the relief below, from the mean of four rings round the pixel (twice Fill width,
  // it, a half and a quarter of it) up to their highest by Fill — a smooth level, so a part fill sags across a joint instead
  // of stepping at its walls — and is that much thicker there.
  float h0 = fetchT(tSurface, ivec2(gl_FragCoord.xy)).r, hm = h0, hs = 0.0;
  for (int e = 0; e < (u_fill > 0.0 ? 24 : 0) * UNI_1; e++) {
    int ring = e / 6;
    float a = (float(e) + 0.5 * float(ring)) * TAU / 6.0;
    float hh = sampleT(tSurface, gl_FragCoord.xy + exp2(float(ring) - 2.0) * u_fill_w * vec2(cos(a), sin(a))).r;
    hm = max(hm, hh);
    hs += hh;
  }
  float lift = u_fill > 0.0 ? max(mix(hs / 24.0, hm, u_fill) - h0, 0.0) : 0.0;
  vec3 nI = slopeNormal(iG);
  vec3 n = normalize(mix(nR, nI, onI));
  vec3 bg = seenThrough(gl_FragCoord.xy, lensShift(n, u_refraction) + shift + bshift);
  // The sheet: its colour at its depth (Depth colour); what is below seen through it, tinted by it, and (Subsurface
  // scattering) light scattered inside it, in the colour — growing with the square of the depth, so thin ice stays
  // clear, and dimmer over a dark ground, so deep water stays dark — and haze, cracks, bubbles and frost in white tinted
  // by it. Where there is no sheet, what is below as it is.
  float Ts = clamp(T + 0.15 * smoothstep(0.0, 1.0, lift), 0.0, 1.0);
  vec3 dc = srgbToLinear(gradientLookup(u_depth_grad_stops, u_depth_grad_count, Ts));
  vec3 sc = dc * mix(0.4, 1.0, smoothstep(0.0, 0.35, luma(bg)));
  vec3 col = mix(absorbTint(bg, dc, 1.4 * Ts) * (1.0 - 0.2 * Ts), sc, min(u_sss * (0.15 + 1.2 * Ts * Ts), 0.85));
  col = mix(col, u_white * mix(vec3(1.0), dc, 0.45), hz);
  col = mix(col, u_white * mix(vec3(1.0), dc, 0.5 * crackDepth), W);
  // Deeper bubbles bluer; frost faintly blue.
  col = mix(col, u_white * mix(vec3(1.0), dc, 0.6 * Bd / max(Bsum, 1e-4)), Bv);
  col = mix(col, u_white * mix(vec3(1.0), dc, 0.15), F) * (1.0 - pit);
  col = mix(bg, col, clamp(20.0 * sheetCov, 0.0, 1.0));
  // An icicle in front: thin, clear ice — what is behind it (the sheet's colour) tinted a little by its own depth, a
  // narrow milky core, white rims, and a glint where it focuses the light.
  vec3 di = srgbToLinear(gradientLookup(u_depth_grad_stops, u_depth_grad_count, 0.05 + 0.2 * iDome));
  vec3 ci = mix(absorbTint(col, di, 0.8), u_white * mix(vec3(1.0), di, 0.3), 0.35 * iCore);
  float gz = grazing(nI);
  // (The rim facing the light catches it, the far one darkens.)
  float lit = dot(nI.xy / max(length(nI.xy), 1e-4), L);
  ci = mix(ci, u_white, rimFresnel(gz, 0.5) * smoothstep(-0.3, 0.7, lit)) * (1.0 - 0.4 * rimFresnel(gz, 1.0) * (1.0 - smoothstep(-0.8, 0.0, lit)));
  ci += u_glint * innerGlint(nI, L, gz) * u_white;
  col = mix(col, ci, onI);
  hz = mix(hz, 0.35 * iCore, onI);
  float Ti = mix(Ts, 0.05 + 0.2 * iDome, onI);

  // Height: the sheet's ripples (lower towards a patch's edge), frost on it, a fine groove along the shallow cracks; the
  // icicles' domes on it (0 at their rims).
  float hS = (0.4 + 1.6 * u_ripple * (rh - 0.5) + 2.0 * bk * bn) * (0.5 + 0.5 * edgeK) + 0.12 * F - 0.06 * exp(-cDist * cDist / 0.5);
  float hv = clamp(hS * sheetCov + 0.6 * iDome, 0.0, 1.0);
  float white = clamp(max(max(W, Bv), max(F, hz)), 0.0, 1.0);
  int ok = u_output;
  float val = ok == 1 ? W : ok == 2 ? Bv : ok == 3 ? F : ok == 4 ? onI * iDome : ok == 5 ? Ti : hv;
  float cov = max(sheetCov, iCov);
  GenOut g = genOutSmooth(val, cov, 0.5, 0.0);
  if (ok == 0) {
    gGenRgb = linearToSrgb(clamp(col, 0.0, 1.0));
    gGenTransmit = u_transmit * (1.0 - white);
    g.hval = hv;
    // Its own height (Height › Pattern adds it × Amount): the sheet's surface, plus the fill — in the surface's own
    // units, so divided by Amount — over the coverage.
    // An icicle's own height is in px (round in section), so it is turned into the surface's units too.
    g.height = cov * (hS * sheetCov + (lift + iH / max(uDepth, 1e-3)) / max(abs(u_h_amount), 1e-3));
  }
  // Roughness and Specular › Parts: clear ice glossy, frost and haze matte.
  gGenLevel = vec4(mix(0.08, 0.75, max(F, 0.7 * hz)), mix(0.75, 0.3, F), -1.0, -1.0);
  return g;
}
`
};
