<script setup lang="ts">
	// Dropdown menu: a trigger button and a popover list of actions, section headers and separators.
	// layout="tiles" lays each section out as a wrapping row of square tiles; placement="right" pops the menu out
	// beside the trigger (teleported to <body> so the panel it sits in can't clip it). placement="pointer" is a context
	// menu: no trigger, opened at the cursor with `openAt(e.clientX, e.clientY)` from a contextmenu handler.
	// placement="under" is "below" teleported (right-aligned under the trigger), for triggers in panels that clip.
	// `tabs` (tile layout): a row of tabs over the tiles, each its own items; the menu opens on the first.
	import { computed, nextTick, onBeforeUnmount, ref, watch, type Component } from 'vue';
	import { IconSquareRotated } from '@tabler/icons-vue';
	import { vTip } from '@/ui/tooltip';

	export interface MenuItem {
		label?: string;
		/** Non-clickable section header. */
		section?: string;
		separator?: boolean;
		shortcut?: string;
		disabled?: boolean;
		checked?: boolean;
		hint?: string;
		/** CSS colour for the leading category tick. */
		hue?: string;
		/** Tile layout: icon (a Tabler component) for the tile thumbnail (placeholder until `image` is set). */
		icon?: Component;
		/** Tile layout: thumbnail image URL; replaces the icon. */
		image?: string;
		action?: () => void;
		/** Right-click on the item: closes the menu and runs this (e.g. a preset tile's Edit). */
		context?: () => void;
	}

	/** A tab of a tiled menu: its own items, and what it says when it has none. */
	export interface MenuTab {
		label: string;
		items: MenuItem[];
		empty?: string;
	}

	const props = withDefaults(
		defineProps<{
			items?: MenuItem[];
			/** Tile layout: tabs, each with its own items (in place of `items`). */
			tabs?: MenuTab[];
			label?: string;
			align?: 'left' | 'right';
			placement?: 'below' | 'right' | 'pointer' | 'under';
			layout?: 'list' | 'tiles';
			triggerClass?: string;
			ariaLabel?: string;
		}>(),
		{
			align: 'left',
			placement: 'below',
			items: () => [],
			layout: 'list',
			triggerClass: 'menu-trigger'
		}
	);

	const open = ref(false);
	const root = ref<HTMLElement | null>(null);
	const trigger = ref<HTMLElement | null>(null);
	const list = ref<HTMLElement | null>(null);
	/** Right and pointer placements: teleported, at a fixed viewport position. */
	const floating = computed(() => props.placement !== 'below');
	/** Floating: the measured position, null until then (the popover stays hidden till then). */
	const pos = ref<{ left: string; top: string } | null>(null);
	/** Pointer placement: where the menu was opened (viewport px). */
	let at = { x: 0, y: 0 };

	/** The open tab (tabs only); the menu opens on the first. */
	const tab = ref(0);
	const currentTab = computed(() =>
		props.tabs?.length ? props.tabs[Math.min(tab.value, props.tabs.length - 1)] : null
	);
	const shown = computed(() => currentTab.value?.items ?? props.items);

	/** Tile layout: items grouped under their section headers (separators are dropped). */
	const groups = computed(() => {
		const out: { section?: string; items: MenuItem[] }[] = [];
		let group: (typeof out)[number] | undefined;
		for (const item of shown.value) {
			if (item.separator) continue;
			if (item.section !== undefined || !group) out.push((group = { section: item.section, items: [] }));
			if (item.section === undefined) group.items.push(item);
		}
		return out;
	});

	function onDocDown(e: PointerEvent): void {
		const t = e.target as Node;
		if (!root.value?.contains(t) && !list.value?.contains(t)) close();
	}
	function onKey(e: KeyboardEvent): void {
		if (e.key === 'Escape') close();
	}
	/** The pinned popover would drift from its trigger, so scrolling anything but the popover itself closes it. */
	function onScroll(e: Event): void {
		if (!list.value?.contains(e.target as Node)) close();
	}

	/**
	 * Pin the popover just right of the trigger, top-aligned (under it, right-aligned, for "under"; or at the pointer),
	 * nudged back inside the viewport.
	 */
	function place(): void {
		const t = trigger.value?.getBoundingClientRect();
		const el = list.value;
		if (!el) return;
		const anchor =
			props.placement === 'pointer'
				? at
				: props.placement === 'under'
					? t && { x: t.right - el.offsetWidth, y: t.bottom + 2 }
					: t && { x: t.right + 6, y: t.top };
		if (!anchor) return;
		const m = 8;
		const left = Math.max(m, Math.min(anchor.x, innerWidth - m - el.offsetWidth));
		const top = Math.max(m, Math.min(anchor.y, innerHeight - m - el.offsetHeight));
		pos.value = { left: `${left}px`, top: `${top}px` };
	}

	async function show(): Promise<void> {
		tab.value = 0;
		open.value = true;
		document.addEventListener('pointerdown', onDocDown, true);
		document.addEventListener('keydown', onKey);
		if (floating.value) {
			window.addEventListener('resize', close);
			window.addEventListener('scroll', onScroll, true);
		}
		await nextTick();
		if (floating.value) {
			place();
			await nextTick();
		}
		(list.value?.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus();
	}

	async function toggle(): Promise<void> {
		if (open.value) return close();
		await show();
	}

	/** Pointer placement: open the menu at a viewport point, or move it there when it is already open. */
	async function openAt(x: number, y: number): Promise<void> {
		close();
		at = { x, y };
		await show();
	}

	function close(): void {
		open.value = false;
		pos.value = null;
		document.removeEventListener('pointerdown', onDocDown, true);
		document.removeEventListener('keydown', onKey);
		window.removeEventListener('resize', close);
		window.removeEventListener('scroll', onScroll, true);
	}

	function run(item: MenuItem): void {
		close();
		item.action?.();
	}

	function runContext(item: MenuItem): void {
		if (!item.context || item.disabled) return;
		close();
		item.context();
	}

	// Another tab may be taller or shorter: keep a floating menu inside the viewport.
	watch(tab, async () => {
		if (!open.value || !floating.value) return;
		await nextTick();
		place();
	});

	onBeforeUnmount(close);
	defineExpose({ toggle, close, openAt });
</script>

<template>
	<div ref="root" class="dm">
		<button
			v-if="placement !== 'pointer'"
			ref="trigger"
			type="button"
			:class="[triggerClass, { open }]"
			:aria-expanded="open"
			:aria-label="ariaLabel"
			aria-haspopup="menu"
			@click="toggle">
			<slot>{{ label }}</slot>
		</button>
		<Teleport to="body" :disabled="!floating">
			<div
				v-if="open"
				ref="list"
				class="pop"
				:class="[
					floating ? (placement === 'pointer' ? 'pointer' : placement === 'under' ? 'under' : 'side') : align,
					{ tiled: layout === 'tiles' }
				]"
				:style="floating ? (pos ?? { visibility: 'hidden' }) : undefined"
				role="menu"
				@contextmenu.prevent>
				<template v-if="layout === 'tiles'">
					<div v-if="tabs?.length" class="tabs" role="tablist">
						<button
							v-for="(t, ti) in tabs"
							:key="t.label"
							type="button"
							role="tab"
							class="tabbtn"
							:class="{ on: ti === tab }"
							:aria-selected="ti === tab"
							@click="tab = ti">
							{{ t.label }}
						</button>
					</div>
					<p v-if="currentTab && !groups.length" class="empty">{{ currentTab.empty ?? 'Nothing here yet.' }}</p>
					<div v-for="(g, gi) in groups" :key="gi" role="group" :aria-label="g.section">
						<div v-if="g.section" class="section">{{ g.section }}</div>
						<div class="tileset">
							<button
								v-for="(item, i) in g.items"
								:key="i"
								v-tip:top="item.hint ? { title: item.label, body: item.hint } : null"
								type="button"
								role="menuitem"
								class="tile"
								:disabled="item.disabled"
								:style="item.hue ? { '--hue': item.hue } : undefined"
								@click="run(item)"
								@contextmenu="runContext(item)">
								<span class="thumb">
									<img v-if="item.image" :src="item.image" alt="" />
									<component :is="item.icon ?? IconSquareRotated" v-else :size="22" />
								</span>
								<span class="tlbl">{{ item.label }}</span>
							</button>
						</div>
					</div>
				</template>
				<template v-for="(item, i) in items" v-else :key="i">
					<div v-if="item.separator" class="sep" />
					<div v-else-if="item.section" class="section">{{ item.section }}</div>
					<button
						v-else
						v-tip:right="item.hint"
						type="button"
						role="menuitem"
						class="item"
						:disabled="item.disabled"
						@click="run(item)"
						@contextmenu="runContext(item)">
						<span
							class="tick"
							:style="item.hue ? { borderColor: item.hue } : undefined"
							:class="{ hue: !!item.hue, checked: item.checked }" />
						<span class="lbl">{{ item.label }}</span>
						<span v-if="item.shortcut" class="sc">{{ item.shortcut }}</span>
					</button>
				</template>
			</div>
		</Teleport>
	</div>
</template>

<style scoped>
	.dm {
		position: relative;
		display: inline-flex;
	}
	/* Menu-bar items are plates, not keys (Forged keys v2): open goes Sunken with a flat Ember 400 underline. */
	.menu-trigger {
		position: relative;
		height: 28px;
		padding: 0 10px;
		border: 0;
		border-radius: 3px;
		background: transparent;
		color: var(--text);
	}
	.menu-trigger:hover {
		background: var(--raised);
		color: var(--text-hi);
	}
	.menu-trigger.open {
		background: var(--sunken);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--text-hi);
	}
	.menu-trigger.open::after {
		content: '';
		position: absolute;
		left: 6px;
		right: 6px;
		bottom: 0;
		height: 2px;
		background: var(--e400);
	}
	.pop {
		position: absolute;
		top: calc(100% + 2px);
		z-index: 100;
		min-width: 220px;
		max-height: 70vh;
		overflow-y: auto;
		padding: 4px 0;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--r-field);
		box-shadow: 0 8px 24px rgba(8, 9, 10, 0.55);
	}
	.pop.left {
		left: 0;
	}
	.pop.right {
		right: 0;
	}
	.pop.side,
	.pop.under,
	.pop.pointer {
		position: fixed;
		max-height: calc(100vh - 16px);
	}
	.pop.side {
		width: min(80vw, 800px);
	}
	.pop.pointer {
		min-width: 160px;
	}
	.pop.under.tiled {
		width: min(calc(100vw - 16px), 356px);
	}
	.pop.tiled {
		padding: 2px 12px 12px;
	}
	.tiled .section {
		padding: 10px 0 6px;
	}
	/* Tabs over the tiles: stay in view while the tiles scroll. */
	.tabs {
		position: sticky;
		top: -2px;
		z-index: 1;
		display: flex;
		gap: 2px;
		margin: 0 -12px;
		padding: 8px 12px 0;
		background: var(--panel);
		border-bottom: 1px solid var(--hairline);
	}
	.tabbtn {
		height: 26px;
		padding: 0 12px;
		border: 0;
		border-bottom: 2px solid transparent;
		background: transparent;
		color: var(--text-lo);
		font-size: 12px;
	}
	.tabbtn:hover {
		color: var(--text-hi);
	}
	.tabbtn.on {
		color: var(--text-hi);
		border-bottom-color: var(--e400);
	}
	.empty {
		margin: 14px 0 2px;
		max-width: 52ch;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-lo);
	}
	.tileset {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		gap: 6px;
	}
	.tile {
		--hue: var(--line);
		width: 76px;
		aspect-ratio: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 6px 4px 5px;
		border: 1px solid var(--hue);
		border-radius: var(--r-field);
		background: var(--sunken);
		color: var(--text);
		overflow: hidden;
	}
	.tile:hover:not(:disabled),
	.tile:focus-visible {
		background: var(--raised);
		color: var(--text-hi);
		outline: none;
		box-shadow: 0 0 0 1px var(--hue);
	}
	.tile:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.thumb {
		flex: 1;
		min-height: 0;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--hue);
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 2px;
	}
	.tlbl {
		width: 100%;
		height: 2.4em; /* always two lines, so every tile's thumbnail is the same size */
		flex: none;
		font-size: 10.5px;
		line-height: 1.2;
		text-align: center;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.item {
		width: 100%;
		height: 24px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 12px 0 8px;
		border: 0;
		background: transparent;
		color: var(--text);
		text-align: left;
		font-size: 13px;
	}
	.item:hover:not(:disabled),
	.item:focus-visible {
		background: var(--raised);
		color: var(--text-hi);
		outline: none;
		box-shadow: inset 2px 0 0 var(--accent);
	}
	.item:disabled {
		color: var(--line-strong);
		cursor: default;
	}
	.tick {
		width: 8px;
		height: 8px;
		flex: none;
	}
	.tick.hue {
		border: 1.5px solid;
	}
	.tick.checked {
		background: var(--e400);
		transform: rotate(45deg) scale(0.8);
	}
	.lbl {
		flex: 1;
		white-space: nowrap;
	}
	.sc {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-lo);
	}
	.section {
		padding: 8px 12px 3px 24px;
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-lo);
	}
	.sep {
		height: 1px;
		margin: 4px 8px;
		background: var(--hairline);
	}
</style>
