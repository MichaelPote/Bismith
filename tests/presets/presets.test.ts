// Every preset file in presets/ (docs/features/fr5.4-presets.md) loads without losing anything — registered types,
// known param keys — carries a preview, holds what its header says, and is listed in the generated builtin.ts.

import { describe, expect, it } from 'vitest';
import { BUILTIN_FILES } from '@/presets/builtin';
import { builtinPresets } from '@/presets';
import { layerParamDefs, getLayerDef } from '@/layers/registry';
import { getPostDef } from '@/render/post/registry';
import { LIGHT_DEFS } from '@/core/lights';
import { isPreview, normalizeProject } from '@/core/serialize';
import type { Project } from '@/core/project';
import { ensureBuiltins } from '@/render/builtins';
import { applyLightingPreset, buildPreset, presetItemOf } from '@/presets/apply';
import { imageUrl, putImage } from '@/core/images';
import { createProject } from '@/core/serialize';

ensureBuiltins();

const files = import.meta.glob('../../presets/**/*.json', { eager: true, import: 'default' });
const onDisk = Object.keys(files)
	.map((f) => f.replace('../../presets/', '').replace(/\.json$/, ''))
	.sort();

describe('presets', () => {
	it('builtin.ts lists every file in presets/ (npx tsx tools/presets-index.ts)', () => {
		expect(Object.keys(BUILTIN_FILES).sort()).toEqual(onDisk);
	});

	it('every file is a preset', () => {
		expect(
			builtinPresets()
				.map((p) => p.key.slice('builtin:'.length))
				.sort()
		).toEqual(onDisk);
	});

	for (const entry of builtinPresets()) {
		const path = entry.key.slice('builtin:'.length);
		const raw = BUILTIN_FILES[path] as Project;

		it(`${path} only uses known types and params`, () => {
			for (const l of raw.layers) {
				expect(getLayerDef(l.type), `layer type ${l.type}`).toBeTruthy();
				const keys = new Set(layerParamDefs(l.type).map((d) => d.key));
				for (const k of Object.keys(l.params))
					expect(keys.has(k), `${path}/${l.name}: unknown param "${k}"`).toBe(true);
			}
			for (const f of raw.post) {
				const def = getPostDef(f.type);
				expect(def, `post type ${f.type}`).toBeTruthy();
				const keys = new Set(def!.params.map((d) => d.key));
				for (const k of Object.keys(f.params))
					expect(keys.has(k), `${path}/${f.type}: unknown param "${k}"`).toBe(true);
			}
			for (const l of raw.lighting.lights) {
				const keys = new Set(LIGHT_DEFS[l.type].params.map((d) => d.key));
				for (const k of Object.keys(l.params))
					expect(keys.has(k), `${path}/${l.name}: unknown light param "${k}"`).toBe(true);
			}
			// Survives normalisation unchanged in shape.
			const n = normalizeProject(raw);
			expect(n.layers.map((l) => l.type)).toEqual(raw.layers.map((l) => l.type));
			expect(n.post.map((f) => f.type)).toEqual(raw.post.map((f) => f.type));
			expect(n.preset?.kind).toBe(entry.kind);
		});

		it(`${path} holds what its header says`, () => {
			const p = entry.project();
			expect(path.split('/')[0], 'folder = kind').toBe(entry.kind);
			switch (entry.kind) {
				case 'layer':
					expect(p.layers.some((l) => l.type === entry.target)).toBe(true);
					expect(path.split('/')[1], 'presets/layer/<type>/').toBe(entry.target);
					break;
				case 'group': {
					// One group, of layers the preset holds.
					expect(p.groups?.length).toBe(1);
					const ids = new Set(p.layers.map((l) => l.id));
					expect(p.groups![0].members.length).toBeGreaterThan(0);
					for (const id of p.groups![0].members) expect(ids.has(id)).toBe(true);
					break;
				}
				case 'light':
					expect(p.lighting.lights.some((l) => l.type === entry.target)).toBe(true);
					break;
				case 'post':
					expect(p.post.some((f) => f.type === entry.target)).toBe(true);
					break;
			}
		});

		it(`${path} carries a preview (npx tsx tools/previews.ts --only ${path})`, () => {
			expect(isPreview(entry.preview)).toBe(true);
		});

		it(`${path} carries the images it uses (its Stamps', its sky's)`, () => {
			const p = entry.project();
			const names = [p.lighting.sky.image ?? ''];
			for (const l of p.layers)
				for (const d of layerParamDefs(l.type)) if (d.image) names.push(String(l.params[d.key] ?? ''));
			for (const n of names.filter(Boolean)) expect(Object.keys(entry.project().preset?.images ?? {})).toContain(n);
		});
	}
});

describe('lighting presets with an environment image', () => {
	const URL = 'data:image/png;base64,iVBORw0KGgo=';
	it('save the image with the preset and bring it along when applied', () => {
		ensureBuiltins();
		putImage('test-sky.png', URL, false);
		const from = createProject();
		from.lighting.sky.image = 'test-sky.png';
		const preset = buildPreset(from, presetItemOf(from, { kind: 'lighting' })!, { name: 'Test sky' });
		expect(preset.lighting.sky.image).toBe('test-sky.png');
		expect(preset.preset?.images).toEqual({ 'test-sky.png': URL });

		// Applied in a browser that doesn't have it yet: stored first, so the sky finds it.
		const saved = JSON.parse(JSON.stringify(preset).replaceAll('test-sky.png', 'other-sky.png')) as Project;
		expect(imageUrl('other-sky.png')).toBeUndefined();
		const into = createProject();
		applyLightingPreset(into, saved);
		expect(into.lighting.sky.image).toBe('other-sky.png');
		expect(imageUrl('other-sky.png')).toBe(URL);
	});

	it('are among the built-ins', () => {
		const withEnv = builtinPresets().filter((e) => e.kind === 'lighting' && e.project().lighting.sky.image);
		expect(withEnv.length).toBeGreaterThanOrEqual(4);
	});
});
