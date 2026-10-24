<script setup lang="ts">
	// Blender-style outliner: Project · Layers (one list in evaluation order: the Base material first, then the top row
	// is applied first and the bottom row last, over everything) · Lights · Post. A smart material is one collapsible row
	// holding its member layers. The Diffuse and Height columns (headed on the Base row) show which channels each layer
	// affects; clicking one flips the same tick as the inspector.
	import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore, type SelectionKind } from '@/stores/editor';
	import { useActions } from '@/ui/actions';
	import { allLayerDefs, CATEGORY_LABELS, getLayerDef, layerChannels } from '@/layers/registry';
	import { allPostDefs } from '@/render/post/registry';
	import type { LayerCategory } from '@/layers/types';
	import { CATEGORY_HUE, layerHue, layerIcon, LIGHT_HUE, POST_HUE, recipeIcon } from '@/ui/meta';
	import { layerUnits, MAX_LIGHTS, type Layer, type LayerUnit, type SmartMaterial } from '@/core/project';
	import DropMenu, { type MenuItem } from '@/ui/components/DropMenu.vue';
	import {
		IconBox,
		IconBulb,
		IconChevronDown,
		IconChevronRight,
		IconDroplet,
		IconEye,
		IconEyeOff,
		IconMountain,
		IconPlus,
		IconSparkles,
		IconSquareRotated,
		IconSun
	} from '@tabler/icons-vue';
	import { RECIPES } from '@/recipes';
	import { SHAPE_MASK, maskLinks } from '@/layers/masks';
	import { supersampleFactor } from '@/core/supersample';
	import { vTip, type Tip } from '@/ui/tooltip';
	import { vPick } from '@/ui/eyedropper';

	const store = useProjectStore();
	const editor = useEditorStore();
	const act = useActions();

	const errors = computed(() => editor.stats?.errors ?? {});
	const MATERIAL_HUE = 'var(--accent-hi)';

	// ---------------------------------------------------------------- add menus
	/** One tile grid: the generators, then the smart materials (composites of them), then filters and adjustments. */
	const addLayerItems = computed<MenuItem[]>(() => {
		const items: MenuItem[] = [];
		const section = (cat: LayerCategory) => {
			const defs = allLayerDefs().filter((d) => d.category === cat);
			if (!defs.length) return;
			items.push({ section: CATEGORY_LABELS[cat] });
			for (const d of defs)
				items.push({
					label: d.label,
					hint: d.description,
					hue: CATEGORY_HUE[cat],
					icon: layerIcon(d.type),
					action: () => act.addLayer(d.type)
				});
		};
		for (const cat of ['noise', 'shape', 'pattern'] as const) section(cat);
		items.push({ section: 'Smart materials' });
		for (const r of RECIPES)
			items.push({
				label: r.label,
				hint: r.description,
				hue: MATERIAL_HUE,
				icon: recipeIcon(r.id),
				action: () => act.addMaterial(r.id)
			});
		for (const cat of ['filter', 'adjust'] as const) section(cat);
		return items;
	});

	const addLightItems = computed<MenuItem[]>(() => [
		{
			label: 'Directional light',
			hue: LIGHT_HUE,
			disabled: store.project.lighting.lights.length >= MAX_LIGHTS,
			action: () => {
				const l = store.addLight('directional');
				if (l) editor.select('light', l.id);
			}
		},
		{
			label: 'Point light',
			hue: LIGHT_HUE,
			disabled: store.project.lighting.lights.length >= MAX_LIGHTS,
			action: () => {
				const l = store.addLight('point');
				if (l) editor.select('light', l.id);
			}
		}
	]);

	const addPostItems = computed<MenuItem[]>(() =>
		allPostDefs().map((d) => ({
			label: d.label,
			hint: d.description,
			hue: POST_HUE,
			action: () => {
				const f = store.addPost(d.type);
				editor.select('post', f.id);
			}
		}))
	);

	function isSel(kind: SelectionKind, id?: string): boolean {
		return editor.selection.kind === kind && editor.selection.id === id;
	}

	// ---------------------------------------------------------------- layer units (free layers and materials)
	const units = computed(() => layerUnits(store.project.layers, store.project.materials));
	const unitKey = (u: LayerUnit) => (u.material ? u.material.id : u.layer.id);

	/** Materials shown open (a new material starts collapsed). */
	const expanded = ref(new Set<string>());
	function toggleExpanded(id: string): void {
		if (expanded.value.has(id)) expanded.value.delete(id);
		else expanded.value.add(id);
	}
	/** Rows under a unit: a free layer's own row, or an open material's members. */
	const rowsOf = (u: LayerUnit): Layer[] =>
		u.material ? (expanded.value.has(u.material.id) ? u.layers : []) : [u.layer];

	// ---------------------------------------------------------------- mask lane (FR8.23)
	// Left of the icons, a line from each layer with a Limit to up to the layers that wrote the masks it reads: horizontal
	// from the reader's icon, a rounded turn up, straight up, a rounded turn into the writer's icon. Links to one writer's
	// mask share a lane (a trunk with a branch per reader); overlapping trunks take separate lanes, shorter ones inner.

	/** The rows shown, top to bottom: a material's row (`material:<id>`), then its members' when it is open. */
	const visibleRows = computed(() =>
		units.value.flatMap((u) =>
			u.material ? [`material:${u.material.id}`, ...rowsOf(u).map((l) => l.id)] : [u.layer.id]
		)
	);
	/** The row a layer is drawn on: its own, or its material's while that is closed. */
	const rowOfLayer = computed(() => {
		const m = new Map<string, string>();
		for (const u of units.value) {
			if (!u.material) m.set(u.layer.id, u.layer.id);
			else
				for (const l of u.layers) m.set(l.id, expanded.value.has(u.material.id) ? l.id : `material:${u.material.id}`);
		}
		return m;
	});

	const LANE_STEP = 7;
	const MASK_HUES = ['#5fb3c4', '#b48ad8', '#7cc37a', '#d6c25a', '#e07d8c', '#7f9fe0'];
	/** Line colours: Shape in ember, the other masks drawn from the palette in the order they first appear in the list. */
	const maskHues = computed(() => {
		const m = new Map<string, string>([[SHAPE_MASK, '#d98a3a']]);
		for (const t of [...laneTrunks.value].sort((a, b) => a.lo - b.lo))
			if (!m.has(t.mask)) m.set(t.mask, MASK_HUES[(m.size - 1) % MASK_HUES.length]);
		return m;
	});

	/** Trunks: one per (writer row, mask), with its readers' rows and its lane (0 = innermost). */
	const laneTrunks = computed(() => {
		const order = new Map(visibleRows.value.map((id, i) => [id, i]));
		const rowOf = (id: string) => (id.startsWith('material:') ? id : rowOfLayer.value.get(id));
		const trunks = new Map<
			string,
			{ writer: string; mask: string; readers: Set<string>; lo: number; hi: number; lane: number }
		>();
		for (const l of maskLinks(store.project)) {
			const r = rowOf(l.reader);
			const w = rowOf(l.writer);
			if (!r || !w || r === w || !order.has(r) || !order.has(w)) continue;
			const key = `${w}\u0000${l.mask}`;
			let t = trunks.get(key);
			if (!t)
				trunks.set(
					key,
					(t = { writer: w, mask: l.mask, readers: new Set(), lo: order.get(w)!, hi: order.get(w)!, lane: 0 })
				);
			t.readers.add(r);
			t.hi = Math.max(t.hi, order.get(r)!);
		}
		// Shorter spans first, each into the innermost lane none of the already placed spans it overlaps uses.
		const list = [...trunks.values()].sort((a, b) => a.hi - a.lo - (b.hi - b.lo));
		const placed: typeof list = [];
		for (const t of list) {
			while (placed.some((o) => o.lane === t.lane && o.lo < t.hi && t.lo < o.hi)) t.lane++;
			placed.push(t);
		}
		return list;
	});
	const lanes = computed(() => (laneTrunks.value.length ? Math.max(...laneTrunks.value.map((t) => t.lane)) + 1 : 0));
	/** Width of the lane column (0 without links): rows move right by it. */
	const laneWidth = computed(() => (lanes.value ? 6 + lanes.value * LANE_STEP : 0));

	/** Measured row centres and icon left edges, in the list's coordinates. */
	const listEl = ref<HTMLElement | null>(null);
	const rowPos = ref(new Map<string, { y: number; x: number }>());
	function measureRows(): void {
		const list = listEl.value;
		if (!list) return;
		const box = list.getBoundingClientRect();
		const pos = new Map<string, { y: number; x: number }>();
		for (const el of list.querySelectorAll<HTMLElement>('[data-row]')) {
			const r = el.getBoundingClientRect();
			// The icon's left edge — or, on a material's row, its disclosure chevron's.
			const icon = el.querySelector(':scope > .disclose, :scope > svg')?.getBoundingClientRect();
			pos.set(el.dataset.row!, { y: r.top + r.height / 2 - box.top, x: (icon?.left ?? r.left + 14) - box.left });
		}
		rowPos.value = pos;
	}
	watch([visibleRows, laneWidth, laneTrunks], () => measureRows(), { flush: 'post' });
	let rowObserver: ResizeObserver | null = null;
	onMounted(() => {
		measureRows();
		rowObserver = new ResizeObserver(() => measureRows());
		if (listEl.value) rowObserver.observe(listEl.value);
	});
	onBeforeUnmount(() => rowObserver?.disconnect());

	/** The lane's paths: per reader, from its icon round into its trunk's lane, up, and round into the writer's icon. */
	const lanePaths = computed(() => {
		const out: { d: string; colour: string; key: string; dim: boolean }[] = [];
		const R = 4;
		for (const t of laneTrunks.value) {
			const w = rowPos.value.get(t.writer);
			if (!w) continue;
			const x = laneWidth.value - 5 - t.lane * LANE_STEP;
			for (const reader of t.readers) {
				const r = rowPos.value.get(reader);
				if (!r) continue;
				const layer = store.project.layers.find((l) => l.id === reader);
				out.push({
					key: `${t.writer}:${t.mask}:${reader}`,
					colour: maskHues.value.get(t.mask) ?? MASK_HUES[0],
					dim: layer ? !layer.enabled : false,
					d: `M${r.x - 3} ${r.y}H${x + R}Q${x} ${r.y} ${x} ${r.y - R}V${w.y + R}Q${x} ${w.y} ${x + R} ${w.y}H${w.x - 3}`
				});
			}
		}
		return out;
	});

	// Selecting a member (from the viewport, after a delete …) opens its material.
	watch(
		() => editor.selection,
		(s) => {
			if (s.kind !== 'layer' || !s.id) return;
			const m = (store.project.materials ?? []).find((x) => Object.values(x.members).includes(s.id!));
			if (m) expanded.value.add(m.id);
		},
		{ immediate: true }
	);

	// Keep the selected row in view (selected from the viewport, after an add or delete …).
	const scroller = ref<HTMLElement | null>(null);
	watch(
		() => [editor.selection.kind, editor.selection.id],
		async () => {
			await nextTick();
			scroller.value?.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' });
		}
	);

	const materialShown = (m: SmartMaterial) => m.enabled !== false;
	const containsSel = (u: LayerUnit) =>
		!!u.material && editor.selection.kind === 'layer' && u.layers.some((l) => l.id === editor.selection.id);

	// ---------------------------------------------------------------- Diffuse / Height columns
	type Channel = 'diffuse' | 'height';
	const CHANNELS: Channel[] = ['diffuse', 'height'];
	const CHANNEL_ICON: Record<Channel, Component> = { diffuse: IconDroplet, height: IconMountain };
	const CHANNEL_LABEL: Record<Channel, string> = { diffuse: 'Diffuse', height: 'Height' };
	/** 'on' / 'off' = a tick switches it; 'always' = the filter always affects it; null = never. */
	type ChannelState = 'on' | 'off' | 'always' | null;

	function channelState(l: Layer, ch: Channel): ChannelState {
		const c = layerChannels(l.type)[ch];
		if (c === undefined) return null;
		if (c === true) return 'always';
		return l.params[c] === true ? 'on' : 'off';
	}

	function toggleChannel(l: Layer, ch: Channel): void {
		const key = layerChannels(l.type)[ch];
		if (typeof key === 'string') store.setLayerParam(l.id, key, l.params[key] !== true);
	}

	function channelTip(l: Layer, ch: Channel): Tip {
		const s = channelState(l, ch);
		if (s === 'always') {
			const label = getLayerDef(l.type)?.label ?? l.type;
			return {
				title: `${CHANNEL_LABEL[ch]}: always`,
				body: `A ${label} filter always changes the ${ch === 'diffuse' ? 'colour' : 'height'}.`
			};
		}
		return {
			title: `${CHANNEL_LABEL[ch]}: ${s}`,
			body: `Click to turn the ${CHANNEL_LABEL[ch]} output ${s === 'on' ? 'off' : 'on'} — the tick on the layer’s ${CHANNEL_LABEL[ch]} card.`
		};
	}

	/** A material affects a channel when any of its shown members does. */
	function materialChannel(u: LayerUnit, ch: Channel): boolean {
		return (
			!!u.material &&
			u.layers.some((l) => l.enabled && (channelState(l, ch) === 'on' || channelState(l, ch) === 'always'))
		);
	}

	// ---------------------------------------------------------------- context menu
	// Right-clicking a row selects it (so the menu's target is the highlighted row) and opens its menu at the cursor.
	const rowMenu = ref<InstanceType<typeof DropMenu> | null>(null);
	const rowMenuItems = ref<MenuItem[]>([]);

	async function onRowMenu(e: MouseEvent, kind: 'layer' | 'material', id: string): Promise<void> {
		const { clientX: x, clientY: y } = e;
		editor.select(kind, id);
		rowMenuItems.value = [
			// Duplicating copies a layer; materials have no duplicate.
			...(kind === 'layer' ? [{ label: 'Duplicate', shortcut: 'Ctrl+D', action: act.duplicateSelection }] : []),
			{
				label: 'Delete',
				shortcut: 'Del',
				hint: kind === 'material' ? 'Delete the material and its layers' : undefined,
				action: act.deleteSelection
			}
		];
		// The menu closes on scroll, so let a half-hidden row finish scrolling into view (the watch above) first.
		await nextTick();
		await new Promise(requestAnimationFrame);
		rowMenu.value?.openAt(x, y);
	}

	// ---------------------------------------------------------------- rename
	const renaming = ref<string | null>(null);
	const renameText = ref('');
	const renameInput = ref<HTMLInputElement[] | null>(null);

	async function startRename(id: string, name: string): Promise<void> {
		renaming.value = id;
		renameText.value = name;
		await nextTick();
		renameInput.value?.[0]?.focus();
		renameInput.value?.[0]?.select();
	}

	function finishRename(kind: 'layer' | 'light' | 'material', apply: boolean): void {
		const id = renaming.value;
		renaming.value = null;
		const name = renameText.value.trim();
		if (!apply || !id || !name) return;
		if (kind === 'layer') store.updateLayer(id, { name });
		else if (kind === 'material') store.renameMaterial(id, name);
		else store.updateLight(id, { name });
	}

	// ---------------------------------------------------------------- drag reorder
	// Free layers and whole materials move between units; a member moves within its material; post filters in theirs.
	type Drag =
		| { kind: 'unit'; id: string }
		| { kind: 'member'; id: string; material: string }
		| { kind: 'post'; id: string };
	const drag = ref<Drag | null>(null);
	/** Drop slot: `list` is 'units', 'post' or a material id; `index` is the gap before that row. */
	const dropAt = ref<{ list: string; index: number } | null>(null);

	function onDragStart(e: DragEvent, d: Drag): void {
		drag.value = d;
		e.dataTransfer?.setData('text/plain', d.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}

	const lowerHalf = (e: DragEvent) => {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return e.clientY > r.top + r.height / 2;
	};

	function onUnitOver(e: DragEvent, index: number): void {
		if (drag.value?.kind !== 'unit') return;
		e.preventDefault();
		dropAt.value = { list: 'units', index: index + (lowerHalf(e) ? 1 : 0) };
	}

	function onMemberOver(e: DragEvent, material: string, index: number): void {
		if (drag.value?.kind !== 'member' || drag.value.material !== material) return;
		e.preventDefault();
		e.stopPropagation();
		dropAt.value = { list: material, index: index + (lowerHalf(e) ? 1 : 0) };
	}

	function onPostOver(e: DragEvent, index: number): void {
		if (drag.value?.kind !== 'post') return;
		e.preventDefault();
		dropAt.value = { list: 'post', index: index + (lowerHalf(e) ? 1 : 0) };
	}

	/** The target index once the dragged row is taken out of its list. */
	const target = (from: number, gap: number) => (from >= 0 && from < gap ? gap - 1 : gap);

	function onDrop(): void {
		const d = drag.value;
		const at = dropAt.value;
		drag.value = null;
		dropAt.value = null;
		if (!d || !at) return;
		if (d.kind === 'unit' && at.list === 'units') {
			store.moveUnit(
				d.id,
				target(
					units.value.findIndex((u) => unitKey(u) === d.id),
					at.index
				)
			);
		} else if (d.kind === 'member' && at.list === d.material) {
			const u = units.value.find((x) => x.material?.id === d.material);
			store.moveMember(d.id, target(u?.material ? u.layers.findIndex((l) => l.id === d.id) : -1, at.index));
		} else if (d.kind === 'post' && at.list === 'post') {
			store.movePost(
				d.id,
				target(
					store.project.post.findIndex((f) => f.id === d.id),
					at.index
				)
			);
		}
	}

	function onDragEnd(): void {
		drag.value = null;
		dropAt.value = null;
	}

	const isDrop = (list: string, index: number) => dropAt.value?.list === list && dropAt.value.index === index;
</script>

<template>
	<aside class="outliner cf-panel">
		<div class="head">
			<span class="cf-label">Outliner</span>
		</div>
		<div ref="scroller" class="scroll">
			<button type="button" class="row root" :class="{ sel: isSel('project') }" @click="editor.select('project')">
				<IconBox :size="15" :color="isSel('project') ? 'var(--accent-hi)' : 'var(--text-lo)'" />
				<span class="name strong">{{ store.project.name }}</span>
				<span
					v-tip:right="
						'Texture size @ supersampling. Select the project for the texture, base material, world lighting and render settings'
					"
					class="meta cf-mono"
					>{{ store.project.width }}×{{ store.project.height }} @{{ supersampleFactor(store.project) }}x</span
				>
			</button>

			<!-- Layers -->
			<div class="section">
				<span
					v-tip:right="{
						title: 'Layers',
						body: 'In evaluation order: the top layer is applied first, each one below goes over it, the bottom layer last.'
					}"
					class="cf-label"
					>Layers</span
				>
				<span class="count cf-mono">{{ store.project.layers.length }}</span>
				<span class="grow" />
				<DropMenu
					v-tip:right="'Add a layer or smart material'"
					:items="addLayerItems"
					placement="right"
					layout="tiles"
					trigger-class="fk add"
					aria-label="Add layer"
					><span class="fk-face"><IconPlus :size="13" /></span
				></DropMenu>
			</div>
			<div ref="listEl" class="list" :style="{ '--lane': `${laneWidth}px` }" @dragleave.self="dropAt = null">
				<!-- Mask lane: who is limited to whose mask (FR8.23) -->
				<svg v-if="lanePaths.length" class="lane" aria-hidden="true">
					<path v-for="p in lanePaths" :key="p.key" :d="p.d" :stroke="p.colour" :class="{ dim: p.dim }" />
				</svg>
				<!-- Base material: under every layer; heads the Diffuse / Height columns -->
				<div class="row base" :class="{ sel: isSel('base') }" @click="editor.select('base')">
					<span
						v-pick="() => store.project.base.color"
						class="swatch"
						:style="{ background: store.project.base.color }" />
					<span
						v-tip:right="{
							title: 'Base',
							body: 'The material under every layer: colour, roughness, specular, metalness, height, opacity. Opens the project settings.'
						}"
						class="name"
						>Base</span
					>
					<span class="cells">
						<span
							v-tip:right="{
								title: 'Diffuse',
								body: 'The layer colours the surface. Click a layer’s mark to switch its Diffuse output.'
							}"
							class="ch colhead"
							><IconDroplet :size="14"
						/></span>
						<span
							v-tip:right="{
								title: 'Height',
								body: 'The layer shapes the surface. Click a layer’s mark to switch its Height output.'
							}"
							class="ch colhead"
							><IconMountain :size="14"
						/></span>
						<span class="ch" />
					</span>
				</div>
				<div
					v-for="(u, ui) in units"
					:key="unitKey(u)"
					class="unit"
					:class="{
						group: !!u.material,
						open: !!u.material && expanded.has(u.material.id),
						dropBefore: isDrop('units', ui),
						dropAfter: isDrop('units', ui + 1) && ui === units.length - 1
					}"
					@dragover="onUnitOver($event, ui)"
					@drop.prevent="onDrop">
					<!-- Smart material: one collapsible row -->
					<div
						v-if="u.material"
						:data-row="`material:${u.material.id}`"
						class="row mat"
						:class="{
							sel: isSel('material', u.material.id),
							contains: containsSel(u),
							off: !materialShown(u.material)
						}"
						draggable="true"
						@dragstart="onDragStart($event, { kind: 'unit', id: u.material.id })"
						@dragend="onDragEnd"
						@click="editor.select('material', u.material.id)"
						@contextmenu.prevent="onRowMenu($event, 'material', u.material.id)">
						<button
							type="button"
							class="disclose"
							:aria-expanded="expanded.has(u.material.id)"
							:aria-label="expanded.has(u.material.id) ? 'Collapse material' : 'Expand material'"
							@click.stop="toggleExpanded(u.material.id)">
							<component :is="expanded.has(u.material.id) ? IconChevronDown : IconChevronRight" :size="12" />
						</button>
						<IconSquareRotated
							:size="15"
							:color="isSel('material', u.material.id) ? 'var(--accent-hi)' : MATERIAL_HUE" />
						<input
							v-if="renaming === u.material.id"
							ref="renameInput"
							v-model="renameText"
							class="rename"
							aria-label="Material name"
							@click.stop
							@contextmenu.stop
							@keydown.enter.prevent="finishRename('material', true)"
							@keydown.esc.prevent="finishRename('material', false)"
							@blur="finishRename('material', true)" />
						<span v-else class="name" @dblclick.stop="startRename(u.material.id, u.material.name)">{{
							u.material.name
						}}</span>
						<span v-tip:right="`${u.layers.length} layers`" class="meta cf-mono">{{ u.layers.length }}</span>
						<span class="cells">
							<span
								v-for="ch in CHANNELS"
								:key="ch"
								v-tip:right="
									materialChannel(u, ch)
										? `Some of its layers ${ch === 'diffuse' ? 'colour' : 'shape'} the surface`
										: undefined
								"
								class="ch fixed">
								<component :is="CHANNEL_ICON[ch]" v-if="materialChannel(u, ch)" :size="14" />
							</span>
							<button
								v-tip:right="materialShown(u.material) ? 'Hide the material' : 'Show the material'"
								type="button"
								class="mini"
								:aria-label="materialShown(u.material) ? 'Hide material' : 'Show material'"
								@click.stop="store.setMaterialEnabled(u.material.id, !materialShown(u.material))">
								<component :is="materialShown(u.material) ? IconEye : IconEyeOff" :size="14" />
							</button>
						</span>
					</div>

					<!-- Layers: a free layer's row, or an open material's members -->
					<div
						v-for="(layer, li) in rowsOf(u)"
						:key="layer.id"
						:data-row="layer.id"
						class="row"
						:class="{
							member: !!u.material,
							sel: isSel('layer', layer.id),
							off: !layer.enabled || (!!u.material && !materialShown(u.material)),
							dropBefore: !!u.material && isDrop(u.material.id, li),
							dropAfter: !!u.material && isDrop(u.material.id, li + 1) && li === u.layers.length - 1
						}"
						draggable="true"
						@dragstart="
							onDragStart(
								$event,
								u.material ? { kind: 'member', id: layer.id, material: u.material.id } : { kind: 'unit', id: layer.id }
							)
						"
						@dragover="u.material && onMemberOver($event, u.material.id, li)"
						@dragend="onDragEnd"
						@click="editor.select('layer', layer.id)"
						@contextmenu.prevent="onRowMenu($event, 'layer', layer.id)">
						<component
							:is="layerIcon(layer.type)"
							:size="15"
							:color="isSel('layer', layer.id) ? 'var(--accent-hi)' : layerHue(layer.type)" />
						<input
							v-if="renaming === layer.id"
							ref="renameInput"
							v-model="renameText"
							class="rename"
							aria-label="Layer name"
							@click.stop
							@contextmenu.stop
							@keydown.enter.prevent="finishRename('layer', true)"
							@keydown.esc.prevent="finishRename('layer', false)"
							@blur="finishRename('layer', true)" />
						<span v-else class="name" @dblclick.stop="startRename(layer.id, layer.name)">{{ layer.name }}</span>
						<span v-if="errors[layer.id]" v-tip:right="errors[layer.id]" class="err">!</span>
						<span class="cells">
							<template v-for="ch in CHANNELS" :key="ch">
								<button
									v-if="channelState(layer, ch) === 'on' || channelState(layer, ch) === 'off'"
									v-tip:right="channelTip(layer, ch)"
									type="button"
									class="ch"
									:class="channelState(layer, ch)"
									:aria-pressed="channelState(layer, ch) === 'on'"
									:aria-label="`${CHANNEL_LABEL[ch]} output`"
									@click.stop="toggleChannel(layer, ch)">
									<component :is="CHANNEL_ICON[ch]" :size="14" />
								</button>
								<span
									v-else-if="channelState(layer, ch) === 'always'"
									v-tip:right="channelTip(layer, ch)"
									class="ch fixed"
									><component :is="CHANNEL_ICON[ch]" :size="14"
								/></span>
								<span v-else class="ch" />
							</template>
							<button
								v-tip:right="layer.enabled ? 'Hide' : 'Show'"
								type="button"
								class="mini"
								:aria-label="layer.enabled ? 'Hide layer' : 'Show layer'"
								@click.stop="store.updateLayer(layer.id, { enabled: !layer.enabled })">
								<component :is="layer.enabled ? IconEye : IconEyeOff" :size="14" />
							</button>
						</span>
					</div>
				</div>
				<div v-if="!units.length" class="empty">No layers yet. Add a layer or smart material with +.</div>
			</div>

			<!-- Lighting -->
			<div class="section">
				<span class="cf-label">Lights</span>
				<span class="count cf-mono">{{ store.project.lighting.lights.length }}</span>
				<span class="grow" />
				<DropMenu
					v-tip:right="'Add a light'"
					:items="addLightItems"
					align="right"
					trigger-class="fk add"
					aria-label="Add light"
					><span class="fk-face"><IconPlus :size="13" /></span
				></DropMenu>
			</div>
			<div class="list">
				<div
					v-for="light in store.project.lighting.lights"
					:key="light.id"
					class="row"
					:class="{ sel: isSel('light', light.id), off: !light.enabled }"
					@click="editor.select('light', light.id)">
					<component
						:is="light.type === 'point' ? IconBulb : IconSun"
						:size="15"
						:color="isSel('light', light.id) ? 'var(--accent-hi)' : LIGHT_HUE" />
					<input
						v-if="renaming === light.id"
						ref="renameInput"
						v-model="renameText"
						class="rename"
						aria-label="Light name"
						@click.stop
						@keydown.enter.prevent="finishRename('light', true)"
						@keydown.esc.prevent="finishRename('light', false)"
						@blur="finishRename('light', true)" />
					<span v-else class="name" @dblclick.stop="startRename(light.id, light.name)">{{ light.name }}</span>
					<span
						v-pick="() => String(light.params.color)"
						class="chip"
						:style="{ background: String(light.params.color) }" />
					<button
						v-tip:right="light.enabled ? 'Turn off' : 'Turn on'"
						type="button"
						class="mini"
						:aria-label="light.enabled ? 'Disable light' : 'Enable light'"
						@click.stop="store.updateLight(light.id, { enabled: !light.enabled })">
						<component :is="light.enabled ? IconEye : IconEyeOff" :size="14" />
					</button>
				</div>
				<div v-if="!store.project.lighting.lights.length" class="empty">
					No lights: sky and ambient only (project settings).
				</div>
			</div>

			<!-- Post -->
			<div class="section">
				<span class="cf-label">Post</span>
				<span class="count cf-mono">{{ store.project.post.length }}</span>
				<span class="grow" />
				<DropMenu
					v-tip:right="'Add a post filter'"
					:items="addPostItems"
					align="right"
					trigger-class="fk add"
					aria-label="Add post filter"
					><span class="fk-face"><IconPlus :size="13" /></span
				></DropMenu>
			</div>
			<div class="list" @dragleave.self="dropAt = null">
				<div
					v-for="(f, i) in store.project.post"
					:key="f.id"
					class="row"
					:class="{
						sel: isSel('post', f.id),
						off: !f.enabled,
						dropBefore: isDrop('post', i),
						dropAfter: isDrop('post', i + 1) && i === store.project.post.length - 1
					}"
					draggable="true"
					@dragstart="onDragStart($event, { kind: 'post', id: f.id })"
					@dragover="onPostOver($event, i)"
					@drop.prevent="onDrop"
					@dragend="onDragEnd"
					@click="editor.select('post', f.id)">
					<IconSparkles :size="15" :color="isSel('post', f.id) ? 'var(--accent-hi)' : POST_HUE" />
					<span class="name">{{ allPostDefs().find((d) => d.type === f.type)?.label ?? f.type }}</span>
					<span v-if="errors[f.id]" v-tip:right="errors[f.id]" class="err">!</span>
					<button
						v-tip:right="f.enabled ? 'Turn off' : 'Turn on'"
						type="button"
						class="mini"
						:aria-label="f.enabled ? 'Disable filter' : 'Enable filter'"
						@click.stop="store.updatePost(f.id, { enabled: !f.enabled })">
						<component :is="f.enabled ? IconEye : IconEyeOff" :size="14" />
					</button>
				</div>
				<div v-if="!store.project.post.length" class="empty">No post filters. The render is clamped to 0–1.</div>
			</div>
		</div>
		<DropMenu ref="rowMenu" :items="rowMenuItems" placement="pointer" />
	</aside>
</template>

<style scoped>
	.outliner {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		user-select: none;
		-webkit-user-select: none;
	}
	.head {
		height: 28px;
		flex: none;
		display: flex;
		align-items: center;
		padding: 0 10px;
		border-bottom: 1px solid var(--hairline);
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 4px 0 12px;
	}
	.section {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 28px;
		padding: 0 4px 0 10px;
		margin-top: 6px;
	}
	.section .cf-label {
		cursor: default;
	}
	.count {
		font-size: 11px;
		color: var(--line-strong);
	}
	.grow {
		flex: 1;
	}
	.section :deep(.dm + .dm) {
		margin-left: -6px;
	}
	/* Add buttons: small Forged keys (a face on a 2px lip), latched — dropped onto the lip, Ember 300 ink — while their
   menu is open. */
	.section :deep(.fk.add) {
		width: 24px;
		height: 22px;
	}
	.section :deep(.fk.add > .fk-face) {
		padding: 0;
	}
	.section :deep(.fk.add.open > .fk-face) {
		top: 2px;
		background: var(--sunken);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--e300);
	}
	.swatch {
		width: 15px;
		height: 15px;
		border: 1px solid var(--line);
		border-radius: 2px;
		flex: none;
	}
	.list {
		position: relative;
		display: flex;
		flex-direction: column;
	}
	/* The mask lane (FR8.23): lines from layers with a Limit to up to the layers that wrote their masks, left of the
   icons. Rows move right by its width (--lane). */
	.lane {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
		z-index: 1;
	}
	.lane path {
		fill: none;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.85;
	}
	.lane path.dim {
		opacity: 0.35;
	}
	.unit {
		position: relative;
	}
	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 30px;
		width: 100%;
		padding: 0 4px 0 calc(14px + var(--lane, 0px));
		border: 0;
		background: transparent;
		color: var(--text);
		text-align: left;
		cursor: default;
		font-size: 14px;
	}
	.row:hover {
		background: var(--raised);
	}
	/* The selection: an ember-tinted row with an Ember 500 bar, unmistakable against hover. */
	.row.sel,
	.row.sel:hover {
		background: linear-gradient(rgba(246, 110, 16, 0.15), rgba(246, 110, 16, 0.15)), var(--raised);
		box-shadow:
			inset 2px 0 0 var(--e500),
			inset 0 1px 0 rgba(255, 144, 25, 0.12),
			inset 0 -1px 0 rgba(255, 144, 25, 0.12);
		color: var(--text-hi);
	}
	.row.sel .name {
		color: var(--text-hi);
	}
	.row.contains {
		box-shadow: inset 2px 0 0 var(--line-strong);
	}
	.row.off .name {
		color: var(--line-strong);
		text-decoration: line-through;
		text-decoration-color: var(--line);
	}
	/* A hidden row: its Diffuse / Height marks and its eye all take the dimmest (off) grey. The marks can't be switched
   while hidden: no hover, and a click falls through to the row. */
	.row.off .ch,
	.row.off .mini {
		color: var(--line);
	}
	.row.off .ch {
		pointer-events: none;
	}
	.row.off .mini:hover {
		color: var(--text-lo);
	}
	.row.root {
		padding-left: 10px;
	}
	.row.mat {
		padding-left: calc(1px + var(--lane, 0px));
	}
	.row.mat .name {
		font-weight: 500;
	}
	/* Members sit under their material, on a guide line. */
	.row.member {
		padding-left: calc(28px + var(--lane, 0px));
	}
	.row.member::after {
		content: '';
		position: absolute;
		left: calc(7px + var(--lane, 0px));
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--hairline);
	}
	.unit.dropBefore::before,
	.unit.dropAfter::after,
	.row.dropBefore::before,
	.row.member.dropAfter::after,
	.row.dropAfter::after {
		content: '';
		position: absolute;
		left: 8px;
		right: 8px;
		width: auto;
		height: 2px;
		background: var(--e400);
		z-index: 1;
	}
	.unit.dropBefore::before,
	.row.dropBefore::before {
		top: -1px;
	}
	.unit.dropAfter::after,
	.row.dropAfter::after {
		top: auto;
		bottom: -1px;
	}
	.disclose {
		width: 13px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-right: -4px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text-lo);
		flex: none;
	}
	.disclose:hover {
		color: var(--text-hi);
	}
	.name {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.name.strong {
		font-weight: 500;
		color: var(--text-hi);
	}
	.meta {
		font-size: 11px;
		color: var(--text-lo);
		flex: none;
	}
	.rename {
		flex: 1;
		min-width: 0;
		height: 24px;
		border: 1px solid var(--accent);
		border-radius: var(--r-field);
		background: var(--sunken);
		color: var(--text-hi);
		font-size: 12px;
		padding: 0 4px;
		outline: none;
		user-select: text;
		-webkit-user-select: text;
	}
	/* Diffuse / Height cells: studs — a bright mark when on, a faint one when off (click to switch), a quiet fixed mark
   when the filter always affects the channel. */
	.ch {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		padding: 0;
		border: 0;
		border-radius: 3px;
		background: transparent;
		color: var(--text-hi);
	}
	.ch.colhead {
		color: var(--text-lo);
		cursor: default;
	}
	/* Diffuse, Height and eye sit flush, under the column heads. */
	.cells {
		display: flex;
		flex: none;
	}
	button.ch:hover {
		background: var(--hairline);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.ch.off {
		color: var(--line);
	}
	button.ch.off:hover {
		color: var(--text-lo);
	}
	.ch.fixed {
		color: var(--text-lo);
	}
	.mini {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 0;
		border-radius: 3px;
		background: transparent;
		color: var(--text-hi);
		flex: none;
	}
	.mini:hover {
		color: var(--text-hi);
		background: var(--hairline);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.err {
		width: 14px;
		height: 14px;
		border-radius: 2px;
		background: var(--blood);
		color: var(--deep);
		font-size: 10px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}
	.chip {
		width: 10px;
		height: 10px;
		border: 1px solid var(--line);
		flex: none;
	}
	.empty {
		padding: 4px 14px;
		font-size: 12px;
		color: var(--text-lo);
	}
</style>
