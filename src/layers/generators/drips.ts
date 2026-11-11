// Drips (FR7.7): water / rust / blood stains that run down from their sources — scattered over a grid, and (Ledge
// drips) along the ledges of the relief beneath, at the lip or down at the foot of the drop (layers/dripSources.ts,
// shared with Blisters: with the same seed and placement settings the stains run down from its blisters) — a tapering
// trail that fades as it goes, wobbling slightly, its head cut straight, rounded or faded in. The value is the stain
// strength and the coverage is soft, so with a Normal or Multiply diffuse blend a drip stains whatever the layers
// beneath painted, in proportion to its strength. Wraps on tileable projects.
//
// Two styles. Streak (pixel): the classic narrow trail, crisp at 1 px. Runnels (detailed), for higher resolutions and
// wide stains: water running down a wall — a wash from its seep (a point, or with Seep width a whole line, its lip
// ragged), widening over its first stretch (Fan-out: or all the way down, a straight V) and tapering after, its centre
// line wandering on smooth noise, tide marks along its sides, dry patches, fine streaks it breaks into further down
// (each running out at its own length), and inside it a few thin runnels of their own widths, each wandering on its
// own (Runnel braiding), ending at its own length, some in a bead. Sideways sways never steepen past ~20° from vertical (a
// wide wobble sways over a longer stretch). Stain softness blurs every edge; Strength and Shape variation make each stain
// its own. Surface flow makes the trails react to the relief beneath: they pool against grooves and raised features
// and run on weaker below them.
//
// Passes run before the layer (prepare): the source pass (dripSources.ts: where each cell's drip sits, its ledge,
// whether it drips — worked out once per cell instead of per pixel) and, with Surface flow, the rises crossed going down
// every column, prefix-summed from the top.
// Drips added in the editor start as streaky runnels sized to the texture, scattered and hanging from the ledges
// (LayerDef.fresh; pixel streaks below 128 px); layers built in code keep the streak style unless they ask.

import type { Texture } from 'three';
import { P, round1 as r1, type Gradient } from '@/core/params';
import type { LayerDef } from '../types';
import { SOURCE_READ_GLSL, placementParams, sourceCells, sourceGridGlsl, type SourceSpacing } from '../dripSources';

const isRunnels = (p: Record<string, unknown>) => p.style === 'runnels';

/** Set B's spacing: Ledge spacing. */
const GAP: SourceSpacing = { glsl: 'u_ledge_gap', px: (p) => Number(p.ledge_gap) };

/** The editor's paint for new stains: a brown multiply darkening. */
const FRESH_STAIN: Gradient = {
	stops: [
		{ pos: 0, color: '#7a6a58' },
		{ pos: 1, color: '#3e3024' }
	]
};

const placement = placementParams('drip', { ledgeLabel: 'Ledge drips' });

/** Surface flow, first pass: the rise from each pixel to the one below it (user space), past a little grain. */
const FLOW_INIT = /* glsl */ `
void main() {
  ivec2 c = ivec2(floor(gl_FragCoord.xy));
  oColor = vec4(max(fetchT(tSurface, c - ivec2(0, 1)).r - fetchT(tSurface, c).r - 0.025, 0.0), 0.0, 0.0, 1.0);
}
`;
/** Then a prefix sum down each column from the top (Hillis–Steele: log2 H passes, each adding the texel uStep above). */
const FLOW_SCAN = /* glsl */ `
uniform sampler2D tFlow;
uniform int uStep;
void main() {
  ivec2 c = ivec2(floor(gl_FragCoord.xy));
  float a = texelFetch(tFlow, c, 0).r;
  if (c.y + uStep < int(uRes.y)) a += texelFetch(tFlow, c + ivec2(0, uStep), 0).r;
  oColor = vec4(a, 0.0, 0.0, 1.0);
}
`;

export const dripsLayer: LayerDef = {
	type: 'drips',
	label: 'Drips',
	category: 'pattern',
	kind: 'generator',
	description:
		'Drips: Made from stains running down from scattered sources or ledges, as streaks or detailed runnels. Makes water, rust and blood stains, leaks, weathering.',
	params: [
		P.enum('style', 'Style', 'streak', [
			['streak', 'Streak (pixel)', 'a narrow trail that tapers and fades, crisp at 1 px'],
			[
				'runnels',
				'Runnels (detailed)',
				'a wandering wash of water with tide-marked edges and thin runnels inside that split, merge and end in beads. Best for higher resolutions and wide stains'
			]
		]),
		...placement.grid,
		P.float('len_min', 'Shortest trail', 4, 0, 4096, {
			softMax: 512,
			unit: 'px',
			axis: 'y',
			step: 0.5
		}),
		P.float('len_max', 'Longest trail', 20, 0, 4096, {
			softMax: 512,
			unit: 'px',
			axis: 'y',
			step: 0.5
		}),
		P.float('width', 'Trail width', 1, 0.25, 512, {
			softMax: 96,
			unit: 'px',
			axis: 'x',
			step: 0.05,
			hint: 'Sets the trail width at the head (streaks taper to half; runnels: the width of the wash, see Wash taper)'
		}),
		P.float('width_var', 'Width variation', 0.65, 0, 1, { step: 0.001 }),
		P.float('head_fade', 'Head fade', 0, 0, 512, {
			softMax: 64,
			unit: 'px',
			axis: 'y',
			step: 0.5,
			hint: 'Fades each trail in over this many px below its source, so it grows out of the surface instead of starting at a hard line (0 = full strength from the start)'
		}),
		P.float('head_round', 'Head rounding', 0, 0, 2, {
			step: 0.001,
			hint: 'Rounds the top of each trail into a cap (0 = cut straight across, 0.5 = a half circle as wide as the trail, higher = a longer, rounded point)'
		}),
		P.float('head', 'Drop blob', 0, 0, 128, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			hint: 'Adds a round drop of this radius at the source (0 = none; water and blood have none)'
		}),
		P.float('start', 'Trail strength', 0.8, 0, 1, {
			step: 0.001,
			hint: 'Sets the strength where the trail starts (it fades to 0 along the trail)'
		}),
		P.float('str_var', 'Strength variation', 0.45, 0, 1, {
			step: 0.001,
			hint: 'Gives each trail a random share of the strength (1 = anywhere from none to full), so faint old stains sit among fresh dark ones'
		}),
		P.float('fade', 'Trail fade', 1, 0.1, 8, {
			softMax: 4,
			step: 0.01,
			hint: 'Sets how quickly the trail fades (1 = linear, below 1 = stays strong for longer, above 1 = fades early)'
		}),
		P.float('wobble', 'Wobble', 0.4, 0, 256, {
			softMax: 32,
			unit: 'px',
			axis: 'x',
			step: 0.05,
			hint: 'Makes the trail meander sideways (runnels: how far the whole stain wanders)'
		}),
		P.float('soft', 'Stain softness', 0, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			showIf: (p) => p.aa !== false,
			hint: 'Blurs every edge of the stain over this many px: the trail, the wash, the runnels and their ends (0 = crisp, anti-aliased)'
		}),
		P.float('wander', 'Wobble length', 28, 2, 2048, {
			softMax: 512,
			unit: 'px',
			axis: 'y',
			step: 0.5,
			hint: 'Sets the length of one sideways swing of the trail (streaks add a smaller swing a third as long; runnels swing about twice as often)'
		}),
		P.float('seep', 'Seep width', 0.8, 0.05, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Sets how wide the stain is where it seeps out, as a share of its width (low = a point, like a bolt or a hole; 1 = a whole line, like a crack or a lip, with a ragged edge)'
		}),
		P.float('fan', 'Fan-out', 0.1, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Sets how far down the stain widens from its seep to its full width (0 = within about its own width, 1 = all the way down, a straight V)'
		}),
		P.float('taper', 'Wash taper', 0.45, -1, 1, {
			step: 0.01,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Changes the width past the fan-out, down to the end (1 = narrows to a point, 0 = keeps its width, below 0 = spreads)'
		}),
		P.float('shape_var', 'Shape variation', 0.8, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Gives each stain a random seep width, fan-out and taper around the settings, so points and lines, Vs and columns sit side by side'
		}),
		P.float('feather', 'Wash feather', 0.4, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Fades the wash in from its sides (and down from its seep), as a share of its width (0 = an even sheet with crisp sides, 1 = darkest along its middle, fading out to its edges)'
		}),
		P.float('sheet', 'Wash', 1, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Adds the faint stain of the water sheet between the runnels'
		}),
		P.float('edge', 'Tide marks', 0.25, 0, 2, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: "Adds a darker deposit along the wash's sides, where it dried (wider on broad stains); above 1 it's a strong rim"
		}),
		P.float('breakup', 'Dry patches', 0.2, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Breaks the wash up into patches'
		}),
		P.float('streaks', 'Streaks', 0.55, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Wash',
			hint: 'Adds fine, lighter and darker streaks running down through the wash, each ending at a random length for a ragged lower end'
		}),
		P.float('streak_w', 'Streak spacing', 2, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			axis: 'x',
			step: 0.05,
			showIf: (p) => isRunnels(p) && Number(p.streaks) > 0,
			section: 'Wash',
			hint: 'Sets how far apart the streaks run'
		}),
		P.int('runnels', 'Runnels', 3, 0, 16, {
			showIf: isRunnels,
			section: 'Runnels',
			hint: 'Sets the most runnels in one stain (each stain draws 1 to this many, narrow stains fewer; 0 = just the wash)'
		}),
		P.float('runnel_width', 'Runnel width', 1.5, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			axis: 'x',
			step: 0.05,
			showIf: isRunnels,
			section: 'Runnels',
			hint: 'Sets the width of each runnel where it starts; it thins to half'
		}),
		P.float('runnel_str', 'Runnel strength', 0.5, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Runnels',
			hint: 'Darkens the runnels and their beads, × the trail strength (low = faint trickles within the wash)'
		}),
		P.float('braid', 'Runnel braiding', 0.35, 0, 2, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Runnels',
			hint: 'Lets the runnels wander across the wash (0 = straight, side by side; 1 = across most of it, crossing and merging)'
		}),
		P.float('beads', 'Runnel beads', 0.15, 0, 1, {
			step: 0.001,
			showIf: isRunnels,
			section: 'Runnels',
			hint: 'Sets the chance that a runnel ends in a drop'
		}),
		...placement.ledges,
		P.float('relief_len', 'Length from height', 0, 0, 32, {
			softMax: 16,
			step: 0.01,
			group: 'relief',
			hint: 'Lengthens trails with the height of the ledge they fall from: length × (1 + this × drop, in height units), so taller rivets get longer tails'
		}),
		P.float('flow', 'Surface flow', 0.6, 0, 1, {
			step: 0.001,
			group: 'relief',
			hint: 'Makes trails react to the relief beneath, wherever they start: grooves and raised features (seams, rivets, lips) catch the water, which pools against them and runs on weaker below, leaving a dry shadow under each rivet'
		}),
		P.seed()
	],
	groups: [{ id: 'relief', label: 'Ledges' }],
	// The Runnels style's stains (the ragged wash and its runnels) in a variant of their own: they were well over half of
	// the cold compile, and Streak doesn't need them.
	shaderFeatures: (p) => (isRunnels(p) ? ['DR_RUNNELS'] : []),
	// No shape of its own (stains write their coverage to a mask), but the Edge card's Anti-alias picks crisp pixel
	// streaks or smooth ones.
	sdf: 'mask',
	sdfShowIf: (_p, key) => key === 'aa',
	textures: ['cells', 'flow'],
	prepare(ctx, layer): Record<string, Texture> {
		const p = layer.params;
		const out: Record<string, Texture> = { cells: sourceCells(ctx, p, GAP, 'u_width') };
		// Surface flow: the rises crossed going down each column, summed from the top.
		if (Number(p.flow) > 0) {
			let src = ctx.scratch('drips-flow:a');
			let dst = ctx.scratch('drips-flow:b');
			ctx.run(ctx.material('drips:flow0', FLOW_INIT), src);
			const scan = ctx.material('drips:flow', FLOW_SCAN, { tFlow: { value: null }, uStep: { value: 1 } });
			for (let k = 1; k < ctx.height; k *= 2) {
				scan.uniforms.tFlow.value = src.texture;
				scan.uniforms.uStep.value = k;
				ctx.run(scan, dst);
				[src, dst] = [dst, src];
			}
			out.flow = src.texture;
		}
		return out;
	},
	// Added in the editor: a detailed water stain sized to the texture — seeping from points and short lines, fanning
	// out, breaking into streaks, each stain its own — darkening what is beneath; below 128 px, crisp pixel streaks.
	fresh: ({ width, height }) => {
		// (Lengths down the texture follow its height.)
		const k = Math.max(0.5, width / 128);
		const ky = Math.max(0.5, height / 128);
		// Scattered drips and drips along the ledges beneath.
		const stain = { dif_blend: 'multiply', dif_grad: FRESH_STAIN };
		if (width < 128)
			return {
				...stain,
				style: 'streak',
				density: 0.3,
				ledge_density: 0.15,
				len_min: r1(height / 8),
				len_max: r1(height / 2.5),
				start: 0.8,
				fade: 1,
				wobble: 0.8
			};
		return {
			...stain,
			style: 'runnels',
			cols: 7,
			rows: 3,
			density: 0.4,
			ledge_density: 0.3,
			ledge_gap: r1(14 * k),
			len_min: r1(14 * ky),
			len_max: r1(80 * ky),
			width: r1(10 * k),
			wobble: r1(1.2 * k),
			wander: r1(64 * ky),
			streak_w: r1(Math.max(1, 0.75 * k)),
			runnel_width: r1(Math.max(1, 0.8 * k)),
			soft: r1(0.75 * k),
			start: 0.9,
			fade: 1.1,
			aa: true
		};
	},
	defaults: {
		// Pixel-crisp by default (Edge › Anti-alias).
		aa: false,
		h_on: false,
		dif_on: true,
		dif_grad: {
			stops: [
				{ pos: 0, color: '#5a1e10' },
				{ pos: 1, color: '#7a2a14' }
			]
		},
		// Stains and paint are not metal: where they lie on a metal, it stops reflecting like one.
		mt_on: true,
		mt_src: 'flat',
		mt_b: 0
	},
	glsl: /* glsl */ `
${sourceGridGlsl(GAP)}
${SOURCE_READ_GLSL}
// The wavelength (at least lam) over which a sway of amplitude a px stays within ~20° of vertical: water cannot run
// further sideways, so a wide sway takes a longer stretch.
float dr_lam(float lam, float a) { return max(lam, 8.0 * a); }
// The runnel style's centre line (px across, at px down).
float dr_cx(float y, float lam, float rs) {
  float n1 = valueNoise1(y / dr_lam(lam, 0.65 * u_wobble), rs + 1.0);
  float n2 = valueNoise1(y / dr_lam(0.37 * lam, 0.35 * u_wobble), rs + 2.0);
  return u_wobble * (1.3 * n1 + 0.7 * n2 - 1.0);
}
float dr_hw(float w, float t, float taper) { return max(0.5 * w * (1.0 - taper * t), 0.5); }
// The stain's half width at px down. sh: its seep width, fan-out and taper. The water spreads from its seep: from seep
// × its width to all of it over its first stretch — about its own width, or (Fan-out) a share of its length, then as a
// straight V — and Wash taper narrows (or spreads) it from there to the end.
float dr_halfw(float y, float w, float len, vec3 sh) {
  float L = max(len, 1e-3);
  float t = clamp(y / L, 0.0, 1.0);
  float ta = sh.y > 0.0 ? clamp((y - sh.y * L) / max((1.0 - sh.y) * L, 1e-3), 0.0, 1.0) : t;
  float u = clamp(y / mix(max(3.0, 1.2 * w), L, sh.y), 0.0, 1.0);
  return dr_hw(w, ta, sh.z) * mix(sh.x, 1.0, mix(u * u * (3.0 - 2.0 * u), u, sh.y));
}
// Runnel j's place across the wash (−1..1) at px down: its lane, wandering by Runnel braiding (hwF: the full half width).
float dr_bj(float base, float y, float lam, float hwF, float rs, int j) {
  float s = rs + 10.0 + 2.0 * float(j);
  float a = u_braid * hwF;
  float n1 = valueNoise1(y / dr_lam(0.5 * lam, 0.5 * a), s);
  float n2 = valueNoise1(y / dr_lam(0.17 * lam, 0.2 * a), s + 1.0);
  return clamp(base + u_braid * (n1 + 0.4 * n2 - 0.7), -0.95, 0.95);
}

// Coverage of a signed distance (px, < 0 inside): stepped when hard, else anti-aliased over 1 + Softness px (eased
// when soft, so a blurred edge has no visible ramp ends).
float dr_cov(float dist) {
  if (!u_aa) return step(dist, 0.0);
  float c = clamp(0.5 - dist / (1.0 + u_soft), 0.0, 1.0);
  return u_soft > 0.0 ? c * c * (3.0 - 2.0 * c) : c;
}

// Head fade: a trail's strength at y px below its source, fading in over the first Head fade px (eased at both ends,
// so it grows out of the surface without a visible start).
float dr_fadeIn(float y) { return u_head_fade > 0.0 ? smoothstep(0.0, u_head_fade, y) : 1.0; }
// Head rounding: the share of a trail's half width left at y px below its top, where the top is capped in a
// half-ellipse rc px tall (1 below it).
float dr_cap(float y, float rc) {
  if (rc <= 0.0) return 1.0;
  float u = 1.0 - clamp(y / rc, 0.0, 1.0);
  return sqrt(max(1.0 - u * u, 0.0));
}

// One runnel-style stain, d from its source (px, y down), length len, head width w, strength st, per-stain seed rs (a
// whole number; each noise adds a whole offset of its own, as hashI truncates its seed), shape sh (seep width, fan-out, taper), led 1 when it falls from a ledge: its strength here (already anti-aliased: the
// caller uses it as both value and coverage).
#ifdef DR_RUNNELS
float dr_runnels(vec2 d, float len, float w, float st, float rs, vec3 sh, float led) {
  float lam = max(u_wander, 2.0);
  float e = !u_aa ? 0.0 : u_soft;
  float hwF = 0.5 * w;
  if (d.y < -2.0 - u_runnel_width - e || d.y > len + 6.0 * u_runnel_width + 2.0 + e) return 0.0;
  if (abs(d.x) > u_wobble + hwF * (1.0 + max(-sh.z, 0.0)) + 3.0 * u_runnel_width + 2.0 + e) return 0.0;
  float t = clamp(d.y / max(len, 1e-3), 0.0, 1.0);
  // (The sway ramps in below the seep, so the stain starts right on its source, its seep centred there.)
  float x = d.x - dr_cx(d.y, lam, rs) * smoothstep(0.0, max(8.0, w), d.y);
  float hw = dr_halfw(d.y, w, len, sh);
  float hs = sh.x * dr_hw(w, 0.0, sh.z);  // the seep's half width
  float best = 0.0;
  // The seep's lip, its corners rounded. top: px below it. A free seep's lip is ragged; a drip from a ledge starts on
  // the ledge's own line, darkest against it.
  float lip1 = 2.0 * valueNoise1(x / max(3.0, 0.3 * hs), rs + 4.0) - 1.0;
  // (Only a broad seep's lip is ragged: on a narrow one the bumps would read as horns — it seeps from one rounded point.)
  float top = d.y - min(0.3 * hs, 6.0) * (1.0 - led) * smoothstep(4.0, 12.0, hs) * (lip1 + 1.0);
  // Head rounding: the wash (and its runnels' lanes) narrowed into a cap rc px tall under the lip.
  float hwc = hw * dr_cap(top, u_head_round * 2.0 * hs);
  // Wash feather: a free stain fades in down from its lip — unevenly along it, eased, from just above it so Stain softness
  // still blurs the edge — and, below, in from its sides.
  float soft0 = -0.5 * (1.0 + e);
  // (Its fade is longest at the sides, so the head rounds to one centred seep; only a broad seep's varies along the lip.)
  float broad = smoothstep(4.0, 12.0, hs);
  float xr = min(abs(x) / max(hs, 1.0), 1.5);
  float fTop = u_feather > 0.0 ? smoothstep(soft0, max(4.0, u_feather * max(4.0 * hs, 1.5 * hwF)) * (1.0 + 0.5 * lip1 * broad) * (1.0 + (1.0 - broad) * xr * xr), top) : 1.0;
  fTop = mix(fTop * fTop, 1.0, led);
  // Fan-out: the same water spread wider is fainter — darkest at the seep, fading as the stain widens.
  st *= sh.y > 0.0 ? pow(clamp(hs / max(hw, 1e-3), 0.05, 1.0), 0.6 * sh.y) : 1.0;
  // Wash: the water sheet, tide-marked sides, dry patches, streaks; its corners at the lip rounded.
  if (d.y >= -1.0 - 0.5 * e && d.y <= len) {
    float side = hwc - abs(x);
    float r = mix(0.4 * hs, min(0.15 * hs, 2.0), led);
    float inEdge = side < r && top < r ? r - length(vec2(r - side, r - top)) : min(side, top);
    float inside = dr_cov(-inEdge);
    if (inside > 0.0) {
      // Tide marks along the sides only (not across the seep): about a px wide, wider on broad stains.
      float tw = (1.0 + 0.5 * e) * max(1.0, 0.08 * hwF) * mix(1.0, 1.6, clamp(u_edge - 1.0, 0.0, 1.0));
      float sd = max(side, 0.0);
      // (They come in after the head, and only on stains wide enough to have two sides — on a narrow one the two
      // would meet in a dark core, at a free stain's head in two dark horns.)
      float tide = exp(-sd * sd / (1.5 * tw * tw)) * smoothstep(0.0, 2.0 * r + 1.0, top) * fTop * fTop * smoothstep(1.5, 4.0, hw);
      // Its noises through one valueNoise call: 0 dry patches; 1, 2 the streaks (two octaves, stretched down the
      // stain); 3 where each streak runs out (across only). Accumulated as they come: an array indexed in the loop
      // costs D3D compile time.
      float sw = max(u_streak_w, 0.5);
      float sl = max(6.0 * sw, 0.3 * len);
      float nDry = 0.5, nStreak = 0.0, nEnd = 0.0;
      int count = u_breakup > 0.0 || u_streaks > 0.0 ? 4 : 0;
      // (The streaks' spacing wanders, so they are no comb.)
      float xs = x + 1.5 * sw * (2.0 * valueNoise1(x / (4.0 * sw), rs + 5.0) - 1.0);
      for (int i = 0; i < count; i++) {
        vec2 a = i == 0 ? vec2(x / max(6.0, 0.6 * hw), d.y / max(20.0, 2.0 * hw))
               : i == 3 ? vec2(xs / (1.7 * sw), 0.5)
               : vec2(xs / sw, d.y / sl) * (i == 1 ? 1.0 : 2.3);
        float n = valueNoise(a, NO_PERIOD, rs + 3.0 * float(i));
        if (i == 0) nDry = n;
        else if (i == 3) nEnd = n;
        else nStreak += (i == 1 ? 0.65 : 0.35) * n;
      }
      // (No dry patches in the seep, where they would read as holes.)
      // Dry patches: broad (at least 6 × 20 px), soft, never quite bare — no light specks in a dark stain.
      float dry = u_breakup <= 0.0 ? 1.0 : mix(1.0, mix(0.3, 1.0, smoothstep(u_breakup - 0.2, u_breakup + 0.2, nDry)), smoothstep(0.1, 0.35, t));
      // The wash is whole at its seep and breaks into streaks further down.
      float streak = 1.0 - 0.85 * u_streaks * smoothstep(0.0, 0.4, t) * (1.0 - smoothstep(0.25, 0.75, nStreak));
      float te = clamp(d.y / max(len * (1.0 - 0.6 * u_streaks * nEnd), 1e-3), 0.0, 1.0);
      // Wash feather: the sheet fades in from the sides and from the lip (the tide marks stay at the edge).
      float body = u_feather > 0.0 ? smoothstep(soft0, max(u_feather * hw, -soft0), side) * fTop : 1.0;
      // (The tide marks only lightly broken by the streaks, so a strong setting reads as a rim.)
      best = st * pow(1.0 - te, u_fade) * (u_sheet * dry * body * streak + u_edge * tide * mix(1.0, streak, 0.35)) * inside;
    }
  }
  // Runnels: 1 to u_runnels of them (narrow stains hold fewer), each of its own width, wandering on its own.
  int k = u_runnels > 0 ? 1 + int(floor(hashI(ivec2(1, 31), rs) * float(u_runnels))) : 0;
  // (A stain narrower than about 2.5 runnel widths is the wash alone — a runnel would only be a dark core.)
  k = clamp(min(k, int(w / max(2.5 * u_runnel_width, 0.75))), 0, 16);
  // A free stain's runnels leave its seep together and part below it, so its head is one seep, not side-by-side points.
  float gather = led < 0.5 ? smoothstep(0.0, max(6.0, 0.25 * len), d.y) : 1.0;
  for (int j = 0; j < k; j++) {
    vec3 hr = hash3I(ivec2(j, 33), rs);
    float hb = hashI(ivec2(j, 35), rs);
    float lj = len * (0.45 + 0.55 * hr.x);
    float base = k == 1 ? 0.0 : ((float(j) + 0.5) / float(k) * 2.0 - 1.0) * 0.8;
    float wj = u_runnel_width * (0.6 + 0.7 * hr.y);
    // A runnel keeps most of its strength to its end (fade: how much it loses), where it may stop in a bead.
    float s0 = st * u_runnel_str * (0.7 + 0.3 * hb);
    float endS = s0 * mix(1.0, 0.35, clamp(0.5 * u_fade, 0.0, 1.0));
    // Its place across here (at its end, below it), once for the runnel and its bead.
    float yc = clamp(d.y, 0.0, lj);
    float xj = x - dr_bj(base, yc, lam, hwF, rs, j) * hwc * gather;
    if (d.y >= -0.5 - e && d.y <= lj + 0.5 + e) {
      float tj = yc / max(lj, 1e-3);
      float rw = max(wj * (1.0 - 0.5 * tj), 0.5);
      // Its ends: anti-aliased (or softened) like its sides, rather than cut; it starts below the lip, as the wash does.
      float dist = max(max(abs(xj) - 0.5 * rw, -min(d.y, lj - d.y)), -top);
      // (Off a ledge they start with the wash; a free stain's runnels gather a little after it, so its head is one
      // soft seep rather than separate dark points.)
      best = max(best, mix(s0, endS, tj) * dr_cov(dist) * mix(fTop * fTop, fTop, led));
    }
    // Bead: a drop (of its own size) where the runnel ends, a little stronger than the runnel there — an ellipse
    // narrower than it is tall, hanging from the runnel (a round one reads as a rivet).
    if (hb < u_beads) {
      vec2 rb = vec2(0.45, 0.85) * (wj * (0.6 + 0.9 * hr.z) + 0.6);
      float db = (length(vec2(xj, d.y - lj - 0.5 * rb.y) / rb) - 1.0) * rb.x;
      best = max(best, min(1.0, endS + 0.15 * u_runnel_str) * dr_cov(db));
    }
  }
  return best * dr_fadeIn(d.y);
}
#endif

GenOut gen(vec2 p) {
  vec2 q = vec2(p.x, uRes.y - p.y);          // user space, y down (the direction drips run)
#ifdef DR_RUNNELS
  bool runnels = u_style == 1;
#else
  const bool runnels = false;  // (so Streak compiles none of the Runnels code)
#endif
  float e = !u_aa ? 0.0 : u_soft;
  // Two sets of source cells: A the grid, B the ledges (whose drips start up to dr_shiftB px below their cells). For
  // each, the cells to visit: columns either side (cr) and rows from the row below (heads straddling a cell edge)
  // upward as far as a trail can run (at most 96 rows: longer trails are shortened to what the search reaches, so they
  // still fade out); as many columns either side as a stain can wander and spread.
  vec2 cellsA = vec2(float(u_cols), float(u_rows));
  vec2 csA = uRes / cellsA;
  vec2 cellsB = dr_cellsB();
  vec2 csB = uRes / cellsB;
  // (Set B's drips may start lower than their cells, at the ledge's foot: its search reaches that much further up.)
  float L = u_len_max * (1.0 + u_relief_len), sB = dr_shiftB();
  int upA = min(int(ceil(L / csA.y)) + 1, DR_MY);
  int upB = min(int(ceil((L + sB) / csB.y)) + 1, DR_MY);
  float tail = runnels ? 6.0 * u_runnel_width + 2.0 + e : e;
  float capA = max(float(upA) * csA.y - tail, float(upA - 1) * csA.y);
  float capB = max(max(float(upB) * csB.y - tail, float(upB - 1) * csB.y) - sB, 1.0);
  float reachX = 0.0;
#ifdef DR_RUNNELS
  if (runnels) reachX = u_wobble + 0.5 * u_width * (1.8 + max(-u_taper, 0.0) + 0.6 * u_shape_var) + 3.0 * u_runnel_width + 2.0 + e;
  else
#endif
  reachX = u_wobble + 0.5 * u_width + 0.5 * e + 0.5;
  int crA = clamp(int(ceil(reachX / csA.x)), 1, 6);
  int crB = clamp(int(ceil(reachX / csB.x)), 1, 12);
  // The farthest any stain reaches from its source — above it (yLo), below (its length + tail, or yHd for the head
  // blob) and either side (xMax: at the widest a ledge and Shape variation make it) — for the cheap test before a
  // cell's hashes. Bounds, not the search's reach: they must clip nothing.
  float yHd = u_head + 1.0 + e;
  float yLo = -max(2.0 + e + (runnels ? u_runnel_width : 0.0), yHd);
  float xMax = max(yHd, runnels ? u_wobble + 0.75 * u_width * (1.0 + max(-u_taper, 0.0) + 0.6 * u_shape_var) + 3.0 * u_runnel_width + 2.0 + e
                                : u_wobble + 0.5 * max(u_width, 1.0) + 1.0 + e);
  int nrA = upA + 2, nrB = upB + 2;
  // Surface flow: the rises met going down this pixel's column, summed from the top (t_flow, prepare); and just below
  // it, where the water pools against them.
  ivec2 pc = ivec2(floor(p));
  float Ap = 0.0, Aps = 0.0, Atot = 0.0, pool = 1.0;
  if (u_flow > 0.0) {
    Ap = texelFetch(t_flow, pc, 0).r;
    // (Averaged with 4 and 8 px above, so a trail weakens over a few px below a rise instead of being cut there.)
    int Hm = int(uRes.y) - 1;
    Aps = (Ap + texelFetch(t_flow, ivec2(pc.x, min(pc.y + 4, Hm)), 0).r + texelFetch(t_flow, ivec2(pc.x, min(pc.y + 8, Hm)), 0).r) / 3.0;
    Atot = texelFetch(t_flow, ivec2(pc.x, 0), 0).r;
    pool = 1.0 + 0.8 * u_flow * smoothstep(0.03, 0.25, texelFetch(t_flow, ivec2(pc.x, max(pc.y - 3, 0)), 0).r - Ap);
  }
  int ncA = 2 * crA + 1, ncB = 2 * crB + 1;
  int totA = u_density > 0.0 ? ncA * nrA : 0;
  int totB = u_ledge_density > 0.0 ? ncB * nrB : 0;
  int rowB0 = dr_rowB0();
  float best = 0.0, bestCov = 0.0, bestRnd = 0.0, acc = 0.0;
  // Streaks: they sway once per Wobble length (two octaves: a third of it and about all of it), slower still for a
  // wide wobble, so the trail meanders instead of zig-zagging (0.7 and 0.23 rad per px at 28 px and a small wobble).
  float wf = min(1.0, 0.7 / max(u_wobble, 1e-3)) * 28.0 / max(u_wander, 2.0);
  // One flat loop over the cells of both sets, with a uniform-derived count and the arguments picked
  // per iteration: nested or constant loops make D3D's compiler unroll, and each call site is inlined. (No continue:
  // ANGLE can miscompile it.)
  for (int n = 0; n < totA + totB; n++) {
    bool isB = n >= totA;
    int m = isB ? n - totA : n;
    int nc = isB ? ncB : ncA;
    int cr = isB ? crB : crA;
    vec2 cellsX = isB ? cellsB : cellsA;
    vec2 csX = isB ? csB : csA;
    float cseed = uSeed + (isB ? 7919.0 : 0.0);
    int jj = m / nc;
    ivec2 c = ivec2(floor(q / csX)) + ivec2(m - jj * nc - cr, 1 - jj);
    ivec2 cw;
    vec2 src;
    float rnd, drop, lcov;
    if (dr_cell(c, cellsX, csX, isB ? rowB0 : 0, cseed, cw, src, rnd, drop, lcov)) {
      vec2 d = q - src;
      float cap = isB ? capB : capA;
      // (Fine ledge grids visit hundreds of cells: rule out the stains that can't reach this pixel before hashing.)
      if (d.y >= yLo && d.y <= max(cap + tail, yHd) && abs(d.x) <= xMax) {
      float len = min(mix(u_len_min, u_len_max, hashI(cw, cseed + 13.0)) * (1.0 + u_relief_len * drop), cap);
      float w = u_width * (1.0 - u_width_var * hashI(cw, cseed + 17.0));
      // (Less water runs off a short ledge — a rivet's lower edge — than off a whole lip.)
      float st = u_start * (1.0 - u_str_var * hashI(cw, cseed + 23.0)) * mix(0.45, 1.0, lcov);
      float v = 0.0, cov = 0.0;
      // Optional drop blob at the origin.
      if (u_head > 0.0) {
        float ch = dr_cov(length(d) - u_head);
        if (ch > 0.0) { v = 1.0; cov = ch; }
      }
#ifdef DR_RUNNELS
      if (runnels) {
        // Shape variation: each stain its own seep width (¼ to 4 ×), fan-out and taper (± 0.6) — at 1 point seeps and
        // wide Vs among the lines.
        vec3 sh = vec3(u_seep, u_fan, u_taper);
        vec3 hv = hash3I(cw, cseed + 29.0) - 0.5;
        if (u_shape_var > 0.0) {
          sh = clamp(vec3(u_seep * exp2(4.0 * u_shape_var * hv.x), u_fan + 1.2 * u_shape_var * hv.y, u_taper + 1.2 * u_shape_var * hv.z), vec3(0.05, 0.0, -1.0), vec3(1.0));
        }
        // A drip from a ledge starts on the ledge's own line (by how far it runs: a lip all the way, a rivet's short
        // lower edge only a little); its seep — Seep width × its width, centred on the ledge spot — fans out by
        // Fan-out like any stain's, and some are broader, so neighbours along a lip meet in one band under it.
        float led = drop > 1e-4 ? lcov : 0.0;
        w *= 1.0 + 0.5 * led * (hv.x + 0.5);
        // A drip off a short ledge (a rivet) runs on longer, faint, past the next rivet down rather than stopping.
        if (drop > 1e-4) len = min(len * mix(1.6, 1.0, lcov), cap);
        // Its seed: a full-width hash of its cell (whole, and exact as a float), so no two stains share their shape.
        float rs = float(pcg3(uvec3(uvec2(cw), uint(cseed) + 977u)) >> 9u);
        float sr = dr_runnels(d, len, w, st, rs, sh, led);
        if (sr > v * cov) { v = sr; cov = 1.0; }
      } else
#endif
      if (d.y >= -0.5 * e && d.y <= len) {
        // Trail below the source.
        float t = clamp(d.y / max(len, 1e-3), 0.0, 1.0);
        float cx = u_wobble * (sin(d.y * 0.7 * wf + rnd * 40.0) * 0.6 + sin(d.y * 0.23 * wf + rnd * 17.0) * 0.4);
        // (Head rounding: its top capped in a half-ellipse, Head rounding × its width tall.)
        float hw = 0.5 * w * (1.0 - 0.5 * t) * dr_cap(d.y, u_head_round * w);
        if (!u_aa) { cx = floor(cx + 0.5); hw = max(hw, 0.5); }
        float ct = dr_cov(abs(d.x - cx) - hw) * (e > 0.0 ? smoothstep(-0.5 * e, 0.5 * e, d.y) : 1.0);
        float vt = st * pow(1.0 - t, u_fade) * dr_fadeIn(d.y);
        if (ct > 0.0 && vt * ct > v * cov) { v = vt; cov = ct; }
      }
      // Surface flow: weaker for every rise crossed since the source (in this pixel's column — a rivet leaves a dry
      // shadow, a seam a break), stronger where it pools just above one.
      if (u_flow > 0.0 && v * cov > 0.0) {
        // (Counted from a few px below the source: a drip's own ledge — the groove under a lip — doesn't dim it.)
        int ys = int(floor(src.y)) + int(u_ledge_reach + 0.5) + 3;
        int H = int(uRes.y);
        float As = ys >= 0 ? texelFetch(t_flow, ivec2(pc.x, H - 1 - min(ys, H - 1)), 0).r
                 : uTile ? texelFetch(t_flow, ivec2(pc.x, clamp(-1 - ys, 0, H - 1)), 0).r - Atot : 0.0;
        // (Each trail its own: some pass a rivet or a seam that stops others.)
        float hf = hashI(cw, cseed + 37.0);
        float fs = u_flow * (0.1 + 1.9 * hf * hf);
        // (A rivet-sized rise — under about a quarter of a height unit — doesn't weaken it: the trail runs on past the
        // next rivet, gathering darker just above it.)
        v *= pool / (1.0 + 3.0 * fs * max(Aps - As - 0.25, 0.0));
      }
      if (v * cov > best * bestCov) { best = v; bestCov = cov; bestRnd = rnd; }
      // (Overlapping stains add up — water from a column of rivets darkens all the way down rather than restarting
      // at each one.)
      acc = 1.0 - (1.0 - acc) * (1.0 - clamp(v * cov, 0.0, 1.0));
      }
    }
  }
  // Soft coverage = strength (at most 1), so a Normal diffuse blend stains in proportion to it. No shape.
  return genOut(acc, acc, bestRnd, NO_SDF);
}
`
};
