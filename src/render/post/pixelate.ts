// Pixelate post filter: blocks of size×size px, anchored at the top-left (docs/features/fr4.1-post-stack.md).
// Two passes: one texel per block into a small scratch target (average or point sample), then expand.

import { P } from '@/core/params'
import type { PostDef } from './types'

const REDUCE = /* glsl */ `
uniform ivec2 uFull; // full image size
void main() {
  // Block (bx, row-from-top) of this texel; the block target is ceil(full / size) and also y-up.
  int s = max(u_size, 1);
  ivec2 bt = ivec2(gl_FragCoord.xy);
  int rowTop = int(uRes.y) - 1 - bt.y;
  ivec2 lo = ivec2(bt.x * s, rowTop * s);            // top-down image px
  ivec2 hi = min(lo + ivec2(s), uFull);              // exclusive; partial blocks at the right/bottom
  if (u_mode == 1) {
    ivec2 m = min(lo + ivec2(s / 2), uFull - 1);
    oColor = texelFetch(tInput, ivec2(m.x, uFull.y - 1 - m.y), 0);
    return;
  }
  vec4 sum = vec4(0.0);
  for (int y = lo.y; y < hi.y; y++)
    for (int x = lo.x; x < hi.x; x++) {
      vec4 v = texelFetch(tInput, ivec2(x, uFull.y - 1 - y), 0);
      sum += vec4(v.rgb * v.a, v.a); // premultiplied, so transparent pixels don't darken the average
    }
  sum /= float((hi.x - lo.x) * (hi.y - lo.y));
  oColor = vec4(sum.a > 1e-6 ? sum.rgb / sum.a : vec3(0.0), sum.a);
}
`

const EXPAND = /* glsl */ `
uniform sampler2D tBlocks;
uniform ivec2 uBlocks;
void main() {
  int s = max(u_size, 1);
  ivec2 ip = ivec2(gl_FragCoord.xy);
  int rowTop = int(uRes.y) - 1 - ip.y;
  oColor = texelFetch(tBlocks, ivec2(ip.x / s, uBlocks.y - 1 - rowTop / s), 0);
}
`

export const pixelatePost: PostDef = {
  type: 'pixelate',
  label: 'Pixelate',
  description: 'Chunky pixels: replace each block with its average (or centre) colour. Blocks start at the top-left.',
  params: [
    P.int('size', 'Block size', 4, 1, 128, { softMax: 32, unit: 'px' }),
    P.enum('mode', 'Sample', 'average', [
      ['average', 'Average'],
      ['point', 'Centre pixel'],
    ]),
  ],
  run(ctx, input, output) {
    const s = Math.max(1, Math.round(Number(ctx.filter.params.size ?? 4)))
    const bw = Math.ceil(ctx.width / s)
    const bh = Math.ceil(ctx.height / s)
    const blocks = ctx.scratch('blocks', bw, bh)
    const reduce = ctx.material('reduce', REDUCE, { uFull: { value: [0, 0] } })
    reduce.uniforms.uFull.value = [ctx.width, ctx.height]
    ctx.run(reduce, blocks, input)
    const expand = ctx.material('expand', EXPAND, { tBlocks: { value: null }, uBlocks: { value: [0, 0] } })
    expand.uniforms.tBlocks.value = blocks.texture
    expand.uniforms.uBlocks.value = [bw, bh]
    ctx.run(expand, output, null)
  },
}
