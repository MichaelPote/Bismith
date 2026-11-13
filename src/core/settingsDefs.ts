// Project, base material and render settings as params: the Properties panel edits them through these, and the
// optimiser takes its project / base / shading levers from them (match/optimizer.ts), so both share one range.

import { P, type ParamDef, type ParamValues } from './params';

/** Largest canvas side, px (supersampling stays within MAX_STACK_SIZE, core/supersample.ts). */
export const MAX_SIZE = 4096;

export const PROJECT_DEFS: ParamDef[] = [
	P.int('width', 'Width', 128, 1, MAX_SIZE, { softMin: 16, softMax: 1024, unit: 'px' }),
	P.int('height', 'Height', 128, 1, MAX_SIZE, { softMin: 16, softMax: 1024, unit: 'px' }),
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
	P.float('metalness', 'Metalness', 0, 0, 1, {
		step: 0.001,
		optimize: false,
		hint: 'Metalness before layers: 0 = non-metal, 1 = metal (reflects in its colour, no diffuse shading); Metalness outputs vary it per pixel'
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
		hint: 'Render the surface and lighting at 2–4× and average down: finer 1 px highlights, thin joints and small holes (costs k² time). At most 4096 px across: a canvas over 1024 px gets 2× at most, over 2048 none. Shown as @Nx beside the project in the outliner'
	}),
	P.int('exportSamples', 'Samples', 1024, 1, 65536, {
		section: 'Export',
		softMin: 1,
		softMax: 4096,
		hint: 'Samples File ▸ Export PNG traces (never fewer than Max samples): exports come out cleaner than the viewport'
	}),
	P.int('exportSupersample', 'Supersample', 2, 1, 4, {
		section: 'Export',
		hint: 'Exports render at this many × the size and average down (antialiased edges); a project supersampled more keeps its own. At most 4096 px across: a canvas over 1024 px exports at 2× at most, over 2048 at 1×'
	})
];

// World lighting: the sky light and the ambient fill (Properties › the project node).
const hasEnv = (p: ParamValues) => Boolean(p.image);
export const SKY_DEFS: ParamDef[] = [
	P.bool('enabled', 'Sky light', true),
	P.enum(
		'plane',
		'Plane',
		'floor',
		[
			[
				'floor',
				'Floor',
				'lying flat under the sky: the zenith straight out of it, read as a map (top north, right east)'
			],
			[
				'wall',
				'Wall',
				'standing upright, the floor stood up on its bottom edge: the sky above its top, the ground below, east still to its right and its face looking south'
			]
		],
		{
			segmented: true,
			hint: 'Where the sky (its gradient or environment image) sits round the texture. The lights keep their own directions, relative to the texture'
		}
	),
	P.image('image', 'Environment', {
		environment: true,
		hint: 'A panorama (equirectangular, 2:1: its top row straight up, its left edge facing the top of the texture) in place of the zenith → horizon gradient: what metals reflect, coloured by direction, and the light rough surfaces get from the sky. OpenEXR, Radiance HDR and Ultra HDR JPEG keep their full range (a sun lights the scene); PNG, JPEG and WebP work too. Kept as a 512 px Ultra HDR JPEG; the project saves its file name and a lighting preset the image'
	}),
	P.color('zenith', 'Zenith', '#9fb4c8', { showIf: (p) => !hasEnv(p) }),
	P.color('horizon', 'Horizon', '#c8c2b8', { showIf: (p) => !hasEnv(p) }),
	P.float('rotation', 'Rotation', 0, -180, 180, {
		step: 1,
		showIf: hasEnv,
		hint: 'Turns the environment about the vertical, in degrees: where its features sit in the reflections'
	}),
	P.float('intensity', 'Intensity', 0.35, 0, 1000, {
		softMax: 4,
		step: 0.001,
		hint: 'Brightness of the sky (the gradient, or the environment image)'
	})
];
export const AMBIENT_DEFS: ParamDef[] = [
	P.color('color', 'Colour', '#ffffff'),
	P.float('intensity', 'Strength', 0.02, 0, 1000, { softMax: 1, step: 0.001, hint: 'Un-shadowed fill light' })
];
