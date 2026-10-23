// Helpers shared by the filter layers: the distance-source params and pass (bevel / etch), a separable Gaussian
// blur into scratch targets (cavity, height-from-diffuse), the final MRT pass of run() filters and a state reader.

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

const BLUR4 = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
uniform float uSigma;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 dir = ivec2(uDir);
  int R = gaussTaps(uSigma, ${MAX_BLUR_TAPS});
  float k = gaussK(uSigma);
  vec4 sum = vec4(0.0);
  float ws = 0.0;
  for (int i = -R; i <= R; i++) {
    float w = exp(float(i * i) * k);
    sum += w * fetchT(tSrc, c + dir * i);
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
 * Signed distance (px, negative inside) of the layer's source: a jump-flood field in a scratch target — or, for a mask
 * only shape layers wrote, the mask itself (its distance is exact), read with `sign` −1 when inverted.
 */
function sourceDistance(
	ctx: FilterContext,
	params: ParamValues,
	maxDistance: number,
	invert = false
): { texture: THREE.Texture; sign: number } {
	const source = sourceIndex(params);
	const mask = source === DISTANCE_SOURCE.mask ? ctx.maskSource : null;
	if (mask?.exact) return { texture: mask.texture, sign: invert ? -1 : 1 };
	const field = jumpFlood(ctx, {
		source,
		// A mask's coverage is clamp(0.5 − its distance): its edge where that is a half.
		threshold: mask ? 0.5 : Number(params.threshold ?? 0.5),
		mask: mask?.texture,
		invert,
		maxDistance,
		relax: Number(params.smooth ?? 0)
	});
	return { texture: field.texture, sign: 1 };
}

const GLSL_SOURCE_DIST = /* glsl */ `
uniform sampler2D tDist;
uniform float uDistSign;
float sourceDist(ivec2 ip) { return uDistSign * texelFetch(tDist, ip, 0).r; }
`;

/**
 * The main() of a run() filter's final MRT pass: the state through `applyFilter(A, S, E, ip)`, which `glsl` defines as
 * a filterGlsl does (the limit is applied after the pass, by the pipeline).
 */
export const mrtApply = (glsl: string) => /* glsl */ `${glsl}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(tAlbedo, ip, 0);
  vec4 S = texelFetch(tSurface, ip, 0);
  vec4 E = texelFetch(tEmissive, ip, 0);
  applyFilter(A, S, E, ip);
  oAlbedo = A;
  oSurface = S;
  oEmissive = E;
}
`;

/**
 * Bevel / etch: find the source's signed distance out to `reach` px, then run `glsl` (an applyFilter that reads it as
 * `sourceDist(ip)`, in px, negative inside).
 */
export function runEdgeFilter(
	ctx: FilterContext,
	params: ParamValues,
	glsl: string,
	reach: number,
	invert = false
): void {
	const src = sourceDistance(ctx, params, reach, invert);
	const mat = ctx.mrtMaterial('apply', mrtApply(GLSL_SOURCE_DIST + glsl), {
		tDist: { value: null },
		uDistSign: { value: 1 }
	});
	mat.uniforms.tDist.value = src.texture;
	mat.uniforms.uDistSign.value = src.sign;
	ctx.runMRT(mat);
}

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
