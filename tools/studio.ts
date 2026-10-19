// Studio: a live render loop for hand-authoring recreations (docs/features/fr7.4-hand-authoring.md).
//
//   npx tsx tools/studio.ts [--dir harness-out/studio] [--workers 1] [--backend windows|swiftshader]
//
// Keeps a GPU session open and watches <dir> for project JSONs. Whenever `<name>.json` is newer than its
// outputs it renders it and writes:
//   <name>.png          the render (final post-processed image)
//   <name>.sheet.png    [reference | render] (+ [height | diffuse] when the project sets "_maps": true, or the maps
//                       it lists, e.g. "_maps": ["height", "ao", "normal-gl"]),
//                       nearest-upscaled so 64 px textures are inspectable
//   <name>.txt          render info, errors and the tile-metric breakdown against the reference
// Project fields used by the studio (ignored by the app): "_ref" (reference PNG path), "_maps" (bool),
// "_scale" (sheet scale), "_samples" (render samples, default the project's maxSamples), "_fit" (fit the colours to
// the reference before rendering; the fitted project is written to <name>.fit.json).
// `<dir>/.idle` is touched whenever the queue is empty.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openSession, type BackendKind } from './backend';
import { contactSheet, decodePng, readPng, type Rgba8 } from './png';
import { writePng } from './png';
import type { HeadlessCompareResult, HeadlessRenderResult } from '../src/headless';

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => {
	const i = args.indexOf(`--${n}`);
	return i >= 0 ? args[i + 1] : d;
};
const dir = resolve(flag('dir', 'harness-out/studio')!);
mkdirSync(dir, { recursive: true });

const png = (url: string): Rgba8 => decodePng(Buffer.from(url.split(',')[1], 'base64'));
const mtime = (f: string) => (existsSync(f) ? statSync(f).mtimeMs : 0);

async function main() {
	const s = await openSession({
		backend: flag('backend') as BackendKind | undefined,
		workers: Number(flag('workers', '1')),
		logPage: false
	});
	console.log(`[studio] ${s.backend}: ${s.renderer} · watching ${dir}`);
	const busy = new Set<string>();
	const pending = (): string[] =>
		readdirSync(dir)
			.filter((f) => f.endsWith('.json'))
			.map((f) => f.slice(0, -5))
			.filter((n) => !busy.has(n) && mtime(join(dir, `${n}.json`)) > mtime(join(dir, `${n}.txt`)));

	const renderOne = async (name: string) => {
		const file = join(dir, `${name}.json`);
		const t0 = Date.now();
		const lines: string[] = [];
		try {
			const project = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
			const ref = typeof project._ref === 'string' ? project._ref : undefined;
			const samples = typeof project._samples === 'number' ? project._samples : undefined;
			await s.callOn(0, 'loadProject', project);
			if (project._fit && ref && existsSync(ref)) {
				// "_fit": fit the colours to the reference first (smart materials through their colour controls).
				const target = readPng(ref);
				const t = { width: target.width, height: target.height, rgba: Buffer.from(target.data).toString('base64') };
				const f = await s.callOn<{ before: number; after: number; rounds: number; project: unknown }>(
					0,
					'fitColours',
					t,
					{ samples: 16 }
				);
				writeFileSync(join(dir, `${name}.fit.json`), JSON.stringify(f.project, null, 1));
				lines.push(`colour fit ${f.before.toFixed(3)} → ${f.after.toFixed(3)} (${f.rounds} rounds)`);
			}
			const r = await s.callOn<HeadlessRenderResult>(0, 'render', { samples });
			const render = png(r.png);
			writePng(join(dir, `${name}.png`), render);
			lines.push(`render ${r.width}×${r.height} · ${r.samples} spp · ${r.ms.toFixed(0)} ms`);
			for (const [k, v] of Object.entries(r.errors)) lines.push(`ERROR ${k}: ${v.slice(0, 400)}`);
			const tiles: Rgba8[] = [];
			if (ref && existsSync(ref)) {
				const target = readPng(ref);
				tiles.push(target);
				const t = { width: target.width, height: target.height, rgba: Buffer.from(target.data).toString('base64') };
				const c = await s.callOn<HeadlessCompareResult>(0, 'compare', t, {
					preset: 'tile',
					wrap: true,
					samples: r.samples
				});
				lines.push(
					`metric (tile) ${c.total.toFixed(3)} · ` +
						Object.entries(c.terms)
							.filter(([k]) => c.weights[k as keyof typeof c.weights] > 0)
							.map(([k, v]) => `${k} ${v.toFixed(2)}`)
							.join(' · ')
				);
			}
			tiles.push(render);
			if (project._maps) {
				const kinds = Array.isArray(project._maps) ? (project._maps as string[]) : ['height', 'diffuse'];
				const maps = await s.callOn<Record<string, string>>(0, 'renderMaps', kinds);
				for (const k of kinds) tiles.push(png(maps[k]));
			}
			const scale =
				typeof project._scale === 'number'
					? project._scale
					: Math.max(1, Math.min(6, Math.floor(320 / Math.max(render.width, render.height))));
			writePng(join(dir, `${name}.sheet.png`), contactSheet(tiles, scale));
		} catch (e) {
			lines.push(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
		}
		lines.push(`done in ${Date.now() - t0} ms`);
		writeFileSync(join(dir, `${name}.txt`), lines.join('\n') + '\n');
		console.log(
			`[studio] ${name}: ${lines[0]}${lines.some((l) => l.startsWith('ERROR') || l.startsWith('FAILED')) ? ' (errors)' : ''}`
		);
	};

	let idle = false;
	for (;;) {
		const todo = pending();
		if (!todo.length) {
			if (!idle) {
				writeFileSync(join(dir, '.idle'), String(Date.now()));
				idle = true;
			}
			await new Promise((r) => setTimeout(r, 250));
			continue;
		}
		idle = false;
		for (const n of todo) {
			busy.add(n);
			await renderOne(n);
			busy.delete(n);
		}
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
