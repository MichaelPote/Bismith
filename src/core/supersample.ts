// Supersampling (render.supersample, FR8.7): the material stack and the path tracer run at k× the texture size and
// the traced image is box-filtered down before the post stack — fine features (1 px highlights, thin joints, small
// holes) are computed at k× and averaged instead of being decided by a single sample per texel.
//
// scaleProject builds the k× project: every pixel-measured value scales by k (core/pixelScale.ts: unit 'px' params,
// height depth, per-area counts …), so the pattern keeps its size in texture pixels. Post filters run after the
// downsample, at the real size, and are left alone.

import { deepCopy } from './params';
import type { Project } from './project';
import { scalePixels } from './pixelScale';

export const MAX_SUPERSAMPLE = 4;
/**
 * Largest side the k× stack may have, px: a canvas over 1024 px gets a smaller factor (2048: 2× at most; 4096: none).
 * An 8192² stack (2048 at 4×) made one layer's draw run past Windows' GPU timeout on an RTX 5080: the display driver
 * reset (black screens), every shader after failed with an empty log and the render came out blank.
 */
export const MAX_STACK_SIZE = 4096;

/** `k` rounded, at least 1, at most MAX_SUPERSAMPLE and as much as keeps `p`'s stack within MAX_STACK_SIZE. */
export function capSupersample(p: Pick<Project, 'width' | 'height'>, k: number): number {
	const r = Math.round(k);
	if (!Number.isFinite(r)) return 1;
	const room = Math.floor(MAX_STACK_SIZE / Math.max(1, p.width, p.height));
	return Math.max(1, Math.min(MAX_SUPERSAMPLE, room, r));
}

export function supersampleFactor(p: Project): number {
	return capSupersample(p, Number(p.render.supersample ?? 1));
}

/** The factor exports render at: Export supersample, or the project's own when that is more (capped as above). */
export function exportSupersampleFactor(p: Project): number {
	return capSupersample(p, Math.max(Number(p.render.supersample ?? 1), Number(p.render.exportSupersample ?? 1)));
}

/** The project at k× resolution (a copy; k = 1 returns the input). */
export function scaleProject(p: Project, k: number): Project {
	if (k <= 1) return p;
	const q = deepCopy(p);
	q.width *= k;
	q.height *= k;
	q.render.supersample = 1;
	scalePixels(q, { kx: k, ky: k, supersample: true, post: false });
	return q;
}
