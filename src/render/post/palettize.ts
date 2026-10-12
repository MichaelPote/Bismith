// Palette post filter (docs/features/fr4.2-palettisation.md): snap to a fixed palette with optional ordered
// dithering. Expects display-referred linear input (put it after Tonemap, last in the stack): the colour is
// encoded to sRGB, offset by a Bayer threshold, matched to the nearest entry (OKLab or RGB) and written back as
// that entry's exact linear value, so the final 8-bit sRGB export lands exactly on palette colours.

import * as THREE from 'three'
import { P } from '@/core/params'
import type { PostDef } from './types'
import { DEFAULT_CUSTOM_PALETTE, MAX_PALETTE, PALETTE_OPTIONS, paletteColors, preparePalette } from './palettes'

interface PaletteGpu {
  texture: THREE.DataTexture
  count: number
  spread: number
}

// Lookup textures by palette content (a stack may hold several Palette filters with different palettes).
const cache = new Map<string, PaletteGpu>()
const CACHE_MAX = 8

/** 256×3 RGBA float: row 0 = linear RGB (output), row 1 = sRGB-encoded RGB, row 2 = OKLab. */
function paletteTexture(colors: string[]): PaletteGpu {
  const key = colors.join('')
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit) // most recently used last
    return hit
  }
  const p = preparePalette(colors)
  const data = new Float32Array(MAX_PALETTE * 3 * 4)
  const rows = [p.linear, p.srgb, p.oklab]
  rows.forEach((row, r) => {
    row.forEach((c, i) => data.set([c[0], c[1], c[2], 1], (r * MAX_PALETTE + i) * 4))
  })
  const texture = new THREE.DataTexture(data, MAX_PALETTE, 3, THREE.RGBAFormat, THREE.FloatType)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  const entry = { texture, count: colors.length, spread: p.spread }
  cache.set(key, entry)
  while (cache.size > CACHE_MAX) {
    const [oldKey, old] = cache.entries().next().value!
    old.texture.dispose()
    cache.delete(oldKey)
  }
  return entry
}

const BODY = /* glsl */ `
uniform sampler2D tPal;
uniform int uPalCount;
uniform float uPalSpread;

// n×n Bayer threshold in (-0.5, 0.5), n = 2^bits; p in image px (y down). Matches palettes.ts bayerThreshold.
float palBayer(ivec2 p, int bits) {
  int v = 0;
  for (int i = 0; i < 3; i++) {
    if (i >= bits) break;
    int bx = (p.x >> i) & 1;
    int by = (p.y >> i) & 1;
    v += (((bx ^ by) << 1) | by) << (2 * (bits - 1 - i));
  }
  float n = float(1 << bits);
  return (float(v) + 0.5) / (n * n) - 0.5;
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(tInput, ip, 0);
  if (uPalCount <= 0) { oColor = c; return; }
  ivec2 img = ivec2(ip.x, int(uRes.y) - 1 - ip.y);
  float t = u_dither > 0 ? palBayer(img, u_dither) * u_strength : 0.0;
  vec3 e = clamp(linearToSrgb(clamp(c.rgb, 0.0, 1.0)), 0.0, 1.0);
  e = clamp(e + t * uPalSpread, 0.0, 1.0);
  int row = u_metric == 0 ? 2 : 1;
  vec3 q = u_metric == 0 ? linearToOklab(srgbToLinear(e)) : e;
  int best = 0;
  float bestD = 1e30;
  for (int i = 0; i < ${MAX_PALETTE}; i++) {
    if (i >= uPalCount) break;
    vec3 d = q - texelFetch(tPal, ivec2(i, row), 0).rgb;
    float dd = dot(d, d);
    if (dd < bestD) { bestD = dd; best = i; }
  }
  float a = c.a;
  if (u_alpha == 1) a = a + t >= 0.5 ? 1.0 : 0.0;
  else if (u_alpha == 2) a = 1.0;
  oColor = vec4(texelFetch(tPal, ivec2(best, 0), 0).rgb, a);
}
`

export const palettePost: PostDef = {
  type: 'palette',
  label: 'Palette',
  description:
    'Snap to a fixed palette (8-bit retro look) with optional ordered dithering. Put it last, after Tonemap: ' +
    'exported pixels are then exactly palette colours.',
  params: [
    P.enum('palette', 'Palette', 'quake', PALETTE_OPTIONS),
    P.text('custom', 'Colours', DEFAULT_CUSTOM_PALETTE, {
      showIf: (p) => p.palette === 'custom',
      hint: 'Hex colours (#rrggbb) separated by spaces, commas or new lines; GIMP .gpl / JASC .pal text also works.',
    }),
    P.enum('metric', 'Match in', 'oklab', [
      ['oklab', 'OKLab (perceptual)'],
      ['rgb', 'RGB'],
    ]),
    P.enum('dither', 'Dither', 'none', [
      ['none', 'None'],
      ['bayer2', 'Bayer 2×2'],
      ['bayer4', 'Bayer 4×4'],
      ['bayer8', 'Bayer 8×8'],
    ]),
    P.float('strength', 'Dither strength', 1, 0, 4, {
      softMax: 2,
      step: 0.01,
      showIf: (p) => p.dither !== 'none',
      hint: '1 = the palette’s typical step between neighbouring colours.',
    }),
    P.enum('alpha', 'Alpha', 'keep', [
      ['keep', 'Keep'],
      ['cutout', 'Cut out (0 / 1)'],
      ['opaque', 'Opaque'],
    ], { hint: 'Cut out thresholds alpha at 50% (dithered when dithering is on), like Quake { fence textures.' }),
  ],
  run(ctx, input, output) {
    const p = ctx.filter.params
    const colors = paletteColors(String(p.palette ?? 'quake'), String(p.custom ?? ''))
    if (colors.length === 0) throw new Error('The custom palette has no colours — enter hex colours like #ff8800.')
    const pal = paletteTexture(colors)
    const mat = ctx.material('main', BODY, {
      tPal: { value: null },
      uPalCount: { value: 0 },
      uPalSpread: { value: 0 },
    })
    mat.uniforms.tPal.value = pal.texture
    mat.uniforms.uPalCount.value = pal.count
    mat.uniforms.uPalSpread.value = pal.spread
    ctx.run(mat, output, input)
  },
}
