// GLSL ES 3.00 reserves words a shader may not use as names (`patch`, `sample`, `filter`…). A variable named after one
// fails the program on every backend, and that failure breaks the layers drawn after it too, with nothing in the log.

import { describe, expect, it } from 'vitest';
import { ensureBuiltins } from '@/render/builtins';
import { allLayerDefs } from '@/layers/registry';

const RESERVED = [
	'attribute',
	'varying',
	'coherent',
	'volatile',
	'restrict',
	'readonly',
	'writeonly',
	'resource',
	'atomic_uint',
	'noperspective',
	'patch',
	'sample',
	'subroutine',
	'common',
	'partition',
	'active',
	'asm',
	'class',
	'union',
	'enum',
	'typedef',
	'template',
	'this',
	'goto',
	'inline',
	'noinline',
	'public',
	'static',
	'extern',
	'external',
	'interface',
	'long',
	'short',
	'double',
	'half',
	'fixed',
	'unsigned',
	'superp',
	'input',
	'output',
	'filter',
	'sizeof',
	'cast',
	'namespace',
	'using'
];
const DECLARED = new RegExp(`\\b(?:float|int|uint|bool|[biu]?vec[234]|mat[234])\\s+(${RESERVED.join('|')})\\b`);

describe('layer shaders', () => {
	ensureBuiltins();

	it('name no variable after a GLSL reserved word', () => {
		for (const def of allLayerDefs())
			for (const src of [def.glsl, def.filterGlsl]) if (src) expect(src.match(DECLARED)?.[0], def.type).toBeUndefined();
	});
});
