// Crystal: a field of faceted crystals — cut glass, gem clusters, shattered quartz — each a Voronoi cell raised into a
// pyramid whose faces run as flat planes from each of the cell's edges up to its tip.
//
// A layer of crystals is a Voronoi diagram (Crystals across, Jitter). Inside cell i the face of each edge, the bisector
// with neighbour j, is the plane that is 0 on that edge and 1 at the tip a: g_j(p) = d_j(p) / d_j(a), d_j the distance
// from the edge into the cell (less half the Gap). The pyramid is min_j g_j — exactly the polygon's pyramid, since an
// edge that isn't one of the cell's (a redundant bisector) reaches 0 further along every ray from the tip — so every face
// is planar and the ridges run from the tip to the cell's corners. Tip offset moves the tip off the cell's site (each
// d_j(a) kept at least 0.3 of the site's, so it never leaves the cell), Face variation gives each face its own slope (a
// roof whose ridges meet in a short crest instead of one point), Table cuts the top off flat (a gem's table), and Base
// stands the pyramid on a prism (its walls show only across a Gap).
//
// Layers repeats that up to four times, each finer (Layer scale), lower (Layer height), lifted (Layer lift) and grown in
// only a share of its cells (Small crystals), and combines them by max: smaller crystals grow out of the valleys between
// the bigger ones, and where two layers meet the planes cross in straight creases. One flat loop runs over the layers × (the 3 × 3 cells for the nearest site, then
// the 5 × 5 round it for the faces).
//
// The value is the facet's place on the ramp: a random per face (Facet contrast), how squarely it faces the Sheen, how
// high up it is (Facet gradient), its crystal's and layer's shift, and the star of wedges round the crystal's tip seen
// through it (Inner facets), turned by each face its own way so it jumps at the ridges as refracted light does. Ridges and valleys (cell edges, the creases between
// layers) are lit or darkened by Edge highlight / Valley shade. Where two facets meet in a pixel — across a ridge, a
// cell edge, a crease, or a gap's edge to the ground — their colours mix (gGenAlt) instead of the ramp passing through
// the colours between them. Height (hval) is the surface; the front crystal's random and its distance to its visible
// outline go to the mask it writes.

import { P, gradient, round1 } from '@/core/params';
import type { LayerDef } from '../types';

export const crystalLayer: LayerDef = {
	type: 'crystal',
	label: 'Crystal',
	category: 'pattern',
	kind: 'generator',
	description:
		'Faceted crystals: Voronoi cells raised into pyramids of flat faces from each edge to the tip, finer layers growing out between them, each facet its own shade. Cut glass, gem clusters, quartz. Tileable.',
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
			hint: 'Moves each crystal’s tip off its middle, its own way, so its faces differ in size and slope'
		}),
		P.float('face_var', 'Face variation', 0.3, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Each face its own slope (1 = up to three times as gentle): the faces no longer meet in one point but in a short crest, as a real crystal’s termination does'
		}),
		P.float('rise_var', 'Height variation', 0.4, 0, 1, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Each crystal its own height: 1 = from flat to full'
		}),
		P.float('table', 'Table', 0, 0, 0.95, {
			step: 0.001,
			section: 'Crystals',
			hint: 'Cuts the top of each crystal off flat at this share of its height, as a gem’s table: 0 = pointed'
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
		P.bool('ground', 'Ground', true, {
			section: 'Crystals',
			hint: 'Cover the ground in the gaps (the ramp’s first stop at height 0); off, only the crystals cover and the layers below show between them'
		}),
		P.int('layers', 'Layers', 3, 1, 4, {
			section: 'Layers',
			hint: 'Crystal layers combined by their highest: each finer one grows out of the valleys between the crystals of the ones before'
		}),
		P.float('layer_scale', 'Layer scale', 1.8, 1, 6, {
			softMax: 4,
			step: 0.01,
			section: 'Layers',
			showIf: (p) => Number(p.layers) > 1,
			hint: 'Crystals across each layer as a multiple of the layer before'
		}),
		P.float('fill', 'Small crystals', 0.45, 0, 1, {
			step: 0.001,
			section: 'Layers',
			showIf: (p) => Number(p.layers) > 1,
			hint: 'Share of the cells of each finer layer that grow a crystal: few, and the small crystals stand whole among the big ones; all, and they crowd every valley'
		}),
		P.float('layer_h', 'Layer height', 0.7, 0, 1.5, {
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
		P.float('facet_con', 'Facet contrast', 0.8, 0, 2, {
			step: 0.001,
			section: 'Colour',
			hint: 'How far along the ramp each face moves by its own random amount (1 = the whole ramp): light and dark facets side by side, as light refracts through cut glass'
		}),
		P.float('sheen', 'Sheen', 0.5, 0, 2, {
			step: 0.001,
			section: 'Colour',
			hint: 'Faces turned towards the Sheen direction move up the ramp, faces turned away down it, so the facets light consistently across the texture'
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
			hint: 'Each face moves up the ramp towards the tip (below 0: towards its foot), a gradient across every facet'
		}),
		P.float('edge', 'Edge highlight', 0.5, -1, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'Ridges between the faces of a crystal light up towards the ramp’s end (below 0: darken towards its start), as the edges of cut glass catch the light'
		}),
		P.float('valley', 'Valley shade', -0.25, -1, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'The valleys where crystals meet darken (above 0: light up)'
		}),
		P.float('edge_w', 'Edge width', 1.5, 0.1, 32, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			section: 'Colour',
			showIf: (p) => Number(p.edge) !== 0 || Number(p.valley) !== 0,
			hint: 'Width of the edge highlights and valley shading'
		}),
		P.float('col_var', 'Colour per crystal', 0.2, 0, 1, {
			step: 0.001,
			section: 'Colour',
			hint: 'Each crystal moved along the ramp by its own random amount (1 = the whole ramp)'
		}),
		P.float('layer_col', 'Colour per layer', 0, -1, 1, {
			step: 0.001,
			section: 'Colour',
			showIf: (p) => Number(p.layers) > 1,
			hint: 'How far along the ramp each layer moves from the one before'
		}),
		P.float('inner', 'Inner facets', 0.3, 0, 1, {
			step: 0.001,
			section: 'Inner facets',
			hint: 'A star of facets seen through each crystal, wedges fanning out from its tip, each its own shade with faint edges — turned by each face its own way, so the star jumps at every ridge as light refracted through cut glass does. 0 = none'
		}),
		P.int('rays', 'Inner rays', 12, 3, 48, {
			softMax: 24,
			section: 'Inner facets',
			showIf: (p) => Number(p.inner) > 0,
			hint: 'Wedges round each crystal’s tip (of uneven widths)'
		}),
		P.float('inner_shift', 'Inner shift', 0.5, 0, 2, {
			step: 0.001,
			section: 'Inner facets',
			showIf: (p) => Number(p.inner) > 0,
			hint: 'How far each face turns the star seen through it, in wedges: the jump at each ridge'
		}),
		P.seed()
	],
	// The front crystals go to a mask (opt-in); the generator shapes its own value.
	sdf: 'mask',
	// Anti-alias only matters where the crystals alone cover.
	sdfShowIf: (p, key) => key !== 'aa' || p.ground === false,
	defaults: {
		mk_target: '',
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
			inner: side >= 128 ? 0.3 : 0,
			h_amount: round1(6 * Math.sqrt(Math.min(1, side / 512)))
		};
	},
	glsl: /* glsl */ `
// A facet's place on the ramp: its own random r, how squarely it faces the sheen (it faces down its slope, against up),
// how high up it is (g), its crystal's random rc and its layer t.
float cyFacet(float r, vec2 up, float g, float rc, float t, vec2 ldir) {
  return 0.5 + u_facet_con * (r - 0.5) - 0.5 * u_sheen * dot(up, ldir) + u_grad * (g - 0.5) + u_col_var * (rc - 0.5)
       + u_layer_col * t;
}

// Edge highlight at dr px from a ridge, Valley shade at dv px from a valley: towards the ramp's end (> 0) or start.
float cyEdges(float v, float dr, float dv) {
  float k = -1.0 / max(u_edge_w * u_edge_w, 1e-3);
  float a = u_edge * exp(k * dr * dr), b = u_valley * exp(k * dv * dv);
  v = a > 0.0 ? mix(v, 1.0, a) : mix(v, 0.0, -a);
  return b > 0.0 ? mix(v, 1.0, b) : mix(v, 0.0, -b);
}

// The star seen through a crystal (Inner facets): wedges round its tip, of uneven widths (the angle warped by a
// monotone ripple of the crystal's own phase), each with its own shade; rf turns it by the face. Returns the shade
// (centred on 0, blended into the next wedge over the pixel either side of their edge) and the px distance to that edge.
vec2 cyFan(vec2 p, vec2 tip, float rc, float rf) {
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
  int T = clamp(u_layers, 1, 4);
  float gh = 0.5 * max(u_gap, 0.0);
  float jit = clamp(u_jitter, 0.0, 1.0);
  float tab = 1.0 - clamp(u_table, 0.0, 0.95);
  float base = clamp(u_base, 0.0, 1.0);
  float az = radians(u_sheen_angle);
  vec2 ldir = vec2(sin(az), cos(az));
  // The tallest a layer can stand (its crystals' tips over its lift), so the height stays in 0..1.
  float hmax = 1e-3;
  for (int t = 0; t < 4; t++) if (t < T) hmax = max(hmax, pow(max(u_layer_h, 0.0), float(t)) * (1.0 + (t > 0 ? u_layer_lift : 0.0)));

  // The front surface so far: height and its gradient (per px), value, the colour across the nearest boundary (value,
  // weight), distances to its nearest ridge and valley, the crystals' coverage, its crystal's random, the distance to its
  // visible outline (< 0 inside).
  float H = -1e3, V = 0.0, VA = 0.0, WA = 0.0, DR = 1e4, DV = 1e4, C = 0.0, RN = 0.0, SD = 1e4;
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
        float den = max(0.5 * L - gh + dot(off, n), 0.15 * L) * (1.0 + 2.0 * u_face_var * hf.y);
        float g = d / den;
        if (g < g1) { g2 = g1; n2 = n1; den2 = den1; r2 = r1; g1 = g; n1 = n; den1 = den; r1 = hf.x; }
        else if (g < g2) { g2 = g; n2 = n; den2 = den; r2 = hf.x; }
        // The face across the nearest edge is the neighbour's for this edge (its pair hashed the other way round).
        if (d < de) { de = d; ne = n; re = hash2I(key * 1013 + nk, sg + 5.0).x; rce = hashI(key, sg + 9.0); sje = sj; rne = hashI(key, sg + 11.0); }
      }
      // (A finer layer grows a crystal in a share of its cells, Small crystals.)
      if (k == 33 && (t == 0 || hashI(nk, sg + 17.0) < u_fill)) {
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
        // This facet (the table, or the lowest face), and the one across its nearest ridge: the next face, or the table's
        // edge (both in px: g is d / den).
        float vF = cyFacet(r1, n1, gc, rc, tl, ldir);
        float vT = cyFacet(hashI(nk, sg + 15.0), vec2(0.0), tab, rc, tl, ldir);
        float dTab = u_table > 0.0 ? abs(g1 - tab) * den1 : 1e4;
        float dRid = onTab ? 1e4 : (g2 - g1) / max(length(n2 / den2 - n1 / den1), 1e-6);
        float vR = dTab < dRid ? (onTab ? vF : vT) : cyFacet(r2, n2, gc, rc, tl, ldir);
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
        vec2 fS = vec2(rnd, onTab ? 0.5 : r1);
        vec2 fA = wR > wE ? vec2(rnd, dTab < dRid ? (onTab ? r1 : 0.5) : r2) : vec2(rne, re);
        vec2 tA = wR > wE ? tip : sje;
        // Combined by max with the layers before: the crease where the two planes cross is a valley, and its colour the
        // other layer's.
        float dt = abs(ht - H) / max(length(dht - dH), 1e-5);
        float wt = clamp(0.5 - dt, 0.0, 0.5);
        if (ht > H) {
          if (wt > altW) { altV = V; altW = wt; altGr = false; fA = FS; tA = TP; }
          H = ht; dH = dht; V = vS; VA = altV; WA = altW; AG = altGr;
          FS = fS; FA = fA; TP = tip; TA = tA;
          DR = dRid; DV = min(max(de, 0.0), dt);
          C = min(covI + wNb, 1.0); RN = rnd; SD = -min(de, dt);
        } else {
          if (wt > WA) { VA = vS; WA = wt; AG = false; FA = fS; TA = tip; }
          DV = min(DV, dt);
          SD = max(SD, -dt);
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
  GenOut g = genOut(clamp(cyEdges(V, DR, DV), 0.0, 1.0), u_ground ? 1.0 : C, RN, SD);
  gGenAlt = vec2(clamp(cyEdges(VA, DR, DV), 0.0, 1.0), WA);
  // Per-feature variation is each crystal's height (above), not a scale of the whole value.
  g.feat = 0.0;
  g.hval = clamp(H, 0.0, 1.0);
  return g;
}
`
};
