// Colour maths shared by the UI, uniform upload, palettes and metrics.
// Colours in the project are stored as sRGB hex strings; the GPU works in linear RGB.

export type RGB = [number, number, number];

export function clamp01(x: number): number {
	return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function hexToRgb(hex: string): RGB {
	let h = hex.trim().replace(/^#/, '');
	if (h.length === 3)
		h = h
			.split('')
			.map((c) => c + c)
			.join('');
	if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return [0, 0, 0];
	const n = parseInt(h, 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(rgb: RGB): string {
	return (
		'#' +
		rgb
			.map((v) =>
				Math.round(clamp01(v) * 255)
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}

export function srgbToLinear1(c: number): number {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb1(c: number): number {
	if (c <= 0) return 0;
	return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function srgbToLinear(rgb: RGB): RGB {
	return [srgbToLinear1(rgb[0]), srgbToLinear1(rgb[1]), srgbToLinear1(rgb[2])];
}

export function linearToSrgb(rgb: RGB): RGB {
	return [linearToSrgb1(rgb[0]), linearToSrgb1(rgb[1]), linearToSrgb1(rgb[2])];
}

export function hexToLinear(hex: string): RGB {
	return srgbToLinear(hexToRgb(hex));
}

/** Linear sRGB → OKLab (Björn Ottosson). */
export function linearToOklab(rgb: RGB): RGB {
	const [r, g, b] = rgb;
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}

/** OKLab → linear sRGB. */
export function oklabToLinear(lab: RGB): RGB {
	const [L, a, b] = lab;
	const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = L - 0.0894841775 * a - 1.291485548 * b;
	const l = l_ * l_ * l_;
	const m = m_ * m_ * m_;
	const s = s_ * s_ * s_;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	];
}

export function srgbToOklab(rgb: RGB): RGB {
	return linearToOklab(srgbToLinear(rgb));
}

export function oklabToSrgb(lab: RGB): RGB {
	const lin = oklabToLinear(lab);
	return linearToSrgb([clamp01(lin[0]), clamp01(lin[1]), clamp01(lin[2])]);
}

export function rgbToHsv(rgb: RGB): RGB {
	const [r, g, b] = rgb;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d > 0) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h /= 6;
		if (h < 0) h += 1;
	}
	return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(hsv: RGB): RGB {
	const [h, s, v] = hsv;
	const i = Math.floor(h * 6);
	const f = h * 6 - i;
	const p = v * (1 - s);
	const q = v * (1 - f * s);
	const t = v * (1 - (1 - f) * s);
	switch (((i % 6) + 6) % 6) {
		case 0:
			return [v, t, p];
		case 1:
			return [q, v, p];
		case 2:
			return [p, v, t];
		case 3:
			return [p, q, v];
		case 4:
			return [t, p, v];
		default:
			return [v, p, q];
	}
}

/** How much brighter (in linear light) a metal's colour is than the same look painted on a non-metal; see metalColour. */
export const METAL_LIFT = 3;

/**
 * The colour to give a metal (Metalness 1) so it looks about as bright as `hex` does on a non-metal. A metal shows its
 * colour only in its reflections (F0 = the colour, no diffuse), which under sky and sun come out two to three times as dark in
 * linear light. Scales the linear colour by `k`, capped so no channel passes 0.95: the hue holds instead of clipping to
 * white.
 */
export function metalColour(hex: string, k = METAL_LIFT): string {
	const lin = hexToLinear(hex).map((c) => c * k);
	const top = Math.max(...lin);
	const capped = (top > 0.95 ? lin.map((c) => (c * 0.95) / top) : lin) as RGB;
	return rgbToHex(linearToSrgb(capped));
}

export function luminance(rgb: RGB): number {
	return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** sRGB → OKLCH: [L 0..1, C ≥ 0, h in degrees, 0..360). Greys come out with C ≈ 0 and an arbitrary hue. */
export function srgbToOklch(rgb: RGB): RGB {
	const [L, a, b] = srgbToOklab(rgb);
	const h = (Math.atan2(b, a) * 180) / Math.PI;
	return [L, Math.hypot(a, b), h < 0 ? h + 360 : h];
}

/** OKLCH → linear sRGB, unclamped (out-of-gamut colours fall outside 0..1). */
export function oklchToLinear(lch: RGB): RGB {
	const [L, C, h] = lch;
	const r = (h * Math.PI) / 180;
	return oklabToLinear([L, C * Math.cos(r), C * Math.sin(r)]);
}

/** OKLCH → sRGB, clipped to the gamut. */
export function oklchToSrgb(lch: RGB): RGB {
	const lin = oklchToLinear(lch);
	return linearToSrgb([clamp01(lin[0]), clamp01(lin[1]), clamp01(lin[2])]);
}

/** How far below 0 a channel may dip, relative to the brightest (linear), and still count as in gamut. */
const GAMUT_TOLERANCE = 1e-3;

/**
 * The most chroma lightness L and hue h (degrees) can have inside the sRGB gamut. Scans in from beyond sRGB's most
 * chromatic colour (magenta, C 0.3225) to the outer boundary, then refines it: OKLab's line of constant hue out to pure
 * blue grazes just outside the gamut on the way (red dips to -0.0006), so a search out from grey would stop short of
 * it. The dip is let through by GAMUT_TOLERANCE — at most ~3/255 of red in a vivid blue once clipped — which, being
 * relative, adds nothing in the shadows, where every channel is near 0.
 */
export function maxSrgbChroma(L: number, h: number): number {
	if (L <= 0 || L >= 1) return 0;
	const r = (h * Math.PI) / 180;
	const a = Math.cos(r);
	const b = Math.sin(r);
	// oklabToLinear, inlined: l_, m_, s_ are linear in chroma, so each channel is a cubic in it.
	const kl = 0.3963377774 * a + 0.2158037573 * b;
	const km = -0.1055613458 * a - 0.0638541728 * b;
	const ks = -0.0894841775 * a - 1.291485548 * b;
	const inside = (c: number): boolean => {
		const l = (L + kl * c) ** 3;
		const m = (L + km * c) ** 3;
		const s = (L + ks * c) ** 3;
		const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
		const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
		const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
		const hi = Math.max(R, G, B);
		return Math.min(R, G, B) >= -GAMUT_TOLERANCE * hi && hi <= 1 + 1e-6;
	};
	const step = 0.001;
	let c = 0.33;
	while (c > 0 && !inside(c)) c -= step;
	if (c <= 0) return 0;
	let lo = c;
	let hi = c + step;
	for (let i = 0; i < 16; i++) {
		const mid = (lo + hi) / 2;
		if (inside(mid)) lo = mid;
		else hi = mid;
	}
	return lo;
}

/** The sRGB gamut's cusp at hue h: the lightness and chroma of its most saturated colour, [L, C]. */
export function srgbCusp(h: number): [number, number] {
	// Max chroma rises to the cusp and falls after it: golden-section search over lightness.
	const g = (Math.sqrt(5) - 1) / 2;
	let a = 0;
	let b = 1;
	for (let i = 0; i < 40; i++) {
		const x1 = b - g * (b - a);
		const x2 = a + g * (b - a);
		if (maxSrgbChroma(x1, h) < maxSrgbChroma(x2, h)) a = x1;
		else b = x2;
	}
	const L = (a + b) / 2;
	return [L, maxSrgbChroma(L, h)];
}
