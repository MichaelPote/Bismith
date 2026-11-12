// Smoke test: render every registered layer type and post filter in a tiny project, report shader errors
// and timings, and write a contact sheet per group.
//
//   npx tsx tools/smoke.ts [--out harness-out/smoke] [--size 64] [--only type1,type2] [--backend windows|swiftshader]
//
// On the GPU when there is one (tools/backend.ts): only D3D's compiler rejects some shaders SwiftShader takes.

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { num, parseArgs, ROOT, str } from './args';
import { openSession, type BackendKind } from './backend';
import { chunk, gridSheet, pngFromDataUrl, writePng, type Rgba8 } from './png';
import type { HeadlessRenderResult } from '../src/headless';
import { ensureBuiltins } from '../src/render/builtins';
import { allLayerDefs } from '../src/layers/registry';
import { allPostDefs } from '../src/render/post/registry';

async function main() {
	const args = parseArgs();
	const out = resolve(str(args, 'out', join(ROOT, 'harness-out/smoke')));
	const size = num(args, 'size', 64);
	const only = str(args, 'only', '').split(',').filter(Boolean);
	mkdirSync(out, { recursive: true });

	ensureBuiltins();
	const layerTypes = allLayerDefs().map((d) => ({ type: d.type, kind: d.kind }));
	const postTypes = allPostDefs().map((d) => d.type);

	const consoleErrors: string[] = [];
	const s = await openSession({
		backend: str(args, 'backend') as BackendKind | undefined,
		logPage: false,
		onPageLog: (level, text) => {
			if (level !== 'warn') consoleErrors.push(text);
		}
	});
	console.log(`${s.backend}: ${s.renderer}`);

	const light = { type: 'directional', params: { azimuth: 315, elevation: 35, intensity: 1.4 } };
	const baseLayers = [
		{ type: 'noise', params: { scale: 4, h_on: true, h_amount: 0.3, dif_on: true } },
		{
			type: 'rect',
			params: {
				inset_x: size / 5,
				inset_y: size / 5,
				radius: size / 12,
				bevel: 0,
				profile: 'flat',
				h_on: true,
				h_amount: 1
			}
		}
	];

	let failures = 0;
	async function run(name: string, project: object): Promise<Rgba8 | null> {
		consoleErrors.length = 0;
		try {
			await s.callOn(0, 'loadProject', project);
			const r = await s.callOn<HeadlessRenderResult>(0, 'render', { samples: 8 });
			const errs = [...Object.values(r.errors), ...consoleErrors.filter((e) => !/GPU stall/.test(e))];
			const status = errs.length ? 'FAIL' : 'ok';
			if (errs.length) failures++;
			console.log(
				`${status.padEnd(4)} ${name.padEnd(28)} ${r.ms.toFixed(0).padStart(5)} ms${errs.length ? '  ' + errs[0].slice(0, 300) : ''}`
			);
			return pngFromDataUrl(r.png);
		} catch (e) {
			failures++;
			console.log(`FAIL ${name.padEnd(28)} ${e instanceof Error ? e.message.slice(0, 300) : e}`);
			return null;
		}
	}

	const sheets: Record<string, Rgba8[]> = { generators: [], filters: [], post: [] };
	for (const { type, kind } of layerTypes) {
		if (only.length && !only.includes(type)) continue;
		const layers = kind === 'generator' ? [{ type, params: {} }] : [...baseLayers, { type, params: {} }];
		const img = await run(`layer:${type}`, {
			width: size,
			height: size,
			tileable: true,
			layers,
			lighting: { lights: [light] },
			render: { maxSamples: 8 },
			post: [{ type: 'tonemap' }]
		});
		if (img) sheets[kind === 'generator' ? 'generators' : 'filters'].push(img);
	}
	for (const type of postTypes) {
		if (only.length && !only.includes(type)) continue;
		const layers = [
			...baseLayers,
			{
				type: 'rect',
				params: {
					size_mode: 'size',
					width: size * 0.6,
					height: 3,
					radius: 1.5,
					bevel: 1,
					h_on: true,
					h_amount: 0.3,
					e_on: true,
					e_src: 'flat',
					e_intensity: 6
				}
			}
		];
		const post = type === 'tonemap' ? [{ type }] : [{ type, params: {} }, { type: 'tonemap' }];
		const img = await run(`post:${type}`, {
			width: size,
			height: size,
			tileable: true,
			layers,
			lighting: { lights: [light] },
			render: { maxSamples: 8 },
			post
		});
		if (img) sheets.post.push(img);
	}

	for (const [k, imgs] of Object.entries(sheets)) {
		if (!imgs.length) continue;
		writePng(join(out, `${k}.png`), gridSheet(chunk(imgs, 8), { scale: 2 }));
		console.log(`sheet ${k} → ${join(out, `${k}.png`)}`);
	}

	await s.close();
	console.log(failures ? `${failures} failure(s)` : 'all passed');
	process.exit(failures ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
