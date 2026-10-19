// Colour schemes for the new-project wizard, turned into a synthetic Analysis so the reference templates
// (templates.ts) can build from it without a reference image.
//
// A texture's palette is one or two colours in many values and saturations — not a background / primary / accent
// set — and the colours belong to the material: stone is brown, sandy, warm grey or slate, never green; lava is never
// blue. So each template has a Look: the hue ranges its main colour may take (with how saturated it can be), sometimes
// a minor colour (rust on steel, verdigris on copper, gold in a carpet), sometimes a glow or highlight hue for the
// lightest value (a light fixture's tube, circuit traces, lava's cores), and its value range. A scheme draws one hue
// and chroma from those, then seven values from deep shadow to highlight, each at its own saturation (ramps carry
// less chroma at their ends) with a little hue drift; every third value comes from the minor colour. Colours are
// OKLab, brought into the sRGB gamut by lowering their chroma.

import { hexToRgb, linearToOklab, linearToSrgb, oklabToLinear, rgbToHex, srgbToLinear1, type RGB } from '@/core/color';
import { TONE_RANKS, type Analysis } from './analyze';

type Range = [number, number];

/** A colour family: OKLab hue range in degrees (from > to wraps through 0) and the chroma of its fullest value. */
interface Hue {
	h: Range;
	c: Range;
	/** This family's own highlight for the lightest value (lava's yellow cores). */
	top?: Hue;
}

export interface Look {
	/** The main colour: one of these families. */
	main: Hue[];
	/** A second, minor colour (every third value), with its chance. */
	minor?: { chance: number; hues: Hue[] };
	/** The lightest value from one of these families: a glow or a highlight (light fixtures, traces). */
	top?: Hue[];
	/** Values, deep shadow → highlight (OKLab L). */
	L: Range;
}

export interface Scheme {
	/** The look it was drawn from. */
	look: string;
	/** The most saturated colour of the main hue. */
	accent: string;
	/** Dark → light. */
	palette: string[];
}

const STEEL: Hue = { h: [220, 260], c: [0.004, 0.025] };
const WARM_GREY: Hue = { h: [60, 95], c: [0.002, 0.018] };
const RUST: Hue = { h: [40, 62], c: [0.06, 0.11] };

export const LOOKS: Record<string, Look> = {
	stone: {
		main: [{ h: [45, 85], c: [0.015, 0.05] }, WARM_GREY, { h: [225, 265], c: [0.008, 0.03] }],
		minor: {
			chance: 0.25,
			hues: [
				{ h: [40, 70], c: [0.03, 0.06] },
				{ h: [220, 260], c: [0.01, 0.03] }
			]
		},
		L: [0.2, 0.8]
	},
	brick: {
		main: [
			{ h: [25, 48], c: [0.06, 0.12] },
			{ h: [55, 80], c: [0.05, 0.09] },
			{ h: [40, 70], c: [0.02, 0.05] }
		],
		minor: { chance: 0.3, hues: [WARM_GREY] },
		L: [0.18, 0.72]
	},
	metal: {
		main: [STEEL, WARM_GREY, { h: [95, 120], c: [0.01, 0.035] }],
		minor: { chance: 0.35, hues: [RUST] },
		L: [0.16, 0.85]
	},
	rusty: { main: [STEEL, WARM_GREY], minor: { chance: 1, hues: [RUST] }, L: [0.16, 0.82] },
	copper: {
		main: [
			{ h: [45, 65], c: [0.07, 0.12] },
			{ h: [70, 90], c: [0.06, 0.1] }
		],
		minor: { chance: 0.3, hues: [{ h: [160, 185], c: [0.04, 0.07] }] },
		L: [0.2, 0.85]
	},
	tiles: {
		main: [
			{ h: [30, 50], c: [0.06, 0.1] },
			{ h: [75, 95], c: [0.01, 0.04] },
			{ h: [230, 260], c: [0.02, 0.05] },
			{ h: [150, 190], c: [0.03, 0.07] }
		],
		minor: { chance: 0.3, hues: [WARM_GREY] },
		L: [0.2, 0.85]
	},
	marble: {
		main: [
			{ h: [70, 95], c: [0.002, 0.025] },
			{ h: [20, 40], c: [0.03, 0.06] },
			{ h: [150, 170], c: [0.03, 0.06] },
			{ h: [240, 270], c: [0.004, 0.02] }
		],
		minor: { chance: 0.3, hues: [{ h: [75, 95], c: [0.05, 0.09] }] },
		L: [0.25, 0.95]
	},
	wood: {
		main: [{ h: [50, 75], c: [0.05, 0.11] }],
		minor: { chance: 0.15, hues: [{ h: [30, 45], c: [0.05, 0.09] }] },
		L: [0.16, 0.72]
	},
	liquid: {
		main: [
			{ h: [25, 55], c: [0.14, 0.2], top: { h: [85, 105], c: [0.12, 0.17] } }, // lava
			{ h: [125, 150], c: [0.12, 0.18] }, // slime
			{ h: [200, 250], c: [0.06, 0.12] }, // water
			{ h: [100, 125], c: [0.1, 0.16] } // nukage
		],
		L: [0.1, 0.88]
	},
	crust: {
		main: [
			{ h: [50, 80], c: [0.02, 0.06] },
			{ h: [20, 50], c: [0.02, 0.05], top: { h: [40, 70], c: [0.15, 0.2] } }
		],
		L: [0.12, 0.75]
	},
	light: {
		main: [STEEL, WARM_GREY],
		top: [
			{ h: [60, 100], c: [0.02, 0.08] },
			{ h: [190, 230], c: [0.06, 0.12] },
			{ h: [20, 40], c: [0.1, 0.18] },
			{ h: [130, 150], c: [0.1, 0.16] }
		],
		L: [0.15, 0.7]
	},
	circuit: {
		main: [{ h: [140, 165], c: [0.05, 0.1] }, { h: [230, 265], c: [0.04, 0.09] }, WARM_GREY],
		top: [
			{ h: [75, 95], c: [0.08, 0.13] },
			{ h: [45, 60], c: [0.08, 0.12] }
		],
		L: [0.12, 0.6]
	},
	ornate: {
		main: [
			{ h: [20, 35], c: [0.1, 0.15] },
			{ h: [250, 275], c: [0.08, 0.13] },
			{ h: [145, 160], c: [0.07, 0.11] }
		],
		minor: { chance: 0.9, hues: [{ h: [80, 95], c: [0.08, 0.13] }] },
		L: [0.15, 0.85]
	}
};

/** Each template's look (by template id). */
export const TEMPLATE_LOOKS: Record<string, string> = {
	rough: 'stone',
	rocky: 'stone',
	cobbles: 'stone',
	blocks: 'stone',
	rubble: 'stone',
	carved: 'stone',
	bricks: 'brick',
	'bricks-v': 'brick',
	plate: 'metal',
	panelgrid: 'metal',
	riveted: 'metal',
	trim: 'metal',
	trimbands: 'metal',
	greeble: 'metal',
	vents: 'metal',
	pipes: 'metal',
	brushed: 'rusty',
	hammered: 'copper',
	scales: 'copper',
	tiles: 'tiles',
	checker2: 'tiles',
	marble: 'marble',
	marbletiles: 'marble',
	planks: 'wood',
	wood: 'wood',
	liquid: 'liquid',
	caustics: 'liquid',
	blobs: 'liquid',
	cracks: 'crust',
	light: 'light',
	disc: 'light',
	circuit: 'circuit',
	maze: 'circuit',
	carpet: 'ornate',
	emblem: 'ornate'
};

// ------------------------------------------------------------------------------------------------ colour

const lab = (hex: string) => linearToOklab(hexToRgb(hex).map(srgbToLinear1) as RGB);
const chromaOf = (hex: string) => Math.hypot(lab(hex)[1], lab(hex)[2]);

/** OKLab lightness / chroma / hue (degrees) → sRGB hex, chroma lowered until the colour is in gamut. */
function lch(L: number, C: number, hDeg: number): string {
	const h = (hDeg * Math.PI) / 180;
	const at = (c: number) => oklabToLinear([L, c * Math.cos(h), c * Math.sin(h)]);
	const fits = (c: number) => at(c).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
	let c = C;
	if (!fits(c)) {
		let lo = 0;
		for (let i = 0; i < 18; i++) {
			const m = (lo + c) / 2;
			if (fits(m)) lo = m;
			else c = m;
		}
		c = lo;
	}
	return rgbToHex(linearToSrgb(at(c).map((v) => Math.min(1, Math.max(0, v))) as RGB));
}

/** A small deterministic RNG (mulberry32): 0 ≤ r < 1. */
export function rng(seed: number): () => number {
	let t = seed >>> 0;
	return () => {
		t = (t + 0x6d2b79f5) >>> 0;
		let x = Math.imul(t ^ (t >>> 15), 1 | t);
		x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
}

const VALUES = 7;

/** A random scheme within a look. */
export function lookScheme(name: string, random: () => number): Scheme {
	const look = LOOKS[name] ?? LOOKS.stone;
	const pick = <T>(xs: T[]): T => xs[Math.floor(random() * xs.length)];
	const within = ([a, b]: Range) => a + (b - a) * random();
	const hueIn = ([a, b]: Range) => within([a, b < a ? b + 360 : b]) % 360;
	const main = pick(look.main);
	const h1 = hueIn(main.h);
	const c1 = within(main.c);
	const minor = look.minor && random() < look.minor.chance ? pick(look.minor.hues) : null;
	const h2 = minor ? hueIn(minor.h) : h1;
	const c2 = minor ? within(minor.c) : c1;
	const top = main.top ?? (look.top ? pick(look.top) : null);
	const [lo, hi] = look.L;
	const colours: string[] = [];
	const mains: string[] = [];
	for (let i = 0; i < VALUES; i++) {
		const t = i / (VALUES - 1);
		const L = lo + (hi - lo) * t + (random() - 0.5) * 0.04;
		if (top && i === VALUES - 1) {
			colours.push(lch(Math.max(L, 0.86), within(top.c), hueIn(top.h)));
			continue;
		}
		const isMinor = !!minor && i % 3 === 1;
		// Each value its own saturation; a ramp's darkest and lightest values carry less chroma.
		const sat = 0.35 + 0.75 * random();
		const ends = 1 - 0.5 * (2 * t - 1) ** 2;
		const hex = lch(L, (isMinor ? c2 : c1) * sat * ends, (isMinor ? h2 : h1) + (random() - 0.5) * 10);
		colours.push(hex);
		if (!isMinor) mains.push(hex);
	}
	const palette = [...new Set(colours)].sort((p, q) => lab(p)[0] - lab(q)[0]);
	const accent = mains.reduce((best, c) => (chromaOf(c) > chromaOf(best) ? c : best), mains[0]);
	return { look: name, accent, palette };
}

/** A random scheme for a template, within its look. */
export function templateScheme(templateId: string, random: () => number): Scheme {
	return lookScheme(TEMPLATE_LOOKS[templateId] ?? 'stone', random);
}

/**
 * A synthetic reference analysis for a scheme: its palette dark → light (equal weights), tones at the ranks a real
 * analysis measures, statistics from the palette, no detected periods (templates fall back to their own counts).
 * `glow` > 0 lets light-fixture and liquid templates switch their emission on.
 */
export function schemeAnalysis(scheme: Scheme, width: number, height: number, glow = 0): Analysis {
	const pal = scheme.palette;
	const labs = pal.map(lab);
	const n = pal.length;
	const meanL = labs.reduce((s, l) => s + l[0], 0) / n;
	const stdL = Math.sqrt(labs.reduce((s, l) => s + (l[0] - meanL) ** 2, 0) / n);
	return {
		width,
		height,
		tileable: true,
		tileX: true,
		tileY: true,
		palette: pal,
		weights: pal.map(() => 1 / n),
		tones: TONE_RANKS.map((t) => pal[Math.round(t * (n - 1))]),
		meanL,
		stdL,
		chroma: labs.reduce((s, l) => s + Math.hypot(l[1], l[2]), 0) / n,
		edgeX: 0.05,
		edgeY: 0.05,
		glow,
		periodX: 0,
		periodY: 0,
		periodXStrength: 0,
		periodYStrength: 0,
		phaseX: 0,
		phaseY: 0,
		hints: glow > 0 ? ['glow'] : []
	};
}
