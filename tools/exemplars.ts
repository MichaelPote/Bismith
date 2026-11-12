// Exemplar library for emulation memory (docs/features/fr7.3-emulation.md).
//
//   npx tsx tools/exemplars.ts add <project.json | dir …> [--lib private/exemplars] [--refdirs d1,d2] [--backend …]
//   npx tsx tools/exemplars.ts list [--lib private/exemplars]
//
// An exemplar is a hand- or agent-made project recreating a reference texture; the project JSON names its
// reference in `_ref` (a PNG path). `add` scores it against the reference (GPU) and stores it — with the
// reference's analysis — in the same layout tools/emulate.ts writes, so `emulate --memory private/exemplars` seeds
// matching targets with it. Names are prefixed `ex_` so an exemplar is also used for its own reference.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { expandInputs, parseArgs, str } from './args';
import { openSession, type BackendKind } from './backend';
import { readPng, rgbaTarget } from './png';
import { analyzeTarget } from '../src/match/analyze';
import { fromRgba8 } from '../src/match/image';
import type { HeadlessCompareResult } from '../src/headless';

interface Entry {
	name: string;
	source: string;
	width: number;
	height: number;
	template: string;
	loss: number;
	terms: Record<string, number>;
	evaluations: number;
	ms: number;
}

async function main() {
	const [cmd, ...rest] = process.argv.slice(2);
	const args = parseArgs(rest);
	const lib = resolve(str(args, 'lib', 'private/exemplars'));
	mkdirSync(lib, { recursive: true });
	const indexFile = join(lib, 'index.json');
	const index = new Map<string, Entry>();
	if (existsSync(indexFile))
		for (const e of JSON.parse(readFileSync(indexFile, 'utf8')) as Entry[]) index.set(e.name, e);

	if (cmd === 'list') {
		for (const e of [...index.values()].sort((a, b) => a.name.localeCompare(b.name)))
			console.log(`${e.name.padEnd(24)} ${e.loss.toFixed(3)}  ${e.source}`);
		return;
	}
	if (cmd !== 'add') throw new Error('usage: exemplars.ts add <project.json|dir …> | list');

	const files = expandInputs(args.positional, (f) => f.endsWith('.json') && !f.endsWith('.result.json'));
	const refdirs = str(args, 'refdirs');
	const s = await openSession({ backend: str(args, 'backend') as BackendKind | undefined, logPage: false });
	try {
		for (const f of files) {
			const project = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
			let ref = project._ref as string | undefined;
			if (!ref && refdirs) {
				// Fall back to a reference named like the project file in one of --refdirs.
				for (const d of refdirs.split(',')) {
					const cand = join(d, `${basename(f, '.json')}.png`);
					if (existsSync(cand)) {
						ref = cand;
						break;
					}
				}
			}
			if (!ref || !existsSync(ref)) {
				console.log(`skip ${basename(f)}: no readable _ref`);
				continue;
			}
			delete project._ref;
			const img = readPng(ref);
			const analysis = analyzeTarget(fromRgba8(img.data, img.width, img.height));
			await s.callOn(0, 'loadProject', project);
			const r = await s.callOn<HeadlessCompareResult>(0, 'compare', rgbaTarget(img), {
				preset: 'tile',
				samples: 64,
				wrap: analysis.tileable
			});
			const name = `ex_${basename(ref, extname(ref))}_${basename(f, '.json')}`;
			writeFileSync(join(lib, `${name}.json`), JSON.stringify(project, null, 2));
			writeFileSync(
				join(lib, `${name}.result.json`),
				JSON.stringify({ analysis, template: `exemplar`, loss: r.total, terms: r.terms }, null, 1)
			);
			index.set(name, {
				name,
				source: ref,
				width: img.width,
				height: img.height,
				template: 'exemplar',
				loss: r.total,
				terms: r.terms,
				evaluations: 0,
				ms: 0
			});
			console.log(`${name.padEnd(36)} loss ${r.total.toFixed(3)}`);
		}
	} finally {
		writeFileSync(
			indexFile,
			JSON.stringify(
				[...index.values()].sort((a, b) => a.name.localeCompare(b.name)),
				null,
				1
			)
		);
		await s.close();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
