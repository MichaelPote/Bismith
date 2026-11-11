<script lang="ts">
	// Shared by every colour field: the picker's colour model (HSV or OKLCH), remembered across sessions, and the OKLCH hue
	// strip, built once.
	import { ref } from 'vue';
	import { oklchToSrgb, rgbToHex, srgbCusp } from '@/core/color';

	export type ColourModel = 'hsv' | 'oklch';

	const MODEL_KEY = 'cf-colour-model';

	function storedModel(): ColourModel {
		try {
			return localStorage.getItem(MODEL_KEY) === 'oklch' ? 'oklch' : 'hsv';
		} catch {
			return 'hsv';
		}
	}

	const sharedModel = ref<ColourModel>(storedModel());

	function setModel(m: ColourModel): void {
		sharedModel.value = m;
		try {
			localStorage.setItem(MODEL_KEY, m);
		} catch {
			// Storage blocked: the choice lasts the session.
		}
	}

	const HSV_HUES =
		'linear-gradient(to right, #f00 0%, #ff0 16.667%, #0f0 33.333%, #0ff 50%, #00f 66.667%, #f0f 83.333%, #f00 100%)';

	let oklchHues = '';
	/** Each OKLCH hue's most chromatic sRGB colour (the gamut's cusp), every 10°. */
	function oklchHueStrip(): string {
		if (!oklchHues) {
			const stops: string[] = [];
			for (let h = 0; h <= 360; h += 10) {
				const [l, c] = srgbCusp(h);
				stops.push(`${rgbToHex(oklchToSrgb([l, c, h]))} ${(h / 3.6).toFixed(3)}%`);
			}
			oklchHues = `linear-gradient(to right in oklab, ${stops.join(', ')})`;
		}
		return oklchHues;
	}
</script>

<script setup lang="ts">
	// Colour field: a swatch and an editable hex (selected whole on focus; a pasted colour applies at once). The swatch
	// opens a picker drawn in CSS, in HSV or OKLCH (a switch at its top, shared by every field):
	// - HSV: a saturation × value square over the hue, and a hue strip.
	// - OKLCH: a chroma × lightness square at the hue — only the part inside the sRGB gamut, the rest hatched — and a strip
	//   of each hue's most chromatic colour.
	// Below them: the numbers of the model, the colour the picker opened with (click to go back) and the hex with a copy
	// key. While the picker is open, a click on the texture, a ramp, palette or swatch in the sidebars, or a Match image
	// takes that colour, and the picker stays open (ui/eyedropper.ts). Drags, keys, typed values and picks update the
	// colour as they land (one drag is one undo step: App.vue's pointer gesture). The picker keeps its own coordinates, so the hue survives greys and black, and in OKLCH
	// the chroma asked for survives a trip through a hue or lightness with less room for it.
	// (`ref`, `rgbToHex`, `oklchToSrgb` and `srgbCusp` come from the module script above.)
	import { computed, nextTick, onBeforeUnmount, reactive, watch } from 'vue';
	import { IconCheck, IconCopy } from '@tabler/icons-vue';
	import { clamp01, hexToRgb, hsvToRgb, maxSrgbChroma, rgbToHsv, srgbToOklch } from '@/core/color';
	import { vTip, type TipValue } from '@/ui/tooltip';
	import { startPick, vPick } from '@/ui/eyedropper';

	const props = defineProps<{ modelValue: string; label?: string }>();
	const emit = defineEmits<{
		(e: 'update:modelValue', v: string): void;
	}>();

	function normalize(v: string): string | null {
		let h = v.trim().replace(/^#/, '').toLowerCase();
		if (h.length === 3)
			h = h
				.split('')
				.map((c) => c + c)
				.join('');
		return /^[0-9a-f]{6}$/.test(h) ? `#${h}` : null;
	}

	const model = sharedModel;
	const MODELS: { id: ColourModel; label: string; tip: TipValue }[] = [
		{ id: 'hsv', label: 'HSV', tip: 'Hue, saturation, value' },
		{
			id: 'oklch',
			label: 'OKLCH',
			tip: {
				title: 'OKLCH',
				body: 'Lightness, chroma and hue in OKLab: equal steps look equal. The square shows only the colours sRGB has.'
			}
		}
	];

	// ---------------------------------------------------------------- picker state
	/** OKLCH square: chroma across, 0 to a little past sRGB's most chromatic colour (magenta, 0.3225). */
	const CHROMA_MAX = 0.33;
	/** Below this a colour counts as grey (no hue), or as black / white (no chroma). */
	const ACHROMATIC = 1e-4;

	// HSV, each 0..1.
	const hsv = reactive({ h: 0, s: 0, v: 0 });
	// OKLCH: lightness 0..1, hue in degrees, and the chroma asked for — shown and sent clipped to the gamut.
	const lch = reactive({ l: 0, c: 0, h: 0 });
	const chroma = computed(() => Math.min(lch.c, maxSrgbChroma(lch.l, lch.h)));

	const hex = computed(() =>
		model.value === 'hsv'
			? rgbToHex(hsvToRgb([hsv.h, hsv.s, hsv.v]))
			: rgbToHex(oklchToSrgb([lch.l, chroma.value, lch.h]))
	);
	const hueHex = computed(() => rgbToHex(hsvToRgb([hsv.h, 1, 1])));
	const cuspHex = computed(() => {
		const [l, c] = srgbCusp(lch.h);
		return rgbToHex(oklchToSrgb([l, c, lch.h]));
	});
	/** The last colour sent or received, so a drag only emits when the hex actually moves. */
	let sent = '';

	/** Load a colour into the current model, keeping what its hex can't carry: greys have no hue; black (and in OKLCH
	 *  white) no saturation or chroma either. */
	function load(n: string): void {
		const rgb = hexToRgb(n);
		if (model.value === 'hsv') {
			const [h, s, v] = rgbToHsv(rgb);
			if (v > 0 && s > 0) hsv.h = h;
			if (v > 0) hsv.s = s;
			hsv.v = v;
		} else {
			const [l, c, h] = srgbToOklch(rgb);
			if (c > ACHROMATIC) lch.h = h;
			if (l > ACHROMATIC && l < 1 - ACHROMATIC) lch.c = c;
			lch.l = l;
		}
	}

	/** Take a colour from outside. */
	function adopt(v: string): void {
		const n = normalize(v);
		if (!n) return;
		sent = n;
		if (n !== hex.value) load(n);
	}

	const draft = ref(props.modelValue);
	adopt(props.modelValue);
	watch(
		() => props.modelValue,
		(v) => {
			draft.value = v;
			adopt(v);
		}
	);

	// Switching model reloads the colour; a grey takes its hue across from the other model.
	watch(model, (m) => {
		if (m === 'oklch') lch.h = srgbToOklch(hsvToRgb([hsv.h, 1, 1]))[2];
		else {
			const [l, c] = srgbCusp(lch.h);
			hsv.h = rgbToHsv(oklchToSrgb([l, c, lch.h]))[0];
		}
		if (sent) load(sent);
	});

	/** Send the picker's colour if it changed; true when it did. */
	function send(): boolean {
		if (hex.value === sent) return false;
		sent = hex.value;
		draft.value = sent;
		emit('update:modelValue', sent);
		return true;
	}

	function setHsv(h: number, s: number, v: number): boolean {
		hsv.h = clamp01(h);
		hsv.s = clamp01(s);
		hsv.v = clamp01(v);
		return send();
	}

	function setLch(l: number, c: number, h: number): boolean {
		lch.l = clamp01(l);
		lch.c = Math.min(CHROMA_MAX, Math.max(0, c));
		lch.h = Math.min(360, Math.max(0, h));
		return send();
	}

	/** Apply a typed or pasted colour; anything that isn't a hex puts the field back. */
	function apply(v: string): void {
		const n = normalize(v);
		if (!n) {
			draft.value = props.modelValue;
			return;
		}
		draft.value = n;
		if (n === sent) return;
		adopt(n);
		emit('update:modelValue', n);
	}

	// ---------------------------------------------------------------- hex fields
	/** Focus selects the whole hex; the click's own mouseup would otherwise drop the selection for a caret. */
	let keepSelection = false;
	function onHexFocus(e: FocusEvent): void {
		(e.target as HTMLInputElement).select();
		keepSelection = true;
	}
	function onHexMouseUp(e: MouseEvent): void {
		if (keepSelection) e.preventDefault();
		keepSelection = false;
	}
	function onHexPaste(e: ClipboardEvent): void {
		const n = normalize(e.clipboardData?.getData('text') ?? '');
		if (!n) return;
		e.preventDefault();
		apply(n);
	}
	function onHexKey(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			(e.target as HTMLInputElement).blur();
		} else if (e.key === 'Escape') {
			draft.value = props.modelValue;
			if (!open.value) (e.target as HTMLInputElement).blur();
		}
	}

	const popHex = ref<HTMLInputElement | null>(null);
	const copied = ref(false);
	let copiedTimer = 0;
	async function copyHex(): Promise<void> {
		const text = normalize(props.modelValue) ?? props.modelValue;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// No async clipboard (plain-http host): copy the field's own selection instead.
			popHex.value?.select();
			if (!document.execCommand('copy')) return;
		}
		copied.value = true;
		clearTimeout(copiedTimer);
		copiedTimer = window.setTimeout(() => (copied.value = false), 1200);
	}

	// ---------------------------------------------------------------- popover
	const open = ref(false);
	const root = ref<HTMLElement | null>(null);
	const swatch = ref<HTMLElement | null>(null);
	const pop = ref<HTMLElement | null>(null);
	const areaEl = ref<HTMLElement | null>(null);
	const hueEl = ref<HTMLElement | null>(null);
	/** Fixed viewport position, null until measured (the popover stays hidden till then). */
	const pos = ref<{ left: string; top: string } | null>(null);
	/** The colour when the picker opened. */
	const original = ref('');
	/** Ends the open picker's eyedropper session: meanwhile a click on a colour anywhere takes it (ui/eyedropper.ts). */
	let stopPick: (() => void) | null = null;

	/** Below the swatch, left-aligned; above it when there's no room below; nudged inside the viewport. */
	function place(): void {
		const r = swatch.value?.getBoundingClientRect();
		const el = pop.value;
		if (!r || !el) return;
		const m = 8;
		const left = Math.max(m, Math.min(r.left, innerWidth - m - el.offsetWidth));
		const below = r.bottom + 4;
		const top = below + el.offsetHeight + m <= innerHeight ? below : Math.max(m, r.top - 4 - el.offsetHeight);
		pos.value = { left: `${left}px`, top: `${top}px` };
	}

	function onDocDown(e: PointerEvent): void {
		const t = e.target as Node;
		if (!root.value?.contains(t) && !pop.value?.contains(t)) close();
	}
	/** Scrolling anything but the popover (a sidebar, to reach a colour to pick) moves it back to its swatch. */
	function onScroll(e: Event): void {
		if (!pop.value?.contains(e.target as Node)) place();
	}
	function onResize(): void {
		close();
	}

	async function toggle(): Promise<void> {
		if (open.value) return close();
		original.value = normalize(props.modelValue) ?? props.modelValue;
		open.value = true;
		document.addEventListener('pointerdown', onDocDown, true);
		window.addEventListener('resize', onResize);
		window.addEventListener('scroll', onScroll, true);
		await nextTick();
		place();
		if (open.value && root.value && pop.value) stopPick = startPick([root.value, pop.value], apply);
		await nextTick();
		areaEl.value?.focus();
	}

	/** `settle` lands an edit still in progress in one of the picker's fields first. */
	function close(refocus = false, settle = true): void {
		if (!open.value) return;
		stopPick?.();
		stopPick = null;
		const active = document.activeElement as HTMLElement | null;
		if (settle && active && pop.value?.contains(active)) active.blur();
		open.value = false;
		pos.value = null;
		drag = null;
		document.removeEventListener('pointerdown', onDocDown, true);
		window.removeEventListener('resize', onResize);
		window.removeEventListener('scroll', onScroll, true);
		if (refocus) swatch.value?.focus();
	}

	/** Esc closes; other plain keys stay in the picker, so the editor's single-key shortcuts (Del, F, T…) don't fire. */
	function onPopKey(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			close(true);
		}
		if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
	}

	function revert(): void {
		apply(original.value);
	}

	/** Another open picker can take this field's colour from its swatch (its own picker closes on it instead). */
	const swatchHex = () => normalize(props.modelValue);

	// ---------------------------------------------------------------- square and strip
	/** OKLCH: the boundary of the gamut is sampled at this many lightnesses (plus the cusp) for the square's clip. */
	const GAMUT_SAMPLES = 64;
	/** OKLCH: the square is this many columns of constant chroma. */
	const PLANE_COLUMNS = 64;

	/** The OKLCH square at the current hue: its background and its clip to the sRGB gamut. */
	const plane = computed(() => {
		if (model.value !== 'oklch') return null;
		const h = lch.h;
		const hs = h.toFixed(2);
		// Columns of constant chroma, each an exact ramp of lightness (OKLab interpolation is linear in L when a and b are
		// fixed), stacked right-aligned from the widest up so no seam shows between them.
		const layers: string[] = [];
		for (let i = PLANE_COLUMNS - 1; i >= 0; i--) {
			const c = (((i + 0.5) / PLANE_COLUMNS) * CHROMA_MAX).toFixed(4);
			const w = (((PLANE_COLUMNS - i) / PLANE_COLUMNS) * 100).toFixed(3);
			layers.push(`linear-gradient(in oklab, oklch(1 ${c} ${hs}), oklch(0 ${c} ${hs})) right / ${w}% 100% no-repeat`);
		}
		const ls = Array.from({ length: GAMUT_SAMPLES + 1 }, (_, i) => 1 - i / GAMUT_SAMPLES);
		ls.push(srgbCusp(h)[0]);
		ls.sort((a, b) => b - a);
		const edge = ls.map(
			(l) => `${((maxSrgbChroma(l, h) / CHROMA_MAX) * 100).toFixed(2)}% ${((1 - l) * 100).toFixed(2)}%`
		);
		return { background: layers.join(', '), clipPath: `polygon(0% 0%, ${edge.join(', ')}, 0% 100%)` };
	});

	const knob = computed(() =>
		model.value === 'hsv'
			? { left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }
			: { left: `${(chroma.value / CHROMA_MAX) * 100}%`, top: `${(1 - lch.l) * 100}%` }
	);
	/** Hue as 0..1 along the strip. */
	const hueAt = computed(() => (model.value === 'hsv' ? hsv.h : lch.h / 360));

	const area = computed(() =>
		model.value === 'hsv'
			? {
					name: 'Saturation and value',
					now: Math.round(hsv.s * 100),
					text: `Saturation ${Math.round(hsv.s * 100)}%, value ${Math.round(hsv.v * 100)}%`
				}
			: {
					name: 'Chroma and lightness',
					now: Math.round((chroma.value / CHROMA_MAX) * 100),
					text: `Chroma ${chroma.value.toFixed(3)}, lightness ${(lch.l * 100).toFixed(1)}%`
				}
	);

	let drag: 'area' | 'hue' | null = null;

	function pickAt(e: PointerEvent): void {
		const el = drag === 'area' ? areaEl.value : hueEl.value;
		if (!el) return;
		const r = el.getBoundingClientRect();
		const x = clamp01((e.clientX - r.left) / r.width);
		const y = clamp01((e.clientY - r.top) / r.height);
		if (drag === 'hue') {
			if (model.value === 'hsv') setHsv(x, hsv.s, hsv.v);
			else setLch(lch.l, lch.c, x * 360);
		} else if (model.value === 'hsv') setHsv(hsv.h, x, 1 - y);
		// Past the gamut, the pick slides in along its lightness to the edge.
		else setLch(1 - y, Math.min(x * CHROMA_MAX, maxSrgbChroma(1 - y, lch.h)), lch.h);
	}
	function onDown(e: PointerEvent, which: 'area' | 'hue'): void {
		if (e.button !== 0) return;
		e.preventDefault();
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		el.focus();
		drag = which;
		pickAt(e);
	}
	function onMove(e: PointerEvent): void {
		if (drag) pickAt(e);
	}
	function onUp(e: PointerEvent): void {
		if (!drag) return;
		drag = null;
		const el = e.currentTarget as HTMLElement;
		if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
	}

	/**
	 * Arrow keys, Shift ×10. Square: saturation / chroma across (1% / 0.002), value / lightness up and down (1%).
	 * Strip: hue by 1°.
	 */
	const ARROWS: Record<string, [number, number]> = {
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
		ArrowDown: [0, -1],
		ArrowUp: [0, 1]
	};
	function onSliderKey(e: KeyboardEvent, which: 'area' | 'hue'): void {
		const d = ARROWS[e.key];
		if (!d) return;
		e.preventDefault();
		const k = e.shiftKey ? 10 : 1;
		if (which === 'hue') {
			const dh = (d[0] + d[1]) * k;
			if (model.value === 'hsv') setHsv(hsv.h + dh / 360, hsv.s, hsv.v);
			else setLch(lch.l, lch.c, lch.h + dh);
		} else if (model.value === 'hsv') {
			setHsv(hsv.h, hsv.s + d[0] * 0.01 * k, hsv.v + d[1] * 0.01 * k);
		} else {
			const c = d[0] ? Math.min(Math.max(0, chroma.value + d[0] * 0.002 * k), maxSrgbChroma(lch.l, lch.h)) : lch.c;
			setLch(lch.l + d[1] * 0.01 * k, c, lch.h);
		}
	}

	// ---------------------------------------------------------------- numbers
	interface Channel {
		key: string;
		label: string;
		name: string;
		range: string;
		/** Arrow-key step (Shift ×10). */
		step: number;
		digits: number;
		get: () => number;
		set: (v: number) => boolean;
	}

	const HSV_CHANNELS: Channel[] = [
		{
			key: 'h',
			label: 'H',
			name: 'Hue',
			range: '0–360°',
			step: 1,
			digits: 0,
			get: () => hsv.h * 360,
			set: (v) => setHsv(v / 360, hsv.s, hsv.v)
		},
		{
			key: 's',
			label: 'S',
			name: 'Saturation',
			range: '0–100%',
			step: 1,
			digits: 0,
			get: () => hsv.s * 100,
			set: (v) => setHsv(hsv.h, v / 100, hsv.v)
		},
		{
			key: 'v',
			label: 'V',
			name: 'Value',
			range: '0–100%',
			step: 1,
			digits: 0,
			get: () => hsv.v * 100,
			set: (v) => setHsv(hsv.h, hsv.s, v / 100)
		}
	];
	const LCH_CHANNELS: Channel[] = [
		{
			key: 'l',
			label: 'L',
			name: 'Lightness',
			range: '0–100%',
			step: 0.5,
			digits: 1,
			get: () => lch.l * 100,
			set: (v) => setLch(v / 100, lch.c, lch.h)
		},
		{
			key: 'c',
			label: 'C',
			name: 'Chroma',
			range: `0–${CHROMA_MAX}, within sRGB`,
			step: 0.002,
			digits: 3,
			get: () => chroma.value,
			set: (v) => setLch(lch.l, v, lch.h)
		},
		{
			key: 'h',
			label: 'H',
			name: 'Hue',
			range: '0–360°',
			step: 1,
			digits: 0,
			get: () => lch.h,
			set: (v) => setLch(lch.l, lch.c, v)
		}
	];
	const channels = computed(() => (model.value === 'hsv' ? HSV_CHANNELS : LCH_CHANNELS));

	function shown(c: Channel): string {
		const v = c.get();
		return c.key === 'h' ? String(Math.round(v) % 360) : v.toFixed(c.digits);
	}
	function setChannel(c: Channel, n: number): void {
		if (Number.isFinite(n)) c.set(n);
	}
	function onChannelChange(c: Channel, e: Event): void {
		const el = e.target as HTMLInputElement;
		setChannel(c, parseFloat(el.value));
		el.value = shown(c);
	}
	function onChannelKey(c: Channel, e: KeyboardEvent): void {
		const el = e.target as HTMLInputElement;
		const dir = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
		if (e.key === 'Enter') el.blur();
		// Esc drops the typed number (the picker closes on the same key).
		if (e.key === 'Escape') el.value = shown(c);
		if (!dir) return;
		e.preventDefault();
		setChannel(c, c.get() + dir * c.step * (e.shiftKey ? 10 : 1));
	}

	const name = computed(() => (props.label ? `${props.label} colour` : 'Colour'));

	onBeforeUnmount(() => {
		close(false, false);
		clearTimeout(copiedTimer);
	});
</script>

<template>
	<div ref="root" class="cf-color">
		<button
			ref="swatch"
			v-pick="open ? null : swatchHex"
			type="button"
			class="swatch"
			:class="{ open }"
			:style="{ background: modelValue }"
			:title="label"
			:aria-label="`${name}: ${modelValue}`"
			:aria-expanded="open"
			aria-haspopup="dialog"
			@click="toggle()" />
		<input
			data-1p-ignore
			v-model="draft"
			class="hex"
			spellcheck="false"
			autocomplete="off"
			:aria-label="label ? `${label} hex` : 'Hex colour'"
			@focus="onHexFocus"
			@mouseup="onHexMouseUp"
			@paste="onHexPaste"
			@keydown="onHexKey"
			@blur="apply(draft)" />
		<Teleport to="body">
			<div
				v-if="open"
				ref="pop"
				class="cf-picker"
				role="dialog"
				:aria-label="name"
				:style="pos ?? { visibility: 'hidden' }"
				@keydown="onPopKey">
				<div class="models fk-rail" role="radiogroup" aria-label="Colour model">
					<button
						v-for="m in MODELS"
						:key="m.id"
						v-tip:top="m.tip"
						type="button"
						class="fk"
						:class="{ lit: model === m.id }"
						role="radio"
						:aria-checked="model === m.id"
						@click="setModel(m.id)">
						<span class="fk-face">{{ m.label }}</span>
					</button>
				</div>
				<div
					ref="areaEl"
					class="area"
					:class="model"
					:style="model === 'hsv' ? { backgroundColor: hueHex } : undefined"
					role="slider"
					tabindex="0"
					:aria-label="area.name"
					:aria-valuenow="area.now"
					:aria-valuetext="area.text"
					@pointerdown="onDown($event, 'area')"
					@pointermove="onMove"
					@pointerup="onUp"
					@pointercancel="onUp"
					@keydown="onSliderKey($event, 'area')">
					<div v-if="plane" class="plane" :style="plane" />
					<span class="knob" :style="{ ...knob, background: hex }" />
				</div>
				<div
					ref="hueEl"
					class="hue"
					:style="{ background: model === 'hsv' ? HSV_HUES : oklchHueStrip() }"
					role="slider"
					tabindex="0"
					aria-label="Hue"
					aria-valuemin="0"
					aria-valuemax="360"
					:aria-valuenow="Math.round(hueAt * 360)"
					@pointerdown="onDown($event, 'hue')"
					@pointermove="onMove"
					@pointerup="onUp"
					@pointercancel="onUp"
					@keydown="onSliderKey($event, 'hue')">
					<span class="thumb" :style="{ left: `${hueAt * 100}%`, background: model === 'hsv' ? hueHex : cuspHex }" />
				</div>
				<div class="readout">
					<div class="compare">
						<button
							v-tip:top="`Back to ${original}`"
							type="button"
							class="was"
							:style="{ background: original }"
							:aria-label="`Back to ${original}`"
							@click="revert" />
						<span class="now" :style="{ background: hex }" />
					</div>
					<label v-for="c in channels" :key="`${model}-${c.key}`" v-tip:top="`${c.name}, ${c.range}`" class="num">
						<span class="nl">{{ c.label }}</span>
						<input
							data-1p-ignore
							:value="shown(c)"
							inputmode="decimal"
							spellcheck="false"
							autocomplete="off"
							:aria-label="`${c.name} (${c.range})`"
							@focus="($event.target as HTMLInputElement).select()"
							@change="onChannelChange(c, $event)"
							@keydown="onChannelKey(c, $event)" />
					</label>
				</div>
				<div class="hexrow">
					<span class="nl">Hex</span>
					<input
						data-1p-ignore
						ref="popHex"
						v-model="draft"
						class="hex"
						spellcheck="false"
						autocomplete="off"
						:aria-label="label ? `${label} hex` : 'Hex colour'"
						@focus="onHexFocus"
						@mouseup="onHexMouseUp"
						@paste="onHexPaste"
						@keydown="onHexKey"
						@blur="apply(draft)" />
					<button
						v-tip:top="copied ? 'Copied' : 'Copy hex'"
						type="button"
						class="cf-ico-btn"
						:class="{ latched: copied }"
						aria-label="Copy hex"
						@click="copyHex">
						<IconCheck v-if="copied" :size="13" />
						<IconCopy v-else :size="13" />
					</button>
				</div>
			</div>
		</Teleport>
	</div>
</template>

<style scoped>
	.cf-color {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.swatch {
		width: 34px;
		height: 22px;
		flex: none;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--r-field);
		box-shadow: inset 0 0 0 1px rgba(17, 19, 22, 0.6);
	}
	.swatch:hover {
		border-color: var(--line-strong);
	}
	.swatch.open {
		border-color: var(--accent);
		box-shadow:
			inset 0 0 0 1px rgba(17, 19, 22, 0.6),
			var(--glow);
	}
	.hex {
		flex: 1;
		min-width: 0;
		height: 22px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--sunken);
		color: var(--text-hi);
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 0 6px;
	}
	.hex:hover {
		border-color: var(--line);
	}
	.hex:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: var(--halo);
	}

	/* ---- picker (teleported to <body>) */
	.cf-picker {
		position: fixed;
		z-index: 100;
		width: 228px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--r-field);
		box-shadow: 0 8px 24px rgba(8, 9, 10, 0.55);
	}
	.models .fk {
		height: 22px;
	}
	.models .fk-face {
		padding: 0 9px;
		font-size: 11px;
		letter-spacing: 0.06em;
	}
	.area,
	.hue {
		position: relative;
		border-radius: 2px;
		touch-action: none;
	}
	.area {
		height: 148px;
		cursor: crosshair;
	}
	/* The frame sits over the OKLCH square's columns too. */
	.area::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 0 1px rgba(17, 19, 22, 0.6);
		pointer-events: none;
	}
	.area.hsv {
		background-image:
			linear-gradient(to top, #000, rgba(0, 0, 0, 0)), linear-gradient(to right, #fff, rgba(255, 255, 255, 0));
	}
	/* OKLCH: outside the sRGB gamut, a faint hatch. */
	.area.oklch {
		background: repeating-linear-gradient(135deg, var(--sunken) 0 4px, var(--base) 4px 5px);
	}
	.plane {
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}
	.hue {
		height: 12px;
		cursor: ew-resize;
		box-shadow: inset 0 0 0 1px rgba(17, 19, 22, 0.6);
	}
	.knob,
	.thumb {
		position: absolute;
		z-index: 1;
		pointer-events: none;
		border: 2px solid #fff;
		box-shadow:
			0 0 0 1px rgba(8, 9, 10, 0.7),
			inset 0 0 0 1px rgba(8, 9, 10, 0.35);
	}
	.knob {
		width: 14px;
		height: 14px;
		margin: -7px 0 0 -7px;
		border-radius: 50%;
	}
	.thumb {
		top: -3px;
		bottom: -3px;
		width: 8px;
		margin-left: -4px;
		border-radius: 2px;
	}
	.area:focus-visible,
	.hue:focus-visible {
		outline-offset: 2px;
	}

	.readout,
	.hexrow {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.readout {
		gap: 5px;
	}
	.compare {
		width: 32px;
		height: 22px;
		flex: none;
		display: flex;
		border: 1px solid var(--line);
		border-radius: var(--r-field);
		overflow: hidden;
	}
	.compare > * {
		flex: 1;
	}
	.was {
		padding: 0;
		border: 0;
		border-right: 1px solid rgba(17, 19, 22, 0.6);
	}
	.num {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.nl {
		flex: none;
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-lo);
	}
	.num input {
		width: 100%;
		min-width: 0;
		height: 22px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-field);
		background: var(--sunken);
		color: var(--text-hi);
		font-family: var(--font-mono);
		font-size: 12px;
		text-align: right;
		padding: 0 3px;
	}
	.num input:hover {
		border-color: var(--line);
	}
	.num input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: var(--halo);
	}
</style>
