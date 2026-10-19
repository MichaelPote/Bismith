import { describe, expect, it } from 'vitest';
import type { Layer, Project } from '@/core/project';
import { endTo, layerGizmo, moveTo, turnTo, type Pt } from './gizmos';

const project = (tileable = false) => ({ width: 256, height: 128, tileable }) as Project;
const layer = (type: string, params: Record<string, number | string | boolean>): Layer => ({
	id: 'l',
	type,
	name: type,
	enabled: true,
	params
});
/** The layer with a drag's changes applied. */
const apply = (l: Layer, patch: Record<string, number>): Layer => ({ ...l, params: { ...l.params, ...patch } });
/** Within eps px: drags round fractions to 4 decimals, angles to 0.1° and lengths to 0.1 px. */
const near = (a: Pt, b: Pt, eps = 0.05) => {
	expect(Math.abs(a[0] - b[0])).toBeLessThan(eps);
	expect(Math.abs(a[1] - b[1])).toBeLessThan(eps);
};

describe('gizmos', () => {
	it('places a shape at X / Y, on the top-left repeat with an offset, and moves it back under the pointer', () => {
		const P = project();
		near(layerGizmo(layer('rect', { x: 0.25, y: 0.75, rotation: 0 }), P)!.move, [64, 96]);
		// 4 × 2 repeats: the top-left step is 64 × 64 px, centred at (32, 32); Shaping › Offset shifts it.
		const r = layer('circle', { x: 0.5, y: 0.5, rep_x: 4, rep_y: 2, ofs_x: 3, ofs_y: -2 });
		near(layerGizmo(r, P)!.move, [35, 30]);
		const moved = apply(r, moveTo(r, P, [50, 41]));
		near(layerGizmo(moved, P)!.move, [50, 41]);
	});

	it('turns a shape with the knob above its centre (Rotation clockwise)', () => {
		const P = project();
		const r = layer('polygon', { x: 0.5, y: 0.5, rotation: 0 });
		expect(layerGizmo(r, P)!.turn).toBeCloseTo(-90);
		expect(turnTo(r, P, [200, 64]).rotation).toBeCloseTo(90); // knob pulled to the right: a quarter turn clockwise
		expect(turnTo(r, P, [140, 70], 15).rotation % 15).toBeCloseTo(0);
	});

	it('drags a line’s end while the other stays put', () => {
		const P = project();
		const l = layer('line', { x: 0.5, y: 0.5, rotation: 30, length: 80 });
		const [a, b] = layerGizmo(l, P)!.ends!;
		near([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [128, 64]);
		const l2 = apply(l, endTo(l, P, 1, [200, 20]));
		const [a2, b2] = layerGizmo(l2, P)!.ends!;
		near(a2, a, 0.3);
		near(b2, [200, 20], 0.3);
		const l3 = apply(l2, endTo(l2, P, 0, [10, 100]));
		const [a3, b3] = layerGizmo(l3, P)!.ends!;
		near(a3, [10, 100], 0.3);
		near(b3, b2, 0.3);
	});

	it('keeps a curve’s chord end fixed through its pivot (Centre on › Middle)', () => {
		const P = project();
		const c = layer('curve', {
			x: 0.4,
			y: 0.6,
			rotation: -20,
			length: 90,
			bend: 25,
			bend_at: 1.4,
			kind: 'bezier',
			pivot: 'middle'
		});
		const [a] = layerGizmo(c, P)!.ends!;
		const c2 = apply(c, endTo(c, P, 1, [220, 30]));
		const [a2, b2] = layerGizmo(c2, P)!.ends!;
		near(a2, a, 0.3);
		near(b2, [220, 30], 0.3);
	});

	it('turns a stamp on top of its quarter turns', () => {
		const P = project();
		const s = layer('stamp', { x: 0.5, y: 0.5, rotate: '90', angle: 10 });
		expect(layerGizmo(s, P)!.turn).toBeCloseTo(10);
		expect(turnTo(s, P, [128, 0]).angle).toBeCloseTo(-90); // straight up = 0° in all
	});

	it('moves a cable across itself only, and turns it from its axis', () => {
		for (const tileable of [false, true]) {
			const P = project(tileable);
			const c = layer('cable', { axis: 'horizontal', angle: 0, pos: 0.5 });
			near(layerGizmo(c, P)!.move, [128, 64]);
			const c2 = apply(c, moveTo(c, P, [40, 96]));
			near(layerGizmo(c2, P)!.move, [128, 96]);
		}
		const v = layer('cable', { axis: 'vertical', angle: 0, pos: 0.5 });
		expect(turnTo(v, project(), [228, 164]).angle).toBeCloseTo(-45);
	});

	it('places a gradient’s centre and a symmetry’s fold centre in its top-left cell', () => {
		const P = project();
		const g = layer('gradient', { cx: 0.5, cy: 0.5, angle: 270 });
		expect(turnTo(g, P, [128, 0]).angle).toBeCloseTo(-90);
		const s = layer('symmetry', { cx: 0.5, cy: 0.5, cells_x: 4, cells_y: 2 });
		near(layerGizmo(s, P)!.move, [32, 32]);
		const s2 = apply(s, moveTo(s, P, [16, 48]));
		near(layerGizmo(s2, P)!.move, [16, 48]);
	});
});
