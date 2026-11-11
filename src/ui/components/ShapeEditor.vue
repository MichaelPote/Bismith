<script setup lang="ts">
	// Shape editor (docs/features/fr8.5-shape-editor.md): draw and edit shapes on the viewport.
	//   Grab      as Select, but a left-drag off the shapes pans the view (no marquee); the default on a shape layer
	//   Select    the selected item's shapes only — a Path layer's polygons, a Polyline layer's lines, the runs of a Pipes
	//             material or pipework layer, hand-placed splats: click a vertex or drag a marquee around some to select
	//             them (Shift adds), drag one to carry the selected ones along, click an edge to insert a vertex,
	//             right-click a vertex or press Delete to remove, click a shape to select it, drag a polygon's centre dot
	//             to move the whole polygon; a double-click anywhere starts a new shape there (Polygon or Line)
	//   Polygon   click to place vertices; Enter, double-click or a click on the first vertex closes it → a new Path layer
	//   Freehand  press and draw a closed shape → a new Path layer
	//   Line      click to place points; Enter, double-click or a click on the last point ends it → a new Polyline layer, or a
	//             new run of the selected Pipes, or a splat on each point of the selected Liquid splats
	// Backspace or a right-click drops the last point placed (a right-click with none placed goes back to Select), Esc
	// cancels; a hint under the tools says how to go on and finish. Splats' points stand alone (ShapeEdit.dots): drawn as
	// dots, no lines, and a click near the last one places another.
	// Drafts are kept in texture px and converted to the destination's units on commit. Vertices — dragged, or placed
	// while drawing — snap to half pixels (Alt: free); Ctrl (⌘) holds one to the nearest of the verticals and horizontals
	// through its neighbours (and to where two cross, near a crossing), Shift snaps it to every tenth pixel — or, with the
	// snap toggle on, it always snaps and Shift frees it. The `points` text stays the source of truth; the middle button
	// still pans.
	import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { MAX_PATH_POINTS, parsePointLines } from '@/core/bitmap';
	import type { ParamDef } from '@/core/params';
	import { layerParamDefs } from '@/layers/registry';
	import { useProjectStore } from '@/stores/project';
	import { useEditorStore, type ShapeTool } from '@/stores/editor';
	import { useActions } from '@/ui/actions';
	import { polygonCentroid, snapVertex } from '@/ui/gizmos';
	import {
		IconKeyboard,
		IconHandGrab,
		IconLine,
		IconMagnet,
		IconPointer,
		IconTrash,
		IconVectorSpline
	} from '@tabler/icons-vue';

	type Pt = [number, number];
	/** A pointer's place and the modifiers held: from a pointer event, or a key press mid-drag. */
	type Held = Pick<MouseEvent, 'clientX' | 'clientY' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

	const props = defineProps<{
		/** The selected layer whose shapes are edited (null: drawing only). */
		target: { kind: 'layer'; id: string } | null;
		/** The texture's rectangle on screen (CSS px, relative to the stage). */
		rect: { x: number; y: number; w: number; h: number };
		texW: number;
		texH: number;
		size: { w: number; h: number };
	}>();

	/** Screen px around a vertex that grab it (drag, delete) rather than add a vertex on the edge or select the shape. */
	const GRAB = 10;
	/** Screen px from a line across the one Ctrl holds a vertex to, within which it goes to their crossing. */
	const REACH = 8;
	/** How long (ms) after a click on an edge a double-click takes back the vertex that click inserted. */
	const DOUBLE_MS = 700;

	const store = useProjectStore();
	const editor = useEditorStore();
	const act = useActions();

	/** Where the selected item's shapes live, and how to write them back. */
	interface Source {
		open: boolean;
		fraction: boolean;
		budget: number;
		text: string;
		/** ParamDef.shapeEdit: the Line tool adds a line here instead of creating a layer (its button's name, tooltip). */
		adds: string | null;
		hint: string | null;
		/** Fewest points a shape keeps (1 for hand-placed splats, where each point is a splat; else 2 open, 3 closed). */
		min: number;
		/** Each point stands alone (ShapeEdit.dots, hand-placed splats): dots, no lines between them. */
		dots: boolean;
		write(text: string): void;
	}

	/** A source's shape from its param (ParamDef.shapeEdit, or a plain Path / Polyline one's). */
	function shapeOf(d: ParamDef, edit = d.shapeEdit) {
		const open = d.bitmap === 'lines';
		return {
			open,
			adds: edit?.adds ?? null,
			hint: edit?.hint ?? null,
			min: edit?.min ?? (open ? 2 : 3),
			dots: edit?.dots ?? false,
			budget: edit?.budget ?? MAX_PATH_POINTS
		};
	}

	const source = computed<Source | null>(() => {
		const t = props.target;
		if (!t) return null;
		const l = store.getLayer(t.id);
		const d = l && layerParamDefs(l.type).find((p) => p.bitmap === 'points' || p.bitmap === 'lines');
		if (!l || !d) return null;
		// A layer with a random layout (Pipework, Liquid splats): drawing switches it to the drawn one.
		const switchable = layerParamDefs(l.type).some(
			(p) => p.key === 'layout' && p.options?.some((o) => o.value === 'drawn')
		);
		const drawn = !switchable || l.params.layout === 'drawn';
		return {
			...shapeOf(d),
			fraction: l.params.units === 'fraction',
			text: drawn ? String(l.params[d.key] ?? '') : '',
			write: (text) => {
				if (!drawn) store.setLayerParam(l.id, 'layout', 'drawn');
				store.setLayerParam(l.id, d.key, text);
			}
		};
	});

	const open = computed(() => source.value?.open ?? false);
	/** Points that stand alone (hand-placed splats): dots, no lines — also while placing new ones. */
	const dots = computed(() => source.value?.dots ?? false);
	const drawingDots = computed(() => dots.value && tool.value === 'line');
	const fraction = computed(() => source.value?.fraction ?? false);
	/** The source's shapes, in its units (px, or fractions of the texture). */
	const shapes = computed<Pt[][]>(() => {
		const s = source.value;
		if (!s) return [];
		// (Single points too for hand-placed splats, where each is a splat.)
		return parsePointLines(s.text).filter((p) => p.length >= Math.max(1, s.min)) as Pt[][];
	});
	/** The shapes drawn over the texture: none with the viewport's gizmos hidden (a draft still shows, to draw it). */
	const shown = computed<Pt[][]>(() => (editor.showGizmos ? shapes.value : []));
	const total = computed(() => shapes.value.reduce((n, p) => n + p.length, 0));
	const minPoints = computed(() => source.value?.min ?? (open.value ? 2 : 3));

	const tool = computed<ShapeTool>({ get: () => editor.shapeTool, set: (v) => (editor.shapeTool = v) });
	const drawing = computed(() => tool.value === 'polygon' || tool.value === 'line');
	/** Grab or Select: the shapes' handles are up. */
	const picking = computed(() => tool.value === 'grab' || tool.value === 'select');
	/** Grab or Select, whichever was used last: where drawing returns to. */
	const home = ref<ShapeTool>(picking.value ? tool.value : 'grab');
	const selected = ref<number | null>(null);
	/** Selected vertices (a click, or the marquee), as `shape:vertex`. */
	const picked = ref(new Set<string>());
	const vkey = (shape: number, vert: number) => `${shape}:${vert}`;
	/** The shape being drawn, in texture px. */
	const draft = ref<Pt[]>([]);
	const hover = ref<Pt | null>(null);
	/** The snap lines the vertex under the pointer is on (Ctrl), drawn across the texture. */
	const guides = ref<{ x?: number; y?: number }>({});
	/** The marquee being dragged, in screen px. */
	const box = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
	/**
	 * Dragging a vertex: `from` is where it was taken (texture px), `at` the pointer, for a modifier pressed mid-drag;
	 * `group` the selected vertices it carries along, `around` its neighbours that stay put (Ctrl's lines go through them).
	 */
	let drag: {
		from: Pt;
		at: Held;
		group: { shape: number; vert: number; from: Pt }[];
		around: Pt[];
	} | null = null;
	/** Moving a whole polygon: where it was taken (texture px) and its vertices then, so rounding can't creep. */
	let moving: { shape: number; grab: Pt; from: Pt[] } | null = null;
	/** Dragging the marquee: the selection it adds to (Shift), and whether it has been dragged yet. */
	let marquee: { base: Set<string>; moved: boolean } | null = null;
	let sketching = false;
	/** The pointer while drawing, for a modifier pressed without a move. */
	let lastAt: Held | null = null;
	/** The shapes before a click on an edge inserted a vertex: a double-click there takes it back. */
	let inserted: { text: string; at: number; pos: Pt } | null = null;
	const svg = ref<SVGSVGElement | null>(null);

	function capture(e: PointerEvent, on: boolean): void {
		try {
			if (on) svg.value?.setPointerCapture(e.pointerId);
			else svg.value?.releasePointerCapture(e.pointerId);
		} catch {
			/* not an active pointer (e.g. synthetic events) */
		}
	}

	watch(
		() => props.target?.id,
		() => {
			selected.value = null;
			picked.value = new Set();
			// Switching to a shape layer starts in Grab (a draft in progress carries on).
			if (source.value && !draft.value.length) tool.value = 'grab';
		}
	);
	// Vertices added or removed (an insert, a delete, undo) renumber them: the selection would point at others.
	watch(
		() => shapes.value.map((p) => p.length).join(','),
		() => (picked.value = new Set()),
		{ flush: 'sync' }
	);

	// ---------------------------------------------------------------- coordinates
	const srcToPx = ([x, y]: Pt): Pt => (fraction.value ? [x * props.texW, y * props.texH] : [x, y]);
	const pxToSrc = ([x, y]: Pt, frac = fraction.value): Pt => (frac ? [x / props.texW, y / props.texH] : [x, y]);

	/** Texture px → screen. */
	function pxToScreen([x, y]: Pt): Pt {
		const r = props.rect;
		return [r.x + (x / props.texW) * r.w, r.y + (y / props.texH) * r.h];
	}
	const toScreen = (p: Pt): Pt => pxToScreen(srcToPx(p));

	/** Pointer → texture px (snapped to half pixels unless Alt). */
	function toPx(e: Pick<MouseEvent, 'clientX' | 'clientY' | 'altKey'>, snap = !e.altKey): Pt {
		const b = svg.value!.getBoundingClientRect();
		const r = props.rect;
		let x = ((e.clientX - b.left - r.x) / r.w) * props.texW;
		let y = ((e.clientY - b.top - r.y) / r.h) * props.texH;
		if (snap) {
			x = Math.round(x * 2) / 2;
			y = Math.round(y * 2) / 2;
		}
		return [x, y];
	}

	/**
	 * Where a vertex dragged or placed with the pointer at `at` goes (texture px), as the modifiers say: the 10 px grid
	 * (Shift, or unless Shift with the snap toggle on), half pixels (Alt: free), and with Ctrl onto the lines through
	 * `around` — its neighbours. Shows the lines it is on.
	 */
	function place(at: Held, around: Pt[]): Pt {
		const axis = (at.ctrlKey || at.metaKey) && around.length > 0;
		const { p, on } = snapVertex(toPx(at, false), {
			free: at.altKey,
			tens: editor.shapeSnap !== at.shiftKey,
			lines: axis ? { x: around.map((q) => q[0]), y: around.map((q) => q[1]) } : undefined,
			scale: [props.rect.w / props.texW, props.rect.h / props.texH],
			reach: REACH
		});
		guides.value = on;
		return p;
	}

	const fmt = (v: number, frac: boolean) => (frac ? String(Number(v.toFixed(4))) : String(Number(v.toFixed(2))));
	const shapeText = (list: Pt[][], frac: boolean, min: number) =>
		list
			.filter((p) => p.length >= min)
			.map((p) => p.map(([x, y]) => `${fmt(x, frac)},${fmt(y, frac)}`).join(' '))
			.join('\n');

	function write(next: Pt[][]): void {
		source.value?.write(shapeText(next, fraction.value, minPoints.value));
	}

	const copy = (): Pt[][] => shapes.value.map((p) => p.map(([x, y]) => [x, y] as Pt));
	const pathD = (p: Pt[], closed: boolean, conv = toScreen) =>
		p.map((q, i) => `${i ? 'L' : 'M'}${conv(q).join(' ')}`).join('') + (closed ? 'Z' : '');
	/** Edges of a shape: (j, j + 1), and the closing one for polygons. */
	const edges = (p: Pt[]) => (open.value ? p.slice(0, -1) : p).map((q, j) => [q, p[(j + 1) % p.length]] as [Pt, Pt]);

	/** A vertex's neighbours along its shape (the closing edge's too, for polygons); none for splats' lone points. */
	function neighbours(shape: number, vert: number): number[] {
		const n = shapes.value[shape]?.length ?? 0;
		if (dots.value || n < 2) return [];
		const out = new Set<number>();
		if (vert > 0) out.add(vert - 1);
		else if (!open.value) out.add(n - 1);
		if (vert < n - 1) out.add(vert + 1);
		else if (!open.value) out.add(0);
		out.delete(vert);
		return [...out];
	}

	// ---------------------------------------------------------------- select
	/** The pointer on screen (CSS px, relative to the stage). */
	function pointerAt(e: MouseEvent): Pt {
		const b = svg.value!.getBoundingClientRect();
		return [e.clientX - b.left, e.clientY - b.top];
	}

	/** The vertex nearest the pointer within GRAB screen px (the selected shape's first), if any. */
	function nearestVertex(e: MouseEvent): { shape: number; vert: number } | null {
		const [x, y] = pointerAt(e);
		let best: { shape: number; vert: number } | null = null;
		let bestD = GRAB;
		shapes.value.forEach((p, i) =>
			p.forEach((q, j) => {
				const [sx, sy] = toScreen(q);
				// The selected shape wins ties with a shape underneath, and a selected vertex with one on the same spot.
				const d =
					Math.hypot(sx - x, sy - y) - (i === selected.value ? 0.5 : 0) - (picked.value.has(vkey(i, j)) ? 0.25 : 0);
				if (d < bestD) {
					bestD = d;
					best = { shape: i, vert: j };
				}
			})
		);
		return best;
	}

	/** A press that starts a drag. As with the gizmos, a field still being typed in is finished: its own undo step. */
	function takePress(e: PointerEvent): void {
		e.stopPropagation();
		e.preventDefault();
		(document.activeElement as HTMLElement | null)?.blur();
		store.commitNow();
	}

	/**
	 * Grabs a vertex. A selected one carries every selected vertex along; another becomes the selection — or, with Shift,
	 * joins it but moves alone (Shift also snaps the drag to the grid: holding it to drag must not drag the others too).
	 */
	function startDrag(e: PointerEvent, shape: number, vert: number): void {
		takePress(e);
		selected.value = shape;
		const k = vkey(shape, vert);
		if (picked.value.has(k)) return beginDrag(e, shape, vert);
		picked.value = new Set(e.shiftKey ? [...picked.value, k] : [k]);
		beginDrag(e, shape, vert, [k]);
	}

	function beginDrag(e: PointerEvent, shape: number, vert: number, keys = [...picked.value]): void {
		const group = keys.flatMap((k) => {
			const [s, v] = k.split(':').map(Number);
			const q = shapes.value[s]?.[v];
			return q ? [{ shape: s, vert: v, from: srcToPx(q) }] : [];
		});
		const from = srcToPx(shapes.value[shape][vert]);
		// Ctrl's lines go through the neighbours that stay put; with none, through where the vertex was taken.
		const still = neighbours(shape, vert).filter((j) => !keys.includes(vkey(shape, j)));
		const around = still.length ? still.map((j) => srcToPx(shapes.value[shape][j])) : [from];
		drag = { from, at: e, group, around };
		capture(e, true);
	}

	/** Puts the dragged vertex under the pointer, as the modifiers held say, and the others it carries as far. */
	function dragVertex(at: Held): void {
		if (!drag) return;
		drag.at = at;
		const [x, y] = place(at, drag.around);
		const dx = x - drag.from[0];
		const dy = y - drag.from[1];
		const next = copy();
		for (const g of drag.group) next[g.shape][g.vert] = pxToSrc([g.from[0] + dx, g.from[1] + dy]);
		write(next);
	}

	/** Pressing or releasing a modifier mid-drag, or while placing vertices, applies it without a move. */
	function onModKey(e: KeyboardEvent): void {
		if (e.repeat || !['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return;
		const pos = drag?.at ?? (drawing.value ? lastAt : null);
		if (!pos) return;
		const { altKey, ctrlKey, metaKey, shiftKey } = e;
		const at = { clientX: pos.clientX, clientY: pos.clientY, altKey, ctrlKey, metaKey, shiftKey };
		if (drag) dragVertex(at);
		else {
			lastAt = at;
			hover.value = place(at, draftAround());
		}
	}

	function onVertexDown(e: PointerEvent): void {
		if (!picking.value || e.button !== 0) return;
		const v = nearestVertex(e);
		if (v) startDrag(e, v.shape, v.vert);
	}

	function deleteVertex(shape: number, vert: number): void {
		const next = copy();
		next[shape].splice(vert, 1);
		if (next[shape].length < minPoints.value) next.splice(shape, 1);
		write(next);
	}

	/** Deletes the selected vertices; a shape left with too few goes. */
	function deletePicked(): void {
		const next = copy();
		const keys = [...picked.value].map((k) => k.split(':').map(Number));
		for (const [s, v] of keys.sort((a, b) => b[0] - a[0] || b[1] - a[1])) next[s]?.splice(v, 1);
		picked.value = new Set();
		selected.value = null;
		write(next);
	}

	/** Right-click near a vertex deletes it. */
	function onVertexDelete(e: MouseEvent): void {
		const v = nearestVertex(e);
		if (!v) return;
		e.preventDefault();
		e.stopPropagation();
		deleteVertex(v.shape, v.vert);
	}

	function onEdgeDown(e: PointerEvent, shape: number, after: number): void {
		if (!picking.value || e.button !== 0) return;
		// Near a vertex, grab it instead of inserting one beside it.
		const v = nearestVertex(e);
		if (v) return startDrag(e, v.shape, v.vert);
		if (total.value >= (source.value?.budget ?? MAX_PATH_POINTS)) return;
		takePress(e);
		inserted = { text: source.value?.text ?? '', at: performance.now(), pos: pointerAt(e) };
		const next = copy();
		next[shape].splice(after + 1, 0, pxToSrc(place(e, [])));
		write(next);
		selected.value = shape;
		picked.value = new Set([vkey(shape, after + 1)]);
		beginDrag(e, shape, after + 1);
	}

	/** A press on empty space or a shape's area: drag a marquee around vertices to select them (Shift adds to the
	 * selection); a click selects the shape (or nothing) and clears the vertex selection. */
	function startMarquee(e: PointerEvent, shape: number | null): void {
		takePress(e);
		selected.value = shape;
		const [x, y] = pointerAt(e);
		marquee = { base: e.shiftKey || e.ctrlKey || e.metaKey ? new Set(picked.value) : new Set(), moved: false };
		box.value = { x0: x, y0: y, x1: x, y1: y };
		capture(e, true);
	}

	function dragMarquee(e: PointerEvent): void {
		if (!marquee || !box.value) return;
		const [x, y] = pointerAt(e);
		const b = (box.value = { ...box.value, x1: x, y1: y });
		if (!marquee.moved && Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < 3) return;
		marquee.moved = true;
		const [lx, hx] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)];
		const [ly, hy] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
		const next = new Set(marquee.base);
		shown.value.forEach((p, i) =>
			p.forEach((q, j) => {
				const [sx, sy] = toScreen(q);
				if (sx >= lx && sx <= hx && sy >= ly && sy <= hy) next.add(vkey(i, j));
			})
		);
		picked.value = next;
		const first = [...next][0];
		if (first) selected.value = Number(first.split(':')[0]);
	}

	function onShapeDown(e: PointerEvent, shape: number): void {
		if (!picking.value || e.button !== 0) return;
		const v = nearestVertex(e);
		if (v) return startDrag(e, v.shape, v.vert);
		if (tool.value === 'grab') grabDown(e, shape);
		else startMarquee(e, shape);
	}

	/**
	 * Grab: a press off the vertices passes on to the viewport, which pans; it selects the shape under it (or none), and
	 * a click that doesn't move clears the vertex selection (unless Shift).
	 */
	function grabDown(e: PointerEvent, shape: number | null): void {
		selected.value = shape;
		const [x0, y0] = [e.clientX, e.clientY];
		const keep = e.shiftKey;
		window.addEventListener(
			'pointerup',
			(u) => {
				if (!keep && Math.hypot(u.clientX - x0, u.clientY - y0) < 3) picked.value = new Set();
			},
			{ once: true }
		);
	}

	/** Each closed polygon's centre dot on screen, while its handles are up. */
	const centres = computed<Pt[]>(() =>
		picking.value && !open.value && !dots.value
			? shown.value.map((p) => pxToScreen(polygonCentroid(p.map(srcToPx))))
			: []
	);

	function onCentreDown(e: PointerEvent, shape: number): void {
		if (!picking.value || e.button !== 0) return;
		// A vertex nearer the press than the dot is (a small polygon's, or another polygon's under the dot) is what was meant.
		const v = nearestVertex(e);
		const at = pointerAt(e);
		const away = (q: Pt) => Math.hypot(q[0] - at[0], q[1] - at[1]);
		if (v && away(toScreen(shapes.value[v.shape][v.vert])) < away(centres.value[shape]))
			return startDrag(e, v.shape, v.vert);
		takePress(e);
		selected.value = shape;
		moving = { shape, grab: toPx(e, false), from: shapes.value[shape].map(srcToPx) };
		capture(e, true);
	}

	/** A double-click anywhere in Select starts a new shape there: a line (or pipe run) or a polygon, as the selected
	 * layer holds — on a vertex, exactly on it, so a new run can tee off an old one. */
	function onDbl(e: MouseEvent): void {
		if (!picking.value || !source.value) return;
		e.preventDefault();
		e.stopPropagation();
		// The double-click's first click, on an edge, inserted a vertex: take it back.
		const [x, y] = pointerAt(e);
		const there = inserted && Math.hypot(inserted.pos[0] - x, inserted.pos[1] - y) < 4;
		if (inserted && there && performance.now() - inserted.at < DOUBLE_MS) source.value.write(inserted.text);
		inserted = null;
		drag = null;
		const v = nearestVertex(e);
		const p = v ? srcToPx(shapes.value[v.shape][v.vert]) : place(e, []);
		picked.value = new Set();
		tool.value = open.value ? 'line' : 'polygon';
		draft.value = [p];
		lastAt = e;
		hover.value = p;
	}

	// ---------------------------------------------------------------- drawing
	/** Drop repeated points (a double-click places its point twice). */
	const dedupe = (pts: Pt[]) => pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);

	/** The draft's neighbours of the next vertex: the last placed and, for a polygon, the first (it closes back to it). */
	function draftAround(): Pt[] {
		const d = draft.value;
		if (!d.length) return [];
		return tool.value === 'polygon' && d.length >= 2 ? [d[d.length - 1], d[0]] : [d[d.length - 1]];
	}

	/** Finish the draft: a new Path or Polyline layer, or a new line of the selected pipes or splats. */
	function commit(): void {
		const pts = dedupe(draft.value);
		const kind = tool.value;
		draft.value = [];
		hover.value = null;
		if (kind === 'line') {
			const s = source.value;
			if (pts.length < (s?.adds ? s.min : 2)) return;
			if (s?.adds) {
				const run = shapeText([pts.map((p) => pxToSrc(p, s.fraction))], s.fraction, s.min);
				s.write(s.text.trim() ? `${s.text.trim()}\n${run}` : run);
				selected.value = shapes.value.length - 1;
			} else void act.addShapeLayer('polyline', shapeText([pts], false, 2));
		} else {
			if (pts.length < 3) return;
			void act.addShapeLayer('path', shapeText([pts], false, 3));
		}
		tool.value = home.value;
	}

	function onCaptureDown(e: PointerEvent): void {
		// Only the left button draws: the middle button still pans the view.
		if (e.button !== 0) return;
		if (tool.value === 'grab') return grabDown(e, null);
		if (tool.value === 'select') return startMarquee(e, null);
		e.stopPropagation();
		e.preventDefault();
		if (tool.value === 'freehand') {
			sketching = true;
			draft.value = [toPx(e, false)];
			capture(e, true);
			return;
		}
		const p = place(e, draftAround());
		const near = (q: Pt) => {
			const [ax, ay] = pxToScreen(q);
			const [bx, by] = pxToScreen(p);
			return Math.hypot(ax - bx, ay - by) < 8;
		};
		// Polygon: a click on the first vertex closes it. Line: a click on the last point ends it.
		if (tool.value === 'polygon' && draft.value.length >= 3 && near(draft.value[0])) return commit();
		// (Not for splats: placing them close together would end the batch by accident.)
		if (tool.value === 'line' && !dots.value && draft.value.length >= 2 && near(draft.value[draft.value.length - 1]))
			return commit();
		draft.value = [...draft.value, p];
		hover.value = place(e, draftAround());
	}

	function onMove(e: PointerEvent): void {
		if (moving) {
			const { shape, grab, from } = moving;
			const [x, y] = toPx(e, false);
			// The move snaps, not the vertices: the polygon keeps its shape.
			const step = (d: number) => (e.altKey ? d : Math.round(d * 2) / 2);
			const dx = step(x - grab[0]);
			const dy = step(y - grab[1]);
			const next = copy();
			next[shape] = from.map(([px, py]) => pxToSrc([px + dx, py + dy]));
			write(next);
			return;
		}
		if (drag) return dragVertex(e);
		if (marquee) return dragMarquee(e);
		if (sketching) {
			const p = toPx(e, false);
			const [ax, ay] = pxToScreen(draft.value[draft.value.length - 1]);
			const [bx, by] = pxToScreen(p);
			if (Math.hypot(ax - bx, ay - by) >= 3) draft.value = [...draft.value, p];
			return;
		}
		if (drawing.value) {
			lastAt = e;
			hover.value = place(e, draftAround());
		}
	}

	function onUp(e: PointerEvent): void {
		if (drag || moving) {
			drag = null;
			moving = null;
			guides.value = {};
			capture(e, false);
		}
		if (marquee) {
			// A click, not a drag: the selection goes back to what it added to (nothing, without Shift).
			if (!marquee.moved) picked.value = marquee.base;
			marquee = null;
			box.value = null;
			capture(e, false);
		}
		if (sketching) {
			sketching = false;
			capture(e, false);
			const simple = simplify(draft.value, MAX_PATH_POINTS);
			draft.value = simple.map(([x, y]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2] as Pt);
			commit();
		}
	}

	/** Ramer–Douglas–Peucker on a stroke (texture px), loosening the tolerance until it fits `budget` vertices. */
	function simplify(pts: Pt[], budget: number): Pt[] {
		if (pts.length <= 3) return pts;
		const rdp = (a: number, b: number, eps: number, keep: Set<number>) => {
			let best = -1;
			let far = 0;
			const [ax, ay] = pts[a];
			const [bx, by] = pts[b];
			const len = Math.hypot(bx - ax, by - ay) || 1e-9;
			for (let i = a + 1; i < b; i++) {
				const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
				if (d > far) {
					far = d;
					best = i;
				}
			}
			if (far > eps && best > 0) {
				keep.add(best);
				rdp(a, best, eps, keep);
				rdp(best, b, eps, keep);
			}
		};
		for (let eps = 0.75; ; eps *= 1.4) {
			const keep = new Set([0, pts.length - 1]);
			rdp(0, pts.length - 1, eps, keep);
			const out = [...keep].sort((a, b) => a - b).map((i) => pts[i]);
			if (out.length <= Math.max(3, budget) || eps > 1e6) return out.slice(0, Math.max(3, budget));
		}
	}

	function onCaptureDbl(e: MouseEvent): void {
		if (picking.value) return onDbl(e);
		e.stopPropagation();
		if (drawing.value) commit();
	}

	/** Right-click: in Select, deletes the vertex under it; while drawing, takes back the last point placed, or with
	 * none placed, goes back to Select. */
	function onContext(e: MouseEvent): void {
		if (picking.value) return onVertexDelete(e);
		e.preventDefault();
		e.stopPropagation();
		if (sketching) return;
		if (draft.value.length) {
			draft.value = draft.value.slice(0, -1);
			hover.value = lastAt ? place(lastAt, draftAround()) : null;
		} else tool.value = home.value;
	}

	// ---------------------------------------------------------------- toolbar
	/** Switching tools finishes a draft that is already a shape, and drops one that isn't. (Select → a drawing tool keeps
	 * the point a double-click started.) */
	watch(tool, (now, before) => {
		guides.value = {};
		if (now === 'grab' || now === 'select') home.value = now;
		if (before === 'grab' || before === 'select') return;
		if (draft.value.length && (before === 'polygon' || before === 'line')) {
			const keep = tool.value;
			editor.shapeTool = before;
			commit();
			editor.shapeTool = keep;
		}
		draft.value = [];
		hover.value = null;
	});

	function deleteSelected(): void {
		if (selected.value === null) return;
		const next = copy();
		next.splice(selected.value, 1);
		selected.value = null;
		write(next);
	}

	function onKey(e: KeyboardEvent): void {
		const t = e.target as HTMLElement | null;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
		if (e.key === 'Enter' && drawing.value && draft.value.length) {
			e.preventDefault();
			commit();
		} else if (e.key === 'Backspace' && drawing.value && draft.value.length) {
			e.preventDefault();
			e.stopPropagation();
			draft.value = draft.value.slice(0, -1);
			hover.value = lastAt ? place(lastAt, draftAround()) : null;
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && picking.value && picked.value.size) {
			// The selected vertices, not the layer.
			e.preventDefault();
			e.stopPropagation();
			deletePicked();
		} else if (e.key === 'Escape' && (draft.value.length || !picking.value || picked.value.size)) {
			e.preventDefault();
			e.stopPropagation();
			draft.value = [];
			picked.value = new Set();
			tool.value = home.value;
		}
	}
	onMounted(() => {
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('keydown', onModKey);
		window.addEventListener('keyup', onModKey);
	});
	onBeforeUnmount(() => {
		window.removeEventListener('keydown', onKey, true);
		window.removeEventListener('keydown', onModKey);
		window.removeEventListener('keyup', onModKey);
	});

	/** While drawing: what the next click does and how to finish — shown under the tools. */
	const drawHint = computed(() => {
		const n = draft.value.length;
		const undo = n ? ' · right-click or Backspace removes the last' : '';
		if (tool.value === 'freehand') return 'Press and draw; release to close the shape · Esc cancels';
		if (tool.value === 'polygon')
			return n < 3
				? `Click to place vertices (${n} of at least 3) · Esc cancels${undo}`
				: `Click to add vertices · close it: click the first vertex, double-click or Enter${undo} · Esc cancels`;
		if (tool.value !== 'line') return '';
		const what = source.value?.adds ? source.value.adds.toLowerCase() : 'points';
		if (drawingDots.value)
			return n
				? `${n} placed · click to place more · add them: double-click or Enter${undo} · Esc cancels`
				: `Click to place ${what}, one on each click · then double-click or press Enter · Esc cancels`;
		return n < 2
			? `Click to place points (${n} of at least 2) · Esc cancels${undo}`
			: `Click to add points · finish: click the last point, double-click or Enter${undo} · Esc cancels`;
	});

	const draftClosed = computed(() => tool.value === 'polygon' || tool.value === 'freehand');
	const draftPath = computed(() => {
		const pts = drawing.value && hover.value ? [...draft.value, hover.value] : draft.value;
		return pathD(pts, draftClosed.value && !sketching, pxToScreen);
	});
	/** The marquee as an SVG rect. */
	const boxRect = computed(() => {
		const b = box.value;
		if (!b || !marquee?.moved) return null;
		return { x: Math.min(b.x0, b.x1), y: Math.min(b.y0, b.y1), w: Math.abs(b.x1 - b.x0), h: Math.abs(b.y1 - b.y0) };
	});
	/** Ctrl's snap lines, on screen across the texture. */
	const guideLines = computed(() => {
		const r = props.rect;
		const g = guides.value;
		const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
		if (g.x !== undefined) {
			const x = pxToScreen([g.x, 0])[0];
			out.push({ x1: x, y1: r.y, x2: x, y2: r.y + r.h });
		}
		if (g.y !== undefined) {
			const y = pxToScreen([0, g.y])[1];
			out.push({ x1: r.x, y1: y, x2: r.x + r.w, y2: y });
		}
		return out;
	});
</script>

<template>
	<svg
		ref="svg"
		class="shape-editor"
		:width="size.w"
		:height="size.h"
		@pointermove="onMove"
		@pointerup="onUp"
		@pointercancel="onUp"
		@contextmenu="onContext"
		@dblclick="onDbl">
		<!-- Drawing tools capture the whole stage (left button only); Select does, for the marquee, while it has shapes. -->
		<rect
			v-if="!picking || (source && editor.showGizmos)"
			class="capture"
			:class="{ marq: tool === 'select', grab: tool === 'grab' }"
			x="0"
			y="0"
			:width="size.w"
			:height="size.h"
			@pointerdown="onCaptureDown"
			@dblclick="onCaptureDbl" />
		<g v-for="(p, i) in shown" :key="`p${i}`" :class="{ sel: selected === i, open }">
			<path
				v-if="!dots"
				:d="pathD(p, !open)"
				class="fill"
				:class="{ live: picking }"
				@pointerdown="onShapeDown($event, i)" />
			<template v-if="picking">
				<!-- A wide clear stroke under each edge, so a click near it inserts a vertex. -->
				<g
					v-for="([a, b], j) in dots ? [] : edges(p)"
					:key="`e${j}`"
					class="edge"
					@pointerdown="onEdgeDown($event, i, j)">
					<line class="edge-hit" :x1="toScreen(a)[0]" :y1="toScreen(a)[1]" :x2="toScreen(b)[0]" :y2="toScreen(b)[1]" />
					<line class="edge-line" :x1="toScreen(a)[0]" :y1="toScreen(a)[1]" :x2="toScreen(b)[0]" :y2="toScreen(b)[1]" />
				</g>
				<g v-for="(q, j) in p" :key="`v${j}`" class="vgrab" @pointerdown="onVertexDown">
					<circle class="hit" :cx="toScreen(q)[0]" :cy="toScreen(q)[1]" :r="GRAB" />
					<circle
						class="vertex"
						:class="{ end: open && !dots && (j === 0 || j === p.length - 1), picked: picked.has(vkey(i, j)) }"
						:cx="toScreen(q)[0]"
						:cy="toScreen(q)[1]"
						r="4.5" />
				</g>
			</template>
			<template v-else-if="dots">
				<circle v-for="(q, j) in p" :key="`o${j}`" class="dot" :cx="toScreen(q)[0]" :cy="toScreen(q)[1]" r="2.5" />
			</template>
			<path v-else :d="pathD(p, !open)" class="outline" />
		</g>
		<!-- Above every shape, so that a polygon lying over another can't cover its dot. -->
		<g
			v-for="(c, i) in centres"
			:key="`c${i}`"
			class="centre"
			:class="{ sel: selected === i }"
			@pointerdown="onCentreDown($event, i)">
			<circle class="hit" :cx="c[0]" :cy="c[1]" r="11" />
			<circle class="ring" :cx="c[0]" :cy="c[1]" r="9" />
			<path class="cross" :d="`M${c[0] - 4} ${c[1]}h8M${c[0]} ${c[1] - 4}v8`" />
		</g>
		<line v-for="(g, k) in guideLines" :key="`g${k}`" class="guide" v-bind="g" />
		<rect v-if="boxRect" class="marquee" :x="boxRect.x" :y="boxRect.y" :width="boxRect.w" :height="boxRect.h" />
		<template v-if="draft.length">
			<path v-if="!drawingDots" :d="draftPath" class="draft" :class="{ open: !draftClosed }" />
			<circle
				v-for="(q, j) in tool === 'freehand' ? [] : draft"
				:key="`d${j}`"
				class="vertex draftv"
				:class="{ first: !drawingDots && (tool === 'polygon' ? j === 0 : j === draft.length - 1) }"
				:cx="pxToScreen(q)[0]"
				:cy="pxToScreen(q)[1]"
				r="4" />
		</template>
	</svg>
	<div class="shape-tools" @pointerdown.stop>
		<button
			type="button"
			:class="{ on: tool === 'grab' }"
			title="Grab: as Select, but dragging off the shapes moves the view. Drag vertices, click an edge to add one, right-click a vertex or press Delete to remove, drag a polygon's centre dot to move it, double-click to start a new shape"
			@click="tool = 'grab'">
			<IconHandGrab :size="13" />Grab
		</button>
		<button
			type="button"
			:class="{ on: tool === 'select' }"
			title="Select the selected layer's vertices: click one, or drag a box around some (Shift adds), and drag to move them together. Click an edge to add a vertex, right-click a vertex or press Delete to remove, drag a polygon's centre dot to move it, double-click to start a new shape. Dragging or placing a vertex: Ctrl holds it to the lines through its neighbours, Shift snaps to every 10 px"
			@click="tool = 'select'">
			<IconPointer :size="13" />Select
		</button>
		<!-- A layer with its own drawing (pipe runs, splats) shows only that tool. -->
		<template v-if="!source?.adds">
			<button
				type="button"
				:class="{ on: tool === 'polygon' }"
				title="Polygon: click to place vertices; Enter, double-click or the first vertex closes it — a new Path layer"
				@click="tool = 'polygon'">
				<IconLine :size="13" />Polygon
			</button>
			<button
				type="button"
				:class="{ on: tool === 'freehand' }"
				title="Freehand: press and draw a shape — a new Path layer"
				@click="tool = 'freehand'">
				<IconVectorSpline :size="13" />Freehand
			</button>
		</template>
		<button
			type="button"
			:class="{ on: tool === 'line' }"
			:title="`${source?.adds ?? 'Line'}: click to place points; Enter, double-click or the last point ends it — ${source?.hint ?? 'a new Polyline layer'}`"
			@click="tool = 'line'">
			<IconLine :size="13" />{{ source?.adds ?? 'Line' }}
		</button>
		<button
			v-if="shapes.length > 1"
			type="button"
			:disabled="selected === null"
			title="Delete the selected shape"
			@click="deleteSelected">
			<IconTrash :size="13" />
		</button>
		<button
			type="button"
			:class="{ on: editor.shapeSnap }"
			:aria-pressed="editor.shapeSnap"
			title="Snap to grid: on, vertices always snap to every 10 px while dragged or placed, and Shift frees them; off, Shift snaps them"
			@click="editor.shapeSnap = !editor.shapeSnap">
			<IconMagnet :size="13" />
		</button>
		<span v-if="source" class="count cf-mono" :class="{ full: total >= source.budget }" title="Vertices used"
			>{{ total }}/{{ source.budget }}</span
		>
	</div>
	<div v-if="drawHint" class="draw-hint" role="status">
		<IconKeyboard :size="13" />
		<span>{{ drawHint }}</span>
	</div>
</template>

<style scoped>
	.shape-editor {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.capture {
		fill: transparent;
		pointer-events: all;
		cursor: crosshair;
	}
	.fill {
		fill: rgba(246, 110, 16, 0.08);
		stroke: none;
	}
	.fill.live {
		pointer-events: fill;
		cursor: pointer;
	}
	.sel .fill {
		fill: rgba(246, 110, 16, 0.16);
	}
	.outline {
		fill: none;
		stroke: var(--text-hi);
		stroke-width: 1;
		opacity: 0.7;
	}
	.edge {
		cursor: copy;
	}
	.edge-hit {
		stroke: transparent;
		stroke-width: 18;
		stroke-linecap: round;
		pointer-events: stroke;
	}
	.edge-line {
		stroke: var(--text-hi);
		stroke-width: 1.25;
		pointer-events: none;
	}
	.edge:hover .edge-line {
		stroke: var(--accent-hi);
		stroke-width: 3;
	}
	.sel .edge-line {
		stroke: var(--accent-hi);
	}
	.vgrab {
		cursor: move;
	}
	.hit {
		fill: transparent;
		stroke: none;
		pointer-events: all;
	}
	.vertex {
		fill: rgba(23, 25, 28, 0.8);
		stroke: var(--text-hi);
		stroke-width: 1.5;
		pointer-events: none;
	}
	.sel .vertex {
		stroke: var(--accent-hi);
	}
	.vgrab:hover .vertex,
	.vertex.picked {
		fill: var(--accent-hi);
	}
	.capture.marq {
		cursor: default;
	}
	.capture.grab {
		cursor: grab;
	}
	.marquee {
		fill: rgba(246, 110, 16, 0.08);
		stroke: var(--accent-hi);
		stroke-width: 1;
		stroke-dasharray: 3 3;
		pointer-events: none;
	}
	.guide {
		stroke: var(--accent-hi);
		stroke-width: 1;
		stroke-dasharray: 2 4;
		opacity: 0.8;
		pointer-events: none;
	}
	.centre {
		cursor: move;
	}
	.ring {
		fill: rgba(23, 25, 28, 0.55);
		stroke: var(--text-hi);
		stroke-width: 1.5;
		pointer-events: none;
	}
	.centre.sel .ring,
	.centre:hover .ring {
		stroke: var(--accent-hi);
	}
	.cross {
		stroke: var(--text-hi);
		stroke-width: 1.5;
		pointer-events: none;
	}
	.open .fill {
		fill: none;
		stroke: rgba(246, 110, 16, 0.35);
		stroke-width: 6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.open .fill.live {
		pointer-events: stroke;
	}
	.sel.open .fill {
		stroke: rgba(246, 110, 16, 0.55);
	}
	.vertex.end {
		fill: var(--text-hi);
	}
	.draft.open {
		fill: none;
	}
	.draft {
		fill: rgba(246, 110, 16, 0.08);
		stroke: var(--accent-hi);
		stroke-width: 1.5;
		stroke-dasharray: 4 3;
		pointer-events: none;
	}
	.draftv {
		pointer-events: none;
	}
	.draftv.first {
		fill: var(--accent-hi);
	}
	/* While drawing: how to go on and finish, under the tools. */
	.draw-hint {
		position: absolute;
		left: 12px;
		top: 84px;
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: calc(100% - 24px);
		padding: 4px 9px;
		background: rgba(23, 25, 28, 0.88);
		border: 1px solid var(--hairline);
		border-radius: 6px;
		color: var(--text-hi);
		font-size: 12px;
		pointer-events: none;
		z-index: 3;
	}
	.draw-hint svg {
		flex: none;
		color: var(--accent-hi);
	}
	.dot {
		fill: var(--text-hi);
		stroke: rgba(23, 25, 28, 0.8);
		stroke-width: 1;
		pointer-events: none;
	}
	.shape-tools {
		position: absolute;
		left: 12px;
		top: 44px;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		background: rgba(23, 25, 28, 0.88);
		border: 1px solid var(--hairline);
		border-radius: 6px;
		z-index: 3;
	}
	.shape-tools button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 24px;
		padding: 0 8px;
		font-size: 12px;
		color: var(--text);
		background: none;
		border: 0;
		border-radius: 4px;
		cursor: pointer;
	}
	.shape-tools button:hover {
		background: var(--sunken);
	}
	.shape-tools button.on {
		color: var(--accent-hi);
		background: var(--sunken);
	}
	.shape-tools button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.count {
		font-size: 11px;
		color: var(--text-lo);
		padding: 0 6px;
	}
	.count.full {
		color: var(--accent-hi);
	}
</style>
