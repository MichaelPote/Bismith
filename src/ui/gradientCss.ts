// A gradient ramp as a CSS background, for the editor's bar and the preset swatches.
import type { Gradient, GradientStop } from '@/core/params';
import { hexToRgb } from '@/core/color';

/** A stop's colour as CSS, with its opacity when `alpha`. */
export function stopCss(s: GradientStop, alpha: boolean): string {
	const a = alpha ? (s.alpha ?? 1) : 1;
	if (a >= 1) return s.color;
	const [r, g, b] = hexToRgb(s.color).map((c) => Math.round(c * 255));
	return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** A finer, mid-grey checkerboard for small swatches: dark and light ramps both stand out on it. */
export const SWATCH_CHECKER = 'repeating-conic-gradient(#7a7f84 0 25%, #575c61 0 50%) 0 0 / 8px 8px';

/** The ramp left to right; with `alpha`, over a checkerboard (the editor's, unless `checker` says another). */
export function gradientCss(g: Gradient, alpha: boolean, checker = 'var(--alpha-bg)'): string {
	const s = [...g.stops].sort((a, b) => a.pos - b.pos);
	const ramp =
		s.length === 1
			? `linear-gradient(${stopCss(s[0], alpha)}, ${stopCss(s[0], alpha)})`
			: `linear-gradient(90deg, ${s.map((x) => `${stopCss(x, alpha)} ${(x.pos * 100).toFixed(2)}%`).join(', ')})`;
	return alpha ? `${ramp}, ${checker}` : ramp;
}
