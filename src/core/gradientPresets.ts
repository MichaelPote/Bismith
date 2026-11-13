// Built-in ramps for the right-click menus of ramp rows, by kind of field:
//  R    — a grey ramp of one value (Roughness, Specular, Metalness: At 0 … At 1), as fractions of the field's range;
//  RGB  — a colour ramp without opacity (Depth colour);
//  RGBA — a colour ramp whose stops have an opacity (ParamDef.alpha: the Diffuse colour ramp). It is offered the RGB
//         ramps too, and the R ones as its A channel (withOpacityRamp: the opacity runs along them, colours kept).
// The menus show the ramps themselves; `name` is only for screen readers and tests.
import { MAX_GRADIENT_STOPS, type Gradient, type GradientStop } from './params';
import { hexToRgb, rgbToHex } from './color';

export interface GreyPreset {
	name: string;
	/** At 0 and At 1, as fractions of the field's range. */
	a: number;
	b: number;
}

export interface ColourPreset {
	name: string;
	gradient: Gradient;
}

/** Evenly spaced opaque stops. */
const even = (...colors: string[]): Gradient => ({
	stops: colors.map((color, i) => ({ pos: colors.length === 1 ? 0 : i / (colors.length - 1), color }))
});

/** Stops as [pos, colour, opacity] (opacity 1 = none stored). */
const at = (...stops: [number, string, number?][]): Gradient => ({
	stops: stops.map(([pos, color, a = 1]) => ({ pos, color, ...(a < 1 ? { alpha: a } : {}) }))
});

const ramp = (name: string, gradient: Gradient): ColourPreset => ({ name, gradient });
const grey = (name: string, a: number, b: number): GreyPreset => ({ name, a, b });

/**
 * R fields, and the A channel of RGBA ones. Named for what they suit as a roughness; the same greys serve specular,
 * metalness and opacity.
 */
export const R_PRESETS: GreyPreset[] = [
	grey('Black', 0, 0),
	grey('Mid grey', 0.5, 0.5),
	grey('White', 1, 1),
	grey('Full', 0, 1),
	grey('Inverted', 1, 0),
	grey('Lower half', 0, 0.5),
	grey('Upper half', 0.5, 1),
	grey('Water', 0.02, 0.1),
	grey('Ice', 0.08, 0.3),
	grey('Polished', 0.15, 0.4),
	grey('Satin', 0.35, 0.6),
	grey('Rock', 0.55, 0.9),
	grey('Sand', 0.75, 0.92),
	grey('Moss', 0.85, 1),
	grey('Worn', 0.9, 0.5)
];

export const RGB_PRESETS: ColourPreset[] = [
	ramp('Black to white', even('#000000', '#ffffff')),
	ramp('Ice', even('#0b2a4a', '#1f6f9e', '#6cc3e0', '#cdeef7', '#ffffff')),
	ramp('Snow', even('#6f7f94', '#aebdcd', '#dfe8f0', '#ffffff')),
	ramp('Water', even('#04121f', '#0a3550', '#12657a', '#2d9aa0', '#8fd6cf')),
	ramp('Fire', even('#120200', '#5e0a00', '#c12a00', '#f27a0c', '#ffd25a', '#fff6d8')),
	ramp('Lava', at([0, '#141010'], [0.35, '#2b1a16'], [0.6, '#7a1a08'], [0.82, '#e84a0a'], [1, '#ffc23a'])),
	ramp('Rock', even('#2b2925', '#4d4a44', '#77726a', '#a39d93', '#c9c3b8')),
	ramp('Slate', even('#1b2025', '#353e46', '#56616a', '#808b93')),
	ramp('Marble', even('#6d6a66', '#b5b0a9', '#e4e0da', '#f7f5f1')),
	ramp('Sand', even('#6e5434', '#a5844f', '#cdb07a', '#e6d3a3', '#f6ecd0')),
	ramp('Dirt', even('#1d140d', '#3d2a1b', '#634631', '#8a6a4b')),
	ramp('Clay', even('#5a2414', '#93432a', '#bf6a45', '#dc9a72')),
	ramp('Moss', even('#141a08', '#2f4012', '#557021', '#86a03a', '#b9c96a')),
	ramp('Wood', even('#2a170b', '#5a361c', '#8b5a32', '#b78653', '#d6ad78')),
	ramp('Rust', even('#2a1209', '#5e2410', '#93401a', '#c06a2c', '#d99a5a')),
	ramp('Copper', even('#2a120a', '#6b2e17', '#b8643a', '#e3a072', '#f6d2b4')),
	ramp('Gold', even('#2e1e05', '#6b4a12', '#b48a2c', '#e3c25e', '#fff0b8')),
	ramp('Steel', even('#16191c', '#3a4046', '#6b737b', '#a8b0b7', '#e6eaee')),
	ramp('Blood', even('#120000', '#3d0000', '#7a0705', '#b3150f')),
	ramp('Slime', even('#0b1a05', '#2f5d0a', '#6fb514', '#c6f24a', '#f2ffb0')),
	ramp('Amethyst', even('#120a24', '#3a1b6b', '#7a45b8', '#c39ef0', '#f3e8ff'))
];

export const RGBA_PRESETS: ColourPreset[] = [
	ramp('Ice', at([0, '#bfe9f5', 0], [0.45, '#d8f2fa', 0.35], [0.8, '#eefaff', 0.85], [1, '#ffffff'])),
	ramp('Water', at([0, '#3aa0a8', 0], [0.4, '#1a6a80', 0.5], [0.75, '#0a3550', 0.85], [1, '#05192b'])),
	ramp('Fire', at([0, '#5e0a00', 0], [0.3, '#c12a00', 0.7], [0.6, '#f27a0c'], [0.85, '#ffd25a'], [1, '#fff6d8'])),
	ramp('Rock', at([0, '#4d4a44', 0], [0.4, '#5c5850', 0.6], [0.75, '#8a847a'], [1, '#bdb6aa'])),
	ramp('Moss', at([0, '#2f4012', 0], [0.45, '#2f4012', 0], [0.6, '#557021', 0.8], [1, '#9ab248'])),
	ramp('Sand', at([0, '#d9c08a', 0], [0.4, '#d9c08a', 0], [0.7, '#e6d3a3', 0.7], [1, '#f2e6c4'])),
	ramp('Snow', at([0, '#dfe8f0', 0], [0.5, '#e8eff5', 0], [0.65, '#f4f8fb', 0.9], [1, '#ffffff'])),
	ramp('Lava', at([0, '#ffd23a'], [0.15, '#ff6a00'], [0.35, '#a81d05', 0.6], [0.6, '#3a0f08', 0], [1, '#3a0f08', 0])),
	ramp('Smoke', at([0, '#3a3a3a', 0], [0.5, '#2b2b2b', 0.55], [1, '#111111', 0.9])),
	ramp('Grime', at([0, '#3d2a1b', 0], [0.6, '#2a1d12', 0.5], [1, '#1a120b', 0.85])),
	ramp('Rust', at([0, '#93401a', 0], [0.5, '#7a3214', 0.55], [1, '#4a1d0b', 0.9])),
	ramp('Blood', at([0, '#7a0705', 0], [0.35, '#5c0303', 0.75], [1, '#2e0000'])),
	ramp('Dirt', at([0, '#634631', 0], [0.35, '#4a3423', 0.5], [0.7, '#3d2a1b', 0.9], [1, '#2b1d12'])),
	ramp('Verdigris', at([0, '#3f8f7a', 0], [0.45, '#4fa58c', 0.6], [1, '#8fd1b8'])),
	ramp('Ash', at([0, '#8a8580', 0], [0.5, '#5a5652', 0.6], [1, '#2a2826', 0.95]))
];

const sorted = (g: Gradient): GradientStop[] => [...g.stops].sort((a, b) => a.pos - b.pos);

/** Interpolates one stop property along the ramp (clamped to the end stops). */
function sample<T>(g: Gradient, t: number, get: (s: GradientStop) => T, mix: (a: T, b: T, k: number) => T): T {
	const s = sorted(g);
	if (t <= s[0].pos) return get(s[0]);
	for (let i = 1; i < s.length; i++)
		if (t <= s[i].pos)
			return mix(get(s[i - 1]), get(s[i]), (t - s[i - 1].pos) / Math.max(1e-6, s[i].pos - s[i - 1].pos));
	return get(s[s.length - 1]);
}

/** The ramp's colour at t (sRGB hex, mixed in sRGB like the editor's bar). */
export function gradientColorAt(g: Gradient, t: number): string {
	return sample(
		g,
		t,
		(s) => s.color,
		(a, b, k) => {
			const x = hexToRgb(a);
			const y = hexToRgb(b);
			return rgbToHex([x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k]);
		}
	);
}

/** The ramp's opacity at t. */
export function gradientAlphaAt(g: Gradient, t: number): number {
	return sample(
		g,
		t,
		(s) => s.alpha ?? 1,
		(a, b, k) => a + (b - a) * k
	);
}

/**
 * The ramp with its opacity running linearly from `a` (left) to `b` (right), its colours kept. Stops are added at the
 * ends where the ramp's own don't reach them (and there is room), since a ramp holds its end stops' values beyond them.
 */
export function withOpacityRamp(g: Gradient, a: number, b: number): Gradient {
	const s = sorted(g).map((x) => ({ ...x }));
	if (s[0].pos > 0 && s.length < MAX_GRADIENT_STOPS) s.unshift({ ...s[0], pos: 0 });
	if (s[s.length - 1].pos < 1 && s.length < MAX_GRADIENT_STOPS) s.push({ ...s[s.length - 1], pos: 1 });
	return {
		stops: s.map(({ alpha: _, ...x }) => {
			const v = Number(Math.min(1, Math.max(0, a + (b - a) * x.pos)).toFixed(3));
			return v < 1 ? { ...x, alpha: v } : x;
		})
	};
}
