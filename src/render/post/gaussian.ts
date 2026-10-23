// Separable Gaussian blur shared by the Blur and Sharpen post filters. Blurs premultiplied colour so transparent
// pixels don't darken edges; wraps across the edges when the project is tileable.

import type * as THREE from 'three';
import type { PostContext } from './types';

/** Smallest Gaussian sigma (px) used: smaller ones are raised to it (a near-identity blur). */
const MIN_SIGMA = 0.2;
/** Kernel half-width cap (taps each side). */
const MAX_TAPS = 128;

const BODY = /* glsl */ `
uniform ivec2 uDir;
uniform float uSigma;
uniform bool uFirst; // first pass: premultiply the input; second: un-premultiply the result

vec4 gaussTap(ivec2 c) {
  vec4 v = fetchT(tInput, c);
  return uFirst ? vec4(v.rgb * v.a, v.a) : v;
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  int r = gaussTaps(uSigma, ${MAX_TAPS});
  float k = gaussK(uSigma);
  vec4 s = vec4(0.0);
  float wsum = 0.0;
  for (int i = -r; i <= r; i++) {
    float w = exp(float(i * i) * k);
    s += gaussTap(ip + uDir * i) * w;
    wsum += w;
  }
  s /= wsum;
  if (!uFirst) s.rgb = s.a > 1e-6 ? s.rgb / s.a : vec3(0.0);
  oColor = s;
}
`;

/** Blur `input` by `sigma` px into `output` (two passes through a full-size scratch target). */
export function gaussianBlur(
	ctx: PostContext,
	input: THREE.Texture,
	output: THREE.WebGLRenderTarget,
	sigma: number
): void {
	const mat = ctx.material('gauss', BODY, {
		uDir: { value: [1, 0] },
		uSigma: { value: 1 },
		uFirst: { value: true }
	});
	const tmp = ctx.scratch('gauss-h');
	mat.uniforms.uSigma.value = Math.max(sigma, MIN_SIGMA);
	mat.uniforms.uDir.value = [1, 0];
	mat.uniforms.uFirst.value = true;
	ctx.run(mat, tmp, input);
	mat.uniforms.uDir.value = [0, 1];
	mat.uniforms.uFirst.value = false;
	ctx.run(mat, output, tmp.texture);
}
