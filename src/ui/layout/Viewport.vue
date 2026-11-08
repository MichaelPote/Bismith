<script setup lang="ts">
	// The centre view: owns the Engine, the canvas, zoom/pan, channel views, and the selected light's or layer's gizmo.
	import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore } from '@/stores/editor';
	import { afterPaint } from '@/ui/actions';
	import { Engine } from '@/render/engine';
	import { shaderKey } from '@/render/materialPipeline';
	import { GpuError } from '@/gpu/context';
	import { CHANNEL_VIEWS } from '@/render/display';
	import {
		IconBackground,
		IconBolt,
		IconChartCohort,
		IconGrid3x3,
		IconMaximize,
		IconPencil,
		IconStackFront,
		IconStackMiddle
	} from '@tabler/icons-vue';
	import ShapeEditor from '@/ui/components/ShapeEditor.vue';
	import LayerGizmo from '@/ui/components/LayerGizmo.vue';
	import { hasGizmo } from '@/ui/gizmos';
	import SelectField from '@/ui/components/SelectField.vue';
	import { vTip } from '@/ui/tooltip';
	import { vPick } from '@/ui/eyedropper';
	import { getLayerDef, layerParamDefs } from '@/layers/registry';
	import type { Project } from '@/core/project';
	import { masksAbove } from '@/layers/masks';
	import { maskColour } from '@/ui/meta';
	import { rgbToHex } from '@/core/color';

	const store = useProjectStore();
	const editor = useEditorStore();

	const wrap = ref<HTMLElement | null>(null);
	const canvas = ref<HTMLCanvasElement | null>(null);
	const cssSize = ref({ w: 1, h: 1 });
	const dpr = ref(window.devicePixelRatio || 1);
	const cursor = ref<{ x: number; y: number } | null>(null);
	let engine: Engine | null = null;
	let ro: ResizeObserver | null = null;

	const ZOOMS = [0.125, 0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];

	const project = computed(() => store.project);

	const previewUpTo = computed(() => {
		if (!editor.solo || editor.selection.kind !== 'layer') return null;
		const i = store.project.layers.findIndex((l) => l.id === editor.selection.id);
		return i >= 0 ? i : null;
	});

	function pushView(): void {
		engine?.setView({
			channel: editor.channel,
			transform: { zoom: editor.zoom, offsetX: editor.offsetX, offsetY: editor.offsetY },
			options: { tile: editor.tile, grid: editor.grid, checker: editor.checker },
			previewUpTo: previewUpTo.value,
			mask: editor.viewMask
		});
	}

	function fit(): void {
		const p = store.project;
		const span = editor.tile ? 5 : 1;
		const availW = cssSize.value.w * dpr.value * 0.88;
		const availH = (cssSize.value.h - 72) * dpr.value * 0.88;
		const ideal = Math.min(availW / (p.width * span), availH / (p.height * span));
		editor.zoom = [...ZOOMS].reverse().find((s) => s <= ideal) ?? ZOOMS[0];
		centre();
	}

	function centre(): void {
		const p = store.project;
		editor.offsetX = Math.round((cssSize.value.w * dpr.value - p.width * editor.zoom) / 2);
		editor.offsetY = Math.round((cssSize.value.h * dpr.value - p.height * editor.zoom) / 2 + 18 * dpr.value);
	}

	function zoomAt(newZoom: number, cx: number, cy: number): void {
		// cx, cy in device px relative to the canvas.
		const z0 = editor.zoom;
		const tx = (cx - editor.offsetX) / z0;
		const ty = (cy - editor.offsetY) / z0;
		editor.zoom = newZoom;
		editor.offsetX = Math.round(cx - tx * newZoom);
		editor.offsetY = Math.round(cy - ty * newZoom);
	}

	function onWheel(e: WheelEvent): void {
		e.preventDefault();
		const rect = canvas.value!.getBoundingClientRect();
		const cx = (e.clientX - rect.left) * dpr.value;
		const cy = (e.clientY - rect.top) * dpr.value;
		const i = ZOOMS.findIndex((z) => z >= editor.zoom - 1e-6);
		const cur = i < 0 ? ZOOMS.length - 1 : i;
		const next = e.deltaY < 0 ? Math.min(ZOOMS.length - 1, cur + 1) : Math.max(0, cur - 1);
		zoomAt(ZOOMS[next], cx, cy);
	}

	let panning: { x: number; y: number; ox: number; oy: number; id: number } | null = null;

	function onPointerDown(e: PointerEvent): void {
		if (e.button !== 0 && e.button !== 1) return;
		e.preventDefault();
		panning = { x: e.clientX, y: e.clientY, ox: editor.offsetX, oy: editor.offsetY, id: e.pointerId };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent): void {
		const rect = canvas.value!.getBoundingClientRect();
		const tx = ((e.clientX - rect.left) * dpr.value - editor.offsetX) / editor.zoom;
		const ty = ((e.clientY - rect.top) * dpr.value - editor.offsetY) / editor.zoom;
		const p = store.project;
		cursor.value =
			tx >= 0 && ty >= 0 && tx < p.width && ty < p.height ? { x: Math.floor(tx), y: Math.floor(ty) } : null;
		probeCursor();
		if (panning && panning.id === e.pointerId) {
			editor.offsetX = Math.round(panning.ox + (e.clientX - panning.x) * dpr.value);
			editor.offsetY = Math.round(panning.oy + (e.clientY - panning.y) * dpr.value);
		}
	}

	function onPointerUp(e: PointerEvent): void {
		if (panning?.id === e.pointerId) panning = null;
	}

	// ---------------------------------------------------------------- texel probe (throttled)
	const probe = ref<{ h: number; r: number; hex: string; e: number; sdf: number } | null>(null);
	let probeAt = 0;

	function probeCursor(): void {
		const c = cursor.value;
		const now = performance.now();
		if (!c || !engine) {
			probe.value = null;
			return;
		}
		if (now - probeAt < 60) return;
		probeAt = now;
		const k = engine.supersample;
		const v = engine.material.probe(c.x * k + (k >> 1), c.y * k + (k >> 1));
		// The colour shown, as the eyedropper takes it: the final image, or the albedo in Diffuse.
		const rgb = engine.pickColour(c.x, c.y);
		if (!v || !rgb) return;
		probe.value = {
			h: v.surface[0],
			r: v.surface[1],
			hex: rgbToHex(rgb),
			e: Math.max(v.emissive[0], v.emissive[1], v.emissive[2]),
			// The viewed mask's distance here (FR8.23; Shape unless the Masks view picks another).
			sdf: engine.material.probeMask(editor.viewMask, c.x * k + (k >> 1), c.y * k + (k >> 1))?.[0] ?? 1e4
		};
	}

	// ---------------------------------------------------------------- eyedropper
	/** The colour shown under the pointer (any copy in the tile preview): the final image, or the albedo in Diffuse. */
	function pickTexel(e: MouseEvent): string | null {
		if (!engine) return null;
		const rect = canvas.value!.getBoundingClientRect();
		const p = store.project;
		const tx = Math.floor(((e.clientX - rect.left) * dpr.value - editor.offsetX) / editor.zoom);
		const ty = Math.floor(((e.clientY - rect.top) * dpr.value - editor.offsetY) / editor.zoom);
		const lo = editor.tile ? -2 : 0;
		const hi = editor.tile ? 3 : 1;
		if (tx < lo * p.width || ty < lo * p.height || tx >= hi * p.width || ty >= hi * p.height) return null;
		const mod = (v: number, n: number) => ((v % n) + n) % n;
		const rgb = engine.pickColour(mod(tx, p.width), mod(ty, p.height));
		return rgb && rgbToHex(rgb);
	}

	// ---------------------------------------------------------------- light gizmos
	const texRect = computed(() => {
		const p = project.value;
		return {
			x: editor.offsetX / dpr.value,
			y: editor.offsetY / dpr.value,
			w: (p.width * editor.zoom) / dpr.value,
			h: (p.height * editor.zoom) / dpr.value
		};
	});

	/** A sun gizmo's horizon (CSS px from the texture centre): just outside the texture. */
	const sunHorizon = (r: { w: number; h: number }) => Math.max(40, Math.min(r.w, r.h) / 2 + 26);

	// Only the selected light's.
	const gizmos = computed(() => {
		const r = texRect.value;
		return project.value.lighting.lights
			.filter((l) => l.enabled && editor.selection.kind === 'light' && editor.selection.id === l.id)
			.map((l) => {
				const sel = editor.selection.kind === 'light' && editor.selection.id === l.id;
				if (l.type === 'point') {
					return {
						id: l.id,
						type: 'point' as const,
						sel,
						color: String(l.params.color),
						x: r.x + Number(l.params.x) * r.w,
						y: r.y + Number(l.params.y) * r.h
					};
				}
				const az = (Number(l.params.azimuth) * Math.PI) / 180;
				const cx = r.x + r.w / 2;
				const cy = r.y + r.h / 2;
				// A sky map seen from above: the angle is the azimuth, the distance the elevation (linear, 0° on the horizon
				// ring, 90° at the centre).
				const horizon = sunHorizon(r);
				const len = horizon * (1 - Number(l.params.elevation) / 90);
				return {
					id: l.id,
					type: 'directional' as const,
					sel,
					color: String(l.params.color),
					cx,
					cy,
					horizon,
					x: cx + Math.sin(az) * len,
					y: cy - Math.cos(az) * len
				};
			});
	});

	/** The selected layer's gizmo (src/ui/gizmos.ts), in the Create workspace. */
	const gizmoLayer = computed(() => {
		const s = editor.selection;
		if (editor.workspace !== 'create' || s.kind !== 'layer' || !s.id) return null;
		const l = store.getLayer(s.id);
		return l && l.enabled && hasGizmo(l.type) ? l : null;
	});

	// ---------------------------------------------------------------- shape editor
	/** The selected layer whose shapes the editor edits (Path / Line layers, pipe runs, splats); null = drawing only. */
	const shapeTarget = computed<{ kind: 'layer'; id: string } | null>(() => {
		const s = editor.selection;
		if (!s.id || s.kind !== 'layer') return null;
		const shaped = (d: { bitmap?: string }) => d.bitmap === 'points' || d.bitmap === 'lines';
		const l = store.getLayer(s.id);
		return l && layerParamDefs(l.type).some(shaped) ? { kind: 'layer', id: l.id } : null;
	});

	const CHANNEL_OPTIONS = CHANNEL_VIEWS.map((c) => ({ value: c.id, label: `${c.label} · ${c.key.toUpperCase()}` }));
	/** Rename the viewed mask everywhere it is named (FR8.23): an inline name field in place of the picker. */
	const renaming = ref(false);
	const renameDraft = ref('');
	const renameInput = ref<HTMLInputElement | null>(null);

	async function startRename(): Promise<void> {
		renameDraft.value = editor.viewMask;
		renaming.value = true;
		await nextTick();
		renameInput.value?.select();
	}

	function finishRename(keep: boolean): void {
		if (!renaming.value) return;
		renaming.value = false;
		const name = renameDraft.value.trim();
		if (!keep || !name || name === editor.viewMask) return;
		store.renameMask(editor.viewMask, name);
		editor.viewMask = name;
	}

	/** The masks the Masks view can show: every mask the stack writes (FR8.23). */
	const MASK_OPTIONS = computed(() => {
		const names = masksAbove(store.project);
		if (!names.includes(editor.viewMask)) names.push(editor.viewMask);
		return names.map((n) => ({ value: n, label: n, colour: maskColour(store.project, n) }));
	});

	/** Channel key labels for a narrow viewport (the tooltip keeps the full name). */
	const SHORT: Record<string, string> = {
		final: 'Fin',
		diffuse: 'Dif',
		height: 'Hgt',
		roughness: 'Rgh',
		specular: 'Spc',
		metal: 'Mtl',
		normal: 'Nrm',
		ao: 'AO',
		emissive: 'Emi',
		opacity: 'Opa',
		masks: 'Msk'
	};

	/** Viewport overlays: toggle keys that latch, with a pilot lamp. */
	const toggles = computed(() => [
		{
			label: 'Preview up to selected layer',
			tip: 'Preview up to the selected layer - Turns off all layers above the selected one',
			icon: markRaw(IconStackFront),
			iconOn: markRaw(IconStackMiddle),
			keybind: 'S',
			on: editor.solo,
			flip: () => (editor.solo = !editor.solo)
		},
		{
			label: 'Tiling preview',
			tip: 'Tiling Preview - preview this texture in a 5×5 grid',
			keybind: 'T',
			icon: markRaw(IconChartCohort),
			on: editor.tile,
			flip: () => (editor.tile = !editor.tile)
		},
		{
			label: 'Pixel grid',
			tip: 'Pixel Grid - draw a grid around each pixel when zoomed',
			keybind: 'G',
			icon: markRaw(IconGrid3x3),
			on: editor.grid,
			flip: () => (editor.grid = !editor.grid)
		},
		{
			label: 'Alpha checkerboard',
			tip: 'Alpha Checkerboard - Show a checkerboard pattern where the texture is transparent',
			icon: markRaw(IconBackground),
			on: editor.checker,
			flip: () => (editor.checker = !editor.checker)
		}
	]);

	/** Ctrl (⌘) while dragging a sun snaps its angles to this step. */
	const ANGLE_SNAP = 15;
	let gizmoDrag: { id: string; type: 'point' | 'directional' } | null = null;
	/** The last pointer position of the drag (client px), so pressing or releasing a modifier re-applies without a move. */
	let gizmoAt = { x: 0, y: 0 };
	/** The sun being Shift-dragged (placed under the cursor): its horizon ring is shown. */
	const sunPlacing = ref<string | null>(null);

	function onGizmoDown(e: PointerEvent, g: { id: string; type: 'point' | 'directional' }): void {
		e.stopPropagation();
		e.preventDefault();
		// As the layer gizmos: a field still being typed in would keep Ctrl+Z from reaching the editor.
		(document.activeElement as HTMLElement | null)?.blur();
		store.commitNow();
		editor.select('light', g.id);
		gizmoDrag = g;
		gizmoAt = { x: e.clientX, y: e.clientY };
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		window.addEventListener('keydown', onGizmoKey);
		window.addEventListener('keyup', onGizmoKey);
	}

	/**
	 * Point lights follow the cursor. A sun's azimuth follows the cursor's angle about the texture centre; with Shift its
	 * elevation follows the cursor's distance too, so the handle lands under the cursor. Ctrl (⌘) snaps both angles.
	 */
	function dragGizmo(mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void {
		if (!gizmoDrag) return;
		const rect = wrap.value!.getBoundingClientRect();
		const px = gizmoAt.x - rect.left;
		const py = gizmoAt.y - rect.top;
		const r = texRect.value;
		if (gizmoDrag.type === 'point') {
			store.setLightParam(gizmoDrag.id, 'x', Number(((px - r.x) / r.w).toFixed(4)));
			store.setLightParam(gizmoDrag.id, 'y', Number(((py - r.y) / r.h).toFixed(4)));
		} else {
			const dx = px - (r.x + r.w / 2);
			const dy = py - (r.y + r.h / 2);
			const snap = mods.ctrlKey || mods.metaKey;
			const az = (Math.atan2(dx, -dy) * 180) / Math.PI;
			const step = snap ? ANGLE_SNAP : 1;
			store.setLightParam(gizmoDrag.id, 'azimuth', (Math.round(az / step) * step + 360) % 360);
			sunPlacing.value = mods.shiftKey ? gizmoDrag.id : null;
			if (mods.shiftKey) {
				const el = 90 * (1 - Math.hypot(dx, dy) / sunHorizon(r));
				const snapped = snap ? Math.round(el / ANGLE_SNAP) * ANGLE_SNAP : Math.round(el * 2) / 2;
				store.setLightParam(gizmoDrag.id, 'elevation', Math.max(1, Math.min(90, snapped)));
			}
		}
	}

	function onGizmoMove(e: PointerEvent): void {
		if (!gizmoDrag) return;
		gizmoAt = { x: e.clientX, y: e.clientY };
		dragGizmo(e);
	}

	function onGizmoKey(e: KeyboardEvent): void {
		if ((e.key === 'Control' || e.key === 'Meta' || e.key === 'Shift') && !e.repeat) dragGizmo(e);
	}

	function endGizmoDrag(): void {
		gizmoDrag = null;
		sunPlacing.value = null;
		window.removeEventListener('keydown', onGizmoKey);
		window.removeEventListener('keyup', onGizmoKey);
	}

	function onGizmoUp(e: PointerEvent): void {
		if (!gizmoDrag) return;
		(e.currentTarget as Element).releasePointerCapture(e.pointerId);
		endGizmoDrag();
	}

	// ---------------------------------------------------------------- status
	const stats = computed(() => editor.stats);
	const progress = computed(() =>
		stats.value ? Math.min(1, stats.value.samples / Math.max(1, stats.value.maxSamples)) : 0
	);
	const errorList = computed(() => Object.entries(stats.value?.errors ?? {}));
	const zoomLabel = computed(() => (editor.zoom >= 1 ? `${editor.zoom}×` : `1/${Math.round(1 / editor.zoom)}`));

	// ---------------------------------------------------------------- lifecycle
	let lastStats = 0;
	onMounted(() => {
		try {
			engine = new Engine(canvas.value!);
			// Bevel aspect's shader variants compile in the background (MaterialPipeline.deferVariants).
			engine.material.deferVariants = true;
		} catch (e) {
			editor.engineError =
				e instanceof GpuError ? e.message : `Renderer failed to start: ${e instanceof Error ? e.message : e}`;
			return;
		}
		editor.setEngine(engine);
		// Dev-only handle for scripted UI tests (tools/shot.ts --eval).
		if (import.meta.env.DEV) (window as unknown as { __bismithEngine?: Engine }).__bismithEngine = engine;
		engine.onStats = (s) => {
			const now = performance.now();
			if (now - lastStats > 120 || s.samples >= s.maxSamples) {
				lastStats = now;
				editor.stats = { ...s };
			}
		};
		ro = new ResizeObserver(() => {
			const el = wrap.value!;
			dpr.value = window.devicePixelRatio || 1;
			const first = cssSize.value.w <= 1;
			cssSize.value = { w: el.clientWidth, h: el.clientHeight };
			engine!.resize(el.clientWidth * dpr.value, el.clientHeight * dpr.value);
			if (first) fit();
			pushView();
		});
		ro.observe(wrap.value!);
		engine.setProject(toRaw(store.project));
		pushView();
		void startEngine(engine);
	});

	/**
	 * Compile `keys` (shaderKey) behind the busy modal, a step per shader plus one for the first frame (filters, tracer,
	 * post), then run `apply` and keep the modal up until the frame it causes has evaluated. A first compile can take
	 * seconds (D3D on Windows), and where the browser can't compile in the background (Firefox) it freezes the page; the
	 * modal says what is happening and, there, steps from shader to shader (Engine.precompile).
	 */
	async function behindModal(e: Engine, keys: string[], title: string, apply: () => void): Promise<void> {
		const steps = e.uncompiled(keys).length + 1;
		const step = (done: number, next?: string) => {
			if (!editor.busy) return;
			editor.busy.progress = done / steps;
			const type = next && getLayerDef(next.split('~')[0])?.label;
			editor.busy.detail = type
				? `Compiling shaders · ${done + 1} of ${steps - 1} — ${type}`
				: 'Rendering the first frame…';
		};
		editor.busy = {
			title,
			detail: 'This can take a few seconds the first time.',
			// Without background compiling the page freezes during the compile, so the modal can't wait to fade in.
			instant: !e.parallelCompile,
			progress: 0
		};
		try {
			await afterPaint();
			await e.precompile(keys, (done, _total, next) => step(done, next));
			// Unmounted meanwhile: the engine is disposed.
			if (engine !== e) return;
			apply();
			// The first frame compiles the rest (filters, tracer, post): keep the modal up until it has run.
			await e.settled();
		} finally {
			editor.busy = null;
		}
	}

	/**
	 * Start rendering behind the busy modal. The first frame compiles every shader the project uses; started straight
	 * away, it ran before the first paint and left the page blank meanwhile.
	 */
	function startEngine(e: Engine): Promise<void> {
		return behindModal(e, store.project.layers.map(shaderKey), 'Starting the renderer…', () => e.start());
	}

	/**
	 * Every change of the project reaches the engine here. One that brings generator types whose shaders haven't compiled
	 * (opening a file, the wizard, undo / redo, a preset, an import) is held behind the busy modal while they compile: the
	 * engine keeps showing the last frame, and changes made meanwhile are applied with it. A type's shader variants (Custom
	 * bevel aspect, optional parts) compile in the background as they are used; where the browser can't do that (Firefox:
	 * no KHR_parallel_shader_compile, the compile stalls the page) they are held behind the modal too.
	 */
	let compiling = false;
	let held: Project | null = null;
	let seenGeneration = store.generation;
	function updateProject(p: Project): void {
		const e = engine;
		if (!e) return;
		const opening = store.generation !== seenGeneration;
		seenGeneration = store.generation;
		if (compiling) {
			held = p;
			return;
		}
		// Only layers whose own shader isn't ready; with a background compile, what they need meanwhile is the plain type.
		const waiting = p.layers.filter((l) => e.uncompiled([shaderKey(l)]).length > 0);
		const need = e.uncompiled(waiting.map((l) => (e.parallelCompile ? l.type : shaderKey(l))));
		if (!need.length) {
			e.setProject(p);
			return;
		}
		compiling = true;
		held = p;
		const title = opening ? `Opening “${p.name}”…` : 'Compiling shaders…';
		void behindModal(e, need, title, () => {
			e.setProject(held ?? p);
			held = null;
		}).finally(() => {
			compiling = false;
			// Changed while the first frame ran: apply that too (it may need more shaders).
			const next = held;
			held = null;
			if (next) updateProject(next);
		});
	}

	onBeforeUnmount(() => {
		endGizmoDrag();
		ro?.disconnect();
		editor.setEngine(null);
		engine?.dispose();
		engine = null;
	});

	watch(
		() => store.project,
		(p) => updateProject(toRaw(p)),
		{ deep: true }
	);
	watch(
		() => [
			editor.channel,
			editor.viewMask,
			editor.zoom,
			editor.offsetX,
			editor.offsetY,
			editor.tile,
			editor.grid,
			editor.checker,
			previewUpTo.value
		],
		pushView
	);
	watch(() => editor.fitRequest, fit);
	// Another project (open, new) or tiling refits. A new canvas size alone (a resize, its undo) keeps the zoom (3× stays
	// 3×), with the texture's centre where it was on screen.
	watch(
		() => [store.project.width, store.project.height, editor.tile, store.generation] as const,
		([w, h, tile, gen], [w0, h0, tile0, gen0]) => {
			if (tile !== tile0 || gen !== gen0) return fit();
			editor.offsetX = Math.round(editor.offsetX + ((w0 - w) * editor.zoom) / 2);
			editor.offsetY = Math.round(editor.offsetY + ((h0 - h) * editor.zoom) / 2);
		}
	);
</script>

<template>
	<section class="viewport cf-panel">
		<div
			ref="wrap"
			v-pick="pickTexel"
			class="stage"
			@wheel="onWheel"
			@pointerdown="onPointerDown"
			@pointermove="onPointerMove"
			@pointerup="onPointerUp"
			@pointercancel="onPointerUp"
			@pointerleave="cursor = null"
			@dblclick="fit">
			<canvas ref="canvas" class="canvas" />
			<svg
				class="gizmos"
				:width="cssSize.w"
				:height="cssSize.h"
				@pointermove="onGizmoMove"
				@pointerup="onGizmoUp"
				@pointercancel="onGizmoUp">
				<template v-for="g in gizmos" :key="g.id">
					<g v-if="g.type === 'point'" class="gizmo" :class="{ sel: g.sel }" @pointerdown="onGizmoDown($event, g)">
						<circle :cx="g.x" :cy="g.y" r="11" class="ring" />
						<circle :cx="g.x" :cy="g.y" r="5" :fill="g.color" class="core" />
					</g>
					<g v-else class="gizmo" :class="{ sel: g.sel }">
						<circle v-if="sunPlacing === g.id" :cx="g.cx" :cy="g.cy" :r="g.horizon" class="horizon" />
						<line :x1="g.cx" :y1="g.cy" :x2="g.x" :y2="g.y" class="ray" />
						<g @pointerdown="onGizmoDown($event, g)">
							<circle :cx="g.x" :cy="g.y" r="11" class="ring" />
							<circle :cx="g.x" :cy="g.y" r="5" :fill="g.color" class="core" />
							<path
								:d="`M${g.x - 15} ${g.y}h-4M${g.x + 15} ${g.y}h4M${g.x} ${g.y - 15}v-4M${g.x} ${g.y + 15}v4`"
								class="rays" />
						</g>
					</g>
				</template>
			</svg>
			<LayerGizmo v-if="gizmoLayer" :layer="gizmoLayer" :project="project" :rect="texRect" :size="cssSize" />
			<ShapeEditor
				v-if="editor.workspace === 'create'"
				:target="shapeTarget"
				:rect="texRect"
				:tex-w="project.width"
				:tex-h="project.height"
				:size="cssSize" />
		</div>

		<div class="header">
			<div class="channels fk-rail" role="tablist" aria-label="Channel">
				<button
					v-for="c in CHANNEL_VIEWS"
					:key="c.id"
					v-tip:bottom="{ body: c.description, keys: c.key.toUpperCase() }"
					type="button"
					role="tab"
					class="fk"
					:class="{ lit: editor.channel === c.id }"
					:aria-selected="editor.channel === c.id"
					@click="editor.channel = c.id">
					<span class="fk-face"
						><span class="lbl full">{{ c.label }}</span
						><span class="lbl short">{{ SHORT[c.id] ?? c.label }}</span></span
					>
				</button>
			</div>
			<SelectField
				class="ch-select"
				:model-value="editor.channel"
				:options="CHANNEL_OPTIONS"
				label="Channel"
				@update:model-value="editor.channel = $event as typeof editor.channel" />
			<template v-if="editor.channel === 'masks'">
				<input
					autocomplete="off"
					data-1p-ignore
					v-if="renaming"
					ref="renameInput"
					v-model="renameDraft"
					class="mask-rename"
					spellcheck="false"
					aria-label="Rename mask"
					@keydown.enter.prevent="finishRename(true)"
					@keydown.escape.prevent="finishRename(false)"
					@blur="finishRename(true)" />
				<SelectField
					v-else
					class="mask-select"
					:model-value="editor.viewMask"
					:options="MASK_OPTIONS"
					:ring="maskColour(store.project, editor.viewMask)"
					label="Mask"
					@update:model-value="editor.viewMask = String($event)" />
				<button
					v-tip:bottom="'Rename this mask everywhere it is named'"
					type="button"
					class="cf-toggle toggle"
					aria-label="Rename mask"
					@click="startRename">
					<IconPencil :size="14" />
				</button>
			</template>
			<div class="tools">
				<button
					v-for="t in toggles"
					:key="t.label"
					v-tip:bottom="{ body: t.tip, keys: t.keybind }"
					type="button"
					class="cf-toggle toggle"
					:class="{ on: t.on }"
					:aria-label="t.label"
					:aria-pressed="t.on"
					@click="t.flip()">
					<component :is="t.on && t.iconOn ? t.iconOn : t.icon" :size="18" />
				</button>
				<div class="vsep" />
				<button
					v-tip:bottom="{ body: 'Fit to view', keys: 'F' }"
					type="button"
					class="cf-ico-btn fit"
					aria-label="Fit to view"
					@click="fit">
					<IconMaximize :size="18" />
				</button>
				<span class="chip cf-mono">{{ zoomLabel }}</span>
			</div>
		</div>

		<div class="readout cf-mono">
			<div>{{ project.width }}×{{ project.height }} px<span v-if="project.tileable"> · tileable</span></div>
			<div v-if="cursor">
				cursor <span class="hi">x {{ cursor.x }} y {{ cursor.y }}</span>
				<template v-if="probe">
					· <span class="sw" :style="{ background: probe.hex }" /> <span class="hi">{{ probe.hex }}</span> · h
					<span class="hi">{{ probe.h.toFixed(3) }}</span> · r <span class="hi">{{ probe.r.toFixed(2) }}</span>
					<template v-if="probe.e > 0">
						· e <span class="hi">{{ probe.e.toFixed(2) }}</span></template
					>
					<template v-if="probe.sdf < 5000">
						· <span :style="{ color: maskColour(store.project, editor.viewMask) }">{{ editor.viewMask }}</span
						>{{ ' ' }}<span class="hi">{{ probe.sdf.toFixed(1) }}</span></template
					>
				</template>
			</div>
			<div v-else-if="stats">
				height <span class="hi">{{ stats.heightMin.toFixed(2) }} … {{ stats.heightMax.toFixed(2) }} px</span>
			</div>
		</div>

		<div v-if="stats" class="status" :class="{ done: progress >= 1 }">
			<IconBolt :size="14" :color="progress >= 1 ? 'var(--pill)' : 'var(--accent-hi)'" />
			<span class="txt"
				>{{ stats.draft ? 'Draft' : progress >= 1 ? 'Converged' : 'Tracing' }} ·
				<span class="cf-mono">{{ stats.samples }}/{{ stats.maxSamples }} spp</span></span
			>
			<span v-if="progress < 1" class="cf-mono lo">{{ stats.samplesPerSec }}/s</span>
			<div class="bar">
				<div :style="{ width: `${progress * 100}%` }" />
			</div>
		</div>

		<div v-if="errorList.length" class="errors">
			<div v-for="[id, msg] in errorList.slice(0, 3)" :key="id" class="error">
				<b>Shader error</b> <span class="cf-mono">{{ msg.slice(0, 220) }}</span>
			</div>
		</div>

		<div v-if="editor.engineError" class="fatal">
			<div class="fatal-title">The renderer could not start</div>
			<div>{{ editor.engineError }}</div>
			<div class="lo">
				Bismith needs WebGL2 with float render targets (any recent desktop browser with hardware acceleration enabled).
			</div>
		</div>
	</section>
</template>

<style scoped>
	.viewport {
		position: relative;
		overflow: hidden;
		background: var(--void);
	}

	.stage {
		position: absolute;
		inset: 0;
		cursor: grab;
		touch-action: none;
	}

	.stage:active {
		cursor: grabbing;
	}

	.canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		image-rendering: pixelated;
	}

	.gizmos {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.gizmo {
		pointer-events: auto;
		cursor: move;
	}

	.gizmo .ring {
		fill: rgba(23, 25, 28, 0.55);
		stroke: var(--text-hi);
		stroke-width: 1.5;
	}

	.gizmo .core {
		stroke: var(--deep);
		stroke-width: 1;
	}

	.gizmo .ray {
		stroke: var(--text-hi);
		stroke-width: 1;
		stroke-dasharray: 3 3;
		opacity: 0.6;
		pointer-events: none;
	}

	.gizmo .horizon {
		fill: none;
		stroke: var(--text-hi);
		stroke-width: 1;
		stroke-dasharray: 2 4;
		opacity: 0.5;
		pointer-events: none;
	}

	.gizmo .rays {
		stroke: var(--text-hi);
		stroke-width: 1.5;
	}

	.gizmo.sel .ring,
	.gizmo.sel .rays {
		stroke: var(--accent-hi);
		filter: drop-shadow(0 0 4px rgba(246, 110, 16, 0.7));
	}

	.header {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 36px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 6px;
		background: rgba(36, 40, 44, 0.92);
		border-bottom: 1px solid var(--hairline);
		user-select: none;
		-webkit-user-select: none;
		container-type: inline-size;
	}

	/* Channel keys shrink (labels ellipsised) rather than scroll when the viewport is narrow. */
	.channels {
		flex: 0 1 auto;
		min-width: 0;
	}

	.channels .fk {
		height: 24px;
		flex: 0 1 auto;
		min-width: 26px;
	}

	.channels .fk-face {
		padding: 0 8px;
		min-width: 0;
	}

	.channels .lbl {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.channels .fk.lit .fk-face {
		font-weight: 500;
	}

	.channels .lbl.short {
		display: none;
	}

	/* Too narrow for the full names: three-letter keys (then ellipsis as a last resort). */
	@container (max-width: 960px) {
		.channels .lbl.full {
			display: none;
		}

		.channels .lbl.short {
			display: inline;
		}

		.channels .fk-face {
			padding: 0 6px;
		}
	}

	/* Narrower still: a dropdown (the wheel steps through the views). */
	.ch-select {
		display: none;
		width: 150px;
		flex: none;
	}

	/* Which mask the Masks view shows, and its rename field. */
	.mask-select,
	.mask-rename {
		width: 130px;
		flex: none;
	}

	.mask-rename {
		height: 22px;
		padding: 0 8px;
		border: 1px solid var(--accent);
		border-radius: var(--r-field);
		background: var(--raised);
		color: var(--text-hi);
		font-size: 12px;
		box-shadow: var(--halo);
		outline: none;
	}

	@container (max-width: 720px) {
		.channels {
			display: none;
		}

		.ch-select {
			display: block;
		}
	}

	.tools {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 4px;
		flex: none;
	}

	/* View toggles (cf-toggle) and the Fit stud: 30 px icon squares. */
	.toggle,
	.fit {
		width: 30px;
		height: 30px;
		padding: 0;
	}

	.vsep {
		width: 1px;
		height: 20px;
		margin: 0 6px;
		background: var(--hairline);
	}

	.chip {
		display: flex;
		align-items: center;
		height: 22px;
		padding: 0 8px;
		margin-left: 4px;
		border: 1px solid var(--hairline);
		background: var(--sunken);
		font-size: 12px;
		color: var(--pill);
	}

	.readout {
		position: absolute;
		left: 12px;
		bottom: 10px;
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 11px;
		color: var(--text-lo);
		pointer-events: none;
	}

	.readout .hi {
		color: var(--pill);
	}

	.readout .sw {
		display: inline-block;
		width: 9px;
		height: 9px;
		border: 1px solid var(--line);
		vertical-align: -1px;
	}

	.status {
		position: absolute;
		right: 12px;
		bottom: 10px;
		display: grid;
		grid-template-columns: auto auto auto;
		align-items: center;
		gap: 4px 10px;
		padding: 7px 12px 8px;
		border: 1px solid var(--line);
		border-left: 2px solid var(--accent);
		border-radius: var(--r-field);
		background: rgba(44, 49, 54, 0.95);
		font-size: 12px;
		color: var(--text-hi);
		pointer-events: none;
	}

	.status.done {
		border-left-color: var(--pill);
	}

	.status .lo {
		color: var(--text-lo);
		font-size: 11px;
	}

	.status .bar {
		grid-column: 1 / -1;
		height: 2px;
		background: var(--hairline);
	}

	.status .bar > div {
		height: 100%;
		background: var(--e400);
	}

	.status.done .bar > div {
		background: var(--pill);
	}

	.errors {
		position: absolute;
		left: 12px;
		right: 12px;
		top: 40px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		pointer-events: none;
	}

	.error {
		padding: 6px 10px;
		border: 1px solid var(--blood);
		border-left-width: 2px;
		background: rgba(30, 33, 36, 0.95);
		font-size: 12px;
		color: var(--text);
		white-space: pre-wrap;
	}

	.error b {
		color: var(--blood);
		margin-right: 6px;
	}

	.fatal {
		position: absolute;
		inset: 30% 15% auto;
		padding: 20px 24px;
		border: 1px solid var(--line);
		border-left: 2px solid var(--blood);
		background: var(--panel);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.fatal-title {
		font-family: var(--font-serif);
		font-weight: 600;
		font-size: 22px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-hi);
	}

	.fatal .lo {
		color: var(--text-lo);
		font-size: 12px;
	}
</style>
