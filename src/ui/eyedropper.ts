// Eyedropper: while a colour picker is open, clicking any surface that shows colours takes its colour into the picker,
// which stays open for more. A surface registers a sampler with `v-pick` — a function from a pointer event to the hex
// under it, null where there is nothing to take — and hovering it shows that colour beside the cursor (EyedropperChip).
// The click is swallowed, so the surface doesn't react to it too (a ramp would add a stop, the viewport would pan).
// Presses on anything else behave as usual; outside the picker they close it.
// Samplers read the data behind a surface (ramp stops, texels, image pixels), not the screen, so a pick is the exact
// sRGB value whatever colour management the browser applies on the way to the display.

import { reactive, type Directive } from 'vue';

export type Sampler = (e: MouseEvent) => string | null;

const samplers = new WeakMap<Element, Sampler>();

function bind(el: HTMLElement, s: Sampler | null | undefined): void {
	if (s) {
		samplers.set(el, s);
		el.dataset.pick = '';
	} else {
		samplers.delete(el);
		delete el.dataset.pick;
	}
}

/** `v-pick="sampler"` makes an element (and everything inside it) a source for the eyedropper; null turns it off. */
export const vPick: Directive<HTMLElement, Sampler | null | undefined> = {
	mounted: (el, b) => bind(el, b.value),
	updated: (el, b) => bind(el, b.value),
	unmounted: (el) => bind(el, null)
};

/** The open picker's session: whether there is one, and the colour under the pointer and where it is (client px). */
export const pick = reactive({ active: false, hex: null as string | null, x: 0, y: 0 });

interface Session {
	/** The picker and its field: presses inside them are left alone. */
	owners: HTMLElement[];
	onPick: (hex: string) => void;
}
let session: Session | null = null;
/**
 * After a pick's press, the rest of that click (release, click, the second click of a double click) is swallowed too.
 * Until this time (ms), or while the button is still down (Infinity).
 */
let quietUntil = 0;
const QUIET_MS = 300;

function sample(e: MouseEvent): string | null {
	const el = (e.target as Element | null)?.closest?.('[data-pick]');
	const s = el ? samplers.get(el) : undefined;
	return s ? s(e) : null;
}

function block(e: Event): void {
	e.preventDefault();
	e.stopPropagation();
}

// One sample per frame while the pointer moves: the viewport's sampler reads a texel back from the GPU.
let moved: PointerEvent | null = null;
let raf = 0;
function onMove(e: PointerEvent): void {
	if (!session) return;
	pick.x = e.clientX;
	pick.y = e.clientY;
	moved = e;
	raf ||= requestAnimationFrame(() => {
		raf = 0;
		if (session && moved) pick.hex = sample(moved);
	});
}

function onDown(e: PointerEvent): void {
	const t = e.target as Element;
	if (!session || e.button !== 0 || !t.closest?.('[data-pick]') || session.owners.some((o) => o.contains(t))) return;
	block(e);
	quietUntil = Infinity;
	const hex = sample(e);
	pick.hex = hex;
	if (hex) session.onPick(hex);
}

function onUp(e: PointerEvent): void {
	if (performance.now() >= quietUntil) return;
	block(e);
	if (quietUntil === Infinity) quietUntil = performance.now() + QUIET_MS;
}

function onClick(e: MouseEvent): void {
	if (performance.now() < quietUntil) block(e);
}

let installed = false;
function install(): void {
	if (installed) return;
	installed = true;
	// Capture on window: before every handler of the page, the pickers' own outside-press checks included.
	const opts = { capture: true };
	window.addEventListener('pointermove', onMove, opts);
	window.addEventListener('pointerdown', onDown, opts);
	window.addEventListener('pointerup', onUp, opts);
	window.addEventListener('pointercancel', onUp, opts);
	for (const type of ['mousedown', 'mouseup', 'click', 'auxclick', 'dblclick'])
		window.addEventListener(type, onClick as EventListener, opts);
}

/**
 * Pick for an open picker until the returned function is called: `onPick` gets each colour clicked. A newer session
 * (another picker opening) replaces this one, and stopping this one then does nothing.
 */
export function startPick(owners: HTMLElement[], onPick: (hex: string) => void): () => void {
	install();
	const s: Session = { owners, onPick };
	session = s;
	pick.active = true;
	pick.hex = null;
	document.documentElement.classList.add('picking');
	return () => {
		if (session !== s) return;
		session = null;
		pick.active = false;
		pick.hex = null;
		document.documentElement.classList.remove('picking');
	};
}

/** The hex of an 8-bit RGBA pixel. */
export function pixelHex(px: ArrayLike<number>, i: number): string {
	return '#' + [px[i], px[i + 1], px[i + 2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
