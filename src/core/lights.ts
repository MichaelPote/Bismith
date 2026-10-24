import { P, type ParamDef, defaultParams } from './params';
import type { Light, LightType } from './project';
import { newId } from './ids';

/**
 * A point light's reference distance (px) when it has none (Light.refDist): at this distance Intensity 1 lights a white
 * surface to 1.0.
 */
export const POINT_LIGHT_REF_DIST = 64;

export interface LightDef {
	type: LightType;
	label: string;
	params: ParamDef[];
}

const common: ParamDef[] = [
	P.color('color', 'Colour', '#fff4e0', { group: 'light' }),
	P.float('intensity', 'Intensity', 1.2, 0, 1000, { softMax: 10, step: 0.01, group: 'light' })
];

export const LIGHT_DEFS: Record<LightType, LightDef> = {
	directional: {
		type: 'directional',
		label: 'Directional',
		params: [
			...common,
			P.float('azimuth', 'Azimuth', 315, 0, 360, {
				unit: '°',
				step: 1,
				group: 'light',
				hint: 'Clockwise from the top of the image'
			}),
			P.float('elevation', 'Elevation', 40, 1, 90, { unit: '°', step: 0.5, group: 'light' }),
			P.float('angle', 'Softness', 3, 0, 45, {
				unit: '°',
				step: 0.1,
				group: 'light',
				hint: 'Angular radius of the light; larger = softer shadows'
			})
		]
	},
	point: {
		type: 'point',
		label: 'Point',
		params: [
			...common,
			P.float('x', 'X', 0.3, -1, 2, { softMin: 0, softMax: 1, step: 0.001, group: 'light' }),
			P.float('y', 'Y', 0.3, -1, 2, { softMin: 0, softMax: 1, step: 0.001, group: 'light' }),
			P.float('z', 'Height', 48, 0, 4096, { softMax: 256, unit: 'px', step: 0.5, group: 'light' }),
			P.float('radius', 'Radius', 6, 0, 512, {
				softMax: 64,
				unit: 'px',
				step: 0.1,
				group: 'light',
				hint: 'Physical size; larger = softer shadows'
			}),
			P.float('range', 'Range', 0, 0, 8192, {
				softMax: 1024,
				unit: 'px',
				step: 1,
				group: 'light',
				hint: '0 = pure inverse-square falloff'
			})
		]
	}
};

export function createLight(type: LightType, overrides: Record<string, unknown> = {}): Light {
	const def = LIGHT_DEFS[type];
	const params = { ...defaultParams(def.params), ...(overrides as object) };
	return { id: newId('lt'), type, name: def.label, enabled: true, params };
}
