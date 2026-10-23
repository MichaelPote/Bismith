<script setup lang="ts">
	// Tiling (docs/features/fr9-tiling-workspace.md): see what gives the repeat away in a 3 × 3 tiling, which layer is to
	// blame, and let the fix search reseed and nudge those layers — tiling score down, look held — then keep or discard.
	import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, shallowRef, toRaw, watch } from 'vue';
	import type { Project } from '@/core/project';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore } from '@/stores/editor';
	import { toOklab, toRgba8, heatOverlay, type MatchImage } from '@/match/image';
	import { renderToMatchImage } from '@/match/evaluate';
	import { TILING_TERMS, analyzeTiling, type TilingAnalysis, type TilingTerm } from '@/tiling/analyze';
	import { attributeTiling, type TilingAttribution } from '@/tiling/attribute';
	import { fixTiling, type FixCandidate, type FixResult } from '@/tiling/fix';
	import { tilingEvaluator } from '@/tiling/evaluate';
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

	interface Shot {
		image: MatchImage;
		analysis: TilingAnalysis;
	}
	/** The project as it is (or was when the run began) and the best candidate of the run. */
	const current = shallowRef<Shot | null>(null);
	const best = shallowRef<(Shot & { candidate: FixCandidate }) | null>(null);
	const result = shallowRef<FixResult | null>(null);
	const attribution = shallowRef<TilingAttribution | null>(null);
	const hotspotOf = ref<'current' | 'fixed'>('current');
	const curve = ref<number[]>([]);
	const evaluations = ref(0);
	const progress = ref('');
	const log = ref<string[]>([]);

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
	const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

	type Px = { pixels: Uint8ClampedArray; width: number; height: number };
	/** An image repeated 3 × 3. */
	function tiled(img: MatchImage): Px {
		const src = toRgba8(img);
		const W = img.width * 3;
		const H = img.height * 3;
		const out = new Uint8ClampedArray(W * H * 4);
		for (let y = 0; y < H; y++) {
			const row = (y % img.height) * img.width * 4;
			for (let k = 0; k < 3; k++) out.set(src.subarray(row, row + img.width * 4), (y * W + k * img.width) * 4);
		}
		return { pixels: out, width: W, height: H };
	}
	const overlayOf = (s: Shot) =>
		heatOverlay(toOklab(s.image).L, s.analysis.maps.hotspot, s.image.width, s.image.height);

	const currentPx = computed(() => (current.value ? tiled(current.value.image) : null));
	const fixedPx = computed(() => (best.value ? tiled(best.value.image) : null));
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
		try {
			seen = snapshot();
			const image = renderToMatchImage(engine, toRaw(store.project), samples.value);
			current.value = { image, analysis: analyzeTiling(image) };
			progress.value = '';
		} catch (e) {
			progress.value = '';
			editor.notify(`Tiling analysis failed: ${e instanceof Error ? e.message : e}`, 'error');
		} finally {
			analysing = false;
			engine.resume(toRaw(store.project));
		}
	}

	// ---------------------------------------------------------------- the run
	class Stopped extends Error {}

	async function run(): Promise<void> {
		const engine = editor.engine;
		if (!engine || running.value) return;
		if (phase.value === 'done') discard();
		abort = false;
		phase.value = 'finding';
		curve.value = [];
		evaluations.value = 0;
		log.value = [];
		best.value = null;
		result.value = null;
		attribution.value = null;
		runStart = snapshot();
		const project = JSON.parse(runStart) as Project;
		await nextFrame();
		engine.suspend();
		let ev: Awaited<ReturnType<typeof tilingEvaluator>> | null = null;
		try {
			// Which layers give the repeat away: each left out in turn.
			let original: MatchImage | null = null;
			const a = await attributeTiling(
				project,
				async (q) => {
					if (abort) throw new Stopped();
					await nextFrame();
					const img = renderToMatchImage(engine, q, samples.value);
					if (q === project) {
						original = img;
						current.value = { image: img, analysis: analyzeTiling(img) };
					}
					return img;
				},
				{ onProgress: (done, total) => (progress.value = `Finding the culprits · layer ${done}/${total}`) }
			);
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
			ev = await tilingEvaluator(engine, original!, { samples: samples.value, yieldBefore: nextFrame });
			const evaluator = ev;
			const s = stepSize.value;
			const r = await fixTiling(project, a, (q) => evaluator.evaluate(q), {
				seeds: seeds.value,
				culprits: culprits.value,
				steps: [-s, -0.4 * s, 0.4 * s, s],
				driftWeight: holdLook.value,
				minGain: minGain.value,
				scale: allowScale.value,
				shouldStop: () => abort,
				onEvaluate: (n, c, kept) => {
					evaluations.value = n;
					curve.value = [...curve.value, kept.loss];
					// The pane shows the lowest loss seen so far (the search keeps it once its round ends).
					const shownLoss = best.value?.candidate.loss ?? kept.loss;
					const last = evaluator.last;
					if (last && last.project === c.project && c.loss < Math.min(shownLoss, kept.loss))
						best.value = { image: last.image, analysis: last.analysis, candidate: c };
					progress.value = `Fixing · ${n} candidates · best ${(best.value?.candidate.score ?? kept.score).toFixed(3)}`;
				}
			});
			result.value = r;
			// The live pane follows every better candidate, also ones the search then didn't keep (gain below Min gain).
			const shownBest = best.value as (Shot & { candidate: FixCandidate }) | null;
			if (r.after.project === r.before.project) best.value = null;
			else if (shownBest?.candidate.project !== r.after.project) {
				const image = evaluator.render(r.after.project);
				best.value = { image, analysis: analyzeTiling(image), candidate: r.after };
			}
			log.value = [
				...log.value,
				...(r.changes.length
					? r.changes.map((c) => `${c.name}: ${c.key} ${String(c.from)} → ${String(c.to)}`)
					: ['no change helped']),
				`${abort ? 'stopped' : 'done'} · ${r.evaluations} candidates · score ${r.before.score.toFixed(3)} → ${r.after.score.toFixed(3)}`
			];
			phase.value = 'done';
			hotspotOf.value = r.changes.length ? 'fixed' : 'current';
		} catch (e) {
			if (!(e instanceof Stopped)) editor.notify(`Tiling fix failed: ${e instanceof Error ? e.message : e}`, 'error');
			phase.value = 'idle';
		} finally {
			ev?.dispose();
			progress.value = '';
			engine.resume(toRaw(store.project));
		}
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
					"The fix was made on the project as it was when the run began, so keeping it undoes the edits you've made since. Ctrl+Z brings them back.",
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
		phase.value = 'idle';
		best.value = null;
		result.value = null;
		attribution.value = null;
		curve.value = [];
		evaluations.value = 0;
		hotspotOf.value = 'current';
	}

	// Edits made beside the workspace (outliner, properties) are analysed as you make them, unless a run or its result
	// holds the panes.
	let active = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	watch(
		() => store.project,
		() => {
			if (!active || running.value || phase.value === 'done') return;
			timer ??= setTimeout(() => {
				timer = null;
				if (active && snapshot() !== seen) void analyseCurrent();
			}, 300);
		},
		{ deep: true }
	);
	onActivated(() => {
		active = true;
		if (!running.value && phase.value !== 'done' && snapshot() !== seen) void analyseCurrent();
	});
	// Leaving stops a run (the viewport needs the engine); its best so far stays to keep or discard.
	onDeactivated(() => {
		active = false;
		abort = true;
	});
	onBeforeUnmount(() => {
		abort = true;
		if (timer) clearTimeout(timer);
	});

	const shown = computed(() =>
		hotspotOf.value === 'fixed' && best.value ? best.value.analysis : current.value?.analysis
	);
	const fixedTerms = computed(() => best.value?.analysis.terms ?? null);
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
			<span class="lo">{{
				progress ||
				(phase === 'done'
					? result?.changes.length
						? 'Keep the fix, or discard it'
						: 'Nothing the search tried tiled better'
					: 'What gives the repeat away, which layer draws it, and a fix that keeps the look')
			}}</span>
			<span class="grow" />
			<button
				type="button"
				class="cf-btn"
				:disabled="!editor.engine || running"
				title="Analyse the current project again"
				@click="analyseCurrent">
				<IconScan :size="13" />
				Analyse
			</button>
			<button v-if="!running" type="button" class="fk primary" :disabled="!editor.engine" @click="run">
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
					<span v-if="current" class="score cf-mono" title="Tiling score: 0 = repeat invisible … 1">{{
						current.analysis.score.toFixed(3)
					}}</span>
				</figcaption>
				<ImageCanvas
					:pixels="currentPx?.pixels ?? null"
					:width="currentPx?.width ?? 1"
					:height="currentPx?.height ?? 1"
					label="Current project tiled 3 by 3"
					pickable>
					The project tiled 3 × 3 appears here.
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
					label="Fixed project tiled 3 by 3"
					pickable>
					Run the fix: it finds the layers that give the repeat away, reseeds them and nudges their pattern, keeping
					whatever tiles better without changing the material.
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
					label="Where the repeat draws the eye" />
			</figure>
		</div>

		<div class="lower">
			<div class="settings">
				<div class="row" title="New seeds tried for each culprit layer (pattern copies are reseeded together)">
					<span class="lbl">Seeds</span>
					<NumberField v-model="seeds" :min="0" :max="200" :soft-min="4" :soft-max="64" int label="Seeds per layer" />
				</div>
				<div class="row" title="How many of the blamed layers to fix, most to blame first">
					<span class="lbl">Layers</span>
					<NumberField v-model="culprits" :min="1" :max="8" :soft-max="4" int label="Layers to fix" />
				</div>
				<div
					class="row"
					title="How far each pattern param is nudged, as a share of its slider range (also tried at 40 % of it)">
					<span class="lbl">Nudge</span>
					<NumberField v-model="stepSize" :min="0" :max="0.5" :soft-max="0.3" :step="0.01" label="Nudge size" />
				</div>
				<div
					class="row"
					title="How hard the look is held: the cost of drifting further than a reseed alone would (0 = anything goes)">
					<span class="lbl">Hold look</span>
					<NumberField v-model="holdLook" :min="0" :max="20" :soft-max="8" :step="0.1" label="Hold the look" />
				</div>
				<div
					class="row"
					title="How much a change has to improve the score to be kept — smaller gains are noise, and every change moves the look">
					<span class="lbl">Min gain</span>
					<NumberField v-model="minGain" :min="0" :max="0.2" :soft-max="0.05" :step="0.001" label="Minimum gain" />
				</div>
				<div class="row" title="Path-traced samples per candidate render">
					<span class="lbl">Samples</span>
					<NumberField v-model="samples" :min="1" :max="256" :soft-max="64" int label="Samples per candidate" />
				</div>
				<div
					class="row"
					title="Let the fix change sizes and cells across too. A smaller pattern hides the repeat, but it's a different material">
					<span class="lbl">Scale</span>
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
