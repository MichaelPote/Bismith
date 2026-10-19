// One-click lighting setups (docs/features/fr3.1-lighting.md).

import type { Lighting } from './project';
import { createLight } from './lights';

export interface LightingPreset {
	id: string;
	name: string;
	hint: string;
	build: () => Lighting;
}

export const LIGHTING_PRESETS: LightingPreset[] = [
	{
		id: 'ui-key',
		name: 'UI key',
		hint: 'Top-left key light, cool sky fill — the classic bevelled-button look',
		build: () => ({
			sky: { enabled: true, zenith: '#a9bccd', horizon: '#c9c4bb', intensity: 0.3 },
			ambient: { color: '#ffffff', intensity: 0.03 },
			lights: [
				{
					...createLight('directional', { azimuth: 315, elevation: 42, angle: 2, intensity: 1.4, color: '#fff3e2' }),
					name: 'Key'
				}
			]
		})
	},
	{
		id: 'overhead',
		name: 'Overhead',
		hint: 'High sun and a bright sky — even, readable texture light',
		build: () => ({
			sky: { enabled: true, zenith: '#9fb4c8', horizon: '#c8c2b8', intensity: 0.6 },
			ambient: { color: '#ffffff', intensity: 0.02 },
			lights: [
				{ ...createLight('directional', { azimuth: 330, elevation: 70, angle: 4, intensity: 1.0 }), name: 'Sun' }
			]
		})
	},
	{
		id: 'torch',
		name: 'Torch-lit',
		hint: 'Two warm point lights in a dark room — Quake mood',
		build: () => ({
			sky: { enabled: true, zenith: '#2a3038', horizon: '#1d2024', intensity: 0.15 },
			ambient: { color: '#ffd9b0', intensity: 0.02 },
			lights: [
				{
					...createLight('point', { x: 0.2, y: 0.25, z: 40, radius: 4, intensity: 1.6, color: '#ffb766' }),
					name: 'Torch A'
				},
				{
					...createLight('point', { x: 0.82, y: 0.7, z: 32, radius: 4, intensity: 1.0, color: '#ff9a4a' }),
					name: 'Torch B'
				}
			]
		})
	},
	{
		id: 'raking',
		name: 'Raking',
		hint: 'Low side light that exaggerates relief',
		build: () => ({
			sky: { enabled: true, zenith: '#8fa2b5', horizon: '#b8b2a8', intensity: 0.2 },
			ambient: { color: '#ffffff', intensity: 0.01 },
			lights: [
				{ ...createLight('directional', { azimuth: 270, elevation: 14, angle: 1.5, intensity: 1.8 }), name: 'Rake' }
			]
		})
	},
	{
		id: 'flat',
		name: 'Flat',
		hint: 'Uniform white sky only — shows albedo with soft occlusion',
		build: () => ({
			sky: { enabled: true, zenith: '#ffffff', horizon: '#ffffff', intensity: 1 },
			ambient: { color: '#ffffff', intensity: 0 },
			lights: []
		})
	}
];
