<script setup lang="ts">
	// The Variants panel above the Outliner (docs/features/fr10-variants.md): the project's variants with their
	// thumbnails; click one to show it, right-click for the rest. Rename in place (double-click or F2); deleting asks
	// under the row.
	import { computed, nextTick, ref, watch } from 'vue';
	import { IconPlus, IconTrash, IconVersions } from '@tabler/icons-vue';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore, type Question } from '@/stores/editor';
	import type { ProjectVariant } from '@/core/variants';
	import DropMenu, { type MenuItem } from '@/ui/components/DropMenu.vue';
	import AnchoredAsk from '@/ui/components/AnchoredAsk.vue';
	import { useVariantThumbs } from '@/ui/variantThumbs';
	import { variantMenuItems } from '@/ui/variantMenu';
	import { vTip } from '@/ui/tooltip';

	const store = useProjectStore();
	const editor = useEditorStore();
	const thumbs = useVariantThumbs();

	const list = computed(() => store.variants.list);
	const baseId = computed(() => store.variants.baseId);
	const activeId = computed(() => store.variants.activeId);
	const baseName = computed(() => list.value.find((v) => v.id === baseId.value)?.name ?? 'the base');
	const count = (v: ProjectVariant) => Object.keys(v.changes).length;

	const listEl = ref<HTMLElement | null>(null);
	const rowEl = (id: string) => listEl.value?.querySelector<HTMLElement>(`[data-variant="${id}"]`) ?? null;

	// ---------------------------------------------------------------- rename
	const renaming = ref<string | null>(null);
	const renameText = ref('');
	const renameInput = ref<HTMLInputElement[] | null>(null);

	async function startRename(v: ProjectVariant): Promise<void> {
		renaming.value = v.id;
		renameText.value = v.name;
		await nextTick();
		renameInput.value?.[0]?.focus();
		renameInput.value?.[0]?.select();
	}

	watch(
		() => editor.variantRename,
		(id) => {
			const v = id && list.value.find((x) => x.id === id);
			editor.variantRename = null;
			if (v) void startRename(v);
		}
	);

	function finishRename(apply: boolean): void {
		const id = renaming.value;
		renaming.value = null;
		if (apply && id && renameText.value.trim()) store.renameVariant(id, renameText.value);
		listEl.value?.focus();
	}

	// ---------------------------------------------------------------- delete
	const asking = ref<{ question: Question; anchor: HTMLElement; answer: (id: string | null) => void } | null>(null);

	function ask(id: string, question: Question): Promise<string | null> {
		const anchor = rowEl(id);
		if (!anchor) return Promise.resolve(null);
		return new Promise((resolve) => {
			asking.value = {
				question,
				anchor,
				answer: (choice) => {
					asking.value = null;
					resolve(choice);
				}
			};
		});
	}

	async function confirmDelete(id: string): Promise<void> {
		const v = list.value.find((x) => x.id === id);
		if (!v || list.value.length < 2) return;
		if (id === baseId.value) {
			await ask(id, {
				title: `${v.name} is the base`,
				detail: 'Make another variant the base first. The others keep their looks.',
				choices: []
			});
			return;
		}
		const n = count(v);
		const choice = await ask(id, {
			title: `Delete ${v.name}?`,
			detail: `${n ? `Its ${n} changed setting${n === 1 ? '' : 's'} go. ` : ''}The layers stay. Undo brings it back.`,
			choices: [{ id: 'delete', label: 'Delete', primary: true }]
		});
		if (choice === 'delete') store.deleteVariant(id);
	}

	// ---------------------------------------------------------------- menu
	const menu = ref<InstanceType<typeof DropMenu> | null>(null);
	const menuItems = ref<MenuItem[]>([]);

	function onMenu(e: MouseEvent, v: ProjectVariant): void {
		menuItems.value = variantMenuItems(v, {
			rename: () => void startRename(v),
			remove: () => void confirmDelete(v.id)
		});
		menu.value?.openAt(e.clientX, e.clientY);
	}

	// ---------------------------------------------------------------- keys (while the list has focus)
	function onKey(e: KeyboardEvent): void {
		if (renaming.value) return;
		const v = list.value.find((x) => x.id === activeId.value);
		if (!v) return;
		if (e.key === 'F2') {
			e.preventDefault();
			void startRename(v);
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			// The panel's own: the selection in the outliner stays.
			e.preventDefault();
			e.stopPropagation();
			void confirmDelete(v.id);
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			store.stepVariant(e.key === 'ArrowUp' ? -1 : 1);
		}
	}
</script>

<template>
	<section class="variants cf-panel" aria-label="Variants">
		<div class="head">
			<span class="cf-label">Variants</span>
			<span class="count cf-mono">{{ list.length }}</span>
			<span class="grow" />
			<button
				v-tip="'New variant from the one shown'"
				type="button"
				class="fk add"
				aria-label="New variant"
				@click="store.addVariant()">
				<span class="fk-face"><IconPlus :size="13" /></span>
			</button>
			<button
				v-tip="'Delete the variant shown'"
				type="button"
				class="cf-ico-btn"
				aria-label="Delete variant"
				:disabled="list.length < 2"
				@click="confirmDelete(activeId)">
				<IconTrash :size="14" />
			</button>
			<button
				v-tip="'Browse all variants'"
				type="button"
				class="cf-ico-btn"
				aria-label="Browse all variants"
				:class="{ latched: editor.workspace === 'variants' }"
				@click="editor.workspace = 'variants'">
				<IconVersions :size="14" />
			</button>
		</div>
		<div ref="listEl" class="list" role="listbox" aria-label="Variants" tabindex="0" @keydown="onKey">
			<div
				v-for="v in list"
				:key="v.id"
				:data-variant="v.id"
				class="row"
				:class="{ sel: v.id === activeId }"
				role="option"
				:aria-selected="v.id === activeId"
				@click="store.switchVariant(v.id)"
				@contextmenu.prevent="onMenu($event, v)">
				<img v-if="thumbs.url(v.id)" class="thumb" :src="thumbs.url(v.id)" alt="" />
				<span v-else class="thumb empty" />
				<input
					v-if="renaming === v.id"
					ref="renameInput"
					v-model="renameText"
					class="rename"
					aria-label="Variant name"
					@click.stop
					@contextmenu.stop
					@keydown.stop.enter="finishRename(true)"
					@keydown.stop.esc="finishRename(false)"
					@blur="finishRename(true)" />
				<span v-else class="name" @dblclick.stop="startRename(v)">{{ v.name }}</span>
				<span v-if="list.length > 1 && v.id === baseId" class="badge">Base</span>
				<span v-else-if="count(v)" v-tip:right="`Changes ${count(v)} settings from ${baseName}`" class="changes cf-mono"
					>◆ {{ count(v) }}</span
				>
			</div>
		</div>
		<div class="foot"><span class="kc">Alt [</span><span class="kc">Alt ]</span> step · right-click for more</div>
		<DropMenu ref="menu" :items="menuItems" placement="pointer" />
		<AnchoredAsk v-if="asking" :question="asking.question" :anchor="asking.anchor" @answer="asking.answer" />
	</section>
</template>

<style scoped>
	.variants {
		display: flex;
		flex-direction: column;
		flex: none;
		overflow: hidden;
		user-select: none;
		-webkit-user-select: none;
	}
	.head {
		height: 28px;
		flex: none;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 4px 0 10px;
		border-bottom: 1px solid var(--hairline);
	}
	.count {
		font-size: 11px;
		color: var(--line-strong);
	}
	.grow {
		flex: 1;
	}
	.head .fk.add {
		width: 24px;
		height: 22px;
	}
	.head .fk.add > .fk-face {
		padding: 0;
	}
	.list {
		display: flex;
		flex-direction: column;
		padding: 4px 0;
		max-height: calc(7 * 32px + 8px);
		overflow-y: auto;
		outline: none;
	}
	.list:focus-visible {
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 9px;
		height: 32px;
		flex: none;
		padding: 0 10px 0 8px;
		color: var(--text);
		font-size: 13px;
		cursor: default;
	}
	.row:hover {
		background: var(--raised);
	}
	/* The variant shown: the outliner's selection. */
	.row.sel,
	.row.sel:hover {
		background: linear-gradient(rgba(246, 110, 16, 0.15), rgba(246, 110, 16, 0.15)), var(--raised);
		box-shadow:
			inset 2px 0 0 var(--e500),
			inset 0 1px 0 rgba(255, 144, 25, 0.12),
			inset 0 -1px 0 rgba(255, 144, 25, 0.12);
		color: var(--text-hi);
	}
	.thumb {
		width: 40px;
		height: 24px;
		flex: none;
		object-fit: cover;
		border-radius: 2px;
		box-shadow: 0 0 0 1px var(--hairline);
	}
	.thumb.empty {
		background: var(--sunken);
	}
	.row.sel .thumb {
		box-shadow: 0 0 0 1px var(--e400);
	}
	.name {
		flex: 1;
		min-width: 0;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
	.badge {
		flex: none;
		height: 15px;
		padding: 0 4px;
		display: flex;
		align-items: center;
		border: 1px solid var(--gold);
		border-radius: 2px;
		font-size: 9px;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--gold);
	}
	.changes {
		flex: none;
		font-size: 11px;
		color: var(--text-lo);
	}
	.row.sel .changes {
		color: var(--e300);
	}
	.foot {
		height: 24px;
		flex: none;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 10px;
		border-top: 1px solid var(--hairline);
		font-size: 11px;
		color: var(--text-lo);
		white-space: nowrap;
		overflow: hidden;
	}
</style>
