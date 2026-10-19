// Supersampling (render.supersample, FR8.7): the material stack and the path tracer run at k× the texture size and
// the traced image is box-filtered down before the post stack — fine features (1 px highlights, thin joints, small
// holes) are computed at k× and averaged instead of being decided by a single sample per texel.
//
// scaleProject builds the k× project: every pixel-measured value scales by k (core/pixelScale.ts: unit 'px' params,
// height depth, per-area counts …), so the pattern keeps its size in texture pixels. Post filters run after the
// downsample, at the real size, and are left alone.

import type { Project } from './project';
import { scalePixels } from './pixelScale';

export const MAX_SUPERSAMPLE = 4;

export function supersampleFactor(p: Project): number {
	const k = Math.round(Number(p.render.supersample ?? 1));
	return Number.isFinite(k) ? Math.min(MAX_SUPERSAMPLE, Math.max(1, k)) : 1;
}

/** The project at k× resolution (a copy; k = 1 returns the input). */
export function scaleProject(p: Project, k: number): Project {
	if (k <= 1) return p;
	const q: Project = JSON.parse(JSON.stringify(p));
	q.width *= k;
	q.height *= k;
	q.render.supersample = 1;
	scalePixels(q, { kx: k, ky: k, supersample: true, post: false });
	return q;
}
