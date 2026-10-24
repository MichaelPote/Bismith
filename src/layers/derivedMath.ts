// CPU twins of the GLSL helpers that derived uniforms (LayerDef.derivedUniforms) replace: the same integer and float
// steps, in float32 where the shader's ties could land on the other side (Math.fround after each step).

import type { LayerCanvas } from './types';

export const f32 = Math.fround;

/** Euclidean modulo (m > 0), as GLSL imod. */
export const imod = (a: number, m: number): number => ((a % m) + m) % m;

/** Greatest common divisor of |a| and |b|, at least 1 (GLSL igcd). */
export function gcd(a: number, b: number): number {
	a = Math.abs(a);
	b = Math.abs(b);
	while (b) [a, b] = [b, a % b];
	return Math.max(a, 1);
}

/** GLSL cellsFor(scale, stretch): cells across and down for `scale` across the width, whole when tiling. */
export function cellsFor(scale: number, stretch: number, c: LayerCanvas): [number, number] {
	const cx = f32(scale / Math.max(stretch, 1e-3));
	const cy = f32(f32(scale * c.height) / c.width);
	return c.tileable
		? [Math.max(1, Math.floor(f32(cx + 0.5))), Math.max(1, Math.floor(f32(cy + 0.5)))]
		: [Math.max(cx, 1e-3), Math.max(cy, 1e-3)];
}
