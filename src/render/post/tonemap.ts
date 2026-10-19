import { P } from '@/core/params';
import type { PostDef } from './types';

export const tonemapPost: PostDef = {
	type: 'tonemap',
	label: 'Tonemap',
	description: 'Exposure and an HDR → display tone curve. Put it after Glow and before Palette.',
	params: [
		P.float('exposure', 'Exposure', 0, -10, 10, { softMin: -4, softMax: 4, unit: 'EV', step: 0.01 }),
		P.enum('operator', 'Operator', 'aces', [
			['clamp', 'Clamp (none)'],
			['reinhard', 'Reinhard'],
			['aces', 'ACES (fitted)'],
			['agx', 'AgX'],
			['uncharted', 'Uncharted 2']
		]),
		P.float('white', 'White point', 4, 0.5, 64, {
			softMax: 16,
			step: 0.01,
			showIf: (p) => p.operator === 'reinhard' || p.operator === 'uncharted'
		})
	],
	glsl: /* glsl */ `
vec3 acesFitted(vec3 c) {
  const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = ACESIn * c;
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(ACESOut * (a / b), 0.0, 1.0);
}
vec3 agxDefault(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  const mat3 inM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                        0.0784335999999992, 0.878468636469772, 0.0784336,
                        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outM = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                         -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                         -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  c = inM * max(c, vec3(1e-10));
  c = clamp((log2(c) + 12.47393) / 16.5, 0.0, 1.0);
  c = agxDefault(c);
  c = outM * c;
  return clamp(srgbToLinear(clamp(c, 0.0, 1.0)), 0.0, 1.0);
}
vec3 uc2(vec3 x) {
  const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}
vec4 post(ivec2 ip) {
  vec4 c = texelFetch(tInput, ip, 0);
  vec3 x = max(c.rgb, vec3(0.0)) * exp2(u_exposure);
  vec3 y;
  if (u_operator == 0) y = clamp(x, 0.0, 1.0);
  else if (u_operator == 1) y = x * (1.0 + x / (u_white * u_white)) / (1.0 + x);
  else if (u_operator == 2) y = acesFitted(x);
  else if (u_operator == 3) y = agx(x);
  else y = uc2(x * 2.0) / uc2(vec3(u_white));
  return vec4(clamp(y, 0.0, 1.0), c.a);
}
`
};
