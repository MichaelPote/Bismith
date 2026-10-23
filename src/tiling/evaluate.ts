// Glue between the render engine and the tiling fix (docs/features/fr9-tiling-workspace.md): render a candidate at a
// fixed sample count, score its tiling, and measure how far its look has drifted from the render before the fix —
// the Windows match preset (colour, VGG texture, local windows: all layout-free) against that render. Shared by the
// Tiling workspace and the headless page; like the Match evaluator, it drives the engine synchronously, so the caller
// suspends the viewport's use of it first.

import type { Project } from '@/core/project';
import type { Engine } from '@/render/engine';
import { attachTexture, renderToMatchImage } from '@/match/evaluate';
import { Matcher, type MatchImage } from '@/match/metrics';
import { analyzeTiling, type TilingAnalysis, type TilingOptions } from './analyze';
import type { FixEvaluation } from './fix';

export interface TilingEvaluator {
	/** Render with the evaluator's sample count. */
	render(p: Project): MatchImage;
	/** Render, analyse and measure the drift: the fix search's `evaluate`. */
	evaluate(p: Project): Promise<FixEvaluation>;
	/** The last candidate evaluated (to show the best so far without rendering it again). */
	last: { project: Project; image: MatchImage; analysis: TilingAnalysis } | null;
	/** Free the matcher's GPU statistics. */
	dispose(): void;
}

export async function tilingEvaluator(
	engine: Engine,
	original: MatchImage,
	opts: { samples?: number; analysis?: TilingOptions; yieldBefore?: () => Promise<void> } = {}
): Promise<TilingEvaluator> {
	const samples = opts.samples ?? 32;
	const matcher = new Matcher(original, { preset: 'windows', wrap: true, size: [original.width, original.height] });
	await attachTexture(engine, matcher, true);
	const ev: TilingEvaluator = {
		last: null,
		render: (p) => renderToMatchImage(engine, p, samples),
		async evaluate(p) {
			if (opts.yieldBefore) await opts.yieldBefore();
			const image = ev.render(p);
			const analysis = analyzeTiling(image, opts.analysis);
			ev.last = { project: p, image, analysis };
			return { score: analysis.score, drift: matcher.score(image).total };
		},
		dispose: () => matcher.dispose()
	};
	return ev;
}
