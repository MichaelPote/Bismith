// Fill-style pattern layers (FR2.4): fBm clouds, gradients (UI shading) and random scratches (metal wear).
// Clouds and gradients are value generators (no SDF); scratches also hand their outline to a mask
// (sdf: 'mask'). See patterns.ts for the cell-based SDF patterns.

import { hashD } from '@/core/hash';
import { memoReads } from '@/core/memo';
import { P, gradient, round1 as r1, type ParamValues } from '@/core/params';
import { PX_SCALE_PARAM } from '../commonParams';
import { TAPER_GLSL, taperParams } from './shapes';
import { cellsFor, f32, gcd, imod, periodOf, radians } from '../derivedMath';
import type { LayerCanvas, LayerDef } from '../types';
import {
	NZ_SHARED_GLSL,
	fractalParams,
	latticeNoise,
	octaveStep,
	quantileTexture,
	quantilesOf,
	type OctaveState,
	type OctaveStyle
} from './noise';

// ------------------------------------------------------------------------------------------------ clouds

// ---- The clouds' raw value on the CPU: the shader's gen() ported line for line (the same PCG hashes, lattices, warp,
// decorrelation and octave loop), so Coverage measures this very texture's quantiles — a texture a few cells
// across holds few lumps, and its share above any level strays from the population's by several percent. Not ported:
// the animation phase and the layer's own domain warp / offset (they move the pattern; its statistics barely change).

const cvNoise = (basis: number, x: number, y: number, px: number, py: number, s: number) =>
	latticeNoise(basis, x, y, (kx, ky) => hashD(imod(kx, px), imod(ky, py), s));

// rl_noise / rl_reduce / rl_lattice (NZ_SHARED_GLSL).
function rlNoise(basis: number, y0: number, y1: number, c1: number[], c2: number[], s: number): number {
	const D = c1[0] * c2[1] - c2[0] * c1[1];
	return latticeNoise(basis, y0, y1, (kx, ky) => {
		const a = Math.floor((c2[1] * kx - c2[0] * ky) / D),
			b = Math.floor((c1[0] * ky - c1[1] * kx) / D);
		return hashD(kx - a * c1[0] - b * c2[0], ky - a * c1[1] - b * c2[1], s);
	});
}

/** The clouds' raw value (before the coverage threshold and contrast) at 4096 points of the texture. */
export function cloudsSamples(
	p: ParamValues,
	ctx: { width: number; height: number; tileable: boolean; seed: number }
): number[] {
	const W = ctx.width,
		H = ctx.height,
		tile = ctx.tileable,
		seed = ctx.seed;
	const [cx, cy] = cellsFor(Number(p.scale), Number(p.stretch), ctx);
	const [per0x, per0y] = periodOf([cx, cy], tile);
	const basis = p.basis === 'value' ? 0 : 1;
	const style = CLOUD_STYLES.indexOf(String(p.style));
	const oct = Math.max(1, Math.min(12, Math.round(Number(p.octaves))));
	const gain = Number(p.gain),
		lac = Number(p.lacunarity),
		ilac = Math.floor(lac + 0.5);
	const warp = Number(p.warp),
		wdetail = Number(p.wdetail);
	const turned = tile && per0x === per0y;
	const lm = tile ? ilac : lac;
	const ost = cloudOctaveStyle(style, Number(p.crease), Number(p.hier), Number(p.ridge));
	// warpOffset(x, per, seed + 7): Perlin fbm (3 octaves, lacunarity 2, gain 0.5), twice.
	const fbm3 = (x: number, y: number, sd: number) => {
		let sum = 0,
			amp = 1,
			norm = 0,
			px = per0x,
			py = per0y;
		for (let o = 0; o < 3; o++) {
			sum += cvNoise(1, x, y, px, py, sd + o * 31) * amp;
			norm += amp;
			amp *= 0.5;
			x *= 2;
			y *= 2;
			if (tile) {
				px *= 2;
				py *= 2;
			}
		}
		return sum / norm;
	};
	const out: number[] = [];
	const G = 64;
	for (let gy = 0; gy < G; gy++)
		for (let gx = 0; gx < G; gx++) {
			// Pixel centres spread over the texture.
			const pxl = Math.floor(((gx + 0.5) / G) * W) + 0.5,
				pyl = Math.floor(((gy + 0.5) / G) * H) + 0.5;
			let x = (pxl / W) * cx,
				y = (pyl / H) * cy;
			let offx = 0,
				offy = 0;
			if (warp > 0) {
				const wx = (fbm3(x, y, seed + 7 + 101) - 0.5) * warp * 2,
					wy = (fbm3(x + 17.3, y + 17.3, seed + 7 + 211) - 0.5) * warp * 2;
				if (wdetail >= 1) {
					x += wx;
					y += wy;
				} else {
					offx = wx;
					offy = wy;
				}
			}
			let sum = 0,
				amp = 1,
				norm = 0;
			const st: OctaveState = { weight: 1, f0: 1, cut: 1 };
			let px = per0x,
				py = per0y,
				fc = Math.max(cx, cy);
			for (let o = 0; o < oct && fc <= OCT_CELLS; o++, fc *= lm) {
				const s = seed + o * 31;
				let xo = x + offx,
					yo = y + offy;
				const shx = hashD(o, 3, seed) + 0.37 * o,
					shy = hashD(o, 5, seed) + 0.37 * o;
				if (o > 0) {
					xo += shx;
					yo += shy;
				}
				if (!tile) {
					const a = 0.5 + 2.4 * o,
						c = Math.cos(a),
						sn = Math.sin(a);
					const tx = c * xo - sn * yo;
					yo = sn * xo + c * yo;
					xo = tx;
				}
				const dual = basis === 0;
				let n = 0;
				for (let j = 0; j < (dual ? 2 : 1); j++) {
					const sj = s + 13 * j;
					if (turned) {
						let m = Math.max(1, Math.floor(cx / 2.236068 + 0.5));
						for (let q = 0; q < o; q++) m *= ilac;
						let c1 = o % 2 === 0 ? [2 * m, m] : [m, 2 * m],
							c2 = o % 2 === 0 ? [-m, 2 * m] : [-2 * m, m];
						if (j === 1) {
							c1 = [c1[1], c1[0]];
							c2 = [-c2[1], -c2[0]];
						}
						const k = px / per0x;
						const ux = (x + offx) / (cx * k),
							uy = (y + offy) / (cy * k);
						n += rlNoise(
							basis,
							c1[0] * ux + c2[0] * uy + shx + 0.5 * j,
							c1[1] * ux + c2[1] * uy + shy + 0.5 * j,
							c1,
							c2,
							sj
						);
					} else {
						let xj = xo,
							yj = yo;
						if (j === 1) {
							if (!tile) {
								const c = Math.cos(1.1),
									sn = Math.sin(1.1);
								const tx = c * xj - sn * yj;
								yj = sn * xj + c * yj;
								xj = tx;
							}
							xj += 0.5;
							yj += 0.5;
						}
						n += cvNoise(basis, xj, yj, px, py, sj);
					}
				}
				if (dual) n = Math.min(1, Math.max(0, 0.5 + (n - 1) * 0.70711));
				const [nv, ha, bg, wn] = octaveStep(n, o, ost, st);
				sum += nv * amp * ha * bg;
				norm += amp * ha * wn;
				amp *= gain;
				if (tile) {
					x *= ilac;
					y *= ilac;
					px *= ilac;
					py *= ilac;
				} else {
					x *= lac;
					y *= lac;
				}
				offx *= lm * wdetail;
				offy *= lm * wdetail;
			}
			out.push((sum / Math.max(norm, 1e-6)) * st.cut);
		}
	return out;
}

/** Clouds' styles, in the shader's order (u_style: nz_octave's kind). */
const CLOUD_STYLES = ['fbm', 'billow', 'ridged', 'cumulus'];
/** Ridge hierarchy: the main crest's extra sharpening exponent, RIDGE_SHARP_K · h² (the shader's from the same constant). */
const RIDGE_SHARP_K = 6;

/**
 * Clouds' octave style (as Noise's, but Billow's creases soften half as fast per octave and dome its lumps, the second
 * and third octaves split them, Ridged's crests round twice as much and its main crest sharpens by 6h²).
 */
const cloudOctaveStyle = (kind: number, crease: number, hier: number, ridge: number): OctaveStyle => ({
	kind,
	crease,
	hier,
	ridge,
	grow: kind === 1 ? 0.5 : 1,
	mul: kind === 2 ? 2 : 1,
	sharp: RIDGE_SHARP_K * hier * hier,
	dome: 0.5,
	split: true
});
/**
 * The finest octave's cells across (the larger cell count): octaves past it are far below a pixel and only alias, and
 * their tiling periods would overflow the shader's ints at high lacunarity. Shader and port both stop there.
 */
const OCT_CELLS = 1 << 20;

/** Clouds' fractal controls: Noise's, with Clouds' defaults. */
const CF = fractalParams(
	{ stretch: 1, octaves: 6, lacunarity: 2, gain: 0.45, crease: 0.6, ridge: 0.35, hier: 0.7, warp: 0.1 },
	{ ridged: (p) => p.style === 'ridged', creased: (p) => p.style !== 'fbm' },
	{ crease: 'On Billow it also domes the lumps and lets the second octave’s creases split them into sub-lumps' }
);

export const cloudsLayer: LayerDef = {
	type: 'clouds',
	noise: true,
	label: 'Clouds',
	category: 'noise',
	kind: 'generator',
	description:
		'Clouds: Classic fractal noise with domain warp, contrast and coverage controls. Makes grime, stains, smoke, soft variation.',
	params: [
		P.enum('basis', 'Basis', 'perlin', [
			['value', 'Value'],
			['perlin', 'Perlin']
		]),
		P.enum('style', 'Style', 'cumulus', [
			['fbm', 'Soft', 'soft fractal clouds: smoke, stains, grime'],
			['billow', 'Billow (puffy)', 'folds every octave: lumps between a network of dark creases'],
			['ridged', 'Ridged', 'sharp crests around dark basins: veins, erosion, lightning'],
			[
				'cumulus',
				'Cumulus',
				'soft masses made of puffy sub-lumps (the first octave smooth, the finer ones folded): cauliflower clouds, foam, moss'
			]
		]),
		P.float('scale', 'Scale', 4, 0.25, 512, {
			softMax: 48,
			step: 0.01,
			hint: 'How many base cells fit across the texture width (rounded when tiling)'
		}),
		CF.stretch,
		CF.octaves,
		CF.lacunarity,
		CF.gain,
		CF.crease,
		CF.ridge,
		CF.hier,
		CF.warp,
		P.float('wdetail', 'Warp detail', 0.4, 0, 1, {
			step: 0.001,
			showIf: (p) => Number(p.warp) > 0,
			hint: 'How much the finer octaves get warped too (0 = only the first octave warps, 0.5 = the large shapes swirl while fine detail stays even, 1 = all of it: fine detail drawn out into streaks and strands)'
		}),
		P.float('contrast', 'Contrast', 1.5, 0, 64, { softMax: 12, step: 0.01 }),
		P.float('coverage', 'Coverage', 0.5, 0, 1, {
			step: 0.001,
			hint: 'How much of the area ends up above mid-grey (measured on this texture, so it holds for every style, seed and size)'
		}),
		P.float('soft', 'Contrast softness', 1, 0, 1, {
			step: 0.001,
			hint: 'Rounds off where Contrast clips to black and white, leaving the mid-tones alone (0 = a hard cut with a crease around every flat plateau, 0.5 = shoulders that meet at mid-grey, 1 = a smooth S-curve that never quite reaches black or white: domed lumps)'
		}),
		P.seed()
	],
	// Coverage and Contrast act on this texture's own measured value spread (see cloudsSamples), measured again only
	// when a param the samples read changes.
	textures: ['calib'],
	cpuData: memoReads((p, ctx) => quantileTexture(quantilesOf(cloudsSamples(p, ctx)))),
	// An Overlay ramp that both darkens and lightens what is beneath.
	defaults: {
		dif_on: true,
		dif_blend: 'overlay',
		dif_opacity: 0.85,
		dif_grad: gradient('#2a241e', '#fbf6ee'),
		h_on: true,
		h_amount: 0.15
	},
	glsl: /* glsl */ `
${NZ_SHARED_GLSL}
GenOut gen(vec2 p) {
  vec2 cells = cellsFor(u_scale, u_stretch);
  ivec2 per = periodOf(cells);
  vec2 x = p / uRes * cells;
  // The warp: added to x (every octave takes all of it), or carried separately and scaled down per octave
  // (Warp detail < 1). off stays 0 in the first case, so x + off is x exactly.
  vec2 off = vec2(0.0);
  if (u_warp > 0.0) {
    vec2 w = warpOffset(x, per, uSeed + 7.0) * u_warp * 2.0;
    if (u_wdetail >= 1.0) x += w; else off = w;
  }
  // The octaves in one flat loop with a runtime bound and only value / Perlin in it, so the shader stays small.
  // (Ported to the CPU line for line: cloudsSamples.)
  float sum = 0.0, amp = 1.0, norm = 0.0, weight = 1.0, f0 = 1.0, cut = 1.0;
  // The octave style (nz_octave, cloudOctaveStyle): Billow's creases soften half as fast per octave and its lumps dome,
  // Ridged's crests round twice as much and its main crest sharpens by RIDGE_SHARP_K · h².
  vec4 sty = vec4(u_style == 1 ? 0.5 : 1.0, u_style == 2 ? 2.0 : 1.0, ${RIDGE_SHARP_K.toFixed(1)} * u_hier * u_hier, 0.5);
  int ilac = int(u_lacunarity + 0.5);
  // Tiling, on a square grid of cells: value / Perlin on the turned tileable lattice (rl_noise), each octave its own.
  bool turned = uTile && per.x == per.y;
  ivec2 per0 = per;
  float lm = uTile ? float(ilac) : u_lacunarity;
  float fc = max(cells.x, cells.y);   // this octave's cells across (past OCT_CELLS the octaves stop)
  for (int o = 0; o < 12 * UNI_1; o++) {
    if (o >= u_octaves || fc > ${OCT_CELLS.toFixed(1)}) break;
    float s = uSeed + float(o) * 31.0;
    vec2 xo = x + off;
    vec2 sh = vec2(hashI(ivec2(o, 3), uSeed), hashI(ivec2(o, 5), uSeed)) + 0.37 * float(o);
    if (o > 0) xo += sh;
    if (!uTile) xo = rot2(0.5 + 2.4 * float(o)) * xo;
    // Value noise: two lattices (the second turned the other way, or by an irrational angle when not
    // tiling, and shifted half a cell) averaged at the spread of one — value noise's straight cell-edge contours,
    // which a fold turns into crease segments on a grid, cancel out.
    bool dual = u_basis == 0;
    float n = 0.0;
    for (int j = 0; j < (dual ? 2 : 1) * UNI_1; j++) {
      float sj = s + 13.0 * float(j);
      float nj;
      if (turned) {
        ivec2 c1, c2;
        rl_lattice(o, cells.x, ilac, c1, c2);
        if (j == 1) { c1 = ivec2(c1.y, c1.x); c2 = ivec2(-c2.y, -c2.x); }
        nj = rl_noise(u_basis, mat2(vec2(c1), vec2(c2)) * ((x + off) / (cells * float(per.x / per0.x))) + sh + 0.5 * float(j), c1, c2, sj);
      } else {
        vec2 xj = j == 0 ? xo : (uTile ? xo : rot2(1.1) * xo) + 0.5;
        nj = u_basis == 0 ? valueNoise(xj, per, sj) : perlinNoise(xj, per, sj);
      }
      n += nj;
    }
    if (dual) n = clamp(0.5 + (n - 1.0) * 0.70711, 0.0, 1.0);
    vec3 wt = nz_octave(u_style, o, u_crease, u_hier, u_ridge, sty, true, n, weight, f0, cut);
    sum += n * amp * wt.x * wt.y;
    norm += amp * wt.x * wt.z;
    amp *= u_gain;
    if (uTile) { x *= float(ilac); per *= ilac; } else { x *= u_lacunarity; }
    off *= lm * u_wdetail;
    fc *= lm;
  }
  float n = sum / max(norm, 1e-6) * cut;
  // Coverage, exactly: the value evened out by this texture's measured quantiles (eq_value), the threshold its measured
  // (1 - coverage) quantile, evened out the same way.
  float nv = eq_value(n);
  float thr = eq_value(eq_quant(1.0 - u_coverage));
  float v = (nv - thr) * u_contrast + 0.5;
  // Clip to 0..1 with Contrast softness: up to 0.5 the clamp box-filtered over 2 × Contrast softness (quadratic shoulders); from 0.5 to
  // 1 blended into a sigmoid (0.5 + tanh(2 (v - 0.5)) / 2) that never flattens — domes, not plateaus. The mid-tone
  // slope is kept throughout (0 = the plain clamp).
  float sw = min(2.0 * u_soft, 1.0);
  float vb = sw > 0.0 ? (nz_clampInt(v + 0.5 * sw) - nz_clampInt(v - 0.5 * sw)) / sw : clamp(v, 0.0, 1.0);
  v = mix(vb, 0.5 + 0.5 * tanh(2.0 * (v - 0.5)), clamp(2.0 * u_soft - 1.0, 0.0, 1.0));
  return genOutSmooth(clamp(v, 0.0, 1.0), 1.0, n, 0.0);
}
`
};

// ------------------------------------------------------------------------------------------------ gradient

const radialish = (p: Record<string, unknown>) => p.style !== 'linear';
const repeating = (p: Record<string, unknown>) => p.repeat !== 'clamp';

/**
 * Gradient's uniform-only work (its derived uniforms), for the linear ramp: with Fit the tile (tiling, repeating) its
 * frequency snapped to whole cycles across each axis (cyc, which turns the angle a little; else 0, 0), and the bands per
 * tile when they tile (bands > 0; else 0). In float32 steps, as the shader did.
 */
export function gradientDerived(p: ParamValues, c: LayerCanvas): { cyc: number[]; bands: number } {
	const a = radians(f32(Number(p.angle)));
	const cs = f32(Math.cos(a));
	const sn = f32(Math.sin(a));
	const span = f32(Math.abs(f32(c.width * cs)) + Math.abs(f32(c.height * sn)));
	const L = Number(p.length) > 0 ? f32(Number(p.length)) : span;
	const rep = ['clamp', 'repeat', 'mirror'].indexOf(String(p.repeat));
	if (p.fit && c.tileable && rep > 0) {
		const P = rep === 2 ? f32(2 * L) : L;
		const dir = [cs, -sn]; // rotCW((1, 0), angle)
		const cyc = [
			Math.floor(f32(f32(f32(dir[0] * c.width) / P) + 0.5)),
			Math.floor(f32(f32(f32(dir[1] * c.height) / P) + 0.5))
		];
		if (cyc[0] === 0 && cyc[1] === 0) {
			if (Math.abs(dir[0]) * c.width >= Math.abs(dir[1]) * c.height) cyc[0] = dir[0] < 0 ? -1 : 1;
			else cyc[1] = dir[1] < 0 ? -1 : 1;
		}
		return { cyc, bands: (rep === 2 ? 2 : 1) * gcd(cyc[0], cyc[1]) };
	}
	const nb = f32(span / L);
	const n = Math.floor(f32(nb + 0.5));
	return { cyc: [0, 0], bands: c.tileable && Math.abs(nb - n) < 1e-3 ? n : 0 };
}

export const gradientLayer: LayerDef = {
	type: 'gradient',
	label: 'Gradient',
	category: 'pattern',
	kind: 'generator',
	description:
		'Gradient: A linear, radial, angular, diamond or square ramp that can repeat or mirror, with a falloff curve. Makes UI shading, vignettes, sheens, domes.',
	params: [
		P.enum('style', 'Type', 'linear', [
			['linear', 'Linear'],
			['radial', 'Radial'],
			['angular', 'Angular'],
			['diamond', 'Diamond'],
			['square', 'Square', 'rectangular rings: inner glows and bevels of buttons and panels']
		]),
		P.float('angle', 'Angle', 270, -360, 360, {
			softMin: -180,
			softMax: 360,
			unit: '°',
			step: 0.1,
			hint: 'Sets which way the ramp runs from 0 to 1, clockwise from → (270 runs bottom → top). Also turns radial-type shapes (their Stretch axis) and where an angular sweep starts'
		}),
		P.float('cx', 'Centre X', 0.5, -2, 3, {
			softMin: 0,
			softMax: 1,
			step: 0.001,
			hint: 'Moves the ramp’s middle (linear) or start (the others) left or right (0…1 across)'
		}),
		P.float('cy', 'Centre Y', 0.5, -2, 3, {
			softMin: 0,
			softMax: 1,
			step: 0.001,
			hint: 'Moves the centre up or down (0…1 down)'
		}),
		P.float('length', 'Ramp length', 0, 0, 8192, {
			softMax: 512,
			unit: 'px',
			step: 0.5,
			showIf: (p) => p.style !== 'angular',
			hint: 'Sets how long the ramp is (0 = fits the texture: linear spans it, the others reach the farthest corner). Shorter with Repeat or Mirror makes bands of this width'
		}),
		P.float('stretch', 'Stretch', 1, 0.02, 50, {
			softMin: 0.2,
			softMax: 5,
			step: 0.01,
			showIf: radialish,
			hint: 'Stretches the rings along the Angle direction (above 1) or across it (below 1): ellipses, long diamonds, rectangles. When tiling with Centre › Wrap, long rings run into their neighbouring copies (Seam rounding bends them together); Single keeps one clean ellipse'
		}),
		P.float('round', 'Roundness', 0, 0, 1, {
			step: 0.001,
			showIf: (p) => p.style === 'diamond' || p.style === 'square',
			hint: 'Rounds the corners of diamond and square rings so they meet without a crease on the diagonals (0 = sharp, 1 = round)'
		}),
		P.int('turns', 'Ramps', 1, 1, 256, {
			softMax: 32,
			showIf: (p) => p.style === 'angular',
			hint: 'How many ramps go around the centre: a fan of rays with Repeat, while with Mirror two ramps make one up-and-down wedge (16 → an 8-pointed star). When tiling with Centre › Wrap, an even count bends round the tile and repeats seamlessly; an odd count starts on a single centre (one sweep can’t tile round its centre, so Wrap bends the rays towards a diagonal)'
		}),
		P.float('twist', 'Twist', 0, -32, 32, {
			softMin: -4,
			softMax: 4,
			step: 0.001,
			showIf: (p) => p.style === 'angular',
			hint: 'Winds the sweep into a spiral (how many turns from the centre out to half the texture width)'
		}),
		P.enum('repeat', 'Repeat', 'clamp', [
			['clamp', 'None (clamp)', 'one ramp, flat beyond it (a linear one can’t tile: its top meets its bottom)'],
			['repeat', 'Repeat', 'sawtooth: the ramp starts over at every band'],
			['mirror', 'Mirror', 'goes up and down: bands without a step']
		]),
		P.float('band_jit', 'Band width variation', 0, 0, 1, {
			step: 0.001,
			showIf: repeating,
			hint: 'Gives each band a random width with Repeat or Mirror (1 = from a tenth to nearly twice the Ramp length): strata, planks, siding. Still tiles with Fit the tile'
		}),
		P.float('shift', 'Ramp offset', 0, -100, 100, {
			softMin: -1,
			softMax: 1,
			step: 0.001,
			hint: 'Slides the ramp along itself, in ramp lengths (0.5 puts the band edges where their middles were)'
		}),
		P.bool('fit', 'Fit the tile', true, {
			showIf: (p) => p.style !== 'angular' && repeating(p),
			hint: 'In tiling projects, rounds the band length so a whole number of bands fits across the tile and they run on seamlessly over its edges (a linear ramp’s angle snaps a little, like Stripes)'
		}),
		P.enum(
			'wrap',
			'Centre',
			'wrap',
			[
				[
					'wrap',
					'Wrap (seamless)',
					'tiling projects: uses the nearest copy of the centre in the neighbouring tiles, seamless but with a crease where the copies meet'
				],
				['single', 'Single', 'only this centre: a plain spotlight or vignette (not seamless across the tile’s edges)']
			],
			{
				showIf: radialish,
				hint: 'In tiling projects, Wrap repeats the centre in every neighbouring tile so the texture tiles; Single draws only this centre (a spotlight or vignette that doesn’t tile)'
			}
		),
		P.float('seam', 'Seam rounding', 0, 0, 1024, {
			softMax: 48,
			unit: 'px',
			step: 0.1,
			showIf: (p) => radialish(p) && p.style !== 'angular' && p.wrap !== 'single',
			hint: 'Rounds off where the copies of the centre meet (Wrap, tiling projects): over about this width their rings bend from one copy into the next instead of meeting in a crease or a seam (a clamped ramp gets a rounded ridge)'
		}),
		P.enum(
			'falloff',
			'Falloff',
			'linear',
			[
				['linear', 'Linear', 'an even ramp'],
				[
					'smooth',
					'Smooth',
					'S-curve: eases out of 0 and into 1, with no crease at the ends and a rounded tip at a radial centre'
				],
				['round', 'Round', 'quarter circle: rises fast, flattens towards 1'],
				['cove', 'Cove', 'concave: stays low, then rises steeply (with Invert, a radial cove makes a hemisphere)']
			],
			{ hint: 'Picks the curve along each ramp (applied after Repeat / Mirror); Shaping › Gamma bends it smoothly' }
		),
		P.bool('aa', 'Anti-alias', true, {
			showIf: (p) => repeating(p) || p.style === 'angular',
			hint: 'Smooths the step where a ramp wraps from 1 back to 0 (Repeat, the start of an angular sweep) and the folds of Mirror; bands finer than a pixel fade to grey. Turn it off for hard pixel steps'
		}),
		P.seed('seed', 'Seed', 1, {
			hint: 'Changes the random value each band gets (each repeat of the ramp: Source › Random, Diffuse jitter, Per-feature variation)'
		})
	],
	// Added in the editor: the creases where copies of a centre meet rounded by 5 % of the texture.
	fresh: ({ width, height }) => ({ seam: Math.round(0.05 * Math.min(width, height) * 10) / 10 }),
	// One ramp (or any odd count) can't sweep round a tiling centre: an angular gradient with an odd count starts with a
	// single centre (Wrap tiles it, bent); an even count with the centre repeated, seamless.
	linkedDefaults: (p) => ({ wrap: p.style === 'angular' && Number(p.turns ?? 1) % 2 === 1 ? 'single' : 'wrap' }),
	defaults: {
		dif_on: true,
		dif_grad: gradient('#3a3e43', '#9aa3ab')
	},
	// The linear ramp's tile fit on the CPU (gradientDerived).
	derivedUniforms: { decl: { cyc: 'vec2', bands: 'int' }, compute: gradientDerived },
	glsl: /* glsl */ `
// Ring metric of the radial-type styles: radial (1) round, diamond (3) L1, square (4) L∞. Roundness turns diamond and
// square into superellipses (p 1 → 2, ∞ → 2): rings without creases on the diagonals.
float gr_metric(vec2 v) {
  vec2 a = abs(v);
  if (u_style == 1) return length(v);
  if (u_round <= 0.0) return u_style == 3 ? a.x + a.y : max(a.x, a.y);
  float pw = u_style == 3 ? 1.0 + u_round : 2.0 / u_round;
  float mx = max(max(a.x, a.y), 1e-20);
  vec2 r = a / mx;
  return mx * pow(pow(r.x, pw) + pow(r.y, pw), 1.0 / pw);
}

// The argument of the Jacobi theta function θ1(x | q = e^(-π T)) at complex x (|Im x| ≤ π T): four terms of
// 2 Σ (-1)^n q^((n+½)²) sin((2n+1) x), each scaled by e^(-|Im x|) (a positive factor: the argument is unchanged) so
// nothing overflows.
float gr_thetaArg(vec2 x, float T) {
  float b = abs(x.y), sg = x.y < 0.0 ? -1.0 : 1.0;
  vec2 acc = vec2(0.0);
  for (int n = 0; n < 4 * UNI_1; n++) {
    float m = float(2 * n + 1);
    float c = (n % 2 == 0 ? 1.0 : -1.0) * exp(-PI * T * (float(n) + 0.5) * (float(n) + 0.5));
    float ep = exp((m - 1.0) * b), em = exp(-(m + 1.0) * b);
    // sin(m x) e^(-b): (sin(m a) cosh(m b), cos(m a) sinh(m b)) · e^(-b)
    acc += c * vec2(sin(m * x.x) * 0.5 * (ep + em), cos(m * x.x) * sg * 0.5 * (ep - em));
  }
  return atan(acc.y, acc.x);
}

// fract(t) box-filtered over w (the footprint of a pixel, in t): the wrap from 1 back to 0 is anti-aliased, and bands
// finer than a pixel fade to their mean. Uses the integral of fract, floor(x) / 2 + fract(x)² / 2.
float gr_fractAA(float t, float w) {
  if (w < 1e-6) return fract(t);
  float a = t - 0.5 * w, b = t + 0.5 * w;
  float fa = fract(a), fb = fract(b);
  return clamp((0.5 * (floor(b) - floor(a)) + 0.5 * (fb * fb - fa * fa)) / w, 0.0, 1.0);
}

// Mirror's triangle wave (0 at even t, 1 at odd), and its integral for the box-filtered version.
float gr_tri(float t) { float m = mod(t, 2.0); return m > 1.0 ? 2.0 - m : m; }
float gr_triInt(float x) { float m = mod(x, 2.0); return floor(x / 2.0) + (m <= 1.0 ? 0.5 * m * m : 1.0 - 0.5 * (2.0 - m) * (2.0 - m)); }
float gr_triAA(float t, float w) { return w < 1e-6 ? gr_tri(t) : clamp((gr_triInt(t + 0.5 * w) - gr_triInt(t - 0.5 * w)) / w, 0.0, 1.0); }

// The ramp's t from an offset d to a centre (radial-type: ring metric / R; angular: the sweep, twisted).
float gr_t(vec2 d, float R, float st) {
  vec2 q = unrotCW(d, u_angle);
  vec2 qs = vec2(q.x / st, q.y);
  if (u_style == 2) return fract(-atan(qs.y, qs.x) / TAU + u_twist * length(qs) / (0.5 * uRes.x)) * float(u_turns);
  return gr_metric(qs) / R;
}

// t's rate per pixel, for the anti-aliasing; an angular sweep's t jumps at its start, so take the rate from a copy
// that jumps on the opposite side wherever that is smaller.
float gr_w(float t) {
  float w = fwidth(t);
  if (u_style == 2) w = min(w, fwidth(fract(t / float(u_turns) + 0.5)) * float(u_turns));
  return w;
}

// The value at t: Repeat / Mirror (anti-aliased over w), faded to the mean where the bands get finer than about a
// pixel (the knot at an angular centre), then the falloff curve.
float gr_value(float t, float w, int rep) {
  float v;
  if (rep == 1) v = u_aa ? gr_fractAA(t, w) : fract(t);
  else if (rep == 2) v = u_aa ? gr_triAA(t, w) : gr_tri(t);
  else v = clamp(t, 0.0, 1.0);
  if (u_aa && rep != 0) v = mix(v, 0.5, smoothstep(0.75, 2.0, w));
  return profileCurve(u_falloff + 1, v);
}

// Band width variation: boundary k of the ramps sits at k + δ(k), |δ| < 0.45 × jitter (wrapped with the band count, so
// the bands still tile). Returns t in the jittered bands (the band index + the fraction across it) and scales w (the
// AA width) by the band's stretch.
float gr_bd(float k, int bands) {
  int kk = int(k);
  if (bands > 0) kk = imod(kk, bands);
  return (hashI(ivec2(kk, 1), uSeed + 5.0) - 0.5) * 0.9 * u_band_jit;
}
float gr_jit(float t, int bands, inout float w) {
  if (u_band_jit <= 0.0) return t;
  float i = floor(t);
  float b0 = i + gr_bd(i, bands), b1 = i + 1.0 + gr_bd(i + 1.0, bands);
  float k = t < b0 ? i - 1.0 : t >= b1 ? i + 1.0 : i;
  float lo = t < b0 ? i - 1.0 + gr_bd(i - 1.0, bands) : t >= b1 ? b1 : b0;
  float hi = t < b0 ? b0 : t >= b1 ? i + 2.0 + gr_bd(i + 2.0, bands) : b1;
  float wd = max(hi - lo, 1e-4);
  w /= wd;
  return k + (t - lo) / wd;
}

// Linear: t along the Angle (0.5 at the centre); bands: the bands per tile when they tile (> 0). With Fit the tile
// (tiling, repeating), whole periods across the tile on both axes: d_cyc, the frequency snapped per axis (the angle
// moves a little), and the bands it makes (gradientDerived).
float gr_linear(vec2 d, out int bands) {
  bands = d_bands;
  if (d_cyc != vec2(0.0)) return 0.5 + dot(d, d_cyc / uRes) * float(u_repeat == 2 ? 2 : 1);   // ramps per period
  vec2 q = unrotCW(d, u_angle);   // x along the gradient direction
  float a = radians(u_angle);
  float span = abs(uRes.x * cos(a)) + abs(uRes.y * sin(a));
  float L = u_length > 0.0 ? u_length : span;
  return 0.5 + q.x / L;
}

// The radial-type styles' ring radius (px in the ring metric): Ramp length, or 0 = the farthest corner (of the texture, or
// of the wrap cell when tiling); with Fit the tile, a whole number of bands from the centre to the tile's edge.
float gr_radius(vec2 c, bool wrap, float st) {
  float R = u_length;
  if (R <= 0.0) {
    vec2 lo = wrap ? -0.5 * uRes : -c;
    vec2 hi = wrap ? 0.5 * uRes : uRes - c;
    R = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 k = vec2(i == 0 || i == 2 ? lo.x : hi.x, i < 2 ? lo.y : hi.y);
      vec2 kq = unrotCW(k, u_angle);
      R = max(R, gr_metric(vec2(kq.x / st, kq.y)));
    }
  } else if (u_fit && wrap && u_repeat != 0) {
    // (Where the copies meet: no fold mid-slope.)
    vec2 hq = unrotCW(vec2(0.5 * uRes.x, 0.0), u_angle);
    float hw = gr_metric(vec2(hq.x / st, hq.y));
    R = hw / max(floor(hw / R + 0.5), 1.0);
  }
  return max(R, 1e-3);
}

// A tiling angular sweep (unstretched, tiles up to 3:1, T = long side / short side): the angle of a ratio of Jacobi
// thetas with a zero at the centre and a pole at the tile's corner — exactly doubly periodic, so the rays bend smoothly
// across the whole tile and meet themselves at its edges, gathering again at one counter-whirl at the corners. Returns
// t; w: its AA width.
float gr_thetaSweep(vec2 d, int rep, float T, out float w) {
  // z in units of the shorter side, its real axis along it (the theta series converges fast for Im τ = T ≥ 1).
  bool rot = uRes.x > uRes.y;
  vec2 z = rot ? vec2(d.y, -d.x) / uRes.y : d / uRes.x;
  // The pole at the tile's corner. arg f + π Re z is the phase of the one doubly periodic |f|: it turns by π
  // across a tile either way and keeps the tile's symmetry (rays evenly spread round the centre at every radius)
  // — seamless for an even count of ramps (a multiple of 4 with Mirror, whose period is two ramps). Other
  // counts take -π Im z / T instead: no turn across the tile, so any count tiles, but the rays crowd towards
  // one diagonal. arg f = arg θ1(π z) − arg θ1(π (z − bo)) + A, A = arg θ1(−π bo): the argument offset at the centre
  // (arg f ≈ arg(z - a) - A). One loop, so the series compiles once.
  vec2 bo = vec2(0.5, 0.5 * T);
  float ph = 0.0;
  for (int k = 0; k < 3 * UNI_1; k++) ph += (k == 1 ? -1.0 : 1.0) * gr_thetaArg(PI * (k == 0 ? z : k == 1 ? z - bo : -bo), T);
  bool even = rep == 2 ? u_turns % 4 == 0 : u_turns % 2 == 0;
  ph += (even ? PI * z.x : -PI * z.y / T) + (rot ? 0.5 * PI : 0.0);
  // Twist: a smooth periodic stand-in for the distance to the centre (|d| near it).
  vec2 sn = uRes / PI * sin(PI * d / uRes);
  // The AA width from the phase's own rate (the centre's and the corner whirl's 1 / (2π r)) rather than from
  // quad derivatives, which zigzag pixel to pixel along the rays.
  float dcn = length(wrapDelta(d - 0.5 * uRes));
  w = float(u_turns) * ((1.0 / max(length(d), 0.5) + 1.0 / max(dcn, 0.5)) / TAU + abs(u_twist) / (0.5 * uRes.x));
  return fract(-(ph + radians(u_angle)) / TAU + u_twist * length(sn) / (0.5 * uRes.x)) * float(u_turns) + u_shift;
}

// The radial-type ramps (and a stretched or long tile's angular sweep) from the centre, or tiling, from its copies among
// the 5 × 5 round it, each weighted by how near it is — by the rings' own metric (turned, stretched; the per-axis nearest
// copy only matches it for upright round, diamond and square rings) or, for an angular sweep, by plain distance —
// e^(-(m - m_min) / τ), τ = Seam rounding / 4 (0: the nearest copy only). Repeating ramps blend their phase (the unit
// vector of the angle 2π t / period), so the bands and rays bend from one copy's into the next and stay sharp — no
// smear, no lobes; a clamped ramp blends t (a rounded ridge where the copies meet). The weights depend on the distances
// only, so they are continuous everywhere: no notch where the nearest copy changes. Returns t; w: its AA width.
float gr_copies(vec2 d, float R, float st, bool wrap, int rep, out float w) {
  float per = rep == 2 ? 2.0 : 1.0;
  float tau = 0.25 * u_seam;
  bool blend = wrap && tau > 0.0 && u_style != 2;
  float m1 = 1e20, t1 = 0.0, wsum = 0.0, tsum = 0.0;
  vec2 acc = vec2(0.0);
  for (int e = 0; e < (wrap ? 25 : 1) * UNI_1; e++) {
    vec2 de = wrap ? d + vec2(float(e % 5 - 2), float(e / 5 - 2)) * uRes : d;
    vec2 kq = unrotCW(de, u_angle);
    float me = u_style == 2 ? length(de) : gr_metric(vec2(kq.x / st, kq.y));
    // (gr_t's ring metric is me: only the sweep needs it.)
    float te = (u_style == 2 ? gr_t(de, R, st) : me / R) + u_shift;
    if (me < m1) {
      // A new nearest copy: rescale what's summed to its weight (running minimum).
      float k = blend ? exp((me - m1) / tau) : 0.0;
      acc *= k; wsum *= k; tsum *= k;
      m1 = me; t1 = te;
    }
    float we = blend ? exp((m1 - me) / tau) : (me == m1 ? 1.0 : 0.0);
    float ph = TAU * te / per;
    acc += we * vec2(cos(ph), sin(ph));
    wsum += we;
    tsum += we * te;
  }
  if (!blend) {
    // An unstretched angular sweep: the AA width from its own rate, 1 / (2π r) per px (+ the twist's), rather than
    // from quad derivatives (which zigzag pixel to pixel along the rays).
    w = u_style == 2 && abs(st - 1.0) < 1e-3 ? float(u_turns) * (1.0 / (TAU * max(m1, 0.5)) + abs(u_twist) / (0.5 * uRes.x)) : gr_w(t1);
    return t1;
  }
  if (rep == 0) {
    float t = tsum / max(wsum, 1e-20);
    w = gr_w(t);
    return t;
  }
  // The blended phase, unwrapped next to the nearest copy's t; its rate per pixel from the unit vector's (|du| =
  // |dφ|), which has no jump where the nearest copy changes.
  vec2 u = acc / max(length(acc), 1e-20);
  float dp = atan(u.y, u.x) - TAU * t1 / per;
  dp -= TAU * floor(dp / TAU + 0.5);
  w = per / TAU * (length(dFdx(u)) + length(dFdy(u)));
  return t1 + per * dp / TAU;
}

GenOut gen(vec2 p) {
  vec2 c = userPx(vec2(u_cx, u_cy));
  vec2 d = p - c;
  // Radial-type gradients use the nearest periodic copy of the centre when tiling (seamless), unless Single.
  bool wrap = uTile && u_wrap == 0;
  if (wrap && u_style != 0) d = wrapDelta(d);
  float st = max(u_stretch, 1e-3);
  // An angular sweep has no clamp: past 1 it repeats (one sweep: the same either way).
  int rep = u_style == 2 && u_repeat == 0 ? 1 : u_repeat;
  float t, w;      // the ramp position and its AA width (rate per pixel)
  int bands = 0;   // bands per tile (> 0: the band index wraps, so per-band randoms tile too)
  if (u_style == 0) {
    t = gr_linear(d, bands) + u_shift;
    w = gr_w(t);
  } else {
    float R = u_style != 2 ? gr_radius(c, wrap, st) : 1.0;
    if (u_style == 2) bands = u_turns;
    // A tiling angular sweep: the theta functions' doubly periodic one; otherwise (stretched, or a long tile) the
    // nearest copy of the centre.
    float T = max(uRes.x, uRes.y) / min(uRes.x, uRes.y);
    if (u_style == 2 && wrap && abs(st - 1.0) < 1e-3 && T <= 3.0) t = gr_thetaSweep(d, rep, T, w);
    else t = gr_copies(d, R, st, wrap, rep, w);
  }
  // One call site each (D3D inlines every call): the band width jitter, then the value.
  if (rep != 0) t = gr_jit(t, bands, w);
  float v = gr_value(t, w, rep);
  // Per-band random (each repeat of the ramp).
  int band = int(floor(t));
  if (bands > 0) band = imod(band, bands);
  float rnd = hashI(ivec2(band, 0), uSeed);
  return genOut(v, 1.0, rnd, 0.0);
}
`
};

// ------------------------------------------------------------------------------------------------ scratches

/**
 * Whether a scratches layer's density gets near its per-cell limit (the shader's cells are about a reach wide; this reach
 * leaves out Swirl's, the burr's and the wobble's terms — near enough to decide whether to show the limit).
 */
const nearCap = (p: Record<string, unknown>): boolean => {
	const lmax = Math.max(Number(p.len_max), Number(p.len_min));
	const reach = 0.5 * lmax * (1 + 0.25 * Number(p.bend ?? 0)) + 0.5 * Number(p.thickness) + 1;
	return (Number(p.density) * reach * reach * (1 + Number(p.clump ?? 0))) / 4096 > 0.5 * Number(p.cap ?? 64);
};

export const scratchesLayer: LayerDef = {
	type: 'scratches',
	label: 'Scratches',
	category: 'pattern',
	kind: 'generator',
	description:
		'Scratches: Random scratches and gouges, tapered, broken up, wobbly or swirled, in clumps, with V- or U-shaped cuts and a raised burr. Makes metal wear, scuffs, brushed metal, scored stone.',
	params: [
		P.float('density', 'Density', 24, 0, 1024, {
			softMax: 256,
			step: 0.1,
			perArea: true,
			section: 'Layout',
			hint: 'How many scratches per 64×64 px (long, dense ones top out at the Density limit). For brushed metal, try 150+ with Density limit 256, 100–400 px long, under 0.6 px wide with Shallow hairlines, Angle variation 1–3°, Clumping 0, Breakup under 0.2 and a low Height amount'
		}),
		P.int('cap', 'Density limit', 64, 1, 256, {
			section: 'Layout',
			showIf: nearCap,
			hint: 'Caps how many scratches fit in one cell (a square about a scratch long): past it, long dense scratches like brushing stop getting denser. Go up to 256 for dense brushing (slower to render)'
		}),
		P.float('angle', 'Angle', 30, -360, 360, {
			softMin: -180,
			softMax: 180,
			unit: '°',
			step: 0.1,
			section: 'Layout',
			hint: 'Turns the scratches, clockwise from horizontal'
		}),
		P.int('dirs', 'Directions', 2, 1, 4, {
			section: 'Layout',
			hint: 'How many directions the scratches run in, spread over 180° from Angle (each with Angle variation): 2 = cross-hatched, 3 = wear from three ways'
		}),
		P.float('dir_bal', 'Direction balance', 0.45, 0, 1, {
			step: 0.001,
			section: 'Layout',
			showIf: (p) => Number(p.dirs) > 1,
			hint: 'Sends more of the scratches along the first direction (0 = all directions alike, 1 = only the first)'
		}),
		P.float('dir_spread', 'Direction spread', 30, 0, 90, {
			unit: '°',
			step: 0.1,
			section: 'Layout',
			showIf: (p) => Number(p.dirs) > 1,
			hint: 'Turns each further direction off the even spread by a random angle up to this, for irregular crossings instead of a regular hatch'
		}),
		P.float('angle_jitter', 'Angle variation', 25, 0, 180, {
			unit: '°',
			step: 0.1,
			section: 'Layout',
			hint: 'Turns each scratch by a random angle up to this (180 = any direction)'
		}),
		P.float('clump', 'Clumping', 0.75, 0, 1, {
			step: 0.001,
			section: 'Layout',
			hint: 'Gathers the scratches into worn patches with bare areas between, keeping the same count overall (0 = evenly spread)'
		}),
		P.float('clump_scale', 'Clumps across', 3, 0.25, 64, {
			softMax: 16,
			step: 0.01,
			section: 'Layout',
			showIf: (p) => Number(p.clump) > 0 || Number(p.bend_coh) > 0,
			hint: 'How many patches (and Swirl’s circles) fit across the texture (rounded when tiling)'
		}),
		P.float('len_min', 'Shortest scratch', 5, 0, 2048, { softMax: 128, unit: 'px', step: 0.5, section: 'Shape' }),
		P.float('len_max', 'Longest scratch', 30, 0, 2048, { softMax: 256, unit: 'px', step: 0.5, section: 'Shape' }),
		P.float('len_bias', 'Length bias', 0.5, 0, 1, {
			step: 0.001,
			section: 'Shape',
			hint: 'Favours short scratches (0 = lengths spread evenly from shortest to longest, 1 = mostly short with a few long ones)'
		}),
		P.float('thickness', 'Width', 1, 0, 64, {
			softMax: 8,
			unit: 'px',
			step: 0.05,
			section: 'Shape',
			hint: 'Sets the width of the widest scratches'
		}),
		P.float('th_len', 'Width by length', 0.8, 0, 1, {
			step: 0.001,
			section: 'Shape',
			hint: 'Ties width to length: short scratches stay thin, long ones get up to the full Width, and none is wider than an eighth of its length (no rice grains)'
		}),
		P.float('th_var', 'Width variation', 0.6, 0, 1, {
			step: 0.001,
			section: 'Shape',
			hint: 'Gives each scratch a random width (1 = anywhere from a faint hairline to the full Width, mostly fine). The weaker scratches (Strength variation) are the thinner ones'
		}),
		P.float('fade', 'Strength variation', 0.6, 0, 1, {
			step: 0.001,
			section: 'Shape',
			hint: 'Gives each scratch a random strength (its value), so some are faint and some deep'
		}),
		...taperParams({ taper: 0.8, at: 'both', len: 0.35, curve: 'round' }, 'Shape'),
		P.float('blunt', 'Blunt start', 0.5, 0, 1, {
			step: 0.001,
			section: 'Shape',
			showIf: (p) => Number(p.taper) > 0 && p.taper_at !== 'end',
			hint: 'Tapers less where each scratch starts (the end the Angle points from), for a blunt entry and a sharp exit, like a tool dragged across'
		}),
		P.float('bend_bias', 'Bend bias', 0, 0, 1, {
			step: 0.001,
			section: 'Shape',
			showIf: (p) => Number(p.bend) > 0,
			hint: 'Leans the bends one way (0 = each scratch bows to a random side, 1 = all bow the same way, like a sweeping hand)'
		}),
		P.float('bend', 'Bend', 0, 0, 2, {
			softMax: 1,
			step: 0.001,
			section: 'Shape',
			hint: 'Curves the scratches into arcs, the long ones most (the same curvature for all: at 1 the longest bow by a quarter of their length). With Swirl, it sets how closely they follow its circles'
		}),
		P.float('bend_coh', 'Swirl', 0, 0, 1, {
			step: 0.001,
			section: 'Shape',
			hint: 'Lines the scratches up along circles around a few centres (one per clump cell, Clumps across), like wiping and polishing marks; Bend curves them round the centre (0 = Angle and Angle variation only)'
		}),
		P.float('wobble', 'Wobble', 0.35, 0, 64, {
			softMax: 8,
			unit: 'px',
			step: 0.01,
			section: 'Shape',
			hint: 'Makes each scratch waver sideways (a few waves per scratch: S-curves, chatter); cuts wider than 2 px waver more, by half their width'
		}),
		P.float('breakup', 'Breakup', 0.5, 0, 1, {
			step: 0.001,
			section: 'Shape',
			hint: 'Varies each scratch along its length (deeper and shallower, wider and narrower) and breaks it into pieces (0 = even capsules, 1 = broken, skipping strokes)'
		}),
		P.float('groove', 'Groove shape', 0.8, 0, 2, {
			softMax: 1,
			step: 0.001,
			section: 'Relief',
			hint: 'Shapes the cross-section of the cut in Height (0 = flat-bottomed, 0.5 = rounded U, 1 = V, 2 = needle-sharp). Scratches under 2 px wide stay flat'
		}),
		P.float('burr', 'Burr', 0.3, 0, 2, {
			softMax: 1,
			step: 0.001,
			section: 'Relief',
			hint: 'Adds a raised lip of pushed-up material beside the cut, up to this share of its depth. It’s uneven between the sides, broken, missing where the scratch starts, rises towards its end, gets wiped out where another cut crosses, and is faint on hairlines (none under half a pixel wide). Works in Height › Pattern, and Height then skips Shaping’s value controls'
		}),
		P.float('heap', 'Exit heap', 0.5, 0, 2, {
			softMax: 1,
			step: 0.001,
			section: 'Relief',
			hint: 'Piles up the material pushed out ahead of each scratch’s end: a crescent around the tip, a random size per scratch (some get none), bigger for strong, wide cuts (Height › Pattern, like Burr)'
		}),
		P.float('burr_width', 'Burr width', 1, 0.25, 32, {
			softMax: 6,
			unit: 'px',
			step: 0.05,
			section: 'Relief',
			showIf: (p) => Number(p.burr) > 0 || Number(p.heap) > 0,
			hint: 'How far the lip (and the exit heap, past the cut’s own width) spreads from the edge of the cut'
		}),
		P.bool('fine', 'Shallow hairlines', true, {
			section: 'Relief',
			hint: 'Makes scratches under a pixel wide shallower in Height and lighter in coverage, by how much of the pixel they cover, so fine brushing reads as a sheen rather than per-pixel trenches and thin ends fade out (off: every scratch gets its full depth and a pixel of coverage)'
		}),
		// Not a control: 1 px of the texture in shader px. Supersampling scales every px param by k, so this keeps the
		// hairline rules (Shallow hairlines, flat narrow grooves, faint burrs) and the shortest waves at output pixels.
		PX_SCALE_PARAM,
		P.float('mask_min', 'Mask threshold', 0, 0, 1, {
			step: 0.001,
			group: 'mask',
			section: 'Write to',
			showIf: (p) => String(p.mk_target ?? '').trim() !== '',
			hint: 'Only sends scratches at least this strong (Strength variation) to the mask, so faint scuffs are left out of what later layers are limited to (e.g. rust in the deep cuts only)'
		}),
		P.seed()
	],
	// The scratches' outline (a signed distance to the nearest one) goes to a mask when given one: later layers are limited
	// to the scratches (rust in them) or, in Subtract mode, to what's around them (paint that skips them).
	sdf: 'mask',
	// Added in the editor: lengths, density and widths sized to the texture (the plain defaults suit about 128 px).
	fresh: ({ width, height }) => {
		const k = Math.max(1, Math.min(width, height) / 128);
		return {
			density: r1(24 / k),
			len_min: r1(5 * k),
			len_max: r1(30 * k),
			thickness: r1(Math.min(3, Math.sqrt(k))),
			wobble: r1(0.35 * Math.sqrt(k)),
			burr_width: r1(Math.max(1, 0.75 * Math.sqrt(k)))
		};
	},
	defaults: {
		mk_target: '',
		dif_on: true,
		dif_opacity: 0.8,
		dif_grad: gradient('#8f8a82', '#d9d4cb'),
		h_on: true,
		h_mode: 'subtract',
		h_amount: 0.2
	},
	glsl:
		TAPER_GLSL +
		/* glsl */ `
GenOut gen(vec2 p) {
  float lmax = max(u_len_max, u_len_min);
  float pxs = max(u_px_scale, 1.0);   // one texture pixel, in shader px (supersampling)
  float bendMax = 0.25 * u_bend;   // the most curved scratch's sagitta, as a share of its length
  // Cells at least one scratch reach wide, so only the 3x3 neighbourhood can touch this pixel.
  float reach = 0.5 * lmax + 0.5 * u_thickness + 1.0 + 0.5 * lmax * max(bendMax, u_bend_coh > 0.0 ? 0.35 * u_bend : 0.0)
              + (u_burr > 0.0 || u_heap > 0.0 ? 2.0 * u_burr_width + 1.2 * u_thickness : 0.0) + u_wobble * max(1.0, 0.5 * u_thickness);
  vec2 n = uTile ? max(floor(uRes / reach), vec2(1.0)) : max(uRes / reach, vec2(1.0));
  vec2 cs = uRes / n;
  // Expected scratches per cell; Clumping draws more and keeps each by the patch noise at its centre.
  float lambda = u_density * cs.x * cs.y / 4096.0 * (1.0 + u_clump);
  int slots = min(int(ceil(lambda)), u_cap);
  vec2 cc = cellsFor(u_clump_scale, 1.0);
  ivec2 cper = periodOf(cc);
  ivec2 ip = ivec2(floor(p / cs));
  float cov = 0.0, val = 0.0, score = 0.0, rnd = 0.0;
  float sd = 1e4;          // signed distance to the nearest scratch (px, < 0 inside)
  float sdAll = 1e4;       // … to any scratch, faint ones too (Edge › Bevel)
  float hv = 0.0;          // deepest groove here (× coverage)
  float lip = 0.0;         // highest burr here
  // One flat loop over the 3x3 cells (one copy of the body), each with its slots.
  for (int e = 0; e < 9 * UNI_1; e++) {
    ivec2 c = ip + ivec2(e % 3 - 1, e / 3 - 1);
    ivec2 cw = wrapCell(c, ivec2(n));
    for (int s = 0; s < slots; s++) {
      float fs = float(s);
      vec3 h = hash3I(cw, uSeed + fs * 7.0);
      vec3 g = hash3I(cw, uSeed + fs * 7.0 + 3.0);
      vec3 k3 = hash3I(cw, uSeed + fs * 7.0 + 5.0);
      // The fractional last slot, and Clumping's thinning. No 'continue': in this loop D3D11 (ANGLE) miscompiles one
      // that some pixels take and their neighbours don't — scratches came out thinned and cut off at cell borders.
      bool skip = fs + 1.0 > lambda && g.z > lambda - fs;
      vec2 pc = (vec2(cw) + h.xy) * cs / uRes * cc;   // the scratch's centre in the patch field
      if (u_clump > 0.0 && !skip) {
        float pn = 0.0;
        for (int o = 0; o < 2 * UNI_1; o++) pn += (o == 0 ? 0.6 : 0.4) * perlinNoise(pc * float(1 + o), cper * (1 + o), uSeed + 61.0 + 6.0 * float(o));
        float m = mix(1.0, 2.0 * smoothstep(0.3, 0.7, pn), u_clump);
        skip = skip || k3.y * (1.0 + u_clump) > m;
      }
      if (!skip) {
        vec3 k4 = hash3I(cw, uSeed + fs * 7.0 + 1.0);
        vec2 ctr = (vec2(c) + h.xy) * cs;
        float len = mix(u_len_min, lmax, u_len_bias > 0.0 ? pow(h.z, 1.0 + 3.0 * u_len_bias) : h.z);
        // Directions: each scratch takes one of 1–4 headings spread over 180° (cross-hatched wear) — the first
        // taking Direction balance more of them, the others each turned off the even spread by up to Direction spread.
        float head = 0.0;
        if (u_dirs > 1) {
          float nd = float(u_dirs);
          float s0 = mix(1.0 / nd, 1.0, u_dir_bal);
          float hi = k3.z < s0 ? 0.0 : 1.0 + min(floor((k3.z - s0) / max(1.0 - s0, 1e-4) * (nd - 1.0)), nd - 2.0);
          head = hi * 180.0 / nd + (hi > 0.0 ? (hashI(ivec2(int(hi), 9), uSeed) - 0.5) * 2.0 * u_dir_spread : 0.0);
        }
        vec2 dir = rotCW(vec2(1.0, 0.0), u_angle + head + (g.x - 0.5) * 2.0 * u_angle_jitter);
        // Bend: a random arc whose sagitta grows with the square of the length (one curvature: long scratches bend,
        // short ones stay nearly straight). Swirl: the scratches follow circles round a centre per clump cell (Clumps across) —
        // their direction the circle's tangent, their arc concentric with it (× Bend) — as wiping and polishing leave.
        vec3 k5 = hash3I(cw, uSeed + fs * 7.0 + 2.0);
        // Bend: random size per scratch, its side random too unless Bend bias leans them all one way.
        float S = bendMax * len * (len / max(lmax, 1e-3)) * abs(2.0 * k3.x - 1.0) * (k5.y < 0.5 + 0.5 * u_bend_bias ? 1.0 : -1.0);
        if (u_bend_coh > 0.0) {
          // Each scratch circles its own centre — the cell's swirl centre moved by up to 0.3 × its distance, so the
          // arcs overlap in loops instead of nesting in a bullseye — drifting off the circle by up to ±12° (spiralling
          // in or out). Within a minimum radius of the centre the scratches keep their own direction: no tight hooks.
          vec2 sc = floor(pc);
          vec2 sw = (sc + 0.5 + (hash2I(imod(ivec2(sc), cper), uSeed + 73.0) - 0.5) * 0.8) / cc * uRes;
          vec2 rv0 = wrapDelta(ctr - sw);
          vec2 rv = rv0 - (k5.xy - 0.5) * 0.6 * length(rv0);
          float rmin = 0.12 * min(uRes.x / cc.x, uRes.y / cc.y);
          float rho = max(length(rv), rmin);
          // An arc stops at three quarters of its circle: no compass-drawn rings.
          len = mix(len, min(len, 4.7 * rho), u_bend_coh);
          vec2 tg = rot2((k5.z - 0.5) * 0.42) * vec2(-rv.y, rv.x) / max(length(rv), 1e-3);
          if (dot(tg, dir) < 0.0) tg = -tg;
          float coh = u_bend_coh * smoothstep(0.5 * rmin, rmin, length(rv));
          dir = normalize(mix(dir, tg, coh) + 1e-6);
          vec2 nr = vec2(-dir.y, dir.x);
          float Sf = sign(dot(nr, rv)) * min(len * len / (8.0 * rho), 0.35 * len) * u_bend;
          S = mix(S, Sf, coh);
        }
        float wgt = 1.0 - g.y;   // the scratch's weight: 1 = the strongest
        // Width: jittered by weight, and (Width by length) narrower for the shorter scratches, never wider than an
        // eighth of the length — no rice grains.
        float thw = u_thickness * mix(1.0, 0.08 + 0.92 * wgt * wgt, u_th_var);
        if (u_th_len > 0.0) thw *= mix(1.0, min(pow(clamp(len / max(lmax, 1e-3), 0.0, 1.0), 0.7), len / (8.0 * max(thw, 1e-3))), u_th_len);
        vec2 nrm = vec2(-dir.y, dir.x);
        // In the scratch's frame: x along it (0 at its middle), y across. Bent: y = S (1/2 - 4 x² / L²), an arc of
        // sagitta S through the middle, the distance taken across it (divided by its slope's secant); Wobble adds a
        // smooth waver to y.
        vec2 r = p - ctr;
        float L = max(len, 1e-3);
        float x = dot(r, dir);
        float xc = clamp(x, -0.5 * len, 0.5 * len);
        float t = xc / L + 0.5;   // 0 at the start, 1 at the end
        float slope = -8.0 * S * xc / (L * L);
        float yc = S * (0.5 - 4.0 * xc * xc / (L * L));
        float nseed = floor(k4.y * 65536.0);
        // Wobble, in px — wider cuts waver more (× half their width past 2 px), but never more than 3 % of the length,
        // in one to three waves along it: no worms.
        if (u_wobble > 0.0) {
          float wa = min(u_wobble * max(1.0, 0.5 * thw), max(0.03 * len, 0.25 * u_wobble));
          yc += wa * (2.0 * valueNoise1(xc / max(0.35 * len, 4.0 * pxs) + 7.0 * k4.z, nseed) - 1.0);
        }
        float dy = dot(r, nrm) - yc;
        float dist = sqrt((x - xc) * (x - xc) + dy * dy / (1.0 + slope * slope));
        // The taper (taperAt), less at a blunt start.
        float tap = t < 0.5 ? u_taper * (1.0 - u_blunt) : u_taper;
        float th = thw * taperAt(t, L, tap).x;
        // Breakup: a noise along the scratch varies its depth and width and opens gaps; the burr is broken by it too.
        // (its waves at least half the scratch long under ~25 px: a short stroke swells once at most, no peanuts)
        float nb = u_breakup > 0.0 || u_burr > 0.0 ? valueNoise1(xc / max(0.15 * len, min(0.5 * len, 12.0 * pxs)) + 13.0 * k4.z, nseed + 1.0) : 1.0;
        float f = 1.0;
        if (u_breakup > 0.0) f = mix(1.0, smoothstep(0.6 * u_breakup - 0.2, 0.6 * u_breakup + 0.2, nb) * (0.4 + 0.6 * nb), u_breakup);
        th *= sqrt(f);
        float gap = u_breakup > 0.0 ? (!u_aa ? step(0.1, f) : smoothstep(0.0, 0.2, f)) : 1.0;
        float rad = !u_aa ? max(0.5 * th, 0.5) : 0.5 * th;
        // Coverage: anti-aliased over a pixel; Shallow hairlines: a cut under a (texture) pixel wide covers as much less
        // (its area) over that pixel, so thin lines and their tapered ends fade out instead of ending in dashes.
        float cv = !u_aa ? (dist <= rad ? 1.0 : 0.0) : (u_fine && th < pxs ? th / pxs * clamp(1.0 - dist / pxs, 0.0, 1.0) : clamp(rad + 0.5 - dist, 0.0, 1.0));
        cv *= gap;
        float st0 = 1.0 - g.y * u_fade;
        float st = st0 * f;
        if (cv * st > score) { score = cv * st; val = st; rnd = h.x; }
        cov = max(cov, cv);
        if (st0 >= u_mask_min) sd = min(sd, dist - rad + (1.0 - gap));
        sdAll = min(sdAll, dist - rad + (1.0 - gap));
        // Relief: the groove's cross-section (flat for scratches under ~2 texture px), and the burr beside the cut.
        float gk = u_groove > 0.0 ? clamp(th / pxs - 1.0, 0.0, 1.0) : 0.0;
        float gp = 1.0 - gk * pow(clamp(dist / max(0.5 * th, 1e-3), 0.0, 1.0), 1.0 / max(u_groove, 1e-3));
        // Shallow hairlines: a cut under a pixel wide is as much shallower (its depth spread over the pixel).
        hv = max(hv, cv * st * gp * (u_fine ? min(1.0, th / pxs) : 1.0));
        if (u_burr > 0.0) {
          float bx = (dist - rad) / u_burr_width;
          float bb = bx > 0.0 && bx < 1.0 ? sin(PI * bx) : 0.0;
          // Along the sides: uneven (a share per side, per scratch), broken, none at the start, rising towards the end,
          // none round the caps.
          float side = dy > 0.0 ? k4.x : 1.0 - k4.x;
          float along = (0.3 + 0.7 * nb) * smoothstep(0.0, 0.3, t) * (0.6 + 0.8 * t) * (1.0 - smoothstep(0.0, 0.5 * u_burr_width, abs(x - xc)));
          lip = max(lip, u_burr * st * clamp((thw / pxs - 0.5) / 1.5, 0.0, 1.0) * bb * bb * (0.4 + 1.2 * side) * along);
        }
        if (u_heap > 0.0 && x > 0.5 * len) {
          // Exit heap: the material pushed out ahead of the end — a crescent round the cap, as big as the cut is
          // strong and wide, its own size per scratch (some none).
          // Centred a little behind the tip, past the cut's full width, so it bows round the end as a ridge rather
          // than a knob on the (tapered) point.
          vec2 re = vec2(x - 0.5 * len + 0.5 * thw, dy);
          float de = length(re);
          float hw = 0.5 * thw + u_burr_width;
          float hx = clamp((de - 0.5 * thw) / hw, 0.0, 1.0);
          float fwd = smoothstep(0.2, 0.9, re.x / max(de, 1e-3));
          float sz = smoothstep(0.2, 1.0, k5.x) * (0.4 + 0.8 * k5.y);
          float hb = sin(PI * hx);
          lip = max(lip, 0.6 * u_heap * st * min(1.0, thw / pxs) * sz * hb * hb * fwd);
        }
      }
    }
  }
  // Hard edges: snap the distance off ±0.5, so the shape-mask coverage is as hard as the scratches.
  if (!u_aa) sd = sd <= 0.0 ? min(sd, -0.5) : max(sd, 0.5);
  // Height reads the deepest groove (hval, shaped like the value); with a burr or heap, a signed profile of its own: the
  // cut down, the lip up (Height's default Subtract mode sinks the first and raises the second) — no lip inside another
  // scratch's cut.
  float hval = cov > 0.0 ? clamp(hv / cov, 0.0, 1.0) : 0.0;
  float height = u_burr > 0.0 || u_heap > 0.0 ? hv - lip * (1.0 - cov) : NO_SDF;
  // The bevel follows every scratch (the mask only those past its threshold).
  GenOut o = genOutHeight(val, cov, rnd, sd, height);
  o.hval = hval;
  o.bdist = u_bevel > 0.0 ? sdAll : NO_SDF;
  return o;
}
`
};
