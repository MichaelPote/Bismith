// Glue between the render engine and the optimiser: render a candidate deterministically at a low sample
// count and score it against a Matcher. Used by the headless API and emulation. Renders are scored in linear light
// (Matcher.scoreLinear): the sRGB image is made only at the comparison size, by the score.
//
// The engine is driven synchronously (setProject → renderNow → readFinal), so use a dedicated Engine
// (its own offscreen canvas) rather than the editor viewport's, or the two will fight over the project.

import type { Project } from '@/core/project';
import type { Engine } from '@/render/engine';
import { linearPremul, type LinearPremul, type Matcher, type ScoreDetail } from './metrics';
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

/** Render `project` with exactly `samples` spp (deterministic): linear light, premultiplied, as scoreLinear takes it. */
export function renderLinear(engine: Engine, project: Project, samples: number): LinearPremul {
	engine.setProject(project);
	engine.renderNow(samples);
	return linearPremul(engine.readFinal());
}

export interface EvaluatorOptions {
	/** Samples per evaluation (default 16). */
	samples?: number;
	/** Awaited before each render, e.g. `nextFrame` (ui/schedule.ts) to keep a UI responsive. */
	yieldBefore?: () => Promise<void>;
	/** Called with every evaluated candidate and its render (e.g. to show the latest one). */
	onEvaluate?: (project: Project, detail: ScoreDetail, render: LinearPremul) => void;
}

/**
 * An `evaluate` callback for `new Optimizer(project, evaluate)`; `detail` is the MetricResult, `image` the render at the
 * comparison size (what colour fits map from).
 */
export function makeEvaluator(
	engine: Engine,
	matcher: Matcher,
	opts: EvaluatorOptions = {}
): (p: Project) => Promise<EvalResult> {
	const samples = opts.samples ?? 16;
	return async (project) => {
		if (opts.yieldBefore) await opts.yieldBefore();
		const lin = renderLinear(engine, project, samples);
		const d = matcher.scoreLinearDetailed(lin);
		opts.onEvaluate?.(project, d, lin);
		return { loss: d.result.total, detail: d.result, image: d.fit };
	};
}
