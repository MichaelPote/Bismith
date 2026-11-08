// Every preset file in public/presets/ (docs/features/fr5.4-presets.md) loads without losing anything — registered types,
// known param keys — carries a preview, holds what its header says, and is listed in an up-to-date manifest.json.

import { describe, expect, it } from 'vitest';
import { loadBuiltinPresets, setPresetSource, builtinImage } from '@/presets';
import type { PresetManifest } from '@/presets/manifest';
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

const files = import.meta.glob('../../public/presets/**/*.json', { eager: true, import: 'default' });
const byPath = new Map(
	Object.entries(files).map(([f, raw]) => [f.replace('../../public/presets/', '').replace(/\.json$/, ''), raw])
);
const manifest = byPath.get('manifest') as PresetManifest;
byPath.delete('manifest');
const raws = byPath as Map<string, Project>;
const onDisk = [...raws.keys()].sort();
setPresetSource({ manifest: async () => manifest, file: async (p) => raws.get(p) });
const builtins = await loadBuiltinPresets();

describe('presets', () => {
	it('finds a built-in lighting preset’s sky by name, and nothing else', async () => {
		expect(await builtinImage('studio-environment.jpg')).toMatch(/^data:image\//);
		expect(await builtinImage('someone-elses.jpg')).toBeUndefined();
	});

	it('manifest.json is up to date (npm run presets:manifest)', () => {
		for (const m of manifest.presets) {
			const raw = raws.get(m.path);
			expect(raw, `${m.path} is in presets/`).toBeTruthy();
			expect([m.kind, m.target, m.name, m.description, m.category], m.path).toEqual([
				raw!.preset?.kind,
				raw!.preset?.target,
				raw!.name,
				raw!.description,
				raw!.preset?.category
			]);
			// The file's own preview, unless an image beside it took its place.
			if (raw!.preview) expect(m.preview, `${m.path} preview`).toBe(raw!.preview);
		}
	});

	it('every file is a preset, listed in the manifest', () => {
		expect(builtins.map((p) => p.key.slice('builtin:'.length)).sort()).toEqual(onDisk);
	});

	for (const entry of builtins) {
		const path = entry.key.slice('builtin:'.length);
		const raw = raws.get(path)!;

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

		it(`${path} holds what its header says`, async () => {
			const p = await entry.project();
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

		it(`${path} carries the images it uses (its Stamps', its sky's)`, async () => {
			const p = await entry.project();
			const names = [p.lighting.sky.image ?? ''];
			for (const l of p.layers)
				for (const d of layerParamDefs(l.type)) if (d.image) names.push(String(l.params[d.key] ?? ''));
			// A built-in lighting preset's sky needs no copy: it's fetched from that preset by name.
			const carried = [...Object.keys(p.preset?.images ?? {}), ...builtins.flatMap((b) => b.images ?? [])];
			for (const n of names.filter(Boolean)) expect(carried).toContain(n);
		});
	}
});

describe('lighting presets with an environment image', () => {
	const URL = 'data:image/png;base64,iVBORw0KGgo=';
	it('save the image with the preset and bring it along when applied', async () => {
		ensureBuiltins();
		putImage('test-sky.png', URL, false);
		const from = createProject();
		from.lighting.sky.image = 'test-sky.png';
		const preset = await buildPreset(from, presetItemOf(from, { kind: 'lighting' })!, { name: 'Test sky' });
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

	it('are among the built-ins', async () => {
		const lighting = await Promise.all(builtins.filter((e) => e.kind === 'lighting').map((e) => e.project()));
		expect(lighting.filter((p) => p.lighting.sky.image).length).toBeGreaterThanOrEqual(4);
	});
});
