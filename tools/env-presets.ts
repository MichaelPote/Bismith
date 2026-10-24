// Write the built-in environment lighting presets (presets/lighting/<id>.json): a sky environment image painted here —
// an equirectangular panorama, its top row the zenith and its columns the azimuth clockwise from the top of the
// texture, as the lights' — stored as the app stores a loaded environment (a 512 px Ultra HDR JPEG, core/environment.ts)
// and embedded in the preset (preset.images), and a light where the panorama has its sun or key. The panoramas are HDR
// (softboxes, lamps and the sun well above 1), so they light the scene as well as tint what metals reflect; the light
// adds a crisp shadow.
//
//   npx tsx tools/env-presets.ts
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
		description: 'A low sun to the left in an orange glow, deep blue overhead: long shadows and warm, raking glints.',
		sky: (az, el) => {
			if (el < 0) return mix([0.05, 0.035, 0.025], [0.02, 0.015, 0.012], Math.min(1, -el / 30));
			const d = angle(az, el, 260, 6);
			let c = mix([0.75, 0.32, 0.12], [0.04, 0.07, 0.2], Math.pow(el / 90, 0.45));
			c = add(c, [1, 0.55, 0.22], 1.5 * Math.exp(-d / 22));
			c = add(c, [1, 0.85, 0.6], 40 * (1 - smooth(2.5, 4, d)));
			return c;
		},
		lighting: (image) => ({
			sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 0.8, image, rotation: 0 },
			ambient: { color: '#ffffff', intensity: 0.005 },
			lights: [
				{
					...createLight('directional', { azimuth: 260, elevation: 7, angle: 1, intensity: 2, color: '#ffb27a' }),
					name: 'Sun'
				}
			]
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

for (const env of ENVS) {
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
