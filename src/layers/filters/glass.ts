// Glass (FR8.12): turns the area inside the Shape mask into glass over what is already painted — the background
// refracted through the surface (its slope from the height), carried mostly as transmitted light (not shaded by the
// glass surface), tinted more where the path through the glass is longer (towards the rims), Fresnel-darkened rims,
// an inner glint where light focuses on the far side, and a smooth, reflective surface for the lights' highlights.

import { P } from '@/core/params'
import type { LayerDef } from '../types'

export const glassLayer: LayerDef = {
  type: 'glass',
  channels: { diffuse: true },
  label: 'Glass',
  category: 'filter',
  kind: 'filter',
  readsMask: true,
  description: 'Glass over the layers below, inside the current shape (e.g. pipework tubes): refraction from the height, tint, Fresnel rims, an inner glint, glossy highlights.',
  params: [
    P.float('refraction', 'Refraction', 4, 0, 128, { softMax: 16, unit: 'px', step: 0.1, hint: 'How far the background is bent at the steepest slope: magnified in the middle, squeezed towards the rims' }),
    P.color('tint', 'Tint', '#9ad0c0'),
    P.float('tint_amount', 'Tint strength', 0.35, 0, 1, { step: 0.01, hint: 'Grows towards the rims, where light crosses more glass' }),
    P.float('transmit', 'Transmission', 0.7, 0, 1, { step: 0.01, hint: 'Share of the background carried as transmitted (unshaded) light; the rest is lit like a surface' }),
    P.color('rim', 'Rim colour', '#1c2a26'),
    P.float('fresnel', 'Rim darkening', 0.7, 0, 1, { step: 0.01, hint: 'Edges seen at a grazing angle reflect more and show less of the background' }),
    P.float('glint', 'Inner glint', 0.6, 0, 2, { step: 0.01, hint: 'A bright line on the far side from the light, where the glass focuses it' }),
    P.enum('light', 'Light from', 'top-left', [['top-left', 'Top left'], ['top', 'Top'], ['top-right', 'Top right'], ['left', 'Left'], ['right', 'Right']], { hint: 'For the inner glint (match the key light)' }),
    P.float('roughness', 'Roughness', 0.06, 0, 1, { step: 0.01 }),
    P.float('specular', 'Specular', 0.9, 0, 1, { step: 0.01 }),
  ],
  filterGlsl: /* glsl */ `
void applyFilter(inout vec4 A, inout vec4 S, inout vec4 E, ivec2 ip) {
  float m = clamp(0.5 - maskIn(ip), 0.0, 1.0);
  if (m <= 0.0) return;
  // Surface normal from the height (px per px).
  float hl = fetchT(tSurface, ip - ivec2(1, 0)).r, hr = fetchT(tSurface, ip + ivec2(1, 0)).r;
  float hd = fetchT(tSurface, ip - ivec2(0, 1)).r, hu = fetchT(tSurface, ip + ivec2(0, 1)).r;
  vec2 g = 0.5 * vec2(hr - hl, hu - hd) * uDepth;
  vec3 n = normalize(vec3(-g, 1.0));
  vec2 p = vec2(ip) + 0.5;
  // Refraction: sample further out along the slope (a magnifying, rim-squeezing lens).
  vec3 behind = sampleT(tAlbedo, p + n.xy * u_refraction).rgb;
  float rim = clamp(1.0 - n.z, 0.0, 1.0);
  vec3 through = behind * mix(vec3(1.0), u_tint, clamp(u_tint_amount * (0.5 + 2.0 * rim), 0.0, 1.0));
  float F = clamp(u_fresnel * pow(rim, 1.5) * 1.6, 0.0, 1.0);
  vec3 col = mix(through, u_rim, F);
  // Transmitted light is not shaded by the glass surface: carry it as emission, keep the rest as albedo.
  float tr = u_transmit * (1.0 - F);
  A.rgb = mix(A.rgb, col * (1.0 - tr), m);
  E.rgb += m * col * tr;
  // Inner glint: on the far side from the light, just inside the rim.
  vec2 L = u_light == 0 ? vec2(-0.7071, 0.7071) : u_light == 1 ? vec2(0.0, 1.0) : u_light == 2 ? vec2(0.7071, 0.7071) : u_light == 3 ? vec2(-1.0, 0.0) : vec2(1.0, 0.0);
  vec2 nd = n.xy / max(length(n.xy), 1e-4);
  float glint = u_glint * smoothstep(0.5, 0.9, dot(nd, -L)) * smoothstep(0.08, 0.3, rim) * (1.0 - smoothstep(0.55, 0.8, rim));
  E.rgb += m * glint * mix(vec3(1.0), u_tint, 0.3);
  // Glossy.
  S.g = mix(S.g, u_roughness, m);
  E.a = mix(E.a, u_specular, m);
}
`,
}
