// Organic value generators (FR7.2a): veined marble and liquid caustics. Both output a plain value (veins /
// bright rims = 1) for the colour ramp; caustics can also hand its cells to a mask.

import { P, gradient } from '@/core/params';
import type { LayerDef } from '../types';
import type { ParamValues } from '@/core/params';
import { ORG_GLSL } from './organicShared';

// ------------------------------------------------------------------------------------------------ marble

// Styles with an angle: veins along a direction.
const along = (style: unknown) => style === 'streaks' || style === 'ridges';
// The fine veins' style, 'same' resolved.
const fineStyle = (p: ParamValues) => (p.fine_style === 'same' ? p.style : p.fine_style);

export const marbleLayer: LayerDef = {
	type: 'marble',
	noise: true,
	label: 'Marble',
	category: 'pattern',
	kind: 'generator',
	description:
		'Veined marble: turbulent streaks, meandering vein networks or cellular veins, with fine secondary veins. Veins = 1.',
	params: [
		P.enum(
			'style',
			'Style',
			'ridges',
			[
				['streaks', 'Streaks (turbulent bands)'],
				['network', 'Network (meandering)'],
				['cells', 'Cells (vein mesh)'],
				['ridges', 'Ridges (crests of warped noise)']
			],
			{
				hint: 'Streaks: classic sin(x + turbulence) veins along a direction. Network: contour lines of warped noise. Cells: veins along warped cell borders. Ridges: the crests of a warped, stretched noise — veins that meander, fork where crests meet and taper out'
			}
		),
		P.float('veins', 'Veins', 2.5, 0.25, 64, {
			softMax: 16,
			step: 0.01,
			hint: 'Streaks: vein bands per texture width. Network / cells: noise cells across (rounded when tiling)'
		}),
		P.float('angle', 'Angle', 30, -360, 360, {
			softMin: -90,
			softMax: 90,
			unit: '°',
			step: 0.1,
			showIf: (p) => along(p.style),
			hint: 'Vein direction, clockwise from horizontal (snapped to a seamless angle when tiling)'
		}),
		P.float('stretch', 'Stretch', 6, 0.1, 10, {
			softMin: 0.25,
			softMax: 8,
			step: 0.01,
			hint: 'Streaks: > 1 stretches the turbulence along the veins — long, flowing veins that bunch and spread; ridges: the veins’ noise itself along the angle (tiling snaps the direction to within a few degrees). Network / cells: > 1 elongates the pattern horizontally'
		}),
		P.float('levels', 'Contours', 1, 0.5, 8, {
			softMax: 4,
			step: 0.01,
			showIf: (p) => p.style === 'network',
			hint: 'Vein contour lines per unit of noise — more = denser, nested veins'
		}),
		P.enum(
			'turb',
			'Turbulence',
			'smooth',
			[
				['billow', 'Kinked (billow)'],
				['smooth', 'Smooth']
			],
			{
				showIf: (p) => p.style === 'streaks',
				hint: 'Kinked: the classic marble turbulence, |noise| — sharp turns and lobes. Smooth: signed noise — softer, wavier veins'
			}
		),
		P.float('warp', 'Warp', 0.3, 0, 8, {
			softMax: 4,
			step: 0.001,
			hint: 'Turbulence strength (in vein periods / cells)'
		}),
		P.float('fold', 'Folding', 0.2, 0, 8, {
			softMax: 3,
			step: 0.001,
			showIf: (p) => p.style === 'streaks',
			hint: 'Bends the veins together with their turbulence by a smooth warp at half the warp scale (in vein periods): sweeping, folded flow instead of straight bands'
		}),
		P.float('warp_scale', 'Warp scale', 2, 0.25, 64, {
			softMax: 16,
			step: 0.01,
			hint: 'Turbulence cells across the texture (rounded when tiling)'
		}),
		P.int('detail', 'Detail', 2, 1, 8, { hint: 'Turbulence octaves (kinks and wiggles in the veins)' }),
		P.float('rough', 'Roughness', 0.35, 0.1, 0.9, {
			step: 0.001,
			hint: 'Strength of each finer turbulence octave against the one before: low = smooth, flowing veins; high = crinkled, coastline-like veins with loops'
		}),
		P.float('width', 'Vein width', 1.6, 0, 64, { softMax: 12, unit: 'px', step: 0.05 }),
		P.float('soft', 'Softness', 2, 0, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.05,
			hint: 'Falloff beyond the vein core (0 = crisp)'
		}),
		P.float('width_var', 'Width variation', 0.5, 0, 1, {
			step: 0.001,
			hint: 'Veins swell and thin along their length'
		}),
		P.float('flow', 'Width from flow', 0.7, 0, 1, {
			step: 0.001,
			showIf: (p) => p.style !== 'cells',
			hint: 'Veins swell where the turbulence spreads them apart and pinch where it crowds them, like bands in real stone (0 = even, drawn-line widths)'
		}),
		P.float('fork', 'Strands', 0.5, 0, 1, {
			step: 0.001,
			showIf: (p) => p.style !== 'cells',
			hint: 'Splits each main vein into a bundle of strands that part and rejoin along it (0 = single veins)'
		}),
		P.float('cell_var', 'Edge weight variation', 0.6, 0, 1, {
			step: 0.001,
			showIf: (p) => p.style === 'cells' || p.fine_style === 'cells',
			hint: 'Cells: every cell edge its own weight, heavy to hairline (0 = even lines)'
		}),
		P.float('cull', 'Loop culling', 0.7, 0, 1, {
			step: 0.001,
			showIf: (p) => p.style !== 'cells',
			hint: 'Fades the tiny rings and dots that form round the turbulence’s peaks and dips (where the flow is flat) and, for streaks, the far side of closed loops and hairpin folds of any size (where a vein runs back against the flow). Ridges: veins taper out gradually where their crest flattens — no small loops, no hooks'
		}),
		P.float('breakup', 'Breakup', 0.1, 0, 1, { step: 0.001, hint: 'Fades veins in and out along their length' }),
		P.float('halo', 'Halo', 0.3, 0, 1, {
			step: 0.001,
			hint: 'A faint wash of vein colour bleeding into the stone around the veins (0 = off)'
		}),
		P.float('halo_width', 'Halo width', 14, 0.5, 256, {
			softMax: 48,
			unit: 'px',
			step: 0.1,
			showIf: (p) => Number(p.halo) > 0,
			hint: 'How far the halo reaches from a vein'
		}),
		P.float('fine', 'Fine veins', 0.55, 0, 1, { step: 0.001, hint: 'Strength of a second, finer vein system' }),
		P.enum(
			'fine_style',
			'Fine style',
			'same',
			[
				['same', 'Same as the main veins'],
				['streaks', 'Streaks'],
				['network', 'Network'],
				['cells', 'Cells (crackle)'],
				['ridges', 'Ridges']
			],
			{
				showIf: (p) => Number(p.fine) > 0,
				hint: 'Shape of the fine veins: the main style (finer contours of the same flow) or another — Cells gives a crackle of fine veins between the main ones'
			}
		),
		P.float('fine_angle', 'Fine angle', 30, -180, 180, {
			softMin: -60,
			softMax: 60,
			unit: '°',
			step: 0.1,
			showIf: (p) => Number(p.fine) > 0 && along(fineStyle(p)),
			hint: 'Turns the fine streaks / ridges against the main veins, so they cross them and branch off at an angle'
		}),
		P.float('fine_stretch', 'Fine stretch', 0.5, 0.1, 4, {
			softMin: 0.25,
			softMax: 2,
			step: 0.01,
			showIf: (p) => Number(p.fine) > 0 && along(fineStyle(p)),
			hint: 'The fine veins’ stretch along their own angle, relative to the main Stretch (1 = the same)'
		}),
		P.float('fine_scale', 'Fine scale', 3, 1, 16, {
			softMax: 8,
			step: 0.01,
			showIf: (p) => Number(p.fine) > 0,
			hint: 'Fine veins per main vein'
		}),
		P.float('fine_width', 'Fine width', 0, 0, 32, {
			softMax: 4,
			unit: 'px',
			step: 0.05,
			showIf: (p) => Number(p.fine) > 0,
			hint: 'Core width of the fine veins (0 = auto: hairlines, a third of the main width within 0.75–1.5 px)'
		}),
		P.float('fine_near', 'Fine clustering', 0.8, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.fine) > 0,
			hint: 'Gathers the fine veins round the main ones (strands and branches along them): 0 = spread evenly, 1 = only near the main veins'
		}),
		P.float('fine_wander', 'Fine wander', 0.35, 0, 2, {
			softMax: 1,
			step: 0.001,
			showIf: (p) => Number(p.fine) > 0 && fineStyle(p) !== 'streaks',
			hint: 'Extra warp of the fine veins (in main-vein cells): their spacing and direction vary across the slab instead of a regular hatch'
		}),
		P.float('fine_break', 'Fine breakup', 0.45, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.fine) > 0,
			hint: 'Breaks the fine veins into lengths that taper out'
		}),
		P.float('fine_patch', 'Fine patchiness', 0.5, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.fine) > 0,
			hint: 'Varies the fine veins’ density across the slab: dense patches and clear areas (0 = even everywhere)'
		}),
		P.int('tiles', 'Tiles', 0, 0, 64, {
			softMax: 8,
			hint: 'Cut into tiles across (0 = off): each tile gets its own piece of marble; the per-feature random is per tile'
		}),
		P.float('tile_rot', 'Tile vein turn', 45, 0, 180, {
			unit: '°',
			step: 0.1,
			showIf: (p) => Number(p.tiles) > 0 && along(p.style),
			hint: 'Random vein rotation per tile (±)'
		}),
		P.float('cloud', 'Cloudiness', 0.25, 0, 1, {
			step: 0.001,
			hint: 'Mottled background between the veins (raises the value up to this much)'
		}),
		P.float('cloud_scale', 'Cloud scale', 0, 0, 64, {
			softMax: 16,
			step: 0.01,
			showIf: (p) => Number(p.cloud) > 0,
			hint: 'Cloud blotches across the texture (0 = 1.5 × the warp scale; rounded when tiling)'
		}),
		P.float('cloud_stretch', 'Cloud stretch', 1.5, 0.1, 10, {
			softMin: 0.25,
			softMax: 6,
			step: 0.01,
			showIf: (p) => Number(p.cloud) > 0 && along(p.style),
			hint: 'Draws the clouds out along the veins (> 1) or across them (< 1)'
		}),
		P.bool('filter', 'Filter fine detail', true, {
			hint: 'Fades turbulence octaves and vein contours finer than ~2 px, so dense or highly detailed marble doesn’t alias into speckle and moiré'
		}),
		P.float('relief', 'Relief', 0.12, 0, 1, {
			step: 0.001,
			hint: 'What Height › Pattern follows: 1 = the whole value (veins and clouds); lower = mostly the veins, that much shallower — polished stone with faintly etched (Subtract) or raised veins'
		}),
		P.seed()
	],
	defaults: {
		dif_on: true,
		dif_grad: gradient('#d9d4ca', '#bfb8ac', '#8d867c', '#4b4641'),
		r_on: true,
		r_a: 0.25,
		r_b: 0.45,
		// Veins faintly etched into polished stone (with Relief's shallow, vein-only height).
		h_mode: 'subtract'
	},
	// Added in the editor: vein width, softness and halo sized to the texture (the defaults are for 512 px).
	fresh: ({ width }) => {
		const k = width / 512;
		const r1 = (v: number) => Math.round(v * 100) / 100;
		return {
			width: r1(Math.max(1, 1.6 * Math.sqrt(k))),
			soft: r1(Math.max(0.75, 2 * Math.sqrt(k))),
			halo_width: r1(Math.max(3, 14 * k))
		};
	},
	glsl:
		ORG_GLSL +
		/* glsl */ `
// Keep part of a mask where the noise n (0..1) is high: amount 0 keeps everything, 1 removes everything.
float mb_breakup(float n, float amount) {
  float c = clamp((n - 0.5) * 2.5 + 0.5, 0.0, 1.0);
  return smoothstep(amount * 1.3 - 0.3, amount * 1.3, c);
}

// Whole cycles per texture (x, y) of the wave vector for count bands per texture width at deg clockwise from horizontal
// on screen (never both 0).
vec2 mb_waveCycles(float count, float deg) {
  float a = radians(deg);
  vec2 cyc = floor(vec2(sin(a), cos(a)) * count / uRes.x * uRes + 0.5);
  if (cyc.x == 0.0 && cyc.y == 0.0) cyc.y = 1.0;
  return cyc;
}

// Wave vector (cycles per px, GL space) for bands that run at deg clockwise from horizontal on screen, count bands per
// texture width. Snapped to whole cycles per axis when tiling (seamless); g = number of distinct bands per tile (for
// per-band randoms).
vec2 mb_waveK(float count, float deg, out int g) {
  float a = radians(deg);
  vec2 k = vec2(sin(a), cos(a)) * count / uRes.x;
  g = NO_PERIOD.x;
  if (uTile) {
    vec2 cyc = mb_waveCycles(count, deg);
    k = cyc / uRes;
    g = igcd(int(cyc.x), int(cyc.y));
  }
  return k;
}

// worleyNoise(x, per, 1.0, 0, seed).wz — distance to the cell border (cells) and the cell's random — in one flat loop:
// the 3×3 cells for the nearest point, then the 5×5 for the border (the library's nested loops compile slower).
vec2 mb_worleyBorder(vec2 x, ivec2 per, float seed) {
  ivec2 ip = ivec2(floor(x));
  vec2 fp = fract(x);
  float F1 = 1e9, md = 1e9;
  vec2 mr = vec2(0.0);
  ivec2 mc = ip;
  for (int e = 0; e < 34 * UNI_1; e++) {
    bool near = e < 9;
    ivec2 g = near ? ivec2(e % 3 - 1, e / 3 - 1) : ivec2((e - 9) % 5 - 2, (e - 9) / 5 - 2);
    vec2 r = vec2(g) + cellPoint(imod(ip + g, per), seed) - fp;
    if (near) {
      float d = dot(r, r);
      if (d < F1) { F1 = d; mr = r; mc = ip + g; }
    } else {
      vec2 dr = r - mr;
      if (dot(dr, dr) > 1e-6) md = min(md, dot(0.5 * (mr + r), normalize(dr)));
    }
  }
  return vec2(md, hashI(imod(mc, per), seed + 17.0));
}

// Marble's noise wraps on any integer period lattice, not only axis-aligned periods, so the streaks' turbulence can be
// stretched along veins at any (snapped) angle and still tile. The period lattice has the integer basis B = (b1, b2)
// (an ivec4: b1.xy, b2.xy); a lattice point c is reduced to its representative in the cell B·[0, 1)², exactly (small
// integers, so the float quotients floor correctly). An axis-aligned period (Px, Py) is (Px, 0, 0, Py): then this is
// the noise library's imod wrap (but mb_perlin is unclamped, unlike perlinNoise).
ivec2 mb_wrap(ivec2 c, ivec4 B) {
  vec4 b = vec4(B);
  vec2 l = floor(vec2(b.w * float(c.x) - b.z * float(c.y), b.x * float(c.y) - b.y * float(c.x)) / (b.x * b.w - b.z * b.y));
  return c - int(l.x) * B.xy - int(l.y) * B.zw;
}

float mb_perlin(vec2 x, ivec4 B, float seed) {
  ivec2 i = ivec2(floor(x));
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(gradDir(mb_wrap(i, B), seed), f);
  float b = dot(gradDir(mb_wrap(i + ivec2(1, 0), B), seed), f - vec2(1.0, 0.0));
  float c = dot(gradDir(mb_wrap(i + ivec2(0, 1), B), seed), f - vec2(0.0, 1.0));
  float d = dot(gradDir(mb_wrap(i + ivec2(1, 1), B), seed), f - vec2(1.0, 1.0));
  // Unclamped: clamping each octave to 0..1 (as the noise library does) put kinks along closed curves round its peaks,
  // where the veins' curvature spiked and the loop culling cut pale hairlines through them.
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.2 + 0.5;
}

// Fractal Perlin sum (optionally billowed, |2n - 1|), lacunarity 2, on the period lattice B. cpx > 0 (Filter fine
// detail): the first octave's cells are cpx px across, and an octave fades to its mean where its cells shrink under
// ~2–4 px or where it alone would crowd the veins' contours under a pixel — fs: the vein periods one unit of this
// noise moves the field by (the turbulence's warp, the fold's), so its slope in periods per px is fs · amp / cells.
// Neither can then alias into speckle or moiré, however hard warp and fold squeeze the field.
float mb_fbm(bool billow, vec2 x, ivec4 B, int oct, float gain, float seed, float cpx, float fs) {
  float sum = 0.0, amp = 1.0, norm = 0.0;
  float an = fs * (billow ? 2.0 : 1.0) * (abs(1.0 - gain) < 1e-3 ? 1.0 / float(oct) : (1.0 - gain) / (1.0 - pow(gain, float(oct))));
  for (int o = 0; o < 8 * UNI_1; o++) {
    if (o >= oct) break;
    float n = mb_perlin(x, B, seed + float(o) * 31.0);
    if (billow) n = abs(2.0 * n - 1.0);
    if (cpx > 0.0) n = mix(billow ? 0.4 : 0.5, n, smoothstep(2.0, 4.0, cpx) * (1.0 - smoothstep(0.08, 0.25, an * amp / cpx)));
    sum += n * amp;
    norm += amp;
    amp *= gain;
    x *= 2.0;
    cpx *= 0.5;
    if (uTile) B *= 2;
  }
  return sum / max(norm, 1e-6);
}

// The strongest of three weighted vein strands at distances d (px): core width w, falloff s.x (the veins) and s.y (a
// softer copy for Height) — org_line's formula, for two falloffs at once.
vec2 mb_line(float d, float w, vec2 s) { return 1.0 - smoothstep(vec2(-0.5), 0.5 + max(s, 0.0), vec2(d - 0.5 * w)); }
vec2 mb_lines(vec3 d, vec3 wt, float w, vec2 s) {
  return max(wt.x * mb_line(d.x, w, s), max(wt.y * mb_line(d.y, w, s), wt.z * mb_line(d.z, w, s)));
}

// The smallest lattice cell (px) of noise sampled at (p / uRes) * T.
float mb_cellPx(mat2 T) { return 1.0 / max(max(length(T[0] / uRes), length(T[1] / uRes)), 1e-6); }

ivec4 mb_axisPer(vec2 cells) { ivec2 p = org_per(cells); return ivec4(p.x, 0, 0, p.y); }

// Tiling: a small integer direction m (components up to 4) near c, the bands' wave vector in cycles per texture — the
// first within ~6°, else the closest — and a Bezout pair (s, t) of it (s·m.x + t·m.y = 1): the streaks' stretched
// turbulence lattice is built on them (mb_turbFrame). Once per pixel, outside the vein loop (D3D compiled loops in
// there slowly).
// For two wave vectors at once (the main veins' and the fine ones'), in the same two loops.
void mb_turbDir(vec2 c0, vec2 c1, out ivec4 d0, out ivec4 d1) {
  vec2 cn0 = normalize(c0), cn1 = normalize(c1);
  vec2 m0 = vec2(0.0, 1.0), m1 = m0;
  vec2 best = vec2(-2.0);
  for (int n = 1; n <= 4 * UNI_1; n++) {
    vec2 v0 = floor(c0 / max(abs(c0.x), abs(c0.y)) * float(n) + 0.5);
    vec2 v1 = floor(c1 / max(abs(c1.x), abs(c1.y)) * float(n) + 0.5);
    vec2 q = vec2(dot(normalize(v0), cn0), dot(normalize(v1), cn1));
    // The first within ~6°, else the closest.
    if (q.x > best.x + 1e-4 && best.x <= 0.995) { best.x = q.x; m0 = v0; }
    if (q.y > best.y + 1e-4 && best.y <= 0.995) { best.y = q.y; m1 = v1; }
  }
  // Extended Euclid: s·m.x + t·m.y = g, so the primitive m / g has the Bezout pair (s, t).
  ivec3 a0 = ivec3(int(m0.x), 1, 0), a1 = ivec3(int(m0.y), 0, 1);
  ivec3 b0 = ivec3(int(m1.x), 1, 0), b1 = ivec3(int(m1.y), 0, 1);
  for (int i = 0; i < 8 * UNI_1; i++) {
    if (a1.x == 0 && b1.x == 0) break;
    if (a1.x != 0) { ivec3 a2 = a0 - (a0.x / a1.x) * a1; a0 = a1; a1 = a2; }
    if (b1.x != 0) { ivec3 b2 = b0 - (b0.x / b1.x) * b1; b0 = b1; b1 = b2; }
  }
  if (a0.x < 0) a0 = -a0;
  if (b0.x < 0) b0 = -b0;
  d0 = ivec4(ivec2(m0) / max(a0.x, 1), a0.yz);
  d1 = ivec4(ivec2(m1) / max(b0.x, 1), b0.yz);
}

// The streaks' turbulence lattice: lattice coords x = (p / uRes) * T, axis 0 along the veins (ws / stretch cells per
// texture), axis 1 across them (ws), wrapping on B. Unstretched it is the plain axis-aligned lattice. Tiling: T is
// integer — its across column a multiple of the direction m (mb_turbDir), its along column the integer vector with the
// wanted along-vein frequency and the least skew — and B is where T takes the texture's own repeats.
mat2 mb_turbFrame(vec2 k, float ws, float stretch, ivec4 md, out ivec4 B) {
  vec2 wc = cellsFor(ws, 1.0);
  B = mb_axisPer(wc);
  if (abs(stretch - 1.0) < 1e-3) return mat2(wc.x, 0.0, 0.0, wc.y);
  vec2 kn = normalize(k);
  if (!uTile) {
    vec2 s = uRes / uRes.x * ws;
    return mat2(vec2(-kn.y, kn.x) * s / stretch, kn * s);
  }
  ivec2 m = md.xy;
  float L = length(vec2(m));
  // Along: cross(m, A) = ka gives ka / L cells per texture along the veins; then the least skew (A·m small).
  ivec2 A = max(1, int(floor(ws / stretch * L + 0.5))) * ivec2(-md.w, md.z);
  A -= int(floor(float(A.x * m.x + A.y * m.y) / (L * L) + 0.5)) * m;
  ivec2 C = max(1, int(floor(ws / L + 0.5))) * m;
  // The texture's repeats (1, 0) and (0, 1) land on (A.x, C.x) and (A.y, C.y).
  B = ivec4(A.x, C.x, A.y, C.y);
  return mat2(vec2(A), vec2(C));
}

// Veins. Streaks and network: veins lie on the integer level sets of a field F — streaks: bands along the wave vector k
// bent by turbulence (billow or signed, optionally stretched along the veins) and by an optional larger fold warp;
// network: contours of noise under a domain warp (Detail octaves; the contoured noise itself has few, or its contours
// scribble). A vein's distance (px) is |fract(F + ½) − ½| / |∇F|. Cells: borders of warped Worley cells.
//
// Three systems — 0 the main veins, 1 the finer ones, 2 the mottled background — and all their noise run in one flat
// loop of evaluations with a single noise call: D3D (Chrome's default on Windows) inlines every call, and nested loops
// of noise calls compiled several times slower. Each system takes 20 slots: slot 0 its width / breakup noise (for the
// background its own noise, and then the loop ends), slots 1–18 its field — for p and one px right / up (the gradient
// of F) and, for the main ridges' culling, left, down and up-right (the crest's curvature): the two warp components
// (network, cells, ridges; streaks when folded), then F (cells only need the warped p, then the Worley border) — and
// slot 19 the fine veins' density patches or the ridges' strand field, after which the system's veins are drawn.
GenOut gen(vec2 p) {
  // Tiles: each tile shows its own cut of the marble (shifted pattern, rotated veins).
  vec2 q = p;
  float ang = u_angle;
  float tileRnd = -1.0;
  if (u_tiles > 0) {
    vec2 tn = vec2(float(u_tiles), max(1.0, floor(float(u_tiles) * uRes.y / uRes.x + 0.5)));
    ivec2 ti = imod(ivec2(floor(p / (uRes / tn))), ivec2(tn));
    vec3 th = hash3I(ti, uSeed + 5.0);
    q = p + floor(th.xy * uRes);
    ang += (th.z - 0.5) * 2.0 * u_tile_rot;
    tileRnd = hashI(ti, uSeed + 9.0);
  }
  vec2 u = q / uRes;
  vec2 bc = cellsFor(max(u_warp_scale, 1.0) * 2.0, 1.0);
  // Width from flow: the typical |grad F| over the bands' own (streaks) / the contoured noise's (network) gradient,
  // fitted to renders — raised by the turbulence and folding. og: how much steeper the Detail octaves make the noise
  // than its first octave (the RMS of their gradients over the sum of their amplitudes), for all of them and for the
  // first three (the fold's).
  vec2 flowRef = vec2(1.0);
  // How much the folding squeezes the turbulence's domain, typically (for the filter; network, cells and ridges: the
  // warp's squeeze, 1 + 3 · warp · warp scale / cells, in the loop).
  float foldK = 1.0;
  if (u_flow > 0.0 || u_cull > 0.0 || u_filter) {
    float r = u_rough, r2 = 4.0 * r * r;
    vec2 n = vec2(float(u_detail), float(min(u_detail, 3)));
    vec2 og = sqrt(abs(1.0 - r2) < 1e-3 ? n : (1.0 - pow(vec2(r2), n)) / (1.0 - r2)) / ((1.0 - pow(vec2(r), n)) / (1.0 - r));
    float ws = u_warp_scale / max(u_veins, 0.25);
    float t = 2.8 * og.x * u_warp * ws;
    float fo = 0.98 * og.y * u_fold * ws;
    foldK = 1.0 + fo;
    flowRef = vec2(sqrt((1.0 + t * t * (u_turb == 0 ? 1.0 : 0.2)) * (1.0 + fo * fo)), 1.05 * sqrt(1.0 + 0.25 * t * t));
  }
  // The directions of the stretched turbulence lattices — the main veins' and the fine ones' (Fine angle) — from their
  // bands' wave vectors in whole cycles per texture (as mb_waveK snaps them).
  ivec4 md = ivec4(0, 1, 0, 1), mdf = md;
  if (uTile && (u_stretch != 1.0 || u_cloud_stretch != 1.0))
    mb_turbDir(mb_waveCycles(u_veins, ang), mb_waveCycles(u_veins * u_fine_scale, ang + u_fine_angle), md, mdf);

  float vein = 0.0, veinR = 0.0, rnd = 0.0, base = 0.0, dMain = 1e9, ffMain = 1.0, fadeMain = 1.0, fpatch = 1.0;
  // The current system's frame and state.
  float nb = 0.0, wm = 1.0, sd = 0.0;
  int g = 1;
  vec2 k = vec2(0.0), nc = vec2(1.0), wc = vec2(1.0), w = vec2(0.0), x = vec2(0.0);
  vec4 f = vec4(0.0);
  vec2 fb = vec2(0.0);
  mat2 T = mat2(1.0);
  ivec4 B = ivec4(1, 0, 0, 1);
  vec2 km = vec2(0.0, 1.0);
  bool streaks = true, cells = false, ridges = false, fold = false;
  float ns = 0.5;
  // No continue in this loop (ANGLE / D3D11 can miscompile it): skipped slots fall through the run test instead.
  for (int e = 0; e < 41 * UNI_1; e++) {
    int sys = e / 20, j = e - 20 * sys;
    bool cloud = sys == 2;
    bool on = !((sys == 1 && u_fine <= 0.0) || (cloud && u_cloud <= 0.0));
    if (on && j == 0) {
      if (!cloud) {
        // wm: fine veins per main vein (the turbulence keeps its strength in px).
        wm = sys == 0 ? 1.0 : u_fine_scale;
        sd = uSeed + 50.0 * float(sys);
        int style = sys == 0 || u_fine_style == 0 ? u_style : u_fine_style - 1;
        streaks = style == 0;
        cells = style == 2;
        ridges = style == 3;
        // The fine streaks may run at an angle to the main ones (crossing them, branching off them).
        k = mb_waveK(u_veins * wm, sys == 1 ? ang + u_fine_angle : ang, g);
        if (sys == 0) km = k;
        nc = cellsFor(u_veins * wm, u_stretch);
        // Streaks: Folding bends the whole band field (bands and turbulence together) by a smooth warp at half the scale.
        fold = streaks && u_fold > 0.0;
        wc = streaks ? cellsFor(max(u_warp_scale * 0.5, 0.25), 1.0) : cellsFor(u_warp_scale, 1.0);
        ns = 0.5;
        f = vec4(0.0);
        fb = vec2(0.0);
        w = vec2(0.0);
      }
      // The turbulence lattice — for ridges the veins' own noise, Veins cells across; the fine veins' along their own
      // angle (Fine stretch) — and the background's (drawn out along the veins by Cloud stretch).
      T = mb_turbFrame(cloud ? km : k, cloud ? (u_cloud_scale > 0.0 ? u_cloud_scale : max(u_warp_scale, 1.0) * 1.5) : ridges ? u_veins * wm : u_warp_scale,
                       cloud ? (u_style == 0 || u_style == 3 ? u_cloud_stretch : 1.0)
                             : streaks || ridges ? (sys == 0 ? u_stretch : u_stretch * u_fine_stretch) : 1.0, sys == 1 ? mdf : md, B);
    }
    bool field = j >= 1 && j <= 18;
    // Sample i: p, right, up, and for the main ridges' loop culling left, down, up-right (the crest's curvature);
    // c = warp x, warp y, field.
    int ev = clamp(j - 1, 0, 17), i = ev / 3, c = ev - 3 * i;
    bool warp = field && c < 2;
    // Skipped: a system that is off, the streaks' warp slots unless folded, cells' samples past the first (the Worley
    // border needs only the warped p), and the fourth sample unless culling the main ridges.
    bool run = on && !(warp && streaks && !fold) && !(cells && field && ev > 2) && !(field && i >= 3 && !(ridges && u_cull > 0.0));
    if (run) {
      // Filtering, F's gradient is taken over 3 px: it averages away what would alias, and the loop culling's direction
      // test reads the vein's course, not the finest wiggles.
      vec2 o = (i == 0 ? vec2(0.0) : i == 1 ? vec2(1.0, 0.0) : i == 2 ? vec2(0.0, 1.0) : i == 3 ? vec2(-1.0, 0.0)
              : i == 4 ? vec2(0.0, -1.0) : vec2(1.0)) * (u_filter ? 3.0 : 1.0);
      vec2 pw = q + o;
      vec2 uw = pw / uRes * wc;
      if (field && !warp) {
        if (fold) pw += (w - 0.5) * 2.0 * u_fold * uRes.x / max(u_veins, 0.25);
        // Fine wander: the fine veins' own extra warp (in main-vein cells: Fine scale × as many of theirs), so their
        // spacing and angle vary locally.
        x = streaks ? pw / uRes * T : (ridges ? pw / uRes * T : pw / uRes * nc) + (w - 0.5) * (u_warp + (sys == 1 ? u_fine_wander * wm : 0.0)) * 2.0;
      }
      bool last = j == 19;
      // The fine veins' density patches' / the ridges' strand field's cells.
      vec2 pc = cellsFor(max(u_warp_scale, 1.0) * (sys == 0 ? 1.2 : 0.75), 1.0);
      bool noise = !(field && !warp && cells) && (!last || (sys == 1 && u_fine_patch > 0.0) || (sys == 0 && ridges && u_fork > 0.0));
      if (noise) {
        // The noise call's arguments for this slot: lattice transform Tn, sample point xa and its period lattice Ba,
        // octaves oa, gain ga, seed sa, first octave's cell size cpx (Filter fine detail) and field scale fsa (mb_fbm).
        mat2 Tn;
        vec2 xa;
        ivec4 Ba;
        int oa;
        float ga, sa, cpx, fsa;
        if (j == 0) {
          // Width / breakup noise: along stretched streaks it is drawn out with them (long fades, not dashes). The
          // background's own noise.
          vec2 bn = bc * float(sys + 1);
          bool sf = streaks && abs(u_stretch - 1.0) >= 1e-3;
          float bk = float(2 * (sys + 1));
          Tn = cloud ? T : sf ? T * bk : mat2(bn.x, 0.0, 0.0, bn.y);
          xa = cloud || sf ? u * Tn : u * bn;
          Ba = cloud ? B : sf ? B * int(bk) : mb_axisPer(bn);
          oa = cloud ? 5 : 3;
          ga = 0.5;
          sa = cloud ? uSeed + 77.0 : uSeed + 91.0 + 2.0 * float(sys);
          fsa = 0.0;
        } else if (last) {
          // The fine veins' density patches, or (1.6× finer) the ridges' strand field: strands part and rejoin.
          Tn = mat2(pc.x, 0.0, 0.0, pc.y);
          xa = u * pc;
          Ba = mb_axisPer(pc);
          oa = 3;
          ga = 0.5;
          sa = uSeed + 133.0;
          fsa = 0.0;
        } else if (warp) {
          Tn = mat2(wc.x, 0.0, 0.0, wc.y);
          xa = uw + (c == 0 ? 0.0 : 17.3);
          Ba = mb_axisPer(wc);
          oa = streaks || ridges ? min(u_detail, 3) : u_detail;
          ga = u_rough;
          sa = c == 0 ? sd + 7.0 + 101.0 : sd + 7.0 + 211.0;
          fsa = streaks ? 2.0 * u_fold : ridges ? 4.0 * u_warp : 4.0 * u_levels * u_warp;
        } else {
          // The field F.
          bool sr = streaks || ridges;
          Tn = sr ? T : mat2(nc.x, 0.0, 0.0, nc.y);
          xa = x;
          Ba = sr ? B : mb_axisPer(nc);
          oa = sr ? u_detail : min(u_detail, 3);
          ga = sr ? u_rough : 0.45;
          sa = sd;
          fsa = streaks ? u_warp * wm * 2.0 : ridges ? 2.0 : 2.0 * u_levels;
        }
        cpx = u_filter ? mb_cellPx(Tn) / (field && !warp ? (fold ? foldK : streaks ? 1.0 : 1.0 + 3.0 * u_warp * u_warp_scale / max(u_veins * wm, 0.25)) : 1.0) : 0.0;
        float n = mb_fbm(field && streaks && !warp && u_turb == 0, xa, Ba, oa, ga, sa, cpx, fsa);
        if (j == 0) {
          nb = n;
          if (cloud) {
            base = u_cloud * clamp((nb - 0.2) / 0.6, 0.0, 1.0);
            break;
          }
        } else if (last) {
          if (sys == 1) fpatch = mix(1.0, smoothstep(0.38, 0.62, n), u_fine_patch);
          else ns = n;
        }
        else if (c == 0) w.x = n;
        else if (c == 1) w.y = n;
        else {
          float F = streaks ? dot(pw, k) + u_warp * wm * 2.0 * n : ridges ? n - 0.5 : (n - 0.5) * 2.0 * u_levels;
          if (i == 0) f.x = F; else if (i == 1) f.y = F; else if (i == 2) f.z = F; else if (i == 3) f.w = F;
          else if (i == 4) fb.x = F; else fb.y = F;
        }
      }
      if (last) {
        // The system's veins: the distance (px) to the centre strand and (Strands) the two side strands, their weights,
        // and the per-vein random.
        vec3 ds = vec3(1e9), wt = vec3(1.0, 0.0, 0.0);
        // Strands: their separation from the centre strand (px) and how far they have parted (0..1).
        vec2 sep = vec2(0.0), spr = vec2(0.0);
        float vr = 0.0, fade = 1.0, fadeS = 1.0, ff = 1.0, gEst = 0.0;
        if (cells) {
          vec2 wb = mb_worleyBorder(x, org_per(nc), sd);
          vec2 cs = uRes / nc;
          ds.x = wb.x * sqrt(cs.x * cs.y);
          vr = wb.y;
        } else {
          float f0 = f.x;
          vec2 gv = (f.yz - f0) / (u_filter ? 3.0 : 1.0);
          float grad = max(length(gv), 1e-4);
          // Ridges: the veins are the zero set of the warped noise itself (its crests, as 1 − |n|), not repeating
          // contours of a field.
          float t = ridges ? f0 : fract(f0 + 0.5) - 0.5;
          vec3 df = vec3(abs(t), 1e9, 1e9);
          if (ridges && sys == 0 && u_fork > 0.0) {
            // Ridges' strands: one side strand, the zero set of the noise shifted by a second, smooth field — it lies on
            // the vein where that field crosses zero and splits off from there, thinner, fading as it parts.
            float sp = 2.0 * ns - 1.0;
            sep.x = u_fork * 0.3 * abs(sp);
            df.y = abs(t - u_fork * 0.3 * sp);
            wt.y = 1.0 - smoothstep(0.35, 1.0, abs(sp));
            spr.x = abs(sp);
          } else if (sys == 0 && u_fork > 0.0) {
            // Strands: side strands branch off a main vein — their offset grows from zero along it (by the width noise),
            // thinner, tapering out as they part; one each side, one parting where the other closes up.
            vec2 sp = smoothstep(0.3, 0.75, vec2(nb, 1.0 - nb));
            sep = u_fork * 0.2 * sp;
            df.yz = abs(vec2(t, -t) - u_fork * 0.2 * sp);
            wt.yz = 1.0 - smoothstep(0.55, 1.0, sp);
            spr = sp;
          }
          float gref = streaks ? length(k) * flowRef.x
                     : ridges ? 0.5 * length(vec2(length(T[0] / uRes), length(T[1] / uRes))) * flowRef.y
                     : u_levels * length(nc / uRes) * flowRef.y;
          // Width from flow: veins swell where the field spreads out and thin where it bunches up (a band of F rather
          // than a line of constant px width), against the field's typical gradient.
          // Ridges: the other way round — strong crests are broad, weak ones thin out toward their ends.
          float sw = u_flow <= 0.0 ? 1.0 : ridges ? pow(clamp(grad / gref, 0.2, 3.0), 1.5 * u_flow) : pow(clamp(gref / grad, 0.25, 3.0), u_flow);
          ds = df / grad / sw;
          sep /= grad * sw;
          // Ridges' strands only off firm crests: where the field flattens, |t − offset| / |∇t| is no px distance any
          // more and the strand smeared into a soft smudge.
          // Nor where the strand's offset field moves about as fast as the crest field itself (the strand is the zero set of
          // t − offset, whose gradient then nearly cancels — the same smudge).
          if (ridges) {
            float gc = u_fork * 0.6 * 1.5 * length(pc / uRes);
            wt.y *= smoothstep(0.35, 0.8, grad / gref) * smoothstep(1.2, 2.8, grad / max(gc, 1e-6));
          }
          // Loop culling: veins fade where the field is flat (tiny rings round its extrema) and, along streaks, where a
          // contour runs back against the bands — the far side of every closed loop and hairpin fold, whatever its size.
          // Ridges: the crests fade out gradually as the noise flattens toward an extremum or a saddle — small closed
          // loops vanish and a vein that meets a saddle tapers out instead of hooking round.
          // Drawn out along the angle (Stretch), they also fade where they turn across it — the closing ends of loops and
          // hooks open into tapered tips.
          if (u_cull > 0.0 && ridges) {
            fade = smoothstep(0.15 * u_cull, 0.75 * u_cull, grad / gref);
            float ax = abs(dot(gv, k)) / (grad * max(length(k), 1e-6));
            fade *= mix(1.0, smoothstep(0.0, 0.35, ax), min(1.0, 1.5 * u_cull) * smoothstep(1.0, 3.0, u_stretch));
            // And where the crest bends tightly — hooks, hairpins, small rings and lenses: tapering out as its bend
            // radius falls from 3 to 1 × (cull · 0.1 × its system's vein spacing). The halo keeps only the smooth terms
            // above (fadeS): the curvature changes sharply off the crest and would cut ribbons into it.
            fadeS = fade;
            {
              // The crest's curvature (1 / px), from the field's quadratic fit over the six samples.
              float h = u_filter ? 3.0 : 1.0;
              vec2 g1 = vec2(f.y - f.w, f.z - fb.x) / (2.0 * h);
              float fxx = (f.y - 2.0 * f0 + f.w) / (h * h), fyy = (f.z - 2.0 * f0 + fb.x) / (h * h);
              float fxy = (fb.y - f.y - f.z + f0) / (h * h);
              // The gradient floored at a third of the typical one: where it nearly vanishes the ratio spiked along thin
              // curves and cut pale hairlines through the veins (flat crests fade by the gradient term above anyway).
              float kap = abs(fxx * g1.y * g1.y - 2.0 * g1.x * g1.y * fxy + fyy * g1.x * g1.x) / max(pow(max(length(g1), 0.33 * gref), 3.0), 1e-9);
              float rMin = u_cull * 0.1 * uRes.x / max(u_veins * wm, 0.25);
              fade *= 1.0 - smoothstep(0.33, 1.0, kap * rMin);
            }
          }
          if (u_cull > 0.0 && !ridges) {
            fade = smoothstep(0.2 * u_cull, 0.5 * u_cull, grad / gref);
            if (streaks) fade *= mix(1.0, smoothstep(-0.15, 0.35, dot(gv, k) / (grad * length(k))), u_cull);
          }
          // Filter: the noise has already dropped the octaves that would crowd F's contours under a pixel (mb_fbm), so
          // its gradient is trustworthy; where contours still crowd (below), the veins blend to their average cover.
          gEst = grad;
          int band = int(floor(f0 + 0.5));
          if (streaks && uTile) band = imod(band, g);
          vr = ridges ? 0.5 : hashI(ivec2(band, 3), sd);
        }
        float wv = mix(1.0, clamp(0.25 + 1.5 * nb, 0.25, 2.0), u_width_var);
        float lw = sys == 0 ? u_width * wv : u_fine_width > 0.0 ? u_fine_width : clamp(u_width * 0.35, 0.75, 1.5);
        float ls = u_soft * (sys == 0 ? wv : 0.5);
        // Ridges: Breakup tapers the veins (width and strength together) instead of fading them — pointed ends.
        // Fine breakup: the fine veins broken into lengths that taper out (their own noise, nb at twice the frequency).
        float fbT = sys == 1 && u_fine_break > 0.0 ? mb_breakup(nb, u_fine_break) : 1.0;
        float tpB = (ridges && u_breakup > 0.0 ? mb_breakup(nb, u_breakup) : 1.0) * fbT;
        // Culled ridges taper the same way.
        float tp = ridges ? tpB * fade : fbT;
        lw *= tp;
        ls *= tp;
        // Cells: each cell's side of its border its own weight (a crackle of heavy and hairline edges).
        if (cells && u_cell_var > 0.0) lw *= mix(1.0, 0.35 + 1.3 * vr, u_cell_var);
        // Strands: each a little thinner than the vein and thinning as it parts, but at least 1.5 px (thinner, they bead
        // into dotted lines on diagonals); hidden until they have parted by a clear gap of ~1.5 px (merged before).
        if (u_fork > 0.0 && sys == 0) {
          vec2 sw2 = max(lw * 0.65 * (1.0 - 0.35 * spr), vec2(1.5));
          ds.yz *= lw / sw2;
          vec2 gap = sep - 0.5 * (lw + sw2);
          wt.yz *= smoothstep(0.75, 2.25, gap);
        }
        // The veins, and a softer copy for Height (Relief < 1): no 1 px features in the normals, so no glints.
        vec2 lv = mb_lines(ds, wt, lw, vec2(ls, u_relief < 1.0 ? clamp(ls, 2.0, 3.0) : ls));
        float l = lv.x, lr = lv.y;
        // Filtered, everything read from the distance (the lines, the halo, the culling) blends to its average over a
        // vein period where the field aliases, or it would flicker from pixel to pixel.
        float hw = max(u_halo_width, 1e-3);
        // The halo isn't culled with the core: the culling varies sharply away from the crest and cut pale ribbons into
        // the wash. Around a culled vein it stays as a soft, dissolved trace.
        // Ridges: a falloff that ends 1.5 halo widths out, culled with its core — a culled crest leaves no smudge, and
        // as the washes of neighbouring crests don't overlap, the culled one cuts no pale ribbon into them either.
        float hq = 1.0 - smoothstep(0.0, 1.5 * hw, ds.x);
        float hal = sys == 0 && u_halo > 0.0 ? u_halo * (ridges ? hq * hq : exp(-3.0 * ds.x / hw)) : 0.0;
        // Not for ridges or cells: their veins don't repeat every unit of the field (a ridge has one crest), so a steep
        // crest isn't a crowd of contours — the test smeared strong ridges into smudges.
        if (u_filter && !cells && !ridges) {
          // Lines blend into a tone once their spacing is under ~2.5 × their width (core, falloff and a px of AA).
          ff *= smoothstep(1.2, 2.5, 1.0 / (gEst * (lw + ls + 1.0)));
          float avg = clamp((lw + 0.5 * ls) * gEst, 0.0, 0.5);
          float P = 1.0 / max(gEst, 1e-4);
          l = mix(avg, l, ff);
          lr = mix(avg, lr, ff);
          hal = mix(hal > 0.0 ? u_halo * min(1.0, 2.0 * hw / (3.0 * P) * (1.0 - exp(-1.5 * P / hw))) : 0.0, hal, ff);
          fade = mix(1.0 - 0.3 * u_cull, fade, ff);
        }
        l *= fade;
        lr *= fade;
        float bk = ridges ? tp : (u_breakup > 0.0 ? mb_breakup(nb, u_breakup) : 1.0) * fbT;
        // The halo is colour only (in Height it rippled the polished ground); for ridges it fades with the breakup
        // but not the culling.
        if (ridges) hal *= tpB * fade;
        l = ridges ? max(l * bk, hal) : max(l, hal) * bk;
        lr *= bk;
        if (sys == 0) {
          rnd = vr;
          dMain = ds.x;
          ffMain = ff;
          fadeMain = fade * tpB;
        } else {
          float nf = fpatch;
          if (u_fine_near > 0.0) {
            // Only round visible main veins (a culled crest counts as far).
            float t = dMain / (0.15 * uRes.x / max(u_veins, 0.25) * max(fadeMain, 0.02));
            nf *= mix(1.0, u_filter ? mix(0.4, exp(-t * t), ffMain) : exp(-t * t), u_fine_near);
          }
          l *= nf;
          lr *= nf;
        }
        vein = max(vein, sys == 0 ? l : l * u_fine);
        veinR = max(veinR, sys == 0 ? lr : lr * u_fine);
      }
    }
  }
  float v = base + (1.0 - base) * vein;
  GenOut go = genOut(clamp(v, 0.0, 1.0), 1.0, tileRnd >= 0.0 ? tileRnd : rnd, NO_SDF);
  // Per-feature variation only per tile or cell: a band's random would step the height at every band midline (in the
  // stone, between the veins) and the ridges' is a constant. The random stays for colour jitter.
  if (u_tiles <= 0 && u_style != 2) go.feat = 0.0;
  // Relief < 1: Height follows mostly the veins, shallower (the clouds fade out of it faster).
  if (u_relief < 1.0) go.hval = clamp(u_relief * (base * u_relief + (1.0 - base * u_relief) * veinR), 0.0, 1.0);
  return go;
}
`
};

// ------------------------------------------------------------------------------------------------ caustics

export const causticsLayer: LayerDef = {
	type: 'caustics',
	noise: true,
	label: 'Caustics / liquid',
	category: 'pattern',
	kind: 'generator',
	description:
		'Liquid surfaces — lava, slime, water: bright rims on warped, rounded cells (net) or bright blobs split by dark cracks.',
	params: [
		P.enum(
			'mode',
			'Mode',
			'net',
			[
				['net', 'Caustic net (bright rims)'],
				['blobs', 'Blobs (bright cells, dark cracks)']
			],
			{
				hint: 'Value is brightness in both modes. Net: Height subtracts it, so the rims sink and the cells bulge; Blobs: Height adds it (the height mode follows the mode until you set it)'
			}
		),
		P.float('scale', 'Scale', 5, 0.5, 64, {
			softMax: 16,
			step: 0.01,
			hint: 'Cells across the texture width (rounded when tiling)'
		}),
		P.float('stretch', 'Stretch', 1, 0.1, 10, {
			softMin: 0.25,
			softMax: 4,
			step: 0.01,
			hint: '> 1 draws the cells out horizontally (flowing lava, a current), < 1 vertically'
		}),
		P.float('jitter', 'Jitter', 0.85, 0, 1, { step: 0.001 }),
		P.float('size_var', 'Size variation', 0.5, 0, 1, {
			step: 0.001,
			hint: 'Weighted cells: some blobs grow, others shrink'
		}),
		P.float('round', 'Roundness', 0.8, 0, 1, {
			step: 0.001,
			hint: '0 = polygonal cells; 1 = round blobs (the glow follows F1 / F2 circles; the net thickens slightly at junctions)'
		}),
		P.float('warp', 'Warp', 0.3, 0, 4, {
			softMax: 1.5,
			step: 0.001,
			hint: 'Domain warp, in cells — wobbly, organic rims; high values swirl the cells into each other'
		}),
		P.float('warp_scale', 'Warp scale', 1, 0.25, 16, {
			softMax: 4,
			step: 0.01,
			hint: 'Warp noise frequency relative to the cells'
		}),
		P.int('warp_detail', 'Warp detail', 2, 1, 6, {
			showIf: (p) => Number(p.warp) > 0,
			hint: 'Warp octaves: 1–2 smooth, blobby distortion; more = ragged, wrinkled rims'
		}),
		P.float('rim', 'Rim width', 1.4, 0, 64, {
			softMax: 12,
			unit: 'px',
			step: 0.05,
			hint: 'Width of the bright core (net) or dark crack (blobs)'
		}),
		P.float('rim_soft', 'Rim softness', 0.5, 0, 32, { softMax: 8, unit: 'px', step: 0.05 }),
		P.float('rim_var', 'Rim variation', 0.6, 0, 1, {
			step: 0.001,
			hint: 'Rims widen, pinch and change brightness along their length (0 = an even line)'
		}),
		P.float('rim_round', 'Rounded rims', 1, 0, 1, {
			step: 0.001,
			hint: 'A smooth crest across each rim and pool, blending into the glow (0 = a flat, clipped core with a hard inner edge)'
		}),
		P.float('glow', 'Glow reach', 1, 0, 3, {
			softMax: 2,
			step: 0.001,
			hint: 'How far the rim light reaches into the cell (fraction of the cell radius)'
		}),
		P.float('glow_smooth', 'Glow smoothing', 0.35, 0, 1, {
			step: 0.001,
			hint: 'Rounds the glow and dome over the cells’ corners: no straight creases from the corners to the core (0 = the exact polygon distance)'
		}),
		P.float('glow_amount', 'Glow level', 0.65, 0, 1, {
			step: 0.001,
			hint: 'Brightness of the glow next to the rim (net) / of the blob edge (blobs)'
		}),
		P.float('falloff', 'Falloff', 0.7, 0.1, 8, {
			softMax: 4,
			step: 0.01,
			hint: 'Glow curve: < 1 keeps the glow level wide then drops into dark cores; > 1 fades quickly from the rim (net). Blobs: higher = flatter tops'
		}),
		P.float('octave2', 'Second octave', 0.3, 0, 1, {
			step: 0.001,
			hint: 'Finer rims / cracks of smaller cells inside the main ones'
		}),
		P.float('octave2_scale', 'Second octave scale', 2, 1.25, 8, {
			softMax: 4,
			step: 0.01,
			showIf: (p) => Number(p.octave2) > 0,
			hint: 'Its cells per main cell (across)'
		}),
		P.float('octave2_nest', 'Nest second octave', 1, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.octave2) > 0,
			hint: 'Fades the second octave toward the main rims, tapering it in width and strength (a hierarchy inside each cell). 0 = even everywhere'
		}),
		P.float('dome', 'Rounded relief', 0.8, -1, 1, {
			step: 0.001,
			hint: 'What Height › Pattern follows: 0 = the brightness (the glow’s curve, flat where it fades out), 1 = a rounded dome on every cell, −1 = flat plates; sunk at the rims (net) / cracks (blobs)'
		}),
		P.float('cell_h', 'Cell height variation', 0.4, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.dome) !== 0,
			hint: 'Each cell its own height above the common rim floor (Rounded relief). Unlike Height › Per-feature variation, which scales the whole depth, the rims stay continuous: no cliffs'
		}),
		P.float('dome_var', 'Dome variation', 0.6, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.dome) > 0,
			hint: 'Each cell’s dome its own shape: flat-topped pillows to peaked mounds (Cell height variation sets their heights)'
		}),
		P.seed()
	],
	// The cells (inside the rims / cracks) go to a mask when it writes one — e.g. a crust only on the blobs. None by
	// default: a value pattern shouldn't replace the Shape mask unless asked.
	sdf: 'mask',
	// No Edge card: the caustics don't follow the cells' outline (a bevel would only darken towards it), and they cover
	// everything (nothing to anti-alias). The shape still goes to the mask.
	sdfShowIf: (_p, key) => key === undefined,
	defaults: {
		mk_target: '',
		dif_on: true,
		dif_grad: gradient('#1c0400', '#4f0b00', '#9c2400', '#e05a00', '#ffa21a', '#ffe08a'),
		h_on: true,
		h_mode: 'subtract',
		h_amount: 0.35,
		e_on: true,
		e_color: '#ff6a10',
		e_intensity: 0.6
	},
	// Blobs are bright where they are high: Height adds them; the net's bright rims are sunk.
	linkedDefaults: (p) => ({ h_mode: p.mode === 'blobs' ? 'add' : 'subtract' }),
	glsl:
		ORG_GLSL +
		/* glsl */ `
// Power-weighted Voronoi cell boundary distance (px), measured in a stretch metric: the cells, of aspect cs.x / cs.y,
// are square in the space p · M, so the 5×5 searches stay exact however far they are stretched. Sites jitter inside the
// cells grid; weights vary the cell sizes. Returns x = distance to the cell border rounded by a soft minimum over the
// bisectors (k px; junctions thicken, cells become blobs), y = exact distance to the nearest bisector, z = per-cell
// random, w = F1 / F2 (0 at the site, 1 on the border; its level sets are round, so it gives blob-shaped interiors).
// Also returns nrm, the nearest bisector's unit normal (metric space), er, a random per border segment (the same from
// both cells), and dg, the border distance under a smooth minimum of the two nearest bisectors (width kg px, 0 = the
// rims' distance) for the glow and dome: no creases along the medial axis.
vec4 cl_cells(vec2 p, vec2 cells, vec2 M, float jitter, float sizeVar, float k, float kg, float seed, out vec2 nrm, out float er, out float dg) {
  ivec2 per = org_per(cells);
  vec2 cs = uRes / cells;
  ivec2 ip = ivec2(floor(p / cs));
  vec2 csm = cs * M;
  vec2 pm = p * M;
  float wScale = sizeVar * csm.x * csm.y * 0.45;
  float best = 1e20;
  vec2 bs = pm;
  float bw = 0.0;
  ivec2 bc = ip, nc = ip;
  float m = 1e9, acc = 0.0, mg = 1e9, m2 = 1e9;
  vec2 nrm1 = vec2(1.0, 0.0), nrm2 = nrm1;
  float pf2 = 1e20;
  float kk = max(k, 0.05);
  nrm = vec2(1.0, 0.0);
  // One flat loop (see UNI_1): the 5×5 cells around p for the nearest site, then the 5×5 around that site.
  for (int e = 0; e < 50 * UNI_1; e++) {
    bool near = e < 25;
    int f = near ? e : e - 25;
    ivec2 g = ivec2(f % 5 - 2, f / 5 - 2);
    if (near || g != ivec2(0)) {
      ivec2 c = (near ? ip : bc) + g;
      vec3 sw = org_powerSite(c, per, csm, jitter, wScale, seed);
      vec2 s = sw.xy;
      float w = sw.z;
      if (near) {
        float pd = dot2(s - pm) - w;
        if (pd < best) { best = pd; bs = s; bw = w; bc = c; }
      } else {
        float L = length(s - bs);
        if (L >= 1e-4) {
          pf2 = min(pf2, dot2(pm - s) - w);
          float d = org_powerBisector(pm, s, w, bs, bw, L);
          // Running log-sum-exp soft minima (the rims' k, the glow's kg).
          if (d < m) { acc = acc * exp((d - m) / kk) + 1.0; m = d; nrm = (bs - s) / L; nc = c; }
          else acc += exp((m - d) / kk);
          // The glow's: the two nearest bisectors, for a pairwise smooth minimum (rounds the medial-axis crease
          // between them only; its offset stays under kg / 4 however many bisectors are near, unlike log-sum-exp).
          if (d < mg) { m2 = mg; mg = d; nrm2 = nrm1; nrm1 = (bs - s) / L; }
          else if (d < m2) { m2 = d; nrm2 = (bs - s) / L; }
        }
      }
    }
  }
  ivec2 a = imod(bc, per), b = imod(nc, per);
  int ka = a.x + a.y * 7919, kb = b.x + b.y * 7919;
  er = hashI(ivec2(min(ka, kb), max(ka, kb)), seed + 29.0);
  float dr = k > 0.0 ? m - kk * log(max(acc, 1.0)) : m;
  // Shifted by the rims' rounding, so it meets the rims' distance as kg goes to 0.
  // The border normal, blended with the second-nearest bisector's within ~3 px of where they swap (the medial lines
  // from the junctions): the true-width correction then has no seams there.
  float bl = 0.5 * (1.0 - smoothstep(0.0, 3.0, m2 - mg));
  vec2 nb2 = mix(nrm1, nrm2, bl);
  nrm = dot(nb2, nb2) > 1e-6 ? normalize(nb2) : nrm1;
  dg = dr - org_sminK(mg, m2, kg);
  // F1 / F2 for weighted cells: d1 / sqrt(d1² + Δ), Δ the power distance to the nearest other site less the own. It is
  // the plain F1 / F2 for equal weights, 0 at the site and exactly 1 on the weighted border from both sides — the plain
  // ratio isn't, between cells of different weights, and the domes stepped there.
  float d1 = dot2(pm - bs);
  float f12 = sqrt(d1 / max(d1 + max(pf2 - best, 0.0), 1e-4));
  return vec4(dr, m, hashI(a, seed + 17.0), f12);
}

// Brightness from the cell distances: a crisp rim core on the border (dCore, px; rb its brightness) plus a glow (net) /
// dome (blobs) whose shape blends from polygonal (border distance dGlow) to round blobs (F1 / F2) with Roundness. h: the
// Rounded relief profiles in the value's sense — x a dome over the whole cell (shaped per cell by crnd), y flat plates;
// both with the rim core sunk / the crack cut.
float cl_liquid(float dCore, float dGlow, float f12, float R, float rim, float rb, float rbs, float glowAmt, float crnd, out vec2 h) {
  float core = org_line(dCore, rim, u_rim_soft);
  float hc = core;
  // Rounded rims: a smooth crest across the rim (no flat clipped core), at least 1.5 px wide — a thinner rim keeps the
  // width and dims instead (no beading); the core then meets the glow in a soft maximum (no shelf).
  float ks = 0.0;
  if (u_rim_round > 0.0) {
    float re = max(rim, 1.5);
    float W = 0.5 * re + 0.5 + u_rim_soft;
    float cr = smoothstep(0.0, 0.8, clamp(1.0 - dCore / W, 0.0, 1.0)) * sqrt(min(1.0, rim / 1.5));
    core = mix(core, cr, u_rim_round);
    ks = 0.25 * u_rim_round;
    // In the height, junction pools (where the rounded border distance goes negative) keep deepening into bowls.
    hc = mix(hc, 0.85 * cr + 0.15 * smoothstep(0.0, 1.0, -dCore / W), u_rim_round);
  }
  float reach = max(u_glow, 1e-3);
  float tPoly = clamp(dGlow / (reach * R), 0.0, 1.0);
  float tRound = clamp((1.0 - f12) / (reach * 0.6), 0.0, 1.0);
  float t = mix(tPoly, tRound, u_round);
  float sd = mix(clamp(dGlow / R, 0.0, 1.0), clamp(1.0 - f12, 0.0, 1.0), u_round);
  // Dome variation: flat-topped (high exponent) to peaked (low) per cell.
  float dome = 1.0 - pow(1.0 - sd, 2.0 * exp2((crnd - 0.5) * 2.4 * u_dome_var));
  // h.x: domed cells; h.y: flat plates, only the rims / cracks cut in — as a rounded trough a few px wider than the rim
  // (Rounded rims), not a razor lip.
  float hp = u_rim_round > 0.0 ? mix(hc, 1.0 - smoothstep(0.0, 0.5 * rim + 5.0 + u_rim_soft, dCore), u_rim_round) : hc;
  if (u_mode == 0) {
    h = vec2(org_smax(hc, 1.0 - dome, ks), hp);
    // The glow next to the rim follows the rim's brightness variation half way (visible on thin rims too).
    // The glow follows only the smooth part of the rim's brightness variation (the per-segment random jumps where the
    // nearest border changes, inside the cell).
    return org_smax(core * rb, pow(1.0 - t, u_falloff) * glowAmt * (1.0 - u_rim_var * 0.25 * (1.0 - rbs)), ks);
  }
  h = vec2((1.0 - hc) * dome, 1.0 - hp);
  return (1.0 - core) * mix(glowAmt, 1.0, 1.0 - pow(1.0 - t, u_falloff));
}

GenOut gen(vec2 p) {
  // Two octaves of cells — the main ones and a fainter, finer second octave — in one loop, so one copy of the cell
  // search and the noise (D3D inlines every call).
  float v = 0.0, rnd = 0.0, sdf = NO_SDF, sd0 = 1.0;
  vec2 h = vec2(0.0);
  for (int o = 0; o < 2 * UNI_1; o++) {
    if (o == 1 && u_octave2 <= 0.0) break;
    float seed = uSeed + float(o);
    float sc = o == 0 ? u_scale : u_scale * u_octave2_scale;
    vec2 cells = cellsFor(sc, u_stretch);
    vec2 cs = uRes / cells;
    float R = 0.5 * min(cs.x, cs.y);
    // Stretched: measured where the cells are square.
    vec2 M = u_stretch == 1.0 ? vec2(1.0) : min(cs.x, cs.y) / cs;
    // The noise, one call site: the warp (x, y; stretched with the cells, so it bends them alike along both axes) and
    // the rims' variation along their length (z) at p, and the warp one px right / up for its Jacobian (True rim
    // width): slots 0–2 at p (si 0, component ci), 3–4 right, 5–6 up.
    vec3 nz = vec3(0.5);
    vec2 wx = vec2(0.5), wy = vec2(0.5);
    for (int e = 0; e < 7 * UNI_1; e++) {
      int si = e < 3 ? 0 : (e - 1) / 2, ci = e < 3 ? e : (e - 1) % 2;
      if (ci < 2 ? u_warp > 0.0 : u_rim_var > 0.0) {
        vec2 wc = cellsFor(sc * (ci < 2 ? u_warp_scale : 3.0), u_stretch);
        vec2 pp = p + (si == 1 ? vec2(1.0, 0.0) : si == 2 ? vec2(0.0, 1.0) : vec2(0.0));
        // Soft octaves: smooth, blobby distortion rather than jagged borders.
        float n = org_noiseFbm(1, false, pp / uRes * wc + (ci == 1 ? 17.3 : 0.0), org_per(wc), ci < 2 ? u_warp_detail : 2, 0.35,
                               seed + (ci == 0 ? 101.0 : ci == 1 ? 211.0 : 307.0));
        if (si == 0) nz[ci] = n;
        else if (si == 1) wx[ci] = n;
        else wy[ci] = n;
      }
    }
    vec2 q = p;
    if (u_warp > 0.0) q += (nz.xy - 0.5) * 2.0 * u_warp * cs;
    vec2 nrm;
    float er, dg;
    float kr = u_round * R * 0.15;
    vec4 c = cl_cells(q, cells, M, u_jitter, u_size_var, kr, u_glow_smooth * R, seed, nrm, er, dg);
    // True rim width: the border distance on screen — divided by its gradient through the warp's Jacobian and the
    // metric, along the border's normal.
    vec2 jx = vec2(1.0, 0.0), jy = vec2(0.0, 1.0);
    if (u_warp > 0.0) {
      jx += (wx - nz.xy) * 2.0 * u_warp * cs;
      jy += (wy - nz.xy) * 2.0 * u_warp * cs;
    }
    float gsc = clamp(length(vec2(dot(jx * M, nrm), dot(jy * M, nrm))), 0.2, 5.0);
    float rim = o == 0 ? u_rim : max(u_rim * 0.6, min(u_rim, 1.0));
    // Nest: the second octave tapers toward the main cells' rims — thinner and fainter, not cut off.
    float nw = o == 1 ? mix(1.0, smoothstep(0.05, 0.6, sd0), u_octave2_nest) : 1.0;
    // Rim variation: the width along the rim from smooth noise, the brightness also per border segment.
    float rw = mix(1.0, 0.3 + 1.4 * nz.z, u_rim_var);
    float rb = 1.0 - u_rim_var * 0.5 * (1.0 - mix(er, nz.z, 0.5));
    // (The main octave's brightness and relief; the second octave draws only its rims, below.)
    vec2 ho = vec2(0.0);
    float vo = 0.0;
    if (o == 0) vo = cl_liquid(c.x / gsc, dg, c.w, R, rim * rw * nw, rb, nz.z, u_glow_amount, c.z, ho);
    // Cell height variation: each cell's rise above the common rim floor its own (continuous across the rims, unlike
    // Height's Per-feature variation, which scales the whole depth and steps at every rim).
    if (o == 0 && u_cell_h > 0.0) {
      float ch = 1.0 - u_cell_h * fract(c.z * 41.13 + 0.37);
      ho = u_mode == 0 ? 1.0 - (1.0 - ho) * ch : ho * ch;
    }
    if (o == 0) {
      v = vo;
      h = ho;
      rnd = c.z;
      // The cells inside the rim cores (net) / cracks (blobs), for its mask.
      sdf = 0.5 * rim * rw - c.x / gsc;
      sd0 = mix(clamp(dg / R, 0.0, 1.0), clamp(1.0 - c.w, 0.0, 1.0), u_round);
    } else {
      // The finer net only as its own rims / cracks (cut in, in both modes), fading continuously toward the main rims
      // (Nest); in the height a soft groove a few px wide, not a crisp crease.
      float k2 = u_octave2 * nw;
      float cd = c.x / gsc;
      float core2 = org_line(cd, rim * rw * nw, u_rim_soft);
      float sg = 1.0 - smoothstep(0.0, 0.5 * rim * nw + 3.0, cd);
      sg *= sg;
      if (u_mode == 0) {
        v = max(v, core2 * rb * k2);
        h += (1.0 - h) * sg * k2 * 0.6;
      } else {
        v *= 1.0 - k2 * 0.8 * core2;
        h *= 1.0 - k2 * 0.6 * sg;
      }
    }
  }
  GenOut g = genOut(clamp(v, 0.0, 1.0), 1.0, rnd, sdf);
  if (u_dome != 0.0) g.hval = clamp(mix(v, u_dome > 0.0 ? h.x : h.y, abs(u_dome)), 0.0, 1.0);
  return g;
}
`
};
