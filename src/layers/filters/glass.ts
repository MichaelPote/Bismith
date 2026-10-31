// Glass (FR8.12): turns the area inside the Shape mask into glass over what is already painted — the background
// refracted through the surface (its slope from the height), carried mostly as transmitted light (not shaded by the
// glass surface), tinted more where the path through the glass is longer (towards the rims), Fresnel-darkened rims,
// an inner glint where light focuses on the far side, and a smooth, reflective surface for the lights' highlights.

import { P } from '@/core/params';
import type { LayerDef } from '../types';

export const glassLayer: LayerDef = {
	type: 'glass',
	channels: { diffuse: true },
	label: 'Glass',
	category: 'filter',
	kind: 'filter',
	readsMask: true,
	description:
		'Glass over the layers below, inside the current shape (e.g. pipework tubes): refraction from the height, tint, Fresnel rims, an inner glint, glossy highlights.',
	params: [
		P.float('refraction', 'Refraction', 4, 0, 128, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			hint: 'How far the background is bent at the steepest slope: magnified in the middle, squeezed towards the rims'
		}),
		P.color('tint', 'Tint', '#9ad0c0'),
		P.float('tint_amount', 'Tint strength', 0.35, 0, 1, {
			step: 0.01,
			hint: 'Grows towards the rims, where light crosses more glass'
		}),
		P.float('transmit', 'Transmission', 0.7, 0, 1, {
			step: 0.01,
			hint: 'Share of the background carried as transmitted (unshaded) light; the rest is lit like a surface'
		}),
		P.color('rim', 'Rim colour', '#1c2a26'),
		P.float('fresnel', 'Rim darkening', 0.7, 0, 1, {
			step: 0.01,
			hint: 'Edges seen at a grazing angle reflect more and show less of the background'
		}),
		P.float('glint', 'Inner glint', 0.6, 0, 2, {
			step: 0.01,
			hint: 'A bright line on the far side from the light, where the glass focuses it'
		}),
		P.enum(
			'light',
			'Light from',
			'top-left',
			[
				['top-left', 'Top left'],
				['top', 'Top'],
				['top-right', 'Top right'],
				['left', 'Left'],
				['right', 'Right']
			],
			{ hint: 'For the inner glint (match the key light)' }
		),
		P.float('roughness', 'Roughness', 0.06, 0, 1, { step: 0.01 }),
		P.float('specular', 'Specular', 0.9, 0, 1, { step: 0.01 })
	],
	filterGlsl: /* glsl */ `
// Light from (option order): top left, top, top right, left, right.
const vec2 GLASS_LIGHT[5] = vec2[5](vec2(-0.7071, 0.7071), vec2(0.0, 1.0), vec2(0.7071, 0.7071), vec2(-1.0, 0.0), vec2(1.0, 0.0));
void applyFilter(inout vec4 A, inout vec4 S, inout vec4 E, ivec2 ip) {
  float m = coverage(maskIn(ip), true);
  if (m <= 0.0) return;
  // Surface normal from the height (px per px); the background refracted through it (GLSL_TRANSPARENCY).
  float hl = fetchT(tSurface, ip - ivec2(1, 0)).r, hr = fetchT(tSurface, ip + ivec2(1, 0)).r;
  float hd = fetchT(tSurface, ip - ivec2(0, 1)).r, hu = fetchT(tSurface, ip + ivec2(0, 1)).r;
  vec3 n = slopeNormal(0.5 * vec2(hr - hl, hu - hd) * uDepth);
  float rim = grazing(n);
  vec3 behind = seenThrough(vec2(ip) + 0.5, lensShift(n, u_refraction));
  vec3 through = absorbTint(behind, u_tint, u_tint_amount * (0.5 + 2.0 * rim));
  float F = rimFresnel(rim, u_fresnel);
  vec3 a = A.rgb, e = E.rgb;
  layTransparent(a, e, mix(through, u_rim, F), u_transmit * (1.0 - F), m);
  A.rgb = a;
  // Inner glint: on the far side from the light, just inside the rim.
  E.rgb = e + m * u_glint * innerGlint(n, GLASS_LIGHT[u_light], rim) * mix(vec3(1.0), u_tint, 0.3);
  // Glossy, and not metal (glass over a metal reflects like glass).
  S.g = mix(S.g, u_roughness, m);
  S.b = mix(S.b, 0.0, m);
  E.a = mix(E.a, u_specular, m);
}
`
};
