// Fix what makes the repeat obvious (docs/features/fr9-tiling-workspace.md): a narrow search over the blamed layers
// only. Each culprit — a layer, or the copies of one pattern — is first reseeded (N seeds, the copies together, so they
// stay one pattern), then its pattern params are nudged one at a time, keeping each step that helps. A candidate's
// loss is its tiling score plus a penalty once its look drifts past what a reseed alone costs:
//
//   loss = score + DRIFT_WEIGHT · max(0, drift − DRIFT_FREE)
//
// `drift` is the caller's: the headless page scores candidates against the render before the fix with the Windows
// preset (colour, VGG texture and local windows — all layout-free, so a new layout of the same material costs little).
//
//   const r = await fixTiling(project, attribution, evaluate)     // r.project, r.before, r.after, r.changes

import type { Project } from '@/core/project';
import { patternKeys } from '@/core/links';
import { Rng, extractParams, applyParams, isEntryActive, entryValue, type ParamEntry } from '@/match/optimizer';
import type { MatchImage } from '@/match/image';
import type { TilingAnalysis } from './analyze';
import type { TilingAttribution } from './attribute';

export interface FixEvaluation {
	/** Tiling score of the candidate (analyzeTiling). */
	score: number;
	/** How far its look is from the project before the fix (≈0 identical … 1 unrelated). */
	drift: number;
	/** The candidate's render and analysis, if the evaluation has them: kept for the result (`before`, `after`). */
	detail?: FixDetail;
}

export interface FixDetail {
	image: MatchImage;
	analysis: TilingAnalysis;
}

export interface FixOptions {
	/** Seeds tried per culprit (default 24). */
	seeds?: number;
	/** Normalised steps tried per pattern param (default ±0.05, ±0.12 of the slider range). */
	steps?: number[];
	/**
	 * Let the layout search change the pattern's scale too — px lengths and `scale` (cells across) — (default false). A
	 * smaller pattern hides the repeat (more features per tile), but that changes the material, which is the user's
	 * design, not a fix.
	 */
	scale?: boolean;
	/** Culprits fixed, most important first (default 2). */
	culprits?: number;
	/**
	 * Drift a fix may cost for free. Default: what a reseed costs for this project — from each culprit on, the largest
	 * median drift of the culprits' reseeds so far (a reseeded rock drifts ≈0.3, a sprinkle of flecks ≈0.03); 0.25
	 * until a culprit with a seed comes.
	 */
	driftFree?: number;
	/** Loss per unit of drift past that (default 2). */
	driftWeight?: number;
	/** Loss a change has to gain to be kept (default 0.01): smaller gains are noise, and each change moves the look. */
	minGain?: number;
	/** RNG seed for the seeds tried (default 1). */
	rngSeed?: number;
	/**
	 * The project's own evaluation, when the caller has it (attribution's analysis, drift 0): saves evaluating it again.
	 */
	before?: FixEvaluation;
	/** Checked before each evaluation: true stops the search, which returns the best so far. */
	shouldStop?: () => boolean;
	/** Called after each evaluation with the candidate and the best kept so far. */
	onEvaluate?: (done: number, candidate: FixCandidate, best: FixCandidate) => void;
}

export interface FixCandidate {
	project: Project;
	score: number;
	drift: number;
	loss: number;
	/** Render and analysis, while the candidate can still be the result (dropped from the others to save memory). */
	detail?: FixDetail;
}

export interface FixChange {
	/** The culprit's layers (one, or the copies of a pattern). */
	ids: string[];
	name: string;
	/** 'seed' or a pattern param key. */
	key: string;
	from: number | string | boolean;
	to: number | string | boolean;
}

export interface FixTrial {
	/** Culprit name, and 'seed' or the param key tried. */
	name: string;
	key: string;
	value: number | string | boolean;
	score: number;
	drift: number;
	loss: number;
}

export interface FixResult {
	/** The project as it was and as fixed (the same when nothing helped). */
	before: FixCandidate;
	after: FixCandidate;
	project: Project;
	changes: FixChange[];
	/** Every candidate tried, in order. */
	trials: FixTrial[];
	/** The drift allowance used (set from the reseeds unless given). */
	driftFree: number;
	evaluations: number;
}

/** Pattern params that only move the pattern (no new layout once tiled). */
const SHIFT_KEYS = new Set(['ofs_x', 'ofs_y']);

/** A layer param's current value. */
function layerValue(p: Project, e: ParamEntry): unknown {
	return p.layers.find((l) => l.id === e.owner)?.params[e.key];
}

/** The project with `ids` given one new seed. */
export function reseed(project: Project, ids: string[], seed: number): Project {
	const set = new Set(ids);
	return {
		...project,
		layers: project.layers.map((l) => (set.has(l.id) ? { ...l, params: { ...l.params, seed } } : l))
	};
}

export async function fixTiling(
	project: Project,
	attribution: Pick<TilingAttribution, 'layers' | 'findings'>,
	evaluate: (p: Project) => Promise<FixEvaluation> | FixEvaluation,
	opts: FixOptions = {}
): Promise<FixResult> {
	let driftFree = opts.driftFree ?? 0.25;
	let reseeded = false;
	const driftWeight = opts.driftWeight ?? 2;
	const steps = opts.steps ?? [-0.12, -0.05, 0.05, 0.12];
	const rng = new Rng(opts.rngSeed ?? 1);
	const minGain = opts.minGain ?? 0.01;
	const trials: FixTrial[] = [];
	let evaluations = 0;
	const lossOf = (e: FixEvaluation) => e.score + driftWeight * Math.max(0, e.drift - driftFree);

	const judge = async (p: Project): Promise<FixCandidate> => {
		const e = await evaluate(p);
		evaluations++;
		const c: FixCandidate = { project: p, score: e.score, drift: e.drift, loss: lossOf(e), detail: e.detail };
		opts.onEvaluate?.(evaluations, c, best ?? c);
		return c;
	};
	let best: FixCandidate | null = null;
	const before: FixCandidate = opts.before
		? { project, ...opts.before, loss: lossOf(opts.before) }
		: await judge(project);
	best = before;
	const changes: FixChange[] = [];

	// Culprits in the order of their findings, each once, and only their unlocked layers (a lock holds the seed too).
	const units: { ids: string[]; name: string }[] = [];
	const locked = new Set(project.layers.filter((l) => l.locked).map((l) => l.id));
	const seen = new Set<number>();
	for (const f of attribution.findings) {
		if (seen.has(f.layer)) continue;
		seen.add(f.layer);
		const { ids, name } = attribution.layers[f.layer];
		const free = ids.filter((id) => !locked.has(id));
		if (free.length) units.push({ ids: free, name });
	}

	const stop = () => opts.shouldStop?.() === true;
	search: for (const { ids, name } of units.slice(0, opts.culprits ?? 2)) {
		const layers = ids.map((id) => best!.project.layers.find((l) => l.id === id)).filter((l) => !!l);
		if (!layers.length) continue;

		// Reseed: the copies together.
		if (layers[0].params.seed !== undefined) {
			const from = layers[0].params.seed as number;
			const tried: { seed: number; c: FixCandidate }[] = [];
			for (let i = 0; i < (opts.seeds ?? 24) && !stop(); i++) {
				const seed = rng.int(100000);
				const c = await judge(reseed(best.project, ids, seed));
				// The loss is only known once the round sets the allowance, but it is never below the score, and the bar
				// (best's loss) only falls: a candidate whose score misses it now can't win.
				if (!(c.score < best.loss - minGain)) c.detail = undefined;
				tried.push({ seed, c });
			}
			if (opts.driftFree === undefined) {
				const d = tried.map((t) => t.c.drift).sort((a, b) => a - b);
				driftFree = reseeded ? Math.max(driftFree, d[d.length >> 1]) : d[d.length >> 1];
				reseeded = true;
				best.loss = lossOf(best);
				for (const t of tried) t.c.loss = lossOf(t.c);
			}
			let won: FixCandidate | null = null;
			let to = from;
			for (const { seed, c } of tried) {
				trials.push({ name, key: 'seed', value: seed, score: c.score, drift: c.drift, loss: c.loss });
				if (c.loss < (won ? won.loss : best.loss - minGain)) {
					won = c;
					to = seed;
				}
			}
			for (const t of tried) if (t.c !== won) t.c.detail = undefined;
			if (won) {
				if (best !== before) best.detail = undefined;
				best = won;
				changes.push({ ids, name, key: 'seed', from, to });
			}
		}

		// Even out the layout: one pattern param at a time, keeping each step that helps. Not effects that are off (at a
		// minimum of 0: turning one on adds a feature), nor the scale unless asked.
		const keys = patternKeys(layers[0].type);
		const pick = (e: ParamEntry) =>
			e.scope === 'layer' &&
			e.kind === 'number' &&
			ids.includes(e.owner) &&
			keys.has(e.key) &&
			!SHIFT_KEYS.has(e.key) &&
			!(e.def?.min === 0 && layerValue(best!.project, e) === 0) &&
			(opts.scale || (e.def?.unit !== 'px' && e.key !== 'scale'));
		const entryKeys = extractParams(best.project, { filter: pick })
			.entries.filter((e) => isEntryActive(best!.project, e))
			.map((e) => `${e.owner}\u0000${e.key}`);
		for (const ek of entryKeys) {
			if (stop()) break search;
			const space = extractParams(best.project, { filter: (e) => pick(e) && `${e.owner}\u0000${e.key}` === ek });
			const e = space.entries[0];
			if (!e) continue;
			const from = entryValue(e, space.initial);
			let won: FixCandidate | null = null;
			let wonTo = from;
			for (const s of steps) {
				if (stop()) break;
				const v = space.initial[e.offset] + s;
				if (!e.wrap && (v < 0 || v > 1)) continue;
				const vec = Float64Array.from(space.initial);
				vec[e.offset] = v;
				const c = await judge(applyParams(best.project, space, vec));
				const to = entryValue(e, vec);
				trials.push({ name, key: e.key, value: to, score: c.score, drift: c.drift, loss: c.loss });
				if (c.loss < (won ? won.loss : best.loss - minGain)) {
					if (won) won.detail = undefined;
					won = c;
					wonTo = to;
				} else c.detail = undefined;
			}
			if (won) {
				if (best !== before) best.detail = undefined;
				best = won;
				changes.push({ ids, name, key: e.key, from, to: wonTo });
			}
		}
	}

	return { before, after: best, project: best.project, changes, trials, driftFree, evaluations };
}
