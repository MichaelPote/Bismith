// Helpers shared by the filter layers: the distance-source params and pre-pass (bevel / etch), a separable Gaussian
// blur into scratch targets (cavity, height-from-diffuse) and a state reader.

import * as THREE from 'three';
import { P, type ParamDef, type ParamValues } from '@/core/params';
import { SHAPE_MASK } from '@/core/project';
import { DISTANCE_SOURCE, jumpFlood } from '@/gpu/jfa';
import type { FilterContext } from '@/render/materialPipeline';

/** Sources for distance-based filters; their indices come from DISTANCE_SOURCE in gpu/jfa.ts. */
const DISTANCE_SOURCES: [keyof typeof DISTANCE_SOURCE, string][] = [
	['height', 'Height above threshold'],
	['opacity', 'Opacity above threshold'],
	['luminance', 'Luminance above threshold'],
	['mask', 'A mask']
];

/** Contour relaxation for thresholded (jump-flood) sources; see DistanceFieldOptions.relax. */
export const SMOOTH_PARAM: ParamDef = P.float('smooth', 'Edge smoothing', 3, 0, 6, {
	unit: 'px',
	step: 0.01,
	hint: 'Fits the thresholded edge to a smooth line (keeps corners): hides faceting on wide bevels. 0 = follow pixel steps exactly. Masks only shape layers wrote are exact and need none'
});

export const SOURCE_PARAMS: ParamDef[] = [
	P.enum('source', 'Source', 'height', DISTANCE_SOURCES, {
		hint: 'What defines the edge: a channel above the threshold (its distance found by jump flood), or a mask written by a layer above — exact where only shape layers wrote it'
	}),
	P.text('source_mask', 'Mask', SHAPE_MASK, {
		mask: 'read',
		showIf: (p) => p.source === 'mask',
		hint: 'The mask whose edge this follows, by name (Shape: the one shape layers write)'
	}),
	P.float('threshold', 'Threshold', 0.5, -16, 16, {
		softMin: 0,
		softMax: 1,
		step: 0.001,
		showIf: (p) => p.source !== 'mask',
		hint: 'Inside = source value above this'
	})
];

/** LayerDef.maskSource of the edge filters: the mask they follow. */
export const edgeMaskSource = (p: ParamValues): string | null =>
	p.source === 'mask' ? String(p.source_mask ?? '').trim() || SHAPE_MASK : null;

/** Gaussian σ for a blur "radius" (the kernel reaches ~1.5 × radius, i.e. 3σ). */
export const radiusToSigma = (radius: number) => Math.max(radius, 0) * 0.5;
/** Hard cap on the taps either side of a separable blur pass. */
export const MAX_BLUR_TAPS = 192;

// Past MAX_BLUR_TAPS a side, every stride-th texel (stride ≤ 4 up to σ 256, a kernel far wider than its gaps), so a
// wide blur costs no more taps than a radius of 128.
const BLUR4 = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
uniform float uSigma;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 dir = ivec2(uDir);
  int R = int(ceil(uSigma * 3.0));
  int stride = max(1, (R + ${MAX_BLUR_TAPS - 1}) / ${MAX_BLUR_TAPS});
  int n = R / stride;
  float k = gaussK(uSigma);
  vec4 sum = vec4(0.0);
  float ws = 0.0;
  for (int i = -n; i <= n; i++) {
    int o = i * stride;
    float w = exp(float(o * o) * k);
    sum += w * fetchT(tSrc, c + dir * o);
    ws += w;
  }
  oColor = sum / ws;
}
`;

/**
 * Separable Gaussian blur of all four components of `src` (wrap-aware) into a scratch target, which is
 * returned. Its two scratch targets are shared by every caller: the result must be used before the next blur.
 */
export function blurTexture(ctx: FilterContext, src: THREE.Texture, radius: number): THREE.WebGLRenderTarget {
	const h = ctx.scratch('blur:h');
	const v = ctx.scratch('blur:v');
	const mat = ctx.sharedMaterial('blur4', BLUR4, {
		tSrc: { value: null },
		uDir: { value: new THREE.Vector2(1, 0) },
		uSigma: { value: 1 }
	});
	mat.uniforms.uSigma.value = radiusToSigma(radius);
	mat.uniforms.tSrc.value = src;
	(mat.uniforms.uDir.value as THREE.Vector2).set(1, 0);
	ctx.run(mat, h);
	mat.uniforms.tSrc.value = h.texture;
	(mat.uniforms.uDir.value as THREE.Vector2).set(0, 1);
	ctx.run(mat, v);
	return v;
}

const sourceIndex = (params: ParamValues): number =>
	DISTANCE_SOURCE[params.source as keyof typeof DISTANCE_SOURCE] ?? DISTANCE_SOURCE.height;

/**
 * The prepare() of the edge filters (bevel / etch): the source's signed distance (px, negative inside) out to `reach` px
 * as `t_dist` — a jump-flood field in a scratch target, or, for a mask only shape layers wrote, the mask itself (its
 * distance is exact; GLSL_SOURCE_DIST inverts it).
 */
export function sourceDistance(
	ctx: FilterContext,
	params: ParamValues,
	reach: number,
	invert = false
): { dist: THREE.Texture } {
	const source = sourceIndex(params);
	const mask = source === DISTANCE_SOURCE.mask ? ctx.maskSource : null;
	if (mask?.exact) return { dist: mask.texture };
	const field = jumpFlood(ctx, {
		source,
		// A mask's coverage is clamp(0.5 − its distance): its edge where that is a half.
		threshold: mask ? 0.5 : Number(params.threshold ?? 0.5),
		mask: mask?.texture,
		invert,
		maxDistance: reach,
		relax: Number(params.smooth ?? 0)
	});
	return { dist: field.texture };
}

/**
 * GLSL of the edge filters' applyFilter: `sourceDist(ip, invert)`, the distance sourceDistance() found (px, negative
 * inside). A jump-flood field comes inverted already; an exact mask (Source › A mask, only shapes wrote it) is inverted
 * here.
 */
export const GLSL_SOURCE_DIST = /* glsl */ `
float sourceDist(ivec2 ip, bool invert) {
  float d = texelFetch(t_dist, ip, 0).r;
  return invert && u_source == ${DISTANCE_SOURCE.mask} && uMaskSrcExact ? -d : d;
}
`;

/** GLSL: the state at a source position q (px), nearest texel or bilinear, wrapping when tileable (warp, symmetry). */
export const GLSL_READ_STATE = /* glsl */ `
void readState(vec2 q, bool nearest, out vec4 A, out vec4 S, out vec4 E) {
  if (nearest) {
    ivec2 c = ivec2(floor(q));
    A = fetchT(tAlbedo, c);
    S = fetchT(tSurface, c);
    E = fetchT(tEmissive, c);
  } else {
    A = sampleT(tAlbedo, q);
    S = sampleT(tSurface, q);
    E = sampleT(tEmissive, q);
  }
}
`;
