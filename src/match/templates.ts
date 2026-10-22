// Emulation templates (docs/features/fr7.3-emulation.md): family recipes that turn a target Analysis into a
// starting Project — size and tiling from the target, colours from its dark→light palette, calibrated lighting and
// a final palette snap. The emulator races several templates and then lets the optimiser tune the winner.
//
// Rebuilt around what hand-authoring the first texture set taught (FR7.4–7.8):
//   • Relief lives in its own stack: pillowed faces, crisp edges that rise slowly (custom bevel curve), broad chips
//     in the edge zone, per-block heights, lumps that also drive smooth glints — never pixel-scale height.
//   • Paint is colour: multi-hue noise under per-stone colour, moss in hollows, joints, dirt and wear; pixel grain
//     is colour only. Seedless shapes (plates, rivets, slots) stay colour-coupled paint layers with their height.
//   • A pattern used in both stacks is two layers of one type and seed; the optimiser ties their pattern params.
//   • Weathering: water stains plus rust trails from the same sources; on riveted metal they start at ledges.
//   • Light: specular as its own tinted term, ambient occlusion where blocks touch, painted light for game palettes.

import type { ParamValues } from '@/core/params';
import { defaultRender, type Layer, type MaterialBase, type Project, type RenderSettings } from '@/core/project';
import { createLayer, createLight, createPostFilter, createProject, reliefOnly } from '@/core/serialize';
import { freshParams, getLayerDef } from '@/layers/registry';
import { DEFAULT_BEVEL_CURVE } from '@/layers/commonParams';
import { hexToRgb, linearToOklab, rgbToHex, srgbToLinear1, type RGB } from '@/core/color';
import type { Analysis } from './analyze';
import { BRICKS_PLAIN, VORONOI_PLAIN } from '@/layers/generators/patterns';
import { SHAPE_MASK, fromMask, limitTo } from '@/layers/masks';

export interface TemplateContext {
	/** Palette id for the final snap ('quake', 'doom', … or '' for none). */
	palette: string;
}

export interface Template {
	id: string;
	label: string;
	/** Families / hints this template suits (used to pre-select candidates). */
	tags: string[];
	/** Layer types it needs (templates whose types aren't registered are skipped). */
	requires?: string[];
	build(a: Analysis, ctx: TemplateContext): Project;
}

// ------------------------------------------------------------------------------------------------ colour helpers

const L = (type: string, name: string, params: ParamValues = {}): Layer => createLayer(type, params, name);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Palette entry at t (0 = darkest, 1 = lightest). */
function pick(a: Analysis, t: number): string {
	const p = a.palette;
	if (!p.length) return '#808080';
	const i = Math.min(p.length - 1, Math.max(0, Math.round(t * (p.length - 1))));
	return p[i];
}

function mix(c1: string, c2: string, t: number): string {
	const a = hexToRgb(c1);
	const b = hexToRgb(c2);
	return rgbToHex(a.map((v, i) => v + (b[i] - v) * t) as RGB);
}

function ramp(...colors: string[]) {
	return { stops: colors.map((color, i) => ({ pos: colors.length === 1 ? 0 : i / (colors.length - 1), color })) };
}

/** The palette as a ramp (dark → light) between lightness fractions lo..hi. */
function paletteRamp(a: Analysis, lo = 0, hi = 1) {
	const n = Math.max(2, Math.min(5, a.palette.length));
	return ramp(...Array.from({ length: n }, (_, i) => pick(a, lo + ((hi - lo) * i) / (n - 1))));
}

const oklab = (hex: string) => linearToOklab(hexToRgb(hex).map(srgbToLinear1) as RGB);

/**
 * The palette entries between lightness fractions lo..hi ordered by hue: noise or per-stone colour through it
 * sweeps across hues (moss, blue-grey and brown stones side by side) rather than only light ↔ dark.
 */
function hueRamp(a: Analysis, lo = 0, hi = 1) {
	const n = a.palette.length;
	const band = a.palette.slice(Math.round(lo * (n - 1)), Math.round(hi * (n - 1)) + 1);
	if (band.length < 3) return paletteRamp(a, lo, hi);
	const hue = (c: string) => {
		const [, x, y] = oklab(c);
		return Math.atan2(y, x);
	};
	return ramp(...[...band].sort((p, q) => hue(p) - hue(q)));
}

/** The most clearly green palette entry (moss, verdigris), if any. */
function greenest(a: Analysis): string | null {
	let best: string | null = null;
	let bestA = -0.012;
	for (const c of a.palette) {
		const [, x, y] = oklab(c);
		if (x < bestA && Math.hypot(x, y) > 0.015) {
			bestA = x;
			best = c;
		}
	}
	return best;
}

/** The palette without its green entries (dark → light): the bare metal under a patina. */
function bareRamp(a: Analysis, patina: string | null, lo = 0.1, hi = 0.8) {
	const bare = patina ? a.palette.filter((c) => oklab(c)[1] > -0.005) : [];
	return bare.length >= 2 ? ramp(...bare) : paletteRamp(a, lo, hi);
}

/** The warmest (orange-brown) palette entry, if any: rust reads right only on a warm palette. */
function warmest(a: Analysis): string | null {
	let best: string | null = null;
	let bestW = 0.04;
	for (const c of a.palette) {
		const [, x, y] = oklab(c);
		if (x > 0.01 && y > 0.02 && x + y > bestW) {
			bestW = x + y;
			best = c;
		}
	}
	return best;
}

// ------------------------------------------------------------------------------------------------ project

// Painted light (FR7.4): a low key light from the top-left, no cast shadows — surfaces are lit by their angle, as a
// texture artist paints them. 1.8 · sin 28° + sky 0.15 ≈ 1, so a flat surface still renders at its albedo.
const GAME_PALETTES = new Set(['quake', 'doom']);

interface Stacks {
	/** Relief: shapes the surface (height, roughness, specular) with its colour outputs off; goes first. */
	relief?: Layer[];
	/** Paint: colour, plus deliberate colour-coupled height (plates, rivets, slots). */
	paint: Layer[];
}

interface Look {
	/** Merged over the default: roughness 0.9 and no base specular — glints come from the layers' Specular outputs. */
	base?: Partial<MaterialBase>;
	/** Merged over the default: specular scale 1, tint 0.7 (glints enrich the colour), no ambient occlusion. */
	render?: Partial<RenderSettings>;
}

function base(a: Analysis, ctx: TemplateContext, name: string, stacks: Stacks, look: Look = {}): Project {
	const tile = a.tileable || (a.tileX && a.height <= 32);
	const painted = GAME_PALETTES.has(ctx.palette);
	return createProject({
		name,
		width: a.width,
		height: a.height,
		tileable: tile,
		heightDepth: 2.5,
		seed: 1,
		base: { color: pick(a, 0.5), roughness: 0.9, specular: 0, height: 0, opacity: 1, ...look.base },
		layers: [...(stacks.relief ?? []).map(reliefOnly), ...stacks.paint],
		lighting: {
			// Calibrated so a flat surface renders close to its albedo: sun·sin(45°) + sky ≈ 1.
			sky: { enabled: true, zenith: '#d8dde2', horizon: '#c9c6c0', intensity: painted ? 0.15 : 0.32 },
			ambient: { color: '#ffffff', intensity: 0.02 },
			lights: [
				{
					...createLight('directional', {
						azimuth: 315,
						elevation: painted ? 28 : 45,
						angle: 2,
						intensity: painted ? 1.8 : 1.0,
						color: '#ffffff'
					}),
					name: 'Key'
				}
			]
		},
		render: {
			...defaultRender(),
			samplesPerFrame: 4,
			maxSamples: 64,
			bounces: 1,
			specular: 1,
			specularTint: 0.7,
			ao: 0,
			aoRadius: 3,
			jitter: false,
			clamp: 8,
			shadows: !painted,
			...look.render
		},
		post: [
			createPostFilter('tonemap', { operator: 'clamp', exposure: 0 }),
			...(ctx.palette ? [createPostFilter('palette', { palette: ctx.palette, dither: 'none' })] : [])
		]
	});
}

/** Repeat counts along x / y from the measured periods (fallback: one cell per `fallback` px). */
function counts(a: Analysis, fallbackX: number, fallbackY: number, divX = 1): [number, number] {
	const cx = a.periodX
		? Math.max(1, Math.round(a.width / (a.periodX * divX)))
		: Math.max(1, Math.round(a.width / fallbackX));
	const cy = a.periodY ? Math.max(1, Math.round(a.height / a.periodY)) : Math.max(1, Math.round(a.height / fallbackY));
	return [cx, cy];
}

/** A Tiles layer of cx × cy squares (exact counts: no fitting to the tile shape). */
function squares(a: Analysis, cx: number, cy: number): ParamValues {
	return {
		mode: 'squares',
		scale: cx,
		aspect: (cx * a.height) / (a.width * cy),
		fit: false,
		tilt: 0,
		crown: 0,
		h_var: 0,
		laid: 0
	};
}

/** Pattern offsets that put the strongest measured lines on the pattern's cell edges. */
function phase(a: Analysis): ParamValues {
	return { ofs_x: a.periodX ? a.phaseX : 0, ofs_y: a.periodY ? a.phaseY : 0 };
}

/** Noise `scale` (features across the texture) for features about `px` wide. */
const across = (a: Analysis, px: number) => r2(a.width / Math.max(1, px));

/**
 * Streaky noise (brushed metal, wood grain): features `len` px along the streak and `width` px across. Width ≥ 2 px
 * keeps it out of pixel-scale noise.
 */
function streaks(a: Analysis, vertical: boolean, len: number, width: number): ParamValues {
	const w = Math.max(2, width);
	return vertical ? { scale: across(a, len), stretch: r2(w / len) } : { scale: across(a, w), stretch: r2(len / w) };
}

// ------------------------------------------------------------------------------------------------ relief recipes

/** Filter params that blur the height channel only. */
const HEIGHT_ONLY = {
	diffuse: false,
	height: true,
	roughness: false,
	specular: false,
	emissive: false,
	opacity: false
};

/** Height-only areas: off the joints (the region left by the shapes beneath). */
const ON_FACES = { m_hmode: 'above', m_hlevel: 0.05, m_hsoft: 0.05 };

const crisp = () => JSON.parse(JSON.stringify(DEFAULT_BEVEL_CURVE));

/** Smooth undulation with patchy glints (the specular follows the lumps). */
function lumps(a: Analysis, px = 6, amount = 0.4, faces = true, seed = 31): Layer {
	return L('noise', 'Lumps', {
		noise: 'perlin',
		fractal: 'fbm',
		scale: across(a, px),
		octaves: 2,
		seed,
		h_on: true,
		h_amount: amount,
		dif_on: false,
		s_on: true,
		s_mode: 'multiply',
		s_src: 'value',
		s_a: 0.15,
		s_b: 1,
		...(faces ? ON_FACES : {})
	});
}

/** Scattered small pits that also kill the glint inside them. */
function pits(a: Analysis, faces = true, seed = 33): Layer {
	return L('noise', 'Pits', {
		noise: 'worley',
		fractal: 'none',
		w_even: false,
		w_profile: 'linear',
		scale: across(a, 5),
		seed,
		sh_invert: true,
		sh_cut: 0.94,
		sh_cut_soft: 0.04,
		h_on: true,
		h_mode: 'subtract',
		h_amount: 0.25,
		dif_on: false,
		s_on: true,
		s_mode: 'multiply',
		s_src: 'flat',
		s_a: 0.2,
		s_b: 0.2,
		...(faces ? ON_FACES : {})
	});
}

/** Shallow dents for metal and tech surfaces: broad, with glints that come and go across them. */
function dents(a: Analysis, amount = 0.1): Layer {
	return L('noise', 'Dents', {
		noise: 'perlin',
		fractal: 'fbm',
		scale: across(a, 10),
		octaves: 2,
		seed: 32,
		h_on: true,
		h_amount: amount,
		dif_on: false,
		s_on: true,
		s_mode: 'multiply',
		s_src: 'value',
		s_a: 0.4,
		s_b: 1
	});
}

/**
 * Dressed stone (FR7.6): one pattern layer — Bricks or Voronoi cells, `shape` its params — lays the stones out in the
 * Shape mask; Mask area layers read them from there (FR8.23): a flat Pillow blurred into a broad dome; crisp edges
 * that rise slowly (custom curve, no tent); broad faceted chips cut into the edge zone; per-block heights (after the
 * chips, so no face drowns under the mask); lumps and pits.
 */
function dressedRelief(
	a: Analysis,
	type: 'bricks' | 'voronoi',
	shape: ParamValues,
	blockMin: number,
	blockMax: number
): Layer[] {
	const pillow = 0.6;
	const edge = 0.5;
	const flat = { ...fromMask(SHAPE_MASK, shape), dif_on: false };
	return [
		L(type, 'Stones', { ...shape, bevel: 0, profile: 'flat', h_on: false, dif_on: false }),
		L('surfacemask', 'Pillow', { ...flat, h_on: true, h_amount: pillow }),
		L('blur', 'Pillow blur', { radius: r2(clamp(blockMin / 4, 1.5, 6)), ...HEIGHT_ONLY }),
		L('surfacemask', 'Edges', {
			...fromMask(SHAPE_MASK, shape),
			bevel: r2(clamp(blockMin * 0.6, 2, 12)),
			profile: 'custom',
			bevel_curve: crisp(),
			dif_on: false,
			h_on: true,
			h_amount: edge,
			r_on: true,
			r_mode: 'replace',
			r_src: 'flat',
			r_a: 0.6,
			r_b: 0.6,
			s_on: true,
			s_mode: 'replace',
			s_src: 'flat',
			s_a: 0.6,
			s_b: 0.6
		}),
		L('voronoi', 'Chips', {
			output: 'facets',
			facet_fit: false,
			scale: across(a, clamp(0.18 * (blockMin + blockMax), 6, 12)),
			jitter: 1,
			tilt: 1.6,
			seed: 19,
			mk_target: '',
			h_on: true,
			h_mode: 'min',
			h_amount: 1.3,
			dif_on: false,
			m_hmode: 'below',
			m_hlevel: r2(0.8 * (pillow + edge)),
			m_hsoft: 0.08
		}),
		L('surfacemask', 'Block heights', { ...flat, h_on: true, h_amount: 0.4, h_var: 1 }),
		lumps(a, clamp(blockMin * 0.6, 4, 10), 0.4),
		pits(a)
	];
}

// ------------------------------------------------------------------------------------------------ paint recipes

/** Pixel grain in colour only (lit as height it would sparkle). */
function speckle(amount = 0.2, extra: ParamValues = {}): Layer {
	return L('noise', 'Speckle', {
		noise: 'white',
		seed: 15,
		h_on: false,
		dif_on: true,
		dif_blend: 'overlay',
		dif_opacity: amount,
		dif_grad: ramp('#000000', '#ffffff'),
		...extra
	});
}

function grime(a: Analysis, radius = 2, wear = 0.35): Layer {
	return L('cavity', 'Grime & wear', {
		radius,
		threshold: 0.05,
		sensitivity: 0.8,
		wear_amount: wear,
		wear_color: pick(a, 1),
		dirt_amount: 0.6,
		dirt_color: mix(pick(a, 0), '#000000', 0.4),
		noise_scale: 8
	});
}

/**
 * Stone paint (FR7.6): dark joints, multi-hue noise under per-stone colour (the stones of the Shape mask the relief's
 * pattern layer wrote), moss in the hollows when the palette has a green, colour speckle, crevice dirt and edge wear.
 */
function stonePaint(a: Analysis, shape: ParamValues, radius = 2): Layer[] {
	const dark = pick(a, 0);
	const moss = greenest(a);
	return [
		L('noise', 'Joints', {
			noise: 'white',
			seed: 2,
			...limitTo(SHAPE_MASK, { outside: true }),
			h_on: false,
			dif_on: true,
			dif_grad: ramp(mix(dark, '#000000', 0.3), mix(dark, pick(a, 0.4), 0.3))
		}),
		L('noise', 'Stone noise', {
			noise: 'value',
			fractal: 'fbm',
			scale: across(a, 7),
			octaves: 3,
			seed: 12,
			...limitTo(SHAPE_MASK),
			h_on: false,
			dif_on: true,
			dif_grad: hueRamp(a, 0.15, 0.85)
		}),
		L('surfacemask', 'Stone colour', {
			...fromMask(SHAPE_MASK, shape),
			h_on: false,
			dif_on: true,
			dif_src: 'random',
			dif_opacity: 0.6,
			dif_grad: hueRamp(a, 0.2, 1)
		}),
		...(moss
			? [
					L('noise', 'Moss', {
						noise: 'perlin',
						fractal: 'fbm',
						scale: across(a, 6),
						octaves: 3,
						seed: 14,
						sh_cut: 0.7,
						sh_cut_soft: 0.05,
						m_hmode: 'below',
						m_hlevel: 0.35,
						m_hsoft: 0.15,
						h_on: false,
						dif_on: true,
						dif_opacity: 0.85,
						dif_grad: ramp(mix(moss, '#000000', 0.25), moss)
					})
				]
			: []),
		speckle(0.18, { ...limitTo(SHAPE_MASK) }),
		grime(a, radius, 0.3)
	];
}

/** Stone looks: dark joints, tinted glints off the faces, occlusion where the blocks touch. */
function stone(a: Analysis): Look {
	return { base: { color: pick(a, 0), roughness: 0.95 }, render: { ao: 1, aoRadius: 3, specularTint: 0.75 } };
}

/** A masonry template: courses of bricks or blocks as dressed stone. */
function masonry(a: Analysis, ctx: TemplateContext, name: string, shape: ParamValues, radius = 2): Project {
	shape = { ...BRICKS_PLAIN, ...shape };
	const vertical = shape.vertical === true;
	const span = vertical ? a.width : a.height;
	const lengthPx = (vertical ? a.height : a.width) / Number(shape.columns);
	let coursePx = span / Number(shape.rows);
	if (coursePx > lengthPx * 1.05) {
		// Courses are never taller than the stones are long: the measured period was something else (moss, a stain
		// band) — fall back to courses half a stone high.
		shape = { ...shape, rows: Math.max(1, Math.round(span / (lengthPx / 2))) };
		coursePx = span / Number(shape.rows);
	}
	const lo = Math.min(lengthPx, coursePx);
	const hi = Math.max(lengthPx, coursePx);
	return base(
		a,
		ctx,
		name,
		{ relief: dressedRelief(a, 'bricks', shape, lo, hi), paint: stonePaint(a, shape, radius) },
		stone(a)
	);
}

/**
 * Water stains plus rust trails from the same sources (FR7.7): the water darkens broadly; where it is strongest the
 * rust shows. With `ledges` the sources are the lower edges of raised features beneath (rivets, plate lips) — every
 * ledge drips, taller ones longer. Rust only on a warm palette.
 */
function stains(a: Analysis, opts: { ledges?: boolean; seed?: number; blisters?: boolean } = {}): Layer[] {
	const grid: ParamValues = opts.ledges
		? {
				cols: Math.ceil(a.width / 3),
				rows: Math.ceil(a.height / 3),
				density: 0.9,
				len_min: 3,
				len_max: Math.round(a.height * 0.25),
				relief: 1,
				ledge: 0.15,
				ledge_reach: 2,
				ledge_soft: 0.15,
				relief_len: 1
			}
		: {
				cols: Math.max(4, Math.round(a.width / 5)),
				rows: Math.max(2, Math.round(a.height / 9)),
				density: 0.5,
				len_min: 6,
				len_max: Math.round(a.height * 0.45)
			};
	const src = { ...grid, wobble: 0.3, head: 0, seed: opts.seed ?? 5 };
	const rust = warmest(a);
	return [
		L('drips', 'Water stain', {
			output: 'stain',
			...src,
			width: 3,
			width_var: 0.5,
			start: 0.7,
			fade: 0.9,
			hard: false,
			h_on: false,
			dif_on: true,
			dif_blend: 'multiply',
			dif_grad: ramp('#ffffff', mix(pick(a, 0.15), '#2a2018', 0.4))
		}),
		...(rust
			? [
					L('drips', 'Rust trails', {
						output: 'stain',
						...src,
						width: 1.4,
						width_var: 0.6,
						str_var: 0,
						start: 1,
						fade: 1,
						hard: true,
						sh_cut: 0.72,
						sh_cut_soft: 0.05,
						h_on: false,
						dif_on: true,
						dif_grad: ramp(mix('#6a2c14', rust, 0.35), mix('#a84a22', rust, 0.35))
					}),
					...(opts.blisters
						? [
								L('drips', 'Blisters', {
									output: 'source',
									...src,
									blister: 1.2,
									ledge_mix: opts.ledges ? 0.6 : 0,
									hard: true,
									mk_target: '',
									h_on: true,
									h_amount: 0.6,
									dif_on: true,
									dif_src: 'value',
									dif_grad: ramp(mix('#5a2412', rust, 0.25), mix('#7a3418', rust, 0.25))
								})
							]
						: [])
				]
			: [])
	];
}

/** Metal looks: glossier, glints in the metal's own hue, a little occlusion in seams. */
const METAL: Look = { base: { roughness: 0.6, specular: 0.25 }, render: { specularTint: 0.85, ao: 0.5, aoRadius: 3 } };

/** Glossy looks: tiles, marble, liquids. */
const GLOSSY: Look = { base: { roughness: 0.4, specular: 0.4 }, render: { specularTint: 0.6 } };

function withBase(look: Look, base: Partial<MaterialBase>): Look {
	return { ...look, base: { ...look.base, ...base } };
}

/**
 * A natural rock face (FR8.18): one Rock pattern used five times — the relief (height only), its colour by height,
 * colour bands per bed, darker scarps and dirt (or moss, on a palette with a real green) in the crevices — plus in-hue grain
 * and cavity grime. Steep strata broken into tilted blocks, with whole, smooth fracture planes beside shattered zones;
 * blocks about an eighth of the texture's side and deep relief, so they cast shadows under a low, warm key light and a
 * cool sky. Painted light (game palettes, no shadows) gets the same rock, shaded by its slopes alone.
 */
function rockFace(a: Analysis, ctx: TemplateContext): Project {
	const painted = GAME_PALETTES.has(ctx.palette);
	// Blocks about an eighth of the texture's mean side (wide textures don't get huge blocks).
	const size = r2(clamp(Math.sqrt(a.width * a.height) * 0.12, 7, 32));
	// Small blocks (small textures) lose their facets (under ~8 px they fade out), so they get the irregularity instead:
	// less bedding, more tilt, a little grain. k: 0 for small blocks … 1 from 16 px up. Sizes spread wide and many blocks
	// merge at every size: big blocks among small ones, not a regular lattice of scales.
	const k = clamp((size - 8) / 8, 0, 1);
	const rock: ParamValues = {
		seed: 11,
		angle: -60,
		cross: 0,
		fold: 0,
		size,
		elong: 1.15,
		bedding: r2(lerp(0.2, 0.6, k)),
		jitter: 1,
		merge: 0.45,
		size_var: 0.9,
		warp: 0.15,
		jag: 0.3,
		heights: 1,
		coherence: 0.3,
		tilt: r2(lerp(1.3, 1, k)),
		dip: 0,
		bulge: 0,
		lean: 0.6,
		scarp: 1.5,
		weather: r2(lerp(0.8, 0.5, k)),
		detail: size >= 14 ? 3 : 2,
		facets: 0.35,
		zones: 0.8,
		rough: r2(lerp(0.06, 0.04, k)),
		rough_scale: r2(lerp(2, 4, k)),
		// Scarps stepped every 2 px: thin layered edges along the blocks' sides. (Laminae, even faint, turned the smooth
		// faces into wood grain.)
		steps: 0.8,
		step_px: 2,
		joint: 0,
		mk_target: '',
		// (The Rock layer's Fractured face style is this look: picking another style then moves every param.)
		style: 'fractured'
	};
	// Moss only for a real (yellowish) green: greenest() also takes slate's blue-greys, and lighter than the rock they
	// drew pale lines along every crevice.
	const green = greenest(a);
	const moss = green && oklab(green)[2] > 0.005 ? green : null;
	const dark = mix(pick(a, 0), '#000000', 0.35);
	const p = base(
		a,
		ctx,
		'Rock face',
		{
			relief: [L('rock', 'Rock', { ...rock, h_on: true, h_amount: r2(size * 0.32) })],
			paint: [
				L('rock', 'Rock colour', { ...rock, h_on: false, dif_on: true, dif_grad: paletteRamp(a, 0.05, 0.95) }),
				L('rock', 'Bed colour', {
					...rock,
					rnd_mode: 'mix',
					h_on: false,
					dif_on: true,
					dif_src: 'random',
					dif_blend: 'overlay',
					dif_opacity: 0.35,
					dif_grad: hueRamp(a, 0.2, 0.9)
				}),
				L('rock', 'Scarps', {
					...rock,
					output: 'scarps',
					h_on: false,
					dif_on: true,
					dif_blend: 'multiply',
					dif_opacity: 0.8,
					dif_grad: ramp('#ffffff', mix(pick(a, 0.3), dark, 0.5))
				}),
				L('rock', moss ? 'Moss' : 'Crevice dirt', {
					...rock,
					output: 'crevices',
					crev_reach: r2(clamp(size * 0.12, 1.2, 4)),
					crev_patch: 0.6,
					h_on: false,
					dif_on: true,
					...(moss
						? { dif_opacity: 0.7, dif_grad: ramp(mix(moss, '#000000', 0.3), moss) }
						: { dif_blend: 'multiply', dif_opacity: 0.3, dif_grad: ramp('#ffffff', dark) })
				}),
				L('noise', 'Grain', {
					noise: 'white',
					seed: 15,
					h_on: false,
					dif_on: true,
					dif_blend: 'overlay',
					dif_opacity: 0.25,
					dif_grad: hueRamp(a, 0.3, 0.9)
				}),
				grime(a, 2, 0.2)
			]
		},
		{ base: { color: pick(a, 0.4), roughness: 0.95, specular: 0.2 }, render: painted ? {} : { jitter: true } }
	);
	if (!painted) {
		// A low, warm key light so the blocks cast shadows; a brighter, cool sky fills the shadowed faces.
		const key = p.lighting.lights[0];
		key.params = { ...key.params, elevation: 25, intensity: 1.9, color: '#fff0dc' };
		p.lighting.sky = { ...p.lighting.sky, intensity: 0.45, zenith: '#b4c4dc', horizon: '#c8ccd4' };
	}
	return p;
}

// ------------------------------------------------------------------------------------------------ templates

export const TEMPLATES: Template[] = [
	// ---------------------------------------------------------------- ground and rock
	{
		id: 'rough',
		label: 'Rough surface (rock, ground, concrete)',
		tags: ['rock', 'ground', 'concrete', 'dirt', 'sand', 'generic'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Rough',
				{
					relief: [
						L('noise', 'Form', {
							noise: 'perlin',
							fractal: 'fbm',
							scale: 3,
							octaves: 5,
							seed: 21,
							h_on: true,
							h_amount: 0.5,
							dif_on: false
						}),
						lumps(a, 6, 0.2, false),
						pits(a, false)
					],
					paint: [
						// Same pattern as the form (tied): darker in the hollows.
						L('noise', 'Shade', {
							noise: 'perlin',
							fractal: 'fbm',
							scale: 3,
							octaves: 5,
							seed: 21,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0.1, 0.9)
						}),
						L('noise', 'Tint', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 10),
							octaves: 3,
							seed: 22,
							h_on: false,
							dif_on: true,
							dif_opacity: 0.5,
							dif_grad: hueRamp(a, 0.2, 0.8)
						}),
						L('noise', 'Grain', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 3),
							octaves: 2,
							seed: 23,
							h_on: false,
							dif_on: true,
							dif_blend: 'overlay',
							dif_opacity: 0.35,
							dif_grad: ramp('#000000', '#ffffff')
						}),
						speckle(0.15),
						grime(a, 2)
					]
				},
				{ base: { roughness: 0.95, specular: 0.3 }, render: { ao: 0.6, aoRadius: 3 } }
			)
	},
	{
		id: 'rocky',
		label: 'Rock face (fractured strata)',
		tags: ['rock', 'cliff', 'stone'],
		requires: ['rock', 'cavity'],
		build: (a, ctx) => rockFace(a, ctx)
	},
	{
		id: 'cobbles',
		label: 'Cobbles / flagstones',
		tags: ['rock', 'cobble', 'stone'],
		requires: ['voronoi'],
		build: (a, ctx) => {
			const cell = Math.max(6, a.periodX || a.periodY || 13);
			const shape = {
				...VORONOI_PLAIN,
				output: 'cells',
				scale: across(a, cell),
				jitter: 0.85,
				gap: 1,
				round: 2,
				warp: 1.5,
				seed: 4,
				aa: false
			};
			return base(
				a,
				ctx,
				'Cobbles',
				{ relief: dressedRelief(a, 'voronoi', shape, cell, cell), paint: stonePaint(a, shape, 2) },
				stone(a)
			);
		}
	},

	// ---------------------------------------------------------------- masonry
	{
		id: 'bricks',
		label: 'Bricks / dressed stone courses',
		tags: ['brick', 'stone', 'wall', 'city'],
		requires: ['bricks', 'voronoi'],
		build: (a, ctx) => {
			const [columns, rows] = counts(a, 32, 16, 2);
			return masonry(a, ctx, 'Bricks', {
				columns,
				rows,
				...phase(a),
				stagger: 0.5,
				mortar: 0.5,
				round: 1.5,
				row_jitter: 0.2,
				len_var: 0.3,
				pos_jitter: 0.4,
				rot_jitter: 1,
				dw_amount: 0.8,
				dw_scale: 6,
				seed: 6,
				aa: false
			});
		}
	},
	{
		id: 'bricks-v',
		label: 'Vertical brick courses',
		tags: ['brick', 'stone', 'wall'],
		requires: ['bricks', 'voronoi'],
		build: (a, ctx) => {
			const rows = a.periodX ? Math.max(1, Math.round(a.width / a.periodX)) : Math.max(1, Math.round(a.width / 16));
			const columns = a.periodY
				? Math.max(1, Math.round(a.height / (2 * a.periodY)))
				: Math.max(1, Math.round(a.height / 32));
			return masonry(a, ctx, 'Vertical bricks', {
				vertical: true,
				rows,
				columns,
				...phase(a),
				stagger: 0.5,
				mortar: 0.5,
				round: 1.5,
				row_jitter: 0.2,
				len_var: 0.3,
				pos_jitter: 0.4,
				rot_jitter: 1,
				dw_amount: 0.8,
				dw_scale: 6,
				seed: 6,
				aa: false
			});
		}
	},
	{
		id: 'blocks',
		label: 'Large stone blocks',
		tags: ['stone', 'wall', 'block'],
		requires: ['bricks', 'voronoi'],
		build: (a, ctx) => {
			const [columns, rows] = counts(a, 32, 32);
			return masonry(
				a,
				ctx,
				'Blocks',
				{
					columns,
					rows,
					...phase(a),
					stagger: 0,
					mortar: 0.75,
					round: 3,
					pos_jitter: 0.3,
					rot_jitter: 0.5,
					dw_amount: 1.2,
					dw_scale: 5,
					seed: 1,
					aa: false
				},
				2.5
			);
		}
	},
	{
		id: 'rubble',
		label: 'Hand-placed rubble stone (dry wall)',
		tags: ['stone', 'wall', 'rubble', 'city', 'rock'],
		requires: ['bricks', 'voronoi'],
		build: (a, ctx) => {
			const [columns, rows] = counts(a, 16, 8, 2);
			return masonry(
				a,
				ctx,
				'Rubble',
				{
					columns,
					rows,
					...phase(a),
					stagger: 0.5,
					mortar: 0.3,
					round: 2,
					row_var: 0.5,
					len_var: 0.6,
					row_jitter: 0.4,
					pos_jitter: 1.2,
					rot_jitter: 3,
					dw_amount: 1,
					dw_scale: 6,
					seed: 6,
					aa: false
				},
				1.5
			);
		}
	},
	{
		id: 'carved',
		label: 'Carved courses fading into the surface',
		tags: ['brick', 'stone', 'wall', 'city'],
		requires: ['bricks'],
		build: (a, ctx) => {
			// Grooved walls (FR7.6): grooves cut into a flat surface, their depth multiplied by noise so the coursing fades out
			// in places; the joint paint follows the same noise (tied).
			const [columns, rows] = counts(a, 21, 8, 2);
			const reliefNoise = { noise: 'perlin', fractal: 'fbm', scale: 6, octaves: 3, seed: 7, sh_lo: 0.46, sh_hi: 0.56 };
			return base(
				a,
				ctx,
				'Carved',
				{
					relief: [
						L('bricks', 'Grooves', {
							...BRICKS_PLAIN,
							columns,
							rows,
							...phase(a),
							stagger: 0.5,
							mortar: 1,
							round: 1,
							len_var: 0.6,
							row_jitter: 0.3,
							dw_amount: 0.6,
							dw_scale: 6,
							seed: 3,
							bevel: 0.6,
							profile: 'linear',
							aa: false,
							sh_invert: true,
							h_on: true,
							h_mode: 'subtract',
							h_amount: 1,
							h_var: 0.3,
							dif_on: false,
							r_on: true,
							r_mode: 'replace',
							r_src: 'flat',
							r_a: 0.5,
							r_b: 0.5,
							s_on: true,
							s_src: 'flat',
							s_a: 0.25,
							s_b: 0.25
						}),
						L('noise', 'Relief mask', { ...reliefNoise, h_on: true, h_mode: 'multiply', h_amount: 1, dif_on: false }),
						L('noise', 'Grain', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 2.5),
							octaves: 2,
							seed: 9,
							sh_lo: 0.4,
							sh_hi: 0.85,
							h_on: true,
							h_amount: 0.05,
							dif_on: false
						})
					],
					paint: [
						L('noise', 'Mottle', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 6),
							octaves: 4,
							seed: 2,
							h_on: false,
							dif_on: true,
							dif_grad: hueRamp(a, 0.2, 0.8)
						}),
						speckle(0.25),
						L('noise', 'Joint paint', {
							...reliefNoise,
							...limitTo(SHAPE_MASK, { outside: true }),
							h_on: false,
							dif_on: true,
							dif_blend: 'darken',
							dif_grad: ramp('#ffffff', mix(pick(a, 0), '#000000', 0.5))
						}),
						L('cavity', 'Edge wear', {
							radius: 1,
							threshold: 0.04,
							sensitivity: 1.2,
							dirt_amount: 0,
							wear_amount: 0.8,
							wear_color: pick(a, 0.85),
							noise_scale: 10
						})
					]
				},
				{ base: { color: pick(a, 0.4), roughness: 0.95 }, render: { ao: 1, aoRadius: 3, specularTint: 0.8 } }
			);
		}
	},

	// ---------------------------------------------------------------- metal
	{
		id: 'plate',
		label: 'Riveted metal plate',
		tags: ['metal', 'plate', 'iron', 'panel'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Plate',
				{
					relief: [dents(a)],
					paint: [
						L('noise', 'Brushed', {
							noise: 'value',
							fractal: 'fbm',
							...streaks(a, a.edgeX > a.edgeY, a.width * 0.4, 2),
							octaves: 2,
							seed: 7,
							sh_lo: 0.32,
							sh_hi: 0.68,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0.2, 0.8)
						}),
						speckle(0.15),
						L('rect', 'Plate', {
							size_mode: 'inset',
							inset_x: 2,
							inset_y: 2,
							radius: 0,
							bevel: 2,
							profile: 'linear',
							aa: false,
							h_on: true,
							h_amount: 0.5,
							dif_on: false
						}),
						L('circle', 'Rivets', {
							radius: 1.6,
							x: 0.12,
							y: 0.12,
							rep_x: 2,
							rep_y: 2,
							rep_mirror: true,
							bevel: 1.5,
							aa: false,
							mk_target: '',
							h_on: true,
							h_amount: 0.5,
							dif_on: true,
							dif_grad: ramp(pick(a, 0.3), pick(a, 1)),
							s_on: true,
							s_mode: 'replace',
							s_src: 'flat',
							s_a: 0.6,
							s_b: 0.6
						}),
						...stains(a, { ledges: true }),
						grime(a, 1.5)
					]
				},
				METAL
			)
	},
	{
		id: 'panelgrid',
		label: 'Metal panels in a grid',
		tags: ['metal', 'panel', 'tech', 'base'],
		requires: ['grid', 'drips'],
		build: (a, ctx) => {
			const [count_x, count_y] = counts(a, 32, 32);
			return base(
				a,
				ctx,
				'Panel grid',
				{
					relief: [dents(a)],
					paint: [
						L('noise', 'Brushed', {
							noise: 'value',
							fractal: 'fbm',
							...streaks(a, a.edgeX > a.edgeY, a.width * 0.3, 2),
							octaves: 2,
							seed: 7,
							sh_lo: 0.32,
							sh_hi: 0.68,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0.25, 0.85)
						}),
						L('grid', 'Seams', {
							count_x,
							count_y,
							...phase(a),
							width: 1,
							bevel: 1,
							profile: 'linear',
							aa: false,
							h_on: true,
							h_mode: 'subtract',
							h_amount: 0.5,
							dif_on: true,
							dif_src: 'flat',
							dif_grad: ramp(pick(a, 0)),
							dif_opacity: 0.8
						}),
						L('circle', 'Bolts', {
							radius: 1.4,
							x: 0.1,
							y: 0.1,
							rep_x: 4,
							rep_y: 4,
							rep_mirror: true,
							bevel: 1.2,
							aa: false,
							mk_target: '',
							h_on: true,
							h_amount: 0.4,
							dif_on: true,
							dif_grad: ramp(pick(a, 0.3), pick(a, 1)),
							s_on: true,
							s_mode: 'replace',
							s_src: 'flat',
							s_a: 0.6,
							s_b: 0.6
						}),
						...stains(a, { ledges: true }),
						grime(a, 1.5)
					]
				},
				METAL
			);
		}
	},
	{
		id: 'riveted',
		label: 'Riveted plates',
		tags: ['metal', 'plate', 'panel', 'base', 'iron'],
		requires: ['greebles', 'drips'],
		build: (a, ctx) => {
			const size = Math.max(8, a.periodX || a.periodY || Math.min(a.width, a.height) / 2);
			return base(
				a,
				ctx,
				'Riveted plates',
				{
					relief: [dents(a)],
					paint: [
						L('noise', 'Metal', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 12),
							octaves: 4,
							seed: 8,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0.2, 0.8)
						}),
						L('greebles', 'Plates', {
							depth: 3,
							min_size: size,
							max_size: size,
							split_var: 0,
							snap: size,
							gap: 1,
							levels: 1,
							frame_chance: 0,
							detail_chance: 0,
							// A regular grid of plain plates at the reference's period: no pinwheel, cut corners, or thinner border seam.
							root: 'tile',
							pinwheel: 0,
							cut_chance: 0,
							shape_chance: 0,
							edge_seam: 1,
							rivets: 'edges',
							rivet_chance: 1,
							rivet_radius: 0.5,
							rivet_inset: 3,
							rivet_spacing: 4.5,
							rivet_height: 0.3,
							bevel: 2,
							profile: 'linear',
							aa: false,
							h_on: true,
							h_amount: 0.6,
							dif_on: true,
							dif_src: 'value',
							dif_grad: ramp(pick(a, 0), pick(a, 0.6), pick(a, 1)),
							dif_opacity: 0.6
						}),
						speckle(0.12),
						...stains(a, { ledges: true }),
						grime(a, 1.5)
					]
				},
				METAL
			);
		}
	},
	{
		id: 'brushed',
		label: 'Brushed metal with rust stains',
		tags: ['metal', 'tech', 'base', 'panel', 'rust'],
		requires: ['drips'],
		build: (a, ctx) => {
			// Brushed metal (FR7.7): streaks `len` long and 2 px wide (scale = W / len, stretch = width / len), levels widening the
			// contrast; water stains with rust trails and paint blisters from the same sources.
			const vertical = a.edgeX >= a.edgeY;
			return base(
				a,
				ctx,
				'Brushed metal',
				{
					relief: [dents(a, 0.08)],
					paint: [
						L('noise', 'Mottle', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 8),
							octaves: 4,
							seed: 5,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0.2, 0.7)
						}),
						L('noise', 'Brushed', {
							noise: 'value',
							fractal: 'fbm',
							...streaks(a, vertical, (vertical ? a.height : a.width) * 0.3, 2),
							octaves: 2,
							gain: 0.55,
							seed: 7,
							sh_lo: 0.32,
							sh_hi: 0.68,
							h_on: false,
							dif_on: true,
							dif_opacity: 0.8,
							dif_grad: paletteRamp(a, 0.3, 0.9)
						}),
						speckle(0.2),
						...stains(a, { blisters: true }),
						grime(a, 1.5, 0.25)
					]
				},
				METAL
			);
		}
	},
	{
		id: 'hammered',
		label: 'Hammered metal (copper, bronze)',
		tags: ['metal', 'copper', 'bronze', 'hammered'],
		requires: ['hammered'],
		build: (a, ctx) => {
			// Hammered copper (FR7.7): interlocking radial arcs of dents in relief; the same pattern (tied) tones the dents.
			// Dent spacing from the measured periods (dents repeat at about that pitch), else 7 px.
			const periods = [a.periodX, a.periodY].filter((v) => v > 0);
			const spacing = periods.length
				? r2(clamp((1.3 * periods.reduce((x, y) => x + y, 0)) / periods.length, 4, 14))
				: 7;
			const hammer = {
				centres: Math.max(1, Math.round((a.width * a.height) / 2048)),
				weight_var: 0.5,
				ring: r2(spacing * 0.85),
				spacing,
				jitter: 0.12,
				wobble: 0.3,
				size_var: 0.2,
				depth_var: 0.2,
				tilt: 0.5,
				overlap: 0.6,
				size: 1.1,
				shape: 4,
				seed: 3
			};
			const patina = greenest(a);
			return base(
				a,
				ctx,
				'Hammered',
				{
					relief: [
						L('hammered', 'Hammer', {
							...hammer,
							h_on: true,
							h_amount: 0.4,
							dif_on: false,
							r_on: true,
							r_mode: 'replace',
							r_src: 'flat',
							r_a: 0.55,
							r_b: 0.55,
							s_on: true,
							s_mode: 'replace',
							s_src: 'flat',
							s_a: 0.3,
							s_b: 0.3
						}),
						L('blur', 'Soften', { radius: 0.5, ...HEIGHT_ONLY })
					],
					paint: [
						L('noise', 'Metal', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 6),
							octaves: 4,
							seed: 5,
							h_on: false,
							dif_on: true,
							dif_grad: bareRamp(a, patina)
						}),
						L('hammered', 'Dent tone', {
							...hammer,
							h_on: false,
							dif_on: true,
							dif_blend: 'multiply',
							dif_grad: {
								stops: [
									{ pos: 0, color: '#ffffff' },
									{ pos: 0.6, color: '#ece0d6' },
									{ pos: 1, color: '#b8a090' }
								]
							}
						}),
						...(patina
							? [
									L('noise', 'Patina', {
										noise: 'perlin',
										fractal: 'fbm',
										scale: 4,
										octaves: 4,
										seed: 6,
										sh_cut: 0.6,
										sh_cut_soft: 0.1,
										h_on: false,
										dif_on: true,
										dif_opacity: 0.9,
										dif_grad: ramp(mix(patina, '#000000', 0.25), patina)
									})
								]
							: []),
						speckle(0.45),
						L('cavity', 'Dents', {
							radius: 2,
							threshold: 0.03,
							sensitivity: 0.8,
							wear_amount: 0.4,
							wear_color: pick(a, 0.9),
							dirt_amount: 0.5,
							dirt_color: mix(pick(a, 0), '#000000', 0.3),
							noise_scale: 8
						})
					]
				},
				{ base: { roughness: 0.95, specular: 0 }, render: { specularTint: 1, ao: 0.5, aoRadius: 3 } }
			);
		}
	},

	// ---------------------------------------------------------------- floors
	{
		id: 'tiles',
		label: 'Floor tiles',
		tags: ['tile', 'floor', 'marble'],
		requires: ['tiles'],
		build: (a, ctx) => {
			const [count_x, count_y] = counts(a, 32, 32);
			return base(
				a,
				ctx,
				'Tiles',
				{
					relief: [lumps(a, 12, 0.12, false)],
					paint: [
						L('tiles', 'Tiles', {
							...squares(a, count_x, count_y),
							...phase(a),
							gap: 1,
							bevel: 1.5,
							profile: 'round',
							aa: false,
							rnd_mode: 'random',
							h_on: true,
							h_amount: 0.3,
							dif_on: true,
							dif_src: 'random',
							dif_grad: paletteRamp(a, 0.2, 1)
						}),
						L('noise', 'Veins', {
							noise: 'perlin',
							fractal: 'turbulence',
							scale: 3,
							octaves: 5,
							warp: 0.6,
							seed: 11,
							h_on: false,
							dif_on: true,
							dif_blend: 'overlay',
							dif_opacity: 0.45,
							dif_grad: ramp('#000000', '#ffffff')
						}),
						grime(a, 1.5)
					]
				},
				withBase({ ...GLOSSY, render: { ...GLOSSY.render, ao: 0.8, aoRadius: 3 } }, { color: pick(a, 0) })
			);
		}
	},
	{
		id: 'checker2',
		label: 'Two-tone alternating tiles',
		tags: ['tile', 'floor', 'marble'],
		requires: ['tiles', 'grid'],
		build: (a, ctx) => {
			const [count_x, count_y] = counts(a, 32, 32);
			return base(
				a,
				ctx,
				'Two-tone tiles',
				{
					relief: [lumps(a, 12, 0.1, false)],
					paint: [
						L('tiles', 'Tones', {
							...squares(a, count_x, count_y),
							output: 'value',
							gap: 0,
							...phase(a),
							h_on: false,
							dif_on: true,
							dif_grad: ramp(pick(a, 0.15), pick(a, 0.85))
						}),
						L('grid', 'Joints', {
							count_x,
							count_y,
							...phase(a),
							width: 1,
							bevel: 1,
							aa: false,
							h_on: true,
							h_mode: 'subtract',
							h_amount: 0.4,
							dif_on: true,
							dif_src: 'flat',
							dif_grad: ramp(pick(a, 0.5)),
							dif_opacity: 0.6
						}),
						L('noise', 'Veins', {
							noise: 'perlin',
							fractal: 'ridged',
							scale: 3,
							octaves: 5,
							warp: 0.8,
							seed: 11,
							h_on: false,
							dif_on: true,
							dif_blend: 'screen',
							dif_opacity: 0.5,
							dif_grad: ramp('#000000', pick(a, 1))
						}),
						grime(a, 1.5)
					]
				},
				withBase(GLOSSY, { color: pick(a, 0.5) })
			);
		}
	},
	{
		id: 'planks',
		label: 'Wood planks',
		tags: ['wood', 'plank', 'floor', 'crate'],
		requires: ['stripes'],
		build: (a, ctx) => {
			const vertical = a.edgeX > a.edgeY;
			const grain = {
				noise: 'value',
				fractal: 'fbm',
				...streaks(a, vertical, (vertical ? a.height : a.width) * 0.4, 3),
				octaves: 4,
				seed: 16
			};
			return base(
				a,
				ctx,
				'Planks',
				{
					// The grain's relief and colour are one pattern (tied): ridges catch the light where the grain is light.
					relief: [
						L('noise', 'Grain relief', {
							...grain,
							h_on: true,
							h_amount: 0.1,
							dif_on: false,
							s_on: true,
							s_mode: 'multiply',
							s_src: 'value',
							s_a: 0.3,
							s_b: 1
						})
					],
					paint: [
						L('noise', 'Grain', { ...grain, h_on: false, dif_on: true, dif_grad: paletteRamp(a, 0.1, 0.9) }),
						L('noise', 'Fibres', {
							noise: 'value',
							fractal: 'fbm',
							...streaks(a, vertical, (vertical ? a.height : a.width) * 0.2, 1),
							octaves: 2,
							seed: 17,
							h_on: false,
							dif_on: true,
							dif_blend: 'overlay',
							dif_opacity: 0.3,
							dif_grad: ramp('#000000', '#ffffff')
						}),
						L('stripes', 'Plank gaps', {
							mode: 'shape',
							count: vertical ? counts(a, 16, 16)[0] : counts(a, 16, 16)[1],
							angle: vertical ? 90 : 0,
							...phase(a),
							duty: 0.06,
							bevel: 0.5,
							aa: false,
							sh_invert: false,
							h_on: true,
							h_mode: 'subtract',
							h_amount: 0.4,
							dif_on: true,
							dif_src: 'flat',
							dif_grad: ramp(pick(a, 0)),
							dif_opacity: 0.85
						}),
						grime(a, 1.5)
					]
				},
				{ base: { roughness: 0.85, specular: 0.2 }, render: { ao: 0.8, aoRadius: 3 } }
			);
		}
	},

	// ---------------------------------------------------------------- liquids and lights
	{
		id: 'liquid',
		label: 'Lava / slime / water',
		tags: ['lava', 'water', 'slime', 'liquid', 'glow'],
		requires: ['voronoi'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Liquid',
				{
					relief: [
						L('noise', 'Swell', {
							noise: 'perlin',
							fractal: 'fbm',
							scale: 2,
							octaves: 3,
							seed: 25,
							h_on: true,
							h_amount: 0.3,
							dif_on: false
						})
					],
					paint: [
						L('voronoi', 'Cells', {
							output: 'edges',
							scale: 4,
							jitter: 1,
							warp: 3,
							warp_scale: 4,
							seed: 26,
							h_on: true,
							h_amount: 0.2,
							dif_on: true,
							dif_grad: paletteRamp(a, 0, 1),
							e_on: true,
							e_intensity: 0.6,
							e_color: pick(a, 1)
						}),
						L('noise', 'Swirl', {
							noise: 'perlin',
							fractal: 'fbm',
							scale: 3,
							octaves: 4,
							warp: 1,
							seed: 27,
							h_on: false,
							dif_on: true,
							dif_blend: 'overlay',
							dif_opacity: 0.4,
							dif_grad: ramp('#000000', '#ffffff')
						})
					]
				},
				withBase({ ...GLOSSY, base: { roughness: 0.3, specular: 0.5 } }, { color: pick(a, 0.2) })
			)
	},
	{
		id: 'trim',
		label: 'Horizontal trim / strip',
		tags: ['trim', 'strip'],
		requires: ['stripes'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Trim',
				{
					relief: [dents(a, 0.06)],
					paint: [
						L('noise', 'Brushed', {
							noise: 'value',
							fractal: 'fbm',
							...streaks(a, false, a.width * 0.4, 2),
							octaves: 2,
							seed: 7,
							sh_lo: 0.32,
							sh_hi: 0.68,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0.2, 0.8)
						}),
						L('rect', 'Band', {
							size_mode: 'inset',
							inset_x: -2,
							inset_y: Math.max(1, Math.round(a.height / 4)),
							radius: 0,
							bevel: 1.5,
							profile: 'round',
							aa: false,
							h_on: true,
							h_amount: 0.5,
							dif_on: true,
							dif_src: 'value',
							dif_grad: ramp(pick(a, 0.3), pick(a, 0.9))
						}),
						L('rect', 'Edges', {
							size_mode: 'size',
							width: a.width + 4,
							height: 1,
							y: 0.02,
							radius: 0,
							bevel: 0,
							profile: 'flat',
							aa: false,
							rep_y: 1,
							mk_target: '',
							h_on: true,
							h_mode: 'subtract',
							h_amount: 0.3,
							dif_on: true,
							dif_src: 'flat',
							dif_grad: ramp(pick(a, 0))
						}),
						grime(a, 1)
					]
				},
				METAL
			)
	},
	{
		id: 'light',
		label: 'Light fixture',
		tags: ['light', 'glow'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Light',
				{
					relief: [dents(a, 0.06)],
					paint: [
						L('noise', 'Housing', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 10),
							octaves: 3,
							seed: 8,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0, 0.5)
						}),
						L('rect', 'Frame', {
							size_mode: 'inset',
							inset_x: Math.round(a.width * 0.15),
							inset_y: Math.round(a.height * 0.15),
							radius: 2,
							bevel: 2,
							profile: 'round',
							aa: false,
							h_on: true,
							h_amount: 0.4,
							dif_on: true,
							dif_src: 'flat',
							dif_grad: ramp(pick(a, 0.3))
						}),
						L('rect', 'Lamp', {
							size_mode: 'inset',
							inset_x: Math.round(a.width * 0.25),
							inset_y: Math.round(a.height * 0.25),
							radius: 2,
							bevel: 1,
							aa: false,
							mk_target: '',
							h_on: false,
							dif_on: true,
							dif_src: 'flat',
							dif_grad: ramp(pick(a, 1)),
							e_on: true,
							e_src: 'flat',
							e_color: pick(a, 1),
							e_intensity: 1.2
						})
					]
				},
				{ ...METAL, render: { ...METAL.render, ao: 0.8 } }
			)
	}
];

// ------------------------------------------------------------------------------------------------ FR7.2 greebles

TEMPLATES.push(
	{
		id: 'greeble',
		label: 'Tech greebles (machinery panels)',
		tags: ['tech', 'panel', 'machine', 'comp'],
		requires: ['greebles'],
		build: (a, ctx) => {
			// One panel layout (tied): the panels with their height and colour, and their lights.
			const layout = {
				// Depth 5: pinwheel splits make five panels a level, so this keeps some big plates among the small ones.
				depth: 5,
				min_size: 4,
				max_size: 24,
				split: 0.75,
				split_var: 0.8,
				snap: 2,
				gap: 1,
				levels: 4,
				height_var: 0.6,
				frame_chance: 0.3,
				frame_inset: 2,
				frame_style: 'recess',
				rivets: 'corners',
				rivet_chance: 0.3,
				rivet_radius: 0.5,
				rivet_inset: 1.5,
				detail_chance: 0.5,
				det_size: 0.7,
				vent_pitch: 2,
				vent_slot: 1,
				light_size: 2,
				seed: 9,
				aa: false
			};
			return base(
				a,
				ctx,
				'Greebles',
				{
					relief: [dents(a, 0.06)],
					paint: [
						L('noise', 'Grime', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 5),
							octaves: 4,
							seed: 8,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0, 0.6)
						}),
						L('greebles', 'Panels', {
							...layout,
							bevel: 1,
							profile: 'linear',
							h_on: true,
							h_amount: 0.6,
							dif_on: true,
							dif_src: 'value',
							dif_grad: paletteRamp(a, 0, 1),
							dif_jitter: 0.3
						}),
						...(a.glow > 0.005
							? [
									L('greebles', 'Lights', {
										...layout,
										output: 'lights',
										mk_target: '',
										bevel: 0,
										profile: 'flat',
										h_on: false,
										dif_on: true,
										dif_src: 'flat',
										dif_grad: ramp(pick(a, 1)),
										e_on: true,
										e_src: 'flat',
										e_intensity: 1.2,
										e_color: pick(a, 1)
									})
								]
							: []),
						speckle(0.12)
					]
				},
				{ ...METAL, render: { ...METAL.render, ao: 0.8 } }
			);
		}
	},
	{
		id: 'vents',
		label: 'Vents / grates / slots',
		tags: ['vent', 'grate', 'slot', 'grill'],
		requires: ['vents'],
		build: (a, ctx) => {
			const horizontal = a.edgeY >= a.edgeX;
			const [cx, cy] = counts(a, 16, 8);
			return base(
				a,
				ctx,
				'Vents',
				{
					relief: [dents(a, 0.06)],
					paint: [
						L('noise', 'Metal', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 10),
							octaves: 4,
							seed: 8,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0.3, 0.9)
						}),
						L('vents', 'Slots', {
							mode: 'slots',
							orient: horizontal ? 'horizontal' : 'vertical',
							cols: horizontal ? Math.max(1, Math.round(cx / 2)) : cx,
							rows: horizontal ? cy : Math.max(1, Math.round(cy / 2)),
							length: horizontal
								? a.width / Math.max(1, Math.round(cx / 2)) - 4
								: a.height / Math.max(1, Math.round(cy / 2)) - 4,
							width: 2,
							ends: 'round',
							margin: 0,
							bevel: 1,
							profile: 'linear',
							aa: false,
							h_on: true,
							h_amount: 0.6,
							dif_on: true,
							dif_src: 'value',
							dif_grad: ramp(pick(a, 0), pick(a, 0.7))
						}),
						grime(a, 1.5)
					]
				},
				{ ...METAL, render: { ...METAL.render, ao: 1 } }
			);
		}
	},
	{
		id: 'pipes',
		label: 'Pipes / conduits',
		tags: ['pipe', 'tech', 'conduit'],
		requires: ['pipes'],
		build: (a, ctx) => {
			const horizontal = a.edgeY >= a.edgeX;
			const period = horizontal ? a.periodY : a.periodX;
			const span = horizontal ? a.height : a.width;
			return base(
				a,
				ctx,
				'Pipes',
				{
					paint: [
						L('noise', 'Grime', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 8),
							octaves: 4,
							seed: 8,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0, 0.5)
						}),
						L('pipes', 'Pipes', {
							orient: horizontal ? 'horizontal' : 'vertical',
							count: period ? Math.max(1, Math.round(span / period)) : 3,
							diameter: period ? Math.max(3, period * 0.8) : 8,
							clamps: 2,
							bevel: 2,
							profile: 'round',
							aa: false,
							h_on: true,
							h_amount: 0.8,
							dif_on: true,
							dif_src: 'value',
							dif_grad: ramp(pick(a, 0.2), pick(a, 0.7), pick(a, 1)),
							// A reference's pipe bank: even pipes in the flat 0..1 relief, clamp rings at their own place per run.
							scale: 'unit',
							dia_var: 0,
							jitter: 0,
							joints: 0,
							clamp_foot: 0,
							clamp_rel: false,
							clamp_jitter: 1,
							clamp_seeded: false
						}),
						grime(a, 1.5)
					]
				},
				withBase({ ...METAL, render: { ...METAL.render, ao: 0.8 } }, { color: pick(a, 0) })
			);
		}
	},
	{
		id: 'trimbands',
		label: 'Banded trim strip',
		tags: ['trim', 'strip'],
		requires: ['trim'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Trim bands',
				{
					relief: [dents(a, 0.06)],
					paint: [
						L('noise', 'Brushed', {
							noise: 'value',
							fractal: 'fbm',
							...streaks(a, false, a.width * 0.4, 2),
							octaves: 2,
							seed: 7,
							sh_lo: 0.32,
							sh_hi: 0.68,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0.2, 0.8)
						}),
						L('trim', 'Bands', {
							mirror: true,
							div_count: a.periodX ? Math.max(0, Math.round(a.width / a.periodX)) : 0,
							elem: 'rivet',
							elem_count: a.periodX ? Math.max(1, Math.round(a.width / a.periodX)) : 8,
							// Plates at the reference's period, one rivet per period: regular, counted (not by pitch).
							div_var: 0,
							elem_layout: 'even',
							elem_pitch: 0,
							bevel: 1,
							profile: 'linear',
							aa: false,
							h_on: true,
							h_amount: 0.6,
							dif_on: true,
							dif_src: 'value',
							dif_grad: paletteRamp(a, 0, 1)
						}),
						grime(a, 1)
					]
				},
				METAL
			)
	}
);

// ------------------------------------------------------------------------------------------------ FR7.2 organic + motif

TEMPLATES.push(
	{
		id: 'marble',
		label: 'Veined marble',
		tags: ['marble', 'stone', 'floor'],
		requires: ['marble'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Marble',
				{
					relief: [lumps(a, 16, 0.08, false)],
					paint: [
						L('marble', 'Marble', {
							style: 'streaks',
							veins: 3,
							warp: 0.5,
							width: 1,
							cloud: 0.35,
							h_on: false,
							dif_on: true,
							dif_grad: a.meanL > 0.55 ? paletteRamp(a, 1, 0) : paletteRamp(a, 0, 1),
							r_on: true,
							r_a: 0.25,
							r_b: 0.45
						}),
						speckle(0.1)
					]
				},
				GLOSSY
			)
	},
	{
		id: 'marbletiles',
		label: 'Marble tiles',
		tags: ['marble', 'tile', 'floor'],
		requires: ['marble', 'tiles', 'grid'],
		build: (a, ctx) => {
			const [cx, cy] = counts(a, 32, 32);
			return base(
				a,
				ctx,
				'Marble tiles',
				{
					relief: [lumps(a, 16, 0.08, false)],
					paint: [
						L('marble', 'Marble', {
							style: 'streaks',
							veins: 3,
							warp: 0.6,
							tiles: cx,
							tile_rot: 90,
							dif_on: true,
							dif_grad: paletteRamp(a, 0.1, 1),
							h_on: false
						}),
						L('tiles', 'Tone', {
							...squares(a, cx, cy),
							output: 'value',
							gap: 0,
							...phase(a),
							h_on: false,
							dif_on: true,
							dif_blend: 'multiply',
							dif_grad: ramp('#ffffff', pick(a, 0.35)),
							dif_opacity: 0.8
						}),
						L('grid', 'Joints', {
							count_x: cx,
							count_y: cy,
							...phase(a),
							width: 1,
							bevel: 1,
							aa: false,
							h_on: true,
							h_mode: 'subtract',
							h_amount: 0.3,
							dif_on: true,
							dif_src: 'flat',
							dif_grad: ramp(pick(a, 0.4)),
							dif_opacity: 0.5
						})
					]
				},
				{ ...GLOSSY, render: { ...GLOSSY.render, ao: 0.8, aoRadius: 3 } }
			);
		}
	},
	{
		id: 'caustics',
		label: 'Caustic liquid (water, slime, lava net)',
		tags: ['lava', 'water', 'slime', 'liquid', 'glow'],
		requires: ['caustics'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Caustics',
				{
					relief: [
						L('noise', 'Swell', {
							noise: 'perlin',
							fractal: 'fbm',
							scale: 2,
							octaves: 3,
							seed: 25,
							h_on: true,
							h_amount: 0.25,
							dif_on: false
						})
					],
					paint: [
						L('caustics', 'Liquid', {
							mode: 'net',
							scale: 5,
							warp: 0.3,
							rim: 1,
							h_on: true,
							h_mode: 'subtract',
							h_amount: 0.3,
							dif_on: true,
							dif_grad: paletteRamp(a, 0, 1),
							e_on: a.glow > 0.01,
							e_color: pick(a, 1),
							e_intensity: 0.5
						})
					]
				},
				withBase({ ...GLOSSY, base: { roughness: 0.3, specular: 0.5 } }, { color: pick(a, 0.1) })
			)
	},
	{
		id: 'blobs',
		label: 'Blobby lava / goo',
		tags: ['lava', 'slime', 'liquid', 'glow'],
		requires: ['caustics'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Blobs',
				{
					paint: [
						L('caustics', 'Blobs', {
							mode: 'blobs',
							scale: 4,
							warp: 0.4,
							round: 0.8,
							h_on: true,
							h_mode: 'add',
							h_amount: 0.4,
							dif_on: true,
							dif_grad: paletteRamp(a, 0, 1),
							e_on: a.glow > 0.01,
							e_color: pick(a, 1),
							e_intensity: 0.5
						})
					]
				},
				withBase({ ...GLOSSY, base: { roughness: 0.35, specular: 0.5 } }, { color: pick(a, 0) })
			)
	},
	{
		id: 'wood',
		label: 'Wood boards with grain',
		tags: ['wood', 'plank', 'floor', 'crate'],
		requires: ['wood'],
		build: (a, ctx) => {
			const vertical = a.edgeX > a.edgeY;
			const period = vertical ? a.periodX : a.periodY;
			const span = vertical ? a.width : a.height;
			return base(
				a,
				ctx,
				'Wood',
				{
					paint: [
						L('wood', 'Boards', {
							direction: vertical ? 'vertical' : 'horizontal',
							count: period ? Math.max(1, Math.round(span / period)) : 4,
							gap: 1,
							joints: 1,
							bevel: 1,
							profile: 'round',
							aa: false,
							h_on: true,
							h_amount: 0.3,
							dif_on: true,
							dif_grad: paletteRamp(a, 0, 1),
							dif_jitter: 0.2
						}),
						grime(a, 1)
					]
				},
				{ base: { roughness: 0.85, specular: 0.2 }, render: { ao: 0.8, aoRadius: 3 } }
			);
		}
	},
	{
		id: 'scales',
		label: 'Overlapping scales',
		tags: ['scale', 'metal', 'roof'],
		requires: ['scales'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Scales',
				{
					relief: [lumps(a, 8, 0.12, false)],
					paint: [
						L('scales', 'Scales', {
							columns: a.periodX ? Math.max(1, Math.round(a.width / a.periodX)) : 2,
							rows: 0,
							outline: 1,
							dome: 0.6,
							// Regular rows, as the reference's measured period has them (Irregularity, Edge wobble and the row curve would
							// blur the match).
							jitter: 0,
							size_var: 0,
							wobble: 0,
							dw_amount: 0,
							bevel: 2,
							profile: 'round',
							aa: false,
							h_on: true,
							h_amount: 0.5,
							dif_on: true,
							dif_grad: paletteRamp(a, 0, 1),
							dif_jitter: 0.15
						}),
						speckle(0.15),
						grime(a, 1.5)
					]
				},
				{ ...METAL, render: { ...METAL.render, ao: 0.8 } }
			)
	},
	{
		id: 'cracks',
		label: 'Cracked plates (mud, lava crust)',
		tags: ['cracks', 'mud', 'lava', 'rock', 'dirt'],
		requires: ['cracks'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Cracks',
				{
					relief: [lumps(a, 6, 0.2, false)],
					paint: [
						L('cracks', 'Plates', {
							// The editor's size-dependent defaults (crack widths, zig-zag, bevel; fewer fine cracks on small textures).
							...freshParams('cracks', { width: a.width, height: a.height }),
							scale: 4,
							sub: 0.4,
							h_on: true,
							h_amount: 0.3,
							dif_on: true,
							dif_grad: paletteRamp(a, 0, 1),
							dif_jitter: 0.15,
							e_on: a.glow > 0.01,
							e_color: pick(a, 1),
							e_intensity: 0.4,
							e_src: 'value',
							sh_invert: a.glow > 0.01
						}),
						L('noise', 'Grain', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 3),
							octaves: 3,
							seed: 23,
							h_on: false,
							dif_on: true,
							dif_blend: 'overlay',
							dif_opacity: 0.35,
							dif_grad: ramp('#000000', '#ffffff')
						})
					]
				},
				{ base: { color: pick(a, 0), roughness: 0.9, specular: 0.25 }, render: { ao: 0.8, aoRadius: 3 } }
			)
	},
	{
		id: 'circuit',
		label: 'Circuit traces',
		tags: ['tech', 'circuit', 'computer'],
		requires: ['truchet'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Circuit',
				{
					paint: [
						L('noise', 'Board', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 10),
							octaves: 3,
							seed: 8,
							h_on: false,
							dif_on: true,
							dif_grad: ramp(pick(a, 0), pick(a, 0.25))
						}),
						L('truchet', 'Traces', {
							style: 'circuit',
							cells: a.periodX ? Math.max(4, Math.round(a.width / a.periodX)) : 16,
							width: 1,
							regions: 6,
							pad: 1,
							vias: 0.3,
							empty: 0.1,
							wide: 0,
							bevel: 0.5,
							aa: false,
							h_on: true,
							h_amount: 0.3,
							dif_on: true,
							dif_src: 'flat',
							dif_grad: ramp(pick(a, 1)),
							e_on: a.glow > 0.005,
							e_src: 'flat',
							e_color: pick(a, 1),
							e_intensity: 0.4,
							s_on: true,
							s_mode: 'replace',
							s_src: 'flat',
							s_a: 0.5,
							s_b: 0.5
						})
					]
				},
				withBase(METAL, { color: pick(a, 0) })
			)
	},
	{
		id: 'maze',
		label: 'Maze / meander lines',
		tags: ['maze', 'meander', 'lines', 'tech'],
		requires: ['truchet'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Maze',
				{
					paint: [
						L('truchet', 'Lines', {
							style: 'rooms',
							cells: a.periodX ? Math.max(2, Math.round(a.width / a.periodX)) : 8,
							width: 1,
							density: 0.7,
							bevel: 0.5,
							aa: false,
							h_on: true,
							h_amount: 0.3,
							dif_on: true,
							dif_src: 'flat',
							dif_grad: ramp(pick(a, 1))
						})
					]
				},
				withBase(METAL, { color: pick(a, 0) })
			)
	},
	{
		id: 'disc',
		label: 'Glowing disc / medallion',
		tags: ['light', 'glow', 'teleport', 'medallion'],
		requires: ['rosette'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Disc',
				{
					paint: [
						L('noise', 'Surround', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 10),
							octaves: 3,
							seed: 8,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0, 0.4)
						}),
						L('rosette', 'Disc', {
							output: 'glow',
							radius: Math.min(a.width, a.height) * 0.42,
							rings: 2,
							star: 0,
							hub: 0,
							dots: 0,
							h_on: true,
							h_amount: 0.3,
							dif_on: true,
							dif_src: 'value',
							dif_grad: paletteRamp(a, 0.2, 1),
							e_on: a.glow > 0.005,
							e_src: 'value',
							e_color: pick(a, 1),
							e_intensity: 0.8
						})
					]
				},
				METAL
			)
	},
	{
		id: 'carpet',
		label: 'Ornamental carpet / inlay (kaleidoscope)',
		tags: ['carpet', 'ornament', 'tile', 'fancy'],
		requires: ['symmetry'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Carpet',
				{
					paint: [
						L('noise', 'Motif', {
							noise: 'perlin',
							fractal: 'fbm',
							scale: 3,
							octaves: 4,
							seed: 18,
							sh_steps: 4,
							h_on: true,
							h_amount: 0.1,
							dif_on: true,
							dif_grad: paletteRamp(a, 0, 1)
						}),
						L('noise', 'Weave', {
							noise: 'white',
							seed: 15,
							h_on: false,
							dif_on: true,
							dif_blend: 'overlay',
							dif_opacity: 0.2,
							dif_grad: ramp('#000000', '#ffffff')
						}),
						L('symmetry', 'Kaleidoscope', {
							mode: 'square8',
							cells_x: a.periodX ? Math.max(1, Math.round(a.width / a.periodX)) : 1,
							cells_y: a.periodY ? Math.max(1, Math.round(a.height / a.periodY)) : 1
						})
					]
				},
				{ base: { roughness: 0.95 } }
			)
	},
	{
		id: 'emblem',
		label: 'Emblem / rune panel',
		tags: ['emblem', 'rune', 'sigil', 'panel'],
		requires: ['glyph'],
		build: (a, ctx) =>
			base(
				a,
				ctx,
				'Emblem',
				{
					relief: [dents(a, 0.06)],
					paint: [
						L('noise', 'Plate', {
							noise: 'value',
							fractal: 'fbm',
							scale: across(a, 12),
							octaves: 4,
							seed: 8,
							h_on: false,
							dif_on: true,
							dif_grad: paletteRamp(a, 0.2, 0.7)
						}),
						L('rect', 'Frame', {
							size_mode: 'inset',
							inset_x: 3,
							inset_y: 3,
							radius: 0,
							outline: 2,
							bevel: 1,
							aa: false,
							mk_target: '',
							h_on: true,
							h_amount: 0.3,
							dif_on: true,
							dif_src: 'flat',
							dif_grad: ramp(pick(a, 0.15))
						}),
						L('glyph', 'Glyph', {
							size: Math.min(a.width, a.height) * 0.55,
							width: 2,
							strokes: 4,
							mirror: true,
							bevel: 1,
							aa: false,
							h_on: true,
							h_amount: 0.35,
							dif_on: true,
							dif_src: 'flat',
							dif_grad: ramp(pick(a, 0.05))
						}),
						grime(a, 1.5)
					]
				},
				METAL
			)
	}
);

export function availableTemplates(): Template[] {
	return TEMPLATES.filter((t) => (t.requires ?? []).every((type) => getLayerDef(type)));
}

/** Templates whose tags match a family hint, or all of them. */
export function templatesFor(tags: string[] = []): Template[] {
	const all = availableTemplates();
	if (!tags.length) return all;
	const hit = all.filter((t) => t.tags.some((g) => tags.includes(g)));
	return hit.length ? hit : all;
}
