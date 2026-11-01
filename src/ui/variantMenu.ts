// A variant's right-click menu (FR10), shared by the Variants panel and the Variants workspace's cards: new variants
// from it, rename, its changes, make base, reset, browse, delete. Renaming and deleting are the caller's (in place, and
// asked under the row or card).

import type { ProjectVariant } from '@/core/variants';
import { useEditorStore } from '@/stores/editor';
import { useProjectStore } from '@/stores/project';
import type { MenuItem } from '@/ui/components/DropMenu.vue';

export function variantMenuItems(v: ProjectVariant, h: { rename: () => void; remove: () => void }): MenuItem[] {
	const store = useProjectStore();
	const editor = useEditorStore();
	const vs = store.variants;
	const base = vs.list.find((x) => x.id === vs.baseId);
	const baseName = base?.name ?? 'the base';
	const isBase = v.id === vs.baseId;
	const n = Object.keys(v.changes).length;
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
		...(editor.workspace === 'variants'
			? []
			: [{ label: 'Browse all variants', action: () => (editor.workspace = 'variants') }, { separator: true }]),
		{ label: `Delete ${v.name}…`, shortcut: 'Del', disabled: !several, action: h.remove }
	];
}
