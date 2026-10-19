// Guards the properties panel: a param whose group is not declared by its LayerDef would never be shown.
import { it, expect } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { allLayerDefs, layerGroups, layerParamDefs } from '@/layers/registry';
it('every param is in a displayed group', () => {
	ensureBuiltins();
	const missing: string[] = [];
	for (const def of allLayerDefs()) {
		const groups = new Set(layerGroups(def).map((g) => g.id));
		for (const p of layerParamDefs(def.type))
			if (!groups.has(p.group ?? 'params')) missing.push(`${def.type}.${p.key} (${p.group})`);
	}
	expect(missing).toEqual([]);
});
