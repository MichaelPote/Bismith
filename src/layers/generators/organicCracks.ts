// Organic cracks (FR7.2a): dried mud / cracked rock / lava crust / crazed glaze — pillowy plates split by a bent, jagged
// crack network whose cracks vary in width and flare into wedges at the junctions, with a finer, partial second
// generation of cracks (branches tapering off the main ones, or a faint hairline network) and patches shattered into
// shards. It has a combined output (plate value × its own bevel, the cracks sunk by their width; the plate outline
// goes to its mask, genOutOwn) and an SDF output for the mask. Plates can dome, curl and tilt in Height
// (GenOut.hval), sink round wide cracks (halo) and carry a fine roughness.

import { P } from '@/core/params';
import type { ParamValues } from '@/core/params';
import { PX_SCALE_PARAM } from '../commonParams';
import type { LayerDef } from '../types';
import { ORG_GLSL } from './organicShared';

const fineOn = (p: ParamValues) => Number(p.sub) > 0;

export const cracksLayer: LayerDef = {
	type: 'cracks',
	noise: true,
	label: 'Cracked crust',
	category: 'pattern',
	kind: 'generator',
	sdf: true,
	description:
		'Cracked plates: Made from a bent, jagged network of cracks of varied widths, with finer cracks branching off them and domed, tilted plates between. Makes dried mud, cracked rock, lava crust.',
	params: [
		P.enum(
			'output',
			'Output',
			'plates',
			[
				['plates', 'Plates (bevel × coverage)'],
				['shape', 'Plate shapes (SDF)']
			],
			{
				hint: 'Plates: value 1 on the plates with the Shape bevel at their edges and 0 in the cracks (the cracks still get painted, with the low end of the gradient ramps); the plate outline goes to the mask it writes. Shape: just the outline of the plates, so the cracks show what is below'
			}
		),
		P.float('scale', 'Plates across', 5, 0.5, 256, {
			softMax: 32,
			step: 0.01,
			hint: 'How many main plates fit across the texture (rounded when tiling)'
		}),
		P.float('jitter', 'Jitter', 0.9, 0, 1, {
			step: 0.001,
			hint: 'Makes the plates irregular (0 = a square grid, 1 = fully random)'
		}),
		P.float('size_var', 'Size variation', 0.5, 0, 2, {
			softMax: 1,
			step: 0.001,
			hint: 'Makes the main plates different sizes (above 1, small plates get squeezed out between big ones)'
		}),
		P.float('width', 'Crack width', 2.5, 0, 64, { softMax: 12, unit: 'px', step: 0.05, section: 'Cracks' }),
		P.float('width_var', 'Width variation', 0.8, 0, 1, {
			step: 0.001,
			section: 'Cracks',
			hint: 'Makes some cracks wider than others (from one junction to the next), each one swelling and narrowing along its length. The fine cracks vary too, from their full width down to faint hairlines'
		}),
		P.float('fillet', 'Junction rounding', 0.05, 0, 0.5, {
			step: 0.001,
			section: 'Cracks',
			hint: "Rounds the plates' corners (radius in plate sizes, larger where the meeting cracks are wide), so the cracks flare into dark wedges where they meet and the plates look like pillows. Rounds fine plates and fragments too (0 = sharp corners)"
		}),
		P.float('bulge', 'Bulging sides', 0.08, 0, 0.4, {
			softMax: 0.25,
			step: 0.001,
			section: 'Cracks',
			hint: 'Bows each crack to one side in an arc between its junctions (up to this share of a plate), so the plates get curved, pillowy sides instead of straight ones'
		}),
		P.float('zigzag', 'Zigzag', 0.6, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			section: 'Cracks',
			hint: 'Zig-zags the cracks off their path by up to this much, as straight runs with sharp kinks a few times that far apart, like a real crack (0 = smooth)'
		}),
		P.float('jag', 'Edge roughness', 0.25, 0, 8, {
			softMax: 3,
			unit: 'px',
			step: 0.01,
			section: 'Cracks',
			hint: 'Roughens the crack edges at the pixel scale. Above half the crack width, the cracks break up into dashes'
		}),
		P.float('warp', 'Warp', 0.2, 0, 2, {
			softMax: 1,
			step: 0.001,
			section: 'Cracks',
			hint: 'Bends the cracks into curves, in plate sizes (up to 0.3 = gently curved edges; 1 = they wander up to about a plate off their straight course)'
		}),
		P.float('warp_scale', 'Warp scale', 0.8, 0.1, 16, {
			softMin: 0.25,
			softMax: 4,
			step: 0.01,
			section: 'Cracks',
			showIf: (p) => Number(p.warp) > 0,
			hint: 'How many bends per plate (below 1 = long sweeps that carry several plates along; above 1 = cracks that wiggle between their junctions)'
		}),
		P.enum(
			'warp_mode',
			'Warp style',
			'bend',
			[
				[
					'bend',
					'Bend',
					'bends the cracks into curves and meanders while the plates keep their sizes; high values swirl them around eddies, like flowing lava crust'
				],
				[
					'squeeze',
					'Squeeze',
					'bunches the plates up in places and spreads them out in others; high values pack the cracks into parallel bands, like sheared, compressed crust'
				]
			],
			{ section: 'Cracks', showIf: (p) => Number(p.warp) > 0 }
		),
		P.float('sub', 'Fine cracks', 0.55, 0, 1, {
			step: 0.001,
			section: 'Fine cracks',
			hint: 'How many of the finer crack segments get drawn (each segment between two fine plates is kept or dropped; 0 = none)'
		}),
		P.float('sub_scale', 'Fine plates per plate', 2.5, 1, 16, {
			softMax: 6,
			step: 0.01,
			section: 'Fine cracks',
			showIf: (p) => fineOn(p) || Number(p.shatter) > 0,
			hint: 'How many fine plates fit across each main plate'
		}),
		P.float('sub_width', 'Fine crack width', 1.25, 0, 32, {
			softMax: 6,
			unit: 'px',
			step: 0.05,
			section: 'Fine cracks',
			showIf: fineOn,
			hint: 'Sets the width of the fine cracks where they leave a main crack'
		}),
		P.float('sub_taper', 'Fine crack taper', 0.7, 0, 1, {
			step: 0.001,
			section: 'Fine cracks',
			showIf: fineOn,
			hint: 'Narrows the fine cracks away from the main cracks (0 = the same width everywhere; 1 = they branch off the main cracks and run out to a point inside the plates)'
		}),
		P.float('sub_tone', 'Fine crack darkness', 1, 0, 1, {
			step: 0.001,
			section: 'Fine cracks',
			showIf: (p) => fineOn(p) && p.sub_shape !== true,
			hint: 'Colour only: darkens the fine cracks (low values leave a faint grey network of hairlines)'
		}),
		P.float('sub_depth', 'Fine crack depth', 0.55, 0, 1, {
			step: 0.001,
			section: 'Fine cracks',
			showIf: (p) => fineOn(p) && p.sub_shape !== true,
			hint: "Height only: sets how deep the fine cracks are, as a share of the main cracks' depth. They're shallower grooves with the bevel's rounded shoulders that fade out along with the taper; colour still draws them dark"
		}),
		P.bool('sub_connect', 'Connected only', true, {
			section: 'Fine cracks',
			showIf: fineOn,
			hint: 'Drops fine cracks that touch neither a main crack nor another fine crack (floating strokes), and runs a fine crack that ends inside a plate out to a point rather than stopping bluntly'
		}),
		P.bool('sub_shape', 'Fine cracks in shape', false, {
			section: 'Fine cracks',
			showIf: fineOn,
			hint: 'On: the fine cracks cut the plates like the main ones, at full depth, in the mask and in the Shape output. Off: they become grooves with their own depth (Fine crack depth) on the plates, and the mask holds only the main network'
		}),
		P.bool('sub_cross', 'Cross main cracks', false, {
			section: 'Fine cracks',
			showIf: fineOn,
			hint: 'On: lays one fine network over the whole texture, with its cracks running straight across the main ones. Off: cracks each plate separately, so the fine cracks end at the main cracks in T-junctions, like drying mud'
		}),
		P.bool('sub_vary', 'Fine plates vary', false, {
			section: 'Fine cracks',
			showIf: fineOn,
			hint: 'Gives each fine plate a separate random value (for colour jitter and per-feature height), not just each main plate. Where a fine crack is missing, the change shows without a crack, so this works best with Fine cracks near 1'
		}),
		P.float('shatter', 'Shattered', 0, 0, 1, {
			step: 0.001,
			section: 'Shatter',
			hint: 'Shatters some of the fine plates (or the cells they would make, with Fine cracks at 0) into small shards, with a mesh of dark cracks and a crack round the outside, making patches of crazing between the whole plates (0 = off)'
		}),
		P.float('shatter_scale', 'Shards per patch', 5, 1.5, 16, {
			softMax: 8,
			step: 0.01,
			section: 'Shatter',
			showIf: (p) => Number(p.shatter) > 0,
			hint: 'How many shards fit across a shattered patch (one fine plate)'
		}),
		P.float('depth_var', 'Depth by width', 0.5, 0, 1, {
			step: 0.001,
			section: 'Cracks',
			hint: 'Makes narrow stretches of crack shallower and lighter than wide ones and the junctions, which go to the bottom of the gradient ramp (colour and Height); their shoulders follow the Shape bevel (0 = every crack equally deep)'
		}),
		P.float('halo', 'Depth halo', 0.3, 0, 1, {
			step: 0.001,
			section: 'Plates',
			hint: 'Sinks and softly darkens the plates around wide cracks and their junctions, as if the ground gave way there (colour and Height)'
		}),
		P.float('rough', 'Surface grain', 0.3, 0, 1, {
			step: 0.001,
			section: 'Plates',
			hint: 'Height only: adds a fine, grainy unevenness over the plates'
		}),
		P.float('dome', 'Dome', 0.35, -1, 1, {
			step: 0.001,
			section: 'Plates',
			hint: "Height only: bulges the plates (above 0: the edges fall away towards the cracks) or curls their edges up into a lip, like drying mud (below 0). A share of the layer's height"
		}),
		P.float('dome_edge', 'Dome reach', 0.5, 0.05, 1, {
			step: 0.001,
			section: 'Plates',
			showIf: (p) => Number(p.dome) !== 0,
			hint: 'Sets how far in from the cracks the dome falls or the curl rises (small = only a narrow rim, so a flat plate with rounded-off or curled-up edges; 1 = all the way to the middle, so a full dome or a deep dish)'
		}),
		P.float('tilt', 'Tilt', 0.3, 0, 1, {
			step: 0.001,
			section: 'Plates',
			hint: "Height only: tilts each plate in a random direction by a random amount up to this (a share of the layer's height), so the plates look heaved and settled"
		}),
		// Not a control: 1 px of the texture in shader px (supersampling scales it), for the noise scales tied to output
		// pixels (the edge roughness, the zig-zag's shortest kinks).
		PX_SCALE_PARAM,
		P.seed()
	],
	// Added in the editor: crack widths, zig-zag and bevel in proportion to the texture (the defaults suit 512 px); on
	// small textures fewer plates and fewer, longer fine cracks, which would otherwise turn to specks.
	fresh: (t) => {
		const k = Math.sqrt(t.width * t.height) / 512;
		const r = (v: number) => Math.round(v * 20) / 20;
		const small = k <= 0.25;
		return {
			scale: k <= 0.125 ? 3 : small ? 4 : 5,
			width: r(Math.max(1, 2.5 * k)),
			sub_width: r(Math.max(0.75, 1.25 * k)),
			zigzag: r(Math.max(0.3, 0.6 * k)),
			bevel: r(Math.max(0.75, 2 * k)),
			...(small ? { sub: 0.45, sub_taper: 0.4 } : {})
		};
	},
	defaults: {
		bevel: 2,
		profile: 'smooth',
		h_on: true,
		h_amount: 0.3,
		h_var: 0.3,
		dif_on: true,
		// Crack colour only at the very bottom, so the bevel shades plate edges rather than widening cracks.
		dif_grad: {
			stops: [
				{ pos: 0, color: '#1e150d' },
				{ pos: 0.3, color: '#4a3624' },
				{ pos: 0.7, color: '#6b5038' },
				{ pos: 1, color: '#7a5e43' }
			]
		},
		dif_jitter: 0.15
	},
	glsl:
		ORG_GLSL +
		/* glsl */ `
// Screen px per px of the warped plane across a border with unit normal n there: J's columns are how the warped point
// moves per screen px right and up (its screen-space derivatives), so a crack keeps its width wherever the warp
// stretches or squeezes the plane. (n * J is the normal taken back to the screen.)
float crk_scale(vec2 n, mat2 J) {
  return max(length(n * J), 1e-3);
}

// Order-independent key of a cell pair (wrapped ids), so both cells agree on the pair's randoms; aLo: a sorts first.
ivec2 crk_pairKey(ivec2 a, ivec2 b, out bool aLo) {
  aLo = a.x < b.x || (a.x == b.x && a.y < b.y);
  return aLo ? a * 7919 + b : b * 7919 + a;
}

// A crack band's offset from its half width h (px): under a pixel wide the band shrinks below zero, so its darkest
// pixel goes as its width (it fades instead of staying a half-dark 1 px line).
float crk_band(float h) { return h < 0.5 ? 2.0 * h - 0.5 : h; }

// Rounded intersection of two inside distances (px, > 0 inside): a corner where both are within R of their borders
// becomes a circular arc of radius R (at a right angle; wider angles round less), exact elsewhere. Rounding the plates'
// corners leaves the gap between three plates as a dark wedge with concave sides — where cracks meet, they flare.
float crk_round(float a, float b, float R) {
  R = max(R, 1e-4);
  return max(R, min(a, b)) - length(max(vec2(R - a, R - b), 0.0));
}

// The main plates: power-weighted Voronoi cells, each border a crack of its own width.
//   halfW   half the crack width (px); wVar spreads the cracks' widths (one random per border segment, both sides
//           agreeing) and flares them towards the junctions.
//   fillet  Junction rounding: the plate's corners round off (crk_round) with a radius of this share of a plate, larger
//           where the meeting cracks are wide; the crack band is then laid round the rounded plate, its width blended
//           between the two nearest borders' near where they swap (no step at a junction).
//   bulge   each border bows to one side (per cell pair a random side and 45–100 % of this share of a plate, so no
//           border runs straight) in an arc that flattens out towards the junctions: curved, pillowy sides. A pixel
//           the bow carries across the border belongs to the neighbouring plate.
//   J       the warp's screen-space derivatives (crk_scale).
// Returns:
//   x  distance (screen px) to the edge of the crack band (> 0 on a plate)
//   y  distance to the nearest border
//   z  per-plate random
//   w  a smooth soft minimum of the distances to the plate's borders in the warped plane (no creases along the plate's
//      skeleton, no per-pixel-quad derivatives: for the plate surface)
// and off = the pixel's offset from the plate's site (warped plane), nb = the nearest border's normal, hw = x the
// band's half width there (px), y the distance to the second nearest border (small only near a junction), z the half
// width that sets the crack's depth (x plus what the rounding opens at a junction of wide cracks; thin cracks'
// junctions stay as shallow as the cracks), kS = for Bevel aspect (GLSL_BEVEL) the local stretch, px of Bevel per px across the
// borders: the same rounded minimum taken over each border's distance in the space the aspect stretches (× Bevel / its
// width across that border's screen normal), over the plain one; continuous through the plates' corners, so their
// bevels don't step there.
vec4 crk_plates(vec2 p, vec2 cells, float jitter, float sizeVar, float halfW, float wVar, float fillet, float bulge, mat2 J, float seed, out vec2 off, out vec2 nb, out vec3 hw, out float kS) {
  ivec2 per = periodOf(cells);
  vec2 cs = uRes / cells;
  float P = sqrt(cs.x * cs.y);
  ivec2 ip = ivec2(floor(p / cs));
  float wScale = sizeVar * cs.x * cs.y * 0.45;
  float best = 1e20;
  vec2 bs = p;
  float bw = 0.0;
  ivec2 bc = ip, bwc = imod(ip, per);
  // m, h1: the nearest border and its half width; m2, h2 the next; dr the rounded distance. For the nearest border also
  // its neighbour cell cN and site sN, warped distance qN, screen px per warped px kN and signed bow bN.
  float m = 1e9, m2 = 1e9, h1 = 0.0, h2 = 0.0, dr = 1e9, qN = 0.0, kN = 1.0, bN = 0.0;
  // (Bevel aspect: drS as dr, stretched; fN the nearest border's stretch.)
  bool asp = bevelAspectOn();
  float drS = 1e9, fN = 1.0;
  ivec2 cN = ip;
  vec2 sN = p;
  // The plate surface's soft minimum: sum of exp(-distance / sk) over the borders.
  float sk = 0.12 * P, acc = 0.0;
  float rad = fillet * P;
  nb = vec2(1.0, 0.0);
  vec2 n2 = vec2(-1.0, 0.0);
  // One flat loop (see UNI_1): the 5×5 cells around p for the nearest site, then the 5×5 around that site. (No
  // \`continue\`: ANGLE / D3D11 can miscompile it; skipped passes are an if.)
  for (int e = 0; e < 50 * UNI_1; e++) {
    bool near = e < 25;
    int f = near ? e : e - 25;
    ivec2 g = ivec2(f % 5 - 2, f / 5 - 2);
    if (near || g != ivec2(0)) {
      ivec2 c = (near ? ip : bc) + g;
      vec3 sw = org_powerSite(c, per, cs, jitter, wScale, seed);
      vec2 s = sw.xy;
      float w = sw.z;
      float L = length(s - bs);
      if (near) {
        float pd = dot2(s - p) - w;
        if (pd < best) { best = pd; bs = s; bw = w; bc = c; bwc = imod(c, per); }
      } else if (L >= 1e-4) {
        vec2 n = (s - bs) / L;
        float dq = org_powerBisector(p, s, w, bs, bw, L);
        float k = crk_scale(n, J);
        float d = dq / k;
        acc += exp(-dq / sk);
        // This border's width and bow: hashes of the cell pair, so both plates agree. The bow's sign says which plate
        // it bulges into.
        bool aLo;
        vec2 r = hash2I(crk_pairKey(bwc, imod(c, per), aLo), seed + 61.0);
        float hh = halfW * mix(1.0, 0.55 + 0.9 * r.x * r.x, wVar);
        // The corner's radius: the plate share, × 0.5–1.5 with the two cracks' widths against the mean (thin cracks
        // meet in tight corners, wide ones in broad wedges).
        float rr = rad * (0.5 * (h1 + hh) / max(halfW, 1e-3));
        dr = crk_round(dr, d, rr);
        float fa = asp ? bevelLine(1.0, n * J) : 1.0;
        if (asp) drS = crk_round(drS, d * fa, rr);
        if (d < m) { m2 = m; h2 = h1; n2 = nb; m = d; h1 = hh; nb = n; cN = c; sN = s; qN = dq; kN = k; fN = fa; bN = (aLo ? 1.0 : -1.0) * (r.y < 0.5 ? -1.0 : 1.0) * (0.45 + 1.1 * abs(r.y - 0.5)); }
        else if (d < m2) { m2 = d; h2 = hh; n2 = n; }
      }
    }
  }
  float hx = mix(h1, h2, 0.5 - 0.5 * clamp((m2 - m) / max(rad, 2.0), 0.0, 1.0));
  // Wider towards the junctions where wide cracks meet (thin ones keep thin Y-junctions): where the second border is
  // near too, and meets the first at a corner — not where the two run side by side across a thin sliver of plate
  // (their normals opposed).
  float wg = smoothstep(0.7, 1.3, (h1 + h2) / max(2.0 * halfW, 1e-3));
  hx *= 1.0 + 1.5 * wVar * exp(-m2 / (0.15 * P)) * smoothstep(-0.95, -0.6, dot(nb, n2)) * wg;
  float open = max(m - dr, 0.0) * wg;
  // The nearest border's bow (warped px, > 0 into this plate): an arc along it, t = -1 … 1 over about its length,
  // flattened towards the junctions so neighbouring borders still meet.
  vec2 tg = vec2(nb.y, -nb.x);
  float t = dot(p - 0.5 * (bs + sN), tg) / max(0.5 * length(sN - bs), 1e-3);
  // A half sine over t = -1 … 1 that carries on as a gentle S along borders longer than that, so long cracks don't run
  // dead straight; fading out with the distance from the border too, so where another border becomes the nearest
  // inside the plate the bow is gone (no seam along the plate's skeleton).
  // Never more than a third of the way to the second border, so near a junction the bowed crack can't fold over
  // (notches, doubled lines).
  float S = bulge * P * bN * sin(1.5708 * (t + 1.0)) * smoothstep(0.0, 0.5 * P, m2 * kN) * max(1.0 - qN / (0.45 * P), 0.0);
  S = clamp(S, -0.33 * m2 * kN, 0.33 * m2 * kN);
  float db = qN - S;
  float soft = -sk * log(max(acc + exp(-abs(db) / sk) - exp(-qN / sk), 1e-30));
  dr -= S / kN;
  drS -= S / kN * fN;
  m = abs(m - S / kN);
  if (db < 0.0) {
    // Carried across the border by its bow: the neighbouring plate's pixel, on its side of the crack.
    bs = sN;
    bc = cN;
    nb = -nb;
    dr = -dr;
    drS = -drS;
    soft = -db;
  }
  kS = abs(dr) > 0.05 ? drS / dr : fN;
  off = p - bs;
  hw = vec3(hx, m2, hx + open);
  return vec4(dr - hx, m, hashI(imod(bc, per), seed + 17.0), max(soft, 0.0));
}

// A tapering fine segment's reach from the main crack (px) for its random y: 0.12–0.87 of a plate, mostly short.
float crk_reach(float y, float plate) { return plate * (0.12 + 0.75 * y * y); }

// Whether the fine segment between cells a and b (wrapped ids) is present: an order-independent pair hash (so both sides
// agree), x < keep; y = the segment's taper reach (random). A plate key (not 0) gives each main plate its own segments.
vec2 crk_segment(ivec2 a, ivec2 b, int key, float seed) {
  bool aLo;
  return hash2I(crk_pairKey(a, b, aLo) + ivec2(key, 0), seed + 53.0);
}

// Fine cracks: Voronoi borders where each border segment (cell pair) is present with probability \`keep\`, so partial
// cracks end at junctions instead of dotting out.
//   halfW   their half width (px); wVar spreads the segments' widths a little (the caller varies halfW smoothly, so
//           neighbouring segments stay alike).
//   key     a plate key (not 0): each main plate draws its own segments, so a fine crack stops at a main crack (a
//           T-junction) rather than crossing it.
//   taper   each segment narrows with mainD, the pixel's distance (px) from the main cracks, to nothing at its own
//           reach (crk_reach: 0.12–0.87 of a plate size, mostly short, × 1 / taper): branches off the main cracks, of
//           different lengths.
//   connect the nearest segment is followed to its two ends (where its line leaves the fine cell). It is dropped when
//           its end towards the main crack (normal mainN points at it) neither reaches that crack nor meets another
//           present segment (a floating stroke), or when it runs close beside the main crack (doubling it); it runs out
//           to a point towards an inner end where nothing continues it, or when it is too short to read (a speck).
//   fillet  rounds the fine cells' corners (crk_round, this share of a fine cell).
//   J       the warp's screen-space derivatives (crk_scale).
// Returns:
//   x  distance (px) to the edge of the nearest fine crack
//   y  fine-cell rnd
//   z  that crack's strength (its width against the mean, 0.5–1.5 … 0 at its tip; scales its tone and groove)
//   w  distance (px) to the fine cell's border, present or not
// and site = the pixel's cell site, kS = the local stretch for Bevel aspect, as crk_plates', over the present
// segments' lines.
vec4 crk_fineCracks(vec2 p, vec2 cells, float jitter, float keep, float halfW, float wVar, float fillet, float taper, float mainD, vec2 mainN, float plate, int key, bool connect, mat2 J, float seed, out vec2 site, out float kS) {
  ivec2 per = periodOf(cells);
  vec2 cs = uRes / cells;
  ivec2 ip = ivec2(floor(p / cs));
  float best = 1e20;
  vec2 bs = p;
  ivec2 bc = ip, bw = ip;
  // The nearest present segment (band b1: its distance d1, half width h1, strength t1, other cell's index i1 in the
  // 5×5 and site s1, normal n1) and the next nearest band (b2, t2), the fallback when the nearest is dropped.
  float b1 = 1e9, b2 = 1e9, d1 = 0.0, h1 = 0.0, t1 = 0.0, t2 = 0.0;
  // All present bands through crk_round (sm), for the rounding at their junctions; raw = the nearest border.
  float sm = 1e9, raw = 1e9, rad = fillet * sqrt(cs.x * cs.y);
  // (Bevel aspect: the nearest present line, plain (lE) and stretched (lS), and the nearest one's stretch f1.)
  bool asp = bevelAspectOn();
  float lE = 1e9, lS = 1e9, f1 = 1.0;
  int i1 = 12;
  vec2 s1 = p, n1 = vec2(1.0, 0.0);
  // The 5×5 sites around the nearest one, kept for following the nearest segment to its ends below.
  vec2 nbr[25];
  // One flat loop (see UNI_1): the 3×3 cells for the nearest site, then the 5×5 around it for the borders.
  for (int e = 0; e < 34 * UNI_1; e++) {
    bool near = e < 9;
    int f = near ? e : e - 9;
    ivec2 g = near ? ivec2(f % 3 - 1, f / 3 - 1) : ivec2(f % 5 - 2, f / 5 - 2);
    ivec2 c = (near ? ip : bc) + g;
    ivec2 cw = imod(c, per);
    vec2 s = (vec2(c) + 0.5 + (cellPoint(cw, seed) - 0.5) * jitter) * cs;
    if (near) {
      float d = dot2(s - p);
      if (d < best) { best = d; bs = s; bc = c; bw = cw; }
    } else {
      nbr[f] = s;
      vec2 ab = s - bs;
      float L = length(ab);
      // (L = 0: the pixel's own cell.)
      if (L >= 1e-4) {
        vec2 n = ab / L;
        float dist = max((dot2(p - s) - dot2(p - bs)) / (2.0 * L), 0.0) / crk_scale(n, J);
        raw = min(raw, dist);
        vec2 sh = crk_segment(bw, cw, key, seed);
        if (sh.x < keep) {
          // The segment's width: sh.x / keep is a uniform random over the present segments.
          float wr = mix(1.0, 0.5 + sh.x / max(keep, 1e-4), wVar);
          float h = halfW * wr, st = wr, u = 0.0;
          if (taper > 0.0) {
            // u: 0 at the main crack, 1 at this segment's tip.
            u = taper * mainD / crk_reach(sh.y, plate);
            float t = clamp(1.0 - u, 0.0, 1.0);
            st *= t;
            h *= t;
          }
          // The band (crk_band). Past the tip its distance climbs away, so a bevel (with the fine cracks in the shape)
          // runs out a little beyond the visible end instead of drawing the rest of it.
          float b = dist + max(u - 1.0, 0.0) * 12.0 * (u_bevel + 1.0) - crk_band(h);
          sm = crk_round(sm, b, rad);
          float fa = asp ? bevelLine(1.0, n * J) : 1.0;
          lE = min(lE, dist);
          lS = min(lS, dist * fa);
          if (dist <= lE) f1 = fa;
          if (b < b1) { b2 = b1; t2 = t1; b1 = b; d1 = dist; h1 = h; t1 = st; i1 = f; s1 = s; n1 = n; }
          else if (b < b2) { b2 = b; t2 = st; }
        }
      }
    }
  }
  // How far the rounding lowers the nearest band (dropped below when that band falls back to the next one).
  float fil = b1 < 1e8 ? b1 - sm : 0.0;
  if (connect && b1 < 1e8 && b1 < max(u_bevel, 1.0) + 2.0) {
    // The nearest segment's ends: its line through the pixel's foot p0, followed to the first other border of the cell
    // towards the main crack (tp, cell index ip_, vertex vP) and away from it (tm, im).
    vec2 dir = vec2(n1.y, -n1.x);
    if (dot(dir, mainN) < 0.0) dir = -dir;
    vec2 p0 = p - n1 * dot(p - 0.5 * (bs + s1), n1);
    float tp = 1e9, tm = 1e9;
    int jp = i1, jm = i1;
    for (int f = 0; f < 25 * UNI_1; f++) {
      vec2 nc = nbr[f] - bs;
      float lc = length(nc);
      if (f != 12 && f != i1 && lc >= 1e-4) {
        nc /= lc;
        float den = dot(dir, nc), num = dot(0.5 * (bs + nbr[f]) - p0, nc);
        if (den > 1e-4) { if (num / den < tp) { tp = num / den; jp = f; } }
        else if (den < -1e-4) { if (num / -den < tm) { tm = num / -den; jm = f; } }
      }
    }
    // The main crack's distance at the ends (its border taken as straight from here).
    vec2 vP = p0 + dir * tp;
    float mP = mainD - dot(vP - p, mainN), mM = mainD - dot(p0 - dir * tm - p, mainN);
    // Does a segment go on from each end — the cell's border there, or the far cell's — present and, tapering, not past
    // its tip there; at the crack-ward end also heading on towards the main crack (else two strokes meeting in a V
    // would keep each other)? Four pair tests in one loop.
    ivec2 w1 = imod(bc + ivec2(i1 % 5 - 2, i1 / 5 - 2), per);
    bool atP = false, atM = false;
    for (int i = 0; i < 4 * UNI_1; i++) {
      bool plus = i < 2, own = i % 2 == 0;
      int j = plus ? jp : jm;
      vec2 o = crk_segment(own ? bw : w1, imod(bc + ivec2(j % 5 - 2, j / 5 - 2), per), key, seed);
      bool on = o.x < keep && (taper <= 0.0 || taper * max(plus ? mP : mM, 0.0) < crk_reach(o.y, plate));
      if (plus && on) {
        // That border's way out of the vertex: along it, away from the third cell.
        vec2 dv = normalize(nbr[j] - (own ? bs : s1));
        dv = vec2(dv.y, -dv.x);
        if (dot(dv, (own ? s1 : bs) - vP) > 0.0) dv = -dv;
        on = dot(dv, mainN) > 0.0;
      }
      if (on) { if (plus) atP = true; else atM = true; }
    }
    // A segment running within ~40° of the main crack close beside it would double it (or close a little box against
    // it): dropped too (judged at its middle, so the whole segment goes).
    bool doubled = abs(dot(n1, mainN)) > 0.77 && 0.5 * (mP + mM) < 0.3 * plate;
    // Under ~8 px long it would only be a speck or a floating dash.
    if ((mP > 1.0 && !atP) || doubled || tp + tm < 8.0) { b1 = b2; t1 = t2; fil = 0.0; }
    else if (!atM) {
      // A dead end inside the plate: narrows along its whole length to a point at that end.
      float k = clamp(tm / max(tp + tm, 1e-3), 0.0, 1.0);
      float h = h1 * k;
      b1 = min(d1 - crk_band(h), b2);
      t1 *= k;
    }
  }
  site = bs;
  kS = lE > 1e-3 ? lS / lE : f1;
  return vec4(b1 - fil, hashI(bw, seed + 17.0), t1, raw);
}

// Steps of the Bend and Squeeze warps: the pixel flows along a fixed smooth noise field in small steps, so the cracks bend
// as far as a plain displacement would move them but don't fold over (each step stretches the plane only a little).
// Bend follows the field's curl (divergence-free: plates keep their areas, high values swirl round eddies), Squeeze the
// field itself (plates bunch up where it converges and spread where it diverges).
#define CRK_STEPS 8

GenOut gen(vec2 p) {
  vec2 cells = cellsFor(u_scale, 1.0);
  vec2 cs = uRes / cells;
  float L = sqrt(cs.x * cs.y);
  bool curl = u_warp_mode == 0;
  // The noise, in one flat loop (one copy of its code; see UNI_1), the arguments picked per pass:
  //   e <  3·STEPS  the warp of the main cracks, three passes per step at the flowing point q. Bend: the field there
  //                 and a small step right and up (its gradient), then q moves along the curl. Squeeze: two components
  //                 (x, y), then q moves by them. The field is a 3-octave fBm starting at half the Warp scale (gain 0.38:
  //                 a curl's bending grows with frequency, so finer octaves only nudge — flowing meanders, not a
  //                 corrugated ripple — while still breaking up any one period).
  //   +0, +1        the warp of the fine cracks (x, y), a fraction of the main one
  //   +2            the edge roughness (a value noise of ~2 output px that nudges the crack distance)
  //   +3            the width variation along the cracks
  //   +4            the plates' surface roughness (Height)
  int E0 = 3 * CRK_STEPS;
  const float FD = 0.02;
  vec2 mc = cellsFor(u_scale * u_warp_scale * 0.5, 1.0);
  vec2 fc = cellsFor(u_scale * u_sub_scale * 1.5, 1.0);
  // The zig-zag's kinks: about 5× its amplitude apart (at least 4 output px), so it doesn't fold the cracks over.
  vec2 zc = cellsFor(uRes.x / max(4.0 * u_px_scale, 5.0 * u_zigzag), 1.0);
  vec2 jc = cellsFor(uRes.x / (2.0 * u_px_scale), 1.0);
  vec2 wc = cellsFor(u_scale * 3.0, 1.0);
  vec2 rc = cellsFor(u_scale * 8.0, 1.0);
  vec2 q = p;
  float n0 = 0.5, n1 = 0.5;
  vec2 wf = vec2(0.5);
  float jn = 0.0, wn = 0.5, rn = 0.5;
  for (int e = 0; e < (3 * CRK_STEPS + 5) * UNI_1; e++) {
    int k = e < E0 ? 0 : e - E0 + 1;   // 0 main warp, 1–2 fine warp, 3 roughness, 4 width, 5 plate roughness
    int c = k == 0 ? e % 3 : (k + 1) % 2;
    bool skip = k == 0 ? u_warp <= 0.0 || (!curl && c == 2)
      : k <= 2 ? u_warp <= 0.0 || (u_sub <= 0.0 && u_shatter <= 0.0)
      : k == 3 ? u_jag <= 0.0
      : k == 4 ? u_width_var <= 0.0 || u_width <= 0.0
      : u_rough <= 0.0;
    if (!skip) {
      vec2 nc = k == 0 ? mc : k <= 2 ? fc : k == 3 ? jc : k == 4 ? wc : rc;
      // Where: the main warp, the width and the plate roughness sample the warped point q; the fine warp and the edge
      // roughness p.
      vec2 x = (k == 0 || k >= 4 ? q : p) / uRes * nc;
      // (The second component, c = 1, sampled apart; the width noise has c = 1 too and takes the same offset.)
      if (k == 0 && curl) x += c == 1 ? vec2(FD, 0.0) : c == 2 ? vec2(0.0, FD) : vec2(0.0);
      else if (c == 1) x += 17.3;
      float seed = k == 0 ? uSeed + 7.0 + (c == 1 && !curl ? 211.0 : 101.0)
                 : k <= 2 ? uSeed + 37.0 + (c == 0 ? 101.0 : 211.0)
                 : k == 3 ? uSeed + 29.0 : k == 4 ? uSeed + 97.0 : uSeed + 113.0;
      int oct = k == 0 ? 3 : k == 4 ? 1 : k == 5 ? 3 : 2;
      float gain = k == 0 ? 0.38 : k <= 2 ? 0.4 : 0.5;
      float n = org_noiseFbm(k <= 2 ? 1 : 0, false, x, periodOf(nc), oct, gain, seed);
      // (Components by branch, not by a dynamic index.)
      if (k == 0) {
        if (c == 0) n0 = n;
        else if (c == 1 && !curl) q += (vec2(n0, n) - 0.5) * 2.5 * u_warp * L / float(CRK_STEPS);
        else if (c == 1) n1 = n;
        else {
          // Bend: along the field's curl (its gradient turned a quarter), per noise cell → px.
          vec2 g = vec2(n1 - n0, n - n0) / FD;
          q += vec2(g.y, -g.x) * (u_warp * L * 0.35 / float(CRK_STEPS));
        }
      } else if (k == 1) wf.x = n;
      else if (k == 2) wf.y = n;
      else if (k == 3) jn = (n - 0.5) * 2.0 * u_jag;
      else if (k == 4) wn = n;
      else rn = n;
    }
  }
  // The zig-zag (x, y): value noise with plain bilinear interpolation, 2 octaves — piecewise straight between its
  // lattice lines, so the cracks it displaces run straight and turn sharply (kinks) instead of wobbling. One flat loop
  // over component × octave × lattice corner (one hash call).
  vec2 zz = vec2(0.5);
  if (u_zigzag > 0.0) {
    zz = vec2(0.0);
    for (int e = 0; e < 16 * UNI_1; e++) {
      int comp = e / 8, oct = (e / 4) % 2, corner = e % 4;
      float fo = oct == 0 ? 1.0 : 2.0;
      vec2 x = p / uRes * zc * fo + (comp == 1 ? 17.3 : 0.0);
      vec2 fr = fract(x);
      ivec2 i = imod(ivec2(floor(x)) + ivec2(corner % 2, corner / 2), periodOf(zc) * (oct + 1));
      float sd = uSeed + 83.0 + float(comp) * 57.0 + float(oct) * 31.0;
      float w = (corner % 2 == 0 ? 1.0 - fr.x : fr.x) * (corner / 2 == 0 ? 1.0 - fr.y : fr.y) * (oct == 0 ? 1.0 : 0.45) / 1.45;
      float v = w * animValue(hashI(i, sd), i, sd);
      if (comp == 0) zz.x += v;
      else zz.y += v;
    }
  }
  // The warp's screen-space derivatives (uniform control flow here), so crack widths stay true px. Taken before the
  // zig-zag: its kinks are too fine for derivatives over a pixel quad.
  mat2 J = mat2(dFdx(q), dFdy(q));
  // The zig-zag moves the main and fine cracks alike (it is the crack's course, not a plate's).
  q += (zz - 0.5) * 2.0 * u_zigzag;
  float wMul = mix(1.0, 0.35 + 1.3 * wn, u_width_var);
  vec2 off, nb;
  vec3 hw;
  float kS;
  vec4 c1 = crk_plates(q, cells, u_jitter, u_size_var, 0.5 * u_width * wMul, u_width_var, u_fillet, u_bulge, J, uSeed, off, nb, hw, kS);
  // Distance (px) from the pixel to the edge of the crack bands: > 0 on a plate.
  float d = c1.x + jn;
  // Bevel aspect: the same, stretched (px of Bevel), at the local stretch across the borders.
  float dS = d * kS;
  float rnd = c1.z;
  float fineInk = 0.0, fineGroove = 0.0;
  if (u_sub > 0.0 || u_shatter > 0.0) {
    vec2 c2s = cellsFor(u_scale * u_sub_scale, 1.0);
    vec2 fw = (wf - 0.5) * 0.7 * u_warp * L / u_sub_scale;
    // Two passes through one copy of crk_fineCracks (see UNI_1): the fine cracks, then the shards of a shattered fine
    // plate (one random per fine plate × main plate): a finer, fully random network with most segments present,
    // untapered, unconnected, unrounded, thin (0.3 of the main width, ≥ 0.9 px) and mid-dark — a fine mesh of shards,
    // not a black net, 85 % of its segments, laid out in a nearly unwarped plane (the warp, coarse against a shard, would
    // curl them into worms; the zig-zag kinks them) —
    // only in fine plates that reach a main crack, centred where they
    // meet it (the fine site taken across onto the main border): dark and full width there, thinning out into the
    // plate and before the fine plate's border, so a patch is a jagged cluster wedged against the crack.
    vec4 c2 = vec4(1e9, 0.0, 0.0, 1e9);
    vec2 site;
    // The shards' plane: unwarped but for the zig-zag's kinks and half the gentle fine warp.
    vec2 ps = p + (zz - 0.5) * 2.0 * u_zigzag + 0.5 * fw;
    float fd = 1e9, fade = 0.0, fk = 1.0;
    bool shattered = false, onShard = false;
    for (int i = 0; i < 2 * UNI_1; i++) {
      bool frag = i == 1;
      if (!frag || shattered) {
        float ck;
        vec4 c = crk_fineCracks(frag ? ps : q + fw, frag ? cellsFor(u_scale * u_sub_scale * u_shatter_scale, 1.0) : c2s, frag ? 1.0 : u_jitter, frag ? 0.85 : u_sub, frag ? max(0.3 * u_width, 0.45) * wMul : 0.5 * u_sub_width * wMul, u_width_var, frag ? 0.0 : u_fillet, frag ? 0.0 : u_sub_taper, c1.y, nb, L, u_sub_cross ? 0 : int(c1.z * 65536.0) + 1, !frag && u_sub_connect, frag ? mat2(1.0) : J, uSeed + (frag ? 41.0 : 3.0), site, ck);
        if (!frag) {
          c2 = c;
          fk = ck;
          // The edge roughness fades with the taper too (it would dot the thin ends out).
          fd = c.x + jn * clamp(1.0 - u_sub_taper * c1.y / (0.35 * L), 0.0, 1.0) * min(c.z, 1.0);
          // The patch's anchor: the fine site moved across onto the main border (along its normal nb, by the border's
          // distance there); none if that is over half a fine plate away. Full within ~0.45 of a fine plate of the
          // anchor, gone by ~0.8 and before the fine border (except right at the main crack, so shards run into it);
          // only where the main crack opens wide (hw.z against the mean: junctions and wide stretches), hairline
          // cracks keeping clean edges.
          float fs = L / u_sub_scale;
          float ms = c1.y - dot(site - q - fw, nb);
          vec2 anchor = site + nb * ms;
          fade = (1.0 - smoothstep(0.45, 0.8, length(q + fw - anchor) / fs))
               * max(smoothstep(0.0, 0.12 * fs, c.w), 1.0 - smoothstep(0.0, 0.15 * fs, c1.y))
               * step(ms, 0.5 * fs) * smoothstep(0.6, 1.2, hw.z / max(0.5 * u_width, 1e-3));
          shattered = fade > 0.0 && hashI(ivec2(int(c.y * 65536.0), int(c1.z * 65536.0)), uSeed + 47.0) < u_shatter;
        } else {
          // The shard band narrows by the rest of its half width (so it fades out like a sub-pixel crack).
          float sd = c.x + jn + max(0.3 * u_width, 0.45) * wMul * (1.0 - fade) * 2.0;
          if (sd < fd) {
            fd = sd;
            fk = ck;
            c2.z = 0.3 + 0.8 * fade;
            onShard = true;
          }
        }
      }
    }
    // Where a fine crack meets a main one, the junction rounds too: fd lowered by what crk_round takes off the pair.
    float red = min(fd, d) - crk_round(fd, d, u_fillet * L / u_sub_scale);
    if (u_sub_shape) {
      d = min(d, fd) - red;
      dS = crk_round(fd * fk, dS, u_fillet * L / u_sub_scale);
    }
    else {
      fd -= red;
      // Grooves of their own on the plates: in colour pale for thin cracks, dark for wide ones (anti-aliased like an
      // edge), and in Height a groove of Fine crack depth × the crack's strength, with rounded shoulders the bevel's width
      // (at least 1 px) wide.
      fineInk = coverage(fd, u_aa) * clamp(0.2 + 0.55 * c2.z, 0.0, 1.0) * (onShard ? 1.0 : u_sub_tone);
      // A rounded V across the groove: deepest on its centre line (about a half width inside the edge), out to the
      // shoulders.
      float gw = max(u_bevel, 1.0), gv = clamp((gw - fd) / (gw + 0.5 * u_sub_width * wMul), 0.0, 1.0);
      fineGroove = u_sub_depth * min(c2.z, 1.0) * gv * gv * (3.0 - 2.0 * gv);
    }
    if (u_sub_vary) rnd = fract(rnd + c2.y * 0.37);
  }
  float sdf = -d;
  if (u_output == 1) {
    // Bevel aspect: the plates' bevel from the stretched distance, so it meets in clean mitres at their corners.
    GenOut g = genOut(0.0, 1.0, rnd, sdf);
    if (bevelAspectOn()) g.bdist = -dS;
    return g;
  }
  // Plate surface for Height: ti runs 0 at the plate's border to 1 at its site (from the smooth soft-minimum border
  // distance, so no creases along the plate's skeleton);
  // the dome falls, or the curl rises, over the outer Dome reach of it: a = 1 at the edge … 0 from the reach inwards.
  float r = length(off);
  float ti = c1.w / max(c1.w + r, 1e-4);
  float a = max(1.0 - ti / u_dome_edge, 0.0);
  float sh = 1.0;
  if (u_dome > 0.0) sh = 1.0 - u_dome * a * a;
  else if (u_dome < 0.0) sh = 1.0 + u_dome * (1.0 - a * a);
  if (u_tilt > 0.0) {
    // Per main plate: a direction (a random point in the square, normalised) and a share of the tilt.
    vec3 th = hash3I(ivec2(floor(c1.z * 65536.0), 7), uSeed + 71.0);
    vec2 dir = th.xy - 0.5;
    float u = dot(off, dir) * inversesqrt(max(dot(dir, dir), 1e-6)) / max(c1.w + r, 1e-4);
    sh *= 1.0 - u_tilt * (0.25 + 0.75 * th.z) * 0.5 * (1.0 - u);
  }
  // Depth halo: round the heavy junctions (centred on the vertex, where the nearest and second borders are both near;
  // hw.x flares there) the plates sink and darken in broad soft pools, out to about a third of a plate, and a little
  // along wide stretches — growing with how wide the crack is there against the mean, so thin junctions and stretches
  // stay clean.
  float wide = clamp(hw.x / max(0.5 * u_width, 1e-3) - 0.6, 0.0, 2.0);
  float halo = u_halo * clamp(wide * wide * 0.5 * exp(-length(vec2(c1.y, hw.y)) / (0.3 * L)) + 0.05 * wide * exp(-max(d, 0.0) / (0.1 * L)), 0.0, 1.0);
  sh *= 1.0 - 0.6 * halo;
  // Plate roughness: a fine noise over the surface (Height only).
  sh += (rn - 0.5) * 0.3 * u_rough;
  // The crack's depth here (1 = the colour ramp's bottom): its half width, plus what the rounding opens at junctions of
  // wide cracks (hw.z), against the mean — narrow stretches shallow and light, wide ones and their junctions full depth.
  float k = mix(1.0, clamp(0.1 + 0.9 * hw.z / max(u_width, 1e-3), 0.0, 1.0), u_depth_var);
  // The plates' own Shape bevel (0 in the cracks and at their edges, rising to 1 over the bevel), the cracks sunk by k.
  // Painted here (genOutOwn) rather than by the wrapper, which would take every crack to the bottom; the outline still
  // goes to the mask.
  float e = 1.0 - k * (1.0 - bevelPlain(sdf) * coverage(sdf, u_aa));
  // Plates: value 1 (colour) less the fine cracks and the halo, a little darker where the dome falls away; the plate
  // surface less the fine grooves in Height; both × the bevel.
  GenOut o = genOutOwn((1.0 - fineInk) * (1.0 - 0.45 * halo) * (1.0 - 0.3 * clamp(1.0 - sh, 0.0, 1.0)) * e, 1.0, rnd, sdf);
  o.hval = clamp(sh * (1.0 - fineGroove), 0.0, 1.0) * e;
  return o;
}
`
};
