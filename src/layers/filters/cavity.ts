// Cavity / edge wear: curvature = height − blur(height). Convex edges get worn (a highlight colour, usually
// smoother), cavities collect dirt (a dark colour, usually rougher); both broken up by tileable fBm.

import * as THREE from 'three';
import { P } from '@/core/params';
import type { LayerDef } from '../types';
import { blurTexture } from './shared';

const CAVITY_APPLY = /* glsl */ `
uniform sampler2D tBlur;

// Remove part of a mask where the noise is low; amount 0 keeps everything, 1 removes everything.
float breakup(float n, float amount) {
  float c = clamp((n - 0.5) * 2.5 + 0.5, 0.0, 1.0);
  return smoothstep(amount * 1.3 - 0.3, amount * 1.3, c);
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(tAlbedo, ip, 0);
  vec4 S = texelFetch(tSurface, ip, 0);
  vec4 E = texelFetch(tEmissive, ip, 0);
  // Curvature in px of relief (height × heightDepth): > 0 convex, < 0 concave.
  float c = (S.r - texelFetch(tBlur, ip, 0).r) * uDepth;
  float wear = clamp((c - u_threshold) * u_sensitivity, 0.0, 1.0);
  float dirt = clamp((-c - u_threshold) * u_sensitivity, 0.0, 1.0);
  if (u_wear_noise > 0.0 || u_dirt_noise > 0.0) {
    gPhase = u_phase;
    vec2 cells = cellsFor(u_noise_scale, 1.0);
    ivec2 per = uTile ? ivec2(cells) : NO_PERIOD;
    vec2 x = gl_FragCoord.xy / uRes * cells;
    if (u_wear_noise > 0.0) wear *= breakup(fractalNoise(1, 1, x, per, u_noise_octaves, 2.0, 0.5, uSeed + 11.0), u_wear_noise);
    if (u_dirt_noise > 0.0) dirt *= breakup(fractalNoise(1, 1, x, per, u_noise_octaves, 2.0, 0.5, uSeed + 57.0), u_dirt_noise);
  }
  wear *= u_wear_amount;
  dirt *= u_dirt_amount;
  A.rgb = mix(A.rgb, u_dirt_color, dirt);
  A.rgb = mix(A.rgb, u_wear_color, wear);
  S.g = clamp(S.g + wear * u_wear_rough + dirt * u_dirt_rough, 0.0, 1.0);
  oAlbedo = A;
  oSurface = S;
  oEmissive = E;
}
`;

export const cavityLayer: LayerDef = {
	type: 'cavity',
	channels: { diffuse: true },
	label: 'Cavity / edge wear',
	category: 'filter',
	kind: 'filter',
	description: 'Worn highlights on convex edges and dirt in crevices, from the curvature of the height below.',
	params: [
		P.float('radius', 'Radius', 3, 0.5, 64, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			hint: 'Curvature scale: how far from an edge the effect reaches'
		}),
		P.float('threshold', 'Threshold', 0.1, 0, 64, {
			softMax: 4,
			unit: 'px',
			step: 0.01,
			hint: 'Curvature (px of relief) ignored before masks start'
		}),
		P.float('sensitivity', 'Sensitivity', 0.5, 0, 16, {
			softMax: 4,
			step: 0.01,
			perPx: true,
			hint: 'Mask gain per px of curvature'
		}),
		P.float('wear_amount', 'Amount', 0.7, 0, 1, { step: 0.001, group: 'wear' }),
		P.color('wear_color', 'Colour', '#b4a690', { group: 'wear' }),
		P.float('wear_rough', 'Roughness Δ', -0.2, -1, 1, { step: 0.001, group: 'wear' }),
		P.float('wear_noise', 'Breakup', 0.35, 0, 1, { step: 0.001, group: 'wear' }),
		P.float('dirt_amount', 'Amount', 0.7, 0, 1, { step: 0.001, group: 'dirt' }),
		P.color('dirt_color', 'Colour', '#17120d', { group: 'dirt' }),
		P.float('dirt_rough', 'Roughness Δ', 0.15, -1, 1, { step: 0.001, group: 'dirt' }),
		P.float('dirt_noise', 'Breakup', 0.25, 0, 1, { step: 0.001, group: 'dirt' }),
		P.float('noise_scale', 'Scale', 12, 0.25, 256, {
			softMax: 64,
			step: 0.01,
			group: 'breakup',
			hint: 'Cells across the texture (rounded when tiling)'
		}),
		P.int('noise_octaves', 'Octaves', 4, 1, 8, { group: 'breakup' }),
		P.float('phase', 'Phase', 0, -10000, 10000, {
			softMin: 0,
			softMax: 1,
			step: 0.001,
			optimize: false,
			group: 'breakup',
			hint: 'Animates the breakup noise: 0 → 1 is one seamless loop; it repeats beyond 1'
		}),
		P.seed('seed', 'Seed', 1, { group: 'breakup' })
	],
	groups: [
		{ id: 'wear', label: 'Edge wear' },
		{ id: 'dirt', label: 'Cavity dirt' },
		{ id: 'breakup', label: 'Breakup noise', collapsed: true }
	],
	run(ctx, layer) {
		const p = layer.params;
		const blurred = blurTexture(ctx, ctx.surface, Math.max(0.5, Number(p.radius ?? 3)), 'cavity');
		const mat = ctx.mrtMaterial('apply', CAVITY_APPLY, { tBlur: { value: null as THREE.Texture | null } });
		mat.uniforms.tBlur.value = blurred.texture;
		ctx.runMRT(mat);
	}
};
