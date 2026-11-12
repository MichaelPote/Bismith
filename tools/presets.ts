// Render every starter preset to harness-out/presets (or --out) and write a contact sheet, on the GPU when there is one
// (tools/backend.ts). It reads the presets and writes only there: the manifest is `npm run presets:manifest`.
//   npx tsx tools/presets.ts [--out dir] [--only id1,id2] [--samples N] [--scale 3] [--backend windows|swiftshader]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { num, parseArgs, ROOT, str } from './args';
import { openSession, type BackendKind } from './backend';
import { gridSheet, pngFromDataUrl, writePng, type Rgba8 } from './png';
import { PRESET_DIR, selectPresets } from './presets-manifest';
import type { HeadlessRenderResult } from '../src/headless';

async function main() {
	const args = parseArgs();
	const out = resolve(str(args, 'out', join(ROOT, 'harness-out/presets')));
	const only = str(args, 'only', '').split(',').filter(Boolean);
	const samples = num(args, 'samples');
	const scale = num(args, 'scale', 3);
	mkdirSync(out, { recursive: true });
	// --only takes the id ("retro/bricks") or the file name alone ("bricks"); outputs are named by the id, flattened.
	const ids = selectPresets(only, 'project');
	const s = await openSession({ backend: str(args, 'backend', 'auto') as BackendKind | 'auto' });
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
			const r = await s.callOn<HeadlessRenderResult>(0, 'render', samples ? { samples } : {});
			const img = pngFromDataUrl(r.png);
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
		writePng(join(out, 'sheet.png'), gridSheet([imgs], { scale }));
		console.log(`sheet → ${join(out, 'sheet.png')}`);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
