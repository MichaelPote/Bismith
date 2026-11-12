<script setup lang="ts">
	// The Variants workspace (docs/features/fr10-variants.md): every variant of the project side by side — its render,
	// name, change count and note. Click a card to show that variant, double-click (or its pen) to edit it in Create,
	// drag to reorder, tick several to delete them. The right-click menu is the Variants panel's.
	import { computed, ref, watch } from 'vue';
	import { IconCopy, IconDots, IconPencil, IconTrash } from '@tabler/icons-vue';
	import { hashText } from '@/core/hash';
	import type { ProjectVariant } from '@/core/variants';
	import { mapPixels } from '@/render/export';
	import { encodePreview, PROJECT_PREVIEW } from '@/render/preview';
	import { useEditorStore } from '@/stores/editor';
	import { useProjectStore } from '@/stores/project';
	import DropMenu, { type MenuItem } from '@/ui/components/DropMenu.vue';
	import AnchoredAsk from '@/ui/components/AnchoredAsk.vue';
	import { useVariantThumbs } from '@/ui/variantThumbs';
	import {
		changeCount as count,
		deleteVariantQuestion,
		useAnchoredAsk,
		useVariantList,
		variantMenuItems
	} from '@/ui/variantMenu';
	import { vTip } from '@/ui/tooltip';

	const store = useProjectStore();
	const editor = useEditorStore();
	const thumbs = useVariantThumbs();

	const { list, baseId, activeId } = useVariantList();

	// ---------------------------------------------------------------- what the cards show
	type View = 'final' | 'diffuse' | 'height';
	const VIEWS: { id: View; label: string }[] = [
		{ id: 'final', label: 'Final' },
		{ id: 'diffuse', label: 'Diffuse' },
		{ id: 'height', label: 'Height' }
	];
	const view = ref<View>('final');
	/** Diffuse and Height maps, by `${id}:${view}`: the render's hash and the image. */
	const maps = ref(new Map<string, { hash: string; url: string }>());
	let mapsTimer: ReturnType<typeof setTimeout> | null = null;
	let rendering = false;

	async function renderMaps(): Promise<void> {
		const engine = editor.engine;
		const kind = view.value;
		if (kind === 'final' || !engine || rendering) return;
		rendering = true;
		try {
			for (const v of list.value) {
				const project = store.variantProject(v.id);
				const hash = hashText(JSON.stringify(project));
				const key = `${v.id}:${kind}`;
				if (maps.value.get(key)?.hash === hash) continue;
				const img = await engine.renderExport({ samples: 0, supersample: 1, project }, () => mapPixels(engine, kind));
				if (!img || view.value !== kind) break;
				const url = encodePreview(img.pixels, img.width, img.height, PROJECT_PREVIEW);
				if (url) maps.value = new Map(maps.value).set(key, { hash, url });
			}
		} catch (e) {
			console.warn('[bismith] variant maps failed', e);
		} finally {
			rendering = false;
		}
	}
	// (After edits settle — the store's revision — rather than a deep watch over the project on every change.)
	watch([view, () => store.revision], () => {
		if (mapsTimer) clearTimeout(mapsTimer);
		mapsTimer = setTimeout(() => void renderMaps(), 600);
	});
	const image = (id: string) => (view.value === 'final' ? thumbs.url(id) : maps.value.get(`${id}:${view.value}`)?.url);

	// ---------------------------------------------------------------- selection
	const picked = ref(new Set<string>());
	const pickedList = computed(() => list.value.filter((v) => picked.value.has(v.id)));
	function togglePick(id: string): void {
		const next = new Set(picked.value);
		if (!next.delete(id)) next.add(id);
		picked.value = next;
	}

	async function deletePicked(): Promise<void> {
		const ids = pickedList.value.map((v) => v.id).filter((id) => id !== baseId.value);
		if (!ids.length) return;
		const choice = await editor.ask({
			title:
				ids.length === 1
					? `Delete ${list.value.find((v) => v.id === ids[0])!.name}?`
					: `Delete ${ids.length} variants?`,
			detail: `Their changed settings go${picked.value.has(baseId.value) ? ', and the base stays' : ''}. The layers stay. Undo brings them back.`,
			choices: [{ id: 'delete', label: 'Delete', primary: true }]
		});
		if (choice !== 'delete') return;
		for (const id of ids) store.deleteVariant(id);
		picked.value = new Set();
	}

	// ---------------------------------------------------------------- cards
	function edit(id: string): void {
		store.switchVariant(id);
		editor.workspace = 'create';
	}

	const cardsEl = ref<HTMLElement | null>(null);
	const cardEl = (id: string) => cardsEl.value?.querySelector<HTMLElement>(`[data-variant="${id}"]`) ?? null;

	const { asking, ask } = useAnchoredAsk();
	async function confirmDelete(id: string): Promise<void> {
		const v = list.value.find((x) => x.id === id);
		const anchor = cardEl(id)?.querySelector<HTMLElement>('.info');
		if (!v || !anchor || list.value.length < 2) return;
		const choice = await ask(anchor, deleteVariantQuestion(v, baseId.value));
		if (choice === 'delete') store.deleteVariant(id);
	}

	// Renaming happens in the Variants panel, beside the workspace.
	function rename(v: ProjectVariant): void {
		editor.variantRename = v.id;
	}

	const menu = ref<InstanceType<typeof DropMenu> | null>(null);
	const menuItems = ref<MenuItem[]>([]);
	function onMenu(e: MouseEvent, v: ProjectVariant): void {
		menuItems.value = variantMenuItems(v, { rename: () => rename(v), remove: () => void confirmDelete(v.id) });
		menu.value?.openAt(e.clientX, e.clientY);
	}

	// ---------------------------------------------------------------- drag to reorder
	const dragging = ref<string | null>(null);
	const dropBefore = ref<string | null>(null);
	function onDrop(target: ProjectVariant): void {
		const id = dragging.value;
		dragging.value = null;
		dropBefore.value = null;
		if (!id || id === target.id) return;
		const from = list.value.findIndex((v) => v.id === id);
		let to = list.value.findIndex((v) => v.id === target.id);
		if (from < to) to--;
		store.moveVariant(id, to);
	}
</script>

<template>
	<section class="vws cf-panel">
		<div class="bar">
			<span class="cf-label">Variants</span>
			<span class="count cf-mono">{{ list.length }}</span>
			<div class="views" role="radiogroup" aria-label="Show">
				<button
					v-for="v in VIEWS"
					:key="v.id"
					type="button"
					role="radio"
					class="fk"
					:class="{ lit: view === v.id }"
					:aria-checked="view === v.id"
					@click="view = v.id">
					<span class="fk-face">{{ v.label }}</span>
				</button>
			</div>
			<span class="grow" />
			<template v-if="pickedList.length">
				<span class="lo">{{ pickedList.length }} selected</span>
				<button
					v-tip="'Delete the selected variants (the base stays)'"
					type="button"
					class="cf-ico-btn danger"
					aria-label="Delete the selected variants"
					:disabled="!pickedList.some((v) => v.id !== baseId)"
					@click="deletePicked">
					<IconTrash :size="14" />
				</button>
				<button type="button" class="cf-btn" @click="picked = new Set()">Clear</button>
			</template>
			<span v-else class="lo">Click to show · double-click to edit · drag to reorder</span>
		</div>

		<div ref="cardsEl" class="cards">
			<div
				v-for="v in list"
				:key="v.id"
				:data-variant="v.id"
				class="card"
				:class="{
					cur: v.id === activeId,
					picked: picked.has(v.id),
					dropBefore: dropBefore === v.id,
					rebase: dropBefore === v.id && v.id === baseId
				}"
				:draggable="v.id !== baseId"
				@click="store.switchVariant(v.id)"
				@dblclick="edit(v.id)"
				@contextmenu.prevent="onMenu($event, v)"
				@dragstart="dragging = v.id"
				@dragend="
					dragging = null;
					dropBefore = null;
				"
				@dragover.prevent="dropBefore = v.id"
				@drop.prevent="onDrop(v)">
				<div class="pic">
					<img v-if="image(v.id)" :src="image(v.id)" :alt="`${v.name}, ${view}`" draggable="false" />
					<span v-else class="spin" aria-label="Rendering" />
					<label class="tick" @click.stop @dblclick.stop>
						<input type="checkbox" :checked="picked.has(v.id)" @change="togglePick(v.id)" />
						<span class="sr">Select {{ v.name }}</span>
					</label>
					<span v-if="list.length > 1 && v.id === baseId" class="badge base">Base</span>
					<span v-else-if="v.id === activeId" class="badge cur">Editing</span>
				</div>
				<div class="info">
					<div class="line">
						<span class="name">{{ v.name }}</span>
						<span v-if="count(v)" class="changes cf-mono">◆ {{ count(v) }}</span>
						<span class="grow" />
						<button
							v-tip="'Edit in Create'"
							type="button"
							class="cf-ico-btn"
							:aria-label="`Edit ${v.name}`"
							@click.stop="edit(v.id)"
							@dblclick.stop>
							<IconPencil :size="14" />
						</button>
						<button
							v-tip="'New variant from this one'"
							type="button"
							class="cf-ico-btn"
							:aria-label="`New variant from ${v.name}`"
							@click.stop="store.addVariant(v.id)"
							@dblclick.stop>
							<IconCopy :size="14" />
						</button>
						<button
							type="button"
							class="cf-ico-btn"
							:aria-label="`More for ${v.name}`"
							@click.stop="onMenu($event, v)"
							@dblclick.stop>
							<IconDots :size="14" />
						</button>
					</div>
					<span class="note">{{ v.note || '' }}</span>
				</div>
			</div>
		</div>
		<DropMenu ref="menu" :items="menuItems" placement="pointer" />
		<AnchoredAsk v-if="asking" :question="asking.question" :anchor="asking.anchor" @answer="asking.answer" />
	</section>
</template>

<style scoped>
	.vws {
		display: grid;
		grid-template-rows: 36px minmax(0, 1fr);
		overflow: hidden;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 8px 0 10px;
		border-bottom: 1px solid var(--hairline);
		min-width: 0;
	}
	.count {
		font-size: 11px;
		color: var(--line-strong);
	}
	.views {
		display: flex;
		gap: 3px;
		margin-left: 10px;
	}
	.views .fk {
		height: 24px;
	}
	.views .fk-face {
		padding: 0 8px;
		font-size: 11px;
	}
	.lo {
		font-size: 12px;
		color: var(--text-lo);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.grow {
		flex: 1;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		grid-auto-rows: min-content;
		gap: 10px;
		padding: 10px;
		overflow-y: auto;
		background: var(--base);
	}
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		overflow: hidden;
		cursor: default;
		user-select: none;
		-webkit-user-select: none;
	}
	.card:hover {
		border-color: var(--line);
	}
	.card.picked {
		border-color: var(--e800);
	}
	/* The variant shown: Ember 400 edge and the halo. */
	.card.cur {
		border-color: var(--e400);
		box-shadow: var(--glow);
	}
	.card.dropBefore::before {
		content: '';
		position: absolute;
		left: -6px;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--e400);
	}
	/* Before the base, the dragged variant becomes the base (moveVariant). */
	.card.rebase::before {
		background: var(--gold);
	}
	.pic {
		position: relative;
		aspect-ratio: 3 / 2;
		background: var(--deep);
	}
	.pic img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		image-rendering: pixelated;
		background: var(--alpha-bg);
	}
	.spin {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 16px;
		height: 16px;
		margin: -8px 0 0 -8px;
		border: 2px solid var(--hairline);
		border-top-color: var(--e400);
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.tick {
		position: absolute;
		left: 6px;
		top: 6px;
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(17, 19, 22, 0.8);
		border-radius: 3px;
	}
	.tick input {
		margin: 0;
		accent-color: var(--accent);
	}
	.badge {
		position: absolute;
		right: 6px;
		top: 6px;
		height: 18px;
		padding: 0 6px;
		display: flex;
		align-items: center;
		background: rgba(17, 19, 22, 0.85);
		border: 1px solid;
		border-radius: 2px;
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.badge.base {
		border-color: var(--gold);
		color: var(--gold);
	}
	.badge.cur {
		border-color: var(--e400);
		color: var(--e300);
	}
	.info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 6px 8px 10px;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.name {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-hi);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.card.cur .name {
		color: var(--accent-hi);
	}
	.changes {
		flex: none;
		font-size: 11px;
		color: var(--text-lo);
	}
	.card.cur .changes {
		color: var(--e300);
	}
	.note {
		min-height: 16px;
		font-size: 11px;
		color: var(--text-lo);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
