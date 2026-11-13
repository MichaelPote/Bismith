// Viewport gizmos for the selected layer (Create workspace): handles that drag a layer's placement sliders — move and
// turn shapes, motifs and stamps, a line's or curve's two ends, a gradient's centre and direction, a symmetry's fold
// centre and axis, a cable's centre line. Pure geometry here (texture px, y down), mirroring each generator's shader;
// LayerGizmo.vue draws the handles and applies the changes. Also how every viewport drag starts (beginGizmoDrag).

import type { Layer, Project } from '@/core/project';
import type { ParamValues } from '@/core/params';
import { useProjectStore } from '@/stores/project';

/**
 * Finishes a field still being typed in before a viewport press changes the project: its value becomes an undo step of
 * its own, and the focus leaves it so Ctrl+Z reaches the editor (a press that calls preventDefault keeps the focus).
 */
export function finishTyping(): void {
	(document.activeElement as HTMLElement | null)?.blur();
	useProjectStore().commitNow();
}

const MODIFIERS = ['Shift', 'Control', 'Meta', 'Alt'];

/**
 * Starts a gizmo drag from its pointerdown: finishes typing, captures the pointer on the pressed element, and calls
 * `onModifier` whenever a modifier key is pressed or released mid-drag (to re-apply it without a move). Returns the
 * function that ends the drag (on release, cancel or unmount); calling it again does nothing.
 */
export function beginGizmoDrag(e: PointerEvent, onModifier?: (e: KeyboardEvent) => void): () => void {
	finishTyping();
	const el = e.currentTarget as Element;
	const id = e.pointerId;
	try {
		el.setPointerCapture(id);
	} catch {
		/* not an active pointer (e.g. synthetic events) */
	}
	const onKey = (k: KeyboardEvent) => {
		if (!k.repeat && MODIFIERS.includes(k.key)) onModifier?.(k);
	};
	window.addEventListener('keydown', onKey);
	window.addEventListener('keyup', onKey);
	let done = false;
	return () => {
		if (done) return;
		done = true;
		window.removeEventListener('keydown', onKey);
		window.removeEventListener('keyup', onKey);
		try {
			if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
		} catch {
			/* the pointer is gone */
		}
	};
}

export type Pt = [number, number];

/**
 * A layer's handles, in texture px (y down; the texture's top-left at 0, 0):
 * - `move`: a dot that moves the layer (drag it anywhere);
 * - `turn`: the direction its rotation knob sits in from `move`, in degrees clockwise from → (screen); the knob is drawn
 *   a fixed screen distance out;
 * - `ends`: a line's or curve's two ends, each dragged on its own;
 * - `axis`: draw a line through `move` along `turn` (both ways), e.g. a fold axis or a cable's centre line;
 * - `arrow`: draw the knob as an arrow head out of `move` (a gradient's direction).
 */
export interface Gizmo {
	move: Pt;
	turn?: number;
	ends?: [Pt, Pt];
	axis?: boolean;
	arrow?: boolean;
}

/** What a drag changes: param key → value. */
export type ParamPatch = Record<string, number>;

const num = (p: ParamValues, k: string, d = 0) => {
	const v = Number(p[k]);
	return Number.isFinite(v) ? v : d;
};
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
/** An angle in degrees brought to (−180, 180]. */
const wrapDeg = (a: number) => {
	const w = ((((a + 180) % 360) + 360) % 360) - 180;
	return w === -180 ? 180 : w;
};
const round = (v: number, step: number) => Math.round(v / step) * step;
/** Fractions to 4 decimals (as the light gizmo), angles to 0.1°, lengths to 0.1 px. */
const frac = (v: number) => Number(v.toFixed(4));
const ang = (v: number) => Number(wrapDeg(v).toFixed(1));
const len = (v: number) => Number(Math.max(0, v).toFixed(1));

const SHAPES = new Set(['rect', 'circle', 'polygon', 'cross']);
const MOTIFS = new Set(['rosette', 'glyph']);
const STAMPS = new Set(['stamp', 'label']);

/** Layer types with a gizmo. */
export function hasGizmo(type: string): boolean {
	return (
		SHAPES.has(type) ||
		MOTIFS.has(type) ||
		STAMPS.has(type) ||
		['line', 'curve', 'gradient', 'symmetry', 'cable'].includes(type)
	);
}

/** Shaping › Offset X / Y: every generator's pattern shifts by it (px, + right / down). */
const offset = (p: ParamValues): Pt => [num(p, 'ofs_x'), num(p, 'ofs_y')];

/**
 * The repeat grid of Shapes and motifs (repGrid in glsl/common.ts): instance i at the texture's centre + (i − (n − 1)/2)
 * pitch, X / Y placing every instance within its step. The gizmo stands on the top-left instance.
 */
function repeatFrame(p: ParamValues, W: number, H: number): { origin: Pt; pitch: Pt } {
	const nx = Math.max(1, Math.round(num(p, 'rep_x', 1)));
	const ny = Math.max(1, Math.round(num(p, 'rep_y', 1)));
	const px = Math.max(W / nx + num(p, 'col_sp') * W, 1e-3);
	const py = Math.max(H / ny + num(p, 'row_sp') * H, 1e-3);
	const [ox, oy] = offset(p);
	// The top-left instance's step: its centre at X / Y = 0.5.
	return { origin: [W / 2 - ((nx - 1) / 2) * px + ox, H / 2 - ((ny - 1) / 2) * py + oy], pitch: [px, py] };
}
function placeOf(p: ParamValues, W: number, H: number): Pt {
	const { origin, pitch } = repeatFrame(p, W, H);
	return [origin[0] + (num(p, 'x', 0.5) - 0.5) * pitch[0], origin[1] + (num(p, 'y', 0.5) - 0.5) * pitch[1]];
}
function placeTo(p: ParamValues, W: number, H: number, at: Pt): ParamPatch {
	const { origin, pitch } = repeatFrame(p, W, H);
	return { x: frac(0.5 + (at[0] - origin[0]) / pitch[0]), y: frac(0.5 + (at[1] - origin[1]) / pitch[1]) };
}

/** A shape's local frame (GL y up, as its shader) → texture px offset: turned clockwise by `rotDeg`. */
function local(rotDeg: number, lx: number, ly: number): Pt {
	const c = Math.cos(rad(rotDeg)),
		s = Math.sin(rad(rotDeg));
	return [lx * c + ly * s, lx * s - ly * c];
}

/** Curve › Centre on: where the curve's middle lies from its chord's (curvePivot in shapes.ts), local, y up. */
function curvePivot(p: ParamValues, L: number, bend: number): Pt {
	if (p.pivot === 'chord') return [0, 0];
	const bx = num(p, 'bend_at') * L * 0.5;
	let x0 = -L * 0.5,
		x1 = L * 0.5;
	const arc = p.kind === 'arc' && Math.abs(bend) > 0.05;
	if (!arc && Math.abs(bx) > L * 0.5) {
		const t = (bx + L * 0.5) / (2 * bx);
		const x = (1 - t) * (1 - t) * x0 + 2 * t * (1 - t) * bx + t * t * x1;
		x0 = Math.min(x0, x);
		x1 = Math.max(x1, x);
	}
	return [(x0 + x1) * 0.5, bend * 0.5];
}

/** Line / Curve: the ends of the line, or of the curve's chord (local x = ∓L/2, less the curve's pivot). */
function strokeEnds(type: string, p: ParamValues, W: number, H: number): [Pt, Pt] {
	const c = placeOf(p, W, H);
	const rot = num(p, 'rotation');
	const L = num(p, 'length');
	const pv = type === 'curve' ? curvePivot(p, L, num(p, 'bend')) : [0, 0];
	const a = local(rot, -L * 0.5 - pv[0], -pv[1]);
	const b = local(rot, L * 0.5 - pv[0], -pv[1]);
	return [
		[c[0] + a[0], c[1] + a[1]],
		[c[0] + b[0], c[1] + b[1]]
	];
}

/** Symmetry: the top-left cell's fold centre (cells of the texture / Cells X, Y; Row offset moves odd rows only). */
function symCell(p: ParamValues, W: number, H: number): Pt {
	return [W / Math.max(1, num(p, 'cells_x', 1)), H / Math.max(1, num(p, 'cells_y', 1))];
}

/**
 * Cable (cable.ts): its direction (the axis turned clockwise by Angle; tiling snaps it to one that closes on the torus),
 * the normal its Position moves along, the span Position covers and the centre line's middle.
 */
function cableFrame(p: ParamValues, project: Project): { d: Pt; n: Pt; across: number; centre: Pt; base: number } {
	const W = project.width,
		H = project.height;
	const vert = p.axis === 'vertical';
	const base = vert ? 90 : 0;
	let d: Pt = [Math.cos(rad(base + num(p, 'angle'))), Math.sin(rad(base + num(p, 'angle')))];
	let length = Math.abs(d[0]) * W + Math.abs(d[1]) * H;
	if (project.tileable) {
		let tu: Pt = [d[0] / W, d[1] / H];
		const m = Math.max(Math.abs(tu[0]), Math.abs(tu[1]));
		tu = [tu[0] / m, tu[1] / m];
		let ab: Pt = [1, 0];
		let best = 2;
		for (let k = 1; k <= 12; k++) {
			const c: Pt = [Math.round(k * tu[0]), Math.round(k * tu[1])];
			const cl = Math.hypot(c[0] * W, c[1] * H);
			const e = 1 - (c[0] * W * d[0] + c[1] * H * d[1]) / cl;
			if (e < best - 1e-7) {
				best = e;
				ab = c;
			}
		}
		length = Math.hypot(ab[0] * W, ab[1] * H);
		d = [(ab[0] * W) / length, (ab[1] * H) / length];
	}
	const n: Pt = vert ? [d[1], -d[0]] : [-d[1], d[0]];
	const across = project.tileable ? (W * H) / length : Math.abs(n[0]) * W + Math.abs(n[1]) * H;
	const [ox, oy] = offset(p);
	const k = (num(p, 'pos', 0.5) - 0.5) * across;
	return { d, n, across, centre: [W / 2 + k * n[0] + ox, H / 2 + k * n[1] + oy], base };
}

/**
 * Where a drawn polygon's move handle sits: its area centroid. A polygon with no area, or crossing itself so that the
 * centroid lands outside its bounds, takes the mean of its vertices.
 */
export function polygonCentroid(p: Pt[]): Pt {
	let area = 0,
		cx = 0,
		cy = 0;
	p.forEach(([x, y], i) => {
		const [nx, ny] = p[(i + 1) % p.length];
		const c = x * ny - nx * y;
		area += c;
		cx += (x + nx) * c;
		cy += (y + ny) * c;
	});
	const at: Pt = [cx / (3 * area), cy / (3 * area)];
	const xs = p.map((q) => q[0]);
	const ys = p.map((q) => q[1]);
	// (Written so that a zero area's NaN or infinity falls through too.)
	const inside =
		at[0] >= Math.min(...xs) && at[0] <= Math.max(...xs) && at[1] >= Math.min(...ys) && at[1] <= Math.max(...ys);
	if (inside) return at;
	return [xs.reduce((a, b) => a + b, 0) / p.length, ys.reduce((a, b) => a + b, 0) / p.length];
}

/** The lines a vertex can be held to (Ctrl): verticals at `x`, horizontals at `y` (texture px). */
export interface SnapLines {
	x: number[];
	y: number[];
}

/**
 * Where a dragged or placed vertex lands with the pointer at `at` (texture px), and the snap lines it lies on. It snaps
 * to half pixels, or not at all when `free`, or to every tenth pixel when `tens`. With `lines` (the verticals and
 * horizontals through its neighbours) it goes onto the nearest of them, its other coordinate still snapped — and onto
 * the crossing with a line across that one when the pointer is within `reach` of it too. Distances are in screen px:
 * `scale` is screen px per texture px on each axis.
 */
export function snapVertex(
	at: Pt,
	o: { free?: boolean; tens?: boolean; lines?: SnapLines; scale?: Pt; reach?: number } = {}
): { p: Pt; on: { x?: number; y?: number } } {
	const step = o.tens ? 10 : o.free ? 0 : 0.5;
	const p: Pt = step ? [round(at[0], step), round(at[1], step)] : [at[0], at[1]];
	const on: { x?: number; y?: number } = {};
	if (!o.lines || (!o.lines.x.length && !o.lines.y.length)) return { p, on };
	const [sx, sy] = o.scale ?? [1, 1];
	const nearest = (vals: number[], v: number, s: number) =>
		vals.reduce<{ v?: number; d: number }>(
			(b, c) => (Math.abs(v - c) * s < b.d ? { v: c, d: Math.abs(v - c) * s } : b),
			{
				d: Infinity
			}
		);
	const nx = nearest(o.lines.x, at[0], sx);
	const ny = nearest(o.lines.y, at[1], sy);
	const reach = o.reach ?? 0;
	if (nx.d <= ny.d) {
		on.x = p[0] = nx.v!;
		if (ny.v !== undefined && ny.d <= reach) on.y = p[1] = ny.v;
	} else {
		on.y = p[1] = ny.v!;
		if (nx.v !== undefined && nx.d <= reach) on.x = p[0] = nx.v;
	}
	return { p, on };
}

/** The selected layer's gizmo, or null when its type has none. */
export function layerGizmo(layer: Layer, project: Project): Gizmo | null {
	const p = layer.params;
	const W = project.width,
		H = project.height;
	const t = layer.type;
	// Repeated along an outline (Repeat › Place, FR8.33): no grid instance to stand on, and the editor doesn't know where
	// the outline put them.
	const repeated = SHAPES.has(t) || MOTIFS.has(t) || STAMPS.has(t) || t === 'line' || t === 'curve';
	if (repeated && (p.rep_place === 'mask' || p.rep_place === 'edges')) return null;
	if (SHAPES.has(t) || MOTIFS.has(t)) return { move: placeOf(p, W, H), turn: num(p, 'rotation') - 90 };
	if (t === 'line' || t === 'curve') return { move: placeOf(p, W, H), ends: strokeEnds(t, p, W, H) };
	if (STAMPS.has(t)) {
		const [ox, oy] = offset(p);
		return {
			move: [num(p, 'x', 0.5) * W + ox, num(p, 'y', 0.5) * H + oy],
			turn: num(p, 'rotate') + num(p, 'angle') - 90
		};
	}
	if (t === 'gradient') {
		const [ox, oy] = offset(p);
		return { move: [num(p, 'cx', 0.5) * W + ox, num(p, 'cy', 0.5) * H + oy], turn: num(p, 'angle'), arrow: true };
	}
	if (t === 'symmetry') {
		const cs = symCell(p, W, H);
		return { move: [num(p, 'cx', 0.5) * cs[0], num(p, 'cy', 0.5) * cs[1]], turn: num(p, 'angle'), axis: true };
	}
	if (t === 'cable') {
		const f = cableFrame(p, project);
		return { move: f.centre, turn: deg(Math.atan2(f.d[1], f.d[0])), axis: true };
	}
	return null;
}

/** Dragging the move dot to `at` (texture px). */
export function moveTo(layer: Layer, project: Project, at: Pt): ParamPatch {
	const p = layer.params;
	const W = project.width,
		H = project.height;
	const t = layer.type;
	if (SHAPES.has(t) || MOTIFS.has(t) || t === 'line' || t === 'curve') return placeTo(p, W, H, at);
	const [ox, oy] = offset(p);
	if (STAMPS.has(t)) return { x: frac((at[0] - ox) / W), y: frac((at[1] - oy) / H) };
	if (t === 'gradient') return { cx: frac((at[0] - ox) / W), cy: frac((at[1] - oy) / H) };
	if (t === 'symmetry') {
		const cs = symCell(p, W, H);
		return { cx: frac(at[0] / cs[0]), cy: frac(at[1] / cs[1]) };
	}
	if (t === 'cable') {
		// Across the cable only: its Position.
		const f = cableFrame(p, project);
		const k = (at[0] - f.centre[0]) * f.n[0] + (at[1] - f.centre[1]) * f.n[1];
		return { pos: frac(num(p, 'pos', 0.5) + k / f.across) };
	}
	return {};
}

/**
 * Turning the knob to point at `at` (texture px); `snap` rounds the angle to that many degrees (0: free). Stamps keep
 * their quarter turns (Rotate, in degrees) and take the rest as Angle; a cable's Angle is from its axis. `pivot`: what
 * it turns about — the move dot as it was when the drag began (a cable's dot moves as it turns).
 */
export function turnTo(layer: Layer, project: Project, at: Pt, snap = 0, pivot?: Pt): ParamPatch {
	const g = layerGizmo(layer, project);
	if (!g) return {};
	const c = pivot ?? g.move;
	let a = deg(Math.atan2(at[1] - c[1], at[0] - c[0]));
	if (snap > 0) a = round(a, snap);
	const p = layer.params;
	const t = layer.type;
	if (SHAPES.has(t) || MOTIFS.has(t)) return { rotation: ang(a + 90) };
	if (STAMPS.has(t)) return { angle: ang(a + 90 - num(p, 'rotate')) };
	if (t === 'gradient' || t === 'symmetry') return { angle: ang(a) };
	if (t === 'cable') {
		// Its centre line keeps through the pivot: Position (along the turned normal) follows the angle, so the cable turns
		// about the dot instead of swinging round the texture's centre (which moved the dot, and the angle with it).
		const angle = ang(a - cableFrame(p, project).base);
		const f = cableFrame({ ...p, angle }, project);
		const [ox, oy] = offset(p);
		const k = (c[0] - project.width / 2 - ox) * f.n[0] + (c[1] - project.height / 2 - oy) * f.n[1];
		let pos = 0.5 + k / f.across;
		// Tiled, the rows repeat every `across`: the same line from 0..1.
		pos = project.tileable ? pos - Math.floor(pos) : Math.min(2, Math.max(-1, pos));
		return { angle, pos: frac(pos) };
	}
	return {};
}

/**
 * Dragging one end of a line or curve (`which` 0 = its start, 1 = its end) to `at`, the other end staying put: its
 * X / Y, Rotation and Length follow. `snap` rounds the direction to that many degrees. `fixed`: the other end as it was
 * when the drag began (the rounded params would let it creep a little with every move).
 */
export function endTo(layer: Layer, project: Project, which: 0 | 1, at: Pt, snap = 0, fixed?: Pt): ParamPatch {
	const g = layerGizmo(layer, project);
	if (!g?.ends) return {};
	const p = layer.params;
	fixed ??= g.ends[1 - which];
	let a =
		which === 1
			? deg(Math.atan2(at[1] - fixed[1], at[0] - fixed[0]))
			: deg(Math.atan2(fixed[1] - at[1], fixed[0] - at[0]));
	let L = Math.hypot(at[0] - fixed[0], at[1] - fixed[1]);
	if (snap > 0) a = round(a, snap);
	L = len(L);
	// Back from the chord's ends to the layer's centre: the chord's middle plus the curve's pivot, turned.
	const s: Pt = which === 1 ? fixed : [fixed[0] - Math.cos(rad(a)) * L, fixed[1] - Math.sin(rad(a)) * L];
	const pv = layer.type === 'curve' ? curvePivot(p, L, num(p, 'bend')) : [0, 0];
	const off = local(a, L * 0.5 + pv[0], pv[1]);
	const centre: Pt = [s[0] + off[0], s[1] + off[1]];
	return { ...placeTo(p, project.width, project.height, centre), rotation: ang(a), length: L };
}
