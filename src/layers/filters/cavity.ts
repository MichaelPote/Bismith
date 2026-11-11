// Cavity / edge wear: curvature = height − blur(height). Convex edges get worn (a highlight colour, usually
// smoother), cavities collect dirt (a dark colour, usually rougher, not metal), each from the curvature at its own
// Radius, Threshold and Sensitivity, softened inwards by its own Feather; both broken up by tileable fBm. Each goes on
// by its own Blend mode, as a solid colour or (Source › Shape) a colour ramp along the distance from a mask's edge.

import type * as THREE from 'three';
import { P, gradient, type Gradient, type ParamValues } from '@/core/params';
import { SHAPE_MASK, type Layer } from '@/core/project';
import type { FilterContext } from '@/render/materialPipeline';
import { BLEND_MODES } from '../commonParams';
import type { LayerDef } from '../types';
import { blurTexture } from './shared';

// prepare's pass: the wear and dirt masks (r, g) from the curvature in px of relief (height × heightDepth; > 0 convex,
// < 0 concave), each at its own Radius (tBlurW / tBlurD), Threshold and Sensitivity; and where each is on (b, a), which
// its Feather blurs.
const MASK_PASS = /* glsl */ `
uniform sampler2D tBlurW;
uniform sampler2D tBlurD;
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  float h = texelFetch(tSurface, ip, 0).r;
  vec2 c = vec2(h - texelFetch(tBlurW, ip, 0).r, texelFetch(tBlurD, ip, 0).r - h) * uDepth;
  vec2 threshold = vec2(u_wear_threshold, u_dirt_threshold);
  vec2 m = clamp((c - threshold) * vec2(u_wear_sensitivity, u_dirt_sensitivity), 0.0, 1.0);
  oColor = vec4(m, step(vec2(1e-3), m));
}
`;

const CAVITY_APPLY = /* glsl */ `
// Remove part of a mask where the noise is low; amount 0 keeps everything, 1 removes everything. The edge fades across
// 0.3 of the noise's range, widened by Feather px (from the noise's slope here, px⁻¹); its centre runs from below the
// range to above it, so 0 and 1 stay whole however wide the fade.
float breakup(float n, float amount, float slope) {
  float c = clamp((n - 0.5) * 2.5 + 0.5, 0.0, 1.0);
  float hw = 0.15 + 0.5 * u_noise_feather * slope * 2.5;
  float a = mix(-hw, 1.0 + hw, amount);
  return smoothstep(a - hw, a + hw, c);
}

void applyFilter(inout vec4 A, inout vec4 S, inout vec4 E, ivec2 ip) {
  // The wear and dirt masks (prepare's), each with a Feather faded in from its outline: its coverage blurred by the
  // Feather is ½ on the outline and 1 about a Feather inside, so 2 × it − 1 eats in from the edge and never spreads past.
  vec2 m = texelFetch(t_masks, ip, 0).rg;
  vec2 f = clamp(2.0 * vec2(texelFetch(t_fwear, ip, 0).b, texelFetch(t_fdirt, ip, 0).a) - 1.0, 0.0, 1.0);
  m *= mix(vec2(1.0), f, step(vec2(1e-6), vec2(u_wear_feather, u_dirt_feather)));
  vec2 m0 = m;
  if (u_wear_noise > 0.0 || u_dirt_noise > 0.0) {
    gPhase = u_phase;
    vec2 cells = cellsFor(u_noise_scale, 1.0);
    ivec2 per = periodOf(cells);
    vec2 x = gl_FragCoord.xy / uRes * cells;
    // Both masks' fBm in one call (breakup of amount 0 is 1).
    vec2 n = fbmPair(x, x, per, u_noise_octaves, uSeed + 11.0, uSeed + 57.0, 2);
    vec2 dx = dFdx(n), dy = dFdy(n);
    vec2 slope = sqrt(dx * dx + dy * dy);
    m *= vec2(breakup(n.x, u_wear_noise, slope.x), breakup(n.y, u_dirt_noise, slope.y));
  }
  float wear = m.x * u_wear_amount;
  float dirt = m.y * u_dirt_amount;
  // Colour ramps: 0 at the Shape mask's edge (either side: wear runs into a stone, dirt into a joint) → 1 a Ramp width
  // away, a share of the curvature's reach (the blur's, 1.5 × its Radius); with the mask empty, from the strongest
  // curvature (0) to none (1).
  float d = fetchT(tMaskSrc, ip).x;
  vec2 width = max(vec2(u_wear_width * u_wear_radius, u_dirt_width * u_dirt_radius) * 1.5, vec2(1e-3));
  vec2 t = maskEmpty(d) ? 1.0 - m0 : clamp(abs(d) / width, 0.0, 1.0);
  // The colours in sRGB: a solid one (stored linear) or the ramp's.
  // (A ramp stop's opacity thins the wear or dirt there.)
  vec4 wearRamp = gradientLookupA(u_wear_grad_stops, u_wear_grad_alpha, u_wear_grad_count, t.x);
  vec4 dirtRamp = gradientLookupA(u_dirt_grad_stops, u_dirt_grad_alpha, u_dirt_grad_count, t.y);
  vec3 wearCol = u_wear_src == 1 ? wearRamp.rgb : linearToSrgb(u_wear_color);
  vec3 dirtCol = u_dirt_src == 1 ? dirtRamp.rgb : linearToSrgb(u_dirt_color);
  if (u_wear_src == 1) wear *= wearRamp.a;
  if (u_dirt_src == 1) dirt *= dirtRamp.a;
  // Dirt, then wear over it, each blended by its mode in sRGB (as a layer's Diffuse is) and mixed in by its mask; Normal
  // is a plain mix. (One blendMode call in a loop: D3D inlines every call.)
  for (int i = 0; i < 2 * UNI_1; i++) {
    bool w = i == 1;
    vec3 top = blendMode(w ? u_wear_blend : u_dirt_blend, linearToSrgb(A.rgb), w ? wearCol : dirtCol);
    A.rgb = mix(A.rgb, srgbToLinear(top), w ? wear : dirt);
  }
  S.g = clamp(S.g + wear * u_wear_rough + dirt * u_dirt_rough, 0.0, 1.0);
  // Dirt is not metal: on a metal it stops reflecting like one as far as the dirt covers.
  S.b *= 1.0 - dirt;
}
`;

const SOURCES: [string, string, string][] = [
	['solid', 'Solid', 'one colour'],
	['shape', 'Shape', "follows the shape: the colour ramp along the distance from the Shape mask's edge"]
];
const shaped = (p: ParamValues) => p.wear_src === 'shape' || p.dirt_src === 'shape';

/**
 * Edge wear's or Cavity dirt's colour: Source · Blend on one row (as a layer's Diffuse), then for Solid its Colour, for
 * Shape the Colour ramp and its width (the ramp's left end at the Shape mask's edge, its right end the width away, as a
 * share of the curvature's reach: 1.5 × its Radius).
 */
const colourParams = (k: 'wear' | 'dirt', colour: string, ramp: Gradient, blendNote: string) => {
	const isShape = (p: ParamValues) => p[`${k}_src`] === 'shape';
	return [
		P.enum(`${k}_src`, 'Source', 'solid', SOURCES, {
			group: k,
			join: { with: `${k}_blend`, as: 'pair', label: 'Source · Blend' },
			hint: `Picks what colours the ${k}: one colour, or the colour ramp along the shape, from the Shape mask's edge inwards`
		}),
		P.enum(`${k}_blend`, 'Blend', 'normal', BLEND_MODES, {
			group: k,
			hint: `Sets how the ${k} colour mixes with the colour below: ${blendNote}, Overlay and Soft light keep its detail`
		}),
		P.color(`${k}_color`, 'Colour', colour, { group: k, showIf: (p) => !isShape(p) }),
		P.gradient(`${k}_grad`, 'Colour ramp', ramp, {
			group: k,
			alpha: true,
			showIf: isShape,
			hint: `Colours the ${k} by distance from the Shape mask's edge: the left end at the edge, the right end a Ramp width away`
		}),
		P.float(`${k}_width`, 'Ramp width', 1, 0.01, 4, {
			group: k,
			softMax: 1,
			step: 0.001,
			showIf: isShape,
			hint: `Sets how far from the Shape mask's edge the ramp reaches its right end, as a share of how far the ${k} reaches (about 1.5 × its Radius): 1 spreads the ramp across it, 0.5 over its outer half`
		})
	];
};

/** Edge wear's or Cavity dirt's mask: the curvature at its Radius, Threshold and Sensitivity. */
const curvatureParams = (k: 'wear' | 'dirt') => [
	P.float(`${k}_radius`, 'Radius', 3, 0.5, 512, {
		group: k,
		softMax: 128,
		unit: 'px',
		step: 0.1,
		hint: `Sets the scale of the curvature the ${k} follows: it reaches about 1.5 × this from an edge`
	}),
	P.float(`${k}_threshold`, 'Threshold', 0.1, 0, 64, {
		group: k,
		softMax: 4,
		unit: 'px',
		step: 0.01,
		hint: `Ignores curvature (px of relief) up to this before the ${k} starts`
	}),
	P.float(`${k}_sensitivity`, 'Sensitivity', 0.5, 0, 16, {
		group: k,
		softMax: 4,
		step: 0.01,
		perPx: true,
		hint: `Sets how fast the ${k} builds up per px of curvature past the Threshold`
	})
];

const featherParam = (k: 'wear' | 'dirt') =>
	P.float(`${k}_feather`, 'Feather', 0, 0, 256, {
		group: k,
		softMax: 32,
		unit: 'px',
		step: 0.1,
		hint: `Softens the ${k} inwards from its outline across about this width, without spreading past it (narrower parts fade out)`
	});

/**
 * The masks (`t_masks`): the height blurred at the wear's and the dirt's Radius (once when they match), then one pass for
 * both masks and where each is on; with a Feather, that coverage blurred by it (`t_fwear`, `t_fdirt`). The blur's scratch
 * targets are shared, so a result needed past the next blur is copied out first.
 */
function prepareCavity(ctx: FilterContext, layer: Layer): Record<string, THREE.Texture> {
	const p = layer.params;
	const rw = Number(p.wear_radius ?? 3);
	const rd = Number(p.dirt_radius ?? 3);
	let blurW = blurTexture(ctx, ctx.surface, rw).texture;
	let blurD = blurW;
	if (rd !== rw) {
		const keep = ctx.scratch('cavity:blur');
		ctx.gpu.copy(blurW, keep);
		blurW = keep.texture;
		blurD = blurTexture(ctx, ctx.surface, rd).texture;
	}
	const masks = ctx.scratch('cavity:masks');
	const mat = ctx.material('cavity-masks', MASK_PASS, { tBlurW: { value: null }, tBlurD: { value: null } });
	mat.uniforms.tBlurW.value = blurW;
	mat.uniforms.tBlurD.value = blurD;
	ctx.run(mat, masks);
	const fw = Math.max(0, Number(p.wear_feather ?? 0));
	const fd = Math.max(0, Number(p.dirt_feather ?? 0));
	let fwear = masks.texture;
	if (fw > 0) {
		const keep = ctx.scratch('cavity:fwear');
		ctx.gpu.copy(blurTexture(ctx, masks.texture, fw).texture, keep);
		fwear = keep.texture;
	}
	const fdirt = fd > 0 ? blurTexture(ctx, masks.texture, fd).texture : masks.texture;
	return { masks: masks.texture, fwear, fdirt };
}

export const cavityLayer: LayerDef = {
	type: 'cavity',
	channels: { diffuse: true },
	label: 'Cavity / edge wear',
	category: 'filter',
	kind: 'filter',
	description: 'Worn highlights on convex edges and dirt in crevices, from the curvature of the height below.',
	params: [
		P.text('shape_mask', 'Shape mask', SHAPE_MASK, {
			mask: 'read',
			showIf: shaped,
			hint: "Names the mask whose edge a Shape source follows (Shape: the one shape layers write). Exact where only shape layers wrote it; with the mask empty, the colour ramp follows the curvature's strength instead"
		}),
		P.float('wear_amount', 'Amount', 0.7, 0, 1, { step: 0.001, group: 'wear' }),
		...curvatureParams('wear'),
		...colourParams('wear', '#b4a690', gradient('#d6cab4', '#8e8068'), 'Screen and Add lighten'),
		P.float('wear_rough', 'Roughness Δ', -0.2, -1, 1, { step: 0.001, group: 'wear' }),
		P.float('wear_noise', 'Breakup', 0.35, 0, 1, { step: 0.001, group: 'wear' }),
		featherParam('wear'),
		P.float('dirt_amount', 'Amount', 0.7, 0, 1, { step: 0.001, group: 'dirt' }),
		...curvatureParams('dirt'),
		...colourParams('dirt', '#17120d', gradient('#0c0906', '#3c3024'), 'Multiply and Darken deepen it'),
		P.float('dirt_rough', 'Roughness Δ', 0.15, -1, 1, { step: 0.001, group: 'dirt' }),
		P.float('dirt_noise', 'Breakup', 0.25, 0, 1, { step: 0.001, group: 'dirt' }),
		featherParam('dirt'),
		P.float('noise_scale', 'Scale', 12, 0.25, 256, {
			softMax: 64,
			step: 0.01,
			group: 'breakup',
			hint: 'Cells across the texture (rounded when tiling)'
		}),
		P.int('noise_octaves', 'Octaves', 4, 1, 8, { group: 'breakup' }),
		P.float('noise_feather', 'Feather', 0, 0, 128, {
			softMax: 16,
			unit: 'px',
			step: 0.1,
			group: 'breakup',
			hint: "Softens the breakup's edges, widening the fade where the noise cuts the wear and dirt by about this many px"
		}),
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
	maskSource: (p) => (shaped(p) ? String(p.shape_mask ?? '').trim() || SHAPE_MASK : null),
	textures: ['masks', 'fwear', 'fdirt'],
	prepare: prepareCavity,
	filterGlsl: CAVITY_APPLY
};
