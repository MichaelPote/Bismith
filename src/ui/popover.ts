// Popovers (menus, the colour picker, anchored questions): what closes or moves one while it is open — a press outside
// it, Esc, the window resizing, a scroll outside it — and where it fits in the viewport.

import { onBeforeUnmount, type Ref } from 'vue';

export interface PopoverOptions {
	/** The popover: a press or a scroll inside it is its own. */
	popover: Ref<HTMLElement | null>;
	/** Other elements a press on doesn't count as outside (its trigger). */
	keep?: Ref<HTMLElement | null>;
	/**
	 * A press outside: heard on the document in the capture phase, before what was pressed hears it, and after the
	 * eyedropper (ui/eyedropper.ts) has taken a press that picks a colour.
	 */
	onOutside: () => void;
	/** Esc, on the document in the capture phase (to handle it on the popover instead, leave this out). */
	onEscape?: (e: KeyboardEvent) => void;
	onResize?: () => void;
	/** A scroll of anything but the popover (a pinned popover would drift from its anchor). */
	onScroll?: () => void;
}

/** The listeners of an open popover: `listen` when it opens, `unlisten` when it closes (and on unmount). */
export function usePopover(o: PopoverOptions): { listen: () => void; unlisten: () => void } {
	const onDown = (e: PointerEvent) => {
		const t = e.target as Node;
		if (!o.popover.value?.contains(t) && !o.keep?.value?.contains(t)) o.onOutside();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') o.onEscape?.(e);
	};
	const onResize = () => o.onResize?.();
	const onScroll = (e: Event) => {
		if (!o.popover.value?.contains(e.target as Node)) o.onScroll?.();
	};
	function listen(): void {
		document.addEventListener('pointerdown', onDown, true);
		if (o.onEscape) document.addEventListener('keydown', onKey, true);
		if (o.onResize) window.addEventListener('resize', onResize);
		if (o.onScroll) window.addEventListener('scroll', onScroll, true);
	}
	function unlisten(): void {
		document.removeEventListener('pointerdown', onDown, true);
		document.removeEventListener('keydown', onKey, true);
		window.removeEventListener('resize', onResize);
		window.removeEventListener('scroll', onScroll, true);
	}
	onBeforeUnmount(unlisten);
	return { listen, unlisten };
}

/** A popover's left (`x`) or top (`y`) edge, moved so its `size` stays `margin` inside the viewport. */
export function inViewport(at: number, size: number, axis: 'x' | 'y', margin = 8): number {
	const room = axis === 'x' ? innerWidth : innerHeight;
	return Math.max(margin, Math.min(at, room - margin - size));
}
