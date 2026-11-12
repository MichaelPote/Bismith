// A variant's right-click menu (FR10), shared by the Variants panel and the Variants workspace's cards: new variants
// from it, rename, its changes, make base, reset, browse, delete. Renaming and deleting are the caller's (in place, and
// asked under the row or card: useAnchoredAsk, deleteVariantQuestion).

import { computed, ref } from 'vue';
import type { ProjectVariant } from '@/core/variants';
import { useEditorStore, type Question } from '@/stores/editor';
import { useProjectStore } from '@/stores/project';
import type { MenuItem } from '@/ui/components/DropMenu.vue';

/** How many settings a variant changes from the base. */
export const changeCount = (v: ProjectVariant) => Object.keys(v.changes).length;

/** The project's variants, its base's id and the shown one's. */
export function useVariantList() {
	const store = useProjectStore();
	return {
		list: computed(() => store.variants.list),
		baseId: computed(() => store.variants.baseId),
		activeId: computed(() => store.variants.activeId)
	};
}

/**
 * A question asked under a row or card (AnchoredAsk): `ask` shows it and resolves to the choice (null: cancelled);
 * meanwhile `asking` holds what the AnchoredAsk shows.
 */
export function useAnchoredAsk() {
	const asking = ref<{ question: Question; anchor: HTMLElement; answer: (id: string | null) => void } | null>(null);
	function ask(anchor: HTMLElement, question: Question): Promise<string | null> {
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
	return { asking, ask };
}

/** What deleting a variant asks: a note for the base (another must become the base first), else Delete or Cancel. */
export function deleteVariantQuestion(v: ProjectVariant, baseId: string): Question {
	if (v.id === baseId)
		return {
			title: `${v.name} is the base`,
			detail: 'Make another variant the base first. The others keep their looks.',
			choices: []
		};
	const n = changeCount(v);
	return {
		title: `Delete ${v.name}?`,
		detail: `${n ? `Its ${n} changed setting${n === 1 ? '' : 's'} go. ` : ''}The layers stay. Undo brings it back.`,
		choices: [{ id: 'delete', label: 'Delete', primary: true }]
	};
}

export function variantMenuItems(v: ProjectVariant, h: { rename: () => void; remove: () => void }): MenuItem[] {
	const store = useProjectStore();
	const editor = useEditorStore();
	const vs = store.variants;
	const base = vs.list.find((x) => x.id === vs.baseId);
	const baseName = base?.name ?? 'the base';
	const isBase = v.id === vs.baseId;
	const n = changeCount(v);
	const several = vs.list.length > 1;
	return [
		{ label: `New variant from ${v.name}`, action: () => store.addVariant(v.id) },
		...(isBase ? [] : [{ label: `New variant from ${baseName} (base)`, action: () => store.addVariant(vs.baseId) }]),
		{ separator: true },
		{ label: 'Rename', shortcut: 'F2', action: h.rename },
		...(several ? [{ label: 'Changes…', action: () => (editor.variantChanges = v.id) }] : []),
		...(isBase
			? []
			: [
					{
						label: 'Make base',
						hint: 'The others are measured from it; every variant keeps its look',
						action: () => store.makeBase(v.id)
					},
					{
						label: n ? `Reset all ${n} change${n === 1 ? '' : 's'} to ${baseName}` : `Reset to ${baseName}`,
						disabled: !n,
						action: () => store.resetVariant(v.id)
					}
				]),
		{ separator: true },
		{ label: 'Export…', action: () => (editor.exportDialog = { variants: [v.id] }) },
		...(editor.workspace === 'variants'
			? []
			: [{ label: 'Browse all variants', action: () => (editor.workspace = 'variants') }, { separator: true }]),
		{ label: `Delete ${v.name}…`, shortcut: 'Del', disabled: !several, action: h.remove }
	];
}
