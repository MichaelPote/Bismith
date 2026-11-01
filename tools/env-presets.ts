// Write the built-in environment lighting presets (presets/lighting/<id>.json): a sky environment image painted here —
// an equirectangular panorama, its top row the zenith and its columns the azimuth clockwise from the top of the
// texture, as the lights' — stored as the app stores a loaded environment (a 512 px Ultra HDR JPEG, core/environment.ts)
// and embedded in the preset (preset.images), and a light where the panorama has its sun or key. The panoramas are HDR
// (softboxes, lamps and the sun well above 1), so they light the scene as well as tint what metals reflect; the light
// adds a crisp shadow. A sun is painted as a soft halo rather than a disc; its light carries the crisp shadow and the
// glint.
//
//   npx tsx tools/env-presets.ts [id…]   (all of them, or only these: studio, overcast, sunset, daylight, night-courtyard,
//   workshop)
//
// Then render their thumbnails: npx tsx tools/previews.ts --only lighting/studio,lighting/overcast,…

import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpegJs from 'jpeg-js';
import { bytesToDataUrl, encodeUltraHdr, type JpegCodec } from '../src/core/environment';
import type { Lighting } from '../src/core/project';
import { createLight, projectToJSON } from '../src/core/serialize';
import { presetBase, presetProject } from '../src/presets/stage';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const W = 512;
const H = 256;

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [
	a[0] + (b[0] - a[0]) * t,
	a[1] + (b[1] - a[1]) * t,
	a[2] + (b[2] - a[2]) * t
];
const add = (a: RGB, b: RGB, k: number): RGB => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const smooth = (e0: number, e1: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
	return t * t * (3 - 2 * t);
};
/** Signed azimuth difference in degrees, -180..180. */
const dAz = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;
/** A soft-edged panel: `soft` degrees of falloff round an azimuth span (centre ± half) and an elevation span. */
const panel = (az: number, el: number, az0: number, half: number, el0: number, el1: number, soft: number) =>
	(1 - smooth(half, half + soft, Math.abs(dAz(az, az0)))) *
	smooth(el0 - soft, el0, el) *
	(1 - smooth(el1, el1 + soft, el));
/** Angular distance in degrees between two directions given as azimuth / elevation. */
function angle(az: number, el: number, az0: number, el0: number): number {
	const r = Math.PI / 180;
	const c = Math.sin(el * r) * Math.sin(el0 * r) + Math.cos(el * r) * Math.cos(el0 * r) * Math.cos((az - az0) * r);
	return Math.acos(Math.min(1, Math.max(-1, c))) / r;
}
/** Soft, cloud-like variation round the azimuth (periodic) and up the sky, 0..1. */
const clouds = (az: number, el: number) => {
	const a = (az * Math.PI) / 180;
	const v = el / 90;
	return (
		0.5 +
		0.18 * Math.sin(3 * a + 7 * v) +
		0.12 * Math.sin(7 * a - 11 * v + 1.3) +
		0.08 * Math.sin(13 * a + 17 * v + 2.1) +
		0.05 * Math.sin(29 * a - 23 * v + 0.4)
	);
};

/** Piecewise-linear colour ramp over x (stops in order of x). */
function ramp(stops: [number, RGB][], x: number): RGB {
	if (x <= stops[0][0]) return stops[0][1];
	for (let i = 1; i < stops.length; i++)
		if (x <= stops[i][0]) {
			const [x0, c0] = stops[i - 1];
			const [x1, c1] = stops[i];
			return mix(c0, c1, (x - x0) / (x1 - x0));
		}
	return stops[stops.length - 1][1];
}
/** A polyline's height at x (points in order of x, covering -180..180). */
function polyline(pts: [number, number][], x: number): number {
	for (let i = 1; i < pts.length; i++)
		if (x <= pts[i][0]) {
			const [x0, y0] = pts[i - 1];
			const [x1, y1] = pts[i];
			return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
		}
	return pts[pts.length - 1][1];
}
/** A soft ellipse round azimuth / elevation a0, e0 with radii ra, re: 1 inside, 0 outside, `soft` its falloff. */
const ellipse = (az: number, el: number, a0: number, e0: number, ra: number, re: number, soft = 0.6) =>
	1 - smooth(1 - soft, 1, Math.hypot(dAz(az, a0) / ra, (el - e0) / re));
/** A cumulus cloud: a dome over a flat base at e0 (the part below it a third as deep). */
const cumulus = (az: number, el: number, a0: number, e0: number, ra: number, re: number) =>
	1 - smooth(0.55, 1, Math.hypot(dAz(az, a0) / ra, (el - e0) / (el > e0 ? re : re * 0.35)));
/** Angular distance in degrees from the arc between two directions, its azimuth scaled for elevation. */
function streak(az: number, el: number, a0: number, e0: number, a1: number, e1: number): number {
	const k = Math.cos((((e0 + e1) / 2) * Math.PI) / 180);
	const px = dAz(az, a0) * k;
	const py = el - e0;
	const vx = dAz(a1, a0) * k;
	const vy = e1 - e0;
	const t = Math.max(0, Math.min(1, (px * vx + py * vy) / (vx * vx + vy * vy)));
	return Math.hypot(px - t * vx, py - t * vy);
}

// Sunset: a low, deep-orange sun in a band of haze; a pale blue sky, brightest (whitish) round the sun and along the
// horizon, and the same sky, dimmer, below it. Colours by elevation, measured away from the sun.
const SUNSET_SUN = { az: 260, el: 6 };
const SUNSET_SKY: [number, RGB][] = [
	[0, [0.98, 0.87, 0.81]],
	[3, [1.11, 1.08, 0.99]],
	[5, [1.13, 1.23, 1.25]],
	[8, [1.07, 1.26, 1.49]],
	[12, [0.94, 1.23, 1.63]],
	[20, [0.6, 0.94, 1.48]],
	[30, [0.4, 0.66, 1.14]],
	[40, [0.3, 0.51, 0.91]],
	[55, [0.23, 0.38, 0.69]],
	[70, [0.2, 0.335, 0.595]],
	[90, [0.21, 0.34, 0.59]]
];
const SUNSET_BELOW: [number, RGB][] = [
	[0, [0.96, 0.85, 0.8]],
	[2, [0.97, 0.91, 0.83]],
	[5, [0.91, 1.0, 1.05]],
	[10, [0.69, 0.83, 1.07]],
	[20, [0.32, 0.48, 0.74]],
	[35, [0.15, 0.25, 0.41]],
	[55, [0.1, 0.155, 0.26]],
	[90, [0.088, 0.133, 0.217]]
];

// Daylight: a high sun in a deep blue sky with scattered cumulus and a veil of cirrus beside the sun, over a ring of
// hills, grass from the horizon down and sand underfoot. Azimuths of the shapes are taken from the sun's.
const DAY_SUN = { az: 315, el: 43 };
const DAY_SKY: [number, RGB][] = [
	[0, [0.25, 0.33, 0.39]],
	[3, [0.214, 0.353, 0.452]],
	[5, [0.177, 0.33, 0.453]],
	[8, [0.141, 0.289, 0.44]],
	[12, [0.101, 0.236, 0.395]],
	[20, [0.066, 0.176, 0.308]],
	[30, [0.055, 0.139, 0.247]],
	[40, [0.049, 0.122, 0.214]],
	[55, [0.033, 0.094, 0.177]],
	[70, [0.042, 0.106, 0.192]],
	[90, [0.073, 0.155, 0.265]]
];
/** The hills' skyline: elevation by azimuth from the sun. */
const DAY_HILLS: [number, number][] = [
	[-180, 1.2],
	[-150, 1.2],
	[-118, 1],
	[-110, 3],
	[-98, 4],
	[-90, 6.2],
	[-81, 7.6],
	[-70, 7],
	[-64, 4],
	[-58, 5.8],
	[-47, 6.2],
	[-41, 6.9],
	[-30, 4.5],
	[-19, 3.4],
	[-8, 2.6],
	[0, 1.8],
	[40, 1.9],
	[49, 4.7],
	[60, 6.2],
	[71, 9.7],
	[80, 10],
	[88, 9.7],
	[99, 7.6],
	[106, 3.7],
	[116, 1.9],
	[127, 1.2],
	[180, 1.2]
];
/** How far down the grass runs from the horizon, by azimuth from the sun; sand below. */
const DAY_GRASS: [number, number][] = [
	[-180, -1.5],
	[-140, -2],
	[-134, -5],
	[-120, -7],
	[-112, -10],
	[-106, -3],
	[-95, -2],
	[-78, -4],
	[-72, -5],
	[-67, -10],
	[-39, -10],
	[-33, -19],
	[-16, -22],
	[-5, -28],
	[34, -29],
	[46, -36],
	[63, -41],
	[85, -44],
	[102, -41],
	[124, -36],
	[136, -31],
	[147, -28],
	[152, -25],
	[160, -3],
	[180, -1.5]
];
/** Cumulus: azimuth from the sun, base elevation, half-width, height, brightness. */
const DAY_CUMULUS: [number, number, number, number, number][] = [
	[-94, 24, 20, 8, 1.4],
	[-60, 24, 9, 3, 1.1],
	[-130, 10, 12, 3.5, 1],
	[-67, 12, 13, 2.5, 1],
	[-30, 9, 10, 2.2, 1.1],
	[37, 14, 14, 3.5, 1.4],
	[85, 28, 27, 7, 1.5],
	[130, 21, 13, 5, 1.2],
	[-167, 15, 6, 2.5, 0.8]
];

// Night courtyard: twilight over a courtyard closed in by walls, eaves and trees, lit by two warm wall lamps. Its
// azimuths are the courtyard's own; NIGHT_TURN turns it so the brighter lamp is at the top left.
const NIGHT_TURN = -17;
/** The skyline: the top of the roofs, eaves and trees round the courtyard. */
const NIGHT_TOP: [number, number][] = [
	[0, 25],
	[37, 26.5],
	[48, 31],
	[65, 36],
	[87, 38.5],
	[104, 37.4],
	[115, 35.3],
	[121, 37.8],
	[127, 41],
	[132, 41],
	[138, 40.3],
	[144, 40],
	[149, 36.7],
	[160, 36],
	[177, 41.7],
	[200, 44.5],
	[222, 42.4],
	[239, 37.8],
	[256, 29.7],
	[262, 25.1],
	[290, 29],
	[318, 26.5],
	[340, 20.6],
	[352, 23],
	[360, 25]
];
/** The top of the walls; eaves and roofs above them. */
const NIGHT_WALL: [number, number][] = [
	[0, 12],
	[50, 12],
	[55, 17],
	[110, 17],
	[115, 12],
	[140, 12],
	[145, 15],
	[235, 15],
	[240, 17],
	[290, 17],
	[295, 15],
	[360, 12]
];
/** The wall lamps: direction, the colour and strength of the light they spill on what is near, and its reach. */
const NIGHT_LAMPS = [
	{ az: 164, el: 15, colour: [1, 0.42, 0.08] as RGB, spill: 8, reach: 9 },
	{ az: 332, el: 15.8, colour: [1, 0.55, 0.15] as RGB, spill: 7, reach: 11 }
];

interface Env {
	id: string;
	name: string;
	description: string;
	/** Linear radiance (0..1) towards azimuth / elevation in degrees. */
	sky: (az: number, el: number) => RGB;
	lighting: (image: string) => Lighting;
}

const ENVS: Env[] = [
	{
		id: 'studio',
		name: 'Studio',
		description:
			'A dark studio: a big soft key from the top left, a cool fill opposite, a rim strip and a ceiling strip.',
		sky: (az, el) => {
			let c: RGB = el < 0 ? [0.02, 0.02, 0.02] : mix([0.035, 0.035, 0.038], [0.06, 0.06, 0.065], el / 90);
			c = add(c, [1, 0.96, 0.9], 3 * panel(az, el, 315, 26, 22, 62, 6));
			c = add(c, [0.3, 0.34, 0.4], 1.5 * panel(az, el, 135, 20, 18, 46, 8));
			c = add(c, [0.85, 0.85, 0.85], 3 * panel(az, el, 60, 4, 8, 52, 3));
			c = add(c, [0.6, 0.6, 0.6], 2 * panel(az, el, 225, 40, 76, 86, 3));
			return c;
		},
		lighting: (image) => ({
			sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 1, image, rotation: 0 },
			ambient: { color: '#ffffff', intensity: 0.01 },
			lights: [
				{
					...createLight('directional', { azimuth: 315, elevation: 42, angle: 18, intensity: 1, color: '#fff6ea' }),
					name: 'Key'
				}
			]
		})
	},
	{
		id: 'overcast',
		name: 'Overcast',
		description: 'A bright cloudy sky over dark ground: soft, even light and broad, dull reflections.',
		sky: (az, el) => {
			if (el < 0) return mix([0.11, 0.1, 0.09], [0.05, 0.05, 0.045], Math.min(1, -el / 30));
			const base = mix([0.62, 0.64, 0.67], [0.85, 0.87, 0.9], Math.sqrt(el / 90));
			return mix(base, [0.95, 0.96, 0.97], 0.35 * clouds(az, el));
		},
		lighting: (image) => ({
			sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 0.9, image, rotation: 0 },
			ambient: { color: '#ffffff', intensity: 0.01 },
			lights: [
				{
					...createLight('directional', { azimuth: 330, elevation: 65, angle: 35, intensity: 0.35, color: '#f2f4f8' }),
					name: 'Sky glow'
				}
			]
		})
	},
	{
		id: 'sunset',
		name: 'Sunset',
		description:
			'A low, deep-orange sun in a band of haze under a pale blue sky: a cool, soft fill with long warm shadows and glints.',
		sky: (az, el) => {
			const r = dAz(az, SUNSET_SUN.az);
			const a = Math.abs(r);
			const d = angle(az, el, SUNSET_SUN.az, SUNSET_SUN.el);
			let c = el >= 0 ? ramp(SUNSET_SKY, el) : ramp(SUNSET_BELOW, -el);
			c = add(c, [0.95, 1, 1], 5.5 * Math.exp(-d / 13)); // the whitish aureole round the sun
			// the warm glow of the haze, spreading far along the horizon either side of the sun
			c = add(c, [1, 0.6, 0.18], 8 * Math.exp(-a / 28) * Math.exp(-((el - 4) ** 2) / 98));
			// the dusky band of haze itself, thicker to the sun's right
			const w = 1.6 + 2.5 * smooth(0, 60, r) * (1 - smooth(120, 170, r));
			const band = Math.exp(-((el - 1.2) ** 2) / (2 * w * w)) * (0.7 + 0.3 * Math.sin((r * 5 * Math.PI) / 180 + 1.1));
			c = mix(c, [c[0] * 0.95, c[1] * 0.78, c[2] * 0.62], 0.8 * band * (1 - Math.exp(-a / 6)));
			// a wisp of cirrus rising to the upper right of the sun
			c = add(c, [0.9, 0.95, 1], 0.5 * smooth(70, 20, el) * Math.exp(-((streak(r, el, -2, 12, 45, 60) / 13) ** 2)));
			c = add(c, [1, 0.45, 0.1], 40 * Math.exp(-d / 1.5)); // the sun's halo
			// × 0.42: the sky lights a white floor to about 0.3, a little less than measured, so the sun leads
			return c.map((v) => v * 0.42) as RGB;
		},
		lighting: (image) => ({
			sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 1, image, rotation: 0 },
			ambient: { color: '#ffffff', intensity: 0.005 },
			lights: [
				{
					// About 3× the measured sun, whose open sky outweighs it: a face turned to it lit to about 1.6,
					// for warm raking light over the cool fill.
					...createLight('directional', {
						azimuth: SUNSET_SUN.az,
						elevation: SUNSET_SUN.el,
						angle: 1,
						intensity: 3.4,
						color: '#ffa040'
					}),
					name: 'Sun'
				}
			]
		})
	},
	{
		id: 'daylight',
		name: 'Daylight',
		description:
			'A high sun in a deep blue sky with scattered clouds, over grassy hills and sandy ground: crisp shadows, a cool fill.',
		sky: (az, el) => {
			const r = dAz(az, DAY_SUN.az);
			let c: RGB;
			if (el < polyline(DAY_HILLS, r)) {
				const grass: RGB = [0.145, 0.165, 0.075];
				if (el >= 0) c = mix([0.11, 0.13, 0.07], [0.09, 0.1, 0.075], smooth(0, 8, el));
				else {
					const e = polyline(DAY_GRASS, r);
					let t = smooth(e - 2, e + 1, el);
					t = Math.max(t, ellipse(r, el, -103, -26, 31, 12, 0.5)); // a patch of grass on the sand
					t *= 1 - ellipse(r, el, 85, -10.5, 17, 2.2); // a strip of sand in the grass
					c = mix([0.44, 0.36, 0.24], grass, t);
				}
			} else {
				const d = angle(az, el, DAY_SUN.az, DAY_SUN.el);
				c = ramp(DAY_SKY, Math.max(0, el));
				c = add(c, [0.75, 0.9, 1], 4 * Math.exp(-d / 13)); // the aureole
				c = add(c, [0.75, 0.8, 0.85], 0.45 * ellipse(r, el, 55, 55, 60, 20, 0.9)); // a veil of cirrus
				c = add(c, [1, 0.98, 0.96], 30 * Math.exp(-d / 1.5)); // the sun's halo
				for (const [a0, e0, ra, re, k] of DAY_CUMULUS) {
					const b = cumulus(r, el, a0, e0, ra, re);
					if (b > 0)
						c = mix(c, mix([0.62, 0.64, 0.68], [k, k * 0.98, k * 0.95], smooth(e0 - re * 0.35, e0 + re * 0.6, el)), b);
				}
			}
			// × 0.69: a white floor lit to about 1.1 by sky and sun together, the sun three times the sky
			return c.map((v) => v * 0.69) as RGB;
		},
		lighting: (image) => ({
			sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 1, image, rotation: 0 },
			ambient: { color: '#ffffff', intensity: 0.01 },
			lights: [
				{
					...createLight('directional', {
						azimuth: DAY_SUN.az,
						elevation: DAY_SUN.el,
						angle: 1,
						intensity: 1.2,
						color: '#fffbf8'
					}),
					name: 'Sun'
				}
			]
		})
	},
	{
		id: 'night-courtyard',
		name: 'Night Courtyard',
		description:
			'Twilight over a walled courtyard, lit by two warm wall lamps across from each other: low, warm light and a violet-blue sky.',
		sky: (azimuth, el) => {
			const az = (azimuth - NIGHT_TURN + 360) % 360;
			let c: RGB;
			if (el >= polyline(NIGHT_TOP, az)) {
				// twilight, violet-blue, brightest low down on one side
				c = ramp(
					[
						[20, [0.075, 0.068, 0.2]],
						[28, [0.073, 0.068, 0.196]],
						[45, [0.057, 0.053, 0.171]],
						[55, [0.048, 0.043, 0.145]],
						[70, [0.037, 0.034, 0.115]],
						[90, [0.034, 0.031, 0.107]]
					],
					el
				);
				c = add(c, [0.2, 0.19, 0.52], Math.exp(-((dAz(az, 95) / 60) ** 2)) * Math.exp(-Math.max(0, el - 24) / 16));
				return c.map((v) => v * 0.9) as RGB;
			}
			if (el >= 0) {
				const wallTop = polyline(NIGHT_WALL, az);
				const orange = Math.abs(dAz(az, 20)) < 32; // the carport's orange wall
				c = el < wallTop ? (orange ? [0.2, 0.065, 0.008] : [0.17, 0.095, 0.028]) : [0.03, 0.015, 0.005];
				if (el < 14.5 && Math.abs(dAz(az, 187)) < 43) c = [0.022, 0.01, 0.003]; // the garage doors
				if (Math.abs(dAz(az, 245)) < 15 || Math.abs(dAz(az, 122)) < 9) c = mix(c, [0.02, 0.01, 0.004], 0.8); // in shadow
			} else c = mix([0.04, 0.02, 0.005], [0.088, 0.041, 0.009], smooth(-2, -14, el)); // paving, dark by the walls
			for (const L of NIGHT_LAMPS) {
				const d = angle(az, el, L.az, L.el);
				c = add(c, L.colour, L.spill * (el < 0 ? 0.35 : 1) * Math.exp(-d / L.reach)); // spill on walls and paving
				c = add(c, [1, 0.75, 0.45], 30 * Math.exp(-d / 1.2)); // the lamp
			}
			// × 0.9: the courtyard lights a white floor to about 0.13 without its lamps, as measured
			return c.map((v) => v * 0.9) as RGB;
		},
		lighting: (image) => ({
			sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 1, image, rotation: 0 },
			ambient: { color: '#ffffff', intensity: 0.005 },
			// The lamps at about three times their measured power, so their low, warm light reads over the dim courtyard.
			lights: NIGHT_LAMPS.map((L, i) => ({
				...createLight('directional', {
					azimuth: (L.az + NIGHT_TURN + 360) % 360,
					elevation: L.el,
					angle: 2,
					intensity: i === 0 ? 0.83 : 1.14,
					color: i === 0 ? '#ffd07e' : '#ffd395'
				}),
				name: i === 0 ? 'Lamp' : 'Wall lamp'
			}))
		})
	},
	{
		id: 'workshop',
		name: 'Workshop',
		description: 'A dim, warm interior: a row of ceiling lamps and a cool window to the top right.',
		sky: (az, el) => {
			let c: RGB =
				el < 0
					? [0.03, 0.025, 0.02]
					: el > 62
						? [0.05, 0.045, 0.04]
						: mix([0.09, 0.07, 0.05], [0.06, 0.05, 0.04], el / 62);
			for (const a of [0, 90, 180, 270]) c = add(c, [1, 0.82, 0.55], 6 * (1 - smooth(4, 7, angle(az, el, a, 70))));
			c = add(c, [0.72, 0.82, 0.95], 2 * panel(az, el, 45, 18, 6, 34, 2));
			return c;
		},
		lighting: (image) => ({
			sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 1, image, rotation: 0 },
			ambient: { color: '#ffffff', intensity: 0.01 },
			lights: [
				{
					...createLight('directional', { azimuth: 45, elevation: 22, angle: 12, intensity: 0.7, color: '#e4ecff' }),
					name: 'Window'
				}
			]
		})
	}
];

const jpeg: JpegCodec = {
	encode: async (img, quality) =>
		jpegJs.encode({ width: img.width, height: img.height, data: img.data }, Math.round(quality * 100)).data,
	decode: async () => {
		throw new Error('not needed here');
	}
};

/** The panorama as the library stores an environment: a data URL of an Ultra HDR JPEG. */
async function paint(env: Env): Promise<string> {
	const data = new Float32Array(W * H * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const c = env.sky(((x + 0.5) / W) * 360, 90 - ((y + 0.5) / H) * 180);
			data.set([c[0], c[1], c[2], 1], (y * W + x) * 4);
		}
	return bytesToDataUrl(await encodeUltraHdr({ width: W, height: H, data }, jpeg));
}

const only = process.argv.slice(2);
for (const env of ENVS.filter((e) => !only.length || only.includes(e.id))) {
	const image = `${env.id}-environment.jpg`;
	const p = presetProject({ kind: 'lighting', lighting: env.lighting(image) }, presetBase(), {
		id: `lighting-${env.id}`,
		category: 'Lighting'
	});
	p.name = env.name;
	p.description = env.description;
	p.preset!.images = { [image]: await paint(env) };
	const file = join(ROOT, 'presets', 'lighting', `${env.id}.json`);
	writeFileSync(file, projectToJSON(p) + '\n');
	console.log(`${env.name} → ${file}`);
}
