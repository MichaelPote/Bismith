// Blur: separable Gaussian over the accumulated channels (two MRT passes through the state ping-pong).

import * as THREE from 'three';
import { P } from '@/core/params';
import type { LayerDef } from '../types';
import { GLSL_GAUSS, radiusToSigma } from './shared';

const BLUR_MRT = /* glsl */ `
${GLSL_GAUSS}
uniform vec2 uDir;
uniform float uSigma;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 dir = ivec2(uDir);
  vec4 A = texelFetch(tAlbedo, c, 0);
  vec4 S = texelFetch(tSurface, c, 0);
  vec4 E = texelFetch(tEmissive, c, 0);
  // Feather: the radius growing from 0 on the limit's outline to full a Feather inside it (its distance in tLimit.x).
  float sigma = uSigma;
  if (u_feather > 0.0 && uLimit != 0.0) sigma *= clamp(-uLimit * texelFetch(tLimit, c, 0).x / u_feather, 0.0, 1.0);
  int R = gaussTaps(sigma);
  float k = gaussK(sigma);
  bool doA = u_diffuse || u_opacity;
  bool doS = u_height || u_roughness;
  vec3 rgbW = vec3(0.0), rgbP = vec3(0.0);
  vec2 hr = vec2(0.0);
  vec4 em = vec4(0.0);
  float ws = 0.0, wa = 0.0;
  for (int i = -R; i <= R; i++) {
    float w = exp(float(i * i) * k);
    ivec2 q = c + dir * i;
    if (doA) {
      vec4 a = fetchT(tAlbedo, q);
      // Blurring opacity too: weight colour by alpha (premultiplied blur) so cut-outs don't bleed in.
      rgbW += w * a.a * a.rgb;
      rgbP += w * a.rgb;
      wa += w * a.a;
    }
    if (doS) hr += w * fetchT(tSurface, q).rg;
    if (u_emissive || u_specular) em += w * fetchT(tEmissive, q);
    ws += w;
  }
  if (u_diffuse) A.rgb = (u_opacity && wa > 1e-5 * ws) ? rgbW / wa : rgbP / ws;
  if (u_opacity) A.a = wa / ws;
  if (u_height) S.r = hr.x / ws;
  if (u_roughness) S.g = hr.y / ws;
  if (u_emissive) E.rgb = em.rgb / ws;
  if (u_specular) E.a = em.a / ws;
  oAlbedo = A;
  oSurface = S;
  oEmissive = E;
}
`;

export const blurLayer: LayerDef = {
	type: 'blur',
	channels: { diffuse: 'diffuse', height: 'height' },
	label: 'Blur',
	category: 'filter',
	kind: 'filter',
	description: 'Gaussian blur of the layers below (wraps on tileable projects).',
	params: [
		P.float('radius', 'Radius', 2, 0, 128, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			hint: 'Kernel reaches ~1.5 × radius (σ = radius / 2)'
		}),
		P.float('feather', 'Feather', 0, 0, 256, {
			softMax: 32,
			unit: 'px',
			step: 0.1,
			showIf: (p) => String(p.lim_1 ?? '').trim() !== '',
			hint: 'With Limit to: no blur on the mask’s outline, rising to the full Radius this far inside it — the inside smooths out while the edges stay crisp'
		}),
		P.bool('diffuse', 'Diffuse', true),
		P.bool('height', 'Height', true),
		P.bool('roughness', 'Roughness', false),
		P.bool('specular', 'Specular', false),
		P.bool('emissive', 'Emissive', false),
		P.bool('opacity', 'Opacity', false, { hint: 'Also blurs opacity; colour is then alpha-weighted' })
	],
	run(ctx, layer) {
		const p = layer.params;
		const radius = Number(p.radius ?? 0);
		if (radius <= 0) return;
		if (!p.diffuse && !p.height && !p.roughness && !p.specular && !p.emissive && !p.opacity) return;
		const mat = ctx.mrtMaterial('blur', BLUR_MRT, { uDir: { value: new THREE.Vector2(1, 0) }, uSigma: { value: 1 } });
		mat.uniforms.uSigma.value = Math.max(radiusToSigma(radius), 1e-3);
		(mat.uniforms.uDir.value as THREE.Vector2).set(1, 0);
		ctx.runMRT(mat);
		(mat.uniforms.uDir.value as THREE.Vector2).set(0, 1);
		ctx.runMRT(mat);
	}
};
