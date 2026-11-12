// Flake scars, as a mason pitches a rock face: shared by Stone blocks (on its faces) and Chips (near a mask's edges).
// Each scar is a hollow below the surface, 0 at its rim and about −1 at its deepest; the lowest wins, so rims meet in
// crisp ridges and the face between them stays whole. One scar is a tilted plane — deepest at its struck end, running
// out at a grazing angle at the other — walled in by the bowl dⁿ − 1 wherever that is shallower: a steep, crisp wall
// round the struck end, the sides curving up to the rim. Most are struck from the nearest edge (Scars from edges: the
// struck end at the edge, the scar running inward, wider along the edge than inward); one whose struck end falls short
// of the edge fades out, so a big face keeps its middle. Two sizes in one flat loop (the 4 × 4 cells round p, which
// hold every scar reaching it: a scar reaches at most 1.45 cells, its site 0.1 cells inside its own).

import { P, type ParamDef } from '@/core/params';

/**
 * The scar field as a GLSL function `float <name>(vec2 p, vec2 wp, vec2 so, float scs<args>)`: the big scars plus
 * Small scars × 0.42 × the small ones, at pixel p, its field warped by wp px (ragged rims) and read at offset so px (one
 * field per piece), big scars scs px apart. Reads u_<prefix>_edge, _stretch and _detail, and `amount` (the share of
 * scars cut).
 */
export function flakeScarsGlsl(o: {
	name: string;
	/** Extra GLSL parameters, from `, …`, for `edge`. */
	args: string;
	prefix: string;
	amount: string;
	/** The hash seeds (offsets from uSeed), [big, small] for each of the scar's five hashes. */
	seeds: [number, number][];
	/** The wall's exponent: 4 rounds softly, 8 stands steeper. */
	wall: 4 | 8;
	/**
	 * GLSL that sets, from the site sp (px, unwarped): `bool on` (the scar is cut), `bool canStrike` (it may be struck
	 * from an edge) and `float edgeD` (px from the site to that edge).
	 */
	edge: string;
	/** A GLSL expression after `edge`: the struck direction's angle (the scar's −x towards the edge). */
	angle: string;
}): string {
	const seed = (k: number) => `uSeed + (fine ? ${o.seeds[k][1].toFixed(1)} : ${o.seeds[k][0].toFixed(1)})`;
	return /* glsl */ `
float ${o.name}(vec2 p, vec2 wp, vec2 so, float scs${o.args}) {
  vec2 cellsB = cellsFor(uRes.x / scs, 1.0), cellsF = cellsFor(uRes.x / (0.42 * scs), 1.0);
  float s1 = 0.0, s2 = 0.0;
  for (int e = 0; e < 32 * UNI_1; e++) {
    bool fine = e >= 16;
    int k = e & 15;
    vec2 cells = fine ? cellsF : cellsB;
    vec2 fo = fine ? vec2(0.37, 0.71) * uRes : vec2(0.0);
    vec2 x = (p + wp + so + fo) / uRes * cells;
    ivec2 cc = ivec2(floor(x - 0.5)) - 1 + ivec2(k & 3, k >> 2);
    ivec2 cw = imod(cc, periodOf(cells));
    vec4 h = vec4(hash2I(cw, ${seed(0)}), hash2I(cw, ${seed(1)}));
    vec4 h2 = vec4(hash2I(cw, ${seed(2)}), hash2I(cw, ${seed(3)}));
    vec2 site = vec2(cc) + 0.5 + 0.8 * (h.xy - 0.5);
    // The site on screen (unwarped): one edge and direction for the whole scar.
    vec2 sp = site / cells * uRes - so - fo;
    bool on, canStrike;
    float edgeD;
    ${o.edge.trim()}
    // Struck from the nearest edge, or any which way.
    bool struck = h2.w < u_${o.prefix}_edge && canStrike;
    float a = struck ? ${o.angle} + 0.9 * (h.z - 0.5) : h.z * TAU;
    vec2 ax = vec2(cos(a), sin(a));
    vec2 lq = x - site;
    lq = vec2(dot(lq, ax), dot(lq, vec2(-ax.y, ax.x)));
    // Wider along the edge than inward (a scallop), up to 2.4×, shrunk to stay within the 4 × 4 window (1.45 cells).
    float st = 1.0 + 1.4 * u_${o.prefix}_stretch * h.w;
    float R = min(0.55 + 0.4 * h2.x, 1.45 / st);
    vec2 e2 = vec2(lq.x * st, lq.y / st) / R;
    float d2 = dot(e2, e2);
    float depth = on && h2.z < ${o.amount} ? 0.4 + 0.6 * h2.y : 0.0;
    if (struck) depth *= 1.0 - smoothstep(0.9, 1.4, edgeD / (R / st * uRes.x / cells.x));
    float plane = -0.5 * (1.0 - e2.x) * (0.7 + h2.x) + 0.4 * (hashI(cw, ${seed(4)}) - 0.5) * e2.y;
    float d4 = d2 * d2;
    float s = d2 < 1.0 ? depth * max(${o.wall === 8 ? 'd4 * d4' : 'd4'} - 1.0, plane) : 0.0;
    if (fine) s2 = min(s2, s); else s1 = min(s1, s);
  }
  return s1 + u_${o.prefix}_detail * 0.42 * s2;
}
`;
}

/**
 * The scars' shared params, `<prefix>_edge`, `_size`, `_stretch` and `_detail` (the generator adds the amount and the
 * depth, which mean different things in each). `where`: what the small scars chip into ('faces'); `edgeOf`: whose
 * edge they are struck from ('the stone’s').
 */
export function flakeScarParams(
	prefix: string,
	o: { edge: number; size: [number, number, number]; where: string; edgeOf: string },
	extra: Partial<ParamDef>
) {
	const [size, max, softMax] = o.size;
	return {
		edge: P.float(`${prefix}_edge`, 'Scars from edges', o.edge, 0, 1, {
			step: 0.001,
			...extra,
			hint: `How many of the scars are struck from ${o.edgeOf} nearest edge — deep at the edge and running inward, the way a mason pitches a rock face — rather than lying any which way across the face`
		}),
		size: P.float(`${prefix}_size`, 'Scar size', size, 2, max, {
			softMax,
			unit: 'px',
			step: 0.1,
			...extra,
			hint: 'Sets the spacing of the big scars (each one 0.55–0.95 of this across, stretched up to 2.4×)'
		}),
		stretch: P.float(`${prefix}_stretch`, 'Scar stretch', 1, 0, 1, {
			step: 0.001,
			...extra,
			hint: 'Stretches the scars along the edge they were struck from, into scallops (up to 2.4×)'
		}),
		detail: P.float(`${prefix}_detail`, 'Small scars', 0.5, 0, 1, {
			step: 0.001,
			...extra,
			hint: `Adds a second, finer set of scars (under half the size) chipped into the ${o.where} and the big scars`
		})
	};
}
