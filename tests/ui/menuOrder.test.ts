// The New Layer menu's order (MENU_ORDER in ui/meta.ts): every layer type is placed in its family.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { allLayerDefs } from '@/layers/registry';
import { inMenuOrder, MENU_ORDER } from '@/ui/meta';

describe('New Layer menu order', () => {
	ensureBuiltins();

	it('lists every layer type once', () => {
		const types = allLayerDefs().map((d) => d.type);
		expect(types.filter((t) => !MENU_ORDER.includes(t))).toEqual([]);
		expect(MENU_ORDER.filter((t) => !types.includes(t))).toEqual([]);
		expect(new Set(MENU_ORDER).size).toBe(MENU_ORDER.length);
	});

	it('keeps like layers together and puts unlisted types last', () => {
		const order = inMenuOrder([{ type: 'zzz' }, { type: 'stone_blocks' }, { type: 'grid' }, { type: 'bricks' }]);
		expect(order.map((d) => d.type)).toEqual(['bricks', 'stone_blocks', 'grid', 'zzz']);
	});
});
