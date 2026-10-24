// Glue between the render engine and the tiling fix (docs/features/fr9-tiling-workspace.md): render a candidate at a
// fixed sample count, score its tiling, and measure how far its look has drifted from the render before the fix —
// the Windows match preset (colour, VGG texture, local windows: all layout-free) against that render. Shared by the
// Tiling workspace and the headless page; like the Match evaluator, it drives the engine synchronously, so the caller
// suspends the viewport's use of it first.
//
// A render is taken as a frame (analyze.ts): on the GPU, the engine's output is box-filtered to at most FRAME_SIZE px
// in linear light and the analysis reads it in place; the CPU gets it (one readback) only when the drift is measured.

import type { Project } from '@/core/project';
import type { Engine } from '@/render/engine';
import { attachTexture } from '@/match/evaluate';
import { linearPremul, resamplePremul } from '@/match/image';
import { Matcher } from '@/match/metrics';
import { FRAME_SIZE, TilingFrame, analyzeTiling, frameSize, type TilingOptions } from './analyze';
import type { TilingGpu } from './gpu';
import type { FixEvaluation } from './fix';

/**
 * The samples a render of `pixels` traced px gets for `samples` asked: all of them up to FRAME_SIZE² px, fewer above
 * (at least 8): a frame averages the larger render's px down, so the frame still sees `samples` per px.
 */
export function frameSamples(samples: number, pixels: number): number {
	return Math.max(Math.min(8, samples), Math.round(samples * Math.min(1, FRAME_SIZE ** 2 / pixels)));
}

/**
 * Render `project` deterministically with `samples` spp (fewer on a canvas over FRAME_SIZE² px: frameSamples) and
 * return it as a frame: made on the GPU by `gpu` (`lazy`: read back only when its pixels are first read, before the
 * next render), else read back and filtered here.
 */
export function renderFrame(
	engine: Engine,
	project: Project,
	samples: number,
	gpu?: TilingGpu | null,
	lazy = false
): TilingFrame {
	engine.setProject(project);
	const ss = engine.supersample;
	engine.renderNow(frameSamples(samples, project.width * project.height * ss * ss));
	const tex = engine.finalTexture();
	if (gpu && tex) return gpu.frame(tex, project.width, project.height, { lazy });
	const lin = linearPremul(engine.readFinal());
	const [w, h] = frameSize(lin.width, lin.height);
	return new TilingFrame(w, h, resamplePremul(lin, w, h, 'box'));
}

export interface TilingEvaluator {
	/** Render with the evaluator's sample count. */
	render(p: Project): TilingFrame;
	/**
	 * Render, analyse and measure the drift: the fix search's `evaluate` (with the frame and analysis as detail). With
	 * `bar`, a candidate whose score misses it skips the drift (NaN) and comes without detail: it can't win.
	 */
	evaluate(p: Project, bar?: number): Promise<FixEvaluation>;
	/** Free the matcher's GPU statistics. */
	dispose(): void;
}

export async function tilingEvaluator(
	engine: Engine,
	original: TilingFrame,
	opts: {
		samples?: number;
		analysis?: TilingOptions;
		/** Makes the frames and computes the analysis' kernels (src/tiling/gpu.ts); the CPU without. */
		gpu?: TilingGpu | null;
		yieldBefore?: () => Promise<void>;
	} = {}
): Promise<TilingEvaluator> {
	const samples = opts.samples ?? 32;
	const matcher = new Matcher(original.image, { preset: 'windows', wrap: true, weightedOnly: true });
	await attachTexture(engine, matcher, true);
	const ev: TilingEvaluator = {
		render: (p) => renderFrame(engine, p, samples, opts.gpu),
		async evaluate(p, bar) {
			if (opts.yieldBefore) await opts.yieldBefore();
			const frame = renderFrame(engine, p, samples, opts.gpu, true);
			const analysis = analyzeTiling(frame, opts.analysis, opts.gpu);
			if (bar !== undefined && !(analysis.score < bar)) return { score: analysis.score, drift: NaN };
			return { score: analysis.score, drift: matcher.scoreLinear(frame.lin).total, detail: { frame, analysis } };
		},
		dispose: () => matcher.dispose()
	};
	return ev;
}
