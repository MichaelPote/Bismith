// Render every starter preset to harness-out/presets (or --out) and write a contact sheet, on the GPU when there is one
// (tools/backend.ts). It reads the presets and writes only there: the manifest is `npm run presets:manifest`.
//   npx tsx tools/presets.ts [--out dir] [--only id1,id2] [--samples N] [--scale 3] [--backend windows|swiftshader]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession, type BackendKind } from './backend';
import { contactSheet, decodePng, writePng, type Rgba8 } from './png';
import { buildManifest, PRESET_DIR } from './presets-manifest';
import type { HeadlessRenderResult } from '../src/headless';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const flag = (name: string, def: string) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : def;
};

async function main() {
	const out = resolve(flag('out', join(ROOT, 'harness-out/presets')));
	const only = flag('only', '').split(',').filter(Boolean);
	const samples = flag('samples', '');
	const scale = Number(flag('scale', '3'));
	mkdirSync(out, { recursive: true });
	// --only takes the id ("retro/bricks") or the file name alone ("bricks"); outputs are named by the id, flattened.
	const ids = buildManifest()
		.presets.filter((p) => p.kind === 'project')
		.map((p) => p.path.slice('project/'.length))
		.filter((id) => !only.length || only.some((o) => o === id || o === id.split('/').pop()));
	const s = await openSession({ backend: flag('backend', 'auto') as BackendKind | 'auto', workers: 1 });
	console.log(`${s.backend}: ${s.renderer}`);
	const imgs: Rgba8[] = [];
	try {
		for (const id of ids) {
			const file = id.replace(/\//g, '-');
			// The whole file: the images a preset carries are in its header.
			await s.callOn(0, 'loadProject', JSON.parse(readFileSync(join(PRESET_DIR, `project/${id}.json`), 'utf8')));
			await s.callOn(0, 'settle');
			const { preset: _header, ...project } = await s.callOn<Record<string, unknown>>(0, 'getProject');
			writeFileSync(join(out, `${file}.json`), JSON.stringify(project, null, 2));
			const r = await s.callOn<HeadlessRenderResult>(0, 'render', samples ? { samples: Number(samples) } : {});
			const img = decodePng(Buffer.from(r.png.split(',')[1], 'base64'));
			writePng(join(out, `${file}.png`), img);
			imgs.push(img);
			const errs = Object.values(r.errors);
			console.log(
				`${id.padEnd(10)} ${r.width}×${r.height} ${r.samples} spp ${r.ms.toFixed(0)} ms${errs.length ? '  ERR ' + errs[0].slice(0, 200) : ''}`
			);
		}
	} finally {
		await s.close();
	}
	if (imgs.length) {
		writePng(join(out, 'sheet.png'), contactSheet(imgs, scale));
		console.log(`sheet → ${join(out, 'sheet.png')}`);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
