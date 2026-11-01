// What can be done to a layer, group, light or post filter from its inspector heading (Properties.vue's studs) and
// from its Outliner row's right-click menu: one list, so the buttons and the menu stay in step.

import type { Component } from 'vue';
import { IconArrowDown, IconArrowUp, IconCopy, IconLock, IconLockOpen, IconStack2, IconTrash } from '@tabler/icons-vue';
import { layerUnits, MAX_LIGHTS } from '@/core/project';
import { useProjectStore } from '@/stores/project';
import { useEditorStore } from '@/stores/editor';
import { useActions } from '@/ui/actions';
import type { MenuItem } from '@/ui/components/DropMenu.vue';
import type { Tip } from '@/ui/tooltip';

export type ItemKind = 'layer' | 'group' | 'light' | 'post';

export interface ItemAction {
	id: 'lock' | 'up' | 'down' | 'ungroup' | 'duplicate' | 'delete';
	/** The menu's wording. */
	label: string;
	/** The stud's tooltip; its `keys` are the menu's shortcut too. */
	tip: Tip;
	/** The stud's accessible name. */
	aria: string;
	icon: Component;
	/** The menu's hint (the reason when it is disabled). */
	hint?: string;
	disabled?: boolean;
	/** Switched on (Lock). */
	latched?: boolean;
	/** Inked crimson (Delete). */
	danger?: boolean;
	/** Set apart from the studs before it (a separator in the menu). */
	gapBefore?: boolean;
	run: () => void;
}

export function useItemActions() {
	const store = useProjectStore();
	const editor = useEditorStore();
	const act = useActions();

	/** Whether layer or group `id` can move a step (`dir` −1 up, +1 down) in its list (a member, in its group). */
	function canStep(id: string, dir: number): boolean {
		const at = store.unitOf(id);
		if (!at) return false;
		if (at.unit.group && at.unit.group.id !== id) {
			const i = at.unit.layers.findIndex((x) => x.id === id) + dir;
			return i >= 0 && i < at.unit.layers.length;
		}
		const j = at.index + dir;
		return j >= 0 && j < layerUnits(store.project.layers, store.project.groups).length;
	}

	const moves = (noun: string, can: (dir: number) => boolean, step: (dir: number) => void, later: string) =>
		[
			{
				id: 'up',
				label: 'Move up',
				tip: { body: 'Move up: applied earlier' },
				aria: `Move ${noun} up`,
				icon: IconArrowUp,
				disabled: !can(-1),
				gapBefore: true,
				run: () => step(-1)
			},
			{
				id: 'down',
				label: 'Move down',
				tip: { body: `Move down: ${later}` },
				aria: `Move ${noun} down`,
				icon: IconArrowDown,
				disabled: !can(1),
				run: () => step(1)
			}
		] satisfies ItemAction[];

	const duplicate = (noun: string, full = false): ItemAction => ({
		id: 'duplicate',
		label: 'Duplicate',
		tip: { body: full ? `At most ${MAX_LIGHTS} lights` : 'Duplicate', keys: 'Ctrl D' },
		aria: `Duplicate ${noun}`,
		icon: IconCopy,
		hint: full ? `At most ${MAX_LIGHTS} lights` : undefined,
		disabled: full,
		gapBefore: true,
		run: act.duplicateSelection
	});

	const remove = (noun: string, what = 'Delete'): ItemAction => ({
		id: 'delete',
		label: 'Delete',
		tip: { body: what, keys: 'Del' },
		aria: `Delete ${noun}`,
		icon: IconTrash,
		hint: what === 'Delete' ? undefined : what,
		danger: true,
		run: act.deleteSelection
	});

	/** The actions of item `id` of `kind`, in the heading's order. */
	function actions(kind: ItemKind, id: string): ItemAction[] {
		if (kind === 'layer') {
			const layer = store.getLayer(id);
			if (!layer) return [];
			return [
				{
					id: 'lock',
					label: layer.locked ? 'Unlock' : 'Lock',
					tip: {
						body: layer.locked
							? 'Locked: the optimiser leaves this layer alone. Click to unlock'
							: 'Lock from the optimiser: it will not change this layer'
					},
					aria: 'Lock from the optimiser',
					icon: layer.locked ? IconLock : IconLockOpen,
					hint: 'The optimiser leaves a locked layer alone',
					latched: !!layer.locked,
					run: () => store.updateLayer(id, { locked: !layer.locked })
				},
				...moves(
					'layer',
					(d) => canStep(id, d),
					(d) => store.stepLayer(id, d),
					'applied later, over more'
				),
				duplicate('layer'),
				remove('layer')
			];
		}
		if (kind === 'group') {
			if (!store.getGroup(id)) return [];
			return [
				...moves(
					'group',
					(d) => canStep(id, d),
					(d) => store.stepLayer(id, d),
					'applied later, over more'
				),
				{
					id: 'ungroup',
					label: 'Ungroup',
					tip: { body: 'Ungroup: keep the layers, drop the group' },
					aria: 'Ungroup',
					icon: IconStack2,
					hint: 'Keep the layers, drop the group (its limit moves onto them)',
					gapBefore: true,
					run: () => {
						const first = store.getGroup(id)?.members[0];
						store.ungroup(id);
						editor.select(first ? 'layer' : 'project', first);
					}
				},
				remove('group', 'Delete the group and its layers')
			];
		}
		if (kind === 'light') {
			if (!store.getLight(id)) return [];
			return [duplicate('light', store.project.lighting.lights.length >= MAX_LIGHTS), remove('light')];
		}
		const list = store.project.post;
		const i = list.findIndex((f) => f.id === id);
		if (i < 0) return [];
		return [
			...moves(
				'filter',
				(d) => i + d >= 0 && i + d < list.length,
				(d) => store.movePost(id, i + d),
				'applied later'
			),
			duplicate('filter'),
			remove('filter')
		];
	}

	/** `actions` as right-click menu items: the same labels, states and shortcuts, a separator for each gap. */
	function menuItems(kind: ItemKind, id: string): MenuItem[] {
		return actions(kind, id).flatMap((a, i): MenuItem[] => [
			...(a.gapBefore && i > 0 ? [{ separator: true }] : []),
			{
				label: a.label,
				shortcut: a.tip.keys?.replace(/ /g, '+'),
				disabled: a.disabled,
				hint: a.hint,
				action: a.run
			}
		]);
	}

	return { actions, menuItems, canStep };
}
