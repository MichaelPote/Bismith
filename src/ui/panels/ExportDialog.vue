<script lang="ts">
	import type { MapKind } from '@/render/export';

	/** The maps ticked last time, kept for the session. */
	const lastMaps = new Set<string>(['final']);
	let lastNormal: MapKind = 'normal-gl';
</script>

<script setup lang="ts">
	// The Export dialog (docs/features/fr10-variants.md): the variants to export (only with more than one), the maps,
	// and the project's export settings, read-only. One file downloads as a PNG; more as a zip with the project file.
	import { computed, ref } from 'vue';
	import { IconDownload } from '@tabler/icons-vue';
	import DialogFrame from '@/ui/components/DialogFrame.vue';
	import { useEditorStore } from '@/stores/editor';
	import { useProjectStore } from '@/stores/project';
	import { useActions } from '@/ui/actions';
	import { useVariantThumbs } from '@/ui/variantThumbs';

	const store = useProjectStore();
	const editor = useEditorStore();
	const act = useActions();
	const thumbs = useVariantThumbs();

	const list = computed(() => store.variants.list);
	const several = computed(() => list.value.length > 1);

	// ---------------------------------------------------------------- variants
	const ticked = ref(
		new Set<string>(
			(editor.exportDialog?.variants ?? [store.variants.activeId]).filter((id) => list.value.some((v) => v.id === id))
		)
	);
	const chosen = computed(() => (several.value ? list.value.filter((v) => ticked.value.has(v.id)) : list.value));
	function toggleVariant(id: string): void {
		const next = new Set(ticked.value);
		if (!next.delete(id)) next.add(id);
		ticked.value = next;
	}
	const allVariants = computed(() => chosen.value.length === list.value.length);
	function toggleAllVariants(): void {
		ticked.value = new Set(allVariants.value ? [] : list.value.map((v) => v.id));
	}

	// ---------------------------------------------------------------- maps
	/** In the File menu's order, Normal last: its OpenGL / DirectX choice opens under it. */
	const MAPS: { id: string; label: string; note?: string }[] = [
		{ id: 'final', label: 'Final render' },
		{ id: 'diffuse', label: 'Diffuse', note: '+ alpha' },
		{ id: 'height', label: 'Height', note: 'normalised' },
		{ id: 'roughness', label: 'Roughness' },
		{ id: 'specular', label: 'Specular' },
		{ id: 'metalness', label: 'Metalness' },
		{ id: 'ao', label: 'Ambient occlusion' },
		{ id: 'emissive', label: 'Emissive' },
		{ id: 'opacity', label: 'Opacity' },
		{ id: 'normal', label: 'Normal' }
	];
	const maps = ref(new Set(lastMaps));
	const normal = ref<MapKind>(lastNormal);
	function toggleMap(id: string): void {
		const next = new Set(maps.value);
		if (!next.delete(id)) next.add(id);
		maps.value = next;
	}
	const allMaps = computed(() => maps.value.size === MAPS.length);
	function toggleAllMaps(): void {
		maps.value = new Set(allMaps.value ? [] : MAPS.map((m) => m.id));
	}
	const kinds = computed<MapKind[]>(() =>
		MAPS.filter((m) => maps.value.has(m.id)).map((m) => (m.id === 'normal' ? normal.value : (m.id as MapKind)))
	);

	// ---------------------------------------------------------------- settings, output
	const r = computed(() => store.project.render);
	const settings = computed(() => [
		{ label: 'Output size', value: `${store.project.width} × ${store.project.height} px` },
		{ label: 'Supersample', value: `${Math.max(r.value.supersample ?? 1, r.value.exportSupersample)}×` },
		{ label: 'Samples', value: String(Math.max(r.value.maxSamples, r.value.exportSamples)) }
	]);
	function changeSettings(): void {
		close();
		editor.select('project');
	}

	const count = computed(() => chosen.value.length * kinds.value.length);
	const summary = computed(() => {
		if (!count.value) return 'Nothing to export';
		const v = chosen.value.length;
		const m = kinds.value.length;
		const n = count.value;
		return several.value
			? `${v} variant${v === 1 ? '' : 's'} × ${m} map${m === 1 ? '' : 's'} = ${n} PNG${n === 1 ? '' : 's'}`
			: `${n} PNG${n === 1 ? '' : 's'}`;
	});

	async function download(): Promise<void> {
		if (!count.value) return;
		lastMaps.clear();
		for (const m of maps.value) lastMaps.add(m);
		lastNormal = normal.value;
		const ids = chosen.value.map((v) => v.id);
		const ks = kinds.value;
		close();
		await act.exportVariants(ids, ks);
	}

	function close(): void {
		editor.exportDialog = null;
	}
</script>

<template>
	<DialogFrame
		title="Export"
		:meta="`${store.project.name} · ${store.project.width}×${store.project.height}`"
		:width="several ? '760px' : '520px'"
		@close="close">
		<div class="body">
			<div v-if="several" class="variants plate-well">
				<div class="sub">
					<span class="cf-label">Variants</span>
					<span class="n cf-mono">{{ chosen.length }} / {{ list.length }}</span>
					<span class="grow" />
					<button type="button" class="link" @click="toggleAllVariants">{{ allVariants ? 'None' : 'All' }}</button>
				</div>
				<label v-for="v in list" :key="v.id" class="pick">
					<input type="checkbox" :checked="ticked.has(v.id)" @change="toggleVariant(v.id)" />
					<img v-if="thumbs.crop(v.id)" class="thumb" :src="thumbs.crop(v.id)" alt="" />
					<span v-else class="thumb" />
					<span class="vname">{{ v.name }}</span>
					<span v-if="v.id === store.variants.activeId" class="cur" aria-label="Shown now" />
				</label>
			</div>

			<div class="main">
				<div class="sub">
					<span class="cf-label">Maps</span>
					<span class="n cf-mono">{{ kinds.length }} of {{ MAPS.length }}</span>
					<span class="grow" />
					<button type="button" class="link" @click="toggleAllMaps">{{ allMaps ? 'None' : 'All' }}</button>
				</div>
				<div class="maps">
					<div v-for="m in MAPS" :key="m.id" class="map">
						<label class="pick">
							<input type="checkbox" :checked="maps.has(m.id)" @change="toggleMap(m.id)" />
							<span>{{ m.label }}</span>
							<span v-if="m.note" class="note cf-mono">{{ m.note }}</span>
						</label>
						<div
							v-if="m.id === 'normal' && maps.has('normal')"
							class="convention"
							role="radiogroup"
							aria-label="Normal map convention">
							<button
								v-for="c in [
									{ id: 'normal-gl', label: 'OpenGL Y+' },
									{ id: 'normal-dx', label: 'DirectX Y−' }
								] as const"
								:key="c.id"
								type="button"
								role="radio"
								class="fk"
								:class="{ lit: normal === c.id }"
								:aria-checked="normal === c.id"
								@click="normal = c.id">
								<span class="fk-face">{{ c.label }}</span>
							</button>
						</div>
					</div>
				</div>

				<div class="sub">
					<span class="cf-label">Project export settings</span>
					<span class="grow" />
					<button type="button" class="link" @click="changeSettings">Change…</button>
				</div>
				<div class="settings plate-well">
					<div v-for="s in settings" :key="s.label" class="setting">
						<span>{{ s.label }}</span>
						<span class="cf-mono">{{ s.value }}</span>
					</div>
				</div>
			</div>
		</div>

		<template #tray>
			<span>{{ summary }}</span>
			<span class="grow" />
			<button type="button" class="gk" @click="close"><span class="gk-face">Cancel</span></button>
			<button type="button" class="gk primary" :disabled="!count" @click="download">
				<span class="gk-face"><IconDownload :size="13" />{{ count > 1 ? 'Download zip' : 'Download PNG' }}</span>
			</button>
		</template>
	</DialogFrame>
</template>

<style scoped>
	.grow {
		flex: 1;
	}
	.body {
		display: flex;
		gap: 16px;
		min-height: 0;
		overflow: auto;
		padding: 2px 16px 16px;
	}
	.variants {
		flex: none;
		width: 236px;
		display: flex;
		flex-direction: column;
		padding: 4px 0 8px;
		overflow-y: auto;
	}
	.main {
		flex: 1;
		min-width: 0;
	}
	.sub {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 12px;
	}
	.main .sub {
		padding: 0;
		margin-top: 6px;
	}
	.n {
		font-size: 11px;
		color: var(--readout);
	}
	.link {
		border: 0;
		background: transparent;
		padding: 0;
		color: var(--e400);
		font-size: 11px;
		cursor: pointer;
	}
	.link:hover {
		color: var(--accent-hi);
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 9px;
		min-height: 30px;
		padding: 0 12px;
		color: var(--text-mid);
		font-size: 13px;
		cursor: pointer;
	}
	.pick:hover {
		background: var(--raised);
	}
	.pick input {
		margin: 0;
		accent-color: var(--accent);
	}
	.pick:has(input:checked) {
		color: var(--text-hi);
	}
	.thumb {
		width: 40px;
		height: 24px;
		flex: none;
		/* The Variants panel's crop at 50% zoom (variantThumbs.ts). */
		border-radius: 2px;
		background: var(--sunken);
		box-shadow: 0 0 0 1px var(--hairline);
	}
	.vname {
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cur {
		margin-left: auto;
		width: 6px;
		height: 6px;
		flex: none;
		border-radius: 50%;
		background: var(--e400);
	}
	.maps {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 2px 12px;
	}
	.maps .pick {
		padding: 0 8px;
		border-radius: 3px;
	}
	.note {
		margin-left: auto;
		font-size: 11px;
		color: var(--text-lo);
	}
	.convention {
		display: flex;
		gap: 3px;
		padding: 2px 0 4px 31px;
	}
	.convention .fk {
		height: 24px;
	}
	.convention .fk-face {
		padding: 0 8px;
		font-size: 11px;
	}
	.settings {
		display: flex;
		flex-direction: column;
		padding: 4px 0;
	}
	.setting {
		display: flex;
		align-items: center;
		height: 24px;
		padding: 0 8px;
		font-size: 12px;
		color: var(--text-mid);
	}
	.setting .cf-mono {
		margin-left: auto;
		color: var(--readout);
	}
</style>
