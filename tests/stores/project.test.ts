import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createProject } from '@/core/serialize';
import { LIGHT_REF_SIZE, POINT_LIGHT_REF_DIST } from '@/core/lights';
import { useProjectStore } from '@/stores/project';
import { createLayer } from '@/layers/registry';
import { ensureBuiltins } from '@/render/builtins';
import { allPostDefs } from '@/render/post/registry';

describe('project store: lights', () => {
	beforeEach(() => setActivePinia(createPinia()));

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
