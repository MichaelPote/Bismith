<script setup lang="ts">
	// Tiling (docs/features/fr9-tiling-workspace.md): see what gives the repeat away in a 3 × 3 tiling, which layer is to
	// blame, and let the fix search reseed and nudge those layers — tiling score down, look held — then keep or discard.
	import {
		computed,
		onActivated,
		onBeforeUnmount,
		onDeactivated,
		onMounted,
		ref,
		shallowRef,
		toRaw,
		watch,
		type WatchStopHandle
	} from 'vue';
	import type { Project } from '@/core/project';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore } from '@/stores/editor';
	import { heatOverlay, toRgba8, type MatchImage } from '@/match/image';
	import {
		TILING_TERMS,
		analyzeTiling,
		type TilingAnalysis,
		type TilingFrame,
		type TilingTerm
	} from '@/tiling/analyze';
	import { attributeTiling, type Finding, type LayerBlame, type TilingAttribution } from '@/tiling/attribute';
	import { fixTiling, type FixCandidate, type FixResult } from '@/tiling/fix';
	import { renderFrame, tilingEvaluator } from '@/tiling/evaluate';
	import { tilingGpu, type TilingGpu } from '@/tiling/gpu';
	import type { Engine } from '@/render/engine';
	import { nextFrame, yieldEvery } from '@/ui/schedule';
	import { vTip, type Tip } from '@/ui/tooltip';
	import {
		autosaveRun,
		holdRunLock,
		runCheckpoints,
		type Checkpoint,
		type CheckpointInput
	} from '@/stores/runCheckpoint';
	import type { ResumeRunEvent } from '@/ui/resumeRuns';
	import ImageCanvas from '@/ui/components/ImageCanvas.vue';
	import LossChart from '@/ui/components/LossChart.vue';
	import NumberField from '@/ui/components/NumberField.vue';
	import CheckField from '@/ui/components/CheckField.vue';
	import { IconCheck, IconPlayerPlay, IconPlayerStop, IconScan, IconX } from '@tabler/icons-vue';

	const store = useProjectStore();
	const editor = useEditorStore();

	// Settings: the fix search's inputs.
	const seeds = ref(24);
	const culprits = ref(2);
	const stepSize = ref(0.12);
	const holdLook = ref(2);
	const minGain = ref(0.01);
	const samples = ref(32);
	const allowScale = ref(false);

	type Phase = 'idle' | 'finding' | 'fixing' | 'done';
	const phase = ref<Phase>('idle');
	const running = computed(() => phase.value === 'finding' || phase.value === 'fixing');
	let abort = false;

	// ---------------------------------------------------------------- run checkpoints
	// A fix is checkpointed while it goes (stores/runCheckpoint.ts): every ~10 s and whenever the page is hidden, so a
	// tab the browser discards in the background (or a crash) doesn't lose it — at the next start-up ui/resumeRuns.ts
	// offers to resume it. A checkpoint holds what the search needs to pick up again: its settings, the project it began
	// from, the culprits and every evaluation's score and drift. Resuming renders and analyses that project again and
	// replays the evaluations (fixTiling's `replay`: the search takes the same path without rendering them), then carries
	// on. A run that ends with a fix not kept (stopped, finished, the workspace left) leaves a last checkpoint marked
	// paused, which reopens to that result; Keep and Discard clear it. Its lock is held while the run or its result is
	// here, so other tabs don't offer it.

	interface TilingSettings {
		seeds: number;
		culprits: number;
		stepSize: number;
		holdLook: number;
		minGain: number;
		samples: number;
		allowScale: boolean;
	}

	interface TilingRunState {
		settings: TilingSettings;
		/** The project the fix began from, as JSON. */
		runStart: string;
		/** Its tiling score then (the search's starting loss). */
		beforeScore: number;
		/** The culprits: the attribution without its render and maps. */
		layers: Omit<LayerBlame, 'map'>[];
		findings: Finding[];
		/** Where the layer seeds the fix tries come from: new each run, so runs find other layouts; a resume reuses it. */
		rngSeed?: number;
		/** Every evaluation so far, in order: replayed on resume. */
		evals: { score: number; drift: number }[];
		/** The run was stopped (not finished) before its result. */
		stopped?: boolean;
	}

	const checkpoints = runCheckpoints<TilingRunState>('tiling');
	/** Releases this tab's hold on the run (see holdRunLock): held from a run's start until its result is kept or discarded. */
	let releaseLock: (() => void) | null = null;

	const settingsNow = (): TilingSettings => ({
		seeds: seeds.value,
		culprits: culprits.value,
		stepSize: stepSize.value,
		holdLook: holdLook.value,
		minGain: minGain.value,
		samples: samples.value,
		allowScale: allowScale.value
	});
	function applySettings(t: TilingSettings): void {
		seeds.value = t.seeds;
		culprits.value = t.culprits;
		stepSize.value = t.stepSize;
		holdLook.value = t.holdLook;
		minGain.value = t.minGain;
		samples.value = t.samples;
		allowScale.value = t.allowScale;
	}

	/** Forget the run's checkpoint and let other tabs offer it no more. */
	function dropCheckpoint(): void {
		void checkpoints.clear();
		releaseLock?.();
		releaseLock = null;
	}

	/** A render (at most FRAME_SIZE px: the panes show it so) and its analysis (maps at the frame's size). */
	interface Shot {
		frame: TilingFrame;
		analysis: TilingAnalysis;
	}
	/** The project as it is (or was when the run began) and the best candidate of the run. */
	const current = shallowRef<Shot | null>(null);
	const best = shallowRef<(Shot & { candidate: FixCandidate }) | null>(null);
	const result = shallowRef<FixResult | null>(null);
	const attribution = shallowRef<TilingAttribution | null>(null);
	const hotspotOf = ref<'current' | 'fixed'>('current');
	const curve = shallowRef<number[]>([]);
	const evaluations = ref(0);
	const progress = ref('');
	const log = ref<string[]>([]);

	// Notes over the Current and Hotspots panes saying what they show: until the first fix runs (or they're closed),
	// then not again until the tab is closed (sessionStorage).
	const NOTES_KEY = 'cf-tiling-notes';
	function readNotes(): boolean {
		try {
			return sessionStorage.getItem(NOTES_KEY) !== 'off';
		} catch {
			return true;
		}
	}
	const notes = ref(readNotes());
	function hideNotes(): void {
		notes.value = false;
		try {
			sessionStorage.setItem(NOTES_KEY, 'off');
		} catch {
			/* storage unavailable: hidden until the page reloads */
		}
	}

	/** The settings' tooltips: what each one is, and why you would change it. */
	const TIPS: Record<string, Tip> = {
		seeds: {
			title: 'Seeds',
			body: 'How many new random seeds the fix tries for each culprit layer. A different seed gives a different random layout, which often moves an artefact or removes it without changing the look. Copies of a pattern are reseeded together. More seeds can find a better layout, but the fix takes longer.'
		},
		layers: {
			title: 'Layers',
			body: 'How many of the blamed layers the fix works on, starting with the one most to blame. Raise it when the repeat comes from several layers. Keep it low to change as little as possible.'
		},
		nudge: {
			title: 'Nudge',
			body: "How far the fix moves each pattern setting of a culprit layer, as a share of the setting's slider range. It also tries 40 % of this. Larger nudges can remove stubborn artefacts, but they change the material more."
		},
		holdLook: {
			title: 'Hold look',
			body: 'How firmly the fix holds on to the look of the material. Every change that moves the look further than a new seed alone would counts against it. Raise it if fixes change the material too much. Lower it if the fix finds nothing. At 0 any change is allowed.'
		},
		minGain: {
			title: 'Min gain',
			body: 'How much a change must lower the tiling score to be kept. Smaller gains are within the noise of the measurement, and every kept change moves the look a little. Lower it to keep more small improvements.'
		},
		samples: {
			title: 'Samples',
			body: 'How many path-traced samples each candidate render uses. More samples give cleaner renders, so the scores are less noisy, but each candidate takes longer. Canvases larger than 512 × 512 px get fewer, at least 8: they are compared at 512 px, where their pixels average out the noise.'
		},
		scale: {
			title: 'Scale',
			body: 'Lets the optimiser change layer sizes too, such as cell counts and feature sizes. Smaller patterns reduce the tiling look, but it changes how your material looks. Off by default.'
		}
	};

	const TERM_LABELS: Record<TilingTerm, string> = {
		patches: 'Unique patches',
		lines: 'Unique lines',
		clumping: 'Clumping',
		tone: 'Broad tone'
	};

	const snapshot = () => JSON.stringify(toRaw(store.project));
	/** The project the shown analysis / the run is of. */
	let seen = '';
	let runStart = '';

	type Px = { pixels: Uint8ClampedArray; width: number; height: number };
	/** An image's pixels, for a pane that shows it repeated 3 × 3 (ImageCanvas tiles it). */
	const tiled = (img: MatchImage): Px => ({ pixels: toRgba8(img), width: img.width, height: img.height });
	const overlayOf = ({ frame: f, analysis }: Shot) => heatOverlay(f.L, analysis.maps.hotspot, f.width, f.height);

	const currentPx = computed(() => (current.value ? tiled(current.value.frame.image) : null));
	const fixedPx = computed(() => (best.value ? tiled(best.value.frame.image) : null));
	const hotspotPx = computed(() => {
		const s = hotspotOf.value === 'fixed' && best.value ? best.value : current.value;
		return s ? tiled(overlayOf(s)) : null;
	});

	// ---------------------------------------------------------------- analysis of the current project
	let analysing = false;
	async function analyseCurrent(): Promise<void> {
		const engine = editor.engine;
		if (!engine || analysing || running.value || phase.value === 'done') return;
		analysing = true;
		progress.value = 'Analysing…';
		await nextFrame();
		engine.suspend();
		const gpu = tilingGpu(engine.gpu);
		try {
			seen = snapshot();
			// Culprits found in another version of the project no longer hold.
			if (seen !== culpritsOf) attribution.value = null;
			const frame = renderFrame(engine, toRaw(store.project), samples.value, gpu);
			current.value = { frame, analysis: analyzeTiling(frame, {}, gpu) };
			progress.value = '';
		} catch (e) {
			progress.value = '';
			editor.notify(`Tiling analysis failed: ${e instanceof Error ? e.message : e}`, 'error');
		} finally {
			analysing = false;
			gpu?.release();
			engine.resume(toRaw(store.project));
		}
	}

	// ---------------------------------------------------------------- the culprits
	class Stopped extends Error {}

	/** The project the shown culprits were found in: once it changes, they're stale. */
	let culpritsOf = '';

	/** Which layers give the repeat away: the project rendered with each left out in turn. */
	function attribute(
		engine: Engine,
		project: Project,
		gpu: TilingGpu | null,
		yieldStep: () => Promise<void>
	): Promise<TilingAttribution> {
		return attributeTiling(
			project,
			async (q) => {
				if (abort) throw new Stopped();
				await yieldStep();
				return renderFrame(engine, q, samples.value, gpu);
			},
			{ gpu, onProgress: (done, total) => (progress.value = `Finding the culprits · layer ${done} of ${total}`) }
		);
	}

	/** Find the culprits without fixing anything: they show in the list, and Run fix starts from them. */
	async function findCulprits(): Promise<void> {
		const engine = editor.engine;
		if (!engine || running.value || phase.value === 'done') return;
		while (analysing) await nextFrame();
		if (running.value) return;
		abort = false;
		phase.value = 'finding';
		log.value = [];
		attribution.value = null;
		const start = snapshot();
		await nextFrame();
		engine.suspend();
		const gpu = tilingGpu(engine.gpu);
		try {
			const a = await attribute(engine, JSON.parse(start) as Project, gpu, yieldEvery());
			seen = culpritsOf = start;
			current.value = { frame: a.frame, analysis: a.analysis };
			attribution.value = a;
			if (!a.findings.length) log.value = ['No single layer stands out as the cause of the repeat.'];
		} catch (e) {
			if (!(e instanceof Stopped))
				editor.notify(`Finding the culprits failed: ${e instanceof Error ? e.message : e}`, 'error');
		} finally {
			phase.value = 'idle';
			progress.value = '';
			gpu?.release();
			engine.resume(toRaw(store.project));
		}
	}

	// ---------------------------------------------------------------- the run

	/**
	 * Find the culprits and fix them. `resume`: pick up a checkpointed run instead (its settings, project and culprits;
	 * its evaluations replayed) — and, `paused`, only as far as it had got, back to its result.
	 */
	async function run(resume?: Checkpoint<TilingRunState>): Promise<void> {
		const engine = editor.engine;
		if (!engine || running.value) return;
		// An analysis of the current project in flight drives the engine too: let it finish.
		while (analysing) await nextFrame();
		if (running.value) return;
		if (phase.value === 'done') discard();
		hideNotes();
		const saved = resume?.state;
		if (saved) applySettings(saved.settings);
		abort = false;
		phase.value = 'finding';
		curve.value = [];
		evaluations.value = 0;
		log.value = [];
		best.value = null;
		result.value = null;
		runStart = saved?.runStart ?? snapshot();
		// Culprits already found in this very project (Find culprits) are where the fix starts.
		const found = !saved && culpritsOf === runStart ? attribution.value : null;
		attribution.value = null;
		const project = JSON.parse(runStart) as Project;
		// Tells other tabs this run is alive (they mustn't offer to resume its checkpoint).
		releaseLock ??= holdRunLock('tiling');
		await nextFrame();
		engine.suspend();
		let ev: Awaited<ReturnType<typeof tilingEvaluator>> | null = null;
		let autosave: ReturnType<typeof autosaveRun> | null = null;
		let state: TilingRunState | null = null;
		const gpu = tilingGpu(engine.gpu);
		// A frame painted at most every 100 ms: waiting for one per render costs a share of a fast candidate.
		const yieldStep = yieldEvery();
		try {
			let a: TilingAttribution;
			if (saved) {
				// The culprits as found then; the render (the panes', the drift's reference) made again.
				progress.value = resume.paused ? 'Reopening the fix…' : 'Resuming the fix…';
				await yieldStep();
				const frame = renderFrame(engine, project, samples.value, gpu);
				a = { frame, analysis: analyzeTiling(frame, {}, gpu), layers: saved.layers, findings: saved.findings };
			} else if (found) a = found;
			else {
				a = await attribute(engine, project, gpu, yieldStep);
				culpritsOf = runStart;
			}
			current.value = { frame: a.frame, analysis: a.analysis };
			attribution.value = a;
			const names = [...new Set(a.findings.map((f) => a.layers[f.layer].name))];
			log.value = [`culprits: ${names.slice(0, culprits.value).join(', ') || 'none stands out'}`];
			if (!a.findings.length) {
				editor.notify('No layer stands out as the cause of the repeat');
				phase.value = 'idle';
				return;
			}

			// The fix: reseed, then nudge the culprits' pattern params.
			phase.value = 'fixing';
			ev = await tilingEvaluator(engine, a.frame, { samples: samples.value, gpu, yieldBefore: yieldStep });
			const evaluator = ev;
			const s = stepSize.value;
			const beforeScore = saved?.beforeScore ?? a.analysis.score;
			const replay = saved?.evals ?? [];
			const rec: TilingRunState = {
				settings: settingsNow(),
				runStart,
				beforeScore,
				layers: a.layers.map(({ map: _, ...l }) => l),
				findings: a.findings,
				// Checkpoints saved before runs had their own seed used 1.
				rngSeed: saved ? (saved.rngSeed ?? 1) : Math.floor(Math.random() * 2 ** 32),
				evals: [...replay]
			};
			state = rec;
			const take = (): CheckpointInput<TilingRunState> => ({
				step: rec.evals.length,
				loss: curve.value.at(-1) ?? null,
				project: snapshot(),
				state: { ...rec, evals: [...rec.evals] }
			});
			autosave = autosaveRun(take, (cp) => void checkpoints.save(cp));
			const save = autosave;
			const r = await fixTiling(
				project,
				a,
				async (q, bar) => {
					save.beforeStep();
					const e = await evaluator.evaluate(q, bar);
					rec.evals.push({ score: e.score, drift: e.drift });
					save.afterStep();
					return e;
				},
				{
					before: { score: beforeScore, drift: 0, detail: { frame: a.frame, analysis: a.analysis } },
					seeds: seeds.value,
					rngSeed: rec.rngSeed,
					culprits: culprits.value,
					steps: [-s, -0.4 * s, 0.4 * s, s],
					driftWeight: holdLook.value,
					minGain: minGain.value,
					scale: allowScale.value,
					replay,
					// Reopening a run that had stopped: as far as it had got.
					shouldStop: () => abort || (!!resume?.paused && evaluations.value >= replay.length),
					onEvaluate: (n, c, kept) => {
						evaluations.value = n;
						// A new array: LossChart's computeds see a change of the prop, not a push into it.
						curve.value = [...curve.value, kept.loss];
						// The pane shows the lowest loss seen so far (the search keeps it once its round ends).
						const shownLoss = best.value?.candidate.loss ?? kept.loss;
						if (c.detail && c.loss < Math.min(shownLoss, kept.loss)) best.value = { ...c.detail, candidate: c };
						// Replayed candidates have no render: once the replay is through, show the best it reached.
						if (n === replay.length && !resume?.paused && kept.project !== project && !kept.detail) {
							const frame = evaluator.render(kept.project);
							best.value = { frame, analysis: analyzeTiling(frame, {}, gpu), candidate: kept };
						}
						progress.value = `Fixing · ${n} candidates · best ${(best.value?.candidate.score ?? kept.score).toFixed(3)}`;
					}
				}
			);
			result.value = r;
			// The live pane follows every better candidate, also ones the search then didn't keep (gain below Min gain).
			const shownBest = best.value as (Shot & { candidate: FixCandidate }) | null;
			if (r.after.project === r.before.project) best.value = null;
			else if (shownBest?.candidate.project !== r.after.project) {
				// The search keeps the result's render; render it again only if it didn't.
				const frame = r.after.detail?.frame ?? evaluator.render(r.after.project);
				const analysis = r.after.detail?.analysis ?? analyzeTiling(frame, {}, gpu);
				best.value = { frame, analysis, candidate: r.after };
			}
			rec.stopped = resume?.paused ? !!saved?.stopped : abort;
			log.value = [
				...log.value,
				...(r.changes.length
					? r.changes.map((c) => `${c.name}: ${c.key} ${String(c.from)} → ${String(c.to)}`)
					: ['no change helped']),
				`${rec.stopped ? 'stopped' : 'done'} · ${r.evaluations} candidates · score ${r.before.score.toFixed(3)} → ${r.after.score.toFixed(3)}`
			];
			phase.value = 'done';
			hotspotOf.value = r.changes.length ? 'fixed' : 'current';
			if (resume?.paused) editor.notify(`Reopened the tiling fix: it isn't kept yet`);
		} catch (e) {
			if (!(e instanceof Stopped)) editor.notify(`Tiling fix failed: ${e instanceof Error ? e.message : e}`, 'error');
			phase.value = 'idle';
		} finally {
			autosave?.stop();
			ev?.dispose();
			gpu?.release();
			progress.value = '';
			engine.resume(toRaw(store.project));
			// A fix to keep or discard stays reopenable until then; anything else has nothing to come back to.
			if (phase.value === 'done' && result.value?.changes.length && state)
				void checkpoints.save({
					step: state.evals.length,
					loss: result.value.after.loss,
					project: snapshot(),
					paused: true,
					state
				});
			else if (phase.value !== 'done') dropCheckpoint();
			else void checkpoints.clear();
		}
	}

	function onResumeEvent(e: Event): void {
		const d = (e as CustomEvent<ResumeRunEvent>).detail;
		if (d?.workspace === 'tiling') void run(d.checkpoint as Checkpoint<TilingRunState>);
	}

	function stop(): void {
		abort = true;
	}

	async function keep(): Promise<void> {
		const r = result.value;
		if (!r || !r.changes.length) return;
		if (snapshot() !== runStart) {
			const choice = await editor.ask({
				title: 'Replace your edits?',
				detail:
					"You have edited the project since this optimised fix was calculated. Applying it now will undo the edits you've made since. (You can always use Ctrl+Z to bring them back)",
				choices: [{ id: 'keep', label: 'Keep the fix', primary: true }]
			});
			if (choice !== 'keep' || result.value !== r) return;
		}
		store.load(r.project);
		editor.notify(
			`Kept the fix · tiling ${r.before.score.toFixed(3)} → ${r.after.score.toFixed(3)} — undo with Ctrl+Z`
		);
		current.value = best.value;
		seen = snapshot();
		clearRun();
	}

	function discard(): void {
		clearRun();
		if (snapshot() !== seen) void analyseCurrent();
	}

	function clearRun(): void {
		dropCheckpoint();
		phase.value = 'idle';
		best.value = null;
		result.value = null;
		attribution.value = null;
		curve.value = [];
		evaluations.value = 0;
		hotspotOf.value = 'current';
	}

	// Edits made beside the workspace (outliner, properties) are analysed once they pause, unless a run or its result
	// holds the panes: a slider being dragged doesn't render and analyse on every step. Watched only while the workspace
	// is shown (the deep watch walks the whole project on every edit).
	let active = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let unwatch: WatchStopHandle | null = null;
	onActivated(() => {
		active = true;
		unwatch ??= watch(
			() => store.project,
			() => {
				if (!active || running.value || phase.value === 'done') return;
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => {
					timer = null;
					if (active && snapshot() !== seen) void analyseCurrent();
				}, 300);
			},
			{ deep: true }
		);
		if (!running.value && phase.value !== 'done' && snapshot() !== seen) void analyseCurrent();
	});
	// Leaving stops a run (the viewport needs the engine); its best so far stays to keep or discard.
	onDeactivated(() => {
		active = false;
		abort = true;
		unwatch?.();
		unwatch = null;
	});
	onMounted(() => window.addEventListener('bismith:resume-run', onResumeEvent));
	onBeforeUnmount(() => {
		abort = true;
		if (timer) clearTimeout(timer);
		releaseLock?.();
		releaseLock = null;
		window.removeEventListener('bismith:resume-run', onResumeEvent);
	});

	const shown = computed(() =>
		hotspotOf.value === 'fixed' && best.value ? best.value.analysis : current.value?.analysis
	);
	const fixedTerms = computed(() => best.value?.analysis.terms ?? null);
	/** The bar's line: what is going on, or what to do next. */
	const status = computed(() => {
		if (progress.value) return progress.value;
		if (phase.value === 'done')
			return result.value?.changes.length
				? 'Keep the fix, or discard it.'
				: 'No change made the repeat less noticeable.';
		const a = attribution.value;
		if (a) return a.findings.length ? 'Culprits found. Click Fix to work on them.' : 'No single layer stands out.';
		return 'Find what makes the repeat noticeable, then fix it.';
	});
	const culpritNames = computed(() => {
		const a = attribution.value;
		if (!a) return [];
		const seenIds = new Set<number>();
		return a.findings
			.filter((f) => !seenIds.has(f.layer) && seenIds.add(f.layer))
			.map((f) => ({ name: a.layers[f.layer].name, term: TERM_LABELS[f.term], weight: f.weight }));
	});
</script>

<template>
	<section class="tiling cf-panel">
		<div class="bar">
			<span class="cf-label">Tiling</span>
			<span class="lo">{{ status }}</span>
			<span class="grow" />
			<button
				type="button"
				class="cf-btn"
				:disabled="!editor.engine || running || phase === 'done'"
				:title="
					phase === 'done'
						? 'Keep or discard the fix first'
						: 'Find which layers make the repeat noticeable. Nothing is changed.'
				"
				@click="findCulprits">
				<IconScan :size="13" />
				Find culprits
			</button>
			<button v-if="!running" type="button" class="fk primary" :disabled="!editor.engine" @click="run()">
				<span class="fk-face"><IconPlayerPlay :size="12" />{{ phase === 'done' ? 'Run again' : 'Run fix' }}</span>
			</button>
			<button v-else type="button" class="cf-btn" @click="stop">
				<IconPlayerStop :size="12" />
				Stop
			</button>
			<template v-if="phase === 'done'">
				<button
					type="button"
					class="fk primary"
					:disabled="!result?.changes.length"
					title="Apply the fix to the project (undo with Ctrl+Z)"
					@click="keep">
					<span class="fk-face"><IconCheck :size="12" />Keep this</span>
				</button>
				<button type="button" class="cf-btn" title="Forget the fix, back to the project as it is" @click="discard">
					<IconX :size="12" />
					Discard
				</button>
			</template>
		</div>

		<div class="panes">
			<figure>
				<figcaption class="cf-label cap">
					<span>{{ running || phase === 'done' ? 'Before' : 'Current project' }} · 3×3</span>
					<span
						v-if="current"
						class="score cf-mono"
						title="Tiling score: 0 = no tiling at all, 1 = extremely noticable tiling"
						>{{ current.analysis.score.toFixed(3) }}</span
					>
				</figcaption>
				<ImageCanvas
					:pixels="currentPx?.pixels ?? null"
					:width="currentPx?.width ?? 1"
					:height="currentPx?.height ?? 1"
					:tiles="3"
					label="Current project tiled 3 by 3"
					pending
					pickable
					@dismiss-note="hideNotes">
					<template v-if="notes" #note>
						<h3>Your project tiled 3 × 3</h3>
						<p>
							This pane shows your project tiled three times in each direction. This is your existing project to compare
							against. The middle pane will show you your project with the tiling fixes applied.
						</p>
						<p>
							The number beside the title is the tiling score. At 0 the repeat can't be seen; at 1 it is very obvious.
						</p>
					</template>
				</ImageCanvas>
			</figure>
			<figure>
				<figcaption class="cf-label cap">
					<span>{{ running ? 'Best so far' : 'Fixed' }} · 3×3</span>
					<span v-if="best" class="score cf-mono" title="Tiling score of the fix">{{
						best.candidate.score.toFixed(3)
					}}</span>
					<span v-if="best" class="drift cf-mono" title="How far the look moved (Windows match against before)"
						>drift {{ best.candidate.drift.toFixed(2) }}</span
					>
				</figcaption>
				<ImageCanvas
					:pixels="fixedPx?.pixels ?? null"
					:width="fixedPx?.width ?? 1"
					:height="fixedPx?.height ?? 1"
					:tiles="3"
					label="Fixed project tiled 3 by 3"
					pickable>
					<h3>Tiling Workspace</h3>
					<p>
						Use the Tiling workspace to remove obvious tiling artefacts in your texture: details that stand out every
						time the texture repeats which makes the repeat too noticable. Tiling finds these artefacts and tones them
						down.
					</p>
					<p>
						This pane will show you the best fix that has been found which makes the tiling repeating least noticable.
						It doesnt affect your project unless you decide to keep the fixed settings.
					</p>
					<p><b>Find culprits</b> shows which layers are mostly responsible for the tiling issues.</p>
					<p>
						<b>Run fix</b> then tweaks those layers. It tries new random seeds and small changes to their pattern
						settings. It keeps only the changes that make the repeat less noticeable while keeping the material still
						looking the same.
					</p>
				</ImageCanvas>
			</figure>
			<figure>
				<figcaption class="cf-label cap">
					<span>Hotspots</span>
					<span v-if="best" class="pick" role="radiogroup" aria-label="Hotspots of">
						<button
							type="button"
							class="cf-toggle"
							:class="{ on: hotspotOf === 'current' }"
							role="radio"
							:aria-checked="hotspotOf === 'current'"
							@click="hotspotOf = 'current'">
							Before
						</button>
						<button
							type="button"
							class="cf-toggle"
							:class="{ on: hotspotOf === 'fixed' }"
							role="radio"
							:aria-checked="hotspotOf === 'fixed'"
							@click="hotspotOf = 'fixed'">
							Fixed
						</button>
					</span>
				</figcaption>
				<ImageCanvas
					:pixels="hotspotPx?.pixels ?? null"
					:width="hotspotPx?.width ?? 1"
					:height="hotspotPx?.height ?? 1"
					:tiles="3"
					label="Where the repeat draws the eye"
					pending
					@dismiss-note="hideNotes">
					<template v-if="notes" #note>
						<h3>Hotspots</h3>
						<p>
							Highlights the parts of the texture that give the repeat away, such as a patch that stands out or a line
							that stops at the tile edge. Brighter areas draw the eye more.
						</p>
						<p>The bars below rate each kind of artefact over the whole texture.</p>
					</template>
				</ImageCanvas>
			</figure>
		</div>

		<div class="lower">
			<div class="settings">
				<div class="row">
					<span v-tip:right="TIPS.seeds" class="lbl">Seeds</span>
					<NumberField v-model="seeds" :min="0" :max="200" :soft-min="4" :soft-max="128" int label="Seeds per layer" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.layers" class="lbl">Layers</span>
					<NumberField v-model="culprits" :min="1" :max="8" int label="Layers to fix" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.nudge" class="lbl">Nudge</span>
					<NumberField v-model="stepSize" :min="0" :max="0.5" :soft-max="0.3" :step="0.01" label="Nudge size" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.holdLook" class="lbl">Hold look</span>
					<NumberField v-model="holdLook" :min="0" :max="20" :soft-max="8" :step="0.1" label="Hold the look" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.minGain" class="lbl">Min gain</span>
					<NumberField v-model="minGain" :min="0" :max="0.2" :soft-max="0.05" :step="0.001" label="Minimum gain" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.samples" class="lbl">Samples</span>
					<NumberField v-model="samples" :min="1" :max="256" :soft-max="128" int label="Samples per candidate" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.scale" class="lbl">Scale</span>
					<CheckField v-model="allowScale" label="Allow scale changes" />
				</div>
			</div>

			<div class="progress">
				<div class="stats cf-mono">
					<span
						>candidates <b>{{ evaluations }}</b></span
					>
					<span v-if="result || best"
						>score <b>{{ (result?.before.score ?? current?.analysis.score ?? 0).toFixed(3) }}</b> →
						<b>{{ (result?.after.score ?? best?.candidate.score ?? 0).toFixed(3) }}</b></span
					>
					<span v-if="result"
						>look allowance <b>{{ result.driftFree.toFixed(2) }}</b></span
					>
				</div>
				<LossChart :values="curve" />
			</div>

			<div class="terms">
				<div v-for="t in TILING_TERMS" :key="t" class="term">
					<span class="tl">{{ TERM_LABELS[t] }}</span>
					<div class="tb">
						<div :style="{ width: `${Math.min(100, (shown?.terms[t] ?? 0) * 100)}%` }" />
					</div>
					<span class="tv cf-mono"
						>{{ current ? current.analysis.terms[t].toFixed(2) : '—'
						}}<template v-if="fixedTerms"> → {{ fixedTerms[t].toFixed(2) }}</template></span
					>
				</div>
				<div class="log cf-mono">
					<p v-if="!culpritNames.length && !log.length" class="hint">
						Find culprits lists the layers that make the repeat noticeable here, the worst first, with what gives them
						away.
					</p>
					<p v-if="culpritNames.length" class="hint">Layers to blame, worst first, and what gives them away:</p>
					<div v-for="c in culpritNames" :key="c.name">{{ c.name }} · {{ c.term }} {{ c.weight.toFixed(2) }}</div>
					<div v-for="(l, i) in log" :key="i">{{ l }}</div>
				</div>
			</div>
		</div>
	</section>
</template>

<style scoped>
	.tiling {
		display: grid;
		grid-template-rows: 36px minmax(0, 1fr) 200px;
		overflow: hidden;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 8px;
		border-bottom: 1px solid var(--hairline);
		min-width: 0;
	}

	.bar .lo {
		font-size: 12px;
		color: var(--text-lo);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.grow {
		flex: 1;
	}

	.panes {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
		padding: 6px;
		min-height: 0;
	}

	figure {
		margin: 0;
		display: grid;
		grid-template-rows: 20px minmax(0, 1fr);
		min-height: 0;
	}

	.cap {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.cap .score,
	.cap .drift {
		letter-spacing: 0;
		color: var(--text-mid);
	}

	.pick {
		display: flex;
		gap: 4px;
	}

	.pick .cf-toggle {
		height: 18px;
		padding: 0 6px;
		font: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
	}

	.lower {
		display: grid;
		grid-template-columns: 300px minmax(0, 1fr) 300px;
		gap: 8px;
		padding: 6px 8px 8px;
		border-top: 1px solid var(--hairline);
		min-height: 0;
	}

	.settings {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 0;
		overflow-y: auto;
	}

	.settings > * {
		flex-shrink: 0;
	}

	.row {
		display: grid;
		grid-template-columns: 70px minmax(0, 1fr);
		gap: 8px;
		align-items: center;
		min-height: 24px;
	}

	.lbl {
		font-size: 12px;
		color: var(--text-lo);
		text-align: right;
		cursor: help;
	}

	.progress {
		display: grid;
		grid-template-rows: 22px minmax(0, 1fr);
		gap: 4px;
		min-height: 0;
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0 14px;
		white-space: nowrap;
		font-size: 11px;
		color: var(--text-lo);
		align-items: center;
	}

	.stats b {
		color: var(--pill);
		font-weight: 400;
	}

	.terms {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-height: 0;
	}

	.term {
		display: grid;
		grid-template-columns: 96px minmax(0, 1fr) 84px;
		gap: 6px;
		align-items: center;
		font-size: 11px;
	}

	.tl {
		color: var(--text-lo);
		text-align: right;
	}

	.tb {
		height: 6px;
		background: var(--hairline);
	}

	.tb > div {
		height: 100%;
		background: var(--sigil);
	}

	.tv {
		color: var(--text);
		text-align: right;
	}

	.log .hint {
		margin: 0;
		font-family: var(--font-sans);
		color: var(--text-lo);
	}

	.log {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		margin-top: 4px;
		padding: 4px 6px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--sunken);
		font-size: 10px;
		color: var(--text-lo);
		line-height: 1.5;
	}
</style>
