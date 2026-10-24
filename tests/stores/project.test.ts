import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createProject } from '@/core/serialize';
import { LIGHT_REF_SIZE, POINT_LIGHT_REF_DIST } from '@/core/lights';
import { useProjectStore } from '@/stores/project';

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
