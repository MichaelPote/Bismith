// Grade post filter: brightness, contrast, saturation, hue shift, tint (docs/features/fr4.1-post-stack.md).
//
// Meant to sit AFTER Tonemap (display-referred linear 0..1), like an image editor's adjustments:
// - brightness/contrast use GIMP's Brightness-Contrast formula on sRGB-encoded (perceptual) values, so 0.5 grey
//   is the contrast pivot and black/white stay put for brightness;
// - saturation scales chroma and hue rotates hue in OKLab (perceptually uniform, keeps lightness);
// - tint multiplies in linear light.
// It also runs before Tonemap on HDR data, but brightness then compresses values above 1 towards 1.

import { P } from '@/core/params'
import type { PostDef } from './types'

export const gradePost: PostDef = {
  type: 'grade',
  label: 'Grade',
  description: 'Brightness, contrast, saturation, hue shift and tint. Put it after Tonemap.',
  params: [
    P.float('brightness', 'Brightness', 0, -1, 1, { step: 0.01 }),
    P.float('contrast', 'Contrast', 0, -1, 1, { step: 0.01 }),
    P.float('saturation', 'Saturation', 0, -1, 2, { softMax: 1, step: 0.01, hint: '-1 = greyscale, 1 = double.' }),
    P.float('hue', 'Hue shift', 0, -180, 180, { step: 0.1, unit: '°' }),
    P.color('tint', 'Tint', '#ffffff'),
  ],
  glsl: /* glsl */ `
vec3 gradeOklabToLinear(vec3 c) {
  float l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  float l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
vec4 post(ivec2 ip) {
  vec4 c = texelFetch(tInput, ip, 0);
  vec3 x = max(c.rgb, vec3(0.0)) * u_tint;
  // GIMP brightness-contrast on perceptual values.
  vec3 e = linearToSrgb(x);
  float b = u_brightness * 0.5;
  e = b < 0.0 ? e * (1.0 + b) : e + (1.0 - e) * b;
  float slant = tan((clamp(u_contrast, -1.0, 0.999) + 1.0) * PI * 0.25);
  e = (e - 0.5) * slant + 0.5;
  x = srgbToLinear(max(e, vec3(0.0)));
  // Saturation + hue in OKLab.
  if (u_saturation != 0.0 || u_hue != 0.0) {
    vec3 lab = linearToOklab(x);
    float h = radians(u_hue);
    lab.yz = mat2(cos(h), sin(h), -sin(h), cos(h)) * lab.yz * max(1.0 + u_saturation, 0.0);
    x = max(gradeOklabToLinear(lab), vec3(0.0));
  }
  return vec4(x, c.a);
}
`,
}
