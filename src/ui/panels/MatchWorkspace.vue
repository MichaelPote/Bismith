<script setup lang="ts">
	// Reference matching (docs/features/fr6.3-optimizer.md): load a reference, then let the evolution strategy
	// tune the unlocked layers toward it while you watch the loss fall.
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
	import {
		Matcher,
		TERM_NAMES,
		absDiff,
		fromLinear,
		fromRgba8,
		resample,
		type MatchImage,
		type MetricPreset,
		type MetricResult
	} from '@/match/metrics';
	import { analyzeTarget } from '@/match/analyze';
	import { rgbaImage } from '@/ui/rgbaImage';
	import { availableTemplates } from '@/match/templates';
	import { fitColours } from '@/match/colourFit';
	import { attachTexture } from '@/match/evaluate';
	import {
		Optimizer,
		RunLimits,
		STOP_LABELS,
		extractParams,
		type OptimizerSnapshot,
		type RunLimitsSnapshot,
		type StepInfo,
		type StopCriteria,
		type StopReason
	} from '@/match/optimizer';
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
	import SelectField from '@/ui/components/SelectField.vue';
	import CheckField from '@/ui/components/CheckField.vue';
	import { nextFrame } from '@/ui/schedule';
	import { vTip, type Tip } from '@/ui/tooltip';
	import { IconPalette, IconPhoto, IconPlayerPause, IconPlayerPlay, IconWand, IconX } from '@tabler/icons-vue';

	const store = useProjectStore();
	const editor = useEditorStore();

	const reference = shallowRef<MatchImage | null>(null);
	const refName = ref('');
	const preset = ref<MetricPreset>('tilewin');
	/** Set once the metric is picked by hand; until then each reference picks it by its size (see loadFile). */
	let presetChosen = false;
	/** Windows metric: window side as 1/N of the short side. */
	const windowDiv = ref('8');
	/** Colour range: how far (OKLab) the layers' colours may stray from the reference's own colours ('0' = off). */
	const colourRangeSel = ref('0.06');
	const samples = ref(16);
	// Stop criteria (0 = off). With all off the run goes on until paused.
	const maxSteps = ref(300);
	const targetLoss = ref(0);
	const timeLimit = ref(0);
	const stallSteps = ref(0);
	const stopped = ref<StopReason | null>(null);
	const space = ref({ layers: true, base: true, shading: true, lights: true, post: false, enums: false, seeds: false });
	const structural = ref(true);

	function settingsNow(): MatchSettings {
		return {
			preset: preset.value,
			presetChosen,
			windowDiv: windowDiv.value,
			colourRange: colourRangeSel.value,
			samples: samples.value,
			maxSteps: maxSteps.value,
			targetLoss: targetLoss.value,
			timeLimit: timeLimit.value,
			stallSteps: stallSteps.value,
			space: { ...space.value },
			structural: structural.value
		};
	}

	function applySettings(s: MatchSettings): void {
		preset.value = s.preset;
		presetChosen = s.presetChosen;
		windowDiv.value = s.windowDiv;
		colourRangeSel.value = s.colourRange;
		samples.value = s.samples;
		maxSteps.value = s.maxSteps;
		targetLoss.value = s.targetLoss;
		timeLimit.value = s.timeLimit;
		stallSteps.value = s.stallSteps;
		space.value = { ...s.space };
		structural.value = s.structural;
	}

	const running = ref(false);
	const optimizer = shallowRef<Optimizer | null>(null);
	/** The matcher the current optimiser scores with (its GPU texture statistics are freed on reset). */
	let runMatcher: Matcher | null = null;
	// Shallow: a long run has tens of thousands of points, which a deep ref would proxy one by one.
	const curve = shallowRef<number[]>([]);
	const lastInfo = shallowRef<StepInfo | null>(null);
	const log = ref<string[]>([]);
	/** The score of what the middle pane shows. */
	const shownResult = shallowRef<MetricResult | null>(null);
	/** What the middle pane shows: the current project (rescored as you edit it) or the optimiser's best. */
	const showing = ref<'current' | 'best'>('current');
	const startLoss = ref<number | null>(null);
	const renderPx = shallowRef<{ pixels: Uint8ClampedArray; width: number; height: number } | null>(null);
	const diffPx = shallowRef<{ pixels: Uint8ClampedArray; width: number; height: number } | null>(null);
	/** What the third pane shows: |render − reference| or the Windows metric's mismatch map. */
	const diffMode = ref<'pixels' | 'windows'>('pixels');
	const fitting = ref(false);
	let abort = false;
	/** The project as last shown in the panes: on returning to Match, a different one means it was edited meanwhile. */
	let seen = '';
	/** The project the optimiser started from: a different one now means edits that Resume and Apply best would miss. */
	let runStart = '';
	/** The edited project the user chose to resume the run without (asked once per version). */
	let resumedWithout = '';
	const snapshot = () => JSON.stringify(toRaw(store.project));
	/**
	 * A plain deep copy of the project. Not structuredClone: store edits that rebuild a list from items read through the
	 * reactive project (moving a layer, material helpers) leave proxies inside the raw object, which it can't clone.
	 */
	const copyProject = (): Project => JSON.parse(snapshot());

	// ---------------------------------------------------------------- run checkpoints
	// A run is checkpointed while it goes (stores/runCheckpoint.ts): every ~10 s and whenever the page is hidden, so a
	// tab the browser discards in the background (or a crash) doesn't lose it — at the next start-up ui/resumeRuns.ts
	// offers to resume it, and resumeRun() below carries on from the saved step. A run that stops (paused, finished, the
	// workspace left) leaves a last checkpoint marked paused, offered for reopening while its best is unapplied; Apply
	// best and Reset clear it. Its lock is held as long as the run exists here, so other tabs don't offer it.

	/** The settings a run depends on (its optimiser's options, its matcher, its renders). */
	interface MatchSettings {
		preset: MetricPreset;
		presetChosen: boolean;
		windowDiv: string;
		colourRange: string;
		samples: number;
		maxSteps: number;
		targetLoss: number;
		timeLimit: number;
		stallSteps: number;
		space: typeof space.value;
		structural: boolean;
	}

	interface MatchRunState {
		settings: MatchSettings;
		/** The matcher's tiling (the project's when the run began). */
		wrap: boolean;
		/** The project the optimiser began from, as JSON; null when it is the checkpoint's project. */
		runStart: string | null;
		optimizer: OptimizerSnapshot;
		/** This press's stop criteria and what it has used of them. */
		limits: RunLimitsSnapshot;
		curve: number[];
		log: string[];
		startLoss: number | null;
		lastInfo: StepInfo | null;
	}

	/** The reference image as loaded (a file, or the blob a checkpoint kept): put in the checkpoint once per run. */
	let refBlob: Blob | null = null;
	const checkpoints = runCheckpoints<MatchRunState>('match');
	/** Releases this tab's hold on the run (see holdRunLock): held while an optimiser exists. */
	let releaseLock: (() => void) | null = null;

	const TERM_SHORT: Record<string, string> = {
		colour: 'Colour',
		spectrum: 'Frequency',
		gradients: 'Edges',
		contrast: 'Contrast',
		aligned: 'Alignment',
		structure: 'Structure',
		texture: 'Texture',
		windows: 'Windows',
		alpha: 'Alpha'
	};
	const PRESET_OPTIONS = [
		{ value: 'tilewin', label: 'Tile + windows' },
		{ value: 'windows', label: 'Windows (local texture)' },
		{ value: 'tile', label: 'Tile (structure at best shift)' },
		{ value: 'texture', label: 'Texture (statistics)' },
		{ value: 'layout', label: 'Layout (+ pixel aligned)' },
		{ value: 'tilemotif', label: 'Tile + motifs (rivets, bolts)' }
	];
	/** The settings' tooltips: what each one is, and why you would change it. */
	const TIPS: Record<string, Tip> = {
		metric: {
			title: 'Metric',
			body: 'The measure of whether your render looks like the reference image. The optimiser tries to make this measure, the loss, as small as possible. Pick the one that suits your reference. Changing it starts the run over.',
			list: [
				['Tile + windows', 'Tile and Windows together. A good default.'],
				['Windows', "compares local patches. Use it when the layout doesn't matter, as with planks, stone or grass."],
				['Tile', 'compares the structure, allowing a shift. Use it for regular repeating patterns.'],
				['Texture', 'compares overall statistics: colour, frequency and edges. Use it for noisy, random textures.'],
				['Layout', 'also compares where things are. Use it for images such as UI elements, where position matters.'],
				[
					'Tile + motifs',
					"Tile + windows, and also holds small laid-out features such as rivets, bolts and studs in their places and at their strength. Set the project up by hand first so it already has those features roughly right: where it can't make them at all, this metric does worse than Tile + windows. It counts only as far as the reference's features repeat in a pattern."
				]
			]
		},
		window: {
			title: 'Window size',
			body: 'The size of the local patches the Windows metric compares. Smaller windows look at finer detail and ignore more of the layout. Larger windows also judge how features are arranged. Try Fine when small details or grain are what matter most. Changing it starts the run over.'
		},
		colours: {
			title: 'Colour range',
			body: 'Keeps the colours used close to the colours in the reference. Without it, the optimiser tends to fix lighting or other macro-scale effects by, for example, over-saturating a gradient ramp with strong colours to cancel out the lighting. Tight allows the least change and Loose the most. Off lets colours go anywhere. Greys are always allowed. Changing it starts the run over.'
		},
		samples: {
			title: 'Samples',
			body: 'How many path-traced samples each candidate render uses. More samples give a cleaner render, so noise affects the comparison less, but each step takes longer. Lower it to speed a run up. Raise it if the loss jumps around from one step to the next.'
		},
		maxSteps: {
			title: 'Max steps',
			body: 'How many steps each press of Optimise or Continue runs before it pauses. Each step renders a few changed versions of the project and keeps the best. At 0 there is no limit: the run goes on until another limit stops it or you pause it.'
		},
		stopAtLoss: {
			title: 'Stop at loss',
			body: 'Stops the run once the loss reaches this value. Use it to save time when a match is already good enough; the run shows its best loss as it goes. At 0 it is off.'
		},
		timeLimit: {
			title: 'Time limit',
			body: 'Stops each run after this many seconds. 0 means no time limit.'
		},
		stallAfter: {
			title: 'Stall after',
			body: 'Stops the run after this many steps in a row without the best result improving. A long stall usually means the optimiser has found the best it can do. At 0 it is off.'
		},
		tune: {
			title: 'Tune',
			body: 'Which parts of the project Match may change. Turn off anything you want to keep as it is. Fewer settings in play also make each step more effective. You can also lock individual layers in the outliner to stop the optimiser touching them. Changing these starts the run over.',
			list: [
				['Layers', 'all settings in the layers inspector'],
				['Base', "the project's base material colour and surface properties"],
				['Shading', 'ambient occlusion, specular and height depth'],
				['Lights', 'all light positions, colours and strengths'],
				['Post', 'all the post-processing filters'],
				[
					'Modes',
					"allow the optimiser to change the mode of layers that have a dropdown of mode options, such as a pattern's style"
				],
				['Seeds', 'random seeds, which give a different random layout'],
				[
					'Add/remove layers',
					'lets Match add layers or take them away, usually duplicating one of your own layers and tweaking it'
				]
			]
		}
	};

	const COLOUR_RANGE_OPTIONS = [
		{ value: '0', label: 'Off' },
		{ value: '0.03', label: 'Tight' },
		{ value: '0.06', label: 'Normal' },
		{ value: '0.12', label: 'Loose' }
	];

	const WINDOW_OPTIONS = [
		{ value: '16', label: 'Fine (1/16 of the side)' },
		{ value: '8', label: 'Medium (1/8)' },
		{ value: '4', label: 'Coarse (1/4)' }
	];

	const refPx = computed(() => (reference.value ? rgbaImage(reference.value) : null));
	const entryCount = computed(() => extractParams(store.project, { ...space.value }).entries.length);

	// ---------------------------------------------------------------- reference loading
	async function decodeImage(blob: Blob): Promise<MatchImage> {
		const bmp = await createImageBitmap(blob);
		const c = document.createElement('canvas');
		c.width = bmp.width;
		c.height = bmp.height;
		const ctx = c.getContext('2d', { willReadFrequently: true })!;
		ctx.drawImage(bmp, 0, 0);
		const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
		return fromRgba8(d.data, d.width, d.height);
	}

	async function loadFile(file: File): Promise<void> {
		try {
			const d = await decodeImage(file);
			reference.value = d;
			refBlob = file;
			refName.value = file.name;
			// Big references are matched by local texture (fine detail, layout free); small game textures by Tile + windows,
			// which also matches the layout (FR8.19).
			if (!presetChosen) preset.value = Math.max(d.width, d.height) >= 256 ? 'windows' : 'tilewin';
			reset();
			editor.notify(
				`Reference “${file.name}” · ${d.width}×${d.height} · ${PRESET_OPTIONS.find((o) => o.value === preset.value)?.label ?? preset.value}`
			);
			void view();
		} catch (e) {
			editor.notify(`Could not read the image: ${e instanceof Error ? e.message : e}`, 'error');
		}
	}

	function pickFile(): void {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.onchange = () => {
			const f = input.files?.[0];
			if (f) void loadFile(f);
		};
		input.click();
	}

	function onDropEvent(e: Event): void {
		const f = (e as CustomEvent<File>).detail;
		if (f) void loadFile(f);
	}

	function matchSize(): void {
		const r = reference.value;
		if (!r) return;
		const long = Math.max(r.width, r.height);
		const s = long > 512 ? 512 / long : 1;
		store.resize(r.width * s, r.height * s);
		reset();
	}

	// ---------------------------------------------------------------- evaluation
	/** The tiling the run's matcher compares with. */
	let runWrap = false;

	/** The run's optimiser, scoring renders with `matcher` (the same options for a new run and a resumed one). */
	function newOptimizer(start: Project, matcher: Matcher): Optimizer {
		return new Optimizer(
			start,
			(p) => {
				const image = renderImage(p);
				const r = matcher.score(image);
				return { loss: r.total, detail: r, image };
			},
			{
				lambda: 4,
				structural: structural.value,
				colourRange: Number(colourRangeSel.value),
				space: { ...space.value },
				seed: 1,
				target: matcher.target
			}
		);
	}
	/** A matcher for the reference, with the GPU texture term when the preset uses it. */
	async function makeMatcher(target: MatchImage = reference.value!, wrap = store.project.tileable): Promise<Matcher> {
		const m = new Matcher(target, {
			preset: preset.value,
			wrap,
			window: !wrap,
			windowFraction: 1 / Number(windowDiv.value)
		});
		if (editor.engine) await attachTexture(editor.engine, m, wrap);
		return m;
	}

	function renderImage(p: Project): MatchImage {
		const engine = editor.engine!;
		engine.setProject(p);
		engine.renderNow(samples.value);
		return fromLinear(engine.readFinal());
	}

	function show(img: MatchImage, matcher: Matcher): void {
		renderPx.value = rgbaImage(img);
		// The Windows metric doesn't compare pixels in place: show where the render's windows have no look-alike instead.
		const d = matcher.windowMap(img) ?? absDiff(matcher.fit(img), matcher.target, 3);
		diffMode.value = matcher.windowTarget ? 'windows' : 'pixels';
		diffPx.value = rgbaImage(d);
	}

	/** The panes' matcher: kept while the reference, metric and tiling stay the same, since edits rescore often. */
	let paneMatcher: Matcher | null = null;
	let paneKey: unknown[] = [];
	let viewing = false;
	let viewNext: 'current' | 'best' | null = null;

	async function getPaneMatcher(): Promise<Matcher> {
		const key = [reference.value, preset.value, store.project.tileable, windowDiv.value];
		if (!paneMatcher || key.some((k, i) => k !== paneKey[i])) {
			paneMatcher?.dispose();
			paneMatcher = null;
			paneMatcher = await makeMatcher();
			paneKey = key;
		}
		return paneMatcher;
	}

	function freePaneMatcher(): void {
		paneMatcher?.dispose();
		paneMatcher = null;
	}

	/** Render and score the current project (or the optimiser's best) into the panes. One at a time; the last ask wins. */
	async function view(which: 'current' | 'best' = 'current'): Promise<void> {
		const engine = editor.engine;
		if (!engine || !reference.value) return;
		if (viewing) {
			viewNext = which;
			return;
		}
		viewing = true;
		try {
			const matcher = await getPaneMatcher();
			const opt = optimizer.value;
			// A run or another job took the engine meanwhile.
			if (running.value || busy.value || fitting.value || (which === 'best' && !opt)) return;
			engine.suspend();
			try {
				if (which === 'current') seen = snapshot();
				const img = renderImage(which === 'best' ? opt!.best.project : toRaw(store.project));
				shownResult.value = matcher.score(img);
				showing.value = which;
				show(img, matcher);
			} finally {
				engine.resume(toRaw(store.project));
			}
		} catch (e) {
			editor.notify(`Scoring failed: ${e instanceof Error ? e.message : e}`, 'error');
		} finally {
			viewing = false;
			const next = viewNext;
			viewNext = null;
			// Skip a queued view of the current project that this one has just shown.
			if (next && !(next === 'current' && showing.value === 'current' && snapshot() === seen)) void view(next);
		}
	}

	/** Palette snaps off while fitting (the fit compares raw colours), back on after. */
	function paletteOff(p: Project): { project: Project; restore: (q: Project) => Project } {
		const on = new Set(p.post.filter((f) => f.type === 'palette' && f.enabled !== false).map((f) => f.id));
		return {
			project: { ...p, post: p.post.map((f) => (on.has(f.id) ? { ...f, enabled: false } : f)) },
			restore: (q) => ({ ...q, post: q.post.map((f) => (on.has(f.id) ? { ...f, enabled: true } : f)) })
		};
	}

	/** Fit the current project's colours to the reference (materials through their colour controls). */
	async function fitColoursNow(): Promise<void> {
		const engine = editor.engine;
		if (!engine || !reference.value || running.value || busy.value || fitting.value) return;
		fitting.value = true;
		await nextFrame();
		const matcher = await makeMatcher();
		engine.suspend();
		try {
			const { project, restore } = paletteOff(copyProject());
			const r = await fitColours(project, matcher, (p) => renderImage(p));
			if (r.after < r.before - 1e-5) {
				store.load(restore(r.project));
				reset();
				editor.notify(`Colours fitted · loss ${r.before.toFixed(3)} → ${r.after.toFixed(3)} — undo with Ctrl+Z`);
			} else editor.notify('The colours already fit as well as the fit can do');
		} catch (e) {
			editor.notify(`Colour fit failed: ${e instanceof Error ? e.message : e}`, 'error');
		} finally {
			matcher.dispose();
			fitting.value = false;
			engine.resume(toRaw(store.project));
		}
		void view();
	}

	// ---------------------------------------------------------------- resizable settings panel
	const LOWER_KEY = 'cf-match-lower';

	function readLower(): number {
		try {
			const v = Number(localStorage.getItem(LOWER_KEY));
			return v > 0 ? v : 190;
		} catch {
			return 190;
		}
	}

	const lowerH = ref(readLower());
	watch(lowerH, (h) => {
		try {
			localStorage.setItem(LOWER_KEY, String(h));
		} catch {
			/* storage unavailable */
		}
	});
	const rows = computed(() => `36px minmax(0, 1fr) 4px ${lowerH.value}px`);

	function startResize(e: PointerEvent): void {
		const startY = e.clientY;
		const start = lowerH.value;
		const el = e.currentTarget as HTMLElement;
		// Keep at least 120 px for the reference / render panes above.
		const max = Math.max(120, (el.parentElement?.clientHeight ?? 600) - 36 - 4 - 120);
		el.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => {
			lowerH.value = Math.round(Math.max(120, Math.min(max, start - (ev.clientY - startY))));
		};
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}

	/** Run the optimiser (a new one, or on from where it is); `resume` carries on a checkpointed press's limits. */
	async function run(resume?: RunLimitsSnapshot): Promise<void> {
		const engine = editor.engine;
		if (!engine || !reference.value || running.value) return;
		// The run optimises the copy it began with: edits made since aren't in it, so ask before resuming without them.
		if (!resume && optimizer.value && snapshot() !== runStart && snapshot() !== resumedWithout) {
			const choice = await editor.ask({
				title: 'The project has changed since this run began',
				detail:
					"The run optimises a copy of the project made when it began, so your edits aren't part of it. Start a new run from the edited project, or resume this one without them?",
				choices: [
					{ id: 'resume', label: 'Resume without edits' },
					{ id: 'restart', label: 'Start over from edits', primary: true }
				]
			});
			if (!choice || running.value) return;
			if (choice === 'restart') reset();
			else resumedWithout = snapshot();
		}
		running.value = true;
		runEditNoted = false;
		abort = false;
		// Tells other tabs this run is alive (they mustn't offer to resume its checkpoint).
		releaseLock ??= holdRunLock('match');
		let autosave: ReturnType<typeof autosaveRun> | null = null;
		let limits: RunLimits | null = null;
		if (refBlob) void checkpoints.putAsset('reference', { name: refName.value, blob: refBlob });
		// One matcher per optimiser (its evaluate scores with it): created with the optimiser, reused by later presses.
		if (!optimizer.value) {
			runMatcher?.dispose();
			runWrap = store.project.tileable;
			runMatcher = await makeMatcher(reference.value, runWrap);
		}
		const matcher = runMatcher!;
		engine.suspend();
		try {
			if (!optimizer.value) {
				runStart = snapshot();
				const opt = newOptimizer(JSON.parse(runStart) as Project, matcher);
				startLoss.value = await opt.init();
				optimizer.value = opt;
				curve.value = [startLoss.value];
				log.value = [`start · loss ${startLoss.value.toFixed(4)} · ${opt.space.entries.length} params`];
			}
			const opt = optimizer.value;
			// The panes follow the best while the run goes on.
			const showBest = () => {
				shownResult.value = (opt.best.detail as MetricResult) ?? null;
				show(renderImage(opt.best.project), matcher);
				showing.value = 'best';
			};
			if (showing.value !== 'best') showBest();
			// Every press runs afresh: up to Max steps more, a new time limit and stall count — so a run that stopped can
			// always keep going. A target loss already reached no longer stops it (it keeps improving past it).
			const stop: StopCriteria = {
				...(maxSteps.value > 0 ? { steps: maxSteps.value } : {}),
				...(targetLoss.value > 0 && opt.best.loss > targetLoss.value ? { targetLoss: targetLoss.value } : {}),
				...(timeLimit.value > 0 ? { timeMs: timeLimit.value * 1000 } : {}),
				...(stallSteps.value > 0 ? { patience: stallSteps.value } : {})
			};
			limits = resume ? RunLimits.restore(resume) : new RunLimits(stop, opt.best.loss);
			const lim = limits;
			stopped.value = null;
			autosave = autosaveRun(
				() => checkpointState(opt, lim),
				(cp) => void checkpoints.save(cp)
			);
			let reason = lim.check(opt.best.loss, opt.evaluations);
			while (!reason) {
				if (abort) {
					reason = 'aborted';
					break;
				}
				autosave.beforeStep();
				const info = await opt.step();
				lastInfo.value = info;
				curve.value = [...curve.value, info.bestLoss];
				if (info.improved) {
					showBest();
					const what = info.structural ?? info.changed.slice(0, 3).join(', ');
					log.value = [`#${info.step} ${info.bestLoss.toFixed(4)} ${what}`, ...log.value].slice(0, 40);
				} else if (info.opened) {
					log.value = [
						`#${info.step} opening ${info.stage === 1 ? 'tone (diffuse amounts, shaping, masks)' : 'colour (colours and ramps)'}`,
						...log.value
					].slice(0, 40);
				} else if (info.structural) {
					// Kept without beating the best (equal loss, or on a chain behind it): still worth seeing.
					log.value = [`#${info.step} ${info.parentLoss.toFixed(4)} ${info.structural} (kept)`, ...log.value].slice(
						0,
						40
					);
				}
				reason = lim.after(opt.best.loss, opt.evaluations);
				autosave.afterStep();
				await nextFrame();
			}
			stopped.value = reason;
			log.value = [
				`stopped · ${STOP_LABELS[reason]} · best ${opt.best.loss.toFixed(4)} · ${(lim.elapsed() / 1000).toFixed(0)} s`,
				...log.value
			].slice(0, 40);
		} catch (e) {
			editor.notify(`Optimiser stopped: ${e instanceof Error ? e.message : e}`, 'error');
		} finally {
			running.value = false;
			autosave?.stop();
			// Stopped with its best unapplied: kept for reopening (reset and Apply best have cleared it).
			const opt = optimizer.value;
			if (opt && limits) void checkpoints.save({ ...checkpointState(opt, limits), paused: true });
			// Reset mid-step: a save the step had pending may have landed after reset's clear.
			else if (!opt) void checkpoints.clear();
			// Reset during the run: its matcher goes with the optimiser, and the panes go back to the current project.
			if (!optimizer.value) {
				runMatcher?.dispose();
				runMatcher = null;
				if (showing.value === 'best') void view();
			}
			engine.resume(toRaw(store.project));
		}
	}

	/**
	 * The run's checkpoint, taken between steps (see autosaveRun) — cheap: it points at the optimiser's projects, which
	 * never change, and IndexedDB copies it when it is written.
	 */
	function checkpointState(opt: Optimizer, limits: RunLimits): CheckpointInput<MatchRunState> {
		const project = snapshot();
		const state: MatchRunState = {
			settings: settingsNow(),
			wrap: runWrap,
			runStart: runStart === project ? null : runStart,
			optimizer: opt.snapshot(),
			limits: limits.snapshot(),
			curve: [...curve.value],
			log: [...log.value],
			startLoss: startLoss.value,
			lastInfo: lastInfo.value
		};
		return { step: lastInfo.value?.step ?? 0, loss: curve.value.at(-1) ?? null, project, state };
	}

	/** Carry on a checkpointed run (ui/resumeRuns.ts has put its project back): reference, settings, optimiser, chart. */
	async function resumeRun(cp: Checkpoint<MatchRunState>): Promise<void> {
		const engine = editor.engine;
		if (!engine || running.value || busy.value || fitting.value) return;
		const s = cp.state;
		const fail = (why: string) => {
			editor.notify(`Couldn't resume the Match run: ${why}`, 'error');
			void checkpoints.clear();
		};
		const asset = await checkpoints.getAsset<{ name: string; blob: Blob }>('reference');
		if (!asset) return fail('its reference image is missing');
		let target: MatchImage;
		try {
			target = await decodeImage(asset.blob);
		} catch (e) {
			return fail(`its reference image can't be read (${e instanceof Error ? e.message : e})`);
		}
		reset();
		overlay.value = null;
		reference.value = target;
		refBlob = asset.blob;
		refName.value = asset.name;
		applySettings(s.settings);
		runWrap = s.wrap;
		runMatcher?.dispose();
		runMatcher = await makeMatcher(target, runWrap);
		const start = s.runStart ?? cp.project;
		let opt: Optimizer;
		engine.suspend();
		try {
			opt = newOptimizer(JSON.parse(start) as Project, runMatcher);
			// Makes the renders the parents carried again (colour fits read them).
			await opt.restore(s.optimizer);
		} catch (e) {
			return fail(e instanceof Error ? e.message : String(e));
		} finally {
			engine.resume(toRaw(store.project));
		}
		optimizer.value = opt;
		runStart = start;
		// Edits made during the run were never part of it: carry on without asking about them.
		if (snapshot() !== runStart) resumedWithout = snapshot();
		startLoss.value = s.startLoss;
		curve.value = s.curve;
		lastInfo.value = s.lastInfo;
		const step = s.lastInfo?.step ?? 0;
		if (cp.paused) {
			// It had stopped: back as it was, paused on its best; Run carries on, Apply best takes it.
			releaseLock ??= holdRunLock('match');
			log.value = [`reopened at step ${step}`, ...s.log].slice(0, 40);
			// reset() above cleared it: kept until the best is applied, like any stopped run.
			void checkpoints.putAsset('reference', { name: asset.name, blob: asset.blob });
			void checkpoints.save({ ...checkpointState(opt, RunLimits.restore(s.limits)), paused: true });
			shownResult.value = (opt.best.detail as MetricResult) ?? null;
			show(renderImage(opt.best.project), runMatcher);
			showing.value = 'best';
			editor.notify(`Reopened the Match run at step ${step}: its best isn't applied yet`);
			return;
		}
		log.value = [`resumed at step ${step}`, ...s.log].slice(0, 40);
		editor.notify(`Resuming the Match run at step ${step}`);
		await run(s.limits);
	}

	function onResumeEvent(e: Event): void {
		const d = (e as CustomEvent<ResumeRunEvent>).detail;
		if (d?.workspace === 'match') void resumeRun(d.checkpoint as Checkpoint<MatchRunState>);
	}

	// ---------------------------------------------------------------- suggest (templates)
	interface Card {
		id: string;
		label: string;
		project: Project;
		loss: number | null;
		px: { pixels: Uint8ClampedArray; width: number; height: number };
	}

	const overlay = ref<null | 'suggest'>(null);
	const cards = shallowRef<Card[]>([]);
	const busy = ref<string | null>(null);
	const palette = ref<'none' | 'quake' | 'doom'>('none');

	function withPalette(p: Project, on: boolean): Project {
		return { ...p, post: p.post.map((f) => (f.type === 'palette' ? { ...f, enabled: on } : f)) };
	}

	/**
	 * Every template built for the reference (colours from its palette, counts from its periods), colour-fitted, scored
	 * with the texture-aware metric and shown ranked — you pick the family.
	 */
	async function suggest(): Promise<void> {
		const engine = editor.engine;
		const ref = reference.value;
		if (!engine || !ref || busy.value) return;
		overlay.value = 'suggest';
		cards.value = [];
		engine.suspend();
		let matcher: Matcher | null = null;
		try {
			// At most 128 px on the long side: game textures are that size; a photo is matched at a texture's scale.
			const s = Math.min(1, 128 / Math.max(ref.width, ref.height));
			const target =
				s < 1 ? resample(ref, Math.max(1, Math.round(ref.width * s)), Math.max(1, Math.round(ref.height * s))) : ref;
			const analysis = analyzeTarget(target);
			matcher = await makeMatcher(target, analysis.tileable);
			const ctx = { palette: palette.value === 'none' ? '' : palette.value };
			const list = availableTemplates();
			for (const [i, t] of list.entries()) {
				if (overlay.value !== 'suggest') break;
				busy.value = `Trying ${t.label} (${i + 1}/${list.length})`;
				await nextFrame();
				const fit = await fitColours(withPalette(t.build(analysis, ctx), false), matcher!, (p) => renderImage(p));
				const project = withPalette(fit.project, true);
				cards.value = [
					...cards.value,
					{
						id: t.id,
						label: t.label,
						project,
						loss: fit.after,
						px: rgbaImage(renderImage(project))
					}
				].sort((a, b) => (a.loss ?? 0) - (b.loss ?? 0));
			}
		} catch (e) {
			editor.notify(`Suggest stopped: ${e instanceof Error ? e.message : e}`, 'error');
		} finally {
			matcher?.dispose();
			busy.value = null;
			engine.resume(toRaw(store.project));
		}
	}

	function pickCard(c: Card): void {
		store.load(c.project);
		reset();
		overlay.value = null;
		editor.notify(`Started from “${c.label}” — Optimise to refine (undo with Ctrl+Z)`);
		void view();
	}

	function closeOverlay(): void {
		overlay.value = null;
		// Edits made while it was open.
		if (snapshot() !== seen) void view();
	}

	function pause(): void {
		abort = true;
	}

	function reset(): void {
		abort = true;
		stopped.value = null;
		optimizer.value = null;
		// A run in progress still scores with it; the run disposes it when it ends.
		if (!running.value) {
			runMatcher?.dispose();
			runMatcher = null;
		}
		curve.value = [];
		log.value = [];
		lastInfo.value = null;
		startLoss.value = null;
		runStart = '';
		resumedWithout = '';
		// Nothing left to reopen.
		void checkpoints.clear();
		releaseLock?.();
		releaseLock = null;
		// The best is gone (a run in progress shows the current project when it stops).
		if (showing.value === 'best' && !running.value) void view();
	}

	/** A new metric: the run starts over, and the panes are rescored with it (the third pane may change kind too). */
	function metricChanged(): void {
		presetChosen = true;
		reset();
		if (reference.value && !running.value && showing.value === 'current') void view();
	}

	async function applyBest(): Promise<void> {
		const opt = optimizer.value;
		if (!opt) return;
		if (snapshot() !== runStart) {
			const choice = await editor.ask({
				title: 'Replace your edits?',
				detail:
					"You have edited the project since this optimised best was calculated. Applying it now will undo the edits you've made since. (You can always use Ctrl+Z to bring them back)",
				choices: [{ id: 'apply', label: 'Apply', primary: true }]
			});
			if (choice !== 'apply' || optimizer.value !== opt || running.value) return;
		}
		store.load(opt.best.project);
		editor.notify(`Applied best (loss ${opt.best.loss.toFixed(4)}) — undo with Ctrl+Z`);
		reset();
		void view();
	}

	// Edits show against the reference as you make them (the outliner and properties stay live beside Match), unless a
	// run, an overlay or another job holds the engine. A run optimises its own copy: Resume and Apply best ask about edits.
	// Watched only while the workspace is shown (it runs on every edit, and the workspace
	// is kept alive behind Create).
	let active = false;
	let viewTimer: ReturnType<typeof setTimeout> | null = null;
	let runEditNoted = false;
	let unwatch: WatchStopHandle | null = null;
	const watchEdits = () =>
		watch(
			() => store.edits,
			() => {
				if (!active || !reference.value) return;
				if (running.value) {
					if (!runEditNoted)
						editor.notify("Edits aren't part of the running optimisation — pause to see them against the reference");
					runEditNoted = true;
					return;
				}
				viewTimer ??= setTimeout(() => {
					viewTimer = null;
					if (active && !running.value && !busy.value && !fitting.value && !overlay.value && snapshot() !== seen)
						void view();
				}, 120);
			}
		);

	onMounted(() => {
		window.addEventListener('bismith:reference', onDropEvent);
		window.addEventListener('bismith:resume-run', onResumeEvent);
	});
	onBeforeUnmount(() => {
		abort = true;
		runMatcher?.dispose();
		runMatcher = null;
		releaseLock?.();
		releaseLock = null;
		freePaneMatcher();
		window.removeEventListener('bismith:reference', onDropEvent);
		window.removeEventListener('bismith:resume-run', onResumeEvent);
	});
	// Kept alive across workspace switches: the reference, settings and optimiser survive a visit to Create. Leaving pauses
	// a run (the viewport needs the engine) and frees the panes' matcher; coming back shows edits made meanwhile.
	onDeactivated(() => {
		active = false;
		abort = true;
		unwatch?.();
		unwatch = null;
		if (!viewing) freePaneMatcher();
	});
	onActivated(() => {
		active = true;
		unwatch ??= watchEdits();
		if (!reference.value || running.value) return;
		if (snapshot() !== seen) void view();
	});

	const improvement = computed(() => {
		const c = curve.value;
		return c.length > 1 && c[0] > 0 ? 1 - c[c.length - 1] / c[0] : null;
	});
	const bestLoss = computed(() =>
		curve.value.length ? curve.value[curve.value.length - 1] : (shownResult.value?.total ?? null)
	);
</script>

<template>
	<section class="match cf-panel" :style="{ gridTemplateRows: rows }">
		<div class="bar">
			<button type="button" class="cf-btn" @click="pickFile">
				<IconPhoto :size="13" />
				Load reference…
			</button>
			<span v-if="reference" class="cf-mono ref">{{ refName }} · {{ reference.width }}×{{ reference.height }}</span>
			<button
				v-if="reference"
				type="button"
				class="cf-btn"
				v-tip="'Resize the project to match the reference image (long side ≤ 512)'"
				@click="matchSize">
				Match size
			</button>
			<span class="grow" />
			<button
				type="button"
				class="cf-btn"
				:disabled="!reference || !editor.engine || running || !!busy"
				v-tip="'Build a set of starter templates in this reference image\'s colours — pick one to start from'"
				@click="suggest">
				<IconWand :size="13" />
				Suggest
			</button>
			<button
				type="button"
				class="cf-btn"
				:disabled="!reference || !editor.engine || running || !!busy || fitting"
				v-tip="'Fit the current project\'s colours to the reference image (undo with Ctrl+Z)'"
				@click="fitColoursNow">
				<IconPalette :size="13" />
				{{ fitting ? 'Fitting…' : 'Fit colours' }}
			</button>
			<button v-if="!running" type="button" class="fk primary" :disabled="!reference || !editor.engine" @click="run()">
				<span class="fk-face"
					><IconPlayerPlay :size="12" />{{
						optimizer ? (stopped && stopped !== 'aborted' ? 'Continue' : 'Resume') : 'Optimise'
					}}</span
				>
			</button>
			<button v-else type="button" class="cf-btn" @click="pause">
				<IconPlayerPause :size="12" />
				Pause
			</button>
			<button type="button" class="cf-btn" :disabled="!optimizer || running" @click="applyBest">Apply best</button>
			<button type="button" class="cf-btn" :disabled="running" title="Forget the optimiser state" @click="reset">
				Reset
			</button>
		</div>

		<div v-if="overlay" class="overlay">
			<div class="ohead">
				<span class="cf-label">Start from a template</span>
				<span class="lo">{{
					busy ?? 'Ranked by the metric (colours fitted). Click one that looks good to start from it.'
				}}</span>
				<span class="grow" />
				<span class="lo">Palette</span>
				<SelectField
					v-model="palette"
					:options="[
						{ value: 'none', label: 'None' },
						{ value: 'quake', label: 'Quake' },
						{ value: 'doom', label: 'Doom' }
					]"
					label="Palette snap" />
				<button type="button" class="cf-ico-btn" aria-label="Close" @click="closeOverlay">
					<IconX :size="13" />
				</button>
			</div>
			<div class="cards">
				<button v-for="c in cards" :key="c.id" type="button" class="card" :title="c.label" @click="pickCard(c)">
					<ImageCanvas :pixels="c.px.pixels" :width="c.px.width" :height="c.px.height" :label="c.label" pickable />
					<span class="clabel">{{ c.label }}</span>
					<span v-if="c.loss !== null" class="closs cf-mono">{{ c.loss.toFixed(3) }}</span>
				</button>
			</div>
		</div>

		<div v-else class="panes">
			<figure>
				<figcaption class="cf-label">Reference</figcaption>
				<ImageCanvas
					:pixels="refPx?.pixels ?? null"
					:width="refPx?.width ?? 1"
					:height="refPx?.height ?? 1"
					label="Reference image"
					pickable>
					<h3>Match an existing texture</h3>
					<p>
						Use the Match workspace to copy a texture you already have, such as a photo or a texture from a game. The
						optimiser will adjust your project's settings until it looks like that image (or as close as it can get).
					</p>
					<p>To start, load the image with <b>Load reference…</b>, or drop an image file onto this pane.</p>
					<p>Then choose which metric to judge the image match with and click <b>Optimise</b></p>
					<ul>
						<li>
							<b>Texture</b> compares overall statistics of the images: colour, frequency and edges. Where things are
							placed doesn't matter.
						</li>
						<li>
							<b>Windows</b> compares local patches of the images, looking at finer texture instead of broader
							structure.
						</li>
						<li>
							<b>Tile</b> compares the structure of the images, allowing one image to be shifted against the other in x
							or y.
						</li>
						<li><b>Tile + windows</b> combines the two.</li>
						<li>
							<b>Layout</b> also compares where things are, pixel by pixel. This is best for images where layout
							matters, like UI elements or specific artwork.
						</li>
					</ul>
				</ImageCanvas>
			</figure>
			<figure>
				<figcaption class="cf-label cap">
					<span v-if="!optimizer || running">{{ running ? 'Best so far' : 'Current project' }}</span>
					<span v-else class="pick" role="radiogroup" aria-label="Show">
						<button
							type="button"
							class="cf-toggle"
							:class="{ on: showing === 'current' }"
							role="radio"
							:aria-checked="showing === 'current'"
							title="The project as it is now, with your edits"
							@click="view('current')">
							Current
						</button>
						<button
							type="button"
							class="cf-toggle"
							:class="{ on: showing === 'best' }"
							role="radio"
							:aria-checked="showing === 'best'"
							title="The optimiser's best (Apply best to take it)"
							@click="view('best')">
							Best so far
						</button>
					</span>
					<span v-if="shownResult" class="loss cf-mono" title="Loss of the image shown">{{
						shownResult.total.toFixed(4)
					}}</span>
				</figcaption>
				<ImageCanvas
					:pixels="renderPx?.pixels ?? null"
					:width="renderPx?.width ?? 1"
					:height="renderPx?.height ?? 1"
					label="Rendered candidate"
					pickable>
					<h3>Your project's render</h3>
					<p>
						Once a reference is loaded, your project is rendered here at the reference's size, so you can compare the
						two side by side.
					</p>
					<p>
						Once you have loaded a reference and clicked <b>Optimise</b>, this pane shows the best result found so far.
					</p>
				</ImageCanvas>
			</figure>
			<figure>
				<figcaption
					class="cf-label"
					v-tip="
						diffMode === 'windows'
							? 'Shows where your texture is least like anything in the reference: dim = well matched, red → yellow = patches of your render that have no close match anywhere'
							: 'Shows where your texture is least like anything in the reference: Brighter areas are more different from eachother'
					">
					{{ diffMode === 'windows' ? 'Window mismatch' : 'Difference ×3' }}
				</figcaption>
				<ImageCanvas
					:pixels="diffPx?.pixels ?? null"
					:width="diffPx?.width ?? 1"
					:height="diffPx?.height ?? 1"
					:label="diffMode === 'windows' ? 'Window mismatch' : 'Absolute difference'">
					<h3>Difference</h3>
					<p>Shows where your render and the reference differ. Brighter areas differ more.</p>
					<p>
						With a Windows metric it shows the patches of your render that have no close match anywhere in the
						reference.
					</p>
				</ImageCanvas>
			</figure>
		</div>

		<div
			class="gutter"
			role="separator"
			aria-orientation="horizontal"
			aria-label="Resize settings panel"
			@pointerdown="startResize" />

		<div class="lower">
			<div class="settings">
				<div class="row">
					<span v-tip:right="TIPS.metric" class="lbl">Metric</span>
					<SelectField
						v-model="preset"
						:options="PRESET_OPTIONS"
						label="Metric preset"
						@update:model-value="metricChanged" />
				</div>
				<div v-if="preset === 'windows' || preset === 'tilewin' || preset === 'tilemotif'" class="row">
					<span v-tip:right="TIPS.window" class="lbl">Window</span>
					<SelectField
						v-model="windowDiv"
						:options="WINDOW_OPTIONS"
						label="Window size"
						@update:model-value="metricChanged" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.colours" class="lbl">Colours</span>
					<SelectField
						v-model="colourRangeSel"
						:options="COLOUR_RANGE_OPTIONS"
						label="Colour range"
						@update:model-value="reset" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.samples" class="lbl">Samples</span>
					<NumberField
						v-model="samples"
						:min="1"
						:max="256"
						:soft-min="1"
						:soft-max="64"
						int
						label="Samples per candidate" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.maxSteps" class="lbl">Max steps</span>
					<NumberField
						v-model="maxSteps"
						:min="0"
						:max="1000000"
						:soft-min="0"
						:soft-max="2000"
						int
						label="Max steps" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.stopAtLoss" class="lbl">Stop at loss</span>
					<NumberField v-model="targetLoss" :min="0" :max="2" :soft-max="0.6" :step="0.001" label="Target loss" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.timeLimit" class="lbl">Time limit</span>
					<NumberField
						v-model="timeLimit"
						:min="0"
						:max="86400"
						:soft-max="1800"
						:step="1"
						unit="s"
						int
						label="Time limit" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.stallAfter" class="lbl">Stall after</span>
					<NumberField
						v-model="stallSteps"
						:min="0"
						:max="100000"
						:soft-max="400"
						int
						unit="steps"
						label="Stall after" />
				</div>
				<div class="row">
					<span v-tip:right="TIPS.tune" class="lbl">Tune</span>
					<div class="checks">
						<CheckField v-model="space.layers" label="Layers" @update:model-value="reset" />
						<CheckField v-model="space.base" label="Base" @update:model-value="reset" />
						<CheckField
							v-model="space.shading"
							label="Shading"
							title="Ambient occlusion strength and radius, specular scale and tint, height depth"
							@update:model-value="reset" />
						<CheckField v-model="space.lights" label="Lights" @update:model-value="reset" />
						<CheckField v-model="space.post" label="Post" @update:model-value="reset" />
						<CheckField v-model="space.enums" label="Modes" @update:model-value="reset" />
						<CheckField v-model="space.seeds" label="Seeds" @update:model-value="reset" />
						<CheckField v-model="structural" label="Add/remove layers" @update:model-value="reset" />
					</div>
				</div>
				<p class="hint">{{ entryCount }} parameters in play. Lock layers in the outliner to keep them fixed.</p>
			</div>

			<div class="progress">
				<div class="stats cf-mono">
					<span
						>step <b>{{ lastInfo?.step ?? 0 }}</b></span
					>
					<span
						>evals <b>{{ optimizer?.evaluations ?? 0 }}</b></span
					>
					<span
						>best <b>{{ bestLoss !== null ? bestLoss.toFixed(4) : '—' }}</b></span
					>
					<span v-if="improvement !== null"
						>gain <b>{{ (improvement * 100).toFixed(1) }}%</b></span
					>
					<span v-if="lastInfo"
						>σ <b>{{ lastInfo.meanSigma.toFixed(3) }}</b></span
					>
					<span v-if="stopped && !running">{{ STOP_LABELS[stopped] }}</span>
				</div>
				<LossChart :values="curve" />
			</div>

			<div class="terms">
				<div v-for="t in TERM_NAMES" :key="t" class="term">
					<span class="tl">{{ TERM_SHORT[t] ?? t }}</span>
					<div class="tb">
						<div
							:style="{
								width: `${Math.min(100, (shownResult?.terms[t] ?? 0) * 100)}%`,
								opacity: shownResult?.weights[t] ? 1 : 0.3
							}" />
					</div>
					<span class="tv cf-mono">{{ shownResult ? shownResult.terms[t].toFixed(3) : '—' }}</span>
				</div>
				<div class="log cf-mono">
					<div v-for="(l, i) in log" :key="i">{{ l }}</div>
				</div>
			</div>
		</div>
	</section>
</template>

<style scoped>
	.overlay {
		display: grid;
		grid-template-rows: 34px minmax(0, 1fr);
		min-height: 0;
		padding: 0 6px 6px;
	}

	.ohead {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
	}

	.ohead .lo {
		color: var(--text-lo);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 8px;
		overflow-y: auto;
		min-height: 0;
		align-content: start;
	}

	.card {
		display: grid;
		grid-template-rows: minmax(0, 1fr) auto;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 2px 6px;
		padding: 4px;
		background: var(--sunken);
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		cursor: pointer;
		min-height: 150px;
		text-align: left;
	}

	.card:hover {
		border-color: var(--accent);
	}

	.card :deep(canvas),
	.card > :first-child {
		grid-column: 1 / -1;
		min-height: 0;
	}

	.clabel {
		font-size: 11px;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.closs {
		font-size: 11px;
		color: var(--text-lo);
	}

	.match {
		display: grid;
		overflow: hidden;
	}

	.gutter {
		cursor: row-resize;
		touch-action: none;
	}

	.gutter:hover {
		background: linear-gradient(180deg, transparent 1px, var(--line) 1px, var(--line) 2px, transparent 2px);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 8px;
		border-bottom: 1px solid var(--hairline);
	}

	.ref {
		font-size: 12px;
		color: var(--text-lo);
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

	.cap .loss {
		margin-left: 4px;
		letter-spacing: 0;
		color: var(--text-mid);
	}

	.lower {
		display: grid;
		grid-template-columns: 300px minmax(0, 1fr) 280px;
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
		/* Rows keep their content height (wrapped checkboxes included) and the column scrolls, instead of rows being
		 squashed to their min-height and overlapping the next. */
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

	.checks {
		display: flex;
		flex-wrap: wrap;
		gap: 0 12px;
	}

	.hint {
		margin: 4px 0 0 78px;
		font-size: 11px;
		color: var(--text-lo);
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
		grid-template-columns: 82px minmax(0, 1fr) 44px;
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
