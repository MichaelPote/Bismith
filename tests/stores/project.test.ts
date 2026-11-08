import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createProject } from '@/core/serialize';
import { LIGHT_REF_SIZE, POINT_LIGHT_REF_DIST } from '@/core/lights';
import { useProjectStore } from '@/stores/project';
import { createLayer } from '@/layers/registry';
import { ensureBuiltins } from '@/render/builtins';
import { allPostDefs } from '@/render/post/registry';

describe('project store: lights', () => {
	beforeEach(() => setActivePinia(createPinia()));

	it('names a layer or light after its type again when its name is cleared', () => {
		const store = useProjectStore();
		store.newProject(createProject({ width: 64, height: 64, layers: [createLayer('bricks', {}, 'Wall')] }));
		const id = store.project.layers[0].id;
		store.updateLayer(id, { name: '  ' });
		expect(store.getLayer(id)!.name).toBe('Bricks');
		const light = store.addLight('point')!;
		store.updateLight(light.id, { name: 'Torch' });
		store.updateLight(light.id, { name: '' });
		expect(store.getLight(light.id)!.name).toBe('Point');
	});

	it('adds a point light sized to the canvas', () => {
		const store = useProjectStore();
		const added = (size: number) => {
			store.newProject(createProject({ width: size, height: size }));
			return store.addLight('point')!;
		};
		const ref = added(LIGHT_REF_SIZE);
		const big = added(1024);
		expect(big.params.z).toBe(8 * Number(ref.params.z));
		expect(big.params.radius).toBe(8 * Number(ref.params.radius));
		expect([ref.refDist, big.refDist]).toEqual([POINT_LIGHT_REF_DIST, 8 * POINT_LIGHT_REF_DIST]);
		expect(store.project.lighting.lights.at(-1)).toBe(big);
	});
});

describe('project store: coverage-only Mask area', () => {
	beforeEach(() => setActivePinia(createPinia()));

	it('starts its sources Solid when it begins reading a plain coverage, and lets Pattern be picked again', () => {
		ensureBuiltins();
		const store = useProjectStore();
		const grime = createLayer('noise', { mk_target: 'Grime' }, 'Grime');
		const area = createLayer('surfacemask', { mk_target: '', dif_on: true }, 'Paint');
		store.newProject(createProject({ width: 32, height: 32, layers: [grime, area] }));
		const l = () => store.getLayer(area.id)!;
		store.setLayerParam(area.id, 'src_mask', 'Grime');
		expect(l().params.dif_src).toBe('value');
		store.setLayerParam(area.id, 'select', 'features');
		expect([l().params.dif_src, l().params.h_src]).toEqual(['flat', 'flat']);
		store.setLayerParam(area.id, 'dif_src', 'value');
		store.setLayerParam(area.id, 'dif_opacity', 0.5);
		expect(l().params.dif_src).toBe('value');
	});
});

describe('project store: unsaved changes', () => {
	beforeEach(() => setActivePinia(createPinia()));

	it('is dirty after an edit until saved, and clean again when the edit is undone', () => {
		const store = useProjectStore();
		store.newProject(createProject({ width: 32, height: 32 }));
		expect(store.isDirty()).toBe(false);
		store.addLight('point');
		expect(store.isDirty()).toBe(true);
		store.undo();
		expect(store.isDirty()).toBe(false);
		store.addLight('point');
		store.markSaved();
		expect(store.isDirty()).toBe(false);
	});
});

describe('project store: post filters', () => {
	beforeEach(() => setActivePinia(createPinia()));

	it('duplicates a filter right after itself, with its own id and settings', () => {
		ensureBuiltins();
		const store = useProjectStore();
		store.newProject(createProject({ width: 32, height: 32 }));
		const type = allPostDefs()[0].type;
		const a = store.addPost(type);
		const b = store.addPost(type);
		const copy = store.duplicatePost(a.id)!;
		expect(store.project.post.map((f) => f.id).slice(-3)).toEqual([a.id, copy.id, b.id]);
		expect(copy.id).not.toBe(a.id);
		expect(copy.params).toEqual(a.params);
		expect(copy.params).not.toBe(a.params);
	});
});

describe('project store: variants', () => {
	beforeEach(() => setActivePinia(createPinia()));

	function start() {
		ensureBuiltins();
		const store = useProjectStore();
		store.newProject(createProject({ width: 64, height: 64, layers: [createLayer('bricks', {}, 'Bricks')] }));
		return store;
	}

	it('switches as one undo step, and undo returns to the variant as it was', () => {
		const store = start();
		const dry = store.variants.activeId;
		const wet = store.addVariant()!;
		store.project.base.roughness = 0.2;
		store.commitNow();
		store.switchVariant(dry);
		expect(store.project.base.roughness).toBe(0.75);
		store.undo();
		expect(store.variants.activeId).toBe(wet.id);
		expect(store.project.base.roughness).toBe(0.2);
		expect([...store.changedKeys]).toEqual(['base.roughness']);
	});

	it('marks base material, environment and project settings changes on their own rows', () => {
		const store = start();
		store.addVariant();
		store.project.base.roughness = 0.2;
		store.project.lighting.sky.intensity = 0.9;
		store.project.lighting.ambient.intensity = 0.1;
		store.project.render.bounces = 3;
		store.commitNow();
		expect([...store.changedItems].sort()).toEqual(['base', 'environment', 'project']);
	});

	it('steps through the variants, wrapping', () => {
		const store = start();
		const ids = [store.variants.activeId, store.addVariant()!.id, store.addVariant()!.id];
		store.stepVariant(1);
		expect(store.variants.activeId).toBe(ids[0]);
		store.stepVariant(-1);
		expect(store.variants.activeId).toBe(ids[2]);
	});

	it('resizes every variant and copies each one’s settings to a duplicate', () => {
		const store = start();
		const dry = store.variants.activeId;
		store.addVariant();
		const id = store.project.layers[0].id;
		store.setLayerParam(id, 'mortar', 4);
		store.commitNow();
		const copy = store.duplicateLayer(id)!;
		store.resize(128, 128);
		store.commitNow();
		expect(Number(store.getLayer(copy.id)!.params.mortar)).toBeCloseTo(8);
		store.switchVariant(dry);
		const base = Number(store.getLayer(id)!.params.mortar);
		expect(base).not.toBeCloseTo(8);
		expect(Number(store.getLayer(copy.id)!.params.mortar)).toBeCloseTo(base);
	});

	it('reloads the autosave on the variant that was shown', () => {
		const items = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => items.get(k) ?? null,
			setItem: (k: string, v: string) => void items.set(k, v)
		});
		const store = start();
		const wet = store.addVariant()!;
		store.project.seed = 42;
		store.commitNow();
		setActivePinia(createPinia());
		const again = useProjectStore();
		expect(again.variants.activeId).toBe(wet.id);
		expect(again.project.seed).toBe(42);
		expect(again.isDirty()).toBe(true);
		vi.unstubAllGlobals();
	});
});

describe('project store: gestures', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.useFakeTimers();
	});
	afterEach(() => vi.useRealTimers());

	it('makes a drag one undo step, apart from the edit before it, however long it pauses', async () => {
		ensureBuiltins();
		const store = useProjectStore();
		store.newProject(createProject({ width: 64, height: 64, layers: [createLayer('rect', {}, 'Box')] }));
		const id = store.project.layers[0].id;
		const rotation = () => store.getLayer(id)!.params.rotation;
		store.setLayerParam(id, 'rotation', 10);
		// Grabbed before the edit's own commit is due.
		store.beginGesture();
		for (const a of [20, 30, 40]) {
			store.setLayerParam(id, 'rotation', a);
			await nextTick();
			vi.advanceTimersByTime(1000);
		}
		store.endGesture();
		store.undo();
		expect(rotation()).toBe(10);
		store.undo();
		expect(rotation()).toBe(0);
	});
});
