// Crystal: a field of faceted crystals — cut glass, gem clusters, shattered quartz — each a Voronoi cell raised into a
// pyramid whose faces run as flat planes from each of the cell's edges up to its tip.
//
// A layer of crystals is a Voronoi diagram (Crystals across, Jitter). Inside cell i the face of each edge, the bisector
// with neighbour j, is the plane that is 0 on that edge and 1 at the tip a: g_j(p) = d_j(p) / d_j(a), d_j the distance
// from the edge into the cell (less half the Gap). The pyramid is min_j g_j — exactly the polygon's pyramid, since an
// edge that isn't one of the cell's (a redundant bisector) reaches 0 further along every ray from the tip — so every face
// is planar and the ridges run from the tip to the cell's corners. Tip offset moves the tip off the cell's site (each
// d_j(a) kept at least 0.3 of the site's and a fifth of the cell, so it never leaves the cell and a thin cell stands as a
// low ridge), Face variation gives each face its own slope (a roof whose ridges meet in a short crest instead of one
// point), Table cuts the top off flat (a gem's table), and Base stands the pyramid on a prism (its walls show only across
// a Gap). Valley fill rounds the valleys' bottoms.
//
// Layers repeats that up to four times, each finer (Layer scale; below 1 larger), lower (Layer height), lifted (Layer
// lift) and grown in only a share of its cells (Small crystals), and combines them by max — smaller crystals grow out of
// the valleys between the bigger ones, and where two layers meet the planes cross in straight creases — or (Layer
// combine › Stack on top) adds each onto the surface so far, crystals growing on crystals. Skip first layer leaves the
// solid first layer out, so only the scattered finer layers grow. One flat loop runs over the layers × (the 3 × 3 cells for the nearest site, then
// the 5 × 5 round it for the faces).
//
// The value is the facet's place on the ramp: a random per face (Facet contrast), how squarely it faces the Sheen, how
// high up it is (Facet gradient), its crystal's and layer's shift, and the star of wedges round the crystal's tip seen
// through it (Inner facets), turned by each face its own way so it jumps at the ridges as refracted light does. Ridges and valleys (cell edges, the creases between
// layers) are lit or darkened by Edge highlight / Valley shade. Where two facets meet in a pixel — across a ridge, a
// cell edge, a crease, or a gap's edge to the ground — their colours mix (gGenAlt) instead of the ramp passing through
// the colours between them. Height (hval) is the surface. The crystal structure goes to the mask it writes (Shape by
// default): the front crystal's random and its distance to its visible outline, or (Mask features › Facets) its facet's
// random and distance to the facet's ridges and edges too — picked by Write to › Source.

import { P, gradient, round1 } from '@/core/params';
import type { LayerDef } from '../types';

export const crystalLayer: LayerDef = {
	type: 'crystal',
	label: 'Crystal',
	category: 'pattern',
	kind: 'generator',
	description:
		'Faceted crystals: Made from Voronoi cells raised into pyramids, optional finer layers growing out between them, each facet can be its own shade. Makes cut glass, gem clusters, quartz.',
	params: [
		P.float('scale', 'Crystals across', 4, 0.5, 64, {
			softMax: 16,
			step: 0.01,
			section: 'Crystals',
			hint: 'Crystals across the width in the first layer (whole counts when tiling)'
		}),
		P.float('jitter', 'Jitter', 0.9, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'How far each crystal’s site strays from its grid cell: 0 = a regular grid of square pyramids, 1 = irregular cells of every shape'
		}),
		P.float('tip', 'Tip offset', 0.4, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Moves each crystal’s tip off-centre randomly, so its faces differ in size and slope'
		}),
		P.float('face_var', 'Face variation', 0.2, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Modify the slope of each face (0 = All line up perfectly, 1 = up to three times as gentle). Resulting in the faces no longer meeting in one point but in a short crest that is more natural'
		}),
		P.float('rise_var', 'Height variation', 0.4, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Make each crystal get its own height (0 = equal heights, 1 = from flat to full)'
		}),
		P.float('table', 'Flat tops', 0, 0, 0.95, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Cuts the top of each crystal off flat at a specific height, like a gem’s table: (0 = pointed, 1 = completely tabled)'
		}),
		P.float('gap', 'Gap', 0, 0, 256, {
			softMax: 24,
			unit: 'px',
			step: 0.05,
			section: 'Crystals',
			hint: 'Room between the crystals: loose stones on the ground instead of a solid mass'
		}),
		P.float('base', 'Base', 0, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Stands each pyramid on a straight-sided base, this share of its height: walls round each crystal where a Gap or a lower neighbour shows them'
		}),
		P.float('vfill', 'Valley fill', 2, 0, 64, {
			softMax: 6,
			unit: 'px',
			step: 0.05,
			section: 'Crystals',
			hint: 'Rounds the bottom of each valley over this width, so crystals that touch read as grown together instead of split by a hairline crack. 0 = sharp V'
		}),
		P.bool('ground', 'Ground', true, {
			section: 'Crystals',
			hint: 'Cover the ground in the gaps (the gradient ramp’s first stop at height 0); off, only the crystals cover and the layers below show between them'
		}),
		P.int('layers', 'Layers', 3, 1, 4, {
			section: 'Layers',
			hint: 'Crystal layers combined by their highest: each finer one grows out of the valleys between the crystals of the ones before'
		}),
		P.bool('skip_first', 'Skip first layer', false, {
			section: 'Layers',
			showIf: (p) => Number(p.layers) > 1,
			hint: 'Leave out the first layer, only the other smaller layers grow (Small crystals). Makes crystals scattered at random over the ground instead of a packed mass'
		}),
		P.enum(
			'layer_mode',
			'Layer combine',
			'max',
			[
				[
					'max',
					'Grow between',
					'each layer’s crystals grow out of the valleys between the ones before (their highest wins)'
				],
				[
					'add',
					'Stack on top',
					'each layer’s crystals stand on the surface of the ones before, their heights added: crystals growing on crystals'
				]
			],
			{
				section: 'Layers',
				showIf: (p) => Number(p.layers) > 1,
				hint: 'How the layers combine'
			}
		),
		P.float('layer_scale', 'Layer scale', 1.5, 0.5, 6, {
			softMax: 4,
			step: 0.01,
			section: 'Layers',
			showIf: (p) => Number(p.layers) > 1,
			hint: 'Crystals across each layer as a multiple of the layer before: 1 = as large as the first layer’s, below 1 = even larger'
		}),
		P.float('fill', 'Small crystals', 0.35, 0, 1, {
			step: 0.001,
			section: 'Layers',
			showIf: (p) => Number(p.layers) > 1,
			hint: 'Share of the cells of each finer layer that grow a crystal: few = the small crystals are scattered among the big ones; all = small crystals crowd the valleys fully'
		}),
		P.float('layer_h', 'Layer height', 0.7, 0, 2, {
			step: 0.001,
			section: 'Layers',
			showIf: (p) => Number(p.layers) > 1,
			hint: 'Height of each layer’s crystals relative to the layer before'
		}),
		P.float('layer_lift', 'Layer lift', 0, 0, 2, {
			softMax: 0.5,
			step: 0.001,
			section: 'Layers',
			showIf: (p) => Number(p.layers) > 1,
			hint: 'How far each finer layer’s crystals stand above the ground, as a share of their own height: higher, they push up through more of the big ones’ slopes'
		}),
		P.float('facet_con', 'Facet contrast', 0.65, 0, 2, {
			step: 0.001,
			section: 'Colour',
			hint: 'How far along the gradient ramp each face moves by a random amount (1 = the whole ramp): light and dark facets side by side, as light refracts through cut glass'
		}),
		P.float('sheen', 'Sheen', 0.5, 0, 2, {
			step: 0.001,
			section: 'Colour',
			hint: 'Faces turned towards the Sheen direction move up the gradient ramp, faces turned away down it, so the facets light consistently across the texture'
		}),
		P.float('sheen_angle', 'Sheen direction', -45, -180, 180, {
			unit: '°',
			step: 0.1,
			section: 'Colour',
			showIf: (p) => Number(p.sheen) > 0,
			hint: 'Where the sheen comes from, clockwise from the top'
		}),
		P.float('grad', 'Facet gradient', 0.15, -1, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'Each face moves up the gradient ramp towards the tip (below 0: towards its base), a gradient across every facet'
		}),
		P.float('edge', 'Edge highlight', 0.5, -1, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'Ridges between the faces of a crystal light up towards the gradient ramp’s end (below 0: darken towards its start), as the edges of cut glass catch the light — each ridge by how much it faces the sheen and by a random amount, the finer layers’ less'
		}),
		P.float('valley', 'Valley shade', -0.25, -1, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'How dark the valleys where crystals meet should be (0 = normal darkness, above 0: light up)'
		}),
		P.float('edge_w', 'Edge width', 1.5, 0.1, 32, {
			softMax: 4,
			unit: 'px',
			step: 0.05,
			section: 'Colour',
			showIf: (p) => Number(p.edge) !== 0 || Number(p.valley) !== 0,
			hint: 'Width of the edge highlights and valley shading'
		}),
		P.float('glint', 'Glints', 0.35, 0, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'A bright streak across some of the faces (fewer and fainter on the finer layers), parallel to the face’s foot at a random height up it, as light refracted from a facet behind'
		}),
		P.float('col_var', 'Colour per crystal', 0.2, 0, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'Moves each crystal along the gradient ramp by a random amount (1 = the whole ramp)'
		}),
		P.float('layer_col', 'Colour per layer', 0, -1, 1, {
			step: 0.001,
			section: 'Colour',
			showIf: (p) => Number(p.layers) > 1,
			hint: 'How far along the gradient ramp each layer moves from the one before'
		}),
		P.float('inner', 'Inner facets', 0.15, 0, 1, {
			step: 0.001,
			section: 'Inner facets',
			hint: 'Slivers of colour from the tip to root of the crystal making a starburst seen through each large crystal. 0 = off'
		}),
		P.int('rays', 'Inner facet rays', 12, 3, 48, {
			softMax: 24,
			section: 'Inner facets',
			showIf: (p) => Number(p.inner) > 0,
			hint: 'How many slivers to draw around each crystal’s tip'
		}),
		P.float('inner_shift', 'Inner facet shift', 0.5, 0, 2, {
			step: 0.001,
			section: 'Inner facets',
			showIf: (p) => Number(p.inner) > 0,
			hint: 'How far each face turns the starburst'
		}),
		// What the mask holds as its features — picked by Write to › Source (Crystals or Facets), not shown.
		P.enum(
			'mask_feat',
			'Mask features',
			'crystals',
			[
				['crystals', 'Crystals'],
				['facets', 'Facets']
			],
			{ showIf: () => false, optimize: false }
		),

		P.seed()
	],
	// The crystal structure goes to the Shape mask: its crystals, or its facets (Write to › Source, by the hidden
	// mask_feat; either way in its own pass); the generator shapes its own value.
	maskSources: [
		{
			value: 'crystals',
			label: 'Crystals',
			hint: 'each crystal is one feature: its visible outline, where another crystal or layer cuts it is included',
			params: { mask_feat: 'crystals' },
			main: true
		},
		{
			value: 'facets',
			label: 'Facets',
			hint: 'each facet is one feature: its ridges and edges, so a Bevel or Etch after it follows every facet',
			params: { mask_feat: 'facets' },
			main: true
		}
	],
	sdf: 'mask',
	// Anti-alias only matters where the crystals alone cover.
	sdfShowIf: (p, key) => key !== 'aa' || p.ground === false,
	defaults: {
		h_on: true,
		h_amount: 6,
		dif_on: true,
		// Sapphire: near-black blue through royal blue and cyan to white — the facets of cut glass span the whole range.
		dif_grad: gradient('#06103a', '#0c2a8c', '#1a50d0', '#3b8ef0', '#8fd4ff', '#f4fbff'),
		r_on: true,
		r_src: 'flat',
		r_b: 0.08
	},
	// Added in the editor: edges about 1.5 px at 512 px (never under 0.75), crystals about 12 px tall at 512 px (lower on
	// small textures, so one crystal's slope doesn't shadow its neighbours), fewer layers and no inner facets on small
	// textures, where they would be a few px across.
	fresh: ({ width, height }) => {
		const side = Math.sqrt(width * height);
		return {
			edge_w: Math.max(0.75, round1((1.5 * side) / 512)),
			layers: side >= 256 ? 3 : side >= 128 ? 2 : 1,
			inner: side >= 128 ? 0.15 : 0,
			h_amount: round1(6 * Math.sqrt(Math.min(1, side / 512)))
		};
	},
	glsl: /* glsl */ `
// A facet's place on the ramp: its own random r, how squarely it faces the sheen (it faces down its slope, against up),
// how high up it is (g), its crystal's random rc and its layer t; on 3 faces in 10 (1 in 10 on the finer layers) a glint,
// a narrow streak across the face at its own height up it. The darkest faces are lifted into a soft floor (max(v,
// 0.18 + 0.4 v)): a face of the ramp's first stop reads as a hole, not glass.
float cyFacet(float r, vec2 up, float g, float rc, float t, vec2 ldir) {
  float gz = (g - 0.15 - 0.7 * fract(r * 71.97)) / 0.035;
  float glint = fract(r * 37.31) < (t > 0.0 ? 0.1 : 0.3) ? u_glint * exp(-gz * gz * gz * gz) : 0.0;
  float v = 0.5 + u_facet_con * (r - 0.5) - 0.5 * u_sheen * dot(up, ldir) + u_grad * (g - 0.5) + u_col_var * (rc - 0.5)
          + u_layer_col * t;
  return max(v, 0.18 + 0.4 * v) + glint;
}

// Edge highlight at dr px from a ridge (m: that ridge's own strength), Valley shade at dv px from a valley (mv: its
// strength): towards the ramp's end (> 0) or start.
float cyEdges(float v, float dr, float m, float dv, float mv) {
  float k = -1.0 / max(u_edge_w * u_edge_w, 1e-3);
  float a = clamp(u_edge * m, -1.0, 1.0) * exp(k * dr * dr), b = u_valley * mv * exp(k * dv * dv);
  v = a > 0.0 ? mix(v, 1.0, a) : mix(v, 0.0, -a);
  return b > 0.0 ? mix(v, 1.0, b) : mix(v, 0.0, -b);
}

// The star seen through a crystal (Inner facets): wedges round its tip, of uneven widths (the angle warped by a
// monotone ripple of the crystal's own phase), each with its own shade; rf turns it by the face. Returns the shade
// (centred on 0, blended into the next wedge over the pixel either side of their edge) and the px distance to that edge.
vec2 cyFan(vec2 p, vec2 tip, float rc, float rf) {
  // (rf < 0: a table, which shows no star.)
  if (rf < 0.0) return vec2(0.0, 1e4);
  vec2 d = p - tip;
  float r = length(d);
  float th = atan(d.y, d.x + 1e-9);
  float N = float(clamp(u_rays, 3, 64));
  float ph = TAU * rc;
  float a = N / TAU * (th + 0.3 * sin(2.0 * th + ph)) + u_inner_shift * 2.0 * (rf - 0.5) + 7.0 * rc;
  float dadt = N / TAU * (1.0 + 0.6 * cos(2.0 * th + ph));
  float k = floor(a), f = a - k;
  int seed = int(rc * 65536.0);
  int ki = int(mod(k, N));
  int kn = int(mod(k + (f < 0.5 ? -1.0 : 1.0), N));
  float dpx = min(f, 1.0 - f) * r / dadt;
  float v = mix(hashI(ivec2(ki, seed), uSeed + 73.0), hashI(ivec2(kn, seed), uSeed + 73.0), clamp(0.5 - dpx, 0.0, 0.5));
  // (Faded out within a couple of px of the tip, where the wedges are narrower than a pixel.)
  return vec2((v - 0.5) * smoothstep(0.0, 3.0, r), dpx);
}

GenOut gen(vec2 p) {
  // Skip first layer: the first is left out, so at least two are run.
  bool skip = u_skip_first && u_layers > 1;
  int T = clamp(u_layers, skip ? 2 : 1, 4);
  int t0 = skip ? 1 : 0;
  bool add = u_layer_mode == 1;
  float gh = 0.5 * max(u_gap, 0.0);
  // Valley fill's width (not across a gap, where the crystals meet the ground).
  float vw = gh > 0.0 ? 0.0 : max(u_vfill, 0.0);
  float jit = clamp(u_jitter, 0.0, 1.0);
  float tab = 1.0 - clamp(u_table, 0.0, 0.95);
  float base = clamp(u_base, 0.0, 1.0);
  float az = radians(u_sheen_angle);
  vec2 ldir = vec2(sin(az), cos(az));
  // The tallest a layer can stand (its crystals' tips over its lift) — or, stacked, all the layers' together — so the
  // height stays in 0..1.
  float hmax = 1e-3, hsum = 0.0;
  for (int t = 0; t < 4; t++)
    if (t < T && t >= t0) {
      float ht0 = pow(max(u_layer_h, 0.0), float(t)) * (1.0 + (t > 0 ? u_layer_lift : 0.0));
      hmax = max(hmax, ht0);
      hsum += ht0;
    }
  if (add) hmax = max(hsum, 1e-3);

  // The front surface so far: height and its gradient (per px), value, the colour across the nearest boundary (value,
  // weight), distance to its nearest ridge and that ridge's strength, distance to its nearest valley and that valley's
  // strength (half round the finer layers' crystals), distance to its nearest cell edge, the crystals' coverage, its crystal's random, the distance to its
  // visible outline (< 0 inside).
  float H = -1e3, V = 0.0, VA = 0.0, WA = 0.0, DR = 1e4, MR = 1.0, DV = 1e4, MV = 1.0, DE = 1e4, C = 0.0, RN = 0.0, SD = 1e4;
  // The front facet's own random (the mask's feature with Mask features › Facets).
  float RF = 0.0;
  // The front facet's gradient; whether the one across the boundary is the ground.
  vec2 dH = vec2(0.0);
  bool AG = false;
  // For the star seen through the front facet and the one across the boundary: the crystal's tip, its random, the face's.
  vec2 FS = vec2(0.0), FA = vec2(0.0);
  vec2 TP = vec2(0.0), TA = vec2(0.0);
  // The layer in progress: its cells, the nearest site (its cell, key, position), the tip's offset from it; the lowest
  // two faces (g, uphill direction, px per unit of g, random) and the nearest edge (distance, the face across it).
  vec2 cpx = vec2(1.0), si = vec2(0.0), off = vec2(0.0);
  ivec2 ncl = ivec2(1), nc = ivec2(0), nk = ivec2(0);
  float bd = 1e20, sg = 0.0;
  float g1 = 1e4, g2 = 1e4, den1 = 1.0, den2 = 1.0, r1 = 0.0, r2 = 0.0, de = 1e4, re = 0.0, rce = 0.0, rne = 0.0;
  vec2 n1 = vec2(0.0), n2 = vec2(0.0), ne = vec2(0.0), sje = vec2(0.0);
  // (No continue in this loop: ANGLE / D3D11 can miscompile it.)
  for (int e = 0; e < T * 34; e++) {
    int t = e / 34;
    int k = e - t * 34;
    if (k == 0) {
      vec2 cells = cellsFor(u_scale * pow(max(u_layer_scale, 1.0), float(t)), 1.0);
      cpx = uRes / cells;
      ncl = ivec2(cells + 0.5);
      sg = uSeed + float(t) * 131.0;
      bd = 1e20;
      g1 = 1e4; g2 = 1e4; de = 1e4;
    }
    if (k < 9) {
      // The nearest site, from the 3 × 3 cells round the pixel.
      ivec2 c = ivec2(floor(p / cpx)) + ivec2(k % 3, k / 3) - 1;
      ivec2 key = wrapCell(c, ncl);
      vec2 s = (vec2(c) + 0.5 + (hash2I(key, sg) - 0.5) * jit) * cpx;
      float d2 = dot(p - s, p - s);
      if (d2 < bd) { bd = d2; nc = c; nk = key; si = s; }
    } else {
      if (k == 9) {
        vec2 ho = hash2I(nk, sg + 3.0);
        off = u_tip * 0.5 * min(cpx.x, cpx.y) * sqrt(ho.x) * vec2(cos(TAU * ho.y), sin(TAU * ho.y));
      }
      // The faces: one per neighbour in the 5 × 5 round the nearest cell, each a plane 0 on the edge (the bisector, less
      // half the gap) and 1 at the tip, over its own slope.
      int o = k - 9;
      ivec2 c = nc + ivec2(o % 5, o / 5) - 2;
      if (c != nc) {
        ivec2 key = wrapCell(c, ncl);
        vec2 sj = (vec2(c) + 0.5 + (hash2I(key, sg) - 0.5) * jit) * cpx;
        vec2 dv = si - sj;
        float L = max(length(dv), 1e-4);
        vec2 n = dv / L;
        float d = dot(p - 0.5 * (si + sj), n) - gh;
        vec2 hf = hash2I(nk * 1013 + key, sg + 5.0);
        // (Its run at least 0.3 of the site's, and a fifth of the cell, so a thin cell between two close sites stands as
        // a low ridge, not a knife edge.)
        float den = max(max(0.5 * L - gh + dot(off, n), 0.15 * L), 0.2 * min(cpx.x, cpx.y)) * (1.0 + 2.0 * u_face_var * hf.y);
        float g = d / den;
        if (g < g1) { g2 = g1; n2 = n1; den2 = den1; r2 = r1; g1 = g; n1 = n; den1 = den; r1 = hf.x; }
        else if (g < g2) { g2 = g; n2 = n; den2 = den; r2 = hf.x; }
        // The face across the nearest edge is the neighbour's for this edge (its pair hashed the other way round).
        if (d < de) { de = d; ne = n; re = hash2I(key * 1013 + nk, sg + 5.0).x; rce = hashI(key, sg + 9.0); sje = sj; rne = hashI(key, sg + 11.0); }
      }
      // (A finer layer grows a crystal in a share of its cells, Small crystals.)
      if (k == 33 && t >= t0 && (t == t0 && !skip || hashI(nk, sg + 17.0) < u_fill)) {
        // The layer's surface here: the pyramid (cut at the table, on its base), its share of the pixel, and the colours.
        float tl = float(t);
        float rc = hashI(nk, sg + 9.0);
        float rnd = hashI(nk, sg + 11.0);
        float Hc = (1.0 - u_rise_var * hashI(nk, sg + 13.0)) * pow(max(u_layer_h, 0.0), tl) * (1.0 - u_h_var * featVar(rnd));
        float covI = clamp(0.5 + de, 0.0, 1.0);
        float wNb = clamp(0.5 - de - 2.0 * gh, 0.0, 1.0);
        float gc = clamp(g1, 0.0, 1.0);
        bool onTab = gc >= tab;
        float ht = covI * Hc * (base + (1.0 - base) * min(gc, tab) / tab + (t > 0 ? u_layer_lift : 0.0)) / hmax;
        float sl = covI * Hc * (1.0 - base) / (tab * hmax);
        vec2 dht = onTab ? vec2(0.0) : sl * n1 / den1;
        // Stack on top: the crystal stands on the surface so far (its height added, so it is in front wherever it rises).
        if (add && H > -1.0) { ht += H; dht += dH; }
        // This facet (the table, or the lowest face), and the one across its nearest ridge: the next face, or the table's
        // edge (both in px: g is d / den).
        float vF = cyFacet(r1, n1, gc, rc, tl, ldir);
        float rT = hashI(nk, sg + 15.0);
        float vT = cyFacet(rT, vec2(0.0), tab, rc, tl, ldir);
        float dTab = u_table > 0.0 ? abs(g1 - tab) * den1 : 1e4;
        float dRid = onTab ? 1e4 : (g2 - g1) / max(length(n2 / den2 - n1 / den1), 1e-6);
        float vR = dTab < dRid ? (onTab ? vF : vT) : cyFacet(r2, n2, gc, rc, tl, ldir);
        // The ridge's strength: a random of the two faces it parts (the same from either side), how far it faces the sheen
        // (as the faces' normals lean, down their slopes), less on the finer layers.
        float ra = dTab < dRid ? rT : r2;
        float rr = fract((r1 + ra) * 91.7 + r1 * ra * 13.1);
        vec2 nr = dTab < dRid ? n1 : n1 + n2;
        float mR = (0.3 + 1.4 * rr * rr) * (0.7 - 0.3 * dot(nr, ldir) / max(length(nr), 1e-6)) * (t > 0 ? 0.5 : 1.0);
        dRid = min(dRid, dTab);
        float vS = onTab ? vT : vF;
        // Across the nearest edge: the neighbour's face, or the ground (value 0) across a gap.
        float wG = u_ground ? max(1.0 - covI - wNb, 0.0) : 0.0;
        float vE = wG > wNb ? 0.0 : cyFacet(re, -ne, 0.0, rce, tl, ldir);
        float wE = max(wG, wNb);
        float wR = clamp(0.5 - dRid, 0.0, 0.5);
        float altV = wR > wE ? vR : vE;
        float altW = max(wR, wE);
        bool altGr = wR <= wE && wG > wNb;
        // Their stars: this crystal's, turned by the face (the table's unturned); across an edge the neighbour's, about its
        // site.
        vec2 tip = si + off;
        // (Only the first layer's crystals show one — the first one run: on the small ones it is noise.)
        bool star = t == t0;
        vec2 fS = vec2(rnd, onTab || !star ? -1.0 : r1);
        vec2 fA = !star ? vec2(0.0, -1.0) : wR > wE ? vec2(rnd, dTab <= dRid ? (onTab ? r1 : -1.0) : r2) : vec2(rne, re);
        vec2 tA = wR > wE ? tip : sje;
        // Combined by max with the layers before: the crease where the two planes cross is a valley, and its colour the
        // other layer's.
        float dt = abs(ht - H) / max(length(dht - dH), 1e-5);
        float wt = clamp(0.5 - dt, 0.0, 0.5);
        // Valley fill on the crease: a smooth max of the two planes, Valley fill px wide (k in height: the width × how
        // fast they part), the same from either side.
        float kf = vw * length(dht - dH);
        float fill = kf > 0.0 && H > -1.0 && (ht > H || dt < min(dRid, max(de, 0.0))) ? pow(max(kf - abs(ht - H), 0.0), 2.0) / (4.0 * kf) : 0.0;
        if (ht > H) {
          if (wt > altW) { altV = V; altW = wt; altGr = false; fA = FS; tA = TP; }
          H = ht; dH = dht; V = vS; VA = altV; WA = altW; AG = altGr;
          FS = fS; FA = fA; TP = tip; TA = tA;
          H += fill;
          DR = dRid; MR = mR; DE = max(de, 0.0); DV = min(DE, dt); MV = t > 0 ? 0.5 : 1.0;
          C = min(covI + wNb, 1.0); RN = rnd; SD = -min(de, dt); RF = onTab ? rT : r1;
        } else {
          if (wt > WA) { VA = vS; WA = wt; AG = false; FA = fS; TA = tip; }
          // A crease with a layer hidden below counts only within that layer's facet: its plane, carried on past the
          // facet's ridge or edge, may come near the front without the facet ever reaching it.
          if (dt < min(dRid, max(de, 0.0))) {
            H += fill;
            if (dt < DV) { DV = dt; MV = 0.5; }
            SD = max(SD, -dt);
          }
        }
      }
    }
  }
  // Inner facets: the stars seen through the front facet and the one across the boundary, so the jump at a ridge is
  // anti-aliased like the facets; their edges faint lines.
  if (u_inner > 0.0) {
    float w2 = -1.0 / max(u_edge_w * u_edge_w, 1e-3);
    vec2 sf = cyFan(p, TP, FS.x, FS.y), sa = cyFan(p, TA, FA.x, FA.y);
    V += u_inner * (sf.x + 0.15 * exp(w2 * sf.y * sf.y));
    if (!AG) VA += u_inner * (sa.x + 0.15 * exp(w2 * sa.y * sa.y));
  }
  // Valley fill at a cell edge: within its width the V's bottom is rounded into a fillet (smooth |x|: (w − d)² / 2w of the
  // face's slope more; the creases between layers were filled above). The slope capped at a large crystal's steepest, so
  // a sliver of a face doesn't spike.
  vec2 c0 = cellsFor(u_scale, 1.0);
  float smax = 4.0 / (hmax * min(uRes.x / c0.x, uRes.y / c0.y));
  if (vw > 0.0 && DE < vw) H += min(length(dH), smax) * (vw - DE) * (vw - DE) / (2.0 * vw);
  // The mask: the front crystal (its outline) or its facet (its ridges and edges too), with its random.
  bool facets = u_mask_feat == 1;
  GenOut g = genOut(clamp(cyEdges(V, DR, MR, DV, MV), 0.0, 1.0), u_ground ? 1.0 : C, RN, facets ? max(SD, -DR) : SD);
  if (facets) g.fid = fract(RF * 7.13 + RN);
  gGenAlt = vec2(clamp(cyEdges(VA, DR, MR, DV, MV), 0.0, 1.0), WA);
  // Per-feature variation is each crystal's height (above), not a scale of the whole value.
  g.feat = 0.0;
  g.hval = clamp(H, 0.0, 1.0);
  return g;
}
`
};
