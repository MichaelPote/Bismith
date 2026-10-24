// Pixel-unit scaling: params measured in texture pixels follow the canvas size, so a texture looks the same at any
// resolution. Used by supersampling (core/supersample.ts: the stack runs at k× and is averaged down) and by resizing the
// canvas (resizeProject: the stored values change, so sliders keep showing true pixels).
//
// What scales, by the length factor s (√(kx·ky): the side of the texture's area — path-independent, so 256² → 512×256
// → 512² comes out as one 2× step): ParamDef unit 'px' values × s (bevels, joints, radii, widths, block sizes, light
// heights …), point lights' falloff reference (Light.refDist) × s, perPx values ÷ s (gains per px of curvature),
// perArea counts ÷ kx·ky (scratches per 64×64 px), and the project's height depth × s (so slopes stay the same). Lengths and positions tied to one axis follow that side alone:
// ParamDef axis 'x' / 'y' (rect width / height, a band's thickness across horizontal bands) and sliderSpan offsets ×
// kx / ky, and vertex lists ("x,y x,y …" in px) per coordinate. Counts per texture or per cell ("cells
// across"), fractions, angles and height amounts (height units × height depth) need nothing.

import type { ParamDef, ParamValues } from './params';
import type { Project } from './project';
import { layerParamDefs } from '@/layers/registry';
import { getPostDef } from '@/render/post/registry';
import { getRecipe } from '@/recipes';
import { LIGHT_DEFS, POINT_LIGHT_REF_DIST } from './lights';

export interface PixelScale {
	/** Texture pixels per old pixel along x and y. */
	kx: number;
	ky: number;
	/** Round int params and clamp to the hard limits (stored values; supersampling's inner project leaves them be). */
	tidy?: boolean;
	/** Supersampling: one output pixel becomes k shader pixels (ParamDef outputPx scales too). */
	supersample?: boolean;
}

/** Scale the numbers of a vertex list ("x,y x,y …"), x by kx and y by ky. */
function scalePoints(src: string, kx: number, ky: number): string {
	let i = 0;
	return src.replace(/-?\d*\.?\d+(?:e-?\d+)?/gi, (n) => String(Number(n) * (i++ % 2 ? ky : kx)));
}

/** The texture axis a px length runs along (null = both). */
function axisOf(d: ParamDef, params: ParamValues): 'x' | 'y' | null {
	if (d.sliderSpan) return d.sliderSpan === 'width' ? 'x' : 'y';
	return typeof d.axis === 'function' ? d.axis(params) : (d.axis ?? null);
}

/** The factor a param's value is multiplied by (1 = not pixel-measured); `params` = its layer's, for orientation. */
export function pixelFactor(d: ParamDef, { kx, ky, supersample }: PixelScale, params: ParamValues = {}): number {
	const s = Math.sqrt(kx * ky);
	if (d.outputPx && !supersample) return 1;
	if (d.unit === 'px') {
		const axis = axisOf(d, params);
		return axis === 'x' ? kx : axis === 'y' ? ky : s;
	}
	if (d.perPx) return 1 / s;
	if (d.perArea) return 1 / (kx * ky);
	return 1;
}

/** Scale the pixel-measured values of `params` in place. `units` = the layer's units param ('fraction' vertex lists stay). */
export function scaleParams(defs: ParamDef[], params: ParamValues, scale: PixelScale): void {
	const before = { ...params };
	for (const d of defs) {
		const v = params[d.key];
		if (typeof v === 'number') {
			const f = pixelFactor(d, scale, before);
			if (f === 1) continue;
			let x = v * f;
			if (scale.tidy) {
				x = d.type === 'int' ? Math.round(x) : Number(x.toPrecision(6));
				if (d.min !== undefined) x = Math.max(d.min, x);
				if (d.max !== undefined) x = Math.min(d.max, x);
			}
			params[d.key] = x;
		} else if (
			typeof v === 'string' &&
			(d.bitmap === 'points' || d.bitmap === 'lines') &&
			params.units !== 'fraction'
		) {
			params[d.key] = scalePoints(v, scale.kx, scale.ky);
		}
	}
}

/**
 * Scale every pixel-measured value of `p` in place (not its width / height): layer params, lights, AO radius, height
 * depth, smart-material macros and, with `post`, post filters (supersampling runs those after the downsample, at the
 * real size).
 */
export function scalePixels(p: Project, scale: PixelScale & { post: boolean }): void {
	const s = Math.sqrt(scale.kx * scale.ky);
	const tidy = (x: number) => (scale.tidy ? Number(x.toPrecision(6)) : x);
	p.heightDepth = tidy(p.heightDepth * s);
	p.render.aoRadius = tidy(p.render.aoRadius * s);
	for (const l of p.layers) scaleParams(layerParamDefs(l.type), l.params, scale);
	for (const light of p.lighting.lights) {
		scaleParams(LIGHT_DEFS[light.type].params, light.params, scale);
		// Its distances to the surface grow by s, so the inverse-square falloff's reference does too.
		if (light.type === 'point') light.refDist = tidy((light.refDist ?? POINT_LIGHT_REF_DIST) * s);
	}
	for (const m of p.materials ?? []) {
		const def = getRecipe(m.recipe);
		if (def) scaleParams(def.params, m.params, scale);
	}
	if (scale.post) {
		for (const f of p.post) {
			const def = getPostDef(f.type);
			if (def) scaleParams(def.params, f.params, scale);
		}
	}
}

/**
 * `p` at a new canvas size (a copy), every pixel-measured value scaled with it so the texture keeps its look. Values
 * are rounded and clamped like stored ones; resize from the same original to avoid compounding that (the project
 * store keeps it across a run of resizes).
 */
export function resizeProject(p: Project, width: number, height: number): Project {
	const q: Project = JSON.parse(JSON.stringify(p));
	q.width = width;
	q.height = height;
	if (width === p.width && height === p.height) return q;
	scalePixels(q, { kx: width / p.width, ky: height / p.height, tidy: true, post: true });
	return q;
}
