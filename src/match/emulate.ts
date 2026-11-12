// Automatic emulation of a reference texture (docs/features/fr7.3-emulation.md):
//   analyse → build every candidate template → screen each with a short optimisation → race the best few →
//   optimise the winner → final render. Runs in-page (headless worker or the app) on a dedicated Engine.

import type { Project } from '@/core/project';
import type { Engine } from '@/render/engine';
import { analyzeTarget, type Analysis } from './analyze';
import { attachTexture, makeEvaluator, renderLinear } from './evaluate';
import { fitColours } from './colourFit';
import {
	METRIC_PRESETS,
	Matcher,
	type MatchImage,
	type MetricOptions,
	type MetricResult,
	type TermName
} from './metrics';
import { Optimizer, type SpaceOptions, type StopCriteria, type StopReason } from './optimizer';
import { availableTemplates, type Template } from './templates';

export interface EmulateOptions {
	/** Template ids to consider (default: every available template). */
	templates?: string[];
	/** Final palette snap ('quake', 'doom', … or '' for none). */
	palette?: string;
	metric?: MetricOptions;
	/** Samples per evaluation (default 8). */
	samples?: number;
	/** Samples for the final render (default 128). */
	finalSamples?: number;
	/** Evaluations per template while screening (default 24). */
	screenEvals?: number;
	/** Templates that go on to the race (default 3). */
	raceTop?: number;
	/** Evaluations per raced template (default 120). */
	raceEvals?: number;
	/**
	 * Final optimisation budget per finalist (evaluations). Default 600 — or unlimited when a target loss or a time
	 * limit is set, so the run goes on until one of those (or a stall) ends it.
	 */
	evals?: number;
	/** Stop as soon as the search loss (palette off, `samples` spp) reaches this. */
	targetLoss?: number;
	/**
	 * Wall-clock budget for the whole emulation (ms). Screening always completes; the race and the final optimisation
	 * share the rest — when the winner stalls, the next raced template gets the remaining time.
	 */
	timeMs?: number;
	/**
	 * Final-phase steps without progress before a finalist counts as stalled (default 80 when a target or a time
	 * limit is set, else none).
	 */
	patience?: number;
	seed?: number;
	space?: SpaceOptions;
	/** Start from these projects as extra candidates (e.g. a sibling texture's result). */
	seeds?: { id: string; project: Project }[];
	/** Fit each candidate's colours to the target before screening (colourFit.ts; default true). */
	fitColours?: boolean;
}

export interface EmulateResult {
	template: string;
	bestProject: Project;
	loss: number;
	terms: Record<TermName, number>;
	/** Screening losses per candidate, best first. */
	ranking: { template: string; loss: number }[];
	evaluations: number;
	ms: number;
	analysis: Analysis;
	final: MetricResult;
	/** Why the final optimisation ended. */
	stop: StopReason;
	/** Raced templates after the final phase (search loss, evaluations spent), best first. */
	finalists: { template: string; loss: number; evaluations: number }[];
}

/**
 * Default metric, without a preset or weights in `metric`: the 'tile' preset — colour + texture statistics + structure
 * compared at the best wrap shift + VGG texture statistics (GPU; when the weights can't load the term drops out) —
 * with alpha left out.
 */
const EMULATE_WEIGHTS = { ...METRIC_PRESETS.tile, alpha: 0 };

interface Runner {
	id: string;
	opt: Optimizer;
}

/** Toggle the palette snap: off while searching (a quantised loss is stepwise), on for the final render. */
function withPalette(p: Project, on: boolean): Project {
	return { ...p, post: p.post.map((f) => (f.type === 'palette' ? { ...f, enabled: on } : f)) };
}

export async function emulate(engine: Engine, target: MatchImage, opts: EmulateOptions = {}): Promise<EmulateResult> {
	const t0 = performance.now();
	const analysis = analyzeTarget(target);
	const metric = opts.metric ?? {};
	const matcher = new Matcher(target, {
		preset: metric.preset,
		weights: metric.preset || metric.weights ? metric.weights : EMULATE_WEIGHTS,
		size: [target.width, target.height],
		maxSize: metric.maxSize ?? 128,
		wrap: metric.wrap ?? analysis.tileable,
		window: metric.window ?? !analysis.tileable
	});
	await attachTexture(engine, matcher, analysis.tileable);
	try {
		return await emulateWith(engine, matcher, analysis, t0, opts);
	} finally {
		matcher.dispose();
	}
}

async function emulateWith(
	engine: Engine,
	matcher: Matcher,
	analysis: Analysis,
	t0: number,
	opts: EmulateOptions
): Promise<EmulateResult> {
	const evaluate = makeEvaluator(engine, matcher, { samples: opts.samples ?? 8 });
	const space: SpaceOptions = opts.space ?? { layers: true, base: true, lights: true, enums: true };
	const seed = opts.seed ?? 1;
	const ctx = { palette: opts.palette ?? '' };

	const templates: Template[] = availableTemplates().filter((t) => !opts.templates || opts.templates.includes(t.id));
	const candidates: { id: string; project: Project }[] = [
		...templates.map((t) => ({ id: t.id, project: t.build(analysis, ctx) })),
		...(opts.seeds ?? [])
	].map((c) => ({ ...c, project: withPalette(c.project, false) }));
	if (!candidates.length) throw new Error('no templates available');

	const deadline = opts.timeMs !== undefined ? t0 + opts.timeMs : Infinity;
	const left = (): Pick<StopCriteria, 'timeMs'> =>
		deadline < Infinity ? { timeMs: Math.max(0, deadline - performance.now()) } : {};
	const goal: Pick<StopCriteria, 'targetLoss'> = opts.targetLoss !== undefined ? { targetLoss: opts.targetLoss } : {};
	const open = opts.targetLoss !== undefined || opts.timeMs !== undefined;
	const screenEvals = opts.screenEvals ?? 24;

	// Colours first: solved directly, so the screen compares the candidates' shapes rather than their starting colours.
	if (opts.fitColours !== false) {
		const samples = opts.samples ?? 8;
		for (const c of candidates)
			c.project = (await fitColours(c.project, matcher, (p) => renderLinear(engine, p, samples))).project;
	}

	// Screen (always completes: the ranking needs every candidate).
	const runners: Runner[] = [];
	for (const c of candidates) {
		const opt = new Optimizer(c.project, evaluate, { seed, lambda: 4, space });
		await opt.runUntil({ evaluations: screenEvals });
		runners.push({ id: c.id, opt });
	}
	runners.sort((a, b) => a.opt.bestLoss - b.opt.bestLoss);
	const ranking = runners.map((r) => ({ template: r.id, loss: r.opt.bestLoss }));

	// Race the best few.
	const race = runners.slice(0, Math.max(1, opts.raceTop ?? 3));
	for (const r of race) {
		const { reason } = await r.opt.runUntil({ evaluations: screenEvals + (opts.raceEvals ?? 120), ...goal, ...left() });
		if (reason === 'target' || reason === 'time') break;
	}
	race.sort((a, b) => a.opt.bestLoss - b.opt.bestLoss);

	// Optimise the winner; when it stalls with time (or a target) left, carry on with the next finalist.
	const patience = opts.patience ?? (open ? 80 : undefined);
	let stop: StopReason = 'evaluations';
	for (const r of race) {
		const budget = opts.evals ?? (open ? undefined : 600);
		const out = await r.opt.runUntil({
			...(budget !== undefined ? { evaluations: r.opt.evaluations + budget } : {}),
			...goal,
			...left(),
			...(patience !== undefined ? { patience } : {})
		});
		stop = out.reason;
		if (stop !== 'stalled') break;
	}
	race.sort((a, b) => a.opt.bestLoss - b.opt.bestLoss);
	const winner = race[0];
	const finalists = race.map((r) => ({ template: r.id, loss: r.opt.bestLoss, evaluations: r.opt.evaluations }));

	const best = { ...winner.opt.best, project: withPalette(winner.opt.best.project, true) };
	const final = matcher.scoreLinear(renderLinear(engine, best.project, opts.finalSamples ?? 128));
	const evaluations = runners.reduce((s, r) => s + r.opt.evaluations, 0);
	return {
		template: winner.id,
		bestProject: best.project,
		loss: final.total,
		terms: final.terms,
		ranking,
		evaluations,
		ms: performance.now() - t0,
		analysis,
		final,
		stop,
		finalists
	};
}
