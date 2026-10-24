// Building blocks shared by the recipes (and the lessons behind them, FR7.4–7.8): crisp-edge bevels that rise
// slowly, faceted chips cut into the edge zone, lumps that also drive the glints, colour-only grain.

import { createLayer } from '@/core/serialize';
import type { ParamValues } from '@/core/params';
import type { Layer } from '@/core/project';
import { DEFAULT_BEVEL_CURVE } from '@/layers/commonParams';
import { metalColour } from '@/core/color';
import type { RecipeContext } from './types';

export const L = (type: string, name: string, params: ParamValues = {}, enabled = true): Layer => ({
	...createLayer(type, params, name),
	enabled
});

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Noise `scale` (features across the texture) for features about `px` wide. */
export const across = (ctx: RecipeContext, px: number) => r2(ctx.width / Math.max(1, px));

/** Streaky noise: features `len` px along the streak and `width` (≥ 2) px across. */
export function streaks(ctx: RecipeContext, vertical: boolean, len: number, width: number): ParamValues {
	const w = Math.max(2, width);
	return vertical ? { scale: across(ctx, len), stretch: r2(w / len) } : { scale: across(ctx, w), stretch: r2(len / w) };
}

/** Filter params that blur the height channel only. */
export const HEIGHT_ONLY = {
	diffuse: false,
	height: true,
	roughness: false,
	specular: false,
	metalness: false,
	emissive: false,
	opacity: false
};

/** Height-masked to the faces (off the joints left by the shapes beneath). */
export const ON_FACES = { m_hmode: 'above', m_hlevel: 0.05, m_hsoft: 0.05 };

export const crisp = () => JSON.parse(JSON.stringify(DEFAULT_BEVEL_CURVE));

/** A gradient for a metal (Metalness 1): each colour lifted to look as bright as it does painted (metalColour). */
export const metalGradient = (...colors: string[]) => gradient(...colors.map((c) => metalColour(c)));

export const gradient = (...colors: string[]) => ({
	stops: colors.map((color, i) => ({ pos: colors.length === 1 ? 0 : i / (colors.length - 1), color }))
});

/** Dark → light ramp of a single colour (for one-colour macros like moss or rust). */
export function shade(hex: string, dark = 0.7): { stops: { pos: number; color: string }[] } {
	const n = parseInt(hex.slice(1), 16);
	const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * dark));
	return gradient(`#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`, hex);
}
