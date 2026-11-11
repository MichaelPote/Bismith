<script setup lang="ts">
	// The selected Area layer's viewport gizmo (FR8.30; LayerDef.area): the area's outline — drag an edge or corner to
	// resize it, the move stud to move it — and the grid over it: drag a line to resize its two cells, click just outside
	// an edge to add a line there, right-click a line to remove it. On the panel under the pointer (only there) studs
	// switch it off / on and, for layers whose grid is their layout (Panelling), merge it with the next strip of cells
	// or break a merge apart. The edits are pure functions in core/grid.ts; this draws them and writes the params.
	import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
	import {
		IconArrowDown,
		IconArrowLeft,
		IconArrowRight,
		IconArrowUp,
		IconArrowsHorizontal,
		IconArrowsMove,
		IconArrowsVertical,
		IconEye,
		IconEyeOff,
		IconPlus,
		IconPointer
	} from '@tabler/icons-vue';
	import type { Layer, Project } from '@/core/project';
	import {
		areaPx,
		breakAll,
		breakAt,
		edgesPx,
		layoutGrid,
		staggerAlong,
		gridParams,
		grow,
		grown,
		moveLine,
		panelAt,
		panelOff,
		panels,
		removeLine,
		split,
		toggle,
		MAX_GRID,
		type Axis,
		type Dir,
		type Grid,
		type Span
	} from '@/core/grid';
	import { getLayerDef } from '@/layers/registry';
	import { useProjectStore } from '@/stores/project';
	import { vTip } from '@/ui/tooltip';

	type Pt = [number, number];
	type Side = 'l' | 'r' | 't' | 'b';

	const props = defineProps<{
		layer: Layer;
		project: Project;
		/** The texture's rectangle on screen (CSS px, relative to the stage). */
		rect: { x: number; y: number; w: number; h: number };
		size: { w: number; h: number };
	}>();

	const store = useProjectStore();

	/** Hit width either side of a line or edge (screen px): a press this close goes to the line, not a stud. */
	const HIT = 6;
	/** The add band: this far outside the area's edges (screen px). */
	const ADD_IN = 8;
	const ADD_OUT = 30;
	/** Studs sit this far in from a panel's sides (centre, screen px). */
	const INSET = 19;
	/** The smallest cell or area (texture px). */
	const MIN_PX = 4;

	const W = computed(() => props.project.width);
	const H = computed(() => props.project.height);
	const layout = computed(() => getLayerDef(props.layer.type)?.area === 'layout');
	// As it lays out: with a stagger, merges keep to the rows (columns) that slide (and edits keep them there).
	const grid = computed<Grid>(() => layoutGrid(props.layer.params));
	const along = computed(() => staggerAlong(props.layer.params));
	const area = computed(() => areaPx(props.layer.params, W.value, H.value));

	const sx = (x: number) => props.rect.x + (x / W.value) * props.rect.w;
	const sy = (y: number) => props.rect.y + (y / H.value) * props.rect.h;
	const tx = (x: number) => ((x - props.rect.x) / props.rect.w) * W.value;
	const ty = (y: number) => ((y - props.rect.y) / props.rect.h) * H.value;

	/** The grid lines in texture px, from the area's corner — as the render rounds them. */
	const xsPx = computed(() => edgesPx(grid.value.cols, area.value.w));
	const ysPx = computed(() => edgesPx(grid.value.rows, area.value.h));
	/** …and on screen. */
	const X = computed(() => xsPx.value.map((v) => sx(area.value.x + v)));
	const Y = computed(() => ysPx.value.map((v) => sy(area.value.y + v)));
	const box = computed(() => {
		const x = X.value;
		const y = Y.value;
		return { l: x[0], r: x[x.length - 1], t: y[0], b: y[y.length - 1] };
	});

	const allPanels = computed(() => panels(grid.value));
	const panelBox = (p: Span) => ({
		x: X.value[p.c],
		y: Y.value[p.r],
		w: X.value[p.c + p.w] - X.value[p.c],
		h: Y.value[p.r + p.h] - Y.value[p.r]
	});
	const offPanels = computed(() => allPanels.value.filter((p) => panelOff(grid.value, p)).map(panelBox));

	/** A grid line's visible stretches (not inside a merged panel): [from, to] cell indices along it. */
	interface Seg {
		axis: Axis;
		k: number;
		x1: number;
		y1: number;
		x2: number;
		y2: number;
	}
	/**
	 * A layer's stagger (Panelling's Stagger, `stagger` / `stag_by`): alternate columns' rows (or rows' columns) shifted
	 * and wrapped round. The gizmo edits the unshifted layout and draws the shifted lines as ghosts.
	 */
	const stagger = computed(() => {
		const p = props.layer.params;
		const s = Number(p.stagger) || 0;
		if (s <= 0) return null;
		const g = grid.value;
		const nr = g.rows.length;
		// Rails (Panelling's top and bottom rows) stay put: the stagger wraps between them.
		const top = nr > 1 && (p.band_top ?? 'none') !== 'none' ? 1 : 0;
		const bot = nr > 1 && (p.band_bot ?? 'none') !== 'none' ? 1 : 0;
		return { by: (p.stag_by === 'rows' ? 'row' : 'col') as Axis, s, top, bot };
	});
	const shifted = (axis: Axis, i: number) => {
		const st = stagger.value;
		return Boolean(st && st.by === axis && (i & 1) === 1);
	};
	/** Dashed lines where the shifted columns' rows (or rows' columns) are. */
	const ghosts = computed(() => {
		const st = stagger.value;
		if (!st) return [];
		const g = grid.value;
		const a = area.value;
		const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
		if (st.by === 'col') {
			const ys = ysPx.value;
			const k0 = st.top;
			const k1 = g.rows.length - st.bot;
			const lo = ys[k0];
			const hi = ys[k1];
			const shift = (st.s * (hi - lo)) / Math.max(k1 - k0, 1);
			for (let c = 1; c < g.cols.length; c += 2)
				for (let k = k0; k < k1; k++) {
					const y = sy(a.y + lo + ((((ys[k] - lo + shift) % (hi - lo)) + (hi - lo)) % (hi - lo)));
					out.push({ x1: X.value[c], y1: y, x2: X.value[c + 1], y2: y });
				}
		} else {
			const xs = xsPx.value;
			const shift = (st.s * a.w) / g.cols.length;
			for (let r = 1; r < g.rows.length; r += 2) {
				if ((st.top && r === 0) || (st.bot && r === g.rows.length - 1)) continue;
				for (let k = 0; k < g.cols.length; k++) {
					const x = sx(a.x + ((((xs[k] + shift) % a.w) + a.w) % a.w));
					out.push({ x1: x, y1: Y.value[r], x2: x, y2: Y.value[r + 1] });
				}
			}
		}
		return out;
	});

	const segments = computed<Seg[]>(() => {
		const g = grid.value;
		const out: Seg[] = [];
		const nc = g.cols.length;
		const nr = g.rows.length;
		const sameP = (a: Span, b: Span) => a.c === b.c && a.r === b.r;
		for (let k = 1; k < nc; k++) {
			let start = -1;
			for (let r = 0; r <= nr; r++) {
				// In a shifted row the column lines are ghosts (drawn apart, not edited there).
				const vis = r < nr && !shifted('row', r) && !sameP(panelAt(g, k - 1, r), panelAt(g, k, r));
				if (vis && start < 0) start = r;
				if (!vis && start >= 0) {
					out.push({ axis: 'col', k, x1: X.value[k], y1: Y.value[start], x2: X.value[k], y2: Y.value[r] });
					start = -1;
				}
			}
		}
		for (let k = 1; k < nr; k++) {
			let start = -1;
			for (let c = 0; c <= nc; c++) {
				const vis = c < nc && !shifted('col', c) && !sameP(panelAt(g, c, k - 1), panelAt(g, c, k));
				if (vis && start < 0) start = c;
				if (!vis && start >= 0) {
					out.push({ axis: 'row', k, x1: X.value[start], y1: Y.value[k], x2: X.value[c], y2: Y.value[k] });
					start = -1;
				}
			}
		}
		return out;
	});

	// ------------------------------------------------------------------------------------------------ hover

	type Hover =
		| { kind: 'panel'; p: Span }
		| { kind: 'line'; axis: Axis; k: number }
		| { kind: 'edge'; sides: Side[] }
		| { kind: 'add'; axis: Axis; i: number; t: number; at: Pt }
		| { kind: 'move' }
		| null;

	const svgEl = ref<SVGSVGElement | null>(null);
	const ptr = ref<Pt | null>(null);
	/** The pointer is over the viewport: only then does the gizmo draw more than the area's outline and off cells. */
	const inside = ref(false);
	const hover = ref<Hover>(null);

	/** The column (row) a screen position falls in, and its share left of (above) it. */
	function cellAlong(lines: number[], v: number): { i: number; t: number } {
		let i = 0;
		while (i < lines.length - 2 && v >= lines[i + 1]) i++;
		return { i, t: (v - lines[i]) / Math.max(lines[i + 1] - lines[i], 1e-6) };
	}

	function hoverAt(p: Pt): Hover {
		const [x, y] = p;
		const b = box.value;
		const inX = x >= b.l - HIT && x <= b.r + HIT;
		const inY = y >= b.t - HIT && y <= b.b + HIT;
		// The edges and corners of the area.
		const sides: Side[] = [];
		if (inY && Math.abs(x - b.l) <= HIT) sides.push('l');
		if (inY && Math.abs(x - b.r) <= HIT) sides.push('r');
		if (inX && Math.abs(y - b.t) <= HIT) sides.push('t');
		if (inX && Math.abs(y - b.b) <= HIT) sides.push('b');
		if (sides.length) return { kind: 'edge', sides };
		// The add bands just outside.
		const full = (lines: number[]) => lines.length - 1 < MAX_GRID;
		const inBand = (d: number) => d >= ADD_IN && d <= ADD_OUT;
		if (x > b.l + HIT && x < b.r - HIT && (inBand(b.t - y) || inBand(y - b.b)) && full(X.value)) {
			const { i, t } = cellAlong(X.value, x);
			return {
				kind: 'add',
				axis: 'col',
				i,
				t,
				at: [x, y < b.t ? (b.t - ADD_IN + b.t - ADD_OUT) / 2 : (b.b + ADD_IN + b.b + ADD_OUT) / 2]
			};
		}
		if (y > b.t + HIT && y < b.b - HIT && (inBand(b.l - x) || inBand(x - b.r)) && full(Y.value)) {
			const { i, t } = cellAlong(Y.value, y);
			return {
				kind: 'add',
				axis: 'row',
				i,
				t,
				at: [x < b.l ? (b.l - ADD_IN + b.l - ADD_OUT) / 2 : (b.r + ADD_IN + b.r + ADD_OUT) / 2, y]
			};
		}
		if (x < b.l || x > b.r || y < b.t || y > b.b) return null;
		// A grid line's visible stretch.
		for (const s of segments.value) {
			const near =
				s.axis === 'col'
					? Math.abs(x - s.x1) <= HIT && y >= s.y1 && y <= s.y2
					: Math.abs(y - s.y1) <= HIT && x >= s.x1 && x <= s.x2;
			if (near) return { kind: 'line', axis: s.axis, k: s.k };
		}
		const c = cellAlong(X.value, x).i;
		const r = cellAlong(Y.value, y).i;
		return { kind: 'panel', p: panelAt(grid.value, c, r) };
	}

	function local(e: PointerEvent): Pt | null {
		const r = svgEl.value?.getBoundingClientRect();
		return r ? [e.clientX - r.left, e.clientY - r.top] : null;
	}

	// ------------------------------------------------------------------------------------------------ edits

	function write(next: Grid): void {
		const patch = gridParams(next);
		for (const [k, v] of Object.entries(patch))
			if (props.layer.params[k] !== v) store.setLayerParam(props.layer.id, k, v);
	}
	function writeArea(l: number, t: number, w: number, h: number): void {
		const patch: Record<string, number> = {
			area_x: +(l / W.value).toFixed(6),
			area_y: +(t / H.value).toFixed(6),
			area_w: +(w / W.value).toFixed(6),
			area_h: +(h / H.value).toFixed(6)
		};
		for (const [k, v] of Object.entries(patch))
			if (props.layer.params[k] !== v) store.setLayerParam(props.layer.id, k, v);
	}

	const hovered = computed(() => (hover.value?.kind === 'panel' && !drag.value ? hover.value.p : null));

	/** The hovered panel's studs: merge arrows, break buttons and the on / off switch. */
	interface Stud {
		key: string;
		x: number;
		y: number;
		icon: unknown;
		tip: string;
		act: (e: MouseEvent) => void;
		off?: boolean;
	}
	const ARROWS: { dir: Dir; icon: unknown; tip: string }[] = [
		{ dir: 'up', icon: IconArrowUp, tip: 'Merge with the cells above' },
		{ dir: 'down', icon: IconArrowDown, tip: 'Merge with the cells below' },
		{ dir: 'left', icon: IconArrowLeft, tip: 'Merge with the cells to the left' },
		{ dir: 'right', icon: IconArrowRight, tip: 'Merge with the cells to the right' }
	];
	const studs = computed<Stud[]>(() => {
		const p = hovered.value;
		if (!p) return [];
		const g = grid.value;
		const b = panelBox(p);
		const cx = b.x + b.w / 2;
		const cy = b.y + b.h / 2;
		const out: Stud[] = [];
		const off = panelOff(g, p);
		// The switch: top-left, clear of the arrows and break studs.
		out.push({
			key: 'toggle',
			x: b.x + INSET,
			y: b.y + INSET,
			icon: off ? IconEyeOff : IconEye,
			tip: off ? 'Switched off: click to draw this cell again' : 'Switch this cell off: the layer draws nothing here',
			act: () => write(toggle(g, p)),
			off
		});
		if (!layout.value) return out;
		for (const a of ARROWS) {
			if (!grown(g, p, a.dir)) continue;
			// No merging across staggered rows (columns): they slide apart.
			if (along.value === (a.dir === 'up' || a.dir === 'down' ? 'row' : 'col')) continue;
			const at: Pt =
				a.dir === 'up'
					? [cx, b.y + INSET]
					: a.dir === 'down'
						? [cx, b.y + b.h - INSET]
						: a.dir === 'left'
							? [b.x + INSET, cy]
							: [b.x + b.w - INSET, cy];
			// The up arrow beside the switch when the panel is narrow.
			if (a.dir === 'up' && b.w < 4 * INSET) at[0] = b.x + b.w - INSET;
			out.push({ key: a.dir, x: at[0], y: at[1], icon: a.icon, tip: a.tip, act: () => write(grow(g, p, a.dir)) });
		}
		// Break studs on the lines inside a merge: a column line's in the panel's top row, a row line's in its left column,
		// so crossing lines don't share a spot.
		const brk = (axis: Axis, k: number) => (e: MouseEvent) =>
			write(e.shiftKey ? breakAll(g, p) : breakAt(g, p, axis, k));
		for (let k = p.c + 1; k < p.c + p.w; k++)
			out.push({
				key: `bc${k}`,
				x: X.value[k],
				y: (Y.value[p.r] + Y.value[p.r + 1]) / 2,
				icon: IconArrowsHorizontal,
				tip: 'Split the panel here (Shift: into single cells)',
				act: brk('col', k)
			});
		for (let k = p.r + 1; k < p.r + p.h; k++)
			out.push({
				key: `br${k}`,
				x: (X.value[p.c] + X.value[p.c + 1]) / 2,
				y: Y.value[k],
				icon: IconArrowsVertical,
				tip: 'Split the panel here (Shift: into single cells)',
				act: brk('row', k)
			});
		return out;
	});

	function onStud(e: MouseEvent, s: Stud): void {
		e.stopPropagation();
		s.act(e);
	}

	// ------------------------------------------------------------------------------------------------ drags

	type Drag =
		| { kind: 'line'; axis: Axis; k: number; id: number }
		| { kind: 'edge'; sides: Side[]; id: number; from: { l: number; t: number; r: number; b: number } }
		| { kind: 'move'; id: number; grab: Pt };
	const drag = ref<Drag | null>(null);
	let mods = { shift: false, ctrl: false };

	function onDown(e: PointerEvent, kind: 'line' | 'edge' | 'move' | 'add'): void {
		if (e.button !== 0) return;
		const p = local(e);
		if (!p) return;
		e.stopPropagation();
		e.preventDefault();
		(document.activeElement as HTMLElement | null)?.blur();
		store.commitNow();
		const h = hoverAt(p);
		if (kind === 'add') {
			if (h?.kind === 'add') write(split(grid.value, h.axis, h.i, h.t));
			hover.value = hoverAt(p);
			return;
		}
		const a = area.value;
		if (kind === 'move') {
			drag.value = { kind: 'move', id: e.pointerId, grab: [tx(p[0]) - a.x, ty(p[1]) - a.y] };
		} else if (kind === 'edge' && h?.kind === 'edge') {
			drag.value = {
				kind: 'edge',
				sides: h.sides,
				id: e.pointerId,
				from: { l: a.x, t: a.y, r: a.x + a.w, b: a.y + a.h }
			};
		} else if (kind === 'line' && h?.kind === 'line') {
			drag.value = { kind: 'line', axis: h.axis, k: h.k, id: e.pointerId };
		} else return;
		mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	}

	function onLineMenu(e: MouseEvent): void {
		e.preventDefault();
		e.stopPropagation();
		const p = local(e as PointerEvent);
		const h = p && hoverAt(p);
		if (h?.kind !== 'line') return;
		store.commitNow();
		write(removeLine(grid.value, h.axis, h.k));
		store.commitNow();
	}

	const snapPx = (v: number) => (mods.shift ? Math.round(v / 10) * 10 : Math.round(v));

	function apply(): void {
		const d = drag.value;
		const p = ptr.value;
		if (!d || !p) return;
		const a = area.value;
		if (d.kind === 'line') {
			const n = d.axis === 'col' ? a.w : a.h;
			const lines = d.axis === 'col' ? xsPx.value : ysPx.value;
			let v = d.axis === 'col' ? tx(p[0]) - a.x : ty(p[1]) - a.y;
			v = mods.ctrl ? (lines[d.k - 1] + lines[d.k + 1]) / 2 : snapPx(v);
			write(moveLine(grid.value, d.axis, d.k, v / n, MIN_PX / n));
		} else if (d.kind === 'move') {
			const l = Math.min(Math.max(snapPx(tx(p[0]) - d.grab[0]), 0), W.value - a.w);
			const t = Math.min(Math.max(snapPx(ty(p[1]) - d.grab[1]), 0), H.value - a.h);
			writeArea(l, t, a.w, a.h);
		} else {
			let { l, t, r, b } = d.from;
			const x = Math.min(Math.max(snapPx(tx(p[0])), 0), W.value);
			const y = Math.min(Math.max(snapPx(ty(p[1])), 0), H.value);
			if (d.sides.includes('l')) l = Math.min(x, r - MIN_PX);
			if (d.sides.includes('r')) r = Math.max(x, l + MIN_PX);
			if (d.sides.includes('t')) t = Math.min(y, b - MIN_PX);
			if (d.sides.includes('b')) b = Math.max(y, t + MIN_PX);
			writeArea(l, t, r - l, b - t);
		}
	}

	function onWindowMove(e: PointerEvent): void {
		// Only over the viewport (not a panel beside it), unless dragging.
		const stage = svgEl.value?.parentElement;
		inside.value = Boolean(stage && stage.contains(e.target as Node));
		const p = drag.value || inside.value ? local(e) : null;
		ptr.value = p;
		if (drag.value) {
			if (e.pointerId !== drag.value.id) return;
			mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
			apply();
			return;
		}
		hover.value = p ? hoverAt(p) : null;
	}
	function onLeave(): void {
		if (drag.value) return;
		inside.value = false;
		hover.value = null;
	}
	function onWindowUp(e: PointerEvent): void {
		if (drag.value && e.pointerId === drag.value.id) drag.value = null;
	}
	/** Pressing or releasing a modifier mid-drag applies at once. */
	function onKey(e: KeyboardEvent): void {
		if (!drag.value || e.repeat || !['Shift', 'Control', 'Meta'].includes(e.key)) return;
		mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
		apply();
	}
	onMounted(() => {
		window.addEventListener('pointermove', onWindowMove);
		window.addEventListener('pointerup', onWindowUp);
		window.addEventListener('pointercancel', onWindowUp);
		window.addEventListener('keydown', onKey);
		window.addEventListener('keyup', onKey);
		document.documentElement.addEventListener('pointerleave', onLeave);
	});
	onBeforeUnmount(() => {
		window.removeEventListener('pointermove', onWindowMove);
		window.removeEventListener('pointerup', onWindowUp);
		window.removeEventListener('pointercancel', onWindowUp);
		window.removeEventListener('keydown', onKey);
		window.removeEventListener('keyup', onKey);
		document.documentElement.removeEventListener('pointerleave', onLeave);
	});

	// ------------------------------------------------------------------------------------------------ what to show

	const activeLine = computed(() => {
		const d = drag.value;
		if (d?.kind === 'line') return { axis: d.axis, k: d.k };
		const h = hover.value;
		return h?.kind === 'line' ? { axis: h.axis, k: h.k } : null;
	});
	const activeSides = computed<Side[]>(() => {
		const d = drag.value;
		if (d?.kind === 'edge') return d.sides;
		if (d?.kind === 'move' || hover.value?.kind === 'move') return ['l', 'r', 't', 'b'];
		return hover.value?.kind === 'edge' ? hover.value.sides : [];
	});
	const edgeCursor = computed(() => {
		const s = activeSides.value;
		if (s.length === 2)
			return (s.includes('l') && s.includes('t')) || (s.includes('r') && s.includes('b'))
				? 'nwse-resize'
				: 'nesw-resize';
		return s.includes('l') || s.includes('r') ? 'ew-resize' : 'ns-resize';
	});
	/** Ghost line and ⊕ stud where a click in the add band would split. */
	const addGhost = computed(() => {
		const h = hover.value;
		if (drag.value || h?.kind !== 'add') return null;
		const b = box.value;
		const line =
			h.axis === 'col'
				? { x1: h.at[0], y1: b.t, x2: h.at[0], y2: b.b }
				: { x1: b.l, y1: h.at[1], x2: b.r, y2: h.at[1] };
		return { line, at: h.at, axis: h.axis };
	});

	/** A readout beside the pointer while dragging: the two cells' sizes, or the area's. */
	const readout = computed(() => {
		const d = drag.value;
		const p = ptr.value;
		if (!d || !p) return null;
		const a = area.value;
		let text: string;
		if (d.kind === 'line') {
			const L = d.axis === 'col' ? xsPx.value : ysPx.value;
			text = `${L[d.k] - L[d.k - 1]} | ${L[d.k + 1] - L[d.k]} px`;
		} else text = `${a.w} × ${a.h} px  @ ${a.x}, ${a.y}`;
		return { x: p[0] + 14, y: p[1] + 18, text };
	});

	/** Everything but the outline and the off cells: while the pointer is over the viewport, or dragging. */
	const full = computed(() => inside.value || drag.value !== null);

	const hint = computed(() => {
		const d = drag.value;
		if (d?.kind === 'line') return 'Shift: 10 px steps · Ctrl: split evenly';
		if (d) return 'Shift: 10 px steps';
		const h = hover.value;
		if (!h) return null;
		if (h.kind === 'line') return 'Drag to resize the cells either side · right-click to remove the line';
		if (h.kind === 'edge') return 'Drag to resize the area · Shift: 10 px steps';
		if (h.kind === 'move') return 'Drag to move the area';
		if (h.kind === 'add') return `Click to add a ${h.axis === 'col' ? 'column' : 'row'} here`;
		// Over a panel the studs' own tooltips say what they do.
		return null;
	});

	const lineOn = (s: Seg) => activeLine.value?.axis === s.axis && activeLine.value.k === s.k;
</script>

<template>
	<svg ref="svgEl" class="grid-gizmo" :width="size.w" :height="size.h">
		<defs>
			<pattern id="gg-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
				<rect width="7" height="7" class="hatch-bg" />
				<line x1="0" y1="0" x2="0" y2="7" class="hatch-line" />
			</pattern>
		</defs>

		<!-- Switched-off cells: hatched, so what the layer leaves out reads at a glance. -->
		<rect v-for="(o, i) in offPanels" :key="`off${i}`" :x="o.x" :y="o.y" :width="o.w" :height="o.h" class="off" />

		<!-- The grid's visible lines (dark under-stroke for contrast on any texture). -->
		<g v-if="full" class="lines">
			<template v-for="(s, i) in segments" :key="`s${i}`">
				<line v-bind="{ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }" class="under" />
				<line v-bind="{ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }" class="grid" :class="{ on: lineOn(s) }" />
			</template>
		</g>

		<!-- Staggered columns' (rows') lines, where the render puts them. -->
		<g v-if="full && ghosts.length" class="lines">
			<line v-for="(l, i) in ghosts" :key="`gh${i}`" v-bind="l" class="ghost-line" />
		</g>

		<!-- The hovered panel. -->
		<rect
			v-if="hovered"
			:x="panelBox(hovered).x + 1.5"
			:y="panelBox(hovered).y + 1.5"
			:width="Math.max(panelBox(hovered).w - 3, 0)"
			:height="Math.max(panelBox(hovered).h - 3, 0)"
			class="panel-hi" />

		<!-- The area's outline. -->
		<rect v-if="full" :x="box.l" :y="box.t" :width="box.r - box.l" :height="box.b - box.t" class="area-under" />
		<rect
			:x="box.l"
			:y="box.t"
			:width="box.r - box.l"
			:height="box.b - box.t"
			class="area"
			:class="{ on: activeSides.length > 0, quiet: !full }" />

		<!-- Add a line: the ghost where it would go. -->
		<line v-if="addGhost" v-bind="addGhost.line" class="ghost" />

		<!-- Hit targets. -->
		<g class="hits">
			<rect
				v-for="side in ['t', 'b']"
				:key="`add${side}`"
				:x="box.l + HIT"
				:y="side === 't' ? box.t - ADD_OUT : box.b + ADD_IN"
				:width="Math.max(box.r - box.l - 2 * HIT, 0)"
				:height="ADD_OUT - ADD_IN"
				class="hit add"
				@pointerdown="onDown($event, 'add')" />
			<rect
				v-for="side in ['l', 'r']"
				:key="`add${side}`"
				:x="side === 'l' ? box.l - ADD_OUT : box.r + ADD_IN"
				:y="box.t + HIT"
				:width="ADD_OUT - ADD_IN"
				:height="Math.max(box.b - box.t - 2 * HIT, 0)"
				class="hit add"
				@pointerdown="onDown($event, 'add')" />
			<line
				v-for="(s, i) in segments"
				:key="`h${i}`"
				v-bind="{ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }"
				class="hit-line"
				:class="s.axis"
				@pointerdown="onDown($event, 'line')"
				@contextmenu="onLineMenu" />
			<rect
				:x="box.l"
				:y="box.t"
				:width="box.r - box.l"
				:height="box.b - box.t"
				class="hit-edge"
				:style="{ cursor: edgeCursor }"
				@pointerdown="onDown($event, 'edge')" />
		</g>

		<!-- Corner handles. -->
		<template v-if="full">
			<rect
				v-for="(c, i) in [
					[box.l, box.t],
					[box.r, box.t],
					[box.l, box.b],
					[box.r, box.b]
				]"
				:key="`c${i}`"
				:x="c[0] - 3.5"
				:y="c[1] - 3.5"
				width="7"
				height="7"
				class="corner"
				:class="{ on: activeSides.length > 0 }" />
		</template>
	</svg>

	<div class="grid-studs">
		<!-- Move the area: just outside its top-left corner. -->
		<button
			v-if="full"
			v-tip:left="'Move the area'"
			type="button"
			class="gk stud move"
			:style="{ left: `${box.l - 22}px`, top: `${box.t - 22}px` }"
			@pointerdown="onDown($event, 'move')">
			<span class="gk-face"><IconArrowsMove :size="13" /></span>
		</button>

		<!-- Add a line: the ⊕ follows the pointer along the band. -->
		<div
			v-if="addGhost"
			class="gk stud primary add-stud"
			:style="{ left: `${addGhost.at[0]}px`, top: `${addGhost.at[1]}px` }">
			<span class="gk-face"><IconPlus :size="13" /></span>
		</div>

		<!-- The hovered panel's studs. -->
		<button
			v-for="s in studs"
			:key="s.key"
			v-tip:top="s.tip"
			type="button"
			class="gk stud"
			:class="{ dim: s.off }"
			:style="{ left: `${s.x}px`, top: `${s.y}px` }"
			@pointerdown.stop
			@click="onStud($event, s)">
			<span class="gk-face"><component :is="s.icon" :size="13" /></span>
		</button>

		<div v-if="readout" class="readout cf-mono" :style="{ left: `${readout.x}px`, top: `${readout.y}px` }">
			{{ readout.text }}
		</div>
	</div>

	<div v-if="hint && full" class="grid-hint" role="status">
		<IconPointer :size="13" />
		<span>{{ hint }}</span>
	</div>
</template>

<style scoped>
	.grid-gizmo {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: visible;
	}
	.hatch-bg {
		fill: rgba(17, 19, 22, 0.45);
	}
	.hatch-line {
		stroke: rgba(246, 110, 16, 0.35);
		stroke-width: 1.5;
	}
	.off {
		fill: url(#gg-hatch);
	}
	.under,
	.area-under {
		stroke: rgba(17, 19, 22, 0.7);
		stroke-width: 3;
		fill: none;
	}
	.grid {
		stroke: var(--text-hi);
		stroke-width: 1;
		opacity: 0.55;
	}
	.ghost-line {
		stroke: var(--text-hi);
		stroke-width: 1;
		stroke-dasharray: 3 4;
		opacity: 0.45;
	}
	.grid.on {
		stroke: var(--accent-hi);
		stroke-width: 2;
		opacity: 1;
		filter: var(--drop-halo);
	}
	.area {
		fill: none;
		stroke: var(--e300);
		stroke-width: 1.5;
		filter: var(--drop-halo);
	}
	.area.quiet {
		stroke: var(--text-hi);
		stroke-width: 1;
		stroke-dasharray: 4 4;
		opacity: 0.4;
		filter: none;
	}
	.area.on {
		stroke: var(--accent-hi);
		stroke-width: 2;
	}
	.panel-hi {
		fill: rgba(246, 110, 16, 0.07);
		stroke: var(--e400);
		stroke-width: 1;
		stroke-dasharray: 4 3;
	}
	.ghost {
		stroke: var(--accent-hi);
		stroke-width: 1.5;
		stroke-dasharray: 5 4;
		filter: var(--drop-halo);
	}
	.corner {
		fill: var(--text-hi);
		stroke: var(--deep);
		stroke-width: 1;
	}
	.corner.on {
		fill: var(--accent-hi);
	}
	.hit {
		fill: transparent;
		pointer-events: all;
	}
	.hit.add {
		cursor: copy;
	}
	.hit-line {
		stroke: transparent;
		stroke-width: 12;
		pointer-events: stroke;
	}
	.hit-line.col {
		cursor: col-resize;
	}
	.hit-line.row {
		cursor: row-resize;
	}
	.hit-edge {
		fill: none;
		stroke: transparent;
		stroke-width: 12;
		pointer-events: stroke;
	}

	.grid-studs {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	/* Forged Keys, small: a 22 px stud centred on its spot. */
	.stud {
		position: absolute;
		height: 22px;
		min-width: 22px;
		width: 22px;
		transform: translate(-50%, -50%);
		pointer-events: auto;
		animation: stud-in 90ms ease-out;
	}
	.stud > .gk-face {
		height: 20px;
		padding: 0;
	}
	.stud.move {
		transform: none;
		cursor: move;
	}
	.stud.dim > .gk-face {
		color: var(--e300);
	}
	.add-stud {
		pointer-events: none;
	}
	@keyframes stud-in {
		from {
			opacity: 0;
		}
	}
	.readout {
		position: absolute;
		padding: 2px 7px;
		background: rgba(17, 19, 22, 0.9);
		border: 1px solid var(--hairline);
		border-radius: 4px;
		color: var(--readout);
		font-size: 11px;
		white-space: pre;
		pointer-events: none;
	}
	/* Where the shape editor's drawing hint sits (they never show together). */
	.grid-hint {
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
	.grid-hint svg {
		flex: none;
		color: var(--accent-hi);
	}
</style>
