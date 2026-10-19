// Project, base material and render settings as params: the Properties panel edits them through these, and the
// optimiser takes its project / base / shading levers from them (match/optimizer.ts), so both share one range.

import { P, type ParamDef } from './params';

export const PROJECT_DEFS: ParamDef[] = [
	P.int('width', 'Width', 128, 1, 2048, { softMin: 16, softMax: 1024, unit: 'px' }),
	P.int('height', 'Height', 128, 1, 2048, { softMin: 16, softMax: 1024, unit: 'px' }),
	P.bool('tileable', 'Tileable (seamless wrap)', true),
	P.float('heightDepth', 'Height depth', 2, 0, 4096, {
		softMax: 8,
		unit: 'px',
		step: 0.01,
		hint: 'World height in px of a height value of 1.0. Keep it small (1–3 px) for fine relief'
	}),
	P.seed('seed', 'Global seed')
];

export const BASE_DEFS: ParamDef[] = [
	P.color('color', 'Colour', '#7a7570'),
	P.float('roughness', 'Roughness', 0.75, 0, 1, { step: 0.001 }),
	P.float('specular', 'Specular', 0.5, 0, 1, {
		step: 0.001,
		hint: 'Specular level before layers (0.5 ≈ 4 % reflectance at scale 1); Specular outputs vary it per pixel'
	}),
	P.float('height', 'Height', 0, -64, 64, { softMin: -1, softMax: 1, step: 0.001 }),
	P.float('opacity', 'Opacity', 1, 0, 1, { step: 0.001 })
];
export const RENDER_DEFS: ParamDef[] = [
	P.int('maxSamples', 'Max samples', 256, 1, 65536, { softMin: 1, softMax: 2048 }),
	P.int('samplesPerFrame', 'Per frame', 4, 1, 64, { softMax: 32 }),
	P.int('bounces', 'Bounces', 2, 0, 4),
	P.float('specular', 'Specular scale', 1, 0, 4, {
		step: 0.001,
		hint: 'Multiplies every pixel’s specular level: F0 = 0.08 × level × scale. 0 turns highlights off'
	}),
	P.float('specularTint', 'Specular tint', 1, 0, 1, {
		step: 0.001,
		hint: '1 = highlights in the surface’s own hue, enriching the colour (the default); 0 = white highlights, like a clear coat or wet surface'
	}),
	P.float('ao', 'Ambient occlusion', 0, 0, 8, {
		softMax: 3,
		step: 0.01,
		hint: 'Darkens creases and touching edges: lighting × AO^strength (0 = off). Works with cast shadows off'
	}),
	P.float('aoRadius', 'AO radius', 4, 0.5, 128, {
		softMax: 16,
		unit: 'px',
		step: 0.1,
		showIf: (p) => Number(p.ao) > 0
	}),
	P.float('clamp', 'Firefly clamp', 8, 0, 1000, {
		softMax: 32,
		step: 0.1,
		hint: 'Max luminance of indirect samples (0 = off)'
	}),
	P.bool('jitter', 'Sub-pixel jitter (soft shadow edges)', true),
	P.bool('shadows', 'Cast shadows', true, {
		hint: 'Off: lights shade by surface angle only (painted / hand-lit look)'
	}),
	P.int('supersample', 'Supersample', 1, 1, 4, {
		hint: 'Render the surface and lighting at 2–4× and average down: finer 1 px highlights, thin joints and small holes (costs k² time). Shown as @Nx beside the project in the outliner'
	})
];
