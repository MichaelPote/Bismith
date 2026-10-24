// Glue between the render engine and the optimiser: render a candidate deterministically at a low sample
// count and score it against a Matcher. Used by the headless API and meant for the Match workspace.
//
// The engine is driven synchronously (setProject → renderNow → readFinal), so use a dedicated Engine
// (its own offscreen canvas) rather than the editor viewport's, or the two will fight over the project.

import type { Project } from '@/core/project';
import type { Engine } from '@/render/engine';
import { fromLinear, type MatchImage, type Matcher, type MetricResult } from './metrics';
import type { EvalResult } from './optimizer';
import { TextureNet } from './vgg';

/**
 * Give `matcher` the GPU texture term (VGG statistics) when its weights use it. Fails soft: if the network can't
 * load (no float targets, weights missing) the term simply doesn't count.
 */
export async function attachTexture(engine: Engine, matcher: Matcher, wrap: boolean): Promise<boolean> {
	if (!((matcher.weights.texture ?? 0) > 0)) return false;
	try {
		const net = await TextureNet.load(engine.gpu);
		matcher.texture?.dispose();
		matcher.texture = net.scorer(matcher.target, wrap);
		return true;
	} catch (e) {
		console.warn('texture term unavailable:', e instanceof Error ? e.message : e);
		return false;
	}
}

/** Render `project` with exactly `samples` spp (deterministic) and return the final image. */
export function renderToMatchImage(engine: Engine, project: Project, samples: number): MatchImage {
	engine.setProject(project);
	engine.renderNow(samples);
	return fromLinear(engine.readFinal());
}

export interface EvaluatorOptions {
	/** Samples per evaluation (default 16). */
	samples?: number;
	/** Awaited before each render, e.g. `nextFrame` (ui/schedule.ts) to keep a UI responsive. */
	yieldBefore?: () => Promise<void>;
	/** Called with every evaluated candidate (e.g. to show the latest render). */
	onEvaluate?: (project: Project, image: MatchImage, result: MetricResult) => void;
}

/** An `evaluate` callback for `new Optimizer(project, evaluate)`; `detail` is the MetricResult. */
export function makeEvaluator(
	engine: Engine,
	matcher: Matcher,
	opts: EvaluatorOptions = {}
): (p: Project) => Promise<EvalResult> {
	const samples = opts.samples ?? 16;
	return async (project) => {
		if (opts.yieldBefore) await opts.yieldBefore();
		const image = renderToMatchImage(engine, project, samples);
		const result = matcher.score(image);
		opts.onEvaluate?.(project, image, result);
		return { loss: result.total, detail: result, image };
	};
}
