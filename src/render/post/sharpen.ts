// Sharpen post filter: unsharp mask (docs/features/fr4.1-post-stack.md).

import { P } from '@/core/params'
import { gaussianBlur } from './gaussian'
import type { PostDef } from './types'

const BODY = /* glsl */ `
uniform sampler2D tBlur;
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(tInput, ip, 0);
  vec3 b = texelFetch(tBlur, ip, 0).rgb;
  vec3 d = c.rgb - b;
  if (u_luma_only) d = vec3(luma(d));
  // Threshold: leave low-contrast detail (noise) alone, with a short soft ramp.
  float m = u_luma_only ? abs(d.r) : max(abs(d.r), max(abs(d.g), abs(d.b)));
  float gate = u_threshold > 0.0 ? smoothstep(u_threshold * 0.5, u_threshold, m) : 1.0;
  oColor = vec4(max(c.rgb + d * u_amount * gate, 0.0), c.a);
}
`

export const sharpenPost: PostDef = {
  type: 'sharpen',
  label: 'Sharpen',
  description: 'Unsharp mask: adds back the difference between the image and a Gaussian-blurred copy.',
  params: [
    P.float('amount', 'Amount', 1, 0, 10, { softMax: 3, step: 0.01 }),
    P.float('radius', 'Radius', 1, 0.2, 20, {
      softMax: 4,
      step: 0.01,
      unit: 'px',
      hint: 'Gaussian σ of the blurred copy.',
    }),
    P.float('threshold', 'Threshold', 0, 0, 1, {
      softMax: 0.2,
      step: 0.001,
      hint: 'Differences smaller than this (linear units) are not sharpened.',
    }),
    P.bool('luma_only', 'Luminance only', false, { hint: 'Sharpen brightness only (no colour fringes).' }),
  ],
  run(ctx, input, output) {
    const blurred = ctx.scratch('blurred')
    gaussianBlur(ctx, input, blurred, Number(ctx.filter.params.radius ?? 1))
    const mat = ctx.material('combine', BODY, { tBlur: { value: null } })
    mat.uniforms.tBlur.value = blurred.texture
    ctx.run(mat, output, input)
  },
}
