// Resizable panels: a size kept in localStorage, and the gutter drag that changes it.

import { ref, type Ref } from 'vue';

/**
 * A size (px) kept in localStorage under `key`: `def` when none is stored (or it isn't positive). Returns the ref and
 * the function that stores it, called once a drag ends rather than on every move; 0 removes the key.
 */
export function useStoredNumber(key: string, def: number): [Ref<number>, () => void] {
	let start = def;
	try {
		const v = Number(localStorage.getItem(key));
		if (v > 0) start = v;
	} catch {
		/* storage unavailable */
	}
	const value = ref(start);
	const save = () => {
		try {
			if (value.value > 0) localStorage.setItem(key, String(value.value));
			else localStorage.removeItem(key);
		} catch {
			/* storage unavailable */
		}
	};
	return [value, save];
}

/**
 * Drags a gutter from its pointerdown: captures the pointer on it and calls `onMove` with each move, then `onEnd` once
 * the button is released or the drag cancelled.
 */
export function dragGutter(e: PointerEvent, onMove: (e: PointerEvent) => void, onEnd?: () => void): void {
	const el = e.currentTarget as HTMLElement;
	el.setPointerCapture(e.pointerId);
	const up = () => {
		el.removeEventListener('pointermove', onMove);
		el.removeEventListener('pointerup', up);
		el.removeEventListener('pointercancel', up);
		onEnd?.();
	};
	el.addEventListener('pointermove', onMove);
	el.addEventListener('pointerup', up);
	el.addEventListener('pointercancel', up);
}
